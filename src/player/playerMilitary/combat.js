// PlayerMilitary — combat members (split from the original monolith).
import { PlayerMilitary } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { Companions } from '../../systems/companions.js';
import { Underworld } from '../../systems/underworld.js';
import { Utils, Technology, House, Quests, RealmWars, PlayerEffects, Housing, Culture, PlayerReligion, PlayerInventory, WorldEvents, WEATHER_EFFECTS } from './_imports.js';

Object.assign(PlayerMilitary, {
    /**
     * Combat encounter (for random events or player-initiated)
     */
    combat(player, enemyStrength, enemyName = 'Bandits', context = {}) {
        // Who fights depends on the theatre: inland, war galleys stay at sea;
        // at a port they blockade; on the water they lead (see theatreWeights)
        const theatre = context.theatre || 'land';
        const strengthParts = PlayerMilitary.getTheatreStrengthBreakdown(player, theatre);
        const playerStrength = strengthParts.total;

        if (playerStrength === 0) {
            const onlyShips = theatre === 'land' && (player.army || []).length > 0
                && (player.army || []).every(u => PlayerMilitary.isNavalUnit(u));
            return {
                victory: false,
                reason: onlyShips ? 'Your war galleys cannot fight on land — recruit soldiers.' : 'No army to fight with!',
            };
        }

        const terrainId = context.terrainId || null;
        const playerComp = PlayerMilitary.getArmyComposition(player);
        const enemyComp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName, context);

        const playerCounterMult = PlayerMilitary._counterMultiplier(playerComp, enemyComp);
        const enemyCounterMult = PlayerMilitary._counterMultiplier(enemyComp, playerComp);
        const playerTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, playerComp);
        const enemyTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, enemyComp);
        // Rain spoils bowstrings, snow bogs down horses — for both sides
        const weatherType = PlayerMilitary._battleWeather(player, context);
        const playerWeatherMult = PlayerMilitary._weatherMultiplier(weatherType, playerComp);
        const enemyWeatherMult = PlayerMilitary._weatherMultiplier(weatherType, enemyComp);

        const festivalMoraleBonus = (player.festivals?.moraleBoostDays > 0)
            ? (player.festivals?.moraleBoostValue || 0)
            : 0;
        // Theaters you own keep the troops' spirits up (needs context.world)
        const theaterMoraleBonus = Culture.getMoraleBonus(player, context.world);
        const leadership = (player.skills?.leadership || 1) * 0.015 + festivalMoraleBonus + theaterMoraleBonus
            + PlayerMilitary._worldEventMorale(player, context)
            + PlayerEffects.artifactBonus(player, 'moraleBonus');
        const playerMorale = PlayerMilitary._moraleValue(playerStrength, enemyStrength, leadership);
        const enemyMorale = PlayerMilitary._moraleValue(enemyStrength, playerStrength, context.enemyMoraleBonus || 0);

        // Combat calculation
        let playerPower = playerStrength * Utils.randFloat(0.8, 1.2) * playerCounterMult * playerTerrainMult * playerWeatherMult * playerMorale;
        // Fighting companions in the travel party
        playerPower *= 1 + PlayerEffects.companionBonus(player, 'power');
        // The Sword of the First King
        playerPower *= 1 + PlayerEffects.artifactBonus(player, 'battlePower');
        // An enchanted weapon from a legendary hoard
        playerPower *= 1 + PlayerEffects.treasureBonus(player, 'battlePower');
        // A commander in high spirits leads better; a miserable one worse
        playerPower *= PlayerEffects.moodCombatMultiplier(player);
        // The Valor tenet of the player's own faith
        playerPower *= PlayerEffects.faithBattleMultiplier(player);
        // Earned traits (Brave, Craven, Sea Wolf, Champion…)
        playerPower *= PlayerEffects.traitBattleMultiplier(player);
        // Fortification techs help when the player is the one attacked
        if (context.defending) playerPower *= 1 + Technology.getDefenseBonus(player);
        // A fortified house (watchtower, fortification upgrades) adds +1% per point of defense
        if (context.defending) playerPower *= 1 + Housing.getTotalBonuses(player).defense / 100;
        let enemyPower = enemyStrength * Utils.randFloat(0.8, 1.2) * enemyCounterMult * enemyTerrainMult * enemyWeatherMult * enemyMorale;

        // ── Unit specials & military techs ──
        // Siege engines, shield walls, longbow volleys, crossbow piercing,
        // plate armour, battle mages and assassins (see getBattleSpecials).
        const specials = PlayerMilitary.getBattleSpecials(player, context, playerComp, enemyComp);
        playerPower *= specials.playerMult;
        enemyPower *= specials.enemyMult;

        let moraleBreak = null;
        if (PlayerMilitary._checkMoraleBreak(playerStrength, enemyStrength, playerMorale)) {
            moraleBreak = 'player';
            Traits.recordDeed(player, 'cowardice', 2); // the army broke and ran
            playerPower *= 0.55;
            enemyPower *= 1.12;
        } else if (specials.commanderSlain || PlayerMilitary._checkMoraleBreak(enemyStrength, playerStrength, enemyMorale)) {
            moraleBreak = 'enemy';
            enemyPower *= 0.55;
            playerPower *= 1.12;
        }

        const victory = playerPower > enemyPower;
        // Travelling companions react to the outcome; with low odds one may fall
        Companions.onBattle(player, victory, { enemyName, roleOf: n => PlayerEffects.companionRole(n) }, context.world);

        // Calculate casualties
        let casualtyRate = victory ?
            Utils.randFloat(0.05, 0.15) :
            Utils.randFloat(0.2, 0.4);

        if (moraleBreak === 'enemy' && victory) casualtyRate *= 0.65;
        // Surgery saves soldiers who would otherwise be lost
        casualtyRate *= Math.max(0, 1 - Technology.getEffectTotal(player, 'battleCasualtyReduction'));
        if (moraleBreak === 'player' && !victory) casualtyRate *= 1.25;
        // Divine Protection: no one falls
        casualtyRate *= PlayerEffects.casualtyMultiplier(player);
        // Plate armour turns blows that would have killed
        casualtyRate *= specials.casualtyMult;

        // Only units that took the field can fall (galleys stay out of land battles)
        const fighting = () => player.army.filter(u => PlayerMilitary._theatreParticipant(u, theatre));
        const casualtyCount = Math.ceil(fighting().length * casualtyRate);

        // Surgery: each would-be casualty may be carried off wounded instead
        const woundedChance = Technology.getEffectTotal(player, 'woundedRecoveryBonus');
        const woundedUnits = [];
        let casualties = 0;
        for (let i = 0; i < casualtyCount; i++) {
            const candidates = fighting();
            if (candidates.length === 0) break;
            const unit = candidates[candidates.length - 1];
            player.army.splice(player.army.lastIndexOf(unit), 1);
            if (woundedChance > 0 && Utils.random() < woundedChance) {
                unit.woundedDays = PlayerMilitary.WOUNDED_DAYS;
                woundedUnits.push(unit);
                continue;
            }
            casualties++;
            // The fallen are remembered — Resurrection can call them back
            PlayerReligion.recordFallenUnit(player, unit);
        }
        player.army.push(...woundedUnits.reverse());

        // Rewards for victory
        let loot = 0;
        if (victory) {
            loot = Math.floor(enemyStrength * Utils.randFloat(2, 5));
            player.gold += loot;

            // Experience for the survivors who fought
            for (const unit of fighting()) {
                unit.experience += 5;
                if (unit.experience >= 100 && unit.level < 5) {
                    unit.level++;
                    unit.experience = 0;
                    unit.strength = Math.floor(unit.strength * 1.2);
                }
            }

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.3);
            player.renown += Math.floor(enemyStrength / 10 * (1 + PlayerMilitary._worldEventRenownBonus(player, context)));
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
            wounded: woundedUnits.length,
            loot,
            enemyName,
            playerStrength,
            enemyStrength,
            commanderSlain: specials.commanderSlain,
            theatre,
            navalSupport: strengthParts.naval,
            shipSupport: strengthParts.ship,
            tactics: {
                terrainId,
                weather: weatherType,
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
            Traits.recordDeed(player, 'deceit', 2);
            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.5);
            return result;
        } else {
            // Failed escape — punishment
            servitude.daysRemaining += Utils.randInt(2, 5);
            servitude.escapeChance = Math.max(0.05, servitude.escapeChance - 0.02); // Harder next time
            player.health = Math.max(10, player.health - PlayerEffects.scaleDamage(player, Utils.randInt(5, 15)));
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
        Traits.recordDeed(player, 'honesty', 1); // paid the debt rather than fled
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
        // At a port, war galleys blockade the harbour and join the fight
        const theatre = PlayerMilitary.settlementTheatre(world, tile);
        const playerStrength = PlayerMilitary.getTheatreStrength(player, theatre);

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
            world,
            siege: true, // siege engines batter the defences
            theatre,
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
            Traits.recordAggression(player, settlement.kingdom, { cruelty: 3, greed: 2, dread: 2 });
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 20;
            }

            // Reduce settlement population
            settlement.population = Math.floor(settlement.population * 0.9);
            House.accrueRivalFeud(player, world, settlement.kingdom, 10, `raided ${settlement.name}`);
        } else {
            // Failed raid - even worse reputation
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 30;
            }
            player.karma -= 3;
            House.accrueRivalFeud(player, world, settlement.kingdom, 5, `attempted raid on ${settlement.name}`);
        }

        return result;
    },

    /**
     * Attack a settlement to conquer it.
     * Harder than raiding — the entire garrison must be defeated.
     */
    attackSettlement(player, settlement, tile, world) {
        // At a port, war galleys blockade the harbour and join the siege
        const theatre = PlayerMilitary.settlementTheatre(world, tile);
        const playerStrength = PlayerMilitary.getTheatreStrength(player, theatre);

        if (PlayerMilitary.getArmyStrength(player) === 0) {
            return { success: false, reason: 'You have no land army! Recruit soldiers first — galleys alone cannot take a town.' };
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
            world,
            siege: true, // siege engines breach the walls
            theatre,
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
            Traits.recordAggression(player, previousKingdom, { cruelty: 2 });
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
            world,
            defending: !!opts.defending,
            // Aboard ship or on the water the fight is at sea
            theatre: PlayerMilitary.tileTheatre(
                typeof player.q === 'number' ? world.getTile(player.q, player.r) : unitTile, player),
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
        let lootLeftBehind = null;

        if (combatResult.victory) {
            // Transfer unit inventory to player
            if (worldUnit.inventory) {
                // Coin goes straight to the purse (it used to sit in the packs as
                // an 'item' nothing ever spent)
                const { gold: coin = 0, ...goods } = worldUnit.inventory;
                if (coin > 0) player.gold = (player.gold || 0) + coin;
                // Loot that doesn't fit in the player's packs is left behind
                const loot = PlayerInventory.addItems(player, goods);
                inventoryLoot = coin > 0 ? { gold: coin, ...loot.added } : loot.added;
                if (loot.full) lootLeftBehind = loot.dropped;
            }

            // Destroy the unit
            worldUnit.destroyed = true;
            if (worldUnit.type === 'war_host') RealmWars.onHostDefeated(player, world, worldUnit);

            Quests.track(player, 'battles_won');
            if (worldUnit.type === 'raider' || worldUnit.type === 'pirate') Quests.track(player, 'raiders_defeated');
            if (worldUnit.type === 'pirate') Quests.track(player, 'pirates_defeated');
            if (worldUnit.type === 'monster') Quests.track(player, 'special_creatures_defeated');
            // A win while badly hurt counts as a close call
            if (player.health < (player.maxHealth || 100) * 0.2) Quests.track(player, 'close_calls');

            // Karma/reputation effects by unit type
            switch (worldUnit.type) {
                case 'caravan':
                case 'ship':
                case 'fishing_boat':
                    karmaChange = -3;
                    Traits.recordDeeds(player, { greed: 2, cruelty: 1, seafaring: worldUnit.type === 'caravan' ? 0 : 2 }); // piracy
                    Quests.track(player, 'piracy_committed'); // companions with values notice
                    // Banditry and piracy against a realm's traders: underworld heat
                    if (worldUnit.type === 'caravan') Underworld.recordCrime(player, world, 'theft', { kingdom: worldUnit.kingdom || worldUnit.kingdomId || Underworld._nearestKingdom(world, worldUnit.q, worldUnit.r), scale: 2 });
                    else Underworld.recordPiracy(player, world, worldUnit.q, worldUnit.r);
                    player.karma += karmaChange;
                    break;
                case 'settler':
                    karmaChange = -5;
                    Traits.recordDeed(player, 'cruelty', 2);
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
                    Traits.recordAggression(player, worldUnit.kingdom, { dread: 1 });
                    player.karma += karmaChange;
                    // Anger the patrol's kingdom
                    if (worldUnit.kingdom) {
                        player.reputation[worldUnit.kingdom] =
                            (player.reputation[worldUnit.kingdom] || 0) - 25;
                    }
                    break;
                case 'pilgrim_group':
                case 'refugee':
                case 'diplomatic_envoy':
                    // Preying on the defenceless or on envoys is dishonourable
                    karmaChange = -8;
                    Traits.recordDeeds(player, { cruelty: 4, dread: 1 });
                    player.karma += karmaChange;
                    break;
                case 'smuggler':
                    karmaChange = 1;
                    player.karma += karmaChange;
                    break;
                case 'beast':
                    renownChange = Math.floor(worldUnit.strength / 6) + 1;
                    player.renown += renownChange;
                    break;
                case 'monster':
                    karmaChange = 3;
                    renownChange = 40;
                    player.karma += karmaChange;
                    player.renown += renownChange;
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
            lootLeftBehind,
        };
    },

    // ── Weather on the battlefield ─────────────────────────────────────
    /** Weather type at the player's position (context.weather overrides). */
    _battleWeather(player, context = {}) {
        if (context.weather) return context.weather;
        const world = context.world;
        if (!world || !world.weather || typeof player.q !== 'number') return 'clear';
        return world.weather.getWeather(player.q, player.r).type;
    },

    /** Power multiplier for an army's composition fighting in this weather. */
    _weatherMultiplier(weatherType, composition) {
        const fx = WEATHER_EFFECTS[weatherType];
        if (!fx || !composition) return 1;
        const mult = 1 + (fx.archerPower || 0) * (composition.archer || 0)
            + (fx.cavalryPower || 0) * (composition.cavalry || 0);
        return Math.max(0.5, mult);
    },

    // ── World-event effects on battle (data/worldEvents.json) ──────────
    /** Morale from running events at the player's tile (festival +0.2, plague -0.2). */
    _worldEventMorale(player, context = {}) {
        return context.world ? WorldEvents.playerMoraleBonus(context.world, player) : 0;
    },

    /** Extra renown for victories while a monster sighting has the land on edge. */
    _worldEventRenownBonus(player, context = {}) {
        const world = context.world;
        if (!world || !world.getTile) return 0;
        return Math.max(0, WorldEvents.getModifier(world, 'renownBonus', world.getTile(player.q, player.r)));
    },
});
