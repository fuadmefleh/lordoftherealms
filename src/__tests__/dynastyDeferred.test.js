// The dynasty plan's deferred items: the House's tables in data/house.json
// (defaults identical, overrides kept), the broader Prestige sources, the
// rival heads' validated proposal menus (errands and plots), per-NPC memory in
// the local model's prompts, the connection status/hints and streamed lines.
// The LLM is never contacted: LlmClient / fetch are mocked throughout.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { House } from '../systems/house.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { Achievements } from '../systems/achievements.js';
import { PlayerReligion } from '../player/playerReligion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOUSE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/house.json'), 'utf8'));
const realFetch = globalThis.fetch;

afterEach(() => {
    DataLoader._gamedata = null;
    delete DataLoader.house;
    House.resetBrain();
    NpcBrain._reset();
    LlmClient._reset();
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
});

const withData = () => { DataLoader._gamedata = { house: HOUSE_JSON }; };
const strip = (a) => ({
    id: a.id, tier: a.tier || 1, name: a.name, blurb: a.blurb,
    milestones: a.milestones.map(m => ({ id: m.id, label: m.label })),
    capstone: { id: a.capstone.id, label: a.capstone.label },
});

describe('the House tables live in data/house.json', () => {
    it('the data tables equal the code defaults, so nothing changes when data loads', () => {
        const before = { c: House._getConfig(), s: House._getSources(), k: House._getSinks(), r: House.roleDefs() };
        const amb = House.ambitions().map(a => House._getAmbitionDef(a.id)).map(strip);
        withData();
        expect(House._getConfig()).toEqual(before.c);
        expect(House._getSources()).toEqual(before.s);
        expect(House._getSinks()).toEqual(before.k);
        expect(House.roleDefs()).toEqual(before.r);
        expect(House.ambitions().filter(a => a.tier === 1).map(a => strip(House._getAmbitionDef(a.id)))).toEqual(amb);
    });

    it('tier-1 milestones compile from req maps and test as before', () => {
        withData();
        const faith = House._getAmbitionDef('faith_eternal');
        expect(faith.capstone.test({ followers: 5000, temples: 5 })).toBe(true);
        expect(faith.capstone.test({ followers: 4999, temples: 5 })).toBe(false);
        const seat = House._getAmbitionDef('seat_of_power');
        expect(seat.milestones[0].test({ hasTitle: true })).toBe(true);
        expect(seat.milestones[0].test({ hasTitle: false })).toBe(false);
        // The code fallback compiles the same way without data
        DataLoader._gamedata = null;
        expect(House._getAmbitionDef('faith_eternal').capstone.test({ followers: 5000, temples: 5 })).toBe(true);
    });

    it('data overrides the defaults, and DataLoader.house overrides both', () => {
        DataLoader._gamedata = { house: { ...HOUSE_JSON, config: { ...HOUSE_JSON.config, idleWindow: 120 }, sources: { quest: 7 } } };
        expect(House._getConfig().idleWindow).toBe(120);
        expect(House._getSources().quest).toBe(7);
        expect(House._getSources().battleWon).toBe(4); // the rest kept
        DataLoader.house = { config: { idleWindow: 30 } };
        expect(House._getConfig().idleWindow).toBe(30);
    });
});

describe('broader Prestige sources', () => {
    const player = () => {
        const p = { id: 'p', lastName: 'Vale', karma: 50, faith: 1, gold: 5000, skills: {}, renown: 0 };
        House.initialize(p, { day: 1 });
        return p;
    };

    it('scales deeds by kind; an unlisted kind scales 1 and a plague 0', () => {
        expect(House.deedScale('miracle', 'plague')).toBe(0);
        expect(House.deedScale('miracle', 'healing')).toBe(1);
        expect(House.deedScale('achievement', 'gold')).toBe(4);
        expect(House.deedScale('festivalHosted', 'grand')).toBe(2.5);
        expect(House.deedScale('nope', 'x')).toBe(1);
    });

    it('founding a faith earns the House Prestige and a chronicle line', () => {
        const p = player();
        const r = PlayerReligion.foundReligion(p, 'The Dawn', ['Peace', 'Charity', 'Wisdom'], { day: 9 });
        expect(r.success).toBe(true);
        expect(r.prestige).toBe(15);
        expect(p.house.prestige).toBe(15);
        expect(p.house.lastNotableDay).toBe(9);
        expect(p.house.history.some(h => /The Dawn/.test(h.text))).toBe(true);
    });

    it('raising a temple earns Prestige; a shrine does not', () => {
        const p = player();
        PlayerReligion.foundReligion(p, 'The Dawn', null, { day: 1 });
        const tile = (q) => ({ q, r: 0, terrain: { passable: true } });
        const shrine = PlayerReligion.buildReligiousBuilding(p, 'shrine', tile(1), { day: 2 });
        const temple = PlayerReligion.buildReligiousBuilding(p, 'temple', tile(2), { day: 3 });
        expect(shrine.success && temple.success).toBe(true);
        expect(shrine.prestige).toBe(0);
        expect(temple.prestige).toBe(4);
    });

    it('a reforged artifact earns Prestige', () => {
        const p = player();
        const art = { id: 'test_blade', name: 'Test Blade', icon: '🗡️', fragmentsRequired: 2, reforgeRewards: {} };
        vi.spyOn(LegendaryArtifacts, '_getDefinitions').mockReturnValue([art]);
        LegendaryArtifacts.initialize(p);
        p.artifacts.fragments[art.id] = art.fragmentsRequired;
        const r = LegendaryArtifacts.reforgeArtifact(p, art.id, { day: 4 });
        expect(r.success).toBe(true);
        expect(r.prestige).toBe(10);
        expect(p.house.history.some(h => /Test Blade/.test(h.text))).toBe(true);
    });

    it('an achievement earns Prestige by its tier', () => {
        const p = player();
        const saved = Achievements.ACHIEVEMENTS;
        Achievements.ACHIEVEMENTS = { test_gold: { name: 'Test', tier: 'gold', check: () => true } };
        try {
            const got = Achievements.checkAchievements(p, { day: 5 });
            expect(got).toHaveLength(1);
            expect(p.house.prestige).toBe(8); // 2 × gold 4
            Achievements.checkAchievements(p, { day: 6 });
            expect(p.house.prestige).toBe(8); // once only
        } finally {
            Achievements.ACHIEVEMENTS = saved;
        }
    });
});

