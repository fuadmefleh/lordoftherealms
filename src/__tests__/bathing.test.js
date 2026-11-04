// Bathing (player/core/needs.js bathe, the Bathe action): free in a river, a
// lake or the sea (cold out of summer), a copper or few at a village well or a
// town bathhouse; dirty clothes are scrubbed with you, so a bath always gets
// you properly clean.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { PlayerActions } from '../player/actions/index.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const actionsAt = (player, world) => PlayerActions.getAvailableActions(player, world.getTile(player.q, player.r), world);

describe('Bathe', () => {
    it('in town: the bathhouse (or a village well) is on the action list, and a bath gets you clean even in filthy clothes', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        player.needs.hygiene = 10;
        player.clothesFreshness = 5;
        expect(player.hygieneCap()).toBeLessThan(40);
        const act = actionsAt(player, world).find(a => a.type === 'bathe');
        expect(act).toBeTruthy();
        const place = player.bathePlace(world);
        const gold = player.gold;
        const res = player.bathe(world);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - place.cost);
        expect(res.clothes).toBeGreaterThan(0);
        expect(player.needs.hygiene).toBeGreaterThanOrEqual(60);
        expect(player.hygieneCap()).toBe(100);
    });

    it('in the wild: free in a river, cold in winter', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const river = world.tiles.flat().find(t => t.hasRiver && !t.settlement && t.terrain.passable);
        player.q = river.q; player.r = river.r;
        player.needs.hygiene = 20;
        player.needs.comfort = 80;
        world.season = 'Winter';
        const act = actionsAt(player, world).find(a => a.type === 'bathe');
        expect(act && act.label).toBe('Bathe in the river');
        const gold = player.gold;
        const res = player.bathe(world);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold);
        expect(res.gained).toBeGreaterThan(40);
        expect(res.cold).toBeLessThan(0);
        expect(player.needs.comfort).toBeLessThan(80);
    });

    it('no water, no bath; no coin, no bathhouse; clean already, not offered', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const dry = world.tiles.flat().find(t => t.terrain.passable && !t.settlement && !t.hasRiver
            && !player.washWaterHere.call({ ...player, q: t.q, r: t.r }, world));
        player.q = dry.q; player.r = dry.r;
        player.needs.hygiene = 20;
        expect(actionsAt(player, world).some(a => a.type === 'bathe')).toBe(false);
        expect(player.bathe(world).success).toBe(false);
        // (an inland town: on the coast or a river the bath is free)
        const home = world.getSettlementViews().find(s => s.type !== 'village'
            && player.bathePlace.call({ ...player, q: s.q, r: s.r, washWaterHere: player.washWaterHere }, world).kind === 'bathhouse');
        player.q = home.q; player.r = home.r;
        player.gold = 0;
        expect(player.bathe(world).success).toBe(false);
        player.gold = 50;
        player.needs.hygiene = 99;
        expect(actionsAt(player, world).some(a => a.type === 'bathe')).toBe(false);
    });
});
