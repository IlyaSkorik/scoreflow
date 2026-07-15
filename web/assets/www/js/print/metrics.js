// [ScoreFlow engine] Print Vertical Metrics — МОДЕЛЬНЫЕ вертикальные габариты
// нотного материала (сколько такт выступает НАД и ПОД станом), считаются из
// самих нот, БЕЗ отрисовки. Печать обязана знать высоту каждой системы ДО
// рисования (пагинация детерминированна, один проход) — в отличие от экрана,
// который меряет реальные bbox и перерисовывает. Модуль ЧИСТЫЙ (без VF/DOM) —
// тестируется в Node.
//
// Координаты: y растёт вниз, 0 — ВЕРХНЯЯ линейка стана, 40 — нижняя
// (гравировочные единицы VexFlow: линейка через 10 u). Возвращаемые габариты —
// «насколько выше 0» (above) и «насколько ниже 40» (below).
import { parseKey } from '../domain/pitch.js';

const DIA = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

const STAFF_SPAN = 40; // высота стана в u
const STEM = 35;       // стандартный штиль VexFlow (3.5 промежутка)
const HALF_HEAD = 4;   // полувысота головки
const ART_PAD = 12;    // высота одной артикуляции над/под головкой
const TUPLET_PAD = 20; // скобка/цифра туплета со стороны штиля (скобка VexFlow
                       // отступает от крайнего штиля и несёт цифру — измерено
                       // по фактической отрисовке 4.2.2)
const ACC_ABOVE = 14;  // подъём глифа акциденталии над центром её линейки
                       // (бемоль — самый высокий: ~1.4 промежутка)

// Номер линейки для ключа VexFlow: 0 — верхняя линейка, 4 — нижняя, шаг 0.5 —
// промежуток. Меньше 0 — выше стана, больше 4 — ниже. Percussion маппится как
// treble (правило VexFlow).
export function staffLineOf(key, clef) {
    const p = parseKey(key);
    const step = DIA[p.step] === undefined ? DIA.b : DIA[p.step];
    const oct = isNaN(p.octave) ? 4 : p.octave;
    const di = step + 7 * oct;
    // Нижняя линейка: G2 (бас) / E4 (скрипичный, перкуссия).
    const ref = clef === 'bass' ? (DIA.g + 7 * 2) : (DIA.e + 7 * 4);
    return 4 - (di - ref) * 0.5;
}

// Габариты ОДНОГО голоса такта: { above, below } в u за пределами стана [0..40].
// Учитывают головки, штили (auto-stem VexFlow: центр выше средней линейки ->
// штиль вниз), артикуляции (со стороны головки) и туплеты (со стороны штиля).
// Паузы лежат внутри стана. Пустой голос -> нули.
export function voiceExtents(notes, clef) {
    let top = 0, bot = STAFF_SPAN; // всё внутри стана по умолчанию
    const list = notes || [];
    for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n || n.rest || !n.keys || !n.keys.length) continue;
        let minL = Infinity, maxL = -Infinity;
        let accMinL = Infinity; // самая высокая нота СО ЗНАКОМ (диез/бемоль/бекар)
        for (let k = 0; k < n.keys.length; k++) {
            const key = n.keys[k];
            const l = staffLineOf(key, clef);
            if (l < minL) minL = l;
            if (l > maxL) maxL = l;
            // Ключ с акциденталией ("db/5", "f#/4", "cn/5"): глиф знака выше
            // головки — учитываем в верхнем габарите.
            if (/^[a-gA-G](##|bb|[#bn])/.test(key) && l < accMinL) accMinL = l;
        }
        let yT = minL * 10, yB = maxL * 10;
        const mid = (yT + yB) / 2;
        // auto_stem: центр НА средней линейке или выше -> штиль вниз.
        const stemUp = mid > 20;
        if (stemUp) { yT -= STEM; yB += HALF_HEAD; }
        else { yT -= HALF_HEAD; yB += STEM; }
        // Глиф акциденталии выше головки (штиль в её сторону может быть выше,
        // тогда знак уже покрыт) — влить в верхний габарит ПОСЛЕ штиля.
        if (accMinL !== Infinity && accMinL * 10 - ACC_ABOVE < yT) {
            yT = accMinL * 10 - ACC_ABOVE;
        }
        // Артикуляции — на стороне головки (напротив штиля).
        const artN = (n.art && n.art.length) || 0;
        if (artN) {
            if (stemUp) yB += ART_PAD * artN;
            else yT -= ART_PAD * artN;
        }
        // Туплет — скобка на стороне штиля.
        if (n.tuplet) {
            if (stemUp) yT -= TUPLET_PAD;
            else yB += TUPLET_PAD;
        }
        if (yT < top) top = yT;
        if (yB > bot) bot = yB;
    }
    return { above: Math.max(0, -top), below: Math.max(0, bot - STAFF_SPAN) };
}

// Габариты голоса ПО ВСЕМ тактам диапазона: массив { above, below } на такт.
export function measureExtents(measures, voice, clef) {
    const out = [];
    const ms = measures || [];
    for (let i = 0; i < ms.length; i++) {
        out.push(voiceExtents((ms[i] && ms[i][voice]) || [], clef));
    }
    return out;
}

// Есть ли в такте mi оттенки/вилки данного голоса (нужен резерв под базовую
// линию динамики). Вилка резервирует место в КАЖДОМ такте своего диапазона.
export function dynamicsPresence(measures, voice) {
    const ms = measures || [];
    const has = new Array(ms.length).fill(false);
    for (let mi = 0; mi < ms.length; mi++) {
        const d = ms[mi] && ms[mi]._dyn;
        if (d && d[voice] && d[voice].length) has[mi] = true;
        const hs = ms[mi] && ms[mi]._hair;
        if (hs) {
            for (let k = 0; k < hs.length; k++) {
                const h = hs[k];
                if (h.voice !== voice) continue;
                // Схема _hair: { type, voice, sb, em, eb } (см. domain/dynamics
                // readHairpins) — em отсутствует у вилки внутри одного такта.
                const em = Math.min(ms.length - 1, h.em == null ? mi : h.em);
                for (let j = mi; j <= em; j++) has[j] = true;
            }
        }
    }
    return has;
}
