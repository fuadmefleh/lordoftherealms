// ============================================
// SAVE STORE — where saves are kept: IndexedDB, gzipped
// ============================================
// A long game's save is 8–11 MB of JSON by year 50–85, past what a browser
// lets one origin keep in localStorage (~5–10 MB). So saves live in IndexedDB
// (database 'lord_of_realms_saves'): store 'saves' holds each slot's record
// { encoding: 'gzip' | 'json', data: ArrayBuffer | string, savedAt }, and
// store 'meta' a small index of the same slots (what the save list shows:
// player, day, year, sizes…) so listing never reads or unpacks a world.
// Compression is the browser's own CompressionStream('gzip'); where there is
// none the JSON is kept as it is.
//
// The backend is injectable (useBackend): IndexedDB in the browser and in
// Electron (app:// is a standard, secure origin), localStorage where there is
// no IndexedDB (uncompressed, as saves were before), an in-memory one in the
// tests (memoryBackend; setup.js installs a fresh one per test).
//
// Writes to one slot run one at a time; a write asked for while another is
// under way waits, and a newer one replaces it (the latest state wins). A
// remove drops what was waiting and lands after the write under way, so a
// deleted slot never comes back. writeNow starts its write synchronously
// (no compression) for 'beforeunload', where nothing awaited would happen.
//
// Pure: no game deps. Used by systems/saveLoad.js.

const DB_NAME = 'lord_of_realms_saves';
const DB_VERSION = 1;
const SAVES = 'saves';
const META = 'meta';

// ── Compression ───────────────────────────────────────────────

function _canGzip() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
        && typeof Blob === 'function' && typeof Response === 'function';
}

