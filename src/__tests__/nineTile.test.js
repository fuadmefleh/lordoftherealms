/**
 * Nine-tile auto-tiling: the game (core/nineTile.js, used by InnerMap) and
 * the terrain editor (EditorCore twin in editor-core.js) must pick the same
 * tile for every cell, so the editor's painting and preview show what the
 * game will draw.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../../editor-core.js';
import { pickNineTileSlot, resolveBrushSeason, resolveNineTileCell, erodeUntileableStubs } from '../core/nineTile.js';

let EC;
beforeAll(() => {
    EC = globalThis.EditorCore;
});

const t = (name) => ({ sheetPath: 'sheet.png', sx: 0, sy: 0, name });
const grid = (prefix) => [0, 1, 2].map(r => [0, 1, 2].map(c => t(`${prefix}${r}${c}`)));
const BRUSH = {
    tiles: grid('d'),
    insideCorners: [t('icTL'), t('icTR'), t('icBL'), t('icBR')],
    seasonTiles: { spring: grid('d'), summer: grid('s'), autumn: [[null, null, null], [null, null, null], [null, null, null]] },
    seasonInsideCorners: { spring: [t('icTL'), t('icTR'), t('icBL'), t('icBR')], summer: [null, null, null, null] },
    seasonAltFills: { spring: [t('alt1'), t('alt2')] },
};

// Deterministic masks (xorshift) so failures reproduce
function randomMask(seed, w, h, density) {
    let s = seed;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; };
    return Array.from({ length: h }, () => Array.from({ length: w }, () => rnd() < density));
}
const hasIn = (mask, q, r) => (dq, dr) => {
    const nq = q + dq, nr = r + dr;
    return nr >= 0 && nr < mask.length && nq >= 0 && nq < mask[0].length && !!mask[nr][nq];
};

describe('nine-tile resolver (game and editor agree)', () => {
    it('picks the same slot and tile for every cell of many masks and seasons', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const mask = randomMask(seed * 7919, 12, 9, 0.55 + (seed % 4) * 0.1);
            for (const season of ['spring', 'summer', 'autumn', 'winter', null]) {
                for (let r = 0; r < mask.length; r++) {
                    for (let q = 0; q < mask[0].length; q++) {
                        if (!mask[r][q]) continue;
                        const a = resolveNineTileCell(BRUSH, season, hasIn(mask, q, r), q, r);
                        const b = EC.resolveNineTileCell(BRUSH, season, hasIn(mask, q, r), q, r);
                        expect(b).toEqual(a);
                    }
                }
            }
            const m1 = mask.map(row => row.slice());
            const m2 = mask.map(row => row.slice());
            expect(EC.erodeUntileableStubs(m2)).toEqual(erodeUntileableStubs(m1));
        }
    });

    it('maps neighbourhoods to the 3×3 grid and inside corners', () => {
        const all = () => true;
        expect(pickNineTileSlot(all)).toEqual({ row: 1, col: 1 });
        // Only right and bottom neighbours: top-left corner
        expect(pickNineTileSlot((dq, dr) => (dq >= 0 && dr >= 0))).toEqual({ row: 0, col: 0 });
        // Everything but the top-right diagonal: inside corner TR
        expect(pickNineTileSlot((dq, dr) => !(dq === 1 && dr === -1))).toEqual({ ic: 1 });
        // A one-wide vertical strip has no slot
        expect(pickNineTileSlot((dq) => dq === 0)).toBeNull();
        expect(EC.pickNineTileSlot((dq) => dq === 0)).toBeNull();
    });

    it('explains fallbacks: strips and missing inside corners use the centre', () => {
        const strip = resolveNineTileCell(BRUSH, 'summer', (dq) => dq === 0, 0, 0);
        expect(strip.slot).toEqual({ row: 1, col: 1 });
        expect(strip.fallback).toBe('strip');
        const noIC = { tiles: grid('d') };
        const ic = resolveNineTileCell(noIC, null, (dq, dr) => !(dq === -1 && dr === -1), 0, 0);
        expect(ic.fallback).toBe('noInsideCorner');
        expect(ic.tile.name).toBe('d11');
    });

    it('uses a season grid only when it holds tiles', () => {
        expect(resolveBrushSeason(BRUSH, 'summer').tilesGrid[0][0].name).toBe('s00');
        // Autumn was saved empty: the default grid stands in
        expect(resolveBrushSeason(BRUSH, 'autumn').tilesGrid[0][0].name).toBe('d00');
        // Summer's inside corners were saved empty: the default ones stand in
        expect(resolveBrushSeason(BRUSH, 'summer').cornersArr[1].name).toBe('icTR');
    });

    it('varies the centre with alternate fills by position', () => {
        const names = new Set();
        for (let q = 0; q < 30; q++) names.add(resolveNineTileCell(BRUSH, 'spring', () => true, q, 3).tile.name);
        expect([...names].sort()).toEqual(['alt1', 'alt2', 'd11']);
    });
});

describe('preview masks', () => {
    it('every preview shape is drawable with no strips left', () => {
        for (const shape of ['pond', 'ring', 'coast', 'random']) {
            const mask = EC.nineTilePreviewMask(shape, 14, 9, 5);
            let painted = 0;
            for (let r = 0; r < 9; r++) {
                for (let q = 0; q < 14; q++) {
                    if (!mask[r][q]) continue;
                    painted++;
                    expect(EC.pickNineTileSlot(hasIn(mask, q, r))).not.toBeNull();
                }
            }
            expect(painted).toBeGreaterThan(20);
        }
    });

    it('the pond and ring shapes need every slot, inside corners included', () => {
        const used = new Set();
        for (const shape of ['pond', 'ring']) {
            const mask = EC.nineTilePreviewMask(shape, 14, 9);
            for (let r = 0; r < 9; r++) {
                for (let q = 0; q < 14; q++) {
                    if (!mask[r][q]) continue;
                    const s = EC.pickNineTileSlot(hasIn(mask, q, r));
                    used.add(s.ic !== undefined ? 'ic' + s.ic : `${s.row}${s.col}`);
                }
            }
        }
        expect([...used].sort()).toEqual(['00', '01', '02', '10', '11', '12', '20', '21', '22', 'ic0', 'ic1', 'ic2', 'ic3']);
    });
});
