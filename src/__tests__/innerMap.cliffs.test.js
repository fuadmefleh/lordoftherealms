/**
 * Crags on mountainous inner maps (world/innerMap/cliffs.js): raised ground
 * drawn from the cliff sheets, square or angled, impassable, never cutting
 * the open ground apart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_MAP_JSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/innerMap.json'), 'utf-8'));

const tile = (id) => ({ terrain: { id }, elevation: 0.7, temperature: 0.4, moisture: 0.4 });
const crags = (tiles) => tiles.flat().filter(t => t._cragTop !== undefined);

beforeEach(() => {
    InnerMap.initialize(JSON.parse(JSON.stringify(INNER_MAP_JSON)));
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    DataLoader._gamedata = { terrainNineTileBrushes: [] };
});

describe('crags', () => {
    it('stand on a mountain, impassable, each cell drawn from the cliff sheet or open on top', () => {
        const tiles = InnerMap.generate(tile('mountain'), 5, 7, null);
        const cs = crags(tiles);
        expect(cs.length).toBeGreaterThan(200);
        for (const t of cs) {
            expect(t.subTerrain.passable).toBe(false);
            expect(t.subTerrain.id).toBe('cliff');
            if (t._crag) {
                expect(t._crag.c).toBeGreaterThanOrEqual(0);
                expect(t._crag.c).toBeLessThan(16);
                expect(t._crag.r).toBeLessThan(14);
            } else {
                expect(t._cragTop).toBe(true); // only the open top shows the ground through
            }
        }
    });

    it('come in both shapes: square faces and angled fronts', () => {
        let square = 0, angled = 0;
        for (let i = 0; i < 6; i++) {
            const cs = crags(InnerMap.generate(tile('mountain'), 10 + i, 3, null));
            square += cs.filter(t => t._crag && t._crag.c === 5 && t._crag.r === 8).length;
            angled += cs.filter(t => t._crag && t._crag.c === 0 && t._crag.r === 8).length;
        }
        expect(square).toBeGreaterThan(0);
        expect(angled).toBeGreaterThan(0);
    });

    it('are the same for the same hex, and none on grassland', () => {
        const key = (tiles) => crags(tiles).map(t => `${t.q},${t.r}`).join('|');
        expect(key(InnerMap.generate(tile('mountain'), 5, 7, null))).toBe(key(InnerMap.generate(tile('mountain'), 5, 7, null)));
        expect(crags(InnerMap.generate(tile('grassland'), 5, 7, null)).length).toBe(0);
    });

    it('leave the start and the edges clear, and the open ground all of a piece', () => {
        const tiles = InnerMap.generate(tile('mountain'), 5, 7, null);
        const W = InnerMap.width, H = InnerMap.height;
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        for (const t of crags(tiles)) {
            expect(Math.max(Math.abs(t.q - cq), Math.abs(t.r - cr))).toBeGreaterThanOrEqual(9);
            expect(t.q).toBeGreaterThanOrEqual(4);
            expect(t.r).toBeGreaterThanOrEqual(4);
            expect(t.q).toBeLessThan(W - 4);
            expect(t.r).toBeLessThan(H - 4);
        }
        // Every walkable tile reachable from the start, round the crags (water aside)
        const open = (t) => t && t._cragTop === undefined && !t._wet && !t._sea && t.subTerrain.passable;
        const seen = new Set([`${cq},${cr}`]);
        const queue = [[cq, cr]];
        while (queue.length) {
            const [q, r] = queue.pop();
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = `${q + dq},${r + dr}`;
                if (seen.has(k)) continue;
                const t = tiles[r + dr] && tiles[r + dr][q + dq];
                if (!open(t)) continue;
                seen.add(k);
                queue.push([q + dq, r + dr]);
            }
        }
        // Tiles cut off by crags alone: open ground next to a crag but not reached
        const cut = tiles.flat().filter(t => open(t) && !seen.has(`${t.q},${t.r}`)
            && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => {
                const n = tiles[t.r + dr] && tiles[t.r + dr][t.q + dq];
                return n && n._cragTop !== undefined;
            }));
        expect(cut.length).toBe(0);
    });
});
