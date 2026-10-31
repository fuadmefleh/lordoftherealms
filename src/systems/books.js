// ============================================
// BOOKS — real books on real shelves, read over several sittings
// ============================================
// Reading at a bookshelf (ui/objectActions "Read") opens the book the player
// is in the middle of, or takes down an unread one the shelf could hold (a
// village shelf has primers; a capital's or a temple's has chronicles and
// lost hymnals). Each sitting advances the book by one (at most
// config.sittingsPerDay sittings a day count; a founder of the Wisdom tenet
// reads half again as fast). Finishing a book grants its reward once:
// skills (up to 10), stats (under the books' own lifetime caps), an extinct
// faith discovered, the land around the reader charted.
//
// State on player.reading (saved). The shelf's pick is a hash of the shelf
// and the books already read: no RNG. Content: data/books.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Devotion } from './devotion.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = v => Math.round(v * 100) / 100;
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Lifetime caps on the stats books can teach. */
const BOOK_STAT_CAPS = { intelligence: 1.5, faith: 0.5 };

export const Books = {
    data() {
        const gd = DataLoader._gamedata;
        return (gd && gd.books) || {};
    },

    config() {
        return Books.data().config || {};
    },

    list() {
        return Array.isArray(Books.data().books) ? Books.data().books : [];
    },

    book(id) {
        return Books.list().find(b => b.id === id) || null;
    },

    state(player) {
        if (!player) return { current: null, progress: {}, finished: [], today: { day: -1, n: 0 } };
        let st = player.reading;
        if (!_obj(st)) st = player.reading = { current: null, progress: {}, finished: [], today: { day: -1, n: 0 } };
        if (!_obj(st.progress)) st.progress = {};
        if (!Array.isArray(st.finished)) st.finished = [];
        if (!_obj(st.today)) st.today = { day: -1, n: 0 };
        return st;
    },

    serialize(player) {
        return player && player.reading ? JSON.parse(JSON.stringify(player.reading)) : null;
    },

    loadState(player) {
        if (player && player.reading) Books.state(player);
    },

    /** The highest book tier a shelf in this place holds. */
    shelfTier(ctx = {}) {
        const C = Books.config();
        if (ctx.temple) return _num(C.templeTier, 3);
        const type = ctx.settlementType;
        return _num((C.tierBySettlement || {})[type], 1);
    },

    /** Unread books a shelf of this tier could hold. */
    available(player, tier) {
        const st = Books.state(player);
        return Books.list().filter(b => _num(b.tier, 1) <= tier && !st.finished.includes(b.id));
    },

    /** The book the next sitting would be spent on (the open one, or the shelf's pick). */
    nextBook(player, ctx = {}) {
        const st = Books.state(player);
        if (st.current && !st.finished.includes(st.current) && Books.book(st.current)) return Books.book(st.current);
        const avail = Books.available(player, Books.shelfTier(ctx));
        if (!avail.length) return null;
        return avail[_hash(`${ctx.shelfKey || ''}:${st.finished.length}`) % avail.length];
    },

    /**
     * One sitting at a bookshelf. ctx { shelfKey, settlementType, temple }.
     * Returns { text, book, progress, sittings, finished, rewards[], counted }.
     */
    read(player, world, ctx = {}) {
        const st = Books.state(player);
        const C = Books.config();
        const book = Books.nextBook(player, ctx);
        if (!book) return { text: 'You have read every book this shelf holds. You leaf through an old favourite instead.', book: null, counted: false, rewards: [] };
        const day = _day(world);
        if (st.today.day !== day) st.today = { day, n: 0 };
        st.current = book.id;
        const sittings = Math.max(1, _num(book.sittings, 3));
        if (st.today.n >= _num(C.sittingsPerDay, 2)) {
            return { text: `You try to go on with ${book.title}, but the words swim. Enough for today.`, book, progress: _num(st.progress[book.id]), sittings, counted: false, rewards: [] };
        }
        st.today.n += 1;
        const pace = 1 + Devotion.tenet(player, 'reading');
        st.progress[book.id] = _r2(Math.min(sittings, _num(st.progress[book.id]) + pace));
        const progress = st.progress[book.id];
        if (progress < sittings) {
            return { text: `You read on in ${book.title} by ${book.author} — ${book.topic}. (${Math.floor(progress)}/${sittings})`, book, progress, sittings, counted: true, finished: false, rewards: [] };
        }
        // Finished: the reward, once
        st.finished.push(book.id);
        st.current = null;
        delete st.progress[book.id];
        const rewards = Books._reward(player, world, book);
        return { text: `${book.finish || `You finish ${book.title}.`}${rewards.length ? ` (${rewards.join(', ')})` : ''}`, book, progress: sittings, sittings, counted: true, finished: true, rewards };
    },

    _reward(player, world, book) {
        const R = book.reward || {};
        const out = [];
        for (const [k, v] of Object.entries(R.skills || {})) {
            if (!player.skills) continue;
            const before = _num(player.skills[k]);
            player.skills[k] = _r2(Math.min(10, before + v));
            if (player.skills[k] > before) out.push(`${k.charAt(0).toUpperCase() + k.slice(1)} +${_r2(player.skills[k] - before)}`);
        }
        for (const [k, v] of Object.entries(R.stats || {})) {
            const got = Devotion.raiseStat(player, k, v, 'books', BOOK_STAT_CAPS);
            if (got) out.push(`${k.charAt(0).toUpperCase() + k.slice(1)} +${got}`);
        }
        if (R.karma) { player.karma = _num(player.karma) + R.karma; out.push(`+${R.karma} karma`); }
        if (R.faith && typeof player.discoverExtinctFaith === 'function') {
            if (player.discoverExtinctFaith(R.faith, 'book')) out.push('a lost faith discovered');
        }
        if (R.reveal && world && typeof world.getTile === 'function' && Number.isFinite(player.q)) {
            let n = 0;
            for (const h of Hex.hexesInRange(player.q, player.r, R.reveal)) {
                const t = world.getTile(h.q, h.r);
                if (t && !t.explored) { t.explored = true; n++; }
            }
            if (n) out.push(`${n} tiles charted`);
        }
        return out;
    },
};
