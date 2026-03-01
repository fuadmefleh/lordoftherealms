// ============================================
// WORLD — World state management
// ============================================

import { Terrain } from './terrain.js';
import { Kingdom } from './kingdom.js';
import { WeatherSystem } from './weather.js';
import { NPCLords } from './npcLords.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { WorldEvents } from './worldEvents.js';
import { WorldUnit } from './units.js';
import { Characters } from './characters.js';
import { Religion } from '../systems/religion.js';
import { Culture } from '../systems/culture.js';
import { Peoples } from '../systems/peoples.js';
import { Colonization } from './colonization.js';
import { Cartography } from '../systems/cartography.js';

export class World {
    constructor(width = 70, height = 45) {
        this.width = width;
        this.height = height;
        this.tiles = [];
        this.kingdoms = [];
        this.day = 1;
        this.season = 'Spring';
        this.baseYear = 853;
        this.year = this.baseYear;
        this.history = [];
        this.events = [];
        this.units = [];
        this.weather = new WeatherSystem(this);
    }

    /**
     * Generate the entire world
     */
    generate(terrainParams = {}) {
        console.log('Generating terrain...');
        // Generate terrain
        this.tiles = Terrain.generateMap(this.width, this.height, terrainParams);
        console.log('Terrain generated');

        console.log('Creating kingdoms...');
        // Create kingdoms — respect kingdomCount parameter
        const kingdomCount = terrainParams.kingdomCount || Kingdom.DEFAULTS.length;
        let kingdomDefs = Kingdom.DEFAULTS.slice(0, Math.min(kingdomCount, Kingdom.DEFAULTS.length));

        // If more kingdoms requested than defaults, generate extra ones
        if (kingdomCount > Kingdom.DEFAULTS.length) {
            const extraCount = kingdomCount - Kingdom.DEFAULTS.length;
            const extraColors = ['#e91e63', '#9c27b0', '#3f51b5', '#009688', '#ff5722', '#607d8b', '#cddc39', '#ff9800', '#4caf50', '#673ab7',
                                 '#f44336', '#00bcd4', '#8bc34a', '#ffc107', '#03a9f4', '#9e9e9e', '#795548', '#ffeb3b', '#2196f3', '#ff6f00'];
            const extraCultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime', 'Mountain', 'Nordic', 'Desert', 'Arcane', 'Swamp'];
            const terrainPrefs = {
                Imperial: ['plains', 'grassland', 'hills'],
                Woodland: ['forest', 'dense_forest', 'grassland'],
                Nomadic: ['plains', 'savanna', 'desert'],
                Religious: ['desert', 'hills', 'plains'],
                Maritime: ['coast', 'beach', 'grassland'],
                Mountain: ['mountains', 'hills', 'tundra'],
                Nordic: ['tundra', 'mountains', 'coast'],
                Desert: ['desert', 'savanna', 'plains'],
                Arcane: ['hills', 'plains', 'desert'],
                Swamp: ['swamp', 'wetland', 'forest']
            };
            const traitsList = [['militaristic', 'orderly'], ['peaceful', 'nature-loving'], ['aggressive', 'mobile'],
                               ['religious', 'scholarly'], ['mercantile', 'naval'], ['defensive', 'industrious'],
                               ['aggressive', 'seafaring'], ['mercantile', 'resilient'], ['scholarly', 'arcane'], ['secretive', 'alchemical']];
            const namePrefix = ['Grand Duchy of', 'Empire of', 'Free City of', 'Chiefdom of', 'Confederation of',
                               'Principality of', 'Kingdom of', 'Republic of', 'Tribal Lands of', 'Dominion of'];
            const nameSuffix = ['Thornwall', 'Brightmoor', 'Darkholme', 'Stormreach', 'Ironcliff', 'Sunvale', 'Mistpeak',
                               'Shadowveil', 'Goldmere', 'Crystalshore', 'Ravencrest', 'Embervale', 'Starfall', 'Ashford',
                               'Dawnbreak', 'Nighthollow', 'Silversong', 'Flamecrest', 'Windridge', 'Deepwater'];

            for (let i = 0; i < extraCount; i++) {
                const culture = extraCultures[i % extraCultures.length];
                const color = extraColors[i % extraColors.length];
                const r = parseInt(color.slice(1, 3), 16);
                const g = parseInt(color.slice(3, 5), 16);
                const b = parseInt(color.slice(5, 7), 16);
                kingdomDefs.push({
                    id: 'gen_kingdom_' + (i + 1),
                    name: namePrefix[i % namePrefix.length] + ' ' + nameSuffix[i % nameSuffix.length],
                    ruler: 'Ruler ' + (i + 1),
                    color: color,
                    colorLight: `rgba(${r}, ${g}, ${b}, 0.2)`,
                    culture: culture,
                    description: 'A realm born of the world\'s creation.',
                    preferredTerrain: terrainPrefs[culture] || ['plains', 'grassland'],
                    traits: traitsList[i % traitsList.length],
                });
            }
        }

        this.kingdoms = kingdomDefs.map(def => Kingdom.create(def));

        console.log('Placing kingdoms on map...');
        // Place kingdoms on map
        Kingdom.placeKingdoms(this.kingdoms, this.tiles, this.width, this.height);
        console.log('Kingdoms placed');

        // Initialize diplomatic relations
        Kingdom.initRelations(this.kingdoms);

        console.log('Initializing NPC lords...');
        // Initialize lords for all kingdoms
        NPCLords.initializeLords(this);

        console.log('Initializing character system...');
        // Initialize dynasty, advisors, marriages for all kingdoms
        if (typeof Characters !== 'undefined') {
            Characters.initialize(this);
        }

        console.log('Placing independent settlements...');
        // Scatter some independent settlements
        const indepSettlementFreq = terrainParams.independentSettlements || 'normal';
        this.placeIndependentSettlements(indepSettlementFreq);

        console.log('Placing points of interest...');
        // Place some villages as points of interest
        const ruinsFreq = terrainParams.ruinsFreq || 'normal';
        this.placePointsOfInterest(ruinsFreq);

        console.log('Generating road network...');
        this.generateRoads();

        console.log('Generating world history...');
        this.history = WorldEvents.generateHistory(this);

        // Initialize world religion system
        console.log('Initializing religions & holy sites...');
        if (typeof Religion !== 'undefined') {
            Religion.initialize(this);
        }

        // Initialize cultural system
        console.log('Initializing cultural traditions...');
        if (typeof Culture !== 'undefined') {
            Culture.initialize(this);
        }

        // Initialize multicultural peoples system
        console.log('Initializing multicultural peoples...');
        if (typeof Peoples !== 'undefined') {
            Peoples.initialize(this);
        }

        // Initialize colonization system (indigenous populations, kingdom policies)
        console.log('Initializing colonization system...');
        if (typeof Colonization !== 'undefined') {
            Colonization.initialize(this);
        }

        // Initialize cartography system (ancient maps in ruins, kingdom cartography)
        console.log('Initializing cartography system...');
        if (typeof Cartography !== 'undefined') {
            Cartography.initialize(this);
        }

        // Populate the world with initial units so it feels alive from the start
        console.log('Spawning initial world units...');
        this.spawnInitialUnits();

        console.log(`World generated: ${this.width}x${this.height}, ${this.kingdoms.length} kingdoms`);
    }

