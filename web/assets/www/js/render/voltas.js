// [ScoreFlow engine] Volta rendering — ОБЩИЙ слой отрисовки вольт (первая/вторая
// концовка) для ОБОИХ пайплайнов: экран (render.js) и печать (print.js). Экран и
// PDF рисуют скобки ОДНИМ кодом и совпадают визуально.
//
// Вольта — горизонтальная скобка НАД верхним станом с:
//   • левым вертикальным крюком (начало концовки),
//   • номером концовки ("1.", "2." …) у левого края,
//   • правым вертикальным крюком (только у «закрытой» концовки — не последней).
// Решение «какая вольта где» и «закрыта ли» живёт в domain/voltas — здесь только
// геометрия и примитивы рисования (никакой нотационной логики).
//
// Перенос строки/системы: вольта-диапазон, попавший на несколько систем,
// рисуется отдельным сегментом на каждой системе. Левый крюк и номер — только на
// системе, где концовка НАЧИНАется; правый крюк — только на системе, где она
// заканчивается (и только если закрыта). Продолжение на новой системе — без
// номера (профессиональная конвенция).

const COLOR = '#000000';
const HOOK = 11;        // длина вертикального крюка вниз (к стану)
const LINE_W = 1.4;     // толщина скобки
const STAFF_CLEAR = 10; // зазор между НИЗОМ крюка и верхней линейкой стана —
                        // скобка целиком НАД станом, крюки в него не входят
                        // (~1 промежуток стана — издательская посадка)
const NUM_DX = 7;       // сдвиг номера вправо от левого крюка (отступ слева)
const NUM_TOP = 3;      // отступ номера вниз от горизонтальной линии (сверху)
const FONT = 12;        // кегль номера концовки

// Уровень линии скобки над верхней линейкой стана БЕЗ движка размещения
// (легаси-фолбэк drawVoltasInBand): линия на (STAFF_CLEAR + HOOK) выше линейки.
const BRACKET_ABOVE = STAFF_CLEAR + HOOK;

// Свес сегмента вольты ПОД линией скобки (для движка размещения): крюки идут
// вниз на HOOK; номер концовки («1.») опускается ниже (NUM_TOP + кегль).
export function voltaSegmentDrop(hasLabel) {
    return hasLabel ? Math.max(HOOK, NUM_TOP + FONT) : HOOK;
}

// Зазор между низом свеса вольты и профилем под ней (крюки «смотрят» на стан
// с издательской посадкой ~1 промежуток). Использует движок размещения.
export const VOLTA_CLEAR = STAFF_CLEAR;

// Нарисовать один сегмент вольты. [x0,x1] — левый/правый край скобки, [y] —
// уровень горизонтальной линии. leftHook/rightHook — рисовать ли вертикальные
// крюки; [label] — текст номера или '' (не рисовать).
export function drawVoltaSegment(ctx, x0, x1, y, label, leftHook, rightHook) {
    const grouped = !!ctx.openGroup;
    if (grouped) ctx.openGroup('sf-volta');
    ctx.save();
    ctx.setLineWidth(LINE_W);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    if (leftHook) { ctx.moveTo(x0, y); ctx.lineTo(x0, y + HOOK); }
    if (rightHook) { ctx.moveTo(x1, y); ctx.lineTo(x1, y + HOOK); }
    ctx.stroke();
    ctx.restore();
    if (label) {
        ctx.save();
        ctx.setFont('serif', FONT, '');
        if (ctx.setFillStyle) ctx.setFillStyle(COLOR);
        // Номер — под линией, в «коробке» между линией и низом крюка (над станом),
        // с отступом от левого крюка (NUM_DX) и от линии сверху (NUM_TOP).
        ctx.fillText(label, x0 + NUM_DX, y + NUM_TOP + FONT);
        ctx.restore();
    }
    if (grouped) ctx.closeGroup();
}

// Отрисовать вольты для ОДНОЙ полосы (строка экрана / система печати).
// [spans] — из domain/voltas.effectiveVoltas (весь список; сегмент рисуется
// только если вольта пересекается с полосой). [boxOf] — функция mi -> {x, w}
// (левый край и ширина такта) ЛИБО null, если такта нет в этой полосе. [topLineY]
// — Y верхней линейки верхнего стана полосы. [yOfSpan] (опц.) — s -> Y линии
// скобки от движка размещения (пофактовое, над высокими нотами); без него —
// легаси-уровень BRACKET_ABOVE над линейкой.
export function drawVoltasInBand(ctx, spans, boxOf, topLineY, yOfSpan) {
    if (!spans || !spans.length || topLineY == null) return;
    for (let s = 0; s < spans.length; s++) {
        const sp = spans[s];
        let first = -1, last = -1;
        for (let mi = sp.start; mi <= sp.end; mi++) {
            if (boxOf(mi)) { if (first < 0) first = mi; last = mi; }
        }
        if (first < 0) continue; // вольта не попадает в эту полосу
        const y = (yOfSpan && yOfSpan(s) != null)
            ? yOfSpan(s) : topLineY - BRACKET_ABOVE;
        const b0 = boxOf(first);
        const b1 = boxOf(last);
        const x0 = b0.x;
        const x1 = b1.x + b1.w;
        const leftHook = (first === sp.start);
        const rightHook = (last === sp.end) && sp.closed;
        const label = leftHook ? sp.label : '';
        drawVoltaSegment(ctx, x0, x1, y, label, leftHook, rightHook);
    }
}
