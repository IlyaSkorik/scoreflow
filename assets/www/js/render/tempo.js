// [ScoreFlow engine] Tempo rendering — ОБЩИЙ слой отрисовки темповых обозначений
// (♩ = N) для ОБОИХ пайплайнов: экран (render.js) и печать (print.js). Экран и
// PDF рисуют метку ОДНИМ кодом и совпадают визуально.
//
// Метка — НАСТОЯЩАЯ гравированная нота VexFlow (StaveNote на невидимом стане:
// подлинные головка/штиль/флажок/точка теми же глифами и метриками, что ноты
// партитуры) + текст « = N». Штиль издательски укорочен (метрономный знак —
// Behind Bars/SMuFL: ~2.2 промежутка вместо 3.5), нота чуть крупнее нот стана
// (SCALE) и центрирована по цифрам BPM. Масштаб — transform SVG-группы: чистый
// вектор, печать остаётся резкой. Стоит НАД станом (выше вольт, если те есть),
// у позиции смены темпа. Решение «где смена темпа» и её тайминг живут в
// domain/tempo — здесь только геометрия и примитивы (никакой нотационной логики).
//
// Дизайн под будущее: renderer принимает ЛЮБУЮ длительность ({ duration, dots,
// bpm }); domain/tempo.unit (доля в четвертях) конвертируется через
// tempoUnitDuration — редактору достаточно выставить unit (2, 1.5, 0.5 …),
// рендер уже умеет половинные/восьмые/пунктирные.

const COLOR = '#000000';
const FONT = 13;         // кегль текста « = N»
const SCALE = 0.8;       // нота компактнее нот стана — метрономный знак
                         // соразмерен тексту BPM (MuseScore/Dorico)
const HEAD_LIFT = 4.5;   // подъём ЦЕНТРА головки над базовой линией текста —
                         // нота оптически центрирована по цифрам BPM
const EQ_GAP = 5;        // воздух между правым краем ноты и знаком «=»

// Издательское укорочение штиля (метрономный знак): смещение к штатным 35 у
// VexFlow Stem. Четвертная/половинная — штиль 22; флажковым нужен запас под
// глиф флажка (сам флажок поднимается выше верхушки штиля).
const STEM_EXT = { q: -13, h: -13, 8: -9, 16: -7, 32: -5 };

// Верхний габарит ноты НАД центром головки (немасштабированные единицы VexFlow,
// измерено по фактической отрисовке 4.2.2 с STEM_EXT): у флажковых выше штиля
// торчит флажок. Целая — половина головки. Источник для headroom БЕЗ VexFlow.
const ABOVE_CENTER = { w: 5.2, h: 22, q: 22, 8: 28.4, 16: 30.1, 32: 32 };

// Единица удара domain/tempo (доля в ЧЕТВЕРТЯХ) -> длительность VexFlow + точки.
// 1 -> четверть, 2 -> половинная, 0.5 -> восьмая, 1.5 -> четверть с точкой …
export function tempoUnitDuration(unit) {
    const u = (unit && unit > 0) ? unit : 1;
    const bases = [[4, 'w'], [2, 'h'], [1, 'q'], [0.5, '8'], [0.25, '16'], [0.125, '32']];
    for (let i = 0; i < bases.length; i++) {
        const q = bases[i][0], d = bases[i][1];
        if (Math.abs(u - q) < 1e-6) return { duration: d, dots: 0 };
        if (Math.abs(u - q * 1.5) < 1e-6) return { duration: d, dots: 1 };
        if (Math.abs(u - q * 1.75) < 1e-6) return { duration: d, dots: 2 };
    }
    return { duration: 'q', dots: 0 };
}

