// Rivers in play (world/rivers.js): river size bands, boats only on rivers of a
// boat's size, crossing a great river on land, natural fords (terrainGen 17),
// and trade by river (systems/marketDynamics.js riverFactor).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

let Utils, DataLoader, Rivers, RiverBoats, Terrain, Player, WorldUnit, MarketDynamics, SettlementMarket;

beforeAll(async () => {
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Rivers } = await import('../world/rivers.js'));
    ({ RiverBoats } = await import('../systems/riverBoats.js'));
    ({ Terrain } = await import('../world/terrain.js'));
    ({ Player } = await import('../player/player.js'));
    ({ WorldUnit } = await import('../world/units.js'));
    ({ MarketDynamics } = await import('../systems/marketDynamics.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
}, 120000);

let baseRivers;
beforeEach(() => {
    if (!baseRivers) baseRivers = DataLoader._gamedata.rivers;
    // (the fixture's rivers are short: smaller bands, so it has all three sizes)
    DataLoader._gamedata.rivers = { ...baseRivers, bands: { river: 4, great: 10 } };
});
afterEach(() => {
    DataLoader._gamedata.rivers = baseRivers;
});

const PLAINS = { id: 'plains', passable: true, moveCost: 1 };
const OCEAN = { id: 'ocean', passable: false, moveCost: Infinity };

/**
 * A 20 x 12 world of plains, the sea in columns 18-19. A river along row 6
 * from q=1 flowing east (riverDir 0) to the sea; a two-hex brook (7,5) → (8,5)
 * joins it at (8,6); at (16,6) a delta's second channel splits off into
 * (17,7), which runs on into the sea. Feeds: (q, 6) = q, plus 2 from q=8 on.
 * With bands river 4 / great 10: brooks q<4, a river q 4-7, a great river from q 8.
 */
function makeWorld() {
    const W = 20, H = 12;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const t = { q, r, terrain: q >= 18 ? OCEAN : PLAINS, elevation: q >= 18 ? 0.3 : 0.5, hasRiver: false, explored: true };
            if (r === 6 && q >= 1 && q <= 17) { t.hasRiver = true; t.riverDir = 0; t.elevation = 0.5 - q * 0.002; }
            row.push(t);
        }
        tiles.push(row);
    }
    Object.assign(tiles[5][7], { hasRiver: true, riverDir: 0 });
    Object.assign(tiles[5][8], { hasRiver: true, riverDir: 5 }); // (odd row: SE is (8, 6))
    tiles[6][16].riverBranch = 5;                                // (even row: SE is (17, 7))
    Object.assign(tiles[7][17], { hasRiver: true, riverDir: 0 });
    return {
        width: W, height: H, tiles, day: 100, units: [],
        generationParams: { seed: 7, terrainGen: 16 },
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            return tiles[r][((q % W) + W) % W];
        },
    };
}

describe('river size', () => {
    it('counts the river hexes upstream, tributaries and a delta channel included', () => {
        const w = makeWorld();
        expect(Rivers.feed(w, 1, 6)).toBe(1);
        expect(Rivers.feed(w, 5, 6)).toBe(5);
        expect(Rivers.feed(w, 8, 5)).toBe(2);
        expect(Rivers.feed(w, 8, 6)).toBe(10);   // 7 above it + itself + the 2-hex brook
        expect(Rivers.feed(w, 16, 6)).toBe(18);
        expect(Rivers.feed(w, 17, 7)).toBe(18);  // the delta's channel is the river it leaves
        expect(Rivers.feed(w, 3, 3)).toBe(0);
    });

    it('sorts rivers into brook, river and great river bands', () => {
        const w = makeWorld();
        expect(Rivers.band(w, 2, 6)).toBe('brook');
        expect(Rivers.band(w, 7, 5)).toBe('brook');
        expect(Rivers.band(w, 5, 6)).toBe('river');
        expect(Rivers.band(w, 12, 6)).toBe('great');
        expect(Rivers.band(w, 3, 3)).toBe(null);
        expect(Rivers.bandName('great')).toBe('great river');
        // the shipped bands
        DataLoader._gamedata.rivers = baseRivers;
        expect(Rivers.bandOf(5)).toBe('brook');
        expect(Rivers.bandOf(6)).toBe('river');
        expect(Rivers.bandOf(24)).toBe('great');
    });

    it('counts a painted river with no course as a river', () => {
        const w = makeWorld();
        Object.assign(w.tiles[2][4], { hasRiver: true });
        expect(Rivers.feed(w, 4, 2)).toBe(null);
        expect(Rivers.band(w, 4, 2)).toBe('river');
    });

    it('is the same grid every time, worked out once per world', () => {
        const w = makeWorld();
        const a = Rivers.grid(w);
        expect(Rivers.grid(w)).toBe(a);
        const b = Rivers.feedOf(makeWorld().tiles, 20, 12);
        expect(Array.from(b.feed)).toEqual(Array.from(a.feed));
    });
});

