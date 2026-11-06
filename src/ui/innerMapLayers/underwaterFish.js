// Fish swimming about under the water, while diving (ui/innerMapDiving.js).
//
// Only seen, not caught: shoals of sprats and mackerel, bream in twos and
// threes, a lone snapper or cod, now and then a dogfish, at sea; minnows,
// perch, trout, carp and the odd pike in lakes, rivers and ponds. The species
// and how many live where are data/diving.json `fish`.
//
//   • They live in the divable water within `radius` tiles of the diver; one
//     left behind past it is gone, and new ones are met at the edge.
//   • Each wanders from point to point through water only; a shoal keeps
//     together, each fish holding its place about the shoal's mark.
//   • Within `shy` tiles of the diver a fish darts away.
//
// Drawn by InnerMapRenderer._renderUnderwaterFloor (innerMapLayers/underwater.js),
// over the bottom and its finds, under the diver. Little pixel sprites drawn
// once per species (three beats of the tail; PX_PER_TILE pixels to a tile of
// the fish's length, near the art's own grain) and scaled up unsmoothed.
//
// Its own random stream: the fish must not draw from the game's seeded RNG.

import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Diving } from '../../player/diving.js';

const DEFAULTS = { radius: 13, max: 34, shy: 2.2, fleeSpeed: 2.6, perCell: {}, species: [] };
const PX_PER_TILE = 40;       // a sprite's pixels to a tile of its length (the art's own grain, near enough)
const TAIL = [0, 1, 2, 1];    // the tail's beat, by frame

