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

// === Grand staff (аколада) ==========================================
// На фортепиано тактовая черта — ОДНА сплошная через ВСЮ аколаду (верх верхнего
// стана → низ нижнего), а НЕ две отдельные на каждом стане. Поэтому per-stave
// линии гасим (setupGrandBarline -> NONE), а спан рисуем через VexFlow
// StaveConnector (нативные типы) или своей линией (кастартные) — так черта
// непрерывна через зазор между станами, как требует гравировка.

// Тип правого коннектора VexFlow по нативному типу барлайна (single/double/
// final). Двойная = THIN_DOUBLE (две тонкие), финальная = BOLD_DOUBLE_RIGHT
// (тонкая+толстая). null -> коннектор не рисуем (невидимая).
const GRAND_CONNECTOR = {
    SINGLE: 'SINGLE_RIGHT',
    DOUBLE: 'THIN_DOUBLE',
    END: 'BOLD_DOUBLE_RIGHT',
    NONE: null, // invisible — место есть, линии нет
};

// Погасить нативные правые черты ОБОИХ станов аколады ДО их отрисовки — спан
// рисуем сами (drawGrandBarline). Вызывать до draw.
export function setupGrandBarline(VF, topStave, bottomStave) {
    const none = VF.Barline.type.NONE;
    topStave.setEndBarType(none);
    bottomStave.setEndBarType(none);
}

// Нарисовать тактовую черту через всю аколаду на правой границе. Нативные типы —
// StaveConnector (single/double/final), невидимая — ничего. Кастартные —
// своей линией: dashed/dotted тянутся через всю аколаду; tick/short остаются
// короткими у верхнего стана (короткие по определению). Вызывать ПОСЛЕ draw.
export function drawGrandBarline(VF, ctx, topStave, bottomStave, id) {
    const spec = barlineSpec(id);
    if (spec.native) {
        const connName = GRAND_CONNECTOR[spec.native];
        if (!connName) return; // невидимая / неизвестный — линии нет
        const c = new VF.StaveConnector(topStave, bottomStave);
        c.setType(VF.StaveConnector.type[connName]);
        c.setContext(ctx).draw();
        return;
    }
    const x = topStave.getX() + topStave.getWidth();
    const yTop = topStave.getYForLine(0);
    const yBot = bottomStave.getYForLine(4); // низ нижнего стана аколады
    const space = topStave.getYForLine(1) - yTop;
    switch (spec.custom) {
        case 'dashed':
            strokeVertical(ctx, x, yTop, yBot, [5, 3.2]);
            break;
        case 'dotted':
            dottedVertical(ctx, x, yTop, yBot, space);
            break;
        case 'tick':
            strokeVertical(ctx, x, yTop - space, yTop + space, null);
            break;
        case 'short':
            // Короткая черта по середине ВЕРХНЕГО стана (lines 1..3).
            strokeVertical(ctx, x, topStave.getYForLine(1),
                topStave.getYForLine(3), null);
            break;
    }
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
