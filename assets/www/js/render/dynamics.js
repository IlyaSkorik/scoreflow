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
import { DYNAMIC_GLYPH, noteOnsets, indexAtBeat } from '../domain/dynamics.js';
import { dynamicsBaseline, DYN_GLYPH_SIZE } from './dynamics_layout.js';

// Рисует строку-оттенок [markId] нотным шрифтом по ЦЕНТРУ x на базовой линии y.
// Каждая буква (p/m/f/…) — отдельный SMuFL-глиф; ширина берётся из метрик глифа
// для центрирования и набора многобуквенных меток (mf, ppp, …).
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
    for (let i = 0; i < glyphs.length; i++) {
        try { glyphs[i].g.render(ctx, gx, y); }
        catch (e) { /* пропуск битого глифа */ }
        gx += glyphs[i].w;
    }
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
    const staffBot = {};  // "row:voice" -> Y нижней линейки
    const staffTop = {};  // "row:voice" -> Y верхней линейки (для cap)
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
    }

    // --- 2. Базовая линия группы. Для treble в grand staff потолок = верх
    //         нижнего (bass) стана той же строки, чтобы не залезть на него. ---
    const baseline = {};
    for (const key in staffBot) {
        const parts = key.split(':');
        const row = parts[0], v = parts[1];
        const cap = (v === 'treble') ? staffTop[row + ':bass'] : null;
        baseline[key] = dynamicsBaseline(staffBot[key], bottoms[key], cap);
    }

    // --- 3. Отрисовка: глиф по центру ноты на базовой линии группы ---
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
                drawDynamic(VF, ctx, hb.x + hb.w / 2, y, d.mark);
            }
        }
    }
}
