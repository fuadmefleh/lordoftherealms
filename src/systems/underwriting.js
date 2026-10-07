// ============================================
// UNDERWRITING — insurance on ships, caravans, stock, works and crops
// ============================================
// Underwriters sell the player cover against the losses the world already
// deals out. Two kinds of office write it:
//   - the insurance desk of every banking house (systems/finance.js): its
//     premiums and claims go on the house's own reserves, so a house that
//     pays a ruinous claim (or a season of them) may face a run and fail;
//   - an underwriters' guild at the great ports, with its own capital pool
//     (picked from the map by a hash of the world seed; no RNG). A guild whose
//     capital runs out fails, its covers lapse, and its claims are paid at
//     what the receivers can find. A new one opens months later.
//
// Open cover. One standing policy per kind (data/bourse.json → underwriting.kinds):
//   marine  ships away from port, hull and cargo: storms, squadrons of a
//           hostile crown, events at sea (systems/ships.js, shipVoyages.js)
//   caravan the player's caravans on the road and the company's convoys
//           (player/playerEconomy/caravans.js, systems/merchantHouses.js)
//   stock   store-rooms and the company's posts: thieves (merchantPrince.js,
//           merchantHouses.js)
//   works   works damaged by sieges and raids, or seized by a crown in crisis
//           (a realm at war with you is a war risk: never covered)
//   crop    farms: the day's crop short of a fair-weather harvest
// Each day the cover bills a premium on what it covers that day: the expected
// loss from the same inputs the loss sites roll against (the season's storm
// chance, the squadrons near the ship and their odds, the raiders and lairs
// along a caravan's road, each store-room's theft chance, the siege at a
// works, the weather's toll on the fields), times a loading, times a
// surcharge for the player's own recent claims. So insurance is a fair bet
// that the house wins: the premium beats the expected payout, and a loss is
// covered (less the deductible) when it comes.
//
// Claims come from the loss book (systems/lossBook.js): the loss sites report
// what they took; the daily tick matches each loss with an attached cover and
// pays it. Big claims are investigated first (a few days). A false claim —
// forged protests bought through the Thieves' Guild — is always investigated
// and may be found out: a fine, heat, the cover cancelled, and the office's
// doors closed for months.
//
// Each office also writes cover for the world's other merchants (its `book`):
// a weekly premium against claims that rise with wars, blockades, pirates and
// the rare great storm, so underwriters bleed in hard times and can fail.
//
// The daily tick draws from its own seeded stream (Utils.withRng on a hash of
// the seed and the day); player actions draw no randomness. State on
// player.underwriting (saved with the player). Tuned in data/bourse.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { WorldEvents } from '../world/worldEvents.js';
import { WEATHER_EFFECTS } from '../world/weather.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Finance } from './finance.js';
import { Ships } from './ships.js';
import { MerchantHouses } from './merchantHouses.js';
import { MerchantPrince } from './merchantPrince.js';
import { OutlawLairs } from './outlawLairs.js';
import { Underworld } from './underworld.js';
import { Technology } from './technology.js';
import { MarketDynamics } from './marketDynamics.js';
import { LossBook } from './lossBook.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

