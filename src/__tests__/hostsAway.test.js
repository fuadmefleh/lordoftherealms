// A realm's field hosts are drawn from its army, not raised on top of it: the
// men out in a war host (systems/realmWars.js, camped or marching), a relief
// host (systems/sieges.js), a pursuit (systems/harrying.js) or the wardens
// against a lair (systems/outlawLairs.js) are booked away from its army
// (kingdom.menAway, world/kingdom.js) at their live strength, so its
// recruiters fill the ranks only to the cap less them, and the fallen are
// never counted back.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Economy } from '../world/economy.js';
import { RealmWars } from '../systems/realmWars.js';
import { House } from '../systems/house.js';
import { Harrying } from '../systems/harrying.js';
import { Sieges } from '../systems/sieges.js';
import { OutlawLairs } from '../systems/outlawLairs.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function makeWorld(day = 50) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 12; q++) for (let r = 0; r < 12; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, treasury: 5000, territory: [], population: 5000 };
    const town = { name: 'Varrholt', q: 9, r: 9, kingdom: 'k1', population: 2000 };
    tiles.get('9,9').settlement = town;
    return {
        day, width: 12, kingdoms: [kingdom], units: [], events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [town],
    };
}

function makePlayer(world) {
    const player = { id: 'p1', name: 'Ash', lastName: 'Ashborne', gold: 5000, reputation: { k1: 0 }, properties: [], colonies: [] };
    House.initialize(player, world);
    const prop = { type: 'farm', level: 3, storage: 10 };
    world.getTile(7, 7).playerProperties = [prop];
    player.properties.push({ q: 7, r: 7, type: 'farm' });
    return player;
}

describe('war hosts against the player are booked away from their realm', () => {
    it('a host marching books its men; the fallen are not counted back; broken, the booking goes', () => {
        Utils.setSeed(3);
        const world = makeWorld();
        const player = makePlayer(world);
        const k = world.kingdoms[0];
        const war = RealmWars.declareWar(player, world, k);
        world.day += RealmWars.CONFIG.hostCadence;
        RealmWars.processDaily(player, world);
        const rec = war.hosts[0];
        expect(rec.strength).toBe(60);
        expect(Kingdom.menAway(k, world.day)).toBe(60);
        // Thirst and the road thin it: the booking follows its live strength
        rec.strength = 35;
        world.day += 1;
        RealmWars.processDaily(player, world);
        expect(Kingdom.menAway(k, world.day)).toBe(35);
        // Broken in the field: nothing away the next day
        const unit = world.units.find(u => u.id === rec.id);
        unit.destroyed = true;
        RealmWars.onHostDefeated(player, world, unit);
        world.day += 1;
        RealmWars.processDaily(player, world);
        expect(Kingdom.menAway(k, world.day)).toBe(0);
    });

    it('a realm with a host out recruits only to its cap less the host', () => {
        const g = newGame(301);
        const w = g.world;
        const k = w.kingdoms.find(x => x.isAlive !== false && Economy.realmTowns(x, w).length >= 2);
        KingdomAI.updateMilitary(k, w);
        const cap = k.militaryCap;
        expect(cap).toBeGreaterThan(200);
        const host = 160;
        k.military = Math.floor(cap * 0.5);
        const twin = { ...k, armoury: k.armoury ? { ...k.armoury, stock: { ...k.armoury.stock } } : undefined, menAway: {} };
        // (the host is on player.realmWars: booked by RealmWars.bookHosts, as processDaily does each day)
        const player = { realmWars: { wars: { [k.id]: { kingdomId: k.id, hosts: [{ id: 'h1', strength: host }] } } } };
        for (let d = 0; d < 400; d++) {
            RealmWars.bookHosts(player, w);
            KingdomAI.updateMilitary(k, w);
            KingdomAI.updateMilitary(twin, w);
        }
        expect(twin.military).toBeGreaterThan(cap * 0.97);
        expect(k.military + host).toBeLessThanOrEqual(cap + 1);
        expect(k.military + host).toBeGreaterThan(cap * 0.97);
    });

    it('a stale booking (the player gone, no one renewing it) lapses on its own', () => {
        const world = makeWorld();
        const k = world.kingdoms[0];
        RealmWars.bookHosts({ realmWars: { wars: { k1: { kingdomId: 'k1', hosts: [{ strength: 90 }] } } } }, world);
        expect(Kingdom.menAway(k, world.day + 1)).toBe(90);
        expect(Kingdom.menAway(k, world.day + 3)).toBe(0);
    });
});

