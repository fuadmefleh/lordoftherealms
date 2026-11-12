// ============================================================
// TOWN MARKS — what a town's history has left on its streets
// ============================================================
// A town remembers physically. Its history is a list of marks on the
// settlement (settlement.memory.marks, saved with the tile):
//
//   fire     — a fire that ran through its timber houses: they stand as
//              burnt shells, then as cleared plots with charred timbers,
//              and over the years are rebuilt — often in stone
//   sack     — a town put to the sword: roofless shells and rubble, rebuilt
//              slowly, and some never (a broken arch, a fallen column)
//   statue   — raised to a House for great deeds; defaced, then toppled,
//              if the House falls or the town comes to hate it
//   cairn    — a battle fought by the town; a grave mound where many fell
//   mound    — a plague pit or a mass grave on the outskirts
//   name     — the square renamed after a House (a memorial stone at its corner)
//   district — a new quarter of houses, built in a decade of wealth
//
// The marks are written by systems/townMemory.js (which also does what they
// mean: the dead, the homeless, the price of timber, the pride and grief) and
// by world/kingdomAI.js for the realms' battles (noteBattle). This module lays
// them on the town's street map after the planner (lay): hash-placed, drawing
// nothing from the map's dice, so the plan underneath stands as it stood. The
// map is laid out anew when its marks change how it looks (stamp).
//
// Pure: no randomness, no globals; no import-time effects.

import { DataLoader } from '../core/dataLoader.js';
import { CustomBuildings } from './customBuildings.js';
import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';

const DEFAULTS = {
    enabled: true,
    daysPerYear: 120,
    layout: {
        shellDays: 60,
        scorchDays: 240,
        spreadGap: 7,
        wallGap: 2,
        timberWalls: 'planks|timber|wattle|siding|logs',
        thatchRoofs: 'thatch|shingle|turf',
        stoneWalls: 'stone|brick',
        stonePlots: 'tm_charred',
    },
    fire: { rebuildYears: [1, 6], spread: 0.8, acrossLane: 0.55 },
    sack: { rebuildYears: [2, 12] },
    battle: { cairnAt: 40, moundAt: 300, mergeDays: 240, nearTown: 1, maxField: 3 },
    district: { houses: [5, 9] },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** A hash of its parts to [0, 1): the same parts, the same number, every visit. */
export function markHash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}
const _h = markHash;

function _cfg() {
    const g = DataLoader._gamedata;
    const d = _obj(g && g.townMemory) || {};
    const out = { ...DEFAULTS, ...d };
    for (const k of ['layout', 'fire', 'sack', 'battle', 'district']) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
    return out;
}

const _between = ([a, b], t) => a + (b - a) * t;

