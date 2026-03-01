// ============================================
// MOD STORE — Standalone build for editors
// ============================================
// Non-module version used by editor HTML files (which rely on global scope).
// The canonical ES-module version lives in src/systems/modStore.js.

(function () {
    'use strict';

    const DB_NAME = 'lord_of_realms_mods';
    const DB_VERSION = 1;
    let _db = null;

    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('moddata')) db.createObjectStore('moddata');
                if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds');
                if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
            };
            req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
            req.onerror = (e) => { console.error('ModStore: failed to open IndexedDB', e.target.error); reject(e.target.error); };
        });
    }

    async function put(storeName, key, value) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function get(storeName, key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function del(storeName, key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

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

    window.ModStore = {
        async init() { await open(); },
        async saveModData(data) { await put('moddata', 'gamedata', data); await put('meta', 'moddata_timestamp', Date.now()); },
        async loadModData() { return await get('moddata', 'gamedata') || null; },
        async hasModData() { const ts = await get('meta', 'moddata_timestamp'); return !!ts; },
        async saveWorld(id, worldData) { worldData.savedAt = Date.now(); await put('worlds', id, worldData); },
        async loadWorld(id) { return await get('worlds', id) || null; },
        async listWorlds() {
            const all = await getAll('worlds');
            return all.map(e => ({ id: e.key, name: e.value.name || e.key, width: e.value.width, height: e.value.height, savedAt: e.value.savedAt }));
        },
        async deleteWorld(id) { await del('worlds', id); },
        async exportAll() {
            const moddata = await get('moddata', 'gamedata');
            const worlds = await getAll('worlds');
            return { version: 1, exportedAt: Date.now(), moddata: moddata || null, worlds: worlds.reduce((acc, e) => { acc[e.key] = e.value; return acc; }, {}) };
        },
        async importAll(blob) {
            if (blob.moddata) { await put('moddata', 'gamedata', blob.moddata); await put('meta', 'moddata_timestamp', Date.now()); }
            if (blob.worlds) { for (const [id, data] of Object.entries(blob.worlds)) await put('worlds', id, data); }
        },
    };
})();
