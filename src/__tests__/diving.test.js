/**
 * Diving (player/diving.js: what a dive brings up and costs; tables in
 * data/diving.json; ui/innerMapDiving.js offers it on the water).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Diving } from '../player/diving.js';
import { Swimming } from '../player/swimming.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const summer = { season: 'Summer', day: 10 };
const winter = { season: 'Winter', day: 10 };

const diver = (practice = 0) => {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    p.luck = 5;
    p.swimPractice = practice;
    if (p.needs) p.needs.energy = 100;
    return p;
};

/** Every item found over n grabs of this water */
function grabs(water, n, opts = {}) {
    const p = diver();
    const seen = new Set();
    for (let i = 0; i < n; i++) {
        const f = Diving.rollFind(p, water, opts);
        if (f && f.item) seen.add(f.item);
    }
    return seen;
}

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

describe('what lies on the bottom', () => {
    beforeEach(() => Utils.setSeed(4242));

    it('the deep sea gives oysters and lobster, never crayfish', () => {
        const seen = grabs({ kind: 'sea', deep: true }, 600);
        expect(seen.has('oysters')).toBe(true);
        expect(seen.has('lobster')).toBe(true);
        expect(seen.has('crayfish')).toBe(false);
        expect(seen.has('clay')).toBe(false);
    });

    it('the sea shallows give weed, shells, mussels and crabs, but no lobster', () => {
        const seen = grabs({ kind: 'sea', deep: false }, 600);
        for (const id of ['seaweed', 'shells', 'mussels', 'crabs']) expect(seen.has(id), id).toBe(true);
        expect(seen.has('lobster')).toBe(false);
    });

    it('a river gives crayfish, mussels and snagged wood, never sea things', () => {
        const seen = grabs({ kind: 'river', deep: false }, 600);
        for (const id of ['crayfish', 'mussels', 'driftwood']) expect(seen.has(id), id).toBe(true);
        for (const id of ['oysters', 'lobster', 'seaweed', 'sea_sponge']) expect(seen.has(id), id).toBe(false);
    });

    it('a lake bed gives crayfish, mussels and clay; a pond its leeches', () => {
        const lake = grabs({ kind: 'lake', deep: true }, 600);
        for (const id of ['crayfish', 'mussels', 'clay']) expect(lake.has(id), id).toBe(true);
        expect(lake.has('oysters')).toBe(false);
        // (a pond has no deep table of its own: the shallows' serves)
        expect(grabs({ kind: 'pond', deep: true }, 600).has('leeches')).toBe(true);
    });

    it('the water of a map tile: its kind and depth', () => {
        expect(Diving.waterOf({ _waterKind: 'river', _deep: false })).toEqual({ kind: 'river', deep: false });
        expect(Diving.waterOf({ _waterKind: 'sea', _deep: true })).toEqual({ kind: 'sea', deep: true });
        expect(Diving.waterOf({ _sea: true })).toEqual({ kind: 'sea', deep: false });
        expect(Diving.waterOf({ _wet: true })).toEqual({ kind: 'pond', deep: false });
    });

    it('a spot picked over today yields less', () => {
        const count = (picked) => {
            Utils.setSeed(7);
            const p = diver();
            let n = 0;
            for (let i = 0; i < 1000; i++) if (Diving.rollFind(p, { kind: 'sea', deep: false }, { picked })) n++;
            return n;
        };
        const fresh = count(0), twice = count(2);
        expect(twice).toBeLessThan(fresh * 0.5);
    });
});

describe('treasure stays rare', () => {
    const treasureDives = (water, n, opts = {}) => {
        Utils.setSeed(99);
        let hits = 0;
        for (let i = 0; i < n; i++) {
            const p = diver();
            const res = Diving.dive(p, summer, null, { ...water, length: 'full', ...opts });
            if (res.finds.some(f => f.rare)) hits++;
        }
        return hits / n;
    };

    it('the deep sea: now and then, never often', () => {
        const share = treasureDives({ kind: 'sea', deep: true }, 2000);
        expect(share).toBeGreaterThan(0);
        expect(share).toBeLessThan(0.12);
    });

    it('rarer still in a pond than in the deep sea; likelier by a wreck', () => {
        const deep = treasureDives({ kind: 'sea', deep: true }, 2000);
        expect(treasureDives({ kind: 'pond', deep: false }, 2000)).toBeLessThan(deep);
        expect(treasureDives({ kind: 'sea', deep: true }, 2000, { nearWreck: true })).toBeGreaterThan(deep * 2);
    });

    it('treasure suits the water: no pearls or coral in a pond, no coral in the shallows', () => {
        expect(Diving.treasures({ kind: 'pond', deep: false }).some(f => f.item === 'pearls')).toBe(false);
        expect(Diving.treasures({ kind: 'sea', deep: false }).some(f => f.item === 'blue_coral')).toBe(false);
        expect(Diving.treasures({ kind: 'sea', deep: true }).some(f => f.item === 'blue_coral')).toBe(true);
    });
});

