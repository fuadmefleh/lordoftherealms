// ============================================================
// INNER MAP — things thrown in the river, carried down it
// ============================================================
// The street map's half of systems/riverDrift.js. Stand by a river (or on a
// ford or a bridge over it), click the water and Throw Something In — or
// pick a good on the hotbar and click the river — and it goes in: the
// current takes it down the river's own course (the runs laid with the
// river, rebuilt from each cell's t._flow: world/innerMap/water.js),
// bobbing, quicker mid-channel, swinging a little across it, round the
// bends, a tributary into the main stream. At the map's edge where the
// river leaves it goes on into the next hex (the world carries it from
// there, hex by hex); where the river runs into the sea it is lost; into
// standing water or the pool a river ends in, it comes to rest. A weir
// across the river — a timber dam built here, or the town mill's weir —
// catches it, piled against the logs, to be taken off.
//
// While the player is on a hex's map its drift is played out here (the
// world's tick holds that hex: RiverDrift.advance opts.hold); on leaving, or
// when hours pass at a stroke (a wait, a sleep), each thing is handed back
// to the world at the point it had reached. Things the world brought in
// show up where the world says they are: coming in at the gate on the side
// they came from, so far down as the hours have carried them.
//
// Fish a thing out from the bank beside it (or a ford, or a bridge) when it
// passes within reach; take things off a weir from its end on the bank.
// Drawn by ui/innerMapLayers/riverDrift.js under the sprites. Settings:
// data/riverDrift.json.

import { InnerMap } from '../world/innerMap.js';
import { RiverDrift } from '../systems/riverDrift.js';
import { Arms } from '../systems/arms.js';
import { PlayerInventory } from '../core/inventory.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DayClock } from './game/dayClock.js';
import { rowList, lede, esc } from './actionMenu/uiKit.js';

const SIDE_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

const _hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
};

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

/** A good's name and icon (as the hotbar shows it) */
function _goodOf(itemId) {
    if (Arms.isArms(itemId)) return { name: Arms.nameOf(itemId), icon: Arms.iconOf(itemId) || '🗡️' };
    const g = (PlayerEconomy.GOODS || {})[String(itemId).toUpperCase()];
    return {
        name: (g && g.name) || String(itemId).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        icon: (g && g.icon) || '📦',
    };
}

/** River water on the map a thing can float on (a bridge or a ford over it too) */
function _riverWater(t) {
    if (!(t && t._wet && t._waterKind === 'river')) return false;
    const id = (t.subTerrain && t.subTerrain.id) || '';
    if (/frozen|ice/.test(id)) return false;
    // (the bank's edge cells are wet but painted as grass: only open water, a ford or a bridge counts)
    return !!(t._ford || t._bridge || /water/.test(id));
}

