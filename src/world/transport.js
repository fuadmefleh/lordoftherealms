// ============================================
// TRANSPORT — road segments, their quality, and the haulage of trade
// ============================================
// The world's generated roads (tile.hasRoad) are split into SEGMENTS: the
// road between two neighbouring settlements (a walk along road hexes from
// one town that meets another without passing a third). Each segment keeps
// real state on world.transport.segs[key]:
//
//   t   tier       track → road → paved highway (data/transport.json tiers)
//   c   condition  0..100: worn below bands.worn (rutted), ruined below
//                  bands.ruined (no better than open country)
//   x   crossing   its river hexes: 'bridge' | 'ford' | 'ferry' (null: none)
//   cl  closed     'snow' (a pass in winter) | 'flood' (a ford in spate) | null
//   toll           the public work (systems/publicWorks.js) that tolls it
//
// Condition decays every week (more in winter and the spring thaw, much more
// in a realm at war, and under the boots of war hosts); the realm that holds
// the road pays its upkeep from its treasury and so repairs it (roads outside
// any realm are kept by their towns, poorly). Bridges wash out in storms and
// spring floods (a ferry plies where a town is near, else travellers ford);
// passes close in winter snow.
//
// Readers:
//   - the player's movement (systems/infrastructure.js reads the baked tile
//     fields roadMove / roadExtra / roadCross / roadCrossMove; a tile with
//     none of them is the old road: ×0.5, bridged — so fixtures and old
//     paths are unchanged)
//   - the NPC trade links (systems/marketDynamics.js calls applyLink each
//     market turn: friction from the tiers and condition of the segments on
//     the way, tolls, fords, closures, mud and snow; open-country links by
//     the terrain on the straight line; spoilage of perishables in transit;
//     canals and harbour works)
//   - merchant caravans' speed (link._speed), the hinterland's haulage
//     (haulFactor), the map (tile.roadBand / roadTier, tollGate).
//
// Pure model: no RNG (initial conditions, washouts and closures are hashes
// of the world seed, the segment and the week), no imports above world/.
// Segments are derived from the roads (regenerated from the seed on load);
// only their state is saved (systems/saveLoad.js). Old saves derive it.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from './seasons.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r2 = (v) => Math.round(v * 100) / 100;
const RANK = { village: 0, town: 1, city: 2, capital: 3 };
const ARMIES = new Set(['war_host', 'relief_host']);
const BAND_IDX = { good: 0, worn: 1, ruined: 2, closed: 3 };

const DEFAULTS = {
    tiers: {
        track: { name: 'Track', icon: '🟫', rank: 0, move: 0.6, speed: 0.8, friction: 0.8, decay: 4, repair: 4, upkeep: 0.6, crossing: 'ford', color: '#9a7b52', width: 1.5 },
        road: { name: 'Road', icon: '🛤️', rank: 1, move: 0.5, speed: 1, friction: 0.6, decay: 3, repair: 4, upkeep: 1.5, crossing: 'bridge', color: '#c8a46a', width: 2.5 },
        highway: { name: 'Paved highway', icon: '🛣️', rank: 2, move: 0.33, speed: 1.3, friction: 0.45, decay: 1.5, repair: 3, upkeep: 3, crossing: 'bridge', color: '#e8e0c8', width: 4 },
    },
    bands: { worn: 40, ruined: 15, ruttedMove: 1.5, ruttedFriction: 1.25, ruttedSpeed: 0.8, startMin: 62, startMax: 96 },
    weather: { winterDecay: 2, springDecay: 1, warDecay: 3, armyDamage: 6, mudFriction: 1.2, openMud: 1.15, winterFriction: 1.1 },
    passes: { terrain: ['mountain', 'highlands', 'snow', 'tundra', 'ice'], high: ['mountain', 'snow', 'ice'], minHexes: 1, deepFrom: 8, closedMove: 3 },
    rivers: { fordMove: 1, fordFriction: 0.12, ferryMove: 1, ferryFare: 2, ferryFriction: 0.06, ferryRange: 2, floodChance: 0.12, washChance: 0.025, washStorm: 0.12, washRutted: 2 },
    terrain: { base: 0.7, perMove: 0.15, min: 0.85, max: 1.45 },
    perish: { goods: ['fish', 'meat', 'bread', 'cheese'], perDay: 0.025, loss: 0.02, maxLoss: 0.35, landSpeed: 3, roadSpeed: 4, seaSpeed: 6, canalSpeed: 5 },
    upkeep: { floor: 400, maxDebt: 0.8, warShare: 0.5, freeRepair: 2 },
    works: {},
    build: { wageMult: 1, drawShare: 0.3, budgetPad: 0.15, crownShare: 0.25, maxPerRealm: 2, maxPlayer: 4, keepDone: 40 },
    realms: { repairAt: 1500, upgradeAt: 9000, canalAt: 30000, harbourAt: 20000, canalEvery: 360, maxDebt: 0.5, minWelfare: 0.35, personality: {} },
    news: { cap: 40, chatterRange: 6 },
    counsel: { radius: 10, minTrade: 60 },
    render: { minZoom: 0.45, worn: '#d08a3a', ruined: '#b0443a', closed: '#8fb4d8', canal: '#4aa3df' },
};

let _src;
let _cfg = null;
/** Per-world derived segments and caches (rebuilt from the roads; never saved). */
const _rt = new WeakMap();
/** State records already checked for shape (state() is read many times a day). */
const _okStates = new WeakSet();
/** Switch the model's effects off (measurement only: the old flat road factor). */
let _off = false;

