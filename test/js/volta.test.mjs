// JS-тест профессиональной volta system: модель `_volta`, разрешение спанов
// (domain/voltas), volta-aware разворот порядка (domain/repeats.expandMeasureOrder)
// и volta-разворот в компиляторе. Playback-логика вольт живёт вне scheduler.
import {
    parseVoltaNumbers,
    voltaLabel,
    effectiveVoltas,
    voltaChainFrom,
    maxEndingOf,
} from '../../assets/www/js/domain/voltas.js';
import { expandMeasureOrder } from '../../assets/www/js/domain/repeats.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) console.log('  ok   ' + name);
    else {
        failed++;
        console.log('  FAIL ' + name + '  got=' + g + ' want=' + w);
    }
}

const N = (k) => ({ keys: [k], duration: 'q', rest: false });
// Такт с нотой + опциональными _repeat/_volta.
const M = (key, opts) => ({
    treble: [N(key)],
    bass: [],
    ...((opts && opts.repeat) ? { _repeat: opts.repeat } : {}),
    ...((opts && opts.volta) ? { _volta: opts.volta } : {}),
});
const piano = (measures) => ({
    instrument: 'piano',
    keySignature: 'C',
    timeSignature: '4/4',
    tempo: 120,
    measures,
});

console.log('volta domain — number parsing and label:');
eq('numbers normalize (sort, dedup, drop bad)',
    [parseVoltaNumbers([2, 1, 2]), parseVoltaNumbers([]), parseVoltaNumbers('x'),
        parseVoltaNumbers([3])],
    [[1, 2], [1], [1], [3]]);
eq('labels', [voltaLabel([1]), voltaLabel([2]), voltaLabel([1, 3])],
    ['1.', '2.', '1, 3.']);

console.log('volta domain — effective spans, closed derivation, span clamp:');
eq('two consecutive endings: first closed (next volta), last open',
    effectiveVoltas([{}, {}, { _volta: { n: [1] } }, { _volta: { n: [2] } }]),
    [
        { start: 2, end: 2, numbers: [1], label: '1.', closed: true },
        { start: 3, end: 3, numbers: [2], label: '2.', closed: false },
    ]);
eq('multi-measure ending spans and clamps to score end',
    effectiveVoltas([{ _volta: { n: [1], span: 2 } }, {}, { _volta: { n: [2], span: 5 } }, {}]),
    [
        // 1-я концовка (такты 0-1) закрыта: сразу за ней (такт 2) начинается 2-я.
        { start: 0, end: 1, numbers: [1], label: '1.', closed: true },
        // 2-я концовка span=5 клампится к концу партитуры (такты 2-3), открыта.
        { start: 2, end: 3, numbers: [2], label: '2.', closed: false },
    ]);
{
    const spans = effectiveVoltas([{}, { _volta: { n: [1] } }, { _volta: { n: [2] } }]);
    eq('voltaChainFrom collects consecutive endings',
        voltaChainFrom(spans, 1).map((s) => s.numbers), [[1], [2]]);
    eq('maxEndingOf = passes needed', maxEndingOf(spans), 2);
    eq('voltaChainFrom empty when no volta starts there',
        voltaChainFrom(spans, 0), []);
}

console.log('expandMeasureOrder — repeat + volta:');
// |: A B C :| 1.D  2.E  — repeatEnd на первой концовке.
eq('first/second ending with repeat',
    expandMeasureOrder([
        M('c/4'), M('d/4'), M('e/4'),
        M('f/4', { repeat: 'end', volta: { n: [1] } }),
        M('g/4', { volta: { n: [2] } }),
    ]),
    [0, 1, 2, 3, 0, 1, 2, 4]);
// Явный repeatStart на такте 0: секция повтора — с такта 1.
eq('explicit repeat start narrows the base',
    expandMeasureOrder([
        M('c/4', { repeat: 'start' }), M('d/4'), M('e/4'),
        M('f/4', { repeat: 'end', volta: { n: [1] } }),
        M('g/4', { volta: { n: [2] } }),
    ]),
    [0, 1, 2, 3, 1, 2, 4]);
// Три концовки: две репризы-конца, третья открыта.
eq('three endings repeat three times',
    expandMeasureOrder([
        M('c/4'), M('d/4'),
        M('e/4', { repeat: 'end', volta: { n: [1] } }),
        M('f/4', { repeat: 'end', volta: { n: [2] } }),
        M('g/4', { volta: { n: [3] } }),
    ]),
    [0, 1, 2, 0, 1, 3, 0, 1, 4]);
// Многотактовая первая концовка [3,4] с repeatEnd на её конце.
eq('multi-measure first ending',
    expandMeasureOrder([
        M('c/4'), M('d/4'),
        M('e/4', { volta: { n: [1], span: 2 } }),
        M('f/4', { repeat: 'end' }),
        M('g/4', { volta: { n: [2] } }),
    ]),
    [0, 1, 2, 3, 0, 1, 4]);
// Вольты без репризы: концовки играются подряд по разу (детерминированно).
eq('voltas without repeat play sequentially once',
    expandMeasureOrder([
        M('c/4'), M('d/4', { volta: { n: [1] } }), M('e/4', { volta: { n: [2] } }),
    ]),
    [0, 1, 2]);

console.log('expandMeasureOrder — no regression when no voltas:');
eq('plain repeat unchanged',
    expandMeasureOrder([M('c/4', { repeat: 'start' }), M('d/4'), M('e/4', { repeat: 'end' }), M('f/4')]),
    [0, 1, 2, 1, 2, 3]);

console.log('compilePlayback — volta expansion into events & timeline:');
{
    const comp = compilePlayback(piano([
        M('c/4'), M('d/4'), M('e/4'),
        M('f/4', { repeat: 'end', volta: { n: [1] } }),
        M('g/4', { volta: { n: [2] } }),
    ]));
    const treble = comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .map((e) => ({ b: e.startBeat, src: e.sourceMeasure }));
    eq('events take 1st then 2nd ending across the repeat', treble, [
        { b: 0, src: 0 }, { b: 4, src: 1 }, { b: 8, src: 2 }, { b: 12, src: 3 },
        { b: 16, src: 0 }, { b: 20, src: 1 }, { b: 24, src: 2 }, { b: 28, src: 4 },
    ]);
    eq('measureOrder drives scheduler geometry', comp.measureOrder,
        [0, 1, 2, 3, 0, 1, 2, 4]);
    eq('expanded total beats', comp.totalBeats, 32);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS volta tests passed.');
}
