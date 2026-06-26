// [ScoreFlow engine] Print Engine — вынесено из index.html без изменений
// логики. Промышленная постраничная вёрстка A4 (Justification): системная и
// страничная пагинация, горизонтальный/вертикальный justify, заголовок,
// отрисовка систем и лиг печати (per-page ctx). Слой поверх спейсинга VexFlow:
// минимальные ширины тактов берём из Formatter.preCalculateMinTotalWidth
// (нелинейный спейсинг по длительностям заложен в движке), а пагинацию и
// выравнивание по обоим краям считаем сами — этого слоя в VexFlow нет (как
// layout-слой над спейсингом в MuseScore).
//
// Общие примитивы (buildVoice/beamGroups/buildTuplets/measureMinWidth) берём
// из layout.js — print НЕ зависит от экранного render.js. VF берётся из
// глобального Vex.Flow (как и в остальном движке).
import { el } from '../utils/dom.js';
import { buildVoice, beamGroups, buildTuplets, measureMinWidth } from './layout.js';
import { voiceListOf, nextRealNote, sameKeys } from '../domain/notes.js';

const PAGE = { W: 794, H: 1123, mx: 56, mtop: 72, mbot: 56 }; // A4 @96dpi
const MEASURE_PAD = 16;    // правый запас в такте (дыхание/барлайн)
const SYS_GAP_MIN = 12;    // мин. интервал между системами
const SYS_GAP_MAX = 40;    // потолок интервала (плотная вёрстка)
const NOTE_RIGHT_PAD = 10; // запас справа от последней ноты

function printW() { return PAGE.W - 2 * PAGE.mx; }
function printH() { return PAGE.H - PAGE.mtop - PAGE.mbot; }

// Конфигурация станов под инструмент.
function layoutConfig(instrument) {
    if (instrument === 'drums') {
        return {
            grand: false,
            staves: [{ voice: 'perc', clef: 'percussion', dy: 0 }],
            keySig: false,
            systemHeight: 96,
        };
    }
    return {
        grand: true,
        staves: [
            { voice: 'treble', clef: 'treble', dy: 0 },
            { voice: 'bass', clef: 'bass', dy: 82 },
        ],
        keySig: true,
        systemHeight: 172,
    };
}

function newPage(root) {
    const div = document.createElement('div');
    div.className = 'pf-page';
    root.appendChild(div);
    const r = new Vex.Flow.Renderer(div, Vex.Flow.Renderer.Backends.SVG);
    r.resize(PAGE.W, PAGE.H);
    return r.getContext();
}

// Ширина «головы» стана: ключ + ключевые знаки [+ размер].
function headWidth(VF, ctx, cfg, keySig, timeSig, withTime) {
    const s = new VF.Stave(0, 0, 400);
    s.addClef(cfg.staves[0].clef);
    if (cfg.keySig && keySig) s.addKeySignature(keySig);
    if (withTime && timeSig) s.addTimeSignature(timeSig);
    s.setContext(ctx);
    s.format();
    return s.getNoteStartX() - s.getX();
}

function textWidth(ctx, str, approxCharW) {
    try {
        const w = ctx.measureText(str).width;
        if (w && w > 0) return w;
    } catch (e) { /* fallthrough */ }
    return str.length * (approxCharW || 8);
}

function drawTitle(ctx, title, composer) {
    ctx.save();
    ctx.setFont('serif', 22, 'bold');
    ctx.fillText(title, (PAGE.W - textWidth(ctx, title, 12)) / 2, PAGE.mtop - 34);
    if (composer) {
        ctx.setFont('serif', 13, '');
        ctx.fillText(composer,
            PAGE.W - PAGE.mx - textWidth(ctx, composer, 7), PAGE.mtop - 14);
    }
    ctx.restore();
}

