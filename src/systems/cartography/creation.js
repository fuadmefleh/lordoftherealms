// Cartography — creation members (split from the original monolith).
import { Cartography } from './_ref.js';
import { Utils, Hex, KingdomAtlas } from './_imports.js';

Object.assign(Cartography, {
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
        const shuffled = Utils.shuffle ? Utils.shuffle([...pois]) : pois.sort(() => Utils.random() - 0.5);

        for (let i = 0; i < Math.min(mapCount, shuffled.length); i++) {
            const poi = shuffled[i];
            if (!poi.tile.improvement.loot) poi.tile.improvement.loot = [];
            const ancientMap = Cartography.generateAncientMap(world, poi.q, poi.r);
            poi.tile.improvement.loot.push(ancientMap);
        }

        // Give kingdoms initial cartographic knowledge
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive) continue;
            kingdom.cartography = null;
            KingdomAtlas.ensure(kingdom); // royal archive (world/kingdomAtlas.js)
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
            id: `map_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
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
            id: `map_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
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
            id: `map_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
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
            id: `prop_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
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
            id: `ancient_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
            type: 'ancient',
            name: `Ancient Map Fragment — ${Cartography._getRegionName(targetQ, targetR, world)}`,
            icon: '📜',
            quality: 'crude',
            accuracy: 0.5 + Utils.random() * 0.3,
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
            if (Utils.random() < 0.3) {
                targetTile.buried.items.push('ancient_relic');
            }
        }

        const map = {
            id: `treasure_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
            type: 'treasure',
            name: 'Treasure Map',
            icon: '💎',
            quality: 'basic',
            accuracy: 0.7 + Utils.random() * 0.2,
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
});
