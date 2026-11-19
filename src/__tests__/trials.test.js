/**
 * Law courts (player/trials.js): an arrest held for trial on the town's case
 * (watchQuestioning's charges and witnesses), the judge, advocates, bribes,
 * witnesses swayed, the verdict and its sentence with real payees; the player
 * as judge of the townsfolk (kin memory, a wrong verdict surfacing); lawsuits
 * between Houses (damages purse to purse, rivals going to law).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gossip } from '../systems/gossip.js';
import { Wanted } from '../systems/wanted.js';
import { Trials } from '../player/trials.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Fame } from '../systems/fame.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { WatchQuestioning } from '../systems/watchQuestioning.js';
import { NPCLords } from '../world/npcLords.js';
import { Brands } from '../world/brands.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => { vi.restoreAllMocks(); });

const Y = 120;

function person(id, first, last, role = 'villager', extra = {}) {
    return { id, first, last, gender: 'male', born: 100 - 40 * Y, role, traits: [], parents: [], kids: [], spouse: null, log: [], ...extra };
}

function makeWorld() {
    const ashFolk = {
        q: 4, r: 4, annals: [], people: [
            person(1, 'Ella', 'Cobb', 'villager', { gender: 'female' }),
            person(2, 'Tom', 'Reed', 'farmer'),
            person(3, 'Hugh', 'Marlow', 'noble'),
            person(4, 'Piers', 'Quill', 'priest'),
            person(5, 'Wat', 'Tyler', 'merchant'),
        ],
    };
    const capFolk = {
        q: 9, r: 9, annals: [], people: [
            person(10, 'Gil', 'Barrow', 'villager', { kids: [12], spouse: 11 }),
            person(11, 'Ann', 'Barrow', 'villager', { gender: 'female', kids: [12], spouse: 10 }),
            person(12, 'Kit', 'Barrow', 'villager', { born: 100 - 18 * Y, parents: [10, 11] }),
            person(13, 'Joan', 'Ash', 'merchant', { gender: 'female' }),
            person(14, 'Lord', 'Varn', 'noble'),
        ],
    };
    const ashford = { name: 'Ashford', type: 'town', q: 4, r: 4, population: 1200, kingdom: 'k1', economy: { gold: 500 }, folk: ashFolk, happiness: 60 };
    const capital = { name: 'Valden', type: 'capital', q: 9, r: 9, population: 6000, kingdom: 'k1', economy: { gold: 2000 }, folk: capFolk, happiness: 60 };
    const k1 = { id: 'k1', name: 'Valdor', ruler: 'Aldric', isAlive: true, capital: { q: 9, r: 9 }, treasury: 1000, territory: [], laws: { punishment: 'standard' }, lord: { name: 'Aldric', kingdomId: 'k1', traits: [{ id: 'cruel' }], memory: [] } };
    const k2 = { id: 'k2', name: 'Morne', ruler: 'Odo', isAlive: true, capital: { q: 9, r: 9 }, treasury: 500, territory: [], laws: {}, lord: { name: 'Odo', kingdomId: 'k2', traits: [], memory: [] } };
    const towns = { '4,4': ashford, '9,9': capital };
    return {
        day: 100, generationParams: { seed: 7 }, units: [], kingdoms: [k1, k2], width: 40,
        ashford, capital, k1, k2,
        getTile: (q, r) => (towns[`${q},${r}`] ? { q, r, settlement: towns[`${q},${r}`] } : { q, r }),
        getKingdom: id => [k1, k2].find(k => k.id === id) || null,
        getSettlementViews: () => [ashford, capital],
    };
}

function makePlayer(extra = {}) {
    return { name: 'Ash', q: 4, r: 4, gold: 500, karma: 0, renown: 10, reputation: {}, charisma: 5, strength: 5, skills: {}, inventory: {}, ...extra };
}

/** A witnessed theft rumour in Ashford: Ella and Tom saw it. */
function theft(player, fields = {}) {
    Gossip.initializePlayer(player);
    const rm = {
        id: player.gossip.nextRumorId++, type: 'theft', perpetrator: player.name, victim: { name: 'Wat Tyler', type: 'merchant' },
        locationQ: 4, locationR: 4, locationName: 'Ashford', kingdom: 'k1', dayCreated: 92, credibility: 0.75, severity: 20,
        witnessCount: 2, witnessNames: ['Ella Cobb', 'Tom Reed'], spreadTo: ['4,4'], consequencesApplied: {}, expired: false, ...fields,
    };
    player.gossip.rumors.push(rm);
    return rm;
}

