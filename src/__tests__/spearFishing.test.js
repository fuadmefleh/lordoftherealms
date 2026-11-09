/**
 * Spear fishing under the water (player/spearFishing.js: the odds, the catch,
 * breath, the spear's wear; numbers in data/diving.json `spear`; the fish
 * that scatter: ui/innerMapLayers/underwaterFish.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Diving } from '../player/diving.js';
import { SpearFishing } from '../player/spearFishing.js';
import { Player } from '../player/player.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { InnerMap } from '../world/innerMap.js';
import { UnderwaterFish } from '../ui/innerMapLayers/underwaterFish.js';
import { InnerMapSpearFishing } from '../ui/innerMapSpearFishing.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
}, 120000);

const SPEAR = 'fishing_spear';
const species = (id) => DataLoader._gamedata.diving.fish.species.find(s => s.id === id);

/** A diver under the water, with (or without) a fishing spear. */
function diver({ spear = 1, fishing = 1, grade = null } = {}) {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    p.age = 30;
    p.luck = 5;
    p.gold = 0;
    if (p.needs) p.needs.energy = 100;
    PracticeSkills.setLevel(p, 'diving', 5);
    PracticeSkills.setLevel(p, 'fishing', fishing);
    if (spear > 0) {
        p.inventory[SPEAR] = spear;
        if (grade) Grades.add(p, SPEAR, spear, grade);
    }
    Diving.goUnder(p);
    return p;
}

const cod = (dist = 1) => ({ species: species('cod'), dist, speed: species('cod').speed });
const always = () => 0;          // every roll under the chance: a hit, no bigger fish, no snap
const never = () => 0.9999;      // every roll over it: a miss

beforeEach(() => Utils.setSeed(12345));

describe('the data', () => {
    it('documents the spear section and names the spear good', () => {
        const S = DataLoader._gamedata.diving.spear;
        expect(typeof S._doc).toBe('string');
        expect(S.item).toBe(SPEAR);
        expect(S.modes.strike.reach).toBeLessThan(S.modes.throw.reach);
    });

    it('every species speared becomes a fish good that exists', () => {
        const byId = {};
        for (const g of Object.values(PlayerEconomy.GOODS)) byId[g.id] = g;
        const S = SpearFishing.config();
        for (const sp of DataLoader._gamedata.diving.fish.species) {
            const e = S.catches[sp.id];
            expect(e, sp.id).toBeTruthy();
            expect(byId[e.item], `${sp.id} -> ${e.item}`).toBeTruthy();
        }
        for (const b of S.bySize) expect(byId[b.item], b.item).toBeTruthy();
    });
});

describe('needing a spear', () => {
    it('without a fishing spear you cannot strike, and are told so plainly', () => {
        const p = diver({ spear: 0 });
        const can = SpearFishing.canStrike(p);
        expect(can.ok).toBe(false);
        expect(can.noSpear).toBe(true);
        expect(can.reason).toMatch(/no fishing spear/i);
        const breath = p.dive.breath;
        const res = SpearFishing.strike(p, cod(), always);
        expect(res.ok).toBe(false);
        expect(res.hit).toBe(false);
        expect(p.dive.breath).toBe(breath);
        expect(p.inventory.large_fish).toBeUndefined();
    });

    it('with one, under the water, you may', () => {
        expect(SpearFishing.canStrike(diver()).ok).toBe(true);
    });

    it('not on the surface, and not out of reach', () => {
        const p = diver();
        expect(SpearFishing.strike(p, cod(99), always).ok).toBe(false);
        Diving.surface(p);
        expect(SpearFishing.canStrike(p).ok).toBe(false);
    });
});

