// Goods drawn as pixel sprites on the inner map: a sack, a fish, a loaf, a
// barrel lying where it was dropped, or riding low in the river and the sea.
//
// The mapping is data (data/itemSprites.json → gamedata.itemSprites): a good's
// id → a tight rect on one of the LPC small-item sheets under assets/lpc (or
// the PixelLab-made goods sheet assets/items/goods/goods.png; an optional 6th
// number scales a small thing down within the box); a
// good without its own cell falls back by rule to a generic kind (a sack, a
// crate, a barrel, a bundle of cloth, a chest, a basket). Arms with a picture
// of their own (ui/icons.js itemPicture) draw that picture. Sheets load on
// first use; until one has loaded, itemSprite() answers null and the caller
// draws its stand-in.

import { DataLoader } from '../core/dataLoader.js';
import { itemPicture } from './icons.js';

const _imgs = new Map(); // src → Image
const _resolved = new Map(); // id → { src, sx, sy, sw, sh } | null

function _cfg() {
    const g = DataLoader._gamedata;
    return (g && g.itemSprites) || null;
}

function _image(src) {
    let img = _imgs.get(src);
    if (!img) {
        if (typeof Image === 'undefined') return null;
        img = new Image();
        img.src = src;
        _imgs.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}

/** The kind of generic sprite a good without its own falls back to (sack, crate, barrel, bundle, chest, basket). */
export function itemSpriteKind(id, cfg = _cfg()) {
    const key = String(id || '').toLowerCase();
    if (!cfg) return 'crate';
    for (const [re, kind] of cfg.rules || []) {
        try {
            if (new RegExp(re).test(key)) return kind;
        } catch { /* a bad rule is skipped */ }
    }
    return cfg.default || 'crate';
}

/** Where a good's sprite comes from: { src, sx, sy, sw, sh } (sw = 0: the whole picture), or null with no data. */
export function itemSpriteSource(id) {
    const key = String(id || '').toLowerCase();
    if (_resolved.has(key)) return _resolved.get(key);
    const cfg = _cfg();
    let out = null;
    const pic = itemPicture(key);
    if (pic) out = { src: pic, sx: 0, sy: 0, sw: 0, sh: 0 };
    else if (cfg) {
        const cell = (cfg.items && cfg.items[key]) || (cfg.kinds && cfg.kinds[itemSpriteKind(key, cfg)]) || null;
        const src = cell && cfg.sheets && cfg.sheets[cell[0]];
        if (src) out = { src, sx: cell[1], sy: cell[2], sw: cell[3], sh: cell[4], scale: Number(cell[5]) > 0 ? Number(cell[5]) : 1 };
    }
    if (cfg) _resolved.set(key, out); // (no data yet: ask again next time)
    return out;
}

/** A good's sprite ready to draw: { img, sx, sy, sw, sh }, or null while its sheet loads (or with no data). */
export function itemSprite(id) {
    const s = itemSpriteSource(id);
    if (!s) return null;
    const img = _image(s.src);
    if (!img) return null;
    const scale = s.scale || 1;
    return s.sw ? { img, sx: s.sx, sy: s.sy, sw: s.sw, sh: s.sh, scale } : { img, sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight, scale };
}

/**
 * Draw a good's sprite fitted in a `size` box, its foot centred on (cx, footY),
 * pixel-crisp. Returns false (nothing drawn) while its sheet is loading.
 */
export function drawItemSprite(ctx, id, cx, footY, size) {
    const s = itemSprite(id);
    if (!s) return false;
    // (an optional 6th number in the data: a small thing — a ring, an idol — drawn smaller than a full box)
    const k = size * (s.scale || 1) / Math.max(s.sw, s.sh);
    const w = Math.max(1, Math.round(s.sw * k)), h = Math.max(1, Math.round(s.sh * k));
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, Math.round(cx - w / 2), Math.round(footY - h), w, h);
    ctx.imageSmoothingEnabled = smooth;
    return true;
}

/**
 * A good afloat: its sprite rocking on the swell, the part below the waterline
 * (y = line) hidden but for a faint ghost seen through the water, and the water
 * lapping round it at the line. `sink` 0..1 takes it under. Returns false while
 * its sheet is loading.
 */
export function drawItemAfloat(ctx, id, cx, line, size, { rock = 0, sink = 0, alpha = 1, ghost = 0.25, lap = '#e8f7ff' } = {}) {
    const s = itemSprite(id);
    if (!s) return false;
    // (an optional 6th number in the data: a small thing — a ring, an idol — drawn smaller than a full box)
    const k = size * (s.scale || 1) / Math.max(s.sw, s.sh);
    const w = Math.max(1, Math.round(s.sw * k)), h = Math.max(1, Math.round(s.sh * k));
    // riding low: about 40% of it under, more as it sinks
    const under = h * (0.4 + 0.6 * Math.max(0, Math.min(1, sink)));
    const top = line + under - h;
    const smooth = ctx.imageSmoothingEnabled;
    const a0 = ctx.globalAlpha;
    const draw = () => {
        ctx.translate(cx, top + h / 2);
        ctx.rotate(rock);
        ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, -w / 2, -h / 2, w, h);
    };
    ctx.imageSmoothingEnabled = false;
    // above the water: the sprite itself
    ctx.save();
    ctx.globalAlpha = a0 * alpha;
    ctx.beginPath();
    ctx.rect(cx - size * 2, top - size * 2, size * 4, line - top + size * 2);
    ctx.clip();
    draw();
    ctx.restore();
    // below it: a faint ghost, washed over with the water's colour
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - size * 2, line, size * 4, size * 2);
    ctx.clip();
    ctx.globalAlpha = a0 * alpha * ghost;
    draw();
    ctx.restore();
    // the water lapping round it at the line
    ctx.save();
    ctx.globalAlpha = a0 * alpha * 0.75;
    ctx.strokeStyle = lap;
    ctx.lineWidth = Math.max(1, Math.round(size / 24));
    ctx.beginPath();
    ctx.ellipse(cx, line, w * 0.55, Math.max(1.5, h * 0.09), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.imageSmoothingEnabled = smooth;
    return true;
}
