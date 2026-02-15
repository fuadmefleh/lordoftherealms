// ============================================
// TECHNOLOGY — Research tree & tech progression
// Requires: Workshop with Lab upgrade, crafting
// parts, and implementation to activate effects.
// ============================================

const Technology = {
    // ── Technology Categories ──
    CATEGORIES: {
        AGRICULTURE: { id: 'agriculture', name: 'Agriculture', icon: '🌾', color: '#4caf50' },
        INDUSTRY: { id: 'industry', name: 'Industry', icon: '⚒️', color: '#ff9800' },
        MILITARY: { id: 'military', name: 'Military', icon: '⚔️', color: '#f44336' },
        INFRASTRUCTURE: { id: 'infrastructure', name: 'Infrastructure', icon: '🛤️', color: '#9c27b0' },
        COMMERCE: { id: 'commerce', name: 'Commerce', icon: '💰', color: '#ffc107' },
    },

    // ═══════════════════════════════════════
    //  LAB & WORKSHOP CONFIGURATION
    // ═══════════════════════════════════════

    // Which property types can have labs, and which tech categories they support
    LAB_CONFIG: {
        farm: {
            categories: ['agriculture'],
            labName: 'Experimental Garden',
            labIcon: '🧪',
            labCost: 800,
            labMaterials: { wood: 20, stone: 10 },
            labUpkeep: 5,
            description: 'A dedicated space for agricultural experiments and crop research.',
        },
        workshop: {
            categories: ['industry', 'military', 'infrastructure'],
            labName: 'Research Laboratory',
            labIcon: '🔬',
            labCost: 1500,
            labMaterials: { stone: 30, iron: 20 },
            labUpkeep: 10,
            description: 'An advanced facility for engineering, metallurgy, and military research.',
        },
        trading_post: {
            categories: ['commerce'],
            labName: 'Trade Academy',
            labIcon: '📊',
            labCost: 1000,
            labMaterials: { wood: 20 },
            labUpkeep: 8,
            description: 'A school of commerce, economics, and trade strategy.',
        },
    },

    // Maps tech categories to their parts item type
    CATEGORY_PARTS: {
        agriculture: 'agri_parts',
        industry: 'industry_parts',
        military: 'military_parts',
        infrastructure: 'infra_parts',
        commerce: 'commerce_parts',
    },

    // Parts crafting recipes at labs
    PARTS_CRAFTING: {
        agri_parts: { name: 'Agricultural Implements', icon: '🌱', gold: 150, materials: { grain: 15, wood: 5 }, quantity: 3, days: 3 },
        industry_parts: { name: 'Industrial Components', icon: '⚙️', gold: 200, materials: { iron: 10, wood: 10 }, quantity: 3, days: 4 },
        military_parts: { name: 'Military Supplies', icon: '🗡️', gold: 250, materials: { iron: 15, wood: 5 }, quantity: 3, days: 4 },
        infra_parts: { name: 'Engineering Plans', icon: '📐', gold: 200, materials: { stone: 10, wood: 10 }, quantity: 3, days: 3 },
        commerce_parts: { name: 'Trade Documents', icon: '📜', gold: 150, materials: { wood: 10 }, quantity: 3, days: 3 },
    },

    // Research cost overrides — replaces the old cheap cost/days with expensive requirements
    RESEARCH_COSTS: {
        // Agriculture
        crop_rotation:        { gold: 400,  materials: { grain: 10 },                     days: 12 },
        irrigation:           { gold: 800,  materials: { grain: 15, wood: 10 },            days: 18 },
        selective_breeding:   { gold: 400,  materials: { wool: 5, grain: 10 },             days: 12 },
        fertilization:        { gold: 1200, materials: { grain: 20, wood: 10 },            days: 25 },
        granary_construction: { gold: 800,  materials: { wood: 20, stone: 15 },            days: 18 },
        // Industry
        improved_tools:       { gold: 500,  materials: { iron: 10, wood: 10 },             days: 12 },
        advanced_smelting:    { gold: 900,  materials: { iron: 20, stone: 10 },            days: 18 },
        water_mill:           { gold: 900,  materials: { wood: 25, stone: 15 },            days: 20 },
        stonecutting:         { gold: 800,  materials: { stone: 20, iron: 5 },             days: 15 },
        steel_forging:        { gold: 1500, materials: { iron: 30, stone: 10 },            days: 28 },
        // Military
        basic_training:       { gold: 500,  materials: { weapons: 5, wood: 10 },           days: 12 },
        archery_mastery:      { gold: 900,  materials: { weapons: 10, wood: 20 },          days: 18 },
        cavalry_tactics:      { gold: 1000, materials: { horses: 3, weapons: 10 },         days: 20 },
        siege_engineering:    { gold: 1500, materials: { iron: 20, wood: 30, stone: 20 },  days: 28 },
        fortification:        { gold: 1200, materials: { stone: 30, iron: 10 },            days: 25 },
        // Infrastructure
        road_building:        { gold: 400,  materials: { stone: 10, wood: 10 },            days: 10 },
        paved_roads:          { gold: 800,  materials: { stone: 25, iron: 5 },             days: 18 },
        bridge_construction:  { gold: 800,  materials: { wood: 20, stone: 15, iron: 5 },   days: 18 },
        cartography:          { gold: 700,  materials: { wood: 10 },                       days: 15 },
        aqueducts:            { gold: 1500, materials: { stone: 40, iron: 10 },            days: 30 },
        // Commerce
        basic_accounting:     { gold: 400,  materials: { wood: 5 },                        days: 10 },
        trade_networks:       { gold: 800,  materials: { wood: 15 },                       days: 18 },
        currency_minting:     { gold: 1000, materials: { iron: 15, gold_ore: 5 },          days: 20 },
        merchant_guild:       { gold: 1500, materials: { wood: 20, stone: 20 },            days: 28 },
        banking_systems:      { gold: 2000, materials: { iron: 10, wood: 10, gems: 3 },    days: 35 },
    },

    // ── Technology Definitions ──
    TECHS: {
        // ═══════════════════════════════
        //  AGRICULTURE BRANCH
        // ═══════════════════════════════
        CROP_ROTATION: {
            id: 'crop_rotation',
            name: 'Crop Rotation',
            icon: '🔄',
            category: 'agriculture',
            cost: 100,
            days: 5,
            requires: [],
            tier: 1,
            description: 'Rotating crops across fields restores soil nutrients and improves yields.',
            effects: { farmProductionBonus: 0.20 },
            flavorText: 'The land gives more when you give it time to breathe.',
        },
        IRRIGATION: {
            id: 'irrigation',
            name: 'Irrigation Systems',
            icon: '💧',
            category: 'agriculture',
            cost: 200,
            days: 8,
            requires: ['crop_rotation'],
            tier: 2,
            description: 'Channel water to fields for consistent irrigation.',
            effects: { farmProductionBonus: 0.30, unlockBuilding: 'IRRIGATED_FARM', unlockInfrastructure: 'IRRIGATION_CHANNEL' },
            flavorText: 'Where water flows, life follows.',
        },
        SELECTIVE_BREEDING: {
            id: 'selective_breeding',
            name: 'Selective Breeding',
            icon: '🐑',
            category: 'agriculture',
            cost: 150,
            days: 7,
            requires: [],
            tier: 1,
            description: 'Breed stronger livestock for better wool and meat.',
            effects: { pastureProductionBonus: 0.25 },
            flavorText: 'Nature perfected through patience and observation.',
        },
        FERTILIZATION: {
            id: 'fertilization',
            name: 'Advanced Fertilization',
            icon: '🧪',
            category: 'agriculture',
            cost: 300,
            days: 10,
            requires: ['crop_rotation', 'selective_breeding'],
            tier: 3,
            description: 'Use composting and manure techniques to dramatically boost farm output.',
            effects: { farmProductionBonus: 0.40 },
            flavorText: 'From waste, abundance. The circle of the field is complete.',
        },
        GRANARY_CONSTRUCTION: {
            id: 'granary_construction',
            name: 'Granary Construction',
            icon: '🏛️',
            category: 'agriculture',
            cost: 200,
            days: 8,
            requires: ['crop_rotation'],
            tier: 2,
            description: 'Build granaries to store surplus grain and prevent spoilage.',
            effects: { storageBonus: 0.50, unlockBuilding: 'GRANARY' },
            flavorText: 'Seven years of plenty shall sustain seven years of famine.',
        },

        // ═══════════════════════════════
        //  INDUSTRY BRANCH
        // ═══════════════════════════════
        IMPROVED_TOOLS: {
            id: 'improved_tools',
            name: 'Improved Tools',
            icon: '🔧',
            category: 'industry',
            cost: 150,
            days: 6,
            requires: [],
            tier: 1,
            description: 'Better-forged tools increase mining and logging efficiency.',
            effects: { mineProductionBonus: 0.20, loggingProductionBonus: 0.20 },
            flavorText: 'A sharp axe makes light work.',
        },
        ADVANCED_SMELTING: {
            id: 'advanced_smelting',
            name: 'Advanced Smelting',
            icon: '🔥',
            category: 'industry',
            cost: 200,
            days: 8,
            requires: ['improved_tools'],
            tier: 2,
            description: 'Higher-temperature smelting yields purer metals.',
            effects: { mineProductionBonus: 0.25, unlockBuilding: 'FOUNDRY' },
            flavorText: 'In the heart of the forge, impurities burn away.',
        },
        WATER_MILL: {
            id: 'water_mill',
            name: 'Water Mill',
            icon: '⚙️',
            category: 'industry',
            cost: 250,
            days: 10,
            requires: ['improved_tools'],
            tier: 2,
            description: 'Harness water power to automate milling and sawing.',
            effects: { unlockBuilding: 'WATER_MILL', workshopProductionBonus: 0.30 },
            flavorText: 'The river works tirelessly so we don\'t have to.',
        },
        STONECUTTING: {
            id: 'stonecutting',
            name: 'Stonecutting',
            icon: '🪨',
            category: 'industry',
            cost: 200,
            days: 7,
            requires: ['improved_tools'],
            tier: 2,
            description: 'Cut and shape stone for stronger construction.',
            effects: { unlockBuilding: 'QUARRY', buildingCostReduction: 0.15 },
            flavorText: 'From rough rock, we carve the foundations of empire.',
        },
        STEEL_FORGING: {
            id: 'steel_forging',
            name: 'Steel Forging',
            icon: '🗡️',
            category: 'industry',
            cost: 400,
            days: 12,
            requires: ['advanced_smelting', 'water_mill'],
            tier: 3,
            description: 'Forge weapons and armor of superior steel.',
            effects: { unlockRecipe: 'STEEL_WEAPONS', unlockRecipe2: 'STEEL_ARMOR', weaponsCraftBonus: 0.40 },
            flavorText: 'Steel that sings when drawn — a craftsman\'s pride.',
        },

        // ═══════════════════════════════
        //  MILITARY BRANCH
        // ═══════════════════════════════
        BASIC_TRAINING: {
            id: 'basic_training',
            name: 'Basic Training',
            icon: '🎯',
            category: 'military',
            cost: 100,
            days: 5,
            requires: [],
            tier: 1,
            description: 'Organized militia training for better combat performance.',
            effects: { unitStrengthBonus: 0.10 },
            flavorText: 'Even farmers fight better when they know which end of the sword to hold.',
        },
        ARCHERY_MASTERY: {
            id: 'archery_mastery',
            name: 'Archery Mastery',
            icon: '🏹',
            category: 'military',
            cost: 200,
            days: 8,
            requires: ['basic_training'],
            tier: 2,
            description: 'Advanced bow techniques for deadlier ranged attacks.',
            effects: { unlockUnit: 'LONGBOWMAN', archerStrengthBonus: 0.30 },
            flavorText: 'Their arrows blot out the sun.',
        },
        CAVALRY_TACTICS: {
            id: 'cavalry_tactics',
            name: 'Cavalry Tactics',
            icon: '🐴',
            category: 'military',
            cost: 250,
            days: 10,
            requires: ['basic_training'],
            tier: 2,
            description: 'Mounted combat formations and flanking maneuvers.',
            effects: { unlockUnit: 'CAVALRY', knightStrengthBonus: 0.25 },
            flavorText: 'A thundering charge to break any shield wall.',
        },
        SIEGE_ENGINEERING: {
            id: 'siege_engineering',
            name: 'Siege Engineering',
            icon: '🏰',
            category: 'military',
            cost: 350,
            days: 12,
            requires: ['archery_mastery', 'stonecutting'],
            tier: 3,
            description: 'Build siege engines to assault fortified positions.',
            effects: { unlockUnit: 'SIEGE_ENGINE' },
            flavorText: 'No wall can stand against the relentless pounding.',
        },
        FORTIFICATION: {
            id: 'fortification',
            name: 'Fortification',
            icon: '🏗️',
            category: 'military',
            cost: 300,
            days: 10,
            requires: ['stonecutting', 'basic_training'],
            tier: 3,
            description: 'Build defensive walls and watchtowers for your settlements.',
            effects: { unlockBuilding: 'WATCHTOWER', defenseBonus: 0.30 },
            flavorText: 'These walls shall be our unyielding shield.',
        },

        // ═══════════════════════════════
        //  INFRASTRUCTURE BRANCH
        // ═══════════════════════════════
        ROAD_BUILDING: {
            id: 'road_building',
            name: 'Road Building',
            icon: '🛤️',
            category: 'infrastructure',
            cost: 150,
            days: 6,
            requires: [],
            tier: 1,
            description: 'Construct dirt roads between hexes to speed travel.',
            effects: { unlockInfrastructure: 'DIRT_ROAD' },
            flavorText: 'All great journeys begin with a well-trodden path.',
        },
        PAVED_ROADS: {
            id: 'paved_roads',
            name: 'Paved Roads',
            icon: '🛣️',
            category: 'infrastructure',
            cost: 300,
            days: 10,
            requires: ['road_building', 'stonecutting'],
            tier: 2,
            description: 'Stone-paved roads for even faster travel.',
            effects: { unlockInfrastructure: 'STONE_ROAD' },
            flavorText: 'Rome endured because its roads did.',
        },
        BRIDGE_CONSTRUCTION: {
            id: 'bridge_construction',
            name: 'Bridge Construction',
            icon: '🌉',
            category: 'infrastructure',
            cost: 250,
            days: 8,
            requires: ['road_building'],
            tier: 2,
            description: 'Build bridges to cross rivers and reduce swamp penalties.',
            effects: { unlockInfrastructure: 'BRIDGE', riverCrossReduction: 0.50 },
            flavorText: 'Where rivers once stopped us, bridges carry us onward.',
        },
        CARTOGRAPHY: {
            id: 'cartography',
            name: 'Cartography',
            icon: '🗺️',
            category: 'infrastructure',
            cost: 200,
            days: 7,
            requires: ['road_building'],
            tier: 2,
            description: 'Map the land to reveal more territory and plan better routes.',
            effects: { visionRadiusBonus: 2, movementBonus: 1 },
            flavorText: 'With knowledge of the land comes mastery over it.',
        },
        AQUEDUCTS: {
            id: 'aqueducts',
            name: 'Aqueducts',
            icon: '🏛️',
            category: 'infrastructure',
            cost: 400,
            days: 14,
            requires: ['paved_roads', 'irrigation'],
            tier: 3,
            description: 'Monumental water channels that boost settlement growth.',
            effects: { settlementGrowthBonus: 0.30, settlementFoodBonus: 0.20 },
            flavorText: 'Water flows uphill when engineers will it so.',
        },

        // ═══════════════════════════════
        //  COMMERCE BRANCH
        // ═══════════════════════════════
        BASIC_ACCOUNTING: {
            id: 'basic_accounting',
            name: 'Basic Accounting',
            icon: '📒',
            category: 'commerce',
            cost: 100,
            days: 5,
            requires: [],
            tier: 1,
            description: 'Better bookkeeping means lower trade losses.',
            effects: { tradeProfitBonus: 0.15 },
            flavorText: 'A lord who knows his ledger commands more than gold.',
        },
        TRADE_NETWORKS: {
            id: 'trade_networks',
            name: 'Trade Networks',
            icon: '🤝',
            category: 'commerce',
            cost: 200,
            days: 8,
            requires: ['basic_accounting'],
            tier: 2,
            description: 'Establish trade routes for higher caravan profits.',
            effects: { caravanProfitBonus: 0.25, caravanSpeedBonus: 0.20 },
            flavorText: 'Connections forged in gold last longer than those in iron.',
        },
        CURRENCY_MINTING: {
            id: 'currency_minting',
            name: 'Currency Minting',
            icon: '🪙',
            category: 'commerce',
            cost: 250,
            days: 10,
            requires: ['basic_accounting', 'advanced_smelting'],
            tier: 2,
            description: 'Mint your own coins for more favorable trade terms.',
            effects: { tradePriceDiscount: 0.10, propertyIncomeBonus: 0.15 },
            flavorText: 'A coin with your likeness commands respect in any market.',
        },
        MERCHANT_GUILD: {
            id: 'merchant_guild',
            name: 'Merchant Guild',
            icon: '🏦',
            category: 'commerce',
            cost: 350,
            days: 12,
            requires: ['trade_networks', 'currency_minting'],
            tier: 3,
            description: 'Found a merchant guild for powerful economic bonuses.',
            effects: { unlockBuilding: 'MERCHANT_GUILD', tradeProfitBonus: 0.20, loanInterestReduction: 0.25 },
            flavorText: 'United merchants shape the fate of kingdoms.',
        },
        BANKING_SYSTEMS: {
            id: 'banking_systems',
            name: 'Banking Systems',
            icon: '🏧',
            category: 'commerce',
            cost: 400,
            days: 14,
            requires: ['merchant_guild'],
            tier: 4,
            description: 'Advanced financial institutions and investment returns.',
            effects: { dailyInterestIncome: 0.002, loanInterestReduction: 0.20 },
            flavorText: 'Let money beget money, and prosperity shall follow.',
        },
    },

    // ── New Buildings Unlocked by Tech ──
    TECH_BUILDINGS: {
        IRRIGATED_FARM: {
            id: 'irrigated_farm',
            name: 'Irrigated Farm',
            icon: '💧🌾',
            cost: 750,
            produces: 'grain',
            productionRate: 18,
            upkeep: 8,
            requiredTerrain: ['plains', 'grassland', 'savanna', 'desert'],
            requiredTech: 'irrigation',
            description: 'Irrigated farmland produces abundant grain even in arid regions. Upkeep: 8g/day',
        },
        GRANARY: {
            id: 'granary',
            name: 'Granary',
            icon: '🏛️',
            cost: 600,
            produces: null,
            productionRate: 0,
            upkeep: 3,
            requiredSettlement: true,
            requiredTech: 'granary_construction',
            description: 'Stores surplus grain and prevents spoilage. Doubles property storage. Upkeep: 3g/day',
        },
        FOUNDRY: {
            id: 'foundry',
            name: 'Foundry',
            icon: '🔥',
            cost: 1200,
            produces: null,
            productionRate: 8,
            upkeep: 20,
            requiredResource: ['iron', 'coal'],
            requiredTech: 'advanced_smelting',
            description: 'Advanced metalworking facility. Produces refined metals. Upkeep: 20g/day',
        },
        WATER_MILL: {
            id: 'water_mill_building',
            name: 'Water Mill',
            icon: '⚙️',
            cost: 900,
            produces: null,
            productionRate: 10,
            upkeep: 8,
            requiredTerrain: ['plains', 'grassland', 'woodland'],
            requiredTech: 'water_mill',
            description: 'Water-powered mill for automated processing. +30% workshop output. Upkeep: 8g/day',
        },
        QUARRY: {
            id: 'quarry',
            name: 'Quarry',
            icon: '🪨',
            cost: 800,
            produces: 'stone',
            productionRate: 8,
            upkeep: 12,
            requiredTerrain: ['hills', 'mountain', 'highlands'],
            requiredTech: 'stonecutting',
            description: 'Extracts building stone from the earth. Upkeep: 12g/day',
        },
        WATCHTOWER: {
            id: 'watchtower',
            name: 'Watchtower',
            icon: '🗼',
            cost: 500,
            produces: null,
            productionRate: 0,
            upkeep: 5,
            requiredTech: 'fortification',
            description: 'Guards the surrounding area and extends vision. Upkeep: 5g/day',
        },
        MERCHANT_GUILD: {
            id: 'merchant_guild_building',
            name: 'Merchant Guild',
            icon: '🏦',
            cost: 1500,
            produces: null,
            productionRate: 0,
            upkeep: 15,
            requiredSettlement: true,
            requiredTech: 'merchant_guild',
            description: 'A guild hall that boosts all trade profits. Upkeep: 15g/day',
        },
    },

    // ── New Military Units Unlocked by Tech ──
    TECH_UNITS: {
        LONGBOWMAN: {
            id: 'longbowman',
            name: 'Longbowman',
            icon: '🎯',
            cost: 150,
            upkeep: 7,
            strength: 14,
            requiredTech: 'archery_mastery',
            description: 'Elite ranged unit with devastating volleys',
        },
        CAVALRY: {
            id: 'cavalry',
            name: 'Light Cavalry',
            icon: '🐎',
            cost: 250,
            upkeep: 12,
            strength: 22,
            requiredTech: 'cavalry_tactics',
            description: 'Fast mounted units, excellent for flanking and pursuit',
        },
        SIEGE_ENGINE: {
            id: 'siege_engine',
            name: 'Siege Engine',
            icon: '🏰',
            cost: 500,
            upkeep: 25,
            strength: 50,
            requiredTech: 'siege_engineering',
            description: 'Devastating siege weapons for assaulting fortifications',
        },
    },

    // ── New Crafting Recipes Unlocked by Tech ──
    TECH_RECIPES: {
        STEEL_WEAPONS: {
            id: 'steel_weapons',
            name: 'Forge Steel Weapons',
            input: 'iron',
            inputQty: 3,
            output: 'weapons',
            outputQty: 2,
            requiredTech: 'steel_forging',
            description: 'Forge superior steel weapons worth more.',
        },
        STEEL_ARMOR: {
            id: 'steel_armor',
            name: 'Forge Steel Armor',
            input: 'iron',
            inputQty: 4,
            output: 'tools',
            outputQty: 3,
            requiredTech: 'steel_forging',
            description: 'Forge protective steel armor and equipment.',
        },
    },

    // ═══════════════════════════════════════
    //  LAB MANAGEMENT
    // ═══════════════════════════════════════

    /**
     * Get lab config for a property type
     */
    getLabConfig(propertyType) {
        return Technology.LAB_CONFIG[propertyType] || null;
    },

    /**
     * Get which property type is needed for a tech category
     */
    getRequiredPropertyType(category) {
        for (const [propType, config] of Object.entries(Technology.LAB_CONFIG)) {
            if (config.categories.includes(category)) return propType;
        }
        return null;
    },

    /**
     * Check if a lab can be built on a property
     */
    canBuildLab(player, property) {
        const config = Technology.getLabConfig(property.type);
        if (!config) return { can: false, reason: 'This property type cannot have a lab' };
        if (property.hasLab) return { can: false, reason: 'Already has a lab' };
        if (player.gold < config.labCost) return { can: false, reason: `Need ${config.labCost} gold (have ${Math.floor(player.gold)})` };

        // Check materials
        if (!player.inventory) player.inventory = {};
        for (const [mat, qty] of Object.entries(config.labMaterials)) {
            const have = player.inventory[mat] || 0;
            if (have < qty) {
                const goodDef = PlayerEconomy.GOODS[mat.toUpperCase()];
                return { can: false, reason: `Need ${qty} ${goodDef ? goodDef.name : mat} (have ${have})` };
            }
        }

        return { can: true, config };
    },

    /**
     * Build a lab on a property
     */
    buildLab(player, property) {
        const check = Technology.canBuildLab(player, property);
        if (!check.can) return { success: false, reason: check.reason };

        const config = check.config;

        // Deduct gold
        player.gold -= config.labCost;

        // Deduct materials
        for (const [mat, qty] of Object.entries(config.labMaterials)) {
            player.inventory[mat] -= qty;
        }

        // Upgrade property
        property.hasLab = true;
        property.labName = config.labName;
        property.labIcon = config.labIcon;

        return { success: true, labName: config.labName };
    },

    /**
     * Check if player has a lab supporting the given category anywhere
     */
    hasLabForCategory(player, category, world) {
        if (!player.properties) return false;
        for (const propRef of player.properties) {
            const tile = world.getTile(propRef.q, propRef.r);
            if (!tile) continue;
            const properties = tile.playerProperties || (tile.playerProperty ? [tile.playerProperty] : []);
            for (const prop of properties) {
                if (prop.hasLab) {
                    const config = Technology.getLabConfig(prop.type);
                    if (config && config.categories.includes(category)) return true;
                }
            }
        }
        return false;
    },

    /**
     * Find all player labs and their categories
     */
    getPlayerLabs(player, world) {
        const labs = [];
        if (!player.properties) return labs;
        for (const propRef of player.properties) {
            const tile = world.getTile(propRef.q, propRef.r);
            if (!tile) continue;
            const properties = tile.playerProperties || (tile.playerProperty ? [tile.playerProperty] : []);
            for (const prop of properties) {
                if (prop.hasLab) {
                    const config = Technology.getLabConfig(prop.type);
                    if (config) {
                        labs.push({
                            property: prop,
                            tile,
                            q: propRef.q,
                            r: propRef.r,
                            config,
                        });
                    }
                }
            }
        }
        return labs;
    },

    // ═══════════════════════════════════════
    //  PLAYER RESEARCH STATE MANAGEMENT
    // ═══════════════════════════════════════

    /**
     * Initialize technology state on a player
     */
    initPlayer(player) {
        if (!player.technology) {
            player.technology = {
                researched: [],          // Tech IDs where research is complete (blueprint known)
                implemented: [],         // Tech IDs that have been implemented (parts consumed, effects active)
                currentResearch: null,   // { techId, progress, totalDays }
                currentCrafting: null,   // { partsType, progress, totalDays, quantity }
            };
        }
        // Migration: ensure new fields exist on old saves
        if (!player.technology.implemented) player.technology.implemented = [];
        if (player.technology.currentCrafting === undefined) player.technology.currentCrafting = null;
    },

    /**
     * Get actual research cost for a tech (uses RESEARCH_COSTS overrides)
     */
    getResearchInfo(techId) {
        const tech = Technology.getTechByID(techId);
        if (!tech) return null;
        const override = Technology.RESEARCH_COSTS[techId];
        return {
            gold: override ? override.gold : tech.cost * 3,
            materials: override ? override.materials : {},
            days: override ? override.days : tech.days * 2,
            partsToImplement: tech.tier,
        };
    },

    /**
     * Check if a tech can be researched (checks lab, prereqs, gold, materials)
     */
    canResearch(player, techId, world) {
        Technology.initPlayer(player);
        const tech = Technology.TECHS[techId.toUpperCase()] || Object.values(Technology.TECHS).find(t => t.id === techId);
        if (!tech) return { can: false, reason: 'Unknown technology' };

        // Already researched?
        if (player.technology.researched.includes(tech.id)) {
            return { can: false, reason: 'Already researched' };
        }

        // Currently researching something?
        if (player.technology.currentResearch) {
            return { can: false, reason: 'Already researching ' + Technology.getTechByID(player.technology.currentResearch.techId).name };
        }

        // Check prerequisites
        for (const req of tech.requires) {
            if (!player.technology.researched.includes(req)) {
                const reqTech = Technology.getTechByID(req);
                return { can: false, reason: `Requires: ${reqTech ? reqTech.name : req}` };
            }
        }

        // Check for lab of correct category
        if (world && !Technology.hasLabForCategory(player, tech.category, world)) {
            const requiredType = Technology.getRequiredPropertyType(tech.category);
            const config = Technology.LAB_CONFIG[requiredType];
            const labName = config ? config.labName : 'Lab';
            const propName = requiredType ? requiredType.replace(/_/g, ' ') : 'workshop';
            return { can: false, reason: `Need a ${propName} with ${labName}` };
        }

        // Get research costs
        const info = Technology.getResearchInfo(tech.id);

        // Check gold
        if (player.gold < info.gold) {
            return { can: false, reason: `Need ${info.gold} gold (have ${Math.floor(player.gold)})` };
        }

        // Check materials
        if (!player.inventory) player.inventory = {};
        for (const [mat, qty] of Object.entries(info.materials)) {
            const have = player.inventory[mat] || 0;
            if (have < qty) {
                const goodDef = PlayerEconomy.GOODS[mat.toUpperCase()];
                return { can: false, reason: `Need ${qty} ${goodDef ? goodDef.name : mat} (have ${have})` };
            }
        }

        return { can: true };
    },

    /**
     * Start researching a technology
     */
    startResearch(player, techId, world) {
        const tech = Technology.getTechByID(techId);
        if (!tech) return { success: false, reason: 'Unknown technology' };

        const check = Technology.canResearch(player, techId, world);
        if (!check.can) return { success: false, reason: check.reason };

        const info = Technology.getResearchInfo(techId);

        // Deduct gold
        player.gold -= info.gold;

        // Deduct materials
        if (!player.inventory) player.inventory = {};
        for (const [mat, qty] of Object.entries(info.materials)) {
            player.inventory[mat] = (player.inventory[mat] || 0) - qty;
        }

        // Calculate research days (intelligence bonus)
        let totalDays = info.days;
        const intBonus = (player.intelligence || 0) * 0.03; // 3% per INT point
        totalDays = Math.max(3, Math.ceil(totalDays * (1 - intBonus)));

        // Set current research
        player.technology.currentResearch = {
            techId: tech.id,
            progress: 0,
            totalDays: totalDays,
            startDay: world ? world.day : 0,
        };

        return { success: true, tech, estimatedDays: totalDays };
    },

    /**
     * Process daily research progress (called in endDay)
     */
    processResearch(player) {
        Technology.initPlayer(player);
        if (!player.technology.currentResearch) return null;

        const research = player.technology.currentResearch;
        research.progress += 1;

        // Check if complete
        if (research.progress >= research.totalDays) {
            const techId = research.techId;
            player.technology.researched.push(techId);
            player.technology.currentResearch = null;

            // Intelligence skill gain
            player.intelligence = Math.min(20, (player.intelligence || 5) + 0.2);

            const tech = Technology.getTechByID(techId);
            return {
                completed: true,
                tech,
                message: `Research complete: ${tech.name}! Craft parts to implement it.`,
            };
        }

        return {
            completed: false,
            progress: research.progress,
            total: research.totalDays,
            remaining: research.totalDays - research.progress,
        };
    },

    /**
     * Cancel current research (refund 50% gold only, materials are lost)
     */
    cancelResearch(player) {
        Technology.initPlayer(player);
        if (!player.technology.currentResearch) return { success: false, reason: 'Not researching anything' };

        const tech = Technology.getTechByID(player.technology.currentResearch.techId);
        const info = Technology.getResearchInfo(tech.id);
        const refund = Math.floor(info.gold * 0.5);
        player.gold += refund;
        player.technology.currentResearch = null;

        return { success: true, refund, tech };
    },

    // ═══════════════════════════════════════
    //  PARTS CRAFTING
    // ═══════════════════════════════════════

    /**
     * Check if player can craft parts at a lab on the current tile
     */
    canCraftParts(player, property) {
        if (!property || !property.hasLab) return { can: false, reason: 'No lab on this property' };

        // Currently crafting?
        if (player.technology.currentCrafting) return { can: false, reason: 'Already crafting parts' };

        const config = Technology.getLabConfig(property.type);
        if (!config) return { can: false, reason: 'Invalid property type' };

        // Determine parts type for this lab
        const partsType = Technology.CATEGORY_PARTS[config.categories[0]];
        const recipe = Technology.PARTS_CRAFTING[partsType];
        if (!recipe) return { can: false, reason: 'No parts recipe for this lab' };

        // Check gold
        if (player.gold < recipe.gold) {
            return { can: false, reason: `Need ${recipe.gold} gold (have ${Math.floor(player.gold)})` };
        }

        // Check materials
        if (!player.inventory) player.inventory = {};
        for (const [mat, qty] of Object.entries(recipe.materials)) {
            const have = player.inventory[mat] || 0;
            if (have < qty) {
                const goodDef = PlayerEconomy.GOODS[mat.toUpperCase()];
                return { can: false, reason: `Need ${qty} ${goodDef ? goodDef.name : mat} (have ${have})` };
            }
        }

        return { can: true, partsType, recipe, config };
    },

    /**
     * Start crafting parts at a lab
     */
    startCrafting(player, property) {
        const check = Technology.canCraftParts(player, property);
        if (!check.can) return { success: false, reason: check.reason };

        const { partsType, recipe } = check;

        // Deduct gold
        player.gold -= recipe.gold;

        // Deduct materials
        for (const [mat, qty] of Object.entries(recipe.materials)) {
            player.inventory[mat] = (player.inventory[mat] || 0) - qty;
        }

        // Set current crafting
        player.technology.currentCrafting = {
            partsType: partsType,
            progress: 0,
            totalDays: recipe.days,
            quantity: recipe.quantity,
        };

        return { success: true, partsType, recipe, estimatedDays: recipe.days };
    },

    /**
     * Process daily crafting progress (called in endDay)
     */
    processCrafting(player) {
        Technology.initPlayer(player);
        if (!player.technology.currentCrafting) return null;

        const crafting = player.technology.currentCrafting;
        crafting.progress += 1;

        if (crafting.progress >= crafting.totalDays) {
            const partsType = crafting.partsType;
            const quantity = crafting.quantity;

            // Add parts to inventory
            if (!player.inventory) player.inventory = {};
            player.inventory[partsType] = (player.inventory[partsType] || 0) + quantity;

            player.technology.currentCrafting = null;

            const recipe = Technology.PARTS_CRAFTING[partsType];
            return {
                completed: true,
                partsType,
                quantity,
                message: `Crafting complete: ${quantity}x ${recipe ? recipe.name : partsType}!`,
            };
        }

        return {
            completed: false,
            progress: crafting.progress,
            total: crafting.totalDays,
            remaining: crafting.totalDays - crafting.progress,
        };
    },

    /**
     * Cancel current crafting (refund 50% gold, materials lost)
     */
    cancelCrafting(player) {
        Technology.initPlayer(player);
        if (!player.technology.currentCrafting) return { success: false, reason: 'Not crafting anything' };

        const crafting = player.technology.currentCrafting;
        const recipe = Technology.PARTS_CRAFTING[crafting.partsType];
        const refund = Math.floor((recipe ? recipe.gold : 0) * 0.5);
        player.gold += refund;
        player.technology.currentCrafting = null;

        return { success: true, refund };
    },

    // ═══════════════════════════════════════
    //  TECH IMPLEMENTATION (Applying Parts)
    // ═══════════════════════════════════════

    /**
     * Check if a tech can be implemented (parts available)
     */
    canImplement(player, techId) {
        Technology.initPlayer(player);
        const tech = Technology.getTechByID(techId);
        if (!tech) return { can: false, reason: 'Unknown technology' };

        if (!player.technology.researched.includes(tech.id)) {
            return { can: false, reason: 'Must research this technology first' };
        }

        if (player.technology.implemented.includes(tech.id)) {
            return { can: false, reason: 'Already implemented' };
        }

        const partsType = Technology.CATEGORY_PARTS[tech.category];
        const partsNeeded = tech.tier; // Tier 1 = 1 part, Tier 4 = 4 parts
        const partsHave = (player.inventory && player.inventory[partsType]) || 0;
        const recipe = Technology.PARTS_CRAFTING[partsType];
        const partsName = recipe ? recipe.name : partsType;

        if (partsHave < partsNeeded) {
            return { can: false, reason: `Need ${partsNeeded} ${partsName} (have ${partsHave})` };
        }

        return { can: true, partsType, partsNeeded, partsName };
    },

    /**
     * Implement a researched tech by consuming parts
     */
    implementTech(player, techId) {
        const check = Technology.canImplement(player, techId);
        if (!check.can) return { success: false, reason: check.reason };

        const tech = Technology.getTechByID(techId);

        // Consume parts
        player.inventory[check.partsType] -= check.partsNeeded;

        // Add to implemented list
        player.technology.implemented.push(tech.id);

        return { success: true, tech };
    },

    /**
     * Check if a tech is fully implemented (effects active)
     */
    isImplemented(player, techId) {
        Technology.initPlayer(player);
        return player.technology.implemented.includes(techId);
    },

    // ═══════════════════════════════════════
    //  UTILITY HELPERS
    // ═══════════════════════════════════════

    /**
     * Get tech definition by its id string
     */
    getTechByID(techId) {
        return Object.values(Technology.TECHS).find(t => t.id === techId) || null;
    },

    /**
     * Check if player has researched a specific tech (blueprint known)
     */
    hasResearched(player, techId) {
        Technology.initPlayer(player);
        return player.technology.researched.includes(techId);
    },

    /**
     * Get all available (researchable) techs for a player
     */
    getAvailableTechs(player) {
        Technology.initPlayer(player);
        const available = [];
        for (const tech of Object.values(Technology.TECHS)) {
            if (player.technology.researched.includes(tech.id)) continue;
            const prereqsMet = tech.requires.every(req => player.technology.researched.includes(req));
            if (prereqsMet) available.push(tech);
        }
        return available;
    },

    /**
     * Get all techs organized by category
     */
    getTechsByCategory() {
        const result = {};
        for (const cat of Object.values(Technology.CATEGORIES)) {
            result[cat.id] = [];
        }
        for (const tech of Object.values(Technology.TECHS)) {
            if (result[tech.category]) {
                result[tech.category].push(tech);
            }
        }
        for (const cat in result) {
            result[cat].sort((a, b) => a.tier - b.tier);
        }
        return result;
    },

    // ═══════════════════════════════════════
    //  EFFECT APPLICATION HELPERS
    //  Effects only apply for IMPLEMENTED techs
    // ═══════════════════════════════════════

    /**
     * Calculate production bonus from implemented techs
     */
    getProductionBonus(player, propertyType) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            const e = tech.effects;
            switch (propertyType) {
                case 'farm':
                case 'irrigated_farm':
                    if (e.farmProductionBonus) bonus += e.farmProductionBonus;
                    break;
                case 'pasture':
                    if (e.pastureProductionBonus) bonus += e.pastureProductionBonus;
                    break;
                case 'mine':
                    if (e.mineProductionBonus) bonus += e.mineProductionBonus;
                    break;
                case 'logging_camp':
                    if (e.loggingProductionBonus) bonus += e.loggingProductionBonus;
                    break;
                case 'workshop':
                case 'foundry':
                case 'water_mill_building':
                    if (e.workshopProductionBonus) bonus += e.workshopProductionBonus;
                    break;
            }
        }
        return bonus;
    },

    /**
     * Get unit strength bonus from implemented military techs
     */
    getUnitStrengthBonus(player, unitType) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            const e = tech.effects;
            if (e.unitStrengthBonus) bonus += e.unitStrengthBonus;
            if (unitType === 'archer' || unitType === 'longbowman') {
                if (e.archerStrengthBonus) bonus += e.archerStrengthBonus;
            }
            if (unitType === 'knight' || unitType === 'cavalry') {
                if (e.knightStrengthBonus) bonus += e.knightStrengthBonus;
            }
        }
        return bonus;
    },

    /**
     * Get building cost reduction from implemented techs
     */
    getBuildingCostReduction(player) {
        Technology.initPlayer(player);
        let reduction = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.buildingCostReduction) reduction += tech.effects.buildingCostReduction;
        }
        return Math.min(reduction, 0.50);
    },

    /**
     * Get trade profit bonus from implemented commerce techs
     */
    getTradeProfitBonus(player) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.tradeProfitBonus) bonus += tech.effects.tradeProfitBonus;
            if (tech.effects.caravanProfitBonus) bonus += tech.effects.caravanProfitBonus;
        }
        return bonus;
    },

    /**
     * Get movement speed bonus from implemented infrastructure techs
     */
    getMovementBonus(player) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.movementBonus) bonus += tech.effects.movementBonus;
        }
        return bonus;
    },

    /**
     * Get vision radius bonus from implemented techs
     */
    getVisionBonus(player) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.visionRadiusBonus) bonus += tech.effects.visionRadiusBonus;
        }
        return bonus;
    },

    /**
     * Get defense bonus from implemented techs
     */
    getDefenseBonus(player) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.defenseBonus) bonus += tech.effects.defenseBonus;
        }
        return bonus;
    },

    /**
     * Get storage bonus from implemented techs
     */
    getStorageBonus(player) {
        Technology.initPlayer(player);
        let bonus = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (!tech) continue;
            if (tech.effects.storageBonus) bonus += tech.effects.storageBonus;
        }
        return bonus;
    },

    /**
     * Get all unlocked building types (base + implemented tech buildings)
     */
    getUnlockedBuildings(player) {
        Technology.initPlayer(player);
        const buildings = { ...PlayerEconomy.PROPERTY_TYPES };

        for (const [key, building] of Object.entries(Technology.TECH_BUILDINGS)) {
            if (building.requiredTech && player.technology.implemented.includes(building.requiredTech)) {
                buildings[key] = building;
            }
        }

        return buildings;
    },

    /**
     * Get all unlocked unit types (base + implemented tech units)
     */
    getUnlockedUnits(player) {
        Technology.initPlayer(player);
        const units = { ...PlayerMilitary.UNIT_TYPES };

        for (const [key, unit] of Object.entries(Technology.TECH_UNITS)) {
            if (unit.requiredTech && player.technology.implemented.includes(unit.requiredTech)) {
                units[key] = unit;
            }
        }

        return units;
    },

    /**
     * Get all unlocked recipes (base + implemented tech recipes)
     */
    getUnlockedRecipes(player) {
        Technology.initPlayer(player);
        const recipes = { ...PlayerEconomy.RECIPES };

        for (const [key, recipe] of Object.entries(Technology.TECH_RECIPES)) {
            if (recipe.requiredTech && player.technology.implemented.includes(recipe.requiredTech)) {
                recipes[key] = recipe;
            }
        }

        return recipes;
    },

    /**
     * Get formatted materials list as HTML string
     */
    formatMaterials(materials) {
        if (!materials || Object.keys(materials).length === 0) return '';
        return Object.entries(materials).map(([mat, qty]) => {
            const goodDef = PlayerEconomy.GOODS[mat.toUpperCase()];
            return `${qty} ${goodDef ? goodDef.name : mat}`;
        }).join(', ');
    },

    /**
     * Get the tech status label for UI display
     */
    getTechStatus(player, techId) {
        Technology.initPlayer(player);
        if (player.technology.implemented.includes(techId)) return 'implemented';
        if (player.technology.researched.includes(techId)) return 'researched';
        if (player.technology.currentResearch && player.technology.currentResearch.techId === techId) return 'in_progress';
        return 'locked';
    },
};
