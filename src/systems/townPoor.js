// ============================================
// TOWN POOR — how the poor of every town get by (or don't)
// ============================================
// At each town's market turn (systems/labour.js, after its labour turn) the
// households of each working class — peasants, artisans, merchants
// (world/townLabour.js) — buy their basket: food first, then fuel, then
// clothes, per head at the town's own prices (data/townPoor.json). The hands
// at work pay for it from their wages; the idle hands have none. What a
// class earns over its basket goes partly into its savings; what it lacks is
// met, in order, by:
//
//   savings        the people's share of the town's purse put by in good times
//   day labour     the idle hauling the day's trade and building the town's houses
//   alms           the realm's church (its estate purse), the town's guilds for
//                  their own, the noble houses holding its estates, the town's
//                  poor rate (the realm's Poor Relief law, or the town's own
//                  ordinance), the crown's dole (the law's 'crownDole'), an
//                  almshouse's poor box (the player's gift)
//   begging        what the better-off give in the street
//   petty theft    (the town's crime rises with it)
//   pawning        their few things, coming back when they are fed again
//
// and what is still short goes unbought (settlement.poor.cut, read by the
// market's turn: world/settlementMarket.js): clothes first, then fuel, then
// bread. Hunger follows (a moving average): the class's welfare falls
// (world/townLabour.js), the townsfolk sicken (systems/illness.js), in a long
// dearth the poorest die, and the welfare sends people to other towns.
//
// Coin: alms, the rate, the crown's dole and the poor box move real coin into
// the town's purse (the poor spend it at the bakers'); savings, day labour,
// begging, theft and pawning pass among the town's own people (its common
// purse), so no coin moves. The poor box is counted by systems/coinCensus.js.
//
// Housing: each week the town's builders raise what it lacks
// (world/townHousing.js week), the day labourers among its idle.
//
// The named townsfolk (systems/townJobs.js payday) draw on the same dole
// (`namedRelief`): the town's almshouse box first, then the church's alms.
//
// State: settlement.poor (saved with the tile), world.townPoor (the year's
// books: SaveLoad). Deterministic: no RNG drawn. Tuned in data/townPoor.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { TownHousing } from '../world/townHousing.js';
import { Estates } from '../world/estates.js';
import { CrownBooks } from '../world/crownBooks.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { NpcMemory } from './npcMemory.js';
import { TownTrade } from './townTrade.js';
import { TownSprawl } from './townSprawl.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;
const _r3 = (v) => Math.round(v * 1000) / 1000;
const WORKING = ['peasants', 'artisans', 'merchants'];
const SOURCES = ['wages', 'savings', 'dayLabour', 'church', 'guild', 'nobles', 'rate', 'crown', 'box', 'beg', 'crime', 'pawn', 'unmet'];

let _src;
let _cfg = null;

