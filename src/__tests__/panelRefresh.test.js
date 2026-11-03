// Open panels follow the day (ui/panelRefresh.js): the show* call that painted
// a panel is remembered and called again after End Turn, without its one-off
// result message, unless the day replaced the panel or it was closed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackShows, PanelRefresh } from '../ui/panelRefresh.js';

let els;
let origGet;
beforeEach(() => {
    els = {};
    origGet = document.getElementById;
    document.getElementById = (id) => els[id] || null;
});
afterEach(() => { document.getElementById = origGet; });

/** A tiny UI: custom panel + a side panel, painting through note/clear as the real UI does. */
function makeUI() {
    const ui = {
        painted: [],
        showCustomPanel(title, html) {
            PanelRefresh.note(this);
            els.customPanel = els.customPanel || { classList: { contains: () => false } };
            this.painted.push(`${title}:${html}`);
        },
        hideCustomPanel() { delete els.customPanel; PanelRefresh.clear(this); },
        showPanel(id) {
            const hidden = new Set();
            els[id] = { classList: { contains: (c) => hidden.has(c), add: (c) => hidden.add(c) } };
            PanelRefresh.note(this, id);
        },
    };
    return ui;
}

describe('panels redraw after the day', () => {
    it('calls the painting show* again with today\'s state, dropping its message', () => {
        const state = { gold: 10 };
        const menu = {
            showPurse(game, message = null) {
                game.ui.showCustomPanel('Purse', `${state.gold}${message ? ` (${message})` : ''}`);
            },
            purseAct(game) { menu.showPurse(game, 'paid'); },
        };
        trackShows(menu);
        const game = { ui: makeUI() };
        menu.purseAct(game);
        expect(game.ui.painted.at(-1)).toBe('Purse:10 (paid)');
        const before = PanelRefresh.snapshot(game.ui);
        state.gold = 25; // the day passes
        expect(PanelRefresh.refreshAfterDay(game.ui, before)).toEqual(['customPanel']);
        expect(game.ui.painted.at(-1)).toBe('Purse:25');
    });

    it('leaves a panel the day replaced, a closed panel, a locked one and an untracked painter alone', () => {
        const menu = {
            showA(game) { game.ui.showCustomPanel('A', 'a'); },
            showB(game) { game.ui.showCustomPanel('B', 'b'); },
        };
        trackShows(menu);
        const game = { ui: makeUI() };
        menu.showA(game);
        let before = PanelRefresh.snapshot(game.ui);
        menu.showB(game); // an event scene opened during the day
        expect(PanelRefresh.refreshAfterDay(game.ui, before)).toEqual([]);

        menu.showA(game);
        before = PanelRefresh.snapshot(game.ui);
        game.ui.hideCustomPanel();
        expect(PanelRefresh.refreshAfterDay(game.ui, before)).toEqual([]);

        menu.showA(game);
        before = PanelRefresh.snapshot(game.ui);
        els.customPanel._locked = true;
        expect(PanelRefresh.refreshAfterDay(game.ui, before)).toEqual([]);
        delete els.customPanel._locked;

        game.ui.showCustomPanel('Raw', 'x'); // painted by code that is not a show* method
        before = PanelRefresh.snapshot(game.ui);
        expect(PanelRefresh.refreshAfterDay(game.ui, before)).toEqual([]);
    });

    it('redraws an open side panel (tile info) but not a hidden one; the outermost show* is the view', () => {
        const calls = [];
        const ui = makeUI();
        const proto = {
            showHexInfo(tile) { calls.push(tile.name); this.showInner(); this.showPanel('hexInfoPanel'); },
            showInner() { calls.push('inner'); },
        };
        trackShows(proto);
        Object.setPrototypeOf(ui, proto);
        ui.showHexInfo({ name: 'Woodland' });
        let before = PanelRefresh.snapshot(ui);
        expect(PanelRefresh.refreshAfterDay(ui, before)).toEqual(['hexInfoPanel']);
        expect(calls).toEqual(['Woodland', 'inner', 'Woodland', 'inner']);
        els.hexInfoPanel.classList.add('hidden');
        before = PanelRefresh.snapshot(ui);
        expect(PanelRefresh.refreshAfterDay(ui, before)).toEqual([]);
    });
});
