// The player's own beasts (systems/livestock.js, data/livestock.json): the
// town's livestock market (what it sells, prices that climb as the pens
// empty), buying refused with nowhere to keep them, eggs and milk by the day,
// births with a male kept, fodder and hunger, selling, slaughter, a horse
// saddled and stabled, the founding herd a Pasture's output rides on, beasts
// sold off when their place is lost, a save/load round trip — and the beasts
// on the inner map (a fallback species until their own sheets exist).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Livestock } from '../systems/livestock.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { PlayerEconomy } from '../player/playerEconomy.js';

let InnerMap;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ InnerMap } = await import('../world/innerMap.js'));
});

/**
 * A capital on grassland at (5,6), a Farm next door at (6,6), an Orchard at
 * (5,7) — and open grassland everywhere else.
 */
function makeWorld(o = {}) {
    const tiles = new Map();
    const settlement = { name: 'Hornby', type: o.type || 'capital', population: 9000, q: 5, r: 6, kingdom: 'k1' };
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) tiles.set(k, { q, r, terrain: { id: o.terrain || 'grassland', passable: true }, settlement: null });
        return tiles.get(k);
    };
    at(5, 6).settlement = settlement;
    const world = {
        day: 10, season: o.season || 'Spring', generationParams: { seed: 77 },
        getTile: (q, r) => at(q, r),
    };
    return { world, settlement, at };
}

function makePlayer(world, at, props = ['farm']) {
    const p = new Player();
    p.q = 5; p.r = 6;
    p.gold = 5000;
    p.inventory = {};
    const spots = { farm: [6, 6], orchard: [5, 7], pasture: [7, 7], horse_ranch: [8, 8] };
    for (const type of props) {
        const [q, r] = spots[type];
        const def = PlayerEconomy.getPropertyDef(type);
        const t = at(q, r);
        t.playerProperties = (t.playerProperties || []).concat([{ type, name: def.name, icon: def.icon, produces: def.produces, productionRate: def.productionRate, upkeep: def.upkeep, level: 1, storage: 0, daysOwned: 0 }]);
        t.playerProperty = t.playerProperties[0];
        p.properties.push({ q, r, type, name: def.name, produces: def.produces });
    }
    return p;
}

const key = (type, q, r) => Livestock.placeKey({ kind: 'property', q, r, type });
const FARM = key('farm', 6, 6);

/** Run the herds' days. */
function days(world, player, n) {
    const notes = [];
    for (let i = 0; i < n; i++) {
        world.day += 1;
        notes.push(...Livestock.processDay(world, player).notices);
    }
    return notes;
}

beforeEach(() => Utils.setSeed(11));

