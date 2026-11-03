// Clothes (player/core/needs.js): they wear every day and soil as you get
// dirty, and dirty clothes cap hygiene, so a bath alone can't make you clean
// in a shirt worn for a fortnight. Washed by the laundry at an inn (or a
// valet), or by hand at a river, the shore or a town well.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SaveLoad } from '../systems/saveLoad.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

describe('clothes', () => {
    it('start fresh and leave hygiene uncapped', () => {
        const { player } = newGame(61);
        expect(player.clothesState()).toMatchObject({ freshness: 100, label: 'Fresh', capped: false, smelly: false });
        expect(player.hygieneCap()).toBe(100);
    }, 60000);

    it('take about three days to go from fresh to smelly', () => {
        const { player } = newGame(65);
        player.decayNeedsForDay();
        expect(player.clothesState()).toMatchObject({ capped: false, smelly: false }); // a day: still fine
        player.decayNeedsForDay();
        expect(player.clothesState().smelly).toBe(false);
        player.decayNeedsForDay();
        player.modifyNeed('hygiene', -5); // a little work on the third day
        expect(player.clothesState().smelly).toBe(true);
    }, 60000);

    it('go smelly after days unwashed, and then a bath cannot get you clean', () => {
        const { player, world } = newGame(62);
        for (let d = 0; d < 10; d++) player.decayNeedsForDay();
        const cs = player.clothesState();
        expect(cs.smelly).toBe(true);
        expect(cs.cap).toBeLessThan(50);
        player.modifyNeed('hygiene', 100); // the best bath in the realm
        expect(player.needs.hygiene).toBe(cs.cap);
        // People notice: a point of charisma lost
        player.valet = null;
        const smelly = PlayerEffects.moodCharisma(player);
        player.washClothes(100);
        expect(PlayerEffects.moodCharisma(player)).toBe(smelly + 1);
        // Washed, the same bath works
        player.modifyNeed('hygiene', 100);
        expect(player.needs.hygiene).toBe(100);
        expect(world).toBeTruthy();
    }, 60000);

    it('soil faster with dirty work than with idle days', () => {
        const a = newGame(63).player;
        const b = newGame(63).player;
        a.decayNeedsForDay();
        b.decayNeedsForDay();
        b.modifyNeed('hygiene', -10); // a day's hunting
        expect(b.getClothesFreshness()).toBeLessThan(a.getClothesFreshness());
    }, 60000);

    it('are washed by hand at water, offered as an action, and kept in a save', () => {
        const game = newGame(64);
        const { player, world } = game;
        player.clothesFreshness = 10;
        // Find a land tile with water to wash in, and one without
        let wet = null;
        let dry = null;
        for (let r = 0; r < world.height && !(wet && dry); r++) {
            for (let q = 0; q < world.width && !(wet && dry); q++) {
                const t = world.getTile(q, r);
                if (!t || !t.terrain.passable) continue;
                player.q = q; player.r = r;
                if (player.washWaterHere(world)) wet = wet || { q, r };
                else dry = dry || { q, r };
            }
        }
        expect(wet).toBeTruthy();
        const offered = (at) => {
            player.q = at.q; player.r = at.r;
            const acts = [];
            addWildernessActions(acts, player, { ...world.getTile(at.q, at.r), q: at.q, r: at.r }, world);
            return acts.some(a => a.type === 'wash_clothes');
        };
        if (dry) {
            expect(offered(dry)).toBe(false);
            expect(player.washClothesByHand(world).success).toBe(false);
        }
        expect(offered(wet)).toBe(true);
        game.ui = { showNotification: vi.fn(), updateStats: vi.fn(), showCustomPanel: vi.fn() };
        ActionMenu.doWashClothes(game);
        expect(player.getClothesFreshness()).toBe(80);
        expect(player.clothesState().capped).toBe(false);
        expect(offered(wet)).toBe(false); // clean enough: nothing to scrub
        expect(SaveLoad.serializePlayer(player).clothesFreshness).toBe(80);
    }, 60000);
});
