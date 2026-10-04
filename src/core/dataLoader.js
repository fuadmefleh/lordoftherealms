// ============================================
// DATA LOADER — Single-file loader for data/gamedata.json
// ============================================

import { ModStore } from '../systems/modStore.js';
import { Terrain } from '../world/terrain.js';
import { Kingdom } from '../world/kingdom.js';
import { Characters } from '../world/characters.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Religion } from '../systems/religion.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { Culture } from '../systems/culture.js';
import { Peoples } from '../systems/peoples.js';
import { Colonization } from '../world/colonization.js';
import { Cartography } from '../systems/cartography.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Banking, Taxation } from '../systems/marketDynamics.js';
import { Tavern } from '../player/tavern.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomAtlas } from '../world/kingdomAtlas.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { WorldEvents } from '../world/worldEvents.js';
import { WorldUnit } from '../world/units.js';
import { Technology } from '../systems/technology.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Espionage } from '../systems/espionage.js';
import { InnerMap } from '../world/innerMap.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { Traits } from '../systems/traits.js';


export const DataLoader = {
    _cache: {},
    _gamedata: null,  // The full merged data object once loaded

    /** Reset all cached data so the next load() re-fetches gamedata.json + ModStore. */
    reset() {
        this._cache = {};
        this._gamedata = null;
        this._loadingPromise = null;
    },

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

    _loadingPromise: null,  // Dedup concurrent _loadGamedata calls

    async _loadGamedata() {
        if (this._gamedata) return;
        // Prevent concurrent calls (e.g. React StrictMode double-fire)
        if (this._loadingPromise) return this._loadingPromise;
        this._loadingPromise = this._doLoadGamedata();
        try {
            await this._loadingPromise;
        } finally {
            this._loadingPromise = null;
        }
    },

    async _doLoadGamedata() {
        // Always load the base gamedata.json from disk first
        console.log('[DataLoader] Fetching gamedata.json...');
        const response = await fetch('/data/gamedata.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        this._gamedata = await response.json();
        console.log('[DataLoader] gamedata.json parsed successfully');

        // Merge ONLY editor-authored keys from browser storage (IndexedDB).
        // The editor stores the full gamedata blob, but we only want the keys
        // that editors actually author — NOT core game config like terrain.types,
        // terrain.biomeTable, kingdoms, economy, etc.
        try {
            if (typeof ModStore !== 'undefined') {
                // Timeout IndexedDB operations — if they hang (blocked/corrupt),
                // fall back to base gamedata after 3 seconds.
                const modStoreTimeout = (promise, ms = 3000) =>
                    Promise.race([
                        promise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('ModStore timeout')), ms)),
                    ]);
                await modStoreTimeout(ModStore.init());
                const stored = await modStoreTimeout(ModStore.loadModData());
                if (stored && typeof stored === 'object' && (stored.terrain || stored.buildings || stored.objects || stored.playerEconomy || stored.interiors || stored.interiorBrushes || stored.terrainNineTileBrushes || stored.terrainSets || stored.terrainMap || stored.nineTileBrushes)) {
                    console.log('[DataLoader] Merging editor data from browser storage (IndexedDB)');
                    this._mergeEditorData(stored);
                }
            }
        } catch (e) {
            console.warn('[DataLoader] ModStore load failed, using base gamedata.json only', e);
        }
    },

    /**
     * Selectively merge editor-authored data into _gamedata.
     * Only picks keys that editors actually write — buildings, objects,
     * interiors, terrain tileset data, etc. — and never replaces core
     * game config (terrain.types, terrain.biomeTable, kingdoms, economy…).
     */
    _mergeEditorData(stored) {
        // Direct array/object replacements for editor-only keys
        const editorKeys = [
            'buildings', 'objects', 'interiors', 'interiorBrushes',
            'terrainSets', 'nineTileBrushes', 'terrainMap',
            'buildingNineTileBrushes', 'terrainNineTileBrushes',
            'doorCatalog', 'windowCatalog',
        ];
        for (const key of editorKeys) {
            if (stored[key] !== undefined) {
                const count = Array.isArray(stored[key]) ? stored[key].length : Object.keys(stored[key]).length;
                console.log(`[DataLoader] Merging editor key '${key}': ${count} item(s)`);
                if (key === 'buildings' && Array.isArray(stored[key])) {
                    console.log(`[DataLoader] Building IDs from ModStore: [${stored[key].map(b => b.id || '(no id)').join(', ')}]`);
                    console.log(`[DataLoader] Building types from ModStore: [${stored[key].map(b => b.buildingType || '(none)').join(', ')}]`);
                }
                this._gamedata[key] = stored[key];
            }
        }

        // Terrain section: only merge resources & resourceChances (edited by
        // the Resource Types editor). Never overwrite types or biomeTable.
        if (stored.terrain && typeof stored.terrain === 'object') {
            if (!this._gamedata.terrain) this._gamedata.terrain = {};
            const safeTerrainKeys = ['resources', 'resourceChances'];
            for (const key of safeTerrainKeys) {
                if (stored.terrain[key] !== undefined &&
                    Object.keys(stored.terrain[key]).length > 0) {
                    this._gamedata.terrain[key] = stored.terrain[key];
                }
            }
        }

        // Player economy section: merge inner-map goods from the editor without
        // replacing unrelated base economy sections.
        if (stored.playerEconomy && typeof stored.playerEconomy === 'object') {
            if (!this._gamedata.playerEconomy) this._gamedata.playerEconomy = {};
            const incomingGoods = stored.playerEconomy.GOODS;
            if (incomingGoods && typeof incomingGoods === 'object' && Object.keys(incomingGoods).length > 0) {
                this._gamedata.playerEconomy.GOODS = {
                    ...(this._gamedata.playerEconomy.GOODS || {}),
                    ...incomingGoods,
                };
            }
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

        // ── World units (types beyond the hand-written ones) ──
        const unitData = data['units.json'];
        if (unitData) {
            WorldUnit.TYPES = unitData.unitTypes || {};
            WorldUnit.THEMES = unitData.inventoryThemes || {};
            WorldUnit.DEFAULTS = unitData.defaults || null;
            WorldUnit.MAX_AGE = unitData.maxAge || null;
        }

        // ── Kingdoms ──
        const kingdomData = data['kingdoms.json'];
        Kingdom.DEFAULTS = kingdomData.defaults;
        Kingdom._cityNames = kingdomData.cityNames;
        Kingdom._rulerTitles = kingdomData.rulerTitles;
        Kingdom._rulerNames = kingdomData.rulerNames;
        Kingdom._epithets = kingdomData.epithets;
        // What each kingdom trait does (read by KingdomBonuses.get)
        if (kingdomData.traitEffects) KingdomBonuses.TRAITS = kingdomData.traitEffects;

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
        if (econData.resourceGoods) Economy.RESOURCE_GOODS = econData.resourceGoods;
        if (econData.resourceEffects) Economy.RESOURCE_EFFECTS = econData.resourceEffects;
        if (econData.propertyResourceBonuses) Economy.PROPERTY_RESOURCE_BONUSES = econData.propertyResourceBonuses;
        // The agricultural year: harvest curves, seasonal prices, lean season
        if (econData.seasons) Seasons.configure(econData.seasons);

        // ── Quests ──
        const questData = data['quests.json'];
        // Merge: code-defined templates (e.g. artifact quests) survive unless
        // the data overrides them
        Quests.QUEST_TEMPLATES = { ...Quests.QUEST_TEMPLATES, ...(questData.questTemplates || questData) };

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
        DataLoader.military = milData; // navalRules + unit domains, read by Ships
        // Royal fleets: nested blocks merge key by key so a partial override keeps the rest
        if (milData.kingdomNavy) {
            for (const [key, value] of Object.entries(milData.kingdomNavy)) {
                if (key.startsWith('_')) continue;
                const cur = KingdomNavy.CONFIG[key];
                if (cur && typeof cur === 'object' && value && typeof value === 'object') Object.assign(cur, value);
                else KingdomNavy.CONFIG[key] = value;
            }
        }
        PlayerMilitary.UNIT_TYPES = milData.unitTypes;
        PlayerMilitary.CONTRACT_TYPES = milData.contractTypes;

        // ── Religion ──
        const relData = data['religion.json'];
        Religion.FAITHS = relData.faiths;
        Religion.KINGDOM_FAITHS = relData.kingdomFaiths;
        Religion.HOLY_SITE_TYPES = relData.holySiteTypes;
        Religion.HERESIES = relData.heresies;
        // The player's own faith: what each tenet does and how influence pays off
        if (relData.playerTenets) Religion.PLAYER_TENETS = relData.playerTenets;
        if (relData.playerInfluence) Religion.PLAYER_INFLUENCE = relData.playerInfluence;
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
        // What the peoples actually do (systems/peoples/effects.js)
        if (peopleData.effects) {
            Peoples.EFFECTS = peopleData.effects;
        }

        // ── Colonization ──
        const colData = data['colonization.json'];
        Colonization.INDIGENOUS_TRIBES = colData.indigenousTribes;
        Colonization.POLICIES = colData.policies;

        // ── Cartography ──
        const cartoData = data['cartography.json'];
        Cartography.QUALITY = cartoData.quality;
        Cartography.MAP_TYPES = cartoData.mapTypes;
        if (cartoData.kingdomAtlas) Object.assign(KingdomAtlas.CONFIG, cartoData.kingdomAtlas);

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
        WorldEvents.TEMPLATES = eventData.eventTemplates || {};

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

        // ── Petitions & Court (read lazily by systems/petitions.js) ──
        const petitionsData = data['petitions.json'];
        if (petitionsData) {
            DataLoader.petitions = petitionsData;
        }

        // ── The Underworld: heat, guild, contraband (read lazily by systems/underworld.js) ──
        const underworldData = data['underworld.json'];
        if (underworldData) {
            DataLoader.underworld = underworldData;
        }

        // ── Gossip / Rumor System ──
        const gossipData = data['gossip.json'];
        if (gossipData) {
            DataLoader.gossip = gossipData;
        }

        // ── Earned character traits ──
        const traitsData = data['traits.json'];
        if (traitsData) {
            DataLoader.traits = traitsData;
            Traits.load(traitsData);
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
