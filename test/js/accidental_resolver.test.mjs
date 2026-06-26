// JS-тест системы альтераций движка (node, ESM). Запуск:
//   node test/js/accidental_resolver.test.mjs
// Реальная высота считается в ОДНОМ месте (playback-компилятор + domain/pitch,
// domain/keysig). Здесь проверяем музыкальные правила: тональность, бекар,
// сброс знаков на границе такта, дубль-диез/бемоль, аккорды, лиги.
import { resolveMidi } from '../../assets/www/js/domain/pitch.js';
import { keySignatureAlterations } from '../../assets/www/js/domain/keysig.js';
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

// Полезный помощник: payload для клавишных.
function piano(keySignature, measures) {
    return {
        instrument: 'piano',
        timeSignature: '4/4',
        keySignature: keySignature,
        measures: measures,
    };
}
const N = (keys, opt = {}) =>
    Object.assign({ keys: keys, duration: 'q', rest: false }, opt);
// midis всех озвученных (не пауза) событий treble в порядке времени.
function trebleMidis(comp) {
    return comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((e) => e.midis);
}

console.log('keySignatureAlterations:');
eq('C -> {}', keySignatureAlterations('C'), {});
eq('D -> f#,c#', keySignatureAlterations('D'), { f: 1, c: 1 });
eq('Bb -> bb,eb', keySignatureAlterations('Bb'), { b: -1, e: -1 });
eq('F# -> 6 sharps', keySignatureAlterations('F#'),
    { f: 1, c: 1, g: 1, d: 1, a: 1, e: 1 });

console.log('resolveMidi (unit):');
eq('C f/4 = 65', resolveMidi('f/4', keySignatureAlterations('C'), {}), 65);
eq('D f/4 = 66 (keysig)', resolveMidi('f/4', keySignatureAlterations('D'), {}), 66);
eq('D fn/4 = 65 (natural cancels)',
    resolveMidi('fn/4', keySignatureAlterations('D'), {}), 65);
eq('f##/4 = 67 (double sharp)', resolveMidi('f##/4', {}, {}), 67);
eq('ebb/4 = 62 (double flat)', resolveMidi('ebb/4', {}, {}), 62);

console.log('compilePlayback — key signature interaction:');
{
    // D-dur: f (по тональности -> F#), затем fn (бекар -> F).
    const comp = compilePlayback(piano('D', [{
        treble: [N(['f/4']), N(['fn/4'])], bass: [],
    }]));
    eq('D: [f, fn] -> [[66],[65]]', trebleMidis(comp), [[66], [65]]);
}

console.log('compilePlayback — measure accidental carry + reset:');
{
    // Такт 0: f# затем f (наследует диез -> 66,66). Такт 1: f (сброс -> 65).
    const comp = compilePlayback(piano('C', [
        { treble: [N(['f#/4']), N(['f/4'])], bass: [] },
        { treble: [N(['f/4'])], bass: [] },
    ]));
    eq('carry within measure + reset next', trebleMidis(comp),
        [[66], [66], [65]]);
}

console.log('compilePlayback — accidental is per (step+octave):');
{
    // f#/4 не влияет на f/5 (другая октава).
    const comp = compilePlayback(piano('C', [{
        treble: [N(['f#/4']), N(['f/5'])], bass: [],
    }]));
    eq('f#4 does not alter f5', trebleMidis(comp), [[66], [77]]);
}

console.log('compilePlayback — double sharp / double flat:');
{
    const comp = compilePlayback(piano('C', [{
        treble: [N(['f##/4']), N(['ebb/4'])], bass: [],
    }]));
    eq('[f##, ebb] -> [[67],[62]]', trebleMidis(comp), [[67], [62]]);
}

console.log('compilePlayback — chord with mixed per-notehead accidentals:');
{
    // Аккорд C-natural / Eb / G# -> [60, 63, 68].
    const comp = compilePlayback(piano('C', [{
        treble: [N(['c/4', 'eb/4', 'g#/4'])], bass: [],
    }]));
    eq('chord midis', trebleMidis(comp), [[60, 63, 68]]);
}

console.log('compilePlayback — tie merge keeps head pitch + sums duration:');
{
    // c/4 (h, tie) + c/4 (h) -> одно событие midi 60, длительность 2+2=4 четверти.
    const comp = compilePlayback(piano('C', [{
        treble: [
            N(['c/4'], { duration: 'h', tieToNext: true }),
            N(['c/4'], { duration: 'h' }),
        ],
        bass: [],
    }]));
    const ev = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest);
    eq('tie merged into 1 event', ev.length, 1);
    eq('tied event midi', ev[0].midis, [60]);
    eq('tied event duration (4 quarters)', ev[0].durationBeats, 4);
}

console.log('compilePlayback — drums carry no pitch (midis empty):');
{
    const comp = compilePlayback({
        instrument: 'drums', timeSignature: '4/4', keySignature: 'C',
        measures: [{ perc: [N(['f/4']), N(['g/5/x2'])] }],
    });
    const ev = comp.events.filter((e) => e.voiceId === 'perc' && !e.rest);
    eq('drum events have empty midis', ev.map((e) => e.midis), [[], []]);
    eq('drum keys preserved', ev.map((e) => e.keys), [['f/4'], ['g/5/x2']]);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS accidental tests passed.');
}
