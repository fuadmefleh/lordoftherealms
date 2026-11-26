// AudioManager — controls methods.
import { AudioManager } from './core.js';
import {  } from './_imports.js';
import { moodOfScene } from './music.js';

Object.assign(AudioManager.prototype, {
    // ── Volume & Mute Controls ──────────────────
    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Math.min(1, v));
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    },

    setMusicVolume(v) {
        this.musicVolume = Math.max(0, Math.min(1, v));
        if (this.musicGain) {
            // (ducked while a room plays indoors: audio/interior.js)
            this.musicGain.gain.setValueAtTime(this.musicVolume * this._duckOf('music'), this.ctx.currentTime);
        }
        this._savePreferences();
    },

    setSfxVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
        if (this.sfxGain) {
            this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    },

    setAmbienceVolume(v) {
        this.ambienceVolume = Math.max(0, Math.min(1, v));
        if (this.ambienceGain) {
            this.ambienceGain.gain.setValueAtTime(this.ambienceVolume * this._duckOf('ambience'), this.ctx.currentTime);
        }
        // the room indoors plays at the ambience volume too
        this._syncInteriorBus();
        this._savePreferences();
    },

    toggleMute() {
        this.muted = !this.muted;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
        }
        this._savePreferences();
        return this.muted;
    },

    // ── Terrain-Aware Scene Selection ───────────
    /**
     * Determine and switch the music scene based on game state.
     * Call this when the player moves, enters a town, starts combat, etc.
     */
    updateSceneFromGameState(game) {
        if (!game || !game.world || !game.player) return;

        const player = game.player;
        const tile = game.world.getTile(player.q, player.r);
        if (!tile) return;

        // Combat overrides everything
        if (player.inCombat) {
            this.setScene('combat');
            return;
        }

        // Check if in a pop center (town/city)
        if (tile.popCenter) {
            this.setScene('town');
            return;
        }

        // Terrain-based scene
        const terrain = (tile.type || '').toLowerCase();

        if (['deep_ocean', 'ocean', 'coast', 'sea'].includes(terrain)) {
            this.setScene('ocean');
        } else if (['desert', 'savanna'].includes(terrain)) {
            this.setScene('desert');
        } else if (['snow', 'snow_peak', 'ice', 'tundra'].includes(terrain)) {
            this.setScene('snow');
        } else if (['boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'woodland'].includes(terrain)) {
            this.setScene('forest');
        } else {
            // Check time of day if available
            if (game.world.currentSeason === 'winter') {
                this.setScene('snow');
            } else {
                this.setScene('explore');
            }
        }
    },

    // ── Persistence ─────────────────────────────
    _savePreferences() {
        try {
            localStorage.setItem('lord_of_realms_audio', JSON.stringify({
                masterVolume: this.masterVolume,
                musicVolume: this.musicVolume,
                sfxVolume: this.sfxVolume,
                ambienceVolume: this.ambienceVolume,
                muted: this.muted,
                recordedSound: this.recordedSound !== false,
            }));
        } catch (_) { /* ignore */ }
    },

    _loadPreferences() {
        try {
            const json = localStorage.getItem('lord_of_realms_audio');
            if (json) {
                const prefs = JSON.parse(json);
                this.masterVolume = prefs.masterVolume ?? 0.5;
                this.musicVolume = prefs.musicVolume ?? 0.6;
                this.sfxVolume = prefs.sfxVolume ?? 0.7;
                this.ambienceVolume = prefs.ambienceVolume ?? 0.4;
                this.muted = prefs.muted ?? false;
                this.recordedSound = prefs.recordedSound ?? true;
            }
        } catch (_) { /* ignore */ }
    },

    /**
     * Recorded sound on or off (Settings → Sound). Off: the music and ambience recordings stop
     * and the synthesized scene music and sounds play as before; on: the recordings come back.
     */
    setRecordedSound(on) {
        on = !!on;
        if ((this.recordedSound !== false) === on) return;
        this.recordedSound = on;
        this._savePreferences();
        if (!this.ctx) return;
        const scene = this.currentScene;
        if (!on) {
            this.stopRecordedMusic();
            this.stopAmbienceBeds();
            if (this._rainWant) { const w = this._rainWant; this._rainWant = null; this.setRain(w.level, w.muffled); }
            if (scene && scene !== 'none') { this.isPlaying = false; this.currentScene = 'none'; this.setScene(scene); }
        } else {
            this._stopMusic();
            if (this._rain) this._setRainSynth(0);
            if (scene && scene !== 'none') this.setMusicMood(moodOfScene(scene));
        }
    },

    /** Clean up everything */
    destroy() {
        this.stopRecordedMusic();
        this.stopAmbienceBeds();
        this._stopMusic();
        this.setInteriorAmbience(null);
        if (this.ctx) {
            this.ctx.close();
        }
        this.initialized = false;
    },
});
