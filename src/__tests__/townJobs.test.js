// Townsfolk at work (systems/townJobs.js) and at church (systems/townWorship.js):
// every grown resident has a fitting occupation, the town's output follows the
// hands at each trade, wages move coin (none made), apprentices advance, a
// commission takes a worker from their post, the player's people are paid, old
// saves get occupations on load, and the devout go to church on the holy day.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';
import { TownWorship } from '../systems/townWorship.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { NpcFamily } from '../systems/npcFamily.js';

beforeAll(async () => { await loadData(); });

const Y = 120;

function makeWorld(day = 1, type = 'town') {
    const town = { name: 'Ashford', type, q: 5, r: 7, population: 2000, economy: { gold: 4000 }, kingdom: 0 };
    const kingdom = { id: 0, religion: { faithId: 'solaris', piety: 50 } };
    return {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [],
        town, getSettlementViews: () => [town], getKingdom: (id) => (id === 0 ? kingdom : null), kingdom,
    };
}

function seedNpcs(types = { villager: 22, merchant: 3, guard: 2, farmer: 3, priest: 1, blacksmith_npc: 1, child: 4 }) {
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: type === 'child' ? 8 + (i % 6) : 22 + ((i * 7) % 30) });
    let s = 77;
    NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
    return npcs;
}

function setup(type = 'town', types) {
    const world = makeWorld(1, type);
    Townsfolk.attach(world.town, world, seedNpcs(types), { q: 5, r: 7, target: 24 });
    return { world, folk: world.town.folk, s: world.town };
}

const adults = (folk, day) => Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 16 && !p.retired && p.role !== 'child');
const coinOf = (s) => s.economy.gold + s.folk.people.filter(p => Townsfolk.isHere(p) && typeof p.purse === 'number').reduce((t, p) => t + p.purse, 0);

describe('Occupations', () => {
    it('gives every grown resident a fitting occupation, the key trades first', () => {
        const { folk, world } = setup();
        const C = TownJobs.config();
        for (const p of adults(folk, world.day)) {
            expect(p.job, `${p.first} (${p.role})`).toBeTruthy();
            const o = C.occupations[p.job.id];
            expect(o).toBeTruthy();
            expect(o.roles).toContain(p.role);
        }
        const ids = adults(folk, world.day).map(p => p.job.id);
        for (const key of ['farmer', 'smith', 'miller', 'baker', 'priest', 'guard']) expect(ids).toContain(key);
        // the smith is the town's smith by role
        expect(folk.people.find(p => p.role === 'blacksmith_npc').job.id).toBe('smith');
    });

    it('an old save (no jobs) gets them on its first load, the same each time', () => {
        const a = setup();
        const b = setup();
        for (const p of a.folk.people) delete p.job;
        const again = JSON.parse(JSON.stringify(a.folk));
        a.s.folk = again;
        Townsfolk.attach(a.s, a.world, [], { q: 5, r: 7 });
        expect(again.people.filter(p => p.job).map(p => `${p.id}:${p.job.id}`)).toEqual(b.folk.people.filter(p => p.job).map(p => `${p.id}:${p.job.id}`));
    });

    it('fishers only by the water, miners only in the hills', () => {
        const { folk, world } = setup();
        expect(TownJobs.land(folk, world.town, world).water).toBe(false);
        expect(adults(folk, world.day).some(p => p.job.id === 'fisher' || p.job.id === 'miner')).toBe(false);
    });
});

