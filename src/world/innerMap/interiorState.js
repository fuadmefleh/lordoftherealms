// ============================================
// InnerMap — interiors by the hour, the season and what has happened
// ============================================
// The planned interior (world/innerMap/interiorPlanner.js) is the house as it
// stands. This is the house as it is today, at this hour: a layer laid over the
// plan when it is shown (interiors.enterBuilding), laid again whenever the hour
// or the day turns or the floor changes while the player is inside
// (_interiorStateTick, from npcs.updateNPCs), and taken off on leaving
// (interiors.exitBuilding). Every change it makes is written in an undo log and
// taken back before it is laid again, so the plan underneath is never rewritten
// and nothing is saved: it is a pure function of the interior's key, the day,
// the hour and the world's state.
//
//   • The hour: hearths lit of a morning and evening (all day in winter),
//     banked at night (tile._furniture.lit / .banked — furnitureActions reads
//     lit === false as "the fire is out"); a tavern's fire all evening, a
//     smithy's forge and a bakery's oven in their trade's hours; candles lit
//     after dark (tile._decorLit, a candle piece's lit); windows shuttered at
//     night (tile._wallDecorState = 'shut'); the table laid at breakfast and
//     supper; a tavern's tables gather mugs as it fills of an evening
//     (data/townScenes.json crowdByHour — the same hours that bring its
//     patrons in, world/innerMap/townScenes.js) and are cleared when it empties.
//   • What has happened: a raid, a sack, plague looters, a fire — furniture
//     broken (.broken, "Broken …") or carried off, decor stripped, soot
//     (tile._soot), fading over the mark's days; a building rebuilt since is
//     clean. A town gone poorer than its houses were built for strips their
//     finery; one grown richer adds to it.
//   • The season and the calendar: firewood stacked by the hearths in winter
//     (never shutting a tile off from the door), furs on the beds (.furs);
//     garlands and greenery and extra food on feast days.
//
// Data: data/interiorState.json. Draws nothing from any rng: hashes only.

import { InnerMap } from './_ref.js';
import { DataLoader, SettlementWealth } from './_imports.js';
import { StreetSeasons } from '../streetSeasons.js';
import { TownMarks, markHash } from '../townMarks.js';

const DEFAULTS = {
    enabled: true,
    kinds: { tavern: ['tavern', 'inn', 'roadhouse', 'guest_house', 'hotel'], smithy: ['blacksmith', 'mint'], bakery: ['bakery'] },
    hearths: ['fireplace', 'oven', 'cauldron'],
    forges: ['forge'],
    fires: {
        home: { lit: [[5, 10], [17, 22]], winter: [[5, 23]], banked: [[22, 29]] },
        hall: { lit: [[7, 11], [17, 21]], winter: [[6, 22]], banked: [[21, 30]] },
        tavern: { lit: [[6, 11], [16, 26]], winter: [[6, 26]], banked: [[2, 6]] },
        work: { lit: [], winter: [[7, 18]], banked: [] },
        smithy: { lit: [[6, 19]], banked: [[19, 30]] },
        bakery: { lit: [[4, 15]], banked: [[15, 28]] },
        ownHomeAlwaysLit: true,
    },
    forgeHours: [[6, 19]],
    candles: { home: [[18, 23]], hall: [[18, 22]], tavern: [[17, 26]], work: [], smithy: [], bakery: [[4, 6]], winterDawn: [[5, 7]] },
    shutters: [[21, 30]],
    meals: {
        kinds: ['home', 'hall'],
        breakfast: { hours: [[6, 8]], items: ['bread', 'bowls'] },
        supper: { hours: [[18, 20]], items: ['bowls', 'plates', 'bread'] },
        tables: 2, on: ['table'],
    },
    tavern: {
        on: ['table', 'bar'], item: 'mugs', lateItems: ['plates', 'bottles'], lateAbove: 0.75, emptyBelow: 0.2,
        clear: ['mugs', 'plates', 'bottles', 'bowls'],
        crowdByHour: [4, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 3, 3, 2, 2, 3, 4, 6, 8, 9, 9, 8, 6],
    },
    marks: {
        raid: { days: 40, share: 0.6 }, sack: { days: 120, share: 0.85 }, plague: { days: 90 }, fire: { days: 60, share: 0.35 },
        scorched: { broken: 0.45, soot: 0.8 },
        broken: 0.55, removed: 0.3, stripDecor: 0.85, stripWall: 0.6, soot: 0.6,
        keep: ['stairs', 'well', 'millstone', 'altar', 'anvil', 'forge', 'fireplace', 'oven', 'cell', 'bar', 'stall', 'press', 'throne'],
        windows: ['window', 'curtains'],
    },
    wealth: {
        fall: 0.08, rise: 0.08, share: 0.7,
        finery: ['rug', 'candle', 'banner', 'statue'],
        fineDecor: ['candles', 'flowers', 'fruit', 'coins', 'bottles'],
        fineWall: ['painting', 'tapestry', 'mirror', 'clock', 'curtains'],
        riseItems: ['flowers', 'candles', 'fruit'], riseOn: ['table', 'desk', 'shelf', 'dresser', 'cupboard'], riseShare: 0.5,
    },
    winter: {
        coldTerrains: ['snow', 'ice', 'snow_peak'],
        firewood: { type: 'firewood', name: 'Firewood', icon: '🪵', passable: false, color: '#6a4a2a' },
        firewoodKinds: ['home', 'hall', 'tavern'],
        beds: ['bed'],
    },
    feast: {
        kinds: ['home', 'hall', 'tavern'], garland: 'banner', garlands: 4, greenery: 'flowers', food: ['bread', 'fruit'], tables: 3,
        midwinter: true, fair: true, holyDay: true, garlandsOnHolyDay: false,
    },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let _cfg = null;
let _cfgSrc;

/** data/interiorState.json over the defaults (section by section). */
function config() {
    const src = DataLoader._gamedata ? DataLoader._gamedata.interiorState : undefined;
    if (!_cfg || src !== _cfgSrc) {
        _cfgSrc = src;
        const d = _obj(src) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of Object.keys(DEFAULTS)) if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        out.fires = { ...DEFAULTS.fires, ...(_obj(d.fires) || {}) };
        _cfg = out;
    }
    return _cfg;
}

