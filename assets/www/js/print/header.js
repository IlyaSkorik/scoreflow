// [ScoreFlow engine] Print Title Block & Footer — профессиональный титульный
// блок первой страницы (заголовок / подзаголовок / композитор / аранжировщик)
// и футер (номера страниц). Кегли заданы ФИЗИЧЕСКИМИ размерами на бумаге
// (px @96dpi ≈ типографские пункты × 1.33) и переводятся в гравировочные
// единицы через geom.fontU — размер текста НЕ зависит от масштаба стана.
//
// Конвенции изданий (Behind Bars): заголовок по центру; подзаголовок мельче
// под ним; композитор справа (roman), аранжировщик/автор слов слева (мельче);
// номера страниц — в нижнем поле по центру, на первой странице не ставится.

const TITLE_PX = 22;     // ≈ 16.5 pt
const SUBTITLE_PX = 13;  // ≈ 10 pt
const CREDIT_PX = 12;    // композитор/аранжировщик, ≈ 9 pt
const FOOTER_PX = 10;    // номер страницы, ≈ 7.5 pt
const LINE_AIR = 1.35;   // межстрочный коэффициент блока

function widthOf(ctx, str, sizeU) {
    try {
        const w = ctx.measureText(str).width;
        if (w && w > 0) return w;
    } catch (e) { /* fallthrough */ }
    return String(str).length * sizeU * 0.55;
}

// Высота титульного блока (u) — резерв печатной зоны первой страницы.
// 0 — блока нет (ни заголовка, ни кредитов). Считается БЕЗ ctx (для пагинации).
export function titleBlockHeight(geom, score) {
    if (!score) return 0;
    const hasTitle = !!(score.title && String(score.title).trim());
    const hasSubtitle = !!(score.subtitle && String(score.subtitle).trim());
    const hasCredits = !!(score.composer && String(score.composer).trim()) ||
        !!(score.arranger && String(score.arranger).trim());
    if (!hasTitle && !hasSubtitle && !hasCredits) return 0;
    let h = 0;
    if (hasTitle) h += geom.fontU(TITLE_PX) * LINE_AIR;
    if (hasSubtitle) h += geom.fontU(SUBTITLE_PX) * LINE_AIR;
    if (hasCredits) h += geom.fontU(CREDIT_PX) * LINE_AIR;
    return h + geom.fontU(14); // воздух между блоком и первой системой
}

// Отрисовать титульный блок в верхнем поле контента первой страницы.
// Возвращает фактическую высоту (== titleBlockHeight).
export function drawTitleBlock(ctx, geom, score) {
    const H = titleBlockHeight(geom, score);
    if (H <= 0) return 0;
    let y = geom.mtop;
    ctx.save();
    if (ctx.setFillStyle) ctx.setFillStyle('#000000');
    const title = score.title && String(score.title).trim();
    if (title) {
        const size = geom.fontU(TITLE_PX);
        y += size;
        ctx.setFont('serif', size, 'bold');
        ctx.fillText(title, geom.mx + (geom.contentW - widthOf(ctx, title, size)) / 2, y);
        y += size * (LINE_AIR - 1);
    }
    const subtitle = score.subtitle && String(score.subtitle).trim();
    if (subtitle) {
        const size = geom.fontU(SUBTITLE_PX);
        y += size;
        ctx.setFont('serif', size, 'italic');
        ctx.fillText(subtitle, geom.mx + (geom.contentW - widthOf(ctx, subtitle, size)) / 2, y);
        y += size * (LINE_AIR - 1);
    }
    const composer = score.composer && String(score.composer).trim();
    const arranger = score.arranger && String(score.arranger).trim();
    if (composer || arranger) {
        const size = geom.fontU(CREDIT_PX);
        y += size;
        ctx.setFont('serif', size, '');
        if (composer) {
            ctx.fillText(composer,
                geom.mx + geom.contentW - widthOf(ctx, composer, size), y);
        }
        if (arranger) {
            ctx.setFont('serif', size, 'italic');
            ctx.fillText(arranger, geom.mx, y);
        }
    }
    ctx.restore();
    return H;
}

// Футер: номер страницы по центру нижнего поля. Первая страница — без номера
// (её идентифицирует титульный блок).
export function drawFooter(ctx, geom, pageIndex) {
    if (pageIndex === 0) return;
    const size = geom.fontU(FOOTER_PX);
    const label = String(pageIndex + 1);
    ctx.save();
    ctx.setFont('serif', size, '');
    if (ctx.setFillStyle) ctx.setFillStyle('#000000');
    ctx.fillText(label,
        geom.mx + (geom.contentW - widthOf(ctx, label, size)) / 2,
        geom.footerBaseline);
    ctx.restore();
}
