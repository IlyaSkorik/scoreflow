// JS-тест профессиональной hairpin system: вилки (cresc./dim.) РАСШИРЯЮТ систему
// динамики. Interpolation живёт в domain/dynamics (velocityTimeline + velocityAt)
// и разрешается ОДИН раз в компиляторе; геометрия клина — в render/hairpins
// (общий код экрана и PDF). Scheduler о вилках не знает.
import {
    readHairpins, hairpinSegments, velocityTimeline, velocityAt,
    HAIRPIN_STEP, DYNAMIC_VELOCITY,
} from '../../assets/www/js/domain/dynamics.js';
import { compilePlayback } from '../../assets/www/js/playback/compiler.js';
import { drawHairpins, HAIRPIN_HALF } from '../../assets/www/js/render/hairpins.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + g + ' want=' + w); }
}
function near(name, got, want, eps) {
    if (Math.abs(got - want) <= (eps || 1e-6)) console.log('  ok   ' + name);
    else { failed++; console.log('  FAIL ' + name + '  got=' + got + ' want=' + want); }
}
const r3 = (x) => Math.round(x * 1000) / 1000;

const N = (k) => ({ keys: [k], duration: 'q', rest: false });
const piano = (measures) =>
    ({ instrument: 'piano', timeSignature: '4/4', keySignature: 'C', measures });
const trebleVels = (comp) => comp.events
    .filter((e) => e.voiceId === 'treble' && !e.rest)
    .sort((a, b) => a.startBeat - b.startBeat).map((e) => r3(e.velocity));

// _hair на такте-начале: { type, voice, sb, em, eb }.
const H = (type, sb, em, eb) => ({ type, voice: 'treble', sb, em, eb });

console.log('domain — readHairpins & hairpinSegments (absolute beats):');
{
    const ms = [
        { treble: [], bass: [], _hair: [H('crescendo', 0, 1, 0)] },
        { treble: [], bass: [] },
    ];
    eq('readHairpins', readHairpins(ms), [{
        type: 'crescendo', voice: 'treble',
        startMeasure: 0, startBeat: 0, endMeasure: 1, endBeat: 0,
    }]);
    // 4/4 -> measureQ 4; segment 0..4 quarters.
    eq('hairpinSegments absolute', hairpinSegments(ms, 'treble', 4),
        [{ start: 0, end: 4, type: 'crescendo' }]);
    eq('other voice ignored', hairpinSegments(ms, 'bass', 4), []);
}

console.log('domain — velocityTimeline anchors & segments:');
{
    // pp @0, ff @4 (m1 b0), crescendo 0..4.
    const ms = [
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'pp', beat: 0 }] },
            _hair: [H('crescendo', 0, 1, 0)] },
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'ff', beat: 0 }] } },
    ];
    const tl = velocityTimeline(ms, 'treble', 4);
    eq('segment start/target = pp..ff',
        [r3(tl.segments[0].startV), r3(tl.segments[0].targetV)], [0.30, 1.00]);
    // no synthetic anchor (real ff at end): anchors are just pp,ff.
    eq('anchors unchanged (target dynamic present)',
        tl.anchors.map((a) => [a.beat, r3(a.velocity)]), [[0, 0.30], [4, 1.00]]);
}
{
    // diminuendo with NO target dynamic -> synthetic anchor at end, held after.
    const ms = [
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'ff', beat: 0 }] },
            _hair: [H('diminuendo', 0, 0, 2)] },
        { treble: [], bass: [] },
    ];
    const tl = velocityTimeline(ms, 'treble', 4);
    const target = r3(DYNAMIC_VELOCITY.ff - HAIRPIN_STEP); // 1.00 - 0.15
    eq('target = ff - step', r3(tl.segments[0].targetV), target);
    eq('synthetic anchor injected at end beat 2',
        tl.anchors.map((a) => [a.beat, r3(a.velocity)]), [[0, 1.00], [2, target]]);
    eq('held after hairpin (beat 3 = target)', r3(velocityAt(tl, 3)), target);
}

console.log('domain — velocityAt interpolation:');
{
    const ms = [
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'pp', beat: 0 }] },
            _hair: [H('crescendo', 0, 1, 0)] },
        { treble: [], bass: [], _dyn: { treble: [{ mark: 'ff', beat: 0 }] } },
    ];
    const tl = velocityTimeline(ms, 'treble', 4);
    near('start = pp', velocityAt(tl, 0), 0.30);
    near('mid = halfway pp..ff', velocityAt(tl, 2), 0.65);
    near('end = ff', velocityAt(tl, 4), 1.00);
    near('smooth quarter point', velocityAt(tl, 1), 0.475);
}