    /**
     * Load a world from editor data (custom world).
     * Converts the flat terrain-id array into full game tile objects
     * and runs kingdom placement + all post-generation init.
     */
    loadFromEditorData(editorData, kingdomCount = 6) {
        console.log('Loading custom world from editor data...');
        this.width = editorData.width;
        this.height = editorData.height;

        // Build a lookup: terrain id string → Terrain.TYPES reference
        const typeById = {};
        for (const [key, val] of Object.entries(Terrain.TYPES)) {
            typeById[val.id] = val;
        }

        // Construct tiles[r][q] with full tile objects
        this.tiles = [];
        for (let r = 0; r < this.height; r++) {
            const row = [];
            for (let q = 0; q < this.width; q++) {
                const terrainId = editorData.tiles[r * this.width + q] || 'ocean';
                const terrainType = typeById[terrainId] || Terrain.TYPES.OCEAN;

                // Estimate elevation/heat/moisture from terrain type
                const elev = this._estimateElevation(terrainType);
                const heat = this._estimateHeat(terrainType, r / this.height);
                const moist = this._estimateMoisture(terrainType);

                row.push({
                    q, r,
                    elevation: elev,
                    temperature: heat,
                    moisture: moist,
                    terrain: terrainType,
                    resource: null,
                    kingdom: null,
                    settlement: null,
                    improvement: null,
                    explored: false,
                    visible: false,
                    hasRiver: false,
                    hasRoad: false,
                    riverSource: false,
                });
            }
            this.tiles.push(row);
        }

        // Assign resources based on terrain type
        this._assignResources();

        // Create and place kingdoms
        const kCount = Math.min(kingdomCount, 15);
        let kingdomDefs = Kingdom.DEFAULTS.slice(0, Math.min(kCount, Kingdom.DEFAULTS.length));
        if (kCount > Kingdom.DEFAULTS.length) {
            // Generate extras — simplified
            for (let i = Kingdom.DEFAULTS.length; i < kCount; i++) {
                kingdomDefs.push({
                    id: 'gen_kingdom_' + (i + 1),
                    name: 'Kingdom ' + (i + 1),
                    ruler: 'Ruler ' + (i + 1),
                    color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
                    colorLight: 'rgba(128,128,128,0.2)',
                    culture: 'Imperial',
                    description: 'A realm born of custom creation.',
                    preferredTerrain: ['plains', 'grassland'],
                    traits: ['orderly'],
                });
            }
        }
        this.kingdoms = kingdomDefs.map(def => Kingdom.create(def));
        Kingdom.placeKingdoms(this.kingdoms, this.tiles, this.width, this.height);
        Kingdom.initRelations(this.kingdoms);

        // Run the same post-generation init as generate()
        NPCLords.initializeLords(this);
        if (typeof Characters !== 'undefined') Characters.initialize(this);
        this.placeIndependentSettlements('normal');
        this.placePointsOfInterest('normal');
        this.generateRoads();
        this.history = WorldEvents.generateHistory(this);
        if (typeof Religion !== 'undefined') Religion.initialize(this);
        if (typeof Culture !== 'undefined') Culture.initialize(this);
        if (typeof Peoples !== 'undefined') Peoples.initialize(this);
        if (typeof Colonization !== 'undefined') Colonization.initialize(this);
        if (typeof Cartography !== 'undefined') Cartography.initialize(this);
        this.spawnInitialUnits();

        console.log(`Custom world loaded: ${this.width}x${this.height}, ${this.kingdoms.length} kingdoms`);
    }

