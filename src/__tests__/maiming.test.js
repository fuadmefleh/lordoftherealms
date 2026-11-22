// Maiming (systems/maiming.js, systems/maimMarks.js): what a body loses and what the loss does
// (stats, fighting, the road, letters, work, office and rule, speech, children), aids made by a
// town's craftsmen out of real coin and goods, the deed's price to the doer (karma, cruelty, dread,
// the realm's regard by its culture and law, memory, a vendetta), the law that takes a thief's hand
// (the player convicted, the player as judge, the realms' own courts), the lords of a royal court
// and the House's own blood, the world maiming on its own hash rolls.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { Maiming } from '../systems/maiming.js';
import { Ailments } from '../systems/ailments.js';
import { Literacy } from '../systems/literacy.js';
import { Atrocities } from '../systems/atrocities.js';
import { Kingship } from '../systems/kingship.js';
import { Relationships } from '../systems/relationships.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Trials } from '../player/trials.js';
import { Laws } from '../systems/laws.js';
import { Throne } from '../systems/throne.js';

beforeAll(async () => { await loadData(); });
beforeEach(() => { Utils.setSeed(9191); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Cole', gender, born: -40 * 120, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, ...o });

function makeWorld({ culture = 'Imperial', mutilation = 'never', day = 1000 } = {}) {
    const smith = P(0, 'Hal', 'male', { role: 'blacksmith_npc', job: { id: 'smith', rank: 'master', since: 0 }, spouse: 1, kids: [2] });
    const wife = P(1, 'Meg', 'female', { spouse: 0, kids: [2], job: { id: 'tailor', rank: 'master', since: 0 } });
    const son = P(2, 'Rob', 'male', { parents: [0, 1], born: -20 * 120, job: { id: 'carpenter', rank: 'master', since: 0 } });
    const thief = P(3, 'Nell', 'female', { job: { id: 'labourer', rank: 'master', since: 0 } });
    const folk = { q: 3, r: 4, n: 4, people: [smith, wife, son, thief], annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, culture, laws: { mutilation, punishment: 'standard' }, capital: { q: 3, r: 4 } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, culture, economy: { gold: 2000 }, type: 'town', population: 900 };
    const world = {
        day, generationParams: { seed: 7 }, kingdoms: [kingdom], events: [], width: 40, height: 40,
        getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: town } : null),
        getSettlementViews: () => [town],
        getKingdom: (id) => (String(id) === '1' ? kingdom : null),
    };
    return { world, folk, town, kingdom, smith, wife, son, thief };
}

function makePlayer(o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, reputation: { 1: 20 }, q: 3, r: 4,
        strength: 8, charisma: 7, intelligence: 6, faith: 5, luck: 5,
        skills: { combat: 8, commerce: 5, leadership: 6, diplomacy: 7, stealth: 5, cartography: 4 },
        inventory: {}, house: { name: 'House Voss', generation: 1, prestige: 100, history: [] }, children: [], ...o,
    };
}

