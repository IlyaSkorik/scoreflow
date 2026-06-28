// JS-тест профессиональных смен РАЗМЕРА по партитуре (node, ESM). Запуск:
//   node test/js/time_signature.test.mjs
// Разрешение действующего размера и ёмкость такта — в ОДНОМ месте
// (domain/timesig); playback-тайминг — в playback-компиляторе. Здесь проверяем:
// действующий размер по тактам, ёмкость/старты, сетку метронома, бимовку по
// размеру, и компилятор (старты/длительности/метроном/dynamics) при mid-score
// сменах метра и составных размерах.
import {
    parseTimeSig,
    effectiveTimeSignatures,
    measureCapacityQ,
    measureStarts,
    measureIndexAtBeat,
    metronomeClicks,
} from '../../assets/www/js/domain/timesig.js';
import { beamGroups } from '../../assets/www/js/render/layout.js';
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

// Такт с опциональной сменой размера (`_ts`) и нотами treble.
const M = (treble, ts) => {
    const m = { treble: treble, bass: [] };
    if (ts) m._ts = ts;
    return m;
};
const N = (keys, opt = {}) =>
    Object.assign({ keys: keys, duration: 'q', rest: false }, opt);
function piano(timeSignature, measures) {
    return {
        instrument: 'piano',
        timeSignature: timeSignature,
        keySignature: 'C',
        measures: measures,
    };
}

console.log('parseTimeSig:');
eq('3/4 -> {3,4}', parseTimeSig('3/4'), { beats: 3, beatValue: 4 });
eq('garbage -> 4/4', parseTimeSig('x'), { beats: 4, beatValue: 4 });

console.log('measureCapacityQ (quarters per measure):');
eq('4/4 = 4', measureCapacityQ({ beats: 4, beatValue: 4 }), 4);
eq('3/4 = 3', measureCapacityQ({ beats: 3, beatValue: 4 }), 3);
eq('5/8 = 2.5', measureCapacityQ({ beats: 5, beatValue: 8 }), 2.5);
eq('7/8 = 3.5', measureCapacityQ({ beats: 7, beatValue: 8 }), 3.5);
eq('12/8 = 6', measureCapacityQ({ beats: 12, beatValue: 8 }), 6);

console.log('effectiveTimeSignatures — measure transitions:');
eq('no changes -> start everywhere',
    effectiveTimeSignatures([M([]), M([]), M([])], '3/4').map((t) => t.beats + '/' + t.beatValue),
    ['3/4', '3/4', '3/4']);
eq('change carries forward',
    effectiveTimeSignatures([M([]), M([], '3/4'), M([]), M([], '7/8')], '4/4')
        .map((t) => t.beats + '/' + t.beatValue),
    ['4/4', '3/4', '3/4', '7/8']);
eq('measure 0 own _ts overrides start',
    effectiveTimeSignatures([M([], '6/8'), M([])], '4/4')
        .map((t) => t.beats + '/' + t.beatValue),
    ['6/8', '6/8']);
eq('empty score -> []', effectiveTimeSignatures([], '4/4'), []);

console.log('measureStarts + measureIndexAtBeat:');
{
    const effTs = effectiveTimeSignatures([M([]), M([], '3/4'), M([], '7/8')], '4/4');
    const caps = effTs.map(measureCapacityQ); // [4,3,3.5]
    const starts = measureStarts(caps);
    eq('starts 0,4,7,10.5', starts, [0, 4, 7, 10.5]);
    eq('beat 0 -> m0', measureIndexAtBeat(starts, 0), 0);
    eq('beat 4 -> m1', measureIndexAtBeat(starts, 4), 1);
    eq('beat 6.9 -> m1', measureIndexAtBeat(starts, 6.9), 1);
    eq('beat 7 -> m2', measureIndexAtBeat(starts, 7), 2);
    eq('beat 999 clamps -> m2', measureIndexAtBeat(starts, 999), 2);
}

