// ============================================
// MINIMAP — Minimap rendering
// ============================================

class Minimap {
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
                    // For "show whole map", we can still dim unconnected areas or just show everything
                    // IF user wants "whole map", we likely just show it all.
                    // But maybe we keep a slight shroud? 
                    // Let's show everything clearly as requested for "better world gen" feedback.
                }

                let color = tile.terrain.color;

                // Override with kingdom color for territory
                if (tile.kingdom) {
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

    /**
     * Render viewport rectangle on minimap
     */
    renderViewportIndicator(ctx, tileW, tileH) {
        const camera = this.game.camera;
        const hexSize = this.game.renderer.hexSize;
        const bounds = camera.getVisibleBounds();

        // Convert world pixel bounds to hex coords approximately
        const topLeftHex = Hex.pixelToAxial(bounds.left, bounds.top, hexSize);
        const bottomRightHex = Hex.pixelToAxial(bounds.right, bounds.bottom, hexSize);

        const x1 = Hex.wrapQ(topLeftHex.q, this.game.world.width) * tileW;
        const y1 = Math.max(0, topLeftHex.r) * tileH;
        const x2 = Hex.wrapQ(bottomRightHex.q, this.game.world.width) * tileW;
        const y2 = Math.min(this.game.world.height, bottomRightHex.r) * tileH;

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

        const world = this.game.world;
        const q = Math.floor((mx / this.canvas.width) * world.width);
        const r = Math.floor((my / this.canvas.height) * world.height);

        // Move camera to this position
        const hexSize = this.game.renderer.hexSize;
        const pos = Hex.axialToPixel(q, r, hexSize);
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
