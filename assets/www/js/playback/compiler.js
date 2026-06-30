// [ScoreFlow engine] Playback Compiler — вынесено из index.html без изменений
// логики. Готовит playback events из партитуры: данные на входе, данные на
// выходе. Ничего не знает о DOM, WebView, AudioContext, render и SVG.
import { durationBeats } from '../domain/durations.js';
import { tupletScaleOf } from '../domain/tuplets.js';
import { sameKeys } from '../domain/notes.js';
import { resolveMidi } from '../domain/pitch.js';
import { keySignatureAlterations, effectiveKeys } from '../domain/keysig.js';
import { dynamicsTimeline, velocityAt } from '../domain/dynamics.js';
import {
    effectiveTimeSignatures, measureCapacityQ, measureStarts, metronomeClicks,
} from '../domain/timesig.js';
import { expandMeasureOrder } from '../domain/repeats.js';

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
export function compilePlayback(payload) {
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
    // Громкость каждого события РАЗРЕШАЕТСЯ ОДИН РАЗ из динамических оттенков:
    // на голос строим таймлайн оттенков (абсолютные четверти -> velocity), и
    // каждому событию ставим активную громкость на его startBeat. AudioEngine
    // получает готовый velocity — без повторных расчётов и без оттенков на ноте.
    // Старты тактов разные при сменах размера, поэтому таймлайн строим по starts.
    const timelines = {};
    for (let vi = 0; vi < voiceIds.length; vi++) {
        timelines[voiceIds[vi]] = dynamicsTimeline(measures, voiceIds[vi], starts);
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

    // Repeat expansion — единственное место, где playback узнаёт о репризах.
    // Scheduler получает уже расширенные events/starts/clicks и не содержит
    // repeat branches. Missing start repeat обрабатывает domain/repeats как
    // повтор с начала; missing end repeat не меняет порядок.
    const measureOrder = expandMeasureOrder(measures);
    const expanded = expandEvents(events, measureOrder, starts, capsQ, effTs);
    return {
        events: expanded.events,
        linearEvents: events,
        totalBeats: expanded.totalBeats,
        linearTotalBeats: totalBeats,
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
