// JS-тест профессиональной repeat system: модель `_repeat`, render projection
// и playback expansion живут вне scheduler.
import {
    parseRepeat,
    repeatBarline,
    effectiveRepeatBarlines,
    expandMeasureOrder,
} from '../../assets/www/js/domain/repeats.js';
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
const M = (key, repeat) => ({
    treble: [N(key)],
    bass: [],
    ...(repeat ? { _repeat: repeat } : {}),
});
const piano = (measures) => ({
    instrument: 'piano',
    keySignature: 'C',
    timeSignature: '4/4',
    tempo: 120,
    measures,
});

console.log('repeat domain — parsing and render projection:');
eq('known ids parse', ['start', 'end', 'both'].map(parseRepeat),
    ['start', 'end', 'both']);
eq('unknown/null parse to null', [parseRepeat('x'), parseRepeat(null)],
    [null, null]);
eq('repeat -> native barline ids',
    ['start', 'end', 'both', null].map(repeatBarline),
    ['repeatStart', 'repeatEnd', 'repeatBoth', null]);
eq('repeat visual overrides base barline at same boundary',
    effectiveRepeatBarlines([{ _repeat: 'start' }, {}, { _repeat: 'end' }],
        ['normal', 'normal', 'final']),
    ['repeatStart', 'normal', 'repeatEnd']);

console.log('repeat domain — deterministic measure order:');
eq('no repeats plays once', expandMeasureOrder([{}, {}, {}]), [0, 1, 2]);
eq('missing start repeats from beginning',
    expandMeasureOrder([{}, {}, { _repeat: 'end' }]), [0, 1, 2, 0, 1, 2]);
eq('start/end repeats enclosed section',
    expandMeasureOrder([{ _repeat: 'start' }, {}, { _repeat: 'end' }, {}]),
    [0, 1, 2, 1, 2, 3]);
eq('both closes then opens next section',
    expandMeasureOrder([{ _repeat: 'start' }, { _repeat: 'both' }, { _repeat: 'end' }]),
    [0, 1, 1, 2, 2]);

console.log('compilePlayback — expanded events, starts, total, source measures:');
{
    const comp = compilePlayback(piano([
        M('c/4', 'start'),
        M('d/4'),
        M('e/4', 'end'),
        M('f/4'),
    ]));
    const treble = comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .map((e) => ({ id: e.noteId, b: e.startBeat, src: e.sourceMeasure }));
    eq('expanded note order repeats measures 1..2 once', treble, [
        { id: '0:treble:0', b: 0, src: 0 },
        { id: '1:treble:0', b: 4, src: 1 },
        { id: '2:treble:0', b: 8, src: 2 },
        { id: '1:treble:0', b: 12, src: 1 },
        { id: '2:treble:0', b: 16, src: 2 },
        { id: '3:treble:0', b: 20, src: 3 },
    ]);
    eq('measureOrder exposed for scheduler geometry only',
        comp.measureOrder, [0, 1, 2, 1, 2, 3]);
    eq('expanded starts and total', [comp.starts, comp.totalBeats],
        [[0, 4, 8, 12, 16, 20, 24], 24]);
    eq('linear timeline remains available for diagnostics',
        [comp.linearStarts, comp.linearTotalBeats], [[0, 4, 8, 12, 16], 16]);
}

console.log('compilePlayback — no infinite loop with repeated end markers:');
{
    const comp = compilePlayback(piano([M('c/4', 'end'), M('d/4', 'end')]));
    eq('finite deterministic measureOrder', comp.measureOrder, [0, 0, 1, 0, 1]);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS repeat tests passed.');
}
