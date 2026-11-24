// Blood feuds and blood money (systems/bloodFeuds.js): a killing makes the
// dead one's kin owe vengeance on the killer's family; feuds pass down the
// generations, cool and flare; avengers act against the player's House
// (capped); a blood price moves real coin from purse to purse before an
// arbiter; a wedding ends a feud; the world's own families feud among
// themselves, capped. All rolls are hashes of the world seed.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { BloodFeuds } from '../systems/bloodFeuds.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Brawls } from '../systems/brawls.js';
import { SettlementMarket } from '../world/settlementMarket.js';

let base = null;

beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.bloodFeuds));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
    DataLoader._gamedata.bloodFeuds = JSON.parse(JSON.stringify(base));
});

function makeWorld(day = 400, law = 'customary') {
    const town = { name: 'Ashford', type: 'city', q: 5, r: 7, kingdom: 'k1', economy: { gold: 5000 } };
    const realm = { id: 'k1', name: 'Arnor', isAlive: true, treasury: 2000, laws: { bloodPrice: law } };
    const tiles = new Map([[`${town.q},${town.r}`, { q: town.q, r: town.r, settlement: town }]]);
    const world = {
        day, baseYear: 853, generationParams: { seed: 777 }, activeEvents: [], kingdoms: [realm], units: [],
        getKingdom: (id) => (id === 'k1' ? realm : null),
        getTile: (q, r) => tiles.get(`${q},${r}`) || null, getSettlementViews: () => [town],
    };
    Townsfolk.seed(town, world, { q: town.q, r: town.r });
    SettlementMarket.ensure(town);
    // Two families of three grown men and women each, unwed, of an age to marry
    const grown = Townsfolk.residents(town.folk).filter(p => Townsfolk.age(p, day) >= 20 && Townsfolk.age(p, day) <= 34);
    const fam = (last, people) => people.forEach((p, i) => {
        p.last = last; p.maiden = null; p.spouse = null; p.gender = i % 2 ? 'female' : 'male'; p.role = 'villager'; p.away = null;
    });
    const millers = grown.slice(0, 3);
    const tanners = grown.slice(3, 6);
    fam('Miller', millers);
    fam('Tanner', tanners);
    // (nobody else in town shares the names)
    for (const p of town.folk.people) if (!millers.includes(p) && !tanners.includes(p) && (p.last === 'Miller' || p.last === 'Tanner' || p.maiden === 'Miller' || p.maiden === 'Tanner')) { p.last = 'Other'; p.maiden = null; }
    return { world, town, realm, millers, tanners };
}

function makePlayer(world) {
    return {
        name: 'Aldo Harness', gold: 5000, q: 5, r: 7, health: 100, karma: 0, reputation: {}, skills: { diplomacy: 4, combat: 2 },
        house: { name: 'House Harness', generation: 1, rivals: {}, chronicle: [] }, army: [],
    };
}

function days(world, player, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        notices.push(...BloodFeuds.processDay(world, player).notices);
    }
    return notices;
}

