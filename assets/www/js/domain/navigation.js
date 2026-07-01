// [ScoreFlow engine] Navigation theory — единый источник истины для навигации
// (Segno/Coda/D.C./D.S./Fine/To Coda). `_nav` живёт на такте и НЕ является
// render-флагом. Это ОТДЕЛЬНЫЙ слой поверх repeat/volta-разворота: navigation
// НЕ переписывает repeats.js/voltas.js, а ОБОРАЧИВАЕТ их результат — линейные
// такты -> repeats -> voltas (expandMeasureOrder) -> navigation -> порядок.
// Scheduler о навигации не знает.
//
// Модель профессиональной навигации:
//   • ЯКОРЯ (markers): segno/coda — цели переходов; toCoda/fine — точки на
//     ВОЗВРАТНОМ проходе (на первом проходе инертны).
//   • ПЕРЕХОДЫ (jumps): D.C. -> в начало (такт 0), D.S. -> к Segno; варианты
//     al Fine (стоп на Fine) и al Coda (To Coda -> Coda -> конец).
//
// Детерминированность и отсутствие бесконечных циклов ГАРАНТИРУЮТСЯ структурно:
// прыжок исполняется РОВНО один раз (первый встреченный на repeat/volta-проходе),
// а возвратный проход — ОДИН линейный проход БЕЗ повторов и БЕЗ повторного
// исполнения D.C./D.S. (профессиональная конвенция: репризы после D.C./D.S. не
// повторяются). Расширяемо: несколько Segno/Coda, репетиционные буквы — новые
// значения/якоря без переделки.

import { expandMeasureOrder } from './repeats.js';

// Спецификация навигационного символа: маркер-якорь или переход.
//   jump   — true у D.C./D.S.* (инициирует возвратный проход);
//   target — 'capo' (в начало) | 'segno' (к Segno) для переходов;
//   mode   — 'plain' (до конца) | 'fine' (до Fine) | 'coda' (To Coda -> Coda).
export const NAV_SPEC = {
    segno: { jump: false },
    coda: { jump: false },
    toCoda: { jump: false },
    fine: { jump: false },
    daCapo: { jump: true, target: 'capo', mode: 'plain' },
    daCapoAlFine: { jump: true, target: 'capo', mode: 'fine' },
    daCapoAlCoda: { jump: true, target: 'capo', mode: 'coda' },
    dalSegno: { jump: true, target: 'segno', mode: 'plain' },
    dalSegnoAlFine: { jump: true, target: 'segno', mode: 'fine' },
    dalSegnoAlCoda: { jump: true, target: 'segno', mode: 'coda' },
};

export function parseNavigation(id) {
    return Object.prototype.hasOwnProperty.call(NAV_SPEC, id) ? id : null;
}

export function navSpec(id) {
    const n = parseNavigation(id);
    return n ? NAV_SPEC[n] : null;
}

// id навигации такта или null. ЕДИНОЕ место чтения `_nav`.
function navOf(measure) {
    return measure ? parseNavigation(measure._nav) : null;
}

// Индекс ПЕРВОГО такта с меткой [id] (или -1). Для segno при переходе
// используется вариант «последний segno на/до такта прыжка» (см. segnoTarget).
function firstMeasureWithNav(measures, id) {
    for (let i = 0; i < measures.length; i++) {
        if (navOf(measures[i]) === id) return i;
    }
    return -1;
}

// Цель D.S.: Segno с НАИБОЛЬШИМ индексом такта <= [jumpMeasure]; иначе первый
// Segno в партитуре; иначе 0 (начало). Готово к нескольким Segno.
function segnoTarget(measures, jumpMeasure) {
    let target = -1;
    for (let i = 0; i <= jumpMeasure && i < measures.length; i++) {
        if (navOf(measures[i]) === 'segno') target = i;
    }
    if (target >= 0) return target;
    const first = firstMeasureWithNav(measures, 'segno');
    return first >= 0 ? first : 0;
}

// Возвратный проход — ОДИН линейный проход от [target] (БЕЗ повторов, БЕЗ
// повторного D.C./D.S.). Дописывает такты в [out].
//   'fine' — до такта с Fine включительно (или до конца, если Fine нет);
//   'coda' — до такта с To Coda включительно, затем от такта Coda до конца;
//   'plain'— от target до конца.
function appendReturnPass(out, measures, target, mode) {
    const n = measures.length;
    if (mode === 'fine') {
        const fine = firstMeasureWithNav(measures, 'fine');
        const stop = fine >= 0 ? fine : n - 1;
        for (let m = target; m <= stop && m < n; m++) out.push(m);
    } else if (mode === 'coda') {
        const toCoda = firstMeasureWithNav(measures, 'toCoda');
        const coda = firstMeasureWithNav(measures, 'coda');
        const leave = toCoda >= 0 ? toCoda : n - 1;
        for (let m = target; m <= leave && m < n; m++) out.push(m);
        if (coda >= 0) for (let m = coda; m < n; m++) out.push(m);
    } else {
        for (let m = target; m < n; m++) out.push(m);
    }
}

// ЕДИНЫЙ порядок тактов для playback: repeat/volta-разворот
// (expandMeasureOrder) + навигационный слой. Без навигации возвращает базовый
// разворот без изменений (ноль регрессий). Прыжок исполняется один раз —
// детерминированно, без бесконечных циклов.
export function expandPlaybackOrder(measures) {
    const ms = measures || [];
    const base = expandMeasureOrder(ms);

    // Первый ПЕРЕХОД (D.C./D.S.) на repeat/volta-проходе. Первый проход
    // проигрывается до этого такта включительно, затем — возвратный.
    let jumpAt = -1;
    let spec = null;
    for (let k = 0; k < base.length; k++) {
        const s = navSpec(navOf(ms[base[k]]));
        if (s && s.jump) { jumpAt = k; spec = s; break; }
    }
    if (jumpAt < 0) return base; // навигационных прыжков нет

    const out = base.slice(0, jumpAt + 1);
    const jumpMeasure = base[jumpAt];
    const target = spec.target === 'segno' ? segnoTarget(ms, jumpMeasure) : 0;
    appendReturnPass(out, ms, target, spec.mode);
    return out;
}