/** Is hour h within any [from, to) span (a span may run on past midnight: to > 24)? */
export function inSpans(h, spans) {
    for (const s of _arr(spans)) {
        const a = _num(s && s[0], 0), b = _num(s && s[1], 0);
        if ((h >= a && h < b) || (h + 24 >= a && h + 24 < b)) return true;
    }
    return false;
}

/** Ids of a tile's _decor ('mugs', ['mugs', 'bread'] or [{ type }]). */
function _ids(v) {
    if (!v) return [];
    return (Array.isArray(v) ? v : [v]).map(x => (typeof x === 'string' ? x : x && (x.type || x.id))).filter(Boolean).map(String);
}

// ── The undo log: every change written down, taken back in reverse ──
const _logs = new WeakMap();   // tiles → { log: [], sig }

function _set(log, o, k, v) {
    const had = Object.prototype.hasOwnProperty.call(o, k);
    log.push({ o, k, had, prev: o[k], v });
    o[k] = v;
}

/** Take the layer off these tiles (what someone else has since changed is left as they left it). */
export function revertInteriorState(tiles) {
    const st = tiles && _logs.get(tiles);
    if (!st) return false;
    for (let i = st.log.length - 1; i >= 0; i--) {
        const e = st.log[i];
        if (e.o[e.k] !== e.v) continue;
        if (e.had) e.o[e.k] = e.prev; else delete e.o[e.k];
    }
    _logs.delete(tiles);
    return true;
}

/** The kind of a building type: tavern, smithy, bakery, or the wealth floors' work / hall / home. */
export function interiorKind(type) {
    const C = config();
    const t = String(type || '').replace(/^player_/, '');
    for (const [k, list] of Object.entries(C.kinds || {})) if (_arr(list).includes(t)) return k;
    const g = DataLoader._gamedata;
    const F = (g && g.architecture && g.architecture.wealth && g.architecture.wealth.floors) || {};
    if (_arr(F.work).includes(t)) return 'work';
    if (_arr(F.hall).includes(t)) return 'hall';
    return 'home';
}

