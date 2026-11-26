// InnerMap — the floors of a building, and the stairs between them.
//
// A building stands one floor or several (data/buildingFloors.json): its type
// sets how high it may go (a house two, a hotel four, a church one), and its
// builders how high they could raise it: the player's own buildings by the
// techs they know (stone for a third floor, fortification for a fourth), a
// town's by its size (a village two, a city four); a camp of the Dawn of Man
// raises none. Which count a town building has is fixed by where it stands.
//
// The ground floor is the interior entered by the door (interiors.js). Each
// floor above has the same footprint and outer walls, and is planned by the
// interior planner where the ground floor was (_planFloor; data/interiorPlans.json
// `floors`): its own rooms by the building's type and wealth — a house's
// bedchamber with the children's room off it, a rich one's solar or servants'
// room; a manor's upper hall with its bedchamber, solar and servants' room; guest
// rooms off a landing over an inn; offices and a master's office — its pieces
// (data/buildingFloors.json `rooms`, a household's beds counted in) set down by
// the placement rules, its decor and its front's upper windows. An authored
// ground floor keeps the old way: walls copied from below, pieces along them.
// Stairs up stand on each floor but the top; they come out on the stairs down
// of the floor above, at the same tile, the landing round them kept clear.
// Under a tavern, a manor, a shop or a bank (data/buildingFloors.json `cellars`)
// the cellar steps on the ground floor go down to a cellar (floor -1) of the
// same footprint, no windows: its stores in rows with aisles between (the planner's
// 'stacks' rule, filled out by its size: rooms' `perArea`), a room split off behind an
// inner wall (a cold store, a wine vault, a grain store, a vault's strongroom), the
// landing round the steps kept clear, then wall torches spaced for the light, cobwebs,
// straw, spilt grain and damp on the floor (_dressCellar, buildingFloors `cellarDress`).
// Walk onto the stairs (or right-click them) to climb or go down; at the front
// door, go straight up to a floor. Anyone inside keeps to their own floor
// (nobody lives in the cellar).

import { InnerMap } from './_ref.js';
import { DataLoader, Utils, CustomBuildings } from './_imports.js';

const _cfg = () => {
    const d = (DataLoader.get && DataLoader.get('buildingFloors')) || (DataLoader._gamedata && DataLoader._gamedata.buildingFloors) || {};
    return {
        baseFloors: 2, techFloors: [], townCraft: { _default: 2 }, maxFloors: { _default: 1 }, minFloors: {},
        upperRooms: { _default: ['quarters'] }, rooms: {},
        stairs: { up: { type: 'stairs', icon: '🔼', name: 'Stairs Up' }, down: { type: 'stairs_down', icon: '🔽', name: 'Stairs Down' } },
        ...d,
    };
};

const _hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
const _rng = (seed) => {
    let s = _hash(String(seed)) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};
const _type = (b) => String((b && b.type) || 'house').replace(/^player_/, '');
const _ownBuilding = (b) => !!(b && (b.isPlayerOwned || b.isPlayerProperty || String(b.type || '').startsWith('player_')));
const _ord = (n) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};
const _isFloorTile = (t) => !!(t && t.baseTerrain !== 'wall' && t.baseTerrain !== 'void' && !t._isDoor
    && (t.subTerrain && (t.subTerrain.passable || t._furniture || t.customObject || t.customObjectPart)));

