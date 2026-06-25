export function sameKeys(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// Следующая РЕАЛЬНАЯ нота того же голоса после (mi, ni): сначала в этом
// такте, иначе первая в последующих тактах. Авто-паузы добивки в payload
// не приходят отдельным флагом, но у них keys=[] и rest=true — здесь нас
// интересует именно следующий слот, валидность проверяет вызывающий.
export function nextRealNote(measures, voiceId, mi, ni) {
    const here = (measures[mi] && measures[mi][voiceId]) || [];
    if (ni + 1 < here.length) {
        return { mi: mi, ni: ni + 1, note: here[ni + 1] };
    }
    for (let m = mi + 1; m < measures.length; m++) {
        const notes = (measures[m] && measures[m][voiceId]) || [];
        if (notes.length > 0) return { mi: m, ni: 0, note: notes[0] };
    }
    return null;
}

export function voiceListOf(score) {
    return score.instrument === 'drums' ? ['perc'] : ['treble', 'bass'];
}
