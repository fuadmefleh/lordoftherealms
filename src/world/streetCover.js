// ============================================================
// STREET COVER — where on a street map one can hide
// ============================================================
// A cell is cover when standing in it hides you (data/stealthCover.json):
//
//   • behind a prop: the first walkable row above what a bush, a tree's
//     trunk, a haystack, a market stall's counter or a stack of crates
//     blocks — the prop is drawn over your legs there (props.tags/ids);
//   • in a field of tall crops (fields): the whole field;
//   • in the tall reeds on a bank (a decor drawn two tiles tall);
//   • in tall grass or brush out in the wilds (ground);
//   • at night, a dark corner between two walls (alley: needs darkness).
//
// coverAt(tiles, q, r, opts) reads one cell from the tile data (cheap: the
// per-frame check). spots(tiles) is every static cover cell of a map, worked
// out once and cached on the map's tile array (who lies in wait picks from
// it). cellsOf(tiles, q, r) are the cover cells of the prop at a cell (Hide
// in the Bush). layTown puts bushes and thickets along a town's edge, by its
// roads out and in its yards when the plan left it bare: hash-placed, drawing
// nothing from the map's dice.
//
// Pure: no globals, no import-time effects.

import { DataLoader } from '../core/dataLoader.js';
import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const _spotCache = new WeakMap();

function _cfg() {
    const d = (DataLoader.get && DataLoader.get('stealthCover')) || (DataLoader._gamedata && DataLoader._gamedata.stealthCover) || null;
    return _obj(d);
}

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const _at = (tiles, q, r) => (tiles && r >= 0 && q >= 0 && r < tiles.length && tiles[r] && q < tiles[r].length ? tiles[r][q] : null);
const _isBuilding = t => !!(t && (t.building || t.customBuilding || t.customBuildingPart || t._isInterior));

/** The kind of cover a prop gives (by its id, its tags, a field's crop), or null. */
function _propKind(def) {
    if (!def) return null;
    const C = _cfg();
    const P = _obj(C.props);
    const ids = _obj(P.ids);
    if (ids[def.id]) return ids[def.id];
    const f = TownProps.parseFieldId(def.id);
    if (f) return (C.fields || []).includes(f.kind) ? 'crops' : null;
    const tags = def.tags || [];
    const T = _obj(P.tags);
    for (const tag of tags) {
        if (!T[tag]) continue;
        // (a tag that only some of its props give: the market stall, not every stall-side crate)
        if (tag === 'stall' && Array.isArray(P.onlyIds) && !P.onlyIds.includes(def.id) && !ids[def.id]) continue;
        return T[tag];
    }
    if (def.objectType === 'tree' && T.tree) return T.tree;
    return null;
}

/** The cells of a prop's footprint that hide whoever stands in them: [{ dq, dr }] off its anchor. */
function _coverCellsOfDef(def, kind) {
    const cells = new Map();
    for (const t of def.tiles || []) cells.set(`${t.localCol},${t.localRow}`, { c: t.localCol, r: t.localRow, solid: false });
    for (const m of def.meta || []) {
        const k = `${m.localCol},${m.localRow}`;
        const e = cells.get(k) || { c: m.localCol, r: m.localRow, solid: false };
        if (m.impassable) e.solid = true;
        cells.set(k, e);
    }
    const all = [...cells.values()];
    // A field of crops: the whole of it
    if (kind === 'crops') return all.filter(e => !e.solid).map(e => ({ dq: e.c, dr: e.r }));
    const solids = all.filter(e => e.solid);
    if (!solids.length) return [];
    // The first row above what it blocks: the prop is drawn over the legs of whoever stands there
    const top = Math.min(...solids.map(e => e.r));
    const row = top - 1;
    return all.filter(e => e.r === row && !e.solid).map(e => ({ dq: e.c, dr: e.r }));
}

const _defCells = new Map();
function _cellsFor(def) {
    if (!def) return [];
    let v = _defCells.get(def);
    if (!v) {
        const kind = _propKind(def);
        v = { kind, cells: kind ? _coverCellsOfDef(def, kind) : [] };
        _defCells.set(def, v);
    }
    return v;
}

