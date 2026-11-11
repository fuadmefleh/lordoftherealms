// ============================================
// RIVER DRIFT — things carried down the rivers
// ============================================
// Throw something in a river and the current takes it: down its hex, into
// the next one downstream (tile.riverDir, or a painted river's way out to
// lower water), hex by hex, until it reaches the sea — where it is lost — or
// a lake (it lies on the water a while, then sinks), or the pool a river
// ends in, or a weir across the river, where it fetches up and waits to be
// taken. A weir is a timber dam the player built (infrastructure
// 'river_dam', finished) or a town's water mill on a river hex (worlds since
// terrainGen millWeirGen: every such town stands its mill on the water,
// world/innerMap/mills.js). A weir holds damCap things; the rest spill over.
//
// The world keeps them on world.riverDrift = { seq, items: [...] } (saved):
//   { id, itemId, name, icon, qty, q, r,
//     t0      — the hour (world clock: day × 24 + hour) it came into this hex
//               (thrown in mid-hex: back-dated by how far down it went in),
//     inDir   — the side of the hex it came in by (null: thrown in here),
//     state   — 'drift' | 'caught' (on a weir) | 'rest' (lake, pool, bank),
//     where   — for caught/rest: 'dam' | 'mill' | 'lake' | 'pool' | 'bank',
//     since   — the hour it was caught or came to rest,
//     passed  — it went over this hex's weir (a full one) }
//
// Time is passed in (`now`, the world clock in hours) — the caller owns it
// (ui/innerMapRiverDrift.js: world.day × 24 + the day clock's hour). The hex
// whose street map the player is on can be held (opts.hold): its drift is
// played out there, cell by cell, and handed back. No randomness at all.
// Settings: data/riverDrift.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const DEFAULTS = {
    enabled: true,
    hoursPerHex: 2,
    mapSpeed: 1.1,
    bankSlow: 0.5,
    wander: 0.7,
    bob: 1.5,
    damAt: 0.55,
    damCap: 12,
    millWeirs: true,
    millWeirGen: 5,
    restDays: { lake: 20, pool: 120, bank: 60 },
    maxItems: 150,
    reach: 2,
    damReach: 3,
    sinkers: [],
};

