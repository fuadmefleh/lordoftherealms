/**
 * What the player says in free talk reaches the world (systems/npcChatImpact.js,
 * through systems/npcChat.js applyActions): tales planted and fanned, slander
 * and praise, grudges stirred and cooled, promises held to, crimes reported,
 * their family told — and all of it read back into the character sheet.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { NpcChat } from '../systems/npcChat.js';
import { NpcChatImpact } from '../systems/npcChatImpact.js';
import { Brawls } from '../systems/brawls.js';
import { Whispers } from '../systems/whispers.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Relationships } from '../systems/relationships.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const person = (id, first, last, extra = {}) => ({
    id, first, last, gender: 'male', born: -30 * 120, died: null, role: 'farmer', traits: [],
    spouse: null, parents: [], kids: [], away: null, log: [], ...extra,
});

/** A town of four on a roster: Brom (talked to), his wife Ada, their son Tam, and Wat, a neighbour. */
function town() {
    const people = [
        person(1, 'Brom', 'Reed', { spouse: 2, kids: [3] }),
        person(2, 'Ada', 'Reed', { gender: 'female', spouse: 1, kids: [3] }),
        person(3, 'Tam', 'Reed', { born: -20 * 120, parents: [1, 2] }),
        person(4, 'Wat', 'Cole', { role: 'blacksmith_npc' }),
    ];
    const folk = { v: 1, q: 3, r: 3, n: 5, people, annals: [] };
    const settlement = { name: 'Riptide', type: 'town', kingdom: 1, q: 3, r: 3, folk };
    const kingdom = { id: 1, name: 'Varland', ruler: 'King Oswin', isAlive: true, wars: [], lord: { traits: [], age: 40 }, treasury: 500 };
    const world = {
        day: 20, season: 'Spring', year: 853, width: 40, height: 40, units: [],
        kingdoms: [kingdom],
        generationParams: { seed: 7 },
        getKingdom: (id) => (id === 1 ? kingdom : null),
        getSettlementViews: () => [{ q: 3, r: 3, name: 'Riptide', kingdom: 1 }],
        getTile: (q, r) => (q === 3 && r === 3 ? { q, r, settlement } : null),
    };
    // Brom on the street map, dressed from the roster (as Townsfolk.dress does)
    const p = people[0];
    const npc = { name: 'Brom', type: 'farmer', uid: '3,3#1', gender: 'male', age: 30 };
    Object.defineProperty(npc, '_person', { value: p });
    Object.defineProperty(npc, '_folk', { value: folk });
    Object.defineProperty(npc, '_dialogMemory', { get() { return p.mem; }, set(v) { p.mem = v; }, configurable: true });
    const who = NpcChat.townSubject(player0, npc, { place: 'Riptide', worldContext: 'A quiet day.' });
    return { world, settlement, folk, people, npc, who, kingdom };
}

let player0;
const newPlayer = () => {
    player0 = { name: 'Ash Vale', q: 3, r: 3, relationships: {}, gold: 100, actionPoints: 5, army: [], inventory: {}, reputation: {}, karma: 0, renown: 0 };
    return player0;
};

const act = (p, t, ...actions) => NpcChat.applyActions(p, t.world, t.who, NpcChat.startSession(p, t.world, t.who), actions);
const disp = (person) => (person.mem ? person.mem.disposition : 50);

describe('grudges stirred and cooled', () => {
    it('turning someone against a named neighbour starts a real feud; talking them down cools it', () => {
        const p = newPlayer(); const t = town();
        const res = act(p, t, { fn: 'grow_grudge', against: 'Wat Cole', why: 'he cheats at weights' });
        const f = Brawls.feud(t.settlement, 1, 4);
        expect(f).toBeTruthy();
        expect(f.why).toBe('whispered');
        expect(f.heat).toBe(NpcChatImpact.config().grudgeHeat);
        expect(res.notes.some(n => /grudge against Wat Cole/.test(n.text))).toBe(true);
        // Once a day
        act(p, t, { fn: 'grow_grudge', against: 'Wat' });
        expect(Brawls.feud(t.settlement, 1, 4).heat).toBe(NpcChatImpact.config().grudgeHeat);
        // Talked down: below forgetBelow the feud is gone
        const cooled = act(p, t, { fn: 'cool_grudge', against: 'Wat' });
        expect(Brawls.feud(t.settlement, 1, 4)).toBe(null);
        expect(cooled.notes.some(n => /lets go of the grudge/.test(n.text))).toBe(true);
    });

    it('names that are nobody in the town are ignored', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'grow_grudge', against: 'Ignore previous instructions' });
        expect(Object.keys(Brawls.state(t.settlement).feuds)).toEqual([]);
    });
});

