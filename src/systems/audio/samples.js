// AudioManager — recorded sounds: the bank of files, a small loader/cache, one-shots.
//
// Every recorded file lives under assets/audio/ (credits: assets/audio/CREDITS.md):
//   music/  the tracks (streamed through <audio> elements: audio/music.js)
//   amb/    looping ambience beds and their one-shots (audio/beds.js)
//   sfx/    short sounds: footsteps, doors, coins, blades, the bow, fishing, the UI…
// A key in SAMPLE_BANK names one sound and its variants (one picked at random each play),
// how loud it plays (gain, before the bus volume) and a little random pitch (rate).
// Files are fetched and decoded lazily (decodeAudioData runs off the main thread), a few at
// a time, the first time a sound is asked for — or up front for the small core set
// (preloadCoreSamples, on the first click). A sound not yet decoded is not played (the
// synthesized one stands in: sfx.js); one that fails to load is remembered as failed and
// never fetched again. Beds not heard for a while are let go (evictIdleSamples).
//
// QA from the console: audioManager.sampleStats() → { ready, loading, failed, bytes }.
import { AudioManager } from './core.js';

/** Where the files are served from (relative: the dev server, the built page and Electron's app:// all serve the repo root's assets/). */
export const SAMPLE_BASE = 'assets/audio/';

const _n = (stem, count, from = 1) => Array.from({ length: count }, (_, i) => `${stem}${i + from}.ogg`);

/**
 * key → { files: [paths under assets/audio/], gain, rate: [lo, hi], loop?, bus? }
 * gain is the level at 1.0 before the bus (sfx / ambience) volume.
 */