describe('the odds', () => {
    it('close in is a thrust, farther a throw, past that out of reach', () => {
        expect(SpearFishing.modeFor(1)).toBe('strike');
        expect(SpearFishing.modeFor(3)).toBe('throw');
        expect(SpearFishing.modeFor(50)).toBe(null);
    });

    it('nearer, slower, bigger fish and a better fisher hit more often', () => {
        const p = diver();
        const base = SpearFishing.hitChance(p, cod(2.5));
        expect(SpearFishing.hitChance(p, cod(4.5))).toBeLessThan(base);
        expect(SpearFishing.hitChance(p, { ...cod(2.5), speed: 4 })).toBeLessThan(base);
        expect(SpearFishing.hitChance(p, { species: species('sprat'), dist: 2.5, speed: species('cod').speed })).toBeLessThan(base);
        expect(SpearFishing.hitChance(diver({ fishing: 9 }), cod(2.5))).toBeGreaterThan(base);
    });

    it('a finer spear hits better', () => {
        const plain = SpearFishing.hitChance(diver(), cod(2.5));
        const fine = SpearFishing.hitChance(diver({ grade: 'masterwork' }), cod(2.5));
        const poor = SpearFishing.hitChance(diver({ grade: 'poor' }), cod(2.5));
        expect(fine).toBeGreaterThan(plain);
        expect(poor).toBeLessThan(plain);
    });

    it('the same seed gives the same strikes', () => {
        const run = () => {
            Utils.setSeed(777);
            const p = diver({ spear: 3 });
            const out = [];
            for (let i = 0; i < 12; i++) {
                p.dive.spearCooldown = 0;
                p.dive.breath = p.dive.max;
                out.push(SpearFishing.strike(p, cod(3)).hit);
            }
            return out;
        };
        const a = run();
        expect(run()).toEqual(a);
        expect(a).toContain(true);
        expect(a).toContain(false);
    });
});

describe('a strike', () => {
    it('a hit is a catch of the fish goods, on the dive\'s haul, and Fishing XP', () => {
        const p = diver();
        const xp = PracticeSkills.xp(p, 'fishing');
        const res = SpearFishing.strike(p, cod(1), always);
        expect(res.ok).toBe(true);
        expect(res.hit).toBe(true);
        expect(res.catch.item).toBe('large_fish');
        expect(res.kept).toBe(true);
        expect(p.inventory.large_fish).toBe(1);
        expect(p.dive.haul.large_fish).toBe(1);
        expect(res.scare).toBe(null);
        expect(PracticeSkills.xp(p, 'fishing')).toBeGreaterThan(xp);
    });

    it('the species decides the good', () => {
        expect(SpearFishing.catchFor(diver(), species('sprat'), never).item).toBe('small_fish');
        expect(SpearFishing.catchFor(diver(), species('mackerel'), never).item).toBe('fish');
        expect(SpearFishing.catchFor(diver(), { id: 'unknown', length: 1.4 }, never).item).toBe('large_fish');
    });

    it('a blackout loses the speared fish with the rest of the haul', () => {
        const p = diver();
        SpearFishing.strike(p, cod(1), always);
        Diving.surface(p, { blackout: true });
        expect(p.inventory.large_fish).toBeUndefined();
    });

    it('a miss catches nothing and scares the fish off', () => {
        const p = diver();
        const res = SpearFishing.strike(p, cod(1), never);
        expect(res.hit).toBe(false);
        expect(res.catch).toBe(null);
        expect(res.scare.radius).toBeGreaterThan(0);
        expect(res.scare.seconds).toBeGreaterThan(0);
        expect(Object.keys(p.dive.haul)).toEqual([]);
    });

    it('costs breath (a throw more than a thrust), and the arm must come back', () => {
        const M = SpearFishing.config().modes;
        const p = diver();
        const b0 = p.dive.breath;
        SpearFishing.strike(p, cod(1), never);
        expect(p.dive.breath).toBeCloseTo(b0 - M.strike.breath, 5);
        expect(SpearFishing.canStrike(p).ok).toBe(false);
        expect(SpearFishing.canStrike(p).cooling).toBe(true);
        SpearFishing.tick(p, M.strike.cooldown + 0.01);
        expect(SpearFishing.canStrike(p).ok).toBe(true);
        const b1 = p.dive.breath;
        SpearFishing.strike(p, cod(3), never);
        expect(b1 - p.dive.breath).toBeCloseTo(M.throw.breath, 5);
        expect(M.throw.breath).toBeGreaterThan(M.strike.breath);
    });

    it('no breath left, no strike', () => {
        const p = diver();
        p.dive.breath = 0;
        expect(SpearFishing.canStrike(p).ok).toBe(false);
    });
});

