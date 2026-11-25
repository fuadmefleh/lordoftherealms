// The inquisition (systems/inquisition.js): inquisitors are persistent people
// a see sends into a realm whose heresy law admits them; they ride town to town
// and hold hearings that try real townsfolk — penances and seizures move coin
// from their purses into the see's coffers, the obstinate go to the stake on the
// town's scaffold (systems/executions.js) under the Holy Office — the realm's
// heresy falls, the town grows afraid, informers multiply, people flee. The
// player can be summoned (stand, recant, flee), and may host, bribe, obstruct
// or expel an inquisitor.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { Inquisition } from '../systems/inquisition.js';
import { HolyWars } from '../systems/holyWars.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Devotion } from '../systems/devotion.js';
import { Wanted } from '../systems/wanted.js';
import { Executions } from '../systems/executions.js';
import { Taxation } from '../systems/marketDynamics.js';
import { SettlementMarket } from '../world/settlementMarket.js';

let base = null;

beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.inquisition));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
    DataLoader._gamedata.inquisition = JSON.parse(JSON.stringify(base));
});

function realm(id, name, faithId, q, r, law) {
    return {
        id, name, isAlive: true, treasury: 5000, military: 400, population: 20000, capital: { q, r }, territory: [{ q, r }],
        wars: [], allies: [], relations: {}, laws: { heresy: law }, religion: { faithId, piety: 50, unity: 60, heresies: [{ id: 'dualist_heresy', name: 'Dualist Heresy', strength: 30 }], holySites: [] },
    };
}

function makeWorld(law = 'holy_office', day = 400) {
    const ks = [realm('k1', 'Valdor', 'solaris', 2, 2, law), realm('k2', 'Kharn', 'ironfaith', 9, 9, 'church_courts')];
    const towns = [
        { name: 'Solhaven', type: 'city', q: 2, r: 2, kingdom: 'k1', population: 5000, economy: { gold: 6000 } },
        { name: 'Brookmere', type: 'town', q: 5, r: 2, kingdom: 'k1', population: 2000, economy: { gold: 2000 } },
        { name: 'Kharnhold', type: 'city', q: 9, r: 9, kingdom: 'k2', population: 3000, economy: { gold: 3000 } },
    ];
    const tiles = new Map();
    for (const s of towns) tiles.set(`${s.q},${s.r}`, { q: s.q, r: s.r, kingdom: s.kingdom, settlement: s });
    const world = {
        day, baseYear: 853, width: 40, height: 30, generationParams: { seed: 5150 }, events: [], kingdoms: ks, units: [],
        getKingdom: (id) => ks.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getSettlementViews: () => towns,
    };
    for (const s of towns) { Townsfolk.seed(s, world, { q: s.q, r: s.r }); SettlementMarket.ensure(s); }
    // the sees
    world.day = 402;
    HolyWars.processDay(world, null);
    world.day = day;
    return { world, ks, towns };
}

function makePlayer(extra = {}) {
    return { name: 'Aldo Harness', gold: 3000, q: 2, r: 2, health: 100, karma: 0, reputation: {}, skills: {}, house: { name: 'House Harness', generation: 1, prestige: 0, rivals: {}, history: [] }, ...extra };
}

function days(world, player, n) {
    const notices = [];
    for (let i = 0; i < n; i++) { world.day++; notices.push(...Inquisition.processDay(world, player).notices); }
    return notices;
}

function folkCoin(towns) {
    let c = 0;
    for (const s of towns) {
        c += s.economy.gold;
        for (const p of s.folk.people) if (typeof p.purse === 'number' && !p.away) c += p.purse;
    }
    return c;
}

