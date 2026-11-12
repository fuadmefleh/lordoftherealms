// Standing orders (player/standingOrders.js): the day's spare points go on the
// order the player set — the real action at its real cost — and an order that
// can't run where the player stands says why and the character rests.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { TimeSkip } from '../ui/timeSkip.js';
import { Woodlands } from '../world/woodlands.js';
import { StandingOrders } from '../player/standingOrders.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Economy } from '../world/economy.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const tileOf = (world, p) => world.getTile(p.q, p.r);
const fresh = (player) => {
    player.actionPoints = 10;
    Object.assign(player.needs, { hunger: 90, energy: 90, hygiene: 90, comfort: 90, social: 90, fun: 90 });
    player.health = player.maxHealth || 100;
};
const FORAGE = ['forest', 'woodland', 'plains', 'grassland', 'hills'];
const nearWater = (world, t) => Hex.neighbors(t.q, t.r).some(n => {
    const nt = world.getTile(n.q, n.r);
    return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
});
function moveTo(world, player, pred) {
    const t = world.tiles.flat().find(x => x && x.terrain && x.terrain.passable && pred(x));
    expect(t, 'a tile to stand on').toBeTruthy();
    player.q = t.q; player.r = t.r;
    return t;
}

describe('StandingOrders', () => {
    it('rest is the default and does nothing', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        expect(StandingOrders.get(player)).toBe('rest');
        fresh(player);
        expect(StandingOrders.run(player, world)).toBeNull();
        expect(player.actionPoints).toBe(10);
        expect(StandingOrders.set(player, 'nonsense').ok).toBe(false);
    });

    it('work: a day of odd jobs in town, paid out of the town purse, at the job\'s AP and energy', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const town = tileOf(world, player).settlement;
        expect(town).toBeTruthy();
        fresh(player);
        StandingOrders.set(player, 'work');
        const gold = player.gold, purse = Economy.townPurse(town), jobs = player.jobsCompleted || 0, energy = player.needs.energy;
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().work.ap);
        expect(player.gold - gold).toBe(res.gold);
        expect(res.gold).toBeGreaterThan(0);
        if (purse != null) expect(Economy.townPurse(town)).toBeCloseTo(purse - res.gold, 5);
        expect(player.jobsCompleted).toBe(jobs + 1);
        expect(player.needs.energy).toBeLessThan(energy);
        expect(player.standingOrder.last).toMatchObject({ day: world.day, id: 'work', ran: true });
    });

    it("work: the job the player's trade knows comes first", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const village = { type: 'village', name: 'Testby' };
        PracticeSkills.gain(player, 'woodcutting', 50000);
        expect(PracticeSkills.level(player, 'woodcutting')).toBeGreaterThan(2);
        const job = StandingOrders.pickJob(player, world, village);
        expect(job && job.practice && job.practice.woodcutting).toBeTruthy();
    });

    it('work in the wilds can\'t run: says why and rests, no points spent', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        moveTo(world, player, t => !t.settlement);
        fresh(player);
        StandingOrders.set(player, 'work');
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(false);
        expect(res.why).toMatch(/no town/i);
        expect(res.text).toMatch(/rested/i);
        expect(player.actionPoints).toBe(10);
    });

    it('too few points left, or too worn out: rest', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        fresh(player);
        StandingOrders.set(player, 'work');
        player.actionPoints = 2;
        const short = StandingOrders.run(player, world);
        expect(short.ran).toBe(false);
        expect(short.why).toMatch(/AP/);
        fresh(player);
        player.needs.energy = 5;
        const worn = StandingOrders.run(player, world);
        expect(worn.ran).toBe(false);
        expect(player.actionPoints).toBe(10);
    });

    it('gather: forages in the wilds into the packs; fishes where there is water', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        moveTo(world, player, t => !t.settlement && FORAGE.includes(t.terrain.id));
        fresh(player);
        player.inventory.bread = 10; // food enough: forage first
        StandingOrders.set(player, 'gather');
        const trips = player.foragingTrips || 0;
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(player.foragingTrips).toBe(trips + 1);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().gather.forage.ap);

        moveTo(world, player, t => t.settlement && nearWater(world, t));
        fresh(player);
        const plan = StandingOrders.plan(player, world);
        expect(plan.ok).toBe(true);
        expect(plan.label).toMatch(/Fish/);
        const fish = StandingOrders.run(player, world);
        expect(fish.ran).toBe(true);
        expect(fish.text).toMatch(/fished/);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().gather.fish.ap);
    });

    it("train: the trainer's fee goes into the town's purse; a thin purse can't pay it", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const town = tileOf(world, player).settlement;
        Economy.initSettlement(town);
        fresh(player);
        player.gold = 300;
        StandingOrders.set(player, 'train');
        const fee = StandingOrders.trainFee(town);
        const purse = Economy.townPurse(town);
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(player.gold).toBe(300 - fee);
        expect(Economy.townPurse(town)).toBeCloseTo(purse + fee, 5);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().train.ap);

        fresh(player);
        player.gold = fee;
        const poor = StandingOrders.run(player, world);
        expect(poor.ran).toBe(false);
        expect(player.gold).toBe(fee);
    });

    it('drill: green companies gain experience and their kits wear; no soldiers, no drill', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        fresh(player);
        StandingOrders.set(player, 'drill');
        player.army = [];
        expect(StandingOrders.run(player, world).ran).toBe(false);
        player.army = [
            { type: 'militia', count: 10, level: 1, experience: 0, strength: 10, kit: { cond: 100 } },
            { type: 'knights', count: 5, level: 3, experience: 0, strength: 30 },
        ];
        fresh(player);
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(player.army[0].experience).toBe(StandingOrders.config().drill.xp);
        expect(player.army[1].experience).toBe(0); // past what drill teaches
        expect(player.army[0].kit.cond).toBeLessThan(100);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().drill.ap);
    });

    it('estates: stored goods into the packs; nothing held here, nothing to do', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const tile = moveTo(world, player, t => !t.settlement);
        fresh(player);
        StandingOrders.set(player, 'estates');
        expect(StandingOrders.run(player, world).ran).toBe(false);
        tile.playerProperty = { type: 'farm', produces: 'grain', storage: 6, level: 1 };
        const before = (player.inventory && player.inventory.grain) || 0;
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(player.inventory.grain).toBe(before + 6);
        expect(tile.playerProperty.storage).toBe(0);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().estates.ap);
        delete tile.playerProperty;
    });

    it('devotion: meditation through the devotion model', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        moveTo(world, player, t => !t.settlement && !t.holySite && !t.religiousBuilding);
        fresh(player);
        player.health = 50;
        StandingOrders.set(player, 'devotion');
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(res.text).toMatch(/meditated/);
        expect(player.health).toBeGreaterThanOrEqual(50);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().devotion.ap);
    });

    it('endOfDay: the needs first, then the order with what is left', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        fresh(player);
        player.needs.hunger = 10;
        player.inventory.bread = 5;
        StandingOrders.set(player, 'work');
        const res = StandingOrders.endOfDay(player, world, { upkeepMode: 'full' });
        expect(res.upkeep && res.upkeep.steps.some(s => s.id === 'eat')).toBe(true);
        expect(res.order && res.order.ran).toBe(true);
    });

    it('is deterministic for a seed', () => {
        const once = () => {
            const { world, player } = newGame(4242, { terrainGen: 3 });
            Utils.setSeed(99);
            fresh(player);
            StandingOrders.set(player, 'work');
            const a = StandingOrders.run(player, world);
            return [a.text, a.gold, player.gold];
        };
        expect(once()).toEqual(once());
    });

    it('fell: a tree a day, every swing tiring and teaching; a logging camp of yours gives more', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const FOREST = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
        const tile = moveTo(world, player, t => !t.settlement && FOREST.includes(t.terrain.id) && !t.playerProperty);
        fresh(player);
        StandingOrders.set(player, 'fell');
        const wood = player.inventory.wood || 0, xp = PracticeSkills.xp(player, 'woodcutting'), energy = player.needs.energy;
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        const plain = player.inventory.wood - wood;
        expect(plain).toBeGreaterThan(0);
        expect(PracticeSkills.xp(player, 'woodcutting')).toBeGreaterThan(xp);
        expect(player.needs.energy).toBeLessThan(energy);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().fell.ap);

        tile.playerProperty = { type: 'logging_camp', name: 'Logging Camp', level: 1 };
        fresh(player);
        expect(StandingOrders.plan(player, world).label).toMatch(/camp/i);
        const before = player.inventory.wood;
        const boosted = StandingOrders.run(player, world);
        expect(boosted.text).toMatch(/more from your/);
        expect(player.inventory.wood).toBeGreaterThan(before);
        delete tile.playerProperty;

        moveTo(world, player, t => t.settlement);
        fresh(player);
        expect(StandingOrders.run(player, world).ran).toBe(false);
    });

    it("fell: each tree is held back on the hex until it grows again; cut-over woods rest the order", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const FOREST = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
        const tile = moveTo(world, player, t => !t.settlement && FOREST.includes(t.terrain.id) && !t.playerProperty);
        const key = `${tile.q},${tile.r}`;
        const stock = Woodlands.stock(tile.terrain.id);
        expect(stock).toBeGreaterThan(0);
        fresh(player);
        StandingOrders.set(player, 'fell');
        expect(StandingOrders.run(player, world).ran).toBe(true);
        expect(Woodlands.standing(world, tile.q, tile.r, tile.terrain.id)).toBe(stock - 1);
        const rec = world.felled[key]['order:0'];
        expect(rec).toMatchObject({ day: world.day, by: 'order' });
        expect(rec.stump).toBeTruthy();
        // the hand's and the town's fellings count too: fill the hex to the last tree
        for (let i = 0; i < stock - 1; i++) world.felled[key][`${i},0`] = { tree: 'tp_tree_oak2', stump: 'tp_stump_oak2', day: world.day };
        fresh(player);
        const out = StandingOrders.run(player, world);
        expect(out.ran).toBe(false);
        expect(out.why).toMatch(/cut over/);
        expect(player.actionPoints).toBe(10);
        // a year on (treeDays) they stand again, at the inner map's pace
        world.day += Woodlands.config().treeDays;
        fresh(player);
        expect(StandingOrders.run(player, world).ran).toBe(true);
        expect(Object.keys(world.felled[key]).filter(k => k.startsWith('order:'))).toHaveLength(1); // the old one let go
    });

    it("one blow formula for the map's swings and the order (world/woodlands.js)", () => {
        expect(Woodlands.blowDamage({ strength: 5, luck: 5 }, null)).toBeCloseTo(20.5, 5);
        expect(Woodlands.blowDamage({ strength: 5, luck: 5 }, { resistance: 50 })).toBeCloseTo(10.25, 5);
        expect(Woodlands.isSpot('3,4')).toBe(true);
        expect(Woodlands.isSpot('order:0')).toBe(false);
    });

    it('hunt: needs a bow and arrows; with them, arrows are loosed at the quarry', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        moveTo(world, player, t => !t.settlement && ['forest', 'woodland', 'plains', 'grassland'].includes(t.terrain.id));
        fresh(player);
        StandingOrders.set(player, 'hunt');
        delete player.inventory.bow; delete player.inventory.crossbow;
        const none = StandingOrders.run(player, world);
        expect(none.ran).toBe(false);
        expect(player.actionPoints).toBe(10);
        player.inventory.bow = 1;
        player.inventory.arrows = 20;
        fresh(player);
        const res = StandingOrders.run(player, world);
        expect(res.ran).toBe(true);
        expect(res.text).toMatch(/loosed/);
        expect(player.inventory.arrows || 0).toBeLessThan(20 + 1);
        expect(player.actionPoints).toBe(10 - StandingOrders.config().hunt.ap);
    });

    it("the hand-run Combat Training's fee goes to the town too (payTrainer)", () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const town = tileOf(world, player).settlement;
        Economy.initSettlement(town);
        player.gold = 200;
        const purse = Economy.townPurse(town);
        const r = StandingOrders.payTrainer(player, town);
        expect(r.ok).toBe(true);
        expect(player.gold).toBe(200 - r.fee);
        expect(Economy.townPurse(town)).toBeCloseTo(purse + r.fee, 5);
        player.gold = 1;
        expect(StandingOrders.payTrainer(player, town).ok).toBe(false);
        expect(player.gold).toBe(1);
    });

    it('a wait carries the order out each day and tallies it for the digest', async () => {
        const g = newGame(4242, { terrainGen: 3 });
        g.isProcessingTurn = false;
        g.ui = { showNotification() {}, _logNotification() {} };
        g.player.needs = { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, comfort: 100 };
        g.player.inventory = { ...(g.player.inventory || {}), bread: 30 };
        g.world.units = (g.world.units || []).filter(u => !['raider', 'pirate', 'beast', 'monster', 'war_host'].includes(u.type) && !u.hostile);
        StandingOrders.set(g.player, 'work');
        const jobs = g.player.jobsCompleted || 0;
        const skip = await TimeSkip.run(g, 3, { runDay: (game) => !(endDay(game) || {}).died, yieldFn: () => Promise.resolve() });
        expect(skip.done).toBeGreaterThan(0);
        expect(skip.orders.ran + skip.orders.rested).toBe(skip.done);
        expect(g.player.jobsCompleted - jobs).toBe(skip.orders.ran);
        expect(skip.orders.lines.length).toBeGreaterThan(0);
    });

    it('survives a save and load', () => {
        const p = new Player();
        StandingOrders.set(p, 'gather');
        p.standingOrder.last = { day: 12, id: 'gather', ran: true, text: 'x', gold: 0, ap: 3 };
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(StandingOrders.get(back)).toBe('gather');
        expect(back.standingOrder.last.day).toBe(12);
    });
});
