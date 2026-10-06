// ============================================
// FASHIONS — what the courts want this season
// ============================================
// Now and then a fashion takes a realm's court — silks, spiced wine, furs
// from the north, jewelled finery, blood horses, perfumes, great feasts,
// carved ivory, or pious plainness (data/chronicle.json → fashions.list).
// It starts at a capital and spreads outward `speed` hexes a day; it rises,
// holds for most of a season and fades, weaker the farther a town lies from
// where it began.
//
// While it holds a town, the fashionable strata (nobles and merchants above
// all: fashions.strata) want more (or, for plainness, less) of its goods:
//   • goods the town's market keeps — their need is scaled through the
//     town's class demand (TownLabour.setFashion → lab.fz, read by
//     TownLabour.demandMults), so the stock runs down and the price rises;
//   • goods no market keeps (the exotics of systems/discovery.js, silk and
//     ivory from the ports) — they simply fetch more (lab.fx, read by
//     SettlementMarket.value, Economy.marketAskBase, the stalls' sale price
//     and Ships.getPortMarket).
// The heralds cry a new fashion, the townsfolk and the gazette talk of it,
// so a merchant who hears early can buy ahead of the demand.
//
// A fashion starts on a hash of the world seed and the week (no RNG drawn),
// or when the player sets one through their patronage (start(..., 'player')).
// State on world.fashions (saved with the world); each town's factors on its
// labour record (saved with the tile). Ticked weekly by systems/economyChronicle.js.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { TownLabour } from './townLabour.js';
import { SettlementMarket } from './settlementMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFAULTS = {
    every: 7, minDay: 14, startChance: 0.3, maxActive: 3, speed: 1.5, maxRadius: 26, falloff: 0.6,
    rise: 7, hold: 21, fade: 14, minIntensity: 0.05, pastCap: 12,
    strata: { nobles: 1, merchants: 1, clergy: 0.3, artisans: 0.25 },
    playerSet: { prestige: 40, gold: 400, minReputation: 20, cooldown: 60, patronDiscount: 0.5, power: 1.25, longer: 1.5 },
    list: [],
};

/** FNV-1a: a well-mixed hash of a string (no RNG stream is touched). */
function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A deterministic draw in [0, 1) for `key`. */
function _roll(key) {
    return (_hash(key) % 100000) / 100000;
}

function _seed(world) {
    const p = world && world.generationParams;
    return p && p.seed != null ? p.seed : 0;
}

let _cfgSrc;
let _cfg = null;

