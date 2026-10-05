/**
 * Structural guards for the domain object-literal splits: Relationships,
 * Characters, Espionage, Peoples, Cartography. Each was split into ./<name>/*.js
 * group modules Object.assign'd onto a shared object; these assert no member was
 * dropped by the split.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Relationships } from '../systems/relationships.js';
import { Characters } from '../world/characters.js';
import { Espionage } from '../systems/espionage.js';
import { Peoples } from '../systems/peoples.js';
import { Cartography } from '../systems/cartography.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const REL = ['_npcs', '_nextId', 'initialize', '_getData', '_getRelationshipTypes', '_getHeirSettings', '_getPersonalities', '_getCourtActions', '_getSocialActions', '_getRelationshipLevels', '_getCourtingStages', '_getChildTraits', 'generateNPC', 'getNPCsAtSettlement', 'getNPC', 'getKnownNPCs', 'ensureTravelParty', 'isInTravelParty', 'getTravelPartyMembers', 'requestJoinTravelParty', 'removeFromTravelParty', 'cleanupTravelParty', '_rollNPCTraits', '_rollAppearance', '_rollOccupation', 'getRelationship', 'getRelationLabel', 'getCourtingStage', 'getRelationshipLevel', '_getLevelIndex', 'getSocialActionAvailability', 'getCourtActionAvailability', 'performSocialAction', 'performCourtAction', '_getCourtFailText', 'marry', 'divorce', 'checkChildbirth', 'generateChild', 'ageChildren', 'processAging', 'getEligibleHeirs', 'designateHeir', 'succeedAsHeir', 'processDailyEvents', 'getState', 'loadState', 'prepareForSave'];
const CHAR = ['FIRST_NAMES', 'DYNASTY_NAMES', 'RULER_TRAITS', 'ADVISOR_ROLES', 'CHARACTER_EVENTS', 'generateCharacter', 'getFullName', 'getDisplayName', 'createDynasty', 'generateRoyalFamily', 'generateAdvisors', 'getKingdomBonuses', 'handleSuccession', '_triggerSuccessionCrisis', 'arrangeMarriage', '_getEligibleForMarriage', 'processTurn', 'processKingdomCharacters', '_ageCharacters', '_birthChild', '_triggerCharacterEvent', '_applyEventEffects', '_considerDiplomaticMarriages', 'initialize', '_generateId', '_rollSkill', '_rollTraits', '_findCharacter', '_getAllKingdomCharacters', 'serialize', 'deserialize'];
const ESP = ['CONFIG', 'SPY_NAMES', 'SPY_SKILLS', 'SPY_TRAITS', 'MISSIONS', 'MISSION_OUTCOMES', 'LEVEL_TITLES', 'REBELLION_EFFECTS', '_nextSpyId', '_getData', '_getConfig', '_getMissions', '_getMissionOutcomes', '_getSpyTraits', '_getSpyNames', '_getLevelTitles', '_getRebellionEffects', 'initPlayer', 'hasEspionageTech', 'generateSpy', 'getRecruitCandidates', 'recruitSpy', 'dismissSpy', 'getAvailableMissions', 'getTargetKingdoms', 'assignMission', 'recallSpy', 'processDaily', 'applySpyVision', '_resolveMission', '_applyMissionOutcome', '_resolveGatherIntel', '_resolveStealTechnology', '_resolveInciteRebellion', '_resolveInfiltrateTerritory', '_resolveSabotage', '_resolveCounterEspionage', '_resolveAssassination', '_getSpyBetrayalRisk', '_applyDiplomaticConsequences', '_applyRebellionDailyEffect', 'getSpyLevelTitle', 'getTotalUpkeep', 'getSpyById', 'getMissionSummary', 'prepareForSave', 'loadState'];
const PEO = ['TRIBAL_ROOTS', 'EVOLUTION_STAGES', 'INTERACTION_TYPES', 'HYBRID_PREFIXES', 'HYBRID_SUFFIXES', 'initialize', 'generateTribalGenesis', 'populateSettlements', 'calculateHarmony', 'generateSettlementIdentity', 'getDominantValues', 'generateQuarters', 'generateCulturalEvolution', 'generateDiasporaHistory', 'processTurn', 'processPopulationDrift', 'generateCulturalInteraction', 'generateHybridTradition', 'getDemographicsSummary', 'getHarmonyDisplay', 'getTribesForCulture', 'getMergedHistory', 'discoverLore', 'buildDemographicsHTML', 'buildTribalHistoryHTML'];
const CARTO = ['MAP_CREATION_COST', 'SURVEY_COST', 'BASE_MAP_VALUE', 'BUY_MAP_PRICE', 'SKILL_GAIN_CREATE', 'SKILL_GAIN_CHART', 'MAX_DELIBERATE_ERRORS', 'PROPAGANDA_CHANCE', 'QUALITY', 'MAP_TYPES', 'initialize', 'getQualityForSkill', 'createRegionalMap', 'createSurveyMap', 'createKingdomMap', 'generatePropagandaMap', 'generateAncientMap', 'generateTreasureMap', 'addDeliberateErrors', '_generateBorderLies', 'applyMap', 'digTreasure', 'attemptStealMap', '_generateStolenMap', 'getAvailableMapsForSale', 'sellMap', 'buyMap', 'processTurn', '_chartTiles', '_chartKingdomTiles', '_chartPropagandaTiles', '_getRegionName', 'getPlayerMaps', 'countExploredTiles', 'getSkillDescription', 'canDetectErrors'];

describe('domain object splits — structural equivalence', () => {
    it.each([
        ['Relationships', () => Relationships, REL, 48],
        ['Characters', () => Characters, CHAR, 31],
        ['Espionage', () => Espionage, ESP, 47],
        ['Peoples', () => Peoples, PEO, 25],
        ['Cartography', () => Cartography, CARTO, 36],
    ])('%s exposes every original member', (_n, get, members, count) => {
        const keys = new Set(Object.keys(get()));
        expect(members.filter((m) => !keys.has(m))).toEqual([]);
        expect(members).toHaveLength(count);
    });
});
