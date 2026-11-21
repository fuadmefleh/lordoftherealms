/**
 * Wicker fish traps set in the edge water and checked later (systems/fishTraps.js;
 * on the street map ui/innerMapFishTraps.js): where one may go (the edge water
 * by a bank — not out deep, not on land, ice or a ford), the catch hour by hour
 * (by the season, the hour, a river's current and bait; none under ice; a full
 * trap takes no more), hauled into the packs, kept in the save, and robbed by a
 * poacher whose fish go to his town's market (or seen off on the map).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let DataLoader, FishTraps, SettlementMarket;

beforeAll(async () => {
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ FishTraps } = await import('../systems/fishTraps.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
}, 120000);

let baseCfg;
const cfg = (over = {}) => {
    DataLoader._gamedata.fishTraps = { ...baseCfg, poach: { ...baseCfg.poach, chance: 0 }, otter: { ...baseCfg.otter, chance: 0 }, wearPerDay: 0, ...over };
};
beforeEach(() => {
    if (!baseCfg) baseCfg = DataLoader._gamedata.fishTraps;
    cfg();
});

// A street map: dry bank (x < 3), the shallows (x = 3), the river (x 4..11, its
// current from x = 6), a ford at (8, 0) and ice at (4, 9)
function streetTiles() {
    const tiles = [];
    for (let y = 0; y < 10; y++) {
        const row = [];
        for (let x = 0; x < 12; x++) {
            if (x < 3) row.push({ subTerrain: { id: 'grass', passable: true } });
            else if (x === 3) row.push({ _wet: true, _shallow: true, _waterKind: 'river', subTerrain: { id: 'grass', passable: true } });
            else {
                const t = { _wet: true, _waterKind: 'river', subTerrain: { id: 'river_water', passable: false } };
                if (x >= 6) t._flow = { x: 0, y: 1 };
                row.push(t);
            }
        }
        tiles.push(row);
    }
    tiles[0][8]._ford = true;
    tiles[9][4].subTerrain = { id: 'frozen_river_water', passable: true, frozen: true };
    return tiles;
}

function makeWorld(extra = {}) {
    const hexes = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!hexes.has(k)) hexes.set(k, { q, r, terrain: { id: 'grassland', passable: true } });
        return hexes.get(k);
    };
    return { day: 40, generationParams: { seed: 77 }, getTile: (q, r) => at(q, r), ...extra };
}

const player = (inv = {}) => ({ inventory: { fish_trap: 2, bread: 2, reeds: 3, ...inv }, gold: 0, q: 0, r: 0 });
const SUMMER = 40 * 24;        // day 40: summer (days 31-60)
const WINTER = 100 * 24;       // day 100: winter (days 91-120)

describe('where a trap goes', () => {
    it('in the edge water by a bank: the shallows, or the water a cell off dry land', () => {
        const tiles = streetTiles();
        const shallow = FishTraps.spotAt(tiles, 3, 4);
        expect(shallow.ok).toBe(true);
        expect(shallow.water).toBe('river');
        // the first cell of open water past the shallows; the next is too far out
        expect(FishTraps.spotAt(tiles, 4, 4).ok).toBe(true);
        expect(FishTraps.spotAt(tiles, 5, 4).ok).toBe(false);
        DataLoader._gamedata.fishTraps = { ...DataLoader._gamedata.fishTraps, bankReach: 2 };
        expect(FishTraps.spotAt(tiles, 5, 4).ok).toBe(true);
        cfg();
    });

    it('not out deep, not on land, not on ice or a ford; kept apart', () => {
        const tiles = streetTiles();
        expect(FishTraps.spotAt(tiles, 9, 4).ok).toBe(false);
        expect(FishTraps.spotAt(tiles, 9, 4).why).toMatch(/too far out/);
        expect(FishTraps.spotAt(tiles, 1, 4).why).toBe('not in water');
        expect(FishTraps.spotAt(tiles, 4, 9).why).toMatch(/frozen/);
        tiles[0][3]._ford = true;
        expect(FishTraps.spotAt(tiles, 3, 0).ok).toBe(false);
        expect(FishTraps.spotAt(tiles, 3, 5, { traps: [{ x: 3, y: 4 }] }).why).toMatch(/too close/);
        expect(FishTraps.spotAt(tiles, 3, 7, { traps: [{ x: 3, y: 4 }] }).ok).toBe(true);
    });

    it('a river edge by the current runs with it', () => {
        const tiles = streetTiles();
        // (the shallows by the bank at x = 3 lie off the current at x >= 6)
        expect(FishTraps.spotAt(tiles, 3, 4).current).toBe(false);
        // a bank on the far side, by the current
        tiles[4][7] = { subTerrain: { id: 'grass', passable: true } };
        const s = FishTraps.spotAt(tiles, 6, 4);
        expect(s.ok).toBe(true);
        expect(s.current).toBe(true);
    });

    it('set from the packs; none without one; perHex at most', () => {
        const world = makeWorld();
        const tiles = streetTiles();
        const p = player();
        expect(FishTraps.lay(world, { inventory: {} }, 5, 5, 3, 1, FishTraps.spotAt(tiles, 3, 1), SUMMER).ok).toBe(false);
        const res = FishTraps.lay(world, p, 5, 5, 3, 1, FishTraps.spotAt(tiles, 3, 1), SUMMER);
        expect(res.ok).toBe(true);
        expect(p.inventory.fish_trap).toBe(1);
        expect(FishTraps.lay(world, p, 5, 5, 3, 2, FishTraps.spotAt(tiles, 3, 2), SUMMER).reason).toMatch(/Too close/);
        expect(FishTraps.lay(world, p, 5, 5, 1, 2, FishTraps.spotAt(tiles, 1, 2), SUMMER).ok).toBe(false);
        expect(FishTraps.at(world, 5, 5).length).toBe(1);
    });
});

/** One trap set at `hour`, run `hours` on → the trap */
function runTrap(world, spot, hour, hours, opts = {}) {
    const p = player();
    const trap = FishTraps.lay(world, p, opts.q || 5, opts.r || 5, 3, 4, spot, hour).trap;
    if (opts.bait) FishTraps.bait(world, p, trap.id, 'bread', hour);
    FishTraps.settle(world, trap, hour + hours, opts.ctx || {});
    return trap;
}

