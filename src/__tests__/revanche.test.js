// Revanche (world/revanche.js): every realm remembers the towns it lost, a lost
// town is a casus belli on its holder (KingdomAI.considerWar, a reclaim war won
// once it is retaken), the claim fades over decades (a lost seat much slower),
// a victor's peace may return a town, the people remember the old crown
// (PeasantRevolts 'oldCrown'), and the player's realm sees and is urged to it.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Revanche } from '../world/revanche.js';
import { Seasons } from '../world/seasons.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Throne } from '../systems/throne.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

const YEAR = Revanche.YEAR;

function kingdom(id, extra = {}) {
    return {
        id, name: `Realm ${id}`, isAlive: true, territory: [], wars: [], allies: [], relations: {}, truces: {},
        military: 500, treasury: 1000, population: 10000, stability: 60, ...extra,
    };
}

/**
 * A three-realm strip: A holds columns 0-1 (its seat Aton at 0,1, the village
 * Ash at 1,0), B columns 2-3 (its seat Bury at 3,1, the village Bree at 2,2),
 * C columns 4-5 (Cray at 5,1).
 */
function makeWorld() {
    const tiles = {};
    const a = kingdom('A');
    const b = kingdom('B');
    const c = kingdom('C');
    for (let q = 0; q < 6; q++) {
        for (let r = 0; r < 3; r++) {
            const owner = q < 2 ? a : q < 4 ? b : c;
            tiles[`${q},${r}`] = { q, r, kingdom: owner.id, terrain: { id: 'plains', passable: true } };
            owner.territory.push({ q, r });
        }
    }
    tiles['0,1'].settlement = { name: 'Aton', type: 'capital', kingdom: 'A', population: 5000, q: 0, r: 1 };
    tiles['1,0'].settlement = { name: 'Ash', type: 'village', kingdom: 'A', population: 400, q: 1, r: 0 };
    tiles['3,1'].settlement = { name: 'Bury', type: 'capital', kingdom: 'B', population: 5000, q: 3, r: 1 };
    tiles['2,2'].settlement = { name: 'Bree', type: 'village', kingdom: 'B', population: 400, q: 2, r: 2 };
    tiles['5,1'].settlement = { name: 'Cray', type: 'capital', kingdom: 'C', population: 5000, q: 5, r: 1 };
    a.capital = { q: 0, r: 1 };
    b.capital = { q: 3, r: 1 };
    c.capital = { q: 5, r: 1 };
    const ks = [a, b, c];
    const world = {
        day: 2000, width: 100, height: 100, events: [], kingdoms: ks, tiles,
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: (id) => ks.find(k => k.id === id) || null,
        getAllSettlements: () => Object.values(tiles).filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
        getSettlementViews: () => Object.values(tiles).filter(t => t.settlement).map(t => t.settlement),
    };
    return { world, a, b, c };
}

/** B takes A's town at q,r by force (a won battle). */
function takes(world, b, a, q, r) {
    KingdomAI.takeTile(b, a, world, q, r);
    KingdomAI.afterTownLoss(a, b, world);
}

