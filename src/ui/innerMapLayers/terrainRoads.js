// InnerMapRenderer — terrainRoads render layer methods (mixed in via Object.assign).
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomInteriors } from '../../world/customInteriors.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';

Object.assign(InnerMapRenderer, {
    // ── Death animation state ──
    _deathAnim: null,

    // { startTime, duration, callback, phase: 'falling'|'dead' }
    /**
     * Start a death animation — character falls over and lies on the ground.
     * @param {Function} callback — called when the animation finishes (~2s)
     */
    startDeathAnimation(callback) {
        this._deathAnim = {
            startTime: performance.now() / 1000,
            fallDuration: 0.8,      // seconds to fall over
            holdDuration: 1.2,      // seconds to hold on ground before callback
            callback,
            fired: false,
        };
    },

    /** Clear death animation state (e.g., after heir succession). */
    clearDeathAnimation() {
        this._deathAnim = null;
    },

    /**
     * Internal: compute death animation progress.
     * Returns { active, rotation, alpha, tint, done } or null.
     */
    _getDeathAnimState(now) {
        const da = this._deathAnim;
        if (!da) return null;
        const elapsed = now - da.startTime;
        const totalDuration = da.fallDuration + da.holdDuration;

        if (elapsed < da.fallDuration) {
            // Falling phase — ease-out rotation 0 → π/2
            const t = elapsed / da.fallDuration;
            const eased = 1 - (1 - t) * (1 - t); // ease-out quadratic
            return { active: true, rotation: eased * (Math.PI / 2), alpha: 1, tint: t * 0.4, done: false };
        }

        // On the ground
        if (!da.fired && elapsed >= totalDuration) {
            da.fired = true;
            if (da.callback) da.callback();
        }
        return { active: true, rotation: Math.PI / 2, alpha: 1, tint: 0.4, done: elapsed >= totalDuration };
    },

    // ── Viewport culling helper: compute visible tile range from camera ──
    _getVisibleTileRange(camera) {
        const T = this.TILE_SIZE;
        const bounds = camera.getVisibleBounds();
        return {
            qMin: Math.max(0, Math.floor(bounds.left / T) - 1),
            qMax: Math.min(InnerMap.width - 1, Math.ceil(bounds.right / T) + 1),
            rMin: Math.max(0, Math.floor(bounds.top / T) - 1),
            rMax: Math.min(InnerMap.height - 1, Math.ceil(bounds.bottom / T) + 1),
        };
    },

    // ══════════════════════════════════════════════
    // LAYER 0 — TERRAIN
    // Draws ground fill tiles only. No objects, no buildings.
    // ══════════════════════════════════════════════
    _renderTerrainLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const terrainKey = this._seasonKey('terrain');
        const terrainSheet = this._sheets.get(terrainKey);
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute row base screen Y and column base X to avoid per-tile worldToScreen calls
        // For the inner map, worldPixelWidth is 0 (no wrapping), so we can simplify:
        //   screenX = cx + (q*T - camX) * zoom
        //   screenY = cy + (r*T - camY) * zoom
        // We compute the screen position of (qMin*T, rMin*T) once
        // and increment by ds for each column/row.
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        // Collect grid rects to batch-draw after all terrain fills
        const gridVisible = [];   // [dx, dy, sz] rects for visible tiles
        const gridDim     = [];   // [dx, dy, sz] rects for explored-but-not-visible tiles

        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            const dy0 = originY + (r - rMin) * ds;
            const dyFloor = Math.floor(dy0);

            // Quick row-level Y culling
            const sz = Math.ceil(ds) + 1;
            if (dyFloor + sz < 0 || dyFloor > canvasH) continue;

            for (let q = qMin; q <= qMax; q++) {
                const dx0 = originX + (q - qMin) * ds;
                const dx = Math.floor(dx0);

                // Culling
                if (dx + sz < 0 || dx > canvasW) continue;

                const tile = row[q];
                const dy = dyFloor;

                // Unexplored: black
                if (!tile.explored) {
                    ctx.fillStyle = '#0a0e17';
                    ctx.fillRect(dx, dy, sz, sz);
                    continue;
                }

                // ── Interior tiles: custom rendering ──
                if (tile._isInterior) {
                    this._renderInteriorTile(ctx, tile, dx, dy, sz);
                    continue;
                }

                // Draw base terrain from analyzed LPC fills
                const src = this._getTerrainFill(tile);
                if (terrainSheet && src.sx >= 0) {
                    ctx.drawImage(terrainSheet, src.sx, src.sy, 32, 32, dx, dy, sz, sz);
                } else {
                    ctx.fillStyle = src.fallbackColor || tile.subTerrain.color;
                    ctx.fillRect(dx, dy, sz, sz);
                }

                // Collect for batched grid drawing
                (tile.visible ? gridVisible : gridDim).push(dx, dy, sz);
            }
        }

        // Batched grid strokes — two paths instead of per-tile strokeRect
        ctx.lineWidth = 0.5;
        if (gridVisible.length > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.beginPath();
            for (let i = 0; i < gridVisible.length; i += 3) {
                ctx.rect(gridVisible[i], gridVisible[i+1], gridVisible[i+2], gridVisible[i+2]);
            }
            ctx.stroke();
        }
        if (gridDim.length > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.02)';
            ctx.beginPath();
            for (let i = 0; i < gridDim.length; i += 3) {
                ctx.rect(gridDim[i], gridDim[i+1], gridDim[i+2], gridDim[i+2]);
            }
            ctx.stroke();
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 0.5 — TERRAIN DETAIL
    // Draws brush-painted ground detail tiles (e.g. grass over dirt).
    // ══════════════════════════════════════════════
    _renderTerrainDetailLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const terrainKey = this._seasonKey('terrain');
        const terrainSheet = this._sheets.get(terrainKey);
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

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
                if (!tile || !tile.explored || tile._isInterior) continue;

                const ov = tile.terrainDetail || tile.grassOverlay || null;
                if (!ov) continue;

                const dx = Math.floor(originX + (q - qMin) * ds);
                const dy = dyFloor;

                if (dx + sz < 0 || dx > canvasW) continue;

                if (ov.sheetPath) {
                    const ovImg = this._getSheetByPath(ov.sheetPath);
                    if (ovImg) {
                        const sw = Number.isFinite(ov.sw) ? ov.sw : 32;
                        const sh = Number.isFinite(ov.sh) ? ov.sh : 32;
                        const sx = Number.isFinite(ov.sx) ? ov.sx : 0;
                        const sy = Number.isFinite(ov.sy) ? ov.sy : 0;
                        ctx.drawImage(ovImg, sx, sy, sw, sh, dx, dy, sz, sz);
                    }
                } else if (ov.fillCategory === 'grass') {
                    const fills = this._terrainFills && this._terrainFills.grass;
                    if (terrainSheet && fills && fills.length > 0) {
                        const hash = (Math.abs((q * 83492791 ^ r * 29765729))) >>> 0;
                        const pick = fills[hash % fills.length];
                        ctx.drawImage(terrainSheet, pick.col * 32, pick.row * 32, 32, 32, dx, dy, sz, sz);
                    }
                }
            }
        }
    },

    /**
     * Render a single interior tile (walls, floors, furniture, door).
     * Supports both procedural (INTERIOR_LAYOUTS) and custom spritesheet tiles.
     */
    _renderInteriorTile(ctx, tile, dx, dy, sz) {
        // ── Custom spritesheet-based tile ──
        if (tile._customTile) {
            this._renderCustomInteriorTile(ctx, tile, dx, dy, sz);
            return;
        }

        const isWall = tile.baseTerrain === 'wall';
        const isDoor = tile._isDoor;
        const furniture = tile._furniture;

        if (isWall) {
            // Wall rendering: darker with a 3D effect
            ctx.fillStyle = tile.subTerrain.color || '#5a4a3a';
            ctx.fillRect(dx, dy, sz, sz);
            // Wall top highlight
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(dx, dy, sz, Math.max(2, sz * 0.15));
            // Wall bottom shadow
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(dx, dy + sz - Math.max(2, sz * 0.1), sz, Math.max(2, sz * 0.1));
            // Brick/stone pattern
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 0.5;
            const brickH = sz / 3;
            for (let i = 1; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(dx, dy + i * brickH);
                ctx.lineTo(dx + sz, dy + i * brickH);
                ctx.stroke();
            }
            const offset = tile.r % 2 === 0 ? 0 : sz / 2;
            ctx.beginPath();
            ctx.moveTo(dx + sz / 2 + offset, dy);
            ctx.lineTo(dx + sz / 2 + offset, dy + brickH);
            ctx.moveTo(dx + offset, dy + brickH);
            ctx.lineTo(dx + offset, dy + 2 * brickH);
            ctx.stroke();
        } else if (isDoor) {
            // Door tile
            ctx.fillStyle = tile.subTerrain.color || '#6a4a2a';
            ctx.fillRect(dx, dy, sz, sz);
            // Door frame
            ctx.strokeStyle = '#4a3a1a';
            ctx.lineWidth = Math.max(1, sz * 0.08);
            ctx.strokeRect(dx + sz * 0.15, dy + sz * 0.05, sz * 0.7, sz * 0.9);
            // Door handle
            ctx.fillStyle = '#f5c542';
            const handleR = Math.max(1.5, sz * 0.06);
            ctx.beginPath();
            ctx.arc(dx + sz * 0.65, dy + sz * 0.5, handleR, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Floor tile with checkerboard
            ctx.fillStyle = tile.subTerrain.color || '#8B7355';
            ctx.fillRect(dx, dy, sz, sz);
            // Subtle grid
            ctx.strokeStyle = 'rgba(0,0,0,0.08)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(dx, dy, sz, sz);
        }

        // Render furniture on top of floor
        if (furniture && !isWall) {
            const fc = InnerMap.FURNITURE_COLORS[furniture.type] || '#6a5a4a';
            const pad = sz * 0.12;
            // Furniture shadow
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(dx + pad + 1, dy + pad + 1, sz - pad * 2, sz - pad * 2);
            // Furniture body
            ctx.fillStyle = fc;
            ctx.fillRect(dx + pad, dy + pad, sz - pad * 2, sz - pad * 2);
            // Furniture highlight
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(dx + pad, dy + pad, sz - pad * 2, Math.max(1, (sz - pad * 2) * 0.2));
            // Furniture icon (if zoom is high enough)
            if (sz >= 16) {
                ctx.font = `${Math.floor(sz * 0.45)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(furniture.icon, dx + sz / 2, dy + sz / 2);
            }
            // Furniture border
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(dx + pad, dy + pad, sz - pad * 2, sz - pad * 2);
        }
    },

    /**
     * Render a custom spritesheet-based interior tile.
     * Draws floor, walls, overlay layers from LPC sheets, then furniture meta.
     */
    _renderCustomInteriorTile(ctx, tile, dx, dy, sz) {
        const ct = tile._customTile;
        let drew = false;

        // Helper: draw a single spritesheet cell
        const drawCell = (cell) => {
            if (!cell || !cell.sheetPath) return false;
            const img = CustomInteriors.getImg(cell.sheetPath);
            if (!img) return false;
            const sw = cell.sw || 32;
            const sh = cell.sh || 32;
            ctx.drawImage(img, cell.sx, cell.sy, sw, sh, dx, dy, sz, sz);
            return true;
        };

        // Draw layers bottom-to-top: floor → furniture → walls → overlay
        if (drawCell(ct.floor))     drew = true;
        if (drawCell(ct.furniture)) drew = true;
        if (drawCell(ct.walls))     drew = true;
        if (drawCell(ct.overlay))   drew = true;

        // Fallback: if no spritesheet data drawn, use subTerrain color
        if (!drew) {
            ctx.fillStyle = tile.subTerrain.color || '#2a2a2a';
            ctx.fillRect(dx, dy, sz, sz);
        }

        // Subtle tile grid
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(dx, dy, sz, sz);

        // Render furniture meta on top (if present and tile has custom furniture)
        const furniture = tile._furniture;
        if (furniture) {
            // If furniture has its own icon draw that on top
            if (sz >= 16 && furniture.icon) {
                ctx.font = `${Math.floor(sz * 0.45)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // Shadow
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillText(furniture.icon, dx + sz / 2 + 1, dy + sz / 2 + 1);
                // Icon
                ctx.fillStyle = '#fff';
                ctx.fillText(furniture.icon, dx + sz / 2, dy + sz / 2);
            }

            // Impassable highlight
            if (!furniture.passable) {
                ctx.fillStyle = 'rgba(200,50,50,0.08)';
                ctx.fillRect(dx, dy, sz, sz);
            }
        }

        // Door highlight
        if (tile._isDoor && sz >= 12) {
            ctx.strokeStyle = 'rgba(106,74,42,0.6)';
            ctx.lineWidth = Math.max(1, sz * 0.06);
            ctx.strokeRect(dx + 2, dy + 2, sz - 4, sz - 4);
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 1 — ROADS
    // Draws dirt fills on road tiles. Edge blending is handled by
    // the terrain detail layer's 9-tile brush (roads are excluded
    // from the grass mask so the brush auto-tiles smooth edges).
    // ══════════════════════════════════════════════
    _renderRoadLayer(ctx, camera) {
        if (!InnerMap.roads || InnerMap.roads.length === 0) return;

        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const terrainKey = this._seasonKey('terrain');
        const terrainSheet = this._sheets.get(terrainKey);
        const dirtFills = this._terrainFills ? this._terrainFills.dirt : null;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        for (const road of InnerMap.roads) {
            const tile = InnerMap.getTile(road.q, road.r);
            if (!tile || !tile.visible || !tile.subTerrain.passable || tile.building) continue;
            // Skip tiles that already show dirt (no grass detail painted)
            if (!tile.terrainDetail) continue;

            const screen = camera.worldToScreenFast(road.q * T, road.r * T);
            const dx = Math.floor(screen.x);
            const dy = Math.floor(screen.y);
            const sz = Math.ceil(ds) + 1;

            if (dx + sz < 0 || dx > canvasW) continue;
            if (dy + sz < 0 || dy > canvasH) continue;

            if (terrainSheet && dirtFills && dirtFills.length > 0) {
                const hash = (Math.abs((road.q * 73856093 ^ road.r * 19349663))) >>> 0;
                const pick = dirtFills[hash % dirtFills.length];
                ctx.drawImage(terrainSheet, pick.col * 32, pick.row * 32, 32, 32, dx, dy, sz, sz);
            } else {
                ctx.fillStyle = '#8b7355';
                ctx.fillRect(dx, dy, sz, sz);
            }
        }
    },
});
