// ============================================
// ENGROSSING — the grain dealers' speculation and hoarding
// ============================================
// When the crop reports (world/harvests.js) say a region's harvest is
// failing, the grain dealers of its market towns — the merchant houses'
// factors — buy grain while it is still cheap and hold it in their lofts,
// tightening the market (prices rise early); they sell it back when the
// price peaks in the lean months, softening the worst of it. In the Hungry
// Months a crown may forbid engrossing: the lofts are thrown open at once
// and no dealer buys there for a while.
//
// State: each town's loft travels with it (settlement.engross: { grain,
// at, since }); the realms' bans, the news and the tallies on world.engrossing.
// Tuned in data/harvests.json `engrossing`. Weekly; no RNG is drawn (hash rolls).

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Harvests } from '../world/harvests.js';
import { Seasons } from '../world/seasons.js';
import { KingdomAI } from '../world/kingdomAI.js';

const _num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;

const DEFAULTS = {
    enabled: true, every: 7, buyFrom: 20, buyUntil: 70, buyBelow: 0.88, minConf: 0.3, buyShare: 0.08, keep: 0.9, maxStore: 0.5, minPop: 1000,
    releaseFrom: 85, releaseAt: 1.3, releaseShare: 0.3, dumpFrom: 105, dumpShare: 0.6, spoil: 0.01,
    edict: { chance: 0.5, banDays: 120, happiness: 3, personality: {} },
    historyCap: 30,
};

let _src;
let _cfg = null;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _famineIn(world, k) {
    for (const ev of (world && world.activeEvents) || []) {
        if (ev && ev.id === 'famine' && (!ev.kingdomId || ev.kingdomId === k.id || ev.partnerKingdomId === k.id)) return true;
    }
    return false;
}