describe('Revanche — the memory of a loss', () => {
    it('a realm writes down the town it lost: who took it, when, its seat or not', () => {
        const { world, a, b } = makeWorld();
        takes(world, b, a, 0, 1);
        expect(a.lostTowns).toHaveLength(1);
        expect(a.lostTowns[0]).toMatchObject({ q: 0, r: 1, name: 'Aton', by: 'B', byName: 'Realm B', day: 2000, capital: true, native: true });
        // the court fled to Ash; the seat it lost weighs most
        expect(a.capital).toEqual({ q: 1, r: 0 });
        expect(Revanche.claimOn(world, a, b)).toBeCloseTo(Revanche.config().capitalWeight, 5);
        expect(b.lostTowns || []).toHaveLength(0);
        // a mere village weighs one
        const w2 = makeWorld();
        takes(w2.world, w2.b, w2.a, 1, 0);
        expect(w2.a.lostTowns[0].capital).toBe(false);
        expect(Revanche.claimOn(w2.world, w2.a, w2.b)).toBeCloseTo(Revanche.config().townWeight, 5);
    });

    it('the claim follows the town to whoever holds it now, and a town it had only conquered weighs less', () => {
        const { world, a, b, c } = makeWorld();
        takes(world, b, a, 1, 0);
        // C takes Ash from B: A's claim is now on C; B (which only held it by conquest) claims a share
        takes(world, c, b, 1, 0);
        expect(Revanche.claimOn(world, a, b)).toBe(0);
        expect(Revanche.claimOn(world, a, c)).toBeCloseTo(1, 5);
        expect(b.lostTowns[0].native).toBe(false);
        expect(Revanche.claimOn(world, b, c)).toBeCloseTo(Revanche.config().conqueredShare, 5);
        // the townsfolk remember the heaviest claimant
        expect(Revanche.townIndex(world).get('1,0')).toMatchObject({ kingdomId: 'A' });
    });

    it('fades over decades — a lost seat far slower than a town — and is forgotten at last', () => {
        const C = Revanche.config();
        const { world, a, b } = makeWorld();
        takes(world, b, a, 1, 0);
        takes(world, b, a, 0, 1);
        const town = () => Revanche.claims(world, a).find(x => x.rec.name === 'Ash');
        const seat = () => Revanche.claims(world, a).find(x => x.rec.name === 'Aton');
        world.day += C.halfLifeYears * YEAR;
        expect(town().w).toBeCloseTo(C.townWeight / 2, 5);
        expect(seat().w).toBeCloseTo(C.capitalWeight * Math.pow(0.5, C.halfLifeYears / C.capitalHalfLifeYears), 5);
        world.day += 60 * YEAR;
        expect(town()).toBeUndefined();
        expect(seat().w).toBeGreaterThan(C.minWeight);
        world.day += 200 * YEAR;
        expect(Revanche.claims(world, a)).toEqual([]);
        Revanche.prune(world, a);
        expect(a.lostTowns).toEqual([]);
    });
});

describe('Revanche — a casus belli', () => {
    it('a lost town warms the grudge: a court at cool regard marches on its holder, never without the claim', () => {
        const { world, a, b, c } = makeWorld();
        a.military = 5000;
        b.military = 100; c.military = 100;
        a.relations.B = -25; a.relations.C = -25;
        KingdomAI.considerWar(a, world);
        expect(a.wars).toEqual([]); // −25 is no grudge (−30)
        // B took Ash long ago — A remembers
        takes(world, b, a, 1, 0);
        world.day += YEAR;
        a.relations.B = -25;
        KingdomAI.considerWar(a, world);
        expect(a.wars).toEqual(['B']);
        expect(a.warState.B.reclaim).toBe(true);
        expect(world.events.at(-1).text).toMatch(/to win back Ash/);
    });

    it('the holder of its towns is picked before any other foe', () => {
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            Utils.setSeed(seed);
            const { world, a, b, c } = makeWorld();
            takes(world, b, a, 1, 0);
            world.day += YEAR;
            a.military = 50000;
            a.relations.B = -60; a.relations.C = -90;
            KingdomAI.considerWar(a, world);
            expect(a.wars).toEqual(['B']);
            expect(c.wars).toEqual([]);
        }
    });

    it('a realm marches to win back its seat at a lesser strength than it would otherwise', () => {
        const ease = Revanche.ease(Revanche.config().capitalWeight);
        expect(ease).toBeGreaterThan(0);
        // the same strength and the same seed, with and without the claim: just short of
        // what it would want (warRatio 1, the season's confidence), but over it eased
        const tryWar = (claim) => {
            const w = makeWorld();
            w.a.traits = ['militaristic'];
            if (claim) { takes(w.world, w.b, w.a, 1, 0); takes(w.world, w.b, w.a, 0, 1); }
            w.a.relations.B = -80;
            w.a.population = 0; w.b.population = 0;
            w.b.military = 1000;
            const conf = (1 + (Seasons.campaignFactor(Seasons.today(w.world)) - 1) * 0.5) * EconomyIndex.warConfidence(w.world, w.a);
            const eased = Revanche.ease(Revanche.claimOn(w.world, w.a, w.b));
            w.a.military = Math.round(1000 * (1 - (claim ? eased : ease) / 2) / conf);
            Utils.setSeed(77);
            KingdomAI.considerWar(w.a, w.world);
            return w.a.wars.includes('B');
        };
        expect(tryWar(true)).toBe(true);
        expect(tryWar(false)).toBe(false);
    });

    it('a reclaim war is won once the town is back, and the realm says so', () => {
        const { world, a, b } = makeWorld();
        takes(world, b, a, 1, 0);
        KingdomAI.startWar(a, b, world);
        const ws = a.warState.B;
        expect(ws.reclaim).toBe(true);
        ws.goal = 99;
        const r = KingdomAI.takeTile(a, b, world, 1, 0);
        expect(r.reclaimed).toBe(true);
        expect(world.events.at(-1).text).toMatch(/wins back Ash/);
        expect(ws.gains).toBeGreaterThanOrEqual(ws.goal);
        expect(Revanche.claims(world, a)).toEqual([]);
        // B now remembers the town it lost (one it had won): a light claim
        expect(Revanche.claimOn(world, b, a)).toBeCloseTo(Revanche.config().conqueredShare, 5);
        KingdomAI._resolveWar(a, b, world);
        expect(a.wars).not.toContain('B');
        expect(world.warHistory.at(-1).victor).toBe('A');
    });
});

