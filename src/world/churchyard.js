// ============================================
// CHURCHYARD — where a town's burial ground lies on its street map
// ============================================
// Called by the town planner (world/townPlanner.js) once its landmarks stand
// and before the building lots and houses fill in. The ground is a
// rectangle of open land fronting a street — beside the church, temple or
// chapel when the place has one, else out on its edge — of the size
// data/graves.json `yard` gives its type, shrunk until it fits. Its tiles
// carry _grave = 'town' (and are kept from the houses, props and the wild
// trees); its plots (world/graveBook.js yardPlots) _plot = their index, the
// head of each _plotHead. The map's markers are stood from the town's book of
// the dead on entering (world/innerMap/graves.js).
//
// No randomness: ties are broken by a hash of the town and the spot, so the
// planner's own stream is not drawn on.

import { GraveBook, graveHash } from './graveBook.js';

const CHURCHES = new Set(['church', 'temple', 'chapel', 'cathedral', 'shrine']);

/**
 * @param {object} c { tiles, W, H, type, settlement, placed, frontLines, reach, isRoad }
 * @returns {object|null} { q0, q1, r0, r1, w, h, front, gate: {q, r}, plots: [{q, r}], church }
 */
export function planChurchyard(c) {
    const { tiles, W, H, type, settlement, placed, frontLines, reach, isRoad } = c;
    if (!tiles || !Array.isArray(frontLines) || !frontLines.length) return null;
    const salt = `${(settlement && settlement.name) || ''}|${settlement && settlement.q},${settlement && settlement.r}`;
    const church = (placed || []).find(p => p && CHURCHES.has(p.type)) || null;
    const ch = church ? { q: (church.left + church.right) / 2, r: church.front } : null;
    const outer = type === 'village' ? 1.2 : 1.02;

    const clear = (q0, q1, r0, r1) => {
        for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
            if (q < 2 || r < 2 || q >= W - 2 || r >= H - 2) return false;
            const t = tiles[r][q];
            if (!t || t.isRoad || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t._reserved || t._lot) return false;
            if (t.subTerrain && t.subTerrain.id && /water/.test(t.subTerrain.id)) return false;
        }
        return true;
    };

    const [W0, H0] = GraveBook.yardSize(type);
    const sizes = [];
    for (let w = W0; w >= 7; w -= 2) for (let h = H0; h >= 4; h--) if (GraveBook.plotCount(w, h) >= 4) sizes.push([w, h]);
    sizes.sort((a, b) => GraveBook.plotCount(b[0], b[1]) - GraveBook.plotCount(a[0], a[1]));

    for (const [w, h] of sizes) {
        const cands = [];
        for (const line of frontLines) {
            for (let x = line.x0; x + w - 1 <= line.x1; x++) {
                for (const side of [-1, 1]) {
                    const q0 = x, q1 = x + w - 1;
                    let r0, r1, gateR;
                    if (side < 0) {
                        let front = Infinity;
                        for (let q = q0; q <= q1; q++) front = Math.min(front, line.top(q));
                        r1 = front - 1; r0 = r1 - h + 1; gateR = r1 + 1;
                    } else {
                        let back = -Infinity;
                        for (let q = q0; q <= q1; q++) back = Math.max(back, line.bottom(q));
                        r0 = back + 1; r1 = r0 + h - 1; gateR = r0 - 1;
                    }
                    const mq = (q0 + q1) / 2, mr = (r0 + r1) / 2;
                    const d = reach(Math.round(mq), Math.round(mr));
                    if (!(d <= outer) || d < 0.12) continue;
                    const score = (ch ? Math.hypot(mq - ch.q, mr - ch.r) / 10 : Math.abs(d - 0.9) * 4)
                        + (graveHash(`${salt}|${x}|${side}|${line.x0}`) % 1000) / 4000;
                    cands.push({ q0, q1, r0, r1, gateR, side, score });
                }
            }
        }
        cands.sort((a, b) => a.score - b.score);
        for (const k of cands) {
            if (!clear(k.q0 - 1, k.q1 + 1, k.r0, k.r1)) continue;
            const mid = Math.floor((k.q0 + k.q1) / 2);
            if (!isRoad(mid, k.gateR)) continue;
            const front = k.side < 0 ? 'south' : 'north';
            const plots = GraveBook.yardPlots(k.q0, k.r0, w, h, front);
            for (let r = k.r0; r <= k.r1; r++) for (let q = k.q0; q <= k.q1; q++) {
                const t = tiles[r][q];
                t._grave = 'town';
                t._graveFront = front;
                t._reserved = true;
                t._townCleared = true;
            }
            plots.forEach((p, i) => {
                tiles[p.r][p.q]._plot = i;
                tiles[p.r][p.q]._plotHead = true;
                tiles[p.r][p.q + 1]._plot = i;
            });
            const frontR = front === 'south' ? k.r1 : k.r0;
            return { q0: k.q0, q1: k.q1, r0: k.r0, r1: k.r1, w, h, front, gate: { q: mid, r: frontR }, plots, church: church ? church.type : null };
        }
    }
    return null;
}
