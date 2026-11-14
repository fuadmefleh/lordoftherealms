// ============================================================
// TOWN ERAS — the world's towns age visibly over the centuries
// ============================================================
// A town passes through architectural eras (data/townEras.json): the Hearth
// Age's wattle huts and longhouses under thatch, the Timber Age's halls of
// plaster and boards, the Age of Stone with its cobbled high street and stone
// walls, and the Guild Age — guildhalls, spires, every lane paved. It takes the
// next era once the world's year, its wealth (world/settlementWealth.js), its
// size and its culture allow, never going back.
//
// Its history (settlement.townEra, saved with the tile) is filled back to its
// founding the first time it is seen, then advanced once a year:
//
//   history  [[era, year, pace], …] — when it entered each era, and how fast
//            it renewed its houses then (a rich town rebuilds sooner)
//   walls    { kind: 'palisade' | 'stone', year } or null — raised when its
//            size, wealth and the threats it faces allow
//   lastYear the last year it was advanced
//   forced   a debug look: { era, walls, wear, year } (force())
//
// Every building stands in the style of the era it was last (re)built in:
// it lasts its era's `life` (× the town's pace), its first build spread by its
// district (a whole quarter old together) and a little of its own; past
// wear.worn of its life it is weathered, past wear.old old — then pulled down
// and rebuilt in the style of the day (buildState). The planner asks look() for
// all of it as the street map is drawn (world/townPlanner.js), and the map is
// laid out anew when stamp() changes (world/innerMap/terrain.js).
//
// Pure: no Math.random, no globals; hashes of the world's seed and the
// town's place. Only for worlds made since terrainGen 8 (enabled()).

import { DataLoader } from '../core/dataLoader.js';
import { SettlementWealth, TIERS } from './settlementWealth.js';
import { TownMarks } from './townMarks.js';
import { Cultures } from './cultures.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** The world's year (its base year before the first day is out). */
const _yearOf = w => Math.floor(_num(w && w.year, _num(w && w.baseYear, 853)));

