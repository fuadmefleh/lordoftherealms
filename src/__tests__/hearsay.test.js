/**
 * Hearsay (systems/hearsay.js): townsfolk remember what the player told them
 * in free talk (digests read back into the character sheet and the canned
 * greeting), a sworn word is held as a promise, claims and boasts spread
 * through a town and on to the next (growing in the telling), and telling two
 * people two different tales gets you caught out.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { NpcChat } from '../systems/npcChat.js';
import { NpcChatImpact } from '../systems/npcChatImpact.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { Hearsay } from '../systems/hearsay.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
afterEach(() => { vi.restoreAllMocks(); NpcBrain.enable(false); });

const person = (id, first, last, extra = {}) => ({
    id, first, last, gender: 'male', born: -30 * 120, died: null, role: 'farmer', traits: [],
    spouse: null, parents: [], kids: [], away: null, log: [], ...extra,
});

/** Two towns three hexes apart (Riptide at 3,3 with Brom and Wat; Fenmoor at 6,3 with Ola). */
function world2() {
    const mkTown = (name, q, r, people) => {
        const folk = { v: 1, q, r, n: 5, people, annals: [] };
        return { name, type: 'town', kingdom: 1, q, r, folk };
    };
    const rip = mkTown('Riptide', 3, 3, [person(1, 'Brom', 'Reed'), person(4, 'Wat', 'Cole')]);
    const fen = mkTown('Fenmoor', 6, 3, [person(7, 'Ola', 'Marsh', { gender: 'female' })]);
    const towns = { '3,3': rip, '6,3': fen };
    const kingdom = { id: 1, name: 'Varland', ruler: 'King Oswin', isAlive: true, wars: [], lord: { traits: [], age: 40 }, treasury: 500 };
    const world = {
        day: 20, season: 'Spring', year: 853, width: 40, height: 40, units: [],
        kingdoms: [kingdom],
        getKingdom: (id) => (id === 1 ? kingdom : null),
        getSettlementViews: () => [{ q: 3, r: 3, name: 'Riptide', kingdom: 1 }, { q: 6, r: 3, name: 'Fenmoor', kingdom: 1 }],
        getTile: (q, r) => (towns[`${q},${r}`] ? { q, r, settlement: towns[`${q},${r}`] } : null),
    };
    return { world, rip, fen };
}

function townNpc(player, s, p, role = 'farmer') {
    const npc = { name: `${p.first} ${p.last}`, firstName: p.first, type: role, uid: `${s.q},${s.r}#${p.id}`, gender: p.gender, age: 30 };
    Object.defineProperty(npc, '_person', { value: p });
    Object.defineProperty(npc, '_folk', { value: s.folk });
    Object.defineProperty(npc, '_dialogMemory', { get() { return p.mem; }, set(v) { p.mem = v; }, configurable: true });
    return { npc, who: NpcChat.townSubject(player, npc, { place: s.name, worldContext: 'A quiet day.' }) };
}

const newPlayer = () => ({ name: 'Ash Vale', q: 3, r: 3, relationships: {}, gold: 40, actionPoints: 5, army: [], inventory: {}, reputation: {}, karma: 0, renown: 0 });

/** One turn of free talk with a canned reply; the hook is the real one in NpcChat.say. */
async function talk(player, world, who, session, text, reply = '{"say":"Is that so?","feeling":{"change":0,"why":"nothing much"},"actions":[]}') {
    NpcBrain.enable(true);
    vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
    const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: reply });
    const res = await NpcChat.say(player, world, who, session, text);
    return { res, chat };
}

