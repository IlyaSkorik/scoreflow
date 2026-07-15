// [ScoreFlow engine] Dynamics Layer — отрисовка динамических оттенков
// (ppp..fff) НОТНЫМ ШРИФТОМ (SMuFL-глифы через VF.Glyph), отдельным проходом
// ПОСЛЕ нот — как Tie/Slur. Оттенок ставится ПОД станом своего голоса, по центру
// над нотой, к доле которой он привязан. VF и ctx передаются параметрами.
//
// Экранный проход (drawScreenDynamics) использует общий реестр позиций нот
// (state.noteHitIndex) и записанную станами базовую линию (state.staffBottomY).
// Печатный проход живёт в print.js и вызывает общий примитив drawDynamic.
import { state } from '../utils/state.js';
import { voiceListOf } from '../domain/notes.js';
import { DYNAMIC_GLYPH, noteOnsets, indexAtBeat, readHairpins } from '../domain/dynamics.js';
import { effectiveTimeSignatures, measureCapacityQ, measureStarts } from '../domain/timesig.js';
import { dynamicsBaseline, DYN_GLYPH_SIZE } from './dynamics_layout.js';
import { drawHairpins } from './hairpins.js';
import { measureExtents } from '../print/metrics.js';

// Клеф голоса — для модельных габаритов (print/metrics, общие с печатью).
const CLEF_OF = { treble: 'treble', bass: 'bass', perc: 'percussion' };

// Рисует строку-оттенок [markId] нотным шрифтом по ЦЕНТРУ x на базовой линии y.
// Каждая буква (p/m/f/…) — отдельный SMuFL-глиф; ширина берётся из метрик глифа
// для центрирования и набора многобуквенных меток (mf, ppp, …). Рисуется в
// SVG-группе класса sf-dyn (инспектируемость/аудит). Возвращает ГАБАРИТ
// { x0, x1 } нарисованной метки — вилки того же голоса обходят его по X.
export function drawDynamic(VF, ctx, x, y, markId, size) {
    const fontSize = size || DYN_GLYPH_SIZE;
    const letters = String(markId).split('');
    const glyphs = [];
    let total = 0;
    for (let i = 0; i < letters.length; i++) {
        const code = DYNAMIC_GLYPH[letters[i]];
        if (!code) continue;
        const g = new VF.Glyph(code, fontSize);
        // Контекст до измерения — стабильная ширина глифа даже на первом
        // (ещё «холодном») рендере, чтобы центрирование не плавало.
        if (g.setContext) { try { g.setContext(ctx); } catch (e) { /* no-op */ } }
        let w;
        try { w = g.getMetrics().width; } catch (e) { w = fontSize * 0.6; }
        if (!w || w <= 0) w = fontSize * 0.6;
        glyphs.push({ g: g, w: w });
        total += w;
    }
    let gx = x - total / 2;
    const box = { x0: gx, x1: gx + total };
    const grouped = !!ctx.openGroup;
    if (grouped) ctx.openGroup('sf-dyn');
    for (let i = 0; i < glyphs.length; i++) {
        try { glyphs[i].g.render(ctx, gx, y); }
        catch (e) { /* пропуск битого глифа */ }
        gx += glyphs[i].w;
    }
    if (grouped) ctx.closeGroup();
    return box;
}