console.log('compiler — crescendo ramps every event (pp -> ff):');
{
    const comp = compilePlayback(piano([
        { treble: [N('c/4'), N('d/4'), N('e/4'), N('f/4')], bass: [],
            _dyn: { treble: [{ mark: 'pp', beat: 0 }] },
            _hair: [H('crescendo', 0, 1, 0)] },
        { treble: [N('g/4'), N('a/4'), N('b/4'), N('c/5')], bass: [],
            _dyn: { treble: [{ mark: 'ff', beat: 0 }] } },
    ]));
    eq('velocities ramp then hold at ff',
        trebleVels(comp), [0.30, 0.475, 0.65, 0.825, 1.00, 1.00, 1.00, 1.00]);
}

console.log('compiler — diminuendo without target holds interpolated end:');
{
    const comp = compilePlayback(piano([
        { treble: [N('c/4'), N('d/4'), N('e/4')], bass: [],
            _dyn: { treble: [{ mark: 'ff', beat: 0 }] },
            _hair: [H('diminuendo', 0, 0, 2)] },
        { treble: [N('g/4')], bass: [] },
    ]));
    // ff=1.00 -> target 0.85 over beats 0..2, then held.
    eq('ramp down then hold', trebleVels(comp), [1.00, 0.925, 0.85, 0.85]);
}

console.log('compiler — no hairpin => unchanged step dynamics (no regression):');
{
    const comp = compilePlayback(piano([{
        treble: [N('c/4'), N('d/4'), N('e/4'), N('f/4')], bass: [],
        _dyn: { treble: [{ mark: 'pp', beat: 0 }, { mark: 'ff', beat: 2 }] },
    }]));
    eq('pp,pp,ff,ff', trebleVels(comp), [0.30, 0.30, 1.00, 1.00]);
}

// --- render geometry (shared by screen & PDF) --------------------------
// Захватываем нарисованные линии клина фейковым ctx.
function fakeCtx() {
    const segs = [];
    let cur = null;
    return {
        _segs: segs,
        save() {}, restore() {},
        setLineWidth() {}, setStrokeStyle() {}, setLineDash() {},
        beginPath() {}, stroke() {},
        moveTo(x, y) { cur = { x0: x, y0: y }; },
        lineTo(x, y) { segs.push({ x0: cur.x0, y0: cur.y0, x1: x, y1: y }); cur = { x0: x, y0: y }; },
    };
}

console.log('render — single-system crescendo is a tip-to-mouth wedge:');
{
    const ctx = fakeCtx();
    drawHairpins({
        hairpins: [{ type: 'crescendo', voice: 'treble', startMeasure: 0, startBeat: 0, endMeasure: 1, endBeat: 0 }],
        starts: [0, 4, 8],
        rowOf: () => 0,
        geomOf: (mi) => ({ x: mi * 100, w: 100 }),
        baselineOf: () => 50,
        xAtBeat: (mi, v, b) => mi * 100 + b * 25,
        ctxOf: () => ctx,
    });
    // center = 50 + HAIRPIN_HALF; tip at x0 (gap 0), mouth at x1 (gap HALF).
    const c = 50 + HAIRPIN_HALF;
    eq('two lines (top & bottom edge)', ctx._segs.length, 2);
    eq('top edge tip->mouth', ctx._segs[0], { x0: 0, y0: c, x1: 100, y1: c - HAIRPIN_HALF });
    eq('bottom edge tip->mouth', ctx._segs[1], { x0: 0, y0: c, x1: 100, y1: c + HAIRPIN_HALF });
}

console.log('render — multi-system hairpin splits into continuous parts:');
{
    const ctx = fakeCtx();
    // m0 on row0, m1 on row1; crescendo 0 .. (m1 beat2)=abs6, total 6.
    drawHairpins({
        hairpins: [{ type: 'crescendo', voice: 'treble', startMeasure: 0, startBeat: 0, endMeasure: 1, endBeat: 2 }],
        starts: [0, 4, 8],
        rowOf: (mi) => mi,
        geomOf: (mi) => ({ x: 0, w: 100 }),
        baselineOf: () => 50,
        xAtBeat: (mi, v, b) => b * 25,
        ctxOf: () => ctx,
    });
    // Row0: beatA0..beatB4 of 6 -> gap 0 .. HALF*4/6. Row1: 4..6 -> HALF*4/6 .. HALF.
    eq('4 lines (2 parts × 2 edges)', ctx._segs.length, 4);
    const gapEndRow0 = r3(HAIRPIN_HALF * 4 / 6);
    const c = 50 + HAIRPIN_HALF;
    near('row0 mouth gap matches row1 start gap (continuous)',
        r3(c - ctx._segs[0].y1), gapEndRow0);
    near('row1 starts at same gap as row0 ended',
        r3(c - ctx._segs[2].y0), gapEndRow0);
    near('row1 ends at full HALF', r3(c - ctx._segs[2].y1), HAIRPIN_HALF);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS hairpin tests passed.');
}
