// Brawls (systems/brawls.js): townsfolk come to blows with each other — for
// reasons the sim holds (drink, grudges, a haggle, a cutpurse, the watch,
// rival retainers), words → shove → fists (→ steel), allies, peacemakers,
// the watch, rare deaths through the downed odds, and what the town
// remembers. All hash streams: the same seed tells the same story.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Brawls } from '../systems/brawls.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SettlementMarket } from '../world/settlementMarket.js';

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
    const world = {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], kingdoms: [], units: [], getKingdom: () => null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null, getSettlementViews: () => towns,
    };
    for (const t of towns) { Townsfolk.seed(t, world, { q: t.q, r: t.r }); SettlementMarket.ensure(t); }
    return { world, ash: towns[0], grey: towns[1] };
}

function adults(s, day = 10) {
    return Townsfolk.residents(s.folk).filter(p => Townsfolk.age(p, day) >= 18 && p.role !== 'child' && p.role !== 'priest');
}

/** Two adults of the town, as fighters (the first made bold, the second stubborn). */
function pair(s, opts = {}) {
    const [pa, pb] = adults(s);
    pa.traits = opts.ta || ['bold'];
    pb.traits = opts.tb || ['stubborn'];
    pa.role = opts.ra || 'villager';
    pb.role = opts.rb || 'villager';
    return { pa, pb, a: Brawls.fighter(pa, { drunk: !!opts.drunk }), b: Brawls.fighter(pb) };
}

describe('fights start under the right conditions', () => {
    it('the tavern: of an evening, more as it gets late and with drink; never at noon', () => {
        const { ash } = makeWorld();
        const { pa, pb } = pair(ash);
        expect(Brawls.startChance('tavern', pa, pb, { hour: 12 })).toBe(0);
        const evening = Brawls.startChance('tavern', pa, pb, { hour: 18 });
        const late = Brawls.startChance('tavern', pa, pb, { hour: 23 });
        const drunk = Brawls.startChance('tavern', pa, pb, { hour: 23, drunkA: true, drunkB: true });
        expect(evening).toBeGreaterThan(0);
        expect(late).toBeGreaterThan(evening);
        expect(drunk).toBeGreaterThan(late);
    });

    it('tempers matter: the bold sooner than the kind; children and priests not at all', () => {
        const { ash } = makeWorld();
        const hot = pair(ash);
        const hotP = Brawls.startChance('market', hot.pa, hot.pb, { hour: 10 });
        const calm = pair(ash, { ta: ['kind'], tb: ['cautious'] });
        const calmP = Brawls.startChance('market', calm.pa, calm.pb, { hour: 10 });
        expect(hotP).toBeGreaterThan(calmP * 2);
        const child = { ...calm.pa, role: 'child', traits: ['bold'] };
        expect(Brawls.startChance('market', child, calm.pb, { hour: 10 })).toBe(0);
        const priest = { ...calm.pa, role: 'priest', traits: ['bold'] };
        expect(Brawls.startChance('market', priest, calm.pb, { hour: 10 })).toBeLessThan(hotP);
        // the market only keeps market hours
        expect(Brawls.startChance('market', hot.pa, hot.pb, { hour: 22 })).toBe(0);
    });

    it('a grudge: likelier the hotter it runs', () => {
        const { ash } = makeWorld();
        const { pa, pb } = pair(ash);
        const cool = Brawls.startChance('grudge', pa, pb, { hour: 14, heat: 10 });
        const hot = Brawls.startChance('grudge', pa, pb, { hour: 14, heat: 80 });
        expect(hot).toBeGreaterThan(cool);
    });

    it('works on inner-map NPCs too (personalityTraits, type)', () => {
        const a = { id: 1, type: 'villager', personalityTraits: ['bold'] };
        const b = { id: 2, type: 'farmer', personalityTraits: ['stern'] };
        expect(Brawls.startChance('tavern', a, b, { hour: 22, drunkA: true })).toBeGreaterThan(0.2);
        const f = Brawls.fighter(a);
        expect(f.npcId).toBe(1);
        expect(f.max).toBeGreaterThan(20);
    });
});