describe('Revanche — the peace', () => {
    it('a victor\'s peace after a reclaim war returns the town, with the land about it', () => {
        const { world, a, b } = makeWorld();
        takes(world, b, a, 1, 0);
        KingdomAI.startWar(a, b, world);
        KingdomAI.endWar(a, b, world, { victor: a });
        const tile = world.getTile(1, 0);
        expect(tile.settlement.kingdom).toBe('A');
        expect(tile.kingdom).toBe('A');
        expect(a.territory.some(t => t.q === 1 && t.r === 0)).toBe(true);
        expect(b.territory.some(t => t.q === 1 && t.r === 0)).toBe(false);
        expect(Revanche.claims(world, a)).toEqual([]);
        expect(b.lostTowns.at(-1)).toMatchObject({ name: 'Ash', native: false, by: 'A' });
        expect(world.events.some(e => /returns Ash to Realm A/.test(e.text))).toBe(true);
    });

    it('never the loser\'s last town; a lost war returns nothing; peaceReturn 0 keeps an ordinary war\'s peace', () => {
        const C = Revanche.config();
        // B's last town is the claimed one
        {
            const { world, a, b } = makeWorld();
            takes(world, b, a, 1, 0);
            world.getTile(3, 1).settlement.kingdom = 'X';
            world.getTile(2, 2).settlement.kingdom = 'X';
            KingdomAI.startWar(a, b, world);
            KingdomAI.endWar(a, b, world, { victor: a });
            expect(world.getTile(1, 0).settlement.kingdom).toBe('B');
        }
        // A loses the war: no return
        {
            const { world, a, b } = makeWorld();
            takes(world, b, a, 1, 0);
            KingdomAI.startWar(a, b, world);
            KingdomAI.endWar(a, b, world, { victor: b });
            expect(world.getTile(1, 0).settlement.kingdom).toBe('B');
        }
        // An ordinary war (no reclaim goal) with peaceReturn 0
        {
            const was = C.peaceReturn;
            DataLoader.kingship.config.revanche.peaceReturn = 0;
            try {
                const { world, a, b } = makeWorld();
                KingdomAI.startWar(a, b, world);
                takes(world, b, a, 1, 0); // taken during the war: no claim when it began
                KingdomAI.endWar(a, b, world, { victor: a });
                expect(world.getTile(1, 0).settlement.kingdom).toBe('B');
            } finally {
                DataLoader.kingship.config.revanche.peaceReturn = was;
            }
        }
    });

    it('the people of a lost town remember the old crown', () => {
        const { world, a, b } = makeWorld();
        const s = world.getTile(1, 0).settlement;
        s.population = 400;
        const part = () => PeasantRevolts.pressure(world, s).parts.find(p => p.id === 'oldCrown');
        expect(part()).toBeUndefined();
        takes(world, b, a, 1, 0);
        expect(part().v).toBeCloseTo(Revanche.config().townWeight * PeasantRevolts.config().pressure.oldCrown.per, 1);
        world.day += 80 * YEAR;
        expect(part()).toBeUndefined();
    });
});

