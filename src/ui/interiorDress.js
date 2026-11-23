// Interiors dressed — the walls of a room drawn in the round, what hangs on them,
// what lies on its tables, the light a window lets in.
//
// Drawn for innerMapLayers/terrainRoads.js (_renderInteriorArt / _drawWallTile) from
// data/innerMapRenderer.json interiorArt: `walls` (the material's face, body and top
// cells), `wallDecor` (tile._wallDecor), `decor` (tile._decor) and the furniture's `top`
// (where things lie on a piece). The sheet of decor and the smaller furniture is
// assets/buildingKit/interior_decor.png (scripts/build-interior-decor.py); an entry's
// `grid` is how many of its pixels make one tile (48 when unsaid).
//
//   THE WALLS (top-down, the camera a little south of the room):
//     back wall   its face, a tile and a half tall (half a tile of it above the map's
//                 top row), the wall's top as a thin cap above that
//     side walls  a thin cap along the room's edge, the rest of the tile dark
//     front wall  its cap, and below that its outer face (the door stands in it)
//     inner walls (tile._innerWall) a thin cap along the run; where a room lies to the
//                 south of it, its face under the cap; doorways (tile._doorway) open
//   The floor takes a soft shadow where it meets a wall.
//
// Exports are plain functions over a drawing context `W`:
//   { ctx, img, kb, mat, tile, at, dx, dy, sz }  (img: the wall sheet; kb: its cell scale;
//   at(dq, dr): a neighbour tile)

import { InnerMap } from '../world/innerMap.js';

export const CAP = 0.28;      // the thickness of a wall's top, of a tile
export const EXT = 0.55;      // how far the back wall's face rises above the top row, of a tile
export const VOID = '#0a0e17'; // (the map's own dark beyond the walls: innerMapRenderer.render)

const mod = (v, n) => ((v % n) + n) % n;

/** Ids from a tile field: 'mugs', ['mugs', 'bread'] or [{ type: 'mugs' }] */
export function asIds(v) {
    if (!v) return [];
    const a = Array.isArray(v) ? v : [v];
    const out = [];
    for (const x of a) {
        const id = typeof x === 'string' ? x : x && (x.type || x.id);
        if (id) out.push(String(id));
    }
    return out;
}

/** The art for an id in a group (`mug` finds `mugs`, `plate` finds `plates`) */
export function artFor(group, id) {
    if (!group || !id) return null;
    if (group[id]) return group[id];
    if (group[`${id}s`]) return group[`${id}s`];
    if (id.endsWith('s') && group[id.slice(0, -1)]) return group[id.slice(0, -1)];
    return null;
}

/** How much daylight comes in at an hour (0 at night, 1 by day; dawn and dusk between) */
export function daylight(hour) {
    const h = Number(hour);
    if (!Number.isFinite(h)) return 1;
    const t = mod(h, 24);
    if (t < 5 || t >= 20.5) return 0;
    if (t < 8) return (t - 5) / 3;
    if (t > 17.5) return (20.5 - t) / 3;
    return 1;
}

const isWall = (o) => !!o && o.baseTerrain === 'wall' && !o._doorway;

/** Which wall a wall tile is: 'back', 'left', 'right', 'front' (the room's outside walls), or 'inner' */
export function wallSides(tile) {
    const w = InnerMap.width, h = InnerMap.height;
    if (tile._innerWall) return null;
    const s = { left: tile.q === 0, right: tile.q === w - 1, top: tile.r === 0, bottom: tile.r === h - 1 };
    return s.left || s.right || s.top || s.bottom ? s : null;
}

// ── Texture cells ──
function faceCell(mat, q) {
    const fw = mat.tw ? ((mat.face && mat.face.tw) || mat.tw) / 32 : 1;
    if (!mat.tw) return [mat.sx, mat.sy];
    return mat.face ? [mat.face.sx + mod(q, fw) * 32, mat.face.sy] : [mat.sx + mod(q, fw) * 32, mat.sy];
}
function bodyCell(mat, q, r) {
    if (!mat.tw) return [mat.sx, mat.sy];
    const nx = mat.tw / 32, ny = (mat.th || 32) / 32;
    return [mat.sx + mod(q, nx) * 32, mat.sy + mod(r, ny) * 32];
}
function topCell(mat, q, r) {
    if (!mat.tw) return [mat.sx, mat.sy];
    const nx = mat.tw / 32, ny = (mat.th || 32) / 32;
    const t = mat.top || mat;
    return [t.sx + mod(q, nx) * 32, t.sy + mod(r, ny) * 32];
}