describe('the livestock market', () => {
    it('a capital sells hens, pigs, cows and horses; the same town always the same beasts; dearer as the pens empty', () => {
        const { world, settlement } = makeWorld();
        const pens = Livestock.market(world, settlement);
        const ids = pens.map(m => m.id);
        for (const id of ['chicken', 'pig', 'cow', 'horse']) expect(ids).toContain(id);
        expect(Livestock.market(makeWorld().world, makeWorld().settlement).map(m => m.id)).toEqual(ids);
        const hen = pens.find(m => m.id === 'chicken');
        expect(hen.stock).toBeGreaterThan(5);
        expect(hen.sellPrice).toBeLessThan(hen.price);
        // Buying five costs more than five times the first
        expect(Livestock.buyCost(world, settlement, 'chicken', 5)).toBeGreaterThan(Livestock.unitPrice(world, settlement, 'chicken', hen.stock, hen.target) * 5 - 1);
        // A village keeps no dairy cows or horses
        const v = makeWorld({ type: 'village' });
        const vIds = Livestock.market(v.world, v.settlement).map(m => m.id);
        expect(vIds).not.toContain('cow');
        expect(vIds).not.toContain('horse');
    });

    it('refuses a sale with nowhere to keep them, the wrong place, or no room', () => {
        const { world, settlement, at } = makeWorld();
        const homeless = makePlayer(world, at, []);
        const r0 = Livestock.buy(world, homeless, settlement, 'chicken', 1, null);
        expect(r0.success).toBe(false);
        expect(r0.reason).toMatch(/nowhere to keep/i);
        expect(homeless.gold).toBe(5000);

        const p = makePlayer(world, at, ['farm', 'orchard']);
        const ORCH = key('orchard', 5, 7);
        const r1 = Livestock.buy(world, p, settlement, 'cow', 1, ORCH);
        expect(r1.success).toBe(false);
        expect(r1.reason).toMatch(/no place for/i);

        // Fill the farm (30 room) with pigs, then one more hen is refused
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        for (let i = 0; i < 10; i++) Livestock._addHead(p, herd, 'pig', 'f', 200);
        const r2 = Livestock.buy(world, p, settlement, 'chicken', 1, FARM);
        expect(r2.success).toBe(false);
        expect(r2.reason).toMatch(/full/i);
        expect(p.gold).toBe(5000);
    });

    it('buys by the head into a herd, the drover paid for a place away from town, the pens bought down', () => {
        const { world, settlement, at } = makeWorld();
        const p = makePlayer(world, at, ['farm']);
        const before = Livestock.market(world, settlement).find(m => m.id === 'chicken').stock;
        const cost = Livestock.buyCost(world, settlement, 'chicken', 5);
        const res = Livestock.buy(world, p, settlement, 'chicken', 5, FARM);
        expect(res.success).toBe(true);
        expect(res.cost).toBe(cost);
        expect(res.fee).toBeGreaterThan(0); // the farm is a hex away
        expect(p.gold).toBe(5000 - cost - res.fee);
        const herd = Livestock.herd(p, FARM);
        expect(herd.animals.length).toBe(5);
        // a cockerel among the hens (the herd had none)
        expect(herd.animals.filter(a => a.sex === 'm').length).toBe(1);
        expect(herd.animals.every(a => !Livestock.isYoung(a))).toBe(true);
        expect(Livestock.market(world, settlement).find(m => m.id === 'chicken').stock).toBe(before - 5);
        // ...and the pens fill again over the days
        world.day += 40;
        expect(Livestock.market(world, settlement).find(m => m.id === 'chicken').stock).toBe(before);
    });
});

