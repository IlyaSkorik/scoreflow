// [ScoreFlow engine] Pitch resolution — ЕДИНСТВЕННОЕ место расчёта реальной
// (звучащей) высоты ноты. Высота = ступень + тональность + записанный знак
// альтерации + правила такта (накопление знаков в пределах такта). Движок
// получает natural-aware ключи VexFlow ("f#/4","fn/4","f/4","f##/4"); резолвер
// разбирает их и комбинирует с тональностью и состоянием такта.
export const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Разбор ключа VexFlow в компоненты: {step, suffix, octave, head}.
//  "f#/4"   -> { step:'f', suffix:'#',  octave:4, head:null }
//  "fn/4"   -> { step:'f', suffix:'n',  octave:4, head:null }  (бекар)
//  "g/5/x2" -> { step:'g', suffix:'',   octave:5, head:'x2' }  (ударные)
export function parseKey(key) {
    const parts = String(key).split('/');
    const la = (parts[0] || 'c').toLowerCase();
    const step = la[0] || 'c';
    const suffix = la.slice(1); // '', '#', 'b', '##', 'bb', 'n'
    const octave = parseInt(parts[1], 10);
    const head = parts.length > 2 ? parts[2] : null;
    return { step: step, suffix: suffix, octave: octave, head: head };
}

// Записанный знак (суффикс ключа) -> { shift, explicit }. explicit=true, если
// знак записан явно (включая бекар 'n', сдвиг которого 0, но он СБРАСЫВАЕТ
// тональность/предыдущие знаки такта). Пустой суффикс -> неявно (по контексту).
function writtenAccidental(suffix) {
    switch (suffix) {
        case '#': return { shift: 1, explicit: true };
        case 'b': return { shift: -1, explicit: true };
        case '##': return { shift: 2, explicit: true };
        case 'bb': return { shift: -2, explicit: true };
        case 'n': return { shift: 0, explicit: true }; // бекар отменяет тональность
        default: return { shift: 0, explicit: false };
    }
}

// Реальная высота (MIDI) ноты по правилам нотации. ЕДИНСТВЕННОЕ место расчёта:
//  - явный знак -> его сдвиг; запоминается в [measureState] для (ступень+октава)
//    и действует до конца такта на ту же высоту;
//  - нет знака, но в такте уже был знак на этой высоте -> наследует его;
//  - иначе -> сдвиг тональности ([keyAlt] из keySignatureAlterations);
//  - бекар ('n') -> явный сдвиг 0 (отменяет и тональность, и прежний знак такта).
// [measureState] МУТИРУЕТСЯ (накопление знаков такта); сбрасывается вызывающим
// в начале каждого такта/голоса. Возвращает MIDI-номер.
export function resolveMidi(key, keyAlt, measureState) {
    const p = parseKey(key);
    const base = SEMI[p.step];
    if (base === undefined || isNaN(p.octave)) return 69; // safety
    const w = writtenAccidental(p.suffix);
    const slot = p.step + p.octave; // знак привязан к высоте (ступень+октава)
    let shift;
    if (w.explicit) {
        shift = w.shift;
        measureState[slot] = shift; // действует до конца такта на этой высоте
    } else if (Object.prototype.hasOwnProperty.call(measureState, slot)) {
        shift = measureState[slot]; // унаследованный знак такта
    } else {
        shift = keyAlt && keyAlt[p.step] ? keyAlt[p.step] : 0; // тональность
    }
    return (p.octave + 1) * 12 + base + shift;
}

// Прямой разбор ключа в MIDI с учётом ТОЛЬКО записанного знака (без тональности
// и правил такта). Делегирует resolveMidi с пустым контекстом — единая логика.
export function keyToMidi(key) {
    return resolveMidi(key, null, {});
}
