/**
 * River & sea as a way of life (systems/riverBoats.js, systems/riverLife.js):
 * river boats bought from a river town, travelling the map along the rivers
 * (quick downstream, slow up, no way off the water), paying a town's mill
 * weir and bridge; fishing rights leased (fee into the town's purse, more fish
 * in the nets, the bailiff's fine without one, poachers whose fish go to
 * market); raw fish spoiling unless salted; spring floods with their crest
 * running downstream, washing nets away, drowning crops, flooding houses;
 * waterside towns eating more fish; all of it saved.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

let DataLoader, Hex, RiverDrift, RiverNets, RiverBoats, RiverLife, SettlementMarket, Player, SaveLoad;

beforeAll(async () => {
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Hex } = await import('../core/hex.js'));
    ({ RiverDrift } = await import('../systems/riverDrift.js'));
    ({ RiverNets } = await import('../systems/riverNets.js'));
    ({ RiverBoats } = await import('../systems/riverBoats.js'));
    ({ RiverLife } = await import('../systems/riverLife.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Player } = await import('../player/player.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
}, 120000);

let baseLife;
beforeEach(() => {
    if (!baseLife) baseLife = DataLoader._gamedata.riverLife;
    DataLoader._gamedata.riverLife = JSON.parse(JSON.stringify(baseLife));
});
afterEach(() => {
    DataLoader._gamedata.riverLife = baseLife;
});
const lifeCfg = (over) => {
    const c = JSON.parse(JSON.stringify(baseLife));
    for (const [k, v] of Object.entries(over)) c[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...c[k], ...v } : v;
    DataLoader._gamedata.riverLife = c;
};

/**
 * A 12 x 6 world of plains; a river along row 2 from q=1 to q=7 flowing east
 * (riverDir 0) into the sea at q=8; a town on the river at q=4 (a mill weir:
 * terrainGen 8, and a road through it: a bridge).
 */
function makeWorld({ town = true, day = 31 } = {}) {
    const W = 12, H = 6;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles.push([]);
        for (let q = 0; q < W; q++) {
            const t = { q, r, terrain: { id: 'plains', passable: true, moveCost: 1 }, elevation: 0.5, hasRiver: false, explored: true };
            if (r === 2 && q >= 1 && q <= 7) { t.hasRiver = true; t.riverDir = 0; t.elevation = 0.6 - q * 0.02; }
            if (r === 2 && q >= 8) { t.terrain = { id: 'ocean', passable: false }; t.elevation = 0; }
            tiles[r].push(t);
        }
    }
    const world = {
        width: W, height: H, day, season: 'spring', tiles,
        generationParams: { seed: 1234, terrainGen: 8 },
        getTile: (q, r) => (r >= 0 && r < H && q >= 0 && q < W ? tiles[r][q] : null),
        getKingdom: () => null,
        getSettlementViews: () => {
            const out = [];
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (tiles[r][q].settlement) { const s = tiles[r][q].settlement; s.q = q; s.r = r; out.push(s); }
            return out;
        },
    };
    if (town) {
        const t = tiles[2][4];
        t.settlement = { name: 'Fordham', type: 'town', population: 800, economy: { gold: 500 } };
        t.hasRoad = true;
    }
    return world;
}

function makePlayer(world, q, r, gold = 1000) {
    const p = new Player();
    p.q = q; p.r = r;
    p.gold = gold;
    p.inventory = {};
    p.movementRemaining = 50; p._dayMovement = 50; p._dayPace = 10;
    p.actionPoints = 50; p.maxActionPoints = 50;
    return p;
}

