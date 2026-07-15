// [ScoreFlow engine] Print Engine — постраничная печатная вёрстка.
//
//   Score -> Print Layout Engine -> Page Layout -> PDF
//
// Печать — ОТДЕЛЬНЫЙ продукт, не масштабирование экрана: геометрия считается
// ОТ БУМАГИ (print/paper.js), плотность — издательская (стан 7 мм), разбиение
// тактов на системы и систем на страницы — оптимальное ДП по badness
// (print/breaks.js, как перенос строк TeX), высота каждой системы — из её
// СОДЕРЖИМОГО (print/metrics.js + print/vertical.js, модельные габариты без
// отрисовки — пагинация детерминированна за один проход). PDF просто печатает
// результат (@media print + системный принтер WebView).
//
// Отрисовка объектов — ОБЩИМИ с экраном слоями (voltas/tempo/navigation/
// dynamics/hairpins/barlines + примитивы layout.js): экран и печать различаются
// ВЁРСТКОЙ (что где стоит), но не гравировкой (как оно рисуется). Экранного
// состояния (state.dynSpacing и пр.) печать НЕ читает.
//
// Масштаб применяется ОДНИМ вектором: страница-SVG получает физический размер
// в px и viewBox в гравировочных единицах — все слои рисуют в родных единицах
// VexFlow без пересчёта координат.
import { el } from '../utils/dom.js';
import { buildVoice, beamGroups, buildTuplets, measureMinWidth } from './layout.js';
import { voiceListOf, nextRealNote, sameKeys } from '../domain/notes.js';
import { effectiveKeys, cancelKeyFor } from '../domain/keysig.js';
import { effectiveTimeSignatures } from '../domain/timesig.js';
import { effectiveBarlines } from '../domain/barlines.js';
import { effectiveRepeatBarlines } from '../domain/repeats.js';
import { effectiveVoltas } from '../domain/voltas.js';
import { readTempoMarks } from '../domain/tempo.js';
import { setupBarline, drawCustomBarline, drawGrandBarline } from './barlines.js';
import { drawVoltasInBand } from './voltas.js';
import { drawTempos } from './tempo.js';
import { drawNavigation, readNavigation } from './navigation.js';
import { solveTopBand } from './top_band.js';
import { drawDynamic } from './dynamics.js';
import { dynamicsBaseline } from './dynamics_layout.js';
import { noteOnsets, indexAtBeat, readHairpins } from '../domain/dynamics.js';
import { measureCapacityQ, measureStarts } from '../domain/timesig.js';
import { drawHairpins } from './hairpins.js';
import { paperGeometry } from '../print/paper.js';
import { breakSystems, breakPages } from '../print/breaks.js';
import { measureExtents, dynamicsPresence } from '../print/metrics.js';
import { systemProfile } from '../print/vertical.js';
import { titleBlockHeight, drawTitleBlock, drawFooter } from '../print/header.js';

const MEASURE_PAD = 14;    // правый запас в такте (дыхание/барлайн)
const NOTE_RIGHT_PAD = 10; // запас справа от последней ноты
const SYS_GAP_MIN = 26;    // мин. интервал между системами (к их резервам)
const SYS_GAP_MAX = 64;    // потолок интервала при вертикальном justify
const LAST_SYS_JUSTIFY = 0.6; // последняя система тянется, если fill >= 60%
const MNUM_PX = 9;         // физический кегль номера такта (px @96dpi)
const MNUM_GAP = 6;        // воздух между номером такта и слоем под ним
// Цвет линий стана НА БУМАГЕ: издательская печать — чёрный (ноты и стан одной
// краской). Экран остаётся на сером дефолте VexFlow (#999999) — там стан
// намеренно тише нот.
const STAFF_LINE_COLOR = '#000000';

// Конфигурация станов под инструмент (клефы/голоса; вертикаль — per-system).
function staffConfig(instrument) {
    if (instrument === 'drums') {
        return {
            grand: false,
            staves: [{ voice: 'perc', clef: 'percussion' }],
            keySig: false,
        };
    }
    return {
        grand: true,
        staves: [
            { voice: 'treble', clef: 'treble' },
            { voice: 'bass', clef: 'bass' },
        ],
        keySig: true,
    };
}