function _day(world) {
    return world && Number.isFinite(world.day) ? world.day : 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _frac(key) {
    return (_hash(key) % 100000) / 100000;
}

function _between(range, f) {
    if (!Array.isArray(range)) return _num(range);
    const lo = _num(range[0]);
    return lo + (_num(range[1], lo) - lo) * f;
}

/** A small seeded stream (mulberry32) for Utils.withRng. */
export function seededStream(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _settlements(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
    return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
}

function _season(world) {
    const day = Seasons.today(world);
    return day == null ? 'Spring' : Seasons.seasonOf(day);
}

const DEFAULTS = {
    loading: 1.35, deductible: 0.1, minClaim: 5, maxClaim: 20000, claimsMemoryDays: 120,
    surchargePerClaim: 0.12, maxSurcharge: 1, unpaidDays: 3, investigateAbove: 800, investigateDays: [3, 6],
    kinds: {
        marine: {
            name: 'Hull & cargo', icon: '⛵', attachDays: 1,
            stormChance: { Spring: 0.035, Summer: 0.038, Autumn: 0.037, Winter: 0.034 },
            stormHullPct: 5.5, stormCargoChance: 0.2, stormCargoShare: 0.2, loseFightChance: 0.5, interceptHullPct: 14,
            eventHullShare: 0.15, eventHullPct: 11, eventCargoShare: 0.05, eventCargoLoss: 0.22, blockadeExtra: 0.002, pirateRadius: 8, piratePerShip: 0.002, pirateMax: 3,
        },
        caravan: { name: 'Goods on the road', icon: '🐫', attachDays: 1, base: 0.002, raiderRadius: 6, perRaider: 0.02, lairRadius: 8, perLair: 0.006, maxDaily: 0.25, convoyLoss: 0.7 },
        stock: { name: 'Stock in store', icon: '📦', attachDays: 2 },
        works: { name: 'Works & property', icon: '🏭', attachDays: 3, base: 0.0004, siegeWear: 0.03 },
        crop: { name: 'Crops in the field', icon: '🌾', attachDays: 7, experienceWeight: 0.01, seasonShortfall: { Spring: 0.008, Summer: 0.014, Autumn: 0.006, Winter: 0.024 } },
    },
    guild: { count: 2, capitalBase: 9000, capitalJitter: [0.8, 1.3], failBelow: 0.15, recovery: [0.3, 0.6], refoundDays: 90, names: ['The Underwriters of {place}'] },
    book: { bookShare: 0.12, premium: 0.022, lossRatio: 0.6, noise: 0.45, warLoss: 0.25, blockadeLoss: 0.3, pirateLoss: 0.06, maxRatio: 6, catastrophe: { chance: 0.002, loss: [0.1, 0.25], winterMult: 2 } },
    fraud: { minRank: 1, forgerFee: 0.2, maxShare: 0.5, maxAmount: 3000, caught: 0.4, perRank: 0.05, perClaim: 0.08, bigShare: 0.1, minCaught: 0.15, maxCaught: 0.9, fineMult: 1, heat: 25, banDays: 240 },
};

export const KINDS = ['marine', 'caravan', 'stock', 'works', 'crop'];

let _cfgSrc;
let _cfg = null;
// Records already backfilled this session (the daily tick skips the walk)
const _fresh = new WeakSet();

export const Underwriting = {

    // ──────────── DATA ────────────

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.bourse) || {};
    },

    config() {
        const src = _obj(Underwriting.data().underwriting);
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        const o = src || {};
        const kinds = {};
        for (const k of KINDS) kinds[k] = { ...DEFAULTS.kinds[k], ...(_obj(o.kinds) && _obj(o.kinds[k]) ? o.kinds[k] : {}) };
        _cfg = {
            ...DEFAULTS, ...o, kinds,
            guild: { ...DEFAULTS.guild, ...(_obj(o.guild) || {}) },
            book: { ...DEFAULTS.book, ...(_obj(o.book) || {}), catastrophe: { ...DEFAULTS.book.catastrophe, ...((_obj(o.book) && _obj(o.book.catastrophe)) || {}) } },
            fraud: { ...DEFAULTS.fraud, ...(_obj(o.fraud) || {}) },
        };
        return _cfg;
    },

    kind(id) {
        return Underwriting.config().kinds[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false, guilds: [], covers: {}, claims: [], bans: {}, books: {}, marks: {},
            history: [], nextId: 1, nextGuildId: 1, lastDay: null,
            stats: { premiums: 0, claimsPaid: 0, claims: 0, frauds: 0, fraudsCaught: 0, fraudPaid: 0, recovered: 0, byKind: {} },
        };
    },

    state(player) {
        if (!player) return Underwriting._blank();
        let st = player.underwriting;
        if (!_obj(st)) { player.underwriting = Underwriting._blank(); _fresh.add(player.underwriting); return player.underwriting; }
        if (_fresh.has(st)) return st;
        _fresh.add(st);
        const blank = Underwriting._blank();
        if (typeof st.initialized !== 'boolean') st.initialized = false;
        for (const k of ['guilds', 'claims', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        for (const k of ['covers', 'bans', 'books', 'marks']) if (!_obj(st[k])) st[k] = {};
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!(st.nextGuildId > 0)) st.nextGuildId = st.guilds.length + 1;
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        if (!_obj(st.stats.byKind)) st.stats.byKind = {};
        for (const c of Object.values(st.covers)) {
            if (!c) continue;
            c.paid = _num(c.paid);
            c.claimsPaid = _num(c.claimsPaid);
            c.unpaid = _num(c.unpaid);
            if (!c.status) c.status = 'open';
        }
        return st;
    },

    serialize(player) {
        return player && player.underwriting ? JSON.parse(JSON.stringify(player.underwriting)) : null;
    },

    loadState(player, world = null) {
        if (!player) return null;
        if (player.underwriting == null) return null;
        const st = Underwriting.state(player);
        if (world && !st.initialized) Underwriting._init(world, player, st);
        return st;
    },

    // ──────────── UNDERWRITERS ────────────

    _init(world, player, st) {
        st.initialized = true;
        if (st.guilds.length) return;
        const G = Underwriting.config().guild;
        const seed = _seed(world);
        const ports = _settlements(world)
            .filter(s => s && (s.type === 'capital' || s.type === 'city') && s.kingdom != null && Number.isFinite(s.q) && Ships.isPortTile(world, s.q, s.r))
            .map(s => ({ s, score: _num(s.population, 1000) * (s.type === 'capital' ? 1.15 : 1) * (0.8 + 0.4 * _frac(`${seed}|uwSeat|${s.q},${s.r}`)) }))
            .sort((a, b) => b.score - a.score || (a.s.q - b.s.q) || (a.s.r - b.s.r));
        const realms = new Set();
        for (const { s } of ports) {
            if (st.guilds.length >= _num(G.count, 2)) break;
            if (realms.has(s.kingdom)) continue;
            realms.add(s.kingdom);
            Underwriting._newGuild(world, st, s);
        }
    },

    _newGuild(world, st, seat) {
        const G = Underwriting.config().guild;
        const id = `uw${st.nextGuildId++}`;
        const names = Array.isArray(G.names) && G.names.length ? G.names : DEFAULTS.guild.names;
        const name = String(names[_hash(`${_seed(world)}|uwName|${id}`) % names.length]).replace('{place}', seat.name || 'the port');
        const capital = Math.round(_num(G.capitalBase, 9000) * _between(G.capitalJitter || [0.8, 1.3], _frac(`${_seed(world)}|uwCap|${id}`)));
        const g = {
            id, name, q: seat.q, r: seat.r, seat: seat.name || 'the port', kingdomId: seat.kingdom,
            capital, baseCapital: capital, status: 'open', founded: _day(world), failedDay: null, refounded: false,
        };
        st.guilds.push(g);
        return g;
    },

    /** Every office, open or not: banking-house desks and guilds, as { id, name, type, seat, kingdomId, status, ref }. */
    underwriters(player) {
        const out = [];
        for (const b of (player && player.finance && player.finance.banks) || []) {
            if (b) out.push({ id: b.id, name: b.name, type: 'bank', seat: b.seat, kingdomId: b.kingdomId, status: b.status, ref: b, q: b.q, r: b.r });
        }
        for (const g of (player && player.underwriting && player.underwriting.guilds) || []) {
            if (g) out.push({ id: g.id, name: g.name, type: 'guild', seat: g.seat, kingdomId: g.kingdomId, status: g.status, ref: g, q: g.q, r: g.r });
        }
        return out;
    },

    underwriter(player, id) {
        return Underwriting.underwriters(player).find(u => u.id === id) || null;
    },

    capital(uw) {
        return uw && uw.ref ? _num(uw.ref.capital) : 0;
    },

    /** Reserves against what the office started with. */
    reserveRatio(uw) {
        return uw && uw.ref ? _num(uw.ref.capital) / Math.max(1, _num(uw.ref.baseCapital, 1)) : 0;
    },

    _open(uw, day) {
        if (!uw || uw.status !== 'open') return false;
        return !(uw.type === 'bank' && Finance.inPanic(uw.ref, day));
    },

    /** Offices that serve the player on this tile: banking houses here, and a guild at its seat or any port of its realm. */
    underwritersAt(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return [];
        const out = [];
        for (const b of Finance.banksAt(player, world, tile)) out.push(Underwriting.underwriter(player, b.id));
        const port = Ships.isPortTile(world, tile.q, tile.r);
        for (const g of (player && player.underwriting && player.underwriting.guilds) || []) {
            if (g.status !== 'open') continue;
            if ((g.q === tile.q && g.r === tile.r) || (port && s.kingdom != null && s.kingdom === g.kingdomId)) out.push(Underwriting.underwriter(player, g.id));
        }
        return out.filter(Boolean);
    },

    // ──────────── EXPOSURE: what each cover would carry today ────────────

    /** The surcharge for the player's own recent claims (1 = none). */
    surcharge(player, world) {
        const C = Underwriting.config();
        const st = player && player.underwriting;
        const day = _day(world);
        const n = st ? st.claims.filter(c => c && c.status === 'paid' && !c.fraud && day - _num(c.day) <= _num(C.claimsMemoryDays, 120)).length : 0;
        return 1 + Math.min(_num(C.maxSurcharge, 1), n * _num(C.surchargePerClaim, 0.12));
    },

    /** Cargo aboard (provisions excepted) at its sale value. */
    _cargoValue(ship) {
        const foods = new Set((Ships._getProvisionSettings && Ships._getProvisionSettings().foods) || []);
        const goods = {};
        for (const [g, q] of Object.entries((ship && ship.cargo) || {})) if (!foods.has(g)) goods[g] = q;
        return LossBook.saleValue(goods);
    },

    /** The repair bill for `pct` points of hull damage (systems/ships.js). */
    hullLossValue(ship, pct) {
        return Ships.hullDamageValue(ship, pct);
    },

    _marineItems(player, world) {
        const K = Underwriting.kind('marine');
        const season = _season(world);
        const storm = _num((K.stormChance || {})[season], 0.05);
        const I = KingdomNavy.CONFIG.intercept;
        const items = [];
        for (const ship of player.ships || []) {
            if (!ship || !['at_sea', 'moving', 'anchored'].includes(ship.status)) continue;
            const cargo = Underwriting._cargoValue(ship);
            const hull = Ships.getShipValue(ship);
            const pos = Ships._shipPosition(player, ship);
            const nGoods = Math.max(1, Object.keys(ship.cargo || {}).length);
            // Storms: hull damage and cargo washed overboard (more from a leaking hull)
            let loss = storm * (Underwriting.hullLossValue(ship, _num(K.stormHullPct, 5.5))
                + _num(K.stormCargoChance, 0.2) * _num(K.stormCargoShare, 0.2) * Ships.leakFactor(ship) * cargo / nGoods);
            // Events at sea, on a voyage (data/ships.json → voyageEvents: a wreck, a fight, cargo over the side)
            if (ship.voyage) {
                const ev = _num(Ships._getVoyageSettings && Ships._getVoyageSettings().eventChance, 0.3);
                loss += ev * (_num(K.eventHullShare, 0.15) * Underwriting.hullLossValue(ship, _num(K.eventHullPct, 11))
                    + _num(K.eventCargoShare, 0.05) * _num(K.eventCargoLoss, 0.22) * cargo);
            }
            // Squadrons of a hostile crown near her
            if (world && Number.isFinite(pos.q) && typeof world.getKingdom === 'function') {
                const fleet = KingdomNavy.fleetsNear(world, pos.q, pos.r)
                    .map(f => ({ ...f, stance: Ships.fleetHostility(player, world, f.kingdom) }))
                    .find(f => f.stance);
                if (fleet) {
                    const own = Math.max(1, _num(Ships._getShipCombatStrength(ship, player), 1));
                    const det = Math.max(1, _num(KingdomNavy.detachment(fleet.kingdom), 1));
                    const lose = _clamp(det / (det + own) * 2 * _num(K.loseFightChance, 0.5), 0.05, 0.95);
                    const chance = fleet.stance === 'war' ? _num(I.warChance, 0.12) : _num(I.peaceChance, 0.04);
                    loss += chance * lose * (Underwriting.hullLossValue(ship, _num(K.interceptHullPct, 14)) + _num(I.cargoSeized, 0.3) * cargo);
                }
                const blockade = Ships.getPortBlockade && Ships.getPortBlockade(world, pos.q, pos.r);
                if (blockade) loss += _num(K.blockadeExtra, 0.002) * (hull + cargo);
                const rad = _num(K.pirateRadius, 8);
                const pirates = (world.units || []).filter(u => u && !u.destroyed && u.type === 'pirate' && Math.abs(u.r - pos.r) <= rad
                    && Hex.wrappingDistance(u.q, u.r, pos.q, pos.r, world.width) <= rad).length;
                loss += Math.min(_num(K.pirateMax, 3), pirates) * _num(K.piratePerShip, 0.002) * cargo;
            }
            items.push({ ref: ship.id, label: ship.name, value: Math.round(hull + cargo), loss });
        }
        return items;
    },

    _caravanItems(player, world) {
        const K = Underwriting.kind('caravan');
        const items = [];
        const W = (world && world.width) || 0;
        const raiders = (world && world.units ? world.units : []).filter(u => u && !u.destroyed && (u.type === 'raider' || u.type === 'pirate') && !u.sparesPlayer);
        const lairs = OutlawLairs.active(player).filter(l => Number.isFinite(l.q) && !OutlawLairs.sparesPlayer(l, _day(world)));
        for (const c of player.caravans || []) {
            if (!c || c.status !== 'traveling') continue;
            const value = LossBook.saleValue(c.goods || {});
            if (!(value > 0)) continue;
            const pos = c.currentPos || c.fromPos || {};
            let rate = _num(K.base, 0.002);
            if (Number.isFinite(pos.q)) {
                const rr = _num(K.raiderRadius, 6);
                rate += raiders.filter(u => Math.abs(u.r - pos.r) <= rr && Hex.wrappingDistance(u.q, u.r, pos.q, pos.r, W) <= rr).length * _num(K.perRaider, 0.02);
                const lr = _num(K.lairRadius, 8);
                rate += lairs.filter(l => Math.abs(l.r - pos.r) <= lr && Hex.wrappingDistance(l.q, l.r, pos.q, pos.r, W) <= lr).length * _num(K.perLair, 0.006);
            }
            if (c.roadLinked) rate *= 0.5;
            rate = Math.min(_num(K.maxDaily, 0.25), rate);
            items.push({ ref: `car:${c.unitId || c.from}`, label: `${c.from} → ${c.to}`, value: Math.round(value), loss: rate * value });
        }
        const co = MerchantHouses.company(player);
        for (const v of (co && co.convoys) || []) {
            const value = LossBook.saleValue({ [v.good]: v.qty });
            const days = Math.max(1, _num(v.arriveDay) - _num(v.departDay));
            items.push({ ref: `cv:${v.id}`, label: `Convoy to ${v.to}`, value: Math.round(value), loss: _num(v.risk) * _num(K.convoyLoss, 0.7) * value / days });
        }
        return items;
    },

    _stockItems(player, world) {
        const items = [];
        const mp = player.merchantPrince;
        const W = MerchantPrince.config().warehouse || {};
        const mpLoss = _between((W.theft && W.theft.loss) || [0.15, 0.4], 0.5);
        for (const w of (mp && mp.warehouses) || []) {
            const value = LossBook.saleValue(w.goods || {});
            if (!(value > 0)) continue;
            const p = MerchantPrince.theftChance(player, world, w);
            items.push({ ref: `wh:${w.id}`, label: `Store-room, ${w.town}`, value: Math.round(value), loss: p / 7 * mpLoss * value });
        }
        const co = MerchantHouses.company(player);
        if (co) {
            const R = MerchantHouses.config().robbery;
            const share = _between(R.stockLoss || [0.2, 0.5], 0.5);
            for (const post of co.posts || []) {
                const value = LossBook.saleValue(post.stock || {});
                if (!(value > 0)) continue;
                const p = MerchantHouses.robberyChance(player, world, post);
                items.push({ ref: `post:${post.id}`, label: `Post, ${post.name}`, value: Math.round(value), loss: p / 7 * share * value });
            }
        }
        return items;
    },

    /** What works are worth to the insurer: what was put in, as worn. */
    worksValue(entry) {
        const w = entry && entry.works;
        return Math.max(0, _num(entry && entry.inv && entry.inv.invested) * _clamp(_num(w && w.cond, 1), 0, 1) * 0.6);
    },

    _worksItems(player, world) {
        const K = Underwriting.kind('works');
        const I = MerchantPrince.config().industry || {};
        const items = [];
        if (!player.merchantPrince) return items;
        const besieged = MarketDynamics._besieged(player);
        for (const e of MerchantPrince.investments(player, world)) {
            if (!e.settlement || !e.works) continue;
            const value = Underwriting.worksValue(e);
            const base = _num(e.inv.invested);
            let loss = _num(K.base, 0.0004) * base;
            if (besieged.has(`${e.inv.q},${e.inv.r}`)) loss += _num(K.siegeWear, 0.03) * base * _num(I.damage && I.damage.repairCost, 0.5);
            if (!MerchantPrince.inOwnRealm(player, world, e.settlement) && MerchantPrince.crownInCrisis(world, e.settlement)) {
                loss += _num(I.seizure && I.seizure.crisisChance, 0.08) / 7 * value;
            }
            items.push({ ref: `works:${e.inv.id}`, label: `${e.def ? e.def.name : 'Works'}, ${e.inv.town}`, value: Math.round(value), loss });
        }
        return items;
    },

    _farms(player, world) {
        const types = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.PROPERTY_TYPES) || {};
        const out = [];
        for (const ref of player.properties || []) {
            const def = types[String(ref && ref.type || '').toUpperCase()];
            if (!def || def.category !== 'farming' || !def.produces) continue;
            const tile = world && world.getTile ? world.getTile(ref.q, ref.r) : null;
            if (!tile) continue;
            const props = (tile.playerProperties && tile.playerProperties.length) ? tile.playerProperties : (tile.playerProperty ? [tile.playerProperty] : []);
            const prop = props.find(p => p && p.type === ref.type);
            if (!prop || prop.underConstruction) continue;
            out.push({ tile, prop, def });
        }
        return out;
    },

    /** A farm's crop on a fair day, at its sale value (the season's curve included). */
    farmDayValue(world, f) {
        const day = Seasons.today(world);
        const curve = Seasons.propertyCurve(f.prop.type) && day != null ? Seasons.propertyMultiplier(f.prop.type, day) : 1;
        const units = _num(f.prop.productionRate, _num(f.def.productionRate)) * (1 + (_num(f.prop.level, 1) - 1) * 0.1) * curve;
        return units * (PlayerInventory.goodValue(f.def.produces) || 5) * 0.7;
    },

    /**
     * The share of today's crop the land loses: the blight, drought or flood
     * on it (world events) and the day's weather. The harvest model can
     * replace this (an adapter: `harvestModel`, see below).
     */
    cropShortfall(player, world, f, opts = {}) {
        const model = Underwriting.harvestModel;
        if (model && typeof model.shortfall === 'function') {
            const v = model.shortfall(world, f, opts);
            if (Number.isFinite(v)) return _clamp(v, 0, 1);
        }
        let mod = WorldEvents.getModifier(world, 'farmProduction', f.tile);
        if (!opts.eventsOnly && world && world.weather) {
            const wx = world.weather.getWeather(f.tile.q, f.tile.r);
            mod += _num(WEATHER_EFFECTS[wx && wx.type] && WEATHER_EFFECTS[wx.type].farmProduction);
        }
        if (mod < 0 && Technology.hasBuildingNear(player, world, 'granary', f.tile.q, f.tile.r, 1)) mod /= 2;
        return _clamp(-mod, 0, 1);
    },

    /** Set by a harvest model (world/harvests.js) when there is one: { shortfall(world, farm), expected(world, farm) }. */
    harvestModel: null,

    _cropItems(player, world) {
        const K = Underwriting.kind('crop');
        const season = _season(world);
        const items = [];
        for (const f of Underwriting._farms(player, world)) {
            const value = Underwriting.farmDayValue(world, f);
            if (!(value > 0)) continue;
            const model = Underwriting.harvestModel;
            const expected = model && typeof model.expected === 'function' ? model.expected(world, f) : null;
            // The season's weather, or this field's own record if it is worse (experience rating), and any blight now
            const seen = _num((((player.underwriting || {}).marks || {}).crop || {})[`${f.tile.q},${f.tile.r}`]);
            const rate = Number.isFinite(expected) ? expected
                : Math.max(_num((K.seasonShortfall || {})[season], 0.02), seen) + Underwriting.cropShortfall(player, world, f, { eventsOnly: true });
            items.push({ ref: `farm:${f.tile.q},${f.tile.r}:${f.prop.type}`, label: `${f.def.name} at ${f.tile.q},${f.tile.r}`, value: Math.round(value), loss: rate * value, farm: f });
        }
        return items;
    },

    /** What a cover of this kind would carry today: [{ ref, label, value, loss }] (loss = expected loss today). */
    exposure(player, world, kind) {
        if (!player) return [];
        switch (kind) {
            case 'marine': return Underwriting._marineItems(player, world);
            case 'caravan': return Underwriting._caravanItems(player, world);
            case 'stock': return Underwriting._stockItems(player, world);
            case 'works': return Underwriting._worksItems(player, world);
            case 'crop': return Underwriting._cropItems(player, world);
            default: return [];
        }
    },

    /** Today's quote for a kind: { kind, value, expected, premium, items, surcharge }. */
    quote(player, world, kind) {
        const C = Underwriting.config();
        const items = Underwriting.exposure(player, world, kind);
        const value = items.reduce((a, x) => a + _num(x.value), 0);
        const expected = items.reduce((a, x) => a + _num(x.loss), 0);
        const surcharge = Underwriting.surcharge(player, world);
        const premium = _r2(expected * _num(C.loading, 1.35) * surcharge);
        return { kind, value, expected: _r2(expected), premium, items, surcharge, rate: value > 0 ? premium / value : 0 };
    },

    // ──────────── COVERS: open, cancel ────────────

    cover(player, kind) {
        const st = player && player.underwriting;
        const c = st && st.covers && st.covers[kind];
        return c && c.status === 'open' ? c : null;
    },

    banned(player, uwId, day) {
        const st = player && player.underwriting;
        return !!(st && st.bans && _num(st.bans[uwId], -1) >= day);
    },

    /** Open cover of `kind` with an office serving the player here. */
    openCover(player, world, uwId, kind) {
        const st = Underwriting.state(player);
        if (!st.initialized) Underwriting._init(world, player, st);
        const K = Underwriting.kind(kind);
        const day = _day(world);
        const uw = Underwriting.underwriter(player, uwId);
        if (!K) return { success: false, reason: 'No such cover.' };
        if (!uw || !Underwriting._open(uw, day)) return { success: false, reason: 'That office is not writing cover.' };
        const here = Underwriting.underwritersAt(player, world, world.getTile(player.q, player.r));
        if (!here.some(u => u.id === uwId)) return { success: false, reason: `Visit ${uw.name} at ${uw.seat}, or one of its branches.` };
        if (Underwriting.banned(player, uwId, day)) return { success: false, reason: `${uw.name} will not insure you: your name is on its black list.` };
        if (Underwriting.cover(player, kind)) return { success: false, reason: `You already hold ${K.name.toLowerCase()} cover.` };
        const attachDay = day + Math.max(0, Math.round(_num(K.attachDays, 1)));
        st.covers[kind] = { id: `pol${st.nextId++}`, kind, uwId, uwName: uw.name, opened: day, attachDay, paid: 0, claimsPaid: 0, unpaid: 0, lastBilled: null, status: 'open' };
        const q = Underwriting.quote(player, world, kind);
        return { success: true, cover: st.covers[kind], text: `${uw.name} writes your ${K.name.toLowerCase()} cover from day ${attachDay}. Today it would cost ${q.premium.toFixed(1)}g a day.` };
    },

    cancelCover(player, world, kind) {
        const st = Underwriting.state(player);
        const c = Underwriting.cover(player, kind);
        if (!c) return { success: false, reason: 'No such cover.' };
        c.status = 'cancelled';
        c.closed = _day(world);
        delete st.covers[kind];
        return { success: true, text: 'Cover cancelled.' };
    },

    // ──────────── CLAIMS ────────────

    _claim(player, world, st, cover, rec, out, opts = {}) {
        const C = Underwriting.config();
        const day = _day(world);
        const uw = Underwriting.underwriter(player, cover.uwId);
        if (!uw || uw.status !== 'open') return null;
        const amount = _r2(Math.min(_num(C.maxClaim, 20000), _num(rec.value) * (1 - _num(C.deductible, 0.1))));
        if (amount < _num(C.minClaim, 5)) return null;
        const claim = {
            id: `clm${st.nextId++}`, kind: cover.kind, uwId: uw.id, uwName: uw.name, day, lossDay: _num(rec.day, day),
            value: _r2(rec.value), amount, cause: rec.cause || 'loss', place: rec.place || null, status: 'pending', dueDay: day, fraud: !!opts.fraud,
        };
        if (opts.fraud || amount > _num(C.investigateAbove, 800)) {
            claim.dueDay = day + Math.round(_between(C.investigateDays || [3, 6], opts.fraud ? opts.roll : Utils.random()));
            claim.investigated = true;
        }
        st.claims.push(claim);
        if (st.claims.length > 60) st.claims.splice(0, st.claims.length - 60);
        st.stats.claims++;
        if (claim.dueDay <= day) Underwriting._settle(player, world, st, claim, out);
        else if (out && !opts.fraud) out.notices.push({ icon: '🔎', title: 'Claim Under Review', text: `${uw.name} looks into your claim of ${Math.round(amount)}g (${claim.cause}); the assessors report by day ${claim.dueDay}.`, type: 'info' });
        return claim;
    },

    /** Pay a claim from the office's capital; an office that cannot pay fails. */
    _pay(player, world, st, uw, amount, out) {
        const cap = Math.max(0, _num(uw.ref.capital));
        const paid = Math.min(amount, cap);
        uw.ref.capital = _r2(_num(uw.ref.capital) - paid);
        player.gold = _num(player.gold) + paid;
        Ledger.record(player, 'insuranceClaims', paid);
        st.stats.claimsPaid = _r2(st.stats.claimsPaid + paid);
        if (paid < amount && uw.type === 'guild') Underwriting._failGuild(world, player, st, uw.ref, out, amount - paid);
        return paid;
    },

    _settle(player, world, st, claim, out) {
        const F = Underwriting.config().fraud;
        const uw = Underwriting.underwriter(player, claim.uwId);
        if (!uw || uw.status !== 'open') {
            claim.status = 'lapsed';
            return;
        }
        if (claim.fraud) {
            const g = Underworld.ensure(player).guild;
            const recent = st.claims.filter(c => c !== claim && c.status === 'paid' && _day(world) - _num(c.day) <= _num(Underwriting.config().claimsMemoryDays, 120)).length;
            const cap = Math.min(_num(F.maxAmount, 3000), Math.max(1, _num(claim.cap, claim.amount)));
            const chance = _clamp(_num(F.caught, 0.4) - _num(g && g.rank) * _num(F.perRank, 0.05) + recent * _num(F.perClaim, 0.08)
                + (claim.amount / cap) * _num(F.bigShare, 0.1), _num(F.minCaught, 0.15), _num(F.maxCaught, 0.9));
            claim.caughtChance = _r2(chance);
            if (Utils.random() < chance) {
                Underwriting._caught(player, world, st, claim, uw, out);
                return;
            }
            st.stats.fraudPaid = _r2(st.stats.fraudPaid + claim.amount);
        }
        const paid = Underwriting._pay(player, world, st, uw, claim.amount, out);
        claim.status = 'paid';
        claim.paid = _r2(paid);
        const cover = st.covers[claim.kind];
        if (cover && cover.uwId === uw.id) cover.claimsPaid = _r2(_num(cover.claimsPaid) + paid);
        if (!claim.fraud) Underwriting._kindStat(st, claim.kind, 'claims', paid);
        if (out) out.notices.push({ icon: '🛡️', title: 'Claim Paid', text: `${uw.name} pays your claim: ${Math.round(paid)}g for ${claim.cause}${claim.place ? ` (${claim.place})` : ''}.`, type: 'success' });
        if (paid >= 1500) Underwriting._record(st, world, { kind: 'great_claim', uwId: uw.id, uw: uw.name, place: uw.seat, kingdomId: uw.kingdomId, amount: Math.round(paid), cause: claim.cause });
    },

    _caught(player, world, st, claim, uw, out) {
        const F = Underwriting.config().fraud;
        const day = _day(world);
        claim.status = 'denied';
        claim.caught = true;
        st.stats.fraudsCaught++;
        const fine = Math.round(claim.amount * _num(F.fineMult, 1));
        const take = Math.min(fine, Math.max(0, Math.floor(_num(player.gold))));
        player.gold = _num(player.gold) - take;
        if (take > 0) {
            Ledger.record(player, 'fines', -take);
            uw.ref.capital = _num(uw.ref.capital) + take;
        }
        const short = fine - take;
        const heat = _num(F.heat, 25) + Math.round(short / 100);
        if (uw.kingdomId != null) Underworld.addHeat(player, uw.kingdomId, heat, world);
        st.bans[uw.id] = day + _num(F.banDays, 240);
        const cover = st.covers[claim.kind];
        if (cover && cover.uwId === uw.id) delete st.covers[claim.kind];
        if (out) out.notices.push({ icon: '⚖️', title: 'False Claim Exposed', text: `${uw.name}'s assessors have found your papers forged. No pay, a fine of ${fine}g${short > 0 ? ` (${take}g taken, the rest on your head)` : ''}, your cover cancelled and the office's doors shut to you.`, type: 'error' });
    },

    /**
     * A false claim through the Thieves' Guild: forged protests of a loss on
     * cover you hold. The forger takes his fee now; the claim is always
     * investigated and may be found out.
     */
    falseClaim(player, world, kind, amount) {
        const C = Underwriting.config();
        const F = C.fraud;
        const st = Underwriting.state(player);
        const day = _day(world);
        const cover = Underwriting.cover(player, kind);
        if (!cover) return { success: false, reason: 'You hold no such cover.' };
        if (day < cover.attachDay) return { success: false, reason: 'The cover has not attached yet.' };
        const uw = Underwriting.underwriter(player, cover.uwId);
        if (!uw || uw.status !== 'open') return { success: false, reason: 'That office is not paying claims.' };
        const here = Underwriting.underwritersAt(player, world, world.getTile(player.q, player.r));
        if (!here.some(u => u.id === uw.id)) return { success: false, reason: `Lay the papers before ${uw.name} at ${uw.seat} or a branch.` };
        const g = Underworld.ensure(player).guild;
        if (!g || !g.member || _num(g.rank) < _num(F.minRank, 1)) return { success: false, reason: "Only the Thieves' Guild sells papers that would fool an assessor." };
        if (st.claims.some(c => c.fraud && c.status === 'pending')) return { success: false, reason: 'One forgery at a time: the last is still with the assessors.' };
        const exposure = Underwriting.exposure(player, world, kind).reduce((a, x) => a + _num(x.value), 0);
        const cap = Math.floor(Math.min(_num(F.maxAmount, 3000), exposure * _num(F.maxShare, 0.5)));
        const want = Math.floor(_num(amount));
        if (cap < 50) return { success: false, reason: 'You have nothing covered that could plausibly be lost.' };
        if (want < 50 || want > cap) return { success: false, reason: `The forger will draw papers for 50–${cap}g of loss.` };
        const fee = Math.ceil(want * _num(F.forgerFee, 0.2));
        if (_num(player.gold) < fee) return { success: false, reason: `The forger wants ${fee}g up front.` };
        player.gold -= fee;
        Ledger.record(player, 'fraud', -fee);
        st.stats.frauds++;
        const roll = _frac(`${_seed(world)}|fraud|${day}|${st.nextId}`);
        const claim = Underwriting._claim(player, world, st, cover, { day, value: want / (1 - _num(C.deductible, 0.1)), cause: 'a loss (forged papers)', place: null }, null, { fraud: true, roll });
        if (claim) claim.cap = cap;
        return { success: true, fee, claim, text: `The forger takes ${fee}g. Your papers are with ${uw.name}'s assessors until day ${claim ? claim.dueDay : day}.` };
    },

    // ──────────── THE DAILY TICK ────────────

    processDay(world, player) {
        const out = { notices: [], premium: 0, claims: 0 };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        const day = _day(world);
        const st = Underwriting.state(player);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        if (!st.initialized) Underwriting._init(world, player, st);
        const rng = seededStream(_hash(`${_seed(world)}:underwriting:${day}`));
        Utils.withRng(rng, () => Underwriting._tick(world, player, st, out));
        return out;
    },

    _tick(world, player, st, out) {
        const day = _day(world);
        Underwriting._lapseFailed(world, player, st, out);
        Underwriting._worksLosses(world, player, st);
        Underwriting._cropLosses(world, player, st);
        // Today's losses against the covers
        for (const rec of LossBook.drain(player)) {
            const cover = Underwriting.cover(player, rec.kind);
            if (!cover || _num(rec.day, day) < cover.attachDay) continue;
            if (rec.kind === 'works' && rec.cause === 'war') continue;
            if (rec.kind === 'works' && rec.cause === 'expropriated') continue;
            if (Underwriting._claim(player, world, st, cover, rec, out)) out.claims++;
        }
        // Claims whose investigation is done
        for (const c of st.claims) if (c.status === 'pending' && c.dueDay <= day) Underwriting._settle(player, world, st, c, out);
        // Premiums
        for (const kind of KINDS) {
            const cover = Underwriting.cover(player, kind);
            if (!cover) continue;
            const q = Underwriting.quote(player, world, kind);
            const due = _r2(q.premium);
            cover.lastBilled = day;
            if (due <= 0) continue;
            const uw = Underwriting.underwriter(player, cover.uwId);
            if (_num(player.gold) >= due) {
                player.gold -= due;
                Ledger.record(player, 'insurance', -due);
                cover.paid = _r2(cover.paid + due);
                cover.unpaid = 0;
                st.stats.premiums = _r2(st.stats.premiums + due);
                Underwriting._kindStat(st, kind, 'premium', due);
                out.premium = _r2(out.premium + due);
                if (uw && uw.ref) uw.ref.capital = _r2(_num(uw.ref.capital) + due);
            } else if (++cover.unpaid >= _num(Underwriting.config().unpaidDays, 3)) {
                delete st.covers[kind];
                out.notices.push({ icon: '🛡️', title: 'Cover Lapsed', text: `Your ${Underwriting.kind(kind).name.toLowerCase()} cover lapsed: the premiums went unpaid.`, type: 'warning' });
            }
        }
        if (day % 7 === 0) Underwriting._bookWeek(world, player, st, out);
        Underwriting._refound(world, st, day);
    },

    /** Works damaged since yesterday (siege wear, raids and sacks): the rise in the repair bill. */
    _worksLosses(world, player, st) {
        const marks = st.marks.works = _obj(st.marks.works) || {};
        if (!player.merchantPrince) return;
        const seen = new Set();
        for (const e of MerchantPrince.investments(player, world)) {
            if (!e.works) continue;
            const id = e.inv.id;
            seen.add(id);
            const bill = _num(e.repairCost);
            if (marks[id] != null && bill > _num(marks[id]) + 0.5) {
                LossBook.report(player, world, { kind: 'works', cause: 'damage', value: bill - _num(marks[id]), ref: id, place: e.inv.town, q: e.inv.q, r: e.inv.r });
            }
            marks[id] = bill;
        }
        for (const id of Object.keys(marks)) if (!seen.has(id)) delete marks[id];
    },

    /** Farms under crop cover: the day's shortfall against a fair-weather crop. */
    _cropLosses(world, player, st) {
        if (!Underwriting.cover(player, 'crop')) return;
        const marks = st.marks.crop = _obj(st.marks.crop) || {};
        const w = _num(Underwriting.kind('crop').experienceWeight, 0.01);
        for (const f of Underwriting._farms(player, world)) {
            const short = Underwriting.cropShortfall(player, world, f);
            const key = `${f.tile.q},${f.tile.r}`;
            marks[key] = Math.round((_num(marks[key], _num((Underwriting.kind('crop').seasonShortfall || {})[_season(world)], 0.01)) * (1 - w) + (short - Underwriting.cropShortfall(player, world, f, { eventsOnly: true })) * w) * 1e5) / 1e5;
            if (!(short > 0)) continue;
            const value = Underwriting.farmDayValue(world, f) * short;
            if (value >= 1) LossBook.report(player, world, { kind: 'crop', cause: 'a poor day in the fields', value, ref: `farm:${f.tile.q},${f.tile.r}`, q: f.tile.q, r: f.tile.r });
        }
    },

    /** Covers with an office that has failed lapse; claims pending with it are paid at the receivers' rate. */
    _lapseFailed(world, player, st, out) {
        const G = Underwriting.config().guild;
        for (const [kind, c] of Object.entries(st.covers)) {
            const uw = Underwriting.underwriter(player, c.uwId);
            if (uw && uw.status === 'open') continue;
            delete st.covers[kind];
            out.notices.push({ icon: '🏚️', title: 'Cover Lapsed', text: `${c.uwName || 'Your underwriter'} has failed: your ${(Underwriting.kind(kind) || {}).name || kind} cover is void.`, type: 'warning' });
        }
        for (const cl of st.claims) {
            if (cl.status !== 'pending') continue;
            const uw = Underwriting.underwriter(player, cl.uwId);
            if (uw && uw.status === 'open') continue;
            cl.status = 'recovered';
            if (cl.fraud) continue;
            const back = Math.floor(cl.amount * _between(G.recovery || [0.3, 0.6], Utils.random()));
            player.gold = _num(player.gold) + back;
            Ledger.record(player, 'insuranceClaims', back);
            cl.paid = back;
            st.stats.recovered = _r2(st.stats.recovered + back);
            out.notices.push({ icon: '🏚️', title: 'Receivers Pay', text: `The receivers of ${cl.uwName} pay ${back}g of your ${Math.round(cl.amount)}g claim.`, type: 'warning' });
        }
    },

    /** The risk in an office's waters this week: wars, blockades, pirates. */
    _bookRisk(world, uw) {
        const k = _kingdom(world, uw.kingdomId);
        const B = Underwriting.config().book;
        let mult = 1;
        if (k && k.isAlive !== false) {
            mult += (Array.isArray(k.wars) ? k.wars.length : 0) * _num(B.warLoss, 0.25);
            if (KingdomNavy.isBlockaded(k)) mult += _num(B.blockadeLoss, 0.3);
        }
        const W = (world && world.width) || 0;
        const pirates = (world.units || []).filter(u => u && !u.destroyed && u.type === 'pirate' && Math.abs(u.r - uw.r) <= 12 && Hex.wrappingDistance(u.q, u.r, uw.q, uw.r, W) <= 12).length;
        mult += pirates * _num(B.pirateLoss, 0.06);
        return mult;
    },

    /** The week of other merchants' business on each office's books. */
    _bookWeek(world, player, st, out) {
        const B = Underwriting.config().book;
        const cat = B.catastrophe || {};
        const winter = _season(world) === 'Winter';
        for (const uw of Underwriting.underwriters(player)) {
            if (uw.status !== 'open') continue;
            const cap = Math.max(0, _num(uw.ref.capital));
            if (cap <= 0) {
                Underwriting._insolvent(world, player, st, uw, out);
                continue;
            }
            const premium = cap * _num(B.bookShare, 0.12) * _num(B.premium, 0.022);
            const noise = Math.exp((Utils.random() * 2 - 1) * _num(B.noise, 0.45));
            const ratio = Math.min(_num(B.maxRatio, 6), _num(B.lossRatio, 0.6) * Underwriting._bookRisk(world, uw) * noise);
            let delta = premium * (1 - ratio);
            let catastrophe = 0;
            if (Utils.random() < _num(cat.chance, 0.002) * (winter ? _num(cat.winterMult, 2) : 1)) {
                catastrophe = Math.round(cap * _between(cat.loss || [0.1, 0.25], Utils.random()));
                delta -= catastrophe;
            }
            uw.ref.capital = _r2(_num(uw.ref.capital) + delta);
            const book = st.books[uw.id] = _obj(st.books[uw.id]) || { premium: 0, losses: 0, weeks: 0 };
            book.premium = Math.round(_num(book.premium) + premium);
            book.losses = Math.round(_num(book.losses) + premium * ratio + catastrophe);
            book.weeks = _num(book.weeks) + 1;
            book.lastRatio = _r2(ratio);
            if (catastrophe > 0) {
                Underwriting._record(st, world, { kind: 'catastrophe', uwId: uw.id, uw: uw.name, place: uw.seat, kingdomId: uw.kingdomId, amount: catastrophe });
                if (Object.values(st.covers).some(c => c.uwId === uw.id)) {
                    out.notices.push({ icon: '🌊', title: 'Underwriters Hit', text: `A great storm sank a fleet ${uw.name} insured: it pays out ${catastrophe}g.`, type: 'warning' });
                }
            }
            Underwriting._insolvent(world, player, st, uw, out);
        }
    },

    /** A guild below its floor fails; a banking house whose vaults its claims emptied faces its depositors (systems/finance.js). */
    _insolvent(world, player, st, uw, out) {
        if (uw.type === 'guild') {
            const G = Underwriting.config().guild;
            if (_num(uw.ref.capital) < _num(uw.ref.baseCapital) * _num(G.failBelow, 0.15)) Underwriting._failGuild(world, player, st, uw.ref, out, 0);
        } else if (_num(uw.ref.capital) <= 0 && uw.ref.status === 'open' && !Finance.inPanic(uw.ref, _day(world))) {
            Finance._startRun(world, player, Finance.state(player), uw.ref, out, 'its underwriting losses');
        }
    },

    _failGuild(world, player, st, g, out, owed) {
        if (g.status !== 'open') return;
        g.status = 'failed';
        g.failedDay = _day(world);
        Underwriting._record(st, world, { kind: 'underwriter_failed', uwId: g.id, uw: g.name, place: g.seat, kingdomId: g.kingdomId });
        const mine = Object.values(st.covers).some(c => c.uwId === g.id) || st.claims.some(c => c.uwId === g.id && c.status === 'pending');
        if (out) out.notices.push({ icon: '🏚️', title: 'Underwriters Fail', text: `${g.name} cannot meet its claims and has shut its doors.${owed > 0 ? ` ${Math.round(owed)}g of claims go unpaid.` : ''}`, type: mine ? 'error' : 'warning' });
    },

    _refound(world, st, day) {
        const G = Underwriting.config().guild;
        for (const g of st.guilds.slice()) {
            if (g.status !== 'failed' || g.refounded || day - _num(g.failedDay) < _num(G.refoundDays, 90)) continue;
            g.refounded = true;
            const tile = world.getTile ? world.getTile(g.q, g.r) : null;
            const s = tile && tile.settlement;
            if (!s || s.kingdom == null) continue;
            const ng = Underwriting._newGuild(world, st, { q: g.q, r: g.r, name: s.name || g.seat, kingdom: s.kingdom });
            Underwriting._record(st, world, { kind: 'underwriter_founded', uwId: ng.id, uw: ng.name, place: ng.seat, kingdomId: ng.kingdomId });
        }
    },

    /** Premiums and claims by kind, all time (the loss ratio each cover has run at). */
    _kindStat(st, kind, field, amount) {
        const b = st.stats.byKind[kind] = _obj(st.stats.byKind[kind]) || { premium: 0, claims: 0 };
        b[field] = _r2(_num(b[field]) + amount);
    },

    _record(st, world, rec) {
        const day = _day(world);
        st.history.push({ ...rec, day, key: `uw:${rec.kind}:${day}:${rec.uwId || ''}` });
        if (st.history.length > 40) st.history.splice(0, st.history.length - 40);
    },

    // ──────────── READERS ────────────

    /** For panels and the counsel: { covers, premiumToday, claimsPending, claimsPaid }. */
    summary(player, world) {
        const st = player && player.underwriting;
        if (!st) return { covers: 0, premiumToday: 0, pending: 0, paid: 0 };
        let premium = 0;
        for (const kind of KINDS) if (Underwriting.cover(player, kind)) premium += Underwriting.quote(player, world, kind).premium;
        return {
            covers: KINDS.filter(k => Underwriting.cover(player, k)).length, premiumToday: _r2(premium),
            pending: st.claims.filter(c => c.status === 'pending').length, paid: _r2(st.stats.claimsPaid),
        };
    },

    /** Ships at sea without marine cover, and the day's expected loss on each (counsel). */
    uninsuredAtSea(player, world) {
        if (Underwriting.cover(player, 'marine')) return [];
        return Underwriting._marineItems(player, world);
    },
};
