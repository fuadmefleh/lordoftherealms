// PlayerEconomy — routes members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure } from './_imports.js';

Object.assign(PlayerEconomy, {
    /**
     * Property types the player can own
     */
    PROPERTY_TYPES: {
        FARM: {
            id: 'farm',
            name: 'Farm',
            icon: '🌾',
            cost: 500,
            constructionDays: 5,
            produces: 'grain', // Changed from 'food'
            productionRate: 10,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland'],
            description: 'Produces grain that can be milled or sold. Upkeep: 5g/day'
        },
        PASTURE: {
            id: 'pasture',
            name: 'Pasture',
            icon: '🐑',
            cost: 500,
            constructionDays: 4,
            produces: 'wool',
            productionRate: 8,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland', 'hills'],
            description: 'Raises sheep for wool. Upkeep: 5g/day'
        },
        LOGGING_CAMP: {
            id: 'logging_camp',
            name: 'Logging Camp',
            icon: '🪓',
            cost: 400,
            constructionDays: 3,
            produces: 'wood',
            productionRate: 6,
            upkeep: 5,
            requiredTerrain: ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest'],
            description: 'Harvests wood from forests. Upkeep: 5g/day'
        },
        MINE: {
            id: 'mine',
            name: 'Mine',
            icon: '⛏️',
            cost: 1000,
            constructionDays: 10,
            produces: 'iron',
            productionRate: 5,
            upkeep: 15,
            requiredResource: ['iron', 'gold_ore', 'gems', 'stone'],
            description: 'Extracts valuable resources for sale. Upkeep: 15g/day'
        },
        WORKSHOP: {
            id: 'workshop',
            name: 'Workshop',
            icon: '🔨',
            cost: 800,
            constructionDays: 7,
            produces: null, // Variable based on recipe
            productionRate: 5, // Process rate
            upkeep: 10,
            requiredSettlement: true,
            description: 'Processes raw materials into goods. Upkeep: 10g/day'
        },
        TRADING_POST: {
            id: 'trading_post',
            name: 'Trading Post',
            icon: '🏪',
            cost: 600,
            constructionDays: 6,
            produces: null,
            productionRate: 0,
            upkeep: 5,
            requiredSettlement: true,
            description: 'Attracts traveling merchants. Upkeep: 5g/day'
        },
        FISHING_WHARF: {
            id: 'fishing_wharf',
            name: 'Fishing Wharf',
            icon: '⚓',
            cost: 800,
            constructionDays: 8,
            produces: 'fish',
            productionRate: 0, // Depends on boats
            upkeep: 10,
            requiredTerrain: ['coast', 'beach'],
            description: 'Send boats to collect fish from nearby waters. Upkeep: 10g/day'
        },
        BREWERY: {
            id: 'brewery',
            name: 'Brewery',
            icon: '🍺',
            cost: 700,
            constructionDays: 6,
            produces: null, // Variable based on recipe (beer or liquor)
            productionRate: 6,
            upkeep: 8,
            requiredSettlement: true,
            description: 'Brews beer from grain or distills liquor. Sells well at taverns. Upkeep: 8g/day'
        },
        TAVERN: {
            id: 'tavern',
            name: 'Tavern',
            icon: '🍻',
            cost: 900,
            constructionDays: 8,
            produces: 'gold', // Earns gold directly from patrons
            productionRate: 0, // Income calculated dynamically based on settlement size
            upkeep: 12,
            requiredSettlement: true,
            description: 'A place for drink, gambling, and gossip. Earns gold daily from patrons. Upkeep: 12g/day'
        },
        GRAIN_MILL: {
            id: 'grain_mill',
            name: 'Grain Mill',
            icon: '🌬️',
            cost: 600,
            constructionDays: 6,
            produces: null, // Recipe-based
            productionRate: 6,
            upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['FLOUR'],
            recipeChangeCost: 0,
            description: 'Grinds grain into flour. Requires grain supply. Upkeep: 8g/day'
        },
        BAKERY: {
            id: 'bakery',
            name: 'Bakery',
            icon: '🍞',
            cost: 700,
            constructionDays: 7,
            produces: null, // Recipe-based
            productionRate: 6,
            upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['BREAD'],
            recipeChangeCost: 0,
            description: 'Bakes bread from flour. Requires flour supply. Upkeep: 8g/day'
        },
        FORGE: {
            id: 'forge',
            name: 'Forge',
            icon: '🔥',
            cost: 1000,
            constructionDays: 9,
            produces: null, // Recipe-based (tools or weapons)
            productionRate: 5,
            upkeep: 12,
            requiredSettlement: true,
            allowedRecipes: ['TOOLS', 'WEAPONS'],
            recipeChangeCost: 200,
            description: 'A dedicated smithy. Forges tools or weapons from iron. Upkeep: 12g/day'
        },
        TANNERY: {
            id: 'tannery',
            name: 'Tannery',
            icon: '🦺',
            cost: 650,
            constructionDays: 6,
            produces: null, // Recipe-based
            productionRate: 4,
            upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['LEATHER_ARMOR', 'TEXTILES'],
            recipeChangeCost: 150,
            description: 'Processes animal hides into leather armor or cured hides. Upkeep: 8g/day'
        },
        SAWMILL: {
            id: 'sawmill',
            name: 'Sawmill',
            icon: '🪚',
            cost: 500,
            constructionDays: 5,
            produces: null, // Recipe-based
            productionRate: 6,
            upkeep: 7,
            requiredTerrain: ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'hills'],
            allowedRecipes: ['FIREWOOD'],
            recipeChangeCost: 0,
            description: 'Processes timber into firewood and lumber. Upkeep: 7g/day'
        },

        // ── Raw Material Producers ──
        QUARRY: {
            id: 'quarry', name: 'Quarry', icon: '⛰️',
            cost: 700, constructionDays: 8,
            produces: 'stone', productionRate: 8, upkeep: 10,
            requiredResource: ['stone'],
            description: 'Cuts stone blocks from rocky outcrops. Essential for construction. Upkeep: 10g/day'
        },
        SALT_PANS: {
            id: 'salt_pans', name: 'Salt Pans', icon: '🧂',
            cost: 350, constructionDays: 4,
            produces: 'salt', productionRate: 6, upkeep: 5,
            requiredTerrain: ['coast', 'beach'],
            description: 'Evaporates seawater to harvest salt. A vital food preservative. Upkeep: 5g/day'
        },
        APIARY: {
            id: 'apiary', name: 'Apiary', icon: '🐝',
            cost: 300, constructionDays: 3,
            produces: 'honey', productionRate: 5, upkeep: 4,
            requiredTerrain: ['plains', 'grassland', 'forest', 'woodland', 'hills'],
            description: 'Keeps beehives for honey. Used in mead and candle-making. Upkeep: 4g/day'
        },
        ORCHARD: {
            id: 'orchard', name: 'Orchard', icon: '🍎',
            cost: 400, constructionDays: 5,
            produces: 'fruit', productionRate: 8, upkeep: 5,
            requiredTerrain: ['plains', 'grassland', 'hills', 'woodland'],
            description: 'Cultivates fruit trees for winemaking or fresh trade. Upkeep: 5g/day'
        },
        HEMP_FARM: {
            id: 'hemp_farm', name: 'Hemp Farm', icon: '🌿',
            cost: 350, constructionDays: 4,
            produces: 'hemp', productionRate: 8, upkeep: 4,
            requiredTerrain: ['plains', 'grassland'],
            description: 'Grows hemp fiber for rope-making. Vital for ships and construction. Upkeep: 4g/day'
        },
        CLAY_PIT: {
            id: 'clay_pit', name: 'Clay Pit', icon: '🟫',
            cost: 300, constructionDays: 3,
            produces: 'clay', productionRate: 8, upkeep: 4,
            requiredSettlement: true,
            description: 'Digs raw clay from riverbeds. Used for pottery. Upkeep: 4g/day'
        },
        DAIRY: {
            id: 'dairy', name: 'Dairy', icon: '🧀',
            cost: 450, constructionDays: 4,
            produces: 'cheese', productionRate: 4, upkeep: 6,
            requiredTerrain: ['plains', 'grassland'],
            description: 'Raises dairy cattle to produce aged cheese. Popular with traders. Upkeep: 6g/day'
        },

        // ── Processing Buildings ──
        SMOKEHOUSE: {
            id: 'smokehouse', name: 'Smokehouse', icon: '🍖',
            cost: 500, constructionDays: 5,
            produces: null, productionRate: 5, upkeep: 6,
            requiredSettlement: true,
            allowedRecipes: ['PRESERVED_FISH', 'DRIED_MEAT'], recipeChangeCost: 0,
            description: 'Smokes fish and cures meat for long-term preservation. Upkeep: 6g/day'
        },
        BUTCHER: {
            id: 'butcher', name: 'Butcher', icon: '🥩',
            cost: 400, constructionDays: 3,
            produces: null, productionRate: 5, upkeep: 5,
            requiredSettlement: true,
            allowedRecipes: ['DRIED_MEAT'], recipeChangeCost: 0,
            description: 'Processes hunted game and livestock into dried provisions. Upkeep: 5g/day'
        },
        ROPE_WALK: {
            id: 'rope_walk', name: 'Rope Walk', icon: '🪢',
            cost: 350, constructionDays: 3,
            produces: null, productionRate: 5, upkeep: 5,
            requiredSettlement: true,
            allowedRecipes: ['ROPE'], recipeChangeCost: 0,
            description: 'Twists hemp fiber into rope. Vital for ships and construction. Upkeep: 5g/day'
        },
        POTTERY_KILN: {
            id: 'pottery_kiln', name: 'Pottery Kiln', icon: '🏺',
            cost: 400, constructionDays: 4,
            produces: null, productionRate: 4, upkeep: 5,
            requiredSettlement: true,
            allowedRecipes: ['POTTERY'], recipeChangeCost: 0,
            description: 'Fires clay pots and vessels for households and traders. Upkeep: 5g/day'
        },
        WEAVER: {
            id: 'weaver', name: 'Weaver', icon: '🧵',
            cost: 500, constructionDays: 5,
            produces: null, productionRate: 5, upkeep: 6,
            requiredSettlement: true,
            allowedRecipes: ['TEXTILES', 'CLOTHES'], recipeChangeCost: 100,
            description: 'Weaves wool into cloth and sews fine garments. Upkeep: 6g/day'
        },
        WINERY: {
            id: 'winery', name: 'Winery', icon: '🍷',
            cost: 700, constructionDays: 7,
            produces: null, productionRate: 4, upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['WINE', 'MEAD'], recipeChangeCost: 100,
            description: 'Ferments fruit into wine and honey into mead. Premium beverages. Upkeep: 8g/day'
        },
        APOTHECARY: {
            id: 'apothecary', name: 'Apothecary', icon: '⚗️',
            cost: 600, constructionDays: 6,
            produces: null, productionRate: 3, upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['HEALING_SALVE', 'POTION'], recipeChangeCost: 150,
            description: 'Prepares herbal remedies and alchemical potions. Upkeep: 8g/day'
        },
        FLETCHER: {
            id: 'fletcher', name: 'Fletcher', icon: '🏹',
            cost: 450, constructionDays: 4,
            produces: null, productionRate: 6, upkeep: 6,
            requiredSettlement: true,
            allowedRecipes: ['ARROWS', 'BOW'], recipeChangeCost: 100,
            description: 'Crafts arrows and bows for hunters and archers. Upkeep: 6g/day'
        },
        JEWELER: {
            id: 'jeweler', name: 'Jeweler', icon: '💍',
            cost: 900, constructionDays: 8,
            produces: null, productionRate: 2, upkeep: 10,
            requiredSettlement: true,
            allowedRecipes: ['AMULET', 'LUXURIES'], recipeChangeCost: 200,
            description: 'Cuts gems and crafts fine jewelry for nobility. Upkeep: 10g/day'
        },
        DYE_WORKS: {
            id: 'dye_works', name: 'Dye Works', icon: '🎨',
            cost: 450, constructionDays: 4,
            produces: null, productionRate: 5, upkeep: 6,
            requiredSettlement: true,
            allowedRecipes: ['DYES'], recipeChangeCost: 0,
            description: 'Extracts natural dyes from berries and plants. Upkeep: 6g/day'
        },
        CHANDLERY: {
            id: 'chandlery', name: 'Chandlery', icon: '🕯️',
            cost: 350, constructionDays: 3,
            produces: null, productionRate: 5, upkeep: 5,
            requiredSettlement: true,
            allowedRecipes: ['CANDLES'], recipeChangeCost: 0,
            description: 'Renders beeswax into candles. An essential light source. Upkeep: 5g/day'
        },
        GLASSWORKS: {
            id: 'glassworks', name: 'Glassworks', icon: '🔮',
            cost: 750, constructionDays: 7,
            produces: null, productionRate: 4, upkeep: 10,
            requiredSettlement: true,
            allowedRecipes: ['GLASS', 'LANTERN'], recipeChangeCost: 150,
            description: 'Melts stone into glass and blows glass into lanterns. Upkeep: 10g/day'
        },
        SCRIPTORIUM: {
            id: 'scriptorium', name: 'Scriptorium', icon: '📖',
            cost: 600, constructionDays: 5,
            produces: null, productionRate: 3, upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['PARCHMENT', 'RARE_BOOK'], recipeChangeCost: 100,
            description: 'Monks and scribes prepare parchment and copy rare texts. Upkeep: 8g/day'
        },
        BLACKSMITH: {
            id: 'blacksmith', name: 'Blacksmith', icon: '⚔️',
            cost: 800, constructionDays: 7,
            produces: null, productionRate: 4, upkeep: 10,
            requiredSettlement: true,
            allowedRecipes: ['SHIELD', 'TOOLS', 'WEAPONS'], recipeChangeCost: 150,
            description: 'Versatile smithy producing shields, tools, and weapons. Upkeep: 10g/day'
        },
        PERFUMERY: {
            id: 'perfumery', name: 'Perfumery', icon: '🌸',
            cost: 650, constructionDays: 6,
            produces: null, productionRate: 3, upkeep: 8,
            requiredSettlement: true,
            allowedRecipes: ['PERFUME', 'INCENSE'], recipeChangeCost: 100,
            description: 'Distils flowers and resins into perfumes and incense. Upkeep: 8g/day'
        },
    },

    /**
     * Goods and their base prices
     */
    GOODS: {
        GRAIN: { id: 'grain', name: 'Grain', icon: '🌾', basePrice: 5 },
        FLOUR: { id: 'flour', name: 'Flour', icon: '🥡', basePrice: 10 },
        BREAD: { id: 'bread', name: 'Bread', icon: '🍞', basePrice: 15 },
        FISH: { id: 'fish', name: 'Raw Fish', icon: '🐟', basePrice: 8 },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoked Fish', icon: '🍥', basePrice: 20 },
        WOOD: { id: 'wood', name: 'Wood', icon: '🌲', basePrice: 8 },
        FIREWOOD: { id: 'firewood', name: 'Firewood', icon: '🔥', basePrice: 12 },
        WOOL: { id: 'wool', name: 'Wool', icon: '🐑', basePrice: 10 },
        TEXTILES: { id: 'textiles', name: 'Textiles', icon: '🧵', basePrice: 25 },
        CLOTHES: { id: 'clothes', name: 'Clothes', icon: '👕', basePrice: 40 },
        STONE: { id: 'stone', name: 'Stone', icon: '⛰️', basePrice: 8 },
        IRON: { id: 'iron', name: 'Iron', icon: '⚒️', basePrice: 20 },
        TOOLS: { id: 'tools', name: 'Tools', icon: '🔧', basePrice: 35 },
        WEAPONS: { id: 'weapons', name: 'Weapons', icon: '⚔️', basePrice: 60 },
        GOLD_ORE: { id: 'gold_ore', name: 'Gold Ore', icon: '💰', basePrice: 40 },
        GEMS: { id: 'gems', name: 'Gems', icon: '💎', basePrice: 60 },
        SPICES: { id: 'spices', name: 'Spices', icon: '🧂', basePrice: 45 },
        HORSES: { id: 'horses', name: 'Horses', icon: '🐴', basePrice: 55 },
        BEER: { id: 'beer', name: 'Beer', icon: '🍺', basePrice: 12 },
        LIQUOR: { id: 'liquor', name: 'Liquor', icon: '🥃', basePrice: 30 },
        LUXURIES: { id: 'luxuries', name: 'Luxuries', icon: '💍', basePrice: 100 },
        // Fishing catches
        SMALL_FISH: { id: 'small_fish', name: 'Small Fry', icon: '🐠', basePrice: 3 },
        LARGE_FISH: { id: 'large_fish', name: 'Large Cod', icon: '🐟', basePrice: 12 },
        CRAB: { id: 'crab', name: 'Crab', icon: '🦀', basePrice: 14 },
        SWORDFISH: { id: 'swordfish', name: 'Swordfish', icon: '🗡️', basePrice: 28 },
        LOBSTER: { id: 'lobster', name: 'Lobster', icon: '🦞', basePrice: 22 },
        GOLDEN_FISH: { id: 'golden_fish', name: 'Golden Fish', icon: '✨', basePrice: 55 },
        BOOT: { id: 'boot', name: 'Old Boot', icon: '👢', basePrice: 0 },
        SEAWEED: { id: 'seaweed', name: 'Seaweed', icon: '🌿', basePrice: 2 },
        // Prospecting finds
        ORE: { id: 'ore', name: 'Iron Ore', icon: '⛏️', basePrice: 25 },
        // Foraging / hunting misc
        HERBS: { id: 'herbs', name: 'Herbs', icon: '🌿', basePrice: 5 },
        PELTS: { id: 'pelts', name: 'Pelts', icon: '🦊', basePrice: 12 },
        BERRIES: { id: 'berries', name: 'Berries', icon: '🫐', basePrice: 3 },
        MUSHROOMS: { id: 'mushrooms', name: 'Mushrooms', icon: '🍄', basePrice: 4 },
        MEAT: { id: 'meat', name: 'Meat', icon: '🥩', basePrice: 6 },
        HIDE: { id: 'hide', name: 'Hide', icon: '🟤', basePrice: 8 },
        ANTLER: { id: 'antler', name: 'Antler', icon: '🦌', basePrice: 15 },
        FEATHER: { id: 'feather', name: 'Feather', icon: '🪶', basePrice: 4 },
        HORSE: { id: 'horse', name: 'Horse', icon: '🐴', basePrice: 120 },
        // Technology Parts
        AGRI_PARTS: { id: 'agri_parts', name: 'Agricultural Implements', icon: '🌱', basePrice: 50 },
        INDUSTRY_PARTS: { id: 'industry_parts', name: 'Industrial Components', icon: '⚙️', basePrice: 75 },
        MILITARY_PARTS: { id: 'military_parts', name: 'Military Supplies', icon: '🗡️', basePrice: 80 },
        INFRA_PARTS: { id: 'infra_parts', name: 'Engineering Plans', icon: '📐', basePrice: 60 },
        COMMERCE_PARTS: { id: 'commerce_parts', name: 'Trade Documents', icon: '📜', basePrice: 50 },
        // ── Merchant & Traveler specialty goods ──
        EXOTIC_SPICES:  { id: 'exotic_spices',  name: 'Exotic Spices',      icon: '🌶️', basePrice: 65 },
        SILK:           { id: 'silk',            name: 'Silk Cloth',         icon: '🧣', basePrice: 80 },
        PERFUME:        { id: 'perfume',         name: 'Perfume',            icon: '🌸', basePrice: 55 },
        TEA:            { id: 'tea',             name: 'Tea Leaves',         icon: '🍵', basePrice: 35 },
        WINE:           { id: 'wine',            name: 'Fine Wine',          icon: '🍷', basePrice: 45 },
        CHEESE:         { id: 'cheese',          name: 'Aged Cheese',        icon: '🧀', basePrice: 18 },
        DRIED_MEAT:     { id: 'dried_meat',      name: 'Dried Meat',         icon: '🥓', basePrice: 14 },
        HONEY:          { id: 'honey',           name: 'Honey',              icon: '🍯', basePrice: 20 },
        SALT:           { id: 'salt',            name: 'Salt',               icon: '🧊', basePrice: 15 },
        ROPE:           { id: 'rope',            name: 'Rope',               icon: '🪢', basePrice: 10 },
        CANDLES:        { id: 'candles',         name: 'Candles',            icon: '🕯️', basePrice: 8 },
        POTTERY:        { id: 'pottery',         name: 'Pottery',            icon: '🏺', basePrice: 22 },
        LEATHER_ARMOR:  { id: 'leather_armor',   name: 'Leather Armor',      icon: '🦺', basePrice: 70 },
        SHIELD:         { id: 'shield',          name: 'Shield',             icon: '🛡️', basePrice: 55 },
        BOW:            { id: 'bow',             name: 'Bow',                icon: '🏹', basePrice: 50 },
        ARROWS:         { id: 'arrows',          name: 'Arrows',             icon: '🎯', basePrice: 12 },
        HEALING_SALVE:  { id: 'healing_salve',   name: 'Healing Salve',      icon: '🩹', basePrice: 25 },
        POTION:         { id: 'potion',          name: 'Strange Potion',     icon: '🧪', basePrice: 40 },
        ELIXIR:         { id: 'elixir',          name: 'Elixir of Vigor',    icon: '⚗️', basePrice: 90 },
        TREASURE_MAP:   { id: 'treasure_map',    name: 'Treasure Map',       icon: '🗺️', basePrice: 120 },
        ANCIENT_COIN:   { id: 'ancient_coin',    name: 'Ancient Coin',       icon: '🪙', basePrice: 35 },
        RARE_BOOK:      { id: 'rare_book',       name: 'Rare Book',          icon: '📕', basePrice: 50 },
        COMPASS:        { id: 'compass',         name: 'Compass',            icon: '🧭', basePrice: 30 },
        LANTERN:        { id: 'lantern',         name: 'Lantern',            icon: '🏮', basePrice: 18 },
        AMULET:         { id: 'amulet',          name: 'Amulet',             icon: '🔮', basePrice: 75 },
        ENCHANTED_RING: { id: 'enchanted_ring',  name: 'Enchanted Ring',     icon: '💍', basePrice: 150 },
        DYES:           { id: 'dyes',            name: 'Dyes',               icon: '🎨', basePrice: 28 },
        INCENSE:        { id: 'incense',         name: 'Incense',            icon: '🪔', basePrice: 22 },
        // ── Production chain intermediates ──
        HEMP:       { id: 'hemp',       name: 'Hemp Fiber',   icon: '🌿', basePrice: 6 },
        CLAY:       { id: 'clay',       name: 'Raw Clay',     icon: '🟫', basePrice: 4 },
        FRUIT:      { id: 'fruit',      name: 'Fresh Fruit',  icon: '🍎', basePrice: 5 },
        GLASS:      { id: 'glass',      name: 'Glass',        icon: '🪟', basePrice: 18 },
        MEAD:       { id: 'mead',       name: 'Mead',         icon: '🫗', basePrice: 25 },
        PARCHMENT:  { id: 'parchment',  name: 'Parchment',    icon: '📄', basePrice: 14 },
    },

    /**
     * Crafting Recipes for Workshops
     */
    RECIPES: {
        FIREWOOD: { id: 'firewood', name: 'Split Firewood', input: 'wood', inputQty: 2, output: 'firewood', outputQty: 5, description: 'Prepare fuel for heating.' },
        FLOUR: { id: 'flour', name: 'Mill Flour', input: 'grain', inputQty: 2, output: 'flour', outputQty: 2, description: 'Grind grain into flour.' },
        BREAD: { id: 'bread', name: 'Bake Bread', input: 'flour', inputQty: 1, output: 'bread', outputQty: 4, description: 'Bake nutritious bread.' },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoke Fish', input: 'fish', inputQty: 2, output: 'preserved_fish', outputQty: 3, description: 'Preserve fish for long-term storage.' },
        TEXTILES: { id: 'textiles', name: 'Weave Textiles', input: 'wool', inputQty: 3, output: 'textiles', outputQty: 2, description: 'Weave wool into cloth.' },
        CLOTHES: { id: 'clothes', name: 'Tailor Clothes', input: 'textiles', inputQty: 1, output: 'clothes', outputQty: 2, description: 'Sew warm clothing.' },
        TOOLS: { id: 'tools', name: 'Forge Tools', input: 'iron', inputQty: 1, output: 'tools', outputQty: 2, description: 'Smith essential tools.' },
        WEAPONS: { id: 'weapons', name: 'Forge Weapons', input: 'iron', inputQty: 2, output: 'weapons', outputQty: 1, description: 'Forge weapons for war.' },
        LUXURIES: { id: 'luxuries', name: 'Refine Luxuries', input: 'gold_ore', inputQty: 2, output: 'luxuries', outputQty: 1, description: 'Craft fine jewelry.' },
        BEER: { id: 'beer', name: 'Brew Beer', input: 'grain', inputQty: 3, output: 'beer', outputQty: 4, description: 'Brew ale from grain. Popular at taverns.' },
        LIQUOR: { id: 'liquor', name: 'Distill Liquor', input: 'grain', inputQty: 5, output: 'liquor', outputQty: 2, description: 'Distill strong spirits from grain. High value.' },
        LEATHER_ARMOR: { id: 'leather_armor', name: 'Tan Leather Armor', input: 'hide', inputQty: 3, output: 'leather_armor', outputQty: 1, description: 'Cure hides into protective leather armor.' },
        // ── New production chain recipes ──
        DRIED_MEAT:    { id: 'dried_meat',    name: 'Cure Dried Meat',    input: 'meat',      inputQty: 2, output: 'dried_meat',    outputQty: 3, description: 'Cure raw meat into dried provisions.' },
        WINE:          { id: 'wine',          name: 'Ferment Wine',       input: 'fruit',     inputQty: 3, output: 'wine',          outputQty: 2, description: 'Ferment fruit into fine wine.' },
        MEAD:          { id: 'mead',          name: 'Brew Mead',          input: 'honey',     inputQty: 3, output: 'mead',          outputQty: 2, description: 'Ferment honey into golden mead.' },
        CANDLES:       { id: 'candles',       name: 'Dip Candles',        input: 'honey',     inputQty: 2, output: 'candles',       outputQty: 4, description: 'Render beeswax into candles.' },
        ROPE:          { id: 'rope',          name: 'Twist Rope',         input: 'hemp',      inputQty: 2, output: 'rope',          outputQty: 3, description: 'Twist hemp fiber into rope.' },
        POTTERY:       { id: 'pottery',       name: 'Fire Pottery',       input: 'clay',      inputQty: 3, output: 'pottery',       outputQty: 2, description: 'Fire clay into pots and vessels.' },
        GLASS:         { id: 'glass',         name: 'Smelt Glass',        input: 'stone',     inputQty: 3, output: 'glass',         outputQty: 2, description: 'Melt stone into clear glass.' },
        LANTERN:       { id: 'lantern',       name: 'Blow Lanterns',      input: 'glass',     inputQty: 2, output: 'lantern',       outputQty: 1, description: 'Blow glass into oil lanterns.' },
        PARCHMENT:     { id: 'parchment',     name: 'Prepare Parchment',  input: 'hide',      inputQty: 2, output: 'parchment',     outputQty: 3, description: 'Scrape hides into writing parchment.' },
        RARE_BOOK:     { id: 'rare_book',     name: 'Copy Rare Book',     input: 'parchment', inputQty: 3, output: 'rare_book',     outputQty: 1, description: 'Hand-copy illuminated manuscripts.' },
        DYES:          { id: 'dyes',          name: 'Extract Dyes',       input: 'berries',   inputQty: 3, output: 'dyes',          outputQty: 2, description: 'Crush berries into natural dyes.' },
        SHIELD:        { id: 'shield',        name: 'Forge Shield',       input: 'iron',      inputQty: 2, output: 'shield',        outputQty: 1, description: 'Hammer iron into a sturdy shield.' },
        ARROWS:        { id: 'arrows',        name: 'Fletch Arrows',      input: 'wood',      inputQty: 1, output: 'arrows',        outputQty: 8, description: 'Whittle and tip arrows for archers.' },
        BOW:           { id: 'bow',           name: 'Craft Bow',          input: 'wood',      inputQty: 3, output: 'bow',           outputQty: 1, description: 'Bend a yew stave into a longbow.' },
        HEALING_SALVE: { id: 'healing_salve', name: 'Brew Healing Salve', input: 'herbs',     inputQty: 2, output: 'healing_salve', outputQty: 1, description: 'Infuse herbs into a medicinal salve.' },
        POTION:        { id: 'potion',        name: 'Brew Potion',        input: 'mushrooms', inputQty: 3, output: 'potion',        outputQty: 1, description: 'Brew mushrooms into a mysterious potion.' },
        AMULET:        { id: 'amulet',        name: 'Cut Amulet',         input: 'gems',      inputQty: 2, output: 'amulet',        outputQty: 1, description: 'Cut gemstones into enchanted amulets.' },
        PERFUME:       { id: 'perfume',       name: 'Distil Perfume',     input: 'herbs',     inputQty: 3, output: 'perfume',       outputQty: 1, description: 'Distil aromatic herbs into perfume.' },
        INCENSE_RECIPE: { id: 'incense_recipe', name: 'Press Incense',    input: 'herbs',     inputQty: 2, output: 'incense',       outputQty: 2, description: 'Press herbs into fragrant incense.' },
    },

    ROUTE_CREATION_COST: {
        legal: 280,
        smuggling: 220,
    },

    ROUTE_DISPATCH_COST: {
        legal: 120,
        smuggling: 95,
    },

    ensureEconomyState(player) {
        if (!Array.isArray(player.tradeRoutes)) player.tradeRoutes = [];
        if (!Array.isArray(player.smugglingRoutes)) player.smugglingRoutes = [];
        if (!player.auctions) {
            player.auctions = { active: [], won: [], nextRefreshDay: 1, nextId: 1 };
        }
        if (!Array.isArray(player.auctions.active)) player.auctions.active = [];
        if (!Array.isArray(player.auctions.won)) player.auctions.won = [];
        if (!player.auctions.nextRefreshDay) player.auctions.nextRefreshDay = 1;
        if (!player.auctions.nextId) player.auctions.nextId = 1;
        if (!player.auctions.lastProcessedDay) player.auctions.lastProcessedDay = 0;
    },

    getRouteGoodsOptions(player) {
        if (!player.inventory) return [];
        const options = [];
        for (const [goodId, qty] of Object.entries(player.inventory)) {
            if (qty <= 0) continue;
            const entry = Object.values(PlayerEconomy.GOODS).find(g => g.id === goodId);
            options.push({
                id: goodId,
                name: entry ? entry.name : goodId,
                icon: entry ? entry.icon : '📦',
                qty,
            });
        }
        return options.sort((a, b) => b.qty - a.qty);
    },

    createPersistentRoute(player, world, config = {}) {
        PlayerEconomy.ensureEconomyState(player);

        const isSmuggling = !!config.isSmuggling;
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const fromPos = config.fromPos;
        const toPos = config.toPos;
        const goodId = config.goodId;
        const quantity = Math.max(1, Math.floor(config.quantity || 1));
        const frequencyDays = Math.max(1, Math.floor(config.frequencyDays || 3));

        if (!fromPos || !toPos || !goodId) return { success: false, reason: 'Invalid route parameters' };

        const fromTile = world.getTile(fromPos.q, fromPos.r);
        const toTile = world.getTile(toPos.q, toPos.r);
        if (!fromTile || !toTile || !fromTile.settlement || !toTile.settlement) {
            return { success: false, reason: 'Routes require settlement endpoints' };
        }

        const distance = Hex.wrappingDistance(fromPos.q, fromPos.r, toPos.q, toPos.r, world.width);
        if (distance < 2) return { success: false, reason: 'Destination is too close' };
        if (distance > 20) return { success: false, reason: 'Destination is too far (max 20)' };

        const creationCost = isSmuggling ? PlayerEconomy.ROUTE_CREATION_COST.smuggling : PlayerEconomy.ROUTE_CREATION_COST.legal;
        if (player.gold < creationCost) return { success: false, reason: `Need ${creationCost} gold to establish route` };

        const duplicate = routePool.find(r =>
            r.fromPos.q === fromPos.q &&
            r.fromPos.r === fromPos.r &&
            r.toPos.q === toPos.q &&
            r.toPos.r === toPos.r &&
            r.goodId === goodId
        );
        if (duplicate) return { success: false, reason: 'A matching route already exists' };

        const routeId = `${isSmuggling ? 'SR' : 'TR'}-${Date.now()}-${Math.floor(Utils.random() * 999)}`;
        const route = {
            id: routeId,
            isSmuggling,
            fromPos: { q: fromPos.q, r: fromPos.r },
            toPos: { q: toPos.q, r: toPos.r },
            fromName: fromTile.settlement.name,
            toName: toTile.settlement.name,
            goodId,
            quantity,
            frequencyDays,
            nextDispatchIn: 0,
            prosperity: 0,
            protection: 0,
            roadQuality: 0,
            totalRuns: 0,
            successfulRuns: 0,
            raidedRuns: 0,
            lastResult: 'idle',
            lastProfit: 0,
            createdOnDay: world.day || 1,
            activeCaravanId: null,
        };

        player.gold -= creationCost;
        routePool.push(route);

        return { success: true, route, creationCost };
    },

    cancelPersistentRoute(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const idx = routePool.findIndex(r => r.id === routeId);
        if (idx < 0) return { success: false, reason: 'Route not found' };
        const [removed] = routePool.splice(idx, 1);
        return { success: true, route: removed };
    },

    upgradeRouteProtection(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const route = routePool.find(r => r.id === routeId);
        if (!route) return { success: false, reason: 'Route not found' };
        if (route.protection >= 5) return { success: false, reason: 'Protection already maxed' };

        const cost = 180 + route.protection * 90;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        route.protection += 1;
        return { success: true, route, cost };
    },

    upgradeRouteRoadQuality(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const route = routePool.find(r => r.id === routeId);
        if (!route) return { success: false, reason: 'Route not found' };
        if (route.roadQuality >= 5) return { success: false, reason: 'Road quality already maxed' };

        const cost = 200 + route.roadQuality * 100;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        route.roadQuality += 1;
        return { success: true, route, cost };
    },

    _getRouteById(player, routeId, isSmuggling = false) {
        const pool = isSmuggling ? (player.smugglingRoutes || []) : (player.tradeRoutes || []);
        return pool.find(r => r.id === routeId) || null;
    },

    _dispatchRouteCaravan(player, route, world) {
        if (!route || route.activeCaravanId) return { success: false, reason: 'Route already has an active caravan' };

        const dispatchCost = route.isSmuggling ? PlayerEconomy.ROUTE_DISPATCH_COST.smuggling : PlayerEconomy.ROUTE_DISPATCH_COST.legal;
        if (player.gold < dispatchCost) {
            route.lastResult = 'stalled_funds';
            return { success: false, reason: 'Not enough gold for dispatch' };
        }

        if (!player.inventory) player.inventory = {};
        if ((player.inventory[route.goodId] || 0) < route.quantity) {
            route.lastResult = 'stalled_goods';
            return { success: false, reason: 'Not enough goods in inventory' };
        }

        const fromTile = world.getTile(route.fromPos.q, route.fromPos.r);
        const toTile = world.getTile(route.toPos.q, route.toPos.r);
        if (!fromTile || !toTile || !toTile.settlement) {
            route.lastResult = 'stalled_invalid';
            return { success: false, reason: 'Route endpoint is invalid' };
        }

        const goods = { [route.goodId]: route.quantity };
        const dist = Hex.wrappingDistance(route.fromPos.q, route.fromPos.r, route.toPos.q, route.toPos.r, world.width);

        let expectedProfit = 0;
        const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === route.goodId);
        if (good) {
            let unitPrice = good.basePrice * (1 + dist * 0.05);
            const sizeMultiplier = { village: 0.8, town: 1.0, city: 1.2, capital: 1.5 };
            unitPrice *= sizeMultiplier[toTile.settlement.type] || 1.0;
            expectedProfit = Math.floor(unitPrice * route.quantity);
        }

        player.gold -= dispatchCost;
        player.inventory[route.goodId] -= route.quantity;
        if (player.inventory[route.goodId] <= 0) delete player.inventory[route.goodId];

        const caravan = {
            from: route.fromName,
            to: route.toName,
            fromPos: { q: route.fromPos.q, r: route.fromPos.r },
            toPos: { q: route.toPos.q, r: route.toPos.r },
            currentPos: { q: route.fromPos.q, r: route.fromPos.r },
            distance: dist,
            goods,
            expectedProfit,
            daysRemaining: Math.max(1, Math.ceil(dist / 2)),
            status: 'traveling',
            routeId: route.id,
            isSmugglingRoute: !!route.isSmuggling,
        };

        const caravanUnit = new WorldUnit('caravan', route.fromPos.q, route.fromPos.r, route.toPos.q, route.toPos.r);
        caravanUnit.playerOwned = true;
        caravanUnit.goods = { ...goods };
        caravanUnit.isSmugglingRoute = !!route.isSmuggling;
        world.units.push(caravanUnit);

        caravan.unitId = caravanUnit.id;

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        route.activeCaravanId = caravanUnit.id;
        route.nextDispatchIn = Math.max(1, route.frequencyDays);
        route.totalRuns = (route.totalRuns || 0) + 1;
        route.lastResult = 'dispatched';

        return { success: true, caravan };
    },

    _tickPersistentRoutes(player, world) {
        const allRoutes = [...(player.tradeRoutes || []), ...(player.smugglingRoutes || [])];
        for (const route of allRoutes) {
            if (route.activeCaravanId) {
                const unitAlive = world.units.some(u => u.id === route.activeCaravanId && !u.destroyed);
                if (!unitAlive) route.activeCaravanId = null;
            }

            if (route.nextDispatchIn > 0) route.nextDispatchIn--;
            if (route.activeCaravanId) continue;
            if (route.nextDispatchIn > 0) continue;

            PlayerEconomy._dispatchRouteCaravan(player, route, world);
        }
    },

    _recordRouteLoss(route) {
        route.activeCaravanId = null;
        route.raidedRuns = (route.raidedRuns || 0) + 1;
        route.lastResult = 'raided';
        route.lastProfit = 0;
        route.prosperity = Math.max(0, (route.prosperity || 0) - 0.35);
    },

    _recordRouteSuccess(route, finalProfit) {
        route.activeCaravanId = null;
        route.successfulRuns = (route.successfulRuns || 0) + 1;
        route.lastResult = 'profit';
        route.lastProfit = finalProfit;

        const protectionGrowth = (route.protection || 0) * 0.05;
        const roadGrowth = (route.roadQuality || 0) * 0.06;
        route.prosperity = Math.min(6, (route.prosperity || 0) + 0.18 + protectionGrowth + roadGrowth);
    },
});
