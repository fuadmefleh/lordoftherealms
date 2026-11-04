// What shipwrights know (world/shipcraft.js, systems/ships.js): a shipyard
// builds what its realm's shipwrights know, plus what the player has
// researched. Ordinary realms know the era's craft; at the Dawn of Man
// nobody knows more than a rowboat, and the dawn's realms learn with the years.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Ships } from '../systems/ships.js';
import { Shipcraft } from '../world/shipcraft.js';
import { Dawn } from '../world/dawn.js';
import { KingdomNavy } from '../world/kingdomNavy.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const type = (id) => Ships.getShipType(id);

describe('shipcraft', () => {
    it('an ordinary world: the shipwrights know the era\'s craft — every ship can be built', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const s = world.getSettlementViews().find(x => x.kingdom);
        for (const st of Ships._getShipTypes()) expect(Ships.canBuild(player, world, s, st).ok, st.id).toBe(true);
    });

    it('year 1 at the dawn: a rowboat and nothing more, however much gold you have', () => {
        const { world, player } = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        // a village to stand in
        const res = Dawn.settleWithPlayer(world, player);
        const tile = res.success ? world.getTile(player.q, player.r) : world.getTile(world.getSettlementViews()[0]?.q, world.getSettlementViews()[0]?.r);
        const s = res.success ? tile.settlement : null;
        expect(s).toBeTruthy();
        player.gold = 1e6;
        expect(Ships.canBuild(player, world, s, type('rowboat')).ok).toBe(true);
        for (const id of ['fishing_vessel', 'sloop', 'cog', 'caravel', 'war_galley', 'galleon']) {
            const c = Ships.canBuild(player, world, s, type(id));
            expect(c.ok, id).toBe(false);
            expect(c.missing).toContain('shipbuilding');
        }
        const r = Ships.commissionShip(player, tile.q, tile.r, 'galleon', 'Folly', [], world);
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/don't know how/);
        expect(player.gold).toBe(1e6);
        // used hulls for sale: only what the shipwrights know
        for (const u of Ships.getUsedShipsForSale(tile, world)) expect(u.typeId).toBe('rowboat');
        // the player who researched Shipbuilding can teach them the sloop — not the galleon
        player.technology = player.technology || {};
        player.technology.researched = ['shipbuilding'];
        expect(Ships.canBuild(player, world, s, type('sloop')).ok).toBe(true);
        expect(Ships.canBuild(player, world, s, type('galleon')).missing).toEqual(['navigation', 'naval_warfare']);
    });

    it('a dawn realm learns its craft with the years, and builds a fleet only once it can', () => {
        const k = { id: 'k', name: 'Chiefdom', isAlive: true, foundedDay: 1, capital: { q: 0, r: 0 } };
        Shipcraft.beginRealm(k);
        const world = { day: 1, kingdoms: [k] };
        expect(KingdomNavy.portCap(k, [{ q: 0, r: 0 }])).toBe(0);
        world.day = 1 + 120 * 3; Shipcraft.yearly(world);
        expect(k.shipcraft).toEqual([]);
        world.day = 1 + 120 * 4; const l = Shipcraft.yearly(world);
        expect(k.shipcraft).toEqual(['shipbuilding']);
        expect(l.length).toBe(1);
        const half = KingdomNavy.portCap(k, [{ q: 0, r: 0 }]);
        expect(half).toBeGreaterThan(0);
        world.day = 1 + 120 * 40; Shipcraft.yearly(world);
        expect(k.shipcraft).toEqual(Shipcraft.full());
        expect(KingdomNavy.portCap(k, [{ q: 0, r: 0 }])).toBeGreaterThan(half);
    });
});
