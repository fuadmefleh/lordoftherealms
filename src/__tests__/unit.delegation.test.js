/**
 * Unit tests for the delegated panel-click router (Phase 6).
 *
 * Inline onclick="window.game.ui.X()" handlers were replaced by data-ui-act /
 * data-am-act attributes routed through routeDelegatedClick(). Since the game
 * is a browser canvas app we can't click-test here, so this locks the riskiest
 * part — attribute parsing + method dispatch — with a fake element.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

let routeDelegatedClick;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    // Import after DataLoader so ui.js's import graph is satisfied.
    ({ routeDelegatedClick } = await import('../ui/ui.js'));
});

// Minimal stand-in for a clicked DOM element carrying data-* attributes.
// `closest(sel)` returns itself when the requested data-attr is present.
function fakeEl(dataset) {
    const el = {
        dataset,
        closest(sel) {
            const key = sel === '[data-ui-act]' ? 'uiAct' : sel === '[data-am-act]' ? 'amAct' : null;
            return key && dataset[key] != null ? el : null;
        },
    };
    return el;
}

describe('routeDelegatedClick', () => {
    it('calls a UI method with JSON-parsed args (numbers)', () => {
        const ui = { showSettlementDetails: vi.fn() };
        const matched = routeDelegatedClick(
            ui,
            fakeEl({ uiAct: 'showSettlementDetails', uiArgs: '[5, 10]' })
        );
        expect(matched).toBe('ui:showSettlementDetails');
        expect(ui.showSettlementDetails).toHaveBeenCalledWith(5, 10);
    });

    it('passes string args and preserves types', () => {
        const ui = { showEconomicBreakdown: vi.fn() };
        routeDelegatedClick(ui, fakeEl({ uiAct: 'showEconomicBreakdown', uiArgs: '["3,7"]' }));
        expect(ui.showEconomicBreakdown).toHaveBeenCalledWith('3,7');
    });

    it('appends the clicked element when data-ui-el is set (was `this`)', () => {
        const ui = { openTreasuryTab: vi.fn() };
        const el = fakeEl({ uiAct: 'openTreasuryTab', uiArgs: '["tabMarket"]', uiEl: '1' });
        routeDelegatedClick(ui, el);
        expect(ui.openTreasuryTab).toHaveBeenCalledWith('tabMarket', el);
    });

    it('parses a boolean arg', () => {
        const ui = { createTreasuryRoute: vi.fn() };
        routeDelegatedClick(ui, fakeEl({ uiAct: 'createTreasuryRoute', uiArgs: '[true]' }));
        expect(ui.createTreasuryRoute).toHaveBeenCalledWith(true);
    });

    it('returns null and calls nothing for an unmatched element', () => {
        const ui = { foo: vi.fn() };
        expect(routeDelegatedClick(ui, fakeEl({}))).toBeNull();
        expect(ui.foo).not.toHaveBeenCalled();
    });

    it('does not throw on malformed args (falls back to no args)', () => {
        const ui = { openActionMenu: vi.fn() };
        expect(() =>
            routeDelegatedClick(ui, fakeEl({ uiAct: 'openActionMenu', uiArgs: 'not-json' }))
        ).not.toThrow();
        expect(ui.openActionMenu).toHaveBeenCalledWith();
    });
});