describe('the catch, hour by hour', () => {
    const river = { ok: true, water: 'river', current: false };

    it('deterministic: the same world and hours, the same fish', () => {
        const a = runTrap(makeWorld(), river, SUMMER, 72);
        const b = runTrap(makeWorld(), river, SUMMER, 72);
        expect(a.catch).toEqual(b.catch);
        expect(FishTraps.count(a)).toBeGreaterThan(0);
        // the divers' fish of a river, as goods that exist
        const goods = DataLoader._gamedata.playerEconomy.GOODS;
        for (const e of a.catch) expect(goods[e.itemId.toUpperCase()]).toBeTruthy();
    });

    it('more at dawn and dusk; more in a current; more baited; few in winter', () => {
        const world = makeWorld();
        const t = { id: 'x', water: 'river', current: false, bait: null };
        const noon = SUMMER + 12, dawn = SUMMER + 5, dusk = SUMMER + 18;
        expect(FishTraps.chanceAt(world, t, dawn)).toBeGreaterThan(FishTraps.chanceAt(world, t, noon));
        expect(FishTraps.chanceAt(world, t, dusk)).toBeGreaterThan(FishTraps.chanceAt(world, t, noon));
        expect(FishTraps.chanceAt(world, { ...t, current: true }, noon)).toBeGreaterThan(FishTraps.chanceAt(world, t, noon));
        expect(FishTraps.chanceAt(world, { ...t, bait: { item: 'bread', until: noon + 5 } }, noon)).toBeGreaterThan(FishTraps.chanceAt(world, t, noon));
        expect(FishTraps.chanceAt(world, t, WINTER + 12)).toBeLessThan(FishTraps.chanceAt(world, t, noon) * 0.5);
        // over many traps the summer takes far more than the winter
        cfg({ cap: 999 });
        let summer = 0, winter = 0;
        for (let i = 0; i < 20; i++) {
            summer += FishTraps.count(runTrap(makeWorld({ generationParams: { seed: i } }), river, SUMMER, 48, { ctx: { frozen: () => false } }));
            winter += FishTraps.count(runTrap(makeWorld({ generationParams: { seed: i } }), river, WINTER, 48, { ctx: { frozen: () => false } }));
        }
        expect(summer).toBeGreaterThan(winter * 2);
    });

    it('bait from the packs, used up in time', () => {
        const world = makeWorld();
        const p = player();
        const trap = FishTraps.lay(world, p, 5, 5, 3, 4, river, SUMMER).trap;
        expect(FishTraps.bait(world, p, trap.id, 'gold', SUMMER).ok).toBe(false);
        expect(FishTraps.bait(world, p, trap.id, 'bread', SUMMER).ok).toBe(true);
        expect(p.inventory.bread).toBe(1);
        expect(FishTraps.baited(trap, SUMMER + 2)).toBe(true);
        FishTraps.settle(world, trap, SUMMER + 200);
        expect(trap.bait).toBe(null);
    });

    it('none under ice', () => {
        cfg({ cap: 999 });
        const trap = runTrap(makeWorld(), river, SUMMER, 24 * 10, { ctx: { frozen: () => true } });
        expect(FishTraps.count(trap)).toBe(0);
    });

    it('a full trap takes no more', () => {
        cfg({ cap: 3, perHour: { river: 0.9, lake: 0.9, pond: 0.9, sea: 0.9 } });
        const trap = runTrap(makeWorld(), river, SUMMER, 24 * 5);
        expect(FishTraps.count(trap)).toBe(3);
        expect(FishTraps.isFull(trap)).toBe(true);
    });

    it('a trap fallen apart takes nothing till mended with reeds', () => {
        cfg({ wearPerDay: 0.5, perHour: { river: 0.9, lake: 0.9, pond: 0.9, sea: 0.9 } });
        const world = makeWorld();
        const p = player();
        const trap = FishTraps.lay(world, p, 5, 5, 3, 4, river, SUMMER + 23).trap;
        FishTraps.settle(world, trap, SUMMER + 24 * 3);
        expect(FishTraps.isBroken(trap)).toBe(true);
        const n = FishTraps.count(trap);
        FishTraps.settle(world, trap, SUMMER + 24 * 4);
        expect(FishTraps.count(trap)).toBe(n);
        expect(FishTraps.mend(world, p, trap.id).ok).toBe(true);
        expect(p.inventory.reeds).toBe(1);
        expect(trap.wear).toBe(0);
    });
});

