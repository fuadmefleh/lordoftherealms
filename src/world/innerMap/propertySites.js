// ============================================
// InnerMap — the player's properties out in the country, where their trade puts them
// ============================================
// A property on a hex with no town (a mill, a farm, a logging camp…) stands on
// the hex's own map as a tile-composed building of its kind (data/buildingKit.json
// designs), on ground found from the map itself (data/lots.json wildSites):
//
//   • water    — a mill on the riverbank: a gable wall against the stream, a race
//                along its foot and the wheel turning in it (mills.js _millSpot /
//                _raiseMill; ui/innerMapLayers/ambient.js turns the wheel). With no
//                river, lake or sea it is built as its `dry` site says:
//   • windmill — a mill on open, high ground well back from any water: its sails
//                turn on the roof (ambient.js, a mill with no water at its walls);
//   • shore    — against the water's edge, its door on the land side;
//   • forest   — in a clearing at the woods' edge (the scatter grows the trees
//                after, round the clearing kept for it);
//   • rock     — against a crag's rock face (laid after the crags), else on the
//                stoniest ground;
//   • field / orchard / paddock — beside its fenced field, orchard or paddock;
//   • road     — by the road, else near where the traveller comes in.
//
// Several properties on one hex each take their own spot, never on each other,
// a road, the water or another building, and none near the middle (where you
// arrive) or the map's edges. Hash-placed (the hex and the property's type):
// it draws nothing from the map's rng, and a hex's properties stand in the same
// places every visit and after a save. The anchor tile carries _propertyRef;
// property.innerQ / innerR is the anchor. A property no design fits falls back
// to the old whole sprite (buildings.js _placePlayerProperties).

import { InnerMap } from './_ref.js';
import { CustomBuildings, CustomObjects, TownProps, Utils } from './_imports.js';
import { LotBook } from '../lotBook.js';

function _strHash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}

function _rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const EDGE = 3;     // clear of the map's sides (where you cross to the next hex)
const KEEP = 5;     // clear of the middle, where you come in
const CAP = 40;     // how far the distance fields reach

/** Which sites are looked for first: the pickiest ground before the plainest */
const ORDER = { water: 0, shore: 1, rock: 2, field: 3, orchard: 3, paddock: 3, forest: 4, windmill: 5, road: 6 };

/** Water a wheel can turn in or a wharf can stand on: a river, a lake or the sea, not a pond or a crossing */
const _isWater = t => !!(t && t._wet && t._waterKind !== 'pond' && !t._bridge && !t._ford && !t._pier && !t._deck);

/** Something already stands or lies here */
const _taken = t => !t || !!(t.building || t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart
    || t.isRoad || t._lot || t._plaza || t._grave || t._pier || t._deck || t._propSite || t._cragTop !== undefined
    || (t.subTerrain && t.subTerrain.id === 'cliff') || t._adit || t._shaft || t._caveMouthOf);

/** Open dry ground a building may stand on */
const _ground = t => !!t && !_taken(t) && !t._wet && !t._sea && !(t.subTerrain && t.subTerrain.passable === false);

const _woods = t => !!(t && t.subTerrain && (t.subTerrain.id === 'trees' || t.subTerrain.id === 'brush'));
const _stony = t => !!(t && t.subTerrain && (t.subTerrain.id === 'rocks' || t.subTerrain.id === 'cliff'));
const _boggy = t => !!(t && t.subTerrain && (t.subTerrain.id === 'bog' || t.subTerrain.id === 'mud'));

/** A summed-area table of a mask: sum(q0, r0, q1, r1) over the inclusive box (clipped to the map) */
function _sat(tiles, f) {
    const H = tiles.length, W = tiles[0].length, S = W + 1;
    const s = new Int32Array(S * (H + 1));
    for (let r = 0; r < H; r++) {
        let row = 0;
        for (let q = 0; q < W; q++) {
            row += f(tiles[r][q]) ? 1 : 0;
            s[(r + 1) * S + q + 1] = s[r * S + q + 1] + row;
        }
    }
    return (q0, r0, q1, r1) => {
        q0 = Math.max(0, q0); r0 = Math.max(0, r0); q1 = Math.min(W - 1, q1); r1 = Math.min(H - 1, r1);
        if (q1 < q0 || r1 < r0) return 0;
        return s[(r1 + 1) * S + q1 + 1] - s[r0 * S + q1 + 1] - s[(r1 + 1) * S + q0] + s[r0 * S + q0];
    };
}

