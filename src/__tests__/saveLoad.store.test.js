// The save store (core/saveStore.js): saves kept gzipped in IndexedDB (an
// in-memory backend here, installed per test by setup.js), the save list's
// index, the move of old localStorage saves, a full store said aloud, and the
// Ironman run's one slot.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { SaveStore } from '../core/saveStore.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';
import { Player } from '../player/player.js';
import { endIronmanRun } from '../ui/game/ironman.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy, errSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); errSpy && errSpy.mockRestore(); });

function memStore() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        get length() { return m.size; },
        key: i => [...m.keys()][i] ?? null,
        _m: m,
    };
}

let realLS;
beforeEach(() => {
    realLS = globalThis.localStorage;
    globalThis.localStorage = memStore();
});
afterEach(() => { globalThis.localStorage = realLS; });

/** A save as the old localStorage slot held it. */
const oldSave = (over = {}) => JSON.stringify({
    version: '1.0', timestamp: 100,
    meta: { ironman: false, tainted: false, playerName: 'Ada', houseName: 'House Ada' },
    world: { day: 5, year: 900, season: 'spring' }, player: { gold: 12, renown: 3 },
    ...over,
});

/** The JSON saveGame hands the store (a spy on SaveStore.write; restore() after). */
function captureWrites() {
    const seen = [];
    const orig = SaveStore.write;
    const spy = vi.spyOn(SaveStore, 'write').mockImplementation((key, json, meta, gate) => {
        seen.push({ key, json, meta });
        return orig.call(SaveStore, key, json, meta, gate);
    });
    seen.restore = () => spy.mockRestore();
    return seen;
}

describe('compression', () => {
    it('gzips and gives the same string back (unicode too)', async () => {
        const json = JSON.stringify({ a: 'ünïcødé ⚒️ 🗑', n: Array.from({ length: 500 }, (_, i) => ({ i, name: 'Ada' })) });
        const rec = await SaveStore.encode(json);
        expect(rec.encoding).toBe('gzip');
        expect(rec.bytes).toBeLessThan(json.length / 5);
        expect(SaveStore.isGzip(rec.data)).toBe(true);
        expect(await SaveStore.decode(rec)).toBe(json);
    });

    it('keeps the JSON as it is where there is no CompressionStream', async () => {
        const CS = globalThis.CompressionStream;
        globalThis.CompressionStream = undefined;
        try {
            const rec = await SaveStore.encode('{"x":1}');
            expect(rec.encoding).toBe('json');
            expect(await SaveStore.decode(rec)).toBe('{"x":1}');
            await SaveStore.write('k', '{"x":1}', { key: 'k' });
            expect(await SaveStore.read('k')).toBe('{"x":1}');
        } finally {
            globalThis.CompressionStream = CS;
        }
    });
});

describe('a real game through the store', () => {
    it('save → gzip → store → load equals the plain JSON round trip', async () => {
        const g = newGame(4242);
        for (let i = 0; i < 6; i++) endDay(g);
        const seen = captureWrites();
        const res = await SaveLoad.saveGame({ world: g.world, player: g.player, ui: null });
        seen.restore();
        expect(res.success).toBe(true);
        expect(res.encoding).toBe('gzip');
        expect(res.bytes).toBeLessThan(res.rawBytes / 3);
        expect(seen).toHaveLength(1);
        const json = seen[0].json;
        expect(res.rawBytes).toBe(json.length);

        // the stored bytes unpack to the very string written
        const rec = await SaveStore.backend().get(SaveLoad.SAVE_KEY);
        expect(rec.encoding).toBe('gzip');
        expect(await SaveStore.decode(rec)).toBe(json);

        // and the load is the plain JSON round trip
        const loaded = await SaveLoad.loadGame(SaveLoad.SAVE_KEY);
        expect(loaded.success).toBe(true);
        expect(loaded.data).toEqual(JSON.parse(json));

        // which restores like resumeGame does
        const data = loaded.data;
        const w2 = new World(data.world.width, data.world.height);
        w2.generate(data.world.generationParams || {});
        SaveLoad.restoreWorld(data.world, w2);
        Terrain.identifyRegions(w2.tiles, w2.width, w2.height);
        const p2 = new Player();
        SaveLoad.restorePlayer(data.player, p2, w2);
        expect(w2.day).toBe(g.world.day);
        expect(p2.gold).toBe(g.player.gold);
        expect([p2.q, p2.r]).toEqual([g.player.q, g.player.r]);

        // the save list reads the index, not the world
        const [info] = await SaveLoad.listSaves();
        expect(info).toMatchObject({ key: SaveLoad.SAVE_KEY, day: g.world.day, playerName: g.player.name, encoding: 'gzip', bytes: res.bytes, rawBytes: res.rawBytes });
        expect(info.ironman).toBe(false);
    });
});

