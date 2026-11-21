// InnerMap — building by hand: the ground that is yours, where a small
// structure may go, and the structures and sites standing on the map.
//
//   • Your ground (`handBuildGround`): your building lot in town, the cells
//     within ground.aroundHome of a building you own (not one you rent), the
//     whole map of a wilds hex whose estate you hold, or within
//     ground.campRadius of the camp you staked on a wilds map.
//   • Where a kind may go (`handBuildCheck`): every cell of its footprint on
//     your ground, open passable dry land — no road, bridge, pier or deck, no
//     doorway or the step before one, no building, object, item, grave, hole
//     or tilled field (a scarecrow may stand on bare tilled soil), nobody
//     standing there.
//   • Standing (`_standHandBuilt`): a site is stakes and string, its cells
//     blocked (tile._hb = { id, aq, ar }, drawn by ui/innerMapHandBuild.js);
//     a finished structure with a prop (data/handBuilding.json) stands as that
//     town prop (customObject.handBuilt = its id: a fence joined to its
//     neighbours, a gate opened and shut as every gate is — world/innerMap/
//     gates.js), the others stay hand-drawn on their marked cells.
//   • On every entry (`_bindHandBuilt`, from interiors.js enter, before the
//     gates are laid) the record (world/handBuilding.js, world.handBuilt[hex])
//     is laid back on the map; marks of things no longer in it are cleared.
//
// No randomness. World and player are handed in by the caller.

import { InnerMap } from './_ref.js';
import { TownProps, CustomObjects } from './_imports.js';
import { HandBuilding } from '../handBuilding.js';
import { Estates } from '../estates.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let _tpDefs = null;

/** A prop's def: the registered object, else the town props' own (before CustomObjects has loaded). */
function _propDef(id) {
    if (!id) return null;
    const reg = CustomObjects && typeof CustomObjects.getDef === 'function' ? CustomObjects.getDef(id) : null;
    if (reg) return reg;
    if (!_tpDefs) {
        _tpDefs = new Map();
        try { for (const d of TownProps.defs()) _tpDefs.set(d.id, d); } catch (e) { /* no town props data */ }
    }
    return _tpDefs.get(id) || null;
}

const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));

