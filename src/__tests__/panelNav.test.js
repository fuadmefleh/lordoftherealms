// The custom panel's tab bar (ui/ui/panels.js setPanelNav): the market window
// keeps its tabs while the player moves between Buy, Sell, Invest, Ledger, ...
// and drops them when another panel is opened from the map or a menu.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isPanelClick } from '../ui/ui/core.js';

let UI;
let saved;

// A panel element with just enough DOM for showCustomPanel's update path
function fakePanel() {
    const parts = {
        '.custom-panel-title': { textContent: '' },
        '.custom-panel-nav': { innerHTML: '', style: {} },
        '.custom-panel-body': { innerHTML: '', scrollTop: 0 },
    };
    const classes = new Set();
    return {
        parts,
        classes,
        querySelector: (sel) => parts[sel] || null,
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
        remove() { this.removed = true; },
    };
}

beforeAll(async () => {
    saved = globalThis.document;
    ({ UI } = await import('../ui/ui.js'));
});
afterAll(() => { globalThis.document = saved; });

function withPanel(panel) {
    globalThis.document = { ...saved, getElementById: (id) => (id === 'customPanel' && !panel.removed ? panel : null) };
}

describe('custom panel tab bar', () => {
    const navOf = (ran) => ({
        id: 'market', active: 'buy',
        items: [
            { key: 'buy', label: 'Buy', run: () => ran.push('buy') },
            { key: 'ledger', label: 'Ledger', run: () => ran.push('ledger') },
        ],
    });

    it('draws the bar with the active tab and keeps it across re-renders made inside the panel', () => {
        const panel = fakePanel();
        withPanel(panel);
        const ui = Object.create(UI.prototype);
        ui.setPanelNav(navOf([]));
        ui.showCustomPanel('Trade', '<p>stalls</p>');
        const nav = panel.parts['.custom-panel-nav'].innerHTML;
        expect(nav).toContain('data-ui-act="panelNavGo"');
        expect(nav).toMatch(/class="panel-nav-tab active"[^>]*>Buy</);
        expect(panel.classes.has('custom-panel--hub')).toBe(true);

        // A tab clicked: the view it opens keeps the bar, with that tab lit
        ui._clickInPanel = true;
        ui.panelNavGo('ledger');
        ui.showCustomPanel('Ledger', '<p>book</p>');
        expect(panel.parts['.custom-panel-nav'].innerHTML).toMatch(/class="panel-nav-tab active"[^>]*>Ledger</);

        // A button inside that view re-renders it: the bar stays
        ui._clickInPanel = true;
        ui.showCustomPanel('Ledger', '<p>book, page 2</p>');
        expect(panel.parts['.custom-panel-nav'].innerHTML).toContain('Ledger');
    });

    it('drops the bar when a panel is opened from outside, and on close', () => {
        const panel = fakePanel();
        withPanel(panel);
        const ui = Object.create(UI.prototype);
        ui.setPanelNav(navOf([]));
        ui.showCustomPanel('Trade', '<p>stalls</p>');
        ui._clickInPanel = false; // the map or the action menu
        ui.showCustomPanel('Bank', '<p>vaults</p>');
        expect(panel.parts['.custom-panel-nav'].innerHTML).toBe('');
        expect(panel.parts['.custom-panel-nav'].style.display).toBe('none');
        expect(panel.classes.has('custom-panel--hub')).toBe(false);

        ui.setPanelNav(navOf([]));
        ui.hideCustomPanel();
        expect(ui._panelNav).toBe(null);
    });

    it('runs the clicked tab, and a new view starts at its top', () => {
        const panel = fakePanel();
        withPanel(panel);
        const ran = [];
        const ui = Object.create(UI.prototype);
        ui.setPanelNav(navOf(ran));
        ui.showCustomPanel('Trade', '<p>stalls</p>');
        panel.parts['.custom-panel-body'].scrollTop = 400;
        ui.panelNavGo('ledger');
        expect(ran).toEqual(['ledger']);
        ui.showCustomPanel('Ledger', '<p>book</p>');
        expect(panel.parts['.custom-panel-body'].scrollTop).toBe(0);
        // ...even when the window keeps one title for all its tabs
        ui._panelNav.title = 'Market';
        panel.parts['.custom-panel-body'].scrollTop = 300;
        ui.panelNavGo('buy');
        ui.showCustomPanel('Trade', '<p>stalls</p>');
        expect(panel.parts['.custom-panel-title'].textContent).toBe('Market');
        expect(panel.parts['.custom-panel-body'].scrollTop).toBe(0);
        ui.panelNavGo('ledger');
        ui.showCustomPanel('Ledger', '<p>book</p>');
        // A refresh of the same view keeps the reader's place
        panel.parts['.custom-panel-body'].scrollTop = 200;
        ui.showCustomPanel('Ledger', '<p>book</p>');
        expect(panel.parts['.custom-panel-body'].scrollTop).toBe(200);
    });

    it('counts clicks in the panel and its dialogs, not on the map', () => {
        const at = (match) => ({ closest: (sel) => (sel.split(',').some(s => s.trim() === match) ? {} : null) });
        expect(isPanelClick(at('#customPanel'))).toBe(true);
        expect(isPanelClick(at('#quantityInputModal'))).toBe(true);
        expect(isPanelClick(at('#gameCanvas'))).toBe(false);
        expect(isPanelClick(null)).toBe(false);
    });
});
