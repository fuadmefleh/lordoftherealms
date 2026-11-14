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
// Still water (a lake, a pond, a deep pool, the sea: anywhere too deep to
// stand in) takes a thing too: it floats where it lands, turning slowly,
// until it sinks; at sea the ocean current carries it off. The river brings
// things of its own down past the player now and then (sticks, logs, reeds,
// what people lose: systems/riverFlotsam.js). And a fishing net can be set
// across a river or out on still water (systems/riverNets.js): it stays,
// fishing and catching what drifts into it, to be hauled in, mended or taken
// up again.
//
// Drawn by ui/innerMapLayers/riverDrift.js under the sprites. Settings:
// data/riverDrift.json.

import { InnerMap } from '../world/innerMap.js';
import { RiverDrift } from '../systems/riverDrift.js';
import { RiverFlotsam } from '../systems/riverFlotsam.js';
import { RiverNets } from '../systems/riverNets.js';
import { OceanCurrents } from '../world/oceanCurrents.js';
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
    /** net id → { tiles, line }: a river net's line across the channel */
    _netCache: new Map(),
    /** item id → where the sea has carried it (a step at a time) */
    _seaCache: new Map(),
    _curCache: null,
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
        const line = { kind: dam.kind, name: dam.name, k, ...this._across(tiles, main, k) };
        this._damCache = { tiles, kind: dam.kind, q: hex.q, r: hex.r, line };
        return line;
    },

    /**
     * The line across a run at index k: { x, y, fx, fy (downstream), nx, ny
     * (across), a, b (its ends along n, from x, y: bank to bank) } — the
     * river's line here (its run over a few cells either way), turned to the
     * shortest way over the channel.
     */
    _across(tiles, run, k) {
        const [x, y] = this._at(run, k);
        const pa = this._at(run, k - 5), pb = this._at(run, k + 5);
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
        return { x, y, fx, fy, nx: fy, ny: -fx, a: a - 0.35, b: b + 0.35 };
    },

    // ══════════════════════════════════════════════
    // EACH FRAME
    // ══════════════════════════════════════════════

    /** Each frame, on either map (ui/game/gameLoop.js). */
    update(game, dt) {
        const world = game && game.world;
        this._world = world || null;
        if (!world || !RiverDrift.config().enabled) return;
        const now = this.now(game);
        const onMap = !!(InnerMap.active && !InnerMap._insideBuilding && InnerMap.tiles);
        const course = onMap ? this.course() : null;
        const hex = onMap ? this._hex() : null;
        // Left the map (or it changed), or hours went by at a stroke: hand the drift back to the world
        const jumped = this._lastNow != null && now - this._lastNow > 0.5;
        if (this._live.size && (!course || InnerMap.tiles !== this._liveTiles || jumped)) this._release(world, jumped ? this._lastNow : now);
        this._lastNow = now;
        this._fading = this._fading.filter(f => (f.t += dt) < f.life);
        // Watching a river: now and then the river brings something down into this hex (systems/riverFlotsam.js)
        if (hex && course) RiverFlotsam.watch(world, hex.q, hex.r, now);
        const st = RiverDrift.state(world, false);
        const any = st && (st.items.length || (st.nets && st.nets.length));
        if (!any) { this._shown = []; return; }
        // The world carries the rest on (a few times a second is plenty)
        this._tick -= dt;
        if (this._tick <= 0 || jumped) {
            this._tick = 0.25;
            RiverDrift.advance(world, now, hex && course ? { hold: hex } : {});
        }
        if (!hex) { this._shown = []; return; }
        this._liveTiles = InnerMap.tiles;
        this._liveHex = hex;
        this._play(game, dt, now, hex);
    },

    /** The drift on this map, cell by cell; still water's floaters; the net and its catch */
    _play(game, dt, now, hex) {
        const world = game.world;
        const course = this.course();
        const dam = course ? this.damLine(world) : null;
        const net = RiverDrift.netAt(world, hex.q, hex.r);
        const nline = net && !net.still && course ? this.netLine(world, net) : null;
        const here = RiverDrift.itemsAt(world, hex.q, hex.r);
        const ids = new Set(here.map(it => it.id));
        for (const id of [...this._live.keys()]) if (!ids.has(id)) this._live.delete(id);
        const shown = [];
        const pile = here.filter(it => it.state === 'caught').sort((a, b) => a.since - b.since);
        const resting = here.filter(it => it.state === 'rest' && !it.cell);
        const afloat = here.filter(it => it.state === 'rest' && it.cell);
        if (course) {
            for (const it of here) {
                if (it.state !== 'drift') continue;
                let L = this._live.get(it.id);
                if (!L) {
                    L = this._enter(game, course, it, now, dam, nline, net);
                    if (!L) continue;
                    if (it.state === 'caught') { pile.push(it); continue; }
                    if (L === 'netted') continue;
                    this._live.set(it.id, L);
                }
                const res = this._step(game, course, it, L, dt, dam, now, pile.length, nline, net);
                if (res === 'caught') { pile.push(it); continue; }
                if (res === 'gone' || res === 'rest' || res === 'netted') { if (res === 'rest') resting.push(it); continue; }
                const [x, y] = this._pos(course, L);
                shown.push({ item: it, x, y, kind: 'drift', phase: L.phase });
            }
        }
        // On the weir: in rows along the logs, the first against them
        if (dam && pile.length) this._rowUp(pile, dam, 'caught', shown);
        // At rest where the river ends (a pool, the lake's edge, a bank)
        if (course) {
            resting.forEach((it, i) => {
                const run = course.runs[this._runFor(world, course, it.where === 'lake' ? it.inDir : null)] || course.runs[0];
                const [ex, ey, fx, fy] = this._at(run, run.hi);
                const lat = ((i % 4) - 1.5) * 0.6, back = 0.4 + Math.floor(i / 4) * 0.5;
                shown.push({ item: it, x: ex - fx * back + fy * lat, y: ey - fy * back - fx * lat, kind: 'rest', phase: _hash(it.id) * 6.28 });
            });
        }
        // Afloat on still water where it was thrown in (at sea, going with the current)
        for (const it of afloat) {
            const p = it.where === 'sea' ? this._seaPos(it, now) : this._stillPos(it, now);
            if (p) shown.push({ item: it, x: p.x, y: p.y, kind: 'rest', phase: _hash(it.id) * 6.28 });
        }
        // The net's catch: held against the meshes
        if (net && net.catch && net.catch.length) {
            const items = net.catch.map((e, i) => ({ ...e, id: `${net.id}:${i}` }));
            if (nline) this._rowUp(items, nline, 'net', shown, net);
            else if (net.still && net.cell) {
                items.forEach((e, i) => {
                    const a = (i / Math.max(1, items.length)) * Math.PI * 2 + 0.4, d = 0.6 + (i % 2) * 0.35;
                    shown.push({ item: e, x: net.cell.x + Math.cos(a) * d * 1.4, y: net.cell.y + Math.sin(a) * d * 0.7, kind: 'net', netId: net.id, phase: _hash(e.id) * 6.28 });
                });
            }
        }
        this._shown = shown;
    },

    /** Things in rows along a line across the river (a weir's pile, a net's catch), upstream of it */
    _rowUp(list, line, kind, shown, net = null) {
        // from mid-channel outward, either side in turn, then a row further back
        const width = Math.max(0.6, line.b - line.a - 1.2);
        const per = Math.max(1, Math.floor(width / 0.65) + 1);
        const mid = (line.a + line.b) / 2;
        list.forEach((it, i) => {
            const col = i % per, row = Math.floor(i / per);
            const off = Math.ceil(col / 2) * (col % 2 ? 1 : -1) * 0.65 + (row % 2) * 0.32;
            const lat = Math.max(line.a + 0.6, Math.min(line.b - 0.6, mid + off));
            const back = (kind === 'net' ? 0.45 : 0.7) + row * 0.6;
            const s = { item: it, x: line.x + line.nx * lat - line.fx * back, y: line.y + line.ny * lat - line.fy * back, kind, phase: _hash(it.id) * 6.28 };
            if (net) s.netId = net.id;
            shown.push(s);
        });
    },

    /** A thing afloat on still water: where it landed, turning slowly about */
    _stillPos(it, now) {
        const ph = _hash(it.id) * 6.28;
        return { x: it.cell.x + Math.sin(ph + now * 3) * 0.22, y: it.cell.y + Math.cos(ph * 1.7 + now * 2.3) * 0.14 };
    },

    /**
     * A thing afloat at sea: carried by the ocean current from where it went
     * in (seaSpeed cells an hour), held up on the shore if it fetches up on
     * one; null once it has gone off the map.
     */
    _seaPos(it, now) {
        const cur = it.cur;
        if (!cur || !(cur.x || cur.y)) return this._stillPos(it, now);
        const dist = Math.max(0, now - it.since) * RiverDrift.config().seaSpeed;
        const c = this._seaCache.get(it.id);
        const step = Math.floor(dist * 2);
        if (c && c.tiles === InnerMap.tiles && c.step === step) return c.p;
        const l = Math.hypot(cur.x, cur.y) || 1, ux = cur.x / l, uy = cur.y / l;
        let x = it.cell.x, y = it.cell.y, p = null;
        for (let d = 0; d <= dist; d += 0.5) {
            const nx = it.cell.x + ux * d, ny = it.cell.y + uy * d;
            const t = InnerMap.getTile(Math.round(nx), Math.round(ny));
            if (!t) { p = null; x = null; break; } // off the map: gone
            if (!(t._wet || t._sea)) break; // up against the shore
            x = nx; y = ny;
        }
        if (x != null) p = { x, y };
        this._seaCache.set(it.id, { tiles: InnerMap.tiles, step, p });
        return p;
    },

    /**
     * A thing the world has in this hex comes onto the map: at the gate it
     * came in by, as far down as the hours since have carried it. One already
     * past a weir or a net it should have met fetches up on it.
     * → its live state, 'netted', or null
     */
    _enter(game, course, it, now, dam, nline, net) {
        const world = game.world;
        const cfg = RiverDrift.config();
        const runIdx = this._runFor(world, course, it.inDir);
        const run = course.runs[runIdx];
        if (!run) return null;
        const frac = Math.max(0, Math.min(0.98, (now - it.t0) / cfg.hoursPerHex));
        const s = run.lo + frac * (run.hi - run.lo);
        const L = { run: runIdx, s, lat: 0, phase: _hash(it.id) * 6.28 };
        const met = this._meet(game, it, L, dam, nline, net, now, RiverDrift.pileAt(world, it.q, it.r).length, false);
        if (met === 'netted') return 'netted';
        return L;
    },

    /**
     * Has the thing come up against the net or the weir (whichever it meets
     * first)? It goes into the net / onto the weir, or (full) slips by.
     * → 'caught' | 'netted' | null
     */
    _meet(game, it, L, dam, nline, net, now, pileLen, tell = true) {
        const world = game.world;
        const cfg = RiverDrift.config();
        const stops = [];
        if (nline && net && !it.netPast && L.run === nline.run && L.s >= nline.k - 0.5) stops.push({ k: nline.k, net: true });
        if (dam && !it.passed && L.run === 0 && L.s >= dam.k - 0.7) stops.push({ k: dam.k, dam: true });
        stops.sort((a, b) => a.k - b.k);
        for (const s of stops) {
            if (s.net) {
                if (RiverDrift.snare(world, it, net, now)) {
                    RiverDrift.remove(world, it.id);
                    this._live.delete(it.id);
                    if (tell && it.by === 'player') _note(game, '🥅 In the Net', `The ${it.name} drifts into your net, and stays there.`, 'info');
                    return 'netted';
                }
                it.netPast = true; // full, or torn: it slips by
            } else {
                if (pileLen < cfg.damCap) {
                    RiverDrift.catchAt(world, it, dam, now);
                    this._live.delete(it.id);
                    if (tell && it.by === 'player') _note(game, '🌲 Caught on the Weir', `The ${it.name} fetches up against ${dam.kind === 'mill' ? 'the mill weir' : 'the dam'}, and stays there.`, 'info');
                    return 'caught';
                }
                it.passed = true; // a full weir: over it goes
            }
        }
        return null;
    },

    /** Where a live thing is: on its run, swung across the channel */
    _pos(course, L) {
        const run = course.runs[L.run] || course.runs[0];
        const [x, y, fx, fy] = this._at(run, L.s);
        return [x + fy * L.lat, y - fx * L.lat];
    },

    /** The current moves a thing on. → 'drift' | 'caught' | 'netted' | 'gone' | 'rest' */
    _step(game, course, it, L, dt, dam, now, pileLen, nline = null, net = null) {
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
            if (nline && nline.run === 0 && L.s > nline.k) it.netPast = true;
        }
        // Up against the net, or the weir
        const met = this._meet(game, it, L, dam, nline, net, now, pileLen);
        if (met) return met;
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

    /**
     * Is (q, r) still water deep enough for a thing to float on (a lake, a
     * pond, a deep pool, the sea: water you can't stand in)? → 'pond' |
     * 'lake' | 'sea', or null
     */
    stillWaterAt(q, r) {
        if (InnerMap._insideBuilding || this.isRiverCell(q, r)) return null;
        if (typeof InnerMap.isDivable !== 'function' || !InnerMap.isDivable(q, r)) return null;
        const t = InnerMap.getTile(q, r);
        if (!t) return null;
        if (t._waterKind === 'sea' || (t._sea && t._waterKind !== 'lake' && t._waterKind !== 'pond')) return 'sea';
        if (t._waterKind === 'lake') return 'lake';
        return 'pond';
    },

    /** Water a thing can be thrown into here: a river, or still water deep enough */
    isThrowCell(q, r) {
        return this.isRiverCell(q, r) || !!this.stillWaterAt(q, r);
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

    /** The ocean current off this hex as a way across the street map ({ x, y }, scaled by its strength), or null */
    _seaCurrent(world, hex) {
        const key = `${hex.q},${hex.r}`;
        if (this._curCache && this._curCache.key === key && this._curCache.world === world) return this._curCache.cur;
        let cur = null;
        try {
            const c = OceanCurrents.near(world, hex.q, hex.r);
            if (c && c.strength > 0) cur = { x: c.x * c.strength, y: c.y * c.strength };
        } catch { cur = null; }
        this._curCache = { key, world, cur };
        return cur;
    },

    /**
     * Throw one of `itemId` into the water at (q, r): a river (the current
     * takes it), or still water (it floats where it lands; at sea the current
     * carries it off). The player must be within a few cells (opts.walk: walk
     * there first). opts.keep: the caller takes it from the packs (the hotbar
     * does). → true when it went in
     */
    throwItem(game, itemId, q, r, opts = {}) {
        const player = game && game.player;
        const world = game && game.world;
        if (!player || !world || !itemId) return false;
        const river = this.isRiverCell(q, r);
        const still = river ? null : this.stillWaterAt(q, r);
        if (!river && !still) { _note(game, '🌊 Not Here', 'Throw it where the water is deep enough to float it.', 'warning'); return false; }
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
        const good = _goodOf(itemId);
        const what = { itemId, name: good.name, icon: good.icon, qty: 1 };
        let res;
        if (river) {
            const f = InnerMap.getTile(q, r)._flow;
            const course = this.course();
            const run = course.runs[f.run] || course.runs[0];
            const frac = f.run === 0 && run.hi > run.lo ? (f.k - run.lo) / (run.hi - run.lo) : 0.1;
            res = RiverDrift.throwIn(world, hex.q, hex.r, what, this.now(game), { frac, by: 'player' });
            if (res.ok && !res.sank) {
                // On the water where it landed, swung across the channel as far as that cell is off the line
                const it = res.item;
                const L = { run: f.run, s: f.k, lat: 0, phase: _hash(it.id) * 6.28 };
                const [lx, ly] = this._pos(course, L);
                L.lat = Math.max(-2, Math.min(2, (q - lx) * f.y - (r - ly) * f.x));
                const dam = this.damLine(world);
                if (dam && f.run === 0 && f.k > dam.k) it.passed = true;
                else if (dam && f.run === 0) it.passed = false;
                const net = RiverDrift.netAt(world, hex.q, hex.r);
                const nline = net && !net.still ? this.netLine(world, net) : null;
                if (nline) it.netPast = f.run === nline.run && f.k > nline.k;
                this._live.set(it.id, L);
                this._liveTiles = InnerMap.tiles;
            }
        } else {
            const cur = still === 'sea' ? this._seaCurrent(world, hex) : null;
            res = RiverDrift.throwStill(world, hex.q, hex.r, what, this.now(game), { cell: { x: q, y: r }, water: still, cur, by: 'player' });
        }
        if (!res.ok) { _note(game, '🌊 Not Here', res.reason || 'It won\'t go in here.', 'warning'); return false; }
        if (!opts.keep) {
            inv[itemId]--;
            if (inv[itemId] <= 0) delete inv[itemId];
        }
        if (res.sank) {
            _note(game, '🌊 Plop', `You toss the ${good.name} in. It sinks like a stone.`, 'info');
        } else if (river) {
            const out = RiverDrift.outflow(world, hex.q, hex.r);
            _note(game, '🌊 Into the River', `You toss the ${good.name} in. The current takes it${out != null ? `, off ${SIDE_NAMES[out]}ward` : ''}.`, 'info');
        } else if (res.item && res.item.where === 'sea') {
            _note(game, '🌊 Into the Sea', `You toss the ${good.name} in. It rides the swell, and the current begins to take it away.`, 'info');
        } else {
            _note(game, '🌊 Splash', `You toss the ${good.name} in. It bobs where it landed, turning slowly on the still water.`, 'info');
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return true;
    },

    /** The things shown near cell (q, r) on this map */
    thingsAt(q, r, within = 1.1) {
        return this._shown.filter(s => s.kind !== 'net' && Math.max(Math.abs(s.x - q), Math.abs(s.y - r)) <= within);
    },

    /** Take a thing out of the water into the packs. → true when taken */
    takeOut(game, id) {
        const world = game.world, player = game.player;
        const it = RiverDrift.find(world, id);
        if (!it) { _note(game, '🌊 Gone', 'It has drifted away.', 'warning'); return false; }
        const got = RiverFlotsam.receive(world, player, it, it);
        if (!got.ok) {
            _note(game, '🎒 Inventory Full', PlayerInventory.fullMessage(player), 'warning');
            return false;
        }
        RiverDrift.take(world, id);
        this._live.delete(id);
        this._shown = this._shown.filter(s => s.item.id !== id);
        const off = it.state === 'caught' ? 'off the weir' : 'out of the water';
        let text = `You hook the ${it.name} ${off}, dripping.`;
        if (got.coins) text += ` Inside: ${got.coins} gold in coin.`;
        if (got.note) text += ` A note inside reads: ${got.note}`;
        _note(game, `${it.icon} Fished Out`, text, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return true;
    },

    // ══════════════════════════════════════════════
    // NETS (systems/riverNets.js)
    // ══════════════════════════════════════════════

    /**
     * A river net's line across the channel on this map: the across-line of
     * the river at its place down its run ({ run, k, x, y, fx, fy, nx, ny, a, b }).
     */
    netLine(world, net, tiles = InnerMap.tiles) {
        if (!net || net.still) return null;
        const c = this._netCache.get(net.id);
        if (c && c.tiles === tiles) return c.line;
        const course = this.course(tiles);
        let line = null;
        if (course) {
            const ri = course.runs[net.run] ? net.run : 0;
            const run = course.runs[ri];
            const k = Math.max(run.lo + 1, Math.min(run.hi - 1, net.k));
            line = { run: ri, k, ...this._across(tiles, run, k) };
        }
        this._netCache.set(net.id, { tiles, line });
        return line;
    },

    /** Is cell (q, r) on or by this hex's net? → the net, or null */
    netNear(world, q, r) {
        const hex = this._hex();
        const net = hex && world ? RiverDrift.netAt(world, hex.q, hex.r) : null;
        if (!net) return null;
        if (net.still) return Math.hypot(q - net.cell.x, (r - net.cell.y) * 1.6) <= 2.2 ? net : null;
        const L = this.netLine(world, net);
        if (!L) return null;
        // distance from the segment across the river
        const dx = q - L.x, dy = r - L.y;
        const along = dx * L.nx + dy * L.ny, off = Math.abs(dx * L.fx + dy * L.fy);
        return along >= L.a - 1.2 && along <= L.b + 1.2 && off <= 1.6 ? net : null;
    },

    /** Where to stand to reach a net: the bank cell it was set from (or its nearer end) */
    _netStand(world, net) {
        if (net.bank) return net.bank;
        const L = this.netLine(world, net);
        if (!L) return { q: Math.round(net.cell.x), r: Math.round(net.cell.y) };
        const ends = [L.a, L.b].map(e => ({ q: Math.round(L.x + L.nx * e), r: Math.round(L.y + L.ny * e) }));
        ends.sort((a, b) => this._playerDist(a.q, a.r) - this._playerDist(b.q, b.r));
        return ends[0];
    },

    /** Walk within reach of (q, r) and then do it */
    _reachThen(game, q, r, fn, why = 'the water') {
        const reach = RiverNets.config().reach;
        if (this._playerDist(q, r) <= reach) { fn(); return; }
        const how = InnerMap.approachAndThen(q, r, () => {
            if (this._playerDist(q, r) <= reach + 0.5) fn();
            else _note(game, '🥅 Too Far', `You can't get close enough to ${why}.`, 'warning');
        });
        if (how === 'unreachable') _note(game, '🥅 Too Far', `You can't get to ${why} from here.`, 'warning');
    },

    /** Set a net at water cell (q, r) on this map. → true when set */
    layNet(game, q, r) {
        const world = game.world, player = game.player;
        const hex = this._hex();
        if (!hex) return false;
        const river = this.isRiverCell(q, r);
        const still = river ? null : this.stillWaterAt(q, r);
        if (!river && !still) { _note(game, '🥅 Not Here', 'Set a net in a river, or in water too deep to stand in.', 'warning'); return false; }
        const spot = { water: river ? 'river' : still, cell: { x: q, y: r } };
        if (river) {
            const f = InnerMap.getTile(q, r)._flow;
            const course = this.course();
            const run = course.runs[f.run] || course.runs[0];
            spot.run = f.run;
            spot.k = f.k;
            spot.frac = f.run === 0 && run.hi > run.lo ? (f.k - run.lo) / (run.hi - run.lo) : 0.1;
        }
        const res = RiverNets.lay(world, player, hex.q, hex.r, spot, this.now(game));
        if (!res.ok) { _note(game, '🥅 Not Here', res.reason, 'warning'); return false; }
        res.net.bank = { q: Math.round(InnerMap.playerInnerQ), r: Math.round(InnerMap.playerInnerR) };
        this._netCache.delete(res.net.id);
        // Whatever is already down past it on this map has gone by
        if (river) {
            const nline = this.netLine(world, res.net);
            for (const [id, L] of this._live) {
                const it = RiverDrift.find(world, id);
                if (it && nline && L.run === nline.run && L.s > nline.k) it.netPast = true;
            }
        }
        _note(game, '🥅 Net Set', river
            ? 'You stake the net across the river, floats bobbing on the head-rope. Whatever comes down will meet it; come back for the fish.'
            : 'You pay the net out on the water, floats in a long curve. Come back in a day or two and see what it holds.', 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return true;
    },

    /** Haul in what a net holds */
    haulNet(game, id) {
        const res = RiverNets.haul(game.world, game.player, id);
        if (!res.ok) { _note(game, '🥅 Gone', res.reason || 'The net is gone.', 'warning'); return false; }
        this._tellHaul(game, res, 'You haul the net in hand over hand');
        return true;
    },

    _tellHaul(game, res, lead) {
        const got = {};
        for (const g of res.got) { const k = g.name || g.itemId; got[k] = (got[k] || 0) + g.qty; }
        const list = Object.entries(got).map(([n, q]) => (q > 1 ? `${q} × ${n}` : n)).join(', ');
        let text = list ? `${lead}: ${list}.` : `${lead}. Nothing in it but weed and water.`;
        if (res.coins) text += ` ${res.coins} gold in coin, too.`;
        if (res.notes && res.notes.length) text += ` A note in a bottle reads: ${res.notes[0]}`;
        if (res.left) text += ` (${res.left} left in it: your packs are full.)`;
        if (res.back === 'fishing_net') text += ' The net is back in your packs.';
        else if (res.back === 'rope') text += ' The torn net is only good for rope now.';
        _note(game, '🥅 The Net', text, list ? 'success' : 'info');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
    },

    /** Take a net up out of the water, catch and all */
    takeUpNet(game, id) {
        const res = RiverNets.takeUp(game.world, game.player, id);
        if (!res.ok && !res.got) { _note(game, '🥅 Gone', res.reason || 'The net is gone.', 'warning'); return false; }
        if (!res.ok) { this._tellHaul(game, res, 'You empty what you can of it'); _note(game, '🥅 Not Yet', res.reason, 'warning'); return false; }
        this._netCache.delete(id);
        this._tellHaul(game, res, 'You take the net up');
        return true;
    },

    mendNet(game, id) {
        const res = RiverNets.mend(game.world, game.player, id);
        if (!res.ok) { _note(game, '🥅 Mend', res.reason, 'warning'); return false; }
        _note(game, '🥅 Mended', 'You knot the torn meshes together again. It will fish.', 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        return true;
    },

    // ══════════════════════════════════════════════
    // THE MENU
    // ══════════════════════════════════════════════

    /** Entries for a clicked cell: throw something in; fish out what floats or lies there; set, haul or take up a net */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || !RiverDrift.config().enabled) return [];
        const out = [];
        const cfg = RiverDrift.config();
        for (const s of this.thingsAt(q, r).slice(0, 4)) {
            const it = s.item;
            const label = s.kind === 'caught' ? `Take the ${it.name} off the Weir` : `Fish Out the ${it.name}`;
            const desc = s.kind === 'caught' ? 'From the end of the weir, on the bank'
                : s.kind === 'drift' ? `Drifting by: reach it from the bank, a ford or a bridge (${cfg.reach} cells)`
                    : it.cell ? `Afloat on the water: reach it from the shore (${cfg.reach} cells), or swim out` : 'Lying on the water where the river ends';
            out.push({ type: 'action', action: 'drift_take', icon: it.icon || '🎣', label, desc, driftId: it.id });
        }
        const world = game.world;
        const net = this.netNear(world, q, r);
        if (net) {
            const n = RiverNets.count(net);
            if (n) out.push({ type: 'action', action: 'drift_net_haul', icon: '🥅', label: `Haul In the Net (${n})`, desc: net.torn ? 'Torn: what is left in it' : 'Take what it has caught', netId: net.id });
            else out.push({ type: 'disabled', label: `🥅 The net is empty${net.torn ? ', and torn' : ''}` });
            if (net.torn) {
                const cost = Object.entries(RiverNets.config().mendCost || {}).map(([g, k]) => `${k} ${g.replace(/_/g, ' ')}`).join(', ');
                out.push({ type: 'action', action: 'drift_net_mend', icon: '🧶', label: 'Mend the Net', desc: `Knot the torn meshes (${cost || 'nothing'})`, netId: net.id });
            }
            out.push({ type: 'action', action: 'drift_net_up', icon: '🥅', label: 'Take the Net Up', desc: 'Out of the water, catch and all, back into your packs', netId: net.id });
        }
        if (this.isThrowCell(q, r)) {
            const any = this.throwables(game.player).length > 0;
            if (any) out.push({ type: 'action', action: 'drift_throw', icon: '🌊', label: 'Throw Something In', desc: this.isRiverCell(q, r) ? 'Toss something from your packs into the river and watch the current take it' : 'Toss something from your packs onto the water' });
            const hex = this._hex();
            const has = (game.player.inventory || {}).fishing_net > 0;
            if (has && hex && !RiverDrift.netAt(world, hex.q, hex.r)) {
                out.push({ type: 'action', action: 'drift_net_lay', icon: '🥅', label: 'Set a Net Here', desc: this.isRiverCell(q, r) ? 'Stake it across the river: it fishes while you are away, and catches what drifts down' : 'Pay it out on the water: it fishes while you are away' });
            }
        }
        return out;
    },

    /** Run a drift entry. → true when handled */
    handle(game, item, q, r) {
        if (!item || !/^drift_/.test(item.action || '')) return false;
        if (item.action === 'drift_throw') { this.showThrowPicker(game, q, r); return true; }
        if (item.action === 'drift_take') { this._reachAndTake(game, item.driftId); return true; }
        if (item.action === 'drift_net_lay') { this._reachThen(game, q, r, () => this.layNet(game, q, r), 'the water there'); return true; }
        const net = item.netId ? RiverNets.find(game.world, item.netId) : null;
        if (/^drift_net_/.test(item.action) && !net) { _note(game, '🥅 Gone', 'The net is gone.', 'warning'); return true; }
        const at = net ? this._netStand(game.world, net) : null;
        if (item.action === 'drift_net_haul') { this._reachThen(game, at.q, at.r, () => this.haulNet(game, net.id), 'the net'); return true; }
        if (item.action === 'drift_net_up') { this._reachThen(game, at.q, at.r, () => this.takeUpNet(game, net.id), 'the net'); return true; }
        if (item.action === 'drift_net_mend') { this._reachThen(game, at.q, at.r, () => this.mendNet(game, net.id), 'the net'); return true; }
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

    /** The packs, to pick what goes in the water */
    showThrowPicker(game, q, r) {
        const goods = this.throwables(game.player);
        if (!goods.length) { _note(game, '🌊 Nothing to Throw', 'Your packs are empty.', 'warning'); return; }
        const river = this.isRiverCell(q, r);
        const rows = goods.slice(0, 40).map(g => ({
            icon: g.icon, name: esc(g.name),
            desc: RiverDrift.sinks(g.itemId) ? 'Heavy: it will sink' : river ? 'It will float off downstream' : 'It will float',
            side: `×${g.qty}`,
            attrs: `onclick="window.__riverThrow && window.__riverThrow('${esc(g.itemId)}')"`,
        }));
        window.__riverThrow = (itemId) => {
            if (game.ui && typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
            this.throwItem(game, itemId, q, r, { walk: true });
        };
        game.ui.showCustomPanel('🌊 Throw Something In', `<div>${lede(river ? 'Pick something to toss into the river. One at a time.' : 'Pick something to toss into the water. One at a time.')}${rowList(rows)}</div>`);
    },
};
