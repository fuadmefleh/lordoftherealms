// ============================================
// RIVER BOATS — a punt or a barge of your own on the rivers
// ============================================
// Bought from the boatwrights of a town that stands on a river (the price
// goes into the town's purse; sold back out of it). Aboard, the player
// travels the world map along the rivers only: river hexes, and the lakes
// they run into. Going with the current (tile.riverDir, or a painted river's
// outflow: systems/riverDrift.js downstream) is quick, against it slow; a
// flood (systems/riverLife.js) makes the one quicker and the other harder.
// Passing a town on the river the boat pays its mill weir and its bridge
// (to the town's purse; in kind from the hold when the purse is empty).
// The boat has a hold of its own (boat.hold units of any goods) to load from
// the packs and unload into them.
//
// State on the player (saved: SaveLoad EXTRA_PLAYER_FIELDS 'riverBoat'):
//   player.riverBoat = { kind, name, aboard, q, r (where it lies moored
//     or where it is, aboard), cargo: { good: qty }, tolls (paid in all),
//     fishLots: [{ d, n }] (its raw fish by the day caught: riverLife.js) }
// The movement hooks live in player/core/movement.js (_onRiverBoat).
// Settings: data/riverLife.json (boats, tolls, flood). No randomness.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { RiverDrift } from './riverDrift.js';
import { Ledger } from './ledger.js';
import { RiverLife } from './riverLife.js';