describe('a killing makes a blood feud', () => {
    it('the player murders a Miller before witnesses: the Millers owe the House blood', () => {
        const { world, town, millers } = makeWorld();
        const player = makePlayer(world);
        const victim = millers[0];
        // (the path the street takes: a seen murder → the kin's memory → the feud)
        NpcMemory.rememberKin(world, { folk: town.folk, person: victim }, { kind: 'murdered', player });
        Townsfolk.slay(town.folk, victim, world.day, 'at the hands of Aldo', world);
        const feuds = BloodFeuds.ofPlayer(world);
        expect(feuds).toHaveLength(1);
        const f = feuds[0];
        expect(f.sides[0]).toMatchObject({ kind: 'folk', last: 'Miller', q: 5, r: 7 });
        expect(f.sides[1].kind).toBe('player');
        expect(f.owes).toBe(0);
        expect(f.heat).toBeGreaterThanOrEqual(50);
        expect(f.deaths[0].name).toBe(`${victim.first} Miller`);
        // ...a second killing flares it, never doubles it
        BloodFeuds.onKinMemory(world, player, town.folk, victim, 'murdered');
        expect(BloodFeuds.ofPlayer(world)).toHaveLength(1);
        // and the town tells of it
        expect(town.folk.annals.some(a => a.k === 'bloodFeud')).toBe(true);
    });

    it('a lone soul with no kin in town leaves no one to swear; an innocent hanged always does', () => {
        const { world, town } = makeWorld();
        const player = makePlayer(world);
        const loner = Townsfolk.residents(town.folk).find(p => p.last === 'Other' || !['Miller', 'Tanner'].includes(p.last));
        loner.last = 'Nobody';
        expect(BloodFeuds.onKinMemory(world, player, town.folk, loner, 'murdered')).toBeNull();
        const { world: w2, town: t2, tanners } = makeWorld();
        const f = BloodFeuds.onKinMemory(w2, makePlayer(w2), t2.folk, tanners[0], 'wrongly_condemned');
        expect(f && f.sides[0].last).toBe('Tanner');
    });

    it('a brawl that bleeds sets two families of townsfolk at feud', () => {
        const { world, town, millers, tanners } = makeWorld();
        Brawls.recordDeath(world, town, tanners[0].id, `${millers[0].first} Miller`, world.day, millers[0].id);
        const f = BloodFeuds.find(world, 'folk:5,7:Tanner', 'folk:5,7:Miller');
        expect(f).toBeTruthy();
        expect(f.sides[f.owes].last).toBe('Tanner');
        expect(BloodFeuds.playerIndex(f)).toBe(-1);
    });
});

describe('feuds pass down the generations', () => {
    it('the heir inherits the House\'s feuds, a generation cooler', () => {
        const { world, town, millers } = makeWorld();
        const player = makePlayer(world);
        BloodFeuds.processDay(world, player);
        const f = BloodFeuds.onKinMemory(world, player, town.folk, millers[0], 'murdered');
        Townsfolk.slay(town.folk, millers[0], world.day, 'murder', world);
        const heat = f.heat;
        player.house.generation = 2;
        player.name = 'Bran Harness';
        const notices = days(world, player, 1);
        expect(f.gens[1]).toBe(1);
        expect(f.heat).toBeLessThan(heat);
        expect(notices.some(n => /passes to Bran/.test(n.text))).toBe(true);
    });

    it('when the one who carries it dies, the next of the family takes it up', () => {
        const { world, town, millers } = makeWorld();
        const player = makePlayer(world);
        const f = BloodFeuds.onKinMemory(world, player, town.folk, millers[0], 'murdered');
        Townsfolk.slay(town.folk, millers[0], world.day, 'murder', world);
        f.heat = 90;
        days(world, player, 30);
        const first = BloodFeuds.bearer(world, player, f.sides[0]);
        expect(first && first.person).toBeTruthy();
        Townsfolk.slay(town.folk, first.person, world.day, 'a fever', world);
        days(world, player, 30);
        const next = BloodFeuds.bearer(world, player, f.sides[0]);
        expect(next.id).not.toBe(first.id);
        expect(f.gens[0]).toBe(1);
        // ...and with the last of them gone, the feud dies with the line
        Townsfolk.slay(town.folk, next.person, world.day, 'a fever', world);
        days(world, player, 31);
        expect(BloodFeuds.get(world, f.id)).toBeNull();
        expect(BloodFeuds.state(world).past[0].ended.how).toBe('extinct');
    });
});

