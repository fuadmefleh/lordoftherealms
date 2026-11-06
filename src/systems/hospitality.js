// ============================================
// HOSPITALITY — guest houses, inns, grand hotels and roadhouses
// ============================================
// Every town has its houses of hospitality, kept by its people:
//   guest_house — a bed & breakfast: a few rooms in a family home, breakfast included
//   inn         — the coaching inn: a common room, private rooms, meals, a bath, stabling
//   hotel       — the grand hotel of a city: suites, fine dining, a bathhouse, a valet
//   roadhouse   — a wayside house on the open road between towns (the realm's motels)
// Which houses a town has is a hash of its name and size (`kindsFor`, pure, so
// the inner map lays out their buildings before the world state exists); the
// roadhouses are a hash of the road tiles. NPC houses are created lazily the
// first time anyone asks (`townHouses`, `roadhouseAt`) and kept on
// world.hospitality (saved world-side):
//
//   house = { id, kind, q, r, town, name, keeper, keeperUid, stars, rep (0..100),
//             priceMult, rooms, guests (last night), cash, history: [occupancy %] }
//
// The player builds their own as properties (data/playerEconomy.json GUEST_HOUSE,
// INN, HOTEL, ROADHOUSE). Their state lives on the property (`property.hosp`:
// staff, price, cleanliness, reputation, the day's guests and takings) and
// `runProperty` — called from PlayerEconomy.produceGoods like the tavern — fills
// it each day: the town's travellers (its size, roads, season, war) split among
// all its houses by stars, price and reputation, so the player's house competes
// with the NPCs' for the same guests. Takings and costs go to the Ledger
// (hospitality / hospitalityCosts); a weekly event (theft, a brawl, a lord's
// retinue, a chronicler, bedbugs, a regular) moves its reputation.
//
// Staying: `quote` / `book` a room tier (common room, private room, suite) —
// the night's rest is an inn's (player._restTypeOverride = 'inn', so ailments
// and needs treat it as one) and `processDay` applies the morning: comfort and
// cleanliness by tier and stars, breakfast, a stabled horse's extra hex, and in
// a common room a chance of a lighter purse. `buyService` sells suppers, baths,
// laundry, a valet, fine dining. Fame's free room and meal (systems/fame.js)
// hold at the NPC houses as at the tavern.
//
// All rolls are hashes of the world seed, the day and the house (no draws on
// the shared RNG). World / player are passed in; no import-time effects.
// Content and tuning in data/hospitality.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Ledger } from './ledger.js';
import { Fame } from './fame.js';
import { FoodSkills } from './foodSkills.js';
import { PracticeSkills } from './practiceSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;

/** FNV-1a: a stable unsigned hash of a string. */
function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A uniform [0, 1) from a string. */
function _u(str) {
    return _hash(str) / 4294967296;
}

