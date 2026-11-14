// InnerMap — the player's household at home: the rooms they marked, the
// servants who work the house and the guests who sit in the hall.
//
// The household's state is the player's (player.household.homes[homeKey],
// kept by player/household.js; the key is furnishHomeKey of
// world/innerMap/furnishing.js). This file is the map's side of it:
//
//   surveyHomeRooms(rooms)  the furniture in each marked room on this floor:
//                           every floor tile within roomRadius of a mark,
//                           reached without crossing a wall, belongs to its
//                           nearest mark; { types, value, displaySlots,
//                           displayTiles } per room (pieces' worth from
//                           data/furniture.json prices)
//   _householdArrive(game)  entering the home (interiors.enterBuilding) or
//                           taking the stairs (floors.goToFloor): resurvey
//                           this floor's rooms through the hook the UI layer
//                           sets (InnerMap._householdHook, ui/actionMenu/
//                           household.js: the quality math is player/
//                           household.js, which the world layer can't
//                           import), label the hall's display pieces with
//                           what stands on them, and put the servants and
//                           guests of this floor in the house
//   _homeFurnitureFor(npc)  what furniture a servant or guest goes to (read
//                           by townWork._jobFurniture), and npc._homeActs
//                           what they are seen doing there (furnitureUse)
//
// Servants and guests are made fresh each time a floor is shown and leave
// with it (they are never in the street's npc list). No per-frame work here.

import { InnerMap } from './_ref.js';
import { DataLoader, Utils } from './_imports.js';
import { FurnitureCatalogue } from '../furnitureCatalogue.js';

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const GUEST_LIKES = ['table', 'pew', 'throne', 'fireplace', 'rug', 'statue', 'banner', 'rack', 'bookshelf'];
const ROLE_TYPE = { cook: 'villager', maid: 'villager', steward: 'merchant', nurse: 'villager' };

const _cfg = () => {
    const d = (DataLoader._gamedata && DataLoader._gamedata.household) || {};
    return { roomRadius: 3, servants: {}, displayTypes: ['rack', 'statue', 'banner'], ...d };
};
const _now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
const _cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

