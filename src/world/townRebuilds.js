// ============================================================
// TOWN REBUILDS — the old houses rebuilt denser, on the street map
// ============================================================
// When a town's ground is gone its builders pull down old hovels, cottages
// and houses for row houses, townhouses and tenements (world/townHousing.js
// week; housing.rd counts those done, the queue those going up). The street
// map shows the same share of its planned houses rebuilt: each time the map is
// laid, after the plan, the water and the new streets, the first of the plan's
// houses (the meanest first — huts and hovels, then cottages — in the town's
// own hashed order among equals) stand as the denser design instead
// — the last few as building sites while work is under way.
//
// Which houses were rebuilt, and as what, is kept on the settlement
// (housing.rdMap: [[anchor "q,r", design id, dwelling type]], in order), so
// the same houses come back as the same designs on every visit, across saves
// and as the years add more: a recorded house still standing on the plan is
// rebuilt as recorded; one the plan no longer has is let go and another taken.
// A design stands only where it fits: on the old house's ground and open ground
// beside and behind it (a garden, a yard — cleared of what grows there), never
// over a street, the water, the walls, a lot or another building.
//
// Pure: no randomness (hashes of the town), no globals.

import { CustomBuildings } from './customBuildings.js';
import { CustomObjects } from './customObjects.js';
import { TownHousing } from './townHousing.js';
import { TownMarks, markHash } from './townMarks.js';
import { TownGrowth } from './townGrowth.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
/** The building type each rebuilt dwelling stands as on the map, in order of preference. */
const DESIGN = { tenement: ['tenement', 'rowhouse'], row: ['rowhouse'], townhouse: ['townhouse', 'rowhouse'], house: ['house'], lodging: ['tenement', 'rowhouse'] };