    /** Estimate elevation from terrain type (for custom worlds) */
    _estimateElevation(t) {
        const map = {
            deep_ocean: 0.15, ocean: 0.25, coast: 0.38, sea: 0.30,
            beach: 0.43, lake: 0.48, ice: 0.45, snow: 0.50,
            tundra: 0.52, grassland: 0.55, plains: 0.55, woodland: 0.55,
            boreal_forest: 0.58, seasonal_forest: 0.55, temperate_rainforest: 0.56,
            tropical_rainforest: 0.54, savanna: 0.52, desert: 0.50,
            hills: 0.68, mountain: 0.82, snow_peak: 0.95,
            swamp: 0.46, island: 0.48, highlands: 0.72,
        };
        return map[t.id] ?? 0.5;
    }

    /** Estimate heat from terrain type and latitude */
    _estimateHeat(t, latRatio) {
        const base = {
            ice: 0.05, snow: 0.1, snow_peak: 0.1, tundra: 0.2,
            boreal_forest: 0.3, seasonal_forest: 0.45,
            grassland: 0.5, plains: 0.5, woodland: 0.45,
            temperate_rainforest: 0.5, hills: 0.45, mountain: 0.3, highlands: 0.35,
            beach: 0.6, savanna: 0.7, desert: 0.8,
            tropical_rainforest: 0.85, swamp: 0.6, island: 0.65,
            deep_ocean: 0.4, ocean: 0.4, coast: 0.45, sea: 0.4, lake: 0.45,
        };
        const b = base[t.id] ?? 0.5;
        // Blend with latitude (equator=0.5 ratio, poles=0/1 ratio → hotter at equator)
        const latHeat = 1 - Math.abs(latRatio - 0.5) * 2;
        return b * 0.7 + latHeat * 0.3;
    }

    /** Estimate moisture from terrain type */
    _estimateMoisture(t) {
        const map = {
            deep_ocean: 0.9, ocean: 0.85, coast: 0.7, sea: 0.8, lake: 0.8,
            beach: 0.4, ice: 0.2, snow: 0.3, tundra: 0.3,
            grassland: 0.5, plains: 0.4, woodland: 0.55,
            boreal_forest: 0.6, seasonal_forest: 0.55, temperate_rainforest: 0.8,
            tropical_rainforest: 0.9, savanna: 0.35, desert: 0.1,
            hills: 0.4, mountain: 0.35, snow_peak: 0.3,
            swamp: 0.85, island: 0.5, highlands: 0.45,
        };
        return map[t.id] ?? 0.5;
    }

