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
// DECORATIONS (data/furniture.json items of kind 'decor' and 'wall') are kept
// beside the pieces, in rec.decor = [{ uid, id, look?, q, r, face?, on?, cell? }]:
// a 'decor' item stands on a table, desk, shelf, dresser … (decorOn) and sets
// that tile's _decor; it rides on the piece under it (on: its uid, cell: which
// of its tiles), so moving the table moves the mugs. A 'wall' item hangs on a
// wall tile facing into a room (down, left or right: the front wall's inside
// can't be seen) and sets _wallDecor/_wallDecorFace; curtains hang only at a
// window. Windows knocked through (rec.windows = [{ q, r, face }]) are building
// work, never taken down. The house's own decorations are adopted with its
// furniture; on entering, every decoration is laid again from the layout.
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

    /**
     * The key the layout of the floor the player stands on is kept under: the
     * home's own key on the ground floor, `<key>#f<k>` on floor k above (each
     * floor is its own room to arrange — world/innerMap/floors.js). null when not theirs.
     */
    furnishLayoutKey(floor = this._floor || 0) {
        const key = this.furnishHomeKey();
        if (!key) return null;
        return floor > 0 ? `${key}#f${floor}` : key;
    },

    /** The current floor's layout record (made when create is set), or null. */
    homeLayout(player, create = false) {
        const key = this.furnishLayoutKey();
        if (!key || !player) return null;
        if (!player.homeFurnishings || typeof player.homeFurnishings !== 'object') {
            if (!create) return null;
            player.homeFurnishings = {};
        }
        let rec = player.homeFurnishings[key];
        if (!rec && create) {
            const wt = this._currentWorldTileRef;
            const floor = this._floor || 0;
            const home = String((this._insideBuilding && this._insideBuilding.name) || 'Home').replace(/ \((Yours|Rented|To Let|Building)\)$/, '');
            rec = {
                name: floor > 0 && this.floorLabel ? `${home} (${this.floorLabel(floor).replace(/^the /, '')})` : home,
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
        // (never the stairs: they belong to the house — world/innerMap/floors.js)
        return !!(tile && tile._furniture && !tile._stairs && !tile._furniture._stairs && !(tile._customTile && tile._customTile.furniture) && !tile.customObject && !tile.customObjectPart);
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
                // (a big piece is adopted once, from its head tile, at its size)
                if (f.piece && (f.piece.i || f.piece.j)) continue;
                const look = { type: f.type, name: f.name, icon: f.icon, passable: !!f.passable };
                if (f.piece) look.footprint = [f.piece.w, f.piece.h];
                const piece = { uid: `f${++seq}`, id: null, look, q, r, rot: 0 };
                if (f._storage && Object.keys(f._storage).length) piece.storage = f._storage;
                else if (FurnitureCatalogue.holdsThings(f.type)) piece.storage = {};
                rec.pieces.push(piece);
            }
        }
        // The things on its tables and walls (world/innerMap/interiorPlanner.js lays them)
        const under = new Map();
        for (const piece of rec.pieces) {
            FurnitureCatalogue.tilesOf(piece, piece.q, piece.r).forEach((c, i) => under.set(`${c.q},${c.r}`, { uid: piece.uid, cell: i }));
        }
        rec.decor = Array.isArray(rec.decor) ? rec.decor : [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (!t || !t._decor || t._decorUid) continue;
                const u = under.get(`${q},${r}`);
                if (!u) continue; // (on something built in: it stays where it is)
                rec.decor.push({ uid: `f${++seq}`, id: null, look: { kind: 'decor', decor: t._decor }, q, r, on: u.uid, cell: u.cell });
            }
        }
        seq = this._adoptWallDecor(rec, seq);
        rec.decorAdopted = true;
        player.furnitureSeq = seq;
        rec.adopted = true;
        this._layFurnishings(rec, player);
        return rec;
    },

    /** The house's own wall hangings (not its windows) into the layout. → the last uid number */
    _adoptWallDecor(rec, seq) {
        rec.decor = Array.isArray(rec.decor) ? rec.decor : [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (!t || !t._wallDecor || t._wallDecor === 'window' || t._wallDecorUid) continue;
                const face = t._wallDecorFace || (this._wallFace(q, r) || {}).face || 'down';
                rec.decor.push({ uid: `f${++seq}`, id: null, look: { kind: 'wall', wallDecor: t._wallDecor }, q, r, face });
            }
        }
        return seq;
    },

    /** Clear a tile of its furniture, its ground walkable again. */
    _clearFurnitureTile(t) {
        if (!t || !t._furniture) return;
        t._furniture = null;
        delete t._decor; delete t._decorUid; // (what stood on it goes with it)
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
            // (bigger than a tile: drawn whole, as a house's own big pieces are — world/innerMap/interiors.js)
            if (cells.length > 1) {
                const [w, h] = FurnitureCatalogue.footprint(piece);
                t._furniture.piece = { q: piece.q, r: piece.r, w, h, i: c.q - piece.q, j: c.r - piece.r };
            }
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
        bumped.push(...this._layDecor(rec, player));
        this._furnitureChanged();
        return bumped;
    },

    // ──────────── DECORATIONS ────────────

    _isWallTile(t) {
        return !!(t && !t._isDoor && (t.baseTerrain === 'wall' || (t.subTerrain && t.subTerrain.id === 'wall')));
    },

    /** Which way a wall tile faces into a room: { face: 'down' | 'right' | 'left', q, r } (the floor before it), or null. */
    _wallFace(q, r) {
        const floor = (fq, fr) => {
            const t = this._furnishTile(fq, fr);
            return !!(t && t._isInterior && !t._isDoor && !this._isWallTile(t));
        };
        if (floor(q, r + 1)) return { face: 'down', q, r: r + 1 };
        if (floor(q + 1, r)) return { face: 'right', q: q + 1, r };
        if (floor(q - 1, r)) return { face: 'left', q: q - 1, r };
        // (the front wall, its room behind it: only a window's curtains or a torch show there —
        // ui/interiorDress.js draws nothing else on the front wall)
        if (floor(q, r - 1)) return { face: 'up', q, r: r - 1 };
        return null;
    },

    /** Where a decoration stands now: its piece's tile when it rides on one, else its own (q, r). */
    _decorSpot(rec, d) {
        if (d.on) {
            const piece = (rec.pieces || []).find(p => p.uid === d.on);
            if (!piece || !Number.isFinite(piece.q)) return null;
            const cells = FurnitureCatalogue.tilesOf(piece, piece.q, piece.r);
            return cells[Math.min(cells.length - 1, Math.max(0, Number(d.cell) || 0))] || null;
        }
        return Number.isFinite(d.q) && Number.isFinite(d.r) ? { q: d.q, r: d.r } : null;
    },

    /** Which of a laid piece's tiles (q, r) is (0 when it isn't one of the layout's). */
    _cellOf(rec, f, q, r) {
        const piece = f && f._piece && rec && (rec.pieces || []).find(p => p.uid === f._piece);
        if (!piece) return 0;
        return Math.max(0, FurnitureCatalogue.tilesOf(piece, piece.q, piece.r).findIndex(c => c.q === q && c.r === r));
    },

    /**
     * May this decoration go at (q, r)? A 'decor' item on a table, desk, shelf …
     * with nothing on it yet; a 'wall' item on a wall facing into a room with
     * nothing hung there (curtains: only at a window). opts.laying: the layout
     * laid on entry (ownership not checked); opts.rec: the layout (for what's
     * under it). → { ok, reason, face?, on?, cell? }
     */
    decorCheck(piece, q, r, opts = {}) {
        if (!this._insideBuilding || !this.tiles) return { ok: false, reason: 'You can only decorate inside a building.' };
        if (!opts.laying && !this.isOwnHome()) return { ok: false, reason: 'This isn\'t your home to decorate.' };
        const v = FurnitureCatalogue.view(piece);
        const kind = v && (v.kind === 'decor' || v.kind === 'wall') ? v.kind : null;
        if (!kind) return { ok: false, reason: 'That stands on the floor.' };
        const t = Number.isFinite(q) && Number.isFinite(r) ? this._furnishTile(q, r) : null;
        if (!t || !t._isInterior) return { ok: false, reason: 'Nowhere to put it.' };
        const ignore = piece && piece.uid;
        const rec = opts.rec || this.homeLayout(opts.player || null, false);
        if (!opts.laying && rec && Array.isArray(rec.decor) && !rec.decor.some(d => d.uid === ignore)) {
            const max = Number(FurnitureCatalogue.config().maxDecorPerHome) || 40;
            if (rec.decor.length >= max) return { ok: false, reason: `No room for more: ${max} things at most.` };
        }
        if (kind === 'decor') {
            const f = t._furniture;
            if (!f) return { ok: false, reason: `Set the ${v.name} on a table, a desk, a shelf or a dresser.` };
            if (!FurnitureCatalogue.holdsDecor(f.type) || f.passable) return { ok: false, reason: `Nothing can stand on the ${f.name}.` };
            if (t._decor && t._decorUid !== ignore) return { ok: false, reason: `There is something on the ${f.name} already.` };
            return { ok: true, reason: null, on: f._piece || null, cell: this._cellOf(rec, f, q, r) };
        }
        if (!this._isWallTile(t)) return { ok: false, reason: t._isDoor ? 'Not on the door.' : `Hang the ${v.name} on a wall.` };
        const fc = this._wallFace(q, r);
        if (!fc) return { ok: false, reason: 'That wall doesn\'t face into a room.' };
        if (fc.face === 'up' && !v.onWindow && v.wallDecor !== 'torch') return { ok: false, reason: 'Only curtains at a window or a torch hang on the front wall.' };
        if (v.onWindow) {
            const mine = t._wallDecorUid === ignore && !!ignore;
            if (t._wallDecor !== 'window' && !mine) return { ok: false, reason: `${v.name} hang at a window.` };
            return { ok: true, reason: null, face: t._wallDecorFace || fc.face };
        }
        if (t._wallDecor && !(t._wallDecorUid === ignore && ignore)) {
            return { ok: false, reason: t._wallDecor === 'window' || t._wallDecor === 'curtains' ? 'That\'s a window.' : 'Something hangs there already.' };
        }
        return { ok: true, reason: null, face: fc.face };
    },

    /** Lay one decoration's look on its tile (no checks). */
    _layDecorAt(d, spot, face) {
        const t = this._furnishTile(spot.q, spot.r);
        if (!t) return;
        const v = FurnitureCatalogue.view(d);
        if (v.kind === 'decor') {
            t._decor = v.decor;
            t._decorUid = d.uid;
        } else {
            t._wallDecor = v.wallDecor;
            t._wallDecorFace = face || d.face || t._wallDecorFace || 'down';
            t._wallDecorUid = d.uid;
        }
    },

    /** Take a decoration's look off its tile (curtains leave the window behind). */
    _unlayDecor(d) {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (!t) continue;
                if (t._decorUid === d.uid) { delete t._decor; delete t._decorUid; }
                if (t._wallDecorUid === d.uid) this._bareWall(t);
            }
        }
    },

    /** A wall tile with nothing on it again: a window (cut, or the house's own under curtains) stays a window. */
    _bareWall(t) {
        const win = t._wallDecor === 'window' || t._wallDecor === 'curtains' || t._windowCut;
        delete t._wallDecorUid;
        if (win) t._wallDecor = 'window';
        else { delete t._wallDecor; delete t._wallDecorFace; }
    },

    /**
     * Lay the layout's decorations (after its pieces): every movable thing on a
     * table or wall comes off, the windows knocked through go in, then each
     * decoration where it was set. Those with nowhere to go go into the store. → those bumped
     */
    _layDecor(rec, player) {
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this._furnishTile(q, r);
                if (!t) continue;
                if (t._decor && (!t._furniture || t._furniture._piece)) { delete t._decor; delete t._decorUid; }
                if (t._wallDecor) this._bareWall(t);
            }
        }
        for (const w of Array.isArray(rec.windows) ? rec.windows : []) {
            const t = this._furnishTile(w.q, w.r);
            if (!this._isWallTile(t) || (t._wallDecor && t._wallDecor !== 'window')) continue;
            t._wallDecor = 'window';
            t._wallDecorFace = w.face || 'down';
            t._windowCut = true;
        }
        if (!Array.isArray(rec.decor)) rec.decor = [];
        const bumped = [];
        const kept = [];
        for (const d of rec.decor) {
            const spot = this._decorSpot(rec, d);
            const chk = spot ? this.decorCheck(d, spot.q, spot.r, { laying: true, rec }) : { ok: false };
            if (!chk.ok) { bumped.push(d); continue; }
            if (!d.on) { d.q = spot.q; d.r = spot.r; }
            this._layDecorAt(d, spot, chk.face);
            kept.push(d);
        }
        if (bumped.length && player) {
            rec.decor = kept;
            if (!Array.isArray(player.furnitureStore)) player.furnitureStore = [];
            for (const d of bumped) {
                delete d.q; delete d.r; delete d.on; delete d.cell; delete d.face;
                player.furnitureStore.push(d);
            }
        }
        return bumped;
    },

    /** The decoration of the current home at a tile (on it, or hung on it), or null. */
    decorAt(player, q, r) {
        const t = this._furnishTile(q, r);
        const uid = t && (t._decorUid || t._wallDecorUid);
        const rec = uid && this.homeLayout(player, false);
        return (rec && Array.isArray(rec.decor) && rec.decor.find(d => d.uid === uid)) || null;
    },

    /** Set a decoration on a table or hang it on a wall of the current home. → { ok, reason } */
    placeDecor(player, piece, q, r) {
        const rec = this.adoptHomeFurniture(player);
        if (!rec) return { ok: false, reason: 'This isn\'t your home to decorate.' };
        const chk = this.decorCheck(piece, q, r, { player, rec });
        if (!chk.ok) return chk;
        if (!Array.isArray(rec.decor)) rec.decor = [];
        if (rec.decor.includes(piece)) this._unlayDecor(piece);
        else rec.decor.push(piece);
        piece.q = q; piece.r = r;
        if (FurnitureCatalogue.decorKind(piece) === 'decor') {
            if (chk.on) { piece.on = chk.on; piece.cell = chk.cell || 0; } else { delete piece.on; delete piece.cell; }
            delete piece.face;
        } else {
            piece.face = chk.face;
            delete piece.on; delete piece.cell;
        }
        this._layDecorAt(piece, { q, r }, chk.face);
        return { ok: true, reason: null };
    },

    /** Take a decoration down (off its table, off its wall) and out of the layout. → it, or null */
    liftDecor(player, uid) {
        const rec = this.adoptHomeFurniture(player);
        if (!rec || !Array.isArray(rec.decor)) return null;
        const i = rec.decor.findIndex(d => d.uid === uid);
        if (i < 0) return null;
        const d = rec.decor[i];
        this._unlayDecor(d);
        rec.decor.splice(i, 1);
        return d;
    },

    /**
     * A piece of furniture gone into the store: what stood on it comes off
     * and into the store too. → the decorations returned
     */
    releaseDecorOn(player, uid) {
        const rec = this.homeLayout(player, false);
        if (!rec || !Array.isArray(rec.decor) || !player) return [];
        const off = rec.decor.filter(d => d.on === uid);
        if (!off.length) return [];
        rec.decor = rec.decor.filter(d => d.on !== uid);
        if (!Array.isArray(player.furnitureStore)) player.furnitureStore = [];
        for (const d of off) {
            this._unlayDecor(d);
            delete d.q; delete d.r; delete d.on; delete d.cell;
            player.furnitureStore.push(d);
        }
        return off;
    },

    /** May a window be knocked through the wall at (q, r)? → { ok, reason, face } */
    windowCheck(q, r) {
        if (!this._insideBuilding || !this.tiles || !this.isOwnHome()) return { ok: false, reason: 'Only in a home of your own.' };
        const t = this._furnishTile(q, r);
        if (!this._isWallTile(t) || !t._isInterior) return { ok: false, reason: 'A window goes in a wall.' };
        // (the corners hold the house up)
        if ((q === 0 || q === this.width - 1) && (r === 0 || r === this.height - 1)) return { ok: false, reason: 'Not in the corner of the house.' };
        const fc = this._wallFace(q, r);
        if (!fc) return { ok: false, reason: 'That wall doesn\'t face into a room.' };
        if (t._wallDecor === 'window' || t._wallDecor === 'curtains') return { ok: false, reason: 'There is a window there already.' };
        if (t._wallDecor) return { ok: false, reason: 'Take down what hangs there first.' };
        return { ok: true, reason: null, face: fc.face };
    },

    /** Knock a window through the wall at (q, r) of the current home (paid for: systems/furnishing.js windowJob). → { ok, reason } */
    cutWindow(player, q, r) {
        const chk = this.windowCheck(q, r);
        if (!chk.ok) return chk;
        const rec = this.adoptHomeFurniture(player);
        if (!rec) return { ok: false, reason: 'Only in a home of your own.' };
        if (!Array.isArray(rec.windows)) rec.windows = [];
        rec.windows.push({ q, r, face: chk.face });
        const t = this._furnishTile(q, r);
        t._wallDecor = 'window';
        t._wallDecorFace = chk.face;
        t._windowCut = true;
        return { ok: true, reason: null };
    },

    /** The decorations about the home the player stands in, as looks for FurnitureCatalogue.decorEffects. */
    homeDecorLooks() {
        if (!this._insideBuilding || !this.isOwnHome() || !this.tiles) return [];
        const out = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t) continue;
                if (t._decor) out.push({ kind: 'decor', look: t._decor });
                if (t._wallDecor) out.push({ kind: 'wall', look: t._wallDecor });
            }
        }
        return out;
    },

    /** What the decorations of the home the player stands in do (capped): { comfort, cheer, light, prestige }. */
    homeDecorEffects() {
        return FurnitureCatalogue.decorEffects(this.homeDecorLooks());
    },

    /** On entering a building: if it's the player's and they've furnished it, lay it out. */
    applyHomeFurnishings(player) {
        const rec = this.homeLayout(player, false);
        if (!rec || !rec.adopted) return [];
        // (a layout from before decorations: the house's own wall hangings are taken in once)
        if (!rec.decorAdopted) {
            player.furnitureSeq = this._adoptWallDecor(rec, Math.max(0, Number(player.furnitureSeq) || 0));
            rec.decorAdopted = true;
        }
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

    /** Can one still walk from (fromQ, fromR) to the way out (the door; upstairs, the stairs down) with these tiles blocked? */
    _doorReachable(fromQ, fromR, blocked) {
        const door = this._furnishDoor() || (this._stairsDownTile && this._stairsDownTile());
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
        // What stood on it stands on it still
        for (const d of Array.isArray(rec.decor) ? rec.decor : []) {
            if (d.on !== piece.uid) continue;
            const spot = this._decorSpot(rec, d);
            if (spot) { d.q = spot.q; d.r = spot.r; this._layDecorAt(d, spot); }
        }
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
                // (a piece counts once: a laid piece's other tiles are _part, a joined
                // layout piece's (interiors.js _joinPieces) are off its head tile)
                if (!f || f._part || (f.piece && (f.piece.i || f.piece.j))) continue;
                sum += Number.isFinite(f.comfort) ? f.comfort : FurnitureCatalogue.typeComfort(f.type);
            }
        }
        // The things on its tables and walls, a little (capped on their own: FurnitureCatalogue.decorEffects)
        sum += this.homeDecorEffects().comfort;
        const cap = Number(FurnitureCatalogue.config().comfortCap) || 1.2;
        return Math.round(Math.min(cap, sum) * 100) / 100;
    },

    /** How cheering the home is (fun each hour spent in it): its flowers, books, paintings … capped. 0 when it isn't theirs. */
    homeCheer() {
        return this.homeDecorEffects().cheer;
    },
});

function cellsHas(cells, spot) {
    return cells.some(c => c.q === spot.q && c.r === spot.r);
}
