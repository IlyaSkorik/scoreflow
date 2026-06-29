// [ScoreFlow engine] Barline rendering — ОБЩИЙ слой отрисовки тактовых черт для
// ОБОИХ пайплайнов: экран (render.js) и печать (print.js). Поэтому экран и PDF
// рисуют черты ОДНИМ кодом и совпадают визуально.
//
// Два шага вокруг stave.draw():
//   setupBarline(...)       — ДО draw: ставит НАТИВНЫЙ тип VexFlow на правую
//                             границу стана (single/double/end), либо NONE для
//                             кастомных/невидимой (VexFlow не рисует линию).
//   drawCustomBarline(...)  — ПОСЛЕ draw: рисует кастартную черту (dashed/dotted/
//                             tick/short) на той же X, где была бы одиночная
//                             линия. Для нативных типов — ничего (нарисовал VexFlow).
//
// Решение «какой тип нативный, какой кастомный» живёт в domain/barlines — здесь
// только VexFlow-примитивы (никакой нотационной логики).
import { barlineSpec, nativeBarType } from '../domain/barlines.js';

const COLOR = '#000000'; // как линии стана — чёрный

// Применить тип правой границы стана ДО stave.draw(). Нативный тип -> VexFlow
// рисует его сам; кастомный/невидимый -> NONE (линию рисуем мы / не рисуем).
// [id] — нормализованный id черты ('normal'/'double'/'final'/'dashed'/…).
export function setupBarline(VF, stave, id) {
    const spec = barlineSpec(id);
    const t = spec.native ? nativeBarType(VF, id) : VF.Barline.type.NONE;
    if (t != null) stave.setEndBarType(t);
}

// Нарисовать КАСТОМНУЮ тактовую черту (dashed/dotted/tick/short) на правой
// границе [stave]. Для нативных типов — no-op (их рисует VexFlow в stave.draw()).
// Вызывать ПОСЛЕ stave.draw(). Геометрию берём из стана (X правой границы и Y
// линеек) — поэтому черта стоит ровно там, где VexFlow рисует одиночную линию.
export function drawCustomBarline(VF, ctx, stave, id) {
    const style = barlineSpec(id).custom;
    if (!style) return;
    const x = stave.getX() + stave.getWidth();
    const yTop = stave.getYForLine(0);
    const yBot = stave.getYForLine(4);
    const space = stave.getYForLine(1) - yTop; // межлинейный интервал стана
    switch (style) {
        case 'dashed':
            strokeVertical(ctx, x, yTop, yBot, [5, 3.2]);
            break;
        case 'dotted':
            dottedVertical(ctx, x, yTop, yBot, space);
            break;
        case 'tick':
            // Короткая черта у ВЕРХА стана: ~по интервалу выше и ниже верхней
            // линии (как «tick barline» в MuseScore/Gould).
            strokeVertical(ctx, x, yTop - space, yTop + space, null);
            break;
        case 'short':
            // Частичная черта по СЕРЕДИНЕ стана: со 2-й по 4-ю линию (внутренние
            // два интервала) — «short barline».
            strokeVertical(ctx, x, stave.getYForLine(1), stave.getYForLine(3), null);
            break;
    }
}

// Сплошная/штриховая вертикаль x:[y0..y1]. [dash] — массив длин (штрих/пробел)
// или null для сплошной. Атрибуты dash/cap сбрасываем явно (save/restore движка
// не гарантирует их восстановление между бэкендами).
function strokeVertical(ctx, x, y0, y1, dash) {
    ctx.save();
    ctx.setLineWidth(1.4);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (dash && ctx.setLineDash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();
}

// Точечная вертикаль — круглые точки через круглый торец и почти нулевые штрихи
// (стандартный приём SVG: dasharray [≈0, gap] + line-cap round = ряд точек).
// Диаметр точки = толщине линии.
function dottedVertical(ctx, x, y0, y1, space) {
    ctx.save();
    ctx.setLineWidth(2.4);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (ctx.setLineCap) ctx.setLineCap('round');
    if (ctx.setLineDash) ctx.setLineDash([0.01, space * 0.5]);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    if (ctx.setLineCap) ctx.setLineCap('butt');
    ctx.restore();
}