describe('river boats', () => {
    it('are built in a river town, the price into its purse', () => {
        const world = makeWorld();
        const p = makePlayer(world, 4, 2);
        expect(RiverBoats.canBuyAt(world, 4, 2)).toBe(true);
        expect(RiverBoats.canBuyAt(world, 3, 2)).toBe(false); // no town
        const town = world.getTile(4, 2).settlement;
        const res = RiverBoats.buy(world, p, 4, 2, 'punt');
        expect(res.ok).toBe(true);
        expect(p.gold).toBe(1000 - 60);
        expect(town.economy.gold).toBe(560);
        expect(RiverBoats.boat(p).kind).toBe('punt');
        // sold back out of the town's purse
        const sold = RiverBoats.sell(world, p, 4, 2);
        expect(sold.ok).toBe(true);
        expect(p.gold).toBe(940 + sold.gold);
        expect(town.economy.gold).toBe(560 - sold.gold);
        expect(p.riverBoat).toBe(null);
    });

    it('go quick downstream, slow upstream, and nowhere off the water', () => {
        const world = makeWorld();
        const p = makePlayer(world, 2, 2);
        p.riverBoat = { kind: 'punt', name: 'Punt', aboard: true, q: 2, r: 2, cargo: {}, fishLots: [] };
        expect(RiverBoats.link(world, 2, 2, 3, 2)).toBe('down');
        expect(RiverBoats.link(world, 3, 2, 2, 2)).toBe('up');
        expect(RiverBoats.link(world, 2, 2, 2, 1)).toBe(null);
        expect(p._canEnterHex(2, 1, world)).toBe(false); // dry land
        expect(p._canEnterHex(3, 2, world)).toBe(true);
        const down = p.travelEstimate(world, 6, 2);
        p.q = 6; p.riverBoat.q = 6;
        const up = p.travelEstimate(world, 2, 2);
        expect(down && up).toBeTruthy();
        expect(down.path.every(h => h.r === 2)).toBe(true);
        expect(up.travelDays).toBeGreaterThan(down.travelDays * 3);
        // on foot the same trip is open country
        p.riverBoat.aboard = false;
        expect(p._canEnterHex(2, 1, world)).toBe(true);
    });

    it('pay the town weir and bridge as they pass, in coin or in kind', () => {
        const world = makeWorld();
        const p = makePlayer(world, 3, 2, 100);
        p.riverBoat = { kind: 'punt', name: 'Punt', aboard: true, q: 3, r: 2, cargo: { salt: 2 }, fishLots: [] };
        const town = world.getTile(4, 2).settlement;
        const due = RiverBoats.tollsAt(world, p, 4, 2);
        expect(due.weir).toBeGreaterThan(0);
        expect(due.bridge).toBeGreaterThan(0);
        expect(p.moveTo(5, 2, world)).toBe(true);
        for (let i = 0; i < 10 && p.isMoving; i++) p.stepAlongPath(world, 1);
        expect(p.q).toBe(5);
        expect(p.gold).toBe(100 - due.total);
        expect(town.economy.gold).toBe(500 + due.total);
        expect(p.riverBoat.q).toBe(5);
        // no coin: a unit of the hold goes instead
        p.gold = 0;
        p.riverBoat.q = 4; p.q = 4;
        RiverBoats.passHex(world, p, 4, 2);
        expect(p.riverBoat.cargo.salt).toBe(1);
    });

    it('carry cargo in a hold of their own', () => {
        const world = makeWorld();
        const p = makePlayer(world, 4, 2);
        p.riverBoat = { kind: 'punt', name: 'Punt', aboard: false, q: 4, r: 2, cargo: {}, fishLots: [] };
        p.inventory = { grain: 40 };
        const res = RiverBoats.load(p, 'grain', Infinity);
        expect(res.n).toBe(RiverBoats.holdOf(p.riverBoat));
        expect(p.inventory.grain).toBe(40 - res.n);
        expect(RiverBoats.unload(p, 'grain', 5).n).toBe(5);
        expect(p.riverBoat.cargo.grain).toBe(res.n - 5);
    });
});

