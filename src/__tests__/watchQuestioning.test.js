/**
 * Questioned by the watch (systems/watchQuestioning.js): the town's case from
 * rumours, memories and vanishings; when a guard stops the player; the plain
 * answers; the free talk's verdict clamped by the evidence.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WatchQuestioning } from '../systems/watchQuestioning.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { Gossip } from '../systems/gossip.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => { vi.restoreAllMocks(); NpcBrain.enable(false); });

const KEY = '4,4';

function makeWorld(extra = {}) {
    const town = { name: 'Ashford', type: 'town', q: 4, r: 4, population: 1200, kingdom: null, economy: { gold: 500 }, folk: { people: [] }, ...(extra.town || {}) };
    return {
        day: 100, season: 'Spring', year: 900, generationParams: { seed: 7 }, kingdoms: [], units: [], town,
        dawn: !!extra.dawn,
        getTile: (q, r) => (q === 4 && r === 4 ? { q, r, settlement: town } : null),
        getSettlementViews: () => [town],
    };
}

function makePlayer(extra = {}) {
    return { name: 'Ash', q: 4, r: 4, gold: 500, karma: 0, renown: 10, reputation: {}, charisma: 5, skills: {}, inventory: {}, ...extra };
}

/** A crime rumour that has reached the town. */
function rumour(player, fields = {}) {
    Gossip.initializePlayer(player);
    const rm = {
        id: player.gossip.nextRumorId++, type: 'theft', perpetrator: player.name, victim: { name: 'Mara Cobb', type: 'villager' },
        locationQ: 4, locationR: 4, locationName: 'Ashford', kingdom: null, dayCreated: 90, credibility: 0.75, severity: 25 * 0.75,
        witnessCount: 2, witnessNames: ['Ella', 'Tom'], spreadTo: [KEY], consequencesApplied: {}, expired: false, ...fields,
    };
    player.gossip.rumors.push(rm);
    return rm;
}

describe('where there is a watch', () => {
    it('a town keeps one; a hamlet, a small place and the Dawn of Man do not', () => {
        const w = makeWorld();
        expect(WatchQuestioning.hasWatch(w, w.town)).toBe(true);
        expect(WatchQuestioning.hasWatch(w, { ...w.town, type: 'hamlet' })).toBe(false);
        expect(WatchQuestioning.hasWatch(w, { ...w.town, population: 120 })).toBe(false);
        const dawn = makeWorld({ dawn: true });
        expect(WatchQuestioning.hasWatch(dawn, dawn.town)).toBe(false);
    });
});

