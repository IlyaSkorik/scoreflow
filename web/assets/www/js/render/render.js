// [ScoreFlow engine] Render Pipeline — вынесено из index.html без изменений
// логики. Экранный рендер партитуры: раскладка строк, отрисовка станов/нот
// через VexFlow, регистрация координат нот (через formatAndDraw -> state),
// вызов слоёв лиг/геометрии/плеера. Печать (print) сюда НЕ входит — это
// отдельный пайплайн в index.html, использующий общие примитивы из layout.js.
// VF берётся из глобального Vex.Flow (как и в остальном движке).
import { state } from '../utils/state.js';
import { el, showError } from '../utils/dom.js';
import { buildVoice, beamGroups, buildTuplets, measureMinWidth } from './layout.js';
import { drawTiesAndSlurs } from './ligatures.js';
import { drawScreenDynamics } from './dynamics.js';
import { drawSelectionHighlight, keepCursorInView, attachTapListener } from './geometry.js';
import { effectiveKeys, cancelKeyFor } from '../domain/keysig.js';
import { effectiveTimeSignatures } from '../domain/timesig.js';
import { effectiveBarlines } from '../domain/barlines.js';
import { effectiveRepeatBarlines } from '../domain/repeats.js';
import { effectiveVoltas } from '../domain/voltas.js';
import { readTempoMarks } from '../domain/tempo.js';
import { noteOnsets, indexAtBeat } from '../domain/dynamics.js';
import { setupBarline, drawCustomBarline, setupGrandBarline, drawGrandBarline } from './barlines.js';
import { drawVoltasInBand } from './voltas.js';
import { drawTempos } from './tempo.js';
import { drawNavigation, readNavigation } from './navigation.js';
import { solveTopBand } from './top_band.js';
import { measureExtents, dynamicsPresence } from '../print/metrics.js';
import { DYN_STAFF_GAP, DYN_NOTE_CLEAR, DYN_CAP_MARGIN } from './dynamics_layout.js';
import { Playback } from '../playback/scheduler.js';

function clearCanvas() {
    const c = el('notation-container');
    const svg = c.querySelector('svg');
    if (svg) svg.remove();
    const err = el('engine-error');
    if (err) err.remove();
}

