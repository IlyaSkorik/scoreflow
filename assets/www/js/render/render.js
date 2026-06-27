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
    // Линейки стана каждого голоса по такту — для размещения оттенков ПОД
    // станом (нижняя) и потолка под grand staff (верхняя). Ключ "mi:voice".
    state.staffBottomY = {};
    state.staffTopY = {};

    const container = el('notation-container');
    const width = forcedWidth || Math.max(320, container.clientWidth);
    const ts = (score.timeSignature || '4/4').split('/');
    const beats = parseInt(ts[0], 10) || 4;
    const beatValue = parseInt(ts[1], 10) || 4;
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
    // Высота системы и расстояние между станами grand staff АДАПТИВНЫ: берём
    // измеренные величины (см. computeDesiredSpacing в конце render) — раздвигаем
    // станы под низкие ноты/длинные штили и динамику, чтобы не было наложений.
    const sp = state.dynSpacing;
    const rowH = isDrums
        ? (sp && sp.rowHDrums) || 130
        : (sp && sp.rowHGrand) || 200;
    const bassDY = (sp && sp.bassDY) || 90;
    const INNER_PAD = 12; // правый запас (дыхание) в нотной зоне такта
    const voiceList = isDrums ? ['perc'] : ['treble', 'bass'];
    const clefList = isDrums ? ['percussion'] : ['treble', 'bass'];

    const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
    renderer.resize(width, Math.max(1, container.clientHeight || 200));
    const ctx = renderer.getContext();

    // Реальная ширина «головы» стана: левый отступ + ключ [+ тональность]
    // [+ размер], через getNoteStartX временного стана.
    function headStart(addClef, addTime) {
        const s = new VF.Stave(0, 0, 500);
        if (addClef) s.addClef(clefList[0]);
        if (addClef && !isDrums) s.addKeySignature(score.keySignature || 'C');
        if (addTime) s.addTimeSignature(score.timeSignature);
        s.setContext(ctx);
        s.format();
        return s.getNoteStartX();
    }
    const headFirst = headStart(true, true);   // такт 0: ключ+тональн.+размер
    const headRowStart = headStart(true, false); // начало строки: ключ+тональн.
    const headInner = headStart(false, false);   // середина строки: без ключа
    function headOf(rowStart, isFirst) {
        return isFirst ? headFirst : (rowStart ? headRowStart : headInner);
    }

    // проход 1: минимальная ширина содержимого каждого такта
    const cm = [];
    for (let i = 0; i < measures.length; i++) {
        const vs = voiceList.map(function (v, vi) {
            return buildVoice(VF, measures[i][v] || [], clefList[vi],
                beats, beatValue, -1, i, v);
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
            const h = headOf(items.length === 0, i === 0);
            const e = cm[i] + INNER_PAD;
            if (items.length > 0 && sumHead + sumE + h + e > usableW) break;
            items.push(i); sumHead += h; sumE += e; i++;
        }
        layoutRows.push(items);
    }
    const rows = layoutRows.length;
    const totalH = rows * rowH + 2 * margin;
    renderer.resize(width, totalH);

    // геометрия каждого такта {row, x, w} — для playhead/скролла
    const geom = new Array(measures.length);

    // проход 3: распределение ширины по содержимому + отрисовка
    for (let r = 0; r < rows; r++) {
        const items = layoutRows[r];
        const yTop = margin + r * rowH;
        let sumHead = 0, sumE = 0;
        const es = items.map(function (mi, col) {
            const e = cm[mi] + INNER_PAD;
            sumE += e;
            sumHead += headOf(col === 0, mi === 0);
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
            const m = measures[i];
            const rowStart = col === 0;
            const isFirst = i === 0;
            const contentW = es[col] * ratio +
                (sumE > 0 ? extra * (es[col] / sumE) : 0);
            const w = headOf(rowStart, isFirst) + contentW;
            geom[i] = { row: r, x: x, w: w };

            try {
                if (isDrums) {
                    const stave = new VF.Stave(x, yTop + 20, w);
                    if (rowStart) stave.addClef('percussion');
                    if (isFirst) stave.addTimeSignature(score.timeSignature);
                    stave.setContext(ctx).draw();

                    const cIdx = (cursor.measure === i && cursor.voice === 'perc')
                        ? cursor.index : -1;
                    const v = buildVoice(VF, m.perc, 'percussion', beats, beatValue, cIdx, i, 'perc');
                    formatAndDraw(VF, ctx, [v], [stave], w, rowStart, isFirst, beats, beatValue);
                } else {
                    const treble = new VF.Stave(x, yTop, w);
                    const bass = new VF.Stave(x, yTop + bassDY, w);
                    if (rowStart) { treble.addClef('treble'); bass.addClef('bass'); }
                    if (isFirst) {
                        treble.addKeySignature(score.keySignature || 'C');
                        bass.addKeySignature(score.keySignature || 'C');
                        treble.addTimeSignature(score.timeSignature);
                        bass.addTimeSignature(score.timeSignature);
                    }
                    treble.setContext(ctx).draw();
                    bass.setContext(ctx).draw();

                    const tIdx = (cursor.measure === i && cursor.voice === 'treble')
                        ? cursor.index : -1;
                    const bIdx = (cursor.measure === i && cursor.voice === 'bass')
                        ? cursor.index : -1;
                    const tv = buildVoice(VF, m.treble, 'treble', beats, beatValue, tIdx, i, 'treble');
                    const bv = buildVoice(VF, m.bass, 'bass', beats, beatValue, bIdx, i, 'bass');
                    formatAndDraw(VF, ctx, [tv, bv], [treble, bass], w, rowStart, isFirst, beats, beatValue);

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
            x += w;
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

    // Подсветка выделения при наборе лиги фразировки (slur).
    drawSelectionHighlight(score.selection);

    // геометрия раскладки — нужна плееру и автоскроллу.
    // geom[i] = {row, x, w}: число тактов в строке переменное, поэтому
    // строку/координаты такта берём отсюда, а не из фиксированного perRow.
    state.lastLayout = { width: width, totalH: totalH, rowH: rowH, rows: rows,
                   geom: geom, margin: margin };

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
            cur.bassDY !== desired.bassDY ||
            cur.rowHGrand !== desired.rowHGrand ||
            cur.rowHDrums !== desired.rowHDrums;
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

// Нужные отступы системы из РЕАЛЬНЫХ высот нот и наличия оттенков. Меряем,
// насколько содержимое выходит за линейки стана (вниз у верхнего голоса/перка,
// вверх и вниз у баса) — это инвариантно вертикальному сдвигу, поэтому величины
// стабильны и проход сходится. Возвращает { bassDY, rowHGrand, rowHDrums }.
function computeDesiredSpacing(score, isDrums) {
    let trebleBelow = 0, bassAbove = 0, bassBelow = 0, percBelow = 0;
    const hits = state.noteHits || [];
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const sb = state.staffBottomY[h.m + ':' + h.v];
        const st = state.staffTopY[h.m + ':' + h.v];
        const bottom = h.y + h.h, top = h.y;
        if (h.v === 'treble') {
            if (sb != null && bottom - sb > trebleBelow) trebleBelow = bottom - sb;
        } else if (h.v === 'bass') {
            if (st != null && st - top > bassAbove) bassAbove = st - top;
            if (sb != null && bottom - sb > bassBelow) bassBelow = bottom - sb;
        } else if (h.v === 'perc') {
            if (sb != null && bottom - sb > percBelow) percBelow = bottom - sb;
        }
    }
    if (trebleBelow < 0) trebleBelow = 0;
    if (bassAbove < 0) bassAbove = 0;
    if (bassBelow < 0) bassBelow = 0;
    if (percBelow < 0) percBelow = 0;

    // Наличие оттенков по голосам (резервируем место под глиф).
    let tDyn = false, bDyn = false, pDyn = false;
    const ms = (score && score.measures) || [];
    for (let i = 0; i < ms.length; i++) {
        const d = ms[i] && ms[i]._dyn;
        if (!d) continue;
        if (d.treble && d.treble.length) tDyn = true;
        if (d.bass && d.bass.length) bDyn = true;
        if (d.perc && d.perc.length) pDyn = true;
    }
    // Сдвиг базовой линии оттенка от нижней линейки стана (как в dynamics_layout:
    // max(STAFF_GAP, ниже самой низкой ноты + NOTE_CLEAR)).
    const dynOffset = function (below, has) {
        return has ? Math.max(16, below + 11) : below;
    };

    if (isDrums) {
        const rowHDrums = Math.round(Math.max(130,
            60 + dynOffset(percBelow, pDyn) + 50));
        return { bassDY: 90, rowHGrand: 200, rowHDrums: rowHDrums };
    }
    // bassDY: между нижней линейкой treble и верхней линейкой bass должно
    // помещаться treble-снизу (или оттенок treble) + bass-сверху + зазор.
    const bassDY = Math.round(Math.max(90,
        40 + dynOffset(trebleBelow, tDyn) + bassAbove + (tDyn ? 10 : 6)));
    const rowHGrand = Math.round(Math.max(200,
        bassDY + 40 + dynOffset(bassBelow, bDyn) + 24));
    return { bassDY: bassDY, rowHGrand: rowHGrand, rowHDrums: 130 };
}

function formatAndDraw(VF, ctx, voices, staves, measureW, rowStart, isFirst, beats, beatValue) {
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
        beams.forEach((b) => b.setContext(ctx).draw());

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
    // (внутри grp при sx<1), чтобы совпадать со сжатыми нотами.
    tuplets.forEach((t) => {
        try { t.setContext(ctx).draw(); }
        catch (e) { console.error('tuplet draw failed:', e); }
    });

    if (grp) {
        ctx.closeGroup();
        grp.setAttribute('transform',
            'translate(' + (startX * (1 - sx)) + ',0) scale(' + sx + ',1)');
    }
}