// Новая страница: SVG физического размера с viewBox в гравировочных единицах.
function newPage(root, geom) {
    const div = document.createElement('div');
    div.className = 'pf-page';
    root.appendChild(div);
    const r = new Vex.Flow.Renderer(div, Vex.Flow.Renderer.Backends.SVG);
    r.resize(geom.W, geom.H);
    const svg = div.querySelector('svg');
    if (svg) {
        svg.setAttribute('viewBox', '0 0 ' + geom.W + ' ' + geom.H);
        svg.setAttribute('width', geom.pageWpx);
        svg.setAttribute('height', geom.pageHpx);
        svg.style.width = geom.pageWpx + 'px';
        svg.style.height = geom.pageHpx + 'px';
    }
    return r.getContext();
}

// Ширина «головы» стана: ключ + ключевые знаки [+ бекары-отмена] [+ размер].
function headWidth(VF, ctx, cfg, keySig, timeStr, cancelSig) {
    const s = new VF.Stave(0, 0, 400);
    s.addClef(cfg.staves[0].clef);
    if (cfg.keySig && keySig) s.addKeySignature(keySig, cancelSig || undefined);
    if (timeStr) s.addTimeSignature(timeStr);
    s.setContext(ctx);
    s.format();
    return s.getNoteStartX() - s.getX();
}

// Дополнительная ширина смены тональности И/ИЛИ размера В СЕРЕДИНЕ системы.
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

