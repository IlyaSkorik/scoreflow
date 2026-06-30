// [ScoreFlow engine] Repeat theory — единый источник истины для реприз.
// `_repeat` живёт на границе такта и НЕ является render-флагом. Renderer/PDF
// только проецируют repeat в нативный VexFlow barline, playback compiler
// разворачивает порядок тактов, scheduler получает уже готовую timeline.

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

// Порядок тактов для playback. Nested repeats намеренно не поддерживаются:
// один активный repeatStart, один deterministic pass, максимум один повтор на
// repeatEnd. Missing start repeat -> с начала. Missing end repeat -> обычный ход.
// `both` сначала закрывает текущий repeat, затем открывает следующий.
export function expandMeasureOrder(measures) {
    const ms = measures || [];
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
