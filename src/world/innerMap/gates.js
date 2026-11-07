// InnerMap — gates: the gates in a town's field and pasture fences open and shut.
//
//   • A gate stands shut: it blocks like the fence round it (the cell is not
//     passable), so beasts and anything that only reads passability keep out.
//   • People's paths (_findPath: the player, townsfolk) take a shut gate as a
//     door they can open, a little dearer than open ground.
//   • The player opens one from its menu (ui/innerMapGates.js) or by walking
//     into it, and it stays as they leave it: world.gates (TownProps.gateRecord),
//     saved with the world, laid back on the map each time it is entered.
//   • A townsperson walking through a shut gate opens it as they step on and
//     shuts it again once nobody stands in it (_closeGatesBehind, each NPC tick).
//     What they open and shut is not recorded: the gate is as the player left it.
//
// The pieces and the open/shut swap are world/townProps.js (setGate).

import { InnerMap } from './_ref.js';
import { TownProps } from './_imports.js';

const _key = (q, r) => `${q},${r}`;

Object.assign(InnerMap, {
    /** The record of the gates the player left open on this map (world.gates[hex]), or null. */
    _gateRec: null,
    _gateHex: null,
    _gateWorld: null,
    /** Gates townsfolk opened to pass, to shut behind them: Set of 'q,r'. */
    _npcGates: null,

    /** Is this tile a shut gate? */
    _isShutGateTile(tile) {
        const o = tile && tile.customObject;
        return !!(o && TownProps.isGate(o.defId) && !TownProps.isGateOpen(o));
    },

    /** The gate at (q, r): { open } or null when there is none. */
    gateAt(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        const o = t && t.customObject;
        return o && TownProps.isGate(o.defId) ? { q, r, open: TownProps.isGateOpen(o) } : null;
    },

    /**
     * On entering a map: lay its gates as the player left them (world.gates,
     * shut where there is no record) and remember where to record changes.
     */
    _bindGates(world, hexKey) {
        this._gateWorld = world || null;
        this._gateHex = hexKey;
        this._gateRec = TownProps.gateRecord(world, hexKey);
        this._npcGates = new Set();
        TownProps.applyGates(this.tiles, this._gateRec);
    },

    /** Someone (the player, or anyone in the list) standing at (q, r)? */
    _gateOccupied(q, r) {
        if (!this._insideBuilding && this.playerInnerQ === q && this.playerInnerR === r) return true;
        return (this.npcs || []).some(n => n && n.q === q && n.r === r && n.state !== 'gone' && n.state !== 'inside_building');
    },

    /**
     * The player opens or shuts the gate at (q, r). Returns 'opened' / 'shut',
     * 'already' when it was so, 'occupied' when someone stands in the gateway
     * (it can't be shut on them), or null when there is no gate.
     */
    setGateOpen(q, r, open) {
        const g = this.gateAt(q, r);
        if (!g) return null;
        if (!open && this._gateOccupied(q, r)) return 'occupied';
        const changed = TownProps.setGate(this.tiles, q, r, !!open);
        // The player's say: no longer one a townsperson will shut behind them
        if (this._npcGates) this._npcGates.delete(_key(q, r));
        if (open) {
            const rec = this._gateRec || TownProps.gateRecord(this._gateWorld, this._gateHex, true);
            if (rec) { rec[_key(q, r)] = true; this._gateRec = rec; }
        } else if (this._gateRec) {
            delete this._gateRec[_key(q, r)];
        }
        if (!changed) return 'already';
        return open ? 'opened' : 'shut';
    },

    /** The player walks into a shut gate: they open it (and it stays open). Returns true when they did. */
    _playerOpensGate(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!this._isShutGateTile(t)) return false;
        this.setGateOpen(q, r, true);
        return true;
    },

    /**
     * A townsperson steps onto (q, r): a shut gate there they open, to shut
     * behind them. Returns true when they may step there.
     */
    _npcPassGate(npc, tile, q, r) {
        if (!this._isShutGateTile(tile)) return false;
        TownProps.setGate(this.tiles, q, r, true);
        if (!this._npcGates) this._npcGates = new Set();
        this._npcGates.add(_key(q, r));
        return true;
    },

    /** Shut the gates townsfolk opened, once nobody stands in them. */
    _closeGatesBehind() {
        if (!this._npcGates || !this._npcGates.size) return;
        for (const k of [...this._npcGates]) {
            const [q, r] = k.split(',').map(Number);
            if (this._gateOccupied(q, r)) continue;
            this._npcGates.delete(k);
            // (the player may have opened it for good since: setGateOpen took it off this list)
            TownProps.setGate(this.tiles, q, r, false);
        }
    },
});