// Отрисовка одной системы. [env] — окружение печати (геометрия, разрешённые
// слои партитуры, реестры, вертикальный профиль системы). [yTop] — верх ПОЛОСЫ
// системы (стан ниже на sys.pro.padTop).
function drawSystem(VF, ctx, sys, yTop, env) {
    const geom = env.geom, cfg = env.cfg, measures = env.measures;
    const effTs = env.effTs, tsStr = env.tsStr, effKeys = env.effKeys;
    const bars = env.bars;
    let x = geom.mx;
    const staveY = yTop + sys.pro.padTop;
    // Сдвиги станов системы: grand — bass ниже на per-system bassDY.
    const dyOf = cfg.grand ? [0, sys.pro.bassDY] : [0];
    const voltaBoxes = {};
    let bandTopY = null;
    const f = sys.firstMeasure;
    const sysKey = effKeys ? effKeys[f] : null;
    const sysCancel = (effKeys && f > 0) ? cancelKeyFor(effKeys[f - 1], effKeys[f]) : null;
    const headTimeStr = (f === 0 || (f > 0 && tsStr[f] !== tsStr[f - 1]))
        ? tsStr[f] : null;
    sys.items.forEach(function (idx, pos) {
        const isFirst = (pos === 0);
        const content = sys.widths[idx];
        const staveW = (isFirst ? sys.L : 0) + content;
        const midCancel = (effKeys && idx > 0) ? cancelKeyFor(effKeys[idx - 1], effKeys[idx]) : null;
        const midChange = !isFirst && cfg.keySig && midCancel != null;
        const midTimeChange = !isFirst && idx > 0 && tsStr[idx] !== tsStr[idx - 1];

        const voices = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[idx][st.voice] || [], st.clef,
                effTs[idx].beats, effTs[idx].beatValue, -1, idx, st.voice);
        });

        const staves = cfg.staves.map(function (st, si) {
            const stave = new VF.Stave(x, staveY + dyOf[si], staveW,
                { fill_style: STAFF_LINE_COLOR });
            if (isFirst) {
                stave.addClef(st.clef);
                if (cfg.keySig && sysKey) stave.addKeySignature(sysKey, sysCancel || undefined);
                if (headTimeStr) stave.addTimeSignature(headTimeStr);
            } else if (midChange || midTimeChange) {
                // Клеф середины системы не рисуется, но тональность берёт
                // вертикальные линии знаков из getClef() — задаём контекст
                // клефа явно (без глифа).
                stave.clef = st.clef;
                if (midChange) stave.addKeySignature(effKeys[idx], midCancel);
                if (midTimeChange) stave.addTimeSignature(tsStr[idx]);
            }
            if (cfg.grand) stave.setEndBarType(VF.Barline.type.NONE);
            else setupBarline(VF, stave, bars[idx]);
            stave.setContext(ctx);
            stave.format();
            return stave;
        });

        if (env.staveReg) {
            cfg.staves.forEach(function (st, si) {
                env.staveReg[idx + ':' + st.voice] =
                    { stave: staves[si], ctx: ctx, sys: env.sysIndex };
            });
        }

        // Единый старт нот по всем станам системы.
        let startX = x;
        staves.forEach(function (s) { startX = Math.max(startX, s.getNoteStartX()); });
        staves.forEach(function (s) { s.setNoteStartX(startX); });
        const contentW = Math.max(40, (x + staveW) - startX - NOTE_RIGHT_PAD);

        const fmt = new VF.Formatter();
        voices.forEach(function (v) { fmt.joinVoices([v]); });
        const tuplets = [];
        voices.forEach(function (v) {
            buildTuplets(VF, v).forEach(function (t) { tuplets.push(t); });
        });
        fmt.format(voices, contentW);

        staves.forEach(function (s) { s.draw(); });
        if (cfg.grand) {
            drawGrandBarline(VF, ctx, staves[0], staves[staves.length - 1], bars[idx]);
        } else {
            staves.forEach(function (s) { drawCustomBarline(VF, ctx, s, bars[idx]); });
        }
        voices.forEach(function (v, si) {
            const beams = VF.Beam.generateBeams(v.getTickables(), {
                groups: beamGroups(VF, effTs[idx].beats, effTs[idx].beatValue),
                beam_rests: false,
                maintain_stem_directions: true,
            });
            v.draw(ctx, staves[si]);
            beams.forEach(function (b) {
                b.setContext(ctx).draw();
                // Габарит балки — в профиль динамики (drawPrintDynamics):
                // балки не входят в bbox нот.
                if (env.beamReg) {
                    const n0 = b.getNotes && b.getNotes()[0];
                    if (n0 && n0.__hit) {
                        try {
                            const bb = b.getBoundingBox();
                            if (bb) {
                                const bk = env.sysIndex + ':' + n0.__hit.v;
                                (env.beamReg[bk] || (env.beamReg[bk] = []))
                                    .push({ top: bb.getY(), bottom: bb.getY() + bb.getH() });
                            }
                        } catch (e) { /* нет bbox — пропуск */ }
                    }
                }
            });
            if (env.registry) {
                v.getTickables().forEach(function (t) {
                    if (!t.__hit || t.__hit.i < 0) return;
                    env.registry[t.__hit.m + ':' + t.__hit.v + ':' + t.__hit.i] =
                        { sn: t, ctx: ctx, sys: env.sysIndex };
                });
            }
        });
        tuplets.forEach(function (t) {
            try {
                if (ctx.openGroup) ctx.openGroup('sf-tuplet');
                try { t.setContext(ctx).draw(); }
                finally { if (ctx.openGroup) ctx.closeGroup(); }
            } catch (e) { console.error('tuplet draw failed:', e); }
        });

        if (isFirst && cfg.grand) {
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }

        // Номер первого такта системы (кроме такта 0) — мелкий курсивный
        // serif НИЗКО над станом, выключенный ВЛЕВО от начала системы
        // (заканчивается перед ключом). Ноты, крюк/номер вольты, темп и
        // навигация живут правее/выше — номер ни с чем не пересекается и
        // не требует подъёма в межсистемный интервал.
        if (isFirst && sys.firstMeasure > 0) {
            const size = env.geom.fontU(MNUM_PX);
            const label = String(sys.firstMeasure + 1);
            if (ctx.openGroup) ctx.openGroup('sf-mnum');
            ctx.save();
            ctx.setFont('serif', size, 'italic');
            let tw = label.length * size * 0.5;
            try {
                const m = ctx.measureText(label);
                if (m && m.width > 0) tw = m.width;
            } catch (e) { /* оценка выше */ }
            ctx.fillText(label, x - 3 - tw, staves[0].getYForLine(0) - MNUM_GAP);
            ctx.restore();
            if (ctx.openGroup) ctx.closeGroup();
        }

        voltaBoxes[idx] = { x: x, w: staveW };
        if (bandTopY == null) bandTopY = staves[0].getYForLine(0);

        x += staveW;
    });

    // --- Верхние метки системы: вольты -> темп -> навигация --------------
    // Размещение — ОБЩИЙ движок (render/top_band, тот же, что на экране):
    // skyline по выступающим нотам + реальные габариты меток и РЕАЛЬНЫЕ якоря
    // (X нот из registry). Резерв места сделал vertical.systemProfile тем же
    // движком с консервативными габаритами — здесь метки садятся максимально
    // низко без столкновений и гарантированно в пределах резерва.
    if (bandTopY != null) {
        const primary = cfg.staves[0].voice;
        const boxOf = function (mi) { return voltaBoxes[mi] || null; };
        const xOf = function (mi, beat) {
            const notes = (measures[mi] && measures[mi][primary]) || [];
            const idx = indexAtBeat(noteOnsets(notes), beat);
            if (idx >= 0) {
                const obj = env.registry[mi + ':' + primary + ':' + idx];
                if (obj && obj.sn) {
                    try { return obj.sn.getAbsoluteX(); } catch (e) { /* fallthrough */ }
                }
            }
            return voltaBoxes[mi] ? voltaBoxes[mi].x + 2 : null;
        };
        const inSys = function (m) { return voltaBoxes[m.measure] != null; };
        const sysTempo = (env.tempoMarks || []).filter(inSys);
        const sysNav = (env.navMarks || []).filter(inSys);
        if ((env.voltas && env.voltas.length) || sysTempo.length || sysNav.length) {
            const band = solveTopBand({
                VF: VF, ctx: ctx, staffTop: bandTopY,
                measures: sys.items,
                boxOf: boxOf,
                aboveOf: env.topClearOf,
                voltas: env.voltas,
                tempoMarks: sysTempo,
                navMarks: sysNav,
                anchorXOf: function (m) { return xOf(m.measure, m.beat || 0); },
            });
            if (env.voltas && env.voltas.length) {
                drawVoltasInBand(ctx, env.voltas, boxOf, bandTopY, band.voltaYOf);
            }
            if (sysTempo.length) {
                drawTempos({
                    VF: VF,
                    marks: sysTempo,
                    rowOf: function () { return 0; },
                    yOf: function (m, i) { return band.tempoYOf(i); },
                    ctxOf: function () { return ctx; },
                    xOf: xOf,
                });
            }
            if (sysNav.length) {
                drawNavigation({
                    VF: VF,
                    marks: sysNav,
                    rowOf: function () { return 0; },
                    yOf: function (m, i) { return band.navYOf(i); },
                    boxOf: boxOf,
                    ctxOf: function () { return ctx; },
                });
            }
        }
    }
}

