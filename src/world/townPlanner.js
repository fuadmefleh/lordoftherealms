// ============================================================
// TOWN PLANNER — how a settlement lays itself out
// ============================================================
// A settlement grows along its roads, the way real ones do:
//
//   1. A winding high street crosses the map east–west and a road crosses it
//      north–south; where they meet is the market square. Both run on to the
//      map's edges as the roads in and out.
//   2. Lanes run beside the high street (more and longer the bigger the
//      place), each following the high street's bends with a wobble of its
//      own, and alleys join neighbouring lanes.
//   3. Buildings front the street: each stands on the north side of a lane
//      with its door on the lane (the sprites face south), shoulder to
//      shoulder in a capital, with gaps and front gardens in a village.
//      Landmarks (town hall, church, guildhall, inns…) take the square and the
//      high street nearest the centre; granaries, mills, barns and stables
//      go to the edge. Houses fill the rest: shops and townhouses in the
//      middle, row houses further out, cottages, farmhouses and hovels at
//      the fringe.
//   4. Behind the houses are back gardens (vegetable patches, fruit trees,
//      flower beds); beside the doors sit what the trade leaves about
//      (barrels by the tavern, an anvil and woodpile by the smithy, hay by
//      the stable). The square gets its fountain well, market stalls and,
//      in a city, lamp posts.
//   5. Round the town lie farmsteads and fields — wheat, vegetable patches,
//      plowed land, fenced pastures — and the forest thins to a clearing.
//
// Draws only from the rng it is handed (the map's own seeded stream).

import { CustomBuildings } from './customBuildings.js';
import { CustomObjects } from './customObjects.js';
import { TownProps, FIELD_W, FIELD_H } from './townProps.js';
import { LotBook } from './lotBook.js';

/** How each size of settlement is laid out. */
export const PLAN = {
    village: { R: 24, mainW: 2, crossW: 2, laneW: 2, alleyW: 1, laneGap: [12, 15], lanes: 1, laneSpan: 0.7, gap: [2, 5], setback: [0, 1], plaza: [8, 5], stalls: 1, lamps: false, fields: 12, ring: 1.75, maxBuildings: 24 },
    town:    { R: 32, mainW: 3, crossW: 2, laneW: 2, alleyW: 1, laneGap: [10, 13], lanes: 3, laneSpan: 0.9, gap: [1, 3], setback: [0, 0], plaza: [12, 6], stalls: 3, lamps: false, fields: 12, ring: 1.6, maxBuildings: 55 },
    city:    { R: 42, mainW: 3, crossW: 3, laneW: 2, alleyW: 2, laneGap: [10, 12], lanes: 4, laneSpan: 0.95, gap: [0, 2], setback: [0, 0], plaza: [16, 8], stalls: 5, lamps: true, fields: 8, ring: 1.4, maxBuildings: 95 },
    capital: { R: 51, mainW: 4, crossW: 3, laneW: 2, alleyW: 2, laneGap: [10, 12], lanes: 5, laneSpan: 1.0, gap: [0, 1], setback: [0, 0], plaza: [20, 9], stalls: 7, lamps: true, fields: 6, ring: 1.25, maxBuildings: 140 },
};

/** House styles by distance from the centre (fraction of R), per size of place. */
const STYLE_MIX = {
    village: [
        [0.45, { cottage: 0.22, timbered: 0.14, whitewash: 0.14, villagehouse: 0.14, shop: 0.12, croft: 0.08, longhouse: 0.1, row: 0.06 }],
        [9, { cottage: 0.24, croft: 0.18, longhouse: 0.14, farmstead: 0.18, timbered: 0.1, whitewash: 0.06, hovel: 0.1 }],
    ],
    town: [
        [0.3, { shop: 0.35, townhouse: 0.25, row: 0.2, whitewash: 0.1, villagehouse: 0.1 }],
        [0.65, { row: 0.25, whitewash: 0.18, timbered: 0.14, townhouse: 0.14, villagehouse: 0.1, cottage: 0.1, shop: 0.09 }],
        [9, { cottage: 0.22, croft: 0.14, whitewash: 0.12, timbered: 0.14, longhouse: 0.08, farmstead: 0.15, hovel: 0.15 }],
    ],
    city: [
        [0.3, { townhouse: 0.35, shop: 0.35, grand: 0.15, row: 0.15 }],
        [0.65, { row: 0.35, townhouse: 0.3, whitewash: 0.12, shop: 0.1, grand: 0.08, timbered: 0.05 }],
        [9, { row: 0.25, cottage: 0.2, whitewash: 0.15, timbered: 0.15, croft: 0.1, hovel: 0.15 }],
    ],
    capital: [
        [0.3, { grand: 0.25, townhouse: 0.35, shop: 0.3, row: 0.1 }],
        [0.65, { townhouse: 0.35, row: 0.3, shop: 0.15, grand: 0.1, whitewash: 0.1 }],
        [9, { row: 0.3, cottage: 0.2, whitewash: 0.15, timbered: 0.15, hovel: 0.2 }],
    ],
};

