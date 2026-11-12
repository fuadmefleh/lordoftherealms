// Town life's loose ends (systems side): a fight's toll on the next day's
// work, the jobless poor as thieves, grudges from real love rivalries, the
// rival suitor a real townsperson, the town's love stories in its talk, a
// ruler who sits out the holy day, innkeepers paid in real coin, and
// quarantine cutting trade. All hash streams: the same seed, the same story.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Brawls } from '../systems/brawls.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { Romance } from '../systems/romance.js';
import { Relationships } from '../systems/relationships.js';
import { Chatter } from '../systems/chatter.js';
import { TownWorship } from '../systems/townWorship.js';
import { Hospitality } from '../systems/hospitality.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

function makeWorld(day = 10) {
    const towns = [
        { name: 'Ashford', type: 'city', q: 5, r: 7, kingdom: 'k1', economy: { gold: 5000 } },
        { name: 'Greymoor', type: 'town', q: 20, r: 3, kingdom: 'k1', economy: { gold: 2000 } },
    ];
    const tiles = new Map(towns.map(t => [`${t.q},${t.r}`, { q: t.q, r: t.r, settlement: t }]));
    const kingdom = { id: 'k1', name: 'Arvenland', isAlive: true, religion: { faithId: 'solaris', piety: 50 } };
    const world = {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], kingdoms: [kingdom], units: [],
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getTile: (q, r) => tiles.get(`${q},${r}`) || null, getSettlementViews: () => towns,
    };
    for (const t of towns) { Townsfolk.seed(t, world, { q: t.q, r: t.r }); SettlementMarket.ensure(t); }
    return { world, ash: towns[0], grey: towns[1], kingdom };
}

const grown = (s, day = 10) => Townsfolk.residents(s.folk).filter(p => Townsfolk.age(p, day) >= 18 && p.role !== 'child' && p.role !== 'priest');

describe('a fight tells on the next day\'s work (item 5)', () => {
    it('a fighter works worse the day of it and the next, worse still for a late one; then back to it', () => {
        const { world, ash } = makeWorld(10);
        TownJobs.ensure(ash.folk, ash, world, 10);
        const [pa, pb] = grown(ash).filter(p => p.job);
        const before = TownJobs.weight(ash.folk, pa, 10);
        const fa = Brawls.fighter(pa);
        const fb = Brawls.fighter(pb);
        const fight = Brawls.begin(fa, fb, { key: 'late-one', cause: 'tavern', place: 'tavern', day: 10, hour: 23 });
        Brawls.end(fight, 'parted', null, 'peace');
        fight.stage = 'fists';
        Brawls.settle(world, ash, fight, { day: 10, bar: false });
        expect(pa.brawled).toEqual({ d: 10, late: true });
        delete pa.hurt;
        const next = TownJobs.weight(ash.folk, pa, 11);
        expect(next).toBeLessThan(before);
        expect(TownJobs.brawlFactor(pa, 11)).toBeCloseTo(0.9 * 0.88, 5);
        // (a day fight costs less than a late one)
        pb.brawled = { d: 10, late: false };
        expect(TownJobs.brawlFactor(pb, 11)).toBeCloseTo(0.9, 5);
        // two days on, whole again
        expect(TownJobs.brawlFactor(pa, 12)).toBe(1);
        // and they say so when asked
        expect(TownJobs.describe(ash.folk, pa, { ...world, day: 11 })).toMatch(/fight/i);
    });
});

