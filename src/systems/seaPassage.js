// ============================================
// SEA PASSAGE — wind on the way, the coast's dangers, pilots and lights
// ============================================
// How a ship makes her way across the sea of a generated world:
//
//   Wind & current — each hex sailed costs 1 league of way at slack water
//     on a fair point of sail; the wind (world/seaWinds.js: prevailing by
//     latitude and season, veering day by day, swirling round storms) and
//     the current (world/oceanCurrents.js) make it cheaper or dearer by the
//     ship's point of sail and rig (beam reach best, dead upwind tacking).
//   The coast's dangers — reefs (tile._reef), shoals off the skerries and
//     a delta's flats, the bar at a river's mouth, the rocks of a fjord
//     (tile._fjord, its fickle wind slow too). Each hazard hex passed risks
//     a strike: worse at speed (orders 'press') and in the dark (the run of
//     the day past the daylight share), by the hull's draft; a local pilot
//     in his own waters, a chart of the hex (a map carried, or the chart
//     draft) and a lighthouse in reach (no darker than day) make it safer.
//     Under cautious orders (the default) the ship shortens sail in hazard
//     water and lies to for the night rather than run an unpiloted, unlit
//     hazard in the dark.
//   Route planning — a weighted search (A* to a port, Dijkstra for the Set
//     Sail list) over the leg costs, steering wide of unpiloted hazards and
//     storms; voyages re-plot from where they are each day as the wind
//     shifts, when a better way opens.
//   Pilots — hired at a port (`hirePilot`, his fee into the port's purse),
//     knowing the waters within a radius of it; aboard for a voyage (put
//     ashore at its end) or `pilots.days`. Ports with a lighthouse send a
//     pilot cutter to a ship making for them.
//   Lighthouses — at the major ports (capitals and cities on the water) and
//     the player's own Lighthouse buildings.
//
// Nothing here imports systems/ships.js (it imports this): the Ships object
// is passed in as `ships` where its helpers are needed. Hazard strikes on a
// voyage draw from the game's seeded RNG (Utils), like the rest of a voyage
// day; the wind and the storms draw none. Off (cost 1 a hex, no planner
// weights) in a world SeaWinds.active refuses, unless a hex there is marked
// with a hazard. Settings: data/seaWinds.json (coast, pilots, lighthouses).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { OceanCurrents } from '../world/oceanCurrents.js';
import { SeaWinds, SeaStorms } from '../world/seaWinds.js';
import { Rivers } from '../world/rivers.js';
import { ShipOfficers } from './shipOfficers.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const KINDS = ['reef', 'shoal', 'bar', 'fjord'];

const DEFAULTS = {
    coast: {
        hazards: {
            reef: { risk: 0.05, atSpeed: 3, night: 6, hull: [10, 26], crewLost: 0.3, cargoLost: 0.4, delay: 1, avoid: 3.5, icon: '⚠️', name: 'reef' },
            shoal: { risk: 0.035, atSpeed: 2, night: 4, hull: [2, 6], crewLost: 0, cargoLost: 0, delay: 0, avoid: 1.2, icon: '🏝️', name: 'shoals' },
            bar: { risk: 0.09, atSpeed: 1.6, night: 3, hull: [1, 5], crewLost: 0, cargoLost: 0, delay: 0, avoid: 0.6, icon: '🏞️', name: 'river bar', slow: 1.2 },
            fjord: { risk: 0.012, atSpeed: 2, night: 5, hull: [4, 10], crewLost: 0.1, cargoLost: 0, delay: 0, avoid: 0.3, icon: '🏔️', name: 'fjord rocks' },
        },
        speedAt: 1.12, pilot: 0.1, chart: 0.5, lit: 1.4, cautiousSlow: 1.4, stormAvoid: 4,
        daylight: { base: 0.5, season: 0.18, min: 0.3, max: 0.72 },
    },
    pilots: {
        byType: {
            village: { fee: 8, radius: 5 }, town: { fee: 15, radius: 7 },
            city: { fee: 26, radius: 9 }, capital: { fee: 34, radius: 10 },
        },
        days: 30, cutterReach: 4, cutterDue: 0.5,
        names: ['Old Tam', 'Ewan Saltbeard', 'Mother Grell', 'Hob the Sounder'],
    },
    lighthouses: { byType: { capital: 5, city: 4 }, playerRadius: 4 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const _key = (q, r) => `${q},${r}`;

function _hash(a, b, c) {
    let n = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(Math.min(v[0], v[1]), Math.max(v[0], v[1]));
    return _num(v);
}

/** A tiny binary heap of [priority, value] */
class _Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(p, v) {
        const a = this.a;
        a.push([p, v]);
        let i = a.length - 1;
        while (i > 0) {
            const j = (i - 1) >> 1;
            if (a[j][0] <= a[i][0]) break;
            const x = a[i]; a[i] = a[j]; a[j] = x;
            i = j;
        }
    }
    pop() {
        const a = this.a;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && a[l][0] < a[m][0]) m = l;
                if (r < a.length && a[r][0] < a[m][0]) m = r;
                if (m === i) break;
                const x = a[i]; a[i] = a[m]; a[m] = x;
                i = m;
            }
        }
        return top;
    }
}

