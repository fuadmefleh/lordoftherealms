// ============================================
// MINIMAP — Minimap rendering
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';

/** Inner-map minimap zoom levels in pixels per tile (0 = fit the whole map). */
const INNER_ZOOM_LEVELS = [0, 2, 3, 4, 6];
const INNER_ZOOM_DEFAULT = 2;
const INNER_REFRESH_MS = 100;
const INNER_TERRAIN_REBAKE_MS = 2000;

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
        const inner = this.game.innerMapMode && InnerMap.active;
        const label = document.getElementById('minimapLabel');
        if (label) {
            const text = inner ? this._innerLabel() : 'World Map';
            if (label.textContent !== text) label.textContent = text;
        }

        if (inner) {
            this.renderInnerMap();
            return;
        }
        this._innerLastDraw = 0;

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

    // ══════════════════════════════════════════════
    // INNER MAP MINIMAP
    // The inner map is far larger than the minimap (128×128 tiles in a
    // 220×130 box), so it shows a zoomable window centred on the player.
    // Building interiors are small enough to always show the whole room.
    // Static terrain is baked at 1px/tile into an offscreen canvas and
    // scaled up; only the moving markers are redrawn each refresh.
    // ══════════════════════════════════════════════

    /** Zoom the inner-map minimap in (+1) or out (-1). */
    zoomInner(dir) {
        const cur = this._innerZoom ?? INNER_ZOOM_DEFAULT;
        this._innerZoom = Math.max(0, Math.min(INNER_ZOOM_LEVELS.length - 1, cur + dir));
        this._innerLastDraw = 0;
    }

    resetInnerZoom() {
        this._innerZoom = INNER_ZOOM_DEFAULT;
        this._innerLastDraw = 0;
    }

    /** Colour of one inner-map tile on the minimap. */
    _innerTileColor(tile) {
        const sub = tile.subTerrain;
        if (tile._isInterior) {
            if (tile._isDoor) return '#f5c542';
            if (tile.customObject || tile.customObjectPart) return '#5a3a1a';
            if (tile._furniture) return InnerMap.FURNITURE_COLORS[tile._furniture.type] || '#6a5a4a';
            if (tile.baseTerrain === 'wall') return '#3a2e24';
            return (sub && sub.color) || '#8B7355';
        }
        if (tile.building || tile.customBuilding) return '#8B7355';
        if (tile.isRoad) return '#a08060';
        if (tile.customObject || tile.customObjectPart) {
            return (sub && sub.passable === false) ? '#2d4a22' : '#3d6a2e';
        }
        if (sub && !sub.passable) return sub.color || '#2b3647';
        if (tile.baseTerrain === 'water' || tile.baseTerrain === 'deep_water') return (sub && sub.color) || '#2a5a8a';
        if (tile.terrainDetail) return '#4B8434';
        return '#a0854d';
    }

    /** Bake the inner map's terrain into a 1px-per-tile offscreen canvas. */
    _bakeInnerTerrain(now) {
        const w = InnerMap.width, h = InnerMap.height;
        if (!this._innerTerrain) this._innerTerrain = document.createElement('canvas');
        const off = this._innerTerrain;
        if (off.width !== w || off.height !== h) {
            off.width = w;
            off.height = h;
        }
        const octx = off.getContext('2d');
        octx.fillStyle = '#090d14';
        octx.fillRect(0, 0, w, h);
        for (let r = 0; r < h; r++) {
            const row = InnerMap.tiles[r];
            if (!row) continue;
            for (let q = 0; q < w; q++) {
                const tile = row[q];
                if (!tile || !tile.explored) continue;
                octx.fillStyle = this._innerTileColor(tile);
                octx.fillRect(q, r, 1, 1);
                if (!tile.visible) {
                    octx.fillStyle = 'rgba(9, 13, 20, 0.5)';
                    octx.fillRect(q, r, 1, 1);
                }
            }
        }
        this._innerTerrainTiles = InnerMap.tiles;
        this._innerTerrainBakedAt = now;
    }

    /**
     * Tile→pixel transform for the current inner view: pixel = (tile - origin) * scale.
     * @returns {{scale: number, originQ: number, originR: number}}
     */
    _innerView() {
        const w = this.canvas.width, h = this.canvas.height;
        const mapW = InnerMap.width, mapH = InnerMap.height;
        const fitScale = Math.min(w / mapW, h / mapH);
        const level = INNER_ZOOM_LEVELS[this._innerZoom ?? INNER_ZOOM_DEFAULT];

        // Interiors and the "fit" level show the whole map, aspect preserved.
        // Never zoom out past fit — there's nothing beyond the map edge.
        const scale = (InnerMap._insideBuilding || level === 0) ? fitScale : Math.max(level, fitScale);
        const viewW = w / scale, viewH = h / scale;

        const axisOrigin = (mapLen, viewLen, playerPos) => (viewLen >= mapLen)
            ? -(viewLen - mapLen) / 2
            : Math.max(0, Math.min(mapLen - viewLen, playerPos + 0.5 - viewLen / 2));
        return {
            scale,
            originQ: axisOrigin(mapW, viewW, InnerMap.playerInnerQ),
            originR: axisOrigin(mapH, viewH, InnerMap.playerInnerR),
        };
    }

    renderInnerMap() {
        // Markers move every frame; ~10 fps is plenty for a minimap.
        const now = performance.now();
        if (this._innerLastDraw && now - this._innerLastDraw < INNER_REFRESH_MS) return;
        this._innerLastDraw = now;
        this.needsRedraw = true; // the world view must repaint once we leave

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, 0, w, h);

        if (!InnerMap.tiles || !InnerMap.width || !InnerMap.height) return;

        if (this._innerTerrainTiles !== InnerMap.tiles ||
            now - (this._innerTerrainBakedAt || 0) > INNER_TERRAIN_REBAKE_MS) {
            this._bakeInnerTerrain(now);
        }

        const view = this._innerView();
        this._lastInnerView = view;
        const { scale, originQ, originR } = view;
        const toX = (q) => (q - originQ) * scale;
        const toY = (r) => (r - originR) * scale;

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._innerTerrain, toX(0), toY(0), InnerMap.width * scale, InnerMap.height * scale);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // ── Building icons (outer map) ──
        if (!InnerMap._insideBuilding && InnerMap.buildings && InnerMap.buildings.length > 0) {
            const iconSize = Math.max(8, Math.min(16, Math.floor(scale * 3)));
            ctx.font = `${iconSize}px sans-serif`;

            for (const bldg of InnerMap.buildings) {
                const tile = InnerMap.tiles[bldg.r] && InnerMap.tiles[bldg.r][bldg.q];
                if (!tile || !tile.explored) continue;

                const bx = toX(bldg.q + 0.5);
                const by = toY(bldg.r + 0.5);
                if (bx < -iconSize || by < -iconSize || bx > w + iconSize || by > h + iconSize) continue;

                // Dark background circle for readability
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.arc(bx, by, iconSize * 0.55, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.fillText(bldg.icon || '🏠', bx, by);
            }
        }

        // ── Furniture icons (interiors are drawn large enough to read them) ──
        if (InnerMap._insideBuilding && scale >= 8) {
            ctx.font = `${Math.min(14, Math.floor(scale * 0.8))}px sans-serif`;
            for (let r = 0; r < InnerMap.height; r++) {
                const row = InnerMap.tiles[r];
                if (!row) continue;
                for (let q = 0; q < InnerMap.width; q++) {
                    const furn = row[q] && row[q]._furniture;
                    if (furn && furn.icon) ctx.fillText(furn.icon, toX(q + 0.5), toY(r + 0.5));
                }
            }
        }

        // ── NPCs ──
        const dot = Math.max(2, Math.min(4, scale * 0.6));
        for (const npc of (InnerMap.npcs || [])) {
            if (!InnerMap._insideBuilding && npc.state === 'inside_building') continue;
            const tile = InnerMap.tiles[npc.r] && InnerMap.tiles[npc.r][npc.q];
            if (!tile || !tile.visible) continue;
            ctx.fillStyle = (npc.hostile || npc.isHostile) ? '#e74c3c' : '#7fc8ff';
            ctx.fillRect(toX(npc.q + 0.5) - dot / 2, toY(npc.r + 0.5) - dot / 2, dot, dot);
        }

        // ── Player ──
        const px = toX(InnerMap.playerInnerQ + 0.5);
        const py = toY(InnerMap.playerInnerR + 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();

        this.renderInnerViewportIndicator(ctx, view);
    }

    _innerLabel() {
        if (InnerMap._insideBuilding) return InnerMap._insideBuilding.name || 'Interior';
        const ref = InnerMap._currentWorldTileRef;
        if (ref && ref.settlement && ref.settlement.name) return ref.settlement.name;
        return 'Local Area';
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

    renderInnerViewportIndicator(ctx, view) {
        const camera = this.game.innerMapCamera;
        if (!camera || InnerMap._insideBuilding) return;

        const tileSize = InnerMapRenderer.tileSize;
        const bounds = camera.getVisibleBounds();
        const x1 = (bounds.left / tileSize - view.originQ) * view.scale;
        const y1 = (bounds.top / tileSize - view.originR) * view.scale;
        const x2 = (bounds.right / tileSize - view.originQ) * view.scale;
        const y2 = (bounds.bottom / tileSize - view.originR) * view.scale;

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

        // Inner map mode: the camera is locked to the player, so a click
        // walks the player to that spot instead of panning.
        if (this.game.innerMapMode && InnerMap.active) {
            const view = this._lastInnerView;
            if (!view) return;
            const q = Math.floor(mx / view.scale + view.originQ);
            const r = Math.floor(my / view.scale + view.originR);
            const tile = InnerMap.getTile(q, r);
            if (!tile || !tile.explored) return;
            InnerMap.cancelPlayerWalk();
            const result = InnerMap.movePlayerTo(q, r);
            if (result && result.started === false && this.game.ui) {
                this.game.ui.showNotification('Blocked', 'You cannot reach that spot.', 'error');
            }
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
