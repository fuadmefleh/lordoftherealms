// Three ways a life ended for no good reason (the stranger-lives probe):
//   - a starving traveller's day shrank to a point or two against hexes of 7–15,
//     so they could never cross a hill to reach bread (data/travel.json weakFloor);
//   - an heir took up the mantle where the late ruler starved in the wild, with
//     the same empty packs (player/heirArrival.js);
//   - a town short of bread stayed bare while its neighbours sat on stores just
//     under their usual reserve (world/settlementMarket.js flows, trade.foodKeep).
import { describe, it, expect, beforeAll } from 'vitest';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { HeirArrival } from '../player/heirArrival.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let kidN = 0;
function kid(extra = {}) {
    const c = {
        id: `heir_${kidN++}`, firstName: 'Ada', dynasty: 'Harness', gender: 'female', age: 24, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    c.upbringing.comeOfAge = true;
    return c;
}

/** A wild hex (no settlement) a few hexes from the player's town. */
function wildNear(world, q0, r0) {
    for (let d = 3; d < 12; d++) {
        for (let q = q0 - d; q <= q0 + d; q++) {
            for (const r of [r0 - d, r0 + d]) {
                if (r < 0 || r >= world.height) continue;
                const t = world.getTile(Hex.wrapQ(q, world.width), r);
                if (t && !t.settlement && !(t.terrain && /water|ocean|sea|lake/.test(t.terrain.id))) return { q: Hex.wrapQ(q, world.width), r };
            }
        }
    }
    return null;
}

describe('a starving day still goes somewhere', () => {
    it('floors the day at weakFloor of the full day, and travelEstimate reads it', () => {
        const { player, world } = newGame(4242);
        player.inventory = {};
        player.starvationDays = 9;
        if (player.needs) player.needs.hunger = 0;
        player.health = player.maxHealth;
        player.endDay(world);
        const floor = Math.max(1, Math.round(player._dayPace * DataLoader._gamedata.travel.weakFloor));
        expect(floor).toBeGreaterThan(1);
        expect(player.movementRemaining).toBeGreaterThanOrEqual(floor);
        expect(player._dayMovement).toBeGreaterThanOrEqual(floor);
        // A hill of 1½ days at half a day's walk a day: three days, not fifteen
        const hill = 1.5 * player._dayPace;
        expect(Math.ceil(hill / player._fullDayMovement())).toBeLessThanOrEqual(3);
    });

    it('leaves jail and servitude at a standstill', () => {
        const { player, world } = newGame(4243);
        player.jailState = { days: 3 };
        player.starvationDays = 5;
        player.endDay(world);
        expect(player.movementRemaining).toBe(0);
    });
});

describe('an heir takes up the mantle at home, fed', () => {
    it('comes to the nearest friendly town from a death in the wild, with food bought with their own coin', () => {
        const game = newGame(5151);
        const { player, world } = game;
        const wild = wildNear(world, player.q, player.r);
        expect(wild).toBeTruthy();
        player.q = wild.q; player.r = wild.r;
        player.inventory = {};
        player.gold = 500;
        const heir = kid();
        player.children = [heir];
        const res = Relationships.succeedAsHeir(player, heir.id, world, { cause: 'starvation' });
        expect(res.success).toBe(true);
        expect(res.arrival && res.arrival.moved).toBe(true);
        const t = world.getTile(player.q, player.r);
        expect(t && t.settlement).toBeTruthy();
        expect(res.arrival.why).toBe('town');
        // Food of their own: bought at the stalls (the coin to the town, the food out of its store)
        if (res.arrival.bought > 0) {
            expect(player.getFoodCount()).toBeGreaterThanOrEqual(res.arrival.bought);
            expect(res.arrival.spent).toBeGreaterThan(0);
        }
    }, 60000);

    it('goes to the House home before any town, and an abdication hands over in place', () => {
        const { player, world } = newGame(5152);
        const home = { q: player.q, r: player.r };
        player.houses = [{ q: home.q, r: home.r, typeId: 'cottage', settlementName: 'Home' }];
        const wild = wildNear(world, player.q, player.r);
        player.q = wild.q; player.r = wild.r;
        const at = HeirArrival.place(player, world, {});
        expect(at).toMatchObject({ q: home.q, r: home.r, why: 'home' });
        const heir = kid();
        player.children = [heir];
        const res = Relationships.succeedAsHeir(player, heir.id, world, { arrive: false });
        expect(res.arrival).toBe(null);
        expect([player.q, player.r]).toEqual([wild.q, wild.r]);
    }, 60000);

    it('stays aboard ship', () => {
        const { player, world } = newGame(5153);
        player.boardedShip = 'ship_1';
        const q = player.q, r = player.r;
        const out = HeirArrival.arrive(player, world, {});
        expect(out.moved).toBe(false);
        expect([player.q, player.r]).toEqual([q, r]);
    }, 60000);
});

describe('food is drawn into a dearth', () => {
    function town(name, pop, q) {
        const s = { name, type: 'town', population: pop, q, r: 0, economy: { gold: 100000 } };
        SettlementMarket.ensure(s);
        return s;
    }
    it('a neighbour below its usual reserve still sells bread to a bare town, but keeps foodKeep', () => {
        const a = town('Plenty', 2000, 0);
        const b = town('Want', 2000, 3);
        const tgt = SettlementMarket.target(a, 'bread');
        a.market.stock.bread = tgt * 0.7; // under keepDays (0.8): no surplus as the old reserve had it
        b.market.stock.bread = 0;
        const C = SettlementMarket.config();
        for (const id of C.goodIds) if (id !== 'bread') { a.market.stock[id] = SettlementMarket.target(a, id); b.market.stock[id] = SettlementMarket.target(b, id); }
        const link = { a, b, friction: 0.1, capacity: 5000, factor: 1, rate: 1, keep: 1 };
        const bases = {};
        for (const id of C.goodIds) bases[id] = 10;
        let moved = 0;
        for (let d = 0; d < 30; d++) moved += SettlementMarket.flows([link], bases, null).moved;
        expect(SettlementMarket.stock(b, 'bread')).toBeGreaterThan(0);
        expect(moved).toBeGreaterThan(0);
        expect(SettlementMarket.stock(a, 'bread')).toBeGreaterThanOrEqual(tgt * C.trade.foodKeep - 0.01);
    });
});