describe('the jobless poor are likelier thieves (item 6)', () => {
    it('out of work and poor turns some to theft whatever their role; the honest never', () => {
        const { world, ash } = makeWorld(10);
        TownJobs.ensure(ash.folk, ash, world, 10);
        const people = grown(ash).filter(p => p.role === 'merchant' || p.role === 'blacksmith_npc' || p.role === 'farmer');
        let crooked = 0;
        for (const p of people) {
            p.traits = ['quiet'];
            p.purse = 1;
            p.job = { id: 'unemployed', rank: 'master', since: 1 };
            if (NpcTheft.isCrooked(ash.folk, p, world, 10)) crooked++;
        }
        expect(crooked).toBeGreaterThan(0);
        expect(crooked).toBeLessThan(people.length + 1);
        const honest = people[0];
        honest.traits = ['kind'];
        expect(NpcTheft.isCrooked(ash.folk, honest, world, 10)).toBe(false);
        // (in work, the same poor merchant is not)
        const worker = people.find(p => NpcTheft.isCrooked(ash.folk, p, world, 10) && p.role !== 'farmer');
        if (worker) {
            worker.job = { id: 'labourer', rank: 'master', since: 1 };
            expect(NpcTheft.isCrooked(ash.folk, worker, world, 10)).toBe(false);
        }
    });

    it('a thief is picked from the town\'s crooked more often from the out-of-work', () => {
        const { world, ash } = makeWorld(10);
        const pool = grown(ash).filter(p => p.role === 'villager' || p.role === 'farmer').slice(0, 6);
        for (const p of Townsfolk.residents(ash.folk)) p.traits = ['kind'];
        for (const p of pool) { p.traits = ['bold']; p.job = { id: 'labourer', rank: 'master', since: 1 }; p.purse = 30; }
        const idle = pool[0];
        idle.job = { id: 'unemployed', rank: 'master', since: 1 };
        let withJobless = 0;
        for (let i = 0; i < 400; i++) if ((NpcTheft._townThief(world, ash, 10, `t${i}`) || {}).pid === idle.id) withJobless++;
        idle.job = { id: 'labourer', rank: 'master', since: 1 };
        let without = 0;
        for (let i = 0; i < 400; i++) if ((NpcTheft._townThief(world, ash, 10, `t${i}`) || {}).pid === idle.id) without++;
        expect(withJobless).toBeGreaterThan(without);
    });
});

describe('grudges from real rivalries and affairs (item 13)', () => {
    it('no love grudge without a romance behind it; a rival suitor and a found-out affair seed real ones', () => {
        const { world, ash } = makeWorld(30);
        const day = 30;
        Romance.state(ash.folk, world, day);
        expect(Brawls.loveGrudges(ash, day, 'rivalSuitor')).toEqual([]);
        expect(Brawls.loveGrudges(ash, day, 'affair')).toEqual([]);
        const [a, b, c, d] = grown(ash, day);
        // two suitors (romance's own grudge)
        ash.folk.romance.grudges.push({ a: a.id, b: b.id, why: 'rivalSuitor', d: day - 2 });
        // an affair found out: the betrayed spouse's own logs
        Townsfolk._log(c, day - 1, 'betrayed', 999, 'Someone');
        Townsfolk._log(c, day - 1, 'rivalInLove', d.id, 'Someone');
        const rs = Brawls.loveGrudges(ash, day, 'rivalSuitor');
        expect(rs.map(g => [g.a.id, g.b.id])).toEqual([[a.id, b.id]]);
        const af = Brawls.loveGrudges(ash, day, 'affair');
        expect(af.map(g => [g.a.id, g.b.id])).toEqual([[c.id, d.id]]);
        // (an old one is forgotten)
        expect(Brawls.loveGrudges(ash, day + 400, 'rivalSuitor')).toEqual([]);
        // seedGrudge's love reasons only ever name those pairs
        const G = Brawls.config().grudges;
        const saved = { perDay: G.perDay, reasons: G.reasons };
        try {
            G.perDay = { village: 1, town: 1, city: 1, capital: 1 };
            G.reasons = { rivalSuitor: saved.reasons.rivalSuitor, affair: saved.reasons.affair };
            for (let dd = day; dd < day + 6; dd++) {
                ash.brawls = null;
                const f = Brawls.seedGrudge(world, ash, dd);
                expect(f).toBeTruthy();
                const pairKey = [f.a, f.b].sort().join('|');
                expect([[a.id, b.id].sort().join('|'), [c.id, d.id].sort().join('|')]).toContain(pairKey);
            }
            // nothing behind it, nothing seeded
            ash.folk.romance.grudges = [];
            for (const p of ash.folk.people) p.log = (p.log || []).filter(e => e.k !== 'betrayed' && e.k !== 'rivalInLove');
            ash.brawls = null;
            expect(Brawls.seedGrudge(world, ash, day)).toBe(null);
        } finally {
            G.perDay = saved.perDay;
            G.reasons = saved.reasons;
        }
    });
});

