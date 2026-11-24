// ============================================
// FERRIES — paid crossings of the great rivers and the straits
// ============================================
// Two kinds, both worked out from the world (no state of their own, nothing
// saved: the same world gives the same ferries):
//
//   river   A great river (world/rivers.js band 'great') is a barrier on
//           land. Near a town (within ferries.range hexes) where the river
//           has no bridge, road crossing or natural ford, a ferry plies: the
//           ferryman's flat boat on a rope or poles, at the hours of its
//           timetable (more sailings in a bigger town). Crossing there costs
//           a share of the wade (share[who]: on foot, as a host, a war host's
//           march) plus the wait for the next sailing by daylight, and a fare
//           (paid by the player: systems/ports.js ferryStep). Ferries keep
//           `spacing` hexes apart; each town has at most one.
//   strait  Two port towns on different landmasses (world/landRegions.js)
//           with at most strait.maxWater hexes of sea between them: a ferry
//           runs across (systems/ports.js takeStrait: the fare, a day).
//
// Pure: no randomness (names by a hash of the place), no globals. Sited once
// per world and re-sited every SITE_DAYS days (towns are founded and razed).
// Settings: data/ports.json `ferries`.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Rivers } from './rivers.js';
import { LandRegions } from './landRegions.js';

const SEA_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const SIZES = ['village', 'town', 'city', 'capital'];
const SITE_DAYS = 30;

