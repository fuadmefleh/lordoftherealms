// InnerMapRenderer — tall buildings in depth (mixed in via Object.assign).
//
// A tile-composed building blocks only its ground storey (world/customBuildings.js
// footprintOf); its upper storeys, roof and chimneys are walked behind: drawn, in the
// depth-sorted pass (entities.js), over whoever stands there, as the whole building
// sorts by its anchor row. So that what is behind them still reads:
//
//   - a cutaway: whoever (the player, or the cursor's tile) stands behind a building sees
//     a stepped circle of its upper rows thinned round them — the first storey above the
//     ground a little, the higher ones more, the roof most — its ground floor solid;
//   - outlines: the player (gold), townsfolk (white), anyone hostile (red) and goods on the
//     ground (amber) hidden behind a building are traced over it, 1px;
//   - height shadows on the ground, long at morning and evening, short at noon, none by night;
//   - Alt held: every building's upper rows a ghost, the ground plans showing (ui/game/gameLoop.js).

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';

const BIG = 1e5;
// The cutaway's radius (tiles) and its rings: [inner edge as a share of it, how much of the fade]
const CUT_R = 2.75;
const CUT_RINGS = [[0, 1], [0.72, 0.62], [0.86, 0.3]];
// The upper rows' opacity in the cutaway: the storey above the ground floor, the higher ones, the roof
const CUT_ALPHA = { storey: 0.55, upper: 0.35, roof: 0.2 };
// Alt held: every building's upper rows
const XRAY_ALPHA = 0.25;
const OUTLINE = { player: '#f5c542', npc: '#ffffff', hostile: '#ff4a3d', pile: '#ffb347' };

/**
 * The opacity bands of a building's upper rows, top to bottom (rows off the anchor):
 * [[rowFrom, rowTo, alpha], ...], rowFrom inclusive, rowTo exclusive (−Infinity: everything above).
 */
export function cutBands(foot) {
    if (!foot) return [];
    const ft = foot.footTop;
    const wallTop = Math.min(foot.wallTop, ft);
    const b1 = Math.max(foot.storeyTop, wallTop);
    const out = [[-Infinity, wallTop, CUT_ALPHA.roof]];
    if (b1 > wallTop) out.push([wallTop, b1, CUT_ALPHA.upper]);
    if (ft > b1) out.push([b1, ft, CUT_ALPHA.storey]);
    return out;
}

/** Does a building anchored at (aq, ar) hide whoever stands at (q, r)? (on one of its walked-behind cells) */
export function hidesCell(def, aq, ar, q, r) {
    if (!def || r >= ar) return false;
    const dq = q - aq, dr = r - ar;
    const b = def.bounds;
    if (!b || dq < b.minCol || dq > b.maxCol || dr < b.minRow) return false;
    const foot = CustomBuildings.footprint(def);
    if (!foot || foot.blocks(dq, dr)) return false;
    const m = def._metaMap ? def._metaMap[`${dq},${dr}`] : null;
    return !!(m ? !m.door : (def.meta || []).some(x => x.q === dq && x.r === dr));
}

/**
 * The shadow a building of `rowsUp` rows over its ground floor throws at `hour` (0–24), in
 * tiles: { dx, dy, alpha } — west in the morning, east in the evening, long at either end of
 * the day and short at noon, thrown a little back (north) by the southern sun; null by night.
 */
export function shadowVector(hour, rowsUp) {
    const h = Number(hour);
    if (!Number.isFinite(h) || !(rowsUp > 0) || h < 6.25 || h > 17.75) return null;
    const th = ((h - 6) / 12) * Math.PI;              // 0 at sunrise, π at sunset
    const sin = Math.sin(th);
    const len = rowsUp * Math.min(1.5, Math.max(0.3, 0.32 / Math.max(0.12, sin)));
    // (fading in after dawn and out before dusk)
    const alpha = Math.min(1, Math.max(0, (Math.min(h - 6.25, 17.75 - h)) / 1.25));
    return { dx: -Math.cos(th) * len, dy: -0.35 * len * sin - 0.15, alpha };
}