describe('MaimMarks — the body', () => {
    it('a hand taken costs strength and the sword arm; the second bars rule, office and the pen', () => {
        const p = makePlayer();
        expect(MaimMarks.mark(p, 'hand', { day: 5 })).toBeTruthy();
        expect(MaimMarks.count(p, 'hand')).toBe(1);
        expect(p.strength).toBe(7);
        expect(p.skills.combat).toBe(5);
        expect(MaimMarks.tag(p)).toBe('a hand gone');
        expect(MaimMarks.barsRule(p)).toBeNull();
        expect(Ailments.battleMultiplier(p)).toBeCloseTo(0.85, 5);
        MaimMarks.mark(p, 'hand', { day: 6 });
        expect(MaimMarks.handless(p)).toBe(true);
        expect(MaimMarks.barsRule(p)).toBe('both hands gone');
        expect(MaimMarks.barsOffice(p)).toBeTruthy();
        expect(MaimMarks.canWrite(p)).toBe(false);
        expect(MaimMarks.whyNot(p, 'hand')).toMatch(/nothing left/);
        // what was taken is kept, so it can be given back exactly
        expect(p.maimed.taken.skills.combat).toBe(7);
    });

    it('both eyes put out: blind — no reading, no rule, slower on the road, a sword arm worth little', () => {
        const p = makePlayer();
        MaimMarks.mark(p, 'eye');
        expect(MaimMarks.blind(p)).toBe(false);
        MaimMarks.mark(p, 'eye');
        expect(MaimMarks.blind(p)).toBe(true);
        expect(Literacy.canRead(p)).toBe(false);
        expect(Literacy.readingGate(p)).toMatch(/blind/);
        expect(MaimMarks.barsRule(p)).toBe('blinded');
        expect(Ailments.movementPenalty(p)).toBe(1);
        expect(Ailments.battleMultiplier(p)).toBeLessThan(0.5);
    });

    it('a foot gone slows the road; a wooden leg gives part back (an aid offsets only what its part took)', () => {
        const p = makePlayer();
        MaimMarks.mark(p, 'foot');
        expect(Ailments.movementPenalty(p)).toBe(2);
        const combat = p.skills.combat;
        expect(MaimMarks.fitAid(p, 'wooden_leg', 10)).toBe(true);
        expect(Ailments.movementPenalty(p)).toBe(1);
        expect(p.skills.combat).toBe(combat + 1);
        // a crutch takes the leg's slot
        MaimMarks.fitAid(p, 'crutch', 11);
        expect(MaimMarks.wears(p, 'wooden_leg')).toBe(false);
        expect(MaimMarks.wears(p, 'crutch')).toBe(true);
        expect(p.skills.combat).toBe(combat);
        // an eye patch fits no foot
        expect(MaimMarks.fitAid(p, 'eye_patch')).toBe(false);
    });

    it('the tongueless are mute, the gelded father no children, a woman cannot be gelded', () => {
        const p = makePlayer();
        MaimMarks.mark(p, 'tongue');
        expect(MaimMarks.mute(p)).toBe(true);
        expect(p.skills.diplomacy).toBe(1);
        const f = { gender: 'female' };
        expect(MaimMarks.whyNot(f, 'geld')).toMatch(/Not a man/);
        const m = { gender: 'male' };
        MaimMarks.mark(m, 'geld');
        expect(MaimMarks.gelded(m)).toBe(true);
        expect(MaimMarks.barsRule(m)).toBe('gelded');
        expect(MaimMarks.looks(m)).toBe(''); // (not something seen)
    });

    it('work: a one-handed smith works at a third; the blind lose most trades', () => {
        const smith = { job: { id: 'smith' } };
        MaimMarks.mark(smith, 'hand');
        expect(MaimMarks.workFactor(smith, 'smith')).toBeCloseTo(0.35, 5);
        expect(MaimMarks.keepsTrade(smith, 'smith')).toBe(true);
        MaimMarks.mark(smith, 'hand');
        expect(MaimMarks.keepsTrade(smith, 'smith')).toBe(false);
        expect(MaimMarks.workFactor(smith, 'beggar')).toBe(1);
    });
});