const DEFAULTS = {
    enabled: true,
    boats: {
        punt: { name: 'Punt', icon: '🛶', price: 60, hold: 25, hexDays: 0.5, down: 0.55, up: 2.2, sellBack: 0.5 },
    },
    flood: { down: 0.75, up: 1.6 },
    tolls: { weir: 2, bridge: 1, perHold: 1 },
    townRank: { hamlet: 0, village: 1, town: 2, city: 3, capital: 4 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const RiverBoats = {
    _cfgSrc: null,
    _cfg: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.riverLife;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const c = { ...DEFAULTS, ...(src || {}) };
            c.boats = { ...((src && src.boats) || DEFAULTS.boats) };
            c.flood = { ...DEFAULTS.flood, ...((src && src.flood) || {}) };
            c.tolls = { ...DEFAULTS.tolls, ...((src && src.tolls) || {}) };
            c.townRank = { ...DEFAULTS.townRank, ...((src && src.townRank) || {}) };
            this._cfg = c;
        }
        return this._cfg;
    },

    kind(id) {
        const b = this.config().boats[id];
        return b ? { id, ...b } : null;
    },

    kinds() {
        return Object.keys(this.config().boats).map(id => this.kind(id));
    },

    boat(player) {
        const b = player && player.riverBoat;
        return b && typeof b === 'object' && b.kind ? b : null;
    },

    aboard(player) {
        const b = this.boat(player);
        return !!(b && b.aboard && !(player && player.boardedShip));
    },

    holdOf(boat) {
        const k = boat ? this.kind(boat.kind) : null;
        return k ? Math.max(0, _num(k.hold)) : 0;
    },

    cargoCount(boat) {
        if (!boat || !boat.cargo) return 0;
        let n = 0;
        for (const v of Object.values(boat.cargo)) if (v > 0) n += v;
        return n;
    },

    holdFree(boat) {
        return Math.max(0, this.holdOf(boat) - this.cargoCount(boat));
    },

    _tile(world, q, r) {
        return RiverDrift._tile(world, q, r);
    },

    /** Can a boat be on this hex? A river hex, or a lake. */
    navigable(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t) return false;
        if (t.terrain && t.terrain.id === 'lake') return true;
        if (RiverDrift.isRiverHex(t)) return true;
        return this._lakeLanding(world, q, r, t);
    },

    /** A town on a lake shore: boats put in and out there */
    _lakeLanding(world, q, r, t = null) {
        const tile = t || this._tile(world, q, r);
        return !!(tile && tile.settlement && Hex.neighbors(q, r).some(n => this._isLake(world, n.q, n.r)));
    },

    _isLake(world, q, r) {
        const t = this._tile(world, q, r);
        return !!(t && t.terrain && t.terrain.id === 'lake');
    },

    /**
     * How the water runs from hex (fq, fr) to the next hex (tq, tr):
     * 'down' (with the current), 'up' (against it), 'still' (across a lake),
     * or null (no water joins them).
     */
    link(world, fq, fr, tq, tr) {
        if (!this.navigable(world, fq, fr) || !this.navigable(world, tq, tr)) return null;
        const W = world && world.width > 0 ? world.width : 0;
        const same = (a, b, c, d) => b === d && (W ? Hex.wrapQ(a, W) === Hex.wrapQ(c, W) : a === c);
        const lakeF = this._isLake(world, fq, fr), lakeT = this._isLake(world, tq, tr);
        if (lakeF && lakeT) return 'still';
        // (in and out of a lakeside town's landing)
        if ((lakeF && this._lakeLanding(world, tq, tr)) || (lakeT && this._lakeLanding(world, fq, fr))) return 'still';
        if (!lakeF) {
            const d = RiverDrift.downstream(world, fq, fr);
            if ((d.kind === 'river' || d.kind === 'lake') && same(d.q, d.r, tq, tr)) return 'down';
        }
        if (!lakeT) {
            const d = RiverDrift.downstream(world, tq, tr);
            if ((d.kind === 'river' || d.kind === 'lake') && same(d.q, d.r, fq, fr)) return 'up';
        }
        return null;
    },

    /** Days to take the boat one hex at slack water */
    hexDays(player) {
        const b = this.boat(player);
        const k = b ? this.kind(b.kind) : null;
        return k ? Math.max(0.05, _num(k.hexDays, 0.5)) : 1;
    },

    /**
     * The factor on hexDays for the leg (fq, fr) → (tq, tr): down < 1 < up,
     * worse upstream and quicker downstream in a flood; Infinity where no
     * water joins them.
     */
    legFactor(world, player, fq, fr, tq, tr) {
        const how = this.link(world, fq, fr, tq, tr);
        if (!how) return Infinity;
        if (how === 'still') return 1;
        const b = this.boat(player);
        const k = (b && this.kind(b.kind)) || {};
        const cfg = this.config();
        const sev = Math.max(RiverLife.floodAt(world, fq, fr), RiverLife.floodAt(world, tq, tr));
        if (how === 'down') return _num(k.down, 0.55) * (sev > 0 ? 1 - (1 - _num(cfg.flood.down, 0.75)) * sev : 1);
        return _num(k.up, 2.2) * (sev > 0 ? 1 + (_num(cfg.flood.up, 1.6) - 1) * sev : 1);
    },

    /** A river town's boatwrights: a settlement standing on a river hex (or by a lake) */
    canBuyAt(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.settlement) return false;
        if (RiverDrift.isRiverHex(t)) return true;
        return Hex.neighbors(q, r).some(n => this._isLake(world, n.q, n.r));
    },

    _rank(type) {
        return _num(this.config().townRank[type], 1);
    },

    /** The boats on offer here: [{ id, name, price, hold, ok, reason }] */
    offers(world, player, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.settlement || !this.canBuyAt(world, q, r)) return [];
        const rank = this._rank(t.settlement.type);
        return this.kinds().map(k => {
            let reason = null;
            if (k.minTown && rank < this._rank(k.minTown)) reason = `Only a ${k.minTown} or larger builds a ${k.name.toLowerCase()}.`;
            else if (_num(player && player.gold) < k.price) reason = `You need ${k.price}g.`;
            return { ...k, ok: !reason, reason };
        });
    },

    _purse(settlement) {
        if (!settlement) return null;
        if (!settlement.economy || typeof settlement.economy !== 'object') settlement.economy = {};
        if (!Number.isFinite(settlement.economy.gold)) settlement.economy.gold = 0;
        return settlement.economy;
    },

    /** Buy a boat here. One boat at a time: an old one is sold back first. → { ok, reason?, boat? } */
    buy(world, player, q, r, kindId) {
        if (!this.config().enabled) return { ok: false, reason: 'No boats are built here.' };
        const offer = this.offers(world, player, q, r).find(o => o.id === kindId);
        if (!offer) return { ok: false, reason: 'No such boat is built here.' };
        const old = this.boat(player);
        if (old && old.aboard) return { ok: false, reason: 'Go ashore before you trade your boat.' };
        if (old && this.cargoCount(old) > 0) return { ok: false, reason: 'Your old boat still has cargo in its hold.' };
        if (old && (old.q !== q || old.r !== r)) return { ok: false, reason: 'Your old boat is moored elsewhere: sell it there, or bring it here to trade it in.' };
        if (offer.reason && !offer.reason.startsWith('You need')) return { ok: false, reason: offer.reason };
        // (the old boat is taken in part-payment, at what the boatwright would pay for it)
        const credit = old ? Math.min(this.saleValue(world, player, q, r), offer.price) : 0;
        const net = offer.price - credit;
        if (_num(player.gold) < net) return { ok: false, reason: `You need ${net}g${credit ? ` with your old boat traded in` : ''}.` };
        const t = this._tile(world, q, r);
        const purse = this._purse(t.settlement);
        if (credit > 0) purse.gold -= credit;
        purse.gold += offer.price;
        player.gold = _num(player.gold) - net;
        Ledger.record(player, 'riverBoats', -net);
        player.riverBoat = { kind: offer.id, name: offer.name, aboard: false, q, r, cargo: {}, tolls: 0, fishLots: [], bought: _num(world && world.day) };
        return { ok: true, boat: player.riverBoat, traded: credit };
    },

    /** What a town's boatwright here pays for your boat (out of the town's purse) */
    saleValue(world, player, q, r) {
        const b = this.boat(player);
        const t = this._tile(world, q, r);
        if (!b || !t || !t.settlement || b.q !== q || b.r !== r) return 0;
        const k = this.kind(b.kind);
        const want = Math.round(_num(k && k.price) * _num(k && k.sellBack, 0.5));
        const purse = t.settlement.economy;
        return Math.max(0, Math.min(want, Math.floor(_num(purse && purse.gold))));
    },

    sell(world, player, q, r) {
        const b = this.boat(player);
        if (!b) return { ok: false, reason: 'You have no boat.' };
        if (b.aboard) return { ok: false, reason: 'Go ashore first.' };
        if (b.q !== q || b.r !== r) return { ok: false, reason: 'Your boat is not moored here.' };
        if (this.cargoCount(b) > 0) return { ok: false, reason: 'Unload the hold first.' };
        const t = this._tile(world, q, r);
        if (!t || !t.settlement) return { ok: false, reason: 'There is no boatwright here.' };
        const pay = this.saleValue(world, player, q, r);
        if (!(pay > 0)) return { ok: false, reason: 'The town has no coin to buy it.' };
        t.settlement.economy.gold -= pay;
        player.gold = _num(player.gold) + pay;
        Ledger.record(player, 'riverBoats', pay);
        player.riverBoat = null;
        return { ok: true, gold: pay };
    },

    /** Step aboard the boat moored where you stand */
    board(world, player) {
        const b = this.boat(player);
        if (!b) return { ok: false, reason: 'You have no boat.' };
        if (b.aboard) return { ok: false, reason: 'You are aboard already.' };
        if (player.boardedShip) return { ok: false, reason: 'You are aboard a ship.' };
        if (b.q !== player.q || b.r !== player.r) return { ok: false, reason: 'Your boat is not moored here.' };
        if (player.isMoving) return { ok: false, reason: 'Stop first.' };
        b.aboard = true;
        if (typeof player.cancelTravel === 'function') player.cancelTravel();
        return { ok: true };
    },

    /** Go ashore: the boat is moored where it lies */
    ashore(world, player) {
        const b = this.boat(player);
        if (!b || !b.aboard) return { ok: false, reason: 'You are not aboard your boat.' };
        const t = this._tile(world, player.q, player.r);
        if (!t || !t.terrain || !t.terrain.passable) return { ok: false, reason: 'There is no ground to step onto here.' };
        b.aboard = false;
        b.q = player.q; b.r = player.r;
        if (typeof player.cancelTravel === 'function') player.cancelTravel();
        return { ok: true };
    },

    /** Goods from the packs into the hold (qty capped by the room) */
    load(player, good, qty) {
        const b = this.boat(player);
        if (!b) return { ok: false, reason: 'You have no boat.' };
        if (!(b.aboard || (b.q === player.q && b.r === player.r))) return { ok: false, reason: 'Your boat is not here.' };
        const inv = player.inventory || {};
        const want = qty === Infinity || qty == null ? Infinity : Math.floor(_num(qty));
        const n = Math.min(want, Math.floor(_num(inv[good])), this.holdFree(b));
        if (!(n > 0)) return { ok: false, reason: this.holdFree(b) ? 'You have none to load.' : 'The hold is full.' };
        inv[good] -= n;
        if (inv[good] <= 0) delete inv[good];
        b.cargo[good] = (b.cargo[good] || 0) + n;
        return { ok: true, n };
    },

    /** Goods from the hold into the packs (a new kind needs a free slot) */
    unload(player, good, qty, canAdd = null) {
        const b = this.boat(player);
        if (!b) return { ok: false, reason: 'You have no boat.' };
        if (!(b.aboard || (b.q === player.q && b.r === player.r))) return { ok: false, reason: 'Your boat is not here.' };
        const have = Math.floor(_num(b.cargo && b.cargo[good]));
        const n = qty === Infinity || qty == null ? have : Math.min(Math.floor(_num(qty)), have);
        if (!(n > 0)) return { ok: false, reason: 'There is none in the hold.' };
        if (canAdd && !canAdd(player, good)) return { ok: false, reason: 'Your packs are full.' };
        if (!player.inventory) player.inventory = {};
        player.inventory[good] = (player.inventory[good] || 0) + n;
        b.cargo[good] = have - n;
        if (b.cargo[good] <= 0) delete b.cargo[good];
        return { ok: true, n };
    },

    /**
     * The tolls a boat owes passing hex (q, r): a town's mill weir and its
     * bridge. → { weir, bridge, total, town } (0 where nothing is owed)
     */
    tollsAt(world, player, q, r) {
        const t = this._tile(world, q, r);
        const out = { weir: 0, bridge: 0, total: 0, town: null };
        if (!t || !t.settlement || !RiverDrift.isRiverHex(t)) return out;
        const cfg = this.config().tolls;
        const b = this.boat(player);
        const extra = Math.floor(this.holdOf(b) / 40) * _num(cfg.perHold, 1);
        const dam = RiverDrift.damAt(world, q, r);
        if (dam && dam.kind === 'mill') out.weir = _num(cfg.weir, 2) + extra;
        if (t.hasRoad || (t.infrastructure && t.infrastructure.id === 'bridge') || t.roadCross === 'bridge') out.bridge = _num(cfg.bridge, 1) + Math.floor(extra / 2);
        out.total = out.weir + out.bridge;
        out.town = t.settlement;
        return out;
    },

    /**
     * The boat comes into hex (q, r) (player/core/movement.js stepAlongPath):
     * its tolls are paid, the boat goes with you. → { paid, inKind? } or null
     */
    passHex(world, player, q, r) {
        const b = this.boat(player);
        if (!b || !b.aboard) return null;
        b.q = q; b.r = r;
        const due = this.tollsAt(world, player, q, r);
        if (!(due.total > 0)) return null;
        const purse = this._purse(due.town);
        if (_num(player.gold) >= due.total) {
            player.gold -= due.total;
            purse.gold += due.total;
            b.tolls = _num(b.tolls) + due.total;
            Ledger.record(player, 'roadTolls', -due.total);
            b.lastToll = { q, r, paid: due.total, town: due.town.name || 'the town' };
            return { paid: due.total };
        }
        // No coin: the toll-keeper takes a unit of the hold's dearest goods instead
        const goods = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        let best = null, bv = -1;
        for (const [g, n] of Object.entries(b.cargo || {})) {
            if (!(n > 0)) continue;
            const v = _num(goods[g.toUpperCase()] && goods[g.toUpperCase()].basePrice, 1);
            if (v > bv) { bv = v; best = g; }
        }
        if (best) {
            b.cargo[best]--;
            if (b.cargo[best] <= 0) delete b.cargo[best];
            b.lastToll = { q, r, paid: 0, inKind: best, town: due.town.name || 'the town' };
            return { paid: 0, inKind: best };
        }
        b.lastToll = { q, r, paid: 0, waved: true, town: due.town.name || 'the town' };
        return { paid: 0 };
    },

    /** Drop the boat (it sank, was lost): a test or a story hook */
    lose(player) {
        if (player) player.riverBoat = null;
    },

    /** A saved boat made sound */
    restore(player) {
        const b = player && player.riverBoat;
        if (!b) return;
        if (typeof b !== 'object' || !this.config().boats[b.kind]) { player.riverBoat = null; return; }
        if (!b.cargo || typeof b.cargo !== 'object') b.cargo = {};
        if (!Array.isArray(b.fishLots)) b.fishLots = [];
        b.aboard = !!b.aboard;
    },
};
