// PlayerEconomy — property members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure } from './_imports.js';

Object.assign(PlayerEconomy, {
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

        // Check if already has THIS TYPE of property here (allow multiple different types)
        if (tile.playerProperties) {
            const existingOfType = tile.playerProperties.find(p => p.type === prop.id);
            if (existingOfType) {
                return { canBuild: false, reason: `Already have a ${prop.name} here` };
            }
        }

        // Check terrain requirements
        if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
            // Special case for Fishing Wharf: can be built on coastal land adjacent to water
            if (propertyType.toUpperCase() === 'FISHING_WHARF') {
                // Only ocean/sea counts — lakes and rivers do not
                const nearbyOcean = Hex.neighbors(tile.q, tile.r).some(n => {
                    const nt = world.getTile(n.q, n.r);
                    return nt && ['ocean', 'deep_ocean', 'coast', 'sea'].includes(nt.terrain.id);
                });

                if (!nearbyOcean && !prop.requiredTerrain.includes(tile.terrain.id)) {
                    return { canBuild: false, reason: 'Requires a coastal location (adjacent to ocean or sea)' };
                }

                if (!tile.terrain.passable) {
                    return { canBuild: false, reason: 'Must be built on land' };
                }

                // Must have a settlement to serve as a port
                if (!tile.settlement) {
                    return { canBuild: false, reason: 'Requires a coastal settlement' };
                }

            } else {
                return { canBuild: false, reason: `Requires ${prop.requiredTerrain.join(' or ')} terrain` };
            }
        }

        // Fishing wharf always requires a settlement (even when terrain is coast/beach)
        if (propertyType.toUpperCase() === 'FISHING_WHARF' && !tile.settlement) {
            return { canBuild: false, reason: 'Requires a coastal settlement' };
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

            // Allow settlement-requiring buildings to be built on tiles adjacent to settlements
            const ADJACENT_OK_TYPES = [
                'workshop', 'brewery', 'grain_mill', 'bakery', 'forge', 'tannery', 'sawmill',
                'smokehouse', 'butcher', 'rope_walk', 'pottery_kiln', 'weaver', 'winery',
                'apothecary', 'fletcher', 'jeweler', 'dye_works', 'chandlery',
                'glassworks', 'scriptorium', 'blacksmith', 'perfumery',
                'clay_pit',
            ];
            if (!hasSettlement && ADJACENT_OK_TYPES.includes(prop.id)) {
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
                return { canBuild: false, reason: 'Requires a settlement (or adjacent to one for production buildings)' };
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

        // Create property object
        const constructionDays = prop.constructionDays || 0;
        const newProperty = {
            type: prop.id,
            name: prop.name,
            icon: prop.icon,
            produces,
            productionRate: prop.productionRate,
            upkeep: prop.upkeep || 0,
            level: 1,
            daysOwned: 0,
            storage: 0,
            inputStorage: 0, // For workshops
            activeRecipe: null, // For workshops
            autoSell: false,
            hasLab: false,   // Lab upgrade for technology research
            underConstruction: constructionDays > 0,
            constructionDaysLeft: constructionDays,
            constructionDaysTotal: constructionDays,
        };

        // Initialize playerProperties array if it doesn't exist
        if (!tile.playerProperties) {
            tile.playerProperties = [];
        }

        // Add property to tile's array
        tile.playerProperties.push(newProperty);

        // Also maintain the old playerProperty for backwards compatibility (use the first one)
        tile.playerProperty = tile.playerProperties[0];

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

        // Place property on inner map (assigns inner tile position and updates cache)
        // DISABLED: Inner map feature disabled
        // if (typeof InnerMap !== 'undefined') {
        //     InnerMap.placePropertyOnInnerMap(tile, newProperty, tile.q, tile.r);
        // }

        return { success: true, property: tile.playerProperty, underConstruction: constructionDays > 0, constructionDays };
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
            if (property.underConstruction) continue; // Still building

            // Handle retooling countdown (workshop/brewery recipe change)
            if (property.retooling) {
                property.retoolingDaysLeft = (property.retoolingDaysLeft || 0) - 1;
                if (property.retoolingDaysLeft <= 0) {
                    property.retooling = false;
                    property.retoolingDaysLeft = 0;
                }
                property.daysOwned = (property.daysOwned || 0) + 1;
                continue; // No production during retooling
            }

            // Tavern earns gold directly — handled separately
            if (property.type === 'tavern') {
                const upkeepCost = (property.upkeep || 0) * property.level;
                if (player.gold >= upkeepCost) {
                    player.gold -= upkeepCost;
                    // Calculate tavern income based on settlement size
                    let baseIncome = 15;
                    if (tile.settlement) {
                        const pop = tile.settlement.population || 50;
                        if (tile.settlement.type === 'capital') baseIncome = 35;
                        else if (tile.settlement.type === 'town') baseIncome = 25;
                        baseIncome += Math.floor(pop / 100) * 2; // +2g per 100 pop
                    }
                    // Level bonus
                    baseIncome = Math.floor(baseIncome * (1 + (property.level - 1) * 0.15));
                    // Commerce skill bonus
                    baseIncome = Math.floor(baseIncome * (1 + player.skills.commerce * 0.05));
                    // Beer/liquor stock bonus (if player has stocked the tavern)
                    const beerStock = property.beerStock || 0;
                    const liquorStock = property.liquorStock || 0;
                    if (beerStock > 0) {
                        baseIncome = Math.floor(baseIncome * 1.3);
                        property.beerStock = Math.max(0, beerStock - 2); // Consume 2 beer/day
                    }
                    if (liquorStock > 0) {
                        baseIncome = Math.floor(baseIncome * 1.2);
                        property.liquorStock = Math.max(0, liquorStock - 1); // Consume 1 liquor/day
                    }
                    // Gambling tables bonus
                    if (property.gamblingTables) {
                        baseIncome = Math.floor(baseIncome * (1 + property.gamblingTables * 0.15));
                    }
                    player.gold += baseIncome;
                    property.storage = (property.storage || 0) + baseIncome; // Track total earnings in storage
                    property.todayIncome = baseIncome;
                    production['tavern_income'] = (production['tavern_income'] || 0) + baseIncome;
                }
                property.daysOwned = (property.daysOwned || 0) + 1;
                continue;
            }

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

            // Technology production bonus
            if (typeof Technology !== 'undefined') {
                const techBonus = Technology.getProductionBonus(player, property.type);
                if (techBonus > 0) amount *= (1 + techBonus);
            }

            // Infrastructure irrigation bonus (for farms/irrigated farms)
            if (typeof Infrastructure !== 'undefined' && (property.type === 'farm' || property.type === 'irrigated_farm')) {
                const irrigBonus = Infrastructure.getIrrigationBonus(tile);
                if (irrigBonus > 0) amount *= (1 + irrigBonus);
            }

            amount = Math.floor(amount);

            let producedAmount = amount;
            let producedGood = property.produces;
            let consumedInput = false;

            // Workshop & Brewery & Specialized Buildings Specific Logic (recipe-based production)
            const RECIPE_BUILDINGS = [
                'workshop', 'brewery', 'grain_mill', 'bakery', 'forge', 'tannery', 'sawmill',
                'smokehouse', 'butcher', 'rope_walk', 'pottery_kiln', 'weaver', 'winery',
                'apothecary', 'fletcher', 'jeweler', 'dye_works', 'chandlery',
                'glassworks', 'scriptorium', 'blacksmith', 'perfumery',
            ];
            if (RECIPE_BUILDINGS.includes(property.type)) {
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
});