function _build(src) {
    const d = _obj(src) || {};
    const tiers = {};
    for (const [id, t] of Object.entries({ ...DEFAULTS.tiers, ...(d.tiers || {}) })) {
        if (!_obj(t) || id.startsWith('_')) continue;
        tiers[id] = { ...(DEFAULTS.tiers[id] || {}), ...t, id };
    }
    const order = Object.values(tiers).sort((a, b) => a.rank - b.rank).map(t => t.id);
    const merge = (k) => ({ ...DEFAULTS[k], ...(_obj(d[k]) || {}) });
    const perish = merge('perish');
    return {
        tiers, order,
        bands: merge('bands'), weather: merge('weather'), passes: merge('passes'), rivers: merge('rivers'),
        terrain: merge('terrain'), perish, perishSet: new Set(perish.goods || []), upkeep: merge('upkeep'),
        works: _obj(d.works) || {}, build: merge('build'), realms: { ...merge('realms'), personality: { ...(_obj(d.realms) && d.realms.personality) || {} } },
        news: merge('news'), counsel: merge('counsel'), render: merge('render'),
        passSet: new Set(merge('passes').terrain || []), highSet: new Set(merge('passes').high || []),
    };
}

/** FNV-1a hash of a string. */
function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return (_hash(key) % 100000) / 100000;
}