export const TownPoor = {
    WORKING,
    SOURCES,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townPoor : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            _cfg = _obj(src) || { enabled: false };
        }
        return _cfg;
    },

    on() { return TownPoor.config().enabled === true; },

    /** The world's books of the poor: { yr: { y, dead, alms by source, … }, last: previous year's }. */
    state(world) {
        if (!world) return null;
        let st = _obj(world.townPoor);
        if (!st) st = world.townPoor = { yr: null, last: null };
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.townPoor);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.townPoor = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : { yr: null, last: null };
    },

    _year(world, day) {
        const st = TownPoor.state(world);
        const Y = Math.max(1, _num(TownHousing.config().daysPerYear, 120));
        const y = Math.floor(day / Y);
        if (!st.yr || st.yr.y !== y) {
            if (st.yr) st.last = st.yr;
            st.yr = { y, dead: 0, idle: 0, hungry: 0, towns: 0 };
            for (const k of SOURCES) st.yr[k] = 0;
        }
        return st.yr;
    },

    /** A town's record of its poor (made on first sight). */
    ensure(s) {
        if (!s || typeof s !== 'object') return null;
        let p = s.poor;
        if (!_obj(p)) p = s.poor = { v: 1, sav: {}, pawn: _num(TownPoor.config().pawn && TownPoor.config().pawn.days, 8), h: {}, box: 0 };
        if (!_obj(p.sav)) p.sav = {};
        if (!_obj(p.h)) p.h = {};
        return p;
    },

    // ── The basket ─────────────────────────────────────────

    /**
     * A head's daily basket by group at the town's prices (food, fuel,
     * clothes: the market's own per-head need of each good × its price),
     * before a class's own share. → { food, fuel, clothes, total }
     */
    basket(world, s) {
        const C = TownPoor.config();
        const out = { food: 0, fuel: 0, clothes: 0, total: 0 };
        const m = s && s.market;
        const pop = Math.max(1, _num(s && s.population));
        if (!m) return out;
        const MC = SettlementMarket.config();
        const sh = SettlementMarket._shape(s);
        const groups = new Set(Array.isArray(C.groups) ? C.groups : ['food', 'fuel', 'clothes']);
        const tile = world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
        for (let i = 0; i < MC.goodIds.length; i++) {
            const need = sh.needA[i];
            if (!(need > 0)) continue;
            const g = MC.goodIds[i];
            const def = SettlementMarket.good(g);
            if (!def || !groups.has(def.group)) continue;
            // (the stall's price: systems/townTrade.js — the good's base at this market, by its scarcity)
            let price = TownTrade.price(world, s, g, tile);
            if (!Number.isFinite(price)) price = 1;
            out[def.group] += need / pop * Math.max(0.01, price);
        }
        out.total = out.food + out.fuel + out.clothes;
        return out;
    },

    /** A class's basket per head: its share of the town's, less what peasants grow and gather. */
    classBasket(s, stratum, B) {
        const C = TownPoor.config();
        const type = TownHousing.TYPES.includes(s.type) ? s.type : 'village';
        const mult = _num(C.strata && C.strata[stratum] && C.strata[stratum].basket, 1);
        const own = stratum === 'peasants';
        const food = B.food * mult * (own ? 1 - _num(C.ownFood && C.ownFood[type]) : 1);
        const fuel = B.fuel * mult * (own ? 1 - _num(C.ownFuel && C.ownFuel[type]) : 1);
        const clothes = B.clothes * mult;
        return { food, fuel, clothes, total: food + fuel + clothes };
    },

    // ── Relief: who gives ──────────────────────────────────

    /** The realm's Poor Relief: 'charity' (none), 'rate' or 'crownDole'; a town's own ordinance may keep a rate. */
    relief(world, s) {
        let v = 'charity';
        try { if (s && s.kingdom != null) v = Laws.value(world, s.kingdom, 'poorRelief') || 'charity'; } catch (e) { v = 'charity'; }
        if (v === 'charity' && s && s.ordinances && s.ordinances.poorRate === 'rate') v = 'rate';
        return v;
    },

    /** The church holder of the town's realm (its estate purse), or null. */
    _church(world, s) {
        const st = world && _obj(world.estates);
        if (!st || !st.holders || s.kingdom == null) return null;
        return st.holders[`church:${s.kingdom}`] || null;
    },

    /** The noble holders of the town's estates. */
    _nobles(world, s) {
        const st = world && _obj(world.estates);
        if (!st || !st.holders) return [];
        const out = [];
        for (const e of Estates.estatesOf(world, s.q, s.r)) {
            const h = e && e.holder && Estates.kindOf(e.holder) === 'noble' ? st.holders[e.holder] : null;
            if (h && !out.includes(h)) out.push(h);
        }
        return out;
    },

    /** Coin from a holder's purse into the town's (the poor spend it there). → paid */
    _fromHolder(s, h, want, cap) {
        if (!h || !(want > 0)) return 0;
        const amt = Utils.centsDown(Math.min(want, cap, Math.max(0, _num(h.purse))));
        if (!(amt > 0)) return 0;
        const paid = Economy.payTown(s, amt);
        h.purse = _r2(_num(h.purse) - paid);
        return paid;
    },

    /**
     * The dole for one named townsperson short of their board (systems/townJobs.js
     * payday): the almshouse box, then the church's alms — real coin into their
     * purse (the caller adds it). → paid
     */
    namedRelief(world, s, want) {
        if (!TownPoor.on() || !s || !(want > 0) || s.inKind) return 0;
        const C = TownPoor.config();
        const p = TownPoor.ensure(s);
        let left = want, got = 0;
        const fromBox = Utils.centsDown(Math.min(left, _num(p.box)));
        if (fromBox > 0) { p.box = _r2(p.box - fromBox); got += fromBox; left -= fromBox; p.boxOut = _r2(_num(p.boxOut) + fromBox); }
        const ch = TownPoor._church(world, s);
        const A = C.alms || {};
        if (ch && left > 0 && _num(ch.purse) > _num(A.churchReserve, 40)) {
            const amt = Utils.centsDown(Math.min(left * _num(A.church, 0.35), Math.max(0, _num(ch.purse) - _num(A.churchReserve, 40))));
            if (amt > 0) { ch.purse = _r2(_num(ch.purse) - amt); got += amt; }
        }
        return _r2(got);
    },

    // ── The market turn ────────────────────────────────────

    /**
     * One market turn of `k` days for a town's poor (after its labour turn).
     * → { deficit, unmet, hunger, dead, by: { source: gold } }
     */
    turn(world, s, k = 1, day = 0) {
        const res = { deficit: 0, unmet: 0, hunger: 0, dead: 0, by: {} };
        if (!TownPoor.on() || !s || !s.market) return res;
        const lab = s.labour;
        if (!TownLabour._valid(lab)) return res;
        const C = TownPoor.config();
        const LC = TownLabour.config();
        const p = TownPoor.ensure(s);
        const pop = Math.max(0, _num(s.population));
        if (!(pop > 0)) return res;
        const days = Math.max(1, Math.floor(k));
        const B = TownPoor.basket(world, s);
        const by = res.by;
        for (const x of SOURCES) by[x] = 0;
        const purse = Math.max(0, _num(Economy.townPurse(s)));

        // Each working class: wages against its basket, the idle with nothing
        const cls = {};
        let deficit = 0, need = 0, idleHeads = 0, idleHands = 0;
        let savAll = 0;
        for (const st of WORKING) {
            const sec = LC.sectorOf[st];
            const N = pop * _num(lab.sh[st]);
            const w = Math.max(0.05, _num(LC.workOf[st], 0.5));
            const idle = _clamp(_num(lab.idle[sec]), 0, 1);
            const wage = _num(lab.wage[sec], TownLabour.baseWage(s.type, sec));
            const b = TownPoor.classBasket(s, st, B);
            const E = N * (1 - idle), I = N * idle;
            const inc = wage * w;
            const short = I * b.total + E * Math.max(0, b.total - inc);
            const over = E * Math.max(0, inc - b.total);
            by.wages += Math.min(E * inc, E * b.total);
            cls[st] = { N, I, b, short, over, inc };
            deficit += short;
            need += N * b.total;
            idleHeads += I;
            idleHands += I * w;
            // (in good times they put by: the people's share of the purse, never more than savPurse of it)
            const cap = Math.min(_num(C.savDays, 40) * b.total * N, purse * _num(C.savPurse, 0.4) * (N / Math.max(1, pop)));
            if (!Number.isFinite(p.sav[st])) p.sav[st] = Math.min(cap, _num(C.startSavDays, 12) * b.total * N);
            p.sav[st] = _r2(_clamp(p.sav[st] + over * _num(C.saveShare, 0.25) * days, 0, Math.max(0, cap)));
            savAll += p.sav[st];
        }
        res.deficit = _r2(deficit);
        let left = deficit * days;
        const take = (src, n) => { const t = Math.max(0, Math.min(left, n)); if (t > 0) { by[src] += t; left -= t; } return t; };

        // Day labour: the idle haul the day's trade and build the town's houses
        const DL = C.dayLabour || {};
        const trade = s.market.trade ? (_num(s.market.trade.in) + _num(s.market.trade.out)) / days : 0;
        const building = (s.housing && Array.isArray(s.housing.q)) ? s.housing.q.length : 0;
        const dayHands = Math.min(idleHands * _num(DL.maxShare, 0.6), trade * _num(DL.perTrade, 0.6) + building * _num(DL.perBuild, 6));
        const dayWage = _num(lab.wage.land, TownLabour.baseWage(s.type, 'land')) * _num(DL.wage, 0.7);
        take('dayLabour', dayHands * dayWage * days);

        // Savings
        if (left > 0 && savAll > 0) {
            const used = take('savings', savAll);
            for (const st of WORKING) p.sav[st] = _r2(Math.max(0, p.sav[st] - used * (savAll > 0 ? p.sav[st] / savAll : 0)));
        }

        // Alms: real coin into the town's purse
        const A = C.alms || {};
        if (left > 0 && !s.inKind) {
            const ch = TownPoor._church(world, s);
            if (ch && _num(ch.purse) > _num(A.churchReserve, 40)) {
                take('church', TownPoor._fromHolder(s, ch, left * _num(A.church, 0.35), (_num(ch.purse) - _num(A.churchReserve, 40)) * _num(A.churchPurse, 0.0006) * days));
            }
            // (the guilds keep their own: the artisans' and merchants' want)
            const gs = _obj(s.guilds);
            if (gs && left > 0) {
                const theirs = (_num(cls.artisans && cls.artisans.short) + _num(cls.merchants && cls.merchants.short)) * days * _num(A.guild, 0.5);
                let want = Math.min(left, theirs);
                for (const g of Object.values(gs)) {
                    if (!g || !(want > 0)) continue;
                    const amt = Utils.centsDown(Math.min(want, Math.max(0, _num(g.treasury)) * _num(A.guildPurse, 0.002) * days));
                    if (!(amt > 0)) continue;
                    const paid = Economy.payTown(s, amt);
                    g.treasury = _r2(_num(g.treasury) - paid);
                    take('guild', paid);
                    want -= paid;
                }
            }
            for (const h of TownPoor._nobles(world, s)) {
                if (!(left > 0)) break;
                if (_num(h.purse) <= _num(A.nobleReserve, 60)) continue;
                take('nobles', TownPoor._fromHolder(s, h, left * _num(A.nobles, 0.2), (_num(h.purse) - _num(A.nobleReserve, 60)) * _num(A.noblePurse, 0.0004) * days));
            }
            const relief = TownPoor.relief(world, s);
            if (left > 0 && (relief === 'rate' || relief === 'crownDole')) {
                // (the burghers' rate: their coin to the poor, spent at the bakers' — the town's own purse)
                const R = C.rate || {};
                take('rate', Math.min(left * _num(R.share, 0.5), purse * _num(R.purse, 0.0015) * days));
            }
            if (left > 0 && relief === 'crownDole') {
                const k = typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
                const K = C.crown || {};
                if (k && _num(k.treasury) > 0) {
                    const amt = Utils.centsDown(Math.min(left * _num(K.share, 0.6), _num(k.treasury) * _num(K.treasury, 0.0008) * days));
                    const paid = amt > 0 ? Economy.payTown(s, amt) : 0;
                    if (paid > 0) {
                        k.treasury = _r2(_num(k.treasury) - paid);
                        CrownBooks.note(k, 'dole', paid);
                        MoneySupply.note(world, k.id, paid, 'fisc');
                        take('crown', paid);
                    }
                }
            }
            if (left > 0 && _num(p.box) >= _num(C.box && C.box.min, 1)) {
                const amt = Utils.centsDown(Math.min(left, Math.max(_num(C.box && C.box.min, 1), _num(p.box) * _num(C.box && C.box.perDay, 0.02) * days), _num(p.box)));
                const paid = amt > 0 ? Economy.payTown(s, amt) : 0;
                if (paid > 0) { p.box = _r2(p.box - paid); p.boxOut = _r2(_num(p.boxOut) + paid); take('box', paid); }
            }
        }

        // Begging, petty theft, pawning
        if (left > 0) {
            const givers = pop * (_num(lab.sh.merchants) + _num(lab.sh.nobles) + _num(lab.sh.clergy));
            take('beg', Math.min(left * _num(C.beg && C.beg.share, 0.25), givers * _num(C.beg && C.beg.perGiver, 0.004) * days));
        }
        if (left > 0) {
            let deter = 1;
            try { deter = _num((Laws.punishment(world, s.kingdom) || {}).deter, 1); } catch (e) { deter = 1; }
            take('crime', left * _num(C.crime && C.crime.share, 0.2) * _clamp(deter, 0.4, 1.5));
        }
        const PW = C.pawn || {};
        if (left > 0 && _num(p.pawn) > 0) {
            const perDay = Math.max(0.01, deficit);
            const used = take('pawn', Math.min(left, _num(p.pawn) * perDay));
            p.pawn = _r3(Math.max(0, _num(p.pawn) - used / perDay));
        } else if (left <= 0) {
            p.pawn = _r3(Math.min(_num(PW.days, 8), _num(p.pawn) + _num(PW.backPerDay, 0.05) * days));
        }
        by.unmet = Math.max(0, left);
        res.unmet = _r2(by.unmet / days);

        // What goes unbought: clothes, then fuel, then bread (among the households short)
        let fsum = 0, fuSum = 0, clSum = 0;
        for (const st of WORKING) {
            const c = cls[st];
            const share = deficit > 0 ? c.short / deficit : 0;
            fsum += share * c.b.food; fuSum += share * c.b.fuel; clSum += share * c.b.clothes;
        }
        const tot = fsum + fuSum + clSum;
        let un = left / days;
        const dS = deficit > 0 && tot > 0 ? deficit / tot : 0;   // (heads short, in basket units)
        const unCl = Math.min(un, clSum * dS); un -= unCl;
        const unFu = Math.min(un, fuSum * dS); un -= unFu;
        const unFo = Math.min(un, fsum * dS);
        const townFood = Math.max(0.0001, B.food * pop), townFuel = Math.max(0.0001, B.fuel * pop), townCl = Math.max(0.0001, B.clothes * pop);
        const cut = { food: _r3(_clamp(unFo / townFood, 0, 0.6)), fuel: _r3(_clamp(unFu / townFuel, 0, 0.8)), clothes: _r3(_clamp(unCl / townCl, 0, 0.9)) };
        if (cut.food > 0 || cut.fuel > 0 || cut.clothes > 0) p.cut = cut; else delete p.cut;

        // Hunger by class: the unmet food among its heads (a moving average)
        const H = C.hunger || {};
        const a = 1 - Math.pow(1 - _clamp(_num(H.alpha, 0.25), 0, 1), days / 4);
        let hAll = 0;
        const dead = {};
        for (const st of WORKING) {
            const c = cls[st];
            const share = deficit > 0 ? c.short / deficit : 0;
            const foodNeed = Math.max(0.0001, c.N * c.b.food);
            const hT = _clamp(unFo * share / foodNeed, 0, 1);
            const h = _num(p.h[st]) + (hT - _num(p.h[st])) * a;
            p.h[st] = _r3(h);
            if (p.h[st] < 0.0005) delete p.h[st];
            hAll += c.N * h;
            // The poorest die in a long dearth
            const over = h - _num(H.dieFrom, 0.12);
            if (over > 0 && c.N > 20) {
                const n = c.N * over * _num(H.deathRate, 0.004) * days + _num(p.dc && p.dc[st]);
                const whole = Math.floor(n);
                (p.dc || (p.dc = {}))[st] = _r3(n - whole);
                if (whole > 0) dead[st] = -Math.min(whole, Math.floor(c.N * 0.2));
            }
        }
        const nDead = -Object.values(dead).reduce((t, v) => t + v, 0);
        if (nDead > 0 && pop - nDead > 30) {
            TownLabour._shift(s, lab, dead);
            res.dead = nDead;
            p.dead = _num(p.dead) + nDead;
            p.deadDay = day;
        }
        p.hunger = _r3(hAll / Math.max(1, pop));
        res.hunger = p.hunger;
        p.idle = Math.round(idleHeads);
        p.need = _r2(need);
        p.deficit = _r2(deficit);
        p.unmet = res.unmet;
        p.day = day;
        // (the share each source met of the turn's want, for the panel)
        const tw = deficit * days;
        p.by = {};
        if (tw > 0) for (const x of SOURCES) if (x !== 'wages' && by[x] > 0) p.by[x] = _r3(by[x] / tw);
        p.crime = _r3(_clamp(need > 0 ? by.crime / (need * days) * _num(C.crime && C.crime.crimeAdd, 3) : 0, 0, 0.5));
        p.cap = TownHousing.capacity(s);
        p.crowd = TownHousing.crowd(s);

        // The year's books
        const yr = TownPoor._year(world, day);
        for (const x of SOURCES) if (x !== 'wages') yr[x] = _r2(yr[x] + by[x]);
        yr.dead += res.dead;
        return res;
    },

    /** The share of the town's need of a good's group its market leaves unsold (the poor can't buy it). */
    cutOf(s, group) {
        const c = s && s.poor && s.poor.cut;
        return c ? _num(c[group]) : 0;
    },

    /** Hunger among a class (0..1), or the town's (no class). */
    hunger(s, stratum = null) {
        const p = s && s.poor;
        if (!p) return 0;
        return stratum ? _num(p.h && p.h[stratum]) : _num(p.hunger);
    },

    /** Sickness × from hunger among the poor (systems/illness.js). */
    sickMult(s) {
        const H = TownPoor.config().hunger || {};
        const h = TownPoor.hunger(s, 'peasants');
        return Math.min(_num(H.sickMax, 2), 1 + Math.max(0, h - _num(H.sickFrom, 0.05)) * _num(H.sickPer, 3));
    },

    // ── The week ───────────────────────────────────────────

    /**
     * Weekly: each town's builders (world/townHousing.js week), the notices
     * for hunger and overcrowding in the towns the player rules or stands in.
     */
    week(world, player, lives, ruled, day, out) {
        if (!TownPoor.on() && !TownHousing.on()) return;
        const C = TownPoor.config();
        const H = C.hunger || {};
        const here = player ? `${player.q},${player.r}` : null;
        const told = s => ruled.has(`${s.q},${s.r}`) || `${s.q},${s.r}` === here;
        for (const s of lives) {
            // (the builders' week, and what the town does when its ground runs out: systems/townSprawl.js)
            if (TownHousing.on()) { TownPoor.countLots(s, day); TownSprawl.week(world, player, s, day, out || null, told); }
            const p = s.poor;
            if (!p || !out) continue;
            const key = `${s.q},${s.r}`;
            if (!(ruled.has(key) || key === here)) continue;
            const every = _num(H.noticeEvery, 30);
            if (_num(p.hunger) >= _num(H.noticeAt, 0.15) && !(day - _num(p.toldH, -1e9) < every)) {
                p.toldH = day;
                out.notices.push({ icon: '🥖', title: `Hunger in ${s.name}`, text: `The poor of ${s.name} go hungry: about ${Math.round(_num(p.hunger) * 100)}% of the people short of bread${p.dead ? `, ${p.dead} dead of it so far` : ''}. Alms, a poor rate or work for the idle would feed them.`, type: 'warning' });
            }
            const crowd = TownHousing.crowd(s);
            if (crowd >= 1.1 && !(day - _num(p.toldC, -1e9) < every)) {
                p.toldC = day;
                const L = TownHousing.lodgers(s);
                out.notices.push({ icon: '🏚️', title: `${s.name} Overcrowded`, text: `${s.name} has more people than its houses hold: ${L.lodged} in rooms let${L.rough ? `, ${L.rough} doubled up or sleeping rough` : ''}. Rents climb, sickness spreads, fires take hold. More houses, or tenements on the lots, would house them.`, type: 'warning' });
            }
        }
    },

    /**
     * The dwellings raised on the town's lots (world/lotBook.js: a townsman's or a
     * rival's house, the player's house or tenement to let, a newcomer's house —
     * systems/arrivalCamps.js) join its housing once they stand: counted once
     * (built.housed). → dwellings added
     */
    countLots(s, day) {
        const book = s && s.lotBook;
        if (!book || !_obj(book.lots)) return 0;
        let n = 0;
        for (const rec of Object.values(book.lots)) {
            const b = rec && rec.built;
            if (!b || b.housed || b.wait || (b.readyDay != null && day < b.readyDay)) continue;
            const id = b.dwelling || (b.type === 'tenement' ? 'tenement' : b.type === 'rowhouse' ? 'row' : (b.type === 'house' || b.kind === 'house' || b.kind === 'settler') ? 'house' : null);
            if (!id || !TownHousing.def(id)) continue;
            b.housed = 1;
            n += TownHousing.addDwelling(s, id);
        }
        return n;
    },

    // ── The player ─────────────────────────────────────────

    /**
     * Give to a town's poor box (an almshouse once the gifts pass foundAt):
     * the coin from the player's purse into the box, paid out as the dole.
     */
    give(player, world, s, amount) {
        if (!player || !s) return { success: false, reason: 'There is no town here.' };
        const C = TownPoor.config();
        const a = Utils.centsDown(Math.max(0, _num(amount)));
        if (!(a > 0)) return { success: false, reason: 'Give how much?' };
        if (_num(player.gold) < a) return { success: false, reason: `You have ${Utils.formatGold(_num(player.gold))}g.` };
        if (s.inKind) return { success: false, reason: `${s.name} trades in kind: coin buys no bread here.` };
        const p = TownPoor.ensure(s);
        player.gold = _r2(_num(player.gold) - a);
        Ledger.record(player, 'charity', -a);
        p.box = _r2(_num(p.box) + a);
        p.given = _r2(_num(p.given) + a);
        const AH = C.almshouse || {};
        let founded = false;
        if (!p.almshouse && p.given >= _num(AH.foundAt, 200)) {
            p.almshouse = { by: 'player', name: player.name || 'you', day: _num(world && world.day) };
            founded = true;
        }
        try { NpcMemory.rememberTown(world, s, { kind: 'dole', player, weight: Math.min(3, _num(AH.memory, 1.5) * a / 200) }); } catch (e) { /* (no roster) */ }
        s.happiness = _clamp((typeof s.happiness === 'number' ? s.happiness : 50) + Math.min(5, a * _num(AH.happiness, 0.02)), 0, 100);
        const days = TownPoor.boxDays(s);
        return {
            success: true, amount: a, founded,
            text: founded
                ? `You endow an almshouse in ${s.name}: ${Utils.formatGold(p.given)}g given in all. Its dole feeds the town's hungry poor${days ? ` — about ${days} days of their want at today's need` : ''}.`
                : `You give ${Utils.formatGold(a)}g to the poor box of ${s.name}${p.almshouse ? "'s almshouse" : ''}. ${days ? `It holds ${Utils.formatGold(p.box)}g: about ${days} days of the poor's want.` : 'The poor want for nothing at present; the box keeps it for leaner days.'}`,
        };
    },

    /** Days of the poor's unmet want the box holds (null when no want). */
    boxDays(s) {
        const p = s && s.poor;
        if (!p) return null;
        const want = Math.max(_num(p.deficit) * 0.3, _num(p.unmet));
        return want > 0.01 ? Math.round(_num(p.box) / want) : null;
    },

    /** Set the town's own poor rate (its holder or ruler): 'rate' | 'none'. */
    setRate(player, world, s, on) {
        if (!s) return { success: false, reason: 'There is no town here.' };
        if (!s.ordinances || typeof s.ordinances !== 'object') s.ordinances = {};
        if (on) s.ordinances.poorRate = 'rate'; else delete s.ordinances.poorRate;
        return { success: true, text: on ? `${s.name} keeps a poor rate: the burghers' coin feeds the poor in hard times.` : `${s.name} keeps no poor rate of its own: its poor live on alms.` };
    },

    // ── Readers ────────────────────────────────────────────

    /** For the panels: how the poor get by. */
    summary(world, s) {
        const p = s && s.poor;
        const lab = s && s.labour;
        if (!p || !TownLabour._valid(lab)) return null;
        return {
            idle: _num(p.idle), idleShare: TownLabour.idle(s), deficit: _num(p.deficit), unmet: _num(p.unmet), need: _num(p.need),
            by: { ...(p.by || {}) }, hunger: _num(p.hunger), h: { ...(p.h || {}) }, dead: _num(p.dead), deadDay: p.deadDay != null ? p.deadDay : null,
            box: _num(p.box), boxOut: _num(p.boxOut), given: _num(p.given), almshouse: p.almshouse || null,
            relief: TownPoor.relief(world, s), sav: Object.values(p.sav || {}).reduce((a, b) => a + _num(b), 0), pawn: _num(p.pawn),
            cut: p.cut || null, crime: _num(p.crime), boxDays: TownPoor.boxDays(s),
        };
    },

    /** How the poor get by, in a word. */
    plight(s) {
        const p = s && s.poor;
        if (!p) return { label: 'Unknown', color: '#aaa' };
        if (_num(p.hunger) >= 0.15) return { label: 'Starving', color: '#e74c3c' };
        if (_num(p.hunger) >= 0.04) return { label: 'Going hungry', color: '#e67e22' };
        if (_num(p.deficit) > 0 && _num(p.by && p.by.savings) + _num(p.by && p.by.dayLabour) < 0.5) return { label: 'On alms', color: '#e8a040' };
        if (_num(p.deficit) > 0) return { label: 'Scraping by', color: '#c9c27a' };
        return { label: 'Getting by', color: '#9fd59f' };
    },
};
