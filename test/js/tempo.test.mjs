// JS-тест профессиональной tempo system: смены темпа (♩ = N) — нотационные
// объекты, которые компилятор превращает в АБСОЛЮТНОЕ время (domain/tempo +
// compiler). Playback-время резолвится ОДИН раз; scheduler читает готовые
// startSec/durSec. Рендер метки — общий примитив (render/tempo).
import { createRequire } from 'module';
import {
    tempoSpq, buildTempoMap, readTempoMarks, beatUnitQuarters,
} from '../../assets/www/js/domain/tempo.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';
import {
    drawTempoMark, drawTempos, tempoHeadroom, tempoMarkHeadroom, tempoUnitDuration,
} from '../../assets/www/js/render/tempo.js';

const require = createRequire(import.meta.url);
const RealVF = require('../../assets/www/js/vexflow.js').Flow;

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

const N = (k) => ({ keys: [k], duration: 'q', rest: false });
const piano = (measures, tempo) => ({
    instrument: 'piano', timeSignature: '4/4', keySignature: 'C',
    tempo: tempo || 120, measures,
});
const trebleEvents = (comp) => comp.events
    .filter((e) => e.voiceId === 'treble' && !e.rest)
    .sort((a, b) => a.startBeat - b.startBeat);

console.log('domain — tempoSpq & beatUnit:');
near('quarter = 60 -> 1.0 s/quarter', tempoSpq(60, 1), 1.0);
near('quarter = 120 -> 0.5', tempoSpq(120, 1), 0.5);
near('half = 60 (unit 2) -> 0.5', tempoSpq(60, 2), 0.5);
eq('beatUnit default', beatUnitQuarters(undefined), 1);

console.log('domain — buildTempoMap secAt/beatAt (piecewise constant):');
{
    // 120 (0.5) from beat 0; 60 (1.0) from beat 4.
    const m = buildTempoMap([{ beat: 0, spq: 0.5 }, { beat: 4, spq: 1.0 }]);
    near('secAt(0)=0', m.secAt(0), 0);
    near('secAt(4)=2', m.secAt(4), 2);       // 4 quarters × 0.5
    near('secAt(6)=4', m.secAt(6), 4);       // +2 quarters × 1.0
    near('beatAt(2)=4 (inverse)', m.beatAt(2), 4);
    near('beatAt(4)=6 (inverse)', m.beatAt(4), 6);
    near('mid-segment secAt(5)=3', m.secAt(5), 3);
}
{
    // later anchor at same beat wins (change overrides base at beat 0).
    const m = buildTempoMap([{ beat: 0, spq: 0.5 }, { beat: 0, spq: 1.0 }]);
    near('same-beat: later wins', m.secAt(2), 2);
    // missing beat-0 anchor gets synthesized from first.
    const m2 = buildTempoMap([{ beat: 4, spq: 1.0 }]);
    near('synthesized base holds first spq', m2.secAt(4), 4);
}

console.log('domain — readTempoMarks:');
eq('reads _tempo lists',
    readTempoMarks([{ _tempo: [{ bpm: 80, beat: 0 }] }, {}, { _tempo: [{ bpm: 120, beat: 2 }] }]),
    [{ measure: 0, beat: 0, bpm: 80, unit: 1 }, { measure: 2, beat: 2, bpm: 120, unit: 1 }]);

console.log('compiler — tempo change alters playback time, not beats:');
{
    const comp = compilePlayback(piano([
        { treble: [N('c/4'), N('d/4'), N('e/4'), N('f/4')], bass: [] },
        { treble: [N('g/4'), N('a/4'), N('b/4'), N('c/5')], bass: [],
            _tempo: [{ bpm: 60, beat: 0 }] },
    ], 120));
    const ev = trebleEvents(comp);
    // Measure 0 @120: beats 0..3 at 0.5s spacing, dur 0.5.
    eq('measure 0 beats unchanged', ev.slice(0, 4).map((e) => e.startBeat), [0, 1, 2, 3]);
    eq('measure 0 startSec', ev.slice(0, 4).map((e) => r3(e.startSec)), [0, 0.5, 1, 1.5]);
    near('measure 0 durSec = 0.5', ev[0].durSec, 0.5);
    // Measure 1 @60: beats 4..7 at 1.0s spacing, dur 1.0.
    eq('measure 1 beats unchanged', ev.slice(4).map((e) => e.startBeat), [4, 5, 6, 7]);
    eq('measure 1 startSec (slower)', ev.slice(4).map((e) => r3(e.startSec)), [2, 3, 4, 5]);
    near('measure 1 durSec = 1.0 (slower)', ev[4].durSec, 1.0);
    near('totalSec = 2 + 4', comp.totalSec, 6);
}

