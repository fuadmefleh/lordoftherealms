/**
 * spritesheet-tools.js — the spritesheet editor's pure pixel logic: keying out
 * the generator's flat background, snapping an off-grid image onto the tile
 * grid, palette limiting, tile-aligned packing, seam checks and the
 * generator's prompts. It is a classic global script, so importing it for
 * side effects puts SheetTools on globalThis.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../../spritesheet-tools.js';

let T;
beforeAll(() => {
    T = globalThis.SheetTools;
});

/** w×h RGBA filled by fn(x, y) → [r, g, b, a]. */
function image(w, h, fn) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b, a] = fn(x, y);
            const i = (y * w + x) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        }
    }
    return d;
}
const px = (d, w, x, y) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('SheetTools — background keying', () => {
    it('clears pixels near the key colour and leaves the rest', () => {
        const d = image(2, 1, x => (x === 0 ? [250, 10, 245, 255] : [40, 120, 40, 255]));
        expect(T.keyOutColor(d, { r: 255, g: 0, b: 255 }, 20)).toBe(1);
        expect(d[3]).toBe(0);
        expect(d[7]).toBe(255);
    });

    it('finds the dominant border colour', () => {
        const d = image(5, 5, (x, y) => (x > 0 && x < 4 && y > 0 && y < 4 ? [0, 0, 0, 255] : [255, 0, 255, 255]));
        expect(T.dominantBorderColor(d, 5, 5)).toEqual({ r: 255, g: 0, b: 255 });
    });
});