// Главный вход печатной вёрстки: строит страницы (по умолчанию A4 portrait)
// в #print-root, возвращает их количество.
export function renderPrintPages(score) {
    const VF = Vex.Flow;
    const root = el('print-root');
    root.innerHTML = '';

    const measures = score.measures || [];
    if (measures.length === 0) return 0;

    const geom = paperGeometry('a4');
    const instrument = score.instrument === 'drums' ? 'drums' : 'piano';
    const cfg = staffConfig(instrument);

    // --- Разрешённые слои партитуры (единые domain-резолверы) -------------
    const effKeys = cfg.keySig ? effectiveKeys(measures, score.keySignature || 'C') : null;
    const effTs = effectiveTimeSignatures(measures, score.timeSignature || '4/4');
    const tsStr = effTs.map(function (t) { return t.beats + '/' + t.beatValue; });
    const bars = effectiveRepeatBarlines(measures, effectiveBarlines(measures));
    const voltas = effectiveVoltas(measures);
    const tempoMarks = readTempoMarks(measures);
    const navMarks = readNavigation(measures);

    const changedAt = function (i) {
        return effKeys && i > 0 && effKeys[i] !== effKeys[i - 1];
    };
    const tsChange = function (i) { return i > 0 && tsStr[i] !== tsStr[i - 1]; };
    const timeChangedAt = function (i) { return i === 0 || tsChange(i); };

    // --- Модельные вертикальные габариты (без отрисовки) ------------------
    const topVoice = cfg.staves[0].voice;
    const extTop = measureExtents(measures, topVoice, cfg.staves[0].clef);
    const extBottom = cfg.grand
        ? measureExtents(measures, 'bass', 'bass') : null;
    const dynTop = dynamicsPresence(measures, topVoice);
    const dynBottom = cfg.grand ? dynamicsPresence(measures, 'bass') : null;
    const topClearOf = function (mi) {
        const e = extTop[mi];
        return e ? e.above : 0;
    };

    // --- Проход 1: минимальные ширины тактов -------------------------------
    const ctx0 = newPage(root, geom); // первая страница; она же метрический ctx
    const cm = [];
    for (let i = 0; i < measures.length; i++) {
        const vs = cfg.staves.map(function (st) {
            return buildVoice(VF, measures[i][st.voice] || [], st.clef,
                effTs[i].beats, effTs[i].beatValue, -1, -1, st.voice);
        });
        cm.push(Math.max(48, measureMinWidth(VF, vs)));
    }
    // Ширины смен тональности/размера в середине системы.
    const leads = [];
    for (let i = 0; i < measures.length; i++) {
        const kc = changedAt(i), tc = tsChange(i);
        leads.push((kc || tc)
            ? midLeadWidth(VF, ctx0, kc ? effKeys[i] : null,
                kc ? effKeys[i - 1] : null, tc ? tsStr[i] : null)
            : 0);
    }
    // Ширины «голов» систем-кандидатов (система может начаться с любого такта).
    const headW = [];
    for (let i = 0; i < measures.length; i++) {
        const sysKey = effKeys ? effKeys[i] : null;
        const cancel = (effKeys && i > 0) ? cancelKeyFor(effKeys[i - 1], effKeys[i]) : null;
        const timeStr = timeChangedAt(i) ? tsStr[i] : null;
        headW.push(headWidth(VF, ctx0, cfg, sysKey, timeStr, cancel));
    }

    // --- Проход 2: оптимальное разбиение на системы (ДП) -------------------
    const W = geom.contentW;
    const systems = breakSystems({
        count: measures.length,
        widths: cm.map(function (w) { return w + MEASURE_PAD; }),
        leads: leads,
        headOf: function (i) { return headW[i]; },
        W: W,
    });
    systems.forEach(function (sys) { sys.L = headW[sys.firstMeasure]; });

    // --- Проход 3: горизонтальный justify ----------------------------------
    const midLead = function (sys, k) {
        return (k > sys.firstMeasure && (changedAt(k) || tsChange(k))) ? leads[k] : 0;
    };
    systems.forEach(function (sys, si) {
        const budget = W - sys.L;
        const sumCm = sys.items.reduce(function (a, k) { return a + cm[k]; }, 0);
        const leadSum = sys.items.reduce(function (a, k) { return a + midLead(sys, k); }, 0);
        const natural = sumCm + sys.items.length * MEASURE_PAD + leadSum;
        const isLast = si === systems.length - 1;
        let delta = budget - natural;
        if (delta < 0) delta = 0;
        // Последняя система тянется к правому полю только при достаточном
        // заполнении (издательская конвенция: короткий хвост не растягивают).
        const justify = !isLast || natural / budget >= LAST_SYS_JUSTIFY;
        sys.widths = {};
        sys.items.forEach(function (k) {
            let cw = cm[k] + MEASURE_PAD + midLead(sys, k);
            if (justify && sumCm > 0) cw += delta * (cm[k] / sumCm);
            sys.widths[k] = cw;
        });
    });

    // --- Проход 4: вертикальный профиль каждой системы ---------------------
    // Резерв верхней полосы (выступ нот + вольты + темп + навигация) — ОБЩИЙ
    // движок размещения (render/top_band): skyline по X-габаритам тактов
    // системы (ширины известны после прохода 3). Якоря нот ещё неизвестны —
    // габариты меток консервативны; точное размещение при отрисовке
    // (drawSystem) гарантированно уложится в резерв (монотонность skyline).
    const boxesOfSystem = function (sys) {
        const boxes = {};
        let x = geom.mx;
        sys.items.forEach(function (idx, pos) {
            const w = (pos === 0 ? sys.L : 0) + sys.widths[idx];
            boxes[idx] = { x: x, w: w };
            x += w;
        });
        return boxes;
    };
    systems.forEach(function (sys) {
        const boxes = boxesOfSystem(sys);
        const inSys = function (m) { return boxes[m.measure] != null; };
        const band = solveTopBand({
            VF: VF, ctx: ctx0, staffTop: 0,
            measures: sys.items,
            boxOf: function (mi) { return boxes[mi] || null; },
            aboveOf: topClearOf,
            voltas: voltas,
            tempoMarks: tempoMarks.filter(inSys),
            navMarks: navMarks.filter(inSys),
            anchorXOf: null,
        });
        sys.pro = systemProfile({
            grand: cfg.grand,
            items: sys.items,
            extTop: extTop,
            extBottom: extBottom,
            dynTop: dynTop,
            dynBottom: dynBottom,
            topReserve: band.padTop,
        });
        // Резерв под номер такта: сидит низко над станом слева от системы
        // (см. drawSystem) — системе достаточно места на высоту текста.
        if (sys.firstMeasure > 0) {
            const need = MNUM_GAP + geom.fontU(MNUM_PX) + 2;
            if (need > sys.pro.padTop) {
                sys.pro.height += need - sys.pro.padTop;
                sys.pro.padTop = need;
            }
        }
    });

    // --- Проход 5: оптимальное разбиение на страницы (ДП) -------------------
    const titleH = titleBlockHeight(geom, score);
    const pages = breakPages({
        heights: systems.map(function (s) { return s.pro.height; }),
        gap: SYS_GAP_MIN,
        firstH: geom.contentH - titleH,
        restH: geom.contentH,
    });

    // --- Отрисовка страниц ---------------------------------------------------
    const printObjs = {};   // noteId -> {sn, ctx, sys} (проход лиг)
    const printStaves = {}; // "mi:voice" -> {stave, ctx, sys} (проход оттенков)
    const printBeams = {};  // "sys:voice" -> [{top, bottom}] (профиль динамики)
    let sysGi = 0;

    for (let p = 0; p < pages.length; p++) {
        const idxs = pages[p];
        const ctx = (p === 0) ? ctx0 : newPage(root, geom);
        const isLastPage = p === pages.length - 1;
        let headOffset = 0;
        if (p === 0) headOffset = drawTitleBlock(ctx, geom, score);
        drawFooter(ctx, geom, p);

        // Вертикальный justify: излишек — в интервалы (с потолком), последняя
        // страница остаётся прижатой к верху (частичная страница — норма).
        const budgetH = geom.contentH - headOffset;
        const sumH = idxs.reduce(function (a, s) { return a + systems[s].pro.height; }, 0);
        let gap = SYS_GAP_MIN;
        if (idxs.length > 1 && !isLastPage) {
            gap = (budgetH - sumH) / (idxs.length - 1);
            gap = Math.max(SYS_GAP_MIN, Math.min(SYS_GAP_MAX, gap));
        }

        let y = geom.mtop + headOffset;
        for (let k = 0; k < idxs.length; k++) {
            const sys = systems[idxs[k]];
            drawSystem(VF, ctx, sys, y, {
                geom: geom, cfg: cfg, measures: measures,
                effTs: effTs, tsStr: tsStr, effKeys: effKeys, bars: bars,
                sysIndex: sysGi, registry: printObjs, staveReg: printStaves,
                beamReg: printBeams,
                voltas: voltas, tempoMarks: tempoMarks, navMarks: navMarks,
                topClearOf: topClearOf,
            });
            sysGi++;
            y += sys.pro.height + gap;
        }
    }

    // Лиги Tie/Slur — отдельным проходом после отрисовки всех страниц.
    try { drawPrintTiesAndSlurs(VF, score, printObjs); }
    catch (err) { console.error('drawPrintTiesAndSlurs failed:', err); }

    // Динамические оттенки и вилки — отдельным проходом.
    try { drawPrintDynamics(VF, score, printObjs, printStaves, printBeams, effTs); }
    catch (err) { console.error('drawPrintDynamics failed:', err); }

    return pages.length;
}