// --- Главная функция отрисовки -------------------------------------
// [forcedWidth] — фиксированная ширина полотна (для экспорта в PDF под
// печатную ширину A4); иначе берётся ширина контейнера.
export function render(score, forcedWidth) {
    if (typeof Vex === 'undefined' || !Vex.Flow) {
        showError('Нотный движок не загрузился (assets/www/js/vexflow.js).');
        return;
    }
    const VF = Vex.Flow;
    // Позицию скролла фиксируем ДО пересборки SVG: удаление полотна
    // схлопывает документ и браузер сбрасывает scrollY в 0.
    const prevScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    clearCanvas();
    state.noteHits = [];
    state.noteObjs = {};
    state.noteTransform = {};
    // Габариты балок по голосам ({m, v, top, bottom}) — балки не входят в bbox
    // нот, а профиль динамики обязан пройти и под ними.
    state.beamBottoms = [];
    // Линейки стана каждого голоса по такту — для размещения оттенков ПОД
    // станом (нижняя) и потолка под grand staff (верхняя). Ключ "mi:voice".
    state.staffBottomY = {};
    state.staffTopY = {};

    const container = el('notation-container');
    const width = forcedWidth || Math.max(320, container.clientWidth);
    const isDrums = score.instrument === 'drums';
    const measures = score.measures || [];
    const cursor = score.cursor || { measure: -1, voice: '', index: -1 };

    // --- раскладка: голова (ключ/размер) измеряется реально, а гибкая
    // нотная зона строки раздаётся ПРОПОРЦИОНАЛЬНО содержимому (cm).
    // Плотные такты получают заметно больше ширины (естественный вид),
    // разреженные — меньше. Сжатие нот (scaleX в formatAndDraw) остаётся
    // лишь как страховка для строки, чьё суммарное содержимое физически
    // не влезает; тогда оно равномерно по всем тактам строки.
    const margin = 8;
    const usableW = width - 2 * margin;
    const INNER_PAD = 12; // правый запас (дыхание) в нотной зоне такта
    const voiceList = isDrums ? ['perc'] : ['treble', 'bass'];
    const clefList = isDrums ? ['percussion'] : ['treble', 'bass'];

    const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
    renderer.resize(width, Math.max(1, container.clientHeight || 200));
    const ctx = renderer.getContext();

    // Действующая тональность КАЖДОГО такта (старт партитуры + смены `_key`) —
    // единое разрешение из domain/keysig (та же логика, что у compiler/print).
    const keys = effectiveKeys(measures, score.keySignature || 'C');
    // Тональность для отмены (courtesy naturals) на такте mi: предыдущая, если
    // сменилась. null для ударных/первого такта/без смены (правило — в keysig).
    function cancelOf(mi) {
        if (isDrums || mi <= 0) return null;
        return cancelKeyFor(keys[mi - 1], keys[mi]);
    }

    // Действующий РАЗМЕР КАЖДОГО такта (старт + смены `_ts`) — единое разрешение
    // из domain/timesig (та же логика, что у compiler/print). Глиф размера
    // рисуем ТОЛЬКО там, где он меняется (первый такт + каждая смена) — как в
    // проф. редакторах; в начале систем размер НЕ повторяется (в отличие от
    // тональности). Ёмкость VexFlow Voice берётся per-measure из effTs.
    const effTs = effectiveTimeSignatures(measures, score.timeSignature || '4/4');
    const tsStr = effTs.map(function (t) { return t.beats + '/' + t.beatValue; });
    function timeChangedAt(mi) {
        return mi === 0 || (mi > 0 && tsStr[mi] !== tsStr[mi - 1]);
    }

    // Тип тактовой черты (правой границы) КАЖДОГО такта — единое разрешение из
    // domain/barlines. Нативные типы ставятся на стан до отрисовки, кастартные
    // (dashed/dotted/tick/short) дорисовываются после — общим со страничной
    // печатью кодом (render/barlines), поэтому экран и PDF совпадают.
    const bars = effectiveRepeatBarlines(measures, effectiveBarlines(measures));

    // Вольты (первая/вторая концовка) — единое разрешение из domain/voltas,
    // отрисовка общим со страничной печатью кодом (render/voltas).
    const voltas = effectiveVoltas(measures);
    // Темповые метки (♩ = N) — единое разрешение из domain/tempo, отрисовка общим
    // со страничной печатью кодом (render/tempo).
    const tempoMarks = readTempoMarks(measures);
    // Навигация (Segno/Coda/D.C./D.S./…) — единое разрешение из render/navigation,
    // отрисовка общим с печатью кодом.
    const navMarks = readNavigation(measures);
    // Размещение верхних меток (вольты → темп → навигация) — ОБЩИЙ движок
    // размещения (render/placement + render/top_band, тот же, что у печати):
    // skyline-профиль вместо суммирования фиксированных «резервов слоёв».
    // Метки над разными тактами не раздвигают друг друга; высокие ноты
    // (добавочные линейки) приподнимают то, что реально стоит над ними.
    // Модельные габариты нот над станом — как у печати (print/metrics).
    const extTop = measureExtents(measures, voiceList[0], clefList[0]);
    const aboveOf = function (mi) {
        const e = extTop[mi];
        return e ? e.above : 0;
    };

    // Реальная ширина «головы» стана по ФАКТИЧЕСКИМ начальным модификаторам
    // (ключ [+ тональность с бекарами-отменой] [+ размер]), через getNoteStartX
    // временного стана. beginWidth измеряет ровно то, что будет нарисовано —
    // поэтому смена тональности/размера в середине строки получает корректную
    // ширину и не сжимает ноты.
    function beginWidth(addClef, keyName, cancelName, timeStr) {
        const s = new VF.Stave(0, 0, 500);
        if (addClef) s.addClef(clefList[0]);
        if (!isDrums && keyName) s.addKeySignature(keyName, cancelName || undefined);
        if (timeStr) s.addTimeSignature(timeStr);
        s.setContext(ctx);
        s.format();
        return s.getNoteStartX();
    }
    const headInner = beginWidth(false, null, null, null); // середина строки без модиф.
    // Ведущая ширина такта: на старте строки — ключ+тональность[+размер при
    // смене/такте 0]; в середине строки при смене тональности — тональность с
    // бекарами, при смене размера — глиф размера; иначе — голый отступ.
    function leadOf(col, mi) {
        const keyName = isDrums ? null : keys[mi];
        const cancel = cancelOf(mi);
        const timeStr = timeChangedAt(mi) ? tsStr[mi] : null;
        if (col === 0) return beginWidth(true, keyName, cancel, timeStr);
        if (cancel || timeStr) {
            return beginWidth(false, cancel ? keyName : null, cancel, timeStr);
        }
        return headInner;
    }

    // проход 1: минимальная ширина содержимого каждого такта (по размеру такта)
    const cm = [];
    for (let i = 0; i < measures.length; i++) {
        const vs = voiceList.map(function (v, vi) {
            return buildVoice(VF, measures[i][v] || [], clefList[vi],
                effTs[i].beats, effTs[i].beatValue, -1, i, v);
        });
        cm.push(Math.max(40, measureMinWidth(VF, vs)));
    }

    // проход 2: упаковка в строки — добавляем такты, пока строка
    // помещается БЕЗ сжатия (Σголов + Σсодержимого ≤ usableW).
    const layoutRows = [];
    for (let i = 0; i < measures.length;) {
        const items = [];
        let sumHead = 0, sumE = 0;
        while (i < measures.length) {
            const h = leadOf(items.length === 0 ? 0 : 1, i);
            const e = cm[i] + INNER_PAD;
            if (items.length > 0 && sumHead + sumE + h + e > usableW) break;
            items.push(i); sumHead += h; sumE += e; i++;
        }
        layoutRows.push(items);
    }
    const rows = layoutRows.length;
    // Геометрия каждого такта {row, x, w} (пропорциональное распределение
    // ширины) считается ДО отрисовки: она нужна резервированию верхней полосы
    // (skyline-движок размещения работает по реальным X-габаритам тактов).
    const geom = new Array(measures.length);
    for (let r = 0; r < rows; r++) {
        const items = layoutRows[r];
        let sumHead = 0, sumE = 0;
        const es = items.map(function (mi, col) {
            const e = cm[mi] + INNER_PAD;
            sumE += e;
            sumHead += leadOf(col, mi);
            return e;
        });
        const flexible = Math.max(0, usableW - sumHead);
        // Σсодержимого больше гибкого места -> равномерно сжать (ratio<1);
        // меньше -> разлить остаток пропорц. содержимому (justify), но
        // последнюю (неполную) систему НЕ растягиваем — естественный вид.
        const ratio = sumE > flexible ? flexible / sumE : 1;
        const isLastRow = r === rows - 1;
        const extra = (!isLastRow && sumE < flexible) ? (flexible - sumE) : 0;
        let x = margin;
        for (let col = 0; col < items.length; col++) {
            const i = items[col];
            const contentW = es[col] * ratio +
                (sumE > 0 ? extra * (es[col] / sumE) : 0);
            const w = leadOf(col, i) + contentW;
            geom[i] = { row: r, x: x, w: w };
            x += w;
        }
    }

    // Верхний отступ КАЖДОЙ строки — решение ОБЩЕГО движка размещения
    // (render/top_band): skyline по нотам (добавочные линейки приподнимают
    // метки) + вольты + темп + навигация. До отрисовки якоря нот неизвестны —
    // габариты меток КОНСЕРВАТИВНЫ (метка «занимает весь такт»); точное
    // размещение при отрисовке гарантированно уложится в резерв (монотонность
    // skyline). Из резерва вычитается воздух коробки стана над верхней
    // линейкой (VexFlow рисует линейку 0 ниже верха коробки).
    const staveTopAir = new VF.Stave(0, 0, 100).getYForLine(0)
        + (isDrums ? 20 : 0);
    const boxOfRow = function (r) {
        return function (mi) {
            const g = geom[mi];
            return (g && g.row === r) ? { x: g.x, w: g.w } : null;
        };
    };
    const bandSpec = function (r, staffTop, anchorXOf) {
        const inRow = function (m) {
            const g = geom[m.measure];
            return g && g.row === r;
        };
        return {
            VF: VF, ctx: ctx, staffTop: staffTop,
            measures: layoutRows[r],
            boxOf: boxOfRow(r),
            aboveOf: aboveOf,
            voltas: voltas,
            tempoMarks: tempoMarks.filter(inRow),
            navMarks: navMarks.filter(inRow),
            anchorXOf: anchorXOf,
        };
    };
    // Вертикальный профиль КАЖДОЙ строки (как print/vertical.systemProfile):
    //   pad    — верхняя полоса (метки + выступ нот) НАД верхней линейкой;
    //   bassDY — сдвиг bass-стана (grand), АДАПТИВНЫЙ по-строчно;
    //   below  — содержимое строки НИЖЕ верхней линейки (станы + свесы +
    //            динамика), измеренное предыдущим кадром (computeDesiredSpacing)
    //            или дефолт до первого замера.
    // Строки укладываются встык по РЕАЛЬНЫМ границам содержимого — резервы не
    // суммируются с чужим «воздухом» и не крадут его (раньше 40px воздуха
    // коробки стана учитывались и предыдущей строкой как низ, и следующей как
    // верх — высокие ноты въезжали в динамику строки выше).
    const spRows = (state.dynSpacing && state.dynSpacing.rows &&
        state.dynSpacing.rows.length === rows) ? state.dynSpacing.rows : null;
    const rowSpacing = function (r) {
        if (spRows && spRows[r]) return spRows[r];
        return isDrums ? { bassDY: 0, below: 70 } : { bassDY: 90, below: 160 };
    };
    const rowStaveTop = new Array(rows); // Y верха коробки станов строки
    let accY = margin;
    for (let r = 0; r < rows; r++) {
        const need = solveTopBand(bandSpec(r, 0, null)).padTop;
        const pad = Math.max(0, Math.ceil(need + 4));
        const line0 = accY + pad;
        rowStaveTop[r] = line0 - staveTopAir;
        accY = line0 + rowSpacing(r).below;
    }
    const totalH = accY + margin;
    renderer.resize(width, totalH);

    // Y верхней линейки верхнего стана каждой строки — якорь верхних меток.
    const rowTopY = new Array(rows);

    // проход 3: отрисовка по готовой геометрии
    for (let r = 0; r < rows; r++) {
        const items = layoutRows[r];
        // Стан начинается ниже на резерв строки — над ним место под
        // вольты/темп/навигацию ЭТОЙ строки (0, если сверху ничего нет).
        const yTop = rowStaveTop[r];

        for (let col = 0; col < items.length; col++) {
            const i = items[col];
            const m = measures[i];
            const rowStart = col === 0;
            const x = geom[i].x;
            const w = geom[i].w;

            try {
                if (isDrums) {
                    const stave = new VF.Stave(x, yTop + 20, w);
                    if (rowStart) stave.addClef('percussion');
                    // Размер — только на такте смены (вкл. такт 0), не на каждой
                    // системе.
                    if (timeChangedAt(i)) stave.addTimeSignature(tsStr[i]);
                    setupBarline(VF, stave, bars[i]); // правая граница (до draw)
                    stave.setContext(ctx).draw();
                    drawCustomBarline(VF, ctx, stave, bars[i]); // кастомная (после)
                    if (rowStart) rowTopY[r] = stave.getYForLine(0);

                    const cIdx = (cursor.measure === i && cursor.voice === 'perc')
                        ? cursor.index : -1;
                    const v = buildVoice(VF, m.perc, 'percussion',
                        effTs[i].beats, effTs[i].beatValue, cIdx, i, 'perc');
                    formatAndDraw(VF, ctx, [v], [stave], w, rowStart,
                        effTs[i].beats, effTs[i].beatValue);
                } else {
                    const treble = new VF.Stave(x, yTop, w);
                    const bass = new VF.Stave(x, yTop + rowSpacing(r).bassDY, w);
                    const keyName = keys[i];
                    const cancel = cancelOf(i);
                    if (rowStart) {
                        treble.addClef('treble'); bass.addClef('bass');
                        // Тональность повторяется в начале каждой системы (с
                        // бекарами-отменой, если на этом такте смена).
                        treble.addKeySignature(keyName, cancel || undefined);
                        bass.addKeySignature(keyName, cancel || undefined);
                    } else if (cancel) {
                        // Смена тональности в середине строки — сразу после
                        // барлайна: сначала бекары прежних знаков, затем новые
                        // (правило гравировки реализует VexFlow по cancelKey).
                        // Клеф середины строки не рисуется, но тональность берёт
                        // вертикальные линии знаков из getClef() — задаём контекст
                        // клефа явно (без глифа), иначе знаки баса встанут по
                        // скрипичному.
                        treble.clef = 'treble';
                        bass.clef = 'bass';
                        treble.addKeySignature(keyName, cancel);
                        bass.addKeySignature(keyName, cancel);
                    }
                    // Размер — только на такте смены (вкл. такт 0): рисуется
                    // сразу после тональности, перед первой нотой. На старте
                    // систем не повторяется (в отличие от тональности).
                    if (timeChangedAt(i)) {
                        treble.addTimeSignature(tsStr[i]);
                        bass.addTimeSignature(tsStr[i]);
                    }
                    // Тактовая черта grand staff — ОДНА сплошная через всю
                    // аколаду (верх treble → низ bass), а не две на каждом
                    // стане: per-stave линии гасим (NONE), спан рисуем после.
                    setupGrandBarline(VF, treble, bass);
                    treble.setContext(ctx).draw();
                    bass.setContext(ctx).draw();
                    drawGrandBarline(VF, ctx, treble, bass, bars[i]);
                    if (rowStart) rowTopY[r] = treble.getYForLine(0);

                    const tIdx = (cursor.measure === i && cursor.voice === 'treble')
                        ? cursor.index : -1;
                    const bIdx = (cursor.measure === i && cursor.voice === 'bass')
                        ? cursor.index : -1;
                    const tv = buildVoice(VF, m.treble, 'treble',
                        effTs[i].beats, effTs[i].beatValue, tIdx, i, 'treble');
                    const bv = buildVoice(VF, m.bass, 'bass',
                        effTs[i].beats, effTs[i].beatValue, bIdx, i, 'bass');
                    formatAndDraw(VF, ctx, [tv, bv], [treble, bass], w, rowStart,
                        effTs[i].beats, effTs[i].beatValue);

                    if (rowStart) {
                        new VF.StaveConnector(treble, bass)
                            .setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
                        new VF.StaveConnector(treble, bass)
                            .setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
                    }
                }
            } catch (err) {
                console.error('Render measure ' + i + ' failed:', err);
            }
        }
    }

    // Лиги Tie/Slur — отдельным проходом ПОСЛЕ нот (позиции готовы).
    try { drawTiesAndSlurs(VF, ctx, score, geom); }
    catch (err) { console.error('drawTiesAndSlurs failed:', err); }

    // индекс координат нот по noteId — для note-synced playhead/подсветки
    state.noteHitIndex = {};
    for (let h = 0; h < state.noteHits.length; h++) {
        state.noteHitIndex[state.noteHits[h].id] = state.noteHits[h];
    }

    // Динамические оттенки — отдельным проходом ПОСЛЕ нот (нужны X нот из
    // noteHitIndex и базовые линии станов).
    try { drawScreenDynamics(VF, ctx, score); }
    catch (err) { console.error('drawScreenDynamics failed:', err); }

    // Верхние метки (вольты → темп → навигация) — отдельным проходом ПОСЛЕ
    // станов и нот: движок размещения получает РЕАЛЬНЫЕ якоря (X нот) и ставит
    // каждую метку максимально низко без столкновений. Тот же движок, что и в
    // резервировании выше, но с точными габаритами — размещение не выходит за
    // зарезервированный отступ строки (монотонность skyline).
    if (voltas.length || tempoMarks.length || navMarks.length) {
        const primary = isDrums ? 'perc' : 'treble';
        for (let r = 0; r < rows; r++) {
            if (rowTopY[r] == null) continue;
            const spec = bandSpec(r, rowTopY[r], function (m) {
                return tempoXAtBeat(m.measure, primary, m.beat || 0);
            });
            const band = solveTopBand(spec);
            if (voltas.length) {
                drawVoltasInBand(ctx, voltas, spec.boxOf, rowTopY[r],
                    band.voltaYOf);
            }
            if (spec.tempoMarks.length) {
                drawTempos({
                    VF: VF,
                    marks: spec.tempoMarks,
                    rowOf: function (mi) { return geom[mi] ? geom[mi].row : null; },
                    yOf: function (m, i) { return band.tempoYOf(i); },
                    ctxOf: function () { return ctx; },
                    xOf: function (mi, beat) { return tempoXAtBeat(mi, primary, beat); },
                });
            }
            if (spec.navMarks.length) {
                drawNavigation({
                    VF: VF,
                    marks: spec.navMarks,
                    rowOf: function (mi) { return geom[mi] ? geom[mi].row : null; },
                    yOf: function (m, i) { return band.navYOf(i); },
                    boxOf: spec.boxOf,
                    ctxOf: function () { return ctx; },
                });
            }
        }
    }

    function tempoXAtBeat(mi, voice, beat) {
        const g = geom[mi];
        if (!g) return null;
        const notes = (measures[mi] && measures[mi][voice]) || [];
        const idx = indexAtBeat(noteOnsets(notes), beat);
        if (idx >= 0) {
            const hb = state.noteHitIndex[mi + ':' + voice + ':' + idx];
            if (hb) return hb.x;
        }
        return g.x + 2; // fallback — левый край такта
    }

    // Подсветка выделения при наборе лиги фразировки (slur).
    drawSelectionHighlight(score.selection);

    // геометрия раскладки — нужна плееру и автоскроллу.
    // geom[i] = {row, x, w}: число тактов в строке переменное, поэтому
    // строку/координаты такта берём отсюда, а не из фиксированного perRow.
    // Строки РАЗНОЙ высоты (пофактовый верхний отступ и по-строчный вертикальный
    // профиль) — отдаём готовый массив rowTops (Y верха коробки станов строки).
    // rowH — репрезентативная высота строки (для playhead/центрирования).
    let rowHMax = isDrums ? 130 : 200;
    for (let r = 0; r < rows; r++) {
        const h = staveTopAir + rowSpacing(r).below;
        if (h > rowHMax) rowHMax = h;
    }
    state.lastLayout = { width: width, totalH: totalH, rowH: rowHMax, rows: rows,
                   geom: geom, margin: margin, rowTops: rowStaveTop };

    // если идёт воспроизведение — пересобрать события под новую раскладку
    Playback.onRender();

    // Пересборка SVG сбрасывает прокрутку документа в начало. Чтобы при
    // вводе нот вид не «прыгал» наверх, удерживаем строку с курсором в
    // зоне видимости минимальным доводом скролла. Во время плеера этим
    // занимается Follow Playback — здесь не вмешиваемся.
    if (!Playback.isPlaying()) keepCursorInView(cursor, prevScrollY);

    attachTapListener();

    // Адаптивная вертикальная вёрстка: по РЕАЛЬНЫМ высотам нот (bbox относительно
    // линеек стана — величины НЕ зависят от вертикального сдвига, поэтому
    // сходится за один повторный проход) и наличию оттенков считаем нужные
    // bassDY/rowH. Если отличаются от текущих — обновляем и перерисовываем.
    // Этот же повторный рендер «прогревает» метрики (чинит съезд оттенков на
    // первом кадре). Расхождений нет -> второй рендер не назначается.
    if (!forcedWidth && state.lastPayload &&
        typeof requestAnimationFrame === 'function') {
        const desired = computeDesiredSpacing(score, isDrums);
        const cur = state.dynSpacing;
        const changed = !cur ||
            JSON.stringify(cur.rows) !== JSON.stringify(desired.rows);
        if (changed) {
            state.dynSpacing = desired;
            scheduleRerender();
        }
    }
}