describe('Maiming — the deed done to a townsperson', () => {
    it('a smith maimed in the street: the trade lost, the kin remember, a vendetta, the brand on the doer', () => {
        const w = makeWorld({ culture: 'Imperial' });
        const player = makePlayer();
        Maiming.maimFolk(player, w.world, { settlement: w.town, folk: w.folk, person: w.smith, act: 'hand' });
        const res = Maiming.maimFolk(player, w.world, { settlement: w.town, folk: w.folk, person: w.smith, act: 'hand' });
        expect(res.ok).toBe(true);
        expect(MaimMarks.handless(w.smith)).toBe(true);
        expect(w.smith.job.id).toBe('beggar');
        expect(w.smith.job.lostTrade).toBe('smith');
        expect(res.text).toMatch(/never work as a smith/);
        expect((w.smith.nm || []).some(e => e.k === 'mutilated')).toBe(true);
        expect((w.son.nm || []).some(e => e.k === 'mutilated')).toBe(true);
        expect(player.karma).toBeLessThan(0);
        expect(Atrocities.butcher(player)).toBeGreaterThan(0);
        expect(player.reputation[1]).toBeLessThan(20);
        expect(player.nemesis.grudges.some(g => g.deed.key === 'mutilated')).toBe(true);
        expect(player.house.history.some(h => /Hal Cole/.test(h.text))).toBe(true);
        expect(Maiming.state(player).stats.byAct.hand).toBe(2);
    });

    it('the culture decides how the realm takes it, and a lawful sentence weighs far less', () => {
        const harsh = makeWorld({ culture: 'Nordic' });
        const soft = makeWorld({ culture: 'Imperial' });
        const a = makePlayer();
        const b = makePlayer();
        const c = makePlayer();
        Maiming.maimFolk(a, harsh.world, { settlement: harsh.town, folk: harsh.folk, person: harsh.thief, act: 'ear' });
        Maiming.maimFolk(b, soft.world, { settlement: soft.town, folk: soft.folk, person: soft.thief, act: 'ear' });
        const lawW = makeWorld({ culture: 'Imperial' });
        Maiming.maimFolk(c, lawW.world, { settlement: lawW.town, folk: lawW.folk, person: lawW.thief, act: 'ear', lawful: true });
        const lossA = 20 - a.reputation[1];
        const lossB = 20 - b.reputation[1];
        const lossC = 20 - c.reputation[1];
        expect(lossB).toBeGreaterThan(lossA);
        expect(lossB).toBeGreaterThan(lossC);
        // done unseen (a cellar), the realm hears nothing
        const d = makePlayer();
        const dw = makeWorld();
        Maiming.maimFolk(d, dw.world, { settlement: dw.town, folk: dw.folk, person: dw.thief, act: 'ear', seen: false, inCellar: true });
        expect(d.reputation[1]).toBe(20);
    });
});

describe('Maiming — the law', () => {
    it('what each option of the mutilation law takes, and when', () => {
        const never = makeWorld({ mutilation: 'never' });
        const thieves = makeWorld({ mutilation: 'thieves' });
        const old = makeWorld({ mutilation: 'old' });
        expect(Maiming.lawAct(never.world, 1, ['theft'], 3)).toBeNull();
        expect(Maiming.lawAct(thieves.world, 1, ['theft'], 1)).toBeNull();
        expect(Maiming.lawAct(thieves.world, 1, ['theft'], 2)).toBe('hand');
        expect(Maiming.lawAct(old.world, 1, ['slander'], 1)).toBe('tongue');
        expect(Maiming.lawAct(old.world, 1, ['assault'], 1)).toBeNull();
        expect(Maiming.judgeAct(old.world, 1, 'pickpocket')).toBe('hand');
        expect(Maiming.judgeAct(old.world, 1, 'cheating')).toBe('ear');
        expect(Laws.law('mutilation').options.map(o => o.id)).toEqual(['never', 'thieves', 'old']);
    });

    it('the player as judge may take the hand only where the law does', () => {
        const old = makeWorld({ mutilation: 'old' });
        const never = makeWorld({ mutilation: 'never' });
        const c = { kingdomId: 1, crime: 'theft' };
        expect(Trials.verdicts(old.world, c).some(v => v.id === 'maim')).toBe(true);
        expect(Trials.verdicts(never.world, c).some(v => v.id === 'maim')).toBe(false);
        expect(Trials.verdicts().some(v => v.id === 'maim')).toBe(false);
        expect(Trials.verdicts(old.world, { kingdomId: 1, crime: 'murder' }).some(v => v.id === 'maim')).toBe(false);
    });
});

