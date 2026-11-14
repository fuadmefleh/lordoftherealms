// Phase A tests for the LLM transport. Every path is exercised with a mocked
// fetch; the client must never throw and must degrade gracefully.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LlmClient } from '../systems/llmClient.js';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
    LlmClient._reset();
});

function mockChatOk(content) {
    globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }),
    }));
}

describe('LlmClient — Phase A transport', () => {
    it("chat() sends a schema as llama-server's json_object + schema", async () => {
        mockChatOk('{"say":"hi"}');
        const schema = { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] };
        await LlmClient.chat([{ role: 'user', content: 'hi' }], { json: true, schema });
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.response_format).toEqual({ type: 'json_object', schema });
    });

    it('chat() parses an OpenAI-style success response', async () => {
        mockChatOk('  A rival sharpens their knives.  ');
        const res = await LlmClient.chat([{ role: 'user', content: 'hi' }]);
        expect(res.ok).toBe(true);
        expect(res.text).toBe('A rival sharpens their knives.'); // trimmed
    });

    it('chat() rejects empty message arrays without calling fetch', async () => {
        globalThis.fetch = vi.fn();
        const res = await LlmClient.chat([]);
        expect(res.ok).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('chat() reports non-200 gracefully', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
        const res = await LlmClient.chat([{ role: 'user', content: 'x' }]);
        expect(res).toEqual({ ok: false, reason: 'http 500' });
    });

    it('chat() reports malformed payloads gracefully', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }));
        const res = await LlmClient.chat([{ role: 'user', content: 'x' }]);
        expect(res).toEqual({ ok: false, reason: 'malformed response' });
    });

    it('chat() never throws on a network error', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        const res = await LlmClient.chat([{ role: 'user', content: 'x' }]);
        expect(res).toEqual({ ok: false, reason: 'network error' });
    });

    it('chat() maps an aborted request to a timeout reason', async () => {
        globalThis.fetch = vi.fn(async () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            throw e;
        });
        const res = await LlmClient.chat([{ role: 'user', content: 'x' }]);
        expect(res).toEqual({ ok: false, reason: 'timeout' });
    });

    it('isAvailable() reflects the health probe and caches the result', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        expect(await LlmClient.isAvailable()).toBe(true);
        // Second call within TTL must not hit the network again.
        expect(await LlmClient.isAvailable()).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('isAvailable() returns false when the server is offline', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
        expect(await LlmClient.isAvailable()).toBe(false);
    });

    it('configure() overrides settings and invalidates the availability cache', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        await LlmClient.isAvailable();
        LlmClient.configure({ endpoint: 'http://127.0.0.1:9999', model: 'my-model' });
        expect(LlmClient.getConfig().endpoint).toBe('http://127.0.0.1:9999');
        expect(LlmClient.getConfig().model).toBe('my-model');
        await LlmClient.isAvailable(); // re-probes because cache was invalidated
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('LlmClient — OpenAI', () => {
    it('asks OpenAI with the key, its own token cap and no reasoning; llama-server without', async () => {
        mockChatOk('Aye.');
        LlmClient.configure({ provider: 'openai', apiKey: 'test-key', endpoint: 'https://api.openai.com', model: 'gpt-6-luna' });
        const res = await LlmClient.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
        expect(res.ok).toBe(true);
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer test-key');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('gpt-6-luna');
        expect(body.max_completion_tokens).toBe(50);
        expect(body.max_tokens).toBeUndefined();
        expect(body.reasoning_effort).toBe('none');
        // the local server: no key, max_tokens, no reasoning_effort
        LlmClient._reset();
        mockChatOk('Aye.');
        await LlmClient.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
        const [, init2] = globalThis.fetch.mock.calls[0];
        const body2 = JSON.parse(init2.body);
        expect(init2.headers.Authorization).toBeUndefined();
        expect(body2.max_tokens).toBe(50);
        expect(body2.reasoning_effort).toBeUndefined();
    });

    it('probes OpenAI by its model: no key, a refused key, a missing model, ready', async () => {
        LlmClient.configure({ provider: 'openai', apiKey: '', endpoint: 'https://api.openai.com', model: 'gpt-6-luna' });
        globalThis.fetch = vi.fn();
        expect((await LlmClient.probe()).state).toBe('nokey');
        expect(globalThis.fetch).not.toHaveBeenCalled();
        LlmClient.configure({ apiKey: 'k' });
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
        expect((await LlmClient.probe()).state).toBe('badkey');
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
        expect((await LlmClient.probe()).state).toBe('nomodel');
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        const ok = await LlmClient.probe();
        expect(ok.ok).toBe(true);
        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models/gpt-6-luna');
        expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
    });
});