let _src;
let _cfg = null;
const _hazCache = new WeakMap();    // world → Map "q,r" → hazard | null
const _lightCache = new WeakMap();  // world → { day, list }
const _chartCache = new WeakMap();  // player → { sig, set }

export const SeaPassage = {

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.seaWinds;
        if (_cfg && _src === src) return _cfg;
        _src = src;
        const s = _obj(src);
        const c = _obj(s.coast), p = _obj(s.pilots), l = _obj(s.lighthouses);
        const hz = {};
        for (const k of KINDS) hz[k] = { ...DEFAULTS.coast.hazards[k], ..._obj(_obj(c.hazards)[k]) };
        _cfg = {
            coast: { ...DEFAULTS.coast, ...c, hazards: hz, daylight: { ...DEFAULTS.coast.daylight, ..._obj(c.daylight) } },
            pilots: { ...DEFAULTS.pilots, ...p, byType: { ...DEFAULTS.pilots.byType, ..._obj(p.byType) }, names: Array.isArray(p.names) && p.names.length ? p.names : DEFAULTS.pilots.names },
            lighthouses: { ...DEFAULTS.lighthouses, ...l, byType: { ...DEFAULTS.lighthouses.byType, ..._obj(l.byType) } },
        };
        return _cfg;
    },

    /** Forget the merged settings (data/seaWinds.json edited in place). */
    resetConfig() {
        _cfg = null;
    },

    _isWater(tile) {
        return !!(tile && tile.terrain && WATER.has(tile.terrain.id));
    },

    _tile(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        if (Number.isFinite(world.height) && (r < 0 || r >= world.height)) return null;
        return world.getTile(world.width ? Hex.wrapQ(q, world.width) : q, r);
    },

    _dist(world, a, b) {
        return Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, world && world.width ? world.width : 1e9);
    },

    /* ── The coast's dangers ─────────────────────────────────── */

    /**
     * The dangers of water hex (q, r): { reef, shoal, bar, fjord, kinds } or
     * null. Cached per world (the coast does not move).
     */
    hazardAt(world, q, r) {
        if (!world) return null;
        let m = _hazCache.get(world);
        if (!m) { m = new Map(); _hazCache.set(world, m); }
        const W = world.width;
        const qq = W ? Hex.wrapQ(q, W) : q;
        const k = r * 65536 + qq;
        const got = m.get(k);
        if (got !== undefined) return got;
        const out = this._classify(world, qq, r);
        m.set(k, out);
        return out;
    },

    /** Forget the cached coast (a world's tiles changed). */
    resetCoast(world) {
        if (world) _hazCache.delete(world);
    },

    _classify(world, q, r) {
        const tile = this._tile(world, q, r);
        if (!this._isWater(tile)) return null;
        const h = { reef: !!tile._reef, shoal: false, bar: false, fjord: !!tile._fjord };
        const W = world.width;
        const ns = Hex.neighbors(q, r);
        for (let i = 0; i < 6; i++) {
            const n = this._tile(world, ns[i].q, ns[i].r);
            if (!n) continue;
            if (n._skerry) h.shoal = true;
            if (n._delta || n.riverDistributary) { h.shoal = true; h.bar = true; }
            if (this._isWater(n) || !n.hasRiver || tile.waterBodyType === 'lake') continue;
            // a river running out into this hex: its mouth, if it is more than a brook
            const out = Hex.neighbors(n.q, n.r);
            const into = (d) => Number.isInteger(d) && out[d] && (W ? Hex.wrapQ(out[d].q, W) : out[d].q) === q && out[d].r === r;
            if (!into(n.riverDir) && !into(n.riverBranch)) continue;
            let band = 'river';
            try { band = Rivers.band(world, n.q, n.r) || 'river'; } catch { band = 'river'; }
            if (band !== 'brook') h.bar = true;
        }
        h.kinds = KINDS.filter(x => h[x]);
        return h.kinds.length ? h : null;
    },

    /* ── Charts ──────────────────────────────────────────────── */

    /** Has the player a chart of (q, r) — a map they carry showing it, or their own chart draft? */
    charted(player, q, r) {
        if (!player) return false;
        const maps = Array.isArray(player.maps) ? player.maps : [];
        const draft = player.chartDraft && player.chartDraft.tiles ? player.chartDraft.tiles : null;
        const sig = `${maps.length}|${draft ? Object.keys(draft).length : 0}`;
        let c = _chartCache.get(player);
        if (!c || c.sig !== sig) {
            const set = new Set();
            for (const m of maps) {
                if (!m || m.isPropaganda || !Array.isArray(m.tiles)) continue;
                for (const t of m.tiles) if (t && Number.isFinite(t.q)) set.add(_key(t.q, t.r));
            }
            if (draft) for (const k of Object.keys(draft)) set.add(k);
            c = { sig, set };
            _chartCache.set(player, c);
        }
        return c.set.has(_key(q, r));
    },

    /* ── Lighthouses ─────────────────────────────────────────── */

    _isPort(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.settlement) return false;
        return Hex.neighbors(q, r).some(n => this._isWater(this._tile(world, n.q, n.r)));
    },

    /**
     * The lighthouses: the major ports' (capitals and cities on the water,
     * cached per day) and the player's own Lighthouse buildings.
     * → [{ q, r, name, radius, kind: 'port' | 'player' }]
     */
    lighthouses(world, player = null) {
        if (!world) return [];
        const L = this.config().lighthouses;
        const day = _num(world.day, 0);
        let c = _lightCache.get(world);
        if (!c || c.day !== day) {
            const list = [];
            const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
            for (const v of views || []) {
                const t = this._tile(world, v.q, v.r);
                const s = t && t.settlement;
                const radius = s ? _num(L.byType[s.type], 0) : 0;
                if (!(radius > 0) || !this._isPort(world, v.q, v.r)) continue;
                list.push({ q: v.q, r: v.r, name: s.name, radius, kind: 'port' });
            }
            c = { day, list };
            _lightCache.set(world, c);
        }
        const out = c.list.slice();
        for (const p of (player && player.properties) || []) {
            if (!p || p.type !== 'lighthouse_building' || p.underConstruction) continue;
            const t = this._tile(world, p.q, p.r);
            const prop = t && (t.playerProperties || [t.playerProperty]).find(x => x && x.type === p.type);
            if (prop && prop.underConstruction) continue;
            out.push({ q: p.q, r: p.r, name: 'your lighthouse', radius: _num(L.playerRadius, 4), kind: 'player' });
        }
        return out;
    },

    /** The lighthouse whose light reaches (q, r), or null. */
    litAt(world, player, q, r) {
        for (const l of this.lighthouses(world, player)) {
            if (this._dist(world, l, { q, r }) <= l.radius) return l;
        }
        return null;
    },

    /** Does the port at (q, r) keep a lighthouse (and a pilot cutter)? */
    portLight(world, q, r) {
        return this.lighthouses(world, null).find(l => l.q === q && l.r === r) || null;
    },

    /** The share of a day's run sailed in daylight at row r (long summer days toward the pole). */
    daylight(world, r, day = null) {
        const D = this.config().coast.daylight;
        const d = day == null ? _num(world && world.day, 1) : day;
        const H = Math.max(2, _num(world && world.height, 2));
        const lat = 1 - 2 * (r / (H - 1));
        const decl = SeaWinds.season(d).decl;
        return Math.max(_num(D.min, 0.3), Math.min(_num(D.max, 0.72), _num(D.base, 0.5) + _num(D.season, 0.18) * decl * lat));
    },

    /* ── Pilots ──────────────────────────────────────────────── */

    /** The pilot to be had at the port at (q, r): { name, fee, radius, port, q, r } or null. */
    pilotOffer(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.settlement || !this._isPort(world, q, r)) return null;
        const P = this.config().pilots;
        const spec = P.byType[t.settlement.type] || P.byType.town || { fee: 15, radius: 7 };
        const names = P.names;
        const month = Math.floor(_num(world.day, 0) / 30);
        const name = names[Math.floor(_hash(q, r, month) * names.length) % names.length];
        return { name, fee: _num(spec.fee, 15), radius: _num(spec.radius, 7), port: t.settlement.name, q, r };
    },

    /** The pilot aboard (dropped once his days are up), or null. */
    pilotFor(ship, world = null) {
        const p = ship && ship.pilot;
        if (!p) return null;
        if (world && Number.isFinite(p.until) && _num(world.day, 0) > p.until && !ship.voyage) {
            delete ship.pilot;
            return null;
        }
        return p;
    },

    /** Does the pilot aboard know the waters of (q, r)? */
    pilotCovers(ship, world, q, r) {
        const p = this.pilotFor(ship, world);
        return !!p && this._dist(world, p, { q, r }) <= _num(p.radius, 0);
    },

    /**
     * Hire the port's pilot aboard a ship docked where the player stands.
     * His fee goes into the port's purse (ships._payPort).
     */
    hirePilot(ships, player, world, shipId) {
        const ship = ships.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked' || ship.q !== player.q || ship.r !== player.r) return { success: false, message: 'Your ship must be docked at this port, and you with her.' };
        const offer = this.pilotOffer(world, player.q, player.r);
        if (!offer) return { success: false, message: 'There is no pilot to be had here.' };
        const have = this.pilotFor(ship, world);
        if (have && have.q === offer.q && have.r === offer.r) return { success: false, message: `${have.name} is already aboard.` };
        if (_num(player.gold) < offer.fee) return { success: false, message: `The pilot asks ${Utils.formatGold(offer.fee)}g.` };
        player.gold -= offer.fee;
        if (typeof ships._payPort === 'function') ships._payPort(world, player.q, player.r, offer.fee);
        if (player.financeToday) player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + offer.fee;
        ship.pilot = {
            name: offer.name, port: offer.port, q: offer.q, r: offer.r, radius: offer.radius,
            fee: offer.fee, hiredDay: _num(world.day, 0), until: _num(world.day, 0) + _num(this.config().pilots.days, 30), harbour: false,
        };
        return {
            success: true, ship, pilot: ship.pilot,
            message: `${offer.name} of ${offer.port} comes aboard ${ship.name} for ${Utils.formatGold(offer.fee)}g: every reef, bar and shoal within ${offer.radius} leagues is known to them.`,
        };
    },

    /** Put the pilot ashore. → his name, or null */
    dismissPilot(ship) {
        const p = ship && ship.pilot;
        if (!p) return null;
        delete ship.pilot;
        return p.name;
    },

    /**
     * A port with a lighthouse sends out its pilot cutter to a ship making
     * for it, within cutterReach, if she has no pilot for those waters: the
     * harbour pilot's due from the purse. → log text, or null
     */
    _cutter(ships, player, world, ship, v) {
        if (!v || v.destQ == null || v.cutterAsked) return null;
        const P = this.config().pilots;
        const here = { q: ship.q, r: ship.r };
        const dest = { q: v.destQ, r: v.destR };
        if (this._dist(world, here, dest) > _num(P.cutterReach, 4)) return null;
        if (this.pilotCovers(ship, world, v.destQ, v.destR)) return null;
        if (!this.portLight(world, v.destQ, v.destR)) return null;
        v.cutterAsked = true;
        const offer = this.pilotOffer(world, v.destQ, v.destR);
        if (!offer) return null;
        const due = Utils.cents(offer.fee * _num(P.cutterDue, 0.5));
        if (_num(player.gold) < due) return `A pilot cutter comes out from ${offer.port}, but the purse cannot meet the ${Utils.formatGold(due)}g due: you go in unpiloted.`;
        player.gold -= due;
        if (typeof ships._payPort === 'function') ships._payPort(world, v.destQ, v.destR, due);
        if (player.financeToday) player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + due;
        ship.pilot = {
            name: offer.name, port: offer.port, q: offer.q, r: offer.r, radius: _num(P.cutterReach, 4) + 1,
            fee: due, hiredDay: _num(world.day, 0), until: _num(world.day, 0) + 3, harbour: true,
        };
        return `A pilot cutter comes out from ${offer.port}: ${offer.name} takes her in (${Utils.formatGold(due)}g pilotage).`;
    },

    /* ── Legs ────────────────────────────────────────────────── */

    /** Is the wind (and the current) felt in this world? */
    active(world) {
        return SeaWinds.active(world);
    },

    /** Today's wind and the current at (q, r): { wind, cur } — memoised in `memo` (a Map) when given. */
    _seaAt(world, q, r, day, memo) {
        if (!memo) return { wind: SeaWinds.at(world, q, r, day), cur: OceanCurrents.at(world, q, r) };
        const k = r * (world.width || 1) + q;
        let w = memo.get(k);
        if (!w) { w = { wind: SeaWinds.at(world, q, r, day), cur: OceanCurrents.at(world, q, r) }; memo.set(k, w); }
        return w;
    },

    /**
     * Sailing from (fq, fr) into neighbouring (tq, tr): { cost (leagues of
     * way), mult (× her speed, wind and current), wind, point, hazard,
     * covered (a pilot's waters), lit }. ctx: { player, ship, day, orders, memo }.
     */
    leg(world, ctx, fq, fr, tq, tr, side = null) {
        const c = ctx || {};
        const W = world.width;
        const q = W ? Hex.wrapQ(tq, W) : tq;
        const hazard = this.hazardAt(world, q, tr);
        let mult = 1, wind = null, point = null;
        if (this.active(world)) {
            const day = c.day == null ? _num(world.day, 1) : c.day;
            const dir = Number.isInteger(side) ? side : Hex.directionTo(fq, fr, q, tr, W);
            const sea = this._seaAt(world, q, tr, day, c.memo);
            wind = sea.wind;
            const rig = c.rig || SeaWinds.rigOf(c.ship);
            const pos = SeaWinds.pointOfSail(wind, dir, rig);
            point = pos.point;
            let wm = pos.factor;
            if (hazard && hazard.fjord) {
                const S = SeaWinds.config().sailing;
                const oars = Math.max(0, Math.min(1, _num(rig.oars, 0)));
                wm = _num(S.fjordWind, 0.7) * (1 - oars) + oars;
            }
            // (the current's factor on the hex's cost, as OceanCurrents.sailFactor)
            let cur = 1;
            if (dir >= 0 && sea.cur) {
                const a = OceanCurrents.along(sea.cur, dir);
                const sail = OceanCurrents.config().sail;
                cur = a >= 0 ? 1 - a * _num(sail.with, 0.35) : 1 - a * _num(sail.against, 0.35);
            }
            mult = wm / Math.max(0.2, cur);
        }
        let cost = 1 / Math.max(0.1, mult);
        let covered = false;
        if (hazard) {
            const C = this.config().coast;
            covered = !!c.ship && this.pilotCovers(c.ship, world, q, tr);
            if (hazard.bar) cost *= _num(C.hazards.bar.slow, 1.2);
            if (!covered && (c.orders || 'cautious') === 'cautious') cost *= _num(C.cautiousSlow, 1.4);
        }
        return { cost, mult, wind, point, hazard, covered };
    },

    /** The planner's extra weight on a hex: unpiloted hazards (less if charted), storms. */
    _penalty(world, ctx, q, r, legInfo) {
        let p = 0;
        const C = this.config().coast;
        const h = legInfo.hazard;
        if (h && !legInfo.covered) {
            const chart = ctx && ctx.player && this.charted(ctx.player, q, r) ? 0.5 : 1;
            for (const k of h.kinds) p += _num(C.hazards[k].avoid, 0) * chart;
        }
        if (ctx && ctx.stormy && ctx.stormy.size) {
            const k = ctx.stormy.get(r * 65536 + q);
            if (k) p += _num(C.stormAvoid, 4) * k;
        } else if (ctx && ctx.storms && ctx.storms.length) {
            for (const st of ctx.storms) {
                const d = this._dist(world, st, { q, r });
                if (d <= st.radius + 1) p += _num(C.stormAvoid, 4) * st.intensity;
            }
        }
        return p;
    },

    /**
     * The weighted sea search from `from`. With `target`, A* to it (a port);
     * without, Dijkstra out to every port in reach. Ports end a route, never
     * sailed through; water only otherwise (as Ships._seaSearch).
     * → Map index → { q, r, g (cost), d (hexes), prev }
     */
    search(ships, world, from, opts = {}) {
        const W = world.width || 0, H = world.height || 0;
        const target = opts.target ? { q: W ? Hex.wrapQ(opts.target.q, W) : opts.target.q, r: opts.target.r } : null;
        const max = _num(opts.maxNodes, 60000);
        const ctx = {
            player: opts.player || null, ship: opts.ship || null, orders: opts.orders || null,
            day: opts.day == null ? _num(world.day, 1) : opts.day, memo: new Map(), rig: SeaWinds.rigOf(opts.ship || null),
            storms: this.active(world) ? SeaStorms.active(world, opts.day == null ? world.day : opts.day) : [],
        };
        // (the hexes a storm covers, to steer wide of: r * 65536 + q → intensity)
        ctx.stormy = new Map();
        for (const st of ctx.storms) {
            for (const hx of Hex.hexesInRange(st.q, st.r, st.radius + 2)) {
                const q = W ? Hex.wrapQ(hx.q, W) : hx.q;
                if (this._dist(world, st, { q, r: hx.r }) > st.radius + 1) continue;
                const k = hx.r * 65536 + q;
                ctx.stormy.set(k, Math.max(ctx.stormy.get(k) || 0, st.intensity));
            }
        }
        const idx = (q, r) => r * (W || 1e6) + q;
        const sq = W ? Hex.wrapQ(from.q, W) : from.q;
        const start = { q: sq, r: from.r, g: 0, d: 0, prev: null, closed: false };
        const nodes = new Map([[idx(sq, from.r), start]]);
        const heap = new _Heap();
        // (a weighted A*: a league a hex is about what the sea averages, so the search
        // keeps toward the port; a little short of the cheapest way at worst)
        const hw = _num(opts.heuristic, 0.8);
        const hOf = target ? (q, r) => hw * this._dist(world, { q, r }, target) : () => 0;
        heap.push(hOf(sq, from.r), start);
        const isWater = (t) => (ships && typeof ships.isWaterTile === 'function' ? ships.isWaterTile(t) : this._isWater(t));
        while (heap.size && nodes.size < max) {
            const [, cur] = heap.pop();
            if (cur.closed) continue;
            cur.closed = true;
            if (target && cur.q === target.q && cur.r === target.r) break;
            if (cur.d > 0 && !isWater(world.getTile(cur.q, cur.r))) continue;
            const nbrs = Hex.neighbors(cur.q, cur.r);
            for (let side = 0; side < 6; side++) {
                const n = nbrs[side];
                const q = W ? Hex.wrapQ(n.q, W) : n.q;
                const r = n.r;
                if (H && (r < 0 || r >= H)) continue;
                const t = world.getTile(q, r);
                if (!t) continue;
                const isTarget = !!target && q === target.q && r === target.r;
                if (!isWater(t) && !(isTarget || (!target && t.settlement))) continue;
                const li = this.leg(world, ctx, cur.q, cur.r, q, r, side);
                const g = cur.g + li.cost + this._penalty(world, ctx, q, r, li);
                const k = idx(q, r);
                const old = nodes.get(k);
                if (old && (old.closed || old.g <= g)) continue;
                const node = { q, r, g, d: cur.d + 1, prev: cur, closed: false };
                nodes.set(k, node);
                heap.push(g + hOf(q, r), node);
            }
        }
        return nodes;
    },

    /** Trace a search node back to a route (excluding the start). */
    _trace(node) {
        const path = [];
        while (node && node.prev) { path.push({ q: node.q, r: node.r }); node = node.prev; }
        return path.reverse();
    },

    /** The planned route from `from` to the port `to`: [{ q, r }] excluding the start, or null. */
    route(ships, world, from, to, opts = {}) {
        const W = world.width || 0;
        const tq = W ? Hex.wrapQ(to.q, W) : to.q;
        const nodes = this.search(ships, world, from, { ...opts, target: { q: tq, r: to.r } });
        const node = nodes.get(to.r * (W || 1e6) + tq);
        if (!node || node.d === 0) return null;
        return this._trace(node);
    },

    /**
     * Plan to every port in reach at once (the Set Sail list): → { routeTo(q, r)
     * → route | null, daysTo(q, r, speed) }.
     */
    planFrom(ships, world, from, opts = {}) {
        const nodes = this.search(ships, world, from, opts);
        const W = world.width || 0;
        const get = (q, r) => nodes.get(r * (W || 1e6) + (W ? Hex.wrapQ(q, W) : q));
        return {
            routeTo: (q, r) => { const n = get(q, r); return n && n.d > 0 ? this._trace(n) : null; },
            daysTo: (q, r, speed) => {
                const n = get(q, r);
                if (!n || !n.d) return null;
                const route = this._trace(n);
                return this.routeDays(world, { ...opts, day: opts.day }, from, route, 0, speed);
            },
        };
    },

    /** Leagues of way along `route` from step `fromStep` (the hex before it, or `start`). */
    routeCost(world, ctx, start, route, fromStep = 0) {
        const c = { ...(ctx || {}), memo: new Map() };
        let sum = 0;
        let prev = fromStep > 0 ? { q: route[fromStep - 1][0] ?? route[fromStep - 1].q, r: route[fromStep - 1][1] ?? route[fromStep - 1].r } : start;
        for (let i = fromStep; i < route.length; i++) {
            const h = route[i];
            const q = Array.isArray(h) ? h[0] : h.q, r = Array.isArray(h) ? h[1] : h.r;
            sum += this.leg(world, c, prev.q, prev.r, q, r).cost;
            prev = { q, r };
        }
        return sum;
    },

    /** Days to sail the route at `speed` leagues a day (at least 1). */
    routeDays(world, ctx, start, route, fromStep, speed) {
        return Math.max(1, Math.ceil(this.routeCost(world, ctx, start, route, fromStep) / Math.max(0.5, speed) - 1e-9));
    },

    /* ── A voyage day ────────────────────────────────────────── */

    /** The voyage's orders: 'cautious' (default) or 'press'. */
    orders(v) {
        return v && v.orders === 'press' ? 'press' : 'cautious';
    },

    /** Set the voyage's orders → { success, message } */
    setOrders(ships, player, mode) {
        const v = ships.getVoyage(player);
        if (!v) return { success: false, message: 'You are not on a voyage.' };
        v.orders = mode === 'press' ? 'press' : 'cautious';
        return {
            success: true, orders: v.orders,
            message: v.orders === 'press'
                ? 'Press on: all sail, day and night, through whatever lies in the way.'
                : 'Go carefully: shorten sail in foul water, and lie to at night rather than run it blind.',
        };
    },

    /**
     * The chance of striking `hazard` on a hex: its worst kind's risk ×
     * speed, the dark, draft, a pilot and a chart. → { kind, p } or null
     */
    strikeChance(world, player, ship, q, r, { night = false, atSpeed = false, hazard = null } = {}) {
        const h = hazard || this.hazardAt(world, q, r);
        if (!h) return null;
        const C = this.config().coast;
        const draft = Math.max(0.05, _num(SeaWinds.rigOf(ship).draft, 1));
        const covered = this.pilotCovers(ship, world, q, r);
        const chart = this.charted(player, q, r);
        const lit = night && !!this.litAt(world, player, q, r);
        // a navigator keeps her off the worst of it (systems/shipOfficers.js routeSafety)
        const safety = Math.min(0.9, ShipOfficers.bonus(ship, 'routeSafety', world));
        let best = null;
        for (const k of h.kinds) {
            const H = C.hazards[k];
            let p = _num(H.risk, 0) * draft;
            if (atSpeed) p *= _num(H.atSpeed, 1);
            if (night) p *= lit ? _num(C.lit, 1.4) : _num(H.night, 1);
            if (covered) p *= _num(C.pilot, 0.1);
            if (chart) p *= _num(C.chart, 0.5);
            p *= 1 - safety;
            p = Math.min(0.9, p);
            if (!best || p > best.p) best = { kind: k, p };
        }
        return best;
    },

    /** Strike `kind` of the coast: hull, a hand, cargo, a lost day. → { kind, icon, text, damage, delay } */
    _strike(ships, player, world, ship, kind) {
        const H = this.config().coast.hazards[kind];
        const draft = Math.max(0.2, _num(SeaWinds.rigOf(ship).draft, 1));
        const raw = Math.round(_roll(H.hull) * draft);
        const damage = typeof ships.mitigateHullDamage === 'function' ? ships.mitigateHullDamage(ship, raw) : raw;
        const before = _num(ship.condition, 100);
        ship.condition = Math.max(5, before - damage);
        const bits = [];
        if (_num(H.crewLost) > 0 && _num(ship.crew) > 0 && Utils.random() < H.crewLost) {
            ship.crew -= 1;
            bits.push('a hand was lost');
        }
        let gone = null;
        if (_num(H.cargoLost) > 0 && Utils.random() < H.cargoLost) {
            const goods = Object.keys(ship.cargo || {}).filter(g => ship.cargo[g] > 0);
            if (goods.length) {
                const good = Utils.randPick(goods);
                const lost = Math.max(1, Math.floor(ship.cargo[good] * 0.15));
                ship.cargo[good] -= lost;
                if (ship.cargo[good] <= 0) delete ship.cargo[good];
                gone = { [good]: lost };
                bits.push(`${lost} ${String(good).replace(/_/g, ' ')} jettisoned to float her off`);
            }
        }
        if (typeof ships._reportSeaLoss === 'function') ships._reportSeaLoss(player, world, ship, before - ship.condition, gone, `struck ${H.name}`);
        const what = {
            reef: 'Struck a reef — coral tore at the planking',
            shoal: 'Ran aground on the shoals and kedged off',
            bar: 'Grounded on the bar at the river mouth, and waited on the tide',
            fjord: 'Scraped the rocks in the narrows of the fjord',
        }[kind] || `Struck ${H.name}`;
        const text = `${what} (hull −${damage}%)${bits.length ? `; ${bits.join(', ')}` : ''}.`;
        return { kind, icon: H.icon || '⚠️', text, damage, delay: _num(H.delay, 0) };
    },

    /**
     * Sail the voyage on by a day's way: `budget` leagues (the ship's speed,
     * less in a storm) plus what the last day left over, hex by hex along
     * voyage.route at each leg's cost; the coast's dangers met on the way;
     * a cutter coming out. → { moved, strikes: [...], lay: kind | null, cutter, wind, point, mult }
     */
    sailDay(ships, player, world, ship, budget) {
        const v = ship.voyage;
        const out = { moved: 0, strikes: [], lay: null, cutter: null, wind: null, point: null, mult: 1 };
        if (!v || !Array.isArray(v.route)) return out;
        const orders = this.orders(v);
        const ctx = { player, ship, orders, day: _num(world.day, 1), memo: new Map() };
        const C = this.config().coast;
        const day = Math.max(0, budget);
        let acc = _num(v.legCarry) + day;
        let spent = 0;
        const dayShare = this.daylight(world, ship.r, ctx.day);
        let stop = false;
        while (v.step < v.route.length && !stop) {
            const from = v.step > 0 ? { q: v.route[v.step - 1][0], r: v.route[v.step - 1][1] } : { q: v.fromQ, r: v.fromR };
            const [tq, tr] = v.route[v.step];
            const li = this.leg(world, ctx, from.q, from.r, tq, tr);
            if (!out.wind && li.wind) { out.wind = li.wind; out.point = li.point; out.mult = li.mult; }
            if (acc + 1e-9 < li.cost) break;
            const night = day > 0 && (spent + li.cost / 2) > dayShare * day;
            if (li.hazard && night && orders === 'cautious' && !li.covered && !this.litAt(world, player, tq, tr)) {
                out.lay = li.hazard.kinds[0];
                acc = 0;
                break;
            }
            acc -= li.cost;
            spent += li.cost;
            v.step += 1;
            out.moved += 1;
            ship.q = tq; ship.r = tr;
            if (li.hazard) {
                const atSpeed = orders === 'press' && li.mult >= _num(C.speedAt, 1.12);
                const sc = this.strikeChance(world, player, ship, tq, tr, { night, atSpeed, hazard: li.hazard });
                if (sc && Utils.random() < sc.p) {
                    const s = this._strike(ships, player, world, ship, sc.kind);
                    out.strikes.push(s);
                    if (s.delay > 0) v.delay = _num(v.delay) + s.delay;
                    acc = 0;
                    stop = true;
                }
            }
            if (!out.cutter) out.cutter = this._cutter(ships, player, world, ship, v);
        }
        v.legCarry = stop || out.lay ? 0 : Math.max(0, Math.min(acc, 2));
        return out;
    },

    /**
     * A day's re-plot: the wind has shifted, so a better way may have opened
     * from where the ship lies. Adopts it when it saves at least `gain` of
     * the way left. → true when the route changed
     */
    replot(ships, player, world, ship, gain = 0.12, every = 3) {
        const v = ship.voyage;
        if (!v || !this.active(world) || v.expedition) return false;
        // (the master looks again every few days, not every watch)
        const today = _num(world.day, 0);
        if (Number.isFinite(v.replotDay) && today - v.replotDay < every) return false;
        v.replotDay = today;
        const here = { q: ship.q, r: ship.r };
        const ctx = { player, ship, orders: this.orders(v) };
        const left = this.routeCost(world, ctx, { q: v.fromQ, r: v.fromR }, v.route, v.step);
        // (a search bounded by the way left: a new course near the old one, not a new ocean)
        const maxNodes = Math.max(800, (v.route.length - v.step) * 25);
        const route = this.route(ships, world, here, { q: v.destQ, r: v.destR }, { ...ctx, maxNodes });
        if (!route) return false;
        const cost = this.routeCost(world, ctx, here, route, 0);
        if (!(cost < left * (1 - gain))) return false;
        v.route = route.map(h => [h.q, h.r]);
        v.step = 0;
        v.fromQ = here.q;
        v.fromR = here.r;
        return true;
    },

    /** At the end of a voyage the pilot goes ashore. → his name, or null */
    onArrive(ship) {
        return this.dismissPilot(ship);
    },

    /* ── At the helm, hex by hex ─────────────────────────────── */

    /**
     * The player sails a hex at the helm (the world map, no voyage): the
     * coast's danger there, in daylight, at speed when the wind is fair.
     * → { icon, text } when she struck, else null
     */
    helmHex(ships, player, world, fq, fr, tq, tr) {
        if (!player || player.boardedShip == null || !world) return null;
        const ship = ships.getShipById(player, player.boardedShip);
        if (!ship || ship.voyage) return null;
        const li = this.leg(world, { player, ship, orders: 'press' }, fq, fr, tq, tr);
        if (!li.hazard) return null;
        const atSpeed = li.mult >= _num(this.config().coast.speedAt, 1.12);
        const sc = this.strikeChance(world, player, ship, tq, tr, { atSpeed, hazard: li.hazard });
        if (!sc || !(Utils.random() < sc.p)) return null;
        const s = this._strike(ships, player, world, ship, sc.kind);
        return { icon: s.icon, text: `${ship.name}: ${s.text}`, damage: s.damage };
    },

    /* ── For the panels ──────────────────────────────────────── */

    /** The sea at (q, r) in a few words for the hex panel: ['🌬️ a fresh westerly', '⚠️ Reef', …] */
    hexNotes(world, player, q, r) {
        const out = [];
        const t = this._tile(world, q, r);
        if (!t) return out;
        if (this._isWater(t) && this.active(world)) {
            const w = SeaWinds.at(world, q, r, world.day);
            out.push(`🌬️ Wind: ${SeaWinds.describe(w)}`);
            const st = SeaStorms.dangerAt(world, q, r, world.day);
            if (st) out.push(`🌀 ${SeaStorms.describe(world, st.storm)}`);
        }
        const h = this.hazardAt(world, q, r);
        if (h) {
            const C = this.config().coast.hazards;
            out.push(h.kinds.map(k => `${C[k].icon} ${C[k].name[0].toUpperCase()}${C[k].name.slice(1)}`).join(' · ') + (player && this.charted(player, q, r) ? ' (charted)' : ''));
        }
        const light = this.litAt(world, player, q, r);
        if (light) out.push(`🗼 In the light of ${light.kind === 'player' ? light.name : `${light.name}'s lighthouse`}`);
        return out;
    },

    /**
     * The voyage as the panel shows it: { wind, point, factor, current,
     * pilot, orders, ahead: [{ kind, icon, name, q, r, covered, charted }],
     * storms: [text], lit }
     */
    voyageView(ships, player, world) {
        const ship = ships.getVoyageShip(player);
        if (!ship || !world) return null;
        const v = ship.voyage;
        const out = { orders: this.orders(v), wind: null, point: null, factor: 1, current: '', pilot: null, ahead: [], storms: [], lit: null };
        const pilot = this.pilotFor(ship, world);
        if (pilot) out.pilot = { name: pilot.name, port: pilot.port, radius: pilot.radius, here: this.pilotCovers(ship, world, ship.q, ship.r), harbour: !!pilot.harbour };
        if (v.step < v.route.length) {
            const from = v.step > 0 ? { q: v.route[v.step - 1][0], r: v.route[v.step - 1][1] } : { q: v.fromQ, r: v.fromR };
            const [tq, tr] = v.route[v.step];
            const li = this.leg(world, { player, ship, orders: out.orders }, from.q, from.r, tq, tr);
            if (li.wind) { out.wind = SeaWinds.describe(li.wind); out.point = SeaWinds.pointName(li.point); out.factor = Math.round(li.mult * 100) / 100; }
        }
        out.current = OceanCurrents.describe(OceanCurrents.at(world, ship.q, ship.r));
        const reach = Math.max(1, Math.ceil(_num(ships.getSailingSpeed(player, ship), 3) * 1.5));
        const C = this.config().coast.hazards;
        for (let i = v.step; i < Math.min(v.route.length, v.step + reach); i++) {
            const [q, r] = v.route[i];
            const h = this.hazardAt(world, q, r);
            if (!h) continue;
            for (const k of h.kinds) out.ahead.push({ kind: k, icon: C[k].icon, name: C[k].name, q, r, covered: this.pilotCovers(ship, world, q, r), charted: this.charted(player, q, r) });
        }
        for (const e of SeaStorms.near(world, ship.q, ship.r, world.day)) out.storms.push(SeaStorms.describe(world, e.storm, ship));
        const lit = this.litAt(world, player, ship.q, ship.r);
        if (lit) out.lit = lit.kind === 'player' ? lit.name : `${lit.name}'s lighthouse`;
        return out;
    },
};