describe('fishing rights', () => {
    it('are leased from the town that holds the water, the fee into its purse', () => {
        const world = makeWorld();
        const p = makePlayer(world, 3, 2, 200);
        expect(RiverLife.waterAt(world, 3, 2)).toBe('river');
        const h = RiverLife.holderOf(world, 3, 2);
        expect(h.name).toBe('Fordham');
        const fee = RiverLife.leaseFee(world, 3, 2);
        const res = RiverLife.lease(world, p, 3, 2);
        expect(res.ok).toBe(true);
        expect(p.gold).toBe(200 - fee);
        expect(world.getTile(4, 2).settlement.economy.gold).toBe(500 + fee);
        expect(RiverLife.leaseAt(world, 3, 2)).toBeTruthy();
        expect(RiverLife.netRollBonus(world, { q: 3, r: 2 })).toBeGreaterThan(0);
        // free water far from any town or crown cannot be leased
        expect(RiverLife.lease(world, p, 1, 2).ok).toBe(false);
    });

    it('a leased water gives the nets more fish', () => {
        const rd = DataLoader._gamedata.riverDrift;
        DataLoader._gamedata.riverDrift = { ...rd, nets: { ...rd.nets, theftChance: 0, townTheft: 0, tearChance: 0 } };
        const run = (leased) => {
            const world = makeWorld();
            const p = makePlayer(world, 0, 0);
            p.inventory = { fishing_net: 1 };
            RiverNets.lay(world, p, 3, 2, { water: 'river', cell: { x: 1, y: 1 }, frac: 0.5 }, world.day * 24);
            if (leased) RiverLife.lease(world, p, 3, 2);
            let fish = 0;
            for (let d = 1; d <= 20; d++) {
                world.day += 1;
                RiverNets.processDay(world, p, world.day, { rollBonus: (net) => RiverLife.netRollBonus(world, net) });
                const net = RiverNets.list(world)[0];
                if (!net) break;
                for (const e of net.catch) if (RiverLife._isFish(e)) fish += e.qty;
                net.catch = [];
            }
            return fish;
        };
        const more = run(true), fewer = run(false);
        DataLoader._gamedata.riverDrift = rd;
        expect(fewer).toBeGreaterThan(0);
        expect(more).toBeGreaterThan(fewer);
    });

    it('the bailiff fines a net on held water without a lease; poachers take fish to market', () => {
        lifeCfg({ bailiff: { chance: 1, townMult: 1, fine: 12 }, poach: { chance: 0 } });
        const world = makeWorld();
        const p = makePlayer(world, 0, 0, 50);
        p.inventory = { fishing_net: 1 };
        RiverNets.lay(world, p, 3, 2, { water: 'river', cell: { x: 1, y: 1 } }, world.day * 24);
        const town = world.getTile(4, 2).settlement;
        const out = RiverLife.processDay(world, p, world.day);
        expect(p.gold).toBe(38);
        expect(town.economy.gold).toBe(512);
        expect(out.notices.some(n => n.title === 'The Water Bailiff')).toBe(true);

        lifeCfg({ bailiff: { chance: 0 }, poach: { chance: 1, leasedMult: 1, townMult: 1, share: 0.5 } });
        const net = RiverNets.list(world)[0];
        net.catch = [{ itemId: 'fish', qty: 3, fish: true, since: 0 }, { itemId: 'fish', qty: 2, fish: true, since: 0 }];
        const before = SettlementMarket.stock(town, 'fish');
        const res = RiverLife.processDay(world, p, world.day + 1);
        expect(res.notices.some(n => n.title === 'Poachers')).toBe(true);
        expect(net.catch.length).toBe(1);
        expect(SettlementMarket.stock(town, 'fish')).toBeGreaterThan(before);
    });
});

describe('fish that spoil, and salt', () => {
    it('raw fish rot after their days unless salted', () => {
        const world = makeWorld({ day: 40 }); // summer: 2 days
        const p = makePlayer(world, 0, 0);
        p.inventory = { fish: 10, salt: 1 };
        RiverLife.processDay(world, p, 40);
        expect(p.inventory.fish).toBe(10);
        const salted = RiverLife.saltFish(world, p, 'packs');
        expect(salted.ok).toBe(true);
        expect(p.inventory.preserved_fish).toBe(4);
        expect(p.inventory.fish).toBe(6);
        expect(p.inventory.salt).toBeUndefined();
        RiverLife.processDay(world, p, 41);
        expect(p.inventory.fish).toBe(6);
        const out = RiverLife.processDay(world, p, 42);
        expect(p.inventory.fish).toBeUndefined();
        expect(p.inventory.preserved_fish).toBe(4);
        expect(out.notices.some(n => n.title === 'Fish Gone Bad')).toBe(true);
    });

    it('waterside towns want more fish', () => {
        const world = makeWorld();
        const s = world.getTile(4, 2).settlement;
        const inland = { name: 'Dry', type: 'town', population: 800, economy: { gold: 500 } };
        RiverLife.markWaterside(world);
        expect(s.waterside).toBe(1);
        expect(SettlementMarket.need(s, 'fish')).toBeGreaterThan(SettlementMarket.need(inland, 'fish') * 1.5);
    });
});

