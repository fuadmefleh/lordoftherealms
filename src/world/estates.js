// ============================================
// ESTATES — the farmland about the towns, held as estates
// ============================================
// The grain, flax and vines a settlement brings to market (its market
// profile: world/settlementMarket.js production × the harvest in force,
// world/harvests.js) come off its farmland. Part of that land is the
// peasants' own freeholds and commons; the rest (estateShare) is held in a
// few estates — manors, granges, halls — by the crown, noble houses, the
// church, the town's burghers, the merchant houses or the player.
//
// An estate is a SHARE of the town's farmland, not more land: its crops are
// the town's own crops, already in its market. So an estate changes what the
// town brings to market only by what its holder changes about it
// (`applyToProduction`, from systems/marketDynamics.js after the harvest):
//   drainage and marl   raise the estate's soil → more of its crops
//   enclosure           its fields go to sheep → less grain and flax, wool
//   the cottagers' work out of the slack season draws hands from the fields
//                       (systems/puttingOut.js sets the town's `draw`)
// A town whose estates are all as they were makes exactly what it did.
//
// This module is the model: the estates' derivation (a hash of the world
// seed and the town; no RNG, world generation untouched; old saves derive on
// the first tick), their tenants and crops, the production hook, the news
// on record and what townsfolk say. The land market (rents, values, sales,
// confiscation, dowries, the player's dealings) is systems/landMarket.js;
// the putting-out system systems/puttingOut.js. State on world.estates
// (saved by systems/saveLoad.js). Tuned in data/estates.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from './settlementMarket.js';
import { TownLabour } from './townLabour.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r3 = (v) => Math.round(v * 1000) / 1000;
export const HOLDER_KINDS = ['crown', 'noble', 'church', 'town', 'house', 'player'];

const DEFAULTS = {
    enabled: true,
    derive: { count: { village: 1, town: 2, city: 3, capital: 4 }, estateShare: 0.6, householdSize: 5, holders: {}, nobles: 4, resyncDays: 60, turnDays: 30 },
    crops: { goods: ['grain', 'flax', 'wine'], scarcityMin: 0.6, scarcityMax: 1.6, woolYield: 0.55, sheepHands: 0.25 },
    rent: { levels: {}, enclosed: 0.6, capacity: 0.5, steward: 0.08, avgAlpha: 0.25 },
    value: {}, npc: {}, war: {}, works: {}, dowry: {}, holding: {}, puttingOut: {}, names: {}, counsel: {},
    historyCap: 40,
};

let _src;
let _cfg = null;
/** The holders' index of their estates, per state (rebuilt when an estate changes hands). */
const _byHolder = new WeakMap();

function _build(src) {
    const d = _obj(src) || {};
    const C = { ...DEFAULTS, ...d };
    C.derive = { ...DEFAULTS.derive, ...(d.derive || {}) };
    C.derive.count = { ...DEFAULTS.derive.count, ...((d.derive && d.derive.count) || {}) };
    C.crops = { ...DEFAULTS.crops, ...(d.crops || {}) };
    C.rent = { ...DEFAULTS.rent, ...(d.rent || {}) };
    if (!_obj(C.rent.levels) || !C.rent.levels.customary) {
        C.rent.levels = { low: { label: 'Low', share: 0.18, loyalty: 78, flight: 0 }, customary: { label: 'Customary', share: 0.25, loyalty: 55, flight: 0 }, high: { label: 'High', share: 0.34, loyalty: 26, flight: 0.03 } };
    }
    for (const k of ['value', 'npc', 'war', 'works', 'dowry', 'holding', 'puttingOut', 'names', 'counsel']) C[k] = { ...(DEFAULTS[k] || {}), ...(_obj(d[k]) || {}) };
    C.enabled = d.enabled !== false;
    return C;
}

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

