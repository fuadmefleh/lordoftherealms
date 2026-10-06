// ============================================
// TOWN LABOUR — classes, hands, wages and welfare of every town
// ============================================
// A settlement's people (settlement.population) are split into five strata
// (settlement.labour.sh, shares that sum to 1 — so every other system that
// grows, starves, sacks or plagues a town keeps the split consistent):
//
//   peasants & labourers  work the land, the mines and the woods ('land')
//   artisans              the town's trades and the player's works ('craft')
//   merchants             its trade ('trade')
//   clergy, nobility      live on tithes, rents and office (no wage)
//
// What each stratum buys differs (data/labour.json baskets): the town's
// daily need of each good (SettlementMarket._shape) is scaled by its class
// mix against the usual mix for its size, so an ordinary town buys what it
// always did and a town of nobles and merchants buys wine and silks.
//
// Each sector has jobs and hands. Hands short of jobs cap the sector's
// output (SettlementMarket.processSettlement reads `factors`); jobs short of
// hands leave people idle, which breeds crime (`crime`, read by the thieves'
// guild, warehouse thieves and holdings unrest) and sours the mood. Wages
// float with the balance and the cost of living; the player's properties and
// works pay them (`wageUpkeep`, `worksWageBill`). Each stratum's welfare —
// its basket met, work, real wage, safety, taxes, famine — draws people
// between towns (`moveStratum`, `moveMix`; driven by systems/labour.js,
// which knows the wars, sieges, lairs and the player's taxes).
//
// Pure model: no RNG, no imports above world/. The state on settlement.labour
// is plain data saved with its tile; old saves derive it from the population
// (`ensure`). Tuned in data/labour.json.

import { DataLoader } from '../core/dataLoader.js';