describe('the rival suitor is a real townsperson (item 11)', () => {
    it('their beloved\'s own suitor, by name and trade; a stranger only where there is no town behind them', () => {
        const { world, ash } = makeWorld(30);
        const day = 30;
        Romance.state(ash.folk, world, day);
        const player = { name: 'Aldric', firstName: 'Aldric', gold: 100, relationships: {}, q: ash.q, r: ash.r };
        Relationships.initialize(player);
        Relationships._npcs = [];
        const p = grown(ash, day).find(x => x.spouse == null && Townsfolk.age(x, day) <= 40 && Romance.eligible(ash.folk, x, day));
        const res = Relationships.fromTownsperson(player, world, ash.folk, p, ash);
        expect(res.success).toBe(true);
        const npc = res.npc;
        const suitor = Romance._bestFor(world, ash.folk, p, Townsfolk.residents(ash.folk).filter(o => o !== p && Romance.eligible(ash.folk, o, day)), day, () => 0.5, 0)
            || grown(ash, day).find(o => o !== p && o.gender !== p.gender);
        ash.folk.romance.list.push({ id: 99, a: p.id, b: suitor.id, st: 'courting', d: day - 5, sd: day - 5, heat: 50 });
        const params = Relationships._matterParams(player, 'rival_suitor', npc, world);
        expect(params.suitor).toBe(Townsfolk.name(suitor));
        expect(params.suitorUid).toBe(`${ash.q},${ash.r}#${suitor.id}`);
        expect(typeof params.suitorType).toBe('string');
        // the duel reads the suitor's own kind
        const { b } = Relationships._suitorDuelists(player, params);
        expect(b.name).toBe(Townsfolk.name(suitor));
        // with no town behind the beloved, a stranger of the data's
        const loose = { id: 'x', firstName: 'Ana', isAlive: true };
        const generic = Relationships._matterParams(player, 'rival_suitor', loose, world);
        const def = Relationships._matterKind('rival_suitor');
        expect(def.suitors).toContain(generic.suitor);
    });
});

describe('the town\'s love stories in its talk (item 12)', () => {
    it('a wedding, an affair: overheard by name; the data validates', () => {
        const { world, ash } = makeWorld(40);
        const [a, b] = grown(ash, 40);
        ash.folk.annals.push({ k: 'affair', a: a.id, b: b.id, d: 38 });
        const ctx = Chatter.context(world, null, { q: ash.q, r: ash.r, occupation: 'villager' });
        expect(ctx.romance.map(x => x.kind)).toContain('affair');
        const lines = Chatter.candidates(ctx).filter(c => c.groupId.startsWith('romance_'));
        expect(lines.length).toBeGreaterThan(0);
        const said = Chatter.fill(lines[0].text, ctx, lines[0].when);
        expect(said).toContain(a.first);
        expect(said).not.toMatch(/\{\w+\}/);
        // long ago is not news
        const old = Chatter.context({ ...world, day: 400 }, null, { q: ash.q, r: ash.r });
        expect(old.romance).toEqual([]);
        expect(Chatter.validate()).toEqual([]);
    });
});

