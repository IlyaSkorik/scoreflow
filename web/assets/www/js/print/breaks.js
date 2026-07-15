// [ScoreFlow engine] Print Breaking — оптимальное разбиение тактов на системы
// и систем на страницы. Динамическое программирование по стоимости «плохости»
// (badness), как перенос строк Кнута–Пласса в TeX и layout-движки MuseScore/
// Dorico: вместо жадного first-fit (дающего 5/5/2) минимизируется СУММАРНАЯ
// неравномерность (даёт 4/4/4). Модуль ЧИСТЫЙ (без VF/DOM) — тестируется в Node.

// --- Разбиение тактов на системы -------------------------------------
// opts:
//   count      — число тактов
//   widths[i]  — минимальная ширина содержимого такта i (+ его паддинг)
//   leads[i]   — доп. ширина смены тональности/размера, если такт i попадает
//                В СЕРЕДИНУ системы (на первом такте смена уходит в «голову»)
//   headOf(i)  — ширина «головы» системы, начинающейся с такта i
//   W          — доступная ширина системы
// Возвращает массив систем: { firstMeasure, items: [индексы тактов] }.
//
// Стоимость системы [a..b]:
//   • natural > W и тактов > 1 — недопустимо (не сжимаем ноты);
//   • одиночный переполненный такт — большая конечная цена (деваться некуда,
//     Formatter уплотнит без потери читаемости);
//   • иначе — штраф за недозаполненность BAD·(1 − natural/W)², включая
//     последнюю систему: короткий «огрызок» в конце (5/5/2, 5/1) хуже
//     равномерного распределения (4/4/4, 3/3) — как в изданиях. Полные
//     системы стоят 0, поэтому плотные партитуры остаются плотными.
// Малая цена за саму систему (PER_SYSTEM) размывает ничьи в пользу более
// плотной вёрстки.
const BAD = 120;
const PER_SYSTEM = 2;
const OVERFULL = 5000;

export function breakSystems(opts) {
    const n = opts.count | 0;
    if (n <= 0) return [];
    const w = opts.widths;
    const leads = opts.leads || new Array(n).fill(0);
    const W = opts.W;
    // Префиксные суммы: natural(a..b) за O(1).
    const pw = [0], pl = [0];
    for (let i = 0; i < n; i++) {
        pw.push(pw[i] + w[i]);
        pl.push(pl[i] + leads[i]);
    }
    // lead первого такта системы не считается (смена рисуется в голове).
    const naturalOf = function (a, b) {
        return opts.headOf(a) + (pw[b + 1] - pw[a]) + (pl[b + 1] - pl[a + 1]);
    };

    const best = new Array(n + 1).fill(Infinity);
    const from = new Array(n + 1).fill(-1);
    best[0] = 0;
    for (let e = 1; e <= n; e++) {
        // s — начало системы [s..e-1]; идём назад, пока система влезает.
        for (let s = e - 1; s >= 0; s--) {
            const nat = naturalOf(s, e - 1);
            const count = e - s;
            if (nat > W && count > 1) break; // добавление тактов только хуже
            let cost;
            if (nat > W) {
                cost = OVERFULL + (nat - W); // одиночный переполненный такт
            } else {
                const r = nat / W;
                cost = BAD * (1 - r) * (1 - r);
            }
            const total = best[s] + cost + PER_SYSTEM;
            if (total < best[e]) { best[e] = total; from[e] = s; }
        }
    }

    // Восстановление разбиения.
    const bounds = [];
    for (let e = n; e > 0; e = from[e]) bounds.push([from[e], e]);
    bounds.reverse();
    return bounds.map(function (be) {
        const items = [];
        for (let k = be[0]; k < be[1]; k++) items.push(k);
        return { firstMeasure: be[0], items: items };
    });
}

// --- Разбиение систем на страницы -------------------------------------
// opts:
//   heights[s] — полная высота системы s (с её верхним/нижним резервом)
//   gap        — минимальный интервал между системами
//   firstH     — высота печатной зоны ПЕРВОЙ страницы (за вычетом титульного
//                блока)
//   restH      — высота печатной зоны остальных страниц
// Возвращает массив страниц: [[индексы систем], ...].
//
// Стоимость страницы:
//   • не-последняя: BAD_PAGE·(1 − fill)² — штраф за недозаполненность;
//   • последняя: 0 (частично заполненная последняя страница — норма);
//   • страница из ОДНОЙ системы при многосистемной партитуре — сирота:
//     дополнительный штраф (для последней страницы — сильнее: классическая
//     «вдова» 5+1 превращается в сбалансированное 4+2).
const BAD_PAGE = 90;
const LONELY = 25;
const ORPHAN_LAST = 45;

export function breakPages(opts) {
    const n = opts.heights.length | 0;
    if (n <= 0) return [];
    const h = opts.heights;
    const gap = opts.gap || 0;
    const naturalOf = function (a, b) {
        let s = 0;
        for (let k = a; k <= b; k++) s += h[k];
        return s + gap * (b - a);
    };
    const pageCost = function (a, b, H, isLast) {
        const nat = naturalOf(a, b);
        const count = b - a + 1;
        if (nat > H && count > 1) return Infinity;
        let cost;
        if (nat > H) cost = OVERFULL + (nat - H); // одиночная переросшая система
        else if (isLast) cost = 0;
        else { const fill = nat / H; cost = BAD_PAGE * (1 - fill) * (1 - fill); }
        if (count === 1 && n > 1) cost += isLast ? ORPHAN_LAST : LONELY;
        return cost;
    };

    // ДП по суффиксам для страниц 2..N (высота restH); первая страница —
    // отдельный перебор (высота firstH зависит от титульного блока).
    const bestAfter = new Array(n + 1).fill(Infinity);
    const nextBreak = new Array(n + 1).fill(-1);
    bestAfter[n] = 0;
    for (let s = n - 1; s >= 0; s--) {
        for (let e = s; e < n; e++) {
            const c = pageCost(s, e, opts.restH, e === n - 1);
            if (c === Infinity) break;
            const total = c + bestAfter[e + 1];
            if (total < bestAfter[s]) { bestAfter[s] = total; nextBreak[s] = e + 1; }
        }
    }

    // Первая страница: [0..e], далее — оптимальный суффикс.
    let bestTotal = Infinity, firstEnd = 0;
    for (let e = 0; e < n; e++) {
        const c = pageCost(0, e, opts.firstH, e === n - 1);
        if (c === Infinity) break;
        const total = c + bestAfter[e + 1];
        if (total < bestTotal) { bestTotal = total; firstEnd = e + 1; }
    }
    if (bestTotal === Infinity) firstEnd = 1; // первая система выше страницы

    const pages = [];
    let cur = [];
    for (let k = 0; k < firstEnd; k++) cur.push(k);
    pages.push(cur);
    let s = firstEnd;
    while (s < n) {
        let e = nextBreak[s];
        if (e <= s) e = s + 1; // защита (переросшая система)
        const pg = [];
        for (let k = s; k < e; k++) pg.push(k);
        pages.push(pg);
        s = e;
    }
    return pages;
}
