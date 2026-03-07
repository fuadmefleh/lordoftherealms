// ============================================
// MINIMAP — Minimap rendering
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';


export class Minimap {
    constructor(game) {
        this.game = game;
        this.canvas = document.getElementById('minimapCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.needsRedraw = true;

        // Set actual canvas resolution
        this.canvas.width = 220;
        this.canvas.height = 130;

        // Click on minimap to navigate
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
    }

    /**
     * Force a redraw on next frame
     */
    invalidate() {
        this.needsRedraw = true;
    }

    /**
     * Render minimap
     */
    render() {
        // Update label based on current mode
        const label = document.getElementById('minimapLabel');
        if (label) {
            label.textContent = (this.game.innerMapMode && InnerMap.active) ? 'Inner Map' : 'World Map';
        }

        if (this.game.innerMapMode && InnerMap.active) {
            this.renderInnerMap();
            return;
        }

        if (!this.needsRedraw && !this.game.player.isMoving) return;
        this.needsRedraw = false;

        const ctx = this.ctx;
        const world = this.game.world;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, 0, w, h);

        if (!world) return;

        const tileW = w / world.width;
        const tileH = h / world.height;

        // Draw terrain
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];

                if (!tile.explored) {
                    // Unexplored tiles are dark
                    ctx.fillStyle = '#090d14';
                    ctx.fillRect(
                        Math.floor(q * tileW),
                        Math.floor(r * tileH),
                        Math.ceil(tileW) + 1,
                        Math.ceil(tileH) + 1
                    );
                    continue;
                }

                let color = tile.terrain.color;

                // If renderer has an active map mode, use its colour scheme
                const renderer = this.game.renderer;
                if (renderer && renderer.mapMode !== 'normal') {
                    color = renderer.getMapModeColor(tile);
                } else if (tile.kingdom) {
                    // Default: override with kingdom color for territory
                    const kingdom = world.getKingdom(tile.kingdom);
                    if (kingdom) {
                        color = kingdom.color;
                    }
                }

                ctx.fillStyle = color;
                ctx.fillRect(
                    Math.floor(q * tileW),
                    Math.floor(r * tileH),
                    Math.ceil(tileW) + 1,
                    Math.ceil(tileH) + 1
                );

