// [ScoreFlow engine] Print Vertical Layout — вертикальный профиль КАЖДОЙ
// системы из её СОДЕРЖИМОГО: просвет аколады, нижний резерв под динамику,
// верхний резерв под вольты/темп/навигацию И выступающие ноты. Ничего не
// перекрывается: каждый слой получает место по факту присутствия. Читаемость
// важнее плотности — при нехватке место ДОБАВЛЯЕТСЯ (высота системы растёт),
// а не отбирается у соседей. Модуль ЧИСТЫЙ (без VF/DOM) — тестируется в Node.
//
// Константы динамики зеркалят render/dynamics_layout.js (единый алгоритм
// базовой линии): базовая линия = max(стан+16, низ нот+11); ниже неё глиф
// оттенка опускает хвосты и вилка кладёт клин — резервируем DYN_DESCENT.
import { STAFF_H } from './paper.js';

const GAP_MIN_GRAND = 52;  // мин. просвет между станами аколады (издательский)
const DYN_STAFF_GAP = 16;  // = dynamics_layout.STAFF_GAP
const DYN_NOTE_CLEAR = 11; // = dynamics_layout.NOTE_CLEAR
const DYN_DESCENT = 20;    // хвосты глифов (f, p) + клин вилки (half 8 + drop 8)
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
//   stackOf(mi)— высота столбика верхних меток такта (вольта+темп+навигация)
// Возвращает: { padTop, gapTB, bassDY, padBottom, height }
//   padTop     — резерв над верхней линейкой верхнего стана
//   bassDY     — сдвиг верхней линейки bass от верхней линейки treble (grand)
//   padBottom  — резерв под нижней линейкой нижнего стана
//   height     — полная высота системы
export function systemProfile(spec) {
    const items = spec.items || [];
    let topAbove = 0, topBelow = 0, botAbove = 0, botBelow = 0;
    let dynT = false, dynB = false, stackMax = 0;
    for (let k = 0; k < items.length; k++) {
        const mi = items[k];
        const et = spec.extTop[mi];
        if (et) {
            if (et.above > topAbove) topAbove = et.above;
            if (et.below > topBelow) topBelow = et.below;
        }
        if (spec.extBottom) {
            const eb = spec.extBottom[mi];
            if (eb) {
                if (eb.above > botAbove) botAbove = eb.above;
                if (eb.below > botBelow) botBelow = eb.below;
            }
        }
        if (spec.dynTop && spec.dynTop[mi]) dynT = true;
        if (spec.dynBottom && spec.dynBottom[mi]) dynB = true;
        // Верхние метки такта стоят НАД выступающими нотами этого такта.
        const st = spec.stackOf ? spec.stackOf(mi) : 0;
        const need = st > 0 ? st + (et ? et.above : 0) : (et ? et.above : 0);
        if (need > stackMax) stackMax = need;
    }

    const padTop = Math.max(PAD_TOP_MIN, stackMax + AIR / 2);
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
