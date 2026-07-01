// JS-тест профессиональной articulation system: артикуляции — ПОСЛЕДНИЙ
// выразительный слой playback ПОСЛЕ динамики/вилок (domain/articulations +
// компилятор) и модификаторы VexFlow при рендере (render/layout.buildVoice,
// общий код экрана и PDF). Scheduler об артикуляциях не знает.
import {
    ARTICULATION_SPEC, ARTICULATION_VELOCITY_MAX, parseArticulation,
    articulationGlyph, articulationEffect, applyArticulations,
} from '../../assets/www/js/domain/articulations.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';
import { buildVoice } from '../../assets/www/js/render/layout.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + g + ' want=' + w); }
}
function near(name, got, want, eps) {
    if (Math.abs(got - want) <= (eps || 1e-9)) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + got + ' want=' + want); }
}
const r3 = (x) => Math.round(x * 1000) / 1000;

const N = (k, art) => ({ keys: [k], duration: 'q', rest: false, ...(art ? { art } : {}) });
const piano = (measures) =>
    ({ instrument: 'piano', timeSignature: '4/4', keySignature: 'C', measures });
const evOf = (comp, v) => comp.events
    .filter((e) => e.voiceId === v && !e.rest)
    .sort((a, b) => a.startBeat - b.startBeat);

console.log('domain — spec, parsing, glyphs:');
eq('five core articulations defined',
    Object.keys(ARTICULATION_SPEC).sort(),
    ['accent', 'marcato', 'staccatissimo', 'staccato', 'tenuto']);
eq('parseArticulation known/unknown',
    [parseArticulation('staccato'), parseArticulation('bogus')], ['staccato', null]);
eq('glyph codes (VexFlow)',
    ['staccato', 'staccatissimo', 'accent', 'marcato', 'tenuto'].map(articulationGlyph),
    ['a.', 'av', 'a>', 'a^', 'a-']);

console.log('domain — articulationEffect composition:');
eq('single staccato', articulationEffect(['staccato']),
    { duration: 0.5, velocity: 1, attack: 1 });
{
    // staccato + accent compose multiplicatively.
    const e = articulationEffect(['staccato', 'accent']);
    near('duration 0.5×1.0', e.duration, 0.5);
    near('velocity 1.0×1.25', e.velocity, 1.25);
    near('attack 1.0×1.15', e.attack, 1.15);
}

console.log('domain — applyArticulations mutates the event:');
{
    const e = { durationBeats: 1, velocity: 0.75, attack: 1, release: 1 };
    applyArticulations(e, ['staccato']);
    near('staccato duration halved', e.durationBeats, 0.5);
    near('staccato velocity unchanged', e.velocity, 0.75);
    near('staccato release reflects shortening', e.release, 0.5);
}
{
    const e = { durationBeats: 1, velocity: 0.75, attack: 1, release: 1 };
    applyArticulations(e, ['tenuto']);
    near('tenuto slightly longer', r3(e.durationBeats), 1.02);
    near('tenuto softer velocity', r3(e.velocity), 0.712);
    near('tenuto softer attack', e.attack, 0.9);
}
{
    // velocity clamp: accent on ff (1.0) -> 1.25 (below max); marcato on ff -> 1.35 clamps.
    const e = { durationBeats: 1, velocity: 1.0, attack: 1, release: 1 };
    applyArticulations(e, ['marcato']);
    near('marcato velocity clamped to max', e.velocity, ARTICULATION_VELOCITY_MAX);
    near('marcato shortens duration', r3(e.durationBeats), 0.8);
}

console.log('compiler — articulations modify PlaybackEvent (duration/velocity/attack):');
{
    const comp = compilePlayback(piano([{
        treble: [N('c/4', ['staccato']), N('d/4', ['accent']), N('e/4'), N('f/4', ['tenuto'])],
        bass: [],
    }]));
    const ev = evOf(comp, 'treble');
    near('staccato: 50% duration', ev[0].durationBeats, 0.5);
    near('staccato: default velocity mf', ev[0].velocity, 0.75);
    near('accent: velocity boosted', r3(ev[1].velocity), r3(0.75 * 1.25));
    near('accent: attack boosted', ev[1].attack, 1.15);
    near('plain note: full duration', ev[2].durationBeats, 1);
    near('plain note: neutral attack', ev[2].attack, 1);
    near('tenuto: duration ~102%', r3(ev[3].durationBeats), 1.02);
    near('tenuto: softer attack', ev[3].attack, 0.9);
}

