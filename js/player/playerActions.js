// ============================================
// PLAYER ACTIONS — Contextual actions
// ============================================

const PlayerActions = {
    /**
     * Get available actions for a specific tile
     */
    getAvailableActions(player, tile, world) {
        const actions = [];

        // If player is in indentured servitude, only show servitude actions
        if (player.indenturedServitude) {
            const servitude = player.indenturedServitude;
            actions.push({
                type: 'servitude_wait',
                label: 'Endure Servitude',
                icon: '⛓️',
                description: `${servitude.daysRemaining} days remain under ${servitude.captor}. Work and wait for freedom.`
            });
            actions.push({
                type: 'servitude_escape',
                label: 'Attempt Escape',
                icon: '🏃',
                description: `Try to slip away (${Math.floor(servitude.escapeChance * 100)}% chance). Failure means punishment and extra days.`
            });
            if (servitude.canBuyFreedom && player.gold >= servitude.freedomCost) {
                actions.push({
                    type: 'servitude_buy_freedom',
                    label: 'Buy Your Freedom',
                    icon: '💰',
                    description: `Pay ${servitude.freedomCost} gold to end your servitude immediately.`
                });
            }
            return actions;
        }

        // 1. Rest (always available)
        actions.push({
            type: 'rest',
            label: 'Rest / Camp',
            icon: '⛺',
            description: 'Recover stamina and wait for the next day'
        });

        const isSettlement = !!tile.settlement;
        const isCity = isSettlement && (tile.settlement.type === 'town' || tile.settlement.type === 'capital');
        const isVillage = isSettlement && tile.settlement.type === 'village';

        // 2. Settlement Actions
        if (isSettlement) {
            // Trade
            actions.push({
                type: 'trade',
                label: 'Trade Goods',
                icon: '⚖️',
                description: 'Buy and sell resources'
            });

            // Recruit
            if (isCity) {
                actions.push({
                    type: 'recruit',
                    label: 'Recruit Units',
                    icon: '⚔️',
                    description: 'Hire soldiers for your army'
                });
            }

            // Contracts (Mercenaries)
            if (isCity || (isVillage && tile.settlement.population > 200)) {
                actions.push({
                    type: 'contract',
                    label: 'Mercenary Contracts',
                    icon: '📜',
                    description: 'Take on military work'
                });
            }

            // Preach
            actions.push({
                type: 'preach',
                label: 'Preach',
                icon: '🙏',
                description: 'Spread your faith and gain followers'
            });

            // Tavern / Talk to Locals
            if (isCity) {
                actions.push({
                    type: 'tavern',
                    label: 'Visit the Tavern',
                    icon: '🍺',
                    description: 'Buy drinks and gather rumors and intelligence'
                });
            } else {
                actions.push({
                    type: 'talk_locals',
                    label: 'Talk to Locals',
                    icon: '🗣️',
                    description: 'Chat with villagers to learn news'
                });
            }

            // Ship Passage (Coastal Settlements)
            const isCoastal = Hex.neighbors(tile.q, tile.r).some(n => {
                const nt = world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });

            if (isCoastal) {
                actions.push({
                    type: 'ship_passage',
                    label: 'Pay for Passage',
                    icon: '⛴️',
                    description: 'Hire a ship to travel to another coastal settlement'
                });

                // Shipyard actions at coastal settlements
                if (typeof Ships !== 'undefined') {
                    actions.push({
                        type: 'visit_shipyard',
                        label: 'Visit Shipyard',
                        icon: '⚓',
                        description: 'Buy, build, or manage ships at the docks'
                    });
                }

                // Board own ship if docked here
                const dockedShips = typeof Ships !== 'undefined' ? Ships.getShipsAt(player, tile.q, tile.r) : [];
                if (dockedShips.length > 0) {
                    actions.push({
                        type: 'board_ship',
                        label: 'Board Ship',
                        icon: '🚢',
                        description: 'Board one of your ships docked here'
                    });
                }
            }

            // Housing actions at settlements
            if (typeof Housing !== 'undefined') {
                const ownedHere = Housing.getHouseAt(player, tile.q, tile.r);
                if (!ownedHere) {
                    const available = Housing.getAvailableHouses(tile.settlement.type);
                    if (available.length > 0) {
                        actions.push({
                            type: 'buy_house',
                            label: 'Buy a House',
                            icon: '🏠',
                            description: 'Purchase a home in this settlement'
                        });
                    }
                } else {
                    actions.push({
                        type: 'manage_house',
                        label: 'Manage House',
                        icon: '🏠',
                        description: 'Upgrade, repair, or sell your property'
                    });
                }
            }

            // --- Early-Game Income: Settlement-based ---

            // Odd Jobs (always available in settlements)
            actions.push({
                type: 'odd_jobs',
                label: 'Look for Work',
                icon: '🔨',
                description: 'Take on a day job for modest pay'
            });

            // Bounty Board (settlements post small tasks)
            actions.push({
                type: 'bounty_board',
                label: 'Notice Board',
                icon: '📋',
                description: 'Check the notice board for paid tasks and bounties'
            });

            // Busking / Street Performance
            actions.push({
                type: 'busking',
                label: 'Street Performance',
                icon: '🎭',
                description: 'Perform in the streets for tips and coin'
            });

            // Gambling (taverns in cities, informal in villages)
            if (isCity) {
                actions.push({
                    type: 'gambling',
                    label: 'Gambling Den',
                    icon: '🎲',
                    description: 'Try your luck at games of chance'
                });
            } else if (isVillage) {
                actions.push({
                    type: 'gambling',
                    label: 'Dice Game',
                    icon: '🎲',
                    description: 'Join the locals for a friendly wager'
                });
            }

            // --- Social / Political ---

            // Donate / Charity (at settlements)
            if (player.gold >= 10) {
                actions.push({
                    type: 'donate',
                    label: 'Donate to the Poor',
                    icon: '🪙',
                    description: 'Give gold to the less fortunate for karma and reputation'
                });
            }

            // Pledge Allegiance (at capitals, if unaligned)
            if (isSettlement && tile.settlement.kingdom && !player.allegiance) {
                actions.push({
                    type: 'pledge_allegiance',
                    label: 'Pledge Allegiance',
                    icon: '🏛️',
                    description: `Swear fealty to the kingdom of ${tile.settlement.name}`
                });
            }

            // Renounce Allegiance (at any settlement, if aligned)
            if (isSettlement && player.allegiance) {
                actions.push({
                    type: 'renounce_allegiance',
                    label: 'Renounce Allegiance',
                    icon: '🚩',
                    description: 'Break your oath and become a free agent'
                });
            }

            // Host Feast (at cities/towns, costs gold)
            if (isCity && player.gold >= 200) {
                actions.push({
                    type: 'host_feast',
                    label: 'Host a Feast',
                    icon: '🍖',
                    description: 'Throw a grand feast to boost renown and reputation (200+ gold)'
                });
            }

            // Hold Tournament (at cities, costs gold, need army or combat skill)
            if (isCity && player.gold >= 300 && (player.skills?.combat >= 2 || (player.army && player.army.length > 0))) {
                actions.push({
                    type: 'hold_tournament',
                    label: 'Hold Tournament',
                    icon: '🏟️',
                    description: 'Organize a grand tournament for renown, gold prizes, and combat experience'
                });
            }

            // Pickpocket (stealth action at settlements)
            if (player.skills?.stealth >= 1) {
                actions.push({
                    type: 'pickpocket',
                    label: 'Pickpocket',
                    icon: '🤏',
                    description: 'Attempt to lift a purse from the crowd (risky)'
                });
            }

            // Smuggle Goods (at settlements with a kingdom border)
            if (isSettlement && tile.settlement.kingdom && player.skills?.stealth >= 2 && player.inventory) {
                const hasGoods = Object.keys(player.inventory).length > 0;
                if (hasGoods) {
                    actions.push({
                        type: 'smuggle',
                        label: 'Smuggle Goods',
                        icon: '🥷',
                        description: 'Sell goods on the black market for higher prices (risky)'
                    });
                }
            }

            // Train / Spar (at settlements with military)
            if (isCity) {
                actions.push({
                    type: 'train_combat',
                    label: 'Train at Barracks',
                    icon: '⚔️',
                    description: 'Spar with soldiers to improve combat skill'
                });
            }

            // --- Relationships ---

            // Meet People / Socialize (at any settlement)
            actions.push({
                type: 'meet_people',
                label: 'Meet People',
                icon: '👥',
                description: 'Get to know the locals — make friends, rivals, or romantic interests'
            });

            // View Relationships (if player knows anyone)
            if (player.relationships && Object.keys(player.relationships).length > 0) {
                actions.push({
                    type: 'view_relationships',
                    label: 'Relationships',
                    icon: '💕',
                    description: 'View your friends, rivals, loved ones, and family'
                });
            }

            // Manage Family / Heirs (if player has children)
            if (player.children && player.children.length > 0) {
                actions.push({
                    type: 'manage_dynasty',
                    label: 'Dynasty & Heirs',
                    icon: '👑',
                    description: 'View your family tree and designate an heir'
                });
            }

            // Fleet overview (if player owns ships)
            if (typeof Ships !== 'undefined' && player.ships && player.ships.length > 0) {
                actions.push({
                    type: 'manage_fleet',
                    label: 'Fleet Overview',
                    icon: '⚓',
                    description: 'View the status of all your ships'
                });
            }
        }

        // --- Wilderness & Anywhere Actions ---

        // Meditate / Pray (anywhere on passable terrain)
        if (tile.terrain.passable) {
            actions.push({
                type: 'meditate',
                label: tile.holySite ? 'Pray at Holy Site' : 'Meditate',
                icon: '🧘',
                description: tile.holySite
                    ? 'Pray here for greater spiritual benefit'
                    : 'Quiet your mind to restore health and gain karma'
            });
        }

        // Personal Fishing (at coast/lake/river adjacent tiles)
        if (tile.terrain.passable) {
            const nearWater = Hex.neighbors(tile.q, tile.r).some(n => {
                const nt = world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
            const isWaterTerrain = ['coast', 'beach'].includes(tile.terrain.id);
            if (nearWater || isWaterTerrain) {
                actions.push({
                    type: 'fish',
                    label: 'Go Fishing',
                    icon: '🎣',
                    description: 'Spend the day fishing — sell the catch or keep it as food'
                });
            }
        }

        // Prospect / Mine (hills, mountains, highlands)
        if (!tile.settlement && tile.terrain.passable) {
            const miningTerrains = ['hills', 'highlands', 'mountain'];
            if (miningTerrains.includes(tile.terrain.id)) {
                actions.push({
                    type: 'prospect',
                    label: 'Prospect',
                    icon: '⛏️',
                    description: 'Search for ore and minerals in the rock'
                });
            }
        }

        // Tame Horse (plains/grassland with horse resource)
        if (!tile.settlement && tile.terrain.passable && tile.resource && tile.resource.id === 'horses') {
            actions.push({
                type: 'tame_horse',
                label: 'Tame Wild Horse',
                icon: '🐴',
                description: 'Attempt to capture and tame a wild horse for faster travel'
            });
        }

        // Set up Camp / Craft (wilderness with wood)
        if (!tile.settlement && tile.terrain.passable && player.inventory) {
            const hasWood = (player.inventory.wood || 0) >= 2;
            if (hasWood) {
                actions.push({
                    type: 'craft_campfire',
                    label: 'Build Campfire',
                    icon: '🔥',
                    description: 'Use 2 wood to build a campfire — cook food and rest well (+extra health)'
                });
            }
        }

        // --- Early-Game Income: Wilderness-based ---

        // Foraging (non-settlement passable terrain)
        if (!tile.settlement && tile.terrain.passable) {
            const foragingTerrains = ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest',
                'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'steppe', 'savanna',
                'hills', 'highlands', 'mountain', 'coast', 'beach', 'desert', 'arid', 'semi_arid',
                'swamp', 'marsh', 'wetland', 'mangrove', 'tropical_wetland'];
            if (foragingTerrains.includes(tile.terrain.id)) {
                actions.push({
                    type: 'forage',
                    label: 'Forage',
                    icon: '🌿',
                    description: 'Search the area for herbs, berries, and useful materials'
                });
            }
        }

        // Hunting (wilderness with game)
        if (!tile.settlement && tile.terrain.passable) {
            const huntingTerrains = ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest',
                'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'steppe', 'savanna',
                'hills', 'highlands', 'coast', 'beach'];
            if (huntingTerrains.includes(tile.terrain.id)) {
                actions.push({
                    type: 'hunt',
                    label: 'Hunt',
                    icon: '🏹',
                    description: 'Hunt wild game for meat and pelts to sell'
                });
            }
        }

        // 2b. Explore Point of Interest
        if (tile.improvement) {
            // Ensure explored flag exists (for old saves)
            if (tile.improvement.explored === undefined) {
                tile.improvement.explored = false;
            }
            
            if (!tile.improvement.explored && tile.improvement.type !== 'treasure_cache') {
                actions.push({
                    type: 'explore_poi',
                    label: `Explore ${tile.improvement.name}`,
                    icon: '🔍',
                    description: 'Search this location for treasure, knowledge, or danger'
                });
            }
        }

        // 2c. Clear Trees (forest tiles without buildings)
        const forestTerrains = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
        if (forestTerrains.includes(tile.terrain.id) && !tile.settlement && !tile.playerProperty) {
            actions.push({
                type: 'clear_trees',
                label: 'Clear Trees',
                icon: '🪓',
                description: 'Fell the trees for wood and clear the land for farming'
            });
        }

        // 3. Building / Property Actions
        // Can build if tile is empty (no settlement, no existing property)
        // And terrain is valid (not water, etc. - checked in PlayerEconomy really, but roughly here)
        if ((!tile.settlement || tile.settlement.type) && !tile.playerProperty && !tile.structure && !tile.improvement && tile.terrain.passable) {
            actions.push({
                type: 'build_property',
                label: 'Build Property',
                icon: '🏗️',
                description: 'Construct a resource gathering building'
            });
        }

        // 4. Religious Actions
        // Build Temple (needs empty spot or inside own settlement?)
        // Let's say we can build temples in empty spots too, or perhaps specific spots.
        // For now, allow on empty tiles if player has a religion
        if ((!tile.settlement || tile.settlement.type) && !tile.playerProperty && !tile.improvement && tile.terrain.passable) {
            actions.push({
                type: 'build_temple',
                label: 'Build Temple',
                icon: '⛩️',
                description: 'Construct a place of worship'
            });
        }

        // 5. Property Interaction
        if (tile.playerProperty) {
            // Manage Action (covers collecting, upgrading, shipping)
            actions.push({
                type: 'manage_property',
                label: 'Manage Property',
                icon: '🛠️',
                description: 'Collect goods, upgrade, or send caravans'
            });

            // Collect goods shortcut (keep if convenient, or remove to force using manage)
            if (tile.playerProperty.produces && tile.playerProperty.storage && tile.playerProperty.storage > 0) {
                actions.push({
                    type: 'collect_goods',
                    label: 'Collect Goods',
                    icon: '📦',
                    description: `Collect stored ${tile.playerProperty.produces}`
                });
            }
        }

        // 5b. Build Infrastructure (roads, bridges, irrigation)
        if (typeof Infrastructure !== 'undefined' && typeof Technology !== 'undefined' && tile.terrain.passable) {
            const availableInfra = Infrastructure.getAvailableTypes(player, tile, world);
            if (availableInfra.length > 0) {
                actions.push({
                    type: 'build_infrastructure',
                    label: 'Build Infrastructure',
                    icon: '🛤️',
                    description: 'Construct roads, bridges, or irrigation'
                });
            }
        }

        // 5c. Demolish Infrastructure
        if (tile.infrastructure) {
            actions.push({
                type: 'demolish_infrastructure',
                label: `Demolish ${tile.infrastructure.name}`,
                icon: '🗑️',
                description: 'Remove infrastructure (25% refund)'
            });
        }

        // 5d. Cultural Buildings
        if (typeof Culture !== 'undefined' && tile.terrain.passable && !tile.culturalBuilding && !tile.playerProperty && !tile.religiousBuilding) {
            actions.push({
                type: 'build_cultural',
                label: 'Build Cultural Building',
                icon: '📚',
                description: 'Construct a library, theater, university, or monument'
            });
        }

        // 5e. Pilgrimage (at holy sites)
        if (typeof Religion !== 'undefined' && tile.holySite) {
            actions.push({
                type: 'pilgrimage',
                label: 'Visit Holy Site',
                icon: '⛲',
                description: `Visit ${tile.holySite.name} — gain gold, karma, and renown`
            });
        }

        // 5f. Colonization Actions
        if (typeof Colonization !== 'undefined') {
            // Found a colony on unclaimed wilderness
            if (Colonization.canPlayerFoundColony(player, tile, world, player.q, player.r).can) {
                actions.push({
                    type: 'found_colony',
                    label: 'Found Colony',
                    icon: '🏴',
                    description: `Establish a frontier colony here (${Colonization.COLONY_COST} gold)`
                });
            }

            // Send pioneers to distant wilderness (must be head of this settlement — player colony)
            if (player.gold >= 200 && tile.settlement && 
                tile.settlement.colony && tile.settlement.colony.isPlayerColony) {
                actions.push({
                    type: 'send_pioneers',
                    label: 'Send Pioneers',
                    icon: '🧭',
                    description: 'Dispatch a pioneering party to settle distant lands (200 gold)'
                });
            }

            // Manage existing colony
            if (tile.settlement && tile.settlement.colony && 
                (tile.settlement.colony.isPlayerColony || tile.settlement.kingdom === player.allegiance)) {
                actions.push({
                    type: 'manage_colony',
                    label: 'Manage Colony',
                    icon: '📋',
                    description: `Manage ${tile.settlement.name} — loyalty, garrison, indigenous relations`
                });
            }

            // Negotiate with indigenous population
            if (tile.indigenous && tile.indigenous.population > 0) {
                actions.push({
                    type: 'negotiate_indigenous',
                    label: 'Negotiate with Natives',
                    icon: '🤝',
                    description: `Meet with the ${tile.indigenous.tribeName} (${tile.indigenous.population} people)`
                });
            }
        }

        // 5g. Cartography Actions
        if (typeof Cartography !== 'undefined') {
            // Create a map (always available on passable terrain)
            if (tile.terrain.passable) {
                actions.push({
                    type: 'cartography',
                    label: 'Cartography',
                    icon: '🗺️',
                    description: 'Create maps, manage your collection, or trade maps'
                });
            }

            // Buy/sell maps at settlements
            if (tile.settlement) {
                actions.push({
                    type: 'map_trade',
                    label: 'Map Trader',
                    icon: '📜',
                    description: 'Buy or sell maps at this settlement'
                });
            }

            // Steal maps (stealth check, risky)
            if (tile.settlement && tile.settlement.type !== 'village') {
                actions.push({
                    type: 'steal_map',
                    label: 'Steal Maps',
                    icon: '🗡️',
                    description: 'Attempt to steal maps from local archives (risky)'
                });
            }

            // Dig for treasure (on treasure_cache tiles)
            if (tile.improvement && tile.improvement.type === 'treasure_cache' && !tile.improvement.explored) {
                actions.push({
                    type: 'dig_treasure',
                    label: 'Dig for Treasure',
                    icon: '💎',
                    description: 'Dig at the marked location for buried treasure'
                });
            }
        }

        // 5b. Attack settlement to conquer it
        if (tile.settlement && player.army && player.army.length > 0) {
            // Can attack if not your own settlement/colony and not your kingdom's
            const isOwnColony = tile.settlement.colony && tile.settlement.colony.isPlayerColony;
            const isOwnKingdom = player.allegiance && tile.settlement.kingdom === player.allegiance;
            if (!isOwnColony && !isOwnKingdom) {
                actions.push({
                    type: 'attack_settlement',
                    label: `Attack ${tile.settlement.name}`,
                    icon: '🏰',
                    description: `Lay siege to ${tile.settlement.name} and attempt to conquer it`,
                });
            }
        }

        // 5c. Attack world units on same tile
        if (world.units && world.units.length > 0) {
            const unitsOnTile = world.units.filter(u => u.q === player.q && u.r === player.r && !u.destroyed);
            for (const unit of unitsOnTile) {
                actions.push({
                    type: 'attack_unit',
                    label: `Attack ${unit.name}`,
                    icon: '⚔️',
                    description: `Engage the ${unit.name} (Strength: ${unit.strength}, Pop: ${unit.population})`,
                    unitId: unit.id
                });
            }
        }

        // 5d. Request meeting with NPC lord on same tile
        if (world.units && world.units.length > 0) {
            const lordParties = world.units.filter(u => u.type === 'lord_party' && u.q === player.q && u.r === player.r && !u.destroyed);
            for (const lordUnit of lordParties) {
                const kingdom = world.getKingdom(lordUnit.kingdomId);
                if (kingdom && kingdom.lord) {
                    actions.push({
                        type: 'request_meeting',
                        label: `Meet Lord ${lordUnit.lordName}`,
                        icon: '👑',
                        description: `Request an audience with ${lordUnit.lordName}, ruler of ${kingdom.name}`,
                        unitId: lordUnit.id
                    });
                }
            }
        }

        // 6. Miracles (Global/Self action really, but put here if high karma?)
        if (player.karma >= 10) {
            actions.push({
                type: 'miracle',
                label: 'Perform Miracle',
                icon: '✨',
                description: 'Use karma to invoke divine intervention'
            });
        }

        return actions;
    },
    /**
     * Process end of day for player
     */
    endDay(player, world) {
        const results = {
            production: {},     // New production
            faithIncome: 0,
            upkeepCost: 0,
            caravansCompleted: [],
            contractUpdate: null,
            followersGained: 0,
            blessingsExpired: [],
            researchUpdate: null,
            craftingUpdate: null,
            cultureIncome: 0,
            cultureRenown: 0,
            servitudeUpdate: null,
        };

        // Process indentured servitude if active
        if (player.indenturedServitude) {
            results.servitudeUpdate = PlayerMilitary.processServitude(player, world);
        }

        // Produce goods from properties
        results.production = PlayerEconomy.produceGoods(player, world);

        // Collect faith income
        results.faithIncome = PlayerReligion.collectFaithIncome(player);

        // Pay army upkeep
        const upkeep = PlayerMilitary.payUpkeep(player);
        results.upkeepCost = upkeep.cost || 0;
        results.unitsLost = upkeep.unitsLost || 0;

        // Update caravans
        results.caravansCompleted = PlayerEconomy.updateCaravans(player, world);

        // Update contract
        results.contractUpdate = PlayerMilitary.updateContract(player);

        // Spread faith
        results.followersGained = PlayerReligion.spreadFaith(player, world);

        // Update blessings
        results.blessingsExpired = PlayerReligion.updateBlessings(player);

        // Process technology research
        if (typeof Technology !== 'undefined') {
            results.researchUpdate = Technology.processResearch(player);
            results.craftingUpdate = Technology.processCrafting(player);
        }

        // Process cultural buildings income & renown
        if (typeof Culture !== 'undefined') {
            const cultureResult = Culture.processPlayerCulture(player, world);
            results.cultureIncome = cultureResult.income;
            results.cultureRenown = cultureResult.renown;
        }

        // Process active bounties — tick down timers and expire old ones
        if (player.activeBounties && player.activeBounties.length > 0) {
            const expired = [];
            for (let i = player.activeBounties.length - 1; i >= 0; i--) {
                const bounty = player.activeBounties[i];
                bounty.daysElapsed = (bounty.daysElapsed || 0) + 1;
                if (bounty.daysElapsed >= bounty.daysLimit) {
                    expired.push(bounty);
                    player.activeBounties.splice(i, 1);
                }
            }
            results.bountiesExpired = expired;
        }

        return results;
    },
};
