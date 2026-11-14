// InnerMap — mines: caves in the crags and the mines the player digs.
//
// Three ways under the ground, each a site kept on the world:
//   • a cave: a mouth in a crag's rock face (world/innerMap/cliffs.js lays it,
//     worlds since terrainGen 9) opening on a natural cave — passages and
//     chambers, ore in the walls, loose stones and crystal on its floor;
//   • a drift (adit): the player cuts into a rock face from its foot, stage by
//     stage, until it opens on a mine of their own: solid rock but for the
//     first cell in, every cell of it to be cut by hand;
//   • a shaft: sunk into open ground stage by stage, timbered and laddered,
//     down into the same kind of mine.
//
// Underground is a map of its own, entered like a building (interiors.js
// enterBuilding with a building that carries `_underground`, so everything that
// knows "inside" holds: the street map waits, the way out is the door tile).
// Its layout is drawn afresh from the site's seed (layout(): hash-driven, no
// rng drawn) and the record's changes laid over it, so a mine is the same on
// every visit and after a save:
//
//   world.mines[hexKey] = { sites: { 'cave:q,r' | 'adit:q,r' | 'shaft:q,r': {
//       kind, q, r, day, stage, open, cells: { 'q,r': 'f' | 'r' | 's' }, dug, got: { item: n } } } }
//   cells: 'f' open floor (cut and hauled, or a cave floor picked clean),
//          'r' rubble (cut, or come down in a cave-in), 's' floor under timbers.
//
// Underground tiles (_isInterior, drawn by ui/innerMapLayers/caves.js):
//   tile._cave = 'rock' | 'floor' | 'rubble' | 'exit'; tile._bedrock (the
//   map's rim, never cut); tile._vein (an ore id in the rock); tile._loose
//   ('stone' | 'crystal' on a floor); tile._support (timbers over it);
//   tile._mined (cut by hand: counts toward the roof's weight).
//
// On the street map: tile._adit / tile._shaft = { stage, open } (bound from the
// record on every entry: _bindMines), tile._caveMouth on a mouth's entry tile and
// tile._caveMouthOf = { q, r } on each of its tiles.
//
// The work itself — its time, the pick, the yields, the cave-ins — is
// ui/innerMapMining.js; tuning in data/mining.json. Randomness: none here but
// the hash-seeded layout; the caller rolls cave-ins (Utils) and passes the roll.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';

const DEFAULTS = {
    map: { width: 40, height: 40, caveOpen: 0.2, veins: 1.6, veinRadius: [1, 2], loose: 0.05, crystal: 0.012, bats: 0.5 },
    adit: { stages: 3, stone: [2, 4] },
    shaft: { stages: 4, stone: [1, 3], lining: [{ wood: 4 }, { planks: 3 }], ladder: [{ rope: 1 }, { wood: 2 }] },
    cell: { stone: [2, 4], veinQty: [1, 3], strayChance: 0.08 },
    support: { reach: 2, span: 3, free: 3, base: 0.1, per: 0.06, max: 0.6, cost: [{ wood: 2 }, { planks: 2 }], hurt: [4, 10] },
    light: { darkness: 0.9, none: 46, candles: 92, lantern: 140 },
    geology: { resourceBoost: 6, resourceItem: {}, terrains: { default: [{ item: 'ore', weight: 1 }] }, veinChance: { default: 0.35 } },
    text: {},
};

const _key = (q, r) => `${q},${r}`;

function _hash(...parts) {
    let h = 0x811c9dc5;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        h ^= 0x9e3779b9;
        h = Math.imul(h, 2246822519) >>> 0;
    }
    return h >>> 0 || 1;
}

function _rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _between(rng, v, d) {
    const [a, b] = Array.isArray(v) ? v : [d, d];
    return a + Math.floor(rng() * (Math.max(a, b) - a + 1));
}

function _cfg() {
    const d = (DataLoader._gamedata && DataLoader._gamedata.mining) || {};
    const out = { ...DEFAULTS, ...d };
    for (const k of ['map', 'adit', 'shaft', 'cell', 'support', 'light', 'geology', 'text']) out[k] = { ...DEFAULTS[k], ...(d[k] || {}) };
    return out;
}

const NAMES = { cave: 'the Cave', adit: 'the Drift', shaft: 'the Shaft' };

