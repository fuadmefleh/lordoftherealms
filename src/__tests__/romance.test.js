/**
 * Townsfolk courtship (systems/romance.js): attraction, the stages and how
 * they fail, the married, weddings that make a real spouse, the town's talk,
 * the player as matchmaker or meddler, determinism and old saves.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Romance } from '../systems/romance.js';
import { NpcDisposition } from '../systems/npcDisposition.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf-8'));
const DATA = { romance: read('romance.json'), townsfolk: read('townsfolk.json') };
const saved = DataLoader._gamedata;
const Y = 120;

function makeWorld(seed = 4242) {
    const towns = [
        { name: 'Ashford', type: 'town', q: 5, r: 7 },
        { name: 'Highmere', type: 'city', q: 20, r: 3 },
    ];
    return {
        day: 1, baseYear: 853, generationParams: { seed }, activeEvents: [], towns,
        getSettlementViews: () => towns, getKingdom: () => null,
        getTile: (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s } : null; },
    };
}

function seeded(seed = 4242) {
    const world = makeWorld(seed);
    for (const t of world.towns) Townsfolk.seed(t, world, { q: t.q, r: t.r });
    return world;
}

function liveUntil(world, to, player = null) {
    while (world.day < to) { world.day++; Townsfolk.processDay(world, player); }
}

function person(folk, o) {
    const p = { id: folk.n++, first: o.first || `P${folk.n}`, last: o.last || 'Test', gender: o.gender || 'male', born: 1 - (o.age || 25) * Y, died: null, cause: null,
        role: o.role || 'villager', traits: o.traits || [], spouse: null, parents: [], kids: [], away: null, log: [] };
    folk.people.push(p);
    return p;
}

function bareFolk() {
    return { v: 1, q: 1, r: 1, n: 0, target: 0, tick: 0, people: [], annals: [] };
}

beforeEach(() => { DataLoader._gamedata = { ...DATA, romance: { ...DATA.romance } }; });
afterAll(() => { DataLoader._gamedata = saved; });

describe('Romance — attraction', () => {
    it('follows compatibility: age, temper, station and old grudges', () => {
        const world = makeWorld();
        const folk = bareFolk();
        // (leaning hashed per person: pick ones drawn to the other sex)
        const mk = o => { let p; do { p = person(folk, o); } while (Romance.leaning(world, folk, p) !== 'opposite'); return p; };
        const ada = mk({ gender: 'female', age: 24, traits: ['kind'] });
        const ben = mk({ gender: 'male', age: 26, traits: ['generous'] });
        const old = mk({ gender: 'male', age: 50, traits: ['generous'] });
        const lord = mk({ gender: 'male', age: 25, role: 'noble', traits: ['generous'] });
        const beggar = mk({ gender: 'female', age: 25, role: 'beggar', traits: ['generous'] });
        const sour = mk({ gender: 'male', age: 26, traits: ['stubborn'] });
        const day = 1;
        const s = (a, b) => Romance.score(world, folk, a, b, day);
        expect(s(ada, ben).score).toBeGreaterThan(0);
        // too wide a gap in years: nothing
        expect(s(ada, old).score).toBe(0);
        // a gap in station costs, a wider one more
        expect(s(lord, beggar).parts.station).toBeLessThan(s(ada, lord).parts.station);
        expect(s(ada, lord).parts.station).toBeLessThan(0);
        // a temper pair that suits
        expect(s(ada, ben).parts.temper).toBeGreaterThan(s(ada, sour).parts.temper);
        // a beating between them sours it
        const before = s(ada, ben).score;
        ben.log.push({ d: 1, k: 'brawl', o: ada.id, x: 'won' });
        expect(s(ada, ben).score).toBeLessThan(before);
        // the same two folk of the same sex, each drawn only to the other sex: no spark at all
        const ana = mk({ gender: 'female', age: 25 });
        expect(Romance.compatible(world, folk, ada, ana)).toBe(false);
        expect(s(ada, ana).score).toBe(0);
    });

    it('leanings: most folk love the other sex, a few their own or either', () => {
        const world = makeWorld();
        const folk = bareFolk();
        const n = { opposite: 0, same: 0, both: 0 };
        for (let i = 0; i < 4000; i++) n[Romance.leaning(world, folk, person(folk, { gender: i % 2 ? 'male' : 'female' }))]++;
        expect(n.same / 4000).toBeGreaterThan(0.03);
        expect(n.same / 4000).toBeLessThan(0.1);
        expect(n.both / 4000).toBeGreaterThan(0.02);
        expect(n.opposite / 4000).toBeGreaterThan(0.8);
    });

    it('never courts kin', () => {
        const world = seeded();
        liveUntil(world, 1 + 6 * Y);
        for (const t of world.towns) {
            const folk = t.folk;
            for (const x of [...folk.romance.list, ...folk.romance.past]) {
                const a = Townsfolk.get(folk, x.a);
                if (!a) continue;
                expect(Romance._kin(folk, a).has(x.b)).toBe(false);
            }
        }
    });
});

describe('Romance — the stages', () => {
    it('courtships advance stage by stage, and fail as well as succeed', () => {
        const world = seeded(7);
        liveUntil(world, 1 + 8 * Y);
        const ends = {};
        for (const t of world.towns) for (const x of t.folk.romance.past) ends[x.end] = (ends[x.end] || 0) + 1;
        expect(ends.wed).toBeGreaterThan(2);
        expect((ends.rejected || 0) + (ends.cooled || 0) + (ends.parted || 0) + (ends.jilted || 0)).toBeGreaterThan(2);
        // A betrothal comes after courting, a wedding after the betrothal
        for (const t of world.towns) {
            for (const p of t.folk.people) {
                const order = p.log.filter(e => ['courting', 'betrothed', 'wed'].includes(e.k));
                for (let i = 1; i < order.length; i++) {
                    if (order[i].k === 'betrothed' && order[i - 1].o === order[i].o) expect(order[i - 1].k).toBe('courting');
                }
            }
        }
    });

    it('a wedding makes a real spouse on the roster (and the town tells of it)', () => {
        const world = seeded(11);
        liveUntil(world, 1 + 5 * Y);
        let checked = 0;
        for (const t of world.towns) {
            const folk = t.folk;
            for (const x of folk.romance.past.filter(e => e.end === 'wed')) {
                const a = Townsfolk.get(folk, x.a);
                const b = Townsfolk.get(folk, x.b);
                if (!a || !b) continue;
                const widowed = a.log.some(e => e.k === 'widowed') || b.log.some(e => e.k === 'widowed');
                if (!widowed && a.died == null && b.died == null) {
                    expect(a.spouse).toBe(b.id);
                    expect(b.spouse).toBe(a.id);
                }
                expect(folk.annals.some(e => e.k === 'wed' && ((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id)))).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('the married mostly do not court; an affair found out is the town\'s scandal', () => {
        DataLoader._gamedata.romance = { ...DATA.romance, affair: { ...DATA.romance.affair, chance: 0.08, foundOut: 0.5 } };
        const world = seeded(5);
        for (let d = 2; d <= 1 + 4 * Y; d++) {
            world.day = d;
            Townsfolk.processDay(world);
            for (const t of world.towns) {
                const folk = t.folk;
                for (const c of (folk.romance ? folk.romance.list : []).filter(x => !x.affair)) {
                    for (const id of [c.a, c.b]) {
                        const p = Townsfolk.get(folk, id);
                        const sp = Townsfolk.get(folk, p.spouse);
                        expect(!!(sp && sp.died == null && sp.id !== Romance.partnerId(c, id))).toBe(false);
                    }
                }
            }
        }
        const scandal = world.towns.flatMap(t => t.folk.annals.filter(e => e.k === 'affair').map(e => ({ e, folk: t.folk })));
        expect(scandal.length).toBeGreaterThan(0);
        const { e, folk } = scandal[0];
        expect(Townsfolk.annalText(folk, e, world)).toMatch(/found out/);
        // ...and the wronged spouse remembers it (the shared hook for the fights between townsfolk)
        expect(folk.people.some(p => p.log.some(l => l.k === 'betrayed'))).toBe(true);
        expect(Romance.grudges(folk).some(g => g.why === 'affair')).toBe(true);
    });

    it('a death ends a courtship and breaks the heart left behind', () => {
        const world = seeded(3);
        liveUntil(world, 1 + 2 * Y);
        const folk = world.towns[1].folk;
        const c = folk.romance.list.find(x => !x.affair && Romance.stageIndex(x.st) >= 2) || folk.romance.list.find(x => !x.affair);
        expect(c).toBeTruthy();
        const deep = Romance.stageIndex(c.st) >= 2;
        const a = Townsfolk.get(folk, c.a);
        const b = Townsfolk.get(folk, c.b);
        Townsfolk._die(folk, a, world.day, 'a fever');
        liveUntil(world, world.day + 10);
        expect(folk.romance.list.includes(c)).toBe(false);
        expect(folk.romance.past.some(x => x.a === c.a && x.b === c.b && x.end === 'death')).toBe(true);
        if (deep) {
            expect(Romance.mood(folk, b, world.day).k).toBe('broken');
            expect(Romance.workFactor(folk, b, world.day)).toBeLessThan(1);
        }
    });

    it('same-sex couples can court and wed; they keep their names and bear no children', () => {
        const world = makeWorld(9);
        const folk = bareFolk();
        world.towns[0].folk = folk;
        Object.assign(folk, { q: 5, r: 7 });
        let a, b;
        do { a = person(folk, { gender: 'female', age: 24, last: 'Ashborne' }); } while (Romance.leaning(world, folk, a) !== 'same');
        do { b = person(folk, { gender: 'female', age: 25, last: 'Millbrook' }); } while (Romance.leaning(world, folk, b) === 'opposite');
        expect(Romance.compatible(world, folk, a, b)).toBe(true);
        Townsfolk._wed(folk, a, b, 10);
        expect(a.spouse).toBe(b.id);
        expect(a.last).toBe('Ashborne');
        expect(b.last).toBe('Millbrook');
        const settlement = world.towns[0];
        folk.tick = 0;
        Townsfolk.catchUp(world, settlement, 4 * Y);
        expect(a.kids.length + b.kids.length).toBe(0);
    });
});

describe('Romance — the town talks', () => {
    it('courtships go on off the map, and the town whispers of them', () => {
        const world = seeded(21);
        liveUntil(world, 1 + 2 * Y);
        const folk = world.towns[1].folk;
        const tales = Romance.rumours(folk, world, 5);
        expect(tales.length).toBeGreaterThan(0);
        for (const t of tales) expect(t.text).toMatch(/\w/);
        // Someone in a courtship speaks of their own
        const c = folk.romance.list.find(x => !x.affair && Romance.stageIndex(x.st) >= 1);
        if (c) {
            const p = Townsfolk.get(folk, c.a);
            expect(Romance.gossipFor(folk, p, world)).toContain(Townsfolk.get(folk, c.b).first);
        }
        // Betrothals are in the town's annals and its news
        const bt = world.towns.flatMap(t => t.folk.annals.filter(e => e.k === 'betrothed').map(e => Townsfolk.annalText(t.folk, e, world)));
        expect(bt.length).toBeGreaterThan(0);
        expect(bt[0]).toMatch(/promised/);
    });

    it('a trader in love is free with a bargain', () => {
        const world = seeded(21);
        let found = null;
        for (let y = 1; y <= 6 && !found; y++) {
            liveUntil(world, 1 + y * Y);
            for (const t of world.towns) {
                const c = t.folk.romance.list.find(x => !x.affair && Romance.stageIndex(x.st) >= 2);
                if (c && !found) found = { folk: t.folk, c };
            }
        }
        expect(found).toBeTruthy();
        const { folk, c } = found;
        const p = Townsfolk.get(folk, c.a);
        const npc = { name: p.first, personalityTraits: [] };
        Townsfolk.dress(npc, p, folk, world);
        const pm = NpcDisposition.getPriceModifiers(npc);
        expect(pm.reasons.some(r => r.label === 'In love')).toBe(true);
    });
});

describe('Romance — the player\'s part', () => {
    function couple(seed = 21) {
        const world = seeded(seed);
        liveUntil(world, 1 + 2 * Y);
        for (const t of world.towns) {
            const c = t.folk.romance.list.find(x => !x.affair && Romance.stageIndex(x.st) >= 1 && Romance.stageIndex(x.st) <= 3);
            if (c) return { world, folk: t.folk, c, a: Townsfolk.get(t.folk, c.a), b: Townsfolk.get(t.folk, c.b) };
        }
        throw new Error('no courtship');
    }

    it('carrying a love letter warms the match and both think the better of you', () => {
        const { world, folk, c, a, b } = couple();
        const heat = c.heat;
        expect(Romance.offers(folk, a, world).ops).toContain('carry');
        expect(Romance.carry(folk, a, world).line).toBeTruthy();
        // b is the one to receive it
        expect(Romance.offers(folk, b, world).ops).toContain('deliver');
        const before = (a.mem && a.mem.disposition) || 50;
        const r = Romance.deliver(folk, b, world);
        expect(r.regard).toBeGreaterThan(0);
        expect(c.heat).toBeGreaterThan(heat);
        expect(a.mem.disposition).toBeGreaterThan(before);
        expect(c.token).toBe(null);
    });

    it('a good word lands by the odds; a tale cools the match and may be traced', () => {
        const { world, folk, c, a } = couple();
        const heat = c.heat;
        const w = Romance.goodWord(folk, a, world, 1);
        expect(w.ok).toBe(true);
        expect(c.heat).toBeGreaterThan(heat);
        // (once in a while)
        expect(Romance.offers(folk, a, world).ops).not.toContain('goodWord');
        const h2 = c.heat;
        const m = Romance.meddle(folk, a, world);
        expect(m.line).toBeTruthy();
        if (!m.broke) expect(c.heat).toBeLessThan(h2);
        else expect(folk.romance.list.includes(c)).toBe(false);
    });

    it('courting one of a pair yourself makes the other suitor resent you', () => {
        const { world, folk, c, a, b } = couple();
        a.rnpc = 'rnpc_1';
        const player = { name: 'Rowan', firstName: 'Rowan', relationships: { rnpc_1: { romantic: true, affection: 40 } } };
        Romance._playerSuit(world, folk, world.day, player);
        expect(c.prv).toBe(b.id);
        expect(b.log.some(e => e.k === 'rivalInLove' && e.x === 'Rowan')).toBe(true);
        expect(b.mem.disposition).toBeLessThan(50);
        expect(Romance.resentLine(folk, b, world)).toContain(a.first);
        expect(Romance.rumours(folk, world, 5).some(r => /Rowan/.test(r.text))).toBe(true);
    });
});

describe('Romance — determinism and saves', () => {
    it('the same seed tells the same love stories, lived daily or caught up at once', () => {
        const w1 = seeded(33);
        liveUntil(w1, 1 + 3 * Y);
        const w2 = seeded(33);
        liveUntil(w2, 1 + 3 * Y);
        expect(JSON.stringify(w1.towns[1].folk.romance)).toBe(JSON.stringify(w2.towns[1].folk.romance));
        // A town not ticked (the player away, no processDay) catches up on entry to the same story
        const w3 = seeded(33);
        w3.day = 1 + 3 * Y;
        for (const t of w3.towns) Townsfolk.catchUp(w3, t, w3.day);
        expect(JSON.stringify(w3.towns[1].folk.romance)).toBe(JSON.stringify(w1.towns[1].folk.romance));
        expect(JSON.stringify(w3.towns[1].folk.people)).toBe(JSON.stringify(w1.towns[1].folk.people));
    });

    it('an old save (a roster with no book of hearts) loads and starts courting; it survives a round trip', () => {
        const world = seeded(44);
        liveUntil(world, 1 + Y);
        const town = world.towns[0];
        delete town.folk.romance;
        const copy = JSON.parse(JSON.stringify(town.folk));
        town.folk = copy;
        expect(() => liveUntil(world, world.day + Y)).not.toThrow();
        expect(Array.isArray(town.folk.romance.list)).toBe(true);
        const again = JSON.parse(JSON.stringify(town.folk));
        expect(again.romance).toEqual(town.folk.romance);
    });
});
