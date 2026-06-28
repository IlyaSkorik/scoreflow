// [ScoreFlow engine] Dynamics domain — ЕДИНСТВЕННОЕ место расчёта громкости
// (velocity) playback из динамических оттенков, а также проекция меток в
// SMuFL-глифы для рендера. Оттенок — нотационный объект на ритмической позиции
// (такт+голос+доля), действует на все последующие ноты голоса до следующего
// оттенка. Высоту/тайминг здесь не трогаем — только громкость и глифы.
//
// ТОЧКА РАСШИРЕНИЯ (экспрессивный playback): velocityAt сейчас возвращает
// «ступеньку» (последний оттенок). Вилки (cresc./dim.) лягут сюда же — таймлайн
// дополняется парами якорей, а velocityAt начинает ИНТЕРПОЛИРОВАТЬ между ними;
// компилятор/планировщик/AudioEngine менять не придётся (event.velocity уже
// сквозной). sfz/fp/rfz — новые записи в DYNAMIC_VELOCITY (+ буквы s/z/r).
import { durationBeats } from './durations.js';
import { tupletScaleOf } from './tuplets.js';

// Метка оттенка -> громкость (velocity/gain 0..1; fff>1 клампится сэмплером и
// синтезом). СИНХРОНИЗИРОВАНО с Dart DynamicMark.velocity (модель/тесты).
export const DYNAMIC_VELOCITY = {
    ppp: 0.20, pp: 0.30, p: 0.45, mp: 0.60,
    mf: 0.75, f: 0.90, ff: 1.00, fff: 1.10,
};

// Громкость по умолчанию (нет оттенка) = mf. Один источник правды для «тихого»
// базового уровня всей партитуры.
export const DEFAULT_VELOCITY = DYNAMIC_VELOCITY.mf;

// Буква метки -> SMuFL-глиф (как в VexFlow TextDynamics). Расширяемо:
// s/z/r уже заведены под будущие sfz/rfz/rinforzando.
export const DYNAMIC_GLYPH = {
    p: 'dynamicPiano', m: 'dynamicMezzo', f: 'dynamicForte',
    s: 'dynamicSforzando', z: 'dynamicZ', r: 'dynamicRinforzando',
    n: 'dynamicNiente',
};

// Громкость метки (с фолбэком на mf для неизвестной/будущей метки).
export function velocityOf(markId) {
    const v = DYNAMIC_VELOCITY[markId];
    return v != null ? v : DEFAULT_VELOCITY;
}

// Таймлайн оттенков ОДНОГО голоса по всей партитуре: отсортированный массив
// { beat (абсолютные четверти), velocity }. Оттенки хранятся в render-проекции
// под measures[mi]._dyn[voiceId] = [{ mark, beat }].
//
// [bases] — абсолютное начало каждого такта в четвертях. Принимает ЛИБО массив
// стартов по индексу такта (mid-score смены размера: разная ёмкость тактов —
// см. domain/timesig.measureStarts), ЛИБО число (единый measureQ для всех
// тактов: base = mi·measureQ — обратная совместимость).
export function dynamicsTimeline(measures, voiceId, bases) {
    const arr = Array.isArray(bases);
    const out = [];
    for (let mi = 0; mi < measures.length; mi++) {
        const m = measures[mi];
        const dyn = m && m._dyn && m._dyn[voiceId];
        if (!dyn) continue;
        const base = arr ? (bases[mi] || 0) : mi * bases;
        for (let i = 0; i < dyn.length; i++) {
            out.push({
                beat: base + (dyn[i].beat || 0),
                velocity: velocityOf(dyn[i].mark),
            });
        }
    }
    out.sort(function (a, b) { return a.beat - b.beat; });
    return out;
}

// Активная громкость на момент [startBeat]: последний оттенок с beat<=startBeat,
// иначе базовая (mf). ЕДИНСТВЕННОЕ место, откуда playback берёт velocity.
export function velocityAt(timeline, startBeat) {
    let v = DEFAULT_VELOCITY;
    for (let i = 0; i < timeline.length; i++) {
        if (timeline[i].beat <= startBeat + 1e-6) v = timeline[i].velocity;
        else break;
    }
    return v;
}

// Онсеты нот такта (четверти от начала такта) — для привязки оттенка к ноте
// при рендере. Та же арифметика реального времени, что и в компиляторе.
export function noteOnsets(notes) {
    const out = [];
    let acc = 0;
    for (let i = 0; i < notes.length; i++) {
        out.push(acc);
        acc += durationBeats(notes[i].duration, notes[i].dots) * tupletScaleOf(notes[i]);
    }
    return out;
}

// Индекс ноты на доле [beat] (точное совпадение онсета), иначе последний онсет
// до [beat] (оттенок «садится» на ближайшую предшествующую ноту). -1 — нот нет.
export function indexAtBeat(onsets, beat) {
    for (let i = 0; i < onsets.length; i++) {
        if (Math.abs(onsets[i] - beat) < 1e-6) return i;
    }
    let idx = -1;
    for (let i = 0; i < onsets.length; i++) {
        if (onsets[i] <= beat + 1e-6) idx = i;
    }
    return idx;
}
