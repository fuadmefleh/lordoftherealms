/* ============================================================
   WorldTools — pure map logic for world_editor.html
   ------------------------------------------------------------
   Hex math (even-r offset, the game's layout), the terrain
   sculpting ladder, smoothing, coastline shaping, the world
   generator (seamless east-west, like the game's wrapping map,
   with rivers), symmetry, and the map check. DOM-free so the
   vitest suite can exercise it (src/__tests__/worldEditorTools).

   Classic script: window.WorldTools / globalThis.WorldTools.
   Tiles are a flat array of terrain ids, index r * W + q.
   ============================================================ */
(function () {
    'use strict';
    var g = typeof globalThis !== 'undefined' ? globalThis : this;
    if (g && g.WorldTools) return;

    // ── terrain families ────────────────────────────────────
    var WATER = { deep_ocean: 1, ocean: 1, coast: 1, sea: 1, lake: 1 };
    var OPEN_WATER = { deep_ocean: 1, ocean: 1, coast: 1, sea: 1 };
    var IMPASSABLE = { deep_ocean: 1, ocean: 1, coast: 1, sea: 1, lake: 1, snow_peak: 1 };
    function isWater(id) { return !!WATER[id]; }
    function isLand(id) { return !!id && !WATER[id]; }
    function isPassable(id) { return !!id && !IMPASSABLE[id]; }

    // Height ladder for the raise / lower brushes. Lowland biomes share a rung.
    var RUNG = {
        deep_ocean: 0, ocean: 1, sea: 1, coast: 2, lake: 2,
        beach: 3, island: 3, swamp: 3,
        grassland: 4, plains: 4, woodland: 4, boreal_forest: 4, seasonal_forest: 4,
        temperate_rainforest: 4, tropical_rainforest: 4, savanna: 4, desert: 4,
        tundra: 4, snow: 4, ice: 4,
        hills: 5, highlands: 6, mountain: 7, snow_peak: 8,
    };
    var LADDER = ['deep_ocean', 'ocean', 'coast', 'beach', null, 'hills', 'highlands', 'mountain', 'snow_peak'];

    // Step a terrain one rung up (dir 1) or down (dir -1). `lowland` is the
    // biome to use when climbing onto (or descending into) the lowland rung.
    function stepTerrain(id, dir, lowland) {
        var rung = RUNG[id];
        if (rung == null) rung = 4;
        var next = Math.max(0, Math.min(8, rung + dir));
        if (next === rung) return id;
        if (next === 4) return lowland || 'grassland';
        return LADDER[next];
    }

    // ── hex math (even-r offset: even rows shifted half a hex right) ─
    var DIRS_EVEN = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
    var DIRS_ODD = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
    function wrapQ(q, W) { return ((q % W) + W) % W; }

    // The 6 neighbours, E NE NW W SW SE (Hex.neighbors order). With `wrap`
    // they wrap east-west like the game map; rows never wrap.
    function neighbors(q, r, W, H, wrap) {
        var dirs = r % 2 === 0 ? DIRS_EVEN : DIRS_ODD;
        var out = [];
        for (var i = 0; i < 6; i++) {
            var nq = q + dirs[i][0], nr = r + dirs[i][1];
            if (nr < 0 || nr >= H) continue;
            if (wrap) nq = wrapQ(nq, W);
            else if (nq < 0 || nq >= W) continue;
            out.push({ q: nq, r: nr, dir: i });
        }
        return out;
    }

    function toCube(q, r) {
        var x = q - (r + (r & 1)) / 2;
        return { x: x, z: r, y: -x - r };
    }
    function fromCube(c) {
        return { q: c.x + (c.z + (c.z & 1)) / 2, r: c.z };
    }
    function cubeRound(x, y, z) {
        var rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
        var dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
        if (dx > dy && dx > dz) rx = -ry - rz;
        else if (dy > dz) ry = -rx - rz;
        else rz = -rx - ry;
        return { x: rx, y: ry, z: rz };
    }
    function distance(q1, r1, q2, r2) {
        var a = toCube(q1, r1), b = toCube(q2, r2);
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
    }
    // Every hex on the straight line from a to b, ends included.
    function line(q1, r1, q2, r2) {
        var a = toCube(q1, r1), b = toCube(q2, r2);
        var n = distance(q1, r1, q2, r2);
        var out = [];
        for (var i = 0; i <= n; i++) {
            var t = n === 0 ? 0 : i / n;
            var c = cubeRound(
                a.x + (b.x - a.x) * t + 1e-6,
                a.y + (b.y - a.y) * t + 1e-6,
                a.z + (b.z - a.z) * t - 2e-6
            );
            out.push(fromCube(c));
        }
        return out;
    }
    // Hexes within `radius` steps of (q, r), clipped to the map.
    function disc(q, r, radius, W, H) {
        var out = [];
        var c = toCube(q, r);
        for (var dx = -radius; dx <= radius; dx++) {
            for (var dy = Math.max(-radius, -dx - radius); dy <= Math.min(radius, -dx + radius); dy++) {
                var h = fromCube({ x: c.x + dx, y: c.y + dy, z: c.z - dx - dy });
                if (h.q >= 0 && h.q < W && h.r >= 0 && h.r < H) out.push(h);
            }
        }
        return out;
    }
    // All hexes in the offset-coordinate rectangle spanned by a and b.
    function rect(q1, r1, q2, r2, W, H) {
        var out = [];
        var qa = Math.max(0, Math.min(q1, q2)), qb = Math.min(W - 1, Math.max(q1, q2));
        var ra = Math.max(0, Math.min(r1, r2)), rb = Math.min(H - 1, Math.max(r1, r2));
        for (var r = ra; r <= rb; r++) for (var q = qa; q <= qb; q++) out.push({ q: q, r: r });
        return out;
    }

    // Flood region of same-valued cells from (q, r): `valueAt(q, r)`.
    function floodRegion(q, r, W, H, valueAt) {
        var target = valueAt(q, r);
        var seen = new Uint8Array(W * H);
        var out = [];
        var stack = [q, r];
        seen[r * W + q] = 1;
        while (stack.length) {
            var cr = stack.pop(), cq = stack.pop();
            out.push({ q: cq, r: cr });
            var ns = neighbors(cq, cr, W, H, false);
            for (var i = 0; i < ns.length; i++) {
                var n = ns[i], k = n.r * W + n.q;
                if (!seen[k] && valueAt(n.q, n.r) === target) { seen[k] = 1; stack.push(n.q, n.r); }
            }
        }
        return out;
    }

    // ── symmetry ────────────────────────────────────────────
    // Mirror partners of (q, r). Offset rows can't mirror exactly across a
    // vertical axis, so east-west mirrors land within half a hex.
    function mirrorQ(q, r, W) { return W - 1 - q; }
    function symmetry(q, r, W, H, mode) {
        var pts = [{ q: q, r: r }];
        if (!mode || mode === 'none') return pts;
        var mq = mirrorQ(q, r, W), mr = H - 1 - r;
        if (mode === 'x' || mode === 'quad') pts.push({ q: mq, r: r });
        if (mode === 'y' || mode === 'quad') pts.push({ q: q, r: mr });
        if (mode === 'quad') pts.push({ q: mq, r: mr });
        if (mode === 'radial') pts.push({ q: mq, r: mr });
        var seen = {};
        return pts.filter(function (p) {
            var k = p.q + ',' + p.r;
            if (seen[k] || p.q < 0 || p.q >= W || p.r < 0 || p.r >= H) return false;
            seen[k] = 1;
            return true;
        });
    }

    // ── connection masks (roads, rivers: game bit order) ───────
    // Bit (dir + 3) % 6 is set for each connected neighbour direction —
    // the game renderer's sprite naming (hexRoad-NNNNNN, hexRiverNNNNNN).
    function connectionMask(q, r, W, H, connected, wrap) {
        var ns = neighbors(q, r, W, H, wrap);
        var mask = 0;
        for (var i = 0; i < ns.length; i++) {
            if (connected(ns[i].q, ns[i].r)) mask |= 1 << ((ns[i].dir + 3) % 6);
        }
        return ('000000' + mask.toString(2)).slice(-6);
    }

    // ── whole-map transforms ────────────────────────────────
    // Majority of each hex and its neighbours (self counts 2). Water and land
    // smooth separately unless `mixed`, so coastlines keep their shape.
    function smooth(tiles, W, H, cells, opts) {
        opts = opts || {};
        var src = tiles.slice();
        var out = tiles.slice();
        var list = cells || allCells(W, H);
        for (var i = 0; i < list.length; i++) {
            var c = list[i], k = c.r * W + c.q;
            var self = src[k];
            var votes = {};
            votes[self] = 2;
            var ns = neighbors(c.q, c.r, W, H, opts.wrap);
            for (var j = 0; j < ns.length; j++) {
                var t = src[ns[j].r * W + ns[j].q];
                if (!opts.mixed && isWater(t) !== isWater(self)) continue;
                votes[t] = (votes[t] || 0) + 1;
            }
            var best = self, bestN = votes[self];
            for (var id in votes) if (votes[id] > bestN) { best = id; bestN = votes[id]; }
            out[k] = best;
        }
        return out;
    }

    function allCells(W, H) {
        var out = [];
        for (var r = 0; r < H; r++) for (var q = 0; q < W; q++) out.push({ q: q, r: r });
        return out;
    }

    // Distance (in hexes) from every cell to the nearest land, capped at `cap`.
    function distanceToLand(tiles, W, H, cap, wrap) {
        var d = new Int16Array(W * H).fill(cap);
        var queue = [];
        for (var k = 0; k < W * H; k++) if (isLand(tiles[k])) { d[k] = 0; queue.push(k); }
        for (var p = 0; p < queue.length; p++) {
            var cur = queue[p], q = cur % W, r = (cur / W) | 0;
            if (d[cur] >= cap) continue;
            var ns = neighbors(q, r, W, H, wrap);
            for (var i = 0; i < ns.length; i++) {
                var nk = ns[i].r * W + ns[i].q;
                if (d[nk] > d[cur] + 1) { d[nk] = d[cur] + 1; queue.push(nk); }
            }
        }
        return d;
    }

    // Shape the sea by its distance from land: coastal waters hugging the
    // shore, open ocean beyond, the deep past `deep` hexes. Lakes are kept.
    // `beaches` turns lowland touching the sea to beach.
    function shapeCoast(tiles, W, H, opts) {
        opts = opts || {};
        var deep = opts.deep || 4;
        var out = tiles.slice();
        var d = distanceToLand(tiles, W, H, deep + 1, opts.wrap);
        for (var k = 0; k < W * H; k++) {
            var t = tiles[k];
            if (OPEN_WATER[t]) out[k] = d[k] <= 1 ? 'coast' : d[k] >= deep ? 'deep_ocean' : 'ocean';
        }
        if (opts.beaches) {
            for (var r = 0; r < H; r++) for (var q = 0; q < W; q++) {
                var i = r * W + q;
                if (RUNG[out[i]] !== 4 || out[i] === 'snow' || out[i] === 'ice') continue;
                var ns = neighbors(q, r, W, H, opts.wrap);
                for (var j = 0; j < ns.length; j++) {
                    if (OPEN_WATER[out[ns[j].r * W + ns[j].q]]) { out[i] = 'beach'; break; }
                }
            }
        }
        return out;
    }

    // How readily each shore turns to sand: warm, dry lowland most; cold,
    // marshy or jungle shores hardly (missing = never: tundra, snow, swamp)
    var SANDY = {
        desert: 0.26, savanna: 0.22, plains: 0.18, grassland: 0.14, island: 0.16,
        woodland: 0.02, seasonal_forest: -0.04, tropical_rainforest: 0.04,
        temperate_rainforest: -0.25, boreal_forest: -0.4,
    };

    /**
     * Lay sand where beaches would form, not along every shore. A beach needs
     * low ground at the water (hills or mountains at the shore make cliffs),
     * a mild climate, shelter (bays and coves keep their sand; exposed
     * headlands are scoured to rock), and a supply of sediment, which rivers
     * bring down to their mouths. Low-frequency noise makes the beaches run
     * in stretches rather than speckle. opts: { seed, rivers, wrap }.
     */
    function placeBeaches(tiles, W, H, opts) {
        opts = opts || {};
        var out = tiles.slice(), seed = (opts.seed >>> 0) || 1, rivers = opts.rivers || {}, wrap = opts.wrap;
        for (var r = 0; r < H; r++) {
            for (var q = 0; q < W; q++) {
                var k = r * W + q, sandy = SANDY[tiles[k]];
                if (sandy == null) continue;
                var ns = neighbors(q, r, W, H, wrap), shore = false, cliff = false, i;
                for (i = 0; i < ns.length; i++) {
                    var nt = tiles[ns[i].r * W + ns[i].q];
                    if (OPEN_WATER[nt]) shore = true;
                    else if (RUNG[nt] >= 5) cliff = true;
                }
                if (!shore || cliff) continue;
                // Shelter: how much open water lies within two hexes
                var seen = {}, ring = ns.slice(), water = 0, total = 0, delta = false;
                seen[k] = 1;
                for (i = 0; i < ns.length; i++) ring = ring.concat(neighbors(ns[i].q, ns[i].r, W, H, wrap));
                for (i = 0; i < ring.length; i++) {
                    var rk = ring[i].r * W + ring[i].q;
                    if (seen[rk]) continue;
                    seen[rk] = 1;
                    total++;
                    if (OPEN_WATER[tiles[rk]]) water++;
                    if (rivers[ring[i].q + ',' + ring[i].r]) delta = true;
                }
                var score = sandy
                    + (fbm(q, r, seed + 211, 9 / W, 3, W) - 0.5) * 1.6
                    + (0.5 - water / Math.max(1, total)) * 0.9
                    + (delta || rivers[q + ',' + r] ? 0.3 : 0);
                if (score > 0.3) out[k] = 'beach';
            }
        }
        return out;
    }

    // ── seeded noise ────────────────────────────────────────
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hash2(x, y, s) {
        var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    // Value noise that tiles every `period` cells along x.
    function valueNoise(x, y, s, period) {
        var ix = Math.floor(x), iy = Math.floor(y);
        var fx = smoothstep(x - ix), fy = smoothstep(y - iy);
        var x0 = period ? wrapQ(ix, period) : ix, x1 = period ? wrapQ(ix + 1, period) : ix + 1;
        var a = hash2(x0, iy, s), b = hash2(x1, iy, s);
        var c = hash2(x0, iy + 1, s), d = hash2(x1, iy + 1, s);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    // Fractal noise, seamless east-west across a map `W` wide.
    function fbm(q, r, s, freq, octaves, W) {
        var sum = 0, amp = 1, norm = 0;
        for (var o = 0; o < octaves; o++) {
            var cells = Math.max(1, Math.round(W * freq));
            var f = cells / W;
            sum += valueNoise(q * f, r * f, s + o * 7919, cells) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return sum / norm;
    }

    // Threshold below which `frac` of `values` fall.
    function quantile(values, frac) {
        var sorted = Array.prototype.slice.call(values).sort(function (a, b) { return a - b; });
        var i = Math.max(0, Math.min(sorted.length - 1, Math.floor(frac * sorted.length)));
        return sorted[i];
    }

    // ── the generator ───────────────────────────────────────
    var STYLES = {
        continents: { label: 'Continents', freq: 2.2 },
        pangaea: { label: 'Pangaea', freq: 2.0 },
        archipelago: { label: 'Archipelago', freq: 5.5 },
        islands: { label: 'Scattered isles', freq: 3.5 },
        highlands: { label: 'Highlands', freq: 2.6 },
    };

    // ── plate tectonics (continents and pangaea) ────────────
    // Everything here works in map-relative units (the map is 1 tall and
    // `A` wide, wrapping east-west), so a small preview grows the same world.
    var MICROPLATES = 110;

    /**
     * Build an elevation field from moving plates. The crust is cut into
     * irregular fragments (warped Voronoi cells); fragments join into a dozen
     * tectonic plates, each drifting its own way, and separately into
     * `count` continents of varied size, kept apart by open sea. Where plates
     * meet: collisions raise ranges inside a continent, ocean crust diving
     * under a continent raises a coastal range over a trench, two oceans
     * meeting raise an island arc, and spreading plates open rifts and
     * mid-ocean ridges. Hotspots add lone volcanic isles. Returns
     * { elev, owner } — owner is the continent each hex belongs to (or lies
     * off the coast of).
     */
    function tectonics(W, H, seed, rand, count, landFrac) {
        var A = W / (H * 0.866), M = MICROPLATES, i, j, k;
        var sx = new Float64Array(M), sy = new Float64Array(M);
        for (i = 0; i < M; i++) { sx[i] = rand() * A; sy[i] = 0.01 + rand() * 0.98; }
        var wrapD = function (d) { d = d % A; if (d > A / 2) d -= A; else if (d < -A / 2) d += A; return d; };
        // Warp the crust so fragment edges wander instead of running straight
        var warped = function (u, v, out) {
            // A broad warp bends the fragments; finer ones fray their edges
            // into capes and bays so no straight cell edge survives
            out[0] = u * A + (fbm(u * W, v * H, seed + 101, 2.2 / W, 3, W) - 0.5) * 0.3
                + (fbm(u * W, v * H, seed + 131, 6 / W, 3, W) - 0.5) * 0.16
                + (fbm(u * W, v * H, seed + 151, 16 / W, 2, W) - 0.5) * 0.05;
            out[1] = v + (fbm(u * W, v * H, seed + 113, 2.2 / W, 3, W) - 0.5) * 0.3
                + (fbm(u * W, v * H, seed + 137, 6 / W, 3, W) - 0.5) * 0.16
                + (fbm(u * W, v * H, seed + 157, 16 / W, 2, W) - 0.5) * 0.05;
        };
        var nearest = function (px, py) {
            var best = 0, bd = Infinity;
            for (var s = 0; s < M; s++) {
                var dx = wrapD(px - sx[s]), dy = py - sy[s], d = dx * dx + dy * dy;
                if (d < bd) { bd = d; best = s; }
            }
            return best;
        };

        // Fragment areas and neighbours, from a fixed sampling grid
        var GW = 160, GH = Math.max(40, Math.round(GW / A)), pt = [0, 0];
        var grid = new Int16Array(GW * GH), area = new Float64Array(M);
        for (j = 0; j < GH; j++) {
            for (i = 0; i < GW; i++) {
                warped((i + 0.5) / GW, (j + 0.5) / GH, pt);
                k = nearest(pt[0], pt[1]);
                grid[j * GW + i] = k;
                area[k]++;
            }
        }
        var adj = [];
        for (i = 0; i < M; i++) adj.push({});
        for (j = 0; j < GH; j++) {
            for (i = 0; i < GW; i++) {
                var a = grid[j * GW + i], b = grid[j * GW + (i + 1) % GW];
                if (a !== b) { adj[a][b] = 1; adj[b][a] = 1; }
                if (j + 1 < GH) {
                    b = grid[(j + 1) * GW + i];
                    if (a !== b) { adj[a][b] = 1; adj[b][a] = 1; }
                }
            }
        }
        var adjList = adj.map(function (o) { return Object.keys(o).map(Number).sort(function (x, y) { return x - y; }); });
        var totalArea = GW * GH;

        // Tectonic plates: fragments grown together from random seeds
        var P = Math.min(M, Math.max(count + 4, 9 + Math.floor(rand() * 5)));
        var plate = new Int16Array(M).fill(-1), frontier = [];
        for (var p = 0; p < P; p++) {
            var s0;
            do { s0 = Math.floor(rand() * M); } while (plate[s0] >= 0);
            plate[s0] = p;
            frontier.push(s0);
        }
        while (frontier.length) {
            var fi = Math.floor(rand() * frontier.length), f = frontier[fi];
            var open = adjList[f].filter(function (x) { return plate[x] < 0; });
            if (!open.length) { frontier[fi] = frontier[frontier.length - 1]; frontier.pop(); continue; }
            var nx = open[Math.floor(rand() * open.length)];
            plate[nx] = plate[f];
            frontier.push(nx);
        }
        for (i = 0; i < M; i++) if (plate[i] < 0) plate[i] = 0;
        var vx = [], vy = [];
        for (p = 0; p < P; p++) {
            var ang = rand() * Math.PI * 2, spd = 0.35 + rand() * 0.65;
            vx.push(Math.cos(ang) * spd); vy.push(Math.sin(ang) * spd);
        }

        // Continents: fragments accreted around spread-out cores. A fragment
        // never joins one continent while touching another, so a sea always
        // parts them. Sizes vary widely, like Earth's.
        var cont = new Int16Array(M).fill(-1);
        var polar = function (s) { return sy[s] < 0.18 || sy[s] > 0.82; };
        var touchesOther = function (s, c) {
            for (var t = 0; t < adjList[s].length; t++) {
                var o = cont[adjList[s][t]];
                if (o >= 0 && o !== c) return true;
            }
            return false;
        };
        var cores = [];
        for (var c = 0; c < count; c++) {
            var best = -1, bestGap = -1;
            // A few random tries, then every fragment, so a crowded map still
            // finds a spot for each continent
            for (var tries = 0; tries < 24 + M; tries++) {
                if (tries === 24 && best >= 0) break;
                var cand = tries < 24 ? Math.floor(rand() * M) : tries - 24;
                if (cont[cand] >= 0 || polar(cand) || touchesOther(cand, c)) continue;
                if (tries < 24 && (sy[cand] < 0.27 || sy[cand] > 0.73)) continue;
                var gap = Infinity;
                for (var ci = 0; ci < cores.length; ci++) {
                    var gx = wrapD(sx[cand] - sx[cores[ci]]), gy = sy[cand] - sy[cores[ci]];
                    gap = Math.min(gap, gx * gx + gy * gy);
                }
                if (gap > bestGap) { bestGap = gap; best = cand; }
            }
            if (best < 0) break;
            cont[best] = c;
            cores.push(best);
        }
        var nCont = cores.length;
        var weights = [], wsum = 0;
        for (c = 0; c < nCont; c++) { var wgt = 0.25 + Math.pow(rand(), 1.6) * 1.5; weights.push(wgt); wsum += wgt; }
        var landTarget = landFrac * 0.9 * totalArea;
        var have = [], target = [], active = [], landSoFar = 0;
        for (c = 0; c < nCont; c++) {
            have.push(area[cores[c]]);
            target.push(landTarget * weights[c] / wsum);
            active.push(true);
            landSoFar += area[cores[c]];
        }
        while (landSoFar < landTarget) {
            // The continent furthest short of its size grows next
            var pick = -1, need = 0;
            for (c = 0; c < nCont; c++) {
                if (!active[c]) continue;
                var short = (target[c] - have[c]) / target[c];
                if (pick < 0 || short > need) { pick = c; need = short; }
            }
            if (pick < 0) break;
            // Prefer fragments that keep open sea to the other continents; a
            // boxed-in continent may push up to a neighbour (a strait parts them)
            var cands = [];
            for (var lax = 0; lax < 2 && !cands.length; lax++) {
                for (i = 0; i < M; i++) {
                    if (cont[i] !== pick) continue;
                    for (j = 0; j < adjList[i].length; j++) {
                        var nb = adjList[i][j];
                        if (cont[nb] < 0 && !polar(nb) && (lax || !touchesOther(nb, pick)) && cands.indexOf(nb) < 0) cands.push(nb);
                    }
                }
            }
            if (!cands.length) {
                active[pick] = false;
                if (active.indexOf(true) < 0) break;
                continue;
            }
            var add = cands[Math.floor(rand() * cands.length)];
            cont[add] = pick;
            have[pick] += area[add];
            landSoFar += area[add];
            if (have[pick] >= target[pick] * 1.15) active[pick] = false;
        }

        // No continent ends up a mere islet: a runt takes free fragments
        // next to it, or else a border fragment off a large neighbour
        var floor = landTarget / Math.max(1, nCont) * 0.55;
        for (c = 0; c < nCont; c++) {
            for (var guard = 0; have[c] < floor && guard < M; guard++) {
                var free = -1, steal = -1;
                for (i = 0; i < M && free < 0; i++) {
                    if (cont[i] !== c) continue;
                    for (j = 0; j < adjList[i].length; j++) {
                        var x = adjList[i][j], o = cont[x];
                        if (o < 0 && !polar(x)) { free = x; break; }
                        if (steal < 0 && o >= 0 && o !== c && cores.indexOf(x) < 0 && have[o] - area[x] >= floor * 1.5) steal = x;
                    }
                }
                var take = free >= 0 ? free : steal;
                if (take < 0) break;
                if (cont[take] >= 0) have[cont[take]] -= area[take];
                cont[take] = c;
                have[c] += area[take];
            }
        }

        // Hotspots: lone volcanoes rising from the sea floor
        var spots = [], nSpots = 2 + Math.floor(rand() * 3);
        for (i = 0; i < nSpots; i++) spots.push([rand() * A, 0.15 + rand() * 0.7]);

        var n = W * H, elev = new Float32Array(n), owner = new Int16Array(n);
        var toCont = new Float64Array(Math.max(1, nCont));
        for (var r = 0; r < H; r++) {
            for (var q = 0; q < W; q++) {
                k = r * W + q;
                var u = (q + (r % 2 === 0 ? 0.5 : 0)) / W, v = (r + 0.5) / H;
                warped(u, v, pt);
                var px = pt[0], py = pt[1];
                var own = nearest(px, py), myPlate = plate[own], myCont = cont[own];
                var dax = wrapD(px - sx[own]), day = py - sy[own], da2 = dax * dax + day * day;
                // Distance to the nearest plate edge and to the nearest edge of
                // the continental crust (bisectors of this fragment and others)
                var dPlate = Infinity, partner = -1, dEdge = Infinity;
                toCont.fill(Infinity);
                if (myCont >= 0) toCont[myCont] = 0;
                for (var s = 0; s < M; s++) {
                    if (s === own) continue;
                    var dbx = wrapD(px - sx[s]), dby = py - sy[s];
                    var abx = dbx - dax, aby = dby - day, ab = Math.sqrt(abx * abx + aby * aby) || 1e-6;
                    var bis = (dbx * dbx + dby * dby - da2) / (2 * ab);
                    if (plate[s] !== myPlate && bis < dPlate) { dPlate = bis; partner = s; }
                    if ((cont[s] >= 0) !== (myCont >= 0) && bis < dEdge) dEdge = bis;
                    if (cont[s] >= 0 && bis < toCont[cont[s]]) toCont[cont[s]] = bis;
                }
                // Nearest and runner-up continent: the hex belongs to the
                // nearest, and where both are about as near a strait opens
                var c1 = 0, d1 = Infinity, d2 = Infinity;
                for (c = 0; c < nCont; c++) {
                    if (toCont[c] < d1) { d2 = d1; d1 = toCont[c]; c1 = c; } else if (toCont[c] < d2) d2 = toCont[c];
                }
                owner[k] = c1;
                var signed = myCont >= 0 ? dEdge : -dEdge;

                var coastNoise = fbm(q, r, seed + 5, 3.5 / W, 5, W);
                var ridge = 1 - Math.abs(fbm(q, r, seed + 31, 4.5 / W, 4, W) * 2 - 1);
                // A gentle shelf lets the noise carve capes, bays and offshore isles
                var e = 0.5 + 0.32 * Math.tanh(signed / 0.08) + (coastNoise - 0.5) * 0.8;
                if (myCont >= 0) e += (ridge - 0.5) * 0.08;
                if (d2 - d1 < 0.05) e -= 0.7 * (1 - (d2 - d1) / 0.05);

                if (partner >= 0) {
                    var other = plate[partner];
                    var nxv = wrapD(sx[partner] - sx[own]), nyv = sy[partner] - sy[own];
                    var nl = Math.sqrt(nxv * nxv + nyv * nyv) || 1;
                    // Positive: this plate drives into its neighbour
                    var conv = ((vx[myPlate] - vx[other]) * nxv + (vy[myPlate] - vy[other]) * nyv) / nl;
                    var meCont = myCont >= 0, themCont = cont[partner] >= 0;
                    if (conv > 0) {
                        // Uplift saturates, so every collision front makes a
                        // range rather than the strongest one hogging the peaks
                        var lift = 0;
                        if (meCont && themCont) lift = conv * Math.exp(-dPlate / 0.04);
                        else if (meCont) lift = conv * 0.8 * Math.exp(-dPlate / 0.03);
                        if (lift > 0) e += 0.42 * Math.tanh(lift * 2.4) * (0.45 + ridge * 0.75);
                        else if (themCont) e -= conv * 0.15 * Math.exp(-dPlate / 0.03);
                        else if (myPlate < other) {
                            var arc = fbm(q, r, seed + 77, 9 / W, 2, W);
                            e += conv * 0.9 * Math.exp(-dPlate / 0.02) * Math.max(0, arc - 0.45);
                        }
                    } else {
                        var div = -conv;
                        if (meCont && themCont) e -= div * 0.1 * Math.exp(-dPlate / 0.025);
                        else if (!meCont && !themCont) e += div * 0.06 * Math.exp(-dPlate / 0.03);
                    }
                }
                for (i = 0; i < spots.length; i++) {
                    var hx = wrapD(px - spots[i][0]), hy = py - spots[i][1];
                    e += 0.45 * Math.exp(-Math.sqrt(hx * hx + hy * hy) / 0.012);
                }
                var lat = Math.abs(r / (H - 1) - 0.5) * 2;
                elev[k] = e - (lat > 0.72 ? (lat - 0.72) * 7 : 0);
            }
        }
        return { elev: elev, owner: owner };
    }

    /**
     * Make the continent count hold: land where two continents'
     * territories touch drops to sea, and each continent keeps one main body
     * (large stray pieces sink; small isles stay).
     */
    function separateContinents(elev, owner, sea, W, H, count) {
        var n = W * H, k, i, below = sea - 1e-4;
        var cut = [];
        for (k = 0; k < n; k++) {
            if (elev[k] <= sea) continue;
            var ns = neighbors(k % W, (k / W) | 0, W, H, true);
            for (i = 0; i < ns.length; i++) {
                var nk = ns[i].r * W + ns[i].q;
                if (elev[nk] > sea && owner[nk] !== owner[k]) { cut.push(k); break; }
            }
        }
        for (i = 0; i < cut.length; i++) elev[cut[i]] = below;
        var comp = new Int32Array(n).fill(-1), pieces = [];
        for (k = 0; k < n; k++) {
            if (comp[k] >= 0 || elev[k] <= sea) continue;
            var id = pieces.length, stack = [k], cells = [];
            comp[k] = id;
            while (stack.length) {
                var c = stack.pop();
                cells.push(c);
                var nb = neighbors(c % W, (c / W) | 0, W, H, true);
                for (i = 0; i < nb.length; i++) {
                    var j = nb[i].r * W + nb[i].q;
                    if (comp[j] < 0 && elev[j] > sea) { comp[j] = id; stack.push(j); }
                }
            }
            pieces.push({ owner: owner[k], cells: cells });
        }
        var main = {};
        for (i = 0; i < pieces.length; i++) {
            var o = pieces[i].owner;
            if (!main[o] || pieces[i].cells.length > main[o].cells.length) main[o] = pieces[i];
        }
        var avg = 0;
        for (o in main) avg += main[o].cells.length;
        avg /= count;
        for (i = 0; i < pieces.length; i++) {
            var p = pieces[i];
            if (main[p.owner] === p || p.cells.length < Math.max(4, avg * 0.12)) continue;
            for (var ci = 0; ci < p.cells.length; ci++) elev[p.cells[ci]] = below;
        }
    }

    // Hexes of land between each land hex and the sea (wrapping east-west)
    function distanceInland(elev, sea, W, H) {
        var n = W * H, dist = new Int16Array(n).fill(-1), queue = [], k, i;
        for (k = 0; k < n; k++) if (elev[k] <= sea) { dist[k] = 0; queue.push(k); }
        for (var h = 0; h < queue.length; h++) {
            var c = queue[h], ns = neighbors(c % W, (c / W) | 0, W, H, true);
            for (i = 0; i < ns.length; i++) {
                var j = ns[i].r * W + ns[i].q;
                if (dist[j] < 0) { dist[j] = dist[c] + 1; queue.push(j); }
            }
        }
        return dist;
    }

    /**
     * Rainfall nudge for a land hex, after Earth: rising air keeps the
     * equator wet, sinking air dries the belts near 30 degrees (the great
     * deserts), the westerlies water the temperate belt, the heart of a big
     * continent goes dry, and ranges cast rain shadows downwind — trade winds
     * blow from the east in the tropics, westerlies from the west beyond.
     */
    function wetness(q, r, lat, inland, elev, mountLine, W, H) {
        var g = function (x, mid, width) { var t = (x - mid) / width; return Math.exp(-t * t); };
        var m = 0.22 * g(lat, 0, 0.13) - 0.22 * g(lat, 0.33, 0.1) + 0.1 * g(lat, 0.6, 0.12);
        m -= Math.min(0.24, (inland[r * W + q] / H) * 2.4);
        var upwind = lat < 0.33 ? 1 : -1;
        for (var step = 1; step <= 6; step++) {
            var uq = ((q + upwind * step) % W + W) % W;
            if (elev[r * W + uq] >= mountLine) { m -= 0.22 * (1 - (step - 1) / 6); break; }
        }
        return m;
    }

    // Rotate an east-west wrapping field so its emptiest column is q = 0
    function seamToSea(elev, sea, W, H) {
        var best = 0, bestLand = Infinity;
        for (var q = 0; q < W; q++) {
            var land = 0;
            for (var r = 0; r < H; r++) if (elev[r * W + q] > sea) land++;
            if (land < bestLand) { bestLand = land; best = q; }
        }
        if (!best) return elev;
        var out = new Float32Array(W * H);
        for (var r2 = 0; r2 < H; r2++) {
            for (var q2 = 0; q2 < W; q2++) out[r2 * W + q2] = elev[r2 * W + (q2 + best) % W];
        }
        return out;
    }

    /**
     * Generate a world. opts: { width, height, seed, style, land (0..1 of the
     * map), mountains (0..1 of the land), temperature (-1..1), moisture
     * (-1..1), rivers (count), continents (count, for that style; 0 =
     * random), wrap }. Returns { tiles, rivers: {"q,r": true},
     * elevation }.
     */
    function generate(opts) {
        var W = opts.width, H = opts.height;
        var seed = (opts.seed >>> 0) || 1;
        var rand = mulberry32(seed);
        var style = STYLES[opts.style] ? opts.style : 'continents';
        var landFrac = opts.land != null ? opts.land : 0.4;
        var mountainFrac = opts.mountains != null ? opts.mountains : 0.12;
        var tempBias = opts.temperature || 0;
        var moistBias = opts.moisture || 0;
        var base = STYLES[style].freq / W;
        var n = W * H;
        var elev = new Float32Array(n);
        var owner = new Int16Array(n);

        var tectonic = style === 'continents' || style === 'pangaea';
        var count = 1;
        if (tectonic) {
            count = style === 'pangaea' ? 1 : opts.continents > 0 ? Math.min(12, Math.round(opts.continents)) : 3 + Math.floor(rand() * 4);
            var crust = tectonics(W, H, seed, rand, count, landFrac);
            elev = crust.elev;
            owner = crust.owner;
        } else {
            // Island seeds for the masked style (wrapping east-west)
            var centres = [];
            var nCentres = style === 'islands' ? 5 + Math.floor(rand() * 6) : 1;
            for (var c = 0; c < nCentres; c++) {
                centres.push({
                    q: rand() * W,
                    r: H * (0.25 + rand() * 0.5),
                    size: style === 'islands' ? 0.10 + rand() * 0.08 : 0.28 + rand() * 0.18,
                });
            }
            for (var r = 0; r < H; r++) {
                for (var q = 0; q < W; q++) {
                    // Domain warp for ragged coasts
                    var wx = (fbm(q, r, seed + 11, base * 1.5, 3, W) - 0.5) * W * 0.12;
                    var wy = (fbm(q, r, seed + 23, base * 1.5, 3, W) - 0.5) * H * 0.12;
                    var e = fbm(q, r, seed, base, 5, W);
                    var ridge = 1 - Math.abs(fbm(q, r, seed + 31, base * 2, 4, W) * 2 - 1);
                    var mask = 0;
                    if (style === 'islands') {
                        for (var ci = 0; ci < centres.length; ci++) {
                            var ct = centres[ci];
                            var dq = Math.abs(q + wx - ct.q);
                            dq = Math.min(dq, W - dq) / W;
                            var dr = (r + wy - ct.r) / H;
                            var dd = Math.sqrt(dq * dq * 1.6 + dr * dr * 2.2) / ct.size;
                            mask = Math.max(mask, 1 - smoothstep(Math.min(1, dd)));
                        }
                    }
                    // Poles: a touch of extra sea so the map doesn't end in a wall
                    var lat = Math.abs(r / (H - 1) - 0.5) * 2;
                    var pole = lat > 0.86 ? (lat - 0.86) * 1.6 : 0;
                    var v;
                    if (style === 'highlands') v = e * 0.55 + ridge * 0.45;
                    else if (style === 'archipelago') v = e * 0.75 + ridge * 0.25;
                    else v = e * 0.45 + mask * 0.45 + ridge * 0.1;
                    elev[r * W + q] = v - pole;
                }
            }
        }

        var sea = quantile(elev, 1 - landFrac);
        if (tectonic) separateContinents(elev, owner, sea, W, H, count);
        // Turn the globe so the map edge runs through open sea, not a continent
        if (tectonic) elev = seamToSea(elev, sea, W, H);
        var landVals = [];
        for (var k = 0; k < n; k++) if (elev[k] > sea) landVals.push(elev[k]);
        var hillLine = landVals.length ? quantile(landVals, 1 - mountainFrac * 2.2) : 1;
        var mountLine = landVals.length ? quantile(landVals, 1 - mountainFrac) : 1;
        // Collision plateaus are broad: keep their impassable peaks to the crests
        var peakLine = landVals.length ? quantile(landVals, 1 - mountainFrac * (tectonic ? 0.1 : 0.25)) : 1;

        // Plate worlds get an Earth-like water cycle (see wetness below)
        var inland = tectonic ? distanceInland(elev, sea, W, H) : null;

        var tiles = new Array(n);
        var rivers = {};
        for (r = 0; r < H; r++) {
            for (q = 0; q < W; q++) {
                k = r * W + q;
                var ev = elev[k];
                lat = Math.abs(r / (H - 1) - 0.5) * 2;
                var heat = 1 - lat * 1.1 + (fbm(q, r, seed + 41, base * 1.2, 2, W) - 0.5) * 0.35 + tempBias * 0.35;
                var moist = fbm(q, r, seed + 53, base * 1.6, 4, W) + moistBias * 0.3;
                if (inland && ev > sea) moist += wetness(q, r, lat, inland, elev, mountLine, W, H);
                if (ev <= sea) { tiles[k] = lat > 0.93 && heat < 0.1 ? 'ice' : 'ocean'; continue; }
                var alt = (ev - sea) / Math.max(1e-6, 1 - sea);
                // Plate crust sits high overall; don't let that alone read as cold
                heat -= alt * (tectonic ? 0.2 : 0.35);
                var t;
                if (ev >= peakLine) t = 'snow_peak';
                else if (ev >= mountLine) t = 'mountain';
                else if (ev >= hillLine) t = heat < 0.15 ? 'tundra' : moist > 0.62 ? 'highlands' : 'hills';
                else if (heat < 0.12) t = 'snow';
                else if (heat < 0.28) t = moist > 0.5 ? 'boreal_forest' : 'tundra';
                else if (heat < 0.62) {
                    if (moist < 0.36) t = 'plains';
                    else if (moist < 0.5) t = 'grassland';
                    else if (moist < 0.6) t = 'woodland';
                    else if (moist < 0.7) t = 'seasonal_forest';
                    else t = 'temperate_rainforest';
                } else {
                    if (moist < 0.34) t = 'desert';
                    else if (moist < 0.46) t = 'savanna';
                    else if (moist < 0.6) t = 'grassland';
                    else if (moist < 0.68) t = 'woodland';
                    else t = 'tropical_rainforest';
                }
                if (t !== 'snow_peak' && t !== 'mountain' && moist > 0.74 && alt < 0.12 && heat > 0.3) t = 'swamp';
                tiles[k] = t;
            }
        }

        tiles = shapeCoast(tiles, W, H, { deep: 4, wrap: true });

        // Rivers: from the high ground, steepest descent to the sea
        var riverCount = opts.rivers != null ? opts.rivers : Math.round(Math.sqrt(n) / 4);
        var sources = [];
        for (k = 0; k < n; k++) {
            var tt = tiles[k];
            if ((tt === 'mountain' || tt === 'hills' || tt === 'highlands') && rand() < 0.5) sources.push(k);
        }
        for (var s = sources.length - 1; s > 0; s--) {
            var j = Math.floor(rand() * (s + 1));
            var tmp = sources[s]; sources[s] = sources[j]; sources[j] = tmp;
        }
        var made = 0;
        for (var si = 0; si < sources.length && made < riverCount; si++) {
            var path = traceRiver(sources[si], tiles, elev, W, H, rivers);
            if (!path) continue;
            for (var pi = 0; pi < path.length; pi++) rivers[(path[pi] % W) + ',' + ((path[pi] / W) | 0)] = true;
            made++;
        }

        // Sand last, so river mouths can feed it
        if (opts.beaches) tiles = placeBeaches(tiles, W, H, { seed: seed, rivers: rivers, wrap: true });

        return { tiles: tiles, rivers: rivers, elevation: elev };
    }

    // Follow the land downhill from `start` until it meets water or another
    // river. Returns the hex indices (land only) or null for a dead end.
    function traceRiver(start, tiles, elev, W, H, rivers) {
        var path = [start];
        var seen = {};
        seen[start] = 1;
        var cur = start;
        for (var step = 0; step < W + H; step++) {
            var q = cur % W, r = (cur / W) | 0;
            var ns = neighbors(q, r, W, H, true);
            var best = -1, bestE = Infinity;
            for (var i = 0; i < ns.length; i++) {
                var nk = ns[i].r * W + ns[i].q;
                if (isWater(tiles[nk])) return path.length >= 3 ? path : null;
                if (rivers[ns[i].q + ',' + ns[i].r] && path.length >= 3) return path;
                if (seen[nk] || tiles[nk] === 'snow_peak') continue;
                if (elev[nk] < bestE) { bestE = elev[nk]; best = nk; }
            }
            if (best < 0) return null;
            // Let it run a little uphill out of a hollow, but not forever
            if (bestE > elev[cur] + 0.02) return null;
            seen[best] = 1;
            path.push(best);
            cur = best;
        }
        return null;
    }

    // ── the map check ───────────────────────────────────────
    var SETTLEMENT_TYPES = { village: 1, town: 1, city: 1, capital: 1, outpost: 1, port: 1 };

    /**
     * Problems a map would have in play. `data` is the editor's export shape.
     * Returns [{ level: 'error'|'warn'|'info', msg, q?, r? }].
     */
    function validate(data) {
        var W = data.width, H = data.height, tiles = data.tiles;
        var out = [];
        var at = function (q, r) { return tiles[r * W + q]; };
        var parse = function (key) { var p = String(key).split(','); return { q: +p[0], r: +p[1] }; };
        var land = 0;
        for (var k = 0; k < tiles.length; k++) if (isPassable(tiles[k])) land++;
        if (land === 0) out.push({ level: 'error', msg: 'There is no walkable land — nowhere to stand.' });
        else if (land / tiles.length < 0.08) out.push({ level: 'warn', msg: 'Very little land (' + Math.round(land / tiles.length * 100) + '%): realms will crowd together.' });

        var ov = data.overlays || {};
        var towns = 0;
        for (var key in ov) {
            var p = parse(key), o = ov[key], t = at(p.q, p.r);
            if (SETTLEMENT_TYPES[o.type]) {
                towns++;
                if (!isPassable(t)) out.push({ level: 'error', msg: (o.name || o.type) + ' stands on ' + t + ' — it will be dropped.', q: p.q, r: p.r });
            } else if (o.type === 'shipwreck') {
                if (!isWater(t) && t !== 'beach') out.push({ level: 'warn', msg: 'A shipwreck far from any water.', q: p.q, r: p.r });
            } else if (!isPassable(t)) {
                out.push({ level: 'error', msg: (o.name || o.type) + ' is on ' + t + ' — it will be dropped.', q: p.q, r: p.r });
            }
        }
        for (key in data.roadOverlays || {}) {
            p = parse(key);
            if (!isPassable(at(p.q, p.r))) { out.push({ level: 'warn', msg: 'Road over impassable ground (' + at(p.q, p.r) + ').', q: p.q, r: p.r }); break; }
        }
        for (key in data.rivers || {}) {
            p = parse(key);
            if (!isPassable(at(p.q, p.r))) { out.push({ level: 'warn', msg: 'River painted on ' + at(p.q, p.r) + ' — it will be ignored there.', q: p.q, r: p.r }); break; }
        }

        var realms = data.realms || [];
        var claimed = {};
        for (key in data.territory || {}) claimed[data.territory[key]] = (claimed[data.territory[key]] || 0) + 1;
        var capitals = {};
        for (var i = 0; i < realms.length; i++) {
            var rm = realms[i];
            if (!rm.capital) {
                // An unseated realm with no lands is just waiting on the bench
                if (claimed[rm.id]) out.push({ level: 'error', msg: rm.name + ' has lands but no capital — it will not appear.' });
                continue;
            }
            var ck = rm.capital.q + ',' + rm.capital.r;
            if (capitals[ck]) out.push({ level: 'error', msg: rm.name + ' shares a capital with ' + capitals[ck] + '.', q: rm.capital.q, r: rm.capital.r });
            capitals[ck] = rm.name;
            if (!isPassable(at(rm.capital.q, rm.capital.r))) out.push({ level: 'warn', msg: rm.name + "'s capital is on " + at(rm.capital.q, rm.capital.r) + ' — it moves to the nearest land.', q: rm.capital.q, r: rm.capital.r });
            if (data.territory && claimed[rm.id] && data.territory[ck] !== rm.id) out.push({ level: 'warn', msg: rm.name + "'s capital lies outside its painted lands.", q: rm.capital.q, r: rm.capital.r });
        }
        var placedRealms = realms.filter(function (x) { return x.capital; }).length;
        if (!placedRealms) out.push({ level: 'info', msg: 'No realms placed: the game seats ' + ((data.rules && data.rules.kingdomCount) || 6) + ' at random.' });

        var st = data.playerStart;
        if (st && !isPassable(at(st.q, st.r))) out.push({ level: 'warn', msg: 'The player start is on ' + at(st.q, st.r) + ' — it moves to the nearest land.', q: st.q, r: st.r });
        if (!st) out.push({ level: 'info', msg: 'No player start: the player begins by the first free village.' });
        if (!towns && !placedRealms) out.push({ level: 'info', msg: 'No towns placed: the game scatters its own.' });
        return out;
    }

    // ── compact terrain snapshots (undo, autosave) ─────────────
    function encode(tiles, order) {
        var idx = {};
        for (var i = 0; i < order.length; i++) idx[order[i]] = i;
        var out = new Uint8Array(tiles.length);
        for (var k = 0; k < tiles.length; k++) out[k] = idx[tiles[k]] != null ? idx[tiles[k]] : 0;
        return out;
    }
    function decode(codes, order) {
        var out = new Array(codes.length);
        for (var k = 0; k < codes.length; k++) out[k] = order[codes[k]];
        return out;
    }
    // Run-length string for storage: "ocean*40,grassland*3,…"
    function rle(tiles) {
        var parts = [];
        for (var k = 0; k < tiles.length;) {
            var j = k;
            while (j < tiles.length && tiles[j] === tiles[k]) j++;
            parts.push(j - k > 1 ? tiles[k] + '*' + (j - k) : tiles[k]);
            k = j;
        }
        return parts.join(',');
    }
    function unrle(s) {
        var out = [];
        if (!s) return out;
        var parts = s.split(',');
        for (var i = 0; i < parts.length; i++) {
            var m = parts[i].split('*');
            var n = m[1] ? parseInt(m[1], 10) : 1;
            for (var j = 0; j < n; j++) out.push(m[0]);
        }
        return out;
    }

    var api = {
        WATER: WATER, RUNG: RUNG, STYLES: STYLES, placeBeaches: placeBeaches,
        isWater: isWater, isLand: isLand, isPassable: isPassable, stepTerrain: stepTerrain,
        wrapQ: wrapQ, neighbors: neighbors, distance: distance, line: line, disc: disc, rect: rect,
        floodRegion: floodRegion, symmetry: symmetry, connectionMask: connectionMask,
        smooth: smooth, shapeCoast: shapeCoast, distanceToLand: distanceToLand,
        mulberry32: mulberry32, fbm: fbm, generate: generate, traceRiver: traceRiver,
        validate: validate, encode: encode, decode: decode, rle: rle, unrle: unrle,
    };
    g.WorldTools = api;
    if (typeof window !== 'undefined') window.WorldTools = api;
})();
