// InnerMap — furniture use: walking up to furniture before using it (player)
// and interior NPCs going about their business on the furniture around them.
import { InnerMap } from './_ref.js';
import { Utils, CustomObjects } from './_imports.js';

const DIRS8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

Object.assign(InnerMap, {
    /** Queued "do this once the player arrives" action: { q, r, run }. */
    _pendingAction: null,

    /**
     * Name patterns that recognise editor-placed objects with no actions of
     * their own, so a sprite bed or anvil is as usable as a procedural one.
     * Order matters: the first match wins.
     */
    FURNITURE_NAME_PATTERNS: [
        [/\bbed\b|\bcot\b|bedroll|hammock/i, 'bed'],
        [/\bchest\b|\btrunk\b|strongbox|coffer/i, 'chest'],
        [/book|shelf|library|scroll/i, 'bookshelf'],
        [/throne/i, 'throne'],
        [/barrel|\bkeg\b|\bcask\b/i, 'barrel'],
        [/\bbar\b|counter/i, 'bar'],
        [/fireplace|hearth|stove|oven|cauldron/i, 'fireplace'],
        [/anvil|workbench|work bench/i, 'anvil'],
        [/forge|furnace|smelter|kiln/i, 'forge'],
        [/stall|\bshop\b|market/i, 'stall'],
        [/weapon|armou?r|\brack\b/i, 'rack'],
        [/altar|shrine/i, 'altar'],
        [/statue|idol/i, 'statue'],
        [/\bpew\b|bench/i, 'pew'],
        [/table|desk|chair|stool/i, 'table'],
        [/\bwell\b/i, 'well'],
        [/bucket|basin|\btub\b|washtub/i, 'bucket'],
        [/crate|\bsack\b|\bbox\b/i, 'crate'],
        [/scales?\b/i, 'scales'],
    ],

    /**
     * What an occupant does at each furniture type: the activity shown over an
     * NPC's head, the character animation, and how long (seconds) it lasts.
     */
    FURNITURE_ACTIVITIES: {
        table:     { icon: '🍲', label: 'eating',      anim: 'sitting', duration: [6, 12] },
        pew:       { icon: '🙏', label: 'praying',     anim: 'sitting', duration: [8, 14] },
        bar:       { icon: '🍺', label: 'drinking',    anim: 'idle',    duration: [6, 12] },
        barrel:    { icon: '🍺', label: 'drawing ale', anim: 'idle',    duration: [3, 6] },
        fireplace: { icon: '🔥', label: 'warming up',  anim: 'idle',    duration: [5, 9] },
        bed:       { icon: '💤', label: 'resting',     anim: 'sitting', duration: [10, 18] },
        bookshelf: { icon: '📖', label: 'reading',     anim: 'idle',    duration: [6, 10] },
        anvil:     { icon: '🔨', label: 'hammering',   anim: 'slash',   duration: [6, 12] },
        forge:     { icon: '🔥', label: 'stoking',     anim: 'slash',   duration: [4, 8] },
        rack:      { icon: '⚔️', label: 'inspecting',  anim: 'idle',    duration: [3, 6] },
        altar:     { icon: '🙏', label: 'praying',     anim: 'emotes',  duration: [6, 12] },
        statue:    { icon: '🙏', label: 'praying',     anim: 'emotes',  duration: [4, 8] },
        stall:     { icon: '💰', label: 'haggling',    anim: 'emotes',  duration: [4, 8] },
        scales:    { icon: '⚖️', label: 'weighing',    anim: 'idle',    duration: [4, 8] },
        crate:     { icon: '📦', label: 'sorting',     anim: 'idle',    duration: [4, 8] },
        chest:     { icon: '📦', label: 'rummaging',   anim: 'idle',    duration: [3, 6] },
        throne:    { icon: '👑', label: 'holding court', anim: 'sitting', duration: [10, 18] },
        well:      { icon: '💧', label: 'drawing water', anim: 'idle',  duration: [3, 6] },
        bucket:    { icon: '💧', label: 'washing',     anim: 'idle',    duration: [3, 6] },
    },

    /** Furniture each kind of NPC gravitates to; anything else is a fallback. */
    NPC_FURNITURE_AFFINITY: {
        merchant:       ['stall', 'scales', 'crate', 'table', 'bar'],
        guard:          ['rack', 'table', 'bar', 'fireplace'],
        farmer:         ['table', 'bar', 'barrel', 'crate', 'fireplace'],
        priest:         ['altar', 'statue', 'pew', 'bookshelf'],
        blacksmith_npc: ['anvil', 'forge', 'rack', 'barrel'],
        villager:       ['table', 'bar', 'pew', 'fireplace', 'stall'],
        child:          ['fireplace', 'table', 'pew'],
        noble:          ['throne', 'table', 'bookshelf', 'altar'],
        traveler:       ['bar', 'table', 'fireplace', 'bed'],
        beggar:         ['fireplace', 'pew', 'altar'],
    },

    /** Furniture type of a name, or null. */
    inferFurnitureTypeFromName(name) {
        if (!name) return null;
        for (const [pattern, type] of this.FURNITURE_NAME_PATTERNS) {
            if (pattern.test(name)) return type;
        }
        return null;
    },

    /** Footprint tile keys of whatever sits at (q, r) — a multi-tile object, or the tile itself. */
    _footprintAt(q, r) {
        const tile = this.getTile(q, r);
        const co = tile && tile.customObject;
        const def = co && typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(co.defId) : null;
        const keys = new Set();
        if (def && Array.isArray(def.tiles) && def.tiles.length) {
            for (const td of def.tiles) keys.add(`${q + td.localCol},${r + td.localRow}`);
        } else {
            keys.add(`${q},${r}`);
        }
        return keys;
    },

    /** True when the player stands on or next to (8-way) the thing at (q, r). */
    isPlayerNextTo(q, r) {
        for (const key of this._footprintAt(q, r)) {
            const [fq, fr] = key.split(',').map(Number);
            if (Math.max(Math.abs(fq - this.playerInnerQ), Math.abs(fr - this.playerInnerR)) <= 1) return true;
        }
        return false;
    },

    /**
     * Walk the player up to the thing at (q, r), then call onArrive().
     * Calls it straight away when the player is already there.
     * @returns {'now'|'walking'|'unreachable'}
     */
    approachAndThen(q, r, onArrive) {
        this.cancelPlayerWalk();
        this._pendingAction = null;
        if (this.isPlayerNextTo(q, r)) {
            onArrive();
            return 'now';
        }
        const tile = this.getTile(q, r);
        const co = tile && tile.customObject;
        const def = co && typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(co.defId) : null;
        const spot = co ? this.findAdjacentToObject(q, r, def) : this.findAdjacentPassable(q, r);
        if (!spot) return 'unreachable';
        const walk = this.movePlayerTo(spot.q, spot.r);
        if (!walk.started) return 'unreachable';
        this._pendingAction = { q, r, run: onArrive };
        return 'walking';
    },

    /** Run the queued arrival action (call when the player's walk arrives). */
    runPendingAction() {
        const pa = this._pendingAction;
        this._pendingAction = null;
        if (pa && typeof pa.run === 'function') pa.run();
        return !!pa;
    },

    // ══════════════════════════════════════════════
    // INTERIOR NPC ACTIVITIES
    // ══════════════════════════════════════════════

    /** Every piece of usable furniture in the current interior: [{ q, r, type }]. */
    getFurnitureSpots() {
        if (this._furnitureSpotsFor === this.tiles && this._furnitureSpots) return this._furnitureSpots;
        const spots = [];
        for (let r = 0; r < this.height; r++) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = 0; q < this.width; q++) {
                const t = row[q];
                if (!t) continue;
                let type = t._furniture ? t._furniture.type : null;
                if (!type && t.customObject && typeof CustomObjects !== 'undefined') {
                    const def = CustomObjects.getDef(t.customObject.defId);
                    if (def) type = this.inferFurnitureTypeFromName(def.name || def.id);
                }
                if (type && this.FURNITURE_ACTIVITIES[type]) spots.push({ q, r, type });
            }
        }
        this._furnitureSpots = spots;
        this._furnitureSpotsFor = this.tiles;
        return spots;
    },

    /** The NPC currently occupying or heading for the furniture at (q, r), or null. */
    getFurnitureOccupant(q, r) {
        return this.npcs.find(n => n._act && n._act.spot && n._act.spot.q === q && n._act.spot.r === r) || null;
    },

    /** Make an NPC give up the furniture they're using or heading for. */
    yieldFurniture(npc) {
        if (!npc || !npc._act) return;
        npc.activity = null;
        npc.path = null;
        npc._act.phase = 'rest';
        npc._act.spot = null;
        npc._act.timer = 2 + Utils.random() * 3;
    },

    /** Pick furniture for an NPC: preferred types first, never one that's taken. */
    _pickFurnitureFor(npc) {
        const spots = this.getFurnitureSpots();
        if (!spots.length) return null;
        const pa = this._pendingAction;
        const free = spots.filter(s =>
            !this.getFurnitureOccupant(s.q, s.r) &&
            !(pa && pa.q === s.q && pa.r === s.r) &&
            !this.isPlayerNextTo(s.q, s.r));
        if (!free.length) return null;
        const liked = this.NPC_FURNITURE_AFFINITY[npc.type] || [];
        const preferred = free.filter(s => liked.includes(s.type));
        const pool = preferred.length && Utils.random() < 0.85 ? preferred : free;
        return pool[Math.floor(Utils.random() * pool.length)];
    },

    /** Start an NPC walking to (tq, tr). Returns false when there's no path. */
    _npcWalkTo(npc, tq, tr) {
        if (npc.q === tq && npc.r === tr) { npc.path = null; return true; }
        const path = this._findPath(npc.q, npc.r, tq, tr);
        if (!path || path.length <= 1) return false;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        return true;
    },

    /** Advance an NPC along its path. Returns true once it has arrived. */
    _npcStep(npc, deltaTime) {
        if (!npc.path || npc.pathIndex >= npc.path.length) { npc.path = null; return true; }
        npc.moveProgress += deltaTime * npc.speed * 2;
        if (npc.moveProgress < 1) return false;
        npc.moveProgress = 0;
        const step = npc.path[npc.pathIndex];
        const stepTile = this.tiles[step.r] && this.tiles[step.r][step.q];
        if (!stepTile || !stepTile.subTerrain.passable) { npc.path = null; return true; }
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.q = step.q;
        npc.r = step.r;
        npc.pathIndex++;
        if (npc.pathIndex >= npc.path.length) { npc.path = null; return true; }
        return false;
    },

    /** Facing constant (0 up, 1 left, 2 down, 3 right) from an NPC toward (tq, tr). */
    _npcFacingToward(npc, tq, tr) {
        const dq = tq - npc.q, dr = tr - npc.r;
        if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
        return dr >= 0 ? 2 : 0;
    },

    _doorTile() {
        for (let r = this.height - 1; r >= 0; r--) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = 0; q < this.width; q++) {
                if (row[q] && row[q]._isDoor) return { q, r };
            }
        }
        return null;
    },

    /**
     * One frame of an NPC inside the interior the player is viewing: idle a
     * moment, walk over to a piece of furniture and use it, wander, and when
     * their visit is up walk out through the door instead of vanishing.
     */
    _updateInteriorNpc(npc, deltaTime) {
        if (!npc._act) npc._act = { phase: 'rest', timer: 0.5 + Utils.random() * 2, spot: null };
        const act = npc._act;

        // Visit over — head for the door (once).
        npc.idleTimer -= deltaTime;
        if (npc.idleTimer <= 0 && act.phase !== 'exit') {
            npc.activity = null;
            const door = this._doorTile();
            act.phase = 'exit';
            act.spot = null;
            if (!door || !this._npcWalkTo(npc, door.q, door.r)) { npc.state = 'leaving_building'; return; }
        }

        switch (act.phase) {
            case 'rest':
                act.timer -= deltaTime;
                if (act.timer > 0) return;
                if (Utils.random() < 0.75) {
                    const spot = this._pickFurnitureFor(npc);
                    if (spot) {
                        const t = this.getTile(spot.q, spot.r);
                        const stand = t && t.subTerrain.passable && !t.customObject ? spot : this.findAdjacentPassable(spot.q, spot.r);
                        if (stand && this._npcWalkTo(npc, stand.q, stand.r)) {
                            act.phase = 'walk';
                            act.spot = spot;
                            return;
                        }
                    }
                }
                // Nothing free to use — mill about.
                {
                    const [dq, dr] = DIRS8[Math.floor(Utils.random() * DIRS8.length)];
                    const tq = npc.q + dq * (1 + Math.floor(Utils.random() * 3));
                    const tr = npc.r + dr * (1 + Math.floor(Utils.random() * 3));
                    const t = this.getTile(tq, tr);
                    if (t && t.subTerrain.passable && !t._isDoor && this._npcWalkTo(npc, tq, tr)) {
                        act.phase = 'walk';
                        act.spot = null;
                    } else {
                        act.timer = 1 + Utils.random() * 2;
                    }
                }
                return;

            case 'walk':
                if (!this._npcStep(npc, deltaTime)) return;
                if (act.spot && Math.max(Math.abs(act.spot.q - npc.q), Math.abs(act.spot.r - npc.r)) <= 1) {
                    const def = this.FURNITURE_ACTIVITIES[act.spot.type];
                    const [lo, hi] = def.duration;
                    act.phase = 'use';
                    act.timer = lo + Utils.random() * (hi - lo);
                    npc.facing = this._npcFacingToward(npc, act.spot.q, act.spot.r);
                    npc.activity = { type: act.spot.type, icon: def.icon, label: def.label, anim: def.anim };
                } else {
                    act.phase = 'rest';
                    act.spot = null;
                    act.timer = 1 + Utils.random() * 3;
                }
                return;

            case 'use':
                act.timer -= deltaTime;
                if (act.timer > 0) return;
                npc.activity = null;
                act.phase = 'rest';
                act.spot = null;
                act.timer = 1 + Utils.random() * 3;
                return;

            case 'exit':
                if (this._npcStep(npc, deltaTime)) npc.state = 'leaving_building';
                return;
        }
    },
});
