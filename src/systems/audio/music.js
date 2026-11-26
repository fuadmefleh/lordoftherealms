// AudioManager — recorded music: a track for the mood, then a while of silence, then another.
//
// setMusicMood(mood) — 'title' | 'explore' | 'town' | 'court' | 'battle' | 'night' | 'none'.
// A track of that mood plays through once (streamed: an <audio> element into the music bus,
// so the music volume, the indoor duck and mute rule it), then the music rests — a minute or
// two of only the world's own sound (MUSIC_REST) — before another track of the mood, never
// the same one twice running. The title and battle don't rest long. A change of mood fades
// the track out (FADE_OUT s) and the new mood's music comes in after a short breath
// (battle at once). Tracks that fail to load are skipped; when a mood has none left, the
// old synthesized scene music plays instead (audio/scenes.js) — as it does wherever there
// is no <audio> (the specs, a locked-down webview).
//
// QA from the console: audioManager.musicState() → { mood, track, phase, restLeft }.
import { AudioManager } from './core.js';
import { SAMPLE_BASE } from './samples.js';

/** mood → the tracks (under assets/audio/music/). */
export const MUSIC_TRACKS = {
    title: ['music/title_exploration.ogg'],
    explore: ['music/road_bards_tale.ogg', 'music/road_harvest_season.ogg', 'music/title_exploration.ogg'],
    town: ['music/town_minstrel_dance.ogg', 'music/town_market_day.ogg', 'music/town_old_tower_inn.ogg'],
    court: ['music/court_kings_feast.ogg', 'music/town_old_tower_inn.ogg'],
    battle: ['music/battle.ogg'],
    night: ['music/night_rising_moon.ogg'],
};

/** Seconds of silence after a track, [min, max] by mood (the first track of a mood comes in after `enter`). */
export const MUSIC_REST = {
    title: { after: [3, 6], enter: [0.5, 1] },
    explore: { after: [70, 160], enter: [4, 10] },
    town: { after: [50, 120], enter: [3, 7] },
    court: { after: [40, 90], enter: [2, 5] },
    battle: { after: [1, 3], enter: [0, 0.3] },
    night: { after: [90, 200], enter: [6, 14] },
};

const FADE_IN = 2.5;
const FADE_OUT = 3;
const TRACK_LEVEL = 0.8;   // a track's own gain into the music bus

/** The synthesized scene a mood falls back to (audio/scenes.js). */
const SYNTH_SCENE = { title: 'title', explore: 'explore', town: 'town', court: 'town', battle: 'combat', night: 'night' };

/** The mood a synthesized scene name stands for (setScene's names). */
export function moodOfScene(scene) {
    switch (scene) {
        case 'title': return 'title';
        case 'town': return 'town';
        case 'combat': return 'battle';
        case 'night': return 'night';
        case 'none': return 'none';
        default: return 'explore';   // explore, ocean, desert, snow, forest
    }
}

const _between = ([a, b]) => a + Math.random() * (b - a);

