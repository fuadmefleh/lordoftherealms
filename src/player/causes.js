// ============================================
// CAUSES — "Why?": the factors behind a number the player sees
// ============================================
// A read-only explainer. Each function takes the state the game already keeps
// and returns the contributing factors of one displayed number, with signed
// magnitudes and plain-language labels, so the UI can answer "why is grain
// so dear here?" or "why does this lord dislike me?":
//
//   price(world, settlement, good, player)  the market's asking price, factor
//        by factor (Economy.marketAskBase reports its own steps through its
//        `parts` collector, so the numbers are the engine's, not a copy);
//        the drivers behind the stock (harvest, trade bans and duties, lost
//        caravans, strikes, dearth, your own trading); and what *you* pay
//        and are paid after your discounts, guild, duty and difficulty
//   lordOpinion(world, lordOrKingdom, player)  NPCLords.getLordOpinion
//        mirrored part by part (karma, renown, wealth, kin, court rulings,
//        each remembered deed, a coalition's chill) + your trait/underworld
//        standing + your reputation in the realm
//   stability(kingdom, world)  KingdomStability.target's parts, the drift
//   tax(world, player, settlement)  Taxation.collectTaxes's weekly take for
//        one of your towns, factor by factor, and its mood target
//
// Additive explanations: the factors' `delta`s sum exactly to the value.
// Multiplicative ones (prices, taxes) carry each factor's own `mult`, and a
// `delta` in gold that allocates the total change by log-share, so the
// deltas plus the base plus the rounding also sum exactly to the value.
// src/__tests__/causes.test.js holds every decomposition to the engine's
// numbers across seeds. Draws no RNG and writes nothing.

import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Coinage } from '../world/coinage.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Harvests } from '../world/harvests.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomStability } from '../world/kingdomState.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Guilds } from '../systems/guilds.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Technology } from '../systems/technology.js';
import { Traits } from '../systems/traits.js';
import { Underworld } from '../systems/underworld.js';
import { Housing } from '../systems/housing.js';
import { Titles } from '../systems/titles.js';
import { Difficulty } from '../core/difficulty.js';
import { Utils } from '../core/utils.js';
import { Trading } from './playerEconomy.js';
import { PlayerEffects } from './playerEffects.js';
import { Crafting } from './crafting.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r1 = (v) => Math.round(v * 10) / 10;
const _r2 = (v) => Math.round(v * 100) / 100;
const _pct = (m) => Math.round((m - 1) * 100);
const _signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
const _goodName = (id) => {
    const g = Economy._goods()[String(id).toUpperCase()];
    return (g && g.name) || String(id).replace(/_/g, ' ');
};

const SIZE_LABEL = { village: 'A village market charges more', city: 'A city market charges less', capital: 'The capital\'s market charges less' };
const STOCK_GOODS = ['meat', 'hide', 'wool', 'cheese', 'leather', 'milk'];
const CARAVAN_DAYS = 30;

/**
 * Spread a product's total change (value − base) over its factors by
 * log-share: each factor's gold delta is total × ln(m) / Σ ln(m). The deltas
 * sum to the total. When the factors cancel out (Σ ln m ≈ 0) or one is 0,
 * each takes its step in turn; any floating remainder is returned as `rest`.
 */
function allocate(base, factors, total) {
    let L = 0, ok = true;
    for (const f of factors) {
        if (!(f.mult > 0)) { ok = false; break; }
        L += Math.log(f.mult);
    }
    if (ok && Math.abs(L) > 1e-9) {
        for (const f of factors) f.delta = total * Math.log(f.mult) / L;
        return 0;
    }
    // (a factor of 0, or factors that cancel out: each takes its step in turn)
    let v = base, s = 0;
    for (const f of factors) { f.delta = v * (f.mult - 1); v *= f.mult; s += f.delta; }
    return total - s;
}

function resolveGood(good) {
    if (!good) return null;
    if (typeof good === 'object') return good;
    return Economy._goods()[String(good).toUpperCase()] || null;
}

function kingdomOf(world, settlement) {
    if (!world || !settlement || settlement.kingdom == null || typeof world.getKingdom !== 'function') return null;
    return world.getKingdom(settlement.kingdom) || null;
}

