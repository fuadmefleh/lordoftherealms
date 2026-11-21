// Fish seen from above, swimming in the water of the street map.
//
// Drawn by InnerMapRenderer._renderWaterFx (innerMapLayers/waterFx.js) first
// of all its effects: over the water ground, under the surf, the sparkles and
// the river's streaks of foam (so the surface plays over their backs).
//
//   • They live only in the deep water on screen (never the walkable shallows,
//     a ford, under a bridge or a pier, or on ice): a loose shoal, or a lone
//     fish, of the divers' species for that water (data/diving.json `fish`,
//     the same fish the spear finds under the surface: underwaterFish.js),
//     seen as dark backs in the water. Met afresh as the view moves; gone
//     once well off screen. Few in winter.
//   • In a river they face the current (each cell's t._flow, world/innerMap/
//     water.js): holding their place against it, working up it a little at a
//     time, now and then letting it take them down.
//   • Now and then one turns and flashes silver, or jumps — a splash and a
//     ring of ripples.
//   • The player swimming (or wading) near: they dart off for a moment.
//   • The same fish as the diver's: dive, and the fish about you go under with
//     you, just where they were (UnderwaterFish.reset takes them: takeNear);
//     come up, and the fish about you then are laid back here as they were
//     (giveBack). Below, as many swim in the water as are seen from above
//     (countNear).
//   • Food thrown on the water (throwBait, from ui/innerMapFeedFish.js): it
//     arcs out, lands with a splash, floats (a river carries it), and sinks
//     in the end. The fish near turn and come to it, more come up from
//     deeper while it lasts, and they nibble it down — a ring at each bite —
//     then scatter. A line cast near where they were fed bites the readier
//     for a while (biteBonus: ui/mapTasks/wildTasks.js).
//
// Settings: data/innerMap.json `surfaceFish`. Cosmetic only: its own random
// stream (seeded per map), never the game's seeded RNG. The deep cells are
// worked out once per map (a mask on the tiles array); the fish, their shoals
// and the ripples are fixed pools — a frame allocates nothing.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { FishFed } from '../fishFed.js';
import { UnderwaterFish } from './underwaterFish.js';

const DEFAULTS = {
    enabled: true, max: 28,
    perCell: { river: 0.2, lake: 0.1, pond: 0.14, sea: 0.06 },
    seasons: { winter: 0.3, spring: 1, summer: 1.15, autumn: 0.85, fall: 0.85 },
    pxPerTile: 28, breadth: 0.7, depth: 0.72, water: '#050d14', alpha: 0.85, night: 0.35,
    shy: 2.6, fleeSpeed: 3, drift: 0.35, upstream: 0.75, glint: 0.025, jump: 0.006, ripples: 8,
};
const KINDS = ['', 'river', 'lake', 'pond', 'sea'];
const KIND_CODE = { river: 1, lake: 2, pond: 3, sea: 4 };
const TAIL = [0, 1, 2, 1];
const MAX_SCHOOL = 7;          // a shoal seen from above: a handful, not the diver's dozens
const RIPPLE_LIFE = 1.5;       // s
const JUMP_TIME = 0.45;        // s in the air

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

