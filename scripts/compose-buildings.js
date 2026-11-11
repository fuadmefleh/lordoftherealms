#!/usr/bin/env node
// ============================================================
// scripts/compose-buildings.js
// Builds the town's buildings out of wall, roof, door and window
// tiles. data/buildingKit.json names the tiles (`kit`), gives a
// recipe per building (`recipes`) and families of variants
// (`families`) that expand into many recipes; each recipe is laid
// out cell by cell into a building def (the same shape the sprite
// editor's Building mode saves) and written into data/buildings.json,
// replacing the defs it wrote before (tagged 'composed').
// Run with:  npm run compose:buildings   (then npm run build:data)
// ============================================================

const fs   = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const T = 32;

/** One cell of a layer: a 32px piece of a sheet drawn at (q, r). */
function cell(q, r, sheet, sx, sy, sw = T, sh = T) {
    return { q, r, sheetPath: sheet, sx, sy, sw, sh };
}

/** Column of a 9-slice for position i of n (0 = left edge, 1 = middle, 2 = right edge). */
function slot(i, n) {
    if (n === 1) return 1;
    return i === 0 ? 0 : i === n - 1 ? 2 : 1;
}

/** A small seeded generator (mulberry32) so families expand the same way every run. */
function seeded(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Lay out one block of wall + roof (the main house, or an annex) into `layers.floor`.
 * Returns { left, right, wallTop, roofTop }.
 */
function block(layers, kit, id, left, W, R, wallKey, roofKey, roofRowsWanted) {
    const wall = kit.walls[wallKey];
    if (!wall) throw new Error(`${id}: no wall '${wallKey}' in kit.walls`);
    if (wall.stack && R % 3) throw new Error(`${id}: wall '${wallKey}' is built in storeys of 3 rows`);
    const right = left + W - 1;
    const wallTop = -(R - 1);
    for (let i = 0; i < R; i++) {
        const row = wall.stack ? i % 3 : i === 0 ? 0 : i === R - 1 ? 2 : 1;
        for (let q = left; q <= right; q++) {
            const col = slot(q - left, W);
            layers.floor.push(cell(q, wallTop + i, wall.sheet, (wall.x + col) * T, (wall.y + row) * T));
        }
    }
    const roof = kit.roofs[roofKey];
    if (!roof) throw new Error(`${id}: no roof '${roofKey}' in kit.roofs`);
    const roofRows = roof.kind === 'parapet' ? 2 : (roofRowsWanted || 3);
    const roofTop = wallTop - roofRows;
    for (let i = 0; i < roofRows; i++) {
        const r = roofTop + i;
        for (let q = left; q <= right; q++) {
            const col = slot(q - left, W);
            const sy = roof.kind === 'parapet' ? roof.rowsY[i] : (roof.y + (i === 0 ? 0 : i === roofRows - 1 ? 2 : 1)) * T;
            layers.floor.push(cell(q, r, roof.sheet, (roof.x + col) * T + (roof.dx || 0), sy));
        }
    }
    return { left, right, wallTop, roofTop };
}

// ── Keeping the front's features inside the wall ──
// Windows, awnings, flower boxes and signs are a whole cell wide. In a wall's
// outermost column they would cover its side trim (the outline and pilaster that
// make the building read as a block) and run right up to the next house, so every
// feature keeps EDGE_MARGIN of a cell clear of each side of the wall block it
// sits on; a feature may stand at a half cell (the renderer draws cells at any q).
// A door keeps DOOR_GAP clear of the windows beside it (a framed door's frame
// reaches FRAME_REACH into the cells either side).
const EDGE_MARGIN = 0.5;
const FRAME_REACH = 0.22;
const DOOR_GAP = 0.08;

/** Subtract [x0, x1] spans from [A, B]: the free stretches left, in order. */
function freeSpans(A, B, blocked) {
    let spans = [[A, B]];
    for (const [x0, x1] of blocked) {
        const next = [];
        for (const [a, b] of spans) {
            if (x1 <= a || x0 >= b) { next.push([a, b]); continue; }
            if (x0 > a) next.push([a, x0]);
            if (x1 < b) next.push([x1, b]);
        }
        spans = next;
    }
    return spans.filter(([a, b]) => b - a >= 1 - 1e-9);
}

/**
 * Fit a run of one-cell features (sorted by x) into [a, b]: drop the outermost
 * (toward `dropFrom`: 'low', 'high' or 'both') until they fit, shrink the gaps
 * between them if they are spread too wide, then slide the run the least it
 * takes to sit inside. Returns the kept features' new x, by index (null: dropped).
 */
function packRun(xs, a, b, dropFrom) {
    const idx = xs.map((x, i) => i);
    let keep = idx.slice();
    const room = Math.floor(b - a + 1e-9);
    let flip = false;
    while (keep.length > room) {
        const fromLow = dropFrom === 'low' || (dropFrom === 'both' && !flip);
        if (fromLow) keep.shift(); else keep.pop();
        flip = !flip;
    }
    const out = xs.map(() => null);
    if (!keep.length) return out;
    const k = keep.map(i => xs[i]);
    const gaps = [];
    for (let i = 1; i < k.length; i++) gaps.push(Math.max(0, k[i] - k[i - 1] - 1));
    const gapSum = gaps.reduce((s, g) => s + g, 0);
    const need = k.length + gapSum;
    const f = need > b - a && gapSum > 0 ? Math.max(0, (b - a - k.length) / gapSum) : 1;
    const rel = [0];
    for (let i = 1; i < k.length; i++) rel.push(rel[i - 1] + 1 + gaps[i - 1] * f);
    const span = rel[rel.length - 1] + 1;
    const start = Math.min(Math.max(k[0], a), b - span);
    keep.forEach((i, j) => { out[i] = Math.round((start + rel[j]) * 100) / 100; });
    return out;
}

/**
 * Place a block's features. `items` are { x, top, bottom } (x: the cell's left,
 * top/bottom: the rows it covers); `fixed` are spans already taken
 * ({ x0, x1, top, bottom }: the door, a sign). Items are grouped by `group` (a
 * window's storey row) or else by the rows they cover; each group is spread over the free stretches of the wall, never nearer
 * than EDGE_MARGIN to the block's sides. Returns each item's new x (null: dropped).
 */
function fitFeatures(items, fixed, left, right) {
    const A = left + EDGE_MARGIN;
    const B = right + 1 - EDGE_MARGIN;
    const res = items.map(() => null);
    const groups = new Map();
    items.forEach((it, i) => {
        const key = it.group != null ? it.group : `${it.top},${it.bottom}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
    });
    for (const ids of groups.values()) {
        const top = Math.min(...ids.map(i => items[i].top));
        const bottom = Math.max(...ids.map(i => items[i].bottom));
        const blocked = fixed.filter(f => f.top <= bottom && f.bottom >= top).map(f => [f.x0, f.x1]);
        const spans = freeSpans(A, B, blocked);
        if (!spans.length) continue;
        // each feature to the stretch its middle is in (or the nearest)
        const bySpan = spans.map(() => []);
        for (const i of ids) {
            const c = items[i].x + 0.5;
            let best = 0, bestD = Infinity;
            spans.forEach(([a, b], s) => {
                const d = c < a ? a - c : c > b ? c - b : 0;
                if (d < bestD) { bestD = d; best = s; }
            });
            bySpan[best].push(i);
        }
        spans.forEach(([a, b], s) => {
            const run = bySpan[s].sort((p, q) => items[p].x - items[q].x);
            if (!run.length) return;
            // drop from the end toward the building's side, never the door's
            const dropFrom = blocked.length === 0 ? 'both' : a <= A + 1e-9 && b >= B - 1e-9 ? 'both' : a <= A + 1e-9 ? 'low' : b >= B - 1e-9 ? 'high' : 'both';
            const xs = packRun(run.map(i => items[i].x), a, b, dropFrom);
            run.forEach((i, j) => { res[i] = xs[j]; });
        });
    }
    return res;
}

function compose(recipe, kit) {
    const W = recipe.width;
    const R = recipe.wallRows || 3;
    const left = -Math.floor(W / 2);
    const layers = { floor: [], walls: [], roof: [], overlay: [] };
    const need = (table, key, what) => {
        const v = kit[table] && kit[table][key];
        if (!v) throw new Error(`${recipe.id}: no ${what} '${key}' in kit.${table}`);
        return v;
    };

    // ── The house, and an annex (a lower wing) to one side ──
    const main = block(layers, kit, recipe.id, left, W, R, recipe.wall, recipe.roof, recipe.roofRows);
    let minQ = main.left, maxQ = main.right;
    const annexes = recipe.annexes || (recipe.annex ? [recipe.annex] : []);
    for (const a of annexes) {
        const aLeft = a.side === 'left' ? minQ - a.width : maxQ + 1;
        const ab = block(layers, kit, recipe.id, aLeft, a.width, a.wallRows || 3, a.wall || recipe.wall, a.roof || recipe.roof, a.roofRows || 2);
        minQ = Math.min(minQ, ab.left); maxQ = Math.max(maxQ, ab.right);
        const wins = (a.windows || []).map(w => ({ w, win: need('windows', w.style, 'window') }));
        const xs = fitFeatures(wins.map(({ w, win }) => ({ x: ab.left + w.q, top: w.r, bottom: w.r + win.cells.length - 1 })), [], ab.left, ab.right);
        wins.forEach(({ w, win }, i) => {
            if (xs[i] == null) return;
            win.cells.forEach(([sx, sy], j) => layers.walls.push(cell(xs[i], w.r + j, win.sheet, sx, sy)));
        });
    }

    // ── Door: a frame three tiles wide, the panel in the middle ──
    const dq = recipe.doorQ || 0;
    const door = need('doors', recipe.door, 'door');
    const doorW = door.tiles ? Math.max(...door.tiles.map(t => t[0])) + 1 : 1;
    // (a wide door stands in the middle of the front: half a cell over on an odd width)
    const dx0 = recipe.doorQ == null && doorW > 1 ? (main.left + W / 2) - doorW / 2 : dq;
    const doorTop = door.tiles ? Math.min(...door.tiles.map(t => t[1])) : door.frame ? -1 : -((door.cells || [[]]).length - 1);
    if (door.frame) {
        const fr = need('doorFrames', door.frame, 'door frame');
        for (let dr = 0; dr < 2; dr++) {
            for (let c = 0; c < 3; c++) {
                layers.walls.push(cell(dq - 1 + c, -1 + dr, fr.sheet, (fr.x + c) * T, (fr.y + dr) * T));
            }
        }
    }
    // (a wide door, an arched pair of leaves, lists its tiles as [dq, dr, sx, sy] from the door cell)
    for (const [tq, tr, sx, sy] of door.tiles || []) layers.roof.push(cell(dx0 + tq, tr, door.sheet, sx, sy));
    for (let i = 0; i < (door.cells || []).length; i++) {
        const [sx, sy] = door.cells[i];
        const h = door.cells.length;
        layers.roof.push(cell(dq + (door.dq || 0), -(h - 1) + i, door.sheet, sx, sy, door.sw || T));
    }
    const reach = door.frame ? FRAME_REACH : 0;
    const fixed = [{ x0: dx0 - reach - DOOR_GAP, x1: dx0 + doorW + reach + DOOR_GAP, top: doorTop, bottom: 0 }];
    if (recipe.porch) fixed.push({ x0: dx0 + doorW / 2 - 0.5, x1: dx0 + doorW / 2 + 0.5, top: -2, bottom: -2 });

    // ── Signs: over the door, centred on it; anywhere else, inside the wall's sides ──
    const signs = (recipe.signs || []).map(s => {
        const x = s.q === dq ? dx0 + doorW / 2 - 0.5 : Math.min(Math.max(s.q, main.left + EDGE_MARGIN), main.right - EDGE_MARGIN);
        fixed.push({ x0: x, x1: x + 1, top: s.r, bottom: s.r });
        return { ...s, x };
    });

    // ── Windows (with their awnings and flower boxes), spread over the wall clear of its sides ──
    const wins = (recipe.windows || []).map(w => {
        const win = need('windows', w.style, 'window');
        // A culture's tall window stands on the sill of its storey (row -1 or -4), never below it
        // (the kit's older buildings keep theirs as they were drawn)
        const tall = recipe.culture && (w.r === -1 || w.r === -4) && win.cells.length > 1;
        const wr = tall ? Math.max(main.wallTop, w.r - win.cells.length + 1) : w.r;
        const bottom = tall ? w.r : w.r + win.cells.length - 1;
        return { w, win, tall, wr, top: wr, bottom };
    });
    const wx = fitFeatures(wins.map(o => ({ x: o.w.q, top: o.top, bottom: o.bottom, group: o.w.r })), fixed, main.left, main.right);
    const movedTo = new Map();      // a ground-floor window's old q -> where it went (its flower box follows)
    wins.forEach(({ w, win, tall, wr }, i) => {
        if (w.r === -1) movedTo.set(w.q, wx[i]);
        if (wx[i] == null) return;
        win.cells.forEach(([sx, sy], j) => { if (!tall || wr + j <= w.r) layers.walls.push(cell(wx[i], wr + j, win.sheet, sx, sy)); });
        // (an awning that would run into a sign or the porch over the door is left off)
        const x = wx[i];
        if (w.awning && !fixed.some(f => f.top <= w.r - 1 && f.bottom >= w.r - 1 && f.x0 < x + 1 && f.x1 > x)) {
            const a = need('awnings', w.awning, 'awning');
            layers.overlay.push(cell(x, w.r - 1, a.sheet, a.sx, a.sy));
        }
    });
    if (recipe.porch) {
        const a = need('awnings', recipe.porch, 'awning');
        layers.overlay.push(cell(dx0 + doorW / 2 - 0.5, -2, a.sheet, a.sx, a.sy));
    }
    for (const fb of recipe.flowerBoxes || []) {
        const box = need('parts', fb.part || 'flower_box', 'part');
        const x = movedTo.has(fb.q) ? movedTo.get(fb.q) : Math.min(Math.max(fb.q, main.left + EDGE_MARGIN), main.right - EDGE_MARGIN);
        if (x == null) continue;
        box.cells.forEach(([dx, dy, sx, sy]) => layers.overlay.push(cell(x + dx, dy, box.sheet, sx, sy)));
    }
    for (const s of signs) {
        const plaque = need('signs', s.plaque || 'oak', 'sign');
        layers.overlay.push(cell(s.x, s.r, plaque.sheet, plaque.sx, plaque.sy));
        if (s.emblem) {
            const e = need('emblems', s.emblem, 'emblem');
            layers.overlay.push(cell(s.x, s.r, e.sheet, e.sx, e.sy));
        }
    }
    // (a chimney stands on the roof, in from its eaves)
    for (const c of recipe.chimneys || []) {
        const ch = need('chimneys', c.style, 'chimney');
        const x = Math.min(Math.max(c.q, main.left + EDGE_MARGIN), main.right - EDGE_MARGIN);
        layers.overlay.push(cell(x, main.roofTop + (c.r || 0) - 1, ch.sheet, ch.sx, ch.sy));
        layers.overlay.push(cell(x, main.roofTop + (c.r || 0), ch.sheet, ch.sx, ch.sy + T));
    }
    for (const p of recipe.parts || []) {
        const part = need('parts', p.part, 'part');
        part.cells.forEach(([dx, dy, sx, sy]) => layers[p.layer || 'overlay'].push(cell(p.q + dx, p.r + dy, part.sheet, sx, sy)));
    }

    // ── Footprint: each column blocks from its roof down to the ground, but the door ──
    // (a chimney pokes above the roof without blocking; the sky over a low annex stays open)
    const colTop = {};
    for (const c of layers.floor) colTop[c.q] = Math.min(colTop[c.q] == null ? 0 : colTop[c.q], c.r);
    let minR = 0;
    for (const arr of Object.values(layers)) for (const c of arr) minR = Math.min(minR, c.r);
    const meta = [];
    for (let q = minQ; q <= maxQ; q++) {
        for (let r = colTop[q] == null ? 0 : colTop[q]; r <= 0; r++) {
            const isDoor = q === dq && r === 0;
            meta.push({ q, r, impassable: !isDoor, door: isDoor });
        }
    }

    return {
        id: recipe.id,
        name: recipe.name,
        buildingType: recipe.buildingType,
        style: recipe.style || null,
        // A culture's own building (data/architecture.json): only that culture's towns use it
        ...(recipe.culture ? { culture: recipe.culture } : {}),
        // What it is built of: towns pick by their culture's materials (world/cultures.js)
        wall: recipe.wall || null,
        roof: recipe.roof || null,
        tags: ['composed', ...(recipe.culture ? [`culture:${recipe.culture}`] : []), ...(recipe.tags || [])],
        tileW: T, tileH: T,
        width: maxQ - minQ + 1, height: 1 - minR,
        layers,
        meta,
        bounds: { minCol: minQ, minRow: minR, maxCol: maxQ, maxRow: 0 },
    };
}

/** Ground- (and upper-) floor windows for a front W wide, keeping clear of the door frame. */
function autoWindows(W, R, stack, style, upper, awning, rng, mix = null, skip = 0) {
    const left = -Math.floor(W / 2);
    const right = left + W - 1;
    const out = [];
    for (let q = left; q <= right; q++) {
        if (Math.abs(q) <= 1) continue;
        if (W >= 7 && Math.abs(q) === right && rng() < 0.3) continue;
        if (skip && rng() < skip) continue;
        const st = mix ? mix[Math.floor(rng() * mix.length)] : style;
        out.push({ q, r: -1, style: st, ...(awning ? { awning } : {}) });
    }
    if (R >= 5) {
        for (let q = left; q <= right; q++) {
            if ((q - left) % 2 === (W >= 7 ? 1 : 0) || W <= 3) out.push({ q, r: -4, style: upper });
        }
    }
    return out;
}

/**
 * Expand a family into recipes: each variant draws its wall, roof, door,
 * width, height and trimmings from the family's lists.
 */
function expandFamily(f, kit) {
    const rng = seeded(f.id);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const out = [];
    const seen = new Set();
    for (let i = 0, tries = 0; i < f.count && tries < f.count * 20; tries++) {
        const wall = pick(f.walls);
        const stack = !!(kit.walls[wall] && kit.walls[wall].stack);
        const R = stack ? pick(f.stackRows || [6]) : pick(f.wallRows || [3]);
        const W = pick(f.widths);
        const roof = pick(f.roofs);
        const door = pick(f.doors);
        const sig = `${wall}|${R}|${W}|${roof}|${door}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const awning = f.awnings && rng() < (f.awningChance == null ? 1 : f.awningChance) ? pick(f.awnings) : null;
        const left = -Math.floor(W / 2);
        const r = {
            id: `${f.id}_${++i}`,
            name: f.names ? pick(f.names) : f.name,
            buildingType: f.buildingType,
            style: f.style,
            width: W,
            wallRows: R,
            wall, roof, door,
            roofRows: pick(f.roofRows || [2, 3]),
            windows: autoWindows(W, R, stack, pick(f.windowStyles || ['small']), pick(f.upperWindowStyles || ['small']), awning, rng, f.windowMix || null, f.windowSkip || 0),
        };
        // A porch awning over the door, flower boxes under the ground-floor windows
        if (f.porches && !f.signs && rng() < (f.porchChance == null ? 0.3 : f.porchChance)) r.porch = pick(f.porches);
        if (rng() < (f.flowerBoxChance || 0)) {
            r.flowerBoxes = r.windows.filter(w => w.r === -1 && !w.awning).map(w => ({ q: w.q }));
        }
        if (f.chimneys && rng() < (f.chimneyChance == null ? 0.7 : f.chimneyChance)) {
            const side = rng() < 0.5 ? left : left + W - 1;
            r.chimneys = [{ q: side === 0 ? 1 : side, style: pick(f.chimneys) }];
        }
        if (f.signs && f.signs.length) {
            const s = pick(f.signs);
            r.signs = [{ q: 0, r: -2, emblem: s.emblem, plaque: s.plaque || 'oak' }];
            if (s.name) r.name = s.name;
            if (R <= 3) r.windows = r.windows.filter(w => w.r !== -2);
        }
        if (f.annex && rng() < (f.annex.chance == null ? 0.4 : f.annex.chance)) {
            const aw = pick(f.annex.widths || [2, 3]);
            r.annex = {
                side: rng() < 0.5 ? 'left' : 'right',
                width: aw,
                wallRows: pick(f.annex.wallRows || [3]),
                wall: f.annex.sameWall === false ? pick(f.annex.walls || f.walls.filter(w => !(kit.walls[w] && kit.walls[w].stack))) : (stack ? pick(f.annex.walls || ['plaster']) : wall),
                roof: f.annex.sameRoof === false ? pick(f.annex.roofs || f.roofs) : roof,
                roofRows: 2,
                windows: aw >= 2 ? [{ q: Math.floor(aw / 2), r: -1, style: 'small' }] : [],
            };
            if ((kit.walls[r.annex.wall] || {}).stack) r.annex.wall = 'plaster';
            if (f.annex.both && rng() < f.annex.both) {
                const other = { ...r.annex, side: r.annex.side === 'left' ? 'right' : 'left', width: pick(f.annex.widths || [2, 3]) };
                other.windows = other.width >= 2 ? [{ q: Math.floor(other.width / 2), r: -1, style: 'small' }] : [];
                r.annexes = [r.annex, other];
                delete r.annex;
            }
        }
        out.push(r);
    }
    return out;
}

/**
 * A culture's family: ids prefixed with the culture, every recipe stamped with
 * it. A family with `buildingTypes` makes `count` of each type (a hall that is
 * town hall, guildhall, church…), named and signed by `typeNames`/`typeSigns`.
 */
function expandCultureFamily(culture, f, kit) {
    const base = `${culture.toLowerCase()}_${f.id}`;
    const types = f.buildingTypes || [f.buildingType || 'house'];
    const out = [];
    for (const t of types) {
        const id = f.buildingTypes ? `${base}_${t}` : base;
        const sign = (f.typeSigns || {})[t];
        const fam = { ...f, id, buildingType: t, name: (f.typeNames || {})[t] || f.name };
        if (sign) fam.signs = [{ emblem: sign, plaque: f.plaque || 'oak', name: fam.name }];
        for (const r of expandFamily(fam, kit)) out.push({ ...r, culture });
    }
    return out;
}

// ── Wealth tiers (data/architecture.json culture `tiers`, top-level `wealth`) ──
const TIERS = ['poor', 'mid', 'rich'];

/** A stable pick from a list by a string (no shared generator: a variant never moves another) */
function hashPick(arr, str) {
    if (!arr || !arr.length) return null;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return arr[(h >>> 0) % arr.length];
}

/**
 * A recipe as a tier builds it: its walls and roof from the tier's lists (a flat roof
 * stays flat where the tier has flat roofs, else it is pitched in as many rows), its
 * windows the tier's look of the same size, a poor house's panel door plain and its
 * porch and flower boxes gone. Everything that sets the footprint stays as it was.
 */
function tierRecipe(r, tier, spec, rules, kit) {
    const v = JSON.parse(JSON.stringify(r));
    v.id = `${r.id}~${tier}`;
    const R = r.wallRows || 3;
    const wallsFor = (rows) => (spec.walls || []).filter(w => kit.walls[w] && (!kit.walls[w].stack || rows % 3 === 0));
    const plainWalls = (spec.walls || []).filter(w => kit.walls[w] && !kit.walls[w].stack);
    const pitched = (spec.roofs || []).filter(k => kit.roofs[k] && kit.roofs[k].kind !== 'parapet');
    const flat = (spec.flatRoofs || []).filter(k => kit.roofs[k] && kit.roofs[k].kind === 'parapet');
    const roofFor = (roof, rows, salt) => {
        const was = kit.roofs[roof] || {};
        if (was.kind === 'parapet') {
            if (flat.length) return { roof: hashPick(flat, v.id + salt), rows };
            if (pitched.length) return { roof: hashPick(pitched, v.id + salt), rows: 2 };   // (a parapet is 2 rows)
            return { roof, rows };
        }
        return { roof: hashPick(pitched, v.id + salt) || roof, rows };
    };
    v.wall = hashPick(wallsFor(R), v.id) || r.wall;
    const main = roofFor(r.roof, r.roofRows, ':roof');
    v.roof = main.roof;
    v.roofRows = main.rows;
    const winMap = (rules.windows || {})[tier] || {};
    // (a poor house has no tall glazed windows: one of its own rough ones stands on the sill instead)
    const poorWin = tier === 'poor' && rules.poorWindow && kit.windows[rules.poorWindow] ? rules.poorWindow : null;
    const win = (st) => {
        if (poorWin && kit.windows[st] && kit.windows[st].cells.length > 1) return poorWin;
        const to = winMap[st];
        if (to && kit.windows[to] && kit.windows[st] && kit.windows[to].cells.length === kit.windows[st].cells.length) return to;
        return poorWin && kit.windows[st] && kit.windows[st].cells.length > 1 ? poorWin : st;
    };
    v.windows = (v.windows || []).map(w => ({ ...w, style: win(w.style) }));
    const annexes = v.annexes || (v.annex ? [v.annex] : []);
    annexes.forEach((a, i) => {
        if (a.wall) a.wall = hashPick(plainWalls, `${v.id}:annex${i}`) || a.wall;
        // (an annex under the house's own roof keeps it: the variant's)
        if (a.roof) {
            const ar = roofFor(a.roof, a.roofRows || 2, `:annexroof${i}`);
            a.roof = ar.roof;
            a.roofRows = ar.rows;
        }
        a.windows = (a.windows || []).map(w => ({ ...w, style: win(w.style) }));
    });
    if (tier === 'poor') {
        // (a plain plank door: a wide arched pair is a richer house's)
        if (kit.doors[r.door] && Array.isArray(rules.poorDoors) && rules.poorDoors.length) v.door = hashPick(rules.poorDoors, v.id + ':door');
        delete v.porch;
        delete v.flowerBoxes;
    }
    return v;
}

/** Whether a variant stands on exactly the building's ground (so either fits wherever the other does) */
function sameFootprint(a, b) {
    if (!a || !b) return false;
    if (JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) return false;
    return JSON.stringify(a.meta) === JSON.stringify(b.meta);
}

/**
 * The variant as a patch on its building (a full copy of every culture building three
 * times over would treble data/buildings.json): per layer, the cells that differ by
 * index ([i, sheet, sx, sy, sw?, sh?]), or the whole layer ([q, r, sheet, sx, sy, sw, sh])
 * where its cells no longer line up. world/customBuildings.js lays the patch back on.
 */
function derive(base, v, tier, stands = base, arch = null) {
    const sheets = [];
    const si = (p) => { let i = sheets.indexOf(p); if (i < 0) { i = sheets.length; sheets.push(p); } return i; };
    const patch = {};
    for (const [ln, cells] of Object.entries(v.layers)) {
        const was = base.layers[ln] || [];
        const now = stands.layers[ln] || [];
        const same = (c, o) => c.sheetPath === o.sheetPath && c.sx === o.sx && c.sy === o.sy && c.sw === o.sw && c.sh === o.sh;
        // Lined up: the same cells in the same order, as composed and as the building stands
        // (a cell touched up since composing, a porch, is kept as it stands where the tier keeps it)
        const lined = was.length === cells.length && now.length === cells.length
            && cells.every((c, i) => c.q === was[i].q && c.r === was[i].r && (same(c, was[i]) || (c.q === now[i].q && c.r === now[i].r)));
        if (lined) {
            const diff = [];
            cells.forEach((c, i) => {
                const o = was[i];
                if (same(c, o)) return;
                const e = [i, si(c.sheetPath), c.sx, c.sy];
                if (c.sw !== T || c.sh !== T) e.push(c.sw, c.sh);
                diff.push(e);
            });
            if (diff.length) patch[ln] = diff;
        } else {
            patch[ln] = { all: cells.map(c => [c.q, c.r, si(c.sheetPath), c.sx, c.sy, c.sw, c.sh]) };
        }
    }
    return {
        id: v.id,
        derivedFrom: base.id,
        tier,
        // (a hut built of brick under slate is no hut: data/architecture.json wealth.names)
        name: (((arch && arch.wealth && arch.wealth.names) || {})[tier] || {})[base.name] || base.name,
        buildingType: base.buildingType,
        style: base.style,
        ...(base.culture ? { culture: base.culture } : {}),
        wall: v.wall,
        roof: v.roof,
        tags: ['composed', 'tier', `tier:${tier}`],
        sheets,
        patch,
    };
}

function main() {
    const kitFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'buildingKit.json'), 'utf8'));
    const out = path.join(dataDir, 'buildings.json');
    const existing = JSON.parse(fs.readFileSync(out, 'utf8'));
    const kept = existing.filter(b => !(b.tags || []).includes('composed'));
    const recipes = [...kitFile.recipes];
    for (const f of kitFile.families || []) recipes.push(...expandFamily(f, kitFile.kit));
    // Each culture's own houses, shops and halls (data/architecture.json), built of the same kit
    const arch = JSON.parse(fs.readFileSync(path.join(dataDir, 'architecture.json'), 'utf8'));
    for (const [culture, a] of Object.entries(arch.cultures || {})) {
        for (const f of a.families || []) recipes.push(...expandCultureFamily(culture, f, kitFile.kit));
    }
    const fresh = recipes.map(r => compose(r, kitFile.kit));
    // --tiers-only: every building stays exactly as data/buildings.json has it (some were
    // touched up after composing: the door-wide porch awnings); only the tier variants are made anew
    const tiersOnly = process.argv.includes('--tiers-only');
    const had = new Map(existing.filter(b => !b.derivedFrom).map(b => [b.id, b]));
    const composed = tiersOnly ? existing.filter(b => (b.tags || []).includes('composed') && !b.derivedFrom) : fresh;
    // Each culture building as the poor, middling and rich build it (data/architecture.json
    // `tiers`, `wealth`): the same footprint in that tier's materials, stored as a patch on it
    const variants = [];
    let skipped = 0;
    recipes.forEach((r, i) => {
        const tiers = r.culture && (arch.cultures[r.culture] || {}).tiers;
        if (!tiers) return;
        const base = fresh[i];
        const stands = tiersOnly ? had.get(r.id) : base;
        if (!stands) return;
        for (const tier of TIERS) {
            if (!tiers[tier]) continue;
            const v = compose(tierRecipe(r, tier, tiers[tier], arch.wealth || {}, kitFile.kit), kitFile.kit);
            if (!sameFootprint(base, v) || !sameFootprint(stands, v)) { skipped++; continue; }
            variants.push(derive(base, v, tier, stands, arch));
        }
    });
    if (skipped) console.warn(`${skipped} tier variant(s) skipped: their footprint differed from the building's`);
    // One cell to a line: hundreds of buildings of a few dozen cells each
    const text = JSON.stringify([...kept, ...composed], null, 2)
        .replace(/\{\n\s+([^{}[\]]*?)\n\s+\}/g, (m, body) => `{ ${body.split(/,\n\s+/).join(', ')} }`);
    // (the tier variants a line each: their patches are long lists of short ones)
    const tail = variants.map(v => '  ' + JSON.stringify(v)).join(',\n');
    fs.writeFileSync(out, (variants.length ? text.replace(/\n\]$/, ',\n' + tail + '\n]') : text) + '\n');
    console.log(`${tiersOnly ? 'Kept' : 'Composed'} ${composed.length} building(s) and made ${variants.length} tier variant(s) in data/buildings.json (${kept.length} authored kept)`);
}

if (require.main === module) main();
module.exports = { compose, expandFamily, expandCultureFamily, tierRecipe, derive, sameFootprint };
