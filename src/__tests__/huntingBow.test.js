// Hunting with a bow and arrows (player/huntingBow.js): the gear it needs,
// the shot's odds, arrows used and recovered, bow wear and breakage.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { HuntingBow } from '../player/huntingBow.js';
import { Hunting } from '../player/foraging.js';
import { PlayerInventory } from '../core/inventory.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const hunter = (inv = { bow: 1, arrows: 20 }) => ({ name: 'H', strength: 5, luck: 5, skills: { combat: 1 }, inventory: { ...inv } });
/** An rng that plays back a list (then repeats its last). */
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

beforeEach(() => Utils.setSeed(1234));

describe('the gear', () => {
    it('needs a bow and arrows, and says plainly which is missing', () => {
        const none = HuntingBow.gear(hunter({}));
        expect(none.ok).toBe(false);
        expect(none.missing).toBe('bow');
        expect(none.reason).toMatch(/bow/i);
        const noArrows = HuntingBow.gear(hunter({ bow: 1 }));
        expect(noArrows.ok).toBe(false);
        expect(noArrows.missing).toBe('arrows');
        expect(noArrows.reason).toMatch(/arrows/i);
        expect(HuntingBow.gear(hunter()).ok).toBe(true);
        // a crossbow shoots too — bolts, not arrows (systems/arms.js ammo)
        expect(HuntingBow.gear(hunter({ crossbow: 1, bolts: 3 })).ok).toBe(true);
        expect(HuntingBow.gear(hunter({ crossbow: 1, arrows: 3 })).ok).toBe(false);
    });

    it('loosing without gear does nothing', () => {
        const p = hunter({ arrows: 5 });
        const r = HuntingBow.loose(p, { dist: 2, species: 'doe' });
        expect(r.ok).toBe(false);
        expect(p.inventory.arrows).toBe(5);
    });

    it('the quick hunt needs the gear too', () => {
        const r = HuntingBow.quickShots(hunter({}), { name: 'Venison' });
        expect(r.ok).toBe(false);
        expect(r.shots).toBe(0);
    });
});

describe('the shot', () => {
    it('is harder far off, on an alert beast, a small or fast one', () => {
        const p = hunter();
        const near = HuntingBow.hitChance(p, { dist: 1, alert: 0, species: 'doe' });
        expect(HuntingBow.hitChance(p, { dist: 4, alert: 0, species: 'doe' })).toBeLessThan(near);
        expect(HuntingBow.hitChance(p, { dist: 1, alert: 0.9, species: 'doe' })).toBeLessThan(near);
        expect(HuntingBow.hitChance(p, { dist: 1, alert: 0, species: 'rabbit' })).toBeLessThan(near);
        expect(HuntingBow.hitChance(p, { dist: 1, alert: 0, species: 'elk' })).toBeGreaterThan(near);
        // a loot name finds its beast (Venison → deer → doe)
        expect(HuntingBow.hitChance(p, { dist: 1, species: 'Venison' })).toBe(near);
        // big beasts take more killing
        expect(HuntingBow.killChance(p, { dist: 3, species: 'elk' })).toBeLessThan(HuntingBow.killChance(p, { dist: 3, species: 'doe' }));
        expect(HuntingBow.killChance(p, { dist: 3, species: 'elk', wounded: true })).toBeGreaterThan(HuntingBow.killChance(p, { dist: 3, species: 'elk' }));
    });

    it('a finer bow and a practised hunter shoot truer', () => {
        const common = hunter();
        const fine = hunter();
        Grades.add(fine, 'bow', 1, 'masterwork');
        const o = { dist: 3, alert: 0.2, species: 'doe' };
        expect(HuntingBow.hitChance(fine, o)).toBeGreaterThan(HuntingBow.hitChance(common, o));
        const old = hunter();
        old.strength = 9;
        old.skills.combat = 6;
        expect(HuntingBow.hitChance(old, o)).toBeGreaterThan(HuntingBow.hitChance(common, o));
        expect(Hunting.hitThreshold(old)).toBeLessThan(Hunting.hitThreshold(common));
    });

    it('hits and misses are the same under the same seed', () => {
        const run = () => {
            Utils.setSeed(777);
            const p = hunter({ bow: 1, arrows: 30 });
            const out = [];
            for (let i = 0; i < 12; i++) {
                const r = HuntingBow.loose(p, { dist: 1 + (i % 4), alert: (i % 3) * 0.3, species: 'stag' });
                out.push(`${r.hit ? 'H' : 'M'}${r.killed ? 'K' : ''}${r.missArrow ? 'a' : ''}${r.recovered}`);
            }
            return out.join(' ');
        };
        const a = run();
        expect(run()).toBe(a);
        expect(a).toMatch(/H/);
        expect(a).toMatch(/M/);
    });

    it('every shot uses an arrow; a kill may give arrows back, a miss may leave one whole', () => {
        const p = hunter({ bow: 1, arrows: 5 });
        // a hit (0.0 < chance), a kill (0.0), the arrow pulled out whole (0.0); then wear rolls
        const kill = HuntingBow.loose(p, { dist: 2, species: 'doe' }, () => 0);
        expect(kill.killed).toBe(true);
        expect(kill.recovered).toBe(1);
        expect(p.inventory.arrows).toBe(5);
        // a kill with two arrows already in it from earlier hits: each may come out
        const two = HuntingBow.loose(p, { dist: 2, species: 'doe', embedded: 2 }, () => 0);
        expect(two.recovered).toBe(3);
        expect(p.inventory.arrows).toBe(7);
        // a miss (0.99), its arrow landing whole (0.0), no second arrow / fumble
        const miss = HuntingBow.loose(p, { dist: 2, species: 'doe' }, seq(0.99, 0.0, 0.99, 0.99, 0.5));
        expect(miss.hit).toBe(false);
        expect(miss.missArrow).toBe(true);
        expect(p.inventory.arrows).toBe(6);
        // a miss that is lost
        const lost = HuntingBow.loose(p, { dist: 2, species: 'doe' }, seq(0.99, 0.99, 0.99, 0.99, 0.5));
        expect(lost.missArrow).toBe(false);
        expect(p.inventory.arrows).toBe(5);
    });

    it('a wound leaves the beast running: no arrows back until it falls', () => {
        const p = hunter({ bow: 1, arrows: 5 });
        const r = HuntingBow.loose(p, { dist: 3, species: 'elk' }, seq(0.0, 0.99, 0.5));
        expect(r.hit).toBe(true);
        expect(r.wounded).toBe(true);
        expect(r.killed).toBe(false);
        expect(r.recovered).toBe(0);
        expect(p.inventory.arrows).toBe(4);
    });

    it('graded arrows keep their grade when recovered', () => {
        const p = hunter({ bow: 1, arrows: 2 });
        Grades.add(p, 'arrows', 2, 'fine');
        HuntingBow.loose(p, { dist: 1, species: 'doe' }, () => 0);
        expect(p.inventory.arrows).toBe(2);
        expect(Grades.counts(p, 'arrows').fine).toBe(2);
    });
});