describe('the other field hosts', () => {
    it('relief hosts, pursuits and wardens are booked under their own keys, cleared when they come home', () => {
        const world = makeWorld();
        const k = world.kingdoms[0];
        // A relief host marching on the player's siege
        const player = { sieges: { active: { relief: { kingdomId: 'k1', strength: 120 } } } };
        Sieges._bookRelief(world, player);
        expect(Kingdom.menAway(k, world.day)).toBe(120);
        // ...and a pursuit on the harriers' heels
        const st = { hosts: [{ kid: 'k1', strength: 70 }] };
        Harrying._bookHosts(world, st, world.day);
        expect(Kingdom.menAway(k, world.day)).toBe(190);
        // ...and wardens against a lair (strength in parties of menPer)
        const menPer = Math.max(1, Number((OutlawLairs.config().expedition || {}).menPer) || 5);
        OutlawLairs._bookWardens(world, { expeditions: [{ kingdomId: 'k1', strength: 10 }] });
        expect(Kingdom.menAway(k, world.day)).toBe(190 + 10 * menPer);
        // All home
        player.sieges.active.relief = null;
        Sieges._bookRelief(world, player);
        st.hosts = [];
        Harrying._bookHosts(world, st, world.day);
        OutlawLairs._bookWardens(world, { expeditions: [] });
        expect(Kingdom.menAway(k, world.day)).toBe(0);
        expect(Object.keys(k.menAway || {})).toHaveLength(0);
    });
});

describe('a realm that loses its capital keeps an army of the people it has left', () => {
    // (2026-11-25, seed 202 run 0: the home army "never refilled" at ~300-360 with 10-12 towns
    // for decades. Traced: a stronger neighbour took the capital, 5,300 of the realm's 8,300
    // people, in a ten-day war in year 4; its other towns were hamlets of 30-150. The cap is
    // the realm's people (KingdomAI.updateMilitary), the only men away were a guard of 10-48,
    // and the ranks stood at 85-97% of the cap all along: no stale booking, the same rule as
    // any AI realm's. What was wrong: the ranks never closed the last 1/regen men of the gap
    // (a share of it floored to no one) — 25-55 men, a tenth of a small realm's army.)
    it('the cap falls with the people lost and the ranks refill to it, less only the men away', () => {
        const game = newGame(202);
        const { world } = game;
        const k = world.kingdoms.filter(x => x.isAlive && x.capital)
            .sort((a, b) => world.getSettlementsOf(b.id).length - world.getSettlementsOf(a.id).length)[0];
        const foe = world.kingdoms.find(x => x.isAlive && x !== k);
        const settle = () => { KingdomAI.updateEconomy(k, world); KingdomAI.updateMilitary(k, world); };
        settle();
        const cap0 = k.militaryCap;
        expect(cap0).toBeGreaterThan(0);
        const seat = world.getTile(k.capital.q, k.capital.r).settlement;
        const share = seat.population / k.population;
        KingdomAI.takeTile(foe, k, world, k.capital.q, k.capital.r);
        KingdomAI.afterTownLoss(k, foe, world);
        // (the town taken is booked on the conqueror's record: the leagues against an overmighty realm read it)
        expect(KingdomAI.conquestsOf(foe, world, 360)).toBe(1);
        settle();
        // (the people went with the town, and the cap with them)
        expect(k.militaryCap).toBeLessThan(cap0 * (1 - share * 0.8));
        // the ranks refill to the new cap less a guard drawn out of them, and no further
        k.military = Math.floor(k.militaryCap * 0.3);
        for (let d = 0; d < 400; d++) {
            world.day++;
            Kingdom.setMenAway(k, 'guard', 20, world.day);
            KingdomAI.updateMilitary(k, world);
        }
        expect(k.military).toBeGreaterThanOrEqual(k.militaryCap - 20 - 2);
        expect(k.military).toBeLessThanOrEqual(k.militaryCap - 20);
    }, 120000);
});