console.log('metronomeClicks — accents per measure, adapts to meter change:');
{
    // 4/4 then 3/4: ticks at 0,1,2,3 (accent@0) then 4,5,6 (accent@4).
    const effTs = effectiveTimeSignatures([M([]), M([], '3/4')], '4/4');
    const starts = measureStarts(effTs.map(measureCapacityQ));
    const clicks = metronomeClicks(effTs, starts);
    eq('beats', clicks.map((c) => c.beat), [0, 1, 2, 3, 4, 5, 6]);
    eq('accents', clicks.map((c) => c.accent),
        [true, false, false, false, true, false, false]);
}
{
    // 6/8 compound: 6 eighth-beats per measure, beat = 0.5 quarter, accent@0.
    const effTs = effectiveTimeSignatures([M([], '6/8')], '4/4');
    const starts = measureStarts(effTs.map(measureCapacityQ));
    const clicks = metronomeClicks(effTs, starts);
    eq('6/8 click beats', clicks.map((c) => c.beat), [0, 0.5, 1, 1.5, 2, 2.5]);
    eq('6/8 accent only on 0', clicks.map((c) => c.accent),
        [true, false, false, false, false, false]);
}

console.log('beamGroups — adapts to meter (numbers, not VF objects here):');
// beamGroups вернёт VF.Fraction при наличии Vex; без Vex getDefaultBeamGroups
// бросает и срабатывает фолбэк [1/beatValue]. Проверяем только, что вызов с
// разными размерами не падает и даёт непустой массив — реальная группировка
// проверяется визуально/в рендере (Vex недоступен в node).
{
    const fakeVF = {
        Fraction: function (a, b) { this.a = a; this.b = b; },
        Beam: { getDefaultBeamGroups: function () { throw new Error('no vex'); } },
    };
    const g68 = beamGroups(fakeVF, 6, 8);
    eq('6/8 -> single 3/8 group', [g68.length, g68[0].a, g68[0].b], [1, 3, 8]);
    const g78 = beamGroups(fakeVF, 7, 8);
    eq('7/8 -> 2+2+3', g78.map((f) => f.a + '/' + f.b), ['2/8', '2/8', '3/8']);
    const g98 = beamGroups(fakeVF, 9, 8);
    eq('9/8 -> 3/8 group', [g98.length, g98[0].a], [1, 3]);
}

console.log('compilePlayback — per-measure starts (mid-score meter change):');
{
    // Такт 0 = 4/4 (4 четверти c,d,e,f), такт 1 = 3/4 (3 четверти g,a,b).
    const comp = compilePlayback(piano('4/4', [
        M([N(['c/4']), N(['d/4']), N(['e/4']), N(['f/4'])]),
        M([N(['g/4']), N(['a/4']), N(['b/4'])], '3/4'),
    ]));
    const treble = comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((e) => e.startBeat);
    // 4/4: 0,1,2,3 ; 3/4 начинается на доле 4: 4,5,6.
    eq('starts across meter change', treble, [0, 1, 2, 3, 4, 5, 6]);
    eq('totalBeats = 4 + 3', comp.totalBeats, 7);
    eq('comp.starts', comp.starts, [0, 4, 7]);
    eq('comp.capsQ', comp.capsQ, [4, 3]);
}

console.log('compilePlayback — empty measure rest spans its own meter:');
{
    // Пустой такт 7/8 -> целотактовая пауза длиной 3.5 четверти.
    const comp = compilePlayback(piano('7/8', [M([])]));
    const rest = comp.events.find((e) => e.rest && e.voiceId === 'treble');
    eq('7/8 empty rest = 3.5q', rest.durationBeats, 3.5);
    eq('totalBeats = 3.5', comp.totalBeats, 3.5);
}

console.log('compilePlayback — metronome clicks exposed for scheduler:');
{
    const comp = compilePlayback(piano('4/4', [M([N(['c/4'])]), M([], '3/4')]));
    eq('click count = 4 + 3', comp.clicks.length, 7);
    eq('accents', comp.clicks.map((c) => c.accent),
        [true, false, false, false, true, false, false]);
}

console.log('compilePlayback — dynamics keep absolute beat across meter change:');
{
    // Оттенок f на доле 0 такта 1 (3/4): абсолютная доля = 4 (после 4/4).
    const comp = compilePlayback({
        instrument: 'piano', timeSignature: '4/4', keySignature: 'C',
        measures: [
            M([N(['c/4']), N(['d/4']), N(['e/4']), N(['f/4'])]),
            Object.assign(M([N(['g/4'])], '3/4'),
                { _dyn: { treble: [{ mark: 'f', beat: 0 }] } }),
        ],
    });
    const g = comp.events.find((e) => e.startBeat === 4 && e.voiceId === 'treble');
    eq('note at beat 4 plays forte (0.90)', g.velocity, 0.90);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS time signature tests passed.');
}
