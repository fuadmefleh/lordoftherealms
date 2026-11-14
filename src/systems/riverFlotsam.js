// ============================================
// RIVER FLOTSAM — what the rivers carry down on their own
// ============================================
// Sticks and broken branches, logs, bleached driftwood, rafts of torn-up
// reeds; and below the towns the things people lose: a loose plank, an old
// boot, a jug, a basket of apples, a child's toy boat, a barrel, now and then
// a purse with coin in it or a bottle with a note. They go into the world's
// rivers day by day (more in the lower reaches, where more water has gathered;
// more in the spring floods and under rain and storm; the human junk mostly
// near towns) and are then carried down like anything thrown in
// (systems/riverDrift.js): caught on weirs and in the player's nets
// (systems/riverNets.js), lost at sea, left lying in lakes. While the player
// watches a river hex's street map, something comes down into it now and then
// from upstream, so the river visibly carries things by.
//
// No randomness from Math.random or the game's RNG streams: every roll is a
// hash of the world's seed, the day (or hour) and what is being decided, so a
// world spawns the same flotsam whatever else happens. Cheap per day: the
// river hexes are listed once (and again every rebuildDays), and only
// flotsam.perDay finds go in a day. World totals stay under maxWild.
// Settings: data/riverDrift.json "flotsam".

import { RiverDrift } from './riverDrift.js';
import { CoinCensus } from './coinCensus.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { MoneySupply } from '../world/moneySupply.js';

const DEFAULTS = {
    enabled: true,
    perDay: 5,
    maxWild: 60,
    downstreamPow: 0.5,
    rebuildDays: 30,
    seasonMult: { spring: 2, summer: 0.8, autumn: 1.3, winter: 0.5 },
    rainMult: 1.5,
    stormMult: 2.5,
    townMult: 3,
    watchPerHour: 0.35,
    finds: [],
    notes: [],
};

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A deterministic 0..1 from any parts (FNV-1a) */
export function flotsamHash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** River hexes of a world, kept between days (not saved: rebuilt on load) */
const _riverCache = new WeakMap();

