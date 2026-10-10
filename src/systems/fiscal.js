// ============================================
// FISCAL — the Crown's Purse: taxes, wages, tax farms and budget crises
// ============================================
// Every realm keeps real books (kingdom.fisc, read and written through
// world/crownBooks.js). Once a day, for each realm:
//
//   REVENUE   land tax (the peasants' earnings × the harvest, and part of the
//             towns' production gold), poll tax (taxable heads; clergy and
//             nobles exempt), excise (the artisans' earnings and the
//             merchants' trade income), the demesne (the crown's own estates),
//             and an extraordinary levy while one runs (systems/finance.js).
//             Each is drawn out of the town's purse (settlement.economy.gold,
//             where its production and trade income are credited), never
//             minted; corruption leaks part of it before it reaches the chests.
//             Customs, seigniorage, monopolies and tax farms sold are booked by
//             the systems that collect them.
//   SPENDING  army wages (field pay at war, a bounty per recruit), court and
//             administration, paid back into the towns' purses (soldiers and
//             clerks spend where they live); roads and works, debt service,
//             the dole and the ruler's purse are booked by their systems.
//   ARREARS   what the chests cannot pay is owed: unpaid soldiers desert after
//             a week (CrownBooks.armyFactor, read by KingdomAI.updateMilitary)
//             and the realm's stability falls; unpaid officials raise
//             corruption.
//   COIN      the week's taxes less wages leave circulation (world/moneySupply.js
//             'fisc' flow); a crown spending its savings puts coin back.
//
// Weekly per realm (staggered): the books' week closes, NPC crowns review
// their tax level (personality and need), crowns short of money auction a
// town's taxes to a tax farmer (a banking house of systems/finance.js, or the
// player, who outbids, collects with the squeeze they choose, and is resented),
// and heavily taxed, hard-pressed towns may rise in a tax revolt (a hash roll:
// no RNG is drawn, so no other system's dice move). A ruler sets each tax, the
// army's pay and the court in the Treasury panel (ui/actionMenu/treasury.js).
//
// State: kingdom.fisc (saved with the kingdom), world.fiscal (lots, farms,
// history; SaveLoad), settlement.taxFarm / taxRevolt (saved with the tile).
// Tuned in data/fiscal.json.

import { CrownBooks, REVENUE_LINES, EXPENSE_LINES } from '../world/crownBooks.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses, LordInfluence } from '../world/kingdomState.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Harvests } from '../world/harvests.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Finance } from './finance.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);
const _key = (q, r) => `${q},${r}`;
const LEVELS = CrownBooks.LEVELS;
const REV = REVENUE_LINES.slice(), EXP = EXPENSE_LINES.slice();
const REV_N = REV.length, EXP_N = EXP.length;
const TAXES = ['land', 'poll', 'excise'];

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A deterministic roll in [0, 1) for a key (no RNG drawn). */
function _frac(key) {
    return (_hash(key) % 1000003) / 1000003;
}