// Экранный проход. Базовая линия — ОДНА на (система[row]+голос) через общий
// алгоритм dynamicsBaseline: согласованно, под нотами, без столкновений. X
// оттенка = центр его ноты (горизонталь = доля, не двигаем).
export function drawScreenDynamics(VF, ctx, score) {
    const measures = score.measures || [];
    const voices = voiceListOf(score);
    const geom = (state.lastLayout && state.lastLayout.geom) || [];
    const rowOf = function (mi) { return geom[mi] ? geom[mi].row : 0; };

    // --- 1. Согласованная база: низы bbox ВСЕХ нот по (row, voice) ---
    const bottoms = {};   // "row:voice" -> [bottomY...]
    const tops = {};      // "row:voice" -> минимальный Y содержимого (для cap)
    const staffBot = {};  // "row:voice" -> Y нижней линейки
    const staffTop = {};  // "row:voice" -> Y верхней линейки (для cap)
    const seeTop = function (key, y) {
        if (tops[key] == null || y < tops[key]) tops[key] = y;
    };
    for (let mi = 0; mi < measures.length; mi++) {
        const row = rowOf(mi);
        for (let vi = 0; vi < voices.length; vi++) {
            const v = voices[vi];
            const key = row + ':' + v;
            const sb = state.staffBottomY[mi + ':' + v];
            if (sb != null && staffBot[key] == null) staffBot[key] = sb;
            const st = state.staffTopY[mi + ':' + v];
            if (st != null && staffTop[key] == null) staffTop[key] = st;
        }
    }
    for (let h = 0; h < state.noteHits.length; h++) {
        const hh = state.noteHits[h];
        const key = rowOf(hh.m) + ':' + hh.v;
        (bottoms[key] || (bottoms[key] = [])).push(hh.y + hh.h);
        seeTop(key, hh.y);
    }
    // Балки не входят в bbox нот — их низы обязаны попасть в профиль
    // (иначе mf ложится на балку бас-бочки).
    const beams = state.beamBottoms || [];
    for (let b = 0; b < beams.length; b++) {
        const bb = beams[b];
        const key = rowOf(bb.m) + ':' + bb.v;
        (bottoms[key] || (bottoms[key] = [])).push(bb.bottom);
        seeTop(key, bb.top);
    }
    // Модельные габариты (как у печати): скобки туплетов и артикуляции НИЖЕ
    // нот не входят в bbox VexFlow-ноты — базовая линия оттенков обязана
    // пройти и под ними (иначе pp ложится на скобку «3»).
    for (let vi = 0; vi < voices.length; vi++) {
        const v = voices[vi];
        const ext = measureExtents(measures, v, CLEF_OF[v] || 'treble');
        for (let mi = 0; mi < measures.length; mi++) {
            const e = ext[mi];
            if (!e) continue;
            const key = rowOf(mi) + ':' + v;
            if (e.below > 0) {
                const sb = state.staffBottomY[mi + ':' + v];
                if (sb != null) {
                    (bottoms[key] || (bottoms[key] = [])).push(sb + e.below);
                }
            }
            if (e.above > 0) {
                const st = state.staffTopY[mi + ':' + v];
                if (st != null) seeTop(key, st - e.above);
            }
        }
    }

    // --- 2. Базовая линия группы. Для treble в grand staff потолок — верх
    //         СОДЕРЖИМОГО нижнего (bass) стана той же строки (штили баса
    //         поднимаются выше его верхней линейки), не только линейка. ---
    const baseline = {};
    for (const key in staffBot) {
        const parts = key.split(':');
        const row = parts[0], v = parts[1];
        let cap = null;
        if (v === 'treble') {
            cap = staffTop[row + ':bass'];
            const ct = tops[row + ':bass'];
            if (ct != null && (cap == null || ct < cap)) cap = ct;
        }
        baseline[key] = dynamicsBaseline(staffBot[key], bottoms[key], cap);
    }

    // --- 3. Отрисовка: глиф по центру ноты на базовой линии группы.
    //         Габариты нарисованных глифов копятся по (row:voice) — вилки
    //         обходят их по X (издательское «p < f» без касаний). ---
    const dynBoxes = {}; // "row:voice" -> [{x0,x1}...]
    for (let mi = 0; mi < measures.length; mi++) {
        const dynAll = measures[mi] && measures[mi]._dyn;
        if (!dynAll) continue;
        const key0 = rowOf(mi);
        for (let vi = 0; vi < voices.length; vi++) {
            const v = voices[vi];
            const list = dynAll[v];
            if (!list || !list.length) continue;
            const y = baseline[key0 + ':' + v];
            if (y == null) continue;
            const onsets = noteOnsets((measures[mi] && measures[mi][v]) || []);
            for (let k = 0; k < list.length; k++) {
                const d = list[k];
                const idx = indexAtBeat(onsets, d.beat || 0);
                const id = mi + ':' + v + ':' + (idx >= 0 ? idx : -1);
                const hb = state.noteHitIndex[id];
                if (!hb) continue;
                const box = drawDynamic(VF, ctx, hb.x + hb.w / 2, y, d.mark);
                const bk = key0 + ':' + v;
                (dynBoxes[bk] || (dynBoxes[bk] = [])).push(box);
            }
        }
    }

    // --- 4. Вилки (cresc./dim.) — ТОТ ЖЕ базовый уровень, что и оттенки. X доли
    //         берём из позиций нот (state.noteHitIndex), геометрию клина считает
    //         общий слой render/hairpins (тот же код, что и для PDF). ---
    drawScreenHairpins(ctx, measures, geom, baseline, dynBoxes,
        score.timeSignature || '4/4');
}

// X центра доли [localBeat] такта [mi]/[v] на экране: центр ноты этой доли из
// общего реестра позиций (state.noteHitIndex); если ноты на доле нет —
// пропорционально ширине такта (fallback). Возвращает X или null.
function screenXAtBeat(measures, geom, mi, v, localBeat, capsQ) {
    const notes = (measures[mi] && measures[mi][v]) || [];
    const idx = indexAtBeat(noteOnsets(notes), localBeat);
    if (idx >= 0) {
        const hb = state.noteHitIndex[mi + ':' + v + ':' + idx];
        if (hb) return hb.x + hb.w / 2;
    }
    const g = geom[mi];
    if (!g) return null;
    const q = capsQ[mi] || 4;
    return g.x + (q > 0 ? (localBeat / q) : 0) * g.w;
}

// Экранный проход вилок — строит аксессоры и делегирует в общий drawHairpins.
function drawScreenHairpins(ctx, measures, geom, baseline, dynBoxes, tsStr) {
    const hairpins = readHairpins(measures);
    if (!hairpins.length) return;
    const effTs = effectiveTimeSignatures(measures, tsStr);
    const capsQ = effTs.map(measureCapacityQ);
    const starts = measureStarts(capsQ);
    drawHairpins({
        hairpins: hairpins,
        starts: starts,
        rowOf: function (mi) { return geom[mi] ? geom[mi].row : null; },
        geomOf: function (mi) { return geom[mi] ? { x: geom[mi].x, w: geom[mi].w } : null; },
        baselineOf: function (row, v) {
            const y = baseline[row + ':' + v];
            return y == null ? null : y;
        },
        obstaclesOf: function (row, v) { return dynBoxes[row + ':' + v] || null; },
        xAtBeat: function (mi, v, b) { return screenXAtBeat(measures, geom, mi, v, b, capsQ); },
        ctxOf: function () { return ctx; },
    });
}
