// ============================================
// HOVER COORDS — small "q, r" tooltip drawn next to the cursor
// Shared by the world-map Renderer and the InnerMapRenderer.
// ============================================

/**
 * Draw a tile-coordinate tooltip near the cursor, kept inside the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {number} mouseX - cursor X in canvas pixels
 * @param {number} mouseY - cursor Y in canvas pixels
 * @param {number} q
 * @param {number} r
 */
export function drawHoverCoords(ctx, canvas, mouseX, mouseY, q, r) {
    if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) return;

    const text = `${q}, ${r}`;
    ctx.save();
    ctx.font = '600 12px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const padX = 6;
    const boxW = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const boxH = 20;

    // Offset below-right of the cursor; flip to the other side near edges
    let x = mouseX + 14;
    let y = mouseY + 18;
    if (x + boxW > canvas.width) x = mouseX - 14 - boxW;
    if (y + boxH > canvas.height) y = mouseY - 18 - boxH;

    ctx.fillStyle = 'rgba(16, 20, 28, 0.85)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(245,197,66,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + padX, y + boxH / 2);
    ctx.restore();
}
