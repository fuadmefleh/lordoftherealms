// The street map's hotbar layout lives on the player (player/hotbarLayout.js):
// filled by itself until the player arranges it, then theirs — assigned,
// swapped, cleared, a slot kept when its good runs out — and saved with them.
import { describe, it, expect } from 'vitest';
import { HotbarLayout, HOTBAR_SLOTS } from '../player/hotbarLayout.js';
import { SaveLoad } from '../systems/saveLoad.js';

describe('HotbarLayout', () => {
    it('starts empty and automatic; mends a bad or legacy layout', () => {
        const p = {};
        expect(HotbarLayout.slots(p)).toEqual(new Array(HOTBAR_SLOTS).fill(null));
        expect(p.hotbar.manual).toBe(false);
        const old = { hotbar: ['bread', '', 'gold', 42, 'wood'] };
        expect(HotbarLayout.slots(old)).toEqual(['bread', null, null, null, 'wood', null, null]);
        expect(old.hotbar.manual).toBe(true); // a saved array was a hand-made layout
    });

    it('fills itself from the packs until arranged (goods used up leave, new ones fill in)', () => {
        const p = {};
        const inv = { bread: 3, gold: 50, wood: 2 };
        expect(HotbarLayout.reconcile(p, inv)).toBe(true);
        expect(HotbarLayout.slots(p).slice(0, 3)).toEqual(['bread', 'wood', null]); // no coin on the bar
        delete inv.bread;
        inv.stone = 1;
        HotbarLayout.reconcile(p, inv);
        expect(HotbarLayout.slots(p).slice(0, 2)).toEqual(['stone', 'wood']);
    });

    it('assigns a good to a slot, moving it if already on the bar (never in two slots)', () => {
        const p = {};
        expect(HotbarLayout.assign(p, 2, 'bread')).toBe(true);
        expect(p.hotbar.manual).toBe(true);
        HotbarLayout.assign(p, 4, 'wood');
        HotbarLayout.assign(p, 4, 'bread'); // bread moves to 4, wood takes its old place
        expect(HotbarLayout.slots(p)).toEqual([null, null, 'wood', null, 'bread', null, null]);
        expect(HotbarLayout.assign(p, 4, 'bread')).toBe(false);
        expect(HotbarLayout.assign(p, 9, 'bread')).toBe(false);
        expect(HotbarLayout.assign(p, 0, 'gold')).toBe(false);
        expect(HotbarLayout.indexOf(p, 'wood')).toBe(2);
    });

    it('swaps slots and clears them', () => {
        const p = { hotbar: { slots: ['a', 'b', null], manual: true } };
        expect(HotbarLayout.move(p, 0, 2)).toBe(true);
        expect(HotbarLayout.slots(p).slice(0, 3)).toEqual([null, 'b', 'a']);
        expect(HotbarLayout.move(p, 1, 1)).toBe(false);
        expect(HotbarLayout.clear(p, 1)).toBe(true);
        expect(HotbarLayout.clear(p, 1)).toBe(false);
        expect(HotbarLayout.unassign(p, 'a')).toBe(true);
        expect(HotbarLayout.slots(p).every(s => s === null)).toBe(true);
    });

    it('a hand-arranged bar keeps a slot whose good ran out, and fills nothing it emptied', () => {
        const p = {};
        const inv = { bread: 1, wood: 5, stone: 2 };
        HotbarLayout.assign(p, 0, 'bread');
        HotbarLayout.clear(p, 1);
        delete inv.bread; // eaten
        expect(HotbarLayout.reconcile(p, inv)).toBe(false);
        const view = HotbarLayout.view(p, inv);
        expect(view[0]).toEqual({ index: 0, itemId: 'bread', qty: 0, ready: false });
        expect(view[1].itemId).toBe(null);
        inv.bread = 4; // more got: the slot is live again
        expect(HotbarLayout.view(p, inv)[0]).toMatchObject({ itemId: 'bread', qty: 4, ready: true });
        HotbarLayout.reset(p, inv); // handed back: lays itself out
        expect(p.hotbar.manual).toBe(false);
        expect(HotbarLayout.slots(p).filter(Boolean).sort()).toEqual(['bread', 'stone', 'wood']);
    });

    it('is saved with the player and read back', () => {
        const p = { inventory: { bread: 1 } };
        HotbarLayout.assign(p, 3, 'bread');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('hotbar');
        const saved = JSON.parse(JSON.stringify(SaveLoad._pickDefined(p, SaveLoad.EXTRA_PLAYER_FIELDS)));
        const back = {};
        Object.assign(back, saved);
        expect(HotbarLayout.itemAt(back, 3)).toBe('bread');
        expect(back.hotbar.manual).toBe(true);
    });
});