console.log('compiler — multiple & mid-measure tempo changes:');
{
    // 4/4: 120 base; ♩=240 at beat 2 (mid-measure).
    const comp = compilePlayback(piano([
        { treble: [N('c/4'), N('d/4'), N('e/4'), N('f/4')], bass: [],
            _tempo: [{ bpm: 240, beat: 2 }] },
    ], 120));
    const ev = trebleEvents(comp);
    // beats 0,1 @120 (0.5s); beats 2,3 @240 (0.25s).
    eq('startSec reflects mid-measure change',
        ev.map((e) => r3(e.startSec)), [0, 0.5, 1, 1.25]);
    near('event before change slow', ev[0].durSec, 0.5);
    near('event after change fast', ev[2].durSec, 0.25);
}

console.log('compiler — no tempo mark: base tempo governs (no regression):');
{
    const comp = compilePlayback(piano([{ treble: [N('c/4'), N('d/4')], bass: [] }], 120));
    const ev = trebleEvents(comp);
    eq('base 120 everywhere', ev.map((e) => r3(e.startSec)), [0, 0.5]);
    near('totalSec = 2 (one 4/4 bar @120)', comp.totalSec, 2);
}

console.log('compiler — tempo change repeats with the section:');
{
    // |: A B :|  with ♩=60 in the repeated bar -> applies on BOTH passes.
    const comp = compilePlayback(piano([
        { treble: [N('c/4'), N('d/4'), N('e/4'), N('f/4')], bass: [],
            _repeat: 'end', _tempo: [{ bpm: 60, beat: 0 }] },
    ], 120));
    const ev = trebleEvents(comp);
    // 8 events (played twice). Each bar is 4 quarters @60 = 4s.
    eq('two passes', ev.length, 8);
    eq('startSec across both passes (each pass 4s)',
        ev.map((e) => r3(e.startSec)), [0, 1, 2, 3, 4, 5, 6, 7]);
    near('totalSec = 8', comp.totalSec, 8);
}

console.log('scheduler-compat — every event carries absolute time:');
{
    const comp = compilePlayback(piano([{ treble: [N('c/4')], bass: [] }], 90));
    const e = trebleEvents(comp)[0];
    eq('event has numeric startSec/durSec',
        [typeof e.startSec, typeof e.durSec], ['number', 'number']);
    eq('clicks carry sec', typeof comp.clicks[0].sec, 'number');
    eq('tempoMap exposed for playhead', typeof comp.tempoMap.beatAt, 'function');
}

// --- rendering (shared screen & PDF) -----------------------------------
// Записывающий контекст: полный набор методов StaveNote.draw() + журнал.
function fakeCtx() {
    const rec = {
        glyphs: [], texts: [], lines: [], groups: [], beziers: 0,
        minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
    };
    let cur = null;
    const track = (pts) => {
        for (let i = 0; i + 1 < pts.length; i += 2) {
            rec.minX = Math.min(rec.minX, pts[i]); rec.maxX = Math.max(rec.maxX, pts[i]);
            rec.minY = Math.min(rec.minY, pts[i + 1]); rec.maxY = Math.max(rec.maxY, pts[i + 1]);
        }
    };
    return {
        rec,
        save() {}, restore() {}, setLineWidth() {}, setStrokeStyle() {},
        setFillStyle() {}, setLineDash() {}, setFont() {}, beginPath() {}, stroke() {},
        closePath() {}, fill() {}, rect() {}, fillRect() {},
        arc() {},
        openGroup(cls) {
            const g = { attrs: {}, setAttribute(k, v) { g.attrs[k] = v; } };
            rec.groups.push({ cls, el: g });
            return g;
        },
        closeGroup() {},
        measureText() { return { width: 10 }; },
        moveTo(x, y) { cur = { x, y }; track([x, y]); },
        lineTo(x, y) {
            rec.lines.push({ x0: cur ? cur.x : x, y0: cur ? cur.y : y, x1: x, y1: y });
            cur = { x, y }; track([x, y]);
        },
        bezierCurveTo(a, b, c, d, e, f) { rec.beziers++; cur = { x: e, y: f }; track([a, b, c, d, e, f]); },
        quadraticCurveTo(a, b, c, d) { rec.beziers++; cur = { x: c, y: d }; track([a, b, c, d]); },
        fillText(t, x, y) { rec.texts.push({ t, x, y }); },
    };
}
function mockGlyphVF() {
    class Glyph {
        constructor(code, size) { this.code = code; this.size = size; }
        setContext() { return this; }
        getMetrics() { return { width: 10 }; }
        render(ctx, x, y) { ctx.rec.glyphs.push({ code: this.code, x, y }); }
    }
    return { Glyph };
}