/**
 * Lay the layer on an interior's tiles. ctx: { key, building, hour, day, kind?, winter?,
 * settlement?, outerBuilding? (the street tile's customBuilding), ownHome?, feast?,
 * crowd? (0..1 a tavern's fill), forgeHours?, bakeryHours?, occupied? (Set 'q,r') }.
 * Takes off any layer already on them first. → a summary of what it did.
 */
export function applyInteriorStateTo(tiles, w, h, ctx = {}) {
    revertInteriorState(tiles);
    const C = config();
    const out = { lit: 0, banked: 0, candles: 0, shut: 0, meals: 0, mugs: 0, broken: 0, removed: 0, stripped: 0, soot: 0, poorer: 0, richer: 0, firewood: 0, furs: 0, garlands: 0, feast: 0 };
    if (!C.enabled || !tiles || !tiles.length) return out;
    const log = [];
    _logs.set(tiles, { log });
    const key = String(ctx.key || '');
    const hr = ((Math.floor(_num(ctx.hour, 12)) % 24) + 24) % 24;
    const day = Math.floor(_num(ctx.day, 0));
    const kind = ctx.kind || interiorKind(ctx.building && ctx.building.type);
    const winter = !!ctx.winter;
    const own = !!ctx.ownHome;
    const T = (q, r) => (tiles[r] && tiles[r][q]) || null;
    const H = (...p) => markHash(key, ...p);

    // The pieces: one entry per piece (a two-tile bed once), its tiles
    const pieces = new Map();
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t = T(q, r), f = t && t._furniture;
        if (!f) continue;
        const id = f.piece ? `${f.piece.q},${f.piece.r}` : `${q},${r}`;
        let p = pieces.get(id);
        if (!p) { p = { id, type: f.type, cells: [] }; pieces.set(id, p); }
        p.cells.push({ q, r, t });
    }
    const list = [...pieces.values()];
    const occupied = ctx.occupied || new Set();

    // ── What has happened (before the hour: a broken hearth is cold, a stripped table bare) ──
    const marks = interiorMarks(ctx, C);
    if (!own && (marks.loot > 0 || marks.soot > 0)) {
        const M = C.marks;
        const keep = new Set(_arr(M.keep));
        const windows = new Set(_arr(M.windows));
        for (const p of list) {
            if (keep.has(p.type)) continue;
            const f0 = p.cells[0].t._furniture;
            const passable = !!(f0 && f0.passable);
            if (passable && H('rm', p.id) < _num(M.removed, 0.3) * marks.loot) {
                for (const c of p.cells) { _set(log, c.t, '_furniture', null); if (c.t._decor) _set(log, c.t, '_decor', null); }
                out.removed++;
                continue;
            }
            if (H('br', p.id) < Math.max(_num(M.broken, 0.55) * marks.loot, marks.burnBroken)) {
                for (const c of p.cells) {
                    const f = c.t._furniture;
                    if (!f || f.broken) continue;
                    _set(log, f, 'broken', true);
                    _set(log, f, 'name', `Broken ${f.name || f.type}`);
                }
                out.broken++;
            }
        }
        for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            const t = T(q, r);
            if (!t) continue;
            if (t._decor && H('sd', q, r) < _num(M.stripDecor, 0.85) * marks.loot) { _set(log, t, '_decor', null); out.stripped++; }
            if (t._wallDecor && !windows.has(t._wallDecor) && H('sw', q, r) < _num(M.stripWall, 0.6) * marks.loot) { _set(log, t, '_wallDecor', null); out.stripped++; }
            if (!t._isDoor && marks.soot > 0 && H('so', q, r) < _num(M.soot, 0.6) * marks.soot) { _set(log, t, '_soot', true); out.soot++; }
        }
    }

    // ── A town poorer than its houses, or richer ──
    const trend = own || kind === 'work' ? 0 : wealthTrend(ctx, C);
    if (trend < 0) {
        const W = C.wealth;
        const finery = new Set(_arr(W.finery)), fineDecor = new Set(_arr(W.fineDecor)), fineWall = new Set(_arr(W.fineWall));
        for (const p of list) {
            const f0 = p.cells[0].t._furniture;
            if (!f0 || !f0.passable || !finery.has(p.type)) continue;
            if (H('pf', p.id) >= -trend) continue;
            for (const c of p.cells) _set(log, c.t, '_furniture', null);
            out.poorer++;
        }
        for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            const t = T(q, r);
            if (!t) continue;
            const ids = _ids(t._decor);
            if (ids.some(x => fineDecor.has(x)) && H('pd', q, r) < -trend) {
                const left = ids.filter(x => !fineDecor.has(x));
                _set(log, t, '_decor', left.length ? left : null);
                out.poorer++;
            }
            if (t._wallDecor && fineWall.has(t._wallDecor) && H('pw', q, r) < -trend) {
                _set(log, t, '_wallDecor', t._wallDecor === 'curtains' ? 'window' : null);
                out.poorer++;
            }
        }
    } else if (trend > 0) {
        const W = C.wealth;
        const on = new Set(_arr(W.riseOn)), items = _arr(W.riseItems);
        for (const p of list) {
            if (!on.has(p.type) || !items.length) continue;
            const c = p.cells[0];
            if (c.t._decor || H('rd', p.id) >= _num(W.riseShare, 0.5) * trend) continue;
            _set(log, c.t, '_decor', items[Math.floor(H('ri', p.id) * items.length) % items.length]);
            out.richer++;
        }
    }

    // ── Fires: lit, banked or out ──
    const F = C.fires[kind] || C.fires.home || {};
    const hearths = new Set(_arr(C.hearths)), forges = new Set(_arr(C.forges));
    for (const p of list) {
        let lit, banked = false;
        if (forges.has(p.type)) {
            lit = inSpans(hr, ctx.forgeHours || C.forgeHours);
            banked = !lit && inSpans(hr, (C.fires.smithy || {}).banked);
        } else if (hearths.has(p.type)) {
            const trade = (kind === 'bakery' && p.type === 'oven' && ctx.bakeryHours) ? ctx.bakeryHours : null;
            const spans = trade || (winter && F.winter ? F.winter : F.lit);
            lit = inSpans(hr, spans);
            banked = !lit && inSpans(hr, F.banked);
            if (own && C.fires.ownHomeAlwaysLit) { lit = true; banked = false; }
        } else continue;
        for (const c of p.cells) {
            const f = c.t._furniture;
            if (!f) continue;
            const was = f.broken && !own ? false : lit;
            _set(log, f, 'lit', was);
            if (banked) _set(log, f, 'banked', true);
        }
        if (lit) out.lit++; else if (banked) out.banked++;
    }

    // ── Candles after dark, shutters at night ──
    const candleSpans = _arr(C.candles[kind] || []).concat(winter ? _arr(C.candles.winterDawn) : []);
    const candlesLit = inSpans(hr, candleSpans);
    const shut = inSpans(hr, C.shutters);
    const windows = new Set(_arr(C.marks.windows));
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t = T(q, r);
        if (!t) continue;
        if (_ids(t._decor).includes('candles')) { _set(log, t, '_decorLit', candlesLit); if (candlesLit) out.candles++; }
        const f = t._furniture;
        if (f && f.type === 'candle') { _set(log, f, 'lit', candlesLit && !f.broken); if (candlesLit) out.candles++; }
        if (shut && t._wallDecor && windows.has(t._wallDecor)) { _set(log, t, '_wallDecorState', 'shut'); out.shut++; }
    }

    // ── The table laid at mealtimes; a tavern's mugs as it fills ──
    const addTo = (t, more, cap = 3) => {
        const ids = _ids(t._decor);
        const next = ids.slice();
        for (const x of more) if (!next.includes(x) && next.length < cap) next.push(x);
        if (next.length !== ids.length) { _set(log, t, '_decor', next); return true; }
        return false;
    };
    const tables = (types) => list.filter(p => _arr(types).includes(p.type) && !p.cells[0].t._furniture.broken)
        .sort((a, b) => H('tb', a.id) - H('tb', b.id));
    const ML = C.meals;
    if (_arr(ML.kinds).includes(kind)) {
        const meal = inSpans(hr, (ML.breakfast || {}).hours) ? ML.breakfast : inSpans(hr, (ML.supper || {}).hours) ? ML.supper : null;
        // (not in the player's own home: its table is theirs to lay, world/innerMap/furnishing.js)
        if (meal && !own) for (const p of tables(ML.on).slice(0, Math.max(0, _num(ML.tables, 2)))) if (addTo(p.cells[0].t, _arr(meal.items))) out.meals++;
    }
    if (kind === 'tavern') {
        const TV = C.tavern;
        const fill = _clamp(_num(ctx.crowd, tavernFill(hr, C)), 0, 1);
        const all = tables(TV.on);
        if (fill < _num(TV.emptyBelow, 0.2)) {
            const clear = new Set(_arr(TV.clear));
            for (const p of all) {
                if (p.type !== 'table') continue;
                for (const c of p.cells) {
                    const ids = _ids(c.t._decor);
                    if (!ids.some(x => clear.has(x))) continue;
                    const left = ids.filter(x => !clear.has(x));
                    _set(log, c.t, '_decor', left.length ? left : null);
                }
            }
        } else {
            const n = Math.round(fill * all.length);
            const late = fill >= _num(TV.lateAbove, 0.75) ? _arr(TV.lateItems) : [];
            for (const p of all.slice(0, n)) {
                const extra = late.length && H('lt', p.id) < 0.5 ? [late[Math.floor(H('li', p.id) * late.length) % late.length]] : [];
                if (addTo(p.cells[0].t, [TV.item || 'mugs', ...extra])) out.mugs++;
            }
        }
    }

    // ── Winter: furs on the beds, firewood by the hearths ──
    const WI = C.winter;
    if (winter) {
        const beds = new Set(_arr(WI.beds));
        for (const p of list) {
            if (!beds.has(p.type)) continue;
            for (const c of p.cells) if (c.t._furniture) _set(log, c.t._furniture, 'furs', true);
            out.furs++;
        }
        if (!own && _arr(WI.firewoodKinds).includes(kind) && _obj(WI.firewood)) {
            for (const p of list) {
                if (!hearths.has(p.type) || (p.type !== 'fireplace' && p.type !== 'oven')) continue;
                if (_stackFirewood(tiles, w, h, p, WI.firewood, log, occupied, H)) out.firewood++;
            }
        }
    }

    // ── Feast days: garlands, greenery and more on the table ──
    const FE = C.feast;
    const feast = ctx.feast || null;
    if (feast && _arr(FE.kinds).includes(kind)) {
        if (feast !== 'holy' || FE.garlandsOnHolyDay) out.garlands = _hangGarlands(tiles, w, h, FE, log, H);
        const extra = [FE.greenery, ..._arr(FE.food)].filter(Boolean);
        for (const p of tables(['table']).slice(0, Math.max(0, _num(FE.tables, 3)))) if (addTo(p.cells[0].t, extra, 4)) out.feast++;
    }
    return out;
}