describe('SheetTools — snapToGrid', () => {
    it('collapses each source block to its majority colour', () => {
        // 4×4 source of 2×2 blocks, one noisy pixel in the top-left block.
        const d = image(4, 4, (x, y) => {
            if (x === 1 && y === 1) return [0, 0, 255, 255];
            return x < 2 ? [255, 0, 0, 255] : [0, 255, 0, 255];
        });
        const out = T.snapToGrid(d, 4, 4, 2, 2);
        expect(px(out, 2, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(px(out, 2, 1, 0)).toEqual([0, 255, 0, 255]);
        expect(px(out, 2, 0, 1)).toEqual([255, 0, 0, 255]);
    });

    it('keeps mostly-transparent blocks transparent', () => {
        const d = image(2, 2, (x, y) => (x === 0 && y === 0 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
        expect(px(T.snapToGrid(d, 2, 2, 1, 1), 1, 0, 0)[3]).toBe(0);
    });

    it('handles non-integer scale factors', () => {
        const d = image(10, 7, () => [1, 2, 3, 255]);
        const out = T.snapToGrid(d, 10, 7, 4, 4);
        expect(out.length).toBe(4 * 4 * 4);
        expect(px(out, 4, 3, 3)).toEqual([1, 2, 3, 255]);
    });
});

describe('SheetTools — quantize', () => {
    it('reduces to at most N colours and remaps pixels to the palette', () => {
        const d = image(8, 1, x => [x * 30, 0, 0, 255]);
        const pal = T.quantize(d, 2);
        expect(pal.length).toBe(2);
        const used = new Set();
        for (let i = 0; i < d.length; i += 4) used.add(d[i]);
        expect(used.size).toBe(2);
    });

    it('ignores transparent pixels', () => {
        const d = image(2, 1, x => (x === 0 ? [10, 10, 10, 0] : [200, 200, 200, 255]));
        expect(T.quantize(d, 4)).toEqual([{ r: 200, g: 200, b: 200 }]);
        expect(d[0]).toBe(10);
    });
});

describe('SheetTools — tiles and packing', () => {
    it('lists occupied tiles row-major', () => {
        const d = image(4, 4, (x, y) => (x >= 2 && y < 2 ? [1, 1, 1, 255] : [0, 0, 0, 0]));
        expect(T.occupiedTiles(d, 4, 4, 2)).toEqual([{ col: 1, row: 0 }]);
    });

    it('packs sprites onto tile boundaries, wrapping at maxCols', () => {
        const r = T.gridPack([{ w: 64, h: 32 }, { w: 40, h: 40 }, { w: 32, h: 32 }], 32, 3);
        // 2×1 at (0,0); 40px needs 2×2 cells, wraps to the next shelf.
        expect(r.placements.map(p => [p.x, p.y])).toEqual([[0, 0], [0, 32], [64, 32]]);
        expect(r.cols).toBe(3);
        expect(r.rows).toBe(3);
        for (const p of r.placements) {
            expect(p.x % 32).toBe(0);
            expect(p.y % 32).toBe(0);
        }
    });

    it('widens the grid for a sprite wider than maxCols', () => {
        const r = T.gridPack([{ w: 128, h: 32 }], 32, 2);
        expect(r.cols).toBe(4);
    });

    it('scores a seamless tile 0 and a hard edge high', () => {
        expect(T.seamReport(image(4, 4, () => [50, 50, 50, 255]), 4, 4)).toEqual({ horizontal: 0, vertical: 0 });
        const ramp = image(4, 4, x => [x * 80, 0, 0, 255]);
        expect(T.seamReport(ramp, 4, 4).horizontal).toBe(240);
    });
});

describe('SheetTools — prompts', () => {
    it('picks the nearest supported aspect ratio', () => {
        expect(T.nearestAspect(4, 4)).toBe('1:1');
        expect(T.nearestAspect(4, 2)).toBe('16:9');
        expect(T.nearestAspect(2, 3)).toBe('2:3');
    });

    it('lists the inner-map sheet kinds', () => {
        const ids = T.tileKinds().map(k => k.id);
        expect(ids).toEqual(expect.arrayContaining(['terrain', 'ninetile', 'floor', 'wall', 'objects', 'structures']));
    });

    it('builds a 9-tile brush prompt with the editor slot layout and a key colour', () => {
        const r = T.buildTilePrompt({ kind: 'ninetile', subject: 'a muddy road', season: 'winter', tile: 32 });
        expect([r.cols, r.rows, r.tile]).toEqual([5, 3, 32]);
        expect(r.background).toEqual({ r: 255, g: 0, b: 255 });
        expect(r.prompt).toContain('5 columns × 3 rows');
        expect(r.prompt).toContain('a muddy road');
        expect(r.prompt).toContain('INSIDE corners');
        expect(r.prompt).toContain('#FF00FF');
        expect(r.prompt).toMatch(/Season: winter/);
    });

    it('fills terrain tiles edge to edge with no key colour', () => {
        const r = T.buildTilePrompt({ kind: 'terrain', cols: 3, rows: 2 });
        expect(r.background).toBeNull();
        expect(r.prompt).toContain('SEAMLESS');
        expect(r.prompt).not.toContain('#FF00FF');
        expect([r.cols, r.rows]).toEqual([3, 2]);
    });

    it('defaults to the medieval setting and adds notes and the reference line', () => {
        const r = T.buildTilePrompt({ kind: 'objects', notes: 'include a butter churn', withReference: true });
        expect(r.prompt).toContain('high-medieval');
        expect(r.prompt).toContain('include a butter churn');
        expect(r.prompt).toContain('attached reference');
        // Seasons only apply to outdoor kinds.
        expect(T.buildTilePrompt({ kind: 'objects', season: 'winter' }).prompt).not.toContain('Season:');
    });
});

// ── off-grid generator output ───────────────────────────────

const MAGENTA = [255, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];
/** Deterministic "pixel art": colour per art pixel from a hash. */
const artColour = (ax, ay) => {
    const v = ((ax * 73856093) ^ (ay * 19349663)) >>> 0;
    return [40 + (v % 150), 60 + ((v >> 8) % 120), 30 + ((v >> 16) % 90), 255];
};

describe('SheetTools — magenta cast', () => {
    it('clears dull pinks, pink shadows and the faded fringe but keeps reds and browns', () => {
        const d = image(4, 1, x => [[214, 50, 142, 255], [176, 40, 120, 255], [200, 40, 50, 255], [150, 100, 60, 255]][x]);
        T.keyOutMagentaCast(d);
        expect([d[3], d[7], d[11], d[15]]).toEqual([0, 0, 255, 255]);
        // A faint pink edge pixel only goes when it touches the cleared background.
        const e = image(3, 1, x => [CLEAR, [180, 120, 150, 255], [150, 100, 60, 255]][x]);
        T.keyOutMagentaCast(e, 60, 3, 1);
        expect([e[7], e[11]]).toEqual([0, 255]);
    });

    it('clears exact unpainted guide grey only', () => {
        const d = image(2, 1, x => (x === 0 ? [128, 128, 128, 255] : [120, 124, 131, 255]));
        T.keyOutGuideGrey(d);
        expect([d[3], d[7]]).toEqual([0, 255]);
    });
});

describe('SheetTools — findSprites / removeGridLines', () => {
    it('finds sprites in reading order, merges detached bits and drops specks', () => {
        const d = image(60, 40, (x, y) => {
            if (x >= 40 && x < 50 && y >= 5 && y < 15) return [1, 2, 3, 255]; // top right
            if (x >= 5 && x < 15 && y >= 6 && y < 16) return [1, 2, 3, 255]; // top left
            if (x >= 16 && x < 18 && y >= 10 && y < 12) return [1, 2, 3, 255]; // a shard beside it
            if (x >= 10 && x < 20 && y >= 25 && y < 35) return [1, 2, 3, 255]; // bottom
            if (x === 30 && y === 30) return [1, 2, 3, 255]; // speck
            return CLEAR;
        });
        const boxes = T.findSprites(d, 60, 40, { gap: 2, minArea: 4 });
        expect(boxes.map(b => [b.x, b.y, b.w, b.h])).toEqual([[5, 6, 13, 10], [40, 5, 10, 10], [10, 25, 10, 10]]);
    });

    it('removes a grid line that would glue sprites together', () => {
        const d = image(40, 20, (x, y) => {
            if (y === 10) return [180, 180, 180, 255];
            if ((x < 10 || x >= 30) && y >= 5 && y < 15) return [90, 40, 20, 255];
            return CLEAR;
        });
        expect(T.findSprites(d, 40, 20, { gap: 1, minArea: 4 }).length).toBe(1);
        expect(T.removeGridLines(d, 40, 20)).toBeGreaterThan(0);
        expect(T.findSprites(d, 40, 20, { gap: 4, minArea: 4 }).length).toBe(2);
    });
});

describe('SheetTools — relayoutSprites / detectPixelSize', () => {
    it('detects the art-pixel size of upscaled pixel art', () => {
        const d = image(120, 120, (x, y) => artColour(Math.floor(x / 6), Math.floor(y / 6)));
        const ps = T.detectPixelSize(d, 120, 120);
        expect(ps).not.toBeNull();
        expect(ps.size).toBeGreaterThan(5.7);
        expect(ps.size).toBeLessThan(6.3);
    });

    it('lays off-grid sprites out one per tile, centred, at one common scale', () => {
        // Two sprites drawn at 4px per art pixel, at arbitrary offsets: 6×6 and 4×4 art px.
        const d = image(100, 50, (x, y) => {
            if (x >= 7 && x < 31 && y >= 13 && y < 37) return artColour(x >> 2, y >> 2);
            if (x >= 61 && x < 77 && y >= 3 && y < 19) return artColour(x >> 2, y >> 2);
            return CLEAR;
        });
        const r = T.relayoutSprites(d, 100, 50, { tile: 8, cols: 4, pixelSize: { size: 4 } });
        expect(r.native).toBe(true);
        expect([r.cols, r.rows, r.count]).toEqual([2, 1, 2]);
        // Reading order puts the higher sprite first: 4×4 centred in tile 0, 6×6 in tile 1.
        const alpha = (x, y) => r.data[(y * r.width + x) * 4 + 3];
        expect(alpha(1, 1)).toBe(0);
        expect(alpha(2, 2)).toBe(255);
        expect(alpha(5, 5)).toBe(255);
        expect(alpha(6, 6)).toBe(0);
        expect(alpha(9, 1)).toBe(255);
        expect(alpha(14, 6)).toBe(255);
        expect(alpha(15, 7)).toBe(0);
    });

    it('shrinks to fit the tile when the sprites are too big at native size', () => {
        const d = image(64, 64, (x, y) => (x >= 2 && x < 62 && y >= 2 && y < 62 ? [9, 9, 9, 255] : CLEAR));
        const r = T.relayoutSprites(d, 64, 64, { tile: 16, cols: 4, pixelSize: null });
        expect(r.native).toBe(false);
        expect([r.width, r.height]).toEqual([16, 16]);
        expect(r.data[3]).toBe(0); // 1px margin
        expect(r.data[(1 * 16 + 1) * 4 + 3]).toBe(255);
    });
});

describe('SheetTools — fitTilesToGrid / layout guide', () => {
    it('cuts cells around the gutters and margins the model drew', () => {
        // 3×1 tiles of 20px drawn with a 6px margin and 4px magenta gutters.
        const cols = [[200, 0, 0, 255], [0, 200, 0, 255], [0, 0, 200, 255]];
        const raw = image(80, 32, (x, y) => {
            if (y < 6 || y >= 26 || x < 6) return MAGENTA;
            const k = Math.floor((x - 6) / 24);
            return k < 3 && (x - 6) % 24 < 20 ? cols[k] : MAGENTA;
        });
        const mask = new Uint8ClampedArray(raw);
        T.keyOutColor(mask, { r: 255, g: 0, b: 255 }, 10);
        const r = T.fitTilesToGrid(mask, 80, 32, { cols: 3, rows: 1, tile: 4, mask });
        expect(r.gutters).toBe(2);
        for (let c = 0; c < 3; c++) {
            for (let x = c * 4; x < c * 4 + 4; x++) {
                for (let y = 0; y < 4; y++) expect(px(r.data, 12, x, y)).toEqual(cols[c]);
            }
        }
    });

    it('fills transparent hairlines left inside drawn areas', () => {
        const d = image(5, 3, x => (x === 2 ? CLEAR : [7, 7, 7, 255]));
        expect(T.healHairlines(d, 5, 3)).toBe(3);
        expect(px(d, 5, 2, 1)).toEqual([7, 7, 7, 255]);
    });

    it('draws a guide at the requested aspect with the grid and content located', () => {
        const g = T.layoutGuide('ninetile', 5, 3, 32);
        expect(g.width / g.height).toBeCloseTo(16 / 9, 1);
        expect(g.region.x0).toBeGreaterThan(0);
        expect(g.region.y0).toBe(0);
        // The patch is inset; the inside corners reach the top-right of the grid.
        expect(g.content.x0).toBeGreaterThan(g.region.x0);
        expect(g.content.x1).toBeCloseTo(g.region.x1, 5);
        const at = (cx, cy) => px(g.data, g.width, Math.round(g.region.x0 * g.width + cx * 32), Math.round(cy * 32));
        expect(at(1.5, 1.5)).toEqual([128, 128, 128, 255]); // centre fill
        expect(at(3.1, 0.1)).toEqual(MAGENTA); // top-left inside-corner notch
        expect(at(3.5, 0.5)).toEqual([128, 128, 128, 255]);
        expect(T.layoutGuide('nosuchkind', 9, 6)).toBeNull();
    });

    it('describes the guide in the prompt when one is sent', () => {
        const withGuide = T.buildTilePrompt({ kind: 'floor', withGuide: true, withReference: true });
        expect(withGuide.guide).toBe(true);
        expect(withGuide.prompt).toContain('FIRST attached image is a layout guide');
        expect(withGuide.prompt).toContain('second attached image');
        const s = T.buildTilePrompt({ kind: 'structures', withGuide: true });
        expect([s.guide, s.layout, s.span]).toEqual([true, 'sprites', 3]);
        expect(s.prompt).toContain('grey is only a placeholder');
        expect(T.buildTilePrompt({ kind: 'objects' }).prompt).not.toContain('contact shadow');
        expect(T.buildTilePrompt({ kind: 'objects' }).pixel).toBeNull();
    });
});

describe('SheetTools — drawing at game resolution', () => {
    it('asks for the art resolution and magnifies the guide to match', () => {
        const sp = T.buildTilePrompt({ kind: 'objects', withGuide: true, tile: 32 });
        expect(sp.pixel).toEqual({ width: 192, height: 128, magnify: 5 });
        expect(sp.prompt).toContain('only 192×128 real pixels');
        expect(sp.prompt).toContain('5×5 block');
        expect(T.buildTilePrompt({ kind: 'objects', withGuide: true, pixelGrid: false }).pixel).toBeNull();

        const g = T.layoutGuide('objects', 6, 4, 32, 5);
        expect([g.width, g.height]).toEqual([960, 640]);
        expect(g.art).toEqual({ width: 192, height: 128, magnify: 5 });
        // Every art pixel is a flat 5×5 block.
        for (let y = 0; y < 640; y += 37) {
            for (let x = 0; x < 960; x += 41) {
                const bx = Math.floor(x / 5) * 5, by = Math.floor(y / 5) * 5;
                expect(px(g.data, 960, x, y)).toEqual(px(g.data, 960, bx, by));
            }
        }
    });

    it('reads one art pixel per block back, ignoring blurred block edges and drift', () => {
        // 8×6 art, drawn as 6.5px blocks shifted 2px right, edges smeared.
        const art = (ax, ay) => ((ax + ay) % 3 === 0 ? [200, 40, 40, 255] : ax < 2 ? CLEAR : [30, 90, 200, 255]);
        const p = 6.5, W = 56, H = 39;
        const d = image(W, H, (x, y) => {
            const fx = (x - 2) / p, fy = y / p;
            const ax = Math.min(7, Math.max(0, Math.floor(fx))), ay = Math.min(5, Math.floor(fy));
            const edge = fx - Math.floor(fx) < 0.12 || fy - Math.floor(fy) < 0.12;
            return edge ? [128, 128, 128, 255] : art(ax, ay);
        });
        const r = T.sampleArtPixels(d, W, H, 8, 6);
        expect([r.width, r.height]).toEqual([8, 6]);
        expect(r.pitch.x).toBeCloseTo(6.5, 0);
        for (let ay = 0; ay < 6; ay++) {
            for (let ax = 1; ax < 8; ax++) expect(px(r.data, 8, ax, ay)).toEqual(art(ax, ay));
        }
    });

    it('clears a grey guide box kept as a backdrop, but not grey walled inside a sprite', () => {
        // Clear border, grey box, a sprite with a dark outline round grey metal.
        const d = image(20, 20, (x, y) => {
            if (x < 2 || y < 2 || x >= 18 || y >= 18) return CLEAR;
            if (x >= 6 && x < 14 && y >= 6 && y < 14) {
                return x === 6 || y === 6 || x === 13 || y === 13 ? [20, 20, 20, 255] : [126, 128, 127, 255];
            }
            return [131, 120, 129, 255]; // pink-tinged JPEG grey
        });
        expect(T.keyOutGuideFill(d, 20, 20)).toBe(16 * 16 - 64);
        expect(px(d, 20, 3, 3)[3]).toBe(0);
        expect(px(d, 20, 9, 9)).toEqual([126, 128, 127, 255]);
    });

    it('keeps art-resolution sprites unscaled, giving a wide one more tiles', () => {
        const d = image(60, 12, (x, y) => (y >= 2 && y < 10 && ((x >= 2 && x < 8) || (x >= 14 && x < 54)) ? [9, 99, 9, 255] : CLEAR));
        const r = T.relayoutSprites(d, 60, 12, { tile: 16, cols: 8, keep: true });
        expect(r.count).toBe(2);
        expect(r.scale).toBe(1);
        expect(r.cols).toBe(4); // 1 tile + 3 tiles for the 40px one
        let n = 0;
        for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++;
        expect(n).toBe(6 * 8 + 40 * 8);
    });
});
