// ============================================================
// JOB ITEMS — the painted things a street-map job puts in your hands
// ============================================================
// A job on the street map (ui/innerMapTasks.js) marks its spots, puts loads in
// your arms and leaves piles where you fetch and set them down. This draws all
// of that from one painted atlas (assets/modern/items/job_items.png, built by
// scripts/terrain_modern/build_job_items.py) instead of glyph plates:
//   * itemFor(glyph, plan)   which item a task glyph shows (data/mapTasks.json
//                            itemArt.byGlyph; a job's own `item` wins for its glyph)
//   * draw(...)              one item standing at a point
//   * drawPile(...)          n of it heaped on the ground
//   * drawCarried(...)       held in the arms / on the shoulder / in the hand,
//                            behind or in front of the body by facing, bobbing
//                            with the stride
//   * drawSheep / drawRat    the strays and rats a job sets loose
// Everything returns false when the art is missing, so the caller can fall back
// to its old marker.

import { DataLoader } from '../core/dataLoader.js';

const CELL = 128;
// The hand's rise on each of the 8 walk frames (ui/innerMapCharacters.js WALK_BOB)
const WALK_BOB = [0, -1, -1, 0, 0, -1, -1, 0];
const WALK_FPS = 10;
const DIR_UP = 0, DIR_LEFT = 1, DIR_DOWN = 2, DIR_RIGHT = 3;

const _imgs = new Map();

