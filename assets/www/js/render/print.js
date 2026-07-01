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
import { state } from '../utils/state.js';
import { buildVoice, beamGroups, buildTuplets, measureMinWidth } from './layout.js';
import { voiceListOf, nextRealNote, sameKeys } from '../domain/notes.js';
import { effectiveKeys, cancelKeyFor } from '../domain/keysig.js';
import { effectiveTimeSignatures } from '../domain/timesig.js';
import { effectiveBarlines } from '../domain/barlines.js';
import { effectiveRepeatBarlines } from '../domain/repeats.js';
import { effectiveVoltas } from '../domain/voltas.js';
import { readTempoMarks } from '../domain/tempo.js';
import { setupBarline, drawCustomBarline, drawGrandBarline } from './barlines.js';
import { drawVoltasInBand, voltaHeadroom } from './voltas.js';
import { drawTempos, tempoHeadroom } from './tempo.js';
import { drawNavigation, navigationHeadroom, readNavigation } from './navigation.js';
import { drawDynamic } from './dynamics.js';
import { dynamicsBaseline } from './dynamics_layout.js';
import { noteOnsets, indexAtBeat, readHairpins } from '../domain/dynamics.js';
import { measureCapacityQ, measureStarts } from '../domain/timesig.js';
import { drawHairpins } from './hairpins.js';

const PAGE = { W: 794, H: 1123, mx: 56, mtop: 72, mbot: 56 }; // A4 @96dpi
const MEASURE_PAD = 16;    // правый запас в такте (дыхание/барлайн)
const SYS_GAP_MIN = 12;    // мин. интервал между системами
const SYS_GAP_MAX = 40;    // потолок интервала (плотная вёрстка)
const NOTE_RIGHT_PAD = 10; // запас справа от последней ноты

function printW() { return PAGE.W - 2 * PAGE.mx; }
function printH() { return PAGE.H - PAGE.mtop - PAGE.mbot; }

