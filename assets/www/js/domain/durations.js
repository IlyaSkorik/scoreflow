// длительность VexFlow -> доли в ЧЕТВЕРТЯХ (quarter beats)
export const QBEATS = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625 };

// Доли в четвертях с учётом точек: каждая точка добавляет половину
// предыдущего приращения (1 точка = base·1.5, 2 = base·1.75 и т.д.).
export function durationBeats(dur, dots) {
    const base = QBEATS[dur] != null ? QBEATS[dur] : 1;
    let add = base / 2, total = base;
    for (let d = 0; d < (dots || 0); d++) { total += add; add /= 2; }
    return total;
}
