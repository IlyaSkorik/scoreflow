// Генератор фикстур печатного движка: реалистичные партитуры-payload'ы
// (формат renderPayload) для визуальной проверки PDF. Детерминированный —
// фикстуры воспроизводимы. Запуск: node test/print/gen_fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(OUT, { recursive: true });

// Длительность в четвертях (с точками и туплетом) — контроль заполнения такта.
const BEATS = { w: 4, h: 2, q: 1, 8: 0.5, 16: 0.25, 32: 0.125, 64: 0.0625 };
function beatsOf(n) {
    let b = BEATS[n.duration] || 0;
    let add = b;
    for (let d = 0; d < (n.dots || 0); d++) { add /= 2; b += add; }
    if (n.tuplet) b *= n.tuplet.normal / n.tuplet.actual;
    return b;
}

// Нота/пауза/аккорд.
function N(keys, duration, opts) {
    const o = opts || {};
    const n = { keys: Array.isArray(keys) ? keys : [keys], duration: duration, rest: false };
    if (o.dots) n.dots = o.dots;
    if (o.rest) { n.rest = true; n.keys = []; }
    if (o.art) n.art = o.art;
    if (o.tuplet) n.tuplet = o.tuplet;
    if (o.tupletStart) n.tupletStart = true;
    if (o.tie) n.tieToNext = true;
    if (o.slurStart) n.slurStart = true;
    if (o.slurStop) n.slurStop = true;
    return n;
}
const R = (duration, opts) => N([], duration, { ...(opts || {}), rest: true });

// Такт с проверкой заполнения (защита от ошибок генератора).
function M(cap, voices, extra) {
    for (const v in voices) {
        const sum = voices[v].reduce((a, n) => a + beatsOf(n), 0);
        if (Math.abs(sum - cap) > 1e-9) {
            throw new Error(`voice ${v}: ${sum} beats, expected ${cap}`);
        }
    }
    return { ...voices, ...(extra || {}) };
}

const T3 = { actual: 3, normal: 2 };

