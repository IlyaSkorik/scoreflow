// --- Сэмплерная ударная установка (реальные записи, оффлайн) -------
// Sample-based engine на AudioBufferSourceNode: у каждого инструмента
// velocity-слои (pp/mf/ff и больше). Полифония БЕЗ обрезания хвостов —
// тарелки звучат до естественного затухания. Choke-группы гасят
// открытый хай-хэт при закрытом/педальном ударе. Тембр — в самих
// сэмплах (никакого синтеза) → нет эффекта «драм-машины».
// Сэмплы кладёт tools/fetch_drums.mjs; URL через ScoreFlowAssetConfig.
import { velocityGain } from './velocity.js';
import { resolveAsset } from '../utils/assets.js';

export const SampledDrums = {
    ctx: null, master: null,
    ready: false, loading: false,
    kit: {},            // type -> { group, layers:[{loVel,hiVel,buffer}] }
    voices: [], maxVoices: 64, gc: null,

    load: function (ctx, master) {
        if (this.ready || this.loading) return Promise.resolve(this.ready);
        this.ctx = ctx; this.master = master; this.loading = true;
        const self = this;
        return fetch(resolveAsset('drums/manifest.json'), { cache: 'force-cache' })
            .then(function (r) { if (!r.ok) throw new Error('нет drums/manifest.json'); return r.json(); })
            .then(function (man) {
                const base = resolveAsset(man.basePath || 'drums/');
                const insts = man.instruments || {};
                const kit = {};
                const tasks = [];
                Object.keys(insts).forEach(function (type) {
                    const def = insts[type];
                    kit[type] = { group: def.group || null, layers: [] };
                    (def.layers || []).forEach(function (L) {
                        const entry = {
                            loVel: L.loVel != null ? L.loVel : 0,
                            hiVel: L.hiVel != null ? L.hiVel : 127,
                            buffer: null,
                        };
                        kit[type].layers.push(entry);
                        tasks.push(fetch(base + L.file)
                            .then(function (r) { if (!r.ok) throw new Error(L.file); return r.arrayBuffer(); })
                            .then(function (ab) { return ctx.decodeAudioData(ab); })
                            .then(function (buf) { entry.buffer = buf; })
                            .catch(function () { /* отсутствующий слой -> пропуск */ }));
                    });
                });
                return Promise.all(tasks).then(function () { return kit; });
            })
            .then(function (kit) {
                self.kit = kit;
                self.ready = Object.keys(kit).some(function (t) {
                    return kit[t].layers.some(function (L) { return L.buffer; });
                });
                self.loading = false;
                console.log('SampledDrums: инструментов ' + Object.keys(kit).length +
                    ', готов: ' + self.ready);
                return self.ready;
            })
            .catch(function (e) {
                self.loading = false; self.ready = false;
                console.log('SampledDrums недоступен, синтез-fallback: ' + e.message);
                return false;
            });
    },

    isReady: function () { return this.ready; },

    // Выбор velocity-слоя: по диапазону, иначе ближайший с буфером.
    _pickLayer: function (inst, vel) {
        const layers = inst.layers;
        for (let i = 0; i < layers.length; i++) {
            const L = layers[i];
            if (L.buffer && vel >= L.loVel && vel <= L.hiVel) return L;
        }
        let best = null, bestD = 1e9;
        for (let i = 0; i < layers.length; i++) {
            const L = layers[i];
            if (!L.buffer) continue;
            const d = Math.abs(vel - (L.loVel + L.hiVel) / 2);
            if (d < bestD) { bestD = d; best = L; }
        }
        return best;
    },

    // Гасит звучащие голоса той же choke-группы (открытый хай-хэт при
    // закрытом ударе). Короткий фейд — без щелчка.
    _choke: function (group, when) {
        for (let i = 0; i < this.voices.length; i++) {
            const v = this.voices[i];
            if (v.group !== group || v.choked) continue;
            v.choked = true;
            try {
                const g = v.g.gain;
                g.cancelScheduledValues(when);
                g.setValueAtTime(Math.max(0.0001, g.value), when);
                g.exponentialRampToValueAtTime(0.0001, when + 0.04);
                v.src.stop(when + 0.06);
            } catch (e) { /* no-op */ }
        }
    },

    // Сэмпл-точный удар. false -> вызывающий уходит в синтез-fallback.
    noteOn: function (type, when, velocity) {
        const ctx = this.ctx; if (!ctx || !this.ready) return false;
        const inst = this.kit[type]; if (!inst) return false;
        // Выбор velocity-СЛОЯ сэмпла — по целочисленной velocity 1..127.
        const vel = Math.max(1, Math.min(127,
            Math.round((velocity == null ? 0.78 : velocity) * 127)));
        const L = this._pickLayer(inst, vel); if (!L || !L.buffer) return false;
        if (inst.group) this._choke(inst.group, when);
        if (this.voices.length >= this.maxVoices) {
            try { this.voices[0].src.stop(when); } catch (e) { /* no-op */ }
            this.voices.shift();
        }
        const src = ctx.createBufferSource();
        src.buffer = L.buffer;
        const g = ctx.createGain();
        // Громкость — из СЫРОЙ float-velocity по общей кривой (ff != fff!).
        g.gain.value = Math.min(1.0, velocityGain(velocity, 0.92));
        src.connect(g); g.connect(this.master);
        src.start(when);                          // хвост звучит ЦЕЛИКОМ
        const voice = { src: src, g: g, group: inst.group, choked: false, dead: false };
        src.onended = function () { voice.dead = true; };
        this.voices.push(voice);
        this._ensureGc();
        return true;
    },

    _ensureGc: function () {
        if (this.gc) return;
        const self = this;
        this.gc = setInterval(function () {
            for (let i = self.voices.length - 1; i >= 0; i--) {
                if (self.voices[i].dead) self.voices.splice(i, 1);
            }
            if (self.voices.length === 0) { clearInterval(self.gc); self.gc = null; }
        }, 50);
    },

    stopAll: function () {
        const now = this.ctx ? this.ctx.currentTime : 0;
        for (let i = 0; i < this.voices.length; i++) {
            try { this.voices[i].src.stop(now); } catch (e) { /* no-op */ }
        }
        this.voices = [];
        if (this.gc) { clearInterval(this.gc); this.gc = null; }
    },
};