    /** Assign resources to tiles based on terrain type + random chance */
    _assignResources() {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const tile = this.tiles[r][q];
                const terrainId = tile.terrain.id;
                const chances = Terrain.RESOURCE_CHANCES[terrainId];
                if (!chances) continue;
                for (const { resource, chance } of chances) {
                    if (Math.random() < chance) {
                        tile.resource = resource;
                        break; // one resource per tile
                    }
                }
            }
        }
    }

    /**
     * Place independent (unaligned) settlements
     */
    placeIndependentSettlements(freq = 'normal') {
        const freqMap = { none: 0, few: 0.4, normal: 1.0, many: 2.0 };
        const mult = freqMap[freq] !== undefined ? freqMap[freq] : 1.0;
        const scaleFactor = Math.sqrt((this.width * this.height) / (120 * 80));
        const baseCount = Utils.randInt(8, 15);
        const numSettlements = Math.round(baseCount * mult * scaleFactor);
        if (numSettlements === 0) return;
        const existingSettlements = this.getAllSettlements();
        const minDistance = 4; // Minimum distance between settlements

        for (let i = 0; i < numSettlements; i++) {
            let attempts = 0;
            while (attempts < 200) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(Math.floor(this.height * 0.1), Math.floor(this.height * 0.9));
                const tile = this.tiles[r][q];

                if (!tile.terrain.passable || tile.settlement || tile.kingdom) continue;

                // Coastal preference: higher chance if next to ocean
                const isCoastal = Hex.neighbors(q, r).some(n => {
                    const nt = this.getTile(n.q, n.r);
                    return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean');
                });

                if (!isCoastal && Math.random() < 0.75) continue;

                // Check distance to all other settlements
                let tooClose = false;
                for (const settlement of existingSettlements) {
                    if (Hex.wrappingDistance(q, r, settlement.q, settlement.r, this.width) < minDistance) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                const newSettlement = {
                    type: 'village',
                    name: Kingdom.generateCityName(Utils.randPick(['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'])),
                    population: Utils.randInt(50, 500),
                    level: 0,
                    kingdom: null,
                    founded: Utils.randInt(500, 800),
                };

                tile.settlement = newSettlement;
                existingSettlements.push({ q, r, ...newSettlement });
                break;
            }
        }
    }

    /**
     * Place points of interest (ruins, shrines, etc.)
     */
    placePointsOfInterest(freq = 'normal') {
        const poiTypes = [
            { type: 'ruins', icon: '🏚️', name: 'Ancient Ruins' },
            { type: 'shrine', icon: '⛩️', name: 'Roadside Shrine' },
            { type: 'cave', icon: '🕳️', name: 'Mysterious Cave' },
            { type: 'oasis', icon: '🌴', name: 'Desert Oasis' },
            { type: 'monument', icon: '🗿', name: 'Stone Monument' },
        ];

        const freqMap = { none: 0, few: 0.4, normal: 1.0, many: 2.0 };
        const mult = freqMap[freq] !== undefined ? freqMap[freq] : 1.0;
        const scaleFactor = Math.sqrt((this.width * this.height) / (120 * 80));
        const baseCount = Utils.randInt(15, 30);
        const numPOI = Math.round(baseCount * mult * scaleFactor);
        if (numPOI === 0) return;
        const existingSettlements = this.getAllSettlements();
        // Also track existing POIs
        const existingPOIs = [];

        for (let i = 0; i < numPOI; i++) {
            let attempts = 0;
            while (attempts < 200) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(2, this.height - 3);
                const tile = this.tiles[r][q];

                if (!tile.terrain.passable || tile.settlement || tile.improvement) continue;

                // Check distance to settlements (don't want ruins right next to a city)
                let tooClose = false;
                for (const s of existingSettlements) {
                    if (Hex.wrappingDistance(q, r, s.q, s.r, this.width) < 2) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) { continue; }

                // Check distance to other POIs
                for (const p of existingPOIs) {
                    if (Hex.wrappingDistance(q, r, p.q, p.r, this.width) < 4) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) { continue; }

                const poi = Utils.randPick(poiTypes);
                tile.improvement = {
                    type: poi.type,
                    icon: poi.icon,
                    name: poi.name,
                    explored: false,
                    founded: Utils.randInt(100, 600),
                };
                existingPOIs.push({ q, r });
                break;
            }
        }
        
        console.log(`[World] Placed ${existingPOIs.length} Points of Interest`);
    }

    /**
     * Generate roads connecting settlements within the same region.
     * Uses A* pathfinding over passable land, preferring low-cost terrain.
     */
    generateRoads() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // Group settlements by regionId
        const regionGroups = new Map();
        for (const s of settlements) {
            const tile = this.getTile(s.q, s.r);
            if (!tile) continue;
            const rid = tile.regionId;
            if (rid === undefined || rid === null) continue;
            if (!regionGroups.has(rid)) regionGroups.set(rid, []);
            regionGroups.get(rid).push(s);
        }

        let totalRoadTiles = 0;

        for (const [regionId, regionSettlements] of regionGroups) {
            if (regionSettlements.length < 2) continue;

            // Build a minimum spanning tree of settlements by distance
            // to get a connected road network without redundant paths
            const connected = new Set();
            const edges = [];

            // Start with first settlement
            connected.add(0);

            while (connected.size < regionSettlements.length) {
                let bestEdge = null;
                let bestDist = Infinity;

                for (const ci of connected) {
                    for (let j = 0; j < regionSettlements.length; j++) {
                        if (connected.has(j)) continue;
                        const d = Hex.wrappingDistance(
                            regionSettlements[ci].q, regionSettlements[ci].r,
                            regionSettlements[j].q, regionSettlements[j].r,
                            this.width
                        );
                        if (d < bestDist) {
                            bestDist = d;
                            bestEdge = { from: ci, to: j };
                        }
                    }
                }

                if (!bestEdge) break;
                connected.add(bestEdge.to);
                edges.push(bestEdge);
            }

            // Pathfind each edge and mark tiles with hasRoad
            for (const edge of edges) {
                const s1 = regionSettlements[edge.from];
                const s2 = regionSettlements[edge.to];

                const path = this.findRoadPath(s1.q, s1.r, s2.q, s2.r);
                if (path) {
                    for (const step of path) {
                        const tile = this.getTile(step.q, step.r);
                        if (tile && tile.terrain.passable) {
                            tile.hasRoad = true;
                            totalRoadTiles++;
                        }
                    }
                }
            }
        }

        console.log(`[World] Generated road network: ${totalRoadTiles} road tiles`);
    }

    /**
     * A* pathfinding for road generation — prefers low moveCost terrain
     */
    findRoadPath(startQ, startR, endQ, endR) {
        const width = this.width;
        const height = this.height;
        const endWQ = Hex.wrapQ(endQ, width);

        const startKey = `${startQ},${startR}`;
        const endKey = `${endWQ},${endR}`;

        const openSet = [{ key: startKey, f: 0 }];
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        gScore.set(startKey, 0);

        let iterations = 0;
        const maxIterations = 3000;

        while (openSet.length > 0 && iterations < maxIterations) {
            iterations++;

            // Find node with lowest fScore
            let bestIdx = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
            }
            const current = openSet.splice(bestIdx, 1)[0];
            const currentKey = current.key;

            if (currentKey === endKey) {
                // Reconstruct path
                const path = [];
                let node = currentKey;
                while (node) {
                    const [q, r] = node.split(',').map(Number);
                    path.unshift({ q, r });
                    node = cameFrom.get(node);
                }
                return path;
            }

            closedSet.add(currentKey);
            const [cq, cr] = currentKey.split(',').map(Number);

            const neighbors = Hex.neighbors(cq, cr);
            for (const n of neighbors) {
                const nq = Hex.wrapQ(n.q, width);
                const nr = n.r;
                if (nr < 0 || nr >= height) continue;

                const nKey = `${nq},${nr}`;
                if (closedSet.has(nKey)) continue;

                const nTile = this.getTile(nq, nr);
                if (!nTile || !nTile.terrain.passable) continue;

                // Cost: use terrain moveCost so roads prefer easy terrain
                const moveCost = nTile.terrain.moveCost || 1;
                // Bonus: prefer tiles that already have a road
                const roadBonus = nTile.hasRoad ? 0.1 : 0;
                const tentG = (gScore.get(currentKey) || 0) + moveCost - roadBonus;

                if (tentG < (gScore.get(nKey) || Infinity)) {
                    cameFrom.set(nKey, currentKey);
                    gScore.set(nKey, tentG);
                    const h = Hex.wrappingDistance(nq, nr, endWQ, endR, width);
                    const nF = tentG + h;

                    // Check if already in openSet
                    const existing = openSet.findIndex(o => o.key === nKey);
                    if (existing >= 0) {
                        openSet[existing].f = nF;
                    } else {
                        openSet.push({ key: nKey, f: nF });
                    }
                }
            }
        }

        return null; // No path found
    }

    /**
     * Get tile at wrapped coordinates
     */
    getTile(q, r) {
        if (r < 0 || r >= this.height) return null;
        const wq = Hex.wrapQ(q, this.width);
        return this.tiles[r][wq];
    }

    /**
     * Get kingdom by ID
     */
    getKingdom(id) {
        return this.kingdoms.find(k => k.id === id);
    }

    /**
     * Advance one day
     */
    advanceDay() {
        this.day++;

        // Season tracking (30 days per season)
        const seasonNum = Math.floor(((this.day - 1) % 120) / 30);
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        this.season = seasons[seasonNum];
        this.year = this.baseYear + Math.floor((this.day - 1) / 120);

        // Clear previous events
        this.events = [];

        // Process NPC lord actions
        for (const kingdom of this.kingdoms) {
            if (kingdom.isAlive && kingdom.lord) {
                NPCLords.processLordActions(kingdom, this);
            }
        }

        // Process kingdom AI turns
        for (const kingdom of this.kingdoms) {
            if (kingdom.isAlive) {
                KingdomAI.processTurn(kingdom, this);
            }
        }

        // Process character system (dynasties, advisors, succession, marriages)
        if (typeof Characters !== 'undefined') {
            Characters.processTurn(this);
        }

        // Process wars
        KingdomAI.processWars(this);

        // Generate world events
        const worldEvents = WorldEvents.generateEvents(this);
        this.events.push(...worldEvents);

        // Process world religion (pilgrim income, heresies, holy site contestation)
        if (typeof Religion !== 'undefined') {
            Religion.processTurn(this);
        }

        // Process cultural events & influence
        if (typeof Culture !== 'undefined') {
            Culture.processTurn(this);
        }

        // Process multicultural peoples dynamics
        if (typeof Peoples !== 'undefined') {
            Peoples.processTurn(this);
        }

        // Process colonization (colony loyalty, indigenous, AI expansion)
        if (typeof Colonization !== 'undefined') {
            Colonization.processTurn(this);
        }

        // Process cartography (propaganda maps, kingdom cartography)
        if (typeof Cartography !== 'undefined') {
            Cartography.processTurn(this);
        }

        // Replenish market stock — settlements gradually restock goods
        const allSettlements = this.getAllSettlements();
        for (const s of allSettlements) {
            const tile = this.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.marketStock) continue;
            const stock = tile.settlement.marketStock;
            for (const goodId in stock) {
                if (stock[goodId] > 0) {
                    // Replenish ~10% per day (full restock in ~10 days)
                    const replenish = Math.max(1, Math.ceil(stock[goodId] * 0.1));
                    stock[goodId] = Math.max(0, stock[goodId] - replenish);
                }
            }
        }

        // Process units
        this.processUnits();

        return {
            day: this.day,
            season: this.season,
            year: this.year,
            events: this.events,
        };
    }

    /**
     * Spawn a healthy population of units at game start so the world feels alive
     */
    spawnInitialUnits() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // --- Caravans: one per settlement pair ---
        const caravanCount = Math.min(settlements.length, 12);
        for (let i = 0; i < caravanCount; i++) {
            const s1 = settlements[i % settlements.length];
            const t1 = this.getTile(s1.q, s1.r);
            if (!t1) continue;
            const reachable = settlements.filter(s => {
                if (s.q === s1.q && s.r === s1.r) return false;
                const t2 = this.getTile(s.q, s.r);
                return t2 && t2.regionId === t1.regionId;
            });
            if (reachable.length > 0) {
                const s2 = Utils.randPick(reachable);
                this.units.push(new WorldUnit('caravan', s1.q, s1.r, s2.q, s2.r));
            }
        }

        // --- Ships: from coastal settlements ---
        const coastalSettlements = settlements.filter(s => {
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = this.getTile(n.q, n.r);
                return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean' || nt.terrain.id === 'sea');
            });
        });
        const shipCount = Math.min(coastalSettlements.length * 2, 10);
        for (let i = 0; i < shipCount; i++) {
            const s1 = coastalSettlements[i % coastalSettlements.length];
            let waterRegionId = null;
            const neighbors1 = Hex.neighbors(s1.q, s1.r);
            for (const n of neighbors1) {
                const nt = this.getTile(n.q, n.r);
                if (nt && !nt.terrain.passable) {
                    waterRegionId = nt.regionId;
                    break;
                }
            }
            if (waterRegionId !== null) {
                const reachable = coastalSettlements.filter(s => {
                    if (s.q === s1.q && s.r === s1.r) return false;
                    return Hex.neighbors(s.q, s.r).some(n => {
                        const nt = this.getTile(n.q, n.r);
                        return nt && nt.regionId === waterRegionId;
                    });
                });
                if (reachable.length > 0) {
                    const s2 = Utils.randPick(reachable);
                    this.units.push(new WorldUnit('ship', s1.q, s1.r, s2.q, s2.r));
                }
            }
        }

        // --- Raiders: scattered on land ---
        for (let i = 0; i < 8; i++) {
            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                if (this.isPassable(q, r)) {
                    this.units.push(new WorldUnit('raider', q, r));
                    break;
                }
            }
        }

        // --- Pirates: on ocean tiles ---
        for (let i = 0; i < 5; i++) {
            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                const tile = this.getTile(q, r);
                if (tile && (tile.terrain.id === 'ocean' || tile.terrain.id === 'deep_ocean')) {
                    this.units.push(new WorldUnit('pirate', q, r));
                    break;
                }
            }
        }

        // --- Patrols: from kingdom capitals ---
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive) continue;
            const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
            if (capital) {
                // 2 patrols per kingdom
                this.units.push(new WorldUnit('patrol', capital.q, capital.r));
                this.units.push(new WorldUnit('patrol', capital.q, capital.r));
            }
        }

        // --- Lord Parties: one per kingdom, starting at capital ---
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive || !kingdom.lord) continue;
            const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
            if (capital) {
                const lordUnit = new WorldUnit('lord_party', capital.q, capital.r);
                lordUnit.kingdomId = kingdom.id;
                lordUnit.lordName = kingdom.lord.name;
                lordUnit.name = `${kingdom.lord.name}'s Procession`;
                this.units.push(lordUnit);
            }
        }

        // --- Settlers: a couple already on the move ---
        for (let i = 0; i < 2; i++) {
            const s = Utils.randPick(settlements);
            if (s) {
                this.units.push(new WorldUnit('settler', s.q, s.r));
            }
        }

        // Advance all units a few steps so they're mid-journey, not all clustered at settlements
        for (let step = 0; step < 5; step++) {
            for (const unit of this.units) {
                unit.update(this);
            }
            // Remove destroyed ones
            this.units = this.units.filter(u => !u.destroyed);
        }

        console.log(`Spawned ${this.units.length} initial world units`);
    }

    /**
     * Process all world units
     */
    processUnits() {
        if (!this.units) this.units = [];

        // Move units
        for (let i = this.units.length - 1; i >= 0; i--) {
            const unit = this.units[i];
            unit.update(this);
            if (unit.destroyed) {
                this.units.splice(i, 1);
            }
        }

        // Spawn new units if needed
        this.spawnUnits();
    }

    /**
     * Spawn dynamic units
     */
    spawnUnits() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // Spawn caravan
        if (this.units.filter(u => u.type === 'caravan').length < settlements.length) {
            if (Math.random() < 0.4) {
                const s1 = Utils.randPick(settlements);
                const t1 = this.getTile(s1.q, s1.r);
                if (t1) {
                    const reachable = settlements.filter(s => {
                        if (s.name === s1.name) return false;
                        const t2 = this.getTile(s.q, s.r);
                        return t2 && t2.regionId === t1.regionId;
                    });

                    if (reachable.length > 0) {
                        const s2 = Utils.randPick(reachable);
                        const caravan = new WorldUnit('caravan', s1.q, s1.r, s2.q, s2.r);
                        this.units.push(caravan);
                    }
                }
            }
        }

        // Spawn ship
        const coastalSettlements = settlements.filter(s => {
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = this.getTile(n.q, n.r);
                return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean');
            });
        });
        if (coastalSettlements.length >= 2 && this.units.filter(u => u.type === 'ship').length < coastalSettlements.length * 2) {
            if (Math.random() < 0.4) {
                const s1 = Utils.randPick(coastalSettlements);

                // Find water region for ship
                let waterRegionId = null;
                const neighbors1 = Hex.neighbors(s1.q, s1.r);
                for (const n of neighbors1) {
                    const nt = this.getTile(n.q, n.r);
                    if (nt && !nt.terrain.passable) {
                        waterRegionId = nt.regionId;
                        break;
                    }
                }

                if (waterRegionId !== null) {
                    const reachable = coastalSettlements.filter(s => {
                        if (s.name === s1.name) return false;
                        const neighbors2 = Hex.neighbors(s.q, s.r);
                        return neighbors2.some(n => {
                            const nt = this.getTile(n.q, n.r);
                            return nt && nt.regionId === waterRegionId;
                        });
                    });

                    if (reachable.length > 0) {
                        const s2 = Utils.randPick(reachable);
                        const ship = new WorldUnit('ship', s1.q, s1.r, s2.q, s2.r);
                        this.units.push(ship);
                    }
                }
            }
        }

        // Spawn raider
        if (this.units.filter(u => u.type === 'raider').length < 8) {
            // Only spawn raiders if zoomed in enough to see them, or if camera is not defined (e.g., headless mode)
            if (!this.camera || this.camera.zoom > 0.4) {
                if (Math.random() < 0.2) {
                    const q = Utils.randInt(0, this.width - 1);
                    const r = Utils.randInt(0, this.height - 1);
                    if (this.isPassable(q, r)) {
                        this.units.push(new WorldUnit('raider', q, r));
                    }
                }
            }
        }

        // Spawn pirate
        if (this.units.filter(u => u.type === 'pirate').length < 6) {
            if (Math.random() < 0.1) {
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                const tile = this.getTile(q, r);
                if (tile && (tile.terrain.id === 'ocean' || tile.terrain.id === 'deep_ocean')) {
                    this.units.push(new WorldUnit('pirate', q, r));
                }
            }
        }

        // Spawn patrol
        if (this.units.filter(u => u.type === 'patrol').length < 4) {
            if (Math.random() < 0.05) {
                const capital = settlements.find(s => s.type === 'capital');
                if (capital) {
                    this.units.push(new WorldUnit('patrol', capital.q, capital.r));
                }
            }
        }

        // Spawn settler
        if (this.day % 20 === 0 && Math.random() < 0.1 && this.units.filter(u => u.type === 'settler').length < 2) {
            const s = Utils.randPick(settlements);
            this.units.push(new WorldUnit('settler', s.q, s.r));
        }

        // Spawn lord parties for kingdoms that don't have one
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive || !kingdom.lord) continue;
            const hasLordParty = this.units.some(u => u.type === 'lord_party' && u.kingdomId === kingdom.id && !u.destroyed);
            if (!hasLordParty) {
                const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
                if (capital) {
                    const lordUnit = new WorldUnit('lord_party', capital.q, capital.r);
                    lordUnit.kingdomId = kingdom.id;
                    lordUnit.lordName = kingdom.lord.name;
                    lordUnit.name = `${kingdom.lord.name}'s Procession`;
                    this.units.push(lordUnit);
                }
            }
        }
    }

    /**
     * Generate random world events
     */
    generateEvents() {
        this.events = [];

        // Small chance of various events
        if (Math.random() < 0.05) {
            const k1 = Utils.randPick(this.kingdoms.filter(k => k.isAlive));
            const k2 = Utils.randPick(this.kingdoms.filter(k => k.isAlive && k.id !== k1.id));
            if (k1 && k2) {
                const eventTypes = [
                    { text: `Tensions rise between ${k1.name} and ${k2.name} `, type: 'diplomatic' },
                    { text: `A trade agreement is signed between ${k1.name} and ${k2.name} `, type: 'trade' },
                    { text: `Border skirmish reported between ${k1.name} and ${k2.name} `, type: 'military' },
                ];
                this.events.push(Utils.randPick(eventTypes));
            }
        }

        if (Math.random() < 0.03) {
            this.events.push({
                text: `Traveling merchants report a bountiful harvest in the ${this.season} `,
                type: 'economic'
            });
        }
    }

    /**
     * Check if a tile is passable for movement
     */
    isPassable(q, r) {
        const tile = this.getTile(q, r);
        if (!tile) return false;
        return tile.terrain.passable;
    }

    /**
     * Get all settlements in the world
     */
    getAllSettlements() {
        const settlements = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                if (this.tiles[r][q].settlement) {
                    settlements.push({
                        q, r,
                        ...this.tiles[r][q].settlement
                    });
                }
            }
        }
        return settlements;
    }
}