// Вертикальное место (px), которое ОДНА темповая метка резервирует НАД станом
// (над вольтами) — пофактовое по её длительности: верх ноты над базовой линией
// + зазор, покрывающий подъём MARK_GAP из render.js/print.js.
export function tempoMarkHeadroom(mark) {
    const d = tempoUnitDuration(mark && mark.unit);
    const above = ABOVE_CENTER[d.duration] != null ? ABOVE_CENTER[d.duration] : 22;
    return Math.ceil(HEAD_LIFT + SCALE * above) + 8;
}

// Общий резерв по списку меток — максимум пофактовых. 0 — смен темпа нет.
export function tempoHeadroom(marks) {
    let h = 0;
    for (let i = 0; i < (marks || []).length; i++) {
        const m = tempoMarkHeadroom(marks[i]);
        if (m > h) h = m;
    }
    return h;
}

// --- Гравировка ноты: кеш собранных StaveNote --------------------------------
// Нота собирается и ФОРМАТИРУЕТСЯ один раз на длительность (Performance: сотни
// меток переиспользуют один объект — при отрисовке меняются только контекст и
// transform группы). Габариты меряются пробной отрисовкой в рекордер — точные
// края (флажок, точки) без доверия к getBoundingBox (он игнорирует укорочение).
const noteCache = new Map(); // 'q:1' -> { note, headLeft, headCenterY, right }

// Рекордер-контекст: полный набор методов, которые дергает StaveNote.draw();
// пишет только габариты путей.
function measureCtx() {
    const m = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const track = function (pts) {
        for (let i = 0; i + 1 < pts.length; i += 2) {
            if (pts[i] < m.minX) m.minX = pts[i];
            if (pts[i] > m.maxX) m.maxX = pts[i];
            if (pts[i + 1] < m.minY) m.minY = pts[i + 1];
            if (pts[i + 1] > m.maxY) m.maxY = pts[i + 1];
        }
    };
    const noop = function () {};
    return {
        m: m,
        openGroup: function () { return { setAttribute: noop, appendChild: noop, style: {} }; },
        closeGroup: noop, save: noop, restore: noop, beginPath: noop, closePath: noop,
        fill: noop, stroke: noop, setLineWidth: noop, setFont: noop, setFillStyle: noop,
        setStrokeStyle: noop, setLineDash: noop, fillText: noop, rect: noop,
        measureText: function () { return { width: 0 }; },
        moveTo: function (x, y) { track([x, y]); },
        lineTo: function (x, y) { track([x, y]); },
        bezierCurveTo: function (a, b, c, d, e, f) { track([a, b, c, d, e, f]); },
        quadraticCurveTo: function (a, b, c, d) { track([a, b, c, d]); },
        arc: function (x, y, r) { track([x - r, y - r, x + r, y + r]); },
        fillRect: function (x, y, w, h) { track([x, y, x + w, y + h]); },
    };
}

function engravedNote(VF, duration, dots) {
    const key = duration + ':' + (dots || 0);
    const hit = noteCache.get(key);
    if (hit) return hit;
    // Невидимый стан — только система координат (никогда не рисуется).
    const stave = new VF.Stave(0, 0, 100, { fill_style: 'none' });
    const note = new VF.StaveNote({
        keys: ['b/4'], duration: duration, stem_direction: 1, clef: 'treble',
    });
    for (let i = 0; i < (dots || 0); i++) VF.Dot.buildAndAttach([note], { all: true });
    if (note.hasStem() && STEM_EXT[duration] != null) {
        note.getStem().setExtension(STEM_EXT[duration]);
    }
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    voice.addTickables([note]);
    new VF.Formatter().joinVoices([voice]).format([voice], 20);
    note.setStave(stave);
    // Пробная отрисовка — точные габариты (флажок/точки включены).
    const mc = measureCtx();
    note.setContext(mc).draw();
    const info = {
        note: note,
        headLeft: mc.m.minX,
        headCenterY: note.getYs()[0],
        right: mc.m.maxX,
    };
    noteCache.set(key, info);
    return info;
}

