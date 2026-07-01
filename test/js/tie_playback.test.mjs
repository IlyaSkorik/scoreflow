// JS-тест лиг длительности (Tie) в playback ВМЕСТЕ с разворотом порядка
// (repeat / volta). Лига через границу такта сливается в одно звучащее событие
// (один attack, суммарная длительность) — но «следующая» нота лиги определяется
// порядком ВОСПРОИЗВЕДЕНИЯ, поэтому слияние идёт ПОСЛЕ repeat/volta-разворота
// (compiler.mergeTies на развёрнутых событиях). Регрессия: слияние на линейных
// событиях роняло ноту в начале повторяемой секции и затягивало лигу на
// пропускаемую вольту.
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + g + ' want=' + w); }
}

const H = (k, tie) => ({ keys: [k], duration: 'h', rest: false, ...(tie ? { tieToNext: true } : {}) });
const piano = (measures) => ({
    instrument: 'piano', keySignature: 'C', timeSignature: '4/4', tempo: 120, measures,
});
const treble = (comp) => comp.events
    .filter((e) => e.voiceId === 'treble' && !e.rest)
    .map((e) => ({ id: e.noteId, b: e.startBeat, dur: e.durationBeats, k: e.keys[0] }));

console.log('tie + repeat — note at downbeat of repeated section is NOT dropped:');
{
    // |: (c c~) (c d) :|  — лига из первого такта в начало повторяемой секции.
    // На 2-м проходе такта-1 нота c ОБЯЗАНА атаковать заново (лига-источник в
    // такте-0 не переигрывается). Порядок [0,1,1].
    const comp = compilePlayback(piano([
        { treble: [H('c/4'), H('c/4', true)], bass: [], _repeat: 'start' },
        { treble: [H('c/4'), H('d/4')], bass: [], _repeat: 'end' },
    ]));
    eq('order', comp.measureOrder, [0, 1, 1]);
    eq('expanded treble events', treble(comp), [
        { id: '0:treble:0', b: 0, dur: 2, k: 'c/4' },
        { id: '0:treble:1', b: 2, dur: 4, k: 'c/4' },   // лига 1-го прохода: c держится в такт-1
        { id: '1:treble:1', b: 6, dur: 2, k: 'd/4' },
        { id: '1:treble:0', b: 8, dur: 2, k: 'c/4' },   // 2-й проход: c атакует заново (был бы потерян)
        { id: '1:treble:1', b: 10, dur: 2, k: 'd/4' },
    ]);
}

console.log('tie + volta — tie into first ending does NOT bleed over the second ending:');
{
    // A B (g g~) | 1.(g a) :| 2.(b b)  — лига из такта C в ПЕРВУЮ концовку.
    // 1-й проход: g держится в 1-ю концовку (dur 4). 2-й проход: 1-я концовка
    // ПРОПУСКАЕТСЯ (сразу 2-я), поэтому g сохраняет свою длительность (dur 2) и
    // не наезжает на 2-ю концовку. Порядок [0,1,2,3,0,1,2,4].
    const comp = compilePlayback(piano([
        { treble: [H('c/4'), H('d/4')], bass: [] },
        { treble: [H('e/4'), H('f/4')], bass: [] },
        { treble: [H('g/4'), H('g/4', true)], bass: [] },
        { treble: [H('g/4'), H('a/4')], bass: [], _repeat: 'end', _volta: { n: [1] } },
        { treble: [H('b/4'), H('b/4')], bass: [], _volta: { n: [2] } },
    ]));
    eq('order', comp.measureOrder, [0, 1, 2, 3, 0, 1, 2, 4]);
    const g1 = treble(comp).find((n) => n.b === 10); // tied g, 1-й проход
    const g2 = treble(comp).find((n) => n.b === 26); // tied g, 2-й проход
    eq('1st pass: tied g merges into first ending (dur 4)', g1,
        { id: '2:treble:1', b: 10, dur: 4, k: 'g/4' });
    eq('2nd pass: tied g keeps own length, no bleed (dur 2)', g2,
        { id: '2:treble:1', b: 26, dur: 2, k: 'g/4' });
    eq('second ending plays clean right after', treble(comp).find((n) => n.b === 28),
        { id: '4:treble:0', b: 28, dur: 2, k: 'b/4' });
}

console.log('tie — plain merges still work (no repeat/volta regression):');
{
    // Простая лига через границу такта без разворота: две половинки c -> одно
    // событие целой длительности.
    const comp = compilePlayback(piano([
        { treble: [H('c/4'), H('c/4', true)], bass: [] },
        { treble: [H('c/4'), H('d/4')], bass: [] },
    ]));
    eq('order', comp.measureOrder, [0, 1]);
    eq('cross-bar tie merges to one attack', treble(comp), [
        { id: '0:treble:0', b: 0, dur: 2, k: 'c/4' },
        { id: '0:treble:1', b: 2, dur: 4, k: 'c/4' }, // c~ + c = целая (dur 4), один attack
        { id: '1:treble:1', b: 6, dur: 2, k: 'd/4' },
    ]);
}

console.log('tie — chain within a measure merges to one event:');
{
    const comp = compilePlayback(piano([
        { treble: [H('c/4', true), H('c/4', true)], bass: [] }, // c~ c~ -> chain, но такт вмещает 2 половинки
    ]));
    eq('chained ties collapse to single sustained note', treble(comp), [
        { id: '0:treble:0', b: 0, dur: 4, k: 'c/4' },
    ]);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS tie-playback tests passed.');
}
