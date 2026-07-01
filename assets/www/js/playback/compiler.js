// [ScoreFlow engine] Playback Compiler — вынесено из index.html без изменений
// логики. Готовит playback events из партитуры: данные на входе, данные на
// выходе. Ничего не знает о DOM, WebView, AudioContext, render и SVG.
import { durationBeats } from '../domain/durations.js';
import { tupletScaleOf } from '../domain/tuplets.js';
import { sameKeys } from '../domain/notes.js';
import { resolveMidi } from '../domain/pitch.js';
import { keySignatureAlterations, effectiveKeys } from '../domain/keysig.js';
import { velocityTimeline, velocityAt } from '../domain/dynamics.js';
import { applyArticulations } from '../domain/articulations.js';
import {
    effectiveTimeSignatures, measureCapacityQ, measureStarts, metronomeClicks,
} from '../domain/timesig.js';
import { expandPlaybackOrder } from '../domain/navigation.js';
import { buildTempoMap, tempoSpq } from '../domain/tempo.js';

// Tie-merge для playback: внутри каждого голоса (события уже в порядке
// времени) поглощаем цепочку лиг длительности в одно событие — один
// attack, суммарная длительность. Поглощённые ноты переходят в
// coveredNoteIds головного события (для подсветки всей цепочки).
// Лига валидна лишь между нотами одной высоты, не паузами.
function mergeTies(events) {
    const byVoice = {};
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        (byVoice[e.voiceId] || (byVoice[e.voiceId] = [])).push(e);
    }
    const out = [];
    for (const v in byVoice) {
        const list = byVoice[v];
        let k = 0;
        while (k < list.length) {
            const head = list[k];
            let j = k;
            while (list[j].tieToNext && !list[j].rest && j + 1 < list.length) {
                const nxt = list[j + 1];
                if (nxt.rest || !sameKeys(head.keys, nxt.keys)) break;
                head.durationBeats += nxt.durationBeats;
                head.coveredNoteIds.push(nxt.noteId);
                j++;
            }
            out.push(head);
            k = j + 1;
        }
    }
    return out;
}

function expandEvents(linearEvents, order, originalStarts, originalCapsQ, effTs) {
    const expandedCapsQ = order.map(function (mi) { return originalCapsQ[mi] || 0; });
    const expandedStarts = measureStarts(expandedCapsQ);
    const byMeasure = {};
    for (let i = 0; i < linearEvents.length; i++) {
        const e = linearEvents[i];
        const parts = String(e.noteId).split(':');
        const mi = Number(parts[0]);
        (byMeasure[mi] || (byMeasure[mi] = [])).push(e);
    }

    const events = [];
    for (let oi = 0; oi < order.length; oi++) {
        const mi = order[oi];
        const src = byMeasure[mi] || [];
        const srcBase = originalStarts[mi] || 0;
        const dstBase = expandedStarts[oi] || 0;
        for (let k = 0; k < src.length; k++) {
            const e = src[k];
            events.push(Object.assign({}, e, {
                startBeat: dstBase + (e.startBeat - srcBase),
                playbackMeasure: oi,
                sourceMeasure: mi,
            }));
        }
    }
    events.sort(function (a, b) { return a.startBeat - b.startBeat; });
    return {
        events: events,
        starts: expandedStarts,
        capsQ: expandedCapsQ,
        totalBeats: expandedStarts[expandedStarts.length - 1] || 0,
        clicks: metronomeClicks(order.map(function (mi) { return effTs[mi]; }), expandedStarts),
    };
}

