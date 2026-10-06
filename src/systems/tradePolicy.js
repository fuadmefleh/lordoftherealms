// ============================================
// KINGDOM TRADE POLICY — tariffs, bans, embargoes, treaties, granaries
// ============================================
// Every realm keeps a trade policy (kingdom.tradePolicy, saved with the
// kingdom):
//
//   TARIFFS    import (imp) and export (exp) duties per good category
//              (data/tradePolicy.json → categories), a share of the goods'
//              value. On NPC trade between two realms' towns (the trade links
//              of world/settlementMarket.js) a tariff is extra friction on the
//              flow — less moves, so the importer's stock stays thinner and its
//              price higher — and the duty on what does move goes to the
//              treasuries (the importer's part to the importer, the exporter's
//              to the exporter). A caravan crossing into a realm pays that
//              realm's import tariff on its cargo as its border toll
//              (systems/merchantCaravans.js). The player pays the import tariff
//              selling goods booked as bought in another realm.
//   RETALIATION per partner: extra import tariff on one realm's goods — a
//              trade war.
//   BANS       export bans by category (grain in a famine): nothing of it
//              leaves the realm along the trade links.
//   EMBARGOES  on a realm: the links between the two cut both ways; the
//              player can't sell that realm's goods openly — only smuggle them.
//   TREATIES   between friendly realms: tariffs waived both ways, more trade
//              along their links, relations warm week by week.
//   GRANARY    the crown buys grain where it is in glut and releases it in its
//              hungry towns (Kingship.hunger) — a treasury cost, a stability
//              gain.
//
// NPC crowns decide on a weekly turn (staggered by realm): a stance from
// personality, culture and a yearly jitter (free trade … mercantilist), raised
// tariffs in a treasury crisis, guild lobbying for their goods, export bans
// while the realm goes hungry, embargoes on enemies and bitter rivals,
// treaties with friends, and retaliation against a partner whose tariffs on
// their goods are higher than theirs (trade wars escalate and cool). The
// realm the player rules is set from the Royal Court instead (ruler
// functions below), with consequences for the Guild Coalition, the
// neighbours' tariffs and the treasury.
//
// Deterministic: every NPC roll is a hash of the realm and the day; only the
// player's smuggling draws from Utils (an action, like the black market).
// Hooks: marketDynamics._disrupt → linkFactor (cuts and duties per link),
// SettlementMarket.flows reads link.dutyAB/BA and leaves link.paidAB/BA,
// marketDynamics → collect (into the treasuries). World state (version,
// history for the heralds) on world.tradePolicy; the player's ledger,
// licences and stats on player.tradePolicy. Content in data/tradePolicy.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Kingship } from './kingship.js';
import { Throne } from './throne.js';
import { Councils } from './councils.js';
import { Underworld } from './underworld.js';
import { House } from './house.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r3 = (v) => Math.round(v * 1000) / 1000;
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const FREE = '_free';

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

const DEFAULTS = {
    turnDays: 7, policyEvery: 4,
    categories: { wares: { label: 'Goods', icon: '📦', goods: [] } },
    defaultCategory: 'wares',
    stances: {
        free_trade: { label: 'Free Trade', icon: '🕊️', imp: 0.02, exp: 0, treatyBias: 0.15 },
        moderate: { label: 'Moderate', icon: '⚖️', imp: 0.06, exp: 0.01, treatyBias: 0 },
        mercantilist: { label: 'Mercantilist', icon: '🏰', imp: 0.12, exp: 0.03, treatyBias: -0.15 },
    },
    catMult: { imp: {}, exp: {} },
    personality: {}, culture: {},
    stanceAt: { free: -0.2, mercantilist: 0.2 },
    jitter: 0.3, maxTariff: 0.35,
    crisis: { treasuryBelow: 300, debtRatio: 0.6, mult: 1.4, add: 0.03 },
    lobby: { perGuild: 0.006, cap: 0.05 },
    ban: { category: 'staples', hungryShare: 0.25, minDays: 21 },
    embargo: { rivalBelow: -50, chance: 0.2, liftAbove: -15, warLiftDays: 60, relation: -8, stability: -1 },
    treaty: { relationAt: 40, allyAt: 15, chance: 0.3, breakBelow: 10, linkBoost: 0.2, relation: 1, relationCap: 80, stability: 1 },
    tradeWar: { margin: 0.04, step: 0.04, cap: 0.2, chance: 0.5, relation: -3, stability: -1.5, calmAbove: 30, decay: 0.02 },
    revenue: { scale: 1 },
    granary: { minTreasury: 1500, capPerHead: 0.08, buyBelow: 0.85, buyShare: 0.25, maxBuy: 60, maxTowns: 4, releaseDays: 7, maxRelease: 80, spoil: 0.01, stability: 0.5, heraldMin: 60 },
    stabilityCap: 6,
    player: {
        licence: { base: 150, perTown: 25, days: 120, minRep: -10, goodRep: 25, discount: 0.6, maxHeat: 40 },
        smuggle: { premium: 1.25, sellShare: 0.7, catchBase: 0.12, perHeat: 0.004, perGuard: 0.03, stealth: 0.02, fineShare: 0.5, arrest: 0.25 },
        breach: { heatPerUnit: 0.4, maxHeat: 12 },
        broker: { cost: 300, minRelation: 10, minRep: 10, relation: 10, rep: 5, prestige: 15, ap: 1 },
    },
    ruler: {
        levels: [0, 0.03, 0.06, 0.1, 0.15, 0.25],
        merchants: { perTariff: -30, lobbyPlease: 2, embargo: -3, treaty: 3, ban: -2, granary: 1 },
        embargoRelation: -10, cancelRelation: -5, chancellorPer: 1,
    },
    historyCap: 40,
};

/** Per-world caches: link duty tables by realm pair (rebuilt when a policy changes). */
const _caches = new WeakMap();
/** Per-world: each realm's towns and trading partners (rebuilt when the settlement scan or the links change). */
const _towns = new WeakMap();
/** Realm records already backfilled. */
const _checked = new WeakSet();
/** Hashes of realm ids (for the towns' signature). */
const _kidHash = new Map();
/** The cache last read (one world at a time in play). */
const _last = { world: null, c: null };
/** Stands for an independent town's side of a pair in the pair cache. */
const NONE = {};

