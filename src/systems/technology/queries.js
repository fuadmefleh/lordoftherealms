// Technology — queries members (split from the original monolith).
import { Technology } from './_ref.js';
import { PlayerEconomy, PlayerMilitary } from './_imports.js';

Object.assign(Technology, {
    // ═══════════════════════════════════════
    //  UTILITY HELPERS
    // ═══════════════════════════════════════
    /**
     * Get tech definition by its id string
     */
    getTechByID(techId) {
        if (!Technology.TECHS) return null;
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
        if (!Technology.TECHS) return available;
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
        if (!Technology.TECHS) return result;
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
});