describe('the case', () => {
    it('reads the proof from the evidence: witnesses, hearsay, a planted tale, caught in the act, a confession', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p); // two witnesses, 10 days old
        rumour(p, { type: 'assault', victim: { name: 'Wat' }, witnessCount: 0, witnessNames: [], credibility: 0.45 });
        rumour(p, { type: 'slander', victim: { name: 'Rival Joss' }, witnessCount: 0, byRival: 'r1', credibility: 0.6 });
        rumour(p, { type: 'theft', victim: { name: 'Old Hob' }, witnessCount: 3, credibility: 0.95, dayCreated: 98 });
        rumour(p, { type: 'murder', victim: { name: 'Ned' }, witnessCount: 0, credibility: 0.75, confessed: true });
        const byVictim = Object.fromEntries(WatchQuestioning.charges(p, w, w.town, KEY).map(c => [c.victim, c]));
        expect(byVictim['Mara Cobb'].proof).toBe(2);
        expect(byVictim.Wat.proof).toBe(1);
        expect(byVictim['Rival Joss'].proof).toBe(0);
        expect(byVictim['Old Hob'].proof).toBe(3);
        expect(byVictim.Ned.proof).toBe(2);
        expect(byVictim.Ned.source).toBe('confession');
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        expect(kase.proof).toBe(3);
        expect(kase.grave).toBe(true);
        expect(kase.suspicion).toBeGreaterThan(25);
    });

    it('skips talk, deeds, pardoned rumours and rumours that never reached the town', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p, { type: 'boast', talk: true });
        rumour(p, { type: 'feast_given', deed: true });
        rumour(p, { spreadTo: ['9,9'] });
        rumour(p, { expired: true });
        expect(WatchQuestioning.charges(p, w, w.town, KEY)).toHaveLength(0);
    });

    it('reads what the townsfolk remember: the robbed caught them at it, kin speak for the beaten', () => {
        const w = makeWorld(), p = makePlayer();
        w.town.folk.people.push(
            { id: 1, first: 'Mara', last: 'Cobb', nm: [{ k: 'robbed', w: -8, d: 98, by: 'Ash' }] },
            { id: 2, first: 'Jon', last: 'Reed', gender: 'male', nm: [{ k: 'assaulted', w: -14, d: 80, by: 'Ash', vr: 'brother', vn: 'Wat Reed' }] },
            { id: 3, first: 'Old', last: 'Bess', nm: [{ k: 'assaulted', w: -14, d: 80, by: 'Ash', g: 1 }] }, // handed down: no testimony
            { id: 4, first: 'Kit', nm: [{ k: 'gift', w: 4, d: 90, by: 'Ash' }] },
        );
        const cs = WatchQuestioning.charges(p, w, w.town, KEY);
        expect(cs).toHaveLength(2);
        const robbed = cs.find(c => c.group === 'theft');
        expect(robbed.proof).toBe(3);
        expect(robbed.source).toBe('victim');
        const kin = cs.find(c => c.group === 'assault');
        expect(kin.source).toBe('kin');
        expect(kin.victim).toBe('Wat Reed');
        expect(kin.proof).toBe(2);
    });

    it('the same deed told as a rumour and remembered is one charge, at its strongest proof', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p, { victim: { name: 'Mara Cobb' }, dayCreated: 97, witnessCount: 1, credibility: 0.5 });
        w.town.folk.people.push({ id: 1, first: 'Mara', last: 'Cobb', nm: [{ k: 'robbed', w: -8, d: 98, by: 'Ash' }] });
        const cs = WatchQuestioning.charges(p, w, w.town, KEY);
        expect(cs).toHaveLength(1);
        expect(cs[0].proof).toBe(3);
        expect(cs[0].ids).toHaveLength(2);
    });

    it('a companion from here who never came home is hearsay; grief is not held against you', () => {
        const w = makeWorld(), p = makePlayer();
        p.vanishings = { next: 3, list: [
            { id: 1, d: 60, name: 'Bran', q: 4, r: 4, s: 1.2, tier: 'foul' },
            { id: 2, d: 60, name: 'Lia', q: 4, r: 4, s: 0.2, tier: 'grief' },
        ] };
        const cs = WatchQuestioning.charges(p, w, w.town, KEY);
        expect(cs).toHaveLength(1);
        expect(cs[0]).toMatchObject({ group: 'vanished', victim: 'Bran', proof: 1 });
        expect(cs[0].weight).toBeCloseTo(18);
    });
});

