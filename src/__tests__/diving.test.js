/**
 * Diving (player/diving.js: breath, its costs and the finds on the bottom;
 * world/innerMap/swimming.js: where a diver may go; tables in data/diving.json;
 * ui/innerMapDiving.js takes the player under on the map).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { InnerMap } from '../world/innerMap.js';
import { Diving } from '../player/diving.js';
import { Swimming } from '../player/swimming.js';
import { Player } from '../player/player.js';
import { PracticeSkills } from '../systems/practiceSkills.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const summer = { season: 'Summer', day: 10 };
const winter = { season: 'Winter', day: 10 };

const diver = (level = 1) => {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    p.luck = 5;
    p.gold = 0;
    PracticeSkills.setLevel(p, 'diving', level);
    if (p.needs) p.needs.energy = 100;
    return p;
};

/** Every item drawn over n draws from this water */
function draws(water, n, opts = {}) {
    const p = diver();
    const seen = new Set();
    for (let i = 0; i < n; i++) {
        const f = Diving.rollFind(p, water, opts);
        if (f && f.item) seen.add(f.item);
    }
    return seen;
}

/** n divable cells of one water */
const cells = (n, kind, deep, nearWreck = false) => Array.from({ length: n }, (_, i) => ({ q: i % 50, r: Math.floor(i / 50), kind, deep, nearWreck }));

describe('the data', () => {
    it('loads, and every find is a good with a description', () => {
        const C = Diving.config();
        expect(Object.keys(C.tables).sort()).toEqual(['lake', 'pond', 'river', 'sea']);
        const byId = {};
        for (const g of Object.values(PlayerEconomy.GOODS)) byId[g.id] = g;
        const items = new Set();
        for (const depths of Object.values(C.tables)) for (const t of Object.values(depths)) for (const e of t) if (e.item) items.add(e.item);
        for (const f of C.treasure.finds) if (f.item) items.add(f.item);
        for (const id of items) {
            expect(byId[id], id).toBeTruthy();
            expect(byId[id].description, id).toBeTruthy();
        }
    });
});

describe('breath', () => {
    beforeEach(() => Utils.setSeed(1234));

    it('grows with the Diving level', () => {
        const lv = PracticeSkills.def('diving').perks.breath.levels;
        expect(Diving.breath(diver(1))).toBe(lv[0]);
        expect(Diving.breath(diver(PracticeSkills.maxLevel()))).toBe(lv[lv.length - 1]);
        expect(Diving.breath(diver(5))).toBeGreaterThan(Diving.breath(diver(4)));
    });

    it('drains while under, faster in the cold, and surfacing refills it', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        expect(Diving.isUnder(p)).toBe(true);
        const max = p.dive.max;
        Diving.tick(p, summer, null, 10);
        expect(p.dive.breath).toBeCloseTo(max - 10 * Diving.config().drainPerSecond);
        const c = diver();
        Diving.goUnder(c, winter);
        Diving.tick(c, winter, null, 10);
        expect(c.dive.breath).toBeLessThan(p.dive.breath);
        Diving.surface(p);
        expect(Diving.isUnder(p)).toBe(false);
        Diving.goUnder(p, summer);
        expect(p.dive.breath).toBe(Diving.breath(p));
    });

    it('no harm while the breath lasts; out of it, each second hurts, and you are told', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        const never = () => 1; // (no blackout)
        let told = { low: false, out: false };
        for (let i = 0; i < Math.ceil(p.dive.max) - 1; i++) {
            const res = Diving.tick(p, summer, null, 1, never);
            if (res.low) told.low = true;
        }
        expect(p.health).toBe(100);
        expect(told.low).toBe(true);
        for (let i = 0; i < 2; i++) if (Diving.tick(p, summer, null, 1, never).outOfBreath) told.out = true;
        expect(told.out).toBe(true);
        Diving.tick(p, summer, null, 4, never);
        expect(p.health).toBeLessThan(100);
    });

    it('the cold hurts more past the breath', () => {
        const never = () => 1;
        const run = (world) => {
            const p = diver();
            Diving.goUnder(p, world);
            for (let i = 0; i < 40; i++) Diving.tick(p, world, null, 1, never);
            return 100 - p.health;
        };
        expect(run(winter)).toBeGreaterThan(run(summer) * 1.5);
    });

    it('stay down long enough and you black out, or drown', () => {
        let blackout = false;
        const p = diver();
        Diving.goUnder(p, summer);
        for (let i = 0; i < 200 && !blackout; i++) {
            const res = Diving.tick(p, summer, null, 1);
            if (res.blackout || res.drowned) blackout = true;
        }
        expect(blackout).toBe(true);
    });

    it('time under tires you, and surfacing teaches diving and swimming', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        Diving.tick(p, summer, null, 10, () => 1);
        expect(p.needs.energy).toBeLessThan(100);
        const res = Diving.surface(p);
        const X = PracticeSkills.def('diving').xp;
        expect(res.limit).toBe(false);
        expect(PracticeSkills.xp(p, 'diving')).toBeCloseTo(10 * X.perSecond);
        expect(PracticeSkills.xp(p, 'swimming')).toBeCloseTo(10 * X.swimmingPerSecond);
    });

    it('too tired, or too laden, you cannot go under', () => {
        const p = diver();
        p.needs.energy = Diving.config().minEnergy - 1;
        expect(Diving.canDive(p).ok).toBe(false);
        expect(Diving.canDive(diver()).ok).toBe(true);
    });
});

