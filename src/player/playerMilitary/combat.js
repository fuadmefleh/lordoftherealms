// PlayerMilitary — combat members (split from the original monolith).
import { PlayerMilitary } from './_ref.js';
import { Utils, Technology, House, Quests } from './_imports.js';

Object.assign(PlayerMilitary, {
    /**
     * Combat encounter (for random events or player-initiated)
     */
    combat(player, enemyStrength, enemyName = 'Bandits', context = {}) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength === 0) {
            return { victory: false, reason: 'No army to fight with!' };
        }

        const terrainId = context.terrainId || null;
        const playerComp = PlayerMilitary.getArmyComposition(player);
        const enemyComp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName, context);

        const playerCounterMult = PlayerMilitary._counterMultiplier(playerComp, enemyComp);
        const enemyCounterMult = PlayerMilitary._counterMultiplier(enemyComp, playerComp);
        const playerTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, playerComp);
        const enemyTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, enemyComp);

        const festivalMoraleBonus = (player.festivals?.moraleBoostDays > 0)
            ? (player.festivals?.moraleBoostValue || 0)
            : 0;
        const leadership = (player.skills?.leadership || 1) * 0.015 + festivalMoraleBonus;
        const playerMorale = PlayerMilitary._moraleValue(playerStrength, enemyStrength, leadership);
        const enemyMorale = PlayerMilitary._moraleValue(enemyStrength, playerStrength, context.enemyMoraleBonus || 0);

        // Combat calculation
        let playerPower = playerStrength * Utils.randFloat(0.8, 1.2) * playerCounterMult * playerTerrainMult * playerMorale;
        // Fortification techs help when the player is the one attacked
        if (context.defending) playerPower *= 1 + Technology.getDefenseBonus(player);
        let enemyPower = enemyStrength * Utils.randFloat(0.8, 1.2) * enemyCounterMult * enemyTerrainMult * enemyMorale;

        let moraleBreak = null;
        if (PlayerMilitary._checkMoraleBreak(playerStrength, enemyStrength, playerMorale)) {
            moraleBreak = 'player';
            playerPower *= 0.55;
            enemyPower *= 1.12;
        } else if (PlayerMilitary._checkMoraleBreak(enemyStrength, playerStrength, enemyMorale)) {
            moraleBreak = 'enemy';
            enemyPower *= 0.55;
            playerPower *= 1.12;
        }

        const victory = playerPower > enemyPower;

        // Calculate casualties
        let casualtyRate = victory ?
            Utils.randFloat(0.05, 0.15) :
            Utils.randFloat(0.2, 0.4);

        if (moraleBreak === 'enemy' && victory) casualtyRate *= 0.65;
        if (moraleBreak === 'player' && !victory) casualtyRate *= 1.25;

        const casualties = Math.ceil(player.army.length * casualtyRate);

        for (let i = 0; i < casualties && player.army.length > 0; i++) {
            player.army.pop();
        }

        // Rewards for victory
        let loot = 0;
        if (victory) {
            loot = Math.floor(enemyStrength * Utils.randFloat(2, 5));
            player.gold += loot;

            // Experience for survivors
            for (const unit of player.army) {
                unit.experience += 5;
                if (unit.experience >= 100 && unit.level < 5) {
                    unit.level++;
                    unit.experience = 0;
                    unit.strength = Math.floor(unit.strength * 1.2);
                }
            }

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.3);
            player.renown += Math.floor(enemyStrength / 10);
        } else {
            // Defeat — chance of capture and indentured servitude
            if (player.army.length === 0 && Utils.random() < 0.4) {
                // Player is captured! Enter indentured servitude
                const servitudeDays = Utils.randInt(5, 15);
                const captor = enemyName;
                player.indenturedServitude = {
                    captor: captor,
                    daysRemaining: servitudeDays,
                    totalDays: servitudeDays,
                    dailyWage: 0, // Captors take your labor
                    goldConfiscated: Math.min(player.gold, Math.floor(player.gold * 0.3)),
                    canBuyFreedom: true,
                    freedomCost: 200 + Math.floor(enemyStrength * 2),
                    escapeChance: 0.1 + (player.skills.stealth || 0) * 0.03,
                };
                player.gold -= player.indenturedServitude.goldConfiscated;

                return {
                    victory: false,
                    casualties,
                    loot: 0,
                    enemyName,
                    playerStrength,
                    enemyStrength,
                    captured: true,
                    servitudeDays,
                    goldConfiscated: player.indenturedServitude.goldConfiscated,
                };
            }
        }

        return {
            victory,
            casualties,
            loot,
            enemyName,
            playerStrength,
            enemyStrength,
            tactics: {
                terrainId,
                moraleBreak,
                playerMorale: Number(playerMorale.toFixed(2)),
                enemyMorale: Number(enemyMorale.toFixed(2)),
                playerCounterMult: Number(playerCounterMult.toFixed(2)),
                enemyCounterMult: Number(enemyCounterMult.toFixed(2)),
                playerTerrainMult: Number(playerTerrainMult.toFixed(2)),
                enemyTerrainMult: Number(enemyTerrainMult.toFixed(2)),
            },
        };
    },

    /**
     * Process daily indentured servitude
     */
    processServitude(player, world) {
        if (!player.indenturedServitude) return null;

        const servitude = player.indenturedServitude;
        servitude.daysRemaining--;

        // Player can attempt escape each day
        const escaped = false;

        // Captors may force you to work their properties (generate small gold for them)
        // Player earns nothing but may gain skills
        player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        player.strength = Math.min(20, (player.strength || 5) + 0.1);

        // Movement is locked during servitude
        player.stamina = 0;
        player.movementRemaining = 0;

        if (servitude.daysRemaining <= 0) {
            // Freedom! Servitude period over
            const result = {
                freed: true,
                type: 'served',
                message: `Your period of indentured servitude under ${servitude.captor} has ended. You are free once more.`,
                daysServed: servitude.totalDays,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma += 2; // Sympathy karma
            return result;
        }

        return {
            freed: false,
            daysRemaining: servitude.daysRemaining,
            captor: servitude.captor,
            message: `You toil under ${servitude.captor}. ${servitude.daysRemaining} days of servitude remain.`,
        };
    },

    /**
     * Attempt to escape indentured servitude
     */
    attemptEscape(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };

        const servitude = player.indenturedServitude;
        const roll = Utils.random();

        if (roll < servitude.escapeChance) {
            // Successful escape!
            const result = {
                success: true,
                message: `You slipped away in the night and escaped ${servitude.captor}! You are free, but they may seek revenge.`,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma -= 1; // Minor karma hit for breaking contract
            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.5);
            return result;
        } else {
            // Failed escape — punishment
            servitude.daysRemaining += Utils.randInt(2, 5);
            servitude.escapeChance = Math.max(0.05, servitude.escapeChance - 0.02); // Harder next time
            player.health = Math.max(10, player.health - Utils.randInt(5, 15));
            return {
                success: false,
                message: `Your escape attempt failed! The guards caught you and beat you. +${servitude.daysRemaining - (servitude.totalDays - servitude.daysRemaining)} days added to your sentence.`,
                healthLost: true,
            };
        }
    },

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };
        if (!player.indenturedServitude.canBuyFreedom) return { success: false, reason: 'Captor refuses to negotiate' };

        const cost = player.indenturedServitude.freedomCost;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold (have ${player.gold})` };

        player.gold -= cost;
        const captor = player.indenturedServitude.captor;
        player.indenturedServitude = null;
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;

        return {
            success: true,
            message: `You paid ${cost} gold to ${captor} for your freedom. You are no longer bound.`,
            cost,
        };
    },

    /** Days a raided settlement needs before it has anything worth taking again. */
    RAID_COOLDOWN_DAYS: 30,

    /** Share of the garrison that turns out to fight off a raid (vs. a full siege). */
    RAID_DEFENSE_SHARE: 0.5,

    /**
     * Raid a settlement: fight part of its garrison, plunder, and withdraw.
     * Cheaper in karma/reputation than a siege but takes no territory, and a
     * settlement can only be raided once per RAID_COOLDOWN_DAYS.
     */
    raidSettlement(player, settlement, tile, world) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength < 30) {
            return { success: false, reason: 'Army too weak to raid (need 30+ strength)' };
        }
        const day = (world && world.day) || 0;
        if (settlement.lastRaidedDay != null && day - settlement.lastRaidedDay < PlayerMilitary.RAID_COOLDOWN_DAYS) {
            const wait = PlayerMilitary.RAID_COOLDOWN_DAYS - (day - settlement.lastRaidedDay);
            return { success: false, reason: `${settlement.name} was raided recently — nothing left to take for ${wait} more day(s)` };
        }

        const defenseStrength = Math.max(1, Math.floor(
            PlayerMilitary.getSettlementDefense(settlement, world) * PlayerMilitary.RAID_DEFENSE_SHARE));

        // Combat
        const result = PlayerMilitary.combat(player, defenseStrength, settlement.name, {
            terrainId: tile?.terrain?.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
        });

        result.defenseStrength = defenseStrength;
        if (result.victory) {
            // Successful raid
            const plunder = Math.floor(settlement.population * Utils.randFloat(0.5, 2));
            player.gold += plunder;
            result.plunder = plunder;
            settlement.lastRaidedDay = day;
            Quests.track(player, 'battles_won');

            // Negative karma and reputation
            player.karma -= 5;
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 20;
            }

            // Reduce settlement population
            settlement.population = Math.floor(settlement.population * 0.9);
        } else {
            // Failed raid - even worse reputation
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 30;
            }
            player.karma -= 3;
        }

        return result;
    },

    /**
     * Attack a settlement to conquer it.
     * Harder than raiding — the entire garrison must be defeated.
     */
    attackSettlement(player, settlement, tile, world) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength === 0) {
            return { success: false, reason: 'You have no army! Recruit soldiers first.' };
        }

        if (playerStrength < 50) {
            return { success: false, reason: 'Army too weak to siege a settlement (need 50+ strength)' };
        }

        // Settlement defense — stronger than raiding since garrison fights to the last
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        // Garrison = population-based defense + kingdom military contribution
        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        // Kingdom military reinforcements (if settlement belongs to a kingdom)
        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                // Capital gets 40% of kingdom military, other settlements get 15%
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        // Walls bonus for cities and capitals
        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3); // 30% wall bonus
        }

        // Combat
        const result = PlayerMilitary.combat(player, garrisonStrength, settlement.name, {
            terrainId: tile?.terrain?.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
            enemyMoraleBonus: settlement.type === 'capital' ? 0.1 : 0,
        });
        result.garrisonStrength = garrisonStrength;

        const previousKingdom = settlement.kingdom;

        if (result.victory) {
            // --- CONQUEST ---
            result.conquered = true;
            Quests.track(player, 'settlements_captured');

            // Plunder gold from the settlement
            const plunder = Math.floor(settlement.population * Utils.randFloat(1, 3));
            player.gold += plunder;
            result.plunder = plunder;

            // Population suffers from the siege
            settlement.population = Math.floor(settlement.population * 0.7);

            // Remove settlement from old kingdom
            if (previousKingdom) {
                const oldKingdom = world.getKingdom(previousKingdom);
                if (oldKingdom) {
                    // Remove from kingdom territory
                    oldKingdom.territory = oldKingdom.territory.filter(t =>
                        t.q !== tile.q || t.r !== tile.r
                    );
                    // Take military losses
                    const militaryLoss = settlement.type === 'capital' ? 0.3 : 0.1;
                    oldKingdom.military = Math.floor(oldKingdom.military * (1 - militaryLoss));
                    // Update population
                    oldKingdom.population = Math.max(0, oldKingdom.population - settlement.population);

                    // Check if this was their capital
                    if (oldKingdom.capital && oldKingdom.capital.q === tile.q && oldKingdom.capital.r === tile.r) {
                        result.capitalCaptured = true;
                        // Try to relocate capital to another settlement
                        const remainingSettlements = [];
                        for (const t of oldKingdom.territory) {
                            const kt = world.getTile(t.q, t.r);
                            if (kt && kt.settlement && kt.settlement.kingdom === previousKingdom) {
                                remainingSettlements.push(t);
                            }
                        }
                        if (remainingSettlements.length > 0) {
                            oldKingdom.capital = remainingSettlements[0];
                        } else {
                            // Kingdom destroyed!
                            oldKingdom.isAlive = false;
                            result.kingdomDestroyed = true;
                        }
                    }
                }
            }

            // Transfer ownership to the player's kingdom, or make independent
            if (player.allegiance) {
                settlement.kingdom = player.allegiance;
                tile.kingdom = player.allegiance;
                const playerKingdom = world.getKingdom(player.allegiance);
                if (playerKingdom) {
                    playerKingdom.territory.push({ q: tile.q, r: tile.r });
                    playerKingdom.population += settlement.population;
                }
                result.newOwner = playerKingdom ? playerKingdom.name : 'your kingdom';
            } else {
                // No allegiance — settlement becomes a player colony
                settlement.kingdom = null;
                tile.kingdom = null;
                if (!settlement.colony) settlement.colony = {};
                settlement.colony.isPlayerColony = true;
                settlement.colony.foundedDay = world.day;
                settlement.colony.loyalty = 30; // Low initial loyalty after conquest
                if (!player.colonies) player.colonies = [];
                player.colonies.push({ q: tile.q, r: tile.r, name: settlement.name, foundedDay: world.day });
                result.newOwner = 'you (independent colony)';
            }

            // Clear market stock (looted)
            settlement.marketStock = {};

            // Massive karma and reputation hit
            player.karma -= 10;
            result.karmaChange = -10;

            // Reputation with ALL kingdoms drops
            for (const k of world.kingdoms) {
                if (!k.isAlive) continue;
                const penalty = k.id === previousKingdom ? -50 : -10;
                player.reputation[k.id] = (player.reputation[k.id] || 0) + penalty;
            }

            // Renown boost
            const renownGain = settlement.type === 'capital' ? 50 :
                               settlement.type === 'city' ? 30 :
                               settlement.type === 'town' ? 15 : 5;
            player.renown += renownGain;
            result.renownChange = renownGain;

            // House Prestige — taking a settlement is a major dynastic deed.
            House.recordPlayerDeed(player, world, 'settlementHeld', {
                reason: `conquered ${settlement.name}`,
                chronicle: `${player.house ? player.house.name : 'The House'} conquers ${settlement.name}.`,
                tags: ['conquest', 'war'],
            });
            // Taking a kingdom's settlement inflames its rival House.
            House.accrueRivalFeud(player, world, previousKingdom, 25, `conquered ${settlement.name}`);

            world.events.push({
                text: `⚔️ ${player.name} has conquered ${settlement.name}!`,
                type: 'military'
            });
        } else {
            // --- DEFEAT ---
            result.conquered = false;

            // Reputation hit even for failed attack
            if (previousKingdom) {
                player.reputation[previousKingdom] =
                    (player.reputation[previousKingdom] || 0) - 30;
            }
            player.karma -= 5;
            result.karmaChange = -5;
        }

        return result;
    },

    /**
     * Get the garrison strength of a settlement for display purposes
     */
    getSettlementDefense(settlement, world) {
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3);
        }

        return garrisonStrength;
    },

    /**
     * Attack a world unit on the player's tile
     */
    attackUnit(player, worldUnit, world, opts = {}) {
        const unitTile = world.getTile(worldUnit.q, worldUnit.r);
        const combatResult = PlayerMilitary.combat(player, worldUnit.strength, worldUnit.name, {
            terrainId: unitTile?.terrain?.id,
            enemyComposition: PlayerMilitary._getWorldUnitComposition(worldUnit),
            defending: !!opts.defending,
        });

        // Handle no-army edge case
        if (combatResult.reason) {
            return {
                ...combatResult,
                noArmy: true,
                enemyName: worldUnit.name,
                karmaChange: 0,
                renownChange: 0,
                inventoryLoot: {},
            };
        }

        let karmaChange = 0;
        let renownChange = 0;
        let inventoryLoot = {};

        if (combatResult.victory) {
            // Transfer unit inventory to player
            if (worldUnit.inventory) {
                for (const [item, qty] of Object.entries(worldUnit.inventory)) {
                    if (qty > 0) {
                        if (!player.inventory) player.inventory = {};
                        player.inventory[item] = (player.inventory[item] || 0) + qty;
                        inventoryLoot[item] = qty;
                    }
                }
            }

            // Destroy the unit
            worldUnit.destroyed = true;

            Quests.track(player, 'battles_won');
            if (worldUnit.type === 'raider' || worldUnit.type === 'pirate') Quests.track(player, 'raiders_defeated');
            if (worldUnit.type === 'pirate') Quests.track(player, 'pirates_defeated');
            // A win while badly hurt counts as a close call
            if (player.health < (player.maxHealth || 100) * 0.2) Quests.track(player, 'close_calls');

            // Karma/reputation effects by unit type
            switch (worldUnit.type) {
                case 'caravan':
                case 'ship':
                case 'fishing_boat':
                    karmaChange = -3;
                    player.karma += karmaChange;
                    break;
                case 'settler':
                    karmaChange = -5;
                    player.karma += karmaChange;
                    break;
                case 'raider':
                case 'pirate':
                    karmaChange = 1;
                    renownChange = Math.floor(worldUnit.strength / 5) + 2;
                    player.karma += karmaChange;
                    player.renown += renownChange;
                    break;
                case 'patrol':
                    karmaChange = -2;
                    player.karma += karmaChange;
                    // Anger the patrol's kingdom
                    if (worldUnit.kingdom) {
                        player.reputation[worldUnit.kingdom] =
                            (player.reputation[worldUnit.kingdom] || 0) - 25;
                    }
                    break;
            }

            // Log event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} defeated a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        } else {
            // Log defeat event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} was defeated by a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        }

        return {
            ...combatResult,
            enemyName: combatResult.enemyName || worldUnit.name,
            karmaChange,
            renownChange,
            inventoryLoot,
        };
    },
});