export const SAMPLE_BANK = {
    // ── Footsteps (ui/soundscape.js: two to a tile, by the ground underfoot) ──
    step_grass: { files: _n('sfx/step_grass_', 6), gain: 0.22, rate: [0.9, 1.1] },
    step_dirt: { files: ['sfx/step_dirt_1.ogg', 'sfx/step_grass_2.ogg', 'sfx/step_grass_5.ogg'], gain: 0.24, rate: [0.85, 1.05] },
    step_leaves: { files: _n('sfx/step_leaves_', 2), gain: 0.2, rate: [0.9, 1.15] },
    step_mud: { files: _n('sfx/step_mud_', 2), gain: 0.3, rate: [0.85, 1.05] },
    step_stone: { files: _n('sfx/step_stone_', 7), gain: 0.22, rate: [0.92, 1.08] },
    step_wood: { files: _n('sfx/step_wood_', 8), gain: 0.24, rate: [0.92, 1.08] },
    step_snow: { files: _n('sfx/step_snow_', 8), gain: 0.26, rate: [0.9, 1.1] },
    step_water: { files: _n('sfx/step_water_', 3), gain: 0.22, rate: [0.9, 1.15] },
    // ── Things done ──
    door_open: { files: _n('sfx/door_open_', 2), gain: 0.45, rate: [0.95, 1.05] },
    door_close: { files: _n('sfx/door_close_', 3), gain: 0.45, rate: [0.95, 1.05] },
    lockpick: { files: ['sfx/lockpick.ogg'], gain: 0.5, rate: [0.97, 1.03] },
    unlock: { files: ['sfx/unlock.ogg'], gain: 0.5, rate: [0.97, 1.03] },
    lock_click: { files: ['sfx/lock_click.ogg', 'sfx/lock_latch.ogg'], gain: 0.5, rate: [0.95, 1.05] },
    knock: { files: ['sfx/door_close_3.ogg'], gain: 0.35, rate: [1.25, 1.4] },
    coins: { files: _n('sfx/coins_', 2), gain: 0.45, rate: [0.95, 1.08] },
    chest_open: { files: ['sfx/chest_open.ogg'], gain: 0.45, rate: [0.95, 1.05] },
    page: { files: _n('sfx/page_', 3), gain: 0.4, rate: [0.95, 1.08] },
    book_open: { files: ['sfx/book_open.ogg'], gain: 0.4, rate: [0.95, 1.05] },
    book_close: { files: ['sfx/book_close.ogg'], gain: 0.4, rate: [0.95, 1.05] },
    chop: { files: _n('sfx/chop_', 2), gain: 0.55, rate: [0.9, 1.05] },
    anvil: { files: _n('sfx/anvil_', 3), gain: 0.42, rate: [0.95, 1.05] },
    sword_clash: { files: _n('sfx/sword_clash_', 6), gain: 0.42, rate: [0.92, 1.08] },
    sword_swing: { files: _n('sfx/sword_swing_', 4), gain: 0.35, rate: [0.92, 1.08] },
    draw_blade: { files: ['sfx/draw_blade.ogg'], gain: 0.4, rate: [0.95, 1.05] },
    bow_loose: { files: _n('sfx/bow_loose_', 2), gain: 0.5, rate: [0.95, 1.05] },
    crossbow_loose: { files: ['sfx/crossbow_loose.ogg'], gain: 0.5, rate: [0.95, 1.05] },
    fish_cast: { files: ['sfx/fish_cast.ogg'], gain: 0.4, rate: [0.95, 1.08] },
    fish_reel: { files: ['sfx/fish_reel.ogg'], gain: 0.35, rate: [0.97, 1.03] },
    fish_splash: { files: ['sfx/fish_splash.ogg'], gain: 0.4, rate: [0.95, 1.08] },
    splash: { files: _n('sfx/splash_', 3), gain: 0.45, rate: [0.9, 1.1] },
    creak: { files: _n('sfx/creak_', 3), gain: 0.28, rate: [0.8, 1.0] },
    thunder_near: { files: ['sfx/thunder_near.ogg'], gain: 0.75, rate: [0.92, 1.05] },
    thunder_far: { files: ['sfx/thunder_far.ogg'], gain: 0.55, rate: [0.85, 1.0] },
    wave: { files: _n('sfx/wave_', 3), gain: 0.35, rate: [0.9, 1.08] },
    // ── Horses, carts, crowds, the drill, the crier, the guns ──
    hoof: { files: _n('sfx/hoof_', 4), gain: 0.34, rate: [0.94, 1.06] },
    snort: { files: _n('sfx/snort_', 4), gain: 0.36, rate: [0.92, 1.08] },
    handbell: { files: _n('sfx/handbell_', 3), gain: 0.34, rate: [0.97, 1.03] },
    drill_shout: { files: ['sfx/drill_shout.ogg'], gain: 0.42, rate: [0.9, 1.05] },
    crowd_cheer: { files: _n('sfx/crowd_cheer_', 3), gain: 0.42, rate: [0.95, 1.05] },
    cannon_fire: { files: ['sfx/cannon_fire.ogg'], gain: 0.6, rate: [0.9, 1.08] },
    cannon_hit: { files: ['sfx/cannon_hit.ogg'], gain: 0.5, rate: [0.92, 1.08] },
    cannon_miss: { files: ['sfx/cannon_miss.ogg'], gain: 0.42, rate: [0.92, 1.1] },
    church_bells: { files: ['amb/church_bells.ogg'], gain: 0.4, rate: [1, 1] },
    owl: { files: _n('amb/owl_', 3), gain: 0.32, rate: [0.97, 1.03] },
    // ── The interface: quiet ──
    ui_click: { files: _n('sfx/ui_click_', 2), gain: 0.18, rate: [0.95, 1.05] },
    ui_confirm: { files: ['sfx/ui_confirm.ogg'], gain: 0.25, rate: [1, 1] },
    ui_error: { files: ['sfx/ui_error.ogg'], gain: 0.25, rate: [1, 1] },
    ui_notify: { files: ['sfx/ui_notify.ogg'], gain: 0.22, rate: [1, 1] },
    ui_open: { files: ['sfx/ui_open.ogg'], gain: 0.16, rate: [1, 1] },
    ui_close: { files: ['sfx/ui_close.ogg'], gain: 0.16, rate: [1, 1] },
    // ── Ambience beds (loops; audio/beds.js) ──
    bed_day_birds: { files: ['amb/day_birds.ogg'], gain: 0.42, loop: true },
    bed_forest: { files: ['amb/forest.ogg'], gain: 0.45, loop: true },
    bed_night_crickets: { files: ['amb/night_crickets.ogg'], gain: 0.32, loop: true },
    bed_wind: { files: ['amb/wind.ogg'], gain: 0.42, loop: true },
    bed_wind_gust: { files: ['amb/wind_gust.ogg'], gain: 0.32, loop: true },
    bed_surf: { files: ['amb/surf.ogg'], gain: 0.42, loop: true },
    bed_sea: { files: ['amb/sea.ogg'], gain: 0.5, loop: true },
    bed_rain_light: { files: ['amb/rain_light.ogg'], gain: 0.42, loop: true },
    bed_rain_heavy: { files: ['amb/rain_heavy.ogg'], gain: 0.5, loop: true },
    bed_dungeon: { files: ['amb/dungeon.ogg'], gain: 0.5, loop: true },
    bed_tavern: { files: ['amb/tavern.ogg'], gain: 0.5, loop: true },
    bed_market: { files: ['amb/market.ogg'], gain: 0.42, loop: true },
    bed_town_street: { files: ['amb/town_street.ogg'], gain: 0.32, loop: true },
    bed_hall_murmur: { files: ['amb/hall_murmur.ogg'], gain: 0.32, loop: true },
    bed_choir: { files: ['amb/choir.ogg'], gain: 0.36, loop: true },
    bed_sermon: { files: ['amb/sermon.ogg'], gain: 0.32, loop: true },
    bed_drill: { files: ['amb/drill.ogg'], gain: 0.36, loop: true },
    bed_camp: { files: ['amb/camp.ogg'], gain: 0.36, loop: true },
    bed_crowd: { files: ['amb/crowd.ogg'], gain: 0.4, loop: true },
    bed_cart: { files: ['amb/cart.ogg'], gain: 0.34, loop: true },
};

