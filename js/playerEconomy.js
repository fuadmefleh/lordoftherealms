// ============================================
// PLAYER ECONOMY — Economic path systems
// ============================================

const PlayerEconomy = {
    /**
     * Property types the player can own
     */
    PROPERTY_TYPES: {
        FARM: {
            id: 'farm',
            name: 'Farm',
            icon: '🌾',
            cost: 500,
            produces: 'food',
            productionRate: 10, // units per day
            requiredTerrain: ['plains', 'grassland'],
            description: 'Produces food that can be sold'
        },
        MINE: {
            id: 'mine',
            name: 'Mine',
            icon: '⛏️',
            cost: 1000,
            produces: 'iron', // or gold_ore, gems, stone based on resource
            productionRate: 5,
            requiredResource: ['iron', 'gold_ore', 'gems', 'stone'],
            description: 'Extracts valuable resources for sale'
        },
        WORKSHOP: {
            id: 'workshop',
            name: 'Workshop',
            icon: '🔨',
            cost: 800,
            produces: 'goods',
            productionRate: 8,
            requiredSettlement: true,
            description: 'Crafts goods for sale'
        },
        TRADING_POST: {
            id: 'trading_post',
            name: 'Trading Post',
            icon: '🏪',
            cost: 600,
            produces: null, // Doesn't produce, attracts traders
            productionRate: 0,
            requiredSettlement: true,
            description: 'Attracts traveling merchants who buy your goods'
        },
    },

    /**
     * Goods and their base prices
     */
    GOODS: {
        FOOD: { id: 'food', name: 'Food', icon: '🌾', basePrice: 5 },
        WOOD: { id: 'wood', name: 'Wood', icon: '🌲', basePrice: 8 },
        STONE: { id: 'stone', name: 'Stone', icon: '⛰️', basePrice: 8 },
        IRON: { id: 'iron', name: 'Iron', icon: '⚒️', basePrice: 20 },
        GOLD_ORE: { id: 'gold_ore', name: 'Gold Ore', icon: '💰', basePrice: 40 },
        GEMS: { id: 'gems', name: 'Gems', icon: '💎', basePrice: 60 },
        TEXTILES: { id: 'textiles', name: 'Textiles', icon: '🧵', basePrice: 25 },
        SPICES: { id: 'spices', name: 'Spices', icon: '🧂', basePrice: 45 },
        HORSES: { id: 'horses', name: 'Horses', icon: '🐴', basePrice: 55 },
        TOOLS: { id: 'tools', name: 'Tools', icon: '🔧', basePrice: 35 },
        WEAPONS: { id: 'weapons', name: 'Weapons', icon: '⚔️', basePrice: 60 },
        LUXURIES: { id: 'luxuries', name: 'Luxuries', icon: '💍', basePrice: 100 },
    },

    /**
     * Check if player can build a property at a location
     */
    canBuildProperty(player, propertyType, tile, world) {
        const prop = PlayerEconomy.PROPERTY_TYPES[propertyType.toUpperCase()];
        if (!prop) return { canBuild: false, reason: 'Invalid property type' };

        // Check gold
        if (player.gold < prop.cost) {
            return { canBuild: false, reason: `Need ${prop.cost} gold (have ${player.gold})` };
        }

        // Check if already has property here
        if (tile.playerProperty) {
            return { canBuild: false, reason: 'Already have a property here' };
        }

        // Check terrain requirements
        if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
            return { canBuild: false, reason: `Requires ${prop.requiredTerrain.join(' or ')} terrain` };
        }

        // Check resource requirements
        if (prop.requiredResource) {
            if (!tile.resource || !prop.requiredResource.includes(tile.resource.id)) {
                return { canBuild: false, reason: `Requires ${prop.requiredResource.join(' or ')} resource` };
            }
        }

        // Check settlement requirements
        if (prop.requiredSettlement && !tile.settlement) {
            return { canBuild: false, reason: 'Requires a settlement' };
        }

        return { canBuild: true, property: prop };
    },

    /**
     * Build a property
     */
    buildProperty(player, propertyType, tile, world) {
        const check = PlayerEconomy.canBuildProperty(player, propertyType, tile, world);
        if (!check.canBuild) return { success: false, reason: check.reason };

        const prop = check.property;

        // Deduct cost
        player.gold -= prop.cost;

        // Determine what this property produces
        let produces = prop.produces;
        if (prop.id === 'mine' && tile.resource) {
            produces = tile.resource.id; // Mine produces whatever resource is there
        }

        // Create property
        tile.playerProperty = {
            type: prop.id,
            name: prop.name,
            icon: prop.icon,
            produces,
            productionRate: prop.productionRate,
            level: 1,
            daysOwned: 0,
            storage: 0, // Stored goods waiting to be collected
        };

        // Add to player's properties list
        if (!player.properties) player.properties = [];
        player.properties.push({
            q: tile.q,
            r: tile.r,
            type: prop.id,
            name: prop.name,
            produces,
        });

        // Initialize player inventory if needed
        if (!player.inventory) player.inventory = {};

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.5);

        return { success: true, property: tile.playerProperty };
    },

    /**
     * Produce goods from all properties
     */
    produceGoods(player, world) {
        if (!player.properties || player.properties.length === 0) return {};

        const production = {};

        for (const prop of player.properties) {
            const tile = world.getTile(prop.q, prop.r);
            if (!tile || !tile.playerProperty) continue;

            const property = tile.playerProperty;
            if (!property.produces) continue; // Trading posts don't produce

            // Calculate production
            let amount = property.productionRate;

            // Level bonus (10% per level)
            amount *= (1 + (property.level - 1) * 0.1);

            // Commerce skill bonus (5% per level)
            amount *= (1 + player.skills.commerce * 0.05);

            amount = Math.floor(amount);

            // Add to property storage
            property.storage = (property.storage || 0) + amount;

            // Track production
            production[property.produces] = (production[property.produces] || 0) + amount;

            // Increment days owned
            property.daysOwned++;

            // Chance to level up (every 30 days)
            if (property.daysOwned % 30 === 0 && property.level < 5) {
                property.level++;
            }
        }

        return production;
    },

    /**
     * Collect goods from properties into player inventory
     */
    collectGoods(player, world) {
        if (!player.properties || player.properties.length === 0) return {};

        if (!player.inventory) player.inventory = {};
        const collected = {};

        for (const prop of player.properties) {
            const tile = world.getTile(prop.q, prop.r);
            if (!tile || !tile.playerProperty) continue;

            const property = tile.playerProperty;
            if (!property.produces || property.storage <= 0) continue;

            // Move from property storage to player inventory
            const goodType = property.produces;
            player.inventory[goodType] = (player.inventory[goodType] || 0) + property.storage;
            collected[goodType] = (collected[goodType] || 0) + property.storage;
            property.storage = 0;
        }

        return collected;
    },

    /**
     * Start a caravan to sell goods at a distant settlement
     */
    startCaravan(player, fromPos, toSettlement, goods, world) {
        const cost = 200;
        if (player.gold < cost) {
            return { success: false, reason: `Need ${cost} gold to start a caravan` };
        }

        // Check if player has the goods
        if (!player.inventory) player.inventory = {};
        for (const [goodType, quantity] of Object.entries(goods)) {
            if (!player.inventory[goodType] || player.inventory[goodType] < quantity) {
                return { success: false, reason: `Not enough ${goodType} in inventory` };
            }
        }

        // Calculate distance
        const dist = Hex.wrappingDistance(
            fromPos.q, fromPos.r,
            toSettlement.q, toSettlement.r,
            world.width
        );

        if (dist > 20) {
            return { success: false, reason: 'Destination too far (max 20 tiles)' };
        }

        // Calculate expected profit
        let expectedProfit = 0;
        for (const [goodType, quantity] of Object.entries(goods)) {
            const goodId = goodType.toUpperCase();
            const good = PlayerEconomy.GOODS[goodId] || PlayerEconomy.GOODS[goodType]; // Try both

            if (good) {
                let price = good.basePrice;
                // Distant settlements pay more
                price *= (1 + dist * 0.05);
                // Settlement size bonus
                const sizeMultiplier = {
                    village: 0.8,
                    town: 1.0,
                    city: 1.2,
                    capital: 1.5,
                };
                price *= sizeMultiplier[toSettlement.type] || 1.0;
                expectedProfit += Math.floor(price * quantity);
            }
        }

        // Deduct cost and goods
        player.gold -= cost;
        for (const [goodType, quantity] of Object.entries(goods)) {
            player.inventory[goodType] -= quantity;
        }

        // Create caravan
        const caravan = {
            from: fromPos.name || 'Your Location',
            to: toSettlement.name,
            fromPos: { q: fromPos.q, r: fromPos.r },
            toPos: { q: toSettlement.q, r: toSettlement.r },
            currentPos: { q: fromPos.q, r: fromPos.r },
            distance: dist,
            goods: { ...goods },
            expectedProfit,
            daysRemaining: Math.ceil(dist / 2), // Travels 2 tiles per day
            status: 'traveling',
        };

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.3);

        return { success: true, caravan };
    },

    /**
     * Update all player caravans
     */
    updateCaravans(player, world) {
        if (!player.caravans || player.caravans.length === 0) return [];

        const completed = [];

        for (let i = player.caravans.length - 1; i >= 0; i--) {
            const caravan = player.caravans[i];

            if (caravan.status === 'traveling') {
                caravan.daysRemaining--;

                if (caravan.daysRemaining <= 0) {
                    // Caravan arrived!
                    caravan.status = 'completed';

                    // Commerce skill bonus
                    const bonus = 1 + player.skills.commerce * 0.05;
                    const finalProfit = Math.floor(caravan.expectedProfit * bonus);

                    player.gold += finalProfit;
                    completed.push({ ...caravan, finalProfit });

                    // Track for quests
                    Quests.trackCaravanCompleted(player);

                    // Remove from active caravans
                    player.caravans.splice(i, 1);

                    // Increase commerce skill
                    player.skills.commerce = Math.min(10, player.skills.commerce + 0.2);
                }
            }
        }

        return completed;
    },

    /**
     * Spawn traveling merchant at trading post
     */
    spawnTravelingMerchant(player, world) {
        if (!player.properties) return null;

        // Find trading posts
        const tradingPosts = player.properties.filter(p => p.type === 'trading_post');
        if (tradingPosts.length === 0) return null;

        // 20% chance per trading post per day
        for (const post of tradingPosts) {
            if (Math.random() < 0.2) {
                const tile = world.getTile(post.q, post.r);
                if (!tile) continue;

                // Merchant wants to buy random goods
                const availableKeys = Object.keys(PlayerEconomy.GOODS);
                const wantsToBuyKey = Utils.randPick(availableKeys);
                const good = PlayerEconomy.GOODS[wantsToBuyKey];

                const quantity = Utils.randInt(5, 20);
                let pricePerUnit = good.basePrice * 1.1; // Pays 10% above base

                return {
                    location: post,
                    wantsToBuy: good.id,
                    quantity,
                    pricePerUnit: Math.floor(pricePerUnit),
                    daysRemaining: 3, // Stays for 3 days
                };
            }
        }

        return null;
    },
};

