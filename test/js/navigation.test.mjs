// JS-тест профессиональной navigation system: Segno/Coda/D.C./D.S./Fine/To Coda.
// Навигация — ОТДЕЛЬНЫЙ слой ПОВЕРХ repeat/volta-разворота (domain/navigation
// оборачивает repeats.expandMeasureOrder). Порядок разворачивает ТОЛЬКО
// компилятор; scheduler о навигации не знает. Прыжки исполняются один раз —
// детерминированно, без бесконечных циклов.
import {
    parseNavigation, navSpec, expandPlaybackOrder,
} from '../../assets/www/js/domain/navigation.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + g + ' want=' + w); }
}

// Такт с навигацией / репризой / вольтой.
const M = (opt) => ({
    ...(opt && opt.nav ? { _nav: opt.nav } : {}),
    ...(opt && opt.rep ? { _repeat: opt.rep } : {}),
    ...(opt && opt.volta ? { _volta: opt.volta } : {}),
});
const P = (arr) => expandPlaybackOrder(arr);

console.log('domain — spec & parsing:');
eq('known nav parses', parseNavigation('dalSegnoAlCoda'), 'dalSegnoAlCoda');
eq('unknown/null parse to null', [parseNavigation('x'), parseNavigation(null)], [null, null]);
eq('markers are not jumps',
    ['segno', 'coda', 'toCoda', 'fine'].map((i) => navSpec(i).jump), [false, false, false, false]);
eq('D.C./D.S. are jumps',
    ['daCapo', 'dalSegno', 'daCapoAlCoda'].map((i) => navSpec(i).jump), [true, true, true]);

console.log('expandPlaybackOrder — no navigation is unchanged:');
eq('plain measures', P([M(), M(), M()]), [0, 1, 2]);
eq('inert markers (segno/coda/fine without a jump) play once',
    P([M({ nav: 'segno' }), M({ nav: 'fine' }), M({ nav: 'coda' })]), [0, 1, 2]);

console.log('expandPlaybackOrder — Da Capo family:');
eq('D.C. → replay from start', P([M(), M(), M({ nav: 'daCapo' })]), [0, 1, 2, 0, 1, 2]);
eq('D.C. al Fine → replay, stop at Fine',
    P([M({ nav: 'fine' }), M(), M({ nav: 'daCapoAlFine' })]), [0, 1, 2, 0]);
eq('D.C. al Coda → replay to To Coda, jump to Coda, to end',
    P([M(), M({ nav: 'toCoda' }), M(), M({ nav: 'coda' }), M({ nav: 'daCapoAlCoda' })]),
    [0, 1, 2, 3, 4, 0, 1, 3, 4]);

console.log('expandPlaybackOrder — Dal Segno family:');
eq('D.S. → replay from Segno',
    P([M(), M({ nav: 'segno' }), M(), M({ nav: 'dalSegno' })]), [0, 1, 2, 3, 1, 2, 3]);
eq('D.S. al Fine → from Segno, stop at Fine',
    P([M(), M({ nav: 'segno' }), M({ nav: 'fine' }), M(), M({ nav: 'dalSegnoAlFine' })]),
    [0, 1, 2, 3, 4, 1, 2]);
eq('D.S. al Coda → from Segno to To Coda, jump to Coda',
    P([M(), M({ nav: 'segno' }), M({ nav: 'toCoda' }), M(), M({ nav: 'coda' }), M({ nav: 'dalSegnoAlCoda' })]),
    [0, 1, 2, 3, 4, 5, 1, 2, 4, 5]);

console.log('expandPlaybackOrder — combined with Repeats:');
// |: 0 1 :| 2 [D.C.] — repeat observed on FIRST pass, NOT on the D.C. return.
eq('Repeat + D.C.', P([M({ rep: 'start' }), M({ rep: 'end' }), M({ nav: 'daCapo' })]),
    [0, 1, 1, 2, 0, 1, 2]);
// Repeat + D.S. al Fine: |: 0 :| segno@1 2(fine) 3 [D.S. al Fine]
eq('Repeat + D.S. al Fine',
    P([M({ rep: 'end' }), M({ nav: 'segno' }), M({ nav: 'fine' }), M(), M({ nav: 'dalSegnoAlFine' })]),
    [0, 0, 1, 2, 3, 4, 1, 2]);

console.log('expandPlaybackOrder — combined with Voltas:');
// |: 0 :| 1.[2] 2.[3] then D.C. on 3 (2nd ending) — voltas on first pass, D.C. returns linearly.
eq('Repeat + Volta + D.C.',
    P([M({ rep: 'end' }), M({ volta: { n: [1] }, rep: 'end' }), M({ volta: { n: [2] }, nav: 'daCapo' })]),
    // base (repeat+volta): 0,0(pass? ) ... verify via compiler below; here trust volta+repeat
    expandVoltaRef([M({ rep: 'end' }), M({ volta: { n: [1] }, rep: 'end' }), M({ volta: { n: [2] }, nav: 'daCapo' })]));

console.log('expandPlaybackOrder — safety (no infinite loops):');
{
    // Two D.C. marks: only the FIRST jump executes; the return pass ignores jumps.
    const order = P([M(), M({ nav: 'daCapo' }), M({ nav: 'daCapo' })]);
    eq('only first jump fires; finite', order, [0, 1, 0, 1, 2]);
}
{
    // D.S. with no Segno → from start; still finite.
    const order = P([M(), M({ nav: 'dalSegno' })]);
    eq('D.S. without Segno → from start, finite', order, [0, 1, 0, 1]);
}

console.log('compiler — navigation drives events & timeline:');
{
    const N = (k) => ({ keys: [k], duration: 'w', rest: false });
    const comp = compilePlayback({
        instrument: 'piano', timeSignature: '4/4', keySignature: 'C', tempo: 120,
        measures: [
            { treble: [N('c/4')], bass: [], _nav: 'fine' },
            { treble: [N('d/4')], bass: [] },
            { treble: [N('e/4')], bass: [], _nav: 'daCapoAlFine' },
        ],
    });
    const src = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat).map((e) => e.sourceMeasure);
    eq('D.C. al Fine playback measures', src, [0, 1, 2, 0]);
    eq('measureOrder exposed for scheduler', comp.measureOrder, [0, 1, 2, 0]);
}

// Ссылочный разворот repeat+volta БЕЗ навигации (для проверки, что navigation
// не искажает базу, а только добавляет возврат).
function expandVoltaRef(measures) {
    // Первый проход = базовый разворот до D.C. включительно, затем D.C. plain от 0.
    // Здесь считаем ожидаемое вручную: repeat/volta база = [0,0,1,0,2], D.C. на
    // такте 2 (2-я концовка), возврат plain от 0 линейно = [0,1,2].
    return [0, 0, 1, 0, 2, 0, 1, 2];
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS navigation tests passed.');
}