/** A tavern's fill at hour h, 0..1 (the patrons the hour brings in against the evening's most). */
function tavernFill(hr, C = config()) {
    const row = _arr(C.tavern.crowdByHour);
    const max = Math.max(1, ...row.map(x => _num(x)));
    return _num(row[hr], 0) / max;
}

/**
 * What has happened to this building: { loot 0..1, soot 0..1, burnBroken 0..1, why[] }.
 * Read from the town (settlement.lastRaidedDay, its 'sack' and 'fire' marks, plague looting)
 * and the building on the street (customBuilding.ruin 'scorched', .rebuilt).
 */
export function interiorMarks(ctx, C = config()) {
    const res = { loot: 0, soot: 0, burnBroken: 0, why: [] };
    const M = C.marks;
    const s = ctx.settlement;
    const b = ctx.building || {};
    const cb = ctx.outerBuilding || null;
    const day = Math.floor(_num(ctx.day, 0));
    const bkey = `${b.q},${b.r}`;
    const rebuilt = cb && Number.isFinite(cb.rebuilt) ? cb.rebuilt : -Infinity;
    const fade = (at, days) => {
        const age = day - at;
        if (!(age >= 0) || at <= rebuilt) return 0;
        return _clamp(1 - age / Math.max(1, _num(days, 1)), 0, 1);
    };
    const hit = (kind, at, spec, share = 1) => {
        const sev = fade(at, spec.days);
        if (sev <= 0 || markHash('mark', kind, at, ctx.key || bkey) >= share) return 0;
        res.why.push(kind);
        return sev;
    };
    if (cb && cb.ruin === 'scorched') {
        res.soot = Math.max(res.soot, _num(M.scorched.soot, 0.8));
        res.burnBroken = Math.max(res.burnBroken, _num(M.scorched.broken, 0.45));
        res.why.push('scorched');
    }
    if (!s) return res;
    if (Number.isFinite(s.lastRaidedDay)) res.loot = Math.max(res.loot, hit('raid', s.lastRaidedDay, M.raid, _num(M.raid.share, 0.6)));
    for (const m of TownMarks.marks(s)) {
        if (m.k === 'sack') res.loot = Math.max(res.loot, hit('sack', m.d, M.sack, _num(M.sack.share, 0.85)));
        else if (m.k === 'fire') res.soot = Math.max(res.soot, hit('fire', m.d, M.fire, _num(M.fire.share, 0.35)));
    }
    const pl = s.plague && _obj(s.plague.looted);
    if (pl && Number.isFinite(pl[bkey])) res.loot = Math.max(res.loot, hit('plague', pl[bkey], M.plague));
    return res;
}

