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
            produces: 'grain', // Changed from 'food'
            productionRate: 10,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland'],
            description: 'Produces grain that can be milled or sold. Upkeep: 5g/day'
        },
        PASTURE: {
            id: 'pasture',
            name: 'Pasture',
            icon: '🐑',
            cost: 500,
            produces: 'wool',
            productionRate: 8,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland', 'hills'],
            description: 'Raises sheep for wool. Upkeep: 5g/day'
        },
        LOGGING_CAMP: {
            id: 'logging_camp',
            name: 'Logging Camp',
            icon: '🪓',
            cost: 400,
            produces: 'wood',
            productionRate: 6,
            upkeep: 5,
            requiredTerrain: ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest'],
            description: 'Harvests wood from forests. Upkeep: 5g/day'
        },
        MINE: {
            id: 'mine',
            name: 'Mine',
            icon: '⛏️',
            cost: 1000,
            produces: 'iron',
            productionRate: 5,
            upkeep: 15,
            requiredResource: ['iron', 'gold_ore', 'gems', 'stone'],
            description: 'Extracts valuable resources for sale. Upkeep: 15g/day'
        },
        WORKSHOP: {
            id: 'workshop',
            name: 'Workshop',
            icon: '🔨',
            cost: 800,
            produces: null, // Variable based on recipe
            productionRate: 5, // Process rate
            upkeep: 10,
            requiredSettlement: true,
            description: 'Processes raw materials into goods. Upkeep: 10g/day'
        },
        TRADING_POST: {
            id: 'trading_post',
            name: 'Trading Post',
            icon: '🏪',
            cost: 600,
            produces: null,
            productionRate: 0,
            upkeep: 5,
            requiredSettlement: true,
            description: 'Attracts traveling merchants. Upkeep: 5g/day'
        },
        FISHING_WHARF: {
            id: 'fishing_wharf',
            name: 'Fishing Wharf',
            icon: '⚓',
            cost: 800,
            produces: 'fish',
            productionRate: 0, // Depends on boats
            upkeep: 10,
            requiredTerrain: ['coast', 'beach'],
            description: 'Send boats to collect fish from nearby waters. Upkeep: 10g/day'
        },
    },

    /**
     * Goods and their base prices
     */
    GOODS: {
        GRAIN: { id: 'grain', name: 'Grain', icon: '🌾', basePrice: 5 },
        FLOUR: { id: 'flour', name: 'Flour', icon: '🥡', basePrice: 10 },
        BREAD: { id: 'bread', name: 'Bread', icon: '🍞', basePrice: 15 },
        FISH: { id: 'fish', name: 'Raw Fish', icon: '🐟', basePrice: 8 },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoked Fish', icon: '🍥', basePrice: 20 },
        WOOD: { id: 'wood', name: 'Wood', icon: '🌲', basePrice: 8 },
        FIREWOOD: { id: 'firewood', name: 'Firewood', icon: '🔥', basePrice: 12 },
        WOOL: { id: 'wool', name: 'Wool', icon: '🐑', basePrice: 10 },
        TEXTILES: { id: 'textiles', name: 'Textiles', icon: '🧵', basePrice: 25 },
        CLOTHES: { id: 'clothes', name: 'Clothes', icon: '👕', basePrice: 40 },
        STONE: { id: 'stone', name: 'Stone', icon: '⛰️', basePrice: 8 },
        IRON: { id: 'iron', name: 'Iron', icon: '⚒️', basePrice: 20 },
        TOOLS: { id: 'tools', name: 'Tools', icon: '🔧', basePrice: 35 },
        WEAPONS: { id: 'weapons', name: 'Weapons', icon: '⚔️', basePrice: 60 },
        GOLD_ORE: { id: 'gold_ore', name: 'Gold Ore', icon: '💰', basePrice: 40 },
        GEMS: { id: 'gems', name: 'Gems', icon: '💎', basePrice: 60 },
        SPICES: { id: 'spices', name: 'Spices', icon: '🧂', basePrice: 45 },
        HORSES: { id: 'horses', name: 'Horses', icon: '🐴', basePrice: 55 },
        LUXURIES: { id: 'luxuries', name: 'Luxuries', icon: '💍', basePrice: 100 },
    },

    /**
     * Crafting Recipes for Workshops
     */
    RECIPES: {
        FIREWOOD: { id: 'firewood', name: 'Split Firewood', input: 'wood', inputQty: 2, output: 'firewood', outputQty: 5, description: 'Prepare fuel for heating.' },
        FLOUR: { id: 'flour', name: 'Mill Flour', input: 'grain', inputQty: 2, output: 'flour', outputQty: 2, description: 'Grind grain into flour.' },
        BREAD: { id: 'bread', name: 'Bake Bread', input: 'flour', inputQty: 1, output: 'bread', outputQty: 4, description: 'Bake nutritious bread.' },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoke Fish', input: 'fish', inputQty: 2, output: 'preserved_fish', outputQty: 3, description: 'Preserve fish for long-term storage.' },
        TEXTILES: { id: 'textiles', name: 'Weave Textiles', input: 'wool', inputQty: 3, output: 'textiles', outputQty: 2, description: 'Weave wool into cloth.' },
        CLOTHES: { id: 'clothes', name: 'Tailor Clothes', input: 'textiles', inputQty: 1, output: 'clothes', outputQty: 2, description: 'Sew warm clothing.' },
        TOOLS: { id: 'tools', name: 'Forge Tools', input: 'iron', inputQty: 1, output: 'tools', outputQty: 2, description: 'Smith essential tools.' },
        WEAPONS: { id: 'weapons', name: 'Forge Weapons', input: 'iron', inputQty: 2, output: 'weapons', outputQty: 1, description: 'Forge weapons for war.' },
        LUXURIES: { id: 'luxuries', name: 'Refine Luxuries', input: 'gold_ore', inputQty: 2, output: 'luxuries', outputQty: 1, description: 'Craft fine jewelry.' },
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
            // Special case for Fishing Wharf: can be built on coastal land adjacent to water
            if (propertyType.toUpperCase() === 'FISHING_WHARF') {
                // Nothing special here actually, we handle it by setting requiredTerrain to coast/beach.
                // But typically wharfs are built on land NEXT to water, or ON water?
                // Let's assume on land next to water for simplicity, or on coastal tiles.
                // If the user wants to build it on a 'plain' next to the ocean, that might fail if we restrict to 'coast'.
                // The 'coast' terrain type in this game seems to be shallow water (impassable).
                // 'beach' is passable.
                // Let's allow building on any passable land IF it has an adjacent water tile.

                const nearbyWater = Hex.neighbors(tile.q, tile.r).some(n => {
                    const nt = world.getTile(n.q, n.r);
                    return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
                });

                if (!nearbyWater && !prop.requiredTerrain.includes(tile.terrain.id)) {
                    return { canBuild: false, reason: `Requires coastal location` };
                }

                if (!tile.terrain.passable) {
                    return { canBuild: false, reason: `Must be built on land` };
                }

            } else {
                return { canBuild: false, reason: `Requires ${prop.requiredTerrain.join(' or ')} terrain` };
            }
        }

        // Check resource requirements
        if (prop.requiredResource) {
            if (!tile.resource || !prop.requiredResource.includes(tile.resource.id)) {
                return { canBuild: false, reason: `Requires ${prop.requiredResource.join(' or ')} resource` };
            }
        }

        // Check settlement requirements
        if (prop.requiredSettlement) {
            let hasSettlement = tile.settlement != null;

            // Allow Workshops to be built adjacent to settlements
            if (!hasSettlement && propertyType.toUpperCase() === 'WORKSHOP') {
                // Check neighbors
                const neighbors = Hex.neighbors(tile.q, tile.r);
                for (const n of neighbors) {
                    const nTile = world.getTile(n.q, n.r);
                    if (nTile && nTile.settlement) {
                        hasSettlement = true;
                        break;
                    }
                }
            }

            if (!hasSettlement) {
                return { canBuild: false, reason: 'Requires a settlement (or adjacent for Workshops)' };
            }
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
            upkeep: prop.upkeep || 0,
            level: 1,
            daysOwned: 0,
            storage: 0,
            upkeep: prop.upkeep || 0,
            level: 1,
            daysOwned: 0,
            storage: 0,
            inputStorage: 0, // For workshops
            activeRecipe: null, // For workshops
            autoSell: false,
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

            // Resource Bonus for Logging Camp
            if (property.type === 'logging_camp' && tile.resource && tile.resource.id === 'timber') {
                amount *= 1.5; // 50% bonus for timber resource
            }

            // Level bonus (10% per level)
            amount *= (1 + (property.level - 1) * 0.1);

            // Commerce skill bonus (5% per level)
            amount *= (1 + player.skills.commerce * 0.05);

            amount = Math.floor(amount);

            let producedAmount = amount;
            let producedGood = property.produces;
            let consumedInput = false;

            // Workshop Specific Logic
            if (property.type === 'workshop') {
                if (!property.activeRecipe) {
                    producedAmount = 0; // No recipe, no production
                } else {
                    const recipe = PlayerEconomy.RECIPES[property.activeRecipe];
                    if (recipe) {
                        // Check input storage
                        const inputNeeded = recipe.inputQty;
                        const outputQty = recipe.outputQty;

                        // Calculate max runs based on input
                        const maxRuns = Math.floor((property.inputStorage || 0) / inputNeeded);

                        // Calculate desired runs based on production rate (which we treat as number of runs or output? Let's treat rate as raw output capacity)
                        // But for simplicity, let's say rate = number of recipe runs per day?
                        // Or rate = amount of output units? 
                        // Let's stick to rate = output units.
                        // So desired runs = amount / outputQty

                        let runs = Math.floor(amount / outputQty);
                        if (runs < 1) runs = 1; // Minimum 1 run if rate allows at least something? Or maybe strict.

                        const actualRuns = Math.min(runs, maxRuns);

                        if (actualRuns > 0) {
                            property.inputStorage -= actualRuns * inputNeeded;
                            producedAmount = actualRuns * outputQty;
                            producedGood = recipe.output;
                            consumedInput = true;
                        } else {
                            producedAmount = 0; // Not enough input
                        }
                    }
                }
            }

            // Pay upkeep
            const upkeepCost = (property.upkeep || 0) * property.level;

            // Only produce if upkeep paid (and inputs valid for workshop)
            if (player.gold >= upkeepCost) {
                player.gold -= upkeepCost;

                if (producedAmount > 0) {
                    // Add to property storage if upkeep paid
                    property.storage = (property.storage || 0) + producedAmount;

                    // Track production
                    production[producedGood] = (production[producedGood] || 0) + producedAmount;
                }
            }

            // Increment days owned
            property.daysOwned++;

            // Auto sell if enabled (simple logic)
            if (property.autoSell && property.storage > 0 && producedAmount > 0) {
                const sellAmount = property.storage;
                // ... same as before
                const goodType = producedGood.toUpperCase();
                const good = PlayerEconomy.GOODS[goodType];
                if (good) {
                    const income = Math.floor(sellAmount * good.basePrice * 0.5);
                    player.gold += income;
                    property.storage = 0;
                }
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
     * Start a caravan specifically from property storage
     * toSettlement can be a Settlement OR a Player Property object (must have q, r, name, type)
     */
    startStorageCaravan(player, tile, toSettlement, world) {
        if (!tile.playerProperty) return { success: false, reason: 'No property here' };

        const property = tile.playerProperty;
        if (property.storage <= 0) return { success: false, reason: 'Storage is empty' };

        // Determine property output
        const outputGood = property.produces;
        if (!outputGood) return { success: false, reason: 'Nothing to ship' };

        const goods = {};
        goods[outputGood] = property.storage;

        // Use regular caravan logic but don't deduct from inventory, deduct from storage
        const cost = 200;
        if (player.gold < cost) {
            return { success: false, reason: `Need ${cost} gold` };
        }

        const dist = Hex.wrappingDistance(
            tile.q, tile.r,
            toSettlement.q, toSettlement.r,
            world.width
        );

        if (dist > 20) return { success: false, reason: 'Destination too far' };

        // Calculate expected profit OR just mark as internal transfer
        let expectedProfit = 0;
        let isInternalTransfer = false;

        // Internal Transfer Logic: If destination is a Workshop owned by player
        if (toSettlement.isPlayerProperty && toSettlement.type === 'workshop') {
            isInternalTransfer = true;
            expectedProfit = 0; // No gold profit, materials transfer
        } else {
            // Standard Trade
            const goodId = outputGood.toUpperCase();
            const good = PlayerEconomy.GOODS[goodId];

            if (good) {
                let price = good.basePrice;
                price *= (1 + dist * 0.05); // Distance bonus
                const sizeMultiplier = {
                    village: 0.8, town: 1.0, city: 1.2, capital: 1.5
                };
                price *= sizeMultiplier[toSettlement.type] || 1.0;
                expectedProfit = Math.floor(price * property.storage);
            }
        }

        // Deduct cost and storage
        player.gold -= cost;
        property.storage = 0;

        // Create caravan
        const caravan = {
            from: property.name,
            to: toSettlement.name,
            fromPos: { q: tile.q, r: tile.r },
            toPos: { q: toSettlement.q, r: toSettlement.r },
            currentPos: { q: tile.q, r: tile.r },
            distance: dist,
            goods: { ...goods },
            expectedProfit,
            daysRemaining: Math.ceil(dist / 2),
            status: 'traveling',
            isInternalTransfer,
            targetPropertyType: toSettlement.isPlayerProperty ? toSettlement.type : null
        };

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        return { success: true, caravan };
    },

    /**
     * Upgrade a property
     */
    upgradeProperty(player, tile) {
        if (!tile.playerProperty) return { success: false, reason: 'No property' };

        const property = tile.playerProperty;
        if (property.level >= 5) return { success: false, reason: 'Max level reached' };

        const cost = Math.floor(PlayerEconomy.PROPERTY_TYPES[property.type.toUpperCase()].cost * 0.5 * (property.level + 1));

        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        property.level++;

        return { success: true, level: property.level, cost };
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

                    if (caravan.isInternalTransfer) {
                        // Deposit goods into target property input storage
                        const targetTile = world.getTile(caravan.toPos.q, caravan.toPos.r);
                        // Verify target exists and is still ours
                        if (targetTile && targetTile.playerProperty && targetTile.playerProperty.type === 'workshop') {
                            // Add to input storage
                            for (const qty of Object.values(caravan.goods)) {
                                targetTile.playerProperty.inputStorage = (targetTile.playerProperty.inputStorage || 0) + qty;
                            }
                        }
                        // No gold gained, but log valid completion
                        completed.push({ ...caravan, finalProfit: 0 });
                    } else {
                        // Commercial Trade Logic
                        const bonus = 1 + player.skills.commerce * 0.05;
                        const finalProfit = Math.floor(caravan.expectedProfit * bonus);

                        player.gold += finalProfit;
                        completed.push({ ...caravan, finalProfit });

                        // Track for quests
                        Quests.trackCaravanCompleted(player);

                        // Increase commerce skill
                        player.skills.commerce = Math.min(10, player.skills.commerce + 0.2);
                    }

                    // Remove from active caravans
                    player.caravans.splice(i, 1);
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
    /**
     * Set active recipe for a workshop
     */
    setWorkshopRecipe(tile, recipeId) {
        if (!tile.playerProperty || tile.playerProperty.type !== 'workshop') return { success: false };
        tile.playerProperty.activeRecipe = recipeId;
        const recipe = PlayerEconomy.RECIPES[recipeId];
        if (recipe) {
            tile.playerProperty.produces = recipe.output;
        }
        return { success: true };
    },

    /**
     * Deposit goods into workshop input storage
     */
    depositToWorkshop(player, tile, goodId, amount) {
        if (!tile.playerProperty || tile.playerProperty.type !== 'workshop') return { success: false, reason: 'Not a workshop' };

        if (!player.inventory[goodId] || player.inventory[goodId] < amount) {
            return { success: false, reason: 'Not enough goods' };
        }

        // Validate good matches recipe input? 
        // Or just allow generic input storage. Let's validate against current recipe to be safe.
        const recipe = PlayerEconomy.RECIPES[tile.playerProperty.activeRecipe];
        if (!recipe) return { success: false, reason: 'No recipe selected' };
        if (recipe.input !== goodId) return { success: false, reason: `Recipe needs ${recipe.input}` };

        player.inventory[goodId] -= amount;
        tile.playerProperty.inputStorage = (tile.playerProperty.inputStorage || 0) + amount;

        return { success: true };
    },

    /**
     * Send a fishing boat to a resource
     */
    sendFishingBoat(player, tile, targetQ, targetR, world) {
        if (!tile.playerProperty || tile.playerProperty.type !== 'fishing_wharf') return { success: false, reason: 'Not a fishing wharf' };

        const cost = 50;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        // Limit boats per wharf
        const activeBoats = world.units.filter(u =>
            u.type === 'fishing_boat' &&
            u.sourceQ === tile.q &&
            u.sourceR === tile.r &&
            !u.destroyed
        );

        if (activeBoats.length >= tile.playerProperty.level) {
            return { success: false, reason: `Max boats dispatched (Upgrade for more)` };
        }

        player.gold -= cost;

        // Create Unit
        const boat = new WorldUnit('fishing_boat', tile.q, tile.r, targetQ, targetR);
        // Explicitly set source on the boat instance
        boat.sourceQ = tile.q;
        boat.sourceR = tile.r;
        boat.homeWharf = { q: tile.q, r: tile.r }; // Reference to home

        world.units.push(boat);

        return { success: true, boat };
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

        // Temperature based demand for Firewood and Warm Clothes
        const world = (typeof window !== 'undefined' && window.game) ? window.game.world : null;

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
