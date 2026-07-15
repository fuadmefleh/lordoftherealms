/**
 * Structural guards for the object-literal monolith splits: PlayerMilitary,
 * Technology, Tavern. Each was split into ./<name>/*.js group modules
 * Object.assign'd onto a shared object; these assert no member was dropped.
 * (Data props are further checked by the existing player/systems suites.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Technology } from '../systems/technology.js';
import { Tavern } from '../player/tavern.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const PM = ['UNIT_TYPES', 'FORMATION_ROLES', '_normalizeComposition', '_roleForUnitType', 'getArmyComposition', 'inferEnemyComposition', '_counterScore', '_counterMultiplier', '_terrainIsHills', '_terrainIsPlains', '_terrainMultiplier', '_moraleValue', '_checkMoraleBreak', '_getSettlementComposition', '_getWorldUnitComposition', 'SETTLEMENT_TIER', 'getRecruitmentCapacity', 'isUnitAvailable', 'isTechUnitAvailable', 'recruitUnit', 'getArmyStrength', 'getUpkeepCost', 'payUpkeep', 'CONTRACT_TYPES', 'MERCENARY_COMPANIES', '_ensureMercenaryState', '_getMercenaryMarketKey', '_cloneRoster', '_getMercenaryUnitDefinition', '_removeMercenaryCompanyUnits', '_estimateCompanyStrength', 'getMercenaryOffers', 'hireMercenaryCompany', 'payMercenaryBonus', 'dismissMercenaryCompany', '_processMercenaryCompanies', 'acceptContract', 'updateContract', 'combat', 'processServitude', 'attemptEscape', 'buyFreedom', 'raidSettlement', 'attackSettlement', 'getSettlementDefense', 'attackUnit'];
const TECH = ['CATEGORIES', 'LAB_CONFIG', 'CATEGORY_PARTS', 'PARTS_CRAFTING', 'RESEARCH_COSTS', 'TECHS', 'TECH_BUILDINGS', 'TECH_UNITS', 'TECH_RECIPES', 'getLabConfig', 'getRequiredPropertyType', 'canBuildLab', 'buildLab', 'hasLabForCategory', 'getPlayerLabs', 'initPlayer', 'getResearchInfo', 'canResearch', 'startResearch', 'processResearch', 'cancelResearch', 'canCraftParts', 'startCrafting', 'processCrafting', 'cancelCrafting', 'canImplement', 'implementTech', 'isImplemented', 'getTechByID', 'hasResearched', 'getAvailableTechs', 'getTechsByCategory', 'getProductionBonus', 'getUnitStrengthBonus', 'getBuildingCostReduction', 'getTradeProfitBonus', 'getMovementBonus', 'getVisionBonus', 'getDefenseBonus', 'getStorageBonus', 'getUnlockedBuildings', 'getUnlockedUnits', 'getUnlockedRecipes', 'formatMaterials', 'getTechStatus'];
const TAV = ['DRINK_COST', 'BRIBE_COST', 'HIRE_INFORMANT_COST', 'INTEL_DECAY_DAYS', 'MAX_RUMORS', 'RELIABILITY', 'CATEGORIES', 'getTavernOptions', 'handleAction', '_buyMeal', '_takeBath', '_restAtInn', '_playDice', '_buyDrinks', '_askMerchants', '_askCharacters', '_askMilitary', '_hireInformant', '_checkRumorBoard', '_askReligiousLore', '_listenForGossip', '_sellSoul', '_generateRumor', '_generatePriceIntel', '_generateRandomPriceHint', '_generateTradeOpportunity', '_generateCharacterIntel', '_generateAdvisorIntel', 'processInformants', '_storeRumors', 'expireOldIntel', 'getIntelByCategory', 'getFreshness', '_buyTavernMap'];

describe('object-literal splits — structural equivalence', () => {
    it.each([
        ['PlayerMilitary', () => PlayerMilitary, PM, 46],
        ['Technology', () => Technology, TECH, 45],
        ['Tavern', () => Tavern, TAV, 34],
    ])('%s exposes every original member', (_name, get, members, count) => {
        const keys = new Set(Object.keys(get()));
        expect(members.filter((m) => !keys.has(m))).toEqual([]);
        expect(members).toHaveLength(count);
    });
});