// ============================ PIANO (многостраничная) =====================
function pianoFull() {
    const ms = [];
    // Мелодические клетки (4/4, treble) — сумма ровно 4.
    const cellA = (o) => [
        N(`c/${o}`, 'q'), N(`e/${o}`, '8'), N(`g/${o}`, '8'),
        N(`a/${o}`, 'h'),
    ];
    const cellB = (o) => [
        N(`g/${o}`, '8', { slurStart: true }), N(`f/${o}`, '8'),
        N(`e/${o}`, '8'), N(`d/${o}`, '8', { slurStop: true }),
        N(`e/${o}`, 'h'),
    ];
    const alberti = (root, third, fifth) => [
        N(root, '8'), N(fifth, '8'), N(third, '8'), N(fifth, '8'),
        N(root, '8'), N(fifth, '8'), N(third, '8'), N(fifth, '8'),
    ];
    const bassHalves = (a, b) => [N(a, 'h'), N(b, 'h')];

    // --- A-секция: C-dur, |: 0..7 :| с вольтами 1./2. (6..7 / 8..9) --------
    for (let i = 0; i < 10; i++) {
        const tre = (i % 2 === 0) ? cellA(5) : cellB(5);
        const bas = (i % 2 === 0)
            ? alberti('c/3', 'e/3', 'g/3') : bassHalves('g/2', 'c/3');
        const extra = {};
        if (i === 0) {
            extra._repeat = 'start';
            extra._tempo = [{ bpm: 96, beat: 0 }];
            extra._dyn = { treble: [{ mark: 'p', beat: 0 }] };
        }
        if (i === 3) {
            extra._hair = [{ type: 'crescendo', voice: 'treble', sb: 0, em: 5, eb: 4 }];
        }
        if (i === 6) extra._volta = { numbers: [1], span: 2 };
        if (i === 7) extra._repeat = 'end';
        if (i === 8) {
            extra._volta = { numbers: [2], span: 2 };
            extra._dyn = { treble: [{ mark: 'f', beat: 0 }] };
        }
        if (i === 9) extra._bar = 'double';
        ms.push(M(4, { treble: tre, bass: bas }, extra));
    }

    // --- B-секция: смена на G-dur, темп 120, Segno, стаккато/акценты -------
    for (let i = 0; i < 12; i++) {
        const extra = {};
        if (i === 0) {
            extra._key = 'G';
            extra._tempo = [{ bpm: 120, beat: 0 }];
            extra._nav = 'segno';
            extra._dyn = { treble: [{ mark: 'mf', beat: 0 }], bass: [{ mark: 'mf', beat: 0 }] };
        }
        let tre;
        if (i % 3 === 0) {
            tre = [
                N('g/5', '8', { art: ['staccato'] }), N('a/5', '8', { art: ['staccato'] }),
                N('b/5', '8', { art: ['staccato'] }), N('g/5', '8', { art: ['staccato'] }),
                N('d/6', 'q', { art: ['accent'] }), N('b/5', 'q'),
            ];
        } else if (i % 3 === 1) {
            // Триоль четвертями (3 в 2 = 2 доли) + половинная.
            tre = [
                N('d/5', 'q', { tuplet: T3, tupletStart: true }),
                N('e/5', 'q', { tuplet: T3 }),
                N('f/5', 'q', { tuplet: T3 }),
                N('g/5', 'h', { tie: i < 11 }),
            ];
        } else {
            tre = [N('g/5', 'h'), N('f/5', 'q'), N('e/5', 'q')];
        }
        const bas = (i % 2 === 0)
            ? alberti('g/2', 'b/2', 'd/3') : bassHalves('d/3', 'g/2');
        ms.push(M(4, { treble: tre, bass: bas }, extra));
    }

    // --- C-секция: 3/4 вальс, высокие/низкие ноты, аккорды -----------------
    for (let i = 0; i < 18; i++) {
        const extra = {};
        if (i === 0) {
            extra._ts = '3/4';
            extra._dyn = { bass: [{ mark: 'pp', beat: 0 }] };
        }
        if (i === 8) {
            extra._hair = [{ type: 'diminuendo', voice: 'bass', sb: 0, em: 11, eb: 3 }];
        }
        let tre;
        if (i % 4 === 2) {
            // Высокая кульминация с добавочными линейками.
            tre = [N('a/6', 'q'), N('g/6', 'q'), N('e/6', 'q')];
        } else if (i % 4 === 3) {
            tre = [N(['c/5', 'e/5', 'g/5'], 'h', { dots: 1 })]; // аккорд
        } else {
            tre = [N('e/5', 'h'), N('d/5', 'q')];
        }
        const bas = (i % 4 === 2)
            ? [N('c/2', 'q'), N(['g/2', 'd/3'], 'h')] // глубокий бас
            : [N('g/2', 'q'), N(['b/2', 'd/3'], 'q'), N(['b/2', 'd/3'], 'q')];
        ms.push(M(3, { treble: tre, bass: bas }, extra));
    }

    // --- Финал: обратно 4/4, плотные шестнадцатые, D.S. al Fine ------------
    for (let i = 0; i < 14; i++) {
        const extra = {};
        if (i === 0) extra._ts = '4/4';
        if (i === 6) extra._dyn = { treble: [{ mark: 'ff', beat: 0 }] };
        if (i === 13) extra._nav = 'dalSegnoAlFine';
        let tre;
        if (i % 4 === 1) {
            const run = [];
            const scale = ['c/5', 'd/5', 'e/5', 'f/5', 'g/5', 'a/5', 'b/5', 'c/6'];
            for (let k = 0; k < 8; k++) run.push(N(scale[k], '16'));
            for (let k = 7; k >= 0; k--) run.push(N(scale[k], '16'));
            tre = run;
        } else if (i % 4 === 3) {
            tre = [
                N(['g/4', 'c/5', 'e/5'], 'q', { art: ['accent'] }),
                N(['g/4', 'c/5', 'e/5'], 'q', { art: ['staccato'] }),
                N(['a/4', 'c/5', 'f/5'], 'h'),
            ];
        } else {
            tre = [N('c/5', 'h', { tie: i % 4 === 0 }), N('c/5', 'q'), N('g/4', 'q')];
        }
        const bas = bassHalves(['c/3', 'g/3'][i % 2] || 'c/3', 'g/2');
        ms.push(M(4, { treble: tre, bass: bas }, extra));
    }

    return {
        title: 'Соната-фантазия',
        subtitle: 'из цикла «Времена года»',
        composer: 'И. Скорик',
        arranger: 'перелож. для ф-но',
        instrument: 'piano',
        keySignature: 'C',
        timeSignature: '4/4',
        tempo: 96,
        measures: ms,
    };
}

