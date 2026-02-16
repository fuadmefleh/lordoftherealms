// ============================================
// DATA LOADER — Loads JSON data files and populates game systems
// ============================================

const DataLoader = {
    _cache: {},
    _basePath: 'data/',

    /**
     * Load a JSON file and cache the result
     * @param {string} filename - JSON filename (without path)
     * @returns {Promise<Object>} Parsed JSON data
     */
    async load(filename) {
        if (this._cache[filename]) {
            return this._cache[filename];
        }

        try {
            const response = await fetch(`${this._basePath}${filename}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this._cache[filename] = data;
            return data;
        } catch (error) {
            console.error(`[DataLoader] Failed to load ${filename}:`, error);
            throw error;
        }
    },

    /**
     * Load multiple JSON files in parallel
     * @param {string[]} filenames - Array of JSON filenames
     * @returns {Promise<Object>} Map of filename -> parsed data
     */
    async loadAll(filenames) {
        const results = {};
        const promises = filenames.map(async (filename) => {
            results[filename] = await this.load(filename);
        });
        await Promise.all(promises);
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
     * Initialize all game data from JSON files
     * Call this before game starts
     * @returns {Promise<void>}
     */
    async initializeAll() {
        console.log('[DataLoader] Loading game data...');
        const startTime = performance.now();

        const files = [
            'terrain.json',
            'kingdoms.json',
            'characters.json',
            'economy.json',
            'quests.json',
            'achievements.json',
            'military.json',
            'religion.json',
            'culture.json',
            'peoples.json',
            'colonization.json',
            'cartography.json',
            'infrastructure.json',
            'market.json',
            'tavern.json',
            'npcLords.json',
            'kingdomAI.json',
            'worldEvents.json',
            'technology.json',
            'playerEconomy.json',
            'units.json',
            'assets.json',
        ];

        const data = await this.loadAll(files);

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