describe('the stop', () => {
    it('stops only past the threshold, with a watch, off cooldown and with no open incident', () => {
        const w = makeWorld(), p = makePlayer();
        expect(WatchQuestioning.shouldStop(p, w, w.town).reason).toBe('not enough');
        rumour(p); rumour(p, { type: 'assault', victim: { name: 'Wat' }, severity: 40 });
        const res = WatchQuestioning.shouldStop(p, w, w.town, { force: true });
        expect(res.stop).toBe(true);
        expect(res.case.suspicion).toBeGreaterThanOrEqual(25);
        WatchQuestioning.noteStop(p, w, res.case);
        expect(WatchQuestioning.shouldStop(p, w, w.town, { force: true }).reason).toBe('cooldown');
        const dawn = makeWorld({ dawn: true });
        expect(WatchQuestioning.shouldStop(makePlayer({ gossip: p.gossip }), dawn, dawn.town, { force: true }).reason).toBe('no watch');
        const q = makePlayer({ gossip: p.gossip, streetCrime: { nextId: 2, incidents: [{ id: 1, k: 'assault', key: KEY, d: 99, witnessed: true, answered: false, victim: 'Wat' }] } });
        expect(WatchQuestioning.shouldStop(q, w, w.town, { force: true }).reason).toBe('open incident');
    });

    it('the day\'s roll is a hash: the same town and day give the same answer', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p); rumour(p, { type: 'assault', victim: { name: 'Wat' }, severity: 40 });
        const a = WatchQuestioning.shouldStop(p, w, w.town);
        const b = WatchQuestioning.shouldStop(p, w, w.town);
        expect(a.stop).toBe(b.stop);
        expect(a.chance).toBeGreaterThan(0.3);
    });
});

describe('the verdict is held to the evidence', () => {
    const kase = (proof, extra = {}) => ({ key: KEY, proof, grave: false, suspicion: 40, charges: [{ group: 'theft', proof }], ...extra });

    it('caught in the act: never cleared or let off', () => {
        expect(WatchQuestioning.clampVerdict(kase(3), { credible: 9 }, 'cleared')).toBe('fine');
        expect(WatchQuestioning.clampVerdict(kase(3, { grave: true, charges: [{ group: 'murder', proof: 3 }] }), { credible: 9 }, 'suspicious')).toBe('arrest');
    });

    it('talk alone: no arrest, no fine', () => {
        expect(WatchQuestioning.clampVerdict(kase(0), { lies: 2 }, 'arrest')).toBe('suspicious');
        expect(WatchQuestioning.clampVerdict(kase(0), { credible: 2 }, 'fine')).toBe('cleared');
    });

    it('hearsay: an arrest only past the line, a fine only after a lie', () => {
        expect(WatchQuestioning.clampVerdict(kase(1), {}, 'arrest')).toBe('suspicious');
        expect(WatchQuestioning.clampVerdict(kase(1), { lies: 1 }, 'arrest')).toBe('fine');
        expect(WatchQuestioning.clampVerdict(kase(1, { suspicion: 80 }), {}, 'arrest')).toBe('arrest');
        expect(WatchQuestioning.clampVerdict(kase(1), {}, 'fine')).toBe('suspicious');
    });

    it('testimony: cleared only by a credible, honest account', () => {
        expect(WatchQuestioning.clampVerdict(kase(2), { credible: 1 }, 'cleared')).toBe('suspicious');
        expect(WatchQuestioning.clampVerdict(kase(2), { credible: 3, lies: 1 }, 'cleared')).toBe('suspicious');
        expect(WatchQuestioning.clampVerdict(kase(2), { credible: 4 }, 'cleared')).toBe('cleared');
        expect(WatchQuestioning.clampVerdict(kase(2), {}, 'arrest')).toBe('fine');
    });
});

