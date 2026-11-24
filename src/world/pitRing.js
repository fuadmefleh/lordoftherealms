// ============================================================
// PIT RING — the town's fighting pit on its street map, and its nights
// ============================================================
// A town that keeps a pit (systems/pitFights.js writes settlement.pit) shows
// it on its street map while it fights in the open: a fenced ring of trodden
// ground with a gate on its south side, by the tavern where there is one
// (else near the square). A pit the law has driven underground has no ring:
// it fights in a cellar behind some honest front. world/innerMap/terrain.js
// folds stamp() into the map's cache key, so the ring goes up or comes down
// with the law, and calls lay() after the scaffold; the crowd on fight nights
// is world/innerMap/pitCrowd.js, the fence's menu ui/innerMapPit.js.
//
// THE NIGHTS (nightOf): the town's weekly market night (a hash of the town;
// cities and capitals a second night), the first days of each season (the
// feasts) and the days of a fair. The bouts are fought in the evening.
//
// Pure: hash-placed, draws nothing from the map's rng or the shared stream; no globals.

import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';
import { CustomBuildings } from './customBuildings.js';
import { Seasons } from './seasons.js';
import { SettlementMarket } from './settlementMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _h(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x2f; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** The ring's inside, in cells (the fence goes round it). */
const IN_W = 5, IN_H = 4;
/** The hours the bouts are fought. */
const HOURS = [18, 24];
const TAVERNS = new Set(['tavern', 'inn', 'roadhouse']);

/** May the ring's fence or floor stand on this cell? */
function _free(t) {
    return !!(t && t.subTerrain && t.subTerrain.passable && !t.isRoad && !t._wet && !t._sea && !t._lot && !t._plaza && !t._grave
        && !t._pier && !t._deck && !t._bridge && !t._isInterior && !t._field && !t._crop && !t._doorMarker && !t._reserved
        && !t.building && !t.customBuilding && !t.customBuildingPart && !t.customObject && !t.customObjectPart
        && !(t.subTerrain.id && /water/.test(t.subTerrain.id)));
}

