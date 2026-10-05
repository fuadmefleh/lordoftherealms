// Trading — split from playerEconomy.js; references PlayerEconomy (GOODS etc.).
import { PlayerEconomy } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Ships } from '../../systems/ships.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, PlayerEffects, PlayerInventory, Economy, Seasons } from './_imports.js';

export const Trading = {
    /**
     * Get available goods at a settlement
     */
    getAvailableGoods(settlement, tile, world = null) {
        const goods = [];
        if (!settlement.marketStock) settlement.marketStock = {};

        // What the market stocks lives in world/economy.js so other outlets can see it
        // Contraband isn't sold openly where the realm has banned it
        const kingdom = world && settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
        for (const { key, qtyMult } of Economy.marketGoods(settlement, tile)) {
            const good = PlayerEconomy.GOODS[key];
            if (!good) continue;
            if (kingdom && Underworld.contrabandStatus(kingdom, good.id) === 'illegal') continue;

            const baseQty = Math.floor(settlement.population * qtyMult);
            const bought = settlement.marketStock[good.id] || 0;
            const available = Math.max(0, baseQty - bought);

            goods.push({
                ...good,
                quantity: available,
                price: Trading.calculatePrice(good, settlement, tile, world),
            });
        }

        return goods;
    },

    /**
     * Calculate price based on settlement and resources (Economy.marketPrice).
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
     * Most a buyer on this tile pays per unit of `goodId` the player sells:
     * one less than what the player would pay to buy it back here or in a
     * settlement next door (a market's price after the player's discount, or
     * a port's), or Infinity when nobody there sells it. Keeps sell bonuses
     * from turning a market into a buy-and-sell-back money loop.
     */
    saleUnitCap(player, goodId, settlement, world = null, tile = null) {
        const at = tile || Economy.settlementTile(world, settlement);
        if (!at) return Infinity;
        // Each market's price after the player's own discount there (as buyGoods charges it)
        const discounted = (ask, s) => Math.ceil(ask * Math.max(0.5, 1 - Trading.buyDiscount(player, s)));
        let ask = Infinity;
        if (world && typeof world.getTile === 'function') {
            const near = Ships.nearbyAsks(world, at.q, at.r, goodId);
            for (const m of near.markets) ask = Math.min(ask, discounted(m.ask, m.settlement));
            // ...or a harbour's
            if (near.port != null) ask = Math.min(ask, near.port);
        } else {
            const market = Economy.marketAsk(world, at, goodId);
            if (market != null) ask = discounted(market, settlement);
        }
        return ask === Infinity ? Infinity : Math.max(0, ask - 1);
    },

    /** Share of the base price a settlement pays for goods you sell it. */
    SELL_SHARE: 0.7,

    /**
     * What a settlement pays per unit for a good you sell, before trade
     * bonuses: 70% of base, moved by the season (sell food in the lean
     * months, not into the harvest glut).
     */
    getSellPrice(good, world = null) {
        if (!good) return 0;
        return Math.floor(good.basePrice * Trading.SELL_SHARE * Seasons.priceMultiplier(good.id, Seasons.today(world)));
    },

    /** Seasonal price outlook for a good: { trend: 'rising'|'falling'|'stable', modifier }. */
    getSeasonalTrend(goodId, world = null) {
        const day = Seasons.today(world);
        return { trend: Seasons.priceTrend(goodId, day), modifier: Seasons.priceModifier(goodId, day) };
    },

    /**
     * What `settlement` pays the player per unit of `good`: 70% of base,
     * moved by the season, raised by trade bonuses, cut by any tariff
     * (`priceMult`) — and never more than buying it back here would cost
     * (Trading.saleUnitCap).
     */
    saleUnitPrice(player, good, settlement, world = null, priceMult = 1, quantity = 1) {
        const sellPrice = Trading.getSellPrice(good, world);
        // Commerce techs (accounting, guilds, ...) improve every sale
        const tradeBonus = ((typeof Technology !== 'undefined') ? Technology.getTradeProfitBonus(player) : 0)
            + PlayerEffects.tradeBonus(player, settlement)
            + Economy.saleBonus(settlement); // a market town near gems, spices, oil...
        const value = sellPrice * quantity * (1 + tradeBonus) * priceMult;
        return Math.min(value, Trading.saleUnitCap(player, good.id, settlement, world) * quantity) / quantity;
    },


    /**
     * Why the player may not trade `goodId` here — someone else (a guild or
     * a rival merchant house) holds the town's monopoly on it — or null.
     */
    monopolyBlock(settlement, goodId) {
        const holder = Economy.monopolyHolder(settlement, goodId);
        if (!holder || holder === 'player') return null;
        const m = settlement.monopolies[goodId];
        return `${m.holderName || 'A chartered guild'} holds the monopoly on ${goodId.replace(/_/g, ' ')} in ${settlement.name || 'this town'}.`;
    },

    /**
     * Buy goods from a settlement
     */
    buyGoods(player, good, quantity, settlement) {
        const discount = Trading.buyDiscount(player, settlement);
        const totalCost = Math.ceil(good.price * quantity * Math.max(0.5, 1 - discount));

        if (player.gold < totalCost) {
            return { success: false, reason: 'Not enough gold' };
        }

        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }

        const blocked = Trading.monopolyBlock(settlement, good.id);
        if (blocked) return { success: false, reason: blocked };

        // Carrying capacity: a new kind of good needs a free slot
        if (!PlayerInventory.canAdd(player, good.id)) {
            return { success: false, reason: PlayerInventory.fullMessage(player), inventoryFull: true };
        }

        player.gold -= totalCost;

        // Add to player inventory
        PlayerInventory.addItem(player, good.id, quantity);

        // Reduce settlement stock (increase the "bought" counter)
        if (!settlement.marketStock) settlement.marketStock = {};
        settlement.marketStock[good.id] = (settlement.marketStock[good.id] || 0) + quantity;

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

        const blocked = Trading.monopolyBlock(settlement, goodId);
        if (blocked) return { success: false, reason: blocked };

        // Hot (stolen) goods go only to a fence; contraband only to the black
        // market; tariffed goods pay the crown its cut (systems/underworld.js)
        const legality = Underworld.legalSaleCheck(player, goodId, quantity, settlement, world);
        if (!legality.ok) return { success: false, reason: legality.reason };

        const totalEarned = Math.floor(Trading.saleUnitPrice(player, good, settlement, world, legality.priceMult, quantity) * quantity);

        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;
        Quests.track(player, 'trade_profit', totalEarned);

        // Food sold to a settlement goes into its granary — a town short of
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
