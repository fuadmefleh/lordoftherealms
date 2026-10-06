// ============================================
// MERCHANT PRINCE — the player's levers on the settlement goods economy
// ============================================
// Every town keeps one goods store (world/settlementMarket.js). This module
// lets the player work it from the inside, beyond buying and selling:
//
//   - INDUSTRY. Fund works in a town — a mill, bakehouse, brewhouse, smithy,
//     weaving shed... one per local industry recipe of data/markets.json.
//     The works stand in the town's market (settlement.market.works[recipe]:
//     runs a day, levels, repair, owner) and run there on market day after
//     the town's own trades, taking real inputs from its stores and putting
//     real output back (SettlementMarket._runWorks). The investor is paid a
//     share of the value they added at the town's own prices; the crown
//     takes a tithe of it (more at war or in a treasury crisis). A realm at
//     war with the player seizes the works, a crown in crisis may, and a town
//     that comes to hate the player expropriates them. Raids and sacks damage
//     them (SettlementMarket.loot), sieges idle and wear them. In a town the
//     player holds they build cheaper, keep more and owe no tithe.
//   - WAREHOUSES. Rent store-rooms in a town to keep goods outside the packs
//     (player/inventory.js caps kinds, not amounts): bought straight from the
//     stalls, deposited from the packs, sold into that town's market later
//     at its price then (Trading.saleUnitPrice, capped like any sale). Goods
//     spoil at half the stalls' rate, rent falls due weekly, and thieves
//     (the guild, the player's heat, outlaws and raiders nearby) may strike.
//   - FORWARD CONTRACTS. Promise a town N units by day D at a price fixed
//     today from its real price curve (plus a small premium for the lead,
//     never above buying the lot back here). Deliver in parts from the packs
//     or the warehouse there; miss it and forfeit a quarter and reputation.
//
// State lives on player.merchantPrince (saved by systems/saveLoad.js); the
// works travel with their settlements' markets. Draws no RNG: thefts and
// crown seizures roll a hash of the day and the lease or works (Utils.hashStr),
// so a run is reproducible and other systems' dice are untouched. Tuned in
// data/merchantPrince.json; balance in docs/economy-balance.md.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { Seasons } from '../world/seasons.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { PlayerInventory } from '../player/inventory.js';
import { Underworld } from './underworld.js';
import { OutlawLairs } from './outlawLairs.js';
import { RealmWars } from './realmWars.js';
import { Throne } from './throne.js';
import { Finance } from './finance.js';
import { Taxation, MarketDynamics } from './marketDynamics.js';

const DEFAULTS = {
    industry: {
        investorShare: 0.52, ownShare: 0.72, ownCost: 0.85, levelCost: 1.35, maxInvestments: 8, minReputation: -10, kinds: {},
        tithe: { base: 0.1, war: 0.15, crisis: 0.2, chartersMult: 0.5 },
        seizure: { crisisChance: 0.08, expropriateBelow: -30, warnBelow: -20, graceDays: 10 },
        damage: { siegeWear: 0.03, repairCost: 0.5, salvage: 0.4, warnBelow: 0.6 },
    },
    warehouse: {
        maxLeases: 5, sizes: {}, spoilMult: 0.5, unpaidWeeks: 2,
        theft: {
            base: 0.01, guildTown: 0.02, perHeat: 0.0006, lairRadius: 4, lair: 0.03, raiderRadius: 2, raider: 0.02,
            perGuard: 0.003, min: 0.004, guildFriendRank: 2, guildFriendMult: 0.3, ownedMult: 0.5, loss: [0.15, 0.4],
        },
    },
    forwards: {
        maxOpen: 3, minDays: 10, maxDays: 60, minQty: 5, maxNeedDays: 15, premiumBase: 0.03, premiumPerDay: 0.002,
        premiumMax: 0.15, penaltyShare: 0.25, reputationDone: 1, reputationFailed: 4, dueSoonDays: 5,
    },
};

const LOG_CAP = 40;
const HISTORY_CAP = 40;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _round2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => _num(world && world.day);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

