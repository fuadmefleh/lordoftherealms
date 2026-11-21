/**
 * Winter ice on the street map, cell by cell (world/innerMap/ice.js): thin over
 * a river's channel, by open water, early in the frost and in a warm spell;
 * skating on solid ice and slipping; thin ice breaking under you into the cold
 * water (player/icyWater.js); the hole kept on the world, then skinned over.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMap, WinterIce } from '../world/innerMap.js';
import { IcyWater } from '../player/icyWater.js';
import { Player } from '../player/player.js';
import { Ailments } from '../systems/ailments.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

// Days of the year: winter is 91-120 (mid-winter 105)
const MIDWINTER = 120 * 3 + 105;

/** A world of one kind of weather (as streetSeasons.test.js): every hex this warm. */
function world({ temperature = 0.2, day = MIDWINTER } = {}) {
    const tile = { q: 5, r: 5, temperature, terrain: { id: 'grassland' } };
    return {
        day,
        generationParams: { seed: 7 },
        weather: { seed: 99, precipitation: (q, r, d) => (d % 3 === 0 ? 0.85 : 0.3) },
        getTile: (q, r) => (q === 5 && r === 5 ? tile : null),
    };
}

/**
 * A W×8 green with water across columns a..b: a pond, or a river running down
 * the map (its cells with a flow, as world/innerMap/water.js lays them).
 */
function lay({ W = 14, a = 5, b = 8, river = false } = {}) {
    const tiles = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = q >= a && q <= b;
            const t = {
                q, r, explored: true, visible: true, baseTerrain: wet ? 'water' : 'grass',
                subTerrain: wet ? { id: river ? 'river_water' : 'pond_water', passable: false } : { id: 'grass', passable: true },
                _wet: wet,
            };
            if (wet) t._waterKind = river ? 'river' : 'pond';
            if (wet && river) t._flow = { x: 0, y: 1 };
            row.push(t);
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = 8;
    InnerMap._insideBuilding = null;
    InnerMap._underwater = false;
    InnerMap._aboardBoat = false;
    InnerMap._swimAllowed = true;
    InnerMap._rideSpeed = 0;
    InnerMap._iceGear = null;
    InnerMap._iceDown = 0;
    InnerMap._skate = null;
    InnerMap._ssEvent = null;
    InnerMap._ssThinSteps = 0;
    InnerMap._iceWorld = null;
    InnerMap._iceHex = '5,5';
    InnerMap.playerInnerQ = 1;
    InnerMap.playerInnerR = 3;
    InnerMap.npcs = [];
    InnerMap.cancelPlayerWalk();
    return tiles;
}

/** The ice of a day by hand: thickness, the air, thawing or not. */
const season = (ice, celsius = -6, thawing = false) => ({ winterLook: true, ice, celsius, thawing });

