// InnerMap — state members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
    // Configuration (loaded from JSON)
    CONFIG: null,

    // Cache of generated inner maps keyed by "q,r"
    _cache: {},

    // Cache of time state per tile keyed by "q,r"
    _timeCache: {},

    // Current inner map state
    active: false,

    currentWorldTile: null,

    // { q, r } of the world tile we're exploring
    tiles: [],

    // 2D array of inner map tiles
    width: 8,

    height: 8,

    playerInnerQ: 4,

    // Player position within inner map
    playerInnerR: 3,

    // Discovered encounters on the inner map (keyed by "q,r")
    _discoveredEncounters: {},

    // ── Time system ──────────────────────────────────────
    // 1 real-time minute = 1 in-game hour, 24 hours = 1 day
    timeOfDay: 8,

    // Current hour (0-23), start at 8 AM
    _timeAccumulator: 0,

    // Accumulates real-time seconds
    TIME_SCALE: 60,

    // Seconds of real time per in-game hour
    dayEnded: false,

    // Flag to show end-of-day modal once
    // ── Weather snapshot (set when entering) ────────────
    weather: null,

    // { type, intensity } from world weather
    temperature: null,

    // { value, celsius, fahrenheit } from world weather
    season: null,

    // Current season string
    // ── Player walking state ──────────────────────────────
    _playerPath: null,

    // Array of { q, r } steps to walk
    _playerPathIndex: 0,

    // Current index in _playerPath
    _playerMoveProgress: 0,

    // 0-1 interpolation between current and next tile
    _playerPrevQ: 4,

    // Previous tile position (for interpolation)
    _playerPrevR: 3,

    _playerWalking: false,

    // Is the player currently walking?
    _playerSpeed: 4.0,

    // Tiles per second walk speed
    _playerArrivalResult: null,

    // Deferred arrival result for game.js to pick up
    // ── Object interaction state ─────────────────────────
    _pendingInteraction: null,

    // { anchorQ, anchorR, defId } — set when walking toward an object
    _activeInteraction: null,

    // { anchorQ, anchorR, defId, elapsed, duration, fading }
    _pendingDialog: null,

    // { npc, game } — set when walking toward an NPC to talk
    // ── NPC system ───────────────────────────────────────
    npcs: [],

    // Array of NPC objects on the inner map
    _npcMoveTimer: 0,

    // Timer for NPC movement ticks
    // ── Building data for current inner map ──────────────
    buildings: [],

    // Array of { q, r, type, name, icon, sprite, actions[] }
    roads: [],

    // Array of { q, r } tiles that are roads
    // ── Pending position for property built from inner map ──
    _pendingPropertyPosition: null,

    // { q, r } inner map coords
    // ── Building interior system ─────────────────────────
    _insideBuilding: null,

    // The building object currently inside (null = outdoor)
    _outerMapState: null,

    // Saved state of the outer inner map when entering a building
    _interiorCache: {},

    // Cache of generated interiors keyed by building id/position
    /**
     * Initialize with data from JSON
     */
    initialize(data) {
        this.CONFIG = data;
        if (data.innerMapSize) {
            this.width = data.innerMapSize.width;
            this.height = data.innerMapSize.height;
        }
    },

    // ══════════════════════════════════════════════
    // NAMED BUILDING TYPES — buildings the player can visit
    // ══════════════════════════════════════════════
    BUILDING_TYPES: {
        town_hall:    { name: 'Town Hall',     icon: '🏛️', sprite: 'buildings/walledCity.png',       actions: ['talk_official', 'view_notices', 'pay_taxes'] },
        marketplace:  { name: 'Marketplace',   icon: '🏪', sprite: 'buildings/marketplace00.png',    actions: ['trade', 'browse_goods', 'talk_merchant'] },
        tavern:       { name: 'Tavern',        icon: '🍺', sprite: 'buildings/inn.png',              actions: ['tavern', 'rest', 'buy_drink', 'talk_locals', 'recruit'] },
        blacksmith:   { name: 'Blacksmith',    icon: '⚒️', sprite: 'buildings/smithy.png',           actions: ['buy_weapons', 'buy_tools', 'repair'] },
        church:       { name: 'Church',        icon: '⛪', sprite: 'buildings/church00.png',          actions: ['pray', 'donate', 'meditate', 'talk_priest'] },
        temple:       { name: 'Temple',        icon: '🕌', sprite: 'buildings/temple.png',            actions: ['pray', 'donate', 'meditate', 'seek_blessing'] },
        barracks:     { name: 'Barracks',      icon: '🏰', sprite: 'buildings/barracks00.png',        actions: ['recruit', 'train_combat', 'talk_captain'] },
        granary:      { name: 'Granary',       icon: '🌾', sprite: 'buildings/granary00.png',         actions: ['buy_food', 'store_goods'] },
        warehouse:    { name: 'Warehouse',     icon: '📦', sprite: 'buildings/warehouse00.png',       actions: ['store_goods', 'collect_goods'] },
        well:         { name: 'Well',          icon: '💧', sprite: 'buildings/well00.png',            actions: ['rest', 'talk_locals'] },
        barn:         { name: 'Barn',          icon: '🏚️', sprite: 'buildings/barn00.png',            actions: ['rest', 'forage'] },
        house:        { name: 'House',         icon: '🏠', sprite: 'buildings/villageSmall00.png',    actions: ['talk_locals', 'ask_directions'] },
        manor:        { name: 'Manor',         icon: '🏘️', sprite: 'buildings/village00.png',         actions: ['talk_official', 'seek_audience'] },
        stable:       { name: 'Stable',        icon: '🐴', sprite: 'buildings/barnWood00.png',        actions: ['buy_horse', 'stable_horse'] },
        guard_tower:  { name: 'Guard Tower',   icon: '🗼', sprite: 'buildings/barracks00.png',        actions: ['talk_guard', 'report_crime'] },
        farm:         { name: 'Farm',           icon: '🌾', sprite: 'farm00.png',                         actions: ['buy_food', 'forage', 'talk_locals'] },
    },

    // ══════════════════════════════════════════════
    // PROPERTY SPRITES — sprites for player-built properties
    // ══════════════════════════════════════════════
    PROPERTY_SPRITES: {
        farm:          ['farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'],
        pasture:       ['buildings/pasture00_sheep.png', 'buildings/corral00.png', 'buildings/corral01.png'],
        logging_camp:  ['buildings/loggingCamp00.png', 'buildings/loggingCamp01.png'],
        mine:          ['buildings/mines00.png', 'buildings/mines01.png', 'buildings/mines02.png', 'buildings/mines03.png'],
        workshop:      ['buildings/smithy.png'],
        trading_post:  ['buildings/marketplace00.png'],
        fishing_wharf: ['buildings/warehouse00.png'],
        brewery:       ['buildings/cookhouse00.png'],
        tavern:        ['buildings/inn.png'],
    },

    // ══════════════════════════════════════════════
    // PROPERTY BUILDING DEFS — label/action definitions for player properties
    // ══════════════════════════════════════════════
    PROPERTY_BUILDING_DEFS: {
        farm:          { name: 'Farm',          icon: '🌾', actions: ['manage_property', 'collect_goods'] },
        pasture:       { name: 'Pasture',       icon: '🐑', actions: ['manage_property', 'collect_goods'] },
        logging_camp:  { name: 'Logging Camp',  icon: '🪓', actions: ['manage_property', 'collect_goods'] },
        mine:          { name: 'Mine',          icon: '⛏️', actions: ['manage_property', 'collect_goods'] },
        workshop:      { name: 'Workshop',      icon: '🔨', actions: ['manage_property', 'collect_goods'] },
        trading_post:  { name: 'Trading Post',  icon: '🏪', actions: ['manage_property'] },
        fishing_wharf: { name: 'Fishing Wharf', icon: '⚓', actions: ['manage_property', 'collect_goods'] },
        brewery:       { name: 'Brewery',       icon: '🍺', actions: ['manage_property', 'collect_goods'] },
        tavern:        { name: 'Tavern',        icon: '🍻', actions: ['manage_property'] },
    },

    // ══════════════════════════════════════════════
    // SETTLEMENT BUILDING LAYOUTS — which buildings each settlement type gets
    // ══════════════════════════════════════════════
    SETTLEMENT_BUILDINGS: {
        village: {
            required: ['tavern', 'well'],
            optional: ['house', 'house', 'house', 'barn', 'granary', 'stable', 'farm', 'farm'],
            maxBuildings: 7
        },
        town: {
            required: ['marketplace', 'tavern', 'blacksmith', 'church', 'granary'],
            optional: ['house', 'house', 'house', 'house', 'barn', 'stable', 'warehouse', 'guard_tower', 'manor', 'farm', 'farm', 'farm'],
            maxBuildings: 14
        },
        city: {
            required: ['marketplace', 'tavern', 'blacksmith', 'church', 'barracks', 'granary', 'warehouse'],
            optional: ['house', 'house', 'house', 'house', 'house', 'temple', 'stable', 'guard_tower', 'manor', 'barn', 'farm', 'farm', 'farm'],
            maxBuildings: 18
        },
        capital: {
            required: ['town_hall', 'marketplace', 'tavern', 'blacksmith', 'church', 'temple', 'barracks', 'granary', 'warehouse'],
            optional: ['house', 'house', 'house', 'house', 'house', 'house', 'stable', 'guard_tower', 'guard_tower', 'manor', 'manor', 'barn', 'farm', 'farm', 'farm', 'farm'],
            maxBuildings: 22
        }
    },

    // ══════════════════════════════════════════════
    // NPC TYPES — townspeople that walk around the inner map
    // ══════════════════════════════════════════════
    // ── NPC shop inventory generation ──
    // Called when NPCs are spawned; gives merchant/traveler/blacksmith their own stock
    _NPC_SHOP_POOLS: {
        merchant: {
            common: ['grain','bread','cheese','dried_meat','salt','candles','rope','honey','beer','tools','wood','wool','textiles','pottery','dyes','flour','tea'],
            uncommon: ['wine','spices','exotic_spices','silk','perfume','clothes','firewood','iron','healing_salve','incense','lantern','arrows'],
            rare: ['luxuries','gems','potion','amulet','rare_book'],
            counts: { common: [5,8], uncommon: [3,5], rare: [0,2] },
            qtyRange: { common: [3,12], uncommon: [1,6], rare: [1,2] },
        },
        traveler: {
            common: ['dried_meat','bread','cheese','herbs','honey','salt','candles','rope','compass','lantern','tea','mushrooms'],
            uncommon: ['exotic_spices','silk','perfume','wine','healing_salve','pelts','ancient_coin','dyes','potion','rare_book','incense','treasure_map'],
            rare: ['elixir','enchanted_ring','amulet','gems'],
            counts: { common: [3,5], uncommon: [2,4], rare: [1,2] },
            qtyRange: { common: [1,5], uncommon: [1,3], rare: [1,1] },
        },
        blacksmith_npc: {
            common: ['tools','iron','arrows','rope','lantern'],
            uncommon: ['weapons','shield','bow','leather_armor','ore'],
            rare: ['military_parts'],
            counts: { common: [3,4], uncommon: [2,3], rare: [0,1] },
            qtyRange: { common: [2,8], uncommon: [1,4], rare: [1,2] },
        },
    },

    _generateNpcShop(npcType, rng) {
        const pool = this._NPC_SHOP_POOLS[npcType];
        if (!pool) return null;

        const inv = {};  // { itemId: { qty, price } }
        const pick = (arr, min, max) => {
            const count = min + Math.floor(rng() * (max - min + 1));
            const shuffled = arr.slice().sort(() => rng() - 0.5);
            return shuffled.slice(0, Math.min(count, shuffled.length));
        };

        for (const tier of ['common', 'uncommon', 'rare']) {
            const [cMin, cMax] = pool.counts[tier];
            const [qMin, qMax] = pool.qtyRange[tier];
            const picked = pick(pool[tier], cMin, cMax);
            for (const itemId of picked) {
                const qty = qMin + Math.floor(rng() * (qMax - qMin + 1));
                // Price markup: merchants 1.0-1.15×, travelers 1.1-1.3×, blacksmiths 0.95-1.1×
                let markup = 1.0;
                if (npcType === 'traveler')      markup = 1.1 + rng() * 0.2;
                else if (npcType === 'merchant') markup = 1.0 + rng() * 0.15;
                else                             markup = 0.95 + rng() * 0.15;
                inv[itemId] = { qty, markup: Math.round(markup * 100) / 100 };
            }
        }
        return inv;
    },

    NPC_TYPES: {
        merchant:    { name: 'Merchant',     icon: '🧑‍💼', speed: 0.4, destinations: ['marketplace', 'warehouse', 'tavern'] },
        guard:       { name: 'Guard',        icon: '💂', speed: 0.3, destinations: ['guard_tower', 'barracks', 'town_hall', 'gate'] },
        farmer:      { name: 'Farmer',       icon: '🧑‍🌾', speed: 0.5, destinations: ['farm', 'granary', 'marketplace', 'barn', 'well'] },
        priest:      { name: 'Priest',       icon: '🧑‍⚖️', speed: 0.3, destinations: ['church', 'temple', 'well'] },
        blacksmith_npc: { name: 'Blacksmith', icon: '⚒️', speed: 0.3, destinations: ['blacksmith', 'marketplace', 'tavern'] },
        villager:    { name: 'Villager',     icon: '🧑', speed: 0.5, destinations: ['house', 'marketplace', 'tavern', 'well', 'church'] },
        child:       { name: 'Child',        icon: '👦', speed: 0.7, destinations: ['house', 'well', 'tavern'] },
        noble:       { name: 'Noble',        icon: '🤴', speed: 0.3, destinations: ['town_hall', 'church', 'manor', 'marketplace'] },
        traveler:    { name: 'Traveler',     icon: '🧳', speed: 0.5, destinations: ['tavern', 'marketplace', 'stable'] },
        beggar:      { name: 'Beggar',       icon: '🧎', speed: 0.2, destinations: ['marketplace', 'church', 'tavern', 'well'] },
    },

    // NPC pool per settlement type
    NPC_POOLS: {
        village:  { villager: 4, farmer: 2, child: 2, merchant: 1, traveler: 1 },
        town:     { villager: 6, merchant: 3, guard: 2, farmer: 2, priest: 1, blacksmith_npc: 1, child: 3, traveler: 2 },
        city:     { villager: 8, merchant: 4, guard: 4, farmer: 2, priest: 2, blacksmith_npc: 1, noble: 2, child: 4, traveler: 3, beggar: 1 },
        capital:  { villager: 10, merchant: 6, guard: 6, farmer: 3, priest: 3, blacksmith_npc: 2, noble: 4, child: 5, traveler: 4, beggar: 2 },
    },

    // All inner maps are a fixed 128×128 tile grid
    INNER_MAP_SIZE: 128,

    // ══════════════════════════════════════════════
    // BASE TERRAIN MAPPING — like C# Generate() biome switch
    // Maps parent terrain ID → base fill category used by the renderer.
    // Sub-terrains can optionally override via a "baseTerrain" field
    // in their JSON definition (e.g. pond → 'water', dirt_path → 'dirt').
    // ══════════════════════════════════════════════
    PARENT_TO_BASE_TERRAIN: {
        grassland:            'grass',
        plains:               'grass',
        woodland:             'grass',   // no dark_green fills in spritesheet; trees are overlays
        forest:               'grass',
        dense_forest:         'grass',
        seasonal_forest:      'grass',
        boreal_forest:        'grass',
        temperate_rainforest: 'grass',
        tropical_rainforest:  'grass',
        desert:               'sand',
        savanna:              'dry_dirt',
        mountain:             'stone',
        snow_peak:            'stone',
        hills:                'stone',
        highlands:            'stone',
        swamp:                'dark_stone',
        tundra:               'dirt',
        snow:                 'grass',   // seasonal sheet swap handles visuals
        ice:                  'water',
        beach:                'sand',
        island:               'sand',
    },

    // Sub-terrain IDs that override the parent's base terrain.
    // Only listed for sub-terrains whose ground fill differs from their parent.
    SUB_TO_BASE_TERRAIN: {
        dirt:      'dirt',
        mud:       'dirt',
        rocks:     'stone',
        cliff:     'stone',
        ice:       'stone',
        sand:      'sand',
        dry_grass: 'dry_dirt',
        bog:       'dark_stone',
    },
});
