// Тесты печатного layout-движка: геометрия бумаги, ДП-разбиение на системы
// и страницы, модельные вертикальные метрики. Чистые модули — без VF/DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

import { paperGeometry, mm2px, STAFF_H } from '../../assets/www/js/print/paper.js';
import { breakSystems, breakPages } from '../../assets/www/js/print/breaks.js';
import { staffLineOf, voiceExtents, dynamicsPresence } from '../../assets/www/js/print/metrics.js';
import { systemProfile } from '../../assets/www/js/print/vertical.js';

// --- paper --------------------------------------------------------------

test('геометрия A4: страница и поля считаются от бумаги', () => {
    const g = paperGeometry('a4');
    // A4 210x297 мм @96dpi.
    assert.ok(Math.abs(g.pageWpx - mm2px(210)) < 1e-9);
    assert.ok(Math.abs(g.pageHpx - mm2px(297)) < 1e-9);
    // Издательский масштаб: стан 7 мм -> scale заметно меньше экранного 1.0.
    assert.ok(g.scale > 0.5 && g.scale < 0.8, `scale=${g.scale}`);
    // Стан на бумаге ровно 7 мм.
    assert.ok(Math.abs(STAFF_H * g.scale - mm2px(7)) < 1e-9);
    // Печатная зона внутри страницы.
    assert.ok(g.contentW < g.W && g.contentH < g.H);
    // Гравировочных единиц по ширине больше, чем px (масштаб < 1) —
    // издательская плотность: больше тактов на систему.
    assert.ok(g.contentW > g.pageWpx - 2 * mm2px(14));
});

// --- breakSystems --------------------------------------------------------

test('системы: 12 одинаковых тактов делятся 4/4/4, а не 5/5/2', () => {
    // Ширина такта такая, что в систему влезает максимум 5.
    const w = new Array(12).fill(100);
    const sys = breakSystems({
        count: 12,
        widths: w,
        headOf: () => 60,
        W: 560, // 60 + 5*100 = 560 -> 5 влезает впритык
    });
    assert.equal(sys.length, 3);
    const sizes = sys.map((s) => s.items.length);
    assert.deepEqual(sizes, [4, 4, 4], `got ${sizes}`);
});

test('системы: последняя не вынуждает предыдущие пустеть', () => {
    // 9 тактов, по 4 в системе максимум: жадный дал бы 4/4/1.
    const sys = breakSystems({
        count: 9,
        widths: new Array(9).fill(100),
        headOf: () => 50,
        W: 460,
    });
    const sizes = sys.map((s) => s.items.length);
    assert.equal(sizes.reduce((a, b) => a + b), 9);
    // Оптимум ровнее: последняя система не короче 2 тактов.
    assert.ok(sizes[sizes.length - 1] >= 2, `got ${sizes}`);
});

test('системы: одиночный переполненный такт допустим (сожмётся)', () => {
    const sys = breakSystems({
        count: 3,
        widths: [900, 100, 100],
        headOf: () => 50,
        W: 500,
    });
    assert.equal(sys[0].items.length, 1); // переполненный — один в системе
    assert.equal(sys.length, 2);
});

test('системы: смены в середине учитываются шириной lead', () => {
    // Без lead 4 такта влезают; lead на такте 2 выталкивает его.
    const noLead = breakSystems({
        count: 4, widths: [100, 100, 100, 100],
        headOf: () => 50, W: 460,
    });
    assert.equal(noLead.length, 1);
    const withLead = breakSystems({
        count: 4, widths: [100, 100, 100, 100],
        leads: [0, 0, 80, 0],
        headOf: () => 50, W: 460,
    });
    assert.ok(withLead.length > 1);
});

// --- breakPages -----------------------------------------------------------

test('страницы: сироты не остаются (5+1 -> 4+2)', () => {
    // 6 систем по 180, страница вмещает 5 (5*180+4*20=980 <= 1000).
    const pages = breakPages({
        heights: new Array(6).fill(180),
        gap: 20,
        firstH: 1000,
        restH: 1000,
    });
    assert.equal(pages.length, 2);
    assert.deepEqual(pages.map((p) => p.length), [4, 2],
        `got ${pages.map((p) => p.length)}`);
});

test('страницы: титульный блок первой страницы уменьшает её ёмкость', () => {
    const pages = breakPages({
        heights: new Array(4).fill(200),
        gap: 10,
        firstH: 420,  // 2 системы max
        restH: 1000,  // остальные бы влезли все
    });
    assert.ok(pages[0].length <= 2, `first page ${pages[0].length}`);
    assert.equal(pages.flat().length, 4);
});