/** Open water a river runs out into and is lost (a lake is not: things lie on it) */
const SEA_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const WATER_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const RiverDrift = {
    _cfgSrc: null,
    _cfg: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.riverDrift;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const c = { ...DEFAULTS, ...(src || {}) };
            c.restDays = { ...DEFAULTS.restDays, ...((src && src.restDays) || {}) };
            c.hoursPerHex = Math.max(0.1, _num(c.hoursPerHex, DEFAULTS.hoursPerHex));
            this._cfg = c;
        }
        return this._cfg;
    },

    /** The world's record of things adrift (made when asked) */
    state(world, create = true) {
        if (!world) return null;
        if (!world.riverDrift || typeof world.riverDrift !== 'object' || !Array.isArray(world.riverDrift.items)) {
            if (!create) return null;
            world.riverDrift = { seq: 0, items: [] };
        }
        return world.riverDrift;
    },

    _tile(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        if (Number.isFinite(world.height) && (r < 0 || r >= world.height)) return null;
        const wq = Number.isFinite(world.width) && world.width > 0 ? Hex.wrapQ(q, world.width) : q;
        return world.getTile(wq, r) || null;
    },

    /** The hex `dir` of (q, r), wrapped: { q, r } */
    _step(world, q, r, dir) {
        const n = Hex.neighbors(q, r)[dir];
        const wq = world && Number.isFinite(world.width) && world.width > 0 ? Hex.wrapQ(n.q, world.width) : n.q;
        return { q: wq, r: n.r };
    },

    /** Is there water in this hex a thing can be thrown into and carried off? */
    isRiverHex(tile) {
        return !!(tile && tile.hasRiver && !(tile.terrain && WATER_IDS.has(tile.terrain.id)));
    },

    /**
     * Which side of the hex its river leaves by, or null (it ends here). A
     * generated river knows (riverDir); a painted one runs to the river beside
     * it that lies lower, else to lower open water — as the street map lays
     * it (world/innerMap/water.js _riverSides).
     */
    outflow(world, q, r) {
        const tile = this._tile(world, q, r);
        if (!tile || !tile.hasRiver) return null;
        if (Number.isInteger(tile.riverDir) && tile.riverDir >= 0 && tile.riverDir <= 5) return tile.riverDir;
        const el = tile.elevation || 0;
        const ns = Hex.neighbors(q, r);
        for (let i = 0; i < 6; i++) {
            const n = this._tile(world, ns[i].q, ns[i].r);
            if (!n) continue;
            if (n.hasRiver && Number.isInteger(n.riverDir)) continue; // a generated river flowing by
            const nWater = !!(n.terrain && WATER_IDS.has(n.terrain.id));
            if (n.hasRiver && Math.abs((n.elevation || 0) - el) > 0.0001) {
                if ((n.elevation || 0) < el) return i;
            } else if (nWater && el > (n.elevation || 0)) return i;
        }
        return null;
    },

    /**
     * Where the river of (q, r) goes next: { kind: 'river', q, r, dir } (the
     * next hex of it), 'sea' (lost), 'lake' (q, r: the lake hex), 'bank' (it
     * runs out onto dry land: washed up here) or 'end' (it ends in this hex).
     */
    downstream(world, q, r) {
        const dir = this.outflow(world, q, r);
        if (dir === null) return { kind: 'end' };
        const p = this._step(world, q, r, dir);
        const n = this._tile(world, p.q, p.r);
        if (!n) return { kind: 'sea', dir }; // off the edge of the world
        const id = n.terrain && n.terrain.id;
        if (id && SEA_IDS.has(id)) return { kind: 'sea', q: p.q, r: p.r, dir };
        if (id === 'lake') return { kind: 'lake', q: p.q, r: p.r, dir };
        if (n.hasRiver) return { kind: 'river', q: p.q, r: p.r, dir };
        return { kind: 'bank', dir };
    },

    /**
     * The weir across this hex's river, or null: { kind: 'dam' | 'mill', name }.
     * A finished timber dam of the player's; else a town's water mill.
     */
    damAt(world, q, r) {
        const tile = this._tile(world, q, r);
        if (!tile || !this.isRiverHex(tile)) return null;
        const infra = tile.infrastructure;
        if (infra && infra.id === 'river_dam' && !infra.underConstruction) return { kind: 'dam', name: infra.name || 'Timber Dam' };
        const cfg = this.config();
        const s = tile.settlement;
        if (cfg.millWeirs && s && !(s.dawnBorn && s.campEra !== false)) {
            const gen = Number(world.generationParams && world.generationParams.terrainGen) || 1;
            if (gen >= cfg.millWeirGen) return { kind: 'mill', name: `the mill weir of ${s.name || 'the town'}` };
        }
        return null;
    },

    /** Does this good go straight to the bottom? */
    sinks(itemId) {
        return (this.config().sinkers || []).includes(itemId);
    },

    /** Things in hex (q, r), optionally only those in `states` */
    itemsAt(world, q, r, states = null) {
        const st = this.state(world, false);
        if (!st) return [];
        return st.items.filter(it => it.q === q && it.r === r && (!states || states.includes(it.state)));
    },

    /** The pile on this hex's weir, in the order it fetched up */
    pileAt(world, q, r) {
        return this.itemsAt(world, q, r, ['caught']);
    },

    find(world, id) {
        const st = this.state(world, false);
        return st ? st.items.find(it => it.id === id) || null : null;
    },

    /**
     * Throw a thing into the river of hex (q, r).
     * @param {object} what  { itemId, name, icon, qty }
     * @param {number} now   the world clock (hours)
     * @param {object} [opts] { frac: how far down the hex's river (0..1) it went in, by: 'player' }
     * @returns {{ ok, sank?, item?, reason? }}
     */
    throwIn(world, q, r, what, now, opts = {}) {
        const cfg = this.config();
        if (!cfg.enabled) return { ok: false, reason: 'off' };
        const tile = this._tile(world, q, r);
        if (!this.isRiverHex(tile)) return { ok: false, reason: 'There is no river here.' };
        if (!what || !what.itemId) return { ok: false, reason: 'Nothing to throw.' };
        if (this.sinks(what.itemId)) return { ok: true, sank: true };
        const st = this.state(world);
        const frac = Math.max(0, Math.min(0.99, _num(opts.frac, 0.5)));
        const item = {
            id: `rd${++st.seq}`,
            itemId: what.itemId,
            name: what.name || what.itemId,
            icon: what.icon || '📦',
            qty: Math.max(1, Math.floor(_num(what.qty, 1))),
            q: tile.q != null ? tile.q : q,
            r: tile.r != null ? tile.r : r,
            t0: now - frac * cfg.hoursPerHex,
            inDir: null,
            state: 'drift',
            where: null,
            since: now,
            passed: false,
        };
        if (opts.by) item.by = opts.by;
        // A weir below where it went in: it fetches up there; one above it: already past
        const dam = this.damAt(world, item.q, item.r);
        if (dam && frac > cfg.damAt) item.passed = true;
        st.items.push(item);
        this._trim(world);
        return { ok: true, item };
    },

    /** Keep the world's drift to maxItems: the oldest at rest go first, then the oldest of all */
    _trim(world) {
        const st = this.state(world, false);
        const max = Math.max(1, this.config().maxItems | 0);
        if (!st || st.items.length <= max) return;
        const order = [...st.items].sort((a, b) => (a.state === 'rest') === (b.state === 'rest') ? a.since - b.since : (a.state === 'rest' ? -1 : 1));
        const drop = new Set(order.slice(0, st.items.length - max).map(it => it.id));
        st.items = st.items.filter(it => !drop.has(it.id));
    },

    /**
     * The current carries everything on to `now` (hours). Things in the held
     * hex (opts.hold = { q, r }) are left to the street map. Returns what
     * happened: [{ type: 'caught' | 'lost' | 'lake' | 'rest' | 'sank' | 'moved', item }].
     */
    advance(world, now, opts = {}) {
        const st = this.state(world, false);
        if (!st || !st.items.length || !Number.isFinite(now)) return [];
        const cfg = this.config();
        const hph = cfg.hoursPerHex;
        const hold = opts.hold || null;
        const events = [];
        const gone = new Set();
        for (const it of st.items) {
            if (it.state === 'rest') {
                const days = _num(cfg.restDays[it.where], 0);
                if (days > 0 && now - it.since >= days * 24) {
                    gone.add(it.id);
                    events.push({ type: 'sank', item: it });
                }
                continue;
            }
            if (it.state !== 'drift') continue;
            // (a long way at most in one go: a river is not that long)
            for (let guard = 0; guard < 400; guard++) {
                if (hold && it.q === hold.q && it.r === hold.r) break;
                const dam = it.passed ? null : this.damAt(world, it.q, it.r);
                if (dam) {
                    const at = it.t0 + hph * cfg.damAt;
                    if (now < at) break;
                    if (this.pileAt(world, it.q, it.r).length < cfg.damCap) {
                        this.catchAt(world, it, dam, at);
                        events.push({ type: 'caught', item: it });
                        break;
                    }
                    it.passed = true; // a full weir: over it goes
                }
                const out = it.t0 + hph;
                if (now < out) break;
                const ev = this.passOn(world, it, out);
                if (ev === 'lost') { gone.add(it.id); events.push({ type: 'lost', item: it }); break; }
                if (ev !== 'moved') { events.push({ type: ev, item: it }); break; }
            }
        }
        if (gone.size) st.items = st.items.filter(it => !gone.has(it.id));
        return events;
    },

    /** A thing fetches up on a weir at hour `at` */
    catchAt(world, it, dam, at) {
        it.state = 'caught';
        it.where = dam.kind === 'mill' ? 'mill' : 'dam';
        it.since = at;
    },

    /**
     * A thing leaves its hex downstream at hour `at` (off the street map's
     * edge, or the current carried it): into the next hex of the river, lost
     * at sea, onto a lake, or (the river ends) to rest. Things lost are not
     * removed here — the caller drops them ('lost'). → 'moved' | 'lost' | 'lake' | 'rest'
     */
    passOn(world, it, at) {
        const next = this.downstream(world, it.q, it.r);
        if (next.kind === 'sea') return 'lost';
        if (next.kind === 'river') {
            it.q = next.q;
            it.r = next.r;
            it.inDir = (next.dir + 3) % 6;
            it.t0 = at;
            it.passed = false;
            return 'moved';
        }
        if (next.kind === 'lake') {
            it.q = next.q;
            it.r = next.r;
            it.inDir = (next.dir + 3) % 6;
            it.t0 = at;
            this.rest(it, 'lake', at);
            return 'lake';
        }
        this.rest(it, next.kind === 'end' ? 'pool' : 'bank', at);
        return 'rest';
    },

    rest(it, where, at) {
        it.state = 'rest';
        it.where = where;
        it.since = at;
    },

    /** Lost at sea from the street map (the caller saw it go): out of the world */
    remove(world, id) {
        const st = this.state(world, false);
        if (!st) return null;
        const i = st.items.findIndex(it => it.id === id);
        if (i < 0) return null;
        return st.items.splice(i, 1)[0];
    },

    /** Take a thing out of the water (fished out, or off a weir): removed and returned */
    take(world, id) {
        return this.remove(world, id);
    },

    /** The daily tick (ui/game/endDay.js): carry everything on to `now` */
    processDay(world, player, now) {
        const events = Number.isFinite(now) ? this.advance(world, now) : [];
        return { notices: [], events };
    },

    serialize(world) {
        const st = this.state(world, false);
        return st && st.items.length ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(data, world) {
        if (!world) return;
        if (data && typeof data === 'object' && Array.isArray(data.items)) {
            world.riverDrift = { seq: _num(data.seq, data.items.length), items: data.items.filter(it => it && it.id && it.itemId) };
        } else {
            world.riverDrift = { seq: 0, items: [] };
        }
    },
};