describe('a ruler who sits out the holy day is noticed (item 2)', () => {
    it('in town on the holy day and never at church: the devout think less, the realm\'s piety slips, the town talks', () => {
        const { world, ash, kingdom } = makeWorld(10);
        let holy = 7;
        while (!TownWorship.isHolyDay(holy)) holy++;
        world.day = holy + 1;
        const player = { name: 'Aldric', rulerTitle: 'King', q: ash.q, r: ash.r, throne: { ruling: { kingdomId: 'k1' } } };
        for (const p of Townsfolk.residents(ash.folk)) { p.mem = p.mem || {}; p.mem.disposition = 50; p.traits = ['devout']; }
        const piety = kingdom.religion.piety;
        TownWorship.processDay(world, player);
        const devout = Townsfolk.residents(ash.folk).filter(p => p.mem.missedRuler === holy);
        expect(devout.length).toBeGreaterThan(0);
        expect(devout[0].mem.disposition).toBeLessThan(50);
        expect(kingdom.religion.piety).toBeLessThan(piety);
        const annal = ash.folk.annals.find(e => e.k === 'worship' && String(e.x).startsWith('rulerAbsent|'));
        expect(annal).toBeTruthy();
        expect(TownWorship.annalText(ash.folk, annal, world)).toMatch(/King Aldric/);
        // the other town, where the ruler wasn't, noticed nothing
        expect(Townsfolk.residents(world.getSettlementViews()[1].folk).some(p => p.mem && p.mem.missedRuler != null)).toBe(false);
        // once only
        const n = ash.folk.annals.length;
        expect(TownWorship.rulerAbsent(world, ash, holy, player)).toBe(false);
        expect(ash.folk.annals.length).toBe(n);
    });

    it('a ruler who went to the service, or no ruler at all, is not', () => {
        const { world, ash } = makeWorld(10);
        let holy = 7;
        while (!TownWorship.isHolyDay(holy)) holy++;
        const went = { name: 'Aldric', q: ash.q, r: ash.r, throne: { ruling: { kingdomId: 'k1' } }, worship: { d: holy, town: ash.name } };
        expect(TownWorship.rulerAbsent(world, ash, holy, went)).toBe(false);
        const nobody = { name: 'Aldric', q: ash.q, r: ash.r };
        expect(TownWorship.rulerAbsent(world, ash, holy, nobody)).toBe(false);
    });
});

describe('innkeepers paid in real coin (item 3)', () => {
    it('a traveller\'s bed and a townsperson\'s supper: from their purse to the keeper\'s, no coin made', () => {
        const { world, ash } = makeWorld(10);
        const [keeperP, diner] = grown(ash);
        keeperP.purse = 10;
        diner.purse = 20;
        const keeper = { folk: ash.folk, p: keeperP };
        const traveller = { purse: 30 };
        const bed = Hospitality.npcPays(world, { houseId: null, what: 'room', payer: traveller, keeper });
        expect(bed.paid).toBeGreaterThan(0);
        expect(traveller.purse + keeperP.purse).toBeCloseTo(40, 5);
        const meal = Hospitality.npcPays(world, { houseId: null, what: 'meal', payer: { folk: ash.folk, p: diner }, keeper });
        expect(meal.paid).toBeGreaterThan(0);
        expect(diner.purse + keeperP.purse + traveller.purse).toBeCloseTo(60, 5);
        // can't pay, doesn't get it
        const broke = { purse: 0 };
        expect(Hospitality.npcPays(world, { what: 'room', payer: broke, keeper }).paid).toBe(0);
        expect(broke.purse).toBe(0);
    });

    it('the week\'s takings: the keeper townsperson draws their share into their purse', () => {
        const { world, ash } = makeWorld(10);
        const [keeperP] = grown(ash);
        keeperP.purse = 0;
        const h = { id: 'h1', kind: 'inn', q: ash.q, r: ash.r, cash: 500, keeperUid: `${ash.q},${ash.r}#${keeperP.id}` };
        expect(Hospitality.keeperPerson(world, h).p).toBe(keeperP);
        const paid = Hospitality._payKeeper(world, h, 40);
        expect(paid).toBe(40);
        expect(keeperP.purse).toBe(40);
        expect(h.cash).toBe(460);
        // (a house with a stranger for a keeper banks it)
        const own = { id: 'h2', kind: 'inn', cash: 0 };
        expect(Hospitality._payKeeper(world, own, 40)).toBe(0);
    });
});

