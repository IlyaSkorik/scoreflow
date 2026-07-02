// JS-тест движка размещения (node, ESM). Запуск:
//   node test/js/placement.test.mjs
// Skyline-профиль и верхняя полоса (вольты -> темп -> навигация): объекты над
// разными тактами не раздвигают друг друга, столбик одного такта складывается
// с зазорами, высокие ноты приподнимают метки, резервирование консервативными
// габаритами ≥ фактического размещения (монотонность).
import {
    TopSkyline, placeAbove, placeTopBand, VOLTA_STAFF_CLEAR, MARK_GAP,
} from '../../assets/www/js/render/placement.js';

let failed = 0;
function eq(name, got, want) {
    if (got === want) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + '  got=' + got + ' want=' + want); }
}
function ok(name, cond, extra) {
    if (cond) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

console.log('TopSkyline:');
{
    const s = new TopSkyline(100);
    eq('flat base', s.topAt(0, 50), 100);
    s.raise(10, 20, 80);
    eq('raised range', s.topAt(10, 20), 80);
    eq('outside range keeps base', s.topAt(30, 40), 100);
    eq('overlap takes highest', s.topAt(0, 50), 80);
    s.raise(15, 25, 90);
    eq('raise never lowers', s.topAt(15, 20), 80);
    eq('partial raise applies', s.topAt(20, 25), 90);
    eq('min of profile', s.min(), 80);
}

console.log('placeAbove:');
{
    const s = new TopSkyline(100);
    // Объект (rise 10, drop 4) с зазором 6: опорная линия 100-6-4=90,
    // профиль поднят до 90-10=80.
    eq('ref line above base', placeAbove(s, 0, 10, 10, 4, 6), 90);
    eq('skyline raised to object top', s.topAt(0, 10), 80);
    // Второй объект над тем же диапазоном — выше первого.
    const y2 = placeAbove(s, 5, 15, 10, 0, 6);
    eq('stacked above first', y2, 74);
    // Третий — в стороне: садится на базу, столбик его не трогает.
    eq('independent range sits low', placeAbove(s, 30, 40, 10, 0, 6), 94);
}

console.log('placeTopBand: базовая полоса без нот над станом:');
{
    const r = placeTopBand({
        staffTop: 0,
        profile: [],
        voltas: [{ key: 'v0', x0: 0, x1: 100, drop: 11 }],
        tempos: [{ key: 't0', x0: 10, x1: 60, rise: 22, drop: 4 }],
        navs: [{ key: 'n0', x0: 0, x1: 30, rise: 26, drop: 6 }],
    });
    // Вольта: линия на -(10+11) = -21 (как издательская посадка BRACKET_ABOVE).
    eq('volta line level', r.y.v0, -(VOLTA_STAFF_CLEAR + 11));
    // Темп над вольтой: -21 - MARK_GAP - drop.
    eq('tempo above volta', r.y.t0, -21 - MARK_GAP - 4);
    // Навигация над темпом (их габариты пересекаются по X).
    const tempoTop = r.y.t0 - 22;
    eq('nav above tempo', r.y.n0, tempoTop - MARK_GAP - 6);
    ok('padTop covers everything', r.padTop >= 26 - r.y.n0 - 26, '');
    eq('padTop is nav top', r.padTop, -(r.y.n0 - 26));
}

console.log('placeTopBand: объекты над разными тактами независимы:');
{
    const r = placeTopBand({
        staffTop: 0,
        profile: [],
        voltas: [{ key: 'v0', x0: 0, x1: 100, drop: 11 }],
        tempos: [{ key: 't0', x0: 200, x1: 260, rise: 22, drop: 4 }],
    });
    eq('volta at its slot', r.y.v0, -21);
    // Темп НЕ над вольтой -> садится к стану, а не над вольтой.
    eq('tempo not lifted by distant volta', r.y.t0, -MARK_GAP - 4);
}

console.log('placeTopBand: высокие ноты приподнимают метки:');
{
    const r = placeTopBand({
        staffTop: 0,
        profile: [{ x0: 0, x1: 100, above: 30 }],
        voltas: [{ key: 'v0', x0: 0, x1: 100, drop: 11 }],
        tempos: [{ key: 't1', x0: 300, x1: 360, rise: 22, drop: 4 }],
    });
    eq('volta above ledger notes', r.y.v0, -30 - VOLTA_STAFF_CLEAR - 11);
    eq('tempo elsewhere unaffected', r.y.t1, -MARK_GAP - 4);
}

console.log('placeTopBand: текст, выступающий за такт, конфликтует честно:');
{
    // Темп ЗАХОДИТ по X в зону вольты соседнего такта -> должен встать над ней.
    const r = placeTopBand({
        staffTop: 0,
        profile: [],
        voltas: [{ key: 'v0', x0: 100, x1: 200, drop: 11 }],
        tempos: [{ key: 't0', x0: 80, x1: 130, rise: 22, drop: 4 }],
    });
    ok('tempo lifted above volta it crosses',
        r.y.t0 + 4 <= r.y.v0 - MARK_GAP + 1e-9,
        'tempo=' + r.y.t0 + ' volta=' + r.y.v0);
}

console.log('монотонность: резерв (широкие габариты) ≥ отрисовка (узкие):');
{
    const wide = placeTopBand({
        staffTop: 0,
        profile: [{ x0: 0, x1: 100, above: 15 }],
        voltas: [{ key: 'v', x0: 0, x1: 200, drop: 11 }],
        tempos: [{ key: 't', x0: 0, x1: 260, rise: 22, drop: 4 }],
        navs: [{ key: 'n', x0: 0, x1: 200, rise: 26, drop: 6 }],
    });
    const tight = placeTopBand({
        staffTop: 0,
        profile: [{ x0: 0, x1: 100, above: 15 }],
        voltas: [{ key: 'v', x0: 0, x1: 200, drop: 11 }],
        tempos: [{ key: 't', x0: 210, x1: 250, rise: 22, drop: 4 }],
        navs: [{ key: 'n', x0: 0, x1: 40, rise: 26, drop: 6 }],
    });
    ok('reserve covers exact placement', tight.padTop <= wide.padTop,
        'tight=' + tight.padTop + ' wide=' + wide.padTop);
    ok('tempo drops when clear of volta', tight.y.t > wide.y.t,
        'tight=' + tight.y.t + ' wide=' + wide.y.t);
}

console.log('placeTopBand: вольты полосы стоят на одном «рельсе»:');
{
    const r = placeTopBand({
        staffTop: 0,
        profile: [{ x0: 0, x1: 100, above: 30 }],
        voltas: [
            { key: 'v0', x0: 0, x1: 100, drop: 15 },   // над высокими нотами
            { key: 'v1', x0: 100, x1: 200, drop: 11 }, // над пустым станом
        ],
    });
    eq('both segments share the rail', r.y.v0, r.y.v1);
    eq('rail set by the tallest segment', r.y.v0, -30 - VOLTA_STAFF_CLEAR - 15);
}

console.log('placeTopBand: два темпа рядом не наезжают друг на друга:');
{
    const r = placeTopBand({
        staffTop: 0,
        profile: [],
        tempos: [
            { key: 'a', x0: 100, x1: 160, rise: 22, drop: 4 },
            { key: 'b', x0: 150, x1: 210, rise: 22, drop: 4 },
        ],
    });
    // Габариты пересекаются -> второй встаёт над первым.
    ok('overlapping tempos stack', r.y.b + 4 <= r.y.a - 22 - MARK_GAP + 1e-9,
        'a=' + r.y.a + ' b=' + r.y.b);
}

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall placement tests passed');
