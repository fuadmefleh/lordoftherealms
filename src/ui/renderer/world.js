// Renderer — world methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';
import { drawHoverCoords } from '../hoverCoords.js';

Object.assign(Renderer.prototype, {
    /**
     * Main render loop call
     */
    render(deltaTime) {
        this.time += deltaTime;
        this.waterAnimFrame = Math.floor(this.time / this.waterAnimInterval);
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);

        if (!this.world) return;

        ctx.save();

        // The cloud sea over the uncharted world (renderer/fog.js)
        this.renderUncharted(ctx);

        // Render hex grid
        this.renderHexGrid(ctx);

        // Render rivers
        this.renderRivers(ctx);

        // Render territory borders
        this.renderTerritoryBorders(ctx);

        // Render trade route lines (map mode)
        this.renderTradeRoutes(ctx);

        // Render settlements
        this.renderSettlements(ctx);

        // Render improvements / POI
        this.renderImprovements(ctx);

        // Render holy sites & cultural buildings
        this.renderHolySitesAndCulture(ctx);

        // Render Great Works standing and rising (systems/patronage.js)
        this.renderGreatWorks(ctx);

        // Render infrastructure (roads, bridges, irrigation)
        this.renderInfrastructure(ctx);

        // The roads' tier and repair, closed passes, fords, toll gates, canals, works (world/transport.js)
        this.renderRoadState(ctx);

        // Render player-built structures (Farms, Mines, Temples)
        this.renderBuiltStructures(ctx);

        // Render resources
        this.renderResources(ctx);

        // Cloud banks along the edge of the known world (renderer/fog.js)
        this.renderFrontierFog(ctx);

        // The season's light over the land; units, labels and marks stay true-coloured (renderer/atmosphere.js)
        this.renderSeasonGrade(ctx);

        // Render path preview
        if (this.player && this.player.path) {
            this.renderPath(ctx, this.player.path);
        }

        // Render reachable hexes
        if (this.reachableHexes) {
            this.renderReachableHexes(ctx);
        }

        // Render player (and their waiting ships, beneath the player icon)
        if (this.player) {
            this.renderPlayerShips(ctx);
            this.renderPlayer(ctx);
        }

        // Render hover highlight
        if (this.hoveredHex) {
            this.renderHoverMark(ctx, this.hoveredHex.q, this.hoveredHex.r);
        }

        // Render selected highlight
        if (this.selectedHex) {
            this.renderSelectionMark(ctx, this.selectedHex.q, this.selectedHex.r);
        }

        // What your (possibly doctored) maps claim about unseen land
        this.renderMapDeceptions(ctx);
        // Uncharted places you have found or heard of (systems/discovery.js)
        this.renderDiscoveries(ctx);
        // Outlaw lairs you have found or heard of (systems/outlawLairs.js)
        this.renderOutlawLairs(ctx);
        // Mines, quarries, sheep runs around the towns and their deposits (world/hinterland.js)
        this.renderHinterland(ctx);
        // Your holdings under siege (systems/holdingSieges.js)
        this.renderHoldingSieges(ctx);

        // Render units
        this.renderUnits(ctx);

        // Render caravans
        this.renderCaravans(ctx);

        // The trade map: known prices of one good (map mode 'prices', renderer/tradeMap.js)
        this.renderTradeMap(ctx);

        // Render weather (renderer/atmosphere.js), then frame the map
        this.renderWeather(ctx);
        this.renderVignette(ctx);

        // Render all labels (with collision detection)
        this.renderLabels(ctx);

        // Hovered tile coordinates next to the cursor
        if (this.hoveredHex) {
            drawHoverCoords(ctx, this.canvas, this.mouseX, this.mouseY, this.hoveredHex.q, this.hoveredHex.r);
        }

        ctx.restore();
    },

    /**
     * Add a label to the render queue with priority
     * @param {string} text - The label text
     * @param {number} x - Screen x position
     * @param {number} y - Screen y position
     * @param {number} priority - Higher priority labels are rendered first (1-10)
     * @param {object} style - Text style (font, fillStyle, strokeStyle, etc.)
     */
    addLabel(text, x, y, priority, style) {
        this.labels.push({ text, x, y, priority, style });
    },

    /**
     * Check if two label bounds overlap
     */
    labelsOverlap(label1, label2) {
        const padding = this.labelPadding;
        return !(
            label1.right + padding < label2.left - padding ||
            label1.left - padding > label2.right + padding ||
            label1.bottom + padding < label2.top - padding ||
            label1.top - padding > label2.bottom + padding
        );
    },

    /**
     * Measure and get bounds for a label
     */
    getLabelBounds(ctx, label) {
        ctx.font = label.style.font;
        const metrics = ctx.measureText(label.text);
        // The font's pixel size (a leading weight like "700 13px" is not the size)
        const m = /(\d+(?:\.\d+)?)px/.exec(label.style.font);
        const height = m ? parseFloat(m[1]) : 12;
        const pad = label.style.plaque ? height * 0.6 : 0;
        const width = metrics.width + pad * 2;
        const top = label.style.textBaseline === 'top' ? label.y - pad * 0.4 : label.y - height / 2 - pad * 0.4;

        return {
            left: label.x - width / 2,
            right: label.x + width / 2,
            top,
            bottom: top + height + pad * 0.8
        };
    },

    /**
     * A small banner behind a place name: dark plate, a gold hairline, the
     * owning realm's colour down the left edge, and a crown for a capital.
     */
    drawLabelPlaque(ctx, b, plaque) {
        const w = b.right - b.left, h = b.bottom - b.top;
        const r = Math.min(4, h / 2);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(b.left + r, b.top);
        ctx.arcTo(b.right, b.top, b.right, b.bottom, r);
        ctx.arcTo(b.right, b.bottom, b.left, b.bottom, r);
        ctx.arcTo(b.left, b.bottom, b.left, b.top, r);
        ctx.arcTo(b.left, b.top, b.right, b.top, r);
        ctx.closePath();
        ctx.fillStyle = 'rgba(12, 15, 22, 0.78)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = plaque.capital ? 'rgba(245, 197, 66, 0.85)' : 'rgba(245, 197, 66, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (plaque.accent) {
            ctx.clip();
            ctx.fillStyle = plaque.accent;
            ctx.fillRect(b.left, b.top, Math.max(3, h * 0.18), h);
        }
        ctx.restore();
        if (plaque.capital) {
            ctx.save();
            ctx.font = `${Math.round(h * 0.8)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('👑', (b.left + b.right) / 2, b.top + h * 0.2);
            ctx.restore();
        }
    },

    /**
     * Render all non-overlapping labels based on priority
     */
    renderLabels(ctx) {
        if (this.labels.length === 0) return;

        // Sort labels by priority (highest first)
        this.labels.sort((a, b) => b.priority - a.priority);

        const renderedLabels = [];

        // Render labels that don't overlap with higher priority ones
        for (const label of this.labels) {
            const bounds = this.getLabelBounds(ctx, label);
            
            // Check if this label overlaps with any already rendered label
            let overlaps = false;
            for (const rendered of renderedLabels) {
                if (this.labelsOverlap({ ...label, ...bounds }, { ...rendered, ...rendered.bounds })) {
                    overlaps = true;
                    break;
                }
            }

            // If no overlap, render this label
            if (!overlaps) {
                // Apply style
                ctx.font = label.style.font;
                ctx.textAlign = label.style.textAlign || 'center';
                ctx.textBaseline = label.style.textBaseline || 'middle';

                if (label.style.plaque) this.drawLabelPlaque(ctx, bounds, label.style.plaque);

                // Draw shadow if specified
                if (label.style.shadowColor) {
                    ctx.fillStyle = label.style.shadowColor;
                    ctx.fillText(label.text, label.x + 1, label.y + 1);
                }

                // Draw main text
                ctx.fillStyle = label.style.fillStyle;
                ctx.fillText(label.text, label.x, label.y);

                // Save this label as rendered
                renderedLabels.push({ ...label, bounds });
            }
        }

        // Clear labels for next frame
        this.labels = [];
    },

    /**
     * Render active caravans
     */
    renderCaravans(ctx) {
        if (!this.player || !this.player.caravans) return;

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const worldWidthPx = hexWidth * this.world.width;

        for (const caravan of this.player.caravans) {
            if (caravan.status !== 'traveling') continue;

            const start = this.getHexPixelPos(caravan.fromPos.q, caravan.fromPos.r);
            const end = this.getHexPixelPos(caravan.toPos.q, caravan.toPos.r);

            // Handle wrapping logic for shortest path interpolation
            let sx = start.x;
            let ex = end.x;
            const sy = start.y;
            const ey = end.y;

            if (Math.abs(ex - sx) > worldWidthPx / 2) {
                if (ex > sx) ex -= worldWidthPx;
                else ex += worldWidthPx;
            }

            const totalDays = Math.max(1, Math.ceil(caravan.distance / 2));
            const progress = 1 - (caravan.daysRemaining / totalDays);

            // Interpolate
            const cx = sx + (ex - sx) * progress;
            const cy = sy + (ey - sy) * progress;

            // Get screen position
            const screen = this.camera.worldToScreen(cx, cy);

            // Check visibility
            if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
            if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

            const renderSize = size * this.camera.zoom;

            // Draw Icon
            ctx.font = `${renderSize * 0.8}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Your caravan: a merchant token with a gold halo
            this.renderUnitToken(ctx, { type: 'trade_caravan', q: 0, r: 0, escort: { by: 'player' }, icon: '🐪' }, screen.x, screen.y, renderSize);

            // Draw Label
            if (this.camera.zoom > 0.6) {
                ctx.font = `bold 12px sans-serif`;
                ctx.fillStyle = '#ffcc00';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 2;
                ctx.strokeText(`${caravan.daysRemaining} days`, screen.x, screen.y - renderSize * 0.6);
                ctx.fillText(`${caravan.daysRemaining} days`, screen.x, screen.y - renderSize * 0.6);
            }
        }
    },

    /**
     * Get pixel position of a hex (Offset Coordinates)
     */
    getHexPixelPos(q, r) {
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;

        const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
        const py = r * rowHeight;
        return { x: px, y: py };
    },

    /**
     * Render the hex grid terrain
     */
    renderHexGrid(ctx) {
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;
        const rowHeight = hexWidth * 0.75;

        // Determine visible bounds in Offset Grid (Row/Col)

        // Approximate visible range
        const padding = 2;
        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;

        const minR = Math.max(0, startRow);
        const maxR = Math.min(world.height - 1, endRow);
        this._frontier = [];

        for (let r = minR; r <= maxR; r++) {
            // Apply Even-row offset (C# logic: y % 2 == 0 -> offset)
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;

            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            const minQ = startCol;
            const maxQ = endCol;

            for (let q = minQ; q <= maxQ; q++) {
                // Handle wrapping
                const wq = Hex.wrapQ(q, world.width);
                const tile = world.tiles[r][wq];

                if (!tile.explored) {
                    // FOW: nothing is drawn here — the cloud sea beneath shows through,
                    // and frontier hexes get a bank of cloud over the edge (renderer/fog.js)
                    const fpx = q * hexWidth + offsetX;
                    const fpy = r * rowHeight;
                    const fscreen = this.camera.worldToScreen(fpx, fpy);
                    if (fscreen.x < -hexWidth * this.camera.zoom || fscreen.x > this.canvas.width + hexWidth * this.camera.zoom) continue;
                    if (fscreen.y < -hexHeight * this.camera.zoom || fscreen.y > this.canvas.height + hexHeight * this.camera.zoom) continue;
                    this.noteFrontierHex(q, r, wq, fscreen.x, fscreen.y);
                    continue;
                }

                // Calculate Pixel Position using Offset Logic
                // q is column (x), r is row (y)
                const px = q * hexWidth + offsetX;
                const py = r * rowHeight;

                const screen = this.camera.worldToScreen(px, py);

                // Cull if off-screen (extra check)
                if (screen.x < -hexWidth * this.camera.zoom || screen.x > this.canvas.width + hexWidth * this.camera.zoom) continue;
                if (screen.y < -hexHeight * this.camera.zoom || screen.y > this.canvas.height + hexHeight * this.camera.zoom) continue;

                const renderSize = size * this.camera.zoom;

                // Check if we have a PNG sprite for this terrain
                const imgName = this.getTileImage(tile);

                // Log missing assets (once per session)
                if (!this.missingAssets) this.missingAssets = new Set();

                if (!imgName) {
                    if (!this.missingAssets.has(`TERRAIN_${tile.terrain.id}`)) {
                        console.warn(`[Renderer] No image mapping for terrain: ${tile.terrain.id}`);
                        this.missingAssets.add(`TERRAIN_${tile.terrain.id}`);
                    }
                } else if (!this.tileSprites.has(imgName)) {
                    if (!this.missingAssets.has(imgName)) {
                        console.warn(`[Renderer] Image asset missing: ${imgName} (for ${tile.terrain.id})`);
                        this.missingAssets.add(imgName);
                    }
                }

                const sprite = imgName ? this.tileSprites.get(imgName) : null;
                
                // Check for bridge first (road + river overlap)
                const bridgeImgName = this.getBridgeImage(tile, q, r, world.width, world.height);
                const bridgeSprite = bridgeImgName ? this.tileSprites.get(bridgeImgName) : null;
                
                // If we have a bridge, use it instead of separate river and road
                let riverSprite = null;
                let roadSprite = null;
                
                if (bridgeSprite) {
                    // Bridge replaces both river and road
                    roadSprite = bridgeSprite;
                } else {
                    // No bridge, render river and road separately
                    const riverImgName = this.getRiverImage(tile, q, r, world.width, world.height);
                    riverSprite = riverImgName ? this.tileSprites.get(riverImgName) : null;
                    const roadImgName = this.getRoadImage(tile, q, r, world.width, world.height);
                    roadSprite = roadImgName ? this.tileSprites.get(roadImgName) : null;
                }

                if (sprite || riverSprite || roadSprite) {
                    this.renderSpriteHex(ctx, screen.x, screen.y, renderSize, sprite, tile, riverSprite, roadSprite);
                }
            }
        }
    },

    /**
     * Render a hex with a solid color fill
     */
    renderColoredHex(ctx, cx, cy, size, tile) {
        const corners = Hex.hexCorners(cx, cy, size);

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();

        // Fill with terrain color
        let fillColor = tile.terrain.color;

        // Dim if not currently visible (explored but not in LOS)
        if (!tile.visible) {
            fillColor = this.dimColor(fillColor, 0.45);
        }

        // Kingdom territory tint
        if (tile.kingdom && tile.visible) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                // Blend territory color
                ctx.fillStyle = fillColor;
                ctx.fill();

                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();

                // Subtle internal hex outline
                ctx.strokeStyle = this.dimColor(kingdom.color, 0.2);
                ctx.lineWidth = 0.5;
                ctx.stroke();
                return;
            }
        }

        ctx.fillStyle = fillColor;
        ctx.fill();

        // Subtle hex border
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    },

    /**
     * Render a hex with a PNG sprite (clipped to hex shape)
     */
    renderSpriteHex(ctx, cx, cy, size, sprite, tile, overlaySprite = null, roadSprite = null) {
        // Use sprite-derived isometric corners (measured from 256×384 tile pixel data)
        const sX = 0.866 * size;
        const corners = [
            { x: cx,       y: cy - 0.732 * size },
            { x: cx + sX,  y: cy - 0.305 * size },
            { x: cx + sX,  y: cy + 0.567 * size },
            { x: cx,       y: cy + 1.000 * size },
            { x: cx - sX,  y: cy + 0.567 * size },
            { x: cx - sX,  y: cy - 0.305 * size },
        ];

        ctx.save();



        // Draw sprite (Unclipped to allow overlap)
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;

        let targetWidth = hexWidth;
        let targetHeight = targetWidth;

        // Scale to COVER hex (max of width/height ratios)
        if (sprite && sprite.width && sprite.height) {
            const scaleX = (hexWidth / sprite.width);
            const scaleY = (hexHeight / sprite.height);
            const scale = Math.max(scaleX, scaleY); // fit exact

            targetWidth = sprite.width * scale;
            targetHeight = sprite.height * scale;
        }

        // Anchor sprite at bottom of hex (cy + size)
        const bottomY = cy + size;
        const drawX = cx - targetWidth / 2;
        const drawY = bottomY - targetHeight;

        if (sprite) {
            ctx.drawImage(sprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (roadSprite) {
            ctx.drawImage(roadSprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (overlaySprite) {
            // Use SAME frame as the base sprite to ensure perfect alignment
            // regardless of overlay transparency/crop
            ctx.drawImage(overlaySprite, drawX, drawY, targetWidth, targetHeight);
        }

        // Clip to hex shape for overlays
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.clip();

        // Fog dimming (dark overlay if not visible)
        if (!tile.visible) {
            ctx.fillStyle = 'rgba(10, 14, 23, 0.55)'; // Dark blue-black tint
            ctx.fill();
        }

        // Kingdom tint (overlay if visible and territory)
        if (this.showTerritories && tile.kingdom && tile.visible && this.mapMode === 'normal') {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                ctx.globalCompositeOperation = 'overlay';
                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }
        }

        // Map mode overlay
        if (this.mapMode !== 'normal') {
            this.renderMapModeOverlay(ctx, tile);
        }

        ctx.restore();
    },
});