describe('thin and solid, cell by cell', () => {
    beforeEach(() => { lay(); Utils.setSeed(5); });

    it('a river freezes solid by its banks before its running channel', () => {
        const st = { ice: 1.0, celsius: -6 };
        const bank = WinterIce.cellThickness(st, { kind: 'river', channel: false });
        const channel = WinterIce.cellThickness(st, { kind: 'river', channel: true });
        expect(WinterIce.classify(bank).state).toBe('solid');
        expect(WinterIce.classify(channel).state).toBe('thin');
        // on the map: banks solid, the middle (with the current) thin
        lay({ river: true });
        InnerMap._reconcileIce(season(1.0), MIDWINTER);
        for (let r = 0; r < 8; r++) {
            expect(InnerMap.iceAt(5, r)).toBe(2);
            expect(InnerMap.iceAt(8, r)).toBe(2);
            expect(InnerMap.iceAt(6, r)).toBe(1);
            expect(InnerMap.iceAt(7, r)).toBe(1);
        }
    });

    it('a pond is thin early in the frost, solid in its depth, thin again in a warm spell', () => {
        InnerMap._reconcileIce(season(0.4), MIDWINTER);
        expect(InnerMap.iceAt(6, 3)).toBe(1);
        InnerMap._reconcileIce(season(1.2), MIDWINTER);
        expect(InnerMap.iceAt(6, 3)).toBe(2);
        // the same ice, a thaw of six degrees: thinner
        expect(WinterIce.cellThickness({ ice: 0.7, celsius: 6 }, { kind: 'pond' })).toBeLessThan(WinterIce.cellThickness({ ice: 0.7, celsius: -2 }, { kind: 'pond' }));
        InnerMap._reconcileIce(season(0.7, 6), MIDWINTER);
        expect(InnerMap.iceAt(6, 3)).toBe(1);
        // the sea never freezes
        expect(WinterIce.cellThickness({ ice: 1.4 }, { kind: 'sea' })).toBe(0);
    });

    it('the ice is thin round open water — a hole broken through', () => {
        InnerMap._ssDay = MIDWINTER;
        InnerMap._reconcileIce(season(0.7), MIDWINTER);
        expect(InnerMap.iceAt(6, 3)).toBe(2);
        expect(InnerMap.iceAt(7, 3)).toBe(2);
        InnerMap._breakIce(6, 3);
        InnerMap._reconcileIce(season(0.7), MIDWINTER);
        expect(InnerMap.iceAt(6, 3)).toBe(0);
        expect(InnerMap.isSwimmable(6, 3)).toBe(true);
        for (const [q, r] of [[5, 3], [7, 3], [6, 2], [6, 4]]) expect(InnerMap.iceAt(q, r)).toBe(1);
        // far from it, solid as before
        expect(InnerMap.iceAt(8, 7)).toBe(2);
    });
});

describe('skating', () => {
    /** Walk east across a long frozen pond for `secs` seconds; → how far they got. */
    function skate(gear, secs = 3) {
        lay({ W: 40, a: 2, b: 37 });
        InnerMap._reconcileIce(season(1.3), MIDWINTER);
        InnerMap.playerInnerQ = 2;
        InnerMap._iceGear = gear;
        Utils.setSeed(21);
        InnerMap.movePlayerTo(37, 3);
        const dt = 1 / 60;
        for (let i = 0; i < secs * 60; i++) { InnerMap._iceTick(dt); InnerMap.updatePlayer(dt); }
        return InnerMap.playerInnerQ - 2;
    }

    it('on skates you go faster than a walk over solid ice', () => {
        const walk = skate(null);
        const bone = skate({ skates: 'bone_skates' });
        const iron = skate({ skates: 'iron_skates' });
        expect(bone).toBeGreaterThan(walk);
        expect(iron).toBeGreaterThan(bone);
        expect(InnerMap._skate.v).toBeGreaterThan(1.5);
    });

    it('a skater glides on past where the walk ends; a turn loses speed', () => {
        lay({ W: 40, a: 2, b: 37 });
        InnerMap._reconcileIce(season(1.3), MIDWINTER);
        InnerMap.playerInnerQ = 2;
        InnerMap._iceGear = { skates: 'iron_skates' };
        Utils.setSeed(3);
        InnerMap.movePlayerTo(20, 3);
        for (let i = 0; i < 600 && InnerMap._playerWalking; i++) { InnerMap._iceTick(1 / 60); InnerMap.updatePlayer(1 / 60); }
        expect(InnerMap.playerInnerQ).toBeGreaterThan(20);
        // a sharp turn at speed keeps only part of it
        const s = InnerMap._skate;
        s.v = 2; s.dq = 1; s.dr = 0;
        InnerMap._playerPrevQ = InnerMap.playerInnerQ; InnerMap._playerPrevR = 2;
        InnerMap._iceGear = { skates: 'iron_skates' };
        Utils.setSeed(99);
        InnerMap._iceStepped(InnerMap.playerInnerQ, 3, InnerMap.tiles[3][InnerMap.playerInnerQ]);
        expect(s.v).toBeLessThan(1.7);
    });

    it('on foot you slip now and then, and lie a moment before going on', () => {
        lay();
        InnerMap._reconcileIce(season(1.3), MIDWINTER);
        Utils.setSeed(8);
        let slips = 0;
        for (let i = 0; i < 400; i++) {
            InnerMap._iceDown = 0;
            InnerMap._playerPrevQ = 5; InnerMap._playerPrevR = 3;
            const ev = InnerMap._iceStepped(6, 3, InnerMap.tiles[3][6]);
            if (ev && ev.kind === 'slip') slips++;
        }
        expect(slips).toBeGreaterThan(4);
        expect(slips).toBeLessThan(60);
        // down: no walking till the seconds pass
        InnerMap._iceFall();
        expect(InnerMap._icePace({ q: 7, r: 3 }, 1 / 60)).toBe(0);
        InnerMap._iceTick(5);
        expect(InnerMap._icePace({ q: 7, r: 3 }, 1 / 60)).toBe(1);
        // skates hardly ever throw you
        expect(WinterIce.slipChance({ skates: 'iron_skates' }, 2)).toBeLessThan(WinterIce.slipChance(null, 2) / 4);
        const p = new Player(); p.health = 50;
        IcyWater.fall(p);
        expect(p.health).toBeLessThan(50);
    });

    it('a horse balks at thin ice; a pack, a cart, a horse make it likelier to break', () => {
        lay();
        InnerMap._reconcileIce(season(0.4), MIDWINTER);
        InnerMap.playerInnerQ = 4;
        InnerMap._rideSpeed = 1.6;
        expect(InnerMap._icePace({ q: 5, r: 3 }, 1 / 60)).toBe(0);
        expect(InnerMap._ssEvent && InnerMap._ssEvent.kind).toBe('balk');
        expect(InnerMap._iceCrackMult()).toBeGreaterThan(3);
        InnerMap._rideSpeed = 0;
        expect(InnerMap._iceCrackMult()).toBe(1);
        expect(WinterIce.crackMult({ laden: 1 })).toBeGreaterThan(1.5);
        expect(WinterIce.crackMult({ cart: true })).toBeGreaterThan(3);
    });
});

