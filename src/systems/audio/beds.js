// AudioManager — ambience beds: recorded loops crossfaded by place, hour, season and weather.
//
// setAmbienceBeds(levels, opts) is told what should be heard now — { bed: 0..1 } over the
// bed_* keys of the bank (audio/samples.js): day_birds, forest, night_crickets, wind,
// wind_gust, surf, sea, rain_light, rain_heavy, dungeon, tavern, market, town_street,
// hall_murmur, choir, sermon, drill, camp, crowd, cart — and glides each loop to its level (a slow crossfade: FADE s). A bed not
// yet loaded is fetched and comes in when it's ready; one held at 0 a while is stopped.
// Two groups: 'outdoor' (on the ambience bus, through a low-pass that muffles it all
// indoors: opts.muffle 0..1) and 'indoor' (the room you're in; ui/soundscape.js feeds it
// from the room's spec, at the ambience volume, not ducked).
// opts.events: { owl, creak, wave, bells, anvil, snort } — chances a minute of a one-shot over
// the beds (an owl at night, the hull creaking at sea, a wave breaking on the shore, a horse
// snorting by the stables).
// The rain (setRain from ui/innerMapWeather.js) is folded in here when the rain's recordings
// are in: rain_light and rain_heavy crossfaded by how hard it falls, muffled indoors.
// Never throws; nothing plays before the first click (no context yet).
//
// QA from the console: audioManager.bedStats() → { outdoor: { bed: level }, indoor: {…}, muffle }.
import { AudioManager } from './core.js';
import { SAMPLE_BANK } from './samples.js';

const FADE = 2.2;          // s: time constant of a bed's glide
const STOP_AFTER = 8000;   // ms at ~0 before a bed's source is stopped
const _clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** The rain's two beds for a rain level 0..1: light from a drizzle, heavy coming in past half. */
export function rainBedLevels(level) {
    const lv = _clamp01(level);
    if (lv <= 0.02) return { rain_light: 0, rain_heavy: 0 };
    const heavy = lv <= 0.45 ? 0 : Math.min(1, (lv - 0.45) / 0.4);
    const light = Math.min(1, 0.35 + lv * 1.1) * (1 - 0.55 * heavy);
    return { rain_light: Math.round(light * 100) / 100, rain_heavy: Math.round(heavy * 100) / 100 };
}

