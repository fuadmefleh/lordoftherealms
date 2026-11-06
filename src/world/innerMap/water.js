// InnerMap — the water of a hex: ponds, its river, a lake, and their shores.
//
// Every body of water on an inner map is a set of cells flagged `_wet` with a
// `_waterKind` ('pond' | 'river' | 'lake' | 'sea'). Each painter marks its
// cells and then _stampWater auto-tiles the whole wet mask at once with the
// water 9-tile brush, so a river running into a pond or out into the sea
// joins it without a seam. With the default LPC brush the water more than a
// couple of cells from land is drawn deep (the dark-water block of the same
// terrain sheet).
//
//   • Ponds (_paintWaterFeatures): organic blobs of one to a few lobes, sized
//     and counted by the terrain (data/innerMap.json waterFeatures) and the
//     hex's moisture. Drawn on the map's own generation RNG.
//   • The river (_layRiver): a hex with a world river (terrainGen 2 rivers:
//     tile.hasRiver / riverDir) has it run across the map from the sides it
//     flows in by to the side it flows out by (world hex direction → map
//     edge), winding round the town (never over buildings, lots or the town's
//     heart), with a bridge (or ford) where a street crosses it and a ford or
//     two in the wilds so the map is never cut in half. A source hex starts it
//     at a spring; a river that ends here pools.
//   • A lake hex (_lakeMask, used by _layOpenSea): a large lake with land
//     round the sides that face land.
//   • Dressing (_dressWater): sparse reeds on the shallows, cattails and lily
//     pads on still water near the shore, a few stones on the bank and
//     stepping stones across a ford (decals in tile.decor, drawn by the
//     terrain-detail layer). Deep water stays impassable; the brush's shore
//     edges stay walkable shallows.
//
// The river, lake and dressing draw on hash streams of the hex, never on the
// map's generation RNG, so they are the same on every visit.

import { InnerMap } from './_ref.js';
import { Hex } from '../../core/hex.js';
import { resolveBrushSeason, resolveNineTileCell, erodeUntileableStubs } from '../../core/nineTile.js';

// Used only if innerMap.json is missing waterSubTerrain (e.g. stale modded gamedata).
const DEFAULT_POND = { id: 'pond_water', name: 'Water', icon: '💧', color: '#3a6ea5', passable: false };
const WATER_SUB = {
    sea: { id: 'sea_water', name: 'Sea', icon: '🌊', color: '#2a5f8a', passable: false },
    lake: { id: 'lake_water', name: 'Lake', icon: '💧', color: '#2f6f9a', passable: false },
    river: { id: 'river_water', name: 'River', icon: '🌊', color: '#3a78a8', passable: false },
};
const FORD = { id: 'ford', name: 'Ford', icon: '🪨', color: '#5a8fb0', passable: true };
const BRIDGE_SUB = { id: 'bridge', name: 'Bridge', icon: '🌉', color: '#8b6a45', passable: true };
const BRIDGE_SHEET = 'assets/lpc/Structure/Bridges/Wood Bridge A - No Rails.png';
// Opaque plank cells of the bridge sheet: boards across a north–south crossing, and across an east–west one
const PLANKS_FOR_NS = [1, 1];
const PLANKS_FOR_EW = [8, 1];

// World hex sides in Hex.neighbors order (E, NE, NW, W, SW, SE)
const SIDES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
const WATER_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);