Object.assign(InnerMap, {
    /** The player's household record for the home they are standing in, or null. */
    householdHere(player) {
        const key = this.furnishHomeKey ? this.furnishHomeKey() : null;
        const homes = player && player.household && player.household.homes;
        return key && homes ? homes[key] || null : null;
    },

    /** Gold worth of a piece of furniture on a tile, for a room's survey. */
    _surveyWorth(f, player) {
        let item = null;
        if (f._piece && player && this.homeLayout) {
            const rec = this.homeLayout(player, false);
            const p = rec && rec.pieces && rec.pieces.find(x => x.uid === f._piece);
            item = p && p.id ? FurnitureCatalogue.item(p.id) : null;
        }
        if (item) return Number(item.price) || 0;
        const same = FurnitureCatalogue.items().filter(i => i.type === f.type).map(i => Number(i.price) || 0);
        return same.length ? Math.min(...same) : 8;
    },

    /**
     * Survey the marked rooms of the current floor. rooms: [{ id, kind, q, r, floor }]
     * (those of other floors are ignored). → { [id]: { types, value, displaySlots, displayTiles } }
     */
    surveyHomeRooms(rooms, player = null) {
        const out = {};
        if (!this.tiles || !Array.isArray(rooms)) return out;
        const floor = this._floor || 0;
        const here = rooms.filter(r => r && (Number(r.floor) || 0) === floor && Number.isFinite(r.q) && Number.isFinite(r.r));
        const R = Number(_cfg().roomRadius) || 3;
        const display = new Set(_cfg().displayTypes || []);
        // Each anchor floods its reach (no walls crossed); a tile goes to its nearest anchor
        const owner = new Map();
        for (const room of here) {
            out[room.id] = { types: {}, value: 0, displaySlots: 0, displayTiles: [] };
            const seen = new Map([[`${room.q},${room.r}`, 0]]);
            const queue = [[room.q, room.r, 0]];
            while (queue.length) {
                const [q, r, d] = queue.shift();
                const k = `${q},${r}`;
                const prev = owner.get(k);
                if (!prev || prev.d > d) owner.set(k, { id: room.id, d });
                if (d >= R) continue;
                for (const [dq, dr] of DIRS4) {
                    const nq = q + dq, nr = r + dr, nk = `${nq},${nr}`;
                    if (seen.has(nk)) continue;
                    const t = this.tiles[nr] && this.tiles[nr][nq];
                    if (!t || !t._isInterior || t.baseTerrain === 'wall' || t._isDoor || (t.subTerrain && t.subTerrain.id === 'wall')) continue;
                    seen.set(nk, d + 1);
                    // (furniture is counted but not walked through: a wardrobe screens the room behind it)
                    if (t._furniture && !t._furniture.passable) { const p2 = owner.get(nk); if (!p2 || p2.d > d + 1) owner.set(nk, { id: room.id, d: d + 1 }); continue; }
                    queue.push([nq, nr, d + 1]);
                }
            }
        }
        for (const [k, o] of owner) {
            const [q, r] = k.split(',').map(Number);
            const f = this.tiles[r] && this.tiles[r][q] && this.tiles[r][q]._furniture;
            if (!f || f._part || f._stairs) continue;
            const rec = out[o.id];
            rec.types[f.type] = (rec.types[f.type] || 0) + 1;
            rec.value += this._surveyWorth(f, player);
            if (display.has(f.type)) { rec.displaySlots++; rec.displayTiles.push({ q, r }); }
        }
        return out;
    },

    /** Where the player stands, as a spot to mark a room at: { floor, q, r }. */
    householdSpot() {
        return { floor: this._floor || 0, q: this.playerInnerQ, r: this.playerInnerR };
    },

    /** Entering the home or one of its floors: resurvey, label the displays, bring the household in. */
    _householdArrive(game) {
        const done = this.householdRelabel(game);
        if (done) this._populateHousehold(game.player, done.home, this._floor || 0, done.shown);
    },

    /**
     * Resurvey this floor's rooms (through the UI's hook) and label the
     * hall's display pieces with what stands on them. → { home, shown } or null
     */
    householdRelabel(game) {
        const player = game && game.player;
        if (!this._insideBuilding || !player || !(this.isOwnHome && this.isOwnHome())) return null;
        const home = this.householdHere(player);
        if (!home) return null;
        const floor = this._floor || 0;
        const tallies = this.surveyHomeRooms(home.rooms || [], player);
        const hook = this._householdHook;
        const res = hook && typeof hook.resurvey === 'function' ? hook.resurvey(player, game.world, home.key, tallies) : null;
        // The hall's display pieces show what stands on them
        const hall = (home.rooms || []).find(r => r.kind === 'hall' && (Number(r.floor) || 0) === floor);
        const shown = (res && Array.isArray(res.shown)) ? res.shown : [];
        if (hall && tallies[hall.id]) {
            tallies[hall.id].displayTiles.forEach((at, i) => {
                const f = this.tiles[at.r][at.q]._furniture;
                if (f._baseName == null) f._baseName = f.name;
                const thing = shown[i];
                f.name = thing ? `${thing.name} (on show)` : f._baseName;
                f._display = thing ? thing.ref : null;
            });
        }
        return { home, shown };
    },

    /** A walkable floor tile near (q, r), free of anyone, or null. */
    _householdSpotNear(q, r) {
        const ok = (t, tq, tr) => t && t._isInterior && t.subTerrain && t.subTerrain.passable && !t._isDoor && !t._stairs
            && !(tq === this.playerInnerQ && tr === this.playerInnerR) && !(this.npcs || []).some(n => n.q === tq && n.r === tr);
        for (let d = 0; d <= 4; d++) {
            for (let dr = -d; dr <= d; dr++) {
                for (let dq = -d; dq <= d; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== d) continue;
                    const tq = q + dq, tr = r + dr;
                    const t = this.tiles[tr] && this.tiles[tr][tq];
                    if (ok(t, tq, tr)) return { q: tq, r: tr };
                }
            }
        }
        return null;
    },

    /** What a servant of this role (or a guest) is seen doing at each piece. */
    _homeActsFor(role) {
        this._homeActsCache = this._homeActsCache || {};
        if (this._homeActsCache[role]) return this._homeActsCache[role];
        const own = (role && (_cfg().servants[role] || {}).acts) || {};
        const acts = {};
        for (const [type, def] of Object.entries(this.FURNITURE_ACTIVITIES || {})) {
            const mine = own[type];
            if (mine) acts[type] = { icon: mine[0], label: mine[1], anim: 'idle', duration: [6, 12] };
            // (nobody but the family lies in the beds or sits in the bath)
            else if (def.on === 'lie' || def.on === 'soak') acts[type] = { icon: '👀', label: 'looking about', anim: 'idle', duration: [3, 6] };
            else acts[type] = def;
        }
        this._homeActsCache[role] = acts;
        return acts;
    },

    /** The furniture a servant or guest goes to (townWork._jobFurniture reads it). */
    _homeFurnitureFor(npc) {
        if (!npc || !npc._homeRole) return null;
        if (npc._homeRole === 'guest') return GUEST_LIKES;
        const def = _cfg().servants[npc._homeRole];
        return (def && def.furniture) || null;
    },

    /** Put this floor's servants and guests in the house. */
    _populateHousehold(player, home, floor, shown = []) {
        const rooms = home.rooms || [];
        const roomOf = kind => rooms.find(r => r.kind === kind) || null;
        const floors = [...new Set(rooms.map(r => Number(r.floor) || 0))].sort();
        const S = _cfg().servants || {};
        const rnd = Utils.random;
        const lady = player.gender === 'female';
        let id = 95000;
        const place = (o, at) => {
            const spot = at ? this._householdSpotNear(at.q, at.r) : this._householdSpotNear(Math.floor(this.width / 2), Math.floor(this.height / 2));
            if (!spot) return null;
            const npc = this._makeNpc ? this._makeNpc(o.type, id++, rnd) : null;
            if (!npc) return null;
            Object.assign(npc, {
                q: spot.q, r: spot.r, prevQ: spot.q, prevR: spot.r, targetQ: spot.q, targetR: spot.r, path: null, destinations: [],
                state: 'inside_building', idleTimer: 1e9, _act: null, activity: null,
                _insideBuildingQ: this._insideBuilding.q, _insideBuildingR: this._insideBuilding.r,
                name: o.name, fullName: o.name, roleTitle: o.title, gender: o.gender || npc.gender,
                _householdFolk: true, _homeRole: o.role, _homeActs: this._homeActsFor(o.role === 'guest' ? null : o.role), _homeId: o.id,
            });
            this.npcs.push(npc);
            return npc;
        };
        const bare = !Object.values(home.larder || {}).some(n => n > 0);
        let greeted = false;
        (home.servants || []).forEach((s, i) => {
            const def = S[s.role] || {};
            const room = def.needs ? roomOf(def.needs) : s.role === 'steward' ? (roomOf('study') || roomOf('hall')) : null;
            const sFloor = room ? Number(room.floor) || 0 : (s.role === 'maid' && floors.length ? floors[i % floors.length] : 0);
            if (sFloor !== floor) return;
            const npc = place({ type: ROLE_TYPE[s.role] || 'villager', name: s.name, title: def.name || s.role, gender: s.gender, role: s.role, id: s.id }, room);
            if (!npc || greeted || floor !== 0) return;
            const line = s.mood < 35 ? `${lady ? 'My lady' : 'My lord'}... a word about my wages, when you have a moment.`
                : bare && (s.role === 'cook' || s.role === 'steward') ? `The larder's bare, ${lady ? 'my lady' : 'my lord'}. There's nothing to cook.`
                    : `Welcome home, ${lady ? 'my lady' : 'my lord'}.`;
            npc._bark = { text: line, until: _now() + 4200, from: _now() + 400 };
            greeted = true;
        });
        const hall = roomOf('hall');
        if (hall && (Number(hall.floor) || 0) === floor) {
            (home.guests || []).forEach((g, i) => {
                const npc = place({ type: g.kind === 'envoy' ? 'merchant' : 'noble', name: _cap(g.name), title: g.kind === 'kin' ? 'Kin, visiting' : g.kind === 'envoy' ? 'Envoy' : 'Guest', role: 'guest', id: g.id }, hall);
                if (npc && i === 0 && shown.length) {
                    const thing = shown[Math.floor(rnd() * shown.length)];
                    npc._bark = { text: `What a fine ${String(thing.name).replace(/^(a|an|the) /i, '')}!`, until: _now() + 5200, from: _now() + 1600 };
                }
            });
        }
    },
});