Object.assign(AudioManager.prototype, {
    /** The two bed groups (made on demand on this context). */
    _bedGroup(name) {
        const ctx = this.ctx;
        if (!ctx || !this.ambienceGain) return null;
        this._bedGroups = this._bedGroups && this._bedGroupsCtx === ctx ? this._bedGroups : {};
        this._bedGroupsCtx = ctx;
        let G = this._bedGroups[name];
        if (G) return G;
        const out = ctx.createGain();
        out.gain.value = name === 'indoor' ? _clamp01(this.ambienceVolume) : 1;
        let input = out;
        let lp = null;
        if (typeof ctx.createBiquadFilter === 'function') {
            lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 20000;
            lp.connect(out);
            input = lp;
        }
        // indoors the room is heard at the ambience volume, past the street's duck
        out.connect(name === 'indoor' ? (this.masterGain || this.ambienceGain) : this.ambienceGain);
        G = this._bedGroups[name] = { name, input, out, lp, beds: {}, want: {}, muffle: 0 };
        return G;
    },

    /**
     * What the ambience should be now. levels: { bedName: 0..1 } (names without 'bed_').
     * opts: { group: 'outdoor'|'indoor', muffle: 0..1, events: { owl, creak, wave }, fade: s }.
     * → true when applied (false: no audio yet).
     */
    setAmbienceBeds(levels, opts = {}) {
        try {
            if (!this.recordedOn()) return false;
            const G = this._bedGroup(opts.group === 'indoor' ? 'indoor' : 'outdoor');
            if (!G) return false;
            const want = {};
            for (const [k, v] of Object.entries(levels || {})) {
                if (!SAMPLE_BANK['bed_' + k]) continue;
                const lv = _clamp01(v);
                if (lv > 0.005) want[k] = lv;
            }
            G.want = want;
            G.fade = Number.isFinite(opts.fade) ? opts.fade : FADE;
            if (G.name === 'outdoor') {
                G.events = opts.events || null;
                this._setBedMuffle(G, _clamp01(opts.muffle));
            }
            this._applyBeds(G);
            return true;
        } catch (_) {
            return true;
        }
    },

    _setBedMuffle(G, m) {
        if (!G.lp || Math.abs(m - G.muffle) < 0.01) return;
        G.muffle = m;
        // open air → through the walls: 20 kHz → ~450 Hz
        const f = 20000 * Math.pow(450 / 20000, m);
        G.lp.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.4);
    },

    /** Glide every bed of a group toward what's wanted (rain folded in for the outdoor group). */
    _applyBeds(G) {
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const want = { ...G.want };
        if (G.name === 'outdoor' && this._rainBedsOn()) {
            const R = rainBedLevels(this._rainWant ? this._rainWant.level : 0);
            const indoor = this._rainWant && this._rainWant.muffled;
            for (const [k, v] of Object.entries(R)) {
                // (indoors the rain is heard on the roof: quieter, the low-pass does the rest)
                if (v > 0) want[k] = Math.max(want[k] || 0, v * (indoor ? 0.7 : 1));
            }
        }
        const names = new Set([...Object.keys(G.beds), ...Object.keys(want)]);
        for (const name of names) {
            const lv = want[name] || 0;
            let b = G.beds[name];
            if (!b) {
                if (lv <= 0) continue;
                const key = 'bed_' + name;
                if (!this.sampleReady(key)) {
                    if (!this.sampleFailed(key)) this.loadSample(key).then(() => { try { this._applyBeds(G); } catch (_) { /* best-effort */ } });
                    continue;
                }
                b = G.beds[name] = this._startBed(G, name);
                if (!b) continue;
            }
            const target = lv * (SAMPLE_BANK['bed_' + b.name].gain || 0.4);
            if (Math.abs(target - b.target) > 0.002) {
                b.gain.gain.setTargetAtTime(target, now, G.fade || FADE);
                b.target = target;
            }
            b.level = lv;
            if (lv > 0) b.zeroSince = 0;
            else if (!b.zeroSince) b.zeroSince = Date.now();
        }
    },

    _startBed(G, name) {
        const s = this.sampleState('bed_' + name);
        if (!s || !s.buffers.length) return null;
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = s.buffers[0];
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(G.input);
        // (a random place in the loop: two of a kind never start in step)
        try { src.start(ctx.currentTime, Math.random() * Math.max(0, src.buffer.duration - 0.5)); } catch (_) { src.start(); }
        s.lastUse = Date.now();
        return { name, src, gain, target: 0, level: 0, zeroSince: 0 };
    },

    /** Once a frame (ui/soundscape.js): stop beds long silent, roll the one-shots, keep the indoor group at the ambience volume. */
    bedsTick(dt) {
        try {
            if (!this._bedGroups || this._bedGroupsCtx !== this.ctx || !this.ctx) return;
            const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
            const nowMs = Date.now();
            for (const G of Object.values(this._bedGroups)) {
                for (const [name, b] of Object.entries(G.beds)) {
                    const s = this.sampleState('bed_' + name);
                    if (s) s.lastUse = nowMs;
                    if (b.level <= 0 && b.zeroSince && nowMs - b.zeroSince > STOP_AFTER) {
                        try { b.src.stop(); b.gain.disconnect(); } catch (_) { /* gone */ }
                        delete G.beds[name];
                    }
                }
                if (G.name === 'indoor') {
                    const v = _clamp01(this.ambienceVolume);
                    if (Math.abs(v - (G.vol ?? -1)) > 0.002) { G.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3); G.vol = v; }
                }
                if (G.events && step > 0) this._bedEvents(G, step);
            }
            this.evictIdleSamples(nowMs);
            // (the rain's recordings failed to load: the synthesized hiss takes over)
            const R = this._rainWant;
            if (R && R.level > 0.02 && !this._rainBedsOn() && !this._rain) this._setRainSynth(R.level, R.muffled);
        } catch (_) { /* best-effort */ }
    },

    /** The beds' one-shots: chances a minute → a roll this frame. */
    _bedEvents(G, step) {
        const E = G.events;
        const roll = (perMin) => perMin > 0 && Math.random() < (perMin / 60) * step;
        const muffle = G.muffle > 0.5 ? 900 : 0;
        const bus = G.input;
        if (roll(E.owl)) this.playSample('owl', { bus, gain: 0.6 + Math.random() * 0.4, lowpass: muffle || 6000, pan: Math.random() * 1.4 - 0.7 });
        if (roll(E.creak)) this.playSample('creak', { bus, gain: 0.5 + Math.random() * 0.5, rate: 0.7 + Math.random() * 0.2, lowpass: 2500, pan: Math.random() * 1.2 - 0.6 });
        if (roll(E.wave)) this.playSample('wave', { bus, gain: (0.5 + Math.random() * 0.5) * (Number(E.waveGain) || 1), lowpass: muffle || 9000, pan: Math.random() * 0.8 - 0.4 });
        if (roll(E.bells)) this.playSample('church_bells', { bus, gain: Number(E.bellGain) || 0.5, lowpass: muffle || 3500 });
        if (roll(E.anvil)) this.playSample('anvil', { bus, gain: (Number(E.anvilGain) || 0.5) * (0.7 + Math.random() * 0.3) });
        if (roll(E.snort)) this.playSample('snort', { bus, gain: (Number(E.snortGain) || 0.6) * (0.6 + Math.random() * 0.4), lowpass: muffle || 0, pan: Math.random() * 1.2 - 0.6 });
    },

    /** Are the rain's recordings in (so the synthesized hiss isn't needed)? */
    _rainBedsOn() {
        return this.recordedOn() && !this.sampleFailed('bed_rain_light');
    },

    /** Stop every bed now (back to the title, a new game). */
    stopAmbienceBeds() {
        try {
            for (const G of Object.values(this._bedGroups || {})) {
                G.want = {};
                G.events = null;
                for (const b of Object.values(G.beds)) {
                    try { b.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); b.src.stop(this.ctx.currentTime + 2); } catch (_) { /* gone */ }
                }
                G.beds = {};
            }
        } catch (_) { /* best-effort */ }
    },

    /** QA: the beds playing and their levels. */
    bedStats() {
        const out = {};
        for (const [n, G] of Object.entries(this._bedGroups || {})) {
            out[n] = {};
            for (const [k, b] of Object.entries(G.beds)) out[n][k] = b.level;
            out[n + 'Want'] = { ...G.want };
            if (n === 'outdoor') out.muffle = G.muffle;
        }
        out.rain = this._rainWant || null;
        return out;
    },
});