function jail(player, extra = {}) {
    player.jailState = { daysRemaining: 3, totalDays: 3, offense: 'theft', offenseNumber: 1, settlement: 'Ashford', q: 4, r: 4, bailCost: 30, ...extra };
}

const coin = (w, p) => Utils.cents(p.gold + w.ashford.economy.gold + w.capital.economy.gold + w.k1.treasury
    + w.ashford.folk.people.reduce((s, x) => s + (x.purse || 0), 0) + w.capital.folk.people.reduce((s, x) => s + (x.purse || 0), 0));

describe('held for trial', () => {
    it('an arrest becomes a remand: the town\'s charges, its witnesses, a judge, the jail held to the day', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        const out = Trials.processDay(w, p);
        const t = p.trials.trial;
        expect(t).toBeTruthy();
        expect(out.notices.some(n => n.title === 'Held for Trial')).toBe(true);
        expect(p.jailState.trialId).toBe(t.id);
        expect(t.day).toBeGreaterThan(w.day);
        expect(p.jailState.daysRemaining).toBeGreaterThan(t.day - w.day);
        expect(t.charges[0].group).toBe('theft');
        expect(t.charges[0].proof).toBe(2);
        const ella = t.witnesses.find(x => x.name === 'Ella Cobb');
        expect(ella && ella.pid).toBe(1);
        // A magistrate of the town (not the capital): a townsperson of standing
        expect(t.judge.lord).toBe(false);
        expect(t.judge.pid).toBe(3);
        expect(Object.keys(Trials._c('customs'))).toContain(t.custom);
    });

    it('with no charge on record the arresting watchman\'s word stands; the bought magistrate\'s one night needs no court', () => {
        const w = makeWorld(), p = makePlayer();
        jail(p, { offense: 'breaking the curfew' });
        Trials.processDay(w, p);
        expect(p.trials.trial.charges[0].label).toBe('breaking the curfew');
        const p2 = makePlayer();
        jail(p2, { daysRemaining: 1, totalDays: 1 });
        Trials.processDay(w, p2);
        expect(p2.trials.trial).toBe(null);
        expect(p2.jailState.tried).toBe(true);
    });

    it('in the lord\'s capital the lord judges, his traits his persona', () => {
        const w = makeWorld();
        const j = Trials.judgeFor(w, w.capital, 9, 9);
        expect(j.lord).toBe(true);
        expect(j.name).toBe('Aldric');
        expect(j.persona).toBe('hanging');
    });
});

describe('the odds', () => {
    it('an advocate, a bribe taken, reputation and swayed witnesses each ease them; a harsh law and absence worsen them', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        const t = p.trials.trial;
        const base = Trials.odds(p, w, t).p;
        t.advocate = { name: 'Hugh', skill: 7 };
        const adv = Trials.odds(p, w, t).p;
        expect(adv).toBeLessThan(base);
        t.bribe = 200;
        t.judge.persona = 'venal';
        expect(Trials.odds(p, w, t).p).toBeLessThan(adv);
        t.bribe = 0; t.advocate = null; t.judge.persona = 'just';
        const just = Trials.odds(p, w, t).p;
        for (const x of t.witnesses) x.state = 'swayed';
        expect(Trials.odds(p, w, t).p).toBeLessThan(just);
        for (const x of t.witnesses) x.state = 'stands';
        p.reputation.k1 = 80;
        expect(Trials.odds(p, w, t).p).toBeLessThan(just);
        p.reputation.k1 = 0;
        t.law = 'harsh';
        expect(Trials.odds(p, w, t).p).toBeGreaterThan(just);
        t.law = 'standard';
        expect(Trials.odds(p, w, t, { absent: true }).p).toBeGreaterThan(just);
    });
});