// ============================================
// TRADING — Player trading with settlements
// ============================================

const Trading = {
    /**
     * Get available goods at a settlement
     */
    getAvailableGoods(settlement, tile) {
        const goods = [];

        // Helper to add good
        const addGood = (goodKey, qtyMult) => {
            const good = PlayerEconomy.GOODS[goodKey];
            if (!good) return;

            goods.push({
                ...good,
                quantity: Math.floor(settlement.population * qtyMult),
                price: Trading.calculatePrice(good, settlement, tile),
            });
        };

        // All settlements have food and common goods
        addGood('FOOD', 0.1);
        addGood('GOODS', 0.05);

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

        return goods;
    },

    /**
     * Calculate price based on settlement and resources
     */
    calculatePrice(good, settlement, tile) {
        let price = good.basePrice;

        // Larger settlements have better prices (cheaper to buy)
        const sizeMultiplier = {
            village: 1.2,
            town: 1.0,
            city: 0.9,
            capital: 0.8,
        };
        price *= sizeMultiplier[settlement.type] || 1.0;

        // Resource bonuses affect prices
        if (tile.resource) {
            if (good.id === 'food' && ['wheat', 'fish'].includes(tile.resource.id)) price *= 0.7;
            if (good.id === 'weapons' && tile.resource.id === 'iron') price *= 0.8;
            if (good.id === 'luxuries' && ['gems', 'spices'].includes(tile.resource.id)) price *= 0.85;
            if (good.id === 'stone' && tile.resource.id === 'stone') price *= 0.7;
            if (good.id === 'gold_ore' && tile.resource.id === 'gold_ore') price *= 0.7;
        }

        return Math.floor(price);
    },

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
        const totalEarned = sellPrice * quantity;

        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, earned: totalEarned };
    },
};
