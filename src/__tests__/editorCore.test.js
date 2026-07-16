/**
 * Characterization tests for editor-core.js — the shared pure helpers
 * extracted from the standalone tile-painter editors (sprite / interior /
 * terrain / world). These pin the CURRENT behavior of each primitive so the
 * per-editor refactors that replace inline copies with EditorCore.* calls
 * cannot silently change results.
 *
 * editor-core.js is a classic (non-module) global script; importing it for
 * side effects assigns EditorCore onto globalThis, which we read here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../../editor-core.js';

let EC;
beforeAll(() => {
    EC = globalThis.EditorCore;
});

describe('EditorCore — strings', () => {
    it('slugify lowercases, collapses non-alnum to _, trims edge underscores', () => {
        expect(EC.slugify('Hello World!')).toBe('hello_world');
        expect(EC.slugify('__weird--name__')).toBe('weird_name');
        expect(EC.slugify('Grand Bazaar 2')).toBe('grand_bazaar_2');
        expect(EC.slugify('a1b2')).toBe('a1b2');
    });

    it('escHtml escapes & < > in that order', () => {
        expect(EC.escHtml('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
        expect(EC.escHtml('&<>')).toBe('&amp;&lt;&gt;');
    });
});

describe('EditorCore — cell keys', () => {
    it('cellKey / parseCellKey round-trip including negatives', () => {
        expect(EC.cellKey(3, -2)).toBe('3,-2');
        expect(EC.parseCellKey('3,-2')).toEqual({ q: 3, r: -2 });
    });
});

describe('EditorCore — viewport math', () => {
    const view = { tile: 32, zoom: 2, panX: 20, panY: 20, gridW: 10, gridH: 8 };

    it('screenToCell floors into cell coords and flags validity', () => {
        // ds = 64; (100-20)/64 = 1.25 -> 1 ; (200-20)/64 = 2.8125 -> 2
        expect(EC.screenToCell(100, 200, view)).toEqual({ q: 1, r: 2, valid: true });
    });

    it('screenToCell marks out-of-grid cells invalid', () => {
        const far = EC.screenToCell(20 + 64 * 10 + 5, 40, view); // q = 10 -> >= gridW
        expect(far.valid).toBe(false);
        expect(EC.screenToCell(10, 40, view).valid).toBe(false); // q = -1
    });

    it('screenToCellRaw omits the validity flag', () => {
        expect(EC.screenToCellRaw(10, 40, view)).toEqual({ q: -1, r: 0 });
    });

    it('zoomStep walks the ladder and clamps at both ends', () => {
        expect(EC.zoomStep(1, +1)).toBe(1.5);
        expect(EC.zoomStep(1, -1)).toBe(0.75);
        expect(EC.zoomStep(8, +1)).toBe(8); // clamp top
        expect(EC.zoomStep(0.25, -1)).toBe(0.25); // clamp bottom
    });

    it('zoomAtCursor keeps the cursor point fixed across a zoom change', () => {
        // cx=100, prev=1, next=2, pan=20 -> round(100 - 80*2) = -60
        expect(EC.zoomAtCursor(100, 100, 1, 2, 20, 20)).toEqual({ panX: -60, panY: -60 });
    });
});

describe('EditorCore — tile-map ops', () => {
    it('computeBounds scans across multiple layer stores', () => {
        const a = { '1,1': {}, '3,2': {} };
        const b = { '0,5': {} };
        expect(EC.computeBounds([a, b])).toEqual({ minCol: 0, minRow: 1, maxCol: 3, maxRow: 5 });
    });

    it('computeBounds returns null when nothing is occupied', () => {
        expect(EC.computeBounds([{}, null])).toBe(null);
    });

    it('floodFillRegion fills a contiguous same-value region (4-neighbour)', () => {
        const map = [
            ['a', 'a', 'a'],
            ['a', 'a', 'a'],
            ['a', 'a', 'a'],
        ];
        const count = EC.floodFillRegion({
            startQ: 1, startR: 1, gridW: 3, gridH: 3,
            match: (q, r) => map[r][q] === 'a',
            visit: (q, r) => { map[r][q] = 'b'; },
        });
        expect(count).toBe(9);
        expect(map.every((row) => row.every((c) => c === 'b'))).toBe(true);
    });

    it('floodFillRegion respects barriers (unmatched cells block traversal)', () => {
        const map = [
            ['a', 'x', 'a'],
            ['a', 'x', 'a'],
            ['a', 'x', 'a'],
        ];
        const count = EC.floodFillRegion({
            startQ: 0, startR: 0, gridW: 3, gridH: 3,
            match: (q, r) => map[r][q] === 'a',
            visit: (q, r) => { map[r][q] = 'b'; },
        });
        expect(count).toBe(3); // only the left column
        expect(map[0][2]).toBe('a'); // right column untouched
    });

    it('serializeTileMap / deserializeTileMap round-trip origin-relative', () => {
        const dict = {
            '2,3': { sheetPath: 's.png', sx: 0, sy: 0, sw: 32, sh: 32 },
            '4,3': { sheetPath: 's.png', sx: 32, sy: 0, sw: 32, sh: 32 },
        };
        const arr = EC.serializeTileMap(dict, 2, 3);
        expect(arr).toContainEqual({ localCol: 0, localRow: 0, sheetPath: 's.png', sx: 0, sy: 0, sw: 32, sh: 32 });
        expect(arr).toContainEqual({ localCol: 2, localRow: 0, sheetPath: 's.png', sx: 32, sy: 0, sw: 32, sh: 32 });
        expect(EC.deserializeTileMap(arr, 2, 3)).toEqual(dict);
    });
});

describe('EditorCore — variants', () => {
    it('variantHash is deterministic and bounded', () => {
        expect(EC.variantHash(0, 0, 4)).toBe(0);
        expect(EC.variantHash(2, 3, 1)).toBe(0);
        const h = EC.variantHash(7, 11, 5);
        expect(h).toBe(EC.variantHash(7, 11, 5)); // stable
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(5);
    });

    it('variantHash guards a zero-length variant set', () => {
        expect(EC.variantHash(3, 4, 0)).toBe(0);
    });

    it('pickWeightedVariant returns the sole option without consulting rand', () => {
        expect(EC.pickWeightedVariant([{ id: 'only' }])).toEqual({ id: 'only' });
    });

    it('pickWeightedVariant honours weights via an injected rng', () => {
        const variants = [{ id: 'a', probability: 1 }, { id: 'b', probability: 3 }];
        expect(EC.pickWeightedVariant(variants, () => 0).id).toBe('a');
        expect(EC.pickWeightedVariant(variants, () => 0.9).id).toBe('b');
    });
});

describe('EditorCore — undo/redo stack', () => {
    function makeStack(max) {
        const state = { v: 0 };
        const stack = EC.createUndoStack({
            max,
            snapshot: () => JSON.stringify(state),
            restore: (snap) => { Object.assign(state, JSON.parse(snap)); },
        });
        return { state, stack };
    }

    it('push/undo/redo restore prior snapshots', () => {
        const { state, stack } = makeStack();
        stack.push(); state.v = 1;
        stack.push(); state.v = 2;

        expect(stack.undo()).toBe(true);
        expect(state.v).toBe(1);
        expect(stack.undo()).toBe(true);
        expect(state.v).toBe(0);
        expect(stack.undo()).toBe(false); // empty
        expect(stack.canUndo()).toBe(false);

        expect(stack.redo()).toBe(true);
        expect(state.v).toBe(1);
    });

    it('push clears the redo stack', () => {
        const { state, stack } = makeStack();
        stack.push(); state.v = 1;
        stack.undo();
        expect(stack.canRedo()).toBe(true);
        stack.push();
        expect(stack.canRedo()).toBe(false);
    });

    it('caps the undo depth at max', () => {
        const { state, stack } = makeStack(2);
        stack.push(); state.v = 1;
        stack.push(); state.v = 2;
        stack.push(); state.v = 3;
        // Only 2 snapshots retained; deepest reachable is v=1, not v=0.
        stack.undo(); stack.undo();
        expect(stack.undo()).toBe(false);
        expect(state.v).toBe(1);
    });

    it('getState/setState round-trip a history (persist across contexts)', () => {
        const { state, stack } = makeStack();
        stack.push(); state.v = 1;
        stack.push(); state.v = 2;
        const saved = stack.getState();
        expect(saved.undo.length).toBe(2);

        stack.clear();
        expect(stack.canUndo()).toBe(false);

        stack.setState(saved);
        expect(stack.canUndo()).toBe(true);
        stack.undo();
        expect(state.v).toBe(1); // restored the saved timeline
    });

    it('setState tolerates a missing payload', () => {
        const { stack } = makeStack();
        stack.setState(undefined);
        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(false);
    });
});

describe('EditorCore — image cache', () => {
    class FakeImage {
        set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
    }
    class FakeBrokenImage {
        set src(v) { this._src = v; queueMicrotask(() => this.onerror && this.onerror()); }
    }

    it('resolves and caches a loaded image', async () => {
        const cache = EC.createImageCache();
        const img = await EC.loadImage(cache, 'ok.png', FakeImage);
        expect(img).toBeInstanceOf(FakeImage);
        expect(cache.get('ok.png')).toBe(img);
        // Second call is served from cache (same instance, no new load).
        expect(await EC.loadImage(cache, 'ok.png', FakeImage)).toBe(img);
    });

    it('caches null on error', async () => {
        const cache = EC.createImageCache();
        expect(await EC.loadImage(cache, 'bad.png', FakeBrokenImage)).toBe(null);
        expect(cache.has('bad.png')).toBe(true);
        expect(cache.get('bad.png')).toBe(null);
    });
});
