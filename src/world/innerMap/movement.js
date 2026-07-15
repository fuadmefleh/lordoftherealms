// InnerMap — movement members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
    /**
     * Move player within the inner map
     * @returns {{ moved: boolean, encounter: Object|null }}
     */
    movePlayer(dq, dr) {
        // Cancel any animated walk in progress
        this.cancelPlayerWalk();

        const newQ = this.playerInnerQ + dq;
        const newR = this.playerInnerR + dr;

        // Bounds check
        if (newQ < 0 || newQ >= this.width || newR < 0 || newR >= this.height) {
            return { moved: false, encounter: null, outOfBounds: true };
        }

        const tile = this.tiles[newR][newQ];
        if (!tile.subTerrain.passable) {
            return { moved: false, encounter: null, outOfBounds: false };
        }

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

        const tile = this.tiles[targetR][targetQ];
        if (!tile.subTerrain.passable) {
            return { started: false, moved: false, encounter: null, outOfBounds: false };
        }

        // A* pathfinding
        const path = this._findPath(this.playerInnerQ, this.playerInnerR, targetQ, targetR);
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
        const str    = (player && player.strength) || 5;
        const luck   = (player && player.luck)     || 5;
        const base   = str * 3 + luck * 0.5 + 3;         // base %
        const resist = def && def.resistance != null ? Math.min(def.resistance, 95) : 0;
        return base * (1 - resist / 100);
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
                this._removeCustomObject(ia.anchorQ, ia.anchorR);
                const result = { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource };
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
                ia.fading = true;
                ia.swingTimer = 0;
            }
            return { hit: true, damage: Math.round(dmg), healthPct: hp };
        }

        return null; // still animating between swings
    },

    /**
     * Remove a custom object (anchor + all footprint tiles).
     * If the definition specifies a `spawnAfter` object ID, that object
     * is automatically placed at the origin tile after removal (e.g. a
     * stump spawning after a tree is harvested).
     */
    _removeCustomObject(anchorQ, anchorR) {
        const anchorTile = this.getTile(anchorQ, anchorR);
        if (!anchorTile || !anchorTile.customObject) return;

        const defId = anchorTile.customObject.defId;
        const def = (typeof CustomObjects !== 'undefined') ? CustomObjects.getDef(defId) : null;

        // Clear footprint tiles and restore passability for all tiles (including anchor)
        if (def && def.tiles) {
            for (const td of def.tiles) {
                const fq = anchorQ + td.localCol;
                const fr = anchorR + td.localRow;
                const ft = this.getTile(fq, fr);
                if (!ft) continue;
                const isAnchor = td.localCol === 0 && td.localRow === 0;
                if (isAnchor) {
                    // Anchor tile: restore passability if object made it impassable
                    if (td.impassable) ft.subTerrain.passable = true;
                } else if (ft.customObjectPart &&
                           ft.customObjectPart.anchorQ === anchorQ &&
                           ft.customObjectPart.anchorR === anchorR) {
                    delete ft.customObjectPart;
                    if (td.impassable) ft.subTerrain.passable = true;
                }
            }
        }

        // Clear anchor
        delete anchorTile.customObject;

        // ── spawnAfter: place a replacement object at the origin tile ──
        if (def && def.spawnAfter) {
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

        this._playerMoveProgress += deltaTime * this._playerSpeed;

        if (this._playerMoveProgress >= 1.0) {
            this._playerMoveProgress = 0;

            // Advance to the next step
            const step = this._playerPath[this._playerPathIndex];

            // Defensive: never step onto impassable tile
            const stepTile = this.tiles[step.r] && this.tiles[step.r][step.q];
            if (!stepTile || !stepTile.subTerrain.passable) {
                this.cancelPlayerWalk();
                return { moved: false, encounter: null, blocked: true };
            }

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
     * Simple A* pathfinding for the inner map (binary-heap based)
     */
    _findPath(startQ, startR, endQ, endR) {
        const W = this.width, H = this.height;
        const tiles = this.tiles;
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
            const ng = gScore[ci] + 1;

            for (let d = 0; d < 4; d++) {
                const nq = cq + dq[d];
                const nr = cr + dr[d];
                if (nq < 0 || nq >= W || nr < 0 || nr >= H) continue;
                const ni = idx(nq, nr);
                if (inClosed[ni]) continue;
                const tile = tiles[nr][nq];
                if (!tile.subTerrain.passable) continue;

                if (ng < gScore[ni]) {
                    gScore[ni] = ng;
                    parentQ[ni] = cq;
                    parentR[ni] = cr;
                    push(ng + heuristic(nq, nr), ni, nq, nr);
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
            timeCache: this._timeCache
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
