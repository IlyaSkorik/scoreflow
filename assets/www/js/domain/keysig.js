// [ScoreFlow engine] Key signature theory — имя тональности VexFlow в карту
// альтераций ступеней (буква ступени -> сдвиг полутонов). Одна из ТРЁХ
// составляющих реальной высоты (тональность + записанный знак + правила
// такта) — см. domain/pitch.js resolveMidi. Глиф тональности на стане рисует
// сам VexFlow (addKeySignature); здесь только теория высоты.
//
// Расширяемо: минорные имена ('Am', 'Em', ...) добавляются в KEY_FIFTHS без
// изменения логики (круг квинт един для мажора/минора по числу знаков).

// Порядок появления диезов и бемолей (круг квинт).
const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

// Число знаков мажорной тональности (имя VexFlow): >0 диезы, <0 бемоли.
const KEY_FIFTHS = {
    C: 0,
    G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
    F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

// Имя тональности -> { step: shift }. Ступени без знака отсутствуют в карте
// (для них сдвиг 0). Неизвестное имя -> C-dur (пустая карта).
export function keySignatureAlterations(name) {
    const fifths = KEY_FIFTHS[name] != null ? KEY_FIFTHS[name] : 0;
    const alt = {};
    if (fifths > 0) {
        for (let i = 0; i < fifths; i++) alt[SHARP_ORDER[i]] = 1;
    } else if (fifths < 0) {
        for (let i = 0; i < -fifths; i++) alt[FLAT_ORDER[i]] = -1;
    }
    return alt;
}