// Конфигурация станов под инструмент. Вертикальные отступы РАСШИРЯЮТСЯ ровно на
// столько, на сколько их раздвинул адаптивный экранный рендер (state.dynSpacing),
// — так PDF повторяет экран (станы раздвинуты под высоты нот и динамику). Без
// предварительного экранного рендера берём тюнингованные значения по умолчанию.
function layoutConfig(instrument) {
    const sp = state.dynSpacing;
    if (instrument === 'drums') {
        const extra = sp ? Math.max(0, sp.rowHDrums - 130) : 0;
        return {
            grand: false,
            staves: [{ voice: 'perc', clef: 'percussion', dy: 0 }],
            keySig: false,
            systemHeight: 96 + extra,
        };
    }
    const extraGap = sp ? Math.max(0, sp.bassDY - 90) : 0;
    const extraSys = sp ? Math.max(0, sp.rowHGrand - 200) : 0;
    return {
        grand: true,
        staves: [
            { voice: 'treble', clef: 'treble', dy: 0 },
            { voice: 'bass', clef: 'bass', dy: 82 + extraGap },
        ],
        keySig: true,
        systemHeight: 172 + extraSys,
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

// Ширина «головы» стана: ключ + ключевые знаки [+ бекары-отмена] [+ размер].
// [timeStr] — строка размера, если на первом такте системы размер меняется
// (или null — размер не рисуется в голове).
function headWidth(VF, ctx, cfg, keySig, timeStr, cancelSig) {
    const s = new VF.Stave(0, 0, 400);
    s.addClef(cfg.staves[0].clef);
    if (cfg.keySig && keySig) s.addKeySignature(keySig, cancelSig || undefined);
    if (timeStr) s.addTimeSignature(timeStr);
    s.setContext(ctx);
    s.format();
    return s.getNoteStartX() - s.getX();
}

// Дополнительная ширина смены тональности И/ИЛИ размера В СЕРЕДИНЕ системы
// (стан без ключа): насколько ключевые знаки [+ бекары-отмена] и/или глиф
// размера сдвигают начало нот относительно голого такта. Нужна, чтобы такт со
// сменой получил место и не сжал ноты. null-аргументы пропускаются.
function midLeadWidth(VF, ctx, keyName, cancelName, timeStr) {
    const bare = new VF.Stave(0, 0, 400);
    bare.setContext(ctx);
    bare.format();
    const s = new VF.Stave(0, 0, 400);
    if (keyName) s.addKeySignature(keyName, cancelName || undefined);
    if (timeStr) s.addTimeSignature(timeStr);
    s.setContext(ctx);
    s.format();
    return Math.max(0, s.getNoteStartX() - bare.getNoteStartX());
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
function drawSystem(VF, ctx, sys, measures, cfg, yTop, effTs, tsStr,
                    effKeys, bars, sysIndex, registry, staveReg, voltas, vpad,
                    tempoMarks, tpad, navMarks, npad) {
    let x = PAGE.mx;
    // Станы опускаем на vpad+tpad+npad — над ними вольты, темп и навигация.
    const staveY = yTop + (vpad || 0) + (tpad || 0) + (npad || 0);
    // Боксы тактов {x,w} и Y верхней линейки — для прохода вольт/темпа системы.
    const voltaBoxes = {};
    let bandTopY = null;
    // Тональность головы системы (+ бекары-отмена, если система начинается со
    // смены) — действующая тональность первого такта системы.
    const f = sys.firstMeasure;
    const sysKey = effKeys ? effKeys[f] : null;
    const sysCancel = (effKeys && f > 0) ? cancelKeyFor(effKeys[f - 1], effKeys[f]) : null;
    // Размер в голове системы: на самой первой системе (такт 0) и на системе,
    // начинающейся со смены размера; иначе не повторяется.
    const headTimeStr = (f === 0 || (f > 0 && tsStr[f] !== tsStr[f - 1]))
        ? tsStr[f] : null;
    sys.items.forEach(function (idx, pos) {
        const isFirst = (pos === 0);
        const content = sys.widths[idx];
        const staveW = (isFirst ? sys.L : 0) + content;
        // Смена тональности В СЕРЕДИНЕ системы (не первый такт) — сразу после
        // барлайна, с бекарами-отменой по правилам гравировки (VexFlow cancelKey).
        const midCancel = (effKeys && idx > 0) ? cancelKeyFor(effKeys[idx - 1], effKeys[idx]) : null;
        const midChange = !isFirst && cfg.keySig && midCancel != null;
        // Смена размера в середине системы — также сразу после барлайна.
        const midTimeChange = !isFirst && idx > 0 && tsStr[idx] !== tsStr[idx - 1];

        // Свежие голоса под отрисовку (ноты нельзя переиспользовать).
        // measureIndex = idx — нужен реестру лиг (noteId "m:v:i"). Ёмкость
        // VexFlow Voice — по размеру ЭТОГО такта.
        const voices = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[idx][st.voice] || [], st.clef,
                effTs[idx].beats, effTs[idx].beatValue, -1, idx, st.voice);
        });

        // Станы такта.
        const staves = cfg.staves.map(function (st) {
            const stave = new VF.Stave(x, staveY + st.dy, staveW);
            if (isFirst) {
                stave.addClef(st.clef);
                if (cfg.keySig && sysKey) stave.addKeySignature(sysKey, sysCancel || undefined);
                if (headTimeStr) stave.addTimeSignature(headTimeStr);
            } else if (midChange || midTimeChange) {
                // Клеф середины системы не рисуется, но тональность берёт
                // вертикальные линии знаков из getClef() — задаём контекст
                // клефа явно (без глифа), чтобы знаки баса не встали по
                // скрипичному. Размер от клефа не зависит.
                stave.clef = st.clef;
                if (midChange) stave.addKeySignature(effKeys[idx], midCancel);
                if (midTimeChange) stave.addTimeSignature(tsStr[idx]);
            }
            // Правая граница до format/draw. На аколаде (grand staff) per-stave
            // линии гасим — черту рисуем одной через всю аколаду после draw;
            // на одиночном стане (ударные) ставим нативный тип сразу.
            if (cfg.grand) stave.setEndBarType(VF.Barline.type.NONE);
            else setupBarline(VF, stave, bars[idx]);
            stave.setContext(ctx);
            stave.format();
            return stave;
        });

        // Реестр станов такта (для прохода оттенков): "mi:voice" ->
        // {stave, ctx, sys}. sys группирует такты одной системы (общая база).
        if (staveReg) {
            cfg.staves.forEach(function (st, si) {
                staveReg[idx + ':' + st.voice] =
                    { stave: staves[si], ctx: ctx, sys: sysIndex };
            });
        }

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
        // Тактовая черта — ПОСЛЕ draw, общим с экраном кодом (render/barlines).
        // Аколада: одна сплошная через оба стана; одиночный стан (ударные):
        // нативную нарисовал VexFlow, кастартную дорисовываем здесь.
        if (cfg.grand) {
            drawGrandBarline(VF, ctx, staves[0], staves[staves.length - 1], bars[idx]);
        } else {
            staves.forEach(function (s) { drawCustomBarline(VF, ctx, s, bars[idx]); });
        }
        voices.forEach(function (v, si) {
            // Балки создаём ДО отрисовки нот: тогда у забимованных нот
            // не рисуются одиночные флажки (хвосты).
            const beams = VF.Beam.generateBeams(v.getTickables(), {
                groups: beamGroups(VF, effTs[idx].beats, effTs[idx].beatValue),
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

        // Бокс такта и Y верхней линейки — для скобок вольт этой системы.
        voltaBoxes[idx] = { x: x, w: staveW };
        if (bandTopY == null) bandTopY = staves[0].getYForLine(0);

        x += staveW;
    });

    // Вольты этой системы — общим со экраном кодом (render/voltas). Сегмент
    // рисуется только для вольт, пересекающих такты системы; растянутая через
    // перенос вольта ложится сегментом на каждую систему.
    if (voltas && voltas.length) {
        drawVoltasInBand(ctx, voltas,
            function (mi) { return voltaBoxes[mi] || null; }, bandTopY);
    }

    // Темповые метки этой системы — общим со экраном кодом (render/tempo), НАД
    // вольтами (bandTopY - vpad - зазор). X доли — из позиции ноты (реестр),
    // иначе левый край такта. Рисуем только метки тактов этой системы.
    if (tempoMarks && tempoMarks.length && bandTopY != null) {
        const voices = cfg.staves.map(function (st) { return st.voice; });
        const primary = voices[0];
        const sysMarks = tempoMarks.filter(function (m) { return voltaBoxes[m.measure]; });
        drawTempos({
            VF: VF,
            marks: sysMarks,
            rowOf: function () { return 0; },
            baselineOf: function () { return bandTopY - (vpad || 0) - 8; },
            ctxOf: function () { return ctx; },
            xOf: function (mi, beat) {
                const notes = (measures[mi] && measures[mi][primary]) || [];
                const idx = indexAtBeat(noteOnsets(notes), beat);
                if (idx >= 0) {
                    const obj = registry[mi + ':' + primary + ':' + idx];
                    if (obj && obj.sn) {
                        try { return obj.sn.getAbsoluteX(); } catch (e) { /* fallthrough */ }
                    }
                }
                return voltaBoxes[mi] ? voltaBoxes[mi].x + 2 : null;
            },
        });
    }

    // Навигация этой системы — общим с экраном кодом (render/navigation), НАД
    // темпом/вольтами (bandTopY - vpad - tpad - зазор).
    if (navMarks && navMarks.length && bandTopY != null) {
        const sysNav = navMarks.filter(function (m) { return voltaBoxes[m.measure]; });
        drawNavigation({
            VF: VF,
            marks: sysNav,
            rowOf: function () { return 0; },
            baselineOf: function () { return bandTopY - (vpad || 0) - (tpad || 0) - 8; },
            boxOf: function (mi) { return voltaBoxes[mi] || null; },
            ctxOf: function () { return ctx; },
        });
    }
}

// Главный вход постраничной вёрстки: строит страницы A4 в #print-root,
// возвращает их количество.
export function renderPrintPages(score) {
    const VF = Vex.Flow;
    const root = el('print-root');
    root.innerHTML = '';

    const instrument = score.instrument === 'drums' ? 'drums' : 'piano';
    const cfg = layoutConfig(instrument);
    const measures = score.measures || [];
    // Действующая тональность КАЖДОГО такта (старт + смены `_key`) — единое
    // разрешение из domain/keysig (та же логика, что у compiler/render).
    const effKeys = cfg.keySig ? effectiveKeys(measures, score.keySignature || 'C') : null;
    // Действующий РАЗМЕР КАЖДОГО такта (старт + смены `_ts`) — единое разрешение
    // из domain/timesig. Глиф размера рисуется ТОЛЬКО где меняется (первый такт +
    // смены), как на экране; в начале систем размер не повторяется.
    const effTs = effectiveTimeSignatures(measures, score.timeSignature || '4/4');
    const tsStr = effTs.map(function (t) { return t.beats + '/' + t.beatValue; });
    // Тип тактовой черты (правой границы) КАЖДОГО такта — единое разрешение из
    // domain/barlines (та же логика, что на экране).
    const bars = effectiveRepeatBarlines(measures, effectiveBarlines(measures));
    // Вольты — единое разрешение из domain/voltas; отрисовка общим со экраном
    // кодом (render/voltas). Когда вольты есть, каждая система получает headroom
    // (vpad) сверху под скобки.
    const voltas = effectiveVoltas(measures);
    const vpad = voltaHeadroom(voltas);
    // Темповые метки (♩ = N) — единое разрешение из domain/tempo, отрисовка общим
    // со экраном кодом (render/tempo). Живут НАД вольтами (доп. headroom tpad).
    const tempoMarks = readTempoMarks(measures);
    const tpad = tempoHeadroom(tempoMarks);
    // Навигация — единое разрешение (render/navigation), общим с экраном кодом.
    // Стоит НАД темпом/вольтами (доп. headroom npad).
    const navMarks = readNavigation(measures);
    const npad = navigationHeadroom(navMarks);
    if (measures.length === 0) return 0;
    // Смена тональности / размера на такте i>0 (для ширины и отрисовки в
    // середине системы). Размер на такте 0 — голова первой системы.
    const changedAt = function (i) {
        return effKeys && i > 0 && effKeys[i] !== effKeys[i - 1];
    };
    const tsChange = function (i) {
        return i > 0 && tsStr[i] !== tsStr[i - 1];
    };
    const timeChangedAt = function (i) { return i === 0 || tsChange(i); };

    // --- проход 1: минимальные ширины тактов (по размеру КАЖДОГО такта) ---
    const cm = [];
    for (let i = 0; i < measures.length; i++) {
        const vs = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[i][st.voice] || [], st.clef,
                effTs[i].beats, effTs[i].beatValue, -1, -1, st.voice);
        });
        cm.push(Math.max(48, measureMinWidth(VF, vs)));
    }

    // первая страница + замер дополнительной ширины смен тональности/размера в
    // середине системы (учитывается в раскладке, чтобы такт со сменой не сжал
    // ноты). Один общий lead на такт: тональность [+ отмена] и/или размер.
    const ctx0 = newPage(root);
    const lead = [];
    for (let i = 0; i < measures.length; i++) {
        const kc = changedAt(i), tc = tsChange(i);
        lead.push((kc || tc)
            ? midLeadWidth(VF, ctx0, kc ? effKeys[i] : null,
                kc ? effKeys[i - 1] : null, tc ? tsStr[i] : null)
            : 0);
    }
    // Ведущая ширина смены в середине системы (0, если такт — первый в системе:
    // там смена уходит в «голову»).
    const midLead = function (sys, k) {
        return (k > sys.firstMeasure && (changedAt(k) || tsChange(k))) ? lead[k] : 0;
    };
    // Ширина «головы» системы по её действующей тональности (+ размер, если
    // система начинается с такта 0 или со смены размера, + бекары-отмена при
    // смене тональности).
    const headOfSystem = function (f) {
        const sysKey = effKeys ? effKeys[f] : null;
        const cancel = (effKeys && f > 0) ? cancelKeyFor(effKeys[f - 1], effKeys[f]) : null;
        const timeStr = timeChangedAt(f) ? tsStr[f] : null;
        return headWidth(VF, ctx0, cfg, sysKey, timeStr, cancel);
    };

    // --- проход 2: разбиение на системы ---
    const W = printW();
    const systems = [];
    let i = 0;
    while (i < measures.length) {
        const sys = { items: [], firstMeasure: i, L: headOfSystem(i) };
        let used = sys.L;
        while (i < measures.length) {
            const add = cm[i] + MEASURE_PAD + midLead(sys, i);
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
        const leadSum = sys.items.reduce(function (a, k) { return a + midLead(sys, k); }, 0);
        const natural = sumCm + sys.items.length * MEASURE_PAD + leadSum;
        const isLast = si === systems.length - 1;
        let delta = budget - natural;
        if (delta < 0) delta = 0;
        const justify = !(isLast && natural / budget < 0.5);
        sys.widths = {};
        sys.items.forEach(function (k) {
            // Смена тональности — ФИКСИРОВАННАЯ часть ширины такта; justify
            // распределяет остаток по содержимому (cm), не по ведущей ширине.
            let cw = cm[k] + MEASURE_PAD + midLead(sys, k);
            if (justify && sumCm > 0) cw += delta * (cm[k] / sumCm);
            sys.widths[k] = cw;
        });
    });

    // --- проход 4: страничная раскладка (вертикальный justify) ---
    const Hh = printH();
    // Высота системы включает headroom вольт, темпа и навигации (над станом).
    const sysH = cfg.systemHeight + vpad + tpad + npad;
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
    // Реестр станов "mi:voice" -> {stave, ctx} — нужен проходу оттенков.
    const printStaves = {};
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
                effTs, tsStr, effKeys, bars, sysGi, printObjs, printStaves,
                voltas, vpad, tempoMarks, tpad, navMarks, npad);
            sysGi++;
            y += sysH + gap;
        }
    }

    // Лиги Tie/Slur — отдельным проходом после отрисовки всех страниц.
    try { drawPrintTiesAndSlurs(VF, score, printObjs); }
    catch (err) { console.error('drawPrintTiesAndSlurs failed:', err); }

    // Динамические оттенки и вилки — отдельным проходом (позиции нот и станы
    // готовы). effTs передаём для абсолютной сетки долей (геометрия вилок).
    try { drawPrintDynamics(VF, score, printObjs, printStaves, effTs); }
    catch (err) { console.error('drawPrintDynamics failed:', err); }

    return pages.length;
}