describe('river boats by river size', () => {
    const boater = (q, r) => ({ q, r, gold: 0, riverBoat: { kind: 'punt', name: 'Punt', aboard: true, q, r, cargo: {} } });

    it('use rivers and great rivers, not brooks', () => {
        const w = makeWorld();
        expect(RiverBoats.navigable(w, 2, 6)).toBe(false);
        expect(RiverBoats.navigable(w, 5, 6)).toBe(true);
        expect(RiverBoats.navigable(w, 12, 6)).toBe(true);
        expect(RiverBoats.link(w, 5, 6, 6, 6)).toBe('down');
        expect(RiverBoats.link(w, 6, 6, 5, 6)).toBe('up');
        expect(RiverBoats.link(w, 4, 6, 3, 6)).toBe(null); // not up into a brook
    });

    it('a boat left on a brook can still float down it to bigger water', () => {
        const w = makeWorld();
        expect(RiverBoats.link(w, 2, 6, 3, 6)).toBe('down');
        expect(RiverBoats.link(w, 3, 6, 4, 6)).toBe('down');
        expect(RiverBoats.link(w, 3, 6, 2, 6)).toBe(null);
    });

    it('are built only in towns on a boat\'s river', () => {
        const w = makeWorld();
        w.tiles[6][2].settlement = { name: 'Brookby', type: 'village', economy: { gold: 0 } };
        w.tiles[6][5].settlement = { name: 'Riverton', type: 'village', economy: { gold: 0 } };
        expect(RiverBoats.canBuyAt(w, 2, 6)).toBe(false);
        expect(RiverBoats.canBuyAt(w, 5, 6)).toBe(true);
    });

    it('go quicker both ways on a great river', () => {
        const w = makeWorld();
        const p = boater(5, 6);
        const G = Rivers.config().boats.great;
        const k = RiverBoats.kind('punt');
        expect(RiverBoats.legFactor(w, p, 5, 6, 6, 6)).toBeCloseTo(k.down, 6);
        expect(RiverBoats.legFactor(w, p, 12, 6, 13, 6)).toBeCloseTo(k.down * G.down, 6);
        expect(RiverBoats.legFactor(w, p, 13, 6, 12, 6)).toBeCloseTo(k.up * G.up, 6);
        expect(RiverBoats.legFactor(w, p, 13, 6, 12, 6)).toBeLessThan(k.up);
    });
});

