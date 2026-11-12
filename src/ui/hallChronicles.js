// ============================================
// HALL CHRONICLES — each ended House's chronicle book, kept for the Hall
// ============================================
// When a line ends (the epitaph, ui/actionMenu/heirs.js; or a new life
// taken, ui/actionMenu/afterlife.js), the House's
// chronicle book (ui/chronicleBook.js, an offline HTML file) is built once and
// kept in its own indexedDB store, keyed by the Hall of Houses entry
// (systems/metaLegacy.js). The Hall of Houses screen (components/
// HallOfHouses.jsx) opens it again long after the game is gone. Every step is
// optional and wrapped: no indexedDB, no chronicle module, a failed build —
// the Hall simply shows no chronicle link.

import { MetaLegacy } from '../systems/metaLegacy.js';

const DB_NAME = 'lord_of_realms_hall';
const STORE = 'chronicles';

function _open() {
    return new Promise((resolve, reject) => {
        try {
            if (typeof indexedDB === 'undefined' || !indexedDB || typeof indexedDB.open !== 'function') { reject(new Error('no indexedDB')); return; }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
        } catch (err) {
            reject(err);
        }
    });
}

async function _tx(mode, fn) {
    const db = await _open();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => { resolve(req ? req.result : undefined); db.close(); };
            tx.onerror = () => { reject(tx.error); db.close(); };
        } catch (err) {
            reject(err);
            db.close();
        }
    });
}

export const HallChronicles = {
    async save(entryId, record) {
        try { await _tx('readwrite', s => s.put(record, entryId)); return true; } catch (err) { return false; }
    },

    async load(entryId) {
        try { return (await _tx('readonly', s => s.get(entryId))) || null; } catch (err) { return null; }
    },

    async remove(entryId) {
        try { await _tx('readwrite', s => s.delete(entryId)); return true; } catch (err) { return false; }
    },

    /**
     * Build the ended House's chronicle book and keep it with its Hall entry.
     * opts.player: the ended House's player, when it is no longer
     * game.player (a new life: player/afterlife.js becomeStranger hands the
     * game to someone else while the book is still being built). The player
     * and world are taken now, before anything is awaited.
     * Fire and forget; resolves true when kept.
     */
    async archive(game, opts = {}) {
        try {
            const player = (opts && opts.player) || (game && game.player) || null;
            const world = (game && game.world) || null;
            const run = world && world.run;
            const house = player && player.house;
            if (!run || !house) return false;
            const entry = MetaLegacy.lastEntryFor(run.id, house.name);
            if (!entry) return false;
            const mod = await import('./chronicleBook.js');
            const exp = mod && mod.ChronicleBookExport;
            if (!exp || typeof exp.build !== 'function') return false;
            const { html, filename } = await exp.build({ player, world }, { portraits: false });
            if (!html) return false;
            const kept = await HallChronicles.save(entry.id, { html, filename: filename || 'chronicle.html' });
            if (kept) MetaLegacy.attachChronicle(entry.id, { store: 'indexedDB', filename: filename || 'chronicle.html' });
            return kept;
        } catch (err) {
            console.warn('[Hall] the chronicle could not be kept', err);
            return false;
        }
    },

    /** Open a kept chronicle: a download of the book (it opens offline). */
    async open(entryId) {
        const rec = await HallChronicles.load(entryId);
        if (!rec || !rec.html) return false;
        try {
            const mod = await import('./chronicleBook.js');
            if (mod && mod.ChronicleBookExport && typeof mod.ChronicleBookExport.download === 'function') {
                mod.ChronicleBookExport.download(rec.html, rec.filename || 'chronicle.html');
                return true;
            }
        } catch (err) { /* fall through to a plain blob */ }
        try {
            const url = URL.createObjectURL(new Blob([rec.html], { type: 'text/html;charset=utf-8' }));
            window.open(url, '_blank');
            return true;
        } catch (err) {
            return false;
        }
    },
};