export const TradePolicy = {

    // ── Config ─────────────────────────────────────────────

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.tradePolicy) || {};
    },

    config() {
        const src = TradePolicy.data();
        if (TradePolicy._cfg && TradePolicy._cfgSrc === src) return TradePolicy._cfg;
        const C = _merge(DEFAULTS, src);
        if (_obj(src.categories)) C.categories = src.categories;
        C.catIds = Object.keys(C.categories).filter(id => !id.startsWith('_'));
        C.catOf = {};
        for (const id of C.catIds) for (const g of C.categories[id].goods || []) if (!C.catOf[g]) C.catOf[g] = id;
        if (!C.catIds.includes(C.defaultCategory)) C.defaultCategory = C.catIds[0] || 'wares';
        TradePolicy._cfgSrc = src;
        TradePolicy._cfg = C;
        TradePolicy._catIdx = null;
        return C;
    },

    /** The category a good is tariffed under. */
    categoryOf(goodId) {
        const C = TradePolicy.config();
        return C.catOf[goodId] || C.defaultCategory;
    },

    category(catId) {
        const c = TradePolicy.config().categories[catId];
        return c ? { id: catId, label: c.label || catId, icon: c.icon || '📦', goods: c.goods || [] } : null;
    },

    /** The category of each market good, in SettlementMarket config order. */
    _goodCats() {
        const C = TradePolicy.config();
        const M = SettlementMarket.config();
        if (TradePolicy._catIdx && TradePolicy._catIdx.m === M && TradePolicy._catIdx.c === C) return TradePolicy._catIdx.list;
        const list = M.goodIds.map(id => TradePolicy.categoryOf(id));
        TradePolicy._catIdx = { m: M, c: C, list };
        return list;
    },

    // ── State ──────────────────────────────────────────────

    /** World record: { ver, history } (created on use). */
    state(world) {
        if (!world) return { ver: 0, history: [] };
        let st = world.tradePolicy;
        if (!_obj(st)) st = world.tradePolicy = { ver: 0, seq: 0, history: [] };
        if (!Array.isArray(st.history)) st.history = [];
        st.ver = _num(st.ver);
        st.seq = _num(st.seq);
        return st;
    },

    _blankRealm() {
        return {
            stance: null, imp: {}, exp: {}, bans: {}, embargo: {}, treaty: {}, retal: {}, wars: {},
            lobby: {}, crisis: false, manual: false,
            granary: { on: false, grain: 0, bought: 0, released: 0, spent: 0 },
            rev: { week: 0, last: 0, total: 0, tolls: 0 },
            stab: 0, relief: 0, lastTurn: null,
        };
    },

    /** A realm's policy (kingdom.tradePolicy), created and backfilled on use. */
    realm(kingdom) {
        if (!kingdom || typeof kingdom !== 'object') return null;
        let p = kingdom.tradePolicy;
        // (checked once per record: this is read for every link that paid duty)
        if (p && _checked.has(p)) return p;
        if (!_obj(p)) p = kingdom.tradePolicy = TradePolicy._blankRealm();
        const b = TradePolicy._blankRealm();
        for (const k of ['imp', 'exp', 'bans', 'embargo', 'treaty', 'retal', 'wars', 'lobby']) if (!_obj(p[k])) p[k] = {};
        if (!_obj(p.granary)) p.granary = b.granary;
        for (const [k, v] of Object.entries(b.granary)) if (typeof p.granary[k] !== typeof v) p.granary[k] = v;
        if (!_obj(p.rev)) p.rev = b.rev;
        for (const [k, v] of Object.entries(b.rev)) if (typeof p.rev[k] !== 'number') p.rev[k] = v;
        p.stab = _num(p.stab);
        p.relief = _num(p.relief);
        if (!p.stance) p.stance = TradePolicy.naturalStance(kingdom, 0);
        _checked.add(p);
        return p;
    },

    /** The policy if the realm has one (no backfill — for pure readers). */
    _peek(kingdom) {
        return kingdom && _obj(kingdom.tradePolicy) ? kingdom.tradePolicy : null;
    },

    _kingdom(world, id) {
        if (!world || id == null) return null;
        const k = typeof world.getKingdom === 'function' ? world.getKingdom(id) : (world.kingdoms || []).find(x => x && x.id === id);
        return k && k.isAlive !== false ? k : null;
    },

    _bump(world) {
        const st = TradePolicy.state(world);
        st.ver++;
    },

    _record(world, kind, fields) {
        const st = TradePolicy.state(world);
        st.seq++;
        const day = _day(world);
        st.history.push({ key: `tp:${day}:${st.seq}`, kind, day, ...fields });
        const cap = _num(TradePolicy.config().historyCap, 40);
        if (st.history.length > cap) st.history = st.history.slice(-cap);
    },

    /** Recent trade-policy news, newest first. */
    recent(world, days = 60) {
        const day = _day(world);
        return TradePolicy.state(world).history.filter(h => day - _num(h.day) <= days).slice().reverse();
    },

    // ── Queries ────────────────────────────────────────────

    /** The stance a crown leans to by nature: personality + culture + a yearly hash jitter. */
    naturalStance(kingdom, day = 0) {
        const C = TradePolicy.config();
        const score = TradePolicy.protectionism(kingdom, day);
        if (score <= _num(C.stanceAt.free, -0.2)) return 'free_trade';
        if (score >= _num(C.stanceAt.mercantilist, 0.2)) return 'mercantilist';
        return 'moderate';
    },

    protectionism(kingdom, day = 0) {
        const C = TradePolicy.config();
        const year = Math.floor(_num(day) / 120);
        return _num(C.personality[KingdomAI.personalityId(kingdom)])
            + _num(C.culture[kingdom && kingdom.culture])
            + (_roll(`tp-stance:${kingdom && kingdom.id}:${year}`) - 0.5) * _num(C.jitter);
    },

    stance(id) {
        const s = TradePolicy.config().stances[id];
        return s ? { id, ...s } : { id: 'moderate', label: 'Moderate', icon: '⚖️', imp: 0.06, exp: 0.01, treatyBias: 0 };
    },

    /** Does either realm embargo the other? */
    embargoed(ka, kb) {
        if (!ka || !kb || ka === kb) return false;
        const pa = TradePolicy._peek(ka), pb = TradePolicy._peek(kb);
        return !!((pa && pa.embargo && pa.embargo[kb.id]) || (pb && pb.embargo && pb.embargo[ka.id]));
    },

    hasTreaty(ka, kb) {
        if (!ka || !kb || ka === kb) return false;
        const pa = TradePolicy._peek(ka), pb = TradePolicy._peek(kb);
        return !!(pa && pa.treaty && pa.treaty[kb.id] && pb && pb.treaty && pb.treaty[ka.id]);
    },

    /** Does the realm ban the export of the category? */
    banned(kingdom, cat) {
        const p = TradePolicy._peek(kingdom);
        return !!(p && p.bans && p.bans[cat]);
    },

    /** The import tariff a realm charges on a category from `fromId` (its retaliation on that realm included). */
    importTariff(kingdom, cat, fromId = null) {
        const p = TradePolicy._peek(kingdom);
        if (!p) return 0;
        return _num(p.imp && p.imp[cat]) + (fromId != null ? _num(p.retal && p.retal[fromId]) : 0);
    },

    exportTariff(kingdom, cat) {
        const p = TradePolicy._peek(kingdom);
        return p ? _num(p.exp && p.exp[cat]) : 0;
    },

    /**
     * The duty on goods of `cat` moving from realm `ek` to realm `ik` (either
     * may be null — an independent town): the importer's tariff (with its
     * retaliation on the exporter) + the exporter's export tariff; waived by
     * a treaty; Infinity when the exporter bans the category.
     * @returns {{ total:number, imp:number }}
     */
    duty(ek, ik, cat) {
        if (ek && ek === ik) return { total: 0, imp: 0 };
        if (ek && TradePolicy.banned(ek, cat)) return { total: Infinity, imp: 0 };
        if (ek && ik && TradePolicy.hasTreaty(ek, ik)) return { total: 0, imp: 0 };
        const imp = ik ? TradePolicy.importTariff(ik, cat, ek ? ek.id : FREE) : 0;
        const exp = ek ? TradePolicy.exportTariff(ek, cat) : 0;
        return { total: imp + exp, imp };
    },

    /** Average import tariff a realm charges on goods from `fromId` (over the categories). */
    avgImport(kingdom, fromId = null) {
        const C = TradePolicy.config();
        if (!C.catIds.length) return 0;
        let s = 0;
        for (const c of C.catIds) s += TradePolicy.importTariff(kingdom, c, fromId);
        return s / C.catIds.length;
    },

    // ── Hooks into the market tick ────────────────────────

    _cache(world) {
        const st = world.tradePolicy;
        const ver = st && typeof st.ver === 'number' ? st.ver : TradePolicy.state(world).ver;
        const day = world.day;
        // (the last world's cache, then the configs once a day: this is read for every link)
        if (_last.world === world && _last.c.ver === ver && _last.c.day === day) return _last.c;
        let c = _caches.get(world);
        if (c && c.ver === ver && c.day === day) { _last.world = world; _last.c = c; return c; }
        const cfg = TradePolicy.config(), m = SettlementMarket.config();
        if (!c || c.ver !== ver || c.cfg !== cfg || c.m !== m) c = { ver, cfg, m, pairs: new Map() };
        c.day = day;
        _caches.set(world, c);
        _last.world = world;
        _last.c = c;
        return c;
    },

    /** Duty tables for goods moving from realm `ek` to `ik`: { arr|null, impShare, factor }. */
    _pair(world, ek, ik, c = TradePolicy._cache(world)) {
        const ko = ek || NONE, ki = ik || NONE;
        let row = c.pairs.get(ko);
        if (!row) { row = new Map(); c.pairs.set(ko, row); }
        let e = row.get(ki);
        if (e) return e;
        const cats = TradePolicy._goodCats();
        const n = cats.length;
        let arr = null, impSum = 0, totSum = 0;
        const byCat = {};
        for (let i = 0; i < n; i++) {
            const cat = cats[i];
            let d = byCat[cat];
            if (!d) d = byCat[cat] = TradePolicy.duty(ek, ik, cat);
            if (d.total > 0) {
                if (!arr) arr = new Float64Array(n);
                arr[i] = d.total;
                if (Number.isFinite(d.total)) { impSum += d.imp; totSum += d.total; }
            }
        }
        const T = TradePolicy.config().treaty;
        const factor = TradePolicy.embargoed(ek, ik) ? 0 : (ek && ik && TradePolicy.hasTreaty(ek, ik) ? 1 + _num(T.linkBoost) : 1);
        e = { arr, impShare: totSum > 0 ? impSum / totSum : 1, factor };
        row.set(ki, e);
        return e;
    },

    /**
     * Today's trade policy on a link between two towns of realms ka and kb
     * (either null): sets link.dutyAB / dutyBA (per-good extra friction, or
     * null) and returns the factor on its trade (0 under an embargo, more
     * under a treaty, 1 otherwise). Called from MarketDynamics._disrupt.
     */
    linkFactor(world, link, ka, kb) {
        if (ka === kb || (!ka && !kb)) {
            link.dutyAB = null;
            link.dutyBA = null;
            return 1;
        }
        const c = TradePolicy._cache(world);
        // (unchanged policies, same realms: the link keeps what it read last time)
        if (link._tp === c && link._tpA === ka && link._tpB === kb) return link._tpF;
        const ab = TradePolicy._pair(world, ka, kb, c), ba = TradePolicy._pair(world, kb, ka, c);
        link.dutyAB = ab.arr;
        link.dutyBA = ba.arr;
        link.impAB = ab.impShare;
        link.impBA = ba.impShare;
        link._tp = c; link._tpA = ka; link._tpB = kb; link._tpF = ab.factor;
        return ab.factor;
    },

    /**
     * Bank the duties the day's NPC trade paid (link.paidAB / paidBA, left by
     * SettlementMarket.flows) into the treasuries: the importer's share to the
     * importer, the rest to the exporter. @returns gold credited
     */
    collect(world, links) {
        if (!world || !Array.isArray(links)) return 0;
        const scale = _num(TradePolicy.config().revenue.scale, 1);
        let total = 0;
        const seen = new Map();
        const kingdomOf = (s) => {
            if (!s || s.kingdom == null) return null;
            let k = seen.get(s.kingdom);
            if (k === undefined) { k = TradePolicy._kingdom(world, s.kingdom); seen.set(s.kingdom, k); }
            return k;
        };
        const credit = (k, g) => {
            if (!k || !(g > 0)) return;
            k.treasury = _num(k.treasury) + g;
            const p = TradePolicy.realm(k);
            p.rev.week = _r3(p.rev.week + g);
            total += g;
        };
        for (const link of links) {
            const pab = link.paidAB, pba = link.paidBA;
            if (!(pab > 0) && !(pba > 0)) continue;
            link.paidAB = 0;
            link.paidBA = 0;
            const ka = kingdomOf(link.a), kb = kingdomOf(link.b);
            if (pab > 0) {
                const imp = pab * scale * _num(link.impAB, 1);
                credit(kb, imp);
                credit(ka, pab * scale - imp);
            }
            if (pba > 0) {
                const imp = pba * scale * _num(link.impBA, 1);
                credit(ka, imp);
                credit(kb, pba * scale - imp);
            }
        }
        return total;
    },

    /**
     * The toll a trader pays entering `realmId` with cargo whose main good is
     * `goodId`, coming from `fromId` (systems/merchantCaravans.js): the
     * realm's import tariff on it (retaliation included), never under the
     * customary `base`; waived by a treaty; doubled under an embargo.
     */
    tollRate(world, realmId, fromId, goodId, base = 0.03) {
        const k = TradePolicy._kingdom(world, realmId);
        if (!k) return base;
        const from = fromId != null ? TradePolicy._kingdom(world, fromId) : null;
        if (from && TradePolicy.hasTreaty(k, from)) return 0;
        const rate = Math.max(base, TradePolicy.importTariff(k, TradePolicy.categoryOf(goodId), fromId != null ? fromId : FREE));
        return from && TradePolicy.embargoed(k, from) ? rate * 2 : rate;
    },

    /** Book a toll paid into a realm's treasury (the treasury itself is credited by the caller). */
    noteToll(world, realmId, amount) {
        const k = TradePolicy._kingdom(world, realmId);
        if (!k || !(amount > 0)) return;
        const p = TradePolicy.realm(k);
        p.rev.tolls = _r3(p.rev.tolls + amount);
        p.rev.week = _r3(p.rev.week + amount);
    },

    // ── The crowns' weekly turn ───────────────────────────

    /** Is this realm's turn today (every turnDays, staggered by realm)? */
    isTurn(world, kingdom) {
        const n = Math.max(1, Math.floor(_num(TradePolicy.config().turnDays, 7)));
        return ((_day(world) + (Utils.hashStr(String(kingdom.id)) >>> 0)) % n) === 0;
    },

    /** Does a Hungry Months event (a famine) reach the realm? */
    _famineIn(world, k) {
        for (const ev of (world && world.activeEvents) || []) {
            if (ev && ev.id === 'famine' && (!ev.kingdomId || ev.kingdomId === k.id || ev.partnerKingdomId === k.id)) return true;
        }
        return false;
    },

    /**
     * A realm town's hunger outside a famine, as Kingship.hunger reads it:
     * 'lean' in the lean weeks (or lean unrest) with thin stores, or a market
     * dearth; else null.
     */
    _hunger(world, e) {
        const s = e.settlement;
        if (!s || !(_num(s.population) > 0)) return null;
        if ((Seasons.isLean(_day(world)) || _num(s.leanMood) > 0) && Economy.foodReserveDays(s) < TradePolicy._leanDays()) return 'lean';
        return SettlementMarket.inDearth(s) ? 'lean' : null;
    },

    /** Days of stores under which a town counts as hungry in the lean weeks (the famine dole's reserveDays). */
    _leanDays() {
        const d = Kingship.edicts();
        if (TradePolicy._ld && TradePolicy._ld.d === d) return TradePolicy._ld.v;
        const v = _num(((d.famine_dole || {}).dole || {}).reserveDays) || 5;
        TradePolicy._ld = { d, v };
        return v;
    },

    /** Does the realm's trade council sit on this turn (every policyEvery turns)? */
    isCouncil(world, kingdom) {
        const n = Math.max(1, Math.floor(_num(TradePolicy.config().turnDays, 7)));
        const every = Math.max(1, Math.floor(_num(TradePolicy.config().policyEvery, 4)));
        return Math.floor((_day(world) + (Utils.hashStr(String(kingdom.id)) >>> 0)) / n) % every === 0;
    },

    /** The realm the player rules, or null. */
    _ruled(world, player) {
        return player ? Throne.ruledKingdom(player, world) : null;
    },

    /**
     * Each realm's towns (today) and trading partners (from the markets'
     * saved links; worked out again when the links are redrawn or a town
     * changes hands).
     */
    _today(world) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : (typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
        // (the views are the live settlements: their realm and place say whether anything changed)
        let sig = views.length, linksAt = null;
        const c = _towns.get(world);
        let same = !!c && c.objs.length === views.length;
        for (let i = 0; i < views.length; i++) {
            const s = views[i];
            if (same && c.objs[i] !== s) same = false;
            if (linksAt === null && s.market) linksAt = s.market.linksAt;
            const kid = s.kingdom;
            let h = 7;
            if (kid != null) {
                h = _kidHash.get(kid);
                if (h === undefined) { h = Utils.hashStr(String(kid)); _kidHash.set(kid, h); }
            }
            sig = (Math.imul(sig, 31) + h + s.q * 131 + s.r) | 0;
        }
        if (same && c.sig === sig && c.linksAt === linksAt) return c;
        const towns = new Map();
        for (const s of views) {
            if (s.kingdom == null) continue;
            let list = towns.get(s.kingdom);
            if (!list) towns.set(s.kingdom, list = []);
            list.push({ q: s.q, r: s.r, settlement: s });
        }
        const partners = new Map();
        const at = new Map();
        for (const list of towns.values()) for (const e of list) at.set(e.q * 100000 + e.r, e.settlement);
        const add = (x, y) => {
            if (x == null || y == null || x === y) return;
            let set = partners.get(x);
            if (!set) partners.set(x, set = new Set());
            set.add(y);
        };
        for (const s of at.values()) {
            const links = s.market && s.market.links;
            if (!Array.isArray(links)) continue;
            for (const l of links) {
                const o = at.get(l[0] * 100000 + l[1]);
                if (!o) continue;
                add(s.kingdom, o.kingdom);
                add(o.kingdom, s.kingdom);
            }
        }
        const out = { sig, linksAt, towns, partners, objs: views.slice() };
        _towns.set(world, out);
        return out;
    },

    /**
     * The day's trade policy: every realm whose turn it is sets its policy
     * (the one the player rules keeps the crown's settings), runs its
     * granary and weighs its partners. @returns {{ notices: object[] }}
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Array.isArray(world.kingdoms)) return out;
        TradePolicy.state(world);
        const ruled = TradePolicy._ruled(world, player);
        let today = null;
        for (const k of world.kingdoms) {
            if (!k || k.isAlive === false || k.id == null) continue;
            if (!TradePolicy.isTurn(world, k)) continue;
            if (!today) today = TradePolicy._today(world);
            // (the links' duty tables are rebuilt only when a policy changes: see _bump)
            TradePolicy._turn(world, k, today, k === ruled, out, player, ruled);
        }
        return out;
    },

    _turn(world, k, today, isRuled, out, player, ruled) {
        const C = TradePolicy.config();
        const p = TradePolicy.realm(k);
        const day = _day(world);
        const towns = today.towns.get(k.id) || [];
        const partnerIds = [...(today.partners.get(k.id) || [])].sort();
        const partners = partnerIds.map(id => TradePolicy._kingdom(world, id)).filter(Boolean);
        // The week's revenue rolls over
        p.rev.total = _r3(p.rev.total + p.rev.week);
        p.rev.last = _r3(p.rev.week);
        p.rev.week = 0;
        p.lastTurn = day;
        // Who is hungry (Kingship.hunger: famine, lean, a market dearth)
        const hungry = [], starving = [];
        const famine = TradePolicy._famineIn(world, k);
        for (const e of towns) {
            const kind = famine ? 'famine' : TradePolicy._hunger(world, e);
            if (!kind) continue;
            hungry.push(e);
            // (a famine, or a market out of bread for weeks — not merely the lean weeks)
            if (kind === 'famine' || SettlementMarket.inDearth(e.settlement)) starving.push(e);
        }
        // The crown's council on trade sits every policyEvery turns (tariffs,
        // treaties, rivals, trade wars); hunger, war and the granary are weekly
        const council = p.lastCouncil == null || TradePolicy.isCouncil(world, k);
        if (!isRuled) {
            if (council) TradePolicy._setTariffs(world, k, p, towns, day);
            TradePolicy._bans(world, k, p, towns, starving, day);
        }
        if (council) p.lastCouncil = day;
        TradePolicy._partners(world, k, p, council ? partners : [], isRuled, day, out, ruled);
        TradePolicy._granary(world, k, p, towns, hungry, isRuled, out, council);
        // The realm's mood: treaties please the merchants, embargoes and trade wars hurt them
        let stab = 0;
        for (const id of Object.keys(p.treaty)) if (TradePolicy._kingdom(world, id)) stab += _num(C.treaty.stability);
        for (const [id, e] of Object.entries(p.embargo)) if (e && e.why !== 'war') stab += _num(C.embargo.stability);
        for (const id of Object.keys(p.wars)) stab += _num(C.tradeWar.stability);
        stab += p.relief;
        p.relief = _r3(p.relief * 0.5);
        const cap = _num(C.stabilityCap, 6);
        p.stab = _r3(_clamp(stab, -cap, cap));
        // The player's realm: the Guild Coalition minds embargoes in peacetime
        if (isRuled && player) {
            const peaceEmbargoes = Object.values(p.embargo).filter(e => e && e.why !== 'war').length;
            if (peaceEmbargoes) TradePolicy._merchants(player, _num(C.ruler.merchants.embargo) * 0.25 * peaceEmbargoes);
        }
    },

    /** An NPC crown's tariffs: its stance, a treasury crisis, its guilds' lobbying. */
    _setTariffs(world, k, p, towns, day) {
        const C = TradePolicy.config();
        p.stance = TradePolicy.naturalStance(k, day);
        const st = TradePolicy.stance(p.stance);
        const f = _obj(k.finance) || {};
        const crisis = _num(k.treasury) < _num(C.crisis.treasuryBelow)
            || _num(f.debtRatio) > _num(C.crisis.debtRatio) || _num(f.missed) > 0;
        p.crisis = crisis;
        // Guilds in the realm's towns lobby for their goods
        const lobby = {};
        const guildCats = TradePolicy._guildCats();
        for (const e of towns) {
            const gs = e.settlement.guilds;
            if (!gs || typeof gs !== 'object') continue;
            for (const gid in gs) {
                for (const cat of guildCats[gid] || []) lobby[cat] = (lobby[cat] || 0) + 1;
            }
        }
        p.lobby = lobby;
        const max = _num(C.maxTariff, 0.35);
        let changed = false;
        for (const cat of C.catIds) {
            let imp = _num(st.imp) * _num(C.catMult.imp[cat], 1);
            let exp = _num(st.exp) * _num(C.catMult.exp[cat], 1);
            if (crisis) {
                imp = imp * _num(C.crisis.mult, 1) + _num(C.crisis.add);
                exp = exp * _num(C.crisis.mult, 1) + _num(C.crisis.add) * 0.5;
            }
            imp += Math.min(_num(C.lobby.cap), _num(lobby[cat]) * _num(C.lobby.perGuild));
            imp = _r3(_clamp(imp, 0, max));
            exp = _r3(_clamp(exp, 0, max));
            if (p.imp[cat] !== imp || p.exp[cat] !== exp) changed = true;
            p.imp[cat] = imp;
            p.exp[cat] = exp;
        }
        if (changed) TradePolicy._bump(world);
    },

    /** The categories each guild (data/guilds.json) guards goods of, memoised. */
    _guildCats() {
        const defs = _obj(DataLoader._gamedata && DataLoader._gamedata.guilds && DataLoader._gamedata.guilds.guilds) || {};
        const C = TradePolicy.config();
        if (TradePolicy._gc && TradePolicy._gc.defs === defs && TradePolicy._gc.c === C) return TradePolicy._gc.map;
        const map = {};
        for (const [gid, d] of Object.entries(defs)) {
            map[gid] = [...new Set((d && Array.isArray(d.goods) ? d.goods : []).map(g => TradePolicy.categoryOf(g)))];
        }
        TradePolicy._gc = { defs, c: C, map };
        return map;
    },

    /** Export bans while the realm starves (famine or dearth); lifted once it is fed (after minDays). */
    _bans(world, k, p, towns, hungry, day) {
        const B = TradePolicy.config().ban;
        const cat = B.category;
        const share = towns.length ? hungry.length / towns.length : 0;
        if (!p.bans[cat] && share >= _num(B.hungryShare, 0.25) && towns.length) {
            p.bans[cat] = { since: day, why: 'famine' };
            TradePolicy._bump(world);
            TradePolicy._record(world, 'ban', { kingdomId: k.id, kingdom: k.name, cat, good: (TradePolicy.category(cat) || {}).label || cat });
        } else if (p.bans[cat] && !hungry.length && day - _num(p.bans[cat].since) >= _num(B.minDays, 21)) {
            delete p.bans[cat];
            TradePolicy._bump(world);
            TradePolicy._record(world, 'ban_lifted', { kingdomId: k.id, kingdom: k.name, cat, good: (TradePolicy.category(cat) || {}).label || cat });
        }
    },

    _relation(a, b) {
        return _num(a && a.relations && a.relations[b.id]);
    },

    _shiftRelation(a, b, amount, cap = 100) {
        if (!a || !b || !amount) return;
        if (!_obj(a.relations)) a.relations = {};
        const now = _num(a.relations[b.id]);
        const next = amount > 0 ? Math.min(Math.max(now, cap), now + amount) : now + amount;
        a.relations[b.id] = _clamp(Math.round(next * 100) / 100, -100, 100);
    },

    _atWar(a, b) {
        return !!(a && b && Array.isArray(a.wars) && a.wars.includes(b.id));
    },

    _sign(world, a, b) {
        const pa = TradePolicy.realm(a), pb = TradePolicy.realm(b);
        const day = _day(world);
        pa.treaty[b.id] = { since: day };
        pb.treaty[a.id] = { since: day };
        delete pa.retal[b.id]; delete pb.retal[a.id];
        delete pa.wars[b.id]; delete pb.wars[a.id];
        TradePolicy._bump(world);
        TradePolicy._record(world, 'treaty', { kingdomId: a.id, kingdom: a.name, other: b.id, otherName: b.name });
    },

    _breakTreaty(world, a, b, why) {
        const pa = TradePolicy.realm(a), pb = TradePolicy.realm(b);
        if (!pa.treaty[b.id] && !pb.treaty[a.id]) return;
        delete pa.treaty[b.id];
        delete pb.treaty[a.id];
        TradePolicy._bump(world);
        TradePolicy._record(world, 'treaty_broken', { kingdomId: a.id, kingdom: a.name, other: b.id, otherName: b.name, why });
    },

    _embargo(world, a, b, why) {
        const pa = TradePolicy.realm(a);
        if (pa.embargo[b.id]) return false;
        pa.embargo[b.id] = { since: _day(world), why };
        TradePolicy._shiftRelation(b, a, _num(TradePolicy.config().embargo.relation));
        TradePolicy._breakTreaty(world, a, b, 'embargo');
        TradePolicy._bump(world);
        TradePolicy._record(world, 'embargo', { kingdomId: a.id, kingdom: a.name, other: b.id, otherName: b.name, why });
        return true;
    },

    _lift(world, a, b) {
        const pa = TradePolicy.realm(a);
        if (!pa.embargo[b.id]) return;
        delete pa.embargo[b.id];
        TradePolicy._bump(world);
        TradePolicy._record(world, 'embargo_lifted', { kingdomId: a.id, kingdom: a.name, other: b.id, otherName: b.name });
    },

    /** Embargoes, treaties and trade wars with each trading partner (and every enemy). */
    _partners(world, k, p, partners, isRuled, day, out, ruled) {
        const C = TradePolicy.config();
        const E = C.embargo, T = C.treaty, W = C.tradeWar;
        const pers = KingdomAI.personalityId(k);
        // Enemies are embargoed (an NPC crown); old war embargoes lifted after the peace holds
        if (!isRuled) {
            for (const id of (Array.isArray(k.wars) ? k.wars.slice().sort() : [])) {
                const e = TradePolicy._kingdom(world, id);
                if (e) TradePolicy._embargo(world, k, e, 'war');
            }
            for (const [id, e] of Object.entries(p.embargo)) {
                const o = TradePolicy._kingdom(world, id);
                if (!o) { delete p.embargo[id]; TradePolicy._bump(world); continue; }
                if (TradePolicy._atWar(k, o)) { e.since = day; continue; }
                const rel = TradePolicy._relation(k, o);
                const waited = e.why === 'war' ? day - _num(e.since) >= _num(E.warLiftDays) : true;
                if (waited && rel > _num(E.liftAbove)) TradePolicy._lift(world, k, o);
            }
        }
        // Treaties hold while relations do (and no war, no embargo)
        for (const id of Object.keys(p.treaty)) {
            const o = TradePolicy._kingdom(world, id);
            if (!o) { delete p.treaty[id]; TradePolicy._bump(world); continue; }
            if (TradePolicy._atWar(k, o) || TradePolicy.embargoed(k, o)) TradePolicy._breakTreaty(world, k, o, 'war');
            else if (TradePolicy._relation(k, o) < _num(T.breakBelow) && !isRuled) TradePolicy._breakTreaty(world, k, o, 'relations');
            else TradePolicy._shiftRelation(k, o, _num(T.relation), _num(T.relationCap, 80));
        }
        for (const o of partners) {
            if (o === k) continue;
            const po = TradePolicy.realm(o);
            const rel = TradePolicy._relation(k, o);
            const atWar = TradePolicy._atWar(k, o);
            if (isRuled || atWar) continue;
            // A bitter rival is embargoed
            if (!p.embargo[o.id] && rel <= _num(E.rivalBelow)
                && _roll(`tp-emb:${k.id}:${o.id}:${day}`) < _num(E.chance) * (pers === 'mercantile' ? 0.5 : 1)) {
                TradePolicy._embargo(world, k, o, 'rival');
                if (o === ruled) TradePolicy._notice(out, '⛔', 'Embargo', `${k.name} has laid an embargo on your realm's trade.`, 'warning');
                continue;
            }
            if (TradePolicy.embargoed(k, o)) continue;
            // Friends sign treaties (the realm the player rules signs only by its crown's word)
            const allied = Array.isArray(k.allies) && k.allies.includes(o.id);
            const bias = _num(TradePolicy.stance(p.stance).treatyBias) + _num(TradePolicy.stance(po.stance).treatyBias);
            if (!p.treaty[o.id] && o !== ruled
                && (rel >= _num(T.relationAt) || (allied && rel >= _num(T.allyAt)))
                && TradePolicy._relation(o, k) >= _num(T.allyAt)
                && _roll(`tp-treaty:${k.id}:${o.id}:${day}`) < _num(T.chance) + bias) {
                TradePolicy._sign(world, k, o);
                continue;
            }
            if (p.treaty[o.id]) continue;
            // Trade wars: answer a partner's higher tariffs with retaliation of our own
            const theirs = TradePolicy.avgImport(o, k.id);
            const mine = TradePolicy.avgImport(k, o.id);
            const retal = _num(p.retal[o.id]);
            const angry = theirs - mine > _num(W.margin) && (p.stance !== 'free_trade' || rel < 0);
            if (angry && retal < _num(W.cap) && _roll(`tp-war:${k.id}:${o.id}:${day}`) < _num(W.chance) + (rel < 0 ? 0.2 : 0)) {
                p.retal[o.id] = _r3(Math.min(_num(W.cap), retal + _num(W.step)));
                TradePolicy._bump(world);
                TradePolicy._shiftRelation(k, o, _num(W.relation));
                TradePolicy._shiftRelation(o, k, _num(W.relation));
                if (!p.wars[o.id]) {
                    p.wars[o.id] = { since: day };
                    TradePolicy._record(world, 'trade_war', { kingdomId: k.id, kingdom: k.name, other: o.id, otherName: o.name });
                }
                if (o === ruled) TradePolicy._notice(out, '📈', 'Retaliatory Tariffs', `${k.name} answers your tariffs: its duty on goods from your realm rises to ${Math.round(TradePolicy.avgImport(k, o.id) * 100)}%.`, 'warning');
            } else if (retal > 0 && (theirs - mine <= 0 || rel > _num(W.calmAbove))) {
                const next = _r3(Math.max(0, retal - _num(W.decay)));
                TradePolicy._bump(world);
                if (next > 0) p.retal[o.id] = next;
                else {
                    delete p.retal[o.id];
                    if (p.wars[o.id]) {
                        delete p.wars[o.id];
                        TradePolicy._record(world, 'trade_peace', { kingdomId: k.id, kingdom: k.name, other: o.id, otherName: o.name });
                    }
                }
            }
        }
        // Trade wars with realms no longer trading (fallen, cut off) end quietly
        for (const id of Object.keys(p.wars)) if (!TradePolicy._kingdom(world, id) || !(p.retal[id] > 0)) delete p.wars[id];
        for (const id of Object.keys(p.retal)) if (!TradePolicy._kingdom(world, id)) { delete p.retal[id]; TradePolicy._bump(world); }
    },

    /** The state granary: release grain in hungry towns, buy where grain is in glut. */
    _granary(world, k, p, towns, hungry, isRuled, out, buy = true) {
        const G = TradePolicy.config().granary;
        const g = p.granary;
        if (!isRuled) {
            if (_num(k.treasury) >= _num(G.minTreasury)) g.on = true;
            else if (_num(k.treasury) < _num(G.minTreasury) / 2) g.on = false;
        }
        if (g.grain > 0) g.grain = _r3(g.grain * (1 - _num(G.spoil)));
        let released = 0, fed = 0;
        for (const e of hungry) {
            if (!(g.grain >= 1)) break;
            const s = e.settlement;
            const need = SettlementMarket.need(s, 'grain') + SettlementMarket.need(s, 'bread') + SettlementMarket.need(s, 'flour');
            const want = Math.min(_num(G.maxRelease, 80), Math.ceil(Math.max(1, need) * _num(G.releaseDays, 7)));
            const give = Math.floor(Math.min(g.grain, want));
            if (!(give > 0)) continue;
            g.grain = _r3(g.grain - give);
            SettlementMarket.add(s, 'grain', give);
            if (!s.economy) Economy.initSettlement(s);
            s.economy.food = _num(s.economy.food) + give;
            released += give;
            fed++;
        }
        if (released > 0) {
            g.released = _r3(g.released + released);
            p.relief = _r3(p.relief + _num(G.stability) * fed);
            if (released >= _num(G.heraldMin, 60) && (g.lastHerald == null || _day(world) - g.lastHerald >= 30)) {
                g.lastHerald = _day(world);
                TradePolicy._record(world, 'granary', { kingdomId: k.id, kingdom: k.name, n: Math.round(released), towns: fed });
            }
            if (isRuled) TradePolicy._notice(out, '🌾', 'The Royal Granary', `${Math.round(released)} grain from the royal granary goes to ${fed} hungry town${fed === 1 ? '' : 's'} of ${k.name}.`, 'info');
        }
        // (it buys when the council sits; it feeds the hungry every week)
        if (!g.on || !buy) return;
        const pop = towns.reduce((s, e) => s + _num(e.settlement.population), 0);
        const cap = pop * _num(G.capPerHead);
        if (g.grain >= cap) return;
        const M = SettlementMarket.config();
        const gi = M.idx.grain;
        if (gi === undefined) return;
        const base = SettlementMarket._bases()[gi];
        if (!(base > 0)) return;
        if (_num(k.treasury) < _num(G.minTreasury)) return;
        const glutRatio = Math.pow(_clamp(_num(G.buyBelow, 0.85), 0.1, 1), -1 / Math.max(0.1, _num(M.price.elasticity, 0.6))) * 0.9;
        const hungrySet = new Set(hungry.map(e => e.settlement));
        let buys = 0;
        for (const e of towns) {
            if (g.grain >= cap || buys >= _num(G.maxTowns, 4)) break;
            const s = e.settlement;
            if (hungrySet.has(s) || !s.market) continue;
            // (the stock's moving average against its target first: cheap, and most towns are not in glut)
            const tr = s.market.trend;
            if (!tr || !(_num(tr.grain) >= glutRatio)) continue;
            if (SettlementMarket.scarcity(s, 'grain') > _num(G.buyBelow, 0.85)) continue;
            const surplus = SettlementMarket.stock(s, 'grain') - SettlementMarket.target(s, 'grain');
            const qty = Math.floor(Math.min(surplus * _num(G.buyShare), _num(G.maxBuy, 60), cap - g.grain));
            if (!(qty >= 1)) continue;
            const price = SettlementMarket.value(world, s, e.tile || world.getTile(e.q, e.r), 'grain', base);
            const cost = Math.ceil(price * qty);
            if (_num(k.treasury) - cost < _num(G.minTreasury) / 2) break;
            const got = SettlementMarket.take(s, 'grain', qty);
            if (!(got > 0)) continue;
            k.treasury = _num(k.treasury) - cost;
            g.grain = _r3(g.grain + got);
            g.bought = _r3(g.bought + got);
            g.spent = _r3(g.spent + cost);
            buys++;
        }
    },

    _notice(out, icon, title, text, type = 'info') {
        if (out && Array.isArray(out.notices)) out.notices.push({ icon, title, text, type });
    },

    /** Shift the Guild Coalition (the merchants' council faction) — the realm the player rules. */
    _merchants(player, amount) {
        if (!player || !amount) return;
        const st = Councils._ensureState(player);
        const f = st && st.factions && st.factions.merchants;
        if (f) f.support = _clamp(_num(f.support) + amount, 0, 100);
    },

    // ── The crown's hand (the realm the player rules) ──────

    _rulerCheck(player, world) {
        const k = TradePolicy._ruled(world, player);
        if (!k) return { k: null, reason: 'You rule no realm.' };
        return { k, p: TradePolicy.realm(k) };
    },

    /** Set an import ('imp') or export ('exp') tariff on a category (snapped to the levels). */
    setTariff(player, world, side, cat, rate) {
        const { k, p, reason } = TradePolicy._rulerCheck(player, world);
        if (!k) return { success: false, reason };
        const C = TradePolicy.config();
        if (side !== 'imp' && side !== 'exp') return { success: false, reason: 'Import or export?' };
        if (!C.catIds.includes(cat)) return { success: false, reason: 'No such goods.' };
        const levels = C.ruler.levels;
        const r = levels.reduce((best, l) => (Math.abs(l - rate) < Math.abs(best - rate) ? l : best), levels[0]);
        const old = _num(p[side][cat]);
        if (old === r) return { success: false, reason: 'That is already the duty.' };
        p[side][cat] = r;
        p.manual = true;
        const M = C.ruler.merchants;
        let shift = (r - old) * _num(M.perTariff);
        if (side === 'imp' && r > old && _num(p.lobby[cat]) > 0) shift = _num(M.lobbyPlease);
        TradePolicy._merchants(player, shift);
        TradePolicy._bump(world);
        const label = (TradePolicy.category(cat) || {}).label || cat;
        return { success: true, message: `The ${side === 'imp' ? 'import' : 'export'} duty on ${label.toLowerCase()} is now ${Math.round(r * 100)}%.${shift > 0 ? ' The Guild Coalition approves.' : shift < 0 ? ' The Guild Coalition grumbles.' : ''}` };
    },

    /** Ban (or allow again) the export of a category. */
    toggleBan(player, world, cat) {
        const { k, p, reason } = TradePolicy._rulerCheck(player, world);
        if (!k) return { success: false, reason };
        if (!TradePolicy.config().catIds.includes(cat)) return { success: false, reason: 'No such goods.' };
        const label = (TradePolicy.category(cat) || {}).label || cat;
        if (p.bans[cat]) {
            delete p.bans[cat];
            TradePolicy._record(world, 'ban_lifted', { kingdomId: k.id, kingdom: k.name, cat, good: label, own: true });
            TradePolicy._merchants(player, -_num(TradePolicy.config().ruler.merchants.ban));
            TradePolicy._bump(world);
            return { success: true, message: `${label} may leave ${k.name} again.` };
        }
        p.bans[cat] = { since: _day(world), why: 'crown' };
        p.manual = true;
        TradePolicy._record(world, 'ban', { kingdomId: k.id, kingdom: k.name, cat, good: label, own: true });
        TradePolicy._merchants(player, _num(TradePolicy.config().ruler.merchants.ban));
        TradePolicy._bump(world);
        return { success: true, message: `No ${label.toLowerCase()} may leave ${k.name} by the crown's order.` };
    },

    /** Lay (on = true) or lift an embargo on a realm. */
    setEmbargo(player, world, kid, on = true) {
        const { k, p, reason } = TradePolicy._rulerCheck(player, world);
        if (!k) return { success: false, reason };
        const o = TradePolicy._kingdom(world, kid);
        if (!o || o === k) return { success: false, reason: 'No such realm.' };
        const R = TradePolicy.config().ruler;
        if (on) {
            if (p.embargo[o.id]) return { success: false, reason: `${o.name} is already under embargo.` };
            TradePolicy._embargo(world, k, o, TradePolicy._atWar(k, o) ? 'war' : 'crown');
            TradePolicy._shiftRelation(o, k, _num(R.embargoRelation));
            TradePolicy._merchants(player, _num(R.merchants.embargo));
            TradePolicy._bump(world);
            return { success: true, message: `No trade with ${o.name}: the roads and harbours are closed to its goods.` };
        }
        if (!p.embargo[o.id]) return { success: false, reason: `${o.name} is not under embargo.` };
        TradePolicy._lift(world, k, o);
        TradePolicy._merchants(player, -_num(R.merchants.embargo) * 0.5);
        TradePolicy._bump(world);
        return { success: true, message: `Trade with ${o.name} may resume.` };
    },

    /** What a treaty proposal to `kid` stands on: { ok, reason, need, rel }. */
    treatyQuote(player, world, kid) {
        const k = TradePolicy._ruled(world, player);
        const o = TradePolicy._kingdom(world, kid);
        if (!k) return { ok: false, reason: 'You rule no realm.' };
        if (!o || o === k) return { ok: false, reason: 'No such realm.' };
        if (TradePolicy.hasTreaty(k, o)) return { ok: false, reason: `You already trade freely with ${o.name}.` };
        if (TradePolicy._atWar(k, o)) return { ok: false, reason: `You are at war with ${o.name}.` };
        if (TradePolicy.embargoed(k, o)) return { ok: false, reason: 'An embargo stands between your realms.' };
        const T = TradePolicy.config().treaty;
        const ch = Kingship.councillor(player, world, 'chancellor');
        const allied = Array.isArray(k.allies) && k.allies.includes(o.id);
        const need = Math.max(0, (allied ? _num(T.allyAt) : _num(T.relationAt)) - (ch ? _num(ch.competence) * _num(TradePolicy.config().ruler.chancellorPer) : 0));
        const rel = TradePolicy._relation(o, k);
        return rel >= need ? { ok: true, need, rel } : { ok: false, need, rel, reason: `${o.name} will not sign (relations ${Math.round(rel)}, it wants ${Math.round(need)}).` };
    },

    proposeTreaty(player, world, kid) {
        const q = TradePolicy.treatyQuote(player, world, kid);
        if (!q.ok) return { success: false, reason: q.reason };
        const k = TradePolicy._ruled(world, player), o = TradePolicy._kingdom(world, kid);
        TradePolicy._sign(world, k, o);
        TradePolicy._merchants(player, _num(TradePolicy.config().ruler.merchants.treaty));
        TradePolicy._bump(world);
        return { success: true, message: `A trade treaty with ${o.name}: duties waived both ways.` };
    },

    cancelTreaty(player, world, kid) {
        const { k, reason } = TradePolicy._rulerCheck(player, world);
        if (!k) return { success: false, reason };
        const o = TradePolicy._kingdom(world, kid);
        if (!o || !TradePolicy.hasTreaty(k, o)) return { success: false, reason: 'No treaty to end.' };
        TradePolicy._breakTreaty(world, k, o, 'crown');
        TradePolicy._shiftRelation(o, k, _num(TradePolicy.config().ruler.cancelRelation));
        TradePolicy._merchants(player, -_num(TradePolicy.config().ruler.merchants.treaty));
        TradePolicy._bump(world);
        return { success: true, message: `The treaty with ${o.name} is ended.` };
    },

    setGranary(player, world, on) {
        const { k, p, reason } = TradePolicy._rulerCheck(player, world);
        if (!k) return { success: false, reason };
        p.granary.on = !!on;
        TradePolicy._merchants(player, on ? _num(TradePolicy.config().ruler.merchants.granary) : 0);
        return { success: true, message: on ? `The royal granaries of ${k.name} will buy grain in good years and feed the hungry in bad.` : 'The royal granaries buy no more grain (what is stored still goes to the hungry).' };
    },

    // ── The player as a merchant ───────────────────────────

    playerState(player) {
        if (!player) return null;
        let st = player.tradePolicy;
        if (!_obj(st)) st = player.tradePolicy = { ledger: {}, licences: {}, stats: {} };
        if (!_obj(st.ledger)) st.ledger = {};
        if (!_obj(st.licences)) st.licences = {};
        if (!_obj(st.stats)) st.stats = {};
        for (const k of ['duties', 'smuggled', 'caught', 'breaches', 'treaties', 'licences']) st.stats[k] = _num(st.stats[k]);
        return st;
    },

    /** Does the player hold a live licence from this realm? */
    hasLicence(player, world, kid) {
        const st = player && _obj(player.tradePolicy);
        const until = st && st.licences && st.licences[kid];
        return _num(until) > _day(world);
    },

    /** Book goods bought at a settlement by the realm they were bought in. */
    onBuy(player, settlement, goodId, qty) {
        if (!player || !settlement || !(qty > 0)) return;
        const st = TradePolicy.playerState(player);
        const key = settlement.kingdom != null ? String(settlement.kingdom) : FREE;
        const row = st.ledger[goodId] || (st.ledger[goodId] = {});
        row[key] = _r3(_num(row[key]) + qty);
    },

    /** The ledger of a good, never more than the player holds (oldest bookings shrink in proportion). */
    _ledger(player, goodId) {
        const st = TradePolicy.playerState(player);
        const row = st.ledger[goodId];
        if (!row) return {};
        const held = _num(player.inventory && player.inventory[goodId]);
        let sum = 0;
        for (const v of Object.values(row)) sum += _num(v);
        if (!(held > 0)) { delete st.ledger[goodId]; return {}; }
        if (sum > held) {
            const f = held / sum;
            for (const k of Object.keys(row)) row[k] = _r3(_num(row[k]) * f);
        }
        return row;
    },

    /**
     * May the player sell `qty` of a good here, and what do the crowns take?
     * Units booked from a realm under embargo with this one can't be sold
     * openly; units from another realm pay this realm's import tariff
     * (waived by a treaty or the player's licence).
     * @returns {{ ok, reason?, mult, rate, held, embargoed, breach: [{kid, share}] }}
     */
    saleCheck(player, world, settlement, goodId, qty) {
        const out = { ok: true, mult: 1, rate: 0, held: 0, embargoed: 0, breach: [] };
        if (!player || !world || !settlement) return out;
        const held = _num(player.inventory && player.inventory[goodId]);
        out.held = held;
        if (!(held > 0)) return out;
        const row = TradePolicy._ledger(player, goodId);
        const S = settlement.kingdom != null ? TradePolicy._kingdom(world, settlement.kingdom) : null;
        const cat = TradePolicy.categoryOf(goodId);
        const licensed = S && TradePolicy.hasLicence(player, world, S.id);
        let rateSum = 0, emb = 0;
        let embName = null;
        for (const [key, units] of Object.entries(row)) {
            if (!(units > 0)) continue;
            const R = key === FREE ? null : TradePolicy._kingdom(world, key);
            if (S && R === S) continue;
            if (S && R && TradePolicy.embargoed(S, R)) { emb += units; embName = embName || R.name; continue; }
            if (R && TradePolicy.banned(R, cat) && !TradePolicy.hasLicence(player, world, R.id)) out.breach.push({ kid: R.id, share: units / held });
            if (!S || licensed || (R && TradePolicy.hasTreaty(S, R))) continue;
            rateSum += units * TradePolicy.importTariff(S, cat, R ? R.id : FREE);
        }
        out.embargoed = emb;
        if (qty > held - emb + 1e-9) {
            return { ...out, ok: false, reason: `${Math.ceil(emb)} of your ${goodId.replace(/_/g, ' ')} come from ${embName}, under embargo in ${S ? S.name : 'this realm'}. Only a smuggler will move them here.` };
        }
        out.rate = Math.min(0.9, rateSum / held);
        out.mult = 1 - out.rate;
        return out;
    },

    /** After a sale: the duty to the treasury, the ledger drawn down, export-ban breaches as heat. */
    onSale(player, world, settlement, goodId, qty, earned, check) {
        if (!player || !check || !(check.held > 0)) return { duty: 0, heat: 0 };
        const st = TradePolicy.playerState(player);
        let duty = 0;
        const S = settlement && settlement.kingdom != null ? TradePolicy._kingdom(world, settlement.kingdom) : null;
        if (S && check.rate > 0 && earned > 0) {
            duty = Math.round(earned * check.rate / Math.max(0.1, 1 - check.rate));
            S.treasury = _num(S.treasury) + duty;
            const p = TradePolicy.realm(S);
            p.rev.week = _r3(p.rev.week + duty);
            st.stats.duties += duty;
        }
        let heat = 0;
        const B = TradePolicy.config().player.breach;
        for (const b of check.breach) {
            const units = qty * b.share;
            const h = Math.min(_num(B.maxHeat, 12), units * _num(B.heatPerUnit));
            if (h > 0) {
                Underworld.addHeat(player, b.kid, h, world);
                heat += h;
                st.stats.breaches++;
            }
        }
        // Draw the ledger down (embargoed units stay booked: they can only be smuggled)
        const row = st.ledger[goodId];
        if (row) {
            const free = check.held - check.embargoed;
            const f = free > 0 ? Math.max(0, 1 - qty / free) : 1;
            for (const key of Object.keys(row)) {
                const R = key === FREE ? null : TradePolicy._kingdom(world, key);
                if (S && R && R !== S && TradePolicy.embargoed(S, R)) continue;
                row[key] = _r3(_num(row[key]) * f);
                if (!(row[key] > 0.01)) delete row[key];
            }
            if (!Object.keys(row).length) delete st.ledger[goodId];
        }
        return { duty, heat };
    },

    /** What smuggling `goodId` here would pay and risk: { ok, reason?, units, price, chance }. */
    smuggleQuote(player, world, tile, goodId) {
        const s = tile && tile.settlement;
        if (!player || !s) return { ok: false, reason: 'There is no market here.' };
        const S = s.kingdom != null ? TradePolicy._kingdom(world, s.kingdom) : null;
        if (!S) return { ok: false, reason: 'No crown here bans anything.' };
        const check = TradePolicy.saleCheck(player, world, s, goodId, 0);
        const units = Math.floor(check.embargoed + 1e-9);
        if (!(units > 0)) return { ok: false, reason: 'You carry nothing under embargo here.' };
        const P = TradePolicy.config().player.smuggle;
        const M = SettlementMarket.config();
        const base = M.idx[goodId] !== undefined ? SettlementMarket._bases()[M.idx[goodId]] : 0;
        const value = base > 0 ? SettlementMarket.value(world, s, tile, goodId, base) : 0;
        const price = Math.max(1, Math.floor(value * _num(P.sellShare, 0.7) * _num(P.premium, 1.25)));
        const chance = _clamp(_num(P.catchBase) + Underworld.getHeat(player, S.id) * _num(P.perHeat)
            + Underworld.guardStrength(s, S) * _num(P.perGuard) - _num(player.skills && player.skills.stealth, 1) * _num(P.stealth), 0.03, 0.85);
        return { ok: true, units, price, chance, kingdom: S };
    },

    /**
     * Run embargoed goods past the watch: a premium on the town's value, or —
     * caught — the goods taken, a fine, heat and maybe arrest. 1 AP.
     */
    smuggle(player, world, tile, goodId, qty = null) {
        const q = TradePolicy.smuggleQuote(player, world, tile, goodId);
        if (!q.ok) return { success: false, reason: q.reason };
        const n = Math.min(q.units, Math.max(1, Math.floor(_num(qty, q.units))));
        if ((player.actionPoints || 0) < 1) return { success: false, reason: 'A smuggling run costs 1 action point.' };
        player.actionPoints -= 1;
        const P = TradePolicy.config().player.smuggle;
        const st = TradePolicy.playerState(player);
        const s = tile.settlement;
        const S = q.kingdom;
        // The embargoed bookings go with the goods
        const row = st.ledger[goodId] || {};
        let left = n;
        for (const key of Object.keys(row).sort()) {
            const R = key === FREE ? null : TradePolicy._kingdom(world, key);
            if (!R || R === S || !TradePolicy.embargoed(S, R)) continue;
            const take = Math.min(left, _num(row[key]));
            row[key] = _r3(_num(row[key]) - take);
            if (!(row[key] > 0.01)) delete row[key];
            left -= take;
            if (left <= 0) break;
        }
        player.inventory[goodId] = _num(player.inventory[goodId]) - n;
        if (player.inventory[goodId] <= 0) delete player.inventory[goodId];
        const caught = Utils.random() < q.chance;
        if (caught) {
            const fine = Math.min(_num(player.gold), Math.floor(q.price * n * _num(P.fineShare, 0.5)));
            player.gold = _num(player.gold) - fine;
            S.treasury = _num(S.treasury) + fine;
            st.stats.caught++;
            Underworld.recordCrime(player, world, 'smuggling', { kingdom: S.id, caught: true, q: tile.q, r: tile.r });
            const arrest = Underworld._maybeArrest(player, world, s, 'smuggling past the embargo', _num(P.arrest, 0.25));
            return { success: true, caught: true, fine, arrested: !!arrest, text: `The watch of ${s.name} seized ${n} ${goodId.replace(/_/g, ' ')} at the gate and fined you ${fine}g.${arrest ? ` ${arrest.text}` : ''}` };
        }
        const earned = q.price * n;
        player.gold = _num(player.gold) + earned;
        SettlementMarket.add(s, goodId, n);
        st.stats.smuggled += n;
        if (player.financeToday && player.financeToday.income) {
            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + earned;
        }
        Underworld.recordCrime(player, world, 'smuggling', { kingdom: S.id, q: tile.q, r: tile.r });
        return { success: true, caught: false, earned, text: `${n} ${goodId.replace(/_/g, ' ')} slipped past the embargo for ${earned}g.` };
    },

    /** A crown's trading licence: { ok, reason?, cost, days }. */
    licenceQuote(player, world, kid) {
        const k = TradePolicy._kingdom(world, kid);
        if (!player || !k) return { ok: false, reason: 'No such realm.' };
        const L = TradePolicy.config().player.licence;
        if (TradePolicy._ruled(world, player) === k) return { ok: false, reason: 'Your own crown needs no petition.' };
        const rep = _num(player.reputation && player.reputation[k.id]);
        if (rep < _num(L.minRep)) return { ok: false, reason: `${k.name}'s court will not hear you (reputation ${Math.round(rep)}).` };
        if (Underworld.getHeat(player, k.id) >= _num(L.maxHeat)) return { ok: false, reason: `The watch of ${k.name} knows your name too well.` };
        const towns = (k.settlements || []).length;
        let cost = Math.round(_num(L.base) + _num(L.perTown) * towns);
        if (rep >= _num(L.goodRep)) cost = Math.round(cost * _num(L.discount, 1));
        return { ok: true, cost, days: _num(L.days, 120), rep, kingdom: k };
    },

    /** Petition a crown for a licence: its tariffs and export bans waived for you, for a fee into its treasury. */
    petitionLicence(player, world, kid) {
        const q = TradePolicy.licenceQuote(player, world, kid);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.cost) return { success: false, reason: `The licence costs ${q.cost}g.` };
        const st = TradePolicy.playerState(player);
        player.gold -= q.cost;
        q.kingdom.treasury = _num(q.kingdom.treasury) + q.cost;
        const from = Math.max(_day(world), _num(st.licences[q.kingdom.id]));
        st.licences[q.kingdom.id] = from + q.days;
        st.stats.licences++;
        return { success: true, spent: q.cost, message: `${q.kingdom.name} grants you a trading licence until day ${st.licences[q.kingdom.id]}: its duties and export bans do not bind you.` };
    },

    /** May the player broker a treaty between two realms? { ok, reason?, cost } */
    brokerQuote(player, world, kidA, kidB) {
        const a = TradePolicy._kingdom(world, kidA), b = TradePolicy._kingdom(world, kidB);
        if (!player || !a || !b || a === b) return { ok: false, reason: 'Choose two realms.' };
        const B = TradePolicy.config().player.broker;
        if (TradePolicy.hasTreaty(a, b)) return { ok: false, reason: `${a.name} and ${b.name} already trade freely.` };
        if (TradePolicy._atWar(a, b)) return { ok: false, reason: `${a.name} and ${b.name} are at war.` };
        if (TradePolicy.embargoed(a, b)) return { ok: false, reason: 'An embargo stands between them.' };
        const ruled = TradePolicy._ruled(world, player);
        if (ruled === a || ruled === b) return { ok: false, reason: 'Propose it from your Royal Court.' };
        const rel = Math.min(TradePolicy._relation(a, b), TradePolicy._relation(b, a));
        if (rel < _num(B.minRelation)) return { ok: false, reason: `${a.name} and ${b.name} are too cold to each other (relations ${Math.round(rel)}).` };
        for (const k of [a, b]) {
            const rep = _num(player.reputation && player.reputation[k.id]);
            if (rep < _num(B.minRep)) return { ok: false, reason: `${k.name}'s court does not know you well enough (reputation ${Math.round(rep)}, ${_num(B.minRep)} needed).` };
        }
        return { ok: true, cost: _num(B.cost), a, b };
    },

    /** Broker a trade treaty: gifts to both courts, the treaty signed, prestige and goodwill. */
    brokerTreaty(player, world, kidA, kidB) {
        const q = TradePolicy.brokerQuote(player, world, kidA, kidB);
        if (!q.ok) return { success: false, reason: q.reason };
        const B = TradePolicy.config().player.broker;
        if (_num(player.gold) < q.cost) return { success: false, reason: `The gifts and feasts cost ${q.cost}g.` };
        if ((player.actionPoints || 0) < _num(B.ap, 1)) return { success: false, reason: `It takes ${_num(B.ap, 1)} action point.` };
        player.gold -= q.cost;
        player.actionPoints -= _num(B.ap, 1);
        q.a.treasury = _num(q.a.treasury) + Math.floor(q.cost / 2);
        q.b.treasury = _num(q.b.treasury) + Math.floor(q.cost / 2);
        TradePolicy._sign(world, q.a, q.b);
        TradePolicy._shiftRelation(q.a, q.b, _num(B.relation));
        TradePolicy._shiftRelation(q.b, q.a, _num(B.relation));
        if (!_obj(player.reputation)) player.reputation = {};
        for (const k of [q.a, q.b]) player.reputation[k.id] = _clamp(_num(player.reputation[k.id]) + _num(B.rep), -100, 100);
        if (player.house) House.award(player.house, _num(B.prestige), `Brokered the trade treaty of ${q.a.name} and ${q.b.name}`, _day(world));
        TradePolicy.playerState(player).stats.treaties++;
        TradePolicy._bump(world);
        return { success: true, spent: q.cost, message: `${q.a.name} and ${q.b.name} sign a trade treaty at your table. Duties are waived between them.` };
    },

    // ── For the screens and the Steward ────────────────────

    /** Notices for one good at this market: the duty on it, a ban, an embargo. Pure. */
    goodNotice(player, world, settlement, goodId) {
        if (!world || !settlement) return null;
        const S = settlement.kingdom != null ? TradePolicy._kingdom(world, settlement.kingdom) : null;
        const cat = TradePolicy.categoryOf(goodId);
        const out = { cat, banned: false, importDuty: 0, foreign: 0, embargoed: 0, dutyRate: 0 };
        if (S) {
            out.banned = TradePolicy.banned(S, cat) && !(player && TradePolicy.hasLicence(player, world, S.id));
            out.importDuty = TradePolicy.importTariff(S, cat);
        }
        const st = player && _obj(player.tradePolicy);
        const row = st && st.ledger && st.ledger[goodId];
        const held = _num(player && player.inventory && player.inventory[goodId]);
        if (row && held > 0) {
            let sum = 0, rate = 0, emb = 0;
            for (const [key, v] of Object.entries(row)) {
                const R = key === FREE ? null : TradePolicy._kingdom(world, key);
                if (S && R === S) continue;
                sum += _num(v);
                if (S && R && TradePolicy.embargoed(S, R)) emb += _num(v);
                else if (S && !TradePolicy.hasLicence(player, world, S.id) && !(R && TradePolicy.hasTreaty(S, R))) rate += _num(v) * TradePolicy.importTariff(S, cat, R ? R.id : FREE);
            }
            const scale = sum > held ? held / sum : 1;
            out.foreign = Math.floor(sum * scale + 1e-9);
            out.embargoed = Math.floor(emb * scale + 1e-9);
            out.dutyRate = held > 0 ? Math.min(0.9, rate * scale / held) : 0;
        }
        return out;
    },

    /** A realm's policy for the panels. Pure (no backfill). */
    summary(world, kingdom) {
        const p = TradePolicy._peek(kingdom);
        const C = TradePolicy.config();
        const name = (id) => (TradePolicy._kingdom(world, id) || {}).name || null;
        const stance = TradePolicy.stance(p && p.stance ? p.stance : TradePolicy.naturalStance(kingdom, 0));
        const cats = C.catIds.map(id => ({
            ...TradePolicy.category(id),
            imp: p ? _num(p.imp[id]) : 0, exp: p ? _num(p.exp[id]) : 0,
            banned: !!(p && p.bans[id]), lobby: p ? _num(p.lobby[id]) : 0,
        }));
        return {
            id: kingdom.id, name: kingdom.name, stance, cats, crisis: !!(p && p.crisis),
            avgImport: TradePolicy.avgImport(kingdom),
            embargo: p ? Object.keys(p.embargo).map(id => ({ id, name: name(id), why: p.embargo[id].why, since: p.embargo[id].since })).filter(x => x.name) : [],
            treaties: p ? Object.keys(p.treaty).map(id => ({ id, name: name(id) })).filter(x => x.name) : [],
            retal: p ? Object.entries(p.retal).map(([id, v]) => ({ id, name: name(id), rate: v })).filter(x => x.name) : [],
            granary: p ? { ...p.granary } : null,
            revenue: p ? { ...p.rev } : null,
            stab: p ? p.stab : 0,
        };
    },

    // ── Save / load ────────────────────────────────────────

    serialize(world) {
        const st = world && _obj(world.tradePolicy);
        return st ? { ver: _num(st.ver), seq: _num(st.seq), history: (st.history || []).slice() } : null;
    },

    /** Restore the world record; realms keep their policy on the kingdom (older saves: built on their next turn). */
    restore(saved, world) {
        if (!world) return;
        world.tradePolicy = _obj(saved) ? { ver: _num(saved.ver), seq: _num(saved.seq), history: Array.isArray(saved.history) ? saved.history.slice() : [] } : { ver: 0, seq: 0, history: [] };
        for (const k of world.kingdoms || []) if (k && _obj(k.tradePolicy)) TradePolicy.realm(k);
        _caches.delete(world);
        _towns.delete(world);
        if (_last.world === world) _last.world = null;
    },

    serializePlayer(player) {
        return player && _obj(player.tradePolicy) ? JSON.parse(JSON.stringify(player.tradePolicy)) : null;
    },

    /** Backfill on load: older saves start with an empty ledger and no licences. */
    loadPlayer(player, saved = undefined) {
        if (!player) return;
        if (saved !== undefined) player.tradePolicy = _obj(saved) ? saved : null;
        if (player.tradePolicy) TradePolicy.playerState(player);
    },
};
