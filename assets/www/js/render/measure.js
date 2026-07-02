// [ScoreFlow engine] Measure Context — рекордер-контекст для измерения РЕАЛЬНЫХ
// габаритов гравировки без отрисовки: полный набор методов, которые дергают
// draw()-методы VexFlow (StaveNote, Glyph, …); пишутся только габариты путей.
// Используется движком размещения (placement): точные bounding box'ы меток
// (нота темпа с флажком/точками, глифы Segno/Coda) вместо констант «на глаз».

// Возвращает объект-контекст с полем m = { minX, minY, maxX, maxY }.
export function measureCtx() {
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

// Габариты SMuFL-глифа [code] кегля [size] пробной отрисовкой в точке (0,0).
// Возвращает { x0, x1, rise, drop }: горизонтальные смещения от точки отрисовки
// и вертикаль вокруг базовой линии (rise — вверх, drop — вниз). Кешируется.
const glyphCache = new Map();
export function glyphExtents(VF, code, size) {
    const key = code + ':' + size;
    const hit = glyphCache.get(key);
    if (hit) return hit;
    const mc = measureCtx();
    const g = new VF.Glyph(code, size);
    if (g.setContext) g.setContext(mc);
    g.render(mc, 0, 0);
    const m = mc.m;
    const ext = (m.minX === Infinity)
        ? { x0: 0, x1: size * 0.6, rise: size, drop: 0 }
        : {
            x0: Math.min(0, m.minX), x1: Math.max(0, m.maxX),
            rise: Math.max(0, -m.minY), drop: Math.max(0, m.maxY),
        };
    glyphCache.set(key, ext);
    return ext;
}