/**
 * A rectangle (X, Y, w, h on screen, within the tile's column) filled with a texture
 * aligned to the tile grid: each tile row of it takes its own cell, cellAt(row).
 */
function fillTex(W, cellAt, X, Y, w, h) {
    const { ctx, img, kb, dx, dy, sz, tile } = W;
    if (w <= 0 || h <= 0) return;
    const fx = (X - dx) / sz, fw = w / sz;
    let y = Y;
    const end = Y + h;
    while (y < end - 0.01) {
        const row = Math.floor((y - dy) / sz + 1e-6);
        const rowTop = dy + row * sz;
        const y1 = Math.min(end, rowTop + sz);
        const c = cellAt(tile.r + row);
        const sy = (y - rowTop) / sz;
        ctx.drawImage(img, (c[0] + fx * 32) * kb, (c[1] + sy * 32) * kb, fw * 32 * kb, ((y1 - y) / sz) * 32 * kb,
            Math.round(X), Math.round(y), Math.round(X + w) - Math.round(X), Math.round(y1) - Math.round(y));
        y = y1;
    }
}

/** The wall's face over a rectangle: the face cell's lower part (frac of it shown: its foot always) */
function fillFace(W, X, Y, w, h, frac = h / W.sz) {
    const { ctx, img, kb, dx, sz, mat, tile } = W;
    if (w <= 0 || h <= 0) return;
    const c = faceCell(mat, tile.q);
    const fx = (X - dx) / sz;
    const f = Math.min(1, frac);
    ctx.drawImage(img, (c[0] + fx * 32) * kb, (c[1] + (1 - f) * 32) * kb, (w / sz) * 32 * kb, f * 32 * kb,
        Math.round(X), Math.round(Y), Math.round(X + w) - Math.round(X), Math.round(Y + h) - Math.round(Y));
    // (a wall stands in its own shade, apart from the floor: darker toward its head)
    rect(W.ctx, 'rgba(16, 10, 6, 0.15)', X, Y, w, h);
    rect(W.ctx, 'rgba(16, 10, 6, 0.10)', X, Y, w, h * 0.4);
}

/** The wall's top over a rectangle (a material with no top of its own: its body, darkened) */
function fillTop(W, X, Y, w, h) {
    const { mat, tile, ctx } = W;
    fillTex(W, (r) => topCell(mat, tile.q, r), X, Y, w, h);
    // (darker than the floor it stands on, whatever it is made of: a stone wall on a stone floor)
    rect(ctx, mat.top ? 'rgba(20, 14, 10, 0.22)' : 'rgba(20, 14, 10, 0.45)', X, Y, w, h);
}

function rect(ctx, style, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = style;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(x + w) - Math.round(x), Math.round(y + h) - Math.round(y));
}

const RIM = 'rgba(255, 244, 225, 0.30)';
const EDGE = 'rgba(12, 8, 6, 0.55)';
const SEAM = 'rgba(0, 0, 0, 0.28)';

/**
 * One of the room's outside walls. Returns where its face is (for what hangs on it):
 * { x, y, w, h, floor, kind } or null (a side wall: no face to speak of).
 */
