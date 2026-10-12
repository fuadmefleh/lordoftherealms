// World — generation methods.
import { World } from './core.js';
import { Terrain, Kingdom, WeatherSystem, NPCLords, Hex, Utils, WorldEvents, WorldUnit, Characters, Religion, Culture, Peoples, Colonization, Cartography, KingdomAI } from './_imports.js';

Object.assign(World.prototype, {
    /**
     * Generate the entire world. Every world has a seed (drawn from the game
     * RNG when none is given), kept in `generationParams` and saved with the
     * game: generation runs on an RNG seeded from it, so reloading a save
     * regenerates the same terrain, realms and sites beneath the saved state.
     * The caller's RNG stream is restored afterwards.
     */
    generate(terrainParams = {}) {
        const seed = terrainParams.seed || Utils.randInt(1, 2147483646);
        this.generationParams = { ...terrainParams, seed };
        const outerRng = Utils.getRng();
        // A new world numbers its characters, maps, spies, ... from 1
        Utils.setIdCounter(0);
        Utils.setSeed(typeof seed === 'string' ? Math.abs(Utils.hashStr(seed)) : seed);
        try {
            if (this.generationParams.customWorld) this._buildCustomWorld(this.generationParams.customWorld);
            else this._generateWorld(this.generationParams);
            this.getAllSettlements(); // stamps each settlement with its q/r
        } finally {
            Utils.setRng(outerRng);
        }
    },

    _generateWorld(terrainParams) {
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
                Woodland: ['woodland', 'seasonal_forest', 'temperate_rainforest', 'grassland'],
                Nomadic: ['plains', 'savanna', 'desert'],
                Religious: ['desert', 'hills', 'plains'],
                Maritime: ['coast', 'beach', 'grassland'],
                Mountain: ['mountain', 'hills', 'highlands', 'tundra'],
                Nordic: ['tundra', 'mountain', 'boreal_forest', 'coast'],
                Desert: ['desert', 'savanna', 'plains'],
                Arcane: ['hills', 'plains', 'desert'],
                Swamp: ['swamp', 'tropical_rainforest', 'woodland']
            };
            // Capital siting keeps the ids the old lists actually matched
            // (see Kingdom.placementTerrain) so seeded worlds don't change
            const placementPrefs = {
                Woodland: ['grassland'],
                Mountain: ['hills', 'tundra'],
                Nordic: ['tundra', 'coast'],
                Swamp: ['swamp'],
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
                    ...(placementPrefs[culture] ? { placementTerrain: placementPrefs[culture] } : {}),
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
        // Two towns drew the same name? Rename the later ones (hash, no RNG).
        Kingdom.dedupeSettlementNames(this);

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
    },

    /**
     * Load a world from editor data (custom world). The editor data rides in
     * `generationParams.customWorld`, so resuming a saved game rebuilds the
     * same map (World.generate) instead of rolling a random one.
     */
    loadFromEditorData(editorData, kingdomCount = 6) {
        console.log('Loading custom world from editor data...');
        const rules = editorData.rules || {};
        const seed = Number(editorData.seed) || Math.abs(Utils.hashStr(String(editorData.name || 'custom'))) || 1;
        this.generate({
            seed,
            kingdomCount: rules.kingdomCount || kingdomCount,
            independentSettlements: rules.independentSettlements || 'normal',
            ruinsFreq: rules.ruinsFreq || 'normal',
            customWorld: editorData,
        });
    },

    _buildCustomWorld(editorData) {
        this.width = editorData.width;
        this.height = editorData.height;
        const rules = editorData.rules || {};
        const params = this.generationParams || {};
        const at = (key) => {
            const [q, r] = String(key).split(',').map(Number);
            if (!Number.isInteger(q) || !Number.isInteger(r)) return null;
            if (q < 0 || q >= this.width || r < 0 || r >= this.height) return null;
            return { q, r, tile: this.tiles[r][q] };
        };

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

        // Painted rivers. The renderer joins river tiles whose elevations
        // differ, so each gets a tiny per-hex nudge (a hash, no RNG draw)
        for (const key of Object.keys(editorData.rivers || {})) {
            const h = at(key);
            if (!h || !h.tile.terrain.passable) continue;
            h.tile.hasRiver = true;
            h.tile.elevation += (Math.abs(Utils.hashStr(key)) % 997 + 1) * 1e-6;
        }
        for (const row of this.tiles) {
            for (const tile of row) {
                if (!tile.hasRiver) continue;
                const near = Hex.neighbors(tile.q, tile.r)
                    .filter(n => n.r >= 0 && n.r < this.height)
                    .map(n => this.tiles[n.r][Hex.wrapQ(n.q, this.width)]);
                tile.riverSource = near.filter(t => t.hasRiver).length <= 1 && near.every(t => t.terrain.passable);
            }
        }

        // Connected land/water regions: roads, caravans and routing need them
        Terrain.identifyRegions(this.tiles, this.width, this.height);

        // Assign resources based on terrain type
        this._assignResources();

        // Hand-placed settlements and landmarks go down before the realms, so
        // a realm takes in the towns the map maker put in its lands
        const placedTowns = new Set();
        for (const [key, ovl] of Object.entries(editorData.overlays || {})) {
            const h = at(key);
            if (!h || !ovl) continue;
            const name = typeof ovl.name === 'string' && ovl.name.trim() ? ovl.name.trim() : null;
            const s = World.EDITOR_SETTLEMENTS[ovl.type];
            const lm = World.EDITOR_LANDMARKS[ovl.type];
            if (s && h.tile.terrain.passable) {
                h.tile.settlement = {
                    type: s.type,
                    name: name && name !== s.label ? name : Kingdom.generateCityName('Imperial'),
                    population: Utils.randInt(s.pop[0], s.pop[1]),
                    level: s.level,
                    kingdom: null,
                    founded: Utils.randInt(400, 820),
                    ...(ovl.type === 'port' ? { port: true } : {}),
                };
                placedTowns.add(`${h.q},${h.r}`);
            } else if (lm && (h.tile.terrain.passable || lm.water)) {
                h.tile.improvement = {
                    type: lm.type,
                    icon: lm.icon,
                    name: name || lm.name,
                    explored: false,
                    founded: Utils.randInt(100, 600),
                };
            }
        }

        // Painted roads
        for (const key of Object.keys(editorData.roadOverlays || {})) {
            const h = at(key);
            if (h && h.tile.terrain.passable) h.tile.hasRoad = true;
        }

        // Realms: the map maker's, seated where they were put; with none,
        // the usual random placement
        this.kingdoms = [];
        const realms = (editorData.realms || []).filter(k => k && k.id && k.capital && at(`${k.capital.q},${k.capital.r}`));
        if (realms.length) {
            const lands = {};
            for (const [key, id] of Object.entries(editorData.territory || {})) {
                const h = at(key);
                if (h) (lands[id] = lands[id] || []).push({ q: h.q, r: h.r });
            }
            for (const realm of realms) {
                const site = this._nearestLand(realm.capital.q, realm.capital.r);
                if (!site) continue;
                const kingdom = Kingdom.create(World.realmTemplate(realm));
                const own = lands[realm.id] || [];
                const capTile = this.tiles[site.r][site.q];
                Kingdom.foundAt(kingdom, site, this.tiles, this.width, this.height, {
                    territory: own,
                    // A realm the map maker gave towns doesn't get random ones too
                    towns: rules.realmTowns !== false && !own.some(t => placedTowns.has(`${t.q},${t.r}`)),
                    capitalName: (capTile.settlement && capTile.settlement.name) || realm.capitalName || null,
                });
                for (const t of kingdom.territory) {
                    const s = this.tiles[t.r][t.q].settlement;
                    if (s && !s.kingdom) s.kingdom = kingdom.id;
                }
                Kingdom.initializeKingdomStats(kingdom, this.tiles, this.width, this.height);
                this.kingdoms.push(kingdom);
            }
        }
        if (!this.kingdoms.length) {
            const kCount = Math.min(rules.kingdomCount || params.kingdomCount || 6, 15);
            let kingdomDefs = Kingdom.DEFAULTS.slice(0, Math.min(kCount, Kingdom.DEFAULTS.length));
            if (kCount > Kingdom.DEFAULTS.length) {
                // Generate extras — simplified
                for (let i = Kingdom.DEFAULTS.length; i < kCount; i++) {
                    kingdomDefs.push({
                        id: 'gen_kingdom_' + (i + 1),
                        name: 'Kingdom ' + (i + 1),
                        ruler: 'Ruler ' + (i + 1),
                        color: '#' + Math.floor(Utils.random()*16777215).toString(16).padStart(6,'0'),
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
        }
        Kingdom.initRelations(this.kingdoms);

        // Where the player begins (Player.placeInWorld reads it)
        const start = editorData.playerStart;
        this.playerStart = start && at(`${start.q},${start.r}`) ? this._nearestLand(start.q, start.r) : null;

        // Run the same post-generation init as generate()
        NPCLords.initializeLords(this);
        if (typeof Characters !== 'undefined') Characters.initialize(this);
        this.placeIndependentSettlements(params.independentSettlements || 'normal');
        Kingdom.dedupeSettlementNames(this);
        this.placePointsOfInterest(params.ruinsFreq || 'normal');
        if (rules.autoRoads !== false) this.generateRoads();
        this.history = WorldEvents.generateHistory(this);
        if (typeof Religion !== 'undefined') Religion.initialize(this);
        if (typeof Culture !== 'undefined') Culture.initialize(this);
        if (typeof Peoples !== 'undefined') Peoples.initialize(this);
        if (typeof Colonization !== 'undefined') Colonization.initialize(this);
        if (typeof Cartography !== 'undefined') Cartography.initialize(this);
        this.spawnInitialUnits();

        console.log(`Custom world loaded: ${this.width}x${this.height}, ${this.kingdoms.length} kingdoms`);
    },

    /** The passable tile nearest (q, r) — itself if it is land — or null. */
    _nearestLand(q, r) {
        for (let range = 0; range <= 6; range++) {
            for (const h of Hex.hexesInRange(q, r, range)) {
                if (h.r < 0 || h.r >= this.height) continue;
                const wq = Hex.wrapQ(h.q, this.width);
                if (this.tiles[h.r][wq].terrain.passable) return { q: wq, r: h.r };
            }
        }
        return null;
    },

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
    },

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
    },

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
    },

    /** Assign resources to tiles based on terrain type + random chance */
    _assignResources() {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const tile = this.tiles[r][q];
                const terrainId = tile.terrain.id;
                const chances = Terrain.RESOURCE_CHANCES[terrainId];
                if (!chances) continue;
                for (const { resource, chance } of chances) {
                    if (Utils.random() < chance) {
                        tile.resource = resource;
                        break; // one resource per tile
                    }
                }
            }
        }
    },

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

                if (!isCoastal && Utils.random() < 0.75) continue;

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
    },

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
    },

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
    },

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
    },
});

