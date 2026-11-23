// AudioManager — the sound of a room on the street map (ui/innerMapInteriorSound.js chooses it).
//
// setInteriorAmbience(spec) plays the inside of a building as a few looping layers, all
// synthesized here (no sound files), mixed onto an interior bus that follows the ambience
// volume (and the master volume and mute, through the master bus):
//   room    — a quiet room tone: low, dark noise (every room has it)
//   chatter — a murmur of voices: a 6 s loop of babbled syllables through two formant filters
//   crowd   — a second, slower copy of the murmur: a busy room
//   fire    — a hearth, an oven, the forge: a low rumble with crackles in it
//   forge   — the smith's bellows: a dark roar breathing in and out
//   hum     — a church's quiet: a low fifth held under the vault
// with an echo send (a church, a great hall, a cave) and one-shots driven by interiorTick(dt):
// the fire's pops, mugs clinking at a busy bar, water dripping in a cave.
// While a room plays, the outdoor music and ambience are ducked (setMusicVolume /
// setAmbienceVolume keep the duck). setInteriorAmbience(null) fades it all out and stops it.
// Never starts the audio context itself and never throws: → true when the sound is as asked
// (false: no audio yet — ask again later).
import { AudioManager } from './core.js';

// The level each layer plays at when the spec asks for 1.0 (before the bus volume)
const LAYER_GAIN = { room: 0.07, chatter: 0.34, crowd: 0.26, fire: 0.24, forge: 0.2, hum: 0.06 };
// The outdoor buses while indoors
const DUCK = { music: 0.45, ambience: 0.6 };
const FADE_IN = 0.35;    // seconds (time constant)
const FADE_OUT = 0.25;

// Its own little noise stream: cosmetic, never the game's RNG
function _rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const _clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function _normalize(data, peak = 0.9) {
    let m = 0;
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
    if (m > 0) { const k = peak / m; for (let i = 0; i < data.length; i++) data[i] *= k; }
}

/** Brown noise (integrated white): the dark rumble under a room, a fire, the bellows. */
function _brown(data, rnd, amt = 1) {
    let b = 0;
    for (let i = 0; i < data.length; i++) {
        b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02;
        data[i] += b * 3.5 * amt;
    }
}

/** A murmur of voices: `voices` speakers babbling syllables in phrases, wrapped to loop seamlessly. */
export function synthChatter(data, sampleRate, rnd, voices = 6) {
    const n = data.length;
    for (let v = 0; v < voices; v++) {
        let f0 = 95 + rnd() * 150;
        let t = Math.floor(rnd() * sampleRate);
        let phase = 0;
        const amp = 0.5 + rnd() * 0.5;
        while (t < n) {
            const syl = 2 + Math.floor(rnd() * 6);
            for (let s = 0; s < syl && t < n; s++) {
                const len = Math.floor(sampleRate * (0.07 + rnd() * 0.16));
                const a = amp * (0.55 + rnd() * 0.45);
                f0 *= 1 + (rnd() - 0.5) * 0.12;
                f0 = Math.max(85, Math.min(260, f0));
                const glide = (rnd() - 0.5) * 0.25;
                for (let k = 0; k < len; k++) {
                    const x = k / len;
                    const env = Math.sin(Math.PI * x);
                    phase += (f0 * (1 + glide * x)) / sampleRate;
                    const saw = 2 * (phase % 1) - 1;
                    data[(t + k) % n] += a * env * env * (0.75 * saw + 0.25 * (rnd() * 2 - 1));
                }
                t += len + Math.floor(sampleRate * (0.015 + rnd() * 0.05));
            }
            t += Math.floor(sampleRate * (0.25 + rnd() * 1.2));   // a breath between phrases
        }
    }
    _normalize(data);
}

/** A fire: a low rumble with crackles (quick ticks of noise dying away), now and then a pop. */
export function synthFire(data, sampleRate, rnd) {
    const n = data.length;
    _brown(data, rnd, 0.5);
    const cracks = Math.floor((n / sampleRate) * 16);
    for (let c = 0; c < cracks; c++) {
        const at = Math.floor(rnd() * n);
        const big = rnd() < 0.08;
        const len = Math.floor(sampleRate * (big ? 0.03 : 0.003 + rnd() * 0.01));
        const a = big ? 0.9 : 0.15 + rnd() * 0.45;
        for (let k = 0; k < len; k++) data[(at + k) % n] += a * Math.exp(-6 * k / len) * (rnd() * 2 - 1);
    }
    _normalize(data);
}