Object.assign(AudioManager.prototype, {
    /** Can recorded music play here? (an <audio> element and a context to route it through). */
    recordedMusicOn() {
        return this.recordedOn() && typeof Audio === 'function' && typeof this.ctx.createMediaElementSource === 'function';
    },

    _musicDir() {
        if (!this._music) this._music = { mood: 'none', cur: null, phase: 'idle', timer: null, restUntil: 0, last: {}, failed: new Set(), fallback: null };
        return this._music;
    },

    /**
     * The mood the music should be in. → true when the recorded music took it (false: the
     * caller plays the synthesized scene instead).
     */
    setMusicMood(mood) {
        try {
            if (!this.initialized) this.init();
            if (!this.ctx) return false;
            const M = this._musicDir();
            if (!this.recordedMusicOn()) return false;
            mood = MUSIC_TRACKS[mood] || mood === 'none' ? mood : 'explore';
            if (mood === M.mood && !M.fallback) return true;
            this._resume();
            const prev = M.mood;
            M.mood = mood;
            M.fallback = null;
            // (any synthesized scene music still sounding gives way)
            if (this.musicNodes && this.musicNodes.length) this._stopNodes(this.musicNodes, 2);
            if (this.musicLoopTimer) { clearTimeout(this.musicLoopTimer); this.musicLoopTimer = null; }
            this._fadeOutTrack(M);
            clearTimeout(M.timer);
            if (mood === 'none') { M.phase = 'idle'; return true; }
            // a breath before the new mood's music (none into battle; a quicker one out of it)
            const R = MUSIC_REST[mood] || MUSIC_REST.explore;
            let wait = _between(R.enter);
            if (prev === 'battle' && mood !== 'battle') wait = Math.min(wait, 3);
            this._musicRest(M, wait);
            return true;
        } catch (_) {
            return false;
        }
    },

    _musicRest(M, secs) {
        M.phase = 'rest';
        M.restUntil = Date.now() + secs * 1000;
        clearTimeout(M.timer);
        M.timer = setTimeout(() => this._playNextTrack(M), secs * 1000);
    },

    _playNextTrack(M) {
        try {
            if (M.mood === 'none' || !this.ctx) return;
            const all = MUSIC_TRACKS[M.mood] || [];
            const ok = all.filter(t => !M.failed.has(t));
            if (!ok.length) { this._musicFallback(M); return; }
            let pick = ok[Math.floor(Math.random() * ok.length)];
            if (ok.length > 1 && pick === M.last[M.mood]) pick = ok[(ok.indexOf(pick) + 1) % ok.length];
            M.last[M.mood] = pick;
            const mood = M.mood;
            const el = new Audio();
            el.preload = 'auto';
            el.src = SAMPLE_BASE + pick;
            const src = this.ctx.createMediaElementSource(el);
            const g = this.ctx.createGain();
            g.gain.value = 0;
            src.connect(g);
            g.connect(this.musicGain);
            const T = { el, src, g, file: pick, mood, started: Date.now() };
            M.cur = T;
            M.phase = 'playing';
            el.addEventListener('ended', () => {
                if (M.cur !== T) return;
                this._dropTrack(T);
                M.cur = null;
                const R = MUSIC_REST[mood] || MUSIC_REST.explore;
                this._musicRest(M, _between(R.after));
            });
            el.addEventListener('error', () => {
                M.failed.add(pick);
                this._logOnce(`audio: music '${pick}' did not load — skipped`);
                if (M.cur !== T) return;
                this._dropTrack(T);
                M.cur = null;
                this._musicRest(M, 0.5);
            });
            const p = el.play();
            if (p && typeof p.catch === 'function') p.catch(() => {
                // (autoplay held back until a click: tried again shortly)
                if (M.cur !== T) return;
                this._dropTrack(T);
                M.cur = null;
                this._musicRest(M, 2);
            });
            g.gain.setTargetAtTime(TRACK_LEVEL, this.ctx.currentTime, FADE_IN / 3);
        } catch (_) {
            this._musicFallback(M);
        }
    },

    _fadeOutTrack(M) {
        const T = M.cur;
        if (!T) return;
        M.cur = null;
        try { T.g.gain.setTargetAtTime(0, this.ctx.currentTime, FADE_OUT / 3); } catch (_) { /* gone */ }
        setTimeout(() => this._dropTrack(T), FADE_OUT * 1000 + 200);
    },

    _dropTrack(T) {
        try { T.el.pause(); } catch (_) { /* gone */ }
        try { T.src.disconnect(); T.g.disconnect(); } catch (_) { /* gone */ }
        try { T.el.removeAttribute('src'); T.el.load(); } catch (_) { /* gone */ }
    },

    /** No recorded track left for this mood: the synthesized scene plays it. */
    _musicFallback(M) {
        const scene = SYNTH_SCENE[M.mood] || 'explore';
        M.fallback = scene;
        M.phase = 'synth';
        try {
            this._stopNodes(this.musicNodes, 1);
            this.currentScene = scene;
            this.isPlaying = true;
            this._startScene(scene);
        } catch (_) { /* best-effort */ }
    },

    /** Stop the recorded music now (destroy, a new context). */
    stopRecordedMusic() {
        const M = this._music;
        if (!M) return;
        clearTimeout(M.timer);
        if (M.cur) { this._dropTrack(M.cur); M.cur = null; }
        M.mood = 'none';
        M.phase = 'idle';
    },

    /** QA: the music now. */
    musicState() {
        const M = this._musicDir();
        return {
            mood: M.mood,
            phase: M.phase,
            track: M.cur ? M.cur.file : null,
            time: M.cur && M.cur.el ? Math.round(M.cur.el.currentTime) : null,
            restLeft: M.phase === 'rest' ? Math.max(0, Math.round((M.restUntil - Date.now()) / 1000)) : 0,
            failed: [...M.failed],
            fallback: M.fallback,
        };
    },

    /** QA: skip the rest and play the mood's next track now. */
    musicNext() {
        const M = this._musicDir();
        if (M.cur) this._fadeOutTrack(M);
        clearTimeout(M.timer);
        this._playNextTrack(M);
        return this.musicState();
    },
});