describe('through the ice', () => {
    beforeEach(() => { lay(); Utils.setSeed(13); });

    it('thin ice gives way: into the water, swimming, and the cold bites by the second', () => {
        InnerMap._reconcileIce(season(0.4), MIDWINTER);
        InnerMap._ssDay = MIDWINTER;
        for (const row of InnerMap.tiles) for (const t of row) if (t._iced) t._iceStrength = 0;
        InnerMap.playerInnerQ = 6; InnerMap._playerPrevQ = 6; InnerMap._playerPrevR = 3;
        let ev = null;
        for (let i = 0; i < 300 && !(ev && ev.kind === 'crack'); i++) ev = InnerMap._iceStep(6, 3);
        expect(ev.kind).toBe('crack');
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        const p = new Player();
        p.health = 100;
        IcyWater.plunge(p);
        const before = p.health;
        let secs = 0;
        for (let i = 0; i < 10; i++) { IcyWater.tick(p, 1, secs); secs += 1; }
        expect(p.health).toBeLessThan(before - 8);
        // out of it after ten seconds: a chill
        const out = IcyWater.out(p, { day: MIDWINTER }, secs);
        expect(out.ailment).toBeTruthy();
        expect(Ailments.has(p, 'chill')).toBe(true);
        // too long in it: dead of the cold
        p.health = 2;
        expect(IcyWater.tick(p, 5, 30).dead).toBe(true);
    });

    it('the hole is kept on the world, open a few days, then thin, then frozen hard', () => {
        const w = world();
        InnerMap.season = 'Winter';
        InnerMap._bindStreetSeason(w, w.getTile(5, 5), 5, 5);
        expect(InnerMap.iceAt(6, 3)).toBe(2);
        InnerMap._breakIce(6, 3);
        expect(w.iceHoles['5,5']['6,3']).toBe(MIDWINTER);
        // the map dealt again (a new visit) the next day: the hole still there
        lay();
        const w1 = Object.assign(world({ day: MIDWINTER + 1 }), { iceHoles: w.iceHoles });
        InnerMap._bindStreetSeason(w1, w1.getTile(5, 5), 5, 5);
        expect(InnerMap.iceAt(6, 3)).toBe(0);
        expect(InnerMap.isSwimmable(6, 3)).toBe(true);
        // a few days on: skinned over, thin
        lay();
        const w3 = Object.assign(world({ day: MIDWINTER + 3 }), { iceHoles: w.iceHoles });
        InnerMap._bindStreetSeason(w3, w3.getTile(5, 5), 5, 5);
        expect(InnerMap.iceAt(6, 3)).toBe(1);
        // a week on: hard again, and forgotten
        lay();
        const w7 = Object.assign(world({ day: MIDWINTER + 7 }), { iceHoles: w.iceHoles });
        InnerMap._bindStreetSeason(w7, w7.getTile(5, 5), 5, 5);
        expect(InnerMap.iceAt(6, 3)).toBe(2);
        expect(w.iceHoles['5,5']).toBeUndefined();
    });
});