describe('the herd by the day', () => {
    function farmWithHens(o = {}) {
        const w = makeWorld(o);
        const p = makePlayer(w.world, w.at, ['farm']);
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        for (let i = 0; i < 6; i++) Livestock._addHead(p, herd, 'chicken', 'f', 100);
        Livestock._addHead(p, herd, 'chicken', 'm', 100);
        return { ...w, p, herd };
    }

    it('hens lay into the store, collected into the packs; a cockerel lays nothing', () => {
        const { world, p, herd } = farmWithHens({ season: 'Summer' });
        days(world, p, 10);
        expect(herd.store.eggs).toBeGreaterThanOrEqual(20); // 6 hens × 0.4 × 1.25 × 10 days ≈ 30
        expect(herd.store.eggs).toBeLessThanOrEqual(31);
        const res = Livestock.collect(world, p, FARM);
        expect(res.success).toBe(true);
        expect(p.inventory.eggs).toBe(res.taken.eggs);
        expect(herd.store.eggs).toBeUndefined();
    });

    it('in spring, with a cockerel kept, chicks are born (young, room allowing); with none, none', () => {
        const { world, p, herd } = farmWithHens({ season: 'Spring' });
        const n0 = herd.animals.length;
        const notes = days(world, p, 40);
        expect(herd.animals.length).toBeGreaterThan(n0);
        expect(herd.animals.some(a => Livestock.isYoung(a))).toBe(true);
        expect(Livestock.used(herd)).toBeLessThanOrEqual(30);
        expect(notes.some(n => /born/.test(n.text))).toBe(true);

        const b = farmWithHens({ season: 'Spring' });
        b.herd.animals = b.herd.animals.filter(a => a.sex === 'f');
        days(b.world, b.p, 40);
        expect(b.herd.animals.some(a => Livestock.isYoung(a))).toBe(false);
    });

    it('fodder is bought when they cannot graze; unpaid, they go hungry and lay nothing', () => {
        const { world, p, herd } = farmWithHens({ season: 'Winter' });
        const bill = Livestock.feedCost(world, herd, Livestock.placeOf(world, p, FARM));
        expect(bill).toBeGreaterThan(0);
        const g0 = p.gold;
        days(world, p, 1);
        expect(p.gold).toBeCloseTo(g0 - bill, 1);
        // grazing in summer: no bill on a farm
        world.season = 'Summer';
        expect(Livestock.feedCost(world, herd, Livestock.placeOf(world, p, FARM))).toBe(0);
        world.season = 'Winter';
        p.gold = 0;
        herd.store = {};
        const notes = days(world, p, 3);
        expect(herd.hungry).toBe(3);
        expect(herd.store.eggs || 0).toBe(0);
        expect(notes.some(n => /fodder/i.test(n.text))).toBe(true);
        expect(herd.animals.every(a => a.hp < 100)).toBe(true);
    });

    it('sells back to the market nearby (spare males first), and slaughters at the yard into the packs', () => {
        const { world, settlement, p, herd } = farmWithHens();
        Livestock._addHead(p, herd, 'chicken', 'm', 120);
        const g0 = p.gold;
        const res = Livestock.sell(world, p, settlement, FARM, 'chicken', 2);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(g0 + res.earned);
        expect(herd.animals.filter(a => a.sex === 'm').length).toBe(1); // a spare cockerel sold, one kept
        expect(herd.animals.length).toBe(6);

        const s = Livestock.slaughter(world, p, FARM, 'chicken');
        expect(s.success).toBe(true);
        expect(herd.animals.length).toBe(5);
        expect(p.inventory.meat).toBeGreaterThanOrEqual(1);

        // Too far from the market: refused
        const far = makeWorld();
        const q = makePlayer(far.world, far.at, ['pasture']);
        const PAST = key('pasture', 7, 7);
        days(far.world, q, 1); // its founding flock
        expect(Livestock.sell(far.world, q, far.settlement, PAST, 'sheep', 1).success).toBe(false);
    });

    it('their place lost, the beasts are sold off', () => {
        const { world, at, p } = farmWithHens();
        at(6, 6).playerProperties = null;
        at(6, 6).playerProperty = null;
        p.properties = [];
        const g0 = p.gold;
        const notes = days(world, p, 1);
        expect(Livestock.state(p).herds.length).toBe(0);
        expect(p.gold).toBeGreaterThan(g0);
        expect(notes.some(n => /sold off/.test(n.text))).toBe(true);
    });

    it('draws its own dice: the shared stream is untouched', () => {
        const { world, p } = farmWithHens();
        Utils.setSeed(99);
        const a = [Utils.random(), Utils.random()];
        Utils.setSeed(99);
        Utils.random();
        days(world, p, 5);
        expect(Utils.random()).toBe(a[1]);
    });
});

