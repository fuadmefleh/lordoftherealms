/**
 * Treasure digs (systems/treasureDigs.js): the cache's origin and encounter
 * are fixed per hex (hash, terrain-biased), the buried items are really
 * given within the packs' capacity (the rest stays buried), and the dig
 * scene's choices resolve; the old one-step Cartography.digTreasure now
 * hands over the items too. The UI scene renders without throwing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { TreasureDigs } from '../systems/treasureDigs.js';
import { Cartography } from '../systems/cartography.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(terrain = 'plains') {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: terrain, passable: true }, settlement: null });
        return tiles.get(key);
    };
    return { width: 60, height: 60, day: 10, generationParams: { seed: 7 }, units: [], kingdoms: [], getTile, getKingdom: () => null };
}

function makePlayer(over = {}) {
    return {
        name: 'Ash', q: 3, r: 4, gold: 100, karma: 0, renown: 0, health: 100, strength: 5, charisma: 5, intelligence: 5, luck: 5,
        actionPoints: 10, inventory: {}, reputation: {}, skills: { combat: 3, stealth: 3, diplomacy: 3, cartography: 2 }, army: [],
        ...over,
    };
}

function bury(world, q, r, extra = {}) {
    const t = world.getTile(q, r);
    t.buried = { gold: 200, items: ['ancient_relic'], discovered: false, ...extra };
    t.improvement = { type: 'treasure_cache', explored: false };
    return t;
}

describe('treasure caches', () => {
    it('origin and encounter are fixed per hex and draw no RNG', () => {
        const world = makeWorld('beach');
        Utils.setSeed(1);
        const before = Utils.random();
        Utils.setSeed(1);
        const a = TreasureDigs.originAt(world, 5, 5);
        const e = TreasureDigs.encounterAt(world, 5, 5, a);
        expect(Utils.random()).toBe(before);
        expect(TreasureDigs.originAt(world, 5, 5)).toBe(a);
        expect(TreasureDigs.encounterAt(world, 5, 5, a)).toBe(e);
        expect(Object.keys(TreasureDigs.config().origins)).toContain(a);
        expect(['none', 'trap', 'guardian', 'rivals']).toContain(e);
    });

    it('terrain biases the origin (beaches hide pirate hoards)', () => {
        const world = makeWorld('beach');
        const counts = {};
        for (let i = 0; i < 200; i++) {
            const o = TreasureDigs.originAt(world, i, i * 3);
            counts[o] = (counts[o] || 0) + 1;
        }
        const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
        expect(top).toBe('pirate_hoard');
    });

    it('giveLoot hands over the gold and the items; what does not fit stays buried', () => {
        const world = makeWorld();
        const tile = bury(world, 1, 1);
        const player = makePlayer({ maxInventory: 0 });
        const res = TreasureDigs.giveLoot(player, world, tile, 1, { originLoot: true });
        expect(res.gold).toBeGreaterThan(0);
        expect(Object.keys(res.added)).toHaveLength(0);
        expect(res.left.ancient_artifact).toBe(1);
        expect(tile.buried.discovered).toBe(false);
        expect(tile.buried.leftover).toBe(true);
        expect(tile.improvement).toBeTruthy();
        // Room now: come back and take the rest
        player.maxInventory = 20;
        const again = TreasureDigs.giveLoot(player, world, tile, 1, { originLoot: true });
        expect(again.gold).toBe(0);
        expect(player.inventory.ancient_artifact).toBe(1);
        expect(tile.buried.discovered).toBe(true);
        expect(tile.improvement).toBeNull();
    });

    it('the old one-step dig now gives the relic itself', () => {
        const world = makeWorld();
        bury(world, 2, 2);
        const player = makePlayer();
        const res = Cartography.digTreasure(player, world, 2, 2);
        expect(res.success).toBe(true);
        expect(res.gold).toBe(200);
        expect(player.gold).toBe(300);
        expect(player.inventory.ancient_artifact).toBe(1);
        expect(res.bonusText).toMatch(/relic/);
    });
});

describe('the dig scene', () => {
    it('walks every encounter through to a dig or a loss', () => {
        Utils.setSeed(42);
        const seen = new Set();
        for (let i = 0; i < 60; i++) {
            const world = makeWorld(['beach', 'desert', 'plains', 'hills'][i % 4]);
            const q = i;
            const r = i * 2;
            const tile = bury(world, q, r);
            const player = makePlayer({ q, r, gold: 500 });
            const { state } = TreasureDigs.begin(player, world, q, r);
            seen.add(state.encounter);
            let st = state;
            for (let step = 0; step < 4 && st; step++) {
                const v = TreasureDigs.view(player, world, st);
                if (!v) break;
                const opt = v.options.find(o => o.can !== false && o.id !== 'leave' && o.id !== 'yield');
                const out = TreasureDigs.act(player, world, st, opt.id);
                expect(out.invalid).toBeFalsy();
                st = out.state || null;
                if (!st) expect(out.notification.body).toBeTruthy();
            }
            expect(player.health).toBeGreaterThan(0);
            expect(tile.buried).toBeTruthy();
        }
        expect(seen.size).toBeGreaterThanOrEqual(3);
    });

    it('letting rivals have it loses the cache; leaving a guardian keeps it', () => {
        const world = makeWorld();
        const tile = bury(world, 0, 0);
        const player = makePlayer({ q: 0, r: 0 });
        const out = TreasureDigs.act(player, world, { q: 0, r: 0, origin: 'bandit_stash', encounter: 'rivals', phase: 'encounter', share: 1, log: [] }, 'yield');
        expect(out.state).toBeUndefined();
        expect(tile.buried.discovered).toBe(true);
        const t2 = bury(world, 1, 0);
        TreasureDigs.act(player, world, { q: 1, r: 0, origin: 'bandit_stash', encounter: 'guardian', phase: 'encounter', share: 1, log: [] }, 'leave');
        expect(t2.buried.discovered).toBe(false);
    });

    it('a tomb guardian takes prayers, not coin', () => {
        const world = makeWorld('desert');
        bury(world, 0, 0);
        const player = makePlayer({ q: 0, r: 0 });
        const st = { q: 0, r: 0, origin: 'ancient_tomb', encounter: 'guardian', phase: 'encounter', share: 1, log: [] };
        const ids = TreasureDigs.view(player, world, st).options.map(o => o.id);
        expect(ids).toContain('prayer');
        expect(ids).not.toContain('bribe');
    });

    it('the UI scene opens, acts and finishes without throwing', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const tile = bury(world, 4, 4);
        const player = makePlayer({ q: 4, r: 4 });
        const panels = [];
        const game = {
            player, world, endDay() {},
            ui: { showCustomPanel: (t, h) => panels.push(h), hideCustomPanel() {}, showNotification() {}, updateStats() {} },
        };
        ActionMenu._pendingAP = 4;
        ActionMenu.digTreasure(game, tile);
        expect(game._scene.kind).toBe('dig');
        for (let i = 0; i < 5 && game._scene; i++) {
            const m = /data-am-act="sceneAct" data-am-args='\[&quot;([a-z_]+)&quot;\]'/.exec(panels[panels.length - 1]);
            if (!m || m[1] === 'leave' || m[1] === 'yield') break;
            ActionMenu.sceneAct(game, m[1]);
        }
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
    });
});
