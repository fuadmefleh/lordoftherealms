// ============================================
// COURIERS — the post houses that carry the world's letters
// ============================================
// Courier houses are businesses based in towns. Each has an owner (an NPC,
// or the player), a name, a network of stations (towns it serves), riders,
// relay horses, guards, a speed tier (standard / express / relay), a postage
// price, a reputation and cash:
//
//   courier = { id, name, icon, owner: 'npc'|'player', ownerName, home, homeName,
//               kingdomId, stations: [{ key, q, r, name, kingdomId }], riders,
//               horses, guards, speed, price, reputation (0..100), cash,
//               foundedDay, alive, lossWeeks, unpaidWeeks, week: {...}, history: [...] }
//
// Every week (`_week`, its own seeded stream: world seed + day):
//   - each town writes letters (data/couriers.json demand: its size and its
//     court), split among the houses with a station there by price, speed
//     and reputation; a Royal Post charter in the realm gives its holder all
//     of that realm's mail (the others' stations there carry nothing)
//   - riders' wages, horses' fodder, stations' rent and guards are paid
//   - riders on dangerous roads (a realm at war, raiders or an outlaw lair
//     near the town) are robbed: reputation, cash and horses lost
//   - NPC houses open stations when rich, cut prices when losing, hire riders,
//     and go bankrupt; a town that goes unserved long enough gets a new house
//   - the player's house (owner 'player') earns its takings and pays its costs
//     straight from the player's purse (Ledger courierHouse / courierCosts);
//     events: a sealed letter in a rider's bag (Journal -> Letters), a rival
//     house undercutting you, sabotage
// Every `charter.everyDays` an NPC crown may grant its best house the Royal
// Post (a monopoly on the realm's mail, a weekly fee to the treasury, booked
// on the crown's demesne line — world/crownBooks.js; the crown's policy as
// the realm panels show it, Kingship.crownPolicies); the player bids for one
// (`bidCharter`, the petition booked as a sale of privilege) or, as a ruler,
// grants and revokes it as the Royal Post edict of the Royal Court
// (systems/kingship.js grantRoyalPost / revokeRoyalPost → setCharter).
//
// The player's own letters (systems/mail.js) ride with these houses:
// `quote` gives a house's price, days and reliability between two towns.
// State on world.post (saved world-side, systems/saveLoad.js); content in
// data/couriers.json. World / player are passed in; no import-time effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Transport } from '../world/transport.js';
import { NPCLords } from '../world/npcLords.js';
import { Throne } from './throne.js';
import { OutlawLairs } from './outlawLairs.js';
import { Ledger } from './ledger.js';
import { CourtLetters } from './courtLetters.js';
import { CrownBooks } from '../world/crownBooks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _key = (q, r) => `${q},${r}`;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

const DEFAULT_CFG = {
    enabled: true, weekDays: 7, firstDay: 3,
    demand: { perPop: 0.004, type: { village: 0.4, town: 1, city: 1.6, capital: 2.4 }, min: 1, max: 40, unservedToFound: 16, revenuePerLetter: 1.5 },
    speeds: {
        standard: { name: 'Standard post', icon: '✉️', hexesPerDay: 7, price: 1, wage: 1, appeal: 1 },
        express: { name: 'Express riders', icon: '🏇', hexesPerDay: 11, price: 1.5, wage: 1.5, appeal: 1.3 },
        relay: { name: 'Relay of fresh horses', icon: '🐎', hexesPerDay: 16, price: 2.2, wage: 2, appeal: 1.6, horsesPerStation: 2 },
    },
    costs: { riderWage: 6, horseUpkeep: 2, stationUpkeep: 8, guardWage: 5, riderHire: 20, horsePrice: 30, guardHire: 15, stationPrice: 150, foundPrice: 400, licence: 100, maxRiders: 60, maxHorses: 60, maxGuards: 30 },
    price: { base: 4, min: 1, max: 20, perHex: 0.12, elasticity: 1.3 },
    npc: { maxCouriers: 14, startCash: [300, 900], startStations: [2, 4], expandAt: 520, expandRange: 14, maxStations: 10, bankruptCash: -150, lossWeeksToCut: 2, priceCut: 0.9, priceRaise: 1.05, ridersPerStation: 2, foundCash: [250, 600] },
    reliability: { base: 0.8, horses: 0.1, guards: 0.05, repWeight: 0.002, min: 0.4, max: 0.98, offNetwork: 0.9, offNetworkDays: 1.3 },
    danger: { war: 0.35, raider: 0.4, lair: 0.3, raiderRange: 4, lairRange: 5, robChance: 0.35, robRep: 3, robCash: [10, 40] },
    charter: { everyDays: 28, grantChance: 0.25, minStations: 3, playerMinStations: 2, minReputation: 55, feePerTown: 6, playerBid: 300, bidCooldown: 30, demandBonus: 1.2 },
    events: { bagChance: 0.12, foundOut: 0.25, sellFoundOut: 0.35, sellPrice: [60, 150], sabotageChance: 0.06, maxNews: 30, maxHistory: 8 },
    mail: {},
};

let _cfgSrc;
let _cfg = null;

