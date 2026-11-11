// ============================================
// InnerMap — the graves on the town map
// ============================================
// The planner (world/churchyard.js) lays the churchyard out: its tiles carry
// _grave = 'town', its plots _plot = their index (the head of each
// _plotHead). Who lies in each plot is the town's book of the dead
// (settlement.graveyard, world/graveBook.js; the burials systems/
// graveyards.js). On entering a town, and after anything changes:
//
//   - each plot of the churchyard, and of every burial ground the player has
//     consecrated on a lot, gets its grave's marker as the years have left
//     it (GraveBook.markerNow): a cross, a headstone, a tomb across both its
//     tiles, a weathered or broken stone — or nothing, long unmarked;
//   - a fresh grave's mound and a cleared grave's open pit are marked on the
//     plot (tile._graveShow) for ui/innerMapGraves.js to lay on the ground;
//   - the churchyard's street front gets its iron railing, a gate three tiles wide left open
//     in the middle; a family crypt stands at the back of a ground that has
//     one; a bone mill or ossuary of the player's stands on its lot.
//
// Markers are editor objects (world/graveArt.js defs): they draw, block and
// click like any prop. A marker with no art yet is left to the ground layer.
//
// The player's own burials off the churchyard (world/burials.js,
// world.burials[hex]) are laid here too, on every map they lie on
// (`_bindBurials` on entry, `layBurial` after a burial or a marker): the
// mound's tile carries the record as its `_dug`, a marker stands at its head
// (the tile above, `_burialOf` pointing back) as a churchyard grave's does.

import { InnerMap } from './_ref.js';
import { CustomObjects } from './_imports.js';
import { GraveBook } from '../graveBook.js';
import { GraveArt, GROUND_ART } from '../graveArt.js';
import { Graveyards } from '../../systems/graveyards.js';
import { Burials } from '../burials.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
// Water laid over the ground after the planner marked it (a river, a pond, the sea's edge):
// no grave is dug there, nothing stands on it
const _wet = t => !!(t && !t._bridge && !t._pier && !t._deck
    && (t._wet || t._sea || /water|^sea$|ocean|lake/.test((t.subTerrain && t.subTerrain.id) || '')));