export function drawOuterWall(W, s) {
    const { ctx, dx, dy, sz } = W;
    const c = Math.max(2, Math.round(sz * CAP)), e = Math.round(sz * EXT);
    const ln = Math.max(1, Math.round(sz / 32));
    rect(ctx, VOID, dx, dy, sz, sz);
    if (s.top && !s.left && !s.right) {
        // The back wall: its face a tile and a half tall, its top above that
        fillFace(W, dx, dy, sz, sz, 1);
        fillTex(W, (r) => bodyCell(W.mat, W.tile.q, r), dx, dy - e, sz, e);
        rect(ctx, 'rgba(16, 10, 6, 0.19)', dx, dy - e, sz, e);
        // (where the face's own cell meets the body above it: a rail along the wall)
        rect(ctx, SEAM, dx, dy - ln, sz, ln);
        rect(ctx, 'rgba(255, 244, 225, 0.12)', dx, dy, sz, ln);
        fillTop(W, dx, dy - e - c, sz, c);
        // the face in the cap's shadow at its head, darker toward the floor's foot
        rect(ctx, 'rgba(0, 0, 0, 0.22)', dx, dy - e, sz, Math.round(e * 0.35));
        rect(ctx, 'rgba(0, 0, 0, 0.10)', dx, dy - e + Math.round(e * 0.35), sz, Math.round(e * 0.35));
        rect(ctx, 'rgba(0, 0, 0, 0.25)', dx, dy + sz * 0.86, sz, sz * 0.14);
        rect(ctx, RIM, dx, dy - e - ln, sz, ln);
        rect(ctx, EDGE, dx, dy - e - c - ln, sz, ln);
        return { x: dx, y: dy - e, w: sz, h: sz + e, floor: dy + sz, kind: 'back' };
    }
    if (s.left || s.right) {
        const x0 = s.left ? dx + sz - c : dx;
        const yTop = s.top ? dy - e - c : dy;
        const yCapEnd = s.bottom ? dy + c : dy + sz;
        fillTop(W, x0, yTop, c, yCapEnd - yTop);
        if (s.bottom) {
            fillFace(W, x0, dy + c, c, sz - c);
            rect(ctx, 'rgba(0, 0, 0, 0.16)', x0, dy + c, c, sz - c);
            rect(ctx, SEAM, x0, dy + c, c, ln);
        }
        // the light along its edge to the room, the dark along the outside
        const inner = s.left ? x0 + c - ln : x0;
        const outer = s.left ? x0 - ln : x0 + c;
        rect(ctx, RIM, inner, s.top ? dy - e : yTop, ln, (s.bottom ? dy : yCapEnd) - (s.top ? dy - e : yTop));
        rect(ctx, EDGE, outer, yTop, ln, (s.bottom ? dy + sz : yCapEnd) - yTop);
        if (s.top) rect(ctx, EDGE, x0, yTop - ln, c, ln);
        return { x: x0, y: dy, w: c, h: sz, floor: dy + sz, kind: s.left ? 'left' : 'right' };
    }
    // The front wall: its top, then its outside face
    fillTop(W, dx, dy, sz, c);
    fillFace(W, dx, dy + c, sz, sz - c);
    rect(ctx, 'rgba(0, 0, 0, 0.16)', dx, dy + c, sz, sz - c);
    rect(ctx, SEAM, dx, dy + c, sz, ln);
    rect(ctx, RIM, dx, dy, sz, ln);
    return { x: dx, y: dy + c, w: sz, h: sz - c, floor: dy + sz, kind: 'front' };
}

/**
 * A wall within the room (tile._innerWall): a thin cap along its run, its face under the
 * cap where a room lies to the south. floor(dx, dy, sz) draws the room's floor under it
 * first. Returns its face { x, y, w, h, floor, kind: 'inner' } (the widest part), or null.
 */
export function drawInnerWall(W, floor) {
    const { ctx, dx, dy, sz, at } = W;
    const c = Math.max(2, Math.round(sz * CAP));
    const ln = Math.max(1, Math.round(sz / 32));
    floor();
    // (a doorway or a door beside it: the run ends square against the opening)
    const joins = (o) => isWall(o) || !!(o && (o._doorway || o._isDoor));
    const N = isWall(at(0, -1)), S = isWall(at(0, 1)), E = joins(at(1, 0)), Wst = joins(at(-1, 0));
    const cx0 = dx + Math.round((sz - c) / 2), cx1 = cx0 + c;
    const bx0 = Wst ? dx : cx0, bx1 = E ? dx + sz : cx1;
    // the floor's shadow beside the run
    if (S || N) {
        rect(ctx, 'rgba(0, 0, 0, 0.16)', cx1, dy, Math.round(sz * 0.08), sz);
        rect(ctx, 'rgba(0, 0, 0, 0.10)', cx0 - Math.round(sz * 0.05), dy, Math.round(sz * 0.05), sz);
    }
    // the face under the cap, where the floor runs up to it from the south
    let face = null;
    if (!S) {
        fillFace(W, bx0, dy + c, bx1 - bx0, sz - c);
        rect(ctx, SEAM, bx0, dy + c, bx1 - bx0, ln);
        rect(ctx, 'rgba(0, 0, 0, 0.22)', bx0, dy + sz * 0.88, bx1 - bx0, sz * 0.12);
        face = { x: bx0, y: dy + c, w: bx1 - bx0, h: sz - c, floor: dy + sz, kind: 'inner' };
    } else if (bx0 < cx0 || bx1 > cx1) {
        // (a run going on south from here: its face either side of it)
        fillFace(W, bx0, dy + c, cx0 - bx0, sz - c);
        fillFace(W, cx1, dy + c, bx1 - cx1, sz - c);
        rect(ctx, SEAM, bx0, dy + c, bx1 - bx0, ln);
    }
    // the cap: along the run (its head) and down it
    fillTop(W, bx0, dy, bx1 - bx0, c);
    if (S) fillTop(W, cx0, dy + c, c, sz - c);
    rect(ctx, RIM, bx0, dy, bx1 - bx0, ln);
    rect(ctx, RIM, cx0 + ln, dy + c, ln, S ? sz - c : 0);
    rect(ctx, EDGE, bx0, dy + c - ln, bx1 - bx0, ln);
    if (!N) rect(ctx, EDGE, bx0, dy, bx1 - bx0, ln);
    if (!Wst) rect(ctx, EDGE, bx0, dy, ln, S ? sz : c);
    if (!E) rect(ctx, EDGE, bx1 - ln, dy, ln, S ? sz : c);
    if (S) { rect(ctx, EDGE, cx1 - ln, dy + c, ln, sz - c); rect(ctx, EDGE, cx0, dy + c, ln, sz - c); }
    return face;
}

