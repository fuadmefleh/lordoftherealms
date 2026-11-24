// ============================================
// INTERIOR RECORDS — a visited building's inside, kept as it was found
// ============================================
// Interiors are planned from their seed (world/innerMap/interiorPlanner.js) and
// so came out afresh each session: after a change to the code or the plans a
// house could be laid out anew, its chests moved (and the stock kept by each
// chest's tile with them: systems/containers.js), a robbed house refilled, a
// broken table whole. Here each building the player has been inside is kept on
// world.interiors as it stood when last seen — every floor and its cellar — and
// laid back from that on every later visit (world/innerMap/persistInteriors.js).
//
// Compact: a building's floors share one list of field names, one palette of the
// objects on their tiles (a floor's subTerrain, a piece of furniture — a big piece's
// head kept relative to its tile — a stair) and one of tile shapes that point into
// it; each floor is its width, height, what the interior says of itself (door,
// rooms, stairs, whose it is) and a grid of tile-shape indices. Constant fields
// (explored, the indoor weather) are left out and put back; the renderer's caches
// and a home's piece storage (kept with the player's layout) are never kept.
// A tavern with its floors and cellar is some 12-18 KB of JSON before the save's gzip.
// Only buildings visited are kept, at most `maxKept` (the longest unvisited let go).
//
// world.interiors = { v: VERSION, b: { [interiorKey]: { d: day, f: { [floor]: … }, o, t } } }
// A save without it, or of another version, loads with none: interiors are planned
// as before and kept from the next visit.
//
// Pure: no game state, no randomness.

export const VERSION = 1;
// The cellars' plan (world/innerMap/floors.js _planFloor/_dressCellar): a record keeps the one
// its cellar was planned by (`cv`); a kept cellar of an older plan is planned afresh on the next
// visit (persistInteriors.js) while the floors above it stay as kept. 2: rows of stores with
// aisles, a split-off room, the landing kept clear, torches spaced for the light, straw and webs.
export const CELLAR_VERSION = 2;

// Fields every interior tile has with the same value: left out, put back on decode
const DEFAULTS = {
    explored: true, visible: true, parentTerrain: 'interior', encounter: null, building: null,
    _isInterior: true, _furniture: null, effectiveTemp: 20, moisture: 0.3, weatherType: 'clear',
};
// Fields never kept: the tile's own place (from the grid), and what is laid on again on
// every visit (a home's piece storage travels with the player's layout: furnishing.js)
const SKIP = new Set(['q', 'r']);
const SKIP_IN_FURNITURE = new Set(['_storage']);

const _obj = v => !!(v && typeof v === 'object');
const _same = (a, b) => a === b || (a == null && b == null);

/**
 * A tile's object field made plain for keeping: its furniture without its storage, a big
 * piece's head kept relative to the tile (so the same bed anywhere is one entry).
 */
function _plain(k, v, q, r) {
    if (k === '_furniture' && v && !Array.isArray(v)) {
        const out = {};
        for (const [fk, fv] of Object.entries(v)) if (!SKIP_IN_FURNITURE.has(fk) && fv !== undefined) out[fk] = fv;
        if (_obj(out.piece) && Number.isFinite(out.piece.q) && Number.isFinite(out.piece.r)) {
            out.piece = { ...out.piece, q: out.piece.q - q, r: out.piece.r - r, _rel: 1 };
        }
        return out;
    }
    return v;
}

/** A kept object back on its tile (fresh: never shared with another tile). */
function _unplain(k, v, q, r) {
    if (k === '_furniture' && v && _obj(v.piece) && v.piece._rel) {
        const { _rel, ...piece } = v.piece;
        v.piece = { ...piece, q: piece.q + q, r: piece.r + r };
    }
    return v;
}

/**
 * Encode a building's floors: { [floor]: interior } → { k, o, t, f } (JSON-safe): `k` the
 * field names, `o` the objects ([key index, value, …]), `t` the tile shapes ([key index,
 * value, …, -1, key index, object index, …]), `f` each floor's { w, h, m, g }.
 * interior: { tiles, width, height, ...its own fields }.
 */
export function encodeFloors(floors) {
    const keys = [], keyIdx = new Map();
    const K = (name) => {
        let i = keyIdx.get(name);
        if (i === undefined) { i = keys.length; keys.push(name); keyIdx.set(name, i); }
        return i;
    };
    const objs = [], objIdx = new Map();
    const shapes = [], shapeIdx = new Map();
    const intern = (list, idx, v) => {
        const s = JSON.stringify(v);
        let i = idx.get(s);
        if (i === undefined) { i = list.length; list.push(JSON.parse(s)); idx.set(s, i); }
        return i;
    };
    // (an object's own fields by key index; what lies deeper kept as it is)
    const flat = (o) => {
        const out = [];
        for (const [key, v] of Object.entries(o)) if (v !== undefined && typeof v !== 'function') out.push(K(key), v);
        return out;
    };
    const f = {};
    for (const [k, interior] of Object.entries(floors || {})) {
        if (!interior || !Array.isArray(interior.tiles)) continue;
        const w = interior.width, h = interior.height;
        const g = new Array(w * h);
        for (let r = 0; r < h; r++) {
            for (let q = 0; q < w; q++) {
                const t = (interior.tiles[r] && interior.tiles[r][q]) || null;
                const s = [], o = [];
                if (t) {
                    for (const [key, v] of Object.entries(t)) {
                        // (nor the renderer's caches on the tile: drawn afresh — ui/innerMapRenderer.js)
                        if (SKIP.has(key) || key.startsWith('_cached') || v === undefined || typeof v === 'function') continue;
                        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && _same(DEFAULTS[key], v)) continue;
                        if (_obj(v)) {
                            const pv = _plain(key, v, q, r);
                            o.push(K(key), intern(objs, objIdx, Array.isArray(pv) ? { a: pv } : { f: flat(pv) }));
                        } else s.push(K(key), v);
                    }
                }
                g[r * w + q] = intern(shapes, shapeIdx, o.length ? [...s, -1, ...o] : s);
            }
        }
        // What the interior says of itself (its door, rooms, stairs, whose it is)
        const meta = {};
        for (const [key, v] of Object.entries(interior)) {
            if (key === 'tiles' || key === 'width' || key === 'height' || v === undefined || typeof v === 'function') continue;
            meta[key] = v;
        }
        f[k] = { w, h, m: JSON.parse(JSON.stringify(meta)), g };
    }
    return { k: keys, o: objs, t: shapes, f };
}

