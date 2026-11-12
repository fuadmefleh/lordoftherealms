// The day's last hours (player/autoUpkeep.js): points left at day's end go on
// the character's own upkeep — the most pressing need first, with what's to
// hand, at the real actions' costs; coin goes to the town that served.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { AutoUpkeep } from '../player/autoUpkeep.js';
import { Hospitality } from '../systems/hospitality.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const townOf = (world, player) => world.getTile(player.q, player.r).settlement;

function toWild(world, player, pred) {
    const t = world.tiles.flat().find(x => !x.settlement && x.terrain && x.terrain.passable && pred(x));
    player.q = t.q; player.r = t.r;
    return t;
}

describe('AutoUpkeep', () => {
    it("fun and social are seen to with the day's spare points: a pastime in the wilds, the locals and the street in town", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        Object.assign(player.needs, { hygiene: 90, energy: 90, comfort: 90, hunger: 90, social: 15, fun: 10 });
        player.clothesFreshness = 95;
        player.actionPoints = 4;
        const res = AutoUpkeep.run(player, world, { mode: 'full' });
        expect(res).toBeTruthy();
        const ids = res.steps.map(s => s.id);
        expect(ids.some(i => i === 'chat' || i === 'pastime')).toBe(true);
        expect(player.needs.social).toBeGreaterThan(15);
        expect(player.needs.fun).toBeGreaterThan(10);

        toWild(world, player, t => !t.river);
        Object.assign(player.needs, { social: 50, fun: 10 });
        player.actionPoints = 3;
        player._restTypeOverride = 'camp';
        const wild = AutoUpkeep.run(player, world, { mode: 'full' });
        expect(wild && wild.steps.some(s => s.id === 'pastime')).toBe(true);
        expect(player.needs.fun).toBeGreaterThan(10);
        // 'upkeep' leaves the leisure
        Object.assign(player.needs, { fun: 10 });
        player.actionPoints = 3;
        const up = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        expect(!up || !up.steps.some(s => s.id === 'pastime')).toBe(true);
    });

    it('in town with an empty pack: buys food at the market and eats, even with no points left', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        expect(townOf(world, player)).toBeTruthy();
        player.gold = 300;
        for (const k of Object.keys(player.inventory || {})) if ((player.constructor.FOOD_TYPES || []).includes(k)) player.inventory[k] = 0;
        expect(player.getFoodCount()).toBe(0);
        player.needs.hunger = 10;
        player.actionPoints = 0;
        const gold = player.gold;
        const res = AutoUpkeep.run(player, world, { mode: 'full' });
        expect(res, 'something was done').toBeTruthy();
        const ids = res.steps.map(s => s.id);
        expect(ids).toContain('market');
        expect(ids).toContain('eat');
        expect(player.needs.hunger).toBeGreaterThan(10);
        expect(player.getFoodCount()).toBeGreaterThan(0);
        expect(player.gold).toBeLessThan(gold);
        expect(gold - player.gold).toBeLessThanOrEqual(gold * AutoUpkeep.config().food.purseShare);
    });

    it('a pack with food in it buys nothing; the wilds have no market', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        player.gold = 300;
        player.inventory.bread = 10;
        player.needs.hunger = 90;
        player.actionPoints = 0;
        expect(AutoUpkeep._marketFood(player, world, world.getTile(player.q, player.r), AutoUpkeep.config())).toBeNull();
        player.inventory.bread = 0;
        const t = toWild(world, player, () => true);
        expect(AutoUpkeep._marketFood(player, world, t, AutoUpkeep.config())).toBeNull();
    });

    it('in town: a grimy, bored character bathes and passes the evening with the locals, the coin to the town', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const town = townOf(world, player);
        expect(town).toBeTruthy();
        player.gold = 200;
        player.needs.hygiene = 15;
        player.clothesFreshness = 10;
        player.needs.social = 20;
        player.needs.fun = 20;
        player.needs.energy = 90;
        player.needs.comfort = 90;
        player.needs.hunger = 90;
        player.actionPoints = 4;
        const purse = Economy.townPurse(town) || 0;
        const gold = player.gold;
        const res = AutoUpkeep.run(player, world, { mode: 'full' });
        expect(res).toBeTruthy();
        const ids = res.steps.map(s => s.id);
        expect(ids[0]).toBe('bathe');
        expect(ids).toContain('chat');
        expect(player.needs.hygiene).toBeGreaterThan(50);
        expect(player.getClothesFreshness()).toBeGreaterThan(55);
        expect(player.needs.social).toBeGreaterThan(20);
        expect(res.apSpent).toBeLessThanOrEqual(4);
        expect(player.actionPoints).toBe(4 - res.apSpent);
        expect(gold - player.gold).toBe(res.coinSpent);
        expect(res.coinSpent).toBeLessThanOrEqual(AutoUpkeep.config().coin.maxPerDay);
        // Every coin spent landed in the town's purse
        expect(Math.round(((Economy.townPurse(town) || 0) - purse) * 100) / 100).toBe(res.coinSpent);
        expect(res.text).toMatch(/^With the day's last hours you .+\.$/);
    });

    it("'upkeep' sees to the body but leaves the leisure; 'off', no points, or a cell do nothing", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        player.gold = 200;
        Object.assign(player.needs, { hygiene: 20, social: 10, fun: 10, energy: 90, comfort: 90, hunger: 90 });
        player.actionPoints = 6;
        const up = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        expect(up.steps.some(s => s.id === 'chat' || s.id === 'leisure')).toBe(false);
        expect(up.steps.some(s => s.id === 'bathe' || s.id === 'bath')).toBe(true);

        player.actionPoints = 6;
        expect(AutoUpkeep.run(player, world, { mode: 'off' })).toBeNull();
        player.actionPoints = 0;
        expect(AutoUpkeep.run(player, world, { mode: 'full' })).toBeNull();
        player.actionPoints = 6;
        player.jailState = { daysRemaining: 2 };
        expect(AutoUpkeep.run(player, world, { mode: 'full' })).toBeNull();
    });

    it('a contented character with points to spare does nothing in town', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        Object.assign(player.needs, { hygiene: 95, social: 95, fun: 95, energy: 95, comfort: 95, hunger: 95 });
        player.clothesFreshness = 100;
        player.actionPoints = 8;
        expect(AutoUpkeep.run(player, world, { mode: 'full' })).toBeNull();
        expect(player.actionPoints).toBe(8);
    });

    it('in the wild: washes the clothes at the river, bathes free in summer, makes camp', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        toWild(world, player, t => t.hasRiver);
        world.season = 'Summer';
        Object.assign(player.needs, { hygiene: 80, social: 90, fun: 90, energy: 90, comfort: 90, hunger: 90 });
        player.clothesFreshness = 30;
        player.actionPoints = 3;
        const gold = player.gold;
        const res = AutoUpkeep.run(player, world, { mode: 'full' });
        const ids = res.steps.map(s => s.id);
        // a bath (2 AP) scrubs the dirty clothes too, cheaper than the 3 AP wash
        expect(ids).toContain('bathe');
        expect(ids).toContain('camp');
        expect(player._restTypeOverride).toBe('camp');
        expect(player.getClothesFreshness()).toBeGreaterThan(55);
        expect(player.gold).toBe(gold);
        expect(res.text).toMatch(/river/);
    });

    it('a winter river is too cold for a bath unless filthy; the clothes still get washed', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        toWild(world, player, t => t.hasRiver);
        world.season = 'Winter';
        Object.assign(player.needs, { hygiene: 40, social: 90, fun: 90, energy: 90, comfort: 90, hunger: 90 });
        player.clothesFreshness = 40;
        player.actionPoints = 5;
        const res = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        const ids = res.steps.map(s => s.id);
        expect(ids).not.toContain('bathe');
        expect(ids).toContain('wash');
        expect(res.apSpent).toBe(AutoUpkeep._washAP());
    });

    it('eats from the pack when hungry, and sits by a fire with wood to burn', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        toWild(world, player, t => !t.hasRiver);
        Object.assign(player.needs, { hygiene: 90, social: 90, fun: 90, energy: 90, comfort: 20, hunger: 20 });
        player.clothesFreshness = 100;
        player.inventory = { ...(player.inventory || {}), bread: 2, wood: 3 };
        player.actionPoints = 2;
        const res = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        const ids = res.steps.map(s => s.id);
        expect(ids).toContain('eat');
        expect(ids).toContain('campfire');
        expect(player.inventory.wood).toBe(1);
        expect(player.needs.hunger).toBeGreaterThan(20);
        expect(player.actionPoints).toBe(0);
    });

    it('a tired traveller in town takes a private room within the evening budget, paid to the town', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        player.gold = 500;
        player.houses = [];
        const budget = AutoUpkeep.budget(player);
        // a town with an inn whose private room fits the evening's budget
        const tile = world.tiles.flat().find(t => t.settlement && Hospitality.listAt(world, player, t.q, t.r).some(v => {
            const q = Hospitality.quote(world, player, v.id);
            return q && q.tiers.some(x => x.id === 'private' && x.ok && x.price <= budget);
        }));
        expect(tile).toBeTruthy();
        player.q = tile.q; player.r = tile.r;
        Object.assign(player.needs, { hygiene: 90, social: 90, fun: 90, energy: 10, comfort: 20, hunger: 90 });
        player.clothesFreshness = 100;
        player.actionPoints = 2;
        if (!tile.settlement.economy) Economy.initSettlement(tile.settlement);
        const purse = Economy.townPurse(tile.settlement) || 0;
        const res = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        const room = res.steps.find(s => s.id === 'room');
        expect(room).toBeTruthy();
        expect(room.text).toMatch(/private room/);
        expect(player._restTypeOverride).toBe('inn');
        expect(room.cost).toBeGreaterThan(0);
        expect(room.cost).toBeLessThanOrEqual(budget);
        expect(Math.round(((Economy.townPurse(tile.settlement) || 0) - purse) * 100) / 100).toBe(res.coinSpent);
    });

    it('never spends past its share of a thin purse', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        player.gold = 12; // a fifth: 2g
        Object.assign(player.needs, { hygiene: 10, social: 10, fun: 10, energy: 10, comfort: 10, hunger: 90 });
        player.clothesFreshness = 10;
        player.actionPoints = 10;
        const res = AutoUpkeep.run(player, world, { mode: 'full' });
        expect(res ? res.coinSpent : 0).toBeLessThanOrEqual(2);
        expect(player.gold).toBeGreaterThanOrEqual(10);
    });

    it('in the headless day: same seed, same evenings (deterministic), off by default for the bot', () => {
        const play = (mode) => {
            const game = newGame(777, { terrainGen: 3 });
            if (mode) game.autoUpkeep = mode;
            const out = [];
            for (let d = 0; d < 4; d++) {
                game.player.needs.hygiene = 20;
                game.player.needs.fun = 20;
                game.player.actionPoints = 5;
                endDay(game);
                out.push(game.upkeep ? game.upkeep.text : null);
            }
            return { out, gold: game.player.gold, needs: { ...game.player.needs } };
        };
        const a = play('full');
        const b = play('full');
        expect(a).toEqual(b);
        expect(a.out.some(Boolean)).toBe(true);
        expect(play(null).out.every(x => x === null)).toBe(true);
    });
});