describe('reading the player\'s words', () => {
    it('finds claims, boasts, confessions and promises', () => {
        const got = Hearsay.extract('My name is Bran and I am a knight. I slew a bear in the hills! I promise to bring you wine.');
        const by = Object.fromEntries(got.map(f => [f.topic, f]));
        expect(by.name.value).toBe('bran');
        expect(by.rank.value).toBe('knight');
        expect(by.deed.kind).toBe('boast');
        expect(by.deed.value).toMatch(/^slew a bear/);
        expect(by.promise.value).toMatch(/bring you wine/);
        expect(Hearsay.extract('I stole a horse from the lord.').find(f => f.kind === 'confession')).toBeTruthy();
        expect(Hearsay.extract('Nice weather today.')).toEqual([]);
    });

    it('knows a lie about a name, a rank or a purse', () => {
        const p = newPlayer();
        expect(Hearsay.truthOf(p, 'name', 'bran')).toBe(false);
        expect(Hearsay.truthOf(p, 'name', 'ash')).toBe(true);
        expect(Hearsay.truthOf(p, 'rank', 'king')).toBe(false);
        expect(Hearsay.truthOf(p, 'wealth', 'rich')).toBe(false);
        expect(Hearsay.truthOf(p, 'origin', 'the south')).toBe(null);
    });
});

describe('a talk is remembered', () => {
    it('keeps a digest and reads it back into their character sheet next time', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { who } = townNpc(p, rip, rip.folk.people[0]);
        const s1 = NpcChat.startSession(p, world, who);
        const { res } = await talk(p, world, who, s1, 'I am a merchant, and I slew a wolf with my bare hands.', '{"say":"A wolf! Bare hands?","feeling":{"change":1,"why":"impressed but doubtful"},"actions":[]}');
        expect(res.ok).toBe(true);
        expect(res.notes.some(n => /will remember what you said/.test(n.text))).toBe(true);
        const rec = p.hearsay.npcs[who.key];
        expect(rec.talks[0].items.map(i => i.k)).toEqual(['claim', 'boast']);
        expect(rec.talks[0].felt).toBe('impressed but doubtful');
        // Twelve days on, a new talk: the sheet remembers
        world.day = 32;
        const s2 = NpcChat.startSession(p, world, who);
        const sheet = NpcChat.persona(p, world, who, s2);
        expect(sheet).toMatch(/You spoke with them 12 days ago in Riptide: said they are a merchant; boasted they slew a wolf/);
        expect(sheet).toMatch(/you felt: impressed but doubtful/);
    });

    it('a sworn word is held as a promise even when the model forgets to call it', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { who } = townNpc(p, rip, rip.folk.people[0]);
        await talk(p, world, who, NpcChat.startSession(p, world, who), 'I swear I will bring you a sack of flour.');
        const open = NpcChatImpact.promisesTo(p, who.key);
        expect(open.length).toBe(1);
        expect(open[0].text).toMatch(/bring you a sack of flour/);
        // Broken: the day passes, and it is talked of in their town
        world.day = open[0].due + 1;
        NpcChatImpact.processDay(world, p);
        Hearsay.processDay(world, p);
        expect(p.hearsay.rumours.some(r => r.k === 'broken_promise' && r.o === '3,3')).toBe(true);
    });

    it('the canned dialog greets from memory without the AI brain', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { npc, who } = townNpc(p, rip, rip.folk.people[0]);
        await talk(p, world, who, NpcChat.startSession(p, world, who), 'I am a merchant from the south.');
        NpcBrain.enable(false);
        world.day = 25;
        expect(Hearsay.greetLine(p, world, npc, '3,3')).toMatch(/Last time you told me you're a merchant/);
    });
});

