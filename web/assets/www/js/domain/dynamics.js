// [ScoreFlow engine] Dynamics domain — ЕДИНСТВЕННОЕ место расчёта громкости
// (velocity) playback из динамических оттенков, а также проекция меток в
// SMuFL-глифы для рендера. Оттенок — нотационный объект на ритмической позиции
// (такт+голос+доля), действует на все последующие ноты голоса до следующего
// оттенка. Высоту/тайминг здесь не трогаем — только громкость и глифы.
//
// ЭКСПРЕССИВНЫЙ playback (вилки cresc./dim.) РЕАЛИЗОВАН здесь же, БЕЗ отдельной
// playback-системы: velocityTimeline строит ступенчатый таймлайн оттенков ПЛЮС
// линейные ramp-сегменты вилок, а velocityAt при попадании доли внутрь вилки
// ИНТЕРПОЛИРУЕТ громкость (иначе — прежняя «ступенька»). Компилятор/планировщик/
// AudioEngine не меняются: velocity по-прежнему разрешается ОДИН раз на событие
// (event.velocity сквозной). sfz/fp/rfz — новые записи в DYNAMIC_VELOCITY.
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

// Границы громкости (ppp..fff) — для клампа интерполяции и дефолтного шага вилки
// без целевого оттенка. Один источник со шкалой DYNAMIC_VELOCITY.
const MIN_VELOCITY = DYNAMIC_VELOCITY.ppp; // 0.20
const MAX_VELOCITY = DYNAMIC_VELOCITY.fff; // 1.10
// Шаг вилки без целевого оттенка (≈ один динамический уровень). Крещендо без
// конечного знака поднимает громкость на шаг, диминуэндо — опускает.
export const HAIRPIN_STEP = 0.15;

function clampVelocity(v) {
    return v < MIN_VELOCITY ? MIN_VELOCITY : (v > MAX_VELOCITY ? MAX_VELOCITY : v);
}

// Ступенчатая громкость: последний оттенок с beat<=startBeat, иначе базовая
// (mf). Внутренняя основа и для legacy-массива, и для anchors нового таймлайна.
function stepVelocityAt(anchors, startBeat) {
    let v = DEFAULT_VELOCITY;
    for (let i = 0; i < anchors.length; i++) {
        if (anchors[i].beat <= startBeat + 1e-6) v = anchors[i].velocity;
        else break;
    }
    return v;
}

// Вилки (hairpins) ОДНОГО голоса как абсолютные ramp-сегменты { start, end, type }
// (четверти). Читает измерения из render-проекции measures[mi]._hair (список на
// такте-НАЧАЛЕ вилки): { type, voice, sb (доля старта), em (индекс такта-конца),
// eb (доля конца) }. [bases] — как в dynamicsTimeline (массив стартов по индексу
// такта ЛИБО единый measureQ). Единый источник геометрии вилок для playback.
export function hairpinSegments(measures, voiceId, bases) {
    const arr = Array.isArray(bases);
    const baseOf = function (mi) { return arr ? (bases[mi] || 0) : mi * bases; };
    const out = [];
    for (let mi = 0; mi < measures.length; mi++) {
        const hs = measures[mi] && measures[mi]._hair;
        if (!hs) continue;
        for (let i = 0; i < hs.length; i++) {
            const h = hs[i];
            if (h.voice !== voiceId) continue;
            const em = (h.em != null) ? h.em : mi;
            const start = baseOf(mi) + (h.sb || 0);
            const end = baseOf(em) + (h.eb || 0);
            if (end > start + 1e-9) out.push({ start: start, end: end, type: h.type });
        }
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
}

// Полный velocity-таймлайн голоса: ступенчатые якори оттенков (dynamicsTimeline)
// ПЛЮС ramp-сегменты вилок. Возвращает { anchors, segments }.
//
// Для каждой вилки: startV = активный оттенок на её начале; targetV = оттенок
// РОВНО на её конце, если он там есть; иначе — startV ± HAIRPIN_STEP (клампится),
// и в этом случае в anchors ВСТАВЛЯЕТСЯ синтетический якорь на конце вилки, чтобы
// интерполированная конечная громкость ДЕРЖАЛАСЬ до следующего реального оттенка
// (правило «вилка без целевого знака продолжает конечной громкостью»). Вилки
// обрабатываются по возрастанию start — цепочки back-to-back наследуют громкость.
export function velocityTimeline(measures, voiceId, bases) {
    const anchors = dynamicsTimeline(measures, voiceId, bases);
    const hairs = hairpinSegments(measures, voiceId, bases);
    const segments = [];
    for (let i = 0; i < hairs.length; i++) {
        const h = hairs[i];
        const startV = stepVelocityAt(anchors, h.start);
        let targetV = null;
        for (let k = 0; k < anchors.length; k++) {
            if (Math.abs(anchors[k].beat - h.end) < 1e-6) { targetV = anchors[k].velocity; break; }
        }
        if (targetV == null) {
            const delta = (h.type === 'diminuendo') ? -HAIRPIN_STEP : HAIRPIN_STEP;
            targetV = clampVelocity(startV + delta);
            anchors.push({ beat: h.end, velocity: targetV }); // держим до след. оттенка
            anchors.sort(function (a, b) { return a.beat - b.beat; });
        }
        segments.push({ start: h.start, end: h.end, startV: startV, targetV: targetV });
    }
    return { anchors: anchors, segments: segments };
}

// Активная громкость на момент [startBeat]. ЕДИНСТВЕННОЕ место, откуда playback
// берёт velocity. Принимает ЛИБО legacy-массив якорей (ступенька — обратная
// совместимость), ЛИБО объект velocityTimeline { anchors, segments }: если доля
// попадает внутрь вилки — ЛИНЕЙНАЯ интерполяция startV→targetV, иначе ступенька.
export function velocityAt(timeline, startBeat) {
    if (Array.isArray(timeline)) return stepVelocityAt(timeline, startBeat);
    const segs = (timeline && timeline.segments) || [];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (startBeat >= s.start - 1e-6 && startBeat <= s.end + 1e-6) {
            const span = s.end - s.start;
            let f = span > 1e-9 ? (startBeat - s.start) / span : 0;
            if (f < 0) f = 0; else if (f > 1) f = 1;
            return s.startV + (s.targetV - s.startV) * f;
        }
    }
    return stepVelocityAt((timeline && timeline.anchors) || [], startBeat);
}

// Разбор вилок партитуры как объектов рендера: { type, voice, startMeasure,
// startBeat, endMeasure, endBeat }. Читает measures[mi]._hair. Используется
// рендером (screen/PDF) — играющую геометрию (в четвертях) даёт hairpinSegments.
export function readHairpins(measures) {
    const out = [];
    for (let mi = 0; mi < (measures || []).length; mi++) {
        const hs = measures[mi] && measures[mi]._hair;
        if (!hs) continue;
        for (let i = 0; i < hs.length; i++) {
            const h = hs[i];
            out.push({
                type: h.type, voice: h.voice,
                startMeasure: mi, startBeat: h.sb || 0,
                endMeasure: (h.em != null) ? h.em : mi, endBeat: h.eb || 0,
            });
        }
    }
    return out;
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
