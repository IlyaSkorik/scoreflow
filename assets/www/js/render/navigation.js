// [ScoreFlow engine] Navigation rendering — ОБЩИЙ слой отрисовки навигационных
// символов (Segno/Coda/D.C./D.S./Fine/To Coda) для ОБОИХ пайплайнов: экран
// (render.js) и печать (print.js). Экран и PDF рисуют символы ОДНИМ кодом и
// совпадают визуально.
//
// Symbol NAD станом (выше темпа/вольт). Segno/Coda — SMuFL-глифы (VF.Glyph
// 'segno'/'coda'); остальное — курсивный текст ("D.C. al Fine", "Fine",
// "To Coda", "D.S." …), как в MuseScore/Dorico/Finale. Решение «что где» и
// разворот playback живут в domain/navigation — здесь только геометрия.

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

// Вертикальное место (px), которое ОДИН навигационный символ резервирует НАД
// станом (символы стоят выше темпа/вольт) — ПОФАКТОВОЕ: глиф Segno/Coda рисуется
// ВВЕРХ от базовой линии на ~GLYPH_SIZE, текст (D.C./D.S./Fine/To Coda) — только
// на кегль FONT. Зазор (8) покрывает подъём MARK_GAP, на который render.js/
// print.js ставят базовую линию над нижележащим слоем (вольта/темп), плюс запас.
export function navigationMarkHeadroom(id) {
    return (NAV_GLYPH[id] ? GLYPH_SIZE : FONT) + 8;
}

// Общий резерв по списку меток — максимум пофактовых. 0 — навигации нет.
export function navigationHeadroom(marks) {
    let h = 0;
    for (let i = 0; i < (marks || []).length; i++) {
        const m = navigationMarkHeadroom(marks[i].id);
        if (m > h) h = m;
    }
    return h;
}

// Выравнивание символа по такту: D.C./D.S./Fine/To Coda — над ПРАВЫМ краем
// такта (конец такта — точка перехода/остановки), Segno/Coda — над ЛЕВЫМ краем
// (начало секции). Возвращает 'right' | 'left'.
function navAlign(id) {
    return NAV_GLYPH[id] ? 'left' : 'right';
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
//   baselineOf(row,mi) : Y базовой линии символа (пофактовое; или null)
//   boxOf(mi)          : { x, w } такта (левый край и ширина) или null
//   ctxOf(row)         : графический контекст строки/системы
export function drawNavigation(spec) {
    const marks = spec.marks || [];
    for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const r = spec.rowOf(m.measure);
        if (r == null) continue;
        const y = spec.baselineOf(r, m.measure);
        if (y == null) continue;
        const box = spec.boxOf(m.measure);
        if (!box) continue;
        const ctx = spec.ctxOf(r);
        if (!ctx) continue;
        drawNavigationMark(spec.VF, ctx, m.id, box.x, box.x + box.w, y);
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
