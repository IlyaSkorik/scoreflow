// --- Сэмплерный концертный рояль (реальные записи, оффлайн) --------
// Multi-sample player на AudioBufferSourceNode. Атака молоточка, decay
// и sustain заложены в самих сэмплах; между опорными нотами — питч-шифт
// через playbackRate (≤1 полутона при сэмплировании по малым терциям).
// Поддерживает velocity-слои, демпфер-педаль (sustain) и release-хвост.
// Сэмплы (Salamander Grand Piano, CC-BY) кладёт tools/fetch_salamander.mjs;
// URL через ScoreFlowAssetConfig (Flutter resolveAsset), оффлайн.
import { velocityGain } from './velocity.js';
import { resolveAsset } from '../utils/assets.js';

export const SampledPiano = {
    ctx: null, master: null,
    ready: false, loading: false,
    zones: [], release: 0.4, sustain: false,
    voices: [], maxVoices: 64, gc: null,

    // Загрузка манифеста + декодирование сэмплов в AudioBuffer.
    load: function (ctx, master) {
        if (!ctx) return Promise.resolve(false);
        // AudioBuffers are bound to a context — reset if the host switched
        // (parent unlock on Safari iOS / Flutter Web).
        if (this.ctx && this.ctx !== ctx) {
            this.ready = false;
            this.loading = false;
            this.zones = [];
            this.voices = [];
        }
        if (this.ready || this.loading) return Promise.resolve(this.ready);
        this.ctx = ctx; this.master = master; this.loading = true;
        const self = this;
        return fetch(resolveAsset('piano/manifest.json'), { cache: 'force-cache' })
            .then(function (r) { if (!r.ok) throw new Error('нет manifest.json'); return r.json(); })
            .then(function (man) {
                self.release = man.release != null ? man.release : 0.4;
                const base = resolveAsset(man.basePath || 'piano/');
                const zones = man.zones || [];
                return Promise.all(zones.map(function (z) {
                    return fetch(base + z.file)
                        .then(function (r) { if (!r.ok) throw new Error(z.file); return r.arrayBuffer(); })
                        .then(function (ab) { return ctx.decodeAudioData(ab); })
                        .then(function (buf) {
                            return {
                                rootMidi: z.rootMidi,
                                loMidi: z.loMidi != null ? z.loMidi : 0,
                                hiMidi: z.hiMidi != null ? z.hiMidi : 127,
                                loVel: z.loVel != null ? z.loVel : 0,
                                hiVel: z.hiVel != null ? z.hiVel : 127,
                                buffer: buf,
                            };
                        });
                }));
            })
            .then(function (loaded) {
                self.zones = loaded;
                self.ready = loaded.length > 0;
                self.loading = false;
                console.log('SampledPiano: загружено зон ' + loaded.length);
                return self.ready;
            })
            .catch(function (e) {
                self.loading = false; self.ready = false;
                console.log('SampledPiano недоступен, синтез-fallback: ' + e.message);
                return false;
            });
    },

    isReady: function () { return this.ready; },

    // Демпфер-педаль: при отпускании глушит ноты, державшиеся педалью.
    setSustain: function (on) {
        this.sustain = !!on;
        if (!this.sustain && this.ctx) {
            const now = this.ctx.currentTime;
            for (let i = 0; i < this.voices.length; i++) {
                const v = this.voices[i];
                if (v.held && !v.releasing) this._release(v, now);
            }
        }
    },

    // Выбор зоны: подходящий velocity-слой, затем ближайший корень.
    _pick: function (midi, vel) {
        let best = null, bestD = 1e9;
        for (let i = 0; i < this.zones.length; i++) {
            const z = this.zones[i];
            if (vel < z.loVel || vel > z.hiVel) continue;
            if (midi < z.loMidi || midi > z.hiMidi) continue;
            const d = Math.abs(midi - z.rootMidi);
            if (d < bestD) { bestD = d; best = z; }
        }
        if (best) return best;
        for (let i = 0; i < this.zones.length; i++) {
            const d = Math.abs(midi - this.zones[i].rootMidi);
            if (d < bestD) { bestD = d; best = this.zones[i]; }
        }
        return best;
    },

    // Сэмпл-точный note-on. Возвращает false, если пак не готов —
    // тогда вызывающий уходит в синтез-fallback.
    noteOn: function (midi, when, durSec, velocity) {
        const ctx = this.ctx; if (!ctx || !this.ready) return false;
        // Выбор velocity-СЛОЯ сэмпла — по целочисленной velocity 1..127.
        const vel = Math.max(1, Math.min(127,
            Math.round((velocity == null ? 0.78 : velocity) * 127)));
        const z = this._pick(midi, vel); if (!z) return false;
        if (this.voices.length >= this.maxVoices) {
            this._release(this.voices[0], ctx.currentTime); // кража голоса
        }
        const src = ctx.createBufferSource();
        src.buffer = z.buffer;
        src.playbackRate.value = Math.pow(2, (midi - z.rootMidi) / 12);
        const g = ctx.createGain();
        // Громкость — из СЫРОЙ float-velocity по общей кривой (ff != fff!),
        // потолок 0.95 во избежание клиппинга при полифонии.
        g.gain.value = Math.min(0.95, velocityGain(velocity, 0.85));
        src.connect(g); g.connect(this.master);
        src.start(when);
        const voice = {
            src: src, g: g, midi: midi,
            releaseAt: when + Math.max(0.05, durSec),
            held: false, releasing: false, dead: false,
        };
        src.onended = function () { voice.dead = true; };
        this.voices.push(voice);
        this._ensureGc();
        return true;
    },

    // Спад после «отпускания клавиши» (или педали) + остановка источника.
    _release: function (voice, t) {
        if (voice.releasing) return;
        voice.releasing = true;
        const g = voice.g.gain;
        try {
            g.cancelScheduledValues(t);
            g.setValueAtTime(Math.max(0.0001, g.value), t);
            g.setTargetAtTime(0.0001, t, this.release / 3);
        } catch (e) { /* no-op */ }
        try { voice.src.stop(t + this.release + 0.3); } catch (e) { /* no-op */ }
    },

    // Housekeeping-таймер: НЕ музыкальный планировщик. Снимает ноты по
    // истечении длительности (с учётом педали) и чистит отыгравшие
    // голоса. Тайминг note-on остаётся сэмпл-точным.
    _ensureGc: function () {
        if (this.gc) return;
        const self = this;
        this.gc = setInterval(function () {
            const ctx = self.ctx; if (!ctx) return;
            const now = ctx.currentTime;
            for (let i = self.voices.length - 1; i >= 0; i--) {
                const v = self.voices[i];
                if (v.dead) { self.voices.splice(i, 1); continue; }
                if (!v.releasing && now >= v.releaseAt) {
                    if (self.sustain) v.held = true;     // педаль держит ноту
                    else self._release(v, now);
                }
            }
            if (self.voices.length === 0) { clearInterval(self.gc); self.gc = null; }
        }, 30);
    },

    // Немедленно оборвать всё (стоп/пауза плеера).
    stopAll: function () {
        const now = this.ctx ? this.ctx.currentTime : 0;
        for (let i = 0; i < this.voices.length; i++) {
            try { this.voices[i].src.stop(now); } catch (e) { /* no-op */ }
        }
        this.voices = [];
        if (this.gc) { clearInterval(this.gc); this.gc = null; }
    },
};
