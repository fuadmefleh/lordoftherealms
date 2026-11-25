// Renderer — the world's geography lettered like an atlas (world/geoNames.js):
// italic, letter-spaced names over the land and the water. Seas large, faint
// and in spaced capitals; mountain ranges in spaced capitals along the range's
// long axis; rivers small and blue along their course (at the middle, and
// every so often along a long one); lakes, bays, forests, deserts, fens,
// islands and passes in italic, each in its own ink. A feature's name shows
// from a zoom set by its kind and size (data/geography.json zoom: the great
// features from far out, the small ones closer) and fades in over a step of
// zoom; only where the hex under the name has been explored. Drawn just
// before renderLabels, under the town names and clear of them: the queued
// labels' boxes (and each geo name drawn before) are kept off, a name that
// would cross one being nudged once and otherwise left out this frame.
// Toggled by renderer.showGeoNames (Map menu ▸ Place Names, the setting
// showGeoNames).
import { Renderer, HEX_FACE_DY } from './core.js';
import { GeoNames } from '../../world/geoNames.js';
import { NamedLegacy } from '../../systems/namedLegacy.js';
import { textPx } from '../mapInk.js';

const FONT = "Georgia, 'Palatino Linotype', 'Book Antiqua', 'Times New Roman', serif";

// How each kind is lettered: base px, spacing (em), capitals, ink, halo, rotation
// limit (radians; 0 = always level), priority (higher draws first).
const STYLE = {
    sea: { px: 17, grow: 1.6, spacing: 0.45, caps: true, color: [196, 222, 242], alpha: 0.6, halo: 'rgba(8, 22, 40, 0.35)', rot: 0.35, prio: 9 },
    range: { px: 13, grow: 1.3, spacing: 0.38, caps: true, color: [238, 224, 198], alpha: 0.92, halo: 'rgba(20, 14, 8, 0.7)', rot: 1.2, prio: 8 },
    desert: { px: 12.5, grow: 1.1, spacing: 0.32, caps: true, color: [246, 216, 160], alpha: 0.9, halo: 'rgba(40, 24, 6, 0.65)', rot: 0.5, prio: 7 },
    forest: { px: 12.5, grow: 1, spacing: 0.16, caps: false, color: [196, 232, 170], alpha: 0.9, halo: 'rgba(8, 24, 8, 0.7)', rot: 0.5, prio: 6 },
    island: { px: 12, grow: 0.8, spacing: 0.12, caps: false, color: [242, 234, 212], alpha: 0.92, halo: 'rgba(8, 20, 34, 0.6)', rot: 0.4, prio: 6 },
    bay: { px: 12, grow: 0.8, spacing: 0.14, caps: false, color: [178, 214, 240], alpha: 0.85, halo: 'rgba(6, 20, 38, 0.55)', rot: 0.6, prio: 5 },
    lake: { px: 11, grow: 0.7, spacing: 0.1, caps: false, color: [168, 214, 246], alpha: 0.95, halo: 'rgba(6, 22, 40, 0.65)', rot: 0.5, prio: 5 },
    marsh: { px: 11.5, grow: 0.6, spacing: 0.12, caps: false, color: [200, 214, 158], alpha: 0.9, halo: 'rgba(16, 22, 8, 0.7)', rot: 0.4, prio: 4 },
    river: { px: 10.5, grow: 0.5, spacing: 0.08, caps: false, color: [124, 194, 252], alpha: 0.95, halo: 'rgba(4, 16, 34, 0.75)', rot: 1.4, prio: 3 },
    pass: { px: 10.5, grow: 0, spacing: 0.06, caps: false, color: [242, 226, 192], alpha: 0.95, halo: 'rgba(20, 14, 8, 0.75)', rot: 0, prio: 2 },
};

const _overlap = (a, b, pad) => !(a.right + pad < b.left || a.left - pad > b.right || a.bottom + pad < b.top || a.top - pad > b.bottom);

