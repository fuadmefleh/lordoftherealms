// ============================================
// ROAD TRACE — follow a street-map road from a cell, in a heading
// ============================================
// Pure: given what is road and what may be stepped, walks the road cell by
// cell the way it runs (roads on the street map are two or three cells wide
// and bend in staircases, so the heading is smoothed and the straightest
// longest way on wins), until it meets a junction (a road branching off to
// one side, or opening into a square), runs out, reaches the map's edge
// heading out of it, or the step cap. Read by ui/innerMapRoadWalk.js
// ("Follow the road", the R key). No RNG, no game state.

// The eight ways, clockwise from north (index 0..7, 45° apart)
export const DIRS8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** The index (0..7) of the way nearest the vector (dq, dr), or -1 for a zero vector. */
export function dirIndex(dq, dr) {
    if (!dq && !dr) return -1;
    // (screen y runs down: north is -r)
    const a = Math.atan2(dq, -dr); // 0 = north, clockwise
    return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

const SIDE_OFFSETS = [1, -1, 2, -2, 3, -3];
const RUN_CAP = 8;

/**
 * @param {Object} map { W, H, isRoad(q, r), canStep(fq, fr, tq, tr) }
 * @param {{q:number,r:number}} start
 * @param {{dq:number,dr:number}} heading
 * @param {Object} [opts] { max: step cap (240), minRun: steps before a junction may stop the walk (4), branch: extra cells off to a side that make a junction (3) }
 * @returns {{ cells: Array<{q,r}>, end: 'junction'|'deadEnd'|'edge'|'max', heading: {dq,dr} }}
 *   cells: the cells walked, not counting the start
 */
export function traceRoad(map, start, heading, opts = {}) {
    const { W, H, isRoad, canStep } = map;
    const max = opts.max || 240;
    const minRun = opts.minRun != null ? opts.minRun : 4;
    const branch = opts.branch != null ? opts.branch : 3;
    const inside = (q, r) => q >= 0 && r >= 0 && q < W && r < H;
    const road = (q, r) => inside(q, r) && !!isRoad(q, r);
    const run = (q, r, d, cap = RUN_CAP) => {
        let n = 0;
        const [dq, dr] = DIRS8[d];
        for (let x = q + dq, y = r + dr; n < cap && road(x, y); x += dq, y += dr) n++;
        return n;
    };

    let hv = { x: heading.dq || 0, y: heading.dr || 0 };
    if (!hv.x && !hv.y) return { cells: [], end: 'deadEnd', heading: { dq: 0, dr: 0 } };
    const cells = [];
    const seen = new Set([start.r * W + start.q]);
    // The road's reach each of the eight ways, step by step (a sudden long reach to a side = a branch;
    // kept by compass way, not by side, so the road just walked never reads as a branch after a bend)
    const sideHist = DIRS8.map(() => []);
    let q = start.q, r = start.r, end = 'max';

    for (let step = 0; step < max; step++) {
        const h = dirIndex(hv.x, hv.y);
        // Straight on would leave the map: the road goes on into the next hex
        const [fq, fr] = DIRS8[h];
        if (!inside(q + fq, r + fr) && road(q, r)) { end = 'edge'; break; }

        // The next cell: the straightest way on with the most road ahead of it
        let best = null;
        for (const off of [0, 1, -1, 2, -2]) {
            const d = (h + off + 8) % 8;
            const [dq, dr] = DIRS8[d];
            const nq = q + dq, nr = r + dr;
            if (!road(nq, nr) || seen.has(nr * W + nq) || !canStep(q, r, nq, nr)) continue;
            // (a diagonal squeezing between two non-road cells is no way along a road)
            if (dq && dr && !road(q + dq, r) && !road(q, r + dr)) continue;
            const score = Math.min(run(q, r, d, 6), 6) - Math.abs(off) * 1.5;
            if (!best || score > best.score) best = { d, nq, nr, score };
        }

        // A junction here: a road to some side (not the way on, nor back) reaches well past
        // what that way did a few cells back — a bend only turns, a branch adds a way
        if (step >= minRun) {
            let junction = false;
            for (const off of SIDE_OFFSETS) {
                const d = (h + off + 8) % 8;
                if (best && Math.min((d - best.d + 8) % 8, (best.d - d + 8) % 8) <= 1) continue;
                const hist = sideHist[d];
                if (hist.length < 3) continue;
                const last = hist.slice(-4).sort((a, b) => a - b);
                const base = last[Math.floor(last.length / 2)];
                const reach = run(q, r, d);
                if (reach >= base + branch && reach >= 4) { junction = true; break; }
            }
            if (junction) { end = 'junction'; break; }
        }
        for (let d = 0; d < 8; d++) sideHist[d].push(run(q, r, d));
        if (!best) { end = 'deadEnd'; break; }
        const [bq, br] = DIRS8[best.d];
        const len = Math.hypot(bq, br);
        hv = { x: hv.x * 0.6 + (bq / len) * 0.4, y: hv.y * 0.6 + (br / len) * 0.4 };
        q = best.nq; r = best.nr;
        seen.add(r * W + q);
        cells.push({ q, r });
    }
    const h = dirIndex(hv.x, hv.y);
    return { cells, end, heading: h < 0 ? { dq: 0, dr: 0 } : { dq: DIRS8[h][0], dr: DIRS8[h][1] } };
}

/**
 * The way a road runs from (q, r) nearest `prefer` ({dq, dr}), never straight back
 * against it: each of the eight ways scored by the road ahead along it, less its
 * turn from `prefer`. null when no road leads off.
 */
export function bestRoadHeading(map, q, r, prefer) {
    const { W, H, isRoad } = map;
    const p = prefer ? dirIndex(prefer.dq, prefer.dr) : -1;
    let best = null;
    for (let d = 0; d < 8; d++) {
        const turn = p < 0 ? 0 : Math.min((d - p + 8) % 8, (p - d + 8) % 8);
        if (turn >= 4) continue;
        let n = 0;
        const [dq, dr] = DIRS8[d];
        for (let x = q + dq, y = r + dr; n < RUN_CAP && x >= 0 && y >= 0 && x < W && y < H && isRoad(x, y); x += dq, y += dr) n++;
        if (!n) continue;
        const score = n - turn * 1.2;
        if (!best || score > best.score) best = { d, score };
    }
    return best ? { dq: DIRS8[best.d][0], dr: DIRS8[best.d][1] } : null;
}