describe('before the day', () => {
    it('an advocate\'s fee goes into the advocate\'s own purse; no coin is made or lost', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        const t = p.trials.trial;
        const advs = Trials.advocates(w, t);
        expect(advs.length).toBeGreaterThan(0);
        expect(advs.every(a => a.pid !== t.judge.pid)).toBe(true);
        const before = coin(w, p);
        const a = advs[0];
        const res = Trials.hireAdvocate(p, w, t, a.id);
        expect(res.success).toBe(true);
        expect(t.advocate.skill).toBe(a.skill);
        const who = w.ashford.folk.people.find(x => x.id === a.pid);
        expect(who.purse).toBeGreaterThanOrEqual(a.fee);
        expect(coin(w, p)).toBeCloseTo(before, 2);
    });

    it('a bribe taken lands in the magistrate\'s purse; refused, it is a new charge', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        const t = p.trials.trial;
        const before = coin(w, p);
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        expect(Trials.bribe(p, w, t, 0).success).toBe(true);
        expect(t.bribe).toBeGreaterThan(0);
        expect(w.ashford.folk.people.find(x => x.id === t.judge.pid).purse).toBeGreaterThanOrEqual(t.bribe);
        expect(coin(w, p)).toBeCloseTo(before, 2);
        w.day++;
        vi.spyOn(Utils, 'random').mockReturnValue(0.999);
        const n = t.charges.length;
        const res = Trials.bribe(p, w, t, 0);
        expect(res.refused).toBe(true);
        expect(t.charges.length).toBe(n + 1);
        expect(t.charges[n].proof).toBe(3);
    });

    it('a threatened witness is cowed, remembers it, and the threat is a crime', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        const t = p.trials.trial;
        const i = t.witnesses.findIndex(x => x.name === 'Ella Cobb');
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const res = Trials.sway(p, w, i, 'threaten');
        expect(res.success).toBe(true);
        expect(t.witnesses[i].state).toBe('cowed');
        const ella = w.ashford.folk.people.find(x => x.id === 1);
        expect((ella.nm || []).some(e => e.k === 'threatened')).toBe(true);
        expect(t.charges.some(c => c.label === 'threatening a witness')).toBe(true);
        expect(Trials.sway(p, w, i, 'persuade').success).toBe(false);
    });
});

describe('the verdict', () => {
    it('a guilty plea on a lesser charge: a fine paid into the town\'s court purse, and out of the cell', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        Trials.plead(p, w, 'guilty');
        const before = coin(w, p);
        const town0 = w.ashford.economy.gold;
        const res = Trials.resolveTrial(p, w);
        expect(res.convicted).toBe(true);
        expect(res.outcome).toBe('fined');
        expect(res.fine).toBeGreaterThan(0);
        expect(p.jailState).toBe(null);
        expect(w.ashford.economy.gold).toBeCloseTo(town0 + res.fine, 2);
        expect(coin(w, p)).toBeCloseTo(before, 2);
        expect(p.trials.trial).toBe(null);
        // The charges are answered: no second trial on them
        const p2tried = p.trials.tried.length;
        expect(p2tried).toBeGreaterThan(0);
    });

    it('a grave charge proven: the cells, the days held counted', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p, { type: 'murder', victim: { name: 'Ned' }, severity: 60 });
        jail(p, { offense: 'murder' });
        Trials.processDay(w, p);
        const t = p.trials.trial;
        t.plea = 'guilty';
        t.judge.persona = 'merciful';
        w.day = t.day;
        vi.spyOn(Utils, 'seededRandom').mockReturnValue(() => 0.99);
        const res = Trials.resolveTrial(p, w);
        expect(res.convicted).toBe(true);
        expect(res.outcome).toBe('jailed');
        expect(p.jailState.tried).toBe(true);
        expect(p.jailState.totalDays).toBe(res.days);
        expect(p.jailState.daysRemaining).toBe(Math.max(1, res.days - (t.day - t.opened)));
        expect(p.jailState.bailCost).toBe(0);
    });

    it('out on bail and away on the day: tried in absence, the sentence on the crown\'s sheet', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        p.jailState = null;
        p.q = 20; p.r = 20;
        p.trials.trial.plea = 'guilty';
        Trials.resolveTrial(p, w);
        expect(Wanted.bounty(p, 'k1')).toBeGreaterThan(0);
    });

    it('acquitted: released, and the realm thinks a little better of you', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p, { witnessCount: 0, witnessNames: [], credibility: 0.45 });
        jail(p);
        Trials.processDay(w, p);
        const t = p.trials.trial;
        t.advocate = { name: 'Hugh', skill: 9 };
        p.reputation.k1 = 100;
        vi.spyOn(Utils, 'seededRandom').mockReturnValue(() => 0.999);
        const res = Trials.resolveTrial(p, w);
        expect(res.outcome).toBe('acquitted');
        expect(p.jailState).toBe(null);
        expect(p.reputation.k1).toBeGreaterThan(100);
    });

    it('the trial is heard on its day from the day loop', () => {
        const w = makeWorld(), p = makePlayer();
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        w.day = p.trials.trial.day;
        const out = Trials.processDay(w, p);
        expect(p.trials.trial).toBe(null);
        expect(out.notices.some(n => n.title === 'Guilty' || n.title === 'Not Guilty')).toBe(true);
        expect(p.trials.last).toBeTruthy();
    });
});