/**
 * How far the town's wealth has moved from what its buildings were built with (−1..1, 0
 * within the dead band, and only for the share of households it touches — a hash of the key).
 */
export function wealthTrend(ctx, C = config()) {
    const s = ctx.settlement;
    if (!s || !_obj(s.buildWealth) || !Number.isFinite(s.buildWealth.score)) return 0;
    const W = C.wealth;
    const d = SettlementWealth.score(s) - s.buildWealth.score;
    if (markHash(ctx.key || '', 'wealth') >= _num(W.share, 0.7)) return 0;
    if (d <= -_num(W.fall, 0.08)) return -_clamp(-d / (_num(W.fall, 0.08) * 2), 0.5, 1);
    if (d >= _num(W.rise, 0.08)) return _clamp(d / (_num(W.rise, 0.08) * 2), 0.5, 1);
    return 0;
}

/** Tiles reached from the way in (the doors, else the stairs) over passable ground. */
function _reach(tiles, w, h) {
    const starts = [];
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t = tiles[r][q];
        if (t && (t._isDoor || t._stairs)) starts.push([q, r]);
    }
    if (!starts.length) {
        outer: for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            const t = tiles[r][q];
            if (t && t.subTerrain && t.subTerrain.passable) { starts.push([q, r]); break outer; }
        }
    }
    const seen = new Set(starts.map(([q, r]) => `${q},${r}`));
    const queue = starts.slice();
    while (queue.length) {
        const [q, r] = queue.shift();
        for (const [dq, dr] of DIRS4) {
            const t = tiles[r + dr] && tiles[r + dr][q + dq], k = `${q + dq},${r + dr}`;
            if (!t || seen.has(k) || !t.subTerrain || !t.subTerrain.passable) continue;
            seen.add(k); queue.push([q + dq, r + dr]);
        }
    }
    return seen;
}

