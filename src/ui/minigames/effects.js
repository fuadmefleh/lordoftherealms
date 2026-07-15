// Reusable canvas juice for minigames: particles, screen shake, floating text,
// and hit-stop. Game-agnostic — draws onto a supplied 2D context in world
// coordinates. The host applies the shake offset before rendering.
//
// Cosmetic randomness draws from the seedable Utils RNG (repo convention) rather
// than Math.random, so a seeded run is reproducible end to end.
import { Utils } from '../../core/utils.js';

export class Effects {
    constructor({ reducedMotion = false } = {}) {
        this.reducedMotion = reducedMotion;
        this.particles = [];
        this.texts = [];
        this._shake = 0;
        this._shakeMax = 0;
        this._hitStopMs = 0;
        this._ox = 0;
        this._oy = 0;
    }

    /** Emit a burst of spark particles at (x, y). */
    spawnParticles(x, y, opts = {}) {
        const {
            count = 12,
            color = '#ffcc55',
            speed = 180,
            spread = Math.PI * 2,
            angle = -Math.PI / 2,
            gravity = 420,
            life = 0.6,
            size = 3,
        } = opts;

        const n = this.reducedMotion ? Math.min(count, 4) : count;
        for (let i = 0; i < n; i++) {
            const a = angle + (Utils.random() - 0.5) * spread;
            const sp = speed * (0.4 + Utils.random() * 0.8);
            this.particles.push({
                x, y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                life: life * (0.6 + Utils.random() * 0.6),
                maxLife: life,
                color,
                gravity,
                size: size * (0.6 + Utils.random() * 0.8),
            });
        }
    }

    /** Add screen shake energy (0..1-ish amplitude). */
    shake(amount) {
        if (this.reducedMotion) return;
        this._shake = Math.min(1.2, this._shake + amount);
        this._shakeMax = Math.max(this._shakeMax, this._shake);
    }

    /** Spawn a rising, fading text pop at (x, y). */
    popText(x, y, text, opts = {}) {
        const { color = '#fff', size = 22, life = 0.9, vy = -60 } = opts;
        this.texts.push({ x, y, text, color, size, life, maxLife: life, vy });
    }

    /** Freeze game logic for `ms` milliseconds for impact. */
    hitStop(ms) {
        if (this.reducedMotion) return;
        this._hitStopMs = Math.max(this._hitStopMs, ms);
    }

    /** Whether game logic should be frozen this frame. */
    isFrozen() {
        return this._hitStopMs > 0;
    }

    get shakeOffset() {
        return { ox: this._ox, oy: this._oy };
    }

    /** Advance all effects by `dt` seconds. */
    update(dt) {
        // Hit-stop counts down in real time even while game logic is frozen.
        if (this._hitStopMs > 0) {
            this._hitStopMs = Math.max(0, this._hitStopMs - dt * 1000);
        }

        // Screen shake decay + random offset.
        if (this._shake > 0) {
            this._shake = Math.max(0, this._shake - dt * 3.2);
            const amp = this._shake * 14;
            this._ox = (Utils.random() - 0.5) * 2 * amp;
            this._oy = (Utils.random() - 0.5) * 2 * amp;
        } else {
            this._ox = 0;
            this._oy = 0;
        }

        // Particles.
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }

        // Floating text.
        for (let i = this.texts.length - 1; i >= 0; i--) {
            const t = this.texts[i];
            t.life -= dt;
            if (t.life <= 0) {
                this.texts.splice(i, 1);
                continue;
            }
            t.y += t.vy * dt;
        }
    }

    /** Draw particles and floating text (call after the game's own render). */
    render(ctx) {
        for (const p of this.particles) {
            const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;

        for (const t of this.texts) {
            const alpha = Math.max(0, Math.min(1, t.life / t.maxLife));
            ctx.globalAlpha = alpha;
            ctx.fillStyle = t.color;
            ctx.font = `bold ${t.size}px var(--font-display, sans-serif)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(t.text, t.x, t.y);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    /** Drop all live effects (used on teardown). */
    clear() {
        this.particles.length = 0;
        this.texts.length = 0;
        this._shake = 0;
        this._hitStopMs = 0;
        this._ox = 0;
        this._oy = 0;
    }
}
