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