// ── Custom-world vocabulary (world_editor.html) ──────────────────────

// Editor overlay type → the settlement it founds in play
World.EDITOR_SETTLEMENTS = {
    village: { type: 'village', label: 'Village', level: 0, pop: [50, 500] },
    outpost: { type: 'village', label: 'Outpost', level: 0, pop: [30, 200] },
    town: { type: 'town', label: 'Town', level: 1, pop: [500, 3000] },
    port: { type: 'town', label: 'Port', level: 1, pop: [800, 3000] },
    city: { type: 'city', label: 'City', level: 2, pop: [3000, 8000] },
    capital: { type: 'city', label: 'Capital', level: 2, pop: [4000, 9000] },
};

// Editor landmark → the point of interest it becomes (ruins and caves can be delved)
World.EDITOR_LANDMARKS = {
    dungeon: { type: 'ruins', icon: '⚔️', name: 'Forgotten Dungeon' },
    ruins: { type: 'ruins', icon: '🏚️', name: 'Ancient Ruins' },
    shrine: { type: 'shrine', icon: '⛩️', name: 'Roadside Shrine' },
    temple: { type: 'shrine', icon: '🕌', name: 'Old Temple' },
    tower: { type: 'monument', icon: '🗼', name: 'Lonely Tower' },
    fortress: { type: 'ruins', icon: '🏰', name: 'Fallen Fortress' },
    cave: { type: 'cave', icon: '🕳️', name: 'Mysterious Cave' },
    mine: { type: 'cave', icon: '⛏️', name: 'Abandoned Mine' },
    oasis: { type: 'oasis', icon: '🌴', name: 'Desert Oasis' },
    volcano: { type: 'cave', icon: '🌋', name: 'Fire Mountain' },
    shipwreck: { type: 'shipwreck', icon: '⛵', name: 'Shipwreck', water: true },
};

/**
 * A kingdom template for a realm the map maker placed: one of the default
 * realms (by id) with their renames, or a realm of their own making.
 */
World.realmTemplate = function (realm) {
    const base = Kingdom.DEFAULTS.find(d => d.id === realm.id) || {};
    const color = /^#[0-9a-f]{6}$/i.test(realm.color || '') ? realm.color : (base.color || '#888888');
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const culture = realm.culture || base.culture || 'Imperial';
    return {
        ruler: 'Ruler of ' + (realm.name || base.name || 'the realm'),
        culture,
        description: 'A realm born of custom creation.',
        preferredTerrain: ['plains', 'grassland'],
        traits: ['orderly'],
        ...base,
        id: String(realm.id),
        name: realm.name || base.name || String(realm.id),
        color,
        colorLight: `rgba(${rgb.join(', ')}, 0.2)`,
        ...(realm.culture ? { culture: realm.culture } : {}),
        ...(realm.ruler ? { ruler: realm.ruler } : {}),
    };
};
