// JS-тест СКВОЗНОГО playback динамики (node, ESM). Запуск:
//   node test/js/dynamics_playback.test.mjs
// Проверяет ВЕСЬ путь громкости одной правдой:
//   Dynamic -> compilePlayback() -> PlaybackEvent.velocity -> velocityGain() -> Web Audio gain
// без аудиоустройства: гоняем РЕАЛЬНЫЙ компилятор и РЕАЛЬНУЮ кривую velocity->gain
// (та же функция, что вызывают SampledPiano/SampledDrums/синтез) и считаем, что
// разница громкостей pp/mf/ff/fff заведомо слышима (в дБ). Заодно: chords,
// tuplets, ties, drums, и что нигде нет константной громкости.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';
import { velocityGain } from '../../assets/www/js/audio/velocity.js';

const __dir = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
const db = (a, b) => 20 * Math.log10(a / b);
const r3 = (x) => Math.round(x * 1000) / 1000;

const N = (keys, opt = {}) =>
    Object.assign({ keys: keys, duration: 'q', rest: false }, opt);
const piano = (measures) =>
    ({ instrument: 'piano', timeSignature: '4/4', keySignature: 'C', measures });
// Громкость события рояля так же, как в SampledPiano.noteOn (peak 0.85, потолок).
const pianoGain = (vel) => Math.min(0.95, velocityGain(vel, 0.85));
const drumGain = (vel) => Math.min(1.0, velocityGain(vel, 0.92));

function vOf(comp, voice) {
    return comp.events.filter((e) => e.voiceId === voice && !e.rest)
        .sort((a, b) => a.startBeat - b.startBeat).map((e) => e.velocity);
}

// === 1. Демо-партитура pp/mf/ff с ОДИНАКОВЫМИ нотами =====================
console.log('demo score (pp / mf / ff — identical notes c/5):');
{
    const score = JSON.parse(
        readFileSync(join(__dir, 'fixtures', 'dynamics_demo_score.json'), 'utf8'));
    const comp = compilePlayback(score);
    const vels = vOf(comp, 'treble');
    ok('three events, velocities pp,mf,ff survive compile',
        JSON.stringify(vels) === JSON.stringify([0.30, 0.75, 1.00]),
        'got=' + JSON.stringify(vels));
    const gp = vels.map(pianoGain);
    console.log('     gains  pp=' + r3(gp[0]) + '  mf=' + r3(gp[1]) + '  ff=' + r3(gp[2]));
    console.log('     pp->mf ' + r3(db(gp[1], gp[0])) + ' dB,  mf->ff ' +
        r3(db(gp[2], gp[1])) + ' dB,  pp->ff ' + r3(db(gp[2], gp[0])) + ' dB');
    ok('mf clearly louder than pp (>=4 dB)', db(gp[1], gp[0]) >= 4);
    ok('ff clearly louder than mf (>=2 dB)', db(gp[2], gp[1]) >= 2);
    ok('ff vs pp wide (>=8 dB)', db(gp[2], gp[0]) >= 8);
    ok('monotonic pp<mf<ff', gp[0] < gp[1] && gp[1] < gp[2]);
}

// === 2. Полный маппинг + ff != fff (был баг clamp 127) ==================
console.log('full velocity curve (piano gain per mark):');
{
    const marks = [['ppp', 0.20], ['pp', 0.30], ['p', 0.45], ['mp', 0.60],
        ['mf', 0.75], ['f', 0.90], ['ff', 1.00], ['fff', 1.10]];
    let prev = -1, monotonic = true;
    for (let i = 0; i < marks.length; i++) {
        const g = pianoGain(marks[i][1]);
        if (g <= prev) monotonic = false;
        prev = g;
        console.log('     ' + marks[i][0].padEnd(3) + ' v=' + marks[i][1] +
            ' -> gain ' + r3(g));
    }
    ok('gain strictly increases across ALL marks', monotonic);
    ok('fff strictly louder than ff (clamp bug fixed)',
        pianoGain(1.10) > pianoGain(1.00),
        'ff=' + r3(pianoGain(1.0)) + ' fff=' + r3(pianoGain(1.1)));
    ok('ppp audible (gain > 0.05)', pianoGain(0.20) > 0.05);
}

