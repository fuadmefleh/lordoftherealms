// Trading — split from playerEconomy.js; references PlayerEconomy (GOODS etc.).
import { PlayerEconomy } from './_ref.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure } from './_imports.js';

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
            const temp = tile.temperature ?? 15; // default 15
            const isCold = temp < 5;

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
        }

        return Math.floor(price);
    },

    // Moved to PlayerEconomy object

    /**
     * Buy goods from a settlement
     */
    buyGoods(player, good, quantity, settlement) {
        const totalCost = good.price * quantity;

        if (player.gold < totalCost) {
            return { success: false, reason: 'Not enough gold' };
        }

        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }

        player.gold -= totalCost;

        // Add to player inventory
        if (!player.inventory) player.inventory = {};
        player.inventory[good.id] = (player.inventory[good.id] || 0) + quantity;

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
    sellGoods(player, goodId, quantity) {
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

        // Sell for 70% of base price
        const sellPrice = Math.floor(good.basePrice * 0.7);
        // Commerce techs (accounting, guilds, ...) improve every sale
        const tradeBonus = (typeof Technology !== 'undefined') ? Technology.getTradeProfitBonus(player) : 0;
        const totalEarned = Math.floor(sellPrice * quantity * (1 + tradeBonus));

        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;
        Quests.track(player, 'trade_profit', totalEarned);

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, earned: totalEarned };
    },
};
