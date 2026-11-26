// PlayerEconomy — caravans members.
import { PlayerEconomy } from './_ref.js';
import { LossBook } from '../../systems/lossBook.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { PlayerCoin } from '../playerCoin.js';
import { Utils, Hex, WorldUnit, Technology, Infrastructure, PlayerInventory } from './_imports.js';

Object.assign(PlayerEconomy, {
    /**
     * Start a caravan to sell goods at a distant settlement
     */
    startCaravan(player, fromPos, toSettlement, goods, world, opts = {}) {
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

        const maxRange = PlayerEconomy.caravanConfig().maxRange;
        if (dist > maxRange) {
            return { success: false, reason: `Destination too far (max ${maxRange} tiles)` };
        }

        // The hire: by the load's weight and the way (data/playerCaravans.json)
        const cost = PlayerEconomy.caravanFee(goods, dist);
        if (player.gold < cost) {
            return { success: false, reason: `Need ${Utils.formatGold(cost)} gold to hire the caravan` };
        }

        // The crowns' trade policy (systems/tradePolicy.js): an export ban
        // keeps the goods at home; goods from a realm under embargo at the
        // destination only a smuggler moves
        const fromTile = world.getTile(fromPos.q, fromPos.r);
        const destTown = PlayerEconomy._caravanDest(world, toSettlement);
        for (const [goodType, quantity] of Object.entries(goods)) {
            const block = PlayerEconomy._caravanPolicyBlock(player, world, (fromTile && fromTile.settlement) || fromTile, destTown, goodType, quantity);
            if (block) return { success: false, reason: block };
        }

        // What the destination can pay for the load today, capped by its
        // merchants' purse (the same reckoning as the sale on arrival)
        const preview = PlayerEconomy.caravanPreview(player, world, fromPos, toSettlement, goods, PlayerEconomy.caravanPreviewLots(player, goods));
        const expectedProfit = preview.payable || 0;

        // Deduct cost and goods (their bookings by realm go with them); the hire to the town it sets out from
        PlayerCoin.pay(world, player, cost, (fromTile && fromTile.settlement) || { q: fromPos.q, r: fromPos.r }, 'caravans');
        const lots = {};
        for (const [goodType, quantity] of Object.entries(goods)) {
            TradePolicy.addLots(lots, goodType, TradePolicy.takePlayerLots(player, goodType, quantity));
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
            fee: cost,
            findBuyer: opts.findBuyer != null ? !!opts.findBuyer : player.caravanFindBuyer !== false,
            daysRemaining: Math.ceil(dist / (2 * (1 + Technology.getEffectTotal(player, 'caravanSpeedBonus')))), // ~2 tiles/day
            status: 'traveling',
            lots,
        };
        // The wagons go at a walker's pace, the quickest way (days per hex,
        // data/travel.json: roads already counted, so no road-link shortcut)
        const walk = Infrastructure.routeDays(world, fromPos, toSettlement, null, 60);
        if (walk != null) {
            caravan.daysRemaining = Math.max(1, Math.ceil(walk / (1 + Technology.getEffectTotal(player, 'caravanSpeedBonus')) - 1e-9));
            caravan.daysByRoute = true;
        }

        PlayerEconomy._applyRoadLink(world, caravan, null);

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.3);

        return { success: true, caravan, preview, cost };
    },

    /**
     * Start a caravan specifically from property storage
     * toSettlement can be a Settlement OR a Player Property object (must have q, r, name, type)
     */
    startStorageCaravan(player, tile, toSettlement, world, opts = {}) {
        if (!tile.playerProperty) return { success: false, reason: 'No property here' };

        const property = tile.playerProperty;
        if (property.storage <= 0) return { success: false, reason: 'Storage is empty' };

        // Determine property output
        const outputGood = property.produces;
        if (!outputGood) return { success: false, reason: 'Nothing to ship' };

        const goods = {};
        goods[outputGood] = property.storage;

        const dist = Hex.wrappingDistance(
            tile.q, tile.r,
            toSettlement.q, toSettlement.r,
            world.width
        );

        if (dist > PlayerEconomy.caravanConfig().maxRange) return { success: false, reason: 'Destination too far' };

        // The hire: by the load's weight and the way (data/playerCaravans.json)
        const cost = PlayerEconomy.caravanFee(goods, dist);
        if (player.gold < cost) {
            return { success: false, reason: `Need ${Utils.formatGold(cost)} gold` };
        }
        // An export ban keeps the goods in the realm (systems/tradePolicy.js)
        const banned = TradePolicy.exportBlock(player, world, tile, PlayerEconomy._caravanDest(world, toSettlement) || toSettlement, outputGood);
        if (banned) return { success: false, reason: banned };

        // Booked as goods of the realm they were made in
        const lots = {};
        TradePolicy.book(lots, tile, outputGood, property.storage);

        // Calculate expected profit OR just mark as internal transfer
        let expectedProfit = 0;
        let isInternalTransfer = false;
        let preview = null;

        // Internal Transfer Logic: If destination is a Workshop owned by player
        if (toSettlement.isPlayerProperty && PlayerEconomy.isRecipeBuilding(toSettlement.type)) {
            isInternalTransfer = true;
            expectedProfit = 0; // No gold profit, materials transfer
        } else {
            // What the destination's merchants can pay for the load (their purse caps it)
            preview = PlayerEconomy.caravanPreview(player, world, tile, toSettlement, goods, lots);
            expectedProfit = preview.payable || 0;
        }

        // Deduct cost and storage; the hire to the property's town
        PlayerCoin.pay(world, player, cost, PlayerEconomy.propertyTown(world, tile, property) || { q: tile.q, r: tile.r }, 'caravans');
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
            fee: cost,
            findBuyer: opts.findBuyer != null ? !!opts.findBuyer : player.caravanFindBuyer !== false,
            homeProperty: { type: property.type },
            daysRemaining: dist, // Still useful for estimate, but actual movement handled by unit
            status: 'traveling',
            isInternalTransfer,
            targetPropertyType: toSettlement.isPlayerProperty ? toSettlement.type : null,
            unitId: null, // To be filled
            lots,
        };

        // Spawn physical unit
        const caravanUnit = new WorldUnit('caravan', tile.q, tile.r, toSettlement.q, toSettlement.r);
        caravanUnit.playerOwned = true; // Mark as player's
        // Trade networks speed caravans up
        caravanUnit.speed = (caravanUnit.speed || 1) * (1 + Technology.getEffectTotal(player, 'caravanSpeedBonus'));
        PlayerEconomy._applyRoadLink(world, caravan, caravanUnit);
        caravanUnit.goods = { ...goods }; // Give it the goods
        // ...and they are what rides on the wagons: a robber takes these (world/units.js), not a trader's stock from nowhere
        caravanUnit.inventory = { ...goods };
        world.units.push(caravanUnit);
        caravan.unitId = caravanUnit.id;

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        return { success: true, caravan, preview, cost };
    },

    /** Revenue bonus for a caravan whose whole journey runs along roads. */
    ROAD_TRADE_BONUS: 0.15,

    /**
     * Roads speed trade: if a road network links the caravan's start and
     * destination, it earns ROAD_TRADE_BONUS more, its wagon (if any) moves a
     * hex further each day and road wardens drive off half of all robbers;
     * a timer-only caravan arrives in two-thirds of the time.
     */
    _applyRoadLink(world, caravan, unit) {
        if (!world || !Infrastructure.hasRoadConnection(world, caravan.fromPos.q, caravan.fromPos.r, caravan.toPos.q, caravan.toPos.r)) return false;
        caravan.roadLinked = true;
        if (unit) {
            unit.speed = (unit.speed || 1) + 1;
            unit.roadLinked = true;
        } else if (typeof caravan.daysRemaining === 'number' && !caravan.daysByRoute) {
            caravan.daysRemaining = Math.max(1, Math.ceil(caravan.daysRemaining * 2 / 3));
        }
        return true;
    },

    /** The settlement on a caravan's destination hex (it carries the realm), or null. */
    _caravanDest(world, to) {
        const t = to && world && typeof world.getTile === 'function' ? world.getTile(to.q, to.r) : null;
        return (t && t.settlement) || null;
    },

    /**
     * Why the crowns stop `qty` of a good setting out from `from` for `dest`
     * (systems/tradePolicy.js), or null: the home realm's export ban, or
     * goods booked from a realm the destination embargoes.
     */
    _caravanPolicyBlock(player, world, from, dest, goodId, qty) {
        const banned = TradePolicy.exportBlock(player, world, from, dest, goodId);
        if (banned) return banned;
        if (!dest) return null;
        const check = TradePolicy.saleCheck(player, world, dest, goodId, qty);
        return check.ok ? null : check.reason;
    },

    /**
     * Upgrade a property
     */
    upgradeProperty(player, tile, world = null) {
        if (!tile.playerProperty) return { success: false, reason: 'No property' };

        const property = tile.playerProperty;
        if (property.level >= 5) return { success: false, reason: 'Max level reached' };

        const cost = Math.floor(PlayerEconomy.PROPERTY_TYPES[property.type.toUpperCase()].cost * 0.5 * (property.level + 1));

        if (player.gold < cost) return { success: false, reason: `Need ${Utils.formatGold(cost)} gold` };

        // (the builders are the property's town's)
        PlayerCoin.pay(world, player, cost, PlayerEconomy.propertyTown(world, tile, property) || { q: tile.q, r: tile.r }, 'worksBought');
        property.level++;

        return { success: true, level: property.level, cost };
    },

    /**
     * Update all player caravans
     */
    /**
     * A caravan's premium for hauling goods `dist` hexes: 1% a hex. The real
     * profit is the gap between what the goods cost where they're plentiful
     * and what they fetch where they're short (world/settlementMarket.js);
     * between two markets at par a short haul doesn't cover the hire
     * (docs/economy-balance.md).
     */
    caravanDistanceMultiplier(dist) {
        return 1 + Math.max(0, dist || 0) * 0.01;
    },

    /** Bigger markets pay a caravan more. */
    caravanSizeMultiplier(type) {
        return { capital: 1.2, city: 1.1 }[type] || 1.0;
    },

    /** A caravan lost on the road: the underwriters hear of it (systems/lossBook.js). */
    _reportCaravanLoss(player, world, caravan, cause) {
        const at = caravan.currentPos || caravan.fromPos || {};
        LossBook.report(player, world, {
            kind: 'caravan', cause, value: LossBook.saleValue(caravan.goods), ref: `car:${caravan.unitId || caravan.from}`,
            place: `${caravan.from} → ${caravan.to}`, q: at.q, r: at.r,
        });
    },

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

            // Waiting in a town short of coin: sell what its purse now covers
            if (caravan.status === 'selling') {
                if (PlayerEconomy._caravanWaitDay(player, world, caravan, completed)) player.caravans.splice(i, 1);
                continue;
            }

            if (caravan.status === 'traveling' || caravan.status === 'returning') {
                // If using physical units
                if (caravan.unitId) {
                    const unit = world.units.find(u => u.id === caravan.unitId);

                    if (!unit || (unit.destroyed && !unit.arrived)) {
                        // Unit is gone: robbed by raiders (world/units.js hands its load to them) or destroyed
                        caravan.status = 'lost';
                        PlayerEconomy._reportCaravanLoss(player, world, caravan, unit ? 'destroyed on the road' : 'raided on the road');
                        const routeRef = caravan.routeId ? PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute) : null;
                        if (routeRef) PlayerEconomy._recordRouteLoss(routeRef);
                        if (routeRef || caravan.legs) {
                            completed.push({
                                ...caravan,
                                finalProfit: 0,
                                status: 'lost',
                                message: `${caravan.from} → ${caravan.to} caravan was ${unit ? 'destroyed en route' : 'raided and lost'}${caravan.legs ? ` with ${PlayerEconomy._caravanList(caravan.goods)} unsold` : ''}.`,
                            });
                        }
                        player.caravans.splice(i, 1);
                        continue;
                    }

                    // Update caravan position for UI tracking
                    caravan.currentPos = { q: unit.q, r: unit.r };

                    // Update remaining distance estimate
                    const dist = Hex.wrappingDistance(unit.q, unit.r, caravan.toPos.q, caravan.toPos.r, world.width);
                    caravan.daysRemaining = Math.ceil(dist / unit.speed);

                    if (unit.arrived) {
                        // We handled the physical arrival, now handle the economic transaction
                        unit.destroyed = true; // Remove the physical unit now
                    } else {
                        // Still traveling
                        continue;
                    }
                } else {
                    // Fallback for old saves or logical-only caravans (legacy)
                    caravan.daysRemaining--;
                    if (caravan.daysRemaining > 0) continue;
                }

                // Home again with what no one bought
                if (caravan.status === 'returning') {
                    PlayerEconomy._caravanHome(player, world, caravan, completed);
                    player.caravans.splice(i, 1);
                    continue;
                }

                if (caravan.isInternalTransfer) {
                    caravan.status = 'completed';
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
                            // Recipe changed en route — hand the goods to the player rather than
                            // lose them (sold on the spot if the packs have no room)
                            PlayerInventory.addOrSell(player, { [goodId]: qty }, PlayerCoin.payerHere(world, player, caravan.toPos));
                        }
                    }
                    completed.push({ ...caravan, finalProfit: 0 });
                    player.caravans.splice(i, 1);
                    continue;
                }

                // A market: it buys what its merchants' purse covers, unit by
                // unit; the rest waits on the wagons (playerEconomy/caravanSales.js)
                if (PlayerEconomy._caravanArrive(player, world, caravan, completed)) player.caravans.splice(i, 1);
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
    setWorkshopRecipe(tile, recipeId, player, world = null) {
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

            PlayerCoin.pay(world, player, retoolingCost, PlayerEconomy.propertyTown(world, tile, prop) || { q: tile.q, r: tile.r }, 'worksBought');

            // Return old input storage to player inventory
            if (prop.inputStorage > 0 && prop.activeRecipe) {
                const oldRecipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                if (oldRecipe) {
                    // Returned to the packs, or sold off if there's no room for it
                    PlayerInventory.addOrSell(player, { [oldRecipe.input]: prop.inputStorage }, PlayerCoin.payerHere(world, player, tile));
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
        if (player.gold < cost) return { success: false, reason: `Need ${Utils.formatGold(cost)} gold` };

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

        PlayerCoin.pay(world, player, cost, PlayerEconomy.propertyTown(world, tile, wharf) || { q: tile.q, r: tile.r }, 'industry');

        // Create Unit
        const boat = new WorldUnit('fishing_boat', tile.q, tile.r, targetQ, targetR);
        // Explicitly set source on the boat instance
        boat.sourceQ = tile.q;
        boat.sourceR = tile.r;
        boat.homeWharf = { q: tile.q, r: tile.r }; // Reference to home
        // Deep Sea Fishing: bigger hauls per trip
        boat.catchMultiplier = 1 + Technology.getEffectTotal(player, 'fishProductionBonus');

        world.units.push(boat);

        return { success: true, boat };
    },
});
