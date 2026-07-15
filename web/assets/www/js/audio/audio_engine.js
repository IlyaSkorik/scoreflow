import { SampledPiano } from './sampled_piano.js';
import { SampledDrums } from './sampled_drums.js';
import { velocityGain } from './velocity.js';

// --- AudioEngine (Web Audio API, полностью оффлайн) ----------------
export const AudioEngine = {
    ctx: null, master: null, noise: null,

    ensure: function () {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        // буфер белого шума для ударных — создаётся один раз
        const len = Math.floor(this.ctx.sampleRate);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        return this.ctx;
    },
    resume: function () {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    noiseSource: function () {
        const s = this.ctx.createBufferSource();
        s.buffer = this.noise;
        return s;
    },

    // Фортепианная нота: реальный сэмпл концертного рояля, если пак
    // загружен; иначе — синтез-fallback (прежнее поведение), чтобы
    // воспроизведение работало даже без ассетов.
    playPiano: function (midi, when, durSec, velocity) {
        if (SampledPiano.noteOn(midi, when, durSec, velocity)) return;
        this.playPitch(440 * Math.pow(2, (midi - 69) / 12), when, durSec, velocity);
    },

    // Тон с ADSR-огибающей. ТОЧКА РАСШИРЕНИЯ ПОД SOUNDFONT: здесь
    // playPitch заменяется на воспроизведение AudioBuffer-сэмпла из
    // assets без правок планировщика и визуала.
    playPitch: function (freq, when, durSec, velocity) {
        const ctx = this.ctx; if (!ctx) return;
        const dur = Math.max(0.08, durSec);
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(8000, freq * 6 + 800);
        const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freq;
        const o2 = ctx.createOscillator(); o2.type = 'sine';     o2.frequency.value = freq * 2;
        const g2 = ctx.createGain(); g2.gain.value = 0.35; // обертон
        o1.connect(g); o2.connect(g2); g2.connect(g);
        g.connect(lp); lp.connect(this.master);
        // Пик ADSR — по общей velocity-кривой (peak ff = 0.34; fff чуть выше).
        const peak = velocityGain(velocity, 0.34);
        const end = when + dur;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(peak, when + 0.008);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak * 0.3), when + dur * 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o1.start(when); o2.start(when);
        o1.stop(end + 0.03); o2.stop(end + 0.03);
    },

    // Удар: реальный сэмпл, если набор загружен; иначе синтез-fallback.
    playDrum: function (type, when, velocity) {
        if (SampledDrums.noteOn(type, when, velocity)) return;
        this._synthDrum(type, when, velocity);
    },

    // Синтез-fallback ударных (без сэмплов). Покрывает все 12 партий;
    // velocity масштабирует громкость.
    _synthDrum: function (type, when, velocity) {
        const ctx = this.ctx; if (!ctx) return;
        // Множитель громкости по общей velocity-кривой (как у сэмплов): все
        // частные gain'ы партий масштабируются им, поэтому pp/mf/ff/fff звучат
        // явно по-разному и в синтез-fallback.
        const vel = velocityGain(velocity, 1.0);
        if (type === 'kick') {
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(160, when);
            o.frequency.exponentialRampToValueAtTime(50, when + 0.12);
            g.gain.setValueAtTime(0.9 * vel, when);
            g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
            o.connect(g); g.connect(this.master);
            o.start(when); o.stop(when + 0.2);
            return;
        }
        if (type === 'snare' || type === 'tom_high' || type === 'tom_mid' || type === 'tom_floor') {
            const tone = { snare: 0, tom_high: 320, tom_mid: 240, tom_floor: 160 }[type];
            const s = this.noiseSource(); const ng = ctx.createGain();
            const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
            bp.frequency.value = type === 'snare' ? 1800 : 400;
            s.connect(bp); bp.connect(ng); ng.connect(this.master);
            const decay = type === 'snare' ? 0.18 : 0.12;
            ng.gain.setValueAtTime((type === 'snare' ? 0.7 : 0.4) * vel, when);
            ng.gain.exponentialRampToValueAtTime(0.0001, when + decay);
            s.start(when); s.stop(when + 0.25);
            if (tone) {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(tone, when);
                o.frequency.exponentialRampToValueAtTime(tone * 0.6, when + 0.18);
                g.gain.setValueAtTime(0.6 * vel, when);
                g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
                o.connect(g); g.connect(this.master);
                o.start(when); o.stop(when + 0.24);
            }
            return;
        }
        // тарелки / хай-хэт: фильтрованный шум с разным затуханием
        const DEC = {
            hihat_closed: 0.05, hihat_pedal: 0.09, hihat_open: 0.45,
            ride: 0.5, ride_bell: 0.4, crash1: 0.9, crash2: 1.1,
        };
        const decay = DEC[type] != null ? DEC[type] : 0.5;
        const isHat = type.indexOf('hihat') === 0;
        const s = this.noiseSource(); const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = isHat ? 7000 : 5000;
        const g = ctx.createGain();
        s.connect(hp); hp.connect(g); g.connect(this.master);
        g.gain.setValueAtTime((isHat ? 0.5 : 0.4) * vel, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        s.start(when); s.stop(when + decay + 0.05);
        if (type === 'ride_bell') { // тональный «пинг» колокола
            const o = ctx.createOscillator(); const og = ctx.createGain();
            o.type = 'square'; o.frequency.value = 880;
            og.gain.setValueAtTime(0.18 * vel, when);
            og.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
            o.connect(og); og.connect(this.master);
            o.start(when); o.stop(when + 0.42);
        }
    },

    click: function (when, accent) {
        const ctx = this.ctx; if (!ctx) return;
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = accent ? 2000 : 1400;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
        o.connect(g); g.connect(this.master);
        o.start(when); o.stop(when + 0.05);
    },
};