/**
 * The soft shadow a wall throws on the floor beside it (the floor tile's own share),
 * and a window's light lying on it.
 */
export function shadeFloor(ctx, tile, at, dx, dy, sz, light) {
    const n = at(0, -1), w = at(-1, 0), e = at(1, 0);
    if (isWall(n)) {
        rect(ctx, 'rgba(0, 0, 0, 0.20)', dx, dy, sz, sz * 0.08);
        rect(ctx, 'rgba(0, 0, 0, 0.10)', dx, dy + sz * 0.08, sz, sz * 0.1);
    }
    const side = (o) => isWall(o) && !o._innerWall && !!wallSides(o);
    if (side(w)) { rect(ctx, 'rgba(0, 0, 0, 0.18)', dx, dy, sz * 0.07, sz); rect(ctx, 'rgba(0, 0, 0, 0.08)', dx + sz * 0.07, dy, sz * 0.07, sz); }
    if (side(e)) rect(ctx, 'rgba(0, 0, 0, 0.12)', dx + sz * 0.93, dy, sz * 0.07, sz);
    if (light > 0.02) windowLight(ctx, at, dx, dy, sz, light);
}

const WINDOWS = new Set(['window', 'windows', 'curtains']);
const hasWindow = (o) => !!o && asIds(o._wallDecor).some(id => WINDOWS.has(id));

