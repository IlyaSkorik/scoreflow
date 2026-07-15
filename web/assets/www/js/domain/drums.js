// Полный ключ VexFlow "линия/октава[/головка]" -> канонический ударный.
// Головка различает артикуляции на одной линии (хай-хэт x2/x3, и т.д.).
export const DRUM_FULL = {
    'f/4': 'kick',
    'c/5': 'snare',
    'g/5/x2': 'hihat_closed',
    'g/5/x3': 'hihat_open',
    'd/4/x2': 'hihat_pedal',
    'a/5/x2': 'crash1',
    'b/5/x2': 'crash2',
    'f/5/x2': 'ride',
    'f/5/d0': 'ride_bell',
    'e/5': 'tom_high',
    'd/5': 'tom_mid',
    'a/4': 'tom_floor',
};
// Запасное сопоставление по позиции — для старых партитур без головки.
export const DRUM_BASE = {
    'f/4': 'kick', 'c/5': 'snare', 'g/5': 'hihat_closed', 'd/4': 'hihat_pedal',
    'e/5': 'tom_high', 'd/5': 'tom_mid', 'a/4': 'tom_floor',
    'a/5': 'crash1', 'b/5': 'crash2', 'f/5': 'ride',
};
export function drumType(key) {
    const p = key.split('/');
    const full = p[0] + '/' + p[1] + (p[2] ? '/' + p[2] : '');
    return DRUM_FULL[full] || DRUM_BASE[p[0] + '/' + p[1]] || 'snare';
}