export const Estates = {
    roll: _roll,

    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.estates : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            _cfg = _build(src);
        }
        return _cfg;
    },

    enabled() {
        return Estates.config().enabled !== false;
    },

    seed(world) {
        return String((world && world.generationParams && world.generationParams.seed) || 'world');
    },

    // ── State ─────────────────────────────────────────────

    /** world.estates: { towns, estates, holders, sales, history, ver, seq, warSeq, syncAt }. */
    state(world) {
        if (!world) return null;
        let st = _obj(world.estates);
        if (!st) st = world.estates = Estates._blank();
        for (const k of ['towns', 'estates', 'holders']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['sales', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        if (!Number.isFinite(st.ver)) st.ver = 0;
        if (!Number.isFinite(st.seq)) st.seq = 1;
        return st;
    },

    _blank() {
        return { v: 1, towns: {}, estates: {}, holders: {}, sales: [], history: [], ver: 0, seq: 1, warSeq: null, syncAt: null };
    },

    serialize(world) {
        const st = world && _obj(world.estates);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load: the saved record, or none (older saves derive their estates on the next tick). */
    restore(saved, world) {
        if (!world) return;
        world.estates = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : Estates._blank();
        Estates.state(world);
    },

    /**
     * A town's estates version: bumped whenever a change to its estates (works
     * done, an enclosure, the cottagers' draw on its fields) alters its crops;
     * its market profile keys on it (0 while nothing ever changed).
     */
    townVersion(world, q, r) {
        const st = world && world.estates;
        const rec = st && st.towns ? st.towns[_key(q, r)] : null;
        return rec ? _num(rec.ver) : 0;
    },

    /** Mark a town's crops changed (its key 'q,r'). */
    bumpTown(world, key) {
        const st = Estates.state(world);
        const rec = st && st.towns[key];
        if (rec) rec.ver = _num(rec.ver) + 1;
    },

    // ── Derivation ────────────────────────────────────────

    _views(world) {
        return typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
    },

    _live(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return (t && t.settlement) || null;
    },

    /** A plausible estate name for (town, n): a hash of the seed. */
    _estateName(world, key, n) {
        const N = Estates.config().names || {};
        const pre = Array.isArray(N.prefix) && N.prefix.length ? N.prefix : ['Ash'];
        const suf = Array.isArray(N.suffix) && N.suffix.length ? N.suffix : ['ley'];
        const kind = Array.isArray(N.estate) && N.estate.length ? N.estate : ['Manor'];
        const h = Utils.hashStr(`${Estates.seed(world)}:estate:${key}:${n}`) >>> 0;
        return `${pre[h % pre.length]}${suf[Math.floor(h / pre.length) % suf.length]} ${kind[Math.floor(h / (pre.length * suf.length)) % kind.length]}`;
    },

    /** The holder record for an id (created on first sight from its id). */
    ensureHolder(world, id) {
        const st = Estates.state(world);
        if (st.holders[id]) return st.holders[id];
        const [kind, ref, extra] = String(id).split(':');
        let name = 'a landholder', kid = null;
        const k = Estates.kingdom(world, ref);
        if (kind === 'crown') { kid = k ? k.id : ref; name = k ? `the Crown of ${k.name}` : 'the crown'; }
        else if (kind === 'church') { kid = k ? k.id : (ref === 'free' ? null : ref); name = k ? `the Church in ${k.name}` : 'the Church'; }
        else if (kind === 'noble') {
            kid = k ? k.id : (ref === 'free' ? null : ref);
            const N = (Estates.config().names || {}).house || ['Ashby'];
            const h = Utils.hashStr(`${Estates.seed(world)}:noble:${ref}:${extra}`) >>> 0;
            name = `House ${N[h % N.length]}`;
        } else if (kind === 'town') {
            const live = ref != null && extra != null ? Estates._live(world, Number(ref), Number(extra)) : null;
            name = live ? `the burghers of ${live.name}` : 'the burghers';
            kid = live && live.kingdom != null ? live.kingdom : null;
        } else if (kind === 'house') {
            const defs = (DataLoader._gamedata && DataLoader._gamedata.merchantHouses && DataLoader._gamedata.merchantHouses.rivalHouses) || [];
            const def = defs.find(x => x && x.id === ref);
            name = def ? def.name : 'a merchant house';
        } else if (kind === 'player') {
            name = 'you';
        }
        const h = st.holders[id] = { id, kind, name, kid: kid != null ? kid : null, purse: null, debt: 0, inc: 0 };
        return h;
    },

    /** A realm by id (as it is written in a holder id: compared as strings). */
    kingdom(world, id) {
        if (id == null || id === '' || id === 'free' || !world || !Array.isArray(world.kingdoms)) return null;
        return world.kingdoms.find(k => k && String(k.id) === String(id)) || null;
    },

    /** Holder kind of an id ('crown', 'noble', 'church', 'town', 'house', 'player'). */
    kindOf(id) {
        return String(id || '').split(':')[0];
    },

    /** The house ids that may hold land (data/merchantHouses.json rivalHouses). */
    _houseIds() {
        const defs = (DataLoader._gamedata && DataLoader._gamedata.merchantHouses && DataLoader._gamedata.merchantHouses.rivalHouses) || [];
        return defs.map(x => x && x.id).filter(Boolean);
    },

    /** Pick an initial holder id for estate `n` of a town (hash). */
    _pickHolder(world, live, key, n) {
        const C = Estates.config().derive;
        const type = live.type in C.count ? live.type : 'village';
        const kid = live.kingdom != null ? live.kingdom : null;
        if (type === 'capital' && n === 0 && kid != null) return `crown:${kid}`;
        const w = { ...((C.holders || {})[type] || { crown: 0.2, noble: 0.55, church: 0.25 }) };
        if (kid == null) { w.town = _num(w.town) + _num(w.crown); delete w.crown; if (type === 'village') { w.noble = _num(w.noble) + _num(w.town); delete w.town; } }
        const houses = Estates._houseIds();
        if (!houses.length) delete w.house;
        const entries = Object.entries(w).filter(([, v]) => _num(v) > 0);
        const total = entries.reduce((s, [, v]) => s + _num(v), 0);
        let x = _roll(`${Estates.seed(world)}:holder:${key}:${n}`) * total;
        let pick = entries.length ? entries[entries.length - 1][0] : 'noble';
        for (const [kind, v] of entries) { if (x < v) { pick = kind; break; } x -= v; }
        const realm = kid != null ? kid : 'free';
        const hi = (s) => Utils.hashStr(`${Estates.seed(world)}:${s}:${key}:${n}`) >>> 0;
        if (pick === 'crown') return `crown:${kid}`;
        if (pick === 'church') return `church:${realm}`;
        if (pick === 'town') return `town:${key.replace(',', ':')}`;
        if (pick === 'house') return `house:${houses[hi('house') % houses.length]}`;
        return `noble:${realm}:${hi('noble') % Math.max(1, Math.floor(_num(C.nobles, 4)))}`;
    },

    /**
     * Give every settlement that has none its estates, and drop those of
     * settlements gone (every resyncDays — 10 —, and on the first tick). → towns added.
     */
    derive(world, day = null) {
        const st = Estates.state(world);
        const C = Estates.config().derive;
        const seen = new Set();
        let added = 0;
        for (const s of Estates._views(world)) {
            const key = _key(s.q, s.r);
            seen.add(key);
            if (st.towns[key]) continue;
            const live = Estates._live(world, s.q, s.r) || s;
            const n = Math.max(1, Math.floor(_num(C.count[live.type], 1)));
            const ws = [];
            for (let i = 0; i < n; i++) ws.push(0.6 + 0.8 * _roll(`${Estates.seed(world)}:share:${key}:${i}`));
            const wsum = ws.reduce((a, b) => a + b, 0);
            const rec = st.towns[key] = { k: key, q: s.q, r: s.r, name: live.name || s.name, kid: live.kingdom != null ? live.kingdom : null, ests: [], base: null, draw: 0 };
            for (let i = 0; i < n; i++) {
                const id = `E${st.seq++}`;
                const holder = Estates._pickHolder(world, live, key, i);
                Estates.ensureHolder(world, holder);
                st.estates[id] = {
                    id, town: key, name: Estates._estateName(world, key, i), share: _r3(ws[i] / wsum), holder,
                    soil: 1, marl: 0, drained: false, enclosed: 0, rent: 'customary', mode: 'coin', loyalty: 55,
                    hh: 0, avg: null, works: null, arrears: 0, value: 0, since: day != null ? day : null,
                };
                rec.ests.push(id);
            }
            Estates._baseFromMarket(rec, live);
            added++;
        }
        // Towns gone: their estates go with them
        for (const [key, rec] of Object.entries(st.towns)) {
            if (seen.has(key)) continue;
            for (const id of rec.ests || []) delete st.estates[id];
            st.hv = _num(st.hv) + 1;
            st.sales = st.sales.filter(x => rec.ests.indexOf(x.id) < 0);
            delete st.towns[key];
        }
        st.syncAt = day;
        return added;
    },

    // ── Reading ───────────────────────────────────────────

    town(world, q, r) {
        const st = world && _obj(world.estates);
        return st && st.towns ? st.towns[_key(q, r)] || null : null;
    },

    estate(world, id) {
        const st = world && _obj(world.estates);
        return st && st.estates ? st.estates[id] || null : null;
    },

    /** The estates of a settlement (in order). */
    estatesOf(world, q, r) {
        const rec = Estates.town(world, q, r);
        const st = world && world.estates;
        return rec ? rec.ests.map(id => st.estates[id]).filter(Boolean) : [];
    },

    /** Every estate a holder holds (an index rebuilt when an estate changes hands: `setHolder`). */
    heldBy(world, holderId) {
        const st = world && _obj(world.estates);
        if (!st) return [];
        let ix = _byHolder.get(st);
        const n = Object.keys(st.estates).length;
        if (!ix || ix.hv !== st.hv || ix.n !== n || ix.src !== st.estates) {
            ix = { hv: st.hv, n, src: st.estates, map: new Map() };
            for (const e of Object.values(st.estates)) {
                if (!e) continue;
                const list = ix.map.get(e.holder);
                if (list) list.push(e); else ix.map.set(e.holder, [e]);
            }
            _byHolder.set(st, ix);
        }
        return (ix.map.get(holderId) || []).slice();
    },

    /** Pass an estate to a new holder (keeps the holders' index true). */
    setHolder(world, est, holderId) {
        const st = Estates.state(world);
        if (!est) return;
        Estates.ensureHolder(world, holderId);
        est.holder = holderId;
        st.hv = _num(st.hv) + 1;
    },

    holder(world, id) {
        const st = world && _obj(world.estates);
        return st && st.holders ? st.holders[id] || null : null;
    },

    holderName(world, id) {
        const h = Estates.holder(world, id) || (world ? Estates.ensureHolder(world, id) : null);
        return h ? h.name : 'a landholder';
    },

    // ── The farmland ──────────────────────────────────────

    /** Record the town's farm crops from its market profile (before any estate's change: the first profile seen). */
    _baseFromMarket(rec, live) {
        const m = live && live.market;
        const ids = SettlementMarket.config().goodIds;
        if (!m || !Array.isArray(m.prod) || m.prod.length !== ids.length) return;
        const base = {};
        for (const g of Estates.config().crops.goods) {
            const i = SettlementMarket.config().idx[g];
            base[g] = i !== undefined ? _r3(_num(m.prod[i])) : 0;
        }
        rec.base = base;
    },

    /** The town's peasants (people). */
    peasants(live) {
        if (!live) return 0;
        const lab = TownLabour.ensure(live);
        const share = lab && lab.sh ? _num(lab.sh.peasants, 0.6) : 0.6;
        return Math.max(0, _num(live.population)) * share;
    },

    /** Tenant households on an estate (the shepherds alone on enclosed land). */
    households(world, est, live = null) {
        const C = Estates.config();
        const t = live || (est ? Estates._liveOfKey(world, est.town) : null);
        if (!est || !t) return 0;
        const hh = Estates.peasants(t) * _num(C.derive.estateShare, 0.6) * _num(est.share) / Math.max(1, _num(C.derive.householdSize, 5));
        return Math.max(0, Math.round(hh * (1 - _clamp(_num(est.enclosed), 0, 1) * (1 - _num(C.crops.sheepHands, 0.25)))));
    },

    _liveOfKey(world, key) {
        const [q, r] = String(key).split(',').map(Number);
        return Estates._live(world, q, r);
    },

    /** Base price of a good (data/playerEconomy.json GOODS). */
    basePrice(goodId) {
        const G = DataLoader._gamedata && DataLoader._gamedata.playerEconomy ? DataLoader._gamedata.playerEconomy.GOODS : null;
        const g = G && G[String(goodId).toUpperCase()];
        return g && g.basePrice > 0 ? g.basePrice : 0;
    },

    /** A good's worth at the town for the landlord: base × √(its scarcity, clamped). */
    priceAt(live, goodId) {
        const C = Estates.config().crops;
        const base = Estates.basePrice(goodId);
        if (!base) return 0;
        const sc = live && live.market && SettlementMarket.tracks(goodId) ? SettlementMarket.scarcity(live, goodId) : 1;
        return base * Math.sqrt(_clamp(_num(sc, 1), _num(C.scarcityMin, 0.6), _num(C.scarcityMax, 1.6)));
    },

    /** The crops' value at base prices a day of a town's whole farm (its base record). */
    _baseValue(base) {
        let v = 0;
        for (const g of Estates.config().crops.goods) v += _num(base && base[g]) * Estates.basePrice(g);
        return v;
    },

    /**
     * What an estate grows a day: { goods: { goodId: units }, gross: gold at
     * the town's prices }. Its share of the town's farm crops × its soil on
     * the land still under crops; wool on the enclosed part.
     */
    output(world, est, live = null) {
        const C = Estates.config();
        const rec = est && world && world.estates && world.estates.towns ? world.estates.towns[est.town] || null : null;
        const t = live || (est ? Estates._liveOfKey(world, est.town) : null);
        const out = { goods: {}, gross: 0 };
        if (!est || !rec || !rec.base || !t) return out;
        const s = _num(C.derive.estateShare, 0.6) * _num(est.share);
        const crop = 1 - _clamp(_num(est.enclosed), 0, 1);
        const draw = 1 - _clamp(_num(rec.draw), 0, 0.9);
        for (const g of C.crops.goods) {
            const n = s * _num(rec.base[g]) * _num(est.soil, 1) * crop * draw;
            if (n > 0) { out.goods[g] = n; out.gross += n * Estates.priceAt(t, g); }
        }
        const wool = Estates.woolOf(est, rec);
        if (wool > 0) { out.goods.wool = wool; out.gross += wool * Estates.priceAt(t, 'wool'); }
        return out;
    },

    /** Wool a day an estate's enclosed land runs. */
    woolOf(est, rec) {
        const C = Estates.config();
        const enc = _clamp(_num(est && est.enclosed), 0, 1);
        const wb = Estates.basePrice('wool');
        if (!(enc > 0) || !rec || !rec.base || !(wb > 0)) return 0;
        return _num(C.derive.estateShare, 0.6) * _num(est.share) * enc * Estates._baseValue(rec.base) * _num(C.crops.woolYield, 0.55) / wb;
    },

    // ── The production hook ───────────────────────────────

    /**
     * Change a town's production profile ({ goodId: units a day }, after the
     * harvest: systems/marketDynamics.js) by what its estates' holders have
     * changed: soil above or below the land's own, enclosed fields, hands
     * drawn off by the cottagers' work. Records the town's farm crops (net of
     * the player's properties' spill) as the estates' base. A town whose
     * estates are as they were is left exactly as it was.
     */
    applyToProduction(world, live, prod, spill = null) {
        if (!prod || !live || !world || !Estates.enabled()) return prod;
        const rec = Estates.town(world, live.q, live.r);
        if (!rec) return prod;
        const C = Estates.config();
        const base = {};
        for (const g of C.crops.goods) base[g] = _r3(Math.max(0, _num(prod[g]) - _num(spill && spill[g])));
        rec.base = base;
        const st = world.estates;
        const sh = _num(C.derive.estateShare, 0.6);
        const delta = {};
        let wool = 0;
        for (const id of rec.ests) {
            const e = st.estates[id];
            if (!e) continue;
            const crop = 1 - _clamp(_num(e.enclosed), 0, 1);
            const f = _num(e.soil, 1) * crop - 1;
            if (f !== 0) for (const g of C.crops.goods) delta[g] = _num(delta[g]) + sh * _num(e.share) * f;
            if (e.enclosed > 0) wool += Estates.woolOf(e, rec);
        }
        const draw = _clamp(_num(rec.draw), 0, 0.9);
        for (const g of C.crops.goods) {
            const d = _num(delta[g]);
            if (d === 0 && draw === 0) continue;
            if (!(prod[g] > 0)) continue;
            prod[g] = Math.max(0, (prod[g] + base[g] * d) * (1 - draw));
        }
        if (wool > 0 && SettlementMarket.tracks('wool')) prod.wool = _num(prod.wool) + wool;
        return prod;
    },

    // ── News and talk ─────────────────────────────────────

    /** A news record for the heralds and the towns' talk (once per key). */
    record(world, entry) {
        const st = Estates.state(world);
        if (!entry || !entry.key || st.history.some(h => h.key === entry.key)) return null;
        st.history.push(entry);
        const cap = Math.max(5, _num(Estates.config().historyCap, 40));
        while (st.history.length > cap) st.history.shift();
        return entry;
    },

    history(world) {
        const st = world && _obj(world.estates);
        return st && Array.isArray(st.history) ? st.history : [];
    },

    /**
     * What townsfolk say of the land (systems/chatter.js): 'enclosure' (an
     * estate here runs sheep), 'enclosure_riot', 'estate_sale' (one on the
     * market, or sold lately), 'putting_out' (the cottagers have work), and
     * 'linen_glut' in the prices.
     */
    talk(world, s) {
        const out = { labour: [], prices: [] };
        if (!world || !s || !_obj(world.estates)) return out;
        const day = _num(world.day);
        const key = _key(s.q, s.r);
        const rec = world.estates.towns[key];
        if (rec) {
            const ests = rec.ests.map(id => world.estates.estates[id]).filter(Boolean);
            if (ests.some(e => e.enclosed > 0)) out.labour.push('enclosure');
            if (world.estates.sales.some(x => ests.some(e => e.id === x.id))) out.labour.push('estate_sale');
            if (_num(rec.poAt, -999) >= day - 14) out.labour.push('putting_out');
        }
        for (const h of world.estates.history) {
            if (!h || day - _num(h.day) > 30) continue;
            if (h.kind === 'riot' && h.place === s.name && !out.labour.includes('enclosure_riot')) out.labour.push('enclosure_riot');
            if (h.kind === 'sold' && h.place === s.name && !out.labour.includes('estate_sale')) out.labour.push('estate_sale');
            if (h.kind === 'linen_glut' && h.kingdomId != null && h.kingdomId === s.kingdom && !out.prices.includes('linen_glut')) out.prices.push('linen_glut');
        }
        return out;
    },
};