describe('the working herds', () => {
    it('a Pasture gets its founding flock; its output follows the head kept there', () => {
        const { world, at } = makeWorld();
        const p = makePlayer(world, at, ['pasture']);
        const tile = at(7, 7);
        const prop = tile.playerProperties[0];
        expect(Livestock.workFactor(world, p, tile, prop)).toBe(1); // before the founding: as it always was
        const notes = days(world, p, 1);
        expect(notes.some(n => /founding/i.test(n.title) && /^24 sheep/.test(n.text))).toBe(true);
        expect(prop.herdFounded).toBe(true);
        const herd = Livestock.herd(p, key('pasture', 7, 7));
        // (any lamb born, or ewe lost, on the first day aside: the flock as founded)
        herd.animals = herd.animals.filter(a => !Livestock.isYoung(a));
        while (herd.animals.length < 24) Livestock._addHead(p, herd, 'sheep', 'f', 300);
        expect(herd.animals.length).toBe(24);
        expect(Livestock.workFactor(world, p, tile, prop)).toBeCloseTo(1, 5);
        // Shorn of half the flock, it makes half the wool...
        herd.animals.splice(0, 12);
        expect(Livestock.workFactor(world, p, tile, prop)).toBeCloseTo(0.5, 5);
        // ...and the working flock lays nothing of its own in the store (the property makes the wool)
        world.season = 'Spring';
        days(world, p, 5);
        expect(herd.store.wool || 0).toBe(0);
        // Founded once only
        days(world, p, 1);
        expect(herd.animals.filter(a => a.sp === 'sheep').length).toBeLessThan(24 + 20);
    });

    it('the Pasture’s wool follows its flock in the day’s production', () => {
        const run = (keep) => {
            const { world, at } = makeWorld({ season: 'Summer' });
            const p = makePlayer(world, at, ['pasture']);
            p.skills.commerce = 0;
            days(world, p, 1);
            const herd = Livestock.herd(p, key('pasture', 7, 7));
            herd.animals = [];
            for (let i = 0; i < keep; i++) Livestock._addHead(p, herd, 'sheep', i ? 'f' : 'm', 300);
            let wool = 0;
            for (let d = 0; d < 20; d++) wool += PlayerEconomy.produceGoods(p, world).wool || 0;
            return wool;
        };
        const full = run(24), half = run(12), none = run(0);
        expect(full).toBeGreaterThan(0);
        expect(half).toBeGreaterThan(full * 0.35);
        expect(half).toBeLessThan(full * 0.65);
        expect(none).toBe(0);
    });

    it('a farm’s horses lift its harvest, at most a fifth', () => {
        const { world, at } = makeWorld();
        const p = makePlayer(world, at, ['farm']);
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        const tile = at(6, 6);
        expect(Livestock.draftFactor(world, p, tile, tile.playerProperties[0])).toBe(1);
        Livestock._addHead(p, herd, 'horse', 'm', 900);
        expect(Livestock.draftFactor(world, p, tile, tile.playerProperties[0])).toBeCloseTo(1.05, 5);
        for (let i = 0; i < 2; i++) Livestock._addHead(p, herd, 'horse', 'f', 900);
        Livestock._addHead(p, herd, 'pig', 'f', 900);
        expect(Livestock.draftFactor(world, p, tile, tile.playerProperties[0])).toBeCloseTo(1.18, 5);
    });

    it('a horse is saddled as your mount, and a mount turned out again', () => {
        const { world, settlement, at } = makeWorld();
        const p = makePlayer(world, at, ['farm']);
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        Livestock._addHead(p, herd, 'horse', 'f', 900);
        Livestock._addHead(p, herd, 'horse', 'm', 30); // a foal: not ridden
        expect(p.mount).toBeFalsy();
        const r = Livestock.ride(world, p, FARM);
        expect(r.success).toBe(true);
        expect(p.mount).toMatchObject({ fromHerd: true, sex: 'f' });
        expect(herd.animals.length).toBe(1);
        expect(Livestock.ride(world, p, FARM).success).toBe(false);
        const back = Livestock.stableMount(world, p, FARM);
        expect(back.success).toBe(true);
        expect(p.mount).toBeNull();
        expect(herd.animals.filter(a => a.sp === 'horse').length).toBe(2);
        // ...or bought at the market to ride away
        const buy = Livestock.buy(world, p, settlement, 'horse', 1, null, { ride: true });
        expect(buy.success).toBe(true);
        expect(p.mount && p.mount.name).toBeTruthy();
    });
});

