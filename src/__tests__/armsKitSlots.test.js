// The kit's new slots (systems/arms.js, data/arms.json): leg harness, boots
// and gloves are armour like the helm and the body armour — taken up and put
// away, counted in what the harness stops and weighs, worn by harm on the road
// and by a duel's blows, mended like the rest, drawn on the player's figure
// (legs and feet; gloves have no sheets), saved with the equipment (an older
// save without the slots still loads) — and every piece comes from somewhere:
// a recipe at the arms bench, the common ones made by the town's craftsmen.
// The Inventory window's Kit lists and changes them. Seeded.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Arms, ARMS_SLOTS, ARMOUR_SLOTS } from '../systems/arms.js';
import { Crafting } from '../player/crafting.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => Utils.setSeed(777));

const NEW = {
    legs: ['padded_chausses', 'leather_leggings', 'mail_chausses', 'plate_greaves'],
    feet: ['boots', 'sabatons'],
    hands: ['leather_gloves', 'gauntlets'],
};

function fighter(inv = {}) {
    return { name: 'Tester', gold: 500, health: 100, maxHealth: 100, strength: 6, inventory: { ...inv }, maxInventory: 60, skills: { combat: 3 }, army: [] };
}

describe('the new slots in the catalogue', () => {
    it('legs, feet and hands are slots, and armour', () => {
        for (const s of ['legs', 'feet', 'hands']) {
            expect(ARMS_SLOTS).toContain(s);
            expect(ARMOUR_SLOTS).toContain(s);
            expect(Arms.config().slots[s].label).toBeTruthy();
        }
    });

    it('every piece is a priced good with protection and weight, made by a recipe at a bench', () => {
        const G = DataLoader._gamedata.playerEconomy.GOODS;
        const recipes = Crafting.recipes();
        for (const [slot, ids] of Object.entries(NEW)) {
            for (const id of ids) {
                const def = Arms.item(id);
                expect(def, id).toBeTruthy();
                expect(def.slot, id).toBe(slot);
                expect(G[id.toUpperCase()].basePrice, id).toBeGreaterThan(0);
                expect(Arms.stats(id).prot, id).toBeGreaterThan(0);
                expect(def.weight, id).toBeGreaterThan(0);
                expect(Object.keys(Arms.repairGoods(id)).length, id).toBeGreaterThan(0);
                expect(recipes.some(r => r.result && r.result[id] > 0), id).toBe(true);
            }
        }
        // the bigger the harness, the more it stops — and the more it weighs
        expect(Arms.stats('plate_greaves').prot).toBeGreaterThan(Arms.stats('mail_chausses').prot);
        expect(Arms.stats('mail_chausses').prot).toBeGreaterThan(Arms.stats('padded_chausses').prot);
        expect(Arms.item('plate_greaves').weight).toBeGreaterThan(Arms.item('padded_chausses').weight);
    });

    it('the common pieces are made by the towns\' craftsmen from real stuff (no goods from nowhere)', () => {
        const M = DataLoader._gamedata.markets;
        for (const id of ['padded_chausses', 'leather_leggings', 'mail_chausses', 'leather_gloves', 'boots']) {
            expect(SettlementMarket.tracks(id), id).toBe(true);
            const r = M.recipes.find(x => x.out && x.out[id] > 0);
            expect(r, id).toBeTruthy();
            expect(Object.keys(r.in).length, id).toBeGreaterThan(0);
        }
        // the plate pieces only from a smith (the bench, or an order)
        for (const id of ['plate_greaves', 'sabatons', 'gauntlets']) expect(Crafting.recipes('arms').some(r => r.result[id] > 0), id).toBe(true);
    });
});

