// AudioManager — sfx methods.
import { AudioManager } from './core.js';
import {  } from './_imports.js';

Object.assign(AudioManager.prototype, {
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
    },

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
    },

    /** Chirp-like sounds for crickets */
    _cricketAmbience(volume) {
        if (!this.ctx) return;
        this._cricketLoop(volume);
    },

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
    },

    /** High-pitched chirps for birdsong */
    _birdAmbience(volume) {
        if (!this.ctx) return;
        this._birdLoop(volume);
    },

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
    },

    // ── Sound Effects ───────────────────────────
    /**
     * Play a short UI sound effect.
     * @param {'click'|'success'|'error'|'notify'|'turn'|'gold'|'combat_hit'|'level_up'|'build'|'sail'|'forge_perfect'|'forge_charge'} type
     */
    playSFX(type) {
        if (!this.initialized) this.init();
        if (!this.ctx || this.muted) return;
        this._resume();

        switch (type) {
            case 'click':         this._sfxClick(); break;
            case 'success':       this._sfxSuccess(); break;
            case 'error':         this._sfxError(); break;
            case 'notify':        this._sfxNotify(); break;
            case 'turn':          this._sfxTurn(); break;
            case 'gold':          this._sfxGold(); break;
            case 'combat_hit':    this._sfxCombatHit(); break;
            case 'level_up':      this._sfxLevelUp(); break;
            case 'build':         this._sfxBuild(); break;
            case 'sail':          this._sfxSail(); break;
            case 'forge_perfect': this._sfxForgePerfect(); break;
            case 'forge_charge':  this._sfxForgeCharge(); break;
        }
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    _sfxForgePerfect() {
        const now = this.ctx.currentTime;
        // Bright rising two-note chime with a shimmer tail — a "perfect strike".
        [[1046, 0], [1568, 0.07]].forEach(([freq, t]) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + t);
            osc.frequency.linearRampToValueAtTime(freq * 1.03, now + t + 0.18);
            g.gain.setValueAtTime(0.14, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.32);
            osc.connect(g);
            g.connect(this.sfxGain);
            osc.start(now + t);
            osc.stop(now + t + 0.36);
        });
    },

    _sfxForgeCharge() {
        const now = this.ctx.currentTime;
        // Rising riser to telegraph an armed charged swing.
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.4);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.08, now + 0.3);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, now);
        filter.frequency.linearRampToValueAtTime(1400, now + 0.4);
        osc.connect(filter);
        filter.connect(g);
        g.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.55);
    },

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
    },
});