export const Mines = {
    config: _cfg,

    siteKey(kind, q, r) {
        return `${kind}:${q},${r}`;
    },

    parseKey(k) {
        const m = /^(\w+):(-?\d+),(-?\d+)$/.exec(String(k || ''));
        return m ? { kind: m[1], q: Number(m[2]), r: Number(m[3]) } : null;
    },

    /** The record of the mines on a hex (world.mines[hexKey]), made when asked. */
    record(world, hexKey, create = false) {
        if (!world || !hexKey) return null;
        if (!world.mines || typeof world.mines !== 'object') {
            if (!create) return null;
            world.mines = {};
        }
        if (!world.mines[hexKey] && create) world.mines[hexKey] = { sites: {} };
        const rec = world.mines[hexKey] || null;
        if (rec && !rec.sites) rec.sites = {};
        return rec;
    },

    /** One site's record, made (from init) when asked. */
    site(world, hexKey, key, create = false, init = null) {
        const rec = Mines.record(world, hexKey, create);
        if (!rec) return null;
        if (!rec.sites[key] && create) {
            const p = Mines.parseKey(key) || {};
            rec.sites[key] = { kind: p.kind, q: p.q, r: p.r, day: 0, stage: 0, open: p.kind === 'cave', cells: {}, dug: 0, got: {}, ...(init || {}) };
        }
        const s = rec.sites[key] || null;
        if (s && !s.cells) s.cells = {};
        return s;
    },

    /** Every site on a hex: [[key, site]] */
    sites(world, hexKey) {
        const rec = Mines.record(world, hexKey);
        return rec ? Object.entries(rec.sites) : [];
    },

    /** A site's name, for the notices and the way out ("the Cave", "the Drift"). */
    nameOf(kind) {
        return NAMES[kind] || 'the Mine';
    },

    /**
     * What the rock of a hex holds: [{ item, weight }] by its terrain, the
     * hex's own resource weighted up (geology.resourceItem / resourceBoost).
     */
    veinTable(terrainId, resource = null) {
        const G = _cfg().geology;
        const T = G.terrains || {};
        const base = (T[terrainId] || T.default || []).map(e => ({ item: e.item, weight: Math.max(0, Number(e.weight) || 0) }));
        const res = resource && (typeof resource === 'string' ? resource : resource.id || resource.type);
        const item = res ? ((G.resourceItem || {})[res] || null) : null;
        if (item && item !== 'stone') {
            const boost = Number(G.resourceBoost) || 1;
            const e = base.find(x => x.item === item);
            const top = Math.max(1, ...base.map(x => x.weight));
            if (e) e.weight = Math.max(e.weight * boost, top);
            else base.push({ item, weight: top });
        }
        return base.filter(e => e.weight > 0);
    },

    /** A weighted pick from the vein table by a [0, 1) value. */
    pickVein(table, v) {
        const total = table.reduce((s, e) => s + e.weight, 0);
        if (!(total > 0)) return null;
        let x = v * total;
        for (const e of table) {
            x -= e.weight;
            if (x < 0) return e.item;
        }
        return table[table.length - 1].item;
    },

    /** How richly veined a terrain's rock is (geology.veinChance). */
    veinRichness(terrainId) {
        const V = _cfg().geology.veinChance || {};
        const v = V[terrainId] != null ? V[terrainId] : V.default;
        return Number(v) >= 0 ? Number(v) : 0.35;
    },

    /**
     * The underground of a site as it was before anyone dug in it (pure: the
     * same for the same seed). spec: { kind, seed, terrainId, resource }.
     * → { w, h, entry: { q, r }, exit: { q, r }, cell: [] ('R' rock, 'B' bedrock,
     *     'F' floor, 'X' the way out), vein: [], loose: [] } (indexed r * w + q)
     */
    layout(spec) {
        const C = _cfg().map;
        const w = Math.max(12, C.width | 0), h = Math.max(12, C.height | 0);
        const rng = _rng(spec.seed);
        const n = w * h;
        const cell = new Array(n).fill('R');
        const vein = new Array(n).fill(null);
        const loose = new Array(n).fill(null);
        const at = (q, r) => r * w + q;
        for (let q = 0; q < w; q++) { cell[at(q, 0)] = 'B'; cell[at(q, h - 1)] = 'B'; }
        for (let r = 0; r < h; r++) { cell[at(0, r)] = 'B'; cell[at(w - 1, r)] = 'B'; }
        const cx = w >> 1;
        const exit = { q: cx, r: h - 1 }, entry = { q: cx, r: h - 2 };
        cell[at(exit.q, exit.r)] = 'X';
        cell[at(entry.q, entry.r)] = 'F';

        if (spec.kind === 'cave') {
            // Passages wandering up from the mouth, opening now and then into a chamber
            const open = (q, r) => {
                if (q < 2 || r < 2 || q > w - 3 || r > h - 3) return;
                cell[at(q, r)] = 'F';
            };
            open(cx, h - 3);
            const target = Math.round((w - 4) * (h - 4) * (Number(C.caveOpen) || 0.2));
            const count = () => cell.reduce((s, c) => s + (c === 'F' ? 1 : 0), 0);
            const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            let starts = [{ q: cx, r: h - 3 }];
            for (let walker = 0; walker < 8 && count() < target; walker++) {
                const s = starts[Math.floor(rng() * starts.length)];
                let q = s.q, r = s.r, d = walker === 0 ? 0 : Math.floor(rng() * 4);
                const steps = Math.round(target / 2.2);
                for (let i = 0; i < steps; i++) {
                    const turn = rng();
                    if (turn < 0.18) d = (d + 1) % 4;
                    else if (turn < 0.36) d = (d + 3) % 4;
                    if (d === 2 && rng() < 0.6) d = 0;   // (on the whole, further in and up)
                    const nq = q + DIRS[d][0], nr = r + DIRS[d][1];
                    if (nq < 2 || nr < 2 || nq > w - 3 || nr > h - 4) { d = (d + 2) % 4; continue; }
                    q = nq; r = nr;
                    open(q, r);
                    if (rng() < 0.22) open(q + (d % 2 === 0 ? 1 : 0), r + (d % 2 === 1 ? 1 : 0));
                    if (rng() < 0.035) {
                        const rx = 2 + Math.floor(rng() * 2), ry = 1 + Math.floor(rng() * 2);
                        for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
                            if ((x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) <= 1) open(q + x, r + y);
                        }
                        starts.push({ q, r });
                    }
                    if (count() >= target) break;
                }
                starts.push({ q, r });
            }
            // Round the chambers off: rock all but walled in by open floor gives way
            const was = cell.slice();
            for (let r = 2; r < h - 2; r++) for (let q = 2; q < w - 2; q++) {
                if (was[at(q, r)] !== 'R') continue;
                let o = 0;
                for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if ((x || y) && was[at(q + x, r + y)] === 'F') o++;
                if (o >= 6) cell[at(q, r)] = 'F';
            }
            // Only what joins the mouth is open: the rest stays rock
            const seen = new Uint8Array(n);
            const stack = [at(entry.q, entry.r)];
            seen[stack[0]] = 1;
            while (stack.length) {
                const i = stack.pop();
                const q = i % w, r = (i / w) | 0;
                for (const [dq, dr] of DIRS) {
                    const j = at(q + dq, r + dr);
                    if (q + dq < 0 || r + dr < 0 || q + dq >= w || r + dr >= h || seen[j] || cell[j] !== 'F') continue;
                    seen[j] = 1;
                    stack.push(j);
                }
            }
            for (let i = 0; i < n; i++) if (cell[i] === 'F' && !seen[i]) cell[i] = 'R';
        }

        // The veins through the rock: blobs of one ore each
        const table = Mines.veinTable(spec.terrainId, spec.resource);
        let rock = 0;
        for (let i = 0; i < n; i++) if (cell[i] === 'R') rock++;
        const veins = Math.round(rock / 100 * (Number(C.veins) || 0) * Mines.veinRichness(spec.terrainId) * (spec.kind === 'cave' ? 1.2 : 1));
        for (let v = 0; v < veins && table.length; v++) {
            const ore = Mines.pickVein(table, rng());
            const q0 = 1 + Math.floor(rng() * (w - 2)), r0 = 1 + Math.floor(rng() * (h - 3));
            const rad = _between(rng, C.veinRadius, 1);
            for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
                const q = q0 + x, r = r0 + y;
                if (q < 1 || r < 1 || q > w - 2 || r > h - 2) continue;
                if (Math.abs(x) + Math.abs(y) > rad + 0.5 || rng() < 0.3) continue;
                if (cell[at(q, r)] === 'R') vein[at(q, r)] = ore;
            }
        }
        // A cave's floor: loose stones, and crystal where the rock bears gems or the cave is deep
        if (spec.kind === 'cave') {
            const gemmy = table.some(e => e.item === 'gems');
            for (let r = 1; r < h - 4; r++) for (let q = 1; q < w - 1; q++) {
                const i = at(q, r);
                if (cell[i] !== 'F') continue;
                const x = rng();
                if (x < (Number(C.loose) || 0)) loose[i] = 'stone';
                else if (x < (Number(C.loose) || 0) + (Number(C.crystal) || 0) * (gemmy ? 2 : 0.5)) loose[i] = 'crystal';
            }
        }
        return { w, h, entry, exit, cell, vein, loose };
    },

    /** The seed of a site's underground. */
    seedOf(hexKey, kind, q, r) {
        return _hash('mine', hexKey, kind === 'cave' ? 'cave' : 'dug', q, r);
    },
};