describe('inquisitors', () => {
    it('a see commissions one for a realm that admits him, and he rides to a town and holds a hearing', () => {
        const { world, ks } = makeWorld();
        const see = HolyWars.see(world, 'solaris|orthodox');
        const inq = Inquisition.commission(world, see, ks[0]);
        expect(inq.name).toMatch(/^(Brother|Sister) /);
        days(world, null, 20);
        expect(inq.tally.towns).toBeGreaterThan(0);
        expect(['hearing', 'rest', 'travel']).toContain(inq.phase);
    });

    it('the weekly spawn sends inquisitors only where the law admits them', () => {
        const { world } = makeWorld('tolerance');
        DataLoader._gamedata.inquisition.spawn.base = 1;
        days(world, null, 21);
        const list = Inquisition.state(world).list;
        expect(list.some(i => i.kingdomId === 'k1')).toBe(false);
        expect(list.some(i => i.kingdomId === 'k2')).toBe(true);
    });

    it('hearings try real townsfolk: heresy falls, coin moves to the see, never minted; the town grows afraid', () => {
        const { world, ks, towns } = makeWorld();
        DataLoader._gamedata.inquisition.hearing.tryChance = 1;
        DataLoader._gamedata.inquisition.hearing.base = 0.8;
        const see = HolyWars.see(world, 'solaris|orthodox');
        see.coffers = 1000;
        const inq = Inquisition.commission(world, see, ks[0]);
        const coinBefore = folkCoin(towns) + see.coffers;
        const heresy0 = ks[0].religion.heresies[0].strength;
        days(world, null, 40);
        expect(inq.tally.tried).toBeGreaterThan(3);
        expect(inq.tally.penanced + inq.tally.seized + inq.tally.burned).toBeGreaterThan(0);
        const left = ks[0].religion.heresies[0];
        expect(!left || left.strength < heresy0).toBe(true);
        // every coin accounted for: from the folk's purses into the see (and the keep back into the towns)
        const coinAfter = folkCoin(towns) + see.coffers + inq.purse;
        expect(Math.abs(coinAfter - coinBefore)).toBeLessThan(0.05);
        const t = towns.find(s => s.inquisition && s.inquisition.hearings);
        expect(t.inquisition.tried).toBeGreaterThan(0);
        expect(Taxation.inquisitionMood(t)).toBeLessThanOrEqual(0);
    });

    it('under the Holy Office the obstinate go to the stake on the town\'s scaffold', () => {
        const { world, ks } = makeWorld('holy_office');
        DataLoader._gamedata.inquisition.hearing.tryChance = 1;
        DataLoader._gamedata.inquisition.hearing.base = 0.9;
        DataLoader._gamedata.inquisition.hearing.burnShare = 1;
        const see = HolyWars.see(world, 'solaris|orthodox');
        const inq = Inquisition.commission(world, see, ks[0]);
        inq.zeal = 1;
        days(world, null, 30);
        const burns = (world.executions && world.executions.public || []).filter(e => e.method === 'burn' && e.crime === 'heresy');
        expect(burns.length).toBeGreaterThan(0);
        expect(burns[0].by).toBe(inq.name);
        // ...and the scaffold carries them out
        for (let i = 0; i < 5; i++) { world.day++; Executions.processDay(world, null); }
        expect((world.executions.log || []).some(l => l.method === 'burn')).toBe(true);
    });

    it('the bishops\' courts burn no one', () => {
        const { world, ks } = makeWorld('church_courts');
        DataLoader._gamedata.inquisition.hearing.tryChance = 1;
        DataLoader._gamedata.inquisition.hearing.base = 0.9;
        DataLoader._gamedata.inquisition.hearing.burnShare = 1;
        const see = HolyWars.see(world, 'solaris|orthodox');
        const inq = Inquisition.commission(world, see, ks[0]);
        inq.zeal = 1;
        days(world, null, 30);
        expect(inq.tally.burned).toBe(0);
        expect(inq.tally.tried).toBeGreaterThan(0);
    });

    it('frightened people flee to another realm: population moved, not lost', () => {
        const { world, ks, towns } = makeWorld();
        DataLoader._gamedata.inquisition.town.fleeShare = 0.02;
        DataLoader._gamedata.inquisition.town.fleeAt = 0;
        const see = HolyWars.see(world, 'solaris|orthodox');
        Inquisition.commission(world, see, ks[0]);
        const pop0 = towns.reduce((s, t) => s + t.population, 0);
        days(world, null, 30);
        expect(towns.reduce((s, t) => s + t.population, 0)).toBe(pop0);
        expect(towns.find(t => t.name === 'Kharnhold').population).toBeGreaterThan(3000);
    });

    it('an inquisitor dies or ends his commission, and his purse goes to the see', () => {
        const { world, ks } = makeWorld();
        const see = HolyWars.see(world, 'solaris|orthodox');
        const inq = Inquisition.commission(world, see, ks[0]);
        inq.purse = 80;
        const c0 = see.coffers;
        inq.until = world.day + 1;
        days(world, null, 2);
        expect(Inquisition.state(world).list).not.toContain(inq);
        expect(see.coffers).toBeCloseTo(c0 + 80 - 0, 0);
    });
});

