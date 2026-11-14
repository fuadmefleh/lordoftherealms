// ============================================
// InnerMap — the season on the street: ice, the going underfoot, festivals
// ============================================
// What the season has done to this hex today (world/streetSeasons.js) made
// real on the street map:
//
//   • The look: the terrain sheets the map wears (_streetLookSeason, read by
//     enter() before the map is stamped) — a winter with no snow lying looks
//     bare and brown, deep snow in autumn or spring looks like winter.
//   • Ice: in a hard winter the ponds, lakes and rivers freeze (never the
//     sea). Frozen water takes a frozen sub-terrain, walkable — so the
//     player, the townsfolk and the beasts cross it, nothing swims in it
//     (world/innerMap/swimming.js isSwimmable), the water's surf and fish
//     stop (they skip /frozen|ice/). Near the thaw, or before it has set, it
//     is thin: paths shy from it (_iceCost) and a step on it may crack it
//     (_iceStep) and drop the player in the freezing water. The hole stays
//     open a couple of days. Thawed, the water is given back.
//   • The going: a pace for every cell (_groundPace), for feet and for carts —
//     deep snow off the cleared streets, mud on unpaved ground after rain,
//     slush in the thaw, ice.
//   • The town's calendar: the harvest fair's stalls and produce on the square
//     in autumn, the midwinter bonfire, snowmen while the snow lasts; the
//     townsfolk go to them, shovel the street by their doors of a snowy
//     morning, play in the snow, and go out sowing the fields in spring
//     (_seasonPick / _seasonArrived, called by world/innerMap/townLife.js).
//
// Everything is worked out again on entering a map and at each new day
// (ui/innerMapSeasons.js); none of it is saved — the street maps are dealt
// again, and the ground is a pure function of the day. Draws only from
// Utils (the crack, who goes where) and hashes.

import { InnerMap } from './_ref.js';
import { Utils, TownProps, CustomObjects } from './_imports.js';
import { StreetSeasons, ssHash, ssStrHash } from '../streetSeasons.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLD_TERRAINS = ['snow', 'ice', 'snow_peak'];

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function _dirTo(dq, dr) {
    if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
    return dr >= 0 ? 2 : 0;
}
function _span(range, rnd) {
    const [a, b] = Array.isArray(range) ? range : [10, 20];
    return _num(a, 10) + rnd() * (_num(b, 20) - _num(a, 10));
}
function _pick(list, rnd) {
    return Array.isArray(list) && list.length ? list[Math.floor(rnd() * list.length)] : null;
}

// The frozen sub-terrains, one per water and kind of ice (kept: the ground cache compares them by identity)
const _frozen = new Map();
function _frozenSub(orig, thin) {
    const id = `frozen_${(orig && orig.id) || 'water'}${thin ? '_thin' : ''}`;
    let s = _frozen.get(id);
    if (!s) {
        s = { id, name: thin ? 'Thin Ice' : 'Ice', icon: '🧊', color: thin ? '#a9cfe0' : '#d4e9f2', passable: true, frozen: true, thin: !!thin };
        _frozen.set(id, s);
    }
    return s;
}

/** The kind of water a cell is: 'sea' | 'lake' | 'river' | 'pond'. */
function _waterKind(sub) {
    const id = String((sub && sub.id) || '');
    if (/sea|ocean/.test(id)) return 'sea';
    if (/river|stream/.test(id)) return 'river';
    if (/lake/.test(id)) return 'lake';
    return 'pond';
}

