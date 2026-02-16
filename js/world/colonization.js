// ============================================
// COLONIZATION — Frontier settlements, pioneering
//   parties, indigenous populations, colony management,
//   distance-from-capital control, independence movements
// ============================================

const Colonization = {

    // ── Configuration ──────────────────────────

    /** Cost for the player to found a colony */
    COLONY_COST: 500,

    /** Minimum distance (hexes) from ANY existing settlement to found a colony */
    MIN_SETTLEMENT_DISTANCE: 4,

    /** Minimum distance from a kingdom capital before a settlement is considered a "colony" */
    COLONY_DISTANCE_THRESHOLD: 8,

    /** Maximum loyalty before a colony is considered fully integrated (no longer a colony) */
    INTEGRATION_LOYALTY: 95,

    /** Daily loyalty decay per hex of distance beyond the threshold */
    LOYALTY_DECAY_PER_HEX: 0.04,

    /** Daily base loyalty recovery from garrison / investment */
    BASE_LOYALTY_RECOVERY: 0.1,

    /** Independence revolt threshold */
    REVOLT_LOYALTY: 15,

    /** Chance per day a colony revolts when loyalty is below threshold */
    REVOLT_CHANCE_PER_DAY: 0.03,

    /** Indigenous population templates */
    INDIGENOUS_TRIBES: [
        { id: 'forest_folk',    name: 'Forest Folk',    icon: '🌲', terrains: ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest'], hostility: 0.3, tradeability: 0.6 },
        { id: 'steppe_riders',  name: 'Steppe Riders',  icon: '🐎', terrains: ['plains', 'savanna', 'grassland', 'steppe'], hostility: 0.5, tradeability: 0.4 },
        { id: 'mountain_clans', name: 'Mountain Clans',  icon: '⛰️', terrains: ['mountains', 'hills', 'highland'], hostility: 0.4, tradeability: 0.3 },
        { id: 'desert_nomads',  name: 'Desert Nomads',  icon: '🏜️', terrains: ['desert', 'arid', 'mesa', 'badlands'], hostility: 0.2, tradeability: 0.7 },
        { id: 'swamp_dwellers', name: 'Swamp Dwellers', icon: '🐊', terrains: ['swamp', 'wetland', 'marsh', 'mangrove'], hostility: 0.6, tradeability: 0.2 },
        { id: 'coastal_tribes', name: 'Coastal Tribes',  icon: '🐚', terrains: ['coast', 'beach'], hostility: 0.1, tradeability: 0.8 },
        { id: 'tundra_people',  name: 'Tundra People',  icon: '❄️', terrains: ['tundra', 'snow', 'ice', 'cold_desert', 'polar'], hostility: 0.2, tradeability: 0.3 },
    ],

    /** Colonization ideology/policy templates */
    POLICIES: {
        manifest_destiny: {
            id: 'manifest_destiny',
            name: 'Manifest Destiny',
            icon: '🌅',
            description: 'Aggressive expansion — higher growth, but indigenous hostility increases.',
            expansionBonus: 1.5,
            indigenousRelation: -0.3,
            loyaltyBonus: 0.05,
            productionBonus: 0.1,
        },
        coexistence: {
            id: 'coexistence',
            name: 'Coexistence',
            icon: '🤝',
            description: 'Peaceful integration — slower growth, but indigenous trade and harmony.',
            expansionBonus: 0.8,
            indigenousRelation: 0.4,
            loyaltyBonus: 0.15,
            productionBonus: 0.0,
        },
        exploitation: {
            id: 'exploitation',
            name: 'Exploitation',
            icon: '⛏️',
            description: 'Strip resources fast — high income, but massive unrest and decay.',
            expansionBonus: 1.0,
            indigenousRelation: -0.6,
            loyaltyBonus: -0.1,
            productionBonus: 0.3,
        },
        missionary: {
            id: 'missionary',
            name: 'Missionary',
            icon: '⛪',
            description: 'Spread faith to new lands — moderate growth, high cultural influence.',
            expansionBonus: 1.0,
            indigenousRelation: 0.1,
            loyaltyBonus: 0.1,
            productionBonus: 0.05,
        },
    },


    // ── Initialization ─────────────────────────

    /**
     * Called during world generation to seed indigenous populations
     */
    initialize(world) {
        Colonization.seedIndigenousPopulations(world);
        // Give each kingdom a default colonization policy
        for (const kingdom of world.kingdoms) {
            if (!kingdom.colonization) {
                kingdom.colonization = {
                    policy: 'coexistence',
                    colonies: [],          // [{q, r, name}]
                    pioneersActive: 0,
                };
            }
        }
    },

    /**
     * Scatter indigenous tribes across unclaimed wilderness
     */
    seedIndigenousPopulations(world) {
        const count = Utils.randInt(15, 30);
        let placed = 0;

        for (let attempt = 0; attempt < count * 10 && placed < count; attempt++) {
            const q = Utils.randInt(0, world.width - 1);
            const r = Utils.randInt(3, world.height - 4);
            const tile = world.getTile(q, r);
            if (!tile || !tile.terrain.passable || tile.settlement || tile.kingdom || tile.indigenous) continue;

            // Match tribe to terrain
            const matching = Colonization.INDIGENOUS_TRIBES.filter(t => t.terrains.includes(tile.terrain.id));
            if (matching.length === 0) continue;

            // Distance check from settlements
            const settlements = world.getAllSettlements();
            let tooClose = false;
            for (const s of settlements) {
                if (Hex.wrappingDistance(q, r, s.q, s.r, world.width) < 3) { tooClose = true; break; }
            }
            if (tooClose) continue;

            const tribe = Utils.randPick(matching);
            tile.indigenous = {
                tribeId: tribe.id,
                name: tribe.name,
                icon: tribe.icon,
                population: Utils.randInt(30, 200),
                hostility: tribe.hostility + Utils.randFloat(-0.1, 0.1),
                tradeability: tribe.tradeability,
                relation: 0,   // -100 (hostile) to +100 (friendly)
                discovered: false,
            };
            placed++;
        }
    },


    // ── Daily Processing ───────────────────────

    /**
     * Called each day from World.advanceDay()
     */
    processTurn(world) {
        // 1. Process all colonies for every kingdom
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.colonization) continue;
            Colonization.processKingdomColonies(kingdom, world);
        }

        // 2. Process indigenous population dynamics
        Colonization.processIndigenous(world);

        // 3. AI kingdom colonization attempts
        Colonization.processKingdomColonization(world);
    },

    /**
     * Process colony loyalty, growth, and independence for one kingdom
     */
    processKingdomColonies(kingdom, world) {
        if (!kingdom.colonization || !kingdom.colonization.colonies) return;

        const policy = Colonization.POLICIES[kingdom.colonization.policy] || Colonization.POLICIES.coexistence;
        const capitalQ = kingdom.capital ? kingdom.capital.q : 0;
        const capitalR = kingdom.capital ? kingdom.capital.r : 0;

        const toRemove = [];

        for (const colony of kingdom.colonization.colonies) {
            const tile = world.getTile(colony.q, colony.r);
            if (!tile || !tile.settlement) {
                toRemove.push(colony);
                continue;
            }

            // Ensure colony data exists on the settlement
            if (!tile.settlement.colony) {
                tile.settlement.colony = {
                    loyalty: 60,
                    foundedDay: world.day,
                    motherKingdom: kingdom.id,
                    governor: null,
                    garrisonStrength: 0,
                    indigenousRelation: 0,
                    isPlayerColony: false,
                };
            }

            const colonyData = tile.settlement.colony;
            const dist = Hex.wrappingDistance(colony.q, colony.r, capitalQ, capitalR, world.width);

            // ── Loyalty calculation ──
            // Distance decay
            const distBeyond = Math.max(0, dist - Colonization.COLONY_DISTANCE_THRESHOLD);
            let loyaltyChange = -distBeyond * Colonization.LOYALTY_DECAY_PER_HEX;

            // Road connection bonus
            if (typeof Infrastructure !== 'undefined' && Infrastructure.hasRoadConnection(world, capitalQ, capitalR, colony.q, colony.r)) {
                loyaltyChange += 0.15;
            }

            // Garrison bonus
            loyaltyChange += Math.min(0.2, colonyData.garrisonStrength * 0.01);

            // Policy bonus
            loyaltyChange += policy.loyaltyBonus;

            // Base recovery
            loyaltyChange += Colonization.BASE_LOYALTY_RECOVERY;

            // Population happiness factor
            if (tile.settlement.population > 500) loyaltyChange += 0.05;
            if (tile.settlement.population > 2000) loyaltyChange += 0.05;

            // Indigenous conflict penalty
            const nearbyIndigenous = Colonization.getNearbyIndigenous(world, colony.q, colony.r, 3);
            for (const ind of nearbyIndigenous) {
                if (ind.relation < -30) loyaltyChange -= 0.05;
            }

            colonyData.loyalty = Utils.clamp(colonyData.loyalty + loyaltyChange, 0, 100);

            // ── Colony growth ──
            if (colonyData.loyalty > 40) {
                const growthRate = 1 + (policy.expansionBonus - 1) * 0.5;
                const growth = Utils.randInt(1, Math.ceil(5 * growthRate));
                tile.settlement.population += growth;

                // Level up
                if (tile.settlement.population > 500 && tile.settlement.level < 1) {
                    tile.settlement.level = 1;
                    tile.settlement.type = 'village';
                }
                if (tile.settlement.population > 2000 && tile.settlement.level < 2) {
                    tile.settlement.level = 2;
                    tile.settlement.type = 'town';
                    world.events.push({
                        text: `📈 The colony of ${tile.settlement.name} has grown into a town!`,
                        type: 'colonization',
                        category: 'ECONOMIC',
                    });
                }
            }

            // ── Integration check ──
            if (colonyData.loyalty >= Colonization.INTEGRATION_LOYALTY && dist <= Colonization.COLONY_DISTANCE_THRESHOLD) {
                // Fully integrated — no longer a frontier colony
                delete tile.settlement.colony;
                toRemove.push(colony);
                world.events.push({
                    text: `🏘️ ${tile.settlement.name} has been fully integrated into ${kingdom.name}.`,
                    type: 'colonization',
                    category: 'POLITICAL',
                });
                continue;
            }

            // ── Independence revolt ──
            if (colonyData.loyalty <= Colonization.REVOLT_LOYALTY && Math.random() < Colonization.REVOLT_CHANCE_PER_DAY) {
                // Colony declares independence!
                toRemove.push(colony);
                tile.kingdom = null;
                tile.settlement.kingdom = null;
                if (tile.settlement.colony) {
                    delete tile.settlement.colony;
                }

                // Remove hex from kingdom territory
                kingdom.territory = kingdom.territory.filter(t => t.q !== colony.q || t.r !== colony.r);

                // Also liberate a small radius
                const liberatedHexes = Hex.hexesInRange(colony.q, colony.r, 2);
                for (const lh of liberatedHexes) {
                    const lt = world.getTile(lh.q, lh.r);
                    if (lt && lt.kingdom === kingdom.id) {
                        lt.kingdom = null;
                        kingdom.territory = kingdom.territory.filter(t => t.q !== Hex.wrapQ(lh.q, world.width) || t.r !== lh.r);
                    }
                }

                world.events.push({
                    text: `🔥 The colony of ${tile.settlement.name} has declared independence from ${kingdom.name}!`,
                    type: 'colonization',
                    category: 'POLITICAL',
                });

                // Notify player if it was their colony
                if (colonyData.isPlayerColony) {
                    world.events.push({
                        text: `⚠️ Your colony, ${tile.settlement.name}, has broken away!`,
                        type: 'colonization',
                        category: 'POLITICAL',
                    });
                }
            }
        }

        // Clean up removed colonies
        kingdom.colonization.colonies = kingdom.colonization.colonies.filter(c => !toRemove.includes(c));
    },

    /**
     * Process indigenous populations — growth, interaction, discovery
     */
    processIndigenous(world) {
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.indigenous) continue;

                const ind = tile.indigenous;

                // Slow population growth
                if (ind.population < 500 && Math.random() < 0.05) {
                    ind.population += Utils.randInt(1, 5);
                }

                // Check for nearby kingdom encroachment
                const neighbors = Hex.neighbors(q, r);
                let encroached = false;
                for (const n of neighbors) {
                    const nt = world.getTile(n.q, n.r);
                    if (nt && nt.kingdom) {
                        encroached = true;
                        const kingdom = world.getKingdom(nt.kingdom);
                        if (kingdom) {
                            const policy = Colonization.POLICIES[kingdom.colonization?.policy || 'coexistence'];
                            ind.relation += policy.indigenousRelation * 0.1;
                            ind.relation = Utils.clamp(ind.relation, -100, 100);
                        }
                        break;
                    }
                }

                // Hostile indigenous may attack nearby colonies
                if (ind.relation < -50 && encroached && Math.random() < 0.02) {
                    // Find nearest colony settlement
                    for (const n of neighbors) {
                        const nt = world.getTile(n.q, n.r);
                        if (nt && nt.settlement && nt.settlement.colony) {
                            const damage = Utils.randInt(5, 20);
                            nt.settlement.population = Math.max(10, nt.settlement.population - damage);
                            nt.settlement.colony.loyalty -= Utils.randInt(3, 8);
                            world.events.push({
                                text: `🏹 ${ind.name} raided the colony of ${nt.settlement.name}! ${damage} colonists lost.`,
                                type: 'colonization',
                                category: 'MILITARY',
                            });
                            break;
                        }
                    }
                }

                // Displacement — if tile gets claimed, tribe shrinks or migrates
                if (tile.kingdom) {
                    ind.population -= Utils.randInt(1, 3);
                    if (ind.population <= 0) {
                        delete tile.indigenous;
                    }
                }
            }
        }
    },


    // ── AI Kingdom Colonization ────────────────

    /**
     * AI kingdoms may send pioneer parties to colonize distant unclaimed land
     */
    processKingdomColonization(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.capital) continue;
            if (!kingdom.colonization) {
                kingdom.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
            }

            // Chance to launch a pioneer party (every ~15 days, 20% chance)
            if (world.day % 15 !== 0 || Math.random() > 0.20) continue;

            // Only if kingdom is stable enough
            if (kingdom.treasury < 300 || kingdom.military < 100) continue;
            if (kingdom.colonization.colonies.length >= 5) continue; // max 5 AI colonies
            if (kingdom.colonization.pioneersActive >= 2) continue;

            // Find a target: unclaimed passable tile far from capital but reachable
            const targetDist = Utils.randInt(10, 20);
            let bestTarget = null;
            let bestScore = -Infinity;

            for (let attempt = 0; attempt < 40; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const tq = Math.round(kingdom.capital.q + Math.cos(angle) * targetDist);
                const tr = Math.round(kingdom.capital.r + Math.sin(angle) * targetDist * 0.75);
                const wq = Hex.wrapQ(tq, world.width);
                if (tr < 3 || tr >= world.height - 3) continue;

                const tile = world.getTile(wq, tr);
                if (!tile || !tile.terrain.passable || tile.settlement || tile.kingdom) continue;

                // Score by resources, distance from others
                const settlements = world.getAllSettlements();
                const minDist = settlements.reduce((min, s) => Math.min(min, Hex.wrappingDistance(wq, tr, s.q, s.r, world.width)), Infinity);
                if (minDist < Colonization.MIN_SETTLEMENT_DISTANCE) continue;

                let score = minDist * 2;
                if (tile.resource) score += 30;
                const nearbyRes = Economy.getNearbyResources(wq, tr, world, 3);
                score += nearbyRes.length * 10;

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = { q: wq, r: tr };
                }
            }

            if (!bestTarget) continue;

            // Spawn a pioneer settler unit
            const settler = new WorldUnit('settler', kingdom.capital.q, kingdom.capital.r, bestTarget.q, bestTarget.r);
            settler.name = `${kingdom.name.split(' ').pop()} Pioneers`;
            settler.kingdomId = kingdom.id;
            settler.isPioneer = true;
            world.units.push(settler);

            kingdom.colonization.pioneersActive++;
            kingdom.treasury -= 200;

            world.events.push({
                text: `🚩 ${kingdom.name} has sent pioneers to colonize distant lands!`,
                type: 'colonization',
                category: 'POLITICAL',
            });
        }
    },


    // ── Player Colonization Logic ──────────────

    /**
     * Check if the player can found a colony at (q, r)
     */
    canPlayerFoundColony(player, tile, world, q, r) {
        if (!tile.terrain.passable) return { can: false, reason: 'Impassable terrain.' };
        if (tile.settlement) return { can: false, reason: 'A settlement already exists here.' };
        if (tile.playerProperty) return { can: false, reason: 'You already have a property here.' };
        if (player.gold < Colonization.COLONY_COST) return { can: false, reason: `Requires ${Colonization.COLONY_COST} gold.` };

        // Distance from existing settlements
        const settlements = world.getAllSettlements();
        for (const s of settlements) {
            if (Hex.wrappingDistance(q, r, s.q, s.r, world.width) < Colonization.MIN_SETTLEMENT_DISTANCE) {
                return { can: false, reason: 'Too close to an existing settlement.' };
            }
        }

        return { can: true };
    },

    /**
     * Found a colony for the player
     */
    foundPlayerColony(player, tile, world, q, r, name, policyId) {
        const check = Colonization.canPlayerFoundColony(player, tile, world, q, r);
        if (!check.can) return { success: false, reason: check.reason };

        const policy = Colonization.POLICIES[policyId] || Colonization.POLICIES.coexistence;

        // Deduct cost
        player.gold -= Colonization.COLONY_COST;

        // Create the settlement
        const colonyName = name || Kingdom.generateCityName(
            player.allegiance ? (world.getKingdom(player.allegiance)?.culture || 'Imperial') : 'Imperial'
        );

        tile.settlement = {
            type: 'village',
            name: colonyName,
            population: Utils.randInt(30, 80),
            level: 0,
            kingdom: player.allegiance || null,
            founded: world.day,
        };

        Economy.initSettlement(tile.settlement);

        // Set colony data on the settlement
        tile.settlement.colony = {
            loyalty: 70,
            foundedDay: world.day,
            motherKingdom: player.allegiance || null,
            governor: player.name,
            garrisonStrength: Math.min(20, player.army ? player.army.length : 0),
            indigenousRelation: 0,
            isPlayerColony: true,
            policy: policyId,
        };

        // Claim territory for the player's kingdom if aligned
        if (player.allegiance) {
            tile.kingdom = player.allegiance;
            const kingdom = world.getKingdom(player.allegiance);
            if (kingdom) {
                kingdom.territory.push({ q, r });
                if (!kingdom.colonization) kingdom.colonization = { policy: policyId, colonies: [], pioneersActive: 0 };
                kingdom.colonization.colonies.push({ q, r, name: colonyName });

                // Also claim some neighboring hexes
                const claimRadius = 1;
                const neighbors = Hex.hexesInRange(q, r, claimRadius);
                for (const n of neighbors) {
                    const nt = world.getTile(n.q, n.r);
                    if (nt && nt.terrain.passable && !nt.kingdom && !nt.settlement) {
                        nt.kingdom = player.allegiance;
                        const wq = Hex.wrapQ(n.q, world.width);
                        kingdom.territory.push({ q: wq, r: n.r });
                    }
                }
            }
        }

        // Track as player property too
        if (!player.colonies) player.colonies = [];
        player.colonies.push({ q, r, name: colonyName, foundedDay: world.day });

        // Interact with indigenous
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, q, r, 4);
        for (const ind of nearbyIndigenous) {
            ind.relation += policy.indigenousRelation * 20;
            ind.relation = Utils.clamp(ind.relation, -100, 100);
            ind.discovered = true;
        }

        return { success: true, name: colonyName, nearbyTribes: nearbyIndigenous.length };
    },

    /**
     * Send a pioneer party (player action)
     */
    sendPioneerParty(player, world, targetQ, targetR) {
        if (player.gold < 200) return { success: false, reason: 'Need at least 200 gold.' };

        player.gold -= 200;

        const settler = new WorldUnit('settler', player.q, player.r, targetQ, targetR);
        settler.name = `${player.name}'s Pioneers`;
        settler.isPlayerPioneer = true;
        settler.ownerAllegiance = player.allegiance;
        world.units.push(settler);

        return { success: true };
    },

    /**
     * Process player's pioneer settler arriving at destination
     * (called from World.processUnits when a settler with isPlayerPioneer arrives)
     */
    onPioneerArrival(settler, world, player) {
        const tile = world.getTile(settler.q, settler.r);
        if (!tile || tile.settlement) return;

        const name = Kingdom.generateCityName(
            player && player.allegiance ? (world.getKingdom(player.allegiance)?.culture || 'Imperial') : 'Imperial'
        );

        tile.settlement = {
            type: 'village',
            name: name,
            population: settler.population || Utils.randInt(30, 80),
            level: 0,
            kingdom: settler.ownerAllegiance || null,
            founded: world.day,
        };

        Economy.initSettlement(tile.settlement);

        tile.settlement.colony = {
            loyalty: 60,
            foundedDay: world.day,
            motherKingdom: settler.ownerAllegiance || null,
            governor: null,
            garrisonStrength: 0,
            indigenousRelation: 0,
            isPlayerColony: true,
            policy: 'coexistence',
        };

        if (settler.ownerAllegiance) {
            tile.kingdom = settler.ownerAllegiance;
            const kingdom = world.getKingdom(settler.ownerAllegiance);
            if (kingdom) {
                kingdom.territory.push({ q: settler.q, r: settler.r });
                if (!kingdom.colonization) kingdom.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
                kingdom.colonization.colonies.push({ q: settler.q, r: settler.r, name });
            }
        }

        if (player) {
            if (!player.colonies) player.colonies = [];
            player.colonies.push({ q: settler.q, r: settler.r, name, foundedDay: world.day });
        }

        world.events.push({
            text: `🏘️ Your pioneers have established the colony of ${name}!`,
            type: 'colonization',
            category: 'ECONOMIC',
        });
    },


    // ── AI Pioneer Settler Arrival ─────────────

    /**
     * Called when an AI kingdom's pioneer settler arrives
     */
    onKingdomPioneerArrival(settler, world) {
        const tile = world.getTile(settler.q, settler.r);
        if (!tile || tile.settlement || !tile.terrain.passable) return;

        const kingdom = world.getKingdom(settler.kingdomId);
        if (!kingdom || !kingdom.isAlive) return;

        const name = Kingdom.generateCityName(kingdom.culture);

        tile.settlement = {
            type: 'village',
            name: name,
            population: settler.population || Utils.randInt(40, 120),
            level: 0,
            kingdom: kingdom.id,
            founded: world.day,
        };

        Economy.initSettlement(tile.settlement);

        tile.settlement.colony = {
            loyalty: 55,
            foundedDay: world.day,
            motherKingdom: kingdom.id,
            governor: null,
            garrisonStrength: Math.floor(kingdom.military * 0.02),
            indigenousRelation: 0,
            isPlayerColony: false,
            policy: kingdom.colonization?.policy || 'coexistence',
        };

        // Claim territory
        tile.kingdom = kingdom.id;
        kingdom.territory.push({ q: settler.q, r: settler.r });

        const claimRadius = 1;
        const neighbors = Hex.hexesInRange(settler.q, settler.r, claimRadius);
        for (const n of neighbors) {
            const nt = world.getTile(n.q, n.r);
            if (nt && nt.terrain.passable && !nt.kingdom && !nt.settlement) {
                nt.kingdom = kingdom.id;
                const wq = Hex.wrapQ(n.q, world.width);
                kingdom.territory.push({ q: wq, r: n.r });
            }
        }

        if (!kingdom.colonization) kingdom.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
        kingdom.colonization.colonies.push({ q: settler.q, r: settler.r, name });
        kingdom.colonization.pioneersActive = Math.max(0, kingdom.colonization.pioneersActive - 1);

        world.events.push({
            text: `🏘️ ${kingdom.name} has established the colony of ${name} in distant lands!`,
            type: 'colonization',
            category: 'POLITICAL',
        });

        // Indigenous interaction
        const policy = Colonization.POLICIES[kingdom.colonization?.policy || 'coexistence'];
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, settler.q, settler.r, 4);
        for (const ind of nearbyIndigenous) {
            ind.relation += policy.indigenousRelation * 20;
            ind.relation = Utils.clamp(ind.relation, -100, 100);
        }
    },


    // ── Helpers ────────────────────────────────

    /**
     * Get indigenous populations near a hex
     */
    getNearbyIndigenous(world, centerQ, centerR, radius) {
        const result = [];
        const hexes = Hex.hexesInRange(centerQ, centerR, radius);
        for (const h of hexes) {
            const tile = world.getTile(h.q, h.r);
            if (tile && tile.indigenous) {
                result.push(tile.indigenous);
            }
        }
        return result;
    },

    /**
     * Get all player colonies with status data
     */
    getPlayerColonies(player, world) {
        const colonies = player.colonies || [];
        return colonies.map(c => {
            const tile = world.getTile(c.q, c.r);
            if (!tile || !tile.settlement) return null;
            return {
                ...c,
                settlement: tile.settlement,
                colony: tile.settlement.colony || null,
                terrain: tile.terrain,
                hasRoad: tile.hasRoad || !!(tile.infrastructure),
                indigenous: Colonization.getNearbyIndigenous(world, c.q, c.r, 3),
            };
        }).filter(Boolean);
    },

    /**
     * Calculate distance control penalty for a colony
     */
    getDistancePenalty(world, kingdom, q, r) {
        if (!kingdom || !kingdom.capital) return 0;
        const dist = Hex.wrappingDistance(q, r, kingdom.capital.q, kingdom.capital.r, world.width);
        const beyond = Math.max(0, dist - Colonization.COLONY_DISTANCE_THRESHOLD);
        return beyond * Colonization.LOYALTY_DECAY_PER_HEX;
    },

    /**
     * Get wilderness score — how wild/untamed a hex is (for UI info)
     */
    getWildernessScore(tile, world, q, r) {
        let score = 100;
        if (tile.kingdom) score -= 40;
        if (tile.settlement) score -= 30;
        if (tile.hasRoad || tile.infrastructure) score -= 15;
        if (tile.indigenous) score += 20;

        // Check neighbors
        const neighbors = Hex.neighbors(q, r);
        for (const n of neighbors) {
            const nt = world.getTile(n.q, n.r);
            if (nt && nt.kingdom) score -= 5;
            if (nt && nt.settlement) score -= 5;
        }

        return Utils.clamp(score, 0, 100);
    },
};