describe('moving the old localStorage saves', () => {
    it('moves both slots into the store, then removes them from localStorage', async () => {
        const plain = oldSave();
        const iron = oldSave({ timestamp: 200, meta: { ironman: true, playerName: 'Una', houseName: 'House Una' } });
        localStorage.setItem(SaveLoad.SAVE_KEY, plain);
        localStorage.setItem(SaveLoad.IRONMAN_KEY, iron);
        localStorage.setItem('lotr_settings', '{"keep":true}');

        const list = await SaveLoad.listSaves();
        expect(list.map(s => s.key)).toEqual([SaveLoad.IRONMAN_KEY, SaveLoad.SAVE_KEY]);
        expect(list.every(s => !s.legacy && s.encoding === 'gzip')).toBe(true);
        expect(localStorage.getItem(SaveLoad.SAVE_KEY)).toBe(null);
        expect(localStorage.getItem(SaveLoad.IRONMAN_KEY)).toBe(null);
        expect(localStorage.getItem('lotr_settings')).toBe('{"keep":true}');

        const back = await SaveLoad.loadGame(SaveLoad.SAVE_KEY);
        expect(back.data).toEqual(JSON.parse(plain));
        expect((await SaveLoad.loadGame(SaveLoad.IRONMAN_KEY)).data).toEqual(JSON.parse(iron));
    });

    it('a newer save already in the store wins; the old copy is just dropped', async () => {
        await SaveStore.write(SaveLoad.SAVE_KEY, oldSave({ timestamp: 999, player: { gold: 77 } }), { key: SaveLoad.SAVE_KEY, timestamp: 999 });
        localStorage.setItem(SaveLoad.SAVE_KEY, oldSave({ timestamp: 100 }));
        const moved = await SaveLoad.migrateLegacySaves();
        expect(moved).toEqual([]);
        expect(localStorage.getItem(SaveLoad.SAVE_KEY)).toBe(null);
        expect((await SaveLoad.loadGame()).data.player.gold).toBe(77);
    });

    it('a save that cannot be moved stays in localStorage and still lists and loads', async () => {
        SaveStore.useBackend(SaveStore.memoryBackend({ quotaBytes: 10 }));
        localStorage.setItem(SaveLoad.SAVE_KEY, oldSave());
        const list = await SaveLoad.listSaves();
        expect(list).toHaveLength(1);
        expect(list[0].legacy).toBe(true);
        expect(localStorage.getItem(SaveLoad.SAVE_KEY)).toBe(oldSave());
        expect((await SaveLoad.loadGame()).data.player.gold).toBe(12);
    });

    it('unreadable old JSON is left alone', async () => {
        localStorage.setItem(SaveLoad.SAVE_KEY, '{not json');
        expect(await SaveLoad.migrateLegacySaves()).toEqual([]);
        expect(localStorage.getItem(SaveLoad.SAVE_KEY)).toBe('{not json');
        expect(await SaveLoad.listSaves()).toEqual([]);
    });
});