const DEFAULTS = {
    rivers: {
        radius: [2.8, 3.8], radiusPerInflow: 0.4, maxRadius: 5, edgeJitter: 10, meander: 5, bend: [3, 7], bendLength: [28, 48],
        roadCost: 60, roadNearCost: 6, borderCost: 6, clearance: 2, wildFords: [1, 2],
        springRadius: 3.5, poolRadius: [5, 7],
    },
    lake: { shoreDepth: [14, 22], wobble: 4 },
    deep: { pond: 3, river: 2, lake: 3, sea: 3 },
    dressing: {
        reeds: 0.1, tallReeds: 0.3, cattails: 0.06, lilies: 0.05, lilyFlower: 0.3, rocks: 0.025, fordStones: 0.5,
        sprites: {
            plants: 'assets/lpc/Terrain/plants_{season}.png',
            rocksSheet: 'assets/lpc/Terrain/Rocks, Grasslands.png',
            reeds: [[8, 1], [9, 1], [10, 1]],
            tallReeds: [[11, 0], [12, 0], [13, 0]],
            cattails: [[14, 2], [15, 2], [14, 3], [15, 3], [14, 4], [15, 4]],
            lilies: [[12, 2], [13, 2], [12, 3], [13, 3], [12, 4], [13, 4]],
            lilyFlowers: [[14, 0], [15, 0], [14, 1], [15, 1]],
            rocks: [[5, 2], [4, 2], [5, 3], [5, 6], [4, 6], [5, 10], [4, 10]],
            stones: [[5, 3], [5, 7], [5, 11]],
        },
    },
};

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A hash stream of a hex (independent of the map's generation RNG) */
function _rng(a, b, salt) {
    let s = (((a * 73856093) ^ (b * 19349663)) + salt) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Smooth value noise in 0..1 over the map, seeded by `seed` */
function _valueNoise(seed, scale) {
    const h = (x, y) => {
        let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const s = (t) => t * t * (3 - 2 * t);
    return (q, r) => {
        const x = q / scale, y = r / scale;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = s(x - x0), fy = s(y - y0);
        const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
}

/** Minimal binary heap of [priority, value] for Dijkstra */
class _Heap {
    constructor() { this.p = []; this.v = []; }
    get size() { return this.p.length; }
    push(pri, val) {
        const p = this.p, v = this.v;
        let i = p.length;
        p.push(pri); v.push(val);
        while (i > 0) {
            const j = (i - 1) >> 1;
            if (p[j] <= pri) break;
            p[i] = p[j]; v[i] = v[j]; i = j;
        }
        p[i] = pri; v[i] = val;
    }
    pop() {
        const p = this.p, v = this.v;
        const top = v[0];
        const lp = p.pop(), lv = v.pop();
        if (p.length) {
            let i = 0;
            const n = p.length;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && p[c + 1] < p[c]) c++;
                if (p[c] >= lp) break;
                p[i] = p[c]; v[i] = v[c]; i = c;
            }
            p[i] = lp; v[i] = lv;
        }
        return top;
    }
}

/** What water must never cover: buildings, lots, the town's heart, objects, piers and decks */
function _isHard(t) {
    return !!(t && (t.building || t.buildingInfo || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart
        || t._lot || t._townCore || t._plaza || t._pier || t._deck));
}

/** Chebyshev distance (capped at maxR + 1) from each cell to the nearest cell where pred holds */
function _distanceTo(tiles, pred, maxR) {
    const H = tiles.length, W = H ? tiles[0].length : 0;
    const dist = new Int16Array(W * H).fill(maxR + 1);
    let frontier = [];
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (pred(tiles[r][q], q, r)) { dist[r * W + q] = 0; frontier.push(r * W + q); }
    for (let d = 1; d <= maxR && frontier.length; d++) {
        const next = [];
        for (const i of frontier) {
            const q = i % W, r = (i - q) / W;
            for (const [dq, dr] of N8) {
                const x = q + dq, y = r + dr;
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                const k = y * W + x;
                if (dist[k] > d) { dist[k] = d; next.push(k); }
            }
        }
        frontier = next;
    }
    return dist;
}

Object.assign(InnerMap, {
    /** Water settings (innerMap.json "water"), over the defaults */
    _waterCfg(part) {
        const cfg = (this.CONFIG && this.CONFIG.water) || {};
        const d = DEFAULTS[part] || {};
        const c = cfg[part] || {};
        if (part === 'dressing') return { ...d, ...c, sprites: { ...d.sprites, ...(c.sprites || {}) } };
        return { ...d, ...c };
    },

    // ══════════════════════════════════════════════════════════════
    // STAMPING — the whole wet mask at once
    // ══════════════════════════════════════════════════════════════

    /**
     * Mark cells as water of a kind (clears what stood there; a street under
     * the water ends at it). Cells already wet keep their kind.
     */
    /**
     * A street wanders, but a bridge runs straight: each crossing (a run of
     * street cells under the river) becomes a rectangle across the flow, as
     * wide as the street where it meets both banks, so both ends still join it.
     * Returns the cells to plank and the street cells left to the water.
     */
    _straightBridges(roadCells, near, W, flowAt) {
        const pos = (c) => [c % W, (c - (c % W)) / W];
        const left = new Set(roadCells);
        const cells = new Set(), dropped = [];
        for (const start of roadCells) {
            if (!left.has(start)) continue;
            // one crossing: the 8-connected run of street cells under the water
            const group = [];
            const stack = [start];
            left.delete(start);
            while (stack.length) {
                const c = stack.pop();
                group.push(c);
                const [q, r] = pos(c);
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dq = -1; dq <= 1; dq++) {
                        const n = (r + dr) * W + (q + dq);
                        if ((dq || dr) && q + dq >= 0 && q + dq < W && left.has(n)) { left.delete(n); stack.push(n); }
                    }
                }
            }
            const pts = group.map(pos);
            // the river runs east–west here → the bridge runs north–south (along r)
            const ns = flowAt(group[Math.floor(group.length / 2)]) === 'EW';
            const along = (p) => (ns ? p[1] : p[0]), across = (p) => (ns ? p[0] : p[1]);
            const lo = Math.min(...pts.map(along)), hi = Math.max(...pts.map(along));
            const ends = pts.filter(p => along(p) === lo || along(p) === hi).map(across);
            const a0 = Math.min(...ends), a1 = Math.max(...ends);
            const inRect = new Set();
            for (let s = lo; s <= hi; s++) {
                for (let a = a0; a <= a1; a++) {
                    const c = ns ? s * W + a : a * W + s;
                    // plank over the water (and the street itself); dry ground stays as it is
                    if (near.has(c) || group.includes(c)) { inRect.add(c); cells.add(c); }
                }
            }
            for (const c of group) if (!inRect.has(c)) dropped.push(c);
        }
        return { cells: [...cells], dropped };
    },

    _markWet(tiles, cells, kind) {
        for (const [q, r] of cells) {
            const t = tiles[r] && tiles[r][q];
            if (!t || t._pier || t._deck) continue;
            if (!t._wet) t._waterKind = kind;
            t._wet = true;
            // An object the water reaches goes whole: a field or a fence half on
            // the shore would still draw itself, all of it, out over the water
            if (t.customObject || t.customObjectPart) this._clearWholeObject(tiles, q, r);
            t.customObject = null;
            t.customObjectPart = null;
            if (!t._bridge && !t._ford) { t.isRoad = false; t.paving = null; }
        }
    },

    /**
     * Take away the whole custom object (its anchor and every footprint part)
     * that has a part at (q, r). Objects anchor bottom-left and rise up and to
     * the right, so the parts lie in a box above and right of the anchor.
     */
    _clearWholeObject(tiles, q, r) {
        const t = tiles[r] && tiles[r][q];
        if (!t) return;
        const aq = t.customObjectPart ? t.customObjectPart.anchorQ : q;
        const ar = t.customObjectPart ? t.customObjectPart.anchorR : r;
        const anchor = tiles[ar] && tiles[ar][aq];
        if (anchor && anchor.customObject) anchor.customObject = null;
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const REACH = 24;
        for (let y = Math.max(0, ar - REACH); y <= Math.min(H - 1, ar + 1); y++) {
            for (let x = Math.max(0, aq - 1); x <= Math.min(W - 1, aq + REACH); x++) {
                const p = tiles[y][x].customObjectPart;
                if (p && p.anchorQ === aq && p.anchorR === ar) tiles[y][x].customObjectPart = null;
            }
        }
    },

    /**
     * Auto-tile every wet cell with the water brush: shore edges (walkable
     * shallows) where it meets land, impassable open water inside, deep water
     * well out from the shore. Off the map's edge the water runs on (the sea
     * and a river run off the map; a shore only curls where there is land).
     * Piers, bridges and fords keep their own look and footing.
     */
    _stampWater(tiles) {
        const H = tiles.length, W = H ? tiles[0].length : 0;
        if (!W) return;
        const mask = tiles.map(row => row.map(t => !!(t && t._wet)));
        erodeUntileableStubs(mask);
        const structure = (t) => !!(t._pier || t._bridge || t._deck);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (t && t._wet && !mask[r][q] && !structure(t) && !t._ford) {
                    // a one-wide sliver no shore tile can draw: dry land after all
                    t._wet = false;
                    delete t._waterKind;
                }
            }
        }
        const brush = this._getWaterNineTileBrush();
        const pondDef = (this.CONFIG && this.CONFIG.waterSubTerrain) || DEFAULT_POND;
        const subOf = (kind) => (kind === 'pond' || !WATER_SUB[kind] ? pondDef : WATER_SUB[kind]);
        const clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
        const hasAt = (m) => (q, r) => (dq, dr) => !!m[clamp(r + dr, H)][clamp(q + dq, W)];
        const season = (this.season || 'spring').toLowerCase();
        const has = hasAt(mask);

        if (!brush) {
            // No shore brush in the data: plain water, drawn by its fill
            for (let r = 0; r < H; r++) {
                for (let q = 0; q < W; q++) {
                    const t = tiles[r][q];
                    if (!mask[r][q] || structure(t)) continue;
                    t.terrainDetail = { fillCategory: 'water', layer: 'water' };
                    if (t._ford) continue;
                    t.subTerrain = { ...subOf(t._waterKind) };
                    t.baseTerrain = 'water';
                    t._sea = t._waterKind === 'sea' || t._waterKind === 'lake';
                }
            }
            return;
        }

        const blockedGrid = [0, 1, 2].map(row => [0, 1, 2].map(col => this._isBrushSlotImpassable(brush, { row, col })));
        const blockedIC = [0, 1, 2, 3].map(ic => this._isBrushSlotImpassable(brush, { ic }));
        const resolved = resolveBrushSeason(brush, season);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!mask[r][q]) continue;
                const t = tiles[r][q];
                if (structure(t)) continue;
                const { slot: info, tile: ref } = resolveNineTileCell(brush, season, has(q, r), q, r, resolved);
                t.terrainDetail = ref && ref.sheetPath
                    ? { sheetPath: ref.sheetPath, sx: Number.isFinite(ref.sx) ? ref.sx : 0, sy: Number.isFinite(ref.sy) ? ref.sy : 0, sw: 32, sh: 32, layer: 'water' }
                    : { fillCategory: 'water', layer: 'water' };
                const blocked = info.ic !== undefined ? blockedIC[info.ic] : blockedGrid[info.row][info.col];
                t._shallow = !blocked;
                if (t._ford) continue;
                if (!blocked) { t._sea = false; continue; }
                t.subTerrain = { ...subOf(t._waterKind) };
                t.baseTerrain = 'water';
                t._sea = t._waterKind === 'sea' || t._waterKind === 'lake';
            }
        }

        // Bare ground coming down to the water: a dirt bank there, not a square of grass
        this._dirtBankShores(tiles);

        // Deep water, with the LPC sheet's own dark-water block (a modder's
        // brush may be another water altogether, so only with the default one)
        if (!brush.lpcDefault) return;
        const deepCfg = this._waterCfg('deep');
        const maxD = Math.max(1, ...Object.values(deepCfg).map(Number).filter(Number.isFinite));
        // (a bridge or a ford is a shallow crossing; a pier and a deck stand over the deep)
        const crossing = (t) => !!(t._bridge || t._ford);
        const dist = _distanceTo(tiles, (t, q, r) => !mask[r][q] || crossing(t), maxD);
        const deep = tiles.map((row, r) => row.map((t, q) => {
            if (!mask[r][q] || crossing(t)) return false;
            const need = Number(deepCfg[t._waterKind || 'pond']);
            return Number.isFinite(need) && need > 0 && dist[r * W + q] >= need;
        }));
        erodeUntileableStubs(deep);
        const deepBrush = this._deepWaterBrush();
        const deepResolved = resolveBrushSeason(deepBrush, season);
        const hasDeep = hasAt(deep);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (structure(t)) { t._deep = false; continue; } // a deck or pier keeps its own footing and look
                t._deep = !!deep[r][q];
                if (!deep[r][q]) continue;
                const { tile: ref } = resolveNineTileCell(deepBrush, season, hasDeep(q, r), q, r, deepResolved);
                if (ref && ref.sheetPath) t.terrainDetail = { sheetPath: ref.sheetPath, sx: ref.sx, sy: ref.sy, sw: 32, sh: 32, layer: 'water' };
            }
        }
    },

    /**
     * Where bare ground (a road, a town's trodden soil, dirt the grass never
     * covered) comes down to the water, the shore piece beside it is the
     * dirt-banked one, not the grass-banked: the default LPC shore pieces
     * carry grass on their land side, so a road reaching the water would butt
     * against a square of grass. Same slot, the dirt-banked block six columns
     * over (shore cols 0-2 -> 6-8, rows 10-12; inside corners cols 0-1 -> 6-7,
     * rows 13-14). Only the default sheets' pieces are touched (a modder's
     * brush is left alone). Run after the water is stamped, and again once a
     * town's roads are down (world/innerMap/interiors.js).
     * @returns {number} how many shore pieces were changed
     */
    _dirtBankShores(tiles) {
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const bare = (t) => !!(t && !t._wet && !t.building && t.subTerrain && t.subTerrain.passable &&
            (t.isRoad || t._townSoil || this.isBareDug(t) || !t.terrainDetail));
        let n = 0;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const d = tiles[r][q] && tiles[r][q].terrainDetail;
                if (!d || d.layer !== 'water' || !d.sheetPath || !/Terrain\/terrain_[a-z_]+\.png$/.test(d.sheetPath)) continue;
                const c = Math.round(d.sx / 32), row = Math.round(d.sy / 32);
                const shore = row >= 10 && row <= 12 && c <= 2 && !(c === 1 && row === 11);
                const corner = (row === 13 || row === 14) && c <= 1;
                if (!shore && !corner) continue;
                const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => {
                    const y = r + dr, x = q + dq;
                    return y >= 0 && y < H && x >= 0 && x < W && bare(tiles[y][x]);
                });
                if (!nb) continue;
                d.sx = (c + 6) * 32;
                n++;
            }
        }
        return n;
    },

    /**
     * Deep water within open water, from the LPC terrain sheets: the 3×3
     * block at cols 0-2, rows 23-25 (shallow round the edge, dark in the
     * middle) and the inside corners from the shallow-spot-in-deep block at
     * cols 3-4, rows 23-24.
     */
    _deepWaterBrush() {
        if (this._deepWater) return this._deepWater;
        const seasonTiles = {};
        const seasonInsideCorners = {};
        for (const season of ['spring', 'summer', 'autumn', 'winter']) {
            const sheet = `assets/lpc/Terrain/terrain_${season}.png`;
            const cell = (c, r) => ({ sheetPath: sheet, sx: c * 32, sy: r * 32 });
            seasonTiles[season] = [0, 1, 2].map(row => [0, 1, 2].map(col => cell(col, 23 + row)));
            seasonInsideCorners[season] = [cell(4, 24), cell(3, 24), cell(4, 23), cell(3, 23)];
        }
        this._deepWater = { name: 'Deep Water (Default)', category: 'water', tiles: seasonTiles.spring, insideCorners: seasonInsideCorners.spring, seasonTiles, seasonInsideCorners };
        return this._deepWater;
    },

    // ══════════════════════════════════════════════════════════════
    // PONDS
    // ══════════════════════════════════════════════════════════════

    /**
     * Procedurally place ponds on an inner map. Per-parent-terrain config
     * from innerMap.json:
     *   "waterFeatures": { "chance": 0.6, "count": [1, 3], "radius": [3, 10], "lobes": [1, 3] }
     * (an older "size": [min, max] in cells still works). A wetter hex (its
     * moisture) has ponds more often, more of them and larger. No config → no
     * water. Each pond is an organic blob of one or more overlapping lobes with
     * a wavering rim; ponds keep off the map border, roads, buildings, lots,
     * objects, the town's heart and the player-start area, and enclosed dry
     * pockets are filled in so a pond can't cut a patch of the map off.
     */
    _paintWaterFeatures(tiles, terrainId, rng, worldTile = null) {
        const terrainCfg = this.CONFIG && this.CONFIG.subTerrains ? this.CONFIG.subTerrains[terrainId] : null;
        const cfg = terrainCfg ? terrainCfg.waterFeatures : null;
        if (!cfg) return;
        if (!this._getWaterNineTileBrush()) return;
        const moist = worldTile && Number.isFinite(worldTile.moisture) ? worldTile.moisture : 0.5;
        const wet = 0.75 + 0.5 * Math.max(0, Math.min(1, moist)); // 0.75 dry … 1.25 sodden
        const chance = Math.min(1, (Number.isFinite(cfg.chance) ? cfg.chance : 0.5) * wet);
        if (rng() > chance) return;

        const H = this.height, W = this.width;
        const [c0, c1] = Array.isArray(cfg.count) ? cfg.count : [1, 1];
        let count = c0 + Math.floor(rng() * (c1 - c0 + 1));
        if (rng() < (moist - 0.55) * 1.5) count++;
        const radius = Array.isArray(cfg.radius) ? cfg.radius
            : Array.isArray(cfg.size) ? cfg.size.map(s => Math.sqrt(s / Math.PI)) : [3, 6];
        const [l0, l1] = Array.isArray(cfg.lobes) ? cfg.lobes : [1, 2];

        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const MARGIN = 2;      // keep off the map border (clean edge, can't disconnect the map)
        const START_CLEAR = 6; // keep clear of the player-start tile
        const townDist = _distanceTo(tiles, _isHard, 2);
        const canHold = (q, r) => {
            if (q < MARGIN || q >= W - MARGIN || r < MARGIN || r >= H - MARGIN) return false;
            if (Math.max(Math.abs(q - cq), Math.abs(r - cr)) <= START_CLEAR) return false;
            const t = tiles[r][q];
            if (!t || t.isRoad || t._wet || townDist[r * W + q] <= 2) return false;
            return true;
        };

        const mask = Array.from({ length: H }, () => Array(W).fill(false));
        for (let p = 0; p < count; p++) {
            // small ponds are common, big ones rare; a wet hex's run larger
            const R = Math.max(2.5, (radius[0] + (radius[1] - radius[0]) * Math.pow(rng(), 1.6)) * Math.sqrt(wet));
            const nLobes = l0 + Math.floor(rng() * (l1 - l0 + 1));
            const lobes = [{ x: 0, y: 0, R }];
            for (let i = 1; i < nLobes; i++) {
                const a = rng() * Math.PI * 2, d = R * (0.5 + 0.5 * rng());
                lobes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, R: R * (0.4 + 0.4 * rng()) });
            }
            const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
            const amp = 0.1 + 0.12 * rng();
            const ext = Math.ceil(R * 2 + 2);
            const inside = (dx, dy) => lobes.some(l => {
                const x = dx - l.x, y = dy - l.y;
                const a = Math.atan2(y, x);
                const rim = l.R * (1 + amp * (0.55 * Math.sin(3 * a + ph[0]) + 0.3 * Math.sin(5 * a + ph[1]) + 0.15 * Math.sin(7 * a + ph[2])));
                return x * x + y * y <= rim * rim;
            });
            for (let tries = 0; tries < 30; tries++) {
                const x0 = MARGIN + Math.floor(rng() * (W - MARGIN * 2));
                const y0 = MARGIN + Math.floor(rng() * (H - MARGIN * 2));
                const cells = [];
                let refused = 0;
                for (let dy = -ext; dy <= ext; dy++) {
                    for (let dx = -ext; dx <= ext; dx++) {
                        if (!inside(dx, dy)) continue;
                        const q = x0 + dx, r = y0 + dy;
                        if (canHold(q, r)) cells.push([q, r]); else refused++;
                    }
                }
                // most of the blob must fit where it is (a pond isn't sliced by a road or a house)
                if (cells.length < 9 || refused > (cells.length + refused) * 0.12) continue;
                for (const [q, r] of cells) mask[r][q] = true;
                break;
            }
        }

        // Dry pockets the ponds closed round become water
        const outside = Array.from({ length: H }, () => Array(W).fill(false));
        const stack = [];
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
            if ((r === 0 || q === 0 || r === H - 1 || q === W - 1) && !mask[r][q]) { outside[r][q] = true; stack.push(r * W + q); }
        }
        while (stack.length) {
            const i = stack.pop();
            const q = i % W, r = (i - q) / W;
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const x = q + dq, y = r + dr;
                if (x < 0 || y < 0 || x >= W || y >= H || outside[y][x] || mask[y][x]) continue;
                outside[y][x] = true;
                stack.push(y * W + x);
            }
        }
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (!mask[r][q] && !outside[r][q] && canHold(q, r)) mask[r][q] = true;

        erodeUntileableStubs(mask);
        const cells = [];
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (mask[r][q]) cells.push([q, r]);
        if (!cells.length) return;
        this._markWet(tiles, cells, 'pond');
        this._stampWater(tiles);
    },

    // ══════════════════════════════════════════════════════════════
    // RIVERS
    // ══════════════════════════════════════════════════════════════

    /**
     * Which sides of the hex its river runs by: { inflows: [dir…], outflow: dir|null }
     * (Hex.neighbors directions). A generated river hex knows its downstream
     * (riverDir); its upstream are the river neighbours flowing into it. A
     * painted river (no riverDir) joins river neighbours whose elevation
     * differs, and runs out to lower water. A lake hex gathers the rivers
     * flowing into it.
     */
    _riverSides(world, tile, q, r) {
        const out = { inflows: [], outflow: null };
        if (!world || typeof world.getTile !== 'function' || !tile) return out;
        const isLake = !!(tile.terrain && tile.terrain.id === 'lake');
        if (!tile.hasRiver && !isLake) return out;
        const flows = Number.isInteger(tile.riverDir) && tile.riverDir >= 0;
        Hex.neighbors(q, r).forEach((p, i) => {
            const n = world.getTile(p.q, p.r);
            if (!n) return;
            if (n.hasRiver && Number.isInteger(n.riverDir)) {
                if (n.riverDir === (i + 3) % 6) out.inflows.push(i);
            } else if (tile.hasRiver && !flows && !isLake) {
                // painted rivers: join the river beside it, and run out to lower water
                const nWater = !!(n.terrain && WATER_IDS.has(n.terrain.id));
                if (n.hasRiver && Math.abs((n.elevation || 0) - (tile.elevation || 0)) > 0.0001) {
                    if ((n.elevation || 0) < (tile.elevation || 0) && out.outflow === null) out.outflow = i; else out.inflows.push(i);
                } else if (nWater && (tile.elevation || 0) > (n.elevation || 0) && out.outflow === null) out.outflow = i;
            }
        });
        if (flows && !isLake) out.outflow = tile.riverDir;
        return out;
    },

    /**
     * Where a river crosses side `dir` of the map: the middle of that edge
     * (or its half of the top or bottom edge), moved along it by a hash of
     * the two hexes, so a river leaving one map comes into the next where it left.
     */
    _riverGate(world, q, r, dir, W, H, jitter) {
        const n = Hex.neighbors(q, r)[dir];
        const ww = world && world.width;
        const wrap = (x) => (ww ? Hex.wrapQ(x, ww) : x);
        const a = [wrap(q), r], b = [wrap(n.q), n.r];
        const [lo, hi] = (a[1] < b[1] || (a[1] === b[1] && a[0] < b[0])) ? [a, b] : [b, a];
        const j = Math.round((_rng(lo[0] * 31 + hi[0], lo[1] * 17 + hi[1], 4421)() - 0.5) * 2 * jitter);
        const side = SIDES[dir];
        if (side === 'E') return { q: W - 1, r: Math.floor(H / 2) + j, axis: 'r' };
        if (side === 'W') return { q: 0, r: Math.floor(H / 2) + j, axis: 'r' };
        if (side === 'NE') return { q: Math.floor(W * 0.72) + j, r: 0, axis: 'q' };
        if (side === 'NW') return { q: Math.floor(W * 0.28) + j, r: 0, axis: 'q' };
        if (side === 'SW') return { q: Math.floor(W * 0.28) + j, r: H - 1, axis: 'q' };
        return { q: Math.floor(W * 0.72) + j, r: H - 1, axis: 'q' };
    },

    /**
     * The river of the hex across its inner map (generation; hash-placed).
     * Runs after the shore and harbour, so it meets the sea or a lake where
     * the world river does. Returns { path, cells, crossings } or null.
     */
    _layRiver(tiles, worldTile, worldQ, worldR, world, tight = false) {
        const sides = this._riverSides(world, worldTile, worldQ, worldR);
        const isLake = !!(worldTile && worldTile.terrain && worldTile.terrain.id === 'lake');
        if (!sides.inflows.length && sides.outflow === null && !(worldTile && worldTile.hasRiver && !isLake)) return null;
        const cfg = this._waterCfg('rivers');
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const rng = _rng(worldQ, worldR, 5821);
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);

        // (tight: a crowded town left no room — a narrow stream threads its lanes instead)
        const wide = Math.min(cfg.maxRadius, cfg.radius[0] + (cfg.radius[1] - cfg.radius[0]) * rng() + cfg.radiusPerInflow * Math.max(0, sides.inflows.length - 1));
        const baseRad = tight ? Math.min(wide, 1.2) : wide;
        const reach = Math.ceil(baseRad + 1.2);
        const keepOff = tight ? reach : reach + cfg.clearance;
        const hardDist = _distanceTo(tiles, _isHard, keepOff + 1);
        const roadDist = _distanceTo(tiles, (t) => !!(t && t.isRoad && !t._wet), reach + 4);
        const noise = _valueNoise((worldQ * 92821 + worldR * 68917) | 0, 14);
        const noise2 = _valueNoise((worldQ * 31337 + worldR * 7919 + 1) | 0, 5);
        const idx = (q, r) => r * W + q;
        const cost = new Float32Array(W * H);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                const i = idx(q, r);
                // the player comes in at the middle of the map: keep it dry
                if (hardDist[i] <= keepOff || Math.max(Math.abs(q - cq), Math.abs(r - cr)) <= reach + 3) { cost[i] = Infinity; continue; }
                if (t._wet) { cost[i] = 0.4; continue; }
                let c = 1 + cfg.meander * (noise(q, r) * 0.75 + noise2(q, r) * 0.25);
                if (t.isRoad) c += cfg.roadCost;
                else if (roadDist[i] <= reach) c += cfg.roadNearCost;
                // (it keeps in from the map's edge, but for where it comes and goes)
                const edge = Math.min(q, r, W - 1 - q, H - 1 - r);
                if (edge < reach + 8) c += cfg.borderCost * (reach + 8 - edge) / 4;
                cost[i] = c;
            }
        }
        const free = (q, r) => q >= 0 && r >= 0 && q < W && r < H && Number.isFinite(cost[idx(q, r)]);

        // A gate on a side: the open cell nearest the hashed spot along that edge
        const gateCell = (dir) => {
            const g = this._riverGate(world, worldQ, worldR, dir, W, H, cfg.edgeJitter);
            // (off a street that leaves the map by the same side, if it can be)
            for (const clearOfRoads of [true, false]) {
                for (let off = 0; off <= 30; off++) {
                    for (const s of off ? [off, -off] : [0]) {
                        const q = g.axis === 'q' ? g.q + s : g.q, r = g.axis === 'r' ? g.r + s : g.r;
                        if (free(q, r) && (!clearOfRoads || roadDist[idx(q, r)] > reach + 2)) return idx(q, r);
                    }
                }
            }
            return -1;
        };
        // An inland spot (a spring or the pool a river ends in): about `d` cells from the middle, away from `awayDir`
        const inlandCell = (awayDir, d) => {
            const g = awayDir === null ? { q: cq, r: cr } : this._riverGate(world, worldQ, worldR, awayDir, W, H, 0);
            let vx = cq - g.q, vy = cr - g.r;
            const len = Math.hypot(vx, vy) || 1;
            vx /= len; vy /= len;
            if (awayDir === null) { const a = rng() * Math.PI * 2; vx = Math.cos(a); vy = Math.sin(a); }
            const a0 = Math.atan2(vy, vx);
            for (let tries = 0; tries < 40; tries++) {
                const a = a0 + (rng() - 0.5) * 1.6, dd = d * (0.8 + rng() * 0.5);
                const q = Math.round(cq + Math.cos(a) * dd), r = Math.round(cr + Math.sin(a) * dd);
                if (q > 8 && r > 8 && q < W - 9 && r < H - 9 && free(q, r)) return idx(q, r);
            }
            return -1;
        };

        // Dijkstra from `starts` to the first cell where isTarget holds
        const route = (starts, isTarget) => {
            const dist = new Float64Array(W * H).fill(Infinity);
            const prev = new Int32Array(W * H).fill(-1);
            const heap = new _Heap();
            for (const s of starts) { if (s >= 0) { dist[s] = 0; heap.push(0, s); } }
            while (heap.size) {
                const i = heap.pop();
                const d = dist[i];
                if (isTarget(i)) {
                    const path = [];
                    for (let k = i; k >= 0; k = prev[k]) path.push(k);
                    return path.reverse();
                }
                const q = i % W, r = (i - q) / W;
                for (const [dq, dr] of N8) {
                    const x = q + dq, y = r + dr;
                    if (x < 0 || y < 0 || x >= W || y >= H) continue;
                    const k = y * W + x;
                    const ck = cost[k];
                    if (!Number.isFinite(ck)) continue;
                    // no slipping diagonally between two blocked cells
                    if (dq && dr && (!Number.isFinite(cost[r * W + x]) || !Number.isFinite(cost[y * W + q]))) continue;
                    const nd = d + (cost[i] + ck) * 0.5 * (dq && dr ? 1.4142 : 1);
                    if (nd < dist[k]) { dist[k] = nd; prev[k] = i; heap.push(nd, k); }
                }
            }
            return null;
        };

        const standing = (i) => { const t = tiles[(i - (i % W)) / W][i % W]; return !!(t._wet && (t._waterKind === 'sea' || t._waterKind === 'lake')); };
        const hasStanding = tiles.some(row => row.some(t => t._wet && (t._waterKind === 'sea' || t._waterKind === 'lake')));
        const waterSide = (dir) => {
            const p = Hex.neighbors(worldQ, worldR)[dir];
            const n = world && world.getTile(p.q, p.r);
            return !!(n && n.terrain && WATER_IDS.has(n.terrain.id));
        };

        const riverSet = new Set();
        const runs = [];
        const pools = [];
        const inflows = sides.inflows.map(gateCell).filter(i => i >= 0);
        // The main run: from the first way in (or a spring) to the way out (or the water it ends in, or a pool)
        let start = inflows.shift();
        if (start === undefined) {
            start = inlandCell(sides.outflow, 26);
            if (start >= 0) pools.push({ i: start, R: cfg.springRadius });
        }
        if (start === undefined || start < 0) return tight ? null : this._layRiver(tiles, worldTile, worldQ, worldR, world, true);
        let path = null;
        if (sides.outflow !== null && waterSide(sides.outflow) && hasStanding) {
            path = route([start], standing);
        } else if (sides.outflow !== null) {
            const exit = gateCell(sides.outflow);
            if (exit >= 0) path = route([start], (i) => i === exit);
        } else if (hasStanding) {
            path = route([start], standing);
        }
        if (!path && sides.outflow === null && !hasStanding) {
            // it ends here: pooling in a hollow past the middle
            const end = inlandCell(sides.inflows.length ? sides.inflows[0] : null, 24);
            if (end >= 0) {
                path = route([start], (i) => i === end);
                if (path) pools.push({ i: end, R: cfg.poolRadius[0] + (cfg.poolRadius[1] - cfg.poolRadius[0]) * rng() });
            }
        }
        if (!path) return tight ? null : this._layRiver(tiles, worldTile, worldQ, worldR, world, true);
        runs.push({ path, rad: baseRad });
        for (const i of path) riverSet.add(i);
        // Each other river flowing in joins the first
        for (const s of inflows) {
            const trib = route([s], (i) => riverSet.has(i) || standing(i));
            if (!trib) continue;
            runs.push({ path: trib, rad: Math.max(2, baseRad * 0.85) });
            for (const i of trib) riverSet.add(i);
        }

        // ── The course: the route smoothed into curves, and set swinging in bends ──
        for (const run of runs) run.pts = this._riverCourse(run.path, W, H, rng, cfg, (x, y) => free(Math.round(x), Math.round(y)), run !== runs[0]);

        // ── Widen the runs into the river: a disc round each point, the width wavering ──
        const near = new Map(); // cell → { run, k, d }
        runs.forEach((run, ri) => {
            const ph1 = rng() * 6.283, ph2 = rng() * 6.283;
            run.pts.forEach(([x, y], k) => {
                const q0 = Math.round(x), r0 = Math.round(y);
                const rad = Math.max(2, run.rad + 0.55 * Math.sin(k / 13 + ph1) + 0.3 * Math.sin(k / 5 + ph2));
                const e = Math.ceil(rad);
                for (let dr = -e; dr <= e; dr++) {
                    for (let dq = -e; dq <= e; dq++) {
                        const q = q0 + dq, r = r0 + dr;
                        const d = Math.hypot(q - x, r - y);
                        if (d > rad) continue;
                        if (q < 0 || r < 0 || q >= W || r >= H) continue;
                        if (_isHard(tiles[r][q])) continue;
                        const c = idx(q, r);
                        const was = near.get(c);
                        if (!was || d < was.d) near.set(c, { run: ri, k, d });
                    }
                }
            });
        });
        for (const p of pools) {
            const q0 = p.i % W, r0 = (p.i - q0) / W;
            const e = Math.ceil(p.R);
            for (let dr = -e; dr <= e; dr++) {
                for (let dq = -e; dq <= e; dq++) {
                    const a = Math.atan2(dr, dq);
                    if (Math.hypot(dq, dr) > p.R * (1 + 0.12 * Math.sin(3 * a + p.R))) continue;
                    const q = q0 + dq, r = r0 + dr;
                    if (q < 1 || r < 1 || q >= W - 1 || r >= H - 1 || hardDist[idx(q, r)] <= 1) continue;
                    if (Math.max(Math.abs(q - cq), Math.abs(r - cr)) <= 3) continue;
                    if (!near.has(idx(q, r))) near.set(idx(q, r), { run: -1, k: 0, d: 0 });
                }
            }
        }

        // ── Crossings: a bridge (or the ford the world road has) where a street runs over it ──
        const roadCells = [];
        for (const [c] of near) {
            const q = c % W, r = (c - q) / W;
            if (tiles[r][q].isRoad && !tiles[r][q]._wet) roadCells.push(c);
        }
        const cells = [...near.keys()].map(c => [c % W, (c - (c % W)) / W]);
        this._markWet(tiles, cells.filter(([q, r]) => !tiles[r][q].isRoad || tiles[r][q]._wet), 'river');
        const crossings = [];
        const flowAt = (c) => {
            const n = near.get(c);
            const pts = n && n.run >= 0 ? runs[n.run].pts : null;
            if (!pts) return 'EW';
            const a = pts[Math.max(0, n.k - 3)], b = pts[Math.min(pts.length - 1, n.k + 3)];
            return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'EW' : 'NS';
        };
        const kind = worldTile && worldTile.roadCross === 'ford' ? 'ford' : 'bridge';
        const span = kind === 'bridge' ? this._straightBridges(roadCells, near, W, flowAt) : { cells: roadCells, dropped: [] };
        this._markWet(tiles, span.dropped.map(c => [c % W, (c - (c % W)) / W]), 'river');
        for (const c of span.cells) {
            const q = c % W, r = (c - q) / W;
            const t = tiles[r][q];
            t._wet = true;
            t._waterKind = 'river';
            if (kind === 'ford') {
                t._ford = true;
                t.paving = null;
            } else {
                // the river flows east–west here: the street crosses north–south
                const [sx, sy] = flowAt(c) === 'EW' ? PLANKS_FOR_NS : PLANKS_FOR_EW;
                t._bridge = true;
                t._deep = false;
                t._shallow = false;
                t.isRoad = true;
                t.paving = { sheetPath: BRIDGE_SHEET, sx: sx * 32, sy: sy * 32 };
                t.terrainDetail = null;
                t.subTerrain = { ...BRIDGE_SUB };
                t.baseTerrain = 'dirt';
            }
            crossings.push({ q, r, kind });
        }

        // ── Fords in the wilds, so the river doesn't cut the map in two ──
        if (!roadCells.length) {
            const main = runs[0].pts;
            const [f0, f1] = cfg.wildFords;
            const n = Math.max(1, f0 + Math.floor(rng() * (f1 - f0 + 1)) - (main.length < 110 ? 1 : 0));
            const ks = [];
            for (let f = 0; f < n; f++) {
                for (let tries = 0; tries < 12; tries++) {
                    const k = Math.floor(main.length * (0.22 + 0.56 * rng()));
                    if (ks.some(o => Math.abs(o - k) < 18)) continue;
                    const kq = Math.round(main[k][0]), kr = Math.round(main[k][1]);
                    if (tiles[kr][kq]._waterKind !== 'river') continue; // not across a pond or the sea
                    ks.push(k);
                    break;
                }
            }
            for (const [c, n0] of near) {
                if (n0.run !== 0 || !ks.some(k => Math.abs(n0.k - k) <= 1)) continue;
                const q = c % W, r = (c - q) / W;
                const t = tiles[r][q];
                if (!t._wet || t._waterKind !== 'river') continue;
                t._ford = true;
                crossings.push({ q, r, kind: 'ford' });
            }
        }
        for (const x of crossings) {
            if (x.kind !== 'ford') continue;
            const t = tiles[x.r][x.q];
            t.subTerrain = { ...FORD };
            t.baseTerrain = 'water';
        }

        // The town's streets ran on under the water: they stop at the banks
        const layout = tiles._settlementLayout;
        if (layout && Array.isArray(layout.roadTiles)) {
            layout.roadTiles = layout.roadTiles.filter(p => { const t = tiles[p.r] && tiles[p.r][p.q]; return !(t && t._wet && !t._bridge && !t._ford); });
        }
        this._stampWater(tiles);
        tiles._river = { crossings: crossings.length, runs: runs.length };
        return { path: runs[0].pts.map(([x, y]) => ({ q: Math.round(x), r: Math.round(y) })), cells: cells.length, crossings };
    },

    /**
     * A river's course from its grid route: smoothed (a running mean, its
     * ends held), resampled a cell apart, then swung side to side in bends
     * that fade out toward its ends, a bend held back wherever it would run
     * onto ground the river must keep off (`ok(x, y)`). Returns [[x, y]…].
     */
    _riverCourse(path, W, H, rng, cfg, ok, tributary = false) {
        let pts = path.map(i => [i % W, (i - (i % W)) / W]);
        if (pts.length < 3) return pts;
        for (let pass = 0; pass < 3; pass++) {
            const next = pts.map(p => p.slice());
            for (let k = 1; k < pts.length - 1; k++) {
                const lo = Math.max(0, k - 4), hi = Math.min(pts.length - 1, k + 4);
                let sx = 0, sy = 0;
                for (let j = lo; j <= hi; j++) { sx += pts[j][0]; sy += pts[j][1]; }
                const cand = [sx / (hi - lo + 1), sy / (hi - lo + 1)];
                if (ok(cand[0], cand[1])) next[k] = cand;
            }
            pts = next;
        }
        // resample a cell apart
        const even = [pts[0]];
        let carry = 0;
        for (let k = 1; k < pts.length; k++) {
            const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
            const len = Math.hypot(bx - ax, by - ay);
            let t = 1 - carry;
            while (t <= len) { even.push([ax + (bx - ax) * t / len, ay + (by - ay) * t / len]); t += 1; }
            carry = len - (t - 1);
        }
        const last = pts[pts.length - 1];
        if (Math.hypot(even[even.length - 1][0] - last[0], even[even.length - 1][1] - last[1]) > 0.3) even.push(last);
        // the bends
        const n = even.length;
        const amp = (cfg.bend ? cfg.bend[0] + (cfg.bend[1] - cfg.bend[0]) * rng() : 3 + 3 * rng()) * (tributary ? 0.6 : 1);
        const wave = (cfg.bendLength ? cfg.bendLength[0] + (cfg.bendLength[1] - cfg.bendLength[0]) * rng() : 30 + 18 * rng());
        const ph = rng() * 6.283, ph2 = rng() * 6.283;
        const out = [];
        for (let k = 0; k < n; k++) {
            const a = even[Math.max(0, k - 2)], b = even[Math.min(n - 1, k + 2)];
            let tx = b[0] - a[0], ty = b[1] - a[1];
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl; ty /= tl;
            const fade = Math.min(1, k / 14, (n - 1 - k) / 14);
            const o = amp * fade * (Math.sin(2 * Math.PI * k / wave + ph) * 0.8 + Math.sin(2 * Math.PI * k / (wave * 0.43) + ph2) * 0.2);
            let p = even[k];
            for (const f of [1, 0.6, 0.3]) {
                const x = even[k][0] - ty * o * f, y = even[k][1] + tx * o * f;
                if (x >= 0 && y >= 0 && x <= W - 1 && y <= H - 1 && ok(x, y)) { p = [x, y]; break; }
            }
            // (no gap where a bend was held back: fill in between)
            const prev = out[out.length - 1];
            if (prev) {
                const gap = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
                for (let j = 1; j < gap; j++) out.push([prev[0] + (p[0] - prev[0]) * j / gap, prev[1] + (p[1] - prev[1]) * j / gap]);
            }
            out.push(p);
        }
        return out;
    },

    // ══════════════════════════════════════════════════════════════
    // A LAKE HEX
    // ══════════════════════════════════════════════════════════════

    /** The land the shores of a lake hex are: the commonest land beside it */
    _lakeShoreTerrain(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return 'grassland';
        const counts = {};
        for (const p of Hex.neighbors(q, r)) {
            const n = world.getTile(p.q, p.r);
            const id = n && n.terrain && n.terrain.id;
            if (id && !WATER_IDS.has(id)) counts[id] = (counts[id] || 0) + 1;
        }
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
        return best ? best[0] : 'grassland';
    },

    /**
     * The water of a lake hex: everything but a ragged band of shore along
     * the sides that face land (rounded where two meet), so the lake runs off
     * the map only toward more water. The middle is always open water (the
     * ship lies there).
     */
    _lakeMask(tiles, worldTile, world) {
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const q0 = worldTile.q, r0 = worldTile.r;
        const sides = this._waterSides ? this._waterSides(world, q0, r0) : {};
        const cfg = this._waterCfg('lake');
        const rng = _rng(q0 | 0, r0 | 0, 9151);
        const land = Array.from({ length: H }, () => new Float32Array(W));
        const depth = {};
        for (const s of SIDES) depth[s] = cfg.shoreDepth[0] + (cfg.shoreDepth[1] - cfg.shoreDepth[0]) * rng();
        const ph = rng() * 10;
        const wob = (x, k) => Math.sin(x * 0.09 + ph + k) * cfg.wobble + Math.sin(x * 0.23 + ph * 2 + k) * cfg.wobble * 0.5;
        const dry = (s) => world && sides[s] === null;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                let l = false;
                if (dry('E') && q >= W - (depth.E + wob(r, 1))) l = true;
                if (dry('W') && q < depth.W + wob(r, 2)) l = true;
                if (dry('NE') && q >= W * 0.35 && r < depth.NE + wob(q, 3)) l = true;
                if (dry('NW') && q <= W * 0.65 && r < depth.NW + wob(q, 4)) l = true;
                if (dry('SE') && q >= W * 0.35 && r >= H - (depth.SE + wob(q, 5))) l = true;
                if (dry('SW') && q <= W * 0.65 && r >= H - (depth.SW + wob(q, 6))) l = true;
                land[r][q] = l ? 1 : 0;
            }
        }
        // Round the corners: a box blur of the shore, thresholded
        const B = 5;
        const sat = new Float64Array((W + 1) * (H + 1));
        for (let r = 0; r < H; r++) {
            let row = 0;
            for (let q = 0; q < W; q++) {
                row += land[r][q];
                sat[(r + 1) * (W + 1) + q + 1] = sat[r * (W + 1) + q + 1] + row;
            }
        }
        const box = (q, r) => {
            const x0 = Math.max(0, q - B), y0 = Math.max(0, r - B), x1 = Math.min(W, q + B + 1), y1 = Math.min(H, r + B + 1);
            const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
            return s / ((x1 - x0) * (y1 - y0));
        };
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        return Array.from({ length: H }, (_, r) => Array.from({ length: W }, (__, q) => {
            if (Math.abs(q - cq) <= 16 && Math.abs(r - cr) <= 16) return true;
            return box(q, r) < 0.5;
        }));
    },

    // ══════════════════════════════════════════════════════════════
    // DRESSING THE SHORES
    // ══════════════════════════════════════════════════════════════

    /**
     * Sparse dressing along the water (hash-placed): reeds on the shallows
     * and the bank, cattails and lily pads on still water near the shore (not
     * on the open sea), stones on the bank and stepping stones over a ford.
     * Visual only: tile.decor = [{ sheetPath, sx, sy, h }] (h in cells, drawn
     * upward from the cell's bottom).
     */
    _dressWater(tiles, worldQ, worldR) {
        const H = tiles.length, W = H ? tiles[0].length : 0;
        if (!tiles.some(row => row.some(t => t._wet))) return;
        const cfg = this._waterCfg('dressing');
        const sp = cfg.sprites;
        const season = (this.season || 'spring').toLowerCase();
        const plants = String(sp.plants).replace('{season}', season);
        const rng = _rng(worldQ, worldR, 3307);
        const pick = (list) => list[Math.floor(rng() * list.length)];
        const put = (t, sheet, cell, h = 1) => {
            if (!cell) return;
            (t.decor || (t.decor = [])).push({ sheetPath: sheet, sx: cell[0] * 32, sy: cell[1] * 32, h });
        };
        const at = (q, r) => (q >= 0 && r >= 0 && q < W && r < H ? tiles[r][q] : null);
        const busy = (t) => !!(t.isRoad || t.paving || t._townCore || t._lot || t._plaza || _isHard(t) || t._bridge);
        for (let r = 1; r < H - 1; r++) {
            for (let q = 1; q < W - 1; q++) {
                const t = tiles[r][q];
                if (!t || t.decor) continue;
                if (t._ford) {
                    if (rng() < cfg.fordStones) put(t, sp.rocksSheet, pick(sp.stones));
                    continue;
                }
                if (busy(t)) continue;
                const kind = t._waterKind;
                const still = kind === 'pond' || kind === 'lake' || kind === 'river';
                if (t._wet && t._shallow) {
                    if (still && rng() < cfg.reeds) put(t, plants, pick(sp.reeds));
                    continue;
                }
                if (t._wet) {
                    if (!still || t._deep || !t.subTerrain || t.subTerrain.passable) continue;
                    // still water a step or two out from the shore
                    let shore = false;
                    for (const [dq, dr] of N8) { const n = at(q + dq, r + dr); if (n && (!n._wet || n._shallow)) { shore = true; break; } }
                    if (shore && rng() < cfg.cattails) { put(t, plants, pick(sp.cattails)); continue; }
                    if (kind !== 'river' && rng() < cfg.lilies) {
                        put(t, plants, pick(sp.lilies));
                        if (rng() < cfg.lilyFlower) put(t, plants, pick(sp.lilyFlowers));
                    }
                    continue;
                }
                // the bank: dry land beside the water
                if (!t.subTerrain || !t.subTerrain.passable) continue;
                let bank = false;
                for (const [dq, dr] of N8) { const n = at(q + dq, r + dr); if (n && n._wet && !n._bridge) { bank = true; break; } }
                if (!bank) continue;
                const roll = rng();
                if (roll < cfg.rocks) put(t, sp.rocksSheet, pick(sp.rocks));
                else if (roll < cfg.rocks + cfg.reeds * 0.5) {
                    if (rng() < cfg.tallReeds) put(t, plants, pick(sp.tallReeds), 2);
                    else put(t, plants, pick(sp.reeds));
                }
            }
        }
    },
});
