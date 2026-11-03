// Wild tasks (systems/wildTasks.js): the rules behind foraging, hunting,
// fishing, smuggling and pickpocketing done in person on the inner map.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WildTasks } from '../systems/wildTasks.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

/** A small map from rows of characters: . ground, ~ water, T tree, R rock, i ice, # wall */
function map(rows) {
    const tiles = rows.map((row, r) => [...row].map((ch, q) => {
        const t = { q, r, subTerrain: { id: 'grass', passable: true } };
        if (ch === '~') t.subTerrain = { id: 'pond_water', passable: false };
        if (ch === 'i') t.subTerrain = { id: 'ice', passable: true };
        if (ch === '#') t.subTerrain = { id: 'cliff', passable: false };
        if (ch === 'T') t.customObject = { defId: 'oak' };
        if (ch === 'R') t.customObject = { defId: 'boulder' };
        return t;
    }));
    return { tiles, width: rows[0].length, height: rows.length };
}

const typeOf = (id) => ({ oak: 'tree', boulder: 'rock' })[id] || null;

describe('WildTasks data', () => {
    it('has every task configured', () => {
        for (const k of ['forage', 'hunt', 'fish', 'trap', 'iceFish', 'smuggle', 'pickpocket']) {
            expect(WildTasks.cfg(k).title, k).toBeTruthy();
        }
        expect(WildTasks.data().prompt.inPerson).toBeTruthy();
    });

    it('fills in fields and leaves unknown ones', () => {
        expect(WildTasks.fmt('Gather: {name} ×{qty}', { name: 'Berries', qty: 2 })).toBe('Gather: Berries ×2');
        expect(WildTasks.fmt('{a} {b}', { a: 1 })).toBe('1 {b}');
    });
});

describe('WildTasks.spots', () => {
    const m = map([
        '.......',
        '.T...~~',
        '.....~~',
        '..R....',
        '..iii..',
        '.......',
    ]);
    const s = WildTasks.spots(m, typeOf);

    it('stands beside trees and rocks, never on them', () => {
        expect(s.trees.length).toBe(1);
        expect(s.rocks.length).toBe(1);
        for (const p of [...s.trees, ...s.rocks]) {
            expect(m.tiles[p.r][p.q].customObject).toBeUndefined();
            expect(WildTasks.dist(p, { q: p.atQ, r: p.atR })).toBe(1);
        }
    });

    it('finds the shore beside the pond, and the ice', () => {
        expect(s.shore.length).toBeGreaterThan(0);
        for (const p of s.shore) {
            const n = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dq, dr]) => m.tiles[p.r + dr] && m.tiles[p.r + dr][p.q + dq] && m.tiles[p.r + dr][p.q + dq].subTerrain.id === 'pond_water');
            expect(n).toBe(true);
        }
        expect(s.ice.map(p => `${p.q},${p.r}`)).toEqual(['2,4', '3,4', '4,4']);
        // open ground is walkable and holds nothing
        for (const p of s.open) expect(m.tiles[p.r][p.q].subTerrain.passable && !m.tiles[p.r][p.q].customObject).toBe(true);
    });

    it('near() falls back to the nearest when none are in reach', () => {
        const list = [{ q: 10, r: 0 }, { q: 20, r: 0 }, { q: 30, r: 0 }];
        expect(WildTasks.near(list, { q: 0, r: 0 }, 5, 0)).toEqual([]);
        expect(WildTasks.near(list, { q: 0, r: 0 }, 5, 2)).toEqual([{ q: 10, r: 0 }, { q: 20, r: 0 }]);
        expect(WildTasks.near(list, { q: 0, r: 0 }, 15, 0)).toEqual([{ q: 10, r: 0 }]);
    });
});

describe('foraging search', () => {
    it('names the compass way (north is up the map)', () => {
        const o = { q: 5, r: 5 };
        expect(WildTasks.compass(o, { q: 5, r: 0 })).toBe('north');
        expect(WildTasks.compass(o, { q: 9, r: 1 })).toBe('north-east');
        expect(WildTasks.compass(o, { q: 0, r: 5 })).toBe('west');
        expect(WildTasks.compass(o, { q: 5, r: 9 })).toBe('south');
    });

    it('finds a patch beside you, else points to the nearest in range', () => {
        const hidden = [{ q: 4, r: 4 }, { q: 10, r: 4 }, { q: 30, r: 30 }];
        expect(WildTasks.search({ q: 5, r: 5 }, hidden, 5).hit).toBe(hidden[0]);
        const hint = WildTasks.search({ q: 7, r: 4 }, hidden.slice(1), 5);
        expect(hint.hit).toBeNull();
        expect(hint.near).toBe(hidden[1]);
        expect(hint.dir).toBe('east');
        expect(WildTasks.search({ q: 20, r: 20 }, hidden.slice(1), 5)).toEqual({ hit: null, near: null, dir: null });
        // found patches are gone
        expect(WildTasks.search({ q: 5, r: 5 }, [{ q: 5, r: 5, found: true }], 5).hit).toBeNull();
    });

    it('wits and craft show more patches', () => {
        expect(WildTasks.patchesSeen(5, 0)).toBe(2);
        expect(WildTasks.patchesSeen(10, 2)).toBeGreaterThan(WildTasks.patchesSeen(5, 0));
    });
});