describe('bow wear', () => {
    it('wears with every shot and at last breaks', () => {
        const p = hunter({ bow: 1, arrows: 500 });
        let shots = 0, broke = false;
        let last = 100;
        while (!broke && shots < 400) {
            const r = HuntingBow.loose(p, { dist: 2, species: 'doe' });
            shots++;
            if (r.broke) broke = true;
            else {
                expect(r.condition).toBeLessThanOrEqual(last);
                last = r.condition;
            }
        }
        expect(broke).toBe(true);
        expect(shots).toBeGreaterThan(5);
        expect(p.inventory.bow || 0).toBe(0);
        expect(HuntingBow.gear(p).ok).toBe(false);
    });

    it('a finer bow lasts longer', () => {
        const life = (grade) => {
            Utils.setSeed(42);
            const p = hunter({ bow: 1, arrows: 999 });
            if (grade) Grades.add(p, 'bow', 1, grade);
            let n = 0;
            while (p.inventory.bow && n < 999) { HuntingBow.loose(p, { dist: 2, species: 'doe' }); n++; }
            return n;
        };
        expect(life('masterwork')).toBeGreaterThan(life('poor'));
    });

    it('a broken bow of two leaves the other, fresh', () => {
        const p = hunter({ bow: 2, arrows: 999 });
        p.bowWear = { 'bow:common': 99.9 };
        const r = HuntingBow.loose(p, { dist: 2, species: 'doe' });
        expect(r.broke).toBe(true);
        expect(p.inventory.bow).toBe(1);
        expect(HuntingBow.condition(p)).toBe(100);
    });
});

describe('the quick hunt', () => {
    it('shoots a few arrows and is reproducible', () => {
        const run = () => {
            Utils.setSeed(99);
            const p = hunter({ bow: 1, arrows: 10 });
            const r = HuntingBow.quickShots(p, { name: 'Venison' });
            return { r: { killed: r.killed, shots: r.shots, recovered: r.recovered }, arrows: p.inventory.arrows };
        };
        const a = run();
        expect(run()).toEqual(a);
        expect(a.r.shots).toBeGreaterThan(0);
        expect(a.r.shots).toBeLessThanOrEqual(HuntingBow.cfg().quick.shots);
        expect(a.arrows).toBe(10 - a.r.shots + a.r.recovered);
    });

    it('a kill banks the very quarry shot at', () => {
        const p = hunter({ bow: 1, arrows: 10 });
        const table = DataLoader.get('earlyJobs').hunting.loot_table.forest;
        const res = Hunting.quickHunt(p, table, table[0]);
        expect(res.entry).toBe(table[0]);
        expect(p.inventory[table[0].item]).toBeGreaterThan(0);
    });
});

describe('what the hunt brings in is market goods', () => {
    it('hides, feathers and antlers are the market\'s hide, feather and antler; sinew is a good', () => {
        const items = new Set();
        for (const t of Object.values(DataLoader.get('earlyJobs').hunting.loot_table)) for (const e of t) items.add(e.item);
        for (const id of ['hide', 'feather', 'antler', 'sinew']) expect(items.has(id), id).toBe(true);
        for (const id of ['hides', 'feathers', 'antlers']) expect(items.has(id), id).toBe(false);
        const goods = DataLoader.get('playerEconomy').GOODS;
        for (const id of items) expect(goods[id.toUpperCase()], id).toBeTruthy();
    });

    it('an old save\'s stacks fold into the goods', () => {
        const p = { inventory: { hides: 2, hide: 1, feathers: 3, antlers: 0 } };
        PlayerInventory.renameLegacy(p);
        expect(p.inventory).toEqual({ hide: 3, feather: 3 });
    });
});