describe('hauled up, kept, robbed', () => {
    const river = { ok: true, water: 'river', current: true };

    it('the catch into the packs, the trap back in the water; taken up into the packs', () => {
        cfg({ cap: 4, perHour: { river: 0.9, lake: 0.9, pond: 0.9, sea: 0.9 } });
        const world = makeWorld();
        const p = player();
        const trap = FishTraps.lay(world, p, 5, 5, 3, 4, river, SUMMER).trap;
        const res = FishTraps.haul(world, p, trap.id, SUMMER + 24);
        expect(res.ok).toBe(true);
        const got = Object.values(res.got).reduce((a, b) => a + b, 0);
        expect(got).toBe(4);
        for (const [id, n] of Object.entries(res.got)) expect(p.inventory[id]).toBe(n);
        expect(FishTraps.count(trap)).toBe(0);
        expect(FishTraps.list(world).length).toBe(1);
        const up = FishTraps.takeUp(world, p, trap.id, SUMMER + 24);
        expect(up.ok).toBe(true);
        expect(p.inventory.fish_trap).toBe(2);
        expect(FishTraps.list(world).length).toBe(0);
    });

    it('kept in the save', () => {
        const world = makeWorld();
        const trap = runTrap(world, river, SUMMER, 72, { bait: true });
        const copy = makeWorld();
        FishTraps.restore(JSON.parse(JSON.stringify(FishTraps.serialize(world))), copy);
        const back = FishTraps.find(copy, trap.id);
        expect(back).toEqual(trap);
        expect(FishTraps.at(copy, 5, 5).length).toBe(1);
        // and the game's save carries it (systems/saveLoad.js)
        const src = fs.readFileSync('src/systems/saveLoad.js', 'utf8');
        expect(src).toMatch(/fishTraps: FishTraps\.serialize\(world\)/);
        expect(src).toMatch(/FishTraps\.restore\(saveData\.fishTraps, world\)/);
        FishTraps.restore(null, copy);
        expect(FishTraps.list(copy).length).toBe(0);
    });

    it('a poacher takes the fish to his town; seen off on the map, he leaves them', () => {
        const town = { name: 'Eelford', type: 'village', population: 300, folk: { people: [{ id: 1, first: 'Wat', last: 'Tyler', born: -9999 }] } };
        const world = makeWorld();
        world.getTile(5, 5).settlement = town;
        SettlementMarket.ensure(town);
        const stock0 = { ...town.market.stock };
        cfg({ cap: 6, perHour: { river: 0.9, lake: 0.9, pond: 0.9, sea: 0.9 }, poach: { chance: 1, townMult: 1, ageDays: 6, takeTrap: 0 } });
        const p = player();
        const trap = FishTraps.lay(world, p, 5, 5, 3, 4, river, SUMMER + 6).trap;
        // (full before the night)
        FishTraps.settle(world, trap, SUMMER + 21);
        const had = FishTraps.count(trap);
        expect(had).toBe(6);
        const kinds = trap.catch.map(e => ({ ...e }));
        // the night he comes: seen off
        const nightOf = (from) => {
            for (let d = from; d < from + 20; d++) {
                const h = FishTraps.poachHour(world, trap, d);
                FishTraps.settle(world, trap, h);
                if (FishTraps.poacherAt(world, trap, h) >= 0) return { d, h };
            }
            return null;
        };
        const first = nightOf(Math.floor(SUMMER / 24));
        expect(first).not.toBe(null);
        FishTraps.scare(world, trap, first.h);
        FishTraps.settle(world, trap, first.h + 1);
        expect(FishTraps.count(trap)).toBe(6);
        // a later night nobody is by: the fish go to his household, sold on in the town
        const next = nightOf(first.d + 1);
        expect(next).not.toBe(null);
        const out = FishTraps.settle(world, trap, next.h + 1);
        expect(FishTraps.count(trap)).toBeLessThan(6);
        expect(out.notices.some(n => /Wat Tyler of Eelford/.test(n.text))).toBe(true);
        let moved = 0;
        for (const id of new Set(kinds.map(e => e.itemId))) moved += (town.market.stock[id] || 0) - (stock0[id] || 0);
        expect(moved).toBeGreaterThanOrEqual(6);
        expect(trap.poached).toBeGreaterThanOrEqual(6);
    });

    it('a flood washes a river trap away', () => {
        const world = makeWorld();
        const p = player();
        const trap = FishTraps.lay(world, p, 5, 5, 3, 4, river, SUMMER).trap;
        world.riverLife = { floods: [{ q: 5, r: 5, from: 0, until: 999, sev: 1 }] };
        cfg({ flood: 1 });
        const out = FishTraps.settle(world, trap, SUMMER + 48);
        expect(FishTraps.list(world).length).toBe(0);
        expect(out.notices[0].title).toMatch(/Washed Away/);
    });
});
