// ============================================
// ROMANCE — the townsfolk flirt, court and fall in love
// ============================================
// Every town with a roster (systems/townsfolk.js) keeps its courtships on
// `folk.romance` (saved with the tile, like the roster). A step every
// `stepDays` (the town's seasons interleave with them, so a long absence
// replays the same story):
//
//   noticing → flirting → courting → in love → betrothed → wed
//
// A single grown townsperson notices someone they are drawn to — attraction
// from age, temper, station, tongue, work and neighbourhood, old grudges and
// a spark of their own (`score`), and whom they could love at all
// (`leaning`: most folk the other sex, a few their own, a few either). Each
// stage advances or fails by its odds (data/romance.json → stages) and the
// courtship's warmth (`heat`): rejected, cooled, parted, jilted. A family may
// forbid a match (a gap in station, a feud between the houses): it is broken
// off, the family relents, or now and then the pair elope. A rival suitor can
// steal a heart; a lovers' quarrel cools things; death ends it. The wedding is
// the townsfolk wedding (Townsfolk._wed): the spouse is real.
//
// The married mostly don't court — but now and then an affair begins, and
// when it is found out it is the town's scandal (annals) and leaves grudges
// (`folk.romance.grudges`, and each person's log 'rivalInLove'/'betrayed' —
// the shared hook for the fights between townsfolk to read).
//
// The heartbroken work less and the lovestruck a little more (`mood`, read by
// the seasons' practised skills and a trader's prices). The player can ask
// who is sweet on whom, carry a love letter or put in a good word (the match
// warms, both think the better of them), meddle with a tale, or court one of
// a pair themselves — and the other suitor resents them.
//
// Every roll is a hash of the world seed, the town, the day and the step —
// never the shared RNG. Lines and odds: data/romance.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from './townsfolk.js';

const DEFAULTS = {
    enabled: true,
    stepDays: 10,
    maxAge: 55,
    outsiderShare: 0.6,
    leaning: { same: 0.06, both: 0.05 },
    notice: { perStep: 0.09, minScore: 0.36, maxShare: 0.7, pick: 3 },
    seed: { share: 0.3, stages: { noticing: 2, flirting: 3, courting: 3, love: 2, betrothed: 1 } },
    stages: {
        noticing: { next: 'flirting', advance: 0.42, fail: 0.2, minDays: 10, fails: 'rejected' },
        flirting: { next: 'courting', advance: 0.36, fail: 0.15, minDays: 10, fails: 'cooled' },
        courting: { next: 'love', advance: 0.27, fail: 0.08, minDays: 20, fails: 'parted' },
        love: { next: 'betrothed', advance: 0.24, fail: 0.04, minDays: 20, fails: 'parted' },
        betrothed: { next: 'wed', fail: 0.03, fails: 'jilted' },
    },
    betrothalDays: 30,
    heat: { start: 30, perStep: 3, max: 100, goodWord: 15, token: 25, meddle: -35, quarrel: -12 },
    score: {
        base: 0.36, ageFree: 4, agePerYear: 0.035, ageMax: 16, youngMax: 7, youngUnder: 21,
        sameTemper: 0.05, temperPairs: {}, station: { 0: 0.08, 1: 0, 2: -0.16, 3: -0.26 },
        culture: -0.08, sameWork: 0.08, neighbours: { share: 0.2, bonus: 0.07 }, spark: 0.16,
        foes: { brawl: -0.3, robbed: -0.4, pickpocketed: -0.3, rivalInLove: -0.25, betrayed: -0.4 },
        pastParted: -0.18,
    },
    station: { noble: 3, merchant: 2, priest: 2, guard: 1, blacksmith_npc: 1, farmer: 1, villager: 1, child: 1, beggar: 0 },
    forbid: { stationGap: 2, stationChance: 0.6, stepDownChance: 0.3, feudChance: 0.7, feudHeat: 30, relent: 0.08, breakOff: 0.12, elope: 0.06, elopeInLove: 0.12 },
    rival: { chance: 0.045, minScore: 0.42 },
    quarrel: { chance: 0.12, days: 3 },
    affair: { chance: 0.0012, minScore: 0.52, marriedDays: 120, foundOut: 0.12, ends: 0.08 },
    heartbreak: { days: 60, lightDays: 15 },
    mood: { loveWork: 1.1, brokenWork: 0.75, loveDiscount: 0.04, brokenMarkup: 0.03 },
    player: { tokenDays: 20, wordEveryDays: 10, meddleCaught: 0.3, meddleBreak: 0.45, rivalAffection: 20, regard: 6, rivalResent: 15 },
    onMap: {},
    lines: {},
    annals: {},
};

const ORDER = ['noticing', 'flirting', 'courting', 'love', 'betrothed'];
const ROMANCE_KINDS = ['betrothed', 'jilted', 'forbidden', 'eloped', 'affair', 'rivalWon'];
const MAX_PAST = 60;
const MAX_GRUDGES = 20;

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _seed(world) { return (world && world.generationParams && world.generationParams.seed) || 1; }

/** A hash of the parts → [0, 1). */
function _h(...parts) {
    return ((Utils.hashStr(parts.join('|')) >>> 0) % 1000003) / 1000003;
}

