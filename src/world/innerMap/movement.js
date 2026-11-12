// InnerMap — movement members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';
import { stepBlockedBySides } from '../../core/tileSides.js';
import { Woodlands } from '../woodlands.js';

// A step through a shut gate counts this much on a path (world/innerMap/gates.js)
const GATE_PATH_COST = 2;
// A step through standing crops counts this much: folk keep to the lanes unless the field is where they go
const FIELD_PATH_COST = 3;
// A fight under way in the street (ui/innerMapBrawls.js sets InnerMap._avoidTiles): passers-by walk round it
const AVOID_PATH_COST = 8;

Object.assign(InnerMap, {
    /**
     * Move player within the inner map
     * @returns {{ moved: boolean, encounter: Object|null }}
     */
    movePlayer(dq, dr) {
        // Not halfway up a rock face (world/innerMap/climbing.js)
        if (this._climb) return { moved: false, encounter: null, outOfBounds: false };
        // Cancel any animated walk in progress
        this.cancelPlayerWalk();

        const newQ = this.playerInnerQ + dq;
        const newR = this.playerInnerR + dr;

        // Bounds check
        if (newQ < 0 || newQ >= this.width || newR < 0 || newR >= this.height) {
            return { moved: false, encounter: null, outOfBounds: true };
        }

        const tile = this.tiles[newR][newQ];
        // (water the player may swim into counts: world/innerMap/swimming.js)
        if (!this._playerMayEnter(tile, newQ, newR) || this._stepBlocked(this.playerInnerQ, this.playerInnerR, newQ, newR)) {
            return { moved: false, encounter: null, outOfBounds: false };
        }

        // A shut gate: the player opens it as they go through (world/innerMap/gates.js)
        this._playerOpensGate(newQ, newR);

        // Move
        this.playerInnerQ = newQ;
        this.playerInnerR = newR;

        // Reveal nearby tiles
        this._revealAround(this.tiles, newQ, newR, 2);

        // Check for encounter
        let encounter = null;
        if (tile.encounter && !tile.encounter.discovered) {
            tile.encounter.discovered = true;
            encounter = tile.encounter;
            const encounterKey = `${this.currentWorldTile.q},${this.currentWorldTile.r}_${newQ},${newR}`;
            this._discoveredEncounters[encounterKey] = true;
        }

        return { moved: true, encounter: encounter, outOfBounds: false };
    },

    /**
     * Move player to a specific inner map tile (click-to-move).
     * Sets up an animated walk along the A* path.
     * Returns { started, moved, outOfBounds } — the 'moved' flag is only
     * true once the player actually arrives (checked via updatePlayer).
     */
    movePlayerTo(targetQ, targetR) {
        if (targetQ < 0 || targetQ >= this.width || targetR < 0 || targetR >= this.height) {
            return { started: false, moved: false, encounter: null, outOfBounds: true };
        }

        if (this._climb) return { started: false, moved: false, encounter: null, outOfBounds: false };
        // A climber makes for a crag's top, or down off it; a click on a face is its far end (world/innerMap/climbing.js)
        const climbing = this._climbMax > 0 && !this._insideBuilding;
        if (climbing) {
            const to = this.climbTargetFor(targetQ, targetR);
            if (to) { targetQ = to.q; targetR = to.r; }
        }
        const tile = this.tiles[targetR][targetQ];
        const lv = this.standLevel(tile);
        const climbTo = climbing && lv != null && lv !== this.playerLevel() && (lv > 0 || tile.subTerrain.passable);
        if (!this._playerMayEnter(tile, targetQ, targetR) && !climbTo) {
            return { started: false, moved: false, encounter: null, outOfBounds: false, refused: !tile.subTerrain.passable && this.isSwimmable(targetQ, targetR) ? this._swimRefusal : null };
        }

        // A* pathfinding (the player may swim where swimming is allowed, and climb faces they can)
        const path = this._findPath(this.playerInnerQ, this.playerInnerR, targetQ, targetR,
            { swim: !!this._swimAllowed, levels: true, climb: climbing ? { max: this._climbMax } : null });
        if (!path || path.length <= 1) {
            return { started: false, moved: false, encounter: null, outOfBounds: false };
        }

        // Start animated walk (skip index 0 which is the current position)
        this._playerPath = path;
        this._playerPathIndex = 1;
        this._playerMoveProgress = 0;
        this._playerPrevQ = this.playerInnerQ;
        this._playerPrevR = this.playerInnerR;
        this._playerWalking = true;
        this._playerArrivalResult = null;

        return { started: true, moved: false, encounter: null, outOfBounds: false };
    },

    /**
     * Cancel the current player walk (e.g. on new right-click).
     */
    cancelPlayerWalk() {
        this._pendingAction = null;
        this._playerPath = null;
        this._playerPathIndex = 0;
        this._playerMoveProgress = 0;
        this._playerWalking = false;
        this._playerPrevQ = this.playerInnerQ;
        this._playerPrevR = this.playerInnerR;
    },

    // ══════════════════════════════════════════════
    // OBJECT INTERACTION
    // ══════════════════════════════════════════════
    /**
     * Start an interaction with a custom object.
     * Called when the player arrives at a tile adjacent to the target object.
     * @param {number} baseDamage  % of the object's health removed per swing
     * @param {string} [animKey]   Internal animation key (e.g. 'slash','sitting','emotes')
     */
    startInteraction(anchorQ, anchorR, defId, baseDamage, animKey) {
        // Map from object def animation name → internal anim key
        const _ANIM_KEY_MAP = {
            'combat_1h_slash': 'slash', 'combat_1h_halfslash': 'halfslash',
            'legacy_swing': 'swing', 'sitting': 'sitting',
            'emotes': 'emotes', 'idle': 'idle', 'climb': 'idle',
        };
        const _NON_DESTRUCTIVE = new Set(['sitting', 'emotes', 'idle']);

        // Resolve animation key from object definition if not provided
        if (!animKey) {
            const def = typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(defId) : null;
            animKey = (def && def.animation && _ANIM_KEY_MAP[def.animation]) || 'slash';
        }

        // Check if this is a non-destructive animation (sitting, emotes, idle)
        const nonDestructive = _NON_DESTRUCTIVE.has(animKey);

        if (nonDestructive) {
            // Non-destructive interaction: play the animation for a duration, then complete
            this._activeInteraction = {
                anchorQ, anchorR, defId,
                animKey,
                nonDestructive: true,
                elapsed: 0,
                duration: 3.0,  // seconds to play the animation
                done: false
            };
        } else {
            // Destructive interaction: damage the object per swing
            const anchorTile = this.getTile(anchorQ, anchorR);
            if (anchorTile && anchorTile.customObject && anchorTile.customObject.currentHealthPct == null) {
                anchorTile.customObject.currentHealthPct = 100;
            }
            this._activeInteraction = {
                anchorQ, anchorR, defId,
                animKey,
                nonDestructive: false,
                baseDamage: baseDamage || 20,
                swingTimer: 0,
                swingInterval: 0.5,
                fadeDuration: 0.4,
                fading: false,
                done: false
            };
        }
        this._pendingInteraction = null;
    },

    /**
     * Compute how much % health one swing deals to a custom object.
     * Scales with player strength and luck; reduced by def.resistance (0–95).
     *   str=1, luck=5  → ~8.5%  (~12 swings)
     *   str=5, luck=5  → ~20.5% (~5  swings)
     *   str=10, luck=5 → ~35.5% (~3  swings)
     */
    _computeObjectDamage(player, def) {
        // (the one formula, shared with the "Fell timber" standing order: world/woodlands.js)
        return Woodlands.blowDamage(player, def);
    },

    /**
     * Update active object interaction each frame.
     * Each swing deals baseDamage% (±12.5% variance) to the object's currentHealthPct.
     * Returns:
     *   null                           — still animating between swings
     *   { hit, damage, healthPct }     — a swing just landed (object still alive)
     *   { completed, anchorQ, anchorR, defId, resource } — object destroyed
     */
    updateInteraction(deltaTime) {
        const ia = this._activeInteraction;
        if (!ia || ia.done) return null;

        // Non-destructive interactions (sitting, emotes, idle) — just play animation for a duration
        if (ia.nonDestructive) {
            ia.elapsed = (ia.elapsed || 0) + deltaTime;
            if (ia.elapsed >= ia.duration) {
                ia.done = true;
                this._activeInteraction = null;
                return { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource: null, nonDestructive: true };
            }
            return null;
        }

        ia.swingTimer += deltaTime;

        // Phase 2: fading — health hit 0, wait fadeDuration then remove
        if (ia.fading) {
            if (ia.swingTimer >= ia.fadeDuration) {
                ia.done = true;
                const anchorTile = this.getTile(ia.anchorQ, ia.anchorR);
                let resource = null;
                if (anchorTile && anchorTile.customObject && anchorTile.customObject.resource) {
                    resource = { ...anchorTile.customObject.resource };
                }
                this._lastWreck = null;
                const def = typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(ia.defId) : null;
                this._removeCustomObject(ia.anchorQ, ia.anchorR);
                // A stump grubbed out: the ground stays clear (world/innerMap/felling.js)
                if (def && def.objectType === 'stump' && this._noteGrubbed) this._noteGrubbed(ia.anchorQ, ia.anchorR);
                const result = { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource, wreck: this._lastWreck };
                this._lastWreck = null;
                this._activeInteraction = null;
                return result;
            }
            return null;
        }

        // Phase 1: swing — deal a hit every swingInterval seconds
        if (ia.swingTimer >= ia.swingInterval) {
            ia.swingTimer -= ia.swingInterval;
            const anchorTile = this.getTile(ia.anchorQ, ia.anchorR);
            if (!anchorTile || !anchorTile.customObject) {
                this._activeInteraction = null;
                return { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource: null };
            }
            // Apply swing with ±12.5% variance
            const dmg = ia.baseDamage * (0.875 + Utils.random() * 0.25);
            anchorTile.customObject.currentHealthPct =
                Math.max(0, anchorTile.customObject.currentHealthPct - dmg);
            const hp = anchorTile.customObject.currentHealthPct;
            if (hp <= 0) {
                // A tree comes down at the blow: its stump is left standing and it topples
                // away from you (world/innerMap/felling.js) — no fading out on the spot
                const def = typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(ia.defId) : null;
                if (def && def.topples) return this._fellNow(ia, anchorTile, dmg);
                ia.fading = true;
                ia.swingTimer = 0;
            }
            return { hit: true, damage: Math.round(dmg), healthPct: hp };
        }

        return null; // still animating between swings
    },

    /**
     * The killing blow on a tree: it is felled at once — its stump stands where
     * it was, the toppling is recorded for the renderer and the felling for the
     * map (world/innerMap/felling.js _noteFelled). Returns the completed result
     * (with the hit's damage, for the float over it).
     */
    _fellNow(ia, anchorTile, dmg) {
        const resource = anchorTile.customObject.resource ? { ...anchorTile.customObject.resource } : null;
        const def = CustomObjects.getDef(ia.defId);
        this._removeCustomObject(ia.anchorQ, ia.anchorR);
        const after = anchorTile.customObject;
        const stumpId = after && def && after.defId === def.spawnAfter ? after.defId : null;
        if (this._noteFelled) this._noteFelled(ia.anchorQ, ia.anchorR, def, stumpId);
        ia.done = true;
        this._activeInteraction = null;
        return { hit: true, completed: true, felled: true, damage: Math.round(dmg), healthPct: 0,
            anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource, stumpId };
    },

    /**
     * Remove a custom object (anchor + all footprint tiles).
     * If the definition specifies a `spawnAfter` object ID, that object
     * is automatically placed at the origin tile after removal (e.g. a
     * stump spawning after a tree is harvested) — unless opts.spawn is false
     * (world/innerMap/felling.js laying a map's old fellings).
     */
    _removeCustomObject(anchorQ, anchorR, opts = {}) {
        const anchorTile = this.getTile(anchorQ, anchorR);
        if (!anchorTile || !anchorTile.customObject) return;

        const defId = anchorTile.customObject.defId;
        const def = (typeof CustomObjects !== 'undefined') ? CustomObjects.getDef(defId) : null;
        // A ship's hull struck down: the water round it changes (the living water
        // works its shore out again) and the wreck is left for scatterWreck
        // (world/innerMap/harbour.js), which the caller runs with her cargo
        if (/^hull_/.test(defId || '')) {
            this._waterStamp = (this._waterStamp || 0) + 1;
            this._lastWreck = { anchorQ, anchorR, defId, object: { ...anchorTile.customObject } };
        }

        // Clear footprint tiles and restore passability for all tiles (including anchor)
        if (def && def.tiles) {
            // (a town prop — a tree's trunk, a stump — keeps what blocks in its meta, not its tiles)
            const metaBlocks = new Set((def.meta || []).filter(m => m.impassable).map(m => `${m.localCol},${m.localRow}`));
            for (const td of def.tiles) {
                const fq = anchorQ + td.localCol;
                const fr = anchorR + td.localRow;
                const ft = this.getTile(fq, fr);
                if (!ft) continue;
                const blocks = td.impassable || metaBlocks.has(`${td.localCol},${td.localRow}`);
                const isAnchor = td.localCol === 0 && td.localRow === 0;
                if (isAnchor) {
                    // Anchor tile: restore passability if object made it impassable
                    if (blocks) ft.subTerrain.passable = true;
                } else if (ft.customObjectPart &&
                           ft.customObjectPart.anchorQ === anchorQ &&
                           ft.customObjectPart.anchorR === anchorR) {
                    delete ft.customObjectPart;
                    if (blocks) ft.subTerrain.passable = true;
                }
            }
        }

        // Clear anchor
        delete anchorTile.customObject;

        // ── spawnAfter: place a replacement object at the origin tile ──
        if (def && def.spawnAfter && opts.spawn !== false) {
            const spawnDef = CustomObjects.getDef(def.spawnAfter);
            if (spawnDef && spawnDef.tiles && spawnDef.tiles.length > 0) {
                // Verify the full footprint of the replacement is free
                let clear = true;
                for (const tDef of spawnDef.tiles) {
                    const fq = anchorQ + tDef.localCol;
                    const fr = anchorR + tDef.localRow;
                    if (fq < 0 || fq >= this.width || fr < 0 || fr >= this.height)
                        { clear = false; break; }
                    const ft = this.getTile(fq, fr);
                    if (!ft || ft.building || ft.customObject || ft.customObjectPart)
                        { clear = false; break; }
                }
                if (clear) {
                    // Place the spawn-after object
                    const newObj = { defId: spawnDef.id, sheetPath: spawnDef.sheetPath, currentHealthPct: 100 };
                    if (spawnDef.resource) newObj.resource = spawnDef.resource;
                    const spawnColorVariantIdx = this._pickAutoColorVariantIdx(spawnDef, Math.random);
                    if (spawnColorVariantIdx != null) newObj.colorVariantIdx = spawnColorVariantIdx;
                    anchorTile.customObject = newObj;
                    // Build meta lookup for Format B composed objects
                    let spawnMetaLookup = null;
                    if (Array.isArray(spawnDef.meta) && spawnDef.meta.length > 0) {
                        spawnMetaLookup = {};
                        for (const m of spawnDef.meta) {
                            spawnMetaLookup[`${m.localCol},${m.localRow}`] = m;
                        }
                    }
                    // Mark footprint tiles
                    for (const tDef of spawnDef.tiles) {
                        const fq = anchorQ + tDef.localCol;
                        const fr = anchorR + tDef.localRow;
                        const ft = this.getTile(fq, fr);
                        if (!ft) continue;
                        if (tDef.localCol !== 0 || tDef.localRow !== 0) {
                            ft.customObjectPart = { anchorQ, anchorR };
                        }
                        const sMeta = spawnMetaLookup && spawnMetaLookup[`${tDef.localCol},${tDef.localRow}`];
                        if (tDef.impassable || (sMeta && sMeta.impassable)) ft.subTerrain.passable = false;
                    }
                }
            }
        }
    },

    /**
     * Find the best walkable tile adjacent to a single tile (e.g. an NPC).
     * Returns { q, r } closest to the player, or null.
     */
    findAdjacentPassable(tq, tr) {
        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        const candidates = [];
        for (const [dq, dr] of dirs) {
            const nq = tq + dq, nr = tr + dr;
            if (nq < 0 || nq >= this.width || nr < 0 || nr >= this.height) continue;
            const t = this.getTile(nq, nr);
            if (!t || !t.subTerrain.passable) continue;
            if (t.building || t.customObject) continue;
            const dist = Math.abs(nq - this.playerInnerQ) + Math.abs(nr - this.playerInnerR);
            candidates.push({ q: nq, r: nr, dist });
        }
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.dist - b.dist);
        return { q: candidates[0].q, r: candidates[0].r };
    },

    /**
     * Find the best walkable tile adjacent to an object's footprint.
     * Returns { q, r } or null if none found.
     */
    findAdjacentToObject(anchorQ, anchorR, def) {
        // A tree or a stump is chopped at its trunk: stand beside it (best to its side, so
        // the axe swings across it and it falls away from you), else below it, else above
        if (def && (def.topples || def.objectType === 'stump')) {
            const t = this.trunkOf(anchorQ, anchorR, def);
            const spots = [[-1, 0, 0], [1, 0, 0], [0, 1, 1.5], [0, -1, 3]];
            let best = null;
            for (const [dq, dr, cost] of spots) {
                const nq = t.q + dq, nr = t.r + dr;
                const nt = this.getTile(nq, nr);
                if (!nt || !nt.subTerrain || !nt.subTerrain.passable) continue;
                const dist = Math.abs(nq - this.playerInnerQ) + Math.abs(nr - this.playerInnerR) + cost;
                if (!best || dist < best.dist) best = { q: nq, r: nr, dist };
            }
            if (best) return { q: best.q, r: best.r };
        }
        // Collect all footprint tile coords
        const footprint = new Set();
        if (def && def.tiles) {
            for (const td of def.tiles) {
                footprint.add(`${anchorQ + td.localCol},${anchorR + td.localRow}`);
            }
        } else {
            footprint.add(`${anchorQ},${anchorR}`);
        }

        // Gather all passable neighbors of the footprint
        const candidates = [];
        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (const key of footprint) {
            const [fq, fr] = key.split(',').map(Number);
            for (const [dq, dr] of dirs) {
                const nq = fq + dq, nr = fr + dr;
                const nk = `${nq},${nr}`;
                if (footprint.has(nk)) continue;
                const nt = this.getTile(nq, nr);
                if (!nt || !nt.subTerrain.passable) continue;
                // Prefer tiles closer to the player
                const dist = Math.abs(nq - this.playerInnerQ) + Math.abs(nr - this.playerInnerR);
                candidates.push({ q: nq, r: nr, dist });
            }
        }
        if (candidates.length === 0) return null;

        // Pick closest to player
        candidates.sort((a, b) => a.dist - b.dist);
        return { q: candidates[0].q, r: candidates[0].r };
    },

    /** The cell a tree or stump stands on (its blocking cell, the bottom row's middle), else its anchor. */
    trunkOf(anchorQ, anchorR, def) {
        const m = def && Array.isArray(def.meta) ? def.meta.find(x => x.impassable) : null;
        return m ? { q: anchorQ + m.localCol, r: anchorR + m.localRow } : { q: anchorQ, r: anchorR };
    },

    /** The way to face to strike the object anchored at (q, r): at its trunk for a tree or a stump. */
    getDirectionTowardObject(anchorQ, anchorR, def) {
        const t = def && (def.topples || def.objectType === 'stump') ? this.trunkOf(anchorQ, anchorR, def) : { q: anchorQ, r: anchorR };
        return this.getDirectionToward(t.q, t.r);
    },

    /**
     * Get the direction the player should face toward an object anchor.
     */
    getDirectionToward(targetQ, targetR) {
        const dq = targetQ - this.playerInnerQ;
        const dr = targetR - this.playerInnerR;
        // Return direction constant compatible with InnerMapCharacters
        if (Math.abs(dq) >= Math.abs(dr)) {
            return dq >= 0 ? 3 : 1; // RIGHT : LEFT
        }
        return dr >= 0 ? 2 : 0; // DOWN : UP
    },

    /**
     * Tick the player walking animation. Called each frame.
     * Returns null while walking, or { moved, encounter } on arrival / each step.
     */
    updatePlayer(deltaTime) {
        if (!this._playerWalking || !this._playerPath) return null;
        // On the rock: ui/innerMapClimbing.js drives the climb, the walk waits
        if (this._climb || this._climbRequest) return null;

        // A stroke through deep water is slower than a step (world/innerMap/swimming.js)
        const next = this._playerPath[this._playerPathIndex];
        // A step that jumps from a face's foot to its top (or back) is a climb (world/innerMap/climbing.js)
        if (next && Math.abs(next.q - this.playerInnerQ) + Math.abs(next.r - this.playerInnerR) > 1) {
            const link = this.linkBetween(this.playerInnerQ, this.playerInnerR, next.q, next.r);
            if (!link || link.rows > (this._climbMax || 0)) {
                this.cancelPlayerWalk();
                return { moved: false, encounter: null, blocked: true, climbRefused: true };
            }
            this._climbRequest = link;
            return null;
        }
        const nextTile = next && this.tiles[next.r] && this.tiles[next.r][next.q];
        const inWater = (nextTile && !nextTile.subTerrain.passable && !this._isShutGateTile(nextTile)) || this.isPlayerSwimming();
        const under = this._underwater ? (this._underwaterSpeed || 0.75) : 1; // (slower again under the surface)
        this._playerMoveProgress += deltaTime * this._playerSpeed * (inWater ? this.swimConfig().speed * (this._swimSpeedBonus || 1) * under : 1);

        if (this._playerMoveProgress >= 1.0) {
            this._playerMoveProgress = 0;

            // Advance to the next step
            const step = this._playerPath[this._playerPathIndex];

            // Defensive: never step onto impassable tile (water only while swimming is allowed)
            const stepTile = this.tiles[step.r] && this.tiles[step.r][step.q];
            if (!stepTile || !this._playerMayEnter(stepTile, step.q, step.r) || this._stepBlocked(this.playerInnerQ, this.playerInnerR, step.q, step.r)) {
                this.cancelPlayerWalk();
                return { moved: false, encounter: null, blocked: true };
            }

            // A shut gate on the way: opened on reaching it, and left open (world/innerMap/gates.js)
            this._playerOpensGate(step.q, step.r);

            this._playerPrevQ = this.playerInnerQ;
            this._playerPrevR = this.playerInnerR;
            this.playerInnerQ = step.q;
            this.playerInnerR = step.r;
            this._playerPathIndex++;

            // Reveal fog
            this._revealAround(this.tiles, step.q, step.r, 2);

            // Check encounter
            let encounter = null;
            if (stepTile.encounter && !stepTile.encounter.discovered) {
                stepTile.encounter.discovered = true;
                encounter = stepTile.encounter;
            }

            // Check if arrived at final destination
            if (this._playerPathIndex >= this._playerPath.length) {
                this._playerWalking = false;
                this._playerPath = null;
                return { moved: true, encounter, arrived: true };
            }

            // Intermediate step with encounter — stop walking
            if (encounter) {
                this.cancelPlayerWalk();
                return { moved: true, encounter, arrived: false };
            }
        }

        return null; // still walking
    },

    /**
     * Get the player's current interpolated world position (for rendering).
     */
    getPlayerWorldPos() {
        const T = 32; // TILE_SIZE
        // On a rock face, between its foot and its top (world/innerMap/climbing.js)
        const cp = this._climbPos();
        if (cp) return { x: cp.x, y: cp.y, walking: false, climbing: true, dq: 0, dr: 0 };
        if (this._climbRequest) {
            return { x: this.playerInnerQ * T + T / 2, y: this.playerInnerR * T + T / 2, walking: false, dq: 0, dr: 0 };
        }
        if (this._playerWalking && this._playerPath && this._playerPathIndex < this._playerPath.length) {
            const target = this._playerPath[this._playerPathIndex];
            const progress = this._playerMoveProgress;
            const fx = this.playerInnerQ * T + T / 2;
            const fy = this.playerInnerR * T + T / 2;
            const tx = target.q * T + T / 2;
            const ty = target.r * T + T / 2;
            return {
                x: fx + (tx - fx) * progress,
                y: fy + (ty - fy) * progress,
                walking: true,
                dq: target.q - this.playerInnerQ,
                dr: target.r - this.playerInnerR
            };
        }
        return {
            x: this.playerInnerQ * T + T / 2,
            y: this.playerInnerR * T + T / 2,
            walking: false,
            dq: 0, dr: 0
        };
    },

    /**
     * Is the step between two neighbouring tiles crossed by a blocked side?
     * Sides come from interiors (tile.blockedSides, see core/tileSides.js).
     */
    _stepBlocked(fromQ, fromR, toQ, toR) {
        const from = this.tiles[fromR] && this.tiles[fromR][fromQ];
        const to = this.tiles[toR] && this.tiles[toR][toQ];
        if (!from || !to) return false;
        return stepBlockedBySides(from.blockedSides, to.blockedSides, toQ - fromQ, toR - fromR);
    },

    /**
     * Simple A* pathfinding for the inner map (binary-heap based)
     */
    _findPath(startQ, startR, endQ, endR, opts = null) {
        const W = this.width, H = this.height;
        // The player's paths may swim (each water tile dearer than a step); nobody else's do
        const swim = !!(opts && opts.swim);
        const swimCost = swim ? Math.max(1, Number(this.swimConfig().pathCost) || 3) : 1;
        // The player's paths keep to their own height, and may climb faces no taller than climb.max
        // (world/innerMap/climbing.js); nobody else's do
        const climb = opts && opts.climb ? opts.climb : null;
        const levels = !!(opts && (opts.levels || climb));
        const climbCost = Math.max(1, Number(this._climbPathCost) || 4);
        const tiles = this.tiles;
        // Tiles to keep clear of (a brawl's ground), for everyone's paths but the player's
        const avoid = !levels && this._avoidTiles && this._avoidTiles.size && this._avoidTiles.w === W ? this._avoidTiles : null;
        // Carts parked in the street are solid: everyone's paths go round them (world/innerMap/carts.js)
        const parked = !this._insideBuilding && this._cartParkedIdx && this._cartParkedIdx.w === W && this._cartsTiles === tiles ? this._cartParkedIdx : null;
        // Flat index helpers
        const idx = (q, r) => r * W + q;
        const endIdx = idx(endQ, endR);
        const startIdx = idx(startQ, startR);

        // gScore and parent arrays — flat, indexed by r*W+q
        const size = W * H;
        const gScore = new Float32Array(size);
        gScore.fill(Infinity);
        gScore[startIdx] = 0;

        const parentQ = new Int16Array(size);
        const parentR = new Int16Array(size);
        parentQ.fill(-1);
        parentR.fill(-1);

        const inClosed = new Uint8Array(size); // 0 = not visited, 1 = closed

        // Heuristic: Manhattan distance
        const heuristic = (q, r) => Math.abs(q - endQ) + Math.abs(r - endR);

        // --- Binary min-heap on f-score ---
        const heapNode = []; // { f, idx, q, r }
        const push = (f, i, q, r) => {
            let pos = heapNode.length;
            heapNode.push({ f, idx: i, q, r });
            // Bubble up
            while (pos > 0) {
                const parent = (pos - 1) >> 1;
                if (heapNode[parent].f <= heapNode[pos].f) break;
                const tmp = heapNode[parent];
                heapNode[parent] = heapNode[pos];
                heapNode[pos] = tmp;
                pos = parent;
            }
        };
        const pop = () => {
            const top = heapNode[0];
            const last = heapNode.pop();
            if (heapNode.length > 0) {
                heapNode[0] = last;
                let pos = 0;
                const len = heapNode.length;
                while (true) {
                    let smallest = pos;
                    const l = 2 * pos + 1, r = 2 * pos + 2;
                    if (l < len && heapNode[l].f < heapNode[smallest].f) smallest = l;
                    if (r < len && heapNode[r].f < heapNode[smallest].f) smallest = r;
                    if (smallest === pos) break;
                    const tmp = heapNode[smallest];
                    heapNode[smallest] = heapNode[pos];
                    heapNode[pos] = tmp;
                    pos = smallest;
                }
            }
            return top;
        };

        push(heuristic(startQ, startR), startIdx, startQ, startR);

        // Neighbor offsets (4-directional)
        const dq = [1, -1, 0, 0];
        const dr = [0, 0, 1, -1];

        while (heapNode.length > 0) {
            const cur = pop();
            const ci = cur.idx;

            if (ci === endIdx) {
                // Reconstruct path
                const path = [];
                let pq = cur.q, pr = cur.r;
                while (pq !== -1) {
                    path.push({ q: pq, r: pr });
                    const pi = idx(pq, pr);
                    const nq = parentQ[pi], nr = parentR[pi];
                    pq = nq; pr = nr;
                }
                path.reverse();
                return path;
            }

            if (inClosed[ci]) continue;
            inClosed[ci] = 1;

            const cq = cur.q, cr = cur.r;

            for (let d = 0; d < 4; d++) {
                const nq = cq + dq[d];
                const nr = cr + dr[d];
                if (nq < 0 || nq >= W || nr < 0 || nr >= H) continue;
                const ni = idx(nq, nr);
                if (inClosed[ni]) continue;
                const tile = tiles[nr][nq];
                let ng = gScore[ci] + 1;
                let high = false;
                if (levels) {
                    const lc = this.standLevel(tiles[cr][cq]), ln = this.standLevel(tile);
                    if (ln == null || ln !== (lc == null ? 0 : lc)) continue;
                    high = ln > 0;
                }
                if (high) {
                    // across a crag's top
                } else if (!tile.subTerrain.passable && tile.customObject && this._isShutGateTile(tile)) {
                    // A shut gate: people open it to pass, so a walk round is taken when it isn't much longer
                    ng = gScore[ci] + GATE_PATH_COST;
                } else if (!tile.subTerrain.passable) {
                    if (!swim || !this.isSwimmable(nq, nr)) continue;
                    ng = gScore[ci] + swimCost;
                } else if (swim && this._underwater) {
                    continue; // under the water: no land, no shallows (world/innerMap/swimming.js)
                }
                if (tile._fieldSoil && !high) ng += FIELD_PATH_COST - 1;
                // (not the player's walk: theirs keeps to its levels)
                if (avoid && ni !== endIdx && avoid.has(ni)) ng += AVOID_PATH_COST;
                if (parked && ni !== endIdx && parked.has(ni)) continue;
                // Blocked tile sides (interior floor edges, see core/tileSides.js)
                if ((tile.blockedSides || tiles[cr][cq].blockedSides) &&
                    stepBlockedBySides(tiles[cr][cq].blockedSides, tile.blockedSides, dq[d], dr[d])) continue;

                if (ng < gScore[ni]) {
                    gScore[ni] = ng;
                    parentQ[ni] = cq;
                    parentR[ni] = cr;
                    push(ng + heuristic(nq, nr), ni, nq, nr);
                }
            }
            // Up or down a face from here
            if (climb) {
                for (const l of this.linksFrom(cq, cr)) {
                    if (l.rows > climb.max) continue;
                    const ni = idx(l.toQ, l.toR);
                    if (inClosed[ni]) continue;
                    const ng = gScore[ci] + l.rows * climbCost;
                    if (ng < gScore[ni]) {
                        gScore[ni] = ng;
                        parentQ[ni] = cq;
                        parentR[ni] = cr;
                        push(ng + heuristic(l.toQ, l.toR), ni, l.toQ, l.toR);
                    }
                }
            }
        }

        return null; // No path
    },

    /**
     * Reveal tiles around a position
     */
    _revealAround(tiles, q, r, radius) {
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dq = -radius; dq <= radius; dq++) {
                const nq = q + dq;
                const nr = r + dr;
                if (nq >= 0 && nq < this.width && nr >= 0 && nr < this.height) {
                    // Use hex distance for a more natural reveal shape
                    const dist = Math.abs(dq) + Math.abs(dr);
                    if (dist <= radius + 1) {
                        tiles[nr][nq].explored = true;
                        tiles[nr][nq].visible = true;
                    }
                }
            }
        }
    },

    /**
     * Get the inner tile at a position
     */
    getTile(q, r) {
        if (q < 0 || q >= this.width || r < 0 || r >= this.height) return null;
        return this.tiles[r] ? this.tiles[r][q] : null;
    },

    /**
     * Get a summary of the inner map for display
     */
    getSummary() {
        if (!this.active || !this.tiles) return null;

        // Cache summary — only recount every 30 frames (~0.5s at 60fps)
        const now = performance.now();
        if (this._cachedSummary && (now - this._cachedSummaryTime) < 500) {
            return this._cachedSummary;
        }

        let totalTiles = 0;
        let exploredTiles = 0;
        let encounters = 0;
        let discoveredEncounters = 0;

        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                totalTiles++;
                if (this.tiles[r][q].explored) exploredTiles++;
                if (this.tiles[r][q].encounter) {
                    encounters++;
                    if (this.tiles[r][q].encounter.discovered) discoveredEncounters++;
                }
            }
        }

        this._cachedSummary = {
            exploredTiles,
            totalTiles,
            exploredPercent: Math.floor((exploredTiles / totalTiles) * 100),
            encounters,
            discoveredEncounters,
            parentTerrain: this.tiles[0][0].parentTerrain,
            worldTile: this.currentWorldTile
        };
        this._cachedSummaryTime = now;
        return this._cachedSummary;
    },

    /**
     * Serialize inner map cache for save/load
     */
    serialize() {
        return {
            cache: this._cache,
            discoveredEncounters: this._discoveredEncounters,
            timeCache: this._timeCache,
            // the day's one clock (ui/game/dayClock.js)
            clock: { timeOfDay: this.timeOfDay, acc: this._timeAccumulator }
        };
    },

    /**
     * Restore inner map cache from save data
     */
    deserialize(data) {
        if (data) {
            this._cache = data.cache || {};
            this._discoveredEncounters = data.discoveredEncounters || {};
            this._timeCache = data.timeCache || {};
            if (data.clock && Number.isFinite(data.clock.timeOfDay)) {
                this.timeOfDay = Math.min(23, data.clock.timeOfDay);
                this._timeAccumulator = Number(data.clock.acc) || 0;
                this.dayEnded = false;
            }

            // ── Migration: Fix stale baseTerrain on water/ice feature tiles ──
            // Old saves set baseTerrain='water' for brooks/streams/ponds etc.
            // Now those features inherit parent terrain + use overlays.
            const WATER_OVERLAY_IDS = new Set([
                'pond','shallow_water','murky_water','stream','river','pool',
                'waterfall','brook','mountain_stream','lagoon','lily_pads',
                'tide_pools','moss_bank','oasis_small','watering_hole','spring',
                'frozen_stream','frozen_pool','frozen_lake','ice_sheet',
                'glacier','thick_ice','ice_spire','ice_cave'
            ]);
            for (const key of Object.keys(this._cache)) {
                const tiles = this._cache[key];
                if (!tiles) continue;
                for (let r = 0; r < tiles.length; r++) {
                    for (let q = 0; q < (tiles[r] || []).length; q++) {
                        const tile = tiles[r][q];
                        if (tile && tile.subTerrain && WATER_OVERLAY_IDS.has(tile.subTerrain.id)) {
                            // Recalculate correct baseTerrain from parent
                            tile.baseTerrain = this._getBaseTerrain(tile.parentTerrain, null);
                        }
                    }
                }
            }
        }
    },

    /**
     * Clear all cached inner maps
     */
    clearCache() {
        this._cache = {};
        this._discoveredEncounters = {};
        this._timeCache = {};
    },

    // ══════════════════════════════════════════════
    // TIME SYSTEM — 1 real minute = 1 in-game hour
    // ══════════════════════════════════════════════
    /**
     * Update inner map time. Called every frame with deltaTime (seconds).
     * @returns {string|null} 'day_ended' if the day is over
     */
    updateTime(deltaTime) {
        if (!this.active || this.dayEnded) return null;

        this._timeAccumulator += deltaTime;
        if (this._timeAccumulator >= this.TIME_SCALE) {
            this._timeAccumulator -= this.TIME_SCALE;
            this.timeOfDay++;

            if (this.timeOfDay >= 24) {
                this.timeOfDay = 24;
                this.dayEnded = true;
                return 'day_ended';
            }
        }
        return null;
    },

    /**
     * Move the clock on by `hours` (fractions welcome: 0.25 is a quarter hour)
     * for work done in person. timeOfDay stays a whole hour and the minutes
     * go into the accumulator, as updateTime keeps them; it stops at 11:59 PM
     * so the day still ends through updateTime.
     */
    passHours(hours) {
        const h = Number(hours);
        if (!(h > 0)) return;
        const scale = this.TIME_SCALE || 60;
        const hour = Math.floor(Number(this.timeOfDay) || 0);
        const now = hour * 60 + (Number(this._timeAccumulator) || 0) / scale * 60 + (Number(this.timeOfDay) - hour) * 60;
        const next = Math.min(23 * 60 + 59, now + h * 60);
        this.timeOfDay = Math.floor(next / 60);
        this._timeAccumulator = (next - this.timeOfDay * 60) / 60 * scale;
    },

    /**
     * Get cached time info for a world tile (when not actively in inner map).
     * Returns { timeOfDay, timeString, period, periodIcon } or null.
     */
    getCachedTimeForTile(q, r) {
        const key = `${q},${r}`;
        const saved = this._timeCache[key];
        if (!saved) return null;
        const hour = saved.timeOfDay % 24;
        const acc = saved._timeAccumulator || 0;
        const minuteProgress = acc / this.TIME_SCALE;
        const minutes = Math.floor(minuteProgress * 60);
        const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
        let timeString;
        if (hour === 0) timeString = `12:${mm} AM`;
        else if (hour < 12) timeString = `${hour}:${mm} AM`;
        else if (hour === 12) timeString = `12:${mm} PM`;
        else timeString = `${hour - 12}:${mm} PM`;
        let period;
        if (hour >= 6 && hour < 10) period = 'morning';
        else if (hour >= 10 && hour < 14) period = 'midday';
        else if (hour >= 14 && hour < 18) period = 'afternoon';
        else if (hour >= 18 && hour < 21) period = 'evening';
        else period = 'night';
        const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌇', night: '🌙' };
        return { timeOfDay: saved.timeOfDay, timeString, period, periodIcon: periodIcons[period] || '🕐' };
    },

    /**
     * Get formatted time string (e.g. "3:00 PM")
     */
    getTimeString() {
        const hour = this.timeOfDay % 24;
        const minuteProgress = this._timeAccumulator / this.TIME_SCALE;
        const minutes = Math.floor(minuteProgress * 60);
        const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
        if (hour === 0) return `12:${mm} AM`;
        if (hour < 12) return `${hour}:${mm} AM`;
        if (hour === 12) return `12:${mm} PM`;
        return `${hour - 12}:${mm} PM`;
    },

    /**
     * Get time period for ambient effects
     */
    getTimePeriod() {
        const h = this.timeOfDay;
        if (h >= 6 && h < 10) return 'morning';
        if (h >= 10 && h < 14) return 'midday';
        if (h >= 14 && h < 18) return 'afternoon';
        if (h >= 18 && h < 21) return 'evening';
        return 'night';
    },

    /**
     * Get ambient overlay color based on time of day
     */
    getAmbientOverlay() {
        const h = this.timeOfDay;
        let base;
        if (h >= 6 && h < 8) base = 'rgba(255, 200, 100, 0.08)';       // Dawn
        else if (h >= 8 && h < 17) base = null;                        // Day — no overlay
        else if (h >= 17 && h < 19) base = 'rgba(255, 140, 50, 0.12)'; // Sunset
        else if (h >= 19 && h < 21) base = 'rgba(30, 20, 60, 0.25)';   // Dusk
        else base = 'rgba(10, 10, 40, 0.45)';                          // Night
        return base;
    },

    /**
     * Return an additional weather/temperature tint overlay colour,
     * layered on top of the time-of-day ambient overlay.
     */
    getWeatherOverlay() {
        const w = this.weather;
        if (!w) return null;
        switch (w.type) {
            case 'rain':    return 'rgba(40, 60, 90, ' + (0.08 + w.intensity * 0.10).toFixed(2) + ')';
            case 'storm':   return 'rgba(20, 20, 40, 0.22)';
            case 'snow':    return 'rgba(180, 200, 230, ' + (0.06 + w.intensity * 0.08).toFixed(2) + ')';
            case 'cloudy':  return 'rgba(60, 65, 75, ' + (0.04 + w.intensity * 0.06).toFixed(2) + ')';
            default:        return null;
        }
    },

    /**
     * Return a temperature-based tint (very subtle).
     */
    getTemperatureOverlay() {
        const t = this.temperature;
        if (!t) return null;
        if (t.value < 0.25) return 'rgba(100, 140, 200, 0.06)';   // Cold
        if (t.value > 0.78) return 'rgba(200, 130, 60, 0.05)';    // Hot
        return null;
    },
});