describe('the inquisition and the player', () => {
    function withInquisitor(law = 'holy_office') {
        const ctx = makeWorld(law);
        const see = HolyWars.see(ctx.world, 'solaris|orthodox');
        const inq = Inquisition.commission(ctx.world, see, ctx.ks[0]);
        inq.dest = { q: 2, r: 2, town: 'Solhaven' };
        inq.phase = 'travel';
        inq.arrive = ctx.world.day + 1;
        return { ...ctx, see, inq };
    }

    it('a stranger to the faith in his town is summoned; not answering posts a warrant for heresy', () => {
        const { world, inq, see } = withInquisitor();
        const player = makePlayer();
        Devotion.state(player).faithId = 'ironfaith';
        expect(Inquisition.suspicion(player, world, inq).value).toBeGreaterThanOrEqual(40);
        player.religion = { name: 'The Lantern Path', tenets: [], presence: {} };
        const n = days(world, player, 3);
        expect(player.inquisition.summons).toBeTruthy();
        expect(n.some(x => x.title === 'Summoned by the Inquisition')).toBe(true);
        player.q = 20; player.r = 20;
        days(world, player, 10);
        expect(player.inquisition.summons).toBeNull();
        expect(Wanted.realm(player, 'k1').charges.heresy.grave).toBe(true);
        expect(see.grievance.player).toBeGreaterThan(0);
    });

    it('standing the hearing: a verdict, and the coin goes to the see', () => {
        const { world, inq, see } = withInquisitor();
        const player = makePlayer({ religion: { name: 'The Lantern Path', tenets: [], presence: {} } });
        days(world, player, 3);
        expect(player.inquisition.summons).toBeTruthy();
        const c0 = see.coffers;
        const g0 = player.gold;
        const res = Inquisition.answerSummons(player, world, 'stand');
        expect(res.success).toBe(true);
        expect(['acquitted', 'penance', 'confiscated', 'relapsed']).toContain(res.verdict);
        if (res.verdict !== 'acquitted') expect(see.coffers - c0).toBeCloseTo(g0 - player.gold, 1);
        if (res.verdict === 'relapsed') expect(player.jailState.offense).toBe('heresy');
        void inq;
    });

    it('recanting: a penance and shame, no verdict', () => {
        const { world } = withInquisitor();
        const player = makePlayer({ religion: { name: 'The Lantern Path', tenets: [], presence: {} } });
        days(world, player, 3);
        const res = Inquisition.answerSummons(player, world, 'recant');
        expect(res.verdict).toBe('recanted');
        expect(player.gold).toBeLessThan(3000);
    });

    it('hosting him wins his favour; a bribe is taken by the greedy and refused by the zealous', () => {
        const { world, inq } = withInquisitor();
        const player = makePlayer();
        Devotion.state(player).faithId = 'solaris';
        days(world, player, 2);
        expect(Inquisition.here(player, world)).toBe(inq);
        const s0 = Inquisition.suspicion(player, world, inq).value;
        const host = Inquisition.act(player, world, inq.id, 'host');
        expect(host.success).toBe(true);
        expect(Inquisition.suspicion(player, world, inq).value).toBeLessThanOrEqual(s0);
        // a zealot refuses
        inq.zeal = 1; inq.greed = 0;
        const refused = Inquisition.act(player, world, inq.id, 'bribe');
        expect(refused.accepted).toBe(false);
        expect(player.inquisition.bribeRefused).toBe(world.day);
        // a greedy man takes it
        inq.zeal = 0; inq.greed = 1;
        const g0 = player.gold;
        const took = Inquisition.act(player, world, inq.id, 'bribe');
        expect(took.accepted).toBe(true);
        expect(inq.purse).toBe(g0 - player.gold);
        expect(inq.phase).toBe('rest');
    });

    it('obstructing a hearing shortens it and halves the convictions', () => {
        const { world, inq } = withInquisitor();
        const player = makePlayer();
        Devotion.state(player).faithId = 'solaris';
        days(world, player, 2);
        const end0 = inq.hearingEnd;
        const res = Inquisition.act(player, world, inq.id, 'obstruct');
        expect(res.success).toBe(true);
        expect(inq.hearingEnd).toBeLessThan(end0);
        expect(inq.convictMult).toBe(0.5);
        expect(player.inquisition.obstructions).toBe(1);
    });

    it('a ruler expels him from the realm: the see\'s grievance, his standing', () => {
        const { world, ks, inq, see } = withInquisitor();
        ks[0].crown = { playerRuled: true };
        const player = makePlayer({ throne: { ruling: { kingdomId: 'k1' } } });
        Devotion.state(player).faithId = 'solaris';
        days(world, player, 2);
        const opt = Inquisition.options(player, world, inq).find(o => o.act === 'expel');
        expect(opt.ok).toBe(true);
        const res = Inquisition.act(player, world, inq.id, 'expel');
        expect(res.success).toBe(true);
        expect(Inquisition.state(world).list).not.toContain(inq);
        expect(see.grievance.k1).toBeGreaterThan(0);
        expect(Devotion.standing(player, 'solaris')).toBeLessThan(0);
    });

    it('the state survives a save', () => {
        const { world, inq } = withInquisitor();
        days(world, null, 3);
        const w2 = { ...world };
        Inquisition.restore(Inquisition.serialize(world), w2);
        expect(Inquisition.get(w2, inq.id).name).toBe(inq.name);
    });
});