describe('a fight escalates and resolves', () => {
    it('words → shove → fists, or someone backs down; always ends; same key, same story', () => {
        const { ash } = makeWorld();
        const outcomes = new Set();
        let backDowns = 0;
        for (let i = 0; i < 80; i++) {
            const { a, b } = pair(ash);
            const fight = Brawls.begin(a, b, { key: `t${i}`, cause: 'tavern', place: 'tavern', day: 10 });
            Brawls.simulate(fight, { town: 'city' });
            expect(fight.ended).toBeTruthy();
            expect(['ko', 'fled', 'parted', 'watch', 'backDown', 'death']).toContain(fight.ended.how);
            if (fight.ended.how === 'backDown') { backDowns++; expect(['words', 'shove']).toContain(fight.stage); }
            outcomes.add(fight.ended.how);
            const again = pair(ash);
            const twin = Brawls.begin(again.a, again.b, { key: `t${i}`, cause: 'tavern', place: 'tavern', day: 10 });
            Brawls.simulate(twin, { town: 'city' });
            expect(twin.ended).toEqual(fight.ended);
            expect(twin.stage).toBe(fight.stage);
        }
        expect(backDowns).toBeGreaterThan(0);
        expect(backDowns).toBeLessThan(60);
        expect(outcomes.size).toBeGreaterThanOrEqual(3);
    });

    it('blows land, hurt and knock out; a shove hurts no one', () => {
        const { ash } = makeWorld();
        const { a, b } = pair(ash);
        const fight = Brawls.begin(a, b, { key: 'blows', cause: 'grudge', day: 10 });
        fight.stage = 'shove';
        expect(Brawls.exchange(fight, a, b)).toMatchObject({ shove: true, dmg: 0 });
        fight.stage = 'fists';
        let n = 0;
        while (!fight.ended && n++ < 200) Brawls.exchange(fight, n % 2 ? a : b, n % 2 ? b : a);
        expect(fight.ended).toBeTruthy();
        const loser = fight.ended.winner === 0 ? b : a;
        expect(['ko', 'fled']).toContain(loser.out);
        expect(loser.hp).toBeLessThan(loser.max);
    });

    it('steel only when someone is armed and it is serious', () => {
        const { ash } = makeWorld();
        // Unarmed townsmen in a grudge: no steel
        for (let i = 0; i < 30; i++) {
            const { a, b } = pair(ash);
            const f = Brawls.begin(a, b, { key: `u${i}`, cause: 'grudge', day: 10 });
            f.stage = 'fists'; a.hp = Math.round(a.max * 0.4);
            expect(Brawls.maybeSteel(f)).toBe(false);
        }
        // A guard in a tavern spat (not serious): no steel either
        const { a, b } = pair(ash, { ra: 'guard' });
        expect(a.armed).toBe(true);
        const tav = Brawls.begin(a, b, { key: 'tav', cause: 'tavern', day: 10 });
        tav.stage = 'fists'; b.hp = Math.round(b.max * 0.4);
        for (let i = 0; i < 20; i++) expect(Brawls.maybeSteel(tav)).toBe(false);
        // A guard in a grudge, the blood up: sometimes it comes to steel
        let steel = 0;
        for (let i = 0; i < 40; i++) {
            const p2 = pair(ash, { ra: 'guard' });
            const g = Brawls.begin(p2.a, p2.b, { key: `g${i}`, cause: 'grudge', day: 10 });
            g.stage = 'fists'; p2.b.hp = Math.round(p2.b.max * 0.4);
            if (Brawls.maybeSteel(g)) steel++;
        }
        expect(steel).toBeGreaterThan(0);
    });
});