describe('Revanche — the player\'s realm', () => {
    function makeGenWorld(seed = 11) {
        Utils.setSeed(seed);
        const world = new World(40, 30);
        world.generate({ kingdomCount: 4 });
        world.day = 600;
        return world;
    }
    function makePlayer(world) {
        const player = {
            id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
            gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
            skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
            relationships: {}, actionPoints: 10, army: [],
        };
        Relationships.initialize(player);
        House.initialize(player, world);
        return player;
    }
    /** A ruled realm that lost a town to its neighbour. */
    function setup() {
        const world = makeGenWorld();
        const player = makePlayer(world);
        const all = world.getAllSettlements();
        const k = world.kingdoms.find(x => x.isAlive && all.filter(s => s.kingdom === x.id).length >= 2);
        Throne._takeThrone(player, world, k);
        const foe = world.kingdoms.find(o => o.isAlive && o.id !== k.id);
        const town = KingdomAI._settlementsOf(k, world).find(t => !(t.q === k.capital.q && t.r === k.capital.r));
        KingdomAI.takeTile(foe, k, world, town.q, town.r);
        for (const x of [k, foe]) { x.wars = []; x.truces = {}; if (x.warState) delete x.warState[x === k ? foe.id : k.id]; }
        k.allies = (k.allies || []).filter(id => id !== foe.id);
        foe.allies = (foe.allies || []).filter(id => id !== k.id);
        return { world, player, k, foe, town };
    }

    it('lists its lost towns, and a war on the holder is a reclaim war', () => {
        const { world, player, k, foe, town } = setup();
        const lost = Throne.lostTowns(player, world);
        expect(lost).toHaveLength(1);
        expect(lost[0]).toMatchObject({ name: town.settlement.name, holderId: foe.id, capital: false });
        const d = Throne.diplomacyTargets(player, world).find(x => x.kingdom.id === foe.id);
        expect(d.claim).toBeGreaterThan(0);
        expect(d.reclaim[0].name).toBe(town.settlement.name);
        const res = Throne.declareRealmWar(player, world, foe.id);
        expect(res.success).toBe(true);
        expect(res.reclaim).toBe(true);
        expect(k.warState[foe.id].reclaim).toBe(true);
    });

    it('its lords urge a reckoning by letter when the realm is strong enough; marching declares the war', () => {
        const { world, player, k, foe, town } = setup();
        k.military = 1e5;
        const out = { notices: [], arrived: [] };
        CourtLetters._reclaimUrge(world, player, out);
        expect(out.arrived).toHaveLength(1);
        const letter = out.arrived[0];
        expect(letter.kind).toBe('reclaim_urged');
        expect(letter.subject).toContain(town.settlement.name);
        // once a year a holder, and silence costs nothing
        CourtLetters._reclaimUrge(world, player, out);
        expect(out.arrived).toHaveLength(1);
        expect(CourtLetters.lapseCosts(world, player, letter).special).toBe('none');
        const res = CourtLetters.answer(player, world, letter.id, 'march');
        expect(res.success).toBe(true);
        expect(k.wars).toContain(foe.id);
        // a weak realm is not urged
        const s2 = setup();
        s2.k.military = 0;
        s2.k.population = 0;
        const o2 = { notices: [], arrived: [] };
        CourtLetters._reclaimUrge(s2.world, s2.player, o2);
        expect(o2.arrived).toHaveLength(0);
    });

    it('survives a save', () => {
        const { world, k } = setup();
        const before = JSON.parse(JSON.stringify(k.lostTowns));
        expect(before).toHaveLength(1);
        const saved = JSON.parse(JSON.stringify({ world: SaveLoad.serializeWorld(world) }));
        Utils.setSeed(11);
        const fresh = new World(40, 30);
        fresh.generate({ kingdomCount: 4 });
        SaveLoad.restoreWorld(saved.world, fresh);
        const back = fresh.getKingdom(k.id);
        expect(back.lostTowns).toEqual(before);
        const holder = fresh.getKingdom(before[0].by);
        expect(Revanche.claimOn(fresh, back, holder)).toBeCloseTo(Revanche.claimOn(world, k, world.getKingdom(before[0].by)), 6);
    });
});