describe('avengers act against the House — capped', () => {
    it('they refuse to trade, testify, and strike at most once in blowGapDays; never a bloodbath', () => {
        const { world, town, millers } = makeWorld();
        const player = makePlayer(world);
        const f = BloodFeuds.onKinMemory(world, player, town.folk, millers[0], 'murdered');
        Townsfolk.slay(town.folk, millers[0], world.day, 'murder', world);
        // Refusal: a Miller will not deal with you
        const npc = { name: millers[1].first, _person: millers[1], _folk: town.folk };
        expect(BloodFeuds.refusesTrade(world, player, npc).refuses).toBe(true);
        expect(NpcDisposition.getPriceModifiers(npc, { player, world, kingdomId: 'k1' }).refuses).toBe(true);
        expect(BloodFeuds.refusesTrade(world, player, { name: 'x', _person: { last: 'Other', first: 'x' }, _folk: town.folk }).refuses).toBe(false);
        // Testimony at your trial in their town
        expect(BloodFeuds.witnessesAgainst(world, player, town).length).toBe(1);
        expect(BloodFeuds.testimony({ bloodWitnesses: [{}, {}] })).toBeGreaterThan(0);
        // Years of it, kept hot: acts spaced, blows rarer still
        const C = BloodFeuds.config();
        const acts = [];
        for (let y = 0; y < 6 * 120; y++) {
            if (BloodFeuds.get(world, f.id)) f.heat = Math.max(f.heat, 85);
            world.day++;
            for (const n of BloodFeuds.processDay(world, player).notices) acts.push({ d: world.day, n });
        }
        const vengeance = acts.filter(a => /Vengeance|Driven Off|Slain|Blade|Bad Blood/.test(a.n.title));
        expect(vengeance.length).toBeGreaterThan(0);
        for (let i = 1; i < vengeance.length; i++) expect(vengeance[i].d - vengeance[i - 1].d).toBeGreaterThanOrEqual(C.acts.gapDays);
        const blows = vengeance.filter(a => /Vengeance|Driven Off|Slain/.test(a.n.title));
        expect(blows.length).toBeLessThanOrEqual(Math.ceil(720 / C.acts.blowGapDays) + 1);
        expect(player.health).toBeGreaterThan(0);
    });
});