console.log('render — REAL VexFlow engraving (StaveNote, vector group):');
{
    const ctx = fakeCtx();
    drawTempoMark(RealVF, ctx, 100, 50, { duration: 'q', dots: 0, bpm: 120 });
    const grp = ctx.rec.groups.filter((g) => g.cls === 'scoreflow-tempo-note');
    eq('engraved inside dedicated SVG group', grp.length, 1);
    eq('group scaled as vector transform',
        /translate\(.+\) scale\(0\.8\)/.test(grp[0].el.attrs.transform || ''), true);
    eq('genuine glyph outlines (bezier paths), not a font symbol',
        ctx.rec.beziers > 0, true);
    // Укороченный издательский штиль: в нотных координатах (до transform)
    // головка на 60, верх штиля на 38 (длина 22 вместо штатных 35).
    const stem = ctx.rec.lines.find((l) =>
        Math.abs(l.x0 - l.x1) < 0.01 && Math.abs(l.y0 - l.y1) > 5);
    eq('stem drawn, publisher-short (top at 38 in note space)',
        stem && Math.round(stem.y1), 38);
    eq('BPM text "= 120" on the shared baseline y',
        ctx.rec.texts.map((t) => [t.t, t.y]), [['= 120', 50]]);
    // Правый край четвертной в нотных координатах ~28.9 при головке с 17:
    // текст = x + SCALE*(28.9-17) + EQ_GAP(5) ≈ x + 14.5.
    near('text starts after the note with comfortable gap',
        ctx.rec.texts[0].x, 114.5, 1.5);
}
{
    // Любая длительность: восьмая гравируется с настоящим флажком (шире и выше).
    const q = fakeCtx(), e8 = fakeCtx(), w = fakeCtx();
    drawTempoMark(RealVF, q, 0, 0, { duration: 'q', bpm: 60 });
    drawTempoMark(RealVF, e8, 0, 0, { duration: '8', bpm: 60 });
    drawTempoMark(RealVF, w, 0, 0, { duration: 'w', bpm: 60 });
    eq('8th wider than quarter (real flag)', e8.rec.maxX > q.rec.maxX + 5, true);
    eq('whole has no stem (short)', w.rec.maxY - w.rec.minY < 15, true);
    // Кеш: повторная отрисовка того же объекта идемпотентна.
    const q2 = fakeCtx();
    drawTempoMark(RealVF, q2, 0, 0, { duration: 'q', bpm: 60 });
    eq('cached note redraw is identical',
        [q2.rec.minX, q2.rec.minY, q2.rec.maxX, q2.rec.maxY].map(Math.round),
        [q.rec.minX, q.rec.minY, q.rec.maxX, q.rec.maxY].map(Math.round));
    // Пунктирная — рисуется без ошибок (точка — настоящий модификатор).
    const qd = fakeCtx();
    drawTempoMark(RealVF, qd, 0, 0, { duration: 'q', dots: 1, bpm: 60 });
    eq('dotted quarter engraves', qd.rec.groups.length > 0, true);
}

console.log('render — fallback without StaveNote/SVG groups (glyph + stem):');
{
    const ctx = fakeCtx();
    delete ctx.openGroup; // не-SVG контекст -> фолбэк
    drawTempoMark(mockGlyphVF(), ctx, 100, 50, 120);
    eq('notehead glyph drawn', ctx.rec.glyphs.map((g) => g.code), ['noteheadBlack']);
    eq('stem line drawn (vertical, upward)',
        ctx.rec.lines.length === 1 && ctx.rec.lines[0].y1 < ctx.rec.lines[0].y0, true);
    eq('text = "= 120"', ctx.rec.texts.map((t) => t.t), ['= 120']);
}

console.log('render — drawTempos places marks per row via accessors:');
{
    const ctx = fakeCtx();
    delete ctx.openGroup; // фолбэк-режим: глиф несёт координаты напрямую
    drawTempos({
        VF: mockGlyphVF(),
        marks: [{ measure: 0, beat: 0, bpm: 60 }, { measure: 5, beat: 0, bpm: 120 }],
        rowOf: (mi) => (mi === 0 ? 0 : null), // measure 5 off-layout -> skipped
        baselineOf: () => 40,
        ctxOf: () => ctx,
        xOf: (mi) => 20 + mi,
    });
    eq('only laid-out marks drawn (1)', ctx.rec.glyphs.length, 1);
    eq('drawn at accessor x, head lifted above baseline',
        [ctx.rec.glyphs[0].x, ctx.rec.glyphs[0].y], [20, 35.5]);
}

console.log('render — duration mapping & per-duration headroom:');
eq('unit -> duration/dots',
    [1, 2, 4, 0.5, 0.25, 1.5, 3, 0.75].map((u) => {
        const d = tempoUnitDuration(u);
        return d.duration + (d.dots ? '.' : '');
    }),
    ['q', 'h', 'w', '8', '16', 'q.', 'h.', '8.']);
eq('tempoHeadroom: reserves space only with marks',
    [tempoHeadroom([]), tempoHeadroom([{ bpm: 60 }]) > 0], [0, true]);
eq('flagged 8th needs more headroom than quarter; whole needs less',
    [tempoMarkHeadroom({ unit: 0.5 }) > tempoMarkHeadroom({ unit: 1 }),
     tempoMarkHeadroom({ unit: 4 }) < tempoMarkHeadroom({ unit: 1 })], [true, true]);

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS tempo tests passed.');
}
