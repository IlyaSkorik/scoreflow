// [ScoreFlow engine] Tempo theory — ЕДИНСТВЕННОЕ место превращения музыкального
// времени (доли/четверти) в АБСОЛЮТНОЕ время воспроизведения (секунды). Смена
// темпа — нотационный объект на ритмической позиции (такт+доля), НЕ свойство
// ноты. Compiler строит tempo map и проставляет каждому событию startSec/durSec;
// scheduler лишь читает готовое время — он о темпе-нотации не знает.
//
// Расширяемо БЕЗ редизайна: rit./accel. — сегменты с ПЕРЕМЕННЫМ spq (линейная
// интерполяция секунд вместо кусочно-постоянной); a tempo — новый anchor; swing/
// metric modulation — преобразование долей перед secAt. Здесь пока абсолютные
// смены (♩ = N) — кусочно-постоянный темп.

// Длительность доли в ЧЕТВЕРТЯХ по «единице удара» (beatUnit). По умолчанию доля
// = четверть (1). Для будущих ♩. / ♪ и т.п. — множитель в четвертях.
export function beatUnitQuarters(unit) {
    return (unit && unit > 0) ? unit : 1;
}

// Секунды на ЧЕТВЕРТЬ для темпа bpm с единицей удара [unit] (в четвертях).
// ♩ = 60 (unit 1): 60/(60·1) = 1 c/четверть. Половина = 60 (unit 2): 0.5.
export function tempoSpq(bpm, unit) {
    const u = beatUnitQuarters(unit);
    const b = (bpm && bpm > 0) ? bpm : 120;
    return 60 / (b * u);
}

// Tempo map из якорей { beat (абсолютные четверти), spq (сек/четверть) }.
// Кусочно-постоянный темп: с каждого anchor.beat действует его spq до следующего.
// Возвращает { anchors, secAt(beat), beatAt(sec) } — ЕДИНЫЙ конвертер долей<->
// секунд (обе стороны нужны: планировщик — доли->сек, playhead — сек->доли).
// Якоря сортируются; при совпадении долей побеждает ПОЗДНИЙ (смена важнее базы).
// Гарантируется anchor на доле 0 (базовый темп до первой смены).
export function buildTempoMap(anchors) {
    const src = (anchors || []).slice()
        .filter(function (a) { return a && a.beat >= -1e-9 && a.spq > 0; })
        .sort(function (a, b) { return a.beat - b.beat; });
    const clean = [];
    for (let i = 0; i < src.length; i++) {
        const a = { beat: src[i].beat < 0 ? 0 : src[i].beat, spq: src[i].spq };
        if (clean.length && Math.abs(clean[clean.length - 1].beat - a.beat) < 1e-9) {
            clean[clean.length - 1] = a; // тот же beat — позднейший (смена) побеждает
        } else {
            clean.push(a);
        }
    }
    if (!clean.length) clean.push({ beat: 0, spq: 0.5 }); // дефолт 120 bpm
    if (clean[0].beat > 1e-9) clean.unshift({ beat: 0, spq: clean[0].spq });

    // Кумулятивные секунды на каждом anchor — для O(число смен) secAt/beatAt.
    const cum = [0];
    for (let i = 1; i < clean.length; i++) {
        cum[i] = cum[i - 1] + (clean[i].beat - clean[i - 1].beat) * clean[i - 1].spq;
    }

    function secAt(beat) {
        if (beat <= 0) return 0;
        let i = 0;
        while (i + 1 < clean.length && clean[i + 1].beat <= beat + 1e-9) i++;
        return cum[i] + (beat - clean[i].beat) * clean[i].spq;
    }
    function beatAt(sec) {
        if (sec <= 0) return 0;
        let i = 0;
        while (i + 1 < clean.length && cum[i + 1] <= sec + 1e-12) i++;
        return clean[i].beat + (sec - cum[i]) / clean[i].spq;
    }
    return { anchors: clean, secAt: secAt, beatAt: beatAt };
}

// Смены темпа партитуры как объекты рендера: { measure, beat, bpm, unit }.
// Читает measures[mi]._tempo (список на такте: { bpm, beat (доля в четвертях),
// unit? }). Используется рендером (экран/PDF); тайминг даёт buildTempoMap.
export function readTempoMarks(measures) {
    const out = [];
    for (let mi = 0; mi < (measures || []).length; mi++) {
        const ts = measures[mi] && measures[mi]._tempo;
        if (!ts) continue;
        for (let i = 0; i < ts.length; i++) {
            out.push({
                measure: mi, beat: ts[i].beat || 0,
                bpm: ts[i].bpm, unit: ts[i].unit || 1,
            });
        }
    }
    return out;
}