describe('spring floods', () => {
    it('rise in spring, crest downstream, wash nets away and drown crops', () => {
        lifeCfg({ floods: { chance: 1, washAway: 1, drown: 1, houseChance: 1, crest: 3 } });
        const world = makeWorld({ day: 2 }); // spring, day 2
        const p = makePlayer(world, 0, 0);
        p.inventory = { fishing_net: 1 };
        RiverNets.lay(world, p, 3, 2, { water: 'river', cell: { x: 1, y: 1 } }, world.day * 24);
        p.farmPlots = { '3,2': { cells: { '1,1': { crop: 'wheat', growth: 1 } } } };
        const out = RiverLife.processDay(world, p, 2);
        expect(RiverLife.floodAt(world, 3, 2, 2)).toBeGreaterThan(0);
        expect(RiverNets.list(world).length).toBe(0);
        expect(p.farmPlots['3,2'].cells['1,1'].dead).toBe('flood');
        expect(out.notices.some(n => n.title === 'Flood')).toBe(true);
        // the crest: a hex rising at q=1 reaches q=2 a day later
        const st = RiverLife.state(world);
        expect(st.floods.some(f => f.from > 2)).toBe(true);
        // a boat runs quicker downstream in it, slower up
        p.riverBoat = { kind: 'punt', name: 'Punt', aboard: true, q: 3, r: 2, cargo: {}, fishLots: [] };
        const calmDown = RiverBoats.kind('punt').down;
        expect(RiverBoats.legFactor(world, p, 3, 2, 4, 2)).toBeLessThan(calmDown);
        expect(RiverBoats.legFactor(world, p, 4, 2, 3, 2)).toBeGreaterThan(RiverBoats.kind('punt').up);
        // and the floods go down again
        world.day = 40;
        RiverLife.processDay(world, p, 40);
        expect(RiverLife.floodAt(world, 3, 2, 40)).toBe(0);
    });

    it('never rise outside spring', () => {
        lifeCfg({ floods: { chance: 1 } });
        const world = makeWorld({ day: 45 });
        RiverLife.processDay(world, null, 45);
        expect(RiverLife.floodsNow(world).length).toBe(0);
    });

    it('are the same flood for the same seed and day', () => {
        const a = makeWorld({ day: 5 }), b = makeWorld({ day: 5 });
        lifeCfg({ floods: { chance: 0.2 } });
        RiverLife.processDay(a, null, 5);
        RiverLife.processDay(b, null, 5);
        expect(JSON.stringify(a.riverLife.floods)).toBe(JSON.stringify(b.riverLife.floods));
    });
});

describe('saving', () => {
    it('keeps the leases and floods, and the boat', () => {
        lifeCfg({ floods: { chance: 1 } });
        const world = makeWorld({ day: 3 });
        const p = makePlayer(world, 4, 2);
        RiverLife.lease(world, p, 3, 2);
        RiverLife.processDay(world, p, 3);
        const data = RiverLife.serialize(world);
        const w2 = makeWorld({ day: 3 });
        RiverLife.restore(JSON.parse(JSON.stringify(data)), w2);
        expect(RiverLife.leaseAt(w2, 3, 2)).toBeTruthy();
        expect(RiverLife.floodAt(w2, 3, 2, 3)).toBe(RiverLife.floodAt(world, 3, 2, 3));
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('riverBoat');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('fishLots');
    });
});
