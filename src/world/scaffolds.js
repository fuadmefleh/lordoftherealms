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
// The PILLORY stands beside it while someone sits in the stocks there
// (systems/peopleCrimes.js writes settlement.pillory = { ref, name, from,
// until, why, owed } and clears it when they go free or die there).
// Clicking either on the street map: ui/innerMapScaffold.js.
//
// Pure: hash-placed, draws nothing from the map's rng; no globals.

import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';
import { TownMarks, markHash } from './townMarks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The prop for each manner of death. */
const PROPS = { hang: 'ex_gallows', quarter: 'ex_gallows', behead: 'ex_block', burn: 'ex_stake', flay: 'ex_gallows' };

export const Scaffolds = {
    PROPS,

    /** The scaffold standing in this town on `day` ({ id, from, day, method, name }), or null. */
    current(settlement, day) {
        const sc = settlement && settlement.scaffold;
        if (!sc || typeof sc !== 'object') return null;
        const d = _num(day);
        return d >= _num(sc.from) && d <= _num(sc.day) ? sc : null;
    },

    /** Someone in the stocks in this town on `day` ({ ref, name, from, until, why }), or null. */
    pillory(settlement, day) {
        const pl = settlement && settlement.pillory;
        if (!pl || typeof pl !== 'object') return null;
        const d = _num(day);
        return d >= _num(pl.from) && d <= _num(pl.until) ? pl : null;
    },

    /** Is this the day itself (the crowd gathers)? */
    isTheDay(settlement, day) {
        const sc = Scaffolds.current(settlement, day);
        return !!(sc && _num(sc.day) === _num(day));
    },

    /** Part of the street map's cache key: '' when nothing stands. */
    stamp(settlement, day) {
        const sc = Scaffolds.current(settlement, day);
        const pl = Scaffolds.pillory(settlement, day);
        return (sc ? `|scaf:${sc.id}${PROPS[sc.method] || PROPS.hang}` : '') + (pl ? `|pil:${pl.ref}` : '');
    },

    /**
     * Stand the scaffold in the square (opts.plaza { q, r, w, h }, opts.center),
     * and the pillory beside it while someone sits in the stocks.
     * → { q, r } where the scaffold stands, or null.
     */
    lay(tiles, settlement, day, opts = {}) {
        if (!tiles || !tiles.length || !tiles[0]) return null;
        const sc = Scaffolds.current(settlement, day);
        const def = sc ? CustomObjects.getDef(PROPS[sc.method] || PROPS.hang) : null;
        const at = def ? Scaffolds._place(tiles, def, `scaffold|${sc.id}`, opts) : null;
        if (at) {
            tiles[at.r][at.q].customObject.scaffold = sc.id;
            tiles._scaffold = { q: at.q, r: at.r, id: sc.id, method: sc.method, name: sc.name || null, day: sc.day };
        }
        // (the pillory after it: the scaffold keeps the middle of the square)
        const pl = Scaffolds.pillory(settlement, day);
        if (pl) Scaffolds._layPillory(tiles, pl, opts);
        return at;
    },

    /** The pillory in the square (its own spot, by its own hash). → { q, r } or null */
    _layPillory(tiles, pl, opts) {
        const def = CustomObjects.getDef('ex_pillory');
        if (!def) return null;
        const at = Scaffolds._place(tiles, def, `pillory|${pl.ref}`, opts);
        if (!at) return null;
        tiles[at.r][at.q].customObject.pillory = pl.ref;
        tiles._pillory = { q: at.q, r: at.r, ref: pl.ref, name: pl.name || null, until: pl.until };
        return at;
    },

    _place(tiles, def, key, opts) {
        const W = tiles[0].length, H = tiles.length;
        const center = opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) };
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
            return { q, r };
        }
        return null;
    },

    /** Where the scaffold stands on these tiles (its anchor and its foot), or null. */
    spot(tiles) {
        const s = tiles && tiles._scaffold;
        return s ? { q: s.q + 1, r: s.r + 1, anchor: { q: s.q, r: s.r }, ...s } : null;
    },

    /** Where the pillory stands on these tiles ({ q, r, ref, name, until }), or null. */
    pilloryAt(tiles) {
        return (tiles && tiles._pillory) || null;
    },
};