describe('giving yourself up', () => {
    it('in a town that holds a case against you: arrested, and the court notes it', () => {
        const w = makeWorld(), p = makePlayer();
        expect(Trials.surrenderCheck(p, w).ok).toBe(false);
        theft(p);
        const res = Trials.surrender(p, w);
        expect(res.success).toBe(true);
        expect(p.jailState).toBeTruthy();
        expect(p.trials.trial.surrendered).toBe(true);
        const t = p.trials.trial;
        const withGoodwill = Trials.odds(p, w, t).p;
        t.surrendered = false;
        expect(Trials.odds(p, w, t).p).toBeGreaterThan(withGoodwill);
    });
});

describe('the player as judge', () => {
    function ruler() {
        const w = makeWorld();
        const p = makePlayer({ q: 9, r: 9, throne: { ruling: { kingdomId: 'k1' } }, house: { name: 'House Ash', prestige: 50, generation: 1, rivals: {}, history: [] } });
        return { w, p };
    }

    it('a crime on the town\'s record comes before the ruler\'s court', () => {
        const { w, p } = ruler();
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: ['Joan Ash'], caught: false }];
        const seat = Trials.seats(p, w).find(s => s.key === '9,9');
        expect(seat).toBeTruthy();
        const c = Trials._makeCase(p, w, seat, () => 0.1);
        expect(c.accused.pid).toBe(12);
        expect(c.proof).toBe(2);
        expect(c.victim.pid).toBe(13);
        expect(c.guilty).toBe(true);
        expect(Trials._makeCase(p, w, seat, () => 0.99)).toBe(null); // (heard once; no complaint brought)
    });

    it('a fine comes out of the accused\'s purse into yours; their kin remember the sentence', () => {
        const { w, p } = ruler();
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: ['Joan Ash'], caught: true }];
        const seat = Trials.seats(p, w)[0];
        const c = Trials._makeCase(p, w, seat, () => 0.1);
        const kit = w.capital.folk.people.find(x => x.id === 12);
        kit.purse = 50;
        const gold0 = p.gold;
        const res = Trials.rule(p, w, c.id, 'fine');
        expect(res.success).toBe(true);
        expect(p.gold - gold0).toBeCloseTo(50 - kit.purse, 2);
        expect(p.gold).toBeGreaterThan(gold0);
        const gil = w.capital.folk.people.find(x => x.id === 10);
        expect((gil.nm || []).some(e => e.k === 'condemned' && e.vn === 'Kit Barrow')).toBe(true);
        const joan = w.capital.folk.people.find(x => x.id === 13);
        expect((joan.nm || []).some(e => e.k === 'justice_done')).toBe(true);
        expect(p.trials.cases).toHaveLength(0);
    });

    it('a hanging: the condemned dies, the kin hold the blood, the square remembers; harshness costs happiness', () => {
        const { w, p } = ruler();
        w.capital.npcCrimes = [{ id: 1, k: 'pickpocket', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: [], caught: false }];
        const seat = Trials.seats(p, w)[0];
        const c = Trials._makeCase(p, w, seat, () => 0.1);
        const h0 = w.capital.happiness;
        Trials.rule(p, w, c.id, 'hang');
        const kit = w.capital.folk.people.find(x => x.id === 12);
        expect(kit.died).not.toBe(undefined);
        const ann = w.capital.folk.people.find(x => x.id === 11);
        expect((ann.nm || []).some(e => e.k === 'hanged')).toBe(true);
        expect((w.capital.folk.nm || []).some(e => e.k === 'hanged')).toBe(true);
        expect(w.capital.happiness).toBeLessThan(h0);
    });

    it('an innocent condemned: the truth surfaces later, the family remember the wrong, and amends can be made', () => {
        const { w, p } = ruler();
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: [], caught: false }];
        const seat = Trials.seats(p, w)[0];
        const c = Trials._makeCase(p, w, seat, () => 0.1);
        c.guilty = false;
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        Trials.rule(p, w, c.id, 'jail');
        vi.restoreAllMocks();
        const j = p.trials.judged[0];
        expect(j.kind).toBe('wrongful');
        w.day = j.surface;
        const prestige0 = p.house.prestige;
        const out = Trials.processDay(w, p);
        expect(out.notices.some(n => n.title === 'A Wrongful Verdict')).toBe(true);
        expect(p.house.prestige).toBeLessThan(prestige0);
        const gil = w.capital.folk.people.find(x => x.id === 10);
        expect((gil.nm || []).some(e => e.k === 'wrongly_condemned')).toBe(true);
        const gold0 = p.gold;
        const res = Trials.amends(p, w, j.id);
        expect(res.success).toBe(true);
        expect(p.gold).toBeLessThan(gold0);
        expect(Trials.amends(p, w, j.id).success).toBe(false);
    });

    it('verdicts weigh against the crime: the proportionate earns justice, the harsh happiness lost', () => {
        const c = { proof: 2, severity: 1 };
        expect(Trials.verdictEffects(c, 'fine').court.justice).toBeGreaterThan(0);
        expect(Trials.verdictEffects(c, 'hang').happiness).toBeLessThan(0);
        expect(Trials.verdictEffects({ proof: 3, severity: 2 }, 'acquit').happiness).toBeLessThan(0);
    });
});

