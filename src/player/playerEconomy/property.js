// PlayerEconomy — property members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, WorldEvents, PlayerEffects, PlayerInventory, WEATHER_EFFECTS, Economy, Seasons } from './_imports.js';

Object.assign(PlayerEconomy, {
    /**
     * Definition for a property type id — base property types first, then
     * tech-unlocked buildings (whose ids differ from their keys).
     */
    getPropertyDef(type) {
        if (!type) return null;
        const key = String(type).toUpperCase();
        if (PlayerEconomy.PROPERTY_TYPES[key]) return PlayerEconomy.PROPERTY_TYPES[key];
        const tech = (typeof Technology !== 'undefined' && Technology.TECH_BUILDINGS) || {};
        return tech[key] || Object.values(tech).find(b => b.id === type) || null;
    },

    /**
     * What a property costs this player to build (stonecutting cuts it).
     * With a tile and world, stone and timber nearby cut it further
     * (resourceBonuses.construction).
     */
    getBuildCost(player, def, tile = null, world = null) {
        const reduction = (typeof Technology !== 'undefined') ? Technology.getBuildingCostReduction(player) : 0;
        const local = tile && world ? Economy.constructionModifiers(world, tile.q, tile.r).cost : 1;
        return Math.round(def.cost * (1 - reduction) * local);
    },

    /** Days to build `def` here: stone and timber nearby speed the work. */
    getConstructionDays(def, tile = null, world = null) {
        const days = (def && def.constructionDays) || 0;
        return tile && world ? Economy.scaleBuildDays(days, world, tile.q, tile.r) : days;
    },

    /** Does this property type turn inputs into outputs via recipes? */
    isRecipeBuilding(type) {
        const def = PlayerEconomy.getPropertyDef(type);
        return !!(def && (def.recipeBased || Array.isArray(def.allowedRecipes)));
    },

    /** Every player property on a tile (a tile can hold one of each type). */
    getPropertiesAt(tile) {
        if (!tile) return [];
        if (tile.playerProperties && tile.playerProperties.length > 0) return tile.playerProperties;
        return tile.playerProperty ? [tile.playerProperty] : [];
    },

    /** The player's property of a given type on a tile, or null. */
    findPropertyAt(tile, type) {
        return PlayerEconomy.getPropertiesAt(tile).find(p => p.type === type) || null;
    },

    /**
     * Check if player can build a property at a location
     */
    canBuildProperty(player, propertyType, tile, world) {
        const prop = PlayerEconomy.PROPERTY_TYPES[propertyType.toUpperCase()];
        if (!prop) return { canBuild: false, reason: 'Invalid property type' };

        // Check gold
        const cost = PlayerEconomy.getBuildCost(player, prop, tile, world);
        if (player.gold < cost) {
            return { canBuild: false, reason: `Need ${cost} gold (have ${player.gold})` };
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

            // Production buildings may sit on a tile adjacent to a settlement
            const adjacentOk = PlayerEconomy.isRecipeBuilding(prop.id) || prop.allowAdjacentSettlement;
            if (!hasSettlement && adjacentOk) {
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
        player.gold -= PlayerEconomy.getBuildCost(player, prop, tile, world);

        // Determine what this property produces
        let produces = prop.produces;
        if (prop.id === 'mine' && tile.resource) {
            produces = tile.resource.id; // Mine produces whatever resource is there
        }

        // Create property object
        const constructionDays = PlayerEconomy.getConstructionDays(prop, tile, world);
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

        return { success: true, property: newProperty, underConstruction: constructionDays > 0, constructionDays };
    },

    /** Properties you can run before administrative overhead sets in. */
    ADMIN_FREE_PROPERTIES: 6,
    /** Extra upkeep per property beyond that, and the most it can add. */
    ADMIN_OVERHEAD_PER_PROPERTY: 0.03,
    ADMIN_OVERHEAD_CAP: 0.60,

    /**
     * Administration: a sprawling estate costs more to run. Every property
     * past ADMIN_FREE_PROPERTIES adds 3% to all property upkeep (max +60%);
     * administration technology (Writing's "administrationBonus") trims it.
     * Returns the upkeep multiplier (>= 1).
     */
    getAdministrationMultiplier(player) {
        const count = (player.properties || []).length;
        const excess = Math.max(0, count - PlayerEconomy.ADMIN_FREE_PROPERTIES);
        const overhead = Math.min(PlayerEconomy.ADMIN_OVERHEAD_CAP, excess * PlayerEconomy.ADMIN_OVERHEAD_PER_PROPERTY);
        const admin = (typeof Technology !== 'undefined') ? Technology.getEffectTotal(player, 'administrationBonus') : 0;
        return 1 + overhead * Math.max(0, 1 - admin);
    },

    /** Daily upkeep of one property, including administrative overhead. */
    getPropertyUpkeep(player, property) {
        const base = (property.upkeep || 0) * (property.level || 1);
        return Math.round(base * PlayerEconomy.getAdministrationMultiplier(player));
    },

    /** Base goods a property can hold per level, before technology. */
    STORAGE_PER_LEVEL: 100,

    /**
     * How many goods a property's storage holds. Collect, ship or auto-sell
     * before it fills — production beyond this is lost. The Granary technology
     * ("storageBonus") enlarges every store.
     */
    getStorageCapacity(player, property) {
        const bonus = (typeof Technology !== 'undefined') ? Technology.getStorageBonus(player) : 0;
        return Math.floor(PlayerEconomy.STORAGE_PER_LEVEL * (property.level || 1) * (1 + bonus));
    },

    /**
     * Produce goods from all properties
     */
    produceGoods(player, world) {
        if (!player.properties || player.properties.length === 0) return {};

        const production = {};

        // Raw producers run first so a recipe building on the same tile can
        // draw on today's harvest (e.g. a Mill beside a Farm).
        const refs = [...player.properties].sort((a, b) =>
            PlayerEconomy.isRecipeBuilding(a.type) - PlayerEconomy.isRecipeBuilding(b.type));

        for (const prop of refs) {
            const tile = world.getTile(prop.q, prop.r);
            // A tile can hold several property types — match this entry's own
            const property = PlayerEconomy.findPropertyAt(tile, prop.type);
            if (!property) continue;
            if (property.underConstruction) continue; // Still building
            // Sabotaged or raided by a rival House (systems/schemes.js)
            if (property.sabotagedDays > 0) {
                property.sabotagedDays--;
                property.daysOwned = (property.daysOwned || 0) + 1;
                continue;
            }
            const def = PlayerEconomy.getPropertyDef(property.type);

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
                const upkeepCost = PlayerEconomy.getPropertyUpkeep(player, property);
                if (player.gold >= upkeepCost) {
                    player.gold -= upkeepCost;
                    // Calculate tavern income based on settlement size
                    let baseIncome = 15;
                    if (tile.settlement) {
                        const pop = tile.settlement.population || 50;
                        if (tile.settlement.type === 'capital') baseIncome = 35;
                        else if (tile.settlement.type === 'town') baseIncome = 25;
                        // +2g per 100 pop, up to +40: a capital of 15,000 used to
                        // add 300g a day, repaying a 900g tavern in three days
                        baseIncome += Math.min(40, Math.floor(pop / 100) * 2);
                    }
                    // Level bonus
                    baseIncome = Math.floor(baseIncome * (1 + (property.level - 1) * 0.15));
                    // Commerce skill bonus
                    baseIncome = Math.floor(baseIncome * (1 + player.skills.commerce * 0.05));
                    // Beer/liquor stock bonus (if player has stocked the tavern)
                    const beerStock = property.beerStock || 0;
                    const liquorStock = property.liquorStock || 0;
                    // Currency minting: steadier coin, better takings
                    baseIncome = Math.floor(baseIncome * (1 + Technology.getEffectTotal(player, 'propertyIncomeBonus')));
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
                    // Prosperity miracle and a House Steward
                    baseIncome = Math.floor(baseIncome * PlayerEffects.propertyIncomeMultiplier(player));
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

            // Coal-fired forges, herds beside ranches and dairies, oil for
            // chandlers (data/economy.json propertyResourceBonuses). Recipe
            // buildings get it on their output below.
            const resBonus = Economy.propertyResourceBonus(world, tile, property.type).bonus;
            const isRecipe = PlayerEconomy.isRecipeBuilding(property.type);
            if (resBonus > 0 && !isRecipe) amount *= 1 + resBonus;

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

            // Timed world events: droughts/harvests hit farms, gold rushes boost mines.
            // A Granary within a hex adds +20% and halves bad-harvest losses.
            if (def && def.category === 'farming') {
                const granary = Technology.hasBuildingNear(player, world, 'granary', tile.q, tile.r, 1);
                let farmMod = WorldEvents.getModifier(world, 'farmProduction', tile);
                // Today's weather: rain waters the fields, snow and heat wither them
                // (irrigation shields crops from heat waves)
                if (world.weather) {
                    const wx = world.weather.getWeather(tile.q, tile.r);
                    const irrigated = wx.type === 'heatwave' && Infrastructure.getIrrigationBonus(tile) > 0;
                    if (!irrigated) farmMod += WEATHER_EFFECTS[wx.type]?.farmProduction || 0;
                }
                if (granary && farmMod < 0) farmMod /= 2;
                amount *= Math.max(0, 1 + farmMod + (granary ? 0.2 : 0));
            }
            if (property.type === 'mine' || property.type === 'quarry') amount *= Math.max(0, 1 + WorldEvents.getModifier(world, 'mineProduction', tile));

            // Water-wheel bonus for mills built on a river
            if (def && def.riverBonus && tile.hasRiver) amount *= (1 + def.riverBonus);

            // Prosperity miracle and a House Steward
            amount *= PlayerEffects.propertyIncomeMultiplier(player);
            // Bountiful Harvest miracle
            if (def && def.category === 'farming') amount *= PlayerEffects.farmProductionMultiplier(player);

            // The agricultural year (world/seasons.js): farms sow in spring and
            // reap in autumn, herds, orchards, lodges and fleets have their own
            // curves. Yearly mean 1; fractions carry over so totals hold.
            if (Seasons.propertyCurve(property.type)) {
                amount = amount * Seasons.propertyMultiplier(property.type, Seasons.today(world)) + (property.seasonCarry || 0);
                const whole = Math.floor(amount);
                property.seasonCarry = Math.round((amount - whole) * 1000) / 1000;
                amount = whole;
            }

            amount = Math.floor(amount);

            // Pay upkeep first — an unpaid property idles and keeps its inputs
            const upkeepCost = PlayerEconomy.getPropertyUpkeep(player, property);
            if (player.gold < upkeepCost) {
                property.daysOwned++;
                continue;
            }
            player.gold -= upkeepCost;

            let producedAmount = amount;
            let producedGood = property.produces;

            // Recipe-based production (workshops, mills, bakeries, ...)
            if (PlayerEconomy.isRecipeBuilding(property.type)) {
                if (!property.activeRecipe) {
                    producedAmount = 0; // No recipe, no production
                } else {
                    const recipe = PlayerEconomy.RECIPES[property.activeRecipe];
                    if (recipe) {
                        // Check input storage
                        const inputNeeded = recipe.inputQty;
                        const outputQty = recipe.outputQty;

                        // Calculate desired runs based on production rate (which we treat as number of runs or output? Let's treat rate as raw output capacity)
                        // But for simplicity, let's say rate = number of recipe runs per day?
                        // Or rate = amount of output units? 
                        // Let's stick to rate = output units.
                        // So desired runs = amount / outputQty

                        let runs = Math.floor(amount / outputQty);
                        if (runs < 1) runs = 1; // Minimum 1 run if rate allows at least something? Or maybe strict.

                        // Draw missing input straight from sibling properties on
                        // this tile that produce it (Farm -> Mill -> Bakery chains)
                        PlayerEconomy._pullInputFromNeighbours(tile, property, recipe.input,
                            runs * inputNeeded - (property.inputStorage || 0));

                        const maxRuns = Math.floor((property.inputStorage || 0) / inputNeeded);
                        const actualRuns = Math.min(runs, maxRuns);

                        if (actualRuns > 0) {
                            property.inputStorage -= actualRuns * inputNeeded;
                            producedAmount = actualRuns * outputQty;
                            producedGood = recipe.output;
                            // Steel Forging: better smithing yields more weapons from the same iron
                            // (fractional output rounds up by chance)
                            const weaponsBonus = recipe.output === 'weapons' ? Technology.getEffectTotal(player, 'weaponsCraftBonus') : 0;
                            if (weaponsBonus > 0) {
                                const boosted = producedAmount * (1 + weaponsBonus);
                                producedAmount = Math.floor(boosted) + (Utils.random() < boosted % 1 ? 1 : 0);
                            }
                            // A local resource (coal for the forge, ...) stretches the
                            // same inputs further; fractions carry over to the next day
                            if (resBonus > 0) {
                                const boosted = producedAmount * (1 + resBonus) + (property.resourceCarry || 0);
                                producedAmount = Math.floor(boosted);
                                property.resourceCarry = boosted - producedAmount;
                            }
                        } else {
                            producedAmount = 0; // Not enough input
                        }
                    }
                }
            }

            // Storage is finite: output beyond capacity spoils or is given away
            property.wastedToday = 0;
            if (producedAmount > 0) {
                const room = Math.max(0, PlayerEconomy.getStorageCapacity(player, property) - (property.storage || 0));
                const stored = Math.min(producedAmount, room);
                property.wastedToday = producedAmount - stored;
                producedAmount = stored;
            }
            if (producedAmount > 0) {
                property.storage = (property.storage || 0) + producedAmount;
                production[producedGood] = (production[producedGood] || 0) + producedAmount;
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
                    // Auto-selling into the harvest glut fetches harvest prices
                    const income = Math.floor(sellAmount * good.basePrice * 0.5
                        * Seasons.priceMultiplier(good.id, Seasons.today(world)));
                    player.gold += income;
                    property.storage = 0;
                }
            }
        }

        return production;
    },

    /**
     * Move up to `need` units of `goodId` from the storage of other
     * properties on the same tile into a recipe building's input storage.
     */
    _pullInputFromNeighbours(tile, property, goodId, need) {
        if (need <= 0) return;
        for (const sib of PlayerEconomy.getPropertiesAt(tile)) {
            if (need <= 0) break;
            if (sib === property || sib.underConstruction || sib.produces !== goodId || !(sib.storage > 0)) continue;
            const take = Math.min(need, sib.storage);
            sib.storage -= take;
            property.inputStorage = (property.inputStorage || 0) + take;
            need -= take;
        }
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
            const property = PlayerEconomy.findPropertyAt(tile, prop.type);
            if (!property) continue;
            // Taverns pay out gold directly — their storage only tallies earnings
            if (!property.produces || property.produces === 'gold' || property.storage <= 0) continue;

            // Move from property storage to player inventory (stays put if the packs are full)
            const goodType = property.produces;
            if (!PlayerInventory.addItem(player, goodType, property.storage).success) continue;
            collected[goodType] = (collected[goodType] || 0) + property.storage;
            property.storage = 0;
        }

        return collected;
    },
});