Object.assign(InnerMapRenderer, {
    _xrayHeld: false,
    // (the buildings in the depth pass this frame: [def, q, r] flat; reused)
    _depthBldgs: null,
    _depthN: 0,
    _shadowPolys: null,

    /** The frame's buildings begin (entities.js Phase 2). */
    _depthBegin() {
        if (!this._depthBldgs) this._depthBldgs = [];
        this._depthN = 0;
        this._cutAt = null;
    },

    _depthNote(def, q, r) {
        const a = this._depthBldgs;
        const i = this._depthN * 3;
        a[i] = def; a[i + 1] = q; a[i + 2] = r;
        this._depthN++;
    },

    /** The building of this frame hiding whoever stands at (q, r): its index, or -1. */
    _depthCoverAt(q, r) {
        const a = this._depthBldgs;
        if (!a) return -1;
        for (let i = 0; i < this._depthN; i++) {
            if (hidesCell(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], q, r)) return i;
        }
        return -1;
    },

    /**
     * Where the cutaway is this frame (entities.js, before the draw): round the player behind a
     * building, else round the cursor's tile behind one. Inside, underground or on a ship's deck none.
     */
    _depthPlanCut(camera, playerX, playerY, ds) {
        this._cutAt = null;
        if (InnerMap._insideBuilding || !this._depthN) return;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        let i = this._depthCoverAt(pq, pr);
        let x = playerX, y = playerY - ds * 0.6;
        if (i < 0 && this._hoveredInnerHex && camera) {
            const h = this._hoveredInnerHex;
            i = this._depthCoverAt(h.q, h.r);
            if (i >= 0) {
                const T = this.TILE_SIZE;
                const s = camera.worldToScreenFast((h.q + 0.5) * T, (h.r + 0.5) * T);
                x = s.x; y = s.y;
            }
        }
        if (i < 0) return;
        const c = this._cutScratch || (this._cutScratch = { def: null, q: 0, r: 0, x: 0, y: 0 });
        c.def = this._depthBldgs[i * 3]; c.q = this._depthBldgs[i * 3 + 1]; c.r = this._depthBldgs[i * 3 + 2];
        c.x = x; c.y = y;
        this._cutAt = c;
    },

    /**
     * Draw a tile-composed building in the depth pass: whole, or — Alt held, or the cutaway on
     * it — its ground floor solid and its upper rows thinned (clipped redraws of its kept
     * canvas: no allocation, a dozen blits at most, for one building).
     */
    _drawBuildingDepth(ctx, camera, def, q, r, ds, ruin, site, wear, spire) {
        const cut = this._cutAt && this._cutAt.def === def && this._cutAt.q === q && this._cutAt.r === r ? this._cutAt : null;
        const xray = !!this._xrayHeld && !InnerMap._insideBuilding;
        const foot = (cut || xray) && (site == null || site >= 1) ? CustomBuildings.footprint(def) : null;
        if (!foot) return this._drawCustomBuilding(ctx, camera, def, q, r, ds, ruin, site, wear, spire);
        const T = this.TILE_SIZE;
        const ay = camera.worldToScreenFast(q * T, r * T).y;
        const yFoot = Math.floor(ay + foot.footTop * ds);
        const draw = () => this._drawCustomBuilding(ctx, camera, def, q, r, ds, ruin, site, wear, spire);
        const a0 = ctx.globalAlpha;
        // The ground floor, solid
        ctx.save();
        ctx.beginPath(); ctx.rect(-BIG, yFoot, 2 * BIG, BIG); ctx.clip();
        draw();
        ctx.restore();
        if (xray) {
            ctx.save();
            ctx.beginPath(); ctx.rect(-BIG, -BIG, 2 * BIG, yFoot + BIG); ctx.clip();
            ctx.globalAlpha = a0 * XRAY_ALPHA;
            draw();
            ctx.restore();
            ctx.globalAlpha = a0;
            return;
        }
        // The upper rows outside the cutaway, solid
        const R = CUT_R * ds;
        const blk = Math.max(2, Math.round(ds / 8));
        ctx.save();
        ctx.beginPath(); ctx.rect(-BIG, -BIG, 2 * BIG, yFoot + BIG); ctx.clip();
        ctx.beginPath(); ctx.rect(-BIG, -BIG, 2 * BIG, 2 * BIG); this._pixelDisc(ctx, cut.x, cut.y, R, blk); ctx.clip('evenodd');
        draw();
        ctx.restore();
        // ...and within it, ring by ring (stepped, pixel-edged), band by band
        const bands = cutBands(foot);
        for (let k = 0; k < CUT_RINGS.length; k++) {
            const r0 = CUT_RINGS[k][0] * R, r1 = k + 1 < CUT_RINGS.length ? CUT_RINGS[k + 1][0] * R : R;
            const fade = CUT_RINGS[k][1];
            ctx.save();
            ctx.beginPath(); ctx.rect(-BIG, -BIG, 2 * BIG, yFoot + BIG); ctx.clip();
            ctx.beginPath(); this._pixelDisc(ctx, cut.x, cut.y, r1, blk);
            if (r0 > 0) this._pixelDisc(ctx, cut.x, cut.y, r0, blk);
            ctx.clip('evenodd');
            for (const [f, t, a] of bands) {
                const y0 = f === -Infinity ? -BIG : Math.floor(ay + f * ds);
                const y1 = Math.min(yFoot, Math.floor(ay + t * ds));
                if (!(y1 > y0)) continue;
                ctx.save();
                ctx.beginPath(); ctx.rect(-BIG, y0, 2 * BIG, y1 - y0); ctx.clip();
                ctx.globalAlpha = a0 * (1 - (1 - a) * fade);
                draw();
                ctx.restore();
            }
            ctx.restore();
        }
        ctx.globalAlpha = a0;
    },

    /** A disc of radius R round (cx, cy) as rows of blocks `blk` px tall (a pixel-art circle) added to the path. */
    _pixelDisc(ctx, cx, cy, R, blk) {
        const n = Math.ceil(R / blk);
        const x0 = Math.round(cx / blk) * blk, y0 = Math.round(cy / blk) * blk;
        for (let i = -n; i < n; i++) {
            const yc = (i + 0.5) * blk;
            if (Math.abs(yc) >= R) continue;
            const half = Math.round(Math.sqrt(R * R - yc * yc) / blk) * blk;
            if (half <= 0) continue;
            ctx.rect(x0 - half, y0 + i * blk, half * 2, blk);
        }
    },

    // ──────────── HEIGHT SHADOWS ────────────

    /** The hour on the street map, to a quarter (shadows are kept by it). */
    _shadowHour() {
        const h = InnerMap._sceneClock ? InnerMap._sceneClock() : InnerMap.timeOfDay;
        return Number.isFinite(Number(h)) ? Math.round(Number(h) * 4) / 4 : 12;
    },

    /**
     * The ground shadow of a building at an hour: the footprint swept along the shadow's way, as
     * [outer polygon, inner polygon] in tiles off the anchor (each [x0, y0, x1, y1, ...]); kept per
     * building per quarter hour. Null by night or for a building with nothing over its ground floor.
     */
    _shadowPoly(def, hour) {
        if (!this._shadowPolys) this._shadowPolys = new Map();
        const key = `${def.id}|${hour}`;
        let p = this._shadowPolys.get(key);
        if (p !== undefined) return p;
        const foot = CustomBuildings.footprint(def);
        const b = def.bounds;
        const up = foot && b ? Math.max(0, foot.footTop - b.minRow) : 0;
        const v = shadowVector(hour, up);
        p = null;
        if (v && v.alpha > 0) {
            const x0 = b.minCol, x1 = b.maxCol + 1, y0 = foot.footTop, y1 = b.maxRow + 1;
            const sweep = (k) => {
                const dx = v.dx * k, dy = v.dy * k;
                // (the hull of the footprint and the footprint moved by (dx, dy): a hexagon)
                if (dx <= 0) return dy <= 0
                    ? [x0, y1, x0 + dx, y1 + dy, x0 + dx, y0 + dy, x1 + dx, y0 + dy, x1, y0, x1, y1]
                    : [x0, y0, x0 + dx, y0 + dy, x0 + dx, y1 + dy, x1 + dx, y1 + dy, x1, y1, x1, y0];
                return dy <= 0
                    ? [x0, y0, x0 + dx, y0 + dy, x1 + dx, y0 + dy, x1 + dx, y1 + dy, x1, y1, x0, y1]
                    : [x0, y1, x0 + dx, y1 + dy, x1 + dx, y1 + dy, x1 + dx, y0 + dy, x1, y0, x0, y0];
            };
            p = { outer: sweep(1), inner: sweep(0.62), alpha: v.alpha };
        }
        if (this._shadowPolys.size > 4000) this._shadowPolys.clear();
        this._shadowPolys.set(key, p);
        return p;
    },

    /** The frame's buildings' shadows on the ground, under every sprite (entities.js, after Phase 2). */
    _drawBuildingShadows(ctx, camera) {
        if (!this._depthN || InnerMap._insideBuilding || InnerMap._underground) return;
        const hour = this._shadowHour();
        const T = this.TILE_SIZE, ds = T * camera.zoom;
        const a = this._depthBldgs;
        ctx.save();
        ctx.fillStyle = 'rgb(18,20,38)';
        for (let i = 0; i < this._depthN; i++) {
            const def = a[i * 3];
            const p = this._shadowPoly(def, hour);
            if (!p) continue;
            const s = camera.worldToScreenFast(a[i * 3 + 1] * T, a[i * 3 + 2] * T);
            const sx = s.x, sy = s.y;
            for (const [poly, al] of [[p.outer, 0.11], [p.inner, 0.12]]) {
                ctx.globalAlpha = al * p.alpha;
                ctx.beginPath();
                ctx.moveTo(Math.round(sx + poly[0] * ds), Math.round(sy + poly[1] * ds));
                for (let j = 2; j < poly.length; j += 2) ctx.lineTo(Math.round(sx + poly[j] * ds), Math.round(sy + poly[j + 1] * ds));
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    },

    // ──────────── OUTLINES OF WHAT IS HIDDEN ────────────

    /**
     * Note what a figure was drawn as this frame (entities.js, at its drawCharacter), so its
     * outline can be traced if a building hides it. `owner` keeps one record, reused.
     */
    _silNote(owner, preset, anim, dir, time, x, y, w, h) {
        if (!owner || this._outlining) return;
        const s = owner._sil || (owner._sil = {});
        s.f = this._renderFrame || 0; s.preset = preset; s.anim = anim; s.dir = dir; s.time = time;
        s.x = x; s.y = y; s.w = w; s.h = h; s.item = null;
    },

    /** As _silNote, for goods on the ground: drawn by `fn(ctx)` within the box. */
    _silNoteFn(owner, fn, x, y, w, h) {
        if (!owner || this._outlining) return;
        const s = owner._sil || (owner._sil = {});
        s.f = this._renderFrame || 0; s.preset = null; s.item = fn;
        s.x = x; s.y = y; s.w = w; s.h = h;
    },

    /** The outline colour of an NPC: red for anyone fighting you or hostile, white for the rest. */
    _outlineOf(npc) {
        if (!npc) return OUTLINE.npc;
        const re = InnerMapCombat && InnerMapCombat._npcReactions;
        const fight = re && typeof re.get === 'function' && re.get(npc.id);
        if (npc.hostile || npc.isHostile || (fight && fight.mode === 'fight') || /bandit|brigand|outlaw|raider/.test(String(npc.type || ''))) return OUTLINE.hostile;
        return OUTLINE.npc;
    },

    /**
     * After the depth pass: trace the outline of each figure and pile a building hides.
     * `who`: [{ owner, q, r, kind: 'player'|'npc'|'pile', npc? }] collected by entities.js.
     */
    _drawOccludedOutlines(ctx, who) {
        if (!who || !who.length || InnerMap._insideBuilding || !this._depthN) return;
        const frame = this._renderFrame || 0;
        for (const w of who) {
            const s = w.owner && w.owner._sil;
            if (!s || s.f !== frame) continue;
            if (this._depthCoverAt(w.q, w.r) < 0) continue;
            const color = w.kind === 'player' ? OUTLINE.player : w.kind === 'pile' ? OUTLINE.pile : this._outlineOf(w.npc);
            this._outlineSil(ctx, s, color);
        }
    },

    /** One figure's 1px outline and a faint fill, through two kept scratch canvases. */
    _outlineSil(ctx, s, color) {
        if (typeof document === 'undefined' || !ctx || !ctx.canvas) return;
        const k = ctx.canvas.pixelRatio || 1;
        const bx = Math.floor(s.x - 3), by = Math.floor(s.y - 3);
        const W = Math.ceil((s.w + 6) * k), H = Math.ceil((s.h + 6) * k);
        if (!(W > 0 && H > 0) || W > 2048 || H > 2048) return;
        const A = this._olA || (this._olA = document.createElement('canvas'));
        const B = this._olB || (this._olB = document.createElement('canvas'));
        for (const c of [A, B]) if (c.width < W || c.height < H) { c.width = Math.max(c.width, W); c.height = Math.max(c.height, H); }
        A.pixelRatio = k;
        const a = A.getContext('2d'), b = B.getContext('2d');
        a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1; a.clearRect(0, 0, W, H);
        a.setTransform(k, 0, 0, k, -bx * k, -by * k);
        a.imageSmoothingEnabled = false;
        this._outlining = true;
        try {
            if (s.preset) InnerMapCharacters.drawCharacter(a, s.preset, s.anim, s.dir, s.time, s.x, s.y, s.w, s.h);
            else if (s.item) s.item(a);
        } finally { this._outlining = false; }
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalCompositeOperation = 'source-in';
        a.fillStyle = color;
        a.fillRect(0, 0, W, H);
        a.globalCompositeOperation = 'source-over';
        const t = Math.max(1, Math.round(k));
        b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1; b.clearRect(0, 0, W, H);
        b.imageSmoothingEnabled = false;
        b.drawImage(A, 0, 0, W, H, -t, 0, W, H);
        b.drawImage(A, 0, 0, W, H, t, 0, W, H);
        b.drawImage(A, 0, 0, W, H, 0, -t, W, H);
        b.drawImage(A, 0, 0, W, H, 0, t, W, H);
        b.globalCompositeOperation = 'destination-out';
        b.drawImage(A, 0, 0, W, H, 0, 0, W, H);
        b.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.16;
        ctx.drawImage(A, 0, 0, W, H, bx * k, by * k, W, H);
        ctx.globalAlpha = 0.95;
        ctx.drawImage(B, 0, 0, W, H, bx * k, by * k, W, H);
        ctx.restore();
    },
});