describe('breath, and the cost of overstaying', () => {
    beforeEach(() => Utils.setSeed(1234));

    it('breath grows with swimming practice', () => {
        const C = Diving.config();
        expect(Diving.breath(diver(0))).toBe(C.breath.base);
        expect(Diving.breath(diver(Swimming.config().practiceMax))).toBe(C.breath.base + C.breath.perPractice);
        expect(Diving.plan(diver(200), 'full').grabs).toBeGreaterThan(Diving.plan(diver(0), 'full').grabs);
    });

    it('a quick or full dive stays inside your breath; pushing goes past it', () => {
        const p = diver();
        expect(Diving.plan(p, 'quick').over).toBe(0);
        expect(Diving.plan(p, 'full').over).toBe(0);
        expect(Diving.plan(p, 'push').over).toBeGreaterThan(0);
        expect(Diving.plan(p, 'push').grabs).toBeGreaterThan(Diving.plan(p, 'full').grabs);
    });

    it('a full dive in summer does no harm; pushing past your breath hurts', () => {
        const a = diver();
        const full = Diving.dive(a, summer, null, { kind: 'lake', deep: true, length: 'full' });
        expect(full.hurt).toBe(0);
        expect(a.health).toBe(100);
        const b = diver();
        const push = Diving.dive(b, summer, null, { kind: 'lake', deep: true, length: 'push' });
        expect(push.hurt).toBeGreaterThan(0);
        expect(b.health).toBeLessThan(100);
    });

    it('cold water in winter hurts more, even on a safe dive', () => {
        const a = diver();
        expect(Diving.dive(a, winter, null, { kind: 'lake', length: 'full' }).hurt).toBeGreaterThan(0);
        // pushing in the cold, against pushing in summer (no blackouts: the hurt of the breath alone)
        const D = DataLoader._gamedata.diving;
        const saved = { blackout: D.blackout, cold: D.cold };
        D.blackout = { ...D.blackout, chance: 0, perOverSecond: 0 };
        D.cold = { ...D.cold, blackout: 0 };
        try {
            const warm = Diving.dive(diver(), summer, null, { kind: 'lake', length: 'push' }).hurt;
            const cold = Diving.dive(diver(), winter, null, { kind: 'lake', length: 'push' }).hurt;
            expect(cold).toBeGreaterThan(warm * 1.5);
        } finally {
            Object.assign(D, saved);
        }
    });

    it('blacking out loses the haul', () => {
        let blackouts = 0;
        for (let i = 0; i < 400; i++) {
            const p = diver();
            const res = Diving.dive(p, winter, null, { kind: 'sea', deep: true, length: 'push' });
            if (!res.blackout) continue;
            blackouts++;
            expect(res.finds).toEqual([]);
            expect(Object.keys(p.inventory)).toEqual([]);
            expect(res.hurt).toBeGreaterThanOrEqual(Diving.config().blackout.health);
        }
        expect(blackouts).toBeGreaterThan(0);
        expect(blackouts).toBeLessThan(400 * 0.5);
    });

    it('a dive tires you, and builds your swimming', () => {
        const p = diver();
        const e0 = p.needs.energy;
        const res = Diving.dive(p, summer, null, { kind: 'river', length: 'full' });
        expect(p.needs.energy).toBeLessThan(e0);
        expect(res.practice).toBe(Diving.config().practicePerDive);
        expect(p.swimPractice).toBe(Diving.config().practicePerDive);
        expect(p.dives).toBe(1);
    });

    it('too tired, or too laden, you cannot dive', () => {
        const p = diver();
        p.needs.energy = Diving.config().minEnergy - 1;
        expect(Diving.canDive(p).ok).toBe(false);
        expect(Diving.canDive(diver()).ok).toBe(true);
    });
});

describe('finds into the packs', () => {
    beforeEach(() => Utils.setSeed(555));

    it('what is found lands in the inventory', () => {
        const p = diver(300);
        let total = 0;
        for (let i = 0; i < 20; i++) {
            const res = Diving.dive(p, summer, null, { kind: 'sea', deep: false, length: 'full' });
            for (const [id, q] of Object.entries(res.added)) total += q;
            expect(Object.keys(res.dropped)).toEqual([]);
        }
        expect(total).toBeGreaterThan(0);
        const held = Object.values(p.inventory).reduce((s, q) => s + q, 0);
        expect(held).toBe(total);
    });

    it('a sunken chest pays gold into the purse', () => {
        // a wreck in the deep sea, with luck: sooner or later, a chest
        let gold = 0;
        for (let i = 0; i < 3000 && !gold; i++) {
            const p = diver(400);
            p.gold = 0;
            p.luck = 15;
            const res = Diving.dive(p, summer, null, { kind: 'sea', deep: true, length: 'full', nearWreck: true });
            if (res.gold > 0) { gold = res.gold; expect(p.gold).toBe(res.gold); }
        }
        expect(gold).toBeGreaterThan(0);
    });

    it('full packs: a new find is let go', () => {
        const p = diver(400);
        const cap = PlayerInventory.getCapacity(p);
        for (let i = 0; i < cap; i++) p.inventory['junk_' + i] = 1;
        let dropped = 0;
        for (let i = 0; i < 30; i++) {
            const res = Diving.dive(p, summer, null, { kind: 'river', length: 'full' });
            dropped += Object.keys(res.dropped).length;
            expect(Object.keys(res.added)).toEqual([]);
        }
        expect(dropped).toBeGreaterThan(0);
    });
});
