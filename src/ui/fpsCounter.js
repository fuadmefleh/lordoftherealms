// FPS counter: a small corner readout of frames a second, the average frame
// time and the worst frame in the last half second. Toggled with F3 (gameLoop.js)
// or Settings → Show FPS Counter (propertiesSettings.js `showFps`).
//
// tick(timestamp) is called once a frame from the game loop with the raw
// requestAnimationFrame time (not the clamped sim delta), so a slow frame shows.

const SAMPLE_MS = 500;

export const FpsCounter = {
    enabled: false,
    _el: null,
    _last: 0,
    _frames: 0,
    _since: 0,
    _worst: 0,

    _ensure() {
        if (this._el || typeof document === 'undefined') return this._el;
        const el = document.createElement('div');
        el.id = 'fpsCounter';
        if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
        if (!el.style) el.style = {};
        Object.assign(el.style, {
            position: 'fixed', left: '8px', top: '56px', zIndex: '99999',
            padding: '3px 7px', borderRadius: '4px',
            background: 'rgba(0, 0, 0, 0.6)', color: '#9f9',
            font: '12px/1.3 Consolas, "Courier New", monospace',
            pointerEvents: 'none', whiteSpace: 'pre', display: 'none',
        });
        el.textContent = '-- fps';
        if (document.body && typeof document.body.appendChild === 'function') document.body.appendChild(el);
        this._el = el;
        return el;
    },

    /** Show or hide it. */
    setEnabled(on) {
        this.enabled = !!on;
        const el = this._ensure();
        if (el) el.style.display = this.enabled ? '' : 'none';
        this._last = 0; this._frames = 0; this._since = 0; this._worst = 0;
        return this.enabled;
    },

    toggle() {
        return this.setEnabled(!this.enabled);
    },

    /** One frame drawn at `timestamp` (ms, requestAnimationFrame time). */
    tick(timestamp) {
        if (!this.enabled || !Number.isFinite(timestamp)) return;
        if (!this._last) { this._last = timestamp; this._since = timestamp; return; }
        const dt = timestamp - this._last;
        this._last = timestamp;
        this._frames++;
        if (dt > this._worst) this._worst = dt;
        const span = timestamp - this._since;
        if (span < SAMPLE_MS) return;
        const fps = (this._frames * 1000) / span;
        const avg = span / this._frames;
        const el = this._ensure();
        if (el) {
            el.textContent = `${Math.round(fps)} fps  ${avg.toFixed(1)} ms  (worst ${Math.round(this._worst)} ms)`;
            el.style.color = fps >= 50 ? '#9f9' : fps >= 30 ? '#ff6' : '#f77';
        }
        this._frames = 0; this._since = timestamp; this._worst = 0;
    },
};
