// JS-тест профессиональных смен тональности по партитуре (node, ESM). Запуск:
//   node test/js/key_signature.test.mjs
// Разрешение действующей тональности — в ОДНОМ месте (domain/keysig), playback
// высоты — в playback-компиляторе. Здесь проверяем: действующую тональность по
// тактам, правило отмены (courtesy naturals), переключение высоты playback на
// такте смены, сброс знаков такта через границу смены, серию смен.
import {
    effectiveKeys,
    cancelKeyFor,
    keySignatureAlterations,
} from '../../assets/www/js/domain/keysig.js';
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

// Такт с опциональной сменой тональности (`_key`) и нотами treble.
const M = (treble, key) => {
    const m = { treble: treble, bass: [] };
    if (key) m._key = key;
    return m;
};
const N = (keys, opt = {}) =>
    Object.assign({ keys: keys, duration: 'q', rest: false }, opt);
function piano(keySignature, measures) {
    return {
        instrument: 'piano',
        timeSignature: '4/4',
        keySignature: keySignature,
        measures: measures,
    };
}
function trebleMidis(comp) {
    return comp.events
        .filter((e) => e.voiceId === 'treble' && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((e) => e.midis);
}

console.log('effectiveKeys — measure transitions:');
eq('no changes -> start key everywhere',
    effectiveKeys([M([]), M([]), M([])], 'G'), ['G', 'G', 'G']);
eq('change at measure 1 carries forward',
    effectiveKeys([M([]), M([], 'D'), M([])], 'C'), ['C', 'D', 'D']);
eq('measure 0 own key overrides start',
    effectiveKeys([M([], 'F'), M([])], 'C'), ['F', 'F']);
eq('series of changes',
    effectiveKeys([M([], 'G'), M([]), M([], 'Bb'), M([], 'C')], 'C'),
    ['G', 'G', 'Bb', 'C']);
eq('empty score -> []', effectiveKeys([], 'C'), []);
eq('missing measures -> []', effectiveKeys(undefined, 'C'), []);

console.log('cancelKeyFor — courtesy naturals rule:');
// Отмена = предыдущая тональность, если она сменилась (её знаки гасятся
// бекарами по правилам гравировки; глифы рисует VexFlow по cancelKey).
eq('G -> C cancels G (F# -> natural)', cancelKeyFor('G', 'C'), 'G');
eq('D -> Bb cancels D (sharps -> flats)', cancelKeyFor('D', 'Bb'), 'D');
eq('same key -> no cancellation', cancelKeyFor('G', 'G'), null);
eq('initial (prev null) -> no cancellation', cancelKeyFor(null, 'G'), null);
// Документируем, ЧТО именно гасится: знаки прежней тональности.
eq('G has F#', keySignatureAlterations('G'), { f: 1 });
eq('D has F#,C#', keySignatureAlterations('D'), { f: 1, c: 1 });

console.log('compilePlayback — playback switches pitch at key-change measure:');
{
    // Такт 0: C-dur, f/4 = 65 (F). Такт 1: смена на D-dur, f/4 = 66 (F#).
    const comp = compilePlayback(piano('C', [
        M([N(['f/4'])]),
        M([N(['f/4'])], 'D'),
    ]));
    eq('C then D: f -> [[65],[66]]', trebleMidis(comp), [[65], [66]]);
}

console.log('compilePlayback — change back to C cancels the sharp:');
{
    // G-dur (F#) -> такт 1 смена на C: f/4 снова 65.
    const comp = compilePlayback(piano('G', [
        M([N(['f/4'])]),
        M([N(['f/4'])], 'C'),
    ]));
    eq('G then C: f -> [[66],[65]]', trebleMidis(comp), [[66], [65]]);
}

console.log('compilePlayback — measure accidental does not leak across key change:');
{
    // Такт 0: D-dur, явный fn (бекар -> 65), затем f (наследует бекар такта -> 65).
    // Такт 1: смена на C-dur. f/4 = 65 (тональность C; знак прошлого такта сброшен).
    const comp = compilePlayback(piano('D', [
        M([N(['fn/4']), N(['f/4'])]),
        M([N(['f/4'])], 'C'),
    ]));
    eq('accidental reset on new measure + key', trebleMidis(comp),
        [[65], [65], [65]]);
}

console.log('compilePlayback — measure 0 own _key overrides start key:');
{
    // Стартовая C, но такт 0 объявляет D: f/4 = 66.
    const comp = compilePlayback(piano('C', [M([N(['f/4'])], 'D')]));
    eq('measure-0 key override', trebleMidis(comp), [[66]]);
}

console.log('compilePlayback — explicit accidental still overrides key:');
{
    // Такт 1: смена на D (F#), но явный fn -> 65; следующий f наследует бекар.
    const comp = compilePlayback(piano('C', [
        M([N(['f/4'])]),
        M([N(['fn/4']), N(['f/4'])], 'D'),
    ]));
    eq('explicit natural beats new key', trebleMidis(comp),
        [[65], [65], [65]]);
}

console.log('compilePlayback — accidental normalization preserves sound:');
{
    // Инвариант редакторской нормализации (Dart models/keysig): удаление
    // ИЗБЫТОЧНОГО знака (дающего ту же высоту, что тональность) не меняет звук.
    // До: F# явный в G-dur. После: без знака (следует тональности G -> F#).
    const before = compilePlayback(piano('G', [M([N(['f#/4'])])]));
    const after = compilePlayback(piano('G', [M([N(['f/4'])])]));
    eq('redundant sharp removal: identical midis',
        trebleMidis(after), trebleMidis(before));
}
{
    // Внутритактовый перенос: F-натурал (значим) затем F# (обязателен) — после
    // нормализации запись не меняется, звук [F, F#] сохраняется.
    const comp = compilePlayback(piano('G', [
        M([N(['fn/4']), N(['f#/4'])]),
    ]));
    eq('kept natural + sharp -> [F, F#]', trebleMidis(comp), [[65], [66]]);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS key signature tests passed.');
}