// Проход оттенков для печати — ТОТ ЖЕ алгоритм, что на экране (dynamicsBaseline):
// одна базовая линия на (система+голос), под нотами, без столкновений.
function drawPrintDynamics(VF, score, registry, staveReg, beamReg, effTs) {
    const measures = score.measures || [];
    const voices = voiceListOf(score);

    // --- 1. Линейки станов по группе "sys:voice" ---
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

    // --- 2. Низы bbox ВСЕХ нот группы (для согласованной базы) и верхи
    //         содержимого (для потолка treble-группы в аколаде) ---
    const bottoms = {};
    const tops = {};
    const seeTop = function (gk, y) {
        if (tops[gk] == null || y < tops[gk]) tops[gk] = y;
    };
    for (const id in registry) {
        const o = registry[id];
        if (!o || !o.sn) continue;
        const gk = o.sys + ':' + id.split(':')[1];
        let bb;
        try { bb = o.sn.getBoundingBox(); } catch (e) { continue; }
        if (!bb) continue;
        (bottoms[gk] || (bottoms[gk] = [])).push(bb.getY() + bb.getH());
        seeTop(gk, bb.getY());
    }
    // Балки не входят в bbox нот — их низы обязаны попасть в профиль.
    for (const bk in (beamReg || {})) {
        const list = beamReg[bk];
        for (let i = 0; i < list.length; i++) {
            (bottoms[bk] || (bottoms[bk] = [])).push(list[i].bottom);
            seeTop(bk, list[i].top);
        }
    }
    // Модельные габариты: скобки туплетов и артикуляции НИЖЕ нот не входят в
    // bbox VexFlow-ноты — базовая линия оттенков обязана пройти и под ними
    // (иначе pp ложится на скобку «3»). Тот же модуль модели, что у экрана.
    const CLEF_OF = { treble: 'treble', bass: 'bass', perc: 'percussion' };
    for (let vi = 0; vi < voices.length; vi++) {
        const v = voices[vi];
        const ext = measureExtents(measures, v, CLEF_OF[v] || 'treble');
        for (let mi = 0; mi < measures.length; mi++) {
            const e = ext[mi];
            if (!e || !(e.below > 0)) continue;
            const sr = staveReg[mi + ':' + v];
            if (!sr) continue;
            let sb;
            try { sb = sr.stave.getYForLine(4); } catch (e2) { continue; }
            const gk = sr.sys + ':' + v;
            (bottoms[gk] || (bottoms[gk] = [])).push(sb + e.below);
        }
    }

    // --- 3. Базовая линия группы. Потолок treble-группы аколады — верх
    //         СОДЕРЖИМОГО bass (штили баса поднимаются выше его линейки). ---
    const baseline = {};
    for (const gk in staffBot) {
        const parts = gk.split(':');
        let cap = null;
        if (parts[1] === 'treble') {
            cap = staffTop[parts[0] + ':bass'];
            const ct = tops[parts[0] + ':bass'];
            if (ct != null && (cap == null || ct < cap)) cap = ct;
        }
        baseline[gk] = dynamicsBaseline(staffBot[gk], bottoms[gk], cap);
    }

    // --- 4. Отрисовка: глиф по центру ноты на базовой линии группы.
    //         Габариты глифов копятся по (sys:voice) — вилки обходят их по X
    //         (издательское «p < f» без касаний). ---
    const dynBoxes = {}; // "sys:voice" -> [{x0,x1}...]
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
                const box = drawDynamic(VF, sr.ctx, x, y, d.mark);
                const bk = sr.sys + ':' + v;
                (dynBoxes[bk] || (dynBoxes[bk] = [])).push(box);
            }
        }
    }

    // --- 5. Вилки (cresc./dim.) — общий слой render/hairpins ---
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
            // Издательский раствор устья клина (~3 мм при стане 7 мм).
            half: 8,
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
            obstaclesOf: function (sys, v) { return dynBoxes[sys + ':' + v] || null; },
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
                for (const k in staveReg) {
                    if (staveReg[k].sys === sys) return staveReg[k].ctx;
                }
                return null;
            },
        });
    }
}

// Проход лиг для печати: внутри одной системы — целая дуга; между системами —
// частичные дуги на ctx каждого конца (страницы — разные SVG).
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