describe('Maiming — the player maimed', () => {
    it('the stump is a wound that may turn; the loss goes in the chronicle and on the body for good', () => {
        const w = makeWorld();
        const player = makePlayer();
        const r = Maiming.maimPlayer(player, w.world, 'hand', { by: 'the court of Ashford', why: 'theft' });
        expect(r.ok).toBe(true);
        expect(Ailments.has(player, 'fresh_stump')).toBe(true);
        expect(MaimMarks.count(player, 'hand')).toBe(1);
        expect(player.house.history.some(h => /court of Ashford/.test(h.text))).toBe(true);
        expect(Maiming.state(player).stats.suffered).toBe(1);
    });

    it('a grave wound in a rout may cost an eye or a hand: a hash roll, the same every time', () => {
        const run = () => {
            const w = makeWorld();
            const p = makePlayer();
            p.ailments = null;
            let lost = null;
            for (let i = 0; i < 400 && !lost; i++) {
                w.world.day++;
                const rep = { name: 'Deep Gash', text: '' };
                Ailments.getState(p).stats.wounds = i;
                lost = Ailments._graveWound(p, w.world, 'battle_loss', rep) ? { day: w.world.day, rep } : null;
            }
            return { lost, parts: MaimMarks.parts(p) };
        };
        const a = run();
        const b = run();
        expect(a.lost).toBeTruthy();
        expect(a).toEqual(b);
        expect(a.lost.rep.name).toMatch(/Deep Gash: /);
    });

    it('aids are made by a town craftsman: the fee into his purse, the iron out of the market, its price to the town', () => {
        const w = makeWorld();
        const player = makePlayer();
        MaimMarks.mark(player, 'hand');
        SettlementMarket.add(w.town, 'iron', 3);
        const before = { gold: player.gold, smith: w.smith.purse, town: w.town.economy.gold, iron: SettlementMarket.available(w.town, 'iron') };
        const opts = Maiming.aidOptions(player, w.world, w.town);
        const hook = opts.find(o => o.id === 'iron_hook');
        expect(hook.ok).toBe(true);
        expect(hook.maker).toMatch(/Hal Cole/);
        const combat = player.skills.combat;
        const r = Maiming.buyAid(player, w.world, w.town, 'iron_hook');
        expect(r.success).toBe(true);
        expect(player.gold).toBe(before.gold - hook.cost);
        expect(w.smith.purse - before.smith + w.town.economy.gold - before.town).toBeCloseTo(hook.cost, 2);
        expect(SettlementMarket.available(w.town, 'iron')).toBe(before.iron - 1);
        expect(player.skills.combat).toBe(combat + 1);
        expect(Maiming.aidOptions(player, w.world, w.town).find(o => o.id === 'iron_hook').why).toMatch(/already/);
        // no smith in a town, no hook
        const w2 = makeWorld();
        w2.folk.people = w2.folk.people.filter(p => p.job.id !== 'smith');
        const p2 = makePlayer();
        MaimMarks.mark(p2, 'hand');
        expect(Maiming.aidOptions(p2, w2.world, w2.town).find(o => o.id === 'iron_hook').ok).toBe(false);
    });
});

