// ============================================
// SAVE CODEC — a smaller JSON for the save, the same data back
// ============================================
// pack(v) → a JSON-ready copy of v in which every array of (at least
// PACK_MIN) plain objects that share a few key sets is written as a table:
//
//   [{ id: 1, first: 'Ada', log: [] }, { id: 2, first: 'Una', log: [] }, …]
//   → { '\u0000t': [['id', 'first', 'log']], r: [[0, 1, 'Ada', []], [0, 2, 'Una', []], …] }
//
// (each row: its key set's index, then the values in that key order). The
// keys are written once per table instead of once per object — a town's
// people, their lives' lines, its graves and its cases. unpack(v) gives back
// what JSON.parse(JSON.stringify(original)) would: the same keys in the same
// order, the same values. Data without tables passes through unchanged (an
// older save). Pure: no game deps. Used by systems/saveLoad.js for the
// settlements on the tiles.

const TABLE = '\u0000t';
const PACK_MIN = 4;

function _skip(v) {
    return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

function _plain(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o);
}

function _set(o, k, v) {
    // (a key JSON.parse would make an own property of, never the prototype)
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    else o[k] = v;
}

function _packObj(o) {
    const out = {};
    for (const k of Object.keys(o)) {
        const v = o[k];
        if (_skip(v)) continue;
        _set(out, k, pack(v));
    }
    return out;
}

/** A JSON-ready copy of `v` with its arrays of like objects written as tables. */
export function pack(v) {
    if (v === null || typeof v !== 'object') return v;
    if (typeof v.toJSON === 'function') return pack(v.toJSON());
    if (!Array.isArray(v)) return _packObj(v);
    const out = new Array(v.length);
    let objs = v.length >= PACK_MIN;
    for (let i = 0; i < v.length; i++) {
        const x = v[i];
        out[i] = _skip(x) ? null : pack(x);
        if (objs && !_plain(out[i])) objs = false;
    }
    if (!objs) return out;
    const schemas = new Map();
    const keys = [];
    const rows = new Array(out.length);
    for (let i = 0; i < out.length; i++) {
        const o = out[i];
        const ks = Object.keys(o);
        const sig = ks.join('\u0001');
        let si = schemas.get(sig);
        if (si === undefined) {
            si = keys.length;
            schemas.set(sig, si);
            keys.push(ks);
            // (too many shapes to be worth a table)
            if (keys.length > out.length / 2) return out;
        }
        const row = new Array(ks.length + 1);
        row[0] = si;
        for (let j = 0; j < ks.length; j++) row[j + 1] = o[ks[j]];
        rows[i] = row;
    }
    return { [TABLE]: keys, r: rows };
}

/** What pack wrote, back as plain data (in place where it can be). */
export function unpack(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) v[i] = unpack(v[i]);
        return v;
    }
    const keys = v[TABLE];
    if (Array.isArray(keys) && Array.isArray(v.r)) {
        const out = new Array(v.r.length);
        for (let i = 0; i < v.r.length; i++) {
            const row = v.r[i];
            const ks = keys[row[0]];
            const o = {};
            for (let j = 0; j < ks.length; j++) _set(o, ks[j], unpack(row[j + 1]));
            out[i] = o;
        }
        return out;
    }
    for (const k of Object.keys(v)) _set(v, k, unpack(v[k]));
    return v;
}

export const SaveCodec = { pack, unpack, TABLE, PACK_MIN };
