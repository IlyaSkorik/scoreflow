// [ScoreFlow engine] Repeat theory — единый источник истины для реприз.
// `_repeat` живёт на границе такта и НЕ является render-флагом. Renderer/PDF
// только проецируют repeat в нативный VexFlow barline, playback compiler
// разворачивает порядок тактов, scheduler получает уже готовую timeline.
//
// Вольты (первая/вторая концовка) разворачиваются В ТОЙ ЖЕ функции
// (expandMeasureOrder) — единый источник порядка воспроизведения. Логика вольт
// живёт в domain/voltas (repeats импортирует voltas, не наоборот — цикла нет).
// Порядок пайплайна: линейные такты -> repeat-разворот -> volta-разворот ->
// events -> scheduler. Дублирующей playback-логики в scheduler нет.

import { effectiveVoltas, voltaChainFrom, maxEndingOf } from './voltas.js';

export const REPEAT_SPEC = {
    start: { opens: true, closes: false, barline: 'repeatStart' },
    end: { opens: false, closes: true, barline: 'repeatEnd' },
    both: { opens: true, closes: true, barline: 'repeatBoth' },
};

export function parseRepeat(id) {
    return Object.prototype.hasOwnProperty.call(REPEAT_SPEC, id) ? id : null;
}

export function repeatSpec(id) {
    const r = parseRepeat(id);
    return r ? REPEAT_SPEC[r] : null;
}

export function repeatBarline(id) {
    const spec = repeatSpec(id);
    return spec ? spec.barline : null;
}

// Визуальные типы границ: repeat override рисуется вместо обычного `_bar`,
// потому что :| / |: / :|: уже включает профессиональные толстые/тонкие линии.
export function effectiveRepeatBarlines(measures, baseBarlines) {
    const ms = measures || [];
    const out = (baseBarlines || []).slice();
    for (let i = 0; i < ms.length; i++) {
        const rb = repeatBarline(ms[i] && ms[i]._repeat);
        if (rb) out[i] = rb;
    }
    return out;
}

// Порядок тактов для playback БЕЗ вольт. Nested repeats намеренно не
// поддерживаются: один активный repeatStart, один deterministic pass, максимум
// один повтор на repeatEnd. Missing start repeat -> с начала. Missing end repeat
// -> обычный ход. `both` сначала закрывает текущий repeat, затем открывает
// следующий. Это исходная (repeat-only) логика — сохранена ДОСЛОВНО, чтобы
// партитуры без вольт разворачивались побитово так же, как раньше.
function expandRepeatsOnly(ms) {
    const out = [];
    let repeatStart = null;

    for (let i = 0; i < ms.length; i++) {
        out.push(i);
        const spec = repeatSpec(ms[i] && ms[i]._repeat);
        if (!spec) continue;

        if (spec.closes) {
            const from = repeatStart == null ? 0 : repeatStart;
            for (let j = from; j <= i; j++) out.push(j);
            repeatStart = null;
        }
        if (spec.opens) {
            repeatStart = i + 1;
        }
    }
    return out;
}

// Порядок тактов для playback С вольтами. `i` монотонно растёт (нет прыжков
// назад) — infinite loops невозможны by construction.
//
// Пока не встретилась вольта — ведём себя как repeat-only (тот же push + один
// повтор на repeatEnd), поэтому смешанные партитуры (обычные репризы + вольты)
// разворачиваются корректно. Когда `i` доходит до ПЕРВОГО такта цепочки вольт:
//   base       = такты секции повтора ДО первой концовки (repeatStart..i-1),
//                уже сыгранные линейным проходом как проход №1;
//   maxEnding  = наивысший номер концовки в цепочке = число проходов повтора;
//   на каждый проход p=2..maxEnding доигрываем base заново + концовку, чья
//   numbers содержит p. Проход №1 = base + первая концовка (уже в out).
// Затем `i` перескакивает ЗА всю цепочку концовок (их такты в линейном проходе
// повторно не читаются). Если реприза внутри секции не закрывается (нет
// repeatEnd) — концовки играются подряд по разу (детерминированно, без повтора).
function expandWithVoltas(ms, spans) {
    const n = ms.length;
    const startMap = {};
    for (let k = 0; k < spans.length; k++) startMap[spans[k].start] = spans[k];

    const out = [];
    let repeatStart = null; // null -> с начала (0)
    let i = 0;
    while (i < n) {
        const sp = startMap[i];
        if (!sp) {
            out.push(i);
            const spec = repeatSpec(ms[i] && ms[i]._repeat);
            if (spec && spec.closes) {
                const from = repeatStart == null ? 0 : repeatStart;
                for (let j = from; j <= i; j++) out.push(j);
                repeatStart = null;
            }
            if (spec && spec.opens) repeatStart = i + 1;
            i++;
            continue;
        }
        // i — начало цепочки вольт. base уже сыгран линейным проходом (проход №1).
        const chain = voltaChainFrom(spans, i);
        const lastEnd = chain[chain.length - 1].end;
        const maxEnding = maxEndingOf(chain);
        const from = repeatStart == null ? 0 : repeatStart;
        const base = [];
        for (let j = from; j < i; j++) base.push(j);
        // Есть ли reprise-close в [from .. конец первой концовки]? Если да —
        // секция повторяется maxEnding раз; если нет — концовки идут подряд.
        let hasClose = false;
        for (let j = from; j <= chain[0].end; j++) {
            const spc = repeatSpec(ms[j] && ms[j]._repeat);
            if (spc && spc.closes) { hasClose = true; break; }
        }
        if (hasClose) {
            for (let p = 1; p <= maxEnding; p++) {
                if (p > 1) for (let b = 0; b < base.length; b++) out.push(base[b]);
                let ending = null;
                for (let c = 0; c < chain.length; c++) {
                    if (chain[c].numbers.indexOf(p) >= 0) { ending = chain[c]; break; }
                }
                if (ending) for (let j = ending.start; j <= ending.end; j++) out.push(j);
            }
        } else {
            for (let c = 0; c < chain.length; c++) {
                for (let j = chain[c].start; j <= chain[c].end; j++) out.push(j);
            }
        }
        repeatStart = null;
        i = lastEnd + 1;
    }
    return out;
}

// Порядок тактов для playback — ЕДИНЫЙ источник для repeat И volta разворота.
// Без вольт делегирует в repeat-only ветку (побитово прежнее поведение); с
// вольтами — в volta-aware разворот. Missing start repeat -> с начала; missing
// end repeat -> обычный ход; deterministic, без infinite loops.
export function expandMeasureOrder(measures) {
    const ms = measures || [];
    const spans = effectiveVoltas(ms);
    return spans.length === 0 ? expandRepeatsOnly(ms) : expandWithVoltas(ms, spans);
}
