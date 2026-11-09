// ============================================
// GRAVE BOOK — a town's burial grounds and who lies in them
// ============================================
// Every settlement keeps its dead on `settlement.graveyard` (saved with the
// tile):
//
//   graveyard = {
//       v, grounds: { town: ground, lot3: ground, … },
//       charnel,          // sets of bones in the town's charnel house
//       pit,              // the dead laid in the common pit (nowhere else to lie)
//       deaths: [day],    // recent deaths, for the town's death rate
//       boneGlut, mealGlut, digWork, fullSince, opened, seeded, buried: { personId: true }
//   }
//   ground = { id, owner: 'town'|'player', name, cap, plots: [grave|null],
//              open: { plotIndex: day }, policy, since, crypt: { graves: [grave] }|null,
//              lot: lotId|null }
//   grave  = { id, pid, name, born, died, cause, cls, marker, term, until,
//              plot, goods, by, paid, lapsed, kin }
//
// A plot is a tile of the ground's rows (yardPlots: rows of graves with a walk
// between, the front row on the street left clear). The town's churchyard is
// planned by world/townPlanner.js; a player's ground lies on a lot of theirs.
// Pure data and arithmetic — no RNG (picks are hashes of the grave); the
// burials, leases and trade are systems/graveyards.js. Data: data/graves.json.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    enabled: true,
    daysPerYear: 120,
    yard: { village: [11, 5], town: [13, 6], city: [15, 7], capital: [17, 7] },
    artDir: 'assets/lpc/new/graves',
    artTile: 128,
    freshYears: 3,
    classOf: { beggar: 'pauper', noble: 'rich', merchant: 'middling', priest: 'middling', blacksmith_npc: 'middling' },
    classes: {
        pauper: { name: 'a pauper', markers: ['grave_mound'], term: 't10', coffin: 0, goods: [0, 0, 0], renew: 0.05 },
        common: { name: 'common folk', markers: ['cross_wood'], term: 't25', coffin: 1, goods: [0, 0, 0], renew: 0.25 },
        middling: { name: 'a tradesman\'s family', markers: ['headstone_plain'], term: 't50', coffin: 2, goods: [0.5, 1, 1], renew: 0.5 },
        rich: { name: 'the gentry', markers: ['headstone_carved'], term: 'perpetual', coffin: 3, goods: [1, 1, 3], renew: 0.85 },
    },
    terms: {
        t10: { name: 'ten years', years: 10, mult: 1 },
        t25: { name: 'twenty-five years', years: 25, mult: 2.1 },
        t50: { name: 'fifty years', years: 50, mult: 3.6 },
        perpetual: { name: 'in perpetuity', years: null, mult: 8 },
    },
    pricing: { plotBase: { village: 6, town: 12, city: 22, capital: 32 }, targetYears: 8, elasticity: 0.5, min: 0.6, max: 3, parishMult: 0.85, policies: { cheap: 0.7, fair: 1, dear: 1.4 } },
    markers: {},
    aging: { rotYears: 30, goneYears: 60, moundGoneYears: 20, oldYears: 60, brokenYears: 130 },
    coffinPlanks: 1,
    seedFill: 0.55,
    seedRecent: 0.5,
    newGroundCost: { village: 120, town: 260, city: 480, capital: 700 },
    newGroundAfterYears: 2,
    newGroundShare: 0.5,
    consecrate: { fee: { village: 40, town: 80, city: 150, capital: 220 }, minStanding: -20, days: 1 },
    sextonFee: { village: 3, town: 4, city: 5, capital: 6 },
    bones: { boneBase: 5, grinderTypes: ['city', 'capital'], glutPer: 0.06, glutDecay: 0.05, charnelPrice: 4, charnelStanding: 1 },
    mill: { cost: { village: 140, town: 180, city: 240, capital: 300 }, inputs: { wood: 8, stone: 4 }, days: 6, grindPerDay: 6, mealPerBone: 2 },
    meal: { mealBase: 3, farmFactor: { village: 1.3, town: 1.1, city: 0.9, capital: 0.8 }, soilPerUnit: 0.004, glutPer: 0.02, glutDecay: 0.04 },
    ossuary: { cost: { village: 100, town: 140, city: 200, capital: 260 }, inputs: { stone: 10 }, days: 8, foundBones: 12, perVisit: { village: 1, town: 1, city: 2, capital: 2 }, maxVisitors: { village: 2, town: 4, city: 7, capital: 10 }, bonesPerVisitor: 8 },
    gravedigger: { payPerGrave: { village: 3, town: 4, city: 5, capital: 6 }, maxPerDay: 4, energy: -14, sextonPerDay: 1 },
    kinMarkers: ['cross_wood', 'headstone_plain', 'headstone_round', 'headstone_carved', 'tomb'],
    robbery: { risk: 0.12, reputation: 6, goodsValue: 12 },
    goods: {},
    text: {},
};

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

