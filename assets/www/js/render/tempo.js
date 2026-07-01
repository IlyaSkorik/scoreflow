// [ScoreFlow engine] Tempo rendering — ОБЩИЙ слой отрисовки темповых обозначений
// (♩ = N) для ОБОИХ пайплайнов: экран (render.js) и печать (print.js). Экран и
// PDF рисуют метку ОДНИМ кодом и совпадают визуально.
//
// Метка = нотная головка (noteheadBlack, шрифт-независимо) + штиль вверх + текст
// « = N». Стоит НАД станом (выше вольт, если те есть), у позиции смены темпа.
// Решение «где смена темпа» и её тайминг живут в domain/tempo — здесь только
// геометрия и примитивы (никакой нотационной логики).

const COLOR = '#000000';
const NOTE_SIZE = 22;   // кегль глифа нотной головки
const STEM_H = 13;      // высота штиля вверх
const STEM_W = 1.4;
const FONT = 13;        // кегль текста « = N»

// Вертикальное место (px), которое темповые метки резервируют НАД станом (над
// вольтами). Экран и печать раздвигают систему на эту величину, когда в
// партитуре есть смены темпа. 0 — смен нет.
export function tempoHeadroom(marks) {
    return (marks && marks.length) ? (NOTE_SIZE + 6) : 0;
}

// Нарисовать одну метину « ♩ = bpm ». [x] — левый край головки, [y] — базовая
// линия (низ головки/текста). Головка + штиль вверх + текст справа.
export function drawTempoMark(VF, ctx, x, y, bpm) {
    let headW = NOTE_SIZE * 0.55;
    if (VF && VF.Glyph) {
        try {
            const g = new VF.Glyph('noteheadBlack', NOTE_SIZE);
            if (g.setContext) g.setContext(ctx);
            try { const w = g.getMetrics().width; if (w > 0) headW = w; } catch (e) { /* keep */ }
            g.render(ctx, x, y);
        } catch (e) { /* глиф недоступен — останется штиль+текст */ }
    }
    ctx.save();
    ctx.setLineWidth(STEM_W);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.beginPath();
    const stemX = x + headW - 0.7; // правый край головки
    ctx.moveTo(stemX, y - 1);
    ctx.lineTo(stemX, y - STEM_H);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.setFont('serif', FONT, '');
    if (ctx.setFillStyle) ctx.setFillStyle(COLOR);
    ctx.fillText(' = ' + bpm, x + headW + 2, y);
    ctx.restore();
}

// Отрисовать все темповые метки. [spec] — аксессоры пайплайна:
//   VF, marks : [{ measure, beat, bpm, unit }]
//   rowOf(mi)          : строка/система такта (или null)
//   baselineOf(row,mi) : Y базовой линии метки (пофактовое — зависит от того,
//                        что реально стоит НАД этим тактом; или null)
//   xOf(mi, beat)      : X позиции доли (или null)
//   ctxOf(row)         : графический контекст строки/системы
export function drawTempos(spec) {
    const marks = spec.marks || [];
    for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const r = spec.rowOf(m.measure);
        if (r == null) continue;
        const y = spec.baselineOf(r, m.measure);
        if (y == null) continue;
        const ctx = spec.ctxOf(r);
        if (!ctx) continue;
        const x = spec.xOf(m.measure, m.beat || 0);
        if (x == null) continue;
        drawTempoMark(spec.VF, ctx, x, y, m.bpm);
    }
}