/** How far each cell is (8-way steps, capped) from the cells `src` picks; null when it picks none */
function _distField(tiles, src) {
    const H = tiles.length, W = tiles[0].length;
    const d = new Int16Array(W * H).fill(CAP);
    let front = [];
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (src(tiles[r][q])) { d[r * W + q] = 0; front.push(r * W + q); }
    if (!front.length) return null;
    for (let k = 1; k < CAP && front.length; k++) {
        const next = [];
        for (const i of front) {
            const q = i % W, r = (i - q) / W;
            for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
                const x = q + dq, y = r + dr;
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                const j = y * W + x;
                if (d[j] > k) { d[j] = k; next.push(j); }
            }
        }
        front = next;
    }
    return (q, r) => (q >= 0 && r >= 0 && q < W && r < H ? d[r * W + q] : CAP);
}

/** The box a design covers with its anchor at (q, r) */
function _box(def, q, r) {
    const b = def.bounds;
    return { q0: q + b.minCol, q1: q + b.maxCol, r0: r + b.minRow, r1: r + b.maxRow };
}

/** The least of f over the ring of cells one out from a box */
function _ringMin(box, f) {
    let m = Infinity;
    for (let q = box.q0 - 1; q <= box.q1 + 1; q++) { m = Math.min(m, f(q, box.r0 - 1), f(q, box.r1 + 1)); }
    for (let r = box.r0; r <= box.r1; r++) { m = Math.min(m, f(box.q0 - 1, r), f(box.q1 + 1, r)); }
    return m;
}