export const RiverFlotsam = {
    _cfgSrc: null,
    _cfg: null,

    config() {
        const src = RiverDrift.config().flotsam;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const c = { ...DEFAULTS, ...(src || {}) };
            c.seasonMult = { ...DEFAULTS.seasonMult, ...((src && src.seasonMult) || {}) };
            c.finds = (Array.isArray(c.finds) ? c.finds : []).filter(f => f && f.id && f.item && _num(f.w, 0) > 0);
            this._cfg = c;
        }
        return this._cfg;
    },

    _seed(world) {
        const gp = world && world.generationParams;
        return (gp && gp.seed != null ? gp.seed : (world && world.seed)) || 0;
    },

    _season(world) {
        return String((world && world.season) || 'summer').toLowerCase();
    },

    /**
     * The world's river hexes, each weighted by how much river has gathered
     * above it (1 + upstream hexes ^ downstreamPow) and marked when a town
     * stands on it or beside it: { list: [{ q, r, w, town }], cum, total }.
     */
    rivers(world, day = 0) {
        if (!world || typeof world.getTile !== 'function') return { list: [], cum: [], total: 0 };
        const cfg = this.config();
        const c = _riverCache.get(world);
        if (c && Math.abs(day - c.day) < Math.max(1, cfg.rebuildDays)) return c;
        const W = Number(world.width) || 0, H = Number(world.height) || 0;
        const list = [];
        const byKey = new Map();
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = world.getTile(q, r);
                if (!RiverDrift.isRiverHex(t)) continue;
                const e = { q, r, up: 0, w: 1, town: false };
                byKey.set(`${q},${r}`, e);
                list.push(e);
            }
        }
        // How many river hexes drain through each (followed down, a few hundred at most)
        for (const e of list) {
            let q = e.q, r = e.r;
            for (let i = 0; i < 300; i++) {
                const d = RiverDrift.downstream(world, q, r);
                if (d.kind !== 'river') break;
                const n = byKey.get(`${d.q},${d.r}`);
                if (!n) break;
                n.up++;
                q = n.q; r = n.r;
            }
        }
        const pow = _num(cfg.downstreamPow, 0.5);
        const cum = [];
        let total = 0;
        for (const e of list) {
            e.w = 1 + Math.pow(e.up, pow);
            const here = world.getTile(e.q, e.r);
            e.town = !!(here && here.settlement) || Hex.neighbors(e.q, e.r).some(n => {
                const t = RiverDrift._tile(world, n.q, n.r);
                return !!(t && t.settlement);
            });
            total += e.w;
            cum.push(total);
        }
        const out = { day, list, cum, total };
        _riverCache.set(world, out);
        return out;
    },

    /** Forget a world's river list (rivers painted, a test) */
    forget(world) {
        if (world) _riverCache.delete(world);
    },

    /** A river hex drawn by weight with u in 0..1 */
    _pickHex(rv, u) {
        if (!rv.list.length) return null;
        const x = u * rv.total;
        let lo = 0, hi = rv.cum.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (rv.cum[mid] < x) lo = mid + 1; else hi = mid;
        }
        return rv.list[lo];
    },

    /** How wet it is at a hex today: the season, x rain or storm there */
    wetness(world, q, r, day) {
        const cfg = this.config();
        let m = _num(cfg.seasonMult[this._season(world)], 1);
        const wx = world && world.weather;
        if (wx && typeof wx.getWeather === 'function') {
            try {
                const w = wx.getWeather(q, r, day);
                if (w && w.type === 'storm') m *= cfg.stormMult;
                else if (w && w.type === 'rain') m *= cfg.rainMult;
            } catch { /* no weather here */ }
        }
        return m;
    },

    /**
     * A find drawn from the table: natural finds count for more when it's wet,
     * the things people lose for more near a town. → the find's def, or null
     */
    pick(u, ctx = {}) {
        const cfg = this.config();
        const wet = _num(ctx.wet, 1), town = ctx.town ? cfg.townMult : 1;
        const ws = cfg.finds.map(f => f.w * (f.kind === 'human' ? town : wet));
        const total = ws.reduce((a, b) => a + b, 0);
        if (!(total > 0)) return null;
        let x = u * total;
        for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x < 0) return cfg.finds[i]; }
        return cfg.finds[cfg.finds.length - 1];
    },

    /** A find made real: { itemId, name, icon, qty, wild, findId, sprite?, coins?, note? } */
    make(def, key) {
        const cfg = this.config();
        const span = (a, u) => {
            const lo = Math.floor(_num(a && a[0], 1)), hi = Math.floor(_num(a && a[1], lo));
            return lo + Math.floor(u * (Math.max(lo, hi) - lo + 1));
        };
        const what = {
            itemId: def.item, name: def.name || def.item, icon: def.icon || '📦',
            qty: Math.max(1, span(def.qty, flotsamHash(key, 'qty'))), wild: true, findId: def.id,
        };
        if (def.sprite) what.sprite = def.sprite;
        if (def.coins) what.coins = Math.max(1, span(def.coins, flotsamHash(key, 'coins')));
        if (def.note && cfg.notes.length) what.note = Math.floor(flotsamHash(key, 'note') * cfg.notes.length);
        return what;
    },

    /** Count of the river's own finds afloat; past maxWild the oldest go (at rest first) */
    _capWild(world, room = 0) {
        const st = RiverDrift.state(world, false);
        if (!st) return;
        const max = Math.max(0, this.config().maxWild | 0) - room;
        const wild = st.items.filter(it => it.wild);
        if (wild.length <= max) return;
        wild.sort((a, b) => ((a.state === 'rest' ? 0 : 1) - (b.state === 'rest' ? 0 : 1)) || a.since - b.since);
        const drop = new Set(wild.slice(0, wild.length - max).map(it => it.id));
        st.items = st.items.filter(it => !drop.has(it.id));
    },

    /**
     * The day's finds go into the rivers (each back-dated to an hour of the
     * day just gone, a way down its hex, so the day's carrying takes them on).
     * opts.avoid { q, r }: not into the hex the player stands on (things come
     * into that one from upstream, where they can be seen to). → the items
     */
    spawnDay(world, day, opts = {}) {
        const cfg = this.config();
        if (!cfg.enabled || !RiverDrift.config().enabled || !world || !Number.isFinite(day)) return [];
        const st = RiverDrift.state(world);
        if (st.flotsamDay === day) return [];
        st.flotsamDay = day;
        const rv = this.rivers(world, day);
        if (!rv.list.length || !cfg.finds.length) return [];
        const seed = this._seed(world);
        const base = Math.max(0, _num(cfg.perDay, 0)) * _num(cfg.seasonMult[this._season(world)], 1);
        const n = Math.floor(base + flotsamHash(seed, 'fl-n', day));
        if (n <= 0) return [];
        this._capWild(world, n);
        const out = [];
        const avoid = opts.avoid;
        for (let i = 0; i < n; i++) {
            const key = `${seed}|fl|${day}|${i}`;
            let hex = this._pickHex(rv, flotsamHash(key, 'hex'));
            if (hex && avoid && hex.q === avoid.q && hex.r === avoid.r) hex = this._pickHex(rv, flotsamHash(key, 'hex2'));
            if (!hex || (avoid && hex.q === avoid.q && hex.r === avoid.r)) continue;
            const wet = this.wetness(world, hex.q, hex.r, day) / Math.max(0.01, _num(cfg.seasonMult[this._season(world)], 1));
            const def = this.pick(flotsamHash(key, 'find'), { wet, town: hex.town });
            if (!def) continue;
            const at = day * 24 - flotsamHash(key, 'hour') * 24;
            const res = RiverDrift.throwIn(world, hex.q, hex.r, this.make(def, key), at, { frac: flotsamHash(key, 'frac') * 0.9 });
            if (res.ok && res.item) out.push(res.item);
        }
        return out;
    },

    /**
     * The hex the player watches on the street map: once in each whole hour,
     * at watchPerHour, something comes down into it — in at the side its
     * river comes in by (or from the head of a river rising here). → the item
     * or null.
     */
    watch(world, q, r, now) {
        const cfg = this.config();
        if (!cfg.enabled || !RiverDrift.config().enabled || !world || !Number.isFinite(now)) return null;
        const st = RiverDrift.state(world);
        const hour = Math.floor(now);
        const key = `${q},${r}`;
        if (!st.watched || st.watched.key !== key) st.watched = { key, hour };
        if (hour <= st.watched.hour) return null;
        // (only the latest hour counts when hours went by at a stroke: things are not rained in by the dozen)
        st.watched.hour = hour;
        const tile = RiverDrift._tile(world, q, r);
        if (!RiverDrift.isRiverHex(tile)) return null;
        const seed = this._seed(world);
        const hk = `${seed}|watch|${q},${r}|${hour}`;
        const day = Math.floor(hour / 24);
        const wet = this.wetness(world, q, r, day);
        if (flotsamHash(hk, 'go') >= Math.min(0.95, _num(cfg.watchPerHour, 0) * Math.sqrt(wet))) return null;
        let town = !!tile.settlement;
        let inDir = null;
        for (let d = 0; d < 6; d++) {
            const n = RiverDrift._step(world, q, r, d);
            const nt = RiverDrift._tile(world, n.q, n.r);
            if (nt && nt.settlement) town = true;
            if (inDir != null || !RiverDrift.isRiverHex(nt)) continue;
            const down = RiverDrift.downstream(world, n.q, n.r);
            if (down.kind === 'river' && down.q === q && down.r === r) inDir = d;
        }
        const def = this.pick(flotsamHash(hk, 'find'), { wet: wet / Math.max(0.01, _num(cfg.seasonMult[this._season(world)], 1)), town });
        if (!def) return null;
        this._capWild(world, 1);
        const res = RiverDrift.throwIn(world, q, r, this.make(def, hk), now, { frac: 0 });
        if (!res.ok || !res.item) return null;
        res.item.inDir = inDir;
        res.item.t0 = now;
        return res.item;
    },

    /** The text of a bottle's note */
    noteText(i) {
        const notes = this.config().notes;
        return Number.isInteger(i) && notes[i] ? notes[i] : null;
    },

    /**
     * Into the packs: a thing fished out of the water or hauled from a net.
     * A purse's coin goes into the purse (lost coin, booked as found in the
     * realm it turned up in); a bottle's note is read. → { ok, coins, note, full }
     */
    receive(world, player, entry, where = null) {
        if (!player || !entry || !entry.itemId) return { ok: false };
        const add = PlayerInventory.addItem(player, entry.itemId, entry.qty || 1);
        if (!add.success) return { ok: false, full: true };
        let coins = 0;
        if (entry.coins > 0) {
            coins = Math.floor(entry.coins);
            player.gold = (Number(player.gold) || 0) + coins;
            const at = where || player;
            try { MoneySupply.registerNew(world, CoinCensus.realmAt(world, at.q, at.r), coins, 'found'); } catch { /* no realm */ }
        }
        return { ok: true, coins, note: this.noteText(entry.note) };
    },

    /** The daily tick (ui/game/endDay.js): the day's finds go into the rivers */
    processDay(world, player, day) {
        const avoid = player && Number.isFinite(player.q) ? { q: player.q, r: player.r } : null;
        return { notices: [], items: this.spawnDay(world, day, { avoid }) };
    },
};
