// ============================================
// InnerMap — the jail: a walkable prison interior
// ============================================
// A row of barred cells along the back wall, a corridor before them, and the
// gaoler's room by the way out. The player is locked in their own cell with
// their cellmates (player/prison.js names them); other prisoners sit in the
// cells beside, and the gaoler walks the corridor. Each thing in the cell is
// one of the prison's doings (ui/innerMapJail.js): the straw pallet (serve the
// day), the loose flagstone (the tunnel), the cell door (call the guard,
// labour in the yard, the break-out, bail).
//
// The jail is entered like any building (enterBuilding) on a stand-in
// building in the town (the barracks, guard tower or town hall), and can't be
// left while locked: exitBuilding refuses until unlockJail().
//
// Data: data/jail.json (prisoner names and lines). Draws only from the rng
// handed in (seeded by the sentence).

import { InnerMap } from './_ref.js';
import { Utils, DataLoader } from './_imports.js';

const W = 17;
const H = 13;
const CELL_W = 3;          // inner width of a cell
const CELLS = 4;           // cells along the back wall
const BARS_R = 4;          // the row of bars
const PLAYER_CELL = 1;     // which cell is the player's

const DEFAULTS = {
    prisonerNames: ['Wat', 'Hob', 'Ned', 'Gib', 'Tam', 'Dun', 'Col', 'Ivo', 'Rafe', 'Lew'],
    gaolerNames: ['Grimbald', 'Osric', 'Hamon', 'Brice'],
    prisonerLines: ['Got a crust, friend?', 'They\'ll hang me come spring.', 'Shut it, I\'m sleeping.', 'I didn\'t do it. None of us did.', '*coughs*'],
    gaolerLines: ['Quiet in there.', 'Back from the bars.', 'Bread at dusk. If you\'re lucky.'],
};

function _cfg() {
    const d = DataLoader._gamedata && DataLoader._gamedata.jail;
    return d && typeof d === 'object' ? { ...DEFAULTS, ...d } : DEFAULTS;
}

/** Inner columns of cell i. */
function _cellCols(i) {
    const q0 = 1 + i * (CELL_W + 1);
    return [q0, q0 + 1, q0 + 2];
}