describe('moving under the water', () => {
    /** A 12×8 meadow with a lake down columns 4–9: columns 4 and 9 its shallows */
    function lay() {
        const tiles = [];
        for (let r = 0; r < 8; r++) {
            const row = [];
            for (let q = 0; q < 12; q++) {
                const wet = q >= 4 && q <= 9;
                const shallow = q === 4 || q === 9;
                row.push({
                    q, r, explored: true, visible: true,
                    subTerrain: wet ? { id: 'lake_water', passable: shallow } : { id: 'grass', passable: true },
                    _wet: wet, _waterKind: wet ? 'lake' : undefined, _deep: wet && !shallow && q >= 6 && q <= 7,
                });
            }
            tiles.push(row);
        }
        InnerMap.tiles = tiles;
        InnerMap.width = 12;
        InnerMap.height = 8;
        InnerMap._insideBuilding = null;
        InnerMap._swimAllowed = true;
        InnerMap.playerInnerQ = 6;
        InnerMap.playerInnerR = 3;
        InnerMap.cancelPlayerWalk();
    }
    beforeEach(() => { lay(); InnerMap._underwater = false; });

    it('on the surface you may swim out of the water onto land', () => {
        expect(InnerMap.movePlayerTo(1, 3).started).toBe(true);
    });

    it('under, only water you cannot stand in: no land, no shallows', () => {
        InnerMap._underwater = true;
        expect(InnerMap.isDivable(6, 3)).toBe(true);
        expect(InnerMap.isDivable(4, 3)).toBe(false);
        expect(InnerMap.movePlayerTo(1, 3).started).toBeFalsy();
        expect(InnerMap.movePlayerTo(4, 3).started).toBeFalsy();
        InnerMap.cancelPlayerWalk();
        expect(InnerMap.movePlayerTo(8, 6).started).toBe(true);
        for (const s of InnerMap._playerPath) expect(InnerMap.isDivable(s.q, s.r), `${s.q},${s.r}`).toBe(true);
        InnerMap.cancelPlayerWalk();
        InnerMap._underwater = false;
    });
});

describe('what lies on the bottom', () => {
    beforeEach(() => Utils.setSeed(4242));

    it('by water and depth: the deep sea has oysters and lobster, never crayfish', () => {
        const seen = draws({ kind: 'sea', deep: true }, 600);
        expect(seen.has('oysters')).toBe(true);
        expect(seen.has('lobster')).toBe(true);
        expect(seen.has('crayfish')).toBe(false);
    });

    it('a river has crayfish, mussels and snagged wood, never sea things', () => {
        const seen = draws({ kind: 'river', deep: false }, 600);
        for (const id of ['crayfish', 'mussels', 'driftwood']) expect(seen.has(id), id).toBe(true);
        for (const id of ['oysters', 'lobster', 'seaweed', 'sea_sponge']) expect(seen.has(id), id).toBe(false);
    });

    it('a lake bed has crayfish, mussels and clay; a pond its leeches', () => {
        const lake = draws({ kind: 'lake', deep: true }, 600);
        for (const id of ['crayfish', 'mussels', 'clay']) expect(lake.has(id), id).toBe(true);
        expect(lake.has('oysters')).toBe(false);
        expect(draws({ kind: 'pond', deep: true }, 600).has('leeches')).toBe(true);
    });

    it('the water of a map tile: its kind and depth', () => {
        expect(Diving.waterOf({ _waterKind: 'river', _deep: false })).toEqual({ kind: 'river', deep: false });
        expect(Diving.waterOf({ _waterKind: 'sea', _deep: true })).toEqual({ kind: 'sea', deep: true });
        expect(Diving.waterOf({ _sea: true })).toEqual({ kind: 'sea', deep: false });
        expect(Diving.waterOf({ _wet: true })).toEqual({ kind: 'pond', deep: false });
    });

    it('the scatter is seeded: the same seed lays the same bottom, another a different one', () => {
        const a = Diving.scatter(cells(400, 'sea', true), { seed: 77 });
        const b = Diving.scatter(cells(400, 'sea', true), { seed: 77 });
        const c = Diving.scatter(cells(400, 'sea', true), { seed: 78 });
        expect(a.length).toBeGreaterThan(5);
        expect(b).toEqual(a);
        expect(c).not.toEqual(a);
        // (and a scatter leaves the game's own random stream alone)
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        Diving.scatter(cells(400, 'sea', true), { seed: 77 });
        expect(Utils.random()).toBe(before);
    });

    it('scattered thinly, never past the cap', () => {
        const C = Diving.config();
        const many = Diving.scatter(cells(5000, 'sea', false), { seed: 3 });
        expect(many.length).toBeLessThanOrEqual(C.bed.max);
        const few = Diving.scatter(cells(200, 'lake', false), { seed: 3 });
        expect(few.length).toBeLessThan(200 * C.bed.perTile * 1.6);
    });

    it('kept for the day, each find taken once; a new day lays a new bottom', () => {
        const store = {};
        let laid = 0;
        const make = () => { laid++; return cells(400, 'sea', true); };
        const bed = Diving.bedFor(store, '3,4', 10, make, { seed: 9 });
        const n = bed.finds.length;
        const f = bed.finds[0];
        const p = diver();
        Diving.goUnder(p, summer);
        expect(Diving.take(p, f).ok).toBe(true);
        Diving.removeFind(bed, f);
        const again = Diving.bedFor(store, '3,4', 10, make, { seed: 9 });
        expect(again).toBe(bed);
        expect(again.finds.length).toBe(n - 1);
        expect(Diving.findAt(again, f.q, f.r)).toBe(null);
        expect(laid).toBe(1);
        const tomorrow = Diving.bedFor(store, '3,4', 11, make, { seed: 10 });
        expect(laid).toBe(2);
        expect(tomorrow).not.toBe(bed);
    });

    it('the seed of a bottom: by the world, the map and the day', () => {
        const w = { generationParams: { seed: 12345 } };
        expect(Diving.bedSeed(w, '3,4', 10)).toBe(Diving.bedSeed(w, '3,4', 10));
        expect(Diving.bedSeed(w, '3,4', 11)).not.toBe(Diving.bedSeed(w, '3,4', 10));
        expect(Diving.bedSeed(w, '3,5', 10)).not.toBe(Diving.bedSeed(w, '3,4', 10));
    });
});

