// ============================================
// InnerMap — furnishing a home the player owns
// ============================================
// Inside a building the player owns (a house of player.houses, a town house
// bought or rented, a house on their lot, a property, an inn they keep) the
// furniture is theirs to arrange. Its layout is kept on the player, by home:
//
//   player.homeFurnishings[homeKey] = { name, town, adopted, pieces: [{ uid, id, look?, q, r, rot, storage? }] }
//
// (pieces resolve through world/furnitureCatalogue.js). The first time the
// player furnishes a home, the furniture it came with is adopted into the
// layout (adoptHomeFurniture), so the house's own bed and chest can be moved
// or put away too. From then on the layout is the whole truth: whenever the
// interior is entered (interiors.enterBuilding → applyHomeFurnishings) its
// floor is cleared and every piece laid where the player set it. A piece that
// no longer fits (the interior came out different) goes back into storage.
//
// Each tile a piece covers carries _furniture { type, name, icon, passable,
// _piece: uid, comfort, restBonus } — so the existing furniture actions
// (sleep, store, cook, sit …), the NPC furniture use and the renderer all
// see it as ordinary furniture. A piece's storage is shared with its tile
// (_furniture._storage), so a chest's contents go where the chest goes.
//
// The buying, storing and selling are systems/furnishing.js; the edit mode
// (ghost preview, pick up, set down, turn) is ui/innerMapFurnish.js.

import { InnerMap } from './_ref.js';
import { FurnitureCatalogue } from '../furnitureCatalogue.js';

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