// === 3. Chords: оттенок на ВСЕ головки (одно событие, все midis) ========
console.log('chords carry the dynamic:');
{
    const comp = compilePlayback(piano([{
        treble: [N(['c/4', 'e/4', 'g/4'])], bass: [],
        _dyn: { treble: [{ mark: 'ff', beat: 0 }] },
    }]));
    const ev = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest);
    ok('one chord event', ev.length === 1);
    ok('chord has 3 heads', ev[0].midis.length === 3);
    ok('chord velocity = ff (applies to all heads)', ev[0].velocity === 1.00);
}

// === 4. Tuplets: оттенок на нотах триоли ================================
console.log('tuplets carry the dynamic:');
{
    const t = { actual: 3, normal: 2 };
    const comp = compilePlayback(piano([{
        treble: [
            N(['c/4'], { duration: '8', tuplet: t, tupletStart: true }),
            N(['d/4'], { duration: '8', tuplet: t }),
            N(['e/4'], { duration: '8', tuplet: t }),
        ],
        bass: [],
        _dyn: { treble: [{ mark: 'pp', beat: 0 }] },
    }]));
    ok('all triplet notes pp', JSON.stringify(vOf(comp, 'treble')) ===
        JSON.stringify([0.30, 0.30, 0.30]));
}

// === 5. Tied notes: слитое событие держит атаку оттенка =================
console.log('tied notes keep attack dynamic:');
{
    const comp = compilePlayback(piano([{
        treble: [N(['c/4'], { duration: 'h', tieToNext: true }), N(['c/4'], { duration: 'h' })],
        bass: [],
        _dyn: { treble: [{ mark: 'f', beat: 0 }] },
    }]));
    const ev = comp.events.filter((e) => e.voiceId === 'treble' && !e.rest);
    ok('tie merged to 1 event', ev.length === 1);
    ok('merged velocity = f', ev[0].velocity === 0.90);
}

// === 6. Drums: оттенок -> разная громкость удара ========================
console.log('drum playback responds to dynamics:');
{
    const comp = compilePlayback({
        instrument: 'drums', timeSignature: '4/4', keySignature: 'C',
        measures: [
            { perc: [N(['c/5'])], _dyn: { perc: [{ mark: 'pp', beat: 0 }] } },
            { perc: [N(['c/5'])], _dyn: { perc: [{ mark: 'ff', beat: 0 }] } },
        ],
    });
    const vels = vOf(comp, 'perc');
    ok('perc velocities pp,ff', JSON.stringify(vels) === JSON.stringify([0.30, 1.00]));
    const gp = vels.map(drumGain);
    console.log('     drum gains pp=' + r3(gp[0]) + ' ff=' + r3(gp[1]) +
        '  (' + r3(db(gp[1], gp[0])) + ' dB)');
    ok('drum ff clearly louder than pp (>=8 dB)', db(gp[1], gp[0]) >= 8);
}

// === 7. Нет константной громкости: каждое событие несёт СВОЙ velocity ===
console.log('no constant gain — velocity differs per event:');
{
    const comp = compilePlayback(piano([{
        treble: [N(['c/4']), N(['d/4']), N(['e/4']), N(['f/4'])], bass: [],
        _dyn: { treble: [{ mark: 'pp', beat: 0 }, { mark: 'ff', beat: 2 }] },
    }]));
    const vels = vOf(comp, 'treble');
    ok('pp,pp,ff,ff (mark switches mid-measure)',
        JSON.stringify(vels) === JSON.stringify([0.30, 0.30, 1.00, 1.00]));
    ok('distinct gains present', new Set(vels.map(pianoGain)).size === 2);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS dynamics-playback tests passed.');
}
