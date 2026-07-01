// [ScoreFlow engine] Playback Scheduler — вынесено из index.html без изменений
// логики. Исполнение playback: упреждающее планирование по
// AudioContext.currentTime, note-synced playhead, подсветка нот, метроном,
// follow playback. Алгоритм планировщика, тайминг, look-ahead, очередь
// событий, метроном и поведение playhead НЕ меняются.
//
//  setInterval используется ТОЛЬКО как «насос» упреждения; тайминг
//  звука и визуала привязан к AudioContext.currentTime (паттерн
//  «двух часов»). setTimeout как механизм синхронизации не применяется.
import { state } from '../utils/state.js';
import { el, PAD, showError } from '../utils/dom.js';
import { AudioEngine } from '../audio/audio_engine.js';
import { SampledPiano } from '../audio/sampled_piano.js';
import { SampledDrums } from '../audio/sampled_drums.js';
import { drumType } from '../domain/drums.js';
import { compilePlayback } from './compiler.js';
import { measureIndexAtBeat } from '../domain/timesig.js';

function ensureHighlightLayer() {
    let layer = el('note-highlights');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'note-highlights';
        el('notation-container').appendChild(layer);
    }
    return layer;
}

// --- Транспорт: scheduler + note-synced playhead + подсветка -------
export const Playback = {
    playing: false,
    comp: null,
    metronome: false,
    baseTempo: 120,      // базовый темп (bpm) до первой смены `_tempo`
    startTime: 0,        // ctx.currentTime в момент beat 0
    lookahead: null,     // setInterval-«насос» упреждения
    raf: null,
    nextEvent: 0,        // указатель в comp.events
    nextClick: 0,        // указатель в comp.clicks (готовая сетка метронома)
    xmap: [],            // beat->X по строкам (playhead по муз. времени)
    followPlayback: true,// Vertical Follow: скролл к новой системе
    _followRow: -1,      // строка, к которой последний раз скроллили
    _hl: {},             // активные элементы подсветки по noteId

    isPlaying: function () { return this.playing; },
    setMetronome: function (on) { this.metronome = !!on; },
    setFollowPlayback: function (on) { this.followPlayback = !!on; },

    // Музыкальное время (доли) из абсолютного через tempo map компилятора —
    // ЕДИНЫЙ конвертер (обратное преобразование сек->доли). Планировщик темп не
    // считает, только читает готовое отображение.
    currentBeat: function () {
        const ctx = AudioEngine.ctx;
        if (!ctx || !this.comp) return 0;
        return this.comp.tempoMap.beatAt(ctx.currentTime - this.startTime);
    },
    secForBeat: function (q) {
        return this.startTime + (this.comp ? this.comp.tempoMap.secAt(q) : q * 0.5);
    },

    // Карта «музыкальное время -> X» для КАЖДОЙ строки Grand Staff.
    // Якоря берём из onset'ов ОБОИХ голосов (и пауз — у них тоже есть
    // bbox), поэтому при длинной ноте в одной руке движение второй даёт
    // промежуточные точки и playhead не «застывает». Одновременные
    // onset'ы (аккорд / treble+bass на одной доле) усредняются в один X.
    // Замыкающий якорь ставим у правого барлайна строки.
    _buildXMap: function () {
        const lay = state.lastLayout;
        const rows = lay ? lay.rows : 1;
        const geom = (lay && lay.geom) || [];
        // Сетка тактов компилятора: starts[mi] — абсолютный старт такта
        // (четверти), разный при сменах размера. Индекс такта по доле берём из
        // domain/timesig (тот же поиск, что в compiler/reflow).
        const starts = this.comp.starts || [0];
        const order = this.comp.measureOrder || [];

        const byRow = [];
        for (let r = 0; r < rows; r++) byRow.push({});

        const ev = this.comp.events;
        for (let i = 0; i < ev.length; i++) {
            const e = ev[i];
            const hb = state.noteHitIndex[e.noteId];
            if (!hb) continue;
            const mIdx = measureIndexAtBeat(starts, e.startBeat);
            const sourceIdx = order[mIdx] != null ? order[mIdx] : mIdx;
            const g = geom[sourceIdx];
            if (!g) continue;
            const slot = byRow[g.row];
            const key = e.startBeat.toFixed(4);
            if (!slot[key]) slot[key] = { beat: e.startBeat, sum: 0, n: 0 };
            slot[key].sum += hb.x + hb.w / 2;
            slot[key].n++;
        }

        // правый край и последний такт каждой строки (для замыкающего
        // якоря — куда доезжает линия на долгих нотах в конце системы)
        const rowRight = [], rowLastBeat = [];
        for (let r = 0; r < rows; r++) { rowRight.push(0); rowLastBeat.push(0); }
        const totalMeasures = Math.max(0, starts.length - 1);
        for (let mi = 0; mi < totalMeasures; mi++) {
            const sourceIdx = order[mi] != null ? order[mi] : mi;
            const g = geom[sourceIdx];
            if (!g) continue;
            const right = g.x + g.w;
            if (right > rowRight[g.row]) rowRight[g.row] = right;
            // Конец такта = старт следующего (starts имеет финальный элемент).
            const endBeat = starts[mi + 1] != null ? starts[mi + 1] : starts[mi];
            if (endBeat > rowLastBeat[g.row]) rowLastBeat[g.row] = endBeat;
        }

        const xmap = [];
        for (let r = 0; r < rows; r++) {
            const arr = [];
            const slot = byRow[r];
            for (const key in slot)
                arr.push({ beat: slot[key].beat, x: slot[key].sum / slot[key].n });
            arr.sort(function (a, b) { return a.beat - b.beat; });
            if (rowLastBeat[r] > 0 &&
                (arr.length === 0 || arr[arr.length - 1].beat < rowLastBeat[r] - 1e-6))
                arr.push({ beat: rowLastBeat[r], x: rowRight[r] - 6 });
            xmap.push(arr);
        }
        this.xmap = xmap;
    },

    // вызывается из render(): пересобрать события под правки в редакторе
    onRender: function () {
        if (!this.playing || !state.lastPayload) return;
        const curBeat = this.currentBeat();
        this.comp = compilePlayback(state.lastPayload, this.baseTempo);
        this._buildXMap();
        this.nextEvent = 0;
        while (this.nextEvent < this.comp.events.length &&
               this.comp.events[this.nextEvent].startBeat < curBeat) this.nextEvent++;
    },

    start: function (payload, tempo) {
        if (!payload) return;
        const ctx = AudioEngine.ensure();
        if (!ctx) { showError('Web Audio недоступен в этом WebView.'); return; }
        AudioEngine.resume();
        this.stop(true); // сброс прежней сессии без снятия активности UI
        // Базовый темп (bpm) — из слайдера транспорта; смены `_tempo` в партитуре
        // компилятор накладывает поверх. Абсолютное время события считает tempo map
        // компилятора (единожды) — планировщик его лишь читает.
        this.baseTempo = Number(tempo) || payload.tempo || 120;
        this.comp = compilePlayback(payload, this.baseTempo);
        this._buildXMap();
        if (this.comp.events.length === 0) return;
        this.playing = true;
        this.nextEvent = 0;
        this.nextClick = 0;
        this._followRow = -1; // первая смена системы вызовет скролл
        this.startTime = ctx.currentTime + 0.08; // запас на планирование
        el('playhead').classList.add('active');
        const self = this;
        this.lookahead = setInterval(function () { self._schedule(); }, 25);
        this._schedule();
        this.raf = requestAnimationFrame(function () { self._frame(); });
    },

    _schedule: function () {
        const ctx = AudioEngine.ctx; if (!ctx || !this.playing) return;
        const horizon = ctx.currentTime + 0.12;
        const ev = this.comp.events;

        while (this.nextEvent < ev.length &&
               this.startTime + ev[this.nextEvent].startSec < horizon) {
            const e = ev[this.nextEvent];
            // Абсолютное время события уже посчитано компилятором (startSec/durSec
            // из tempo map) — планировщик его не вычисляет.
            const when = Math.max(ctx.currentTime, this.startTime + e.startSec);
            if (!e.rest && e.keys.length) {
                if (this.comp.isDrums) {
                    for (let k = 0; k < e.keys.length; k++)
                        AudioEngine.playDrum(drumType(e.keys[k]), when, e.velocity);
                } else {
                    const durS = e.durSec;
                    // Высота уже разрешена компилятором (тональность + знак +
                    // правила такта) — играем готовые MIDI-номера головок.
                    const midis = e.midis || [];
                    for (let k = 0; k < midis.length; k++)
                        AudioEngine.playPiano(midis[k], when, durS, e.velocity);
                }
            }
            this.nextEvent++;
        }

        // метроном: ГОТОВАЯ сетка щелчков (comp.clicks) — доли каждого такта с
        // акцентом на доле 0, посчитанные в domain/timesig по ДЕЙСТВУЮЩЕМУ
        // размеру КАЖДОГО такта (смены метра/составные размеры корректны без
        // логики здесь). Указатель двигаем всегда — звучит при включённом.
        const clicks = this.comp.clicks || [];
        while (this.nextClick < clicks.length &&
               this.startTime + clicks[this.nextClick].sec < horizon) {
            if (this.metronome) {
                const when = this.startTime + clicks[this.nextClick].sec;
                if (when >= ctx.currentTime) {
                    AudioEngine.click(when, clicks[this.nextClick].accent);
                }
            }
            this.nextClick++;
        }

        if (this.nextEvent >= ev.length &&
            ctx.currentTime > this.startTime + this.comp.totalSec + 0.05) {
            this.stop();
            if (window.flutter_inappwebview)
                window.flutter_inappwebview.callHandler('onPlaybackEnded');
        }
    },

    _frame: function () {
        if (!this.playing) return;
        const curBeat = this.currentBeat();
        this._positionPlayhead(curBeat);
        this._highlight(curBeat);
        this._followScroll(this._rowForBeat(curBeat));
        const self = this;
        this.raf = requestAnimationFrame(function () { self._frame(); });
    },

    // Строка (система) для текущей доли — из такта, а не из id ноты.
    _rowForBeat: function (curBeat) {
        const starts = this.comp.starts || [0];
        const order = this.comp.measureOrder || [];
        const total = this.comp.totalBeats;
        const geom = (state.lastLayout && state.lastLayout.geom) || [];
        const totalMeasures = Math.max(1, starts.length - 1);
        let mIdx = measureIndexAtBeat(starts, Math.max(0, Math.min(curBeat, total)));
        if (mIdx >= totalMeasures) mIdx = totalMeasures - 1;
        if (mIdx < 0) mIdx = 0;
        const sourceIdx = order[mIdx] != null ? order[mIdx] : mIdx;
        return geom[sourceIdx] ? geom[sourceIdx].row : 0;
    },

    // Vertical Follow Playback: пока playhead внутри текущей системы —
    // ничего не делаем; при переходе на новую систему — ОДИН плавный
    // вертикальный скролл, ставящий систему примерно по центру экрана.
    // Скроллим собственный документ WebView (контейнер прокрутки).
    _followScroll: function (row) {
        if (!this.followPlayback) return;
        if (row === this._followRow) return;
        this._followRow = row;
        const lay = state.lastLayout;
        if (!lay) return;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const rowTop = PAD + lay.margin + row * lay.rowH;
        const target = rowTop - (vh - lay.rowH) / 2; // система по центру
        const docH = Math.max(
            document.documentElement.scrollHeight, document.body.scrollHeight);
        const maxY = Math.max(0, docH - vh);
        const y = Math.max(0, Math.min(target, maxY));
        try {
            window.scrollTo({ top: y, behavior: 'smooth' });
        } catch (e) {
            window.scrollTo(0, y); // старые WebView без smooth-опции
        }
    },

    // Позиция playhead = музыкальное время (curBeat), а НЕ последняя
    // сыгранная нота. Строку определяем по такту текущей доли, X —
    // интерполяцией между beat-якорями строки (онсеты обоих голосов).
    _positionPlayhead: function (curBeat) {
        const ph = el('playhead');
        if (!this.xmap || !this.xmap.length) return;
        const total = this.comp.totalBeats;
        const b = Math.max(0, Math.min(curBeat, total));
        const row = this._rowForBeat(curBeat);
        const anchors = this.xmap[row];
        if (!anchors || anchors.length === 0) return;

        let x;
        if (b <= anchors[0].beat) {
            x = anchors[0].x;
        } else if (b >= anchors[anchors.length - 1].beat) {
            x = anchors[anchors.length - 1].x;
        } else {
            let k = 0;
            while (k + 1 < anchors.length && anchors[k + 1].beat <= b) k++;
            const a = anchors[k], c = anchors[k + 1];
            const span = c.beat - a.beat;
            const frac = span > 0 ? (b - a.beat) / span : 0;
            x = a.x + frac * (c.x - a.x);
        }

        const rowH = state.lastLayout ? state.lastLayout.rowH : 200;
        const margin = state.lastLayout ? state.lastLayout.margin : 8;
        ph.style.left = (PAD + x) + 'px';
        ph.style.top = (PAD + margin + row * rowH) + 'px';
        ph.style.height = (rowH - 8) + 'px';
    },

    _highlight: function (curBeat) {
        const layer = ensureHighlightLayer();
        const active = {};
        const ev = this.comp.events;
        for (let i = 0; i < ev.length; i++) {
            const e = ev[i];
            if (e.startBeat > curBeat) break; // отсортировано по началу
            if (e.rest || !e.keys.length) continue;
            if (curBeat < e.startBeat + e.durationBeats) {
                active[e.noteId] = true;
                // Tie: подсвечиваем все ноты цепочки, пока звучит событие.
                if (e.coveredNoteIds) {
                    for (let c = 0; c < e.coveredNoteIds.length; c++)
                        active[e.coveredNoteIds[c]] = true;
                }
            }
        }
        for (const id in this._hl) {
            if (!active[id]) {
                if (this._hl[id].parentNode) layer.removeChild(this._hl[id]);
                delete this._hl[id];
            }
        }
        for (const id in active) {
            if (this._hl[id]) continue;
            const hb = state.noteHitIndex[id];
            if (!hb) continue;
            const d = document.createElement('div');
            d.className = 'note-hl';
            d.style.left = (PAD + hb.x - 3) + 'px';
            d.style.top = (PAD + hb.y - 3) + 'px';
            d.style.width = (hb.w + 6) + 'px';
            d.style.height = (hb.h + 6) + 'px';
            layer.appendChild(d);
            this._hl[id] = d;
        }
    },

    stop: function (keepActive) {
        if (this.lookahead) { clearInterval(this.lookahead); this.lookahead = null; }
        if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
        if (!keepActive) {
            this.playing = false;
            el('playhead').classList.remove('active');
            const layer = el('note-highlights');
            if (layer) layer.innerHTML = '';
            this._hl = {};
            try { SampledPiano.stopAll(); } catch (e) { /* no-op */ }
            try { SampledDrums.stopAll(); } catch (e) { /* no-op */ }
        }
    },
};