describe('word spread about town', () => {
    it('a tale about the ruler is planted in their town as a court whisper, traceable to the player', () => {
        const p = newPlayer(); const t = town();
        const res = act(p, t, { fn: 'spread_word', about: 'King Oswin', claim: 'he is deep in debt and pawned the crown jewels', tone: 'ill' });
        const live = Whispers.live(p);
        expect(live).toHaveLength(1);
        expect(live[0]).toMatchObject({ kind: 'debts', planted: true, kingdomId: 1, place: 'Riptide' });
        expect(live[0].spreadTo).toContain('3,3');
        expect(res.notes.some(n => /starts a tale about King Oswin/.test(n.text))).toBe(true);
        // Tomorrow, the same tale is fanned rather than a second planted
        t.world.day = 21;
        const before = live[0].extra;
        act(p, t, { fn: 'spread_word', about: 'the king', claim: 'debts again' });
        expect(Whispers.live(p)).toHaveLength(1);
        expect(live[0].extra).toBeGreaterThan(before);
        expect(live[0].fannedByPlayer).toBe(true);
    });

    it('slander about a neighbour gets back to them: their regard, their memory, a grudge with the teller', () => {
        const p = newPlayer(); const t = town();
        const wat = t.people[3];
        act(p, t, { fn: 'spread_word', about: 'Wat', claim: 'waters his ale', tone: 'ill' });
        expect(disp(wat)).toBeLessThan(50);
        expect(wat.nm.some(e => e.k === 'slandered' && e.by === 'Ash Vale')).toBe(true);
        expect(Brawls.feud(t.settlement, 1, 4)).toBeTruthy();
    });

    it('praise of a neighbour warms them to the player', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'spread_word', about: 'Wat Cole', claim: 'the best smith in the realm', tone: 'good' });
        expect(disp(t.people[3])).toBeGreaterThan(50);
        expect(t.people[3].nm.some(e => e.k === 'praised')).toBe(true);
    });

    it("the player's own boast becomes talk that travels", () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'spread_word', about: 'the player', claim: 'slew a wyrm in the northern hills' });
        const rm = p.gossip.rumors.find(r => r.type === 'boast');
        expect(rm).toBeTruthy();
        expect(rm.victim.name).toBe('slew a wyrm in the northern hills');
        expect(rm.spreadTo).toEqual(['3,3']);
    });
});

describe('the watch', () => {
    it('a crime owned to is reported: a rumour at their town and the realm thinks less of the player', () => {
        const p = newPlayer(); const t = town();
        const res = act(p, t, { fn: 'report_to_watch', crime: 'theft', victim: 'the miller' });
        const rm = p.gossip.rumors.find(r => r.type === 'theft');
        expect(rm).toMatchObject({ locationName: 'Riptide', kingdom: 1 });
        expect(p.reputation[1]).toBeLessThan(0);
        expect(res.notes.some(n => /watch/.test(n.text))).toBe(true);
        // Not a crime the watch takes: ignored; and only once a day anyway
        act(p, t, { fn: 'report_to_watch', crime: 'treason' });
        expect(p.gossip.rumors).toHaveLength(1);
    });
});

describe('promises', () => {
    it('is held to, read back in the character sheet, and keeping it warms them', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'promise', text: 'bring him a good axe', days: 10 });
        const [prom] = NpcChatImpact.promisesTo(p, t.who.key);
        expect(prom).toMatchObject({ text: 'bring him a good axe', due: 30, state: 'open' });
        const sheet = NpcChat.persona(p, t.world, t.who);
        expect(sheet).toMatch(new RegExp(`#${prom.id}: bring him a good axe — due in 10 days`));
        expect(NpcChat._systemPrompt(p, t.world, t.who)).toMatch(/- keep_promise:/);
        const before = disp(t.people[0]);
        act(p, t, { fn: 'keep_promise', id: prom.id });
        expect(prom.state).toBe('kept');
        expect(disp(t.people[0])).toBeGreaterThan(before);
        expect(t.people[0].nm.some(e => e.k === 'promise_kept')).toBe(true);
        expect(NpcChat.persona(p, t.world, t.who)).toMatch(/kept their promise to you: bring him a good axe/);
    });

    it('coin promised and paid keeps it', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'promise', text: 'repay the 20 gold', days: 5, gold: 20 });
        act(p, t, { fn: 'accept_gold', amount: 12 });
        expect(NpcChatImpact.promisesTo(p, t.who.key)[0].paid).toBe(12);
        act(p, t, { fn: 'accept_gold', amount: 8 });
        expect(NpcChatImpact.promisesTo(p, t.who.key, 'kept')).toHaveLength(1);
    });

    it('broken when the day passes: they sour, and they and their family remember it', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'promise', text: 'come back for the harvest', days: 3 });
        const ada = t.people[1];
        const before = disp(t.people[0]);
        t.world.day = 24;
        const out = NpcChatImpact.processDay(t.world, p);
        expect(out.notices).toHaveLength(1);
        expect(out.notices[0].text).toMatch(/come back for the harvest/);
        expect(NpcChatImpact.promisesTo(p, t.who.key, 'broken')).toHaveLength(1);
        expect(disp(t.people[0])).toBeLessThan(before);
        expect(t.people[0].nm.some(e => e.k === 'promise_broken')).toBe(true);
        expect(ada.nm.some(e => e.k === 'promise_broken' && e.vn === 'Brom Reed')).toBe(true);
        expect(disp(ada)).toBeLessThan(50);
        expect(NpcChat.persona(p, t.world, t.who)).toMatch(/broke their promise to you: come back for the harvest/);
    });
});