Object.assign(InnerMap, {
    /** Does the player own this building (default: the one they stand in)? */
    isOwnHome(building = this._insideBuilding) {
        if (!building) return false;
        if (building._jail || building.type === 'jail') return false;
        return !!(building.isPlayerOwned || building.isPlayerProperty || String(building.type || '').startsWith('player_'));
    },

    /** The stable key a home's layout is kept under, or null when it isn't the player's. */
    furnishHomeKey(building = this._insideBuilding, worldQ = null, worldR = null) {
        if (!this.isOwnHome(building)) return null;
        const wt = this.currentWorldTile || {};
        const wq = worldQ != null ? worldQ : wt.q;
        const wr = worldR != null ? worldR : wt.r;
        const at = `${wq},${wr}`;
        const p = building.propertyRef;
        if (p) return `prop:${at}:${p.type || building.type}@${p.innerQ != null ? p.innerQ : building.q},${p.innerR != null ? p.innerR : building.r}`;
        if (building.establishmentId) return `est:${building.establishmentId}`;
        if (building._lotId) return `lot:${at}:${building._lotId}`;
        if (building._vacancy) return `vac:${at}:${building._vacancy}`;
        if (building.type === 'house') return `house:${at}`;
        return `bld:${at}:${building.type}@${building.q},${building.r}`;
    },

    /** The current home's layout record (made when create is set), or null. */
    homeLayout(player, create = false) {
        const key = this.furnishHomeKey();
        if (!key || !player) return null;
        if (!player.homeFurnishings || typeof player.homeFurnishings !== 'object') {
            if (!create) return null;
            player.homeFurnishings = {};
        }
        let rec = player.homeFurnishings[key];
        if (!rec && create) {
            const wt = this._currentWorldTileRef;
            rec = {
                name: String((this._insideBuilding && this._insideBuilding.name) || 'Home').replace(/ \((Yours|Rented|To Let|Building)\)$/, ''),
                town: (wt && wt.settlement && wt.settlement.name) || null,
                adopted: false,
                pieces: [],
            };
            player.homeFurnishings[key] = rec;
        }
        return rec || null;
    },

    _furnishTile(q, r) {
        return (this.tiles && this.tiles[r] && this.tiles[r][q]) || null;
    },

    /** A floor tile's own ground, as it was before furniture stood on it. */
    _floorSubTerrain(tile) {
        if (tile._floorSub) return { ...tile._floorSub };
        const def = this.INTERIOR_FLOORS && this.INTERIOR_FLOORS[tile.baseTerrain];
        return {
            id: tile.baseTerrain || 'interior_floor',
            name: (def && def.name) || 'Floor',
            icon: '🏠',
            color: def ? ((tile.q + tile.r) % 2 === 0 ? def.color : def.altColor) : '#8B7355',
            passable: true,
        };
    },

    /** Is this a piece of furniture the player may move (procedural furniture, not an authored sprite)? */
    _movableFurniture(tile) {
        return !!(tile && tile._furniture && !(tile._customTile && tile._customTile.furniture) && !tile.customObject && !tile.customObjectPart);
    },

    /**
     * Take the furniture a home came with into its layout (once), so it can be
     * moved and put away like anything bought. Chests keep what was in them.
     */
    adoptHomeFurniture(player) {
        const rec = this.homeLayout(player, true);
        if (!rec || rec.adopted) return rec;
        let seq = Math.max(0, Number(player.furnitureSeq) || 0);
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (!this._movableFurniture(t) || t._furniture._piece) continue;
                const f = t._furniture;
                const piece = { uid: `f${++seq}`, id: null, look: { type: f.type, name: f.name, icon: f.icon, passable: !!f.passable }, q, r, rot: 0 };
                if (f._storage && Object.keys(f._storage).length) piece.storage = f._storage;
                else if (FurnitureCatalogue.holdsThings(f.type)) piece.storage = {};
                rec.pieces.push(piece);
            }
        }
        player.furnitureSeq = seq;
        rec.adopted = true;
        this._layFurnishings(rec, player);
        return rec;
    },

    /** Clear a tile of its furniture, its ground walkable again. */
    _clearFurnitureTile(t) {
        if (!t || !t._furniture) return;
        t._furniture = null;
        t.subTerrain = this._floorSubTerrain(t);
    },

    /** Lay one piece's tiles (no checks). */
    _layPiece(piece) {
        const v = FurnitureCatalogue.view(piece);
        if (!v) return;
        if (FurnitureCatalogue.holdsThings(v.type) && !piece.storage) piece.storage = {};
        const cells = FurnitureCatalogue.tilesOf(piece, piece.q, piece.r);
        cells.forEach((c, i) => {
            const t = this._furnishTile(c.q, c.r);
            if (!t) return;
            if (!t._floorSub && t.subTerrain && t.subTerrain.passable && !t._furniture) t._floorSub = { ...t.subTerrain };
            t._furniture = {
                type: v.type, name: v.name, icon: v.icon, passable: v.passable,
                comfort: v.comfort, restBonus: v.restBonus,
                _piece: piece.uid, _part: i > 0, _anchorQ: piece.q, _anchorR: piece.r,
            };
            if (piece.storage && i === 0) t._furniture._storage = piece.storage;
            if (!v.passable) {
                t.subTerrain = {
                    id: `furniture_${v.type}`, name: v.name, icon: v.icon,
                    color: (this.FURNITURE_COLORS && this.FURNITURE_COLORS[v.type]) || '#6a5a4a',
                    passable: false,
                };
            }
        });
    },

    /** Take a piece's tiles up again (no checks). */
    _unlayPiece(uid) {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (t && t._furniture && t._furniture._piece === uid) this._clearFurnitureTile(t);
            }
        }
        this._furnitureChanged();
    },

    _furnitureChanged() {
        this._furnitureSpots = null;
        this._furnitureSpotsFor = null;
    },

    /**
     * Lay a home's whole layout onto the interior: clear the movable furniture,
     * then set each piece down. Pieces that don't fit go back into storage.
     * → the pieces bumped
     */
    _layFurnishings(rec, player) {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (this._movableFurniture(t)) this._clearFurnitureTile(t);
            }
        }
        const bumped = [];
        const kept = [];
        for (const piece of rec.pieces || []) {
            const chk = this.furnishCheck(piece, piece.q, piece.r, { laying: true });
            if (!chk.ok) { bumped.push(piece); continue; }
            this._layPiece(piece);
            kept.push(piece);
        }
        if (bumped.length && player) {
            rec.pieces = kept;
            if (!Array.isArray(player.furnitureStore)) player.furnitureStore = [];
            for (const p of bumped) {
                delete p.q; delete p.r;
                player.furnitureStore.push(p);
            }
        }
        this._furnitureChanged();
        return bumped;
    },

    /** On entering a building: if it's the player's and they've furnished it, lay it out. */
    applyHomeFurnishings(player) {
        const rec = this.homeLayout(player, false);
        if (!rec || !rec.adopted) return [];
        const bumped = this._layFurnishings(rec, player);
        this._furnishBumped = bumped.length ? bumped : null;
        return bumped;
    },

    /** The piece record at a tile of the current home, or null. */
    pieceAt(player, q, r) {
        const t = this._furnishTile(q, r);
        const uid = t && t._furniture && t._furniture._piece;
        const rec = uid && this.homeLayout(player, false);
        return (rec && rec.pieces.find(p => p.uid === uid)) || null;
    },

    /** The door of the current interior, and the tile just inside it. */
    _furnishDoor() {
        for (let r = this.height - 1; r >= 0; r--) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (t && t._isDoor) return { q, r };
            }
        }
        return null;
    },

    /** Can one still walk from (fromQ, fromR) to the door with these tiles blocked? */
    _doorReachable(fromQ, fromR, blocked) {
        const door = this._furnishDoor();
        if (!door) return true;
        const seen = new Set([`${fromQ},${fromR}`]);
        const queue = [[fromQ, fromR]];
        while (queue.length) {
            const [q, r] = queue.shift();
            if (q === door.q && r === door.r) return true;
            for (const [dq, dr] of DIRS4) {
                const nq = q + dq, nr = r + dr, k = `${nq},${nr}`;
                if (seen.has(k) || blocked.has(k)) continue;
                const t = this._furnishTile(nq, nr);
                if (!t || !t.subTerrain || !t.subTerrain.passable) continue;
                seen.add(k);
                queue.push([nq, nr]);
            }
        }
        return false;
    },

    /**
     * May this piece (its rot as given) stand with its top-left at (q, r)?
     * Floor only: not on a wall, a door, the doorway, other furniture, an
     * authored object, the player or anyone else, and never so it walls the
     * player off from the door. opts.laying: the layout being laid on entry
     * (only the ground is checked).
     * → { ok, reason, cells }
     */
    furnishCheck(piece, q, r, opts = {}) {
        if (!this._insideBuilding || !this.tiles) return { ok: false, reason: 'You can only furnish inside a building.', cells: [] };
        if (!opts.laying && !this.isOwnHome()) return { ok: false, reason: 'This isn\'t your home to furnish.', cells: [] };
        if (!Number.isFinite(q) || !Number.isFinite(r)) return { ok: false, reason: 'Nowhere to put it.', cells: [] };
        const cells = FurnitureCatalogue.tilesOf(piece, q, r);
        const v = FurnitureCatalogue.view(piece);
        const door = this._furnishDoor();
        const ignore = piece && piece.uid;
        for (const c of cells) {
            const t = this._furnishTile(c.q, c.r);
            if (!t || !t._isInterior) return { ok: false, reason: 'It doesn\'t fit there.', cells };
            if (t.baseTerrain === 'wall' || (t.subTerrain && t.subTerrain.id === 'wall')) return { ok: false, reason: 'Not in the wall.', cells };
            if (t._isDoor) return { ok: false, reason: 'Not in the doorway.', cells };
            if (door && c.q === door.q && c.r === door.r - 1) return { ok: false, reason: 'Keep the way in from the door clear.', cells };
            if (t.customObject || t.customObjectPart || (t._customTile && t._customTile.furniture)) return { ok: false, reason: 'Something is built in there.', cells };
            if (t._furniture && t._furniture._piece !== ignore) {
                if (opts.laying && !t._furniture._piece) continue; // cleared before laying
                return { ok: false, reason: `The ${t._furniture.name} is in the way.`, cells };
            }
            const ground = t._furniture && t._furniture._piece === ignore ? true : (t.subTerrain && t.subTerrain.passable);
            if (!ground && !opts.laying) return { ok: false, reason: 'There is no floor to stand it on.', cells };
            if (opts.laying) continue;
            if (c.q === this.playerInnerQ && c.r === this.playerInnerR && !(v && v.passable)) return { ok: false, reason: 'You\'re standing there.', cells };
            const npc = (this.npcs || []).find(n => n && n.q === c.q && n.r === c.r);
            if (npc && !(v && v.passable)) return { ok: false, reason: `${npc.name || 'Someone'} is standing there.`, cells };
        }
        if (!opts.laying && v && !v.passable) {
            const blocked = new Set(cells.map(c => `${c.q},${c.r}`));
            if (!this._doorReachable(this.playerInnerQ, this.playerInnerR, blocked)) return { ok: false, reason: 'That would wall you off from the door.', cells };
        }
        if (!opts.laying) {
            const rec = this.homeLayout(opts.player || null, false);
            const max = Number(FurnitureCatalogue.config().maxPiecesPerHome) || 40;
            if (rec && !rec.pieces.some(p => p.uid === ignore) && rec.pieces.length >= max) return { ok: false, reason: `There's no room for more: ${max} pieces at most.`, cells };
        }
        return { ok: true, reason: null, cells };
    },

    /**
     * Set a piece down at (q, r) in the current home (it's added to the layout
     * if it wasn't there). → { ok, reason }
     */
    placePiece(player, piece, q, r, rot = piece.rot || 0) {
        const rec = this.adoptHomeFurniture(player);
        if (!rec) return { ok: false, reason: 'This isn\'t your home to furnish.' };
        const trial = { ...piece, rot };
        const chk = this.furnishCheck(trial, q, r, { player });
        if (!chk.ok) return chk;
        if (rec.pieces.some(p => p.uid === piece.uid)) this._unlayPiece(piece.uid);
        else rec.pieces.push(piece);
        piece.q = q; piece.r = r; piece.rot = rot;
        this._layPiece(piece);
        this._furnitureChanged();
        // Anyone using it gets up
        for (const n of this.npcs || []) if (n && n._act && n._act.spot && cellsHas(chk.cells, n._act.spot) && this.yieldFurniture) this.yieldFurniture(n);
        return { ok: true, reason: null };
    },

    /** Take a piece up off the floor and out of the layout. → the piece, or null */
    liftPiece(player, uid) {
        const rec = this.adoptHomeFurniture(player);
        if (!rec) return null;
        const i = rec.pieces.findIndex(p => p.uid === uid);
        if (i < 0) return null;
        const piece = rec.pieces[i];
        for (const n of this.npcs || []) {
            if (n && n._act && n._act.spot && this.pieceAt(player, n._act.spot.q, n._act.spot.r) === piece && this.yieldFurniture) this.yieldFurniture(n);
        }
        rec.pieces.splice(i, 1);
        this._unlayPiece(uid);
        return piece;
    },

    /**
     * How comfortable the home the player stands in is: each piece's comfort
     * (a house's own pieces valued as the catalogue's), capped. 0 when it isn't theirs.
     */
    homeComfort() {
        if (!this._insideBuilding || !this.isOwnHome() || !this.tiles) return 0;
        let sum = 0;
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const f = this.tiles[r] && this.tiles[r][q] && this.tiles[r][q]._furniture;
                if (!f || f._part) continue;
                sum += Number.isFinite(f.comfort) ? f.comfort : FurnitureCatalogue.typeComfort(f.type);
            }
        }
        const cap = Number(FurnitureCatalogue.config().comfortCap) || 1.2;
        return Math.round(Math.min(cap, sum) * 100) / 100;
    },
});

function cellsHas(cells, spot) {
    return cells.some(c => c.q === spot.q && c.r === spot.r);
}