// --- Playback Compiler ---------------------------------------------
// Событие: { noteId, startBeat, durationBeats, keys, voiceId, rest }.
// Биты — в четвертях. Старт каждого такта берётся из кумулятивной сетки
// (starts[mi]) по ДЕЙСТВУЮЩЕМУ размеру КАЖДОГО такта (mid-score смены метра),
// поэтому неполные/перелитые такты и разные размеры не сбивают временную сетку.
// Паузы и пустые такты дают «якоря» для playhead.
export function compilePlayback(payload, baseTempoOverride) {
    const isDrums = payload.instrument === 'drums';
    const voiceIds = isDrums ? ['perc'] : ['treble', 'bass'];
    const measures = payload.measures || [];
    // Действующий РАЗМЕР КАЖДОГО такта (старт + смены `_ts`) — единое разрешение
    // из domain/timesig (та же логика, что в render/print). Ёмкость такта и
    // абсолютные старты считаются отсюда; глобального размера нет.
    const effTs = effectiveTimeSignatures(measures, payload.timeSignature || '4/4');
    const capsQ = effTs.map(measureCapacityQ); // длина каждого такта в четвертях
    const starts = measureStarts(capsQ);       // абсолютный старт такта (+ финал)
    const totalBeats = starts[starts.length - 1];
    // Действующая тональность КАЖДОГО такта (старт партитуры + смены `_key`) —
    // единое разрешение из domain/keysig (та же логика, что в render/print).
    // Альтерации (ступень -> сдвиг) пересчитываются на границе такта, поэтому
    // playback переключается ровно на такте смены. Для ударных высота не нужна.
    const effKeys = isDrums ? [] : effectiveKeys(measures, payload.keySignature || 'C');
    // Громкость каждого события РАЗРЕШАЕТСЯ ОДИН РАЗ: на голос строим velocity-
    // таймлайн (ступенчатые оттенки + ramp-сегменты вилок cresc./dim.), и каждому
    // событию ставим velocityAt на его startBeat — ВНУТРИ вилки это ИНТЕРПОЛЯЦИЯ,
    // иначе ступенька. AudioEngine получает готовый velocity, без повторных
    // расчётов и без вилок/оттенков на ноте. Таймлайн строим по ЛИНЕЙНЫМ starts
    // (до repeat/volta-разворота): развёрнутые события наследуют velocity головы.
    const timelines = {};
    for (let vi = 0; vi < voiceIds.length; vi++) {
        timelines[voiceIds[vi]] = velocityTimeline(measures, voiceIds[vi], starts);
    }
    let events = [];

    for (let mi = 0; mi < measures.length; mi++) {
        const base = starts[mi];
        const measureQ = capsQ[mi]; // ёмкость ЭТОГО такта (четверти)
        // Альтерации действующей тональности этого такта. Сброс знаков такта
        // (measureAcc ниже) уже происходит на каждый такт/голос, поэтому смена
        // тональности корректно начинает новый контекст без утечки знаков.
        const keyAlt = isDrums ? {} : keySignatureAlterations(effKeys[mi] || 'C');
        for (let vi = 0; vi < voiceIds.length; vi++) {
            const v = voiceIds[vi];
            const notes = (measures[mi] && measures[mi][v]) || [];
            if (notes.length === 0) {
                events.push({ noteId: mi + ':' + v + ':-1', startBeat: base,
                    durationBeats: measureQ, keys: [], midis: [], voiceId: v, rest: true });
                continue;
            }
            // Состояние знаков такта на ЭТОМ стане (голосе): (ступень+октава) ->
            // сдвиг. Знак действует до конца такта на той же высоте; сбрасывается
            // на каждый такт/голос (отдельные станы — независимые правила).
            const measureAcc = {};
            let acc = 0;
            for (let ni = 0; ni < notes.length; ni++) {
                const n = notes[ni];
                // Реальное время с учётом tuplet (нестандартная ритмика).
                const q = durationBeats(n.duration, n.dots) * tupletScaleOf(n);
                const keys = n.keys || [];
                // Реальная высота (MIDI) каждой головки — ЕДИНОЕ место расчёта
                // (тональность + знак + правила такта). Вызывается для всех нот
                // по порядку, чтобы корректно накапливать знаки такта (даже для
                // нот, которые позже сольются лигой). Ударные высоту не считают.
                const midis = [];
                if (!n.rest && !isDrums) {
                    for (let k = 0; k < keys.length; k++)
                        midis.push(resolveMidi(keys[k], keyAlt, measureAcc));
                }
                events.push({
                    noteId: mi + ':' + v + ':' + ni,
                    startBeat: base + acc,
                    durationBeats: q,
                    keys: keys,
                    // Разрешённые MIDI-высоты головок (с учётом тональности и
                    // правил такта). Плеер играет их напрямую — без повторного
                    // парсинга ключей.
                    midis: midis,
                    voiceId: v,
                    rest: !!n.rest,
                    // Tie (лига длительности): объединяется в одно
                    // звучащее событие на merge-проходе ниже.
                    tieToNext: !!n.tieToNext,
                    coveredNoteIds: [], // ноты-продолжения цепочки лиг
                    // Громкость (0..1) разрешена ОДИН РАЗ из активного оттенка
                    // голоса на эту долю (mf, если оттенков нет). При tie-merge
                    // событие-голова сохраняет свой velocity (атака — одна).
                    velocity: velocityAt(timelines[v], base + acc),
                    // Выразительные поля playback-события. attack/release — для
                    // будущей гуманизации; артикуляции нот несут финальный слой
                    // (см. applyArticulations ниже). Значения по умолчанию —
                    // нейтральные (1), поэтому события без артикуляций не меняются.
                    attack: 1,
                    release: 1,
                    articulations: (n.art || []),
                });
                acc += q;
            }
        }
    }
    // Tie-merge: цепочка нот одной высоты -> одно событие (один attack,
    // суммарная длительность). Работает через границы тактов (события
    // уже на общей beat-сетке). Slur на playback НЕ влияет.
    events = mergeTies(events);
    events.sort(function (a, b) { return a.startBeat - b.startBeat; });

    // Артикуляции — ПОСЛЕДНИЙ выразительный слой ПОСЛЕ динамики/вилок и tie-merge:
    // домножают длительность/громкость/атаку уже разрешённого события. Правила и
    // константы — в domain/articulations (единое место). Scheduler читает те же
    // durationBeats/velocity — планировщик НЕ меняется. Считаем на ЛИНЕЙНЫХ
    // событиях (до repeat/volta-разворота); развёрнутые копии наследуют поля.
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.articulations && e.articulations.length) applyArticulations(e, e.articulations);
    }

    // Разворот порядка — единственное место, где playback узнаёт о репризах,
    // вольтах И навигации. domain/navigation оборачивает repeat/volta-разворот
    // (expandMeasureOrder) навигационным слоем (D.C./D.S./Fine/To Coda). Scheduler
    // получает уже развёрнутые events/starts/clicks и не содержит навигации.
    const measureOrder = expandPlaybackOrder(measures);
    const expanded = expandEvents(events, measureOrder, starts, capsQ, effTs);

    // Tempo mapping — ЕДИНСТВЕННОЕ место превращения долей в АБСОЛЮТНОЕ время.
    // Строим на РАЗВЁРНУТОЙ таймлайн-сетке (repeat/volta уже развёрнуты): базовый
    // темп на доле 0 + смены `_tempo` каждого ИСХОДНОГО такта на его развёрнутой
    // позиции (repeat повторяет смену на каждом проходе). Каждому событию и щелчку
    // проставляем startSec/durSec/sec — scheduler читает готовое время, не считая
    // темп. tempoMap отдаём наружу для playhead (сек->доли) и метронома.
    const baseTempo = baseTempoOverride || payload.tempo || 120;
    const tempoAnchors = [{ beat: 0, spq: tempoSpq(baseTempo, 1) }];
    for (let oi = 0; oi < measureOrder.length; oi++) {
        const src = measureOrder[oi];
        const marks = (measures[src] && measures[src]._tempo) || [];
        const dstBase = expanded.starts[oi] || 0;
        for (let k = 0; k < marks.length; k++) {
            tempoAnchors.push({
                beat: dstBase + (marks[k].beat || 0),
                spq: tempoSpq(marks[k].bpm, marks[k].unit),
            });
        }
    }
    const tempoMap = buildTempoMap(tempoAnchors);
    for (let i = 0; i < expanded.events.length; i++) {
        const e = expanded.events[i];
        e.startSec = tempoMap.secAt(e.startBeat);
        e.durSec = tempoMap.secAt(e.startBeat + e.durationBeats) - e.startSec;
    }
    const clicks = expanded.clicks;
    for (let i = 0; i < clicks.length; i++) clicks[i].sec = tempoMap.secAt(clicks[i].beat);
    const totalSec = tempoMap.secAt(expanded.totalBeats);

    return {
        events: expanded.events,
        linearEvents: events,
        totalBeats: expanded.totalBeats,
        linearTotalBeats: totalBeats,
        // Tempo map (доли<->секунды) и полное время воспроизведения. ЕДИНЫЙ конвертер
        // времени: scheduler берёт startSec/durSec событий и sec щелчков отсюда,
        // а обратное преобразование (сек->доли) — для playhead.
        tempoMap: tempoMap, totalSec: totalSec,
        // Сетка тактов для планировщика: абсолютные старты (+финал) и ёмкости
        // (четверти) КАЖДОГО такта — единый источник для playhead/строк (вместо
        // прежнего глобального measureQ). Метроном — готовая сетка щелчков с
        // акцентами (по долям каждого такта), считается в domain/timesig.
        starts: expanded.starts, capsQ: expanded.capsQ,
        linearStarts: starts, linearCapsQ: capsQ,
        measureOrder: measureOrder,
        clicks: expanded.clicks,
        isDrums: isDrums, primaryVoice: isDrums ? 'perc' : 'treble',
    };
}
