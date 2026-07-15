// [ScoreFlow engine] Hairpin rendering — ОБЩИЙ слой отрисовки вилок (crescendo
// «<» / diminuendo «>») для ОБОИХ пайплайнов: экран (render/dynamics) и печать
// (print). Экран и PDF рисуют вилки ОДНИМ кодом и совпадают визуально.
//
// Вилка — клин ПОД станом, на ТОЙ ЖЕ базовой линии, что и оттенки того же голоса
// (единый dynamicsBaseline — вилка «читается» вместе с динамикой). Crescendo:
// клин раскрывается слева направо (остриё слева). Diminuendo: сужается. Геометрия
// клина считается ЗДЕСЬ по абсолютным долям (четвертям), а X/Y/ctx каждый
// пайплайн отдаёт своими аксессорами — поэтому нотационной логики тут нет и
// вычисления не дублируются.
//
// Перенос строки/системы: вилка, растянутая на несколько систем, рисуется
// сегментом на каждой; полураскрытие клина на границе системы считается
// пропорционально ДОЛЕ (а не X), поэтому клин непрерывен через разрыв.

import { DYN_HAIRPIN_GAP } from './dynamics_layout.js';

const COLOR = '#000000';
const LINE_W = 1.3;
// Половина раствора клина на широком конце (px) по умолчанию (экран).
// Полная высота устья = 2×. Центр клина опускается ниже базовой линии на
// полураствор, чтобы не наезжать на глифы динамики (рисуются вверх от линии).
export const HAIRPIN_HALF = 5;

// Нарисовать участок клина между xa..xb с полураствором halfA/halfB вокруг центра
// [yc]. Две симметричные линии (верхняя и нижняя грань клина). Рисуется в
// SVG-группе класса sf-hairpin (инспектируемость/аудит).
export function drawHairpinPart(ctx, xa, xb, yc, halfA, halfB) {
    const grouped = !!ctx.openGroup;
    if (grouped) ctx.openGroup('sf-hairpin');
    ctx.save();
    ctx.setLineWidth(LINE_W);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xa, yc - halfA); ctx.lineTo(xb, yc - halfB);
    ctx.moveTo(xa, yc + halfA); ctx.lineTo(xb, yc + halfB);
    ctx.stroke();
    ctx.restore();
    if (grouped) ctx.closeGroup();
}

// Отрисовать все вилки. [spec] — аксессоры пайплайна:
//   hairpins   : [{ type, voice, startMeasure, startBeat, endMeasure, endBeat }]
//   starts     : абсолютные старты тактов в четвертях (длина n+1)
//   rowOf(mi)  : строка/система такта (или null)
//   geomOf(mi) : { x, w } такта в его системе (или null)
//   baselineOf(row, voice) : Y базовой линии оттенков группы (или null)
//   xAtBeat(mi, voice, localBeat) : X доли внутри такта (или null)
//   ctxOf(row) : графический контекст этой строки/системы
//   half (опц.)             : полураствор устья (по умолчанию HAIRPIN_HALF);
//                             печать просит больший — издательский раствор
//                             клина (~3 мм) при гравировочном масштабе
//   obstaclesOf(row, voice) (опц.) : габариты [{x0,x1}] глифов динамики на той
//                             же базовой линии — торец клина, упирающийся в
//                             глиф («p < f»), отступает от него на зазор
// Вилка, попавшая на несколько систем, режется по строкам; полураствор на каждом
// конце сегмента = half × доля_положения (для crescendo — растёт слева
// направо, для diminuendo — наоборот), поэтому клин непрерывен через разрыв.
export function drawHairpins(spec) {
    const hairpins = spec.hairpins || [];
    const starts = spec.starts || [];
    const half = spec.half || HAIRPIN_HALF;
    const drop = half; // клин целиком ниже базовой линии (не наезжает на глифы)
    for (let i = 0; i < hairpins.length; i++) {
        const h = hairpins[i];
        const em = h.endMeasure;
        if (starts[h.startMeasure] == null || starts[em] == null) continue;
        const startAbs = starts[h.startMeasure] + (h.startBeat || 0);
        const endAbs = starts[em] + (h.endBeat || 0);
        const total = endAbs - startAbs;
        if (!(total > 1e-9)) continue;
        const r0 = spec.rowOf(h.startMeasure);
        const r1 = spec.rowOf(em);
        if (r0 == null || r1 == null) continue;
        const lo = r0 < r1 ? r0 : r1;
        const hi = r0 < r1 ? r1 : r0;
        for (let r = lo; r <= hi; r++) {
            let lm = -1, rm = -1;
            for (let mi = h.startMeasure; mi <= em; mi++) {
                if (spec.rowOf(mi) === r) { if (lm < 0) lm = mi; rm = mi; }
            }
            if (lm < 0) continue;
            const base = spec.baselineOf(r, h.voice);
            if (base == null) continue;
            const ctx = spec.ctxOf(r);
            if (!ctx) continue;
            const gLm = spec.geomOf(lm), gRm = spec.geomOf(rm);
            if (!gLm || !gRm) continue;
            const atStart = (lm === h.startMeasure), atEnd = (rm === em);
            let xa = atStart ? spec.xAtBeat(h.startMeasure, h.voice, h.startBeat || 0) : gLm.x;
            let xb = atEnd ? spec.xAtBeat(em, h.voice, h.endBeat || 0) : (gRm.x + gRm.w);
            if (xa == null || xb == null || xb <= xa) continue;
            // Торцы клина не касаются глифов динамики на той же базовой линии
            // (издательское «p < f»): конец, упирающийся в глиф, отступает.
            if (spec.obstaclesOf) {
                const obs = spec.obstaclesOf(r, h.voice) || [];
                for (let k = 0; k < obs.length; k++) {
                    const o = obs[k];
                    if (o.x1 <= xa || o.x0 >= xb) continue;
                    if (o.x0 <= xa) xa = o.x1 + DYN_HAIRPIN_GAP;
                    if (o.x1 >= xb) xb = o.x0 - DYN_HAIRPIN_GAP;
                }
                if (xb <= xa) continue;
            }
            const beatA = atStart ? startAbs : starts[lm];
            const beatB = atEnd ? endAbs : starts[rm + 1];
            const fA = (beatA - startAbs) / total;
            const fB = (beatB - startAbs) / total;
            const gapA = half * (h.type === 'diminuendo' ? (1 - fA) : fA);
            const gapB = half * (h.type === 'diminuendo' ? (1 - fB) : fB);
            drawHairpinPart(ctx, xa, xb, base + drop, gapA, gapB);
        }
    }
}