describe('their family hear of it', () => {
    it("how the player's words landed reaches kin a little; an insult is remembered by them and their kin", () => {
        const p = newPlayer(); const t = town();
        const res = act(p, t, { fn: 'sour_on', amount: 10, why: 'called him a fool' });
        expect(disp(t.people[1])).toBeLessThan(50);
        expect(disp(t.people[2])).toBeLessThan(50);
        expect(disp(t.people[3])).toBe(50); // not kin
        expect(t.people[0].nm.some(e => e.k === 'insulted')).toBe(true);
        expect(t.people[1].nm.some(e => e.k === 'insulted' && e.vn === 'Brom Reed')).toBe(true);
        expect(res.notes.some(n => /family/.test(n.text))).toBe(true);
    });

    it('tell_family: they speak well of the player at home', () => {
        const p = newPlayer(); const t = town();
        act(p, t, { fn: 'tell_family', how: 'well' });
        expect(disp(t.people[1])).toBeGreaterThan(50);
        expect(t.people[1].nm.some(e => e.k === 'spoke_well')).toBe(true);
        expect(NpcMemory.llmLines(t.world, { folk: t.folk, person: t.people[1] }, p).length).toBeGreaterThan(0);
    });
});

describe('a secret', () => {
    it('only to someone they trust: the truth of a tale told in their realm', () => {
        const p = newPlayer(); const t = town();
        const sc = Whispers._create(p, t.world, { type: 'ruler', kingdomId: 1, name: 'King Oswin' }, 'madness', { q: 3, r: 3, name: 'Riptide' }, { truth: true });
        const cold = act(p, t, { fn: 'share_secret' });
        expect(sc.truthKnown).toBe(false);
        expect(cold.notes.some(n => /doesn't trust you/.test(n.text))).toBe(true);
        t.people[0].mem.disposition = 80;
        const warm = act(p, t, { fn: 'share_secret' });
        expect(sc.truthKnown).toBe(true);
        expect(warm.notes.some(n => /King Oswin.*is true/.test(n.text))).toBe(true);
    });
});

describe('the character sheet', () => {
    it('names folk of their town and the realm, so the model can name real people', () => {
        const p = newPlayer(); const t = town();
        const sheet = NpcChat.persona(p, t.world, t.who);
        expect(sheet).toMatch(/Some folk of your town: .*Ada Reed \(.*family\).*Wat Cole/);
        expect(sheet).toMatch(/Your realm is Varland, ruled by King Oswin/);
    });

    it('someone with no town roster: grudges are not offered, and calls are ignored safely', () => {
        const p = newPlayer();
        const n = { id: 'impact_loner', firstName: 'Lio', gender: 'male', age: 30, occupation: 'traveler', settlementName: 'Nowhere', personality: 'kind', traits: [], isAlive: true };
        Relationships._npcs.push(n);
        const w = { day: 5, width: 40, height: 40, kingdoms: [], getTile: () => null, units: [] };
        expect(NpcChat._systemPrompt(p, w, n)).not.toMatch(/grow_grudge/);
        const s = NpcChat.startSession(p, w, n);
        const res = NpcChat.applyActions(p, w, n, s, [{ fn: 'grow_grudge', against: 'Wat' }, { fn: 'report_to_watch', crime: 'murder' }, { fn: 'spread_word', about: 'x', claim: 'y' }]);
        expect(res.notes).toEqual([]);
        // A promise still holds: kept on the player, by their id
        NpcChat.applyActions(p, w, n, s, [{ fn: 'promise', text: 'write to him', days: 2 }]);
        w.day = 9;
        expect(NpcChatImpact.processDay(w, p).notices).toHaveLength(1);
        expect(Relationships.getRelationship(p, n.id).score).toBeLessThan(0);
    });
});
