/**
 * Ships System
 * Allows the player to buy, build, customize, move, and use ships.
 * Supports exploration, piracy, pirate hunting, and sea trade.
 */
const Ships = {

    _nextId: 1,

    /* ── Data accessors ─────────────────────────────────────── */

    _getShipTypes() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.shipTypes)
            ? DataLoader.ships.shipTypes : [];
    },

    _getCustomizations() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.customizations)
            ? DataLoader.ships.customizations : [];
    },

    _getExplorationEvents() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.explorationEvents)
            ? DataLoader.ships.explorationEvents : [];
    },

    _getTradeGoods() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.tradeGoods)
            ? DataLoader.ships.tradeGoods : [];
    },

    _getSettings() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.settings)
            ? DataLoader.ships.settings : {
                usedShipConditionRange: [40, 85],
                usedShipPriceMultiplier: [0.4, 0.75],
                maxUsedShipsPerSettlement: 3,
                buildCostMultiplier: { village: 1.2, town: 1.0, capital: 0.9 },
                repairCostPerPercent: 0.005,
                conditionDecayChance: 0.04,
                shipMovementPerDay: 3,
                npcShipBuyChance: 0.02
            };
    },

    /* ── Type / customization lookups ────────────────────────── */

    getShipType(id) {
        return this._getShipTypes().find(s => s.id === id) || null;
    },

    getCustomization(id) {
        return this._getCustomizations().find(c => c.id === id) || null;
    },

    getAvailableCustomizations(shipTypeId) {
        const st = this.getShipType(shipTypeId);
        if (!st || !st.customizations) return [];
        return st.customizations.map(cid => this.getCustomization(cid)).filter(Boolean);
    },

    /* ── Player ship queries ─────────────────────────────────── */

    getShipById(player, shipId) {
        return (player.ships || []).find(s => s.id === shipId) || null;
    },

    /** Ships docked at a specific location */
    getShipsAt(player, q, r) {
        return (player.ships || []).filter(s => s.q === q && s.r === r && s.status === 'docked');
    },

    /** All player ships regardless of status */
    getAllShips(player) {
        return player.ships || [];
    },

    /* ── Used ships for sale ─────────────────────────────────── */

    getUsedShipsForSale(tile) {
        if (!tile || !tile.settlement) return [];
        if (tile._usedShips) return tile._usedShips;

        const settings = this._getSettings();
        const types = this._getShipTypes().filter(st => st.availableIn.includes(tile.settlement.type));
        const names = (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.usedShipNames) || ['Old Ship'];
        const descs = (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.usedShipDescriptions) || ['A used ship'];
        const maxUsed = settings.maxUsedShipsPerSettlement || 3;
        const ships = [];

        for (let i = 0; i < maxUsed; i++) {
            if (Math.random() > 0.5) continue; // ~50% chance per slot
            const st = types[Math.floor(Math.random() * types.length)];
            if (!st) continue;

            const condRange = settings.usedShipConditionRange || [40, 85];
            const condition = condRange[0] + Math.floor(Math.random() * (condRange[1] - condRange[0]));
            const priceRange = settings.usedShipPriceMultiplier || [0.4, 0.75];
            const priceMult = priceRange[0] + Math.random() * (priceRange[1] - priceRange[0]);
            const price = Math.floor(st.baseCost * priceMult * (condition / 100));

            ships.push({
                typeId: st.id,
                name: names[Math.floor(Math.random() * names.length)],
                description: descs[Math.floor(Math.random() * descs.length)],
                condition,
                price,
            });
        }

        tile._usedShips = ships;
        return ships;
    },

    /* ── Buying a used ship ──────────────────────────────────── */

    buyUsedShip(player, q, r, usedIndex) {
        const tile = (typeof game !== 'undefined') ? game.world.getTile(q, r) : null;
        const usedShips = tile ? this.getUsedShipsForSale(tile) : [];
        if (usedIndex < 0 || usedIndex >= usedShips.length) {
            return { success: false, message: 'Ship no longer available.' };
        }

        const used = usedShips[usedIndex];
        if (player.gold < used.price) {
            return { success: false, message: `Not enough gold. Need ${used.price}g.` };
        }

        player.gold -= used.price;
        if (!player.ships) player.ships = [];

        const ship = {
            id: 'ship_' + (Ships._nextId++),
            typeId: used.typeId,
            name: used.name,
            q, r,
            status: 'docked',
            condition: used.condition,
            customizations: [],
            cargo: {},
            dockedAt: tile && tile.settlement ? tile.settlement.name : 'Unknown',
            purchaseDay: (typeof game !== 'undefined') ? game.world.day : 0,
        };
        player.ships.push(ship);

        // Remove from used market
        usedShips.splice(usedIndex, 1);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + used.price;
        }

        const st = this.getShipType(used.typeId);
        return { success: true, message: `Purchased ${used.name} (${st ? st.name : 'ship'}) for ${used.price}g!` };
    },

    /* ── Commissioning a new ship ────────────────────────────── */

    commissionShip(player, q, r, typeId, name, customizationIds, world) {
        const st = this.getShipType(typeId);
        if (!st) return { success: false, message: 'Unknown ship type.' };

        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return { success: false, message: 'Must be at a settlement.' };

        const baseCost = this._getSettlementBuildCost(st.baseCost, tile.settlement);
        let totalCost = baseCost;

        // Add customization costs
        const validCustoms = [];
        for (const cid of (customizationIds || [])) {
            const c = this.getCustomization(cid);
            if (c && st.customizations && st.customizations.includes(cid)) {
                totalCost += c.cost;
                validCustoms.push(cid);
            }
        }

        if (player.gold < totalCost) {
            return { success: false, message: `Not enough gold. Need ${totalCost}g.` };
        }

        player.gold -= totalCost;
        if (!player.ships) player.ships = [];

        const ship = {
            id: 'ship_' + (Ships._nextId++),
            typeId,
            name: name || this._generateShipName(),
            q, r,
            status: 'building',
            condition: 100,
            customizations: validCustoms,
            cargo: {},
            dockedAt: tile.settlement.name,
            buildDaysLeft: st.buildDays,
            purchaseDay: world.day || 0,
        };
        player.ships.push(ship);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + totalCost;
        }

        return {
            success: true,
            message: `Commissioned ${st.icon} ${ship.name} for ${totalCost}g. Ready in ${st.buildDays} days.`
        };
    },

    /* ── Selling a ship ──────────────────────────────────────── */

    sellShip(player, shipId) {
        const idx = (player.ships || []).findIndex(s => s.id === shipId);
        if (idx === -1) return { success: false, message: 'Ship not found.' };

        const ship = player.ships[idx];
        if (ship.status !== 'docked') {
            return { success: false, message: 'Ship must be docked to sell.' };
        }

        const value = this.getShipValue(ship);
        const salePrice = Math.floor(value * 0.5);

        player.gold += salePrice;
        player.ships.splice(idx, 1);

        if (player.financeToday) {
            player.financeToday.income.shipSale = (player.financeToday.income.shipSale || 0) + salePrice;
        }

        return { success: true, message: `Sold ${ship.name} for ${salePrice}g.`, salePrice };
    },

    /* ── Ship value ──────────────────────────────────────────── */

    getShipValue(ship) {
        const st = this.getShipType(ship.typeId);
        const base = st ? st.baseCost : 200;
        const customValue = (ship.customizations || []).reduce((sum, cid) => {
            const c = this.getCustomization(cid);
            return sum + (c ? c.cost : 0);
        }, 0);
        return Math.floor((base + customValue) * (ship.condition / 100));
    },

    /* ── Ship repair ─────────────────────────────────────────── */

    getRepairCost(ship) {
        const st = this.getShipType(ship.typeId);
        const baseCost = st ? st.baseCost : 200;
        const settings = this._getSettings();
        const costPerPercent = settings.repairCostPerPercent || 0.005;
        const damage = 100 - ship.condition;
        return Math.max(5, Math.floor(baseCost * costPerPercent * damage));
    },

    repairShip(player, shipId) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.condition >= 100) return { success: false, message: 'Ship is in perfect condition.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked.' };

        const cost = this.getRepairCost(ship);
        if (player.gold < cost) return { success: false, message: `Need ${cost}g for repairs.` };

        player.gold -= cost;
        ship.condition = 100;

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + cost;
        }

        return { success: true, message: `Repaired ${ship.name} for ${cost}g.` };
    },

    /* ── Moving ships between ports ──────────────────────────── */

    moveShip(player, shipId, destQ, destR, destName, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked to move.' };

        const st = this.getShipType(ship.typeId);
        const dist = Hex.distance(ship.q, ship.r, destQ, destR);
        const speed = st ? st.speed : 3;
        const travelDays = Math.max(1, Math.ceil(dist / speed));

        ship.status = 'moving';
        ship.destQ = destQ;
        ship.destR = destR;
        ship.destinationName = destName;
        ship.travelDaysLeft = travelDays;

        return { success: true, message: `${ship.name} is sailing to ${destName}. ETA: ${travelDays} days.` };
    },

    /* ── Player sails on their ship ──────────────────────────── */

    sailPlayerTo(player, shipId, destQ, destR, destName, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked.' };

        const st = this.getShipType(ship.typeId);
        const dist = Hex.distance(ship.q, ship.r, destQ, destR);
        const speed = st ? st.speed : 3;
        const travelDays = Math.max(1, Math.ceil(dist / speed));
        const travelCost = travelDays * (st ? st.dailyUpkeep : 5);

        if (player.gold < travelCost) {
            return { success: false, message: `Need ${travelCost}g for the journey.` };
        }

        player.gold -= travelCost;

        // Teleport player and ship
        player.q = destQ;
        player.r = destR;
        ship.q = destQ;
        ship.r = destR;
        ship.dockedAt = destName;

        // Condition degrades slightly from travel
        ship.condition = Math.max(10, ship.condition - Math.floor(travelDays * 0.5));

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + travelCost;
        }

        return { success: true, message: `Sailed to ${destName} in ${travelDays} days for ${travelCost}g.` };
    },

    /* ── Sea activities ──────────────────────────────────────── */

    exploreOcean(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const st = this.getShipType(ship.typeId);
        const events = this._getExplorationEvents();
        if (events.length === 0) {
            return { success: true, icon: '🌊', title: 'Calm seas. Nothing of note found.', type: 'info' };
        }

        // Pick event by weighted chance
        const roll = Math.random();
        let cumulative = 0;
        let event = null;
        for (const e of events) {
            cumulative += e.chance;
            if (roll < cumulative) { event = e; break; }
        }
        if (!event) {
            // Default calm event
            return { success: true, icon: '🌊', title: 'You sail the open waters but find nothing interesting.', type: 'info' };
        }

        let resultText = event.description;
        let resultType = 'info';

        // Handle danger events
        if (event.danger) {
            if (event.danger.combatStrength) {
                const enemyStr = Array.isArray(event.danger.combatStrength)
                    ? event.danger.combatStrength[0] + Math.floor(Math.random() * (event.danger.combatStrength[1] - event.danger.combatStrength[0]))
                    : event.danger.combatStrength;
                const shipStr = this._getShipCombatStrength(ship);

                if (shipStr * (0.8 + Math.random() * 0.4) > enemyStr * (0.8 + Math.random() * 0.4)) {
                    resultText += ' You fought and won!';
                    resultType = 'success';
                    // Give rewards
                    if (event.reward) this._applyReward(player, event.reward);
                } else {
                    resultText += ' You were overwhelmed!';
                    resultType = 'error';
                    const dmg = event.danger.damage
                        ? (Array.isArray(event.danger.damage)
                            ? event.danger.damage[0] + Math.floor(Math.random() * (event.danger.damage[1] - event.danger.damage[0]))
                            : event.danger.damage)
                        : 10;
                    ship.condition = Math.max(5, ship.condition - dmg);
                    player.health = Math.max(1, player.health - Math.floor(dmg / 2));
                }
            } else if (event.danger.damage) {
                const dmg = Array.isArray(event.danger.damage)
                    ? event.danger.damage[0] + Math.floor(Math.random() * (event.danger.damage[1] - event.danger.damage[0]))
                    : event.danger.damage;
                ship.condition = Math.max(5, ship.condition - dmg);
                resultType = 'warning';
                resultText += ` Ship took ${dmg}% damage.`;
            }
        } else if (event.reward) {
            this._applyReward(player, event.reward);
            resultType = 'success';
        }

        // Slight condition wear from exploration
        ship.condition = Math.max(5, ship.condition - 1);

        return { success: true, icon: event.icon, title: resultText, type: resultType };
    },

    huntPirates(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const pirateStr = data.pirateStrength || { min: 8, max: 30 };
        const enemyStrength = pirateStr.min + Math.floor(Math.random() * (pirateStr.max - pirateStr.min));
        const shipStr = this._getShipCombatStrength(ship);

        // 50% chance to find pirates
        if (Math.random() < 0.5) {
            ship.condition = Math.max(5, ship.condition - 1);
            return {
                success: true,
                icon: '🌊',
                title: 'You patrol the waters but find no pirates today.',
                type: 'info'
            };
        }

        const playerPower = shipStr * (0.8 + Math.random() * 0.4);
        const enemyPower = enemyStrength * (0.8 + Math.random() * 0.4);

        if (playerPower > enemyPower) {
            const loot = enemyStrength * (2 + Math.floor(Math.random() * 4));
            player.gold += loot;
            player.karma = (player.karma || 0) + 2;
            player.renown = (player.renown || 0) + 3;
            ship.condition = Math.max(5, ship.condition - Math.floor(Math.random() * 5 + 2));

            if (player.financeToday) {
                player.financeToday.income.pirateBounty = (player.financeToday.income.pirateBounty || 0) + loot;
            }

            return {
                success: true,
                icon: '⚔️',
                title: `Victory! Defeated pirates (str ${enemyStrength}) and claimed ${loot}g bounty! +3 renown, +2 karma.`,
                type: 'success'
            };
        } else {
            const dmg = 5 + Math.floor(Math.random() * 15);
            ship.condition = Math.max(5, ship.condition - dmg);
            player.health = Math.max(1, player.health - Math.floor(dmg / 2));
            return {
                success: true,
                icon: '💀',
                title: `Defeated! The pirates were too strong (str ${enemyStrength}). Ship took ${dmg}% damage.`,
                type: 'error'
            };
        }
    },

    commitPiracy(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const karmaLoss = data.piracyKarmaLoss || 5;
        const renownLoss = data.piracyRenownLoss || 2;
        const goldRange = data.piracyGoldRange || [50, 300];

        // 60% chance to find a target
        if (Math.random() < 0.4) {
            ship.condition = Math.max(5, ship.condition - 1);
            return {
                success: true,
                icon: '🌊',
                title: 'You lurk the shipping lanes but no prey appears.',
                type: 'info'
            };
        }

        // Target merchant ship strength
        const targetStr = 3 + Math.floor(Math.random() * 12);
        const shipStr = this._getShipCombatStrength(ship);
        const playerPower = shipStr * (0.8 + Math.random() * 0.4);
        const targetPower = targetStr * (0.8 + Math.random() * 0.4);

        if (playerPower > targetPower) {
            const loot = goldRange[0] + Math.floor(Math.random() * (goldRange[1] - goldRange[0]));
            player.gold += loot;
            player.karma = (player.karma || 0) - karmaLoss;
            player.renown = Math.max(0, (player.renown || 0) - renownLoss);
            ship.condition = Math.max(5, ship.condition - Math.floor(Math.random() * 3 + 1));

            // Reputation loss with all kingdoms
            for (const kId of Object.keys(player.reputation || {})) {
                player.reputation[kId] = (player.reputation[kId] || 0) - 3;
            }

            if (player.financeToday) {
                player.financeToday.income.piracy = (player.financeToday.income.piracy || 0) + loot;
            }

            return {
                success: true,
                icon: '🏴‍☠️',
                title: `Plundered a merchant vessel for ${loot}g! -${karmaLoss} karma, -${renownLoss} renown. Your reputation suffers.`,
                type: 'warning'
            };
        } else {
            const dmg = 5 + Math.floor(Math.random() * 10);
            ship.condition = Math.max(5, ship.condition - dmg);
            player.karma = (player.karma || 0) - Math.floor(karmaLoss / 2);
            return {
                success: true,
                icon: '💀',
                title: `The merchant fought back hard! Failed to board. Ship took ${dmg}% damage.`,
                type: 'error'
            };
        }
    },

    doSeaTrade(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const goods = this._getTradeGoods();
        if (goods.length === 0) {
            return { success: true, icon: '💰', title: 'No trade opportunities available.', type: 'info' };
        }

        const st = this.getShipType(ship.typeId);
        const cargoSpace = st ? st.cargoCapacity : 10;

        // Simulate a quick trade run
        const good = goods[Math.floor(Math.random() * goods.length)];
        const buyPrice = good.buyPrice[0] + Math.floor(Math.random() * (good.buyPrice[1] - good.buyPrice[0]));
        const sellPrice = good.sellPrice[0] + Math.floor(Math.random() * (good.sellPrice[1] - good.sellPrice[0]));

        const maxUnits = Math.min(cargoSpace, Math.floor(player.gold / buyPrice));
        if (maxUnits <= 0) {
            return { success: true, icon: '💰', title: `Cannot afford ${good.name} at ${buyPrice}g each.`, type: 'warning' };
        }

        const units = Math.max(1, Math.floor(maxUnits * (0.3 + Math.random() * 0.7)));
        const cost = units * buyPrice;
        const revenue = units * sellPrice;
        const profit = revenue - cost;

        player.gold -= cost;
        player.gold += revenue;

        // Commerce skill gain
        if (player.skills) {
            const skillGain = Math.random() < 0.3 ? 0.1 : 0;
            if (skillGain > 0) {
                player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + skillGain);
            }
        }

        ship.condition = Math.max(5, ship.condition - 1);

        if (player.financeToday) {
            if (profit > 0) {
                player.financeToday.income.seaTrade = (player.financeToday.income.seaTrade || 0) + profit;
            } else {
                player.financeToday.expenses.seaTrade = (player.financeToday.expenses.seaTrade || 0) + Math.abs(profit);
            }
        }

        if (profit > 0) {
            return {
                success: true,
                icon: '💰',
                title: `Traded ${units} ${good.name}: bought at ${buyPrice}g, sold at ${sellPrice}g each. Profit: ${profit}g!`,
                type: 'success'
            };
        } else {
            return {
                success: true,
                icon: '📉',
                title: `Traded ${units} ${good.name} but the market was bad. Lost ${Math.abs(profit)}g.`,
                type: 'warning'
            };
        }
    },

    /* ── Daily processing ────────────────────────────────────── */

    processDaily(player, world) {
        const ships = player.ships || [];
        if (ships.length === 0) return;

        const settings = this._getSettings();
        let totalUpkeep = 0;

        for (const ship of ships) {
            const st = this.getShipType(ship.typeId);
            if (!st) continue;

            // Building progress
            if (ship.status === 'building') {
                ship.buildDaysLeft = (ship.buildDaysLeft || 1) - 1;
                if (ship.buildDaysLeft <= 0) {
                    ship.status = 'docked';
                    ship.buildDaysLeft = 0;
                    // Notification handled by caller if needed
                }
            }

            // Ship movement
            if (ship.status === 'moving') {
                ship.travelDaysLeft = (ship.travelDaysLeft || 1) - 1;
                if (ship.travelDaysLeft <= 0) {
                    ship.q = ship.destQ;
                    ship.r = ship.destR;
                    ship.dockedAt = ship.destinationName || 'Unknown';
                    ship.status = 'docked';
                    ship.travelDaysLeft = 0;
                    delete ship.destQ;
                    delete ship.destR;
                    delete ship.destinationName;
                }
            }

            // Daily upkeep
            totalUpkeep += st.dailyUpkeep;

            // Condition decay
            if (Math.random() < (settings.conditionDecayChance || 0.04)) {
                ship.condition = Math.max(10, ship.condition - 1);
            }
        }

        // Deduct total upkeep
        if (totalUpkeep > 0) {
            player.gold -= totalUpkeep;
            if (player.financeToday) {
                player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + totalUpkeep;
            }
        }
    },

    /* ── Combat helpers ──────────────────────────────────────── */

    _getShipCombatStrength(ship) {
        const st = this.getShipType(ship.typeId);
        let strength = st ? st.combatStrength : 5;

        // Add customization combat bonuses
        for (const cid of (ship.customizations || [])) {
            const c = this.getCustomization(cid);
            if (c && c.effects && c.effects.combatBonus) {
                strength += c.effects.combatBonus;
            }
        }

        // Condition penalty
        strength = Math.floor(strength * (ship.condition / 100));
        return Math.max(1, strength);
    },

    /* ── Reward helper ───────────────────────────────────────── */

    _applyReward(player, reward) {
        if (reward.gold) {
            const amt = Array.isArray(reward.gold)
                ? reward.gold[0] + Math.floor(Math.random() * (reward.gold[1] - reward.gold[0]))
                : reward.gold;
            player.gold += amt;
            if (player.financeToday) {
                player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + amt;
            }
        }
        if (reward.renown) player.renown = (player.renown || 0) + reward.renown;
        if (reward.karma) player.karma = (player.karma || 0) + reward.karma;
        if (reward.stamina) player.stamina = Math.min(player.maxStamina || 10, (player.stamina || 0) + reward.stamina);
        if (reward.luck) player.luck = (player.luck || 5) + reward.luck;
    },

    /* ── Name generation ─────────────────────────────────────── */

    _generateShipName() {
        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const prefixes = data.shipNamePrefixes || ['The', 'HMS'];
        const words = data.shipNameWords || ['Tempest', 'Horizon', 'Phoenix'];
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const word = words[Math.floor(Math.random() * words.length)];
        return `${prefix} ${word}`;
    },

    /* ── Price helpers ───────────────────────────────────────── */

    _getSettlementBuildCost(baseCost, settlement) {
        const settings = this._getSettings();
        const mults = settings.buildCostMultiplier || { village: 1.2, town: 1.0, capital: 0.9 };
        const m = mults[settlement.type] || 1.0;
        return Math.floor(baseCost * m);
    },

    /* ── Save / Load ─────────────────────────────────────────── */

    prepareForSave(player) {
        // ships[] on player is already serializable
        // Restore _nextId from ships array
        if (player.ships && player.ships.length > 0) {
            let maxId = 0;
            for (const s of player.ships) {
                const num = parseInt((s.id || '').replace('ship_', ''), 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            Ships._nextId = maxId + 1;
        }
    },

    restoreFromSave(player) {
        if (player.ships && player.ships.length > 0) {
            let maxId = 0;
            for (const s of player.ships) {
                const num = parseInt((s.id || '').replace('ship_', ''), 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            Ships._nextId = maxId + 1;
        }
    },
};