/** A hash of its parts to [0, 1). */
function _h(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

const FALLBACK = {
    eras: [
        { id: 'hearth', from: 0, minScore: 0, minType: 'village', tierCap: 'poor', mix: 'edge', lamps: 'none', paving: {}, walls: 'palisade', life: [35, 60] },
        { id: 'timber', from: 250, minScore: 0.22, minType: 'village', tierCap: 'mid', lamps: 'none', paving: {}, walls: 'palisade', life: [55, 95] },
        { id: 'stone', from: 520, minScore: 0.42, minType: 'village', tierCap: 'rich', lamps: 'square', paving: { main: true }, walls: 'stone', life: [110, 190] },
        { id: 'guild', from: 760, minScore: 0.55, minType: 'town', tierCap: 'rich', lamps: null, paving: { main: true, lane: true }, walls: 'stone', life: [120, 220] },
    ],
    lagYears: 60,
    types: ['village', 'town', 'city', 'capital'],
    cultures: {},
    pace: { slow: 1.3, fast: 0.75 },
    districtSize: 9,
    phaseJitter: 0.18,
    wear: { worn: 0.6, old: 0.85, poorEarlier: 0.15 },
    paveYears: { main: 45, lane: 90 },
    walls: {
        minType: { palisade: 'town', stone: 'town' }, minScore: { palisade: 0.25, stone: 0.5 },
        chance: { palisade: 0.004, stone: 0.003 }, capitalBonus: 1.5, cityBonus: 0.8,
        threat: { war: 1.2, sack: 1.5, fire: 0.3, cairn: 0.6, invasion: 2, markYears: 80 }, villageThreat: 2.5,
        margin: 2,
    },
    eraNotice: {},
    art: null,
};

const LAMPS = ['none', 'square', 'street', 'all'];

function _cfg() {
    const g = DataLoader._gamedata;
    const d = _obj(g && g.townEras);
    if (!d) return FALLBACK;
    return {
        ...FALLBACK, ...d,
        eras: Array.isArray(d.eras) && d.eras.length ? d.eras : FALLBACK.eras,
        pace: { ...FALLBACK.pace, ...(_obj(d.pace) || {}) },
        wear: { ...FALLBACK.wear, ...(_obj(d.wear) || {}) },
        paveYears: { ...FALLBACK.paveYears, ...(_obj(d.paveYears) || {}) },
        walls: { ...FALLBACK.walls, ...(_obj(d.walls) || {}) },
        cultures: _obj(d.cultures) || {},
    };
}

export const TownEras = {
    config: _cfg,

    /** Do this world's towns age (made since terrainGen 8)? */
    enabled(world) {
        const gp = (world && world.generationParams) || {};
        return (Number(gp.terrainGen) || 1) >= 8;
    },

    eras() { return _cfg().eras; },
    eraIndex(id) { return _cfg().eras.findIndex(e => e.id === id); },
    era(id) { return _cfg().eras.find(e => e.id === id) || null; },

    /** A type's rank: village 0 … capital 3 */
    typeRank(type) {
        const i = _cfg().types.indexOf(type || 'village');
        return i < 0 ? 0 : i;
    },

    /** The years a culture's towns come to an era early (−) or late (+). */
    shift(culture, eraId) {
        const c = _obj(_cfg().cultures[culture]);
        if (!c) return 0;
        return _num(c[eraId], 0) + _num(c.all, 0);
    },

    /** How many years after the era's earliest year this town takes to it (a hash of its place). */
    lag(st, idx) {
        return Math.floor(_h(st.salt, 'lag', idx) * _num(_cfg().lagYears, 60));
    },

    /** How fast a town of this wealth renews its houses: a multiplier on a building's life. */
    pace(score) {
        const P = _cfg().pace;
        return Math.round((P.slow - (P.slow - P.fast) * _clamp(_num(score, 0.5), 0, 1)) * 1000) / 1000;
    },

    /** The year a town may take an era by (its earliest year, its culture's shift, its lag). */
    eraYear(st, idx, culture) {
        const e = _cfg().eras[idx];
        return _num(e.from, 0) + TownEras.shift(culture, e.id) + (idx > 0 ? TownEras.lag(st, idx) : 0);
    },

    /** The furthest era a town of this score and type may stand in, in a year (ignoring what it stands in now). */
    eligible(st, year, score, type, culture) {
        const E = _cfg().eras;
        const rank = TownEras.typeRank(type);
        let best = 0;
        for (let i = 1; i < E.length; i++) {
            const e = E[i];
            if (year < TownEras.eraYear(st, i, culture)) break;
            if (_num(score, 0) < _num(e.minScore, 0)) break;
            if (rank < TownEras.typeRank(e.minType)) break;
            best = i;
        }
        return best;
    },

    /** A settlement's era record, or null. */
    state(settlement) {
        return _obj(settlement && settlement.townEra);
    },

    /**
     * Its era record, stamped the first time it is asked for: the history filled
     * back to its founding as its wealth today would have had it, its walls as
     * the centuries' chances fell (rolled at the threat of an ordinary year).
     */
    ensure(world, settlement) {
        if (!settlement) return null;
        const have = TownEras.state(settlement);
        if (have && Array.isArray(have.history) && have.history.length) return have;
        const C = _cfg();
        const E = C.eras;
        const year = _yearOf(world);
        const seed = world && world.generationParams ? world.generationParams.seed : 0;
        const st = { salt: Math.floor(_h('townEra', seed, settlement.q, settlement.r) * 1e9), history: [], walls: null, lastYear: year };
        const score = SettlementWealth.score(settlement);
        const culture = Cultures.cultureOf(world, settlement);
        const pace = TownEras.pace(score);
        // (a town founded in play began when it was founded; an old one in the deep past)
        const founded = Number.isFinite(settlement.founded) ? Math.min(year, settlement.founded) : Math.min(year, _num(E[0].from, 0)) - 120;
        st.history.push([E[0].id, founded, pace]);
        const target = TownEras.eligible(st, year, score, settlement.type, culture);
        for (let i = 1; i <= target; i++) {
            const y = Math.min(year, Math.max(st.history[st.history.length - 1][1] + 1, TownEras.eraYear(st, i, culture)));
            st.history.push([E[i].id, y, pace]);
        }
        // Its walls: each year since it could have raised them, a chance at an ordinary year's threat
        const base = TownEras.baseThreat(settlement);
        for (let y = Math.max(founded, year - 1200); y < year; y++) {
            TownEras._rollWalls(st, settlement, y, score, base);
        }
        settlement.townEra = st;
        return st;
    },

    /** The era index a town stood in in a year (its first before its history began). */
    eraIndexAt(st, year) {
        const H = (st && st.history) || [];
        let idx = H.length ? TownEras.eraIndex(H[0][0]) : 0;
        for (const [id, y] of H) if (year >= y) idx = TownEras.eraIndex(id);
        return Math.max(0, idx);
    },

    /** The pace a town renewed at in a year. */
    paceAt(st, year) {
        const H = (st && st.history) || [];
        let p = H.length ? _num(H[0][2], 1) : 1;
        for (const [, y, pc] of H) if (year >= y) p = _num(pc, p);
        return p;
    },

    /** The year a town entered an era (by index), or null. */
    enteredAt(st, idx) {
        const id = (_cfg().eras[idx] || {}).id;
        const e = ((st && st.history) || []).find(h => h[0] === id);
        return e ? e[1] : null;
    },

    /**
     * When a building was last (re)built, in which era's style, and how worn it is
     * now: { built, eraIdx, life, age, wear } (wear 0 fresh, 1 weathered, 2 old).
     * `q, r` its place on the town's map (its door); `score` the town's wealth
     * (a poor town lets its houses go sooner).
     */
    buildState(st, q, r, year, score = 0.5) {
        const C = _cfg();
        const E = C.eras;
        const H = (st && st.history) || [];
        const start = H.length ? H[0][1] : 0;
        const D = Math.max(1, _num(C.districtSize, 9));
        const jit = _clamp(_num(C.phaseJitter, 0.18), 0, 1);
        const lifeOf = (idx, n) => {
            const [a, b] = Array.isArray(E[idx].life) ? E[idx].life : [60, 120];
            return (a + (b - a) * _h(st.salt, 'life', q, r, n));
        };
        // Its first build: a share of a life before the history began, its district's and a little its own
        const phase = _h(st.salt, 'district', Math.floor(q / D), Math.floor(r / D)) * (1 - jit) + _h(st.salt, 'own', q, r) * jit;
        let idx = TownEras.eraIndexAt(st, start);
        let t = start - phase * lifeOf(idx, 0) * TownEras.paceAt(st, start);
        let life = 0;
        for (let n = 0; n < 400; n++) {
            idx = TownEras.eraIndexAt(st, t);
            life = Math.max(5, lifeOf(idx, n) * TownEras.paceAt(st, t));
            if (t + life > year) break;
            t += life;
        }
        const age = Math.max(0, year - t);
        const W = C.wear;
        const early = _num(W.poorEarlier, 0) * _clamp((0.5 - _num(score, 0.5)) * 2, 0, 1);
        const frac = age / life;
        const wear = frac >= _num(W.old, 0.8) - early ? 2 : frac >= _num(W.worn, 0.55) - early ? 1 : 0;
        return { built: Math.floor(t), eraIdx: idx, life: Math.round(life), age: Math.floor(age), wear };
    },

    /** The richest tier an era's builders raise ('poor' | 'mid' | 'rich'). */
    tierCap(idx) {
        const e = _cfg().eras[idx];
        return (e && TIERS.includes(e.tierCap)) ? e.tierCap : 'rich';
    },

    /** A tier held to a cap. */
    capTier(tier, cap) {
        const i = TIERS.indexOf(tier), c = TIERS.indexOf(cap);
        if (i < 0 || c < 0) return tier;
        return TIERS[Math.min(i, c)];
    },

    // ── Walls ──

    /** The threat a town lives under in an ordinary year (its size: a capital is worth taking). */
    baseThreat(settlement) {
        const W = _cfg().walls;
        const t = settlement && settlement.type;
        return t === 'capital' ? _num(W.capitalBonus, 1.5) : t === 'city' ? _num(W.cityBonus, 0.8) : 0;
    },

    /** The threat a town lives under this year: its realm's wars, what its memory holds, an invasion abroad. */
    threat(world, settlement) {
        const W = _cfg().walls;
        const T = W.threat || {};
        let t = TownEras.baseThreat(settlement);
        const kid = settlement && settlement.kingdom;
        const k = kid == null ? null : (world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : ((world && world.kingdoms) || []).find(x => x && x.id === kid));
        if (k && Array.isArray(k.wars) && k.wars.length) t += _num(T.war, 1.2);
        const mem = TownMarks.memory(settlement);
        const day = _num(world && world.day, 0);
        const span = _num(T.markYears, 80) * 120;
        for (const m of (mem && mem.marks) || []) {
            if (!m || day - _num(m.d, -1e9) > span) continue;
            if (m.k === 'sack') t += _num(T.sack, 1.5);
            else if (m.k === 'fire') t += _num(T.fire, 0.3);
            else if (m.k === 'cairn') t += _num(T.cairn, 0.6);
        }
        const c = world && _obj(world.crises) && world.crises.active;
        if (c && /invasion/i.test(String(c.kind || c.type || c.id || ''))) t += _num(T.invasion, 2);
        return t;
    },

    /** One year's chance at raising (or raising in stone) the town's walls. Returns the kind raised, or null. */
    _rollWalls(st, settlement, year, score, threat) {
        const W = _cfg().walls;
        const idx = TownEras.eraIndexAt(st, year);
        const may = (_cfg().eras[idx] || {}).walls;
        if (!may) return null;
        const have = st.walls && st.walls.kind;
        if (have === 'stone' || have === may) return null;
        const kind = may;
        const rank = TownEras.typeRank(settlement.type);
        // a village rings itself only when it is truly threatened
        const minRank = TownEras.typeRank((W.minType || {})[kind] || 'town');
        if (rank < minRank && !(threat >= _num(W.villageThreat, 2.5) && kind === 'palisade')) return null;
        if (_num(score, 0) < _num((W.minScore || {})[kind], 0.3)) return null;
        const p = _num((W.chance || {})[kind], 0.003) * (1 + Math.max(0, threat));
        if (_h(st.salt, 'walls', kind, year) >= p) return null;
        st.walls = { kind, year };
        return kind;
    },

    // ── The year ──

    /**
     * Advance a town's record to a year: the next era when it may take it (one a
     * year), and the year's chance at walls. Returns what changed: { era, walls }.
     */
    advance(world, settlement, year) {
        const st = TownEras.ensure(world, settlement);
        const out = { era: null, walls: null };
        if (!st) return out;
        const score = SettlementWealth.score(settlement);
        const cur = TownEras.eraIndex(st.history[st.history.length - 1][0]);
        const may = TownEras.eligible(st, year, score, settlement.type, Cultures.cultureOf(world, settlement));
        const E = _cfg().eras;
        if (may > cur && E[cur + 1]) {
            st.history.push([E[cur + 1].id, year, TownEras.pace(score)]);
            out.era = E[cur + 1].id;
        }
        out.walls = TownEras._rollWalls(st, settlement, year, score, TownEras.threat(world, settlement));
        st.lastYear = year;
        return out;
    },

    /**
     * The day: once a year each town is advanced (world-side; the player may be
     * null). Returns { notices } for the towns the player knows.
     */
    processDay(world, player = null) {
        const out = { notices: [], changed: 0 };
        if (!world || !TownEras.enabled(world) || typeof world.getSettlementViews !== 'function') return out;
        const year = _yearOf(world);
        const C = _cfg();
        for (const s of world.getSettlementViews()) {
            if (!s || s.ruined || s.destroyed) continue;
            const st = TownEras.state(s);
            if (st && _num(st.lastYear, year) >= year) continue;
            if (!st) { TownEras.ensure(world, s); continue; }
            // (a few years at most, should the calendar have leapt: a time skip runs day by day)
            for (let y = Math.max(_num(st.lastYear, year - 1) + 1, year - 5); y <= year; y++) {
                const r = TownEras.advance(world, s, y);
                if (r.era || r.walls) out.changed++;
                if (!TownEras._knows(player, s)) continue;
                const fill = t => String(t || '').replace(/\{town\}/g, s.name || 'the town');
                if (r.era && C.eraNotice && C.eraNotice[r.era]) out.notices.push({ icon: '🏛️', title: `${s.name}: ${(TownEras.era(r.era) || {}).label || r.era}`, text: fill(C.eraNotice[r.era]), type: 'info' });
                if (r.walls && C.walls.notice && C.walls.notice[r.walls]) out.notices.push({ icon: '🧱', title: `${s.name} Walled`, text: fill(C.walls.notice[r.walls]), type: 'info' });
            }
        }
        return out;
    },

    /** Does the player know this town (has been there, or holds it)? */
    _knows(player, s) {
        if (!player || !s) return false;
        if (s.owner && player.id != null && s.owner === player.id) return true;
        const v = player.quests && player.quests.settlementsVisited;
        if (v && typeof v.has === 'function') return v.has(s.name) || v.has(`${s.q},${s.r}`);
        if (Array.isArray(v)) return v.includes(s.name) || v.includes(`${s.q},${s.r}`);
        return false;
    },

    // ── What the street map shows ──

    /**
     * How a town looks in a year, for the planner: its era, the richest tier its
     * builders raise, the ring of its culture's house mix every house is drawn from
     * (or null), its lamps, how far each kind of street is paved (0..1 of the town),
     * the paving a culture without its own lays at last, its walls, and each
     * building's state (building(q, r) → { tierCap, wear, eraIdx }).
     * Null when the world's towns don't age.
     */
    look(world, settlement, opts = {}) {
        if (!world || !settlement || !TownEras.enabled(world)) return null;
        const st = TownEras.ensure(world, settlement);
        if (!st) return null;
        const C = _cfg();
        const E = C.eras;
        const F = _obj(st.forced);
        const year = F && Number.isFinite(F.year) ? F.year : _yearOf(world);
        let idx = TownEras.eraIndexAt(st, year);
        if (F && F.era != null && TownEras.eraIndex(F.era) >= 0) idx = TownEras.eraIndex(F.era);
        const era = E[idx];
        const score = Number.isFinite(opts.score) ? opts.score : SettlementWealth.score(settlement);
        // Paving spreads out from the square from the year the era that lays it began
        const pave = { main: 0, lane: 0, plaza: 0 };
        const P = C.paveYears;
        for (const kind of ['main', 'lane']) {
            const first = E.findIndex(e => e.paving && e.paving[kind]);
            if (first < 0 || idx < first) continue;
            const since = F && F.era != null ? -Infinity : TownEras.enteredAt(st, first);
            pave[kind] = since == null || since === -Infinity ? 1 : _clamp((year - since) / Math.max(1, _num(P[kind], 50)), 0, 1);
        }
        // (the square is paved with the high street's first stones)
        pave.plaza = pave.main > 0 ? 1 : 0;
        const cult = _obj(C.cultures[settlement.culture]) || {};
        const lateStreets = idx === E.length - 1 && cult.streets ? cult.streets : null;
        let walls = st.walls ? st.walls.kind : null;
        if (F && F.walls !== undefined) walls = F.walls || null;
        const mig = _obj(settlement.migr);
        return {
            era: era.id,
            eraIdx: idx,
            year,
            label: era.label || era.id,
            mixRing: era.mix || null,
            lamps: era.lamps == null ? null : era.lamps,
            pave,
            lateStreets,
            walls,
            wallMaterial: walls ? TownEras.wallMaterial(settlement.culture, walls) : null,
            // its landmarks' belltowers (the Guild Age: era `spires`, art.spires)
            spires: Array.isArray(era.spires) ? era.spires : [],
            spireStyle: Array.isArray(era.spires) && era.spires.length ? TownEras.spireStyle(settlement.culture) : null,
            building(q, r) {
                const b = TownEras.buildState(st, q, r, year, score);
                const forcedWear = F && Number.isFinite(F.wear) ? F.wear : null;
                // (a forced era: every building of it, as fresh or worn as asked)
                const eIdx = F && F.era != null ? idx : b.eraIdx;
                // A town that has lost its people stands with houses empty and gone to ruin; one that
                // has grown with new-built ones (settlement.migr.vac / fresh: systems/migration.js)
                let wear = forcedWear != null ? forcedWear : b.wear;
                let vacant = false;
                if (forcedWear == null && mig) {
                    if (_num(mig.vac) > 0 && _h(st.salt, 'vacant', q, r) < _num(mig.vac)) { wear = 2; vacant = true; }
                    else if (_num(mig.fresh) > 0 && _h(st.salt, 'fresh', q, r) < _num(mig.fresh)) wear = 0;
                }
                return { tierCap: TownEras.tierCap(eIdx), wear, base: forcedWear != null ? forcedWear : b.wear, eraIdx: eIdx, built: b.built, vacant };
            },
        };
    },

    /** The lamps a town lights: the fewer of its culture's and its era's. */
    lamps(cultureLamps, eraLamps) {
        if (eraLamps == null) return cultureLamps || 'none';
        const a = LAMPS.indexOf(cultureLamps || 'none'), b = LAMPS.indexOf(eraLamps);
        return LAMPS[Math.max(0, Math.min(a < 0 ? 0 : a, b < 0 ? 0 : b))];
    },

    /** The belltower a culture raises over its landmarks (data/townEras.json art.spires.byCulture), or null. */
    spireStyle(culture, wall = null) {
        const S = _cfg().art && _cfg().art.spires;
        if (!S || !S.byCulture) return null;
        const style = S.byCulture[culture] || S.byCulture.default || null;
        // (a stone church a stone belltower, a timbered one a timbered: the culture's own where they agree)
        const w = String(wall || '');
        if (/^timber/.test(style || '') && /stone|brick/.test(w)) return 'slate_spire';
        if (/spire$/.test(style || '') && style !== 'timber_spire' && /timber|siding|planks|logs|wattle/.test(w)) return 'timber_spire';
        return style;
    },

    /** The wall material a culture builds a kind of wall of (data/townEras.json art.byCulture). */
    wallMaterial(culture, kind) {
        const A = _cfg().art;
        if (!A || !A.byCulture) return null;
        const c = _obj(A.byCulture[culture]) || _obj(A.byCulture.default) || {};
        return c[kind] || null;
    },

    /**
     * What the town's map is laid out under, for its cache (world/innerMap/terrain.js):
     * its era, its walls, its paving's stage and the decade (its houses weather and
     * are rebuilt as the years pass). '' when the world's towns don't age.
     */
    stamp(world, settlement) {
        if (!world || !settlement || !TownEras.enabled(world)) return '';
        const st = TownEras.ensure(world, settlement);
        const F = _obj(st && st.forced);
        const year = _yearOf(world);
        // (and its empty and new-built houses: systems/migration.js)
        const mig = _obj(settlement.migr);
        const houses = mig && (mig.vac || mig.fresh) ? `:v${_num(mig.vac)}/${_num(mig.fresh)}` : '';
        return `|age${TownEras.eraIndexAt(st, year)}:${st.walls ? st.walls.kind[0] : '-'}:${Math.floor(year / 10)}${houses}${F ? ':f' + JSON.stringify(F) : ''}`;
    },

    /**
     * A debug look (the dev console, the browser checks): stand the town in an era,
     * with or without walls, its houses as worn as asked, as in a year — until
     * cleared (force(s, null)). Returns the record.
     */
    force(world, settlement, look = null) {
        const st = TownEras.ensure(world, settlement);
        if (!st) return null;
        if (!look) delete st.forced;
        else st.forced = { ...look };
        return st;
    },
};