/** Landmarks that belong out at the edge of town rather than its heart. */
const EDGE_TYPES = new Set(['granary', 'mill', 'barn', 'stable', 'farm', 'pasture', 'roadhouse']);
/** Landmarks that want the square itself. */
const SQUARE_TYPES = new Set(['town_hall', 'church', 'temple', 'guildhall', 'marketplace', 'bank', 'tavern', 'inn', 'hotel', 'manor', 'mint', 'castle']);

/** What lies about beside a building of each type (TownProps tags). */
const SIDE_TAGS = {
    tavern: 'tavern', inn: 'tavern', roadhouse: 'tavern', guest_house: 'house', hotel: 'grand',
    blacksmith: 'blacksmith', bakery: 'bakery', granary: 'granary', mill: 'granary', warehouse: 'warehouse',
    stable: 'stable', barn: 'farm', marketplace: 'stall', apothecary: 'garden', manor: 'grand', castle: 'grand',
};

function _shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

function _ri(rng, [a, b]) {
    return a + Math.floor(rng() * (b - a + 1));
}

function _pickWeighted(rng, mix) {
    const entries = Object.entries(mix);
    let roll = rng() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
    return entries[entries.length - 1][0];
}

/** A smooth wobble: two sines of random phase. */
function _wave(rng, amp, len) {
    const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2;
    const a1 = amp * (0.6 + rng() * 0.4), a2 = amp * 0.4 * rng();
    const l1 = len * (0.8 + rng() * 0.4), l2 = len * 0.45;
    return x => a1 * Math.sin(x / l1 + p1) + a2 * Math.sin(x / l2 + p2);
}