test('страницы: всё влезает на одну — одна страница', () => {
    const pages = breakPages({
        heights: [200, 200, 200],
        gap: 10,
        firstH: 1000,
        restH: 1000,
    });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].length, 3);
});

// --- metrics ----------------------------------------------------------------

test('metrics: номера линеек стана (скрипичный/басовый)', () => {
    assert.equal(staffLineOf('e/4', 'treble'), 4);  // нижняя линейка
    assert.equal(staffLineOf('f/5', 'treble'), 0);  // верхняя линейка
    assert.equal(staffLineOf('b/4', 'treble'), 2);  // средняя
    assert.equal(staffLineOf('c/4', 'treble'), 5);  // 1-я добавочная снизу
    assert.equal(staffLineOf('g/2', 'bass'), 4);    // нижняя линейка баса
    assert.equal(staffLineOf('a/3', 'bass'), 0);    // верхняя линейка баса
});

test('metrics: высокая нота даёт above, низкая — below', () => {
    // c/7 — высоко над станом: штиль вниз, головка высоко.
    const high = voiceExtents([{ keys: ['c/7'], duration: 'q' }], 'treble');
    assert.ok(high.above > 40, `above=${high.above}`);
    // c/3 — глубоко под станом (штиль вверх от головки).
    const low = voiceExtents([{ keys: ['c/3'], duration: 'q' }], 'treble');
    assert.ok(low.below > 40, `below=${low.below}`);
    // Нота в центре стана: головка внутри, вниз выступает только штиль
    // (3.5 промежутка от средней линейки = 1.5 ниже нижней).
    const mid = voiceExtents([{ keys: ['b/4'], duration: 'q' }], 'treble');
    assert.ok(mid.above <= 4 && mid.below <= 15,
        `above=${mid.above} below=${mid.below}`);
});

test('metrics: паузы и пустые голоса не раздувают габариты', () => {
    const rests = voiceExtents([{ keys: [], duration: 'w', rest: true }], 'treble');
    assert.deepEqual(rests, { above: 0, below: 0 });
    assert.deepEqual(voiceExtents([], 'bass'), { above: 0, below: 0 });
});

test('metrics: вилка резервирует динамику на всём диапазоне', () => {
    const ms = [
        { treble: [], _hair: [{ type: 'crescendo', voice: 'treble', sb: 0, em: 2, eb: 4 }] },
        { treble: [] },
        { treble: [] },
        { treble: [] },
    ];
    const has = dynamicsPresence(ms, 'treble');
    assert.deepEqual(has, [true, true, true, false]);
});

// --- vertical -----------------------------------------------------------------

test('vertical: система без выступов получает минимальный профиль', () => {
    const ext = [{ above: 0, below: 0 }];
    const pro = systemProfile({
        grand: true, items: [0],
        extTop: ext, extBottom: ext,
        dynTop: [false], dynBottom: [false],
        topReserve: 0,
    });
    assert.ok(pro.gapTB >= 52); // минимум аколады
    assert.equal(pro.height, pro.padTop + pro.bassDY + 40 + pro.padBottom);
});

test('vertical: динамика между станами раздвигает аколаду', () => {
    const ext = [{ above: 0, below: 30 }];
    const flat = systemProfile({
        grand: true, items: [0],
        extTop: ext, extBottom: [{ above: 30, below: 0 }],
        dynTop: [false], dynBottom: [false],
        topReserve: 0,
    });
    const withDyn = systemProfile({
        grand: true, items: [0],
        extTop: ext, extBottom: [{ above: 30, below: 0 }],
        dynTop: [true], dynBottom: [false],
        topReserve: 0,
    });
    assert.ok(withDyn.gapTB > flat.gapTB,
        `dyn=${withDyn.gapTB} flat=${flat.gapTB}`);
});

test('vertical: резерв верхней полосы (движок размещения) входит в padTop', () => {
    // topReserve — готовое решение skyline-движка (render/top_band): выступ
    // нот + вольты/темп/навигация; метки над высокой нотой дают больший резерв.
    const base = systemProfile({
        grand: false, items: [0],
        extTop: [{ above: 0, below: 0 }],
        dynTop: [false],
        topReserve: 40, // напр. вольта+темп над станом без выступов
    });
    const tall = systemProfile({
        grand: false, items: [0],
        extTop: [{ above: 0, below: 0 }],
        dynTop: [false],
        topReserve: 75, // те же метки, но skyline поднял их над высокой нотой
    });
    assert.ok(base.padTop >= 40, `base=${base.padTop}`);
    assert.ok(tall.padTop >= base.padTop + 35,
        `tall=${tall.padTop} base=${base.padTop}`);
});
