// ============================================
// InnerMap — lords' seats: manors and the castle
// ============================================
// A seat (data/seats.json → seatTypes) keeps guards at its door day and night
// and a lord of its own (the town's noble, or one raised for it). Whether the
// player may go in is the seat's to say (seatEntry, asked by enterBuilding):
//
//   - whoever holds the seat (theirs, their colony's, their crown's) walks in;
//   - a manor with nobody at home is barred — the lord and household go about
//     the town by day (world/innerMap/townLife.js), and the house stays shut;
//   - while its guards stand, they turn the player away by night or with a
//     warrant out in the realm, and let them in otherwise;
//   - knock the guards down and the door is yours (if anyone's home to open it).
//
// The castle (a capital's seat) has an interior of its own: the gatehouse and
// its guardrooms, the courtyard with the stables and the smithy, and the keep
// — the great hall and the throne, the chapel, the kitchen, and the lord's
// bedchamber and the treasury (zone castle_private: a castle guard warns, then
// attacks; ui/innerMapZones.js). Its garrison and household are put inside on
// each visit, and the lord, when home, stands before the throne.
//
// Data: data/seats.json. Draws only from the rng handed in, or Utils.random.

import { InnerMap } from './_ref.js';
import { Utils, DataLoader } from './_imports.js';

const DEFAULTS = {
    seatTypes: ['manor', 'castle'],
    doorGuards: { manor: 2, castle: 4 },
    titles: { manor: 'Manor Guard', castle: 'Castle Guard' },
    nightFrom: 21,
    nightTo: 6,
    lines: {
        away: ['{lord} is not at home. No one goes in while the house is empty.'],
        barred: ['The doors of {seat} are barred, and no one answers your knock.'],
        night: ['At this hour? {lord} receives no one. Come back in the morning.'],
        warrant: ['There\'s a warrant out on you. Clear off.'],
        admit: ['State your business. ...Very well, go in.'],
        unguarded: ['No one stands at the door. You slip inside.'],
        welcome: ['Welcome home, my lord.'],
    },
    zones: {},
    staff: { Steward: [1, 'noble'], Servant: [3, 'villager'], Cook: [1, 'villager'], Smith: [1, 'blacksmith_npc'], Groom: [1, 'villager'], Chaplain: [1, 'priest'] },
    staffNames: ['Aldric', 'Bertram', 'Edith', 'Godwin', 'Hilda', 'Joan', 'Mabel', 'Osmund'],
};

function _cfg() {
    const d = DataLoader._gamedata && DataLoader._gamedata.seats;
    if (!d || typeof d !== 'object') return DEFAULTS;
    return { ...DEFAULTS, ...d, lines: { ...DEFAULTS.lines, ...(d.lines || {}) } };
}

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _pick(arr, rnd = Utils.random) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(rnd() * arr.length) % arr.length] : '';
}

const _awake = n => n && n.state !== 'unconscious' && n.state !== 'gone' && n.state !== 'dead' && !n.dead && !n._knockedOut;

// ──────────── THE CASTLE'S PLAN ────────────
const CW = 33;
const CH = 27;
const MID = 16;
const KEEP_WALL = 11;      // the keep's front wall (the courtyard below it)
const GATE_WALL = 22;      // the gatehouse's inner wall (the guardrooms below it)

/** Where things stand in the castle (interior tile coordinates). */
const CASTLE_SPOTS = {
    throne: { q: MID, r: 2 },
    lord: { q: MID, r: 3 },
    gateGuards: [{ q: 14, r: 24, face: 2 }, { q: 18, r: 24, face: 2 }],
    hallGuards: [{ q: 14, r: 2, face: 2 }, { q: 18, r: 2, face: 2 }, { q: 10, r: 4, face: 1 }, { q: 22, r: 4, face: 3 }],
    staff: {
        Steward: [{ q: 12, r: 9 }], Servant: [{ q: 15, r: 7 }, { q: 27, r: 9 }, { q: 18, r: 9 }], Cook: [{ q: 28, r: 8 }],
        Smith: [{ q: 28, r: 15 }], Groom: [{ q: 3, r: 16 }], Chaplain: [{ q: 4, r: 9 }],
    },
};