Object.assign(InnerMap, {
    _hbWorld: null,
    _hbHex: null,
    _hbHomeCache: null,

    /** The world hex of this map: { q, r } or null. */
    _hbHexOf() {
        const wt = this.currentWorldTile;
        return wt && Number.isFinite(wt.q) ? { q: wt.q, r: wt.r } : null;
    },

    /** A kind's footprint here: its prop's own size when it has one, else the data's. */
    handBuildFootprint(kind) {
        const d = HandBuilding.def(kind);
        const p = d && d.prop ? _propDef(d.prop) : null;
        if (p && p.bounds) return [p.bounds.maxCol - p.bounds.minCol + 1, p.bounds.maxRow - p.bounds.minRow + 1];
        return HandBuilding.footprint(kind);
    },

    /** The cells a kind covers with its anchor (bottom-left) at (q, r). */
    handBuildCells(kind, q, r) {
        return HandBuilding.cellsAt(q, r, this.handBuildFootprint(kind));
    },

    // ──────────── WHOSE GROUND ────────────

    /** Does the player own this building (and not just rent it)? */
    _hbOwnBuilding(b) {
        if (!b || !this.isOwnHome || !this.isOwnHome(b)) return false;
        return b.ownerTitle !== 'Tenant';
    },

    /** Every cell of the buildings the player owns on this map: Set of 'q,r' (cached per map). */
    _hbHomeCells() {
        const n = (this.buildings || []).length;
        const c = this._hbHomeCache;
        if (c && c.tiles === this.tiles && c.n === n) return c.cells;
        const cells = new Set();
        for (const b of this.buildings || []) {
            if (!this._hbOwnBuilding(b)) continue;
            const t = this.getTile(b.q, b.r);
            if (t && t.customBuilding) {
                cells.add(`${b.q},${b.r}`);
                for (let r = b.r - 12; r <= b.r + 2; r++) for (let q = b.q - 8; q <= b.q + 8; q++) {
                    const p = this.getTile(q, r);
                    const part = p && p.customBuildingPart;
                    if (part && part.anchorQ === b.q && part.anchorR === b.r) cells.add(`${q},${r}`);
                }
            } else {
                for (let dq = -1; dq <= 1; dq++) for (let dr = -2; dr <= 0; dr++) cells.add(`${b.q + dq},${b.r + dr}`);
            }
        }
        this._hbHomeCache = { tiles: this.tiles, n, cells };
        return cells;
    },

    /** Within `reach` cells of a building of the player's? */
    _hbNearHome(q, r, reach) {
        const cells = this._hbHomeCells();
        if (!cells.size) return false;
        for (let dr = -reach; dr <= reach; dr++) for (let dq = -reach; dq <= reach; dq++) {
            if (cells.has(`${q + dq},${r + dr}`)) return true;
        }
        return false;
    },

    /** Is the estate this wilds hex belongs to the player's? */
    _hbEstateHere(world) {
        const hex = this._hbHexOf();
        if (!world || !hex || !world.estates) return null;
        let est = null;
        try { est = Estates.fieldAt(world, hex.q, hex.r); } catch (e) { est = null; }
        return est || null;
    },

    /**
     * Is (q, r) the player's ground to build on? → { ok, why, reason }
     * why: 'lot' | 'home' | 'estate' | 'camp'.
     */
    handBuildGround(q, r, world = this._hbWorld) {
        if (!this.tiles) return { ok: false, reason: 'Nowhere to build.' };
        if (this._insideBuilding || this._underwater) return { ok: false, reason: 'Only out of doors.' };
        const C = HandBuilding.config().ground;
        const hex = this._hbHexOf();
        const wt = this._currentWorldTileRef || null;
        const inTown = !!(wt && wt.settlement);
        if (inTown) {
            const lot = this.lotAt ? this.lotAt(q, r) : null;
            if (lot && lot.mine) return { ok: true, why: 'lot' };
            if (this._hbNearHome(q, r, Math.max(0, Number(C.aroundHome) || 0))) return { ok: true, why: 'home' };
            if (lot && !lot.forSale) return { ok: false, reason: 'This lot is someone else\'s.' };
            if (lot) return { ok: false, reason: 'This lot is for sale: buy it first.' };
            return { ok: false, reason: 'The town\'s ground, not yours: build on your own lot or about your own house.' };
        }
        const est = this._hbEstateHere(world);
        if (est && Estates.kindOf(est.holder) === 'player') return { ok: true, why: 'estate' };
        if (this._hbNearHome(q, r, Math.max(0, Number(C.aroundHome) || 0))) return { ok: true, why: 'home' };
        const camp = hex ? HandBuilding.camp(world, hex.q, hex.r) : null;
        if (camp && _cheb(q, r, camp.q, camp.r) <= Math.max(1, Number(C.campRadius) || 7)) return { ok: true, why: 'camp' };
        if (est) return { ok: false, reason: `${Estates.holderName ? Estates.holderName(world, est.holder) : 'Someone'}'s land: not yours to build on.` };
        return { ok: false, reason: camp ? 'Beyond your camp\'s ground.' : 'Not your ground: stake out a camp here first, or build about a house of your own.' };
    },

    /** May the player stake a camp on this map? → { ok, reason } */
    handBuildCampCheck(world = this._hbWorld) {
        const wt = this._currentWorldTileRef || null;
        if (this._insideBuilding || this._underwater) return { ok: false, reason: 'Only out of doors.' };
        if (wt && wt.settlement) return { ok: false, reason: 'Not in a town: the ground here is the town\'s.' };
        const est = this._hbEstateHere(world);
        if (est && Estates.kindOf(est.holder) !== 'player') return { ok: false, reason: `${Estates.holderName ? Estates.holderName(world, est.holder) : 'Someone'} holds this land.` };
        if (est) return { ok: false, reason: 'Your own estate: build where you like on it.' };
        return { ok: true };
    },

    // ──────────── WHERE IT MAY GO ────────────

    /**
     * May `kind` be laid with its anchor at (q, r)? opts.cropAt(q, r): a crop of
     * the player's in the ground there (the UI's farm record). → { ok, reason, cells }
     */
    handBuildCheck(kind, q, r, opts = {}) {
        const d = HandBuilding.def(kind);
        if (!d) return { ok: false, reason: 'Nothing of that kind.', cells: [] };
        const cells = this.handBuildCells(kind, q, r);
        const world = opts.world || this._hbWorld;
        const H = this.tiles ? this.tiles.length : 0;
        const W = H ? this.tiles[0].length : 0;
        for (const c of cells) {
            const t = this.getTile(c.q, c.r);
            if (!t || c.q < 1 || c.r < 1 || c.q >= W - 1 || c.r >= H - 1) return { ok: false, reason: 'Off the edge of the map.', cells };
            const g = this.handBuildGround(c.q, c.r, world);
            if (!g.ok) return { ok: false, reason: g.reason, cells };
            const why = this._hbCellBlocked(t, d, opts);
            if (why) return { ok: false, reason: why, cells };
            for (const [dq, dr] of N4) {
                const n = this.getTile(c.q + dq, c.r + dr);
                if (n && n._doorMarker) return { ok: false, reason: 'Keep the doorway clear.', cells };
            }
            if (!this._insideBuilding && this.playerInnerQ === c.q && this.playerInnerR === c.r) return { ok: false, reason: 'You are standing there.', cells };
            if ((this.npcs || []).some(n => n && n.q === c.q && n.r === c.r && n.state !== 'gone' && n.state !== 'inside_building')) return { ok: false, reason: 'Someone is standing there.', cells };
            if ((this.animals || []).some(a => a && !a.dead && Math.round(a.q) === c.q && Math.round(a.r) === c.r)) return { ok: false, reason: 'A beast is in the way.', cells };
            if (typeof opts.cropAt === 'function' && opts.cropAt(c.q, c.r)) return { ok: false, reason: 'Your crop is growing there.', cells };
        }
        return { ok: true, cells };
    },

    /** Why a cell can't take a new structure (null: it can). */
    _hbCellBlocked(t, d, opts = {}) {
        const id = (t.subTerrain && t.subTerrain.id) || '';
        if (t._isInterior) return 'Only out of doors.';
        if (t._wet || t._sea || t._shallow || t._ford || /water|ice|frozen/.test(id)) return 'Not in the water.';
        if (t._bridge || t._pier || t._deck) return 'Not on a bridge, pier or deck.';
        if (t.isRoad || t._paved) return 'Not on the road.';
        if (t._doorMarker) return 'Not in a doorway.';
        if (t.building || t.customBuilding || t.customBuildingPart) return 'A building stands there.';
        if (t._hb) return 'Something of yours stands there already.';
        if (t.customObject || t.customObjectPart) {
            const tree = this._floraAnchor ? this._floraAnchor(t) : null;
            return tree ? 'Clear the tree or bush first.' : 'Something stands there.';
        }
        if (t.groundItem) return 'Something lies there: pick it up first.';
        if (t._grave || t._plotRef || t._plotHead || t._burialOf || id === 'grave') return 'Not on a grave.';
        if (t._dug && t._dug.kind !== 'filled' && t._dug.kind !== 'tilled') return 'Fill the hole in first.';
        if (t._crag || t._caveMouth) return 'Not on the rock.';
        if (!t.subTerrain || t.subTerrain.passable === false) return 'The ground there is no good for it.';
        const tilled = id === 'tilled_soil' || t._fieldSoil || (t._dug && t._dug.kind === 'tilled');
        if (tilled && !(d && d.onTilled && id === 'tilled_soil' && !t._fieldSoil)) return t._fieldSoil ? 'Not in the town\'s field.' : 'Not on your tilled ground.';
        return null;
    },

    // ──────────── STANDING ON THE MAP ────────────

    /** The structure (record) on (q, r), or null. */
    handBuiltAt(q, r, world = this._hbWorld) {
        const t = this.getTile(q, r);
        const mark = t && t._hb;
        const hex = this._hbHexOf();
        if (!mark || !hex) return null;
        return HandBuilding.find(world, hex.q, hex.r, mark.id);
    },

    /** Every cell of the record that stands marked on the map. */
    _hbMarkedCells(rec) {
        return this.handBuildCells(rec.kind, rec.q, rec.r).filter(c => {
            const t = this.getTile(c.q, c.r);
            return t && t._hb && t._hb.id === rec.id;
        });
    },

    /** Does it stand on the map as the record has it (site or finished)? */
    _hbStanding(rec) {
        const t = this.getTile(rec.q, rec.r);
        if (!t || !t._hb || t._hb.id !== rec.id) return false;
        if (!!t._hb.done !== !!rec.done) return false;
        // (a finished prop struck down since: it stands again)
        const d = rec.done ? HandBuilding.def(rec.kind) : null;
        if (d && d.prop && _propDef(d.prop) && !(t.customObject && t.customObject.handBuilt === rec.id)) return false;
        return true;
    },

    /**
     * Stand a record on the map: a site's stakes, or the finished thing (its prop,
     * or its hand-drawn cells). Returns true when it stands (false: something
     * else has the ground now — it waits in the record).
     */
    _standHandBuilt(rec) {
        if (!rec || !this.tiles) return false;
        if (this._hbStanding(rec)) return true;
        const d = HandBuilding.def(rec.kind);
        if (!d) return false;
        const cells = this.handBuildCells(rec.kind, rec.q, rec.r);
        // (a map drawn afresh: a bush or sapling grown where it stood is grubbed up; anything else, it waits)
        for (const c of cells) {
            const t = this.getTile(c.q, c.r);
            if (!t) return false;
            if (t._hb && t._hb.id !== rec.id) return false;
            if (t.building || t.customBuilding || t.customBuildingPart || t.isRoad) return false;
            const o = (t.customObject || t.customObjectPart) && !(t._hb && t._hb.id === rec.id);
            if (o) {
                const tree = this._floraAnchor ? this._floraAnchor(t) : null;
                if (!tree || !this._clearFlora) return false;
                this._clearFlora(c.q, c.q, c.r, c.r);
                if (t.customObject || t.customObjectPart) return false;
            }
        }
        const prop = rec.done && d.prop ? _propDef(d.prop) : null;
        if (prop) {
            if (!TownProps.place(this.tiles, prop, rec.q, rec.r, { ignoreReserved: true })) return false;
            const a = this.getTile(rec.q, rec.r);
            a.customObject.handBuilt = rec.id;
        }
        for (const c of cells) {
            const t = this.getTile(c.q, c.r);
            t._hb = { id: rec.id, aq: rec.q, ar: rec.r, done: !!rec.done };
            // (a prop blocks as its own meta has it; a site and the hand-drawn things block every cell)
            // (on a copy: the ground objects may be shared between cells; the cell's own kept to put back)
            if (!prop && t.subTerrain) {
                if (!t._hbSub) t._hbSub = t.subTerrain;
                t.subTerrain = { ...t._hbSub, passable: false };
            }
        }
        if (prop && TownProps.isFence(prop.id)) TownProps.joinFences(this.tiles);
        if (typeof this._cartsChanged === 'function') this._cartsChanged();
        return true;
    },

    /** Take a record off the map (its prop, its marks; the ground open again). */
    _unstandHandBuilt(rec) {
        if (!rec || !this.tiles) return;
        const a = this.getTile(rec.q, rec.r);
        let fence = false;
        if (a && a.customObject && a.customObject.handBuilt === rec.id) {
            fence = TownProps.isFence(a.customObject.defId);
            if (TownProps.isGate(a.customObject.defId) && this._gateRec) delete this._gateRec[`${rec.q},${rec.r}`];
            if (this._npcGates) this._npcGates.delete(`${rec.q},${rec.r}`);
            this._removeCustomObject(rec.q, rec.r, { spawn: false });
        }
        for (const c of this.handBuildCells(rec.kind, rec.q, rec.r)) {
            const t = this.getTile(c.q, c.r);
            if (!t || !t._hb || t._hb.id !== rec.id) continue;
            delete t._hb;
            if (t._hbSub) { t.subTerrain = t._hbSub; delete t._hbSub; }
        }
        if (fence) TownProps.joinFences(this.tiles);
        if (typeof this._cartsChanged === 'function') this._cartsChanged();
    },

    /** A site finished (or anything changed in the record): stand it as it now is. */
    refreshHandBuilt(rec) {
        if (!rec) return false;
        if (this._hbStanding(rec)) return true;
        this._unstandHandBuilt(rec);
        return this._standHandBuilt(rec);
    },

    /**
     * On entering a map: lay what the player built here (world.handBuilt[hex]),
     * clear marks the record no longer has, and remember where to record more.
     * Called before the gates are laid, so the player's own gates stand as left.
     */
    _bindHandBuilt(world, hexKey) {
        this._hbWorld = world || null;
        this._hbHex = hexKey || null;
        this._hbHomeCache = null;
        if (!this.tiles || this._insideBuilding) return 0;
        const hex = this._hbHexOf();
        const items = hex ? HandBuilding.at(world, hex.q, hex.r) : [];
        const ids = new Set(items.map(x => x.id));
        // Marks of things since taken down (a map kept from an earlier visit)
        let stale = false;
        for (let r = 0; r < this.tiles.length; r++) for (let q = 0; q < this.tiles[r].length; q++) {
            const t = this.tiles[r][q];
            if (!t) continue;
            if (t.customObject && t.customObject.handBuilt && !ids.has(t.customObject.handBuilt)) {
                this._removeCustomObject(q, r, { spawn: false });
                stale = true;
            }
            if (t._hb && !ids.has(t._hb.id)) {
                delete t._hb;
                if (t._hbSub) { t.subTerrain = t._hbSub; delete t._hbSub; }
                stale = true;
            }
        }
        let laid = 0;
        for (const rec of items) if (this._standHandBuilt(rec)) laid++;
        if (stale) TownProps.joinFences(this.tiles);
        return laid;
    },

    /**
     * Lay a site of `kind` at (q, r) on this map (checked first). → { ok, reason, rec }
     */
    layHandBuilt(world, kind, q, r, day = 0, opts = {}) {
        const hex = this._hbHexOf();
        if (!hex) return { ok: false, reason: 'Nowhere to build.' };
        const chk = this.handBuildCheck(kind, q, r, { ...opts, world });
        if (!chk.ok) return chk;
        const res = HandBuilding.lay(world, hex.q, hex.r, kind, q, r, day);
        if (!res.ok) return res;
        if (!this._standHandBuilt(res.rec)) {
            HandBuilding.at(world, hex.q, hex.r).splice(HandBuilding.at(world, hex.q, hex.r).indexOf(res.rec), 1);
            return { ok: false, reason: 'It will not fit there.' };
        }
        return { ok: true, rec: res.rec };
    },
});