async function gzip(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

async function gunzip(buf) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

/** Does this byte buffer start like a gzip stream (1f 8b)? */
function isGzip(buf) {
    if (!buf) return false;
    const u8 = buf instanceof Uint8Array ? buf : (buf instanceof ArrayBuffer ? new Uint8Array(buf) : null);
    return !!u8 && u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

function _byteLength(data) {
    if (data == null) return 0;
    if (typeof data === 'string') return data.length;
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (typeof data.size === 'number') return data.size;
    return 0;
}

/** The JSON as a record to store: gzipped where the browser can, else as it is. */
async function encode(json) {
    if (_canGzip()) {
        try {
            const data = await gzip(json);
            return { encoding: 'gzip', data, bytes: data.byteLength, rawBytes: json.length };
        } catch (err) { /* kept as it is */ }
    }
    return { encoding: 'json', data: json, bytes: json.length, rawBytes: json.length };
}

/** A stored record back as its JSON string. */
async function decode(record) {
    if (!record) return null;
    const { encoding, data } = record;
    if (encoding === 'gzip') {
        const buf = (typeof Blob === 'function' && data instanceof Blob) ? await data.arrayBuffer() : data;
        return gunzip(buf);
    }
    if (typeof data === 'string') return data;
    // (bytes that were never compressed)
    if (data && typeof TextDecoder === 'function') return new TextDecoder().decode(data);
    return null;
}

// ── Quota ─────────────────────────────────────────────────────

/** Did the browser refuse the write for want of room? */
function isQuotaError(err) {
    if (!err) return false;
    if (err.quota) return true;
    const name = err.name || '';
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    if (err.code === 22 || err.code === 1014) return true;
    return /quota/i.test(String(err.message || ''));
}

const QUOTA_MESSAGE = 'There is no room left to save: the browser\'s storage for this game is full. '
    + 'Free some disk space or clear other site data for this game, then save again.';

function quotaError(cause) {
    const e = new Error(QUOTA_MESSAGE);
    e.name = 'QuotaExceededError';
    e.quota = true;
    e.cause = cause;
    return e;
}

// ── Backends ──────────────────────────────────────────────────
// Each: get(key) → record | null; put(key, record, meta) → Promise;
// remove(key) → Promise; list() → [meta]; optional putSync(key, record, meta)
// that starts the write before returning (a Promise for its end).

/** In memory (the tests). quotaBytes: refuse a write once the stored bytes would pass it. */
function memoryBackend({ quotaBytes = Infinity } = {}) {
    const saves = new Map();
    const metas = new Map();
    const used = () => { let n = 0; for (const r of saves.values()) n += _byteLength(r.data); return n; };
    const put = (key, record, meta) => {
        const before = saves.has(key) ? _byteLength(saves.get(key).data) : 0;
        if (used() - before + _byteLength(record.data) > quotaBytes) {
            const e = new Error('The quota has been exceeded.');
            e.name = 'QuotaExceededError';
            return Promise.reject(e);
        }
        saves.set(key, record);
        metas.set(key, { ...meta, key });
        return Promise.resolve();
    };
    return {
        name: 'memory',
        saves, metas,
        async get(key) { return saves.get(key) || null; },
        put,
        putSync: put,
        async remove(key) { saves.delete(key); metas.delete(key); },
        async list() { return [...metas.values()]; },
    };
}

/** localStorage (no IndexedDB): the JSON as it is, as saves were kept before. */
function localStorageBackend(ls = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const metaKey = (key) => key + '::meta';
    const put = (key, record, meta) => {
        try {
            if (record.encoding !== 'json' || typeof record.data !== 'string') throw new Error('localStorage keeps uncompressed saves only');
            ls.setItem(key, record.data);
            try { ls.setItem(metaKey(key), JSON.stringify({ ...meta, key })); } catch (err) { /* the save stands */ }
            return Promise.resolve();
        } catch (err) {
            return Promise.reject(err);
        }
    };
    return {
        name: 'localStorage',
        compress: false,
        async get(key) {
            const data = ls.getItem(key);
            return data == null ? null : { encoding: 'json', data };
        },
        put,
        putSync: put,
        async remove(key) { ls.removeItem(key); ls.removeItem(metaKey(key)); },
        async list() {
            const out = [];
            for (let i = 0; i < ls.length; i++) {
                const k = ls.key(i);
                if (!k || !k.endsWith('::meta')) continue;
                try { out.push(JSON.parse(ls.getItem(k))); } catch (err) { /* skip */ }
            }
            return out;
        },
    };
}

/** IndexedDB: the saves and their index, written together in one transaction. */
function idbBackend(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null)) {
    let db = null;
    let opening = null;
    const open = () => {
        if (db) return Promise.resolve(db);
        if (opening) return opening;
        opening = new Promise((resolve, reject) => {
            let req;
            try { req = idb.open(DB_NAME, DB_VERSION); } catch (err) { reject(err); return; }
            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains(SAVES)) d.createObjectStore(SAVES);
                if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
            };
            req.onsuccess = () => {
                db = req.result;
                // (another tab upgrading: let go, open again next time)
                db.onversionchange = () => { try { db.close(); } catch (err) { /* gone */ } db = null; opening = null; };
                resolve(db);
            };
            req.onerror = () => { opening = null; reject(req.error || new Error('IndexedDB could not be opened')); };
            req.onblocked = () => { /* waits for the other tab */ };
        });
        return opening;
    };
    const txDone = (tx, value) => new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(typeof value === 'function' ? value() : value);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write was aborted'));
    });
    const putOn = (d, key, record, meta) => {
        const tx = d.transaction([SAVES, META], 'readwrite');
        tx.objectStore(SAVES).put(record, key);
        tx.objectStore(META).put({ ...meta, key }, key);
        return txDone(tx);
    };
    return {
        name: 'indexedDB',
        open,
        async get(key) {
            const d = await open();
            const tx = d.transaction(SAVES, 'readonly');
            const req = tx.objectStore(SAVES).get(key);
            return txDone(tx, () => req.result || null);
        },
        async put(key, record, meta) { return putOn(await open(), key, record, meta); },
        putSync(key, record, meta) {
            // (only with the database already open: nothing may be awaited first)
            if (!db) return open().then(d => putOn(d, key, record, meta));
            try { return putOn(db, key, record, meta); } catch (err) { return Promise.reject(err); }
        },
        async remove(key) {
            const d = await open();
            const tx = d.transaction([SAVES, META], 'readwrite');
            tx.objectStore(SAVES).delete(key);
            tx.objectStore(META).delete(key);
            return txDone(tx);
        },
        async list() {
            const d = await open();
            const tx = d.transaction(META, 'readonly');
            const req = tx.objectStore(META).getAll();
            return txDone(tx, () => req.result || []);
        },
    };
}

function _defaultBackend() {
    if (typeof indexedDB !== 'undefined' && indexedDB && typeof indexedDB.open === 'function') return idbBackend();
    if (typeof localStorage !== 'undefined' && localStorage) return localStorageBackend();
    return memoryBackend();
}

// ── The store ─────────────────────────────────────────────────

let _backend = null;
let _slots = new Map();

function _slot(key) {
    let s = _slots.get(key);
    if (!s) { s = { next: null, running: null, gen: 0 }; _slots.set(key, s); }
    return s;
}

function backend() {
    if (!_backend) _backend = _defaultBackend();
    return _backend;
}

async function _writeOne(key, slot, job) {
    const { json, meta, gen } = job;
    if (job.gate) { try { await job.gate; } catch (err) { /* write anyway */ } }
    if (slot.gen !== gen) return { success: false, superseded: true };
    return _put(key, json, meta, () => slot.gen !== gen);
}