// Проход оттенков для печати — ТОТ ЖЕ алгоритм, что на экране (dynamicsBaseline):
// одна базовая линия на (система+голос), под нотами, без столкновений. Геометрию
// берём из VF (StaveNote.getBoundingBox / Stave.getYForLine), позицию СЧИТАЕТ
// общий слой — поэтому PDF и экран совпадают.
function drawPrintDynamics(VF, score, registry, staveReg, effTs) {
    const measures = score.measures || [];
    const voices = voiceListOf(score);

    // --- 1. Линейки станов по группе "sys:voice" (система — на одной странице,
    //         поэтому координаты/ctx согласованы внутри группы) ---
    const staffBot = {}, staffTop = {};
    for (const k in staveReg) {
        const sr = staveReg[k];
        const gk = sr.sys + ':' + k.split(':')[1];
        if (staffBot[gk] != null) continue;
        try {
            staffBot[gk] = sr.stave.getYForLine(4);
            staffTop[gk] = sr.stave.getYForLine(0);
        } catch (e) { /* нет стана — пропуск */ }
    }

    // --- 2. Низы bbox ВСЕХ нот группы (для согласованной базы) ---
    const bottoms = {};
    for (const id in registry) {
        const o = registry[id];
        if (!o || !o.sn) continue;
        const gk = o.sys + ':' + id.split(':')[1];
        let bb;
        try { bb = o.sn.getBoundingBox(); } catch (e) { continue; }
        if (!bb) continue;
        (bottoms[gk] || (bottoms[gk] = [])).push(bb.getY() + bb.getH());
    }

    // --- 3. Базовая линия группы (treble grand staff: потолок = верх bass) ---
    const baseline = {};
    for (const gk in staffBot) {
        const parts = gk.split(':');
        const cap = (parts[1] === 'treble') ? staffTop[parts[0] + ':bass'] : null;
        baseline[gk] = dynamicsBaseline(staffBot[gk], bottoms[gk], cap);
    }

    // --- 4. Отрисовка: глиф по центру ноты на базовой линии группы ---
    for (let mi = 0; mi < measures.length; mi++) {
        const dynAll = measures[mi] && measures[mi]._dyn;
        if (!dynAll) continue;
        for (let vi = 0; vi < voices.length; vi++) {
            const v = voices[vi];
            const list = dynAll[v];
            if (!list || !list.length) continue;
            const sr = staveReg[mi + ':' + v];
            if (!sr) continue;
            const y = baseline[sr.sys + ':' + v];
            if (y == null) continue;
            const onsets = noteOnsets((measures[mi] && measures[mi][v]) || []);
            for (let k = 0; k < list.length; k++) {
                const d = list[k];
                const idx = indexAtBeat(onsets, d.beat || 0);
                const obj = registry[mi + ':' + v + ':' + (idx >= 0 ? idx : 0)];
                if (!obj || !obj.sn) continue;
                let x;
                try { x = obj.sn.getAbsoluteX(); } catch (e) { continue; }
                drawDynamic(VF, sr.ctx, x, y, d.mark);
            }
        }
    }

    // --- 5. Вилки (cresc./dim.) — общий слой render/hairpins (тот же код, что и
    //         на экране). Аксессоры печати: sys как «строка», станы/ноты — из
    //         реестров. Абсолютная сетка долей — из effTs. ---
    const hairpins = readHairpins(measures);
    if (hairpins.length) {
        const topVoice = voices[0];
        const capsQ = (effTs || []).map(measureCapacityQ);
        const starts = measureStarts(capsQ);
        const staveOf = function (mi) {
            const sr = staveReg[mi + ':' + topVoice];
            return sr ? sr.stave : null;
        };
        drawHairpins({
            hairpins: hairpins,
            starts: starts,
            rowOf: function (mi) {
                const sr = staveReg[mi + ':' + topVoice];
                return sr ? sr.sys : null;
            },
            geomOf: function (mi) {
                const s = staveOf(mi);
                if (!s) return null;
                try { return { x: s.getX(), w: s.getWidth() }; } catch (e) { return null; }
            },
            baselineOf: function (sys, v) {
                const y = baseline[sys + ':' + v];
                return y == null ? null : y;
            },
            xAtBeat: function (mi, v, b) {
                const notes = (measures[mi] && measures[mi][v]) || [];
                const idx = indexAtBeat(noteOnsets(notes), b);
                if (idx >= 0) {
                    const obj = registry[mi + ':' + v + ':' + idx];
                    if (obj && obj.sn) {
                        try { return obj.sn.getAbsoluteX(); } catch (e) { /* fallthrough */ }
                    }
                }
                const s = staveOf(mi);
                if (!s) return null;
                const q = capsQ[mi] || 4;
                try {
                    return s.getNoteStartX() + (q > 0 ? (b / q) : 0) *
                        (s.getX() + s.getWidth() - s.getNoteStartX());
                } catch (e) { return null; }
            },
            ctxOf: function (sys) {
                // ctx системы: у любого стана этой системы он общий.
                for (const k in staveReg) {
                    if (staveReg[k].sys === sys) return staveReg[k].ctx;
                }
                return null;
            },
        });
    }
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
