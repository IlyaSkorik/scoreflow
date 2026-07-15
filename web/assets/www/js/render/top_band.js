// [ScoreFlow engine] Top Band — сборка ВЕРХНЕЙ полосы полосы/системы (вольты →
// темп → навигация) для движка размещения (placement.js). ОБЩИЙ код экрана
// (render.js) и печати (print.js): оба пайплайна дают одинаковые правила
// стекинга и зазоры — расходится только источник геометрии (boxOf/anchorXOf).
//
// Каждый объект полосы получает РЕАЛЬНЫЙ габарит (bounding box):
//   вольта     — сегмент по тактам полосы, свес крюка/номера (voltas.js);
//   темп       — гравированная нота + « = N» (tempoMarkExtents: пробная
//                отрисовка, точные флажок/точки/текст);
//   навигация  — глиф Segno/Coda или текст (navigationMarkExtents: глифы
//                реально СВИСАЮТ ниже базовой линии — меряем, не угадываем).
//
// РЕЗЕРВИРОВАНИЕ и ОТРИСОВКА используют ОДНУ сборку: до отрисовки якорь ноты
// неизвестен — anchorXOf возвращает null, и метка консервативно «занимает весь
// такт + свою ширину» (монотонность skyline гарантирует, что точное размещение
// уложится в резерв); при отрисовке якоря точные — метки садятся максимально
// низко без столкновений.
import { placeTopBand } from './placement.js';
import { voltaSegmentDrop, VOLTA_CLEAR } from './voltas.js';
import { tempoMarkExtents } from './tempo.js';
import { navigationMarkExtents } from './navigation.js';

// Горизонтальный воздух вокруг темпа/навигации: соседние метки (Segno и ♩=N
// одного такта) либо расходятся по горизонтали минимум на 2×PAD_X, либо
// встают в столбик — «впритык» не бывает.
const PAD_X = 3;

// Решить верхнюю полосу. [spec]:
//   VF, ctx      — для измерения габаритов меток (ctx может быть null — оценки)
//   staffTop     — y верхней линейки верхнего стана (0 для резервирования)
//   measures     — индексы тактов полосы
//   boxOf(mi)    — { x, w } такта или null (не в полосе)
//   aboveOf(mi)  — выступ нот над верхней линейкой, px (модельный/измеренный)
//   voltas       — ВСЕ спаны domain/voltas (сегментируются по boxOf)
//   tempoMarks   — метки темпа ЭТОЙ полосы [{ measure, beat, bpm, unit }]
//   navMarks     — символы навигации ЭТОЙ полосы [{ measure, id }]
//   anchorXOf(mark) — точный X якоря метки темпа или null (резервирование)
// Возвращает { padTop, voltaYOf(s), tempoYOf(i), navYOf(i) } — Y опорных линий
// по индексам исходных списков (s — индекс спана в voltas).
export function solveTopBand(spec) {
    const boxOf = spec.boxOf;
    const profile = [];
    for (let k = 0; k < spec.measures.length; k++) {
        const mi = spec.measures[k];
        const b = boxOf(mi);
        if (!b) continue;
        const above = spec.aboveOf ? spec.aboveOf(mi) : 0;
        if (above > 0) profile.push({ x0: b.x, x1: b.x + b.w, above: above });
    }

    // Вольты: сегмент спана s в этой полосе (как drawVoltasInBand).
    const voltaObjs = [];
    const spans = spec.voltas || [];
    for (let s = 0; s < spans.length; s++) {
        const sp = spans[s];
        let first = -1, last = -1;
        for (let mi = sp.start; mi <= sp.end; mi++) {
            if (boxOf(mi)) { if (first < 0) first = mi; last = mi; }
        }
        if (first < 0) continue;
        const b0 = boxOf(first), b1 = boxOf(last);
        const hasLabel = (first === sp.start) && !!sp.label;
        voltaObjs.push({
            key: 'v' + s, x0: b0.x, x1: b1.x + b1.w,
            rise: 0, drop: voltaSegmentDrop(hasLabel),
        });
    }

    // Темп: точный якорь (отрисовка) или консервативно весь такт (резерв).
    const tempoObjs = [];
    const tempos = spec.tempoMarks || [];
    for (let i = 0; i < tempos.length; i++) {
        const m = tempos[i];
        const b = boxOf(m.measure);
        if (!b) continue;
        const ext = tempoMarkExtents(spec.VF, spec.ctx, m);
        const ax = spec.anchorXOf ? spec.anchorXOf(m) : null;
        const x0 = ax != null ? ax : b.x;
        const x1 = ax != null ? ax + ext.width : b.x + b.w + ext.width;
        tempoObjs.push({ key: 't' + i, x0: x0 - PAD_X, x1: x1 + PAD_X,
            rise: ext.rise, drop: ext.drop });
    }

    // Навигация: глиф у левого края такта, текст — у правого.
    const navObjs = [];
    const navs = spec.navMarks || [];
    for (let i = 0; i < navs.length; i++) {
        const m = navs[i];
        const b = boxOf(m.measure);
        if (!b) continue;
        const ext = navigationMarkExtents(spec.VF, spec.ctx, m.id);
        const x0 = ext.align === 'right' ? (b.x + b.w - ext.width) : b.x;
        navObjs.push({ key: 'n' + i, x0: x0 - PAD_X, x1: x0 + ext.width + PAD_X,
            rise: ext.rise, drop: ext.drop });
    }

    const solved = placeTopBand({
        staffTop: spec.staffTop,
        profile: profile,
        voltas: voltaObjs,
        tempos: tempoObjs,
        navs: navObjs,
        gaps: { volta: VOLTA_CLEAR },
    });
    return {
        padTop: solved.padTop,
        voltaYOf: function (s) {
            const y = solved.y['v' + s];
            return y == null ? null : y;
        },
        tempoYOf: function (i) {
            const y = solved.y['t' + i];
            return y == null ? null : y;
        },
        navYOf: function (i) {
            const y = solved.y['n' + i];
            return y == null ? null : y;
        },
    };
}
