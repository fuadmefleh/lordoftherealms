// Technology — research members (split from the original monolith).
import { Technology } from './_ref.js';
import { PlayerEconomy, PlayerMilitary } from './_imports.js';
import { PlayerInventory } from '../../core/inventory.js';
import { Traits } from '../traits.js';

Object.assign(Technology, {
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
        if (!Technology.TECHS) return { can: false, reason: 'Technology system not initialized' };
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
        Traits.recordDeed(player, 'learning', 2);

        // Deduct materials
        if (!player.inventory) player.inventory = {};
        for (const [mat, qty] of Object.entries(info.materials)) {
            player.inventory[mat] = (player.inventory[mat] || 0) - qty;
        }

        // Calculate research days (intelligence bonus)
        let totalDays = info.days;
        const intBonus = (player.intelligence || 0) * 0.03; // 3% per INT point
        // Writing / printing press techs and Universities speed research up
        const researchBonus = Technology.getResearchBonus(player, world);
        totalDays = Math.max(3, Math.ceil(totalDays * Math.max(0.3, 1 - intBonus - researchBonus)));

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

            // Finished parts wait at the workshop until the packs have room
            crafting.progress = crafting.totalDays;
            if (!PlayerInventory.addItem(player, partsType, quantity).success) {
                return { completed: false, waitingForRoom: true, partsType, quantity, message: PlayerInventory.fullMessage(player) };
            }

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
});