Object.assign(InnerMap, {
    /**
     * Stand this hex's properties (see the head of this file). phase 'land' stands
     * every one but those at a rock face, 'rock' those (after the crags are laid),
     * 'all' both. A property already standing on these tiles is left as it is.
     * @returns {Array} the properties no design fitted (for the old sprite)
     */
    _sitePlayerProperties(tiles, worldTile, worldQ, worldR, opts = {}) {
        if (!tiles || !tiles.length || !worldTile || worldTile.settlement) return [];
        const props = [...(worldTile.playerProperties || [])].filter(Boolean);
        if (worldTile.playerProperty && !props.includes(worldTile.playerProperty)) props.push(worldTile.playerProperty);
        if (!props.length) return [];
        if (typeof CustomBuildings === 'undefined' || !CustomBuildings.isLoaded || !CustomBuildings.isLoaded()) return opts.phase === 'land' ? [] : props;
        const phase = opts.phase || 'all';
        const standing = new Set();
        for (const row of tiles) for (const t of row) if (t && t._propertyRef) standing.add(t._propertyRef);
        // (each property of a type counted, so a second farm is hashed apart from the first)
        const nth = {};
        const list = props.map((p, i) => {
            const k = String(p.type || '').toLowerCase();
            nth[k] = (nth[k] || 0) + 1;
            return { p, i, n: nth[k], cfg: LotBook.wildSite(k) };
        }).filter(x => !standing.has(x.p))
            .filter(x => phase === 'all' || (phase === 'rock') === (x.cfg.site === 'rock'))
            .sort((a, b) => ((ORDER[a.cfg.site] ?? 9) - (ORDER[b.cfg.site] ?? 9)) || a.i - b.i);
        const left = [];
        for (const x of list) {
            const seed = _strHash(`${worldQ},${worldR}|${String(x.p.type || '').toLowerCase()}|${x.n}`);
            const at = this._siteProperty(tiles, x.p, x.cfg, seed, worldQ, worldR, opts.riverPath || tiles._riverPath || null);
            if (!at) { left.push(x.p); continue; }
            const t = tiles[at.r][at.q];
            t._buildingTypeHint = 'player_property';
            t._propertyRef = x.p;
            x.p.innerQ = at.q;
            x.p.innerR = at.r;
        }
        return left;
    },

    /** The designs a property may be built as, kind by kind (best first), each kind's turned by the seed */
    _propertyDefs(kinds, seed) {
        const usable = d => d && d.meta && d.bounds && d.bounds.maxRow <= 0 && (d.meta || []).some(m => m.door);
        const out = [];
        for (const kind of kinds || []) {
            const pool = kind === 'farmstead'
                ? (CustomBuildings.getByType('house') || []).filter(d => d.style === 'farmstead')
                : (CustomBuildings.getByType(kind) || []).filter(d => d.style !== 'farmstead' || kind !== 'house');
            const defs = pool.filter(usable);
            if (!defs.length) continue;
            // (a few of the kind, so the search stays quick)
            out.push(defs.map((_, i) => defs[(seed + i) % defs.length]).slice(0, 4));
        }
        return out;
    },

    /** Stand one property; → its anchor { q, r }, or null */
    _siteProperty(tiles, prop, cfg, seed, worldQ, worldR, riverPath) {
        const H = tiles.length, W = tiles[0].length;
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const inKeep = (q, r) => Math.abs(q - cq) <= KEEP && Math.abs(r - cr) <= KEEP;
        const nearEdge = (q, r) => q < EDGE || r < EDGE || q > W - 1 - EDGE || r > H - 1 - EDGE;
        let site = cfg.site;
        let kinds = cfg.kinds;
        // ── A water mill on the bank, its wheel in the stream ──
        if (site === 'water') {
            const keepOut = (q, r) => inKeep(q, r) || nearEdge(q, r) || !!(tiles[r] && tiles[r][q] && tiles[r][q]._propSite);
            for (const defs of this._propertyDefs(kinds, seed)) {
                const spot = this._millSpot && this._millSpot(tiles, defs, worldQ ^ seed, worldR, keepOut);
                if (!spot) continue;
                this._raiseMill(tiles, spot, riverPath);
                this._claimSite(tiles, _box(spot.def, spot.q, spot.r), 1, 0);
                this._yardProps(tiles, spot.def, spot.q, spot.r, cfg.props, seed, spot.side);
                return { q: spot.q, r: spot.r };
            }
            site = cfg.dry || 'road';
            kinds = cfg.dryKinds || cfg.kinds;
        }
        const ctx = this._siteFields(tiles, worldQ, worldR, site);
        for (const defs of this._propertyDefs(kinds, seed)) {
            const at = this._bestSpot(tiles, defs, site, cfg, seed, ctx, inKeep, nearEdge);
            if (at) return at;
        }
        return null;
    },

    /** The distance fields and tallies a site's search needs, worked out once per stand */
    _siteFields(tiles, worldQ, worldR, site) {
        const open = _sat(tiles, _ground);
        const busy = _sat(tiles, _taken);
        const wet = _sat(tiles, t => !!(t && t._wet));
        const ctx = { open, busy, wet };
        if (site === 'forest') ctx.woods = _sat(tiles, _woods);
        if (site === 'rock') {
            ctx.face = _distField(tiles, t => !!(t && t.subTerrain && t.subTerrain.id === 'cliff' && !t._cragTop));
            ctx.stone = _sat(tiles, _stony);
        }
        if (site === 'shore' || site === 'windmill') ctx.water = _distField(tiles, _isWater);
        if (site === 'road') ctx.road = _distField(tiles, t => !!(t && t.isRoad && !t._wet));
        if (site === 'windmill') {
            // The lie of the land: the same noise the map's ground was drawn from (terrain.js generate)
            const ox = worldQ * 7.13 + 100, oy = worldR * 7.13 + 200;
            ctx.height = (q, r) => (Utils.fbm(ox + q * 0.45, oy + r * 0.45, 3, 2.0, 0.5) + 1) / 2;
        }
        ctx.bog = _sat(tiles, _boggy);
        return ctx;
    },

    /**
     * The best spot of a site for one of these designs, stood there with its
     * yard (field, orchard, paddock, props). → its anchor { q, r }, or null.
     */
    _bestSpot(tiles, defs, site, cfg, seed, ctx, inKeep, nearEdge) {
        const H = tiles.length, W = tiles[0].length;
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const rng = _rng(seed ^ 0x9e3779b9);
        const cands = [];
        for (const def of defs) {
            const { minCol, maxCol, minRow, maxRow } = def.bounds;
            const door = def.meta.find(m => m.door);
            for (let r = EDGE - minRow; r <= H - 1 - EDGE - maxRow - 2; r++) {
                for (let q = EDGE - minCol; q <= W - 1 - EDGE - maxCol; q++) {
                    const box = { q0: q + minCol, q1: q + maxCol, r0: r + minRow, r1: r + maxRow };
                    // Nowhere near the middle
                    if (box.q1 + 1 >= cq - KEEP && box.q0 - 1 <= cq + KEEP && box.r1 + 3 >= cr - KEEP && box.r0 - 1 <= cr + KEEP) continue;
                    // Its whole footprint on open dry ground
                    const area = (box.q1 - box.q0 + 1) * (box.r1 - box.r0 + 1);
                    if (ctx.open(box.q0, box.r0, box.q1, box.r1) !== area) continue;
                    // Nothing hard against its walls (the water may be, at a wharf)
                    if (ctx.busy(box.q0 - 1, box.r0 - 1, box.q1 + 1, box.r1 + 1) > 0) continue;
                    if (site !== 'shore' && ctx.wet(box.q0 - 1, box.r0 - 1, box.q1 + 1, box.r1 + 1) > 0) continue;
                    // A step out of its door onto dry ground, and another
                    const dq = q + door.q, dr = r + door.r;
                    const s1 = tiles[dr + 1] && tiles[dr + 1][dq], s2 = tiles[dr + 2] && tiles[dr + 2][dq];
                    if (!_ground(s1) || !_ground(s2)) continue;
                    const score = this._siteScore(site, ctx, box, dq, dr, cq, cr);
                    if (score === null) continue;
                    cands.push({ def, q, r, box, score: score + rng() * 0.5 });
                }
            }
        }
        if (!cands.length) return null;
        cands.sort((a, b) => a.score - b.score);
        const yard = site === 'field' || site === 'orchard' || site === 'paddock';
        for (let i = 0; i < cands.length && i < 400; i++) {
            const c = cands[i];
            const plot = yard ? this._plotBeside(tiles, c, site, cfg, seed, inKeep, nearEdge) : null;
            if (yard && !plot) continue;
            this._standBuilding(tiles, c.def, c.q, c.r);
            this._claimSite(tiles, c.box, 1, site === 'forest' ? 1 : 2);
            if (plot) this._layPlot(tiles, plot, site, cfg, seed);
            this._yardProps(tiles, c.def, c.q, c.r, cfg.props, seed, 0);
            return { q: c.q, r: c.r };
        }
        return null;
    },

    /** How good a spot is for its site (lower is better), or null if it won't do */
    _siteScore(site, ctx, box, dq, dr, cq, cr) {
        const cd = Math.hypot(dq - cq, dr - cr);
        const bw = box.q1 - box.q0 + 1, bh = box.r1 - box.r0 + 1;
        const around = (k) => {
            const n = (bw + 2 * k) * (bh + 2 * k) - bw * bh;
            return { n, at: (sat) => sat(box.q0 - k, box.r0 - k, box.q1 + k, box.r1 + k) - sat(box.q0, box.r0, box.q1, box.r1) };
        };
        const bog = ctx.bog(box.q0, box.r0, box.q1, box.r1) * 0.6;
        switch (site) {
            case 'shore': {
                if (!ctx.water) return null;
                const near = _ringMin(box, ctx.water);
                if (near > 2) return null;
                // (the more of its side and back walls the water runs along, the better: a wharf, not a hut inland)
                const hug = ctx.wet(box.q0 - 2, box.r0 - 2, box.q1 + 2, box.r1);
                return (near - 1) * 6 - Math.min(hug, 20) * 0.4 + cd * 0.04 + bog;
            }
            case 'forest': {
                const a = around(5);
                const ring = ctx.woods ? a.at(ctx.woods) / a.n : 0;
                const inside = ctx.woods ? ctx.woods(box.q0, box.r0, box.q1, box.r1) / (bw * bh) : 0;
                return -ring * 12 + inside * 5 + Math.abs(cd - 18) * 0.08 + bog;
            }
            case 'rock': {
                if (ctx.face) {
                    const near = _ringMin(box, ctx.face);
                    if (near > 12) return null;
                    return (near - 1) * 2 + Math.abs(cd - 16) * 0.03 + bog;
                }
                const a = around(5);
                return -(a.at(ctx.stone) / a.n) * 12 + Math.abs(cd - 18) * 0.06 + bog;
            }
            case 'windmill': {
                const wd = ctx.water ? _ringMin(box, ctx.water) : CAP;
                if (wd < 6) return null;
                const a = around(4);
                const open = a.at(ctx.open) / a.n;
                const h = ctx.height ? ctx.height(Math.floor((box.q0 + box.q1) / 2), box.r1) : 0.5;
                return -open * 8 - h * 12 - Math.min(wd, 16) * 0.15 + Math.abs(cd - 14) * 0.05 + bog;
            }
            case 'field': case 'orchard': case 'paddock': {
                const a = around(6);
                return -(a.at(ctx.open) / a.n) * 10 + Math.abs(cd - 16) * 0.06 + bog * 2;
            }
            default: {
                if (ctx.road) {
                    const d = ctx.road(dq, dr + 1);
                    return Math.abs(d - 1) * 2 + cd * 0.02 + bog;
                }
                const a = around(3);
                return Math.abs(cd - 10) * 0.4 - (a.at(ctx.open) / a.n) * 3 + bog;
            }
        }
    },

    /**
     * Room beside a building for its field, orchard or paddock, its fence a ring
     * round it and a clear cell beyond: right of it, left of it, or behind it.
     * → { q0, q1, r0, r1, gate: 'n' | 's' } (the plot, inside its fence), or null.
     */
    _plotBeside(tiles, c, site, cfg, seed, inKeep, nearEdge) {
        const H = tiles.length, W = tiles[0].length;
        const rng = _rng(seed ^ 0x51ed27);
        let fw, fh;
        if (site === 'paddock') { fw = cfg.big ? 10 : 8; fh = cfg.big ? 7 : 5; } else if (site === 'orchard') { fw = 7; fh = 5; } else if (cfg.small) { fw = 4; fh = 3; } else { fw = 6 + Math.floor(rng() * 3); fh = 4 + Math.floor(rng() * 2); }
        const b = c.box;
        const tries = [
            { q0: b.q1 + 3, r1: b.r1, gate: 's' },
            { q0: b.q0 - 2 - fw, r1: b.r1, gate: 's' },
            { q0: Math.floor((b.q0 + b.q1 + 1 - fw) / 2), r1: b.r0 - 3, gate: 's' },
            { q0: b.q1 + 3, r1: b.r1 - 1, gate: 's' },
            { q0: b.q0 - 2 - fw, r1: b.r1 - 1, gate: 's' },
        ];
        const start = Math.floor(rng() * 2);
        const order = [tries[start], tries[1 - start], ...tries.slice(2)];
        for (const t of order) {
            const p = { q0: t.q0, q1: t.q0 + fw - 1, r1: t.r1, r0: t.r1 - fh + 1, gate: t.gate };
            // The fence ring and a clear cell beyond, all open dry ground, clear of the middle and the edges
            let ok = true;
            for (let r = p.r0 - 2; r <= p.r1 + 2 && ok; r++) {
                for (let q = p.q0 - 2; q <= p.q1 + 2; q++) {
                    if (q < 1 || r < 1 || q >= W - 1 || r >= H - 1 || nearEdge(q, r) || inKeep(q, r)) { ok = false; break; }
                    const tile = tiles[r][q];
                    // (the building's own walls may stand in the clear cell beyond the fence, not in the ring)
                    const inRing = q >= p.q0 - 1 && q <= p.q1 + 1 && r >= p.r0 - 1 && r <= p.r1 + 1;
                    const inB = q >= b.q0 && q <= b.q1 && r >= b.r0 && r <= b.r1;
                    if (inB) { if (inRing) { ok = false; break; } continue; }
                    if (!_ground(tile)) { ok = false; break; }
                }
            }
            // (and never across the way out of the building's door)
            const door = c.def.meta.find(m => m.door);
            const dq = c.q + door.q;
            if (ok && dq >= p.q0 - 1 && dq <= p.q1 + 1 && c.r + 3 >= p.r0 - 1 && c.r + 1 <= p.r1 + 1) ok = false;
            if (ok) return p;
        }
        return null;
    },

    /** Lay the field, orchard or paddock in its fence, the gate on the side nearer the building */
    _layPlot(tiles, p, site, cfg, seed) {
        const rng = _rng(seed ^ 0x2545f491);
        const put = (id, q, r) => { const d = CustomObjects.getDef(id); return !!d && TownProps.place(tiles, d, q, r); };
        const fw = p.q1 - p.q0 + 1, fh = p.r1 - p.r0 + 1;
        // The fence, laid as plain runs and joined at its corners (TownProps.joinFences)
        const gateQ = p.q0 + Math.floor(fw / 2);
        for (let q = p.q0 - 1; q <= p.q1 + 1; q++) {
            put(p.gate === 'n' && q === gateQ ? 'tp_fence_gate' : 'tp_fence_ew', q, p.r0 - 1);
            put(p.gate === 's' && q === gateQ ? 'tp_fence_gate' : 'tp_fence_ew', q, p.r1 + 1);
        }
        for (let r = p.r0; r <= p.r1; r++) {
            put('tp_fence_ns', p.q0 - 1, r);
            put('tp_fence_ns', p.q1 + 1, r);
        }
        TownProps.joinFences(tiles);
        if (site === 'field') {
            const kinds = Array.isArray(cfg.field) && cfg.field.length ? cfg.field : ['wheat'];
            const kind = kinds[Math.floor(rng() * kinds.length)];
            put(TownProps.fieldId(kind, fw, fh), p.q0, p.r1);
            tiles._propertyPlots = true;
        } else if (site === 'orchard') {
            const trees = Array.isArray(cfg.trees) && cfg.trees.length ? cfg.trees : ['tp_tree_apple'];
            // Rows of fruit trees, staggered, a tree's crown clear of the next
            let row = 0;
            for (let r = p.r1; r >= p.r0 + 1; r -= 2, row++) {
                for (let q = p.q0 + (row % 2); q <= p.q1; q += 3) put(trees[Math.floor(rng() * trees.length)], q, r);
            }
        } else {
            const hay = cfg.props && cfg.props.length ? cfg.props : ['tp_hay_green'];
            const n = 1 + Math.floor(rng() * 2);
            for (let i = 0; i < n; i++) put(hay[i % hay.length], p.q0 + 1 + Math.floor(rng() * Math.max(1, fw - 3)), p.r0 + Math.floor(rng() * Math.max(1, fh - 1)));
        }
        this._claimSite(tiles, { q0: p.q0 - 1, q1: p.q1 + 1, r0: p.r0 - 1, r1: p.r1 + 1 }, 1, 2);
    },

    /** A few things about the building's yard, by its side walls (not the `skipSide` one: -1 west, 1 east) */
    _yardProps(tiles, def, q, r, ids, seed, skipSide = 0) {
        if (!Array.isArray(ids) || !ids.length) return;
        const rng = _rng(seed ^ 0x68e31da4);
        const b = _box(def, q, r);
        const door = def.meta.find(m => m.door) || { q: 0 };
        const dq = q + door.q;
        const spots = [];
        for (const side of [-1, 1]) {
            if (side === skipSide) continue;
            const col = side < 0 ? b.q0 - 1 : b.q1 + 1;
            spots.push([col, b.r1], [col, b.r1 - 1], [col + side, b.r1]);
        }
        // (and the front corners, clear of the door's way out)
        for (const fq of [b.q0, b.q1]) if (Math.abs(fq - dq) > 1) spots.push([fq, b.r1 + 1]);
        const n = Math.min(spots.length, 2 + Math.floor(rng() * 2));
        let put = 0;
        for (let i = 0; i < spots.length && put < n; i++) {
            const [sq, sr] = spots[(Math.floor(rng() * spots.length) + i) % spots.length];
            const t = tiles[sr] && tiles[sr][sq];
            if (!t || t._wet || t.customObject || t.customObjectPart) continue;
            const d = CustomObjects.getDef(ids[(put + Math.floor(rng() * ids.length)) % ids.length]);
            if (d && d.bounds && d.bounds.maxCol - d.bounds.minCol > 1) continue;
            if (d && TownProps.place(tiles, d, sq, sr)) put++;
        }
    },

    /** Mark a site taken (and the ground `clear` cells round it kept clear of wild trees) */
    _claimSite(tiles, box, pad = 1, clear = 2) {
        const H = tiles.length, W = tiles[0].length;
        for (let r = box.r0 - Math.max(pad, clear); r <= box.r1 + Math.max(pad, clear); r++) {
            for (let q = box.q0 - Math.max(pad, clear); q <= box.q1 + Math.max(pad, clear); q++) {
                if (q < 0 || r < 0 || q >= W || r >= H) continue;
                const t = tiles[r][q];
                if (q >= box.q0 - pad && q <= box.q1 + pad && r >= box.r0 - pad && r <= box.r1 + pad) t._propSite = true;
                if (clear && !t._wet && q >= box.q0 - clear && q <= box.q1 + clear && r >= box.r0 - clear && r <= box.r1 + clear) t._townCleared = true;
            }
        }
    },
});