function _views(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
    return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

export const Transport = {
    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.transport : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            _cfg = _build(src);
        }
        return _cfg;
    },

    tier(id) {
        const C = Transport.config();
        return C.tiers[id] || C.tiers.road || Object.values(C.tiers)[0];
    },

    /** The tier one rank above `id`, or null at the top. */
    nextTier(id) {
        const o = Transport.config().order;
        const i = o.indexOf(id);
        return i >= 0 && i < o.length - 1 ? o[i + 1] : null;
    },

    work(kind) {
        const w = Transport.config().works[kind];
        return _obj(w) ? w : null;
    },

    roll: _roll,
    hash: _hash,

    /** Measurement only: switch the haulage model off (every road link back to the flat roadFactor). */
    setEnabled(on) { _off = !on; },
    enabled() { return !_off; },

    seed(world) {
        return String((world && world.generationParams && world.generationParams.seed) || 'world');
    },

    // ── State ─────────────────────────────────────────────

    /** world.transport: { segs, works, canals, harbours, history, stats, ... } (created on first use). */
    state(world) {
        if (!world) return null;
        const cur = world.transport;
        if (cur && _okStates.has(cur)) return cur;
        let st = _obj(cur);
        if (!st) st = world.transport = Transport._blank();
        for (const k of ['segs', 'canals', 'harbours', 'stats', 'realms']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['works', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        if (!Number.isFinite(st.seq)) st.seq = 1;
        _okStates.add(st);
        return st;
    },

    _blank() {
        return { v: 1, segs: {}, works: [], canals: {}, harbours: {}, history: [], stats: {}, realms: {}, seq: 1, lastDay: null, season: null, syncAt: null };
    },

    serialize(world) {
        const st = world && _obj(world.transport);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load: the saved record, or none (older saves derive their roads' state from the roads on first use). */
    restore(saved, world) {
        if (!world) return;
        world.transport = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        _rt.delete(world);
    },

    // ── Segments ──────────────────────────────────────────

    /**
     * The derived segments of the world (memoised): { segs, byKey, adj, paths }.
     * Derives them (and any missing state) on first use and after a load.
     */
    runtime(world) {
        if (!world || typeof world.getTile !== 'function' || !Array.isArray(world.tiles)) return null;
        const st = Transport.state(world);
        let rt = _rt.get(world);
        if (rt && rt.st === st) return rt;
        rt = Transport.derive(world);
        return rt;
    },

    /**
     * Split the road network into segments between neighbouring towns, give
     * any segment without state its starting state (a hash of the seed), and
     * bake the tiles. Deterministic; draws no RNG.
     */
    derive(world) {
        const st = Transport.state(world);
        const C = Transport.config();
        const W = world.width, H = world.height;
        const old = _rt.get(world);
        if (old) Transport._unbake(world, old);
        const towns = new Map();
        for (const v of _views(world)) {
            const t = world.getTile(v.q, v.r);
            if (t && t.settlement) towns.set(_key(v.q, v.r), { q: v.q, r: v.r, s: t.settlement });
        }
        const keys = [...towns.keys()].sort();
        const N = W * H;
        const seen = new Int32Array(N);
        const parent = new Int32Array(N);
        let stamp = 0;
        const edges = new Map();
        const tileAt = (i) => world.tiles[Math.floor(i / W)][i % W];
        for (const sk of keys) {
            const s = towns.get(sk);
            stamp++;
            const start = s.r * W + s.q;
            seen[start] = stamp;
            parent[start] = -1;
            const queue = [start];
            for (let h = 0; h < queue.length; h++) {
                const cur = queue[h];
                const cq = cur % W, cr = Math.floor(cur / W);
                for (const nb of Hex.neighbors(cq, cr)) {
                    if (nb.r < 0 || nb.r >= H) continue;
                    const nq = Hex.wrapQ(nb.q, W);
                    const ni = nb.r * W + nq;
                    if (seen[ni] === stamp) continue;
                    const t = tileAt(ni);
                    if (!t) continue;
                    if (t.settlement) {
                        seen[ni] = stamp;
                        const tk = _key(nq, nb.r);
                        if (tk === sk || !towns.has(tk)) continue;
                        const ek = sk < tk ? `${sk}|${tk}` : `${tk}|${sk}`;
                        if (edges.has(ek)) continue;
                        const path = [];
                        for (let p = cur; p !== start && p >= 0; p = parent[p]) path.push(p);
                        path.reverse();
                        const [a, b] = sk < tk ? [s, towns.get(tk)] : [towns.get(tk), s];
                        if (sk > tk) path.reverse();
                        edges.set(ek, { key: ek, a, b, path });
                        continue;
                    }
                    if (!t.hasRoad || !t.terrain || !t.terrain.passable) continue;
                    seen[ni] = stamp;
                    parent[ni] = cur;
                    queue.push(ni);
                }
            }
        }
        // Segments, shortest first: each road hex belongs to the first that claims it
        const list = [...edges.values()].sort((x, y) => (x.path.length - y.path.length) || (x.key < y.key ? -1 : 1));
        const owner = new Map();
        const segs = [];
        const byKey = new Map();
        const adj = new Map();
        for (const e of list) {
            const id = segs.length;
            const own = [];
            for (const i of e.path) if (!owner.has(i)) { owner.set(i, id); own.push(i); }
            const ownSet = new Set(own);
            const rivers = [];
            let passN = 0, high = false, peak = -1, peakE = -Infinity;
            for (const i of e.path) {
                const t = tileAt(i);
                if (ownSet.has(i) && t.hasRiver) rivers.push(i);
                const tid = t.terrain && t.terrain.id;
                if (C.passSet.has(tid)) {
                    passN++;
                    if (C.highSet.has(tid)) high = true;
                    const el = _num(t.elevation, 0);
                    if (el > peakE) { peakE = el; peak = i; }
                }
            }
            const seg = {
                id, key: e.key, a: e.a, b: e.b, path: e.path, own, len: e.path.length + 1, rivers,
                pass: passN >= _num(C.passes.minHexes, 1), high, peak,
                gate: rivers.length ? rivers[0] : (own.length ? own[Math.floor(own.length / 2)] : -1),
                kid: null,
            };
            segs.push(seg);
            byKey.set(e.key, seg);
            for (const k of [_key(e.a.q, e.a.r), _key(e.b.q, e.b.r)]) {
                if (!adj.has(k)) adj.set(k, []);
                adj.get(k).push(id);
            }
            if (!_obj(st.segs[e.key])) st.segs[e.key] = Transport._startState(world, seg);
            const ss = st.segs[e.key];
            if (!C.tiers[ss.t]) ss.t = 'road';
            ss.c = _clamp(_num(ss.c, 70), 0, 100);
            if (!rivers.length) ss.x = null;
            else if (!['bridge', 'ford', 'ferry'].includes(ss.x)) ss.x = Transport.tier(ss.t).crossing || 'bridge';
        }
        const rt = { st, segs, byKey, adj, paths: new Map(), W, towns: towns.size };
        _rt.set(world, rt);
        Transport._owners(world, rt);
        for (const seg of segs) Transport.bake(world, seg, rt);
        st.syncAt = _num(world.day);
        return rt;
    },

    /** A new segment's state: the tier its towns earn, a hashed condition, its crossing. */
    _startState(world, seg) {
        const C = Transport.config();
        const a = seg.a.s, b = seg.b.s;
        const ra = RANK[a && a.type] || 0, rb = RANK[b && b.type] || 0;
        let t = 'road';
        if (ra >= 2 && rb >= 2 && a.kingdom && a.kingdom === b.kingdom && C.tiers.highway) t = 'highway';
        else if (ra === 0 && rb === 0 && C.tiers.track) t = 'track';
        const B = C.bands;
        const c = Math.round(_num(B.startMin, 62) + _roll(`${Transport.seed(world)}:road:${seg.key}`) * (_num(B.startMax, 96) - _num(B.startMin, 62)));
        return { t, c, x: seg.rivers.length ? (Transport.tier(t).crossing || 'bridge') : null, cl: null, toll: null };
    },

    /** Which realm keeps each segment: most of its hexes (ties: its first town's). Refreshed monthly. */
    _owners(world, rt) {
        for (const seg of rt.segs) {
            const count = new Map();
            for (const i of seg.path) {
                const t = world.tiles[Math.floor(i / rt.W)][i % rt.W];
                if (t && t.kingdom != null) count.set(t.kingdom, (count.get(t.kingdom) || 0) + 1);
            }
            let best = seg.a.s && seg.a.s.kingdom != null ? seg.a.s.kingdom : null, n = best != null ? 0.5 : 0;
            for (const [k, c] of count) if (c > n) { best = k; n = c; }
            seg.kid = best;
        }
    },

    _unbake(world, rt) {
        for (const seg of rt.segs) {
            for (const i of seg.own) {
                const t = world.tiles[Math.floor(i / rt.W)] && world.tiles[Math.floor(i / rt.W)][i % rt.W];
                if (!t) continue;
                delete t.roadSeg; delete t.roadMove; delete t.roadExtra; delete t.roadCross; delete t.roadCrossMove;
                delete t.roadBand; delete t.roadTier; delete t.tollGate;
            }
        }
    },

    /** A segment's state record. */
    segState(world, seg) {
        const st = Transport.state(world);
        return st.segs[seg.key] || (st.segs[seg.key] = Transport._startState(world, seg));
    },

    /** 'good' | 'worn' | 'ruined' | 'closed' for a segment's state. */
    band(s) {
        if (!s) return 'good';
        if (s.cl) return 'closed';
        const B = Transport.config().bands;
        if (_num(s.c) < B.ruined) return 'ruined';
        if (_num(s.c) < B.worn) return 'worn';
        return 'good';
    },

    /** Is it mud season (spring), or winter, on `day`? */
    _season(day) {
        return Number.isFinite(day) ? Seasons.seasonOf(day) : null;
    },

    /** Move-cost multiplier on a road hex of this state (1 = no better than open country). */
    moveMult(s) {
        const B = Transport.config().bands;
        const T = Transport.tier(s.t);
        const c = _num(s.c, 100);
        if (c < B.ruined) return 1;
        if (c < B.worn) return Math.min(1, T.move * B.ruttedMove);
        return T.move;
    },

    /** Write the segment's derived fields onto its hexes (what movement, the map and the toll gates read). */
    bake(world, seg, rt = null) {
        rt = rt || _rt.get(world);
        if (!rt) return;
        const C = Transport.config();
        const s = Transport.segState(world, seg);
        const season = Transport._season(world.day);
        const band = Transport.band(s);
        const move = _off ? 0.5 : Transport.moveMult(s);
        let extra = 0;
        if (!_off) {
            if (season === 'Spring' && (s.t === 'track' || band === 'worn' || band === 'ruined')) extra += 1;
            if (s.cl) extra += _num(C.passes.closedMove, 3);
        }
        const R = C.rivers;
        const crossMove = s.x === 'ford' ? _num(R.fordMove, 1) : s.x === 'ferry' ? _num(R.ferryMove, 1) : 0;
        for (const i of seg.own) {
            const t = world.tiles[Math.floor(i / rt.W)][i % rt.W];
            t.roadSeg = seg.id;
            t.roadMove = move;
            t.roadExtra = extra;
            t.roadBand = band;
            t.roadTier = s.t;
            if (t.hasRiver && s.x && !_off) {
                t.roadCross = s.x;
                t.roadCrossMove = crossMove;
            } else {
                delete t.roadCross;
                delete t.roadCrossMove;
            }
            if (t.tollGate) delete t.tollGate;
        }
        if (s.toll && seg.gate >= 0) {
            const g = world.tiles[Math.floor(seg.gate / rt.W)][seg.gate % rt.W];
            if (g) g.tollGate = s.toll;
        }
    },

    bakeAll(world) {
        const rt = Transport.runtime(world);
        if (!rt) return;
        for (const seg of rt.segs) Transport.bake(world, seg, rt);
    },

    // ── Lookups ───────────────────────────────────────────

    segments(world) {
        const rt = Transport.runtime(world);
        return rt ? rt.segs : [];
    },

    segment(world, id) {
        const rt = Transport.runtime(world);
        if (!rt) return null;
        if (typeof id === 'number') return rt.segs[id] || null;
        return rt.byKey.get(id) || null;
    },

    /** The segment a road hex belongs to, or null. */
    segmentAt(world, q, r) {
        const rt = Transport.runtime(world);
        const t = rt && world.getTile(q, r);
        return t && Number.isInteger(t.roadSeg) ? rt.segs[t.roadSeg] || null : null;
    },

    /** Segments touching the town at (q, r). */
    segmentsOf(world, q, r) {
        const rt = Transport.runtime(world);
        if (!rt) return [];
        return (rt.adj.get(_key(q, r)) || []).map(id => rt.segs[id]);
    },

    /** Segments with a hex (or a town) within `radius` of (q, r), nearest first. */
    segmentsNear(world, q, r, radius = 6) {
        const rt = Transport.runtime(world);
        if (!rt) return [];
        const out = [];
        for (const seg of rt.segs) {
            let best = Infinity;
            const pts = [seg.a, seg.b];
            for (const i of seg.path) pts.push({ q: i % rt.W, r: Math.floor(i / rt.W) });
            for (const p of pts) {
                if (Math.abs(p.r - r) > radius) continue;
                const d = Hex.wrappingDistance(p.q, p.r, q, r, world.width);
                if (d < best) best = d;
            }
            if (best <= radius) out.push({ seg, d: best });
        }
        out.sort((x, y) => (x.d - y.d) || (x.seg.id - y.seg.id));
        return out.map(x => x.seg);
    },

    /** The hex of a segment's index `i`: { q, r }. */
    hexOf(world, i) {
        const W = world.width;
        return { q: i % W, r: Math.floor(i / W) };
    },

    /** One line for panels: { name, tier, cond, band, crossing, closed, toll, kingdom, len }. */
    describe(world, seg) {
        const s = Transport.segState(world, seg);
        const T = Transport.tier(s.t);
        const k = _kingdom(world, seg.kid);
        return {
            id: seg.id, key: seg.key, name: `${(seg.a.s && seg.a.s.name) || 'a town'} – ${(seg.b.s && seg.b.s.name) || 'a town'}`,
            tier: s.t, tierName: T.name, icon: T.icon, cond: Math.round(_num(s.c)), band: Transport.band(s),
            crossing: s.x, rivers: seg.rivers.length, closed: s.cl || null, toll: s.toll || null, pass: !!seg.pass,
            kingdom: k ? k.name : null, kid: seg.kid, len: seg.len,
        };
    },

    // ── Paths between towns ───────────────────────────────

    /** The segments on the shortest road between two towns (ids), or null (memoised until the roads are derived again). */
    pathSegs(world, a, b) {
        const rt = Transport.runtime(world);
        if (!rt) return null;
        const ak = _key(a.q, a.r), bk = _key(b.q, b.r);
        const pk = ak < bk ? `${ak}>${bk}` : `${bk}>${ak}`;
        if (rt.paths.has(pk)) return rt.paths.get(pk);
        let res = null;
        if (rt.adj.has(ak) && rt.adj.has(bk)) {
            const dist = new Map([[ak, 0]]);
            const via = new Map();
            const done = new Set();
            for (let guard = 0; guard < 400; guard++) {
                let cur = null, cd = Infinity;
                for (const [k, d] of dist) if (!done.has(k) && d < cd) { cd = d; cur = k; }
                if (cur === null || cd > 40) break;
                if (cur === bk) break;
                done.add(cur);
                for (const id of rt.adj.get(cur) || []) {
                    const seg = rt.segs[id];
                    const other = _key(seg.a.q, seg.a.r) === cur ? _key(seg.b.q, seg.b.r) : _key(seg.a.q, seg.a.r);
                    const nd = cd + seg.len;
                    if (!dist.has(other) || nd < dist.get(other)) { dist.set(other, nd); via.set(other, { from: cur, id }); }
                }
            }
            if (via.has(bk)) {
                res = [];
                for (let k = bk; k !== ak; k = via.get(k).from) res.push(via.get(k).id);
                res.reverse();
            }
        }
        rt.paths.set(pk, res);
        return res;
    },

    // ── Haulage ───────────────────────────────────────────

    /** Haulage factor of one segment (the old flat road was 0.6): tier × condition × mud and snow. */
    segFriction(s, season = null) {
        const C = Transport.config();
        const T = Transport.tier(s.t);
        const band = Transport.band(s);
        const Wt = C.weather;
        let f = T.friction;
        if (band === 'ruined') f = 1;
        else if (band === 'worn') f = Math.min(1, f * C.bands.ruttedFriction);
        if (season === 'Spring' && (s.t === 'track' || band === 'worn' || band === 'ruined')) f *= _num(Wt.mudFriction, 1.2);
        if (season === 'Winter' && (s.t === 'track' || band !== 'good')) f *= _num(Wt.winterFriction, 1.1);
        return f;
    },

    /** Speed factor of a segment for caravans (1 = the old road). */
    segSpeed(s) {
        const B = Transport.config().bands;
        const T = Transport.tier(s.t);
        const band = Transport.band(s);
        if (band === 'ruined') return _num(Transport.config().perish.landSpeed, 3) / _num(Transport.config().perish.roadSpeed, 4);
        return T.speed * (band === 'worn' ? _num(B.ruttedSpeed, 0.8) : 1);
    },

    /** Open-country haulage factor along the straight line between two towns (plains = 1). */
    terrainFactor(world, a, b) {
        const T = Transport.config().terrain;
        const W = world.width;
        let dq = b.q - a.q;
        if (W && Math.abs(dq) > W / 2) dq -= Math.sign(dq) * W;
        const pts = Hex.lineDraw(a.q, a.r, a.q + dq, b.r);
        let sum = 0, n = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const t = world.getTile(Hex.wrapQ(pts[i].q, W), pts[i].r);
            if (!t || !t.terrain) continue;
            sum += t.terrain.passable ? Math.min(5, _num(t.terrain.moveCost, 2)) : 4;
            n++;
        }
        const avg = n ? sum / n : 2;
        return _clamp(_num(T.base, 0.7) + _num(T.perMove, 0.15) * avg, _num(T.min, 0.85), _num(T.max, 1.45));
    },

    /**
     * Set today's haulage terms on a trade link (MarketDynamics, on the link's
     * market turn): link.friction (from link.fr0, the distance's), link.perish
     * (extra friction on perishables), link.loss (share of perishables lost on
     * the way), link.toll (rate charged on the value carried), link.tolls
     * (the works collecting it), link._speed (caravans' speed factor), and
     * link.closed. → true when the link is closed today (a pass in snow, a
     * ford in flood).
     */
    applyLink(world, link, day = null) {
        if (!Number.isFinite(link.fr0)) link.fr0 = _num(link.friction);
        link.perish = 0; link.loss = 0; link.toll = 0; link.tolls = null; link._speed = 1; link.closed = false;
        if (_off) { link.friction = link.fr0; return false; }
        const C = Transport.config();
        const rt = Transport.runtime(world);
        if (!rt) { link.friction = link.fr0; return false; }
        const st = rt.st;
        const T = (DataLoader._gamedata && DataLoader._gamedata.markets && DataLoader._gamedata.markets.trade) || {};
        const roadF = _num(T.roadFactor, 0.6);
        const season = Transport._season(day);
        const a = link.a, b = link.b;
        if (link._pk === undefined) {
            const ak = _key(a.q, a.r), bk = _key(b.q, b.r);
            link._pk = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
            link._ak = ak; link._bk = bk;
        }
        const P = C.perish;
        let mult = 1, closed = false, speed = 1, toll = 0, tolls = null;
        let hexPerDay;
        const canal = st.canals[link._pk];
        if (canal && !link.sea) {
            const cw = Transport.work('canal') || {};
            mult = _num(cw.friction, 0.4) / (link.road ? roadF : 1);
            hexPerDay = _num(P.canalSpeed, 5);
            speed = 1.25;
            if (canal.toll) { toll += _num(cw.toll, 0.04); tolls = [canal.id]; }
        } else if (link.sea) {
            const hw = Transport.work('harbour') || {};
            if (st.harbours[link._ak]) mult *= _num(hw.friction, 0.8);
            if (st.harbours[link._bk]) mult *= _num(hw.friction, 0.8);
            hexPerDay = _num(P.seaSpeed, 6);
        } else if (link.road) {
            if (link._rt !== rt) { link._rt = rt; link._ids = Transport.pathSegs(world, a, b); }
            const ids = link._ids;
            if (ids && ids.length) {
                const R = C.rivers;
                let wsum = 0, lsum = 0, ssum = 0, add = 0;
                for (const id of ids) {
                    const seg = rt.segs[id];
                    const s = st.segs[seg.key] || Transport.segState(world, seg);
                    if (s.cl) closed = true;
                    // (a segment's haulage holds for the day: several links share it)
                    if (seg._fday !== day || seg._fs !== s || seg._fc !== s.c || seg._ft !== s.t) {
                        seg._fday = day; seg._fs = s; seg._fc = s.c; seg._ft = s.t;
                        seg._f = Transport.segFriction(s, season);
                        seg._sp = Transport.segSpeed(s);
                    }
                    wsum += seg._f * seg.len;
                    ssum += seg._sp * seg.len;
                    lsum += seg.len;
                    if (s.x === 'ford') add += _num(R.fordFriction, 0.12) * seg.rivers.length;
                    else if (s.x === 'ferry') add += _num(R.ferryFriction, 0.06) * seg.rivers.length;
                    if (s.toll) {
                        const w = st.works.find(x => x && x.id === s.toll);
                        const rate = w ? _num(w.tollRate, _num((Transport.work(w.kind) || {}).toll)) : 0;
                        if (rate > 0) { toll += rate; (tolls || (tolls = [])).push(s.toll); }
                    }
                }
                mult = (wsum / lsum) / roadF + add;
                speed = ssum / lsum;
            }
            hexPerDay = _num(P.roadSpeed, 4) * speed;
        } else {
            if (!Number.isFinite(link._tf)) link._tf = Transport.terrainFactor(world, a, b);
            mult = link._tf;
            if (season === 'Spring') mult *= _num(C.weather.openMud, 1.15);
            else if (season === 'Winter') mult *= _num(C.weather.winterFriction, 1.1);
            hexPerDay = _num(P.landSpeed, 3);
            speed = hexPerDay / _num(P.roadSpeed, 4);
        }
        const days = Math.max(0.5, _num(link.dist, 1) / Math.max(0.5, hexPerDay));
        link.friction = link.fr0 * mult + toll;
        link.perish = Math.round(_num(P.perDay) * days * 10000) / 10000;
        link.loss = Math.min(_num(P.maxLoss, 0.35), _num(P.loss) * days);
        link.toll = toll;
        link.tolls = tolls;
        link._speed = speed;
        link.closed = closed;
        return closed;
    },

    /** Is this good spoiled on the road (data/transport.json perish.goods)? */
    perishable(goodId) {
        return Transport.config().perishSet.has(goodId);
    },

    /** A Uint8Array mask of the perishable goods in `goodIds` order (cached per list). */
    perishMask(goodIds) {
        const C = Transport.config();
        if (C._pm && C._pmIds === goodIds) return C._pm;
        const m = new Uint8Array(goodIds.length);
        goodIds.forEach((id, i) => { m[i] = C.perishSet.has(id) ? 1 : 0; });
        C._pm = m;
        C._pmIds = goodIds;
        return m;
    },

    /**
     * Haulage from a rural site to its market town (world/hinterland.js): the
     * share of the goods that arrive — 1 on a good road, less over rutted or
     * closed roads (a closed pass delivers nothing until it opens).
     */
    haulFactor(world, home, market) {
        if (_off || !home || !market || home === market) return 1;
        const ids = Transport.pathSegs(world, home, market);
        if (!ids || !ids.length) return 1;
        let f = 1;
        for (const id of ids) {
            const s = Transport.segState(world, Transport.segment(world, id));
            if (s.cl) return 0.6;
            const band = Transport.band(s);
            if (band === 'ruined') f = Math.min(f, 0.85);
            else if (band === 'worn') f = Math.min(f, 0.93);
        }
        return f;
    },

    /** The worst band on the road between two towns: 'good' | 'worn' | 'ruined' | 'closed' | 'canal', or null (no road). */
    linkBand(world, a, b) {
        const st = Transport.state(world);
        const ak = _key(a.q, a.r), bk = _key(b.q, b.r);
        if (st.canals[ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`]) return 'canal';
        const ids = Transport.pathSegs(world, a, b);
        if (!ids) return null;
        let worst = 'good';
        for (const id of ids) {
            const bd = Transport.band(Transport.segState(world, Transport.segment(world, id)));
            if (BAND_IDX[bd] > BAND_IDX[worst]) worst = bd;
        }
        return worst;
    },

    // ── The day ───────────────────────────────────────────

    /**
     * One day of the roads: war hosts grind the road under them; on its
     * weekly turn (staggered) each segment wears, is kept by its realm (the
     * upkeep from the treasury), and its pass, ford and bridge face the
     * weather. Mud and snow re-bake at the turn of the season; the keepers
     * of each road are re-read monthly and the network re-derived every 60
     * days when towns are founded or lost. → { notes: [history records made] }
     */
    tick(world, day = null) {
        const out = { notes: [], upkeep: 0 };
        let rt = Transport.runtime(world);
        if (!rt) return out;
        const st = rt.st;
        day = Number.isFinite(day) ? day : _num(world.day);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        // Towns founded or lost: the network is drawn again
        if (day - _num(st.syncAt, day) >= 60) {
            st.syncAt = day;
            const n = _views(world).length;
            if (n !== rt.towns) rt = Transport.derive(world);
        }
        if (day % 30 === 0) Transport._owners(world, rt);
        const season = Transport._season(day);
        if (season !== st.season) {
            st.season = season;
            for (const seg of rt.segs) {
                const s = Transport.segState(world, seg);
                if (s.cl === 'snow' && season !== 'Winter') s.cl = null;
                if (s.cl === 'flood' && season !== 'Spring') s.cl = null;
                Transport.bake(world, seg, rt);
            }
        }
        if (_off) return out;
        const C = Transport.config();
        // War hosts on the march wear the road under them
        for (const u of world.units || []) {
            if (!u || u.destroyed || !ARMIES.has(u.type)) continue;
            const t = world.getTile(u.q, u.r);
            if (!t || !Number.isInteger(t.roadSeg)) continue;
            const seg = rt.segs[t.roadSeg];
            if (!seg) continue;
            const s = Transport.segState(world, seg);
            const before = Transport.band(s);
            s.c = Math.max(0, _num(s.c) - _num(C.weather.armyDamage, 6));
            if (Transport.band(s) !== before) Transport.bake(world, seg, rt);
        }
        const slot = ((day % 7) + 7) % 7;
        const kAt = new Map();
        for (const seg of rt.segs) {
            if (seg.id % 7 !== slot) continue;
            Transport._week(world, rt, seg, day, season, kAt, out);
        }
        return out;
    },

    /** A realm can keep its roads: treasury above the floor, no missed payment, debt in hand. */
    _canPay(k, cost) {
        const U = Transport.config().upkeep;
        if (!k || k.isAlive === false) return false;
        const f = _obj(k.finance) || {};
        if (_num(f.missed) > 0 || _num(f.debtRatio) > _num(U.maxDebt, 0.8)) return false;
        return _num(k.treasury) - cost >= _num(U.floor, 400);
    },

    _week(world, rt, seg, day, season, kAt, out) {
        const C = Transport.config();
        const st = rt.st;
        const s = Transport.segState(world, seg);
        const T = Transport.tier(s.t);
        const Wt = C.weather;
        const before = { band: Transport.band(s), x: s.x, cl: s.cl };
        const k = seg.kid != null ? _kingdom(world, seg.kid) : null;
        const live = k && k.isAlive !== false ? k : null;
        const atWar = !!(live && Array.isArray(live.wars) && live.wars.length);
        let decay = _num(T.decay);
        if (season === 'Winter') decay += _num(Wt.winterDecay);
        if (season === 'Spring') decay += _num(Wt.springDecay);
        if (atWar) decay += _num(Wt.warDecay);
        let repair = 0;
        if (live) {
            const share = atWar ? _num(C.upkeep.warShare, 0.5) : 1;
            const edict = Math.max(0.1, 1 + Transport.roadCostEffect(live));
            const cost = _r2(_num(T.upkeep) * seg.len * share * edict);
            if (cost > 0 && Transport._canPay(live, cost)) {
                live.treasury = _num(live.treasury) - cost;
                st.stats.upkeep = _r2(_num(st.stats.upkeep) + cost);
                const ks = String(live.id);
                st.realms[ks] = _r2(_num(st.realms[ks]) + cost);
                out.upkeep += cost;
                repair = _num(T.repair) * share;
            }
        } else {
            repair = _num(C.upkeep.freeRepair, 2);
        }
        s.c = _clamp(Math.round((_num(s.c) - decay + repair) * 10) / 10, 0, 100);
        // The weather: passes in snow, fords in flood, bridges washed away
        const seed = Transport.seed(world);
        const week = Math.floor(day / 7);
        const weather = world.weather && typeof world.weather.getWeather === 'function' ? world.weather : null;
        const hex = (i) => Transport.hexOf(world, i);
        if (seg.pass) {
            let snow = false;
            if (season === 'Winter') {
                if (seg.high && Seasons.dayInSeason(day) >= _num(C.passes.deepFrom, 8)) snow = true;
                else if (weather && seg.peak >= 0) {
                    const p = hex(seg.peak);
                    const w = weather.getWeather(p.q, p.r, day);
                    snow = !!(w && (w.type === 'snow' || w.type === 'blizzard'));
                }
            }
            if (snow) s.cl = 'snow';
            else if (s.cl === 'snow') s.cl = null;
        }
        if (seg.rivers.length) {
            const R = C.rivers;
            if (s.x === 'ford' && season === 'Spring' && _roll(`${seed}:flood:${seg.key}:${week}`) < _num(R.floodChance, 0.12)) {
                if (!s.cl) s.cl = 'flood';
            } else if (s.cl === 'flood') s.cl = null;
            if (s.x === 'bridge') {
                let chance = season === 'Spring' ? _num(R.washChance, 0.025) : 0;
                if (weather) {
                    const p = hex(seg.rivers[0]);
                    const w = weather.getWeather(p.q, p.r, day);
                    if (w && w.type === 'storm') chance += _num(R.washStorm, 0.12);
                }
                if (Transport.band(s) !== 'good') chance *= _num(R.washRutted, 2);
                if (chance > 0 && _roll(`${seed}:wash:${seg.key}:${week}`) < chance) {
                    const p = hex(seg.rivers[0]);
                    const ferry = rt.towns && [seg.a, seg.b].some(t => Hex.wrappingDistance(t.q, t.r, p.q, p.r, world.width) <= _num(R.ferryRange, 2));
                    s.x = ferry ? 'ferry' : 'ford';
                    s.wash = day;
                    out.notes.push(Transport.record(world, { kind: 'washout', seg, q: p.q, r: p.r, day, ferry }));
                }
            }
        }
        if (s.cl === 'snow' && before.cl !== 'snow') out.notes.push(Transport.record(world, { kind: 'pass_closed', seg, day }));
        if (s.cl !== before.cl || s.x !== before.x || Transport.band(s) !== before.band) Transport.bake(world, seg, rt);
    },

    /** A player-ruled realm's Royal Road-Building edict (kingdom.crown.effects.roadCost, as KingdomBonuses.crownEffect reads it). */
    roadCostEffect(k) {
        const fx = k && k.crown && k.crown.effects;
        return fx && typeof fx.roadCost === 'number' && Number.isFinite(fx.roadCost) ? fx.roadCost : 0;
    },

    // ── Changes from the works ────────────────────────────

    /** Set a segment's tier / condition / crossing / toll and re-bake it. */
    setSegment(world, seg, fields = {}) {
        const s = Transport.segState(world, seg);
        if (fields.t && Transport.config().tiers[fields.t]) s.t = fields.t;
        if (Number.isFinite(fields.c)) s.c = _clamp(fields.c, 0, 100);
        if (fields.x !== undefined && seg.rivers.length) s.x = fields.x;
        if (fields.toll !== undefined) s.toll = fields.toll || null;
        if (fields.cl !== undefined) s.cl = fields.cl || null;
        Transport.bake(world, seg);
        return s;
    },

    // ── News ──────────────────────────────────────────────

    /** Keep a record for the heralds and the chatter: { key, kind, day, q, r, place, other, kingdomId, ... }. */
    record(world, e) {
        const st = Transport.state(world);
        const seg = e.seg || null;
        const a = seg ? seg.a : null, b = seg ? seg.b : null;
        const mid = seg && seg.path.length ? Transport.hexOf(world, seg.path[Math.floor(seg.path.length / 2)]) : (a || { q: e.q, r: e.r });
        const rec = {
            key: `tr:${e.kind}:${seg ? seg.key : (e.place || '')}:${_num(e.day)}`,
            kind: e.kind, day: _num(e.day),
            q: Number.isFinite(e.q) ? e.q : mid.q, r: Number.isFinite(e.r) ? e.r : mid.r,
            place: e.place || (a && a.s ? a.s.name : 'the town'), other: e.other || (b && b.s ? b.s.name : 'the next town'),
            kingdomId: e.kingdomId !== undefined ? e.kingdomId : (seg ? seg.kid : null),
            own: !!e.own, ferry: !!e.ferry, work: e.work || null,
        };
        st.history.push(rec);
        const cap = _num(Transport.config().news.cap, 40);
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
        return rec;
    },

    recent(world, days = 30) {
        const st = _obj(world && world.transport);
        const day = _num(world && world.day);
        return st && Array.isArray(st.history) ? st.history.filter(h => h && day - _num(h.day) <= days) : [];
    },

    /** What townsfolk say of the roads near a town (Chatter's `roads` condition): kinds. */
    talk(world, settlement) {
        if (!world || !settlement || !_obj(world.transport)) return [];
        const C = Transport.config();
        const range = _num(C.news.chatterRange, 6);
        const out = new Set();
        const day = _num(world.day);
        for (const seg of Transport.segmentsOf(world, settlement.q, settlement.r)) {
            const s = Transport.segState(world, seg);
            const band = Transport.band(s);
            if (s.cl === 'snow') out.add('pass_closed');
            if (s.cl === 'flood') out.add('flood');
            if (band === 'ruined') out.add('ruined');
            if (band === 'worn') out.add('rutted');
            if (s.x === 'ferry' || s.x === 'ford') out.add(s.wash ? 'washed_out' : 'ford');
            if (s.t === 'highway' && band === 'good') out.add('highway');
            if (s.toll) out.add('toll');
            if (Transport._season(day) === 'Spring' && (s.t === 'track' || band !== 'good')) out.add('mud');
        }
        const st = world.transport;
        for (const k of Object.keys(st.canals || {})) if (k.split('|').includes(_key(settlement.q, settlement.r))) out.add('canal');
        for (const w of st.works || []) {
            if (!w || w.status !== 'building') continue;
            if (Math.abs(_num(w.q) - settlement.q) <= range && Math.abs(_num(w.r) - settlement.r) <= range
                && Hex.wrappingDistance(w.q, w.r, settlement.q, settlement.r, world.width) <= range) out.add('works');
        }
        return [...out];
    },

    // ── Labour ────────────────────────────────────────────

    /** Land hands the works under way hire in the town at (q, r) (systems/labour.js adds them to its jobs). */
    handsAt(world, q, r) {
        const st = _obj(world && world.transport);
        if (!st || !Array.isArray(st.works)) return 0;
        let n = 0;
        for (const w of st.works) if (w && w.status === 'building' && w.tq === q && w.tr === r) n += _num(w.hands);
        return n;
    },

    // ── Measuring ─────────────────────────────────────────

    /**
     * Price dispersion over trade links: the mean |ln(scarcity_a / scarcity_b)|
     * over the goods both towns stock, averaged over the links in each class
     * ('good' roads, 'poor' = worn/ruined/closed roads or open country,
     * 'sea'). `scarcity(s, goodId)` is passed in (world/settlementMarket.js).
     */
    dispersion(world, links, goodIds, scarcity) {
        const acc = { good: [0, 0], poor: [0, 0], sea: [0, 0], all: [0, 0] };
        for (const l of links || []) {
            if (!l || !l.a || !l.b || !l.a.market || !l.b.market) continue;
            let cls;
            if (l.sea) cls = 'sea';
            else if (!l.road) cls = 'poor';
            else {
                const bd = Transport.linkBand(world, l.a, l.b);
                cls = bd === 'good' || bd === 'canal' || bd === null ? 'good' : 'poor';
            }
            let sum = 0, n = 0;
            for (const g of goodIds) {
                const x = scarcity(l.a, g), y = scarcity(l.b, g);
                if (!(x > 0) || !(y > 0)) continue;
                sum += Math.abs(Math.log(x / y));
                n++;
            }
            if (!n) continue;
            acc[cls][0] += sum / n; acc[cls][1]++;
            acc.all[0] += sum / n; acc.all[1]++;
        }
        const out = {};
        for (const [k, [s, n]] of Object.entries(acc)) out[k] = { mean: n ? Math.round(s / n * 10000) / 10000 : null, links: n };
        return out;
    },
};