export const Engrossing = {
    config() {
        const H = DataLoader._gamedata && DataLoader._gamedata.harvests;
        const src = H ? H.engrossing : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            const o = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...o, edict: { ...DEFAULTS.edict, ...(_obj(o.edict) || {}), personality: { ...((_obj(o.edict) && o.edict.personality) || {}) } } };
        }
        return _cfg;
    },

    enabled() {
        return Engrossing.config().enabled !== false;
    },

    /** world.engrossing: { bans: { kid: untilDay }, history: [], stats, lastDay }. */
    state(world) {
        if (!world) return Engrossing._blank();
        let st = world.engrossing;
        if (!_obj(st)) st = world.engrossing = Engrossing._blank();
        if (!_obj(st.bans)) st.bans = {};
        if (!Array.isArray(st.history)) st.history = [];
        if (!_obj(st.stats)) st.stats = Engrossing._blank().stats;
        return st;
    },

    _blank() {
        return { bans: {}, history: [], stats: { bought: 0, released: 0, spoiled: 0, edicts: 0, opened: 0 }, lastDay: null };
    },

    serialize(world) {
        return world && world.engrossing ? JSON.parse(JSON.stringify(world.engrossing)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.engrossing = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : Engrossing._blank();
        Engrossing.state(world);
    },

    /** Grain the dealers of a town hold in their lofts. */
    held(s) {
        const e = s && _obj(s.engross);
        return e ? Math.max(0, _num(e.grain)) : 0;
    },

    /** Is engrossing forbidden in a realm today? */
    banned(world, kid) {
        const st = world && _obj(world.engrossing);
        return !!(st && st.bans && kid != null && _num(st.bans[kid], -1) >= _num(world.day));
    },

    /** The news on record ([{ kind: 'engross' | 'release' | 'edict', day, kingdomId, kingdom, place, units }]). */
    recent(world, days = 60) {
        const st = world && _obj(world.engrossing);
        if (!st || !Array.isArray(st.history)) return [];
        return st.history.filter(h => _num(world.day) - _num(h.day) <= days);
    },

    _record(world, st, rec) {
        st.history.push({ day: _num(world.day), ...rec });
        const cap = Math.max(1, _num(Engrossing.config().historyCap, 30));
        while (st.history.length > cap) st.history.shift();
    },

    _towns(world) {
        const out = [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const t = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (t && t.settlement) || v;
            if (s && s.market) out.push(s);
        }
        return out;
    },

    _release(s, n, st) {
        const e = s.engross;
        const amt = Math.min(Engrossing.held(s), n);
        if (!(amt > 0)) return 0;
        SettlementMarket.add(s, 'grain', amt);
        e.grain = _r2(Engrossing.held(s) - amt);
        if (!(e.grain > 0.05)) delete s.engross;
        st.stats.released = _r2(st.stats.released + amt);
        return amt;
    },

    /**
     * The weekly turn. → { notices: [{ icon, title, text, type }] }
     * `player` (optional): a notice when the player's own realm or the town
     * they stand in sees an edict.
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Engrossing.enabled() || !Number.isFinite(world.day) || !SettlementMarket.tracks('grain')) return out;
        const C = Engrossing.config();
        const st = Engrossing.state(world);
        const day = world.day;
        if (st.lastDay != null && day - st.lastDay < C.every && day >= st.lastDay) return out;
        st.lastDay = day;
        const doy = Seasons.dayOfYear(day);
        const seed = Harvests.seed(world);
        const forecasts = new Map();
        const fc = (id) => {
            if (!forecasts.has(id)) forecasts.set(id, Harvests.forecast(world, id));
            return forecasts.get(id);
        };
        const famines = new Map();
        const engrossed = new Map(); // kid → units bought this turn
        for (const s of Engrossing._towns(world)) {
            const held = Engrossing.held(s);
            // The lofts: a little spoils every week
            if (held > 0) {
                const lost = held * _num(C.spoil);
                s.engross.grain = _r2(held - lost);
                st.stats.spoiled = _r2(st.stats.spoiled + lost);
            }
            const target = SettlementMarket.target(s, 'grain');
            if (!(target > 0)) continue;
            // Selling: the peak of the lean months, then whatever the price, then the turn of the year
            if (Engrossing.held(s) > 0) {
                const sc = SettlementMarket.scarcity(s, 'grain');
                let share = 0;
                if (doy < C.buyFrom) share = 1;
                else if (doy >= C.dumpFrom) share = C.dumpShare;
                else if (doy >= C.releaseFrom && sc >= C.releaseAt) share = C.releaseShare;
                if (share > 0) Engrossing._release(s, Engrossing.held(s) * share, st);
            }
            // Buying: a failing harvest in the forecast, before the price has run up
            if (doy < C.buyFrom || doy > C.buyUntil || _num(s.population) < C.minPop) continue;
            if (s.kingdom != null && Engrossing.banned(world, s.kingdom)) continue;
            const f = fc(Harvests.regionOfTown(world, s));
            if (!f || !(f.est < C.buyBelow) || (!f.settled && !(f.conf >= C.minConf))) continue;
            const room = target * C.maxStore - Engrossing.held(s);
            const spare = SettlementMarket.stock(s, 'grain') - target * C.keep;
            const n = _r2(Math.min(room, spare * C.buyShare));
            if (!(n >= 0.5)) continue;
            const got = SettlementMarket.take(s, 'grain', n);
            if (!(got > 0)) continue;
            const e = _obj(s.engross) || (s.engross = { grain: 0, since: day });
            e.grain = _r2(_num(e.grain) + got);
            st.stats.bought = _r2(st.stats.bought + got);
            if (s.kingdom != null) engrossed.set(s.kingdom, _num(engrossed.get(s.kingdom)) + got);
        }
        for (const [kid, units] of engrossed) {
            // (news once a season per realm)
            if (Engrossing.recent(world, 30).some(h => h.kind === 'engross' && h.kingdomId === kid)) continue;
            const k = _kingdom(world, kid);
            if (k) Engrossing._record(world, st, { kind: 'engross', kingdomId: kid, kingdom: k.name, units: Math.round(units) });
        }
        // The crowns: an edict against engrossers in the Hungry Months
        const E = C.edict;
        const byRealm = new Map();
        for (const s of Engrossing._towns(world)) {
            if (s.kingdom == null || !(Engrossing.held(s) > 0)) continue;
            let list = byRealm.get(s.kingdom);
            if (!list) byRealm.set(s.kingdom, list = []);
            list.push(s);
        }
        for (const [kid, towns] of byRealm) {
            const k = _kingdom(world, kid);
            if (!k || k.isAlive === false || Engrossing.banned(world, kid)) continue;
            if (!famines.has(kid)) famines.set(kid, _famineIn(world, k));
            if (!famines.get(kid) && !towns.some(s => SettlementMarket.inDearth(s))) continue;
            const pm = _num(E.personality[KingdomAI.personalityId(k)], 1);
            const roll = (_hash(`${seed}:edict:${kid}:${day}`) % 100000) / 100000;
            if (roll >= Math.min(0.95, _num(E.chance) * pm)) continue;
            let opened = 0;
            for (const s of towns) {
                opened += Engrossing._release(s, Engrossing.held(s), st);
                if (_num(E.happiness)) s.happiness = Math.max(0, Math.min(100, _num(s.happiness, 50) + _num(E.happiness)));
            }
            st.bans[kid] = day + _num(E.banDays, 120);
            st.stats.edicts++;
            st.stats.opened = _r2(st.stats.opened + opened);
            const big = towns.slice().sort((a, b) => _num(b.population) - _num(a.population))[0];
            Engrossing._record(world, st, { kind: 'edict', kingdomId: kid, kingdom: k.name, place: big ? big.name : null, units: Math.round(opened) });
            const ruled = player && player.throne && player.throne.ruling ? player.throne.ruling.kingdomId : null;
            const here = player && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
            if (player && (ruled === kid || (here && here.settlement && here.settlement.kingdom === kid))) {
                out.notices.push({ icon: '📜', title: 'An Edict against Engrossers', text: `The crown of ${k.name} forbids the hoarding of grain: the dealers' lofts are thrown open and ${Math.round(opened)} grain comes to market.`, type: 'info' });
            }
        }
        return out;
    },
};