// ============================ DRUMS ========================================
function drums() {
    const ms = [];
    const HAT = 'g/5/x2', SN = 'c/5', KK = 'f/4';
    const groove = () => [
        N([KK, HAT], '8'), N(HAT, '8'),
        N([SN, HAT], '8', { art: ['accent'] }), N(HAT, '8'),
        N([KK, HAT], '8'), N([KK, HAT], '8'),
        N([SN, HAT], '8', { art: ['accent'] }), N(HAT, '8'),
    ];
    const fill = () => [
        N(SN, '16'), N(SN, '16'), N(SN, '8'),
        N('e/5', '8'), N('d/5', '8'),
        N(SN, '16'), N(SN, '16'), N(SN, '16'), N(SN, '16'),
        N([KK, 'a/5'], 'q', { art: ['accent'] }),
    ];
    for (let i = 0; i < 24; i++) {
        const extra = {};
        if (i === 0) {
            extra._repeat = 'start';
            extra._tempo = [{ bpm: 104, beat: 0 }];
            extra._dyn = { perc: [{ mark: 'mf', beat: 0 }] };
        }
        if (i === 6) extra._volta = { numbers: [1], span: 1 };
        if (i === 6) extra._repeat = 'end';
        if (i === 7) extra._volta = { numbers: [2], span: 1 };
        if (i === 15) extra._dyn = { perc: [{ mark: 'ff', beat: 0 }] };
        ms.push(M(4, { perc: (i % 4 === 3) ? fill() : groove() }, extra));
    }
    return {
        title: 'Групповой этюд',
        composer: 'ScoreFlow',
        instrument: 'drums',
        keySignature: 'C',
        timeSignature: '4/4',
        tempo: 104,
        measures: ms,
    };
}

