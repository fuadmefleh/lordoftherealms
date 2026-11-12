/**
 * Free-form talk with townsfolk (systems/npcChat.js): the character sheet,
 * the model's reply parsed, and its actions applied within the limits.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { NpcChat } from '../systems/npcChat.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { Relationships } from '../systems/relationships.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const world = () => ({ day: 12, season: 'Spring', year: 853, width: 40, height: 40, getTile: () => null, units: [], kingdoms: [] });
/** A world with their town in it: what they carry comes out of its market (systems/townTrade.js consign). */
const townWorld = () => {
    const town = { name: 'Riptide', type: 'town', q: 3, r: 3, population: 1500, economy: { gold: 1000 } };
    SettlementMarket.ensure(town);
    return { ...world(), town, getSettlementViews: () => [town], getTile: (q, r) => (q === 3 && r === 3 ? { q, r, settlement: town } : null) };
};
const player = () => ({ name: 'Ash', q: 1, r: 1, relationships: {}, gold: 100, actionPoints: 5, army: [], inventory: {} });

let _n = 0;
function npc(extra = {}) {
    const n = {
        id: `chat_${++_n}`, firstName: 'Hadrian', dynasty: 'Lionmane', gender: 'male', age: 23,
        occupation: 'shepherd', settlementName: 'Riptide', personality: 'ambitious',
        traits: ['practical', 'humorous'], attraction: 60, isAlive: true, ...extra,
    };
    Relationships._npcs.push(n);
    return n;
}

afterEach(() => { vi.restoreAllMocks(); NpcBrain.enable(false); });

