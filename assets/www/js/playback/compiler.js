// [ScoreFlow engine] Playback Compiler — вынесено из index.html без изменений
// логики. Готовит playback events из партитуры: данные на входе, данные на
// выходе. Ничего не знает о DOM, WebView, AudioContext, render и SVG.
import { durationBeats } from '../domain/durations.js';
import { tupletScaleOf } from '../domain/tuplets.js';
import { sameKeys } from '../domain/notes.js';
import { resolveMidi } from '../domain/pitch.js';
import { keySignatureAlterations } from '../domain/keysig.js';
import { dynamicsTimeline, velocityAt } from '../domain/dynamics.js';

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

// --- Playback Compiler ---------------------------------------------
// Событие: { noteId, startBeat, durationBeats, keys, voiceId, rest }.
// Биты — в четвертях. Старт каждого такта привязан к его индексу
// (base = mi * measureQ), поэтому неполные/перелитые такты не сбивают
// временную сетку. Паузы и пустые такты дают «якоря» для playhead.
export function compilePlayback(payload) {
    const ts = (payload.timeSignature || '4/4').split('/');
    const beats = parseInt(ts[0], 10) || 4;
    const beatValue = parseInt(ts[1], 10) || 4;
    const isDrums = payload.instrument === 'drums';
    const voiceIds = isDrums ? ['perc'] : ['treble', 'bass'];
    const measures = payload.measures || [];
    const measureQ = beats * (4 / beatValue); // длина такта в четвертях
    // Альтерации тональности (ступень -> сдвиг) — одна из трёх составляющих
    // реальной высоты. Для ударных высота не считается.
    const keyAlt = isDrums ? {} : keySignatureAlterations(payload.keySignature || 'C');
    // Громкость каждого события РАЗРЕШАЕТСЯ ОДИН РАЗ из динамических оттенков:
    // на голос строим таймлайн оттенков (абсолютные четверти -> velocity), и
    // каждому событию ставим активную громкость на его startBeat. AudioEngine
    // получает готовый velocity — без повторных расчётов и без оттенков на ноте.
    const timelines = {};
    for (let vi = 0; vi < voiceIds.length; vi++) {
        timelines[voiceIds[vi]] = dynamicsTimeline(measures, voiceIds[vi], measureQ);
    }
    let events = [];

    for (let mi = 0; mi < measures.length; mi++) {
        const base = mi * measureQ;
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
    return {
        events: events,
        totalBeats: measures.length * measureQ,
        beats: beats, beatValue: beatValue, measureQ: measureQ,
        isDrums: isDrums, primaryVoice: isDrums ? 'perc' : 'treble',
    };
}
