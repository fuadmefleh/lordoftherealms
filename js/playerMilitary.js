// ============================================
// PLAYER MILITARY — Military path systems
// ============================================

const PlayerMilitary = {
    /**
     * Unit types the player can recruit
     */
    UNIT_TYPES: {
        MILITIA: {
            id: 'militia',
            name: 'Militia',
            icon: '🗡️',
            cost: 50,
            upkeep: 2,
            strength: 5,
            description: 'Basic fighters, cheap but weak'
        },
        SOLDIER: {
            id: 'soldier',
            name: 'Soldier',
            icon: '⚔️',
            cost: 100,
            upkeep: 5,
            strength: 10,
            description: 'Trained warriors, reliable in battle'
        },
        KNIGHT: {
            id: 'knight',
            name: 'Knight',
            icon: '🛡️',
            cost: 300,
            upkeep: 15,
            strength: 30,
            description: 'Elite cavalry, devastating in combat'
        },
        ARCHER: {
            id: 'archer',
            name: 'Archer',
            icon: '🏹',
            cost: 80,
            upkeep: 4,
            strength: 8,
            description: 'Ranged attackers, good for defense'
        },
    },

    /**
     * Recruit a unit at a settlement
     */
    recruitUnit(player, unitType, settlement) {
        const unit = PlayerMilitary.UNIT_TYPES[unitType.toUpperCase()];
        if (!unit) return { success: false, reason: 'Invalid unit type' };

        // Check gold
        if (player.gold < unit.cost) {
            return { success: false, reason: `Need ${unit.cost} gold (have ${player.gold})` };
        }

        // Check settlement size
        if (settlement.type === 'village' && unit.id === 'knight') {
            return { success: false, reason: 'Villages cannot recruit knights' };
        }

        player.gold -= unit.cost;

        // Add to player's army
        if (!player.army) player.army = [];
        player.army.push({
            type: unit.id,
            name: unit.name,
            icon: unit.icon,
            strength: unit.strength,
            upkeep: unit.upkeep,
            experience: 0,
            level: 1,
        });

        // Increase combat skill
        player.skills.combat = Math.min(10, player.skills.combat + 0.3);

        return { success: true, unit };
    },

    /**
     * Calculate total army strength
     */
    getArmyStrength(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            let strength = unit.strength;
            // Level bonus
            strength *= (1 + (unit.level - 1) * 0.2);
            // Combat skill bonus
            strength *= (1 + player.skills.combat * 0.1);
            // Technology strength bonus
            if (typeof Technology !== 'undefined') {
                const techBonus = Technology.getUnitStrengthBonus(player, unit.type);
                if (techBonus > 0) strength *= (1 + techBonus);
            }
            total += strength;
        }

        return Math.floor(total);
    },

    /**
     * Calculate daily upkeep cost
     */
    getUpkeepCost(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            total += unit.upkeep;
        }
        return total;
    },

    /**
     * Pay army upkeep
     */
    payUpkeep(player) {
        const cost = PlayerMilitary.getUpkeepCost(player);

        if (player.gold < cost) {
            // Can't pay - lose some units
            const unitsLost = Math.ceil(player.army.length * 0.1);
            for (let i = 0; i < unitsLost; i++) {
                player.army.pop();
            }
            return { paid: false, unitsLost };
        }

        player.gold -= cost;
        return { paid: true, cost };
    },

    /**
     * Mercenary contract types
     */
    CONTRACT_TYPES: {
        GUARD_DUTY: {
            id: 'guard_duty',
            name: 'Guard Duty',
            icon: '🛡️',
            payment: 100,
            duration: 3,
            minStrength: 20,
            description: 'Guard a settlement for 3 days'
        },
        BANDIT_HUNT: {
            id: 'bandit_hunt',
            name: 'Bandit Hunt',
            icon: '🗡️',
            payment: 200,
            duration: 5,
            minStrength: 50,
            risk: 0.3,
            description: 'Hunt down bandits threatening trade routes'
        },
        ESCORT_CARAVAN: {
            id: 'escort_caravan',
            name: 'Escort Caravan',
            icon: '🚚',
            payment: 150,
            duration: 4,
            minStrength: 30,
            risk: 0.2,
            description: 'Protect a merchant caravan'
        },
        SIEGE_SUPPORT: {
            id: 'siege_support',
            name: 'Siege Support',
            icon: '🏰',
            payment: 500,
            duration: 10,
            minStrength: 100,
            risk: 0.5,
            description: 'Support a kingdom in a siege'
        },
    },

    /**
     * Accept a mercenary contract
     */
    acceptContract(player, contractType, settlement) {
        const contract = PlayerMilitary.CONTRACT_TYPES[contractType.toUpperCase()];
        if (!contract) return { success: false, reason: 'Invalid contract' };

        const strength = PlayerMilitary.getArmyStrength(player);
        if (strength < contract.minStrength) {
            return { success: false, reason: `Need army strength of ${contract.minStrength} (have ${strength})` };
        }

        if (player.activeContract) {
            return { success: false, reason: 'Already on a contract' };
        }

        player.activeContract = {
            type: contract.id,
            name: contract.name,
            payment: contract.payment,
            daysRemaining: contract.duration,
            risk: contract.risk || 0,
            settlement: settlement.name,
        };

        return { success: true, contract: player.activeContract };
    },

    /**
     * Update active contract
     */
    updateContract(player) {
        if (!player.activeContract) return null;

        player.activeContract.daysRemaining--;

        if (player.activeContract.daysRemaining <= 0) {
            // Contract complete!
            const contract = player.activeContract;

            // Check for casualties (if risky contract)
            let casualties = 0;
            if (contract.risk > 0 && Math.random() < contract.risk) {
                casualties = Math.ceil(player.army.length * Utils.randFloat(0.1, 0.3));
                for (let i = 0; i < casualties && player.army.length > 0; i++) {
                    player.army.pop();
                }
            } else {
                // Success - gain experience
                for (const unit of player.army) {
                    unit.experience += 10;
                    if (unit.experience >= 100 && unit.level < 5) {
                        unit.level++;
                        unit.experience = 0;
                        unit.strength = Math.floor(unit.strength * 1.2);
                    }
                }
            }

            // Pay player
            player.gold += contract.payment;

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.5);

            const result = {
                completed: true,
                contract,
                casualties,
                payment: contract.payment,
            };

            player.activeContract = null;
            return result;
        }

        return { completed: false, daysRemaining: player.activeContract.daysRemaining };
    },

    /**
     * Combat encounter (for random events or player-initiated)
     */
    combat(player, enemyStrength, enemyName = 'Bandits') {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength === 0) {
            return { victory: false, reason: 'No army to fight with!' };
        }

        // Combat calculation
        const playerPower = playerStrength * Utils.randFloat(0.8, 1.2);
        const enemyPower = enemyStrength * Utils.randFloat(0.8, 1.2);

        const victory = playerPower > enemyPower;

        // Calculate casualties
        const casualtyRate = victory ?
            Utils.randFloat(0.05, 0.15) :
            Utils.randFloat(0.2, 0.4);

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
            if (player.army.length === 0 && Math.random() < 0.4) {
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
        const roll = Math.random();

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

    /**
     * Raid a settlement (aggressive action)
     */
    raidSettlement(player, settlement, tile, world) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength < 30) {
            return { success: false, reason: 'Army too weak to raid (need 30+ strength)' };
        }

        // Settlement defense based on population and type
        const defenseMultiplier = {
            village: 0.5,
            town: 1.0,
            city: 2.0,
            capital: 3.0,
        };

        const defenseStrength = Math.floor(
            settlement.population * 0.02 * (defenseMultiplier[settlement.type] || 1)
        );

        // Combat
        const result = PlayerMilitary.combat(player, defenseStrength, settlement.name);

        if (result.victory) {
            // Successful raid
            const plunder = Math.floor(settlement.population * Utils.randFloat(0.5, 2));
            player.gold += plunder;
            result.plunder = plunder;

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
     * Attack a world unit on the player's tile
     */
    attackUnit(player, worldUnit, world) {
        const combatResult = PlayerMilitary.combat(player, worldUnit.strength, worldUnit.name);

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
};