describe('the crowd', () => {
    it('allies join a side (at most maxPerSide), peacemakers can part them', () => {
        const { ash } = makeWorld();
        const { a, b } = pair(ash);
        const fight = Brawls.begin(a, b, { key: 'crowd', cause: 'grudge', day: 10 });
        fight.stage = 'fists';
        const more = adults(ash).slice(2, 7).map(p => Brawls.fighter(p));
        expect(Brawls.join(fight, more[0], 1)).toBe(true);
        expect(more[0].ally).toBe(true);
        expect(Brawls.join(fight, more[0], 1)).toBe(false);   // (already in)
        Brawls.join(fight, more[1], 1);
        expect(Brawls.join(fight, more[2], 1)).toBe(false);   // (three a side)
        expect(Brawls.standing(fight, 1).length).toBe(3);
        // Kin wade in more readily than friends
        let kin = 0, friend = 0;
        for (let i = 0; i < 200; i++) { if (Brawls.joinRoll(fight, 'kin', `k${i}`)) kin++; if (Brawls.joinRoll(fight, 'friend', `f${i}`)) friend++; }
        expect(kin).toBeGreaterThan(friend);
        expect(Brawls.peacemaker(['kind'], 'villager')).toBe(true);
        expect(Brawls.peacemaker([], 'priest')).toBe(true);
        expect(Brawls.peacemaker(['bold'], 'villager')).toBe(false);
        expect(Brawls.separate(fight, 'player', 1)).toBe(true);
        expect(fight.ended).toMatchObject({ how: 'parted' });
    });
});

describe('aftermath', () => {
    it('the watch takes the instigator: fined to the town purse, jailed, remembered', () => {
        const { world, ash } = makeWorld();
        const { pa, pb, a, b } = pair(ash);
        pa.purse = 40;
        const gold = ash.economy.gold;
        const fight = Brawls.begin(a, b, { key: 'watch1', cause: 'grudge', place: 'street', day: 10 });
        fight.stage = 'fists';
        Brawls.exchange(fight, a, b);
        Brawls.watchArrives(fight);
        const res = Brawls.settle(world, ash, fight, { day: 10, seenBy: ['Ada'] });
        expect(res.arrested).toBe(true);
        expect(res.fine).toBeGreaterThan(0);
        expect(pa.purse).toBe(40 - res.fine);
        expect(ash.economy.gold).toBe(gold + res.fine);
        expect(pa.jailedUntil).toBeGreaterThan(10);
        expect(pa.log.some(e => e.k === 'jailed')).toBe(true);
        expect(pb.jailedUntil).toBeUndefined();
        // The town's record of it
        expect(ash.npcCrimes.some(c => c.k === 'brawl' && c.caught)).toBe(true);
    });

    it('memory and grudges: a feud grows, each remembers, the town tells it, injuries heal', () => {
        const { world, ash } = makeWorld();
        const { pa, pb, a, b } = pair(ash);
        const fight = Brawls.begin(a, b, { key: 'mem', cause: 'tavern', place: 'tavern', day: 10 });
        fight.stage = 'fists';
        let n = 0;
        while (!fight.ended && n++ < 200) Brawls.exchange(fight, n % 2 ? a : b, n % 2 ? b : a);
        const res = Brawls.settle(world, ash, fight, { day: 10 });
        const feud = Brawls.feud(ash, pa.id, pb.id);
        expect(feud).toBeTruthy();
        expect(feud.heat).toBeGreaterThan(10);
        expect(pa.log.some(e => e.k === 'brawl' && e.o === pb.id)).toBe(true);
        expect(pb.log.some(e => e.k === 'brawl' && e.o === pa.id)).toBe(true);
        const told = ash.folk.annals.find(e => e.k === 'brawl');
        expect(told).toBeTruthy();
        const text = Townsfolk.annalText(ash.folk, told, world);
        expect(text).toContain(a.name);
        expect(text).toContain('tavern');
        expect(res.line.length).toBeGreaterThan(10);
        // The loser is hurt, and heals in time
        const loser = fight.ended.winner === 0 ? pb : pa;
        expect(Townsfolk.injury(loser, 10)).toBeTruthy();
        expect(Townsfolk.injury(loser, 40)).toBe(null);
        // A life line about it
        const e = loser.log.find(x => x.k === 'brawl');
        expect(Townsfolk.lifeText(ash.folk, loser, e, world)).toMatch(/blows|beating|words/);
    });

    it('the keeper bars the one who started a tavern fight', () => {
        const { world, ash } = makeWorld();
        const { pa, a, b } = pair(ash);
        const fight = Brawls.begin(a, b, { key: 'bar', cause: 'tavern', place: 'tavern', day: 10 });
        fight.stage = 'fists';
        Brawls.end(fight, 'parted', null, 'keeper');
        const res = Brawls.settle(world, ash, fight, { day: 10, bar: true });
        expect(res.barred).toBe(true);
        expect(Brawls.isBarred(ash, pa.id, 11)).toBe(true);
        expect(Brawls.isBarred(ash, pa.id, 200)).toBe(false);
    });
});

