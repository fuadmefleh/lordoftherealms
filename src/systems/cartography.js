// ============================================
// CARTOGRAPHY — Map-making profession, map trading,
//   stolen maps, propaganda maps, ancient maps,
//   deliberate errors, accuracy from exploration
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';


export const Cartography = {

    // ── Configuration ──────────────────────────

    /** Cost to create a basic regional map */
    MAP_CREATION_COST: 30,

    /** Cost to create a detailed survey map */
    SURVEY_COST: 80,

    /** Base gold value of a map for trading */
    BASE_MAP_VALUE: 25,

    /** Base price to buy a map at a settlement */
    BUY_MAP_PRICE: 60,

    /** Skill gain per map created */
    SKILL_GAIN_CREATE: 0.15,

    /** Skill gain per tile charted */
    SKILL_GAIN_CHART: 0.002,

    /** Max deliberate errors that can be injected */
    MAX_DELIBERATE_ERRORS: 8,

    /** Chance per day a kingdom generates a propaganda map */
    PROPAGANDA_CHANCE: 0.005,

    /** Map quality tiers */
    QUALITY: {
        crude:      { label: 'Crude',      icon: '📜', accuracy: 0.40, minSkill: 0, value: 15 },
        basic:      { label: 'Basic',      icon: '🗺️', accuracy: 0.60, minSkill: 2, value: 30 },
        detailed:   { label: 'Detailed',   icon: '📐', accuracy: 0.80, minSkill: 4, value: 60 },
        masterwork: { label: 'Masterwork', icon: '🏆', accuracy: 0.95, minSkill: 7, value: 120 },
    },

    /** Map types */
    MAP_TYPES: {
        regional: {
            id: 'regional',
            name: 'Regional Map',
            icon: '🗺️',
            description: 'Shows terrain and settlements in a region',
            radius: 15,
            cost: 30,
        },
        survey: {
            id: 'survey',
            name: 'Survey Map',
            icon: '📐',
            description: 'Detailed survey showing resources and terrain',
            radius: 10,
            cost: 80,
        },
        kingdom: {
            id: 'kingdom',
            name: 'Kingdom Map',
            icon: '👑',
            description: 'Reveals all territory of a kingdom',
            radius: 0,  // Uses kingdom territory tiles, not radius
            cost: 120,
        },
        propaganda: {
            id: 'propaganda',
            name: 'Propaganda Map',
            icon: '📣',
            description: 'Shows exaggerated borders — may be inaccurate',
            radius: 25,
            cost: 0,
        },
        ancient: {
            id: 'ancient',
            name: 'Ancient Map',
            icon: '📜',
            description: 'Fragment of an old map revealing forgotten places',
            radius: 15,
            cost: 0,
        },
        stolen: {
            id: 'stolen',
            name: 'Stolen Map',
            icon: '🗡️',
            description: 'Acquired through dubious means',
            radius: 18,
            cost: 0,
        },
        treasure: {
            id: 'treasure',
            name: 'Treasure Map',
            icon: '💎',
            description: 'Marks the location of buried valuables',
            radius: 3,
            cost: 0,
        },
        continent: {
            id: 'continent',
            name: 'Continent Map',
            icon: '🌍',
            description: 'Reveals an entire continent — extremely rare',
            radius: 0,  // Uses regionId, not radius
            cost: 5000,
        },
    },


    // ── Initialization ─────────────────────────

    /**
     * Initialize cartography for world — seed ancient maps into POIs and taverns
     */
    initialize(world) {
        // Scatter some ancient map fragments in ruins/caves
        const pois = [];
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (tile.improvement && (tile.improvement.type === 'ruins' || tile.improvement.type === 'cave')) {
                    pois.push({ q, r, tile });
                }
            }
        }

        // 20-40% of ruins/caves get an ancient map
        const mapCount = Math.max(2, Math.floor(pois.length * Utils.randFloat(0.20, 0.40)));
        const shuffled = Utils.shuffle ? Utils.shuffle([...pois]) : pois.sort(() => Math.random() - 0.5);

        for (let i = 0; i < Math.min(mapCount, shuffled.length); i++) {
            const poi = shuffled[i];
            if (!poi.tile.improvement.loot) poi.tile.improvement.loot = [];
            const ancientMap = Cartography.generateAncientMap(world, poi.q, poi.r);
            poi.tile.improvement.loot.push(ancientMap);
        }

        // Give kingdoms initial cartographic knowledge
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive) continue;
            kingdom.cartography = {
                mapsOwned: [],
                mapsMade: 0,
                propagandaMaps: [],
                cartographerHired: false,
            };
        }
    },


    // ── Map Generation ─────────────────────────

    /**
     * Determine map quality based on player skill
     */
    getQualityForSkill(skill) {
        if (skill >= 7) return 'masterwork';
        if (skill >= 4) return 'detailed';
        if (skill >= 2) return 'basic';
        return 'crude';
    },

    /**
     * Create a regional map centered on player position
     */
    createRegionalMap(player, world) {
        const skill = player.skills.cartography || 0;
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const mapType = Cartography.MAP_TYPES.regional;

        const map = {
            id: `map_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'regional',
            name: `Regional Map of ${Cartography._getRegionName(player.q, player.r, world)}`,
            icon: qualityData.icon,
            quality: quality,
            accuracy: qualityData.accuracy + (skill * 0.02),
            centerQ: player.q,
            centerR: player.r,
            radius: mapType.radius,
            createdDay: world.day,
            createdBy: player.name,
            value: Math.floor(qualityData.value * (1 + skill * 0.1)),
            tiles: Cartography._chartTiles(player.q, player.r, mapType.radius, world, qualityData.accuracy + (skill * 0.02)),
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: false,
            notes: '',
        };

        return map;
    },

    /**
     * Create a detailed survey map
     */
    createSurveyMap(player, world) {
        const skill = player.skills.cartography || 0;
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const mapType = Cartography.MAP_TYPES.survey;

        const map = {
            id: `map_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'survey',
            name: `Survey of ${Cartography._getRegionName(player.q, player.r, world)}`,
            icon: '📐',
            quality: quality,
            accuracy: Math.min(1.0, qualityData.accuracy + (skill * 0.03)),
            centerQ: player.q,
            centerR: player.r,
            radius: mapType.radius,
            createdDay: world.day,
            createdBy: player.name,
            value: Math.floor(qualityData.value * 1.5 * (1 + skill * 0.1)),
            tiles: Cartography._chartTiles(player.q, player.r, mapType.radius, world, Math.min(1.0, qualityData.accuracy + (skill * 0.03))),
            showResources: true,
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: false,
            notes: '',
        };

        return map;
    },

    /**
     * Create a kingdom map (showing borders)
     */
    createKingdomMap(player, world, kingdomId) {
        const skill = player.skills.cartography || 0;
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const kingdom = world.getKingdom(kingdomId);
        if (!kingdom) return null;

        const map = {
            id: `map_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'kingdom',
            name: `Map of ${kingdom.name}`,
            icon: '👑',
            quality: quality,
            accuracy: qualityData.accuracy + (skill * 0.02),
            kingdomId: kingdomId,
            centerQ: kingdom.capital ? kingdom.capital.q : player.q,
            centerR: kingdom.capital ? kingdom.capital.r : player.r,
            radius: Cartography.MAP_TYPES.kingdom.radius,
            createdDay: world.day,
            createdBy: player.name,
            value: Math.floor(qualityData.value * 2 * (1 + skill * 0.15)),
            tiles: Cartography._chartKingdomTiles(kingdom, world, qualityData.accuracy + (skill * 0.02)),
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: false,
            notes: '',
        };

        return map;
    },

    /**
     * Generate a propaganda map (shows false borders for a kingdom)
     */
    generatePropagandaMap(kingdom, world) {
        if (!kingdom || !kingdom.capital) return null;

        const map = {
            id: `prop_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'propaganda',
            name: `Official Map of ${kingdom.name}`,
            icon: '📣',
            quality: 'detailed',
            accuracy: 0.4,
            kingdomId: kingdom.id,
            centerQ: kingdom.capital.q,
            centerR: kingdom.capital.r,
            radius: Cartography.MAP_TYPES.propaganda.radius,
            createdDay: world.day,
            createdBy: `${kingdom.ruler}'s Court Cartographer`,
            value: 40,
            tiles: Cartography._chartPropagandaTiles(kingdom, world),
            deliberateErrors: Cartography._generateBorderLies(kingdom, world),
            isPropaganda: true,
            isStolen: false,
            isAncient: false,
            propagandaKingdom: kingdom.id,
            notes: `Official map commissioned by ${kingdom.ruler}. Some borders may be... aspirational.`,
        };

        return map;
    },

    /**
     * Generate an ancient map (reveals forgotten sites)
     */
    generateAncientMap(world, fromQ, fromR) {
        // Pick a random distant location
        const targetQ = Utils.randInt(0, world.width - 1);
        const targetR = Utils.randInt(5, world.height - 6);
        const radius = Cartography.MAP_TYPES.ancient.radius;

        // Find interesting things near that location
        const sites = [];
        const hexes = Hex.hexesInRange(targetQ, targetR, radius);
        for (const h of hexes) {
            const tile = world.getTile(h.q, h.r);
            if (!tile) continue;
            if (tile.improvement) sites.push({ q: h.q, r: h.r, type: tile.improvement.type, name: tile.improvement.name });
            if (tile.resource) sites.push({ q: h.q, r: h.r, type: 'resource', name: tile.resource });
            if (tile.holySite) sites.push({ q: h.q, r: h.r, type: 'holy_site', name: tile.holySite.name });
        }

        const map = {
            id: `ancient_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'ancient',
            name: `Ancient Map Fragment — ${Cartography._getRegionName(targetQ, targetR, world)}`,
            icon: '📜',
            quality: 'crude',
            accuracy: 0.5 + Math.random() * 0.3,
            centerQ: targetQ,
            centerR: targetR,
            radius: radius,
            createdDay: 0,
            createdBy: 'Unknown',
            value: 50 + sites.length * 15,
            tiles: Cartography._chartTiles(targetQ, targetR, radius, world, 0.5),
            sites: sites,
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: true,
            notes: `A weathered parchment showing lands long forgotten. ${sites.length > 0 ? `Marks ${sites.length} notable location${sites.length > 1 ? 's' : ''}.` : 'The markings are faded.'}`,
        };

        return map;
    },

    /**
     * Generate a treasure map pointing to a hidden cache
     */
    generateTreasureMap(world) {
        // Pick a random passable tile
        let targetQ, targetR, targetTile;
        for (let attempt = 0; attempt < 50; attempt++) {
            targetQ = Utils.randInt(0, world.width - 1);
            targetR = Utils.randInt(5, world.height - 6);
            targetTile = world.getTile(targetQ, targetR);
            if (targetTile && targetTile.terrain.passable && !targetTile.settlement) break;
        }
        if (!targetTile || !targetTile.terrain.passable) return null;

        // Mark the tile with buried treasure
        if (!targetTile.buried) {
            targetTile.buried = {
                gold: Utils.randInt(100, 500),
                items: [],
                discovered: false,
            };
            // Sometimes include a bonus item
            if (Math.random() < 0.3) {
                targetTile.buried.items.push('ancient_relic');
            }
        }

        const map = {
            id: `treasure_${Date.now()}_${Utils.randInt(0, 9999)}`,
            type: 'treasure',
            name: 'Treasure Map',
            icon: '💎',
            quality: 'basic',
            accuracy: 0.7 + Math.random() * 0.2,
            centerQ: targetQ,
            centerR: targetR,
            radius: 3,
            createdDay: 0,
            createdBy: 'Unknown',
            value: 80,
            treasureQ: targetQ,
            treasureR: targetR,
            tiles: [],
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: false,
            notes: `"X marks the spot" — hints at treasure near ${Cartography._getRegionName(targetQ, targetR, world)}.`,
        };

        return map;
    },


    // ── Deliberate Errors ──────────────────────

    /**
     * Add deliberate errors to a map (for security / deception)
     */
    addDeliberateErrors(map, count, world) {
        const errors = [];
        const hexes = Hex.hexesInRange(map.centerQ, map.centerR, map.radius);

        for (let i = 0; i < count && i < Cartography.MAX_DELIBERATE_ERRORS; i++) {
            const hex = Utils.randPick(hexes);
            if (!hex) continue;
            const tile = world.getTile(hex.q, hex.r);
            if (!tile) continue;

            const errorTypes = ['terrain', 'settlement', 'path'];
            const errorType = Utils.randPick(errorTypes);

            let error;
            switch (errorType) {
                case 'terrain':
                    error = { q: hex.q, r: hex.r, type: 'terrain', false_terrain: Utils.randPick(['forest', 'mountains', 'swamp', 'desert']), real_terrain: tile.terrain.id };
                    break;
                case 'settlement':
                    error = { q: hex.q, r: hex.r, type: 'settlement', false_settlement: Utils.randPick(['Phantom Town', 'Lost Village', 'Ghost Keep']), has_real_settlement: !!tile.settlement };
                    break;
                case 'path':
                    error = { q: hex.q, r: hex.r, type: 'path', false_road: true, has_real_road: !!(tile.infrastructure) };
                    break;
            }

            if (error) errors.push(error);
        }

        map.deliberateErrors = errors;
        map.accuracy = Math.max(0.2, map.accuracy - (count * 0.05));
        map.notes = (map.notes ? map.notes + ' ' : '') + `[${count} deliberate alteration${count > 1 ? 's' : ''} applied]`;
        return map;
    },

    /**
     * Generate false border claims for propaganda maps
     */
    _generateBorderLies(kingdom, world) {
        const lies = [];
        if (!kingdom.territory || kingdom.territory.length === 0) return lies;

        // Claim neighboring non-owned tiles as territory
        const borderTiles = new Set();
        for (const t of kingdom.territory) {
            const neighbors = Hex.neighbors(t.q, t.r);
            for (const n of neighbors) {
                const tile = world.getTile(n.q, n.r);
                if (tile && tile.terrain.passable && tile.kingdom !== kingdom.id) {
                    borderTiles.add(`${n.q},${n.r}`);
                }
            }
        }

        // Claim 30-60% of border tiles
        const borderArr = [...borderTiles];
        const claimCount = Math.floor(borderArr.length * Utils.randFloat(0.3, 0.6));
        for (let i = 0; i < claimCount; i++) {
            const key = Utils.randPick(borderArr);
            if (key) {
                const [q, r] = key.split(',').map(Number);
                lies.push({ q, r, type: 'false_border', claimedKingdom: kingdom.id });
            }
        }

        return lies;
    },


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
                        if (Math.random() > accuracy) continue;
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
                if (Math.random() > accuracy) continue;
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
        const roll = Math.random();

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
                    accuracy: 0.6 + Math.random() * 0.2,
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
                accuracy: 0.5 + Math.random() * 0.3,
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
        if (isCity && Math.random() < 0.3) {
            const tMap = Cartography.generateTreasureMap(world);
            if (tMap) {
                maps.push({
                    map: tMap,
                    price: Utils.randInt(80, 200),
                });
            }
        }

        // Chance of ancient map (15%)
        if (Math.random() < 0.15) {
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
        if (settlement.type === 'capital' && Math.random() < 0.03) {
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
            if (kingdom.wars && kingdom.wars.length > 0 && Math.random() < Cartography.PROPAGANDA_CHANCE) {
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
            if (Math.random() > accuracy) continue;

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
            if (Math.random() > accuracy) continue;
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
                    if (tile && tile.terrain.passable && tile.kingdom !== kingdom.id && Math.random() < 0.4) {
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
        return Math.random() < detectChance;
    },
};