describe('the spear wears', () => {
    /** Strike (missing) until the spear breaks → the strikes it took */
    function strikesToBreak(p) {
        for (let i = 1; i < 1000; i++) {
            p.dive.spearCooldown = 0;
            p.dive.breath = p.dive.max;
            const res = SpearFishing.strike(p, cod(1), never);
            if (res.broke) return i;
        }
        return Infinity;
    }

    it('wears with each strike, and breaks at the end of its life: gone from the packs', () => {
        const p = diver();
        SpearFishing.strike(p, cod(1), never);
        expect(SpearFishing.condition(p).wear).toBeGreaterThan(0);
        const n = strikesToBreak(p);
        expect(n).toBeLessThan(1000);
        expect(p.inventory[SPEAR]).toBeUndefined();
        expect(SpearFishing.canStrike(p).noSpear).toBe(true);
    });

    it('with two, the second comes fresh into hand', () => {
        const p = diver({ spear: 2 });
        strikesToBreak(p);
        expect(p.inventory[SPEAR]).toBe(1);
        expect(SpearFishing.condition(p).wear).toBe(0);
    });

    it('a finer spear lasts longer', () => {
        const plain = strikesToBreak(diver());
        const fine = strikesToBreak(diver({ grade: 'excellent' }));
        expect(fine).toBeGreaterThan(plain);
        expect(SpearFishing.durability(diver({ grade: 'poor' }))).toBeLessThan(SpearFishing.durability(diver()));
    });

    it('a struck fish may snap the shaft', () => {
        const p = diver();
        const res = SpearFishing.strike(p, cod(1), () => 0); // every roll low: hit, and the snap
        expect(res.hit).toBe(true);
        expect(res.snapped).toBe(true);
        expect(res.broke).toBe(true);
        expect(p.inventory[SPEAR]).toBeUndefined();
    });
});

describe('the fish under the water', () => {
    const N = 30;
    function sea() {
        const tiles = [];
        for (let r = 0; r < N; r++) {
            tiles[r] = [];
            for (let q = 0; q < N; q++) tiles[r][q] = { q, r, _wet: true, _deep: true, _waterKind: 'sea', _sea: true, subTerrain: { id: 'sea_water', passable: false } };
        }
        InnerMap.tiles = tiles;
        InnerMap.width = InnerMap.height = N;
        InnerMap._insideBuilding = null;
        InnerMap.playerInnerQ = 15;
        InnerMap.playerInnerR = 15;
    }

    it('a miss scatters the fish about it; a speared one is gone', () => {
        sea();
        UnderwaterFish.reset({}, 9);
        expect(UnderwaterFish.fish.length).toBeGreaterThan(2);
        const f = UnderwaterFish.fish[0];
        const n = UnderwaterFish.scare(f.x, f.y, 3, 2);
        expect(n).toBeGreaterThan(0);
        expect(f.scared).toBe(2);
        const d0 = Math.hypot(f.x - f.scareX, f.y - f.scareY);
        for (let i = 0; i < 10; i++) UnderwaterFish.update(0.1);
        expect(Math.hypot(f.x - f.scareX, f.y - f.scareY)).toBeGreaterThan(d0);
        UnderwaterFish.remove(f);
        expect(UnderwaterFish.fish.includes(f)).toBe(false);
    });

    describe('on the map (ui/innerMapSpearFishing.js)', () => {
        const game = (player) => {
            const notes = [];
            return { player, notes, ui: { showNotification: (title, text, type) => notes.push({ title, text, type }) } };
        };
        const fishBy = () => {
            const p = { x: InnerMap.playerInnerQ + 0.5, y: InnerMap.playerInnerR + 0.5 };
            return UnderwaterFish.fish.slice().sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        };

        it('without a spear the menu and the F key say so plainly', () => {
            sea();
            InnerMap._underwater = true;
            UnderwaterFish.reset({}, 9);
            const g = game(diver({ spear: 0 }));
            const f = fishBy();
            const items = InnerMapSpearFishing.menuItems(g, Math.floor(f.x), Math.floor(f.y));
            expect(items.length).toBe(1);
            expect(items[0].type).toBe('disabled');
            expect(items[0].label).toMatch(/no fishing spear/i);
            expect(InnerMapSpearFishing.strikeAt(g, f)).toBe(false);
            expect(g.notes[0].text).toMatch(/no fishing spear/i);
            InnerMap._underwater = false;
        });

        it('with one, a fish clicked offers a strike or a throw with its chance, and the strike goes', () => {
            sea();
            InnerMap._underwater = true;
            UnderwaterFish.reset({}, 9);
            const g = game(diver());
            const f = fishBy();
            const items = InnerMapSpearFishing.menuItems(g, Math.floor(f.x), Math.floor(f.y));
            const act = items.find(i => i.action === 'dive_spear');
            expect(act).toBeTruthy();
            expect(act.desc).toMatch(/% to hit/);
            const breath = g.player.dive.breath;
            InnerMapSpearFishing.handle(g, act);
            expect(g.player.dive.breath).toBeLessThan(breath);
            expect(g.notes.some(n => /Speared|Missed/.test(n.title))).toBe(true);
            InnerMap._underwater = false;
        });
    });
});