Object.assign(InnerMap, {
    JAIL_SIZE: { width: W, height: H },

    jailConfig() { return _cfg(); },

    /** Is the player locked in the jail map? */
    jailLocked() { return !!(this._jail && this._jail.locked && this.inJail()); },

    /** In the gaol at all (a prisoner, let out, or walking in free)? */
    inJail() {
        const b = this._insideBuilding;
        return !!(this._jail && b && (b._jail || b.type === 'jail'));
    },

    /** The town's own gaol, if it keeps one (towns, cities, capitals). */
    jailBuilding() {
        return (this.buildings || []).find(b => b && b.type === 'jail' && !b.isPlayerProperty) || null;
    },

    /** The building in town the jail stands in for (barracks, tower, hall — or the first there is). */
    _jailHost() {
        const order = ['barracks', 'guard_tower', 'town_hall', 'manor', 'church'];
        for (const t of order) {
            const b = (this.buildings || []).find(x => x.type === t && !x.isPlayerProperty);
            if (b) return b;
        }
        return (this.buildings || []).find(x => !x.isPlayerProperty) || null;
    },

    /**
     * Enter the jail map: into the building as a prisoner, locked in a cell.
     * @param {object} game
     * @param {object} info { town, cellmates: [{ id, name, archetype, label }], rng }
     * @returns {boolean}
     */
    enterJail(game, info = {}) {
        if (!this.active || this._insideBuilding) return false;
        // The town's own gaol — the same building each time — or, where a town has none drawn, its watch-house
        const real = this.jailBuilding();
        const host = real || this._jailHost();
        if (!host) return false;
        const building = {
            ...host, type: 'jail', _jail: true,
            name: real ? real.name : `The Jail of ${info.town || 'the town'}`, icon: '🔒', actions: [],
        };
        if (!this.enterBuilding(building, game)) return false;
        const rnd = info.rng || Utils.random;
        this._jail = { locked: true, town: info.town || null, cell: PLAYER_CELL };
        // The player starts on their straw, in their own cell
        const cols = _cellCols(PLAYER_CELL);
        this.playerInnerQ = cols[1];
        this.playerInnerR = 2;
        this._spawnJailFolk(info, rnd);
        return true;
    },

    /** Unlock the cell door (sentence served, bail, papers lost): the way out is open. */
    unlockJail() {
        if (!this._jail) return;
        this._jail.locked = false;
        const door = this._jailDoor(PLAYER_CELL);
        // The other prisoners stay put: the door is opened for the player, not for them
        const cols = _cellCols(PLAYER_CELL);
        for (const npc of this.npcs || []) {
            if (!npc._jailed) continue;
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc.idleTimer = 1e9;
            if (npc.r >= BARS_R) { npc.q = npc.prevQ = cols[2]; npc.r = npc.prevR = 3; }
        }
        const t = door && this.tiles[door.r] && this.tiles[door.r][door.q];
        if (t) {
            t._furniture = null;
            t._jailKind = 'open_door';
            t.subTerrain = { id: 'stone_floor', name: 'Open Cell Door', icon: '🚪', color: '#7a7a7a', passable: true };
        }
    },

    /** Leave the jail behind (the building exit clears it). */
    clearJail() { this._jail = null; },

    // ──────────── ZONES ────────────
    // A tile may lie in a zone (tile._zone) with a rule: who may be there, and
    // who keeps it (ui/innerMapZones.js warns the trespasser, then sets the
    // warden on them). Rules: data/jail.json → zones.

    /** The rule for a zone, or null. */
    zoneRule(zone) {
        const Z = (_cfg().zones || {})[zone];
        if (Z && typeof Z === 'object') return Z;
        return this.seatZoneRule ? this.seatZoneRule(zone) : null;
    },

    /** May the player be in this zone now? (The gaol's cells: its prisoners, not its visitors.) */
    zoneAllows(zone) {
        if (zone === 'jail_cells') return !(this._jail && this._jail.visitor);
        return this.seatZoneAllows ? this.seatZoneAllows(zone) : true;
    },

    /** Who keeps a zone (the gaoler for the cells), or null. */
    zoneWarden(zone) {
        const rule = this.zoneRule(zone);
        const key = (rule && rule.warden) || (zone === 'jail_cells' ? 'gaoler' : null);
        if (key === 'gaoler') return (this.npcs || []).find(n => n._gaoler && n.state !== 'unconscious' && n.state !== 'gone') || null;
        return this.seatZoneWarden ? this.seatZoneWarden(zone) : null;
    },

    /** Walking into the gaol free: every cell holds its prisoners, the gaoler walks the corridor. */
    _visitJail() {
        this._jail = { locked: false, visitor: true, town: null, cell: PLAYER_CELL };
        this._spawnJailFolk({ cellmates: [], visitor: true }, Utils.random);
    },

    /** Where cell i's door is. */
    _jailDoor(i) {
        const cols = _cellCols(i);
        return { q: cols[1], r: BARS_R };
    },

    /** The jail's tiles: cells, bars, corridor, the gaoler's room, the locked door out. */
    _generateJailInterior() {
        const tiles = [];
        const floor = (q, r, id, name) => ({
            q, r, baseTerrain: id,
            subTerrain: { id, name, icon: '·', color: '#7a7a7a', passable: true },
            explored: true, visible: true, parentTerrain: 'interior', encounter: null, building: null,
            _isInterior: true, _interiorBuildingType: 'jail', _wallMaterial: 'dark_stone', _furniture: null,
            effectiveTemp: 14, moisture: 0.5, weatherType: 'clear',
        });
        const wall = (t) => {
            t.baseTerrain = 'wall';
            t.subTerrain = { id: 'wall', name: 'Wall', icon: '🧱', color: '#3a3438', passable: false };
        };
        const put = (t, type, name, kind, passable = false, art = null) => {
            t._furniture = { type, icon: '', name, passable };
            if (art) t._furniture.art = art;
            t._jailKind = kind;
            if (!passable) t.subTerrain = { id: `furniture_${type}`, name, icon: '', color: this.FURNITURE_COLORS[type] || '#4a4a52', passable: false };
        };
        for (let r = 0; r < H; r++) {
            tiles[r] = [];
            for (let q = 0; q < W; q++) {
                const inCells = r >= 1 && r < BARS_R;
                const inGuardRoom = r >= 8;
                tiles[r][q] = floor(q, r, inCells ? 'dirt_floor' : inGuardRoom ? 'wood_floor' : 'stone_floor', inCells ? 'Dirt Floor' : inGuardRoom ? 'Wooden Floor' : 'Stone Floor');
                const t = tiles[r][q];
                // Outer walls
                if (r === 0 || q === 0 || q === W - 1 || r === H - 1) wall(t);
                // Walls between the cells
                if (inCells && (q % (CELL_W + 1)) === 0) wall(t);
                // The bars before the cells (walls where the cell walls meet them)
                if (r === BARS_R) {
                    if (q % (CELL_W + 1) === 0) wall(t);
                    else if (q > 0 && q < W - 1) put(t, 'cell', 'Iron Bars', 'bars');
                }
                // The wall between the corridor and the gaoler's room, with a doorway
                if (r === 7 && q > 0 && q < W - 1 && q !== 8) wall(t);
                // The cells and the corridor before them: no place for visitors (the front room is open)
                if (r >= 1 && r <= 6) t._zone = 'jail_cells';
            }
        }
        // Cell doors, and what each cell holds
        for (let i = 0; i < CELLS; i++) {
            const cols = _cellCols(i);
            const door = this._jailDoor(i);
            put(tiles[door.r][door.q], 'cell', i === PLAYER_CELL ? 'Your Cell Door' : 'Cell Door', i === PLAYER_CELL ? 'door' : 'other_door');
            put(tiles[1][cols[0]], 'bed', i === PLAYER_CELL ? 'Your Straw Pallet' : 'Straw Pallet', i === PLAYER_CELL ? 'bed' : 'other_bed', false, 'straw');
            put(tiles[1][cols[2]], 'bucket', 'Slop Bucket', 'bucket');
        }
        // The loose flagstone in the player's cell (the tunnel): a slab of the floor, straw kicked about it
        const pc = _cellCols(PLAYER_CELL);
        put(tiles[3][pc[0]], 'flagstone', 'Loose Flagstone', 'stone');
        // The gaoler's room
        put(tiles[9][3], 'desk', 'Gaoler\'s Desk', 'desk');
        put(tiles[9][13], 'chest', 'Confiscated Belongings', 'chest');
        put(tiles[8][1], 'rack', 'Weapon Rack', 'rack');
        put(tiles[8][15], 'barrel', 'Water Barrel', 'barrel');
        put(tiles[10][8], 'candle', 'Lantern', 'lamp', true);
        put(tiles[5][8], 'candle', 'Torch', 'lamp', true);
        // The way out (locked while the player is a prisoner)
        const exit = tiles[H - 1][8];
        exit.baseTerrain = 'stone_floor';
        exit.subTerrain = { id: 'door', name: 'Jail Door', icon: '🚪', color: '#6a4a2a', passable: true };
        exit._isDoor = true;
        exit._jailKind = 'exit';
        return { tiles, width: W, height: H };
    },

    /** Cellmates in the player's cell, prisoners in the others, the gaoler in the corridor. */
    _spawnJailFolk(info, rnd) {
        const C = _cfg();
        const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
        const make = (type, id, q, r, extra) => {
            const npc = this._makeNpc ? this._makeNpc(type, id, rnd) : null;
            if (!npc) return null;
            Object.assign(npc, { q, r, prevQ: q, prevR: r, targetQ: q, targetR: r, path: null, state: 'idle', idleTimer: 3 + rnd() * 10, gender: 'male', destinations: [] }, extra);
            this.npcs.push(npc);
            return npc;
        };
        let id = 70000;
        const pc = _cellCols(PLAYER_CELL);
        const spots = [{ q: pc[2], r: 2 }, { q: pc[1], r: 3 }, { q: pc[2], r: 3 }];
        (info.cellmates || []).slice(0, spots.length).forEach((m, i) => {
            make('villager', id++, spots[i].q, spots[i].r, { name: m.name, fullName: m.name, roleTitle: m.label || 'Prisoner', _cellmateId: m.id, _jailed: true });
        });
        for (let i = 0; i < CELLS; i++) {
            if (i === PLAYER_CELL && !info.visitor) continue;
            const cols = _cellCols(i);
            const n = 1 + Math.floor(rnd() * 2);
            for (let k = 0; k < n; k++) {
                make(rnd() < 0.5 ? 'beggar' : 'villager', id++, cols[1 + (k % 2)], 2 + k, { name: pick(C.prisonerNames), roleTitle: 'Prisoner', _prisoner: true, _jailed: true });
            }
        }
        // The gaoler: walking the corridor over his prisoners, or at his desk in the front room when a visitor comes in
        make('guard', id++, info.visitor ? 5 : 8, info.visitor ? 10 : 6, { name: pick(C.gaolerNames), roleTitle: 'Gaoler', _gaoler: true, gender: 'male', ...(info.visitor ? { idleTimer: 1e9, facing: 2 } : {}) });
    },
});