export const InnerMapRiverDrift = {
    _courseCache: null,
    _damCache: null,
    /** id → { run, s, lat, phase } — the things adrift on this map */
    _live: new Map(),
    _liveTiles: null,
    _liveHex: null,
    /** The world the drift was last played in (for the drawing layer) */
    _world: null,
    _lastNow: null,
    _tick: 0,
    /** What is on this map, where, this frame: [{ item, x, y, kind: 'drift'|'caught'|'rest', fade? }] */
    _shown: [],
    /** Things just lost at sea or gone out of sight, fading */
    _fading: [],

    /** The world clock in hours: the day and the hour on the day's one clock */
    now(game) {
        const w = game && game.world;
        return (w && Number.isFinite(w.day) ? w.day : 0) * 24 + DayClock.now();
    },

    _hex() {
        const at = InnerMap.currentWorldTile;
        return at && Number.isFinite(at.q) ? { q: at.q, r: at.r } : null;
    },

    // ══════════════════════════════════════════════
    // THE RIVER'S COURSE ON THIS MAP
    // ══════════════════════════════════════════════

    /**
     * The runs of the river on this map, rebuilt from the cells' t._flow:
     * { runs: [{ pts: [[x, y, fx, fy]…] (by index, a cell apart), lo, hi, join }], W, H }
     * — cell coordinates, a cell's middle at its whole numbers. Null with no flow kept.
     */
    course(tiles = InnerMap.tiles) {
        const c = this._courseCache;
        if (c && c.tiles === tiles) return c.course;
        let course = null;
        if (tiles && tiles.length) {
            const H = tiles.length, W = tiles[0].length;
            const runs = [];
            for (let r = 0; r < H; r++) {
                const row = tiles[r];
                for (let q = 0; q < W; q++) {
                    const t = row[q];
                    const f = t && t._flow;
                    if (!f || !t._wet || !(f.n > 1) || !(f.run >= 0)) continue;
                    const run = runs[f.run] || (runs[f.run] = { pts: new Array(f.n).fill(null) });
                    if (f.k < run.pts.length && !run.pts[f.k]) run.pts[f.k] = [q + f.cx, r + f.cy, f.x, f.y];
                }
            }
            for (const run of runs) {
                if (!run) continue;
                let lo = run.pts.findIndex(Boolean), hi = run.pts.length - 1;
                while (hi >= 0 && !run.pts[hi]) hi--;
                run.lo = lo; run.hi = hi;
                // (a point no cell was nearest to: between its neighbours)
                for (let k = lo + 1; k < hi; k++) {
                    if (run.pts[k]) continue;
                    let j = k + 1;
                    while (!run.pts[j]) j++;
                    const a = run.pts[k - 1], b = run.pts[j], f = 1 / (j - k + 1);
                    run.pts[k] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2], a[3]];
                }
            }
            const main = runs[0];
            if (main && main.lo >= 0 && main.hi > main.lo) {
                // Each tributary flows into the main stream at the point of it nearest its foot
                for (let i = 1; i < runs.length; i++) {
                    const run = runs[i];
                    if (!run || run.lo < 0 || run.hi <= run.lo) { runs[i] = null; continue; }
                    const [ex, ey] = run.pts[run.hi];
                    let best = main.lo, bd = Infinity;
                    for (let k = main.lo; k <= main.hi; k++) {
                        const d = Math.hypot(main.pts[k][0] - ex, main.pts[k][1] - ey);
                        if (d < bd) { bd = d; best = k; }
                    }
                    run.join = best;
                }
                const [lx, ly] = main.pts[main.hi];
                main.edge = lx < 2.5 || ly < 2.5 || lx > W - 3.5 || ly > H - 3.5;
                course = { runs, W, H };
            }
        }
        this._courseCache = { tiles, course };
        return course;
    },

    /** A point on a run at index s (fractional) → [x, y, fx, fy] */
    _at(run, s) {
        const k = Math.max(run.lo, Math.min(run.hi, s));
        const k0 = Math.floor(k), k1 = Math.min(run.hi, k0 + 1), f = k - k0;
        const a = run.pts[k0], b = run.pts[k1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    },

    /** The run that comes in by side `inDir` of the hex (its head nearest that side's gate); 0 when thrown in here */
    _runFor(world, course, inDir) {
        if (!Number.isInteger(inDir) || !course.runs.length) return 0;
        const hex = this._hex();
        if (!hex || typeof InnerMap._riverGate !== 'function') return 0;
        const jitter = (InnerMap._waterCfg && InnerMap._waterCfg('rivers').edgeJitter) || 10;
        const g = InnerMap._riverGate(world, hex.q, hex.r, inDir, course.W, course.H, jitter);
        let best = 0, bd = Infinity;
        course.runs.forEach((run, i) => {
            if (!run) return;
            const [x, y] = run.pts[run.lo];
            const d = Math.hypot(x - g.q, y - g.r);
            if (d < bd) { bd = d; best = i; }
        });
        return best;
    },

    /**
     * The weir across this map's river, if the hex has one: { kind, name, k
     * (its index down the main run), x, y, fx, fy (downstream), nx, ny
     * (across, left to right looking downstream… either way), a, b (its ends
     * along n, from x, y) }. A mill's weir stands by the mill; a dam a little
     * past the middle of the river's course.
     */
    damLine(world, tiles = InnerMap.tiles) {
        const hex = this._hex();
        const course = this.course(tiles);
        const dam = hex && course && world ? RiverDrift.damAt(world, hex.q, hex.r) : null;
        if (!dam) return null;
        const c = this._damCache;
        if (c && c.tiles === tiles && c.kind === dam.kind && c.q === hex.q && c.r === hex.r) return c.line;
        const main = course.runs[0];
        const cfg = RiverDrift.config();
        let k = Math.round(main.lo + (main.hi - main.lo) * cfg.damAt);
        if (dam.kind === 'mill') {
            // by the mill, where its wheel hangs in the water
            let mill = null;
            for (let r = 0; r < tiles.length && !mill; r++) {
                for (let q = 0; q < tiles[r].length; q++) {
                    const cb = tiles[r][q] && tiles[r][q].customBuilding;
                    if (cb && cb.wheel) { mill = { q, r }; break; }
                }
            }
            if (mill) {
                let bd = Infinity, best = k;
                for (let i = main.lo; i <= main.hi; i++) {
                    const d = Math.hypot(main.pts[i][0] - mill.q, main.pts[i][1] - mill.r);
                    if (d < bd) { bd = d; best = i; }
                }
                if (bd < 16) k = best + 2;
            }
        }
        const span = main.hi - main.lo;
        k = Math.max(main.lo + Math.min(8, span * 0.2), Math.min(main.hi - Math.min(8, span * 0.2), k));
        // across the river's line here (its run over a few cells either way), turned
        // to the shortest way over the channel from bank to bank
        const [x, y] = this._at(main, k);
        const pa = this._at(main, k - 5), pb = this._at(main, k + 5);
        const gl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
        const gx = (pb[0] - pa[0]) / gl, gy = (pb[1] - pa[1]) / gl;
        const wet = (px, py) => {
            const t = tiles[Math.round(py)] && tiles[Math.round(py)][Math.round(px)];
            return _riverWater(t);
        };
        const extent = (nx, ny) => {
            let a = 0, b = 0;
            while (a > -12 && wet(x + nx * (a - 0.25), y + ny * (a - 0.25))) a -= 0.25;
            while (b < 12 && wet(x + nx * (b + 0.25), y + ny * (b + 0.25))) b += 0.25;
            return { a, b };
        };
        let best = null;
        for (let deg = -40; deg <= 40; deg += 5) {
            const r0 = deg * Math.PI / 180, c0 = Math.cos(r0), s0 = Math.sin(r0);
            const fx = gx * c0 - gy * s0, fy = gx * s0 + gy * c0;
            const e = extent(fy, -fx);
            const span = e.b - e.a + Math.abs(deg) * 0.004; // (square to the line, all else equal)
            if (!best || span < best.span) best = { span, fx, fy, ...e };
        }
        const { fx, fy, a, b } = best;
        const nx = fy, ny = -fx;
        const line = { kind: dam.kind, name: dam.name, k, x, y, fx, fy, nx, ny, a: a - 0.35, b: b + 0.35 };
        this._damCache = { tiles, kind: dam.kind, q: hex.q, r: hex.r, line };
        return line;
    },

    // ══════════════════════════════════════════════
    // EACH FRAME
    // ══════════════════════════════════════════════

    /** Each frame, on either map (ui/game/gameLoop.js). */
    update(game, dt) {
        const world = game && game.world;
        this._world = world || null;
        if (!world || !RiverDrift.config().enabled) return;
        const st = RiverDrift.state(world, false);
        const now = this.now(game);
        const onMap = InnerMap.active && !InnerMap._insideBuilding && this.course();
        const hex = onMap ? this._hex() : null;
        // Left the map (or it changed), or hours went by at a stroke: hand the drift back to the world
        const jumped = this._lastNow != null && now - this._lastNow > 0.5;
        if (this._live.size && (!onMap || InnerMap.tiles !== this._liveTiles || jumped)) this._release(world, jumped ? this._lastNow : now);
        this._lastNow = now;
        this._fading = this._fading.filter(f => (f.t += dt) < f.life);
        if (!st || !st.items.length) { this._shown = []; return; }
        // The world carries the rest on (a few times a second is plenty)
        this._tick -= dt;
        if (this._tick <= 0 || jumped) {
            this._tick = 0.25;
            RiverDrift.advance(world, now, hex ? { hold: hex } : {});
        }
        if (!onMap || !hex) { this._shown = []; return; }
        this._liveTiles = InnerMap.tiles;
        this._liveHex = hex;
        this._play(game, dt, now, hex);
    },

    /** The drift on this map, cell by cell */
    _play(game, dt, now, hex) {
        const world = game.world;
        const course = this.course();
        const dam = this.damLine(world);
        const here = RiverDrift.itemsAt(world, hex.q, hex.r);
        const ids = new Set(here.map(it => it.id));
        for (const id of [...this._live.keys()]) if (!ids.has(id)) this._live.delete(id);
        const shown = [];
        const pile = here.filter(it => it.state === 'caught').sort((a, b) => a.since - b.since);
        const resting = here.filter(it => it.state === 'rest');
        for (const it of here) {
            if (it.state !== 'drift') continue;
            let L = this._live.get(it.id);
            if (!L) {
                L = this._enter(world, course, it, now, dam);
                if (!L) continue;
                if (it.state === 'caught') { pile.push(it); continue; }
                this._live.set(it.id, L);
            }
            const res = this._step(game, course, it, L, dt, dam, now, pile.length);
            if (res === 'caught') { pile.push(it); continue; }
            if (res === 'gone' || res === 'rest') { if (res === 'rest') resting.push(it); continue; }
            const [x, y] = this._pos(course, L);
            shown.push({ item: it, x, y, kind: 'drift', phase: L.phase });
        }
        // On the weir: in rows along the logs, the first against them
        if (dam && pile.length) {
            // from mid-channel outward, either side in turn, then a row further back
            const width = Math.max(0.6, dam.b - dam.a - 1.2);
            const per = Math.max(1, Math.floor(width / 0.65) + 1);
            const mid = (dam.a + dam.b) / 2;
            pile.forEach((it, i) => {
                const col = i % per, row = Math.floor(i / per);
                const off = Math.ceil(col / 2) * (col % 2 ? 1 : -1) * 0.65 + (row % 2) * 0.32;
                const lat = Math.max(dam.a + 0.6, Math.min(dam.b - 0.6, mid + off));
                const back = 0.7 + row * 0.6;
                shown.push({ item: it, x: dam.x + dam.nx * lat - dam.fx * back, y: dam.y + dam.ny * lat - dam.fy * back, kind: 'caught', phase: _hash(it.id) * 6.28 });
            });
        }
        // At rest where the river ends (a pool, the lake's edge, a bank)
        resting.forEach((it, i) => {
            const run = course.runs[this._runFor(world, course, it.where === 'lake' ? it.inDir : null)] || course.runs[0];
            const [ex, ey, fx, fy] = this._at(run, run.hi);
            const lat = ((i % 4) - 1.5) * 0.6, back = 0.4 + Math.floor(i / 4) * 0.5;
            shown.push({ item: it, x: ex - fx * back + fy * lat, y: ey - fy * back - fx * lat, kind: 'rest', phase: _hash(it.id) * 6.28 });
        });
        this._shown = shown;
    },

    /**
     * A thing the world has in this hex comes onto the map: at the gate it
     * came in by, as far down as the hours since have carried it. One already
     * past a weir it should have met fetches up on it.
     */
    _enter(world, course, it, now, dam) {
        const cfg = RiverDrift.config();
        const runIdx = this._runFor(world, course, it.inDir);
        const run = course.runs[runIdx];
        if (!run) return null;
        const frac = Math.max(0, Math.min(0.98, (now - it.t0) / cfg.hoursPerHex));
        const s = run.lo + frac * (run.hi - run.lo);
        const L = { run: runIdx, s, lat: 0, phase: _hash(it.id) * 6.28 };
        if (dam && !it.passed && runIdx === 0 && s >= dam.k - 0.7) {
            if (RiverDrift.pileAt(world, it.q, it.r).length < cfg.damCap) RiverDrift.catchAt(world, it, dam, now);
            else it.passed = true;
        }
        return L;
    },

    /** Where a live thing is: on its run, swung across the channel */
    _pos(course, L) {
        const run = course.runs[L.run] || course.runs[0];
        const [x, y, fx, fy] = this._at(run, L.s);
        return [x + fy * L.lat, y - fx * L.lat];
    },

    /** The current moves a thing on. → 'drift' | 'caught' | 'gone' | 'rest' */
    _step(game, course, it, L, dt, dam, now, pileLen) {
        const world = game.world;
        const cfg = RiverDrift.config();
        // Mid-channel it runs fast; swung out toward a bank, slower
        const out = Math.min(1, Math.abs(L.lat) / Math.max(0.5, cfg.wander * 2));
        L.s += cfg.mapSpeed * (1 - cfg.bankSlow * out) * dt;
        const want = cfg.wander * Math.sin(L.phase + L.s * 0.09) * (0.6 + 0.4 * Math.sin(L.phase * 3 + L.s * 0.031));
        L.lat += (want - L.lat) * Math.min(1, dt * 0.7);
        let run = course.runs[L.run];
        if (!run) { L.run = 0; run = course.runs[0]; }
        // Into the main stream at the join
        if (L.run > 0 && L.s >= run.hi) {
            L.s = run.join;
            L.run = 0;
            run = course.runs[0];
            if (dam && L.s > dam.k) it.passed = true;
        }
        // Up against the weir
        if (dam && L.run === 0 && !it.passed && L.s >= dam.k - 0.7) {
            if (pileLen < cfg.damCap) {
                RiverDrift.catchAt(world, it, dam, now);
                this._live.delete(it.id);
                if (it.by === 'player') _note(game, '🌲 Caught on the Weir', `The ${it.name} fetches up against ${dam.kind === 'mill' ? 'the mill weir' : 'the dam'}, and stays there.`, 'info');
                return 'caught';
            }
            it.passed = true; // a full weir: over it goes
        }
        if (L.run === 0 && L.s >= run.hi) {
            const [x, y] = this._pos(course, L);
            this._live.delete(it.id);
            const ev = RiverDrift.passOn(world, it, now);
            if (ev === 'rest') return 'rest';
            const sea = ev === 'lost';
            if (sea) RiverDrift.remove(world, it.id);
            this._fading.push({ item: it, x, y, t: 0, life: sea ? 2.5 : 1.2, sea, phase: L.phase });
            if (it.by === 'player') {
                if (sea) _note(game, '🌊 Out to Sea', `The ${it.name} is carried out to sea, and is gone.`, 'info');
                else if (ev === 'lake') _note(game, '🌊 Into the Lake', `The ${it.name} drifts out onto the lake.`, 'info');
                else _note(game, '🌊 Downstream', `The ${it.name} bobs out of sight, carried on downstream.`, 'info');
            }
            return 'gone';
        }
        return 'drift';
    },

    /** Hand this map's drift back to the world at the hour `at`: how far down each had got */
    _release(world, at) {
        const course = this._liveTiles ? this.course(this._liveTiles) : null;
        const hph = RiverDrift.config().hoursPerHex;
        for (const [id, L] of this._live) {
            const it = RiverDrift.find(world, id);
            if (!it || it.state !== 'drift' || !course) continue;
            const run = course.runs[L.run] || course.runs[0];
            let frac = run.hi > run.lo ? (L.s - run.lo) / (run.hi - run.lo) : 0.5;
            if (L.run > 0) frac *= 0.5;
            it.t0 = at - Math.max(0, Math.min(0.98, frac)) * hph;
        }
        this._live.clear();
        this._liveTiles = null;
    },

    // ══════════════════════════════════════════════
    // THROWING IN, FISHING OUT
    // ══════════════════════════════════════════════

    /** Is (q, r) river water a thing could be thrown into (running water, with its flow kept)? */
    isRiverCell(q, r) {
        const t = InnerMap.getTile(q, r);
        return !!(_riverWater(t) && t._flow && this.course() && !InnerMap._insideBuilding);
    },

    /** How far (cells, the larger of across and down) the player stands from (x, y) */
    _playerDist(x, y) {
        return Math.max(Math.abs(InnerMap.playerInnerQ - x), Math.abs(InnerMap.playerInnerR - y));
    },

    /** Goods the player could throw: [{ itemId, qty, name, icon }] */
    throwables(player) {
        const inv = (player && player.inventory) || {};
        return Object.keys(inv).filter(id => id !== 'gold' && inv[id] > 0)
            .filter(id => !(Arms.isArms(id) && Arms.isEquipped(player, id) && inv[id] <= 1))
            .map(id => ({ itemId: id, qty: inv[id], ..._goodOf(id) }));
    },

    /**
     * Throw one of `itemId` into the river at (q, r). The player must be
     * within a few cells (opts.walk: walk there first). opts.keep: the caller
     * takes it from the packs (the hotbar does). → true when it went in
     */
    throwItem(game, itemId, q, r, opts = {}) {
        const player = game && game.player;
        const world = game && game.world;
        if (!player || !world || !itemId) return false;
        if (!this.isRiverCell(q, r)) { _note(game, '🌊 Not Here', 'Throw it where the river runs.', 'warning'); return false; }
        const inv = player.inventory || {};
        if (!(inv[itemId] > 0)) { _note(game, '🌊 Nothing to Throw', 'You have none of that left.', 'warning'); return false; }
        if (Arms.isArms(itemId) && Arms.isEquipped(player, itemId) && inv[itemId] <= 1) {
            _note(game, '🌊 Not That', 'You are wearing it. Put it away first.', 'warning');
            return false;
        }
        if (this._playerDist(q, r) > 4) {
            if (!opts.walk) { _note(game, '🌊 Too Far', 'Get closer to the water first.', 'warning'); return false; }
            const how = InnerMap.approachAndThen(q, r, () => this.throwItem(game, itemId, q, r, { ...opts, walk: false }));
            if (how === 'unreachable') _note(game, '🌊 Too Far', 'You can\'t get to the bank there.', 'warning');
            return false;
        }
        const hex = this._hex();
        const t = InnerMap.getTile(q, r);
        const f = t._flow;
        const course = this.course();
        const run = course.runs[f.run] || course.runs[0];
        const good = _goodOf(itemId);
        const frac = f.run === 0 && run.hi > run.lo ? (f.k - run.lo) / (run.hi - run.lo) : 0.1;
        const res = RiverDrift.throwIn(world, hex.q, hex.r, { itemId, name: good.name, icon: good.icon, qty: 1 }, this.now(game), { frac, by: 'player' });
        if (!res.ok) { _note(game, '🌊 Not Here', res.reason || 'It won\'t go in here.', 'warning'); return false; }
        if (!opts.keep) {
            inv[itemId]--;
            if (inv[itemId] <= 0) delete inv[itemId];
        }
        if (res.sank) {
            _note(game, '🌊 Plop', `You toss the ${good.name} in. It sinks like a stone.`, 'info');
        } else {
            // On the water where it landed, swung across the channel as far as that cell is off the line
            const it = res.item;
            const L = { run: f.run, s: f.k, lat: 0, phase: _hash(it.id) * 6.28 };
            const [lx, ly] = this._pos(course, L);
            L.lat = Math.max(-2, Math.min(2, (q - lx) * f.y - (r - ly) * f.x));
            const dam = this.damLine(world);
            if (dam && f.run === 0 && f.k > dam.k) it.passed = true;
            else if (dam && f.run === 0) it.passed = false;
            this._live.set(it.id, L);
            this._liveTiles = InnerMap.tiles;
            const out = RiverDrift.outflow(world, hex.q, hex.r);
            _note(game, '🌊 Into the River', `You toss the ${good.name} in. The current takes it${out != null ? `, off ${SIDE_NAMES[out]}ward` : ''}.`, 'info');
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return true;
    },

    /** The things shown near cell (q, r) on this map */
    thingsAt(q, r, within = 1.1) {
        return this._shown.filter(s => Math.max(Math.abs(s.x - q), Math.abs(s.y - r)) <= within);
    },

    /** Take a thing out of the water into the packs. → true when taken */
    takeOut(game, id) {
        const world = game.world, player = game.player;
        const it = RiverDrift.find(world, id);
        if (!it) { _note(game, '🌊 Gone', 'It has drifted away.', 'warning'); return false; }
        if (!PlayerInventory.addItem(player, it.itemId, it.qty || 1).success) {
            _note(game, '🎒 Inventory Full', PlayerInventory.fullMessage(player), 'warning');
            return false;
        }
        RiverDrift.take(world, id);
        this._live.delete(id);
        this._shown = this._shown.filter(s => s.item.id !== id);
        const off = it.state === 'caught' ? 'off the weir' : 'out of the water';
        _note(game, `${it.icon} Fished Out`, `You hook the ${it.name} ${off}, dripping.`, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return true;
    },

    // ══════════════════════════════════════════════
    // THE MENU
    // ══════════════════════════════════════════════

    /** Entries for a clicked cell: throw something in; fish out what floats or lies there */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || !RiverDrift.config().enabled) return [];
        const out = [];
        const cfg = RiverDrift.config();
        for (const s of this.thingsAt(q, r).slice(0, 4)) {
            const it = s.item;
            const label = s.kind === 'caught' ? `Take the ${it.name} off the Weir` : `Fish Out the ${it.name}`;
            const desc = s.kind === 'caught' ? 'From the end of the weir, on the bank'
                : s.kind === 'drift' ? `Drifting by: reach it from the bank, a ford or a bridge (${cfg.reach} cells)` : 'Lying on the water where the river ends';
            out.push({ type: 'action', action: 'drift_take', icon: it.icon || '🎣', label, desc, driftId: it.id });
        }
        if (this.isRiverCell(q, r)) {
            const any = this.throwables(game.player).length > 0;
            if (any) out.push({ type: 'action', action: 'drift_throw', icon: '🌊', label: 'Throw Something In', desc: 'Toss something from your packs into the river and watch the current take it' });
        }
        return out;
    },

    /** Run a drift entry. → true when handled */
    handle(game, item, q, r) {
        if (!item || !/^drift_/.test(item.action || '')) return false;
        if (item.action === 'drift_throw') { this.showThrowPicker(game, q, r); return true; }
        if (item.action === 'drift_take') { this._reachAndTake(game, item.driftId); return true; }
        return false;
    },

    /** Go to the bank by a thing (the weir's end, for one caught on it) and take it */
    _reachAndTake(game, id) {
        const cfg = RiverDrift.config();
        const s = this._shown.find(x => x.item.id === id);
        if (!s) { _note(game, '🌊 Gone', 'It has drifted away.', 'warning'); return; }
        const dam = s.kind === 'caught' ? this.damLine(game.world) : null;
        let tq = Math.round(s.x), tr = Math.round(s.y);
        if (dam) {
            // the nearer end of the weir
            const ends = [dam.a, dam.b].map(e => ({ q: Math.round(dam.x + dam.nx * e), r: Math.round(dam.y + dam.ny * e) }));
            ends.sort((a, b) => this._playerDist(a.q, a.r) - this._playerDist(b.q, b.r));
            tq = ends[0].q; tr = ends[0].r;
        }
        const reach = dam ? cfg.damReach : cfg.reach;
        const close = () => {
            const now = this._shown.find(x => x.item.id === id);
            if (!now) return false;
            return dam ? this._playerDist(tq, tr) <= reach + 0.5 : this._playerDist(now.x, now.y) <= reach + 0.5;
        };
        if (close()) { this.takeOut(game, id); return; }
        const how = InnerMap.approachAndThen(tq, tr, () => {
            if (close()) this.takeOut(game, id);
            else _note(game, '🌊 Out of Reach', 'The current carries it on past you.', 'warning');
        });
        if (how === 'unreachable') _note(game, '🌊 Out of Reach', 'You can\'t get to the bank beside it.', 'warning');
    },

    /** The packs, to pick what goes in the river */
    showThrowPicker(game, q, r) {
        const goods = this.throwables(game.player);
        if (!goods.length) { _note(game, '🌊 Nothing to Throw', 'Your packs are empty.', 'warning'); return; }
        const rows = goods.slice(0, 40).map(g => ({
            icon: g.icon, name: esc(g.name),
            desc: RiverDrift.sinks(g.itemId) ? 'Heavy: it will sink' : 'It will float off downstream',
            side: `×${g.qty}`,
            attrs: `onclick="window.__riverThrow && window.__riverThrow('${esc(g.itemId)}')"`,
        }));
        window.__riverThrow = (itemId) => {
            if (game.ui && typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
            this.throwItem(game, itemId, q, r, { walk: true });
        };
        game.ui.showCustomPanel('🌊 Throw Something In', `<div>${lede('Pick something to toss into the river. One at a time.')}${rowList(rows)}</div>`);
    },
};