console.log('compiler — articulation is the LAST layer (after dynamics):');
{
    // ff dynamic then accent -> 1.0 * 1.25 clamps to max, not recomputed elsewhere.
    const comp = compilePlayback(piano([{
        treble: [N('c/4', ['accent'])], bass: [],
        _dyn: { treble: [{ mark: 'ff', beat: 0 }] },
    }]));
    const ev = evOf(comp, 'treble');
    near('accent applied on top of ff', ev[0].velocity, Math.min(ARTICULATION_VELOCITY_MAX, 1.0 * 1.25));
}

console.log('compiler — no articulation => unchanged (no regression):');
{
    const comp = compilePlayback(piano([{ treble: [N('c/4'), N('d/4')], bass: [] }]));
    const ev = evOf(comp, 'treble');
    eq('durations & velocities untouched',
        ev.map((e) => [e.durationBeats, e.velocity]), [[1, 0.75], [1, 0.75]]);
}

// --- rendering (shared screen & PDF via buildVoice) --------------------
// Мок VexFlow: ровно то, что использует buildVoice. stemDir управляем — так
// проверяем правило размещения (штиль вверх -> под нотой, вниз -> над).
function mockVF(stemDir) {
    const Position = { ABOVE: 'ABOVE', BELOW: 'BELOW' };
    class Articulation {
        constructor(code) { this.code = code; this.position = null; }
        setPosition(p) { this.position = p; return this; }
    }
    class StaveNote {
        constructor(o) { this.o = o; this.mods = []; }
        addModifier(m, i) { this.mods.push({ m, i }); return this; }
        setStyle() {}
        getStemDirection() { return stemDir; }
    }
    class Accidental { constructor(a) { this.a = a; } }
    const Dot = { buildAndAttach() {} };
    class Voice {
        constructor() { this.tk = []; }
        setMode() {} addTickables(t) { this.tk = t; } getTickables() { return this.tk; }
    }
    Voice.Mode = { SOFT: 1 };
    return { Articulation, StaveNote, Accidental, Dot, Voice,
        Modifier: { Position }, Fraction: class {} };
}
function firstNote(VF, note, clef) {
    const v = buildVoice(VF, [note], clef || 'treble', 4, 4, -1, 0, 'treble');
    return v.getTickables()[0];
}

console.log('render — articulation attached as VexFlow modifier:');
{
    const sn = firstNote(mockVF(1), N('c/4', ['staccato']));
    eq('one modifier added', sn.mods.length, 1);
    eq('modifier glyph = staccato code', sn.mods[0].m.code, 'a.');
}
console.log('render — placement opposite the stem:');
{
    const up = firstNote(mockVF(1), N('c/4', ['accent']));   // stem up -> below
    const down = firstNote(mockVF(-1), N('g/5', ['accent'])); // stem down -> above
    eq('stem-up -> BELOW', up.mods[0].m.position, 'BELOW');
    eq('stem-down -> ABOVE', down.mods[0].m.position, 'ABOVE');
}
console.log('render — multiple articulations stack; rests get none:');
{
    const sn = firstNote(mockVF(1), N('c/4', ['staccato', 'accent']));
    eq('two modifiers', sn.mods.map((x) => x.m.code), ['a.', 'a>']);
    const rest = firstNote(mockVF(1), { keys: [], duration: 'q', rest: true, art: ['staccato'] });
    eq('rest gets no articulation', rest.mods.length, 0);
}
console.log('render — drum & grand-staff (bass clef) use the same path:');
{
    const perc = firstNote(mockVF(1), N('c/5', ['accent']), 'percussion');
    eq('drum note articulated', perc.mods[0].m.code, 'a>');
    const bass = firstNote(mockVF(-1), N('c/3', ['tenuto']), 'bass');
    eq('bass-clef note articulated ABOVE (stem down)',
        [bass.mods[0].m.code, bass.mods[0].m.position], ['a-', 'ABOVE']);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS articulation tests passed.');
}
