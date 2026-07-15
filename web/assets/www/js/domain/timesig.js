// [ScoreFlow engine] Time signature theory — действующий РАЗМЕР каждого такта и
// производные (ёмкость такта, кумулятивные старты, индекс такта по доле).
// ЕДИНОЕ место разрешения mid-score смен размера по партитуре: используют и
// compiler (playback-тайминг), и render/print (глиф размера и ёмкость VexFlow
// Voice), и scheduler (метроном/строки) — поэтому логика не дублируется.
// Прямой аналог domain/keysig (effectiveKeys/cancelKeyFor) для размера.
//
// Расширяемо: кастомная группировка долей (beat grouping) для бимовки ляжет
// рядом, не меняя расчёт ёмкости/тайминга; глиф размера на стане рисует сам
// VexFlow (addTimeSignature) — здесь только теория.

// Разбор строки размера VexFlow ("3/4") в { beats, beatValue }. Неполная/пустая
// строка -> 4/4 (как в остальном движке).
export function parseTimeSig(str) {
    const parts = (str || '4/4').split('/');
    const beats = parseInt(parts[0], 10) || 4;
    const beatValue = parseInt(parts[1], 10) || 4;
    return { beats: beats, beatValue: beatValue };
}

// Ёмкость такта в ЧЕТВЕРТЯХ (quarter beats): beats·4/beatValue. 4/4 = 4, 3/4 = 3,
// 5/8 = 2.5, 7/8 = 3.5, 12/8 = 6. Та же единица, что startBeat компилятора.
// Зеркало Dart TimeSignature.capacity (там — доля от целой; ×4 = четверти).
export function measureCapacityQ(ts) {
    return ts.beats * (4 / ts.beatValue);
}

// Действующий РАЗМЕР КАЖДОГО такта — старт партитуры (с такта 0) + смены `_ts`
// (строка VexFlow на такте переопределяет размер начиная с себя). Неизвестное/
// пустое значение такта игнорируется (размер не меняется). Возвращает массив
// { beats, beatValue } по индексу такта (та же форма, что effectiveKeys для
// тональности). [startTs] — размер партитуры (строка "4/4" или { beats,beatValue }).
export function effectiveTimeSignatures(measures, startTs) {
    const out = [];
    let cur = typeof startTs === 'string'
        ? startTs
        : (startTs ? startTs.beats + '/' + startTs.beatValue : '4/4');
    const ms = measures || [];
    for (let i = 0; i < ms.length; i++) {
        const t = ms[i] && ms[i]._ts;
        if (t) cur = t;
        out.push(parseTimeSig(cur));
    }
    return out;
}

// Кумулятивные доли (ЧЕТВЕРТИ) начала каждого такта по их ёмкостям [capsQ]:
// starts[0]=0, starts[i]=Σ capsQ[0..i-1]. Возвращает capsQ.length+1 элементов
// (последний = totalBeats), чтобы по нему искать индекс такта по абсолютной доле.
// Зеркало Dart reflow.measureStarts.
export function measureStarts(capsQ) {
    const out = [0];
    let acc = 0;
    for (let i = 0; i < capsQ.length; i++) {
        acc += capsQ[i];
        out.push(acc);
    }
    return out;
}

// Индекс такта, в который попадает абсолютная доля [beat] (четверти), по
// предрассчитанным [starts] (см. [measureStarts]). Клампится в [0, count-1].
// Зеркало Dart reflow.measureIndexAtBeat.
export function measureIndexAtBeat(starts, beat) {
    const count = starts.length - 1;
    if (count <= 0) return 0;
    let idx = 0;
    for (let i = 0; i < count; i++) {
        if (starts[i] <= beat + 1e-6) idx = i;
        else break;
    }
    return idx;
}

// Сетка метронома по партитуре: для каждого такта — щелчок на каждую долю
// (4/beatValue четвертей), акцент на доле 0 такта. Возвращает отсортированный
// массив { beat (абсолютные четверти), accent }. ЕДИНОЕ место счёта долей —
// scheduler лишь проигрывает готовую сетку, поэтому смены размера/составные
// метры (6/8 → пунктирная четверть-доля) звучат корректно без логики в плеере.
export function metronomeClicks(effTs, starts) {
    const out = [];
    for (let mi = 0; mi < effTs.length; mi++) {
        const ts = effTs[mi];
        const beatQ = 4 / ts.beatValue; // длительность доли в четвертях
        for (let b = 0; b < ts.beats; b++) {
            out.push({ beat: starts[mi] + b * beatQ, accent: b === 0 });
        }
    }
    return out;
}