export const MerchantPrince = {

    // ── Data ────────────────────────────────────────────────

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.merchantPrince) || {};
    },

    config() {
        const src = MerchantPrince.data();
        if (MerchantPrince._cfg && MerchantPrince._cfgSrc === src) return MerchantPrince._cfg;
        MerchantPrince._cfgSrc = src;
        MerchantPrince._cfg = {
            industry: _merge(DEFAULTS.industry, src.industry),
            warehouse: _merge(DEFAULTS.warehouse, src.warehouse),
            forwards: _merge(DEFAULTS.forwards, src.forwards),
        };
        return MerchantPrince._cfg;
    },

    /** Industry kinds the player can fund ({ recipeId: def }), those whose recipe exists in the market model. */
    kinds() {
        const out = {};
        for (const [id, def] of Object.entries(MerchantPrince.config().industry.kinds || {})) {
            if (_obj(def) && SettlementMarket.recipe(id)) out[id] = def;
        }
        return out;
    },

    kind(recipeId) {
        return MerchantPrince.kinds()[recipeId] || null;
    },

    _good(id) {
        return (PlayerEconomy.GOODS && PlayerEconomy.GOODS[String(id || '').toUpperCase()]) || null;
    },

    goodName(id) {
        const g = MerchantPrince._good(id);
        return g ? `${g.icon || ''} ${g.name}`.trim() : String(id || '').replace(/_/g, ' ');
    },

    // ── State ───────────────────────────────────────────────

    _blank() {
        return {
            investments: [], warehouses: [], forwards: [], history: [], log: [], nextId: 1, lastDay: null,
            stats: {
                invested: 0, earned: 0, tithe: 0, repairs: 0, salvage: 0, seized: 0, expropriated: 0,
                rent: 0, spoiled: 0, stolen: 0, forfeited: 0, forwardsDone: 0, forwardsFailed: 0, forwardIncome: 0, penalties: 0, wages: 0,
            },
        };
    },

    /** The player's record (created and backfilled on demand). */
    state(player) {
        if (!player) return MerchantPrince._blank();
        let st = player.merchantPrince;
        if (!_obj(st)) st = player.merchantPrince = MerchantPrince._blank();
        const blank = MerchantPrince._blank();
        for (const k of ['investments', 'warehouses', 'forwards', 'history', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        for (const w of st.warehouses) {
            if (!_obj(w.goods)) w.goods = {};
            if (!(w.unpaid >= 0)) w.unpaid = 0;
            if (!(w.arrears >= 0)) w.arrears = 0;
        }
        for (const inv of st.investments) if (!(inv.lowRep >= 0)) inv.lowRep = 0;
        for (const f of st.forwards) if (!(f.delivered >= 0)) f.delivered = 0;
        return st;
    },

    serialize(player) {
        return player && player.merchantPrince ? JSON.parse(JSON.stringify(player.merchantPrince)) : null;
    },

    loadState(player) {
        if (player && player.merchantPrince) MerchantPrince.state(player);
        else if (player) player.merchantPrince = null;
    },

    _log(st, world, text) {
        st.log.push({ day: _day(world), text });
        if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
    },

    /** A record for the heralds and the chronicle ({ key, kind, day, ... }; systems/heralds.js reads it). */
    record(player, world, entry) {
        const st = MerchantPrince.state(player);
        if (st.history.some(h => h.key === entry.key)) return null;
        const h = { day: _day(world), ...entry };
        st.history.push(h);
        if (st.history.length > HISTORY_CAP) st.history.splice(0, st.history.length - HISTORY_CAP);
        return h;
    },

    // ── Places ──────────────────────────────────────────────

    _settlement(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return t && t.settlement ? t.settlement : null;
    },

    _here(player, tile) {
        return !!(player && tile && player.q === tile.q && player.r === tile.r);
    },

    _kingdom(world, s) {
        return s && s.kingdom && world && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
    },

    /** Does the player hold this town (a colony, a conquest, a granted holding)? */
    holds(player, world, q, r) {
        return Taxation.getPlayerSettlements(player, world).some(h => h.q === q && h.r === r);
    },

    /** Is the town in the realm the player rules? */
    inOwnRealm(player, world, s) {
        const k = Throne.ruledKingdom(player, world);
        return !!(k && s && s.kingdom && s.kingdom === k.id);
    },

    /** Is the town's realm at war with the player (or with the realm the player is sworn to)? */
    hostile(player, world, s) {
        if (!s || !s.kingdom) return false;
        if (RealmWars.atWarWith(player, s.kingdom)) return true;
        const sworn = player && player.allegiance && world && world.getKingdom ? world.getKingdom(player.allegiance) : null;
        return !!(sworn && sworn.id !== s.kingdom && Array.isArray(sworn.wars) && sworn.wars.includes(s.kingdom));
    },

    reputation(player, s) {
        return s && s.kingdom ? _num(player && player.reputation && player.reputation[s.kingdom]) : 0;
    },

    _addReputation(player, s, n) {
        if (!player || !s || !s.kingdom || !n) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[s.kingdom] = _clamp(_num(player.reputation[s.kingdom]) + n, -100, 100);
    },

    /** Is the realm's treasury in crisis (systems/finance.js thresholds)? */
    crownInCrisis(world, s) {
        const k = MerchantPrince._kingdom(world, s);
        const f = k && _obj(k.finance);
        if (!f) return false;
        const C = Finance.cfg('crowns');
        return _num(f.missed) >= _num(C.crisisMissed, 2) || _num(f.unpaid) >= _num(C.crisisUnpaid, 14) || _num(f.debtRatio) > _num(C.crisisRatio, 1.2);
    },

    // ── Industry ────────────────────────────────────────────

    /** The crown's tithe on the investor's share in this town (0..1). */
    titheRate(player, world, s) {
        const I = MerchantPrince.config().industry;
        if (!s || !s.kingdom) return 0;
        if (MerchantPrince.holds(player, world, s.q, s.r) || MerchantPrince.inOwnRealm(player, world, s)) return 0;
        const k = MerchantPrince._kingdom(world, s);
        let rate = _num(I.tithe.base);
        if (k && Array.isArray(k.wars) && k.wars.length) rate += _num(I.tithe.war);
        if (MerchantPrince.crownInCrisis(world, s)) rate += _num(I.tithe.crisis);
        if (MerchantPrince.chartered(player, world)) rate *= _num(I.tithe.chartersMult, 1);
        return _clamp(rate, 0, 0.9);
    },

    /** Does the player's own court enforce the Merchant charters edict (systems/kingship.js)? */
    chartered(player, world) {
        if (!Throne.ruledKingdom(player, world)) return false;
        const court = player.throne && player.throne.ruling && player.throne.ruling.court;
        return !!(court && court.edicts && court.edicts.merchant_charters);
    },

    /** Share of the works' value added the player is paid here. */
    shareRate(player, world, s) {
        const I = MerchantPrince.config().industry;
        return MerchantPrince.holds(player, world, s.q, s.r) ? _num(I.ownShare, 0.6) : _num(I.investorShare, 0.4);
    },

    /** The player's investment record for works at (q, r), or null. */
    investmentAt(player, q, r, recipeId) {
        return MerchantPrince.state(player).investments.find(i => i.q === q && i.r === r && i.recipe === recipeId) || null;
    },

    /** Gold and materials for the next level of works here. */
    levelCost(player, world, s, recipeId, lvl) {
        const I = MerchantPrince.config().industry;
        const def = MerchantPrince.kind(recipeId);
        if (!def) return null;
        const own = MerchantPrince.holds(player, world, s.q, s.r) ? _num(I.ownCost, 1) : 1;
        const gold = Math.round(_num(def.gold) * Math.pow(_num(I.levelCost, 1), Math.max(0, lvl - 1)) * own);
        return { gold, materials: { ...(def.materials || {}) } };
    },

    /**
     * What the value added per run is at today's stock here (the works'
     * margin), and what one run takes and makes: { perRun, outValue, inValue }.
     */
    runMargin(s, recipeId) {
        const ins = SettlementMarket.recipeGoods(recipeId, 'in');
        const outs = SettlementMarket.recipeGoods(recipeId, 'out');
        const worth = (id, per) => {
            const g = MerchantPrince._good(id);
            return per * (g ? g.basePrice : 0) * SettlementMarket.scarcity(s, id);
        };
        let outValue = 0, inValue = 0;
        for (const [id, per] of Object.entries(outs)) outValue += worth(id, per);
        for (const [id, per] of Object.entries(ins)) inValue += worth(id, per);
        return { perRun: outValue - inValue, outValue, inValue, ins, outs };
    },

    /**
     * Can the player fund (or extend) works here? → { ok, reason, recipe,
     * def, lvl (the next level), gold, materials, owned, share, tithe, runs }.
     */
    investQuote(player, world, tile, recipeId) {
        const st = MerchantPrince.state(player);
        const I = MerchantPrince.config().industry;
        const s = tile && tile.settlement;
        const def = MerchantPrince.kind(recipeId);
        const out = { ok: false, reason: '', recipe: recipeId, def };
        if (!s) return { ...out, reason: 'There is no town here.' };
        if (!def) return { ...out, reason: 'No such trade.' };
        if (!SettlementMarket.hasTrade(s, recipeId)) return { ...out, reason: `${s.name} is too small for a ${def.name.toLowerCase()}.` };
        const w = SettlementMarket.works(s, recipeId);
        const inv = MerchantPrince.investmentAt(player, tile.q, tile.r, recipeId);
        if (w && w.owner !== 'player') return { ...out, reason: `The ${def.name.toLowerCase()} here belongs to ${w.owner === 'crown' ? 'the crown' : 'the town'} now.` };
        const lvl = (w ? _num(w.lvl) : 0) + 1;
        if (lvl > _num(def.maxLevel, 3)) return { ...out, reason: `The ${def.name.toLowerCase()} is as large as the town can work.` };
        if (!inv && st.investments.length >= _num(I.maxInvestments, 8)) return { ...out, reason: `You can oversee at most ${I.maxInvestments} works.` };
        const owned = MerchantPrince.holds(player, world, tile.q, tile.r);
        if (!owned && MerchantPrince.hostile(player, world, s)) return { ...out, reason: 'The crown will not let an enemy build in its town.' };
        if (!owned && s.kingdom && MerchantPrince.reputation(player, s) < _num(I.minReputation, -10)) {
            return { ...out, reason: `The guilds of ${s.name} will not deal with you (reputation too low).` };
        }
        const cost = MerchantPrince.levelCost(player, world, s, recipeId, lvl);
        const missing = Object.entries(cost.materials).filter(([id, n]) => _num(player.inventory && player.inventory[id]) < n);
        const res = {
            ...out, lvl, gold: cost.gold, materials: cost.materials, owned,
            share: MerchantPrince.shareRate(player, world, s), tithe: MerchantPrince.titheRate(player, world, s),
            runs: _num(def.runsPerLevel), townRuns: SettlementMarket.tradeCapacity(s, recipeId),
            margin: MerchantPrince.runMargin(s, recipeId),
        };
        if (_num(player.gold) < cost.gold) return { ...res, reason: `You need ${cost.gold} gold.` };
        if (missing.length) return { ...res, reason: `You need ${missing.map(([id, n]) => `${n} ${MerchantPrince.goodName(id)}`).join(', ')} in your packs.` };
        return { ...res, ok: true };
    },

    /** Fund the next level of works here (the player stands in the town). */
    invest(player, world, tile, recipeId) {
        if (!MerchantPrince._here(player, tile)) return { success: false, reason: 'You must be in the town to fund works there.' };
        const q = MerchantPrince.investQuote(player, world, tile, recipeId);
        if (!q.ok) return { success: false, reason: q.reason };
        const st = MerchantPrince.state(player);
        const s = tile.settlement;
        player.gold -= q.gold;
        for (const [id, n] of Object.entries(q.materials)) {
            player.inventory[id] -= n;
            if (player.inventory[id] <= 0) delete player.inventory[id];
        }
        const w = SettlementMarket.works(s, recipeId);
        SettlementMarket.setWorks(s, recipeId, {
            lvl: q.lvl, cap: _round2((w ? _num(w.cap) : 0) + q.runs), cond: w ? w.cond : 1, owner: 'player',
        });
        let inv = MerchantPrince.investmentAt(player, tile.q, tile.r, recipeId);
        if (!inv) {
            inv = { id: st.nextId++, q: tile.q, r: tile.r, town: s.name, recipe: recipeId, since: _day(world), invested: 0, earned: 0, tithe: 0, lowRep: 0, paidDay: null, lastPay: 0 };
            st.investments.push(inv);
        }
        inv.invested += q.gold;
        st.stats.invested += q.gold;
        MerchantPrince._log(st, world, `Funded the ${q.def.name.toLowerCase()} of ${s.name} (level ${q.lvl}) for ${q.gold}g.`);
        return { success: true, spent: q.gold, lvl: q.lvl, investment: inv };
    },

    /** Gold to put the works back in full repair. */
    repairCost(player, world, inv) {
        const s = MerchantPrince._settlement(world, inv.q, inv.r);
        const w = s && SettlementMarket.works(s, inv.recipe);
        const def = MerchantPrince.kind(inv.recipe);
        if (!w || !def) return 0;
        const I = MerchantPrince.config().industry;
        let base = 0;
        for (let l = 1; l <= _num(w.lvl); l++) base += MerchantPrince.levelCost(player, world, s, inv.recipe, l).gold;
        return Math.ceil(base * (1 - _clamp(_num(w.cond, 1), 0, 1)) * _num(I.damage.repairCost, 0.5));
    },

    repair(player, world, invId) {
        const st = MerchantPrince.state(player);
        const inv = st.investments.find(i => i.id === invId);
        if (!inv) return { success: false, reason: 'No such works.' };
        const s = MerchantPrince._settlement(world, inv.q, inv.r);
        const w = s && SettlementMarket.works(s, inv.recipe);
        if (!w) return { success: false, reason: 'The works are gone.' };
        const cost = MerchantPrince.repairCost(player, world, inv);
        if (!(cost > 0)) return { success: false, reason: 'The works are in good repair.' };
        if (_num(player.gold) < cost) return { success: false, reason: `Repairs cost ${cost} gold.` };
        player.gold -= cost;
        w.cond = 1;
        inv.invested += cost;
        st.stats.repairs += cost;
        MerchantPrince._log(st, world, `Repaired the works at ${inv.town} for ${cost}g.`);
        return { success: true, spent: cost };
    },

    /** Sell the stake back to the town's guild (salvage × what was put in × repair). */
    sellStake(player, world, invId) {
        const st = MerchantPrince.state(player);
        const inv = st.investments.find(i => i.id === invId);
        if (!inv) return { success: false, reason: 'No such works.' };
        const I = MerchantPrince.config().industry;
        const s = MerchantPrince._settlement(world, inv.q, inv.r);
        const w = s && SettlementMarket.works(s, inv.recipe);
        const gold = Math.floor(_num(inv.invested) * _num(I.damage.salvage, 0.4) * (w ? _clamp(_num(w.cond, 1), 0, 1) : 0));
        if (w) w.owner = 'town';
        st.investments = st.investments.filter(i => i !== inv);
        player.gold += gold;
        st.stats.salvage += gold;
        MerchantPrince._log(st, world, `Sold your stake in the works at ${inv.town} to the guild for ${gold}g.`);
        return { success: true, gold };
    },

    /** The player's works as they stand: [{ inv, settlement, works, def, ... }]. */
    investments(player, world) {
        const out = [];
        for (const inv of MerchantPrince.state(player).investments) {
            const s = MerchantPrince._settlement(world, inv.q, inv.r);
            const w = s && SettlementMarket.works(s, inv.recipe);
            out.push({
                inv, settlement: s, works: w, def: MerchantPrince.kind(inv.recipe),
                tithe: s ? MerchantPrince.titheRate(player, world, s) : 0, share: s ? MerchantPrince.shareRate(player, world, s) : 0,
                repairCost: MerchantPrince.repairCost(player, world, inv),
            });
        }
        return out;
    },

    /** Lose a works to the crown or the town. */
    _seize(player, world, st, inv, by, why, out) {
        const s = MerchantPrince._settlement(world, inv.q, inv.r);
        const w = s && SettlementMarket.works(s, inv.recipe);
        if (w) w.owner = by;
        st.investments = st.investments.filter(i => i !== inv);
        const def = MerchantPrince.kind(inv.recipe);
        const what = def ? def.name.toLowerCase() : 'works';
        if (by === 'crown') st.stats.seized++;
        else st.stats.expropriated++;
        const text = by === 'crown'
            ? `The crown has seized your ${what} in ${inv.town}: ${why}.`
            : `The guilds of ${inv.town} have expropriated your ${what}: ${why}.`;
        MerchantPrince._log(st, world, text);
        MerchantPrince.record(player, world, { key: `seized:${inv.id}`, kind: by === 'crown' ? 'works_seized' : 'works_expropriated', place: inv.town, q: inv.q, r: inv.r, kingdomId: s ? s.kingdom : null, own: true });
        out.notices.push({ icon: '🏚️', title: by === 'crown' ? 'Works Seized' : 'Works Expropriated', text, type: 'error' });
    },

    _industryDay(player, world, st, out) {
        const I = MerchantPrince.config().industry;
        const day = _day(world);
        const besieged = MarketDynamics._besieged(player);
        for (const inv of st.investments.slice()) {
            const s = MerchantPrince._settlement(world, inv.q, inv.r);
            const w = s && SettlementMarket.works(s, inv.recipe);
            if (!s || s.name !== inv.town || !w || w.owner !== 'player') {
                st.investments = st.investments.filter(i => i !== inv);
                MerchantPrince._log(st, world, `Your works at ${inv.town} are lost.`);
                out.notices.push({ icon: '🏚️', title: 'Works Lost', text: `Your works at ${inv.town} are no longer yours.`, type: 'error' });
                continue;
            }
            const owned = MerchantPrince.holds(player, world, inv.q, inv.r);
            if (!owned) {
                // An enemy crown takes what it can reach
                if (MerchantPrince.hostile(player, world, s)) {
                    MerchantPrince._seize(player, world, st, inv, 'crown', 'its realm is at war with you', out);
                    continue;
                }
                // A crown in crisis looks for money anywhere (weekly)
                if (day % 7 === 0 && !MerchantPrince.inOwnRealm(player, world, s) && MerchantPrince.crownInCrisis(world, s)
                    && _roll(`seize:${inv.id}:${day}`) < _num(I.seizure.crisisChance)) {
                    MerchantPrince._seize(player, world, st, inv, 'crown', 'its treasury is empty and the king needs money', out);
                    continue;
                }
                // A town that has turned on the player takes the works back
                if (s.kingdom && MerchantPrince.reputation(player, s) < _num(I.seizure.expropriateBelow, -30)) {
                    inv.lowRep = _num(inv.lowRep) + 1;
                    if (inv.lowRep >= _num(I.seizure.graceDays, 10)) {
                        MerchantPrince._seize(player, world, st, inv, 'town', 'your name is hated there', out);
                        continue;
                    }
                } else inv.lowRep = 0;
            }
            // A siege idles the works (SettlementMarket) and wears them
            if (besieged.has(`${inv.q},${inv.r}`)) w.cond = _round2(Math.max(0, _num(w.cond, 1) - _num(I.damage.siegeWear)));
            // Market day: the investor's share of the value the works added,
            // less the wages of the hands they hired at the town's craft wage
            // (world/townLabour.js; some are kept on even when the works idle)
            if (w.day === day && inv.paidDay !== day) {
                inv.paidDay = day;
                const gross = Math.max(0, _num(w.va)) * MerchantPrince.shareRate(player, world, s);
                const tithe = gross * MerchantPrince.titheRate(player, world, s);
                const wages = TownLabour.worksWageBill(s, inv.recipe, w, SettlementMarket.tickDays());
                const net = Math.floor(gross - tithe - wages);
                inv.lastPay = net;
                inv.lastWages = Math.round(wages * 100) / 100;
                st.stats.wages = _num(st.stats.wages) + Math.round(wages);
                if (gross > 0) {
                    inv.tithe = _num(inv.tithe) + Math.round(tithe);
                    st.stats.tithe += Math.round(tithe);
                }
                if (net > 0) {
                    player.gold += net;
                    inv.earned += net;
                    st.stats.earned += net;
                    out.income += net;
                } else if (net < 0) {
                    // The works earned less than their wages: the hands are paid from the purse
                    const owed = Math.min(-net, Math.max(0, Math.floor(_num(player.gold))));
                    if (owed > 0) {
                        player.gold -= owed;
                        inv.earned -= owed;
                        st.stats.earned -= owed;
                        out.wages += owed;
                    }
                }
            }
        }
    },

    // ── Warehouses ──────────────────────────────────────────

    warehouseAt(player, q, r) {
        return MerchantPrince.state(player).warehouses.find(w => w.q === q && w.r === r) || null;
    },

    warehouse(player, id) {
        return MerchantPrince.state(player).warehouses.find(w => w.id === id) || null;
    },

    sizes() {
        return MerchantPrince.config().warehouse.sizes || {};
    },

    capacity(w) {
        const sz = MerchantPrince.sizes()[w && w.size];
        return sz ? _num(sz.units) : 0;
    },

    used(w) {
        let n = 0;
        for (const v of Object.values((w && w.goods) || {})) n += _num(v);
        return n;
    },

    room(w) {
        return Math.max(0, Math.floor(MerchantPrince.capacity(w) - MerchantPrince.used(w) + 1e-9));
    },

    /** Rent a store-room here (or move up to a larger one). */
    rentWarehouse(player, world, tile, sizeId) {
        const st = MerchantPrince.state(player);
        const W = MerchantPrince.config().warehouse;
        const sz = MerchantPrince.sizes()[sizeId];
        const s = tile && tile.settlement;
        if (!s) return { success: false, reason: 'There is no town here.' };
        if (!MerchantPrince._here(player, tile)) return { success: false, reason: 'You must be in the town to rent there.' };
        if (!sz) return { success: false, reason: 'No such store-room.' };
        const have = MerchantPrince.warehouseAt(player, tile.q, tile.r);
        if (have && have.size === sizeId) return { success: false, reason: 'You already rent one here.' };
        if (have && MerchantPrince.used(have) > _num(sz.units)) return { success: false, reason: 'Your goods would not fit.' };
        if (!have && st.warehouses.length >= _num(W.maxLeases, 5)) return { success: false, reason: `You can keep at most ${W.maxLeases} store-rooms.` };
        const fee = _num(sz.keyFee);
        if (_num(player.gold) < fee) return { success: false, reason: `The key fee is ${fee} gold.` };
        player.gold -= fee;
        st.stats.rent += fee;
        if (have) {
            have.size = sizeId;
        } else {
            st.warehouses.push({ id: st.nextId++, q: tile.q, r: tile.r, town: s.name, size: sizeId, goods: {}, since: _day(world), nextRent: _day(world) + 7, unpaid: 0, arrears: 0 });
        }
        MerchantPrince._log(st, world, `Took a ${sz.name.toLowerCase()} in ${s.name} (${fee}g key fee, ${sz.rent}g a week).`);
        return { success: true, spent: fee };
    },

    /** Give up an empty lease. */
    closeWarehouse(player, world, id) {
        const st = MerchantPrince.state(player);
        const w = MerchantPrince.warehouse(player, id);
        if (!w) return { success: false, reason: 'No such store-room.' };
        if (MerchantPrince.used(w) >= 1) return { success: false, reason: 'Empty it first.' };
        if (_num(w.arrears) > 0) {
            if (_num(player.gold) < w.arrears) return { success: false, reason: `Pay the ${w.arrears}g you owe first.` };
            player.gold -= w.arrears;
            st.stats.rent += w.arrears;
        }
        st.warehouses = st.warehouses.filter(x => x !== w);
        MerchantPrince._log(st, world, `Gave up the store-room in ${w.town}.`);
        return { success: true };
    },

    _wh(player, world, id, tile) {
        const w = MerchantPrince.warehouse(player, id);
        if (!w) return { error: 'No such store-room.' };
        if (!MerchantPrince._here(player, { q: w.q, r: w.r })) return { error: `You must be in ${w.town}.` };
        const s = MerchantPrince._settlement(world, w.q, w.r);
        if (!s) return { error: 'The town is gone.' };
        return { w, s, tile: tile || world.getTile(w.q, w.r) };
    },

    /** Move goods from the packs into the store-room. */
    deposit(player, world, id, goodId, qty) {
        const x = MerchantPrince._wh(player, world, id);
        if (x.error) return { success: false, reason: x.error };
        const n = Math.min(Math.floor(_num(qty)), Math.floor(_num(player.inventory && player.inventory[goodId])), MerchantPrince.room(x.w));
        if (!MerchantPrince._good(goodId)) return { success: false, reason: 'That cannot be stored here.' };
        if (!(n > 0)) return { success: false, reason: MerchantPrince.room(x.w) <= 0 ? 'The store-room is full.' : 'You have none to store.' };
        player.inventory[goodId] -= n;
        if (player.inventory[goodId] <= 0) delete player.inventory[goodId];
        x.w.goods[goodId] = _round2(_num(x.w.goods[goodId]) + n);
        return { success: true, qty: n };
    },

    /** Take goods out into the packs (a new kind needs a free slot). */
    withdraw(player, world, id, goodId, qty) {
        const x = MerchantPrince._wh(player, world, id);
        if (x.error) return { success: false, reason: x.error };
        const n = Math.min(Math.floor(_num(qty)), Math.floor(_num(x.w.goods[goodId]) + 1e-9));
        if (!(n > 0)) return { success: false, reason: 'There is none stored.' };
        const r = PlayerInventory.addItem(player, goodId, n);
        if (!r.success) return { success: false, reason: r.reason };
        MerchantPrince._take(x.w, goodId, n);
        return { success: true, qty: n };
    },

    _take(w, goodId, n) {
        const left = _round2(_num(w.goods[goodId]) - n);
        if (left < 0.01) delete w.goods[goodId];
        else w.goods[goodId] = left;
    },

    /** The market entry the town sells a good at (Trading.getAvailableGoods), or null. */
    _entry(world, tile, goodId) {
        return Trading.getAvailableGoods(tile.settlement, tile, world).find(g => g.id === goodId) || null;
    },

    /** Buy straight from the stalls into the store-room. */
    buyInto(player, world, id, goodId, qty) {
        const x = MerchantPrince._wh(player, world, id);
        if (x.error) return { success: false, reason: x.error };
        const e = MerchantPrince._entry(world, x.tile, goodId);
        if (!e) return { success: false, reason: 'The market here does not sell that.' };
        const blocked = Trading.monopolyBlock(x.s, goodId);
        if (blocked) return { success: false, reason: blocked };
        const n = Math.min(Math.floor(_num(qty)), e.quantity, MerchantPrince.room(x.w), Trading.affordable(player, e, x.s));
        if (!(n > 0)) return { success: false, reason: MerchantPrince.room(x.w) <= 0 ? 'The store-room is full.' : 'You cannot afford any, or none is for sale.' };
        const cost = Trading.buyCost(player, e, n, x.s);
        player.gold -= cost;
        const mono = x.s.monopolies && x.s.monopolies[goodId];
        if (mono && mono.holder === 'crown' && mono.markup > 0) mono.revenue = _num(mono.revenue) + cost * mono.markup / (1 + mono.markup);
        SettlementMarket.take(x.s, goodId, n);
        x.w.goods[goodId] = _round2(_num(x.w.goods[goodId]) + n);
        return { success: true, qty: n, spent: cost };
    },

    /** What selling `qty` from the store-room here fetches (per unit), or 0 when it can't be sold. */
    saleQuote(player, world, w, goodId, qty) {
        const s = MerchantPrince._settlement(world, w.q, w.r);
        const g = MerchantPrince._good(goodId);
        if (!s || !g) return 0;
        const n = Math.max(1, Math.floor(_num(qty)));
        const legal = Underworld.legalSaleCheck(player, goodId, n, s, world);
        if (!legal.ok) return 0;
        return Trading.saleUnitPrice(player, g, s, world, legal.priceMult, n);
    },

    /** Sell from the store-room into the town's market, at its price today. */
    sellFrom(player, world, id, goodId, qty) {
        const x = MerchantPrince._wh(player, world, id);
        if (x.error) return { success: false, reason: x.error };
        const g = MerchantPrince._good(goodId);
        const n = Math.min(Math.floor(_num(qty)), Math.floor(_num(x.w.goods[goodId]) + 1e-9));
        if (!g || !(n > 0)) return { success: false, reason: 'There is none stored.' };
        const blocked = Trading.monopolyBlock(x.s, goodId);
        if (blocked) return { success: false, reason: blocked };
        const legal = Underworld.legalSaleCheck(player, goodId, n, x.s, world);
        if (!legal.ok) return { success: false, reason: legal.reason };
        const earned = Math.floor(Trading.saleUnitPrice(player, g, x.s, world, legal.priceMult, n) * n);
        MerchantPrince._take(x.w, goodId, n);
        player.gold += earned;
        SettlementMarket.add(x.s, goodId, n);
        return { success: true, qty: n, earned };
    },

    /** This week's chance of a theft from the store-room. */
    theftChance(player, world, w) {
        const T = MerchantPrince.config().warehouse.theft;
        const s = MerchantPrince._settlement(world, w.q, w.r);
        if (!s) return 0;
        const k = MerchantPrince._kingdom(world, s);
        let p = _num(T.base) + (Underworld.hasGuildPresence(s) ? _num(T.guildTown) : 0)
            + Underworld.getHeat(player, s.kingdom) * _num(T.perHeat)
            - Underworld.guardStrength(s, k) * _num(T.perGuard);
        const W = (world && world.width) || 0;
        const near = (q, r, rad) => Math.abs(r - w.r) <= rad && Hex.wrappingDistance(q, r, w.q, w.r, W) <= rad;
        if (OutlawLairs.active(player).some(l => Number.isFinite(l.q) && near(l.q, l.r, _num(T.lairRadius, 4)))) p += _num(T.lair);
        if ((world.units || []).some(u => u && !u.destroyed && u.type === 'raider' && near(u.q, u.r, _num(T.raiderRadius, 2)))) p += _num(T.raider);
        // A town of idle hands breeds thieves (world/townLabour.js)
        p += TownLabour.theftBonus(s);
        p = Math.max(_num(T.min), p);
        const g = player.underworld && player.underworld.guild;
        if (g && g.member && _num(g.rank) >= _num(T.guildFriendRank, 2)) p *= _num(T.guildFriendMult, 1);
        if (MerchantPrince.holds(player, world, w.q, w.r)) p *= _num(T.ownedMult, 1);
        return _clamp(p, 0, 0.9);
    },

    /** Daily loss of a good in store (the market's spoil rate × spoilMult). */
    spoilRate(goodId) {
        const g = SettlementMarket.good(goodId);
        return g ? g.spoil * _num(MerchantPrince.config().warehouse.spoilMult, 0.5) : 0;
    },

    _warehouseDay(player, world, st, out) {
        const W = MerchantPrince.config().warehouse;
        const day = _day(world);
        for (const w of st.warehouses.slice()) {
            const s = MerchantPrince._settlement(world, w.q, w.r);
            if (!s || s.name !== w.town) {
                st.warehouses = st.warehouses.filter(x => x !== w);
                out.notices.push({ icon: '📦', title: 'Store-room Lost', text: `Your store-room in ${w.town} is gone, and everything in it.`, type: 'error' });
                continue;
            }
            // Spoilage
            for (const [id, qty] of Object.entries(w.goods)) {
                const rate = MerchantPrince.spoilRate(id);
                if (!(rate > 0)) continue;
                const lost = qty * rate;
                st.stats.spoiled += lost * _num((MerchantPrince._good(id) || {}).basePrice);
                MerchantPrince._take(w, id, lost);
            }
            // Rent, weekly
            if (day >= _num(w.nextRent)) {
                w.nextRent = day + 7;
                const rent = _num((MerchantPrince.sizes()[w.size] || {}).rent);
                if (_num(player.gold) >= rent + _num(w.arrears)) {
                    player.gold -= rent + _num(w.arrears);
                    st.stats.rent += rent + _num(w.arrears);
                    out.rent += rent + _num(w.arrears);
                    w.arrears = 0;
                    w.unpaid = 0;
                } else {
                    w.arrears = _num(w.arrears) + rent;
                    w.unpaid = _num(w.unpaid) + 1;
                    if (w.unpaid >= _num(W.unpaidWeeks, 2)) {
                        // The landlord sells the stock off and ends the lease
                        for (const [id, qty] of Object.entries(w.goods)) {
                            const n = Math.floor(qty);
                            if (n > 0) SettlementMarket.add(s, id, n);
                            st.stats.forfeited += n * _num((MerchantPrince._good(id) || {}).basePrice);
                        }
                        st.warehouses = st.warehouses.filter(x => x !== w);
                        const text = `Your landlord in ${w.town} has sold off your stock for the unpaid rent and let the store-room to another.`;
                        MerchantPrince._log(st, world, text);
                        out.notices.push({ icon: '📦', title: 'Lease Forfeit', text, type: 'error' });
                        continue;
                    }
                    out.notices.push({ icon: '📦', title: 'Rent Unpaid', text: `You owe ${w.arrears}g rent for the store-room in ${w.town}.`, type: 'warning' });
                }
            }
            // Thieves, weekly (on the lease's own day)
            if ((day - _num(w.since)) % 7 === 3 && MerchantPrince.used(w) >= 1) {
                const p = MerchantPrince.theftChance(player, world, w);
                if (_roll(`theft:${w.id}:${day}`) < p) {
                    const T = W.theft;
                    const share = _num(T.loss[0], 0.15) + (_num(T.loss[1], 0.4) - _num(T.loss[0], 0.15)) * _roll(`loss:${w.id}:${day}`);
                    const lost = [];
                    let value = 0;
                    for (const [id, qty] of Object.entries(w.goods)) {
                        const n = Math.floor(qty * share);
                        if (n <= 0) continue;
                        MerchantPrince._take(w, id, n);
                        value += n * _num((MerchantPrince._good(id) || {}).basePrice);
                        lost.push(`${n} ${MerchantPrince.goodName(id)}`);
                    }
                    if (lost.length) {
                        st.stats.stolen += value;
                        const text = `Thieves broke into your store-room in ${w.town} and carried off ${lost.join(', ')}.`;
                        MerchantPrince._log(st, world, text);
                        out.notices.push({ icon: '🗝️', title: 'Store-room Robbed', text, type: 'error' });
                    }
                }
            }
        }
    },

    // ── Forward contracts ───────────────────────────────────

    /**
     * The town's offer for `qty` units of a good delivered within `days`:
     * { ok, reason, unitPrice, total, penalty, dueDay, maxQty }.
     */
    forwardQuote(player, world, tile, goodId, qty, days) {
        const F = MerchantPrince.config().forwards;
        const s = tile && tile.settlement;
        const g = MerchantPrince._good(goodId);
        if (!s || !g) return { ok: false, reason: 'No such trade here.' };
        if (!SettlementMarket.uses(s, goodId)) return { ok: false, reason: `${s.name} has no standing need of ${g.name}.` };
        const k = MerchantPrince._kingdom(world, s);
        if (k && Underworld.contrabandStatus(k, goodId) === 'illegal') return { ok: false, reason: 'That is contraband here.' };
        const d = Math.round(_clamp(_num(days, F.minDays), F.minDays, F.maxDays));
        const maxQty = Math.floor(SettlementMarket.need(s, goodId) * _num(F.maxNeedDays, 15) + _num(F.minQty, 5));
        const n = Math.floor(_clamp(_num(qty), 1, maxQty));
        const premium = Math.min(_num(F.premiumMax, 0.15), _num(F.premiumBase) + _num(F.premiumPerDay) * d);
        const spot = Trading.saleUnitPrice(player, g, s, world, 1, n);
        const cap = Trading.saleUnitCap(player, goodId, s, world, tile, n);
        // (to the copper: a cheap good's premium would vanish in whole gold)
        const unitPrice = Math.max(0.01, _round2(Math.floor(Math.min(spot * (1 + premium), cap) * 100) / 100));
        const total = Math.floor(unitPrice * n);
        return {
            ok: n > 0 && unitPrice > 0, reason: '', good: goodId, qty: n, days: d, maxQty, spot: Math.floor(spot), premium,
            unitPrice, total, penalty: Math.ceil(total * _num(F.penaltyShare, 0.25)), dueDay: _day(world) + d,
        };
    },

    /** Sign a forward contract with the town the player stands in. */
    signForward(player, world, tile, goodId, qty, days) {
        const st = MerchantPrince.state(player);
        const F = MerchantPrince.config().forwards;
        if (!MerchantPrince._here(player, tile)) return { success: false, reason: 'You must be in the town to sign with it.' };
        if (st.forwards.length >= _num(F.maxOpen, 3)) return { success: false, reason: `You can hold at most ${F.maxOpen} forward contracts.` };
        const q = MerchantPrince.forwardQuote(player, world, tile, goodId, qty, days);
        if (!q.ok) return { success: false, reason: q.reason || 'No offer.' };
        const s = tile.settlement;
        const f = {
            id: st.nextId++, q: tile.q, r: tile.r, town: s.name, kingdomId: s.kingdom || null, good: goodId, qty: q.qty,
            unitPrice: q.unitPrice, signed: _day(world), dueDay: q.dueDay, delivered: 0, paid: 0,
        };
        st.forwards.push(f);
        MerchantPrince._log(st, world, `Promised ${s.name} ${q.qty} ${MerchantPrince.goodName(goodId)} by day ${q.dueDay} at ${q.unitPrice}g each.`);
        return { success: true, contract: f };
    },

    /** Units the player could deliver to a contract right now, by source: { inventory, warehouse }. */
    deliverable(player, world, f) {
        if (!MerchantPrince._here(player, { q: f.q, r: f.r })) return { inventory: 0, warehouse: 0 };
        const w = MerchantPrince.warehouseAt(player, f.q, f.r);
        return {
            inventory: Math.floor(_num(player.inventory && player.inventory[f.good])),
            warehouse: w ? Math.floor(_num(w.goods[f.good]) + 1e-9) : 0,
        };
    },

    /** Deliver (part of) a contract from the packs or the store-room in the town. */
    deliverForward(player, world, id, qty, from = 'inventory') {
        const st = MerchantPrince.state(player);
        const F = MerchantPrince.config().forwards;
        const f = st.forwards.find(x => x.id === id);
        if (!f) return { success: false, reason: 'No such contract.' };
        const s = MerchantPrince._settlement(world, f.q, f.r);
        if (!s || !MerchantPrince._here(player, { q: f.q, r: f.r })) return { success: false, reason: `You must be in ${f.town}.` };
        const can = MerchantPrince.deliverable(player, world, f);
        const left = f.qty - f.delivered;
        const n = Math.min(Math.floor(_num(qty, left)), left, from === 'warehouse' ? can.warehouse : can.inventory);
        if (!(n > 0)) return { success: false, reason: 'You have none to deliver.' };
        if (from === 'warehouse') MerchantPrince._take(MerchantPrince.warehouseAt(player, f.q, f.r), f.good, n);
        else {
            player.inventory[f.good] -= n;
            if (player.inventory[f.good] <= 0) delete player.inventory[f.good];
        }
        const pay = Math.floor(n * f.unitPrice);
        player.gold += pay;
        f.delivered += n;
        f.paid += pay;
        st.stats.forwardIncome += pay;
        SettlementMarket.add(s, f.good, n);
        let done = false;
        if (f.delivered >= f.qty) {
            done = true;
            st.forwards = st.forwards.filter(x => x !== f);
            st.stats.forwardsDone++;
            MerchantPrince._addReputation(player, s, _num(F.reputationDone));
            MerchantPrince._log(st, world, `Delivered the last of ${f.qty} ${MerchantPrince.goodName(f.good)} to ${f.town}.`);
        }
        return { success: true, qty: n, earned: pay, done };
    },

    _forwardDay(player, world, st, out) {
        const F = MerchantPrince.config().forwards;
        const day = _day(world);
        for (const f of st.forwards.slice()) {
            if (day <= f.dueDay) continue;
            const left = f.qty - f.delivered;
            const penalty = Math.ceil(left * f.unitPrice * _num(F.penaltyShare, 0.25));
            const paid = Math.min(Math.max(0, _num(player.gold)), penalty);
            player.gold -= paid;
            st.stats.penalties += paid;
            st.stats.forwardsFailed++;
            st.forwards = st.forwards.filter(x => x !== f);
            const s = MerchantPrince._settlement(world, f.q, f.r);
            // What the purse could not cover is paid in reputation
            const short = penalty > 0 ? (penalty - paid) / penalty : 0;
            MerchantPrince._addReputation(player, s || { kingdom: f.kingdomId }, -_num(F.reputationFailed) * (1 + short));
            const text = `You failed to deliver ${left} ${MerchantPrince.goodName(f.good)} to ${f.town} by day ${f.dueDay}: ${paid}g forfeit${paid < penalty ? ', and your name suffers for the rest' : ''}.`;
            MerchantPrince._log(st, world, text);
            out.notices.push({ icon: '📜', title: 'Contract Broken', text, type: 'error' });
        }
    },

    // ── The day ─────────────────────────────────────────────

    /**
     * One day: the works' pay (on market day, after MarketDynamics.updatePrices),
     * seizures and expropriation, siege wear; store-room spoilage, rent and
     * thieves; forward contracts falling due. Draws no RNG.
     * → { notices, income, rent }
     */
    processDay(player, world) {
        const out = { notices: [], income: 0, rent: 0, wages: 0 };
        if (!player || !world || !_obj(player.merchantPrince)) return out;
        const st = MerchantPrince.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        MerchantPrince._industryDay(player, world, st, out);
        MerchantPrince._warehouseDay(player, world, st, out);
        MerchantPrince._forwardDay(player, world, st, out);
        return out;
    },

    /** Lifetime totals for the ledger: { invested, earned, ... } plus open positions. */
    summary(player) {
        const st = MerchantPrince.state(player);
        return { ...st.stats, works: st.investments.length, warehouses: st.warehouses.length, forwards: st.forwards.length };
    },

    /** Season-aware hint for a good in store: 'rising' | 'falling' | 'stable' (Seasons price curve). */
    seasonTrend(goodId, world) {
        return Seasons.priceTrend(goodId, Seasons.today(world));
    },
};