/** A stack of firewood beside a hearth, on a free tile, where it shuts nothing off from the door. */
function _stackFirewood(tiles, w, h, piece, spec, log, occupied, H) {
    const T = (q, r) => (tiles[r] && tiles[r][q]) || null;
    const near = (q, r) => DIRS4.some(([dq, dr]) => { const o = T(q + dq, r + dr); return !!(o && (o._isDoor || o._doorway || o._stairs)); });
    const free = (q, r) => {
        const t = T(q, r);
        return !!(t && t.baseTerrain !== 'wall' && !t._isDoor && !t._doorway && !t._stairs && !t._innerWall && !t._furniture && !t.customObject
            && t.subTerrain && t.subTerrain.passable && !occupied.has(`${q},${r}`) && !near(q, r) && r < h - 2);
    };
    // (one already stacked beside it, by its builders: enough)
    const wood = spec.type || 'firewood';
    if (piece.cells.some(c => DIRS4.some(([dq, dr]) => { const o = T(c.q + dq, c.r + dr); return !!(o && o._furniture && o._furniture.type === wood); }))) return false;
    const spots = [];
    for (const c of piece.cells) for (const [dq, dr] of DIRS4) {
        const q = c.q + dq, r = c.r + dr;
        if (free(q, r) && !spots.some(s => s[0] === q && s[1] === r)) spots.push([q, r]);
    }
    spots.sort((a, b) => H('fw', a[0], a[1]) - H('fw', b[0], b[1]));
    const before = spec.passable ? null : _reach(tiles, w, h);
    for (const [q, r] of spots) {
        const t = T(q, r);
        const at = log.length;
        _set(log, t, '_furniture', { type: spec.type || 'firewood', name: spec.name || 'Firewood', icon: spec.icon || '🪵', passable: !!spec.passable, _seasonal: true });
        if (!spec.passable) _set(log, t, 'subTerrain', { id: `furniture_${spec.type || 'firewood'}`, name: spec.name || 'Firewood', icon: spec.icon || '🪵', color: spec.color || '#6a4a2a', passable: false });
        if (before) {
            const after = _reach(tiles, w, h);
            let ok = true;
            for (const k of before) {
                if (k === `${q},${r}`) continue;
                if (!after.has(k)) { ok = false; break; }
            }
            if (!ok) {
                // (undo just this stack)
                while (log.length > at) { const e = log.pop(); if (e.had) e.o[e.k] = e.prev; else delete e.o[e.k]; }
                continue;
            }
        }
        return true;
    }
    return false;
}