export const Fashions = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.chronicle && gd.chronicle.fashions) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = { ...DEFAULTS, ...o, playerSet: { ...DEFAULTS.playerSet, ...(o.playerSet || {}) }, list: Array.isArray(o.list) ? o.list : [] };
        }
        return _cfg;
    },

    /** A fashion's definition, or null. */
    def(id) {
        return Fashions.config().list.find(f => f && f.id === id) || null;
    },

    // ── State ─────────────────────────────────────────────

    state(world) {
        if (!world) return { active: [], past: [], nextId: 1, lastWeek: null };
        let st = world.fashions;
        if (!_obj(st)) st = world.fashions = { active: [], past: [], nextId: 1, lastWeek: null };
        if (!Array.isArray(st.active)) st.active = [];
        if (!Array.isArray(st.past)) st.past = [];
        if (!(st.nextId > 0)) st.nextId = st.active.length + st.past.length + 1;
        if (st.lastWeek === undefined) st.lastWeek = null;
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.fashions);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load (older saves: no fashions yet; the towns' factors travel with their tiles). */
    restore(saved, world) {
        if (!world) return;
        world.fashions = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        Fashions.state(world);
    },

    // ── A fashion's course ────────────────────────────────

    /** How far it has spread by `day` (hexes). */
    reach(f, day) {
        const C = Fashions.config();
        return Math.min(_num(f.radius, C.maxRadius), Math.max(0, day - f.start + 1) * _num(f.speed, C.speed));
    },

    /** Its strength at its height-curve on `day`: rising, holding, fading (0 once over). */
    phase(f, day) {
        const t = day - f.start;
        if (t < 0) return 0;
        if (t < f.rise) return (t + 1) / (f.rise + 1);
        if (t < f.rise + f.hold) return 1;
        const out = t - f.rise - f.hold;
        return out < f.fade ? 1 - (out + 1) / (f.fade + 1) : 0;
    },

    /** 'rising' | 'at its height' | 'fading' | 'over'. */
    stage(f, day) {
        const t = day - f.start;
        if (t < f.rise) return 'rising';
        if (t < f.rise + f.hold) return 'at its height';
        if (t < f.rise + f.hold + f.fade) return 'fading';
        return 'over';
    },

    /** The fashion's intensity at (q, r) on `day`: 0..power. */
    intensity(world, f, q, r, day) {
        const C = Fashions.config();
        const d = Hex.wrappingDistance(f.q, f.r, q, r, (world && world.width) || 0);
        if (d > Fashions.reach(f, day)) return 0;
        const radius = Math.max(1, _num(f.radius, C.maxRadius));
        const v = Fashions.phase(f, day) * _num(f.power, 1) * (1 - _clamp(_num(C.falloff), 0, 1) * Math.min(1, d / radius));
        return v >= _num(C.minIntensity) ? v : 0;
    },

    /** Days left before it is over. */
    daysLeft(f, day) {
        return Math.max(0, f.start + f.rise + f.hold + f.fade - day);
    },

    /** The goods it moves, as labels: [{ id, name, icon, mult }]. */
    goods(f) {
        const def = Fashions.def(f.id) || {};
        const G = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        return Object.entries(_obj(def.goods) || {}).map(([id, mult]) => {
            const g = G[String(id).toUpperCase()];
            return { id, name: (g && g.name) || String(id).replace(/_/g, ' '), icon: (g && g.icon) || '📦', mult: _num(mult, 1), kept: SettlementMarket.tracks(id) };
        });
    },

    // ── Starting one ──────────────────────────────────────

    /** The living realms' capitals: [{ kingdom, q, r, name }]. */
    _capitals(world) {
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false || !k.capital || !Number.isFinite(k.capital.q)) continue;
            const t = typeof world.getTile === 'function' ? world.getTile(k.capital.q, k.capital.r) : null;
            out.push({ kingdom: k, q: k.capital.q, r: k.capital.r, name: (t && t.settlement && t.settlement.name) || k.name });
        }
        return out;
    },

    /**
     * Start a fashion at (q, r) — a capital, by a court's whim or the
     * player's patronage. Returns the fashion, or null (unknown, or that
     * fashion already runs).
     */
    start(world, id, at, { by = 'court', kingdomId = null, place = null } = {}) {
        const def = Fashions.def(id);
        if (!world || !def || !at || !Number.isFinite(at.q)) return null;
        const C = Fashions.config();
        const st = Fashions.state(world);
        if (st.active.some(f => f.id === id)) return null;
        const mine = by === 'player';
        const P = C.playerSet;
        const longer = mine ? _num(P.longer, 1) : 1;
        const f = {
            uid: st.nextId++, id, q: at.q, r: at.r, place: place || at.name || 'the capital', kingdomId,
            start: _num(world.day), by, power: mine ? _num(P.power, 1) : 1,
            speed: _num(C.speed), radius: _num(C.maxRadius),
            rise: Math.max(1, Math.round(_num(C.rise) * longer)), hold: Math.max(1, Math.round(_num(C.hold) * longer)), fade: Math.max(1, Math.round(_num(C.fade) * longer)),
        };
        st.active.push(f);
        Fashions._apply(world, st);
        return f;
    },

    // ── The week ──────────────────────────────────────────

    /**
     * Weekly: fashions that are over pass into memory, perhaps a new one
     * takes a court (a hash roll), and every town's fashion factors are set.
     * → { started: [fashion], ended: [fashion] }
     */
    processWeek(world) {
        const out = { started: [], ended: [] };
        if (!world) return out;
        const C = Fashions.config();
        const st = Fashions.state(world);
        const day = _num(world.day);
        for (const f of st.active.slice()) {
            if (Fashions.daysLeft(f, day) > 0) continue;
            st.active = st.active.filter(x => x !== f);
            st.past.push({ uid: f.uid, id: f.id, place: f.place, kingdomId: f.kingdomId, start: f.start, end: day, by: f.by });
            out.ended.push(f);
        }
        if (st.past.length > C.pastCap) st.past.splice(0, st.past.length - C.pastCap);
        const week = Math.floor(day / Math.max(1, _num(C.every, 7)));
        if (day >= _num(C.minDay) && st.active.length < _num(C.maxActive) && C.list.length
            && _roll(`fashion:${_seed(world)}:${week}`) < _num(C.startChance)) {
            const caps = Fashions._capitals(world);
            const free = C.list.filter(d => d && d.id && !st.active.some(f => f.id === d.id));
            if (caps.length && free.length) {
                const cap = caps[_hash(`fcap:${_seed(world)}:${week}`) % caps.length];
                const def = free[_hash(`fdef:${_seed(world)}:${week}`) % free.length];
                const f = Fashions.start(world, def.id, cap, { kingdomId: cap.kingdom.id, place: cap.name });
                if (f) out.started.push(f);
            }
        }
        st.lastWeek = day;
        Fashions._apply(world, st);
        return out;
    },

    /** Set every town's fashion factors from the fashions running today. */
    _apply(world, st = Fashions.state(world)) {
        if (!world || typeof world.getSettlementViews !== 'function') return 0;
        const day = _num(world.day);
        const defs = st.active.map(f => [f, _obj((Fashions.def(f.id) || {}).goods) || {}]);
        let n = 0;
        for (const s of world.getSettlementViews()) {
            if (!s || !s.labour) continue;
            let fz = null, fx = null;
            for (const [f, goods] of defs) {
                const I = Fashions.intensity(world, f, s.q, s.r, day);
                if (!(I > 0)) continue;
                for (const [id, m] of Object.entries(goods)) {
                    const v = 1 + (_num(m, 1) - 1) * I;
                    if (SettlementMarket.tracks(id)) { fz = fz || {}; fz[id] = _num(fz[id], 1) * v; }
                    else { fx = fx || {}; fx[id] = _num(fx[id], 1) * Math.max(0.2, v); }
                }
            }
            if (!fz && !fx && !s.labour.fz && !s.labour.fx) continue;
            if (TownLabour.setFashion(s, fz, fx)) n++;
        }
        return n;
    },

    // ── Reading ───────────────────────────────────────────

    active(world) {
        return Fashions.state(world).active.slice();
    },

    /** The fashions holding (q, r) today: [{ fashion, def, intensity }], strongest first. */
    at(world, q, r, day = _num(world && world.day)) {
        const out = [];
        for (const f of Fashions.state(world).active) {
            const I = Fashions.intensity(world, f, q, r, day);
            if (I > 0) out.push({ fashion: f, def: Fashions.def(f.id), intensity: I });
        }
        return out.sort((a, b) => b.intensity - a.intensity || a.fashion.uid - b.fashion.uid);
    },
};
