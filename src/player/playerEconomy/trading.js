// Trading — split from playerEconomy.js; references PlayerEconomy (GOODS etc.).
// Buying and selling go through the settlement's one goods inventory
// (world/settlementMarket.js): a purchase takes real stock and every unit
// costs a little more than the last; a sale adds stock and every unit
// fetches a little less.
import { PlayerEconomy } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Ships } from '../../systems/ships.js';
import { Guilds } from '../../systems/guilds.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, PlayerEffects, PlayerInventory, Economy, Seasons, SettlementMarket } from './_imports.js';

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
            const good = PlayerEconomy.GOODS[key];
            if (!good) continue;
            if (kingdom && Underworld.contrabandStatus(kingdom, good.id) === 'illegal') continue;

            const tracked = SettlementMarket.tracks(good.id);
            const askBase = Economy.marketAskBase(good, settlement, tile, world);
            const info = SettlementMarket.info(settlement, good.id);
            // A town guild holds a floor under its goods' ask (systems/guilds.js)
            const floor = Guilds.askFloor(settlement, good.id);
            goods.push({
                ...good,
                quantity: tracked ? SettlementMarket.available(settlement, good.id) : Math.floor((settlement.population || 0) * qtyMult),
                price: Math.floor(askBase * Math.max(info.scarcity, floor)),
                guildFloor: floor > info.scarcity ? floor : 0,
                askBase,
                stock: info.stock,
                scarcity: info.scarcity,
                stockLabel: info.label,
                stockColor: info.color,
                stockDays: info.days,
                trend: info.trend,
            });
        }

        return goods;
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
        const disc = Math.max(0.5, 1 - Trading.buyDiscount(player, settlement)) * (1 - Guilds.inputDiscount(player, settlement, entry && entry.id));
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
        const discount = (s) => Math.max(0.5, 1 - Trading.buyDiscount(player, s));
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
            value = Trading.getSellPrice(good, world) * q * (1 + tradeBonus) * priceMult;
        }
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
    buyGoods(player, good, quantity, settlement) {
        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }

        const totalCost = Trading.buyCost(player, good, quantity, settlement);

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
        if (mono && mono.holder === 'crown' && mono.markup > 0) {
            mono.revenue = (mono.revenue || 0) + totalCost * mono.markup / (1 + mono.markup);
        }

        // Add to player inventory
        PlayerInventory.addItem(player, good.id, quantity);

        // The goods leave the town's store (the price climbs)
        if (settlement) SettlementMarket.take(settlement, good.id, quantity);

        // Guild members' standing grows with trade in its goods (systems/guilds.js)
        if (settlement) Guilds.onBuy(player, settlement, good.id, quantity, totalCost);

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, spent: totalCost };
    },

    /**
     * Sell goods to a settlement
     */
    sellGoods(player, goodId, quantity, settlement = null, world = null) {
        if (!player.inventory || !player.inventory[goodId] || player.inventory[goodId] < quantity) {
            return { success: false, reason: 'Not enough in inventory' };
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

        const blocked = Trading.monopolyBlock(settlement, goodId, player);
        if (blocked) return { success: false, reason: blocked };
        // The town's guild caps what an outsider may sell of its goods a week (systems/guilds.js)
        const capped = settlement ? Guilds.saleCheck(player, settlement, goodId, quantity) : null;
        if (capped) return { success: false, reason: capped };

        // Hot (stolen) goods go only to a fence; contraband only to the black
        // market; tariffed goods pay the crown its cut (systems/underworld.js)
        const legality = Underworld.legalSaleCheck(player, goodId, quantity, settlement, world);
        if (!legality.ok) return { success: false, reason: legality.reason };

        const totalEarned = Math.floor(Trading.saleUnitPrice(player, good, settlement, world, legality.priceMult, quantity) * quantity);

        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;
        Quests.track(player, 'trade_profit', totalEarned);

        // The goods join the town's store (the price falls); the guild takes its toll
        if (settlement) {
            SettlementMarket.add(settlement, goodId, quantity);
            Guilds.onSale(player, settlement, goodId, quantity, totalEarned);
        }

        // Food sold to a settlement also eases its granary — a town short of
        // stores in the lean season is glad of it (Economy.applyLeanSeason)
        if (settlement && Seasons.priceGroup(goodId) === 'food') {
            if (!settlement.economy) Economy.initSettlement(settlement);
            settlement.economy.food = (settlement.economy.food || 0) + quantity;
        }

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, earned: totalEarned, tariff: legality.tariff || 0 };
    },
};
