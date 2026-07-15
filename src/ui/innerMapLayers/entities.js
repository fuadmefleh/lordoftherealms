// InnerMapRenderer — entities render layer methods (mixed in via Object.assign).
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomInteriors } from '../../world/customInteriors.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';

Object.assign(InnerMapRenderer, {
    // ══════════════════════════════════════════════
    // LAYER 6 — NPCs
    // ══════════════════════════════════════════════
    _renderNPCLayer(ctx, camera, deltaTime) {
        if (!InnerMap.npcs || InnerMap.npcs.length === 0) return;

        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const now = performance.now() / 1000;  // current time in seconds
        const charReady = InnerMapCharacters.isReady();

        for (const npc of InnerMap.npcs) {
            // Skip NPCs that are hidden inside a building (on outdoor map)
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            // Lazy preset assignment — runs once per NPC after characters are loaded
            if (charReady && !npc.preset) {
                npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id);
            }
            let worldX, worldY;
            let anim = 'idle';
            let direction = npc.facing != null ? npc.facing : InnerMapCharacters.DIR_DOWN;

            if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
                const target = npc.path[npc.pathIndex];
                const progress = npc.moveProgress;
                const fx = npc.q * T + T / 2, fy = npc.r * T + T / 2;
                const tx = target.q * T + T / 2, ty = target.r * T + T / 2;
                worldX = fx + (tx - fx) * progress;
                worldY = fy + (ty - fy) * progress;
                anim = 'walk';

                // Compute facing direction from movement
                const dq = target.q - npc.q;
                const dr = target.r - npc.r;
                direction = InnerMapCharacters.getDirection(dq, dr);
                npc.facing = direction;
            } else {
                worldX = npc.q * T + T / 2;
                worldY = npc.r * T + T / 2;
            }

            const screen = camera.worldToScreenFast(worldX, worldY);
            const screenX = screen.x;
            const screenY = screen.y;

            if (screenX < -ds * 2 || screenX > ctx.canvas.width + ds * 2) continue;
            if (screenY < -ds * 2 || screenY > ctx.canvas.height + ds * 2) continue;

            // Draw LPC character sprite if available
            const useSprite = charReady && npc.preset && InnerMapCharacters.getComposited(npc.preset);
            if (useSprite) {
                // Character sprite: 64×64 source drawn at 1.5 tiles high, centered on tile
                const charW = ds * 1.2;
                const charH = ds * 1.8;
                const charScale = npc.type === 'child' ? 0.7 : 1.0;
                const cw = charW * charScale;
                const ch = charH * charScale;
                const cx = screenX - cw / 2;
                const cy = screenY - ch + ds * 0.3;

                // Shadow
                ctx.beginPath();
                ctx.ellipse(screenX, screenY + ds * 0.15, cw * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();

                // Stagger animation time per NPC so they don't all step in sync
                const npcTime = now + npc.id * 0.37;
                InnerMapCharacters.drawCharacter(ctx, npc.preset, anim, direction, npcTime, cx, cy, cw, ch);
            } else {
                // Fallback: emoji icon (when sprites not loaded)
                ctx.beginPath();
                ctx.ellipse(screenX, screenY + ds * 0.25, ds * 0.12, ds * 0.05, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();

                const iconSize = Math.max(12, ds * 0.4);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(npc.icon, screenX, screenY);
            }

            // Name label
            if (camera.zoom > 0.7) {
                const fontSize = Math.max(6, 7 * camera.zoom);
                ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.shadowColor = 'rgba(0,0,0,0.7)';
                ctx.shadowBlur = 2;
                ctx.fillText(npc.name, screenX, screenY + ds * 0.3);
                ctx.shadowBlur = 0;
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 7 — PLAYER
    // ══════════════════════════════════════════════
    _renderPlayerLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const now = performance.now() / 1000;
        const charReady = InnerMapCharacters.isReady();
        const deathState = this._getDeathAnimState(now);

        // Get interpolated player position (smooth walking)
        const pos = InnerMap.getPlayerWorldPos();
        const screen = camera.worldToScreenFast(pos.x, pos.y);
        const screenPX = screen.x, screenPY = screen.y;

        // Determine animation and facing direction
        let anim = 'idle';
        let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;

        if (!deathState) {
            if (pos.walking) {
                anim = 'walk';
                direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
                this._playerFacing = direction;
            } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
                anim = InnerMap._activeInteraction.animKey || 'idle';
                direction = InnerMap.getDirectionToward(
                    InnerMap._activeInteraction.anchorQ,
                    InnerMap._activeInteraction.anchorR
                );
                this._playerFacing = direction;
            }
        }

        // Glow — turns red during death
        const glowR = deathState ? 200 : 245;
        const glowG = deathState ? 50 : 197;
        const glowB = deathState ? 50 : 66;
        const gradient = ctx.createRadialGradient(screenPX, screenPY, 0, screenPX, screenPY, ds * 0.5);
        gradient.addColorStop(0, `rgba(${glowR},${glowG},${glowB},0.3)`);
        gradient.addColorStop(1, `rgba(${glowR},${glowG},${glowB},0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenPX, screenPY, ds * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw player as LPC character if available
        const playerPreset = this._playerPreset || 'male_noble';

        if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
            const charW = ds * 1.2;
            const charH = ds * 1.8;

            if (deathState) {
                // ── Death animation: rotate character to fall over ──
                ctx.save();
                // Pivot at the character's feet
                ctx.translate(screenPX, screenPY + ds * 0.15);
                ctx.rotate(deathState.rotation);

                // Shadow — elongates as character falls
                const shadowStretch = 1 + deathState.rotation / (Math.PI / 2) * 2;
                ctx.beginPath();
                ctx.ellipse(0, 0, charW * 0.2 * shadowStretch, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();

                // Draw the character rotated (idle frame, facing down)
                const cx = -charW / 2;
                const cy = -charH + ds * 0.15;
                InnerMapCharacters.drawCharacter(ctx, playerPreset, 'idle', direction, 0,
                    cx, cy, charW, charH);

                // Red death tint overlay on the character
                if (deathState.tint > 0) {
                    ctx.globalAlpha = deathState.tint;
                    ctx.fillStyle = 'rgba(139, 0, 0, 0.5)';
                    ctx.fillRect(cx, cy, charW, charH);
                    ctx.globalAlpha = 1;
                }

                ctx.restore();

                // Dead plumbob (red, no bob)
                this._drawDeadPlumbob(ctx, screenPX, screenPY - charH + ds * 0.1, ds);
            } else {
                const cx = screenPX - charW / 2;
                const cy = screenPY - charH + ds * 0.3;

                // Shadow
                ctx.beginPath();
                ctx.ellipse(screenPX, screenPY + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();

                InnerMapCharacters.drawCharacter(ctx, playerPreset, anim, direction, now,
                    cx, cy, charW, charH);

                // ── Plumbob (green diamond above player's head) ──
                this._drawPlumbob(ctx, screenPX, cy - ds * 0.05, ds, now);
            }
        } else {
            // Fallback: compass icon (or skull if dead)
            const iconSize = Math.max(16, ds * 0.55);
            ctx.font = `${iconSize}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(deathState ? '💀' : '🧭', screenPX, screenPY);
            ctx.shadowBlur = 0;

            if (deathState) {
                this._drawDeadPlumbob(ctx, screenPX, screenPY - ds * 0.5, ds);
            } else {
                this._drawPlumbob(ctx, screenPX, screenPY - ds * 0.5, ds, now);
            }
        }

        // Label
        if (camera.zoom > 0.5) {
            const fontSize = Math.max(8, 10 * camera.zoom);
            ctx.font = `700 ${fontSize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = deathState ? '#a33' : '#f5c542';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(deathState ? 'Dead' : 'You', screenPX, screenPY + ds * 0.35);
            ctx.shadowBlur = 0;
        }
    },

    /**
     * Draw a Sims-style plumbob (green diamond) floating above the player.
     * Gently bobs up and down and pulses glow.
     */
    _drawPlumbob(ctx, x, topY, ds, now) {
        const size = Math.max(6, ds * 0.22);
        // gentle bob
        const bob = Math.sin(now * 2.5) * size * 0.25;
        const cy = topY + bob;

        ctx.save();

        // glow
        const glowAlpha = 0.25 + Math.sin(now * 3) * 0.1;
        ctx.shadowColor = `rgba(46, 204, 113, ${glowAlpha + 0.3})`;
        ctx.shadowBlur = size * 1.2;

        // diamond shape
        ctx.beginPath();
        ctx.moveTo(x, cy - size);          // top
        ctx.lineTo(x + size * 0.6, cy);    // right
        ctx.lineTo(x, cy + size);          // bottom
        ctx.lineTo(x - size * 0.6, cy);    // left
        ctx.closePath();

        // gradient fill
        const grad = ctx.createLinearGradient(x, cy - size, x, cy + size);
        grad.addColorStop(0, '#5dfc8a');
        grad.addColorStop(0.45, '#2ecc71');
        grad.addColorStop(1, '#1a9c52');
        ctx.fillStyle = grad;
        ctx.fill();

        // highlight edge
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // inner shine line (top-left facet)
        ctx.beginPath();
        ctx.moveTo(x, cy - size * 0.7);
        ctx.lineTo(x - size * 0.3, cy);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.restore();
    },

    /**
     * Draw a red "dead" plumbob — static, no bob.
     */
    _drawDeadPlumbob(ctx, x, topY, ds) {
        const size = Math.max(6, ds * 0.22);
        ctx.save();
        ctx.shadowColor = 'rgba(200, 30, 30, 0.6)';
        ctx.shadowBlur = size * 1.5;

        ctx.beginPath();
        ctx.moveTo(x, topY - size);
        ctx.lineTo(x + size * 0.6, topY);
        ctx.lineTo(x, topY + size);
        ctx.lineTo(x - size * 0.6, topY);
        ctx.closePath();

        const grad = ctx.createLinearGradient(x, topY - size, x, topY + size);
        grad.addColorStop(0, '#ff4444');
        grad.addColorStop(0.45, '#cc2222');
        grad.addColorStop(1, '#881111');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    },

    // ══════════════════════════════════════════════
    // GROUND OVERLAYS — flat water / ice / waterfall tints
    // Drawn BEFORE the depth-sorted pass so they sit on the ground.
    // ══════════════════════════════════════════════
    _renderGroundOverlays(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute origin
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            const dy0 = originY + (r - rMin) * ds;
            const dyFloor = Math.floor(dy0);
            const sz = Math.ceil(ds) + 1;

            if (dyFloor + sz < 0 || dyFloor > canvasH) continue;

            for (let q = qMin; q <= qMax; q++) {
                const tile = row[q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building || tile.customObjectPart || tile.customObject) continue;

                const o = this._getObjectOverlay(tile);
                if (!o) continue;
                if (o.type !== 'water_overlay' && o.type !== 'ice_overlay' && o.type !== 'waterfall') continue;

                const dx = Math.floor(originX + (q - qMin) * ds);
                const dy = dyFloor;

                if (dx + sz < 0 || dx > canvasW) continue;

                if (o.type === 'water_overlay' || o.type === 'ice_overlay') {
                    ctx.fillStyle = o.tint;
                    ctx.fillRect(dx, dy, sz, sz);
                    if (o.type === 'water_overlay' && this._sheets.has('water_ripple')) {
                        const rippleSheet = this._sheets.get('water_ripple');
                        const hash = (Math.abs((q * 73856093 ^ r * 19349663))) >>> 0;
                        const frame = hash % 4;
                        ctx.globalAlpha = 0.6;
                        ctx.drawImage(rippleSheet, frame * 32, 0, 32, 32, dx, dy, sz, sz);
                        ctx.globalAlpha = 1.0;
                    }
                } else { // waterfall
                    const sheet = this._sheets.get(o.sheet);
                    if (sheet) {
                        const scale = ds / o.sw;
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy + ds - o.sh * scale, ds, o.sh * scale);
                    } else {
                        ctx.fillStyle = 'rgba(42,133,152,0.55)';
                        ctx.fillRect(dx, dy, sz, sz);
                    }
                }
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────
    // Helper: return the tile array for a custom object based on its
    // current health percentage (supports healthStates damage stages).
    // Falls back to def.tiles when no health states are defined.
    // ─────────────────────────────────────────────────────────────────
    /**
     * Flatten an objLayers structure { base:[], detail:[], top:[] } into
     * a single draw-order array (base first, then detail, then top).
     * Returns null if layerObj is empty/missing.
     */
    _flattenObjLayers(layerObj) {
        if (!layerObj) return null;
        const out = [];
        for (const ln of ['base', 'detail', 'top']) {
            const arr = layerObj[ln];
            if (Array.isArray(arr)) for (const t of arr) out.push(t);
        }
        return out.length > 0 ? out : null;
    },

    _getActiveObjectTiles(def, customObjData) {
        // Color variants — use variant's tiles/rotations/seasons instead of base def
        if (def.colorVariants && def.colorVariants.length > 0 && customObjData) {
            const cvIdx = customObjData.colorVariantIdx || 0;
            if (cvIdx > 0 && cvIdx <= def.colorVariants.length) {
                const cv = def.colorVariants[cvIdx - 1];
                // Build a temporary def overlay with the color variant's data
                def = {
                    ...def,
                    tiles: cv.tiles || def.tiles,
                    objLayers: cv.objLayers || def.objLayers,
                    rotationVariants: cv.rotationVariants || [],
                    seasonVariants: cv.seasonVariants || null,
                };
            }
        }
        const hPct = (customObjData && customObjData.currentHealthPct != null)
            ? customObjData.currentHealthPct
            : 100;
        // Health states take priority (damage stages override everything)
        const states = def.healthStates;
        if (states && states.length > 0) {
            let best = states[0];
            for (const hs of states) {
                if (hPct >= hs.minHealthPct && hs.minHealthPct >= best.minHealthPct) {
                    best = hs;
                }
            }
            if (best) {
                const layered = this._flattenObjLayers(best.objLayers);
                if (layered) return layered;
                if (best.tiles && best.tiles.length > 0) return best.tiles;
            }
        }
        // Growth stages — age-based appearance (computed from days elapsed since planting)
        if (def.growthStates && def.growthStates.length > 0) {
            const worldDay = (typeof InnerMap !== 'undefined' ? (InnerMap.worldDay || 0) : 0);
            const dayPlanted = (customObjData && customObjData.growthDayPlanted != null)
                ? customObjData.growthDayPlanted : worldDay;
            const daysElapsed = worldDay - dayPlanted;
            // Pick the last stage where daysToReach <= daysElapsed
            let activeStage = def.growthStates[0];
            for (const gs of def.growthStates) {
                if (daysElapsed >= gs.daysToReach) activeStage = gs;
            }
            if (activeStage) {
                const layered = this._flattenObjLayers(activeStage.objLayers);
                if (layered) return layered;
                if (activeStage.tiles && activeStage.tiles.length > 0) return activeStage.tiles;
            }
        }
        // Season variants — healthy appearance per season
        if (def.seasonVariants) {
            const season = (typeof InnerMap !== 'undefined' ? (InnerMap.season || 'Summer') : 'Summer');
            const sv = def.seasonVariants[season.toLowerCase()];
            if (sv && sv.length > 0) return sv;
        }
        // Rotation variants — user-facing rotation states (cycled with R key)
        if (def.rotationVariants && def.rotationVariants.length > 0 && customObjData) {
            const idx = customObjData.rotationIdx || 0;
            if (idx > 0 && idx <= def.rotationVariants.length) {
                const rv = def.rotationVariants[idx - 1];
                if (rv) {
                    const layered = this._flattenObjLayers(rv.objLayers);
                    if (layered) return layered;
                    if (rv.tiles && rv.tiles.length > 0) return rv.tiles;
                }
            }
            // idx 0 = default tiles (fall through)
        }
        // Default: prefer objLayers over merged tiles
        const layered = this._flattenObjLayers(def.objLayers);
        if (layered) return layered;
        return def.tiles;
    },

    // ══════════════════════════════════════════════════════════════════
    // DEPTH-SORTED SPRITES
    // Merges objects, buildings (legacy + custom), NPCs, and the player
    // into one Y-sorted pass so characters walk behind / in front of
    // tall scenery based on their relative Y position.
    // ══════════════════════════════════════════════════════════════════
    _renderDepthSortedSprites(ctx, camera, deltaTime) {
        const T    = this.TILE_SIZE;
        const ds   = T * camera.zoom;
        const cs   = Math.ceil(ds) + 1;  // integer tile size — eliminates sub-pixel seams
        const now  = performance.now() / 1000;
        const charReady = typeof InnerMapCharacters !== 'undefined' && InnerMapCharacters.isReady();
        const self = this;
        const items = []; // { sortY, draw() }
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute origin screen position for incremental tile positioning
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        // ── Phase 1: Collect objects (trees, plants, rocks, custom objects) ──────
        for (let r = rMin; r <= rMax; r++) {
            for (let q = qMin; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building) continue;
                if (tile.customObjectPart) continue;

                // Custom editor objects (anchor tile)
                // Whole object sorted by origin row — if origin is below
                // another sprite's origin, the entire object draws on top.
                if (tile.customObject && typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
                    const def = CustomObjects.getDef(tile.customObject.defId);
                    if (def) {
                        const singleImg = def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null;
                        // For single-sheet objects, skip if image missing; for multi-sheet, check per-tile
                        if (def.sheetPath && (!singleImg || !singleImg.complete)) { continue; }
                        // Sort by origin row (bottom of anchor tile) so objects
                        // whose origin is lower draw entirely in front.
                        const sortY = (r + 1) * T;
                        const sortH = def.bounds
                            ? (def.bounds.maxRow - def.bounds.minRow + 1) : 1;
                        const sortX = q;
                        const oq = q, or2 = r;
                        const customObjRef = tile.customObject;  // capture for health-state lookup

                        // Check if this object is being interacted with
                        const ia = InnerMap._activeInteraction;
                        const isInteracting = ia && !ia.done && ia.anchorQ === q && ia.anchorR === r;

                        items.push({ sortY, zLayer: 1, sortH, sortX, draw() {
                            // Apply shake and fade if being interacted with
                            let shakeX = 0, shakeY = 0, alpha = 1.0;
                            if (isInteracting) {
                                if (ia.fading) {
                                    // Fade phase: shake intensifies + fade out
                                    const fadeProgress = Math.min(1, ia.swingTimer / ia.fadeDuration);
                                    alpha = Math.max(0, 1.0 - fadeProgress);
                                    const intensity = 4 + fadeProgress * 6;
                                    shakeX = Math.sin(ia.swingTimer * 45) * intensity;
                                    shakeY = Math.cos(ia.swingTimer * 35) * intensity * 0.3;
                                } else {
                                    // Swing phase: shake builds within each 0.5s interval then resets
                                    const swingProgress = ia.swingTimer / ia.swingInterval;
                                    const intensity = 1 + swingProgress * 3;
                                    shakeX = Math.sin(ia.swingTimer * 30) * intensity;
                                    shakeY = Math.cos(ia.swingTimer * 25) * intensity * 0.2;
                                }
                                if (alpha < 1.0) ctx.globalAlpha = alpha;
                            }

                            // Anchor-relative positioning: compute anchor once,
                            // offset each tile by integer cs to prevent sub-pixel seams
                            const anchorScreen = camera.worldToScreenFast(oq * T, or2 * T);
                            const ax = Math.floor(anchorScreen.x);
                            const ay = Math.floor(anchorScreen.y);

                            // Resolve tile set based on current health (supports damage stages)
                            const activeTiles = self._getActiveObjectTiles(def, customObjRef);
                            for (const td of activeTiles) {
                                const img = td.sheetPath ? CustomObjects.getImage(td.sheetPath) : singleImg;
                                if (!img || !img.complete) continue;
                                const tdx = ax + td.localCol * cs + shakeX;
                                const tdy = ay + td.localRow * cs + shakeY;
                                if (tdx + cs < 0 || tdx > ctx.canvas.width + cs) continue;
                                if (tdy + cs < 0 || tdy > ctx.canvas.height + cs) continue;
                                ctx.drawImage(img, td.sx, td.sy, td.sw, td.sh, tdx, tdy, cs, cs);
                            }

                            if (isInteracting && alpha < 1.0) ctx.globalAlpha = 1.0;
                            // ── Object health bar (shown when object has taken damage) ──
                            if (typeof InnerMapCombat !== 'undefined' && customObjRef.currentHealthPct != null && customObjRef.currentHealthPct < 100) {
                                InnerMapCombat.renderObjectHealthBar(ctx, camera, oq, or2, customObjRef.currentHealthPct);
                            }
                        }});
                    }
                    continue;
                }

                // ── Ground items (placed from hotbar) ──
                if (tile.groundItem) {
                    const gq = q, gr = r;
                    const gIcon = tile.groundItem.icon || '📦';
                    const sortY = (r + 0.5) * T; // slightly above ground
                    items.push({ sortY, zLayer: 0, sortX: q, draw() {
                        const screen = camera.worldToScreenFast(gq * T, gr * T);
                        const dx = Math.floor(screen.x);
                        const dy = Math.floor(screen.y);
                        // Draw a subtle shadow ellipse under the item
                        const cx = dx + cs / 2;
                        const cy = dy + cs * 0.6;
                        const rad = cs * 0.28;
                        ctx.save();
                        ctx.globalAlpha = 0.35;
                        ctx.fillStyle = '#000';
                        ctx.beginPath();
                        ctx.ellipse(cx, cy, rad, rad * 0.5, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                        // Draw the item icon
                        const sz = Math.max(12, cs * 0.55);
                        ctx.font = `${sz}px serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(gIcon, cx, dy + cs * 0.45);
                    }});
                }

                // Never render built-in object overlays (editor-authored objects only)
                continue;

                const sheet = this._sheets.get(o.sheet);
                if (!sheet) continue;

                const screen = camera.worldToScreen(q * T, r * T);
                const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                if (dx + ds * 3 < 0 || dx > ctx.canvas.width + ds) continue;
                if (dy + ds * 3 < 0 || dy > ctx.canvas.height + ds) continue;

                const tileSpan = o.type === 'rock' ? 2 : 1;
                const sortY = (r + tileSpan) * T;

                items.push({ sortY, zLayer: 1, draw() {
                    if (o.type === 'tree') {
                        const scale = ds / o.sw;
                        const ow = ds, oh = o.sh * scale;
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy + ds - oh, ow, oh);
                    } else if (o.type === 'plant' || o.type === 'flower' || o.type === 'mushroom') {
                        const ratio = 0.6;
                        const ow = ds * ratio, oh = ds * ratio;
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx + (ds - ow) / 2, dy + (ds - oh) / 2, ow, oh);
                    } else if (o.type === 'rock') {
                        const tilesW = o.sw / 32, tilesH = o.sh / 32;
                        const ow = ds * tilesW, oh = ds * tilesH;
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx + (ds - ow) / 2, dy + ds - oh, ow, oh);
                    } else {
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy, ds, ds);
                    }
                }});
            }
        }

        // ── Phase 2: Collect buildings (legacy + custom) ────────────────────────
        for (let r = rMin; r <= rMax; r++) {
            for (let q = qMin; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible) continue;

                if (tile.building) {
                    const screen = camera.worldToScreenFast(q * T, r * T);
                    const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                    if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                    if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                    const sortY = (r + 1) * T;
                    const bq = q, br = r;
                    items.push({ sortY, zLayer: 1, sortH: 3, sortX: q, draw() {
                        const isUnder = tile._propertyRef && tile._propertyRef.underConstruction;
                        if (isUnder) ctx.globalAlpha = 0.45;
                        self._drawLPCBuilding(ctx, tile.building, dx, dy, ds);
                        if (isUnder) {
                            ctx.globalAlpha = 1.0;
                            const sz = Math.max(14, ds * 0.35);
                            ctx.font = `${sz}px serif`;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText('🔨', dx + ds / 2, dy + ds / 2);
                        }
                        const bldg = tile.buildingInfo;
                        if (bldg && camera.zoom > 0.4) {
                            self._drawBuildingLabel(ctx, camera, bldg, bq, br);
                        }
                    }});
                }

                if (tile.customBuilding && typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded()) {
                    const def = CustomBuildings.getBuilding(tile.customBuilding.defId);
                    if (def) {
                        const screen = camera.worldToScreenFast(q * T, r * T);
                        const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                        if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                        if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                        // Sort by origin row so the whole building draws
                        // in front of / behind other sprites based on origin Y
                        const sortY = (r + 1) * T;
                        const bldgH = def.bounds
                            ? (def.bounds.maxRow - def.bounds.minRow + 1) : 3;
                        const cq = q, cr = r;
                        items.push({ sortY, zLayer: 1, sortH: bldgH, sortX: q, draw() {
                            self._drawCustomBuilding(ctx, camera, def, cq, cr, ds);
                        }});
                    }
                }
            }
        }

        // ── Phase 3: Collect NPCs ───────────────────────────────────────────────
        if (InnerMap.npcs && InnerMap.npcs.length > 0) {
            for (const npc of InnerMap.npcs) {
                // Skip NPCs that are hidden inside a building (on outdoor map)
                if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
                if (charReady && !npc.preset) {
                    npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id);
                }
                let worldX, worldY;
                let anim = 'idle';
                let direction = npc.facing != null ? npc.facing : InnerMapCharacters.DIR_DOWN;

                if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
                    const target = npc.path[npc.pathIndex];
                    const progress = npc.moveProgress;
                    const fx = npc.q * T + T / 2, fy = npc.r * T + T / 2;
                    const tx = target.q * T + T / 2, ty = target.r * T + T / 2;
                    worldX = fx + (tx - fx) * progress;
                    worldY = fy + (ty - fy) * progress;
                    anim = 'walk';
                    const dq = target.q - npc.q;
                    const dr = target.r - npc.r;
                    direction = InnerMapCharacters.getDirection(dq, dr);
                    npc.facing = direction;
                } else {
                    worldX = npc.q * T + T / 2;
                    worldY = npc.r * T + T / 2;
                }

                const screen = camera.worldToScreenFast(worldX, worldY);
                const sx = screen.x, sy = screen.y;
                if (sx < -ds * 2 || sx > ctx.canvas.width + ds * 2) continue;
                if (sy < -ds * 2 || sy > ctx.canvas.height + ds * 2) continue;

                const sortY = worldY + T / 2;   // bottom-of-tile for consistent depth sort
                const nRef = npc, nAnim = anim, nDir = direction;

                items.push({ sortY, zLayer: 2, draw() {
                    const useSprite = charReady && nRef.preset && InnerMapCharacters.getComposited(nRef.preset);
                    if (useSprite) {
                        const charW = ds * 1.2, charH = ds * 1.8;
                        const charScale = nRef.type === 'child' ? 0.7 : 1.0;
                        const cw = charW * charScale, ch = charH * charScale;
                        const cx = sx - cw / 2, cy = sy - ch + ds * 0.3;
                        ctx.beginPath();
                        ctx.ellipse(sx, sy + ds * 0.15, cw * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.25)';
                        ctx.fill();
                        const npcTime = now + nRef.id * 0.37;
                        InnerMapCharacters.drawCharacter(ctx, nRef.preset, nAnim, nDir, npcTime, cx, cy, cw, ch);
                    } else {
                        ctx.beginPath();
                        ctx.ellipse(sx, sy + ds * 0.25, ds * 0.12, ds * 0.05, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fill();
                        const iconSize = Math.max(12, ds * 0.4);
                        ctx.font = `${iconSize}px serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(nRef.icon, sx, sy);
                    }
                    if (camera.zoom > 0.7) {
                        const fontSize = Math.max(6, 7 * camera.zoom);
                        ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillStyle = 'rgba(255,255,255,0.7)';
                        ctx.shadowColor = 'rgba(0,0,0,0.7)';
                        ctx.shadowBlur = 2;
                        ctx.fillText(nRef.name, sx, sy + ds * 0.3);
                        ctx.shadowBlur = 0;
                    }
                    // ── Health bar (only shown when NPC has taken damage) ──
                    if (typeof InnerMapCombat !== 'undefined') {
                        const nHealth = InnerMapCombat.getNPCHealth(nRef.id);
                        if (nHealth) {
                            const charScale = nRef.type === 'child' ? 0.7 : 1.0;
                            const charH = ds * 1.8 * charScale;
                            InnerMapCombat.renderHealthBar(ctx, camera, worldX, worldY, nHealth.current, nHealth.max, charH);
                        }
                    }
                }});
            }
        }

        // ── Phase 4: Collect Player ─────────────────────────────────────────────
        {
            const pos = InnerMap.getPlayerWorldPos();
            const screen = camera.worldToScreenFast(pos.x, pos.y);
            const deathState = this._getDeathAnimState(now);
            let anim = 'idle';
            let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;
            if (!deathState) {
                if (pos.walking) {
                    anim = 'walk';
                    direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
                    this._playerFacing = direction;
                } else if (typeof InnerMapCombat !== 'undefined' && InnerMapCombat._attackState) {
                    anim = 'slash';
                    const ia = InnerMapCombat._attackState;
                    if (ia.targetType === 'npc' && ia.npc) {
                        const dq = ia.npc.q - InnerMap.playerInnerQ;
                        const dr = ia.npc.r - InnerMap.playerInnerR;
                        direction = InnerMapCharacters.getDirection(dq, dr);
                    } else if (ia.targetType === 'object') {
                        direction = InnerMap.getDirectionToward(ia.targetQ, ia.targetR);
                    }
                    this._playerFacing = direction;
                } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
                    anim = InnerMap._activeInteraction.animKey || 'slash';
                    direction = InnerMap.getDirectionToward(
                        InnerMap._activeInteraction.anchorQ,
                        InnerMap._activeInteraction.anchorR
                    );
                    this._playerFacing = direction;
                }
            }
            const sortY = pos.y + T / 2;
            const px = screen.x, py = screen.y;
            const pAnim = anim, pDir = direction;
            const playerPreset = this._playerPreset || 'male_noble';
            const pDeathState = deathState; // capture for closure

            items.push({ sortY, zLayer: 2, draw: () => {
                // Glow — turns red during death
                const glR = pDeathState ? 200 : 245, glG = pDeathState ? 50 : 197, glB = pDeathState ? 50 : 66;
                const gradient = ctx.createRadialGradient(px, py, 0, px, py, ds * 0.5);
                gradient.addColorStop(0, `rgba(${glR},${glG},${glB},0.3)`);
                gradient.addColorStop(1, `rgba(${glR},${glG},${glB},0)`);
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(px, py, ds * 0.5, 0, Math.PI * 2);
                ctx.fill();

                if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
                    const charW = ds * 1.2, charH = ds * 1.8;

                    if (pDeathState) {
                        // Death: rotate character to fall over
                        ctx.save();
                        ctx.translate(px, py + ds * 0.15);
                        ctx.rotate(pDeathState.rotation);
                        const shadowStretch = 1 + pDeathState.rotation / (Math.PI / 2) * 2;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, charW * 0.2 * shadowStretch, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fill();
                        const cx = -charW / 2, cy = -charH + ds * 0.15;
                        InnerMapCharacters.drawCharacter(ctx, playerPreset, 'idle', pDir, 0, cx, cy, charW, charH);
                        if (pDeathState.tint > 0) {
                            ctx.globalAlpha = pDeathState.tint;
                            ctx.fillStyle = 'rgba(139, 0, 0, 0.5)';
                            ctx.fillRect(cx, cy, charW, charH);
                            ctx.globalAlpha = 1;
                        }
                        ctx.restore();
                        this._drawDeadPlumbob(ctx, px, py - charH + ds * 0.1, ds);
                    } else {
                        const cx = px - charW / 2, cy = py - charH + ds * 0.3;
                        ctx.beginPath();
                        ctx.ellipse(px, py + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.25)';
                        ctx.fill();
                        InnerMapCharacters.drawCharacter(ctx, playerPreset, pAnim, pDir, now, cx, cy, charW, charH);
                    }
                } else {
                    const iconSize = Math.max(16, ds * 0.55);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(pDeathState ? '💀' : '🧭', px, py);
                    ctx.shadowBlur = 0;
                }
                if (camera.zoom > 0.5) {
                    const fontSize = Math.max(8, 10 * camera.zoom);
                    ctx.font = `700 ${fontSize}px 'Inter', sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = pDeathState ? '#a33' : '#f5c542';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.fillText(pDeathState ? 'Dead' : 'You', px, py + ds * 0.35);
                    ctx.shadowBlur = 0;
                }
            }});
        }

        // ── Phase 5: Sort by Y and draw ─────────────────────────────────────────
        // Primary: Y position (bottom of origin row)
        // Then: zLayer (objects=1 < characters=2)
        // Then: smaller height on top (drawn later)
        // Then: rightmost X on top (drawn later)
        items.sort((a, b) =>
            (a.sortY - b.sortY)
            || (a.zLayer - b.zLayer)
            || ((b.sortH || 0) - (a.sortH || 0))
            || ((a.sortX || 0) - (b.sortX || 0))
        );
        for (const item of items) item.draw();

        // ── Phase 6: Combat overlays (hit flashes + floating damage numbers) ──
        // Always rendered on top of all sprites.
        if (typeof InnerMapCombat !== 'undefined') {
            InnerMapCombat.render(ctx, camera);
        }
    },
});
