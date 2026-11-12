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
// floor above has the same footprint, its walls copied from the one below,
// and rooms by the building's type (bedchambers over a house, guest rooms
// over an inn, a loft over a barn). Stairs up stand on each floor but the top;
// they come out on the stairs down of the floor above. Walk onto the stairs
// (or right-click them) to climb or go down; at the front door, go straight
// up to a floor. Anyone inside keeps to their own floor.

import { InnerMap } from './_ref.js';
import { DataLoader, Utils } from './_imports.js';

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
        if (building._jail || type === 'jail' || type === 'castle') return 1;
        const C = _cfg();
        const most = Number(C.maxFloors[type] != null ? C.maxFloors[type] : C.maxFloors._default) || 1;
        const cap = Math.max(1, Math.min(most, this.buildersCraft(building, game)));
        if (cap <= 1) return 1;
        if (_ownBuilding(building)) return cap;
        const lo = Math.min(cap, Math.max(1, Number(C.minFloors[type]) || 1));
        const wt = this.currentWorldTile || {};
        return lo + (_hash(`${wt.q},${wt.r}|${building.q},${building.r}|${type}`) % (cap - lo + 1));
    },

    /** "the ground floor", "the 2nd floor"… */
    floorLabel(k) {
        return k <= 0 ? 'the ground floor' : `the ${_ord(k + 1)} floor`;
    },

    /** The kind of room on floor k (≥1) of a building. */
    floorRoom(building, k) {
        const C = _cfg();
        const type = _type(building);
        const list = C.upperRooms[type] || C.upperRooms._default || ['quarters'];
        const kind = list[Math.min(list.length, Math.max(1, k)) - 1];
        return { kind, ...(C.rooms[kind] || { name: 'Upper Floor', furniture: [] }) };
    },

    /**
     * On entering: how many floors the building has, the ground floor's stairs
     * up (made functional where the layout drew some, put in where it didn't,
     * taken out when there's no floor above), and the player on the ground floor.
     */
    _prepareFloors(interior, building, interiorKey, game) {
        const n = this.floorsOf(building, game);
        this._floor = 0;
        this._floorCount = n;
        this._floorKey = interiorKey;
        this._floorInteriors = { 0: interior };
        const C = _cfg();
        const { tiles, width: w, height: h } = interior;
        let stairs = null;
        for (let r = 0; r < h && !stairs; r++) {
            for (let q = 0; q < w; q++) {
                const t = tiles[r][q];
                if (t && t._furniture && (t._furniture.type === 'stairs' || t._stairs)) { stairs = { q, r }; break; }
            }
        }
        if (n <= 1) {
            if (stairs) { tiles[stairs.r][stairs.q]._furniture = null; tiles[stairs.r][stairs.q]._stairs = null; }
            interior._stairs = {};
            return n;
        }
        if (!stairs) stairs = this._stairsSpot(interior, [], `${interiorKey}|up0`);
        if (stairs) {
            const t = tiles[stairs.r][stairs.q];
            const keep = t._furniture && t._furniture.type === 'stairs' ? t._furniture.name : null;
            t._furniture = { ...C.stairs.up, name: keep || C.stairs.up.name, passable: true, _stairs: true };
            t._stairs = { to: 1 };
            t.subTerrain = { ...t.subTerrain, passable: true };
        }
        interior._stairs = { up: stairs };
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

    /** Floor k's interior (k ≥ 1), built from the floor below the first time. */
    _floorInterior(k) {
        if (k <= 0) return this._floorInteriors && this._floorInteriors[0];
        if (this._floorInteriors && this._floorInteriors[k]) return this._floorInteriors[k];
        const key = `${this._floorKey}_f${k}`;
        let interior = this._interiorCache[key];
        if (!interior) {
            const below = this._floorInterior(k - 1);
            if (!below || !below._stairs || !below._stairs.up) return null;
            interior = this._buildUpperFloor(below, this._insideBuilding, k, k < this._floorCount - 1, key);
            this._interiorCache[key] = interior;
        }
        this._floorInteriors[k] = interior;
        return interior;
    },

    /**
     * An upper floor over `below`: the same footprint and walls (no door: its
     * doorway is floor), the room's floor and furniture laid along
     * the walls, the stairs down where the stairs below come up, and stairs up
     * when a floor stands above.
     */
    _buildUpperFloor(below, building, k, hasAbove, seed) {
        const C = _cfg();
        const { width: w, height: h } = below;
        const room = this.floorRoom(building, k);
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
            return t;
        };
        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles[r] = [];
            for (let q = 0; q < w; q++) {
                const g = below.tiles[r][q];
                // (the doorway below is floor up here, like the rest of its row)
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
        const interior = { tiles, width: w, height: h, _floor: k, _room: room.kind };
        // The stairs down, where the stairs below come up
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
        const n = this._floorCount || 1;
        const b = this._insideBuilding;
        if (n <= 1 || !npc || !b) return 0;
        const h = _hash(String(npc.id != null ? npc.id : npc.name || ''));
        if (this._townAbed && this._townAbed(npc)) {
            const beds = this.bedFloors(b);
            return beds.length ? beds[h % beds.length] : 0;
        }
        const home = npc._home;
        // (home for a meal: down at the family table — world/innerMap/townWork.js _homeMealSeat)
        if (home && home.q === b.q && home.r === b.r && (npc._meal === 'supper' || npc._meal === 'breakfast')) return 0;
        if (home && home.q === b.q && home.r === b.r) return h % n;
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
        if (this._townAbed && this._townAbed(npc)) {
            const taken = new Set((this._sleepersPlaced || []).map(s => `${s.q},${s.r}`));
            const beds = [];
            for (const row of interior.tiles) for (const t of row) {
                // (a bed of two tiles is lain in from its head)
                if (t && t._furniture && t._furniture.type === 'bed' && !(t._furniture.piece && t._furniture.piece.j) && !taken.has(`${t.q},${t.r}`)) beds.push(t);
            }
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
        if (!(this._floor > 0) || !this.tiles) return null;
        for (const row of this.tiles) for (const t of row) if (t && t._stairs && t._stairs.to < this._floor) return { q: t.q, r: t.r };
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
        if (k < 0 || k >= n) return { ok: false, reason: 'There is no such floor.' };
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
        if (k === 0 && this.applyHomeFurnishings && game && game.player) this.applyHomeFurnishings(game.player);
        // Stand beside the stairs that brought you (up: this floor's stairs down; down: its stairs up)
        const st = interior._stairs || {};
        const by = k > from ? st.down : st.up;
        const spot = by ? this._besideStairs(interior, by) : null;
        if (spot) { this.playerInnerQ = spot.q; this.playerInnerR = spot.r; }
        if (this.cancelPlayerWalk) this.cancelPlayerWalk();
        this._pendingInteraction = null;
        this._pendingAction = null;
        this._activeInteraction = null;
        const room = k > 0 ? this.floorRoom(b, k) : null;
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
