// JS-тест сборки верхней полосы (node, ESM). Запуск:
//   node test/js/top_band.test.mjs
// solveTopBand — общий для экрана и печати: вольты -> темп -> навигация по
// skyline. Без VF/ctx габариты меток оцениваются фолбэками — тест проверяет
// ПОВЕДЕНИЕ (стекинг/независимость/резерв ⊇ отрисовка), не пиксели.
import { solveTopBand } from '../../assets/www/js/render/top_band.js';

let failed = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

const boxes = { 0: { x: 0, w: 200 }, 1: { x: 200, w: 200 } };
const base = {
    VF: null, ctx: null, staffTop: 0,
    measures: [0, 1],
    boxOf: (mi) => boxes[mi] || null,
    aboveOf: () => 0,
    voltas: [],
    tempoMarks: [],
    navMarks: [],
    anchorXOf: null,
};

console.log('пустая полоса:');
{
    const r = solveTopBand(base);
    ok('padTop = 0 без меток и выступов', r.padTop === 0, 'got=' + r.padTop);
}

console.log('стекинг на одном такте, независимость на разных:');
{
    const stacked = solveTopBand({
        ...base,
        voltas: [{ start: 0, end: 0, label: '1.' }],
        tempoMarks: [{ measure: 0, beat: 0, bpm: 120 }],
        navMarks: [{ measure: 0, id: 'segno' }],
    });
    // Темп на ДРУГОМ такте (точный якорь вне вольты) — не поднимается над ней.
    const spread = solveTopBand({
        ...base,
        voltas: [{ start: 0, end: 0, label: '1.' }],
        tempoMarks: [{ measure: 1, beat: 0, bpm: 120 }],
        anchorXOf: () => 250,
    });
    ok('темп вне вольты садится к стану, а не над ней',
        spread.tempoYOf(0) > stacked.tempoYOf(0),
        'spread=' + spread.tempoYOf(0) + ' stacked=' + stacked.tempoYOf(0));
    // Навигация над темпом над вольтой (та же вертикаль).
    ok('nav выше tempo', stacked.navYOf(0) < stacked.tempoYOf(0),
        stacked.navYOf(0) + ' vs ' + stacked.tempoYOf(0));
    ok('tempo выше вольты', stacked.tempoYOf(0) < stacked.voltaYOf(0),
        stacked.tempoYOf(0) + ' vs ' + stacked.voltaYOf(0));
}

console.log('высокие ноты приподнимают полосу:');
{
    const flat = solveTopBand({
        ...base, voltas: [{ start: 0, end: 1, label: '1.' }],
    });
    const tall = solveTopBand({
        ...base, voltas: [{ start: 0, end: 1, label: '1.' }],
        aboveOf: () => 30,
    });
    ok('padTop растёт на выступ нот', tall.padTop >= flat.padTop + 30,
        'tall=' + tall.padTop + ' flat=' + flat.padTop);
}

console.log('резерв (без якорей) ⊇ отрисовка (точные якоря):');
{
    const spec = {
        ...base,
        voltas: [{ start: 1, end: 1, label: '2.' }],
        tempoMarks: [{ measure: 0, beat: 3, bpm: 152 }],
        navMarks: [{ measure: 1, id: 'coda' }],
    };
    const reserve = solveTopBand(spec);            // anchorXOf: null
    const exact = solveTopBand({
        ...spec, anchorXOf: () => 150,             // реальный X ноты
    });
    ok('точное размещение в пределах резерва',
        exact.padTop <= reserve.padTop + 1e-9,
        'exact=' + exact.padTop + ' reserve=' + reserve.padTop);
}

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall top-band tests passed');