function _rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const n = m ? parseInt(m[1], 16) : 0x555555;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _mix(a, b, k) {
    const A = _rgb(a), B = _rgb(b);
    const c = i => Math.round(A[i] + (B[i] - A[i]) * k);
    return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/** Deep water a fish can be seen in: wet, not shallow, not ice, nothing over it */
export function isFishWater(t) {
    return !!(t && (t._wet || t._sea) && !t._shallow && !t._deck && !t._pier && !t._bridge && !t._ford
        && !t.isRoad && !t.customObject && !t.customObjectPart
        && !(t.subTerrain && (t.subTerrain.passable || /frozen|ice/.test(t.subTerrain.id || ''))));
}

/** Under a bridge over the river: they swim on under it, out of sight */
function _underBridge(t) {
    return !!(t && t._wet && t._bridge && !t._ford && !t._shallow && !(t.subTerrain && /frozen|ice/.test(t.subTerrain.id || '')));
}
const HIDDEN = 8;

export const SurfaceFish = {
    fish: [],          // pool: { alive, sp, x, y, vx, vy, sh, ox, oy, tx, ty, wait, phase, ang, age, scared, glint }
    shoals: [],        // pool: { alive, tx, ty, tick }
    ripples: [],       // pool: { alive, x, y, age, sp, ang, kind: 'jump' | 'nibble' | 'splash' }
    baits: [],         // food on the water: { alive, x, y, fx, fy, t, flight, landed, bites, max, age, life, sink, food, comeT, came, seed }
    fed: [],           // where fish were fed lately: { x, y, at } (seconds, _clock)
    _clock: 0,
    _tiles: null,      // the map the mask is for
    _stamp: -1,
    mask: null,        // Uint8Array W*H: 0 not fish water, else KIND_CODE
    flowX: null, flowY: null,
    W: 0, H: 0, deep: 0,
    _rand: _mulberry(1),
    _recount: 0,
    _tick: 0,
    _last: null,
    _sprites: new Map(),
    _cfgSrc: undefined,
    _cfgVal: null,

    config() {
        const g = DataLoader._gamedata;
        const src = g && g.innerMap && g.innerMap.surfaceFish;
        if (this._cfgSrc !== src || !this._cfgVal) {
            this._cfgSrc = src;
            const o = src || {};
            this._cfgVal = {
                ...DEFAULTS, ...o,
                perCell: { ...DEFAULTS.perCell, ...(o.perCell || {}) },
                seasons: { ...DEFAULTS.seasons, ...(o.seasons || {}) },
            };
        }
        return this._cfgVal;
    },

    // ── One population with the diver's (underwaterFish.js) ──

    /**
     * The fish going under with a diver at (x, y): the live ones within `radius`,
     * taken off the surface. → [{ sp, x, y, ang, group, ox, oy, mx, my }] (group: their shoal, or null)
     */
    takeNear(x, y, radius) {
        const out = [];
        const groups = new Map();
        for (const f of this.fish) {
            if (!f.alive || Math.hypot(f.x - x, f.y - y) > radius) continue;
            let group = null;
            if (f.sh) {
                if (!groups.has(f.sh)) groups.set(f.sh, groups.size + 1);
                group = groups.get(f.sh);
            }
            out.push({ sp: f.sp, x: f.x, y: f.y, ang: f.ang, group, ox: f.sh ? f.ox : 0, oy: f.sh ? f.oy : 0, mx: f.sh ? f.sh.tx : f.tx, my: f.sh ? f.sh.ty : f.ty });
            f.alive = false;
            f.lure = null;
        }
        for (const sh of groups.keys()) sh.alive = false;
        return out;
    },

    /**
     * The diver's fish coming back up: the surface's own within `radius` of (x, y) let go,
     * and each of theirs that is in water seen from above laid back as it was. → how many
     */
    giveBack(list, x, y, radius) {
        if (!this.mask || !Array.isArray(list)) return 0;
        for (const f of this.fish) if (f.alive && Math.hypot(f.x - x, f.y - y) <= radius) { f.alive = false; f.lure = null; }
        const C = this.config();
        const shoals = new Map();
        const at = (u) => (Number.isFinite(u.mx) && Number.isFinite(u.my) && this.swimmable(u.mx, u.my) ? { x: u.mx, y: u.my } : null);
        let n = 0;
        for (const u of list) {
            if (!u || !u.sp || !this.swimmable(u.x, u.y)) continue;
            const f = this._freeFish(C.max);
            if (!f) break;
            const mark = at(u);
            let sh = null;
            if (u.group != null) {
                sh = shoals.get(u.group) || null;
                if (!sh) {
                    sh = this._freeShoal();
                    sh.alive = true; sh.tick = -1;
                    sh.tx = mark ? mark.x : u.x - (u.ox || 0);
                    sh.ty = mark ? mark.y : u.y - (u.oy || 0);
                    shoals.set(u.group, sh);
                }
            }
            f.alive = true; f.sp = u.sp; f.sh = sh;
            f.ox = sh ? Math.max(-1.2, Math.min(1.2, u.ox || 0)) : 0;
            f.oy = sh ? Math.max(-1.2, Math.min(1.2, u.oy || 0)) : 0;
            f.x = u.x; f.y = u.y;
            f.tx = !sh && mark ? mark.x : f.x; f.ty = !sh && mark ? mark.y : f.y;
            f.vx = 0; f.vy = 0; f.ang = Number.isFinite(u.ang) ? u.ang : 0;
            f.wait = this._rand() * 2; f.phase = this._rand() * 4;
            // (they were there all along: no fading in)
            f.age = 3; f.scared = 0; f.glint = 0; f.lure = null; f.nib = 0;
            n++;
        }
        return n;
    },

    /** How many fish the water within `radius` of (x, y) holds, as seen from above (the season's share; at most `most`). */
    countNear(x, y, radius, most = Infinity) {
        if (!this.mask) return 0;
        const C = this.config();
        let n = 0;
        const R = Math.ceil(radius);
        for (let r = Math.max(0, Math.floor(y) - R); r <= Math.min(this.H - 1, Math.floor(y) + R); r++) {
            for (let q = Math.max(0, Math.floor(x) - R); q <= Math.min(this.W - 1, Math.floor(x) + R); q++) {
                const k = this.mask[r * this.W + q];
                if (!k || Math.hypot(q + 0.5 - x, r + 0.5 - y) > radius) continue;
                n += Number(C.perCell[KINDS[k & 7]]) || 0;
            }
        }
        return Math.min(most, Math.round(n * this._seasonK(C)));
    },

    /** The species list (the divers'). */
    _species() {
        const g = DataLoader._gamedata;
        return (g && g.diving && g.diving.fish && g.diving.fish.species) || [];
    },

    /**
     * The deep-water mask for this map (cached on the tiles array and the
     * water's stamp — a ship mooring changes it). → the number of deep cells
     */
    cells(tiles = InnerMap.tiles) {
        const stamp = InnerMap._waterStamp || 0;
        if (this._tiles === tiles && this._stamp === stamp && this.mask) return this.deep;
        const fresh = this._tiles !== tiles;
        this._tiles = tiles;
        this._stamp = stamp;
        const H = tiles ? tiles.length : 0, W = H ? tiles[0].length : 0;
        this.W = W; this.H = H;
        this.mask = new Uint8Array(W * H);
        this.flowX = new Float32Array(W * H);
        this.flowY = new Float32Array(W * H);
        let n = 0;
        // Water all round (the eight cells about it): a cell by the bank is painted half
        // shallows, half shore by the water brush — the fish keep off it
        const wetAt = (q, r) => q < 0 || r < 0 || q >= W || r >= H || !!(tiles[r][q] && (isFishWater(tiles[r][q]) || _underBridge(tiles[r][q])));
        const inner = (q, r) => wetAt(q - 1, r - 1) && wetAt(q, r - 1) && wetAt(q + 1, r - 1) && wetAt(q - 1, r)
            && wetAt(q + 1, r) && wetAt(q - 1, r + 1) && wetAt(q, r + 1) && wetAt(q + 1, r + 1);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                const hidden = !isFishWater(t) && _underBridge(t);
                if (!hidden && !isFishWater(t)) continue;
                if (!inner(q, r)) continue;
                const i = r * W + q;
                this.mask[i] = (KIND_CODE[t._waterKind || (t._sea ? 'sea' : 'pond')] || 3) | (hidden ? HIDDEN : 0);
                const f = t._flow;
                if (this.mask[i] === 1 && f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
                    this.flowX[i] = f.x; this.flowY[i] = f.y;
                }
                if (!hidden) n++;
            }
        }
        this.deep = n;
        if (fresh) this.reset((W * 73856093) ^ (H * 19349663) ^ ((InnerMap.worldQ | 0) * 83492791) ^ (InnerMap.worldR | 0));
        else for (const f of this.fish) if (f.alive && !this.swimmable(f.x, f.y)) f.alive = false;
        return n;
    },

    /** New water: no fish yet, a fresh stream. */
    reset(seed = 1) {
        for (const f of this.fish) f.alive = false;
        for (const s of this.shoals) s.alive = false;
        for (const r of this.ripples) r.alive = false;
        for (const b of this.baits) b.alive = false;
        this.fed.length = 0;
        this._rand = _mulberry(seed);
        this._recount = 0;
        this._last = null;
    },

    _code(x, y) {
        const q = Math.floor(x), r = Math.floor(y);
        if (q < 0 || r < 0 || q >= this.W || r >= this.H) return 0;
        return this.mask[r * this.W + q];
    },

    swimmable(x, y) {
        return this._code(x, y) > 0;
    },

    alive() {
        let n = 0;
        for (const f of this.fish) if (f.alive) n++;
        return n;
    },

    _seasonK(C) {
        const s = String(InnerMap.season || '').toLowerCase();
        for (const k in C.seasons) if (k !== '_doc' && s.includes(k)) return Number(C.seasons[k]) || 0;
        return 1;
    },

    /** How many fish the deep water in range holds. */
    target(range, C = this.config()) {
        let n = 0;
        const q0 = Math.max(0, range.qMin), q1 = Math.min(this.W - 1, range.qMax);
        const r0 = Math.max(0, range.rMin), r1 = Math.min(this.H - 1, range.rMax);
        for (let r = r0; r <= r1; r++) {
            const base = r * this.W;
            for (let q = q0; q <= q1; q++) {
                const k = this.mask[base + q];
                if (k && !(k & HIDDEN)) n += Number(C.perCell[KINDS[k]]) || 0;
            }
        }
        return Math.min(Math.max(0, C.max | 0), Math.round(n * this._seasonK(C)));
    },

    _pickSpecies(kind) {
        let total = 0;
        const list = this._species();
        for (const s of list) if (!s.waters || s.waters.includes(kind)) total += Math.max(0, Number(s.weight) || 1);
        if (!total) return null;
        let x = this._rand() * total;
        for (const s of list) {
            if (s.waters && !s.waters.includes(kind)) continue;
            x -= Math.max(0, Number(s.weight) || 1);
            if (x <= 0) return s;
        }
        return null;
    },

    _freeFish(cap) {
        for (const f of this.fish) if (!f.alive) return f;
        if (this.fish.length >= cap) return null;
        const f = { alive: false };
        this.fish.push(f);
        return f;
    },

    _freeShoal() {
        for (const s of this.shoals) if (!s.alive) return s;
        const s = { alive: false, tx: 0, ty: 0, tick: -1 };
        this.shoals.push(s);
        return s;
    },

    /** A shoal (or a lone fish) in a deep cell picked at random in range, up to `room`. → how many */
    _spawn(range, C, room) {
        const q0 = Math.max(0, range.qMin), q1 = Math.min(this.W - 1, range.qMax);
        const r0 = Math.max(0, range.rMin), r1 = Math.min(this.H - 1, range.rMax);
        if (q1 < q0 || r1 < r0 || room <= 0) return 0;
        for (let tries = 0; tries < 40; tries++) {
            const q = q0 + Math.floor(this._rand() * (q1 - q0 + 1));
            const r = r0 + Math.floor(this._rand() * (r1 - r0 + 1));
            const k = this.mask[r * this.W + q];
            if (!k || (k & HIDDEN)) continue;
            const sp = this._pickSpecies(KINDS[k]);
            if (!sp) return 0;
            const [lo, hi] = Array.isArray(sp.school) ? sp.school : [1, 1];
            const n = Math.max(1, Math.min(room, MAX_SCHOOL, lo + Math.floor(this._rand() * (hi - lo + 1))));
            const cx = q + 0.5, cy = r + 0.5;
            const sh = n > 1 ? this._freeShoal() : null;
            if (sh) { sh.alive = true; sh.tx = cx; sh.ty = cy; sh.tick = -1; }
            const ang = this._rand() * Math.PI * 2;
            let made = 0;
            for (let i = 0; i < n; i++) {
                const f = this._freeFish(C.max);
                if (!f) break;
                const spread = sh ? 0.25 + Math.sqrt(n) * 0.18 : 0;
                let ox = (this._rand() * 2 - 1) * spread, oy = (this._rand() * 2 - 1) * spread;
                if (!this.swimmable(cx + ox, cy + oy)) { ox = 0; oy = 0; }
                f.alive = true; f.sp = sp; f.sh = sh; f.ox = ox; f.oy = oy;
                f.x = cx + ox; f.y = cy + oy; f.tx = f.x; f.ty = f.y;
                f.vx = 0; f.vy = 0; f.ang = ang + (this._rand() - 0.5) * 0.6;
                f.wait = this._rand() * 2; f.phase = this._rand() * 4;
                f.age = 0; f.scared = 0; f.glint = 0;
                made++;
            }
            if (sh && !made) sh.alive = false;
            if (sh) this._newMark(sh, cx, cy, C);
            return made;
        }
        return 0;
    },

    /** A new mark to swim to through deep water; in a river mostly up it. */
    _newMark(m, fx, fy, C) {
        const i = this._code(fx, fy) ? Math.floor(fy) * this.W + Math.floor(fx) : -1;
        const flx = i >= 0 ? this.flowX[i] : 0, fly = i >= 0 ? this.flowY[i] : 0;
        const river = flx || fly;
        const up = river && this._rand() < C.upstream;
        for (let k = 0; k < 10; k++) {
            let a, d;
            if (river) {
                // (blocked that way — a weir, the edge of the map: they hold where they are)
                a = Math.atan2(up ? -fly : fly, up ? -flx : flx) + (this._rand() - 0.5) * 1.2;
                d = 0.8 + this._rand() * 2.2;
            } else {
                a = this._rand() * Math.PI * 2;
                d = 1 + this._rand() * 3.5;
            }
            const x = fx + Math.cos(a) * d, y = fy + Math.sin(a) * d;
            if (!this.swimmable(x, y) || !this._clearBetween(fx, fy, x, y)) continue;
            m.tx = x; m.ty = y;
            return true;
        }
        m.tx = fx; m.ty = fy;
        return false;
    },

    _clearBetween(x0, y0, x1, y1) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
        for (let i = 1; i <= n; i++) if (!this.swimmable(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
        return true;
    },

    _addRipple(f, kind = 'jump') {
        const C = this.config();
        let slot = null;
        for (const r of this.ripples) if (!r.alive) { slot = r; break; }
        if (!slot) {
            if (this.ripples.length >= (C.ripples | 0)) return;
            slot = { alive: false };
            this.ripples.push(slot);
        }
        slot.alive = true; slot.x = f.x; slot.y = f.y; slot.age = 0; slot.sp = f.sp; slot.ang = f.ang; slot.kind = kind;
    },

    // ── Food on the water ──

    /** The feeding rules (data/innerMap.json surfaceFish.feeding). */
    feeding(C = this.config()) {
        return C.feeding || {};
    },

    /** Food thrown from (fx, fy) to land at (x, y) (tiles): food is its feeding.foods entry. → the bait */
    throwBait(fx, fy, x, y, food) {
        const F = this.feeding();
        let b = null;
        for (const o of this.baits) if (!o.alive) { b = o; break; }
        if (!b) { b = { alive: false }; this.baits.push(b); }
        const bites = Math.max(1, Math.round(Number(food && food.bites) || 6));
        Object.assign(b, {
            alive: true, x, y, fx, fy, t: 0, flight: Math.max(0.15, Number(F.flight) || 0.5), landed: false,
            bites, max: bites, age: 0, life: Math.max(5, Number(F.life) || 40), sink: 0, food: food || {},
            comeT: 0.8, came: 0, cool: 0, seed: this._rand() * 1000,
        });
        return b;
    },

    /** Can food float at (x, y)? Any fish water — the edge by the bank too, where the fish don't swim. */
    floatable(x, y) {
        const t = InnerMap.tiles && InnerMap.tiles[Math.floor(y)] && InnerMap.tiles[Math.floor(y)][Math.floor(x)];
        return isFishWater(t);
    },

    /**
     * Where a fish can get to food at (x, y): the spot itself in the fish's water, else the
     * nearest point of it within 1.6 tiles (by the bank they nose up from the deep side). → { x, y } or null
     */
    reachPoint(x, y) {
        if (!this.mask) return null;
        if (this.swimmable(x, y)) return { x, y };
        let best = null, bd = Infinity;
        for (let dy = -1.5; dy <= 1.5; dy += 0.25) {
            for (let dx = -1.5; dx <= 1.5; dx += 0.25) {
                const d = Math.hypot(dx, dy);
                if (d > 1.6 || d >= bd || !this.swimmable(x + dx, y + dy)) continue;
                bd = d; best = { x: x + dx, y: y + dy };
            }
        }
        return best;
    },

    /** Food still floating within d tiles of (x, y)? (landed, not sunk) */
    baitNear(x, y, d) {
        for (const b of this.baits) if (b.alive && b.landed && Math.hypot(b.x - x, b.y - y) <= d) return b;
        return null;
    },

    /**
     * The edge a line cast at (q, r) gets from fish fed there lately: the
     * feeding's biteBonus while food floats near or for fedSeconds after they
     * ate near it, else 0.
     */
    biteBonus(q, r) {
        const F = this.feeding();
        const bonus = Number(F.biteBonus) || 0;
        if (!(bonus > 0)) return 0;
        const x = q + 0.5, y = r + 0.5, near = Number(F.near) || 2.5;
        if (this.baitNear(x, y, near)) return bonus;
        const keep = Number(F.fedSeconds) || 0;
        for (const f of this.fed) if (this._clock - f.at <= keep && Math.hypot(f.x - x, f.y - y) <= near) return bonus;
        return 0;
    },

    /** One bite taken from the bait (by fish f): a ring on the water; the last bite and it's gone. */
    _bite(b, f) {
        b.bites -= 1;
        this._addRipple({ x: b.x + (f.x - b.x) * 0.5, y: b.y + (f.y - b.y) * 0.5, sp: f.sp, ang: f.ang }, 'nibble');
        // (where they were fed: a line here bites the readier for a while)
        const last = this.fed[this.fed.length - 1];
        if (!last || Math.hypot(last.x - b.x, last.y - b.y) > 1 || this._clock - last.at > 5) {
            this.fed.push({ x: b.x, y: b.y, at: this._clock });
            if (this.fed.length > 12) this.fed.shift();
        } else last.at = this._clock;
        if (b.bites <= 0) this._endBait(b);
    },

    _endBait(b) {
        b.alive = false;
        for (const f of this.fish) if (f.lure === b) { f.lure = null; f.wait = 0.5 + this._rand(); }
    },

    /** The baits by dt: in the air, landing, floating (a river carries it), sinking; fish drawn to them. */
    _updateBaits(dt, range, C) {
        const F = this.feeding(C);
        for (const b of this.baits) {
            if (!b.alive) continue;
            if (!b.landed) {
                b.t += dt;
                if (b.t < b.flight) continue;
                b.landed = true;
                // (onto ice or the bank after all: nothing comes for it)
                if (!this.floatable(b.x, b.y)) { b.alive = false; continue; }
                this._addRipple({ x: b.x, y: b.y, sp: null, ang: 0 }, 'splash');
                // (the splash: the fish right under it start, then come back for it)
                for (const f of this.fish) if (f.alive && Math.hypot(f.x - b.x, f.y - b.y) < 0.9) { f.scared = 0.5; f.sx = b.x; f.sy = b.y; }
                continue;
            }
            b.age += dt;
            if (b.cool > 0) b.cool -= dt;
            // A river carries it down
            const i = this._code(b.x, b.y) ? Math.floor(b.y) * this.W + Math.floor(b.x) : -1;
            if (i >= 0) {
                const k = Number(F.drift) || 0;
                const nx = b.x + this.flowX[i] * k * dt, ny = b.y + this.flowY[i] * k * dt;
                if (this.floatable(nx, ny)) { b.x = nx; b.y = ny; }
            }
            // (where the fish can get at it: worked out afresh as it drifts)
            const rp = this.reachPoint(b.x, b.y);
            b.ax = rp ? rp.x : null; b.ay = rp ? rp.y : null;
            if (b.age >= b.life) {
                b.sink += dt;
                if (b.sink >= 2.5) { this._endBait(b); continue; }
                continue;
            }
            // More come up from deeper while it floats (a shoal at a time, near it)
            const draw = Number(b.food.draw) || 1;
            const extra = Math.round((Number(F.extra) || 0) * draw);
            b.comeT -= dt;
            if (b.comeT <= 0 && b.came < extra) {
                b.comeT = Math.max(0.5, Number(F.comeEvery) || 2.5);
                const R = 4;
                const near = { qMin: Math.floor(b.x) - R, qMax: Math.floor(b.x) + R, rMin: Math.floor(b.y) - R, rMax: Math.floor(b.y) + R };
                const capC = this._capC || (this._capC = {});
                Object.assign(capC, C, { max: (C.max | 0) + extra });
                b.came += this._spawn(near, capC, Math.min(3, extra - b.came)) || 1;
            }
            // The fish about it notice, up to its takers
            const pull = Number(F.pull) || 5;
            const most = Math.max(1, Math.round((Number(F.takers) || 6) * Math.min(1.5, draw)));
            let takers = 0;
            for (const f of this.fish) if (f.alive && f.lure === b) takers++;
            if (b.ax == null) continue;
            for (const f of this.fish) {
                if (takers >= most) break;
                if (!f.alive || f.lure || f.scared > 0) continue;
                if (Math.hypot(f.x - b.ax, f.y - b.ay) > pull || !this._clearBetween(f.x, f.y, b.ax, b.ay)) continue;
                f.lure = b;
                f.lureA = this._rand() * Math.PI * 2;
                f.nib = 0.4 + this._rand() * 1.2;
                takers++;
            }
        }
    },

    /**
     * Swim them on by dt seconds. range: the tiles on screen; player: { x, y, inWater } in tiles, or null.
     */
    update(dt, range, player, C = this.config()) {
        if (!this.mask) return;
        dt = Math.min(0.1, Math.max(0, dt));
        if (!dt) return;
        this._tick++;
        // Well off screen: gone
        const pad = 3;
        for (const f of this.fish) {
            if (!f.alive) continue;
            if (f.x < range.qMin - pad || f.x > range.qMax + 1 + pad || f.y < range.rMin - pad || f.y > range.rMax + 1 + pad) f.alive = false;
        }
        for (const s of this.shoals) {
            if (!s.alive) continue;
            let any = false;
            for (const f of this.fish) if (f.alive && f.sh === s) { any = true; break; }
            if (!any) s.alive = false;
        }
        // Meet new ones as the view moves on (all at once on a fresh map, then a shoal at a time)
        this._recount -= dt;
        if (this._recount <= 0) {
            const first = this._last === null;
            this._recount = 1;
            const want = this.target(range, C);
            let have = this.alive();
            for (let n = 0; have < want && n < (first ? 12 : 1); n++) {
                const made = this._spawn(range, C, want - have);
                if (!made) break;
                have += made;
            }
        }
        this._clock += dt;
        this._updateBaits(dt, range, C);
        const F = this.feeding(C);
        const shy = Number(C.shy) || 0;
        const drift = Number(C.drift) || 0;
        for (const f of this.fish) {
            if (!f.alive) continue;
            if (f.lure && (!f.lure.alive || f.lure.sink > 0)) f.lure = null;
            const sp = f.sp;
            const speed = (Number(sp.speed) || 1) * 0.55;
            const i = Math.floor(f.y) * this.W + Math.floor(f.x);
            const flx = this.flowX[i], fly = this.flowY[i];
            const m = f.sh || f;
            // The mark moves on once they are there (a shoal's, once a frame)
            if (f.sh) {
                if (f.sh.tick !== this._tick) {
                    f.sh.tick = this._tick;
                    if (Math.hypot(f.x - f.ox - f.sh.tx, f.y - f.oy - f.sh.ty) < 0.5) {
                        f.wait -= dt;
                        if (f.wait <= 0) { this._newMark(f.sh, f.sh.tx, f.sh.ty, C); f.wait = 1 + this._rand() * 3; }
                    }
                }
            } else if (Math.hypot(f.x - f.tx, f.y - f.ty) < 0.3) {
                f.wait -= dt;
                if (f.wait <= 0) { this._newMark(f, f.x, f.y, C); f.wait = 1 + this._rand() * 3.5; }
            }
            let gx = (f.sh ? m.tx + f.ox : m.tx) - f.x, gy = (f.sh ? m.ty + f.oy : m.ty) - f.y;
            let want = speed;
            // Drawn to food on the water: to its side, nose in, nibbling at it
            const lure = f.lure;
            if (lure && lure.ax == null) { f.lure = null; }
            else if (lure) {
                const L = 0.22 + (Number(sp.length) || 0.5) * 0.45;
                let ox = lure.ax + Math.cos(f.lureA) * L, oy = lure.ay + Math.sin(f.lureA) * L * 0.8;
                if (!this.swimmable(ox, oy)) { ox = lure.ax; oy = lure.ay; }
                gx = ox - f.x;
                gy = oy - f.y;
                want = speed * 1.6;
                if (Math.hypot(gx, gy) < 0.2) {
                    f.nib -= dt;
                    // (one at a time at it: the others jostle until the morsel is free again)
                    if (f.nib <= 0 && lure.cool > 0) f.nib = 0.15 + this._rand() * 0.5;
                    else if (f.nib <= 0) {
                        const [lo, hi] = Array.isArray(F.biteEvery) ? F.biteEvery : [0.6, 1.5];
                        const gap = Number(F.morselEvery) || 0;
                        lure.cool = gap * (0.7 + this._rand() * 0.6);
                        f.nib = lo + this._rand() * Math.max(0, hi - lo);
                        // (a dart in at it)
                        f.vx += (lure.x - f.x) * 1.5; f.vy += (lure.y - f.y) * 1.5;
                        this._bite(lure, f);
                    }
                }
            }
            // The player close by in the water: away, for a moment after too
            if (player && player.inWater) {
                const dd = Math.hypot(f.x - player.x, f.y - player.y);
                if (dd < shy) { f.scared = 1.2; f.sx = player.x; f.sy = player.y; }
            }
            let tvx, tvy;
            if (f.scared > 0) {
                f.scared = Math.max(0, f.scared - dt);
                const sd = Math.hypot(f.x - f.sx, f.y - f.sy) || 1;
                want = speed * C.fleeSpeed;
                tvx = (f.x - f.sx) / sd * want; tvy = (f.y - f.sy) / sd * want;
            } else {
                const gd = Math.hypot(gx, gy);
                if (gd < 0.05) { tvx = 0; tvy = 0; } else {
                    want *= Math.min(1, gd / 0.8);
                    tvx = gx / gd * want; tvy = gy / gd * want;
                }
                // Holding against the current: swimming up it as fast as it carries them down
                tvx -= flx * drift; tvy -= fly * drift;
            }
            const turn = Math.min(1, dt * (f.scared > 0 ? 7 : 2));
            f.vx += (tvx - f.vx) * turn;
            f.vy += (tvy - f.vy) * turn;
            // Moved by its own swimming and by the river
            const mx = f.vx + flx * drift, my = f.vy + fly * drift;
            const nx = f.x + mx * dt, ny = f.y + my * dt;
            const sv = Math.hypot(f.vx, f.vy);
            const nose = 0.22 * (Number(sp.length) || 0.5) / Math.max(0.05, sv);
            if (this.swimmable(nx, ny) && this.swimmable(nx + f.vx * nose, ny + f.vy * nose)) { f.x = nx; f.y = ny; }
            else {
                f.vx *= -0.4; f.vy *= -0.4;
                this._newMark(m, f.sh ? m.tx : f.x, f.sh ? m.ty : f.y, C);
                if (!this.swimmable(m.tx, m.ty)) { m.tx = f.x; m.ty = f.y; }
            }
            // Facing where it swims (into the current, holding against it); at food, toward it
            if (f.lure && Math.hypot(f.lure.x - f.x, f.lure.y - f.y) < 0.7) {
                let d = Math.atan2(f.lure.y - f.y, f.lure.x - f.x) - f.ang;
                d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
                f.ang += d * Math.min(1, dt * 5);
            } else if (sv > 0.04) {
                let d = Math.atan2(f.vy, f.vx) - f.ang;
                d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
                f.ang += d * Math.min(1, dt * 6);
            }
            f.phase += dt * (2 + sv * 6);
            f.age += dt;
            if (f.glint > 0) f.glint = Math.max(0, f.glint - dt);
            else if (this._rand() < C.glint * dt) f.glint = 0.4;
            if (f.age > 2 && f.scared <= 0 && this._rand() < C.jump * dt && !(this._code(f.x, f.y) & HIDDEN)) this._addRipple(f);
        }
        for (const r of this.ripples) {
            if (!r.alive) continue;
            r.age += dt;
            if (r.age >= RIPPLE_LIFE) r.alive = false;
        }
    },

    // ── Drawing ──

    /** A species' back seen from above, facing right, tail at beat b; shadow: all one dark. */
    _sprite(sp, b, shadow, C) {
        if (typeof document === 'undefined') return null;
        const key = `${sp.id}:${b}:${shadow ? 1 : 0}`;
        let c = this._sprites.get(key);
        if (c) return c;
        const W = Math.max(8, Math.round((Number(C.pxPerTile) || 28) * (Number(sp.length) || 0.5)));
        const bw = Math.max(3, Math.round(W * (Number(sp.height) || 0.36) * (Number(C.breadth) || 0.7)));
        const H = bw + 6;
        c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        const cy = H / 2;
        const depth = Number(C.depth) || 0;
        const body = shadow ? '#000' : _mix(sp.back, C.water, depth);
        const fin = shadow ? '#000' : _mix(sp.fin || sp.back, C.water, Math.min(1, depth + 0.15));
        const spine = shadow ? '#000' : _mix(sp.back, '#000000', 0.7);
        const sway = (b - 1) * bw * 0.45;
        const bx = W * 0.58, rx = W * 0.4, ry = bw / 2;
        // Tail: a fork, beating side to side
        x.fillStyle = fin;
        x.beginPath();
        x.moveTo(bx - rx + 1, cy);
        x.lineTo(0, cy - ry * 1.1 + sway);
        x.lineTo(W * 0.08, cy + sway);
        x.lineTo(0, cy + ry * 1.1 + sway);
        x.closePath();
        x.fill();
        // Pectoral fins, out to each side behind the head
        x.beginPath();
        x.moveTo(bx + rx * 0.35, cy - ry * 0.7);
        x.lineTo(bx + rx * 0.05, cy - ry - 2.2);
        x.lineTo(bx - rx * 0.05, cy - ry * 0.6);
        x.moveTo(bx + rx * 0.35, cy + ry * 0.7);
        x.lineTo(bx + rx * 0.05, cy + ry + 2.2);
        x.lineTo(bx - rx * 0.05, cy + ry * 0.6);
        x.fill();
        // The body, broad at the shoulders and tapering to the tail
        x.fillStyle = body;
        x.beginPath();
        x.ellipse(bx, cy, rx, ry, 0, 0, Math.PI * 2);
        x.fill();
        x.beginPath();
        x.moveTo(bx, cy - ry);
        x.lineTo(bx - rx - 1, cy - 0.6);
        x.lineTo(bx - rx - 1, cy + 0.6);
        x.lineTo(bx, cy + ry);
        x.fill();
        if (!shadow) {
            // The light catching the head and shoulders
            x.fillStyle = 'rgba(200,225,235,0.22)';
            x.beginPath();
            x.ellipse(bx + rx * 0.35, cy - ry * 0.25, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2);
            x.fill();
            // The dark line of the spine, a fin on the back
            x.fillStyle = spine;
            x.fillRect(Math.round(bx - rx * 0.75), Math.round(cy - 0.5), Math.round(rx * 1.5), 1);
            if (sp.dorsal) x.fillRect(Math.round(bx - rx * 0.1), Math.round(cy - 1), 3, 2);
        }
        this._sprites.set(key, c);
        return c;
    },

    /**
     * Draw them. origin: the screen spot of tile (qMin, rMin)'s corner; ds: a tile on
     * screen; day: 0 night … 1 noon.
     */
    draw(ctx, origin, ds, range, day, C = this.config()) {
        const tiles = InnerMap.tiles;
        const light = (Number(C.night) || 0) + (1 - (Number(C.night) || 0)) * day;
        const base = (Number(C.alpha) || 0.6) * light;
        const cw = ctx.canvas ? ctx.canvas.width : 1e9, ch = ctx.canvas ? ctx.canvas.height : 1e9;
        const shx = ds * 0.1, shy = ds * 0.16;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        for (const f of this.fish) {
            if (!f.alive) continue;
            if (this._code(f.x, f.y) & HIDDEN) continue;
            const t = tiles[Math.floor(f.y)] && tiles[Math.floor(f.y)][Math.floor(f.x)];
            if (!t || !t.explored || !t.visible) continue;
            const sx = origin.x + (f.x - range.qMin) * ds, sy = origin.y + (f.y - range.rMin) * ds;
            const len = (Number(f.sp.length) || 0.5) * ds;
            if (sx < -len || sx > cw + len || sy < -len || sy > ch + len) continue;
            const beat = TAIL[Math.floor(f.phase) % TAIL.length];
            const spr = this._sprite(f.sp, beat, false, C);
            const shd = this._sprite(f.sp, beat, true, C);
            if (!spr) continue;
            const a = base * Math.min(1, f.age / 1.5);
            if (a <= 0.01) continue;
            const scale = len / spr.width;
            const cs = Math.cos(f.ang), sn = Math.sin(f.ang);
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(f.ang);
            // Its shadow on the bed, down and aside (the same offset whichever way it faces)
            ctx.globalAlpha = a * 0.3;
            ctx.drawImage(shd, (shx * cs + shy * sn) - len / 2, (-shx * sn + shy * cs) - spr.height * scale / 2, len, spr.height * scale);
            ctx.globalAlpha = a;
            ctx.drawImage(spr, -len / 2, -spr.height * scale / 2, len, spr.height * scale);
            // Turning, it shows its side: a flash of silver
            if (f.glint > 0) {
                ctx.globalAlpha = Math.sin(Math.PI * f.glint / 0.4) * 0.8 * (0.3 + 0.7 * day);
                ctx.fillStyle = '#eef8ff';
                ctx.fillRect(-len * 0.25, -Math.max(1, ds * 0.03), len * 0.55, Math.max(1, ds * 0.06));
            }
            ctx.restore();
        }
        // Jumps: the fish out of the water, a splash, a ring of ripples spreading
        ctx.lineWidth = Math.max(1, ds * 0.035);
        for (const r of this.ripples) {
            if (!r.alive || (this._code(r.x, r.y) & HIDDEN)) continue;
            const t = tiles[Math.floor(r.y)] && tiles[Math.floor(r.y)][Math.floor(r.x)];
            if (!t || !t.explored || !t.visible) continue;
            const sx = origin.x + (r.x - range.qMin) * ds, sy = origin.y + (r.y - range.rMin) * ds;
            if (sx < -ds * 2 || sx > cw + ds * 2 || sy < -ds * 2 || sy > ch + ds * 2) continue;
            const k = r.age / RIPPLE_LIFE;
            ctx.strokeStyle = '#e8f6ff';
            // (a nibble: one small ring; a jump or a splash: two spreading wide)
            const nib = r.kind === 'nibble';
            for (let n = 0; n < (nib ? 1 : 2); n++) {
                const kk = k - n * 0.18;
                if (kk <= 0) continue;
                ctx.globalAlpha = (1 - kk) * (nib ? 0.5 : 0.6) * (0.4 + 0.6 * day);
                const rx = (nib ? 0.06 + kk * 0.3 : 0.12 + kk * 0.65) * ds;
                ctx.beginPath();
                ctx.ellipse(sx, sy, rx, rx * 0.62, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (r.age < JUMP_TIME && r.kind !== 'nibble') {
                const j = r.age / JUMP_TIME;
                const lift = Math.sin(Math.PI * j) * ds * 0.4;
                const spr = r.kind === 'jump' && r.sp ? this._sprite(r.sp, 1, false, C) : null;
                if (spr) {
                    const len = (Number(r.sp.length) || 0.5) * ds;
                    const scale = len / spr.width;
                    ctx.save();
                    ctx.translate(sx + Math.cos(r.ang) * j * ds * 0.4, sy - lift);
                    ctx.rotate(r.ang + (j - 0.5) * 0.8 * (Math.cos(r.ang) >= 0 ? 1 : -1));
                    ctx.globalAlpha = 0.95;
                    ctx.drawImage(spr, -len / 2, -spr.height * scale / 2, len, spr.height * scale);
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = '#dfeef5';
                    ctx.fillRect(-len * 0.3, -1, len * 0.6, Math.max(1, ds * 0.04));
                    ctx.restore();
                }
                // Drops thrown up and falling back
                ctx.globalAlpha = (1 - j) * 0.9;
                ctx.fillStyle = '#f2fbff';
                const dsz = Math.max(1, Math.round(ds * 0.05));
                for (let n = 0; n < 5; n++) {
                    const a = n * 1.256 + r.x * 3;
                    ctx.fillRect(sx + Math.cos(a) * j * ds * 0.35, sy - Math.sin(Math.PI * j) * ds * 0.25 * (0.6 + (n % 2) * 0.4) + Math.sin(a) * j * ds * 0.15, dsz, dsz);
                }
            }
        }
        this._drawBaits(ctx, origin, ds, range, day, cw, ch);
        ctx.restore();
    },

    /**
     * Food on the water: in the air, an arc from the hand with its shadow below;
     * landed, a lump (or a scatter of grains) bobbing on the surface, smaller with
     * each bite, going under once it sinks.
     */
    _drawBaits(ctx, origin, ds, range, day, cw, ch) {
        const tiles = InnerMap.tiles;
        const now = this._clock;
        for (const b of this.baits) {
            if (!b.alive) continue;
            const color = b.food.color || '#d6a15a';
            const px = Math.max(1, Math.round(ds * 0.07));
            if (!b.landed) {
                const k = Math.min(1, b.t / b.flight);
                const x = b.fx + (b.x - b.fx) * k, y = b.fy + (b.y - b.fy) * k;
                const lift = Math.sin(Math.PI * k) * ds * (0.6 + Math.hypot(b.x - b.fx, b.y - b.fy) * 0.12);
                const sx = origin.x + (x - range.qMin) * ds, sy = origin.y + (y - range.rMin) * ds;
                if (sx < -ds || sx > cw + ds || sy < -ds * 3 || sy > ch + ds) continue;
                ctx.globalAlpha = 0.25;
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.ellipse(sx, sy, px * 1.4, px * 0.7, 0, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                if (b.food.scatter) {
                    for (let n = 0; n < 5; n++) ctx.fillRect(sx + Math.cos(n * 1.3 + k * 4) * px * (1 + k * 2) - px / 2, sy - lift + Math.sin(n * 2.1) * px * (1 + k), px, px);
                } else ctx.fillRect(sx - px, sy - lift - px, px * 2, px * 2);
                continue;
            }
            const t = tiles[Math.floor(b.y)] && tiles[Math.floor(b.y)][Math.floor(b.x)];
            if (!t || !t.explored || !t.visible) continue;
            const sx = origin.x + (b.x - range.qMin) * ds, sy = origin.y + (b.y - range.rMin) * ds;
            if (sx < -ds || sx > cw + ds || sy < -ds || sy > ch + ds) continue;
            const left = Math.max(0.25, b.bites / Math.max(1, b.max));
            const under = Math.min(1, b.sink / 2.5);
            const bob = Math.sin(now * 2.2 + b.seed) * ds * 0.02;
            ctx.globalAlpha = (1 - under) * (0.55 + 0.45 * day);
            ctx.fillStyle = color;
            if (b.food.scatter) {
                // (grains spread a little on the water, fewer as they are eaten)
                const n = Math.max(1, Math.round(9 * left));
                for (let i = 0; i < n; i++) {
                    const a = b.seed + i * 2.399, d = (0.08 + (i % 4) * 0.06) * ds * (1 + Math.min(1, b.age / 6) * 0.6);
                    ctx.fillRect(Math.round(sx + Math.cos(a) * d - px / 2), Math.round(sy + Math.sin(a) * d * 0.6 + bob - px / 2), px, px);
                }
            } else {
                const w = Math.max(px, Math.round(ds * 0.2 * Math.sqrt(left))), h = Math.max(px, Math.round(w * 0.6));
                ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2 + bob), w, h);
                // (wet: a darker edge where it sits in the water)
                ctx.globalAlpha *= 0.35;
                ctx.fillStyle = '#000';
                ctx.fillRect(Math.round(sx - w / 2), Math.round(sy + h / 2 + bob - px / 2), w, Math.max(1, Math.round(px / 2)));
            }
            // A faint ring where it floats
            ctx.globalAlpha = (1 - under) * 0.25 * (0.4 + 0.6 * day);
            ctx.strokeStyle = '#e8f6ff';
            ctx.lineWidth = Math.max(1, ds * 0.025);
            const rr = ds * (0.22 + 0.04 * Math.sin(now * 1.6 + b.seed));
            ctx.beginPath(); ctx.ellipse(sx, sy + bob, rr, rr * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
    },
};

// (fishing reads where they were fed through ui/fishFed.js)
FishFed.biteBonus = (q, r) => SurfaceFish.biteBonus(q, r);
// The diver's fish are these fish (underwaterFish.js reads them through its hooks)
UnderwaterFish.inherit = (x, y, radius) => (SurfaceFish.cells(InnerMap.tiles) >= 0 ? SurfaceFish.takeNear(x, y, radius) : []);
UnderwaterFish.surfaceCount = (x, y, radius, most) => (SurfaceFish.cells(InnerMap.tiles) >= 0 ? SurfaceFish.countNear(x, y, radius, Math.min(most, SurfaceFish.config().max)) : null);

Object.assign(InnerMapRenderer, {
    /** Fish in the water on screen (called from _renderWaterFx, under the surface's effects). */
    _renderSurfaceFish(ctx, camera) {
        const C = SurfaceFish.config();
        if (!C.enabled || InnerMap._underwater || !InnerMap.tiles || !InnerMap.tiles.length) return;
        if (!SurfaceFish.cells(InnerMap.tiles)) return;
        // Back up from a dive: the fish that were about the diver are the fish about you here
        const back = UnderwaterFish._dive;
        if (back && back.tiles === InnerMap.tiles) {
            const p = UnderwaterFish._diver();
            SurfaceFish.giveBack(UnderwaterFish.handBack(), p.x, p.y, UnderwaterFish.config().radius);
        } else if (back) {
            UnderwaterFish.handBack();
        }
        const range = this._frameRange;
        if (!range) return;
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        const dt = SurfaceFish._last === null ? 0.016 : now - SurfaceFish._last;
        let player = null;
        const pos = InnerMap.getPlayerWorldPos ? InnerMap.getPlayerWorldPos() : null;
        if (pos) {
            const pt = InnerMap.tiles[InnerMap.playerInnerR] && InnerMap.tiles[InnerMap.playerInnerR][InnerMap.playerInnerQ];
            const inWater = !!((InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) || (pt && pt._wet));
            const p = this._surfaceFishPlayer || (this._surfaceFishPlayer = { x: 0, y: 0, inWater: false });
            p.x = pos.x / this.TILE_SIZE; p.y = pos.y / this.TILE_SIZE; p.inWater = inWater;
            player = p;
        }
        SurfaceFish.update(dt, range, player, C);
        SurfaceFish._last = now;
        const T = this.TILE_SIZE, ds = T * camera.zoom;
        const o = camera.worldToScreenFast(range.qMin * T, range.rMin * T);
        const origin = this._surfaceFishOrigin || (this._surfaceFishOrigin = { x: 0, y: 0 });
        origin.x = o.x; origin.y = o.y;
        SurfaceFish.draw(ctx, origin, ds, range, this._waterFxDay ? this._waterFxDay() : 1, C);
    },
});
