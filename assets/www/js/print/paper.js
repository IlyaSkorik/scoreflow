// [ScoreFlow engine] Print Paper Geometry — ЕДИНСТВЕННЫЙ источник геометрии
// печатной страницы. Всё считается ОТ БУМАГИ (мм) и целевого гравировочного
// размера стана, НИКОГДА от экрана/редактора: печать и редактирование — разные
// продукты с разными оптимизациями (см. render/print.js).
//
// Модель координат: вся партитура верстается в «гравировочных единицах» (u) —
// родных единицах VexFlow (высота стана = 40 u). Страница-SVG получает
// физический размер в CSS-px (96 dpi) и viewBox в единицах, т.е. масштаб
// применяется ОДНИМ вектором (viewBox), без масштабирующих групп и без
// пересчёта координат в слоях отрисовки.
//
// Целевой размер стана НА БУМАГЕ — 7.0 мм (издательский стандарт сольного
// фортепиано: rastral №3–4, 7.0–7.4 мм; Behind Bars, E. Gould). Отсюда масштаб:
//   scale = px(7.0 мм) / 40 u  ≈ 0.66
// Больше нот на строке, издательская плотность вместо экранной крупности.
// Модуль ЧИСТЫЙ (без VF/DOM) — тестируется в Node.

const MM_PER_INCH = 25.4;
const CSS_DPI = 96; // CSS px на дюйм (стандарт печати браузера)

export function mm2px(mm) { return (mm * CSS_DPI) / MM_PER_INCH; }

// Бумага. Другие форматы добавляются записью с размерами в мм.
export const PAPERS = {
    a4: { widthMm: 210, heightMm: 297 },
};

// Высота стана VexFlow в родных единицах (4 промежутка × 10 u).
export const STAFF_H = 40;

// Целевая высота стана на бумаге, мм.
const STAFF_HEIGHT_MM = 7.0;

// Поля страницы, мм (издательские поля нотных изданий A4).
const MARGIN_MM = { left: 14, right: 14, top: 13, bottom: 13 };

// Полоса футера (номер страницы) — внутри нижнего поля, мм от нижнего края.
const FOOTER_BASELINE_MM = 7;

// Полная геометрия страницы в гравировочных единицах (u) + физика (px).
// [paper] — ключ PAPERS (по умолчанию 'a4').
export function paperGeometry(paper) {
    const p = PAPERS[paper || 'a4'] || PAPERS.a4;
    const pageWpx = mm2px(p.widthMm);
    const pageHpx = mm2px(p.heightMm);
    const scale = mm2px(STAFF_HEIGHT_MM) / STAFF_H; // px на 1 u
    const u = function (px) { return px / scale; };
    const W = u(pageWpx);
    const H = u(pageHpx);
    const mx = u(mm2px(MARGIN_MM.left));
    const mtop = u(mm2px(MARGIN_MM.top));
    const mbot = u(mm2px(MARGIN_MM.bottom));
    return {
        scale: scale,                    // px / u — только для viewBox
        pageWpx: pageWpx, pageHpx: pageHpx,
        W: W, H: H,                      // страница в u
        mx: mx, mtop: mtop, mbot: mbot,  // поля в u
        contentW: W - 2 * mx,            // печатная зона
        contentH: H - mtop - mbot,
        footerBaseline: H - u(mm2px(FOOTER_BASELINE_MM)),
        // Перевод «физический px на бумаге» -> u (кегли печатных шрифтов).
        fontU: function (px) { return px / scale; },
    };
}