/** Room tone / the bellows' roar: dark noise only. */
export function synthRumble(data, sampleRate, rnd) {
    _brown(data, rnd, 1);
    _normalize(data, 0.8);
}

Object.assign(AudioManager.prototype, {
    /**
     * Play the room the player is in, or (null) fade it out and stop it.
     * spec: { kind, layers: { room, chatter, crowd, fire, forge, hum, drip } 0..1, echo 0..1, duck }
     */
    setInteriorAmbience(spec) {
        try {
            const ctx = this.ctx;
            let I = this._interior;
            if (I && I.ctx !== ctx) I = this._interior = null;   // (the context was closed and made anew)
            if (!spec) {
                if (I) this._stopInterior(I);
                this._setIndoorDuck(false);
                return true;
            }
            if (!ctx || typeof ctx.createBufferSource !== 'function' || !(this.masterGain || this.ambienceGain)) return false;
            if (!I) I = this._interior = this._startInterior(ctx);
            const now = ctx.currentTime;
            const L = spec.layers || {};
            for (const name of Object.keys(LAYER_GAIN)) {
                const lv = _clamp01(L[name]);
                let layer = I.layers[name];
                if (!layer && lv <= 0.01) continue;
                if (!layer) layer = I.layers[name] = this._interiorLayer(I, name);
                if (Math.abs(lv - layer.level) > 0.005) {
                    layer.out.gain.setTargetAtTime(lv * LAYER_GAIN[name], now, FADE_IN);
                    layer.level = lv;
                }
            }
            const echo = _clamp01(spec.echo);
            if (Math.abs(echo - I.echoLevel) > 0.005) {
                I.send.gain.setTargetAtTime(echo * 0.55, now, FADE_IN);
                I.echoLevel = echo;
            }
            I.drip = _clamp01(L.drip);
            I.spec = spec;
            I.kind = spec.kind || null;
            this._syncInteriorBus();
            this._setIndoorDuck(spec.duck !== false);
            return true;
        } catch (_) {
            return true;   // (sound is best-effort: not asked again)
        }
    },

    /** Stop the room's sound (on leaving the building or the town, pausing, a menu). */
    stopInteriorAmbience() {
        return this.setInteriorAmbience(null);
    },

    /** Whether a room is playing (for the game side and specs). */
    interiorAmbienceActive() {
        return !!(this._interior && !this._interior.stopping);
    },

    /** The room's one-shots, once a frame while it plays: the fire's pops, mugs at the bar, drips. */
    interiorTick(dt) {
        try {
            const I = this._interior;
            if (!I || I.stopping || !this.ctx || I.ctx !== this.ctx) return;
            const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
            if (!step) return;
            const lv = (n) => (I.layers[n] ? I.layers[n].level : 0);
            const fire = Math.max(lv('fire'), lv('forge') * 0.5);
            if (fire > 0 && I.rnd() < 0.7 * fire * step) this._intPop(I, fire);
            const talk = lv('chatter');
            if (talk > 0.2 && I.kind === 'tavern' && I.rnd() < 0.55 * talk * step) this._intClink(I, talk);
            if (I.drip > 0 && I.rnd() < 0.35 * I.drip * step) this._intDrip(I, I.drip);
        } catch (_) { /* sound is best-effort */ }
    },

    /** Keep the interior bus at the ambience volume (the master bus carries master volume and mute). */
    _syncInteriorBus() {
        const I = this._interior;
        if (!I || I.stopping || !this.ctx) return;
        const v = _clamp01(this.ambienceVolume);
        if (Math.abs(v - I.busLevel) > 0.002) {
            I.bus.gain.setTargetAtTime(v, this.ctx.currentTime, FADE_IN);
            I.busLevel = v;
        }
    },

    /** Duck (or restore) the outdoor music and ambience while a room plays. */
    _setIndoorDuck(on) {
        on = !!on;
        if (!!this._indoorDuck === on) return;
        this._indoorDuck = on;
        const ctx = this.ctx;
        if (!ctx) return;
        const now = ctx.currentTime;
        try {
            if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVolume * (on ? DUCK.music : 1), now, 0.35);
            if (this.ambienceGain) this.ambienceGain.gain.setTargetAtTime(this.ambienceVolume * (on ? DUCK.ambience : 1), now, 0.35);
        } catch (_) { /* best-effort */ }
    },

    /** The duck factor a bus is under right now ('music' | 'ambience'). */
    _duckOf(bus) {
        return this._indoorDuck ? (DUCK[bus] || 1) : 1;
    },

    _startInterior(ctx) {
        const bus = ctx.createGain();
        bus.gain.value = 0;
        bus.connect(this.masterGain || this.ambienceGain);
        // The echo: a feedback delay, darkened, back into the bus
        const send = ctx.createGain();
        send.gain.value = 0;
        let echoIn = send;
        if (typeof ctx.createDelay === 'function') {
            const delay = ctx.createDelay(1);
            delay.delayTime.value = 0.29;
            const fb = ctx.createGain();
            fb.gain.value = 0.42;
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 1900;
            send.connect(delay);
            delay.connect(lp);
            lp.connect(fb);
            fb.connect(delay);
            lp.connect(bus);
            echoIn = send;
        }
        return {
            ctx, bus, send: echoIn, layers: {}, buffers: {}, echoLevel: 0, busLevel: -1, drip: 0,
            kind: null, spec: null, stopping: false, rnd: _rng(0x1a7e51),
        };
    },

    _interiorBuffer(I, which) {
        if (I.buffers[which]) return I.buffers[which];
        const ctx = I.ctx;
        const secs = which === 'chatter' ? 6 : 4;
        const n = Math.floor(ctx.sampleRate * secs);
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        const rnd = _rng(which === 'chatter' ? 0xc4a7 : which === 'fire' ? 0xf12e : 0x2007);
        if (which === 'chatter') synthChatter(data, ctx.sampleRate, rnd);
        else if (which === 'fire') synthFire(data, ctx.sampleRate, rnd);
        else synthRumble(data, ctx.sampleRate, rnd);
        I.buffers[which] = buf;
        return buf;
    },

    _filter(ctx, type, freq, q) {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        if (q != null && f.Q) f.Q.value = q;
        return f;
    },

    /** Build one looping layer: source(s) → its filters → out (gain 0, raised by the spec) → bus (+ echo). */
    _interiorLayer(I, name) {
        const ctx = I.ctx;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.connect(I.bus);
        const sources = [];
        const loop = (which, rate = 1, offset = 0) => {
            const src = ctx.createBufferSource();
            src.buffer = this._interiorBuffer(I, which);
            src.loop = true;
            if (src.playbackRate) src.playbackRate.value = rate;
            sources.push(src);
            return { src, offset };
        };
        const start = ({ src, offset }) => { try { src.start(ctx.currentTime, offset); } catch (_) { src.start(); } };
        let echo = false;
        if (name === 'room') {
            const s = loop('rumble', 0.7);
            const lp = this._filter(ctx, 'lowpass', 240);
            s.src.connect(lp); lp.connect(out);
            start(s);
            echo = true;
        } else if (name === 'chatter' || name === 'crowd') {
            // (the crowd: the same murmur slower and lower, started elsewhere in the loop)
            const s = name === 'crowd' ? loop('chatter', 0.88, 2.7) : loop('chatter', 1);
            const f1 = this._filter(ctx, 'bandpass', 620, 0.9);
            const f2 = this._filter(ctx, 'bandpass', 1650, 1.3);
            const lp = this._filter(ctx, 'lowpass', 2600);
            const g2 = ctx.createGain();
            g2.gain.value = 0.55;
            s.src.connect(f1); f1.connect(lp);
            s.src.connect(f2); f2.connect(g2); g2.connect(lp);
            lp.connect(out);
            start(s);
            echo = true;
        } else if (name === 'fire') {
            const s = loop('fire', 1);
            const lp = this._filter(ctx, 'lowpass', 5200);
            s.src.connect(lp); lp.connect(out);
            start(s);
        } else if (name === 'forge') {
            // the bellows: the roar's gain breathed by a slow wave
            const s = loop('rumble', 1.3, 1.1);
            const lp = this._filter(ctx, 'lowpass', 520);
            const breath = ctx.createGain();
            breath.gain.value = 0.6;
            s.src.connect(lp); lp.connect(breath); breath.connect(out);
            if (typeof ctx.createOscillator === 'function') {
                const lfo = ctx.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = 0.28;
                const depth = ctx.createGain();
                depth.gain.value = 0.45;
                lfo.connect(depth); depth.connect(breath.gain);
                lfo.start();
                sources.push(lfo);
            }
            start(s);
        } else if (name === 'hum') {
            // a low fifth, slowly swelling, under the vault
            if (typeof ctx.createOscillator === 'function') {
                const lp = this._filter(ctx, 'lowpass', 900);
                lp.connect(out);
                for (const [freq, g, type] of [[110, 0.5, 'sine'], [164.8, 0.3, 'sine'], [55, 0.25, 'triangle'], [220.6, 0.12, 'sine']]) {
                    const o = ctx.createOscillator();
                    o.type = type;
                    o.frequency.value = freq;
                    const og = ctx.createGain();
                    og.gain.value = g;
                    o.connect(og); og.connect(lp);
                    o.start();
                    sources.push(o);
                }
            }
            const air = loop('rumble', 1.6, 0.5);
            const bp = this._filter(ctx, 'bandpass', 700, 0.6);
            const ag = ctx.createGain();
            ag.gain.value = 0.35;
            air.src.connect(bp); bp.connect(ag); ag.connect(out);
            start(air);
            echo = true;
        }
        if (echo) out.connect(I.send);
        return { out, sources, level: 0 };
    },

    _stopInterior(I) {
        if (I.stopping) return;
        I.stopping = true;
        const ctx = I.ctx;
        const now = ctx.currentTime;
        try { I.bus.gain.setTargetAtTime(0, now, FADE_OUT); } catch (_) { /* closed */ }
        for (const layer of Object.values(I.layers)) {
            for (const s of layer.sources) { try { s.stop(now + 1.5); } catch (_) { /* already stopped */ } }
        }
        // (the echo's tail and the bus are let go with the sources; nothing loops on)
        setTimeout(() => { try { I.bus.disconnect && I.bus.disconnect(); } catch (_) { /* gone */ } }, 1800);
        if (this._interior === I) this._interior = null;
    },

    // ── One-shots on the interior bus ──
    _intNoise(I, dur, type, freq, gain, echo = false) {
        const ctx = I.ctx;
        const now = ctx.currentTime;
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (I.rnd() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const f = this._filter(ctx, type, freq);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, now);
        if (g.gain.exponentialRampToValueAtTime) g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(f); f.connect(g); g.connect(I.bus);
        if (echo) g.connect(I.send);
        src.start(now);
    },

    _intTone(I, from, to, dur, gain, type = 'sine', at = 0, echo = false) {
        const ctx = I.ctx;
        const now = ctx.currentTime + at;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(from, now);
        if (o.frequency.exponentialRampToValueAtTime) o.frequency.exponentialRampToValueAtTime(to, now + dur);
        g.gain.setValueAtTime(gain, now);
        if (g.gain.exponentialRampToValueAtTime) g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        o.connect(g); g.connect(I.bus);
        if (echo) g.connect(I.send);
        o.start(now);
        o.stop(now + dur + 0.02);
    },

    /** A knot in the wood bursting. */
    _intPop(I, lv) {
        this._intNoise(I, 0.012 + I.rnd() * 0.02, 'highpass', 1800 + I.rnd() * 2000, 0.05 + 0.1 * lv);
    },

    /** Two mugs knocked together, or one set down on the board. */
    _intClink(I, lv) {
        const base = 1900 + I.rnd() * 900;
        const g = 0.012 + 0.02 * lv;
        this._intTone(I, base, base * 0.98, 0.16, g, 'sine');
        this._intTone(I, base * 1.37, base * 1.35, 0.12, g * 0.6, 'sine');
        if (I.rnd() < 0.4) this._intTone(I, base * 1.05, base * 1.03, 0.12, g * 0.7, 'sine', 0.07);
    },

    /** A drop of water falling into a pool, echoing. */
    _intDrip(I, lv) {
        const f = 1100 + I.rnd() * 700;
        this._intTone(I, f, f * 0.55, 0.05, 0.03 + 0.03 * lv, 'sine', 0, true);
    },
});