describe('the plain answers (the AI brain off)', () => {
    it('owning up to a witnessed theft is a fine, paid to the town, and the matter closed', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const out = WatchQuestioning.answer(p, w, kase, 'plain', { settlement: w.town });
        expect(out.outcome).toBe('fine');
        expect(out.fine).toBeGreaterThan(0);
        expect(p.gold).toBe(500 - out.fine);
        expect(w.town.economy.gold).toBeGreaterThan(500);
        expect(WatchQuestioning.charges(p, w, w.town, KEY)).toHaveLength(0);
    });

    it('a killing seen by witnesses is the cells, however it is answered', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p, { type: 'murder', victim: { name: 'Ned' }, severity: 60 });
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const out = WatchQuestioning.answer(p, w, kase, 'plain', { settlement: w.town });
        expect(out.outcome).toBe('arrest');
        expect(p.jailState).toBeTruthy();
        expect(p.jailState.daysRemaining).toBeGreaterThan(10);
    });

    it('a denial with nothing but hearsay can clear you; caught lying raises suspicion', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p, { witnessCount: 0, witnessNames: [], credibility: 0.85, severity: 50 });
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        expect(WatchQuestioning.answer(p, w, kase, 'deny', {}).outcome).toBe('cleared');
        expect(WatchQuestioning.charges(p, w, w.town, KEY)).toHaveLength(0);

        const p2 = makePlayer();
        rumour(p2, { witnessCount: 0, witnessNames: [], credibility: 0.85, severity: 50 });
        const k2 = WatchQuestioning.caseAt(p2, w, w.town, KEY);
        const before = k2.suspicion;
        Utils.random.mockReturnValue(0.99);
        const out = WatchQuestioning.answer(p2, w, k2, 'deny', {});
        expect(['suspicious', 'fine', 'arrest']).toContain(out.outcome);
        expect(WatchQuestioning.caseAt(p2, w, w.town, KEY).suspicion).toBeGreaterThan(before);
    });

    it('a bribe taken goes to the guard\'s purse; one refused is reported', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const guard = { name: 'Sgt. Hale', _person: { purse: 3, traits: [] } };
        const cost = WatchQuestioning.bribeCost(p, w, kase);
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const out = WatchQuestioning.answer(p, w, kase, 'bribe', { guard });
        expect(out.outcome).toBe('bribed');
        expect(p.gold).toBe(500 - cost);
        expect(guard._person.purse).toBe(3 + cost);
        expect(WatchQuestioning.charges(p, w, w.town, KEY)).toHaveLength(0);

        const p2 = makePlayer();
        rumour(p2);
        const k2 = WatchQuestioning.caseAt(p2, w, w.town, KEY);
        Utils.random.mockReturnValue(0.99);
        const no = WatchQuestioning.answer(p2, w, k2, 'bribe', { guard });
        expect(no.outcome).toBe('bribe_refused');
        expect(p2.gold).toBe(500);
        expect(WatchQuestioning.caseAt(p2, w, w.town, KEY).suspicion).toBeGreaterThan(k2.suspicion - 1);
    });

    it('an honest guard is harder to buy', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        expect(WatchQuestioning.bribeChance(p, kase, { traits: ['honest'] })).toBeLessThan(WatchQuestioning.bribeChance(p, kase, { traits: ['greedy'] }));
    });

    it('running and getting away puts a bounty on you in the realm', () => {
        const w = makeWorld({ town: { kingdom: 'k1' } }), p = makePlayer();
        rumour(p, { kingdom: 'k1' });
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const out = WatchQuestioning.answer(p, w, kase, 'run', {});
        expect(out.outcome).toBe('fled');
        expect(out.bounty).toBeGreaterThan(0);
        expect(Gossip.bountyTotalForKingdom(p, 'k1')).toBe(out.bounty);
    });

    it('the choices show odds, and a bribe the purse can\'t cover is barred', () => {
        const w = makeWorld(), p = makePlayer({ gold: 1 });
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const opts = WatchQuestioning.options(p, w, kase);
        expect(opts.map(o => o.id)).toEqual(['plain', 'deny', 'bribe', 'run', 'silent']);
        expect(opts.find(o => o.id === 'bribe').can).toBe(false);
        expect(opts.find(o => o.id === 'deny').chance).toBeGreaterThan(0);
    });
});

