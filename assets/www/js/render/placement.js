// [ScoreFlow engine] Placement Engine — ОБЩИЙ решатель размещения нотационных
// объектов НАД станом (вольты, темп, навигация) для ОБОИХ пайплайнов: экран
// (render.js) и печать (print.js). Модуль ЧИСТЫЙ (без VF/DOM) — тестируется в
// Node.
//
// Идея (как в Dorico/MuseScore): вместо суммирования фиксированных «резервов
// слоёв» ведём SKYLINE — верхний профиль занятого пространства по X. Каждый
// объект знает свой ГАБАРИТ (bounding box: [x0..x1], подъём rise над опорной
// линией и свес drop под ней) и ставится НАД профилем ровно там, где он
// реально стоит по горизонтали. Следствия:
//   • объекты над РАЗНЫМИ тактами не раздвигают друг друга (профиль локален);
//   • объекты над ОДНИМ тактом складываются в столбик с зазором;
//   • текст, выступающий за границу такта (темп у правого края), честно
//     конфликтует с соседним тактом — и поднимется над его вольтой;
//   • высокие ноты (добавочные линейки) приподнимают ВСЁ, что стоит над ними,
//     потому что входят в профиль (см. profile у placeTopBand).
//
// Монотонность: сужение габарита объекта или понижение профиля НИКОГДА не
// поднимает размещение. Поэтому резервирование места (до отрисовки, когда
// точные якоря нот неизвестны) можно делать КОНСЕРВАТИВНЫМИ габаритами
// (объект «занимает весь такт») — фактическая отрисовка точными габаритами
// гарантированно уложится в резерв.

// Вертикальная ось экрана/печати: y растёт ВНИЗ. «Выше» = меньший y.
// Skyline хранит МИНИМАЛЬНЫЙ занятый y (верх занятого пространства) по X.
export class TopSkyline {
    // [baseY] — начальный уровень профиля (обычно верхняя линейка стана).
    constructor(baseY) {
        this.segs = [{ x0: -Infinity, x1: Infinity, y: baseY }];
        this.base = baseY;
    }

    // Верх занятого пространства на диапазоне [x0..x1] (минимальный y).
    topAt(x0, x1) {
        let top = Infinity;
        for (let i = 0; i < this.segs.length; i++) {
            const s = this.segs[i];
            if (s.x1 <= x0 || s.x0 >= x1) continue;
            if (s.y < top) top = s.y;
        }
        return top === Infinity ? this.base : top;
    }

    // Поднять профиль на [x0..x1] до уровня y (только вверх: y меньше текущего).
    raise(x0, x1, y) {
        if (!(x1 > x0)) return;
        const out = [];
        for (let i = 0; i < this.segs.length; i++) {
            const s = this.segs[i];
            if (s.x1 <= x0 || s.x0 >= x1) { out.push(s); continue; }
            if (s.x0 < x0) out.push({ x0: s.x0, x1: x0, y: s.y });
            const a = Math.max(s.x0, x0), b = Math.min(s.x1, x1);
            out.push({ x0: a, x1: b, y: Math.min(s.y, y) });
            if (s.x1 > x1) out.push({ x0: x1, x1: s.x1, y: s.y });
        }
        this.segs = out;
    }

    // Самая высокая точка всего профиля (минимальный y).
    min() {
        let m = Infinity;
        for (let i = 0; i < this.segs.length; i++) {
            if (this.segs[i].y < m) m = this.segs[i].y;
        }
        return m;
    }
}

// Поставить объект НАД профилем. Объект описан габаритом [x0..x1] и
// вертикалью вокруг ОПОРНОЙ линии (базовая линия текста / линия вольты):
// rise — насколько объект поднимается НАД опорной линией, drop — свес ПОД ней.
// [gap] — воздух между низом объекта и профилем. Возвращает y опорной линии и
// поднимает профиль до верха объекта.
export function placeAbove(sky, x0, x1, rise, drop, gap) {
    const top = sky.topAt(x0, x1);
    const refY = top - (gap || 0) - (drop || 0);
    sky.raise(x0, x1, refY - (rise || 0));
    return refY;
}

// --- Верхняя полоса системы: вольты -> темп -> навигация ---------------------
//
// spec:
//   staffTop  — y верхней линейки верхнего стана полосы (0 для резервирования)
//   profile   — занято НАД станом ещё до меток: [{ x0, x1, above }] — ноты выше
//               верхней линейки (добавочные линейки, штили). above ≥ 0 в px.
//   voltas    — сегменты вольт ЭТОЙ полосы (в порядке отрисовки):
//               [{ key, x0, x1, drop }] (drop: крюк/номер под линией)
//   tempos    — темповые метки: [{ key, x0, x1, rise, drop }]
//   navs      — навигационные символы: [{ key, x0, x1, rise, drop }]
//   gaps      — { volta, mark } воздух под слоями (см. константы ниже)
//
// Возвращает { y: {key -> y опорной линии}, padTop } — padTop: сколько места
// занято над staffTop (для резервирования высоты строки/системы).
export const VOLTA_STAFF_CLEAR = 10; // низ крюка вольты ~1 промежуток над станом
export const MARK_GAP = 6;           // воздух под темпом/навигацией

export function placeTopBand(spec) {
    const sky = new TopSkyline(spec.staffTop);
    const profile = spec.profile || [];
    for (let i = 0; i < profile.length; i++) {
        const p = profile[i];
        if (p.above > 0) sky.raise(p.x0, p.x1, spec.staffTop - p.above);
    }
    const gaps = spec.gaps || {};
    const gapVolta = gaps.volta != null ? gaps.volta : VOLTA_STAFF_CLEAR;
    const gapMark = gaps.mark != null ? gaps.mark : MARK_GAP;
    const y = {};
    // Вольты — общий «рельс» полосы: сегменты соседних концовок (1./2.) стоят
    // на ОДНОЙ высоте (издательская конвенция — линия вольты не «ступенится»
    // внутри системы). Уровень диктует самый требовательный сегмент.
    const voltas = spec.voltas || [];
    if (voltas.length) {
        let rail = Infinity;
        for (let i = 0; i < voltas.length; i++) {
            const o = voltas[i];
            const ref = sky.topAt(o.x0, o.x1) - gapVolta - (o.drop || 0);
            if (ref < rail) rail = ref;
        }
        for (let i = 0; i < voltas.length; i++) {
            const o = voltas[i];
            y[o.key] = rail;
            sky.raise(o.x0, o.x1, rail - (o.rise || 0));
        }
    }
    const place = function (list, gap) {
        for (let i = 0; i < (list || []).length; i++) {
            const o = list[i];
            y[o.key] = placeAbove(sky, o.x0, o.x1, o.rise || 0, o.drop || 0, gap);
        }
    };
    place(spec.tempos, gapMark);
    place(spec.navs, gapMark);
    return { y: y, padTop: Math.max(0, spec.staffTop - sky.min()) };
}