Object.assign(InnerMap, {
    /** The floor the player is on inside a building (0: the ground floor). */
    _floor: 0,
    _floorCount: 1,

    /** How high this building's builders could raise it. */
    buildersCraft(building, game) {
        const C = _cfg();
        if (_ownBuilding(building)) {
            const known = (game && game.player && game.player.technology && game.player.technology.researched) || [];
            let f = Number(C.baseFloors) || 1;
            for (const t of C.techFloors || []) if (known.includes(t.tech)) f = Math.max(f, Number(t.floors) || 1);
            return f;
        }
        const st = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        if (st && this._isDawnVillage && this._isDawnVillage(st)) return 1;
        const craft = C.townCraft || {};
        return Number(st ? (craft[st.type] != null ? craft[st.type] : craft._default) : craft._default) || 1;
    },

    /** How many floors a building has (1: the ground floor only). */
    floorsOf(building, game) {
        if (!building) return 1;
        const type = _type(building);
        // (the jail, the castle, and a way underground — world/innerMap/mines.js — are one floor)
        if (building._jail || building._underground || type === 'jail' || type === 'castle') return 1;
        const C = _cfg();
        const most = Number(C.maxFloors[type] != null ? C.maxFloors[type] : C.maxFloors._default) || 1;
        const cap = Math.max(1, Math.min(most, this.buildersCraft(building, game)));
        if (cap <= 1) return 1;
        if (_ownBuilding(building)) return cap;
        const lo = Math.min(cap, Math.max(1, Number(C.minFloors[type]) || 1));
        // A tile-composed building stands as many storeys as its street front shows (its upper
        // windows: interiorPlanner.js _exteriorOf), held to what its type and builders allow
        const def = building._customDefId != null && CustomBuildings && CustomBuildings.getBuilding ? CustomBuildings.getBuilding(building._customDefId) : null;
        const shown = def && this._exteriorOf ? (this._exteriorOf(def) || {}).storeys : null;
        if (Number.isFinite(shown) && shown >= 1) return Math.max(lo, Math.min(cap, shown));
        const wt = this.currentWorldTile || {};
        return lo + (_hash(`${wt.q},${wt.r}|${building.q},${building.r}|${type}`) % (cap - lo + 1));
    },

    /** "the cellar", "the ground floor", "the 2nd floor"… */
    floorLabel(k) {
        if (k < 0) return 'the cellar';
        return k === 0 ? 'the ground floor' : `the ${_ord(k + 1)} floor`;
    },

    /** The kind of room on floor k (≥1) of a building; k < 0: its cellar's (null when it has none). */
    floorRoom(building, k) {
        if (k < 0) return this.cellarRoom(building);
        const C = _cfg();
        const type = _type(building);
        const list = C.upperRooms[type] || C.upperRooms._default || ['quarters'];
        const kind = list[Math.min(list.length, Math.max(1, k)) - 1];
        return { kind, ...(C.rooms[kind] || { name: 'Upper Floor', furniture: [] }) };
    },

    /**
     * The cellar under a building (data/buildingFloors.json `cellars`): its room kind, or
     * null. By type (a tavern's ale cellar, a manor's wine cellar, a shop's store cellar, a
     * bank's vault), some only of a wealth tier and by a hash of the place (a rich house's
     * root cellar); none under a jail, a castle, a way underground or a Dawn of Man camp.
     */
    cellarOf(building, tier = null) {
        if (!building || building._jail || building._underground) return null;
        const type = _type(building);
        if (type === 'jail' || type === 'castle') return null;
        const st = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        if (st && this._isDawnVillage && this._isDawnVillage(st)) return null;
        const spec = (_cfg().cellars || {})[type];
        if (!spec) return null;
        const s = typeof spec === 'string' ? { kind: spec } : spec;
        if (!s.kind) return null;
        if (Array.isArray(s.tiers) && !s.tiers.includes(tier || 'mid')) return null;
        if (s.chance != null) {
            const wt = this.currentWorldTile || {};
            if ((_hash(`${wt.q},${wt.r}|${building.q},${building.r}|${type}|cellar`) % 1000) / 1000 >= Number(s.chance)) return null;
        }
        return s.kind;
    },

    /** The cellar's room ({ kind, name, floor, wall, furniture }) of the building shown, or of `building`; null for none. */
    cellarRoom(building) {
        const kind = this._insideBuilding === building && this._cellarKind !== undefined ? this._cellarKind
            : this.cellarOf(building, this._floorInteriors && this._floorInteriors[0] && this._floorInteriors[0]._tier);
        if (!kind) return null;
        return { kind, ...((_cfg().rooms || {})[kind] || { name: 'Cellar', furniture: [] }) };
    },

    /**
     * On entering: how many floors the building has, the ground floor's stairs
     * up (made functional where the layout drew some, put in where it didn't,
     * taken out when there's no floor above), its stairs down to the cellar
     * where it has one, and the player on the ground floor.
     */
    _prepareFloors(interior, building, interiorKey, game) {
        const n = this.floorsOf(building, game);
        this._floor = 0;
        this._floorCount = n;
        this._floorKey = interiorKey;
        this._floorInteriors = { 0: interior };
        const cellar = this.cellarOf(building, interior._tier);
        this._cellarKind = cellar;
        this._hasCellar = !!cellar;
        const C = _cfg();
        const { tiles, width: w, height: h } = interior;
        let stairs = null, down = null;
        for (let r = 0; r < h; r++) {
            for (let q = 0; q < w; q++) {
                const t = tiles[r][q];
                if (!t || !t._furniture) continue;
                if (t._stairs && t._stairs.to < 0) { if (!down) down = { q, r }; continue; }
                if (!stairs && (t._furniture.type === 'stairs' || t._stairs)) stairs = { q, r };
            }
        }
        const clear = (at) => { if (at) { tiles[at.r][at.q]._furniture = null; tiles[at.r][at.q]._stairs = null; } };
        if (n <= 1) { clear(stairs); stairs = null; }
        else {
            if (!stairs) stairs = this._stairsSpot(interior, [], `${interiorKey}|up0`);
            if (stairs) {
                const t = tiles[stairs.r][stairs.q];
                const keep = t._furniture && t._furniture.type === 'stairs' ? t._furniture.name : null;
                t._furniture = { ...C.stairs.up, name: keep || C.stairs.up.name, passable: true, _stairs: true };
                t._stairs = { to: 1 };
                t.subTerrain = { ...t.subTerrain, passable: true };
            }
        }
        // The stairs down to the cellar, away from the stairs up
        if (!cellar) { clear(down); down = null; }
        else {
            if (!down) down = this._stairsSpot(interior, stairs ? [stairs] : [], `${interiorKey}|cellar`);
            if (down) {
                const t = tiles[down.r][down.q];
                t._furniture = { ...C.stairs.down, name: (C.stairs.cellar && C.stairs.cellar.name) || 'Cellar Steps', passable: true, _stairs: true };
                t._stairs = { to: -1 };
                t.subTerrain = { ...t.subTerrain, passable: true };
            } else this._hasCellar = false;
        }
        interior._stairs = { up: stairs, down };
        return n;
    },

    /**
     * A free floor tile for stairs: along a wall, clear of furniture, with room
     * round it, near the back corner; never next to the stairs already placed.
     */
    _stairsSpot(interior, avoid, seed) {
        const { tiles, width: w, height: h } = interior;
        const free = (q, r) => {
            const t = tiles[r] && tiles[r][q];
            return !!(t && _isFloorTile(t) && t.subTerrain.passable && !t._furniture && !t.customObject && !t.customObjectPart && !t._isDoor);
        };
        const nearDoor = (q, r) => {
            for (let dr = -2; dr <= 2; dr++) for (let dq = -2; dq <= 2; dq++) {
                const t = tiles[r + dr] && tiles[r + dr][q + dq];
                if (t && t._isDoor) return true;
            }
            return false;
        };
        const byWall = (q, r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => {
            const t = tiles[r + dr] && tiles[r + dr][q + dq];
            return !t || t.baseTerrain === 'wall' || t.baseTerrain === 'void';
        });
        const rng = _rng(seed);
        const corners = [{ q: w - 2, r: 1 }, { q: 1, r: 1 }];
        const goal = avoid.length ? corners.reduce((a, b) => (Math.hypot(b.q - avoid[0].q, b.r - avoid[0].r) > Math.hypot(a.q - avoid[0].q, a.r - avoid[0].r) ? b : a))
            : corners[Math.floor(rng() * 2)];
        let best = null, bestScore = Infinity;
        for (let r = 1; r < h - 1; r++) {
            for (let q = 1; q < w - 1; q++) {
                if (!free(q, r) || !byWall(q, r) || nearDoor(q, r)) continue;
                if (avoid.some(a => Math.max(Math.abs(a.q - q), Math.abs(a.r - r)) <= 2)) continue;
                let room = 0;
                for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) if ((dq || dr) && free(q + dq, r + dr)) room++;
                if (room < 2) continue;
                const score = Math.hypot(q - goal.q, r - goal.r) - room * 0.2;
                if (score < bestScore) { bestScore = score; best = { q, r }; }
            }
        }
        return best;
    },

    /** The cache key of floor k of the building whose ground floor is keyed `key` (the cellar: k < 0). */
    _floorCacheKey(key, k) {
        return k < 0 ? `${key}_cellar` : k === 0 ? key : `${key}_f${k}`;
    },

    /** Floor k's interior (k ≥ 1; -1 the cellar), built from the floor below (above) the first time. */
    _floorInterior(k) {
        if (k === 0) return this._floorInteriors && this._floorInteriors[0];
        if (this._floorInteriors && this._floorInteriors[k]) return this._floorInteriors[k];
        if (k < 0 && (k !== -1 || !this._hasCellar)) return null;
        const key = this._floorCacheKey(this._floorKey, k);
        let interior = this._interiorCache[key];
        if (!interior) {
            const below = this._floorInterior(k < 0 ? 0 : k - 1);
            const way = below && below._stairs && (k < 0 ? below._stairs.down : below._stairs.up);
            if (!way) return null;
            interior = k < 0 ? this._buildCellar(below, this._insideBuilding, key)
                : this._buildUpperFloor(below, this._insideBuilding, k, k < this._floorCount - 1, key);
            if (!interior) return null;
            this._interiorCache[key] = interior;
        }
        this._floorInteriors[k] = interior;
        return interior;
    },

    /**
     * Every floor of the building shown built now (and its cellar): on the first visit, so
     * the whole house is fixed at once and kept (world/innerMap/interiorRecords.js).
     */
    _buildAllFloors() {
        for (let k = 1; k < (this._floorCount || 1); k++) if (!this._floorInterior(k)) break;
        if (this._hasCellar) this._floorInterior(-1);
    },

    /**
     * A floor planned over (or under) the ground floor by the interior planner
     * (interiorPlanner.js, data/interiorPlans.json `floors`): the ground floor's footprint,
     * its outer walls of the same stuff, its own rooms (bedchambers, a solar, servants'
     * rooms; guest rooms off a landing; a cellar's wine vault) with inner walls and
     * doorways, entered by the stairs at `entry` (kept clear, in the main room), the
     * room's pieces (data/buildingFloors.json `rooms`) set down by the placement rules,
     * then its decor. Null where the ground floor wasn't planned (an authored interior).
     */
    _planFloor(below, building, k, room, entry, seed) {
        if (!this._planInterior || !this._planData || !Array.isArray(below.rooms)) return null;
        const P = this._planData();
        if (!P || !room) return null;
        const cellar = k < 0;
        const type = _type(building);
        const FP = P.floors || {};
        // (its type's own plan of the room, else the room's, over what every floor above / cellar has)
        const base = (cellar ? FP._cellar : FP._upper) || {};
        const own = FP[`${type}.${room.kind}`] || FP[room.kind] || {};
        const plan = {
            ...base, ...own,
            place: { ...(base.place || {}), ...(own.place || {}) },
            main: { name: room.name, ...(base.main || {}), ...(own.main || {}) },
        };
        // Its walls of the ground floor's stuff (a cellar's of its own: rooms[kind].wall)
        let proto = null;
        for (let r = 0; r < below.height && !proto; r++) for (let q = 0; q < below.width; q++) {
            const t = below.tiles[r][q];
            if (t && t.baseTerrain === 'wall' && !t._innerWall) { proto = t; break; }
        }
        const wall = (cellar && room.wall) || (proto && proto._wallMaterial) || null;
        const wallColor = (cellar && room.wallColor) || (proto && proto.subTerrain && proto.subTerrain.color) || '#5a4a3a';
        const tier = below._tier || 'mid';
        const look0 = this._interiorLook ? this._interiorLook(null, building && building.type, { wall, floor: room.floor || 'wood_floor' }) : { kind: 'home' };
        const look = { wall, floor: room.floor || 'wood_floor', tier, kind: look0.kind || 'home', tint: cellar ? null : (proto && proto._wallTint) || null };
        // (a cellar's stores fill out its rows by its size: `perArea` pieces a floor tile, up to `max`,
        // the ones past `count` set down in their rows or not at all — _fill)
        const area = Math.max(1, (below.width - 2) * (below.height - 2));
        const pieces = [];
        for (const f of (room.furniture || [])) {
            const base = {
                type: f.type, icon: f.icon, name: f.name, passable: !!f.passable,
                ...(f.art ? { art: f.art } : {}), ...(f.noJoin ? { noJoin: true } : {}),
                ...(f.place ? { place: f.place } : f.middle ? { place: 'centre' } : {}),
            };
            const count = Math.max(0, Number(f.count) || 1);
            pieces.push({ f: base, count });
            const want = Number(f.perArea) > 0 ? Math.min(Number(f.max) || Infinity, Math.round(Number(f.perArea) * area)) : 0;
            if (want > count) pieces.push({ f: { ...base, _fill: true }, count: want - count });
        }
        const out = this._planInterior(building, seed, { width: below.width, height: below.height, furniture: [], wallColor }, look, null, below._who || null, {
            size: [below.width, below.height], entry, plan, pieces, floorId: room.floor, upper: !cellar, cellar, landing: cellar,
        });
        if (!out) return null;
        if (this._joinPieces) this._joinPieces(out.tiles, out.width, out.height, entry);
        if (this._decorateInterior) this._decorateInterior(out.tiles, out.width, out.height, out.info);
        if (cellar) this._dressCellar(out, room.kind, entry, seed);
        for (const row of out.tiles) for (const t of row) { t._floorAbove = k; if (cellar) t._cellar = true; }
        return {
            tiles: out.tiles, width: out.width, height: out.height, rooms: out.rooms,
            _floor: k, _room: room.kind, _who: below._who || null, _tier: tier, _planned: true,
        };
    },

    /**
     * A cellar's own look over its plan and decor (data/buildingFloors.json `cellarDress`, its
     * kind's over `_default`): wall torches spaced for the light model (ui/interiorLight.js) —
     * the fewest that leave no walkable tile further than `torch.cover` (by the floor, as the
     * light spreads) from a torch or candle, none side by side — cobwebs in the back wall's top
     * corners, and on the bare floor (tile._decor, drawn at the tile's foot) straw kicked about
     * the casks and sacks, grain spilt by the sacks and damp patches. Seeded by `seed`; never on
     * the steps, their landing or a doorway. Pure over `interior`. → what it added.
     */
    _dressCellar(interior, kind, entry, seed) {
        const all = _cfg().cellarDress || {};
        const D = { ...(all._default || {}), ...(all[kind] || {}) };
        const { tiles, width: w, height: h } = interior;
        const rng = _rng(`${seed}|dress`);
        const T = (q, r) => (tiles[r] && tiles[r][q]) || null;
        const isWall = (t) => !t || t.baseTerrain === 'wall' || t.baseTerrain === 'void';
        const open = (t) => !!t && !isWall(t) && !t._isDoor && !!(t.subTerrain && t.subTerrain.passable);
        // (the light spreads over every tile that is no wall, the pieces' too: ui/interiorLight.js)
        const bright = (t) => !!t && (!isWall(t) || !!t._doorway);
        const landing = (q, r) => !!entry && Math.max(Math.abs(q - entry.q), Math.abs(r - entry.r)) <= 1;
        const out = { torches: 0, cobwebs: 0, floor: 0 };
        // ── Torches: greedy cover of the walkable floor ──
        const tc = D.torch || {};
        const R = Number(tc.cover) || 3.5, maxT = Number.isFinite(Number(tc.max)) ? Number(tc.max) : 10;
        const N = w * h;
        // (the floor distance from seeds, by 8-steps — a diagonal only past two open sides — as the light spreads)
        const spread = (seeds) => {
            const d = new Float32Array(N).fill(Infinity);
            for (const [q, r, d0] of seeds) d[r * w + q] = Math.min(d[r * w + q], d0);
            for (let pass = 0, changed = true; changed && pass < w + h; pass++) {
                changed = false;
                for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
                    if (!bright(tiles[r][q])) continue;
                    let best = d[r * w + q];
                    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                        if (!i && !j) continue;
                        if (!bright(T(q + i, r + j))) continue;
                        if (i && j && !(bright(T(q + i, r)) && bright(T(q, r + j)))) continue;
                        const nd = d[(r + j) * w + q + i] + (i && j ? 1.414 : 1);
                        if (nd < best) best = nd;
                    }
                    if (best < d[r * w + q]) { d[r * w + q] = best; changed = true; }
                }
            }
            return d;
        };
        // (a light on a wall lights the floor before it; a candle its own tile and round it)
        const seedsOf = (q, r) => {
            const t = T(q, r);
            if (bright(t)) return [[q, r, 0]];
            const s = [];
            for (const [i, j] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (bright(T(q + i, r + j))) s.push([q + i, r + j, 0.6]);
            return s;
        };
        // (a candle lights less far than a torch: `stand.cover`)
        const sc = D.stand || {};
        const Rc = Number(sc.cover) || 3, maxS = Number.isFinite(Number(sc.max)) ? Number(sc.max) : 3;
        const torchLights = [], candleLights = [];
        for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            const t = tiles[r][q];
            const decor = [].concat(t._decor || []);
            if (t._wallDecor === 'torch' || (t._furniture && t._furniture.type === 'fireplace')) torchLights.push(...seedsOf(q, r));
            else if ((t._furniture && t._furniture.type === 'candle') || decor.includes('candles')) candleLights.push(...seedsOf(q, r));
        }
        const litT = torchLights.length ? spread(torchLights) : null, litC = candleLights.length ? spread(candleLights) : null;
        const dark = new Set();
        for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
            const i = r * w + q;
            if (open(tiles[r][q]) && !(litT && litT[i] <= R) && !(litC && litC[i] <= Rc)) dark.add(i);
        }
        // (where a torch could hang: a wall with floor before it — not the front wall, over a
        // doorway or behind a tall rack — nothing on it, and no torch beside it)
        const TALL = new Set(['barrel_rack', 'shelf', 'crate_stack', 'bookshelf', 'cupboard', 'wardrobe', 'rack']);
        const faceOf = (q, r) => {
            const fit = (t) => bright(t) && !t._doorway && !(t._furniture && TALL.has(t._furniture.type));
            if (r < h - 1 && fit(T(q, r + 1))) return { face: 'down', at: [q, r + 1] };
            if (fit(T(q + 1, r))) return { face: 'right', at: [q + 1, r] };
            if (fit(T(q - 1, r))) return { face: 'left', at: [q - 1, r] };
            return null;
        };
        const cands = [];
        for (let r = 0; r < h - 1; r++) for (let q = 0; q < w; q++) {
            const t = tiles[r][q];
            if (!isWall(t) || t.baseTerrain === 'void' || t._wallDecor || t._doorway) continue;
            const fc = faceOf(q, r);
            if (!fc) continue;
            cands.push({ q, r, fc, d: spread(seedsOf(q, r)), j: rng() * 0.5 });
        }
        const torchNear = (q, r) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([i, j]) => { const o = T(q + i, r + j); return !!(o && o._wallDecor === 'torch'); });
        while (dark.size && out.torches < maxT) {
            let best = null, bestGain = 0;
            for (const c of cands) {
                if (tiles[c.r][c.q]._wallDecor || torchNear(c.q, c.r)) continue;
                let gain = 0;
                for (const i of dark) if (c.d[i] <= R) gain++;
                if (gain && gain + c.j > bestGain) { bestGain = gain + c.j; best = c; }
            }
            if (!best) break;
            const t = tiles[best.r][best.q];
            t._wallDecor = 'torch';
            t._wallDecorFace = best.fc.face;
            out.torches++;
            for (const i of [...dark]) if (best.d[i] <= R) dark.delete(i);
        }
        // ── Where no wall is near enough (the middle of a big cellar): a candle stand on the floor ──
        for (let n = 0; dark.size && n < maxS; n++) {
            let best = null, bestGain = 0, bestD = null;
            for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
                const t = tiles[r][q];
                if (!open(t) || t._furniture || t._decor || t._stairs || landing(q, r)) continue;
                if (!dark.has(r * w + q)) continue;
                const d = spread([[q, r, 0]]);
                let gain = 0;
                for (const i of dark) if (d[i] <= Rc) gain++;
                gain += rng() * 0.5;
                if (gain > bestGain) { bestGain = gain; best = t; bestD = d; }
            }
            if (!best) break;
            best._furniture = { type: 'candle', icon: '🕯️', name: sc.name || 'Candle Stand', passable: true };
            out.stands = (out.stands || 0) + 1;
            for (const i of [...dark]) if (bestD[i] <= Rc) dark.delete(i);
        }
        // ── Cobwebs in the back wall's top corners (and where an inner wall meets it) ──
        const webK = Number((D.cobweb || {}).chance) || 0;
        for (let q = 1; q < w - 1 && webK > 0; q++) {
            const t = tiles[0][q], below = T(q, 1);
            if (!isWall(t) || t._wallDecor || isWall(below) || below._doorway) continue;
            const left = isWall(T(q - 1, 1)), right = isWall(T(q + 1, 1));
            if (!left && !right) continue;
            if (rng() >= webK) continue;
            t._wallDecor = left ? 'cobweb' : 'cobweb_r';
            t._wallDecorFace = 'down';
            out.cobwebs++;
        }
        // ── On the bare floor: straw by the casks and sacks, grain by the sacks, damp patches ──
        const by = (q, r, types) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => {
            const o = T(q + i, r + j);
            return !!(o && o._furniture && types.includes(o._furniture.type));
        });
        const grain = D.grain || {}, straw = D.straw || {}, damp = D.puddle || {};
        for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
            const t = tiles[r][q];
            if (!open(t) || t._furniture || t._decor || t._doorway || t._stairs || landing(q, r)) continue;
            let id = null;
            if (grain.chance && by(q, r, grain.near || ['sack', 'sack_pile']) && rng() < grain.chance) id = 'grain_spill';
            else if (straw.chance && by(q, r, straw.near || ['barrel', 'barrel_rack', 'crate', 'sack']) && rng() < straw.chance) id = 'straw_loose';
            else if (damp.chance && (!damp.floors || damp.floors.includes(t.baseTerrain)) && rng() < damp.chance) id = 'puddle';
            if (!id) continue;
            t._decor = id;
            out.floor++;
        }
        return out;
    },

    /** The cellar under `ground`: planned, its stairs up where the ground floor's go down. */
    _buildCellar(ground, building, seed) {
        const C = _cfg();
        const room = this.cellarRoom(building);
        const down = ground._stairs && ground._stairs.down;
        if (!room || !down) return null;
        let interior = this._planFloor(ground, building, -1, room, down, seed);
        if (!interior) {
            // (an authored ground floor: a plain cellar of its footprint, its pieces along the walls)
            interior = this._buildUpperFloor(ground, building, -1, false, seed, room);
            for (const row of interior.tiles) for (const t of row) t._cellar = true;
            return interior;
        }
        const t = interior.tiles[down.r][down.q];
        t._furniture = { ...C.stairs.up, name: (C.stairs.cellar && C.stairs.cellar.upName) || 'Steps Up', passable: true, _stairs: true };
        t._stairs = { to: 0 };
        interior._stairs = { up: down, down: null };
        return interior;
    },

    /**
     * An upper floor over `below`: planned where the ground floor was (_planFloor), else
     * the same footprint and walls (no door: its doorway is floor), the room's floor and
     * furniture laid along the walls; the stairs down where the stairs below come up, and
     * stairs up when a floor stands above. (`asRoom`: a cellar under an authored floor.)
     */
    _buildUpperFloor(below, building, k, hasAbove, seed, asRoom = null) {
        const C = _cfg();
        const { width: w, height: h } = below;
        if (!asRoom) {
            const who0 = below._who || null;
            let room0 = this.floorRoom(building, k);
            if (who0 && k === 1 && this._householdRoom) room0 = this._householdRoom(room0, who0, below._tier);
            const planned = this._planFloor(below, building, k, room0, below._stairs.up, seed);
            if (planned) {
                const down = below._stairs.up;
                const dt = planned.tiles[down.r][down.q];
                dt._furniture = { ...C.stairs.down, passable: true, _stairs: true };
                dt._stairs = { to: k - 1 };
                let up = null;
                if (hasAbove) {
                    up = this._stairsSpot(planned, [down], `${seed}|up`);
                    if (up) {
                        const ut = planned.tiles[up.r][up.q];
                        ut._furniture = { ...C.stairs.up, passable: true, _stairs: true };
                        ut._stairs = { to: k + 1 };
                        delete ut._decor;
                    }
                }
                planned._stairs = { up, down };
                return planned;
            }
        }
        // (whose it is: the household sleeps in the bedchamber over the house — interiorPlanner.js)
        const who = below._who || null;
        let room = asRoom || this.floorRoom(building, k);
        if (!asRoom && who && k === 1 && this._householdRoom) room = this._householdRoom(room, who, below._tier);
        const floorId = room.floor || 'wood_floor';
        const floorDef = (this.INTERIOR_FLOORS && this.INTERIOR_FLOORS[floorId]) || { color: '#8B7355', altColor: '#7A6548', name: 'Floor' };
        // A wall tile to copy where the door was
        let wallProto = null;
        for (let r = 0; r < h && !wallProto; r++) for (let q = 0; q < w; q++) {
            const t = below.tiles[r][q];
            if (t && t.baseTerrain === 'wall') { wallProto = t; break; }
        }
        const copyWall = (src, q, r) => {
            const s = src || wallProto;
            const t = s ? JSON.parse(JSON.stringify(s)) : { baseTerrain: 'wall', subTerrain: { id: 'wall', name: 'Wall', icon: '🧱', color: '#5a4a3a', passable: false } };
            Object.assign(t, { q, r, _isDoor: false, _furniture: null, _stairs: null, customObject: null, customObjectPart: null, explored: true, visible: true, _floorAbove: k });
            if (t.baseTerrain !== 'void') { t.baseTerrain = 'wall'; t.subTerrain = { ...(t.subTerrain || {}), id: 'wall', name: 'Wall', icon: '🧱', passable: false }; }
            // (the windows go up with the walls; what hangs on them below stays below: interiorPlanner.js)
            if (t._wallDecor && t._wallDecor !== 'window' && t._wallDecor !== 'curtains') { delete t._wallDecor; delete t._wallDecorFace; }
            delete t._decor;
            return t;
        };
        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles[r] = [];
            for (let q = 0; q < w; q++) {
                const g = below.tiles[r][q];
                // (the doorway below is floor up here when the rest of its row is; a door in a
                // wall below is wall up here, like the wall beside it)
                const doorInWall = !!(g && g._isDoor) && [-1, 1].every(d => {
                    const n = below.tiles[r][q + d];
                    return !!n && !_isFloorTile(n) && !n._isDoor;
                });
                if (doorInWall) {
                    tiles[r][q] = copyWall(below.tiles[r][q - 1], q, r);
                    continue;
                }
                if (!_isFloorTile(g) && !(g && g._isDoor)) {
                    tiles[r][q] = copyWall(g, q, r);
                    continue;
                }
                const alt = (q + r) % 2 === 0;
                tiles[r][q] = {
                    q, r,
                    baseTerrain: floorId,
                    subTerrain: { id: floorId, name: floorDef.name, icon: '🏠', color: alt ? floorDef.color : floorDef.altColor, passable: true },
                    explored: true, visible: true, parentTerrain: 'interior', encounter: null, building: null,
                    _isInterior: true, _interiorBuildingType: building ? building.type : 'house',
                    _wallMaterial: (wallProto && wallProto._wallMaterial) || null,
                    _furniture: null, _floorAbove: k,
                    effectiveTemp: 20, moisture: 0.3, weatherType: 'clear',
                };
            }
        }
        const interior = { tiles, width: w, height: h, _floor: k, _room: room.kind, _who: who, _tier: below._tier };
        // The front wall's windows where the street front shows its upper ones (interiorPlanner.js)
        const ex = who && who.exterior;
        if (asRoom) {
            // (underground: no windows)
            for (const row of tiles) for (const t of row) if (t._wallDecor === 'window' || t._wallDecor === 'curtains') { delete t._wallDecor; delete t._wallDecorFace; }
        } else if (ex && Array.isArray(ex.upper)) {
            const front = tiles[h - 1] || [];
            for (const t of front) if (t && (t._wallDecor === 'window' || t._wallDecor === 'curtains')) { delete t._wallDecor; delete t._wallDecorFace; }
            for (const f of ex.upper) {
                const q = Math.max(1, Math.min(w - 2, 1 + Math.round(f * (w - 2) - 0.5)));
                const t = front[q];
                const inside = tiles[h - 2] && tiles[h - 2][q];
                if (t && t.baseTerrain === 'wall' && inside && inside.baseTerrain !== 'wall') { t._wallDecor = 'window'; t._wallDecorFace = 'up'; }
            }
        }
        // The stairs down, where the stairs below come up (a cellar's up, where the ground floor's go down)
        if (asRoom) {
            const at = below._stairs.down;
            const st = tiles[at.r] && tiles[at.r][at.q];
            if (st) {
                st._furniture = { ...C.stairs.up, name: (C.stairs.cellar && C.stairs.cellar.upName) || 'Steps Up', passable: true, _stairs: true };
                st._stairs = { to: 0 };
            }
            interior._stairs = { up: at, down: null };
            this._furnishUpperFloor(interior, room, [at], seed);
            return interior;
        }
        const down = below._stairs.up;
        const dt = tiles[down.r] && tiles[down.r][down.q];
        if (dt) {
            dt._furniture = { ...C.stairs.down, passable: true, _stairs: true };
            dt._stairs = { to: k - 1 };
        }
        let up = null;
        if (hasAbove) {
            up = this._stairsSpot(interior, [down], `${seed}|up`);
            if (up) {
                tiles[up.r][up.q]._furniture = { ...C.stairs.up, passable: true, _stairs: true };
                tiles[up.r][up.q]._stairs = { to: k + 1 };
            }
        }
        interior._stairs = { up, down };
        this._furnishUpperFloor(interior, room, [down, up].filter(Boolean), seed);
        return interior;
    },

    /** The room's furniture along the walls (rugs in the middle), never blocking the way between the stairs. */
    _furnishUpperFloor(interior, room, stairs, seed) {
        const { tiles, width: w, height: h } = interior;
        const rng = _rng(`${seed}|furnish`);
        const nearStairs = (q, r) => stairs.some(s => Math.max(Math.abs(s.q - q), Math.abs(s.r - r)) <= 1);
        const isWallish = (q, r) => { const t = tiles[r] && tiles[r][q]; return !t || t.baseTerrain === 'wall' || t.baseTerrain === 'void'; };
        const open = (q, r) => { const t = tiles[r] && tiles[r][q]; return !!(t && t.subTerrain.passable && !t._furniture && t.baseTerrain !== 'wall'); };
        const edge = [], middle = [];
        for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            if (!open(q, r) || nearStairs(q, r)) continue;
            const byWall = isWallish(q - 1, r) || isWallish(q + 1, r) || isWallish(q, r - 1) || isWallish(q, r + 1);
            (byWall ? edge : middle).push({ q, r });
        }
        const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
        shuffle(edge); shuffle(middle);
        // Everything walkable still reached from the stairs down?
        const allReached = () => {
            const start = stairs[0];
            const seen = new Set([`${start.q},${start.r}`]);
            const queue = [start];
            while (queue.length) {
                const { q, r } = queue.shift();
                for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nq = q + dq, nr = r + dr, key = `${nq},${nr}`;
                    const t = tiles[nr] && tiles[nr][nq];
                    if (seen.has(key) || !t || !t.subTerrain.passable) continue;
                    seen.add(key); queue.push({ q: nq, r: nr });
                }
            }
            for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) if (tiles[r][q].subTerrain.passable && !seen.has(`${q},${r}`)) return false;
            return true;
        };
        for (const f of room.furniture || []) {
            for (let i = 0; i < (Number(f.count) || 1); i++) {
                const pool = f.middle ? middle : edge;
                while (pool.length) {
                    const at = pool.shift();
                    const t = tiles[at.r][at.q];
                    if (t._furniture) continue;
                    const passable = !!f.passable;
                    const prev = t.subTerrain;
                    t._furniture = { type: f.type, icon: f.icon, name: f.name, passable };
                    // (a straw pallet keeps its look, and stays a tile's piece)
                    if (f.art) t._furniture.art = f.art;
                    if (f.noJoin) t._furniture.noJoin = true;
                    if (!passable) {
                        t.subTerrain = { id: `furniture_${f.type}`, name: f.name, icon: f.icon, color: (this.FURNITURE_COLORS && this.FURNITURE_COLORS[f.type]) || '#6a5a4a', passable: false };
                        if (!allReached()) { t._furniture = null; t.subTerrain = prev; continue; }
                    }
                    break;
                }
            }
        }
        // Its beds and tables at their own size (world/innerMap/interiors.js)
        if (this._joinPieces) this._joinPieces(tiles, w, h, stairs[0]);
    },

    /**
     * The floor someone inside this building is on. Abed, they're where the
     * beds are (upstairs, where there are any); those who live here keep about
     * the whole house by day, each on a floor of their own; a lodger keeps to
     * the rooms above; anyone else (a customer, a worker, a caller) is
     * downstairs.
     */
    npcFloor(npc) {
        // (down in the cellar fetching ale, wine or stores: world/innerMap/cellarTrips.js)
        const below = this._cellarFloorFor ? this._cellarFloorFor(npc) : null;
        if (below != null) return below;
        const n = this._floorCount || 1;
        const b = this._insideBuilding;
        if (n <= 1 || !npc || !b) return 0;
        const h = _hash(String(npc.id != null ? npc.id : npc.name || ''));
        // (a household planned by the bed sleeps together on the first floor of beds, a babe in its cradle there: householdRooms.js)
        const together = this._hhPlanned && this._hhPlanned(b) && npc._home && npc._home.q === b.q && npc._home.r === b.r;
        const own = together && this._householdOwn ? this._householdOwn(npc) : null;
        if (this._townAbed && this._townAbed(npc)) {
            if (own) return own.k;
            const beds = this.bedFloors(b);
            return beds.length ? beds[together ? 0 : h % beds.length] : 0;
        }
        if (own && own.kind === 'cradle' && this._hhInfant(npc)) return own.k;
        const home = npc._home;
        // (home for a meal: down at the family table — world/innerMap/townWork.js _homeMealSeat)
        if (home && home.q === b.q && home.r === b.r && (npc._meal === 'supper' || npc._meal === 'breakfast')) return 0;
        // (a babe's parents and the children keep about the cradle's floor by day: householdRooms.js)
        const byCradle = together && this._hhCradleFloor ? this._hhCradleFloor(npc, b) : null;
        if (byCradle != null) return byCradle;
        // (a household of a tenement or a row keeps to its own floor: world/innerMap/townLife.js)
        if (home && home.q === b.q && home.r === b.r) return npc._homeSlot != null ? npc._homeSlot % n : h % n;
        if (this._isLodger && this._isLodger(npc, b)) return 1 + (h % (n - 1));
        return 0;
    },

    /** The floors of a building with beds on them (upstairs first; the ground floor only when none above has any). */
    bedFloors(building) {
        const n = this._insideBuilding === building ? (this._floorCount || 1) : this.floorsOf(building);
        const up = [];
        for (let k = 1; k < n; k++) {
            if ((this.floorRoom(building, k).furniture || []).some(f => f.type === 'bed')) up.push(k);
        }
        return up.length ? up : [0];
    },

    /**
     * Someone abed is laid in a free bed on this floor (their own, in
     * effect: who sleeps where is fixed by who they are); anyone else stands
     * about the floor as usual. Returns whether they were placed.
     */
    _placeNpcOnFloor(npc, interior) {
        npc._asleep = null;
        // A babe of the house in its cradle, day and night (world/innerMap/householdRooms.js)
        if (this._layInCradle && this._layInCradle(npc, interior)) {
            (this._sleepersPlaced = this._sleepersPlaced || []).push({ q: npc.q, r: npc.r });
            return true;
        }
        if (this._townAbed && this._townAbed(npc)) {
            // The household in its own beds: a couple side by side, the children paired (householdRooms.js)
            const own = this._householdBedFor && this._householdBedFor(npc, interior);
            if (own && own.kind === 'bed') {
                npc.q = npc.prevQ = own.q;
                npc.r = npc.prevR = own.r;
                npc.path = null;
                npc.moveProgress = 0;
                npc._act = null;
                npc._asleep = { q: own.q, r: own.r, side: own.side || 0 };
                npc.activity = { type: 'bed', icon: '💤', label: 'asleep', anim: 'idle' };
                npc.facing = 2;
                (this._sleepersPlaced = this._sleepersPlaced || []).push({ q: own.q, r: own.r });
                return true;
            }
            const taken = new Set((this._sleepersPlaced || []).map(s => `${s.q},${s.r}`));
            // (anyone else leaves the household's own beds to it while there are others free)
            const reserved = this._householdReserved ? this._householdReserved(interior) : new Set();
            let beds = [];
            for (const row of interior.tiles) for (const t of row) {
                // (a bed of two tiles is lain in from its head)
                if (t && t._furniture && t._furniture.type === 'bed' && !(t._furniture.piece && t._furniture.piece.j) && !taken.has(`${t.q},${t.r}`)
                    && (!this._npcCanUseAt || this._npcCanUseAt(t.q, t.r, interior.tiles))) beds.push(t);   // (not a broken one: world/furnitureUsable.js)
            }
            const spare = beds.filter(t => !reserved.has(`${t.q},${t.r}`));
            if (spare.length) beds = spare;
            if (beds.length) {
                const bed = beds[_hash(String(npc.id != null ? npc.id : npc.name || '')) % beds.length];
                npc.q = npc.prevQ = bed.q;
                npc.r = npc.prevR = bed.r;
                npc.path = null;
                npc.moveProgress = 0;
                npc._act = null;
                npc._asleep = { q: bed.q, r: bed.r };
                npc.activity = { type: 'bed', icon: '💤', label: 'asleep', anim: 'idle' };
                npc.facing = 2;
                (this._sleepersPlaced = this._sleepersPlaced || []).push({ q: bed.q, r: bed.r });
                return true;
            }
            // More of them than beds: a bedroll on the floor
            if (!this._placeNpcInInterior(npc, interior)) return false;
            npc._asleep = { q: npc.q, r: npc.r, bedroll: true };
            npc.activity = { type: 'bed', icon: '💤', label: 'asleep', anim: 'idle' };
            npc.facing = 2;
            (this._sleepersPlaced = this._sleepersPlaced || []).push({ q: npc.q, r: npc.r });
            return true;
        }
        return this._placeNpcInInterior(npc, interior);
    },

    /** Gather this floor's people from those inside the building (and lay the sleepers in their beds). */
    _peopleOnFloor(interior, k) {
        const b = this._insideBuilding;
        const outer = (this._outerMapState && this._outerMapState.npcs) || [];
        this._sleepersPlaced = [];
        const here = [];
        for (const npc of outer) {
            if (npc.state !== 'inside_building' || npc._insideBuildingQ !== b.q || npc._insideBuildingR !== b.r) continue;
            if (this.npcFloor(npc) !== k) continue;
            if (this._placeNpcOnFloor(npc, interior)) here.push(npc);
        }
        this._sleepersPlaced = null;
        return here;
    },

    /** Awake again (the hour has come round): up out of bed, to go about the day. */
    _wakeNpc(npc) {
        if (!npc._asleep) return;
        const bed = npc._asleep;
        npc._asleep = null;
        npc.activity = null;
        npc._act = null;
        // Out of bed onto the floor beside it (not where the player stands, nor on anyone else)
        let stand = null;
        for (const [dq, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const q = bed.q + dq, r = bed.r + dr;
            const t = this.tiles[r] && this.tiles[r][q];
            if (!t || !t.subTerrain.passable || t._stairs || t._isDoor) continue;
            if (q === this.playerInnerQ && r === this.playerInnerR) continue;
            if (this.npcs.some(n => n !== npc && n.q === q && n.r === r)) continue;
            stand = { q, r };
            break;
        }
        if (stand) { npc.q = npc.prevQ = stand.q; npc.r = npc.prevR = stand.r; }
        npc.idleTimer = 2 + Utils.random() * 6;
    },

    /** The stairs down on this floor (the way out from upstairs), or null. */
    _stairsDownTile() {
        if (!this._floor || !this.tiles) return null;
        // (up from the cellar: its steps up to the ground floor)
        const toward = (to) => (this._floor > 0 ? to < this._floor : to > this._floor);
        for (const row of this.tiles) for (const t of row) if (t && t._stairs && toward(t._stairs.to)) return { q: t.q, r: t.r };
        return null;
    },

    /**
     * Go to floor k of the building the player is in: up or down the stairs,
     * or straight there from the front door. The player stands by the stairs
     * they came by. → { ok, reason, room }
     */
    goToFloor(k, game) {
        if (!this._insideBuilding) return { ok: false, reason: 'You are not inside a building.' };
        const n = this._floorCount || 1;
        if (k < 0 ? !(k === -1 && this._hasCellar) : k >= n) return { ok: false, reason: k < 0 ? 'There is no cellar here.' : 'There is no such floor.' };
        if (k === this._floor) return { ok: true };
        const from = this._floor || 0;
        const interior = this._floorInterior(k);
        if (!interior) return { ok: false, reason: 'The stairs are blocked.' };
        // Whoever is about this floor stays on it
        for (const npc of this.npcs) { npc._act = null; npc.activity = null; npc.path = null; npc.moveProgress = 0; }
        this.tiles = interior.tiles;
        this.width = interior.width;
        this.height = interior.height;
        this._floor = k;
        const b = this._insideBuilding;
        this.npcs = this._peopleOnFloor(interior, k);
        // (each floor of a home keeps its own layout — world/innerMap/furnishing.js)
        if (this.applyHomeFurnishings && game && game.player) this.applyHomeFurnishings(game.player);
        if (this._householdArrive) this._householdArrive(game);
        // Stand beside the stairs that brought you (up: this floor's stairs down; down: its stairs up)
        const st = interior._stairs || {};
        const by = k > from ? st.down : st.up;
        const spot = by ? this._besideStairs(interior, by) : null;
        if (spot) { this.playerInnerQ = spot.q; this.playerInnerR = spot.r; }
        if (this.cancelPlayerWalk) this.cancelPlayerWalk();
        this._pendingInteraction = null;
        this._pendingAction = null;
        this._activeInteraction = null;
        const room = k !== 0 ? this.floorRoom(b, k) : null;
        return { ok: true, room, from, to: k };
    },

    /** A walkable tile beside the stairs at `at` (not stairs itself). */
    _besideStairs(interior, at) {
        const { tiles } = interior;
        const order = [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]];
        for (const [dq, dr] of order) {
            const t = tiles[at.r + dr] && tiles[at.r + dr][at.q + dq];
            if (t && t.subTerrain.passable && !t._stairs && !t._isDoor) return { q: at.q + dq, r: at.r + dr };
        }
        return { q: at.q, r: at.r };
    },
});
