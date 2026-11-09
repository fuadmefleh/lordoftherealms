// InnerMapRenderer — objectsBuildings render layer methods (mixed in via Object.assign).
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomInteriors } from '../../world/customInteriors.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';
import { buildingGlyph, drawGlyph, glyphFor } from '../icons.js';
import { drawMapText, drawMapMarker, inkText, labelZoom, textPx } from '../mapInk.js';

Object.assign(InnerMapRenderer, {
    // ══════════════════════════════════════════════
    // LAYER 2 — OBJECTS (trees, plants, rocks, flowers)
    // These are separate from terrain — drawn on their own layer.
    // Collected and sorted by Y-bottom for correct painter's-algorithm overlap.
    // ══════════════════════════════════════════════
    /** A custom object's size in cells: w to the right of its anchor, h above it (cached on the def). */
    _objectExtent(def) {
        if (!this._extents) this._extents = new WeakMap();
        let ext = this._extents.get(def);
        if (ext) return ext;
        let w = 1, h = 0;
        for (const t of def.tiles || []) {
            w = Math.max(w, (t.localCol || 0) + 1);
            h = Math.max(h, -(t.localRow || 0));
        }
        ext = { w, h };
        this._extents.set(def, ext);
        return ext;
    },

    _renderObjectLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const cs = Math.ceil(ds) + 1;
        const { qMin, qMax, rMin, rMax } = this._getVisibleTileRange(camera);

        // Collect all object overlays to sort by Y
        const objects = [];

        for (let r = rMin; r <= rMax; r++) {
            for (let q = qMin; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building) continue; // buildings have their own layer
                if (tile.customObjectPart) continue; // non-anchor part of a custom object
                if (tile.customObject) continue;     // anchor — collected separately below

                // Never render built-in object overlays (editor-authored objects only)
                continue;
            }
        }

        // Collect custom editor-authored objects (anchor tiles only)
        if (typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
            for (let r = rMin; r <= rMax; r++) {
                for (let q = qMin; q <= qMax; q++) {
                    const tile = InnerMap.tiles[r][q];
                    if (!tile.explored || !tile.visible) continue;
                    if (!tile.customObject) continue;
                    const def = CustomObjects.getDef(tile.customObject.defId);
                    if (!def) continue;
                    objects.push({ q, r, overlay: null, customDef: def, sortY: (r + 1) * T });
                }
            }
        }

        // Sort bottom-to-top so nearer (lower) objects draw last (on top)
        objects.sort((a, b) => a.sortY - b.sortY);

        for (const obj of objects) {
            const o = obj.overlay;
            const screen = camera.worldToScreenFast(obj.q * T, obj.r * T);
            const dx = Math.floor(screen.x);
            const dy = Math.floor(screen.y);

            // Culling
            if (dx + cs * 3 < 0 || dx > ctx.canvas.width + cs) continue;
            if (dy + cs * 3 < 0 || dy > ctx.canvas.height + cs) continue;

            // ── Custom editor objects ──
            if (obj.customDef) {
                const def = obj.customDef;
                const singleImg = def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null;
                for (const tDef of def.tiles) {
                    const img = tDef.sheetPath ? CustomObjects.getImage(tDef.sheetPath) : singleImg;
                    if (!img || !img.complete) continue;
                    const tdx = dx + tDef.localCol * cs;
                    const tdy = dy + tDef.localRow * cs;
                    if (tdx + cs < 0 || tdx > ctx.canvas.width + cs) continue;
                    if (tdy + cs < 0 || tdy > ctx.canvas.height + cs) continue;
                    const k = this._sheetScale ? this._sheetScale(img) : 1;
                    ctx.imageSmoothingEnabled = k > 1;
                    ctx.drawImage(img, tDef.sx * k, tDef.sy * k, tDef.sw * k, tDef.sh * k, tdx, tdy, cs, cs);
                }
                continue;
            }

            // ── Water / ice overlays ── drawn as tinted rectangles with edge softening
            if (o.type === 'water_overlay' || o.type === 'ice_overlay') {
                const sz = Math.ceil(ds) + 1;
                // Draw the water/ice tint over parent terrain
                ctx.fillStyle = o.tint;
                ctx.fillRect(dx, dy, sz, sz);

                // Draw water ripple if sheet available
                if (o.type === 'water_overlay' && this._sheets.has('water_ripple')) {
                    const rippleSheet = this._sheets.get('water_ripple');
                    // WaterRipple.png = 128x32, 4 frames of 32x32
                    const hash = (Math.abs((obj.q * 73856093 ^ obj.r * 19349663))) >>> 0;
                    const frame = hash % 4;
                    ctx.globalAlpha = 0.6;
                    ctx.drawImage(rippleSheet, frame * 32, 0, 32, 32, dx, dy, sz, sz);
                    ctx.globalAlpha = 1.0;
                }
                continue;
            }

            // ── Waterfall ── tall water overlay
            if (o.type === 'waterfall') {
                const sheet = this._sheets.get(o.sheet);
                if (sheet) {
                    const scale = ds / o.sw;
                    const ow = ds;
                    const oh = o.sh * scale;
                    ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy + ds - oh, ow, oh);
                } else {
                    // Fallback tinted rect
                    const sz = Math.ceil(ds) + 1;
                    ctx.fillStyle = 'rgba(42,133,152,0.55)';
                    ctx.fillRect(dx, dy, sz, sz);
                }
                continue;
            }

            // ── Sprite-based overlays ──
            const sheet = this._sheets.get(o.sheet);
            if (!sheet) continue;
            // (a painted repaint is drawn smooth from its scaled cells: ui/sheetScale.js)
            const k = this._sheetScale ? this._sheetScale(sheet) : 1;
            ctx.imageSmoothingEnabled = k > 1;
            const osx = o.sx * k, osy = o.sy * k, osw = o.sw * k, osh = o.sh * k;

            if (o.type === 'tree') {
                // Trees: scale to tile width, extend upward from tile bottom
                const scale = ds / o.sw;  // fit tile width
                const ow = ds;
                const oh = o.sh * scale;
                const ox = dx;
                const oy = dy + ds - oh;  // anchor bottom of tree at bottom of tile
                ctx.drawImage(sheet, osx, osy, osw, osh, ox, oy, ow, oh);
            } else if (o.type === 'plant' || o.type === 'flower' || o.type === 'mushroom') {
                // Small objects: centered in tile, ~60% tile size
                const ratio = 0.6;
                const ow = ds * ratio;
                const oh = ds * ratio;
                const ox = dx + (ds - ow) / 2;
                const oy = dy + (ds - oh) / 2;
                ctx.drawImage(sheet, osx, osy, osw, osh, ox, oy, ow, oh);
            } else if (o.type === 'rock') {
                // Rocks are 2×2 tile sprites (64×64 source px).
                // Draw at full 2×2 tile area, anchored at top-left of placement tile.
                const tilesW = o.sw / 32;  // 2
                const tilesH = o.sh / 32;  // 2
                const ow = ds * tilesW;
                const oh = ds * tilesH;
                const ox = dx + (ds - ow) / 2; // center horizontally on origin tile
                const oy = dy + ds - oh;        // anchor bottom edge at bottom of origin tile
                ctx.drawImage(sheet, osx, osy, osw, osh, ox, oy, ow, oh);
            } else {
                // Default: fill tile
                ctx.drawImage(sheet, osx, osy, osw, osh, dx, dy, ds, ds);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 3 — BUILDINGS (LPC structures ONLY, no hex sprites)
    // ══════════════════════════════════════════════
    _renderBuildingLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._getVisibleTileRange(camera);

        // Collect legacy AND custom building anchors, sorted by Y for correct overlap
        const buildings = [];

        for (let r = rMin; r <= rMax; r++) {
            for (let q = qMin; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible) continue;
                if (tile.building) {
                    buildings.push({ q, r, tile, type: 'legacy', sortY: (r + 1) * T });
                }
                if (tile.customBuilding &&
                    typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded()) {
                    const def = CustomBuildings.getBuilding(tile.customBuilding.defId);
                    if (def) {
                        // Sort by origin row (anchor) so characters above origin draw underneath
                        buildings.push({ q, r, tile, type: 'custom', def,
                                         sortY: (r + 1) * T });
                    }
                }
            }
        }

        buildings.sort((a, b) => a.sortY - b.sortY);

        for (const b of buildings) {
            const screen = camera.worldToScreenFast(b.q * T, b.r * T);
            const dx = Math.floor(screen.x);
            const dy = Math.floor(screen.y);

            if (dx + ds * 4 < 0 || dx > ctx.canvas.width  + ds * 4) continue;
            if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

            if (b.type === 'custom') {
                this._drawCustomBuilding(ctx, camera, b.def, b.q, b.r, ds);
                continue;
            }

            // ── Legacy building ──
            const isUnderConstruction = b.tile._propertyRef && b.tile._propertyRef.underConstruction;
            if (isUnderConstruction) ctx.globalAlpha = 0.45;

            this._drawLPCBuilding(ctx, b.tile.building, dx, dy, ds);

            if (isUnderConstruction) {
                ctx.globalAlpha = 1.0;
                drawMapMarker(ctx, 'hammer', dx + ds / 2, dy + ds / 2, Math.max(10, ds * 0.22));
            }

            // Building label
            const bldg = b.tile.buildingInfo;
            if (bldg && camera.zoom > 0.4) {
                this._drawBuildingLabel(ctx, camera, bldg, b.q, b.r);
            }
        }
    },

    /**
     * Draw an editor-authored custom building tile-by-tile at (anchorQ, anchorR).
     * Renders all 4 layers (floor → walls → roof → overlay) in order.
     */
    _drawCustomBuilding(ctx, camera, def, anchorQ, anchorR, ds) {
        const T  = this.TILE_SIZE;
        const cs = Math.ceil(ds) + 1;
        // Keep the anchor fractional and place each cell on the true grid
        // (spacing = ds), flooring per cell. Stepping by the integer cs would make
        // cells snap relative to the terrain when ds crosses an integer during the
        // zoom lerp — the visible jitter. Size stays cs so cells overlap a pixel.
        const screen = camera.worldToScreenFast(anchorQ * T, anchorR * T);
        const ax = screen.x;
        const ay = screen.y;

        for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
            const lyrArr = def.layers[lyrName];
            if (!lyrArr || !lyrArr.length) continue;
            for (const cell of lyrArr) {
                const x = Math.floor(ax + cell.q * ds);
                const y = Math.floor(ay + cell.r * ds);
                if (x + cs < 0 || x > ctx.canvas.width  + cs) continue;
                if (y + cs < 0 || y > ctx.canvas.height + cs) continue;
                const img = CustomBuildings.getImg(cell.sheetPath);
                if (!img) continue;
                // (a sheet repainted at more than 32px a cell is drawn smooth: ui/sheetScale.js)
                const k = this._sheetScale ? this._sheetScale(img) : 1;
                ctx.imageSmoothingEnabled = k > 1;
                // (a part wider or taller than a cell, an awning across a doorway, draws to its size)
                const sw = cell.sw || 32, sh = cell.sh || 32;
                ctx.drawImage(img,
                    cell.sx * k, cell.sy * k, sw * k, sh * k,
                    x, y, sw === 32 ? cs : Math.round(cs * sw / 32), sh === 32 ? cs : Math.round(cs * sh / 32));
            }
        }
    },

    /**
     * Draw a building using ONLY LPC structure sprites.
     * Resolves building type string or hex sprite path to an LPC sheet key.
     * Falls back to icon-on-colored-rect if no LPC match — NEVER uses hex sprites.
     */
    _drawLPCBuilding(ctx, buildingStr, dx, dy, ds) {
        let lpcKey = null;

        // Try direct type match first
        lpcKey = this._BUILDING_TO_LPC[buildingStr];

        // Try matching against sprite path substrings (innerMap.js stores paths like 'buildings/inn.png')
        if (!lpcKey && typeof buildingStr === 'string') {
            for (const [substr, key] of Object.entries(this._SPRITE_PATH_TO_LPC)) {
                if (buildingStr.includes(substr)) {
                    lpcKey = key;
                    break;
                }
            }
        }

        // Draw LPC sprite
        if (lpcKey) {
            const sprite = this._sheets.get(lpcKey);
            if (sprite && sprite.width && sprite.height) {
                // Buildings span 3 tiles wide, maintain aspect, anchor bottom-center
                const aspect = sprite.height / sprite.width;
                const bW = ds * 3;
                const bH = bW * Math.max(aspect, 1);
                const bX = dx + (ds - bW) / 2;
                const bY = dy + ds - bH;
                ctx.drawImage(sprite, bX, bY, bW, bH);
                return;
            }
        }

        // Final fallback: colored rectangle with initial letter — NO hex sprites
        ctx.fillStyle = 'rgba(80, 60, 40, 0.7)';
        ctx.fillRect(dx + 2, dy + 2, ds - 4, ds - 4);
        ctx.strokeStyle = 'rgba(120, 100, 70, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(dx + 2, dy + 2, ds - 4, ds - 4);

        const fontSize = Math.max(8, ds * 0.4);
        ctx.font = `600 ${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e0d0b0';
        const label = typeof buildingStr === 'string' ? buildingStr.charAt(0).toUpperCase() : '?';
        ctx.fillText(label, dx + ds / 2, dy + ds / 2);
    },

    /**
     * A building's name on a dark banner over its roof, its trade's glyph
     * before the name: gold for the town's, green for yours, amber while
     * yours is still going up.
     */
    _drawBuildingLabel(ctx, camera, bldg, q, r) {
        const T = this.TILE_SIZE;
        const screen = camera.worldToScreenFast(q * T + T / 2, r * T);
        const screenX = screen.x, screenY = screen.y;

        const fontSize = textPx(11 * labelZoom(camera.zoom));
        ctx.save();
        ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const isPlayerProp = bldg.isPlayerProperty;
        const isBuilding = isPlayerProp && bldg.propertyRef && bldg.propertyRef.underConstruction;
        const ink = isBuilding ? '#e0a040' : (isPlayerProp ? '#5fdc8f' : '#f5c542');

        const glyphSize = fontSize * 1.25;
        const gap = fontSize * 0.35;
        const padX = fontSize * 0.55;
        const textW = ctx.measureText(bldg.name).width;
        const pillW = padX * 2 + glyphSize + gap + textW;
        const pillH = Math.round(fontSize * 1.7);
        const pillX = screenX - pillW / 2;
        const pillY = screenY - pillH - 4;
        const midY = pillY + pillH / 2;

        ctx.fillStyle = 'rgba(12, 15, 22, 0.88)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, pillH * 0.3);
        else ctx.rect(pillX, pillY, pillW, pillH);
        ctx.fill();
        ctx.strokeStyle = isBuilding ? 'rgba(245, 197, 66, 0.7)'
            : isPlayerProp ? 'rgba(46, 204, 113, 0.6)' : 'rgba(245, 197, 66, 0.45)';
        ctx.lineWidth = isPlayerProp ? 1.5 : 1;
        ctx.stroke();

        drawGlyph(ctx, buildingGlyph(bldg), pillX + padX + glyphSize / 2, midY, glyphSize, ink, 2);
        inkText(ctx, bldg.name, pillX + padX + glyphSize + gap, midY, fontSize, ink, 'rgba(6, 8, 12, 0.75)');
        ctx.restore();
    },

    // ══════════════════════════════════════════════
    // LAYER 4 — FOG OF WAR + WEATHER TINTS
    // ══════════════════════════════════════════════
    _renderFogLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute origin screen position, then increment by ds
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        // Collect dim rects to batch-draw with a single fill
        const dimRects = [];     // flat [dx, dy, sz, ...]
        const impassRects = [];  // flat [dx, dy, sz, ...]
        const snowRects = [];
        const rainRects = [];
        // Collect frost tiles for batched drawing too
        const frostRects = [];   // flat [dx, dy, sz, alpha, ...]

        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            const dy0 = originY + (r - rMin) * ds;
            const dyFloor = Math.floor(dy0);
            const sz = Math.ceil(ds) + 1;

            if (dyFloor + sz < 0 || dyFloor > canvasH) continue;

            for (let q = qMin; q <= qMax; q++) {
                const tile = row[q];
                if (!tile.explored) continue;

                const dx = Math.floor(originX + (q - qMin) * ds);
                const dy = dyFloor;

                if (dx + sz < 0 || dx > canvasW) continue;

                // Dim explored-but-not-visible tiles
                if (!tile.visible) {
                    dimRects.push(dx, dy, sz);
                    continue; // not-visible tiles don't need weather/impass
                }

                // Impassable tint (skip tiles occupied by buildings, objects, or interior furniture)
                // (not on water or a crag (world/innerMap/cliffs.js): plainly no place to walk, and a red mesh over it is noise)
                if (!tile.subTerrain.passable && tile.baseTerrain !== 'water' && tile._cragTop === undefined && !tile.building && !tile.buildingInfo && !tile.customBuilding && !tile.customBuildingPart && !tile.customObject && !tile.customObjectPart && !tile._isInterior) {
                    impassRects.push(dx, dy, sz);
                }

                // Per-tile weather tint (skip in building interiors)
                if (tile.weatherType && !tile._isInterior) {
                    if (tile.weatherType === 'snow') {
                        snowRects.push(dx, dy, sz);
                    } else if (tile.weatherType === 'rain' || tile.weatherType === 'storm') {
                        rainRects.push(dx, dy, sz);
                    }
                }

                // Frost tint (skip in building interiors) — collect for batched rendering
                if (tile.effectiveTemp !== undefined && tile.effectiveTemp < 0.2 && !tile._isInterior) {
                    const frostAlpha = (0.2 - tile.effectiveTemp) * 0.3;
                    frostRects.push(dx, dy, sz, frostAlpha);
                }
            }
        }

        // Batch draw dim overlay
        if (dimRects.length > 0) {
            ctx.fillStyle = 'rgba(10, 14, 23, 0.55)';
            ctx.beginPath();
            for (let i = 0; i < dimRects.length; i += 3) ctx.rect(dimRects[i], dimRects[i+1], dimRects[i+2], dimRects[i+2]);
            ctx.fill();
        }
        // Batch draw impassable strokes
        if (impassRects.length > 0) {
            ctx.strokeStyle = 'rgba(255,80,80,0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < impassRects.length; i += 3) ctx.rect(impassRects[i] + 1, impassRects[i+1] + 1, impassRects[i+2] - 2, impassRects[i+2] - 2);
            ctx.stroke();
        }
        // Batch draw snow overlay
        if (snowRects.length > 0) {
            ctx.fillStyle = 'rgba(220, 230, 245, 0.12)';
            ctx.beginPath();
            for (let i = 0; i < snowRects.length; i += 3) ctx.rect(snowRects[i], snowRects[i+1], snowRects[i+2], snowRects[i+2]);
            ctx.fill();
        }
        // Batch draw rain overlay
        if (rainRects.length > 0) {
            ctx.fillStyle = 'rgba(30, 50, 80, 0.08)';
            ctx.beginPath();
            for (let i = 0; i < rainRects.length; i += 3) ctx.rect(rainRects[i], rainRects[i+1], rainRects[i+2], rainRects[i+2]);
            ctx.fill();
        }
        // Batch draw frost — group by quantized alpha to minimize fillStyle changes
        if (frostRects.length > 0) {
            // Group by rounded alpha (saves ctx state changes vs. per-tile fill)
            let lastAlpha = -1;
            for (let i = 0; i < frostRects.length; i += 4) {
                const a = frostRects[i + 3];
                const rounded = (a * 100 | 0) / 100;
                if (rounded !== lastAlpha) {
                    ctx.fillStyle = `rgba(200, 220, 255, ${rounded})`;
                    lastAlpha = rounded;
                }
                ctx.fillRect(frostRects[i], frostRects[i + 1], frostRects[i + 2], frostRects[i + 2]);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 5 — ENCOUNTERS
    // ══════════════════════════════════════════════
    _renderEncounterLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            for (let q = qMin; q <= qMax; q++) {
                const tile = row[q];
                if (!tile.visible || !tile.encounter || !tile.encounter.discovered) continue;

                const screen = camera.worldToScreenFast(q * T + T / 2, r * T + T / 2);
                const sx = screen.x, sy = screen.y;

                if (sx < -ds || sx > canvasW + ds) continue;
                if (sy < -ds || sy > canvasH + ds) continue;

                // Glow
                const glowRadius = ds * 0.35;
                const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
                grad.addColorStop(0, 'rgba(66, 245, 197, 0.25)');
                grad.addColorStop(1, 'rgba(66, 245, 197, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
                ctx.fill();

                // Marker
                drawMapMarker(ctx, glyphFor(tile.encounter.icon) || 'sparkle', sx, sy, Math.max(9, ds * 0.26),
                    { rim: 'rgba(66, 245, 197, 0.8)', color: '#a8f5df' });

                // Label (close zoom)
                if (camera.zoom > 0.8) {
                    drawMapText(ctx, tile.encounter.name, sx, sy + ds * 0.32, {
                        size: 10.5 * labelZoom(camera.zoom), min: 10, weight: 600, family: 'body', baseline: 'top', color: '#8ff0d4',
                    });
                }
            }
        }
    },
});