/** Garlands on the bare walls facing into the rooms (never beside another hanging). */
function _hangGarlands(tiles, w, h, FE, log, H) {
    const T = (q, r) => (tiles[r] && tiles[r][q]) || null;
    const floor = (q, r) => { const t = T(q, r); return !!(t && t.baseTerrain !== 'wall' && !t._isDoor && !t._innerWall); };
    const spots = [];
    for (let r = 0; r < h - 1; r++) for (let q = 0; q < w; q++) {
        const t = T(q, r);
        if (!t || t.baseTerrain !== 'wall' || t._wallDecor || t._isDoor) continue;
        const face = floor(q, r + 1) ? 'down' : floor(q + 1, r) ? 'right' : floor(q - 1, r) ? 'left' : null;
        if (!face) continue;
        if (DIRS4.some(([dq, dr]) => { const o = T(q + dq, r + dr); return !!(o && o._wallDecor); })) continue;
        spots.push({ q, r, face });
    }
    spots.sort((a, b) => H('gl', a.q, a.r) - H('gl', b.q, b.r));
    let n = 0;
    for (const s of spots) {
        if (n >= Math.max(0, _num(FE.garlands, 4))) break;
        if (DIRS4.some(([dq, dr]) => { const o = T(s.q + dq, s.r + dr); return !!(o && o._wallDecor); })) continue;
        const t = T(s.q, s.r);
        _set(log, t, '_wallDecor', FE.garland || 'banner');
        _set(log, t, '_wallDecorFace', s.face);
        _set(log, t, '_garland', true);
        n++;
    }
    return n;
}

