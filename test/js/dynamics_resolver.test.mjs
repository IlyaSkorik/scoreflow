// JS-тест разрешения динамики движком (node, ESM). Запуск:
//   node test/js/dynamics_resolver.test.mjs
// Громкость (velocity) каждого playback-события разрешается в ОДНОМ месте —
// playback-компиляторе + domain/dynamics. Здесь проверяем: маппинг меток,
// таймлайн/активный оттенок, действие до следующего знака, независимость
// голосов, разрешение ОДИН раз (event.velocity), tie-merge сохраняет атаку,
// привязку оттенка к ноте по доле.
import {
    DYNAMIC_VELOCITY, DEFAULT_VELOCITY, velocityOf,
    dynamicsTimeline, velocityAt, noteOnsets, indexAtBeat,
} from '../../assets/www/js/domain/dynamics.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) {
        console.log('  ok   ' + name);
    } else {
        failed++;
        console.log('  FAIL ' + name + '  got=' + g + ' want=' + w);
    }
}

const N = (keys, opt = {}) =>
    Object.assign({ keys: keys, duration: 'q', rest: false }, opt);
// Такт фортепиано с оттенками treble (_dyn).
function piano(measures) {
    return { instrument: 'piano', timeSignature: '4/4', keySignature: 'C', measures: measures };
}
function trebleVels(comp) {
    return comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((e) => e.velocity);
}

console.log('velocity mapping:');
eq('mark velocities', DYNAMIC_VELOCITY,
    { ppp: 0.20, pp: 0.30, p: 0.45, mp: 0.60, mf: 0.75, f: 0.90, ff: 1.00, fff: 1.10 });
eq('default = mf', DEFAULT_VELOCITY, 0.75);
eq('velocityOf(f)', velocityOf('f'), 0.90);
eq('velocityOf(unknown) -> default', velocityOf('zzz'), 0.75);

console.log('timeline + velocityAt:');
{
    const ms = [
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'p', beat: 0 }] } },
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'f', beat: 2 }] } },
    ];
    const tl = dynamicsTimeline(ms, 'treble', 4);
    eq('absolute beats', tl, [{ beat: 0, velocity: 0.45 }, { beat: 6, velocity: 0.90 }]);
    eq('before first -> default', velocityAt(tl, -1), 0.75);
    eq('at p', velocityAt(tl, 0), 0.45);
    eq('still p before f', velocityAt(tl, 5.9), 0.45);
    eq('at f', velocityAt(tl, 6), 0.90);
}

console.log('compilePlayback — dynamic persists until next mark:');
{
    // Такт 0: p на доле 0 (две ноты -> обе p). Такт 1: f на доле 0 (обе f).
    const comp = compilePlayback(piano([
        { treble: [N(['c/4']), N(['d/4'])], bass: [], _dyn: { treble: [{ mark: 'p', beat: 0 }] } },
        { treble: [N(['e/4']), N(['f/4'])], bass: [], _dyn: { treble: [{ mark: 'f', beat: 0 }] } },
    ]));
    eq('p,p,f,f', trebleVels(comp), [0.45, 0.45, 0.90, 0.90]);
}

console.log('compilePlayback — no dynamic -> default mf everywhere:');
{
    const comp = compilePlayback(piano([{ treble: [N(['c/4']), N(['d/4'])], bass: [] }]));
    eq('mf default', trebleVels(comp), [0.75, 0.75]);
}

console.log('compilePlayback — mid-measure mark affects only following notes:');
{
    // beat 0: c (mf default), beat 2: ff на 3-й ноте (доли q,q,q,q -> beats 0,1,2,3).
    const comp = compilePlayback(piano([{
        treble: [N(['c/4']), N(['d/4']), N(['e/4']), N(['f/4'])], bass: [],
        _dyn: { treble: [{ mark: 'ff', beat: 2 }] },
    }]));
    eq('default,default,ff,ff', trebleVels(comp), [0.75, 0.75, 1.00, 1.00]);
}

console.log('compilePlayback — voices independent:');
{
    const comp = compilePlayback(piano([{
        treble: [N(['c/5'])], bass: [N(['c/3'])],
        _dyn: { treble: [{ mark: 'ppp', beat: 0 }], bass: [{ mark: 'fff', beat: 0 }] },
    }]));
    const tv = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest).map((e) => e.velocity);
    const bv = comp.events.filter((e) => e.voiceId === 'bass' && !e.rest).map((e) => e.velocity);
    eq('treble ppp', tv, [0.20]);
    eq('bass fff', bv, [1.10]);
}

console.log('compilePlayback — resolved once: every event carries velocity:');
{
    const comp = compilePlayback(piano([{
        treble: [N(['c/4']), N(['d/4'])], bass: [N(['c/3'])],
        _dyn: { treble: [{ mark: 'f', beat: 0 }] },
    }]));
    eq('all events have numeric velocity',
        comp.events.every((e) => typeof e.velocity === 'number'), true);
}

console.log('compilePlayback — tie-merge keeps head attack velocity:');
{
    // f на голове цепочки лиг; объединённое событие сохраняет velocity головы.
    const comp = compilePlayback(piano([{
        treble: [N(['c/4'], { duration: 'h', tieToNext: true }), N(['c/4'], { duration: 'h' })],
        bass: [],
        _dyn: { treble: [{ mark: 'f', beat: 0 }] },
    }]));
    const ev = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest);
    eq('one merged event', ev.length, 1);
    eq('head velocity = f', ev[0].velocity, 0.90);
}

console.log('compilePlayback — drums get dynamics too:');
{
    const comp = compilePlayback({
        instrument: 'drums', timeSignature: '4/4', keySignature: 'C',
        measures: [{ perc: [N(['f/4']), N(['c/5'])], _dyn: { perc: [{ mark: 'pp', beat: 0 }] } }],
    });
    const pv = comp.events.filter((e) => e.voiceId === 'perc' && !e.rest).map((e) => e.velocity);
    eq('drum velocities pp', pv, [0.30, 0.30]);
}

console.log('noteOnsets + indexAtBeat (anchor to note by beat):');
{
    // q,q,h -> онсеты 0,1,2 (четверти). Оттенок на доле 2 -> 3-я нота (idx 2).
    const onsets = noteOnsets([N(['c/4']), N(['d/4']), N(['e/4'], { duration: 'h' })]);
    eq('onsets', onsets, [0, 1, 2]);
    eq('index at beat 2', indexAtBeat(onsets, 2), 2);
    eq('index at beat 1', indexAtBeat(onsets, 1), 1);
    eq('between onsets -> previous', indexAtBeat(onsets, 1.5), 1);
    eq('no notes -> -1', indexAtBeat([], 0), -1);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS dynamics tests passed.');
}
