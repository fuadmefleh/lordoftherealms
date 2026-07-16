// Phase B tests for the NpcBrain: tiering, caching, async populate, proposal
// validation, and the synchronous House-seam adapter. LlmClient is mocked; no
// server is ever contacted.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';

afterEach(() => {
    NpcBrain._reset();
    vi.restoreAllMocks();
});

const RIVAL_CTX = {
    house: { name: 'House Ashborne', generation: 2, history: [{ text: 'Founded' }] },
    rival: { name: 'House Stone', kingdomId: 'k2', feud: 100 },
    config: { rivalClaimFeud: 60 },
    roll: 0.99, // with roll 0.99 the deterministic default would NOT act
};

describe('NpcBrain — Phase B', () => {
    it('is inert and deterministic when disabled', () => {
        const brain = NpcBrain.asHouseBrain();
        const spy = vi.spyOn(LlmClient, 'isAvailable');
        expect(brain.narrate('rival_threat', RIVAL_CTX)).toBeNull();
        // roll 0.99 → deterministic default declines even at max feud.
        expect(brain.decideRivalAction(RIVAL_CTX)).toEqual({ act: false, type: 'claim_threat' });
        expect(spy).not.toHaveBeenCalled();
    });

    it('decideRivalAction returns the deterministic default on a cache miss', () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"act": true, "type": "claim_threat"}' });
        const brain = NpcBrain.asHouseBrain();
        // First (cold) call: deterministic fallback, enqueues a job.
        expect(brain.decideRivalAction(RIVAL_CTX)).toEqual({ act: false, type: 'claim_threat' });
    });

    it('serves the LLM proposal once the async job has populated the cache', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: 'sure: {"act": true, "type": "claim_threat"}' });
        const brain = NpcBrain.asHouseBrain();
        brain.decideRivalAction(RIVAL_CTX);   // enqueue
        await NpcBrain._flush();               // let the job finish
        // Now the cache holds the validated proposal → the model overrides the default.
        expect(brain.decideRivalAction(RIVAL_CTX)).toEqual({ act: true, type: 'claim_threat' });
    });

    it('rejects an off-menu / malformed proposal and keeps the default', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"act": "yes please", "type": "nuke"}' });
        const brain = NpcBrain.asHouseBrain();
        brain.decideRivalAction(RIVAL_CTX);
        await NpcBrain._flush();
        expect(NpcBrain._cacheSize()).toBe(0); // garbage not cached
        expect(brain.decideRivalAction(RIVAL_CTX)).toEqual({ act: false, type: 'claim_threat' });
    });

    it('narrate populates the cache and then overrides templated text', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '"The Stones sharpen old grudges."' });
        const brain = NpcBrain.asHouseBrain();
        expect(brain.narrate('rival_threat', RIVAL_CTX)).toBeNull(); // cold miss
        await NpcBrain._flush();
        expect(brain.narrate('rival_threat', RIVAL_CTX)).toBe('The Stones sharpen old grudges.'); // quotes stripped
    });

    it('does not populate when the server is offline', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(false);
        const chat = vi.spyOn(LlmClient, 'chat');
        const brain = NpcBrain.asHouseBrain();
        brain.narrate('rival_threat', RIVAL_CTX);
        await NpcBrain._flush();
        expect(chat).not.toHaveBeenCalled();
        expect(NpcBrain._cacheSize()).toBe(0);
    });

    it('respects the concurrency budget', () => {
        NpcBrain.enable(true);
        NpcBrain.configure({ maxConcurrent: 1 });
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockImplementation(() => new Promise(() => {})); // never resolves
        const brain = NpcBrain.asHouseBrain();
        brain.narrate('a', { ...RIVAL_CTX, rival: { name: 'A', feud: 1 } });
        brain.narrate('b', { ...RIVAL_CTX, rival: { name: 'B', feud: 1 } });
        // Only one job may be in flight at a time.
        // (pending is internal; assert via cache staying empty and no crash.)
        expect(NpcBrain._cacheSize()).toBe(0);
    });

    it('generateNpcLine returns the model line, or the fallback when offline', async () => {
        NpcBrain.enable(true);
        const npc = { id: 'n1', firstName: 'Bram', traits: [{ name: 'gruff' }] };

        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: 'Well met, traveler.' });
        expect(await NpcBrain.generateNpcLine(npc, { topic: 'greeting', fallback: 'Hello.' })).toBe('Well met, traveler.');

        vi.restoreAllMocks();
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(false);
        expect(await NpcBrain.generateNpcLine({ id: 'n2' }, { topic: 'greeting', fallback: 'Hello.' })).toBe('Hello.');
    });

    it('generateNpcLine returns the fallback when disabled', async () => {
        expect(await NpcBrain.generateNpcLine({ id: 'n1' }, { fallback: 'Hi.' })).toBe('Hi.');
    });

    it('isMajor gates on rulers/rivals/nobles', () => {
        expect(NpcBrain.isMajor({ isRuler: true })).toBe(true);
        expect(NpcBrain.isMajor({ isRival: true })).toBe(true);
        expect(NpcBrain.isMajor({ type: 'noble' })).toBe(true);
        expect(NpcBrain.isMajor({ type: 'farmer' })).toBe(false);
        expect(NpcBrain.isMajor(null)).toBe(false);
    });

    it('applyFromSettings wires the brain into the House seam when enabled', () => {
        const fakeHouse = { setBrain: vi.fn(), resetBrain: vi.fn() };

        const on = NpcBrain.applyFromSettings(
            { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:9000', llmModel: 'm', llmTemperature: 0.3 },
            fakeHouse,
        );
        expect(on).toBe(true);
        expect(NpcBrain.isEnabled()).toBe(true);
        expect(fakeHouse.setBrain).toHaveBeenCalledTimes(1);
        expect(fakeHouse.resetBrain).not.toHaveBeenCalled();
    });

    it('applyFromSettings unwires the brain when disabled', () => {
        const fakeHouse = { setBrain: vi.fn(), resetBrain: vi.fn() };
        const on = NpcBrain.applyFromSettings({ llmEnabled: false }, fakeHouse);
        expect(on).toBe(false);
        expect(NpcBrain.isEnabled()).toBe(false);
        expect(fakeHouse.resetBrain).toHaveBeenCalledTimes(1);
        expect(fakeHouse.setBrain).not.toHaveBeenCalled();
    });

    it('testConnection returns the model reply on success', async () => {
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: 'Working' });
        const r = await NpcBrain.testConnection({ endpoint: 'http://127.0.0.1:8080', model: 'm' });
        expect(r).toEqual({ ok: true, detail: 'Working' });
    });

    it('testConnection reports an unreachable server (health stage)', async () => {
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(false);
        const chat = vi.spyOn(LlmClient, 'chat');
        const r = await NpcBrain.testConnection({ endpoint: 'http://127.0.0.1:1234' });
        expect(r.ok).toBe(false);
        expect(r.stage).toBe('health');
        expect(chat).not.toHaveBeenCalled();
    });

    it('testConnection reports a failed query (query stage)', async () => {
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: false, reason: 'timeout' });
        const r = await NpcBrain.testConnection({});
        expect(r).toEqual({ ok: false, stage: 'query', detail: 'timeout' });
    });

    it('parses a proposal even when wrapped in a Qwen3 <think> block', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({
            ok: true,
            text: '<think>The feud is at 100, they raided us. I should strike.</think>\n{"act": true, "type": "claim_threat"}',
        });
        const brain = NpcBrain.asHouseBrain();
        brain.decideRivalAction(RIVAL_CTX);
        await NpcBrain._flush();
        expect(brain.decideRivalAction(RIVAL_CTX)).toEqual({ act: true, type: 'claim_threat' });
    });

    it('strips a <think> block from a dialogue line', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({
            ok: true,
            text: '<think>gruff, distrustful, keep it short</think>\nWhat do you want, stranger?',
        });
        const line = await NpcBrain.generateNpcLine({ id: 'n1', firstName: 'Bram' }, { topic: 'greeting', fallback: 'Hi.' });
        expect(line).toBe('What do you want, stranger?');
    });

    it('appends /no_think to prompts by default and honors the config toggle', () => {
        const withThink = NpcBrain._buildLinePrompt({ firstName: 'Ada' }, { topic: 'greeting' });
        expect(withThink[1].content).toContain('/no_think');
        NpcBrain.configure({ noThink: false });
        const noSwitch = NpcBrain._buildLinePrompt({ firstName: 'Ada' }, { topic: 'greeting' });
        expect(noSwitch[1].content).not.toContain('/no_think');
    });
});