export const Couriers = {

    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.couriers) || {};
    },

    config() {
        const d = this.data().config || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            const merged = { ...DEFAULT_CFG, ...o };
            for (const k of ['demand', 'costs', 'price', 'npc', 'reliability', 'danger', 'charter', 'events', 'mail']) merged[k] = { ...DEFAULT_CFG[k], ...(o[k] || {}) };
            merged.demand.type = { ...DEFAULT_CFG.demand.type, ...((o.demand && o.demand.type) || {}) };
            merged.speeds = { ...DEFAULT_CFG.speeds, ...(o.speeds || {}) };
            _cfg = merged;
        }
        return _cfg;
    },

    speed(id) {
        const S = this.config().speeds;
        return S[id] || S.standard;
    },

    // ──────────── STATE ────────────

    _blank() {
        return { v: 1, couriers: [], charters: {}, unserved: {}, news: [], bids: {}, nextId: 1, seeded: false, lastWeekDay: null, lastCharterDay: null, notices: {} };
    },

    state(world) {
        if (!world) return this._blank();
        let st = world.post;
        if (!st || typeof st !== 'object') {
            world.post = this._blank();
            return world.post;
        }
        const blank = this._blank();
        for (const k of Object.keys(blank)) if (st[k] === undefined) st[k] = blank[k];
        if (!Array.isArray(st.couriers)) st.couriers = [];
        if (!Array.isArray(st.news)) st.news = [];
        return st;
    },

    serialize(world) {
        return world && world.post ? JSON.parse(JSON.stringify(world.post)) : null;
    },

    /** Older saves: none — the houses are founded on the next days. */
    restore(saved, world) {
        if (!world) return;
        world.post = saved && typeof saved === 'object' ? JSON.parse(JSON.stringify(saved)) : this._blank();
        this.state(world);
    },

    // ──────────── TOWNS ────────────

    _views(world) {
        if (!world) return [];
        if (typeof world.getSettlementViews === 'function') return world.getSettlementViews() || [];
        return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
    },

    /** The towns as a Map key -> { key, q, r, name, type, kingdomId, population }. */
    towns(world) {
        const out = new Map();
        for (const s of this._views(world)) {
            if (!s || !Number.isFinite(s.q)) continue;
            const key = _key(s.q, s.r);
            out.set(key, { key, q: s.q, r: s.r, name: s.name || 'a town', type: s.type || 'village', kingdomId: s.kingdom || null, population: _num(s.population, 300) });
        }
        return out;
    },

    town(world, key) {
        return this.towns(world).get(key) || null;
    },

    /** The town the player stands in, or null. */
    townHere(world, player) {
        if (!world || !player || typeof world.getTile !== 'function') return null;
        // The first houses are a hash of the map (no RNG): seed them now so the post isn't empty before the first dawn
        if (!this.state(world).seeded) this._seedHouses(world);
        const t = world.getTile(player.q, player.r);
        if (!t || !t.settlement) return null;
        const s = t.settlement;
        return { key: _key(player.q, player.r), q: player.q, r: player.r, name: s.name || 'a town', type: s.type || 'village', kingdomId: s.kingdom || null, population: _num(s.population, 300) };
    },

    /** Letters a town writes in a week. */
    demand(town) {
        const D = this.config().demand;
        const mult = _num(D.type[town.type], 1);
        return _clamp(Math.round(_num(town.population, 300) * D.perPop * mult * 10) / 10, D.min, D.max);
    },

    // ──────────── HOUSES ────────────

    all(world) {
        return this.state(world).couriers;
    },

    alive(world) {
        return this.all(world).filter(c => c && c.alive !== false);
    },

    get(world, id) {
        return this.all(world).find(c => c && c.id === id) || null;
    },

    /** The player's courier house (alive), or null. */
    playerHouse(world) {
        return this.alive(world).find(c => c.owner === 'player') || null;
    },

    hasStation(c, key) {
        return !!(c && Array.isArray(c.stations) && c.stations.some(s => s.key === key));
    },

    stationsIn(c, kingdomId) {
        return ((c && c.stations) || []).filter(s => s.kingdomId === kingdomId).length;
    },

    /** The Royal Post charter of a realm: { courierId, kingdomId, day, fee } or null. */
    charter(world, kingdomId) {
        if (!kingdomId) return null;
        const ch = this.state(world).charters[kingdomId];
        if (!ch) return null;
        const holder = this.get(world, ch.courierId);
        return holder && holder.alive !== false ? ch : null;
    },

    /** Is this house barred from carrying mail in a realm (another holds its charter)? */
    barred(world, c, kingdomId) {
        const ch = this.charter(world, kingdomId);
        return !!(ch && c && ch.courierId !== c.id);
    },

    /** The houses that carry mail from a town today. */
    servingAt(world, key, kingdomId = undefined) {
        const kid = kingdomId !== undefined ? kingdomId : (this.town(world, key) || {}).kingdomId;
        return this.alive(world).filter(c => this.hasStation(c, key) && !this.barred(world, c, kid));
    },

    /** 0..1: the share of letters a house delivers. */
    reliability(c) {
        const R = this.config().reliability;
        if (!c) return R.base;
        const n = Math.max(1, (c.stations || []).length);
        const S = this.speed(c.speed);
        const needHorses = Math.max(1, n * _num(S.horsesPerStation, 1));
        const riders = Math.max(1, _num(c.riders));
        let rel = R.base + R.horses * Math.min(1, _num(c.horses) / needHorses) + R.guards * Math.min(1, _num(c.guards) / riders);
        rel += (_num(c.reputation, 50) - 50) * R.repWeight;
        if (_num(c.riders) < n) rel -= 0.1 * (1 - _num(c.riders) / n); // too few riders for the network
        return Math.round(_clamp(rel, R.min, R.max) * 1000) / 1000;
    },

    /** Hexes a day: the tier's pace, slowed by too few relay horses. */
    hexesPerDay(c) {
        const S = this.speed(c && c.speed);
        let h = _num(S.hexesPerDay, 7);
        if (c && S.horsesPerStation) {
            const need = Math.max(1, (c.stations || []).length * S.horsesPerStation);
            if (_num(c.horses) < need) h = Math.max(this.speed('express').hexesPerDay || 11, h * (0.6 + 0.4 * _num(c.horses) / need));
        }
        return h;
    },

    guardCover(c) {
        if (!c) return 0;
        return Math.min(0.8, _num(c.guards) / Math.max(1, _num(c.riders)) * 0.8);
    },

    /** Postage for one letter over `dist` hexes. */
    postage(c, dist) {
        return Math.max(1, Math.round(this.letterPrice(c) * (1 + Math.max(0, dist) * this.config().price.perHex)));
    },

    /** The house's price for a letter at its pace (its postage × the speed tier's price). */
    letterPrice(c) {
        const P = this.config().price;
        return _num(c && c.price, P.base) * _num(this.speed(c && c.speed).price, 1);
    },

    // ──────────── ROADS & DANGER ────────────

    /**
     * Days on the road between two places at `hexesPerDay`: a road all the
     * way speeds it, open country slows it, a closed pass or flooded ford
     * holds it, winter slows everything.
     */
    travelDays(world, a, b, hexesPerDay) {
        const M = this.config().mail;
        const dist = _dist(world, a, b);
        let speed = Math.max(1, _num(hexesPerDay, 7));
        let extra = 0;
        let band = null;
        try { band = Transport.linkBand(world, a, b); } catch (e) { band = null; }
        if (band === 'closed') extra += _num(M.closedDays, 3);
        if (band === 'good' || band === 'canal') speed *= _num(M.roadSpeed, 1.15);
        else if (band === 'ruined' || band == null) speed *= _num(M.noRoadSpeed, 0.85);
        if (world && world.season === 'Winter') speed *= _num(M.winterSpeed, 0.8);
        return Math.max(1, Math.ceil(dist / speed) + extra);
    },

    /** The hostile things abroad: raider bands and lair beasts on the map, active outlaw lairs. */
    _threats(world, player) {
        const hostiles = [];
        for (const u of (world && world.units) || []) {
            if (!u || u.destroyed) continue;
            if (u.type === 'raider' || (u.lairId != null && u.type === 'beast')) hostiles.push(u);
        }
        const lairs = player ? OutlawLairs.active(player).filter(l => Number.isFinite(l.q)) : [];
        return { hostiles, lairs };
    },

    /** 0..1: how dangerous the roads about a place are. */
    placeDanger(world, place, threats, kingdomId = null) {
        const D = this.config().danger;
        let safe = 1;
        const k = kingdomId && world && typeof world.getKingdom === 'function' ? world.getKingdom(kingdomId) : null;
        if (k && Array.isArray(k.wars) && k.wars.length) safe *= 1 - D.war;
        if (threats.hostiles.some(u => _dist(world, u, place) <= D.raiderRange)) safe *= 1 - D.raider;
        if (threats.lairs.some(l => _dist(world, l, place) <= D.lairRange)) safe *= 1 - D.lair;
        return 1 - safe;
    },

    /** 0..1: the danger of a ride between two places (sampled along the way). */
    routeDanger(world, player, a, b, aKid = null, bKid = null) {
        const threats = this._threats(world, player);
        const W = (world && world.width) || 0;
        let dq = b.q - a.q;
        if (W && Math.abs(dq) > W / 2) dq -= Math.sign(dq) * W;
        const pts = Hex.lineDraw(a.q, a.r, a.q + dq, b.r);
        let worst = 0;
        for (let i = 0; i < pts.length; i += 3) {
            const p = { q: W ? Hex.wrapQ(pts[i].q, W) : pts[i].q, r: pts[i].r };
            worst = Math.max(worst, this.placeDanger(world, p, threats, null));
        }
        // War at either end, or between the two realms
        const D = this.config().danger;
        const ka = aKid && world.getKingdom ? world.getKingdom(aKid) : null;
        if (ka && bKid && (ka.wars || []).includes(bKid)) worst = 1 - (1 - worst) * (1 - D.war * 1.5);
        else if ((ka && (ka.wars || []).length) || (bKid && world.getKingdom && ((world.getKingdom(bKid) || {}).wars || []).length)) worst = 1 - (1 - worst) * (1 - D.war * 0.5);
        return Math.round(_clamp(worst, 0, 0.95) * 1000) / 1000;
    },

    /**
     * A house's terms for a letter between two places:
     * { courierId, name, price, days, reliability, offNetwork, guardCover }.
     */
    quote(world, c, from, to, toKey = null) {
        const R = this.config().reliability;
        const dist = _dist(world, from, to);
        const off = !(toKey && this.hasStation(c, toKey));
        let days = this.travelDays(world, from, to, this.hexesPerDay(c));
        let rel = this.reliability(c);
        if (off) { days = Math.ceil(days * R.offNetworkDays); rel *= R.offNetwork; }
        return {
            id: c.id, courierId: c.id, name: c.name, icon: c.icon || '✉️', own: c.owner === 'player', speed: c.speed,
            price: c.owner === 'player' ? 0 : this.postage(c, dist), days, reliability: Math.round(rel * 1000) / 1000,
            offNetwork: off, guardCover: this.guardCover(c),
        };
    },

    /** A letter carried: the house is paid (NPC) and its reputation moves. */
    recordLetter(world, courierId, postage) {
        const c = this.get(world, courierId);
        if (!c) return;
        if (c.owner !== 'player') c.cash = _num(c.cash) + _num(postage);
        if (!c.week) c.week = this._blankWeek();
        c.week.letters = _num(c.week.letters) + 1;
    },

    /** A letter it lost or let be robbed. */
    recordLoss(world, courierId, rep = 1) {
        const c = this.get(world, courierId);
        if (c) c.reputation = _clamp(_num(c.reputation, 50) - rep, 0, 100);
    },

    /**
     * One of a house's riders on the map was waylaid (systems/courierRiders.js):
     * the bag's coin is the house's to make good and, when soldiers seized
     * the rider, the horse goes too. Booked against the house at the next
     * weekly reckoning (c.pendingLoss), as the road's own robberies are.
     */
    riderLost(world, courierId, gold = 0, seized = false) {
        const c = this.get(world, courierId);
        if (!c || c.alive === false) return;
        const p = c.pendingLoss && typeof c.pendingLoss === 'object' ? c.pendingLoss : (c.pendingLoss = { gold: 0, robbed: 0, horses: 0 });
        p.gold = Math.round(_num(p.gold) + Math.max(0, _num(gold)));
        p.robbed = _num(p.robbed) + 1;
        if (seized) p.horses = _num(p.horses) + 1;
    },

    // ──────────── FOUNDING ────────────

    _blankWeek() {
        return { revenue: 0, costs: 0, fee: 0, letters: 0, robbed: 0, profit: 0, towns: {} };
    },

    _name(world, salt) {
        const N = this.data().names || {};
        const first = N.first && N.first.length ? N.first : ['Swift'];
        const last = N.last && N.last.length ? N.last : ['Post'];
        const owners = N.owners && N.owners.length ? N.owners : ['Master Penn'];
        const h = _hash(`${_seed(world)}:courier:${salt}`);
        const taken = new Set(this.all(world).map(c => c.name));
        let name = `${first[h % first.length]} ${last[(h >>> 8) % last.length]}`;
        for (let i = 1; taken.has(name) && i < first.length * last.length; i++) {
            name = `${first[(h + i) % first.length]} ${last[((h >>> 8) + i * 3) % last.length]}`;
        }
        return { name, ownerName: owners[(h >>> 16) % owners.length] };
    },

    _make(world, town, opts = {}) {
        const st = this.state(world);
        const C = this.config();
        const id = `C${st.nextId++}`;
        const nm = opts.name ? { name: opts.name, ownerName: opts.ownerName || 'you' } : this._name(world, `${town.key}:${id}`);
        const c = {
            id, name: nm.name, icon: opts.icon || '✉️', owner: opts.owner || 'npc', ownerName: nm.ownerName,
            home: town.key, homeName: town.name, kingdomId: town.kingdomId,
            stations: [{ key: town.key, q: town.q, r: town.r, name: town.name, kingdomId: town.kingdomId }],
            riders: _num(opts.riders, 2), horses: _num(opts.horses, 1), guards: _num(opts.guards, 0),
            speed: opts.speed || 'standard', price: _num(opts.price, C.price.base),
            reputation: _num(opts.reputation, 50), cash: _num(opts.cash, 0),
            foundedDay: _day(world), alive: true, lossWeeks: 0, unpaidWeeks: 0,
            week: this._blankWeek(), history: [],
        };
        st.couriers.push(c);
        return c;
    },

    _addStation(c, town) {
        if (!c || !town || this.hasStation(c, town.key)) return false;
        c.stations.push({ key: town.key, q: town.q, r: town.r, name: town.name, kingdomId: town.kingdomId });
        return true;
    },

    _news(world, text, icon = '✉️') {
        const st = this.state(world);
        st.news.unshift({ day: _day(world), icon, text });
        const cap = this.config().events.maxNews;
        if (st.news.length > cap) st.news.length = cap;
    },

    /** The first houses: one in each realm's chief town, with stations in its nearest towns (a hash, no RNG). */
    _seedHouses(world) {
        const st = this.state(world);
        if (st.seeded) return;
        st.seeded = true;
        const N = this.config().npc;
        const towns = [...this.towns(world).values()];
        const rank = { capital: 3, city: 2, town: 1, village: 0 };
        for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false)) {
            const mine = towns.filter(t => t.kingdomId === k.id).sort((a, b) => (rank[b.type] || 0) - (rank[a.type] || 0) || b.population - a.population || a.key.localeCompare(b.key));
            if (!mine.length) continue;
            const seat = mine[0];
            const h = _hash(`${_seed(world)}:courierSeed:${k.id}`);
            const [cl, ch] = N.startCash;
            const c = this._make(world, seat, { cash: cl + (h % Math.max(1, ch - cl + 1)), reputation: 45 + (h >>> 4) % 20, price: this.config().price.base + ((h >>> 9) % 3) - 1, speed: (h >>> 14) % 3 === 0 ? 'express' : 'standard' });
            const [sl, sh] = N.startStations;
            const n = sl + ((h >>> 12) % Math.max(1, sh - sl + 1));
            const near = towns.filter(t => t.key !== seat.key && t.type !== 'village')
                .map(t => ({ t, d: _dist(world, seat, t) })).filter(x => x.d <= N.expandRange)
                .sort((a, b) => a.d - b.d || a.t.key.localeCompare(b.t.key)).slice(0, n - 1);
            for (const x of near) this._addStation(c, x.t);
            c.riders = c.stations.length * N.ridersPerStation;
            c.horses = c.stations.length;
        }
    },

    // ──────────── THE DAY ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:couriers:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day of the post: the first houses are seeded, on the week's turn the
     * mail is reckoned, and every `charter.everyDays` the crowns consider the
     * Royal Post. Draws only its own seeded stream. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = this.config();
        if (!world || C.enabled === false || !Array.isArray(world.kingdoms)) return out;
        const st = this.state(world);
        const day = _day(world);
        if (day < C.firstDay) return out;
        this._settleEdicts(world, player);
        Utils.withRng(this._dayRng(world), () => {
            if (!st.seeded) this._seedHouses(world);
            if (st.lastWeekDay == null || day - st.lastWeekDay >= C.weekDays || day < st.lastWeekDay) {
                st.lastWeekDay = day;
                this._week(world, player, out);
            }
            if (st.lastCharterDay == null ? day >= C.charter.everyDays : (day - st.lastCharterDay >= C.charter.everyDays || day < st.lastCharterDay)) {
                st.lastCharterDay = day;
                this._charters(world, player, out);
            }
        });
        return out;
    },

    /** The weekly reckoning of every house. */
    _week(world, player, out) {
        const C = this.config();
        const st = this.state(world);
        const towns = this.towns(world);
        const houses = this.alive(world);
        for (const c of houses) c.week = { ...this._blankWeek(), letters: _num(c.week && c.week.letters) };

        // 1. The mail: each town's letters split among the houses serving it
        for (const t of towns.values()) {
            let d = this.demand(t);
            const ch = this.charter(world, t.kingdomId);
            let servers = houses.filter(c => this.hasStation(c, t.key));
            if (ch) {
                servers = servers.filter(c => c.id === ch.courierId);
                d *= C.charter.demandBonus;
            }
            if (!servers.length) {
                if (t.type !== 'village') st.unserved[t.key] = _num(st.unserved[t.key]) + d;
                continue;
            }
            delete st.unserved[t.key];
            const score = servers.map(c => (0.5 + _num(c.reputation, 50) / 100) * _num(this.speed(c.speed).appeal, 1)
                / Math.pow(Math.max(0.25, this.letterPrice(c) / C.price.base), C.price.elasticity));
            const total = score.reduce((s, x) => s + x, 0) || 1;
            // Dear postage means fewer letters written at all
            const avg = servers.reduce((s, c, i) => s + this.letterPrice(c) * score[i], 0) / total;
            d *= Math.pow(C.price.base / Math.max(0.5, avg), _num(C.demand.priceElasticity, 0.8));
            servers.forEach((c, i) => {
                const letters = d * score[i] / total;
                const rev = letters * this.letterPrice(c) * C.demand.revenuePerLetter;
                c.week.letters += letters;
                c.week.revenue += rev;
                c.week.towns[t.key] = Math.round(_num(c.week.towns[t.key]) + rev);
            });
        }

        // 2. Costs, robbery, reputation — and the player's house settles with the purse
        const threats = this._threats(world, player);
        const Co = C.costs;
        for (const c of houses) {
            const S = this.speed(c.speed);
            c.week.costs = _num(c.riders) * Co.riderWage * _num(S.wage, 1) + _num(c.horses) * Co.horseUpkeep
                + c.stations.length * Co.stationUpkeep + _num(c.guards) * Co.guardWage;
            // The Royal Post's fee to the crown
            for (const [kid, ch] of Object.entries(st.charters)) {
                if (ch && ch.courierId === c.id) {
                    const k = world.getKingdom ? world.getKingdom(kid) : null;
                    const fee = Math.round(C.charter.feePerTown * Math.max(1, this.stationsIn(c, kid)));
                    ch.fee = fee;
                    ch.paid = _num(ch.paid) + fee;
                    c.week.fee += fee;
                    if (k) {
                        k.treasury = _num(k.treasury) + fee;
                        CrownBooks.note(k, 'demesne', fee); // a crown monopoly's due
                    }
                }
            }
            this._robberies(world, player, c, threats, out);
            // The riders waylaid on the map this week
            const lost = c.pendingLoss;
            if (lost && typeof lost === 'object') {
                c.week.robbed += _num(lost.robbed);
                if (c.owner === 'player') c.week.costs += _num(lost.gold);
                else c.cash = _num(c.cash) - _num(lost.gold);
                c.horses = Math.max(0, _num(c.horses) - _num(lost.horses));
                c.pendingLoss = null;
            }
            c.week.revenue = Math.round(c.week.revenue);
            c.week.costs = Math.round(c.week.costs);
            c.week.profit = c.week.revenue - c.week.costs - c.week.fee;
            if (c.owner === 'player') this._settlePlayer(world, player, c, out);
            else c.cash = Math.round(_num(c.cash) + c.week.profit);
            // Reputation drifts toward the house's real reliability
            const target = this.reliability(c) * 100;
            c.reputation = Math.round(_clamp(_num(c.reputation, 50) + (target - _num(c.reputation, 50)) * 0.12, 0, 100) * 10) / 10;
            c.history.unshift({ day: _day(world), revenue: c.week.revenue, costs: c.week.costs + c.week.fee, profit: c.week.profit, letters: Math.round(c.week.letters), robbed: c.week.robbed });
            if (c.history.length > C.events.maxHistory) c.history.length = C.events.maxHistory;
        }

        // 3. The NPC houses decide; new ones are founded where towns go unserved
        for (const c of houses) if (c.owner !== 'player' && c.alive !== false) { this._npcTurn(world, c, towns, out, player); this._draw(c); }
        this._foundings(world, towns, out, player);
        if (player) this._playerEvents(world, player, out);
        for (const c of houses) c.week.letters = 0;
    },

    _robberies(world, player, c, threats, out) {
        const D = this.config().danger;
        const cover = this.guardCover(c);
        if (_num(c.riders) <= 0) return;
        for (const s of c.stations) {
            const danger = this.placeDanger(world, s, threats, s.kingdomId);
            if (!danger || Utils.random() >= danger * D.robChance * (1 - cover)) continue;
            c.week.robbed++;
            c.reputation = _clamp(_num(c.reputation, 50) - D.robRep, 0, 100);
            if (_num(c.horses) > 0 && Utils.random() < 0.5) c.horses--;
            const loss = Utils.randInt(D.robCash[0], D.robCash[1]);
            if (c.owner !== 'player') c.cash = _num(c.cash) - loss;
            else c.week.costs += loss;
            if (c.owner === 'player') out.notices.push({ icon: '🗡️', title: 'A Rider Robbed', text: `A rider of ${c.name} was robbed on the road near ${s.name}. The mail bag is gone (${loss} gold of postage and goods to make good); the house's name suffers.`, type: 'warning' });
        }
    },

    /** The player's house: takings in, wages out, through the Ledger. */
    _settlePlayer(world, player, c, out) {
        if (!player) return;
        const w = c.week;
        if (w.revenue > 0) {
            player.gold = _num(player.gold) + w.revenue;
            Ledger.record(player, 'courierHouse', w.revenue);
        }
        const owed = w.costs + w.fee;
        const paid = Math.min(owed, Math.max(0, Math.floor(_num(player.gold))));
        if (paid > 0) {
            player.gold = _num(player.gold) - paid;
            const feePaid = Math.min(w.fee, paid);
            if (paid - feePaid > 0) Ledger.record(player, 'courierCosts', -(paid - feePaid));
            if (feePaid > 0) Ledger.record(player, 'royalPost', -feePaid);
        }
        if (paid < owed) {
            c.unpaidWeeks = _num(c.unpaidWeeks) + 1;
            c.riders = Math.max(0, _num(c.riders) - 1);
            c.reputation = _clamp(_num(c.reputation, 50) - 4, 0, 100);
            out.notices.push({ icon: '📉', title: `${c.name} Unpaid`, text: `You could not meet ${c.name}'s wages this week (${owed - paid} gold short). A rider quits; the house's name suffers.`, type: 'warning' });
            if (c.unpaidWeeks >= 3) {
                this._close(world, c, `${c.name} closes its doors: its riders went unpaid for three weeks.`);
                out.notices.push({ icon: '📪', title: `${c.name} Closed`, text: `${c.name} has closed: its riders went unpaid for three weeks.`, type: 'error' });
            }
        } else {
            c.unpaidWeeks = 0;
        }
    },

    _close(world, c, text) {
        c.alive = false;
        c.closedDay = _day(world);
        const st = this.state(world);
        for (const [kid, ch] of Object.entries(st.charters)) if (ch && ch.courierId === c.id) delete st.charters[kid];
        this._news(world, text, '📪');
    },

    /** An NPC house's week: bankruptcy, price, riders, a new station. */
    _npcTurn(world, c, towns, out, player) {
        const C = this.config();
        const N = C.npc;
        const P = C.price;
        if (_num(c.cash) < N.bankruptCash) {
            this._close(world, c, `${c.name} of ${c.homeName} has gone bankrupt; its riders are turned off.`);
            if (player && this.playerHouse(world) && c.stations.some(s => this.hasStation(this.playerHouse(world), s.key))) {
                out.notices.push({ icon: '📪', title: 'A Rival Post Fails', text: `${c.name} has gone bankrupt. Its customers are yours to win.`, type: 'success' });
            }
            return;
        }
        const floor = Math.max(P.min, P.base * _num(N.minPriceMult, 0.6));
        const ceiling = Math.min(P.max, P.base * _num(N.maxPriceMult, 1.6));
        const rivals = this.alive(world).filter(o => o !== c && o.stations.some(s => this.hasStation(c, s.key)));
        if (c.week.profit < 0) {
            c.lossWeeks = _num(c.lossWeeks) + 1;
            if (c.lossWeeks >= N.lossWeeksToCut) {
                c.lossWeeks = 0;
                // Cut costs first: the station that earns least, idle riders and guards
                const per = Object.fromEntries(c.stations.map(s => [s.key, _num(c.week.towns && c.week.towns[s.key])]));
                const worst = c.stations.filter(s => s.key !== c.home).sort((a, b) => per[a.key] - per[b.key] || a.key.localeCompare(b.key))[0];
                if (worst && per[worst.key] < C.costs.stationUpkeep + C.costs.riderWage * N.ridersPerStation) {
                    c.stations = c.stations.filter(s => s !== worst);
                    this._news(world, `${c.name} closes its station at ${worst.name}.`, '📪');
                }
                const want = c.stations.length * N.ridersPerStation;
                while (c.riders > Math.max(1, want)) c.riders--;
                if (c.horses > c.stations.length) c.horses--;
                if (c.guards > 0 && !c.week.robbed) c.guards--;
                // ...then price, if dearer than its rivals
                const avgRival = rivals.length ? rivals.reduce((s, o) => s + o.price, 0) / rivals.length : c.price;
                if (c.price > avgRival * 1.05 || !rivals.length) c.price = Math.max(floor, Math.round(c.price * N.priceCut * 10) / 10);
            }
        } else {
            c.lossWeeks = 0;
            // Profitable and no one much cheaper: a little dearer
            if (c.week.profit > 40 && !rivals.some(o => o.price < c.price * 0.9)) c.price = Math.min(ceiling, Math.round(c.price * N.priceRaise * 10) / 10);
        }
        // A competitor much cheaper: answer it, but not below what keeps the house
        const cheaper = rivals.filter(o => o.price < c.price * 0.8);
        if (cheaper.length) c.price = Math.max(floor, Math.round(Math.max(...cheaper.map(o => o.price)) * 1.05 * 10) / 10);
        if (c.price > ceiling) c.price = ceiling;
        if (c.price < floor) c.price = floor;
        // Riders and horses for the network, when the cash allows
        const want = c.stations.length * N.ridersPerStation;
        if (c.riders < want && c.cash > C.costs.riderHire * 3) { c.riders++; c.cash -= C.costs.riderHire; }
        if (c.horses < c.stations.length && c.cash > C.costs.horsePrice * 4) { c.horses++; c.cash -= C.costs.horsePrice; }
        if (c.week.robbed && c.guards < c.riders / 2 && c.cash > C.costs.guardHire * 4) { c.guards++; c.cash -= C.costs.guardHire; }
        // A new station: the best town near the network it does not serve yet
        if (c.cash > N.expandAt && c.week.profit > 0 && c.stations.length < N.maxStations) {
            const t = this._bestNewTown(world, c, towns);
            if (t) {
                this._addStation(c, t);
                c.cash -= C.costs.stationPrice;
                this._news(world, `${c.name} opens a station at ${t.name}.`, '📮');
                const ph = this.playerHouse(world);
                if (ph && this.hasStation(ph, t.key)) out.notices.push({ icon: '📮', title: 'A Rival Post Arrives', text: `${c.name} opens a station at ${t.name}, where your house carries the mail. Watch your prices.`, type: 'warning' });
            }
        }
    },

    /** The owner draws what the house does not need (NPC houses keep at most a war chest). */
    _draw(c) {
        const keep = _num(this.config().npc.keepCash, 2500);
        if (c.owner !== 'player' && _num(c.cash) > keep) c.cash = Math.round(keep + (c.cash - keep) * 0.5);
    },

    _bestNewTown(world, c, towns) {
        const N = this.config().npc;
        let best = null;
        let bestScore = 0;
        for (const t of towns.values()) {
            if (this.hasStation(c, t.key) || t.type === 'village' || this.barred(world, c, t.kingdomId)) continue;
            const near = c.stations.reduce((m, s) => Math.min(m, _dist(world, s, t)), Infinity);
            if (near > N.expandRange) continue;
            const servers = this.alive(world).filter(o => this.hasStation(o, t.key)).length;
            const own = this.charter(world, t.kingdomId) && this.charter(world, t.kingdomId).courierId === c.id ? 1.5 : 1;
            const s = this.demand(t) * own / (1 + servers) / (1 + near / 10);
            if (s > bestScore || (s === bestScore && best && t.key < best.key)) { best = t; bestScore = s; }
        }
        return best;
    },

    /** Towns unserved long enough get a new house. */
    _foundings(world, towns, out, player) {
        const C = this.config();
        const st = this.state(world);
        if (this.alive(world).filter(c => c.owner !== 'player').length >= C.npc.maxCouriers) return;
        const keys = Object.keys(st.unserved).filter(k => st.unserved[k] >= C.demand.unservedToFound).sort((a, b) => st.unserved[b] - st.unserved[a] || a.localeCompare(b));
        for (const key of keys.slice(0, 1)) {
            const t = towns.get(key);
            delete st.unserved[key];
            if (!t || this.charter(world, t.kingdomId)) continue;
            const [lo, hi] = C.npc.foundCash;
            const c = this._make(world, t, { cash: Utils.randInt(lo, hi), reputation: 40 + Utils.randInt(0, 15), price: Math.round(C.price.base * Utils.randFloat(0.8, 1.2) * 10) / 10 });
            const near = [...towns.values()].filter(o => o.key !== t.key && o.type !== 'village' && _dist(world, t, o) <= 8 && !this.barred(world, c, o.kingdomId))
                .sort((a, b) => _dist(world, t, a) - _dist(world, t, b) || a.key.localeCompare(b.key)).slice(0, 1);
            for (const o of near) this._addStation(c, o);
            c.riders = c.stations.length * C.npc.ridersPerStation;
            this._news(world, `${c.ownerName} founds ${c.name} at ${t.name}: the town had no post.`, '📮');
            const ph = player ? this.playerHouse(world) : null;
            if (ph && c.stations.some(s => this.hasStation(ph, s.key))) out.notices.push({ icon: '📮', title: 'A New Post House', text: `${c.name} is founded at ${t.name}, on your house's roads.`, type: 'info' });
        }
    },

    /**
     * A Royal Post the player proclaimed by edict outlives their crown only
     * as the next ruler's grant: once the player no longer rules the realm
     * (abdicated, deposed, the realm fallen) the charter stands as an
     * ordinary crown grant, so the realm's crown may let it lapse, and a
     * later player-king adopts it rather than finding a ghost edict. No RNG.
     */
    _settleEdicts(world, player) {
        const st = this.state(world);
        const ruled = player ? Throne.ruledKingdom(player, world) : null;
        for (const [kid, ch] of Object.entries(st.charters)) {
            if (!ch || !ch.edict || (ruled && String(ruled.id) === String(kid))) continue;
            ch.edict = false;
            ch.by = 'crown';
            const c = this.get(world, ch.courierId);
            this._news(world, `${this._realmName(world, kid)}'s new crown lets ${c ? c.name : 'its holder'} keep the Royal Post the old ruler proclaimed.`, '📜');
        }
    },

    /** The crowns and the Royal Post. */
    _charters(world, player, out) {
        const C = this.config().charter;
        const st = this.state(world);
        const ruled = player ? Throne.ruledKingdom(player, world) : null;
        for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false)) {
            const ch = st.charters[k.id];
            if (ch) {
                const holder = this.get(world, ch.courierId);
                if (!holder || holder.alive === false || !this.stationsIn(holder, k.id)) {
                    delete st.charters[k.id];
                    this._news(world, `The Royal Post of ${k.name} lapses: ${holder ? holder.name : 'its holder'} no longer carries the realm's mail.`, '📜');
                    if (holder && holder.owner === 'player') out.notices.push({ icon: '📜', title: 'Royal Post Lost', text: `Your Royal Post charter in ${k.name} has lapsed.`, type: 'warning' });
                }
                continue;
            }
            if (ruled && ruled.id === k.id) continue; // the player's own crown decides for itself
            const cands = this.alive(world).filter(c => c.owner !== 'player' && this.stationsIn(c, k.id) >= C.minStations && _num(c.reputation) >= C.minReputation)
                .sort((a, b) => this.stationsIn(b, k.id) * b.reputation - this.stationsIn(a, k.id) * a.reputation || a.id.localeCompare(b.id));
            if (!cands.length || Utils.random() >= C.grantChance) continue;
            this.grant(world, k.id, cands[0].id);
            const ph = player ? this.playerHouse(world) : null;
            if (ph && this.stationsIn(ph, k.id)) out.notices.push({ icon: '📜', title: 'A Royal Post Granted', text: `The crown of ${k.name} grants ${cands[0].name} the Royal Post: only it may carry the realm's mail. Your stations there fall idle.`, type: 'warning' });
        }
    },

    /** A crown grants a house its Royal Post. by: 'crown' (an NPC crown), 'petition' (the player's bid won), 'edict' (the player-king's edict). */
    grant(world, kingdomId, courierId, by = 'crown') {
        const st = this.state(world);
        const c = this.get(world, courierId);
        const k = world.getKingdom ? world.getKingdom(kingdomId) : null;
        if (!c || !k) return null;
        st.charters[kingdomId] = { courierId, kingdomId, day: _day(world), by, edict: by === 'edict', paid: 0, fee: Math.round(this.config().charter.feePerTown * Math.max(1, this.stationsIn(c, kingdomId))) };
        this._news(world, `${k.name} grants ${c.name} the Royal Post${by === 'edict' ? ' by royal edict' : ''}.`, '📜');
        return st.charters[kingdomId];
    },

    /**
     * Write (courierId) or clear (null) a realm's Royal Post charter — the
     * player-king's edict goes through here (Kingship.syncRoyalPost).
     */
    setCharter(world, kingdomId, courierId, by = 'edict') {
        const st = this.state(world);
        if (courierId) return this.grant(world, kingdomId, courierId, by);
        const ch = st.charters[kingdomId];
        if (!ch) return null;
        delete st.charters[kingdomId];
        const c = this.get(world, ch.courierId);
        this._news(world, `${this._realmName(world, kingdomId)} revokes the Royal Post of ${c ? c.name : 'its holder'}.`, '📜');
        return null;
    },

    // ──────────── THE PLAYER'S EVENTS ────────────

    _playerEvents(world, player, out) {
        const c = this.playerHouse(world);
        if (!c) return;
        const E = this.config().events;
        const st = this.state(world);
        const day = _day(world);
        // A sealed letter of a lord's in a rider's bag
        if (Utils.random() < E.bagChance && c.riders > 0) {
            const lords = (world.kingdoms || []).filter(k => k && k.isAlive !== false && k.lord && c.stations.some(s => s.kingdomId === k.id));
            const k = lords.length ? Utils.randPick(lords) : null;
            const enemy = k && (k.wars || []).length ? world.getKingdom(Utils.randPick(k.wars)) : null;
            if (k) {
                const dest = Utils.randPick(c.stations);
                const price = Utils.randInt(E.sellPrice[0], E.sellPrice[1]);
                const vars = { courier: c.name, lordName: k.lord.name || k.ruler || 'the ruler', realm: k.name, dest: dest.name, enemy: enemy ? enemy.name : '', price };
                const K = CourtLetters.kind('courier_bag') || {};
                const fill = (s) => String(s || '').replace(/\{(\w+)\}/g, (m, x) => (vars[x] != null ? String(vars[x]) : m));
                CourtLetters.deliver(player, {
                    id: 0, kind: 'courier_bag', day, expires: day + _num(K.expiry, 5),
                    from: { type: 'courier', name: c.name, kingdomId: k.id }, key: `courier:${c.id}:${day}`,
                    vars, data: { courierId: c.id, kingdomId: k.id, enemyId: enemy ? enemy.id : null, price },
                    subject: fill(K.subject), body: fill(K.body), read: false,
                });
                out.notices.push({ icon: '🎒', title: 'A Sealed Letter', text: `A rider of ${c.name} carries a letter under the seal of ${k.name}. Journal → Letters.`, type: 'info' });
            }
        }
        // Rivals on the same roads: undercutting, sabotage
        const rivals = this.alive(world).filter(o => o !== c && o.stations.some(s => this.hasStation(c, s.key)));
        if (!st.notices) st.notices = {};
        for (const o of rivals) {
            const nk = `undercut:${o.id}`;
            if (o.price < c.price * 0.85 && !(st.notices[nk] > day - 28)) {
                st.notices[nk] = day;
                out.notices.push({ icon: '📉', title: 'Undercut', text: `${o.name} carries letters for ${o.price} gold where you ask ${c.price}. Your custom will drain away to them.`, type: 'warning' });
            }
        }
        if (rivals.length && Utils.random() < E.sabotageChance) {
            const o = Utils.randPick(rivals);
            if (_num(c.horses) >= 2 && Utils.random() < 0.6) {
                c.horses -= 2;
                out.notices.push({ icon: '🐎', title: 'Sabotage', text: `Two of ${c.name}'s relay horses were found lamed in their stalls. The grooms swear a man from ${o.name} was seen about the yard.`, type: 'warning' });
            } else if (_num(c.riders) > 1) {
                c.riders--;
                out.notices.push({ icon: '💰', title: 'A Rider Bought', text: `${o.name} has hired away one of your riders with better pay.`, type: 'warning' });
            }
        }
    },

    // ──────────── THE PLAYER'S HOUSE ────────────

    _gold(player, cat, amount) {
        player.gold = _num(player.gold) + amount;
        Ledger.record(player, cat, amount);
    },

    /** The cost of founding a house here: { ok, why, cost, licence, town }. */
    foundQuote(player, world) {
        const C = this.config().costs;
        const town = this.townHere(world, player);
        const res = { ok: true, why: '', cost: C.foundPrice, licence: C.licence, town };
        if (!town) return { ...res, ok: false, why: 'Stand in a town to found a courier house there.' };
        if (this.playerHouse(world)) return { ...res, ok: false, why: 'You already own a courier house.' };
        const ch = this.charter(world, town.kingdomId);
        if (ch) return { ...res, ok: false, why: `${this.get(world, ch.courierId).name} holds the Royal Post here: no other house may carry ${this._realmName(world, town.kingdomId)}'s mail.` };
        if (town.type === 'village') return { ...res, ok: false, why: 'A village writes too few letters to keep a post house.' };
        if (_num(player.gold) < res.cost + res.licence) return { ...res, ok: false, why: `You need ${res.cost + res.licence} gold.` };
        return res;
    },

    _realmName(world, kid) {
        const k = kid && world.getKingdom ? world.getKingdom(kid) : null;
        return k ? k.name : 'the realm';
    },

    /** Found the player's courier house in the town they stand in. */
    found(player, world, opts = {}) {
        const q = this.foundQuote(player, world);
        if (!q.ok) return { success: false, reason: q.why };
        const name = String(opts.name || `${player.lastName || player.name || 'Your'} Post`).slice(0, 40);
        this._gold(player, 'courierCapital', -q.cost);
        this._gold(player, 'courierCapital', -q.licence);
        const k = q.town.kingdomId && world.getKingdom ? world.getKingdom(q.town.kingdomId) : null;
        if (k) {
            k.treasury = _num(k.treasury) + q.licence;
            CrownBooks.note(k, 'sales', q.licence); // a licence sold
        }
        const c = this._make(world, q.town, { owner: 'player', name, ownerName: player.name || 'you', riders: 2, horses: 1, reputation: 45, price: this.config().price.base, icon: '📮' });
        this._news(world, `${player.name || 'A newcomer'} founds ${c.name} at ${q.town.name}.`, '📮');
        return { success: true, courier: c, text: `${c.name} opens its doors at ${q.town.name}: two riders and a horse. Open stations in other towns to carry their mail.` };
    },

    /** Towns the player's house could open a station in: [{ town, dist, cost, ok, why, servers }]. */
    stationOptions(world, player) {
        const c = this.playerHouse(world);
        if (!c) return [];
        const C = this.config();
        const out = [];
        for (const t of this.towns(world).values()) {
            if (this.hasStation(c, t.key) || t.type === 'village') continue;
            const dist = c.stations.reduce((m, s) => Math.min(m, _dist(world, s, t)), Infinity);
            if (dist > C.npc.expandRange + 6) continue;
            let ok = true;
            let why = '';
            if (this.barred(world, c, t.kingdomId)) { ok = false; why = `${this.get(world, this.charter(world, t.kingdomId).courierId).name} holds the Royal Post in ${this._realmName(world, t.kingdomId)}.`; }
            else if (_num(player.gold) < C.costs.stationPrice) { ok = false; why = `You need ${C.costs.stationPrice} gold.`; }
            out.push({ town: t, dist, cost: C.costs.stationPrice, ok, why, servers: this.alive(world).filter(o => this.hasStation(o, t.key)).map(o => o.name), demand: this.demand(t) });
        }
        return out.sort((a, b) => a.dist - b.dist || a.town.name.localeCompare(b.town.name)).slice(0, 12);
    },

    openStation(player, world, key) {
        const c = this.playerHouse(world);
        if (!c) return { success: false, reason: 'You own no courier house.' };
        const opt = this.stationOptions(world, player).find(o => o.town.key === key);
        if (!opt) return { success: false, reason: 'Your riders cannot reach that town from your stations.' };
        if (!opt.ok) return { success: false, reason: opt.why };
        this._gold(player, 'courierCapital', -opt.cost);
        this._addStation(c, opt.town);
        return { success: true, text: `${c.name} opens a station at ${opt.town.name}.` };
    },

    closeStation(player, world, key) {
        const c = this.playerHouse(world);
        if (!c) return { success: false, reason: 'You own no courier house.' };
        if (key === c.home) return { success: false, reason: 'You cannot close your home station.' };
        const s = c.stations.find(x => x.key === key);
        if (!s) return { success: false, reason: 'No such station.' };
        c.stations = c.stations.filter(x => x !== s);
        return { success: true, text: `You close the station at ${s.name}.` };
    },

    /** Hire (n > 0) or let go (n < 0) riders, horses or guards. */
    staff(player, world, what, n) {
        const c = this.playerHouse(world);
        if (!c) return { success: false, reason: 'You own no courier house.' };
        const C = this.config().costs;
        const spec = { riders: [C.riderHire, C.maxRiders, 'rider'], horses: [C.horsePrice, C.maxHorses, 'relay horse'], guards: [C.guardHire, C.maxGuards, 'guard'] }[what];
        if (!spec) return { success: false, reason: 'Unknown.' };
        n = Math.round(_num(n));
        if (!n) return { success: false, reason: 'Nothing to do.' };
        const [price, max, word] = spec;
        if (n > 0) {
            if (_num(c[what]) + n > max) return { success: false, reason: `At most ${max}.` };
            const cost = price * n;
            if (_num(player.gold) < cost) return { success: false, reason: `You need ${cost} gold.` };
            this._gold(player, what === 'horses' ? 'courierCapital' : 'courierCosts', -cost);
            c[what] = _num(c[what]) + n;
            return { success: true, text: `+${n} ${word}${n === 1 ? '' : 's'} (${cost} gold).` };
        }
        const m = Math.min(-n, _num(c[what]));
        if (!m) return { success: false, reason: `You have no ${word}s to spare.` };
        c[what] -= m;
        if (what === 'horses') {
            const back = Math.round(price * 0.5 * m);
            this._gold(player, 'courierCapital', back);
            return { success: true, text: `${m} relay horse${m === 1 ? '' : 's'} sold for ${back} gold.` };
        }
        return { success: true, text: `${m} ${word}${m === 1 ? '' : 's'} let go.` };
    },

    setPrice(player, world, price) {
        const c = this.playerHouse(world);
        if (!c) return { success: false, reason: 'You own no courier house.' };
        const P = this.config().price;
        c.price = Math.round(_clamp(_num(price, c.price), P.min, P.max) * 10) / 10;
        return { success: true, text: `Postage at ${c.name}: ${c.price} gold a letter (before distance).` };
    },

    setSpeed(player, world, speed) {
        const c = this.playerHouse(world);
        if (!c) return { success: false, reason: 'You own no courier house.' };
        if (!this.config().speeds[speed]) return { success: false, reason: 'Unknown pace.' };
        c.speed = speed;
        const S = this.speed(speed);
        const need = S.horsesPerStation ? c.stations.length * S.horsesPerStation : 0;
        return { success: true, text: `${c.name} rides as ${S.name}${need > c.horses ? ` — but it needs ${need} relay horses to keep the pace (you have ${c.horses})` : ''}.` };
    },

    /** The player's bid for a realm's Royal Post: { ok, why, cost, chance, holder }. */
    bidQuote(player, world, kingdomId) {
        const C = this.config().charter;
        const c = this.playerHouse(world);
        const k = kingdomId && world.getKingdom ? world.getKingdom(kingdomId) : null;
        const ch = this.charter(world, kingdomId);
        const holder = ch ? this.get(world, ch.courierId) : null;
        const res = { ok: true, why: '', cost: C.playerBid, chance: 0, holder: holder ? holder.name : null };
        if (!c) return { ...res, ok: false, why: 'You own no courier house.' };
        if (!k || k.isAlive === false || !k.lord) return { ...res, ok: false, why: 'No crown to petition.' };
        if (holder && holder.id === c.id) return { ...res, ok: false, why: 'You already hold it.' };
        const ruled = Throne.ruledKingdom(player, world);
        if (ruled && ruled.id === kingdomId) return { ...res, ok: false, why: 'You rule here: grant it yourself.' };
        const n = this.stationsIn(c, kingdomId);
        const regard = NPCLords.getLordOpinion(k.lord, player, world) + _num(player.reputation && player.reputation[kingdomId]);
        res.chance = Math.round(_clamp(0.25 + regard / 100 + (_num(c.reputation, 50) - 50) / 100 + (n - C.playerMinStations) * 0.05 - (holder ? 0.2 : 0), 0.05, 0.9) * 100) / 100;
        const st = this.state(world);
        const last = st.bids[`${kingdomId}`];
        if (n < C.playerMinStations) return { ...res, ok: false, why: `You need ${C.playerMinStations} stations in ${k.name} (you have ${n}).` };
        if (last != null && _day(world) - last < C.bidCooldown) return { ...res, ok: false, why: `The crown heard your petition lately (again after day ${last + C.bidCooldown}).` };
        if (_num(player.gold) < res.cost) return { ...res, ok: false, why: `You need ${res.cost} gold for the petition and the clerks.` };
        return res;
    },

    bidCharter(player, world, kingdomId) {
        const q = this.bidQuote(player, world, kingdomId);
        if (!q.ok) return { success: false, reason: q.why };
        const k = world.getKingdom(kingdomId);
        this._gold(player, 'royalPost', -q.cost);
        k.treasury = _num(k.treasury) + q.cost;
        CrownBooks.note(k, 'sales', q.cost); // the petition and the clerks
        this.state(world).bids[kingdomId] = _day(world);
        const c = this.playerHouse(world);
        if (Utils.random() < q.chance) {
            this.grant(world, kingdomId, c.id, 'petition');
            return { success: true, won: true, text: `${k.name} grants ${c.name} the Royal Post: all of the realm's mail is yours to carry, for a weekly fee to the crown.` };
        }
        return { success: true, won: false, text: `The crown of ${k.name} takes your ${q.cost} gold and your petition, and grants nothing.` };
    },

    /** Houses and charters as the panel shows them. */
    view(world, player) {
        const here = this.townHere(world, player);
        const ruled = player ? Throne.ruledKingdom(player, world) : null;
        const mine = this.playerHouse(world);
        const st = this.state(world);
        const row = (c) => ({
            id: c.id, name: c.name, icon: c.icon || '✉️', owner: c.owner, ownerName: c.ownerName, homeName: c.homeName,
            stations: c.stations.map(s => s.name), stationKeys: c.stations.map(s => s.key), riders: c.riders, horses: c.horses, guards: c.guards,
            speed: c.speed, speedName: this.speed(c.speed).name, price: c.price, reputation: Math.round(_num(c.reputation)), reliability: this.reliability(c),
            cash: Math.round(_num(c.cash)), last: c.history[0] || null, history: c.history.slice(),
            charters: Object.values(st.charters).filter(ch => ch && ch.courierId === c.id).map(ch => this._realmName(world, ch.kingdomId)),
        });
        return {
            here: here ? { ...here, couriers: this.servingAt(world, here.key, here.kingdomId).map(row), charter: this.charter(world, here.kingdomId) } : null,
            mine: mine ? row(mine) : null,
            all: this.alive(world).map(row),
            charters: Object.values(st.charters).filter(Boolean).map(ch => ({ ...ch, realm: this._realmName(world, ch.kingdomId), holder: (this.get(world, ch.courierId) || {}).name || '?' })),
            ruled: ruled ? { id: ruled.id, name: ruled.name, holder: st.charters[ruled.id] ? (this.get(world, st.charters[ruled.id].courierId) || {}).name : null, holderId: st.charters[ruled.id] ? st.charters[ruled.id].courierId : null } : null,
            news: st.news.slice(0, 10),
        };
    },
};