export const TownRebuilds = {
    /** How many of the map's `houses` stand rebuilt, and how many are building sites: { done, going }. */
    share(settlement, houses) {
        const h = settlement && settlement.housing;
        if (!_obj(h) || !(houses > 0)) return { done: 0, going: 0 };
        const rd = TownHousing.redeveloped(settlement);
        const now = TownHousing.redeveloping(settlement);
        if (!rd.n && !now) return { done: 0, going: 0 };
        const all = Math.max(1, Object.values(h.d || {}).reduce((a, b) => a + Math.max(0, _num(b)), 0) + now);
        const done = rd.n ? Math.min(houses, Math.max(1, Math.round(houses * rd.n / all))) : 0;
        const going = now ? Math.min(2, Math.max(0, houses - done), Math.max(1, Math.round(houses * now / all))) : 0;
        return { done, going };
    },

    /** What the town's map stamp shows of it (laid out anew as the share moves on). */
    stamp(settlement) {
        const h = settlement && settlement.housing;
        if (!_obj(h)) return '';
        const rd = TownHousing.redeveloped(settlement);
        const now = TownHousing.redeveloping(settlement);
        if (!rd.n && !now) return '';
        const all = Math.max(1, Object.values(h.d || {}).reduce((a, b) => a + Math.max(0, _num(b)), 0) + now);
        return `|rd${Math.round(rd.n / all * 200)}:${now ? 1 : 0}`;
    },

    /** The dwelling type the next rebuilt house on the map stands as: the one its record has fewest of for its share. */
    _nextType(settlement, map) {
        const rd = TownHousing.redeveloped(settlement);
        const by = { ...rd.by };
        for (const e of (settlement.housing.q || [])) if (e && e[3]) by[e[0]] = _num(by[e[0]]) + 1;
        const total = Object.values(by).reduce((a, b) => a + b, 0);
        if (!total) return 'row';
        const have = {};
        for (const e of map) have[e[2]] = _num(have[e[2]]) + 1;
        let best = null, gap = -Infinity;
        for (const id of Object.keys(by).sort()) {
            if (!DESIGN[id]) continue;
            const g = by[id] / total - _num(have[id]) / Math.max(1, map.length + 1);
            if (g > gap) { gap = g; best = id; }
        }
        return best || 'row';
    },

    /** Designs a dwelling type may stand as, the town's culture's first, turned by the house's place. */
    _designs(type, culture, eraIdx, key) {
        const out = [];
        for (const bt of DESIGN[type] || ['rowhouse']) {
            let list;
            if (bt === 'townhouse') {
                // (a townhouse: the culture's tall town houses, else the kit's)
                const pool = [...(culture ? CustomBuildings.getByCulture(culture, 'house') : []), ...CustomBuildings.getByType('house')];
                list = pool.filter(d => /townhouse/.test(d.id));
            } else if (bt === 'house') {
                const pool = [...(culture ? CustomBuildings.getByCulture(culture, 'house') : []), ...CustomBuildings.getByType('house').filter(d => !d.culture)];
                list = pool.filter(d => d.bounds && d.bounds.maxCol - d.bounds.minCol + 1 >= 5 && d.style !== 'hovel' && d.style !== 'croft' && d.style !== 'farmstead');
            } else {
                list = CustomBuildings.getByType(bt).slice();
                // (stone tenements rise in the Age of Stone and after; before it, the low timbered ones)
                if (bt === 'tenement') {
                    const low = list.filter(d => /_low_/.test(d.id)), tall = list.filter(d => !/_low_/.test(d.id));
                    list = eraIdx >= 2 ? [...tall, ...low] : [...low, ...tall];
                }
            }
            list = list.filter(d => d && d.meta && d.bounds && d.bounds.maxRow <= 0);
            if (!list.length) continue;
            const turn = Math.floor(markHash(key, 'rd', type, bt) * list.length);
            // (each group turned on its own, the first group first)
            const half = bt === 'tenement' ? list.filter(d => /_low_/.test(d.id) === (eraIdx < 2)).length : list.length;
            const head = list.slice(0, half), tail = list.slice(half);
            const rot = (arr, k) => arr.map((_, i) => arr[(i + k) % arr.length]);
            out.push(...rot(head, head.length ? turn % head.length : 0), ...rot(tail, tail.length ? turn % tail.length : 0));
        }
        return out;
    },

    /** May cell (q, r) take a rebuilt house's walls or roof (the old house's own ground, else open ground)? */
    _open(tiles, q, r, old) {
        const H = tiles.length, W = tiles[0].length;
        if (q < 1 || r < 1 || q >= W - 1 || r >= H - 1) return false;
        if (q >= old.x0 && q <= old.x1 && r >= old.y0 && r <= old.y1) return true;
        const t = tiles[r][q];
        if (!t || t.isRoad || t.building || t.customBuilding || t.customBuildingPart || t._wet || t._bridge || t._ford || t._lot || t._plaza
            || t._townWall || t._pier || t._deck || t._grave || t._reserved || t._memoryPlot) return false;
        if (t.subTerrain && /water/.test(t.subTerrain.id || '')) return false;
        const p = t.customObjectPart;
        const a = p ? tiles[p.anchorR] && tiles[p.anchorR][p.anchorQ] : t;
        const o = a && a.customObject;
        if (o) {
            if (o.memory || o.townWall) return false;
            const d = CustomObjects.getDef(o.defId);
            const tags = (d && d.tags) || [];
            if (tags.some(x => x === 'memory' || x === 'grave' || x === 'square' || x === 'hearth' || x === 'hearthOut' || x === 'well' || x === 'stall')) return false;
        }
        return true;
    },

    /** The top row of a design's ground footprint, off its anchor (its whole height where it has none). */
    _footTop(def) {
        const f = CustomBuildings.footprint ? CustomBuildings.footprint(def) : null;
        return f ? f.footTop : (def.bounds ? def.bounds.minRow : 0);
    },

    /**
     * May a rebuilt house's upper storeys hang over cell (q, r)? What _open allows, and also a
     * lane or street, another lot's ground and another building's upper storeys — never water,
     * a bridge, a wall, a pier, a grave, the square or another's ground floor.
     */
    _openOver(tiles, q, r, old) {
        const H = tiles.length, W = tiles[0].length;
        if (q < 1 || r < 1 || q >= W - 1 || r >= H - 1) return false;
        if (q >= old.x0 && q <= old.x1 && r >= old.y0 && r <= old.y1) return true;
        const t = tiles[r][q];
        if (!t || t.building || t.customBuilding || t._wet || t._bridge || t._ford || t._plaza
            || t._townWall || t._pier || t._deck || t._grave || t._reserved || t._memoryPlot) return false;
        if (t.customBuildingPart && !t.customBuildingPart.over) return false;
        if (t.subTerrain && /water/.test(t.subTerrain.id || '')) return false;
        const p = t.customObjectPart;
        const a = p ? tiles[p.anchorR] && tiles[p.anchorR][p.anchorQ] : t;
        const o = a && a.customObject;
        if (o) {
            if (o.memory || o.townWall) return false;
            const d = CustomObjects.getDef(o.defId);
            const tags = (d && d.tags) || [];
            if (tags.some(x => x === 'memory' || x === 'grave' || x === 'square' || x === 'hearth' || x === 'hearthOut' || x === 'well' || x === 'stall')) return false;
        }
        return true;
    },

    /** Where `def` stands in place of house `b` (its anchor at b's, or a step aside), or null. */
    _fit(tiles, B, b, def) {
        const bd = def.bounds;
        // Only its ground storey needs open ground; the storeys and roof above it may hang over a
        // lane, a yard, another's back garden or another's upper storeys (world/customBuildings.js footprintOf)
        const footTop = TownRebuilds._footTop(def);
        for (const dq of [0, -1, 1]) {
            const q = b.q + dq, r = b.r;
            const x0 = q + bd.minCol, x1 = q + bd.maxCol, y0 = r + bd.minRow, y1 = r + bd.maxRow;
            const fy0 = r + footTop;
            let ok = true;
            for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1 && ok; x++) {
                if (!(y >= fy0 ? TownRebuilds._open(tiles, x, y, b) : TownRebuilds._openOver(tiles, x, y, b))) ok = false;
            }
            if (!ok) continue;
            // (and clear of every other building: its ground floor of all of another, its storeys of another's ground floor)
            if (B.some(o => {
                if (o === b || x0 > o.x1 || x1 < o.x0 || y0 > o.y1 || y1 < o.y0) return false;
                if (y1 >= o.y0 && fy0 <= o.y1) return true;
                const oy0 = o.def ? o.r + TownRebuilds._footTop(o.def) : o.y0;
                return y0 <= o.y1 && fy0 - 1 >= oy0;
            })) continue;
            // (its door opens on to ground one can stand on)
            const door = (def.meta || []).find(m => m.door);
            if (door) {
                const t = tiles[r + door.r + 1] && tiles[r + door.r + 1][q + door.q];
                if (!t || t.customBuilding || t.customBuildingPart || t._wet || (t.subTerrain && t.subTerrain.passable === false && !t.isRoad)) continue;
            }
            return { q, r, x0, x1, y0, y1 };
        }
        return null;
    },

    /**
     * Stand the town's rebuilt houses on its map (after its plan, water and new
     * streets; before its history's marks). opts.eraIdx: its era's index;
     * opts.culture. Writes housing.rdMap. → houses rebuilt on the map.
     */
    lay(tiles, settlement, day, opts = {}) {
        const h = settlement && settlement.housing;
        if (!_obj(h) || !tiles || !tiles.length || !CustomBuildings.isLoaded()) return 0;
        const all = TownMarks._buildings(tiles);
        const houses = all.filter(b => (b.def.buildingType || 'house') === 'house' && !tiles[b.r][b.q].customBuilding.lotId
            && !/townhouse/.test(b.def.id) && b.def.style !== 'farmstead');
        const { done, going } = TownRebuilds.share(settlement, houses.length);
        const want = done + going;
        if (!want) return 0;
        const key = settlement.foundingName || settlement.name || `${settlement.q},${settlement.r}`;
        const byKey = new Map(houses.map(b => [b.key, b]));
        // (the meanest first, as the builders take them: hovels and huts, then cottages, then the rest; the town's own hash among equals)
        const mean = b => (/hovel|hut|croft|shack/.test(`${b.def.id} ${b.def.style || ''}`) ? 0 : /cottage/.test(`${b.def.id} ${b.def.style || ''}`) ? 1 : 2);
        const order = houses.slice().sort((a, z) => mean(a) - mean(z) || markHash(key, 'rdOrder', a.key) - markHash(key, 'rdOrder', z.key));
        const culture = opts.culture || (tiles._townBuild && tiles._townBuild.culture) || settlement.culture || null;
        const eraIdx = _num(opts.eraIdx, 1);
        const map = Array.isArray(h.rdMap) ? h.rdMap.filter(e => Array.isArray(e) && e.length >= 3) : [];
        const kept = [];
        const used = new Set();
        const stand = (b, def, at, type, i) => {
            TownMarks._lift(tiles, b.def, b.q, b.r);
            for (let y = at.y0; y <= at.y1; y++) for (let x = at.x0; x <= at.x1; x++) {
                const t = tiles[y][x];
                if (t && (t.customObject || t.customObjectPart)) TownGrowth._clearAt(tiles, x, y);
                if (t) { delete t._fieldSoil; delete t._fieldGreen; }
            }
            TownMarks._stand(tiles, def, at.q, at.r);
            const cb = tiles[at.r][at.q].customBuilding;
            cb.redev = type;
            if (i >= done) cb.siteP = 0.5;
            // (its ground taken: no other rebuilt house reaches over it)
            const rec = TownMarks._rec(at.q, at.r, def);
            const ix = all.indexOf(b);
            if (ix >= 0) all[ix] = rec;
            used.add(b.key);
        };
        // The houses already rebuilt, as recorded
        for (const e of map) {
            if (kept.length >= want) break;
            const b = byKey.get(e[0]);
            const def = CustomBuildings.getBuilding(e[1]);
            if (!b || !def || used.has(b.key)) continue;
            const at = TownRebuilds._fit(tiles, all, b, def);
            if (!at) continue;
            stand(b, def, at, e[2], kept.length);
            kept.push(e);
        }
        // ...and more, in the town's order, as its share has grown
        for (const b of order) {
            if (kept.length >= want) break;
            if (used.has(b.key)) continue;
            const type = TownRebuilds._nextType(settlement, kept);
            for (const def of TownRebuilds._designs(type, culture, eraIdx, `${key}|${b.key}`)) {
                const at = TownRebuilds._fit(tiles, all, b, def);
                if (!at) continue;
                stand(b, def, at, type, kept.length);
                kept.push([b.key, def.id, type]);
                break;
            }
        }
        h.rdMap = kept.concat(map.filter(e => !kept.includes(e) && byKey.has(e[0]) && !used.has(e[0]))).slice(0, 200);
        return kept.length;
    },
};
