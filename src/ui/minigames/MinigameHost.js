// MinigameHost — the reusable shell every labor minigame runs on.
//
// It opens a custom panel, injects one <canvas>, runs a single delta-timed
// requestAnimationFrame loop, routes input, exposes juice helpers (backed by
// Effects + the audio system), and guarantees teardown when the panel closes
// (fixing the legacy setInterval-in-a-closed-panel leak).
//
// A game module implements:
//   init(host)             — one-time setup; grab host.width/height/effects
//   update(dt)             — advance state (skipped while a hit-stop is active)
//   render(ctx, host)      — draw the scene each frame (CSS-pixel coordinates)
//   onInput({type,x,y})    — 'down' | 'up' pointer/key events
import { Effects } from './effects.js';
import { audioManager } from '../../systems/audio/index.js';

export class MinigameHost {
    constructor(game, { title = 'Minigame', height = 380 } = {}) {
        this.game = game;
        this.title = title;
        this._cssHeight = height;
        this.width = 0;
        this.height = height;

        this.canvas = null;
        this.ctx = null;
        this.dpr = 1;

        this.module = null;
        this._raf = 0;
        this._lastT = 0;
        this._closed = false;
        this._observer = null;

        const reducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.effects = new Effects({ reducedMotion });

        // Bound handlers so we can remove them on teardown.
        this._onDown = this._handleDown.bind(this);
        this._onUp = this._handleUp.bind(this);
        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);
        this._loop = this._frame.bind(this);
        this._keyHeld = false;
    }

    /** Open the panel, mount the canvas, and start the loop with a game module. */
    start(gameModule) {
        this.module = gameModule;

        this.game.ui.showCustomPanel(this.title, '<div id="mgRoot" style="width:100%;"></div>');
        const body = document.querySelector('#customPanel .custom-panel-body');
        const root = document.getElementById('mgRoot');
        const mount = root || body;
        if (!mount) return; // headless / panel missing — nothing to render into

        const cssW = Math.max(320, (mount.clientWidth || 480));
        this.width = cssW;
        this.height = this._cssHeight;
        this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(cssW * this.dpr);
        canvas.height = Math.floor(this._cssHeight * this.dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = this._cssHeight + 'px';
        canvas.style.display = 'block';
        canvas.style.borderRadius = '8px';
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'pointer';
        mount.appendChild(canvas);
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Input.
        canvas.addEventListener('mousedown', this._onDown);
        canvas.addEventListener('touchstart', this._onDown, { passive: false });
        window.addEventListener('mouseup', this._onUp);
        canvas.addEventListener('touchend', this._onUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);

        // Tear down automatically if the panel is removed by any means.
        if (typeof MutationObserver !== 'undefined') {
            this._observer = new MutationObserver(() => {
                if (!document.getElementById('customPanel')) this.close();
            });
            this._observer.observe(document.body, { childList: true });
        }

        if (this.module.init) this.module.init(this);

        this._lastT = this._now();
        this._raf = requestAnimationFrame(this._loop);
    }

    _now() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    _frame() {
        if (this._closed) return;
        const t = this._now();
        let dt = (t - this._lastT) / 1000;
        this._lastT = t;
        if (dt > 0.05) dt = 0.05; // clamp after a stall
        if (dt < 0) dt = 0;

        this.effects.update(dt);
        if (this.module.update && !this.effects.isFrozen()) this.module.update(dt);

        const ctx = this.ctx;
        if (ctx) {
            ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            ctx.clearRect(0, 0, this.width, this.height);
            const { ox, oy } = this.effects.shakeOffset;
            ctx.save();
            ctx.translate(ox, oy);
            if (this.module.render) this.module.render(ctx, this);
            this.effects.render(ctx);
            ctx.restore();
        }

        this._raf = requestAnimationFrame(this._loop);
    }

    // ── Input plumbing ──────────────────────────────────────────────────────
    _pointerPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
        // Rect is in screen px; the canvas may sit in a zoomed panel (--ui-zoom)
        const sx = rect.width ? this.width / rect.width : 1;
        const sy = rect.height ? this.height / rect.height : 1;
        return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
    }

    _handleDown(e) {
        if (e.cancelable) e.preventDefault();
        const { x, y } = this._pointerPos(e);
        if (this.module.onInput) this.module.onInput({ type: 'down', x, y });
    }

    _handleUp(e) {
        const { x, y } = this._pointerPos(e);
        if (this.module.onInput) this.module.onInput({ type: 'up', x, y });
    }

    _handleKeyDown(e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        e.preventDefault();
        if (this._keyHeld) return; // ignore auto-repeat
        this._keyHeld = true;
        if (this.module.onInput) this.module.onInput({ type: 'down', x: this.width / 2, y: this.height / 2 });
    }

    _handleKeyUp(e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        this._keyHeld = false;
        if (this.module.onInput) this.module.onInput({ type: 'up', x: this.width / 2, y: this.height / 2 });
    }

    // ── Juice helpers (proxy to Effects + audio) ────────────────────────────
    shake(amount) { this.effects.shake(amount); }
    spawnParticles(x, y, opts) { this.effects.spawnParticles(x, y, opts); }
    hitStop(ms) { this.effects.hitStop(ms); }
    popText(x, y, text, opts) { this.effects.popText(x, y, text, opts); }
    playSFX(type) {
        if (audioManager && typeof audioManager.playSFX === 'function') {
            try { audioManager.playSFX(type); } catch { /* audio is best-effort */ }
        }
    }

    /** Stop the loop, drop input listeners, and clear effects. Idempotent. */
    close() {
        if (this._closed) return;
        this._closed = true;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;

        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this._onDown);
            this.canvas.removeEventListener('touchstart', this._onDown);
            this.canvas.removeEventListener('touchend', this._onUp);
        }
        window.removeEventListener('mouseup', this._onUp);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);

        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        this.effects.clear();
        if (this.module && this.module.dispose) this.module.dispose();
    }
}
