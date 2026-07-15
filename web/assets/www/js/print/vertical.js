// [ScoreFlow engine] Print Vertical Layout — вертикальный профиль КАЖДОЙ
// системы из её СОДЕРЖИМОГО: просвет аколады, нижний резерв под динамику,
// верхний резерв под вольты/темп/навигацию И выступающие ноты. Ничего не
// перекрывается: каждый слой получает место по факту присутствия. Читаемость
// важнее плотности — при нехватке место ДОБАВЛЯЕТСЯ (высота системы растёт),
// а не отбирается у соседей. Модуль ЧИСТЫЙ (без VF/DOM) — тестируется в Node.
//
// Константы динамики ИМПОРТИРУЮТСЯ из render/dynamics_layout.js (единый
// алгоритм базовой линии, один источник чисел): базовая линия = max(стан+GAP,
// низ нот+CLEAR); ниже неё глиф оттенка опускает хвосты и вилка кладёт клин —
// резервируем DYN_DESCENT.
import { STAFF_H } from './paper.js';
import {
    DYN_STAFF_GAP, DYN_NOTE_CLEAR, DYN_DESCENT,
} from '../render/dynamics_layout.js';

const GAP_MIN_GRAND = 52;  // мин. просвет между станами аколады (издательский)
const AIR = 6;             // воздух между слоями
const PAD_TOP_MIN = 10;    // мин. верхний резерв системы
const PAD_BOT_MIN = 14;    // мин. нижний резерв системы

// Сколько места нужно ПОД нижней линейкой стана голосу с габаритом [below]
// (выступ нот) и флагом наличия динамики/вилок [hasDyn].
function belowNeed(below, hasDyn) {
    if (!hasDyn) return below + AIR / 2;
    return Math.max(DYN_STAFF_GAP, below + DYN_NOTE_CLEAR) + DYN_DESCENT;
}

// Профиль системы. spec:
//   grand      — аколада (treble+bass) или одиночный стан
//   items      — индексы тактов системы
//   extTop     — габариты { above, below } ВЕРХНЕГО голоса по тактам (весь score)
//   extBottom  — габариты нижнего голоса (bass) или null
//   dynTop     — bool[] наличия динамики/вилок верхнего голоса по тактам
//   dynBottom  — bool[] нижнего голоса или null
//   topReserve — резерв НАД верхней линейкой (px): решение движка размещения
//                (render/top_band.solveTopBand) — выступ нот + вольты + темп +
//                навигация по skyline-профилю, а не сумма слоёв
// Возвращает: { padTop, gapTB, bassDY, padBottom, height }
//   padTop     — резерв над верхней линейкой верхнего стана
//   bassDY     — сдвиг верхней линейки bass от верхней линейки treble (grand)
//   padBottom  — резерв под нижней линейкой нижнего стана
//   height     — полная высота системы
export function systemProfile(spec) {
    const items = spec.items || [];
    let topBelow = 0, botAbove = 0, botBelow = 0;
    let dynT = false, dynB = false;
    for (let k = 0; k < items.length; k++) {
        const mi = items[k];
        const et = spec.extTop[mi];
        if (et && et.below > topBelow) topBelow = et.below;
        if (spec.extBottom) {
            const eb = spec.extBottom[mi];
            if (eb) {
                if (eb.above > botAbove) botAbove = eb.above;
                if (eb.below > botBelow) botBelow = eb.below;
            }
        }
        if (spec.dynTop && spec.dynTop[mi]) dynT = true;
        if (spec.dynBottom && spec.dynBottom[mi]) dynB = true;
    }

    const padTop = Math.max(PAD_TOP_MIN, (spec.topReserve || 0) + AIR / 2);
    if (!spec.grand) {
        const padBottom = Math.max(PAD_BOT_MIN, belowNeed(topBelow, dynT) + AIR / 2);
        return {
            padTop: padTop, gapTB: 0, bassDY: 0, padBottom: padBottom,
            height: padTop + STAFF_H + padBottom,
        };
    }
    // Просвет аколады: под treble должно пройти всё его нижнее содержимое
    // (вкл. динамику между станами) и верхнее содержимое bass.
    const gapTB = Math.max(GAP_MIN_GRAND, belowNeed(topBelow, dynT) + botAbove + AIR);
    const bassDY = STAFF_H + gapTB;
    const padBottom = Math.max(PAD_BOT_MIN, belowNeed(botBelow, dynB) + AIR / 2);
    return {
        padTop: padTop, gapTB: gapTB, bassDY: bassDY, padBottom: padBottom,
        height: padTop + bassDY + STAFF_H + padBottom,
    };
}