// Отрисовка одной системы (строки) на странице. [sysIndex] — сквозной
// номер системы, [registry] — реестр noteId -> {sn, ctx, sys} для
// последующего прохода лиг (Tie/Slur), общий на всю печать.
function drawSystem(VF, ctx, sys, measures, cfg, yTop, beats, beatValue,
                    keySig, timeSig, sysIndex, registry) {
    let x = PAGE.mx;
    sys.items.forEach(function (idx, pos) {
        const isFirst = (pos === 0);
        const withTime = isFirst && sys.firstMeasure === 0;
        const content = sys.widths[idx];
        const staveW = (isFirst ? sys.L : 0) + content;

        // Свежие голоса под отрисовку (ноты нельзя переиспользовать).
        // measureIndex = idx — нужен реестру лиг (noteId "m:v:i").
        const voices = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[idx][st.voice] || [], st.clef,
                beats, beatValue, -1, idx, st.voice);
        });

        // Станы такта.
        const staves = cfg.staves.map(function (st) {
            const stave = new VF.Stave(x, yTop + st.dy, staveW);
            if (isFirst) {
                stave.addClef(st.clef);
                if (cfg.keySig && keySig) stave.addKeySignature(keySig);
                if (withTime && timeSig) stave.addTimeSignature(timeSig);
            }
            stave.setContext(ctx);
            stave.format();
            return stave;
        });

        // Единый старт нот по всем станам системы (вертикальное выравнивание).
        let startX = x;
        staves.forEach(function (s) { startX = Math.max(startX, s.getNoteStartX()); });
        staves.forEach(function (s) { s.setNoteStartX(startX); });
        const contentW = Math.max(40, (x + staveW) - startX - NOTE_RIGHT_PAD);

        // Один форматтер на такт — ноты разных станов выравниваются по тактам.
        const f = new VF.Formatter();
        voices.forEach(function (v) { f.joinVoices([v]); });
        // Tuplets — ДО форматирования (применяют множитель тиков).
        const tuplets = [];
        voices.forEach(function (v) {
            buildTuplets(VF, v).forEach(function (t) { tuplets.push(t); });
        });
        f.format(voices, contentW);

        staves.forEach(function (s) { s.draw(); });
        voices.forEach(function (v, si) {
            // Балки создаём ДО отрисовки нот: тогда у забимованных нот
            // не рисуются одиночные флажки (хвосты).
            const beams = VF.Beam.generateBeams(v.getTickables(), {
                groups: beamGroups(VF, beats, beatValue),
                beam_rests: false,
                maintain_stem_directions: true,
            });
            v.draw(ctx, staves[si]);
            beams.forEach(function (b) { b.setContext(ctx).draw(); });

            // Регистрируем ноты для прохода лиг (после draw — позиции готовы).
            if (registry) {
                v.getTickables().forEach(function (t) {
                    if (!t.__hit || t.__hit.i < 0) return;
                    registry[t.__hit.m + ':' + t.__hit.v + ':' + t.__hit.i] =
                        { sn: t, ctx: ctx, sys: sysIndex };
                });
            }
        });
        // Числа/скобки tuplet — после нот и балок.
        tuplets.forEach(function (t) {
            try { t.setContext(ctx).draw(); }
            catch (e) { console.error('tuplet draw failed:', e); }
        });

        // Системная скобка + левая линия (клавишные).
        if (isFirst && cfg.grand) {
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }

        // Номер первого такта системы — вплотную НАД верхней линией
        // верхнего стана. Первый такт пьесы не нумеруем.
        if (isFirst && sys.firstMeasure > 0) {
            const topStave = staves[0];
            ctx.save();
            ctx.setFont('sans-serif', 11, '');
            ctx.fillText(String(sys.firstMeasure + 1),
                x + 1, topStave.getYForLine(0) - 4);
            ctx.restore();
        }

        x += staveW;
    });
}

// Главный вход постраничной вёрстки: строит страницы A4 в #print-root,
// возвращает их количество.
export function renderPrintPages(score) {
    const VF = Vex.Flow;
    const root = el('print-root');
    root.innerHTML = '';

    const tsParts = (score.timeSignature || '4/4').split('/');
    const beats = parseInt(tsParts[0], 10) || 4;
    const beatValue = parseInt(tsParts[1], 10) || 4;
    const instrument = score.instrument === 'drums' ? 'drums' : 'piano';
    const cfg = layoutConfig(instrument);
    const measures = score.measures || [];
    const keySig = cfg.keySig ? (score.keySignature || 'C') : null;
    const timeSig = score.timeSignature || (beats + '/' + beatValue);
    if (measures.length === 0) return 0;

    // --- проход 1: минимальные ширины тактов ---
    const cm = [];
    for (let i = 0; i < measures.length; i++) {
        const vs = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[i][st.voice] || [], st.clef,
                beats, beatValue, -1, -1, st.voice);
        });
        cm.push(Math.max(48, measureMinWidth(VF, vs)));
    }

    // первая страница + замер ширин «головы» стана
    const ctx0 = newPage(root);
    const clefKeyW = headWidth(VF, ctx0, cfg, keySig, timeSig, false);
    const timeExtra = headWidth(VF, ctx0, cfg, keySig, timeSig, true) - clefKeyW;

    // --- проход 2: разбиение на системы ---
    const W = printW();
    const systems = [];
    let i = 0;
    while (i < measures.length) {
        const sys = { items: [], firstMeasure: i, L: clefKeyW + (i === 0 ? timeExtra : 0) };
        let used = sys.L;
        while (i < measures.length) {
            const add = cm[i] + MEASURE_PAD;
            if (sys.items.length > 0 && used + add > W) break;
            sys.items.push(i);
            used += add;
            i++;
        }
        systems.push(sys);
    }

    // --- проход 3: горизонтальный justify ---
    systems.forEach(function (sys, si) {
        const budget = W - sys.L;
        const sumCm = sys.items.reduce(function (a, k) { return a + cm[k]; }, 0);
        const natural = sumCm + sys.items.length * MEASURE_PAD;
        const isLast = si === systems.length - 1;
        let delta = budget - natural;
        if (delta < 0) delta = 0;
        const justify = !(isLast && natural / budget < 0.5);
        sys.widths = {};
        sys.items.forEach(function (k) {
            let cw = cm[k] + MEASURE_PAD;
            if (justify && sumCm > 0) cw += delta * (cm[k] / sumCm);
            sys.widths[k] = cw;
        });
    });

    // --- проход 4: страничная раскладка (вертикальный justify) ---
    const Hh = printH();
    const sysH = cfg.systemHeight;
    const perPage = Math.max(1,
        Math.floor((Hh + SYS_GAP_MIN) / (sysH + SYS_GAP_MIN)));
    const pages = [];
    for (let s = 0; s < systems.length; s += perPage) {
        pages.push(systems.slice(s, s + perPage));
    }

    // Реестр нот для прохода лиг: noteId -> {sn, ctx, sys}. Сквозной
    // номер системы (sysGi) различает системы на одной странице (общий
    // ctx) — лига внутри системы рисуется целиком, между системами —
    // частичными дугами на соответствующих ctx.
    const printObjs = {};
    let sysGi = 0;

    for (let p = 0; p < pages.length; p++) {
        const pageSystems = pages[p];
        const ctx = (p === 0) ? ctx0 : newPage(root);
        const n = pageSystems.length;
        const isLastPage = p === pages.length - 1;

        let headOffset = 0;
        if (p === 0 && score.title) {
            drawTitle(ctx, score.title, score.composer);
            headOffset = score.composer ? 16 : 4;
        }
        const budgetH = Hh - headOffset;

        let gap;
        if (n > 1 && !isLastPage) {
            gap = (budgetH - n * sysH) / (n - 1);
            gap = Math.max(SYS_GAP_MIN, Math.min(SYS_GAP_MAX, gap));
        } else {
            gap = SYS_GAP_MIN;
        }

        let y = PAGE.mtop + headOffset;
        for (let k = 0; k < n; k++) {
            drawSystem(VF, ctx, pageSystems[k], measures, cfg, y,
                beats, beatValue, keySig, timeSig, sysGi, printObjs);
            sysGi++;
            y += sysH + gap;
        }
    }

    // Лиги Tie/Slur — отдельным проходом после отрисовки всех страниц.
    try { drawPrintTiesAndSlurs(VF, score, printObjs); }
    catch (err) { console.error('drawPrintTiesAndSlurs failed:', err); }

    return pages.length;
}