describe('who they are', () => {
    it('a character sheet with their manner, nature, quirks, a want, and how they regard you', () => {
        const p = player(), w = world(), n = npc();
        const text = NpcChat.persona(p, w, n);
        expect(text).toContain('Hadrian Lionmane');
        expect(text).toContain('shepherd in Riptide');
        expect(text).toMatch(/Your manner: driven and calculating/);
        expect(text).toMatch(/practical \(down to earth/);
        expect(text).toMatch(/Your habits of speech:/);
        expect(text).toMatch(/On your mind lately:/);
        expect(text).toMatch(/How you regard them:/);
    });

    it('keeps the same quirks for the same person, and differs between people', () => {
        const a = npc(), b = npc();
        expect(NpcChat.voiceOf(a).quirks).toEqual(NpcChat.voiceOf(a).quirks);
        const differs = Array.from({ length: 6 }, () => npc()).some(x => NpcChat.voiceOf(x).quirks.join() !== NpcChat.voiceOf(a).quirks.join());
        expect(differs).toBe(true);
        expect(NpcChat.voiceOf(b).quirks.length).toBeGreaterThan(0);
    });
});

describe('the reply', () => {
    it('parses JSON, JSON in prose, and plain speech', () => {
        expect(NpcChat.parseReply('{"say":"Aye.","actions":[{"fn":"warm_to","amount":2}]}')).toMatchObject({ say: 'Aye.', actions: [{ fn: 'warm_to', amount: 2 }] });
        expect(NpcChat.parseReply('Sure: {"say":"Well met."}').say).toBe('Well met.');
        expect(NpcChat.parseReply('Just words.').say).toBe('Just words.');
        expect(NpcChat.parseReply('')).toBe(null);
    });
});

describe('what they do', () => {
    it('warms and sours within the per-turn and per-day caps', () => {
        const p = player(), w = world(), n = npc();
        const s = NpcChat.startSession(p, w, n);
        NpcChat.applyActions(p, w, n, s, [{ fn: 'warm_to', amount: 50 }]);
        const L = NpcChat.config().limits;
        expect(Relationships.getRelationship(p, n.id).score).toBe(L.warmPerTurn);
        for (let i = 0; i < 10; i++) NpcChat.applyActions(p, w, n, s, [{ fn: 'warm_to', amount: 4 }]);
        expect(Relationships.getRelationship(p, n.id).score).toBe(L.warmPerDay);
        NpcChat.applyActions(p, w, n, s, [{ fn: 'sour_on', amount: 99 }]);
        expect(Relationships.getRelationship(p, n.id).score).toBe(L.warmPerDay - L.sourPerTurn);
    });

    it('feels attraction only if they could; remembers; walks off', () => {
        const p = player(), w = world();
        const cold = npc({ attraction: 5 });
        const s1 = NpcChat.startSession(p, w, cold);
        NpcChat.applyActions(p, w, cold, s1, [{ fn: 'feel_attraction', amount: 4 }]);
        expect(Relationships.getRelationship(p, cold.id).affection).toBe(0);
        const warm = npc({ attraction: 70 });
        const s2 = NpcChat.startSession(p, w, warm);
        const out = NpcChat.applyActions(p, w, warm, s2, [
            { fn: 'feel_attraction', amount: 3 },
            { fn: 'remember', fact: 'Ash promised to bring wool from the north.' },
            { fn: 'remember', fact: 'Ash promised to bring wool from the north.' },
            { fn: 'end_conversation', why: 'the flock' },
        ]);
        const rel = Relationships.getRelationship(p, warm.id);
        expect(rel.affection).toBe(3);
        expect(rel.romantic).toBe(true);
        expect(rel.memories).toHaveLength(1);
        expect(out.ended).toBe(true);
        // ...and the memory is in their sheet next time
        expect(NpcChat.persona(p, w, warm)).toContain('Ash promised to bring wool');
    });

    it('a full exchange: the model is asked in JSON with the sheet, and the day\'s messages are counted', async () => {
        const p = player(), w = world(), n = npc();
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"say":"*squints* Wool, is it? Depends who\'s asking.","actions":[{"fn":"warm_to","amount":1,"why":"curious"}]}' });
        const s = NpcChat.startSession(p, w, n);
        const res = await NpcChat.say(p, w, n, s, 'Do you sell wool?');
        expect(res.ok).toBe(true);
        expect(res.say).toMatch(/Depends who/);
        expect(res.notes[0].text).toMatch(/Relationship \+1/);
        expect(chat.mock.calls[0][1].json).toBe(true);
        expect(chat.mock.calls[0][0][0].content).toContain('Hadrian');
        expect(chat.mock.calls[0][0].at(-1)).toEqual({ role: 'user', content: 'Do you sell wool?' });
        expect(s.lines).toHaveLength(2);
        const left = NpcChat.canTalk(p, w, n).left;
        expect(left).toBe(NpcChat.config().limits.messagesPerDay - 1);
    });

    it('refuses without the AI brain, and when they have talked enough today', async () => {
        const p = player(), w = world(), n = npc();
        expect(NpcChat.canTalk(p, w, n).ok).toBe(false);
        NpcBrain.enable(true);
        Relationships.getRelationship(p, n.id).chat = { day: w.day, messages: 999, warm: 0, sour: 0, attr: 0 };
        expect(NpcChat.canTalk(p, w, n).ok).toBe(false);
        const res = await NpcChat.say(p, w, n, NpcChat.startSession(p, w, n), 'hello');
        expect(res.ok).toBe(false);
    });
});

