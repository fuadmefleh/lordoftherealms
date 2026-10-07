// ============================================
// THE HINTERLAND — rural production sites around the towns
// ============================================
// The villages and countryside within a town's reach specialise by their
// land: an iron, coal, gem or gold deposit becomes a mine, a stone outcrop a
// quarry, timber a logging camp, salt a pan, a fish bank a fishery, horses a
// stud, cattle a ranch, and open pasture and hills without a deposit run
// sheep. Each hex within `reach` belongs to its nearest settlement; a town
// works its best few as its rural sites (world.hinterland.sites).
//
// On the home town's market day (systems/concessions.js drives the day) a
// site's output — perDay × the turn's days × its yield × the town's land
// hands (world/townLabour.js) — goes half to its home settlement and half to
// the nearest market town (village → town supply), where the town's trades
// and the player's works take it up (world/settlementMarket.js).
//
// Deposits hold a finite reserve that what is dug draws down: the yield
// falls once less than half is left, and an empty mine closes (its towns go
// short, its miners drift away). New veins are struck by prospecting.
//
// Sites are derived from the terrain and the settlements only: no RNG is
// drawn and world generation is untouched (reserves are a hash of the world
// seed and the hex). Old saves derive theirs on load. Pure model: state on
// world.hinterland (saved by systems/saveLoad.js); tuned in data/hinterland.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from './settlementMarket.js';
import { TownLabour } from './townLabour.js';
import { Harvests } from './harvests.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const RANK = { village: 0, town: 1, city: 2, capital: 3 };

const DEFAULTS = {
    reach: 3, marketReach: 6, homeShare: 0.5, maxSites: { village: 2, town: 3, city: 4, capital: 5 }, maxPerKind: 2, resyncDays: 60,
    kinds: {},
    yield: { knee: 0.5, min: 0.35 },
    prospect: { every: 60, chance: 0.1, wane: 0.4, veinMin: 0.3, veinMax: 0.7, extraSites: 2, terrain: {}, strikeMigrants: 12, exhaustMigrants: 1.5, cost: 160, days: 8, playerChance: 0.6, finderDays: 20 },
    concessions: {},
    markers: { minZoom: 0.5, low: 0.5, critical: 0.2 },
    counsel: { yieldBelow: 0.7, reserveBelow: 0.3, auctionRadius: 10 },
};

let _src;
let _cfg = null;
/** Per-state index of the sites by id and by home town (rebuilt when the list changes). */
const _index = new WeakMap();

function _build(src) {
    const d = _obj(src) || {};
    const kinds = {};
    for (const [id, k] of Object.entries(d.kinds || {})) {
        if (!_obj(k) || id.startsWith('_')) continue;
        const good = {};
        for (const [g, n] of Object.entries(k.good || {})) if (_num(n) > 0) good[g] = _num(n);
        kinds[id] = {
            id, name: k.name || id, icon: k.icon || '⛏️', good, goods: Object.entries(good), first: Object.keys(good)[0] || null,
            resource: k.resource || null, terrain: Array.isArray(k.terrain) ? k.terrain.slice() : [],
            priority: _num(k.priority), hands: Math.max(0, _num(k.hands, 8)), deposit: !!k.deposit,
            reserve: Array.isArray(k.reserve) ? [_num(k.reserve[0], 500), _num(k.reserve[1], 1000)] : [0, 0],
            leasable: !!k.leasable,
        };
    }
    const byResource = {}, byTerrain = {};
    for (const k of Object.values(kinds)) {
        if (k.resource) byResource[k.resource] = k.id;
        for (const t of k.terrain) if (!byTerrain[t]) byTerrain[t] = k.id;
    }
    return {
        ...DEFAULTS, ...d,
        maxSites: { ...DEFAULTS.maxSites, ...(d.maxSites || {}) },
        yield: { ...DEFAULTS.yield, ...(d.yield || {}) },
        prospect: { ...DEFAULTS.prospect, ...(d.prospect || {}) },
        concessions: { ...DEFAULTS.concessions, ...(d.concessions || {}) },
        markers: { ...DEFAULTS.markers, ...(d.markers || {}) },
        counsel: { ...DEFAULTS.counsel, ...(d.counsel || {}) },
        kinds, byResource, byTerrain,
    };
}

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

