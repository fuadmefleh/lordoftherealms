// ============================================================
// SCAFFOLDS — the gallows, the block or the stake in a town's square
// ============================================================
// From the day an execution is proclaimed to the day it is done
// (systems/executions.js writes settlement.scaffold = { id, from, day, method,
// name }), the town's street map shows it in the square: the gallows for a
// hanging or a quartering, the headsman's block for the axe, the stake and its
// faggots for a burning. world/innerMap/terrain.js folds stamp() into the
// map's cache key, so the map is laid anew when the scaffold goes up or comes
// down, and calls lay() after the town's memorials; the crowd that gathers on
// the day is world/innerMap/townScenes.js (_scaffoldScene, reading spot()).
//
// Pure: hash-placed, draws nothing from the map's rng; no globals.

import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';
import { TownMarks, markHash } from './townMarks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The prop for each manner of death. */
const PROPS = { hang: 'ex_gallows', quarter: 'ex_gallows', behead: 'ex_block', burn: 'ex_stake' };

export const Scaffolds = {
    PROPS,

    /** The scaffold standing in this town on `day` ({ id, from, day, method, name }), or null. */
    current(settlement, day) {
        const sc = settlement && settlement.scaffold;
        if (!sc || typeof sc !== 'object') return null;
        const d = _num(day);
        return d >= _num(sc.from) && d <= _num(sc.day) ? sc : null;
    },

    /** Is this the day itself (the crowd gathers)? */
    isTheDay(settlement, day) {
        const sc = Scaffolds.current(settlement, day);
        return !!(sc && _num(sc.day) === _num(day));
    },

    /** Part of the street map's cache key: '' when nothing stands. */
    stamp(settlement, day) {
        const sc = Scaffolds.current(settlement, day);
        return sc ? `|scaf:${sc.id}${PROPS[sc.method] || PROPS.hang}` : '';
    },

    /**
     * Stand the scaffold in the square (opts.plaza { q, r, w, h }, opts.center).
     * → { q, r } where it stands, or null.
     */
    lay(tiles, settlement, day, opts = {}) {
        const sc = Scaffolds.current(settlement, day);
        if (!sc || !tiles || !tiles.length || !tiles[0]) return null;
        const id = PROPS[sc.method] || PROPS.hang;
        const def = CustomObjects.getDef(id);
        if (!def) return null;
        const W = tiles[0].length, H = tiles.length;
        const center = opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) };
        const key = `scaffold|${sc.id}`;
        // The middle of the square first (a scaffold stands where all can see), then its sides, then near the middle of town
        const spots = [];
        const p = opts.plaza || null;
        if (p) {
            for (let r = p.r + 3; r <= p.r + p.h - 1; r++) {
                for (let q = p.q; q <= p.q + p.w - 3; q++) spots.push({ q, r, s: Math.abs(q + 1.5 - (p.q + p.w / 2)) + Math.abs(r - (p.r + p.h * 0.6)) * 0.7 + markHash(key, q, r) * 0.2 });
            }
        }
        for (let r = center.r - 10; r <= center.r + 10; r++) {
            for (let q = center.q - 12; q <= center.q + 12; q++) spots.push({ q, r, s: 50 + Math.hypot(q - center.q, r - center.r) + markHash(key, q, r) });
        }
        spots.sort((a, b) => a.s - b.s);
        for (const { q, r } of spots) {
            if (q < 2 || r < 3 || q >= W - 4 || r >= H - 2) continue;
            if (TownMarks._blocksDoor(tiles, def, q, r)) continue;
            if (!TownProps.place(tiles, def, q, r, { onRoad: true, ignoreReserved: true })) continue;
            tiles[r][q].customObject.scaffold = sc.id;
            tiles._scaffold = { q, r, id: sc.id, method: sc.method, name: sc.name || null, day: sc.day };
            return { q, r };
        }
        return null;
    },

    /** Where the scaffold stands on these tiles (its anchor and its foot), or null. */
    spot(tiles) {
        const s = tiles && tiles._scaffold;
        return s ? { q: s.q + 1, r: s.r + 1, anchor: { q: s.q, r: s.r }, ...s } : null;
    },
};
