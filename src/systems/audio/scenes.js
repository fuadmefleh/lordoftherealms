// AudioManager — scenes methods.
import { AudioManager } from './core.js';
import {  } from './_imports.js';

Object.assign(AudioManager.prototype, {
    // ── Initialisation ──────────────────────────
    /**
     * Create the AudioContext on first user gesture (required by browsers).
     */
    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Master → destination
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
            this.masterGain.connect(this.ctx.destination);

            // Music bus
            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = this.musicVolume;
            this.musicGain.connect(this.masterGain);

            // SFX bus
            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = this.sfxVolume;
            this.sfxGain.connect(this.masterGain);

            // Ambience bus
            this.ambienceGain = this.ctx.createGain();
            this.ambienceGain.gain.value = this.ambienceVolume;
            this.ambienceGain.connect(this.masterGain);

            this.initialized = true;
        } catch (e) {
            console.warn('AudioManager: Web Audio API not available', e);
        }
    },

    /** Ensure context is running (may be suspended until gesture). */
    _resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },

    // ── Helpers ─────────────────────────────────
    /** MIDI note → frequency */
    _mtof(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    },

    /** Pick a random element from an array */
    _pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    /** Pick a note from a scale given a root MIDI note and an octave range */
    _scaleNote(root, scale, octaveRange = 2) {
        const intervals = this.scales[scale] || this.scales.aeolian;
        const interval = this._pick(intervals);
        const octave = Math.floor(Math.random() * octaveRange);
        return root + interval + octave * 12;
    },

    /** Create and return an oscillator (auto-tracked for cleanup) */
    _osc(type, freq, gainVal, dest, list) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.value = gainVal;
        osc.connect(g);
        g.connect(dest || this.musicGain);
        osc.start();
        const entry = { osc, gain: g };
        (list || this.musicNodes).push(entry);
        return entry;
    },

    /** Stop and remove nodes from a list */
    _stopNodes(list, fadeTime = 2) {
        const now = this.ctx.currentTime;
        for (const n of list) {
            try {
                n.gain.gain.setValueAtTime(n.gain.gain.value, now);
                n.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
                n.osc.stop(now + fadeTime + 0.1);
            } catch (_) { /* already stopped */ }
        }
        list.length = 0;
    },

    /** Create a simple convolver-style reverb using feedback delay */
    _createReverb(dest) {
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.15;
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.3;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2500;

        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay);
        delay.connect(dest);

        return delay; // connect source → this delay node
    },

    // ── Scene Music ─────────────────────────────
    /**
     * Switch to a music scene. Crossfades between scenes.
     * @param {'title'|'explore'|'town'|'combat'|'night'|'ocean'|'desert'|'snow'|'forest'|'none'} scene
     */
    setScene(scene) {
        if (!this.initialized) this.init();
        if (!this.ctx) return;
        if (scene === this.currentScene && this.isPlaying) return;

        this._resume();
        this._stopMusic();
        this.currentScene = scene;

        if (scene === 'none') return;

        this.isPlaying = true;
        this._startScene(scene);
    },

    _stopMusic() {
        if (this.musicLoopTimer) {
            clearTimeout(this.musicLoopTimer);
            this.musicLoopTimer = null;
        }
        this._stopNodes(this.musicNodes, 2.5);
        this._stopNodes(this.ambienceNodes, 3);
        this.isPlaying = false;
    },

    _startScene(scene) {
        switch (scene) {
            case 'title':    this._playTitle(); break;
            case 'explore':  this._playExplore(); break;
            case 'town':     this._playTown(); break;
            case 'combat':   this._playCombat(); break;
            case 'night':    this._playNight(); break;
            case 'ocean':    this._playOcean(); break;
            case 'desert':   this._playDesert(); break;
            case 'snow':     this._playSnow(); break;
            case 'forest':   this._playForest(); break;
            default:         this._playExplore(); break;
        }
    },

    // ── Title Screen — Majestic pad + slow arpeggios ──
    _playTitle() {
        const root = 48; // C3
        const reverb = this._createReverb(this.musicGain);

        // Deep drone pad
        this._osc('sine', this._mtof(root), 0.12, this.musicGain);
        this._osc('sine', this._mtof(root + 12), 0.06, this.musicGain);

        // Warm fifth drone
        const fifth = this._osc('triangle', this._mtof(root + 7), 0.04, this.musicGain);

        // Slow shimmering high pad
        const shimmer = this._osc('sine', this._mtof(root + 24), 0.025, reverb);

        // LFO for shimmer vibrato
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.3;
        lfoGain.gain.value = 2;
        lfo.connect(lfoGain);
        lfoGain.connect(shimmer.osc.frequency);
        lfo.start();
        this.musicNodes.push({ osc: lfo, gain: lfoGain });

        // Melodic arpeggios
        this._titleArpeggio(root, reverb);
    },

    _titleArpeggio(root, reverb) {
        if (this.currentScene !== 'title' || !this.isPlaying) return;

        const scale = this.scales.dorian;
        const notes = [0, 4, 7, 12, 7, 4].map(i => {
            const closest = scale.reduce((a, b) => Math.abs(b - (i % 12)) < Math.abs(a - (i % 12)) ? b : a);
            return root + closest + Math.floor(i / 12) * 12;
        });

        const now = this.ctx.currentTime;
        notes.forEach((note, i) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = this._mtof(note + 12);
            g.gain.setValueAtTime(0, now + i * 0.6);
            g.gain.linearRampToValueAtTime(0.04, now + i * 0.6 + 0.08);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.6 + 1.5);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + i * 0.6);
            osc.stop(now + i * 0.6 + 2);
        });

        this.musicLoopTimer = setTimeout(() => this._titleArpeggio(root, reverb), notes.length * 600 + 2000);
    },

    // ── Explore — Calm ambient with gentle melody ──
    _playExplore() {
        const root = 50; // D3
        const reverb = this._createReverb(this.musicGain);

        // Foundation drone
        this._osc('sine', this._mtof(root), 0.08, this.musicGain);
        this._osc('sine', this._mtof(root - 12), 0.04, this.musicGain);

        // Gentle fifth
        this._osc('triangle', this._mtof(root + 7), 0.025, reverb);

        // Ambient melody loop
        this._exploreMelody(root, reverb);

        // Wind-like noise ambience
        this._windAmbience(0.03);
    },

    _exploreMelody(root, reverb) {
        if (this.currentScene !== 'explore' || !this.isPlaying) return;

        const numNotes = 4 + Math.floor(Math.random() * 4);
        const now = this.ctx.currentTime;
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'pentatonic', 2);
            const dur = 0.8 + Math.random() * 1.2;
            const gap = 0.3 + Math.random() * 0.8;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = Math.random() > 0.5 ? 'triangle' : 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.035, now + t + 0.1);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        const nextLoop = (t + 2 + Math.random() * 3) * 1000;
        this.musicLoopTimer = setTimeout(() => this._exploreMelody(root, reverb), nextLoop);
    },

    // ── Town — Warmer, lively feel ──
    _playTown() {
        const root = 53; // F3
        const reverb = this._createReverb(this.musicGain);

        // Warm major-ish drone
        this._osc('sine', this._mtof(root), 0.07, this.musicGain);
        this._osc('triangle', this._mtof(root + 4), 0.03, this.musicGain);  // major third
        this._osc('sine', this._mtof(root + 7), 0.025, reverb);            // fifth

        // Plucky melody
        this._townMelody(root, reverb);
    },

    _townMelody(root, reverb) {
        if (this.currentScene !== 'town' || !this.isPlaying) return;

        const numNotes = 6 + Math.floor(Math.random() * 5);
        const now = this.ctx.currentTime;
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'mixolydian', 2);
            const dur = 0.3 + Math.random() * 0.6;
            const gap = 0.15 + Math.random() * 0.4;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = this._mtof(note);
            // Plucky envelope
            g.gain.setValueAtTime(0.05, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._townMelody(root, reverb), (t + 1.5 + Math.random() * 2) * 1000);
    },

    // ── Combat — Tense, rhythmic ──
    _playCombat() {
        const root = 45; // A2

        // Menacing low drone
        this._osc('sawtooth', this._mtof(root), 0.04, this.musicGain);
        this._osc('sine', this._mtof(root), 0.09, this.musicGain);

        // Tritone tension
        this._osc('sine', this._mtof(root + 6), 0.03, this.musicGain);

        // Rhythmic pulse
        this._combatPulse(root);
    },

    _combatPulse(root) {
        if (this.currentScene !== 'combat' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const bpm = 90 + Math.floor(Math.random() * 30);
        const beatDur = 60 / bpm;

        for (let i = 0; i < 8; i++) {
            // Percussion-like hit
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'square';
            const freq = i % 2 === 0 ? this._mtof(root) : this._mtof(root + 7);
            osc.frequency.setValueAtTime(freq, now + i * beatDur);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + i * beatDur + 0.1);
            g.gain.setValueAtTime(0.06, now + i * beatDur);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * beatDur + 0.15);
            osc.connect(g);
            g.connect(this.musicGain);
            osc.start(now + i * beatDur);
            osc.stop(now + i * beatDur + 0.2);

            // Accent hits on certain beats
            if (i === 0 || i === 3 || i === 6) {
                const accent = this.ctx.createOscillator();
                const ag = this.ctx.createGain();
                accent.type = 'triangle';
                accent.frequency.value = this._mtof(this._scaleNote(root + 12, 'phrygian', 1));
                ag.gain.setValueAtTime(0.04, now + i * beatDur);
                ag.gain.exponentialRampToValueAtTime(0.001, now + i * beatDur + 0.4);
                accent.connect(ag);
                ag.connect(this.musicGain);
                accent.start(now + i * beatDur);
                accent.stop(now + i * beatDur + 0.5);
            }
        }

        this.musicLoopTimer = setTimeout(() => this._combatPulse(root), 8 * beatDur * 1000 + 200);
    },

    // ── Night — Dark, mysterious ──
    _playNight() {
        const root = 47; // B2
        const reverb = this._createReverb(this.musicGain);

        // Very low, dark drone
        this._osc('sine', this._mtof(root - 12), 0.06, this.musicGain);
        this._osc('sine', this._mtof(root), 0.05, reverb);

        // Minor second tension (subtle)
        this._osc('sine', this._mtof(root + 1), 0.015, reverb);

        // Sparse high notes like distant bells
        this._nightBells(root, reverb);

        // Cricket-like ambient
        this._cricketAmbience(0.015);
    },

    _nightBells(root, reverb) {
        if (this.currentScene !== 'night' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const numNotes = 2 + Math.floor(Math.random() * 3);
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 24, 'aeolian', 2);
            const dur = 1.5 + Math.random() * 2;
            const gap = 1 + Math.random() * 3;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.025, now + t + 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._nightBells(root, reverb), (t + 3 + Math.random() * 5) * 1000);
    },

    // ── Ocean — Waves and seagull-like tones ──
    _playOcean() {
        const root = 52; // E3
        const reverb = this._createReverb(this.musicGain);

        // Deep ocean drone
        this._osc('sine', this._mtof(root - 12), 0.06, this.musicGain);
        this._osc('sine', this._mtof(root), 0.04, reverb);

        // Gentle wave-like LFO on volume
        const waveDrone = this._osc('triangle', this._mtof(root + 7), 0.0, reverb);
        const waveLfo = this.ctx.createOscillator();
        const waveLfoG = this.ctx.createGain();
        waveLfo.type = 'sine';
        waveLfo.frequency.value = 0.08;  // very slow "wave"
        waveLfoG.gain.value = 0.03;
        waveLfo.connect(waveLfoG);
        waveLfoG.connect(waveDrone.gain.gain);
        waveDrone.gain.gain.value = 0.03;
        waveLfo.start();
        this.musicNodes.push({ osc: waveLfo, gain: waveLfoG });

        // Sparse melody
        this._oceanMelody(root, reverb);

        // Wave noise ambience
        this._waveAmbience(0.035);
    },

    _oceanMelody(root, reverb) {
        if (this.currentScene !== 'ocean' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const numNotes = 3 + Math.floor(Math.random() * 3);
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'pentatonic', 2);
            const dur = 1.2 + Math.random() * 1.5;
            const gap = 0.5 + Math.random() * 1.5;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.03, now + t + 0.15);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._oceanMelody(root, reverb), (t + 2 + Math.random() * 4) * 1000);
    },

    // ── Desert — Dry, exotic ──
    _playDesert() {
        const root = 50; // D3
        const reverb = this._createReverb(this.musicGain);

        // Warm low drone
        this._osc('sine', this._mtof(root), 0.07, this.musicGain);

        // Phrygian flavor
        this._osc('triangle', this._mtof(root + 1), 0.02, reverb);  // flat 2nd
        this._osc('sine', this._mtof(root + 7), 0.025, reverb);

        // Exotic melody
        this._desertMelody(root, reverb);

        // Wind
        this._windAmbience(0.025);
    },

    _desertMelody(root, reverb) {
        if (this.currentScene !== 'desert' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const numNotes = 5 + Math.floor(Math.random() * 4);
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'phrygian', 2);
            const dur = 0.4 + Math.random() * 0.8;
            const gap = 0.2 + Math.random() * 0.6;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = i % 3 === 0 ? 'triangle' : 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.035, now + t + 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._desertMelody(root, reverb), (t + 2 + Math.random() * 3) * 1000);
    },

    // ── Snow — Cold, ethereal ──
    _playSnow() {
        const root = 55; // G3
        const reverb = this._createReverb(this.musicGain);

        // High, cold drone
        this._osc('sine', this._mtof(root), 0.06, reverb);
        this._osc('sine', this._mtof(root + 12), 0.03, reverb);

        // Open fifth — cold/hollow
        this._osc('triangle', this._mtof(root + 7), 0.02, reverb);

        // Sparse crystalline notes
        this._snowMelody(root, reverb);

        // Gentle wind
        this._windAmbience(0.02);
    },

    _snowMelody(root, reverb) {
        if (this.currentScene !== 'snow' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const numNotes = 3 + Math.floor(Math.random() * 3);
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'pentatonic', 2);
            const dur = 1.5 + Math.random() * 2;
            const gap = 1.5 + Math.random() * 3;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.02, now + t + 0.3);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._snowMelody(root, reverb), (t + 4 + Math.random() * 4) * 1000);
    },

    // ── Forest — Organic rustling and birdsong ──
    _playForest() {
        const root = 52; // E3
        const reverb = this._createReverb(this.musicGain);

        // Earthy drone
        this._osc('sine', this._mtof(root - 12), 0.05, this.musicGain);
        this._osc('sine', this._mtof(root), 0.04, reverb);
        this._osc('triangle', this._mtof(root + 4), 0.015, reverb);

        // Melody
        this._forestMelody(root, reverb);

        // Birdsong-like ambience
        this._birdAmbience(0.02);

        // Light wind
        this._windAmbience(0.015);
    },

    _forestMelody(root, reverb) {
        if (this.currentScene !== 'forest' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const numNotes = 4 + Math.floor(Math.random() * 4);
        let t = 0;

        for (let i = 0; i < numNotes; i++) {
            const note = this._scaleNote(root + 12, 'dorian', 2);
            const dur = 0.6 + Math.random() * 1;
            const gap = 0.4 + Math.random() * 1;

            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = Math.random() > 0.3 ? 'triangle' : 'sine';
            osc.frequency.value = this._mtof(note);
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(0.03, now + t + 0.08);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
            osc.connect(g);
            g.connect(reverb || this.musicGain);
            osc.start(now + t);
            osc.stop(now + t + dur + 0.1);

            t += dur + gap;
        }

        this.musicLoopTimer = setTimeout(() => this._forestMelody(root, reverb), (t + 2 + Math.random() * 3) * 1000);
    },
});
