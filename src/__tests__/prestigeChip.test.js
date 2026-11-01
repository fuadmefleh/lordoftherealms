/**
 * The House Prestige chip on the top bar (ui/prestigeChip.js, TopBar.jsx
 * #tbPrestige): value, monthly trend and Ambition in the tooltip, hidden
 * without a House, and a click opens the House panel.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { House } from '../systems/house.js';
import { prestigeChipView, updatePrestigeChip } from '../ui/prestigeChip.js';

let UI;
let ActionMenu;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ UI } = await import('../ui/ui.js'));
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

function makeEl() {
    const classes = new Set();
    const listeners = {};
    return {
        textContent: '', title: '', style: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : f; if (on) classes.add(c); else classes.delete(c); return on; },
            contains: (c) => classes.has(c),
        },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        fire: (type, ev = {}) => (listeners[type] || []).forEach(fn => fn({ preventDefault() {}, ...ev })),
    };
}

let reg;
let orig;
beforeEach(() => {
    reg = {};
    orig = document.getElementById;
    document.getElementById = (id) => (reg[id] || (reg[id] = makeEl()));
});
afterEach(() => {
    document.getElementById = orig;
});

function playerWithHouse(day = 100) {
    const player = { firstName: 'Ash', lastName: 'Wend', id: 'p1' };
    const world = { day };
    House.initialize(player, world);
    return { player, world };
}

describe('prestigeChipView', () => {
    it('is hidden without a House and during an interregnum', () => {
        expect(prestigeChipView({}, { day: 5 }).visible).toBe(false);
        expect(prestigeChipView(null, null).visible).toBe(false);
        const { player, world } = playerWithHouse();
        player.interregnum = { since: 90 };
        expect(prestigeChipView(player, world).visible).toBe(false);
    });

    it('shows prestige, the last month\'s trend and the current Ambition', () => {
        const { player, world } = playerWithHouse(100);
        House.award(player.house, 50, 'old glory', 20);   // outside the month
        House.award(player.house, 30, 'a victory', 90);
        House.spend(player.house, 10, 'a feast', 95);
        const v = prestigeChipView(player, world);
        expect(v.visible).toBe(true);
        expect(v.value).toBe(Math.round(player.house.prestige));
        expect(v.trend).toBe(20);
        expect(v.trendText).toBe('+20/mo');
        expect(v.title).toMatch(/Ambition: none chosen/);
        const id = House.ambitions(player.house)[0].id;
        House.chooseAmbition(player.house, id, 100);
        const v2 = prestigeChipView(player, world);
        expect(v2.ambition.name).toBeTruthy();
        expect(v2.title).toContain(`Ambition: ${v2.ambition.name}`);
        expect(v2.title).toMatch(/0\/\d+ milestones/);
        House.spend(player.house, 40, 'a ransom', 99);
        expect(prestigeChipView(player, world).negative).toBe(true);
    });
});

describe('the chip in the top bar', () => {
    it('TopBar.jsx carries the chip and its fields', () => {
        const src = readFileSync(resolve(__dirname, '../components/TopBar.jsx'), 'utf8');
        for (const id of ['tbPrestige', 'tbPrestigeVal', 'tbPrestigeTrend']) expect(src).toContain(`id="${id}"`);
    });

    it('updatePrestigeChip fills it, and updateTopBarResources refreshes it', () => {
        const { player, world } = playerWithHouse(100);
        House.award(player.house, 25, 'a deed', 99);
        updatePrestigeChip(player, world);
        expect(reg.tbPrestige.style.display).toBe('');
        expect(reg.tbPrestigeVal.textContent).toBe(String(Math.round(player.house.prestige)));
        expect(reg.tbPrestigeTrend.textContent).toBe('+25/mo');
        expect(reg.tbPrestige.title).toMatch(/Prestige/);
        updatePrestigeChip({}, world);
        expect(reg.tbPrestige.style.display).toBe('none');

        const ui = Object.create(UI.prototype);
        ui.notificationLog = [];
        ui.game = {};
        Object.assign(player, { gold: 10, renown: 0, army: [], financeHistory: [] });
        ui.updateTopBarResources(player, world);
        expect(reg.tbPrestige.style.display).toBe('');
    });

    it('a click (or Enter) opens the House panel', () => {
        const { player, world } = playerWithHouse(100);
        world.getTile = () => null;
        const ui = Object.create(UI.prototype);
        ui.notificationLog = [];
        ui.game = { player, world, recenterCamera() {} };
        const spy = vi.spyOn(ActionMenu, 'showHousePanel').mockImplementation(() => {});
        try {
            ui._setupHudNav();
            reg.tbPrestige.fire('click');
            reg.tbPrestige.fire('keydown', { key: 'Enter' });
            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[0][0]).toBe(ui.game);
        } finally {
            spy.mockRestore();
        }
    });
});