describe('treasure stays rare', () => {
    const share = (kind, deep, nearWreck = false) => {
        let all = 0, rare = 0;
        for (let s = 1; s <= 60; s++) {
            const finds = Diving.scatter(cells(400, kind, deep, nearWreck), { seed: s });
            all += finds.length;
            rare += finds.filter(f => f.rare).length;
        }
        return { all, rare, share: rare / Math.max(1, all) };
    };

    it('the deep sea: a few on a map, never many', () => {
        const s = share('sea', true);
        expect(s.rare).toBeGreaterThan(0);
        expect(s.share).toBeLessThan(0.1);
    });

    it('rarer in a pond than the deep sea; far likelier by a wreck', () => {
        const deep = share('sea', true).share;
        expect(share('pond', false).share).toBeLessThan(deep);
        expect(share('sea', true, true).share).toBeGreaterThan(deep * 2);
    });

    it('treasure suits the water, and glints', () => {
        expect(Diving.treasures({ kind: 'pond', deep: false }).some(f => f.item === 'pearls')).toBe(false);
        expect(Diving.treasures({ kind: 'sea', deep: false }).some(f => f.item === 'blue_coral')).toBe(false);
        expect(Diving.treasures({ kind: 'sea', deep: true }).some(f => f.item === 'blue_coral')).toBe(true);
        const rare = Diving.scatter(cells(4000, 'sea', true, true), { seed: 21 }).filter(f => f.rare);
        expect(rare.length).toBeGreaterThan(0);
        for (const f of rare) expect(['treasure', 'chest']).toContain(f.look);
    });
});

describe('finds into the packs, and a blackout losing them', () => {
    beforeEach(() => Utils.setSeed(555));

    it('a find taken lands in the inventory; a chest in the purse', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        expect(Diving.take(p, { item: 'mussels', qty: 3, gold: 0, name: 'Mussels' }).ok).toBe(true);
        expect(p.inventory.mussels).toBe(3);
        expect(Diving.take(p, { item: null, qty: 1, gold: 90, name: 'Sunken Chest', rare: true }).ok).toBe(true);
        expect(p.gold).toBe(90);
        const up = Diving.surface(p);
        expect(up.lost).toBe(false);
        expect(p.inventory.mussels).toBe(3);
        expect(p.gold).toBe(90);
    });

    it('full packs: the find stays on the bottom', () => {
        const p = diver();
        const cap = PlayerInventory.getCapacity(p);
        for (let i = 0; i < cap; i++) p.inventory['junk_' + i] = 1;
        Diving.goUnder(p, summer);
        expect(Diving.take(p, { item: 'oysters', qty: 1, gold: 0 }).ok).toBe(false);
        expect(p.inventory.oysters).toBeUndefined();
    });

    it('a blackout lets go of this dive\'s haul, and only that', () => {
        const p = diver();
        p.inventory = { mussels: 2 };
        p.gold = 10;
        Diving.goUnder(p, summer);
        Diving.take(p, { item: 'mussels', qty: 3, gold: 0 });
        Diving.take(p, { item: 'pearls', qty: 1, gold: 0, rare: true });
        Diving.take(p, { item: null, gold: 50 });
        expect(p.inventory).toEqual({ mussels: 5, pearls: 1 });
        const up = Diving.surface(p, { blackout: true });
        expect(up.lost).toBe(true);
        expect(p.inventory).toEqual({ mussels: 2 });
        expect(p.gold).toBe(10);
        expect(Diving.isUnder(p)).toBe(false);
    });
});