describe('Maiming — the court and the blood', () => {
    function ruler() {
        const w = makeWorld();
        const player = makePlayer({ throne: { ruling: { kingdomId: 1, since: 0 } } });
        const court = Kingship.court(player);
        const mk = (id, o = {}) => ({ id, firstName: id, dynasty: 'Hart', gender: 'male', age: 40, seat: { q: 3, r: 4, name: 'Ashford' }, skills: { leadership: 8, diplomacy: 8 }, opinion: 10, grudge: 0, cowedUntil: 0, rebel: false, powerMult: 1, traits: [], ...o });
        court.vassals = [mk('v1', { rebel: true }), mk('v2'), mk('v3')];
        return { ...w, player, court };
    }

    it('a rebel lord blinded: lawful justice, the court cowed, and he sits no council', () => {
        const r = ruler();
        expect(Throne.ruledKingdom(r.player, r.world)).toBeTruthy();
        const t = Maiming.targets(r.player, r.world).filter(x => x.kind === 'vassal');
        expect(t).toHaveLength(3);
        expect(t.find(x => x.id === 'v1').lawful).toBe(true);
        Maiming.act(r.player, r.world, 'vassal', 'v1', 'eye');
        const res = Maiming.act(r.player, r.world, 'vassal', 'v1', 'eye');
        expect(res.success).toBe(true);
        const v1 = r.court.vassals[0];
        expect(MaimMarks.blind(v1)).toBe(true);
        r.court.vassals[0].rebel = false;
        expect(Kingship._person(r.player, r.world, Object.keys(Kingship.offices())[0], 'vassal', 'v1')).toBeNull();
        expect(r.court.vassals[1].cowedUntil).toBeGreaterThan(r.world.day);
        expect(r.court.vassals[1].grudge).toBe(0);
    });

    it('an innocent lord maimed: the others hate the crown for it, and the realm is shaken', () => {
        const r = ruler();
        const stab = r.kingdom.stability;
        const res = Maiming.act(r.player, r.world, 'vassal', 'v2', 'nose');
        expect(res.success).toBe(true);
        expect(r.court.vassals[2].grudge).toBeGreaterThan(0);
        expect(r.kingdom.stability).toBeLessThan(stab);
        expect(r.player.house.history.some(h => /v2 Hart/.test(h.text))).toBe(true);
    });

    it('a son blinded or slit-nosed can never sit the seat: the heir lists pass him by', () => {
        const w = makeWorld();
        const player = makePlayer({ throne: { ruling: { kingdomId: 1, since: 0 } } });
        const elder = { id: 'c1', firstName: 'Edmund', dynasty: 'Voss', gender: 'male', age: 24, isAlive: true, strength: 6, skills: { combat: 3 } };
        const younger = { id: 'c2', firstName: 'Osric', dynasty: 'Voss', gender: 'male', age: 20, isAlive: true, strength: 6, skills: { combat: 3 } };
        player.children = [elder, younger];
        player.heir = 'c1';
        const res = Maiming.act(player, w.world, 'kin', 'c1', 'nose');
        expect(res.success).toBe(true);
        expect(MaimMarks.barsRule(elder)).toBe('the nose slit');
        expect(Relationships.getEligibleHeirs(player).map(c => c.id)).not.toContain('c1');
        expect(CrownSuccession.likelyHeir(player).id).toBe('c2');
        expect(elder.kin.grievance).toBeGreaterThan(0);
        const named = Relationships.designateHeir(player, 'c1');
        expect(named.success).toBe(false);
        expect(named.reason).toMatch(/nose slit/);
    });
});

describe('Maiming — the world maims too', () => {
    it('a realm under the old law takes a caught thief\'s hand; deterministic, once', () => {
        const run = () => {
            const w = makeWorld({ mutilation: 'old', day: 1001 });
            w.town.npcCrimes = [{ id: 1, k: 'theft', by: 'Nell Cole', byPid: 3, victim: 'someone', d: 1000, caught: true }, { id: 2, k: 'theft', by: 'Rob Cole', byPid: 2, victim: 'someone', d: 1000, caught: true }];
            for (let d = 1001; d <= 1015; d++) { w.world.day = d; Maiming.processDay(w.world, null); }
            return { nell: MaimMarks.count(w.thief, 'hand'), rob: MaimMarks.count(w.son, 'hand'), done: w.town.npcCrimes.map(e => !!e.maimDone), annals: w.folk.annals.length };
        };
        const a = run();
        expect(a).toEqual(run());
        expect(a.done).toEqual([true, true]);
        expect(a.nell + a.rob).toBeGreaterThan(0);
        expect(a.nell).toBeLessThanOrEqual(1);
        // under 'never', no hand is taken
        const w = makeWorld({ mutilation: 'never', day: 1001 });
        w.town.npcCrimes = [{ id: 1, k: 'theft', byPid: 3, d: 1000, caught: true }];
        for (let d = 1001; d <= 1015; d++) { w.world.day = d; Maiming.processDay(w.world, null); }
        expect(MaimMarks.any(w.thief)).toBe(false);
    });

    it('an AI succession crisis may end with the loser blinded (a hash roll), told in the realm\'s news', () => {
        let hit = null;
        for (let i = 0; i < 60 && !hit; i++) {
            const w = makeWorld();
            const winner = { id: 'incumbent', name: 'King Bors' };
            const loser = { id: 'rival', name: 'Prince Udo', character: { firstName: 'Udo' } };
            const text = Maiming.onCrisisResolved(w.world, { id: `crisis_${i}`, kingdomId: 1, kingdomName: 'Varn', claimants: [winner, loser] }, winner);
            if (text) hit = { text, loser, events: w.world.events };
        }
        expect(hit).toBeTruthy();
        expect(MaimMarks.barsRule(hit.loser.character)).toBeTruthy();
        expect(hit.events.length).toBe(1);
    });

    it('an enemy at its worst has a grown child of yours maimed, once in years', () => {
        const w = makeWorld();
        const player = makePlayer({ house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: { 2: { kingdomId: 2, name: 'House Grey', feud: 95 } } } });
        player.children = [{ id: 'c1', firstName: 'Edmund', dynasty: 'Voss', gender: 'male', age: 22, isAlive: true }];
        const notices = [];
        for (let d = 1001; d <= 1001 + 7 * 600; d += 7) { w.world.day = d; notices.push(...Maiming.processDay(w.world, player).notices); }
        expect(notices.length).toBeGreaterThan(0);
        expect(notices.length).toBeLessThanOrEqual(5);
        expect(MaimMarks.any(player.children[0])).toBe(true);
    });
});