describe('hunting', () => {
    it('lays a trail of sign ending at the beast, on walkable ground', () => {
        const rng = Utils.seededRandom(42);
        const pass = (q, r) => !(q === 6 && r === 0);
        const t = WildTasks.trail({ q: 0, r: 0 }, { q: 20, r: 0 }, 5, rng, pass);
        expect(t.length).toBe(5);
        expect(t[4]).toEqual({ q: 20, r: 0 });
        for (const p of t) expect(pass(p.q, p.r)).toBe(true);
        for (let i = 1; i < t.length; i++) expect(t[i].q).toBeGreaterThan(t[i - 1].q - 2);
    });

    it('stealth and craft shrink the alert ring, never below the floor', () => {
        const c = WildTasks.cfg('hunt');
        expect(WildTasks.alertRadius(1, 0)).toBeGreaterThan(WildTasks.alertRadius(8, 3));
        expect(WildTasks.alertRadius(100, 10)).toBe(c.alertMin);
    });

    it('walking inside the ring alarms the beast; standing still calms it', () => {
        let s = { alert: 0, pace: 0 };
        for (let i = 0; i < 10; i++) s = WildTasks.stalkStep(s, { dist: 5, radius: 6, walking: true, dt: 0.1 });
        const afterWalk = s.alert;
        expect(afterWalk).toBeGreaterThan(0);
        for (let i = 0; i < 10; i++) s = WildTasks.stalkStep(s, { dist: 5, radius: 6, walking: false, dt: 0.1 });
        expect(s.alert).toBeLessThan(afterWalk);
        // outside the ring you may walk freely
        expect(WildTasks.stalkStep({ alert: 0, pace: 0 }, { dist: 9, radius: 6, walking: true, dt: 1 }).alert).toBe(0);
    });

    it('keeping on walking alarms it faster than creeping in short steps', () => {
        let steady = { alert: 0, pace: 0 };
        for (let i = 0; i < 20; i++) steady = WildTasks.stalkStep(steady, { dist: 4, radius: 6, walking: true, dt: 0.1 });
        let creep = { alert: 0, pace: 0 };
        for (let i = 0; i < 20; i++) {
            creep = WildTasks.stalkStep(creep, { dist: 4, radius: 6, walking: true, dt: 0.1 });
            if (i % 4 === 3) for (let k = 0; k < 4; k++) creep = WildTasks.stalkStep(creep, { dist: 4, radius: 6, walking: false, dt: 0.1 });
        }
        expect(steady.alert).toBeGreaterThan(creep.alert);
    });

    it('bolts when alarmed, or when you walk right up to it', () => {
        expect(WildTasks.stalkStep({ alert: 0.99, pace: 2 }, { dist: 2, radius: 6, walking: true, dt: 0.5 }).bolt).toBe(true);
        expect(WildTasks.stalkStep({ alert: 0, pace: 0 }, { dist: 1, radius: 6, walking: true, dt: 0.01 }).bolt).toBe(true);
        expect(WildTasks.stalkStep({ alert: 0.2, pace: 0 }, { dist: 1, radius: 6, walking: false, dt: 0.1 }).bolt).toBe(false);
    });

    it('a close, calm shot flies truer than a far, alarmed one', () => {
        expect(WildTasks.shotAccuracy(1, 0, 1)).toBe(100);
        expect(WildTasks.shotAccuracy(1, 0, 0.5)).toBeGreaterThan(WildTasks.shotAccuracy(4, 0.8, 0.5));
        expect(WildTasks.shotAccuracy(9, 1, 0)).toBe(0);
        expect(WildTasks.alertLevel(0.1)).toBe(0);
        expect(WildTasks.alertLevel(0.5)).toBe(1);
        expect(WildTasks.alertLevel(0.9)).toBe(2);
    });
});

describe('fishing', () => {
    it('luck helps the bite and the strike window; strength lands the fighters', () => {
        expect(WildTasks.biteChance(9)).toBeGreaterThan(WildTasks.biteChance(3));
        expect(WildTasks.biteChance(100)).toBeLessThan(1);
        expect(WildTasks.strikeWindow(9)).toBeGreaterThan(WildTasks.strikeWindow(3));
        expect(WildTasks.landChance(2, 9)).toBeGreaterThan(WildTasks.landChance(8, 3));
        expect(WildTasks.landChance(50, 0)).toBe(0.2);
    });
});

describe('the watch and the mark', () => {
    it('sees you inside its ring, the nearest first', () => {
        const ws = [{ q: 0, r: 0, name: 'A' }, { q: 3, r: 0, name: 'B', radius: 2 }];
        expect(WildTasks.inSight(ws, { q: 4, r: 0 }, 3).name).toBe('B');
        expect(WildTasks.inSight(ws, { q: 1, r: 1 }, 3).name).toBe('A');
        expect(WildTasks.inSight(ws, { q: 9, r: 9 }, 3)).toBeNull();
        expect(WildTasks.sightRadius(1)).toBeGreaterThan(WildTasks.sightRadius(10));
    });

    it('suspicion climbs in sight (faster when walking) and ebbs out of it', () => {
        const still = WildTasks.suspicionStep(0, { seen: true, dist: 2, radius: 4, walking: false, dt: 0.5 });
        const moving = WildTasks.suspicionStep(0, { seen: true, dist: 2, radius: 4, walking: true, dt: 0.5 });
        expect(still).toBeGreaterThan(0);
        expect(moving).toBeGreaterThan(still);
        expect(WildTasks.suspicionStep(50, { seen: false, dt: 1 })).toBeLessThan(50);
        expect(WildTasks.suspicionStep(99, { seen: true, dist: 0, radius: 4, walking: true, dt: 10 })).toBe(100);
    });

    it('a sharp-eyed mark notices further and takes longer to rob', () => {
        const dozy = WildTasks.markSense(0.1, 3);
        const sharp = WildTasks.markSense(0.75, 3);
        expect(sharp.notice).toBeGreaterThan(dozy.notice);
        expect(sharp.lift).toBeGreaterThan(dozy.lift);
        expect(sharp.every).toBeLessThan(dozy.every);
        expect(WildTasks.markSense(0.75, 10).lift).toBeLessThan(sharp.lift);
    });
});