/** Encode and store, outside the slot's queue; `overtaken()` checked before the put. */
async function _put(key, json, meta, overtaken = null) {
    const b = backend();
    const rec = b.compress === false
        ? { encoding: 'json', data: json, bytes: json.length, rawBytes: json.length }
        : await encode(json);
    // (overtaken while compressing: by a remove or a writeNow)
    if (overtaken && overtaken()) return { success: false, superseded: true };
    const savedAt = Date.now();
    const record = { encoding: rec.encoding, data: rec.data, savedAt };
    const fullMeta = { ...meta, encoding: rec.encoding, bytes: rec.bytes, rawBytes: rec.rawBytes, savedAt };
    try {
        await b.put(key, record, fullMeta);
    } catch (err) {
        if (isQuotaError(err)) throw quotaError(err);
        throw err;
    }
    return { success: true, encoding: rec.encoding, bytes: rec.bytes, rawBytes: rec.rawBytes };
}

function _pump(key, slot) {
    slot.running = (async () => {
        while (slot.next) {
            const job = slot.next;
            slot.next = null;
            try {
                const r = await _writeOne(key, slot, job);
                for (const w of job.waiters) w.resolve(r);
            } catch (err) {
                for (const w of job.waiters) w.reject(err);
            }
        }
        slot.running = null;
    })();
    return slot.running;
}

export const SaveStore = {
    DB_NAME, SAVES, META, QUOTA_MESSAGE,
    encode, decode, gzip, gunzip, isGzip, isQuotaError,
    memoryBackend, localStorageBackend, idbBackend,

    /** The backend in use (chosen on first use: IndexedDB, else localStorage, else memory). */
    backend,

    /** Use this backend from now on (the tests: a fresh memoryBackend). */
    useBackend(b) {
        _backend = b || null;
        _slots = new Map();
    },

    /** Open the backend ahead of need (so a later writeNow can start at once). */
    async ready() {
        const b = backend();
        if (typeof b.open === 'function') await b.open();
        return b;
    },

    /**
     * Keep `json` in slot `key` with its index entry `meta` (compressed where it can be).
     * Resolves { success, encoding, bytes, rawBytes } ({ success: false, superseded } when
     * a remove or writeNow came after it); rejects on failure (err.quota when there was
     * no room). The write takes its place in the slot's queue at once; `gate` (a promise)
     * is waited for before it starts (saveLoad.js: the old saves moved first).
     */
    write(key, json, meta = {}, gate = null) {
        const slot = _slot(key);
        return new Promise((resolve, reject) => {
            if (slot.next) {
                slot.next.json = json;
                slot.next.meta = meta;
                if (gate) slot.next.gate = gate;
                slot.next.waiters.push({ resolve, reject });
            } else {
                slot.next = { json, meta, gate, gen: slot.gen, waiters: [{ resolve, reject }] };
            }
            if (!slot.running) _pump(key, slot);
        });
    },

    /**
     * Start writing `json` now, uncompressed, before returning — for 'beforeunload'.
     * Whatever was waiting or compressing for this slot is overtaken.
     */
    writeNow(key, json, meta = {}) {
        const slot = _slot(key);
        slot.gen++;
        const dropped = slot.next;
        slot.next = null;
        if (dropped) for (const w of dropped.waiters) w.resolve({ success: false, superseded: true });
        const savedAt = Date.now();
        const record = { encoding: 'json', data: json, savedAt };
        const b = backend();
        const fullMeta = { ...meta, encoding: 'json', bytes: json.length, rawBytes: json.length, savedAt };
        const p = typeof b.putSync === 'function' ? b.putSync(key, record, fullMeta) : b.put(key, record, fullMeta);
        return Promise.resolve(p).then(
            () => ({ success: true, encoding: 'json', bytes: json.length, rawBytes: json.length }),
            (err) => { throw isQuotaError(err) ? quotaError(err) : err; },
        );
    },

    /**
     * Write straight to the backend, not through the slot's queue (moving the old
     * saves in, which the queued writes wait for). Same result as write.
     */
    putDirect(key, json, meta = {}) {
        return _put(key, json, meta);
    },

    /** The JSON kept in slot `key` now, not waiting for queued writes. */
    async peek(key) {
        const rec = await backend().get(key);
        return rec ? decode(rec) : null;
    },

    /** The JSON kept in slot `key`, or null (waits for a write under way). */
    async read(key) {
        const slot = _slots.get(key);
        if (slot && slot.running) { try { await slot.running; } catch (err) { /* read what is there */ } }
        const rec = await backend().get(key);
        return rec ? decode(rec) : null;
    },

    /** Is there a save in slot `key`? */
    async has(key) {
        const list = await SaveStore.list();
        return list.some(m => m.key === key);
    },

    /** The index entries of every kept save. */
    async list() {
        return (await backend().list()) || [];
    },

    /** Delete slot `key`: what was waiting is dropped, a write under way lands first. */
    async remove(key) {
        const slot = _slot(key);
        slot.gen++;
        const dropped = slot.next;
        slot.next = null;
        if (dropped) for (const w of dropped.waiters) w.resolve({ success: false, superseded: true });
        if (slot.running) { try { await slot.running; } catch (err) { /* deleting anyway */ } }
        await backend().remove(key);
    },
};
