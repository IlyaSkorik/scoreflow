// VexFlow-ключ "c#/4" -> частота (Гц); для ударных не используется
export const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function keyToFreq(key) {
    const parts = key.split('/');
    const la = (parts[0] || 'a').toLowerCase();
    let semis = SEMI[la[0]];
    if (semis === undefined) return 440;
    for (let k = 1; k < la.length; k++) {
        if (la[k] === '#') semis += 1;
        else if (la[k] === 'b') semis -= 1;
    }
    const octave = parseInt(parts[1], 10);
    const midi = (octave + 1) * 12 + semis;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// VexFlow-ключ "c#/4" -> MIDI-номер (для сэмплерного рояля)
export function keyToMidi(key) {
    const parts = key.split('/');
    const la = (parts[0] || 'a').toLowerCase();
    let semis = SEMI[la[0]];
    if (semis === undefined) semis = 9;
    for (let k = 1; k < la.length; k++) {
        if (la[k] === '#') semis += 1;
        else if (la[k] === 'b') semis -= 1;
    }
    return (parseInt(parts[1], 10) + 1) * 12 + semis;
}
