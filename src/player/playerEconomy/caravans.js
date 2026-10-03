// PlayerEconomy — caravans members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure } from './_imports.js';

Object.assign(PlayerEconomy, {
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
        if (toSettlement.isPlayerProperty && PlayerEconomy.isRecipeBuilding(toSettlement.type)) {
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
            daysRemaining: dist, // Still useful for estimate, but actual movement handled by unit
            status: 'traveling',
            isInternalTransfer,
            targetPropertyType: toSettlement.isPlayerProperty ? toSettlement.type : null,
            unitId: null // To be filled
        };

        // Spawn physical unit
        const caravanUnit = new WorldUnit('caravan', tile.q, tile.r, toSettlement.q, toSettlement.r);
        caravanUnit.playerOwned = true; // Mark as player's
        caravanUnit.goods = { ...goods }; // Give it the goods
        world.units.push(caravanUnit);
        caravan.unitId = caravanUnit.id;

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
        const completed = [];
        PlayerEconomy.ensureEconomyState(player);

        // Tick route and auction systems first (daily)
        PlayerEconomy._tickPersistentRoutes(player, world);
        const auctionEvents = PlayerEconomy._processAuctions(player, world);
        if (auctionEvents.length > 0) completed.push(...auctionEvents);

        if (!player.caravans || player.caravans.length === 0) return completed;

        for (let i = player.caravans.length - 1; i >= 0; i--) {
            const caravan = player.caravans[i];

            if (caravan.status === 'traveling') {
                // If using physical units
                if (caravan.unitId) {
                    const unit = world.units.find(u => u.id === caravan.unitId);

                    if (!unit) {
                        // Unit is gone! Likely destroyed by raiders or bug
                        // Check if it was robbed? World events would have logged it.
                        caravan.status = 'lost';
                        if (caravan.routeId) {
                            const routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                            if (routeRef) PlayerEconomy._recordRouteLoss(routeRef);
                            completed.push({
                                ...caravan,
                                finalProfit: 0,
                                status: 'lost',
                                message: `${caravan.from} → ${caravan.to} caravan was raided and lost.`,
                            });
                        }
                        // Maybe notify player here via return object?
                        // For now just remove
                        player.caravans.splice(i, 1);
                        continue;
                    }

                    // Update caravan position for UI tracking
                    caravan.currentPos = { q: unit.q, r: unit.r };

                    // Update remaining distance estimate
                    const dist = Hex.wrappingDistance(unit.q, unit.r, caravan.toPos.q, caravan.toPos.r, world.width);
                    caravan.daysRemaining = Math.ceil(dist / unit.speed);

                    if (unit.arrived) {
                        // Mark for completion processing below
                        // We handled the physical arrival, now handle the economic transaction
                        unit.destroyed = true; // Remove the physical unit now
                    } else if (unit.destroyed) {
                        caravan.status = 'lost';
                        if (caravan.routeId) {
                            const routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                            if (routeRef) PlayerEconomy._recordRouteLoss(routeRef);
                            completed.push({
                                ...caravan,
                                finalProfit: 0,
                                status: 'lost',
                                message: `${caravan.from} → ${caravan.to} caravan was destroyed en route.`,
                            });
                        }
                        player.caravans.splice(i, 1);
                        continue;
                    } else {
                        // Still traveling
                        continue;
                    }
                } else {
                    // Fallback for old saves or logical-only caravans (legacy)
                    caravan.daysRemaining--;
                    if (caravan.daysRemaining > 0) continue;
                }

                // processing completion (either physical arrival or legacy timer)
                caravan.status = 'completed';

                if (caravan.isInternalTransfer) {
                    // ... (existing logic)
                    const targetTile = world.getTile(caravan.toPos.q, caravan.toPos.r);
                    for (const [goodId, qty] of Object.entries(caravan.goods)) {
                        // Deliver to the building the caravan was sent to, else any
                        // processor on that tile whose recipe uses the good
                        const props = PlayerEconomy.getPropertiesAt(targetTile);
                        const needsGood = (p) => {
                            const recipe = p.activeRecipe && PlayerEconomy.RECIPES[p.activeRecipe];
                            return PlayerEconomy.isRecipeBuilding(p.type) && recipe && recipe.input === goodId;
                        };
                        const dest = props.find(p => p.type === caravan.targetPropertyType && needsGood(p))
                            || props.find(needsGood);
                        if (dest) {
                            dest.inputStorage = (dest.inputStorage || 0) + qty;
                        } else {
                            // Recipe changed en route — hand the goods to the player rather than lose them
                            if (!player.inventory) player.inventory = {};
                            player.inventory[goodId] = (player.inventory[goodId] || 0) + qty;
                        }
                    }
                    completed.push({ ...caravan, finalProfit: 0 });
                } else {
                    // ... (existing commercial logic)
                    // Recalculate based on current market prices
                    let marketValue = 0;
                    for (const [goodId, qty] of Object.entries(caravan.goods)) {
                        const currentPrice = MarketDynamics.getPrice(goodId);
                        marketValue += currentPrice * qty;
                    }

                    const dist = Hex.wrappingDistance(caravan.fromPos.q, caravan.fromPos.r, caravan.toPos.q, caravan.toPos.r, world.width);
                    const distanceMultiplier = 1 + (dist * 0.05); // 5% per hex

                    const targetTile = world.getTile(caravan.toPos.q, caravan.toPos.r);
                    let settlementMultiplier = 1.0;
                    if (targetTile && targetTile.settlement) {
                        if (targetTile.settlement.type === 'capital') settlementMultiplier = 1.5;
                        else if (targetTile.settlement.type === 'city') settlementMultiplier = 1.2;
                    }

                    let grossRevenue = Math.floor(marketValue * distanceMultiplier * settlementMultiplier);

                    let routeRef = null;
                    if (caravan.routeId) {
                        routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                        if (routeRef) {
                            const prosperityBonus = 1 + (routeRef.prosperity || 0) * 0.04;
                            const roadBonus = 1 + (routeRef.roadQuality || 0) * 0.06;
                            grossRevenue = Math.floor(grossRevenue * prosperityBonus * roadBonus);

                            if (caravan.isSmugglingRoute) {
                                const smuggleMultiplier = 1.35 + (routeRef.prosperity || 0) * 0.05;
                                grossRevenue = Math.floor(grossRevenue * smuggleMultiplier);
                            }
                        }
                    }

                    const bonus = 1 + player.skills.commerce * 0.05;
                    let finalProfit = Math.floor(grossRevenue * bonus);

                    let smuggleCaught = false;
                    if (caravan.isSmugglingRoute && routeRef) {
                        const stealth = player.skills?.stealth || 1;
                        const caughtChance = Math.max(0.06, Math.min(0.62,
                            0.28 + dist * 0.01 - stealth * 0.02 - (routeRef.protection || 0) * 0.03
                        ));

                        if (Utils.random() < caughtChance) {
                            smuggleCaught = true;
                            const confiscated = Math.floor(finalProfit * (0.35 + Utils.random() * 0.2));
                            finalProfit = Math.max(0, finalProfit - confiscated);

                            const fine = Math.min(player.gold, Math.floor(confiscated * 0.4));
                            player.gold -= fine;
                            player.karma = (player.karma || 0) - 2;
                            if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                            player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;

                            if (targetTile && targetTile.settlement && targetTile.settlement.kingdom && player.reputation) {
                                player.reputation[targetTile.settlement.kingdom] = (player.reputation[targetTile.settlement.kingdom] || 0) - 4;
                            }
                        }
                    }

                    // Commerce techs (trade networks, guilds, ...) raise caravan returns
                    if (finalProfit > 0 && typeof Technology !== 'undefined') {
                        finalProfit = Math.floor(finalProfit * (1 + Technology.getTradeProfitBonus(player)));
                    }
                    player.gold += finalProfit;
                    if (finalProfit > 0) Quests.track(player, 'trade_profit', finalProfit);
                    completed.push({
                        ...caravan,
                        finalProfit,
                        status: smuggleCaught ? 'smuggling_caught' : 'completed',
                        message: smuggleCaught
                            ? `${caravan.from} → ${caravan.to}: guards intercepted part of the shipment.`
                            : `${caravan.from} → ${caravan.to}: route delivered successfully.`,
                    });

                    if (routeRef) {
                        PlayerEconomy._recordRouteSuccess(routeRef, finalProfit);
                    }

                    // Track for quests
                    Quests.trackCaravanCompleted(player);

                    // Increase commerce skill
                    player.skills.commerce = Math.min(10, player.skills.commerce + 0.2);
                }

                // Remove from active caravans
                player.caravans.splice(i, 1);
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
            if (Utils.random() < 0.2) {
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
    setWorkshopRecipe(tile, recipeId, player) {
        if (!tile.playerProperty || !PlayerEconomy.isRecipeBuilding(tile.playerProperty.type)) return { success: false, reason: 'This property does not process goods' };

        const prop = tile.playerProperty;
        const isChange = prop.activeRecipe && prop.activeRecipe !== recipeId;

        // If changing recipe (not first selection), charge retooling cost
        if (isChange && player) {
            const propType = PlayerEconomy.getPropertyDef(prop.type) || {};
            const baseCost = propType.recipeChangeCost || 150;
            const retoolingCost = Math.floor(baseCost * prop.level);

            if (player.gold < retoolingCost) {
                return { success: false, reason: `Need ${retoolingCost} gold to retool workshop` };
            }

            player.gold -= retoolingCost;

            // Return old input storage to player inventory
            if (prop.inputStorage > 0 && prop.activeRecipe) {
                const oldRecipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                if (oldRecipe && player.inventory) {
                    player.inventory[oldRecipe.input] = (player.inventory[oldRecipe.input] || 0) + prop.inputStorage;
                }
                prop.inputStorage = 0;
            }

            // Set retooling downtime
            const retoolingDays = propType.retoolingDays || 2;
            prop.retooling = true;
            prop.retoolingDaysLeft = retoolingDays;
        }

        prop.activeRecipe = recipeId;
        const recipe = PlayerEconomy.RECIPES[recipeId];
        if (recipe) {
            prop.produces = recipe.output;
        }
        return { success: true, wasChange: isChange };
    },

    /**
     * Deposit goods into workshop input storage
     */
    depositToWorkshop(player, tile, goodId, amount) {
        if (!tile.playerProperty || !PlayerEconomy.isRecipeBuilding(tile.playerProperty.type)) return { success: false, reason: 'This property does not process goods' };

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
        const wharf = PlayerEconomy.findPropertyAt(tile, 'fishing_wharf');
        if (!wharf) return { success: false, reason: 'Not a fishing wharf' };

        const cost = 50;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        // Limit boats per wharf
        const activeBoats = world.units.filter(u =>
            u.type === 'fishing_boat' &&
            u.sourceQ === tile.q &&
            u.sourceR === tile.r &&
            !u.destroyed
        );

        if (activeBoats.length >= wharf.level) {
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
});