describe('townsfolk on the ice', () => {
    beforeEach(() => { lay(); Utils.setSeed(17); });

    it('of a winter afternoon they go skating, hop to hop', () => {
        InnerMap._ss = { ...season(1.3), solidCells: 1 };
        InnerMap._reconcileIce(InnerMap._ss, MIDWINTER);
        InnerMap._ss.solidCells = 32;
        InnerMap.timeOfDay = 14;
        const went = [];
        const goStand = InnerMap._goStand;
        InnerMap._goStand = (npc, spot, act) => { went.push({ spot, act }); return true; };
        try {
            const kid = { id: 1, q: 2, r: 3, type: 'child' };
            let picked = false;
            for (let i = 0; i < 20 && !picked; i++) picked = InnerMap._iceSkatePick(kid, 'afternoon');
            expect(picked).toBe(true);
            expect(went[0].act).toBe('ss_skate');
            expect(InnerMap.iceAt(went[0].spot.q, went[0].spot.r)).toBe(2);
            InnerMap._iceSkateArrived(kid);
            expect(kid.activity).toMatchObject({ type: 'season', label: 'Skating on the ice' });
            // still hops to go: on across the ice without asking again
            if (kid._skateHops > 0) expect(InnerMap._iceSkatePick(kid, 'afternoon')).toBe(true);
            // not of a morning
            InnerMap.timeOfDay = 9;
            expect(InnerMap._iceSkatePick({ id: 2, q: 2, r: 3, type: 'child' }, 'morning')).toBe(false);
        } finally {
            InnerMap._goStand = goStand;
            InnerMap._ss = null;
        }
    });
});

describe('the same seed, the same ice', () => {
    it('slips, cracks and a skater\'s way repeat exactly', () => {
        const run = () => {
            lay({ W: 40, a: 2, b: 37 });
            InnerMap._reconcileIce(season(0.62), MIDWINTER);
            InnerMap._ssDay = MIDWINTER;
            InnerMap.playerInnerQ = 2;
            Utils.setSeed(1234);
            InnerMap._iceGear = { skates: 'bone_skates' };
            InnerMap.movePlayerTo(37, 3);
            const log = [];
            for (let i = 0; i < 900; i++) {
                InnerMap._iceTick(1 / 60);
                const res = InnerMap.updatePlayer(1 / 60);
                if (InnerMap._ssEvent) { log.push(`${InnerMap._ssEvent.kind}@${InnerMap.playerInnerQ}`); InnerMap._ssEvent = null; }
                if (res && res.fellThrough) break;
            }
            log.push(`end@${InnerMap.playerInnerQ},${InnerMap.playerInnerR}`);
            return log.join(' ');
        };
        expect(run()).toBe(run());
    });
});