/** Decode encodeFloors' output → { [floor]: interior } (every tile its own fresh objects). Null if malformed. */
export function decodeFloors(rec) {
    if (!rec || !Array.isArray(rec.k) || !Array.isArray(rec.o) || !Array.isArray(rec.t) || !_obj(rec.f)) return null;
    const keys = rec.k;
    // (each object rebuilt once as JSON, parsed afresh for every tile it stands on)
    const objStr = [];
    for (const e of rec.o) {
        if (!_obj(e)) return null;
        if (Array.isArray(e.a)) { objStr.push(JSON.stringify(e.a)); continue; }
        const o = {}, fl = Array.isArray(e.f) ? e.f : [];
        for (let i = 0; i + 1 < fl.length; i += 2) {
            const name = keys[fl[i]];
            if (name === undefined) return null;
            o[name] = fl[i + 1];
        }
        objStr.push(JSON.stringify(o));
    }
    const out = {};
    for (const [k, fl] of Object.entries(rec.f)) {
        const w = Number(fl && fl.w), h = Number(fl && fl.h);
        if (!(w > 0) || !(h > 0) || !Array.isArray(fl.g) || fl.g.length !== w * h) return null;
        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles[r] = [];
            for (let q = 0; q < w; q++) {
                const shape = rec.t[fl.g[r * w + q]];
                if (!Array.isArray(shape)) return null;
                const t = { q, r, ...DEFAULTS };
                let objects = false;
                for (let i = 0; i < shape.length; i++) {
                    if (shape[i] === -1) { objects = true; continue; }
                    const name = keys[shape[i]];
                    if (name === undefined || i + 1 >= shape.length) return null;
                    const v = shape[++i];
                    if (!objects) { t[name] = v; continue; }
                    if (objStr[v] === undefined) return null;
                    t[name] = _unplain(name, JSON.parse(objStr[v]), q, r);
                }
                tiles[r][q] = t;
            }
        }
        out[k] = { ...(JSON.parse(JSON.stringify(fl.m || {}))), tiles, width: w, height: h };
    }
    return out;
}

export const InteriorRecords = {
    VERSION,
    CELLAR_VERSION,
    encodeFloors,
    decodeFloors,

    /** The world's records, made if missing (or of another version: begun afresh). */
    ensure(world) {
        if (!world) return null;
        const R = world.interiors;
        if (!R || typeof R !== 'object' || R.v !== VERSION || !_obj(R.b)) world.interiors = { v: VERSION, b: {} };
        return world.interiors;
    },

    /** The kept record of one building (by its ground floor's interior key), or null. */
    get(world, key) {
        const R = world && world.interiors;
        return (R && R.v === VERSION && R.b && R.b[key]) || null;
    },

    /**
     * Keep a building's floors ({ [floor]: interior }) under `key`, seen on `day`. Lets the
     * longest unvisited go past `maxKept`. → the record.
     */
    put(world, key, floors, day = 0, maxKept = 400) {
        const R = InteriorRecords.ensure(world);
        if (!R) return null;
        const rec = { d: Math.floor(Number(day) || 0), cv: CELLAR_VERSION, ...encodeFloors(floors) };
        R.b[key] = rec;
        const keys = Object.keys(R.b);
        if (maxKept > 0 && keys.length > maxKept) {
            keys.sort((a, z) => (R.b[a].d - R.b[z].d) || (a < z ? -1 : 1));
            for (const k of keys.slice(0, keys.length - maxKept)) if (k !== key) delete R.b[k];
        }
        return rec;
    },

    /** Note a visit (the record kept from being let go first). */
    touch(world, key, day = 0) {
        const rec = InteriorRecords.get(world, key);
        if (rec) rec.d = Math.floor(Number(day) || 0);
        return rec;
    },

    /** A building's kept floors, decoded ({ [floor]: interior }), or null. */
    load(world, key) {
        const rec = InteriorRecords.get(world, key);
        return rec ? decodeFloors(rec) : null;
    },

    /** Was this record's cellar planned by an older plan (CELLAR_VERSION)? Then it is planned afresh. */
    staleCellar(rec) {
        return !!(rec && rec.f && rec.f[-1] !== undefined && (Number(rec.cv) || 1) < CELLAR_VERSION);
    },

    /** Forget one building (its inside planned afresh on the next visit). */
    forget(world, key) {
        const R = world && world.interiors;
        if (R && R.b) delete R.b[key];
    },

    /** For the save (systems/saveLoad.js): the records as they are, or null. */
    serialize(world) {
        const R = world && world.interiors;
        return R && R.v === VERSION && _obj(R.b) && Object.keys(R.b).length ? R : null;
    },

    /** From a save: its records where they are of this version, else none (older saves). */
    restore(saved, world) {
        if (!world) return;
        world.interiors = saved && typeof saved === 'object' && saved.v === VERSION && _obj(saved.b) ? saved : { v: VERSION, b: {} };
    },
};
