// The town after dark on the street map: the curfew on the map
// (world/innerMap/nightWatch.js) and the night's scenes
// (ui/actionMenu/nightScenes.js over systems/nightStreets.js).

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

let InnerMap, NightStreets, sceneHandler, InnerMapNight, Underworld;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ NightStreets } = await import('../systems/nightStreets.js'));
    ({ Underworld } = await import('../systems/underworld.js'));
    await import('../ui/actionMenu.js');
    ({ sceneHandler } = await import('../ui/actionMenu/choiceScenes.js'));
    ({ InnerMapNight } = await import('../ui/innerMapNight.js'));
});

beforeEach(() => Utils.setSeed(7));
afterEach(() => { InnerMap._curfew = null; InnerMap.active = false; });

function world() {
    const s = { name: 'Azur', type: 'city', population: 6000, kingdom: 'k1', economy: { gold: 9000 }, q: 0, r: 0, ordinances: { curfew: 'curfew' } };
    const k = { id: 'k1', name: 'Kingdom of Azurath', laws: { curfew: 'none' }, treasury: 1000 };
    const tile = { q: 0, r: 0, settlement: s, terrain: { id: 'plains' } };
    return { day: 40, generationParams: { seed: 3 }, getTile: (q, r) => (q === 0 && r === 0 ? tile : null), getKingdom: () => k, kingdoms: [k], getSettlementViews: () => [s] };
}

describe('the curfew on the street map', () => {
    it('from the bell, townsfolk go home and stay in; more of the watch turns out', () => {
        InnerMap.active = true;
        InnerMap._curfew = { from: 21, to: 5, extraWatch: 0.5, patrol: 0.8 };
        InnerMap.timeOfDay = 22;
        expect(InnerMap._curfewNow()).toBe(true);
        const home = { q: 5, r: 5, type: 'house' };
        const folk = { id: 3, type: 'villager', _home: home };
        expect(InnerMap._curfewSendsHome(folk)).toBe(true);
        expect(InnerMap._curfewSendsHome({ ...folk, _nightFolk: true })).toBe(false);
        expect(InnerMap._curfewSendsHome({ ...folk, type: 'guard' })).toBe(false);
        expect(InnerMap._curfewStay({ ...folk, _insideBuildingQ: 5, _insideBuildingR: 5 })).toBeGreaterThan(0);
        // about half of the day watch keeps the night too
        let out = 0;
        for (let id = 0; id < 100; id++) if (InnerMap._curfewWatch({ id, type: 'guard' }, 'night')) out++;
        expect(out).toBeGreaterThan(30);
        expect(out).toBeLessThan(70);
        expect(InnerMap._curfewPostShare(0.55)).toBeCloseTo(0.2, 5);
        InnerMap.timeOfDay = 12;
        expect(InnerMap._curfewNow()).toBe(false);
        expect(InnerMap._curfewSendsHome(folk)).toBe(false);
        expect(InnerMap._curfewPostShare(0.55)).toBe(0.55);
    });
});

describe('the night\'s scenes', () => {
    it('the curfew challenge shows the choices and settles a walk-off with the fine', () => {
        const w = world();
        const game = { world: w, player: { gold: 300, inventory: {}, actionPoints: 5 }, ui: { showNotification() {}, hideCustomPanel() {}, updateStats() {} } };
        const h = sceneHandler('curfew_challenge');
        expect(h).toBeTruthy();
        const st = { npcId: -1, guardName: 'Wat', q: 0, r: 0, lit: true };
        const v = h.view(game, st);
        expect(v.options.map(o => o.id)).toEqual(['talk', 'bribe', 'flee', 'submit']);
        expect(v.text).toMatch(/Wat/);
        const out = h.abandon(game, st);
        expect(out.notification.body).toMatch(/fine/i);
        expect(game.player.gold).toBeLessThan(300);
    });

    it('the night market turns a stranger away and lets a contact trade', () => {
        const w = world();
        const game = { world: w, player: { gold: 300, inventory: {}, actionPoints: 5 }, ui: {} };
        const h = sceneHandler('night_market');
        InnerMap.timeOfDay = 23;
        const st = { q: 0, r: 0, where: 'the tannery', fence: 'Old Mags' };
        expect(h.view(game, st).options.map(o => o.id)).toEqual(['leave']);
        Underworld.ensure(game.player).guild.contactMet = true;
        const v = h.view(game, st);
        expect(v.text).toMatch(/tannery/);
        expect(v.options[v.options.length - 1].id).toBe('leave');
    });

    it('the L key\'s toggle shutters and lights the lantern', () => {
        const game = { player: { inventory: {} }, ui: { showNotification() {} } };
        InnerMapNight.toggleLight(game);
        expect(NightStreets.lit(game.player)).toBe(false);
        InnerMapNight.toggleLight(game);
        expect(NightStreets.lit(game.player)).toBe(true);
    });
});