describe('questioned in free talk (the AI brain on)', () => {
    const reply = (obj) => ({ ok: true, text: JSON.stringify(obj) });

    it('the guard\'s sheet names the charges and the evidence', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Sgt. Hale', gender: 'male' });
        const text = WatchQuestioning.persona(p, w, talk);
        expect(text).toContain('Sgt. Hale');
        expect(text).toContain('theft from Mara Cobb');
        expect(text).toMatch(/testimony: Ella, Tom/);
        expect(text).toMatch(/witnesses/);
    });

    it('a guard who would clear a thief caught in the act is overruled by the evidence', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue(reply({ say: 'Fine, off you go.', judge: { credible: 3, lied: false, refused: false }, verdict: { fn: 'verdict', outcome: 'cleared' } }));
        const w = makeWorld(), p = makePlayer();
        rumour(p, { witnessCount: 3, credibility: 0.95, dayCreated: 99 });
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        expect(kase.proof).toBe(3);
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Hale' });
        const res = await WatchQuestioning.say(p, w, talk, 'I was only looking at the goods.', { settlement: w.town });
        expect(res.ok).toBe(true);
        expect(res.result.outcome).toBe('fine');
        expect(p.gold).toBeLessThan(500);
    });

    it('a guard who would arrest on talk alone lets them go with a warning', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue(reply({ say: 'To the cells with you!', judge: { credible: -1, lied: true, refused: false }, verdict: { fn: 'verdict', outcome: 'arrest' } }));
        const w = makeWorld(), p = makePlayer();
        rumour(p, { type: 'slander', byRival: 'r1', witnessCount: 0, severity: 50 });
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        expect(kase.proof).toBe(0);
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Hale' });
        const res = await WatchQuestioning.say(p, w, talk, 'That rival of mine is a liar.', {});
        expect(res.result.outcome).toBe('suspicious');
        expect(p.jailState).toBeFalsy();
        // (a lie needs a fact to contradict: none counted on talk alone)
        expect(talk.lies).toBe(0);
    });

    it('credible answers ease the suspicion; the guard keeps asking until they decide', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue(reply({ say: 'Go on.', judge: { credible: 2, lied: false, refused: false }, verdict: { fn: 'verdict', outcome: 'continue' } }));
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const before = kase.suspicion;
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Hale' });
        const res = await WatchQuestioning.say(p, w, talk, 'I was at the mill all that day; ask the miller.', {});
        expect(res.result).toBeUndefined();
        expect(kase.suspicion).toBe(before - 8);
        expect(talk.credible).toBe(2);
    });

    it('a bribe is taken only when the coin was really offered, and enough of it', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const chat = vi.spyOn(LlmClient, 'chat');
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const cost = WatchQuestioning.bribeCost(p, w, kase);
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Hale' });
        chat.mockResolvedValueOnce(reply({ say: '*pockets nothing*', judge: { credible: 0, lied: false, refused: false, bribe_offered: 0 }, verdict: { fn: 'verdict', outcome: 'continue', bribe_accepted: true } }));
        const a = await WatchQuestioning.say(p, w, talk, 'Lovely weather.', {});
        expect(a.result).toBeUndefined();
        expect(p.gold).toBe(500);
        chat.mockResolvedValueOnce(reply({ say: '*the coin vanishes*', judge: { credible: 0, lied: false, refused: false, bribe_offered: cost }, verdict: { fn: 'verdict', outcome: 'continue', bribe_accepted: true } }));
        const b = await WatchQuestioning.say(p, w, talk, `Here, ${cost} gold for your trouble.`, {});
        expect(b.result.outcome).toBe('bribed');
        expect(p.gold).toBe(500 - cost);
    });

    it('walking off without a word is refusing to answer', () => {
        const w = makeWorld(), p = makePlayer();
        rumour(p);
        const kase = WatchQuestioning.caseAt(p, w, w.town, KEY);
        const before = kase.suspicion;
        const talk = WatchQuestioning.startTalk(p, w, kase, { name: 'Hale' });
        const out = WatchQuestioning.conclude(p, w, talk, {});
        expect(out.outcome).toBe('suspicious');
        expect(WatchQuestioning.caseAt(p, w, w.town, KEY).suspicion).toBe(before + 12);
    });
});