// Нарисовать одну метку «(нота) = bpm». [x] — левый край головки, [y] — базовая
// линия текста BPM. Нота — настоящая гравировка VexFlow в SVG-группе с
// transform (translate + scale): вектор, без растеризации. [spec] — { duration,
// dots, bpm } (число вместо spec = legacy «четверть»).
export function drawTempoMark(VF, ctx, x, y, spec) {
    const s = (typeof spec === 'object' && spec)
        ? spec : { duration: 'q', dots: 0, bpm: spec };
    const bpm = s.bpm;
    let textX = null;
    if (VF && VF.StaveNote && ctx.openGroup) {
        let info = null;
        try { info = engravedNote(VF, s.duration || 'q', s.dots || 0); }
        catch (e) { info = null; /* фолбэк ниже */ }
        if (info) {
            const tx = x - SCALE * info.headLeft;
            const ty = (y - HEAD_LIFT) - SCALE * info.headCenterY;
            const g = ctx.openGroup('scoreflow-tempo-note');
            try {
                if (g && g.setAttribute) {
                    g.setAttribute('transform',
                        'translate(' + tx + ',' + ty + ') scale(' + SCALE + ')');
                }
                info.note.setContext(ctx).draw();
            } finally {
                ctx.closeGroup();
            }
            textX = x + SCALE * (info.right - info.headLeft) + EQ_GAP;
        }
    }
    if (textX == null) textX = drawFallbackNote(VF, ctx, x, y) + EQ_GAP;

    ctx.save();
    ctx.setFont('serif', FONT, '');
    if (ctx.setFillStyle) ctx.setFillStyle(COLOR);
    ctx.fillText('= ' + bpm, textX, y);
    ctx.restore();
}

// Фолбэк без StaveNote/SVG-групп (например, canvas): головка-глиф + штиль в тех
// же пропорциях. Возвращает правый край ноты.
function drawFallbackNote(VF, ctx, x, y) {
    const headSize = 39 * SCALE; // NOTATION_FONT_SCALE VexFlow — головка нот стана
    let headW = 11.9 * SCALE;
    const headY = y - HEAD_LIFT;
    if (VF && VF.Glyph) {
        try {
            const g = new VF.Glyph('noteheadBlack', headSize);
            if (g.setContext) g.setContext(ctx);
            try { const w = g.getMetrics().width; if (w > 0) headW = w; } catch (e) { /* keep */ }
            g.render(ctx, x, headY);
        } catch (e) { /* глиф недоступен — останется штиль+текст */ }
    }
    ctx.save();
    ctx.setLineWidth(1.4);
    if (ctx.setStrokeStyle) ctx.setStrokeStyle(COLOR);
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.beginPath();
    const stemX = x + headW - 0.7; // правый край головки
    ctx.moveTo(stemX, headY);
    ctx.lineTo(stemX, y - HEAD_LIFT - SCALE * 22);
    ctx.stroke();
    ctx.restore();
    return x + headW;
}

// Отрисовать все темповые метки. [spec] — аксессоры пайплайна:
//   VF, marks : [{ measure, beat, bpm, unit }]
//   rowOf(mi)          : строка/система такта (или null)
//   baselineOf(row,mi) : Y базовой линии метки (пофактовое — зависит от того,
//                        что реально стоит НАД этим тактом; или null)
//   xOf(mi, beat)      : X позиции доли (или null)
//   ctxOf(row)         : графический контекст строки/системы
export function drawTempos(spec) {
    const marks = spec.marks || [];
    for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const r = spec.rowOf(m.measure);
        if (r == null) continue;
        const y = spec.baselineOf(r, m.measure);
        if (y == null) continue;
        const ctx = spec.ctxOf(r);
        if (!ctx) continue;
        const x = spec.xOf(m.measure, m.beat || 0);
        if (x == null) continue;
        const d = tempoUnitDuration(m.unit);
        drawTempoMark(spec.VF, ctx, x, y,
            { duration: d.duration, dots: d.dots, bpm: m.bpm });
    }
}