Object.assign(InnerMap, {
    /** The churchyard on this map: { q0, q1, r0, r1, w, h, front, gate, plots } (rebuilt from the tiles' marks if need be). */
    townYard() {
        const tiles = this._outerMapState && this._insideBuilding ? this._outerMapState.tiles : this.tiles;
        if (!tiles) return null;
        if (tiles._graveyard !== undefined && (tiles._graveyard === null || tiles._graveyard.plots)) return tiles._graveyard;
        let box = null;
        const plots = [];
        let front = 'south';
        for (const row of tiles) for (const t of row) {
            if (!t || t._grave !== 'town') continue;
            box = box || { q0: t.q, q1: t.q, r0: t.r, r1: t.r };
            box.q0 = Math.min(box.q0, t.q); box.q1 = Math.max(box.q1, t.q); box.r0 = Math.min(box.r0, t.r); box.r1 = Math.max(box.r1, t.r);
            if (t._graveFront) front = t._graveFront;
            if (t._plotHead && Number.isInteger(t._plot)) plots[t._plot] = { q: t.q, r: t.r };
        }
        if (!box) { tiles._graveyard = null; return null; }
        const w = box.q1 - box.q0 + 1, h = box.r1 - box.r0 + 1;
        const yard = { ...box, w, h, front, gate: { q: Math.floor((box.q0 + box.q1) / 2), r: front === 'south' ? box.r1 : box.r0 }, plots: plots.filter(Boolean) };
        tiles._graveyard = yard;
        return yard;
    },

    /** The settlement on this map. */
    _graveSettlement() {
        const wt = this._currentWorldTileRef || null;
        return (wt && wt.settlement) || null;
    },

    /** Where each plot of a ground lies on this map: [{ q, r }] by plot index (null off the map). */
    groundCells(s, ground) {
        if (!ground) return [];
        if (ground.owner === 'town') {
            const yard = this.townYard();
            return yard ? yard.plots : [];
        }
        const lot = ground.lot ? this.townLots().find(l => l.id === ground.lot) : null;
        if (!lot) return [];
        if (!ground.front) ground.front = lot.gate || 'south';
        return GraveBook.yardPlots(lot.q0, lot.r0, lot.w, lot.h, ground.front);
    },

    /** The grave a tile shows: { s, ground, i } or null. */
    plotAt(q, r) {
        const t = this.getTile(q, r);
        if (!t || !t._plotRef || this._insideBuilding) return null;
        const s = this._graveSettlement();
        const ground = s && s.graveyard && s.graveyard.grounds ? s.graveyard.grounds[t._plotRef.g] : null;
        return ground ? { s, ground, i: t._plotRef.i, head: t._plotRef.q === q && t._plotRef.r === r ? true : !!t._plotHead, q: t._plotRef.q, r: t._plotRef.r } : null;
    },

    // ──────────── ON ENTERING ────────────

    /** Stand the town's graves (and the player's grave works) on the map. */
    _layGraves(settlement, world) {
        if (!settlement || !GraveBook.config().enabled) return;
        const day = _num(world && world.day, 0);
        const yard = this.townYard();
        const town = GraveBook.townGround(settlement);
        // The churchyard as the planner laid it: its plots are the town's (a smaller yard than the
        // data's keeps any graves beyond it — in the old ground, off the map)
        if (yard && !town.mapped) {
            town.mapped = true;
            const n = yard.plots.length;
            if (n > town.cap) { town.cap = n; GraveBook.groundShape(town); } else if (!town.plots.slice(n).some(Boolean) && n > 0) { town.cap = n; town.plots.length = n; }
        }
        Graveyards.ensure(world, settlement);
        if (yard) {
            this._standGround(settlement, town, yard.plots, day);
            this._railYard(yard);
        }
        for (const gr of GraveBook.grounds(settlement)) {
            if (gr.owner !== 'player') continue;
            this._standGround(settlement, gr, this.groundCells(settlement, gr), day);
            if (gr.crypt) this._standCrypt(gr);
        }
        this._standGraveWorks(settlement, day);
    },

    /** After a burial, a clearing, a crypt: the markers again. */
    refreshGraves(world) {
        const s = this._graveSettlement();
        if (s && this.active && !this._insideBuilding) this._layGraves(s, world);
    },

    _standGround(s, ground, cells, day) {
        const drowned = [];
        for (let i = 0; i < cells.length && i < ground.cap; i++) {
            const c = cells[i];
            if (!c) continue;
            const head = this.getTile(c.q, c.r), foot = this.getTile(c.q, c.r + 1);
            if (!head || !foot) continue;
            this._unstandGrave(head);
            this._unstandGrave(foot);
            if (_wet(head) || _wet(foot)) { head._plotRef = null; foot._plotRef = null; drowned.push(i); continue; }
            const ref = { g: ground.id, i, q: c.q, r: c.r };
            head._plotRef = ref;
            foot._plotRef = ref;
            const held = ground.crypt && Array.isArray(ground.crypt.plots) && ground.crypt.plots.includes(i);
            if (held) { head._graveShow = null; continue; }
            const grave = ground.plots[i];
            const open = !grave && ground.open && ground.open[i] != null && day - ground.open[i] <= 30;
            const m = grave ? GraveBook.markerNow(grave, day) : null;
            const fresh = !!grave && GraveBook.yearsBetween(grave.interred != null ? grave.interred : grave.died, day) < _num(GraveBook.config().freshYears, 3);
            head._graveShow = grave || open ? { marker: m, fresh: fresh || m === 'grave_mound', open, art: !!(m && GraveArt.hasArt(m)) } : null;
            if (m && !GROUND_ART.has(m) && GraveArt.hasArt(m)) this._standObject(GraveArt.defId(m), c.q, c.r);
        }
        // No one is buried where the water runs
        if (drowned.length) ground.drowned = drowned; else delete ground.drowned;
    },

    /** Take a grave's marker off a tile (and give back the ground under it). */
    _unstandGrave(t) {
        if (!t) return;
        const co = t.customObject;
        if (co && /^grave_/.test(co.defId || '')) {
            const def = CustomObjects.getDef(co.defId);
            for (const m of (def && def.meta) || []) {
                const ct = this.getTile(t.q + m.localCol, t.r + m.localRow);
                if (!ct) continue;
                if (ct !== t) ct.customObjectPart = null;
                if (ct._gravePass !== undefined && ct.subTerrain) { ct.subTerrain.passable = ct._gravePass; delete ct._gravePass; }
            }
            t.customObject = null;
        }
        t._graveShow = null;
    },

    /** Stand an object (a marker, the rail, a crypt) with its anchor — its footprint's bottom-left — at (q, r). */
    _standObject(defId, q, r) {
        const def = CustomObjects.getDef(defId);
        if (!def) return false;
        for (const m of def.meta || []) {
            const t = this.getTile(q + m.localCol, r + m.localRow);
            if (!t || t.customBuilding || t.customBuildingPart || _wet(t)) return false;
            if ((t.customObject || t.customObjectPart) && !(t.customObject && /^grave_/.test(t.customObject.defId || '') && t === this.getTile(q, r))) return false;
        }
        const a = this.getTile(q, r);
        a.customObject = { defId, sheetPath: null, currentHealthPct: 100, planted: true };
        for (const m of def.meta || []) {
            const t = this.getTile(q + m.localCol, r + m.localRow);
            if (t !== a) t.customObjectPart = { anchorQ: q, anchorR: r };
            if (m.impassable && t.subTerrain) {
                if (t._gravePass === undefined) t._gravePass = t.subTerrain.passable;
                t.subTerrain.passable = false;
            }
        }
        return true;
    },

    /** The churchyard's iron railing along its street front, its gate open in the middle. */
    _railYard(yard) {
        if (!GraveArt.hasArt('grave_fence') || !CustomObjects.getDef(GraveArt.defId('grave_fence'))) return;
        const r = yard.front === 'south' ? yard.r1 : yard.r0;
        for (let q = yard.q0; q <= yard.q1; q++) {
            if (Math.abs(q - yard.gate.q) <= 1) continue;
            const t = this.getTile(q, r);
            if (!t || t.customObject || t.customObjectPart || t.isRoad) continue;
            this._standObject(GraveArt.defId('grave_fence'), q, r);
        }
    },

    /** A ground's family crypt, at its back, in the middle. */
    _standCrypt(ground) {
        const lot = ground.lot ? this.townLots().find(l => l.id === ground.lot) : null;
        if (!lot || !GraveArt.hasArt('crypt')) return;
        const [cw, ch] = GraveArt.footprint('crypt');
        const back = (ground.front || 'south') === 'south';
        const q = lot.q0 + Math.floor((lot.w - cw) / 2);
        const r = back ? lot.r0 + ch - 1 : lot.r1;
        const t = this.getTile(q, r);
        if (t && t.customObject && t.customObject.defId === GraveArt.defId('crypt')) return;
        for (let rr = r - ch + 1; rr <= r; rr++) for (let qq = q; qq < q + cw; qq++) this._unstandGrave(this.getTile(qq, rr));
        this._standObject(GraveArt.defId('crypt'), q, r);
    },

    // ──────────── THE PLAYER'S OWN BURIALS (world/burials.js) ────────────

    /** The hex key of this map ('q,r' of its world tile), or null. */
    _burialHex() {
        const wt = this.currentWorldTile;
        return wt ? `${wt.q},${wt.r}` : null;
    },

    /** The day on this map (the bound world's, else the map's own). */
    _burialDay() {
        const w = this._burialWorld;
        return w && Number.isFinite(w.day) ? w.day : (this.worldDay || 0);
    },

    /**
     * On entering a map: lay the player's burials on it (a mound, a grave, its
     * marker standing at the head) — the map may have been drawn afresh, or
     * come back from a save without them.
     */
    _bindBurials(world, hexKey, day) {
        this._burialWorld = world || null;
        const rec = Burials.record(world, hexKey);
        if (!rec || !this.tiles || this._insideBuilding) return 0;
        const d = Number.isFinite(day) ? day : this._burialDay();
        let n = 0;
        for (const k of Object.keys(rec)) {
            const [q, r] = k.split(',').map(Number);
            if (this.layBurial(q, r, rec[k], d, false)) n++;
        }
        if (n) this._refreshGrassLayer(this.tiles);
        return n;
    },

    /**
     * Lay a burial on its tile: bare earth, the tile's `_dug` the record itself,
     * named as it reads (Burials.label), its marker stood at the head when it has
     * one there. refresh: re-edge the grass now.
     */
    layBurial(q, r, g, day = this._burialDay(), refresh = true) {
        const tile = this.getTile(q, r);
        if (!tile || !g) return false;
        // (the ground as it was before the spade, kept with the burial: an unmarked mound settles back into it)
        // (a map drawn afresh: its tile is the untouched ground)
        const undug = tile._undug || (!tile._dug ? { baseTerrain: tile.baseTerrain, subTerrain: tile.subTerrain || null, terrainDetail: tile.terrainDetail || null, tilled: !!tile._tilled } : null);
        if (!g.was && undug && undug.subTerrain && undug.subTerrain.id !== 'grave') {
            try { g.was = JSON.parse(JSON.stringify(undug)); } catch { g.was = null; }
        }
        tile._dug = g;
        tile._cachedFill = null;
        tile._cachedOverlay = undefined;
        const was = Burials.overgrown(g, day) && g.was && g.was.subTerrain ? g.was : null;
        if (was) {
            // Settled level and grown over: the ground looks as it did; only the record knows
            tile.baseTerrain = was.baseTerrain;
            tile._tilled = !!was.tilled;
            tile.terrainDetail = was.terrainDetail || null;
            tile.subTerrain = { ...was.subTerrain, passable: true };
        } else {
            // (the ground about it stays — grass and all — the mound and its soil drawn over it, ragged-edged:
            // ui/innerMapDigging.js; no square of bare dirt)
            if (undug && undug.baseTerrain) { tile.baseTerrain = undug.baseTerrain; tile.terrainDetail = undug.terrainDetail || null; }
            tile._tilled = true;
            tile.subTerrain = { id: 'grave', name: Burials.label(g, day), icon: '⚰️', color: '#6b5034', passable: true };
        }
        this._standBurialMarker(q, r, g, day);
        if (refresh) this._refreshGrassLayer(this.tiles);
        return true;
    },

    /** Could a marker stand at the head of the burial at (q, r) (the tile above, clear ground)? */
    burialHeadFree(q, r) {
        const t = this.getTile(q, r - 1);
        if (!t || this._insideBuilding || !t.subTerrain || !t.subTerrain.passable || _wet(t)) return false;
        if (t.customObject || t.customObjectPart || t.building || t.customBuilding || t.customBuildingPart) return false;
        if (t.isRoad || t._doorMarker || t._dug || t._plotRef || t.groundItem || t._shallow || t._ford) return false;
        if (this.playerInnerQ === t.q && this.playerInnerR === t.r) return false;
        return true;
    },

    /** The burial a tile belongs to (its mound, or the marker at its head): { q, r, grave } or null. */
    burialAt(q, r) {
        const t = this.getTile(q, r);
        if (!t || this._insideBuilding) return null;
        if (t._dug && t._dug.kind === 'grave') return { q, r, grave: t._dug };
        const b = t._burialOf;
        const m = b ? this.getTile(b.q, b.r) : null;
        return m && m._dug && m._dug.kind === 'grave' ? { q: b.q, r: b.r, grave: m._dug } : null;
    },

    /** Stand (or take down) the marker over a burial at its head, as the day leaves it. */
    _standBurialMarker(q, r, g, day) {
        const head = this.getTile(q, r - 1);
        const m = Burials.markerNow(g, day);
        const ours = head && head._burialOf && head._burialOf.q === q && head._burialOf.r === r;
        const want = m && g.head && GraveArt.hasArt(m) ? GraveArt.defId(m) : null;
        if (ours && head.customObject && head.customObject.defId === want) return;
        if (ours) { this._unstandGrave(head); head._burialOf = null; }
        if (!want || !head) return;
        if (!CustomObjects.getDef(want) || (!ours && !this.burialHeadFree(q, r))) { g.head = false; return; }
        if (this._standObject(want, q, r - 1)) head._burialOf = { q, r };
        else g.head = false;
    },

    /** Take a burial off the map (dug up): its marker comes down, the record goes. */
    clearBurialMarker(q, r) {
        const head = this.getTile(q, r - 1);
        if (head && head._burialOf && head._burialOf.q === q && head._burialOf.r === r) {
            this._unstandGrave(head);
            head._burialOf = null;
        }
    },

    /** The player's bone mills and ossuaries, standing on their lots once built. */
    _standGraveWorks(settlement, day) {
        const book = settlement.lotBook;
        if (!book || !book.lots) return;
        for (const lot of this.townLots()) {
            const b = book.lots[lot.id] && book.lots[lot.id].built;
            const id = b && b.kind === 'bone_mill' ? 'bone_mill' : b && b.kind === 'ossuary' ? 'ossuary' : null;
            if (!id || (b.readyDay != null && day < b.readyDay) || !GraveArt.hasArt(id)) continue;
            const [tw, th] = GraveArt.footprint(id);
            const q = lot.q0 + Math.floor((lot.w - tw) / 2);
            const r = lot.r0 + Math.floor((lot.h - th) / 2) + th - 1;
            const t = this.getTile(q, r);
            if (t && t.customObject && t.customObject.defId === GraveArt.defId(id)) continue;
            if (this._standObject(GraveArt.defId(id), q, r)) {
                t.customObject.graveWork = { lot: lot.id, kind: id };
            }
        }
    },
});