export const PitRing = {
    HOURS,

    /** The town's key for its hashes (its founding name: a renamed town keeps its nights). */
    key(settlement) {
        return settlement ? `${settlement.foundingName || settlement.name || 'town'}|${settlement.q},${settlement.r}` : 'none';
    },

    /** The town's market night, 0–6 (day % 7). */
    marketNight(settlement) {
        return Math.floor(_h(PitRing.key(settlement), 'pitnight') * 7) % 7;
    },

    /**
     * Is `day` a fight night in this town? → { fight, why: 'market'|'feast'|'fair'|null }.
     * Cities and capitals fight a second night a week, three days after the first.
     */
    nightOf(settlement, day) {
        const d = Math.floor(_num(day));
        if (!settlement) return { fight: false, why: null };
        const fair = SettlementMarket.fair(settlement);
        if (fair && d >= _num(fair.start, -1) && d <= _num(fair.until, -1)) return { fight: true, why: 'fair' };
        if (Seasons.dayInSeason(d) === 1) return { fight: true, why: 'feast' };
        const m = PitRing.marketNight(settlement);
        const w = ((d % 7) + 7) % 7;
        if (w === m) return { fight: true, why: 'market' };
        if ((settlement.type === 'city' || settlement.type === 'capital') && w === (m + 3) % 7) return { fight: true, why: 'market' };
        return { fight: false, why: null };
    },

    /** The next fight night on or after `day` (within 8 days): { day, why }. */
    nextNight(settlement, day) {
        for (let k = 0; k <= 8; k++) {
            const n = PitRing.nightOf(settlement, _num(day) + k);
            if (n.fight) return { day: _num(day) + k, why: n.why };
        }
        return null;
    },

    /** Does the town's pit stand in the open on its street map? */
    standing(settlement) {
        const p = settlement && settlement.pit;
        return !!(p && typeof p === 'object' && !p.underground && !p.closed);
    },

    /** Part of the street map's cache key: '' when no ring stands. */
    stamp(settlement) {
        return PitRing.standing(settlement) ? `|pit:${settlement.pit.id || 'pit'}` : '';
    },

    /** Where to look for ground: the tavern's door, else the square, else the middle of town. */
    _target(tiles, opts) {
        const H = tiles.length, W = tiles[0].length;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const cb = tiles[r][q].customBuilding;
                if (!cb) continue;
                const def = CustomBuildings.getBuilding(cb.defId);
                if (def && TAVERNS.has(def.buildingType)) return { q, r, by: 'tavern' };
            }
        }
        const p = opts.plaza;
        if (p) return { q: p.q + Math.floor(p.w / 2), r: p.r + p.h + 2, by: 'square' };
        return { ...(opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) }), by: 'town' };
    },

    /**
     * Fence the ring on the town's street map (opts.plaza, opts.center from the
     * town's layout). → { q, r, w, h, gate } (the fence's top-left corner and
     * its outer size), or null (no pit in the open, or no ground for one).
     */
    lay(tiles, settlement, opts = {}) {
        if (!tiles || !tiles.length || !tiles[0] || !PitRing.standing(settlement)) return null;
        const H = tiles.length, W = tiles[0].length;
        const ow = IN_W + 2, oh = IN_H + 2;
        const at = PitRing._target(tiles, opts);
        const key = PitRing.key(settlement);
        let best = null;
        for (let r = Math.max(2, at.r - 16); r <= Math.min(H - oh - 2, at.r + 14); r++) {
            for (let q = Math.max(2, at.q - 18); q <= Math.min(W - ow - 2, at.q + 18); q++) {
                const d = Math.hypot(q + ow / 2 - at.q, r + oh / 2 - at.r);
                if (best && d > best.s) continue;
                let ok = true;
                // (the ring and a pace of ground round it: the crowd stands there)
                for (let y = r - 1; y <= r + oh && ok; y++) {
                    for (let x = q - 1; x <= q + ow && ok; x++) {
                        const t = tiles[y] && tiles[y][x];
                        const edge = y === r - 1 || y === r + oh || x === q - 1 || x === q + ow;
                        if (edge ? !(t && t.subTerrain && t.subTerrain.passable && !(t.customBuilding || t.customBuildingPart)) : !_free(t)) ok = false;
                    }
                }
                if (!ok) continue;
                const s = d + _h(key, q, r) * 1.5;
                if (!best || s < best.s) best = { q, r, s };
            }
        }
        if (!best) return null;
        const { q, r } = best;
        const gate = { q: q + Math.floor(ow / 2), r: r + oh - 1 };
        const put = (id, x, y) => {
            const def = CustomObjects.getDef(id);
            if (!def || !TownProps.place(tiles, def, x, y, { ignoreReserved: true })) return false;
            tiles[y][x].customObject.pit = settlement.pit.id || 'pit';
            return true;
        };
        for (let x = q; x < q + ow; x++) {
            put('tp_fence_ew', x, r);
            put(x === gate.q ? 'tp_fence_gate' : 'tp_fence_ew', x, r + oh - 1);
        }
        for (let y = r + 1; y < r + oh - 1; y++) {
            put('tp_fence_ns', q, y);
            put('tp_fence_ns', q + ow - 1, y);
        }
        TownProps.joinFences(tiles);
        for (let y = r + 1; y < r + oh - 1; y++) for (let x = q + 1; x < q + ow - 1; x++) tiles[y][x]._pitFloor = true;
        // (what the street's crowd needs to know its nights: the town's name, place and size — not the town itself)
        const town = { name: settlement.name, foundingName: settlement.foundingName, q: settlement.q, r: settlement.r, type: settlement.type || 'town' };
        tiles._pit = { q, r, w: ow, h: oh, gate, id: settlement.pit.id || 'pit', key, town, name: settlement.pit.name || 'the pit', by: at.by };
        return tiles._pit;
    },

    /** The ring on these tiles ({ q, r, w, h, gate, id, key, town, name }), or null. */
    spot(tiles) {
        return (tiles && tiles._pit) || null;
    },

    /** Cells just outside the fence, for the crowd: [{ q, r, facing }] (facing toward the ring: 0 up, 1 left, 2 down, 3 right). */
    railCells(ring) {
        if (!ring) return [];
        const out = [];
        for (let x = ring.q; x < ring.q + ring.w; x++) {
            out.push({ q: x, r: ring.r - 1, facing: 2 });
            if (x !== ring.gate.q) out.push({ q: x, r: ring.r + ring.h, facing: 0 });
        }
        for (let y = ring.r; y < ring.r + ring.h; y++) {
            out.push({ q: ring.q - 1, r: y, facing: 3 });
            out.push({ q: ring.q + ring.w, r: y, facing: 1 });
        }
        return out;
    },
};