// ============================ DENSE (смешанные метры) ======================
function dense() {
    const ms = [];
    // 7/8: 2+2+3.
    const seven = () => [
        N('d/5', '8'), N('e/5', '8'), N('f/5', '8'), N('g/5', '8'),
        N('a/5', '8'), N('bb/5', '8'), N('a/5', '8'),
    ];
    const five = () => [
        N('f#/5', '8'), N('g/5', '8'), N('a/5', '8'),
        N('b/5', '8'), N('c/6', '8'),
    ];
    const run32 = () => {
        const out = [];
        const sc = ['c/5', 'd/5', 'eb/5', 'f/5', 'g/5', 'ab/5', 'bb/5', 'c/6'];
        for (let r = 0; r < 2; r++) {
            for (let k = 0; k < 8; k++) out.push(N(sc[k], '32'));
        }
        out.push(N('c/6', 'q'), N('g/5', 'q', { art: ['accent'] }));
        return out;
    };
    const bass44 = () => [N('c/3', 'h'), N(['c/3', 'g/3'], 'h')];
    const bass78 = () => [N('d/3', 'q'), N('d/3', 'q'), N('a/2', 'q', { dots: 1 })];
    const bass58 = () => [N('g/2', 'q'), N('d/3', 'q'), N('g/2', '8')];

    for (let i = 0; i < 14; i++) {
        const extra = {};
        if (i === 0) extra._tempo = [{ bpm: 132, beat: 0 }];
        if (i === 2) extra._ts = '7/8';
        if (i === 6) extra._ts = '5/8';
        if (i === 9) { extra._ts = '4/4'; extra._key = 'Eb'; }
        if (i === 12) extra._key = 'D';
        let tre, bas, cap;
        if (i >= 2 && i < 6) { tre = seven(); bas = bass78(); cap = 3.5; }
        else if (i >= 6 && i < 9) { tre = five(); bas = bass58(); cap = 2.5; }
        else if (i >= 9 && i < 12) { tre = run32(); bas = bass44(); cap = 4; }
        else {
            tre = [
                N('c/5', 'q', { tuplet: T3, tupletStart: true }),
                N('eb/5', 'q', { tuplet: T3 }),
                N('g/5', 'q', { tuplet: T3 }),
                N('c/6', 'h'),
            ];
            bas = bass44(); cap = 4;
        }
        ms.push(M(cap, { treble: tre, bass: bas }, extra));
    }
    return {
        title: 'Этюд в смешанных метрах',
        composer: 'ScoreFlow',
        instrument: 'piano',
        keySignature: 'C',
        timeSignature: '4/4',
        tempo: 132,
        measures: ms,
    };
}

// Длинная сюита — производительность пагинации и футер на 4+ страницах:
// материал piano_full, повторённый трижды (162 такта).
function longSuite() {
    const base = pianoFull();
    return {
        ...base,
        title: 'Длинная сюита',
        subtitle: undefined,
        measures: [...base.measures, ...base.measures, ...base.measures]
            .map((m) => JSON.parse(JSON.stringify(m))),
    };
}