describe('Work is the output', () => {
    it('a town at its plan works at about 1; losing its smith drops its iron goods to the floor', () => {
        const { folk, world, s } = setup();
        const crew = TownJobs.crew(s, world, world.day);
        expect(crew.g.tools).toBeGreaterThan(0.9);
        expect(crew.g.grain).toBeGreaterThan(0.9);
        expect(crew.g.grain).toBeLessThan(1.15);
        const smith = folk.people.find(p => p.job && p.job.id === 'smith');
        Townsfolk._die(folk, smith, world.day, 'a fever');
        world.day++;
        const after = TownJobs.crew(s, world, world.day);
        expect(after.g.tools).toBeLessThan(0.35);
        expect(after.r.smithy).toBeLessThan(0.35);
        // the market's turn reads it: fewer tools made than with the smith
        const run = (c) => {
            const t = { name: 'T', type: 'town', population: 2000, q: 1, r: 1 };
            SettlementMarket.ensure(t);
            t.market.stock.iron = 500; t.market.stock.coal = 500; t.market.stock.tools = 0;
            SettlementMarket.processSettlement(t, { tools: 5 }, { day: 10, crew: c });
            return t.market.stock.tools;
        };
        expect(run(after)).toBeLessThan(run(crew));
    });

    it('someone takes up the empty trade within a few seasons', () => {
        const { folk, world, s } = setup();
        const smith = folk.people.find(p => p.job && p.job.id === 'smith');
        Townsfolk._die(folk, smith, world.day, 'a fever');
        for (let d = 0; d < Y * 2; d++) { world.day++; Townsfolk.processDay(world); }
        expect(Townsfolk.residents(folk).some(p => p.job && p.job.id === 'smith' && p.job.rank !== 'apprentice')).toBe(true);
        expect(TownJobs.crew(s, world, world.day).g.tools).toBeGreaterThan(0.6);
    });

    it('a commission takes a worker from their post until it is done', () => {
        const { folk, world, s } = setup();
        const before = TownJobs.crew(s, world, world.day).g.bread;
        const p = TownJobs.engage(world, s, { kind: 'trade', recipeId: 'bakery', label: 'Bake bread' }, world.day + 5);
        expect(p.job.id).toBe('baker');
        expect(TownJobs.weight(folk, p, world.day)).toBe(0);
        expect(TownJobs.crew(s, world, world.day).g.bread).toBeLessThan(before);
        expect(TownJobs.describe(folk, p, world)).toMatch(/your order/);
        expect(TownJobs.weight(folk, p, world.day + 6)).toBeGreaterThan(0);
    });
});

describe('Wages and lives', () => {
    it('wages and board move coin between the town and its people, making none', () => {
        const { folk, world, s } = setup();
        for (const p of folk.people) Townsfolk.purse(folk, p, world);
        const c0 = coinOf(s);
        TownJobs.payday(world, s, folk, world.day, 30);
        expect(coinOf(s)).toBeCloseTo(c0, 1);
        const smith = folk.people.find(p => p.job && p.job.id === 'smith');
        const idle = adults(folk, world.day).find(p => p.job.id === 'unemployed') || adults(folk, world.day).find(p => p.job.id === 'labourer');
        expect(smith.purse).toBeGreaterThan(0);
        expect(idle).toBeTruthy();
    });

    it('apprentices are taken on and grow into journeymen, then masters', () => {
        const { folk, world } = setup();
        let saw = new Set();
        for (let d = 0; d < Y * 12; d++) {
            world.day++;
            Townsfolk.processDay(world);
            for (const p of folk.people) if (p.job && p.log.some(e => e.k === 'job')) for (const e of p.log) if (e.k === 'job') saw.add(String(e.x).split('|')[0]);
        }
        expect(saw.has('apprenticed')).toBe(true);
        expect(saw.has('journeyman')).toBe(true);
        expect(saw.has('master') || saw.has('tookUp')).toBe(true);
        // and the town's annals tell it
        expect(folk.annals.some(e => e.k === 'job' && Townsfolk.annalText(folk, e, world))).toBe(true);
    });

    it('the player\'s servant is paid weekly from the player\'s purse, and leaves unpaid', () => {
        const { folk, world, s } = setup();
        const p = adults(folk, world.day).find(x => x.job.id === 'labourer' || x.job.id === 'unemployed');
        const player = { gold: 100, name: 'Bot' };
        let res = null;
        for (let i = 0; i < 20 && !(res && res.ok); i++) { world.day++; res = TownJobs.offerWork(player, world, s, p, 'servant'); }
        expect(res.ok).toBe(true);
        expect(p.job.employer).toBe('player');
        const g0 = player.gold, p0 = p.purse;
        world.day += 7;
        TownJobs.processDay(world, player);
        expect(player.gold).toBeLessThan(g0);
        expect(p.purse - p0).toBeCloseTo(g0 - player.gold, 2);
        player.gold = 0;
        world.day += 7;
        TownJobs.processDay(world, player);
        expect(p.job.employer).toBeUndefined();
    });

    it('a clerk must read and write: the unlettered are refused, the schooled hired at the better wage', () => {
        const { folk, world, s } = setup();
        const K = TownJobs.config().playerJobs.kinds.clerk;
        expect(K.wage).toBeGreaterThan(TownJobs.config().playerJobs.kinds.servant.wage);
        const pool = adults(folk, world.day).filter(x => x.job.id === 'labourer' || x.job.id === 'unemployed');
        const dull = pool[0], lettered = pool[1] || pool[0];
        dull.literacy = K.minLiteracy - 20;
        const no = TownJobs.offerTerms({ gold: 100 }, world, folk, dull, 'clerk');
        expect(no.refuse).toMatch(/read/);
        lettered.literacy = K.minLiteracy + 10;
        const player = { gold: 200, name: 'Bot' };
        let res = null;
        for (let i = 0; i < 30 && !(res && res.ok); i++) { world.day++; res = TownJobs.offerWork(player, world, s, lettered, 'clerk'); }
        expect(res.ok).toBe(true);
        expect(lettered.job.pk).toBe('clerk');
        expect(lettered.job.id).toBe(K.job);
        expect(lettered.job.wage).toBeGreaterThanOrEqual(K.wage);
        expect(TownJobs.title(lettered)).toBe('your clerk');
    });

    it('everyone can say what their work is', () => {
        const { folk, world } = setup();
        for (const p of adults(folk, world.day)) expect(TownJobs.describe(folk, p, world, { town: 'Ashford' })).toBeTruthy();
        const rows = TownJobs.trades(world.town, world);
        expect(rows.find(r => r.id === 'smith').workers.length).toBe(1);
    });
});

