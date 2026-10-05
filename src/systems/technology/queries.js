// Technology — queries members (split from the original monolith).
import { Technology } from './_ref.js';
import { PlayerEconomy, PlayerMilitary } from './_imports.js';
import { Hex } from '../../core/hex.js';
import { Utils } from '../../core/utils.js';
import { WorldEvents } from '../../world/worldEvents.js';
import { Religion } from '../religion.js';

Object.assign(Technology, {
    /** Sum of one effect key across the player's implemented techs. */
    getEffectTotal(player, key) {
        Technology.initPlayer(player);
        let total = 0;
        for (const techId of player.technology.implemented) {
            const tech = Technology.getTechByID(techId);
            if (tech && tech.effects && typeof tech.effects[key] === 'number') total += tech.effects[key];
        }
        return total;
    },

    /** How many finished properties of a type the player owns. */
    countOwnedBuildings(player, type, world = null) {
        return (player.properties || []).filter(p => {
            if (p.type !== type) return false;
            if (!world) return true;
            const t = world.getTile(p.q, p.r);
            const prop = t && (t.playerProperties || [t.playerProperty]).find(x => x && x.type === type);
            return !!prop && !prop.underConstruction;
        }).length;
    },

    /** Is a finished property of this type owned within `range` hexes of (q, r)? */
    hasBuildingNear(player, world, type, q, r, range) {
        return (player.properties || []).some(p => {
            if (p.type !== type || Hex.distance(p.q, p.r, q, r) > range) return false;
            const t = world.getTile(p.q, p.r);
            const prop = t && (t.playerProperties || [t.playerProperty]).find(x => x && x.type === type);
            return !!prop && !prop.underConstruction;
        });
    },

    /** Cap on the research speed-up from cultural buildings. */
    CULTURAL_RESEARCH_CAP: 0.5,

    /**
     * Research speed-up from the player's finished cultural buildings
     * (tile.culturalBuilding.researchBonus: Library 0.15, University 0.30,
     * Scriptorium 0.10), +50% per level above 1 (Culture.LEVELS), capped at
     * CULTURAL_RESEARCH_CAP. Reads tiles directly so technology/ need not
     * import culture.js (which imports Technology).
     */
    getCulturalResearchBonus(player, world = null) {
        if (!world || !player || !Array.isArray(player.culturalBuildings)) return 0;
        let bonus = 0;
        for (const ref of player.culturalBuildings) {
            const t = world.getTile(ref.q, ref.r);
            const b = t && t.culturalBuilding;
            if (!b || b.owner !== 'player' || b.underConstruction) continue;
            const level = Math.max(1, b.level || 1);
            bonus += (b.researchBonus || 0) * (1 + 0.5 * (level - 1));
        }
        return Math.min(Technology.CULTURAL_RESEARCH_CAP, bonus);
    },

    /**
     * Research speed-up as a fraction: writing/printing press techs,
     * +25% per finished University property (max 2 count), and the
     * player's cultural buildings (libraries, universities, scriptoria).
     */
    getResearchBonus(player, world = null) {
        const universities = Math.min(2, Technology.countOwnedBuildings(player, 'university_building', world));
        return Technology.getEffectTotal(player, 'researchBonus') + 0.25 * universities
            + Technology.getCulturalResearchBonus(player, world)
            + Religion.tenetBonus(player.religion, 'research') // the Wisdom tenet
            + Technology.patronageFx(player, 'research'); // the Great Library (systems/patronage.js)
    },

    /** A standing Great Work effect cached on player.patronage.fx (0 when none). */
    patronageFx(player, key) {
        const fx = player && player.patronage && player.patronage.fx;
        const v = fx && fx[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    },

    /**
     * Daily effects that aren't tied to a single action: bank interest on
     * gold (banking systems) and healing near a Hospital you own.
     * Returns { interest, healed }.
     */
    applyDailyEffects(player, world) {
        const out = { interest: 0, healed: 0 };
        const rate = Technology.getEffectTotal(player, 'dailyInterestIncome');
        if (rate > 0 && player.gold > 0) {
            out.interest = Math.min(250, Math.floor(player.gold * rate));
            player.gold += out.interest;
        }
        if (Technology.hasBuildingNear(player, world, 'hospital_building', player.q, player.r, 2)) {
            const before = player.health;
            player.health = Math.min(player.maxHealth || 100, player.health + 15);
            out.healed = player.health - before;
        }
        const plague = Technology.applyPlagueExposure(player, world);
        if (plague) out.plague = plague;
        const colonyPlague = Technology.applyColonyPlague(player, world);
        if (colonyPlague.length) out.colonyPlague = colonyPlague;
        return out;
    },

    // ═══════════════════════════════════════
    //  NAVAL / MEDICINE / DIPLOMACY EFFECT READERS
    // ═══════════════════════════════════════

    /** Ships a player may own without any naval tech. */
    BASE_FLEET_CAPACITY: 3,

    /** Ships the player may own: base + Shipbuilding's navalCapacity. */
    getFleetCapacity(player) {
        return Technology.BASE_FLEET_CAPACITY + Technology.getEffectTotal(player, 'navalCapacity');
    },

    /** Sailing speed multiplier: +10% per point of navalRange (Navigation: +30%). */
    getSailingSpeedMultiplier(player) {
        return 1 + 0.1 * Technology.getEffectTotal(player, 'navalRange');
    },

    /** Fraction of plague harm avoided (Herbalism + Plague Prevention), capped at 90%. */
    getPlagueResistance(player) {
        return Math.min(0.9, Math.max(0, Technology.getEffectTotal(player, 'plagueResistance')));
    },

    /** Multiplier on gold paid for tribute and peace treaties (Diplomacy Mastery: ×0.8). */
    getAllianceCostMultiplier(player) {
        return Math.min(1.5, Math.max(0.5, 1 + Technology.getEffectTotal(player, 'allianceCost')));
    },

    /** Daily harm while standing where a plague is raging, before resistance. */
    PLAGUE_EXPOSURE: { healthLoss: 6, unitDeathChance: 0.04 },

    /**
     * A plague event raging over the player's tile sickens the player and
     * their soldiers each day; plague resistance techs cut both. Returns
     * { healthLost, unitsLost, resistance } or null when no plague reaches.
     */
    applyPlagueExposure(player, world) {
        if (!world || !world.activeEvents || !world.activeEvents.length || !world.getTile) return null;
        const tile = world.getTile(player.q, player.r);
        const plague = WorldEvents.getEventsAt(world, tile).find(ev => ev.id === 'plague');
        if (!plague) return null;
        const resistance = Technology.getPlagueResistance(player);
        const exposure = 1 - resistance;
        const healthLost = Math.round(Technology.PLAGUE_EXPOSURE.healthLoss * exposure);
        player.health = Math.max(1, (player.health || 0) - healthLost);
        let unitsLost = 0;
        const deathChance = Technology.PLAGUE_EXPOSURE.unitDeathChance * exposure;
        if (deathChance > 0 && Array.isArray(player.army)) {
            const survivors = [];
            for (const unit of player.army) {
                if (Utils.random() < deathChance) unitsLost++;
                else survivors.push(unit);
            }
            player.army = survivors;
        }
        if (unitsLost > 0 && world.events) {
            world.events.push({ text: `☠️ The plague in ${plague.regionName || 'the region'} claims ${unitsLost} of your soldiers.`, type: 'disaster' });
        }
        return { healthLost, unitsLost, resistance };
    },

    /** Daily toll on a colony a plague reaches, before resistance. */
    COLONY_PLAGUE: { populationLoss: 0.02, loyaltyLoss: 2 },

    /**
     * Plague reaching the player's colonies thins their settlers and shakes
     * their loyalty each day; the player's plague resistance techs (medicine
     * they bring to their people) cut both. Returns [{ name, lost, loyaltyLost }].
     */
    applyColonyPlague(player, world) {
        const hits = [];
        if (!Array.isArray(player.colonies) || !player.colonies.length) return hits;
        if (!world || !world.activeEvents || !world.activeEvents.length || !world.getTile) return hits;
        const exposure = 1 - Technology.getPlagueResistance(player);
        for (const c of player.colonies) {
            const tile = world.getTile(c.q, c.r);
            const settlement = tile && tile.settlement;
            if (!settlement) continue;
            if (!WorldEvents.getEventsAt(world, tile).some(ev => ev.id === 'plague')) continue;
            const lost = Math.floor((settlement.population || 0) * Technology.COLONY_PLAGUE.populationLoss * exposure);
            settlement.population = Math.max(10, (settlement.population || 0) - lost);
            let loyaltyLost = 0;
            if (settlement.colony) {
                loyaltyLost = Math.round(Technology.COLONY_PLAGUE.loyaltyLoss * exposure);
                settlement.colony.loyalty = Math.max(0, (settlement.colony.loyalty || 0) - loyaltyLost);
            }
            hits.push({ name: settlement.name, lost, loyaltyLost });
        }
        return hits;
    },

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
                case 'fishing_wharf':
                case 'fishing_fleet':
                    if (e.fishProductionBonus) bonus += e.fishProductionBonus;
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
            // Heavy Cavalry: armoured horse for every mounted unit
            if (unitType === 'knight' || unitType === 'cavalry' || unitType === 'heavy_cavalry') {
                if (e.cavalryStrengthBonus) bonus += e.cavalryStrengthBonus;
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
        // Each Merchant Guild hall you own adds +10% (up to 3)
        bonus += 0.1 * Math.min(3, Technology.countOwnedBuildings(player, 'merchant_guild_building'));
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