function _mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const UnderwaterFish = {
    fish: [],
    _dive: null,      // the dive these fish belong to (InnerMapDiving._under)
    _rand: _mulberry(1),
    _target: 0,
    _recount: 0,
    _sprites: new Map(),

    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.diving && g.diving.fish) || {};
        return { ...DEFAULTS, ...d, perCell: { ...DEFAULTS.perCell, ...(d.perCell || {}) }, species: d.species || [] };
    },

    /** The water kind at a tile ('sea' | 'lake' | 'river' | 'pond'). */
    _kindAt(q, r) {
        return Diving.waterOf(InnerMap.getTile(q, r)).kind;
    },

    _divable(x, y) {
        return InnerMap.isDivable(Math.floor(x), Math.floor(y));
    },

    /** Divable cells within `radius` of (px, py), farther than `minD`: [{ q, r, d, kind }] */
    _cellsNear(px, py, radius, minD = 0) {
        const out = [];
        const R = Math.ceil(radius);
        for (let r = Math.floor(py) - R; r <= Math.floor(py) + R; r++) {
            for (let q = Math.floor(px) - R; q <= Math.floor(px) + R; q++) {
                const d = Math.hypot(q + 0.5 - px, r + 0.5 - py);
                if (d > radius || d < minD || !InnerMap.isDivable(q, r)) continue;
                out.push({ q, r, d, kind: this._kindAt(q, r) });
            }
        }
        return out;
    },

    /** How many fish the water about the diver holds. */
    _countFor(cells, C) {
        let n = 0;
        for (const c of cells) n += Number(C.perCell[c.kind]) || 0;
        return Math.min(C.max, Math.round(n));
    },

    /** A species for this water, by weight; null if none lives in it. */
    _pickSpecies(kind, C) {
        const list = C.species.filter(s => !s.waters || s.waters.includes(kind));
        let total = 0;
        for (const s of list) total += Math.max(0, Number(s.weight) || 1);
        if (!total) return null;
        let x = this._rand() * total;
        for (const s of list) {
            x -= Math.max(0, Number(s.weight) || 1);
            if (x <= 0) return s;
        }
        return list[list.length - 1];
    },

    /** A shoal (or a lone fish) about the cell, up to `room` of them. → how many */
    _spawnAt(cell, C, room) {
        const sp = this._pickSpecies(cell.kind, C);
        if (!sp || room <= 0) return 0;
        const [lo, hi] = Array.isArray(sp.school) ? sp.school : [1, 1];
        const n = Math.max(1, Math.min(room, lo + Math.floor(this._rand() * (hi - lo + 1))));
        const cx = cell.q + 0.5, cy = cell.r + 0.5;
        const shoal = n > 1 ? { x: cx, y: cy, tx: cx, ty: cy } : null;
        const heading = this._rand() * Math.PI * 2;
        let made = 0;
        for (let i = 0; i < n; i++) {
            const spread = shoal ? 0.35 + Math.sqrt(n) * 0.22 : 0;
            const ox = (this._rand() * 2 - 1) * spread, oy = (this._rand() * 2 - 1) * spread * 0.7;
            const x = this._divable(cx + ox, cy + oy) ? cx + ox : cx, y = this._divable(cx + ox, cy + oy) ? cy + oy : cy;
            const v = (Number(sp.speed) || 1) * 0.5;
            this.fish.push({
                sp, x, y, vx: Math.cos(heading) * v, vy: Math.sin(heading) * v * 0.5,
                tx: x, ty: y, shoal, ox, oy, phase: this._rand() * 4, wait: this._rand() * 1.5,
            });
            made++;
        }
        if (shoal) this._newMark(shoal, cx, cy);
        return made;
    },

    /** A new point to swim to, a few tiles off through the water, within reach of the diver. */
    _newMark(m, fromX, fromY) {
        const C = this.config();
        const p = this._diver();
        for (let i = 0; i < 10; i++) {
            const a = this._rand() * Math.PI * 2, d = 1.5 + this._rand() * 4.5;
            const x = fromX + Math.cos(a) * d, y = fromY + Math.sin(a) * d * 0.6;
            if (!this._divable(x, y) || !this._clearBetween(fromX, fromY, x, y)) continue;
            if (p && Math.hypot(x - p.x, y - p.y) > C.radius) continue;
            m.tx = x; m.ty = y;
            return true;
        }
        m.tx = fromX; m.ty = fromY;
        return false;
    },

    /** Water all the way from one point to the other (sampled every half tile). */
    _clearBetween(x0, y0, x1, y1) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
        for (let i = 1; i <= n; i++) {
            if (!this._divable(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
        }
        return true;
    },

    /** The diver, in tiles (the middle of the tile they are in, or between). */
    _diver() {
        const pos = InnerMap.getPlayerWorldPos ? InnerMap.getPlayerWorldPos() : null;
        if (pos) return { x: pos.x / 32, y: pos.y / 32 };
        return { x: InnerMap.playerInnerQ + 0.5, y: InnerMap.playerInnerR + 0.5 };
    },

    /** New fish for a new dive, about where the diver went under. */
    reset(dive, seed = 1) {
        this.fish = [];
        this._dive = dive;
        this._rand = _mulberry(seed);
        const C = this.config();
        const p = this._diver();
        const cells = this._cellsNear(p.x, p.y, C.radius, C.shy + 1);
        this._target = this._countFor(this._cellsNear(p.x, p.y, C.radius), C);
        this._recount = 2;
        for (let tries = 0; this.fish.length < this._target && cells.length && tries < 60; tries++) {
            this._spawnAt(cells[Math.floor(this._rand() * cells.length)], C, this._target - this.fish.length);
        }
    },

    /** Swim them on by `dt` seconds. */
    update(dt) {
        const C = this.config();
        const p = this._diver();
        dt = Math.min(0.1, Math.max(0, dt));
        // The ones left behind are gone; new ones met at the edge of sight
        this.fish = this.fish.filter(f => Math.hypot(f.x - p.x, f.y - p.y) <= C.radius + 2 && this._divable(f.x, f.y));
        this._recount -= dt;
        if (this._recount <= 0) {
            this._recount = 2;
            this._target = this._countFor(this._cellsNear(p.x, p.y, C.radius), C);
            if (this.fish.length < this._target) {
                const edge = this._cellsNear(p.x, p.y, C.radius, C.radius * 0.65);
                if (edge.length) this._spawnAt(edge[Math.floor(this._rand() * edge.length)], C, this._target - this.fish.length);
            }
        }
        const moved = new Set();
        for (const f of this.fish) {
            const sp = f.sp;
            const speed = Number(sp.speed) || 1;
            // The shoal's mark moves on when its fish are near it
            const m = f.shoal || f;
            if (f.shoal && !moved.has(f.shoal)) {
                moved.add(f.shoal);
                const near = Math.hypot(f.x - f.shoal.tx, f.y - f.shoal.ty) < 0.8;
                if (near) this._newMark(f.shoal, f.shoal.tx, f.shoal.ty);
            } else if (!f.shoal && Math.hypot(f.x - f.tx, f.y - f.ty) < 0.3) {
                f.wait -= dt;
                if (f.wait <= 0) { this._newMark(f, f.x, f.y); f.wait = 0.5 + this._rand() * 2.5; }
            }
            let gx = (f.shoal ? m.tx + f.ox : m.tx) - f.x, gy = (f.shoal ? m.ty + f.oy : m.ty) - f.y;
            let want = speed;
            const dd = Math.hypot(f.x - p.x, f.y - p.y);
            f.flee = dd < C.shy;
            if (f.flee) {
                // Dart away from the diver
                gx = (f.x - p.x) / (dd || 1); gy = (f.y - p.y) / (dd || 1);
                want = speed * C.fleeSpeed;
            } else {
                const gd = Math.hypot(gx, gy);
                if (gd < 0.05) want = 0;
                else { want *= Math.min(1, gd / 0.8); gx /= gd; gy /= gd; }
            }
            const turn = Math.min(1, dt * (f.flee ? 6 : 2.2));
            f.vx += (gx * want - f.vx) * turn;
            f.vy += (gy * want * 0.7 - f.vy) * turn;
            const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
            if (this._divable(nx, ny)) { f.x = nx; f.y = ny; }
            else {
                // Nosed into the bank or a hull: turn about and find water elsewhere
                f.vx *= -0.4; f.vy *= -0.4;
                this._newMark(m, f.x, f.y);
            }
            f.phase += dt * (1.5 + Math.hypot(f.vx, f.vy) * 4);
        }
    },

    // ── Drawing ──

    /** A species' sprite, facing right, tail at beat `b` (0-2): a small canvas, or null. */
    _sprite(sp, b) {
        if (typeof document === 'undefined') return null;
        const key = `${sp.id}:${b}`;
        let c = this._sprites.get(key);
        if (c) return c;
        const W = Math.max(14, Math.round(PX_PER_TILE * (Number(sp.length) || 0.5)));
        const H = Math.max(6, Math.round(W * (Number(sp.height) || 0.36))) + 4 + Math.round(Number(sp.dorsal) || 0);
        c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        const cy = H / 2 + (Number(sp.dorsal) || 0) / 2;
        const bx = W * 0.56, rx = W * 0.4, ry = (H - 4) / 2;
        // Tail, beating
        const sway = (b - 1) * ry * 0.35;
        x.fillStyle = sp.fin || sp.back;
        x.beginPath();
        x.moveTo(bx - rx + 1.5, cy);
        x.lineTo(0.5, cy - ry * 0.9 + sway);
        x.lineTo(2.5, cy + sway * 0.5);
        x.lineTo(0.5, cy + ry * 0.9 + sway);
        x.closePath();
        x.fill();
        // Fins: on the back, and below
        x.beginPath();
        x.moveTo(bx - rx * 0.35, cy - ry * 0.8);
        x.lineTo(bx - rx * 0.05, cy - ry - 1.6 - (Number(sp.dorsal) || 0));
        x.lineTo(bx + rx * 0.3, cy - ry * 0.8);
        x.fill();
        x.beginPath();
        x.moveTo(bx - rx * 0.1, cy + ry * 0.7);
        x.lineTo(bx - rx * 0.25, cy + ry + 1.2);
        x.lineTo(bx + rx * 0.2, cy + ry * 0.7);
        x.fill();
        // The body: its back, its belly
        x.save();
        x.beginPath();
        x.ellipse(bx, cy, rx, ry, 0, 0, Math.PI * 2);
        x.clip();
        x.fillStyle = sp.back;
        x.fillRect(0, 0, W, H);
        x.fillStyle = sp.belly || sp.back;
        x.fillRect(0, cy + ry * 0.15, W, H);
        x.fillStyle = sp.mark || 'rgba(0,0,0,0.35)';
        if (sp.pattern === 'bars') {
            for (let i = 0; i < 4; i++) x.fillRect(bx - rx * 0.6 + i * rx * 0.36, cy - ry, 1.2, ry * 1.1);
        } else if (sp.pattern === 'spots') {
            const n = Math.round(W / 3);
            for (let i = 0; i < n; i++) x.fillRect(Math.round(bx - rx * 0.8 + ((i * 5) % n) * rx * 1.5 / n), Math.round(cy - ry * 0.7 + (i % 3) * ry * 0.35), 1, 1);
        } else if (sp.pattern === 'stripe') {
            x.fillRect(0, cy - 0.6, W, 1.2);
        }
        x.restore();
        // A gleam along the back, and the eye
        x.fillStyle = 'rgba(255,255,255,0.25)';
        x.fillRect(bx - rx * 0.4, cy - ry * 0.55, rx * 0.9, 1);
        x.fillStyle = '#10161a';
        x.fillRect(Math.round(bx + rx * 0.62), Math.round(cy - ry * 0.3), 1, 1);
        this._sprites.set(key, c);
        return c;
    },

    /** Draw them (camera: the inner map's; T: tile size; ds: a tile on screen). */
    draw(ctx, camera, T, ds, now) {
        if (!this.fish.length) return;
        const C = this.config();
        const p = this._diver();
        const W = ctx.canvas.width, H = ctx.canvas.height;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        // Nearer the bottom first (higher on the screen), so the ones in front are drawn over them
        const order = this.fish.slice().sort((a, b) => a.y - b.y);
        for (const f of order) {
            const s = camera.worldToScreenFast(f.x * T, f.y * T);
            const sx = s.x, sy = s.y;
            const len = (Number(f.sp.length) || 0.5) * ds;
            if (sx < -len * 2 || sx > W + len * 2 || sy < -len * 2 || sy > H + len * 2) continue;
            const spr = this._sprite(f.sp, TAIL[Math.floor(f.phase) % TAIL.length]);
            if (!spr) continue;
            // Fading into the murk with distance
            const d = Math.hypot(f.x - p.x, f.y - p.y);
            const fade = 1 - Math.min(1, Math.max(0, (d - C.radius * 0.45) / (C.radius * 0.55))) * 0.75;
            const scale = len / spr.width;
            const left = f.vx < 0;
            const tilt = Math.max(-0.35, Math.min(0.35, Math.atan2(f.vy, Math.abs(f.vx) + 0.01)));
            // Its shadow on the bottom, below
            ctx.globalAlpha = 0.18 * fade;
            ctx.fillStyle = '#021014';
            ctx.beginPath();
            ctx.ellipse(sx, sy + ds * 0.32, len * 0.4, len * 0.1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = fade;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(left ? -tilt : tilt);
            ctx.scale(left ? -scale : scale, scale);
            ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
            ctx.restore();
        }
        ctx.restore();
    },
};