export const Hinterland = {
    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.hinterland : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            _cfg = _build(src);
        }
        return _cfg;
    },

    /** A site kind (data/hinterland.json kinds), or null. */
    kind(id) {
        return Hinterland.config().kinds[id] || null;
    },

    roll: _roll,

    /** The world's seed for the hash rolls. */
    seed(world) {
        return String((world && world.generationParams && world.generationParams.seed) || 'world');
    },

    // ── State ─────────────────────────────────────────────

    /** world.hinterland: { sites, towns, prospected, history, concessions, auctions, prospects, ... }. */
    state(world) {
        if (!world) return null;
        let st = _obj(world.hinterland);
        if (!st) st = world.hinterland = Hinterland._blank();
        for (const k of ['sites', 'history', 'concessions', 'auctions', 'prospects', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        for (const k of ['towns', 'prospected', 'ledger']) if (!_obj(st[k])) st[k] = {};
        if (!Number.isFinite(st.seq)) st.seq = 1;
        return st;
    },

    _blank() {
        return {
            v: 1, sites: [], towns: {}, prospected: {}, history: [], concessions: [], auctions: [], prospects: [], log: [],
            ledger: {}, seq: 1, derived: false, syncAt: null, lastDay: null,
        };
    },

    serialize(world) {
        const st = world && _obj(world.hinterland);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load: the saved record, or none (older saves derive their sites from the terrain on the next day). */
    restore(saved, world) {
        if (!world) return;
        world.hinterland = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        if (world.hinterland) Hinterland.state(world);
    },

    /** Give a world without sites its sites (old saves, new games): derived from the terrain. */
    backfill(world) {
        const st = Hinterland.state(world);
        if (st && !st.derived) Hinterland.derive(world);
        return st;
    },

    /** Sites by id and by home town: { byId: Map, byHome: Map key → [site] }. */
    _idx(st) {
        let ix = _index.get(st);
        if (ix && ix.list === st.sites && ix.n === st.sites.length && ix.ver === st.ver) return ix;
        ix = { list: st.sites, n: st.sites.length, ver: st.ver, byId: new Map(), byHome: new Map() };
        for (const s of st.sites) {
            ix.byId.set(s.id, s);
            const arr = ix.byHome.get(s.h);
            if (arr) arr.push(s); else ix.byHome.set(s.h, [s]);
        }
        _index.set(st, ix);
        return ix;
    },

    /** Mark the site list changed (a site added, re-homed or removed). */
    touch(st) {
        st.ver = _num(st.ver) + 1;
    },

    // ── Derivation ────────────────────────────────────────

    /**
     * The site kind a tile would make: its resource first; else a vein the
     * locals know of in a hill or mountain (a hash of the world seed and the
     * hex: `hidden` of them, its kind by the terrain's prospecting weights);
     * else its land (sheep on open pasture); null when none.
     */
    kindFor(tile, world = null) {
        if (!tile || !tile.terrain || tile.settlement) return null;
        const C = Hinterland.config();
        const res = tile.resource && tile.resource.id;
        if (res && C.byResource[res]) return C.byResource[res];
        const weights = _obj(C.prospect.terrain) && _obj(C.prospect.terrain[tile.terrain.id]);
        if (weights && Number.isFinite(tile.q) && _roll(`hl:hid:${Hinterland.seed(world)}:${tile.q},${tile.r}`) < _num(C.hidden, 0)) {
            return Hinterland._pickKind(weights, `hl:hidk:${Hinterland.seed(world)}:${tile.q},${tile.r}`);
        }
        return C.byTerrain[tile.terrain.id] || null;
    },

    /** A kind from { kindId: weight } by the hash `key`, or null. */
    _pickKind(weights, key) {
        const ws = Object.entries(weights || {}).filter(([id, w]) => Hinterland.kind(id) && _num(w) > 0);
        const sum = ws.reduce((a, [, w]) => a + _num(w), 0);
        if (!(sum > 0)) return null;
        let pick = _roll(key) * sum;
        for (const [id, w] of ws) { pick -= _num(w); if (pick < 0) return id; }
        return ws[ws.length - 1][0];
    },

    /**
     * Which settlement owns each hex within reach: the nearest (ties go to the
     * larger, then the lower key) → Map hexKey → { s, d }.
     */
    _owners(world, views) {
        const C = Hinterland.config();
        const R = Math.max(1, Math.floor(_num(C.reach, 3)));
        const own = new Map();
        for (const s of views) {
            const rank = RANK[s.type] || 0;
            const sk = _key(s.q, s.r);
            for (const h of Hex.hexesInRange(s.q, s.r, R)) {
                const q = world.width ? Hex.wrapQ(h.q, world.width) : h.q;
                if (h.r < 0 || h.r >= world.height) continue;
                const d = Hex.wrappingDistance(s.q, s.r, q, h.r, world.width);
                if (d < 1 || d > R) continue;
                const k = _key(q, h.r);
                const cur = own.get(k);
                if (!cur || d < cur.d || (d === cur.d && (rank > cur.rank || (rank === cur.rank && sk < cur.sk)))) own.set(k, { s, d, rank, sk, q, r: h.r });
            }
        }
        return own;
    },

    /** The market town a site sells into: its home if a town or larger, else the nearest such within marketReach. */
    _marketFor(world, views, home, q, r) {
        if ((RANK[home.type] || 0) >= 1) return home;
        const C = Hinterland.config();
        const MR = _num(C.marketReach, 6);
        let best = null, bestD = Infinity;
        for (const s of views) {
            if ((RANK[s.type] || 0) < 1 || Math.abs(s.r - r) > MR) continue;
            const d = Hex.wrappingDistance(s.q, s.r, q, r, world.width);
            if (d <= MR && (d < bestD || (d === bestD && _key(s.q, s.r) < _key(best.q, best.r)))) { best = s; bestD = d; }
        }
        return best || home;
    },

    /** A new site record (a deposit's reserve is a hash of the world seed and the hex). */
    _site(world, kindId, q, r, home, market, day = null) {
        const k = Hinterland.kind(kindId);
        const site = { id: _key(q, r), q, r, kind: kindId, h: _key(home.q, home.r), m: _key(market.q, market.r), st: 'open', c: null, out: 0, hire: 0 };
        if (k && k.deposit) {
            const [lo, hi] = k.reserve;
            site.res0 = Math.round(lo + _roll(`hl:res:${Hinterland.seed(world)}:${site.id}:${kindId}`) * Math.max(0, hi - lo));
            site.res = site.res0;
        }
        if (day != null) site.found = day;
        return site;
    },

    /**
     * The towns' sites from the map: each settlement takes its best hexes by
     * the kind's priority (then nearness, then a hash), up to maxSites for its
     * size and maxPerKind of a kind. `only` limits it to those town keys (new
     * towns). Deterministic; draws no RNG.
     */
    derive(world, only = null) {
        const st = Hinterland.state(world);
        if (!world || typeof world.getTile !== 'function') return st;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const C = Hinterland.config();
        const taken = new Set(st.sites.map(s => s.id));
        const own = Hinterland._owners(world, views);
        const cands = new Map();
        for (const [hk, o] of own) {
            if (taken.has(hk)) continue;
            const sk = o.sk;
            if (only && !only.has(sk)) continue;
            const t = world.getTile(o.q, o.r);
            const kind = Hinterland.kindFor(t, world);
            if (!kind) continue;
            const arr = cands.get(sk);
            const c = { kind, q: o.q, r: o.r, d: o.d, pr: Hinterland.kind(kind).priority, h: _roll(`hl:pick:${Hinterland.seed(world)}:${hk}`) };
            if (arr) arr.push(c); else cands.set(sk, [c]);
        }
        for (const s of views) {
            const sk = _key(s.q, s.r);
            if (only && !only.has(sk)) continue;
            st.towns[sk] = 1;
            const arr = cands.get(sk);
            if (!arr) continue;
            arr.sort((a, b) => (b.pr - a.pr) || (a.d - b.d) || (a.h - b.h));
            const max = _num(C.maxSites[s.type], 2);
            const per = {};
            let n = 0;
            for (const c of arr) {
                if (n >= max) break;
                if (_num(per[c.kind]) >= _num(C.maxPerKind, 2)) continue;
                per[c.kind] = _num(per[c.kind]) + 1;
                const market = Hinterland._marketFor(world, views, s, c.q, c.r);
                st.sites.push(Hinterland._site(world, c.kind, c.q, c.r, s, market));
                n++;
            }
        }
        st.derived = true;
        Hinterland.touch(st);
        return st;
    },

    /**
     * Every resyncDays: towns founded since get their sites; a site whose home
     * town is gone is re-homed to its nearest settlement within reach (or
     * stands idle until one is founded).
     */
    sync(world, day) {
        const st = Hinterland.state(world);
        if (!st.derived) { Hinterland.derive(world); st.syncAt = day; return st; }
        const every = Math.max(1, _num(Hinterland.config().resyncDays, 60));
        if (Number.isFinite(st.syncAt) && day - st.syncAt < every && day >= st.syncAt) return st;
        st.syncAt = day;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const fresh = new Set();
        for (const s of views) if (!st.towns[_key(s.q, s.r)]) fresh.add(_key(s.q, s.r));
        if (fresh.size) Hinterland.derive(world, fresh);
        let moved = false;
        const own = Hinterland._owners(world, views);
        for (const site of st.sites) {
            const ht = world.getTile(...site.h.split(',').map(Number));
            if (ht && ht.settlement) continue;
            const o = own.get(site.id);
            if (o) {
                const mk = Hinterland._marketFor(world, views, o.s, site.q, site.r);
                site.h = o.sk;
                site.m = _key(mk.q, mk.r);
            } else site.h = 'none';
            moved = true;
        }
        if (moved) Hinterland.touch(st);
        return st;
    },

    // ── Readers ───────────────────────────────────────────

    /** Every site (the live list — read-only use). */
    sites(world) {
        const st = world && _obj(world.hinterland);
        return st && Array.isArray(st.sites) ? st.sites : [];
    },

    site(world, id) {
        const st = world && _obj(world.hinterland);
        return st && Array.isArray(st.sites) ? Hinterland._idx(st).byId.get(id) || null : null;
    },

    /** The site at a hex, or null. */
    siteAt(world, q, r) {
        return Hinterland.site(world, _key(q, r));
    },

    /** The sites a settlement works (its home sites). */
    sitesOf(world, q, r) {
        const st = world && _obj(world.hinterland);
        return st && Array.isArray(st.sites) ? Hinterland._idx(st).byHome.get(_key(q, r)) || [] : [];
    },

    /** Sites within `radius` hexes of (q, r). */
    sitesNear(world, q, r, radius = 6) {
        const out = [];
        for (const s of Hinterland.sites(world)) {
            if (Math.abs(s.r - r) > radius) continue;
            if (Hex.wrappingDistance(s.q, s.r, q, r, world.width) <= radius) out.push(s);
        }
        return out;
    },

    /** Share of a deposit's first reserve still in the ground (1 for renewable sites). */
    reserveFrac(site) {
        if (!site || !(site.res0 > 0)) return 1;
        return _clamp(_num(site.res) / site.res0, 0, 1);
    },

    /** A deposit's yield (1 while at least `knee` of its reserve is left, then down to `min`); 0 when worked out. */
    yieldOf(site) {
        if (!site || site.st === 'exhausted') return 0;
        if (!(site.res0 > 0)) return 1;
        const Y = Hinterland.config().yield;
        const f = Hinterland.reserveFrac(site);
        if (f <= 0) return 0;
        const knee = _clamp(_num(Y.knee, 0.5), 0.01, 1);
        if (f >= knee) return 1;
        const lo = _clamp(_num(Y.min, 0.35), 0, 1);
        return lo + (1 - lo) * f / knee;
    },

    /** Days of digging left at the last turn's pace (Infinity for renewable sites, null when idle). */
    daysLeft(site, k = 4) {
        if (!site || !(site.res0 > 0)) return Infinity;
        const perDay = _num(site.dug) / Math.max(1, k);
        return perDay > 0 ? Math.round(_num(site.res) / perDay) : null;
    },

    /** Hands the concessions hire around a town (extra land jobs, world/townLabour.js). */
    handsAt(world, q, r) {
        let n = 0;
        for (const s of Hinterland.sitesOf(world, q, r)) n += _num(s.hire);
        return n;
    },

    /** The site's line for panels: { name, icon, goods, yield, reserve, status }. */
    describe(site) {
        const k = Hinterland.kind(site && site.kind);
        if (!k) return null;
        return {
            name: k.name, icon: k.icon, goods: Object.keys(k.good), deposit: k.deposit, leasable: k.leasable,
            yield: Hinterland.yieldOf(site), reserve: Hinterland.reserveFrac(site), status: site.st, out: _num(site.out),
        };
    },

    // ── Output ────────────────────────────────────────────

    /**
     * What a site yields over a turn of `k` days: { goodId: units } at its
     * yield × the home town's land hands × `mult` (a concession's rate and
     * boost), and `dug` (units of its first good, the reserve's draw).
     */
    output(world, site, home, k, day, mult = 1) {
        const kd = Hinterland.kind(site.kind);
        const out = { goods: {}, dug: 0 };
        if (!kd || site.st !== 'open' || !home) return out;
        if (Number.isFinite(site.idle) && day != null && site.idle > day) return out;
        const y = Hinterland.yieldOf(site);
        if (!(y > 0)) return out;
        const land = TownLabour.factors(home, day).land;
        // Herds follow the year's grazing, murrain and war (world/harvests.js)
        const herd = Harvests.isHerdSite(site.kind) ? Harvests.stockFactor(home) : 1;
        const f = y * land * herd * Math.max(0, _num(mult, 1)) * Math.max(1, k);
        for (let i = 0; i < kd.goods.length; i++) {
            const n = kd.goods[i][1] * f;
            if (n > 0) out.goods[kd.goods[i][0]] = n;
        }
        if (kd.deposit) out.dug = Math.min(_num(site.res), _num(out.goods[kd.first]));
        if (kd.deposit && out.goods[kd.first] > out.dug) {
            const scale = out.dug / out.goods[kd.first];
            for (const g in out.goods) out.goods[g] *= scale;
        }
        return out;
    },

    /** Draw `dug` × `wear` out of the reserve; → 'exhausted' when it runs dry. */
    deplete(site, dug, wear = 1) {
        if (!(site.res0 > 0)) return null;
        site.res = Math.max(0, Math.round((_num(site.res) - Math.max(0, dug) * Math.max(0, _num(wear, 1))) * 100) / 100);
        if (site.res <= 0.01 && site.st === 'open') {
            site.res = 0;
            site.st = 'exhausted';
            return 'exhausted';
        }
        return null;
    },

    /**
     * Land the goods: `homeShare` at the home settlement, the rest at the
     * market town (all at the market with `toMarket`). → units landed.
     */
    deliver(world, site, goods, home, market, toMarket = false) {
        const share = toMarket || !market || market === home ? 0 : _clamp(_num(Hinterland.config().homeShare, 0.5), 0, 1);
        const mh = home ? SettlementMarket.ensure(home) : null;
        const mm = SettlementMarket.ensure(market || home);
        let n = 0;
        for (const g in goods) {
            const units = goods[g];
            if (!(units > 0) || !SettlementMarket.tracks(g)) continue;
            const h = units * share;
            if (h > 0 && mh) mh.stock[g] = Math.round((Math.max(0, _num(mh.stock[g])) + h) * 100) / 100;
            if (units - h > 0 && mm) mm.stock[g] = Math.round((Math.max(0, _num(mm.stock[g])) + units - h) * 100) / 100;
            n += units;
        }
        return n;
    },

    // ── Prospecting ───────────────────────────────────────

    /** Hill and mountain hexes within reach of a town that are no site yet, with the kinds they may hold. */
    prospectHexes(world, town) {
        const C = Hinterland.config();
        const R = Math.max(1, Math.floor(_num(C.reach, 3)));
        const T = C.prospect.terrain || {};
        const out = [];
        for (const h of Hex.hexesInRange(town.q, town.r, R)) {
            if (h.r < 0 || h.r >= world.height) continue;
            const q = world.width ? Hex.wrapQ(h.q, world.width) : h.q;
            const t = world.getTile(q, h.r);
            if (!t || t.settlement || !t.terrain || !_obj(T[t.terrain.id])) continue;
            if (Hinterland.siteAt(world, q, h.r)) continue;
            out.push({ q, r: h.r, weights: T[t.terrain.id] });
        }
        return out;
    },

    /**
     * Strike a vein near a town with the hash `key`: a waning deposit of the
     * town is renewed first, else a new deposit is opened on a hill or
     * mountain within reach. → { kind: 'vein'|'strike', site } or null.
     */
    strike(world, town, key, day, opts = {}) {
        const st = Hinterland.state(world);
        const C = Hinterland.config();
        const P = C.prospect;
        const own = Hinterland.sitesOf(world, town.q, town.r);
        if (!opts.newOnly) {
            const waning = own.filter(s => s.res0 > 0 && s.st === 'open' && Hinterland.reserveFrac(s) < _num(P.wane, 0.4))
                .sort((a, b) => Hinterland.reserveFrac(a) - Hinterland.reserveFrac(b) || (a.id < b.id ? -1 : 1));
            if (waning.length) {
                const s = waning[0];
                const add = s.res0 * (_num(P.veinMin, 0.3) + _roll(`${key}:vein`) * Math.max(0, _num(P.veinMax, 0.7) - _num(P.veinMin, 0.3)));
                s.res = Math.round((_num(s.res) + add) * 100) / 100;
                s.vein = day;
                return { kind: 'vein', site: s, added: Math.round(add) };
            }
        }
        const max = _num(C.maxSites[town.type], 2) + _num(P.extraSites, 2);
        if (own.filter(s => s.st === 'open').length >= max) return null;
        const hexes = Hinterland.prospectHexes(world, town);
        if (!hexes.length) return null;
        const hx = hexes[Math.floor(_roll(`${key}:hex`) * hexes.length) % hexes.length];
        const kindId = Hinterland._pickKind(hx.weights, `${key}:kind`);
        if (!kindId) return null;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const market = Hinterland._marketFor(world, views, town, hx.q, hx.r);
        const site = Hinterland._site(world, kindId, hx.q, hx.r, town, market, day);
        if (opts.by) site.by = opts.by;
        st.sites.push(site);
        Hinterland.touch(st);
        return { kind: 'strike', site };
    },

    // ── News ──────────────────────────────────────────────

    /** A record for the heralds, chatter and counsel ({ key, kind, day, ... }); null when already kept. */
    record(world, entry) {
        const st = Hinterland.state(world);
        if (!st || st.history.some(h => h.key === entry.key)) return null;
        const h = { day: _num(world.day), ...entry };
        st.history.push(h);
        const cap = Math.max(10, _num(Hinterland.config().concessions.historyCap, 40));
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
        return h;
    },

    /** Recent hinterland news within `days` (newest first). */
    recent(world, days = 30) {
        const st = world && _obj(world.hinterland);
        const day = _num(world && world.day);
        return (st && Array.isArray(st.history) ? st.history : []).filter(h => day - _num(h.day) <= days).slice().reverse();
    },
};