export function planTown(tiles, settlement, rng, W, H, layoutIn = null) {
    const type = PLAN[settlement.type] ? settlement.type : 'village';
    const P = PLAN[type];
    const cx = Math.floor(W / 2) + Math.round((rng() - 0.5) * 4);
    const cy = Math.floor(H / 2) + Math.round((rng() - 0.5) * 4);
    const R = Math.min(P.R, Math.floor(Math.min(W, H) / 2) - 6);

    // The settlement's outline: a circle with a ragged edge
    const edgeWave = _wave(rng, 0.12, 0.7);
    const reach = (q, r) => {
        const dx = q - cx, dy = (r - cy) * 1.08;
        const d = Math.sqrt(dx * dx + dy * dy);
        return d / (R * (1 + edgeWave(Math.atan2(dy, dx) * 3)));
    };

    // Streets in a town are paved; a village keeps its dirt tracks (structure/floors.png cells)
    const FLOORS = 'assets/lpc/Structure/Floor/floors.png';
    const PAVE = { main: [29, 58], lane: [24, 58], plaza: [12, 56] };
    const paved = type !== 'village';

    const roadTiles = [];
    const roadSet = new Set();
    // `ref` is the cell whose distance decides paving, so a street's cobbles end square across it
    const addRoad = (q, r, kind = 'lane', ref = null) => {
        if (q < 0 || r < 0 || q >= W || r >= H) return;
        const k = r * W + q;
        const t = tiles[r][q];
        if (paved && kind && reach(ref ? ref[0] : q, ref ? ref[1] : r) <= 1.08 && (!t.paving || kind === 'plaza' || (kind === 'main' && t._pave !== 'plaza'))) {
            const [c, rr] = PAVE[kind];
            t.paving = { sheetPath: FLOORS, sx: c * 32, sy: rr * 32 };
            t._pave = kind;
        }
        if (roadSet.has(k)) return;
        roadSet.add(k);
        roadTiles.push({ q, r });
        t.isRoad = true;
        t.subTerrain.passable = true;
        t.baseTerrain = 'dirt';
        t.subTerrain.id = 'dirt';
        t.subTerrain.name = 'Road';
        t.subTerrain.color = '#8b7355';
    };
    const isRoad = (q, r) => q >= 0 && r >= 0 && q < W && r < H && roadSet.has(r * W + q);

    /**
     * Offsets for a road along an axis of length n: dead straight through the
     * town (where inTown(i) holds), wandering a step at a time beyond it.
     */
    const meander = (n, inTown) => {
        const off = new Array(n).fill(0);
        let first = -1, last = -1;
        for (let i = 0; i < n; i++) if (inTown(i)) { if (first < 0) first = i; last = i; }
        if (first < 0) { first = last = Math.floor(n / 2); }
        for (const [from, step, end] of [[last + 1, 1, n], [first - 1, -1, -1]]) {
            // Straight on for a stretch past the last cobbles before the road starts to wander
            let o = 0, run = _ri(rng, [9, 14]);
            for (let i = from; i !== end; i += step) {
                if (--run <= 0) { o = Math.max(-6, Math.min(6, o + (rng() < 0.5 ? -1 : 1))); run = _ri(rng, [5, 10]); }
                off[i] = o;
            }
        }
        return off;
    };
    // Lay a road through a list of centre cells, filling any step so it never breaks
    const layAlong = (cells, width, kind, horizontal) => {
        let prev = null;
        for (const [a, b] of cells) {
            const from = prev == null ? b : Math.min(prev, b), to = prev == null ? b : Math.max(prev, b);
            for (let v = from; v <= to; v++) {
                for (let k = 0; k < width; k++) {
                    if (horizontal) addRoad(a, v + k, kind, [a, b]); else addRoad(v + k, a, kind, [b, a]);
                }
            }
            prev = b;
        }
    };

    // ── 1. High street (east–west) and the cross road (north–south) ──
    const hsOff = meander(W, x => reach(x, cy) <= 1.1);
    const hsAt = x => cy + hsOff[Math.max(0, Math.min(W - 1, x))];
    layAlong(Array.from({ length: W }, (_, x) => [x, hsAt(x)]), P.mainW, 'main', true);
    const crOff = meander(H, y => reach(cx, y) <= 1.1);
    const crAt = y => cx + crOff[Math.max(0, Math.min(H - 1, y))];
    layAlong(Array.from({ length: H }, (_, y) => [y, crAt(y)]), P.crossW, 'main', false);

    // ── 2. The market square: north of the high street, about the crossing ──
    const [pw, ph] = P.plaza;
    const pq0 = cx - Math.floor(pw / 2);
    const plazaBottom = cy;
    const plazaTop = plazaBottom - ph;
    for (let r = plazaTop; r < plazaBottom; r++) for (let q = pq0; q < pq0 + pw; q++) {
        addRoad(q, r, 'plaza');
        tiles[r][q]._plaza = true;
    }

    // ── 3. Lanes beside the high street, and alleys between them ──
    // A line is somewhere buildings can front: `top(x)` is its first road row at column x.
    const lines = [];
    lines.push({ kind: 'high', x0: 1, x1: W - 2, top: x => hsAt(x), bottom: x => hsAt(x) + P.mainW - 1 });
    lines.push({ kind: 'plaza', x0: pq0, x1: pq0 + pw - 1, top: () => plazaTop, bottom: () => plazaTop });
    const laneRows = [{ y0: 0, top: () => cy, bottom: () => cy + P.mainW - 1, x0: 0, x1: W - 1 }];
    for (const dir of [-1, 1]) {
        let off = 0;
        for (let i = 0; i < P.lanes; i++) {
            let gap = _ri(rng, P.laneGap);
            // North of the square the first gap must clear the square and the landmarks facing it
            if (dir < 0 && i === 0) gap = Math.max(gap, ph + 10 + P.laneW);
            off = dir < 0 ? off - gap : (i === 0 ? P.mainW - 1 + gap : off + gap);
            const y = cy + off;
            const frac = off / (R * 1.02);
            if (Math.abs(frac) >= 0.92) break;
            const half = R * Math.sqrt(1 - frac * frac) * P.laneSpan * (0.8 + rng() * 0.2);
            if (half < 8) break;
            const x0 = Math.max(2, Math.round(cx - half + (rng() - 0.5) * 6));
            const x1 = Math.min(W - 3, Math.round(cx + half + (rng() - 0.5) * 6));
            for (let x = x0; x <= x1; x++) for (let k = 0; k < P.laneW; k++) addRoad(x, y + k, 'lane', [x, y]);
            const lane = { kind: 'lane', x0, x1, top: () => y, bottom: () => y + P.laneW - 1 };
            lines.push(lane);
            laneRows.push({ y0: off, top: lane.top, bottom: lane.bottom, x0, x1 });
        }
    }
    // Alleys join each lane to its neighbour nearer the high street (and lane ends to the cross road side)
    laneRows.sort((a, b) => a.y0 - b.y0);
    for (let i = 0; i + 1 < laneRows.length; i++) {
        const a = laneRows[i], b = laneRows[i + 1];
        const lo = Math.max(a.x0, b.x0) + 3, hi = Math.min(a.x1, b.x1) - 3;
        if (hi <= lo) continue;
        for (let x = lo + _ri(rng, [2, 10]); x < hi; x += _ri(rng, [14, 24])) {
            if (Math.abs(x - cx) < 6) continue;
            if (x >= pq0 - 2 && x <= pq0 + pw + 1 && (a.y0 === 0 || b.y0 === 0)) continue;
            for (let y = a.bottom(x) + 1; y < b.top(x); y++) for (let k = 0; k < P.alleyW; k++) addRoad(x + k, y, 'lane');
        }
    }

    // ── 4. Buildings ──
    const placed = [];
    let count = 0;

    /** Can `def` stand with its anchor at (q, r)? */
    const fitsBuilding = (def, q, r) => {
        for (const m of def.meta || []) {
            const fq = q + m.q, fr = r + m.r;
            if (fq < 1 || fr < 1 || fq >= W - 1 || fr >= H - 1) return false;
            const t = tiles[fr][fq];
            if (t.isRoad || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t._reserved) return false;
        }
        return true;
    };
    const putBuilding = (def, q, r) => {
        tiles[r][q].customBuilding = { defId: def.id };
        for (const m of def.meta || []) {
            const t = tiles[r + m.r][q + m.q];
            if (m.q !== 0 || m.r !== 0) t.customBuildingPart = { anchorQ: q, anchorR: r };
            if (m.door) {
                t._doorMarker = { anchorQ: q, anchorR: r, defId: def.id };
                t.subTerrain.passable = true;
            } else if (m.impassable) {
                t.subTerrain.passable = false;
            }
        }
    };
    const doorOf = def => (def.meta || []).find(m => m.door) || { q: 0, r: 0 };

    /**
     * Try to stand `def` on `line` with its left edge at column x.
     * Returns the placement or null.
     */
    const tryOnLine = (def, line, x, setback = 0) => {
        const b = def.bounds;
        const left = x, right = x + (b.maxCol - b.minCol);
        if (left < line.x0 || right > line.x1) return null;
        let front = Infinity;
        for (let c = left; c <= right; c++) front = Math.min(front, line.top(c));
        const q = left - b.minCol;
        const door = doorOf(def);
        const r = front - 1 - setback;
        if (!fitsBuilding(def, q, r)) return null;
        // The door must open onto the lane, or onto a short path down to it
        const path = [];
        let y = r + door.r + 1;
        while (y < H && !isRoad(q + door.q, y)) {
            const dt = tiles[y][q + door.q];
            if (dt.customBuilding || dt.customBuildingPart || dt.customObject || dt.customObjectPart) return null;
            path.push(y);
            if (path.length > setback + 2) return null;
            y++;
        }
        if (y >= H) return null;
        putBuilding(def, q, r);
        for (const py of path) addRoad(q + door.q, py);
        const rec = { def, q, r, left, right, front: r, top: r + b.minRow, type: def.buildingType || 'house', style: def.style || 'row', line };
        placed.push(rec);
        count++;
        return rec;
    };

    const defsOfType = t => _shuffle(CustomBuildings.getByType(t).filter(d => d.meta && d.bounds), rng);
    const houses = CustomBuildings.getByType('house').filter(d => d.meta && d.bounds && !d._procedural);
    const byStyle = {};
    for (const d of houses) (byStyle[d.style || 'row'] = byStyle[d.style || 'row'] || []).push(d);

    // 4a. Landmarks: the square and the high street near the centre; edge trades out at the edge
    const layout = layoutIn || { required: [], optional: [], maxBuildings: P.maxBuildings };
    const required = [...(layout.required || [])];
    const optional = _shuffle([...(layout.optional || [])].filter(t => t !== 'house'), rng);
    const order = t => (t === 'castle' ? -1 : t === 'town_hall' ? 0 : SQUARE_TYPES.has(t) ? 1 : EDGE_TYPES.has(t) ? 3 : 2);
    required.sort((a, b) => order(a) - order(b));
    const landmarkTypes = [...required, ...optional.slice(0, Math.max(0, Math.round(optional.length * 0.6)))];
    const frontLines = lines.filter(l => l.kind !== 'plaza');
    const plazaLine = lines.find(l => l.kind === 'plaza');
    for (const t of landmarkTypes) {
        if (count >= P.maxBuildings) break;
        const defs = defsOfType(t);
        if (!defs.length) continue;
        const wantEdge = EDGE_TYPES.has(t);
        // Candidate spots: (line, x) scored by how well the distance suits the building
        const spots = [];
        const pool = SQUARE_TYPES.has(t) ? [plazaLine, ...frontLines] : frontLines;
        for (const line of pool) {
            for (let x = line.x0; x <= line.x1; x++) {
                const d = Math.abs(x - cx) / R + Math.abs(line.top(x) - cy) / R;
                if (reach(x, line.top(x)) > 1.05 && !wantEdge) continue;
                let score = wantEdge ? Math.abs(d - 0.85) : d;
                if (line.kind === 'plaza') score -= 1;
                else if (line.kind === 'high') score -= 0.15;
                spots.push({ line, x, score: score + rng() * 0.08 });
            }
        }
        spots.sort((a, b) => a.score - b.score);
        let done = false;
        for (const s of spots.slice(0, 400)) {
            for (const def of defs) {
                if (tryOnLine(def, s.line, s.x, 0)) { done = true; break; }
            }
            if (done) break;
        }
    }

    // 4a½. Building lots: empty ground set aside along the streets, for sale to anyone (world/lotBook.js).
    // Many in a village, few in a city. Each fronts its street; tiles carry _lot = its id.
    const lots = [];
    {
        const want = LotBook.lotIds(type).length;
        const wR = LotBook.byType('width', type) || [6, 8];
        const dR = LotBook.byType('depth', type) || [5, 6];
        const clear = (q0, q1, r0, r1) => {
            for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
                if (q < 2 || r < 2 || q >= W - 2 || r >= H - 2) return false;
                const t = tiles[r][q];
                if (t.isRoad || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t._reserved || t._lot) return false;
            }
            return true;
        };
        // A lot fronts a street from either side (its gate on the street); a village's reach its outskirts too
        const outer = type === 'village' ? 1.15 : 0.98;
        const cands = [];
        for (const line of frontLines) {
            for (let x = line.x0; x <= line.x1; x++) {
                const d = reach(x, line.top(x));
                if (d > outer || d < 0.15) continue;
                cands.push({ line, x, side: -1, score: rng() });
                cands.push({ line, x, side: 1, score: rng() });
            }
        }
        cands.sort((a, b) => a.score - b.score);
        for (const c of cands) {
            if (lots.length >= want) break;
            const w = _ri(rng, wR), dpt = _ri(rng, dR);
            const q0 = c.x, q1 = c.x + w - 1;
            if (q1 > c.line.x1) continue;
            let r0, r1, gateR;
            if (c.side < 0) {
                // North of the street, its front row on the street
                let front = Infinity;
                for (let q = q0; q <= q1; q++) front = Math.min(front, c.line.top(q));
                r1 = front - 1; r0 = r1 - dpt + 1; gateR = r1 + 1;
            } else {
                // South of the street, its back to the fields
                let back = -Infinity;
                for (let q = q0; q <= q1; q++) back = Math.max(back, c.line.bottom(q));
                r0 = back + 1; r1 = r0 + dpt - 1; gateR = r0 - 1;
            }
            // A tile's breathing room either side, so a lot never butts on a wall
            if (!clear(q0 - 1, q1 + 1, r0, r1)) continue;
            // Its gate (the middle of its front) on the street
            const mid = Math.floor((q0 + q1) / 2);
            if (!isRoad(mid, gateR)) continue;
            const id = `lot${lots.length}`;
            for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
                const t = tiles[r][q];
                t._lot = id;
                t._reserved = true;
                t._townCleared = true;
            }
            lots.push({ id, q0, q1, r0, r1, w, h: dpt, gate: c.side < 0 ? 'south' : 'north' });
        }
    }

    // 4b. Houses fill the frontages
    const styleFor = (x, y) => {
        const d = reach(x, y);
        for (const [lim, mix] of STYLE_MIX[type]) if (d <= lim) return _pickWeighted(rng, mix);
        return 'cottage';
    };
    // The style wanted first, then anything low enough to fit under the lane behind
    const lowHouses = houses.filter(d => d.bounds.maxRow - d.bounds.minRow <= 7 && d.style !== 'farmstead');
    const houseFor = (style) => {
        const list = byStyle[style] && byStyle[style].length ? byStyle[style] : (byStyle.row || houses);
        return [..._shuffle([...list], rng).slice(0, 8), ..._shuffle([...lowHouses], rng).slice(0, 6)];
    };
    for (const line of [plazaLine, ..._shuffle([...frontLines], rng)]) {
        let x = line.x0;
        // One building line per street: every front stands the same distance back
        const setback = line.kind === 'lane' ? _ri(rng, P.setback) : 0;
        // No two of the same design on one street, if there's any choice
        const usedHere = new Set();
        while (x <= line.x1 && count < P.maxBuildings) {
            const y = line.top(x);
            const d = reach(x, y);
            if (d > 1.0) { x++; continue; }
            let rec = null;
            const choices = houseFor(styleFor(x, y));
            for (const def of [...choices.filter(d => !usedHere.has(d.id)), ...choices.filter(d => usedHere.has(d.id))]) {
                rec = tryOnLine(def, line, x, setback);
                if (rec) { usedHere.add(def.id); break; }
            }
            x = rec ? rec.right + 1 + _ri(rng, P.gap) : x + 1;
        }
    }

    // ── 5. Dressing: what stands by the doors, back gardens, the square ──
    const propDef = id => CustomObjects.getDef(id);
    const pickTag = tag => { const ids = TownProps.idsWithTag(tag); return ids.length ? ids[Math.floor(rng() * ids.length)] : null; };
    const putProp = (id, q, r, opts) => { const d = propDef(id); return !!d && TownProps.place(tiles, d, q, r, opts); };
    const tree = propDef('large_tree_1');

    // One-tile props that stand flush against a wall (a barrel, a woodpile, crates, a flower box)
    const wallProps = tag => TownProps.idsWithTag(tag).filter(id => {
        const d = propDef(id);
        return d && d.bounds.maxCol === d.bounds.minCol && !(d.tags || []).includes('garden');
    });
    for (const b of placed) {
        const tag = b.style === 'shop' ? 'shop' : b.style === 'grand' ? 'grand' : b.style === 'farmstead' ? 'farm' : (SIDE_TAGS[b.type] || 'house');
        const landmark = b.type !== 'house';
        const pool = wallProps(tag).length ? wallProps(tag) : wallProps('house');
        // Against the wall beside the front, on one flank or both
        for (const side of [-1, 1]) {
            if (!pool.length || rng() > (landmark ? 0.7 : b.style === 'shop' ? 0.4 : 0.15)) continue;
            putProp(pool[Math.floor(rng() * pool.length)], side < 0 ? b.left - 1 : b.right + 1, b.front);
        }
        // A cottage set back from the lane has a flower bed either side of its path
        const door = doorOf(b.def);
        const pathCell = tiles[b.front + 1] && tiles[b.front + 1][b.q + door.q];
        if (pathCell && pathCell.isRoad && b.line.kind === 'lane' && b.front + 1 < b.line.top(b.q + door.q)) {
            const beds = TownProps.idsWithTag('garden').filter(id => /bush/.test(id));
            for (const dq of [-1, 1]) if (beds.length) putProp(beds[Math.floor(rng() * beds.length)], b.q + door.q + dq, b.front + 1);
        }
        // Back garden: one thing, a row clear of the house — a fruit tree or a vegetable patch
        let depth = 0;
        while (depth < 7 && b.top - 1 - depth > 0 && !isRoad(b.left + 1, b.top - 1 - depth) && !tiles[b.top - 1 - depth][b.left + 1].customBuildingPart) depth++;
        const w = b.right - b.left + 1;
        if (depth >= 3 && rng() < 0.85) {
            const fh = Math.min(depth - 2, 3);
            const fw = Math.min(w - 1, FIELD_W[FIELD_W.length - 1]);
            if (depth >= 5 && rng() < 0.4 && tree && w >= 3) {
                TownProps.place(tiles, tree, b.left + Math.floor(w / 2), b.top - 2);
            } else if (fh >= 2 && FIELD_W.includes(fw)) {
                const def = propDef(TownProps.fieldId(rng() < 0.75 ? 'veg' : 'greens', fw, fh));
                if (def) TownProps.place(tiles, def, b.left, b.top - 2);
            } else {
                // Too shallow for a patch: a hedge of flowering bushes along the back
                const beds = TownProps.idsWithTag('garden').filter(id => /bush/.test(id));
                const bush = beds[Math.floor(rng() * beds.length)];
                for (let q = b.left; q <= b.right; q++) putProp(bush, q, b.top - 2);
            }
        }
    }

    // The square: a fountain well in the middle, stalls round it, lamps at the corners
    const pcx = pq0 + Math.floor(pw / 2) - 1;
    const pcy = plazaTop + Math.floor(ph / 2) + 1;
    const opts = { onRoad: true };
    putProp('tp_fountain', pcx, pcy, opts);
    // Stalls in rows across the square, leaving the fountain and the doors on its north side clear
    const stallSpots = [];
    const stallRows = ph >= 9 ? [plazaBottom - 1, plazaTop + 6] : [plazaBottom - 1];
    for (const row of stallRows) {
        for (let q = pq0 + 1; q + 2 <= pq0 + pw - 2; q += 4) {
            // A stall is 3 wide; keep a tile clear either side of the 2-wide fountain
            if (q <= pcx + 2 && q + 2 >= pcx - 1 && Math.abs(row - pcy) < 5) continue;
            stallSpots.push([q, row]);
        }
    }
    _shuffle(stallSpots, rng);
    let stalls = 0;
    for (const [q, row] of stallSpots) {
        if (stalls >= P.stalls) break;
        if (putProp('tp_stall', q, row, opts)) {
            stalls++;
            if (rng() < 0.7) putProp(pickTag('stall'), q + 3, row, opts);
        }
    }
    if (P.lamps) {
        putProp('tp_lamp_a', pq0, plazaTop + 2, opts);
        putProp('tp_lamp_a', pq0 + pw - 1, plazaTop + 2, opts);
        putProp('tp_lamp_b', pq0, plazaBottom - 1, opts);
        putProp('tp_lamp_b', pq0 + pw - 1, plazaBottom - 1, opts);
        // Lamp posts along the high street's south verge
        for (let x = 3; x < W - 3; x += 9) {
            if (reach(x, hsAt(x)) > 0.9) continue;
            putProp('tp_lamp_a', x, hsAt(x) + P.mainW);
        }
    }

    // ── 6. Farmland round the town: farmsteads by the roads, fields and pastures ──
    const inRing = (q, r) => { const d = reach(q, r); return d > 1.0 && d < P.ring; };
    // Farmsteads front the high street and lanes beyond the houses
    const farmDefs = _shuffle([...(byStyle.farmstead || [])], rng);
    const barns = defsOfType('barn');
    for (const line of frontLines) {
        if (!farmDefs.length) break;
        for (let x = line.x0; x <= line.x1; x++) {
            if (!inRing(x, line.top(x)) || rng() > 0.12) continue;
            const fh = farmDefs[Math.floor(rng() * farmDefs.length)];
            const rec = tryOnLine(fh, line, x, 1);
            if (!rec) continue;
            if (barns.length && rng() < 0.6) tryOnLine(barns[Math.floor(rng() * barns.length)], line, rec.right + 2, 0);
            x = rec.right + 6;
        }
    }
    // Fields: fenced or open, wheat, vegetables, plowed land, pasture with hay
    const kinds = ['wheat', 'wheat', 'veg', 'plowed', 'greens', 'pasture'];
    let fields = 0;
    for (let tries = 0; tries < P.fields * 30 && fields < P.fields; tries++) {
        const fw = FIELD_W[Math.floor(rng() * FIELD_W.length)];
        const fh = FIELD_H[1 + Math.floor(rng() * (FIELD_H.length - 1))];
        const q0 = 2 + Math.floor(rng() * (W - fw - 6));
        const r0 = 2 + Math.floor(rng() * (H - fh - 6));
        // The fence ring sits one tile out from the field; keep a tile clear beyond that
        if (!inRing(q0 + fw / 2, r0 + fh / 2)) continue;
        let clear = true;
        for (let r = r0 - 2; r <= r0 + fh + 1 && clear; r++) {
            for (let q = q0 - 2; q <= q0 + fw + 1 && clear; q++) {
                if (r < 1 || q < 1 || r >= H - 1 || q >= W - 1) { clear = false; break; }
                const t = tiles[r][q];
                if (t.isRoad || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t._reserved) clear = false;
                if (t.subTerrain && /water/.test(t.subTerrain.id || '')) clear = false;
            }
        }
        if (!clear) continue;
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const fenced = kind === 'pasture' || rng() < 0.55;
        if (kind !== 'pasture') {
            const def = propDef(TownProps.fieldId(kind, fw, fh));
            if (!def || !TownProps.place(tiles, def, q0, r0 + fh - 1)) continue;
        } else {
            for (let r = r0; r < r0 + fh; r++) for (let q = q0; q < q0 + fw; q++) tiles[r][q]._reserved = true;
            const bales = 1 + Math.floor(rng() * 2);
            for (let i = 0; i < bales; i++) {
                const id = rng() < 0.5 ? 'tp_hay_green' : 'tp_hay_gold';
                TownProps.place(tiles, propDef(id), q0 + 1 + Math.floor(rng() * Math.max(1, fw - 3)), r0 + fh - 1, { ignoreReserved: true });
            }
        }
        if (fenced) {
            const gateQ = q0 + Math.floor(fw / 2);
            for (let q = q0 - 1; q <= q0 + fw; q++) {
                const top = q === q0 - 1 ? 'tp_fence_h_l' : q === q0 + fw ? 'tp_fence_h_r' : 'tp_fence_h_m';
                putProp(top, q, r0 - 1);
                putProp(q === gateQ ? 'tp_fence_gate' : top, q, r0 + fh);
            }
            for (let r = r0; r < r0 + fh; r++) {
                const piece = r === r0 ? 'tp_fence_v_t' : r === r0 + fh - 1 ? 'tp_fence_v_b' : 'tp_fence_v_m';
                putProp(piece, q0 - 1, r);
                putProp(piece, q0 + fw, r);
            }
        }
        // Farmland is cleared land: keep the woods back from the fence
        for (let r = r0 - 4; r <= r0 + fh + 3; r++) for (let q = q0 - 4; q <= q0 + fw + 3; q++) {
            if (r >= 0 && q >= 0 && r < H && q < W) tiles[r][q]._townCleared = true;
        }
        fields++;
    }
    for (const row of tiles) for (const t of row) if (t._reserved) delete t._reserved;
    tiles._lots = lots;

    // ── 7. Tell the scatter where the town is: no wild trees inside it, fewer near it ──
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const d = reach(q, r);
            if (d <= 1.02) tiles[r][q]._townCore = true;
            else if (d < P.ring + 0.35) tiles[r][q]._townFade = Math.min(1, (d - 1.02) / (P.ring + 0.35 - 1.02));
        }
    }

    return { roadTiles, buildings: placed.length, center: { q: cx, r: cy }, plaza: { q: pq0, r: plazaTop, w: pw, h: ph }, lots };
}