describe('rival heads choose from a validated menu', () => {
    const rival = () => ({
        kingdomId: 'k1', name: 'House Stone', feud: 70, gold: 900, events: [], memory: [],
        head: { firstName: 'Aldric', gender: 'male', traits: ['proud'], age: 40 },
    });
    const SCORES = { trade: 2, court: 3, shadow: 0, invest: 0, waylay: 0, home: 1 };
    // The pick as RivalHouses._choose made it before the brain seam
    const oldPick = (roll) => {
        const order = ['trade', 'court', 'shadow', 'invest', 'waylay', 'home'];
        const total = order.reduce((a, k) => a + Math.max(0, SCORES[k]), 0);
        let x = roll * total;
        for (const k of order) { x -= Math.max(0, SCORES[k]); if (x < 0) return k; }
        return 'home';
    };

    it('the default brain picks exactly as the engine always did (same draw, same result)', () => {
        vi.spyOn(RivalHouses, '_scores').mockReturnValue({ scores: { ...SCORES }, trade: null, estate: null });
        for (let seed = 1; seed <= 40; seed++) {
            Utils.setSeed(seed);
            const expected = oldPick(Utils.random());
            Utils.setSeed(seed);
            expect(RivalHouses._choose(null, { day: 10 }, rival(), { q: 0, r: 0 }).kind).toBe(expected);
        }
    });

    it('an enabled LLM brain falls back to the deterministic pick, then serves a validated proposal', async () => {
        vi.spyOn(RivalHouses, '_scores').mockReturnValue({ scores: { ...SCORES }, trade: null, estate: null });
        NpcBrain.enable(true);
        House.setBrain(NpcBrain.asHouseBrain());
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"choice": "home"}' });
        const r = rival();
        Utils.setSeed(3);
        const expected = oldPick(Utils.random());
        Utils.setSeed(3);
        expect(RivalHouses._choose(null, { day: 10 }, r, { q: 0, r: 0 }).kind).toBe(expected); // cold: the engine's own pick
        await NpcBrain._flush();
        // The prompt carried only the menu the engine can carry out
        const prompt = chat.mock.calls[0][0].map(m => m.content).join('\n');
        expect(prompt).toMatch(/- trade/);
        expect(prompt).toMatch(/- court/);
        expect(prompt).not.toMatch(/- shadow/);
        Utils.setSeed(3);
        expect(RivalHouses._choose(null, { day: 10 }, r, { q: 0, r: 0 }).kind).toBe('home');
    });

    it('an off-menu proposal is thrown away', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"choice": "shadow"}' });
        const brain = NpcBrain.asHouseBrain();
        const ctx = { rival: rival(), options: [{ id: 'trade', worth: 1 }, { id: 'home', worth: 1 }], fallback: 'trade' };
        expect(brain.chooseErrand(ctx)).toBe('trade');
        await NpcBrain._flush();
        expect(NpcBrain._cacheSize()).toBe(0);
        expect(brain.chooseErrand(ctx)).toBe('trade');
    });

    it('a plot pick gets the deterministic choice as its fallback and passes memories to the prompt', async () => {
        NpcBrain.enable(true);
        House.setBrain(NpcBrain.asHouseBrain());
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: 'slander' });
        const ctx = { rival: rival(), options: ['slander', 'arson', 'assassin'], roll: 0.5, memories: () => ['your insult before the crowd'] };
        expect(House._brain.chooseScheme(ctx)).toBe('arson'); // the default: floor(0.5 × 3) = 1
        await NpcBrain._flush();
        expect(chat.mock.calls[0][0][1].content).toMatch(/your insult before the crowd/);
        expect(House._brain.chooseScheme(ctx)).toBe('slander');
    });

    it('the menu stays shut while the brain is off', () => {
        const spy = vi.spyOn(LlmClient, 'isAvailable');
        const brain = NpcBrain.asHouseBrain();
        expect(brain.chooseErrand({ options: [{ id: 'trade' }, { id: 'home' }], fallback: 'home' })).toBe('home');
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('NPC lines: memory and streaming', () => {
    it('what the NPC remembers goes into the prompt and the cache key', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: 'You again.' });
        const npc = { id: 'lord1', firstName: 'Aldric' };
        await NpcBrain.generateNpcLine(npc, { topic: 'a greeting', memories: ['the oath you renounced — you remember it bitterly'] });
        expect(chat.mock.calls[0][0][1].content).toMatch(/oath you renounced/);
        // A new memory, a new line (not the cached one)
        await NpcBrain.generateNpcLine(npc, { topic: 'a greeting', memories: ['a purse of gold you gave'] });
        expect(chat).toHaveBeenCalledTimes(2);
        await NpcBrain.generateNpcLine(npc, { topic: 'a greeting', memories: ['a purse of gold you gave'] });
        expect(chat).toHaveBeenCalledTimes(2);
    });

    it('streams a line through onPartial, hiding a reasoning block', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chatStream').mockImplementation(async (msgs, opts, onDelta) => {
            for (const s of ['<thi', '<think>hm', '<think>hm</think>Well', '<think>hm</think>Well met.']) onDelta(s);
            return { ok: true, text: '<think>hm</think>Well met.', streamed: true };
        });
        const parts = [];
        const line = await NpcBrain.generateNpcLine({ id: 'n' }, { topic: 'a greeting', fallback: 'Hello.', onPartial: p => parts.push(p) });
        expect(parts).toEqual(['Well', 'Well met.']);
        expect(line).toBe('Well met.');
    });

    it('falls back to the template when the stream fails', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chatStream').mockResolvedValue({ ok: false, reason: 'network error' });
        expect(await NpcBrain.generateNpcLine({ id: 'n' }, { fallback: 'Hello.', onPartial: () => {} })).toBe('Hello.');
    });
});

