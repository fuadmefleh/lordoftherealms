/**
 * Built roads join the world's road network — systems/infrastructure.js.
 * A finished dirt/stone road becomes a real road hex (hasRoad + roadLinks),
 * so the map draws it with the same road sprites as the generated roads and
 * the transport network (segments between towns) takes it in.
 *
 *   A (2,5) town — built road (3..5,5) — B (6,5) town
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Transport } from '../world/transport.js';
import { Infrastructure } from '../systems/infrastructure.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const PLAINS = { id: 'plains', passable: true, moveCost: 2 };

function makeWorld() {
    const W = 12, H = 10;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: PLAINS, regionId: 1, kingdom: 'k1', elevation: 0.5, infrastructure: null });
        tiles.push(row);
    }
    const kingdom = { id: 'k1', name: 'Testland', isAlive: true, treasury: 5000, wars: [], finance: { debtRatio: 0, missed: 0 } };
    const mk = (name, q, r) => {
        const s = { name, q, r, type: 'town', population: 2000, kingdom: 'k1', economy: { tradeIncome: 0 } };
        tiles[r][q].settlement = s;
        return s;
    };
    const towns = [mk('Aston', 2, 5), mk('Brill', 6, 5)];
    const world = {
        width: W, height: H, day: 40, tiles, units: [], kingdoms: [kingdom], events: [],
        generationParams: { seed: 'built-roads' },
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            return tiles[r][((q % W) + W) % W];
        },
        getSettlementViews() { return towns; },
        getAllSettlements() { return towns; },
        getKingdom(id) { return id === 'k1' ? kingdom : null; },
    };
    return { world, towns };
}

function buildRoad(world, q, r) {
    const tile = world.getTile(q, r);
    const res = Infrastructure.build({ gold: 10000 }, 'DIRT_ROAD', tile, world);
    expect(res.success).toBe(true);
    return tile;
}

const linkedDirs = (tile) => [0, 1, 2, 3, 4, 5].filter(i => tile.roadLinks & (1 << i));

beforeEach(() => Transport.setEnabled(true));

describe('Built roads', () => {
    it('stay off the network while under construction', () => {
        const { world } = makeWorld();
        const tile = buildRoad(world, 3, 5);
        expect(tile.infrastructure.underConstruction).toBe(true);
        expect(tile.hasRoad).toBeFalsy();
    });

    it('become real road hexes linked to their neighbours when finished', () => {
        const { world } = makeWorld();
        const built = [3, 4, 5].map(q => buildRoad(world, q, 5));
        for (const t of built) Infrastructure.finishConstruction(world, t);

        for (const t of built) {
            expect(t.hasRoad).toBe(true);
            expect(t.builtRoad).toBe(true);
        }
        // The middle hex runs east and west (to the road on either side)
        const mid = world.getTile(4, 5);
        const dirs = linkedDirs(mid).map(i => Hex.neighbors(4, 5)[i]).map(n => `${n.q},${n.r}`).sort();
        expect(dirs).toEqual(['3,5', '5,5']);
        // The ends link into the towns
        const west = linkedDirs(world.getTile(3, 5)).map(i => Hex.neighbors(3, 5)[i]).map(n => `${n.q},${n.r}`);
        expect(west).toContain('2,5');
    });

    it('join the transport network: a segment now runs between the towns', () => {
        const { world, towns } = makeWorld();
        expect(Transport.segments(world).length).toBe(0);
        for (const q of [3, 4, 5]) Infrastructure.finishConstruction(world, buildRoad(world, q, 5));
        const segs = Transport.segments(world);
        expect(segs.length).toBe(1);
        const names = [segs[0].a.s.name, segs[0].b.s.name].sort();
        expect(names).toEqual(towns.map(t => t.name).sort());
        expect(world.getTile(4, 5).roadTier).toBeTruthy();
    });

    it('leave the network when demolished, generated roads untouched', () => {
        const { world } = makeWorld();
        world.getTile(4, 6).hasRoad = true; // a generated road hex beside the build
        world.getTile(4, 6).roadLinks = 0;
        for (const q of [3, 4, 5]) Infrastructure.finishConstruction(world, buildRoad(world, q, 5));
        const mid = world.getTile(4, 5);
        const toGen = Hex.directionTo(4, 6, 4, 5, world.width);
        expect(world.getTile(4, 6).roadLinks & (1 << toGen)).toBeTruthy();

        Infrastructure.demolish({ gold: 0 }, mid, world);
        expect(mid.hasRoad).toBe(false);
        expect(mid.builtRoad).toBeUndefined();
        expect(world.getTile(4, 6).hasRoad).toBe(true);
        expect(world.getTile(4, 6).roadLinks & (1 << toGen)).toBeFalsy();
        expect(Transport.segments(world).length).toBe(0);
    });

    it('are laid again after a load (the world regenerates without them)', () => {
        const { world } = makeWorld();
        for (const q of [3, 4, 5]) Infrastructure.finishConstruction(world, buildRoad(world, q, 5));
        // A load: the regenerated tiles have the saved infrastructure but no road
        for (const q of [3, 4, 5]) {
            const t = world.getTile(q, 5);
            delete t.hasRoad; delete t.roadLinks; delete t.builtRoad;
        }
        Infrastructure.restoreRoads(world);
        Transport.restore(null, world);
        for (const q of [3, 4, 5]) expect(world.getTile(q, 5).hasRoad).toBe(true);
        expect(Transport.segments(world).length).toBe(1);
    });
});
