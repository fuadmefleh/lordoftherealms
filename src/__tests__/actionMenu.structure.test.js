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
// showPropertyPicker = 203, plus doSeaActivity and showPortMarketMenu = 205.
const EXPECTED_KEYS = [
    'AP_COSTS', 'DEFERRED_AP_ACTIONS', '_appointTitle', '_buskFortuneTelling', '_buskJuggling',
    '_buskPreaching', '_buskSinging', '_buskStorytelling', '_buskingReward', '_categorizeActions',
    '_doForageMinigame', '_doHuntMinigame', '_doMeditateMinigame', '_doProspectMinigame',
    '_doSmuggleMinigame', '_doTameHorseMinigame', '_doTrainCombatMinigame', '_gamblingCheckAP',
    '_gamblingFinance', '_generatePOIRewards', '_getBountyData', '_getBuskingData', '_getForageData',
    '_getGamblingData', '_getHuntData', '_getJobData', '_getPlayerSettlementTiles', '_getPlayerStat',
    '_getRelationshipProgress', '_getTavernLuckBonus', '_handleTellStories', '_laborCharisma',
    '_laborCombat', '_laborIntelligence', '_laborReward', '_laborStamina', '_laborStealth',
    '_laborStrength', '_meetingOptionButton', '_minigameCrownAnchor', '_minigameDragonsFlip',
    '_centerCameraOnPlayer', '_landingCargoText', '_minigameHighLow', '_minigamePoker', '_pendingAP', '_ppDoCaught', '_renderActionButton',
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
    'doHoldCouncil', 'doHunt', 'doMeditate', 'doPickpocket', 'doPledgeAllegiance', 'doPostSignboard',
    'doProspect', 'doRenounceAllegiance', 'doRequestBounty', 'doTameHorse', 'doTrainCombat',
    'executeAddErrors', 'executeChangePolicy', 'executeFoundColony', 'executeSendPioneers',
    'explorePOI', 'getAPCost', 'getLogisticsDestinationsHtml', 'getVariablesFishingGrounds',
    'giftToIndigenous', 'handleAction', 'learnFromIndigenous', 'meetingAskAboutRealm',
    'meetingDemandTribute', 'meetingImproveRelations', 'meetingPledgeAllegiance',
    'meetingRenounceAllegiance', 'meetingRequestAid', 'meetingRequestTitle', 'meetingRequestTrade',
    'performAttack', 'performSiege', 'postBail', 'preach', 'readMap', 'reinforceColony',
    'sellMapFromTrade', 'sellPlayerMap', 'sendGoldToColony', 'show', 'showAddErrorsMenu',
    'rowToShip', 'showAttackConfirm', 'showBoardShipMenu', 'showPortMarketMenu', 'showPropertyPicker', 'showRowAshoreMenu', 'showShipHoldMenu', 'showBountyBoardMenu', 'showBuildCulturalMenu',
    'showBuildInfrastructureMenu', 'showBuildPropertyMenu', 'showBuildTempleMenu', 'showBuskingMenu',
    'showBuyHouseMenu', 'showCartographyMenu', 'showCharacterDataModal', 'showContractMenu',
    'showCouncilMenu', 'showDeathScreen', 'showDonateMenu', 'showDynastyMenu', 'showEspionageMenu',
    'showFestivalMenu', 'showFleetMenu', 'showFormKingdomMenu', 'showFoundColonyMenu',
    'showGamblingMenu', 'showHostFeastMenu', 'showHousePanel', 'showIntelJournal', 'showLordMeetingMenu',
    'showManageColonyMenu', 'showManageHouseMenu', 'showManagePropertyMenu', 'showManageSpiesMenu',
    'showMapCollection', 'showMapTradeMenu', 'showMeetPeopleMenu', 'showMiracleMenu',
    'showNegotiateIndigenousMenu', 'showNpcTradeMenu', 'showOddJobsMenu', 'showQuantityInput',
    'showRecruitMenu', 'showRecruitSettlersMenu', 'showReforgeArtifactMenu', 'showRelationshipsMenu',
    'showSeekTitleMenu', 'showSendPioneersMenu', 'showShipPassageMenu', 'showShipyardMenu',
    'showSiegeConfirm', 'showSmuggleMenu', 'showTalkLocalsMenu', 'showTavernMenu', 'showTerraformMenu',
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

    it('has 205 members', () => {
        expect(Object.keys(ActionMenu)).toHaveLength(205);
    });

    it('every member except the known data props is a function', () => {
        const dataProps = new Set(['AP_COSTS', 'DEFERRED_AP_ACTIONS', '_pendingAP']);
        for (const key of Object.keys(ActionMenu)) {
            if (dataProps.has(key)) continue;
            expect(typeof ActionMenu[key], `${key} should be a function`).toBe('function');
        }
    });

    it('is still exposed on the window global for inline handlers', () => {
        expect(window.ActionMenu).toBe(ActionMenu);
    });
});