describe('LlmClient streaming and health probe', () => {
    const sse = (events) => {
        const enc = new TextEncoder();
        const body = events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
        // split mid-line to exercise the buffer
        const chunks = [body.slice(0, 17), body.slice(17, 60), body.slice(60)];
        let i = 0;
        return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }), cancel: () => {} }) };
    };

    it('chatStream reads server-sent deltas', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            headers: { get: () => 'text/event-stream' },
            body: sse([{ choices: [{ delta: { content: 'Well' } }] }, { choices: [{ delta: { content: ' met, ' } }] }, { choices: [{ delta: { content: 'friend.' } }] }, '[DONE]']),
        }));
        const seen = [];
        const res = await LlmClient.chatStream([{ role: 'user', content: 'hi' }], {}, t => seen.push(t));
        expect(res).toMatchObject({ ok: true, text: 'Well met, friend.', streamed: true });
        expect(seen[seen.length - 1]).toBe('Well met, friend.');
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).stream).toBe(true);
    });

    it('chatStream reads a whole answer when the server does not stream', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: ' Hail. ' } }] }) }));
        const res = await LlmClient.chatStream([{ role: 'user', content: 'hi' }], {}, () => {});
        expect(res).toEqual({ ok: true, text: 'Hail.', streamed: false });
    });

    it('chatStream never throws', async () => {
        globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await LlmClient.chatStream([{ role: 'user', content: 'x' }])).toEqual({ ok: false, reason: 'network error' });
    });

    it('probe tells a loading server from an unreachable one', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
        expect(await LlmClient.probe()).toMatchObject({ ok: false, state: 'loading' });
        globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await LlmClient.probe()).toMatchObject({ ok: false, state: 'unreachable' });
        expect(LlmClient.lastProbe().state).toBe('unreachable');
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        expect(await LlmClient.probe()).toMatchObject({ ok: true, state: 'ready' });
    });

    it('testConnection explains a failure with a hint; status() reads without a network call', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
        const r = await NpcBrain.testConnection({ endpoint: 'http://127.0.0.1:8080' });
        expect(r).toMatchObject({ ok: false, stage: 'health', state: 'loading' });
        expect(r.hint).toMatch(/loading the model/);
        globalThis.fetch = vi.fn();
        expect(NpcBrain.status().state).toBe('off');
        NpcBrain.enable(true);
        expect(NpcBrain.status().state).toBe('loading');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
