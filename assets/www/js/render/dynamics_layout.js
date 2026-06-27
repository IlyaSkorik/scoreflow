// [ScoreFlow engine] Dynamics Layout — ЧИСТЫЙ алгоритм размещения динамических
// оттенков (engraving). Без VF, DOM, state — поэтому ЭКРАН и ПЕЧАТЬ используют
// ОДИН И ТОТ ЖЕ алгоритм и дают ИДЕНТИЧНЫЕ позиции. Здесь только геометрия:
// где проходит базовая линия оттенков и как обойти столкновения.
//
// Правила (как в MuseScore/Dorico/Finale):
//  - оттенок стоит ПОД станом своего голоса, по ЦЕНТРУ над своей нотой
//    (горизонталь = доля, её НЕ двигаем);
//  - базовая линия ОДНА на «группу» = одна система (строка) + один голос:
//    соседние оттенки НЕ «прыгают» по вертикали;
//  - если в системе есть нотация, свисающая ниже стана (низкие ноты, штили
//    вниз, добавочные линейки, плотные аккорды), вся линия оттенков СДВИГАЕТСЯ
//    ВНИЗ, чтобы пройти под самым низким элементом группы;
//  - [maxBaseline] (опц.) — потолок: для верхнего стана grand staff не пускаем
//    линию на нижний стан.
//
// Геометрию (низы bbox нот, Y линеек) каждый пайплайн добывает по-своему
// (экран — из state.noteHits/staffBottomY; печать — из VF.StaveNote/Stave), но
// СЧИТАЕТ позицию здесь — поэтому экран и PDF совпадают до пикселя.

// Размер глифа оттенка (point size SMuFL). Единый для экрана и печати.
export const DYN_GLYPH_SIZE = 30;

const STAFF_GAP = 16;   // базовый зазор от нижней линейки стана до базовой линии
const NOTE_CLEAR = 11;  // зазор под самым низким элементом нотации группы
const CAP_MARGIN = 6;   // отступ от потолка (верх нижнего стана grand staff)

// Базовая линия оттенков группы (система+голос). [staffBottomY] — Y нижней
// линейки стана; [noteBottoms] — Y низов bbox ВСЕХ нот группы (вкл. без
// оттенка — линия общая); [maxBaseline] — необязательный потолок.
// Берём самое НИЖНЕЕ из: (стан+зазор) и (низ самой низкой ноты+зазор), чтобы
// гарантированно пройти под нотами; затем не глубже потолка.
export function dynamicsBaseline(staffBottomY, noteBottoms, maxBaseline) {
    let low = staffBottomY;
    if (noteBottoms) {
        for (let i = 0; i < noteBottoms.length; i++) {
            if (noteBottoms[i] > low) low = noteBottoms[i];
        }
    }
    let y = Math.max(staffBottomY + STAFF_GAP, low + NOTE_CLEAR);
    if (maxBaseline != null && y > maxBaseline - CAP_MARGIN) {
        y = maxBaseline - CAP_MARGIN;
    }
    return y;
}

// Базовые линии для всех групп разом. [groups] — массив:
//   { key, staffBottomY, noteBottoms, maxBaseline? }
// Возвращает { key -> baselineY }. Удобно вызывать из обоих пайплайнов.
export function dynamicsBaselines(groups) {
    const out = {};
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        out[g.key] = dynamicsBaseline(g.staffBottomY, g.noteBottoms, g.maxBaseline);
    }
    return out;
}
