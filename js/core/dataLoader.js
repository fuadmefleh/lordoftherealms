// ============================================
// DATA LOADER — Single-file loader for data/gamedata.json
// ============================================

const DataLoader = {
    _cache: {},
    _gamedata: null,  // The full merged data object once loaded

    /**
     * Resolve a data key from _gamedata.
     * Supports paths like 'terrain.json', 'spritesheets/terrain.json',
     * 'innerMapRenderer.json', 'buildings.json', etc.
     */
    _resolve(filename) {
        // Strip leading 'data/' if someone passes a full path
        const rel = filename.replace(/^data\//, '');
        // Strip .json extension
        const key = rel.replace(/\.json$/, '');
        const parts = key.split('/');
        let node = this._gamedata;
        for (const part of parts) {
            if (node == null || typeof node !== 'object') return undefined;
            node = node[part];
        }
        return node;
    },

    /**
     * Get a section of gamedata synchronously (after initializeAll).
     * Returns undefined if not found.
     */
    get(filename) {
        if (!this._gamedata) return undefined;
        return this._resolve(filename);
    },

    /**
     * Load a data section — returns immediately from the merged cache.
     * Falls back to a real fetch only if gamedata hasn't been loaded yet
     * (e.g. during standalone tool use).
     */
    async load(filename) {
        if (this._cache[filename] !== undefined) {
            return this._cache[filename];
        }
        if (this._gamedata) {
            const data = this._resolve(filename);
            this._cache[filename] = data;
            return data;
        }
        // Fallback: load gamedata first, then resolve
        await this._loadGamedata();
        const data = this._resolve(filename);
        this._cache[filename] = data;
        return data;
    },

    async _loadGamedata() {
        if (this._gamedata) return;

        // Always load the base gamedata.json from disk first
        const response = await fetch('/data/gamedata.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        this._gamedata = await response.json();

        // Merge editor overrides from browser storage (IndexedDB) on top
        try {
            if (typeof ModStore !== 'undefined') {
                await ModStore.init();
                const stored = await ModStore.loadModData();
                if (stored && typeof stored === 'object' && (stored.terrain || stored.buildings || stored.objects)) {
                    console.log('[DataLoader] Merging editor data from browser storage (IndexedDB)');
                    Object.assign(this._gamedata, stored);
                }
            }
        } catch (e) {
            console.warn('[DataLoader] ModStore load failed, using base gamedata.json only', e);
        }
    },

    /**
     * Load multiple sections — all resolved from the single gamedata file.
     */
    async loadAll(filenames) {
        await this._loadGamedata();
        const results = {};
        for (const filename of filenames) {
            results[filename] = this._resolve(filename);
            this._cache[filename] = results[filename];
        }
        return results;
    },

    /**
     * Process loaded JSON values — convert null moveCost back to Infinity, etc.
     * @param {Object} obj - Object to process
     * @param {string[]} infinityFields - Field names that should be Infinity when null
     * @returns {Object} Processed object
     */
    processInfinityFields(obj, infinityFields = ['moveCost']) {
        if (!obj || typeof obj !== 'object') return obj;

        for (const [key, value] of Object.entries(obj)) {
            if (infinityFields.includes(key) && value === null) {
                obj[key] = Infinity;
            } else if (typeof value === 'object' && value !== null) {
                this.processInfinityFields(value, infinityFields);
            }
        }
        return obj;
    },

    /**
     * Initialize all game data — loads data/gamedata.json (single merged file).
     * Call this before game starts.
     * @returns {Promise<void>}
     */
    async initializeAll() {
        console.log('[DataLoader] Loading game data (gamedata.json)...');
        const startTime = performance.now();

        await this._loadGamedata();

        // Build a thin alias map so the rest of this function can keep
        // its existing  data['terrain.json']  access pattern unchanged.
        const gd = this._gamedata;
        const data = new Proxy({}, {
            get(_, filename) {
                const key = filename.replace(/\.json$/, '');
                return gd[key];
            }
        });

        // ── Terrain ──
        const terrainData = data['terrain.json'];
        this.processInfinityFields(terrainData.types);
        Terrain.TYPES = terrainData.types;
        Terrain.RESOURCES = terrainData.resources;
        Terrain.RESOURCE_CHANCES = terrainData.resourceChances;
        Terrain.BIOME_TABLE = terrainData.biomeTable;

        // ── Kingdoms ──
        const kingdomData = data['kingdoms.json'];
        Kingdom.DEFAULTS = kingdomData.defaults;
        Kingdom._cityNames = kingdomData.cityNames;
        Kingdom._rulerTitles = kingdomData.rulerTitles;
        Kingdom._rulerNames = kingdomData.rulerNames;
        Kingdom._epithets = kingdomData.epithets;

        // ── Characters ──
        const charData = data['characters.json'];
        Characters.FIRST_NAMES = charData.firstNames;
        Characters.DYNASTY_NAMES = charData.dynastyNames;
        Characters.RULER_TRAITS = charData.rulerTraits;
        Characters.ADVISOR_ROLES = charData.advisorRoles;
        Characters.CHARACTER_EVENTS = charData.characterEvents;

        // ── Economy ──
        const econData = data['economy.json'];
        Economy.PRODUCTION_RATES = econData.productionRates;
        Economy.RESOURCE_BONUSES = econData.resourceBonuses;

        // ── Quests ──
        const questData = data['quests.json'];
        Quests.QUEST_TEMPLATES = questData.questTemplates || questData;

        // ── Achievements ──
        const achieveData = data['achievements.json'];
        // Merge JSON data with existing achievements to preserve check functions
        if (achieveData && (achieveData.achievements || achieveData)) {
            const jsonAchievements = achieveData.achievements || achieveData;
            for (const [key, jsonData] of Object.entries(jsonAchievements)) {
                if (Achievements.ACHIEVEMENTS[key]) {
                    // Merge properties, keeping the check function from code
                    Object.assign(Achievements.ACHIEVEMENTS[key], jsonData);
                }
            }
        }

        // ── Military ──
        const milData = data['military.json'];
        PlayerMilitary.UNIT_TYPES = milData.unitTypes;
        PlayerMilitary.CONTRACT_TYPES = milData.contractTypes;

        // ── Religion ──
        const relData = data['religion.json'];
        Religion.FAITHS = relData.faiths;
        Religion.KINGDOM_FAITHS = relData.kingdomFaiths;
        Religion.HOLY_SITE_TYPES = relData.holySiteTypes;
        Religion.HERESIES = relData.heresies;
        if (relData.buildingTypes) {
            PlayerReligion.BUILDING_TYPES = relData.buildingTypes;
        }
        if (relData.miracles) {
            PlayerReligion.MIRACLES = relData.miracles;
        }

        // ── Culture ──
        const cultData = data['culture.json'];
        Culture.BUILDING_TYPES = cultData.buildingTypes;
        Culture.TRADITIONS = cultData.traditions;
        Culture.CULTURAL_EVENTS = cultData.culturalEvents;

        // ── Peoples ──
        const peopleData = data['peoples.json'];
        Peoples.TRIBAL_ROOTS = peopleData.tribalRoots;
        Peoples.EVOLUTION_STAGES = peopleData.evolutionStages;
        Peoples.INTERACTION_TYPES = peopleData.interactionTypes;
        if (peopleData.quarterNames) {
            Peoples._quarterNames = peopleData.quarterNames;
        }

        // ── Colonization ──
        const colData = data['colonization.json'];
        Colonization.INDIGENOUS_TRIBES = colData.indigenousTribes;
        Colonization.POLICIES = colData.policies;

        // ── Cartography ──
        const cartoData = data['cartography.json'];
        Cartography.QUALITY = cartoData.quality;
        Cartography.MAP_TYPES = cartoData.mapTypes;

        // ── Infrastructure ──
        const infraData = data['infrastructure.json'];
        Infrastructure.TYPES = infraData.types;

        // ── Market ──
        const marketData = data['market.json'];
        if (typeof Taxation !== 'undefined') {
            Taxation.TAX_RATES = marketData.taxRates;
        }
        if (typeof Banking !== 'undefined' && marketData.loanOptions) {
            Banking._loanOptions = marketData.loanOptions;
        }

        // ── Tavern ──
        const tavernData = data['tavern.json'];
        Tavern.DRINK_COST = tavernData.config?.drinkCost ?? Tavern.DRINK_COST;
        Tavern.BRIBE_COST = tavernData.config?.bribeCost ?? Tavern.BRIBE_COST;
        Tavern.HIRE_INFORMANT_COST = tavernData.config?.hireInformantCost ?? Tavern.HIRE_INFORMANT_COST;
        Tavern.INTEL_DECAY_DAYS = tavernData.config?.intelDecayDays ?? Tavern.INTEL_DECAY_DAYS;
        Tavern.MAX_RUMORS = tavernData.config?.maxRumors ?? Tavern.MAX_RUMORS;
        Tavern.RELIABILITY = tavernData.reliability;
        Tavern.CATEGORIES = tavernData.categories;

        // ── NPC Lords ──
        const lordData = data['npcLords.json'];
        NPCLords.TRAITS = lordData.traits;

        // ── Kingdom AI ──
        const aiData = data['kingdomAI.json'];
        KingdomAI.PERSONALITIES = aiData.personalities;

        // ── World Events ──
        const eventData = data['worldEvents.json'];
        WorldEvents.CATEGORIES = eventData.categories;

        // ── Technology ──
        const techData = data['technology.json'];
        if (typeof Technology !== 'undefined' && techData) {
            if (techData.CATEGORIES) Technology.CATEGORIES = techData.CATEGORIES;
            if (techData.LAB_CONFIG) Technology.LAB_CONFIG = techData.LAB_CONFIG;
            if (techData.CATEGORY_PARTS) Technology.CATEGORY_PARTS = techData.CATEGORY_PARTS;
            if (techData.PARTS_CRAFTING) Technology.PARTS_CRAFTING = techData.PARTS_CRAFTING;
            if (techData.RESEARCH_COSTS) Technology.RESEARCH_COSTS = techData.RESEARCH_COSTS;
            if (techData.TECHS) Technology.TECHS = techData.TECHS;
            if (techData.TECH_BUILDINGS) Technology.TECH_BUILDINGS = techData.TECH_BUILDINGS;
            if (techData.TECH_UNITS) Technology.TECH_UNITS = techData.TECH_UNITS;
            if (techData.TECH_RECIPES) Technology.TECH_RECIPES = techData.TECH_RECIPES;
        }

        // ── Player Economy ──
        const peData = data['playerEconomy.json'];
        if (peData.PROPERTY_TYPES) PlayerEconomy.PROPERTY_TYPES = peData.PROPERTY_TYPES;
        if (peData.GOODS) PlayerEconomy.GOODS = peData.GOODS;
        if (peData.RECIPES) PlayerEconomy.RECIPES = peData.RECIPES;

        // ── Early Jobs ──
        const earlyJobsData = data['earlyJobs.json'];
        if (earlyJobsData) {
            DataLoader.earlyJobs = earlyJobsData;
        }

        // ── Relationships ──
        const relationshipsData = data['relationships.json'];
        if (relationshipsData) {
            DataLoader.relationships = relationshipsData;
        }

        // ── Housing ──
        const housingData = data['housing.json'];
        if (housingData) {
            DataLoader.housing = housingData;
        }

        // ── Ships ──
        const shipsData = data['ships.json'];
        if (shipsData) {
            DataLoader.ships = shipsData;
        }

        // ── Titles ──
        const titlesData = data['titles.json'];
        if (titlesData) {
            DataLoader.titles = titlesData;
        }

        // ── Espionage ──
        const espionageData = data['espionage.json'];
        if (espionageData) {
            DataLoader.espionage = espionageData;
            if (typeof Espionage !== 'undefined') {
                if (espionageData.config) Object.assign(Espionage.CONFIG, espionageData.config);
                if (espionageData.spyNames) Espionage.SPY_NAMES = espionageData.spyNames;
                if (espionageData.spySkills) Espionage.SPY_SKILLS = espionageData.spySkills;
                if (espionageData.spyTraits) Espionage.SPY_TRAITS = espionageData.spyTraits;
                if (espionageData.missions) Espionage.MISSIONS = espionageData.missions;
                if (espionageData.missionOutcomes) Espionage.MISSION_OUTCOMES = espionageData.missionOutcomes;
                if (espionageData.levelTitles) Espionage.LEVEL_TITLES = espionageData.levelTitles;
                if (espionageData.rebellionEffects) Espionage.REBELLION_EFFECTS = espionageData.rebellionEffects;
            }
        }

        // ── Legendary Artifacts ──
        const artifactsData = data['artifacts.json'];
        if (artifactsData) {
            DataLoader.artifacts = artifactsData;
        }

        // ── Inner Map ──
        const innerMapData = data['innerMap.json'];
        if (innerMapData && typeof InnerMap !== 'undefined') {
            InnerMap.initialize(innerMapData);
        }

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`[DataLoader] All game data loaded in ${elapsed}ms`);
    },

    /**
     * Clear the cache (useful for testing or hot-reloading)
     */
    clearCache() {
        this._cache = {};
    }
};