Object.assign(Renderer.prototype, {
    /** The camera zoom from which a feature's name shows (data/geography.json zoom). */
    geoMinZoom(f) {
        const Z = GeoNames.data().zoom || {};
        const z = Z[f.kind] || Z.sea || { small: 0.6, big: 0.4, hexes: 40 };
        const n = Number(z.hexes) || 0;
        if (!(n > 0) || f.size >= n) return Number(z.big) || 0.3;
        const t = Math.sqrt(Math.max(0, f.size) / n);
        return (Number(z.small) || 0.6) + ((Number(z.big) || 0.3) - (Number(z.small) || 0.6)) * t;
    },

    /** The names of the land and the water, over the map and under the town names. */
    renderGeoLabels(ctx) {
        if (this.showGeoNames === false || !this.world || !this.world.tiles) return;
        const world = this.world;
        const { features } = GeoNames.features(world);
        if (!features.length) return;
        const z = this.camera.zoom;
        const hexW = Math.sqrt(3) * this.hexSize;
        const worldPx = hexW * world.width;
        const W = world.width;
        const cw = this.canvas.width, ch = this.canvas.height;
        const faceDy = HEX_FACE_DY * this.hexSize;
        const explored = (i) => {
            const t = world.tiles[(i / W) | 0] && world.tiles[(i / W) | 0][i % W];
            return !!(t && t.explored);
        };
        // the town names (and the rest of the queued labels) are kept clear of
        const boxes = [];
        for (const l of this.labels || []) {
            try { boxes.push(this.getLabelBounds(ctx, l)); } catch { /* a label without a style */ }
        }
        const placed = [];
        const order = features.slice().sort((a, b) => (STYLE[b.kind] ? STYLE[b.kind].prio : 0) - (STYLE[a.kind] ? STYLE[a.kind].prio : 0) || b.size - a.size);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const spacingOk = 'letterSpacing' in ctx;
        for (const f of order) {
            const S = STYLE[f.kind];
            if (!S || !f.name) continue;
            const minZ = this.geoMinZoom(f);
            let alpha = Math.max(0, Math.min(1, (z - minZ) / 0.12 + 1));
            if (alpha <= 0) continue;
            // (the great names step back when close in: they are for the wide view)
            if ((f.kind === 'sea' || f.kind === 'range') && z > 1.15) alpha *= Math.max(0.45, 1 - (z - 1.15) * 1.2);
            // (a river along its course, a great sea or ocean in several places across it)
            let spots = (f.kind === 'river' || f.kind === 'sea') && Array.isArray(f.anchors) && f.anchors.length
                ? f.anchors.map(a => ({ x: a.x, y: a.y, angle: a.angle, tile: a.tile }))
                : [{ x: f.x, y: f.y, angle: f.angle, tile: f.anchor }];
            // (where the water is named after a House, renderNamedPlaces letters it)
            if (f.kind === 'sea' || f.kind === 'bay') {
                spots = spots.filter(s => !NamedLegacy.placeAt(world, s.tile % W, (s.tile / W) | 0));
                if (!spots.length) continue;
            }
            const text0 = GeoNames.bare(f.name);
            const text = S.caps ? text0.toUpperCase() : text0;
            const sizeK = f.kind === 'river' ? Math.log2(Math.max(2, f.size)) / 5 : Math.log10(Math.max(10, f.size)) / 2;
            let px = textPx((S.px + S.grow * sizeK * 2) * (0.78 + 0.3 * Math.min(1.5, z)), 10);
            // (level unless the feature runs one way: a long range, a winding river)
            const elongated = f.kind === 'river' || f.length / Math.max(1, f.width) >= 1.6;
            let drawn = 0;
            for (const spot of spots) {
                if (f.kind === 'river' && drawn >= 3) break;
                if (!explored(spot.tile)) continue;
                const ang = elongated ? Math.max(-S.rot, Math.min(S.rot, spot.angle)) : 0;
                for (const k of [0, -1, 1]) {
                    const wx = spot.x * hexW + k * worldPx;
                    const s = this.camera.worldToScreen(wx, spot.y * hexW);
                    const sx = s.x, sy = s.y + faceDy * z;
                    if (sx < -400 || sx > cw + 400 || sy < -100 || sy > ch + 100) continue;
                    ctx.font = `italic ${S.caps ? 600 : 500} ${px}px ${FONT}`;
                    if (spacingOk) ctx.letterSpacing = `${(S.spacing * px).toFixed(1)}px`;
                    let tw = ctx.measureText(text).width + (spacingOk ? 0 : text.length * S.spacing * px);
                    // (no wider than the feature, by much: shrink, to the floor)
                    const span = (f.kind === 'river' ? 10 : Math.max(3, f.length)) * hexW * z * 1.25;
                    if (f.kind !== 'sea' && tw > span && px > 10.5) {
                        const npx = Math.max(10, px * span / tw);
                        tw *= npx / px;
                        px = npx;
                        ctx.font = `italic ${S.caps ? 600 : 500} ${px}px ${FONT}`;
                        if (spacingOk) ctx.letterSpacing = `${(S.spacing * px).toFixed(1)}px`;
                    }
                    const box = (cx, cy) => {
                        const hw = tw / 2, hh = px * 0.62;
                        const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
                        const ex = hw * c + hh * sn, ey = hw * sn + hh * c;
                        return { left: cx - ex, right: cx + ex, top: cy - ey, bottom: cy + ey };
                    };
                    // (where it would cross a town's name: a line up or down, else not this frame)
                    let at = null;
                    for (const d of [0, -1.3, 1.3]) {
                        const cx = sx - Math.sin(ang) * d * px, cy = sy + Math.cos(ang) * d * px;
                        const b = box(cx, cy);
                        if (boxes.some(o => _overlap(b, o, 3)) || placed.some(o => _overlap(b, o, 2))) continue;
                        at = { cx, cy, b };
                        break;
                    }
                    if (!at) continue;
                    placed.push(at.b);
                    drawn++;
                    const [r, g, bl] = S.color;
                    ctx.save();
                    ctx.translate(at.cx, at.cy);
                    if (ang) ctx.rotate(ang);
                    ctx.globalAlpha = alpha * S.alpha;
                    ctx.lineJoin = 'round';
                    ctx.strokeStyle = S.halo;
                    ctx.lineWidth = Math.max(2, px * 0.24);
                    if (spacingOk) {
                        // (letterSpacing trails the last letter: shift back half of it to stay centred)
                        const off = (S.spacing * px) / 2;
                        ctx.strokeText(text, off, 0);
                        ctx.fillStyle = `rgb(${r}, ${g}, ${bl})`;
                        ctx.fillText(text, off, 0);
                    } else {
                        // (no letterSpacing: set the letters one by one)
                        let x = -tw / 2;
                        ctx.textAlign = 'left';
                        ctx.fillStyle = `rgb(${r}, ${g}, ${bl})`;
                        for (const chr of text) {
                            ctx.strokeText(chr, x, 0);
                            ctx.fillText(chr, x, 0);
                            x += ctx.measureText(chr).width + S.spacing * px;
                        }
                    }
                    ctx.restore();
                }
            }
        }
        if (spacingOk) ctx.letterSpacing = '0px';
        ctx.restore();
    },
});
