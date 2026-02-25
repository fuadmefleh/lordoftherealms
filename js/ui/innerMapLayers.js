// ============================================
// INNER MAP RENDERER — RENDER LAYERS
// Layers 0–7: Terrain, Roads, Objects, Buildings,
// Fog, Encounters, NPCs, Player.
// Mixed into InnerMapRenderer via Object.assign.
// ============================================

Object.assign(InnerMapRenderer, {

    // ══════════════════════════════════════════════
    // LAYER 0 — TERRAIN
    // Draws ground fill tiles only. No objects, no buildings.
    // ══════════════════════════════════════════════

    _renderTerrainLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const terrainKey = this._seasonKey('terrain');
        const terrainSheet = this._sheets.get(terrainKey);

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                const screen = camera.worldToScreen(q * T, r * T);
                const dx = Math.floor(screen.x);
                const dy = Math.floor(screen.y);
                const sz = Math.ceil(ds) + 1;

                // Culling
                if (dx + sz < 0 || dx > ctx.canvas.width) continue;
                if (dy + sz < 0 || dy > ctx.canvas.height) continue;

                // Unexplored: black
                if (!tile.explored) {
                    ctx.fillStyle = '#0a0e17';
                    ctx.fillRect(dx, dy, sz, sz);
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

                // Subtle tile grid
                ctx.strokeStyle = tile.visible ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(dx, dy, sz, sz);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 1 — ROADS
    // ══════════════════════════════════════════════

    _renderRoadLayer(ctx, camera) {
        if (!InnerMap.roads || InnerMap.roads.length === 0) return;

        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const terrainKey = this._seasonKey('terrain');
        const terrainSheet = this._sheets.get(terrainKey);
        const dirtFills = this._terrainFills ? this._terrainFills.dirt : null;

        for (const road of InnerMap.roads) {
            const tile = InnerMap.getTile(road.q, road.r);
            if (!tile || !tile.visible || !tile.subTerrain.passable || tile.building) continue;

            const screen = camera.worldToScreen(road.q * T, road.r * T);
            const dx = Math.floor(screen.x);
            const dy = Math.floor(screen.y);
            const sz = Math.ceil(ds) + 1;

            if (dx + sz < 0 || dx > ctx.canvas.width) continue;
            if (dy + sz < 0 || dy > ctx.canvas.height) continue;

            if (terrainSheet && dirtFills && dirtFills.length > 0) {
                const hash = (Math.abs((road.q * 73856093 ^ road.r * 19349663))) >>> 0;
                const pick = dirtFills[hash % dirtFills.length];
                ctx.drawImage(terrainSheet, pick.col * 32, pick.row * 32, 32, 32, dx, dy, sz, sz);
            } else {
                ctx.fillStyle = 'rgba(139, 115, 85, 0.6)';
                ctx.fillRect(dx, dy, sz, sz);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 2 — OBJECTS (trees, plants, rocks, flowers)
    // These are separate from terrain — drawn on their own layer.
    // Collected and sorted by Y-bottom for correct painter's-algorithm overlap.
    // ══════════════════════════════════════════════

    _renderObjectLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;

        // Collect all object overlays to sort by Y
        const objects = [];

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building) continue; // buildings have their own layer
                if (tile.customObjectPart) continue; // non-anchor part of a custom object
                if (tile.customObject) continue;     // anchor — collected separately below

                // Skip built-in objects when "Custom Objects Only" is enabled
                if (window.gameOptions?.customObjectsOnly) {
                    continue;
                }

                const overlay = this._getObjectOverlay(tile);
                if (!overlay) continue;

                // Sort key: bottom edge in world space (rocks are 2×2, extend further down)
                const tileSpan = overlay.type === 'rock' ? 2 : 1;
                objects.push({ q, r, overlay, sortY: (r + tileSpan) * T });
            }
        }

        // Collect custom editor-authored objects (anchor tiles only)
        if (typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
            for (let r = 0; r < InnerMap.height; r++) {
                for (let q = 0; q < InnerMap.width; q++) {
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
            const screen = camera.worldToScreen(obj.q * T, obj.r * T);
            const dx = Math.floor(screen.x);
            const dy = Math.floor(screen.y);

            // Culling
            if (dx + ds * 3 < 0 || dx > ctx.canvas.width + ds) continue;
            if (dy + ds * 3 < 0 || dy > ctx.canvas.height + ds) continue;

            // ── Custom editor objects ──
            if (obj.customDef) {
                const def = obj.customDef;
                const singleImg = def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null;
                for (const tDef of def.tiles) {
                    const img = tDef.sheetPath ? CustomObjects.getImage(tDef.sheetPath) : singleImg;
                    if (!img || !img.complete) continue;
                    const tq = obj.q + tDef.localCol;
                    const tr = obj.r + tDef.localRow;
                    const tScreen = camera.worldToScreen(tq * T, tr * T);
                    const tdx = Math.floor(tScreen.x);
                    const tdy = Math.floor(tScreen.y);
                    if (tdx + ds * 2 < 0 || tdx > ctx.canvas.width + ds) continue;
                    if (tdy + ds * 2 < 0 || tdy > ctx.canvas.height + ds) continue;
                    ctx.drawImage(img, tDef.sx, tDef.sy, tDef.sw, tDef.sh, tdx, tdy, ds, ds);
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

            if (o.type === 'tree') {
                // Trees: scale to tile width, extend upward from tile bottom
                const scale = ds / o.sw;  // fit tile width
                const ow = ds;
                const oh = o.sh * scale;
                const ox = dx;
                const oy = dy + ds - oh;  // anchor bottom of tree at bottom of tile
                ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, ox, oy, ow, oh);
            } else if (o.type === 'plant' || o.type === 'flower' || o.type === 'mushroom') {
                // Small objects: centered in tile, ~60% tile size
                const ratio = 0.6;
                const ow = ds * ratio;
                const oh = ds * ratio;
                const ox = dx + (ds - ow) / 2;
                const oy = dy + (ds - oh) / 2;
                ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, ox, oy, ow, oh);
            } else if (o.type === 'rock') {
                // Rocks are 2×2 tile sprites (64×64 source px).
                // Draw at full 2×2 tile area, anchored at top-left of placement tile.
                const tilesW = o.sw / 32;  // 2
                const tilesH = o.sh / 32;  // 2
                const ow = ds * tilesW;
                const oh = ds * tilesH;
                const ox = dx + (ds - ow) / 2; // center horizontally on origin tile
                const oy = dy + ds - oh;        // anchor bottom edge at bottom of origin tile
                ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, ox, oy, ow, oh);
            } else {
                // Default: fill tile
                ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy, ds, ds);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 3 — BUILDINGS (LPC structures ONLY, no hex sprites)
    // ══════════════════════════════════════════════

    _renderBuildingLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;

        // Collect legacy AND custom building anchors, sorted by Y for correct overlap
        const buildings = [];

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
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
            const screen = camera.worldToScreen(b.q * T, b.r * T);
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
                const sz = Math.max(14, ds * 0.35);
                ctx.font = `${sz}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('🔨', dx + ds / 2, dy + ds / 2);
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
        const cs = Math.ceil(ds);
        const screen = camera.worldToScreen(anchorQ * T, anchorR * T);
        const ax = Math.floor(screen.x);
        const ay = Math.floor(screen.y);

        for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
            const lyrArr = def.layers[lyrName];
            if (!lyrArr || !lyrArr.length) continue;
            for (const cell of lyrArr) {
                const x = ax + cell.q * cs;
                const y = ay + cell.r * cs;
                if (x + cs < 0 || x > ctx.canvas.width  + cs) continue;
                if (y + cs < 0 || y > ctx.canvas.height + cs) continue;
                const img = CustomBuildings.getImg(cell.sheetPath);
                if (!img) continue;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img,
                    cell.sx, cell.sy, cell.sw || 32, cell.sh || 32,
                    Math.floor(x), Math.floor(y), cs, cs);
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

    _drawBuildingLabel(ctx, camera, bldg, q, r) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const screen = camera.worldToScreen(q * T + T / 2, r * T);

        const fontSize = Math.max(8, 10 * camera.zoom);
        ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const labelText = `${bldg.icon} ${bldg.name}`;
        const metrics = ctx.measureText(labelText);
        const pillW = metrics.width + 10;
        const pillH = fontSize + 6;
        const pillX = screen.x - pillW / 2;
        const pillY = screen.y - pillH - 4;

        ctx.fillStyle = 'rgba(16, 20, 28, 0.85)';
        ctx.beginPath();
        const rad = 4;
        ctx.moveTo(pillX + rad, pillY);
        ctx.lineTo(pillX + pillW - rad, pillY);
        ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + rad);
        ctx.lineTo(pillX + pillW, pillY + pillH - rad);
        ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - rad, pillY + pillH);
        ctx.lineTo(pillX + rad, pillY + pillH);
        ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - rad);
        ctx.lineTo(pillX, pillY + rad);
        ctx.quadraticCurveTo(pillX, pillY, pillX + rad, pillY);
        ctx.closePath();
        ctx.fill();

        const isPlayerProp = bldg.isPlayerProperty;
        const isBuilding = isPlayerProp && bldg.propertyRef && bldg.propertyRef.underConstruction;
        if (isBuilding) {
            ctx.strokeStyle = 'rgba(245, 197, 66, 0.7)';
            ctx.lineWidth = 1.5;
        } else if (isPlayerProp) {
            ctx.strokeStyle = 'rgba(46, 204, 113, 0.6)';
            ctx.lineWidth = 1.5;
        } else {
            ctx.strokeStyle = 'rgba(245, 197, 66, 0.4)';
            ctx.lineWidth = 1;
        }
        ctx.stroke();

        ctx.fillStyle = isBuilding ? '#e0a040' : (isPlayerProp ? '#2ecc71' : '#f5c542');
        ctx.fillText(labelText, screen.x, pillY + pillH - 3);
    },

    // ══════════════════════════════════════════════
    // LAYER 4 — FOG OF WAR + WEATHER TINTS
    // ══════════════════════════════════════════════

    _renderFogLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored) continue;

                const screen = camera.worldToScreen(q * T, r * T);
                const dx = Math.floor(screen.x);
                const dy = Math.floor(screen.y);
                const sz = Math.ceil(ds) + 1;

                if (dx + sz < 0 || dx > ctx.canvas.width) continue;
                if (dy + sz < 0 || dy > ctx.canvas.height) continue;

                // Dim explored-but-not-visible tiles
                if (!tile.visible) {
                    ctx.fillStyle = 'rgba(10, 14, 23, 0.55)';
                    ctx.fillRect(dx, dy, sz, sz);
                }

                // Impassable tint (skip tiles occupied by buildings)
                if (!tile.subTerrain.passable && tile.visible && !tile.building && !tile.buildingInfo && !tile.customBuilding && !tile.customBuildingPart) {
                    ctx.strokeStyle = 'rgba(255,80,80,0.3)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(dx + 1, dy + 1, sz - 2, sz - 2);
                }

                // Per-tile weather tint
                if (tile.visible && tile.weatherType) {
                    if (tile.weatherType === 'snow') {
                        ctx.fillStyle = 'rgba(220, 230, 245, 0.12)';
                        ctx.fillRect(dx, dy, sz, sz);
                    } else if (tile.weatherType === 'rain' || tile.weatherType === 'storm') {
                        ctx.fillStyle = 'rgba(30, 50, 80, 0.08)';
                        ctx.fillRect(dx, dy, sz, sz);
                    }
                }

                // Frost tint
                if (tile.visible && tile.effectiveTemp !== undefined && tile.effectiveTemp < 0.2) {
                    const frostAlpha = (0.2 - tile.effectiveTemp) * 0.3;
                    ctx.fillStyle = `rgba(200, 220, 255, ${frostAlpha.toFixed(3)})`;
                    ctx.fillRect(dx, dy, sz, sz);
                }
            }
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 5 — ENCOUNTERS
    // ══════════════════════════════════════════════

    _renderEncounterLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible || !tile.encounter || !tile.encounter.discovered) continue;

                const screen = camera.worldToScreen(q * T + T / 2, r * T + T / 2);

                if (screen.x < -ds || screen.x > ctx.canvas.width + ds) continue;
                if (screen.y < -ds || screen.y > ctx.canvas.height + ds) continue;

                // Glow
                const glowRadius = ds * 0.35;
                const grad = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, glowRadius);
                grad.addColorStop(0, 'rgba(66, 245, 197, 0.25)');
                grad.addColorStop(1, 'rgba(66, 245, 197, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, glowRadius, 0, Math.PI * 2);
                ctx.fill();

                // Icon
                const iconSize = Math.max(12, ds * 0.5);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tile.encounter.icon, screen.x, screen.y);

                // Label (close zoom)
                if (camera.zoom > 0.8) {
                    const fontSize = Math.max(6, 7 * camera.zoom);
                    ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = 'rgba(66, 245, 197, 0.8)';
                    ctx.shadowColor = 'rgba(0,0,0,0.6)';
                    ctx.shadowBlur = 2;
                    ctx.fillText(tile.encounter.name, screen.x, screen.y + ds * 0.3);
                    ctx.shadowBlur = 0;
                }
            }
        }
    },

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

            const screen = camera.worldToScreen(worldX, worldY);
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

        // Get interpolated player position (smooth walking)
        const pos = InnerMap.getPlayerWorldPos();
        const screen = camera.worldToScreen(pos.x, pos.y);

        // Determine animation and facing direction
        let anim = 'idle';
        let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;

        if (pos.walking) {
            anim = 'walk';
            direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
            this._playerFacing = direction;
        } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
            anim = 'idle';
            direction = InnerMap.getDirectionToward(
                InnerMap._activeInteraction.anchorQ,
                InnerMap._activeInteraction.anchorR
            );
            this._playerFacing = direction;
        }

        // Glow
        const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, ds * 0.5);
        gradient.addColorStop(0, 'rgba(245,197,66,0.3)');
        gradient.addColorStop(1, 'rgba(245,197,66,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, ds * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw player as LPC character if available
        const playerPreset = this._playerPreset || 'male_noble';

        if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
            const charW = ds * 1.2;
            const charH = ds * 1.8;
            const cx = screen.x - charW / 2;
            const cy = screen.y - charH + ds * 0.3;

            // Shadow
            ctx.beginPath();
            ctx.ellipse(screen.x, screen.y + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fill();

            InnerMapCharacters.drawCharacter(ctx, playerPreset, anim, direction, now,
                cx, cy, charW, charH);
        } else {
            // Fallback: compass icon
            const iconSize = Math.max(16, ds * 0.55);
            ctx.font = `${iconSize}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#ffffff';
            ctx.fillText('🧭', screen.x, screen.y);
            ctx.shadowBlur = 0;
        }

        // Label
        if (camera.zoom > 0.5) {
            const fontSize = Math.max(8, 10 * camera.zoom);
            ctx.font = `700 ${fontSize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#f5c542';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText('You', screen.x, screen.y + ds * 0.35);
            ctx.shadowBlur = 0;
        }
    },

    // ══════════════════════════════════════════════
    // GROUND OVERLAYS — flat water / ice / waterfall tints
    // Drawn BEFORE the depth-sorted pass so they sit on the ground.
    // ══════════════════════════════════════════════

    _renderGroundOverlays(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building || tile.customObjectPart || tile.customObject) continue;

                const o = this._getObjectOverlay(tile);
                if (!o) continue;
                if (o.type !== 'water_overlay' && o.type !== 'ice_overlay' && o.type !== 'waterfall') continue;

                const screen = camera.worldToScreen(q * T, r * T);
                const dx = Math.floor(screen.x);
                const dy = Math.floor(screen.y);
                const sz = Math.ceil(ds) + 1;

                if (dx + sz < 0 || dx > ctx.canvas.width) continue;
                if (dy + sz < 0 || dy > ctx.canvas.height) continue;

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
    _getActiveObjectTiles(def, customObjData) {
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
            if (best && best.tiles && best.tiles.length > 0) return best.tiles;
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
            if (activeStage && activeStage.tiles && activeStage.tiles.length > 0) return activeStage.tiles;
        }
        // Season variants — healthy appearance per season
        if (def.seasonVariants) {
            const season = (typeof InnerMap !== 'undefined' ? (InnerMap.season || 'Summer') : 'Summer');
            const sv = def.seasonVariants[season.toLowerCase()];
            if (sv && sv.length > 0) return sv;
        }
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
        const now  = performance.now() / 1000;
        const charReady = typeof InnerMapCharacters !== 'undefined' && InnerMapCharacters.isReady();
        const self = this;
        const items = []; // { sortY, draw() }

        // ── Phase 1: Collect objects (trees, plants, rocks, custom objects) ──────
        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building) continue;
                if (tile.customObjectPart) continue;

                // Custom editor objects (anchor tile)
                if (tile.customObject && typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
                    const def = CustomObjects.getDef(tile.customObject.defId);
                    if (def) {
                        const singleImg = def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null;
                        // For single-sheet objects, skip if image missing; for multi-sheet, check per-tile
                        if (def.sheetPath && (!singleImg || !singleImg.complete)) { continue; }
                        // Sort by origin row (bottom of anchor tile) so characters
                        // at the same y-level as the origin draw on top of the object.
                        const sortY = (r + 1) * T;
                        const oq = q, or2 = r;
                        const customObjRef = tile.customObject;  // capture for health-state lookup

                        // Check if this object is being interacted with
                        const ia = InnerMap._activeInteraction;
                        const isInteracting = ia && !ia.done && ia.anchorQ === q && ia.anchorR === r;

                        items.push({ sortY, zLayer: 1, draw() {
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

                            // Resolve tile set based on current health (supports damage stages)
                            const activeTiles = self._getActiveObjectTiles(def, customObjRef);
                            for (const td of activeTiles) {
                                const img = td.sheetPath ? CustomObjects.getImage(td.sheetPath) : singleImg;
                                if (!img || !img.complete) continue;
                                const tScreen = camera.worldToScreen((oq + td.localCol) * T, (or2 + td.localRow) * T);
                                const tdx = Math.floor(tScreen.x) + shakeX;
                                const tdy = Math.floor(tScreen.y) + shakeY;
                                if (tdx + ds * 2 < 0 || tdx > ctx.canvas.width + ds) continue;
                                if (tdy + ds * 2 < 0 || tdy > ctx.canvas.height + ds) continue;
                                ctx.drawImage(img, td.sx, td.sy, td.sw, td.sh, tdx, tdy, ds, ds);
                            }

                            if (isInteracting && alpha < 1.0) ctx.globalAlpha = 1.0;
                        }});
                    }
                    continue;
                }

                // Built-in object overlays (tree / plant / rock / flower / mushroom)
                // Skip when "Custom Objects Only" is enabled
                if (window.gameOptions?.customObjectsOnly) continue;

                const o = this._getObjectOverlay(tile);
                if (!o) continue;
                if (o.type === 'water_overlay' || o.type === 'ice_overlay' || o.type === 'waterfall') continue;

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
        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible) continue;

                if (tile.building) {
                    const screen = camera.worldToScreen(q * T, r * T);
                    const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                    if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                    if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                    const sortY = (r + 1) * T;
                    const bq = q, br = r;
                    items.push({ sortY, zLayer: 1, draw() {
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
                        const screen = camera.worldToScreen(q * T, r * T);
                        const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                        if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                        if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                        // Sort by origin row so characters above origin draw underneath the building
                        const sortY = (r + 1) * T;
                        const cq = q, cr = r;
                        items.push({ sortY, zLayer: 1, draw() {
                            self._drawCustomBuilding(ctx, camera, def, cq, cr, ds);
                        }});
                    }
                }
            }
        }

        // ── Phase 3: Collect NPCs ───────────────────────────────────────────────
        if (InnerMap.npcs && InnerMap.npcs.length > 0) {
            for (const npc of InnerMap.npcs) {
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

                const screen = camera.worldToScreen(worldX, worldY);
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
                }});
            }
        }

        // ── Phase 4: Collect Player ─────────────────────────────────────────────
        {
            const pos = InnerMap.getPlayerWorldPos();
            const screen = camera.worldToScreen(pos.x, pos.y);
            let anim = 'idle';
            let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;
            if (pos.walking) {
                anim = 'walk';
                direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
                this._playerFacing = direction;
            } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
                // During interaction: face the object, use idle
                anim = 'idle';
                direction = InnerMap.getDirectionToward(
                    InnerMap._activeInteraction.anchorQ,
                    InnerMap._activeInteraction.anchorR
                );
                this._playerFacing = direction;
            }
            const sortY = pos.y + T / 2;   // bottom-of-tile for consistent depth sort
            const px = screen.x, py = screen.y;
            const pAnim = anim, pDir = direction;
            const playerPreset = this._playerPreset || 'male_noble';

            items.push({ sortY, zLayer: 2, draw() {
                // Glow
                const gradient = ctx.createRadialGradient(px, py, 0, px, py, ds * 0.5);
                gradient.addColorStop(0, 'rgba(245,197,66,0.3)');
                gradient.addColorStop(1, 'rgba(245,197,66,0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(px, py, ds * 0.5, 0, Math.PI * 2);
                ctx.fill();

                if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
                    const charW = ds * 1.2, charH = ds * 1.8;
                    const cx = px - charW / 2, cy = py - charH + ds * 0.3;
                    ctx.beginPath();
                    ctx.ellipse(px, py + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.fill();
                    InnerMapCharacters.drawCharacter(ctx, playerPreset, pAnim, pDir, now, cx, cy, charW, charH);
                } else {
                    const iconSize = Math.max(16, ds * 0.55);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText('🧭', px, py);
                    ctx.shadowBlur = 0;
                }
                if (camera.zoom > 0.5) {
                    const fontSize = Math.max(8, 10 * camera.zoom);
                    ctx.font = `700 ${fontSize}px 'Inter', sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = '#f5c542';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.fillText('You', px, py + ds * 0.35);
                    ctx.shadowBlur = 0;
                }
            }});
        }

        // ── Phase 5: Sort by Y and draw ─────────────────────────────────────────
        items.sort((a, b) => a.sortY - b.sortY || a.zLayer - b.zLayer);
        for (const item of items) item.draw();
    },
});
