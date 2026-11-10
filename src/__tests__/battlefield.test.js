/**
 * The battlefield (player/battlefield.js): a field battle fought out on the
 * ground — companies drawn up from the real army, orders, volleys, melee,
 * morale and rout, the retreat, determinism from the seed, and the aftermath
 * through FieldBattle.finish (losses from the companies' own units, spoils
 * out of the beaten side's purse, the world unit's fate).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WorldUnit } from '../world/units.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { Battlefield } from '../player/battlefield.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(terrain = 'plains') {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: terrain, passable: true }, settlement: null });
        return tiles.get(key);
    };
    return { width: 60, height: 60, day: 10, events: [], units: [], kingdoms: [], getTile, getKingdom: () => null };
}

function makePlayer(overrides = {}) {
    return {
        name: 'Ash', q: 0, r: 0, gold: 1000, karma: 0, renown: 0, health: 100, maxHealth: 100,
        strength: 5, charisma: 5,
        inventory: {}, properties: [], reputation: {}, blessings: {},
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        army: [], colonies: [],
        ...overrides,
    };
}

function army(spec) {
    const out = [];
    for (const [type, n, strength] of spec) {
        for (let i = 0; i < n; i++) out.push({ type, name: `${type}${i}`, strength, level: 1, upkeep: 1, experience: 0 });
    }
    return out;
}

function makeUnit(type, strength, world, gold = 0) {
    const u = new WorldUnit(type, 1, 0);
    u.strength = strength;
    u.inventory = { gold };
    world.units.push(u);
    return u;
}

function setUp({ playerArmy, enemyStrength = 60, enemyType = 'raider', seed = 7, gold = 120 }) {
    Utils.setSeed(seed);
    const world = makeWorld();
    const player = makePlayer({ army: army(playerArmy) });
    const unit = makeUnit(enemyType, enemyStrength, world, gold);
    const { enemy, ctx } = FieldBattle.unitEnemy(player, unit, world);
    const battle = FieldBattle.start(player, enemy, world, ctx);
    const field = Battlefield.openField(64, 40);
    const bf = Battlefield.create(player, battle, field, { world, prefer: { q: 32, r: 20 } });
    return { world, player, unit, battle, field, bf };
}

describe('drawing up the battlefield', () => {
    it('makes companies from the army by role, with figures for their strength, facing each other', () => {
        const { bf, battle } = setUp({ playerArmy: [['soldier', 4, 10], ['archer', 3, 8], ['cavalry', 2, 18]] });
        const mine = bf.companies.filter(c => c.side === 'player');
        expect(new Set(mine.map(c => c.kind))).toEqual(new Set(['foot', 'archer', 'horse']));
        // Each company carries its own units, and the side's strength is whole
        expect(mine.find(c => c.kind === 'foot').units.every(u => u.type === 'soldier')).toBe(true);
        const s = Battlefield.strengths(bf);
        expect(s.pStr).toBeCloseTo(battle.sim.pStr, 3);
        expect(s.eStr).toBeCloseTo(battle.sim.eStr, 3);
        // Player on the west facing east, the enemy on the east facing west
        const px = mine.reduce((a, c) => a + c.x, 0) / mine.length;
        const theirs = bf.companies.filter(c => c.side === 'enemy');
        const ex = theirs.reduce((a, c) => a + c.x, 0) / theirs.length;
        expect(px).toBeLessThan(ex);
        expect(mine[0].dx).toBe(1);
        expect(theirs[0].dx).toBe(-1);
        for (const c of bf.companies) expect(c.figures.length).toBeGreaterThanOrEqual(3);
        expect(bf.commander).toBeTruthy();
    });

    it('figures stand on passable ground', () => {
        Utils.setSeed(3);
        const world = makeWorld();
        const player = makePlayer({ army: army([['soldier', 6, 10]]) });
        const unit = makeUnit('raider', 40, world);
        const { enemy, ctx } = FieldBattle.unitEnemy(player, unit, world);
        const battle = FieldBattle.start(player, enemy, world, ctx);
        // a stream down the middle of the field
        const field = Battlefield.openField(64, 40, { water: (q) => q === 32 || q === 33 });
        const bf = Battlefield.create(player, battle, field, { world });
        for (const c of bf.companies) for (const f of c.figures) expect(field.pass(Math.round(f.x), Math.round(f.y))).toBe(true);
    });
});

describe('the fight', () => {
    it('a much stronger army breaks the enemy and wins; the aftermath runs', () => {
        const { bf, player, world, unit, battle } = setUp({ playerArmy: [['soldier', 8, 10], ['archer', 4, 8], ['cavalry', 2, 18]], enemyStrength: 30, gold: 50 });
        const goldBefore = player.gold;
        const over = Battlefield.fightOut(bf);
        expect(over.winner).toBe('player');
        // volleys were loosed and men fell on both sides of the field
        expect(bf.log.length).toBeGreaterThan(1);
        const result = Battlefield.conclude(player, bf, world);
        expect(result.victory).toBe(true);
        expect(battle.done).toBe(true);
        expect(unit.destroyed).toBe(true);
        // the loot came out of the band's own purse: never more than they carried
        expect(player.gold - goldBefore).toBeLessThanOrEqual(50);
        expect(player.gold - goldBefore).toBeGreaterThan(0);
        expect(result.phases.some(p => p.phase === 'field')).toBe(true);
    });

    it('a hopeless fight ends in defeat, losses taken from the army', () => {
        const { bf, player, world, battle } = setUp({ playerArmy: [['militia', 3, 5]], enemyStrength: 120, enemyType: 'raider' });
        const before = player.army.length;
        Battlefield.fightOut(bf);
        const result = Battlefield.conclude(player, bf, world);
        expect(result.victory).toBe(false);
        expect(player.army.length).toBeLessThan(before);
        expect(battle.casualties).toBeGreaterThan(0);
    });

    it('replays exactly from the seed and the same orders', () => {
        const run = () => {
            const { bf } = setUp({ playerArmy: [['soldier', 5, 10], ['archer', 3, 8]], enemyStrength: 55, seed: 11 });
            const foot = bf.companies.find(c => c.side === 'player' && c.kind === 'foot');
            const target = bf.companies.find(c => c.side === 'enemy');
            for (let i = 0; i < 40; i++) Battlefield.tick(bf);
            Battlefield.order(bf, foot.id, { type: 'charge', targetId: target.id });
            Battlefield.fightOut(bf);
            return JSON.stringify({ over: bf.over, t: bf.t, s: Battlefield.strengths(bf), log: bf.log.map(l => l.text) });
        };
        expect(run()).toBe(run());
    });

    it('the battle does not move the game\'s dice', () => {
        const { bf } = setUp({ playerArmy: [['soldier', 5, 10]], enemyStrength: 40, seed: 5 });
        Utils.setSeed(99);
        const a = Utils.random();
        Utils.setSeed(99);
        for (let i = 0; i < 300; i++) Battlefield.tick(bf);
        expect(Utils.random()).toBe(a);
    });

    it('archers loose volleys at what comes in range, and arrows hurt', () => {
        const { bf } = setUp({ playerArmy: [['archer', 6, 8]], enemyStrength: 40, seed: 2 });
        const archers = bf.companies.find(c => c.side === 'player' && c.kind === 'archer');
        const foe = bf.companies.find(c => c.side === 'enemy');
        // bring the foe within range and let them stand there
        bf.aiSide.enemy = false;
        foe.x = archers.x + 10; foe.y = archers.y;
        for (const f of foe.figures) { const p = Battlefield.slotPos(foe, f.slot); f.x = p.x; f.y = p.y; }
        const before = foe.str;
        let volleys = 0;
        for (let i = 0; i < 80; i++) {
            Battlefield.tick(bf);
            volleys += bf.events.filter(e => e.type === 'volley' && e.from === archers.id).length;
            bf.events.length = 0;
        }
        expect(volleys).toBeGreaterThan(1);
        expect(foe.str).toBeLessThan(before);
    });

    it('a charge into the rear shakes a company more than one into its face', () => {
        const shock = (fromBehind) => {
            const { bf } = setUp({ playerArmy: [['soldier', 4, 10]], enemyStrength: 40, seed: 4 });
            bf.aiSide.enemy = false;
            const mine = bf.companies.find(c => c.side === 'player');
            const foe = bf.companies.find(c => c.side === 'enemy' && c.kind === 'foot') || bf.companies.find(c => c.side === 'enemy');
            foe.dx = fromBehind ? 1 : -1; // facing away from the player, or toward
            foe.x = mine.x + 6; foe.y = mine.y;
            for (const f of foe.figures) { const p = Battlefield.slotPos(foe, f.slot); f.x = p.x; f.y = p.y; }
            const m0 = foe.morale;
            Battlefield.order(bf, mine.id, { type: 'charge', targetId: foe.id });
            for (let i = 0; i < 60 && !foe.engaged.length; i++) Battlefield.tick(bf);
            return m0 - foe.morale;
        };
        expect(shock(true)).toBeGreaterThan(shock(false));
    });

    it('sounding the retreat takes the army off the field: withdrew, no loot', () => {
        const { bf, player, world } = setUp({ playerArmy: [['soldier', 5, 10]], enemyStrength: 50, seed: 8 });
        const gold = player.gold;
        for (let i = 0; i < 20; i++) Battlefield.tick(bf);
        expect(Battlefield.retreat(bf)).toBe(true);
        let guard = 2000;
        while (!bf.over && guard--) Battlefield.tick(bf);
        expect(bf.over.winner).toBe('withdrew');
        const result = Battlefield.conclude(player, bf, world);
        expect(result.withdrew).toBe(true);
        expect(player.gold).toBe(gold);
    });

    it('holding the field for the objective\'s time is a victory', () => {
        Utils.setSeed(9);
        const world = makeWorld();
        const player = makePlayer({ army: army([['soldier', 6, 10]]) });
        const unit = makeUnit('raider', 10, world);
        const { enemy, ctx } = FieldBattle.unitEnemy(player, unit, world);
        const battle = FieldBattle.start(player, enemy, world, ctx);
        const bf = Battlefield.create(player, battle, Battlefield.openField(64, 40), { world, objective: { type: 'hold', seconds: 5 } });
        bf.aiSide.enemy = false; // they never come on
        let guard = 200;
        while (!bf.over && guard--) Battlefield.tick(bf);
        expect(bf.over).toEqual({ winner: 'player', how: 'held' });
    });

    it('sync keeps the FieldBattle numbers in step, so auto can finish it', () => {
        const { bf, player, world, battle } = setUp({ playerArmy: [['soldier', 6, 10]], enemyStrength: 45, seed: 12 });
        for (let i = 0; i < 400 && !bf.over; i++) Battlefield.tick(bf);
        Battlefield.sync(bf);
        expect(battle.sim.eStr).toBeCloseTo(Math.max(1, Battlefield.strengths(bf).eStr), 3);
        const result = FieldBattle.auto(player, battle, world);
        expect(battle.done).toBe(true);
        expect(typeof result.victory).toBe('boolean');
    });
});

describe("a realm's host (the General)", () => {
    const spec = (men, enemyMen) => ({
        id: 'gb_test', kind: 'field', day: 10, where: { q: 0, r: 0, terrainId: 'plains' },
        host: { kingdomId: 'k1', kingdomName: 'Avel', men, retinue: 0, retinueUnits: 4, quality: 1.1, morale: 70, composition: { cavalry: 0.3, archer: 0.28, pikeman: 0.42 } },
        enemy: { kingdomId: 'k2', kingdomName: 'Dorn', men: enemyMen, quality: 1, composition: { cavalry: 0.3, archer: 0.3, pikeman: 0.4 } },
    });

    it("draws the host up from its composition and returns Generalship.settleBattle's outcome shape", () => {
        Utils.setSeed(21);
        const world = makeWorld();
        const player = makePlayer();
        const sp = spec(400, 150);
        const battle = Battlefield.hostBattle(player, world, sp);
        const bf = Battlefield.create(player, battle, Battlefield.openField(64, 40), { world });
        const mine = bf.companies.filter(c => c.side === 'player');
        expect(new Set(mine.map(c => c.kind))).toEqual(new Set(['foot', 'archer', 'horse']));
        expect(mine.every(c => c.units.length === 0)).toBe(true);
        // hundreds of men stand on the field as a few dozen figures
        expect(mine.reduce((s, c) => s + c.figures.length, 0)).toBeLessThanOrEqual(Battlefield.config().maxFiguresPerSide + 6);
        Battlefield.fightOut(bf);
        const out = Battlefield.hostOutcome(bf, sp);
        expect(out.victory).toBe(true);
        expect(out.hostLost).toBeGreaterThanOrEqual(0);
        expect(out.hostLost).toBeLessThan(400);
        expect(out.enemyLost).toBeGreaterThan(0);
        expect(out.retinueLost).toBe(0);
        // the player's own army is untouched by a host battle
        expect(player.army.length).toBe(0);
    });
});

describe('the field polished: assaults, steady holding, box selection, the clock', () => {
    it('an assault draws the defenders up in the streets and the attackers outside', () => {
        Utils.setSeed(31);
        const world = makeWorld();
        const player = makePlayer({ army: army([['soldier', 6, 10], ['archer', 2, 8]]) });
        const unit = makeUnit('raider', 50, world);
        const { enemy, ctx } = FieldBattle.unitEnemy(player, unit, world);
        const battle = FieldBattle.start(player, enemy, world, ctx);
        // a town in the east of the map: streets around (50, 20)
        const field = Battlefield.openField(64, 40);
        field.town = (q, r) => Math.abs(q - 50) < 8 && Math.abs(r - 20) < 8;
        const bf = Battlefield.create(player, battle, field, { world, layout: 'assault' });
        expect(bf.layout).toBe('assault');
        const theirs = bf.companies.filter(c => c.side === 'enemy');
        const mine = bf.companies.filter(c => c.side === 'player');
        const mid = (cs) => ({ x: cs.reduce((s, c) => s + c.x, 0) / cs.length, y: cs.reduce((s, c) => s + c.y, 0) / cs.length });
        const e = mid(theirs), p = mid(mine);
        expect(field.town(Math.round(e.x), Math.round(e.y))).toBe(true);
        expect(field.town(Math.round(p.x), Math.round(p.y))).toBe(false);
        expect(Math.abs(p.x - 50)).toBeGreaterThan(15);
        // the defenders' foot hold their streets until the attackers close
        for (let i = 0; i < 30; i++) Battlefield.tick(bf);
        expect(theirs.filter(c => c.kind === 'foot').every(c => c.order.type === 'hold')).toBe(true);
    });

    it('a company holding takes its front once and keeps it while a foe moves about out of reach', () => {
        const { bf } = setUp({ playerArmy: [['soldier', 4, 10]], enemyStrength: 40, seed: 32 });
        bf.aiSide.enemy = false;
        const mine = bf.companies.find(c => c.side === 'player');
        const foe = bf.companies.find(c => c.side === 'enemy');
        for (let i = 0; i < 30; i++) Battlefield.tick(bf);
        const front = { x: mine.dx, y: mine.dy };
        // the foe wanders across the field, far off (beyond hold.threatRange)
        foe.x = mine.x + 20; foe.y = mine.y + 15;
        for (let i = 0; i < 40; i++) Battlefield.tick(bf);
        expect(mine.dx).toBeCloseTo(front.x, 2);
        expect(mine.dy).toBeCloseTo(front.y, 2);
        // a foe close on its flank: it wheels to meet it
        foe.x = mine.x; foe.y = mine.y + 5;
        for (const f of foe.figures) { const p = Battlefield.slotPos(foe, f.slot); f.x = p.x; f.y = p.y; }
        for (let i = 0; i < 20; i++) Battlefield.tick(bf);
        expect(mine.dy).toBeGreaterThan(0.5);
    });

    it('a box dragged over the field takes the companies with a man inside it', () => {
        const { bf } = setUp({ playerArmy: [['soldier', 4, 10], ['archer', 3, 8], ['cavalry', 2, 18]] });
        const mine = bf.companies.filter(c => c.side === 'player');
        const all = Battlefield.inBox(bf, 'player', 0, 0, 64, 40);
        expect(all.sort()).toEqual(mine.map(c => c.id).sort());
        const one = mine[0];
        const f = one.figures[0];
        expect(Battlefield.inBox(bf, 'player', f.x - 0.2, f.y - 0.2, f.x + 0.2, f.y + 0.2)).toContain(one.id);
        expect(Battlefield.inBox(bf, 'enemy', 0, 0, 64, 40).some(id => mine.some(c => c.id === id))).toBe(false);
    });

    it('a battle takes a set share of the day, more the longer it is fought', () => {
        const { bf } = setUp({ playerArmy: [['soldier', 4, 10]] });
        const C = Battlefield.config().clock;
        expect(Battlefield.gameHours(bf)).toBe(C.minHours);
        bf.t = 420;
        expect(Battlefield.gameHours(bf)).toBeGreaterThan(Battlefield.gameHours({ t: 60 }));
        expect(Battlefield.gameHours(bf)).toBeLessThanOrEqual(C.maxHours);
    });
});

describe('finding the way round in a town', () => {
    it('a company sent past a wall finds the gap in it instead of standing against it', () => {
        const { bf } = setUp({ playerArmy: [['soldier', 4, 10]] });
        // A wall across the field at x = 30 with a single gap at y = 4
        const w = bf.field.w, h = bf.field.h;
        bf.field = { ...bf.field, pass: (q, r) => q >= 0 && r >= 0 && q < w && r < h && !(q === 30 && r !== 4) };
        bf._flow = null;
        const c = bf.companies.find(x => x.side === 'player');
        c.x = 26; c.y = 20;
        Battlefield.order(bf, c.id, { type: 'move', x: 34, y: 20 });
        for (let i = 0; i < 3000 && c.order.type === 'move'; i++) Battlefield._moveCompany(bf, c, 0.1);
        expect(c.x).toBeGreaterThan(33);
        expect(Math.abs(c.y - 20)).toBeLessThan(1);
    });

    it('the way round follows the distance map, and is null when the goal is walled off', () => {
        const ring = (q, r) => q >= 0 && r >= 0 && q < 20 && r < 20 && Math.max(Math.abs(q - 15), Math.abs(r - 10)) !== 2;
        const bf = { field: { w: 20, h: 20, pass: ring } };
        expect(Battlefield._lineClear(bf.field, 2, 10, 15, 10)).toBe(false);
        expect(Battlefield._wayRound(bf, 2, 10, { x: 15, y: 10 })).toBe(null);
        const bf2 = { field: { w: 20, h: 20, pass: (q, r) => q >= 0 && r >= 0 && q < 20 && r < 20 && !(q === 10 && r > 3) } };
        const way = Battlefield._wayRound(bf2, 6, 10, { x: 15, y: 10 });
        expect(way.y).toBeLessThan(0); // up toward the gap at the top of the wall
    });
});