Object.assign(InnerMap, {
    CASTLE_SIZE: { width: CW, height: CH },
    CASTLE_SPOTS,

    seatsConfig() { return _cfg(); },

    /** Is this building a lord's seat (a manor, the castle)? */
    isSeat(building) {
        const t = building && String(building.type || '').replace(/^player_/, '');
        return !!t && (_cfg().seatTypes || []).includes(t);
    },

    /** The seats on this map. */
    seatBuildings() {
        return (this.buildings || []).filter(b => b && !b.isPlayerProperty && this.isSeat(b));
    },

    /** The guards posted at a seat's door. */
    seatGuards(building) {
        if (!building) return [];
        const key = `${building.q},${building.r}`;
        const npcs = (this._outerMapState && this._insideBuilding ? this._outerMapState.npcs : this.npcs) || [];
        return npcs.filter(n => n._seatGuard === key);
    },

    /** Who is inside a seat now (the lord, the household, a caller). */
    whoIsHome(building) {
        if (!building) return [];
        const npcs = (this._outerMapState && this._insideBuilding ? this._outerMapState.npcs : this.npcs) || [];
        return npcs.filter(n => n.state === 'inside_building' && n._insideBuildingQ === building.q && n._insideBuildingR === building.r);
    },

    /** Is it the hour the seat shuts its doors? */
    seatNight(hour = this.timeOfDay) {
        const C = _cfg();
        const h = Number(hour) || 0;
        const from = Number(C.nightFrom), to = Number(C.nightTo);
        return from > to ? (h >= from || h < to) : (h >= from && h < to);
    },

    /** Does the player hold this seat — it is theirs, or their colony, or their crown's town? */
    playerHoldsSeat(building, game) {
        if (!building) return false;
        if (building.isPlayerOwned || building.ownerId === 'player') return true;
        const player = game && game.player;
        if (!player) return false;
        const wt = this._currentWorldTileRef || null;
        const s = wt && wt.settlement;
        if (!s) return false;
        if (s.colony && s.colony.isPlayerColony) return true;
        if ((player.colonies || []).some(c => c.q === wt.q && c.r === wt.r)) return true;
        const ruling = player.throne && player.throne.ruling;
        return !!(ruling && ruling.kingdomId != null && s.kingdom != null && ruling.kingdomId === s.kingdom);
    },

    /**
     * May the player go into this building? Seats only; everything else is open.
     * @returns {{ ok: boolean, why?: string, text?: string, by?: object }}
     */
    seatEntry(building, game) {
        if (!this.isSeat(building)) return { ok: true };
        const C = _cfg();
        const fill = s => String(s || '')
            .replace(/\{lord\}/g, building.ownerName ? `${building.ownerTitle || 'Lord'} ${building.ownerName}` : 'the lord')
            .replace(/\{seat\}/g, building.name || 'the house');
        const guards = this.seatGuards(building).filter(_awake);
        const by = guards.length ? guards.reduce((a, g) => (this._distToPlayer(g) < this._distToPlayer(a) ? g : a)) : null;
        const say = (why, ok) => {
            const text = fill(_pick(C.lines[why]));
            if (by && text) by._bark = { text, until: _now() + 4200, from: _now() };
            return { ok, why, text, by };
        };
        if (this.playerHoldsSeat(building, game)) return by ? say('welcome', true) : { ok: true, why: 'held' };
        const castle = String(building.type).replace(/^player_/, '') === 'castle';
        const home = castle || this.whoIsHome(building).length > 0;
        // A barred door the player has picked (ui/innerMapLocks.js) opens while no guard stands at it
        if (!home && !by && building._lockPicked) return { ok: true, why: 'picked' };
        if (!home) return by ? say('away', false) : say('barred', false);
        if (!by) return say('unguarded', true);
        if (this._playerWanted(game)) return say('warrant', false);
        if (this.seatNight()) return say('night', false);
        return say('admit', true);
    },

    /** A warrant out on the player in this town's realm (player/settlementServices.js hasWarrant). */
    _playerWanted(game) {
        const player = game && game.player;
        const wt = this._currentWorldTileRef || null;
        const k = wt && wt.settlement && wt.settlement.kingdom;
        return !!(player && k != null && player.gossip && player.gossip.warrants && player.gossip.warrants[k]);
    },

    _distToPlayer(npc) {
        return Math.max(Math.abs(npc.q - this.playerInnerQ), Math.abs(npc.r - this.playerInnerR));
    },

    // ──────────── SETTLING THE SEATS (townLife._settleTownLife) ────────────

    /** Each seat its lord: the town's noble if there is one free, else one raised for it. */
    _seatLords(rng) {
        let id = this.npcs.reduce((m, n) => Math.max(m, n.id), -1) + 1;
        for (const b of this.seatBuildings()) {
            if (b.ownerId != null) continue;
            const lord = this._makeNpc && this._makeNpc('noble', id++, rng);
            if (!lord) continue;
            const T = this.NPC_TYPES && this.NPC_TYPES.noble;
            if (T) { lord.icon = T.icon; lord.speed = T.speed; lord.destinations = T.destinations || []; }
            this.npcs.push(lord);
            b.ownerId = lord.id;
            b.ownerName = lord.name;
            b.ownerTitle = 'Lord';
        }
    },

    /** Guards at each seat's door: a pair at a manor, four at the castle gate, on both sides of the step. */
    _postSeatGuards(rng) {
        const C = _cfg();
        let id = this.npcs.reduce((m, n) => Math.max(m, n.id), -1) + 1;
        for (const b of this.seatBuildings()) {
            const type = String(b.type).replace(/^player_/, '');
            const want = Number((C.doorGuards || {})[type]) || 0;
            const spots = this._seatDoorSpots(b, want);
            for (const s of spots) {
                const g = this._makeNpc && this._makeNpc('guard', id++, rng);
                if (!g) break;
                const T = this.NPC_TYPES && this.NPC_TYPES.guard;
                if (T) { g.icon = T.icon; g.speed = T.speed; }
                g.gender = rng() < 0.2 ? 'female' : 'male';
                g.roleTitle = (C.titles || {})[type] || 'Guard';
                g._seatGuard = `${b.q},${b.r}`;
                g._doorPost = { q: s.q, r: s.r, face: 2 };
                g._home = null;
                g._work = b;
                g.destinations = [];
                g.q = g.prevQ = g.targetQ = s.q;
                g.r = g.prevR = g.targetR = s.r;
                g.path = null;
                g.state = 'idle';
                g.facing = 2;
                g.idleTimer = 20 + rng() * 20;
                this.npcs.push(g);
            }
        }
    },

    /** Where a seat's door guards stand: either side of the step out front (never on it). */
    _seatDoorSpots(b, want) {
        if (want <= 0) return [];
        const ok = (q, r) => {
            const t = this.tiles[r] && this.tiles[r][q];
            return !!(t && t.subTerrain && t.subTerrain.passable && !t._doorMarker && !t.customBuilding && !t.customBuildingPart
                && !this.getBuildingAt(q, r));
        };
        const front = this._findPassableAdjacentTile(b.q, b.r);
        const out = [];
        const taken = new Set([`${front.q},${front.r}`]);
        const offsets = [1, -1, 2, -2, 3, -3];
        for (const dr of [0, 1]) {
            for (const dq of offsets) {
                if (out.length >= want) return out;
                const q = front.q + dq, r = front.r + dr;
                const k = `${q},${r}`;
                if (taken.has(k) || !ok(q, r)) continue;
                taken.add(k);
                out.push({ q, r });
            }
        }
        return out;
    },

    // ──────────── THE CASTLE INSIDE ────────────

    /** The castle's tiles: gatehouse, courtyard, keep. The same plan for every castle. */
    _generateCastleInterior(building) {
        const tiles = [];
        const FL = this.INTERIOR_FLOORS;
        const floorAt = (q, r) => {
            if (r > GATE_WALL) return (q > 13 && q < 19) ? 'stone_floor' : 'wood_floor';
            if (r > KEEP_WALL) return 'dirt_floor';
            if (q < 9) return r < 6 ? 'herringbone_floor' : 'stone_floor';
            if (q > 23) return r < 6 ? 'stone_floor' : 'tile_floor';
            return 'marble_floor';
        };
        for (let r = 0; r < CH; r++) {
            tiles[r] = [];
            for (let q = 0; q < CW; q++) {
                const id = floorAt(q, r);
                const def = FL[id] || FL.stone_floor;
                tiles[r][q] = {
                    q, r, baseTerrain: id,
                    subTerrain: { id, name: def.name, icon: '·', color: (q + r) % 2 ? def.color : def.altColor, passable: true },
                    explored: true, visible: true, parentTerrain: 'interior', encounter: null, building: null,
                    _isInterior: true, _interiorBuildingType: 'castle', _wallMaterial: 'stone', _furniture: null,
                    effectiveTemp: r > KEEP_WALL && r < GATE_WALL ? 12 : 17, moisture: 0.4, weatherType: 'clear',
                };
            }
        }
        const T = (q, r) => tiles[r] && tiles[r][q];
        const wall = (q, r) => {
            const t = T(q, r);
            if (!t) return;
            t.baseTerrain = 'wall';
            t.subTerrain = { id: 'wall', name: 'Castle Wall', icon: '🧱', color: '#5a5a60', passable: false };
            t._furniture = null;
        };
        const hline = (r, q0, q1, gaps = []) => { for (let q = q0; q <= q1; q++) if (!gaps.includes(q)) wall(q, r); };
        const vline = (q, r0, r1, gaps = []) => { for (let r = r0; r <= r1; r++) if (!gaps.includes(r)) wall(q, r); };
        const put = (q, r, type, name, passable = false) => {
            const t = T(q, r);
            if (!t || t.baseTerrain === 'wall') return;
            t._furniture = { type, icon: '', name, passable };
            if (!passable) t.subTerrain = { id: `furniture_${type}`, name, icon: '', color: this.FURNITURE_COLORS[type] || '#6a5a4a', passable: false };
        };
        const room = (q0, r0, q1, r1, name, zone = null) => {
            for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
                const t = T(q, r);
                if (!t || t.baseTerrain === 'wall') continue;
                t._room = name;
                if (zone) t._zone = zone;
            }
        };

        // ── The curtain wall ──
        hline(0, 0, CW - 1); hline(CH - 1, 0, CW - 1); vline(0, 0, CH - 1); vline(CW - 1, 0, CH - 1);

        // ── The gatehouse: the passage under the arch, a guardroom either side ──
        hline(GATE_WALL, 1, CW - 2, [MID - 1, MID, MID + 1]);
        vline(13, GATE_WALL + 1, CH - 2, [24]);
        vline(19, GATE_WALL + 1, CH - 2, [24]);
        room(1, GATE_WALL + 1, 12, CH - 2, 'Guardroom');
        room(14, GATE_WALL + 1, 18, CH - 2, 'Gate Passage');
        room(20, GATE_WALL + 1, 31, CH - 2, 'Barracks');
        put(1, 23, 'rack', 'Weapon Rack'); put(2, 23, 'rack', 'Shield Rack');
        put(6, 24, 'table', 'Guards\' Table'); put(7, 24, 'table', 'Guards\' Table');
        put(11, 23, 'barrel', 'Ale Barrel'); put(1, 25, 'chest', 'Arms Chest'); put(9, 25, 'candle', 'Brazier', true);
        for (const q of [21, 23, 25, 27, 29]) put(q, 23, 'bed', 'Bunk');
        put(31, 23, 'rack', 'Spear Rack'); put(31, 25, 'chest', 'Kit Chest'); put(25, 25, 'table', 'Dice Table');
        put(15, 23, 'banner', 'Portcullis Chains', true); put(17, 23, 'banner', 'Portcullis Chains', true);

        // ── The courtyard: stables on the west wall, the smithy on the east, a well, the practice yard ──
        room(1, KEEP_WALL + 1, 31, GATE_WALL - 1, 'Courtyard');
        for (const r of [13, 15, 17, 19]) put(1, r, 'stall', 'Horse Stall');
        put(2, 13, 'barrel', 'Water Trough'); put(2, 20, 'crate', 'Hay Bale'); put(3, 20, 'crate', 'Hay Bale'); put(1, 21, 'sack', 'Oat Sacks');
        put(10, 16, 'well', 'Castle Well'); put(11, 17, 'bucket', 'Bucket', true);
        put(7, 20, 'crate', 'Supply Cart'); put(8, 20, 'sack', 'Grain Sacks');
        put(31, 13, 'forge', 'Forge'); put(30, 13, 'forge', 'Forge'); put(29, 15, 'anvil', 'Anvil');
        put(31, 15, 'rack', 'Finished Blades'); put(31, 17, 'barrel', 'Quench Tub'); put(30, 17, 'crate', 'Iron Stock');
        for (const q of [21, 23, 25]) put(q, 19, 'statue', 'Practice Dummy');
        put(27, 20, 'rack', 'Practice Weapons');
        put(MID - 2, KEEP_WALL + 1, 'banner', 'Standard', true); put(MID + 2, KEEP_WALL + 1, 'banner', 'Standard', true);

        // ── The keep ──
        hline(KEEP_WALL, 1, CW - 2, [MID - 1, MID, MID + 1]);
        vline(9, 1, KEEP_WALL - 1, [3, 8]);
        vline(23, 1, KEEP_WALL - 1, [3, 8]);
        hline(6, 1, 8);
        hline(6, 24, 31);
        // The great hall: the throne on its dais, the high table, the long tables, the hearths
        room(10, 1, 22, KEEP_WALL - 1, 'Great Hall');
        put(MID, 2, 'throne', 'Throne');
        put(MID - 2, 1, 'banner', 'House Banner', true); put(MID + 2, 1, 'banner', 'House Banner', true);
        put(MID - 4, 2, 'candle', 'Candelabrum', true); put(MID + 4, 2, 'candle', 'Candelabrum', true);
        for (let r = 5; r <= 8; r++) { put(13, r, 'table', 'Long Table'); put(19, r, 'table', 'Long Table'); }
        put(10, 6, 'fireplace', 'Great Hearth'); put(22, 6, 'fireplace', 'Great Hearth');
        for (let r = 3; r <= KEEP_WALL - 1; r++) put(MID, r, 'rug', 'Red Carpet', true);
        put(11, 10, 'desk', 'Council Map Table'); put(21, 10, 'bookshelf', 'Rolls of the Realm');
        // The lord's bedchamber (private) and the chapel beneath it
        room(1, 1, 8, 5, 'Lord\'s Bedchamber', 'castle_private');
        put(2, 1, 'bed', 'Great Bed'); put(4, 1, 'fireplace', 'Hearth'); put(7, 1, 'chest', 'Lord\'s Chest');
        put(1, 4, 'desk', 'Writing Desk'); put(2, 5, 'bookshelf', 'Books'); put(5, 3, 'rug', 'Fur Rug', true); put(7, 5, 'tub', 'Bath');
        room(1, 7, 8, KEEP_WALL - 1, 'Chapel');
        put(4, 7, 'altar', 'Altar'); put(3, 7, 'candle', 'Candles', true); put(5, 7, 'candle', 'Candles', true);
        put(3, 9, 'pew', 'Pew'); put(5, 9, 'pew', 'Pew'); put(7, 7, 'statue', 'Saint\'s Statue');
        // The treasury (private) and the kitchen beneath it
        room(24, 1, 31, 5, 'Treasury', 'castle_private');
        for (const q of [25, 27, 29, 31]) put(q, 1, 'chest', 'Treasure Chest');
        put(28, 3, 'scales', 'Counting Scales'); put(31, 4, 'chest', 'Strongbox'); put(25, 5, 'desk', 'Treasurer\'s Ledger');
        room(24, 7, 31, KEEP_WALL - 1, 'Kitchen');
        put(31, 7, 'oven', 'Bread Oven'); put(29, 7, 'cauldron', 'Stew Pot'); put(27, 7, 'fireplace', 'Kitchen Fire');
        put(27, 9, 'table', 'Kitchen Table'); put(28, 9, 'table', 'Kitchen Table');
        put(31, 10, 'barrel', 'Wine Cask'); put(30, 10, 'barrel', 'Ale Cask'); put(24, 10, 'sack', 'Flour Sacks'); put(25, 10, 'shelf', 'Larder');

        // ── The gate out ──
        const gate = T(MID, CH - 1);
        gate.baseTerrain = 'stone_floor';
        gate.subTerrain = { id: 'door', name: 'Castle Gate', icon: '🚪', color: '#6a4a2a', passable: true };
        gate._isDoor = true;
        return { tiles, width: CW, height: CH };
    },

    /** Into the castle: its garrison and household at their places, the lord before the throne. */
    _populateCastle(building) {
        const C = _cfg();
        const rnd = Utils.random;
        let id = 90000;
        const make = (type, at, extra) => {
            const t = this.getTile(at.q, at.r);
            if (!t || !t.subTerrain.passable) return null;
            const npc = this._makeNpc ? this._makeNpc(type, id++, rnd) : null;
            if (!npc) return null;
            const T = this.NPC_TYPES && this.NPC_TYPES[type];
            if (T) { npc.icon = T.icon; npc.speed = T.speed; }
            Object.assign(npc, { q: at.q, r: at.r, prevQ: at.q, prevR: at.r, targetQ: at.q, targetR: at.r, path: null, destinations: [], _castleFolk: true }, extra);
            this.npcs.push(npc);
            return npc;
        };
        const guard = (at) => make('guard', at, {
            state: 'idle', idleTimer: 1e9, facing: at.face != null ? at.face : 2, roleTitle: (C.titles || {}).castle || 'Castle Guard', _castleGuard: true, gender: rnd() < 0.2 ? 'female' : 'male',
        });
        for (const at of CASTLE_SPOTS.gateGuards) guard(at);
        for (const at of CASTLE_SPOTS.hallGuards) guard(at);
        // The household go about their work (furniture use; they never leave)
        for (const [role, spec] of Object.entries(C.staff || {})) {
            const [count, type] = Array.isArray(spec) ? spec : [1, 'villager'];
            const spots = CASTLE_SPOTS.staff[role] || [];
            for (let i = 0; i < (Number(count) || 0); i++) {
                const at = spots[i % Math.max(1, spots.length)] || { q: MID, r: 8 };
                const name = _pick(C.staffNames, rnd) || role;
                make(type, at, { name, fullName: name, roleTitle: role, state: 'inside_building', idleTimer: 1e9, _castleStaff: role });
            }
        }
        // The lord, if home, holds court before the throne
        const lord = (this.npcs || []).find(n => building.ownerId != null && n.id === building.ownerId && !n._castleFolk);
        if (lord) {
            const at = CASTLE_SPOTS.lord;
            Object.assign(lord, { q: at.q, r: at.r, prevQ: at.q, prevR: at.r, path: null, moveProgress: 0, facing: 2 });
            lord.idleTimer = Math.max(lord.idleTimer || 0, 60);
            lord._act = { phase: 'rest', timer: 30 + rnd() * 30, spot: null };
        }
    },

    // ──────────── THE CASTLE'S ZONES (world/innerMap/jail.js zoneRule/zoneAllows/zoneWarden) ────────────

    seatZoneRule(zone) {
        const Z = (_cfg().zones || {})[zone];
        return Z && typeof Z === 'object' ? Z : null;
    },

    /** The lord's rooms are the holder's: everyone else is warned off. */
    seatZoneAllows(zone) {
        if (zone !== 'castle_private') return true;
        return !!(this._seatVisit && this._seatVisit.held);
    },

    /** The castle guard nearest the player keeps the lord's rooms. */
    seatZoneWarden(zone) {
        if (zone !== 'castle_private') return null;
        const gs = (this.npcs || []).filter(n => n._castleGuard && _awake(n));
        if (!gs.length) return null;
        return gs.reduce((a, g) => (this._distToPlayer(g) < this._distToPlayer(a) ? g : a));
    },
});