describe('wearing them', () => {
    it('an unchosen slot takes up the best piece carried; put away it stays empty; taken up again', () => {
        const p = fighter({ padded_chausses: 1, mail_chausses: 1, boots: 1, leather_gloves: 1 });
        expect(Arms.equipped(p, 'legs').id).toBe('mail_chausses');
        expect(Arms.equipped(p, 'feet').id).toBe('boots');
        expect(Arms.equipped(p, 'hands').id).toBe('leather_gloves');
        expect(Arms.candidates(p, 'legs').map(c => c.id)).toEqual(['mail_chausses', 'padded_chausses']);

        const off = Arms.unequip(p, 'legs');
        expect(off.success).toBe(true);
        expect(p.equipment.legs).toBeNull();
        expect(Arms.equipped(p, 'legs')).toBeNull();

        const on = Arms.equip(p, 'padded_chausses');
        expect(on.success).toBe(true);
        expect(on.text).toMatch(/put on/);
        expect(Arms.equipped(p, 'legs').id).toBe('padded_chausses');
        expect(Arms.isEquipped(p, 'mail_chausses')).toBe(false);
        // toggling a worn piece puts it away
        const t = Arms.toggleEquip(p, 'padded_chausses');
        expect(t.equipped).toBe(false);
        expect(t.slot).toBe('legs');
        expect(Arms.equipped(p, 'legs')).toBeNull();
    });

    it('a piece on the wrong slot or not carried cannot be put on', () => {
        const p = fighter({ boots: 1 });
        expect(Arms.equip(p, 'gauntlets').success).toBe(false);
        expect(Arms.equipped(p, 'hands')).toBeNull();
    });

    it('the legs, feet and hands add to what the harness stops and weighs, and cut the road\'s harm', () => {
        const bodyOnly = fighter({ chainmail: 1 });
        const full = fighter({ chainmail: 1, mail_chausses: 1, sabatons: 1, gauntlets: 1 });
        const a = Arms.personal(bodyOnly);
        const b = Arms.personal(full);
        expect(b.armour).toBeGreaterThan(a.armour);
        for (const t of ['cut', 'pierce', 'blunt']) expect(b.armourVs[t]).toBeGreaterThan(a.armourVs[t]);
        expect(b.weight).toBeCloseTo(a.weight + 4 + 1.8 + 1, 5);
        expect(Arms.harmMultiplier(full)).toBeLessThan(Arms.harmMultiplier(bodyOnly));
    });

    it('harm on the road and a duel\'s blows wear them; they are mended with their own goods', () => {
        const p = fighter({ chainmail: 1, leather_leggings: 1, boots: 1, leather_gloves: 1, leather: 3 });
        Arms.loadout(p);
        Arms.wearArmour(p, 40);
        for (const s of ['legs', 'feet', 'hands']) expect(Arms.equipped(p, s).cond, s).toBeLessThan(100);
        // the body takes the most of it
        expect(Arms.equipped(p, 'body').cond).toBeLessThan(Arms.equipped(p, 'feet').cond);
        const before = Arms.equipped(p, 'hands').cond;
        Arms.wearFromDuel(p, { taken: 10 });
        expect(Arms.equipped(p, 'hands').cond).toBeLessThan(before);
        const m = Arms.mend(p, 'legs', { self: true });
        expect(m.success).toBe(true);
        expect(Arms.equipped(p, 'legs').cond).toBe(100);
        expect(p.inventory.leather).toBe(2);
    });

    it('a two-hander leaves no hand for a shield; the gloves stay on', () => {
        const p = fighter({ pike: 1, heater_shield: 1, iron_sword: 1, gauntlets: 1 });
        expect(Arms.equip(p, 'heater_shield').success).toBe(true);
        expect(Arms.equip(p, 'pike').success).toBe(true);
        expect(Arms.equipped(p, 'off')).toBeNull();
        const r = Arms.equip(p, 'heater_shield');
        expect(r.success).toBe(false);
        expect(r.reason).toMatch(/both hands/);
        expect(Arms.equipped(p, 'hands').id).toBe('gauntlets');
        expect(Arms.equip(p, 'iron_sword').success).toBe(true);
        expect(Arms.equip(p, 'heater_shield').success).toBe(true);
    });
});

describe('saves', () => {
    it('the new slots round-trip, and an older save without them still loads', () => {
        const p = new Player();
        p.inventory = { ...p.inventory, iron_sword: 1, helmet: 1, mail_chausses: 1, boots: 1 };
        Arms.equip(p, 'iron_sword');
        Arms.equip(p, 'mail_chausses');
        Arms.unequip(p, 'feet');
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.equipment.legs.id).toBe('mail_chausses');
        expect(back.equipment.feet).toBeNull();
        expect(Arms.equipped(back, 'feet')).toBeNull();

        // An older save: only main, off, head, body
        const old = JSON.parse(JSON.stringify(json));
        old.equipment = { main: { id: 'iron_sword', cond: 70, edge: 40 }, off: null, head: { id: 'helmet', cond: 90, edge: 100 } };
        const was = new Player();
        SaveLoad.restorePlayer(old, was);
        expect(Arms.equipped(was, 'main').cond).toBe(70);
        expect(Arms.equipped(was, 'off')).toBeNull();
        // the slots it never had take up what is carried, or stay bare
        expect(Arms.equipped(was, 'legs').id).toBe('mail_chausses');
        expect(Arms.equipped(was, 'feet').id).toBe('boots');
        expect(Arms.equipped(was, 'hands')).toBeNull();
        expect(Arms.personal(was).armour).toBeGreaterThan(0);
    });
});