// ============================ STRESS (все слои разом) ======================
// Максимальная плотность верхних и нижних меток: вольты+темп+навигация на одном
// такте, темп у правого края перед вольтой, высокие ноты под вольтой, вилки,
// упирающиеся в оттенки, туплеты со штилями вниз над динамикой, максимум
// артикуляций. Проверка движка размещения (placement) на столкновения.
function stress() {
    const ms = [];
    const bassC = () => [N('c/3', 'h'), N(['c/3', 'g/3'], 'h')];
    const highRun = () => [
        N('a/6', 'q'), N('g/6', 'q'), N('f/6', 'q'), N('e/6', 'q')];
    const veryHigh = () => [N('c/7', 'h'), N('a/6', 'h')];

    // m0: repeat start + tempo + dynamic + высокие ноты сразу.
    ms.push(M(4, { treble: highRun(), bass: bassC() }, {
        _repeat: 'start',
        _tempo: [{ bpm: 100, beat: 0 }],
        _dyn: { treble: [{ mark: 'p', beat: 0 }] },
    }));
    // m1..m2: вольта 1 + темп + навигация + очень высокие ноты ПОД вольтой.
    ms.push(M(4, { treble: veryHigh(), bass: bassC() }, {
        _volta: { numbers: [1], span: 2 },
        _tempo: [{ bpm: 116, beat: 2 }],
    }));
    ms.push(M(4, { treble: veryHigh(), bass: bassC() }, {
        _nav: 'segno',
        _tempo: [{ bpm: 108, beat: 0 }],
        _repeat: 'end',
    }));
    // m3: вольта 2 + coda-глиф.
    ms.push(M(4, { treble: highRun(), bass: bassC() }, {
        _volta: { numbers: [2], span: 1 },
        _nav: 'coda',
    }));
    // m4: темп у ПРАВОГО края такта — текст пересекает границу такта m5,
    // над которым стоит вольта.
    ms.push(M(4, { treble: [N('c/5', 'h'), N('d/5', 'h')], bass: bassC() }, {
        _tempo: [{ bpm: 152, beat: 3 }],
    }));
    // m5..m6: вольта поверх всей пары, высокие ноты.
    ms.push(M(4, { treble: veryHigh(), bass: bassC() }, {
        _volta: { numbers: [1, 2], span: 2 },
    }));
    ms.push(M(4, { treble: highRun(), bass: bassC() }, {}));
    // m7..m8: вилка p -> f, упирающаяся торцами в оттенки (тест зазора).
    ms.push(M(4, { treble: [N('e/5', 'w')], bass: bassC() }, {
        _dyn: { treble: [{ mark: 'p', beat: 0 }] },
        _hair: [{ type: 'crescendo', voice: 'treble', sb: 0, em: 8, eb: 0 }],
    }));
    ms.push(M(4, { treble: [N('g/5', 'w')], bass: bassC() }, {
        _dyn: { treble: [{ mark: 'f', beat: 0 }] },
    }));
    // m9: туплет со штилями ВНИЗ в басу (скобка снизу) над оттенком pp.
    ms.push(M(4, {
        treble: [N('e/5', 'w')],
        bass: [
            N('g/3', 'q', { tuplet: T3, tupletStart: true }),
            N('a/3', 'q', { tuplet: T3 }),
            N('b/3', 'q', { tuplet: T3 }),
            N('g/3', 'q'), N('f/3', 'q'),
        ],
    }, {
        _dyn: { bass: [{ mark: 'pp', beat: 0 }] },
        _hair: [{ type: 'diminuendo', voice: 'bass', sb: 0, em: 9, eb: 4 }],
    }));
    // m10..m11: максимум артикуляций + динамика + вилка.
    const arts = () => [
        N('c/5', 'q', { art: ['accent', 'staccato'] }),
        N('d/5', 'q', { art: ['marcato', 'tenuto'] }),
        N('e/5', 'q', { art: ['staccato', 'tenuto', 'accent'] }),
        N('f/5', 'q', { art: ['staccatissimo'] }),
    ];
    ms.push(M(4, { treble: arts(), bass: bassC() }, {
        _dyn: { treble: [{ mark: 'sf', beat: 0 }] },
        _hair: [{ type: 'crescendo', voice: 'treble', sb: 0, em: 11, eb: 3 }],
    }));
    ms.push(M(4, { treble: arts(), bass: bassC() }, {
        _dyn: { treble: [{ mark: 'ff', beat: 3 }] },
    }));
    // m12: плотные 32-е со знаками + смена тональности.
    const run32 = [];
    const sc = ['c/5', 'db/5', 'eb/5', 'f/5', 'gb/5', 'ab/5', 'bb/5', 'c/6'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 8; k++) run32.push(N(sc[k], '32'));
    ms.push(M(4, { treble: run32, bass: bassC() }, { _key: 'Db' }));
    // m13: навигация текстом справа + темп в том же такте.
    ms.push(M(4, { treble: [N('db/5', 'w')], bass: [N('db/3', 'w')] }, {
        _nav: 'dalSegnoAlFine',
        _tempo: [{ bpm: 88, beat: 2 }],
        _bar: 'final',
    }));
    return {
        title: 'Стресс-тест размещения',
        composer: 'ScoreFlow',
        instrument: 'piano',
        keySignature: 'C',
        timeSignature: '4/4',
        tempo: 100,
        measures: ms,
    };
}

const fixtures = {
    piano_full: pianoFull(), drums: drums(), dense: dense(), long: longSuite(),
    stress: stress(),
};
for (const name in fixtures) {
    const path = join(OUT, name + '.json');
    writeFileSync(path, JSON.stringify(fixtures[name], null, 1));
    console.log(`${path}: ${fixtures[name].measures.length} measures`);
}