/** A small deterministic stream from a string. */
function _stream(str) {
    let s = _hash(str) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _pick(arr, u) {
    return arr && arr.length ? arr[Math.floor(u * arr.length) % arr.length] : '';
}

const KINDS = ['guest_house', 'inn', 'hotel', 'roadhouse'];

let _cfgSrc;
let _cfg = null;

export const Hospitality = {

    KINDS,

    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.hospitality) || {};
    },

    config() {
        const d = this.data().config || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = {
                enabled: o.enabled !== false,
                weekDays: _num(o.weekDays, 7),
                firstDay: _num(o.firstDay, 2),
                kinds: o.kinds || {},
                towns: o.towns || {},
                tiers: o.tiers || {},
                services: o.services || {},
                starsComfort: _num(o.starsComfort, 4),
                theftLoss: Array.isArray(o.theftLoss) ? o.theftLoss : [0.04, 0.12],
                theftMax: _num(o.theftMax, 60),
                demand: { perPop: 0.006, type: {}, min: 2, max: 70, road: 1.15, war: 0.75, season: {}, waysideBase: 3, waysidePerRoad: 0.8, elasticity: 1.3, starsWeight: 1.2, ...(o.demand || {}) },
                wayside: { chance: 0.35, minFromTown: 2, spacing: 4, max: 40, ...(o.wayside || {}) },
                npc: { priceStep: 0.05, priceMin: 0.6, priceMax: 1.8, fullAt: 0.85, emptyAt: 0.4, starsDrift: 0.15, repDrift: 0.15, maxHistory: 8, ...(o.npc || {}) },
                player: { priceSteps: [0.6, 0.8, 1, 1.25, 1.5, 2], staff: {}, dirtPerGuest: 1.6, cleanStars: 0.8, levelStars: 0.3, repDaily: 0.04, ownerStaysFree: true, events: {}, ...(o.player || {}) },
                maxNews: _num(o.maxNews, 20),
            };
        }
        return _cfg;
    },

    enabled() {
        return this.config().enabled;
    },

    /** Is this a hospitality kind (also a property type id)? */
    isKind(type) {
        return KINDS.includes(String(type || '').replace(/^player_/, ''));
    },

    kind(id) {
        return this.config().kinds[id] || null;
    },

    tier(id) {
        return this.config().tiers[id] || null;
    },

    service(id) {
        return this.config().services[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return { v: 1, houses: {}, towns: {}, wayside: null, news: [], lastWeekDay: null };
    },

    state(world) {
        if (!world) return this._blank();
        let st = world.hospitality;
        if (!st || typeof st !== 'object') {
            world.hospitality = this._blank();
            return world.hospitality;
        }
        const blank = this._blank();
        for (const k of Object.keys(blank)) if (st[k] === undefined) st[k] = blank[k];
        if (!st.houses || typeof st.houses !== 'object') st.houses = {};
        if (!st.towns || typeof st.towns !== 'object') st.towns = {};
        if (!Array.isArray(st.news)) st.news = [];
        return st;
    },

    serialize(world) {
        return world && world.hospitality ? JSON.parse(JSON.stringify(world.hospitality)) : null;
    },

    /** Older saves: none — the houses are founded again from the same hashes. */
    restore(saved, world) {
        if (!world) return;
        world.hospitality = saved && typeof saved === 'object' ? JSON.parse(JSON.stringify(saved)) : this._blank();
        this.state(world);
    },

    // ──────────── WHICH HOUSES A TOWN HAS ────────────

    /**
     * The kinds of house a settlement keeps, in order (pure: a hash of its
     * name and type, so the inner map can lay out their buildings without
     * the world state).
     */
    kindsFor(settlement) {
        if (!settlement || !this.enabled()) return [];
        const type = settlement.type || 'village';
        const plan = this.config().towns[type] || [];
        const out = [];
        plan.forEach((p, i) => {
            if (!p || !this.kind(p.kind)) return;
            if (_u(`${settlement.name || ''}|${type}|hosp|${i}`) < _num(p.chance, 1)) out.push(p.kind);
        });
        return out;
    },

    _keeperName(seedStr) {
        const K = (this.data().names || {}).keepers || {};
        return `${_pick(K.first || ['Marla'], _u(`${seedStr}|kf`))} ${_pick(K.last || ['Brewer'], _u(`${seedStr}|kl`))}`;
    },

    /** 'female' or 'male' for a keeper's name (data/hospitality.json names.keepers.female). */
    keeperGender(name) {
        const K = (this.data().names || {}).keepers || {};
        const first = String(name || '').split(' ')[0];
        return (K.female || []).includes(first) ? 'female' : 'male';
    },

    /** A house name for a kind: {adj} {noun} {noun2} {keeper} filled from data/hospitality.json names. */
    makeName(kind, seedStr, keeper) {
        const N = (this.data().names || {})[kind] || {};
        const pattern = _pick(N.patterns || ['The {noun}'], _u(`${seedStr}|p`));
        const first = String(keeper || '').split(' ')[0] || 'Old';
        return pattern
            .replace('{adj}', _pick(N.adj || ['Old'], _u(`${seedStr}|a`)))
            .replace('{noun2}', _pick(N.noun2 || N.noun || ['Rest'], _u(`${seedStr}|n2`)))
            .replace('{noun}', _pick(N.noun || ['Rest'], _u(`${seedStr}|n`)))
            .replace('{keeper}', first);
    },

    _newHouse(world, kind, q, r, idx, townName, wayside = false) {
        const K = this.kind(kind);
        const id = wayside ? `w:${q},${r}` : `h:${q},${r}:${idx}`;
        const s = `${_seed(world)}|${id}`;
        const keeper = this._keeperName(s);
        const [s0, s1] = K.stars || [2, 3];
        const [r0, r1] = K.rooms || [4, 8];
        return {
            id, kind, q, r,
            town: townName || null,
            name: this.makeName(kind, s, keeper),
            keeper,
            keeperUid: null,
            kv: 1,
            stars: Math.round((s0 + (s1 - s0) * _u(`${s}|stars`)) * 10) / 10,
            rep: Math.round(40 + 30 * _u(`${s}|rep`)),
            priceMult: Math.round((0.9 + 0.25 * _u(`${s}|price`)) * 100) / 100,
            rooms: Math.round(r0 + (r1 - r0) * _u(`${s}|rooms`)),
            guests: 0,
            cash: Math.round(150 + 250 * _u(`${s}|cash`)),
            foundedDay: _day(world),
            history: [],
        };
    },

    /** The NPC houses of the town at (q, r), founded on first asking. */
    townHouses(world, q, r) {
        if (!world || !this.enabled() || typeof world.getTile !== 'function') return [];
        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return [];
        const st = this.state(world);
        const key = _key(q, r);
        const kinds = this.kindsFor(tile.settlement);
        let ids = st.towns[key];
        if (!Array.isArray(ids)) ids = st.towns[key] = [];
        // A town grown into a city opens the houses its new size brings
        kinds.forEach((kind, i) => {
            const id = `h:${key}:${i}`;
            if (!st.houses[id]) {
                st.houses[id] = this._newHouse(world, kind, q, r, i, tile.settlement.name);
                ids.push(id);
            } else {
                this._mendKeeperName(world, st.houses[id]);
                if (!ids.includes(id)) ids.push(id);
            }
        });
        return ids.map(id => st.houses[id]).filter(Boolean);
    },

    /** Road tiles that keep a roadhouse (a hash of the roads, computed once). */
    _waysideSites(world) {
        const st = this.state(world);
        if (Array.isArray(st.wayside)) return st.wayside;
        const W = this.config().wayside;
        const sites = [];
        st.wayside = sites;
        if (!world || !Array.isArray(world.tiles) || !this.kind('roadhouse')) return sites;
        const towns = typeof world.getSettlementViews === 'function' ? (world.getSettlementViews() || []) : [];
        const width = world.width || 0;
        const seed = _seed(world);
        for (let r = 0; r < (world.height || world.tiles.length); r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < row.length; q++) {
                const t = row[q];
                if (!t || !t.hasRoad || t.settlement || (t.terrain && t.terrain.passable === false)) continue;
                if (_u(`${seed}|wayside|${q},${r}`) >= W.chance) continue;
                if (towns.some(s => Hex.wrappingDistance(q, r, s.q, s.r, width) < W.minFromTown)) continue;
                if (sites.some(x => Hex.wrappingDistance(q, r, x.q, x.r, width) < W.spacing)) continue;
                sites.push({ q, r });
                if (sites.length >= W.max) return sites;
            }
        }
        return sites;
    },

    /** The NPC roadhouse on the road at (q, r), or null. */
    roadhouseAt(world, q, r) {
        if (!world || !this.enabled()) return null;
        const id = `w:${q},${r}`;
        const st = this.state(world);
        if (st.houses[id]) return st.houses[id];
        if (!this._waysideSites(world).some(s => s.q === q && s.r === r)) return null;
        st.houses[id] = this._newHouse(world, 'roadhouse', q, r, 0, null, true);
        return st.houses[id];
    },

    /** Every NPC house known (created) so far. */
    allHouses(world) {
        return Object.values(this.state(world).houses);
    },

    // ──────────── THE PLAYER'S HOUSES ────────────

    /** The player's hospitality properties on a tile. */
    _playerPropsAt(world, q, r) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!tile) return [];
        const props = tile.playerProperties && tile.playerProperties.length ? tile.playerProperties : (tile.playerProperty ? [tile.playerProperty] : []);
        return props.filter(p => p && this.isKind(p.type));
    },

    /** The property's hospitality record, created on first use. */
    hosp(property, player = null) {
        if (!property) return null;
        if (!property.hosp || typeof property.hosp !== 'object') {
            const staff = {};
            for (const k of Object.keys(this.config().player.staff || {})) staff[k] = 0;
            property.hosp = { rep: 45, priceMult: 1, staff, clean: 90, guests: 0, takings: 0, costs: 0, week: { nights: 0, guests: 0, takings: 0, costs: 0 }, history: [], notices: [], named: false };
        }
        const h = property.hosp;
        if (!h.staff || typeof h.staff !== 'object') h.staff = {};
        if (!Array.isArray(h.history)) h.history = [];
        if (!Array.isArray(h.notices)) h.notices = [];
        if (!h.week || typeof h.week !== 'object') h.week = { nights: 0, guests: 0, takings: 0, costs: 0 };
        if (!h.named && player) {
            const kind = String(property.type);
            const owner = (player.name || 'Your').split(' ')[0];
            property.name = this.makeName(kind, `${kind}|${property.cost || 0}|${owner}`, owner);
            h.named = true;
        }
        return h;
    },

    /** Stars of a player's house: its kind, its level, its staff and how clean it is kept. */
    playerStars(property) {
        const K = this.kind(property.type) || {};
        const P = this.config().player;
        const h = this.hosp(property);
        let stars = _num((K.stars || [2])[0], 2) + P.levelStars * (_num(property.level, 1) - 1);
        for (const [k, def] of Object.entries(P.staff || {})) stars += _num(def.stars) * Math.min(_num(h.staff[k]), _num(def.max, 9));
        stars -= P.cleanStars * 2 * (1 - _clamp(_num(h.clean, 80), 0, 100) / 100);
        return Math.round(_clamp(stars, 1, 5) * 10) / 10;
    },

    playerRooms(property) {
        const K = this.kind(property.type) || {};
        const [r0, r1] = K.rooms || [4, 8];
        return Math.round(r0 + (r1 - r0) * (_clamp(_num(property.level, 1), 1, 5) - 1) / 4);
    },

    /** A uniform view of a house, NPC or the player's: what the panels and the inner map read. */
    view(world, house) {
        if (!house) return null;
        if (house._prop) return house;
        const K = this.kind(house.kind) || {};
        return {
            id: house.id, kind: house.kind, kindName: K.name || 'Lodgings', icon: K.icon || '🛏️', q: house.q, r: house.r,
            name: house.name, keeper: house.keeper, keeperTitle: K.keeperTitle || 'Keeper', owner: 'npc',
            stars: house.stars, rep: house.rep, priceMult: house.priceMult, rooms: house.rooms,
            guests: house.guests, tiers: (K.tiers || []).slice(), services: (K.services || []).slice(),
            breakfastIncluded: !!K.breakfastIncluded, blurb: K.blurb || '', history: house.history || [],
        };
    },

    _playerView(world, player, property, q, r) {
        const K = this.kind(property.type) || {};
        const h = this.hosp(property, player);
        return {
            id: `p:${q},${r}:${property.type}`, kind: property.type, kindName: K.name || 'Lodgings', icon: K.icon || '🛏️', q, r,
            name: property.name, keeper: player && player.name ? player.name : 'you', keeperTitle: 'Owner', owner: 'player',
            stars: this.playerStars(property), rep: Math.round(h.rep), priceMult: h.priceMult, rooms: this.playerRooms(property),
            guests: h.guests, tiers: (K.tiers || []).slice(), services: (K.services || []).slice(),
            breakfastIncluded: !!K.breakfastIncluded, blurb: K.blurb || '', history: h.history,
            underConstruction: !!property.underConstruction, _prop: property,
        };
    },

    /** Every house at (q, r) — the town's or the road's, and the player's — as views. */
    listAt(world, player, q, r) {
        if (!world || !this.enabled()) return [];
        const out = [];
        for (const h of this.townHouses(world, q, r)) out.push(this.view(world, h));
        const rh = this.roadhouseAt(world, q, r);
        if (rh) out.push(this.view(world, rh));
        for (const p of this._playerPropsAt(world, q, r)) out.push(this._playerView(world, player, p, q, r));
        return out;
    },

    /** One house by id (NPC: 'h:…' / 'w:…'; the player's: 'p:q,r:type'), as a view. */
    get(world, player, id) {
        if (!world || !id) return null;
        const m = /^p:(-?\d+),(-?\d+):(\w+)$/.exec(String(id));
        if (m) {
            const q = Number(m[1]), r = Number(m[2]);
            const prop = this._playerPropsAt(world, q, r).find(p => p.type === m[3]);
            return prop ? this._playerView(world, player, prop, q, r) : null;
        }
        const h = this.state(world).houses[id];
        return h ? this.view(world, h) : null;
    },

    /**
     * Tie an NPC house's keeper to a living townsperson (the inner map's keeper
     * NPC). The first townsperson bound takes the keeper's name (the inner map
     * renames them to it), so the keeper is named as before; a later one — the
     * first keeper dead or gone — keeps the house under their own name.
     */
    bindKeeper(world, id, uid, name) {
        const h = this.state(world).houses[id];
        if (!h || !uid) return;
        if (h.keeperUid === uid) return;
        const successor = !!h.keeperUid;
        h.keeperUid = uid;
        if (name && (successor || !h.keeper)) h.keeper = name;
    },

    /**
     * A house from an older save whose keeper was renamed to a townsperson's
     * when first bound: its name, still made from the first keeper's name,
     * takes the keeper's it has now — once, so a later keeper never renames it.
     */
    _mendKeeperName(world, h) {
        if (!h || h.kv) return;
        h.kv = 1;
        if (!h.keeperUid || !h.keeper) return;
        const s = `${_seed(world)}|${h.id}`;
        const first = this._keeperName(s);
        if (h.keeper === first || h.name !== this.makeName(h.kind, s, first)) return;
        h.name = this.makeName(h.kind, s, h.keeper);
    },

    // ──────────── GUESTS ────────────

    /** Travellers wanting a bed at (q, r) tonight. */
    demand(world, q, r) {
        const D = this.config().demand;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!tile) return 0;
        const season = _num(D.season[world.season], 1);
        if (!tile.settlement) {
            let roads = 0;
            for (const n of Hex.neighbors(q, r)) {
                const t = world.getTile(n.q, n.r);
                if (t && (t.hasRoad || t.settlement)) roads++;
            }
            return Math.max(1, (D.waysideBase + D.waysidePerRoad * roads) * season);
        }
        const s = tile.settlement;
        let d = _num(s.population, 300) * D.perPop * _num(D.type[s.type || 'village'], 1);
        d = _clamp(d, D.min, D.max);
        if (tile.hasRoad) d *= D.road;
        const k = s.kingdom && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
        if (k && Array.isArray(k.wars) && k.wars.length) d *= D.war;
        return d * season;
    },

    _appeal(kind, stars, priceMult, rep) {
        const D = this.config().demand;
        const K = this.kind(kind) || {};
        return _num(K.appeal, 1) * Math.pow(Math.max(0.5, stars), D.starsWeight)
            * Math.pow(1 / Math.max(0.3, priceMult), D.elasticity) * (0.5 + _clamp(rep, 0, 100) / 100);
    },

    /**
     * Tonight's guests at every house at (q, r): { [id]: guests }. The
     * travellers split by appeal; a hotel only draws the wealthy share.
     */
    occupancy(world, player, q, r) {
        const houses = this.listAt(world, player, q, r).filter(v => !v.underConstruction);
        const out = {};
        if (!houses.length) return out;
        const demand = this.demand(world, q, r);
        const appeal = houses.map(v => this._appeal(v.kind, v.stars, v.priceMult, v.rep));
        const total = appeal.reduce((a, b) => a + b, 0) || 1;
        const D = this.config().demand;
        houses.forEach((v, i) => {
            const K = this.kind(v.kind) || {};
            // Dear rooms turn travellers away altogether (they sleep rough, push on,
            // lodge with kin), not just to the house next door: without this every
            // town's houses sat full and their prices climbed to the cap for good
            const deter = Math.min(1, Math.pow(1 / Math.max(0.3, _num(v.priceMult, 1)), _num(D.priceDemand, 0)));
            let g = demand * appeal[i] / total * deter;
            if (K.wealthyShare) g = Math.min(g, demand * K.wealthyShare);
            out[v.id] = Math.min(v.rooms, Math.round(g));
        });
        return out;
    },

    /** Average takings per guest-night: the room mix at its price, plus what they spend. */
    revenuePerGuest(kind, stars, priceMult) {
        const K = this.kind(kind) || {};
        const tiers = K.tiers || ['private'];
        const T = this.config().tiers;
        const mix = tiers.length === 1 ? [1] : tiers.includes('common') ? [0.6, 0.4] : [0.8, 0.2];
        let room = 0;
        tiers.forEach((t, i) => { room += _num((T[t] || {}).price, 8) * mix[i]; });
        return room * priceMult * this._starsPrice(stars) + _num(K.spendPerGuest, 2) * (0.6 + 0.15 * stars);
    },

    _starsPrice(stars) {
        return 0.7 + 0.15 * _clamp(_num(stars, 2), 1, 5);
    },

    // ──────────── STAYING ────────────

    /** The price of a tier at a house for this player (0 when it is their own, or Fame's free room). */
    roomPrice(world, player, view, tierId) {
        const T = this.tier(tierId);
        if (!T || !view) return null;
        if (view.owner === 'player' && this.config().player.ownerStaysFree) return 0;
        return Math.max(1, Math.round(_num(T.price, 8) * _num(view.priceMult, 1) * this._starsPrice(view.stars)));
    },

    servicePrice(view, serviceId) {
        const S = this.service(serviceId);
        if (!S || !view) return null;
        if (view.owner === 'player') return 0;
        return Math.max(1, Math.round(_num(S.price, 4) * _num(view.priceMult, 1) * this._starsPrice(view.stars)));
    },

    _fameTile(world, view) {
        return world && typeof world.getTile === 'function' ? world.getTile(view.q, view.r) : null;
    },

    /** Whether tonight's rooms are all taken (only ever at a near-full NPC house). */
    noVacancy(world, view) {
        if (!view || view.owner === 'player') return false;
        if (!view.rooms || view.guests < view.rooms) return false;
        return _u(`${_seed(world)}|${_day(world)}|${view.id}|full`) < 0.5;
    },

    /**
     * What a house offers this player now: its rooms (with prices and why one
     * can't be taken) and its services.
     */
    quote(world, player, id) {
        const v = this.get(world, player, id);
        if (!v) return null;
        const gold = _num(player && player.gold);
        const tile = this._fameTile(world, v);
        const freeRoom = v.owner === 'npc' && Fame.innFree(player, world, tile, 'room');
        const freeMeal = v.owner === 'npc' && Fame.innFree(player, world, tile, 'meal');
        const full = this.noVacancy(world, v);
        const booked = !!(player && player.lodging && player.lodging.night === _day(world));
        const bookedHere = booked && player.lodging.id === v.id;
        // A full house still lets its best room — the suite at a hotel, the private room at an inn
        const best = v.tiers[v.tiers.length - 1];
        const tiers = v.tiers.map(t => {
            const T = this.tier(t) || {};
            const price = freeRoom ? 0 : this.roomPrice(world, player, v, t);
            let reason = null;
            if (v.underConstruction) reason = 'Still being built';
            else if (booked) reason = 'You already have a bed for tonight';
            else if (full && t !== best) reason = 'No vacancy tonight';
            else if (gold < price) reason = `Need ${price} gold`;
            return { id: t, name: T.name || t, short: T.short || t, icon: T.icon || '🛏️', price, free: freeRoom || price === 0, ok: !reason, reason };
        });
        const services = v.services.map(sid => {
            const S = this.service(sid) || {};
            const meal = !!(S.needs && S.needs.hunger) && !S.morning;
            const price = meal && freeMeal ? 0 : this.servicePrice(v, sid);
            let reason = null;
            if (v.underConstruction) reason = 'Still being built';
            else if (S.morning && !bookedHere) reason = 'For guests staying the night';
            else if (S.needsMount && !(player && player.mount)) reason = 'You have no horse';
            else if (S.morning && player.lodging && (player.lodging.services || []).includes(sid)) reason = 'Already arranged';
            else if (gold < price) reason = `Need ${price} gold`;
            return { id: sid, name: S.name || sid, icon: S.icon || '🛎️', price, free: price === 0, ok: !reason, reason, morning: !!S.morning };
        });
        return { house: v, tiers, services, freeRoom, full, booked, bookedHere };
    },

    /**
     * Take a room for tonight. The night's rest is an inn's; the morning's
     * comfort, breakfast and the rest come in `processDay`.
     */
    book(world, player, id, tierId) {
        const q = this.quote(world, player, id);
        if (!q) return { ok: false, text: 'There is no such house.' };
        const t = q.tiers.find(x => x.id === tierId);
        if (!t) return { ok: false, text: 'They have no such room.' };
        if (!t.ok) return { ok: false, text: t.reason };
        const v = q.house;
        if (t.price > 0) {
            player.gold -= t.price;
            Ledger.record(player, 'lodging', -t.price);
        }
        if (q.freeRoom) Fame.claimInn(player, world, this._fameTile(world, v), 'room');
        player._restTypeOverride = 'inn';
        player.lodging = { id: v.id, name: v.name, kind: v.kind, tier: tierId, stars: v.stars, night: _day(world), services: [], own: v.owner === 'player' };
        // A little of the comfort at once — the rest when you wake
        if (player.modifyNeed) player.modifyNeed('comfort', 6);
        const T = this.tier(tierId) || {};
        const text = q.freeRoom ? `${v.keeper} will hear nothing of payment: ${T.name ? T.name.toLowerCase() : 'a room'} at ${v.name}, on the house.`
            : v.owner === 'player' ? `You take ${T.name ? T.name.toLowerCase() : 'a room'} in your own ${this.kind(v.kind).noun}.`
                : `You take ${T.name ? T.name.toLowerCase() : 'a room'} at ${v.name} for ${t.price} gold.`;
        return { ok: true, text, cost: t.price };
    },

    /**
     * Buy a service: meals, baths, laundry and the valet act now; breakfast
     * and stabling are arranged for the morning. Returns { ok, text, item }
     * — `item` ({ id, qty }) is for the caller to pack (the inventory cap is
     * the player layer's).
     */
    buyService(world, player, id, serviceId) {
        const q = this.quote(world, player, id);
        if (!q) return { ok: false, text: 'There is no such house.' };
        const s = q.services.find(x => x.id === serviceId);
        if (!s) return { ok: false, text: 'They offer no such thing.' };
        if (!s.ok) return { ok: false, text: s.reason };
        const S = this.service(serviceId) || {};
        const v = q.house;
        if (s.price > 0) {
            player.gold -= s.price;
            Ledger.record(player, 'lodging', -s.price);
        } else if (S.needs && S.needs.hunger && v.owner === 'npc') {
            Fame.claimInn(player, world, this._fameTile(world, v), 'meal');
        }
        if (S.morning) {
            player.lodging.services.push(serviceId);
            return { ok: true, text: `${S.name} — arranged for the morning.`, cost: s.price };
        }
        // Washed clothes first, so the service's hygiene isn't capped by the dirty ones
        if (S.clothes && player.washClothes) player.washClothes(_num(S.clothes));
        const boost = 0.85 + 0.06 * _num(v.stars, 2);
        // A meal is as hearty as the cook: an NPC house's keeper's cooking level (systems/foodSkills.js)
        const cook = S.needs && S.needs.hunger && v.owner === 'npc' ? FoodSkills.innCook(v) : null;
        const fill = (need) => (cook && (need === 'hunger' || need === 'energy') ? cook.mult : 1);
        if (player.modifyNeed) for (const [need, amt] of Object.entries(S.needs || {})) player.modifyNeed(need, Math.round(amt * boost * fill(need)));
        if (S.health) player.health = Math.min(_num(player.maxHealth, 100), _num(player.health, 100) + S.health);
        // A valet's grooming: charisma for the rest of the day (PlayerEffects.moodCharisma reads it;
        // processDay takes it away the next morning)
        if (S.charisma) player.valet = { day: _day(world), charisma: _num(S.charisma) };
        const cookNote = cook && cook.level >= 4 ? ` ${v.keeper || 'The keeper'} cooks like a ${cook.levelName.toLowerCase()} (🍳 ${cook.level}): it fills you ${Math.round((cook.mult - 1) * 100)}% more.` : '';
        return { ok: true, text: `${S.icon} ${S.name} at ${v.name}${s.price > 0 ? ` (${s.price} gold)` : ''}.${cookNote}`, cost: s.price, item: S.item ? { id: S.item, qty: _num(S.qty, 1) } : null };
    },

    /** The morning after a night in a house: comfort by tier and stars, breakfast, the horse, a light-fingered bunkmate. */
    _morning(world, player) {
        const L = player && player.lodging;
        if (!L || !(L.night < _day(world))) return [];
        player.lodging = null;
        const notices = [];
        const C = this.config();
        const T = this.tier(L.tier) || {};
        const K = this.kind(L.kind) || {};
        const starsAdj = C.starsComfort * (_num(L.stars, 2) - 2.5);
        if (player.modifyNeed) {
            player.modifyNeed('comfort', Math.round(_num(T.comfort) + starsAdj));
            if (T.hygiene) player.modifyNeed('hygiene', T.hygiene);
            if (T.social) player.modifyNeed('social', T.social);
            if (T.fun) player.modifyNeed('fun', T.fun);
        }
        if (T.health) player.health = Math.min(_num(player.maxHealth, 100), _num(player.health, 100) + T.health);
        const parts = [`You wake at ${L.name}`];
        const breakfast = K.breakfastIncluded || (L.services || []).includes('breakfast');
        if (breakfast && player.modifyNeed) {
            const B = this.service('breakfast') || { needs: { hunger: 35 } };
            for (const [need, amt] of Object.entries(B.needs || {})) player.modifyNeed(need, amt);
            parts.push(K.breakfastIncluded ? 'and breakfast is on the table' : 'to a hot breakfast');
        }
        if ((L.services || []).includes('stabling') && player.mount) {
            const S = this.service('stabling') || {};
            player.movementRemaining = _num(player.movementRemaining) + _num(S.movement, 1);
            parts.push('your horse fed, groomed and eager');
        }
        notices.push({ icon: '🛏️', title: 'A Good Night', text: `${parts.join(', ')}.`, type: 'success' });
        // A bunk in the common room: a lighter purse some mornings
        const theft = _num(T.theft) * (K.wayside ? 1.4 : 1) * Math.max(0.2, 1 - 0.12 * (_num(L.stars, 2) - 1));
        if (!L.own && theft > 0 && _u(`${_seed(world)}|${_day(world)}|${L.id}|theft`) < theft && _num(player.gold) > 0) {
            const [lo, hi] = C.theftLoss;
            const share = lo + (hi - lo) * _u(`${_seed(world)}|${_day(world)}|${L.id}|loss`);
            const lost = Math.min(C.theftMax, Math.max(1, Math.round(player.gold * share)));
            player.gold -= lost;
            Ledger.record(player, 'pickpocketed', -lost);
            notices.push({ icon: '👛', title: 'Robbed in Your Sleep', text: `Someone in the common room at ${L.name} went through your things in the night: ${lost} gold gone.`, type: 'warning' });
        }
        return notices;
    },

    // ──────────── THE PLAYER'S HOUSE, DAY BY DAY ────────────

    /**
     * One day of a player's house (from PlayerEconomy.produceGoods): tonight's
     * guests against the town's other houses, takings, wages and supplies,
     * cleanliness and reputation. `upkeep` is the property's upkeep already
     * worked out by the caller. Returns { guests, takings, costs, net }.
     */
    runProperty(world, player, tile, property, upkeep = 0, incomeMult = 1) {
        const P = this.config().player;
        const K = this.kind(property.type) || {};
        const h = this.hosp(property, player);
        const view = this._playerView(world, player, property, tile.q, tile.r);
        const occ = this.occupancy(world, player, tile.q, tile.r);
        const guests = _num(occ[view.id]);
        let spendMult = 1;
        for (const [k, def] of Object.entries(P.staff || {})) spendMult += _num(def.spend) * Math.min(_num(h.staff[k]), _num(def.max, 9));
        const perGuest = this.revenuePerGuest(property.type, view.stars, h.priceMult);
        const takings = Math.round(guests * perGuest * spendMult * incomeMult);
        let wages = 0;
        for (const [k, def] of Object.entries(P.staff || {})) wages += _num(def.wage) * _num(h.staff[k]);
        const supplies = Math.round(guests * _num(K.costPerGuest, 2));
        const costs = wages + supplies;
        player.gold += takings - costs - upkeep;
        if (takings) Ledger.record(player, 'hospitality', takings);
        if (costs) Ledger.record(player, 'hospitalityCosts', -costs);
        // Guests dirty the rooms; the chambermaids put them right
        const maid = P.staff.maid || {};
        h.clean = _clamp(_num(h.clean, 80) - guests * P.dirtPerGuest + _num(maid.clean, 12) * _num(h.staff.maid) + 2, 0, 100);
        h.rep = _clamp(_num(h.rep, 45) + (view.stars * 20 - _num(h.rep, 45)) * P.repDaily, 0, 100);
        h.guests = guests;
        h.takings = takings;
        h.costs = costs;
        h.week.nights++;
        h.week.guests += guests;
        h.week.takings += takings;
        h.week.costs += costs + upkeep;
        if (h.week.nights >= this.config().weekDays) {
            h.history.push(Math.round(100 * h.week.guests / Math.max(1, h.week.nights * view.rooms)));
            if (h.history.length > this.config().npc.maxHistory) h.history.shift();
            this._playerWeekEvent(world, player, tile, property, view);
            h.lastWeek = { ...h.week };
            h.week = { nights: 0, guests: 0, takings: 0, costs: 0 };
        }
        property.todayIncome = takings - costs;
        property.storage = _num(property.storage) + Math.max(0, takings - costs);
        return { guests, takings, costs, net: takings - costs - upkeep };
    },

    /** The week's happening at a player's house: theft, a brawl, a lord's retinue, a chronicler, bedbugs, a regular. */
    _playerWeekEvent(world, player, tile, property, view) {
        const E = this.config().player.events || {};
        const h = this.hosp(property);
        const rng = _stream(`${_seed(world)}|${_day(world)}|${view.id}|week`);
        if (rng() >= _num(E.chance, 0.35)) return;
        const porter = this.config().player.staff.porter || {};
        const theftCut = 1 - _num(porter.theftCut, 0.5) * Math.min(1, _num(h.staff.porter));
        const options = [];
        for (const [id, ev] of Object.entries(E)) {
            if (!ev || typeof ev !== 'object') continue;
            if (ev.kinds && !ev.kinds.includes(property.type)) continue;
            if (ev.minStars && view.stars < ev.minStars) continue;
            if (ev.maxClean != null && h.clean > ev.maxClean) continue;
            let w = _num(ev.weight, 1);
            if (id === 'theft') w *= theftCut;
            if (w > 0) options.push([id, ev, w]);
        }
        const total = options.reduce((a, o) => a + o[2], 0);
        if (!total) return;
        let roll = rng() * total;
        const [id, ev] = options.find(o => (roll -= o[2]) < 0) || options[options.length - 1];
        let text = String(ev.text || '').replace('{house}', property.name);
        let type = 'info';
        if (id === 'brawl') {
            const [lo, hi] = ev.cost || [20, 60];
            const cost = Math.round(lo + (hi - lo) * rng());
            player.gold -= cost;
            Ledger.record(player, 'hospitalityCosts', -cost);
            text = text.replace('{cost}', cost);
            type = 'warning';
        } else if (id === 'noble') {
            const gold = Math.round(view.rooms * this.revenuePerGuest(property.type, view.stars, h.priceMult) * _num(ev.nights, 2));
            player.gold += gold;
            Ledger.record(player, 'hospitality', gold);
            text = text.replace('{gold}', gold);
            type = 'success';
        } else if (id === 'chronicler') {
            const good = view.stars >= 3;
            text = text.replace('{verdict}', good ? '"a house of rare comfort and an honest table"' : '"damp sheets, thin soup and a surly welcome"');
            h.rep = _clamp(h.rep + (good ? 6 : -6), 0, 100);
            type = good ? 'success' : 'warning';
        } else if (id === 'theft' || id === 'bedbugs') {
            type = 'warning';
        } else if (id === 'regular') {
            type = 'success';
        }
        if (ev.rep) h.rep = _clamp(h.rep + ev.rep, 0, 100);
        h.notices.push({ icon: this.kind(property.type).icon || '🏨', title: property.name, text, type });
    },

    /** Set a player's house's room price (a step of data player.priceSteps). */
    setPrice(property, mult) {
        const steps = this.config().player.priceSteps || [1];
        if (!steps.includes(mult)) return { ok: false, text: 'Not a price you can set.' };
        this.hosp(property).priceMult = mult;
        return { ok: true, text: `Rooms at ${Math.round(mult * 100)}% of the going rate.` };
    },

    /** Hire (+1) or let go (-1) one of the staff of a player's house. */
    setStaff(property, role, delta) {
        const def = (this.config().player.staff || {})[role];
        if (!def) return { ok: false, text: 'No such post.' };
        const h = this.hosp(property);
        const n = _num(h.staff[role]) + (delta > 0 ? 1 : -1);
        if (n < 0) return { ok: false, text: `You have no ${def.name.toLowerCase()} to let go.` };
        if (n > _num(def.max, 9)) return { ok: false, text: `${property.name} has no work for another ${def.name.toLowerCase()}.` };
        h.staff[role] = n;
        return { ok: true, text: delta > 0 ? `You hire a ${def.name.toLowerCase()} (${def.wage} gold a day).` : `You let a ${def.name.toLowerCase()} go.` };
    },

    /** Scrub the house top to bottom yourself: cleanliness up, energy down. */
    scrub(player, property) {
        const h = this.hosp(property);
        if (h.clean >= 95) return { ok: false, text: 'It is already spotless.' };
        h.clean = _clamp(h.clean + 30, 0, 100);
        // Endurance cuts the energy it costs, and the scrubbing is Endurance XP
        PracticeSkills.labour(player, 20);
        if (player.modifyNeed) player.modifyNeed('hygiene', -15);
        return { ok: true, text: `You roll up your sleeves and scrub ${property.name} from cellar to attic.` };
    },

    /** What a player's house made, cost and drew lately (for its panel). */
    report(world, player, tile, property) {
        const view = this._playerView(world, player, property, tile.q, tile.r);
        const h = this.hosp(property, player);
        const others = this.listAt(world, player, tile.q, tile.r).filter(v => v.id !== view.id);
        const occ = property.underConstruction ? {} : this.occupancy(world, player, tile.q, tile.r);
        return {
            view, staff: { ...h.staff }, clean: Math.round(h.clean), priceMult: h.priceMult,
            demand: Math.round(this.demand(world, tile.q, tile.r) * 10) / 10,
            forecast: _num(occ[view.id]), lastWeek: h.lastWeek || null, today: { guests: h.guests, takings: h.takings, costs: h.costs },
            rivals: others.map(v => ({ name: v.name, kind: v.kindName, stars: v.stars, priceMult: v.priceMult, guests: _num(occ[v.id]), rooms: v.rooms })),
        };
    },

    // ──────────── THE WEEK OF THE NPC HOUSES ────────────

    _npcWeek(world, player) {
        const C = this.config();
        const N = C.npc;
        const st = this.state(world);
        const byTile = new Map();
        for (const h of Object.values(st.houses)) {
            const k = _key(h.q, h.r);
            if (!byTile.has(k)) byTile.set(k, h);
        }
        for (const first of byTile.values()) {
            const occ = this.occupancy(world, player, first.q, first.r);
            for (const h of Object.values(st.houses)) {
                if (h.q !== first.q || h.r !== first.r) continue;
                const K = this.kind(h.kind) || {};
                const guests = _num(occ[h.id]);
                const rate = guests / Math.max(1, h.rooms);
                h.guests = guests;
                h.cash = Math.round(_num(h.cash) + C.weekDays * guests * (this.revenuePerGuest(h.kind, h.stars, h.priceMult) - _num(K.costPerGuest, 2)) - _num(K.weeklyCosts, 20));
                // Full houses dear, empty ones cheap
                if (rate >= N.fullAt) h.priceMult = Math.min(N.priceMax, h.priceMult + N.priceStep);
                else if (rate <= N.emptyAt) h.priceMult = Math.max(N.priceMin, h.priceMult - N.priceStep);
                h.priceMult = Math.round(h.priceMult * 100) / 100;
                // Money buys new linen; a poor house lets its rooms go
                const [s0, s1] = K.stars || [1, 5];
                const drift = (_u(`${_seed(world)}|${_day(world)}|${h.id}|drift`) - 0.5) * 2 * N.starsDrift + (h.cash > 600 ? 0.05 : h.cash < 0 ? -0.08 : 0);
                h.stars = Math.round(_clamp(h.stars + drift, Math.max(1, s0 - 0.5), Math.min(5, s1 + 0.3)) * 10) / 10;
                h.rep = Math.round(_clamp(h.rep + (h.stars * 20 - h.rep) * N.repDrift, 0, 100));
                h.history.push(Math.round(rate * 100));
                if (h.history.length > N.maxHistory) h.history.shift();
            }
        }
        st.lastWeekDay = _day(world);
    },

    // ──────────── THE DAY ────────────

    /** Each day (from the game loop): the morning after a night's lodging, the player's houses' news, the NPC houses' week. */
    processDay(world, player) {
        const notices = [];
        if (!world || !this.enabled()) return { notices };
        if (player) {
            notices.push(...this._morning(world, player));
            if (player.valet && !(_num(player.valet.day, -1) >= _day(world))) player.valet = null;
            for (const ref of player.properties || []) {
                if (!this.isKind(ref.type)) continue;
                const p = this._playerPropsAt(world, ref.q, ref.r).find(x => x.type === ref.type);
                if (p && p.hosp && p.hosp.notices && p.hosp.notices.length) notices.push(...p.hosp.notices.splice(0));
            }
        }
        const st = this.state(world);
        const C = this.config();
        const day = _day(world);
        if (day >= C.firstDay && (st.lastWeekDay == null || day - st.lastWeekDay >= C.weekDays)) this._npcWeek(world, player);
        return { notices };
    },
};