describe('talk travels', () => {
    it('spreads through the town and on to the next, growing in the telling', async () => {
        const p = newPlayer(); const { world, rip, fen } = world2();
        const { who } = townNpc(p, rip, rip.folk.people[0]);
        await talk(p, world, who, NpcChat.startSession(p, world, who), 'I slew the dragon of the north.');
        const r = p.hearsay.rumours.find(x => x.k === 'boast');
        expect(r.towns['3,3'].r).toBeCloseTo(Hearsay.config().spread.startReach);
        for (let d = 21; d < 80 && !r.towns['6,3']; d++) { world.day = d; Hearsay.processDay(world, p); }
        expect(r.towns['3,3'].r).toBeGreaterThan(0.45);
        expect(r.towns['6,3']).toBeTruthy();
        // Ola in Fenmoor may have heard it; with full reach, she has
        r.towns['6,3'].r = 1;
        const { npc: olaNpc, who: ola } = townNpc(p, fen, fen.folk.people[0]);
        p.q = 6; p.r = 3;
        const sheet = NpcChat.persona(p, world, ola, NpcChat.startSession(p, world, ola));
        expect(sheet).toMatch(/WHAT FOLK SAY OF THEM/);
        expect(sheet).toMatch(/dragon/);
        expect(Hearsay.greetLine(p, world, olaNpc, '6,3')).toMatch(/dragon/);
        // The panel lists it
        const v = Hearsay.view(p, world, '6,3');
        expect(v.here.length).toBe(1);
        expect(v.town).toBe('Fenmoor');
    });

    it('is deterministic: same world, same days, same spread', async () => {
        const run = async () => {
            const p = newPlayer(); const { world, rip } = world2();
            const { who } = townNpc(p, rip, rip.folk.people[0]);
            await talk(p, world, who, NpcChat.startSession(p, world, who), 'I am a knight.');
            for (let d = 21; d < 60; d++) { world.day = d; Hearsay.processDay(world, p); }
            vi.restoreAllMocks();
            return JSON.stringify(p.hearsay.rumours);
        };
        expect(await run()).toBe(await run());
    });

    it('caught out: a different tale to someone who has heard the first', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { who: brom } = townNpc(p, rip, rip.folk.people[0]);
        const { npc: watNpc, who: wat } = townNpc(p, rip, rip.folk.people[1]);
        await talk(p, world, brom, NpcChat.startSession(p, world, brom), 'My name is Bran.');
        // The whole town has heard what Bran-who-isn't told Brom
        p.hearsay.rumours.find(r => r.tp === 'name').towns['3,3'].r = 1;
        const before = wat.regard();
        const { res } = await talk(p, world, wat, NpcChat.startSession(p, world, wat), 'They call me Wulf.');
        expect(res.notes.some(n => /has heard you told Brom Reed otherwise/.test(n.text))).toBe(true);
        expect(wat.regard()).toBeLessThan(before);
        expect(p.hearsay.rumours.some(r => r.k === 'contradiction')).toBe(true);
        expect(p.hearsay.stats.caught).toBe(1);
        expect(NpcChat.persona(p, world, wat, NpcChat.startSession(p, world, wat))).toMatch(/You caught them out/);
        expect(Hearsay.greetLine(p, world, watNpc, '3,3')).toMatch(/Which is it\?/);
        // The same name again is no contradiction
        const { res: again } = await talk(p, world, brom, NpcChat.startSession(p, world, brom), 'As I said, my name is Bran.');
        expect(again.notes.some(n => /otherwise/.test(n.text))).toBe(false);
    });

    it('a threat in the canned dialog is talked of too', () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { npc } = townNpc(p, rip, rip.folk.people[0]);
        Hearsay.noteThreat(p, world, npc, '3,3');
        const r = p.hearsay.rumours[0];
        expect(r.k).toBe('threat');
        expect(Hearsay.telling(r, '3,3', 'Ash')).toMatch(/Ash threatened Brom Reed/);
    });

    it('the reply schema is untouched (constant across NPCs and calls)', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { who } = townNpc(p, rip, rip.folk.people[0]);
        const { chat } = await talk(p, world, who, NpcChat.startSession(p, world, who), 'My name is Bran.');
        expect(JSON.stringify(chat.mock.calls[0][1].schema)).toBe(JSON.stringify(NpcChat.replySchema()));
    });

    it('survives a save (plain JSON) and prunes old talks', async () => {
        const p = newPlayer(); const { world, rip } = world2();
        const { who } = townNpc(p, rip, rip.folk.people[0]);
        await talk(p, world, who, NpcChat.startSession(p, world, who), 'I am a sailor.');
        const copy = JSON.parse(JSON.stringify(Hearsay.serialize(p)));
        expect(copy.npcs[who.key].talks.length).toBe(1);
        world.day = 20 + Hearsay.config().digests.forgetDays + 7 - ((20 + Hearsay.config().digests.forgetDays + 7) % 7);
        Hearsay.processDay(world, p);
        expect(p.hearsay.npcs[who.key]).toBeUndefined();
    });
});