Object.assign(InnerMap, {
    /** The interior-state settings (data/interiorState.json over the defaults). */
    interiorStateConfig: config,

    /** The feast on `day` in this town: 'midwinter' | 'fair' | 'holy' | null. */
    interiorFeast(day = this.worldDay || 0, settlement = null) {
        const FE = config().feast;
        if (FE.midwinter && StreetSeasons.midwinterOn(day)) return 'midwinter';
        if (FE.fair && settlement && StreetSeasons.fairOn(settlement, day)) return 'fair';
        if (FE.holyDay && this.isHolyDay && this.isHolyDay(day)) return 'holy';
        return null;
    },

    /** Everything the layer reads for the interior shown now (building, key, the hour and the world). */
    _interiorStateCtx(building, key) {
        const wt = this._currentWorldTileRef || null;
        const settlement = (wt && wt.settlement) || null;
        const day = Math.floor(_num(this.worldDay, 0));
        const C = config();
        const terrain = wt && wt.terrain && wt.terrain.id;
        const winter = StreetSeasons.seasonOf(day) === 'Winter' || _arr(C.winter.coldTerrains).includes(terrain);
        const ot = this._outerMapState && this._outerMapState.tiles;
        const outerBuilding = (ot && ot[building.r] && ot[building.r][building.q] && ot[building.r][building.q].customBuilding) || null;
        const hour = ((Math.floor(_num(this.timeOfDay, 8)) % 24) + 24) % 24;
        const kind = interiorKind(building.type);
        // The trade's own hours (data/townScenes.json interiors), the tavern's crowd by the hour
        const scenes = this.townScenesConfig ? (this.townScenesConfig().interiors || {}) : {};
        const span = (K) => (K && Array.isArray(K.hours) ? [[_num(K.hours[0]), _num(K.hours[1])]] : null);
        let crowd;
        if (kind === 'tavern' && scenes.tavern && Array.isArray(scenes.tavern.crowdByHour)) {
            const row = scenes.tavern.crowdByHour.map(x => _num(x));
            crowd = _num(row[hour]) / Math.max(1, ...row);
        }
        const occupied = new Set((this.npcs || []).map(n => `${n.q},${n.r}`));
        occupied.add(`${this.playerInnerQ},${this.playerInnerR}`);
        return {
            key: `${key}_f${this._floor || 0}`, building, hour, day, kind, winter, settlement, outerBuilding,
            ownHome: !!(this.isOwnHome && this.isOwnHome(building)),
            feast: this.interiorFeast(day, settlement),
            forgeHours: span(scenes.smithy), bakeryHours: span(scenes.bakery), crowd, occupied,
        };
    },

    /** Lay the layer on the interior shown (interiors.enterBuilding). */
    _applyInteriorState(building = this._insideBuilding, key = null) {
        if (!building || !this.tiles) return null;
        if (building._jail || building.type === 'jail' || building._underground) return null;
        if (this._istate && this._istate.tiles !== this.tiles) revertInteriorState(this._istate.tiles);
        const k = key || (this._istate && this._istate.building === building ? this._istate.key : `${building.type}_${building.q}_${building.r}`);
        const ctx = this._interiorStateCtx(building, k);
        const res = applyInteriorStateTo(this.tiles, this.width, this.height, ctx);
        this._istate = { tiles: this.tiles, building, key: k, sig: `${ctx.day}|${ctx.hour}|${this._floor || 0}` };
        // Nobody keeps to a piece the layer has broken: the household's beds counted again, a
        // sleeper in a broken bed laid elsewhere (world/innerMap/householdRooms.js, floors.js)
        if (res && res.broken) this._afterBreakage();
        // A shop's shelves and barrels by what its market holds (world/innerMap/shopStock.js: once a day)
        if (this._dressShopStock) this._dressShopStock(building);
        return res;
    },

    /**
     * After the layer has broken pieces on this floor: the household's bed plan made afresh
     * (broken beds are nobody's), and anyone lying in a broken bed or cradle, or sat on a
     * broken seat, moved — to another bed (or a bedroll), or up onto the floor.
     */
    _afterBreakage() {
        this._hhPlanCache = null;
        // (on entering, the layer is laid before anyone is placed: the street's list is not this floor's)
        if (!this._insideBuilding || (this._outerMapState && this.npcs === this._outerMapState.npcs)) return;
        const interior = { tiles: this.tiles, width: this.width, height: this.height };
        const brokenAt = (q, r) => { const t = this.tiles[r] && this.tiles[r][q]; return !!(t && t._furniture && t._furniture.broken); };
        for (const npc of this.npcs || []) {
            if (npc._asleep && !npc._asleep.bedroll && brokenAt(npc._asleep.q, npc._asleep.r) && this._placeNpcOnFloor) {
                this._sleepersPlaced = (this.npcs || []).filter(n => n !== npc && n._asleep).map(n => ({ q: n._asleep.q, r: n._asleep.r }));
                this._placeNpcOnFloor(npc, interior);
                this._sleepersPlaced = null;
            } else if (npc._act && npc._act.spot && brokenAt(npc._act.spot.q, npc._act.spot.r) && this.yieldFurniture) {
                this.yieldFurniture(npc);
            }
        }
    },

    /** Each frame inside (npcs.updateNPCs): laid again only when the hour, the day or the floor has turned. */
    _interiorStateTick() {
        const b = this._insideBuilding;
        const S = this._istate;
        if (!b || !S || S.building !== b) return;
        const hour = ((Math.floor(_num(this.timeOfDay, 8)) % 24) + 24) % 24;
        if (S.tiles === this.tiles && S.sig === `${Math.floor(_num(this.worldDay, 0))}|${hour}|${this._floor || 0}`) return;
        this._applyInteriorState(b, S.key);
    },

    /** Take the layer off (interiors.exitBuilding): the cached interior is the plan again. */
    _clearInteriorState() {
        if (this._istate) revertInteriorState(this._istate.tiles);
        this._istate = null;
    },
});
