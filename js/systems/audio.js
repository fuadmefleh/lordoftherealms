// ============================================
// AUDIO — Procedural ambient music & SFX
// Uses Web Audio API to generate atmospheric
// medieval-fantasy soundscapes without any
// external audio files.
// ============================================

class AudioManager {
    constructor() {
        this.ctx = null;           // AudioContext (created on first user interaction)
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.ambienceGain = null;

        // Volume levels (0–1)
        this.masterVolume = 0.5;
        this.musicVolume = 0.6;
        this.sfxVolume = 0.7;
        this.ambienceVolume = 0.4;
        this.muted = false;

        // State
        this.currentScene = 'none';    // title | explore | town | combat | night | ocean
        this.musicNodes = [];          // active oscillators/gains for cleanup
        this.ambienceNodes = [];
        this.musicLoopTimer = null;
        this.isPlaying = false;
        this.initialized = false;

        // Musical scales (MIDI note numbers — pentatonic & modal for medieval feel)
        this.scales = {
            aeolian:     [0, 2, 3, 5, 7, 8, 10],   // natural minor
            dorian:      [0, 2, 3, 5, 7, 9, 10],    // medieval dorian
            pentatonic:  [0, 2, 4, 7, 9],            // peaceful
            phrygian:    [0, 1, 3, 5, 7, 8, 10],    // dark/exotic
            mixolydian:  [0, 2, 4, 5, 7, 9, 10],    // bright/heroic
        };

        // Load saved preferences
        this._loadPreferences();
    }

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
    }

    /** Ensure context is running (may be suspended until gesture). */
    _resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // ── Helpers ─────────────────────────────────

    /** MIDI note → frequency */
    _mtof(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    /** Pick a random element from an array */
    _pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    /** Pick a note from a scale given a root MIDI note and an octave range */
    _scaleNote(root, scale, octaveRange = 2) {
        const intervals = this.scales[scale] || this.scales.aeolian;
        const interval = this._pick(intervals);
        const octave = Math.floor(Math.random() * octaveRange);
        return root + interval + octave * 12;
    }

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
    }

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
    }

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
    }

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
    }

    _stopMusic() {
        if (this.musicLoopTimer) {
            clearTimeout(this.musicLoopTimer);
            this.musicLoopTimer = null;
        }
        this._stopNodes(this.musicNodes, 2.5);
        this._stopNodes(this.ambienceNodes, 3);
        this.isPlaying = false;
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    // ── Ambient Sound Generators ────────────────

    /** Filtered noise for wind effect */
    _windAmbience(volume) {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 2;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 400;
        filter.Q.value = 0.5;

        const g = this.ctx.createGain();
        g.gain.value = volume;

        // Slow volume modulation for wind gusts
        const lfo = this.ctx.createOscillator();
        const lfoG = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.1 + Math.random() * 0.1;
        lfoG.gain.value = volume * 0.5;
        lfo.connect(lfoG);
        lfoG.connect(g.gain);
        lfo.start();

        noise.connect(filter);
        filter.connect(g);
        g.connect(this.ambienceGain);
        noise.start();

        this.ambienceNodes.push({ osc: noise, gain: g });
        this.ambienceNodes.push({ osc: lfo, gain: lfoG });
    }

    /** Wave-like noise (bandpass filtered with slow modulation) */
    _waveAmbience(volume) {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 2;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 600;
        filter.Q.value = 1;

        // Slow "wave crash" modulation
        const lfo = this.ctx.createOscillator();
        const lfoG = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.06;
        lfoG.gain.value = volume * 0.8;
        lfo.connect(lfoG);

        const g = this.ctx.createGain();
        g.gain.value = volume;
        lfoG.connect(g.gain);

        noise.connect(filter);
        filter.connect(g);
        g.connect(this.ambienceGain);
        noise.start();
        lfo.start();

        this.ambienceNodes.push({ osc: noise, gain: g });
        this.ambienceNodes.push({ osc: lfo, gain: lfoG });
    }

    /** Chirp-like sounds for crickets */
    _cricketAmbience(volume) {
        if (!this.ctx) return;
        this._cricketLoop(volume);
    }

    _cricketLoop(volume) {
        if (this.currentScene !== 'night' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const chirps = 3 + Math.floor(Math.random() * 5);

        for (let i = 0; i < chirps; i++) {
            const t = Math.random() * 2;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 4000 + Math.random() * 2000;
            g.gain.setValueAtTime(0, now + t);
            g.gain.linearRampToValueAtTime(volume, now + t + 0.01);
            g.gain.linearRampToValueAtTime(0, now + t + 0.05);
            osc.connect(g);
            g.connect(this.ambienceGain);
            osc.start(now + t);
            osc.stop(now + t + 0.06);
        }

        setTimeout(() => this._cricketLoop(volume), 2000 + Math.random() * 3000);
    }

    /** High-pitched chirps for birdsong */
    _birdAmbience(volume) {
        if (!this.ctx) return;
        this._birdLoop(volume);
    }

    _birdLoop(volume) {
        if (this.currentScene !== 'forest' || !this.isPlaying) return;

        const now = this.ctx.currentTime;
        const calls = 1 + Math.floor(Math.random() * 3);

        for (let c = 0; c < calls; c++) {
            const t = Math.random() * 3;
            const baseFreq = 1800 + Math.random() * 2000;
            const tweetLen = 3 + Math.floor(Math.random() * 4);

            for (let i = 0; i < tweetLen; i++) {
                const osc = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                osc.type = 'sine';
                const freq = baseFreq + (Math.random() - 0.5) * 600;
                osc.frequency.setValueAtTime(freq, now + t + i * 0.08);
                osc.frequency.linearRampToValueAtTime(freq * (0.9 + Math.random() * 0.2), now + t + i * 0.08 + 0.06);
                g.gain.setValueAtTime(0, now + t + i * 0.08);
                g.gain.linearRampToValueAtTime(volume, now + t + i * 0.08 + 0.01);
                g.gain.linearRampToValueAtTime(0, now + t + i * 0.08 + 0.07);
                osc.connect(g);
                g.connect(this.ambienceGain);
                osc.start(now + t + i * 0.08);
                osc.stop(now + t + i * 0.08 + 0.08);
            }
        }

        setTimeout(() => this._birdLoop(volume), 3000 + Math.random() * 6000);
    }

    // ── Sound Effects ───────────────────────────

    /**
     * Play a short UI sound effect.
     * @param {'click'|'success'|'error'|'notify'|'turn'|'gold'|'combat_hit'|'level_up'|'build'|'sail'} type
     */
    playSFX(type) {
        if (!this.initialized) this.init();
        if (!this.ctx || this.muted) return;
        this._resume();

        switch (type) {
            case 'click':      this._sfxClick(); break;
            case 'success':    this._sfxSuccess(); break;
            case 'error':      this._sfxError(); break;
            case 'notify':     this._sfxNotify(); break;
            case 'turn':       this._sfxTurn(); break;
            case 'gold':       this._sfxGold(); break;
            case 'combat_hit': this._sfxCombatHit(); break;
            case 'level_up':   this._sfxLevelUp(); break;
            case 'build':      this._sfxBuild(); break;
            case 'sail':       this._sfxSail(); break;
        }
    }

    _sfxClick() {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.08);
        g.gain.setValueAtTime(0.15, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    _sfxSuccess() {
        const now = this.ctx.currentTime;
        [0, 0.1, 0.2].forEach((t, i) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = [523, 659, 784][i]; // C5-E5-G5
            g.gain.setValueAtTime(0.12, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.3);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.35);
        });
    }

    _sfxError() {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.2);
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.35);
    }

    _sfxNotify() {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.15);
        g.gain.setValueAtTime(0.1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.3);
    }

    _sfxTurn() {
        const now = this.ctx.currentTime;
        // Page turn sound: two short tones
        [0, 0.08].forEach((t, i) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = i === 0 ? 400 : 600;
            g.gain.setValueAtTime(0.1, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.15);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.2);
        });
    }

    _sfxGold() {
        const now = this.ctx.currentTime;
        // Coin clink
        [0, 0.06, 0.12].forEach((t) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 2000 + Math.random() * 1000;
            g.gain.setValueAtTime(0.08, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.08);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.1);
        });
    }

    _sfxCombatHit() {
        const now = this.ctx.currentTime;
        // Noise burst
        const bufferSize = this.ctx.sampleRate * 0.1;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 500;
        noise.connect(filter);
        filter.connect(g);
        g.connect(this.sfxGain);
        noise.start(now);
    }

    _sfxLevelUp() {
        const now = this.ctx.currentTime;
        // Rising arpeggio
        [0, 0.12, 0.24, 0.36].forEach((t, i) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = [440, 554, 659, 880][i];
            g.gain.setValueAtTime(0.12, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.4);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.5);
        });
    }

    _sfxBuild() {
        const now = this.ctx.currentTime;
        // Hammer strikes
        [0, 0.2, 0.35].forEach((t) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(300 + Math.random() * 100, now + t);
            osc.frequency.exponentialRampToValueAtTime(80, now + t + 0.08);
            g.gain.setValueAtTime(0.1, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.1);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.12);
        });
    }

    _sfxSail() {
        const now = this.ctx.currentTime;
        // Creaking + wind whoosh
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(350, now + 0.3);
        osc.frequency.linearRampToValueAtTime(180, now + 0.6);
        g.gain.setValueAtTime(0.08, now);
        g.gain.linearRampToValueAtTime(0.04, now + 0.3);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.65);
    }

    // ── Volume & Mute Controls ──────────────────

    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Math.min(1, v));
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    }

    setMusicVolume(v) {
        this.musicVolume = Math.max(0, Math.min(1, v));
        if (this.musicGain) {
            this.musicGain.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    }

    setSfxVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
        if (this.sfxGain) {
            this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    }

    setAmbienceVolume(v) {
        this.ambienceVolume = Math.max(0, Math.min(1, v));
        if (this.ambienceGain) {
            this.ambienceGain.gain.setValueAtTime(this.ambienceVolume, this.ctx.currentTime);
        }
        this._savePreferences();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
        }
        this._savePreferences();
        return this.muted;
    }

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
    }

    // ── Persistence ─────────────────────────────

    _savePreferences() {
        try {
            localStorage.setItem('lord_of_realms_audio', JSON.stringify({
                masterVolume: this.masterVolume,
                musicVolume: this.musicVolume,
                sfxVolume: this.sfxVolume,
                ambienceVolume: this.ambienceVolume,
                muted: this.muted,
            }));
        } catch (_) { /* ignore */ }
    }

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
            }
        } catch (_) { /* ignore */ }
    }

    /** Clean up everything */
    destroy() {
        this._stopMusic();
        if (this.ctx) {
            this.ctx.close();
        }
        this.initialized = false;
    }
}

// Global singleton
const audioManager = new AudioManager();