describe('the figure', () => {
    const recipe = [
        'Body/Body 02 - Masculine, Thin/Peach',
        'Head/Head 02 - Masculine/Peach',
        'Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Brown',
        'Clothing/Masculine, Thin/Torso/Shirt 01 - Longsleeve Shirt/Navy',
        'Hair/Short 01 - Buzzcut/Brown',
    ];

    it('leg harness takes the trousers\' place, boots go on after the legs, gloves are not drawn', () => {
        const look = Arms.lookLayers(recipe, { main: null, off: null, head: null, body: null, legs: 'mail_chausses', feet: 'sabatons', hands: 'gauntlets' });
        expect(look).not.toContain('Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Brown');
        const legs = look.indexOf('Clothing/Masculine, Thin/Legs/Pants 02 - Leggings/Gray');
        expect(legs).toBeGreaterThan(-1);
        expect(look[legs + 1]).toBe('Clothing/Masculine, Thin/Feet/Shoes 02 - Boots/Silver');
        expect(look.length).toBe(recipe.length + 1);
        // the feminine build wears her own sheets
        const fem = Arms.lookLayers(recipe, { legs: 'leather_leggings', feet: 'boots' }, { build: 'Feminine, Thin' });
        expect(fem).toContain('Clothing/Feminine, Thin/Legs/Pants 02 - Leggings/Leather');
        expect(fem).toContain('Clothing/Feminine, Thin/Feet/Shoes 02 - Boots/Brown');
    });

    it('a kit with nothing on the legs or feet keeps the recipe\'s own (soldiers)', () => {
        const withShoes = [...recipe.slice(0, 3), 'Clothing/Masculine, Thin/Feet/Shoes 01 - Shoes/Black', ...recipe.slice(3)];
        const look = Arms.lookLayers(withShoes, { main: null, off: null, head: null, body: 'gambeson', legs: null, feet: null, hands: null });
        expect(look).toContain('Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Brown');
        expect(look).toContain('Clothing/Masculine, Thin/Feet/Shoes 01 - Shoes/Black');
        // boots replace the recipe's shoes
        const booted = Arms.lookLayers(withShoes, { feet: 'boots' });
        expect(booted).toContain('Clothing/Masculine, Thin/Feet/Shoes 02 - Boots/Brown');
        expect(booted).not.toContain('Clothing/Masculine, Thin/Feet/Shoes 01 - Shoes/Black');
    });
});

describe('the Inventory window\'s Kit', () => {
    let UI, kitHtml, game, ui, panels, notes;

    beforeAll(async () => {
        ({ UI } = await import('../ui/ui.js'));
        ({ kitHtml } = await import('../ui/ui/inventoryPanel.js'));
        const { newGame } = await import('./playtest/harness.js');
        game = newGame(4242);
        game.player.inventory = { bread: 2, pike: 1, iron_sword: 1, shield: 1, gambeson: 1, padded_chausses: 1, mail_chausses: 1, boots: 1, gold: 5 };
        game.player.equipment = {};
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

    const last = () => {
        const h = panels[panels.length - 1].html;
        expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
        return h;
    };

    it('shows every slot with what is worn and the totals', () => {
        ui.showInventoryPanel();
        const html = last();
        for (const s of ['head', 'body', 'hands', 'legs', 'feet', 'main', 'off']) expect(html).toContain(`data-kit-slot="${s}"`);
        expect(html).toContain('Mail Chausses');
        expect(html).toContain('Leather Boots');
        expect(html).toMatch(/Stops <b>\d+%<\/b>/);
        expect(html).toMatch(/<b>[\d.]+ kg<\/b>/);
    });

    it('a slot picked lists what fits, best first, and Nothing; picking one wears it', () => {
        ui.invKitSlot('legs');
        let html = last();
        const pick = html.slice(html.indexOf('inv-kit-pick'));
        expect(pick.indexOf('Mail Chausses')).toBeLessThan(pick.indexOf('Padded Chausses'));
        expect(pick).toContain('data-ui-act="invKitEquip" data-ui-args="[&quot;legs&quot;,&quot;padded_chausses&quot;]"');
        expect(pick).toContain('data-ui-args="[&quot;legs&quot;,null]"');
        ui.invKitEquip('legs', 'padded_chausses');
        expect(Arms.equipped(game.player, 'legs').id).toBe('padded_chausses');
        ui.invKitEquip('legs', null);
        expect(Arms.equipped(game.player, 'legs')).toBeNull();
        html = last();
        expect(html).toMatch(/data-kit-slot="legs"[^>]*>.*?Nothing/s);
    });

    it('with a two-hander the shield is greyed out with the reason', () => {
        ui.invKitEquip('main', 'pike');
        const html = kitHtml(game.player, { kitSlot: 'off' });
        expect(html).toMatch(/Both hands on the pike/);
        expect(html).toMatch(/takes both hands/);
        expect(html).not.toContain('data-ui-args="[&quot;off&quot;,&quot;shield&quot;]"');
        // the item card's button is greyed too
        ui.invSelect('shield');
        expect(last()).toMatch(/pk-row--off[^>]*>.*?takes both hands/s);
    });
});