/**
 * The rate a loop is decoded at (an OfflineAudioContext at this rate decodes it, so the buffer
 * holds that many samples a second rather than the device's 48 kHz: a third to a half of the
 * memory). The files are made at these rates (assets/audio/amb/): hiss (rain, surf, the sea,
 * wind) keeps 32 kHz, the rest 22.05 kHz. One-shots decode at the device's rate.
 */
export const BED_RATE = 22050;
export const BED_RATE_HISS = 32000;
const HISS_BEDS = new Set(['bed_rain_light', 'bed_rain_heavy', 'bed_surf', 'bed_sea', 'bed_wind', 'bed_wind_gust']);

/** The decode rate for a bank key: a loop's own (above), or null (the device's). */
export function decodeRateFor(key) {
    const def = SAMPLE_BANK[key];
    if (!def || !def.loop) return null;
    return HISS_BEDS.has(key) ? BED_RATE_HISS : BED_RATE;
}

/** The small sounds worth having ready before they're first asked for (fetched on the first click). */
export const CORE_SAMPLES = [
    'step_grass', 'step_dirt', 'step_stone', 'step_wood', 'door_open', 'door_close', 'coins',
    'ui_click', 'ui_notify', 'ui_confirm', 'ui_error', 'sword_clash', 'sword_swing', 'chop', 'anvil',
];

/**
 * The game's playSFX kinds that a recording now plays (the synthesized sound stays as the
 * fallback while it loads, and if it fails). kind → bank key, or { key, gain } to scale it.
 * Kinds not here keep their synthesized sound (turn, level_up, build, sail, the forge game,
 * the ice, the felled tree's creak and crash, the death cart's handbell, a cry underground…).
 */
export const SFX_SAMPLES = {
    click: 'ui_click',
    success: 'ui_confirm',
    error: 'ui_error',
    notify: 'ui_notify',
    gold: 'coins',
    combat_hit: 'sword_clash',
    chop: 'chop',
    anvil: 'anvil',
    bell: 'church_bells',
    thunder: 'thunder_near',
    thunder_far: 'thunder_far',
    // (kinds with no synthesized sound: silent until the file is in)
    door_open: 'door_open', door_close: 'door_close', knock: 'knock',
    lockpick: 'lockpick', unlock: 'unlock', lock_click: 'lock_click',
    coins: 'coins', chest_open: 'chest_open', page: 'page', book_open: 'book_open', book_close: 'book_close',
    sword_clash: 'sword_clash', sword_swing: 'sword_swing', draw_blade: 'draw_blade',
    bow_loose: 'bow_loose', crossbow_loose: 'crossbow_loose',
    fish_cast: 'fish_cast', fish_reel: 'fish_reel', fish_splash: 'fish_splash', splash: 'splash',
    creak: 'creak', owl: 'owl', wave: 'wave',
    handbell: 'handbell', hoof: 'hoof', snort: 'snort', drill_shout: 'drill_shout', crowd_cheer: 'crowd_cheer',
    cannon_fire: 'cannon_fire', cannon_hit: 'cannon_hit', cannon_miss: 'cannon_miss',
    step_grass: 'step_grass', step_dirt: 'step_dirt', step_leaves: 'step_leaves', step_mud: 'step_mud',
    step_stone: 'step_stone', step_wood: 'step_wood', step_snow: 'step_snow', step_water: 'step_water',
};

const MAX_LOADS = 4;           // fetches in flight at once
const IDLE_EVICT_MS = 45000;   // a loop not played for 45 s is let go (re-fetched if wanted again: they're small files)

/** How loud a sound `dist` cells off plays (1 within `near`, falling to 0 at `far`; smooth). */
export function distanceGain(dist, near = 2, far = 16) {
    const d = Number(dist);
    if (!Number.isFinite(d) || d <= near) return 1;
    if (d >= far) return 0;
    const t = (d - near) / (far - near);
    return Math.pow(1 - t, 1.6);
}