describe('blood money', () => {
    it('wergild moves real coin: out of your purse into the kin\'s, the arbiter\'s tithe into the town\'s', () => {
        const { world, town, millers } = makeWorld();
        const player = makePlayer(world);
        player.skills.diplomacy = 12;
        const f = BloodFeuds.onKinMemory(world, player, town.folk, millers[0], 'murdered');
        Townsfolk.slay(town.folk, millers[0], world.day, 'murder', world);
        const bearer = BloodFeuds.bearer(world, player, f.sides[0]).person;
        Townsfolk.purse(town.folk, bearer, world);
        const before = { gold: player.gold, purse: bearer.purse, town: town.economy.gold };
        let res = null;
        for (let i = 0; i < 20 && !(res && res.accepted); i++) {
            res = BloodFeuds.offerWergild(world, player, f.id);
            if (!res.accepted) world.day += BloodFeuds.config().wergild.cooldown;
        }
        expect(res.accepted).toBe(true);
        const paid = before.gold - player.gold;
        expect(paid).toBe(res.cost);
        expect(paid).toBeGreaterThanOrEqual(BloodFeuds.config().ranks.commoner);
        const toKin = bearer.purse - before.purse;
        const toTown = town.economy.gold - before.town;
        expect(toKin).toBeGreaterThan(0);
        expect(toTown).toBeGreaterThan(0);
        expect(Math.round((toKin + toTown) * 100) / 100).toBe(paid);
        expect(BloodFeuds.get(world, f.id)).toBeNull();
        expect(BloodFeuds.state(world).past[0].ended.how).toBe('wergild');
        expect(BloodFeuds.refusesTrade(world, player, { name: 'x', _person: millers[1], _folk: town.folk }).refuses).toBe(false);
    });

    it('the crown\'s tariff is dearer and its fee goes to the treasury', () => {
        const a = makeWorld(400, 'customary');
        const b = makeWorld(400, 'crown');
        const fa = BloodFeuds.onKinMemory(a.world, makePlayer(a.world), a.town.folk, a.millers[0], 'murdered');
        const fb = BloodFeuds.onKinMemory(b.world, makePlayer(b.world), b.town.folk, b.millers[0], 'murdered');
        expect(BloodFeuds.price(b.world, fb).price).toBeGreaterThan(BloodFeuds.price(a.world, fa).price);
        const pb = makePlayer(b.world);
        pb.skills.diplomacy = 12;
        const t0 = b.realm.treasury;
        let res = null;
        for (let i = 0; i < 20 && !(res && res.accepted); i++) {
            res = BloodFeuds.offerWergild(b.world, pb, fb.id);
            if (!res.accepted) b.world.day += 60;
        }
        expect(res.accepted).toBe(true);
        expect(b.realm.treasury).toBeGreaterThan(t0);
    });

    it('judging a feud in your own town: the killers pay the bereaved, a tithe to you', () => {
        const { world, town, millers, tanners } = makeWorld();
        const player = makePlayer(world);
        player.throne = { ruling: { kingdomId: 'k1' } };
        Brawls.recordDeath(world, town, tanners[0].id, 'a Miller', world.day, millers[0].id);
        const f = BloodFeuds.find(world, 'folk:5,7:Tanner', 'folk:5,7:Miller');
        for (const p of millers) { Townsfolk.purse(town.folk, p, world); p.purse = 200; }
        const j = BloodFeuds.judgeable(world, player, town);
        expect(j.map(x => x.feud.id)).toContain(f.id);
        const gold = player.gold;
        const res = BloodFeuds.arbitrate(world, player, f.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBeGreaterThan(gold);
        expect(millers.reduce((s, p) => s + p.purse, 0)).toBeLessThan(600);
        expect(BloodFeuds.get(world, f.id)).toBeNull();
    });
});

describe('a marriage ends it', () => {
    it('two feuding families of townsfolk wed one of each, and the feud ends at the altar', () => {
        DataLoader._gamedata.bloodFeuds.npc.settleBase = 50;
        DataLoader._gamedata.bloodFeuds.npc.marryShare = 1;
        const { world, town, millers, tanners } = makeWorld();
        Brawls.recordDeath(world, town, tanners[0].id, 'a Miller', world.day, millers[0].id);
        const f = BloodFeuds.find(world, 'folk:5,7:Tanner', 'folk:5,7:Miller');
        f.heat = 30;
        expect(BloodFeuds._npcSettle(world, null, f)).toBe(true);
        expect(BloodFeuds.get(world, f.id)).toBeNull();
        const past = BloodFeuds.state(world).past[0];
        expect(past.ended.how).toBe('married');
        const wed = [...millers, ...tanners].filter(p => p.spouse != null);
        expect(wed).toHaveLength(2);
        expect(wed[0].spouse).toBe(wed[1].id);
    });
});

describe('the world\'s own feuds', () => {
    it('an avenger strikes back (the debt passes over), and killings stay capped over the years', () => {
        const { world, town, millers, tanners } = makeWorld();
        Brawls.recordDeath(world, town, tanners[0].id, 'a Miller', world.day, millers[0].id);
        const f = BloodFeuds.find(world, 'folk:5,7:Tanner', 'folk:5,7:Miller');
        const owes = f.owes;
        f.heat = 100;
        // (settling held off: the feud must run)
        DataLoader._gamedata.bloodFeuds.npc.settleBase = 0;
        DataLoader._gamedata.bloodFeuds.npc.killPerHeat = 1;
        const dead0 = town.folk.people.filter(p => p.died != null).length;
        const Y = 120;
        for (let d = 0; d < 4 * Y; d++) {
            world.day++;
            if (BloodFeuds.get(world, f.id)) f.heat = 100;
            BloodFeuds.processDay(world, null);
        }
        const kills = town.folk.people.filter(p => p.died != null && /blood feud/.test(String(p.cause))).length;
        expect(kills).toBeGreaterThan(0);
        // one killing per feud a year at most, one in the world every worldKillGap days
        const N = BloodFeuds.config().npc;
        expect(kills).toBeLessThanOrEqual(Math.ceil((4 * Y) / Math.max(N.feudKillGap, N.worldKillGap)) + 1);
        expect(town.folk.people.filter(p => p.died != null).length - dead0).toBeGreaterThanOrEqual(kills);
        const live = BloodFeuds.get(world, f.id) || BloodFeuds.state(world).past.find(p => p.id === f.id);
        expect(live).toBeTruthy();
        if (BloodFeuds.get(world, f.id) && kills % 2 === 1) expect(f.owes).not.toBe(owes);
        // the town's mood keeps the blood
        expect((town.memory && town.memory.marks || []).some(m => m.k === 'feud')).toBe(true);
    });

    it('saves and restores', () => {
        const { world, town, millers, tanners } = makeWorld();
        Brawls.recordDeath(world, town, tanners[0].id, 'a Miller', world.day, millers[0].id);
        const saved = JSON.parse(JSON.stringify(BloodFeuds.serialize(world)));
        const w2 = { ...world, bloodFeuds: null };
        BloodFeuds.restore(saved, w2);
        expect(BloodFeuds.open(w2)).toHaveLength(1);
        BloodFeuds.restore(null, w2);
        expect(BloodFeuds.open(w2)).toHaveLength(0);
    });
});
