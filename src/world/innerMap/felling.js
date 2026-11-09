// InnerMap — felling: trees brought down on a map, the stumps they leave, and
// what grows back (data/townProps.json "felling" and each tree's fell block).
//
//   • A tree felled (movement.js updateInteraction) comes down: it leaves its
//     own stump (its fell.stump, world/townProps.js spawnAfter) and topples
//     away from the one who cut it — the toppling is a record on
//     InnerMap._fallingTrees ({ q, r, defId, dir, t }) that `updateFelling`
//     ages and the renderer draws (ui/innerMapFelling.js); it is gone once it
//     has lain a moment.
//   • Each felling is kept on world.felled[hex]['q,r'] = { tree, stump, day }
//     (saved with the world), so the map remembers it however it is drawn
//     again: on every entry (`_bindFelling`) the spot shows the stump for
//     sproutDays, then a sapling, and treeDays after the felling the tree
//     stands there again and the record is let go.
//   • And live, while you are on the map: when the day turns (updateFelling,
//     each frame, `_regrowLive`) the fellings move on to their next stage where
//     they stand — a stump sprouts, a sapling grows into its tree — never under
//     anyone's feet, nor one being chopped (tried again the next day).
//   • A stump grubbed out (struck down in its turn) leaves the ground clear for
//     good: the record keeps { grubbed: true } and nothing grows there again.
//
// Randomness: none. The world and the day are bound in by the caller (interiors.js enter).

import { InnerMap } from './_ref.js';
import { TownProps, CustomObjects, DataLoader } from './_imports.js';

const _key = (q, r) => `${q},${r}`;
let _propDefs = null;