function _image(path) {
    if (!path || typeof Image === 'undefined') return null;
    let img = _imgs.get(path);
    if (!img) {
        img = new Image();
        img.src = path;
        _imgs.set(path, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}

function _art() {
    const d = (DataLoader.get && DataLoader.get('mapTasks')) || {};
    return d.itemArt || null;
}

/**
 * Where a carried thing sits on the body drawn round (px, py), by how it is
 * carried and the facing: { dx, dy (its foot, from the tile centre), k, back }.
 * On the shoulder: the right one, in front from ahead and behind, on the far
 * side of the body seen side-on. In the hand: hanging at the side. In the
 * arms: against the chest; a tool at the side, head up by the shoulder, the top showing over the shoulders from behind.
 */
export function carryPose(how, dir, ds) {
    const side = dir === DIR_LEFT ? -1 : dir === DIR_RIGHT ? 1 : 0;
    if (how === 'shoulder') {
        if (side) return { dx: -side * ds * 0.12, dy: -ds * 0.42, k: 0.48, back: true };
        return { dx: (dir === DIR_UP ? 1 : -1) * ds * 0.2, dy: -ds * 0.42, k: 0.48, back: false };
    }
    if (how === 'tool') {
        // A long-handled tool held at the side, its head up by the shoulder
        if (side) return { dx: side * ds * 0.14, dy: ds * 0.02, k: 0.5, back: false };
        return { dx: (dir === DIR_UP ? -1 : 1) * ds * 0.26, dy: ds * 0.02, k: 0.5, back: dir === DIR_UP };
    }
    if (how === 'hand') {
        if (side) return { dx: side * ds * 0.04, dy: 0, k: 0.36, back: false };
        return { dx: (dir === DIR_UP ? -1 : 1) * ds * 0.24, dy: 0, k: 0.36, back: dir === DIR_UP };
    }
    if (dir === DIR_UP) return { dx: 0, dy: -ds * 0.42, k: 0.55, back: true };
    return { dx: side * ds * 0.16, dy: -ds * 0.02, k: 0.55, back: false };
}

export const JobItems = {
    /** The item a task glyph shows, or null (no art: keep the glyph). */
    itemFor(glyph, plan = null) {
        const art = _art();
        if (!art || !glyph) return null;
        if (plan && plan.item && glyph === (plan.glyph || glyph) && art.items[plan.item]) return plan.item;
        const name = (art.byGlyph || {})[glyph];
        return name && art.items[name] ? name : null;
    },

    /** How it is carried: 'arms' | 'shoulder' | 'hand' | 'tool'. */
    carryOf(name) {
        const art = _art();
        return (art && art.carry && art.carry[name]) || 'arms';
    },

    /** Its size in tiles at k = 1 (the art's own size: 128px a tile). */
    size(name) {
        const art = _art();
        const r = art && art.items[name];
        if (!r) return null;
        const s = r[4] || 1;
        return { w: (r[2] * s) / CELL, h: (r[3] * s) / CELL };
    },

    /**
     * One item standing with its foot at (cx, by), `ds` px a tile, scaled by k.
     * opts: alpha, flip (mirror), shadow (a soft ground shadow under it).
     */
    draw(ctx, name, cx, by, ds, k = 1, opts = {}) {
        const art = _art();
        const r = art && art.items[name];
        const img = r && _image(art.sheet);
        if (!img) return false;
        const s = r[4] || 1;
        const w = (r[2] * s / CELL) * ds * k, h = (r[3] * s / CELL) * ds * k;
        ctx.save();
        if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
        if (opts.shadow) {
            ctx.fillStyle = `rgba(0,0,0,${0.28 * (opts.shadow === true ? 1 : opts.shadow)})`;
            ctx.beginPath();
            ctx.ellipse(cx, by - h * 0.03, w * 0.42, Math.max(2, w * 0.12), 0, 0, Math.PI * 2);
            ctx.fill();
        }
        if (opts.flip) {
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            ctx.translate(-cx, 0);
        }
        ctx.drawImage(img, r[0], r[1], r[2], r[3], cx - w / 2, by - h, w, h);
        ctx.restore();
        return true;
    },

    /**
     * n of an item heaped at (cx, by): up to three along the ground, two more
     * on them, one on top; past six the heap stops growing.
     */
    drawPile(ctx, name, cx, by, ds, n, k = 0.58) {
        if (n <= 0) return true;
        const sz = this.size(name);
        if (!sz) return false;
        const w = sz.w * ds * k, h = sz.h * ds * k;
        const slots = [
            [-0.5, 0, 0.0], [0.5, 0, 0.04], [0, 0.22, 0.0],
            [-0.25, -0.55, 0], [0.27, -0.52, 0], [0, -1.05, 0],
        ];
        const take = slots.slice(0, Math.min(n, slots.length));
        // In slot order: the back two, the one in front of them, then up the heap
        for (let i = 0; i < take.length; i++) {
            const s = take[i];
            const x = cx + s[0] * w * 0.95;
            const y = by + s[2] * h + s[1] * h * 0.9 - (i < 3 ? 0 : h * 0.12);
            if (!this.draw(ctx, name, x, y, ds, k, { flip: i % 2 === 1, shadow: i < 3 ? 0.7 : 0 })) return false;
        }
        return true;
    },

    /**
     * What the player carries, at the body drawn round (px, py) (the tile
     * centre the player stands on; feet a little below it). Call it once with
     * behind = true before the body and once with false after it: each pose
     * draws in one of the two passes by facing.
     */
    drawCarried(ctx, name, px, py, ds, dir, anim, now, behind) {
        if (!name) return false;
        const how = this.carryOf(name);
        const charH = ds * 1.8;
        const walking = anim === 'walk';
        const f = walking ? Math.floor(now * WALK_FPS) % WALK_BOB.length : 0;
        const bob = (WALK_BOB[f] || 0) * (charH / 64);
        const side = dir === DIR_LEFT ? -1 : dir === DIR_RIGHT ? 1 : 0;
        const pose = carryPose(how, dir, ds);
        const sway = (how === 'hand' || how === 'tool') && walking ? Math.sin(now * Math.PI * 2) * ds * 0.015 : 0;
        if (pose.back !== behind) return true;
        return this.draw(ctx, name, px + pose.dx, py + pose.dy + bob + sway, ds, pose.k, { flip: side < 0 });
    },

    // ── The creatures a job sets loose ──

    /** A stray sheep at (cx, by), from the sheep's own walk sheet (data/animals.json). */
    drawSheep(ctx, cx, by, ds, facing, moving, now) {
        const animals = (DataLoader.get && DataLoader.get('animals')) || {};
        const sp = (animals.species || animals)['sheep'];
        const img = sp && _image(sp.sheet);
        if (!img) return false;
        const rows = sp.rows || { up: 0, left: 1, down: 2, right: 3 };
        const fw = sp.frameW || 128, fh = sp.frameH || 128;
        const cols = sp.cols || 4;
        const row = rows[facing] != null ? rows[facing] : rows.down;
        const col = moving ? Math.floor(now * 6) % cols : 0;
        const size = ds * (sp.drawTiles || 1.2);
        const ax = (sp.anchor ? sp.anchor[0] : fw / 2) / fw, ay = (sp.anchor ? sp.anchor[1] : fh) / fh;
        ctx.drawImage(img, col * fw, row * fh, fw, fh, cx - size * ax, by - size * ay, size, size);
        return true;
    },

    /** A rat scurrying at (cx, by), facing left or right. */
    drawRat(ctx, cx, by, ds, faceLeft, moving, now) {
        const hop = moving ? Math.abs(Math.sin(now * 14)) * ds * 0.03 : 0;
        return this.draw(ctx, 'rat', cx, by - hop, ds, 0.42, { flip: faceLeft, shadow: 0.6 });
    },
};
