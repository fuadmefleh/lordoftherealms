// InnerMap — the insides of buildings kept once visited (world/interiorRecords.js).
//
// On the first visit to a building (interiors.enterBuilding) every floor of it is built
// at once — the ground floor, the floors above, the cellar (floors.js _buildAllFloors) —
// and kept on world.interiors; on any later visit, this session or after a load, they are
// laid back from what was kept instead of being planned again, so a change to the code or
// the plans can't move a house's chests (whose stock is kept by tile: systems/containers.js)
// nor mend what was broken. What changes while the player is inside is written back on
// leaving (exitBuilding) and before a save (flushInteriorRecords, from SaveLoad.saveGame
// through game.flushInteriors). The hour's layer (interiorState.js) is never kept: it is
// taken off before writing and laid on again, over the kept plan, as before.
//
// Not kept: the jail (built fresh each stay), a way underground (mines.js keeps its own),
// the castle (seats.js). The session cache (InnerMap._interiorCache) belongs to one world:
// a new game or a load starts it empty.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';
import { InteriorRecords } from '../interiorRecords.js';

const _type = (b) => String((b && b.type) || '').replace(/^player_/, '');

Object.assign(InnerMap, {
    /** Is this building's inside kept once visited? */
    keepsInterior(building) {
        if (!building || building._jail || building._underground) return false;
        const t = _type(building);
        return t !== 'jail' && t !== 'castle';
    },

    /** How many buildings' insides a world keeps (data/interiorPlans.json records.maxKept). */
    _interiorKeepMax() {
        const P = (DataLoader._gamedata && DataLoader._gamedata.interiorPlans) || {};
        const n = Number(P.records && P.records.maxKept);
        return Number.isFinite(n) && n > 0 ? n : 400;
    },

    /** The session cache belongs to one world: begun empty when the world is another (a new game, a load). */
    _interiorCacheFor(world) {
        if (!world) return;
        if (this._interiorCacheWorld !== world) {
            this._interiorCache = {};
            this._interiorDirty = new Set();
            this._interiorCacheWorld = world;
        }
    },

    /** Every floor of a building in the session cache, by floor: { 0, 1, …, -1 }. */
    _cachedFloors(key) {
        const out = {};
        const C = this._interiorCache || {};
        if (!C[key]) return out;
        out[0] = C[key];
        for (let k = 1; C[`${key}_f${k}`]; k++) out[k] = C[`${key}_f${k}`];
        if (C[`${key}_cellar`]) out[-1] = C[`${key}_cellar`];
        return out;
    },

    /**
     * Lay a kept building into the session cache (its ground floor, floors above, cellar).
     * → true when it was kept and came back whole.
     */
    _restoreInterior(world, key) {
        let floors = null;
        try { floors = InteriorRecords.load(world, key); } catch (e) { floors = null; }
        if (!floors || !floors[0]) return false;
        // (a cellar kept from an older plan of cellars is left out: planned afresh by _buildAllFloors
        // on this visit and kept anew on leaving — interiorRecords.js CELLAR_VERSION)
        const staleCellar = InteriorRecords.staleCellar(InteriorRecords.get(world, key));
        this._interiorCache[key] = floors[0];
        for (const [k, interior] of Object.entries(floors)) {
            const n = Number(k);
            if (n === 0 || (n < 0 && staleCellar)) continue;
            this._interiorCache[n < 0 ? `${key}_cellar` : `${key}_f${n}`] = interior;
        }
        return true;
    },

    /** Write a building's floors (as cached) to the world's records. → whether it was written. */
    _keepInterior(world, key) {
        if (!world || !key) return false;
        const floors = this._cachedFloors(key);
        if (!floors[0]) return false;
        try {
            InteriorRecords.put(world, key, floors, world.day || this.worldDay || 0, this._interiorKeepMax());
            return true;
        } catch (e) {
            // (something on the tiles that can't be kept: planned afresh next time, as before)
            InteriorRecords.forget(world, key);
            return false;
        }
    },

    /**
     * On entering (interiors.enterBuilding, after _prepareFloors): a building seen for the
     * first time has every floor built now and kept; one kept already is noted as visited.
     * Either way it is written back on leaving.
     */
    _noteInteriorVisit(world, key, building) {
        if (!world || !key || !this.keepsInterior(building)) return;
        if (this._buildAllFloors) this._buildAllFloors();
        if (!InteriorRecords.get(world, key)) this._keepInterior(world, key);
        else InteriorRecords.touch(world, key, world.day || 0);
        (this._interiorDirty = this._interiorDirty || new Set()).add(key);
    },

    /** On leaving (interiors.exitBuilding, the hour's layer already off): what changed inside written back. */
    _flushInteriorOnExit(world, key) {
        if (!world || !key || !this._interiorDirty || !this._interiorDirty.has(key)) return;
        this._keepInterior(world, key);
        this._interiorDirty.delete(key);
    },

    /**
     * Before a save: every building changed since it was kept written back (the one the
     * player stands in with the hour's layer taken off for the writing, then laid again).
     */
    flushInteriorRecords(world) {
        if (!world || this._interiorCacheWorld !== world || !this._interiorDirty || !this._interiorDirty.size) return 0;
        const inside = this._insideBuilding && this._floorKey && this._interiorDirty.has(this._floorKey) ? this._floorKey : null;
        const S = this._istate;
        if (inside && S && this._clearInteriorState) this._clearInteriorState();
        let n = 0;
        for (const key of [...this._interiorDirty]) {
            if (this._keepInterior(world, key)) n++;
            if (key !== inside) this._interiorDirty.delete(key);
        }
        if (inside && S && this._applyInteriorState) this._applyInteriorState(S.building, S.key);
        return n;
    },
});