export const Causes = {
    // ── Market prices ─────────────────────────────────────

    /**
     * Why a good costs what it does in this town's market.
     * @returns {{ good, goodName, base, value, price, factors: Array<{id,label,mult,pct,delta,detail?}>,
     *   rounding, rest, drivers: Array<{label,sign,detail?}>, you: object|null, summary }|null}
     *   `price` is the listed price (Trading.getAvailableGoods): base + Σ delta + rest + rounding.
     */
    price(world, settlement, goodIn, player = null, tileIn = null) {
        const good = resolveGood(goodIn);
        if (!good || !settlement || !(good.basePrice > 0)) return null;
        const tile = tileIn || Economy.settlementTile(world, settlement);
        const parts = [];
        const askBase = Economy.marketAskBase(good, settlement, tile, world, parts);
        const scarcity = SettlementMarket.scarcity(settlement, good.id);
        const floor = Guilds.askFloor(settlement, good.id);
        const eff = Math.max(scarcity, floor);
        const exact = askBase * eff;
        // Economy.marketPrice's floor: a good never lists for nothing
        const price = Math.max(1, Math.floor(exact));
        const base = good.basePrice;

        const factors = [];
        for (const p of parts) {
            if (p.mult === 1) continue;
            factors.push({ id: p.id, mult: p.mult, ...Causes._priceLabel(world, settlement, tile, good, p) });
        }
        if (eff !== 1) {
            const info = SettlementMarket.tracks(good.id) && settlement.market ? SettlementMarket.info(settlement, good.id) : null;
            const guild = floor > scarcity ? Guilds.guardOf(settlement, good.id) : null;
            factors.push({
                id: 'scarcity', mult: eff,
                label: guild ? `The ${guild.name} holds a floor under the price` : info ? `Stock: ${info.label.toLowerCase()}` : 'Stock',
                detail: info ? `${Math.floor(info.stock)} in store${info.days != null ? `, ${info.days >= 99 ? '99+' : Math.floor(info.days)} days of the town's need` : ''}${guild ? ` (the stock alone would be ${_signed(_pct(scarcity))}%)` : ''}` : '',
            });
        }
        const rest = allocate(base, factors, exact - base);
        for (const f of factors) f.pct = _pct(f.mult);
        const rounding = price - exact;
        const drivers = Causes._priceDrivers(world, settlement, tile, good, player);
        const you = player ? Causes._yourPrice(world, settlement, tile, good, player, { askBase, price, floor }) : null;
        const out = {
            good: good.id, goodName: good.name || _goodName(good.id), settlement: settlement.name || '', base, value: price, price,
            askBase, scarcity, factors, rounding, rest, drivers, you,
        };
        out.summary = Causes.summary(out);
        return out;
    },

    /** Label and detail for one of marketAskBase's steps. */
    _priceLabel(world, settlement, tile, good, p) {
        switch (p.id) {
            case 'size': return { label: SIZE_LABEL[settlement.type] || `A ${settlement.type || 'local'} market` };
            case 'fair': {
                const f = SettlementMarket.fair(settlement);
                return { label: `${(f && f.name) || 'A fair'} is on: merchants undercut the stalls` };
            }
            case 'cold': return { label: p.mult > 1 ? 'Cold weather: everyone wants it' : 'Mild weather: little call for it' };
            case 'resource': return { label: `Local ${String(p.resource || 'resources').replace(/_/g, ' ')} nearby` };
            case 'season': {
                const season = Seasons.seasonOf(Seasons.today(world));
                return { label: `${season}: ${p.mult > 1 ? 'the lean months' : 'the season\'s plenty'}`, detail: Seasons.priceGroup(good.id) ? `${good.name || good.id} follows the ${Seasons.priceGroup(good.id)} price curve` : '' };
            }
            case 'events': {
                const names = [];
                for (const ev of (world && world.activeEvents) || []) {
                    const e = ev && ev.effects;
                    if (!e) continue;
                    const v = _num(e.prices) + (WorldEvents.FOOD_GOODS.includes(good.id) ? _num(e.foodPrices) : 0);
                    if (v && WorldEvents._eventReaches(ev, tile)) names.push(`${ev.icon || ''} ${ev.name || ev.id} (${_signed(Math.round(v * 100))}%)`.trim());
                }
                return { label: names.length ? names.join(', ') : 'Events in the region' };
            }
            case 'monopoly': {
                const m = settlement.monopolies && settlement.monopolies[good.id];
                return { label: `${(m && m.holderName) || (m && m.holder === 'crown' ? 'The crown' : 'A')}'s monopoly markup` };
            }
            case 'coinage': {
                const k = Coinage.kingdomOf(world, settlement);
                // (the coin in hand: the mint's standard, old coin not yet restruck, clipping — MoneySupply.fineness)
                const fn = Coinage.fineness(world, k);
                const level = Coinage.level(world, k);
                const bits = [];
                if (fn.standard < 1) bits.push(`the mint strikes ${Math.round(fn.standard * 100)}% silver`);
                if (Math.abs(fn.circulating - fn.standard) > 0.005) bits.push(`${Math.round(fn.circulating * 100)}% in hand (${fn.circulating > fn.standard ? 'old coin still passing: more rise to come' : 'the finer new coin mixing in'})`);
                if (fn.clip > 0.01) bits.push(`${Math.round(fn.clip * 100)}% clipped`);
                if (level !== 1) bits.push(`price level ×${_r2(level)}`);
                return { label: `${k ? k.name : 'The realm'}'s money`, detail: bits.join(', ') };
            }
            case 'fashion': return { label: 'The fashion at court', detail: 'goods no market keeps follow the court\'s taste' };
            default: return { label: p.id };
        }
    },

    /** What lies behind the stock: the harvest, trade policy, lost caravans, strikes, dearth, your own trading. */
    _priceDrivers(world, settlement, tile, good, player) {
        const out = [];
        const id = good.id;
        const m = settlement.market;
        const name = good.name || _goodName(id);
        // The harvest (world/harvests.js): grain and the food made from it, the herds
        const food = Seasons.priceGroup(id) === 'food' || WorldEvents.FOOD_GOODS.includes(id);
        if (world && Harvests.townHarvestYear(settlement) != null) {
            const region = Harvests.regionName(world, Harvests.regionOfTown(world, settlement));
            if (STOCK_GOODS.includes(id)) {
                const f = Harvests.stockFactor(settlement);
                if (Math.abs(f - 1) >= 0.03) out.push({ label: `${f < 1 ? 'Thin herds' : 'Fat herds'} in ${region} (${_signed(_pct(f))}%)`, sign: f < 1 ? 1 : -1 });
            } else if (food) {
                const f = Harvests.grainFactor(settlement);
                if (Math.abs(f - 1) >= 0.03) out.push({ label: `${f < 1 ? 'A poor harvest' : 'A bumper harvest'} in ${region} (${_signed(_pct(f))}%)`, sign: f < 1 ? 1 : -1 });
            }
        }
        if (food && SettlementMarket.inDearth(settlement)) out.push({ label: 'Dearth: the town has run short of food for weeks', sign: 1 });
        // Trade roads and policy (systems/tradePolicy.js)
        if (m && m.trade && m.trade.cut > 0) out.push({ label: 'Trade roads disrupted (war, blockade or bandits)', sign: 1 });
        const k = kingdomOf(world, settlement);
        const cat = TradePolicy.categoryOf(id);
        const catDef = TradePolicy.category(cat);
        const catName = catDef ? catDef.label.toLowerCase() : name.toLowerCase();
        if (k) {
            if (TradePolicy.banned(k, cat)) out.push({ label: `${k.name} bans the export of ${catName}: it stays at home`, sign: -1 });
            const imp = TradePolicy.importTariff(k, cat);
            if (imp > 0) out.push({ label: `${k.name} levies ${Math.round(imp * 100)}% import duty on ${catName}`, sign: 1 });
            const p = TradePolicy._peek(k);
            const emb = p && _obj(p.embargo) ? Object.keys(p.embargo).filter(x => p.embargo[x]) : [];
            if (emb.length) {
                const names = emb.map(x => { const kk = world.getKingdom(isNaN(x) ? x : Number(x)) || world.getKingdom(x); return kk ? kk.name : null; }).filter(Boolean);
                if (names.length) out.push({ label: `${k.name} embargoes ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ' and others' : ''}`, sign: 1 });
            }
        }
        const bans = [];
        for (const other of (world && world.kingdoms) || []) {
            if (!other || other === k || other.isAlive === false) continue;
            if (TradePolicy.banned(other, cat)) bans.push(other.name);
        }
        if (bans.length) out.push({ label: `${bans.slice(0, 2).join(' and ')}${bans.length > 2 ? ` and ${bans.length - 2} more` : ''} ban${bans.length === 1 ? 's' : ''} the export of ${catName}`, sign: 1 });
        // Caravans lost on the roads to this town (systems/merchantCaravans.js) — read without creating the record
        const mt = world && _obj(world.merchantTrade);
        if (mt && Array.isArray(mt.history)) {
            const day = _num(world.day);
            const lost = mt.history.filter(h => h && day - _num(h.day) <= CARAVAN_DAYS && (h.to === settlement.name || h.from === settlement.name));
            for (const h of lost.slice(-2)) {
                const into = h.to === settlement.name;
                out.push({ label: `A ${h.carrier || 'caravan'} of ${h.good} ${into ? `bound here from ${h.from}` : `out to ${h.to}`} was ${h.kind === 'seized' ? 'seized' : 'taken'}${h.by ? ` by ${h.by}` : ''} (day ${h.day})`, sign: into ? 1 : -1 });
            }
            if (_obj(mt.fear) && Number.isFinite(settlement.q)) {
                const here = `${settlement.q},${settlement.r}`;
                const scared = Object.entries(mt.fear).some(([key, until]) => Number.isFinite(until) && day < until && key.split('|').includes(here));
                if (scared) out.push({ label: 'Merchants shun a road here after a loss: less trade comes through', sign: 1 });
            }
        }
        // A trade on strike (systems/guilds.js): market.idle[recipeId]
        if (m && _obj(m.idle)) {
            const C = SettlementMarket.config();
            for (const rid in m.idle) {
                if (world && !(m.idle[rid] > _num(world.day))) continue;
                const rc = C.recipeById && C.recipeById[rid];
                const outs = rc ? SettlementMarket.recipeGoods(rid, 'out') : [];
                if (outs.includes(id)) out.push({ label: `The ${String(rid).replace(/_/g, ' ')} trade is on strike`, sign: 1 });
            }
        }
        // A fashion at court raising the town's want of a good its market keeps (world/fashions.js → labour.fz)
        const fz = settlement.labour && _obj(settlement.labour.fz);
        if (fz && SettlementMarket.tracks(id) && Number.isFinite(fz[id]) && fz[id] !== 1) {
            out.push({ label: `The fashion at court ${fz[id] > 1 ? 'raises' : 'cools'} the town's want of ${name.toLowerCase()}`, sign: fz[id] > 1 ? 1 : -1 });
        }
        // Your own trading here this season (systems/reckoning.js keeps the tally)
        const rk = player && _obj(player.reckoning) && _obj(player.reckoning.cur) && _obj(player.reckoning.cur.towns);
        const t = rk && settlement.name ? rk[settlement.name] : null;
        const g = t && _obj(t.goods) ? t.goods[id] : null;
        if (g && (g.bought || g.sold)) {
            const net = _num(g.bought) - _num(g.sold);
            if (net) out.push({ label: `You ${net > 0 ? `bought ${net}` : `sold ${-net}`} more than you ${net > 0 ? 'sold' : 'bought'} here this season`, sign: net > 0 ? 1 : -1 });
        }
        return out;
    },

    /** What the player pays for one unit and is paid for one, after their own terms. */
    _yourPrice(world, settlement, tile, good, player, { askBase, price, floor }) {
        const id = good.id;
        const entry = { id, askBase, price, quantity: 1 };
        const buy = Trading.buyCost(player, entry, 1, settlement);
        const tech = Technology.getEffectTotal(player, 'tradePriceDiscount');
        const bonus = PlayerEffects.tradeBonus(player, settlement);
        const disc = Math.max(0.5, 1 - (tech + bonus));
        const diff = Difficulty.mult(player, 'buyPrice');
        const guildIn = Guilds.inputDiscount(player, settlement, id);
        const buyFactors = [];
        if (disc !== 1) buyFactors.push({ label: 'Your trading standing (perks, companions, agreements, traits, technology)', pct: _pct(disc), detail: Causes._standingDetail(player, settlement, tech) });
        if (diff !== 1) buyFactors.push({ label: 'Difficulty: market prices', pct: _pct(diff) });
        if (guildIn) buyFactors.push({ label: 'Guild rates on its inputs', pct: -Math.round(guildIn * 100) });
        // The sale: as the Market window prices it (ui/actionMenu/trade.js)
        let sell = null;
        const sellFactors = [];
        if (SettlementMarket.tracks(id) || (tile && Economy.marketGoods(settlement, tile).some(x => x.key === String(id).toUpperCase()))) {
            const policy = TradePolicy.saleCheck(player, world, settlement, id, 1);
            const quality = Crafting.saleMult(player, id);
            sell = Math.floor(Trading.saleUnitPrice(player, good, settlement, world) * (policy.ok ? policy.mult : 1) * quality);
            sellFactors.push({ label: 'The stalls pay a share of what it is worth here', pct: Math.round(Trading.sellShare(settlement) * 100) - 100 });
            const bonusAll = Technology.getTradeProfitBonus(player) + bonus + Economy.saleBonus(settlement);
            if (Math.abs(bonusAll) >= 0.005) sellFactors.push({ label: 'Your trading standing and the town\'s trade', pct: Math.round(bonusAll * 100) });
            const gf = Guilds.saleFactor(player, settlement, id);
            if (gf !== 1) {
                const gd = Guilds.guardOf(settlement, id);
                sellFactors.push({ label: gf > 1 ? `The ${gd ? gd.name : 'guild'}'s mark on your goods` : `The ${gd ? gd.name : 'guild'}'s toll on outsiders`, pct: _pct(gf) });
            }
            if (policy.ok && policy.mult !== 1) sellFactors.push({ label: 'Crown duty on goods bought in another realm', pct: _pct(policy.mult) });
            const ds = Difficulty.mult(player, 'sellPrice');
            if (ds !== 1) sellFactors.push({ label: 'Difficulty: sale prices', pct: _pct(ds) });
            if (quality !== 1) sellFactors.push({ label: 'The quality of what you carry', pct: _pct(quality) });
            if (!policy.ok) sellFactors.push({ label: policy.reason || 'You may not sell it here', pct: 0 });
        }
        return { buy, buyFactors, sell, sellFactors, guildFloor: floor };
    },

    /** The pieces of the player's trade standing in a town, as text. */
    _standingDetail(player, settlement, tech) {
        const bits = [];
        if (tech) bits.push(`technology ${_signed(Math.round(tech * 100))}%`);
        const liege = PlayerEffects.liegeTradeModifier(player, settlement && settlement.kingdom);
        if (liege) bits.push(`your liege's ${liege > 0 ? 'allies' : 'enemies'} ${_signed(Math.round(liege * 100))}%`);
        const traits = Traits.effect(player, 'tradeBonus');
        if (traits) bits.push(`traits ${_signed(Math.round(traits * 100))}%`);
        const house = Housing.getLocalTradeBonus(player, settlement);
        if (house) bits.push(`a house here ${_signed(Math.round(house * 100))}%`);
        const kid = settlement && settlement.kingdom;
        if (kid && player.tradeAgreements && player.tradeAgreements[kid]) bits.push('a trade agreement');
        return bits.join(', ');
    },

    // ── A lord's opinion ──────────────────────────────────

    /**
     * Why a lord thinks of the player as he does: NPCLords.getLordOpinion
     * mirrored part by part (factors' deltas sum to `opinion`), then the
     * player's trait/underworld standing (`bonus`) and reputation in the
     * realm (`reputation`); `total` is what the lord's audience weighs.
     */
    lordOpinion(world, lordIn, player) {
        const lord = NPCLords._lordOf(lordIn);
        if (!lord || !player) return null;
        const traits = Array.isArray(lord.traits) ? lord.traits : [];
        const factors = [];
        const day = world && Number.isFinite(world.day) ? world.day : undefined;
        // (the same sum, in the same order, as getLordOpinion)
        let opinion = 0;
        const karmaWeight = traits.reduce((s, t) => s + ((t && t.karmaBonus) || 0), 0) * 10;
        if (karmaWeight) {
            const v = (player.karma || 0) * karmaWeight;
            opinion += v;
            factors.push({ id: 'karma', label: `Your karma (a ${traits.filter(t => t && t.karmaBonus).map(t => t.name || t.id).join('/').toLowerCase()} lord weighs it)`, delta: v });
        }
        if (traits.some(t => t.id === 'ambitious')) {
            const v = Math.floor(player.renown / 10);
            opinion += v;
            factors.push({ id: 'renown', label: 'Your renown (he is ambitious)', delta: v });
        }
        if (traits.some(t => t.id === 'greedy')) {
            const v = Math.floor(player.gold / 1000);
            opinion += v;
            factors.push({ id: 'wealth', label: 'Your wealth (he is greedy)', delta: v });
        }
        if (player.spouse && player.marriageAllianceKingdom && player.marriageAllianceKingdom === lord.kingdomId) {
            const v = NPCLords.MARRIAGE_KIN_OPINION;
            opinion += v;
            factors.push({ id: 'kin', label: 'Kin by marriage', delta: v });
        }
        const court = NPCLords.courtOpinion(lord, player);
        opinion += court;
        if (court) factors.push({ id: 'court', label: 'Your rulings at court (mercy, justice, piety…)', delta: court });
        const mem = NPCLords.memoryOpinion(lord, day);
        opinion += mem;
        if (mem) {
            const deeds = NPCLords.memoryOf(lord, day);
            const shown = deeds.slice(0, 6);
            let sum = 0;
            for (const d of shown) {
                sum += d.weight;
                factors.push({ id: 'deed', label: `${d.icon} ${d.label}${d.note ? ` — ${d.note}` : ''}${d.inherited ? ` (passed down${d.from ? ` from ${d.from}` : ''})` : ''}`, delta: d.weight, day: d.day });
            }
            const rest = mem - sum;
            if (Math.abs(rest) >= 0.05) factors.push({ id: 'memory', label: deeds.length > shown.length ? `${deeds.length - shown.length} lesser memories, and the cap on what he remembers` : 'Memories rounded and capped', delta: rest });
        }
        const chill = NPCLords.coalitionChill(lord, player);
        opinion -= chill;
        if (chill) factors.push({ id: 'coalition', label: 'He is sworn into a league against you', delta: -chill });
        const clamped = Utils.clamp(opinion, -100, 100);
        if (clamped !== opinion) factors.push({ id: 'clamp', label: 'Opinion runs from −100 to +100', delta: clamped - opinion });

        const bonusParts = [];
        const tb = Traits.lordOpinion(player, lord);
        if (tb) bonusParts.push({ id: 'traits', label: 'Your earned traits', delta: tb });
        const ub = Underworld.lordOpinion(player, lord);
        if (ub) bonusParts.push({ id: 'underworld', label: 'Your name in the underworld', delta: ub });
        const bonus = tb + ub;
        const reputation = player.reputation ? _num(player.reputation[lord.kingdomId]) : 0;
        const out = {
            lord: lord.name || 'The lord', kingdomId: lord.kingdomId, opinion: clamped, factors,
            bonus, bonusParts, reputation, total: clamped + bonus + reputation,
        };
        out.summary = `${out.lord}: ${_signed(Math.round(out.total))} — ${[...factors, ...bonusParts].filter(f => f.id !== 'clamp' && f.id !== 'memory')
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3).map(f => `${f.label.replace(/^[^\p{L}]+/u, '')} ${_signed(Math.round(f.delta))}`).join(', ') || 'no strong feelings either way'}`;
        return out;
    },

    // ── A realm's stability ───────────────────────────────

    /**
     * Where a realm's stability is heading and why: the target's parts
     * (KingdomStability.target), with `base` + Σ value + `rest` = target.
     */
    stability(kingdom, world) {
        if (!kingdom) return null;
        const t = KingdomStability.target(kingdom, world);
        const base = KingdomStability.BASE;
        const factors = t.parts.map(p => ({ label: p.label, delta: p.value }));
        const sum = factors.reduce((s, f) => s + f.delta, base);
        const rest = t.value - sum;
        if (Math.abs(rest) >= 0.05) factors.push({ label: 'Small matters, and the 0–100 bounds', delta: _r1(rest) });
        const cur = typeof kingdom.stability === 'number' ? kingdom.stability : base;
        const step = (t.value - cur) * KingdomStability.DRIFT_RATE;
        const out = {
            kingdom: kingdom.name, value: cur, target: t.value, base, factors, rest,
            drift: _r2(step), label: KingdomStability.label(cur), income: KingdomStability.incomeMultiplier(kingdom),
        };
        out.summary = `${kingdom.name} stability ${Math.round(cur)} → ${Math.round(t.value)}: ${factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3).map(f => `${f.label} ${_signed(Math.round(f.delta))}`).join(', ')}`;
        return out;
    },

    // ── A town's taxes and mood ───────────────────────────

    /**
     * Why one of the player's towns pays the weekly tax it does
     * (Taxation.collectTaxes, factor by factor: base + Σ delta + rounding =
     * amount) and where its mood is heading.
     */
    tax(world, player, settlement) {
        if (!player || !settlement) return null;
        const policy = Taxation.TAX_RATES[String(player.taxRate || 'moderate').toUpperCase()];
        if (!policy) return null;
        const tile = world && typeof world.getTile === 'function' && Number.isFinite(settlement.q) ? world.getTile(settlement.q, settlement.r) : null;
        const happiness = Taxation.getHappiness(settlement);
        const taxBase = Math.floor(settlement.population * Taxation.TAX_PER_HEAD);
        const landBonus = 1 + (player.landTaxBonus || 0);
        const office = Taxation.officeTaxMultiplier(player);
        const eventMult = Math.max(0, 1 + WorldEvents.getModifier(world, 'taxIncome', tile));
        const moodMult = 0.75 + happiness / 200;
        const holdingMult = Taxation.holdingFx(settlement, 'taxMult', 1);
        const harvestMult = Harvests.rentFactor(settlement);
        // (the same product, in the same order, as collectTaxes)
        const exact = taxBase * policy.rate * landBonus * office * eventMult * moodMult * holdingMult * harvestMult;
        const amount = Math.floor(exact);
        const title = Titles.getActiveTitle(player);
        const factors = [
            { id: 'land', label: 'Land improvements (technology)', mult: landBonus },
            { id: 'office', label: `Your office${title && title.name ? ` (${title.name})` : ''}`, mult: office },
            { id: 'events', label: 'Events: revolts, crises, gold rushes', mult: eventMult },
            { id: 'mood', label: `The town's mood (${Math.round(happiness)}/100)`, mult: moodMult },
            { id: 'holding', label: 'Its development and governor', mult: holdingMult },
            { id: 'harvest', label: 'The harvest (tithes and rents)', mult: harvestMult },
        ].filter(f => f.mult !== 1);
        // The rate is a share, not a modifier: the base is what the town would pay at 100%
        const rated = taxBase * policy.rate;
        let rest = 0;
        if (rated > 0 && exact > 0) rest = allocate(rated, factors, exact - rated);
        else for (const f of factors) f.delta = 0;
        for (const f of factors) f.pct = _pct(f.mult);
        // Mood: where the weekly collection pulls it (Taxation._applyTaxMood)
        const peoples = Taxation.peoplesMood(settlement);
        const holdingMood = Taxation.holdingFx(settlement, 'happiness');
        const patronage = Taxation.patronageMood(settlement);
        const moodParts = [
            { label: 'Content by nature', delta: 50 },
            { label: `Tax policy: ${policy.name}`, delta: policy.happinessBonus * 1.5 },
            { label: 'The peoples living there', delta: peoples },
            { label: 'Taverns, temples and squares', delta: holdingMood },
            { label: 'Great works and donated art', delta: patronage },
        ].filter(p => p.delta);
        const rawTarget = 50 + policy.happinessBonus * 1.5 + peoples + holdingMood + patronage;
        const target = Math.max(0, Math.min(100, rawTarget));
        if (target !== rawTarget) moodParts.push({ label: 'Mood runs from 0 to 100', delta: target - rawTarget });
        const market = _num(settlement.marketMood);
        const out = {
            town: settlement.name || '', policy: policy.name, base: taxBase, rate: policy.rate, rated, amount, rounding: amount - exact, rest, factors,
            happiness: Math.round(happiness), moodTarget: Math.round(target), moodTargetExact: target, moodParts, marketMood: market,
            unrest: settlement.holding ? _num(settlement.holding.unrest) : null,
        };
        out.summary = `${out.town}: ~${amount}g a week (${taxBase}g base × ${Math.round(policy.rate * 100)}%)${factors.length ? `, ${factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3).map(f => `${f.label.toLowerCase()} ${_signed(f.pct)}%`).join(', ')}` : ''}`;
        return out;
    },

    // ── Text ──────────────────────────────────────────────

    /** One line: "Grain +40%: a poor harvest in the Westmarch (−35%), stock: scarce +31%, …". */
    summary(e) {
        if (!e) return '';
        const pct = e.base > 0 ? Math.round((e.price / e.base - 1) * 100) : 0;
        const bits = e.factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)
            .map(f => `${f.label.charAt(0).toLowerCase()}${f.label.slice(1)} ${_signed(f.pct)}%`);
        const why = e.drivers.filter(d => d.sign > 0 === pct > 0).slice(0, 2).map(d => d.label.charAt(0).toLowerCase() + d.label.slice(1));
        return `${e.goodName} ${_signed(pct)}%${bits.length || why.length ? `: ${[...why, ...bits].join(', ')}` : ' — the going rate'}`;
    },
};
