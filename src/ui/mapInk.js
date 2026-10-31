// ============================================
// MAP INK — lettering and markers shared by the world map and the inner maps
// Text is inked (a dark rounded halo under the letters, a soft shadow round
// that) so it reads over any ground, grows with the Interface Size setting and
// never drops below a readable floor. Markers are a struck plate with a glyph
// from ui/icons.js engraved on it, so nothing on a map is drawn as emoji.
// ============================================

import { drawGlyph, drawIcon } from './icons.js';
import { uiZoom } from './uiScale.js';

export const DISPLAY_FONT = "'Cinzel', serif";
export const BODY_FONT = "'Inter', sans-serif";
/** No text on a map is drawn smaller than this (CSS px); below it Cinzel smears. */
export const MIN_TEXT_PX = 11;

/** The px size inside a canvas font string ("700 13px 'Cinzel', serif" → 13). */
export function fontPx(font) {
    const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
    return m ? parseFloat(m[1]) : 12;
}

/**
 * A label's px size on screen: grown with the Interface Size setting (the HUD's
 * --ui-zoom, so map lettering keeps pace with the panels around it) and held
 * to the readable floor (call sites often pass `camera zoom × 9`).
 */
export function textPx(px, min = MIN_TEXT_PX) {
    return Math.round(Math.max(min, px) * uiZoom() * 10) / 10;
}

/** A font string with its size put through textPx. */
export function readableFont(font) {
    if (!font) return `700 ${textPx(MIN_TEXT_PX)}px ${DISPLAY_FONT}`;
    return font.replace(/(\d+(?:\.\d+)?)px/, `${textPx(fontPx(font))}px`);
}

/**
 * Ink one line of text: a soft drop shadow, a dark halo stroked with round
 * joins (so Cinzel's serifs don't spike), then the letters. Font, alignment
 * and baseline are already set on the context.
 */
export function inkText(ctx, text, x, y, size, color, halo) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = halo || 'rgba(8, 7, 5, 0.88)';
    ctx.lineWidth = Math.max(2.5, size * 0.3);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = Math.max(2, size * 0.25);
    ctx.shadowOffsetY = 1;
    ctx.strokeText(text, x, y);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color || '#f4efe4';
    ctx.fillText(text, x, y);
    ctx.restore();
}

/**
 * Text on a map, inked so it reads over any terrain. Returns the px size used.
 * opts: size, min (floor, default MIN_TEXT_PX), weight, family ('display'
 * Cinzel | 'body' Inter), color, align, baseline, alpha, halo (colour).
 */
export function drawMapText(ctx, text, x, y, opts = {}) {
    if (text == null || text === '') return 0;
    const size = textPx(opts.size || 12, opts.min);
    const family = opts.family === 'body' ? BODY_FONT : DISPLAY_FONT;
    ctx.save();
    ctx.font = `${opts.weight || 700} ${size}px ${family}`;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    inkText(ctx, String(text), x, y, size, opts.color || '#f4efe4', opts.halo);
    ctx.restore();
    return size;
}

/** A small dark plate with a metal rim: the ground every map marker sits on. */
export function drawMarkerPlate(ctx, x, y, r, rim = 'rgba(232, 192, 112, 0.6)') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = r * 0.6;
    ctx.shadowOffsetY = r * 0.12;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(46, 54, 74, 0.95)');
    g.addColorStop(1, 'rgba(10, 13, 22, 0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.strokeStyle = rim;
    ctx.stroke();
    ctx.restore();
}

/**
 * A map marker: the struck plate with a glyph on it. `icon` is a glyph name
 * or an emoji from data (ui/icons.js glyphFor maps it).
 * opts: rim (plate rim colour), color (glyph colour).
 */
export function drawMapMarker(ctx, icon, x, y, r, opts = {}) {
    drawMarkerPlate(ctx, x, y, r, opts.rim || 'rgba(232, 192, 112, 0.75)');
    drawIcon(ctx, icon, x, y, r * 1.3, opts.color || '#ecd9a8', 2.1);
}

/**
 * A glyph cut into a surface (furniture, a plaque): a dark groove under a
 * pale face, so it reads on whatever colour the piece is painted.
 */
export function engraveGlyph(ctx, name, x, y, size, color = 'rgba(250, 238, 210, 0.92)') {
    const lw = 2.2;
    drawGlyph(ctx, name, x, y + Math.max(1, size * 0.05), size, 'rgba(0, 0, 0, 0.55)', lw + 0.8);
    return drawGlyph(ctx, name, x, y, size, color, lw);
}

/**
 * How much a label follows the camera zoom: a little (so close-up text feels
 * close), never in full, or a zoomed-in town would letter itself in headlines.
 */
export function labelZoom(zoom) {
    return Math.min(1.25, Math.max(0.85, zoom || 1));
}
