// [ScoreFlow engine] Navigation rendering — ОБЩИЙ слой отрисовки навигационных
// символов (Segno/Coda/D.C./D.S./Fine/To Coda) для ОБОИХ пайплайнов: экран
// (render.js) и печать (print.js). Экран и PDF рисуют символы ОДНИМ кодом и
// совпадают визуально.
//
// Symbol NAD станом (выше темпа/вольт). Segno/Coda — SMuFL-глифы (VF.Glyph
// 'segno'/'coda'); остальное — курсивный текст ("D.C. al Fine", "Fine",
// "To Coda", "D.S." …), как в MuseScore/Dorico/Finale. Решение «что где» и
// разворот playback живут в domain/navigation — здесь только геометрия.

import { glyphExtents } from './measure.js';

const COLOR = '#000000';
const GLYPH_SIZE = 26;  // кегль глифа segno/coda
const FONT = 13;        // кегль текста навигации

// Текстовые метки навигации (для не-глифовых типов). Segno/Coda рисуются глифом.
const NAV_TEXT = {
    toCoda: 'To Coda',
    fine: 'Fine',
    daCapo: 'D.C.',
    daCapoAlFine: 'D.C. al Fine',
    daCapoAlCoda: 'D.C. al Coda',
    dalSegno: 'D.S.',
    dalSegnoAlFine: 'D.S. al Fine',
    dalSegnoAlCoda: 'D.S. al Coda',
};
// SMuFL-глиф для символов-якорей.
const NAV_GLYPH = { segno: 'segno', coda: 'coda' };

// Выравнивание символа по такту: D.C./D.S./Fine/To Coda — над ПРАВЫМ краем
// такта (конец такта — точка перехода/остановки), Segno/Coda — над ЛЕВЫМ краем
// (начало секции). Возвращает 'right' | 'left'.
function navAlign(id) {
    return NAV_GLYPH[id] ? 'left' : 'right';
}

// РЕАЛЬНЫЙ габарит символа навигации для движка размещения (placement):
//   width — ширина глифа/текста, rise/drop — вертикаль вокруг базовой линии,
//   align — 'left' | 'right' (какой край такта — якорь).
// Глифы Segno/Coda меряются пробной отрисовкой (glyphExtents): реальные глифы
// СВИСАЮТ ниже базовой линии — константа кегля этого не знала, и глиф ложился
// на линию вольты. Текст меряется через ctx.measureText.
export function navigationMarkExtents(VF, ctx, id) {
    const glyph = NAV_GLYPH[id];
    if (glyph && VF && VF.Glyph) {
        try {
            const e = glyphExtents(VF, glyph, GLYPH_SIZE);
            return {
                width: e.x1 - Math.min(0, e.x0),
                rise: e.rise, drop: e.drop, align: 'left',
            };
        } catch (e) { /* текстовая оценка ниже */ }
    }
    const text = NAV_TEXT[id] || id;
    let w = text.length * FONT * 0.5;
    if (ctx && ctx.measureText) {
        try {
            ctx.save();
            ctx.setFont('serif', FONT, 'italic');
            const m = ctx.measureText(text);
            if (m && m.width > 0) w = m.width;
            ctx.restore();
        } catch (e) { /* оценка выше */ }
    }
    return { width: w, rise: FONT, drop: FONT * 0.25, align: navAlign(id) };
}

// Нарисовать один навигационный символ по базовой линии [y] (низ символа).
// [xLeft]/[xRight] — левый/правый край такта; символ ставится по краю согласно
// navAlign. Segno/Coda — глиф; прочее — курсивный текст.
export function drawNavigationMark(VF, ctx, id, xLeft, xRight, y) {
    const glyph = NAV_GLYPH[id];
    if (glyph && VF && VF.Glyph) {
        try {
            const g = new VF.Glyph(glyph, GLYPH_SIZE);
            if (g.setContext) g.setContext(ctx);
            let w = GLYPH_SIZE * 0.6;
            try { const m = g.getMetrics().width; if (m > 0) w = m; } catch (e) { /* keep */ }
            g.render(ctx, xLeft, y); // над левым краем секции
            return;
        } catch (e) { /* fallthrough to text */ }
    }
    const text = NAV_TEXT[id] || id;
    ctx.save();
    ctx.setFont('serif', FONT, 'italic');
    if (ctx.setFillStyle) ctx.setFillStyle(COLOR);
    let x = xLeft;
    if (navAlign(id) === 'right') {
        let tw = text.length * FONT * 0.5;
        try { const m = ctx.measureText(text); if (m && m.width > 0) tw = m.width; } catch (e) { /* keep */ }
        x = xRight - tw;
    }
    ctx.fillText(text, x, y);
    ctx.restore();
}

// Отрисовать все навигационные символы. [spec] — аксессоры пайплайна:
//   VF, marks : [{ measure, id }]
//   rowOf(mi)          : строка/система такта (или null)
//   yOf(mark, i)       : Y базовой линии от движка размещения (или null)
//   baselineOf(row,mi) : легаси-фолбэк, если yOf не задан
//   boxOf(mi)          : { x, w } такта (левый край и ширина) или null
//   ctxOf(row)         : графический контекст строки/системы
// Каждый символ рисуется в SVG-группе класса sf-nav (инспектируемость/аудит).
export function drawNavigation(spec) {
    const marks = spec.marks || [];
    for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const r = spec.rowOf(m.measure);
        if (r == null) continue;
        const y = spec.yOf ? spec.yOf(m, i) : spec.baselineOf(r, m.measure);
        if (y == null) continue;
        const box = spec.boxOf(m.measure);
        if (!box) continue;
        const ctx = spec.ctxOf(r);
        if (!ctx) continue;
        const grouped = !!ctx.openGroup;
        if (grouped) ctx.openGroup('sf-nav');
        try {
            drawNavigationMark(spec.VF, ctx, m.id, box.x, box.x + box.w, y);
        } finally {
            if (grouped) ctx.closeGroup();
        }
    }
}

// Навигационные метки партитуры как объекты рендера: [{ measure, id }].
export function readNavigation(measures) {
    const out = [];
    for (let mi = 0; mi < (measures || []).length; mi++) {
        const id = measures[mi] && measures[mi]._nav;
        if (id) out.push({ measure: mi, id: id });
    }
    return out;
}