export const STRATA = ['peasants', 'artisans', 'merchants', 'clergy', 'nobles'];
export const SECTORS = ['land', 'craft', 'trade'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r3 = (v) => Math.round(v * 1000) / 1000;
const _r4 = (v) => Math.round(v * 10000) / 10000;
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const DEFAULTS = {
    strata: {
        peasants: { name: 'Peasants & labourers', short: 'Peasants', icon: '🌾', sector: 'land', work: 0.5, mobility: 1, refugeeShare: 1.1 },
        artisans: { name: 'Artisans', short: 'Artisans', icon: '🔨', sector: 'craft', work: 0.5, mobility: 0.8, refugeeShare: 0.9 },
        merchants: { name: 'Merchants', short: 'Merchants', icon: '⚖️', sector: 'trade', work: 0.45, mobility: 0.9, refugeeShare: 0.9 },
        clergy: { name: 'Clergy', short: 'Clergy', icon: '⛪', sector: null, work: 0, mobility: 0.3, refugeeShare: 0.5 },
        nobles: { name: 'Nobility', short: 'Nobles', icon: '👑', sector: null, work: 0, mobility: 0.3, refugeeShare: 0.8 },
    },
    shares: {
        village: { peasants: 0.84, artisans: 0.08, merchants: 0.03, clergy: 0.03, nobles: 0.02 },
        town: { peasants: 0.62, artisans: 0.2, merchants: 0.08, clergy: 0.05, nobles: 0.05 },
        city: { peasants: 0.5, artisans: 0.26, merchants: 0.12, clergy: 0.06, nobles: 0.06 },
        capital: { peasants: 0.42, artisans: 0.28, merchants: 0.15, clergy: 0.07, nobles: 0.08 },
    },
    peoples: {},
    worksTilt: 0.004,
    holdingTilt: 0.15,
    drift: 0.03,
    baskets: {},
    jobs: { landCap: { village: 1300, town: 4200, city: 12000, capital: 25000 }, crowdSlope: 0.35, baseAlpha: 0.04, craftBase: 0.8, craftUtil: 0.3, tradeBase: 0.9, tradeAct: 0.1, tradeRef: 0.0004, tradeMax: 1.5 },
    craftGoods: [],
    wages: { base: { land: 0.4, craft: 0.6, trade: 0.8 }, typeMult: { village: 0.8, town: 1, city: 1.15, capital: 1.3 }, elasticity: 1.5, min: 0.6, max: 2.2, colPow: 0.5, alpha: 0.35, staples: ['grain', 'bread', 'beer', 'firewood', 'clothes'] },
    output: { landSensitivity: 0.8, strikeFill: 0.4, minFill: 0.2 },
    welfare: {
        weights: { basket: 0.3, work: 0.25, wage: 0.2, safety: 0.25, famine: 0.35 },
        groups: {}, missing: 0.7, taxWeight: {}, alpha: 0.3,
    },
    danger: { siege: 1, conquest: 0.8, conquestDays: 30, border: 0.2, lair: 0.12, lairMax: 0.3, lairRadius: 3, raider: 0.1, raiderRadius: 2, damage: 0.6 },
    mood: { content: 0.87, perWelfare: 8, idleFree: 0.06, perIdle: 20, min: -6, max: 2, step: 0.5 },
    crime: { idleFree: 0.04, perIdle: 4, poorLine: 0.65, perMisery: 1.5, alpha: 0.25, jobOdds: 0.08, theft: 0.02, unrest: 0.4, unrestIdle: 2 },
    migration: { every: 7, threshold: 0.035, rate: 0.05, maxShare: 0.01, colonyPull: 0.06, minPop: 60 },
    refugees: { from: 0.3, rate: 0.03, maxShare: 0.05, safe: 0.2, returnShare: 0.25, keep: 4, newsMin: 40, decay: 0.85 },
    strikes: { below: 0.65, wageBelow: 0.85, chance: 2.5, days: 7, gap: 45, minType: 'town', boomAt: 0.9, boomGap: 60 },
    works: { idlePay: 0, hands: {} },
    properties: { radius: 3, wageShare: 0.5, craftCategories: ['crafts', 'food', 'commerce'] },
    news: { cap: 30 },
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** A normalised mix { stratum: share } (every stratum at least `floor`). */
function _normalise(mix, floor = 0.002) {
    const out = {};
    let sum = 0;
    for (const s of STRATA) {
        out[s] = Math.max(floor, _num(mix && mix[s]));
        sum += out[s];
    }
    for (const s of STRATA) out[s] = sum > 0 ? out[s] / sum : 1 / STRATA.length;
    return out;
}

let _cfgSrc;
let _cfg = null;
// Per-labour-record caches that must not travel with the save
const _demand = new WeakMap();
const _masks = new WeakMap();

export const TownLabour = {
    STRATA,
    SECTORS,

    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.labour : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const c = _merge(DEFAULTS, _obj(src) || {});
            const shares = {};
            for (const [type, mix] of Object.entries(c.shares || {})) shares[type] = _normalise(mix);
            c.shares = shares;
            c.sectorOf = {};
            for (const s of STRATA) c.sectorOf[s] = (c.strata[s] && c.strata[s].sector) || null;
            c.craftSet = new Set(Array.isArray(c.craftGoods) ? c.craftGoods : []);
            // Flattened tables for the market turn (no allocation in the hot path)
            c.workerOf = {};
            for (const sec of SECTORS) c.workerOf[sec] = STRATA.find(s => c.sectorOf[s] === sec) || null;
            c.peoplesList = [];
            for (const [eff, map] of Object.entries(c.peoples || {})) {
                if (!_obj(map)) continue;
                for (const [s, w] of Object.entries(map)) if (STRATA.includes(s) && _num(w)) c.peoplesList.push([eff, s, _num(w)]);
            }
            // Base wages by size and sector, and each stratum's working share (read every market turn)
            c.baseWageT = {};
            const W = c.wages || {};
            for (const type of Object.keys(c.shares)) {
                c.baseWageT[type] = {};
                for (const sec of SECTORS) c.baseWageT[type][sec] = _num(W.base && W.base[sec], 0.5) * _num(W.typeMult && W.typeMult[type], 1);
            }
            c.workOf = {};
            for (const s of STRATA) c.workOf[s] = _num(c.strata[s] && c.strata[s].work);
            c.groupList = {};
            for (const s of STRATA) {
                const g = _obj(c.welfare.groups && c.welfare.groups[s]) || { food: 1 };
                c.groupList[s] = Object.entries(g).map(([id, w]) => [id, _num(w)]);
            }
            _cfg = c;
        }
        return _cfg;
    },

    /** A stratum's definition: { name, short, icon, sector, work, mobility, refugeeShare }. */
    stratum(id) {
        return TownLabour.config().strata[id] || null;
    },

    /** The stratum that works a sector ('land' → 'peasants', ...). */
    workersOf(sector) {
        return TownLabour.config().workerOf[sector] || null;
    },

    _type(type) {
        const sh = TownLabour.config().shares;
        return sh[type] ? type : 'village';
    },

    /** The usual mix of a settlement of this size. */
    baseMix(type) {
        return TownLabour.config().shares[TownLabour._type(type)];
    },

    /**
     * The mix this town tends toward: its size's usual mix, leaning by its
     * peoples' crafts, enterprise, faith and husbandry, the works funded in
     * it and a holding's workshop quarter.
     */
    targetMix(settlement) {
        const C = TownLabour.config();
        const mix = { ...TownLabour.baseMix(settlement && settlement.type) };
        const pe = settlement && settlement.peoplesEffects;
        if (pe) {
            for (const [eff, s, w] of C.peoplesList) {
                const v = pe[eff];
                if (typeof v === 'number' && v) mix[s] += v * w;
            }
        }
        const works = settlement && settlement.market && settlement.market.works;
        if (works) {
            let lv = 0;
            for (const id in works) lv += _num(works[id] && works[id].lvl);
            mix.artisans += lv * _num(C.worksTilt);
        }
        const fx = settlement && settlement.holding && settlement.holding.fx;
        if (fx && _num(fx.goods) > 0) mix.artisans += _num(fx.goods) * _num(C.holdingTilt);
        return _normalise(mix);
    },

    // ── State ─────────────────────────────────────────────

    /** Is this a well-formed labour record? */
    _valid(lab) {
        if (!lab || typeof lab !== 'object' || !lab.sh || typeof lab.sh !== 'object') return false;
        const sh = lab.sh;
        return Number.isFinite(sh.peasants) && Number.isFinite(sh.artisans) && Number.isFinite(sh.merchants) && Number.isFinite(sh.clergy) && Number.isFinite(sh.nobles);
    },

    /** Base wage of a sector in a settlement of this size (gold a day per hand). */
    baseWage(type, sector) {
        const C = TownLabour.config();
        const t = C.baseWageT[TownLabour._type(type)];
        if (t && t[sector] !== undefined) return t[sector];
        return _num(C.wages.base[sector], 0.5) * _num(C.wages.typeMult[TownLabour._type(type)], 1);
    },

    /**
     * The settlement's labour record, derived from its size, peoples and
     * works the first time it is needed (new towns and old saves alike):
     * its target mix, base wages, everyone at work, welfare content.
     */
    ensure(settlement) {
        if (!settlement || typeof settlement !== 'object') return null;
        if (TownLabour._valid(settlement.labour)) return settlement.labour;
        const mix = TownLabour.targetMix(settlement);
        const lab = {
            sh: {}, wage: {}, jobs: {}, hands: {}, idle: {}, fill: { land: 1, craft: 1, trade: 1 },
            wel: {}, all: TownLabour.config().mood.content, crime: 0, refugees: 0, from: {}, moved: { in: 0, out: 0 },
            strike: 0, k: settlement.kingdom || null, day: null,
        };
        for (const s of STRATA) {
            lab.sh[s] = _r4(mix[s]);
            lab.wel[s] = lab.all;
        }
        const pop = Math.max(0, _num(settlement.population));
        for (const sec of SECTORS) {
            lab.wage[sec] = Math.round(TownLabour.baseWage(settlement.type, sec) * 100) / 100;
            const st = TownLabour.workersOf(sec);
            const hands = Math.round(pop * lab.sh[st] * _num(TownLabour.stratum(st).work));
            lab.jobs[sec] = hands;
            lab.hands[sec] = hands;
            lab.idle[sec] = 0;
        }
        lab.mk = TownLabour._mixKey(lab.sh);
        lab.base = Math.round(pop);
        settlement.labour = lab;
        return lab;
    },

    /** A number that changes when the mix moves by half a percent (keys the demand table). */
    _mixKey(sh) {
        let k = 0;
        for (const s of STRATA) k = k * 211 + Math.round(_num(sh[s]) * 200);
        return k;
    },

    _setMix(lab, mix) {
        const n = _normalise(mix, 0);
        for (const s of STRATA) lab.sh[s] = _r4(n[s]);
        lab.mk = TownLabour._mixKey(lab.sh);
    },

    /** People of each stratum: { stratum: count } (from the shares and the population). */
    counts(settlement) {
        const lab = settlement && settlement.labour;
        const pop = Math.max(0, _num(settlement && settlement.population));
        const out = {};
        for (const s of STRATA) out[s] = TownLabour._valid(lab) ? pop * lab.sh[s] : pop * TownLabour.baseMix(settlement && settlement.type)[s];
        return out;
    },

    // ── Demand (read by SettlementMarket._shape) ──────────

    /**
     * The class mix's factor on the town's need of each good, in market
     * config order (a Float64Array), or null when the town has no labour
     * record yet (old code paths and fixtures keep the flat need). For each
     * good: Σ share × basket ÷ the same at the size's usual mix. Memoised
     * per labour record until the mix moves.
     */
    demandMults(settlement, C) {
        const lab = settlement && settlement.labour;
        if (!lab || !lab.sh || !C) return null;
        const cfg = TownLabour.config();
        const type = TownLabour._type(settlement.type);
        const key = Number.isFinite(lab.mk) ? lab.mk : (lab.mk = TownLabour._mixKey(lab.sh));
        const hit = _demand.get(lab);
        if (hit && hit.key === key && hit.type === type && hit.C === C && hit.cfg === cfg) return hit.arr;
        const base = cfg.shares[type];
        const B = cfg.baskets || {};
        const ids = C.goodIds;
        const arr = new Float64Array(ids.length);
        // From the mix as the key sees it (half-percent steps), so the table
        // depends only on its key — a loaded game rebuilds the very same one
        const q = {};
        for (const s of STRATA) q[s] = Math.round(_num(lab.sh[s]) * 200) / 200;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            let num = 0, den = 0;
            for (const s of STRATA) {
                const w = B[s] && Number.isFinite(B[s][id]) ? B[s][id] : 1;
                num += q[s] * w;
                den += base[s] * w;
            }
            arr[i] = den > 0 ? _clamp(num / den, 0.25, 4) : 1;
        }
        _demand.set(lab, { key, type, C, cfg, arr });
        return arr;
    },

    /** 1 for the goods craftsmen make (data/labour.json craftGoods), 0 for the land's — in market config order. */
    craftMask(C) {
        const cfg = TownLabour.config();
        const hit = _masks.get(C);
        if (hit && hit.cfg === cfg) return hit.mask;
        const mask = Uint8Array.from(C.goodIds.map(id => (cfg.craftSet.has(id) ? 1 : 0)));
        _masks.set(C, { cfg, mask });
        return mask;
    },

    // ── Output (read by SettlementMarket.processSettlement) ─

    /** Is a strike on today? */
    striking(settlement, day = null) {
        const lab = settlement && settlement.labour;
        return !!(lab && _num(lab.strike) > 0 && (day == null || day <= lab.strike));
    },

    /**
     * Output factors from the hands at work: { land, craft } (1 = fully
     * staffed). Land and mines: 1 − (1 − fill) × landSensitivity; the
     * craftsmen, the town's trades and the works: the craft fill (a strike
     * idles most of it).
     */
    factors(settlement, day = null) {
        const lab = settlement && settlement.labour;
        if (!TownLabour._valid(lab) || !lab.fill) return { land: 1, craft: 1 };
        const O = TownLabour.config().output;
        const lo = _num(O.minFill, 0.2);
        const land = _clamp(1 - (1 - _clamp(_num(lab.fill.land, 1), 0, 1)) * _num(O.landSensitivity, 0.8), lo, 1);
        let craft = _clamp(_num(lab.fill.craft, 1), lo, 1);
        if (TownLabour.striking(settlement, day)) craft = Math.min(craft, _num(O.strikeFill, 0.4));
        return { land, craft };
    },

    // ── The market turn ───────────────────────────────────

    /**
     * One market turn of the town's labour (after its market's turn): the
     * mix drifts toward its target, jobs and hands are counted, wages move,
     * welfare and crime follow, the mood shifts. `ctx`: { day, k (days the
     * turn covers), fertility, danger 0..1, taxRate (null where the player
     * doesn't rule), col (cost of living: staples' scarcity), hands:
     * { land, craft } the player hires here }.
     * @returns {{ moodDelta: number }}
     */
    update(settlement, ctx = {}) {
        const lab = TownLabour.ensure(settlement);
        if (!lab) return { moodDelta: 0 };
        const C = TownLabour.config();
        const k = Math.max(1, Math.floor(_num(ctx.k, 1)));
        const pop = Math.max(0, _num(settlement.population));
        const type = TownLabour._type(settlement.type);
        const m = settlement.market || {};

        // The mix drifts toward the town's own
        const tgt = TownLabour.targetMix(settlement);
        const d = _clamp(_num(C.drift, 0.03), 0, 1);
        const mix = {};
        for (const s of STRATA) mix[s] = _num(lab.sh[s]) + (tgt[s] - _num(lab.sh[s])) * d;
        TownLabour._setMix(lab, mix);

        // Jobs: the land the town can work, how busy its trades and its
        // traders were. Workshops and counting-houses are sized by the economy
        // the town has built up (`base`, a slow average of its people), so new
        // artisans and merchants find no place at first and a town emptied by
        // war or plague is short of them until it shrinks
        const J = C.jobs;
        const BW = C.baseWageT[type];
        const ba = 1 - Math.pow(1 - _clamp(_num(J.baseAlpha, 0.04), 0, 1), k / 4);
        lab.base = Math.round(Number.isFinite(lab.base) && lab.base > 0 ? lab.base + (pop - lab.base) * ba : pop);
        const bpop = lab.base;
        const hire = ctx.hands || {};
        const landCap = _num(J.landCap[type], 1500) * _clamp(_num(ctx.fertility, 1), 0.6, 1.4);
        // (land to spare takes every newcomer; past the land's capacity each finds only part of a place)
        const effPop = pop <= landCap ? pop : landCap + (pop - landCap) * _num(J.crowdSlope, 0.35);
        const util = _clamp(_num(m.util, 0.5), 0, 1);
        const vol = m.trade ? (_num(m.trade.in) + _num(m.trade.out)) / k : 0;
        const act = pop > 0 ? Math.min(_num(J.tradeMax, 1.6), vol / (pop * _num(J.tradeRef, 0.004))) : 0;
        const wk = C.workOf;
        const jobs = {
            land: wk.peasants * tgt.peasants * effPop + Math.max(0, _num(hire.land)),
            craft: wk.artisans * tgt.artisans * bpop * (_num(J.craftBase, 0.8) + _num(J.craftUtil, 0.3) * util) + Math.max(0, _num(hire.craft)),
            trade: wk.merchants * tgt.merchants * bpop * (_num(J.tradeBase, 0.75) + _num(J.tradeAct, 0.25) * act),
        };
        const W = C.wages;
        const col = _clamp(_num(ctx.col, 1), 0.5, 2.5);
        const wa = 1 - Math.pow(1 - _clamp(_num(W.alpha, 0.35), 0, 1), k / 4);
        let handsAll = 0, idleAll = 0;
        for (const sec of SECTORS) {
            const st = C.workerOf[sec];
            const hands = wk[st] * lab.sh[st] * pop;
            const want = jobs[sec];
            lab.jobs[sec] = Math.round(want);
            lab.hands[sec] = Math.round(hands);
            lab.fill[sec] = _r3(want > 0 ? Math.min(1, hands / want) : 1);
            lab.idle[sec] = _r3(hands > 0 ? Math.max(0, hands - want) / hands : 0);
            handsAll += hands;
            idleAll += Math.max(0, hands - want);
            // Wages float with the balance of jobs and hands, and the price of bread
            const tight = hands > 0 ? want / hands : W.max;
            const target = BW[sec] * _clamp(Math.pow(Math.max(0.01, tight), _num(W.elasticity, 1.5)), W.min, W.max) * Math.pow(col, _num(W.colPow, 0.5));
            const cur = _num(lab.wage[sec], BW[sec]);
            lab.wage[sec] = Math.round((cur + (target - cur) * wa) * 100) / 100;
        }
        const idleShare = handsAll > 0 ? idleAll / handsAll : 0;
        // The artisans' wage against the customary one at today's price of bread
        // (1 = it buys what it always did) — read by the town guilds (systems/guilds.js)
        settlement.wageIndex = Math.round(_num(lab.wage.craft) / Math.max(0.01, BW.craft * col) * 1000) / 1000;
        lab.idleAll = _r3(idleShare);

        // Welfare of each stratum: basket met, work, real wage, safety, famine, taxes
        const Wf = C.welfare;
        const w = Wf.weights;
        const met = _obj(m.met) || {};
        const danger = _clamp(_num(ctx.danger), 0, 1);
        const famine = _clamp(_num(m.short && m.short.food), 0, 1);
        const realWage = (sec) => {
            const ratio = _num(lab.wage[sec]) / Math.max(0.01, BW[sec] * col);
            return _clamp(0.5 + (ratio - 1) * 1.25, 0, 1);
        };
        let townWork = 0, townWage = 0, wn = 0;
        for (const sec of SECTORS) {
            const st = C.workerOf[sec];
            const share = lab.sh[st];
            townWork += share * (1 - lab.idle[sec]);
            townWage += share * realWage(sec);
            wn += share;
        }
        townWork = wn > 0 ? townWork / wn : 1;
        townWage = wn > 0 ? townWage / wn : 0.5;
        const wa2 = 1 - Math.pow(1 - _clamp(_num(Wf.alpha, 0.3), 0, 1), k / 4);
        let all = 0;
        for (const s of STRATA) {
            const sec = C.sectorOf[s];
            let bsum = 0, bw = 0;
            for (const [g, gw] of C.groupList[s]) {
                const v = Number.isFinite(met[g]) ? met[g] : _num(Wf.missing, 0.7);
                bsum += gw * _clamp(v, 0, 1);
                bw += gw;
            }
            const basket = bw > 0 ? bsum / bw : 1;
            const work = sec ? 1 - lab.idle[sec] : townWork;
            const wage = sec ? realWage(sec) : townWage;
            const tax = ctx.taxRate != null ? (_num(ctx.taxRate) - 0.15) * _num(Wf.taxWeight[s], 1) : 0;
            const target = _clamp(_num(w.basket) * basket + _num(w.work) * work + _num(w.wage) * wage + _num(w.safety) * (1 - danger)
                - _num(w.famine) * famine - tax, 0, 1);
            const cur = Number.isFinite(lab.wel[s]) ? lab.wel[s] : target;
            lab.wel[s] = _r3(cur + (target - cur) * wa2);
            all += lab.sh[s] * lab.wel[s];
        }
        lab.all = _r3(all);
        lab.danger = _r3(danger);

        // Crime: idle hands and the misery of the poor
        const Cr = C.crime;
        const crimeT = _clamp(Math.max(0, idleShare - _num(Cr.idleFree)) * _num(Cr.perIdle) + Math.max(0, _num(Cr.poorLine) - lab.wel.peasants) * _num(Cr.perMisery), 0, 1);
        const ca = 1 - Math.pow(1 - _clamp(_num(Cr.alpha, 0.25), 0, 1), k / 4);
        lab.crime = _r3(_num(lab.crime) + (crimeT - _num(lab.crime)) * ca);

        // Mood: welfare lifts or sours it, idle hands sour it (tracked so it's given back)
        const M = C.mood;
        const moodTarget = Math.round(_clamp((lab.all - _num(M.content)) * _num(M.perWelfare) - Math.max(0, idleShare - _num(M.idleFree)) * _num(M.perIdle), _num(M.min, -6), _num(M.max, 2)) * 100) / 100;
        const cur = _num(settlement.labourMood);
        const step = _num(M.step, 0.5) * k;
        const next = cur < moodTarget ? Math.min(moodTarget, cur + step) : Math.max(moodTarget, cur - step);
        const delta = Math.round((next - cur) * 100) / 100;
        if (delta !== 0) {
            settlement.labourMood = Math.round(next * 100) / 100;
            if (settlement.labourMood === 0) delete settlement.labourMood;
            const h = typeof settlement.happiness === 'number' ? settlement.happiness : 50;
            settlement.happiness = _clamp(h + delta, 0, 100);
        }
        if (_num(lab.strike) > 0 && ctx.day != null && ctx.day > lab.strike) lab.strike = 0;
        lab.day = ctx.day != null ? ctx.day : lab.day;
        return { moodDelta: delta };
    },

    // ── Moving people ─────────────────────────────────────

    /**
     * Move `n` people of one stratum from town `a` to town `b` (whole
     * people; a keeps at least `minPop`). Shares are re-worked from the
     * counts. Returns how many moved.
     */
    moveStratum(a, b, stratum, n, minPop = 10) {
        if (!a || !b || a === b || !STRATA.includes(stratum)) return 0;
        const la = TownLabour.ensure(a), lb = TownLabour.ensure(b);
        const popA = Math.max(0, _num(a.population));
        const have = Math.floor(popA * la.sh[stratum]);
        const moved = Math.max(0, Math.min(Math.floor(_num(n)), have, Math.floor(popA - minPop)));
        if (!(moved > 0)) return 0;
        TownLabour._shift(a, la, { [stratum]: -moved });
        TownLabour._shift(b, lb, { [stratum]: moved });
        return moved;
    },

    /**
     * Move `n` people from `a` to `b` in a column shaped like a's people
     * (each stratum weighted by its refugeeShare). Returns how many moved.
     */
    moveMix(a, b, n, minPop = 10) {
        if (!a || !b || a === b) return 0;
        const la = TownLabour.ensure(a), lb = TownLabour.ensure(b);
        const popA = Math.max(0, _num(a.population));
        const total = Math.max(0, Math.min(Math.floor(_num(n)), Math.floor(popA - minPop)));
        if (!(total > 0)) return 0;
        const C = TownLabour.config();
        let wsum = 0;
        const wts = {};
        for (const s of STRATA) {
            wts[s] = la.sh[s] * _num(C.strata[s] && C.strata[s].refugeeShare, 1);
            wsum += wts[s];
        }
        const delta = {};
        let left = total;
        // Largest strata first so rounding lands on the many, not the few
        const order = STRATA.slice().sort((x, y) => wts[y] - wts[x]);
        order.forEach((s, i) => {
            const want = i === order.length - 1 ? left : Math.round(total * (wsum > 0 ? wts[s] / wsum : 0));
            const take = Math.max(0, Math.min(left, want, Math.floor(popA * la.sh[s])));
            delta[s] = take;
            left -= take;
        });
        if (left > 0) delta[order[0]] += left;
        const moved = STRATA.reduce((t, s) => t + _num(delta[s]), 0);
        const neg = {};
        for (const s of STRATA) neg[s] = -_num(delta[s]);
        TownLabour._shift(a, la, neg);
        TownLabour._shift(b, lb, delta);
        return moved;
    },

    /** Add (or take) people by stratum and re-work the town's shares. */
    _shift(settlement, lab, delta) {
        const pop = Math.max(0, _num(settlement.population));
        const counts = {};
        let total = 0;
        for (const s of STRATA) {
            counts[s] = Math.max(0, pop * lab.sh[s] + _num(delta[s]));
            total += _num(delta[s]);
        }
        settlement.population = Math.max(0, Math.round(pop + total));
        TownLabour._setMix(lab, counts);
    },

    // ── Wages the player pays ─────────────────────────────

    /** Hands a level of works hires (data/labour.json works.hands). */
    worksHands(recipeId, lvl = 1) {
        return _num(TownLabour.config().works.hands[recipeId]) * Math.max(0, _num(lvl));
    },

    /** The town's craft wage (its base where it has no labour record yet). */
    craftWage(settlement) {
        const lab = settlement && settlement.labour;
        const base = TownLabour.baseWage(settlement && settlement.type, 'craft');
        return lab && lab.wage ? _num(lab.wage.craft, base) : base;
    },

    /** Wages one run of the works costs at full staff: hands × the craft wage ÷ the runs a day. */
    worksWagePerRun(settlement, recipeId, w) {
        if (!w || !(_num(w.cap) > 0)) return 0;
        const hands = TownLabour.worksHands(recipeId, w.lvl);
        return hands > 0 ? hands * TownLabour.craftWage(settlement) / _num(w.cap) : 0;
    },

    /**
     * Wages the works paid over a market turn of `k` days: hands × the
     * town's craft wage × (idlePay — a skeleton crew kept on — + the rest
     * as the works ran).
     */
    worksWageBill(settlement, recipeId, w, k = 1) {
        if (!w) return 0;
        const hands = TownLabour.worksHands(recipeId, w.lvl);
        if (!(hands > 0)) return 0;
        const wage = TownLabour.craftWage(settlement);
        const capTurn = _num(w.cap) * _clamp(_num(w.cond, 1), 0, 1) * Math.max(1, k);
        const util = capTurn > 0 ? _clamp(_num(w.runs) / capTurn, 0, 1) : 0;
        const idlePay = _clamp(_num(TownLabour.config().works.idlePay), 0, 1);
        return hands * wage * Math.max(1, k) * (idlePay + (1 - idlePay) * util);
    },

    /** Is this property kind worked by artisans (else peasants and labourers)? */
    craftProperty(category) {
        return (TownLabour.config().properties.craftCategories || []).includes(category);
    },

    /**
     * A property's daily upkeep with its wage bill at the local wage:
     * wageShare of `base` floats with hire.ratio (local wage ÷ base wage).
     * `hire` (property.hire, set by systems/labour.js) is null in the wild.
     */
    wageUpkeep(base, hire) {
        const b = Math.max(0, _num(base));
        if (!hire || !(b > 0)) return b;
        const ws = _clamp(_num(TownLabour.config().properties.wageShare, 0.5), 0, 1);
        return b * (1 - ws) + b * ws * _clamp(_num(hire.ratio, 1), 0.4, 2.5);
    },

    /** Share of a property's work the local hands staff (1 in the wild). */
    staffing(hire) {
        return hire ? _clamp(_num(hire.fill, 1), _num(TownLabour.config().output.minFill, 0.2), 1) : 1;
    },

    // ── Readers ───────────────────────────────────────────

    /** Crime in the town (0..1). */
    crime(settlement) {
        const lab = settlement && settlement.labour;
        return lab ? _clamp(_num(lab.crime), 0, 1) : 0;
    },

    /** Share of the town's working hands without work (0..1). */
    idle(settlement) {
        const lab = settlement && settlement.labour;
        return lab ? _clamp(_num(lab.idleAll), 0, 1) : 0;
    },

    /** The town's welfare 0..1 (0.5ish when unknown). */
    welfare(settlement) {
        const lab = settlement && settlement.labour;
        return lab && Number.isFinite(lab.all) ? lab.all : TownLabour.config().mood.content;
    },

    /** Extra odds on a thieves' guild job in a town of idle hands. */
    crimeOdds(settlement) {
        return TownLabour.crime(settlement) * _num(TownLabour.config().crime.jobOdds);
    },

    /** Extra weekly theft chance on a store-room here. */
    theftBonus(settlement) {
        return TownLabour.crime(settlement) * _num(TownLabour.config().crime.theft);
    },

    /** Unrest points a day crime and idle hands add to a holding. */
    unrestPressure(settlement) {
        const Cr = TownLabour.config().crime;
        const idleFree = _num(TownLabour.config().mood.idleFree, 0.06);
        return TownLabour.crime(settlement) * _num(Cr.unrest) + Math.max(0, TownLabour.idle(settlement) - idleFree) * _num(Cr.unrestIdle);
    },

    /** For the town and holdings panels: strata, sectors, welfare, crime, refugees, strike. */
    summary(settlement, day = null) {
        const lab = settlement && settlement.labour;
        if (!TownLabour._valid(lab)) return null;
        const C = TownLabour.config();
        const counts = TownLabour.counts(settlement);
        return {
            strata: STRATA.map(s => ({
                id: s, name: C.strata[s].name, short: C.strata[s].short, icon: C.strata[s].icon,
                share: lab.sh[s], count: Math.round(counts[s]), welfare: _num(lab.wel && lab.wel[s], lab.all), sector: C.sectorOf[s],
            })),
            sectors: SECTORS.map(sec => ({
                id: sec, jobs: _num(lab.jobs && lab.jobs[sec]), hands: _num(lab.hands && lab.hands[sec]),
                idle: _num(lab.idle && lab.idle[sec]), fill: _num(lab.fill && lab.fill[sec], 1),
                wage: _num(lab.wage && lab.wage[sec]), base: TownLabour.baseWage(settlement.type, sec),
            })),
            welfare: TownLabour.welfare(settlement), idle: TownLabour.idle(settlement), crime: TownLabour.crime(settlement),
            danger: _num(lab.danger), refugees: Math.round(_num(lab.refugees)), moved: lab.moved || { in: 0, out: 0 },
            strike: TownLabour.striking(settlement, day) ? lab.strike : 0, mood: _num(settlement.labourMood),
        };
    },

    /** A welfare word and colour. */
    welfareLabel(v) {
        if (v >= 0.88) return { label: 'Thriving', color: '#2ecc71' };
        if (v >= 0.74) return { label: 'Content', color: '#9fd59f' };
        if (v >= 0.6) return { label: 'Pinched', color: '#e8a040' };
        if (v >= 0.45) return { label: 'Hard-pressed', color: '#e67e22' };
        return { label: 'Desperate', color: '#e74c3c' };
    },
};
