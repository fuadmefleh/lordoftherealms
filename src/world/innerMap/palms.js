// InnerMap — palms in the wild: the oases of the desert, along the beaches,
// over the islands (data/innerMap.json palms; the palm props are the town
// ones, data/townProps.json tp_palm_*, cut by scripts/make_palm_sheet.py).
//
// In a desert they stand round its water (an oasis pool) and, rarely, alone
// in the sand; on a beach they line the sand back from the shore; an island
// is thick with them. Laid last, on a stream of their own seeded by the hex,
// so nothing else on the map moves for them; not on a town's map (its own
// planner plants its palms), the water, a road or the shallows.

import { InnerMap } from './_ref.js';
import { DataLoader, CustomObjects, TownProps } from './_imports.js';

const _cfg = () => {
    const d = (DataLoader.get && DataLoader.get('innerMap')) || (DataLoader._gamedata && DataLoader._gamedata.innerMap) || {};
    return d.palms || null;
};

function _rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Is a tree that isn't a palm standing within `gap` cells of (q, r)? */
function _otherTreeNear(tiles, q, r, gap) {
    for (let rr = r - gap; rr <= r + gap; rr++) {
        const row = tiles[rr];
        if (!row) continue;
        for (let qq = q - gap; qq <= q + gap; qq++) {
            const t = row[qq];
            const o = t && t.customObject;
            if (!o) continue;
            const d = CustomObjects.getDef(o.defId);
            const tags = (d && d.tags) || [];
            const tree = tags.includes('tree') || (d && d.objectType === 'tree');
            if (tree && !tags.includes('palm') && !(d && d.palm)) return true;
        }
    }
    return false;
}

Object.assign(InnerMap, {
    /** Plant the hex's wild palms. Returns how many were planted. */
    _plantPalms(tiles, worldTile, worldQ, worldR, worldSeed = 0) {
        const C = _cfg();
        const terrainId = worldTile && worldTile.terrain ? String(worldTile.terrain.id || '').toLowerCase() : '';
        const P = C && C.terrains && C.terrains[terrainId];
        if (!P || !worldTile || worldTile.settlement) return 0;
        const defs = (C.ids || []).map(id => CustomObjects.getDef(id)).filter(Boolean);
        if (!defs.length) return 0;
        const ground = new Set(C.ground || ['sand']);
        const H = tiles.length, W = tiles[0] ? tiles[0].length : 0;
        const rng = _rng(((worldQ * 92837111) ^ (worldR * 689287499) ^ (Number(worldSeed) * 2654435761) ^ 0x9e3779b9) >>> 0);
        const isWater = (t) => !!(t && (t._wet || t._sea || /water/.test((t.subTerrain && t.subTerrain.id) || '')));
        // How far each cell lies from water (out to the oasis radius), for the desert's palms
        const near = P.nearWater || 0;
        let dist = null;
        if (near > 0) {
            dist = new Int16Array(W * H).fill(-1);
            const queue = [];
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (isWater(tiles[r][q])) { dist[r * W + q] = 0; queue.push(r * W + q); }
            for (let i = 0; i < queue.length; i++) {
                const c = queue[i], q = c % W, r = (c - q) / W, d = dist[c];
                if (d >= near) continue;
                for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nq = q + dq, nr = r + dr;
                    if (nq < 0 || nr < 0 || nq >= W || nr >= H || dist[nr * W + nq] >= 0) continue;
                    dist[nr * W + nq] = d + 1;
                    queue.push(nr * W + nq);
                }
            }
        }
        const gap = Number.isFinite(C.groveGap) ? C.groveGap : 4;
        let planted = 0;
        for (let r = 2; r < H - 1; r++) {
            for (let q = 1; q < W - 2; q++) {
                const t = tiles[r][q];
                if (!t || !t.subTerrain || !t.subTerrain.passable || isWater(t) || t.isRoad) continue;
                if (!ground.has(t.subTerrain.id)) continue;
                if (t._townCore || t._townCleared || t._townFade != null) continue;
                // (never over a wild encounter: the trunk row is where it would block)
                if ([0, 1, 2].some(dq => tiles[r][q + dq] && tiles[r][q + dq].encounter)) continue;
                const d = dist ? dist[r * W + q] : -1;
                // Within reach of water it's an oasis; elsewhere a palm is a rare thing
                const chance = d >= 1 ? (P.oasis || 0) : (P.chance || 0);
                if (!(chance > 0) || rng() >= chance) continue;
                const def = defs[Math.floor(rng() * defs.length)];
                // Palms keep to their own groves: none among the oaks and pines the scatter grew
                if (gap > 0 && _otherTreeNear(tiles, q, r, gap)) continue;
                if (TownProps.place(tiles, def, q, r)) planted++;
            }
        }
        return planted;
    },
});
