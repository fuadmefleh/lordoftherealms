// ============================================
// MOD STORE — IndexedDB persistence for mod/editor data
// ============================================
// Used by both the editors (to save work) and the game (to load mods).
// Stores: gamedata overrides, custom worlds, terrain sets, etc.
//
// DB schema:
//   moddata   — key/value store for editor gamedata sections
//   worlds    — custom hex worlds created in the world editor
//   meta      — metadata (last-modified timestamps, names, etc.)

const ModStore = (() => {
    const DB_NAME = 'lord_of_realms_mods';
    const DB_VERSION = 1;
    let _db = null;

    /** Open (or create) the IndexedDB database */
    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('moddata')) {
                    db.createObjectStore('moddata');
                }
                if (!db.objectStoreNames.contains('worlds')) {
                    db.createObjectStore('worlds');
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta');
                }
            };
            req.onsuccess = (e) => {
                _db = e.target.result;
                resolve(_db);
            };
            req.onerror = (e) => {
                console.error('ModStore: failed to open IndexedDB', e.target.error);
                reject(e.target.error);
            };
        });
    }

    /** Generic put into a store */
    async function put(storeName, key, value) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /** Generic get from a store */
    async function get(storeName, key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Generic delete from a store */
    async function del(storeName, key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /** Get all keys from a store */
    async function keys(storeName) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Get all entries from a store as {key, value} array */
    async function getAll(storeName) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const reqKeys = store.getAllKeys();
            const reqVals = store.getAll();
            tx.oncomplete = () => {
                const result = [];
                for (let i = 0; i < reqKeys.result.length; i++) {
                    result.push({ key: reqKeys.result[i], value: reqVals.result[i] });
                }
                resolve(result);
            };
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    // ── High-level API ──

    return {
        /** Initialize the store (call on boot) */
        async init() {
            await open();
        },

        // ── Mod Data (gamedata overrides from editors) ──

        /** Save the full editor gamedata blob */
        async saveModData(data) {
            await put('moddata', 'gamedata', data);
            await put('meta', 'moddata_timestamp', Date.now());
        },

        /** Load the editor gamedata blob (or null) */
        async loadModData() {
            return await get('moddata', 'gamedata') || null;
        },

        /** Check if there's saved mod data */
        async hasModData() {
            const ts = await get('meta', 'moddata_timestamp');
            return !!ts;
        },

        // ── Custom Worlds ──

        /** Save a custom world */
        async saveWorld(id, worldData) {
            worldData.savedAt = Date.now();
            await put('worlds', id, worldData);
        },

        /** Load a custom world by id */
        async loadWorld(id) {
            return await get('worlds', id) || null;
        },

        /** List all saved world ids and names */
        async listWorlds() {
            const all = await getAll('worlds');
            return all.map(e => ({
                id: e.key,
                name: e.value.name || e.key,
                width: e.value.width,
                height: e.value.height,
                savedAt: e.value.savedAt,
            }));
        },

        /** Delete a custom world */
        async deleteWorld(id) {
            await del('worlds', id);
        },

        // ── Utility ──

        /** Export all mod data + worlds as a single JSON blob (for sharing) */
        async exportAll() {
            const moddata = await get('moddata', 'gamedata');
            const worlds = await getAll('worlds');
            return {
                version: 1,
                exportedAt: Date.now(),
                moddata: moddata || null,
                worlds: worlds.reduce((acc, e) => { acc[e.key] = e.value; return acc; }, {}),
            };
        },

        /** Import a previously exported blob */
        async importAll(blob) {
            if (blob.moddata) {
                await put('moddata', 'gamedata', blob.moddata);
                await put('meta', 'moddata_timestamp', Date.now());
            }
            if (blob.worlds) {
                for (const [id, data] of Object.entries(blob.worlds)) {
                    await put('worlds', id, data);
                }
            }
        },
    };
})();
