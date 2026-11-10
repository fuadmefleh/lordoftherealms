// The street map's hotbar follows the packs: PlayerInventory.stamp fingerprints
// what is carried, and Hotbar.sync (called every frame by the game loop) redraws
// the slots whenever it changes — whichever road the goods took in or out.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayerInventory } from '../core/inventory.js';
import { Hotbar } from '../ui/hotbar.js';

function fakeSlot(n) {
    const icon = { textContent: '' };
    const qty = { textContent: '' };
    const classes = new Set();
    return {
        dataset: { slot: String(n) },
        icon, qty,
        classList: {
            toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
            contains: (c) => classes.has(c),
        },
        querySelector(sel) {
            if (sel === '.hotbar-icon') return icon;
            if (sel === '.hotbar-qty') return qty;
            return null;
        },
        appendChild() {},
    };
}

function fakeBar() {
    const slots = Array.from({ length: 7 }, (_, i) => fakeSlot(i + 1));
    const classes = new Set();
    return {
        slots,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        querySelectorAll: () => slots,
        addEventListener() {},
    };
}

const shown = (bar) => bar.slots.map(s => s.qty.textContent).filter(Boolean);

describe('PlayerInventory.stamp', () => {
    it('changes with every kind of change to the packs', () => {
        const player = { inventory: { bread: 20 } };
        const a = PlayerInventory.stamp(player);
        PlayerInventory.addItem(player, 'wheat', 3);
        const b = PlayerInventory.stamp(player);
        expect(b).not.toBe(a);
        player.inventory.wheat += 2;                      // a direct write, not addItem
        const c = PlayerInventory.stamp(player);
        expect(c).not.toBe(b);
        player.inventory.bread = 0;                       // gone to nothing
        expect(PlayerInventory.stamp(player)).toBe('wheat:5;');
        expect(PlayerInventory.stamp({})).toBe('');
        expect(PlayerInventory.stamp(null)).toBe('');
    });
});

describe('Hotbar.sync', () => {
    let bar;
    let game;
    beforeEach(() => {
        bar = fakeBar();
        if (typeof window.addEventListener !== 'function') window.addEventListener = () => {};
        vi.spyOn(document, 'getElementById').mockImplementation((id) => (id === 'itemHotbar' ? bar : null));
        game = { player: { inventory: { bread: 20 } }, ui: null };
        Hotbar.init(game);
        Hotbar.show();
    });
    afterEach(() => {
        for (let i = 0; i < 7; i++) Hotbar.clearSlot(i);
        vi.restoreAllMocks();
    });

    it('draws what is carried', () => {
        expect(bar.slots[0].qty.textContent).toBe('×20');
        expect(Hotbar.sync(game)).toBe(false); // nothing changed, nothing redrawn
    });

    it('shows a newly gathered good without anyone calling refresh', () => {
        PlayerInventory.addItem(game.player, 'wheat', 4);
        expect(Hotbar.sync(game)).toBe(true);
        expect(shown(bar)).toEqual(['×20', '×4']);
        expect(Hotbar.serialise().slice(0, 2)).toEqual(['bread', 'wheat']);
    });

    it('follows a stack growing or shrinking by a direct write', () => {
        game.player.inventory.bread -= 1;            // eaten
        expect(Hotbar.sync(game)).toBe(true);
        expect(bar.slots[0].qty.textContent).toBe('×19');
        game.player.inventory.bread += 5;
        Hotbar.sync(game);
        expect(bar.slots[0].qty.textContent).toBe('×24');
    });

    it('empties a slot whose good is used up, and fills it with the next new good', () => {
        PlayerInventory.addItem(game.player, 'wood', 2);
        Hotbar.sync(game);
        delete game.player.inventory.bread;
        Hotbar.sync(game);
        expect(bar.slots[0].qty.textContent).toBe('');
        expect(bar.slots[0].classList.contains('empty')).toBe(true);
        expect(bar.slots[1].qty.textContent).toBe('×2');
        PlayerInventory.addItem(game.player, 'stone', 1);
        Hotbar.sync(game);
        expect(Hotbar.serialise()[0]).toBe('stone');
    });

    it('notices a whole new set of packs (a load, a new life)', () => {
        game.player.inventory = { bread: 20 };       // same contents, new object
        expect(Hotbar.sync(game)).toBe(true);
    });

    it('does nothing while the bar is hidden', () => {
        Hotbar.hide();
        PlayerInventory.addItem(game.player, 'wheat', 1);
        expect(Hotbar.sync(game)).toBe(false);
        Hotbar.show();
        expect(shown(bar)).toEqual(['×20', '×1']);
    });
});