// Двойной rAF: повторный рендер ПОСЛЕ реальной отрисовки кадра (прогрев метрик
// + применение новой вёрстки). Защита от наложения повторных назначений.
let _rerenderPending = false;
function scheduleRerender() {
    if (_rerenderPending) return;
    _rerenderPending = true;
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            _rerenderPending = false;
            try { render(state.lastPayload); } catch (e) { /* no-op */ }
        });
    });
}

// Нужные отступы КАЖДОЙ строки из РЕАЛЬНЫХ высот содержимого (bbox нот и балок
// относительно линеек стана — величины НЕ зависят от вертикального сдвига,
// поэтому проход сходится) + модельных габаритов (туплеты/артикуляции ниже нот
// не входят в bbox) + наличия оттенков/вилок. Зеркало print/vertical
// systemProfile: у каждой строки СВОЙ профиль. Возвращает { rows: [{bassDY,
// below}] }, below — содержимое строки ниже её верхней линейки.
function computeDesiredSpacing(score, isDrums) {
    const geom = (state.lastLayout && state.lastLayout.geom) || [];
    let rows = 0;
    for (let i = 0; i < geom.length; i++) {
        if (geom[i] && geom[i].row + 1 > rows) rows = geom[i].row + 1;
    }
    if (rows === 0) return { rows: [] };
    const rowOf = function (mi) { return geom[mi] ? geom[mi].row : 0; };
    const zeros = function () { return new Array(rows).fill(0); };
    const falses = function () { return new Array(rows).fill(false); };
    const bump = function (arr, r, v) { if (v > arr[r]) arr[r] = v; };

    const trebleBelow = zeros(), bassAbove = zeros(), bassBelow = zeros(),
        percBelow = zeros();
    const seeBelow = function (v, r, val) {
        if (v === 'treble') bump(trebleBelow, r, val);
        else if (v === 'bass') bump(bassBelow, r, val);
        else if (v === 'perc') bump(percBelow, r, val);
    };
    const hits = state.noteHits || [];
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const r = rowOf(h.m);
        const sb = state.staffBottomY[h.m + ':' + h.v];
        const st = state.staffTopY[h.m + ':' + h.v];
        if (sb != null) seeBelow(h.v, r, h.y + h.h - sb);
        if (h.v === 'bass' && st != null) bump(bassAbove, r, st - h.y);
    }
    // Балки не входят в bbox нот — меряем их отдельно.
    const beams = state.beamBottoms || [];
    for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        const r = rowOf(b.m);
        const sb = state.staffBottomY[b.m + ':' + b.v];
        const st = state.staffTopY[b.m + ':' + b.v];
        if (sb != null) seeBelow(b.v, r, b.bottom - sb);
        if (b.v === 'bass' && st != null) bump(bassAbove, r, st - b.top);
    }
    // Модельные габариты (общие с печатью): туплеты/артикуляции/акциденталии.
    const msAll = (score && score.measures) || [];
    const mergeModel = function (voice, clef, belowArr, aboveArr) {
        const ext = measureExtents(msAll, voice, clef);
        for (let mi = 0; mi < ext.length; mi++) {
            const r = rowOf(mi);
            bump(belowArr, r, ext[mi].below);
            if (aboveArr) bump(aboveArr, r, ext[mi].above);
        }
    };
    if (isDrums) {
        mergeModel('perc', 'percussion', percBelow, null);
    } else {
        mergeModel('treble', 'treble', trebleBelow, null);
        mergeModel('bass', 'bass', bassBelow, bassAbove);
    }

    // Наличие оттенков/вилок ПО СТРОКАМ и голосам (вилка резервирует место в
    // каждом такте диапазона) — общий домен-резолвер печати.
    const tDyn = falses(), bDyn = falses(), pDyn = falses();
    const mark = function (voice, arr) {
        const has = dynamicsPresence(msAll, voice);
        for (let mi = 0; mi < has.length; mi++) {
            if (has[mi]) arr[rowOf(mi)] = true;
        }
    };
    if (isDrums) mark('perc', pDyn);
    else { mark('treble', tDyn); mark('bass', bDyn); }

    // Сдвиг базовой линии оттенка от нижней линейки стана — ТЕ ЖЕ константы,
    // что в dynamics_layout (единый источник чисел).
    const dynOffset = function (below, has) {
        return has ? Math.max(DYN_STAFF_GAP, below + DYN_NOTE_CLEAR) : below;
    };

    const out = [];
    for (let r = 0; r < rows; r++) {
        if (isDrums) {
            out.push({
                bassDY: 0,
                below: Math.round(Math.max(70,
                    40 + dynOffset(percBelow[r], pDyn[r]) + 10)),
            });
            continue;
        }
        // bassDY: между нижней линейкой treble и верхней линейкой bass должно
        // помещаться treble-снизу (или оттенок treble + спуск глифа/вилки под
        // базовую линию — DYN_CAP_MARGIN) + bass-сверху + зазор.
        const bassDY = Math.round(Math.max(90,
            40 + dynOffset(trebleBelow[r], tDyn[r]) + bassAbove[r]
            + (tDyn[r] ? DYN_CAP_MARGIN + 4 : 6)));
        out.push({
            bassDY: bassDY,
            below: Math.round(Math.max(160,
                bassDY + 40 + dynOffset(bassBelow[r], bDyn[r]) + 24)),
        });
    }
    return { rows: out };
}