export const TownMarks = {
    config: _cfg,

    /** The settlement's memory ({ marks, seq }), made when `create`. */
    memory(settlement, create = false) {
        if (!settlement || typeof settlement !== 'object') return null;
        if (!_obj(settlement.memory)) {
            if (!create) return null;
            settlement.memory = { v: 1, seq: 0, marks: [] };
        }
        const m = settlement.memory;
        if (!Array.isArray(m.marks)) m.marks = [];
        m.seq = _num(m.seq);
        return m;
    },

    /** Its marks, oldest first ([] for none). */
    marks(settlement, kind = null) {
        const m = TownMarks.memory(settlement);
        if (!m) return [];
        return kind ? m.marks.filter(x => x.k === kind) : m.marks;
    },

    /** One mark by id. */
    markById(settlement, id) {
        return TownMarks.marks(settlement).find(m => m.id === id) || null;
    },

    /**
     * Write a mark: { id, k, d, ...info }. The plain record only — what it means
     * for the town (the dead, the price of timber) is systems/townMemory.js's.
     */
    add(settlement, kind, info = {}, day = 0) {
        const mem = TownMarks.memory(settlement, true);
        if (!mem) return null;
        mem.seq++;
        const rec = { ...info, id: `m${mem.seq}`, k: kind, d: Math.max(0, Math.floor(_num(info.d, day))) };
        mem.marks.push(rec);
        mem.marks.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
        return rec;
    },

    // ── Battles (the realms' wars, world/kingdomAI.js; the player's, player/generalship.js) ──

    /**
     * A battle fought at (q, r): a cairn by the town it was fought for (on the hex or
     * next to it), else on the open field (world.fieldMarks). A second battle there
     * within mergeDays adds its dead to the same cairn. Battles with few dead leave
     * nothing. → the mark, or null.
     */
    noteBattle(world, q, r, info = {}) {
        // The realm's timeline takes every battle from its inbox (systems/realmTimeline.js)
        if (world && Array.isArray(world.timelineFeed) && world.timelineFeed.length < 400) {
            world.timelineFeed.push({ q, r, day: _num(info.day, _num(world.day)), dead: Math.max(0, Math.round(_num(info.dead))), victor: info.victor || null, loser: info.loser || null, player: !!info.player });
        }
        const C = _cfg();
        if (!C.enabled || !world || typeof world.getTile !== 'function') return null;
        const dead = Math.max(0, Math.round(_num(info.dead)));
        if (dead < _num(C.battle.cairnAt, 40)) return null;
        const day = _num(info.day, _num(world.day));
        let settlement = null;
        const R = Math.max(0, _num(C.battle.nearTown, 1));
        for (let dr = -R; dr <= R && !settlement; dr++) {
            for (let dq = -R; dq <= R && !settlement; dq++) {
                const t = world.getTile(q + dq, r + dr);
                if (t && t.settlement) settlement = t.settlement;
            }
        }
        const fields = { dead, victor: info.victor || null, loser: info.loser || null, name: info.name || null, player: !!info.player, fresh: true };
        const merge = list => list.find(m => (m.k === 'cairn') && day - m.d <= _num(C.battle.mergeDays, 240));
        if (settlement) {
            const old = merge(TownMarks.marks(settlement));
            if (old) {
                old.dead = _num(old.dead) + dead;
                old.fresh = true;
                old.freshDead = _num(old.freshDead) + dead;
                if (info.player) old.player = true;
                return old;
            }
            return TownMarks.add(settlement, 'cairn', { ...fields, freshDead: dead }, day);
        }
        if (!_obj(world.fieldMarks)) world.fieldMarks = {};
        const key = `${q},${r}`;
        const list = Array.isArray(world.fieldMarks[key]) ? world.fieldMarks[key] : (world.fieldMarks[key] = []);
        const old = merge(list);
        if (old) { old.dead = _num(old.dead) + dead; return old; }
        const rec = { ...fields, id: `f${q}_${r}_${list.length + 1}`, k: 'cairn', d: day };
        delete rec.fresh;
        list.push(rec);
        // (a field remembers its few greatest battles)
        if (list.length > _num(C.battle.maxField, 3)) { list.sort((a, b) => _num(b.dead) - _num(a.dead)); list.length = _num(C.battle.maxField, 3); }
        return rec;
    },

    /** The battles remembered on an open hex: [marks]. */
    fieldMarks(world, q, r) {
        const fm = world && _obj(world.fieldMarks);
        const l = fm && fm[`${q},${r}`];
        return Array.isArray(l) ? l : [];
    },

    // ── How the marks look on the map ──

    /** How a fire or sack mark stands on day `day`: a step every half year until rebuilt. */
    _phase(m, day) {
        const C = _cfg();
        const span = m.k === 'sack' ? C.sack.rebuildYears : C.fire.rebuildYears;
        const Y = _num(C.daysPerYear, 120);
        const cap = Math.ceil(_num(span[1], 6) * 2 * Math.max(1, _num(m.slow, 1))) + 2;
        return Math.min(cap, Math.floor(Math.max(0, day - m.d) / (Y / 2)));
    },

    /**
     * What the marks look like today, as a short string: the street map is laid out
     * anew when it changes (world/innerMap/terrain.js getOrGenerate).
     */
    stamp(settlement, day) {
        if (!_cfg().enabled) return '';
        const marks = TownMarks.marks(settlement);
        if (!marks.length) return '';
        const d = _num(day);
        const parts = [];
        for (const m of marks) {
            if (m.d > d) continue;
            if (m.k === 'fire' || m.k === 'sack') parts.push(`${m.id}${TownMarks._phase(m, d)}`);
            else if (m.k === 'statue') parts.push(`${m.id}${m.state || 'standing'}`);
            else if (m.k === 'name') parts.push(`${m.id}${m.state || 'kept'}`);
            else if (m.k === 'cairn' || m.k === 'mound') parts.push(`${m.id}${_num(m.dead) >= _num(_cfg().battle.moundAt, 300) ? 'M' : 'c'}`);
            else parts.push(m.id);
        }
        return parts.length ? `|mem:${parts.join(',')}` : '';
    },

    /** How readily a building burns, 0..1, by its walls and roof. */
    flammability(def) {
        if (!def) return 0.6;
        const L = _cfg().layout;
        const wall = String(def.wall || ''), roof = String(def.roof || '');
        let f = !wall ? 0.6 : new RegExp(L.timberWalls).test(wall) ? 0.85 : new RegExp(L.stoneWalls).test(wall) ? 0.1 : 0.3;
        if (new RegExp(L.thatchRoofs).test(roof)) f += 0.25;
        return Math.min(1, f);
    },

    /** Is it built of stone (or brick)? */
    isStone(def) {
        return !!def && new RegExp(_cfg().layout.stoneWalls).test(String(def.wall || ''));
    },

    /**
     * The same building rebuilt in stone: a culture's building as its rich build it
     * (data/architecture.json tiers), else a common building of the same type and
     * the very same footprint whose walls are stone. The building itself if none.
     */
    stoneTwin(def, key = '') {
        if (!def || TownMarks.isStone(def)) return def;
        if (def.culture || def._derivedFrom) {
            const rich = CustomBuildings.tierVariant(def, 'rich');
            if (rich && TownMarks.isStone(rich)) return rich;
        }
        const sig = d => JSON.stringify([d.bounds, (d.meta || []).map(m => [m.q, m.r, !!m.door, !!m.impassable]).sort()]);
        const want = sig(def);
        const pool = (def.culture ? CustomBuildings.getByCulture(def.culture, def.buildingType || 'house') : CustomBuildings.getByType(def.buildingType || 'house'))
            .filter(d => d.id !== def.id && TownMarks.isStone(d) && d.meta && d.bounds && sig(d) === want);
        if (!pool.length) return def;
        return pool[Math.floor(_h('twin', key, def.id) * pool.length)];
    },

    // ── Laying the marks on the street map ──

    /** Every building on the map: [{ q, r, def, key, x0, x1, y0, y1 }] in reading order. */
    _buildings(tiles) {
        const out = [];
        for (const row of tiles) {
            for (const t of row) {
                if (!t || !t.customBuilding) continue;
                const def = CustomBuildings.getBuilding(t.customBuilding.defId);
                if (!def || !def.bounds) continue;
                out.push(TownMarks._rec(t.q, t.r, def));
            }
        }
        return out;
    },

    _rec(q, r, def) {
        const b = def.bounds;
        return { q, r, def, key: `${q},${r}`, x0: q + b.minCol, x1: q + b.maxCol, y0: r + b.minRow, y1: r + b.maxRow, ev: null };
    },

    _gap(a, b) {
        const gx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1) - 1);
        const gy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1) - 1);
        return Math.max(gx, gy);
    },

    _lift(tiles, def, q, r) {
        tiles[r][q].customBuilding = null;
        for (const m of def.meta || []) {
            const t = tiles[r + m.r] && tiles[r + m.r][q + m.q];
            if (!t) continue;
            t.customBuildingPart = null;
            delete t._doorMarker;
            t.subTerrain.passable = true;
        }
    },

    _stand(tiles, def, q, r) {
        tiles[r][q].customBuilding = { defId: def.id };
        for (const m of def.meta || []) {
            const t = tiles[r + m.r][q + m.q];
            if (m.q !== 0 || m.r !== 0) t.customBuildingPart = { anchorQ: q, anchorR: r };
            if (m.door) {
                t._doorMarker = { anchorQ: q, anchorR: r, defId: def.id };
                t.subTerrain.passable = true;
            } else if (m.impassable) {
                t.subTerrain.passable = false;
            }
        }
    },

    /** Is any building's doorstep under (or just below) the prop's cells? */
    _blocksDoor(tiles, def, q, r) {
        for (const m of [...(def.meta || []), ...(def.tiles || [])]) {
            const fq = q + m.localCol, fr = r + m.localRow;
            for (let dr = 0; dr <= 2; dr++) for (let dq = -1; dq <= 1; dq++) {
                const t = tiles[fr - dr] && tiles[fr - dr][fq + dq];
                // (nor on a building lot, or across its front: the house going up there will want its door —
                // world/innerMap/lots.js marks each lot tile _lot)
                if (t && (t._doorMarker || t._lot)) return true;
            }
        }
        return false;
    },

    /** Put a memory prop down, tagged with its mark. → true when it stood. */
    _put(tiles, id, q, r, markId, opts = {}) {
        const def = CustomObjects.getDef(id);
        if (!def || TownMarks._blocksDoor(tiles, def, q, r)) return false;
        if (!TownProps.place(tiles, def, q, r, opts)) return false;
        tiles[r][q].customObject.memory = markId;
        return true;
    },

    /** Try anchors in order until the prop stands. → { q, r } or null. */
    _putFirst(tiles, id, spots, markId, opts = {}) {
        for (const [q, r] of spots) if (TownMarks._put(tiles, id, q, r, markId, opts)) return { q, r };
        return null;
    },

    /**
     * Lay the town's marks on its street map, as they stand on `day`. Runs right after
     * the planner (opts.plaza: its square { q, r, w, h }, opts.center, opts.culture).
     * Draws nothing from the map's rng. → { burnt, scorched, cleared, ruins, rebuilt, statues, cairns, district }.
     */
    lay(tiles, settlement, day, opts = {}) {
        const out = { burnt: 0, scorched: 0, cleared: 0, ruins: 0, rebuilt: 0, statues: 0, cairns: 0, district: 0, plaques: 0 };
        const C = _cfg();
        if (!C.enabled || !tiles || !tiles.length) return out;
        const marks = TownMarks.marks(settlement).filter(m => m.d <= day);
        if (!marks.length) return out;
        const L = C.layout;
        const Y = _num(C.daysPerYear, 120);
        const B = TownMarks._buildings(tiles);
        const H = tiles.length, W = tiles[0].length;
        const center = opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) };

        // A building's ruin comes good in its year: rebuilt (in stone, if so ordered) and standing again
        const settle = (b, upTo) => {
            if (!b.ev || b.ev.until == null || b.ev.until > upTo) return;
            if (b.ev.kind === 'burnt' || b.ev.kind === 'sacked') {
                const nd = b.ev.stone ? TownMarks.stoneTwin(b.def, b.key) : b.def;
                if (nd !== b.def) { b.def = nd; b.swapped = true; }
                b.rebuilt = b.ev.at;
            }
            b.ev = null;
        };
        const standing = (b) => !b.ev;

        for (const m of marks) {
            for (const b of B) settle(b, m.d);
            if (m.k === 'district') {
                const added = TownMarks._layDistrict(tiles, m, B, center, opts);
                out.district += added;
                continue;
            }
            if (m.k !== 'fire' && m.k !== 'sack') continue;
            const share = Math.max(0, Math.min(1, _num(m.share, 0.15)));
            const target = Math.max(1, Math.round(share * B.length));
            const span = m.k === 'sack' ? C.sack.rebuildYears : C.fire.rebuildYears;
            const ruinAt = (b, kind) => {
                const landmark = (b.def.buildingType || 'house') !== 'house';
                const yrs = _between(span, _h(m.id, b.key, 'y')) * (landmark ? 0.6 : 1) * Math.max(0.3, _num(m.slow, 1));
                const never = m.k === 'sack' && _h(m.id, b.key, 'never') < _num(m.never, 0);
                return { kind, at: m.d, mark: m.id, until: never ? null : m.d + L.shellDays + Math.round(yrs * Y), stone: _h(m.id, b.key, 'stone') < _num(m.stoneShare, 0.5) };
            };
            const live = B.filter(standing);
            if (!live.length) continue;
            if (m.k === 'sack') {
                // Put to the torch street by street, the heart of town worst
                const R = Math.max(10, ...live.map(b => Math.hypot(b.q - center.q, b.r - center.r)));
                const order = live.map(b => ({ b, s: _h(m.id, b.key, 'sack') * 0.7 + Math.hypot(b.q - center.q, b.r - center.r) / R * 0.3 })).sort((a, b) => a.s - b.s);
                for (const { b } of order.slice(0, target)) { b.ev = ruinAt(b, 'sacked'); out.burnt++; }
                continue;
            }
            // A fire: it starts in a timber house and runs from roof to roof while there is timber next door
            // (where houses stand close and burn well: a timber yard among timber neighbours)
            const fuel = b => TownMarks.flammability(b.def) * (1 + live.filter(n => n !== b && TownMarks._gap(b, n) <= _num(L.spreadGap, 3)).reduce((t, n) => t + TownMarks.flammability(n.def), 0));
            const origin = live.map(b => ({ b, s: _h(m.id, b.key, 'o') / (fuel(b) + 0.05) })).sort((a, b) => a.s - b.s)[0].b;
            const queue = [origin];
            const seen = new Set([origin.key]);
            let burnt = 0;
            const catchFire = (b) => {
                if (TownMarks.flammability(b.def) >= 0.5) { b.ev = ruinAt(b, 'burnt'); burnt++; return true; }
                b.ev = { kind: 'scorched', at: m.d, mark: m.id, until: m.d + _num(L.scorchDays, 240) };
                return false;
            };
            catchFire(origin);
            if (origin.ev && origin.ev.kind === 'burnt') {
                while (queue.length && burnt < target) {
                    const cur = queue.shift();
                    const near = live.filter(n => !seen.has(n.key) && TownMarks._gap(cur, n) <= _num(L.spreadGap, 3))
                        .sort((a, b) => TownMarks._gap(cur, a) - TownMarks._gap(cur, b) || (a.key < b.key ? -1 : 1));
                    for (const n of near) {
                        if (burnt >= target) break;
                        seen.add(n.key);
                        // (across a lane or a back garden, sparks carry less often than wall to wall)
                        const far = TownMarks._gap(cur, n) > _num(L.wallGap, 2) ? _num(C.fire.acrossLane, 0.55) : 1;
                        if (_h(m.id, n.key, 's') >= (_num(C.fire.spread, 0.8) * TownMarks.flammability(n.def) + 0.15) * far) continue;
                        if (catchFire(n)) queue.push(n);
                    }
                }
            }
        }
        for (const b of B) settle(b, day);

        // ── Stand each building as it is today ──
        for (const b of B) {
            const t = tiles[b.r][b.q];
            if (!t.customBuilding) continue;
            if (b.swapped) {
                const old = CustomBuildings.getBuilding(t.customBuilding.defId);
                if (old) TownMarks._lift(tiles, old, b.q, b.r);
                TownMarks._stand(tiles, b.def, b.q, b.r);
                tiles[b.r][b.q].customBuilding.rebuilt = b.rebuilt;
                out.rebuilt++;
            }
            const ev = b.ev;
            if (!ev) continue;
            const cb = tiles[b.r][b.q].customBuilding;
            if (ev.kind === 'scorched') { cb.ruin = 'scorched'; cb.mark = ev.mark; out.scorched++; continue; }
            // A shell for its first months: roofless, blackened, its door fallen in (nobody goes in)
            if (day < ev.at + _num(L.shellDays, 60)) {
                cb.ruin = ev.kind;
                cb.mark = ev.mark;
                for (const mm of b.def.meta || []) {
                    if (!mm.door) continue;
                    const dt = tiles[b.r + mm.r][b.q + mm.q];
                    delete dt._doorMarker;
                    dt.subTerrain.passable = false;
                }
                out.burnt++;
                continue;
            }
            // Then pulled down: the plot cleared but for what wouldn't burn, waiting on its builders
            // (and a sacked town's ruins that nobody comes back to rebuild stay ruins)
            TownMarks._lift(tiles, b.def, b.q, b.r);
            for (let r = b.y0; r <= b.y1; r++) for (let q = b.x0; q <= b.x1; q++) {
                if (tiles[r] && tiles[r][q]) { tiles[r][q]._townCleared = true; tiles[r][q]._memoryPlot = ev.mark; }
            }
            const w = b.x1 - b.x0 + 1;
            const spots = [];
            for (let dq = 0; dq <= Math.max(0, w - 2); dq++) spots.push([b.x0 + Math.floor((w - 3) / 2) + dq, b.y1], [b.x0 + dq, b.y1]);
            if (ev.until == null) {
                TownMarks._putFirst(tiles, _h(ev.mark, b.key, 'r') < 0.5 ? 'tm_ruined_arch' : 'tm_broken_column', spots, ev.mark);
                TownMarks._putFirst(tiles, 'tm_rubble', spots.slice().reverse(), ev.mark);
                out.ruins++;
            } else {
                TownMarks._putFirst(tiles, ev.kind === 'burnt' ? 'tm_charred' : 'tm_rubble', spots, ev.mark);
                out.cleared++;
            }
        }

        TownMarks._layMemorials(tiles, marks, { plaza: opts.plaza || null, center }, out);
        return out;
    },

    /**
     * The memorials on a street map now: Map of `${markId}|${defId}` → { q, r }.
     */
    _memorialsOnMap(tiles) {
        const have = new Map();
        for (let r = 0; r < tiles.length; r++) {
            const row = tiles[r];
            if (!row) continue;
            for (let q = 0; q < row.length; q++) {
                const o = row[q] && row[q].customObject;
                if (o && o.memory) have.set(`${o.memory}|${o.defId}`, { q, r });
            }
        }
        return have;
    },

    /**
     * Statues and memorial stones about the square, cairns and grave mounds by the roads
     * out of town — each that is not already standing on the map (so it can run again).
     */
    _layMemorials(tiles, marks, opts, out) {
        const C = _cfg();
        const center = opts.center;
        const plaza = opts.plaza || null;
        const have = TownMarks._memorialsOnMap(tiles);
        // ── Statues and the memorial stones of a renamed square ──
        for (const m of marks) {
            if (m.k !== 'statue' && !(m.k === 'name' && (m.state || 'kept') === 'kept')) continue;
            const id = m.k === 'name' ? 'tm_plaque' : m.state === 'toppled' ? 'tm_statue_toppled' : m.state === 'defaced' ? 'tm_statue_defaced' : 'tm_statue';
            if (have.has(`${m.id}|${id}`)) continue;
            const spot = TownMarks._putFirst(tiles, id, TownMarks._squareSpots(tiles, plaza, center, m.id), m.id, { onRoad: true, ignoreReserved: true })
                || TownMarks._putFirst(tiles, id, TownMarks._nearSpots(tiles, center, m.id, 14), m.id);
            if (spot) { if (m.k === 'name') out.plaques++; else out.statues++; }
        }

        // ── Cairns and grave mounds by the roads out of town ──
        const out2 = TownMarks._outskirts(tiles);
        for (const m of marks) {
            if (m.k !== 'cairn' && m.k !== 'mound') continue;
            const big = m.k === 'mound' || _num(m.dead) >= _num(C.battle.moundAt, 300);
            const spots = out2.map(([q, r]) => ({ q, r, s: _h(m.id, q, r) })).sort((a, b) => a.s - b.s).map(x => [x.q, x.r]);
            let at = null;
            if (m.k !== 'mound') {
                at = have.get(`${m.id}|tm_cairn`) || TownMarks._putFirst(tiles, 'tm_cairn', spots, m.id);
                if (at && !have.has(`${m.id}|tm_cairn`)) out.cairns++;
            }
            if (big && !have.has(`${m.id}|tm_mound`)) {
                const near = at ? spots.slice().sort((a, b) => Math.hypot(a[0] - at.q, a[1] - at.r) - Math.hypot(b[0] - at.q, b[1] - at.r)) : spots;
                if (TownMarks._putFirst(tiles, 'tm_mound', near.filter(([q, r]) => !at || Math.hypot(q - at.q, r - at.r) >= 3), m.id)) out.cairns++;
            }
        }
        return out;
    },

    /**
     * After the rest of the map is laid (the harbour, the water, the mill, the graves),
     * stand again any memorial a later pass cleared away, on the ground that is left.
     * → { statues, plaques, cairns } put back.
     */
    relay(tiles, settlement, day, opts = {}) {
        const out = { statues: 0, plaques: 0, cairns: 0 };
        if (!_cfg().enabled || !tiles || !tiles.length || !tiles[0]) return out;
        const marks = TownMarks.marks(settlement).filter(m => m.d <= day);
        if (!marks.some(m => m.k === 'statue' || m.k === 'name' || m.k === 'cairn' || m.k === 'mound')) return out;
        const center = opts.center || { q: Math.floor(tiles[0].length / 2), r: Math.floor(tiles.length / 2) };
        return TownMarks._layMemorials(tiles, marks, { plaza: opts.plaza || null, center }, out);
    },

    /** Battles on an open hex: their cairns and mounds about the middle of its map. → how many stood. */
    layField(tiles, marks, day) {
        if (!_cfg().enabled || !tiles || !tiles.length || !Array.isArray(marks) || !marks.length) return 0;
        const H = tiles.length, W = tiles[0].length;
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        let n = 0;
        for (const m of marks) {
            if (m.d > day) continue;
            const spots = [];
            for (let r = cr - 18; r <= cr + 18; r++) for (let q = cq - 18; q <= cq + 18; q++) {
                if (r < 3 || q < 3 || r >= H - 3 || q >= W - 3 || Math.hypot(q - cq, r - cr) < 4) continue;
                const t = tiles[r][q];
                if (t && t.subTerrain && t.subTerrain.passable) spots.push([q, r]);
            }
            spots.sort((a, b) => _h(m.id, a[0], a[1]) - _h(m.id, b[0], b[1]));
            const at = TownMarks._putFirst(tiles, 'tm_cairn', spots, m.id);
            if (at) n++;
            if (_num(m.dead) >= _num(_cfg().battle.moundAt, 300)) {
                const near = spots.filter(([q, r]) => at && Math.hypot(q - at.q, r - at.r) >= 3 && Math.hypot(q - at.q, r - at.r) <= 7);
                if (TownMarks._putFirst(tiles, 'tm_mound', near, m.id)) n++;
            }
        }
        return n;
    },

    /** Anchors in the square, flanking its middle, a statue's order by its mark. */
    _squareSpots(tiles, plaza, center, id) {
        if (!plaza) return [];
        const out = [];
        const mid = plaza.q + plaza.w / 2;
        for (let r = plaza.r + 2; r <= plaza.r + plaza.h - 2; r++) {
            for (let q = plaza.q + 1; q <= plaza.q + plaza.w - 3; q++) {
                const off = Math.abs(q + 0.5 - mid);
                if (off < 3) continue;
                out.push({ q, r, s: Math.abs(off - plaza.w / 4) + Math.abs(r - (plaza.r + plaza.h / 2)) * 0.5 + _h(id, q, r) * 0.3 });
            }
        }
        return out.sort((a, b) => a.s - b.s).map(x => [x.q, x.r]);
    },

    /** Free ground near the middle of town, nearest first. */
    _nearSpots(tiles, center, id, R) {
        const out = [];
        for (let r = center.r - R; r <= center.r + R; r++) for (let q = center.q - R; q <= center.q + R; q++) {
            const t = tiles[r] && tiles[r][q];
            if (!t || t.isRoad) continue;
            out.push({ q, r, s: Math.hypot(q - center.q, r - center.r) + _h(id, q, r) });
        }
        return out.sort((a, b) => a.s - b.s).map(x => [x.q, x.r]);
    },

    /** Ground on the edge of town within two tiles of a road: where the cairns stand. */
    _outskirts(tiles) {
        const H = tiles.length, W = tiles[0].length;
        const out = [];
        for (let r = 3; r < H - 3; r++) for (let q = 3; q < W - 3; q++) {
            const t = tiles[r][q];
            if (!t || t.isRoad || t._townCore || !(t._townFade > 0 && t._townFade < 0.6)) continue;
            let road = false;
            for (let dr = -2; dr <= 2 && !road; dr++) for (let dq = -2; dq <= 2; dq++) {
                const n = tiles[r + dr] && tiles[r + dr][q + dq];
                if (n && n.isRoad) { road = true; break; }
            }
            if (road) out.push([q, r]);
        }
        return out;
    },

    /**
     * A new quarter: a row of houses fronting the high street beyond the last house
     * at one end of town (east or west by the mark), in the tier the town could
     * afford when it was built (m.tier). → houses built.
     */
    _layDistrict(tiles, m, B, center, opts) {
        const C = _cfg();
        const H = tiles.length, W = tiles[0].length;
        const dir = _h(m.id, 'side') < 0.5 ? -1 : 1;
        const want = Math.round(_between(C.district.houses, _h(m.id, 'n')));
        const culture = opts && opts.culture;
        let pool = culture ? CustomBuildings.getByCulture(culture, 'house') : [];
        if (!pool.length) pool = CustomBuildings.getByType('house');
        pool = pool.filter(d => d.meta && d.bounds && d.style !== 'farmstead' && d.bounds.maxRow - d.bounds.minRow <= 6)
            .sort((a, b) => _h(m.id, a.id) - _h(m.id, b.id));
        if (!pool.length) return 0;
        // The high street's top row at a column: the road row nearest the town's middle
        const roadTop = (x) => {
            for (let k = 0; k <= 8; k++) for (const y of [center.r - k, center.r + k]) {
                const t = tiles[y] && tiles[y][x];
                if (t && t.isRoad && !(tiles[y - 1] && tiles[y - 1][x] && tiles[y - 1][x].isRoad)) return y;
            }
            return null;
        };
        // Start past the last building on that side
        let x = center.q;
        for (const b of B) if (Math.abs(b.r - center.r) <= 12) x = dir > 0 ? Math.max(x, b.x1 + 2) : Math.min(x, b.x0 - 2);
        let built = 0;
        let guard = 0;
        while (built < want && guard++ < 60 && x > 4 && x < W - 5) {
            const y = roadTop(x);
            if (y == null) { x += dir; continue; }
            let placed = null;
            for (let i = 0; i < Math.min(6, pool.length) && !placed; i++) {
                let def = pool[(built + i) % pool.length];
                if (m.tier && typeof CustomBuildings.tierVariant === 'function') def = CustomBuildings.tierVariant(def, m.tier) || def;
                const door = (def.meta || []).find(mm => mm.door) || { q: 0, r: 0 };
                const bw = def.bounds.maxCol - def.bounds.minCol;
                const left = dir > 0 ? x : x - bw;
                const q = left - def.bounds.minCol;
                const r = y - 1 - door.r;
                let ok = true;
                for (const mm of def.meta || []) {
                    const fq = q + mm.q, fr = r + mm.r;
                    const t = tiles[fr] && tiles[fr][fq];
                    if (!t || fq < 2 || fr < 2 || fq >= W - 2 || t.isRoad || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t._lot
                        || (t.subTerrain && /water/.test(t.subTerrain.id || ''))) { ok = false; break; }
                }
                const below = tiles[r + door.r + 1] && tiles[r + door.r + 1][q + door.q];
                if (!ok || !below || !below.isRoad) continue;
                TownMarks._stand(tiles, def, q, r);
                tiles[r][q].customBuilding.district = m.id;
                const rec = TownMarks._rec(q, r, def);
                B.push(rec);
                for (let rr = rec.y0 - 1; rr <= rec.y1 + 1; rr++) for (let qq = rec.x0 - 1; qq <= rec.x1 + 1; qq++) {
                    const t = tiles[rr] && tiles[rr][qq];
                    if (t) { t._townCore = true; t._townCleared = true; delete t._townFade; }
                }
                placed = rec;
            }
            if (placed) { built++; x = dir > 0 ? placed.x1 + 2 : placed.x0 - 2; } else x += dir;
        }
        return built;
    },
};
