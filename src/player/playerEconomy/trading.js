// Trading — split from playerEconomy.js; references PlayerEconomy (GOODS etc.).
// Buying and selling go through the settlement's one goods inventory
// (world/settlementMarket.js): a purchase takes real stock and every unit
// costs a little more than the last; a sale adds stock and every unit
// fetches a little less.
import { PlayerEconomy } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Ships } from '../../systems/ships.js';
import { Guilds } from '../../systems/guilds.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { Reckoning } from '../../systems/reckoning.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, PlayerEffects, PlayerInventory, Economy, Seasons, SettlementMarket } from './_imports.js';
import { Crafting } from '../crafting.js';
import { Grades } from '../../core/grades.js';
import { MarketGrades } from '../../world/marketGrades.js';
import { Difficulty } from '../../core/difficulty.js';
import { MarketStalls } from '../../world/marketStalls.js';

export const Trading = {
    /**
     * Get available goods at a settlement: each with its price for the next
     * unit, the stock on hand (quantity), and the market's stock reading
     * (scarcity, label, trend, days of need in store).
     */
    getAvailableGoods(settlement, tile, world = null) {
        const goods = [];
        if (!settlement) return goods;
        SettlementMarket.ensure(settlement);

        // What the market stocks lives in world/economy.js so other outlets can see it
        // Contraband isn't sold openly where the realm has banned it
        const kingdom = world && settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
        for (const { key, qtyMult } of Economy.marketGoods(settlement, tile)) {
            const entry = Trading._marketEntry(PlayerEconomy.GOODS[key], settlement, tile, world, kingdom, qtyMult);
            if (entry) goods.push(entry);
        }

        return goods;
    },

    /**
     * One good as the market offers it: its price for the next unit, the stock
     * on hand (quantity) and the stock reading — or null when it isn't sold here
     * (unknown, or contraband in this realm). Untracked goods (seed) come by
     * the head of population × qtyMult.
     */
    _marketEntry(good, settlement, tile, world, kingdom, qtyMult = 0) {
        if (!good || !settlement) return null;
        if (kingdom && Underworld.contrabandStatus(kingdom, good.id) === 'illegal') return null;
        const tracked = SettlementMarket.tracks(good.id);
        const askBase = Economy.marketAskBase(good, settlement, tile, world);
        const info = SettlementMarket.info(settlement, good.id);
        // A town guild holds a floor under its goods' ask (systems/guilds.js)
        const floor = Guilds.askFloor(settlement, good.id);
        const quantity = tracked ? SettlementMarket.available(settlement, good.id) : Math.floor((settlement.population || 0) * qtyMult);
        return {
            ...good,
            quantity,
            // Made goods come in grades: the stall's lots by grade (world/marketGrades.js)
            lots: Grades.gradeable(good.id) ? MarketGrades.lots(settlement, good.id, quantity, world ? world.day : 0) : null,
            price: Math.max(1, Math.floor(askBase * Math.max(info.scarcity, floor))), // (never free: a glut still asks a coin)
            guildFloor: floor > info.scarcity ? floor : 0,
            askBase,
            stock: info.stock,
            scarcity: info.scarcity,
            stockLabel: info.label,
            stockColor: info.color,
            stockDays: info.days,
            trend: info.trend,
        };
    },

    /**
     * One market stall's wares (world/marketStalls.js): the goods of its trade the
     * town's market has in store, each the market's own entry — the same stock,
     * the same price as at the town market. Nothing the market hasn't got.
     */
    stallGoods(settlement, tile, world, tradeId) {
        if (!settlement || !MarketStalls.trade(tradeId)) return [];
        SettlementMarket.ensure(settlement);
        const kingdom = world && settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
        const mults = new Map(Economy.marketGoods(settlement, tile).map(g => [g.key, g.qtyMult]));
        const out = [];
        for (const id of MarketStalls.wares(settlement, tradeId, tile)) {
            const key = id.toUpperCase();
            const entry = Trading._marketEntry(PlayerEconomy.GOODS[key], settlement, tile, world, kingdom, mults.get(key) || 0);
            if (entry && entry.quantity > 0) out.push(entry);
        }
        return out;
    },

    /**
     * Sell to a stall's keeper: only goods of their trade (MarketStalls.accepts);
     * the sale itself is the town market's (Trading.sellGoods): its price, its
     * purse, its stock.
     */
    sellToStall(player, tradeId, goodId, quantity, settlement = null, world = null, grade = null) {
        const t = MarketStalls.trade(tradeId);
        if (!t) return { success: false, reason: 'No such stall' };
        if (!MarketStalls.accepts(tradeId, goodId)) {
            const good = PlayerEconomy.GOODS[String(goodId).toUpperCase()];
            const what = String((good && good.name) || goodId).toLowerCase();
            return { success: false, reason: `The ${t.name.toLowerCase()} doesn't deal in ${what}.`, notTrade: true };
        }
        return Trading.sellGoods(player, goodId, quantity, settlement, world, grade);
    },

    /**
     * Price of one unit at the market's current stock (Economy.marketPrice).
     * `world` is injected by the caller; null in headless/test contexts,
     * which skips weather-based demand.
     */
    calculatePrice(good, settlement, tile, world = null) {
        return Economy.marketPrice(good, settlement, tile, world);
    },

    /** The player's fractional discount when buying at `settlement`. */
    buyDiscount(player, settlement) {
        // Currency minting trims purchase prices
        // Trade agreements and the Trade Envoy's office shave more off
        return ((typeof Technology !== 'undefined') ? Technology.getEffectTotal(player, 'tradePriceDiscount') : 0)
            + PlayerEffects.tradeBonus(player, settlement);
    },

    /**
     * What `quantity` units of a market entry (Trading.getAvailableGoods)
     * cost the player: each unit at the price the stock it leaves behind
     * commands, after the player's discount. One unit costs the listed price.
     */
    buyCost(player, entry, quantity, settlement) {
        // (a guild's members buy its inputs at guild rates — systems/guilds.js)
        // (the difficulty's market prices — core/difficulty.js; 1 on Normal)
        const disc = Math.max(0.5, 1 - Trading.buyDiscount(player, settlement)) * Difficulty.mult(player, 'buyPrice') * (1 - Guilds.inputDiscount(player, settlement, entry && entry.id));
        const q = Math.max(0, Math.floor(quantity));
        if (!(entry && entry.askBase > 0) || !settlement || !settlement.market || !SettlementMarket.tracks(entry.id)) {
            return Math.ceil(((entry && entry.price) || 0) * q * disc);
        }
        const s0 = SettlementMarket.stock(settlement, entry.id);
        const floor = Guilds.askFloor(settlement, entry.id);
        let sum = 0;
        for (let i = 0; i < q; i++) sum += Math.floor(entry.askBase * Math.max(floor, SettlementMarket.scarcity(settlement, entry.id, s0 - i)));
        return Math.ceil(sum * disc);
    },

    /**
     * What `quantity` units of one grade of a market entry cost: the Common
     * price × the grade's price (core/grades.js).
     */
    buyGradeCost(player, entry, quantity, settlement, grade = 'common') {
        const base = Trading.buyCost(player, entry, quantity, settlement);
        return Grades.get(grade).id === 'common' ? base : Math.ceil(base * Grades.priceMult(grade));
    },

    /** Most units of one grade of a market entry the player can pay for (and the stall holds). */
    affordableGrade(player, entry, settlement, grade = 'common') {
        const g = Grades.get(grade).id;
        if (g === 'common' && !entry.lots) return Trading.affordable(player, entry, settlement);
        const have = entry.lots ? entry.lots[g] : (g === 'common' ? entry.quantity : 0);
        let n = Math.max(0, Math.floor(have || 0));
        const gold = Math.max(0, (player && player.gold) || 0);
        while (n > 0 && Trading.buyGradeCost(player, entry, n, settlement, g) > gold) n--;
        return n;
    },

    /**
     * Most units of a market entry the player can pay for (at most `max`,
     * and the stock on hand): the price climbs with each unit taken.
     */
    affordable(player, entry, settlement, max = Infinity) {
        const gold = Math.max(0, (player && player.gold) || 0);
        let hi = Math.max(0, Math.floor(Math.min(max, (entry && entry.quantity) || 0)));
        if (hi <= 0) return 0;
        if (Trading.buyCost(player, entry, hi, settlement) <= gold) return hi;
        let lo = 0;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (Trading.buyCost(player, entry, mid, settlement) <= gold) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    },

    /**
     * Most a buyer on this tile pays per unit (averaged over `quantity`) for
     * `goodId` the player sells: each unit one less than buying it back
     * would cost — here at the stock the sale leaves, or in a settlement
     * next door (a market's price after the player's discount, or a
     * port's) — or Infinity when nobody there sells it. Keeps sell bonuses
     * from turning a market into a buy-and-sell-back money loop.
     */
    saleUnitCap(player, goodId, settlement, world = null, tile = null, quantity = 1) {
        const at = tile || Economy.settlementTile(world, settlement);
        if (!at) return Infinity;
        const q = Math.max(1, Math.floor(quantity));
        const here = at.settlement || settlement;
        const discount = (s) => Math.max(0.5, 1 - Trading.buyDiscount(player, s)) * Difficulty.mult(player, 'buyPrice');
        // Each market's price after the player's own discount there (as buyGoods charges it)
        const discounted = (ask, s) => Math.ceil(ask * discount(s));
        let flat = Infinity;
        let ownAsk = null;
        if (world && typeof world.getTile === 'function') {
            const near = Ships.nearbyAsks(world, at.q, at.r, goodId);
            for (const m of near.markets) {
                if (m.settlement === here) ownAsk = m.ask;
                else flat = Math.min(flat, discounted(m.ask, m.settlement) - 1);
            }
            // ...or a harbour's
            if (near.port != null) flat = Math.min(flat, near.port - 1);
        } else {
            ownAsk = Economy.marketAsk(world, at, goodId);
        }
        if (ownAsk == null) return flat === Infinity ? Infinity : Math.max(0, flat);
        // This market: buying the unit back costs the price at the stock the sale leaves
        const good = Economy._goods()[String(goodId).toUpperCase()];
        const tracked = good && here && here.market && SettlementMarket.tracks(goodId);
        let total = 0;
        if (tracked) {
            const askBase = Economy.marketAskBase(good, here, at, world);
            const s0 = SettlementMarket.stock(here, goodId);
            // (as buyCost charges it: the guild's floor, the member's guild rates)
            const d = discount(here) * (1 - Guilds.inputDiscount(player, here, goodId));
            const floor = Guilds.askFloor(here, goodId);
            for (let j = 1; j <= q; j++) {
                const own = Math.floor(askBase * Math.max(floor, SettlementMarket.scarcity(here, goodId, s0 + j)) * d) - 1;
                total += Math.max(0, Math.min(flat, own));
            }
        } else {
            total = Math.max(0, Math.min(flat, discounted(ownAsk, here) - 1)) * q;
        }
        return total / q;
    },

    /** Share of the base price a settlement pays for goods you sell it. */
    SELL_SHARE: 0.7,

    /** Share of what a good is worth that this settlement pays: more while a fair is on (systems/marketFairs.js). */
    sellShare(settlement) {
        const f = SettlementMarket.fair(settlement);
        return f && f.sell > Trading.SELL_SHARE ? Math.min(0.95, f.sell) : Trading.SELL_SHARE;
    },

    /**
     * What a settlement pays per unit for a good you sell, before trade
     * bonuses: 70% of what it's worth there — base × the town's scarcity ×
     * season × cold demand × events (SettlementMarket.value). Without a
     * settlement (or a market that doesn't keep the good) it's 70% of base,
     * moved by the season (sell food in the lean months, not into the
     * harvest glut).
     */
    getSellPrice(good, world = null, settlement = null, tile = null) {
        if (!good) return 0;
        if (settlement && settlement.market && SettlementMarket.tracks(good.id)) {
            const at = tile || Economy.settlementTile(world, settlement);
            return Math.floor(SettlementMarket.value(world, settlement, at, good.id, good.basePrice) * Trading.sellShare(settlement));
        }
        return Math.floor(good.basePrice * Trading.SELL_SHARE * Seasons.priceMultiplier(good.id, Seasons.today(world)));
    },

    /** Seasonal price outlook for a good: { trend: 'rising'|'falling'|'stable', modifier }. */
    getSeasonalTrend(goodId, world = null) {
        const day = Seasons.today(world);
        return { trend: Seasons.priceTrend(goodId, day), modifier: Seasons.priceModifier(goodId, day) };
    },

    /**
     * What `settlement` pays the player per unit of `good` (averaged over
     * `quantity`): 70% of what each unit is worth there at the stock it
     * finds (the more you sell, the less each fetches), raised by trade
     * bonuses, cut by any tariff (`priceMult`) — and never more than buying
     * it back here would cost (Trading.saleUnitCap).
     */
    saleUnitPrice(player, good, settlement, world = null, priceMult = 1, quantity = 1) {
        const q = Math.max(1, Math.floor(quantity));
        // Commerce techs (accounting, guilds, ...) improve every sale
        const tradeBonus = ((typeof Technology !== 'undefined') ? Technology.getTradeProfitBonus(player) : 0)
            + PlayerEffects.tradeBonus(player, settlement)
            + Economy.saleBonus(settlement); // a market town near gems, spices, oil...
        let value;
        if (settlement && settlement.market && SettlementMarket.tracks(good.id)) {
            const at = Economy.settlementTile(world, settlement);
            const now = SettlementMarket.scarcity(settlement, good.id);
            const unitBase = SettlementMarket.value(world, settlement, at, good.id, good.basePrice) / (now || 1);
            const s0 = SettlementMarket.stock(settlement, good.id);
            let sum = 0;
            for (let j = 0; j < q; j++) sum += unitBase * SettlementMarket.scarcity(settlement, good.id, s0 + j);
            // The town's guild: an outsider pays its toll, a master's goods carry its mark (systems/guilds.js)
            value = sum * Trading.sellShare(settlement) * (1 + tradeBonus) * priceMult * Guilds.saleFactor(player, settlement, good.id);
        } else {
            // (a fashion at court lifts what goods no market keeps fetch: exotics — world/fashions.js)
            value = Trading.getSellPrice(good, world) * q * (1 + tradeBonus) * priceMult * SettlementMarket.fashionFactor(settlement, good.id);
        }
        value *= Difficulty.mult(player, 'sellPrice'); // the difficulty (1 on Normal)
        return Math.min(value, Trading.saleUnitCap(player, good.id, settlement, world, null, q) * q) / q;
    },


    /**
     * Why the player may not trade `goodId` here — someone else (a guild or
     * a rival merchant house) holds the town's monopoly on it — or null.
     */
    monopolyBlock(settlement, goodId, player = null) {
        const holder = Economy.monopolyHolder(settlement, goodId);
        // The crown's monopoly (systems/kingship.js) is the player's own: it
        // raises the price instead of barring the trade
        if (!holder || holder === 'player' || holder === 'crown') return null;
        // A guild's monopoly binds outsiders only: its journeymen and masters trade (systems/guilds.js)
        if (holder === 'guild' && player && Guilds.monopolyMember(player, settlement, goodId)) return null;
        const m = settlement.monopolies[goodId];
        return `${m.holderName || 'A chartered guild'} holds the monopoly on ${goodId.replace(/_/g, ' ')} in ${settlement.name || 'this town'}.`;
    },

    /**
     * Buy goods from a settlement
     */
    buyGoods(player, good, quantity, settlement, grade = null) {
        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }
        // A named grade comes off its own lot, at its own price (world/marketGrades.js)
        const gradeId = grade ? Grades.get(grade).id : 'common';
        if (gradeId !== 'common' && !(good.lots && good.lots[gradeId] >= quantity)) {
            return { success: false, reason: `Not that many ${Grades.get(gradeId).name.toLowerCase()} ${good.name || good.id} on the stalls` };
        }

        const totalCost = Trading.buyGradeCost(player, good, quantity, settlement, gradeId);

        if (player.gold < totalCost) {
            return { success: false, reason: 'Not enough gold' };
        }

        const blocked = Trading.monopolyBlock(settlement, good.id, player);
        if (blocked) return { success: false, reason: blocked };

        // Carrying capacity: a new kind of good needs a free slot
        if (!PlayerInventory.canAdd(player, good.id)) {
            return { success: false, reason: PlayerInventory.fullMessage(player), inventoryFull: true };
        }

        player.gold -= totalCost;

        // The crown's markup on a monopoly good is owed to the royal treasury
        // (swept in by Kingship.syncCrownMonopolies)
        const mono = settlement && settlement.monopolies && settlement.monopolies[good.id];
        let crownCut = 0;
        if (mono && mono.holder === 'crown' && mono.markup > 0) {
            crownCut = totalCost * mono.markup / (1 + mono.markup);
            mono.revenue = (mono.revenue || 0) + crownCut;
        }
        // The rest is the town's: its stallholders' takings go into its purse
        if (settlement) Economy.payTown(settlement, totalCost - crownCut);

        // Add to player inventory (at the grade bought)
        PlayerInventory.addItem(player, good.id, quantity);
        if (gradeId !== 'common') {
            Grades.add(player, good.id, quantity, gradeId);
            if (settlement) MarketGrades.take(settlement, good.id, quantity, gradeId);
            good.lots[gradeId] -= quantity;
        }

        // The season's tally of what the player moved here, before the stock moves (systems/reckoning.js)
        if (settlement) Reckoning.noteTrade(player, settlement, good.id, quantity, 'buy', totalCost);
        // The goods leave the town's store (the price climbs)
        if (settlement) SettlementMarket.take(settlement, good.id, quantity);

        // Guild members' standing grows with trade in its goods (systems/guilds.js)
        if (settlement) Guilds.onBuy(player, settlement, good.id, quantity, totalCost);
        // The goods are booked by the realm they were bought in (crown tariffs, embargoes — systems/tradePolicy.js)
        if (settlement) TradePolicy.onBuy(player, settlement, good.id, quantity);

        // Increase commerce skill; Haggling practice by the size of the deal (systems/socialSkills.js)
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);
        SocialSkills.train(player, 'haggling', SocialSkills.tradeXp(totalCost));
        // The Merchant's Ledger books the cost (systems/priceKnowledge.js)
        PriceKnowledge.recordBuy(player, settlement, good.id, quantity, totalCost);

        return { success: true, spent: totalCost, grade: gradeId };
    },

    /** The guild's toll inside a sale's price (what Guilds.onSale books to the guildhall). */
    _guildToll(player, settlement, goodId, earned) {
        if (!settlement || !settlement.guilds || !(earned > 0)) return 0;
        const f = Guilds.saleFactor(player, settlement, goodId);
        return f > 0 && f < 1 ? Math.round(earned * (1 - f) / f) : 0;
    },

    /**
     * What a sale costs the town's purse: the price paid to the player, plus
     * the crown's duty and the guild's toll taken inside it.
     */
    saleOutlay(player, settlement, goodId, earned, policy = null) {
        if (!(earned > 0)) return 0;
        const rate = policy && policy.held > 0 && policy.rate > 0 && settlement && settlement.kingdom != null ? policy.rate : 0;
        const duty = rate > 0 ? Math.round(earned * rate / Math.max(0.1, 1 - rate)) : 0;
        return earned + duty + Trading._guildToll(player, settlement, goodId, earned);
    },

    /**
     * How many of `qty` units the town's purse can pay for (whole units, by the
     * same price curve the sale walks) — `qty` when it keeps no purse.
     */
    affordableSale(player, goodId, qty, settlement, world = null) {
        const purse = Economy.townPurse(settlement);
        const n = Math.max(0, Math.floor(qty));
        if (purse == null || n === 0) return n;
        const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === goodId);
        if (!good) return n;
        const cost = (k) => Trading.saleOutlay(player, settlement, goodId, Math.floor(Trading.saleUnitPrice(player, good, settlement, world, 1, k) * k));
        if (cost(n) <= purse) return n;
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (cost(mid) <= purse) lo = mid; else hi = mid - 1;
        }
        return lo;
    },

    /**
     * Sell goods to a settlement
     */
    sellGoods(player, goodId, quantity, settlement = null, world = null, grade = null) {
        if (!player.inventory || !player.inventory[goodId] || player.inventory[goodId] < quantity) {
            return { success: false, reason: 'Not enough in inventory' };
        }
        // A named grade sells only units of that grade (core/grades.js)
        if (grade && Grades.counts(player, goodId)[Grades.get(grade).id] < quantity) {
            return { success: false, reason: `You don't have ${quantity} ${Grades.get(grade).name.toLowerCase()} ${goodId.replace(/_/g, ' ')}` };
        }

        // Find the good in PlayerEconomy.GOODS
        let good = null;
        for (const key in PlayerEconomy.GOODS) {
            if (PlayerEconomy.GOODS[key].id === goodId) {
                good = PlayerEconomy.GOODS[key];
                break;
            }
        }

        if (!good) return { success: false, reason: 'Invalid good' };
        // Goods no stall buys (bones, bone meal: their own buyers — systems/graveyards.js)
        if (good.noMarket) return { success: false, reason: `No stall here buys ${String(good.name || goodId).toLowerCase()}. ${good.description || ''}`.trim() };

        const blocked = Trading.monopolyBlock(settlement, goodId, player);
        if (blocked) return { success: false, reason: blocked };
        // The town's guild caps what an outsider may sell of its goods a week (systems/guilds.js)
        const capped = settlement ? Guilds.saleCheck(player, settlement, goodId, quantity) : null;
        if (capped) return { success: false, reason: capped };

        // Hot (stolen) goods go only to a fence; contraband only to the black
        // market; tariffed goods pay the crown its cut (systems/underworld.js)
        const legality = Underworld.legalSaleCheck(player, goodId, quantity, settlement, world);
        if (!legality.ok) return { success: false, reason: legality.reason };

        // The crown's trade policy: goods bought in another realm pay its import
        // duty; goods from a realm under embargo here only a smuggler moves (systems/tradePolicy.js)
        const policy = TradePolicy.saleCheck(player, world, settlement, goodId, quantity);
        if (!policy.ok) return { success: false, reason: policy.reason, embargoed: true };

        // Made goods sell by their grade: a masterwork blade fetches more than a poor one
        // (core/grades.js; a sale that names no grade sells the Common units first)
        const qualityMult = Crafting.saleMult(player, goodId, quantity, grade);
        const totalEarned = Math.floor(Trading.saleUnitPrice(player, good, settlement, world, legality.priceMult * policy.mult, quantity) * quantity * qualityMult);
        // The town pays out of its purse: the price, and the crown's duty and the
        // guild's toll inside it. A town without the coin can't buy
        const outlay = Trading.saleOutlay(player, settlement, goodId, totalEarned, policy);
        const purse = Economy.townPurse(settlement);
        if (purse != null && outlay > purse) {
            return { success: false, reason: `The merchants of ${settlement.name || 'this town'} have only ${Math.floor(purse)} gold to spend.`, townPurse: Math.floor(purse) };
        }
        const duty = TradePolicy.onSale(player, world, settlement, goodId, quantity, totalEarned, policy);

        const drawn = Grades.take(player, goodId, quantity, grade ? { grade } : { order: 'sale' }).drawn;
        // (the graded units go on the stalls as what they are — world/marketGrades.js)
        if (settlement && settlement.market) {
            const avail = SettlementMarket.tracks(goodId) ? SettlementMarket.available(settlement, goodId) : 0;
            for (const [gid, n] of Object.entries(drawn)) {
                if (gid !== 'common') MarketGrades.add(settlement, goodId, n, gid, world ? world.day : 0, avail);
            }
        }
        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;
        if (settlement) Economy.drawTown(settlement, totalEarned + duty.duty + Trading._guildToll(player, settlement, goodId, totalEarned));
        Quests.track(player, 'trade_profit', totalEarned);

        // The goods join the town's store (the price falls); the guild takes its toll
        // (the season's tally first, before the stock moves — systems/reckoning.js)
        if (settlement) {
            Reckoning.noteTrade(player, settlement, goodId, quantity, 'sell', totalEarned);
            SettlementMarket.add(settlement, goodId, quantity);
            Guilds.onSale(player, settlement, goodId, quantity, totalEarned, { tollPaid: true }); // (drawn with the price above)
        }

        // Food sold to a settlement also eases its granary — a town short of
        // stores in the lean season is glad of it (Economy.applyLeanSeason)
        if (settlement && Seasons.priceGroup(goodId) === 'food') {
            if (!settlement.economy) Economy.initSettlement(settlement);
            settlement.economy.food = (settlement.economy.food || 0) + quantity;
        }

        // Increase commerce skill; Haggling practice by the size of the deal (systems/socialSkills.js)
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);
        SocialSkills.train(player, 'haggling', SocialSkills.tradeXp(totalEarned));
        // ...and the sale, against what the goods cost (profit by good and route)
        PriceKnowledge.recordSale(player, settlement, goodId, quantity, totalEarned);

        return { success: true, earned: totalEarned, drawn, tariff: legality.tariff || 0, duty: duty.duty, breachHeat: duty.heat };
    },
};
