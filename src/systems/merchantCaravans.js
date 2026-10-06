// ============================================
// MERCHANT CARAVANS — the NPC trade flows, on the road
// ============================================
// The settlement markets trade along their links every market turn
// (world/settlementMarket.js flows, driven by systems/marketDynamics.js). A
// sampled share of those flows is EMBODIED: on a link picked for it the
// goods leave the exporter as usual, but instead of landing in the importer
// they are loaded on a caravan ('trade_caravan', along the roads) or a
// trading ship ('trade_ship', along a sea link) — a real world unit that
// travels the route and lands its cargo in the destination market only when
// it arrives. Everything else still moves in aggregate, so balance holds.
// The trade income of an embodied lot rides with it too (unit.margin): both
// towns bank half on arrival; a robbed cargo earns them nothing, a seized
// one earns the seizer's market.
//
//   Sampling   A market turn embodies at most spawn.perTurn links, never more
//              traders on the map than the cap (cap.perSettlement x towns,
//              clamped), never two on one link, never a road merchants shun.
//              Lots too small to be worth the trip land at once. The pick is a
//              hash of the world seed, the day and the link: no RNG.
//   The road   Raiders and pirates (lair parties among them) within a hex
//              fall on a trader; passing near an outlaw lair risks an ambush;
//              a realm at war with the trader's realms seizes it in its land.
//              Guards, road wardens and a hired escort fight back. A taken
//              cargo goes to the robbers (a lair banks it in its hoard) or the
//              seizing realm's nearest market — and never reaches the town
//              that waited for it: a dearth follows downstream. Merchants
//              shun the road for fear.days (marketDynamics thins the link).
//              Losses worth a herald's cry are recorded (Heralds reads them).
//   Tolls      Crossing into another realm's land a trader pays tolls.rate of
//              its cargo's value from its purse into that realm's treasury.
//   Wardens    Realms with full treasuries (or lawful lords) send road
//              patrols ('road_patrol') up and down their busiest roads, paid
//              from the treasury; they break raider bands and guard traders.
//   The player meets a trader on the road: buys from its cargo (or sells it
//              the goods it deals in) at a price between the origin's and the
//              destination's, hires on as escort (paid on arrival; ambushes
//              become fights through PlayerMilitary), or robs it (the attack
//              goes through PlayerMilitary.attackUnit; onRobbed: hot goods,
//              underworld heat, realm reputation, witnesses → Gossip bounty).
//
// The daily tick draws from its own Utils stream seeded by the world seed and
// the day (Utils.withRng), so it never shifts any other system's dice; the
// player's own fights draw from the main stream like any action. State on
// world.merchantTrade (systems/saveLoad.js); the units are saved with
// world.units. Content in data/merchantCaravans.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { WorldUnit } from '../world/units.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { OutlawLairs } from './outlawLairs.js';
import { Underworld } from './underworld.js';

export const TRADER_TYPES = ['trade_caravan', 'trade_ship'];
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const ROADS = ['dirt_road', 'stone_road', 'bridge'];
const MAX_NODES = 2600;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _round2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _dist(world, q1, r1, q2, r2) {
    return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

function _settlements(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
    return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
}

function _isRoad(t) {
    if (!t) return false;
    if (t.hasRoad) return true;
    return !!(t.infrastructure && ROADS.includes(t.infrastructure.id) && !t.infrastructure.underConstruction);
}

function _isWater(t) {
    return !!(t && t.terrain && WATER.has(t.terrain.id));
}

/** Goods definitions (data/playerEconomy.json GOODS): name, icon, base price. */
function _goodDef(id) {
    const gd = DataLoader._gamedata;
    const G = gd && gd.playerEconomy && gd.playerEconomy.GOODS;
    const g = G && G[String(id).toUpperCase()];
    return g || { id, name: String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '📦', basePrice: 10 };
}

/** Min-heap of [priority, key] pairs for the route search. */
class _Heap {
    constructor() { this.p = []; this.k = []; }
    get size() { return this.p.length; }
    push(pr, key) {
        const p = this.p, k = this.k;
        let i = p.length;
        p.push(pr); k.push(key);
        while (i > 0) {
            const up = (i - 1) >> 1;
            if (p[up] <= pr) break;
            p[i] = p[up]; k[i] = k[up];
            i = up;
        }
        p[i] = pr; k[i] = key;
    }
    pop() {
        const p = this.p, k = this.k;
        const top = k[0];
        const lp = p.pop(), lk = k.pop();
        if (p.length) {
            let i = 0;
            const n = p.length;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && p[c + 1] < p[c]) c++;
                if (p[c] >= lp) break;
                p[i] = p[c]; k[i] = k[c];
                i = c;
            }
            p[i] = lp; k[i] = lk;
        }
        return top;
    }
}

/** Per-world caches rebuilt from world state (routes between towns). */
const _caches = new WeakMap();

