/**
 * Trial by combat and by ordeal (player/ordeals.js): the realm's law of trial
 * customs and its faith gate the ways; your trial decided by the hot iron (a
 * real burn, unbound days on), by a hired champion (his fee into his purse),
 * by your own fight, by oath-helpers (perjury coming out later); a case before
 * your court demanded as of right, cleared by the water (the accuser pays the
 * cleared); a kinsman accused; the wager of battle deciding a lawsuit; a
 * champion's fee from the client's own purse.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gossip } from '../systems/gossip.js';
import { Ailments } from '../systems/ailments.js';
import { Trials } from '../player/trials.js';
import { Ordeals } from '../player/ordeals.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => { vi.restoreAllMocks(); });

const Y = 120;

function person(id, first, last, role = 'villager', extra = {}) {
    return { id, first, last, gender: 'male', born: 100 - 35 * Y, role, traits: [], parents: [], kids: [], spouse: null, log: [], ...extra };
}

function makeWorld(law = 'old', faithId = 'solaris') {
    const ashFolk = {
        q: 4, r: 4, annals: [], people: [
            person(1, 'Ella', 'Cobb', 'villager', { gender: 'female' }),
            person(2, 'Tom', 'Reed', 'farmer'),
            person(3, 'Hugh', 'Marlow', 'noble'),
            person(4, 'Piers', 'Quill', 'priest'),
            person(5, 'Wat', 'Tyler', 'merchant'),
            person(6, 'Brand', 'Hale', 'guard'),
            person(7, 'Osric', 'Vane', 'guard'),
        ],
    };
    const capFolk = {
        q: 9, r: 9, annals: [], people: [
            person(10, 'Gil', 'Barrow', 'villager', { kids: [12], spouse: 11 }),
            person(11, 'Ann', 'Barrow', 'villager', { gender: 'female', kids: [12], spouse: 10 }),
            person(12, 'Kit', 'Barrow', 'guard', { born: 100 - 20 * Y, parents: [10, 11] }),
            person(13, 'Joan', 'Ash', 'merchant', { gender: 'female' }),
            person(14, 'Lord', 'Varn', 'noble'),
        ],
    };
    const ashford = { name: 'Ashford', type: 'town', q: 4, r: 4, population: 1200, kingdom: 'k1', economy: { gold: 500 }, folk: ashFolk, happiness: 60 };
    const capital = { name: 'Valden', type: 'capital', q: 9, r: 9, population: 6000, kingdom: 'k1', economy: { gold: 2000 }, folk: capFolk, happiness: 60 };
    const k1 = { id: 'k1', name: 'Valdor', ruler: 'Aldric', isAlive: true, capital: { q: 9, r: 9 }, treasury: 1000, territory: [], laws: { punishment: 'standard', trialCustoms: law, mutilation: 'never' }, religion: { faithId }, lord: { name: 'Aldric', kingdomId: 'k1', traits: [], memory: [] } };
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
    return { name: 'Ash', q: 4, r: 4, gold: 500, health: 100, maxHealth: 100, karma: 0, renown: 10, reputation: {}, charisma: 5, strength: 5, luck: 5, skills: {}, inventory: {}, relationships: {}, ...extra };
}

function theft(player) {
    Gossip.initializePlayer(player);
    player.gossip.rumors.push({
        id: player.gossip.nextRumorId++, type: 'theft', perpetrator: player.name, victim: { name: 'Wat Tyler', type: 'merchant' },
        locationQ: 4, locationR: 4, locationName: 'Ashford', kingdom: 'k1', dayCreated: 92, credibility: 0.75, severity: 20,
        witnessCount: 2, witnessNames: ['Ella Cobb', 'Tom Reed'], spreadTo: ['4,4'], consequencesApplied: {}, expired: false,
    });
}

function onTrial(w, p) {
    theft(p);
    p.jailState = { daysRemaining: 3, totalDays: 3, offense: 'theft', offenseNumber: 1, settlement: 'Ashford', q: 4, r: 4, bailCost: 30 };
    Trials.processDay(w, p);
    return p.trials.trial;
}

const folkCoin = f => f.people.reduce((s, x) => s + (x.purse || 0), 0);
const coin = (w, p) => Utils.cents(p.gold + w.ashford.economy.gold + w.capital.economy.gold + w.k1.treasury + folkCoin(w.ashford.folk) + folkCoin(w.capital.folk));

describe('the law and the faith', () => {
    it('the court alone allows nothing; the old customs everything a faith permits; a forbidding faith blesses no ordeal', () => {
        expect(Ordeals.allowed(makeWorld('court'), 'k1', 'combat').ok).toBe(false);
        const old = makeWorld('old', 'solaris');
        for (const m of ['combat', 'iron', 'water', 'bread', 'compurgation']) expect(Ordeals.allowed(old, 'k1', m).ok).toBe(true);
        const forbids = makeWorld('old', 'earthroot');
        expect(Ordeals.allowed(forbids, 'k1', 'iron').ok).toBe(false);
        expect(Ordeals.allowed(forbids, 'k1', 'combat').ok).toBe(true);
        expect(Ordeals.allowed(makeWorld('combat'), 'k1', 'water').ok).toBe(false);
        expect(Ordeals.belief(old, 'k1')).toBeGreaterThan(Ordeals.belief(forbids, 'k1'));
        // (every realm keeps a custom on it, a hash of the realm)
        expect(['court', 'combat', 'ordeal', 'old']).toContain(Ordeals.lawOption({ ...old, getKingdom: () => ({ id: 'kx', name: 'X' }) }, 'kx'));
    });
});

describe('your trial', () => {
    it('the hot iron: a real burn, the court held till the hand is unbound, then the iron decides', () => {
        const w = makeWorld(), p = makePlayer();
        const t = onTrial(w, p);
        const opt = Ordeals.trialOptions(p, w, t).find(o => o.id === 'iron');
        expect(opt.ok).toBe(true);
        const res = Ordeals.trialOrdeal(p, w, 'iron');
        expect(res.success).toBe(true);
        expect(Ailments.has(p, 'burned_hand')).toBe(true);
        expect(t.day).toBeGreaterThanOrEqual(w.day + 3);
        w.day = t.day;
        const d = Ordeals.decide(p, w, t);
        expect(typeof d.convicted).toBe('boolean');
        const r = Trials.resolveTrial(p, w);
        expect(r.convicted).toBe(d.convicted);
        expect(r.text).toContain('unbinds');
    });

    it('a hired guard fights for you: his fee goes into his purse, and the bout decides the verdict', () => {
        const w = makeWorld(), p = makePlayer();
        const t = onTrial(w, p);
        const champs = Ordeals.champions(p, w, t);
        const hire = champs.find(c => c.id.startsWith('guard:'));
        expect(hire).toBeTruthy();
        const c0 = coin(w, p);
        Utils.setSeed(11);
        const res = Ordeals.trialCombat(p, w, hire.id);
        expect(res.success).toBe(true);
        expect(res.resolveNow).toBe(true);
        expect(coin(w, p)).toBeCloseTo(c0, 2);
        const r = Trials.resolveTrial(p, w);
        expect(r.convicted).toBe(!res.cleared);
    });

    it('fighting yourself: won, the court lets you go and the accusers who stood are shamed; craven is guilt', () => {
        const w = makeWorld(), p = makePlayer();
        onTrial(w, p);
        const res = Ordeals.trialCombat(p, w, 'self');
        expect(res.duel && res.duel.a && res.duel.b).toBeTruthy();
        const s = Ordeals.settleTrialCombat(p, w, { playerWon: true, yielded: null, aLost: 0.3, bLost: 0.5, aHp: 10, bHp: 5 });
        expect(s.cleared).toBe(true);
        const r = Trials.resolveTrial(p, w);
        expect(r.convicted).toBe(false);
        const ella = w.ashford.folk.people.find(x => x.id === 1);
        expect((ella.nm || []).some(e => e.k === 'ordeal_shamed')).toBe(true);

        const w2 = makeWorld(), p2 = makePlayer();
        onTrial(w2, p2);
        Ordeals.trialCombat(p2, w2, 'self');
        const renown0 = p2.renown;
        Ordeals.settleTrialCombat(p2, w2, { playerWon: false, yielded: 'a', aLost: 0.5, bLost: 0.1, aHp: 10, bHp: 25 });
        expect(p2.renown).toBeLessThan(renown0);
        expect(Trials.resolveTrial(p2, w2).convicted).toBe(true);
    });

    it('oath-helpers: enough of your people swear and you walk; sworn against the plain proof, the perjury comes out', () => {
        const w = makeWorld(), p = makePlayer({ house: { name: 'House Ash', prestige: 40, generation: 1, rivals: {}, history: [] } });
        p.children = [1, 2, 3, 4, 5, 6].map(i => ({ id: `c${i}`, firstName: `Child${i}`, age: 20, gender: 'male', isAlive: true }));
        const t = onTrial(w, p);
        t.charges[0].proof = 3;
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Ordeals.trialOath(p, w);
        vi.restoreAllMocks();
        expect(res.cleared).toBe(true);
        expect(Trials.resolveTrial(p, w).convicted).toBe(false);
        const pj = p.ordeals.perjuries[0];
        expect(pj).toBeTruthy();
        w.day = pj.surface;
        const rep0 = p.reputation.k1;
        const out = Ordeals.processDay(w, p);
        expect(out.notices.some(n => n.title === 'Perjury Found Out')).toBe(true);
        expect(p.reputation.k1).toBeLessThan(rep0);
        expect(p.ordeals.perjuries).toHaveLength(0);
    });

    it('no ordeal where the law keeps to the court', () => {
        const w = makeWorld('court'), p = makePlayer();
        const t = onTrial(w, p);
        expect(Ordeals.trialOptions(p, w, t).every(o => !o.ok)).toBe(true);
        expect(Ordeals.trialOrdeal(p, w, 'water').success).toBe(false);
    });
});

describe('cases before your court', () => {
    function ruler(law = 'old') {
        const w = makeWorld(law);
        const p = makePlayer({ q: 9, r: 9, throne: { ruling: { kingdomId: 'k1' } }, house: { name: 'House Ash', prestige: 50, generation: 1, rivals: {}, history: [] } });
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: ['Joan Ash'], caught: false }];
        const c = Trials._makeCase(p, w, Trials.seats(p, w)[0], () => 0.1);
        return { w, p, c };
    }

    it('a demanded right refused and a conviction costs the town; heeding an ordeal is believed', () => {
        const { w, c } = ruler();
        expect(c.demand === null || typeof c.demand === 'string').toBe(true);
        const fxRefused = Ordeals.adjustFx(w, { ...c, demand: 'combat', ordeal: null }, 'fine', {});
        expect(fxRefused.happiness).toBeLessThan(0);
        const fxHeeded = Ordeals.adjustFx(w, { ...c, ordeal: { method: 'iron', guilty: true } }, 'fine', {});
        expect(fxHeeded.happiness).toBeGreaterThan(0);
    });

    it('cleared by the water: the accuser pays the cleared, and the case is acquitted', () => {
        const { w, p, c } = ruler();
        const joan = w.capital.folk.people.find(x => x.id === 13);
        const kit = w.capital.folk.people.find(x => x.id === 12);
        joan.purse = 40; kit.purse = 5;
        const c0 = coin(w, p);
        // (find the method that clears on this case's hash: try each the law allows)
        let res = null;
        for (const m of ['water', 'bread', 'iron']) {
            const cc = { ...c, id: c.id, ordeal: null };
            p.trials.cases = [cc];
            res = Ordeals.judgeCase(p, w, cc.id, m);
            if (res.cleared) break;
        }
        expect(res.success).toBe(true);
        if (res.cleared) {
            expect(kit.purse).toBeGreaterThan(5);
            expect(joan.purse).toBeLessThan(40);
            const r = Trials.rule(p, w, c.id, 'acquit');
            expect(r.success).toBe(true);
        } else {
            expect(p.trials.cases[0].ordeal.guilty).toBe(true);
        }
        expect(coin(w, p)).toBeCloseTo(c0, 2);
    });

    it('trial by combat between accused and accuser (or the accuser\'s hired guard) is decided by the bout', () => {
        const { w, p, c } = ruler();
        const res = Ordeals.judgeCase(p, w, c.id, 'combat');
        expect(res.success).toBe(true);
        expect(typeof res.cleared).toBe('boolean');
        expect(res.text).toContain('Kit Barrow');
    });
});

describe('a kinsman accused', () => {
    it('let the court decide: guilty, the fine goes to the crown; cleared, the accuser pays your House', () => {
        const w = makeWorld(), p = makePlayer({ house: { name: 'House Ash', prestige: 40, generation: 1, rivals: {}, history: [] } });
        p.children = [{ id: 'c1', firstName: 'Ada', age: 19, gender: 'female', isAlive: true }];
        const st = Ordeals.state(p);
        st.kin = { id: 1, childId: 'c1', name: 'Ada', gender: 'female', crime: 'brawl', label: 'brawling in the street', proof: 3, opened: 100, day: 106, town: 'Ashford', q: 4, r: 4, type: 'town', kingdomId: 'k1', accuser: { pid: 2, name: 'Tom Reed' }, guilty: true };
        const c0 = coin(w, p);
        const r = Ordeals.kinAct(p, w, 'court');
        expect(r.success).toBe(true);
        expect(st.kin).toBe(null);
        expect(coin(w, p)).toBeCloseTo(c0, 2);
        if (r.guilty) expect(w.k1.treasury).toBeGreaterThan(1000);
        // An unanswered case is heard on its day
        st.kin = { id: 2, childId: 'c1', name: 'Ada', gender: 'female', crime: 'slander', label: 'slander', proof: 1, opened: 100, day: 100, town: 'Ashford', q: 4, r: 4, type: 'town', kingdomId: 'k1', accuser: null, guilty: false };
        const out = Ordeals.processDay(w, p);
        expect(out.notices.some(n => /Your Kin/.test(n.title))).toBe(true);
        expect(st.kin).toBe(null);
    });

    it('standing as their champion warms the bond', () => {
        const w = makeWorld(), p = makePlayer({ house: { name: 'House Ash', prestige: 40, generation: 1, rivals: {}, history: [] } });
        const child = { id: 'c1', firstName: 'Ada', age: 19, gender: 'female', isAlive: true, raising: { bond: 50 } };
        p.children = [child];
        Ordeals.state(p).kin = { id: 1, childId: 'c1', name: 'Ada', gender: 'female', crime: 'theft', label: 'theft', proof: 2, opened: 100, day: 106, town: 'Ashford', q: 4, r: 4, type: 'town', kingdomId: 'k1', accuser: { pid: 2, name: 'Tom Reed' }, guilty: false };
        const d = Ordeals.kinAct(p, w, 'champion');
        expect(d.duel).toBeTruthy();
        const r = Ordeals.settleKinCombat(p, w, { playerWon: true, yielded: null, aLost: 0.2, bLost: 1, aHp: 20, bHp: 0 });
        expect(r.guilty).toBe(false);
    });
});

describe('the wager of battle', () => {
    it('a suit settled by combat goes with the victor at the hearing', () => {
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, standing: {}, memory: [], log: [], loans: [], head: { firstName: 'Odo', age: 40, martial: 7, traits: [], persona: { honour: 7 } } };
        const p = makePlayer({ allegiance: 'k1', house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        Trials.state(p).suits.push({ id: 50, kind: 'slander', rivalId: 'k2', rivalName: 'House Morn', plaintiff: 'rival', status: 'open', kingdomId: 'k1', town: 'Valden', q: 9, r: 9, hearing: 110, filed: 100, merit: 0.9, amount: 0, judge: { name: 'Aldric', persona: 'just' } });
        const d = Ordeals.suitCombat(p, w, 50, 'self');
        expect(d.duel).toBeTruthy();
        const s = Ordeals.settleSuitCombat(p, w, 50, { playerWon: true, yielded: 'b', aLost: 0.2, bLost: 0.6, aHp: 20, bHp: 8 });
        expect(s.resolveSuit).toBe(true);
        const suit = Trials.state(p).suits[0];
        // (the rival sued: your win is the plaintiff's loss, whatever the merit said)
        expect(suit.combat.plaintiffWon).toBe(false);
        const r = Trials.resolveSuit(p, w, suit, () => 0);
        expect(r.won).toBe(true);
    });

    it('a mighty, honourable rival demands it; unanswered at the hearing, it counts as refused', () => {
        const w = makeWorld();
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, standing: {}, memory: [], log: [], loans: [], head: { firstName: 'Odo', age: 40, martial: 9, traits: [], persona: { honour: 9 } } };
        const p = makePlayer({ allegiance: 'k1', house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        const suits = Trials.state(p).suits;
        for (let i = 0; i < 12; i++) suits.push({ id: 60 + i, kind: 'debt', rivalId: 'k2', rivalName: 'House Morn', plaintiff: 'player', status: 'open', kingdomId: 'k1', town: 'Valden', q: 9, r: 9, hearing: 105, filed: 100, merit: 0.5, judge: { name: 'Aldric', persona: 'just' } });
        const out = Ordeals.processDay(w, p);
        const demanded = suits.filter(s => s.combatDemand);
        expect(demanded.length).toBeGreaterThan(0);
        expect(out.notices.some(n => n.title === 'A Wager of Battle')).toBe(true);
        w.day = 105;
        const pr0 = p.house.prestige;
        Ordeals.processDay(w, p);
        expect(suits.filter(s => s.combatDemand)).toHaveLength(0);
        expect(p.house.prestige).toBeLessThan(pr0);
    });
});

describe('the wager of battle: blood', () => {
    function withDeaths(fn) {
        const C = DataLoader._gamedata.ordeals.combat;
        const was = [C.deathChance, C.rival.headDeathChance];
        C.deathChance = 1; C.rival.headDeathChance = 1;
        try { fn(); } finally { C.deathChance = was[0]; C.rival.headDeathChance = was[1]; }
    }
    const rivalOf = (head) => ({ kingdomId: 'k2', houseKey: 'hk2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, guard: 2, standing: {}, memory: [], log: [], loans: [], stats: {}, head: { firstName: 'Odo', gender: 'male', age: 40, martial: 8, traits: [], children: [{ firstName: 'Berin', gender: 'male', age: 24 }], persona: { honour: 7 }, ...head } });
    const suitFor = (p, id) => Trials.state(p).suits.push({ id, kind: 'slander', rivalId: 'k2', rivalName: 'House Morn', plaintiff: 'rival', status: 'open', kingdomId: 'k1', town: 'Valden', q: 9, r: 9, hearing: 110, filed: 100, merit: 0.5, amount: 0, judge: { name: 'Aldric', persona: 'just' } });

    it('the rival head slain in the lists: the heir takes the House, the feud flares, the heir swears vengeance', () => {
        const w = makeWorld();
        const rival = rivalOf({});
        const p = makePlayer({ allegiance: 'k1', house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        suitFor(p, 70);
        Ordeals.suitCombat(p, w, 70, 'self');
        const feud0 = rival.feud;
        withDeaths(() => {
            const s = Ordeals.settleSuitCombat(p, w, 70, { playerWon: true, yielded: null, aLost: 0.3, bLost: 1, aHp: 15, bHp: 0 });
            expect(s.text).toMatch(/dies on the field/);
        });
        expect(rival.head.firstName).toBe('Berin');
        expect(rival.feud).toBeGreaterThan(feud0 * 0.5);
        expect(rival.memory.some(m => m.kind === 'headSlain')).toBe(true);
        const grudges = (p.nemesis && p.nemesis.grudges) || [];
        expect(grudges.some(g => g.kind === 'house' && g.ref.kingdomId === 'k2')).toBe(true);
    });

    it('an old head sends a sworn sword; slain, the House has one guard fewer', () => {
        const w = makeWorld();
        const rival = rivalOf({ age: 64 });
        const p = makePlayer({ allegiance: 'k1', house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        suitFor(p, 71);
        const d = Ordeals.suitCombat(p, w, 71, 'self');
        expect(d.duel.b.name).toMatch(/sworn sword/);
        withDeaths(() => Ordeals.settleSuitCombat(p, w, 71, { playerWon: true, yielded: null, aLost: 0.3, bLost: 1, aHp: 15, bHp: 0 }));
        expect(rival.guard).toBe(1);
        expect(rival.head.firstName).toBe('Odo');
    });
});

describe('a kinsman put to the iron', () => {
    it('the burn is the child\'s: health lost, days to heal, a scar the family page shows', () => {
        const w = makeWorld(), p = makePlayer({ house: { name: 'House Ash', prestige: 40, generation: 1, rivals: {}, history: [] } });
        const child = { id: 'c1', firstName: 'Ada', age: 19, gender: 'female', isAlive: true, health: 100, maxHealth: 100 };
        p.children = [child];
        Ordeals.state(p).kin = { id: 3, childId: 'c1', name: 'Ada', gender: 'female', crime: 'theft', label: 'theft', proof: 2, opened: 100, day: 106, town: 'Ashford', q: 4, r: 4, type: 'town', kingdomId: 'k1', accuser: { pid: 2, name: 'Tom Reed' }, guilty: false };
        const r = Ordeals.kinAct(p, w, 'iron');
        expect(r.success).toBe(true);
        expect(r.scene.method).toBe('iron');
        expect(child.health).toBeLessThan(100);
        expect(child.ordealMarks).toHaveLength(1);
        const m = child.ordealMarks[0];
        expect(m.heals).toBeGreaterThan(w.day);
        expect(Ordeals.childMarks(child, w.day)[0].text).toMatch(/healing until/);
        if (m.festered) expect(child.maxHealth).toBeLessThan(100);
        if (m.scar) expect(Ordeals.childMarks(child, m.heals + 1)[0].text).toMatch(/scar/);
        else expect(Ordeals.childMarks(child, m.heals + 1)).toHaveLength(0);
    });
});

describe('a champion for hire', () => {
    it('won, the fee comes out of the client\'s own purse, and they remember who fought for them', () => {
        const w = makeWorld(), p = makePlayer();
        const st = Ordeals.state(p);
        const wat = w.ashford.folk.people.find(x => x.id === 5);
        wat.purse = 60;
        st.calls.push({ id: 9, day: 100, expires: 104, q: 4, r: 4, town: 'Ashford', type: 'town', kingdomId: 'k1', clientPid: 5, client: 'Wat Tyler', crime: 'theft', crimeLabel: 'theft', side: 'accused', fee: 40, foe: { name: 'Brand Hale', pid: 6 } });
        const d = Ordeals.takeCall(p, w, 9);
        expect(d.duel).toBeTruthy();
        const c0 = coin(w, p);
        const gold0 = p.gold;
        const r = Ordeals.settleCall(p, w, 9, { playerWon: true, yielded: 'b', aLost: 0.1, bLost: 0.7, aHp: 25, bHp: 6 });
        expect(r.won).toBe(true);
        expect(p.gold - gold0).toBeCloseTo(40, 2);
        expect(wat.purse).toBeCloseTo(20, 2);
        expect(coin(w, p)).toBeCloseTo(c0, 2);
        expect((wat.nm || []).some(e => e.k === 'championed')).toBe(true);
        expect(st.stats.wins).toBe(1);
    });

    it('lost, the client takes the sentence', () => {
        const w = makeWorld(), p = makePlayer();
        const st = Ordeals.state(p);
        st.calls.push({ id: 9, day: 100, expires: 104, q: 4, r: 4, town: 'Ashford', type: 'town', kingdomId: 'k1', clientPid: 5, client: 'Wat Tyler', crime: 'murder', crimeLabel: 'murder', side: 'accused', fee: 40, foe: { name: 'Brand Hale', pid: 6 } });
        Ordeals.takeCall(p, w, 9);
        Ordeals.settleCall(p, w, 9, { playerWon: false, yielded: null, aLost: 1, bLost: 0.2, aHp: 0, bHp: 20 });
        const wat = w.ashford.folk.people.find(x => x.id === 5);
        expect(wat.died).not.toBe(undefined);
        expect(p.health).toBeLessThan(100);
    });
});

describe('the panel', () => {
    it('renders the ordeal rows in every tab, and a fight in the duel panel settles the trial', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const w = makeWorld('old', 'stoneheart');
        const rival = { kingdomId: 'k2', name: 'House Morn', gold: 1000, feud: 20, renown: 5, standing: {}, memory: [], log: [], loans: [{ amount: 100, owed: 120, due: 50, lent: 0, defaulted: 60 }], head: { firstName: 'Odo', age: 50, martial: 8, traits: [], persona: { honour: 7 } } };
        const p = makePlayer({ allegiance: 'k1', throne: { ruling: { kingdomId: 'k1' } }, house: { name: 'House Ash', prestige: 40, generation: 1, rivals: { k2: rival }, history: [] } });
        p.children = [{ id: 'c1', firstName: 'Ada', age: 19, gender: 'female', isAlive: true }];
        onTrial(w, p);
        w.capital.npcCrimes = [{ id: 1, k: 'burglary', by: 'Kit Barrow', byPid: 12, victim: 'Joan Ash', vuid: 'pid13', d: 95, seenBy: [], caught: false }];
        Trials._makeCase(p, w, Trials.seats(p, w)[0], () => 0.1);
        Trials.fileSuit(p, w, 'k2', 'debt');
        Ordeals.state(p).kin = { id: 1, childId: 'c1', name: 'Ada', gender: 'female', crime: 'theft', label: 'theft', proof: 2, opened: 100, day: 106, town: 'Ashford', q: 4, r: 4, type: 'town', kingdomId: 'k1', accuser: { pid: 2, name: 'Tom Reed' }, guilty: false };
        Ordeals.state(p).calls.push({ id: 9, day: 100, expires: 104, q: 4, r: 4, town: 'Ashford', type: 'town', kingdomId: 'k1', clientPid: 5, client: 'Wat Tyler', crime: 'theft', crimeLabel: 'theft', side: 'accused', fee: 40, foe: { name: 'Brand Hale', pid: 6 } });
        const panels = [];
        const game = { player: p, world: w, ui: { showCustomPanel: (t, h) => panels.push(h), showNotification() {}, updateStats() {}, hideCustomPanel() {} } };
        for (const tab of ['trial', 'court', 'suits', 'ordeal']) ActionMenu.showTrialsPanel(game, null, tab);
        expect(panels[0]).toMatch(/Another judgement/);
        expect(panels[0]).toMatch(/Ordeal of the Hot Iron/);
        expect(panels[3]).toMatch(/Ada accused/);
        expect(panels[3]).toMatch(/Fight for Wat Tyler/);
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
        // Fight yourself: the duel panel, fought on instinct, then the verdict
        ActionMenu.trialsAct(game, 'ordeal', 'trialCombat', ['self']);
        expect(window._duel).toBeTruthy();
        window._duel.auto();
        window._duel.done();
        expect(p.trials.trial).toBe(null);
        expect(p.trials.last.text).toMatch(/court of Ashford|dust/);
        // The pictures and the told ordeal
        const { ordealPicture, showOrdealScene } = await import('../ui/actionMenu/ordeals.js');
        for (const m of ['combat', 'iron', 'water', 'bread', 'compurgation']) for (const d of [null, true, false]) expect(ordealPicture(m, 2, d)).not.toMatch(/undefined|NaN/);
        let judged = false;
        showOrdealScene(game, { text: 'Cleared.', scene: { method: 'water', who: 'Ada', cleared: true }, bout: null }, () => { judged = true; });
        for (let i = 0; i < 4; i++) window._ordealScene.next();
        expect(panels[panels.length - 1]).toMatch(/Hear the judgement/);
        window._ordealScene.done();
        expect(judged).toBe(true);
        // The kin's court, from the tab
        ActionMenu.trialsAct(game, 'ordeal', 'kin', ['court']);
        expect(Ordeals.state(p).kin).toBe(null);
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
    }, 120000);
});