const DEFAULTS = {
    range: 3,
    spacing: 6,
    share: { player: 0.12, host: 0.45, army: 0.5 },
    fare: { river: 2, great: 3, host: 1 },
    timetable: { village: [7, 12, 17], town: [6, 9, 12, 15, 18], city: [6, 8, 10, 12, 14, 16, 18, 20], capital: [6, 8, 10, 12, 14, 16, 18, 20] },
    strait: { maxWater: 3, fare: 14, perHex: 4, days: 1, minSize: 'village', perTown: 2 },
    ferrymen: ['Old Tam', 'Hob the ferryman', 'Wat Oarsby', 'Jory Pole', 'Edda Rope'],
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** world → { tiles, bucket, n, river: Map key → ferry, list, straits } */
const _sites = new WeakMap();

export const Ferries = {
    config() {
        const g = DataLoader._gamedata;
        const d = _obj(g && g.ports && g.ports.ferries);
        return {
            ...DEFAULTS, ...d,
            share: { ...DEFAULTS.share, ..._obj(d.share) },
            fare: { ...DEFAULTS.fare, ..._obj(d.fare) },
            timetable: { ...DEFAULTS.timetable, ..._obj(d.timetable) },
            strait: { ...DEFAULTS.strait, ..._obj(d.strait) },
            ferrymen: Array.isArray(d.ferrymen) && d.ferrymen.length ? d.ferrymen : DEFAULTS.ferrymen,
        };
    },

    _key(q, r) { return `${q},${r}`; },

    _tile(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        if (Number.isFinite(world.height) && (r < 0 || r >= world.height)) return null;
        return world.getTile(world.width > 0 ? Hex.wrapQ(q, world.width) : q, r) || null;
    },

    _dist(world, a, b) {
        return world && world.width > 0 ? Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, world.width) : Hex.offsetDistance(a.q, a.r, b.q, b.r);
    },

    /** The towns of the world: { q, r, name, type } (views where the world has them, else its tiles). */
    _towns(world) {
        const out = [];
        if (typeof world.getSettlementViews === 'function') {
            for (const v of world.getSettlementViews() || []) {
                if (v && Number.isFinite(v.q) && Number.isFinite(v.r)) out.push({ q: v.q, r: v.r, name: v.name || 'the town', type: v.type || 'village' });
            }
            if (out.length) return out;
        }
        const rows = Array.isArray(world.tiles) ? world.tiles : [];
        for (const row of rows) {
            for (const t of row || []) {
                if (t && t.settlement) out.push({ q: t.q, r: t.r, name: t.settlement.name || 'the town', type: t.settlement.type || 'village' });
            }
        }
        return out;
    },

    _isPort(world, q, r) {
        return Hex.neighbors(q, r).some(n => {
            const t = this._tile(world, n.q, n.r);
            return !!(t && t.terrain && SEA_IDS.has(t.terrain.id));
        });
    },

    /** Forget a world's ferries (a test or an editor changed its towns or rivers). */
    reset(world) {
        if (world) _sites.delete(world);
    },

    /** The world's ferries, sited (and re-sited every SITE_DAYS days). */
    sites(world) {
        if (!world || !(world.width > 0) || !(world.height > 0)) return null;
        const bucket = Math.floor(_num(world.day) / SITE_DAYS);
        const hit = _sites.get(world);
        if (hit && hit.tiles === world.tiles && hit.bucket === bucket) return hit;
        const C = this.config();
        const towns = this._towns(world);
        const river = new Map();
        const list = [];
        // ── River ferries: the nearest uncrossed great-river hex to each town ──
        const range = Math.max(1, Math.floor(_num(C.range, 3)));
        const spacing = Math.max(1, _num(C.spacing, 6));
        // (bigger towns site first: theirs is the ferry the road comes to)
        const order = towns.slice().sort((a, b) => SIZES.indexOf(b.type) - SIZES.indexOf(a.type) || a.r - b.r || a.q - b.q);
        for (const town of order) {
            let best = null, bestD = Infinity, bestH = 0;
            for (let dr = -range; dr <= range; dr++) {
                for (let dq = -range - 1; dq <= range + 1; dq++) {
                    const q = world.width > 0 ? Hex.wrapQ(town.q + dq, world.width) : town.q + dq, r = town.r + dr;
                    const t = this._tile(world, q, r);
                    if (!t || !t.hasRiver || t.settlement || !t.terrain || t.terrain.passable === false) continue;
                    const d = this._dist(world, town, { q, r });
                    if (d < 1 || d > range) continue;
                    if (Rivers.band(world, q, r) !== 'great') continue;
                    if (Rivers.crossingAt(t)) continue;
                    const h = _hash(`${q},${r}`);
                    if (d < bestD || (d === bestD && h < bestH)) { best = { q, r }; bestD = d; bestH = h; }
                }
            }
            if (!best) continue;
            if (list.some(f => this._dist(world, f, best) < spacing)) continue;
            const type = SIZES.includes(town.type) ? town.type : 'village';
            const f = {
                id: `ferry:${best.q},${best.r}`,
                kind: 'river',
                q: best.q, r: best.r,
                town: { q: town.q, r: town.r, name: town.name, type },
                ferryman: C.ferrymen[_hash(`fm:${best.q},${best.r}`) % C.ferrymen.length],
                fare: Math.max(0, Math.round(_num(C.fare.great, 3))),
                hours: (C.timetable[type] || C.timetable.village || [8, 16]).slice().sort((a, b) => a - b),
            };
            river.set(this._key(best.q, best.r), f);
            list.push(f);
        }
        // ── Straits: port towns facing each other across a narrow sea ──
        const S = C.strait;
        const ports = towns.filter(t => SIZES.indexOf(t.type) >= Math.max(0, SIZES.indexOf(S.minSize)) && this._isPort(world, t.q, t.r));
        const straits = [];
        const per = new Map();
        const maxD = Math.max(2, Math.floor(_num(S.maxWater, 3)) + 1);
        const pairs = [];
        for (let i = 0; i < ports.length; i++) {
            for (let j = i + 1; j < ports.length; j++) {
                const a = ports[i], b = ports[j];
                const d = this._dist(world, a, b);
                if (d < 2 || d > maxD) continue;
                if (LandRegions.connected(world, a, b)) continue;
                pairs.push({ a, b, d });
            }
        }
        pairs.sort((x, y) => x.d - y.d || _hash(`${x.a.q},${x.a.r}>${x.b.q},${x.b.r}`) - _hash(`${y.a.q},${y.a.r}>${y.b.q},${y.b.r}`));
        const cap = Math.max(1, Math.floor(_num(S.perTown, 2)));
        for (const p of pairs) {
            const ka = this._key(p.a.q, p.a.r), kb = this._key(p.b.q, p.b.r);
            if ((per.get(ka) || 0) >= cap || (per.get(kb) || 0) >= cap) continue;
            per.set(ka, (per.get(ka) || 0) + 1);
            per.set(kb, (per.get(kb) || 0) + 1);
            straits.push({
                id: `strait:${ka}|${kb}`,
                kind: 'strait',
                a: { q: p.a.q, r: p.a.r, name: p.a.name, type: p.a.type },
                b: { q: p.b.q, r: p.b.r, name: p.b.name, type: p.b.type },
                dist: p.d,
                ferryman: C.ferrymen[_hash(`st:${ka}|${kb}`) % C.ferrymen.length],
                fare: Math.max(0, Math.round(_num(S.fare, 14) + _num(S.perHex, 4) * Math.max(0, p.d - 2))),
                days: Math.max(1, Math.round(_num(S.days, 1))),
                hours: [7],
            });
        }
        const out = { tiles: world.tiles, bucket, river, list, straits };
        _sites.set(world, out);
        return out;
    },

    /** The river ferry on (q, r), or null. */
    at(world, q, r) {
        const s = this.sites(world);
        if (!s || !s.river.size) return null;
        const wq = world.width > 0 ? Hex.wrapQ(q, world.width) : q;
        return s.river.get(this._key(wq, r)) || null;
    },

    /** Every river ferry. */
    riverFerries(world) {
        const s = this.sites(world);
        return s ? s.list : [];
    },

    /** Every strait ferry. */
    straits(world) {
        const s = this.sites(world);
        return s ? s.straits : [];
    },

    /** The strait ferries from the port at (q, r): [{ ferry, to }] */
    straitsFrom(world, q, r) {
        const out = [];
        for (const f of this.straits(world)) {
            if (f.a.q === q && f.a.r === r) out.push({ ferry: f, from: f.a, to: f.b });
            else if (f.b.q === q && f.b.r === r) out.push({ ferry: f, from: f.b, to: f.a });
        }
        return out;
    },

    /**
     * Expected wait for the next sailing, in days, for one who comes to the
     * bank at a random hour of daylight (between the first and last sailing).
     */
    waitDays(ferry) {
        const h = ferry && Array.isArray(ferry.hours) ? ferry.hours : [];
        if (h.length < 2) return 0.25;
        const span = h[h.length - 1] - h[0];
        if (!(span > 0)) return 0.25;
        let sq = 0;
        for (let i = 1; i < h.length; i++) sq += (h[i] - h[i - 1]) ** 2;
        return Math.round((sq / 2 / span / 24) * 1000) / 1000;
    },

    /** The next sailing at or after `hour` (0..24): { hour, tomorrow } */
    nextSailing(ferry, hour) {
        const h = ferry && Array.isArray(ferry.hours) && ferry.hours.length ? ferry.hours : [8];
        const x = _num(hour);
        for (const s of h) if (s >= x) return { hour: s, tomorrow: false };
        return { hour: h[0], tomorrow: true };
    },

    /**
     * The crossing at a ferry in place of the wade: `extra` is what
     * Rivers.crossExtra asked (days on foot / as a host, or hexes of an
     * army's march) — the ferry takes share[who] of it, plus the wait (not for
     * an army: its boats are kept going all day). Never more than the wade.
     */
    soften(ferry, extra, who = 'player') {
        if (!ferry || !(extra > 0)) return extra;
        const C = this.config();
        const share = Math.max(0, Math.min(1, _num(C.share[who], 0.5)));
        const wait = who === 'army' ? 0 : this.waitDays(ferry);
        return Math.min(extra, extra * share + wait);
    },

    /** The fare for the player (as a host: so much a head more). */
    fareFor(ferry, player = null, asHost = false) {
        if (!ferry) return 0;
        const base = Math.max(0, _num(ferry.fare));
        if (!asHost) return base;
        const n = player && Array.isArray(player.army) ? player.army.length : 0;
        return base + Math.round(n * Math.max(0, _num(this.config().fare.host, 1)));
    },

    /**
     * An army's (world/units.js) or anyone's crossing cost into (tq, tr):
     * Rivers.crossExtra, softened where a ferry plies.
     */
    crossExtra(world, fq, fr, tq, tr, who = 'player') {
        const x = Rivers.crossExtra(world, fq, fr, tq, tr, who);
        if (!(x > 0)) return x;
        const f = this.at(world, tq, tr);
        return f ? this.soften(f, x, who) : x;
    },
};