/** The light of a window above (in the back or an inner wall) or beside (a side wall) on this floor */
function windowLight(ctx, at, dx, dy, sz, light) {
    // from above: a pool spreading as it falls, up to three tiles from the wall
    for (let k = 1; k <= 3; k++) {
        const o = at(0, -k);
        if (!o) break;
        if (o.baseTerrain === 'wall') {
            if (!hasWindow(o)) break;
            const a = [0.17, 0.11, 0.06][k - 1] * light;
            const i0 = sz * (0.2 - 0.06 * (k - 1)), i1 = sz * (0.2 - 0.06 * k);
            ctx.fillStyle = `rgba(255, 238, 196, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(dx + i0, dy);
            ctx.lineTo(dx + sz - i0, dy);
            ctx.lineTo(dx + sz - i1, dy + sz);
            ctx.lineTo(dx + i1, dy + sz);
            ctx.closePath();
            ctx.fill();
            break;
        }
    }
    // from the side: a shaft across the floor, two tiles in
    for (const dir of [-1, 1]) {
        for (let k = 1; k <= 2; k++) {
            const o = at(dir * k, 0);
            if (!o) break;
            if (o.baseTerrain === 'wall') {
                if (!hasWindow(o) || o._innerWall) break;
                // (a shaft widening away from the wall, fading as it goes)
                const a = [0.13, 0.06][k - 1] * light;
                const i0 = sz * (0.3 - 0.08 * (k - 1)), i1 = sz * (0.3 - 0.08 * k);
                const near = dir < 0 ? dx : dx + sz, far = dir < 0 ? dx + sz : dx;
                ctx.fillStyle = `rgba(255, 238, 196, ${a.toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(near, dy + i0);
                ctx.lineTo(far, dy + i1);
                ctx.lineTo(far, dy + sz - i1);
                ctx.lineTo(near, dy + sz - i0);
                ctx.closePath();
                ctx.fill();
                break;
            }
        }
    }
}

/**
 * What hangs on a wall's face (tile._wallDecor), drawn over it. face: from drawOuterWall /
 * drawInnerWall. getImg(path) the loaded sheet or null; scale(img) its cell scale.
 * night: true when the windows show dark. Returns false while a sheet is still loading.
 */
export function drawWallDecor(ctx, art, tile, face, sz, getImg, scale, night) {
    const ids = asIds(tile._wallDecor);
    if (!ids.length || !face || !art) return true;
    const hash = ((tile.q * 73856093) ^ (tile.r * 19349663)) >>> 0;
    let ok = true;
    ids.forEach((id, i) => {
        const a = artFor(art, id);
        if (!a) return;
        const img = getImg(a.sheet);
        if (!img) { ok = false; return; }
        let c = a;
        if (a.variants && a.variants.length) c = { ...a, ...a.variants[hash % a.variants.length] };
        if (night && a.night) c = { ...c, ...a.night };
        const grid = c.grid || 48;
        let w = c.sw * sz / grid, h = c.sh * sz / grid;
        const k = scale(img);
        // spread along the wall when more than one thing hangs on it
        const cx = face.x + face.w * (ids.length > 1 ? (i + 0.5) / ids.length : 0.5);
        if (face.kind === 'left' || face.kind === 'right') {
            // A side wall is seen from above: only a torch shows (a sconce on its edge), a window
            // as a pane let into its top
            if (id === 'torch') {
                const f = 0.5;
                const x = face.kind === 'left' ? face.x + face.w - w * f * 0.5 : face.x - w * f * 0.5;
                ctx.drawImage(img, c.sx * k, c.sy * k, c.sw * k, c.sh * k, Math.round(x), Math.round(face.y + sz * 0.5 - h * f), Math.round(w * f), Math.round(h * f));
            } else if (WINDOWS.has(id)) {
                const px = Math.max(1, Math.round(face.w * 0.3));
                const x = face.x + Math.round((face.w - px) / 2);
                rect(ctx, 'rgba(30, 22, 16, 0.9)', x - 1, face.y + sz * 0.18 - 1, px + 2, sz * 0.64 + 2);
                rect(ctx, night ? 'rgba(40, 52, 80, 0.95)' : 'rgba(196, 224, 240, 0.95)', x, face.y + sz * 0.18, px, sz * 0.64);
            }
            return;
        }
        // On a face: standing on the floor (a clock), else hung at its height; never above the
        // face's head (a low inner face: smaller)
        const room = face.floor - face.y;
        let foot = face.floor - (c.stands ? 0 : (c.hang || 0) * sz);
        if (face.kind !== 'back') {
            // (a short face — an inner wall's, the front wall's outside — takes things at its scale)
            const f = Math.min(1, (room * 0.92) / (h + (c.stands ? 0 : room * 0.1)));
            w *= f; h *= f;
            foot = c.stands ? face.floor : face.floor - room * 0.08;
            if (face.kind === 'front' && !(WINDOWS.has(id) || id === 'torch')) return;   // (its outside: only a window or a torch)
        }
        const top = Math.max(face.y - sz * CAP * 0.5, foot - h);
        ctx.drawImage(img, c.sx * k, c.sy * k, c.sw * k, c.sh * k, Math.round(cx - w / 2), Math.round(top), Math.round(w), Math.round(foot - top));
    });
    return ok;
}

/**
 * What lies on a piece (tile._decor of each of its tiles), drawn over it: spread along its
 * top. box: the piece's drawn sprite { x, y, w, h } on screen; top: [x0, y0, x1, y1]
 * fractions of it where things rest (the piece's art `top`, else a middle band).
 */
export function drawTableDecor(ctx, art, ids, box, top, sz, getImg, scale, seed = 0) {
    if (!ids.length || !art) return true;
    const t = top || [0.14, 0.14, 0.86, 0.45];
    const x0 = box.x + box.w * t[0], x1 = box.x + box.w * t[2];
    const y0 = box.y + box.h * t[1], y1 = box.y + box.h * t[3];
    const n = ids.length;
    // two rows when the top is deep enough for them and there are many things
    const rows = n > 3 && (y1 - y0) > sz * 0.4 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    let ok = true;
    ids.forEach((id, i) => {
        const a = artFor(art, id);
        if (!a) return;
        const img = getImg(a.sheet);
        if (!img) { ok = false; return; }
        const grid = a.grid || 48;
        const w = a.sw * sz / grid, h = a.sh * sz / grid;
        const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow);
        const jitter = ((((seed + i) * 2654435761) >>> 0) % 7 - 3) / 100 * (x1 - x0);
        const cx = x0 + (x1 - x0) * (col + 0.5) / inRow + jitter;
        const foot = rows === 2 ? y0 + (y1 - y0) * (row === 0 ? 0.55 : 1) : y0 + (y1 - y0) * 0.8;
        const k = scale(img);
        ctx.drawImage(img, a.sx * k, a.sy * k, a.sw * k, a.sh * k, Math.round(cx - w / 2), Math.round(foot - h), Math.round(w), Math.round(h));
    });
    return ok;
}
