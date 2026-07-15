// Cartography — usage members (split from the original monolith).
import { Cartography } from './_ref.js';
import { Utils, Hex } from './_imports.js';

Object.assign(Cartography, {
    // ── Map Reading / Applying ─────────────────
    /**
     * Apply a map — reveal tiles to the player based on map data & accuracy
     */
    applyMap(player, map, world) {
        const accuracy = map.accuracy || 0.5;
        let tilesRevealed = 0;

        // Kingdom maps: reveal all kingdom territory tiles
        if (map.type === 'kingdom' && map.tiles && map.tiles.length > 0) {
            for (const t of map.tiles) {
                const tile = world.getTile(t.q, t.r);
                if (!tile) continue;
                tile.explored = true;
                tilesRevealed++;
            }
            // Also reveal a radius around the capital for border context
            if (map.centerQ !== undefined && map.centerR !== undefined) {
                const hexes = Hex.hexesInRange(map.centerQ, map.centerR, 5);
                for (const hex of hexes) {
                    const tile = world.getTile(hex.q, hex.r);
                    if (!tile) continue;
                    if (!tile.explored) {
                        tile.explored = true;
                        tilesRevealed++;
                    }
                }
            }
        }
        // Continent maps: reveal all tiles with matching regionId
        else if (map.type === 'continent' && map.regionId !== undefined) {
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (!tile) continue;
                    if (tile.regionId === map.regionId) {
                        if (Utils.random() > accuracy) continue;
                        if (!tile.explored) {
                            tile.explored = true;
                            tilesRevealed++;
                        }
                    }
                }
            }
        }
        // Standard maps: use radius circle
        else {
            const hexes = Hex.hexesInRange(map.centerQ, map.centerR, map.radius);
            for (const hex of hexes) {
                const tile = world.getTile(hex.q, hex.r);
                if (!tile) continue;
                if (Utils.random() > accuracy) continue;
                tile.explored = true;
                tilesRevealed++;
            }
        }

        // Mark treasure maps
        if (map.type === 'treasure' && map.treasureQ !== undefined) {
            const tTile = world.getTile(map.treasureQ, map.treasureR);
            if (tTile) {
                tTile.explored = true;
                if (!tTile.improvement && tTile.terrain.passable) {
                    tTile.improvement = {
                        type: 'treasure_cache',
                        icon: '💎',
                        name: 'Buried Treasure',
                        explored: false,
                        founded: 0,
                    };
                }
            }
        }

        // Ancient maps may reveal POI locations
        if (map.isAncient && map.sites) {
            for (const site of map.sites) {
                const siteTile = world.getTile(site.q, site.r);
                if (siteTile) siteTile.explored = true;
            }
        }

        // Cartography skill gain from reading maps made by others
        if (map.createdBy !== player.name) {
            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.05);
        }

        return { tilesRevealed, accuracy, hasErrors: map.deliberateErrors.length > 0 };
    },

    /**
     * Dig up treasure at a treasure map location
     */
    digTreasure(player, world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile) return { success: false, reason: 'Invalid location.' };

        if (tile.buried && !tile.buried.discovered) {
            const gold = tile.buried.gold;
            player.gold += gold;
            tile.buried.discovered = true;

            // Remove the treasure POI
            if (tile.improvement && tile.improvement.type === 'treasure_cache') {
                tile.improvement = null;
            }

            let bonusText = '';
            if (tile.buried.items && tile.buried.items.length > 0) {
                player.renown = (player.renown || 0) + 10;
                bonusText = ' You also found an ancient relic! (+10 renown)';
            }

            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.3);
            return { success: true, gold, bonusText };
        }

        return { success: false, reason: 'Nothing buried here.' };
    },

    // ── Stolen Maps ────────────────────────────
    /**
     * Attempt to steal a map from a settlement/tavern
     */
    attemptStealMap(player, world, tile) {
        const skill = player.skills.stealth || 1;
        const chance = 0.2 + skill * 0.08;
        const roll = Utils.random();

        if (roll < chance) {
            // Success — generate a useful stolen map
            const stolenMap = Cartography._generateStolenMap(world, tile);
            if (!player.maps) player.maps = [];
            player.maps.push(stolenMap);

            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.1);
            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.1);

            return {
                success: true,
                caught: false,
                map: stolenMap,
                message: `You successfully pilfered a ${stolenMap.name}!`,
            };
        } else if (roll < chance + 0.3) {
            // Caught!
            const fine = Utils.randInt(50, 200);
            const actualFine = Math.min(fine, player.gold);
            player.gold -= actualFine;
            player.renown = Math.max(0, (player.renown || 0) - 5);

            // Reputation hit with local kingdom
            if (tile.kingdom) {
                player.reputation[tile.kingdom] = Math.max(-100, (player.reputation[tile.kingdom] || 0) - 15);
            }

            return {
                success: false,
                caught: true,
                fine: actualFine,
                message: `Caught stealing! Fined ${actualFine} gold and lost reputation.`,
            };
        } else {
            // Failed but not caught
            return {
                success: false,
                caught: false,
                message: 'You couldn\'t find any maps worth taking.',
            };
        }
    },

    /**
     * Generate a stolen map
     */
    _generateStolenMap(world, tile) {
        const types = ['regional', 'kingdom', 'survey'];
        const type = Utils.randPick(types);

        let map;
        if (type === 'kingdom' && tile.kingdom) {
            const kingdom = world.getKingdom(tile.kingdom);
            if (kingdom && kingdom.capital) {
                map = {
                    id: `stolen_${Date.now()}_${Utils.randInt(0, 9999)}`,
                    type: 'kingdom',
                    name: `Stolen Map of ${kingdom.name}`,
                    icon: '🗡️',
                    quality: Utils.randPick(['basic', 'detailed']),
                    accuracy: 0.6 + Utils.random() * 0.2,
                    kingdomId: kingdom.id,
                    centerQ: kingdom.capital.q,
                    centerR: kingdom.capital.r,
                    radius: Cartography.MAP_TYPES.stolen.radius,
                    createdDay: world.day,
                    createdBy: `${kingdom.name} Archives`,
                    value: Utils.randInt(40, 100),
                    tiles: Cartography._chartKingdomTiles(kingdom, world, 0.7),
                    deliberateErrors: [],
                    isPropaganda: false,
                    isStolen: true,
                    isAncient: false,
                    notes: `Stolen from ${kingdom.name}'s records.`,
                };
            }
        }

        if (!map) {
            const q = tile.q || Utils.randInt(0, world.width - 1);
            const r = tile.r || Utils.randInt(5, world.height - 6);
            map = {
                id: `stolen_${Date.now()}_${Utils.randInt(0, 9999)}`,
                type: 'regional',
                name: `Stolen Regional Map`,
                icon: '🗡️',
                quality: Utils.randPick(['crude', 'basic', 'detailed']),
                accuracy: 0.5 + Utils.random() * 0.3,
                centerQ: q,
                centerR: r,
                radius: Cartography.MAP_TYPES.regional.radius,
                createdDay: world.day,
                createdBy: 'Unknown',
                value: Utils.randInt(20, 60),
                tiles: Cartography._chartTiles(q, r, Cartography.MAP_TYPES.regional.radius, world, 0.6),
                deliberateErrors: [],
                isPropaganda: false,
                isStolen: true,
                isAncient: false,
                notes: 'Acquired through... unconventional means.',
            };
        }

        return map;
    },

    // ── Map Trading ────────────────────────────
    /**
     * Get maps available for purchase at a settlement
     */
    getAvailableMapsForSale(tile, world) {
        const maps = [];
        if (!tile.settlement) return maps;

        const settlement = tile.settlement;
        const isCity = settlement.type === 'capital' || settlement.type === 'city' || settlement.type === 'town';

        // Local regional map
        const q = tile.q !== undefined ? tile.q : 0;
        const r = tile.r !== undefined ? tile.r : 0;

        maps.push({
            map: {
                id: `sale_regional_${q}_${r}`,
                type: 'regional',
                name: `Map of ${Cartography._getRegionName(q, r, world)}`,
                icon: '🗺️',
                quality: isCity ? 'detailed' : 'basic',
                accuracy: isCity ? 0.8 : 0.6,
                centerQ: q,
                centerR: r,
                radius: Cartography.MAP_TYPES.regional.radius,
                createdDay: world.day,
                createdBy: `${settlement.name} Cartographer`,
                value: isCity ? 60 : 30,
                tiles: Cartography._chartTiles(q, r, Cartography.MAP_TYPES.regional.radius, world, isCity ? 0.8 : 0.6),
                deliberateErrors: [],
                isPropaganda: false,
                isStolen: false,
                isAncient: false,
                notes: `Drawn by a ${isCity ? 'city' : 'village'} cartographer.`,
            },
            price: isCity ? 60 : 35,
        });

        // Kingdom map (in aligned settlements)
        if (tile.kingdom && isCity) {
            const kingdom = world.getKingdom(tile.kingdom);
            if (kingdom && kingdom.capital) {
                maps.push({
                    map: {
                        id: `sale_kingdom_${tile.kingdom}`,
                        type: 'kingdom',
                        name: `Official Map of ${kingdom.name}`,
                        icon: '👑',
                        quality: 'detailed',
                        accuracy: 0.75,
                        kingdomId: tile.kingdom,
                        centerQ: kingdom.capital.q,
                        centerR: kingdom.capital.r,
                        radius: 0,
                        createdDay: world.day,
                        createdBy: `Royal Cartographer of ${kingdom.name}`,
                        value: 100,
                        tiles: Cartography._chartKingdomTiles(kingdom, world, 0.75),
                        deliberateErrors: [],
                        isPropaganda: false,
                        isStolen: false,
                        isAncient: false,
                        notes: `Official cartographic record of ${kingdom.name}.`,
                    },
                    price: 120,
                });
            }
        }

        // Chance of treasure map in taverns (30%)
        if (isCity && Utils.random() < 0.3) {
            const tMap = Cartography.generateTreasureMap(world);
            if (tMap) {
                maps.push({
                    map: tMap,
                    price: Utils.randInt(80, 200),
                });
            }
        }

        // Chance of ancient map (15%)
        if (Utils.random() < 0.15) {
            const aMap = Cartography.generateAncientMap(world, q, r);
            maps.push({
                map: aMap,
                price: Utils.randInt(50, 150),
            });
        }

        // Propaganda maps from enemy kingdoms
        if (tile.kingdom) {
            const enemies = world.kingdoms.filter(k =>
                k.isAlive && k.id !== tile.kingdom &&
                (world.getKingdom(tile.kingdom)?.wars || []).includes(k.id)
            );
            if (enemies.length > 0) {
                const enemy = Utils.randPick(enemies);
                const propMap = Cartography.generatePropagandaMap(enemy, world);
                if (propMap) {
                    maps.push({
                        map: propMap,
                        price: Utils.randInt(20, 50),
                    });
                }
            }
        }

        // Continent map — extremely rare (3% chance, capitals only)
        if (settlement.type === 'capital' && Utils.random() < 0.03) {
            const currentTile = world.getTile(q, r);
            if (currentTile && currentTile.regionId !== undefined) {
                // Count tiles in this continent for pricing
                let continentSize = 0;
                for (let cr = 0; cr < world.height; cr++) {
                    for (let cq = 0; cq < world.width; cq++) {
                        const ct = world.getTile(cq, cr);
                        if (ct && ct.regionId === currentTile.regionId) continentSize++;
                    }
                }
                const price = Math.max(5000, Math.floor(continentSize * 10));

                maps.push({
                    map: {
                        id: `sale_continent_${currentTile.regionId}`,
                        type: 'continent',
                        name: `Grand Continental Atlas`,
                        icon: '🌍',
                        quality: 'masterwork',
                        accuracy: 0.95,
                        centerQ: q,
                        centerR: r,
                        regionId: currentTile.regionId,
                        radius: 0,
                        createdDay: world.day,
                        createdBy: `Royal Geographic Society of ${settlement.name}`,
                        value: price,
                        tiles: [],
                        deliberateErrors: [],
                        isPropaganda: false,
                        isStolen: false,
                        isAncient: false,
                        notes: `A masterwork atlas covering the entire continent. Painstakingly compiled over decades.`,
                    },
                    price: price,
                });
            }
        }

        return maps;
    },

    /**
     * Sell a player's map
     */
    sellMap(player, mapIndex) {
        if (!player.maps || mapIndex < 0 || mapIndex >= player.maps.length) {
            return { success: false, reason: 'Invalid map.' };
        }

        const map = player.maps[mapIndex];
        const sellPrice = Math.floor(map.value * 0.7);
        player.gold += sellPrice;
        player.maps.splice(mapIndex, 1);

        player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        return { success: true, gold: sellPrice, mapName: map.name };
    },

    /**
     * Buy a map
     */
    buyMap(player, mapData, price) {
        if (player.gold < price) {
            return { success: false, reason: 'Not enough gold.' };
        }

        player.gold -= price;
        if (!player.maps) player.maps = [];
        player.maps.push(mapData);

        player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.05);
        return { success: true };
    },

    // ── Daily Processing ───────────────────────
    /**
     * Process cartography events each turn
     */
    processTurn(world) {
        // Kingdoms may commission propaganda maps
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.capital) continue;
            if (!kingdom.cartography) {
                kingdom.cartography = { mapsOwned: [], mapsMade: 0, propagandaMaps: [], cartographerHired: false };
            }

            // Small chance to generate propaganda during wartime
            if (kingdom.wars && kingdom.wars.length > 0 && Utils.random() < Cartography.PROPAGANDA_CHANCE) {
                const propMap = Cartography.generatePropagandaMap(kingdom, world);
                if (propMap) {
                    kingdom.cartography.propagandaMaps.push(propMap);
                    if (kingdom.cartography.propagandaMaps.length > 3) {
                        kingdom.cartography.propagandaMaps.shift();
                    }
                    world.events.push({
                        text: `📣 ${kingdom.name} has published a new "official" map showing expanded borders.`,
                        type: 'cartography',
                        category: 'POLITICAL',
                    });
                }
            }
        }
    },

    // ── Internal Tile Charting ──────────────────
    /**
     * Chart tiles in a radius with given accuracy
     */
    _chartTiles(centerQ, centerR, radius, world, accuracy) {
        const charted = [];
        const hexes = Hex.hexesInRange(centerQ, centerR, radius);

        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (!tile) continue;
            if (Utils.random() > accuracy) continue;

            const entry = {
                q: hex.q,
                r: hex.r,
                terrain: tile.terrain.id,
                hasSettlement: !!tile.settlement,
                settlementName: tile.settlement ? tile.settlement.name : null,
                kingdom: tile.kingdom,
                hasResource: !!tile.resource,
                resource: tile.resource || null,
            };
            charted.push(entry);
        }

        return charted;
    },

    /**
     * Chart tiles belonging to a kingdom
     */
    _chartKingdomTiles(kingdom, world, accuracy) {
        const charted = [];
        if (!kingdom.territory) return charted;

        for (const t of kingdom.territory) {
            if (Utils.random() > accuracy) continue;
            const tile = world.getTile(t.q, t.r);
            if (!tile) continue;

            charted.push({
                q: t.q,
                r: t.r,
                terrain: tile.terrain.id,
                hasSettlement: !!tile.settlement,
                settlementName: tile.settlement ? tile.settlement.name : null,
                kingdom: kingdom.id,
                hasResource: !!tile.resource,
                resource: tile.resource || null,
            });
        }

        return charted;
    },

    /**
     * Chart propaganda tiles (exaggerated territory)
     */
    _chartPropagandaTiles(kingdom, world) {
        const charted = Cartography._chartKingdomTiles(kingdom, world, 0.9);

        // Add false border claims
        if (kingdom.territory) {
            for (const t of kingdom.territory) {
                const neighbors = Hex.neighbors(t.q, t.r);
                for (const n of neighbors) {
                    const tile = world.getTile(n.q, n.r);
                    if (tile && tile.terrain.passable && tile.kingdom !== kingdom.id && Utils.random() < 0.4) {
                        charted.push({
                            q: n.q,
                            r: n.r,
                            terrain: tile.terrain.id,
                            hasSettlement: !!tile.settlement,
                            settlementName: tile.settlement ? tile.settlement.name : null,
                            kingdom: kingdom.id,  // FALSE — claims this tile
                            hasResource: !!tile.resource,
                            resource: tile.resource || null,
                        });
                    }
                }
            }
        }

        return charted;
    },

    /**
     * Get a descriptive region name based on coordinates
     */
    _getRegionName(q, r, world) {
        const tile = world.getTile(q, r);
        if (!tile) return 'Unknown Region';

        // Check for nearby settlement
        const hexes = Hex.hexesInRange(q, r, 3);
        for (const h of hexes) {
            const t = world.getTile(h.q, h.r);
            if (t && t.settlement) return `the ${t.settlement.name} Region`;
        }

        // Use terrain descriptors
        const terrainNames = {
            forest: 'the Woodlands', dense_forest: 'the Deep Forest',
            plains: 'the Plains', grassland: 'the Grasslands',
            mountains: 'the Mountains', hills: 'the Hills',
            desert: 'the Desert', tundra: 'the Frozen North',
            swamp: 'the Marshes', coast: 'the Coast',
        };

        return terrainNames[tile.terrain.id] || `Region (${q},${r})`;
    },

    // ── Player Cartography Data ────────────────
    /**
     * Get player's maps collection with display data
     */
    getPlayerMaps(player) {
        return player.maps || [];
    },

    /**
     * Count tiles the player has personally explored
     */
    countExploredTiles(world) {
        let count = 0;
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                if (world.tiles[r][q].explored) count++;
            }
        }
        return count;
    },

    /**
     * Get cartography skill level description
     */
    getSkillDescription(skill) {
        if (skill >= 9) return 'Grand Cartographer';
        if (skill >= 7) return 'Master Cartographer';
        if (skill >= 5) return 'Journeyman Cartographer';
        if (skill >= 3) return 'Apprentice Cartographer';
        if (skill >= 1) return 'Novice Map-Maker';
        return 'No cartographic training';
    },

    /**
     * Check if player can detect propaganda/errors in a map
     */
    canDetectErrors(player, map) {
        const skill = player.skills.cartography || 0;
        const intelligence = player.intelligence || 5;
        const detectChance = (skill * 0.08) + (intelligence * 0.03);
        return Utils.random() < detectChance;
    },
});
