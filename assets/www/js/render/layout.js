// [ScoreFlow engine] Layout primitives — вынесено из index.html без изменений
// логики. Общие строительные блоки VexFlow, на которых строятся ОБА пайплайна:
// экранный рендер (render.js) и постраничная печать (index.html / print-слой).
// Функции чистые: VexFlow (VF) передаётся параметром, модуль ничего не
// импортирует. Поэтому print-слой не зависит от экранного рендера — общие
// примитивы живут здесь, а не в render.js.

const REST_KEY = { treble: 'b/4', bass: 'd/3', percussion: 'b/4' };

// --- Разбор ключа VexFlow на букву + акциденталь ("c#/4" -> '#') -----
// Поддерживает диез/бемоль, дубль-диез/бемоль и бекар ('n'). null — без знака.
function accidentalOf(key) {
    const letterAndAcc = key.split('/')[0]; // "c#" / "cb" / "cn" / "c"
    const acc = letterAndAcc.substring(1);  // "#","b","##","bb","n" или ""
    return (acc === '#' || acc === 'b' || acc === '##' || acc === 'bb' || acc === 'n')
        ? acc : null;
}

// Ключ для StaveNote: бекар ('n') — это натуральная высота (чистая буква),
// поэтому 'n' из ключа убираем (глиф ♮ рисуется явным модификатором ниже).
// Диез/бемоль/дубли остаются в ключе (рабочее поведение VexFlow). Головка
// ударных (3-й сегмент) не затрагивается.
function vexNoteKey(key) {
    return key.replace(/^([a-gA-G])n/, '$1');
}

// --- Построение тиклов одного голоса -------------------------------
export function buildVoice(VF, notes, clef, beats, beatValue, cursorIdx, measureIndex, voiceId) {
    const tickables = [];

    if (!notes || notes.length === 0) {
        // Пустой такт -> целая пауза, чтобы такт всегда рисовался.
        const placeholder = new VF.StaveNote({
            keys: [REST_KEY[clef]], duration: 'wr', clef: clef,
        });
        placeholder.__hit = { m: measureIndex, v: voiceId, i: -1 };
        placeholder.__note = null;
        tickables.push(placeholder);
    } else {
        notes.forEach((n, i) => {
            const isRest = !!n.rest;
            const dots = n.dots || 0;
            const dur = isRest ? n.duration + 'r' : n.duration;
            const rawKeys = isRest ? [REST_KEY[clef]] : n.keys;
            // Ключи StaveNote: бекар ('n') убираем (натуральная высота), знак
            // рисуем явным модификатором VF.Accidental ниже из rawKeys.
            const keys = rawKeys.map(vexNoteKey);
            const sn = new VF.StaveNote({
                keys: keys, duration: dur, dots: dots,
                clef: clef, auto_stem: true,
            });
            if (!isRest) {
                rawKeys.forEach((k, ki) => {
                    const acc = accidentalOf(k);
                    if (acc) sn.addModifier(new VF.Accidental(acc), ki);
                });
            }
            // Глиф точки нужно навесить явно (по одному модификатору на
            // точку); тиковую длительность задаёт опция dots выше.
            for (let d = 0; d < dots; d++) {
                VF.Dot.buildAndAttach([sn], { all: true });
            }
            if (i === cursorIdx) {
                sn.setStyle({ fillStyle: '#2196F3', strokeStyle: '#2196F3' });
            }
            sn.__hit = { m: measureIndex, v: voiceId, i: i };
            sn.__note = n; // доступ к флагам лиг (tieToNext/slurStart/slurStop)
            tickables.push(sn);
        });
    }

    const voice = new VF.Voice({ num_beats: beats, beat_value: beatValue });
    voice.setMode(VF.Voice.Mode.SOFT); // терпим неполный такт при редактировании
    voice.addTickables(tickables);
    return voice;
}

// Группы для бимовки (как в профессиональных редакторах: по долям).
//  - составные x/8 кратные 3 (6/8, 9/8, 12/8) -> по пунктирной четверти;
//  - нерегулярные 5/8 -> 3+2, 7/8 -> 2+2+3 (распространённая запись);
//  - остальное -> штатные группы VexFlow getDefaultBeamGroups (по долям),
//    что чинит простые/сложные размеры разом.
// Возвращает массив VF.Fraction.
export function beamGroups(VF, beats, beatValue) {
    if (beatValue === 8 && beats % 3 === 0) {
        return [new VF.Fraction(3, 8)];
    }
    if (beatValue === 8 && beats === 5) {
        return [new VF.Fraction(3, 8), new VF.Fraction(2, 8)];
    }
    if (beatValue === 8 && beats === 7) {
        return [new VF.Fraction(2, 8), new VF.Fraction(2, 8), new VF.Fraction(3, 8)];
    }
    try {
        const g = VF.Beam.getDefaultBeamGroups(beats + '/' + beatValue);
        if (g && g.length) return g;
    } catch (e) { /* fallback ниже */ }
    return [new VF.Fraction(1, beatValue)];
}

// Группирует подряд идущие ноты голоса в VF.Tuplet по их флагам
// (__note.tuplet + tupletStart) — как tupletChunks в reflow.dart.
// Конструктор Tuplet применяет множитель тиков, поэтому вызывать ДО
// форматирования. Возвращает массив для отрисовки ПОСЛЕ нот/балок.
export function buildTuplets(VF, voice) {
    const tk = voice.getTickables();
    const out = [];
    let i = 0;
    while (i < tk.length) {
        const n = tk[i].__note;
        if (!n || !n.tuplet) { i++; continue; }
        const a = n.tuplet.actual, nm = n.tuplet.normal;
        const group = [tk[i]];
        let j = i + 1;
        while (j < tk.length) {
            const m = tk[j].__note;
            if (!m || !m.tuplet || m.tupletStart ||
                m.tuplet.actual !== a || m.tuplet.normal !== nm) break;
            group.push(tk[j]);
            j++;
        }
        try {
            out.push(new VF.Tuplet(group, {
                num_notes: a, notes_occupied: nm, ratioed: false,
            }));
        } catch (e) { console.error('tuplet build failed:', e); }
        i = j;
    }
    return out;
}

// Минимальная структурная ширина содержимого такта (без модификаторов).
export function measureMinWidth(VF, voices) {
    const f = new VF.Formatter();
    voices.forEach(function (v) { f.joinVoices([v]); });
    return f.preCalculateMinTotalWidth(voices);
}
