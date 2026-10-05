/**
 * Structural regression guard for the ActionMenu monolith split.
 *
 * actionMenu.js was split from one 17k-line object literal into
 * src/ui/actionMenu/*.js group modules reassembled via Object.assign onto a
 * shared object. This test locks the invariant that matters: the assembled
 * ActionMenu exposes exactly the same set of members as before the split (and
 * the window global is still wired for the remaining inline handlers).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

// The original 196 single-file ActionMenu members, plus showHousePanel
// (added by the House dynasty-spine feature) = 197, plus the four
// row-ashore members (showRowAshoreMenu, rowToShip, _landingCargoText,
// _centerCameraOnPlayer) = 201, plus showShipHoldMenu = 202, plus
// showPropertyPicker = 203, plus doSeaActivity and showPortMarketMenu = 205, plus the five
// delegated-click helpers (closePanel*, openTileMenu, postSignboardAndManageColony) = 210, plus
// the build-menu helpers (BUILD_CATEGORIES, _buildOutputText, _canBuildTechBuilding) = 213, plus performRaid = 214, plus the building-service panels
// (_serviceResult, showBlacksmithMenu, showBlessingMenu, showStableMenu, showGuardMenu,
// showTributeMenu, showAudienceMenu) = 221, plus the outlaw gate (OUTLAW_REFUSED_ACTIONS,
// refuseIfOutlawed) = 223, plus the realm-politics panels (REALM_POLITICS_AP,
// showRealmWarsMenu, showRestorationMenu, _realmResult) = 227, plus showUpgradeCulturalMenu = 228,
// plus sellMapToArchive (royal archives buy your maps) = 229, plus the data-driven gambling
// config (DEFAULT_GAMBLING, _getGamblingSettings, _getGamblingGame) = 232, plus denounceHeresy = 233,
// plus the resource-bonus build hints (_resourceSourceNames, _constructionHint) and
// meetingPresentTreasure = 236, plus showCourtPanel (petitions & court) = 237, plus the
// seasonal work handlers (doTrapFurs, doIceFish, doPlantingContract) = 240, plus
// showDelvePanel (delves into ruins and caves) = 241, plus showUnderworldPanel (heat,
// thieves' guild, fence, black market) = 242, plus showClaimsPanel (Claims & Crowns) = 243,
// plus showHoldingPanel (holdings development) = 244, plus showRivalsPanel and
// showHallOfHeroes (rival adventurers) = 246, plus showPhysicianMenu (wounds, sickness
// and medicine) = 247, plus the heirs panels (showChildPanel, showHouseChronicle,
// showEpitaph, _heirProfileHtml, _reignsHtml) = 252, plus showSagasJournal (world storylines) = 253, plus showDiscoveries (uncharted lands) = 254, plus showTradingCompany (merchant houses) = 255, plus showHoldingSiegesPanel and holdingSiegeAct (holdings under siege) = 259, plus showDeeds (Deeds & Records) = 260, plus showRoyalCourt (kingship) = 261, plus showCounsel and counselGo (the Steward's Counsel) = 263, plus showPatronage and patronageAct (patronage & great works) = 265, plus showOutlawLairs (outlaw lairs) = 266.
const EXPECTED_KEYS = [
    'showCourtPanel', 'showDelvePanel', 'showClaimsPanel', 'showHoldingPanel',
    'showRivalsPanel', 'showHallOfHeroes', 'showPhysicianMenu',
    'showChildPanel', 'showHouseChronicle', 'showEpitaph', '_heirProfileHtml', '_reignsHtml',
    'showSagasJournal',
    'showDiscoveries',
    'showOutlawLairs',
    'showTradingCompany',
    'showHoldingSiegesPanel', 'holdingSiegeAct',
    'showDeeds',
    'showCounsel', 'counselGo',
    'showPatronage', 'patronageAct',
    'showUnderworldPanel',
    '_resourceSourceNames', '_constructionHint', 'meetingPresentTreasure',
    'doTrapFurs', 'doIceFish', 'doPlantingContract',
    '_serviceResult', 'showBlacksmithMenu', 'showBlessingMenu', 'showStableMenu', 'showGuardMenu',
    'showTributeMenu', 'showAudienceMenu', 'OUTLAW_REFUSED_ACTIONS', 'refuseIfOutlawed',
    'REALM_POLITICS_AP', 'showRealmWarsMenu', 'showRestorationMenu', '_realmResult',
    'AP_COSTS', 'DEFERRED_AP_ACTIONS', '_appointTitle', '_buskFortuneTelling', '_buskJuggling',
    '_buskPreaching', '_buskSinging', '_buskStorytelling', '_buskingReward', '_categorizeActions',
    '_doForageMinigame', '_doHuntMinigame', '_doMeditateMinigame', '_doProspectMinigame',
    '_doSmuggleMinigame', '_doTameHorseMinigame', '_doTrainCombatMinigame', '_gamblingCheckAP',
    '_gamblingFinance', '_generatePOIRewards', '_getBountyData', '_getBuskingData', '_getForageData',
    '_getGamblingData', 'DEFAULT_GAMBLING', '_getGamblingSettings', '_getGamblingGame', '_getHuntData', '_getJobData', '_getPlayerSettlementTiles', '_getPlayerStat',
    '_getRelationshipProgress', '_getTavernLuckBonus', '_handleTellStories', '_laborCharisma',
    '_laborCombat', '_laborIntelligence', '_laborReward', '_laborStamina', '_laborStealth',
    '_laborStrength', '_meetingOptionButton', '_minigameCrownAnchor', '_minigameDragonsFlip',
    'BUILD_CATEGORIES', '_buildOutputText', '_canBuildTechBuilding', '_centerCameraOnPlayer', 'closePanel', 'closePanelAndEndDay', 'closePanelAndRefresh', '_landingCargoText', '_minigameHighLow', '_minigamePoker', '_pendingAP', '_ppDoCaught', '_renderActionButton',
    '_renderActionTile', '_renderAffectionBar', '_renderFishingResults', '_renderRelationshipXPBar',
    '_resignTitle', '_runArcheryFestivalMinigame', '_runJoustingFestivalMinigame',
    '_setIncentiveFromManage', '_showActiveMissionsMenu', '_showAssignMissionForSpy',
    '_showAssignMissionMenu', '_showCapturedBountyDecision', '_showFoundReligionModal',
    '_showMarriageCelebration', '_showMinigamePrompt', '_showMissionTargetSelect', '_showMoveShipMenu',
    '_showRumorResults', '_showSailToMenu', '_showShipBuildConfig', '_showShipManagePanel',
    '_showShipUpgradePanel', '_showSpyRecruitMenu', 'attemptJailbreak', 'attemptServitudeEscape',
    'attemptStealMap', 'buyFreedom', 'buyMapFromTrade', 'changeColonyPolicy', 'clearTrees', 'close',
    'collectGoods', 'commitPendingAP', 'councilConvene', 'councilDeclareWar', 'councilManageFaction',
    'councilVoteTax', 'councilVoteWar', 'countFishingBoats', 'createMap', 'createMenu',
    'demolishInfrastructure', 'digTreasure', 'disembarkShip', 'doBlessSettlement', 'doCaptureCriminal',
    'doCaptureFugitive', 'doCollectTax', 'doCraftCampfire', 'doSeaActivity', 'doFish', 'doForage', 'doFormKingdom',
    'denounceHeresy', 'doHoldCouncil', 'doHunt', 'doMeditate', 'doPickpocket', 'doPledgeAllegiance', 'doPostSignboard',
    'doProspect', 'doRenounceAllegiance', 'doRequestBounty', 'doTameHorse', 'doTrainCombat',
    'executeAddErrors', 'executeChangePolicy', 'executeFoundColony', 'executeSendPioneers',
    'explorePOI', 'getAPCost', 'getLogisticsDestinationsHtml', 'getVariablesFishingGrounds',
    'giftToIndigenous', 'handleAction', 'learnFromIndigenous', 'meetingAskAboutRealm',
    'meetingDemandTribute', 'meetingImproveRelations', 'meetingPledgeAllegiance',
    'meetingRenounceAllegiance', 'meetingRequestAid', 'meetingRequestTitle', 'meetingRequestTrade',
    'performAttack', 'performRaid', 'performSiege', 'postBail', 'preach', 'readMap', 'reinforceColony',
    'sellMapFromTrade', 'sellMapToArchive', 'sellPlayerMap', 'sendGoldToColony', 'show', 'showAddErrorsMenu',
    'rowToShip', 'showAttackConfirm', 'showBoardShipMenu', 'openTileMenu', 'postSignboardAndManageColony', 'showPortMarketMenu', 'showPropertyPicker', 'showRowAshoreMenu', 'showShipHoldMenu', 'showBountyBoardMenu', 'showBuildCulturalMenu', 'showUpgradeCulturalMenu',
    'showBuildInfrastructureMenu', 'showBuildPropertyMenu', 'showBuildTempleMenu', 'showBuskingMenu',
    'showBuyHouseMenu', 'showCartographyMenu', 'showCharacterDataModal', 'showContractMenu',
    'showCouncilMenu', 'showDeathScreen', 'showDonateMenu', 'showDynastyMenu', 'showEspionageMenu',
    'showFestivalMenu', 'showFleetMenu', 'showRoyalCourt', 'showFormKingdomMenu', 'showFoundColonyMenu',
    'showGamblingMenu', 'showHostFeastMenu', 'showHousePanel', 'showIntelJournal', 'showLordMeetingMenu',
    'showManageColonyMenu', 'showManageHouseMenu', 'showManagePropertyMenu', 'showManageSpiesMenu',
    'showMapCollection', 'showMapTradeMenu', 'showMeetPeopleMenu', 'showMiracleMenu',
    'showNegotiateIndigenousMenu', 'showNpcTradeMenu', 'showOddJobsMenu', 'showQuantityInput',
    'showRecruitMenu', 'showRecruitSettlersMenu', 'showReforgeArtifactMenu', 'showRelationshipsMenu',
    'showSeekTitleMenu', 'showSendPioneersMenu', 'showShipPassageMenu', 'showShipyardMenu',
    'showSiegeConfirm', 'showSiegePanel', 'siegeAct', 'showSmuggleMenu', 'showTalkLocalsMenu', 'showTavernMenu', 'showTerraformMenu',
    'showTitleStatusPanel', 'showTournamentMenu', 'showTradeMenu', 'showTravelPartyMenu', 'spendAP',
    'tradeWithIndigenous', 'visitHolySite',
];

let ActionMenu;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

describe('ActionMenu split — structural equivalence', () => {
    it('exposes exactly the original set of members', () => {
        const actual = Object.keys(ActionMenu).sort();
        expect(actual).toEqual([...EXPECTED_KEYS].sort());
    });

    it('has 266 members', () => {
        expect(Object.keys(ActionMenu)).toHaveLength(266);
    });

    it('every member except the known data props is a function', () => {
        const dataProps = new Set(['AP_COSTS', 'BUILD_CATEGORIES', 'DEFAULT_GAMBLING', 'DEFERRED_AP_ACTIONS', 'OUTLAW_REFUSED_ACTIONS', 'REALM_POLITICS_AP', '_pendingAP']);
        for (const key of Object.keys(ActionMenu)) {
            if (dataProps.has(key)) continue;
            expect(typeof ActionMenu[key], `${key} should be a function`).toBe('function');
        }
    });

    it('is still exposed on the window global for inline handlers', () => {
        expect(window.ActionMenu).toBe(ActionMenu);
    });
});
