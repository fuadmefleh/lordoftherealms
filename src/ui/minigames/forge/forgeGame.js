// The Forge — the smithing minigame module that runs on MinigameHost.
//
// Owns the workshop scene, the sweeping strike bar, round flow, and all juice.
// Every scoring decision is delegated to the pure forgeLogic module; this file
// is only rendering, input, and timing. On completion it hands a 0..100 score to
// the caller's onComplete, which routes it to the existing reward pipeline.
import {
    FORGE,
    computeZones,
    classifyStrike,
    updateHeat,
    strikePoints,
    aggregateScore,
} from './forgeLogic.js';

const CHARGE_HOLD = 0.22; // seconds held before a strike counts as charged
const FLASH_TIME = 0.7; // seconds of result flash between rounds
const BASE_SPEED = 46; // bar %/second at round 0
const SPEED_PER_ROUND = 15;
const MASTERWORK_ROUND = FORGE.TOTAL_ROUNDS - 1;

const TIER_COLOR = { perfect: '#f5c542', good: '#2ecc71', weak: '#e67e22', miss: '#e74c3c' };
const TIER_LABEL = {
    perfect: 'PERFECT!', good: 'Good', weak: 'Glancing', miss: 'MISS',
};

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
    return `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
}

export class ForgeGame {
    constructor({ strength = 5, onComplete = () => {} } = {}) {
        this.str = strength;
        this.onComplete = onComplete;

        this.phase = 'intro'; // intro → playing → flash → done
        this.round = 0;
        this.heat = 0;
        this.strikes = [];
        this.cursor = 0;
        this.dir = 1;
        this.clock = 0;

        this.zones = computeZones(this.str, 0);
        this.speed = BASE_SPEED;

        this.downAt = -1;
        this.charging = false;
        this.chargePlayed = false;

        this.flashTimer = 0;
        this.lastResult = null;
        this.glow = 0; // eased heat for the ingot glow
        this.hammer = 0; // 0..1 strike animation
        this.emberTimer = 0;
        this.scorePercent = 0;
    }

    init(host) {
        this.host = host;
        this.W = host.width;
        this.H = host.height;
        // Bar geometry (CSS pixels).
        this.barX = this.W * 0.1;
        this.barW = this.W * 0.8;
        this.barY = this.H * 0.66;
        this.barH = 26;
        this.anvilCX = this.W / 2;
        this.anvilCY = this.H * 0.5;
    }

    _startRound() {
        this.zones = computeZones(this.str, this.round);
        if (this.round === MASTERWORK_ROUND) {
            // The finale is tighter and faster.
            this.zones = {
                perfect: this.zones.perfect * 0.8,
                good: this.zones.good * 0.82,
                weak: this.zones.weak * 0.85,
            };
        }
        this.speed = BASE_SPEED + this.round * SPEED_PER_ROUND;
        this.cursor = 0;
        this.dir = 1;
        this.charging = false;
        this.chargePlayed = false;
        this.downAt = -1;
        this.phase = 'playing';
    }

    // ── Input ───────────────────────────────────────────────────────────────
    onInput({ type }) {
        if (this.phase === 'intro') {
            if (type === 'down') this._startRound();
            return;
        }
        if (this.phase === 'done') {
            if (type === 'up') this._finish();
            return;
        }
        if (this.phase !== 'playing') return;

        if (type === 'down') {
            this.downAt = this.clock;
            this.charging = true;
            this.chargePlayed = false;
        } else if (type === 'up') {
            if (this.downAt < 0) return;
            const held = this.clock - this.downAt;
            const charged = held >= CHARGE_HOLD;
            this._resolveStrike(charged);
        }
    }

    _resolveStrike(charged) {
        const result = classifyStrike(this.cursor, this.zones, { charged });
        this.heat = updateHeat(this.heat, result.tier);
        const points = strikePoints(result.quality, this.heat, { charged });
        const masterwork = this.round === MASTERWORK_ROUND;
        this.strikes.push({ tier: result.tier, points, masterwork, charged });
        this.lastResult = { ...result, points, charged, masterwork };

        this._juiceForStrike(result.tier, charged, masterwork);

        this.charging = false;
        this.downAt = -1;
        this.hammer = 1;
        this.phase = 'flash';
        this.flashTimer = FLASH_TIME;
    }

    _juiceForStrike(tier, charged, masterwork) {
        const h = this.host;
        const hitX = this.barX + (this.cursor / 100) * this.barW;
        const anvilTopY = this.anvilCY - 12;

        if (tier === 'miss') {
            h.shake(0.15);
            h.playSFX('error');
            h.popText(this.anvilCX, this.anvilCY - 70, 'MISS', { color: TIER_COLOR.miss, size: 26 });
            return;
        }

        const strong = tier === 'perfect' || (masterwork && tier === 'good');
        const shakeAmt = tier === 'perfect' ? (masterwork ? 0.9 : 0.55) : tier === 'good' ? 0.3 : 0.15;
        h.shake(shakeAmt);

        const sparkCount = tier === 'perfect' ? (masterwork ? 40 : 26) : tier === 'good' ? 16 : 8;
        h.spawnParticles(hitX, anvilTopY, {
            count: sparkCount,
            color: TIER_COLOR[tier],
            speed: strong ? 260 : 160,
            spread: Math.PI,
            angle: -Math.PI / 2,
        });

        if (tier === 'perfect') {
            h.hitStop(masterwork ? 110 : 70);
            h.playSFX('forge_perfect');
        } else {
            h.playSFX('build');
        }

        let label = TIER_LABEL[tier];
        if (masterwork && tier === 'perfect') label = '⚒️ MASTERWORK!';
        else if (masterwork && tier === 'good') label = 'Fine work';
        if (charged && tier !== 'miss') label += ' ×2';
        const popColor = masterwork && tier === 'perfect' ? '#fff2b0' : TIER_COLOR[tier];
        h.popText(this.anvilCX, this.anvilCY - 70, label, { color: popColor, size: masterwork ? 30 : 24 });
    }

    _finish() {
        this.scorePercent = aggregateScore(this.strikes);
        this.onComplete(this.scorePercent);
    }

    // ── Update ──────────────────────────────────────────────────────────────
    update(dt) {
        this.clock += dt;

        // Ease the ingot glow toward the current heat.
        const targetGlow = this.heat / FORGE.HEAT_MAX;
        this.glow += (targetGlow - this.glow) * Math.min(1, dt * 6);

        // Hammer swing settle.
        if (this.hammer > 0) this.hammer = Math.max(0, this.hammer - dt * 3);

        // Ambient embers rising from the forge.
        this.emberTimer -= dt;
        if (this.emberTimer <= 0 && this.host) {
            this.emberTimer = 0.12;
            const ex = this.anvilCX + (this.cursor - 50) * 0.2 + (Math.sin(this.clock * 7) * 20);
            this.host.spawnParticles(ex, this.anvilCY - 10, {
                count: 1, color: '#ff7a2a', speed: 40, spread: 0.8, angle: -Math.PI / 2,
                gravity: -30, life: 1.1, size: 2,
            });
        }

        if (this.phase === 'playing') {
            this.cursor += this.dir * this.speed * dt;
            if (this.cursor >= 100) { this.cursor = 100; this.dir = -1; }
            if (this.cursor <= 0) { this.cursor = 0; this.dir = 1; }

            // Charge tell once the hold threshold is crossed.
            if (this.charging && !this.chargePlayed && (this.clock - this.downAt) >= CHARGE_HOLD) {
                this.chargePlayed = true;
                if (this.host) this.host.playSFX('forge_charge');
            }
        } else if (this.phase === 'flash') {
            this.flashTimer -= dt;
            if (this.flashTimer <= 0) {
                if (this.round >= MASTERWORK_ROUND) {
                    this.scorePercent = aggregateScore(this.strikes);
                    this.phase = 'done';
                } else {
                    this.round++;
                    this._startRound();
                }
            }
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────
    render(ctx) {
        this._drawScene(ctx);
        this._drawAnvilAndIngot(ctx);
        this._drawSmith(ctx);

        if (this.phase === 'intro') { this._drawIntro(ctx); return; }
        if (this.phase === 'done') { this._drawWinScreen(ctx); return; }

        this._drawHUD(ctx);
        this._drawBar(ctx);
    }

    _drawScene(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, this.H);
        g.addColorStop(0, '#1a1410');
        g.addColorStop(0.6, '#241a12');
        g.addColorStop(1, '#0e0a08');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.W, this.H);

        // Warm forge glow behind the anvil, pulsing with heat.
        const gl = 0.25 + this.glow * 0.5;
        const rg = ctx.createRadialGradient(this.anvilCX, this.anvilCY, 10, this.anvilCX, this.anvilCY, this.W * 0.5);
        rg.addColorStop(0, `rgba(255,120,30,${gl})`);
        rg.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, this.W, this.H);
    }

    _drawAnvilAndIngot(ctx) {
        const cx = this.anvilCX;
        const cy = this.anvilCY;

        // Anvil body.
        ctx.fillStyle = '#2b2b30';
        ctx.beginPath();
        ctx.moveTo(cx - 60, cy + 6);
        ctx.lineTo(cx + 70, cy + 6);
        ctx.lineTo(cx + 40, cy + 20);
        ctx.lineTo(cx - 34, cy + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(cx - 20, cy + 20, 40, 40); // waist
        ctx.fillRect(cx - 40, cy + 58, 80, 14); // base
        // Horn.
        ctx.beginPath();
        ctx.moveTo(cx + 70, cy + 6);
        ctx.lineTo(cx + 104, cy + 12);
        ctx.lineTo(cx + 70, cy + 18);
        ctx.closePath();
        ctx.fill();

        // Glowing ingot on top.
        const t = this.glow;
        const hot = lerpColor([90, 40, 26], [255, 242, 176], t);
        ctx.save();
        ctx.shadowColor = lerpColor([120, 40, 20], [255, 180, 60], t);
        ctx.shadowBlur = 14 + t * 26;
        ctx.fillStyle = hot;
        ctx.fillRect(cx - 26, cy - 14, 52, 16);
        ctx.restore();
    }

    _drawSmith(ctx) {
        const cx = this.anvilCX - 96;
        const cy = this.anvilCY;
        ctx.fillStyle = '#15100c';
        // Body.
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, 22, 34, 0, 0, Math.PI * 2);
        ctx.fill();
        // Head.
        ctx.beginPath();
        ctx.arc(cx + 4, cy - 34, 13, 0, Math.PI * 2);
        ctx.fill();

        // Hammer arm — swings down on a strike (hammer 1→0).
        const swing = this.hammer; // 1 just after hit
        const ang = lerp(-1.1, -0.15, 1 - swing);
        const ox = cx + 12;
        const oy = cy - 16;
        const hx = ox + Math.cos(ang) * 46;
        const hy = oy + Math.sin(ang) * 46;
        ctx.strokeStyle = '#3a2a1e';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = '#4a4a52';
        ctx.fillRect(hx - 8, hy - 6, 18, 12);
    }

    _drawHUD(ctx) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        const label = this.round === MASTERWORK_ROUND ? 'MASTERWORK STRIKE' : `Strike ${this.round + 1} / ${FORGE.TOTAL_ROUNDS}`;
        ctx.fillStyle = this.round === MASTERWORK_ROUND ? '#f5c542' : 'rgba(255,255,255,0.85)';
        ctx.fillText(label, 14, 24);

        // Live running score estimate.
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '12px sans-serif';
        ctx.fillText(`Quality: ${aggregateScore(this.strikes)}%`, 14, 42);

        // Heat pips (top-right).
        const pipR = 6;
        const startX = this.W - 14 - (FORGE.HEAT_MAX * (pipR * 2 + 6));
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '11px sans-serif';
        ctx.fillText('HEAT', startX - 8, 22);
        for (let i = 0; i < FORGE.HEAT_MAX; i++) {
            const on = i < this.heat;
            ctx.beginPath();
            ctx.arc(startX + i * (pipR * 2 + 6) + pipR, 18, pipR, 0, Math.PI * 2);
            ctx.fillStyle = on ? lerpColor([255, 120, 40], [255, 240, 160], i / FORGE.HEAT_MAX) : 'rgba(255,255,255,0.12)';
            ctx.fill();
        }
        ctx.textAlign = 'left';
    }

    _drawBar(ctx) {
        const { barX: x, barW: w, barY: y, barH: h } = this;

        // Track.
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this._roundRect(ctx, x, y, w, h, 6);
        ctx.fill();

        const centerX = x + w / 2;
        const scale = w / 100;
        const drawBand = (half, color) => {
            const bw = half * 2 * scale;
            ctx.fillStyle = color;
            ctx.fillRect(centerX - bw / 2, y, bw, h);
        };
        drawBand(this.zones.weak, 'rgba(230,126,34,0.28)');
        drawBand(this.zones.good, 'rgba(46,204,113,0.34)');
        const charged = this.charging && (this.clock - this.downAt) >= CHARGE_HOLD;
        const perfHalf = charged ? this.zones.perfect / 2 : this.zones.perfect;
        drawBand(perfHalf, charged ? 'rgba(245,197,66,0.85)' : 'rgba(245,197,66,0.6)');

        // Center tick.
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(centerX - 1, y - 4, 2, h + 8);

        // Cursor.
        const cxp = x + (this.cursor / 100) * w;
        ctx.fillStyle = charged ? '#fff2b0' : '#ffffff';
        ctx.shadowColor = charged ? '#f5c542' : 'rgba(255,255,255,0.7)';
        ctx.shadowBlur = charged ? 16 : 8;
        ctx.fillRect(cxp - 2, y - 8, 4, h + 16);
        ctx.shadowBlur = 0;

        // Prompt.
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '12px sans-serif';
        const hint = charged ? 'CHARGED — release in the gold!' : 'Space / click to strike · hold to charge (×2)';
        ctx.fillText(hint, this.W / 2, y + h + 22);
        ctx.textAlign = 'left';
    }

    _drawIntro(ctx) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f5c542';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText('🔥 The Forge', this.W / 2, this.H * 0.24);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '13px sans-serif';
        ctx.fillText('Strike the glowing metal in the gold for a Perfect hit.', this.W / 2, this.H * 0.24 + 26);
        ctx.fillText('Chain Perfects to build heat. Hold to charge a risky ×2 blow.', this.W / 2, this.H * 0.24 + 46);
        ctx.fillStyle = '#2ecc71';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText('Press Space or click to begin', this.W / 2, this.H * 0.86);
        ctx.textAlign = 'left';
    }

    _drawWinScreen(ctx) {
        const s = this.scorePercent;
        const rating = s >= 90 ? 'Masterful Work! 🌟' : s >= 70 ? 'Great Work! 👏' : s >= 50 ? 'Decent Work 👍' : s >= 25 ? 'Sloppy Work 😐' : 'Barely Finished 😬';
        const color = s >= 90 ? '#f1c40f' : s >= 70 ? '#2ecc71' : s >= 50 ? '#3498db' : s >= 25 ? '#f39c12' : '#e74c3c';
        const stars = Math.max(0, Math.min(5, Math.round(s / 20)));

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, this.W, this.H);

        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(rating, this.W / 2, this.H * 0.32);

        ctx.font = '22px sans-serif';
        ctx.fillStyle = '#f5c542';
        ctx.fillText('★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars), this.W / 2, this.H * 0.32 + 34);

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`Quality ${s}%`, this.W / 2, this.H * 0.32 + 66);

        // Continue button.
        const bw = 200, bh = 46;
        const bx = this.W / 2 - bw / 2, by = this.H * 0.74;
        this._continueBtn = { bx, by, bw, bh };
        ctx.fillStyle = '#c0392b';
        this._roundRect(ctx, bx, by, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('Continue', this.W / 2, by + bh / 2 + 6);
        ctx.textAlign = 'left';
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
}

/**
 * Convenience entry point used by the jobs delegate.
 * Constructs the game on a host and starts it. `onComplete(scorePercent)` fires
 * when the player leaves the win screen.
 */
export function startForge(host, { strength, onComplete }) {
    const game = new ForgeGame({ strength, onComplete });
    host.start(game);
    return game;
}