describe('Worship', () => {
    it('the devout fill the church on the holy day, few on other days; other faiths stay home', () => {
        const { folk, world } = setup();
        const holy = 7 * 20;
        expect(TownWorship.isHolyDay(holy)).toBe(true);
        const people = Townsfolk.residents(folk);
        const on = people.filter(p => TownWorship.attends(folk, p, holy, true, 2)).length;
        const off = people.filter(p => TownWorship.attends(folk, p, holy + 1, false, 0)).length;
        expect(on).toBeGreaterThan(off);
        expect(on).toBeGreaterThan(people.length * 0.25);
        for (const p of people) if (TownWorship.faithOf(folk, p) !== 'town') expect(TownWorship.attends(folk, p, holy, true, 2)).toBe(false);
        // the priest always
        expect(TownWorship.attends(folk, people.find(p => p.job && p.job.id === 'priest'), holy, true, 2)).toBe(true);
    });

    it('the holy day\'s offerings move coin to the priest, and the realm\'s piety follows the pews', () => {
        const { folk, world, s } = setup();
        for (const p of folk.people) { Townsfolk.purse(folk, p, world); p.purse = 10; p.diet = 'plain'; }
        const c0 = coinOf(s);
        const priest = folk.people.find(p => p.job && p.job.id === 'priest');
        const before = priest.purse;
        world.day = 7 * 20;
        const piety0 = world.kingdom.religion.piety;
        const res = TownWorship.holyDay(world, s, world.day);
        expect(res.went).toBeGreaterThan(0);
        expect(priest.purse).toBeGreaterThan(before);
        expect(coinOf(s)).toBeCloseTo(c0, 2);
        expect(world.kingdom.religion.piety).not.toBe(piety0);
        // deterministic
        const again = setup();
        for (const p of again.folk.people) { Townsfolk.purse(again.folk, p, again.world); p.purse = 10; p.diet = 'plain'; }
        again.world.day = 7 * 20;
        expect(TownWorship.holyDay(again.world, again.s, again.world.day).went).toBe(res.went);
    });

    it('the player attending is noticed; disrupting is a scandal', () => {
        const { folk, world, s } = setup();
        const player = { faith: 2, name: 'Bot' };
        for (const p of folk.people) p.mem = { disposition: 50, timesSpoken: 1 };
        world.day = 7 * 20;
        const r = TownWorship.attend(player, world, s);
        expect(r.seen).toBeGreaterThan(0);
        expect(player.faith).toBeGreaterThan(2);
        TownWorship.disrupt(player, world, s);
        expect(folk.people.some(p => p.mem.disposition < 50)).toBe(true);
    });
});