describe('saved with the player', () => {
    it('round-trips every head, the store and the counter', () => {
        const { world, at } = makeWorld();
        const p = makePlayer(world, at, ['farm']);
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        Livestock._addHead(p, herd, 'goat', 'f', 300);
        Livestock._addHead(p, herd, 'goat', 'm', 300);
        herd.store.milk = 7;
        herd.animals[0].sick = 4;
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        expect(json.livestock).toBeTruthy();
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.livestock).toEqual(p.livestock);
        expect(Livestock.herd(back, FARM).animals.map(a => a.sp)).toEqual(['goat', 'goat']);
        // the next head gets a fresh id
        expect(Livestock._addHead(back, Livestock.herd(back, FARM), 'goat', 'f', 0).id).toBe('a3');
    });
});

describe('on the inner map', () => {
    it('a beast without sheets of its own is drawn as its fallback, with its own name and butchering', () => {
        const pig = InnerMap.animalSpecies('pig');
        expect(pig).toBeTruthy();
        expect(pig.name).toBe((DataLoader.get('animals').species.pig || { name: 'Pig' }).name);
        expect(pig.sheets && pig.sheets.walk).toBeTruthy();
        expect(pig.livestock).toBe(true);
        if (!DataLoader.get('animals').species.pig) {
            expect(pig.sheets.walk).toBe(DataLoader.get('animals').species.sheep.sheets.walk);
            expect(pig.loot.some(l => l.item === 'meat')).toBe(true);
        }
        const horse = InnerMap.animalSpecies('horse');
        if (!DataLoader.get('animals').species.horse) expect(horse.sheets.walk).toBe(DataLoader.get('animals').species.highland_cow.sheets.walk);
        expect(InnerMap.animalSpecies('dragon')).toBeNull();
    });

    it('your herd stands at its place (at most a handful shown), yours to slaughter', () => {
        const { world, at } = makeWorld();
        const p = makePlayer(world, at, ['farm']);
        const herd = Livestock.herd(p, FARM, { kind: 'property', q: 6, r: 6, type: 'farm' });
        for (let i = 0; i < 20; i++) Livestock._addHead(p, herd, 'chicken', 'f', 100);
        Livestock._addHead(p, herd, 'pig', 'f', 200);
        const entries = Livestock.mapEntries(world, p, 6, 6);
        expect(entries.length).toBeLessThanOrEqual(11);
        expect(entries.some(e => e.species === 'pig')).toBe(true);
        expect(Livestock.mapEntries(world, p, 5, 6)).toEqual([]);

        const W = 64, H = 64;
        const tiles = [];
        for (let r = 0; r < H; r++) {
            const row = [];
            for (let q = 0; q < W; q++) row.push({ q, r, subTerrain: { id: 'grass', passable: true } });
            tiles.push(row);
        }
        const saved = { tiles: InnerMap.tiles, animals: InnerMap.animals, width: InnerMap.width, height: InnerMap.height, _animalBuiltDist: InnerMap._animalBuiltDist };
        try {
            Object.assign(InnerMap, { tiles, animals: [], width: W, height: H, _animalBuiltDist: null });
            const placed = InnerMap.addOwnedAnimals(entries, {});
            expect(placed.length).toBe(entries.length);
            for (const a of placed) {
                expect(a.ownedBy).toBe('player');
                expect(a.owner.player).toBe(true);
                expect(a.livestock).toBe(true);
            }
            // The same spot each visit
            const again = InnerMap.addOwnedAnimals(entries, {});
            void again;
            const first = placed[0];
            InnerMap.animals = [];
            const replay = InnerMap.addOwnedAnimals(entries, {});
            expect([replay[0].q, replay[0].r]).toEqual([first.q, first.r]);
            // Slaughtered: gone from the herd
            const n = herd.animals.length;
            Livestock.removeHead(p, replay[0].ownedHerd, replay[0].ownedId);
            expect(herd.animals.length).toBe(n - 1);
        } finally {
            Object.assign(InnerMap, saved);
        }
    });
});