Object.assign(InnerMap, {
    /** Today's street season for this map (see _bindStreetSeason), or null. */
    _ss: null,
    // what the ground cache hangs on (ui/innerMapLayers/groundCache.js): changes when the ground's look does
    _ssKey: '',
    _ssDay: null,
    _ssPace: null,
    _ssCartPace: null,
    _ssPaceTiles: null,
    _ssFair: null,
    _ssSnowmen: null,
    _ssMusicianId: null,
    _ssEvent: null,
    _ssThinSteps: 0,

    /**
     * The season the street map should wear (enter(), before the map is stamped):
     * the calendar's, or the ground's (world/streetSeasons.js lookSeason).
     */
    _streetLookSeason(world, worldTile, q, r, calendar) {
        if (!world || !world.weather || !StreetSeasons.config().enabled || !worldTile) return calendar;
        const id = worldTile.terrain ? worldTile.terrain.id : null;
        if (COLD_TERRAINS.includes(id)) return calendar;
        const st = StreetSeasons.state(world, q, r, world.day);
        return StreetSeasons.lookSeason(calendar, st);
    },

    /**
     * Lay today's season on this map: the ice, the going, the festival's props, the
     * snowmen. On entering (interiors.js enter) and at each new day (ui/innerMapSeasons.js).
     */
    _bindStreetSeason(world, worldTile, q, r) {
        if (!this.tiles || !this.tiles.length) return null;
        const day = world ? Math.floor(_num(world.day, _num(this.worldDay, 1))) : _num(this.worldDay, 1);
        const cfg = StreetSeasons.config();
        const settlement = worldTile ? worldTile.settlement || null : null;
        this._ssAt = { q, r };
        this._ssSettlement = settlement;
        this._ssDay = day;
        const cold = worldTile && worldTile.terrain && COLD_TERRAINS.includes(worldTile.terrain.id);
        if (!cfg.enabled || !world || !world.weather || cold) {
            this._ss = null;
            this._ssKey = '';
            this._reconcileIce(null, day);
            this._reconcileSeasonProps(null, day);
            this._ssPace = null; this._ssCartPace = null; this._ssPaceTiles = null;
            this._ssSnowmen = null;
            return null;
        }
        const st = StreetSeasons.state(world, q, r, day);
        const look = this.season || st.season;
        const winterLook = look === 'Winter';
        const S = cfg.snow;
        const ss = {
            ...st,
            look,
            winterLook,
            // a dusting over ground that isn't yet white (or what is left of the snow in the thaw)
            dust: !winterLook && st.snow > 0.02 ? _clamp(st.snow / Math.max(0.05, _num(S.lookWinterAt, 0.32)), 0, 1) : 0,
            banks: winterLook && st.snow >= _num(S.bankAt, 0.38),
            roof: st.snow >= _num(S.roofAt, 0.12) ? _clamp(1 + Math.floor(st.snow * 3) - (st.slush > 0.3 ? 1 : 0), 1, 3) : 0,
            mudShow: st.mud >= _num(cfg.mud.showAt, 0.18) ? st.mud : 0,
            leavesShow: winterLook ? 0 : st.leaves,
            settlement: !!settlement,
        };
        this._ss = ss;
        // The street's own weather to match: what falls on a freezing day is snow, and the air as cold as the ground says
        if (this.weather && st.snowing && /rain|storm/.test(String(this.weather.type || ''))) {
            this.weather = { type: this.weather.type === 'storm' ? 'blizzard' : 'snow', intensity: this.weather.intensity || 0.6 };
        }
        if (Number.isFinite(st.celsius)) {
            const c = Math.round(st.celsius);
            this.temperature = { value: _clamp((c + 30) / 80, 0, 1), celsius: c, fahrenheit: Math.round(c * 1.8 + 32) };
        }
        this._ssKey =[look, Math.round(ss.dust * 4), ss.banks ? 1 : 0, Math.round(ss.mudShow * 4), Math.round(ss.leavesShow * 5),
            Math.round(st.slush * 3), Math.round(st.ice * 10), st.thawing ? 1 : 0, ss.roof].join('|');
        this._reconcileIce(ss, day);
        this._reconcileSeasonProps(world, day);
        this._buildPaceGrid(ss);
        this._placeSnowmen(ss, day);
        return ss;
    },

    // ──────────── ICE ────────────

    /** Freeze or thaw this map's water to today's ice (a cell broken through stays open a while). */
    _reconcileIce(ss, day) {
        const tiles = this.tiles;
        if (!tiles) return;
        const I = StreetSeasons.config().ice;
        const refreeze = Math.max(0, _num(I.holeRefreezeDays, 2));
        const cost = Math.max(0, _num(I.thinPathCost, 6));
        const canFreeze = !!(ss && ss.winterLook);
        const byKind = {};
        const iceFor = kind => byKind[kind] || (byKind[kind] = canFreeze ? StreetSeasons.iceOn(ss, kind) : { state: 'none', strength: 0 });
        let frozen = 0, solid = 0, changed = 0;
        for (const row of tiles) {
            for (const t of row) {
                if (!t) continue;
                const orig = t._ssOrigSub || t.subTerrain;
                const wet = t._ssOrigSub || t._wet || (orig && /_water$/.test(orig.id || ''));
                if (!wet) continue;
                if (t._deck || t._pier || t._isInterior || t.customBuilding || t.customBuildingPart) continue;
                // (under a bridge only the look: the bridge is walked on as ever)
                if (t._bridge) { t._iced = iceFor(_waterKind(orig)).state === 'none' ? 0 : 2; continue; }
                // (already frozen by the map itself — a glacier, a frozen stream: left as it is)
                if (!t._ssOrigSub && orig && /frozen|ice|glacier/.test(orig.id || '')) continue;
                let ice = iceFor(_waterKind(orig));
                if (t._ssHole != null) {
                    if (day - t._ssHole < refreeze && ice.state !== 'none') ice = { state: 'none', strength: 0 };
                    else delete t._ssHole;
                }
                if (ice.state === 'none') {
                    if (t._ssOrigSub) { t.subTerrain = t._ssOrigSub; delete t._ssOrigSub; changed++; }
                    if (t._iced) { t._iced = 0; t._iceCost = 0; t._iceStrength = 0; }
                    continue;
                }
                const thin = ice.state === 'thin';
                if (!t._ssOrigSub) t._ssOrigSub = t.subTerrain;
                const fs = _frozenSub(t._ssOrigSub, thin);
                if (t.subTerrain !== fs) changed++;
                t.subTerrain = fs;
                t._iced = thin ? 1 : 2;
                t._iceStrength = ice.strength;
                t._iceCost = thin ? cost : 0;
                frozen++;
                if (!thin) solid++;
            }
        }
        if (ss) { ss.frozenCells = frozen; ss.solidCells = solid; }
        // (the water's surf, its fish and its flow are laid out afresh: ui/innerMapLayers/waterFx.js, surfaceFish.js)
        if (changed) this._waterStamp = (this._waterStamp || 0) + 1;
        this._ssIceChanged = changed;
    },

    /** The ice at (q, r): 0 none, 1 thin, 2 solid. */
    iceAt(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        return t && t._iced ? t._iced : 0;
    },

    /**
     * The player stepped onto (q, r) (world/innerMap/movement.js): thin ice may crack
     * under them. → null, { kind: 'thin' } (a warning), or { kind: 'crack' } (they're in).
     */
    _iceStep(q, r) {
        if (this._insideBuilding) return null;
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!t || t._iced !== 1) { this._ssThinSteps = 0; return null; }
        const I = StreetSeasons.config().ice;
        const n = ++this._ssThinSteps;
        if (Utils.random() < StreetSeasons.crackChance(t._iceStrength)) {
            this._breakIce(q, r);
            this._ssThinSteps = 0;
            return (this._ssEvent = { kind: 'crack', q, r, at: _now() });
        }
        const every = Math.max(1, Math.floor(_num(I.warnEvery, 6)));
        if (n === 1 || n % every === 0) return (this._ssEvent = { kind: 'thin', q, r, at: _now() });
        return null;
    },

    /** The ice gives way at (q, r): the water open there again (a hole, a few days). */
    _breakIce(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!t || !t._ssOrigSub) return false;
        t.subTerrain = t._ssOrigSub;
        delete t._ssOrigSub;
        t._iced = 0;
        t._iceCost = 0;
        t._iceStrength = 0;
        t._ssHole = _num(this._ssDay, _num(this.worldDay, 0));
        this._waterStamp = (this._waterStamp || 0) + 1;
        if (this._ssPace && this._ssPaceTiles === this.tiles) {
            const i = r * this.width + q;
            this._ssPace[i] = 1;
            if (this._ssCartPace) this._ssCartPace[i] = 1;
        }
        return true;
    },

    // ──────────── THE GOING ────────────

    /** Every cell's pace today, for feet and for carts (null: all at 1). */
    _buildPaceGrid(ss) {
        const tiles = this.tiles;
        this._ssPace = null; this._ssCartPace = null; this._ssPaceTiles = null;
        if (!ss || !tiles || !tiles.length) return;
        const H = tiles.length, W = tiles[0].length;
        const feet = new Float32Array(W * H), carts = new Float32Array(W * H);
        // (the few kinds of ground, each worked out once)
        const kinds = {};
        const of = (g) => kinds[g] || (kinds[g] = [StreetSeasons.pace(ss, g, false), StreetSeasons.pace(ss, g, true)]);
        let any = false;
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            for (let q = 0; q < W; q++) {
                const t = row[q];
                const g = this._groundKind(t);
                const p = of(g);
                feet[r * W + q] = p[0];
                carts[r * W + q] = p[1];
                if (p[0] !== 1 || p[1] !== 1) any = true;
            }
        }
        if (!any) return;
        this._ssPace = feet; this._ssCartPace = carts; this._ssPaceTiles = tiles; this._ssPaceW = W;
    },

    /** The kind of ground a cell is underfoot: 'street' | 'road' | 'soft' | 'open' | 'ice' | 'thinIce' | 'water'. */
    _groundKind(t) {
        if (!t) return 'open';
        if (t._bridge) return 'street';
        if (t._iced) return t._iced === 1 ? 'thinIce' : 'ice';
        if (t._wet && !(t.subTerrain && t.subTerrain.passable)) return 'water';
        if (t.paving || t._pave || t._bridge || t._pier || t._deck || t._isInterior) return 'street';
        if (t.isRoad) return 'road';
        if (t._townSoil || t._fieldSoil || t.baseTerrain === 'dirt' || t._wet) return 'soft';
        return 'open';
    },

    /** × speed over (q, r) today (cart: a cart's wheels). 1 off the map or indoors. */
    _groundPace(q, r, cart = false) {
        const g = cart ? this._ssCartPace : this._ssPace;
        if (!g || this._ssPaceTiles !== this.tiles || this._insideBuilding) return 1;
        if (q < 0 || r < 0 || q >= this._ssPaceW || r >= g.length / this._ssPaceW) return 1;
        return g[r * this._ssPaceW + q] || 1;
    },

    // ──────────── THE TOWN'S CALENDAR ────────────

    /** Is this a proper town (not a dawn camp)? */
    _ssIsTown(settlement) {
        return !!(settlement && !(this._isDawnVillage && this._isDawnVillage(settlement)));
    },

    /** The festival on today, if any: 'fair' | 'midwinter' | null. */
    _ssFestivalToday(day) {
        const s = this._ssSettlement;
        if (!this._ssIsTown(s)) return null;
        if (StreetSeasons.fairOn(s, day)) return 'fair';
        if (StreetSeasons.midwinterOn(day)) return 'midwinter';
        return null;
    },

    /** Put the festival's props up on the square (or take yesterday's down). */
    _reconcileSeasonProps(world, day) {
        const tiles = this.tiles;
        if (!tiles) return;
        const want = world ? this._ssFestivalToday(day) : null;
        const have = this._ssScanProps();
        if (have.kind && have.kind === want) {
            this._ssFair = { kind: want, q: have.center.q, r: have.center.r };
            return;
        }
        for (const p of have.list) this._ssRemoveProp(p.q, p.r);
        this._ssFair = null;
        this._ssMusicianId = null;
        if (!want) return;
        const A = this.townArea && this.townArea();
        if (!A || !A.center) return;
        const cfg = StreetSeasons.config();
        const F = want === 'fair' ? cfg.harvestFair : cfg.midwinter;
        const ids = (F.props || []).filter(id => CustomObjects.getDef(id));
        const R = Math.max(3, _num(cfg.harvestFair.radius, 7));
        // The ground about the square, nearest first (a hash breaks ties: each town lays out its own)
        const seed = ssStrHash(this._ssSettlement && this._ssSettlement.name);
        const cands = [];
        for (let r = A.center.r - R; r <= A.center.r + R; r++) {
            for (let q = A.center.q - R; q <= A.center.q + R; q++) {
                const t = tiles[r] && tiles[r][q];
                if (!t || !this._ssFreeGround(t)) continue;
                cands.push({ q, r, d: Math.hypot(q - A.center.q, r - A.center.r) + ssHash(q, r, seed) * 1.5 });
            }
        }
        cands.sort((a, b) => a.d - b.d);
        const placed = [];
        const near = (q, r, gap) => placed.some(p => Math.abs(p.q - q) <= gap + p.w && Math.abs(p.r - r) <= gap + p.h);
        let center = null;
        for (const id of ids) {
            const def = CustomObjects.getDef(id);
            for (const c of cands) {
                if (near(c.q, c.r, 1)) continue;
                if (want === 'midwinter' && center && Math.hypot(c.q - center.q, c.r - center.r) > 3) continue;
                if (!this._ssPlaceProp(def, c.q, c.r, want)) continue;
                const b = def.bounds || {};
                placed.push({ q: c.q, r: c.r, w: Math.max(0, _num(b.maxCol, 0) - _num(b.minCol, 0)), h: Math.max(0, -_num(b.minRow, 0)) });
                if (!center) center = { q: c.q, r: c.r };
                break;
            }
        }
        if (center) this._ssFair = { kind: want, q: want === 'fair' ? A.center.q : center.q, r: want === 'fair' ? A.center.r : center.r };
    },

    /** Ground a prop (or a person at the festival) may stand on. */
    _ssFreeGround(t) {
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.isRoad && !t._wet && !t._iced && !t.customObject && !t.customObjectPart
            && !t.building && !t.customBuilding && !t.customBuildingPart && !t._doorMarker && !t._reserved && !t._isInterior && !t._fieldSoil);
    },

    /** The festival props on the map now: { kind, center, list:[{q,r}] }. */
    _ssScanProps() {
        const list = [];
        let kind = null, center = null;
        for (const row of this.tiles || []) {
            for (const t of row) {
                const o = t && t.customObject;
                if (!o || !o._ssProp) continue;
                list.push({ q: t.q, r: t.r });
                kind = kind || o._ssProp;
                if (!center && o._ssCenter) center = { q: o._ssCenter.q, r: o._ssCenter.r };
                if (!center) center = { q: t.q, r: t.r };
            }
        }
        return { kind, center, list };
    },

    /** Put a festival prop down (its ground kept, to give back when it comes down). */
    _ssPlaceProp(def, q, r, kind) {
        const tiles = this.tiles;
        if (!def || !TownProps.fits(tiles, def, q, r)) return false;
        const cells = new Map();
        for (const m of [...(def.tiles || []), ...(def.meta || [])]) cells.set(`${m.localCol},${m.localRow}`, m);
        for (const m of cells.values()) {
            const t = tiles[r + m.localRow] && tiles[r + m.localRow][q + m.localCol];
            if (!t || !this._ssFreeGround(t)) return false;
        }
        for (const m of cells.values()) {
            const t = tiles[r + m.localRow][q + m.localCol];
            t._ssUndo = { sub: t.subTerrain, part: t.customObjectPart || null };
            // (its own copy: place() marks the ground it blocks impassable)
            t.subTerrain = { ...t.subTerrain };
        }
        if (!TownProps.place(tiles, def, q, r)) {
            for (const m of cells.values()) this._ssUndoCell(tiles[r + m.localRow][q + m.localCol]);
            return false;
        }
        const A = this.townArea && this.townArea();
        tiles[r][q].customObject._ssProp = kind;
        tiles[r][q].customObject._ssCells = [...cells.values()].map(m => [m.localCol, m.localRow]);
        if (A && A.center) tiles[r][q].customObject._ssCenter = { q: A.center.q, r: A.center.r };
        return true;
    },

    _ssUndoCell(t) {
        if (!t || !t._ssUndo) return;
        t.subTerrain = t._ssUndo.sub;
        t.customObjectPart = t._ssUndo.part;
        delete t._ssUndo;
    },

    /** Take a festival prop down, its ground as it was. */
    _ssRemoveProp(q, r) {
        const t = this.tiles[r] && this.tiles[r][q];
        const o = t && t.customObject;
        if (!o || !o._ssProp) return;
        const cells = o._ssCells || [[0, 0]];
        t.customObject = null;
        for (const [dc, dr] of cells) this._ssUndoCell(this.tiles[r + dr] && this.tiles[r + dr][q + dc]);
        this._ssUndoCell(t);
    },

    /** Snowmen about the square while the snow lasts (drawn: ui/innerMapLayers/streetSeasons.js). */
    _placeSnowmen(ss, day) {
        this._ssSnowmen = null;
        const P = StreetSeasons.config().snowPlay;
        if (!ss || !ss.winterLook || ss.snow < _num(P.snowAt, 0.3) || !this._ssIsTown(this._ssSettlement)) return;
        const A = this.townArea && this.townArea();
        if (!A || !A.center) return;
        const n = Math.max(0, Math.floor(_num(P.snowmen, 3)));
        const seed = ssStrHash(this._ssSettlement && this._ssSettlement.name);
        const out = [];
        // (a snowman stands a few days, then another is built somewhere else)
        const week = Math.floor(day / 4);
        for (let i = 0; i < 40 && out.length < n; i++) {
            const a = ssHash(seed, week, i, 1) * Math.PI * 2, d = 3 + ssHash(seed, week, i, 2) * (A.R ? Math.min(A.R, 14) : 10);
            const q = Math.round(A.center.q + Math.cos(a) * d), r = Math.round(A.center.r + Math.sin(a) * d);
            const t = this.tiles[r] && this.tiles[r][q];
            if (!this._ssFreeGround(t) || out.some(s => Math.abs(s.q - q) + Math.abs(s.r - r) < 4)) continue;
            out.push({ q, r, v: Math.floor(ssHash(seed, q, r, week) * 3) });
        }
        this._ssSnowmen = out.length ? out : null;
    },

    // ──────────── THE TOWNSFOLK ────────────

    /** A free spot from `center` between rMin and rMax away (or null). */
    _ssSpotNear(center, rMin, rMax, rnd, open = true) {
        if (!center) return null;
        for (let i = 0; i < 24; i++) {
            const a = rnd() * Math.PI * 2, d = rMin + rnd() * Math.max(0, rMax - rMin);
            const q = Math.round(center.q + Math.cos(a) * d), r = Math.round(center.r + Math.sin(a) * d);
            const t = this.tiles[r] && this.tiles[r][q];
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.building || t.customBuilding || t.customBuildingPart || t._doorMarker) continue;
            if (open && (t._wet || t._iced)) continue;
            if ((this.npcs || []).some(o => o.q === q && o.r === r)) continue;
            return { q, r };
        }
        return null;
    },

    /** A street cell by `base` with snow lying beside it: where a householder shovels. → { spot, face } */
    _ssShovelSpot(base, rnd) {
        if (!base) return null;
        for (let i = 0; i < 30; i++) {
            const q = Math.round(base.q + (rnd() - 0.5) * 10), r = Math.round(base.r + (rnd() - 0.5) * 10);
            const t = this.tiles[r] && this.tiles[r][q];
            if (!t || !t.isRoad || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart) continue;
            if ((this.npcs || []).some(o => o.q === q && o.r === r)) continue;
            for (const [dq, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                const n = this.tiles[r + dr] && this.tiles[r + dr][q + dq];
                if (n && !n.isRoad && !n._wet && !n.building && !n.customBuilding && !n.customBuildingPart && n.subTerrain && n.subTerrain.passable) {
                    return { spot: { q, r }, face: _dirTo(dq, dr) };
                }
            }
        }
        return null;
    },

    /** Down tools from a festival or the shovel (townLife's _townPickActivity, before the next thing). */
    _seasonClear(npc) {
        if (npc.activity && npc.activity.type === 'season') npc.activity = null;
        npc._ssSow = false;
    },

    /**
     * The season's call on someone free to choose: the fair, the bonfire, the
     * shovel, snow to play in, the fields to sow. → true when they're off to it.
     */
    _seasonPick(npc, period) {
        const ss = this._ss;
        if (!ss || this._insideBuilding || !ss.settlement || npc.type === 'guard' || npc._doorPost || npc.departing) return false;
        const cfg = StreetSeasons.config();
        const rnd = Utils.random;
        const h = _num(this.timeOfDay, 12);
        const day = _num(this._ssDay, _num(this.worldDay, 1));
        const fest = this._ssFair;
        if (fest && fest.kind === 'fair' && StreetSeasons.inHours(h, cfg.harvestFair.hours)) {
            const F = cfg.harvestFair;
            // A fiddler for the dancing: one of the townsfolk, the same all day
            let musician = this._ssMusicianId != null ? (this.npcs || []).find(n => n.id === this._ssMusicianId && n.state !== 'gone') : null;
            if (!musician && ['villager', 'traveler', 'merchant'].includes(npc.type) && rnd() < 0.5) { this._ssMusicianId = npc.id; musician = npc; }
            if (musician === npc) {
                const spot = this._ssSpotNear(fest, 1, 2.5, rnd);
                if (spot && this._goStand(npc, spot, 'ss_music', _dirTo(fest.q - spot.q, fest.r - spot.r))) return true;
            }
            if (rnd() < _num((F.join || {})[period], 0)) {
                const spot = this._ssSpotNear(fest, 1.5, Math.max(3, _num(F.radius, 7)), rnd);
                if (spot && this._goStand(npc, spot, 'ss_fair', _dirTo(fest.q - spot.q, fest.r - spot.r))) return true;
            }
        }
        if (fest && fest.kind === 'midwinter' && StreetSeasons.inHours(h, cfg.midwinter.hours) && rnd() < _num((cfg.midwinter.join || {})[period], 0)) {
            const ring = cfg.midwinter.ring || [2, 3];
            const spot = this._ssSpotNear(fest, _num(ring[0], 2), _num(ring[1], 3), rnd);
            if (spot && this._goStand(npc, spot, 'ss_bonfire', _dirTo(fest.q - spot.q, fest.r - spot.r))) return true;
        }
        // Children out in the snow
        const P = cfg.snowPlay;
        if (npc.type === 'child' && ss.winterLook && ss.snow >= _num(P.snowAt, 0.3) && period !== 'night' && period !== 'evening' && rnd() < _num(P.share, 0.5)) {
            const sm = this._ssSnowmen && this._ssSnowmen.length ? this._ssSnowmen[Math.floor(rnd() * this._ssSnowmen.length)] : null;
            const base = sm || (this.townArea() || {}).center;
            const spot = this._ssSpotNear(base, 1, 3, rnd);
            if (spot && this._goStand(npc, spot, 'ss_play', sm ? _dirTo(sm.q - spot.q, sm.r - spot.r) : null)) return true;
        }
        // Clearing the street by the door of a snowy morning
        const Sh = cfg.shovelling;
        if (ss.winterLook && ss.snow >= _num(Sh.snowAt, 0.3) && StreetSeasons.inHours(h, Sh.hours) && rnd() < _num((Sh.share || {})[npc.type], 0)) {
            const at = this._ssShovelSpot(npc._home || npc, rnd);
            if (at && this._goStand(npc, at.spot, 'ss_shovel', at.face)) return true;
        }
        // Out sowing the fields in spring
        if (StreetSeasons.sowingOn(day) && (period === 'morning' || period === 'afternoon') && rnd() < _num((cfg.sowing.extra || {})[npc.type], 0)) {
            if (this._goToField && this._goToField(npc)) { npc._ssSow = true; return true; }
        }
        return false;
    },

    /** Arrived where the season sent them (townLife's _npcArrivedInTown): at it. */
    _seasonArrived(npc, act) {
        const cfg = StreetSeasons.config();
        const rnd = Utils.random;
        const stay = cfg.stay || {};
        const say = (lines, chance = 0.4) => {
            const near = Math.max(Math.abs(npc.q - _num(this.playerInnerQ, -99)), Math.abs(npc.r - _num(this.playerInnerR, -99))) <= 20;
            const line = near && rnd() < chance ? _pick(lines, rnd) : null;
            if (line) { const now = _now(); npc._bark = { text: line, from: now + rnd() * 1500, until: now + 4200 }; }
        };
        switch (act) {
            case 'ss_fair':
                npc.activity = rnd() < 0.35
                    ? { type: 'season', icon: '💃', label: 'Dancing at the harvest fair', anim: 'emotes' }
                    : { type: 'season', icon: '🎪', label: 'At the harvest fair', anim: 'idle' };
                npc.idleTimer = _span(stay.ss_fair, rnd);
                say(cfg.harvestFair.lines);
                break;
            case 'ss_music':
                npc.activity = { type: 'season', icon: '🎻', label: 'Fiddling for the fair', anim: 'emotes' };
                npc.idleTimer = _span(stay.ss_music, rnd);
                say(cfg.harvestFair.music, 0.9);
                break;
            case 'ss_bonfire':
                npc.activity = { type: 'season', icon: '🔥', label: 'Round the midwinter fire', anim: 'idle' };
                npc.idleTimer = _span(stay.ss_bonfire, rnd);
                say(cfg.midwinter.lines);
                break;
            case 'ss_shovel':
                npc.activity = { type: 'season', icon: '❄️', label: 'Shovelling snow', anim: 'swing', tool: 'hoe' };
                npc.idleTimer = _span(stay.ss_shovel || cfg.shovelling.stay, rnd);
                say(cfg.shovelling.lines, 0.3);
                break;
            case 'ss_play':
                npc.activity = rnd() < 0.5
                    ? { type: 'season', icon: '⛄', label: 'Building a snowman', anim: 'swing' }
                    : { type: 'season', icon: '❄️', label: 'Throwing snowballs', anim: 'emotes' };
                npc.idleTimer = _span(stay.ss_play, rnd);
                say(cfg.snowPlay.lines, 0.5);
                break;
            case 'field': {
                // Spring: the hands out sowing and breaking the soil, not weeding a crop
                if (!npc._ssSow && !StreetSeasons.sowingOn(_num(this._ssDay, _num(this.worldDay, 1)))) break;
                npc._ssSow = false;
                const a = npc.activity;
                if (!a || a.type !== 'field' || a.anim === 'halfslash') break;
                const label = _pick(cfg.sowing.labels, rnd) || 'Sowing the field';
                npc.activity = /^Sow/.test(label)
                    ? { type: 'field', icon: '🌱', label, anim: 'swing' }
                    : { type: 'field', icon: '🌱', label, anim: 'swing', tool: 'hoe' };
                say(cfg.sowing.lines, 0.25);
                break;
            }
            default:
                break;
        }
    },
});