describe('crossing a river on land', () => {
    it('costs time only across a great river with no bridge, road, town or ford', () => {
        const w = makeWorld();
        const C = Rivers.config().crossing;
        expect(Rivers.crossExtra(w, 12, 5, 12, 6, 'player')).toBe(C.player.great);
        expect(Rivers.crossExtra(w, 12, 5, 12, 6, 'army')).toBe(C.army.great);
        expect(Rivers.crossExtra(w, 5, 5, 5, 6, 'army')).toBe(C.army.river);
        expect(Rivers.crossExtra(w, 2, 5, 2, 6, 'player')).toBe(0);  // a brook
        expect(Rivers.crossExtra(w, 11, 6, 12, 6, 'player')).toBe(0); // along its course
        expect(Rivers.crossExtra(w, 12, 6, 12, 7, 'player')).toBe(0); // out onto dry land
        w.tiles[6][12].hasRoad = true;                                 // a road's bridge
        expect(Rivers.crossExtra(w, 12, 5, 12, 6, 'army')).toBe(0);
        w.tiles[6][12].roadCross = 'ferry';                            // paid on the road
        expect(Rivers.crossExtra(w, 12, 5, 12, 6, 'army')).toBe(0);
        w.tiles[6][13].settlement = { name: 'Bridgeford' };
        expect(Rivers.crossExtra(w, 13, 5, 13, 6, 'player')).toBe(0);
        w.tiles[6][14]._ford = true;
        expect(Rivers.crossExtra(w, 14, 5, 14, 6, 'army')).toBeCloseTo(C.army.great * C.fordShare, 6);
    });

    it('slows the player on foot, more at the head of an army, and the route goes round by a bridge', () => {
        const w = makeWorld();
        const p = new Player({ firstName: 'Test', lastName: 'Walker', gender: 'male', age: 20 });
        p.q = 12; p.r = 5;
        const pace = p._travelPace();
        const tile = w.getTile(12, 6);
        const plain = p._hexMoveCost(tile);
        const C = Rivers.config().crossing;
        expect(p._legMoveCost(w, tile, 12, 5, 12, 6)).toBeCloseTo(plain + C.player.great * pace, 6);
        expect(p._legMoveCost(w, tile, 11, 6, 12, 6)).toBeCloseTo(plain, 6);
        p.army = Array.from({ length: C.armyFrom }, (_, i) => ({ id: `u${i}` }));
        expect(p._legMoveCost(w, tile, 12, 5, 12, 6)).toBeCloseTo(plain + C.host.great * pace, 6);
        p.army = [];
        // A bridge one hex along: planning weighs the wade against the way round
        w.tiles[6][13].hasRoad = true;
        expect(p._pathCostFrom(w, 13, 6, 13, 5)).toBeLessThan(p._pathCostFrom(w, 12, 6, 12, 5));
    });

    it('holds up a war host for a day or so without a bridge', () => {
        const march = (bridge) => {
            const w = makeWorld();
            if (bridge) for (let q = 0; q < 18; q++) w.tiles[6][q].hasRoad = true;
            const u = new WorldUnit('war_host', 12, 2);
            u.speed = 3;
            u.objectiveQ = 12; u.objectiveR = 10;
            let days = 0;
            while (!(u.q === 12 && u.r === 10) && days < 20) { u.updateWarHost(w); days++; }
            return { days, crossings: u._riverCrossings || 0 };
        };
        const open = march(false), bridged = march(true);
        expect(bridged.crossings).toBe(0);
        expect(open.crossings).toBe(1);
        expect(open.days).toBeGreaterThan(bridged.days);
    });
});