// Проход лиг для печати: как drawTiesAndSlurs, но ctx у каждой ноты свой
// (страницы — разные SVG). Внутри одной системы — целая дуга; между
// системами — частичные дуги на ctx каждого конца.
function drawPrintTiesAndSlurs(VF, score, registry) {
    const measures = score.measures || [];
    const voices = voiceListOf(score);
    const objOf = function (mi, v, ni) { return registry[mi + ':' + v + ':' + ni]; };

    function tie(a, b, idx) {
        try {
            if (a.sys === b.sys) {
                new VF.StaveTie({ first_note: a.sn, last_note: b.sn,
                    first_indices: idx, last_indices: idx })
                    .setContext(a.ctx).draw();
            } else {
                new VF.StaveTie({ first_note: a.sn, last_note: null,
                    first_indices: idx, last_indices: idx })
                    .setContext(a.ctx).draw();
                new VF.StaveTie({ first_note: null, last_note: b.sn,
                    first_indices: idx, last_indices: idx })
                    .setContext(b.ctx).draw();
            }
        } catch (e) { console.error('print tie failed:', e); }
    }
    function slur(a, b) {
        try {
            if (a.sys === b.sys) {
                new VF.Curve(a.sn, b.sn, {}).setContext(a.ctx).draw();
            } else {
                try { new VF.Curve(a.sn, null, {}).setContext(a.ctx).draw(); }
                catch (e1) { /* пропуск */ }
                try { new VF.Curve(null, b.sn, {}).setContext(b.ctx).draw(); }
                catch (e2) { /* пропуск */ }
            }
        } catch (e) { console.error('print slur failed:', e); }
    }

    for (let vi = 0; vi < voices.length; vi++) {
        const v = voices[vi];
        for (let mi = 0; mi < measures.length; mi++) {
            const notes = (measures[mi] && measures[mi][v]) || [];
            for (let ni = 0; ni < notes.length; ni++) {
                const n = notes[ni];
                if (!n || !n.tieToNext || n.rest) continue;
                const p = nextRealNote(measures, v, mi, ni);
                if (!p || p.note.rest || !sameKeys(n.keys, p.note.keys)) continue;
                const a = objOf(mi, v, ni), b = objOf(p.mi, v, p.ni);
                if (a && b) tie(a, b, n.keys.map(function (_, k) { return k; }));
            }
        }
    }
    for (let vi = 0; vi < voices.length; vi++) {
        const v = voices[vi];
        const stack = [];
        for (let mi = 0; mi < measures.length; mi++) {
            const notes = (measures[mi] && measures[mi][v]) || [];
            for (let ni = 0; ni < notes.length; ni++) {
                const n = notes[ni];
                if (!n) continue;
                if (n.slurStart) stack.push({ mi: mi, ni: ni });
                if (n.slurStop && stack.length > 0) {
                    const s = stack.pop();
                    const a = objOf(s.mi, v, s.ni), b = objOf(mi, v, ni);
                    if (a && b) slur(a, b);
                }
            }
        }
    }
}