describe('a full store', () => {
    it('saveGame says so plainly instead of failing quietly', async () => {
        SaveStore.useBackend(SaveStore.memoryBackend({ quotaBytes: 64 }));
        const g = newGame(77);
        const res = await SaveLoad.saveGame({ world: g.world, player: g.player, ui: null });
        expect(res.success).toBe(false);
        expect(res.quota).toBe(true);
        expect(res.error).toBe(SaveStore.QUOTA_MESSAGE);
        expect(await SaveLoad.hasSave()).toBe(false);
    });

    it('recognises the browsers\' quota errors', () => {
        expect(SaveStore.isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
        expect(SaveStore.isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
        expect(SaveStore.isQuotaError({ code: 22 })).toBe(true);
        expect(SaveStore.isQuotaError(new Error('disk on fire'))).toBe(false);
    });

    it('importSave reports it too', async () => {
        SaveStore.useBackend(SaveStore.memoryBackend({ quotaBytes: 8 }));
        const file = new Blob([oldSave()]);
        const res = await SaveLoad.importSave(file);
        expect(res).toMatchObject({ success: false, quota: true });
    });
});

describe('list, delete, import, export', () => {
    it('lists newest first, deletes one slot, hasSave follows', async () => {
        await SaveStore.write(SaveLoad.SAVE_KEY, oldSave(), SaveLoad._infoOf(JSON.parse(oldSave()), SaveLoad.SAVE_KEY));
        const iron = JSON.parse(oldSave({ timestamp: 300, meta: { ironman: true } }));
        await SaveStore.write(SaveLoad.IRONMAN_KEY, JSON.stringify(iron), SaveLoad._infoOf(iron, SaveLoad.IRONMAN_KEY));
        expect((await SaveLoad.listSaves()).map(s => s.key)).toEqual([SaveLoad.IRONMAN_KEY, SaveLoad.SAVE_KEY]);
        expect(await SaveLoad.hasSave(SaveLoad.SAVE_KEY)).toBe(true);
        await SaveLoad.deleteSave(SaveLoad.SAVE_KEY);
        expect((await SaveLoad.listSaves()).map(s => s.key)).toEqual([SaveLoad.IRONMAN_KEY]);
        expect(await SaveLoad.hasSave(SaveLoad.SAVE_KEY)).toBe(false);
        expect((await SaveLoad.loadGame(SaveLoad.SAVE_KEY)).success).toBe(false);
        expect((await SaveLoad.getSaveInfo(SaveLoad.IRONMAN_KEY)).ironman).toBe(true);
    });

    it('imports a plain or a gzipped save file into the ordinary slot, never an Ironman one', async () => {
        const plain = await SaveLoad.importSave(new Blob([oldSave({ player: { gold: 5 } })]));
        expect(plain.success).toBe(true);
        expect((await SaveLoad.loadGame()).data.player.gold).toBe(5);
        const gz = await SaveStore.gzip(oldSave({ player: { gold: 6 } }));
        expect((await SaveLoad.importSave(new Blob([gz]))).success).toBe(true);
        expect((await SaveLoad.loadGame()).data.player.gold).toBe(6);
        const cb = vi.fn();
        const iron = await SaveLoad.importSave(new Blob([oldSave({ meta: { ironman: true } })]), cb);
        expect(iron.success).toBe(false);
        expect(cb).toHaveBeenCalledWith(iron);
        expect((await SaveLoad.importSave(new Blob(['{"x":1}']))).error).toBe('Invalid save file');
    });

    it('exports nothing when there is no save', async () => {
        expect(await SaveLoad.exportSave()).toBe(false);
    });
});

describe('writes to one slot', () => {
    it('run one at a time, the latest state wins', async () => {
        const ps = [1, 2, 3, 4].map(n => SaveStore.write('s', JSON.stringify({ n }), { key: 's', n }));
        const rs = await Promise.all(ps);
        expect(rs.every(r => r.success)).toBe(true);
        expect(JSON.parse(await SaveStore.read('s')).n).toBe(4);
        expect((await SaveStore.list())[0].n).toBe(4);
    });

    it('a delete while a write is under way leaves the slot empty', async () => {
        SaveStore.write('s', '{"n":1}', { key: 's' });
        SaveStore.write('s', '{"n":2}', { key: 's' });
        await SaveStore.remove('s');
        expect(await SaveStore.read('s')).toBe(null);
        expect(await SaveStore.list()).toEqual([]);
    });

    it('writeNow starts at once, uncompressed, and overtakes a write still compressing', async () => {
        const slow = SaveStore.write('s', '{"n":1}', { key: 's' });
        const now = SaveStore.writeNow('s', '{"n":2}', { key: 's' });
        // (the backend has it before any await)
        expect(SaveStore.backend().saves.get('s').data).toBe('{"n":2}');
        await Promise.all([slow, now]);
        expect(await SaveStore.read('s')).toBe('{"n":2}');
        expect((await SaveStore.list())[0].encoding).toBe('json');
    });
});

describe('the Ironman run keeps one slot', () => {
    const ironGame = () => {
        const g = newGame(515);
        g.world.run = MetaLegacy.newRun({ ironman: true, seed: 515 });
        return { world: g.world, player: g.player, ui: null };
    };

    it('saves to the Ironman slot only, and a finished run saves no more', async () => {
        const game = ironGame();
        expect((await SaveLoad.saveGame(game)).success).toBe(true);
        const list = await SaveLoad.listSaves();
        expect(list.map(s => s.key)).toEqual([SaveLoad.IRONMAN_KEY]);
        expect(list[0].ironman).toBe(true);
        MetaLegacy.finalize(game.world);
        expect((await SaveLoad.saveGame(game)).success).toBe(false);
    });

    it('ending the run deletes the slot, even with a save still being written', async () => {
        const game = ironGame();
        await SaveLoad.saveGame(game);
        const inFlight = SaveLoad.saveGame(game);
        expect(endIronmanRun(game)).toBe(true);
        expect((await inFlight).success).toBe(false);
        // (the delete lands after any write under way)
        await vi.waitFor(async () => expect(await SaveLoad.hasSave(SaveLoad.IRONMAN_KEY)).toBe(false));
        await new Promise(r => setTimeout(r, 20));
        expect(await SaveLoad.hasSave(SaveLoad.IRONMAN_KEY)).toBe(false);
        expect((await SaveLoad.saveGame(game)).success).toBe(false);
    });

    it('leaving the page writes at once (opts.now)', async () => {
        const game = ironGame();
        const p = SaveLoad.saveGame(game, { now: true });
        expect(SaveStore.backend().saves.has(SaveLoad.IRONMAN_KEY)).toBe(true);
        expect((await p).success).toBe(true);
        expect((await SaveLoad.loadGame(SaveLoad.IRONMAN_KEY)).data.meta.ironman).toBe(true);
    });
});
