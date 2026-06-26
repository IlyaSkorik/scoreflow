// [ScoreFlow engine] Geometry Layer — вынесено из index.html без изменений
// логики. Координаты, hit testing и взаимодействие с пользователем поверх
// готовой раскладки (state.lastLayout / state.noteHits). Render-пайплайн
// (render/buildVoice/formatAndDraw/лиги) сюда НЕ входит — он остаётся в
// index.html до Stage 6. Зависимостей от render-слоя нет (цикла нет).
import { state } from '../utils/state.js';
import { el, PAD } from '../utils/dom.js';

let tapAttached = false;

// Восстанавливаем прежнюю прокрутку [prevY] после пересборки SVG. Если
// строка курсора выходит за вьюпорт — минимально доводим её к краю;
// иначе вид остаётся ровно там, где был (без «прыжка» наверх).
export function keepCursorInView(cursor, prevY) {
    if (!state.lastLayout) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const y = prevY || 0;
    let target = y;
    const mi = cursor ? cursor.measure : -1;
    const g = (mi != null && mi >= 0 && state.lastLayout.geom) ? state.lastLayout.geom[mi] : null;
    if (g) {
        const row = g.row;
        const rowTop = PAD + state.lastLayout.margin + row * state.lastLayout.rowH;
        const rowBottom = rowTop + state.lastLayout.rowH;
        if (rowTop < y) target = rowTop - 8;
        else if (rowBottom > y + vh) target = rowBottom - vh + 8;
    }
    const docH = Math.max(
        document.documentElement.scrollHeight, document.body.scrollHeight);
    target = Math.max(0, Math.min(target, Math.max(0, docH - vh)));
    // Всегда восстанавливаем скролл: после пересборки браузер уже мог
    // сбросить его в 0, поэтому даже target == prevY нужно применить.
    window.scrollTo(0, target);
}

// Подсветка выделенного диапазона нот при наборе лиги фразировки.
// [sel] = { voice, m0, i0, m1, i1 } или отсутствует. Заливка иного цвета
// (см. .note-sel) поверх SVG, поверх слоя нот, не перехватывает клики.
export function drawSelectionHighlight(sel) {
    const old = el('sel-highlights');
    if (old) old.remove();
    if (!sel) return;
    const layer = document.createElement('div');
    layer.id = 'sel-highlights';
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.pointerEvents = 'none';
    const lo = sel.m0 * 100000 + sel.i0;
    const hi = sel.m1 * 100000 + sel.i1;
    for (let h = 0; h < state.noteHits.length; h++) {
        const hh = state.noteHits[h];
        if (hh.v !== sel.voice || hh.i < 0) continue;
        const rank = hh.m * 100000 + hh.i;
        if (rank < lo || rank > hi) continue;
        const d = document.createElement('div');
        d.className = 'note-sel';
        d.style.left = (PAD + hh.x - 3) + 'px';
        d.style.top = (PAD + hh.y - 3) + 'px';
        d.style.width = (hh.w + 6) + 'px';
        d.style.height = (hh.h + 6) + 'px';
        layer.appendChild(d);
    }
    el('notation-container').appendChild(layer);
}

// Тап по партитуре -> ближайшая нота -> курсор во Flutter.
export function attachTapListener() {
    if (tapAttached) return;
    tapAttached = true;
    const container = el('notation-container');
    container.addEventListener('click', function (e) {
        const svg = container.querySelector('svg');
        if (!svg || state.noteHits.length === 0) return;
        const rect = svg.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;

        let best = null, bestD = Infinity;
        for (const hh of state.noteHits) {
            const cx = hh.x + hh.w / 2;
            const cy = hh.y + hh.h / 2;
            const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            if (d < bestD) { bestD = d; best = hh; }
        }
        // порог ~90px, чтобы случайные тапы по полю не дёргали курсор
        if (best && bestD <= 90 * 90 && window.flutter_inappwebview) {
            window.flutter_inappwebview.callHandler('onNoteTap', {
                measure: best.m, voice: best.v, index: best.i,
            });
        }
    });
}
