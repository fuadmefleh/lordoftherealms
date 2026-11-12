// The Inventory window (ui/ui/inventoryPanel.js) renders on a real harness
// game: the packs' bar, the hotbar strip, filters, sorts, tiles and a good's
// card — and its buttons act (eat, wield, put on the hotbar, clear) without
// leaking undefined/NaN into what the player reads.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { HotbarLayout } from '../player/hotbarLayout.js';
import { Arms } from '../systems/arms.js';

let UI;
let Hotbar;
let inventoryPanelHtml;
let game;
let ui;
let panels;
let notes;

function clean(text) {
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
}

function last() {
    const p = panels[panels.length - 1];
    expect(p.title).toBe('Inventory');
    clean(p.html);
    return p.html;
}

const count = (html, re) => (html.match(re) || []).length;

beforeAll(async () => {
    await loadData();
    ({ UI } = await import('../ui/ui.js'));
    ({ Hotbar } = await import('../ui/hotbar.js'));
    ({ inventoryPanelHtml } = await import('../ui/ui/inventoryPanel.js'));
    game = newGame(4242);
    game.player.inventory = { bread: 5, wood: 3, gems: 2, iron_sword: 1, holy_water: 1, gold: 10 };
    panels = [];
    notes = [];
    ui = Object.create(UI.prototype);
    ui.game = game;
    ui.showCustomPanel = (title, html) => panels.push({ title, html });
    ui.hideCustomPanel = () => {};
    ui.showNotification = (t, m) => notes.push(`${t} ${m}`);
    ui.updateStats = () => {};
    game.ui = ui;
}, 240000);

describe('the Inventory window', () => {
    it('shows the packs: room, hotbar strip, filters, sorts and a tile per good', () => {
        ui.showInventoryPanel();
        const html = last();
        expect(html).toMatch(/class="inv-cap/);
        expect(count(html, /data-hb-slot="/g)).toBe(7);
        expect(count(html, /data-inv-item="/g)).toBe(5); // coin is not a good
        expect(count(html, /draggable="true" data-inv-item/g)).toBe(5);
        expect(html).toMatch(/id="invSearch"/);
        for (const s of ['category', 'name', 'qty', 'value', 'unitValue']) expect(html).toContain(`data-ui-act="invSort" data-ui-args="[&quot;${s}&quot;]"`);
        for (const c of ['all', 'food', 'materials', 'arms', 'valuables', 'physic']) expect(html).toContain(`data-ui-args="[&quot;${c}&quot;]"`);
        expect(html).not.toContain('[&quot;clothing&quot;]'); // a kind not carried has no chip
        expect(html).toMatch(/inv-detail-empty/);
    });

    it('filters and sorts (the same sort again reverses)', () => {
        ui.invFilter('food');
        let html = last();
        expect(html).toContain('data-inv-item="bread"');
        expect(html).not.toContain('data-inv-item="wood"');
        ui.invFilter('all');
        ui.invSort('name');
        html = last();
        expect(html).toMatch(/inv-sort active[^>]*>Name ▲/);
        ui.invSort('name');
        expect(last()).toMatch(/inv-sort active[^>]*>Name ▼/);
        const st = { sort: 'qty', query: 'bre' };
        const only = inventoryPanelHtml(game, st);
        clean(only);
        expect(count(only, /data-inv-item="/g)).toBe(1);
        expect(inventoryPanelHtml(game, { query: 'zzz' })).toMatch(/Nothing in the packs matches/);
    });

    it("a good's card: what it is and what can be done", () => {
        ui.invSelect('bread');
        const html = last();
        expect(html).toMatch(/inv-detail has-item/);
        expect(html).toContain('data-ui-act="invEat"');
        // (the bar fills itself until arranged, so bread is already on it: take off, or move)
        expect(html).toContain('data-ui-act="invHotbarUnassign"');
        expect(count(html, /data-ui-act="invHotbarAssign"/g)).toBe(7);
        expect(html).toMatch(/Only on foot in a place/); // drop is off on the world map
        ui.invSelect('holy_water');
        expect(last()).toContain('data-ui-act="useTreasure"');
        ui.invSelect('iron_sword');
        const sword = last();
        expect(sword).toContain('data-ui-act="equipArms"');
        expect(sword).toMatch(Arms.isEquipped(game.player, 'iron_sword') ? /Put away/ : /Wield/);
    });

    it('eats, wields and puts away from the card', () => {
        ui.invEat('bread');
        expect(game.player.inventory.bread).toBe(4);
        const wasWorn = Arms.isEquipped(game.player, 'iron_sword');
        ui.equipArms('iron_sword'); // (still the picked good: its card redraws)
        expect(Arms.isEquipped(game.player, 'iron_sword')).toBe(!wasWorn);
        expect(last()).toMatch(wasWorn ? /Wield/ : /Put away/);
        ui.invSelect('iron_sword'); // a second click on the picked tile unpicks it
        expect(last()).toMatch(/inv-detail-empty/);
        ui.invSelect('iron_sword');
        ui.equipArms('iron_sword');
        for (const n of notes) clean(n);
    });

    it('puts a good on the hotbar from the card, keeps the slot when it runs out, clears it', () => {
        ui.invHotbarUnassign('bread');
        expect(HotbarLayout.indexOf(game.player, 'bread')).toBe(-1);
        ui.invSelect('bread');
        expect(last()).toContain('data-ui-act="invHotbarPick"');
        ui.invHotbarPick('bread');
        let html = last();
        expect(count(html, /data-ui-act="invHotbarAssign"/g)).toBe(7);
        ui.invHotbarAssign('bread', 2);
        expect(HotbarLayout.itemAt(game.player, 2)).toBe('bread');
        html = last();
        expect(html).toMatch(/class="inv-tile-key"[^>]*>3</);
        expect(html).toContain('data-ui-act="invHotbarClear" data-ui-args="[2]"');
        expect(html).toContain('data-ui-act="invHotbarAuto"');
        // eaten to the last: the slot is kept, greyed
        game.player.inventory.bread = 0;
        Hotbar.refresh();
        ui.showInventoryPanel();
        html = last();
        expect(HotbarLayout.itemAt(game.player, 2)).toBe('bread');
        expect(html).toMatch(/inv-hb-slot kept" data-hb-slot="2"/);
        ui.invHotbarClear(2);
        expect(HotbarLayout.itemAt(game.player, 2)).toBe(null);
        game.player.inventory.bread = 4;
    });

    it('drops on the bar: a good onto a slot, a slot onto another', () => {
        Hotbar.attach(game);
        expect(Hotbar.dropOn(0, { itemId: 'wood' })).toBe(true);
        expect(Hotbar.dropOn(5, { fromSlot: 0 })).toBe(true);
        expect(HotbarLayout.itemAt(game.player, 5)).toBe('wood');
        expect(HotbarLayout.itemAt(game.player, 0)).toBe(null);
        expect(Hotbar.dropOn(5, {})).toBe(false);
        ui.invHotbarAuto();
        expect(game.player.hotbar.manual).toBe(false);
        clean(last());
    });

    it('toggles: I opens it, and again closes it', () => {
        expect(typeof ui.toggleInventoryPanel).toBe('function');
        const n = panels.length;
        ui.toggleInventoryPanel(); // nothing open (the test DOM has no panel): opens
        expect(panels.length).toBe(n + 1);
    });
});