describe('Maiming — the player before a court that keeps the old law', () => {
    it('convicted of theft: the hand on the scaffold, out of the cells, the stump, the chronicle', async () => {
        const { Gossip } = await import('../systems/gossip.js');
        const Y = 120;
        const person = (id, first, last, role = 'villager', extra = {}) => ({ id, first, last, gender: 'male', born: 100 - 40 * Y, role, traits: [], parents: [], kids: [], spouse: null, log: [], ...extra });
        const folk = { q: 4, r: 4, annals: [], people: [person(1, 'Ella', 'Cobb', 'villager', { gender: 'female' }), person(2, 'Tom', 'Reed', 'farmer'), person(3, 'Hugh', 'Marlow', 'noble'), person(5, 'Wat', 'Tyler', 'merchant')] };
        const ashford = { name: 'Ashford', type: 'town', q: 4, r: 4, population: 1200, kingdom: 'k1', economy: { gold: 500 }, folk, happiness: 60 };
        const k1 = { id: 'k1', name: 'Valdor', ruler: 'Aldric', isAlive: true, capital: { q: 9, r: 9 }, treasury: 1000, territory: [], laws: { punishment: 'standard', mutilation: 'old' }, lord: { name: 'Aldric', kingdomId: 'k1', traits: [], memory: [] } };
        const w = {
            day: 100, generationParams: { seed: 7 }, units: [], kingdoms: [k1], width: 40,
            getTile: (q, r) => (q === 4 && r === 4 ? { q, r, settlement: ashford } : { q, r }),
            getKingdom: id => (id === 'k1' ? k1 : null), getSettlementViews: () => [ashford],
        };
        const p = { name: 'Ash', q: 4, r: 4, gold: 500, karma: 0, renown: 10, reputation: {}, charisma: 5, strength: 5, skills: { combat: 5 }, inventory: {}, house: { name: 'House Ash', generation: 1, prestige: 50, history: [] } };
        Gossip.initializePlayer(p);
        p.gossip.rumors.push({ id: p.gossip.nextRumorId++, type: 'theft', perpetrator: p.name, victim: { name: 'Wat Tyler', type: 'merchant' }, locationQ: 4, locationR: 4, locationName: 'Ashford', kingdom: 'k1', dayCreated: 92, credibility: 0.75, severity: 20, witnessCount: 2, witnessNames: ['Ella Cobb', 'Tom Reed'], spreadTo: ['4,4'], consequencesApplied: {}, expired: false });
        p.jailState = { daysRemaining: 3, totalDays: 3, offense: 'theft', offenseNumber: 1, settlement: 'Ashford', q: 4, r: 4, bailCost: 30 };
        Trials.processDay(w, p);
        expect(p.trials.trial).toBeTruthy();
        Trials.plead(p, w, 'guilty');
        const res = Trials.resolveTrial(p, w);
        expect(res.outcome).toBe('maimed');
        expect(res.act).toBe('hand');
        expect(res.text).toMatch(/your hand/);
        expect(MaimMarks.count(p, 'hand')).toBe(1);
        expect(p.jailState).toBe(null);
        expect(Ailments.has(p, 'fresh_stump')).toBe(true);
    });
});