describe('lawsuits between Houses', () => {
    function houses() {
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, standing: {}, memory: [], log: [], loans: [{ amount: 100, owed: 120, due: 50, lent: 0, defaulted: 60 }], head: { firstName: 'Odo', age: 50, traits: [], persona: { honour: 7 } } };
        const p = makePlayer({ allegiance: 'k1', house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        return { w, p, rival };
    }

    it('a refused debt is grounds; won, the debt comes out of their purse into yours', () => {
        const { w, p, rival } = houses();
        const g = Trials.grounds(p, w, rival);
        expect(g.player.find(x => x.kind === 'debt').amount).toBe(120);
        const town0 = w.capital.economy.gold;
        const res = Trials.fileSuit(p, w, 'k2', 'debt');
        expect(res.success).toBe(true);
        expect(w.capital.economy.gold).toBeGreaterThan(town0); // (the fee, and their advocate's)
        const suit = res.suit;
        expect(suit.rivalAdvocate).toBeGreaterThan(0);
        suit.merit = 1; suit.advocate = { name: 'X', skill: 9 };
        const gold0 = p.gold, rgold0 = rival.gold, pr0 = p.house.prestige;
        const r = Trials.resolveSuit(p, w, suit, () => 0);
        expect(r.won).toBe(true);
        expect(p.gold - gold0).toBeCloseTo(120, 2);
        expect(rgold0 - rival.gold).toBeCloseTo(120, 2);
        expect(rival.loans[0].repaid).toBe(w.day);
        expect(p.house.prestige).toBeGreaterThan(pr0);
        expect(rival.memory.some(m => m.kind === 'lawsuitLost')).toBe(true);
    });

    it('an honourable rival you insulted goes to law as an errand; lost, you pay the damages into their purse', () => {
        const { w, p, rival } = houses();
        rival.memory.push({ kind: 'insult', day: 95, w: -10 });
        const out = { notices: [] };
        // Suing is one of the House's errands, scored beside the rest
        const got = RivalHouses._scores(p, w, rival, { q: 9, r: 9 });
        expect(got.scores.law).toBeGreaterThan(0);
        expect(got.law.ground.kind).toBe('slander');
        // A House of little honour does not go to law
        rival.head.persona.honour = 2;
        expect(RivalHouses._scores(p, w, rival, { q: 9, r: 9 }).scores.law).toBe(0);
        rival.head.persona.honour = 7;
        // It rides to the court, pays the fee into that town's purse and files
        const town0 = w.capital.economy.gold, rg0 = rival.gold;
        const plan = { kind: 'law', ground: 'slander', kingdomId: got.law.venue.id, to: { q: 9, r: 9, name: got.law.venue.name } };
        expect(RivalHouses._fileSuit(p, w, rival, plan)).toBe(true);
        expect(rival.suing.kind).toBe('slander');
        expect(rg0 - rival.gold).toBeCloseTo(25, 2);
        expect(w.capital.economy.gold - town0).toBeCloseTo(25, 2);
        // ...and no second errand to law while the first is filed
        expect(RivalHouses._scores(p, w, rival, { q: 9, r: 9 }).scores.law).toBe(0);
        // The courts' day enters the suit and summons you
        Trials._rivalSues(p, w, () => 0, out);
        expect(rival.suing).toBeUndefined();
        const filed = Trials.openSuits(p)[0];
        expect(filed).toBeTruthy();
        expect(filed.plaintiff).toBe('k2');
        expect(filed.kind).toBe('slander');
        expect(out.notices.some(n => n.title === 'A Summons')).toBe(true);
        const gold0 = p.gold, rgold0 = rival.gold;
        const r = Trials.resolveSuit(p, w, filed, () => 0);
        expect(r.won).toBe(false);
        expect(gold0 - p.gold).toBeCloseTo(filed.amount, 2);
        expect(rival.gold - rgold0).toBeCloseTo(filed.amount, 2);
    });

    it('a suit against you can be settled for part of the claim', () => {
        const { w, p, rival } = houses();
        rival.memory.push({ kind: 'insult', day: 98, w: -10 });
        const venue = Trials._venue(w, ['k1']);
        const suit = Trials._newSuit(p, w, rival, Trials.grounds(p, w, rival).rival[0], 'k2', venue, () => 0);
        const rgold0 = rival.gold;
        const res = Trials.settleSuit(p, w, suit.id);
        expect(res.success).toBe(true);
        expect(suit.status).toBe('settled');
        expect(rival.gold).toBeGreaterThan(rgold0);
    });
});

describe('a betrothal the rival broke', () => {
    it('is grounds to sue them, once, and only for a year', () => {
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 70, renown: 5, standing: {}, memory: [], log: [], loans: [], head: { firstName: 'Odo', age: 50, traits: [], children: [], persona: { honour: 7 } } };
        const child = { id: 'c1', firstName: 'Edda', gender: 'female', age: 10, isAlive: true, upbringing: { agency: { betrothal: { kingdomId: 'k2', kingdomName: 'Morne', name: 'Osric of Morne', day: 10, dowry: 100, due: 200 } } } };
        const p = makePlayer({ allegiance: 'k1', children: [child], house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        const res = HeirAgency.breakBetrothal(p, w, 'c1', 'the feud', { byThem: true, rival });
        expect(res.success).toBe(true);
        expect(rival.brokeBetrothal).toMatchObject({ child: 'Edda', day: w.day });
        const g = Trials.grounds(p, w, rival).player.find(x => x.kind === 'betrothal');
        expect(g.amount).toBe(250);
        expect(Trials.fileSuit(p, w, 'k2', 'betrothal').success).toBe(true);
        expect(rival.brokeBetrothal.sued).toBe(w.day);
        expect(Trials.grounds(p, w, rival).player.some(x => x.kind === 'betrothal')).toBe(false);
        // A year on, unsued, it is too late
        rival.brokeBetrothal = { day: w.day - 400, child: 'Edda' };
        expect(Trials.grounds(p, w, rival).player.some(x => x.kind === 'betrothal')).toBe(false);
    });

    it('a rival House whose feud runs hot breaks the match itself (a hash roll each month)', () => {
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 90, head: { firstName: 'Odo', children: [] } };
        const child = { id: 'c2', firstName: 'Bran', gender: 'male', age: 10, isAlive: true, upbringing: { agency: { betrothal: { kingdomId: 'k2', kingdomName: 'Morne', name: 'Ida of Morne', day: 10, dowry: 100, due: 200 } } } };
        const p = makePlayer({ allegiance: 'k1', children: [child], house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        let broke = null;
        for (let d = 0; d < 30 * 40 && !broke; d++) {
            w.day++;
            const out = HeirAgency.processDay(p, w);
            broke = out.notices.find(n => n.title === 'A Betrothal Broken') || null;
        }
        expect(broke).toBeTruthy();
        expect(rival.brokeBetrothal.child).toBe('Bran');
        expect(child.upbringing.agency.betrothal).toBe(null);
    });
});

describe('the brand stays', () => {
    function branded(extra = {}) {
        const w = makeWorld();
        const p = makePlayer({ allegiance: 'k1', reputation: { k1: 10 }, house: { name: 'House Ash', prestige: 50, generation: 1, rivals: {}, history: [] }, ...extra });
        Trials.state(p).brands.push({ kingdomId: 'k1', realm: 'Valdor', day: w.day, crime: 'murder', gen: 1 });
        return { w, p };
    }

    it('first impressions, a lord\'s opinion and a rival head\'s parley are worse; worst in the realm that burned it', () => {
        const { w, p } = branded();
        const clean = makePlayer({ allegiance: 'k1', reputation: { k1: 10 }, house: { name: 'House Ash', prestige: 50, generation: 1, rivals: {}, history: [] } });
        expect(Fame.dispositionSeed(p, 'k1', w).delta - Fame.dispositionSeed(clean, 'k1', w).delta).toBe(-15);
        expect(Fame.dispositionSeed(p, 'k1', w).reasons.some(r => /brand/i.test(r.label))).toBe(true);
        // Abroad it is seen, but tells less
        expect(Fame.dispositionSeed(p, 'k2', w).delta - Fame.dispositionSeed(clean, 'k2', w).delta).toBe(-7);
        expect(NPCLords.getLordOpinion(w.k1.lord, p, w) - NPCLords.getLordOpinion(w.k1.lord, clean, w)).toBe(-20);
        expect(Brands.parley(p, 'k1', w)).toBeCloseTo(-0.1, 5);
        // Years on it is an old scar
        w.day += 1300;
        expect(Brands.dispositionDelta(p, 'k1', w)).toBe(-9);
    });

    it('the watch of that realm is more suspicious; respectable folk refuse there and charge more abroad', () => {
        const { w, p } = branded();
        const kase = WatchQuestioning.caseAt(p, w, w.ashford);
        expect(kase.brand).toBe(15);
        expect(kase.suspicion).toBeGreaterThanOrEqual(15);
        expect(WatchQuestioning.refresh(p, w, kase).suspicion).toBe(kase.suspicion);
        const priest = { name: 'Father Piers', type: 'priest', personalityTraits: [] };
        expect(NpcDisposition.getPriceModifiers(priest, { player: p, world: w, kingdomId: 'k1' }).refuses).toBe(true);
        const abroad = NpcDisposition.getPriceModifiers({ name: 'Wat', type: 'merchant', personalityTraits: [] }, { player: p, world: w, kingdomId: 'k2' });
        expect(abroad.refuses).toBe(false);
        expect(abroad.reasons.find(r => r.label === 'Your brand').pct).toBe(6);
        // A farmer cares nothing for it
        expect(Brands.priceShift(p, 'k1', 'farmer', w)).toBe(0);
    });

    it('an heir is not branded: the brand died with its bearer', () => {
        const { p } = branded();
        expect(Brands.active(p).length).toBe(1);
        p.house.generation = 2;
        expect(Brands.active(p).length).toBe(0);
        expect(Trials.view(p, makeWorld()).brands.length).toBe(0);
    });

    it('a royal pardon is bought into the crown\'s chests; no coin made or lost', () => {
        const { w, p } = branded();
        const before = coin(w, p);
        const t0 = w.k1.treasury;
        const opt = Trials.pardonOptions(p, w, 0).find(o => o.id === 'royal');
        expect(opt.ok).toBe(true);
        const res = Trials.seekPardon(p, w, 0, 'royal');
        expect(res.success).toBe(true);
        expect(w.k1.treasury - t0).toBeCloseTo(opt.cost, 2);
        expect(coin(w, p)).toBeCloseTo(before, 2);
        expect(Brands.active(p).length).toBe(0);
        expect(p.trials.brands[0].pardoned.how).toBe('royal');
        expect(Fame.dispositionSeed(p, 'k1', w).reasons.some(r => /brand/i.test(r.label))).toBe(false);
    });

    it('a House of standing is pardoned for its Prestige', () => {
        const { w, p } = branded();
        const res = Trials.seekPardon(p, w, 0, 'prestige');
        expect(res.success).toBe(true);
        expect(p.house.prestige).toBe(10);
        expect(Trials.seekPardon(p, w, 0, 'royal').success).toBe(false);
    });

    it('a petition of the folk is answered by the crown on its day (a seeded roll); refused, ask again later', () => {
        const { w, p } = branded({ reputation: { k1: 25 } });
        const P = DataLoader._gamedata.trials.brands.pardon.petition;
        const base0 = P.base, max0 = P.max;
        try {
            const town0 = w.ashford.economy.gold;
            const res = Trials.seekPardon(p, w, 0, 'petition');
            expect(res.success).toBe(true);
            expect(w.ashford.economy.gold - town0).toBeCloseTo(10, 2);
            expect(Trials.pardonOptions(p, w, 0).every(o => !o.ok)).toBe(true);
            P.base = -5; P.max = 0;
            w.day = p.trials.brands[0].petition.until;
            let out = Trials.processDay(w, p);
            expect(out.notices.some(n => n.title === 'Petition Refused')).toBe(true);
            expect(p.trials.brands[0].petitionRetry).toBe(w.day + 120);
            w.day += 120;
            P.base = 5; P.max = 1;
            Trials.seekPardon(p, w, 0, 'petition');
            w.day = p.trials.brands[0].petition.until;
            out = Trials.processDay(w, p);
            expect(out.notices.some(n => n.title === 'Pardoned')).toBe(true);
            expect(Brands.active(p).length).toBe(0);
        } finally {
            P.base = base0; P.max = max0;
        }
    });

    it('a penance is alms and months of a clean life; a new conviction undoes it', () => {
        const { w, p } = branded();
        expect(Trials.seekPardon(p, w, 0, 'penance').success).toBe(true);
        p.trials.last = { day: w.day + 1, outcome: 'fined' };
        w.day += 1;
        expect(Trials.processDay(w, p).notices.some(n => n.title === 'Penance Undone')).toBe(true);
        expect(Trials.seekPardon(p, w, 0, 'penance').success).toBe(true);
        w.day = p.trials.brands[0].penance.until;
        expect(Trials.processDay(w, p).notices.some(n => n.title === 'Penance Done')).toBe(true);
        expect(p.trials.brands[0].pardoned.how).toBe('penance');
        // Away from the realm there is no penance to do
        const b = branded();
        b.p.q = 0; b.p.r = 0;
        expect(Trials.pardonOptions(b.p, b.w, 0).find(o => o.id === 'penance').ok).toBe(false);
    });
});

describe('the panel', () => {
    it('renders every tab without throwing, and its rows act', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, standing: {}, memory: [], log: [], loans: [{ amount: 100, owed: 120, due: 50, lent: 0, defaulted: 60 }], head: { firstName: 'Odo', age: 50, traits: [], persona: { honour: 7 } } };
        const p = makePlayer({ allegiance: 'k1', throne: { ruling: { kingdomId: 'k1' } }, house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        theft(p);
        jail(p);
        Trials.processDay(w, p);
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: [], caught: false }];
        Trials._makeCase(p, w, Trials.seats(p, w)[0], () => 0.1);
        Trials.fileSuit(p, w, 'k2', 'debt');
        const panels = [];
        const game = { player: p, world: w, ui: { showCustomPanel: (t, h) => panels.push(h), showNotification() {}, updateStats() {} } };
        for (const tab of ['trial', 'court', 'suits']) ActionMenu.showTrialsPanel(game, null, tab);
        ActionMenu.trialsAct(game, 'plea', 'guilty');
        ActionMenu.trialsAct(game, 'stand');
        p.trials.brands.push({ kingdomId: 'k1', realm: 'Valdor', day: w.day, crime: 'murder', gen: 1 });
        ActionMenu.trialsAct(game, 'tab', 'trial');
        expect(panels[panels.length - 1]).toMatch(/Branded in Valdor/);
        expect(panels[panels.length - 1]).toMatch(/A Royal Pardon/);
        p.reputation.k1 = 20;
        ActionMenu.trialsAct(game, 'pardon', 0, 'prestige');
        expect(p.trials.brands[0].pardoned).toBeTruthy();
        expect(panels.length).toBeGreaterThanOrEqual(6);
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
        expect(p.trials.trial).toBe(null);
    });
});

describe('the day without a player', () => {
    it('runs nothing in the interregnum', () => {
        expect(Trials.processDay(makeWorld(), null).notices).toEqual([]);
    });
});
