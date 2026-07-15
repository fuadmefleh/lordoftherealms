/**
 * Structural regression guard for the UI monolith split.
 *
 * ui.js (a ~5.5k-line `class UI`) was split: the constructor + delegated-click
 * routing stay in ui/core.js; the 62 instance methods are Object.assign'd onto
 * UI.prototype and the 3 static settings helpers onto UI, across ui/*.js groups.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

let UI, routeDelegatedClick;

const INSTANCE = [
    'setupEventListeners', '_setupTimeControls', 'setupCivDropdowns', 'closeAllCivDropdowns',
    'openActionMenu', 'updateStats', '_updateSimsHUD', '_setNeedBar', 'switchHudTab',
    '_renderRelationshipsPanel', '_renderRelTile', '_escAttr', '_drawTilePortraits',
    '_attachTileTooltips', '_renderInventoryPanel', '_setupRelFilters', 'showHexInfo',
    'showInnerHexInfo', 'showEconomicBreakdown', 'showKingdomInfo', 'toggleCharacterPanel',
    'showCharacterPanel', 'showDynastiesPanel', 'showPanel', 'hidePanel', 'showCustomPanel',
    'hideCustomPanel', '_showMainMenuConfirm', 'showFinancesPanel', 'showInventoryPanel',
    'showQuestsPanel', 'showNotification', 'showEventLogPanel', 'hideTitleScreen',
    'showReligionCulturePanel', 'showHistoryPanel', 'showSettlementDetails', 'showKingdomDetails',
    'showPeoplesPanel', 'showTechnologyPanel', 'openTechTab', 'showTreasuryPanel', 'openTreasuryTab',
    'takeLoan', 'repayLoan', 'setTaxRate', 'createTreasuryRoute', 'upgradeTreasuryRouteProtection',
    'upgradeTreasuryRouteRoads', 'cancelTreasuryRoute', 'placeTreasuryAuctionBid',
    'showPropertiesPanel', 'showMapModeSelector', 'setMapMode', 'showEconomicTrends',
    'drawFinanceSparkline', 'showEventLog', 'showKingdomComparison', 'applySettings',
    'showSettingsPanel', '_bindSettingsEvents', '_applyAndSaveSettings',
];
const STATIC = ['getDefaultSettings', 'loadSettings', 'saveSettings'];

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ UI, routeDelegatedClick } = await import('../ui/ui.js'));
});

describe('UI split — structural equivalence', () => {
    it('all 62 instance methods live on UI.prototype', () => {
        const missing = INSTANCE.filter((m) => typeof UI.prototype[m] !== 'function');
        expect(missing).toEqual([]);
        expect(INSTANCE).toHaveLength(62);
    });

    it('all 3 static methods live on UI', () => {
        for (const s of STATIC) expect(typeof UI[s], s).toBe('function');
    });

    it('re-exports routeDelegatedClick through the barrel', () => {
        expect(typeof routeDelegatedClick).toBe('function');
    });

    it('constructs end-to-end (constructor + assembled prototype)', () => {
        // The constructor wires browser event listeners; the node stub lacks
        // window.addEventListener, so provide a noop for this construction.
        if (typeof window.addEventListener !== 'function') window.addEventListener = () => {};
        const fakeGame = { player: {}, world: {}, renderer: {} };
        const ui = new UI(fakeGame);
        expect(ui.game).toBe(fakeGame);
        expect(ui._activeHudTab).toBe('stats');
        expect(typeof ui.showHexInfo).toBe('function'); // prototype method reachable on instance
    });
});