describe('off the map', () => {
    it('grudges are born from the town, cool, and are forgotten', () => {
        const { world, ash } = makeWorld();
        let born = 0;
        for (let d = 10; d < 130; d++) { world.day = d; if (Brawls.seedGrudge(world, ash, d)) born++; }
        expect(born).toBeGreaterThan(2);
        expect(born).toBeLessThan(40);
        const st = Brawls.state(ash);
        const whys = new Set(Object.values(st.feuds).map(f => f.why));
        expect(whys.size).toBeGreaterThan(0);
        // Left alone, they cool away
        for (const f of Object.values(st.feuds)) f.heat = 5;
        world.day = 200;
        Brawls.processDay(world, null);
        world.day = 201;
        Brawls.processDay(world, null);
        world.day = 202;
        Brawls.processDay(world, null);
        expect(Object.values(st.feuds).filter(f => f.d < 200).length).toBe(0);
    });

    it('a cutpurse the mark noticed leaves a grudge (systems/npcTheft.js cases)', () => {
        const { ash } = makeWorld();
        const [v, t] = adults(ash);
        ash.npcTheft = { cases: [{ id: 1, k: 'pickpocket', d: 10, named: true, status: 'noticed', thief: { pid: t.id, name: 'x' }, victim: { kind: 'npc', pid: v.id, name: 'y' } }] };
        Brawls._cutpurseGrudges(ash, 10);
        expect(Brawls.feud(ash, v.id, t.id)).toMatchObject({ why: 'cutpurse' });
    });

    it('fights resolve at a sane rate, with injuries, grudges and arrests; not in the town the player walks', () => {
        const { world, ash, grey } = makeWorld();
        const player = { q: grey.q, r: grey.r };
        let fights = 0;
        for (let d = 10; d < 250; d++) {
            world.day = d;
            const r = Brawls.processDay(world, player, { onMap: true });
            fights += r.events.filter(e => e.kind === 'brawl' && e.hex === `${ash.q},${ash.r}`).length;
            expect(r.events.some(e => e.kind === 'brawl' && e.hex === `${grey.q},${grey.r}`)).toBe(false);
        }
        expect(fights).toBeGreaterThan(3);
        expect(fights).toBeLessThan(80);
        expect(Brawls.state(ash).log.length).toBeGreaterThan(0);
        expect(ash.folk.annals.some(e => e.k === 'brawl')).toBe(true);
        expect(ash.folk.people.some(p => p.log.some(e => e.k === 'brawl'))).toBe(true);
    });

    it('the same seed, the same brawls', () => {
        const run = () => {
            const { world, ash } = makeWorld();
            const out = [];
            for (let d = 10; d < 120; d++) { world.day = d; out.push(...Brawls.processDay(world, null).events.map(e => `${d}:${e.kind}:${e.how || ''}`)); }
            return { out, log: Brawls.state(ash).log };
        };
        expect(run()).toEqual(run());
    });

    it('rival retainers in the same town come to blows (systems/rivalHouses.js retinues)', () => {
        const { world, ash } = makeWorld();
        world.units = [
            { type: 'rival_retinue', id: 'r1', q: ash.q, r: ash.r, houseName: 'House Vane' },
            { type: 'rival_retinue', id: 'r2', q: ash.q, r: ash.r, houseName: 'House Orme' },
        ];
        let res = null;
        for (let d = 10; d < 200 && !res; d++) res = Brawls.resolveRetainers(world, ash, d);
        expect(res).toBeTruthy();
        expect(res.line).toMatch(/Vane|Orme/);
    });
});