function formatAndDraw(VF, ctx, voices, staves, measureW, rowStart, beats, beatValue) {
    const fmt = new VF.Formatter();
    voices.forEach((v) => fmt.joinVoices([v]));
    // Tuplets создаём ДО форматирования (применяют множитель тиков).
    const tuplets = [];
    voices.forEach((v) => buildTuplets(VF, v).forEach((t) => tuplets.push(t)));
    // Ширину нотной зоны берём из РЕАЛЬНОЙ геометрии стана (после ключа/
    // размера/тональности). Старт нот выравниваем по всем станам системы.
    let startX = 0;
    staves.forEach((s) => { startX = Math.max(startX, s.getNoteStartX()); });
    staves.forEach((s) => s.setNoteStartX(startX));
    const staveEnd = staves[0].getX() + staves[0].getWidth();
    const avail = Math.max(40, staveEnd - startX - 12); // 12 — запас справа

    // Минимально необходимая ширина содержимого. Если она больше доступной
    // (такт физически плотнее ширины экрана — много 16/32/64), форматируем
    // по натуральной ширине и СЖИМАЕМ ноты по горизонтали через <g scale>,
    // чтобы они уместились в барлайн. Линии стана при этом не трогаем.
    const minW = fmt.preCalculateMinTotalWidth(voices);
    const sx = minW > avail ? avail / minW : 1;
    fmt.format(voices, sx < 1 ? minW : avail);

    // Сжатие по X вокруг startX: x' = startX + sx*(x - startX).
    let grp = null;
    if (sx < 1 && ctx.openGroup) {
        ctx.openGroup('sq');
        grp = ctx.parent; // openGroup выставляет parent = новый <g>
    }

    const groups = beamGroups(VF, beats, beatValue);
    voices.forEach((v, idx) => {
        // Базовая линия стана голоса (нижняя линейка) — якорь для оттенков под
        // станом. Берём из первой тиклы (m/v) и геометрии стана (Y не сжимается).
        const tk0 = v.getTickables();
        if (tk0.length && tk0[0].__hit) {
            const h0 = tk0[0].__hit;
            try {
                state.staffBottomY[h0.m + ':' + h0.v] = staves[idx].getYForLine(4);
                state.staffTopY[h0.m + ':' + h0.v] = staves[idx].getYForLine(0);
            } catch (e) { /* нет стана — пропуск */ }
        }
        // Балки создаём ДО отрисовки нот: generateBeams помечает ноты
        // как забимованные, и тогда v.draw не рисует им одиночные флажки.
        const beams = VF.Beam.generateBeams(v.getTickables(), {
            groups: groups,
            beam_rests: false,
            maintain_stem_directions: true,
        });
        v.draw(ctx, staves[idx]);
        beams.forEach((b) => {
            b.setContext(ctx).draw();
            // Габарит балки — в профиль динамики (см. drawScreenDynamics).
            const n0 = b.getNotes && b.getNotes()[0];
            if (n0 && n0.__hit) {
                try {
                    const bb = b.getBoundingBox();
                    if (bb) {
                        state.beamBottoms.push({
                            m: n0.__hit.m, v: n0.__hit.v,
                            top: bb.getY(), bottom: bb.getY() + bb.getH(),
                        });
                    }
                } catch (e) { /* нет bbox — пропуск */ }
            }
        });

        // координаты нот для тап-навигации (с учётом горизонтального сжатия)
        v.getTickables().forEach((t) => {
            if (!t.__hit) return;
            let bb;
            try { bb = t.getBoundingBox(); } catch (e) { return; }
            if (!bb) return;
            const hx = startX + (bb.getX() - startX) * sx;
            const id = t.__hit.m + ':' + t.__hit.v + ':' + t.__hit.i;
            state.noteHits.push({
                id: id,
                m: t.__hit.m, v: t.__hit.v, i: t.__hit.i,
                x: hx, y: bb.getY(), w: bb.getW() * sx, h: bb.getH(),
            });
            // Реестр объектов нот — нужен отрисовке лиг (Tie/Slur) после
            // того, как все строки нарисованы и позиции финализированы.
            // Вместе с трансформом сжатия такта (sx<1): ноты рисуются в
            // <g scale>, и лигу нужно рисовать в ТОМ ЖЕ трансформе, иначе
            // она уезжает по несжатым координатам (за край строки).
            if (t.__hit.i >= 0) {
                state.noteObjs[id] = t;
                state.noteTransform[id] = sx < 1
                    ? { tx: startX * (1 - sx), sx: sx }
                    : { tx: 0, sx: 1 };
            }
        });
    });

    // Числа/скобки tuplet — после нот и балок, в ТОМ ЖЕ контексте сжатия
    // (внутри grp при sx<1), чтобы совпадать со сжатыми нотами. Группа
    // sf-tuplet — инспектируемость/аудит.
    tuplets.forEach((t) => {
        try {
            if (ctx.openGroup) ctx.openGroup('sf-tuplet');
            try { t.setContext(ctx).draw(); }
            finally { if (ctx.openGroup) ctx.closeGroup(); }
        } catch (e) { console.error('tuplet draw failed:', e); }
    });

    if (grp) {
        ctx.closeGroup();
        grp.setAttribute('transform',
            'translate(' + (startX * (1 - sx)) + ',0) scale(' + sx + ',1)');
    }
}
