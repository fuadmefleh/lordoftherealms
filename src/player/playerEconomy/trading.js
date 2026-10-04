// Trading — split from playerEconomy.js; references PlayerEconomy (GOODS etc.).
import { PlayerEconomy } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, PlayerEffects, PlayerInventory, Economy, Seasons } from './_imports.js';

export const Trading = {
    /**
     * Get available goods at a settlement
     */
    getAvailableGoods(settlement, tile, world = null) {
        const goods = [];
        if (!settlement.marketStock) settlement.marketStock = {};

        // Helper to add good
        const addGood = (goodKey, qtyMult) => {
            const good = PlayerEconomy.GOODS[goodKey];
            if (!good) return;

            const baseQty = Math.floor(settlement.population * qtyMult);
            const bought = settlement.marketStock[good.id] || 0;
            const available = Math.max(0, baseQty - bought);

            goods.push({
                ...good,
                quantity: available,
                price: Trading.calculatePrice(good, settlement, tile, world),
            });
        };

        // All settlements have basic food
        addGood('GRAIN', 0.1);
        addGood('BREAD', 0.05);

        // Larger settlements have more variety
        if (settlement.type === 'town' || settlement.type === 'city' || settlement.type === 'capital') {
            addGood('TOOLS', 0.02);
            addGood('WOOD', 0.05);
            addGood('STONE', 0.03);
        }

        if (settlement.type === 'city' || settlement.type === 'capital') {
            addGood('WEAPONS', 0.01);
            addGood('LUXURIES', 0.005);
            addGood('GEMS', 0.002);
        }

        // All settlements with taverns sell beer and liquor
        if (settlement.type === 'town' || settlement.type === 'capital') {
            addGood('BEER', 0.08);
            addGood('LIQUOR', 0.03);
        }

        // Horses available at larger settlements
        if (settlement.type === 'town') {
            addGood('HORSES', 0.005);  // Basic workhorses at towns
        }
        if (settlement.type === 'city' || settlement.type === 'capital') {
            addGood('HORSE', 0.003);   // Quality riding horses at cities/capitals
        }

        // Local resources stock the market: coal from the pits, rock oil
        // from the seeps, beef and hides from the herds
        const resId = tile && tile.resource && tile.resource.id;
        if (resId === 'coal') addGood('COAL', 0.03);
        if (resId === 'oil') { addGood('OIL', 0.01); addGood('LAMP_OIL', 0.01); }
        if (resId === 'cattle') { addGood('MEAT', 0.04); addGood('HIDE', 0.02); }

        return goods;
    },

    /**
     * Calculate price based on settlement and resources
     */
    calculatePrice(good, settlement, tile, world = null) {
        let price = good.basePrice;

        // Larger settlements have better prices (cheaper to buy)
        const sizeMultiplier = {
            village: 1.2,
            town: 1.0,
            city: 0.9,
            capital: 0.8,
        };
        price *= sizeMultiplier[settlement.type] || 1.0;

        // Temperature based demand for Firewood and Warm Clothes.
        // `world` is injected by the caller (Trading.getAvailableGoods ← UI);
        // null in headless/test contexts, which skips weather-based demand.
        if (world && world.weather) {
            // Seasonal temperature in °C, and snow on the ground makes it worse
            const temp = world.weather.getTemperature(tile.q, tile.r);
            const celsius = typeof temp === 'object' ? temp.celsius : 15;
            const wx = world.weather.getWeather(tile.q, tile.r).type;
            const isCold = celsius < 5 || wx === 'snow' || wx === 'blizzard';

            if (good.id === 'firewood') {
                if (isCold) price *= 1.5; // High demand in cold
                else price *= 0.8; // Low demand elsewhere
            }
            if (good.id === 'clothes') {
                if (isCold) price *= 1.3;
            }
        } else {
            // Fallback to biome based logic
            const isCold = ['tundra', 'snowy_wasteland', 'ice_sheet', 'taiga', 'boreal_forest'].includes(tile.terrain.id);
            if (good.id === 'firewood') {
                if (isCold) price *= 1.5;
                else price *= 0.8;
            }
        }

        // Resource bonuses affect prices
        if (tile.resource) {
            if (good.id === 'grain' && ['wheat'].includes(tile.resource.id)) price *= 0.7;
            if ((good.id === 'bread' || good.id === 'flour') && ['wheat'].includes(tile.resource.id)) price *= 0.85;
            if (good.id === 'weapons' && tile.resource.id === 'iron') price *= 0.8;
            if (good.id === 'luxuries' && ['gems', 'spices'].includes(tile.resource.id)) price *= 0.85;
            if (good.id === 'stone' && tile.resource.id === 'stone') price *= 0.7;
            if (good.id === 'gold_ore' && tile.resource.id === 'gold_ore') price *= 0.7;
            // Coal-fired smithies turn out cheaper metalwork
            if (['weapons', 'tools', 'iron_ingot', 'coal'].includes(good.id) && tile.resource.id === 'coal') price *= good.id === 'coal' ? 0.7 : 0.9;
            if (['oil', 'lamp_oil'].includes(good.id) && tile.resource.id === 'oil') price *= 0.7;
            if (['meat', 'hide', 'cheese', 'leather_armor'].includes(good.id) && tile.resource.id === 'cattle') price *= 0.75;
        }

        // The agricultural year: food is cheap after the harvest and dear in
        // the lean months, furs dear in winter (world/seasons.js)
        price *= Seasons.priceMultiplier(good.id, Seasons.today(world));

        return Math.floor(price);
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

    // Moved to PlayerEconomy object

    /**
     * Buy goods from a settlement
     */
    buyGoods(player, good, quantity, settlement) {
        // Currency minting trims purchase prices
        // Trade agreements and the Trade Envoy's office shave more off
        const discount = ((typeof Technology !== 'undefined') ? Technology.getEffectTotal(player, 'tradePriceDiscount') : 0)
            + PlayerEffects.tradeBonus(player, settlement);
        const totalCost = Math.ceil(good.price * quantity * Math.max(0.5, 1 - discount));

        if (player.gold < totalCost) {
            return { success: false, reason: 'Not enough gold' };
        }

        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }

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

        // Hot (stolen) goods go only to a fence; contraband only to the black
        // market; tariffed goods pay the crown its cut (systems/underworld.js)
        const legality = Underworld.legalSaleCheck(player, goodId, quantity, settlement, world);
        if (!legality.ok) return { success: false, reason: legality.reason };

        // Sell for 70% of base price, moved by the season
        const sellPrice = Trading.getSellPrice(good, world);
        // Commerce techs (accounting, guilds, ...) improve every sale
        const tradeBonus = ((typeof Technology !== 'undefined') ? Technology.getTradeProfitBonus(player) : 0)
            + PlayerEffects.tradeBonus(player, settlement)
            + Economy.saleBonus(settlement); // a market town near gems, spices, oil...
        const totalEarned = Math.floor(sellPrice * quantity * (1 + tradeBonus) * legality.priceMult);

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