let _cfg = null;
let _src;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** A stable hash of a string (FNV-1a). */
export function graveHash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}

export const GraveBook = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.graves : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            for (const k of ['yard', 'classOf', 'classes', 'terms', 'aging', 'consecrate', 'sextonFee', 'bones', 'mill', 'meal', 'ossuary', 'gravedigger', 'robbery', 'text', 'newGroundCost']) {
                _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            _cfg.pricing = { ...DEFAULTS.pricing, ...(_obj(d.pricing) || {}) };
            _cfg.pricing.plotBase = { ...DEFAULTS.pricing.plotBase, ...(_obj(_cfg.pricing.plotBase) || {}) };
            _cfg.pricing.policies = { ...DEFAULTS.pricing.policies, ...(_obj(_cfg.pricing.policies) || {}) };
            _cfg.markers = { ...(_obj(d.markers) || {}) };
            // An art manifest (assets/lpc/new/graves/manifest.json, merged in by build:data) overrides footprints
            const art = _obj(d.art) || {};
            for (const [id, a] of Object.entries(art)) {
                if (!_obj(a) || !_cfg.markers[id]) continue;
                const w = Math.max(1, Math.round(_num(a.tilesW, 0))), h = Math.max(1, Math.round(_num(a.tilesH, 0)));
                if (_num(a.tilesW, 0) > 0 && _num(a.tilesH, 0) > 0) _cfg.markers[id] = { ..._cfg.markers[id], tiles: [w, h] };
            }
        }
        return _cfg;
    },

    /** A per-settlement-type setting from a { village, town, city, capital } table. */
    byType(table, type) {
        const t = _obj(table) || {};
        return t[type] != null ? t[type] : t.village;
    },

    // ── Dates ──────────────────────────────────────

    yearOf(day, world) {
        const Y = GraveBook.config().daysPerYear;
        return _num(world && world.baseYear, 853) + Math.floor((_num(day) - 1) / Y);
    },

    yearsBetween(a, b) {
        return Math.max(0, Math.floor((_num(b) - _num(a)) / GraveBook.config().daysPerYear));
    },

    seasonOf(day) {
        const Y = GraveBook.config().daysPerYear;
        const d = ((Math.floor(_num(day)) - 1) % Y + Y) % Y;
        return SEASONS[Math.floor(d / (Y / 4))] || 'spring';
    },

    // ── The layout ─────────────────────────────────

    /** Which rows (counted in from the front) of an h-deep ground hold graves: pairs, a walk between. */
    graveRows(h) {
        const out = [];
        for (let k = 1; k < h; k++) if (k % 3 !== 0) out.push(k);
        return out;
    },

    /**
     * The plots of a w × h ground at (q0, r0): a grave is two tiles wide (its
     * marker at the head, `q`, its mound at q + 1); rows of graves in pairs
     * with a walk between, its front row (on the street, `front` 'south' or
     * 'north') kept for the railing and gate, a tile of path down each side.
     * Front rows first, west to east.
     */
    yardPlots(q0, r0, w, h, front = 'south') {
        const out = [];
        const r1 = r0 + h - 1;
        const per = Math.max(0, Math.floor((w - 2) / 2));
        const start = q0 + 1 + Math.floor((w - 2 - per * 2) / 2);
        for (const k of GraveBook.graveRows(h)) {
            const r = front === 'north' ? r0 + k : r1 - k;
            for (let i = 0; i < per; i++) out.push({ q: start + i * 2, r });
        }
        return out;
    },

    /** How many plots a w × h ground holds. */
    plotCount(w, h) {
        return Math.max(0, Math.floor((w - 2) / 2)) * GraveBook.graveRows(Math.max(0, h)).length;
    },

    /** The churchyard's size [w, h] for a place of this type. */
    yardSize(type) {
        const s = GraveBook.byType(GraveBook.config().yard, type);
        return Array.isArray(s) && s.length >= 2 ? [Math.max(4, s[0] | 0), Math.max(3, s[1] | 0)] : [7, 5];
    },

    // ── The book ───────────────────────────────────

    /** The settlement's graveyard (made on first asking). */
    of(settlement) {
        if (!settlement) return null;
        let g = settlement.graveyard;
        if (!_obj(g)) g = settlement.graveyard = { v: 1, grounds: {} };
        if (!_obj(g.grounds)) g.grounds = {};
        if (!Array.isArray(g.deaths)) g.deaths = [];
        if (!_obj(g.buried)) g.buried = {};
        for (const k of ['charnel', 'pit', 'boneGlut', 'mealGlut', 'digWork', 'opened']) g[k] = _num(g[k]);
        return g;
    },

    /** The town's own churchyard (made on first asking, sized for its type). */
    townGround(settlement) {
        const g = GraveBook.of(settlement);
        if (!g) return null;
        if (!_obj(g.grounds.town)) {
            const [w, h] = GraveBook.yardSize(settlement.type);
            g.grounds.town = GraveBook.newGround('town', 'town', 'The Churchyard', GraveBook.plotCount(w, h));
        }
        return GraveBook.groundShape(g.grounds.town);
    },

    newGround(id, owner, name, cap, extra = {}) {
        return { id, owner, name, cap: Math.max(0, cap | 0), plots: new Array(Math.max(0, cap | 0)).fill(null), open: {}, policy: 'fair', since: null, crypt: null, lot: null, ...extra };
    },

    /** Mend a ground loaded from an old save (or changed in size). */
    groundShape(ground) {
        if (!ground) return ground;
        if (!Array.isArray(ground.plots)) ground.plots = [];
        if (!_obj(ground.open)) ground.open = {};
        ground.cap = Math.max(0, _num(ground.cap, ground.plots.length));
        while (ground.plots.length < ground.cap) ground.plots.push(null);
        for (let i = 0; i < ground.plots.length; i++) if (ground.plots[i] === undefined) ground.plots[i] = null;
        return ground;
    },

    grounds(settlement) {
        const g = settlement && _obj(settlement.graveyard);
        return g && _obj(g.grounds) ? Object.values(g.grounds).filter(_obj) : [];
    },

    /** Every grave in a ground (its plots and its crypt). */
    gravesIn(ground) {
        if (!ground) return [];
        const out = (ground.plots || []).filter(Boolean);
        if (ground.crypt && Array.isArray(ground.crypt.graves)) out.push(...ground.crypt.graves);
        return out;
    },

    /** Free plots in a ground (not under a crypt). */
    freePlots(ground) {
        if (!ground) return [];
        const out = [];
        const held = ground.crypt && Array.isArray(ground.crypt.plots) ? new Set(ground.crypt.plots) : null;
        for (let i = 0; i < ground.cap; i++) if (!ground.plots[i] && !(held && held.has(i))) out.push(i);
        return out;
    },

    /** Free plots across every ground in town. */
    freeInTown(settlement) {
        return GraveBook.grounds(settlement).reduce((n, gr) => n + GraveBook.freePlots(gr).length, 0);
    },

    // ── Leases ─────────────────────────────────────

    term(id) {
        const t = GraveBook.config().terms[id];
        return t ? { id, ...t } : null;
    },

    /** Terms from the longest down: perpetual, t50, t25, t10. */
    termsDown() {
        const T = GraveBook.config().terms;
        return Object.keys(T).sort((a, b) => _num(T[b].mult) - _num(T[a].mult));
    },

    /** The day a lease taken on `day` runs out (null: never). */
    leaseUntil(termId, day) {
        const t = GraveBook.term(termId);
        if (!t || t.years == null) return null;
        return Math.floor(_num(day) + t.years * GraveBook.config().daysPerYear);
    },

    isExpired(grave, day) {
        return !!grave && grave.until != null && _num(day) >= grave.until;
    },

    // ── The dead ───────────────────────────────────

    /** A townsperson's station: pauper, common, middling or rich. */
    classOf(person) {
        const C = GraveBook.config();
        const role = person && (person.retired || person.role);
        const cls = (role && C.classOf[role]) || 'common';
        return C.classes[cls] ? cls : 'common';
    },

    classDef(cls) {
        const C = GraveBook.config();
        return C.classes[cls] || C.classes.common;
    },

    markerDef(id) {
        return GraveBook.config().markers[id] || null;
    },

    /** The marker a class raises over a grave (a hash of the grave picks among its kind). */
    pickMarker(cls, key) {
        const list = GraveBook.classDef(cls).markers || ['cross_wood'];
        return list[graveHash(`mk|${key}`) % list.length] || 'cross_wood';
    },

    /**
     * What stands over a grave today: its marker as the years have left it —
     * wood rots to a bare mound and then nothing, stone weathers and breaks.
     * null: unmarked.
     */
    markerNow(grave, day) {
        if (!grave) return null;
        const A = GraveBook.config().aging;
        const years = GraveBook.yearsBetween(grave.died, day);
        const m = grave.marker || 'grave_mound';
        const kind = (GraveBook.markerDef(m) || {}).kind || (m.startsWith('headstone') ? 'stone' : 'wood');
        // (a grave still kept on a lease is kept up by its family: its marker stands as raised)
        const tended = grave.until != null && _num(day) < grave.until;
        if (tended && years < _num(A.oldYears, 60)) return m;
        if (m === 'grave_mound' || m === 'grave_open') return years >= _num(A.moundGoneYears, 20) && !tended ? null : 'grave_mound';
        if (kind === 'wood') {
            if (years >= _num(A.goneYears, 60)) return null;
            if (years >= _num(A.rotYears, 30)) return 'grave_mound';
            return m;
        }
        if (kind === 'stone') {
            if (years >= _num(A.brokenYears, 130)) return 'headstone_broken';
            if (years >= _num(A.oldYears, 60)) return 'headstone_old';
            return m;
        }
        return m;
    },

    /** Can anyone still read who lies here? */
    isLegible(grave, day) {
        const m = GraveBook.markerNow(grave, day);
        return !!m && m !== 'grave_mound' && m !== 'headstone_broken';
    },

    // ── Prices ─────────────────────────────────────

    /** Deaths a year in the town: its recent deaths, or a share of its people. */
    deathsPerYear(settlement, day, residents = 0) {
        const g = settlement && settlement.graveyard;
        const C = GraveBook.config();
        const span = 5 * C.daysPerYear;
        const recent = g && Array.isArray(g.deaths) ? g.deaths.filter(d => d > _num(day) - span).length : 0;
        const fromPeople = Math.max(0, _num(residents)) * 0.02;
        return Math.max(0.5, recent / 5, fromPeople);
    },

    /** How dear plots are in town: (target years / years of room)^elasticity, clamped. */
    scarcity(settlement, day, residents = 0) {
        const P = GraveBook.config().pricing;
        const free = GraveBook.freeInTown(settlement);
        const room = free / GraveBook.deathsPerYear(settlement, day, residents);
        const s = Math.pow(_num(P.targetYears, 8) / Math.max(0.25, room), _num(P.elasticity, 0.5));
        return Math.max(_num(P.min, 0.6), Math.min(_num(P.max, 3), s));
    },

    /** A ten-year plot's going price in town. */
    plotBase(settlement, day, residents = 0) {
        const P = GraveBook.config().pricing;
        return _num(GraveBook.byType(P.plotBase, settlement && settlement.type), 8) * GraveBook.scarcity(settlement, day, residents);
    },

    /** What a lease of `termId` costs in a ground (the parish's fee, or the owner's policy). */
    leasePrice(settlement, ground, termId, day, residents = 0) {
        const P = GraveBook.config().pricing;
        const t = GraveBook.term(termId);
        if (!t) return Infinity;
        const mult = ground && ground.owner === 'town' ? _num(P.parishMult, 0.85) : _num(P.policies[(ground && ground.policy) || 'fair'], 1);
        return Math.max(1, Math.round(GraveBook.plotBase(settlement, day, residents) * _num(t.mult, 1) * mult));
    },

    /** A line for the grave: "Brom Ironwood, 812–861". */
    epitaph(grave, world) {
        if (!grave) return '';
        const b = grave.born != null ? GraveBook.yearOf(grave.born, world) : null;
        const d = GraveBook.yearOf(grave.died, world);
        return `${grave.name}${b != null ? `, ${b}–${d}` : `, died ${d}`}`;
    },
};
