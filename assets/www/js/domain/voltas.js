// [ScoreFlow engine] Volta theory — единый источник истины для вольт (первая/
// вторая концовка). `_volta` живёт на ПЕРВОМ такте концовки и НЕ является
// render-флагом: это нотационный объект-диапазон (как `_repeat` — объект на
// границе). Renderer/PDF только проецируют вольту в скобку над станом; playback
// compiler (через domain/repeats.expandMeasureOrder) разворачивает порядок так,
// что на нужном проходе повтора звучит нужная концовка. Scheduler о вольтах не
// знает.
//
// Модель диапазонная и БЕЗ редизайна расширяется на 3-ю/4-ю/произвольные
// концовки: `numbers` — список номеров концовки ([1], [2], [1,3] …), `span` —
// сколько тактов покрывает скобка (>=1, многотактовые концовки). Прямой аналог
// domain/repeats и domain/barlines: теория здесь, VexFlow-примитивы — в render.
// ЗАВИСИМОСТЕЙ от repeats нет (repeats импортирует voltas, не наоборот) — цикла
// не возникает; «закрытость» (правый крюк) выводится из соседства вольт.

// Нормализация списка номеров концовки: массив целых > 0, по возрастанию, без
// дублей. Пустой/битый список -> [1] (первая концовка по умолчанию).
export function parseVoltaNumbers(raw) {
    const src = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    const set = {};
    const out = [];
    for (let i = 0; i < src.length; i++) {
        const n = Math.trunc(Number(src[i]));
        if (Number.isFinite(n) && n > 0 && !set[n]) { set[n] = true; out.push(n); }
    }
    out.sort(function (a, b) { return a - b; });
    return out.length ? out : [1];
}

// Текстовая метка вольты: "1.", "2.", "1, 3." … Зеркало Dart Volta.label —
// движок и модель рисуют одинаковый текст.
export function voltaLabel(numbers) {
    return parseVoltaNumbers(numbers).join(', ') + '.';
}

// Сырой volta-объект такта или null. ЕДИНОЕ место чтения `_volta` (render/print/
// compiler не лезут в поле напрямую).
export function voltaRaw(measure) {
    return (measure && measure._volta) ? measure._volta : null;
}

// Разрешённые вольты партитуры как ДИАПАЗОНЫ, отсортированные по началу:
//   { start, end, numbers, label, closed }
// start/end — индексы тактов (end клампится в границы партитуры); numbers —
// нормализованный список; label — текст скобки; closed — есть ли правый крюк
// (концовка «закрыта»): true, если сразу за вольтой начинается СЛЕДУЮЩАЯ вольта
// (т.е. это не последняя концовка). Последняя (открытая) концовка правого крюка
// не имеет — профессиональная конвенция MuseScore/Dorico/Finale. Вывод closed
// из соседства вольт (а не из репризы) держит модуль независимым от repeats.
export function effectiveVoltas(measures) {
    const ms = measures || [];
    const n = ms.length;
    const raws = [];
    for (let i = 0; i < n; i++) {
        const r = voltaRaw(ms[i]);
        if (r) raws.push({ start: i, raw: r });
    }
    // Множество индексов-начал вольт — для вывода closed (следующая вольта).
    const startsSet = {};
    for (let k = 0; k < raws.length; k++) startsSet[raws[k].start] = true;

    const spans = [];
    for (let k = 0; k < raws.length; k++) {
        const start = raws[k].start;
        const numbers = parseVoltaNumbers(raws[k].raw.n != null ? raws[k].raw.n : raws[k].raw.numbers);
        let span = Math.trunc(Number(raws[k].raw.span));
        if (!Number.isFinite(span) || span < 1) span = 1;
        let end = start + span - 1;
        if (end > n - 1) end = n - 1;
        const closed = !!startsSet[end + 1]; // сразу следом начинается вольта
        spans.push({ start: start, end: end, numbers: numbers, label: voltaLabel(numbers), closed: closed });
    }
    return spans;
}

// Наивысший номер концовки в цепочке вольт (сколько проходов повтора нужно).
export function maxEndingOf(chain) {
    let mx = 1;
    for (let i = 0; i < chain.length; i++) {
        const nums = chain[i].numbers;
        for (let j = 0; j < nums.length; j++) if (nums[j] > mx) mx = nums[j];
    }
    return mx;
}

// Цепочка СМЕЖНЫХ вольт, начинающаяся с индекса [startIndex]: вольта, стартующая
// на startIndex, затем вольта сразу за её концом и т.д. (1./2./3. …). Пусто, если
// на startIndex вольта не начинается. [spans] — из effectiveVoltas.
export function voltaChainFrom(spans, startIndex) {
    const chain = [];
    let s = startIndex;
    for (;;) {
        let found = null;
        for (let i = 0; i < spans.length; i++) {
            if (spans[i].start === s) { found = spans[i]; break; }
        }
        if (!found) break;
        chain.push(found);
        s = found.end + 1;
    }
    return chain;
}
