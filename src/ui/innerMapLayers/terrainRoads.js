// InnerMapRenderer — terrainRoads render layer methods (mixed in via Object.assign).
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomInteriors } from '../../world/customInteriors.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';
import { furnitureGlyph } from '../icons.js';
import { engraveGlyph } from '../mapInk.js';
import { sheetScale } from '../sheetScale.js';
import { tintedWallSheet } from '../wallTint.js';
import { drawKerbs } from '../pavingEdges.js';
import { drawLaneGround, drawLaneTufts } from '../laneEdges.js';
import { drawTilledSoil } from '../tilledSoil.js';

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
    /** A sheet's cell scale (ui/sheetScale.js): 1, or more for a high-res sheet in the original layout. */
    _sheetScale(img) {
        return sheetScale(img);
    },

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
                // Tilled ground of a town field (world/townProps.js): furrowed soil, the grass edged over it
                // (only where grass is there to edge it: on bare ground the field lies on the bare earth)
                const soil = tile._soilFill && this._soilShows(tile) ? tile._soilFill : null;
                const soilImg = soil && this._getSheetByPath(soil.sheetPath);
                if (soilImg) {
                    const ks = this._sheetScale(soilImg);
                    ctx.drawImage(soilImg, soil.sx * ks, soil.sy * ks, 32 * ks, 32 * ks, dx, dy, sz, sz);
                } else if (terrainSheet && src.sx >= 0) {
                    const k = this._sheetScale(terrainSheet);
                    ctx.drawImage(terrainSheet, src.sx * k, src.sy * k, 32 * k, 32 * k, dx, dy, sz, sz);
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

    /** A town field's soil shows on a grass cell round it, and under the field when grass rings it. */
    _soilShows(tile) {
        const grass = (t) => !!(t && t.terrainDetail && (t.terrainDetail.layer || 'grass') === 'grass');
        if (!tile._townSoil) return grass(tile);
        // Walk to the field's edge along the row: the ring cell beyond it says
        const row = InnerMap.tiles[tile.r];
        if (!row) return false;
        let q = tile.q;
        while (row[q] && row[q]._townSoil && q > 0) q--;
        let e = tile.q;
        while (row[e] && row[e]._townSoil && e < row.length - 1) e++;
        return grass(row[q]) || grass(row[e]);
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
        const cliffSheet = this._sheets.get(this._seasonKey('cliff')) || null;
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

                // Paved streets (world/townPlanner.js): cobbles or slabs laid on the road
                const pave = tile.paving;
                if (pave && pave.sheetPath) {
                    const pImg = this._getSheetByPath(pave.sheetPath);
                    if (pImg) {
                        const pdx = Math.floor(originX + (q - qMin) * ds);
                        const kp = this._sheetScale(pImg);
                        ctx.drawImage(pImg, pave.sx * kp, pave.sy * kp, 32 * kp, 32 * kp, pdx, dyFloor, sz, sz);
                    }
                }

                const ov = tile.terrainDetail || tile.grassOverlay || null;
                const decor = tile.decor;
                const crag = tile._crag;
                if (!ov && !decor && !crag && !tile._fieldSoil) continue;

                const dx = Math.floor(originX + (q - qMin) * ds);
                const dy = dyFloor;

                if (dx + sz < 0 || dx > canvasW) continue;

                if (!ov) {
                    // (no ground detail here: only the decals)
                } else if (ov.sheetPath) {
                    // Frozen water: the same piece from the ice sheet (innerMapLayers/streetSeasons.js)
                    const iv = tile._iced && this._iceDetail ? this._iceDetail(ov) : ov;
                    const ovImg = this._getSheetByPath(iv.sheetPath);
                    if (ovImg) {
                        const sw = Number.isFinite(iv.sw) ? iv.sw : 32;
                        const sh = Number.isFinite(iv.sh) ? iv.sh : 32;
                        const sx = Number.isFinite(iv.sx) ? iv.sx : 0;
                        const sy = Number.isFinite(iv.sy) ? iv.sy : 0;
                        const k = this._sheetScale(ovImg);
                        ctx.drawImage(ovImg, sx * k, sy * k, sw * k, sh * k, dx, dy, sz, sz);
                    }
                } else if (ov.fillCategory) {
                    // _terrainFills is keyed by category (grass, water, dirt, …)
                    const fills = this._terrainFills && this._terrainFills[ov.fillCategory];
                    if (terrainSheet && fills && fills.length > 0) {
                        const hash = (Math.abs((q * 83492791 ^ r * 29765729))) >>> 0;
                        const pick = fills[hash % fills.length];
                        const k = this._sheetScale(terrainSheet);
                        ctx.drawImage(terrainSheet, pick.col * 32 * k, pick.row * 32 * k, 32 * k, 32 * k, dx, dy, sz, sz);
                    }
                }

                // A town field's tilled soil (world/townProps.js), over the grass with ragged edges
                // (never on water: a river or the sea laid after the town covers a field there)
                if (tile._fieldSoil && !tile._wet) {
                    drawTilledSoil(ctx, (dq, dr) => { const t = InnerMap.getTile(q + dq, r + dr); return !!(t && t._fieldSoil && !t._wet); }, q, r, dx, dy, ds);
                }

                // A crag's rim or rock face (world/innerMap/cliffs.js), from the season's cliff sheet
                if (crag && cliffSheet) {
                    const kc = this._sheetScale(cliffSheet);
                    ctx.drawImage(cliffSheet, crag.c * 32 * kc, crag.r * 32 * kc, 32 * kc, 32 * kc, dx, dy, sz, sz);
                }

                // Shore dressing (world/innerMap/water.js): reeds, lily pads, stones —
                // decals over the ground, a tall one reaching up into the cell above
                if (decor) {
                    for (const d of decor) {
                        const img = d && d.sheetPath && this._getSheetByPath(d.sheetPath);
                        if (!img) continue;
                        const h = d.h > 1 ? d.h : 1;
                        const kd = this._sheetScale(img);   // (the painted shore plants and stones)
                        const smooth = ctx.imageSmoothingEnabled;
                        ctx.imageSmoothingEnabled = kd > 1;
                        ctx.drawImage(img, d.sx * kd, d.sy * kd, 32 * kd, 32 * h * kd, dx, dy - (h - 1) * (sz - 1), sz, sz + (h - 1) * (sz - 1));
                        ctx.imageSmoothingEnabled = smooth;
                    }
                }
            }
        }
        // The dirt lanes' wear and the grass tufts over their edges (ui/laneEdges.js), after the
        // ground so the tufts lie over the grass cell's own straight edge
        const isLane = t => !!(t && t.isRoad && !t.paving && !t._wet && t.explored && !t._isInterior);
        // The turf beside a lane: a grass brush cell (an edge, painted with its dirt) or a plain fill
        const fills = this._terrainFills && this._terrainFills.grass;
        const kt = terrainSheet ? this._sheetScale(terrainSheet) : 1;
        const fillCell = f => ({ img: terrainSheet, sx: f.col * 32 * kt, sy: f.row * 32 * kt, sw: 32 * kt });
        const grass = terrainSheet && fills && fills.length ? fillCell(fills[0]) : null;   // (the tufts' texture)
        const dirtFills = this._terrainFills && this._terrainFills.dirt;
        const dirt = terrainSheet && dirtFills && dirtFills.length ? fillCell(dirtFills[0]) : null;
        const paveOf = (q, r) => (dq, dr) => {
            const n = InnerMap.getTile(q + dq, r + dr);
            if (!n || !n._pave || !n.paving || !n.paving.sheetPath || n._wet) return null;
            const img = this._getSheetByPath(n.paving.sheetPath);
            if (!img) return null;
            const k = this._sheetScale(img);
            return { img, sx: n.paving.sx * k, sy: n.paving.sy * k, sw: 32 * k };
        };
        const turf = t => {
            if (!t || t.isRoad || t.paving || t._wet || t.customBuildingPart || t._fieldSoil) return null;
            const ov = t.terrainDetail || t.grassOverlay;
            if (!ov) return (t.baseTerrain || 'grass') === 'grass' ? { bare: true } : null;   // (bare grass ground)
            if ((ov.layer || ov.fillCategory || 'grass') !== 'grass') return null;
            return ov;
        };
        // a cell's own ground, as drawn: a brush cell, a grass fill picked as the detail layer
        // picks it, or the base ground picked as the terrain layer does
        const cellOf = (ov, t) => {
            if (ov.bare) {
                const src = this._getTerrainFill(t);
                return terrainSheet && src.sx >= 0 ? { ...fillCell({ col: src.sx / 32, row: src.sy / 32 }), full: true } : null;
            }
            if (ov.fillCategory) {
                const fl = this._terrainFills && this._terrainFills[ov.fillCategory];
                if (!terrainSheet || !fl || !fl.length) return null;
                const hash = (Math.abs((t.q * 83492791 ^ t.r * 29765729))) >>> 0;
                return { ...fillCell(fl[hash % fl.length]), full: true };
            }
            const img = this._getSheetByPath(ov.sheetPath);
            if (!img) return null;
            const k = this._sheetScale(img);
            return { img, sx: (ov.sx || 0) * k, sy: (ov.sy || 0) * k, sw: 32 * k };
        };
        const grassy = (q, r) => (dq, dr) => {
            const t = InnerMap.getTile(q + dq, r + dr);
            const ov = turf(t);
            return ov ? cellOf(ov, t) : null;
        };
        const laneDirt = t => {
            const src = this._getTerrainFill(t);
            return terrainSheet && src.sx >= 0 ? fillCell({ col: src.sx / 32, row: src.sy / 32 }) : dirt;
        };
        for (const pass of [drawLaneGround, drawLaneTufts]) {
            for (let r = rMin; r <= rMax; r++) {
                const row = InnerMap.tiles[r];
                const dy = Math.floor(originY + (r - rMin) * ds);
                if (dy + ds * 1.5 < 0 || dy - ds * 0.5 > canvasH) continue;
                for (let q = qMin; q <= qMax; q++) {
                    const tile = row[q];
                    if (!isLane(tile)) continue;
                    const dx = Math.floor(originX + (q - qMin) * ds);
                    if (dx + ds * 1.5 < 0 || dx - ds * 0.5 > canvasW) continue;
                    pass(ctx, grassy(q, r), q, r, dx, dy, ds, grass, laneDirt(tile), paveOf(q, r));
                }
            }
        }
        // Kerbs along the paved streets' sides (ui/pavingEdges.js), after the ground so their
        // worn fringe lies over the dirt and grass beside them
        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            const dy = Math.floor(originY + (r - rMin) * ds);
            if (dy + ds * 1.5 < 0 || dy - ds * 0.5 > canvasH) continue;
            for (let q = qMin; q <= qMax; q++) {
                const tile = row[q];
                if (!tile || !tile._pave || !tile.paving || !tile.explored || tile._isInterior) continue;
                const dx = Math.floor(originX + (q - qMin) * ds);
                if (dx + ds * 1.5 < 0 || dx - ds * 0.5 > canvasW) continue;
                const plaza = tile._pave === 'plaza';
                drawKerbs(ctx, (dq, dr) => {
                    const n = InnerMap.getTile(q + dq, r + dr);
                    if (!n || n.customBuildingPart || n._wet) return false;
                    if (n._pave) return plaza && n._pave !== 'plaza';   // (a square's own kerb where it meets a street)
                    if (n.isRoad) return false;                            // (the road runs on as dirt: the cobbles fray out, ui/laneEdges.js)
                    return !n.paving;                                     // (not against a bridge or a quay)
                }, q, r, dx, dy, ds);
            }
        }
    },

    /**
     * Render a single interior tile (walls, floors, furniture, door).
     * Supports both procedural (INTERIOR_LAYOUTS) and custom spritesheet tiles.
     */
    _renderInteriorTile(ctx, tile, dx, dy, sz) {
        // ── Underground: a cave's or mine's rock and floor (ui/innerMapLayers/caves.js) ──
        if (tile._cave && this._renderCaveTile && this._renderCaveTile(ctx, tile, dx, dy, sz)) return;
        // ── Custom spritesheet-based tile ──
        if (tile._customTile) {
            this._renderCustomInteriorTile(ctx, tile, dx, dy, sz);
            return;
        }

        // ── Drawn floors, walls and furniture (interiorArt in innerMapRenderer.json) ──
        if (this._renderInteriorArt(ctx, tile, dx, dy, sz)) return;

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
            // What the piece is, cut into it (if zoom is high enough)
            const glyph = sz >= 16 && furnitureGlyph(furniture);
            if (glyph) engraveGlyph(ctx, glyph, dx + sz / 2, dy + sz / 2, sz * 0.62);
            // Furniture border
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(dx + pad, dy + pad, sz - pad * 2, sz - pad * 2);
        }
    },

    /**
     * Draw a procedural interior tile from sprites: the floor's material (a few
     * variants, picked by position), the wall's material (its face along the back
     * wall, shaded where the side walls run), the door, and the furniture's sprite.
     * Returns false while the sheets are still loading, or when no art is
     * configured, so the flat-colour drawing stands in.
     */
    _renderInteriorArt(ctx, tile, dx, dy, sz) {
        const art = this._interiorArt;
        if (!art) return false;
        const pick = (c) => {
            const img = c && this._getSheetByPath(c.sheet);
            return img ? { img, c } : null;
        };
        const hash = ((tile.q * 73856093) ^ (tile.r * 19349663)) >>> 0;
        const isWall = tile.baseTerrain === 'wall';
        const at = (dq, dr) => InnerMap.getTile(tile.q + dq, tile.r + dr);
        const walled = (o) => !o || o.baseTerrain === 'wall';
        // A seamless texture of whole tiles (tw × th): each tile shows its own cell of it, by
        // position, so the floor runs on unbroken. With variants (textures sharing one border),
        // each tw × th block of the room takes one by a hash of where it is, so nothing repeats.
        const mod = (v, n) => ((v % n) + n) % n;
        const cellOf = (c, sx = c.sx, sy = c.sy) => {
            if (!c.tw) return [sx, sy];
            const nx = c.tw / 32, ny = (c.th || 32) / 32;
            if (c.variants && c.variants.length) {
                const bx = Math.floor(tile.q / nx), by = Math.floor(tile.r / ny);
                const v = c.variants[(((bx * 92837111) ^ (by * 689287499)) >>> 0) % c.variants.length];
                sx = v[0]; sy = v[1];
            }
            return [sx + mod(tile.q, nx) * 32, sy + mod(tile.r, ny) * 32];
        };

        let base, cell, mat = null;
        if (isWall) {
            mat = art.walls[tile._wallMaterial] || art.walls[art.defaultWall];
            base = pick(mat);
            if (base) cell = cellOf(mat);
        } else {
            const vars = art.floors[tile.baseTerrain] || art.floors[art.defaultFloor];
            base = vars && vars.length ? pick(vars[hash % vars.length]) : null;
            if (base) cell = cellOf(base.c);
        }
        if (!base) return false;
        const furniture = tile._furniture;
        // A big piece (world/innerMap/interiors.js _joinPieces) is drawn once, from its last tile
        // (the others are drawn by then, so it lies over them), in its own art: `<type>_<w>x<h>`
        const piece = furniture && furniture.piece;
        // (a piece with its own look keeps it at its size: the poor's wooden tub, tub_wood_2x1)
        const pieceArt = piece && ((furniture.art && art.furniture[`${furniture.art}_${piece.w}x${piece.h}`]) || art.furniture[`${furniture.type}_${piece.w}x${piece.h}`]);
        // (a piece may name its own look: coal in a sack, `art: 'sack_coal'`)
        const furnArt = furniture && (pieceArt
            || (furniture.art && art.furniture[furniture.art])
            || (furniture.facing === 'up' && art.furniture[`${furniture.type}_back`]) || art.furniture[furniture.type] || null);
        const furnImg = furnArt ? pick(furnArt) : null;
        if (furnArt && !furnImg) return false; // wait for the sheet rather than flash a box

        const kb = this._sheetScale(base.img);
        if (isWall) {
            this._drawWallTile(ctx, tile, mat, base.img, kb, cellOf, at, walled, dx, dy, sz);
            return true;
        }
        ctx.drawImage(base.img, cell[0] * kb, cell[1] * kb, 32 * kb, 32 * kb, dx, dy, sz, sz);
        if (tile._isDoor) {
            const door = pick(art.door);
            if (door) { const kd = this._sheetScale(door.img); ctx.drawImage(door.img, door.c.sx * kd, door.c.sy * kd, (door.c.sw || 32) * kd, (door.c.sh || 32) * kd, dx, dy, sz, sz); }
            return true;
        }
        if (furnImg && pieceArt) {
            if (piece.i !== piece.w - 1 || piece.j !== piece.h - 1) return true;   // (drawn from its last tile)
            const c = furnImg.c, k = this._sheetScale(furnImg.img);
            const left = dx - (piece.w - 1) * sz, bottom = dy + sz;
            const dw = c.sw * sz / 48, dh = c.sh * sz / 48;   // (at the 48px pieces' scale)
            if (!c.flat) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                ctx.beginPath();
                ctx.ellipse(left + piece.w * sz / 2, bottom - sz * 0.1, piece.w * sz * 0.42, sz * 0.1, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.drawImage(furnImg.img, c.sx * k, c.sy * k, c.sw * k, c.sh * k, Math.round(left + (piece.w * sz - dw) / 2), Math.round(bottom - dh), Math.round(dw), Math.round(dh));
            return true;
        }
        if (furnImg) {
            // (what lies flat on the floor — a rug, straw, a stair well — casts no shadow)
            if (!furnArt.flat) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                ctx.beginPath();
                ctx.ellipse(dx + sz / 2, dy + sz * 0.9, sz * 0.38, sz * 0.09, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            let fc = furnImg.c, fimg = furnImg.img;
            // A runner: a rug laid next to another runs on into it (its border only on the outer edges)
            if (furnArt.connect) {
                const same = (o) => o && o._furniture && o._furniture.type === furniture.type;
                const m = (same(at(0, -1)) ? 1 : 0) | (same(at(1, 0)) ? 2 : 0) | (same(at(0, 1)) ? 4 : 0) | (same(at(-1, 0)) ? 8 : 0);
                const run = m ? pick(furnArt.connect) : null;
                if (run) { fimg = run.img; fc = { sx: run.c.sx + (m % 4) * 48, sy: run.c.sy + Math.floor(m / 4) * 48, sw: 48, sh: 48 }; }
            }
            const kf = this._sheetScale(fimg);
            // (lift: hung up the wall behind it — a banner — rather than stood on the floor)
            const ly = furnArt.lift && tile.r > 0 ? Math.round(sz * furnArt.lift) : 0;
            // (a 48px piece of another size — a bookshelf taller than a person — stands on its tile
            // at the same scale, its foot on the tile's, reaching up the wall behind)
            if (fc.sw && fc.sh && (fc.sw !== 48 || fc.sh !== 48)) {
                const dw = fc.sw * sz / 48, dh = fc.sh * sz / 48;
                ctx.drawImage(fimg, fc.sx * kf, fc.sy * kf, fc.sw * kf, fc.sh * kf, Math.round(dx + (sz - dw) / 2), Math.round(dy + sz - dh - ly), Math.round(dw), Math.round(dh));
            } else {
                ctx.drawImage(fimg, fc.sx * kf, fc.sy * kf, (fc.sw || 32) * kf, (fc.sh || 32) * kf, dx, dy - ly, sz, sz);
            }
        } else if (furniture) {
            // A piece with no sprite yet: its glyph cut into a dark plate
            const pad = sz * 0.14;
            ctx.fillStyle = InnerMap.FURNITURE_COLORS[furniture.type] || '#6a5a4a';
            ctx.fillRect(dx + pad, dy + pad, sz - pad * 2, sz - pad * 2);
            const glyph = sz >= 16 && furnitureGlyph(furniture);
            if (glyph) engraveGlyph(ctx, glyph, dx + sz / 2, dy + sz / 2, sz * 0.62);
        }
        return true;
    },

    /**
     * A wall tile. The back wall (the top row) shows its face; a wall with floor before it (to
     * the south) shows its top and, below that, a strip of its face; any other wall is seen from
     * above: its top (the material's `top` texture), lit along the edges that meet the floor.
     */
    _drawWallTile(ctx, tile, mat, img, kb, cellOf, at, walled, dx, dy, sz) {
        // (in the outside wall's own colour, where the building says what that is: ui/wallTint.js)
        if (tile._wallTint) img = tintedWallSheet(img, mat, tile._wallTint, kb);
        const mod = (v, n) => ((v % n) + n) % n;
        const fw = mat.tw ? ((mat.face && mat.face.tw) || mat.tw) / 32 : 1;
        const faceCell = () => (mat.face ? [mat.face.sx + mod(tile.q, fw) * 32, mat.face.sy] : [mat.sx + mod(tile.q, fw) * 32, mat.sy]);
        if (tile.r === 0 || !mat.tw) {
            const c = mat.tw ? faceCell() : [mat.sx, mat.sy];
            ctx.drawImage(img, c[0] * kb, c[1] * kb, 32 * kb, 32 * kb, dx, dy, sz, sz);
            if (tile.r === 0) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.fillRect(dx, dy + sz * 0.85, sz, sz * 0.15);
            } else {
                // (an old plain wall cell: seen from above as before, darkened)
                ctx.fillStyle = 'rgba(20, 14, 10, 0.55)';
                ctx.fillRect(dx, dy, sz, sz);
            }
            return;
        }
        const top = mat.top ? cellOf(mat, mat.top.sx, mat.top.sy) : cellOf(mat);
        const open = !walled(at(0, 1));
        const capH = open ? Math.round(sz * 0.55) : sz;
        // its top
        ctx.drawImage(img, top[0] * kb, top[1] * kb, 32 * kb, (open ? 32 * 0.55 : 32) * kb, dx, dy, sz, capH);
        if (!mat.top) { ctx.fillStyle = 'rgba(20, 14, 10, 0.55)'; ctx.fillRect(dx, dy, sz, capH); }
        // its face below that, where the floor runs up to it from the south
        if (open) {
            const c = faceCell();
            ctx.drawImage(img, c[0] * kb, (c[1] + 32 * 0.45) * kb, 32 * kb, 32 * 0.55 * kb, dx, dy + capH, sz, sz - capH);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
            ctx.fillRect(dx, dy + sz * 0.88, sz, sz * 0.12);
        }
        // the rims: light where its top meets the room
        const rim = Math.max(1, Math.round(sz / 24));
        ctx.fillStyle = 'rgba(255, 244, 225, 0.22)';
        if (!walled(at(-1, 0))) ctx.fillRect(dx, dy, rim, capH);
        if (!walled(at(1, 0))) ctx.fillRect(dx + sz - rim, dy, rim, capH);
        if (!walled(at(0, -1))) ctx.fillRect(dx, dy, sz, rim);
        if (open) { ctx.fillStyle = 'rgba(255, 244, 225, 0.28)'; ctx.fillRect(dx, dy + capH - rim, sz, rim); }
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
        // A piece the player set down on a sprite floor, or the stairs (world/innerMap/floors.js): its drawn art
        if (furniture && (furniture._piece || furniture._stairs) && this._interiorArt && this._interiorArt.furniture) {
            const fa = this._interiorArt.furniture[furniture.type];
            const fImg = fa && this._getSheetByPath(fa.sheet);
            if (fImg) {
                const kf = this._sheetScale(fImg);
                ctx.drawImage(fImg, fa.sx * kf, fa.sy * kf, (fa.sw || 32) * kf, (fa.sh || 32) * kf, dx, dy, sz, sz);
                return;
            }
        }
        if (furniture) {
            // Mark what the piece is (pieces with no glyph are left to their sprite)
            const glyph = sz >= 16 && furniture.icon && furnitureGlyph(furniture);
            if (glyph) engraveGlyph(ctx, glyph, dx + sz / 2, dy + sz / 2, sz * 0.55);

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
    /**
     * Building lots (world/innerMap/lots.js): stakes at the corners, a cord
     * between them, and a sign at the street — FOR SALE, YOURS, or SOLD.
     * Lots something stands on show nothing (the building speaks for itself).
     */
    _renderLotLayer(ctx, camera) {
        if (InnerMap._insideBuilding || typeof InnerMap.townLots !== 'function') return;
        const lots = InnerMap.townLots();
        if (!lots.length) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const canvasW = ctx.canvas.width, canvasH = ctx.canvas.height;
        for (const lot of lots) {
            const a = camera.worldToScreenFast(lot.q0 * T, lot.r0 * T);
            const x = Math.floor(a.x), y = Math.floor(a.y);
            const w = Math.ceil(lot.w * ds), h = Math.ceil(lot.h * ds);
            if (x > canvasW || y > canvasH || x + w < 0 || y + h < 0) continue;
            const at = InnerMap.lotAt(lot.q0, lot.r0);
            if (!at || InnerMap._lotHasBuilding(lot) || (at.rec && at.rec.built && at.rec.built.by === 'player')) continue;
            const colour = at.forSale ? 'rgba(240, 214, 150, 0.85)' : at.mine ? 'rgba(245, 197, 66, 0.95)' : 'rgba(190, 120, 100, 0.8)';
            // Trodden ground within the stakes
            ctx.fillStyle = at.mine ? 'rgba(245, 197, 66, 0.07)' : 'rgba(60, 40, 20, 0.08)';
            ctx.fillRect(x, y, w, h);
            // The cord
            ctx.save();
            ctx.strokeStyle = colour;
            ctx.lineWidth = Math.max(1, ds * 0.05);
            ctx.setLineDash([Math.max(2, ds * 0.25), Math.max(2, ds * 0.18)]);
            ctx.strokeRect(x + ds * 0.15, y + ds * 0.15, w - ds * 0.3, h - ds * 0.3);
            ctx.restore();
            // The stakes: the LPC plain fence's single post, small, at each corner
            const fence = this._sheets && this._sheets.get('fence_plain');
            const boards = this._sheets && this._sheets.get('signs');
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            const kf = this._sheetScale(fence), kb = this._sheetScale(boards);
            const stake = ds * 0.55;
            for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
                const sx0 = px + (px === x ? ds * 0.15 : -ds * 0.15) - stake / 2;
                const sy0 = py + (py === y ? ds * 0.35 : -ds * 0.05) - stake;
                if (fence) ctx.drawImage(fence, 96 * kf, 96 * kf, 32 * kf, 32 * kf, Math.round(sx0), Math.round(sy0), Math.round(stake), Math.round(stake));
                else { ctx.fillStyle = '#6b4a2b'; ctx.fillRect(sx0 + stake * 0.4, sy0, stake * 0.2, stake); }
            }
            // The sign at the lot's gate (the street side: its front, or its top when it
            // opens north): a post with a board on it, drawn to the world's scale (it zooms
            // with the map, like everything on it) — the LPC fence post and sign board
            const bw = ds * 1.1;                                   // the board, a tile and a bit
            const gx = x + ds * 0.35, gy = lot.gate === 'north' ? y + ds * 1.2 : y + h - ds * 0.2;
            if (fence) ctx.drawImage(fence, 96 * kf, 96 * kf, 32 * kf, 32 * kf, Math.round(gx + bw / 2 - ds * 0.5), Math.round(gy - ds), Math.round(ds), Math.round(ds));
            // light board for sale, gold-edged for yours, dark for sold
            const [bsx, bsy] = at.forSale ? [0, 32] : at.mine ? [0, 0] : [32, 32];
            const by = gy - ds * 1.45;
            if (boards) ctx.drawImage(boards, bsx * kb, bsy * kb, 32 * kb, 32 * kb, Math.round(gx), Math.round(by), Math.round(bw), Math.round(bw * 0.8));
            ctx.restore();
            // The words on the board, sized with it (hidden when too small to read)
            if (ds >= 26) {
                const word = at.forSale ? 'FOR SALE' : at.mine ? 'YOURS' : 'SOLD';
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // as big as the board's face allows (its frame is about a tenth of it each side)
                let fs = bw * 0.2;
                ctx.font = `bold ${fs}px Georgia, serif`;
                const fit = (bw * 0.72) / Math.max(1, ctx.measureText(word).width);
                if (fit < 1) { fs *= fit; ctx.font = `bold ${fs}px Georgia, serif`; }
                ctx.fillStyle = at.forSale || at.mine ? '#2a1a0a' : '#e8dcc4';
                const cx = gx + bw / 2;
                ctx.fillText(word, cx, by + bw * (at.forSale ? 0.3 : 0.4));
                if (at.forSale) {
                    let ps = fs * 1.3;
                    ctx.font = `bold ${ps}px Georgia, serif`;
                    const pfit = (bw * 0.72) / Math.max(1, ctx.measureText(`${at.price}g`).width);
                    if (pfit < 1) { ps *= pfit; ctx.font = `bold ${ps}px Georgia, serif`; }
                    ctx.fillText(`${at.price}g`, cx, by + bw * 0.52);
                }
                ctx.restore();
            }
        }
    },

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
                const k = this._sheetScale(terrainSheet);
                ctx.drawImage(terrainSheet, pick.col * 32 * k, pick.row * 32 * k, 32 * k, 32 * k, dx, dy, sz, sz);
            } else {
                ctx.fillStyle = '#8b7355';
                ctx.fillRect(dx, dy, sz, sz);
            }
        }
    },
});