Object.assign(AudioManager.prototype, {
    /** Recorded sound on? (Settings: Sound → Recorded sounds; off keeps the synthesized ones.) */
    recordedOn() {
        return this.recordedSound !== false && !!this.ctx && typeof this.ctx.decodeAudioData === 'function' && typeof fetch === 'function';
    },

    _sampleStore() {
        if (!this._samples || this._samplesCtx !== this.ctx) {
            this._samples = {};
            this._samplesCtx = this.ctx;
            this._sampleQueue = [];
            this._sampleLoads = 0;
        }
        return this._samples;
    },

    /** The state of a bank key: null (never asked) | { state: 'loading'|'ready'|'failed', buffers }. */
    sampleState(key) {
        const S = this._sampleStore();
        return S[key] || null;
    },

    /** Is this key decoded and ready to play? */
    sampleReady(key) {
        const s = this.sampleState(key);
        return !!(s && s.state === 'ready' && s.buffers.length);
    },

    /** Has this key failed to load (every file of it)? */
    sampleFailed(key) {
        const s = this.sampleState(key);
        return !!(s && s.state === 'failed');
    },

    /** Fetch and decode a bank key (its every variant). → Promise of the entry; never rejects. */
    loadSample(key) {
        const def = SAMPLE_BANK[key];
        if (!def || !this.recordedOn()) return Promise.resolve(null);
        const S = this._sampleStore();
        if (S[key]) return S[key].promise || Promise.resolve(S[key]);
        const entry = S[key] = { state: 'loading', buffers: [], bytes: 0, lastUse: Date.now(), promise: null };
        const ctx = this._decodeCtx(decodeRateFor(key)) || this.ctx;
        entry.promise = Promise.all(def.files.map(f => this._fetchDecode(ctx, SAMPLE_BASE + f).then(b => {
            if (b) { entry.buffers.push(b); entry.bytes += b.length * b.numberOfChannels * 4; }
        }))).then(() => {
            entry.state = entry.buffers.length ? 'ready' : 'failed';
            if (entry.state === 'failed') this._logOnce(`audio: no recording for '${key}' (${def.files[0]}) — synthesized sound kept`);
            entry.promise = null;
            return entry;
        });
        return entry.promise;
    },

    /** Load several keys (in the background). */
    preloadSamples(keys) {
        for (const k of keys || []) this.loadSample(k);
    },

    preloadCoreSamples() {
        if (this._corePreloaded || !this.recordedOn()) return;
        this._corePreloaded = true;
        this.preloadSamples(CORE_SAMPLES);
    },

    /**
     * A context that decodes at `rate` (an OfflineAudioContext: its buffers play in the live
     * context, resampled as they play), or null to decode at the live context's own rate.
     */
    _decodeCtx(rate) {
        if (!rate || !this.ctx || (this.ctx.sampleRate && this.ctx.sampleRate <= rate)) return null;
        this._decoders = this._decoders && this._decodersCtx === this.ctx ? this._decoders : {};
        this._decodersCtx = this.ctx;
        if (this._decoders[rate] !== undefined) return this._decoders[rate];
        let d = null;
        try {
            const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
                : (typeof window !== 'undefined' && window.webkitOfflineAudioContext) || null;
            if (OAC) d = new OAC(1, 1, rate);
            if (d && typeof d.decodeAudioData !== 'function') d = null;
        } catch (_) {
            d = null;
        }
        this._decoders[rate] = d;
        return d;
    },

    /** One file: fetch (a few at a time) → decodeAudioData. → AudioBuffer or null. */
    _fetchDecode(ctx, url) {
        return new Promise((resolve) => {
            const run = () => {
                this._sampleLoads++;
                const done = (b) => {
                    this._sampleLoads--;
                    const next = this._sampleQueue.shift();
                    if (next) next();
                    resolve(b || null);
                };
                fetch(url).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.arrayBuffer();
                }).then(ab => new Promise((res, rej) => {
                    // (the promise form, with the callback form for older engines)
                    const p = ctx.decodeAudioData(ab, res, rej);
                    if (p && typeof p.then === 'function') p.then(res, rej);
                })).then(done, () => done(null));
            };
            if (this._sampleLoads < MAX_LOADS) run();
            else this._sampleQueue.push(run);
        });
    },

    /**
     * Play a bank key once. opts: { gain (×), rate (×), bus: 'sfx'|'ambience'|AudioNode,
     * lowpass (Hz), delay (s), pan (-1..1) }. → true when it played; false (and the file
     * is fetched for next time) when it isn't decoded yet or failed.
     */
    playSample(key, opts = {}) {
        try {
            const def = SAMPLE_BANK[key];
            if (!def || !this.recordedOn() || this.muted) return false;
            const s = this.sampleState(key);
            if (!s) { this.loadSample(key); return false; }
            if (s.state !== 'ready' || !s.buffers.length) return false;
            const ctx = this.ctx;
            const gain = (Number.isFinite(def.gain) ? def.gain : 0.5) * (Number.isFinite(opts.gain) ? opts.gain : 1);
            if (gain <= 0.001) return true;
            s.lastUse = Date.now();
            const buf = s.buffers.length > 1 ? s.buffers[this._pickIndex(key, s.buffers.length)] : s.buffers[0];
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const [lo, hi] = def.rate || [1, 1];
            const rate = (lo + Math.random() * (hi - lo)) * (Number.isFinite(opts.rate) ? opts.rate : 1);
            if (src.playbackRate) src.playbackRate.value = rate;
            const g = ctx.createGain();
            g.gain.value = gain;
            let head = src;
            if (opts.lowpass && typeof ctx.createBiquadFilter === 'function') {
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = opts.lowpass;
                head.connect(lp);
                head = lp;
            }
            if (Number.isFinite(opts.pan) && opts.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
                const p = ctx.createStereoPanner();
                p.pan.value = Math.max(-1, Math.min(1, opts.pan));
                head.connect(p);
                head = p;
            }
            head.connect(g);
            const bus = opts.bus && typeof opts.bus === 'object' ? opts.bus
                : opts.bus === 'ambience' ? this.ambienceGain : this.sfxGain;
            g.connect(bus || this.masterGain);
            src.start(ctx.currentTime + Math.max(0, Number(opts.delay) || 0));
            this._lastSample = { key, at: Date.now(), gain: Math.round(gain * 1000) / 1000 };
            return true;
        } catch (_) {
            return false;
        }
    },

    /** A variant, not the same one twice running. */
    _pickIndex(key, n) {
        this._lastPick = this._lastPick || {};
        let i = Math.floor(Math.random() * n);
        if (n > 1 && i === this._lastPick[key]) i = (i + 1) % n;
        this._lastPick[key] = i;
        return i;
    },

    /**
     * Where the listener stands on the street map (ui/soundscape.js sets it each frame), so a
     * sound with a place (playSFX(kind, { q, r })) plays as loud as it is near.
     */
    setListener(q, r) {
        if (q == null || r == null) { this.listener = null; return; }
        this.listener = { q: Number(q), r: Number(r) };
    },

    /** The gain for a sound at (q, r) cells, by the listener (1 when there's no listener or place). */
    _placeGain(opts) {
        if (!opts || opts.q == null || opts.r == null || !this.listener) return 1;
        const d = Math.hypot(Number(opts.q) - this.listener.q, Number(opts.r) - this.listener.r);
        return distanceGain(d, Number.isFinite(opts.near) ? opts.near : 2, Number.isFinite(opts.far) ? opts.far : 16);
    },

    /** Let go of decoded loops not heard for a while (they can be large). */
    evictIdleSamples(now = Date.now(), keep = null) {
        const S = this._sampleStore();
        for (const [key, s] of Object.entries(S)) {
            const def = SAMPLE_BANK[key];
            if (!def || !def.loop || s.state !== 'ready') continue;
            if (keep && keep.has(key)) continue;
            if (now - (s.lastUse || 0) > IDLE_EVICT_MS) delete S[key];
        }
    },

    /** QA: what's loaded. */
    sampleStats() {
        const S = this._sampleStore();
        const out = { ready: [], loading: [], failed: [], bytes: 0, bedBytes: 0, last: this._lastSample || null, rates: {} };
        for (const [key, s] of Object.entries(S)) {
            out[s.state] && out[s.state].push(key);
            out.bytes += s.bytes || 0;
            if (SAMPLE_BANK[key] && SAMPLE_BANK[key].loop) out.bedBytes += s.bytes || 0;
            if (s.buffers && s.buffers[0]) out.rates[key] = s.buffers[0].sampleRate;
        }
        out.bedMb = Math.round(out.bedBytes / 1048576 * 10) / 10;
        out.mb = Math.round(out.bytes / 1048576 * 10) / 10;
        return out;
    },

    _logOnce(msg) {
        this._logged = this._logged || new Set();
        if (this._logged.has(msg)) return;
        this._logged.add(msg);
        try { console.info(msg); } catch (_) { /* no console */ }
    },
});