function _seed(world) {
    const p = world && world.generationParams;
    return p && p.seed != null ? p.seed : 0;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _alive(world) {
    return (world && Array.isArray(world.kingdoms) ? world.kingdoms : [])
        .filter(k => k && k.isAlive !== false && k.id != null)
        .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export const Fiscal = {
    REVENUE_LINES,
    EXPENSE_LINES,

    config() {
        return CrownBooks.config();
    },

    enabled() {
        return CrownBooks.enabled();
    },

    // ── State ─────────────────────────────────────────────

    _blank() {
        return { lots: [], farms: [], history: [], nextId: 1, lastDay: null, stats: { farmsSold: 0, revolts: 0, playerFarms: 0 } };
    },

    /** world.fiscal, created (or backfilled for an old save) when missing. */
    state(world) {
        if (!world) return Fiscal._blank();
        let st = _obj(world.fiscal);
        if (!st) st = world.fiscal = Fiscal._blank();
        for (const k of ['lots', 'farms', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...Fiscal._blank().stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.fiscal);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.fiscal = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : Fiscal._blank();
        Fiscal.state(world);
    },

    _record(world, st, rec) {
        const day = _day(world);
        st.history.push({ ...rec, day, key: `fisc:${rec.kind}:${day}:${rec.kingdomId != null ? rec.kingdomId : ''}:${rec.town || ''}` });
        const cap = Math.max(10, _num(Fiscal.config().history, 60));
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
    },

    /** The books' news for the heralds and the chatter: [{ key, day, kind, kingdom, town, ... }]. */
    news(world) {
        const st = world && _obj(world.fiscal);
        return st && Array.isArray(st.history) ? st.history : [];
    },

    /** Records of `kind` for a realm in the last `days` days. */
    recent(world, kid, kind, days = 60) {
        const day = _day(world);
        return Fiscal.news(world).filter(h => h && h.kingdomId === kid && (!kind || h.kind === kind) && day - _num(h.day) <= days);
    },

    _note(out, icon, title, text, type = 'info') {
        if (out) out.notices.push({ icon, title, text, type });
    },

    _ruledId(player) {
        return Finance._ruledId(player);
    },

    // ── Rates and burden ──────────────────────────────────

    /** The tax burden the people of a town feel (world/townLabour.js scale), or null when the books are off. */
    townBurden(world, s) {
        if (!s || s.kingdom == null || !CrownBooks.enabled()) return null;
        const k = _kingdom(world, s.kingdom);
        if (!k || k.isAlive === false) return null;
        const farm = _obj(s.taxFarm);
        return CrownBooks.burden(k, farm ? _num(farm.squeeze, 1) : 1);
    },

    /** The extraordinary levy's share (systems/finance.js), while it runs. */
    _levyShare(k, day) {
        const f = k && k.finance;
        return f && f.levy && _num(f.levy.until) >= day ? _num(f.levy.share, 0.3) : 0;
    },

    /**
     * What a town owes the crown, before the purse caps it: { land, poll,
     * excise, levy, demesne, due } (all ≥ 0), over `days` days since its last
     * collection (the earnings and heads are a day's; the production and trade
     * accumulators already hold every day since). Clears the accumulators when
     * `consume`.
     */
    townDues(world, k, s, f, day, isCapital, consume = true, days = 1) {
        const C = Fiscal.config();
        const R = C.rates;
        const e = s.economy || {};
        const pop = Math.max(0, _num(s.population));
        const lab = s.labour;
        let landInc, craftInc, heads;
        const W = C.pollWeights;
        if (lab && lab.hands && lab.jobs && lab.wage && lab.sh) {
            landInc = Math.min(_num(lab.hands.land), _num(lab.jobs.land)) * _num(lab.wage.land);
            craftInc = Math.min(_num(lab.hands.craft), _num(lab.jobs.craft)) * _num(lab.wage.craft);
            const sh = lab.sh;
            heads = (_num(sh.peasants) * _num(W.peasants) + _num(sh.artisans) * _num(W.artisans) + _num(sh.merchants) * _num(W.merchants)
                + _num(sh.clergy) * _num(W.clergy) + _num(sh.nobles) * _num(W.nobles)) * pop;
        } else {
            landInc = pop * _num(C.fallback.landPerHead, 0.11);
            craftInc = pop * _num(C.fallback.craftPerHead, 0.05);
            heads = pop * 0.92;
        }
        const n = Math.max(1, days);
        const prodG = Math.max(0, _num(e.fyProd));
        const trade = Math.max(0, _num(e.fyTrade));
        if (consume && s.economy) { s.economy.fyProd = 0; s.economy.fyTrade = 0; }
        const harvest = _clamp(_num(Harvests.foodFactor(world, s), 1), 0.5, 1.5);
        const rt = f.rates;
        const land = _num(R.land) * CrownBooks.levelMult(rt.land) * (landInc * n * harvest + prodG * _num(R.landProd, 0.5));
        const poll = _num(R.poll) * CrownBooks.levelMult(rt.poll) * heads * n;
        const excise = _num(R.excise) * CrownBooks.levelMult(rt.excise) * (craftInc * n + trade);
        const levy = (land + poll + excise) * Fiscal._levyShare(k, day);
        const demesne = f.demesne * prodG * (isCapital ? _num(C.demesne.capital, 2) : 1);
        return { land, poll, excise, levy, demesne, due: land + poll + excise + levy };
    },

    // ── The daily turn ────────────────────────────────────

    /**
     * The fiscal day (before Finance.processDay): every realm's taxes and
     * wages, its books closed; weekly, its tax review, tax farms, revolts and
     * coin. → { notices, revenue, expense }
     */
    processDay(world, player = null) {
        const out = { notices: [], revenue: 0, expense: 0 };
        if (!world || !Fiscal.enabled() || typeof world.getTile !== 'function') return out;
        const st = Fiscal.state(world);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const ruledId = Fiscal._ruledId(player);
        // The realms' towns, live (the views are copies)
        const byK = Fiscal._townsByRealm(world, day);
        Fiscal._farmsDay(world, player, st, byK, day, out);
        // The banking houses by id, for the tax farmers' takings (looked up once a day)
        Fiscal._banks = null;
        if (st.farms.length && player && player.finance && Array.isArray(player.finance.banks)) {
            Fiscal._banks = new Map(player.finance.banks.map(b => [b.id, b]));
        }
        for (const k of _alive(world)) {
            const towns = byK.get(k.id) || [];
            Fiscal._realmDay(world, player, st, k, towns, ruledId, day, out);
            if (((day + (_hash(`${k.id}`) % 7)) % 7) === 0) Fiscal._week(world, player, st, k, towns, ruledId, day, out);
        }
        Fiscal._lotsDay(world, player, st, day, out);
        return out;
    },

    /**
     * The realms' live towns ({ q, r, s, key }), grouped by realm: rebuilt when
     * the settlement scan changes, a town changes hands, or weekly.
     */
    _townsByRealm(world, day) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const c = Fiscal._group;
        if (c && c.world === world && c.views === views && day - c.day < 7 && day >= c.day) {
            let ok = true;
            for (const [kid, arr] of c.byK) {
                for (const t of arr) if (t.s.kingdom !== kid) { ok = false; break; }
                if (!ok) break;
            }
            if (ok) return c.byK;
        }
        const byK = new Map();
        for (const v of views) {
            if (!v || v.kingdom == null) continue;
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s || s.kingdom == null) continue;
            let arr = byK.get(s.kingdom);
            if (!arr) byK.set(s.kingdom, arr = []);
            arr.push({ q: v.q, r: v.r, s, key: _key(v.q, v.r) });
        }
        Fiscal._group = { world, views, day, byK };
        return byK;
    },

    _realmDay(world, player, st, k, towns, ruledId, day, out) {
        const C = Fiscal.config();
        const f = CrownBooks.state(k);
        if (!Number.isFinite(f.openTreasury)) f.openTreasury = _num(k.treasury);
        const ruled = k.id === ruledId;
        // Collection: stewardship, tax bonuses, events, stability, blockade, coin (KingdomAI.incomeMultiplier),
        // less what corrupt officials keep
        const mult = Number.isFinite(f.mult) ? f.mult : KingdomAI.incomeMultiplier(k, world); // (kept by KingdomAI.updateEconomy)
        const eff = mult * (1 - _num(C.corruption.leak, 0.35) * f.corruption);
        const cap = k.capital ? _key(k.capital.q, k.capital.r) : null;
        let land = 0, poll = 0, excise = 0, levy = 0, demesne = 0, pop = 0;
        const farmPlayer = player && player.gold != null ? player : null;
        // Each town's collectors come round once every `collectEvery` days (staggered by town),
        // taking every day's dues since they last came
        const every = Math.max(1, Math.floor(_num(C.collectEvery, 7)));
        const slot = day % every;
        const paidTo = [];
        for (const t of towns) {
            const s = t.s;
            if (!s.economy) continue;
            const sp = Math.max(0, _num(s.population));
            pop += sp;
            const e = s.economy;
            const last = Number.isFinite(e.fyDay) ? e.fyDay : null;
            if (last !== null && last <= day && day - last < every * 3 && Fiscal._slot(t.key, every) !== slot) continue;
            const days = last !== null && last < day ? Math.min(day - last, every * 3) : 1;
            e.fyDay = day;
            paidTo.push(t);
            const d = Fiscal.townDues(world, k, s, f, day, t.key === cap, true, days);
            const revolt = _num(s.taxRevolt) > day;
            const farm = _obj(s.taxFarm);
            let purse = Math.max(0, _num(s.economy.gold));
            // The crown's own estates yield whatever the town does
            const dem = Math.min(purse, d.demesne * eff);
            if (dem > 0) { s.economy.gold = _r2(purse - dem); purse -= dem; demesne += dem; }
            const due = revolt ? 0 : d.due * eff;
            // Recent dues a day (what a tax farmer would bid on)
            const perDay = due / days;
            const avg = _num(f.towns[t.key], perDay);
            f.towns[t.key] = _r2(avg + (perDay - avg) * 0.25);
            if (!(due > 0) || !(purse > 0)) continue;
            if (farm) {
                // The farmer collects in the crown's place, and squeezes
                const take = Math.min(purse, due * _num(farm.squeeze, 1));
                s.economy.gold = _r2(purse - take);
                Fiscal._farmCollect(world, farmPlayer, st, k, s, farm, take);
                continue;
            }
            const pay = Math.min(purse, due);
            s.economy.gold = _r2(purse - pay);
            const share = pay / due;
            land += d.land * eff * share;
            poll += d.poll * eff * share;
            excise += d.excise * eff * share;
            levy += d.levy * eff * share;
        }
        const collected = land + poll + excise + levy + demesne;
        k.treasury = _num(k.treasury) + collected;
        const page = f.day;
        page.land += land; page.poll += poll; page.excise += excise; page.levy += levy; page.demesne += demesne;

        // Spending: the army's wages, the court
        const A = C.army;
        const payLv = A.levels[f.armyPay] || A.levels.full;
        const war = Array.isArray(k.wars) && k.wars.length > 0;
        // (the upkeep bonuses and military-spending events: re-read weekly)
        if (!Number.isFinite(f.upkeepF) || f.upkeepDay == null || day - f.upkeepDay >= 7 || day < f.upkeepDay) {
            const spending = WorldEvents.getModifier(world, 'militarySpending', { kingdom: k.id });
            f.upkeepF = _r2(Math.max(0.2, 1 + KingdomBonuses.get(k, 'upkeep') + spending + LordInfluence.mod(k, 'upkeep')));
            f.upkeepDay = day;
        }
        const upkeepF = f.upkeepF;
        const mil = Math.max(0, _num(k.military));
        const recruits = Number.isFinite(f.lastMil) ? Math.max(0, mil - f.lastMil) : 0;
        f.lastMil = mil;
        const army = mil * _num(A.pay) * (war ? _num(A.warPay, 1.6) : 1) * _num(payLv.mult, 1) * upkeepF + recruits * _num(A.bounty);
        const Ct = C.court;
        const courtLv = Ct.levels[f.courtLevel] || Ct.levels.standard;
        const court = (_num(Ct.base) + _num(Ct.perTown) * towns.length + _num(Ct.perHead) * pop) * _num(courtLv.mult, 1);
        // Pay the soldiers first (and what they are owed), then the clerks
        let cash = Math.max(0, _num(k.treasury));
        const wantA = army + _num(f.arrears.army);
        const paidA = Math.min(cash, wantA);
        cash -= paidA;
        const wantC = court + _num(f.arrears.court);
        const paidC = Math.min(cash, wantC);
        f.arrears.army = _r2(Math.min(wantA - paidA, army * 60));
        f.arrears.court = _r2(Math.min(wantC - paidC, court * 60));
        k.treasury = _num(k.treasury) - paidA - paidC;
        page.army += paidA;
        page.court += paidC;
        // Wages go back into the towns' purses: soldiers and clerks spend where they live
        Fiscal._spendBack(paidTo.length ? paidTo : towns, cap, paidA, paidC);
        const wasArrears = f.arrearsDays;
        if (f.arrears.army > 0.5) f.arrearsDays++;
        else f.arrearsDays = Math.max(0, f.arrearsDays - 3);
        if (f.arrears.court > 0.5) f.corruption = _clamp(f.corruption + _num(C.corruption.unpaidGain), 0, 1);
        else f.corruption = _clamp(f.corruption - _num(C.corruption.decay) + _num(courtLv.corruption), 0, 1);
        f.corruption = Math.round(f.corruption * 10000) / 10000;
        f.wkCoin = _r2(_num(f.wkCoin) + collected - paidA - paidC);
        if (ruled && player) {
            if (wasArrears === 0 && f.arrearsDays === 1) Fiscal._note(out, '⚔️', 'The Soldiers Go Unpaid', `The treasury of ${k.name} cannot meet the army's pay (${Math.round(f.arrears.army)}g owed). Unpaid men desert after a week.`, 'warning');
            else if (f.arrearsDays === _num(A.desert.afterDays, 7) + 1) Fiscal._note(out, '🏳️', 'Desertion', `Unpaid for a week, the soldiers of ${k.name} begin to slip away.`, 'error');
        }
        if (f.arrearsDays === 21) Fiscal._record(world, st, { kind: 'mutiny', kingdomId: k.id, kingdom: k.name, amount: Math.round(f.arrears.army) });
        Fiscal._closeDay(k, f);
    },

    /** A town's collection day in the cycle (a hash of its place). */
    _slot(key, every) {
        let m = Fiscal._slots;
        if (!m) m = Fiscal._slots = new Map();
        let v = m.get(key);
        if (v === undefined) { v = _hash(`slot:${key}`); m.set(key, v); }
        return v % every;
    },

    /** Wages back into the purses (the towns the collectors visited today): the army's by people, the court's to the capital. */
    _spendBack(towns, cap, army, court) {
        if (!towns.length) return;
        let capTown = null, pop = 0;
        for (const t of towns) pop += Math.max(0, _num(t.s.population));
        for (const t of towns) {
            if (!t.s.economy) continue;
            if (t.key === cap) capTown = t;
            const share = pop > 0 ? Math.max(0, _num(t.s.population)) / pop : 1 / towns.length;
            t.s.economy.gold = _r2(_num(t.s.economy.gold) + army * share);
        }
        const to = capTown || towns.find(t => t.s.economy);
        if (to) to.s.economy.gold = _r2(_num(to.s.economy.gold) + court);
    },

    /** Close the day's books: lines into `last` and the week, the rest of the change under 'other'. */
    _closeDay(k, f) {
        const a = _num(Fiscal.config().smoothing, 0.05);
        const d = f.day;
        const treasury = _num(k.treasury);
        let rev = 0, exp = 0;
        for (let i = 0; i < REV_N; i++) { const v = d[REV[i]]; if (v) rev += v; }
        for (let i = 0; i < EXP_N; i++) { const v = d[EXP[i]]; if (v) exp += v; }
        d.other = _r2(treasury - f.openTreasury - (rev - exp + (d.loans || 0) + (d.debase || 0)));
        // (the lines are kept to the hundredth on the closed page)
        for (const l in d) { const v = d[l]; if (v) d[l] = Math.round(v * 100) / 100; }
        const av = f.avg;
        av.n = (av.n || 0) + 1;
        av.rev = _r2(av.n === 1 ? rev : (av.rev || 0) + (rev - (av.rev || 0)) * a);
        av.exp = _r2(av.n === 1 ? exp : (av.exp || 0) + (exp - (av.exp || 0)) * a);
        av.demesne = _r2((av.demesne || 0) + ((d.demesne || 0) - (av.demesne || 0)) * a);
        const wk = f.week;
        for (const l in d) { const v = d[l]; if (v) wk[l] = (wk[l] || 0) + v; }
        f.stats.revenue = Math.round(_num(f.stats.revenue) + rev);
        f.stats.expense = Math.round(_num(f.stats.expense) + exp);
        // (yesterday's page is wiped and reused for tomorrow)
        const page = f.last && f.last !== d ? f.last : CrownBooks._blankLines();
        for (const l in page) page[l] = 0;
        f.last = d;
        f.day = page;
        f.openTreasury = treasury;
    },

    // ── The week ──────────────────────────────────────────

    _week(world, player, st, k, towns, ruledId, day, out) {
        const C = Fiscal.config();
        const f = CrownBooks.state(k);
        for (const l in f.week) f.week[l] = _r2(f.week[l] || 0);
        const rev = CrownBooks.revenue(f.week), exp = CrownBooks.expense(f.week);
        f.deficitWeeks = exp > rev * 1.02 ? f.deficitWeeks + 1 : 0;
        f.lastWeek = f.week;
        f.week = CrownBooks._blankLines();
        f.hist.push([day, Math.round(_num(k.treasury)), Math.round(rev), Math.round(exp)]);
        const H = Math.max(8, _num(C.histWeeks, 52));
        if (f.hist.length > H) f.hist.splice(0, f.hist.length - H);
        // The coin: taxes out of circulation, wages back into it
        const Cn = C.coin;
        const R = MoneySupply.realm(world, k.id);
        if (R && _num(f.wkCoin)) {
            const lim = R.coin * _num(Cn.maxShare, 0.04);
            MoneySupply.adjust(world, k.id, _clamp(-_num(f.wkCoin) * _num(Cn.share, 0.6), -lim, lim), 'fisc');
        }
        f.wkCoin = 0;
        const ruled = k.id === ruledId;
        if (!ruled) {
            const N = C.npc;
            if (((Math.floor(day / 7) + (_hash(`tax:${k.id}`) % 4)) % Math.max(1, Math.round(_num(N.every, 28) / 7))) === 0) Fiscal._review(world, st, k, f, day);
        }
        Fiscal._revolts(world, player, st, k, f, towns, ruledId, day, out);
        if (!ruled) Fiscal._offerFarm(world, player, st, k, f, towns, day, out);
    },

    /** Days of spending the chests hold. */
    reserveDays(k) {
        const f = k && _obj(k.fisc);
        const exp = Math.max(1, _num(f && f.avg && f.avg.exp, 0) || 1);
        return _num(k && k.treasury) / exp;
    },

    /** An NPC crown reviews its taxes: one step toward what its temper and its purse want. */
    _review(world, st, k, f, day) {
        const N = Fiscal.config().npc;
        const pid = KingdomAI.personalityId(k);
        let want = 1 + _num(N.bias && N.bias[pid]);
        const days = Fiscal.reserveDays(k);
        if (Array.isArray(k.wars) && k.wars.length) want += 1;
        if (days < _num(N.lowDays, 10)) want += 2;
        else if (days < _num(N.reserveLow, 30)) want += 1;
        else if (days > _num(N.highDays, 320)) want -= 2;
        else if (days > _num(N.reserveHigh, 160)) want -= 1;
        if (f.arrearsDays > 0) want += 1;
        if (_num(k.stability, 50) < _num(N.unrestAt, 35) && f.arrearsDays === 0) want -= 1;
        if (Fiscal.recent(world, k.id, 'tax_revolt', _num(N.revoltDays, 60)).length) want -= 1;
        want = _clamp(Math.round(want), 0, LEVELS.length - 1);
        const cur = Math.max(0, LEVELS.indexOf(f.level));
        const next = want > cur ? cur + 1 : want < cur ? cur - 1 : cur;
        if (next !== cur) {
            f.level = LEVELS[next];
            for (const l of TAXES) f.rates[l] = f.level;
            if (next > cur && next >= 2) Fiscal._record(world, st, { kind: 'tax_raise', kingdomId: k.id, kingdom: k.name, level: f.level });
        }
        // A rich court keeps a lavish household, a poor one a frugal one
        f.courtLevel = days > _num(N.reserveHigh, 160) ? 'lavish' : days < _num(N.lowDays, 10) ? 'frugal' : 'standard';
        // Broke with the soldiers unpaid: half pay; full again once the chests recover
        if (f.arrearsDays > 0 && days < _num(N.halfPayDays, 4)) f.armyPay = 'half';
        else if (f.armyPay === 'half' && f.arrearsDays === 0 && days > _num(N.reserveLow, 30)) f.armyPay = 'full';
    },

    /** Weekly tax revolts in hard-pressed, heavily taxed towns (hash rolls). */
    _revolts(world, player, st, k, f, towns, ruledId, day, out) {
        const V = Fiscal.config().revolts;
        const seed = _seed(world);
        const base = CrownBooks.burden(k, 1);
        const perSq = _num(Fiscal.config().burden.farmPerSqueeze, 0.3);
        for (const t of towns) {
            const s = t.s;
            if (_num(s.taxRevolt) > day) continue;
            const farm = _obj(s.taxFarm);
            const burden = base + (farm ? Math.max(0, _num(farm.squeeze, 1) - 1) * perSq : 0);
            const lab = s.labour;
            const wel = lab && lab.wel && Number.isFinite(lab.wel.peasants) ? lab.wel.peasants : (lab && Number.isFinite(lab.all) ? lab.all : 0.8);
            const pressure = Math.max(0, burden - _num(V.burdenAt)) * _num(V.perBurden)
                + Math.max(0, _num(V.welfareAt) - wel) * _num(V.perWelfare) + (farm ? _num(V.farmed) : 0);
            if (!(pressure > 0)) continue;
            const chance = Math.min(_num(V.max, 0.2), pressure * _num(V.chance));
            if (_frac(`${seed}|taxrevolt|${t.key}|${day}`) >= chance) continue;
            s.taxRevolt = day + _num(V.days, 30);
            s.happiness = _clamp(_num(s.happiness, 50) - _num(V.happiness, 5), 0, 100);
            k.stability = _clamp(_num(k.stability, 50) - _num(V.stability, 2), 0, 100);
            f.stats.revolts = _num(f.stats.revolts) + 1;
            st.stats.revolts++;
            Fiscal._record(world, st, { kind: 'tax_revolt', kingdomId: k.id, kingdom: k.name, town: s.name, q: t.q, r: t.r, farmed: !!farm, holder: farm ? farm.holderName : null });
            const mine = farm && farm.holder === 'player';
            if (mine) Fiscal._note(out, '🔥', 'Your Collectors Driven Out', `${s.name} rises against your tax farm: your men are beaten and chased out. Nothing will be collected there for ${_num(V.days, 30)} days.`, 'error');
            else if (k.id === ruledId) Fiscal._note(out, '🔥', 'A Tax Revolt', `${s.name} refuses the crown's taxes and drives out the collectors. Lighter taxes, or bread, may calm it.`, 'warning');
        }
    },

    // ── Tax farms ─────────────────────────────────────────

    /** Is a crown short enough of money to sell a town's taxes? */
    _needsFarm(k, f) {
        const F = Fiscal.config().farms;
        const days = Fiscal.reserveDays(k);
        const war = Array.isArray(k.wars) && k.wars.length > 0;
        return days < _num(F.needDays, 25) || f.deficitWeeks >= _num(F.deficitWeeks, 2) || (war && days < _num(F.warDays, 60)) || f.arrearsDays > 0;
    },

    /** The estimate of a town's taxes over a farm's term. */
    _estimate(f, key) {
        return Math.round(Math.max(0, _num(f.towns[key])) * _num(Fiscal.config().farms.term, 120));
    },

    /** The banking house that would bid for a lot (liquid capital, on speaking terms), or null. */
    _bidder(world, player, k, amount) {
        const fst = player ? Finance.state(player) : null;
        if (!fst || !Array.isArray(fst.banks)) return null;
        const B = Finance.cfg('banks');
        const day = _day(world);
        return fst.banks
            .filter(b => b && b.status === 'open' && !Finance.inPanic(b, day) && _num(b.relations && b.relations[k.id], 0) >= 0
                && _num(b.capital) - _num(b.baseCapital) * _num(B.crownReserveFloor, 0.6) >= amount)
            .sort((a, b) => _num(b.relations[k.id]) - _num(a.relations[k.id]) || String(a.id).localeCompare(String(b.id)))[0] || null;
    },

    /** Put a town's taxes up for auction. Returns the lot, or null. */
    _openLot(world, player, st, k, f, t, day) {
        const F = Fiscal.config().farms;
        const est = Fiscal._estimate(f, t.key);
        if (est < _num(F.minEst, 400)) return null;
        const disc = F.discount || [0.82, 0.92];
        const frac = _frac(`${_seed(world)}|farmbid|${t.key}|${day}`);
        const bid = Math.round(est * (disc[0] + (disc[1] - disc[0]) * frac));
        const bank = Fiscal._bidder(world, player, k, bid);
        const lot = {
            id: `L${st.nextId++}`, kid: k.id, kingdom: k.name, key: t.key, q: t.q, r: t.r, town: t.s.name,
            est, reserve: Math.round(est * _num(F.reserve, 0.75)), opened: day, closes: day + _num(F.close, 7),
            bank: bank ? { id: bank.id, name: bank.name, bid } : null, player: null,
        };
        st.lots.push(lot);
        return lot;
    },

    _offerFarm(world, player, st, k, f, towns, day, out) {
        const F = Fiscal.config().farms;
        if (F.enabled === false || !towns.length) return;
        if (st.lots.some(l => l.kid === k.id)) return;
        if (!Fiscal._needsFarm(k, f)) return;
        if (Number.isFinite(f.lastLot) && day - f.lastLot < _num(F.cooldown, 28) && day >= f.lastLot) return;
        const farmed = towns.filter(t => _obj(t.s.taxFarm)).length;
        if (farmed + 1 > Math.floor(towns.length * _num(F.maxShare, 0.4))) return;
        const cap = k.capital ? _key(k.capital.q, k.capital.r) : null;
        const pick = towns.filter(t => t.key !== cap && !_obj(t.s.taxFarm) && !(_num(t.s.taxRevolt) > day))
            .sort((a, b) => _num(f.towns[b.key]) - _num(f.towns[a.key]) || a.key.localeCompare(b.key))[0];
        if (!pick) return;
        const lot = Fiscal._openLot(world, player, st, k, f, pick, day);
        if (lot) f.lastLot = day;
        if (lot && player && player.allegiance === k.id) {
            Fiscal._note(out, '📜', 'Taxes for Sale', `The crown of ${k.name} auctions the taxes of ${lot.town} for ${_num(F.term, 120)} days (reckoned at ${lot.est}g). Bids close on day ${lot.closes}.`, 'info');
        }
    },

    /** Lots closing today go to the highest bidder. */
    _lotsDay(world, player, st, day, out) {
        const F = Fiscal.config().farms;
        for (const lot of st.lots.slice()) {
            const k = _kingdom(world, lot.kid);
            const tile = world.getTile(lot.q, lot.r);
            const s = tile && tile.settlement;
            const gone = !k || k.isAlive === false || !s || s.kingdom !== lot.kid || _obj(s.taxFarm);
            if (!gone && day < lot.closes) continue;
            st.lots = st.lots.filter(x => x !== lot);
            const pb = lot.player ? _num(lot.player.bid) : 0;
            if (gone) {
                if (pb > 0 && player) Fiscal._refund(player, pb, `The auction of ${lot.town}'s taxes is called off: your ${pb}g is returned.`, out);
                continue;
            }
            const bb = lot.bank ? _num(lot.bank.bid) : 0;
            let holder = null, paid = 0, holderName = null, squeeze = _num(F.bankSqueeze, 1.25);
            if (pb > 0 && pb >= bb && pb >= lot.reserve) {
                holder = 'player'; paid = pb; holderName = player && player.name ? player.name : 'you';
                const lv = (F.squeeze || {})[lot.player.squeeze] || (F.squeeze || {}).firm || { mult: 1.2 };
                squeeze = _num(lv.mult, 1.2);
            } else if (bb > 0) {
                const fst = player ? Finance.state(player) : null;
                const bank = fst ? Finance.bank(player, lot.bank.id) : null;
                if (bank && bank.status === 'open' && _num(bank.capital) >= bb) {
                    bank.capital = _num(bank.capital) - bb;
                    holder = bank.id; paid = bb; holderName = bank.name;
                }
                if (pb > 0 && player) Fiscal._refund(player, pb, `${lot.bank.name} outbid you for the taxes of ${lot.town}: your ${pb}g is returned.`, out);
            }
            if (!holder) continue;
            k.treasury = _num(k.treasury) + paid;
            CrownBooks.note(k, 'farms', paid);
            const farm = {
                id: `F${st.nextId++}`, kid: k.id, kingdom: k.name, key: lot.key, q: lot.q, r: lot.r, town: lot.town,
                holder, holderName, paid, start: day, until: day + _num(F.term, 120), squeeze,
                squeezeId: holder === 'player' ? (lot.player.squeeze || 'firm') : null, collected: 0, cost: 0,
            };
            st.farms.push(farm);
            s.taxFarm = { id: farm.id, holder, holderName, squeeze, until: farm.until };
            st.stats.farmsSold++;
            CrownBooks.state(k).stats.farmsSold = _num(CrownBooks.state(k).stats.farmsSold) + 1;
            if (holder === 'player') st.stats.playerFarms++;
            Fiscal._record(world, st, { kind: 'tax_farm', kingdomId: k.id, kingdom: k.name, town: lot.town, q: lot.q, r: lot.r, holder: holderName, amount: paid, own: holder === 'player' });
            if (holder === 'player') Fiscal._note(out, '📜', 'Your Tax Farm', `You farm the taxes of ${lot.town} for ${_num(F.term, 120)} days (${paid}g paid to the crown of ${k.name}). Your collectors go out tomorrow.`, 'success');
        }
    },

    _refund(player, amount, text, out) {
        player.gold = _num(player.gold) + amount;
        Ledger.record(player, 'taxFarmBids', amount);
        Fiscal._note(out, '📜', 'Bid Returned', text, 'info');
    },

    /** A farmer's take from a town: to the house's capital, or the player's purse (less the collectors' wages). */
    _farmCollect(world, player, st, k, s, marker, take) {
        const farm = Fiscal._farmById(st, marker.id);
        if (!farm || !(take > 0)) return;
        if (farm.holder === 'player') {
            const F = Fiscal.config().farms;
            const cost = take * _num(F.collectCost, 0.05);
            const net = _r2(take - cost);
            farm.collected = _r2(farm.collected + net);
            farm.cost = _r2(farm.cost + cost);
            if (player) {
                player.gold = _num(player.gold) + net;
                Ledger.record(player, 'taxFarms', net);
                const lv = (F.squeeze || {})[farm.squeezeId] || {};
                if (_num(lv.rep) > 0 && player.reputation) player.reputation[k.id] = Math.max(-100, _num(player.reputation[k.id]) - _num(lv.rep));
                if (_num(lv.happiness) > 0) s.happiness = _clamp(_num(s.happiness, 50) - _num(lv.happiness), 0, 100);
            }
            return;
        }
        farm.collected = _r2(farm.collected + take);
        const bank = Fiscal._banks ? Fiscal._banks.get(farm.holder) : (player ? Finance.bank(player, farm.holder) : null);
        if (bank) bank.capital = _num(bank.capital) + take;
    },

    _farmById(st, id) {
        if (!Fiscal._farmIdx || Fiscal._farmIdx.src !== st.farms || Fiscal._farmIdx.n !== st.farms.length) {
            Fiscal._farmIdx = { src: st.farms, n: st.farms.length, m: new Map(st.farms.map(f => [f.id, f])) };
        }
        return Fiscal._farmIdx.m.get(id) || null;
    },

    /** Farms that ran their term, or whose town changed hands, end. */
    _farmsDay(world, player, st, byK, day, out) {
        for (const farm of st.farms.slice()) {
            const tile = world.getTile(farm.q, farm.r);
            const s = tile && tile.settlement;
            const k = _kingdom(world, farm.kid);
            const lost = !s || !k || k.isAlive === false || s.kingdom !== farm.kid;
            if (!lost && day < farm.until) continue;
            st.farms = st.farms.filter(x => x !== farm);
            if (s && _obj(s.taxFarm) && s.taxFarm.id === farm.id) delete s.taxFarm;
            if (farm.holder === 'player') {
                const text = lost ? `${farm.town} is lost to ${k ? k.name : 'its crown'}: the new masters do not honour your tax farm (${Math.round(farm.collected)}g collected against ${farm.paid}g paid).`
                    : `Your farm of ${farm.town}'s taxes ends: ${Math.round(farm.collected)}g collected against ${farm.paid}g paid.`;
                Fiscal._note(out, '📜', 'Tax Farm Ends', text, lost ? 'warning' : 'info');
            }
        }
    },

    // ── The player ───────────────────────────────────────

    /** The open lot for a town, if any. */
    lot(world, lotId) {
        return Fiscal.state(world).lots.find(l => l.id === lotId) || null;
    },

    /** Open lots, optionally of one realm. */
    lots(world, kid = null) {
        return Fiscal.state(world).lots.filter(l => kid == null || l.kid === kid);
    },

    /** The player's tax farms. */
    playerFarms(world) {
        return Fiscal.state(world).farms.filter(f => f.holder === 'player');
    },

    /** Farms in a realm. */
    farmsIn(world, kid) {
        return Fiscal.state(world).farms.filter(f => f.kid === kid);
    },

    /** The least the player must bid on a lot. */
    minBid(lot) {
        const F = Fiscal.config().farms;
        const top = Math.max(_num(lot && lot.bank && lot.bank.bid), _num(lot && lot.player && lot.player.bid));
        return Math.max(_num(lot && lot.reserve), Math.ceil(top * (1 + _num(F.outbid, 0.03))));
    },

    /** Where the player stands: the realm whose lots they may bid on (in any of its towns). */
    _realmHere(player, world) {
        const tile = player && world ? world.getTile(player.q, player.r) : null;
        const s = tile && tile.settlement;
        return s && s.kingdom != null ? _kingdom(world, s.kingdom) : null;
    },

    /**
     * Bid for a lot: the gold is held by the crown's clerks until the lot
     * closes (returned if outbid or called off). squeeze: gentle / firm / harsh.
     */
    bid(player, world, lotId, squeeze = 'firm', amount = null) {
        const F = Fiscal.config().farms;
        if (!Fiscal.enabled() || F.enabled === false) return { success: false, reason: 'No crown sells its taxes.' };
        const lot = Fiscal.lot(world, lotId);
        if (!lot) return { success: false, reason: 'That auction has closed.' };
        const here = Fiscal._realmHere(player, world);
        if (!here || here.id !== lot.kid) return { success: false, reason: `Bid in a town of ${lot.kingdom}.` };
        if (Fiscal._ruledId(player) === lot.kid) return { success: false, reason: 'You cannot farm your own crown\'s taxes.' };
        if (!(F.squeeze || {})[squeeze]) return { success: false, reason: 'Choose how hard your collectors press.' };
        const min = Fiscal.minBid(lot);
        const prev = lot.player ? _num(lot.player.bid) : 0;
        const bid = Math.max(min, Math.floor(_num(amount, min)));
        if (prev >= Math.max(_num(lot.bank && lot.bank.bid), lot.reserve) && amount == null) {
            lot.player.squeeze = squeeze;
            return { success: true, bid: prev, text: `Your bid of ${prev}g stands (collectors: ${squeeze}).` };
        }
        const extra = bid - prev;
        if (_num(player.gold) < extra) return { success: false, reason: `You need ${extra}g to bid ${bid}g.` };
        player.gold = _num(player.gold) - extra;
        Ledger.record(player, 'taxFarmBids', -extra);
        lot.player = { bid, squeeze, day: _day(world) };
        return { success: true, bid, text: `You bid ${bid}g for the taxes of ${lot.town} (reckoned at ${lot.est}g over ${_num(F.term, 120)} days). The lot closes on day ${lot.closes}.` };
    },

    /** Change how hard your collectors press in a farm. */
    setSqueeze(player, world, farmId, squeeze) {
        const F = Fiscal.config().farms;
        const lv = (F.squeeze || {})[squeeze];
        const farm = Fiscal.state(world).farms.find(x => x.id === farmId && x.holder === 'player');
        if (!farm) return { success: false, reason: 'You hold no such farm.' };
        if (!lv) return { success: false, reason: 'Unknown squeeze.' };
        farm.squeeze = _num(lv.mult, 1);
        farm.squeezeId = squeeze;
        const tile = world.getTile(farm.q, farm.r);
        const s = tile && tile.settlement;
        if (s && _obj(s.taxFarm) && s.taxFarm.id === farm.id) s.taxFarm.squeeze = farm.squeeze;
        return { success: true, text: `Your collectors in ${farm.town} will be ${lv.label.toLowerCase()} now.` };
    },

    /** The realm the player rules, if any. */
    ruledKingdom(player, world) {
        const id = Fiscal._ruledId(player);
        return id != null ? _kingdom(world, id) : null;
    },

    /** A ruler sets a tax ('land', 'poll', 'excise' or 'all') to a level. */
    setRate(player, world, tax, level) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        if (!LEVELS.includes(level)) return { success: false, reason: 'Unknown level.' };
        const f = CrownBooks.state(k);
        const which = tax === 'all' ? TAXES : TAXES.includes(tax) ? [tax] : [];
        if (!which.length) return { success: false, reason: 'Unknown tax.' };
        for (const l of which) f.rates[l] = level;
        f.level = level;
        const L = Fiscal.config().levels[level] || {};
        return { success: true, text: `${tax === 'all' ? 'All taxes' : `The ${tax} tax`} of ${k.name}: ${L.label || level}.` };
    },

    /** A ruler sets the army's pay (half / full / generous). */
    setArmyPay(player, world, level) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const L = Fiscal.config().army.levels[level];
        if (!L) return { success: false, reason: 'Unknown pay.' };
        CrownBooks.state(k).armyPay = level;
        return { success: true, text: `The army of ${k.name} goes on ${L.label.toLowerCase()}.` };
    },

    /** A ruler sets the court (frugal / standard / lavish). */
    setCourt(player, world, level) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const L = Fiscal.config().court.levels[level];
        if (!L) return { success: false, reason: 'Unknown court.' };
        CrownBooks.state(k).courtLevel = level;
        return { success: true, text: `The court of ${k.name} is to be ${L.label.toLowerCase()}.` };
    },

    /** A ruler auctions a town's taxes (not the capital's). */
    royalFarm(player, world, key) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const st = Fiscal.state(world);
        if (st.lots.some(l => l.kid === k.id)) return { success: false, reason: 'An auction is already open.' };
        const [q, r] = String(key).split(',').map(Number);
        const tile = world.getTile(q, r);
        const s = tile && tile.settlement;
        if (!s || s.kingdom !== k.id) return { success: false, reason: 'Not a town of your realm.' };
        if (k.capital && k.capital.q === q && k.capital.r === r) return { success: false, reason: 'The capital\'s taxes are the crown\'s own.' };
        if (_obj(s.taxFarm)) return { success: false, reason: 'Its taxes are farmed already.' };
        const lot = Fiscal._openLot(world, player, st, k, CrownBooks.state(k), { key: _key(q, r), q, r, s }, _day(world));
        if (!lot) return { success: false, reason: 'Its taxes are too small to farm.' };
        return { success: true, text: `The taxes of ${s.name} go to auction (reckoned at ${lot.est}g)${lot.bank ? `: ${lot.bank.name} bids ${lot.bank.bid}g` : ''}. The lot closes on day ${lot.closes}.` };
    },

    /** A ruler sells offices or crown land outright. */
    royalSale(player, world, kind) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const gain = kind === 'offices' ? CrownBooks.sellOffices(k) : CrownBooks.sellLand(k);
        if (!(gain > 0)) return { success: false, reason: 'Little crown land is left to sell.' };
        return { success: true, gain, text: kind === 'offices' ? `Offices sold for ${gain}g. The buyers will have their money back from the people.` : `Royal manors sold for ${gain}g. The crown's rents are the less.` };
    },

    // ── Read-outs ─────────────────────────────────────────

    /** A realm's budget for the Treasury panel. */
    budget(world, k) {
        if (!k) return null;
        const f = CrownBooks.state(k);
        return {
            kingdom: k, treasury: Math.round(_num(k.treasury)), level: f.level, rates: { ...f.rates }, armyPay: f.armyPay, courtLevel: f.courtLevel,
            last: { ...f.last }, week: { ...f.lastWeek }, avg: { ...f.avg }, hist: f.hist.slice(),
            arrears: { ...f.arrears }, arrearsDays: f.arrearsDays, corruption: f.corruption, demesne: f.demesne,
            reserveDays: Math.round(Fiscal.reserveDays(k)), burden: CrownBooks.burden(k), stability: CrownBooks.stabilityMod(k),
            armyFactor: CrownBooks.armyFactor(k), deficitWeeks: f.deficitWeeks, stats: { ...f.stats },
            farms: Fiscal.farmsIn(world, k.id), lots: Fiscal.lots(world, k.id),
        };
    },

    /** Every living realm: treasury, last week's revenue and spending, level, its history. */
    realmTable(world) {
        return _alive(world).map(k => {
            const f = CrownBooks.state(k);
            return {
                id: k.id, name: k.name, treasury: Math.round(_num(k.treasury)), level: f.level,
                rev: Math.round(CrownBooks.revenue(f.lastWeek)), exp: Math.round(CrownBooks.expense(f.lastWeek)),
                arrearsDays: f.arrearsDays, corruption: f.corruption, farms: Fiscal.farmsIn(world, k.id).length, hist: f.hist.slice(),
            };
        });
    },

    /** Ruler warnings for the Counsel: deficit, arrears, an auction you could join. */
    ruledWarning(player, world) {
        const k = Fiscal.ruledKingdom(player, world);
        if (!k) return null;
        const f = CrownBooks.state(k);
        if (f.arrearsDays > 0) return { kind: 'arrears', kingdom: k.name, owed: Math.round(f.arrears.army + f.arrears.court), days: f.arrearsDays };
        const rev = CrownBooks.revenue(f.lastWeek), exp = CrownBooks.expense(f.lastWeek);
        if (exp > rev * 1.05 && Fiscal.reserveDays(k) < 60) return { kind: 'deficit', kingdom: k.name, gap: Math.round(exp - rev), days: Math.round(Fiscal.reserveDays(k)) };
        return null;
    },
};