                // Dim explored-but-not-visible tiles (fog of war)
                if (!tile.visible) {
                    ctx.fillStyle = 'rgba(9, 13, 20, 0.55)';
                    ctx.fillRect(
                        Math.floor(q * tileW),
                        Math.floor(r * tileH),
                        Math.ceil(tileW) + 1,
                        Math.ceil(tileH) + 1
                    );
                }
            }
        }

        // Draw settlements
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.settlement || !tile.explored) continue;

                ctx.fillStyle = tile.settlement.type === 'capital' ? '#f5c542' : '#ffffff';
                const dotSize = tile.settlement.type === 'capital' ? 3 : 1.5;
                ctx.fillRect(
                    q * tileW - dotSize / 2,
                    r * tileH - dotSize / 2,
                    dotSize,
                    dotSize
                );
            }
        }

        // Draw player position
        const player = this.game.player;
        const px = player.q * tileW;
        const py = player.r * tileH;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();

        // Draw camera viewport indicator
        this.renderViewportIndicator(ctx, tileW, tileH);
    }

    renderInnerMap() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, 0, w, h);

        if (!InnerMap.tiles || !InnerMap.width || !InnerMap.height) return;

        const tileW = w / InnerMap.width;
        const tileH = h / InnerMap.height;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r] && InnerMap.tiles[r][q];
                if (!tile) continue;

                const x = Math.floor(q * tileW);
                const y = Math.floor(r * tileH);
                const rw = Math.ceil(tileW) + 1;
                const rh = Math.ceil(tileH) + 1;

                if (!tile.explored) {
                    ctx.fillStyle = '#090d14';
                    ctx.fillRect(x, y, rw, rh);
                    continue;
                }

                const color = (tile.subTerrain && tile.subTerrain.color) || '#2b3647';
                // Use ground-based color: grass for terrainDetail tiles, dirt otherwise.
                // Skip rendering trees/objects — show only terrain, roads, buildings, water.
                let minimapColor;
                if (tile.building || tile.customBuilding) {
                    minimapColor = '#8B7355';  // building footprint = brown
                } else if (tile.isRoad) {
                    minimapColor = '#a08060';  // road = light brown
                } else if (tile.subTerrain && !tile.subTerrain.passable) {
                    minimapColor = color;       // walls, water, etc. keep original color
                } else if (tile.baseTerrain === 'water' || tile.baseTerrain === 'deep_water') {
                    minimapColor = color;
                } else if (tile.terrainDetail) {
                    minimapColor = '#4B8434';  // grass
                } else {
                    minimapColor = '#a0854d';  // dirt
                }
                ctx.fillStyle = minimapColor;
                ctx.fillRect(x, y, rw, rh);

                if (!tile.visible) {
                    ctx.fillStyle = 'rgba(9, 13, 20, 0.5)';
                    ctx.fillRect(x, y, rw, rh);
                }
            }
        }

        // ── Draw building / landmark icons ──
        if (InnerMap.buildings && InnerMap.buildings.length > 0) {
            // Compute icon size based on tile density — readable but not overwhelming
            const iconSize = Math.max(8, Math.min(14, Math.floor(tileW * 3)));
            ctx.font = `${iconSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const bldg of InnerMap.buildings) {
                // Skip buildings on unexplored tiles
                const tile = InnerMap.tiles[bldg.r] && InnerMap.tiles[bldg.r][bldg.q];
                if (!tile || !tile.explored) continue;

                const bx = (bldg.q + 0.5) * tileW;
                const by = (bldg.r + 0.5) * tileH;

                // Dark background circle for readability
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.arc(bx, by, iconSize * 0.55, 0, Math.PI * 2);
                ctx.fill();

                // Draw the emoji icon
                ctx.fillStyle = '#ffffff';
                ctx.fillText(bldg.icon || '🏠', bx, by);
            }
        }

        // ── Draw player position ──
        const px = (InnerMap.playerInnerQ + 0.5) * tileW;
        const py = (InnerMap.playerInnerR + 0.5) * tileH;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();

        this.renderInnerViewportIndicator(ctx, tileW, tileH);
    }

    /**
     * Render viewport rectangle on minimap
     */
    renderViewportIndicator(ctx, tileW, tileH) {
        const camera = this.game.camera;
        const renderer = this.game.renderer;
        const world = this.game.world;
        const hexSize = renderer.hexSize;
        const hexWidth = Math.sqrt(3) * hexSize;
        const rowHeight = hexWidth * 0.75;
        const bounds = camera.getVisibleBounds();

        // Convert world pixel bounds to offset grid coords (q, r)
        // Inverse of getHexPixelPos:
        // py = r * rowHeight => r = py / rowHeight
        // px = q * hexWidth + offsetX => q = (px - offsetX) / hexWidth

        const r1 = bounds.top / rowHeight;
        const r2 = bounds.bottom / rowHeight;

        // We take the average offsetX for the column calculation to keep the box rectangular on the minimap
        // or just use columns derived from left/right
        const q1 = (bounds.left) / hexWidth;
        const q2 = (bounds.right) / hexWidth;

        const x1 = q1 * tileW;
        const y1 = r1 * tileH;
        const x2 = q2 * tileW;
        const y2 = r2 * tileH;

        ctx.strokeStyle = 'rgba(245, 197, 66, 0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    renderInnerViewportIndicator(ctx, tileW, tileH) {
        const camera = this.game.innerMapCamera;
        if (!camera) return;

        const tileSize = InnerMapRenderer.tileSize;
        const bounds = camera.getVisibleBounds();

        const q1 = bounds.left / tileSize;
        const q2 = bounds.right / tileSize;
        const r1 = bounds.top / tileSize;
        const r2 = bounds.bottom / tileSize;

        const x1 = q1 * tileW;
        const y1 = r1 * tileH;
        const x2 = q2 * tileW;
        const y2 = r2 * tileH;

        ctx.strokeStyle = 'rgba(245, 197, 66, 0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    /**
     * Handle click on minimap to navigate
     */
    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);

        // Inner map mode: navigate the inner map camera
        if (this.game.innerMapMode && InnerMap.active) {
            const tileSize = InnerMapRenderer.tileSize;
            const q = (mx / this.canvas.width) * InnerMap.width;
            const r = (my / this.canvas.height) * InnerMap.height;
            const worldX = q * tileSize;
            const worldY = r * tileSize;
            this.game.innerMapCamera.centerOn(worldX, worldY);
            return;
        }

        const world = this.game.world;
        const q = Math.floor((mx / this.canvas.width) * world.width);
        const r = Math.floor((my / this.canvas.height) * world.height);

        // Move camera to this position using the renderer's coordinate system
        const pos = this.game.renderer.getHexPixelPos(q, r);
        this.game.camera.follow(pos.x, pos.y);
    }

    dimColor(colorStr, factor) {
        const hex = colorStr.replace('#', '');
        const r = Math.floor(parseInt(hex.substr(0, 2), 16) * factor);
        const g = Math.floor(parseInt(hex.substr(2, 2), 16) * factor);
        const b = Math.floor(parseInt(hex.substr(4, 2), 16) * factor);
        return `rgb(${r},${g},${b})`;
    }
}