/** A deterministic stream for one town on one step. */
function _rng(world, folk, day, salt = '') {
    let s = (Utils.hashStr(`${_seed(world)}|${folk.q},${folk.r}|${day}|love${salt}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _pronoun(p, kind = 'subj') {
    const f = p && p.gender === 'female';
    return { subj: f ? 'she' : 'he', obj: f ? 'her' : 'him', pos: f ? 'her' : 'his' }[kind];
}

export const Romance = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.romance : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            for (const k of ['leaning', 'notice', 'seed', 'heat', 'score', 'station', 'forbid', 'rival', 'quarrel', 'affair', 'heartbreak', 'mood', 'player', 'onMap', 'lines', 'annals']) {
                _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            _cfg.stages = { ...DEFAULTS.stages };
            for (const [k, v] of Object.entries(_obj(d.stages) || {})) _cfg.stages[k] = { ...(DEFAULTS.stages[k] || {}), ...(_obj(v) || {}) };
            _cfg.score.neighbours = { ...DEFAULTS.score.neighbours, ...(_obj(_cfg.score.neighbours) || {}) };
            _cfg.score.foes = { ...DEFAULTS.score.foes, ...(_obj(_cfg.score.foes) || {}) };
        }
        return _cfg;
    },

    STAGES: ORDER,

    // ──────────── THE TOWN'S BOOK OF HEARTS ────────────

    /**
     * The town's courtships, made on first asking: { v, n, tick, list, past,
     * grudges }. With a world, a town that had none (a new roster, an old
     * save) starts with a few courtships already under way.
     */
    state(folk, world = null, day = null) {
        if (!folk) return null;
        let rm = folk.romance;
        if (!_obj(rm) || !Array.isArray(rm.list)) {
            const C = Romance.config();
            const at = _num(day, _num(world && world.day, _num(folk.tick, 0)));
            rm = folk.romance = { v: 1, n: 0, tick: at - (((at % C.stepDays) + C.stepDays) % C.stepDays), list: [], past: [], grudges: [] };
            if (world) Romance._seedTown(world, folk, rm.tick);
        }
        if (!Array.isArray(rm.past)) rm.past = [];
        if (!Array.isArray(rm.grudges)) rm.grudges = [];
        return rm;
    },

    /** The courtship a person is in (not an affair, unless that is all there is), or null. */
    courtOf(folk, pid, opts = {}) {
        const rm = folk && folk.romance;
        if (!rm || !Array.isArray(rm.list) || pid == null) return null;
        const mine = rm.list.filter(c => c.a === pid || c.b === pid);
        if (!mine.length) return null;
        if (opts.affair) return mine.find(c => c.affair) || null;
        return mine.find(c => !c.affair) || (opts.anyKind ? mine[0] : null);
    },

    /** The other one in a courtship. */
    partnerId(c, pid) { return c ? (c.a === pid ? c.b : c.a) : null; },

    stageIndex(st) { return ORDER.indexOf(st); },

    // ──────────── WHO COULD LOVE WHOM ────────────

    /** 'opposite' | 'same' | 'both' — whom a person could love; a hash of who they are, never stored. */
    leaning(world, folk, p) {
        if (!p) return 'opposite';
        const L = Romance.config().leaning;
        const u = _h(_seed(world), folk.q, folk.r, p.id, p.born, 'lean');
        let lean = u < _num(L.same) ? 'same' : u < _num(L.same) + _num(L.both) ? 'both' : 'opposite';
        if (lean === 'same') {
            // Wed before to the other sex: drawn to both, then
            const sp = Townsfolk.get(folk, p.spouse);
            const wedLog = (p.log || []).some(e => (e.k === 'wed' || e.k === 'widowed') && (Townsfolk.get(folk, e.o) || {}).gender && (Townsfolk.get(folk, e.o) || {}).gender !== p.gender);
            if ((sp && sp.gender !== p.gender) || wedLog) lean = 'both';
        }
        return lean;
    },

    /** Could these two love each other at all (each by their own leaning)? */
    compatible(world, folk, a, b) {
        if (!a || !b || a === b) return false;
        const same = a.gender === b.gender;
        const ok = p => { const l = Romance.leaning(world, folk, p); return l === 'both' || (same ? l === 'same' : l === 'opposite'); };
        return ok(a) && ok(b);
    },

    /** A person's station: 3 noble … 0 beggar. */
    station(p) {
        const S = Romance.config().station;
        const role = p && (p.retired || p.role);
        return _num(S[role], 1);
    },

    _kin(folk, p) {
        const kin = new Set([...(p.parents || []), ...(p.kids || [])]);
        for (const s of Townsfolk.siblings(folk, p)) kin.add(s.id);
        for (const pid of p.parents || []) {
            const par = Townsfolk.get(folk, pid);
            if (par) for (const s of Townsfolk.siblings(folk, par)) for (const k of s.kids || []) kin.add(k); // cousins
        }
        return kin;
    },

    /** Free to court: grown, at home, unwed, not a priest, not wed into a House. */
    eligible(folk, p, day) {
        if (!Townsfolk.isHere(p) || p.wedHouse || p.role === 'priest' || p.role === 'child') return false;
        const M = Townsfolk.config().marriage;
        const age = Townsfolk.age(p, day);
        if (age < _num(M.minAge, 17) || age > _num(Romance.config().maxAge, 55)) return false;
        const sp = Townsfolk.get(folk, p.spouse);
        return !sp || sp.died != null;
    },

    /** Heartbroken still (no new love yet)? */
    broken(folk, p, day) {
        return !!(p && p.heart && p.heart.k === 'broken' && _num(day) < _num(p.heart.u));
    },

    /**
     * How drawn `a` and `b` are to each other: { score 0..1, parts }. Age,
     * temper, station, tongue, work, neighbours, old grudges and a spark.
     */
    score(world, folk, a, b, day) {
        const S = Romance.config().score;
        const parts = {};
        if (!Romance.compatible(world, folk, a, b)) return { score: 0, parts: { leaning: -1 } };
        let s = _num(S.base, 0.36);
        const ageA = Townsfolk.age(a, day);
        const ageB = Townsfolk.age(b, day);
        const gap = Math.abs(ageA - ageB);
        const max = Math.min(ageA, ageB) < _num(S.youngUnder, 21) ? _num(S.youngMax, 7) : _num(S.ageMax, 16);
        if (gap > max) return { score: 0, parts: { age: -1 } };
        parts.age = -Math.max(0, gap - _num(S.ageFree, 4)) * _num(S.agePerYear, 0.035);
        // Tempers
        let temper = 0;
        const P = _obj(S.temperPairs) || {};
        for (const x of a.traits || []) {
            for (const y of b.traits || []) {
                if (x === y) temper += _num(S.sameTemper);
                temper += _num(P[`${x}|${y}`], _num(P[`${y}|${x}`]));
            }
        }
        parts.temper = temper;
        // Station: a lord's son and a beggar is unlikely (but the town would talk)
        const sg = Math.min(3, Math.abs(Romance.station(a) - Romance.station(b)));
        parts.station = _num((S.station || {})[sg], sg >= 3 ? -0.26 : 0);
        // Tongue: one of another people
        const ca = a.culture || folk.culture;
        const cb = b.culture || folk.culture;
        if (ca && cb && ca !== cb) parts.culture = _num(S.culture);
        // Work side by side, live next door
        const ra = a.retired || a.role;
        if (ra === (b.retired || b.role) && ra !== 'villager') parts.work = _num(S.sameWork);
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (_h(_seed(world), folk.q, folk.r, pairKey, 'near') < _num(S.neighbours.share)) parts.near = _num(S.neighbours.bonus);
        // Bad blood between them
        let foe = 0;
        const F = S.foes || {};
        for (const e of a.log || []) if (e.o === b.id && F[e.k] != null) foe = Math.min(foe, _num(F[e.k]));
        for (const e of b.log || []) if (e.o === a.id && F[e.k] != null) foe = Math.min(foe, _num(F[e.k]));
        const rm = folk.romance;
        if (rm && Array.isArray(rm.past) && rm.past.some(x => ((x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id)) && x.end !== 'cooled')) foe = Math.min(foe, _num(S.pastParted));
        if (foe) parts.foe = foe;
        // ...and something that can't be put in words
        parts.spark = (_h(_seed(world), folk.q, folk.r, pairKey, 'spark') - 0.5) * 2 * _num(S.spark);
        for (const v of Object.values(parts)) s += v;
        return { score: _clamp(s, 0, 1), parts };
    },

    // ──────────── THE STEPS ────────────

    /** Live every step of the town's courtships up to `upTo` (a step lands on days divisible by stepDays). */
    catchUp(world, settlement, folk, upTo, news = [], player = null) {
        const C = Romance.config();
        if (!C.enabled || !folk || !Array.isArray(folk.people)) return news;
        // (a town that had none starts from its roster's last reckoned season, so the story is the same lived daily or caught up)
        const rm = Romance.state(folk, world, _num(folk.tick, upTo));
        let guard = 0;
        while (rm.tick + C.stepDays <= upTo && guard++ < 1500) {
            rm.tick += C.stepDays;
            Romance._step(world, settlement, folk, rm.tick, news, player);
        }
        return news;
    },

    _towns(world, folk) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        return views.filter(s => s && s.name && !(s.q === folk.q && s.r === folk.r) && s.folk !== folk).map(s => s.name);
    },

    _annal(folk, world, day, entry, news) {
        Townsfolk._annal(folk, world, day, entry, news);
    },

    _grudge(rm, a, b, why, day) {
        rm.grudges.push({ a, b, why, d: day });
        if (rm.grudges.length > MAX_GRUDGES) rm.grudges.splice(0, rm.grudges.length - MAX_GRUDGES);
    },

    /** A broken heart for `days` (a light one leaves no mark in their life's story). */
    _break(p, o, day, days, why, light = false) {
        if (!p || p.died != null) return;
        const until = day + days;
        p.heart = { k: 'broken', o, d: day, u: Math.max(until, p.heart && p.heart.k === 'broken' ? _num(p.heart.u) : 0) };
        if (!light) Townsfolk._log(p, day, 'heartbroken', o, why);
    },

    /** End a courtship: into the past, with the hearts it breaks. */
    _end(world, folk, c, end, day, news, opts = {}) {
        const rm = folk.romance;
        const C = Romance.config();
        rm.list = rm.list.filter(x => x !== c);
        const past = { a: c.a, b: c.b, st: c.st, end, d: day };
        if (c.affair) past.affair = true;
        if (opts.by != null) past.by = opts.by;
        rm.past.push(past);
        if (rm.past.length > MAX_PAST) rm.past.splice(0, rm.past.length - MAX_PAST);
        const A = Townsfolk.get(folk, c.a);
        const B = Townsfolk.get(folk, c.b);
        const H = C.heartbreak;
        const deep = Romance.stageIndex(c.st) >= 2;
        const full = _num(H.days, 60);
        const light = _num(H.lightDays, 15);
        switch (end) {
            case 'rejected': Romance._break(A, c.b, day, light, end, true); break;
            case 'parted':
                if (deep) { Romance._break(A, c.b, day, full, end); Romance._break(B, c.a, day, full, end); }
                else { Romance._break(A, c.b, day, light, end, true); Romance._break(B, c.a, day, light, end, true); }
                break;
            case 'jilted': {
                const jilted = opts.by === c.a ? B : A;
                const jilter = jilted === A ? B : A;
                Romance._break(jilted, jilter && jilter.id, day, full * 1.5, end);
                if (jilter) Romance._annal(folk, world, day, { k: 'jilted', a: jilter.id, b: jilted.id }, news);
                break;
            }
            case 'forbidden':
                Romance._break(A, c.b, day, full, end);
                Romance._break(B, c.a, day, full, end);
                Romance._annal(folk, world, day, { k: 'forbidden', a: c.forbid && c.forbid.by != null ? c.forbid.by : c.a, b: c.forbid && c.forbid.by === c.b ? c.a : c.b, x: c.forbid ? c.forbid.why : null }, news);
                break;
            case 'death': {
                const living = A && A.died == null ? A : B && B.died == null ? B : null;
                const dead = living === A ? B : A;
                if (living && dead && Romance.stageIndex(c.st) >= 1) {
                    if (deep) Romance._break(living, dead.id, day, full * 1.5, 'death');
                    else Romance._break(living, dead.id, day, light, 'death', true);
                }
                break;
            }
            case 'gone':
            case 'wedOther': {
                const left = opts.by != null ? (opts.by === c.a ? B : A) : null;
                if (left && Townsfolk.isHere(left) && deep) Romance._break(left, opts.by, day, full, end === 'wedOther' ? 'jilted' : 'gone');
                break;
            }
            case 'rivalWon': {
                const lost = opts.by != null ? (opts.by === c.a ? B : A) : null;
                if (lost) Romance._break(lost, opts.by, day, deep ? full : light, 'rival', !deep);
                break;
            }
            default: break;
        }
        return past;
    },

    _newCourt(rm, a, b, st, day, heat) {
        const c = { id: rm.n++, a: a.id, b: b.id, st, d: day, sd: day, heat: Math.round(_clamp(heat, 0, 100)) };
        rm.list.push(c);
        return c;
    },

    /** A town that had no book of hearts: a few courtships already under way. */
    _seedTown(world, folk, day) {
        const C = Romance.config();
        const rm = folk.romance;
        const rng = _rng(world, folk, day, 'seed');
        const free = Townsfolk.residents(folk).filter(p => Romance.eligible(folk, p, day));
        for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
        const want = Math.floor(free.length * _num(C.seed.share, 0.3) / 2 + rng());
        const busy = new Set();
        for (const a of free) {
            if (rm.list.length >= want) break;
            if (busy.has(a.id)) continue;
            const b = Romance._bestFor(world, folk, a, free.filter(o => !busy.has(o.id)), day, rng);
            if (!b) continue;
            const st = Romance._weighted(C.seed.stages, rng) || 'flirting';
            const sc = Romance.score(world, folk, a, b, day).score;
            const c = Romance._newCourt(rm, a, b, st, day - Math.floor(rng() * 40), _num(C.heat.start) * sc + Romance.stageIndex(st) * 8);
            c.sd = day - Math.floor(rng() * 15);
            if (st === 'betrothed') c.wedDay = Romance._wedDayFrom(day - Math.floor(rng() * 15));
            else if (Romance.stageIndex(st) >= 2) Romance._maybeForbid(world, folk, c, day, rng);
            busy.add(a.id);
            busy.add(b.id);
        }
    },

    _weighted(weights, rng) {
        const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
        const total = entries.reduce((t, [, w]) => t + w, 0);
        let roll = rng() * total;
        for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
        return entries.length ? entries[entries.length - 1][0] : null;
    },

    _wedDayFrom(day) {
        const C = Romance.config();
        const d = day + _num(C.betrothalDays, 30);
        return Math.ceil(d / C.stepDays) * C.stepDays;
    },

    /** The one `a` is most drawn to among `pool` (weighted among the best few), or null. */
    _bestFor(world, folk, a, pool, day, rng, minScore = null) {
        const N = Romance.config().notice;
        const min = minScore != null ? minScore : _num(N.minScore, 0.36);
        const kin = Romance._kin(folk, a);
        const scored = [];
        for (const b of pool) {
            if (b === a || kin.has(b.id)) continue;
            const s = Romance.score(world, folk, a, b, day).score;
            if (s >= min) scored.push({ b, s });
        }
        if (!scored.length) return null;
        scored.sort((x, y) => y.s - x.s || x.b.id - y.b.id);
        const top = scored.slice(0, Math.max(1, _num(N.pick, 3)));
        let roll = rng() * top.reduce((t, x) => t + x.s, 0);
        for (const x of top) { roll -= x.s; if (roll <= 0) return x.b; }
        return top[0].b;
    },

    /** One step of a town's love life. */
    _step(world, settlement, folk, day, news, player) {
        const C = Romance.config();
        const rm = Romance.state(folk, world, day);
        const rng = _rng(world, folk, day);
        const get = id => Townsfolk.get(folk, id);

        // Ended by death, departure or another's wedding
        for (const c of rm.list.slice()) {
            const A = get(c.a);
            const B = get(c.b);
            if (!A || !B || A.died != null || B.died != null) { Romance._end(world, folk, c, 'death', day, news); continue; }
            const goneA = !Townsfolk.isHere(A) || A.wedHouse;
            const goneB = !Townsfolk.isHere(B) || B.wedHouse;
            if (goneA || goneB) { Romance._end(world, folk, c, 'gone', day, news, { by: goneA ? c.a : c.b }); continue; }
            if (c.affair) {
                // An affair ends when no one is wed any more
                const spA = get(A.spouse);
                const spB = get(B.spouse);
                if (!(spA && spA.died == null) && !(spB && spB.died == null)) Romance._end(world, folk, c, 'affairEnded', day, news);
                continue;
            }
            const spA = get(A.spouse);
            const spB = get(B.spouse);
            if ((spA && spA.died == null && spA.id !== B.id) || (spB && spB.died == null && spB.id !== A.id)) {
                Romance._end(world, folk, c, 'wedOther', day, news, { by: spA && spA.died == null ? c.a : c.b });
            }
        }

        // The player courting one of a pair: the other suitor resents them
        Romance._playerSuit(world, folk, day, player);

        // Each courtship moves on, or doesn't
        for (const c of rm.list.slice()) {
            if (!rm.list.includes(c)) continue;
            if (c.affair) Romance._affairStep(world, folk, c, day, rng, news);
            else Romance._advance(world, settlement, folk, c, day, rng, news);
        }

        // The married mostly don't — but now and then
        Romance._affairs(world, folk, day, rng);

        // Someone new catches an eye
        const free = Townsfolk.residents(folk).filter(p => Romance.eligible(folk, p, day));
        const busy = new Set();
        for (const c of rm.list) { busy.add(c.a); busy.add(c.b); }
        const open = free.filter(p => !busy.has(p.id) && !Romance.broken(folk, p, day));
        const N = C.notice;
        const active = rm.list.filter(c => !c.affair).length;
        if (active * 2 < free.length * _num(N.maxShare, 0.6)) {
            for (const a of open) {
                if (busy.has(a.id) || rng() >= _num(N.perStep, 0.075)) continue;
                const b = Romance._bestFor(world, folk, a, open.filter(o => !busy.has(o.id)), day, rng);
                if (!b) continue;
                const sc = Romance.score(world, folk, a, b, day).score;
                Romance._newCourt(rm, a, b, 'noticing', day, _num(C.heat.start) * sc);
                busy.add(a.id);
                busy.add(b.id);
            }
        }
    },

    _advance(world, settlement, folk, c, day, rng, news) {
        const C = Romance.config();
        const S = C.stages[c.st];
        if (!S) return;
        const A = Townsfolk.get(folk, c.a);
        const B = Townsfolk.get(folk, c.b);
        c.heat = Math.round(_clamp(_num(c.heat) + _num(C.heat.perStep), 0, _num(C.heat.max, 100)));
        const sc = Romance.score(world, folk, A, B, day).score;
        const idx = Romance.stageIndex(c.st);

        // A rival suitor: settled now, or one appears
        if (c.rival) {
            if (Romance._settleRival(world, folk, c, day, rng, news)) return;
        } else if (idx >= 1 && idx <= 2 && rng() < _num(C.rival.chance)) {
            Romance._findRival(world, folk, c, day, rng);
        }

        // A lovers' quarrel
        if (idx >= 2 && idx <= 3 && rng() < _num(C.quarrel.chance)) {
            c.quarrel = day;
            c.heat = Math.round(_clamp(c.heat + _num(C.heat.quarrel), 0, 100));
            if (rng() < 0.12) { Romance._end(world, folk, c, 'parted', day, news); return; }
        }

        // The family won't have it
        if (c.forbid) {
            const F = C.forbid;
            const u = rng();
            const elope = idx >= 3 ? _num(F.elopeInLove) : idx >= 2 ? _num(F.elope) : 0;
            if (u < _num(F.relent)) { c.forbid = null; }
            else if (u < _num(F.relent) + _num(F.breakOff)) { Romance._end(world, folk, c, 'forbidden', day, news); return; }
            else if (u < _num(F.relent) + _num(F.breakOff) + elope) { Romance._elope(world, folk, c, day, rng, news); return; }
        }

        // The wedding day
        if (S.next === 'wed') {
            if (day >= _num(c.wedDay, day)) {
                if (c.forbid) return; // (not till they relent — or run off)
                Townsfolk._wed(folk, A, B, day);
                Romance._annal(folk, world, day, { k: 'wed', a: A.id, b: B.id }, news);
                Romance._end(world, folk, c, 'wed', day, news);
                return;
            }
            if (rng() < _num(S.fail) * (1.4 - sc)) {
                // Cold feet: the one less drawn breaks it off
                const by = _h(_seed(world), folk.q, folk.r, c.id, day, 'jilt') < 0.5 ? c.a : c.b;
                Romance._end(world, folk, c, 'jilted', day, news, { by });
            }
            return;
        }
        if (day - _num(c.sd) < _num(S.minDays, 10)) return;
        let pAdv = _num(S.advance) * (0.4 + sc) * (1 + c.heat / 150);
        const pFail = _num(S.fail) * (1.6 - sc) * Math.max(0.3, 1 - c.heat / 150);
        if (c.forbid) pAdv *= 0.5;
        if (c.rival) pAdv *= 0.6;
        const u = rng();
        if (u < pAdv) {
            if (S.next === 'betrothed' && c.forbid) return; // (no banns while the family forbids it)
            Romance._toStage(world, folk, c, S.next, day, rng, news, settlement);
        } else if (u < pAdv + pFail) {
            Romance._end(world, folk, c, S.fails || 'parted', day, news);
        }
    },

    _toStage(world, folk, c, st, day, rng, news, settlement = null) {
        c.st = st;
        c.sd = day;
        const A = Townsfolk.get(folk, c.a);
        const B = Townsfolk.get(folk, c.b);
        if (A && A.heart) delete A.heart;
        if (B && B.heart) delete B.heart;
        if (st === 'courting') {
            Townsfolk._log(A, day, 'courting', B.id);
            Townsfolk._log(B, day, 'courting', A.id);
            Romance._maybeForbid(world, folk, c, day, rng, settlement);
        } else if (st === 'betrothed') {
            c.wedDay = Romance._wedDayFrom(day);
            Townsfolk._log(A, day, 'betrothed', B.id);
            Townsfolk._log(B, day, 'betrothed', A.id);
            Romance._annal(folk, world, day, { k: 'betrothed', a: A.id, b: B.id, x: c.wedDay }, news);
        }
    },

    /** A family forbids it: the higher-born's people, by the gap in station, or a feud between the houses. */
    _maybeForbid(world, folk, c, day, rng, settlement = null) {
        const F = Romance.config().forbid;
        const A = Townsfolk.get(folk, c.a);
        const B = Townsfolk.get(folk, c.b);
        const living = p => (p.parents || []).map(id => Townsfolk.get(folk, id)).filter(x => x && x.died == null);
        const gap = Romance.station(A) - Romance.station(B);
        if (gap !== 0) {
            const high = gap > 0 ? A : B;
            // (a wide gap mostly; now and then a family thinks even a step down beneath them)
            const chance = Math.abs(gap) >= _num(F.stationGap, 2) ? _num(F.stationChance) : _num(F.stepDownChance, 0.1);
            if ((living(high).length || high.role === 'noble') && rng() < chance) { c.forbid = { why: 'station', by: high.id }; return; }
        }
        // A feud between the two families: a beating, a robbery, a rivalry between their elders —
        // or a grudge the town's fights keep between them (settlement.brawls.feuds, systems/brawls.js; read only)
        const pa = living(A);
        const pb = living(B);
        const bad = ['brawl', 'robbed', 'pickpocketed', 'rivalInLove', 'betrayed'];
        const st = settlement && settlement.brawls && _obj(settlement.brawls.feuds) ? Object.values(settlement.brawls.feuds) : [];
        const feuding = (x, y) => st.some(f => f && _num(f.heat) >= _num(F.feudHeat, 30) && ((f.a === x.id && f.b === y.id) || (f.a === y.id && f.b === x.id)));
        for (const x of pa) {
            for (const y of pb) {
                const feud = (x.log || []).some(e => e.o === y.id && bad.includes(e.k)) || (y.log || []).some(e => e.o === x.id && bad.includes(e.k)) || feuding(x, y);
                if (feud && rng() < _num(F.feudChance)) { c.forbid = { why: 'feud', by: A.id }; return; }
            }
        }
    },

    _elope(world, folk, c, day, rng, news) {
        const A = Townsfolk.get(folk, c.a);
        const B = Townsfolk.get(folk, c.b);
        const towns = Romance._towns(world, folk);
        const to = towns.length ? towns[Math.floor(rng() * towns.length)] : 'parts unknown';
        Townsfolk._wed(folk, A, B, day, true);
        for (const [p, o] of [[A, B], [B, A]]) {
            p.away = { d: day, to, eloped: true };
            Townsfolk._log(p, day, 'eloped', o.id, to);
            for (const pid of p.parents || []) { const par = Townsfolk.get(folk, pid); if (par && par.died == null) Townsfolk._log(par, day, 'kidEloped', p.id, to); }
        }
        Romance._annal(folk, world, day, { k: 'eloped', a: A.id, b: B.id, x: to }, news);
        Romance._end(world, folk, c, 'eloped', day, news);
    },

    _findRival(world, folk, c, day, rng) {
        const C = Romance.config();
        const target = Townsfolk.get(folk, rng() < 0.5 ? c.a : c.b);
        const partner = Townsfolk.get(folk, Romance.partnerId(c, target.id));
        const rm = folk.romance;
        const busy = new Set();
        for (const x of rm.list) { busy.add(x.a); busy.add(x.b); }
        const pool = Townsfolk.residents(folk).filter(p => !busy.has(p.id) && Romance.eligible(folk, p, day) && !Romance.broken(folk, p, day));
        const rival = Romance._bestFor(world, folk, target, pool, day, rng, _num(C.rival.minScore, 0.42));
        if (!rival) return;
        c.rival = { p: rival.id, of: target.id, d: day };
        // Bad blood between the two suitors (the shared hook for the fights between townsfolk)
        Townsfolk._log(rival, day, 'rivalInLove', partner.id, target.first);
        Townsfolk._log(partner, day, 'rivalInLove', rival.id, target.first);
        Romance._grudge(rm, partner.id, rival.id, 'rivalSuitor', day);
    },

    /** The rival's suit decided: true when the courtship ended. */
    _settleRival(world, folk, c, day, rng, news) {
        const r = c.rival;
        if (day - _num(r.d) < 10) return false;
        const target = Townsfolk.get(folk, r.of);
        const rival = Townsfolk.get(folk, r.p);
        const partner = Townsfolk.get(folk, Romance.partnerId(c, r.of));
        c.rival = null;
        if (!rival || !Romance.eligible(folk, rival, day) || Romance.courtOf(folk, rival.id)) return false;
        const sRival = Romance.score(world, folk, target, rival, day).score + rng() * 0.3;
        const sPartner = Romance.score(world, folk, target, partner, day).score + _num(c.heat) / 200 + rng() * 0.3;
        if (sRival > sPartner) {
            Romance._end(world, folk, c, 'rivalWon', day, news, { by: target.id });
            Romance._annal(folk, world, day, { k: 'rivalWon', a: partner.id, b: target.id, x: String(rival.id) }, news);
            const rm = folk.romance;
            const nc = Romance._newCourt(rm, rival, target, 'flirting', day, Romance.config().heat.start);
            nc.sd = day;
            return true;
        }
        Romance._break(rival, target.id, day, _num(Romance.config().heartbreak.lightDays, 15), 'rival', true);
        c.heat = Math.round(_clamp(_num(c.heat) + 10, 0, 100));
        return false;
    },

    _affairs(world, folk, day, rng) {
        const C = Romance.config();
        const A = C.affair;
        if (_num(A.chance) <= 0) return;
        const rm = folk.romance;
        const inAffair = new Set();
        for (const c of rm.list) if (c.affair) { inAffair.add(c.a); inAffair.add(c.b); }
        const wed = Townsfolk.residents(folk).filter(p => {
            const sp = Townsfolk.get(folk, p.spouse);
            const age = Townsfolk.age(p, day);
            return sp && sp.died == null && Townsfolk.isHere(sp) && age >= 20 && age <= 55 && !inAffair.has(p.id)
                && (p.wedDay == null || day - p.wedDay >= _num(A.marriedDays, 120));
        });
        for (const p of wed) {
            if (rng() >= _num(A.chance)) continue;
            const pool = Townsfolk.residents(folk).filter(o => o.id !== p.spouse && !inAffair.has(o.id) && o.role !== 'child' && o.role !== 'priest'
                && Townsfolk.age(o, day) >= 18 && Townsfolk.age(o, day) <= 60);
            const lover = Romance._bestFor(world, folk, p, pool, day, rng, _num(A.minScore, 0.52));
            if (!lover) continue;
            const c = Romance._newCourt(rm, p, lover, 'affair', day, 50);
            c.affair = true;
            inAffair.add(p.id);
            inAffair.add(lover.id);
        }
    },

    _affairStep(world, folk, c, day, rng, news) {
        const A = Romance.config().affair;
        const u = rng();
        if (u < _num(A.foundOut)) {
            const P = Townsfolk.get(folk, c.a);
            const L = Townsfolk.get(folk, c.b);
            Romance._annal(folk, world, day, { k: 'affair', a: P.id, b: L.id }, news);
            const rm = folk.romance;
            for (const [who, other] of [[P, L], [L, P]]) {
                const sp = Townsfolk.get(folk, who.spouse);
                if (sp && sp.died == null) {
                    Townsfolk._log(sp, day, 'betrayed', who.id, other.first);
                    Townsfolk._log(sp, day, 'rivalInLove', other.id, who.first);
                    Romance._grudge(rm, sp.id, other.id, 'affair', day);
                    Romance._break(sp, who.id, day, _num(Romance.config().heartbreak.days, 60), 'betrayed', true);
                }
            }
            Romance._end(world, folk, c, 'foundOut', day, news);
        } else if (u < _num(A.foundOut) + _num(A.ends)) {
            Romance._end(world, folk, c, 'affairEnded', day, news);
        }
    },

    /** The player is courting someone who is courting another here: that other suitor resents the player. */
    _playerSuit(world, folk, day, player) {
        if (!player || !player.relationships) return;
        const P = Romance.config().player;
        const rm = folk.romance;
        for (const c of rm.list) {
            if (c.affair || c.prv != null) continue;
            for (const pid of [c.a, c.b]) {
                const p = Townsfolk.get(folk, pid);
                const rel = p && p.rnpc ? player.relationships[p.rnpc] : null;
                if (!rel || !rel.romantic || _num(rel.affection) < _num(P.rivalAffection, 20)) continue;
                const suitor = Townsfolk.get(folk, Romance.partnerId(c, pid));
                const name = player.firstName || player.name || 'a stranger';
                c.prv = suitor.id;
                c.prvName = name;
                c.heat = Math.round(_clamp(_num(c.heat) - 15, 0, 100));
                Townsfolk._log(suitor, day, 'rivalInLove', null, name);
                Romance._bumpRegard(suitor, -_num(P.rivalResent, 15));
                break;
            }
        }
    },

    // ──────────── HOW THEY FEEL ────────────

    /** { k: 'love'|'smitten'|'broken', o } or null — read by work and prices. */
    mood(folk, p, day = null) {
        if (!folk || !p) return null;
        const ref = day != null ? day : _num(folk.romance && folk.romance.tick, _num(folk.tick));
        if (Romance.broken(folk, p, ref)) return { k: 'broken', o: p.heart.o };
        const c = Romance.courtOf(folk, p.id);
        if (!c) return null;
        const idx = Romance.stageIndex(c.st);
        if (idx >= 2) return { k: 'love', o: Romance.partnerId(c, p.id) };
        if (idx === 1) return { k: 'smitten', o: Romance.partnerId(c, p.id) };
        return null;
    },

    /** How much of a season's work they put in (×). */
    workFactor(folk, p, day = null) {
        const M = Romance.config().mood;
        const m = Romance.mood(folk, p, day);
        if (!m) return 1;
        if (m.k === 'broken') return _num(M.brokenWork, 0.75);
        if (m.k === 'love') return _num(M.loveWork, 1.1);
        return 1;
    },

    /** A trader's price shift from the heart (negative = cheaper): { pct, label } or null. */
    priceShift(npc) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || !folk.romance) return null;
        const M = Romance.config().mood;
        const m = Romance.mood(folk, p);
        if (!m) return null;
        if (m.k === 'love') return { shift: -_num(M.loveDiscount, 0.04), label: 'In love' };
        if (m.k === 'broken') return { shift: _num(M.brokenMarkup, 0.03), label: 'Heartbroken' };
        return null;
    },

    // ──────────── WORDS ────────────

    /**
     * A line from data lines[key] for a speaker (a person: their tempers and
     * station pick the voice), filled with vars. seedKey makes the pick.
     */
    line(key, speaker, vars = {}, seedKey = '', age = null) {
        const L = Romance.config().lines || {};
        let list = key.includes('.') ? key.split('.').reduce((o, k) => (o && o[k]) || null, L) : L[key];
        if (!Array.isArray(list) || !list.length) return null;
        const traits = (speaker && speaker.traits) || [];
        const high = speaker && Romance.station(speaker) >= 3 ? 'high' : 'low';
        // (a line marked y is for the young: "don't tell my mother")
        const young = age != null && age < 30;
        const fits = l => typeof l === 'string' || ((!l.p || (Array.isArray(l.p) ? l.p : [l.p]).some(t => traits.includes(t))) && (!l.s || l.s === high) && (!l.y || young));
        const own = list.filter(l => typeof l !== 'string' && (l.p || l.s) && fits(l));
        const plain = list.filter(l => typeof l === 'string' || (!l.p && !l.s && fits(l)));
        // A voice of their own most of the time
        const u = _h(seedKey, key, 'voice');
        list = own.length && u < 0.6 ? own : plain.length ? plain : list.filter(fits);
        if (!list.length) return null;
        const pick = list[Math.floor(_h(seedKey, key) * list.length) % list.length];
        let t = typeof pick === 'string' ? pick : pick.t;
        for (const [k, v] of Object.entries(vars)) t = t.split(`{${k}}`).join(v == null ? '' : String(v));
        return t;
    },

    /** How the town calls someone: "the smith's daughter", "Marta the merchant", "Tomas Hayward". */
    describe(folk, p, day) {
        if (!p) return 'someone';
        if (Townsfolk.age(p, day) < 30) {
            const par = (p.parents || []).map(id => Townsfolk.get(folk, id))
                .find(x => x && !['villager', 'child'].includes(x.retired || x.role));
            if (par) return `the ${Townsfolk.title(par.retired || par.role, par.gender)}'s ${p.gender === 'female' ? 'daughter' : 'son'}`;
        }
        const role = p.retired || p.role;
        if (role === 'villager') return `${p.first} ${p.last}`;
        return `${p.first} the ${Townsfolk.roleTitle(p)}`;
    },

    /**
     * What the town whispers of its courtships (not the speaker's own):
     * [{ text, court }], the hottest first.
     */
    rumours(folk, world, limit = 3, speaker = null) {
        const rm = folk && folk.romance;
        if (!rm || !Array.isArray(rm.list)) return [];
        const day = _num(world && world.day, _num(rm.tick));
        const out = [];
        for (const c of rm.list) {
            if (c.affair || c.st === 'noticing') continue;
            if (speaker && (c.a === speaker.id || c.b === speaker.id)) continue;
            const A = Townsfolk.get(folk, c.a);
            const B = Townsfolk.get(folk, c.b);
            if (!A || !B) continue;
            let key = c.st;
            const vars = { A: Romance.describe(folk, A, day), B: Romance.describe(folk, B, day) };
            if (c.st === 'betrothed') vars.when = Townsfolk.when(_num(c.wedDay, day), world);
            if (c.prv != null && c.prvName) { key = 'playerRival'; vars.A = Romance.describe(folk, Townsfolk.get(folk, c.prv), day); vars.B = Romance.describe(folk, Townsfolk.get(folk, Romance.partnerId(c, c.prv)), day); vars.player = c.prvName; }
            else if (c.forbid) key = 'forbidden';
            else if (c.rival) {
                const R = Townsfolk.get(folk, c.rival.p);
                if (R) { key = 'rival'; vars.A = Romance.describe(folk, Townsfolk.get(folk, Romance.partnerId(c, c.rival.of)), day); vars.B = Romance.describe(folk, Townsfolk.get(folk, c.rival.of), day); vars.C = Romance.describe(folk, R, day); }
            } else if (c.quarrel != null && day - c.quarrel <= 10) key = 'quarrel';
            const text = Romance.line(`rumour.${key}`, null, vars, `${folk.q},${folk.r}|${c.id}|${Math.floor(day / 10)}`);
            if (text) out.push({ text: text.charAt(0).toUpperCase() + text.slice(1), court: c, w: Romance.stageIndex(c.st) + (key !== c.st ? 2 : 0) });
        }
        out.sort((x, y) => y.w - x.w || x.court.id - y.court.id);
        return out.slice(0, limit);
    },

    /** What a person says of their own heart (a courtship, a broken heart), or null. */
    ownWord(folk, p, world) {
        if (!folk || !p) return null;
        const day = _num(world && world.day, 0);
        const c = Romance.courtOf(folk, p.id);
        const seed = `${folk.q},${folk.r}|${p.id}|${day}`;
        if (c) {
            const o = Townsfolk.get(folk, Romance.partnerId(c, p.id));
            if (!o) return null;
            const key = c.forbid && Romance.stageIndex(c.st) >= 2 ? 'forbidden' : c.st;
            // (only the one who noticed knows of a noticing)
            if (key === 'noticing' && c.a !== p.id) return null;
            return Romance.line(`own.${key}`, p, { name: o.first, when: Townsfolk.when(_num(c.wedDay, day), world) }, seed, Townsfolk.age(p, day));
        }
        if (Romance.broken(folk, p, day)) {
            const o = Townsfolk.get(folk, p.heart.o);
            return Romance.line('own.broken', p, { name: o ? o.first : 'them' }, seed);
        }
        return null;
    },

    /** The answer to "Who's sweet on whom here?" */
    gossipFor(folk, speaker, world) {
        const day = _num(world && world.day, 0);
        const parts = [];
        const own = speaker ? Romance.ownWord(folk, speaker, world) : null;
        const tales = Romance.rumours(folk, world, own ? 1 : 2, speaker).map(r => r.text);
        if (tales.length) parts.push(...tales);
        if (own) parts.push(`And me? ${own}`);
        if (!parts.length) parts.push(Romance.line('gossipNone', speaker, {}, `${folk && folk.q}|${day}`) || 'No one is courting just now.');
        return parts.join(' ');
    },

    // ──────────── THE PLAYER'S PART ────────────

    /**
     * What the player may do about this person's courtship:
     * { court, other, ops: ['carry'|'deliver'|'goodWord'|'meddle'] } or null.
     */
    offers(folk, p, world) {
        const c = Romance.courtOf(folk, p && p.id);
        if (!c || Romance.stageIndex(c.st) < 1) return null;
        const other = Townsfolk.get(folk, Romance.partnerId(c, p.id));
        if (!other || !Townsfolk.isHere(other)) return null;
        const P = Romance.config().player;
        const day = _num(world && world.day, 0);
        const ops = [];
        if (c.token && c.token.from === other.id && day - _num(c.token.d) <= _num(P.tokenDays, 20)) ops.push('deliver');
        else if (!c.token || day - _num(c.token.d) > _num(P.tokenDays, 20)) ops.push('carry');
        if (c.word == null || day - c.word >= _num(P.wordEveryDays, 10)) ops.push('goodWord');
        if (!c.meddled || day - c.meddled >= _num(P.wordEveryDays, 10)) ops.push('meddle');
        return { court: c, other, ops };
    },

    _bumpRegard(p, d) {
        if (!p) return;
        // (the dialog memory's own shape: systems/npcDisposition.js getMemory)
        if (!p.mem) {
            p.mem = { timesSpoken: 0, disposition: 50, lastAction: null, giftsReceived: 0, threatened: false, flattered: false, questOffered: false, rumorsTold: 0, playerTitle: null };
        }
        p.mem.disposition = _clamp(_num(p.mem.disposition, 50) + d, 0, 100);
    },

    /** The player offers to carry word from `p` to their sweetheart: → { line } */
    carry(folk, p, world) {
        const o = Romance.offers(folk, p, world);
        if (!o || !o.ops.includes('carry')) return null;
        o.court.token = { from: p.id, d: _num(world && world.day, 0) };
        return { line: Romance.line('tokenGive', p, { name: o.other.first }, `${folk.q},${folk.r}|${p.id}|tok`), other: o.other };
    },

    /** The love letter delivered to `p`: the match warms; both think the better of the player. → { line, regard } */
    deliver(folk, p, world) {
        const C = Romance.config();
        const o = Romance.offers(folk, p, world);
        if (!o || !o.ops.includes('deliver')) return null;
        const c = o.court;
        c.token = null;
        c.helped = _num(c.helped) + 1;
        c.heat = Math.round(_clamp(_num(c.heat) + _num(C.heat.token, 25), 0, 100));
        Romance._bumpRegard(o.other, _num(C.player.regard, 6));
        Townsfolk._log(p, _num(world && world.day, 0), 'favour');
        return { line: Romance.line('tokenDeliver', p, { name: o.other.first }, `${folk.q},${folk.r}|${p.id}|del`), regard: _num(C.player.regard, 6), other: o.other };
    },

    /** A good word for the sweetheart: `chance` (0..1) it lands. → { ok, line, regard } */
    goodWord(folk, p, world, chance = 0.6) {
        const C = Romance.config();
        const o = Romance.offers(folk, p, world);
        if (!o || !o.ops.includes('goodWord')) return null;
        const day = _num(world && world.day, 0);
        const c = o.court;
        c.word = day;
        const ok = _h(_seed(world), folk.q, folk.r, c.id, day, 'word') < chance;
        if (ok) {
            c.heat = Math.round(_clamp(_num(c.heat) + _num(C.heat.goodWord, 15), 0, 100));
            c.helped = _num(c.helped) + 1;
            Romance._bumpRegard(o.other, Math.round(_num(C.player.regard, 6) / 2));
        }
        return { ok, line: Romance.line(ok ? 'goodWord' : 'goodWordFail', p, { name: o.other.first }, `${folk.q},${folk.r}|${p.id}|${day}|w`), regard: ok ? 3 : -1, other: o.other };
    },

    /**
     * A tale that the sweetheart strays: the match cools, may break; the tale
     * may be traced to the player. → { broke, caught, line, regard }
     */
    meddle(folk, p, world, news = []) {
        const C = Romance.config();
        const o = Romance.offers(folk, p, world);
        if (!o || !o.ops.includes('meddle')) return null;
        const day = _num(world && world.day, 0);
        const c = o.court;
        c.meddled = day;
        c.heat = Math.round(_clamp(_num(c.heat) + _num(C.heat.meddle, -35), 0, 100));
        const broke = _h(_seed(world), folk.q, folk.r, c.id, day, 'meddle') < _num(C.player.meddleBreak, 0.45) * (1 - c.heat / 200);
        const caught = _h(_seed(world), folk.q, folk.r, c.id, day, 'caught') < _num(C.player.meddleCaught, 0.3);
        if (broke) Romance._end(world, folk, c, 'parted', day, news);
        if (caught) {
            Romance._bumpRegard(o.other, -20);
            Townsfolk._log(o.other, day, 'wronged');
            Townsfolk._log(p, day, 'wronged');
        }
        const line = caught ? Romance.line('meddleCaught', p, { name: o.other.first }, `${folk.q},${folk.r}|${p.id}|${day}|c`)
            : Romance.line('meddle', p, { name: o.other.first }, `${folk.q},${folk.r}|${p.id}|${day}|m`);
        return { broke, caught, line, regard: caught ? -20 : 0, other: o.other };
    },

    /** A suitor who resents the player for courting their sweetheart says so: the line, or null. */
    resentLine(folk, p, world) {
        const c = folk && folk.romance && Array.isArray(folk.romance.list) ? folk.romance.list.find(x => x.prv === (p && p.id)) : null;
        if (!c) return null;
        const o = Townsfolk.get(folk, Romance.partnerId(c, p.id));
        return o ? Romance.line('playerRival', p, { name: o.first }, `${folk.q},${folk.r}|${p.id}|${_num(world && world.day)}`) : null;
    },

    // ──────────── WHAT OTHERS READ ────────────

    /** Bad blood from love: [{ a, b, why: 'rivalSuitor'|'affair', d }] (for the fights between townsfolk). */
    grudges(folk, since = -Infinity) {
        const rm = folk && folk.romance;
        return rm && Array.isArray(rm.grudges) ? rm.grudges.filter(g => g.d >= since) : [];
    },

    /** Weddings in this town today: [{ a, b }] (the street map plays them out). */
    weddingsOn(folk, day) {
        if (!folk || !Array.isArray(folk.annals)) return [];
        return folk.annals.filter(e => e.k === 'wed' && e.d === day && e.x == null).map(e => ({ a: e.a, b: e.b }));
    },

    /** Annal kinds told by this module. */
    isRomanceAnnal(k) { return ROMANCE_KINDS.includes(k); },

    /** A town annal of the heart, as the speaker would tell it. */
    annalText(folk, entry, world, speaker = null) {
        if (!Romance.isRomanceAnnal(entry.k)) return null;
        const T = Romance.config().annals || {};
        const a = Townsfolk.get(folk, entry.a);
        const b = Townsfolk.get(folk, entry.b);
        if (!a || !b) return null;
        const when = Townsfolk.when(entry.d, world);
        // (as they were called then: a bride by her maiden name)
        const call = p => { const c = Townsfolk._call(folk, p, speaker); return c === Townsfolk.name(p) ? `${p.first} ${p.maiden || p.last}` : c; };
        let C = '';
        if (entry.k === 'rivalWon') {
            const r = Townsfolk.get(folk, Number(entry.x));
            if (!r) return null;
            C = call(r);
        }
        const tpl = T[entry.k];
        if (!tpl) return null;
        let t = tpl.split('{A}').join(call(a)).split('{B}').join(call(b)).split('{C}').join(C)
            .split('{b}').join(b.first).split('{when}').join(when).split('{to}').join(entry.x || 'parts unknown');
        if (entry.k === 'forbidden' && entry.x === 'feud') t = t.replace(/\.$/, ' — bad blood between the families.');
        if (entry.k === 'forbidden' && entry.x === 'station') t = t.replace(/\.$/, ' — beneath them, they said.');
        if (entry.k === 'betrothed' && Number(entry.x) > _num(world && world.day, 0)) t = t.replace(/\.$/, `, to wed ${Townsfolk.when(Number(entry.x), world)}.`);
        // "I and Tomas…" → "Tomas and I…"
        t = t.replace(/^I and (.+?) (were|ran)/, '$1 and I $2').replace(/^I's /, 'My ').replace(/ (to|with|from) I([ .,])/g, ' $1 me$2').replace(/ I's /g, ' my ');
        return t.charAt(0).toUpperCase() + t.slice(1);
    },

    /** A first-person line about one entry of a person's life (their heart). */
    lifeText(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'courting': return o ? `I started walking out with ${Townsfolk.name(o)} ${when}.` : null;
            case 'betrothed': return o ? `${o.first} and I were promised ${when}.` : null;
            case 'heartbroken':
                if (!o) return null;
                if (e.x === 'jilted') return `${o.first} broke it off with me ${when}. I'm over it. Mostly.`;
                if (e.x === 'forbidden') return `My family would not let me have ${o.first}. That was ${when}.`;
                if (e.x === 'death') return `I lost ${o.first} ${when}, before we could wed.`;
                if (e.x === 'gone') return `${o.first} went away ${when}, and left me behind.`;
                if (e.x === 'rival') return `${o.first} chose another ${when}.`;
                return `${o.first} and I parted ${when}.`;
            case 'rivalInLove': return o ? `${Townsfolk.name(o)} and I both courted ${e.x || 'the same one'}, ${when}. We don't speak.` : (e.x ? `${e.x} came between me and my sweetheart ${when}.` : null);
            case 'betrayed': return o ? `My ${Townsfolk.kinWord(o, 'spouse')} ${o.first} was unfaithful ${when}${e.x ? `, with ${e.x}` : ''}. I've not forgiven it.` : null;
            case 'kidEloped': return o ? `Our ${o.first} ran off ${when}, to ${e.x || 'who knows where'}. Without a word!` : null;
            default: return null;
        }
    },

    /** A third-person journal line about one entry of a person's life (their heart). */
    biographyLine(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'courting': return o ? `Began courting ${Townsfolk.name(o)} ${when}.` : null;
            case 'betrothed': return o ? `Promised to ${Townsfolk.name(o)} ${when}.` : null;
            case 'heartbroken': return o ? `Heartbroken ${when}: ${e.x === 'jilted' ? `jilted by ${o.first}` : e.x === 'forbidden' ? `forbidden to wed ${o.first}` : e.x === 'death' ? `${o.first} died` : e.x === 'rival' ? `${o.first} chose another` : e.x === 'betrayed' ? `${o.first} strayed` : `parted from ${o.first}`}.` : null;
            case 'rivalInLove': return o ? `Rivals in love with ${Townsfolk.name(o)} ${when}.` : (e.x ? `Resents ${e.x} for courting ${_pronoun(p, 'pos')} sweetheart (${when.replace(/^in /, '')}).` : null);
            case 'eloped': return o ? `Ran off with ${Townsfolk.name(o)} ${when}, to ${e.x || 'parts unknown'}.` : null;
            case 'betrayed': return o ? `${o.first} was unfaithful ${when}.` : null;
            case 'kidEloped': return o ? `${o.first} eloped ${when}.` : null;
            default: return null;
        }
    },

    /** Log kinds the reunion tells, by weight (Townsfolk.reunionLine). */
    reunionRanks() {
        return { betrothed: 4, eloped: 4, betrayed: 5, kidEloped: 4, heartbroken: 3, courting: 2, rivalInLove: 2 };
    },
};