function _config() {
    const d = (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || {};
    const f = d.felling || {};
    return {
        sproutDays: Number.isFinite(f.sproutDays) ? f.sproutDays : 120,
        treeDays: Number.isFinite(f.treeDays) ? f.treeDays : 360,
        sapling: f.sapling || 'tp_tree_sapling',
        palmSapling: f.palmSapling || 'tp_palm_young',
        fallSeconds: Number.isFinite(f.fallSeconds) ? f.fallSeconds : 1.1,
    };
}

/** A def by id: the registered one, else the town prop's own (for maps built before CustomObjects loads, and the tests). */
function _def(id) {
    if (!id) return null;
    const reg = CustomObjects && CustomObjects.isLoaded && CustomObjects.isLoaded() ? CustomObjects.getDef(id) : null;
    if (reg) return reg;
    if (!_propDefs) _propDefs = new Map(TownProps.defs().map(d => [d.id, d]));
    return _propDefs.get(id) || null;
}

export const Felling = {
    config: _config,

    /** The record of the trees felled on a hex's map (world.felled[hexKey]), made when asked. */
    record(world, hexKey, create = false) {
        if (!world || !hexKey) return null;
        if (!world.felled || typeof world.felled !== 'object') {
            if (!create) return null;
            world.felled = {};
        }
        if (!world.felled[hexKey] && create) world.felled[hexKey] = {};
        return world.felled[hexKey] || null;
    },

    /** What stands where a tree was felled, by the day: 'stump' | 'sapling' | 'tree' | 'clear'. */
    stage(rec, day) {
        if (!rec) return 'tree';
        if (rec.grubbed) return 'clear';
        const C = _config();
        const age = Math.max(0, (day || 0) - (rec.day || 0));
        if (age >= C.treeDays) return 'tree';
        if (age >= C.sproutDays) return 'sapling';
        return 'stump';
    },

    /** The sapling that springs up where this tree stood. */
    saplingFor(rec) {
        const C = _config();
        const tree = _def(rec && rec.tree);
        return tree && tree.palm ? C.palmSapling : C.sapling;
    },

    /** Which way a tree falls: away from whoever cut it (+1 to the right, -1 to the left). */
    fallDir(def, anchorQ, anchorR, cutterQ) {
        const b = def && def.bounds ? def.bounds : { minCol: 0, maxCol: 0 };
        const trunkQ = anchorQ + Math.floor((b.minCol + b.maxCol) / 2);
        if (cutterQ < trunkQ) return 1;
        if (cutterQ > trunkQ) return -1;
        return (anchorQ + anchorR) % 2 === 0 ? 1 : -1;
    },
};

Object.assign(InnerMap, {
    /** The felled-tree record bound to this map (world.felled[hex]), and where to make one. */
    _fellRec: null,
    _fellHex: null,
    _fellWorld: null,
    /** Trees coming down now: [{ q, r, defId, dir, t }] (t: seconds since it began to fall). */
    _fallingTrees: [],

    /** The day it is on this map (the bound world's, else the map's own). */
    _fellDay() {
        if (this._fellWorld && Number.isFinite(this._fellWorld.day)) return this._fellWorld.day;
        return this.worldDay || 0;
    },

    /**
     * On entering a map: lay what the felled trees left as the day has it (stump,
     * sapling, the tree again, or cleared ground) and remember where to record more.
     */
    _bindFelling(world, hexKey, day) {
        this._fellWorld = world || null;
        this._fellHex = hexKey;
        this._fellRec = Felling.record(world, hexKey);
        this._fallingTrees = [];
        const d = Number.isFinite(day) ? day : this._fellDay();
        this._fellSeenDay = d;
        if (!this._fellRec || !this.tiles) return 0;
        let changed = 0;
        for (const k of Object.keys(this._fellRec)) {
            const rec = this._fellRec[k];
            const [q, r] = k.split(',').map(Number);
            const stage = Felling.stage(rec, d);
            if (this._layFelled(q, r, rec, stage)) changed++;
            if (stage === 'tree') delete this._fellRec[k];
        }
        return changed;
    },

    /**
     * The day turned while on the map: each felling moves on to the stage the day
     * gives it, where it stands (a stump sprouts, a sapling grows into its tree) —
     * but not where someone stands, nor one being chopped or grubbed: it waits a day.
     * Returns the spots that changed: [{ q, r, stage }].
     */
    _regrowLive(day = this._fellDay()) {
        const out = [];
        if (!this._fellRec || !this.tiles || this._insideBuilding) return out;
        const sap = rec => Felling.saplingFor(rec);
        for (const k of Object.keys(this._fellRec)) {
            const rec = this._fellRec[k];
            const [q, r] = k.split(',').map(Number);
            const stage = Felling.stage(rec, day);
            if (stage === 'clear' || stage === 'stump') continue;
            const tile = this.getTile(q, r);
            const want = stage === 'sapling' ? sap(rec) : rec.tree;
            const here = tile && tile.customObject ? tile.customObject.defId : null;
            if (here === want) { if (stage === 'tree') delete this._fellRec[k]; continue; }
            if (this._fellingBusy(q, r, _def(want))) continue;
            const had = here ? _def(here) : null;
            if (!this._layFelled(q, r, rec, stage)) continue;
            const now = this.getTile(q, r).customObject;
            if (!now || now.defId !== want) {
                // (it would not fit there now: put back what stood, and try another day)
                if (!now && had) TownProps.place(this.tiles, had, q, r, { ignoreReserved: true });
                continue;
            }
            out.push({ q, r, stage, defId: want });
            if (stage === 'tree') delete this._fellRec[k];
        }
        return out;
    },

    /** Would laying `def` at (q, r) land on someone, or on a stump or tree someone is at? */
    _fellingBusy(q, r, def) {
        const ia = this._activeInteraction;
        if (ia && !ia.done && ia.anchorQ === q && ia.anchorR === r) return true;
        if ((this.npcs || []).some(n => n._chop && n._chop.q === q && n._chop.r === r)) return true;
        const cells = new Set();
        // (the cells it blocks: a tree's trunk, not its crown, which is walked under)
        for (const m of (def && def.meta) || []) if (m.impassable) cells.add(`${q + m.localCol},${r + m.localRow}`);
        if (!cells.size) cells.add(`${q},${r}`);
        const at = (x, y) => cells.has(`${x},${y}`);
        if (at(this.playerInnerQ, this.playerInnerR)) return true;
        return (this.npcs || []).some(n => n.state !== 'inside_building' && at(n.q, n.r));
    },

    /** Make (q, r) show the stage of a felling: replaces the tree, stump or sapling of it found there. */
    _layFelled(q, r, rec, stage) {
        const tile = this.getTile(q, r);
        if (!tile) return false;
        const sap = Felling.saplingFor(rec);
        const want = stage === 'stump' ? rec.stump : stage === 'sapling' ? sap : stage === 'tree' ? rec.tree : null;
        const here = tile.customObject ? tile.customObject.defId : null;
        if (here === want) return false;
        // only what the felling itself put there (or the tree a fresh drawing of the map stood up again)
        const ours = new Set([rec.tree, rec.stump, sap, 'stump_1'].filter(Boolean));
        if (here && !ours.has(here)) return false;
        if (tile.customObjectPart) return false;
        if (here) this._removeCustomObject(q, r, { spawn: false });
        const def = _def(want);
        if (!def) return !!here;
        TownProps.place(this.tiles, def, q, r, { ignoreReserved: true });
        return true;
    },

    /**
     * A tree just came down at (q, r): record it, and start it falling away from the
     * cutter (the player, else the column cutterQ given). by: 'town' when a town
     * woodcutter felled it (world/innerMap/townWoodcutters.js counts the day's).
     */
    _noteFelled(q, r, def, stumpId, cutterQ = null, by = null) {
        const day = this._fellDay();
        const rec = this._fellRec || Felling.record(this._fellWorld, this._fellHex, true);
        if (rec) {
            const was = rec[_key(q, r)];
            // a sapling that grew from an old stump grows back into the tree that stood there first
            const tree = was && !was.grubbed && was.tree && def.id === Felling.saplingFor(was) ? was.tree : def.id;
            rec[_key(q, r)] = { tree, stump: stumpId || null, day, ...(by ? { by } : {}) };
            this._fellRec = rec;
        }
        const cq = Number.isFinite(cutterQ) ? cutterQ : Number.isFinite(this.playerInnerQ) ? this.playerInnerQ : q;
        if (!this._fallingTrees) this._fallingTrees = [];
        this._fallingTrees.push({ q, r, defId: def.id, dir: Felling.fallDir(def, q, r, cq), t: 0 });
    },

    /** A stump grubbed out at (q, r): the ground stays clear. */
    _noteGrubbed(q, r) {
        const rec = this._fellRec || Felling.record(this._fellWorld, this._fellHex, true);
        if (!rec) return;
        const was = rec[_key(q, r)] || {};
        rec[_key(q, r)] = { ...was, grubbed: true, day: was.day != null ? was.day : this._fellDay() };
        this._fellRec = rec;
    },

    /** Age the falling trees; a tree that has come down and lain a moment is let go. Returns those that hit the ground this frame. */
    updateFelling(dt) {
        // A new day on the map: the fellings grow on where they stand
        const day = this._fellDay();
        if (this._fellRec && this._fellSeenDay != null && day !== this._fellSeenDay) {
            this._fellSeenDay = day;
            const grew = this._regrowLive(day);
            if (grew.length) this._regrown = (this._regrown || []).concat(grew);
        }
        const list = this._fallingTrees;
        if (!list || !list.length) return [];
        const C = _config();
        const landed = [];
        for (const f of list) {
            const was = f.t;
            f.t += Math.max(0, dt || 0);
            if (was < C.fallSeconds && f.t >= C.fallSeconds) landed.push(f);
        }
        // fall, then lie there (fallSeconds) while it fades
        this._fallingTrees = list.filter(f => f.t < C.fallSeconds * 2.2);
        return landed;
    },
});
