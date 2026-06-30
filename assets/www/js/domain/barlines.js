// [ScoreFlow engine] Barline theory — тип тактовой черты КАЖДОГО такта (её
// ПРАВОЙ границы, end barline) и его проекция на гравировку. ЕДИНОЕ место
// разрешения черт по партитуре: используют и render (экран), и print (PDF) —
// поэтому решение «нативный тип VexFlow vs кастомная отрисовка» не дублируется.
// Прямой аналог domain/keysig (effectiveKeys) и domain/timesig
// (effectiveTimeSignatures): теория здесь, VexFlow-примитивы — в render-слое.
//
// Профессиональная гравировка: где VexFlow умеет тип НАТИВНО (single/double/
// end/none), берём VexFlow (Stave.setEndBarType) — это и корректный спейсинг, и
// глиф «как в движке». Где не умеет (dashed/dotted/tick/short) — рисуем сами
// (render/barlines.js) поверх стана БЕЗ нативной линии (NONE), на той же X, где
// VexFlow поставил бы одиночную черту, сохраняя спейсинг.
//
// Расширяемо БЕЗ редизайна: Repeat Start/End/Both — это нативные типы VexFlow
// (REPEAT_BEGIN/REPEAT_END/REPEAT_BOTH). Добавить их = одна строка в
// BARLINE_SPEC (+ begin-barline-слот в модели для repeat start). Вольты/D.C./
// D.S./Fine/Coda лягут отдельными объектами с тем же позиционным якорем.

// Описание каждого типа: проекция на гравировку.
//   native — ИМЯ типа VexFlow (VF.Barline.type[native]) для setEndBarType, либо
//            null -> рисуем сами.
//   custom — стиль кастомной отрисовки (render/barlines.drawCustomBarline) либо
//            null для нативных типов.
// invisible = нативный NONE: место в раскладке сохраняется (ширину такта задаёт
// наш layout, не черта), линия не рисуется.
export const BARLINE_SPEC = {
    normal: { native: 'SINGLE', custom: null },
    double: { native: 'DOUBLE', custom: null },
    final: { native: 'END', custom: null },
    invisible: { native: 'NONE', custom: null },
    repeatStart: { native: 'REPEAT_BEGIN', custom: null },
    repeatEnd: { native: 'REPEAT_END', custom: null },
    repeatBoth: { native: 'REPEAT_BOTH', custom: null },
    dashed: { native: null, custom: 'dashed' },
    dotted: { native: null, custom: 'dotted' },
    tick: { native: null, custom: 'tick' },
    short: { native: null, custom: 'short' },
};

// Нормализация id черты: неизвестное/пустое/нормальное -> 'normal' (одиночная
// по умолчанию). Зеркало Dart BarlineType.fromId.
export function parseBarline(id) {
    return Object.prototype.hasOwnProperty.call(BARLINE_SPEC, id)
        ? id : 'normal';
}

// Спецификация гравировки по id (нормализуется). Всегда валидный объект.
export function barlineSpec(id) {
    return BARLINE_SPEC[parseBarline(id)];
}

// true, если тип нативный для VexFlow (рисуется через setEndBarType), иначе
// false (кастомная отрисовка в render/barlines).
export function isNativeBarline(id) {
    return barlineSpec(id).native != null;
}

// Тактовая черта правой границы КАЖДОГО такта — массив id по индексу. В отличие
// от тональности/размера черта НЕ тянется вперёд: у каждого такта своя граница.
// Дефолт ПОЗИЦИОННЫЙ: ПОСЛЕДНИЙ такт партитуры без явного `_bar` — финальная
// (завершающая) черта (профессиональная конвенция конца пьесы), прочие —
// обычная. Явный `_bar` (override) переопределяет дефолт. ЕДИНОЕ место чтения
// `_bar` (render/print не лезут в поле напрямую). Зеркало Dart
// Score.effectiveBarlineAt. Возвращает массив длиной measures.length.
export function effectiveBarlines(measures) {
    const ms = measures || [];
    const out = [];
    const last = ms.length - 1;
    for (let i = 0; i < ms.length; i++) {
        const raw = ms[i] && ms[i]._bar;
        const id = (raw == null)
            ? (i === last ? 'final' : 'normal') // позиционный дефолт
            : parseBarline(raw);                // явный override
        out.push(id);
    }
    return out;
}

// Нативный тип VexFlow для id или null (кастомная отрисовка / неизвестный VF).
// VF передаётся параметром — модуль не импортирует VexFlow (как весь domain-слой).
export function nativeBarType(VF, id) {
    const spec = barlineSpec(id);
    if (!spec.native || !VF || !VF.Barline || !VF.Barline.type) return null;
    return VF.Barline.type[spec.native];
}