describe('quarantine cuts trade (item 18)', () => {
    it('a link to a town shut by quarantine moves only a share of its goods, and few caravans take its road', () => {
        const { world, ash, grey } = makeWorld(10);
        const Q = DataLoader._gamedata.illness.quarantineTrade;
        expect(Q).toBeTruthy();
        const links = [];
        for (let i = 0; i < 40; i++) links.push({ a: ash, b: grey, factor: 1, embody: true, slot: i });
        // healthy: untouched
        expect(MarketDynamics._quarantine(world, links, 10)).toBe(0);
        expect(links.every(l => l.factor === 1)).toBe(true);
        // sickness in Greymoor, its gates shut
        grey.sickness = { d: 10, n: 5, abed: 3, share: 0.1, k: 'flux', epi: true, closed: true };
        expect(MarketDynamics._quarantine(world, links, 10)).toBe(40);
        expect(links[0].factor).toBeCloseTo(Q.imports, 5);
        const still = links.filter(l => l.embody).length;
        expect(still).toBeLessThan(40);
    });
});

describe('the player\'s "Break It Up" odds: steel counted once', () => {
    it('the chance shown is the chance rolled, with steel drawn as without', async () => {
        const { Brawls: B } = await import('../systems/brawls.js');
        const player = { strength: 9, charisma: 8 };
        const steel = { stage: 'weapons', ended: null, key: 'k' };
        const p = B.breakUpChance(player, steel);
        // over many fights, the share pulled apart matches p (not p × 0.6)
        let parted = 0;
        const N = 600;
        for (let i = 0; i < N; i++) {
            const f = { ...steel, key: `steel${i}`, sides: [[], []] };
            if (B.separate(f, 'player', p)) parted++;
        }
        expect(Math.abs(parted / N - p)).toBeLessThan(0.07);
        // a bystander's own try (no chance given) still finds steel harder
        let byStander = 0;
        for (let i = 0; i < N; i++) if (B.separate({ ...steel, key: `bs${i}`, sides: [[], []] }, 'peace')) byStander++;
        const base = B.config().bystanders.separate;
        expect(Math.abs(byStander / N - base * 0.6)).toBeLessThan(0.07);
    });
});

describe('grave robbing takes the digging\'s own time', () => {
    it('a spade quickens it by the tool rule, a cache\'s shallow hole sooner than a grave', async () => {
        const { Scavengers } = await import('../systems/scavengers.js');
        const D = DataLoader._gamedata.digging;
        const R = Scavengers.config().graveRobbers;
        const grave = { kind: 'plot' };
        // a body-snatcher brings a spade
        expect(Scavengers.robSeconds({ robber: { kind: 'snatcher' }, target: grave, day: 3 })).toBeCloseTo(R.digSeconds * D.toolSpeed, 5);
        // townsfolk: some with, some without, by who they are
        const times = new Set();
        for (let pid = 0; pid < 40; pid++) times.add(Scavengers.robSeconds({ robber: { kind: 'townsfolk', pid }, target: grave, day: 3 }));
        expect([...times].sort((a, b) => a - b)).toEqual([R.digSeconds * D.toolSpeed, R.digSeconds].sort((a, b) => a - b));
        const cache = Scavengers.robSeconds({ robber: { kind: 'outlaw' }, target: { kind: 'cache' }, day: 3 });
        expect(cache).toBeCloseTo(R.digSeconds * D.toolSpeed * D.seconds.dig / D.seconds.exhume, 5);
    });
});