describe('the folk of the town map (townSubject)', () => {
    it('talks from their dialog memory: goodwill on its 0-100 scale, memories kept there, no romance or road', () => {
        const p = player(), w = world();
        const folk = { uid: 'f1', name: 'Wren Hayward', type: 'villager', roleTitle: 'Townswoman', gender: 'female', age: 28 };
        const who = NpcChat.townSubject(p, folk, { place: 'Riptide', worldContext: 'The harvest was thin.' });
        const sheet = NpcChat.persona(p, w, who);
        expect(sheet).toContain('Wren Hayward');
        expect(sheet).toContain('Townswoman in Riptide');
        expect(sheet).toContain('The harvest was thin.');
        expect(NpcChat._systemPrompt(p, w, who)).not.toContain('feel_attraction');
        expect(NpcChat._systemPrompt(p, w, who)).not.toContain('agree_to_travel');
        const s = NpcChat.startSession(p, w, who);
        const before = folk._dialogMemory.disposition;
        NpcChat.applyActions(p, w, who, s, [
            { fn: 'warm_to', amount: 3 }, { fn: 'remember', fact: 'They asked after my brother.' },
            { fn: 'feel_attraction', amount: 4 }, { fn: 'agree_to_travel' },
        ]);
        expect(folk._dialogMemory.disposition).toBeGreaterThan(before);
        expect(folk._dialogMemory.memories).toHaveLength(1);
        expect(NpcChat.persona(p, w, who)).toContain('asked after my brother');
    });
});

describe('what is said makes things happen', () => {
    it('the feeling of a turn is the regard change: a rude demand costs goodwill even when they go along', () => {
        const r = NpcChat.parseReply('{"say":"*sighs* Fine. Take it.","feeling":{"change":-6,"why":"ordered about"},"actions":[{"fn":"warm_to","amount":3},{"fn":"give_item","item":"bread","qty":1}]}');
        expect(r.feeling.change).toBe(-6);
        expect(r.actions.map(a => a.fn)).toEqual(['sour_on', 'give_item']);
    });

    it('give_item hands over what they carry, and it is gone from their stock; only what they have', () => {
        const p = player(), w = townWorld();
        const bread0 = SettlementMarket.stock(w.town, 'bread');
        const baker = npc({ occupation: 'baker' });
        const s = NpcChat.startSession(p, w, baker);
        const sheet = NpcChat.persona(p, w, baker);
        expect(sheet).toMatch(/WHAT YOU HAVE WITH YOU.*bread x\d/);
        const out = NpcChat.applyActions(p, w, baker, s, [{ fn: 'give_item', item: 'bread', qty: 1 }, { fn: 'give_item', item: 'dragon_scale', qty: 1 }]);
        expect(p.inventory.bread).toBe(1);
        expect(out.notes[0].text).toMatch(/gives you 1 Bread/);
        expect(out.notes[1].text).toMatch(/hasn't any/);
        expect(p.inventory.dragon_scale).toBeUndefined();
        const rel = Relationships.getRelationship(p, baker.id);
        expect(rel.stock.items.bread.qty).toBe(NpcChat.config().carries.baker.bread - 1);
        // (what they carried came out of Riptide's market: real goods, not conjured)
        expect(SettlementMarket.stock(w.town, 'bread')).toBeCloseTo(bread0 - NpcChat.config().carries.baker.bread, 6);
    });

    it('sell_item takes a fair price at least, accept_gold and give_gold move coin within limits', () => {
        const p = player(), w = townWorld();
        const baker = npc({ occupation: 'baker', purse: 50 });
        const town0 = w.town.economy.gold;
        const s = NpcChat.startSession(p, w, baker);
        NpcChat.applyActions(p, w, baker, s, [{ fn: 'sell_item', item: 'bread', qty: 2, price: 0 }]);
        expect(p.inventory.bread).toBe(2);
        expect(p.gold).toBeLessThan(100);
        // (the coin for the town's goods went to the town)
        expect(w.town.economy.gold).toBeCloseTo(town0 + (100 - p.gold), 6);
        const g0 = p.gold;
        NpcChat.applyActions(p, w, baker, s, [{ fn: 'accept_gold', amount: 5 }, { fn: 'give_gold', amount: 999 }]);
        expect(p.gold).toBe(g0 - 5 + NpcChat.config().limits.coinPerDay);
        // (out of their own purse, and the coin given them into it)
        expect(baker.purse).toBe(50 + 5 - NpcChat.config().limits.coinPerDay);
    });
});