describe('fords', () => {
    it('are marked on great rivers on open flat land, up from the mouth, deterministically', () => {
        const w = makeWorld();
        const n = Rivers.markFords(w.tiles, w.width, w.height, { minFromMouth: 3, spacing: 3, perHexes: 3 });
        expect(n).toBeGreaterThan(0);
        const fords = [];
        for (const row of w.tiles) for (const t of row) if (t._ford) fords.push(t);
        expect(fords.length).toBe(n);
        for (const t of fords) {
            expect(Rivers.band(w, t.q, t.r)).toBe('great');
            expect(t.q).toBeLessThanOrEqual(17 - 3); // three or more hexes up from the sea
        }
        const again = makeWorld();
        Rivers.markFords(again.tiles, again.width, again.height, { minFromMouth: 3, spacing: 3, perHexes: 3 });
        expect(again.tiles.flat().filter(t => t._ford).map(t => `${t.q},${t.r}`)).toEqual(fords.map(t => `${t.q},${t.r}`));
    });

    it('are not marked on hills or swamp', () => {
        const w = makeWorld();
        for (const row of w.tiles) for (const t of row) if (t.terrain === PLAINS) t.terrain = { id: 'hills', passable: true, moveCost: 2 };
        expect(Rivers.markFords(w.tiles, w.width, w.height, { minFromMouth: 3, spacing: 3, perHexes: 3 })).toBe(0);
    });

    it('come only with terrainGen 17, and change nothing else of the world', () => {
        DataLoader._gamedata.rivers = baseRivers;
        const params = { seed: 11, terrainGen: 16 };
        // (as World.generate: the shared RNG seeded first, the same for both)
        Utils.setSeed(11);
        const t16 = Terrain.generateMap(120, 80, params);
        Utils.setSeed(11);
        const t17 = Terrain.generateMap(120, 80, { ...params, terrainGen: 17 });
        const fords16 = t16.flat().filter(t => t._ford).length;
        const f17 = t17.flat().filter(t => t._ford);
        expect(fords16).toBe(0);
        expect(f17.length).toBeGreaterThan(0);
        expect(Rivers.fordsApply(16)).toBe(false);
        expect(Rivers.fordsApply(17)).toBe(true);
        // (gen 17 also brings other passes — landscapes, history — so the ford pass is checked on
        // its own: marking fords changes no terrain and no river, only the _ford flags)
        const sig = (ts) => ts.flat().map(t => `${t.terrain.id}${t.hasRiver ? 'r' + t.riverDir : ''}`).join('|');
        const before = sig(t16);
        Rivers.markFords(t16, 120, 80);
        expect(sig(t16)).toBe(before);
        expect(t16.flat().some(t => t._ford)).toBe(true);
        // every ford on a great river's flat open hex
        const w = { width: 120, height: 80, tiles: t17, getTile: (q, r) => (r < 0 || r >= 80 ? null : t17[r][((q % 120) + 120) % 120]) };
        const flat = new Set(Rivers.config().fords.terrain);
        for (const t of f17) {
            expect(Rivers.band(w, t.q, t.r)).toBe('great');
            expect(flat.has(t.terrain.id)).toBe(true);
        }
    }, 60000);
});

describe('trade by river', () => {
    const town = (name, q, r) => ({ name, q, r, type: 'town', population: 2000, kingdom: 'k1', economy: { gold: 500 }, market: {} });

    it('knows which towns share a river, or a river to the sea and a port', () => {
        const w = makeWorld();
        const a = town('Upriver', 5, 6), b = town('Downriver', 14, 6), c = town('Inland', 5, 2), port = town('Haven', 17, 3);
        for (const s of [a, b, c, port]) w.tiles[s.r][s.q].settlement = s;
        const isPort = (s) => s === port;
        expect(Rivers.tradeByWater(w, a, b, isPort)).toBe('river');
        expect(Rivers.tradeByWater(w, a, port, isPort)).toBe('river_sea');
        expect(Rivers.tradeByWater(w, a, c, isPort)).toBe(null);
        // (a brook town is on no boat's water)
        const brook = town('Brookby', 2, 6);
        w.tiles[6][2].settlement = brook;
        expect(Rivers.tradeByWater(w, brook, b, isPort)).toBe(null);
    });

    it('links river towns further apart, at riverFactor the friction', () => {
        const T = SettlementMarket.config().trade;
        expect(T.riverFactor).toBeLessThan(1);
        const d = 9;
        expect(d).toBeGreaterThan(T.localRange);
        expect(d).toBeLessThanOrEqual(T.riverRange);
        const build = () => {
            const w = makeWorld();
            const a = town('Upriver', 5, 6), b = town('Downriver', 14, 6);
            for (const s of [a, b]) w.tiles[s.r][s.q].settlement = s;
            for (const row of w.tiles) for (const t of row) t.regionId = 1;
            return { w, lives: [a, b] };
        };
        const { w, lives } = build();
        const links = MarketDynamics._links(w, { land: new Map(), links: null }, lives, 100);
        expect(links.length).toBe(1);
        expect(links[0].river).toBe(true);
        expect(links[0].friction).toBeCloseTo(T.perHex * d * T.riverFactor, 6);
        // With the river's trade turned off the two are too far apart to be neighbours
        const md = DataLoader._gamedata.markets;
        DataLoader._gamedata.markets = { ...md, trade: { ...md.trade, riverFactor: 1, riverRange: 0 } };
        try {
            const again = build();
            expect(MarketDynamics._links(again.w, { land: new Map(), links: null }, again.lives, 100).length).toBe(0);
        } finally {
            DataLoader._gamedata.markets = md;
        }
    });
});