/** A fresh subTerrain for an underground cell (each its own: some code writes into a tile's). */
function _sub(kind, site) {
    switch (kind) {
        case 'floor': return { id: 'cave_floor', name: site === 'cave' ? 'Cave Floor' : 'Mine Floor', icon: '🕳️', color: '#5a4632', passable: true };
        case 'rubble': return { id: 'cave_rubble', name: 'Rubble', icon: '🪨', color: '#6b5843', passable: false };
        case 'exit': return { id: 'door', name: site === 'shaft' ? 'Ladder Up' : site === 'cave' ? 'Cave Mouth' : 'Drift Mouth', icon: site === 'shaft' ? '🪜' : '🚪', color: '#9a8a6a', passable: true };
        default: return { id: 'cave_rock', name: 'Rock', icon: '🪨', color: '#2b2119', passable: false };
    }
}

/** Set an underground tile to a kind of cell. */
function _setCave(tile, kind, site) {
    tile._cave = kind;
    tile.subTerrain = _sub(kind, site);
    tile._isDoor = kind === 'exit' ? true : undefined;
    if (kind !== 'rock') tile._vein = null;
    if (kind !== 'floor') { tile._loose = null; tile._support = false; }
}

Object.assign(InnerMap, {
    _mineWorld: null,
    _mineHex: null,

    /** The underground site the player is in: { world, hexKey, key, site, kind } or null. */
    mineHere() {
        const b = this._insideBuilding;
        const u = b && b._underground;
        if (!u) return null;
        const site = Mines.site(this._mineWorld, u.hexKey, u.key, true);
        return { world: this._mineWorld, hexKey: u.hexKey, key: u.key, kind: u.kind, site, under: u };
    },

    /** Is the player underground? */
    isUnderground() {
        return !!(this._insideBuilding && this._insideBuilding._underground);
    },

    /**
     * The interior for a building that is a way underground (interiors.js
     * _generateInterior hands it here): the site's layout, its record laid over it.
     */
    _generateUnderground(building) {
        const u = building._underground;
        const L = Mines.layout({ kind: u.kind, seed: u.seed, terrainId: u.terrainId, resource: u.resource });
        const site = Mines.site(this._mineWorld, u.hexKey, u.key, false);
        const cells = (site && site.cells) || {};
        const tiles = [];
        for (let r = 0; r < L.h; r++) {
            const row = [];
            for (let q = 0; q < L.w; q++) {
                const i = r * L.w + q;
                const c = L.cell[i];
                const kind = c === 'F' ? 'floor' : c === 'X' ? 'exit' : 'rock';
                const t = {
                    q, r, baseTerrain: 'cave', subTerrain: null,
                    explored: false, visible: false, parentTerrain: 'interior',
                    encounter: null, building: null, _isInterior: true, _interiorBuildingType: building.type,
                    _cave: kind, _bedrock: c === 'B', _vein: L.vein[i], _loose: L.loose[i], _support: false, _mined: false,
                    _furniture: null, effectiveTemp: 11, moisture: 0.6, weatherType: 'clear',
                };
                _setCave(t, kind, u.kind);
                t._vein = kind === 'rock' ? L.vein[i] : null;
                t._loose = kind === 'floor' ? L.loose[i] : null;
                const rec = cells[_key(q, r)];
                if (rec && c !== 'B' && c !== 'X') {
                    const wasRock = c === 'R';
                    if (rec === 'r') _setCave(t, 'rubble', u.kind);
                    else _setCave(t, 'floor', u.kind);
                    t._support = rec === 's';
                    t._mined = wasRock;
                }
                row.push(t);
            }
            tiles.push(row);
        }
        tiles._underground = { entry: L.entry, exit: L.exit };
        this._caveStamp = (this._caveStamp || 0) + 1;
        return { tiles, width: L.w, height: L.h };
    },

    /**
     * Go underground at the site `kind` at (q, r) on the street map (a cave's
     * mouth, an open drift or shaft). Returns whether the player is in.
     */
    enterUnderground(game, kind, q, r) {
        if (!this.active || this._insideBuilding || !game || !game.world) return false;
        const wt = this.currentWorldTile || {};
        const hexKey = `${wt.q},${wt.r}`;
        const world = game.world;
        this._mineWorld = world;
        const worldTile = world.getTile ? world.getTile(wt.q, wt.r) : null;
        const key = Mines.siteKey(kind, q, r);
        const site = Mines.site(world, hexKey, key, true, { day: world.day || 0 });
        if (kind === 'cave') site.open = true;
        if (!site.open) return false;
        site.visits = (site.visits || 0) + 1;
        const building = {
            type: kind === 'cave' ? 'cave' : 'mine',
            name: Mines.nameOf(kind).replace(/^the /, 'The '),
            q, r,
            _underground: {
                kind, key, hexKey,
                seed: Mines.seedOf(hexKey, kind, q, r),
                terrainId: worldTile && worldTile.terrain ? worldTile.terrain.id : null,
                resource: worldTile ? worldTile.resource || null : null,
                lightRadius: _cfg().light.none,
                dark: _cfg().light.darkness,
            },
        };
        // (drawn afresh from the record each time: never a stale copy from before a load)
        if (this._interiorCache) delete this._interiorCache[`${wt.q},${wt.r}_${building.type}_${q}_${r}`];
        if (!this.enterBuilding(building, game, { force: true })) return false;
        const ug = this.tiles && this.tiles._underground;
        if (ug) {
            this.playerInnerQ = ug.entry.q;
            this.playerInnerR = ug.entry.r;
            this._playerPrevQ = ug.entry.q;
            this._playerPrevR = ug.entry.r;
        }
        this._revealAround(this.tiles, this.playerInnerQ, this.playerInnerR, 3);
        const ex = ug && ug.exit;
        if (ex && this.tiles[ex.r] && this.tiles[ex.r][ex.q]) this.tiles[ex.r][ex.q].explored = true;
        return true;
    },

    // ── Underground: the cells cut, hauled, propped ──

    /** Is (q, r) open ground underground (floor, the way out)? */
    _caveOpen(q, r) {
        const t = this.getTile(q, r);
        return !!(t && (t._cave === 'floor' || t._cave === 'exit'));
    },

    /** Can the rock at (q, r) be cut — rock (not the map's rim) with open ground beside it? */
    mineCanCut(q, r) {
        const t = this.getTile(q, r);
        if (!t || t._cave !== 'rock' || t._bedrock) return false;
        return this._caveOpen(q + 1, r) || this._caveOpen(q - 1, r) || this._caveOpen(q, r + 1) || this._caveOpen(q, r - 1);
    },

    /** Mark a cell's state on the site's record. */
    _mineMark(q, r, code) {
        const m = this.mineHere();
        if (!m || !m.site) return;
        m.site.cells[_key(q, r)] = code;
    },

    /** Cut the rock at (q, r): it lies as rubble to haul out. → { vein } or null */
    mineCut(q, r) {
        if (!this.mineCanCut(q, r)) return null;
        const t = this.getTile(q, r);
        const m = this.mineHere();
        const vein = t._vein || null;
        _setCave(t, 'rubble', m ? m.kind : 'adit');
        t._mined = true;
        t.explored = true;
        this._mineMark(q, r, 'r');
        this._caveStamp = (this._caveStamp || 0) + 1;
        if (m && m.site) m.site.dug = (m.site.dug || 0) + 1;
        // the rock round it comes into the light
        this._revealAround(this.tiles, q, r, 1);
        return { vein };
    },

    /** Haul the rubble out of (q, r): open floor. */
    mineHaul(q, r) {
        const t = this.getTile(q, r);
        if (!t || t._cave !== 'rubble') return false;
        const m = this.mineHere();
        _setCave(t, 'floor', m ? m.kind : 'adit');
        this._mineMark(q, r, 'f');
        this._caveStamp = (this._caveStamp || 0) + 1;
        return true;
    },

    /** Take what lies loose on the floor at (q, r). → 'stone' | 'crystal' | null */
    mineTakeLoose(q, r) {
        const t = this.getTile(q, r);
        if (!t || t._cave !== 'floor' || !t._loose) return null;
        const what = t._loose;
        t._loose = null;
        this._mineMark(q, r, t._support ? 's' : 'f');
        this._caveStamp = (this._caveStamp || 0) + 1;
        return what;
    },

    /** Set timbers over the floor at (q, r). */
    mineProp(q, r) {
        const t = this.getTile(q, r);
        if (!t || t._cave !== 'floor' || t._support) return false;
        t._support = true;
        t._loose = null;
        this._mineMark(q, r, 's');
        this._caveStamp = (this._caveStamp || 0) + 1;
        return true;
    },

    /** Are there timbers within reach of (q, r)? */
    _mineHeld(q, r, reach) {
        for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
            const t = this.getTile(q + x, r + y);
            if (t && t._support) return true;
        }
        return false;
    },

    /**
     * How the roof stands over a cut at (q, r): the dug cells round it with no
     * timbers over them, and the chance it comes down. → { open, chance }
     */
    mineRoofRisk(q, r) {
        const S = _cfg().support;
        const reach = Math.max(1, Number(S.reach) || 2);
        const span = Math.max(1, Number(S.span) || 3);
        let open = 0;
        for (let y = -span; y <= span; y++) for (let x = -span; x <= span; x++) {
            const t = this.getTile(q + x, r + y);
            if (!t || !t._mined || t._cave === 'rock') continue;
            if (this._mineHeld(q + x, r + y, reach)) continue;
            open++;
        }
        const over = open - (Number(S.free) || 4);
        const chance = over <= 0 ? 0 : Math.min(Number(S.max) || 0.6, (Number(S.base) || 0) + (over - 1) * (Number(S.per) || 0));
        return { open, chance };
    },

    /**
     * The roof comes down at (q, r): it and up to two dug, unpropped cells beside
     * it fill with rubble. pick: a [0, 1) value per candidate (the caller's roll).
     * → [{ q, r }] the cells that came down
     */
    mineCollapse(q, r, pick = () => 0) {
        const m = this.mineHere();
        const kind = m ? m.kind : 'adit';
        const down = [];
        const fall = (x, y) => {
            const t = this.getTile(x, y);
            if (!t || !t._mined || t._support || (t._cave !== 'floor' && t._cave !== 'rubble')) return;
            _setCave(t, 'rubble', kind);
            this._mineMark(x, y, 'r');
            down.push({ q: x, r: y });
        };
        fall(q, r);
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
            .map(([dq, dr]) => ({ q: q + dq, r: r + dr, k: pick() }))
            .sort((a, b) => a.k - b.k);
        let more = 0;
        for (const c of near) {
            if (more >= 2) break;
            const t = this.getTile(c.q, c.r);
            if (t && t._mined && !t._support && t._cave === 'floor') { fall(c.q, c.r); more++; }
        }
        if (down.length) this._caveStamp = (this._caveStamp || 0) + 1;
        return down;
    },

    /** Count what a site has given (for the record and the ledger of the hex's deposit). */
    mineCredit(item, qty) {
        const m = this.mineHere();
        const s = m && m.site;
        if (!s || !item || !(qty > 0)) return;
        if (!s.got) s.got = {};
        s.got[item] = (s.got[item] || 0) + qty;
    },

    // ── On the street map: the drifts and shafts begun, the cave mouths ──

    /** On entering a street map: lay the drifts and shafts dug here as the record has them. */
    _bindMines(world, hexKey) {
        this._mineWorld = world || null;
        this._mineHex = hexKey;
        if (!this.tiles) return 0;
        let n = 0;
        for (const [, s] of Mines.sites(world, hexKey)) {
            const t = this.getTile(s.q, s.r);
            if (!t) continue;
            if (s.kind === 'adit' && this.isCliffFace && this.isCliffFace(t)) {
                t._adit = { stage: s.stage || 0, open: !!s.open };
                n++;
            } else if (s.kind === 'shaft' && !t._isInterior) {
                this._layShaft(t, s);
                n++;
            }
        }
        if (n) this._climbLinkCache = null;
        return n;
    },

    _layShaft(t, s) {
        t._shaft = { stage: s.stage || 0, open: !!s.open };
        if ((s.stage || 0) >= 1 && (!t.subTerrain || t.subTerrain.id !== 'mine_shaft')) {
            if (!t._unshaft) t._unshaft = t.subTerrain ? { ...t.subTerrain } : null;
            t.subTerrain = { id: 'mine_shaft', name: s.open ? 'Mine Shaft' : 'Shaft (sinking)', icon: '🕳️', color: '#3a2a1a', passable: false };
        } else if (t.subTerrain && t.subTerrain.id === 'mine_shaft') {
            t.subTerrain.name = s.open ? 'Mine Shaft' : 'Shaft (sinking)';
        }
    },

    /** The cave mouth (its entry tile) that (q, r) is part of, or null. */
    caveMouthAt(q, r) {
        const t = this.getTile(q, r);
        const m = t && t._caveMouthOf;
        return m ? { q: m.q, r: m.r } : null;
    },

    /**
     * Can a drift be cut into the rock face at (q, r): the bottom row of a face,
     * with ground (or a crag's top) at its foot to stand on, no cave mouth there.
     */
    canStartAdit(q, r) {
        const t = this.getTile(q, r);
        if (!t || !this.isCliffFace || !this.isCliffFace(t) || t._caveMouthOf || t._adit) return false;
        const foot = this.getTile(q, r + 1);
        if (!foot || (this.isCliffFace(foot))) return false;
        const lv = this.standLevel(foot);
        if (lv == null || lv !== (t._cragLevel || 0)) return false;
        if (lv === 0 && !(foot.subTerrain && foot.subTerrain.passable)) return false;
        if (foot.building || foot.customObject || foot.customObjectPart || foot.customBuilding || foot.customBuildingPart) return false;
        return true;
    },

    /** The site record for a street-map spot, made when asked. */
    _mineSiteAt(kind, q, r, create = false) {
        return Mines.site(this._mineWorld, this._mineHex, Mines.siteKey(kind, q, r), create, { day: this._mineWorld ? this._mineWorld.day || 0 : 0 });
    },

    /** A stage of work on the drift at (q, r). → { stage, open } */
    advanceAdit(q, r) {
        const t = this.getTile(q, r);
        if (!t) return null;
        const C = _cfg();
        const s = this._mineSiteAt('adit', q, r, true);
        if (!s) return null;
        s.stage = Math.min(C.adit.stages, (s.stage || 0) + 1);
        s.open = s.stage >= C.adit.stages;
        t._adit = { stage: s.stage, open: s.open };
        this._climbLinkCache = null;
        return { stage: s.stage, open: s.open };
    },

    /** A stage of work on the shaft at (q, r). → { stage, open } */
    advanceShaft(q, r) {
        const t = this.getTile(q, r);
        if (!t) return null;
        const C = _cfg();
        const s = this._mineSiteAt('shaft', q, r, true);
        if (!s) return null;
        s.stage = Math.min(C.shaft.stages, (s.stage || 0) + 1);
        s.open = s.stage >= C.shaft.stages;
        this._layShaft(t, s);
        return { stage: s.stage, open: s.open };
    },

    /** The drift or shaft begun at (q, r): { kind, stage, open } or null. */
    mineWorkAt(q, r) {
        const t = this.getTile(q, r);
        if (!t) return null;
        if (t._adit) return { kind: 'adit', ...t._adit };
        if (t._shaft) return { kind: 'shaft', ...t._shaft };
        return null;
    },
});
