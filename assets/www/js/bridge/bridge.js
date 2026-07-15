// =====================================================================
//  ScoreFlow notation engine — Flutter ↔ JS bridge & bootstrap
// =====================================================================
//  Точка входа движка: связывает Flutter с модульным WebView Engine и
//  публикует публичный API (window.ScoreFlow / window.handlePlaybackCommand).
//  Музыкальной логики здесь нет — только маршалинг вызовов в слои движка.
//  Вынесено из index.html без изменений контрактов (payload/base64/callHandler/
//  render/playback/print). VF берётся из глобального Vex.Flow.
import { AudioEngine } from '../audio/audio_engine.js';
import { SampledPiano } from '../audio/sampled_piano.js';
import { SampledDrums } from '../audio/sampled_drums.js';
import { state } from '../utils/state.js';
import { el, showError } from '../utils/dom.js';
import { Playback } from '../playback/scheduler.js';
import { render } from '../render/render.js';
import { buildVoice, measureMinWidth } from '../render/layout.js';
import { renderPrintPages } from '../render/print.js';
import { exportPrintPages } from '../utils/export_print.js';

// =================================================================
//  Публичный мост (вызывается из Flutter)
// =================================================================

// Принимает base64(UTF-8 JSON) — безопасно для evaluateJavascript.
window.ScoreFlow = {
    renderB64: function (b64) {
        try {
            const json = decodeURIComponent(escape(window.atob(b64)));
            state.lastPayload = JSON.parse(json);
            render(state.lastPayload);
            // Сообщаем Flutter, что партитура отрисована: редактор снимает
            // оверлей загрузки после ПЕРВОГО реального кадра, а не по load.
            if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
                window.flutter_inappwebview.callHandler('onRendered');
            }
        } catch (e) {
            showError('Ошибка разбора партитуры: ' + e.message);
        }
    },

    // Верстает партитуру по страницам A4 в #print-root (вектор) и
    // возвращает их число. Печать инициирует Flutter через
    // printCurrentPage() — @media print покажет именно эти страницы.
    renderPrintB64: function (b64) {
        try {
            const json = decodeURIComponent(escape(window.atob(b64)));
            const score = JSON.parse(json);
            return renderPrintPages(score);
        } catch (e) {
            showError('Ошибка вёрстки печати: ' + e.message);
            return 0;
        }
    },

    /**
     * Export already-rendered print pages.
     * Desktop/Android: window.print().
     * iOS Safari: navigator.share() or Blob URL tab.
     */
    exportPrint: async function (title) {
        return exportPrintPages(title || (state.lastPayload && state.lastPayload.title) || 'ScoreFlow');
    },

    /** Unlock Web Audio (call from a user gesture when possible). */
    unlockAudio: async function () {
        return AudioEngine.resume();
    },

    // Метроном: вкл/выкл. Состояние сохраняется между запусками плеера.
    setMetronome: function (on) {
        try { Playback.setMetronome(on); } catch (e) { /* no-op */ }
    },

    // Vertical Follow Playback: вкл/выкл автоскролл к текущей системе.
    // По умолчанию включён. Состояние сохраняется между запусками.
    setFollowPlayback: function (on) {
        try { Playback.setFollowPlayback(on); } catch (e) { /* no-op */ }
    },

    // Предзагрузка сэмплов концертного рояля (локальный сервер, оффлайн).
    // Идемпотентно: повторные вызовы безопасны. Без сэмплов плеер
    // продолжит работать на синтез-fallback.
    loadPiano: function () {
        const ctx = AudioEngine.ensure();
        if (ctx) SampledPiano.load(ctx, AudioEngine.master);
    },

    // Демпфер-педаль (sustain): держит звучащие ноты до отпускания.
    setSustain: function (on) {
        try { SampledPiano.setSustain(on); } catch (e) { /* no-op */ }
    },

    // Предзагрузка сэмплов ударной установки (локальный сервер, оффлайн).
    // Идемпотентно. Без сэмплов плеер играет синтез-fallback.
    loadDrums: function () {
        const ctx = AudioEngine.ensure();
        if (ctx) SampledDrums.load(ctx, AudioEngine.master);
    },

    // Диагностика layout: для такта 4/4, забитого N равными нотами,
    // выводит minWidth (VexFlow) и assignedWidth (наш layout-движок).
    // Возвращает массив и пишет таблицу в консоль WebView.
    debugMeasureWidths: function () {
        const VF = Vex.Flow;
        const cont = el('notation-container');
        const usableW = Math.max(320, cont.clientWidth) - 16; // 2*margin
        const cases = [['16-е', '16', 16], ['32-е', '32', 32], ['64-е', '64', 64]];
        const head = 24 + 36 + 46; // ключ + размер + тональность (первый такт)
        const avail = Math.max(40, usableW - head); // доступная зона нот
        const rows = cases.map(function (c) {
            const notes = [];
            for (let i = 0; i < c[2]; i++)
                notes.push({ keys: ['c/5'], duration: c[1], dots: 0 });
            const v = buildVoice(VF, notes, 'treble', 4, 4, -1, 0, 'treble');
            const minW = measureMinWidth(VF, [v]);
            const sx = minW > avail ? avail / minW : 1; // как в formatAndDraw
            return {
                case: c[0], count: c[2],
                minWidth: Math.round(minW),
                availWidth: Math.round(avail),
                scaleX: Math.round(sx * 100) / 100,
                // ноты всегда умещаются: при minW>avail сжимаются по X
                fits: true,
            };
        });
        console.table(rows);
        rows.forEach(function (r) {
            console.log('[layout] ' + r.case + ' (' + r.count + '): minWidth=' +
                r.minWidth + 'px availWidth=' + r.availWidth +
                'px scaleX=' + r.scaleX + ' fits=' + r.fits);
        });
        return rows;
    },
};

// Контракт плеера сохранён: 'PLAY' (с tempo) запускает воспроизведение
// текущей партитуры с начала, 'PAUSE' останавливает.
// На Safari iOS PLAY ждёт unlock AudioContext перед планированием.
window.handlePlaybackCommand = function (action, value) {
    if (action === 'PLAY') {
        return Playback.start(state.lastPayload, value);
    } else if (action === 'PAUSE') {
        Playback.stop();
        return Promise.resolve();
    }
    return Promise.resolve();
};

// Unlock audio on the first gesture inside the engine document.
AudioEngine.installGestureUnlock();

// Мост Flutter готов.
window.addEventListener('flutterInAppWebViewPlatformReady', function () {
    console.log('Flutter WebView Bridge Connected.');
});

// Перерисовка под новую ширину (поворот экрана / смена вида).
let resizeTimer = null;
window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        if (state.lastPayload) render(state.lastPayload);
    }, 180);
});