describe('death is rare, and goes through the downed odds', () => {
    it('a fist fight almost never kills; steel sometimes; a death is on the roster and in the annals', () => {
        const { world, ash } = makeWorld();
        let fistDeaths = 0, steelDeaths = 0, kos = 0;
        for (let i = 0; i < 400; i++) {
            const p1 = pair(ash);
            const f = Brawls.begin(p1.a, p1.b, { key: `d${i}`, cause: 'tavern', day: 10 });
            Brawls.simulate(f, { town: 'village' });
            if (Brawls.fighters(f).some(x => x.out === 'ko' || x.out === 'dead')) kos++;
            if (Brawls.fighters(f).some(x => x.out === 'dead')) fistDeaths++;
            const p2 = pair(ash, { ra: 'guard', rb: 'guard' });
            const g = Brawls.begin(p2.a, p2.b, { key: `s${i}`, cause: 'grudge', day: 10 });
            g.heat = 80;
            g.stage = 'weapons';
            for (let n = 0; n < 200 && !g.ended; n++) Brawls.exchange(g, n % 2 ? p2.a : p2.b, n % 2 ? p2.b : p2.a);
            if (Brawls.fighters(g).some(x => x.bleed)) steelDeaths++;
        }
        expect(kos).toBeGreaterThan(20);
        expect(fistDeaths / 400).toBeLessThan(0.02);
        expect(steelDeaths).toBeGreaterThan(fistDeaths);
        // The dead are dead on the roster, and the town says how
        const [p] = adults(ash);
        expect(Brawls.recordDeath(world, ash, p.id, 'Brom', 12)).toBe(true);
        expect(p.died).toBe(12);
        expect(ash.folk.annals.some(e => e.k === 'died' && /brawl/.test(e.x))).toBe(true);
    });
});

describe('the player', () => {
    it('odds favour the stronger side; a bet pays at its odds, voids with no winner', () => {
        const { ash } = makeWorld();
        const { a, b } = pair(ash, { ra: 'guard', rb: 'villager' });
        const fight = Brawls.begin(a, b, { key: 'bet', cause: 'tavern', day: 10 });
        fight.stage = 'fists';
        const oa = Brawls.odds(fight, 0);
        const ob = Brawls.odds(fight, 1);
        expect(oa.p).toBeGreaterThan(ob.p);
        expect(oa.odds).toBeLessThan(ob.odds);
        Brawls.end(fight, 'ko', 0);
        expect(Brawls.settleBet({ side: 0, stake: 10, odds: oa.odds }, fight)).toMatchObject({ won: true, payout: Math.round(10 * oa.odds) });
        expect(Brawls.settleBet({ side: 1, stake: 10, odds: ob.odds }, fight)).toMatchObject({ won: false, payout: 0 });
        const parted = Brawls.begin(a, b, { key: 'bet2', day: 10 });
        Brawls.end(parted, 'parted', null);
        expect(Brawls.settleBet({ side: 0, stake: 10, odds: 2 }, parted)).toMatchObject({ void: true, payout: 10 });
    });

    it('breaking it up: easier for the strong, and for the ruler', () => {
        const fight = { stage: 'fists' };
        const weak = Brawls.breakUpChance({ strength: 2, charisma: 2 }, fight);
        const strong = Brawls.breakUpChance({ strength: 9, charisma: 8 }, fight);
        const ruler = Brawls.breakUpChance({ strength: 2, charisma: 2 }, fight, { ruler: true });
        expect(strong).toBeGreaterThan(weak);
        expect(ruler).toBeGreaterThan(weak);
        expect(Brawls.breakUpChance({ strength: 9, charisma: 8 }, { stage: 'weapons' })).toBeLessThan(strong);
    });
});