export const MerchantCaravans = {

    // ──────────── DATA ────────────

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.merchantCaravans) || {};
        const sec = (k, def) => ({ ...def, ...(d[k] && typeof d[k] === 'object' ? d[k] : {}) });
        return {
            cap: sec('cap', { perSettlement: 0.25, min: 4, max: 24 }),
            spawn: sec('spawn', { perTurn: 3, minValue: 80, minDist: 3 }),
            land: sec('land', { icon: '🐫', name: '{good} Caravan', carrier: 'caravan', speed: 3, roadSpeed: 4, guards: 4, perValue: 0.012, maxGuards: 26 }),
            sea: sec('sea', { icon: '⛵', name: '{good} Trader', carrier: 'trader', speed: 6, roadSpeed: 6, guards: 6, perValue: 0.012, maxGuards: 30 }),
            purse: sec('purse', { share: 0.3, min: 25 }),
            trade: sec('trade', { markup: 0.1, markdown: 0.12 }),
            escort: sec('escort', { share: 0.07, min: 15, max: 300, range: 2, leash: 6, graceDays: 2, reputation: 3, renown: 1 }),
            ambush: sec('ambush', { raiderRange: 1, lairRange: 2, lairChance: 0.3, lairShare: 0.35, warSeize: 0.35, patrolRange: 2 }),
            fear: sec('fear', { days: 12, cut: 0.5 }),
            robbery: sec('robbery', { reputation: 15, witnessRange: 4, fear: true }),
            tolls: sec('tolls', { rate: 0.03, min: 1 }),
            patrols: sec('patrols', {
                every: 10, chance: 0.35, minTreasury: 2500, lawfulBonus: 0.5, cost: 80, days: 30,
                strength: [16, 30], speed: 4, max: 6, huntRange: 3, icon: '💂', name: '{kingdom} Road Wardens',
            }),
            notableValue: _num(d.notableValue, 150),
            historyCap: _num(d.historyCap, 30),
        };
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            seq: 0, lastDay: null, fear: {}, traffic: {}, history: [],
            stats: { spawned: 0, delivered: 0, landedAtOnce: 0, taken: 0, seized: 0, robbed: 0, tolls: 0, patrols: 0, raidersBroken: 0, escorts: 0, escortPay: 0, marginPaid: 0, marginLost: 0, marginSeized: 0 },
        };
    },

    /** The world's caravan record (created on first use; old saves backfill). */
    state(world) {
        if (!world) return MerchantCaravans._blank();
        let st = world.merchantTrade;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            world.merchantTrade = MerchantCaravans._blank();
            return world.merchantTrade;
        }
        const blank = MerchantCaravans._blank();
        if (!(st.seq >= 0)) st.seq = 0;
        if (st.lastDay === undefined) st.lastDay = null;
        if (!st.fear || typeof st.fear !== 'object') st.fear = {};
        if (!st.traffic || typeof st.traffic !== 'object') st.traffic = {};
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        return st;
    },

    serialize(world) {
        return world && world.merchantTrade ? JSON.parse(JSON.stringify(world.merchantTrade)) : null;
    },

    /** Put the record back after a load (older saves: a blank one). */
    restore(saved, world) {
        if (!world) return;
        world.merchantTrade = saved && typeof saved === 'object' ? JSON.parse(JSON.stringify(saved)) : null;
        MerchantCaravans.state(world);
    },

    isTrader(u) {
        return !!(u && TRADER_TYPES.includes(u.type));
    },

    /** Traders on the map today. */
    traders(world) {
        return ((world && world.units) || []).filter(u => u && !u.destroyed && MerchantCaravans.isTrader(u));
    },

    /** How many traders may be on the road at once (scales with the towns). */
    cap(world, towns = null) {
        const C = MerchantCaravans.config().cap;
        const n = towns != null ? towns : _settlements(world).length;
        return Math.max(_num(C.min, 4), Math.min(_num(C.max, 24), Math.round(n * _num(C.perSettlement, 0.25))));
    },

    linkKey(a, b) {
        const ka = `${a.q},${a.r}`, kb = `${b.q},${b.r}`;
        return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    },

    /** Factor on a link's trade while merchants shun it after a loss (1 = no fear). */
    fearFactor(world, link, day = _day(world)) {
        const st = world && world.merchantTrade;
        if (!st || !st.fear || !link || !link.a || !link.b) return 1;
        const until = st.fear[MerchantCaravans.linkKey(link.a, link.b)];
        return Number.isFinite(until) && day < until ? 1 - _num(MerchantCaravans.config().fear.cut, 0.5) : 1;
    },

    // ──────────── ROUTES ────────────

    _cache(world) {
        let c = _caches.get(world);
        if (!c) {
            c = { routes: new Map() };
            _caches.set(world, c);
        }
        return c;
    },

    /**
     * The way from `a` to `b` as a flat [q0, r0, q1, r1, ...] list (both
     * ends included), or null: overland preferring roads, or by water for a
     * sea link (the ports at either end). Kept for a month per link.
     */
    route(world, a, b, sea = false) {
        const cache = MerchantCaravans._cache(world);
        const month = Math.floor(_day(world) / 30);
        const key = `${a.q},${a.r}>${b.q},${b.r}:${sea ? 1 : 0}`;
        const hit = cache.routes.get(key);
        if (hit && hit.month === month) return hit.route;
        const route = MerchantCaravans._search(world, a.q, a.r, b.q, b.r, sea);
        cache.routes.set(key, { month, route });
        return route;
    },

    /** A* over the hexes (road hexes cost half; water only for ships). */
    _search(world, sq, sr, eq, er, sea) {
        if (!world || typeof world.getTile !== 'function') return null;
        const W = world.width || 0;
        const H = world.height || 0;
        if (!(W > 0) || !(H > 0)) return null;
        const id = (q, r) => r * W + q;
        const startK = id(sq, sr), endK = id(eq, er);
        const g = new Map([[startK, 0]]);
        const from = new Map();
        const closed = new Set();
        const heap = new _Heap();
        heap.push(Hex.wrappingDistance(sq, sr, eq, er, W) * (sea ? 1 : 0.5), startK);
        let n = 0;
        while (heap.size && n++ < MAX_NODES) {
            const cur = heap.pop();
            if (cur === endK) {
                const out = [];
                let k = cur;
                while (k !== undefined) {
                    out.push(k % W, Math.floor(k / W));
                    k = from.get(k);
                }
                const route = [];
                for (let i = out.length - 2; i >= 0; i -= 2) route.push(out[i], out[i + 1]);
                return route;
            }
            if (closed.has(cur)) continue;
            closed.add(cur);
            const cq = cur % W, cr = Math.floor(cur / W);
            const gc = g.get(cur);
            for (const nb of Hex.neighbors(cq, cr)) {
                const nr = nb.r;
                if (nr < 0 || nr >= H) continue;
                const nq = Hex.wrapQ(nb.q, W);
                const nk = id(nq, nr);
                if (closed.has(nk)) continue;
                const t = world.getTile(nq, nr);
                if (!t || !t.terrain) continue;
                let cost;
                if (nk === endK) cost = 1;
                else if (sea) {
                    if (!_isWater(t)) continue;
                    cost = 1;
                } else {
                    if (!t.terrain.passable) continue;
                    cost = _isRoad(t) ? 0.5 : Math.max(1, Math.min(3, _num(t.terrain.moveCost, 1)));
                }
                const ng = gc + cost;
                const old = g.get(nk);
                if (old !== undefined && old <= ng) continue;
                g.set(nk, ng);
                from.set(nk, cur);
                heap.push(ng + Hex.wrappingDistance(nq, nr, eq, er, W) * (sea ? 1 : 0.5), nk);
            }
        }
        return null;
    },

    // ──────────── THE MARKET TURN (from MarketDynamics.updatePrices) ────────────

    /**
     * Pick the links whose trade travels as a caravan this market turn (sets
     * link.embody, which SettlementMarket.flows reads). Only links trading
     * today, never one already carrying a trader or shunned for fear, never
     * past the cap; the busiest first, with a hash of the seed and the day to
     * vary it. Draws no RNG. @returns {number} links picked
     */
    selectLinks(world, links, turn = null, day = _day(world)) {
        if (!Array.isArray(links)) return 0;
        for (const l of links) {
            if (l.embody) l.embody = false;
            if (l.cargoAB) l.cargoAB = null;
            if (l.cargoBA) l.cargoBA = null;
            if (l.goldAB) l.goldAB = 0;
            if (l.goldBA) l.goldBA = 0;
        }
        if (!world || !Array.isArray(world.units)) return 0;
        const C = MerchantCaravans.config();
        const st = MerchantCaravans.state(world);
        let active = 0;
        const busy = new Set();
        for (const u of world.units) {
            if (!u || u.destroyed || !MerchantCaravans.isTrader(u)) continue;
            active++;
            busy.add(u.linkKey);
        }
        let room = Math.min(MerchantCaravans.cap(world) - active, Math.floor(_num(C.spawn.perTurn, 3)));
        if (room <= 0) return 0;
        const seed = _seed(world);
        const cands = [];
        for (const l of links) {
            if (!l || !l.a || !l.b) continue;
            if (turn !== null && l.slot !== undefined && l.slot !== turn) continue;
            if (_num(l.dist) < _num(C.spawn.minDist, 3)) continue;
            const key = MerchantCaravans.linkKey(l.a, l.b);
            if (busy.has(key)) continue;
            const until = st.fear[key];
            if (Number.isFinite(until) && day < until) continue;
            const jitter = 0.5 + (_hash(`${seed}:trade:${day}:${key}`) % 1000) / 1000;
            cands.push({ l, key, score: _num(l.base, 60) * (1 + 0.25 * _num(l.routes)) * jitter });
        }
        cands.sort((x, y) => (y.score - x.score) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
        let picked = 0;
        for (const c of cands) {
            if (room <= 0) break;
            const route = MerchantCaravans.route(world, c.l.a, c.l.b, !!c.l.sea);
            if (!route || route.length < 4) continue;
            c.l.embody = true;
            room--;
            picked++;
        }
        return picked;
    },

    /**
     * After the flows: put each embodied link's cargo on the road (one trader
     * per direction), or land a lot too small for the trip (or over the cap)
     * at once. `bases`: { goodId: base price }. `player` (optional) names the
     * merchant houses the player knows and the lairs on the way.
     */
    dispatch(world, links, bases, day = _day(world), player = null) {
        if (!Array.isArray(links) || !world) return 0;
        const C = MerchantCaravans.config();
        const ids = SettlementMarket.config().goodIds;
        let active = MerchantCaravans.traders(world).length;
        const cap = MerchantCaravans.cap(world);
        let spawned = 0;
        for (const l of links) {
            if (!l || !l.embody) continue;
            for (const [arr, from, to, gold] of [[l.cargoAB, l.a, l.b, l.goldAB], [l.cargoBA, l.b, l.a, l.goldBA]]) {
                if (!arr) continue;
                const margin = Math.max(0, _num(gold));
                let value = 0;
                const cargo = {};
                for (let i = 0; i < ids.length; i++) {
                    if (!(arr[i] > 0)) continue;
                    cargo[ids[i]] = _round2(arr[i]);
                    value += arr[i] * _num(bases && bases[ids[i]], 0);
                }
                if (!Object.keys(cargo).length) continue;
                const route = value >= _num(C.spawn.minValue, 80) && active < cap
                    ? MerchantCaravans.route(world, from, to, !!l.sea) : null;
                if (!route) {
                    for (const [id, q] of Object.entries(cargo)) SettlementMarket.add(to, id, q);
                    MerchantCaravans.state(world).stats.landedAtOnce++;
                    MerchantCaravans._credit(from, margin / 2);
                    MerchantCaravans._credit(to, margin / 2);
                    continue;
                }
                const unit = MerchantCaravans._spawn(world, l, from, to, cargo, value, route, bases, day, player);
                if (unit) unit.margin = _round2(margin);
                active++;
                spawned++;
            }
            l.embody = false;
            l.cargoAB = null;
            l.cargoBA = null;
            l.goldAB = 0;
            l.goldBA = 0;
        }
        return spawned;
    },

    /** Bank trade income (economy.tradeIncome, paid out by Economy.processTrade) in a town. */
    _credit(settlement, gold) {
        if (!settlement || !settlement.economy || !(gold > 0)) return 0;
        settlement.economy.tradeIncome = _round2(_num(settlement.economy.tradeIncome) + gold);
        return gold;
    },

    /** The merchant house behind a trader: one dealing in its main good, else one picked by a hash. */
    _house(world, player, mainGood, key) {
        const rivals = player && player.merchant && Array.isArray(player.merchant.rivals)
            ? player.merchant.rivals.filter(r => r && r.status === 'active') : [];
        const gd = DataLoader._gamedata;
        const defs = rivals.length ? rivals : ((gd && gd.merchantHouses && gd.merchantHouses.rivalHouses) || []);
        if (!defs.length) return { id: null, name: 'Free traders', icon: '⚖️' };
        const pool = defs.filter(d => Array.isArray(d.specialty) && d.specialty.includes(mainGood));
        const list = pool.length ? pool : defs;
        const d = list[_hash(`${_seed(world)}:house:${key}`) % list.length];
        return { id: d.id || null, name: d.name || 'Free traders', icon: d.icon || '⚖️' };
    },

    _spawn(world, link, from, to, cargo, value, route, bases, day, player) {
        const C = MerchantCaravans.config();
        const st = MerchantCaravans.state(world);
        const sea = !!link.sea;
        const D = sea ? C.sea : C.land;
        // Reversed route for the trip b→a
        let path = route;
        if (route[0] !== from.q || route[1] !== from.r) {
            path = [];
            for (let i = route.length - 2; i >= 0; i -= 2) path.push(route[i], route[i + 1]);
        }
        let main = null, mainV = -1;
        for (const [id, q] of Object.entries(cargo)) {
            const v = q * _num(bases && bases[id], 0);
            if (v > mainV) { mainV = v; main = id; }
        }
        const good = _goodDef(main);
        const key = MerchantCaravans.linkKey(from, to);
        const house = MerchantCaravans._house(world, player, main, `${key}:${st.seq}`);
        const tileFrom = world.getTile(from.q, from.r);
        const tileTo = world.getTile(to.q, to.r);
        // What each good is worth at either end (the player's price runs between them)
        const prices = {};
        for (const id of Object.keys(cargo)) {
            const base = _num(bases && bases[id], _goodDef(id).basePrice);
            prices[id] = [
                _round2(SettlementMarket.value(world, from, tileFrom, id, base) || base),
                _round2(SettlementMarket.value(world, to, tileTo, id, base) || base),
            ];
        }
        const guards = Math.min(_num(D.maxGuards, 26), Math.round(_num(D.guards, 4) + value * _num(D.perValue, 0.012)));
        const purse = Math.max(_num(C.purse.min, 25), Math.round(value * _num(C.purse.share, 0.3)));
        const E = C.escort;
        const escortPay = Math.max(_num(E.min, 15), Math.min(_num(E.max, 300), Math.round(value * _num(E.share, 0.07))));
        // Is the way dangerous (an outlaw lair the player knows of near it)?
        let danger = false;
        if (player && player.outlawLairs && Array.isArray(player.outlawLairs.lairs)) {
            const lairs = player.outlawLairs.lairs.filter(lr => lr && lr.status === 'active' && lr.known);
            for (let i = 0; i < path.length && !danger && lairs.length; i += 4) {
                for (const lr of lairs) if (_dist(world, path[i], path[i + 1], lr.q, lr.r) <= 3) { danger = true; break; }
            }
        }
        st.seq++;
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: sea ? 'trade_ship' : 'trade_caravan',
            id: `trade_${st.seq}`,
            name: String(D.name || '{good} Caravan').replace('{good}', good.name),
            icon: D.icon || (sea ? '⛵' : '🐫'),
            carrier: D.carrier || (sea ? 'trader' : 'caravan'),
            q: from.q, r: from.r, sourceQ: from.q, sourceR: from.r, targetQ: to.q, targetR: to.r,
            path: [], route: path, step: 0,
            speed: Math.max(1, Math.round(sea ? _num(D.speed, 6) : (link.road ? _num(D.roadSpeed, 4) : _num(D.speed, 3)))),
            destroyed: false, age: 0, maxAge: 1e9,
            population: Math.round(guards * 1.5) + 3,
            strength: guards,
            cargo, mainGood: main, value: Math.round(value), prices,
            purse,
            inventory: {},
            house,
            kingdomId: from.kingdom != null ? from.kingdom : null,
            destKingdomId: to.kingdom != null ? to.kingdom : null,
            fromName: from.name || 'a town', toName: to.name || 'a town',
            linkKey: key, departed: day, escort: null, escortPay, danger,
            tolls: [], tollsPaid: 0, lastRealm: tileFrom && tileFrom.kingdom != null ? tileFrom.kingdom : null,
            tradeCaravan: true,
        });
        MerchantCaravans._syncInventory(unit);
        world.units.push(unit);
        st.stats.spawned++;
        st.traffic[key] = Math.min(999, _num(st.traffic[key]) + 1);
        return unit;
    },

    /** The unit's inventory (what the map, loot and combat read): whole units of cargo and the purse. */
    _syncInventory(unit) {
        const inv = {};
        for (const [id, q] of Object.entries(unit.cargo || {})) {
            const n = Math.floor(_num(q) + 1e-9);
            if (n > 0) inv[id] = n;
        }
        if (_num(unit.purse) > 0) inv.gold = Math.floor(unit.purse);
        unit.inventory = inv;
    },

    // ──────────── THE DAY ────────────

    /** Today's caravan dice: a seeded stream from the world seed and the day. */
    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:caravans:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day on the roads: traders move along their routes, pay tolls,
     * meet robbers, lairs and enemy wardens, and land their cargo on
     * arrival; escorts are kept or paid; road wardens ride and new ones are
     * sent out. → { notices: [{ icon, title, text, type }] }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function') return out;
        if (!Array.isArray(world.units)) world.units = [];
        const st = MerchantCaravans.state(world);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const main = Utils.getRng();
        Utils.withRng(MerchantCaravans._dayRng(world), () => MerchantCaravans._tick(world, player, st, out, main));
        // Old fears and old news are forgotten
        for (const [k, until] of Object.entries(st.fear)) if (!(until > day)) delete st.fear[k];
        return out;
    },

    _tick(world, player, st, out, mainRng) {
        const day = _day(world);
        const traders = [];
        const patrols = [];
        const hostiles = [];
        for (const u of world.units) {
            if (!u || u.destroyed) continue;
            if (MerchantCaravans.isTrader(u)) traders.push(u);
            else if (u.type === 'road_patrol') patrols.push(u);
            else if (u.type === 'raider' || u.type === 'pirate' || (u.lairId != null && u.type === 'beast')) hostiles.push(u);
        }
        const lairs = player ? OutlawLairs.active(player).filter(l => Number.isFinite(l.q)) : [];
        // Wardens ride first (and may break a band before it strikes)
        for (const p of patrols) MerchantCaravans._patrolDay(world, st, p, hostiles, out, player);
        for (const u of traders) {
            if (u.destroyed) continue;
            MerchantCaravans._travel(world, player, st, u, hostiles, patrols, lairs, out, mainRng);
        }
        MerchantCaravans._sendPatrols(world, st, day);
    },

    /** Realms at war with the trader's own realms (its origin's and its destination's). */
    _enemies(world, u) {
        const set = new Set();
        for (const kid of [u.kingdomId, u.destKingdomId]) {
            const k = _kingdom(world, kid);
            if (k && Array.isArray(k.wars)) for (const e of k.wars) set.add(e);
        }
        return set;
    },

    _patrolStrengthNear(world, patrols, q, r, range) {
        let s = 0;
        for (const p of patrols) {
            if (!p.destroyed && _dist(world, p.q, p.r, q, r) <= range) s += _num(p.strength);
        }
        return s;
    },

    _travel(world, player, st, u, hostiles, patrols, lairs, out, mainRng) {
        const C = MerchantCaravans.config();
        const A = C.ambush;
        const day = _day(world);
        const route = Array.isArray(u.route) ? u.route : [];
        const last = route.length / 2 - 1;
        if (last < 1) { u.destroyed = true; return; }
        const enemies = MerchantCaravans._enemies(world, u);
        const isShip = u.type === 'trade_ship';
        let seizeRolled = false;
        if (!Array.isArray(u.lairsPassed)) u.lairsPassed = [];
        for (let s = 0; s < _num(u.speed, 3) && _num(u.step) < last; s++) {
            u.step = _num(u.step) + 1;
            u.q = route[u.step * 2];
            u.r = route[u.step * 2 + 1];
            const t = world.getTile(u.q, u.r);
            if (u.step >= last) break; // safe inside the gates
            // Tolls at the border
            const realm = t && t.kingdom != null ? t.kingdom : null;
            if (realm != null && realm !== u.lastRealm) {
                MerchantCaravans._toll(world, st, u, realm);
            }
            u.lastRealm = realm;
            // A realm at war seizes it in its own land
            if (realm != null && enemies.has(realm) && !seizeRolled) {
                seizeRolled = true;
                if (Utils.random() < _num(A.warSeize, 0.35)) {
                    MerchantCaravans._taken(world, player, st, u, { kind: 'seized', kingdomId: realm, by: (_kingdom(world, realm) || {}).name || 'the enemy' }, out);
                    return;
                }
            }
            // Robbers within reach
            for (const h of hostiles) {
                if (h.destroyed) continue;
                if (isShip !== (h.type === 'pirate')) continue;
                if (_dist(world, h.q, h.r, u.q, u.r) > _num(A.raiderRange, 1)) continue;
                if (MerchantCaravans._ambush(world, player, st, u, { unit: h, strength: _num(h.strength), by: h.name || 'raiders' }, patrols, out, mainRng)) return;
            }
            // An outlaw lair near the road (each lair tries a trader once)
            if (!isShip) {
                for (const l of lairs) {
                    if (u.lairsPassed.includes(l.id) || l.status !== 'active') continue;
                    if (_dist(world, l.q, l.r, u.q, u.r) > _num(A.lairRange, 2)) continue;
                    u.lairsPassed.push(l.id);
                    if (l.leader && l.leader.slain) continue;
                    let chance = _num(A.lairChance, 0.3) * Math.max(0.3, Math.min(1, _num(l.strength) / 60));
                    if (MerchantCaravans._patrolStrengthNear(world, patrols, u.q, u.r, _num(A.patrolRange, 2)) > 0) chance *= 0.5;
                    if (Utils.random() >= chance) continue;
                    const strength = Math.max(6, Math.round(OutlawLairs.garrison(l) * _num(A.lairShare, 0.35)));
                    if (MerchantCaravans._ambush(world, player, st, u, { lair: l, strength, by: `the outlaws of ${l.name}` }, patrols, out, mainRng)) return;
                }
            }
        }
        MerchantCaravans._escortWatch(world, player, u, out);
        if (_num(u.step) >= last) MerchantCaravans._arrive(world, player, st, u, out);
    },

    _toll(world, st, u, realm) {
        const T = MerchantCaravans.config().tolls;
        if (!Array.isArray(u.tolls)) u.tolls = [];
        if (u.tolls.includes(realm) || realm === u.kingdomId) return 0;
        u.tolls.push(realm);
        const k = _kingdom(world, realm);
        if (!k || k.isAlive === false) return 0;
        const due = Math.max(_num(T.min, 1), Math.round(_num(u.value) * _num(T.rate, 0.03)));
        const paid = Math.min(Math.floor(_num(u.purse)), due);
        if (!(paid > 0)) return 0;
        u.purse = _num(u.purse) - paid;
        u.tollsPaid = _num(u.tollsPaid) + paid;
        k.treasury = _num(k.treasury) + paid;
        st.stats.tolls += paid;
        MerchantCaravans._syncInventory(u);
        return paid;
    },

    /** Is the player riding with this trader today (hired, and within range)? */
    escorting(world, player, u) {
        if (!player || !u || !u.escort || u.escort.by !== 'player') return false;
        if (!Number.isFinite(player.q)) return false;
        return _dist(world, player.q, player.r, u.q, u.r) <= _num(MerchantCaravans.config().escort.range, 2);
    },

    /**
     * Robbers fall on a trader: the player fights them when riding escort
     * (PlayerMilitary, main stream), else the guards and any wardens near.
     * @returns {boolean} the trader was taken
     */
    _ambush(world, player, st, u, att, patrols, out, mainRng) {
        const A = MerchantCaravans.config().ambush;
        if (MerchantCaravans.escorting(world, player, u) && !player.indenturedServitude) {
            const foe = att.unit || {
                type: 'raider', name: att.by, strength: att.strength, population: Math.round(att.strength * 1.5),
                q: u.q, r: u.r, inventory: {}, destroyed: false,
            };
            const result = Utils.withRng(mainRng, () => PlayerMilitary.attackUnit(player, foe, world, { defending: true }));
            if (result && !result.noArmy) {
                if (result.victory) {
                    if (att.lair) att.lair.strength = Math.max(0, _num(att.lair.strength) - att.strength * 0.5);
                    out.notices.push({ icon: '🛡️', title: 'Ambush Beaten Off', text: `${att.by} fell on the ${u.name} you guard. You drove them off${result.loot ? ` and took ${result.loot} gold from the field` : ''}.`, type: 'success' });
                    return false;
                }
                out.notices.push({ icon: '⚔️', title: 'Ambush!', text: `${att.by} beat you and your men on the road and fell on the ${u.name}.`, type: 'error' });
                MerchantCaravans._taken(world, player, st, u, { kind: 'taken', unit: att.unit, lair: att.lair, by: att.by }, out);
                return true;
            }
        }
        const help = MerchantCaravans._patrolStrengthNear(world, patrols, u.q, u.r, _num(A.patrolRange, 2));
        const def = _num(u.strength) + help;
        const taken = Utils.random() < att.strength / Math.max(1, att.strength + def);
        if (!taken) {
            // A band beaten soundly by guards and wardens breaks
            if (att.unit && !att.unit.sagaKey && def > att.strength * 1.2 && help > 0) {
                att.unit.destroyed = true;
                st.stats.raidersBroken++;
                if (Array.isArray(world.events)) world.events.push({ text: `Road wardens broke ${att.by} on the road to ${u.toName}.`, type: 'military' });
            }
            u.strength = Math.max(1, Math.round(_num(u.strength) * 0.85)); // guards fall even in victory
            return false;
        }
        MerchantCaravans._taken(world, player, st, u, { kind: 'taken', unit: att.unit, lair: att.lair, by: att.by }, out);
        return true;
    },

    /**
     * A trader lost on the road: the cargo goes to its takers (a raider's
     * packs, a lair's hoard, a warring realm's nearest market and treasury),
     * the town that waited for it goes without, merchants shun the road.
     */
    _taken(world, player, st, u, how, out) {
        const C = MerchantCaravans.config();
        const day = _day(world);
        const cargo = u.cargo || {};
        if (how.unit) {
            const inv = how.unit.inventory || (how.unit.inventory = {});
            for (const [id, q] of Object.entries(cargo)) {
                const n = Math.floor(_num(q));
                if (n > 0) inv[id] = _num(inv[id]) + n;
            }
            if (_num(u.purse) > 0) inv.gold = _num(inv.gold) + Math.floor(u.purse);
        } else if (how.lair) {
            const hoard = how.lair.hoard || (how.lair.hoard = { gold: 0, goods: {} });
            if (!hoard.goods) hoard.goods = {};
            for (const [id, q] of Object.entries(cargo)) {
                const n = Math.floor(_num(q));
                if (n > 0) hoard.goods[id] = _num(hoard.goods[id]) + n;
            }
            hoard.gold = Math.round(_num(hoard.gold) + _num(u.purse));
        } else if (how.kind === 'seized') {
            const k = _kingdom(world, how.kingdomId);
            if (k) k.treasury = _num(k.treasury) + Math.floor(_num(u.purse));
            // The goods are sold off in the realm's nearest market
            let best = null, bd = Infinity;
            for (const s of _settlements(world)) {
                if (!s || s.kingdom !== how.kingdomId) continue;
                const d = _dist(world, s.q, s.r, u.q, u.r);
                if (d < bd) { bd = d; best = s; }
            }
            const t = best ? world.getTile(best.q, best.r) : null;
            if (t && t.settlement) {
                for (const [id, q] of Object.entries(cargo)) SettlementMarket.add(t.settlement, id, q);
                // The trade's margin goes to the seizer's market, not the towns it was meant for
                st.stats.marginSeized = _round2(_num(st.stats.marginSeized) + MerchantCaravans._credit(t.settlement, _num(u.margin)));
                u.margin = 0;
            }
        }
        // Robbers bank no trade income: the margin is lost with the cargo
        if (_num(u.margin) > 0) st.stats.marginLost = _round2(_num(st.stats.marginLost) + _num(u.margin));
        u.margin = 0;
        u.cargo = {};
        u.purse = 0;
        u.inventory = {};
        u.destroyed = true;
        if (how.kind === 'seized') st.stats.seized++;
        else st.stats.taken++;
        st.fear[u.linkKey] = day + _num(C.fear.days, 12);
        // The town that waited for it notices
        const dt = world.getTile(u.targetQ, u.targetR);
        if (dt && dt.settlement && dt.settlement.market && dt.settlement.market.trade) {
            dt.settlement.market.trade.cut = _num(dt.settlement.market.trade.cut) + 1;
        }
        const goodName = _goodDef(u.mainGood).name.toLowerCase();
        const text = `The ${goodName} ${u.carrier || 'caravan'} of ${(u.house && u.house.name) || 'free traders'} bound for ${u.toName} was ${how.kind === 'seized' ? 'seized' : 'taken'} by ${how.by}.`;
        if (Array.isArray(world.events)) world.events.push({ text, type: 'economic' });
        MerchantCaravans._record(world, st, u, how.kind === 'seized' ? 'seized' : 'taken', how.by, false);
        const escorted = !!(u.escort && u.escort.by === 'player');
        const near = player && Number.isFinite(player.q) && _dist(world, player.q, player.r, u.q, u.r) <= 6;
        if (escorted) out.notices.push({ icon: '💔', title: 'Escort Failed', text: `${text} There will be no pay.`, type: 'error' });
        else if (near) out.notices.push({ icon: u.icon || '🐫', title: 'Caravan Lost', text, type: 'warning' });
    },

    /** A loss worth the heralds' cry, kept for them (systems/heralds.js reads world.merchantTrade.history). */
    _record(world, st, u, kind, by, own) {
        const C = MerchantCaravans.config();
        if (_num(u.value) < _num(C.notableValue, 150)) return;
        st.history.push({
            key: `caravan:${u.id}:${kind}`, kind, day: _day(world),
            good: _goodDef(u.mainGood).name.toLowerCase(), carrier: u.carrier || 'caravan',
            house: (u.house && u.house.name) || 'free traders', from: u.fromName, to: u.toName, by,
            q: u.q, r: u.r, kingdomId: u.destKingdomId != null ? u.destKingdomId : u.kingdomId, own: !!own,
        });
        if (st.history.length > _num(C.historyCap, 30)) st.history = st.history.slice(-_num(C.historyCap, 30));
    },

    /** Has the player kept with the trader they guard? Too far for too long and the merchant gives up on them. */
    _escortWatch(world, player, u, out) {
        if (!u.escort || u.escort.by !== 'player' || u.destroyed) return;
        const E = MerchantCaravans.config().escort;
        const near = player && Number.isFinite(player.q) && _dist(world, player.q, player.r, u.q, u.r) <= _num(E.leash, 6);
        u.escort.away = near ? 0 : _num(u.escort.away) + 1;
        if (u.escort.away > _num(E.graceDays, 2)) {
            u.escort = null;
            out.notices.push({ icon: '🐫', title: 'Escort Dismissed', text: `The master of the ${u.name} gave up waiting for you and hired other blades.`, type: 'warning' });
        }
    },

    /** Home: the cargo lands in the destination market; an escort is paid. */
    _arrive(world, player, st, u, out) {
        const t = world.getTile(u.targetQ, u.targetR);
        const s = t && t.settlement;
        if (s) {
            for (const [id, q] of Object.entries(u.cargo || {})) SettlementMarket.add(s, id, q);
            st.stats.delivered++;
            // The trade's margin is earned on arrival, half to either town
            const m = Math.max(0, _num(u.margin));
            if (m > 0) {
                const ft = world.getTile(u.sourceQ, u.sourceR);
                const from = ft && ft.settlement;
                MerchantCaravans._credit(s, from ? m / 2 : m);
                if (from) MerchantCaravans._credit(from, m / 2);
                st.stats.marginPaid = _round2(_num(st.stats.marginPaid) + m);
            }
        }
        u.margin = 0;
        if (u.escort && u.escort.by === 'player' && player) {
            const E = MerchantCaravans.config().escort;
            const pay = Math.round(_num(u.escort.pay, u.escortPay));
            player.gold = _num(player.gold) + pay;
            player.renown = _num(player.renown) + _num(E.renown, 1);
            const kid = u.destKingdomId != null ? u.destKingdomId : u.kingdomId;
            if (kid != null) {
                if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
                player.reputation[kid] = _num(player.reputation[kid]) + _num(E.reputation, 3);
            }
            st.stats.escorts++;
            st.stats.escortPay += pay;
            out.notices.push({ icon: '💰', title: 'Escort Paid', text: `The ${u.name} reached ${u.toName} safe. ${(u.house && u.house.name) || 'The merchants'} paid you ${pay} gold.`, type: 'success' });
        }
        u.cargo = {};
        u.inventory = {};
        u.arrived = true;
        u.destroyed = true;
    },

    // ──────────── ROAD WARDENS ────────────

    /** A patrol rides its road up and down, breaking raider bands it meets; home when its time is up. */
    _patrolDay(world, st, p, hostiles, out, player) {
        const day = _day(world);
        const route = Array.isArray(p.route) ? p.route : [];
        const last = route.length / 2 - 1;
        const k = _kingdom(world, p.kingdom);
        if (last < 1 || day >= _num(p.untilDay) || !k || k.isAlive === false) { p.destroyed = true; return; }
        if (!(p.dir === 1 || p.dir === -1)) p.dir = 1;
        const P = MerchantCaravans.config().patrols;
        // A band close by is ridden down; otherwise the road
        for (let s = 0; s < _num(p.speed, 4); s++) {
            let target = null;
            for (const h of hostiles) {
                if (h.destroyed || h.type === 'pirate') continue;
                if (_dist(world, h.q, h.r, p.q, p.r) <= 1) { target = h; break; }
            }
            if (target) {
                if (target.sagaKey) break;
                if (_num(p.strength) >= _num(target.strength) * 0.8) {
                    target.destroyed = true;
                    st.stats.raidersBroken++;
                    if (Array.isArray(world.events)) world.events.push({ text: `${p.name} broke ${target.name}.`, type: 'military' });
                    if (player && Number.isFinite(player.q) && _dist(world, player.q, player.r, p.q, p.r) <= 5) {
                        out.notices.push({ icon: '💂', title: 'Road Wardens', text: `${p.name} rode down ${target.name}.`, type: 'info' });
                    }
                } else {
                    p.strength = Math.max(1, Math.round(_num(p.strength) * 0.7));
                }
                break;
            }
            let near = null;
            for (const h of hostiles) {
                if (h.destroyed || h.type === 'pirate' || h.sagaKey) continue;
                const d = _dist(world, h.q, h.r, p.q, p.r);
                if (d <= _num(P.huntRange, 3) && (!near || d < near.d)) near = { h, d };
            }
            if (near && MerchantCaravans._stepToward(world, p, near.h.q, near.h.r)) continue;
            // Back onto the road where it left it, then along it
            const at = route[p.step * 2] === p.q && route[p.step * 2 + 1] === p.r;
            if (!at) {
                if (!MerchantCaravans._stepToward(world, p, route[p.step * 2], route[p.step * 2 + 1])) {
                    p.q = route[p.step * 2];
                    p.r = route[p.step * 2 + 1];
                }
                continue;
            }
            let next = p.step + p.dir;
            if (next < 0 || next > last) { p.dir = -p.dir; next = p.step + p.dir; }
            p.step = Math.max(0, Math.min(last, next));
            p.q = route[p.step * 2];
            p.r = route[p.step * 2 + 1];
        }
    },

    /** One passable hex toward (q, r); false when none is nearer. */
    _stepToward(world, u, q, r) {
        let best = null, bd = _dist(world, u.q, u.r, q, r);
        for (const nb of Hex.neighbors(u.q, u.r)) {
            const nq = Hex.wrapQ(nb.q, world.width);
            const t = world.getTile(nq, nb.r);
            if (!t || !t.terrain || !t.terrain.passable) continue;
            const d = _dist(world, nq, nb.r, q, r);
            if (d < bd) { bd = d; best = { q: nq, r: nb.r }; }
        }
        if (!best) return false;
        u.q = best.q;
        u.r = best.r;
        return true;
    },

    /**
     * Every `every` days each realm with a full treasury or a lawful lord may
     * send wardens down its busiest road (the most caravans, kingdom trade
     * routes, a road the whole way), paying their upkeep from the treasury.
     */
    _sendPatrols(world, st, day) {
        const P = MerchantCaravans.config().patrols;
        const every = Math.max(1, Math.floor(_num(P.every, 10)));
        if (day % every !== 0) return;
        const out = world.units.filter(u => u && !u.destroyed && u.type === 'road_patrol');
        let count = out.length;
        if (count >= _num(P.max, 6)) return;
        const views = _settlements(world);
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || count >= _num(P.max, 6)) continue;
            if (out.some(u => u.kingdom === k.id)) continue;
            const lawful = OutlawLairs._lawful(k);
            const rich = _num(k.treasury) >= _num(P.minTreasury, 2500);
            if (!rich && !(lawful > 0)) continue;
            if (_num(k.treasury) < _num(P.cost, 80)) continue;
            const chance = (rich ? _num(P.chance, 0.35) : 0) + lawful * _num(P.lawfulBonus, 0.5);
            if (Utils.random() >= chance) continue;
            // Its busiest road between two of its own towns
            let best = null;
            for (const s of views) {
                if (!s || s.kingdom !== k.id) continue;
                const t = world.getTile(s.q, s.r);
                const live = t && t.settlement;
                const links = live && live.market && Array.isArray(live.market.links) ? live.market.links : [];
                for (const [q, r, d, sea, road, routes] of links) {
                    if (sea) continue;
                    const bt = world.getTile(q, r);
                    if (!bt || !bt.settlement || bt.settlement.kingdom !== k.id) continue;
                    const key = MerchantCaravans.linkKey({ q: s.q, r: s.r }, { q, r });
                    const score = _num(st.traffic[key]) * 2 + _num(routes) * 1.5 + (road ? 1 : 0) + _num(d) * 0.01;
                    if (!best || score > best.score || (score === best.score && key < best.key)) {
                        best = { score, key, a: { q: s.q, r: s.r }, b: { q, r }, name: live.name };
                    }
                }
            }
            if (!best || best.score <= 0) continue;
            const route = MerchantCaravans.route(world, best.a, best.b, false);
            if (!route || route.length < 4) continue;
            const [lo, hi] = Array.isArray(P.strength) ? P.strength : [16, 30];
            const strength = Utils.randInt(_num(lo, 16), _num(hi, lo));
            k.treasury = _num(k.treasury) - _num(P.cost, 80);
            st.seq++;
            const unit = Object.assign(Object.create(WorldUnit.prototype), {
                type: 'road_patrol', id: `wardens_${st.seq}`,
                name: String(P.name || '{kingdom} Road Wardens').replace('{kingdom}', k.name || 'Royal'),
                icon: P.icon || '💂', q: best.a.q, r: best.a.r, sourceQ: best.a.q, sourceR: best.a.r,
                targetQ: best.b.q, targetR: best.b.r, path: [], route, step: 0, dir: 1,
                speed: Math.max(1, Math.round(_num(P.speed, 4))), strength, population: Math.round(strength * 1.5),
                inventory: {}, kingdom: k.id, kingdomId: k.id, untilDay: day + _num(P.days, 30),
                destroyed: false, age: 0, maxAge: 1e9, linkKey: best.key,
            });
            world.units.push(unit);
            out.push(unit);
            count++;
            st.stats.patrols++;
        }
    },

    // ──────────── THE PLAYER ON THE ROAD ────────────

    find(world, unitId) {
        return ((world && world.units) || []).find(u => u && u.id === unitId && !u.destroyed && MerchantCaravans.isTrader(u)) || null;
    },

    /** Traders the player can meet (same or next hex). */
    meetable(player, world) {
        if (!player || !Number.isFinite(player.q)) return [];
        return MerchantCaravans.traders(world).filter(u => _dist(world, player.q, player.r, u.q, u.r) <= 1);
    },

    _within(player, world, u) {
        return !!(player && u && Number.isFinite(player.q) && _dist(world, player.q, player.r, u.q, u.r) <= 1);
    },

    /** How far along its road the trader is (0 at the origin, 1 at the destination). */
    progress(u) {
        const last = Array.isArray(u && u.route) ? u.route.length / 2 - 1 : 0;
        return last > 0 ? Math.max(0, Math.min(1, _num(u.step) / last)) : 0;
    },

    /** What a unit of the good is worth on this trader today: the origin's value toward the destination's. */
    cargoPrice(u, goodId) {
        const p = u && u.prices && u.prices[goodId];
        if (!Array.isArray(p)) return _goodDef(goodId).basePrice;
        return p[0] + (p[1] - p[0]) * MerchantCaravans.progress(u);
    },

    /** The trader's offer, good by good: [{ id, name, icon, qty, buy, sell }]. */
    offers(u) {
        const T = MerchantCaravans.config().trade;
        const out = [];
        for (const [id, q] of Object.entries((u && u.cargo) || {})) {
            const g = _goodDef(id);
            const price = MerchantCaravans.cargoPrice(u, id);
            out.push({
                id, name: g.name, icon: g.icon, qty: Math.floor(_num(q) + 1e-9),
                buy: Math.max(1, Math.ceil(price * (1 + _num(T.markup, 0.1)))),
                sell: Math.max(1, Math.floor(price * (1 - _num(T.markdown, 0.12)))),
            });
        }
        return out.sort((a, b) => a.id < b.id ? -1 : 1);
    },

    /** Buy from the trader's cargo (what is bought never reaches its market). */
    buy(player, world, unitId, goodId, qty = 1) {
        const u = MerchantCaravans.find(world, unitId);
        if (!u || !MerchantCaravans._within(player, world, u)) return { success: false, reason: 'The trader is no longer here.' };
        const n = Math.floor(_num(qty));
        const offer = MerchantCaravans.offers(u).find(o => o.id === goodId);
        if (!offer || !(n > 0) || offer.qty < n) return { success: false, reason: 'They do not carry that many.' };
        const cost = offer.buy * n;
        if (_num(player.gold) < cost) return { success: false, reason: `You need ${cost} gold.` };
        const add = PlayerInventory.addItem(player, goodId, n);
        if (!add || !add.success) return { success: false, reason: PlayerInventory.fullMessage(player) };
        player.gold = _num(player.gold) - cost;
        u.cargo[goodId] = _round2(_num(u.cargo[goodId]) - n);
        if (!(u.cargo[goodId] > 0.004)) delete u.cargo[goodId];
        u.purse = _num(u.purse) + cost;
        MerchantCaravans._syncInventory(u);
        return { success: true, cost, qty: n };
    },

    /** Sell the trader goods it deals in (they ride on to its market); not stolen goods. */
    sell(player, world, unitId, goodId, qty = 1) {
        const u = MerchantCaravans.find(world, unitId);
        if (!u || !MerchantCaravans._within(player, world, u)) return { success: false, reason: 'The trader is no longer here.' };
        const n = Math.floor(_num(qty));
        const offer = MerchantCaravans.offers(u).find(o => o.id === goodId);
        if (!offer) return { success: false, reason: 'They do not deal in that.' };
        const held = _num(player.inventory && player.inventory[goodId]);
        const hot = Underworld.hotQty(player, goodId, _day(world));
        if (!(n > 0) || held - hot < n) return { success: false, reason: hot > 0 ? 'They will not touch stolen goods.' : 'You do not have that many.' };
        const pay = offer.sell * n;
        if (_num(u.purse) < pay) return { success: false, reason: 'The merchant cannot pay that much.' };
        player.inventory[goodId] = held - n;
        if (player.inventory[goodId] <= 0) delete player.inventory[goodId];
        player.gold = _num(player.gold) + pay;
        u.purse = _num(u.purse) - pay;
        u.cargo[goodId] = _round2(_num(u.cargo[goodId]) + n);
        MerchantCaravans._syncInventory(u);
        return { success: true, pay, qty: n };
    },

    /** Can the player hire on to guard this trader? */
    canEscort(player, world, u) {
        if (!u || u.destroyed) return { ok: false, reason: 'The trader is gone.' };
        if (!MerchantCaravans._within(player, world, u)) return { ok: false, reason: 'Ride up to the trader first.' };
        if (u.escort) return { ok: false, reason: u.escort.by === 'player' ? 'You already ride with them.' : 'They have their escort.' };
        if (u.type === 'trade_ship' && !player.boardedShip) return { ok: false, reason: 'A ship takes on guards in port, or from your own deck.' };
        if (MerchantCaravans.traders(world).some(x => x.escort && x.escort.by === 'player')) return { ok: false, reason: 'You are already guarding another trader.' };
        const k = u.kingdomId;
        if (k != null && player.gossip && player.gossip.warrants && player.gossip.warrants[k]) return { ok: false, reason: 'No merchant of this realm will hire a wanted man.' };
        return { ok: true, pay: _num(u.escortPay) };
    },

    /** Hire on as escort: paid on arrival if you stay with them. */
    hireEscort(player, world, unitId) {
        const u = MerchantCaravans.find(world, unitId);
        const can = MerchantCaravans.canEscort(player, world, u);
        if (!can.ok) return { success: false, reason: can.reason };
        u.escort = { by: 'player', pay: _num(u.escortPay), hiredDay: _day(world), away: 0 };
        return { success: true, pay: u.escort.pay, to: u.toName };
    },

    /** Leave the trader's service (no pay). */
    quitEscort(player, world, unitId) {
        const u = MerchantCaravans.find(world, unitId);
        if (!u || !u.escort || u.escort.by !== 'player') return { success: false };
        u.escort = null;
        return { success: true };
    },

    /** The trader the player is hired to guard, or null. */
    escortJob(world) {
        return MerchantCaravans.traders(world).find(u => u.escort && u.escort.by === 'player') || null;
    },

    /** Were there witnesses to a robbery here (wardens near, a town in sight)? */
    _witnessed(world, u) {
        const R = MerchantCaravans.config().robbery;
        const range = _num(R.witnessRange, 4);
        for (const p of world.units || []) {
            if (!p || p.destroyed || (p.type !== 'road_patrol' && p.type !== 'patrol')) continue;
            if (_dist(world, p.q, p.r, u.q, u.r) <= range) return true;
        }
        for (const s of _settlements(world)) {
            if (s && _dist(world, s.q, s.r, u.q, u.r) <= 1) return true;
        }
        return false;
    },

    /**
     * The player robbed a trader (PlayerMilitary.attackUnit's victory over
     * one): the loot is hot (only fences take it), heat with its realm (a
     * witnessed robbery is a reported crime → Gossip bounty), reputation
     * lost, the road shunned, and the town that waited goes without.
     */
    onRobbed(player, world, u, loot = {}) {
        if (!player || !u) return null;
        const C = MerchantCaravans.config();
        const st = MerchantCaravans.state(world);
        const day = _day(world);
        for (const [id, qty] of Object.entries(loot || {})) {
            if (id === 'gold' || !(qty > 0)) continue;
            Underworld.markHot(player, id, qty, day);
        }
        const kid = u.kingdomId != null ? u.kingdomId : (u.destKingdomId != null ? u.destKingdomId : Underworld._nearestKingdom(world, u.q, u.r));
        const caught = MerchantCaravans._witnessed(world, u);
        Underworld.recordCrime(player, world, 'caravan_robbery', {
            kingdom: kid, caught, q: u.q, r: u.r,
            victim: { name: (u.house && u.house.name) || 'the merchants', type: 'merchant', icon: u.icon || '🐫' },
        });
        if (kid != null) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            player.reputation[kid] = _num(player.reputation[kid]) - _num(C.robbery.reputation, 15);
        }
        if (C.robbery.fear !== false) st.fear[u.linkKey] = day + _num(C.fear.days, 12);
        st.stats.robbed++;
        // The trade's margin is lost with the cargo: neither town earns it
        if (_num(u.margin) > 0) st.stats.marginLost = _round2(_num(st.stats.marginLost) + _num(u.margin));
        u.margin = 0;
        u.cargo = {};
        u.purse = 0;
        const dt = world.getTile(u.targetQ, u.targetR);
        if (dt && dt.settlement && dt.settlement.market && dt.settlement.market.trade) {
            dt.settlement.market.trade.cut = _num(dt.settlement.market.trade.cut) + 1;
        }
        MerchantCaravans._record(world, st, u, 'robbed', player.name || 'a stranger', true);
        return { kingdomId: kid, caught };
    },

    /** A robbery that failed: the guards saw a face. */
    onRobberyFailed(player, world, u) {
        if (!player || !u) return null;
        const kid = u.kingdomId != null ? u.kingdomId : Underworld._nearestKingdom(world, u.q, u.r);
        Underworld.recordCrime(player, world, 'caravan_robbery', { kingdom: kid, scale: 0.5 });
        if (kid != null) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            player.reputation[kid] = _num(player.reputation[kid]) - Math.round(_num(MerchantCaravans.config().robbery.reputation, 15) / 2);
        }
        if (u.escort && u.escort.by === 'player') u.escort = null;
        return { kingdomId: kid };
    },

    /** One line about a trader, for the map's hex info. */
    describe(u) {
        if (!u) return '';
        const goods = Object.entries(u.cargo || {}).map(([id, q]) => `${Math.floor(q)} ${_goodDef(id).name.toLowerCase()}`).join(', ');
        return `${(u.house && u.house.name) || 'Free traders'} · ${u.fromName} → ${u.toName} · ${goods || 'empty'}`;
    },
};