function _anchorOf(tiles, t, q, r) {
    if (t.customObject) return { q, r, obj: t.customObject };
    if (t.customObjectPart) {
        const a = _at(tiles, t.customObjectPart.anchorQ, t.customObjectPart.anchorR);
        if (a && a.customObject) return { q: t.customObjectPart.anchorQ, r: t.customObjectPart.anchorR, obj: a.customObject };
    }
    return null;
}

/** Can one stand in this cell at all (open ground or a floor, not a wall, not water)? */
function _standable(t) {
    return !!(t && t.subTerrain && t.subTerrain.passable && !_isBuilding(t) && !t._wet && !t._sea);
}

export const StreetCover = {
    /**
     * The cover a cell gives: { kind, quality, word, anchor? } or null.
     * @param {Array} tiles the street map's tiles (rows)
     * @param {object} opts { darkness (0..1: a dark corner counts only at night), indoors }
     */
    coverAt(tiles, q, r, opts = {}) {
        const t = _at(tiles, q, r);
        if (!t || opts.indoors) return null;
        if (!(t.subTerrain && t.subTerrain.passable) || _isBuilding(t)) return null;
        const C = _cfg();
        const defOf = kind => {
            const d = _obj(_obj(C.cover)[kind]);
            return { kind, quality: Math.max(0, Math.min(0.98, _num(d.quality, 0.5))), word: d.word || kind };
        };
        // Behind or in a prop
        const anchor = _anchorOf(tiles, t, q, r);
        if (anchor && CustomObjects.getDef) {
            const def = CustomObjects.getDef(anchor.obj.defId);
            const { kind, cells } = _cellsFor(def);
            if (kind && cells.some(c => anchor.q + c.dq === q && anchor.r + c.dr === r)) {
                return { ...defOf(kind), anchor: { q: anchor.q, r: anchor.r, defId: anchor.obj.defId, name: def.name || null } };
            }
        }
        // Tall reeds on a bank
        if (Array.isArray(t.decor) && t.decor.some(d => d && _num(d.h, 1) >= 2)) return defOf('reeds');
        // Tall grass, brush out in the wilds (not on the town's streets)
        const G = _obj(C.ground);
        const sub = t.subTerrain && t.subTerrain.id;
        if (sub && G[sub] && !t.isRoad && !t._townCore && !t.paving) return defOf(G[sub]);
        // A dark corner between two walls
        const alley = _obj(_obj(C.cover).alley);
        if (_num(opts.darkness) >= _num(alley.minDarkness, 0.45) && !t._plaza) {
            let walls = 0;
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (_isBuilding(_at(tiles, q + dq, r + dr))) walls++;
            if (walls >= 2) return defOf('alley');
        }
        return null;
    },

    /** The cover cells of the prop at (q, r) (any of its cells), that one could stand in now. */
    cellsOf(tiles, q, r) {
        const t = _at(tiles, q, r);
        if (!t) return [];
        const anchor = _anchorOf(tiles, t, q, r);
        if (!anchor) return [];
        const def = CustomObjects.getDef ? CustomObjects.getDef(anchor.obj.defId) : null;
        const { kind, cells } = _cellsFor(def);
        if (!kind) return [];
        return cells.map(c => ({ q: anchor.q + c.dq, r: anchor.r + c.dr, kind }))
            .filter(c => _standable(_at(tiles, c.q, c.r)));
    },

    /** Does the prop at (q, r) give cover? → its kind or null. */
    propKindAt(tiles, q, r) {
        const t = _at(tiles, q, r);
        const anchor = t ? _anchorOf(tiles, t, q, r) : null;
        if (!anchor || !CustomObjects.getDef) return null;
        return _cellsFor(CustomObjects.getDef(anchor.obj.defId)).kind || null;
    },

    /** The nearest cover cell within radius (Chebyshev) of (q, r): { q, r, kind, quality, dist } or null. */
    nearest(tiles, q, r, radius = 3, opts = {}) {
        let best = null;
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dq = -radius; dq <= radius; dq++) {
                const d = Math.max(Math.abs(dq), Math.abs(dr));
                if (best && d >= best.dist) continue;
                const c = StreetCover.coverAt(tiles, q + dq, r + dr, opts);
                if (c && _standable(_at(tiles, q + dq, r + dr))) best = { ...c, q: q + dq, r: r + dr, dist: d };
            }
        }
        return best;
    },

    /**
     * Every static cover cell of a map (props, reeds, tall grass — not the dark corners),
     * worked out once per map and kept with its tiles. Checked again with coverAt at use.
     */
    spots(tiles) {
        if (!tiles || typeof tiles !== 'object') return [];
        let s = _spotCache.get(tiles);
        if (s) return s;
        s = [];
        const H = tiles.length;
        for (let r = 0; r < H; r++) {
            const row = tiles[r] || [];
            for (let q = 0; q < row.length; q++) {
                const t = row[q];
                if (!t || !(t.customObject || t.customObjectPart || t.decor || (t.subTerrain && _obj(_cfg().ground)[t.subTerrain.id]))) continue;
                const c = StreetCover.coverAt(tiles, q, r, {});
                // (tall grass covers whole meadows in the wilds: every third cell is plenty to lie in wait in)
                if (c && (c.kind !== 'grass' || (q + r) % 3 === 0)) s.push({ q, r, kind: c.kind });
            }
        }
        _spotCache.set(tiles, s);
        return s;
    },

    /** Forget a map's cached spots (props felled, fields grown). */
    forget(tiles) {
        if (tiles) _spotCache.delete(tiles);
    },

    /**
     * Bushes, thickets and hedges for a town's edge, the roads leading out and
     * its yards (data townCover), after the planner and the scatter. Hash-placed
     * on the town's own key: the plan underneath stands as it stood.
     * @returns {number} how many were set down
     */
    layTown(tiles, settlement, key = '') {
        const C = _obj(_cfg().townCover);
        const ids = (Array.isArray(C.ids) ? C.ids : []).filter(id => CustomObjects.getDef && CustomObjects.getDef(id));
        if (!tiles || !tiles.length || !settlement || !ids.length) return 0;
        const H = tiles.length, W = tiles[0].length;
        const type = settlement.type || 'village';
        const edgeWant = _num(_obj(C.edge)[type], 10);
        const yardWant = _num(_obj(C.yards)[type], 3);
        const [fadeLo, fadeHi] = Array.isArray(C.edgeFade) ? C.edgeFade : [0.02, 0.4];
        const seed = `${key}|${settlement.name || ''}|cover`;
        let n = 0;
        const pick = (salt) => CustomObjects.getDef(ids[Math.floor(_frac(`${seed}|${salt}|id`) * ids.length) % ids.length]);
        // Clear of doors and gates (two rows below, a tile to the side), of lots, the square and water
        const clearAround = (def, q, r) => {
            for (const m of [...(def.meta || []), ...(def.tiles || [])]) {
                const fq = q + m.localCol, fr = r + m.localRow;
                const t = _at(tiles, fq, fr);
                if (!t || t._lot || t._plaza || t._wet || t._sea || t._bridge || t.paving) return false;
                if (t.subTerrain && !t.subTerrain.passable) return false;
                for (let dr = -2; dr <= 2; dr++) for (let dq = -1; dq <= 1; dq++) {
                    const u = _at(tiles, fq + dq, fr + dr);
                    if (!u) continue;
                    if (u._doorMarker || u._isDoor) return false;
                    if (u.customObject && /gate/.test(u.customObject.defId || '')) return false;
                }
            }
            // and a tile of room about it, so the cover behind it can be walked into
            const row = r + (def.bounds ? def.bounds.minRow : -1) - 1;
            for (let qq = q + (def.bounds ? def.bounds.minCol : 0); qq <= q + (def.bounds ? def.bounds.maxCol : 2); qq++) {
                const u = _at(tiles, qq, row);
                if (!u || _isBuilding(u) || u._wet) return false;
            }
            return true;
        };
        const put = (def, q, r) => {
            if (!def || !TownProps.fits(tiles, def, q, r) || !clearAround(def, q, r)) return false;
            if (!TownProps.place(tiles, def, q, r)) return false;
            n++;
            return true;
        };
        // 1. The town's edge: the near ring of its farmland
        const ring = [];
        for (let r = 2; r < H - 2; r++) {
            for (let q = 2; q < W - 4; q++) {
                const t = tiles[r][q];
                const f = _num(t._townFade, -1);
                if (f < fadeLo || f > fadeHi || t.isRoad) continue;
                ring.push({ q, r });
            }
        }
        if (ring.length) {
            let put0 = 0;
            for (let i = 0; i < edgeWant * 12 && put0 < edgeWant; i++) {
                const c = ring[Math.floor(_frac(`${seed}|edge|${i}`) * ring.length) % ring.length];
                if (put(pick(`e${i}`), c.q, c.r)) put0++;
            }
        }
        // 2. By the roads leading out: on a verge a tile off the road, every few steps
        const [s0, s1] = Array.isArray(C.roadStep) ? C.roadStep : [7, 11];
        const roadMax = _num(C.roadMax, 14);
        const out = [];
        for (let r = 2; r < H - 2; r++) {
            for (let q = 2; q < W - 4; q++) {
                const t = tiles[r][q];
                if (t.isRoad && _num(t._townFade, -1) > 0) out.push({ q, r });
            }
        }
        const done = [];
        const free = (qq, rr) => { const u = _at(tiles, qq, rr); return !!u && !u.isRoad; };
        for (let i = 0; out.length && i < roadMax * 12 && done.length < roadMax; i++) {
            const { q, r } = out[Math.floor(_frac(`${seed}|road|${i}`) * out.length) % out.length];
            // (spaced along the way: none nearer than the step to another)
            const step = s0 + Math.floor(_frac(`${seed}|gap|${q},${r}`) * Math.max(1, s1 - s0 + 1));
            if (done.some(d => Math.max(Math.abs(d.q - q), Math.abs(d.r - r)) < step)) continue;
            // the verge beside it, a tile clear of the road: above or below a road running east-west,
            // left or right of one running north-south (a bush is 3 wide, 2 tall; its anchor bottom-left)
            const def = pick(`r${q},${r}`);
            const ok = (free(q, r - 2) && put(def, q - 1, r - 2)) || (free(q, r + 2) && put(def, q - 1, r + 3))
                || (free(q - 2, r) && put(def, q - 4, r)) || (free(q + 2, r) && put(def, q + 2, r));
            if (ok) done.push({ q, r });
        }
        // 3. A few in the yards: inside the town, off the streets, clear of the houses
        const yard = [];
        for (let r = 3; r < H - 3; r++) {
            for (let q = 3; q < W - 5; q++) {
                const t = tiles[r][q];
                if (!t._townCore || t.isRoad || t._lot || t._plaza) continue;
                yard.push({ q, r });
            }
        }
        if (yard.length) {
            let put1 = 0;
            for (let i = 0; i < yardWant * 30 && put1 < yardWant; i++) {
                const c = yard[Math.floor(_frac(`${seed}|yard|${i}`) * yard.length) % yard.length];
                const def = pick(`y${i}`);
                // a tile of room all round, so nothing stands hard against a wall
                let room = true;
                for (let rr = c.r + (def.bounds ? def.bounds.minRow : -1) - 1; rr <= c.r + 1 && room; rr++) {
                    for (let qq = c.q - 1; qq <= c.q + (def.bounds ? def.bounds.maxCol : 2) + 1; qq++) {
                        const u = _at(tiles, qq, rr);
                        if (!u || u.isRoad || _isBuilding(u) || u._lot) { room = false; break; }
                    }
                }
                if (room && put(def, c.q, c.r)) put1++;
            }
        }
        if (n) StreetCover.forget(tiles);
        return n;
    },
};
