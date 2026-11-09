// ============================================================
// TOWN PROPS — the things a town is dressed with
// ============================================================
// Wells, market stalls, lamp posts, barrels, crates, hay, woodpiles, flower
// beds, fences and fields, built from LPC sheet cells (data/townProps.json)
// into editor-object defs (the shape CustomObjects already draws, clicks and
// blocks movement with). CustomObjects.loadAll registers TownProps.defs();
// the settlement planner places them with TownProps.place().
//
// Fields come in every size the planner asks for (FIELD_W × FIELD_H) so a
// field is one object: a 9-slice of plowed soil, or a fill of wheat, with
// crops on top. Fences are single-tile pieces laid round a rectangle.
//
// Pure: no randomness of its own (callers pass their rng), no import-time
// effects.

import { DataLoader } from '../core/dataLoader.js';

const T = 32;
export const FIELD_W = [3, 4, 5, 6, 7, 8, 9, 10];
export const FIELD_H = [2, 3, 4, 5, 6];

function _data() {
    return (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || null;
}

/** The year a day falls in (120 days a year, world/seasons.js). */
const _year = (day) => Math.floor((Math.max(1, Math.floor(day || 1)) - 1) / 120);

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** The ground a wild tree or bush grows on (the LPC oak's, data/objects.json large_tree_1). */
const WILD_GROUND = ['grass', 'tall_grass', 'dirt', 'dry_grass', 'trees', 'brush'];
/** The ground a wild rock lies on: most of all bare rock, now and then where the trees grow (p.wild.elsewhere). */
const ROCK_GROUND = ['rocks', ...WILD_GROUND];

/** What a wild thing is out in the country, by its tag: the scatter's objectType and what it gives. */
const WILD_KINDS = {
    tree: { objectType: 'tree', give: 'wood', amount: 40, ground: WILD_GROUND },
    bush: { objectType: 'plant', give: 'firewood', amount: 2, ground: WILD_GROUND },
    rock: { objectType: 'rock', give: 'stone', amount: 5, ground: ROCK_GROUND },
};

/** A gate's two pieces: shut (blocks) and open (walked through). */
const GATE_SHUT = 'tp_fence_gate';
const GATE_OPEN = 'tp_fence_gate_open';

function _def(id, name, tiles, solidRows, opts = {}) {
    let minC = 0, maxC = 0, minR = 0;
    for (const t of tiles) {
        minC = Math.min(minC, t.localCol); maxC = Math.max(maxC, t.localCol);
        minR = Math.min(minR, t.localRow);
    }
    const meta = [];
    const seen = new Set();
    for (const t of tiles) {
        const k = `${t.localCol},${t.localRow}`;
        if (seen.has(k)) continue;
        seen.add(k);
        // A tree (bush, rock) blocks only where it stands (the bottom row's middle cell): its crown is walked behind
        const solid = opts.trunk
            ? t.localRow === 0 && t.localCol === Math.floor((minC + maxC) / 2)
            : opts.allSolid || t.localRow > -solidRows;
        meta.push({ localCol: t.localCol, localRow: t.localRow, impassable: !!solid && solidRows > 0, interactionPoint: t.localCol === 0 && t.localRow === 0 });
    }
    return {
        id, name,
        objectType: 'decoration',
        terrainBindings: [],
        spawnWeight: 0,
        townProp: true,
        tags: opts.tags || [],
        bounds: { minCol: minC, minRow: minR, maxCol: maxC, maxRow: 0 },
        hasBlockedTiles: solidRows > 0,
        hasInteraction: true,
        tiles,
        meta,
    };
}

/** A rect [col, row, w, h] of a sheet as object tiles, anchored bottom-left. */
function _rectTiles(sheet, [c0, r0, w, h]) {
    const tiles = [];
    for (let dr = 0; dr < h; dr++) {
        for (let dc = 0; dc < w; dc++) {
            tiles.push({ localCol: dc, localRow: dr - (h - 1), sheetPath: sheet, sx: (c0 + dc) * T, sy: (r0 + dr) * T, sw: T, sh: T });
        }
    }
    return tiles;
}

function _slot(i, n) {
    if (n === 1) return 1;
    return i === 0 ? 0 : i === n - 1 ? 2 : 1;
}

/** One field object, w × h, of a kind ('wheat', 'veg', 'plowed', 'greens'). */
function _fieldDef(d, kind, w, h) {
    const f = d.fields[kind];
    const tiles = [];
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const lr = r - (h - 1);
            if (f.soil) {
                const sheet = d.sheets[f.soil.sheet];
                tiles.push({ localCol: c, localRow: lr, sheetPath: sheet, sx: (f.soil.x + _slot(c, w)) * T, sy: (f.soil.y + _slot(r, h)) * T, sw: T, sh: T });
            }
            // (plain soil is the ground's own, drawn under the field with ragged edges: no square of it here)
            if (f.fill && !(f.tilled && f.fill.sheet === 'soil')) {
                const sheet = d.sheets[f.fill.sheet];
                const [fc, fr] = f.fill.cells[(c * 7 + r * 3) % f.fill.cells.length];
                tiles.push({ localCol: c, localRow: lr, sheetPath: sheet, sx: fc * T, sy: fr * T, sw: T, sh: T });
            }
            // On tilled ground (bare soil the grass brush edges) every cell bears; else the rim stays bare
            if (f.crops && (f.tilled || (c > 0 && c < w - 1 && r > 0 && r < h - 1))) {
                const sheet = d.sheets[f.crops.sheet];
                const [cc, cr] = f.crops.cells[(Math.floor(r) * 3 + Math.floor(c / 2)) % f.crops.cells.length];
                tiles.push({ localCol: c, localRow: lr, sheetPath: sheet, sx: cc * T, sy: cr * T, sw: T, sh: T });
            }
        }
    }
    // Walked into through its gate, or across (dearer on a path: world/innerMap/movement.js)
    const def = _def(TownProps.fieldId(kind, w, h), f.name, tiles, 0, { tags: ['field', kind] });
    const ground = f.tilled && (typeof f.tilled === 'object' ? f.tilled : f.fill);
    if (ground) {
        // The soil the ground layer draws under the field and the ring round it (the grass fringe lies over it)
        def.tilled = { sheetPath: d.sheets[ground.sheet], cells: ground.cells };
    }
    return def;
}

export const TownProps = {
    /** Every prop, fence piece and field def, for CustomObjects to register. */
    defs() {
        const d = _data();
        if (!d) return [];
        const out = [];
        for (const p of d.props || []) {
            const sheet = d.sheets[p.sheet];
            if (!sheet) continue;
            const tags = p.tags || [];
            const kind = Object.keys(WILD_KINDS).find(k => tags.includes(k));
            const solid = p.solid == null ? 1 : p.solid;
            const def = _def(p.id, p.name, _rectTiles(sheet, p.rect), solid, { tags: p.tags, trunk: !!kind && solid > 0 });
            // A wild tree, bush or rock also grows out in the country: the map's scatter
            // puts it down on its ground (world/innerMap/terrain.js _scatterCustomObjects),
            // and it is felled, cut or broken for what it gives
            if (p.wild && kind) {
                const K = WILD_KINDS[kind];
                const w = p.wild;
                def.objectType = K.objectType;
                def.terrainBindings = w.terrain || K.ground;
                def.spawnWeight = w.weight == null ? 0.1 : w.weight;
                // a rock is common on bare rock, rare on other ground (so few beside the
                // trees that the woods keep the mix they had with the LPC oak)
                if (kind === 'rock') {
                    def.spawnWeightBy = { rocks: def.spawnWeight };
                    def.spawnWeight = w.elsewhere == null ? 0.005 : w.elsewhere;
                    def.scatterChance = w.chance == null ? 0.35 : w.chance;
                }
                def.resource = { type: w.give || K.give, amount: w.amount == null ? (w.wood == null ? K.amount : w.wood) : w.amount };
                if (w.resistance != null) def.resistance = w.resistance;
                if (kind === 'tree') def.spawnAfter = w.stump || 'stump_1';
                // a bush is undergrowth: rolled for on the ground the trees left (terrain.js)
                if (kind === 'bush') def.undergrowth = true;
                def.animation = 'combat_1h_halfslash';
            }
            // A prop from a seasonal sheet (trees_summer.png …) turns with the year:
            // the same cells of each season's sheet
            const m = /_(spring|summer|autumn|winter)\.png$/.exec(sheet);
            if (m) {
                def.seasonVariants = {};
                for (const s of SEASONS) {
                    const path = sheet.slice(0, m.index) + `_${s}.png`;
                    def.seasonVariants[s] = _rectTiles(path, p.rect);
                }
            }
            out.push(def);
        }
        const fence = d.fence;
        if (fence) {
            const one = (id, key, [c, r]) => _def(id, fence.name, [{ localCol: 0, localRow: 0, sheetPath: d.sheets[key], sx: c * T, sy: r * T, sw: T, sh: T }], 1, { tags: ['fence'] });
            out.push(one('tp_fence_h_l', fence.h.sheet, fence.h.left));
            out.push(one('tp_fence_h_m', fence.h.sheet, fence.h.mid));
            out.push(one('tp_fence_h_r', fence.h.sheet, fence.h.right));
            out.push(one('tp_fence_v_t', fence.v.sheet, fence.v.top));
            out.push(one('tp_fence_v_m', fence.v.sheet, fence.v.mid));
            out.push(one('tp_fence_v_b', fence.v.sheet, fence.v.bottom));
            // A gate: shut it blocks like the fence; open (its leaf swung back) it is walked through (setGate)
            const gateCell = (id, [c, r], solid) => _def(id, 'Gate', [{ localCol: 0, localRow: 0, sheetPath: d.sheets[fence.gate.sheet], sx: c * T, sy: r * T, sw: T, sh: T }], solid, { tags: ['fence', 'gate'] });
            out.push(gateCell(GATE_SHUT, fence.gate.cell, 1));
            out.push(gateCell(GATE_OPEN, fence.gate.open || fence.gate.cell, 0));
            // The joined pieces (joinFences): one per set of sides with fence, and the gateposts
            const join = fence.join;
            if (join) {
                for (const [mask, cell] of Object.entries(join.cells || {})) out.push(one(`tp_fence_${mask}`, join.sheet, cell));
                if (join.gateLeft) out.push(one('tp_fence_gl', join.sheet, join.gateLeft));
                if (join.gateRight) out.push(one('tp_fence_gr', join.sheet, join.gateRight));
            }
        }
        for (const kind of Object.keys(d.fields || {})) {
            for (const w of FIELD_W) for (const h of FIELD_H) out.push(_fieldDef(d, kind, w, h));
        }
        return out;
    },

    /** Prop ids carrying a tag (data/townProps.json). */
    idsWithTag(tag) {
        const d = _data();
        return d ? (d.props || []).filter(p => (p.tags || []).includes(tag)).map(p => p.id) : [];
    },

    fieldId(kind, w, h) {
        return `tp_field_${kind}_${w}x${h}`;
    },

    /**
     * The field kind a cycle has reached on a day of the year (1..120), shifted
     * a few days by `shift` so neighbouring fields don't all turn at once.
     */
    fieldStage(cycle, dayOfYear, shift = 0) {
        const d = _data();
        const steps = d && d.growth && d.growth[cycle];
        if (!steps || !steps.length) return null;
        const doy = ((Math.floor(dayOfYear) - 1 - shift) % 120 + 120) % 120 + 1;
        let kind = steps[steps.length - 1][1];
        for (const [from, k] of steps) if (doy >= from) kind = k;
        return kind;
    },

    /**
     * Grow the town's fields to the day (world day number): each field object
     * turns to the stage of its cycle (data/townProps.json growth). A field's
     * cycle is fixed the first time it is seen, from what it was laid out as.
     * Returns how many fields changed.
     */
    growFields(tiles, day) {
        const d = _data();
        if (!d || !d.growth || !tiles) return 0;
        const cycleOf = {};
        for (const [cycle, steps] of Object.entries(d.growth)) for (const [, k] of steps) if (k !== 'plowed') cycleOf[k] = cycle;
        const doy = ((Math.max(1, Math.floor(day || 1)) - 1) % 120) + 1;
        let changed = 0;
        for (const row of tiles) {
            for (const t of row) {
                const obj = t && t.customObject;
                const m = obj && /^tp_field_([a-z_]+)_(\d+)x(\d+)$/.exec(obj.defId || '');
                if (!m) continue;
                if (obj.fieldCycle === undefined) obj.fieldCycle = cycleOf[m[1]] || null;
                if (!obj.fieldCycle) continue;
                const shift = Math.abs((t.q * 73856093) ^ (t.r * 19349663)) % 6;
                // Brought in this year: bare earth till the new year
                const kind = obj.harvestYear === _year(day) ? 'plowed' : TownProps.fieldStage(obj.fieldCycle, doy, shift);
                const id = kind && TownProps.fieldId(kind, m[2], m[3]);
                if (id && id !== obj.defId) { obj.defId = id; changed++; }
            }
        }
        return changed;
    },

    /** 'tp_field_veg_young_4x3' → { kind: 'veg_young', w: 4, h: 3 }, or null. */
    parseFieldId(id) {
        const m = /^tp_field_([a-z_]+)_(\d+)x(\d+)$/.exec(id || '');
        return m ? { kind: m[1], w: Number(m[2]), h: Number(m[3]) } : null;
    },

    /**
     * What a field (its anchor's customObject) has to bring in on a day:
     * { ripe, good, total, left, kind } — ripe only in its cycle's harvest
     * stages (data/townProps.json harvest.crops), and left what nobody has
     * taken this year.
     */
    fieldCrop(obj, day) {
        const d = _data();
        const f = obj && TownProps.parseFieldId(obj.defId);
        const H = d && d.harvest;
        const crop = f && H && obj.fieldCycle && H.crops && H.crops[obj.fieldCycle];
        if (!crop) return { ripe: false, good: null, total: 0, left: 0, kind: f && f.kind };
        const total = Math.max(1, Math.round(f.w * f.h * (Number(crop.perCell) || 0.5)));
        const year = _year(day);
        const taken = obj.fieldTaken && obj.fieldTaken.year === year ? Number(obj.fieldTaken.qty) || 0 : 0;
        const ripe = (crop.stages || []).includes(f.kind) && obj.harvestYear !== year;
        return { ripe, good: crop.good, total, left: ripe ? Math.max(0, total - taken) : 0, kind: f.kind };
    },

    /**
     * Take n of a field's crop (it must be ripe). Taking the last of it
     * leaves the field harvested — plowed — until the new year.
     * Returns how many were taken.
     */
    takeFromField(obj, day, n, tiles = null) {
        const c = TownProps.fieldCrop(obj, day);
        const k = Math.min(c.left, Math.max(0, Math.floor(n)));
        if (k <= 0) return 0;
        const year = _year(day);
        if (!obj.fieldTaken || obj.fieldTaken.year !== year) obj.fieldTaken = { year, qty: 0 };
        obj.fieldTaken.qty += k;
        if (obj.fieldTaken.qty >= c.total) {
            obj.harvestYear = year;
            const f = TownProps.parseFieldId(obj.defId);
            obj.defId = TownProps.fieldId('plowed', f.w, f.h);
        }
        if (tiles) TownProps.growFields(tiles, day);
        return k;
    },

    /**
     * A field's crop carried into the town's granary: it goes into the
     * settlement's food store (settlement.economy.food, which the town eats
     * from, world/economy.js) at harvest.foodPerUnit food a unit. Returns the
     * food added.
     */
    storeHarvest(settlement, good, qty) {
        const econ = settlement && settlement.economy;
        const n = Math.max(0, Number(qty) || 0);
        if (!econ || !n) return 0;
        const H = (_data() || {}).harvest || {};
        const per = H.foodPerUnit && H.foodPerUnit[good] != null ? Number(H.foodPerUnit[good]) : 1;
        const food = n * (Number.isFinite(per) ? per : 1);
        econ.food = (Number(econ.food) || 0) + food;
        return food;
    },

    /** Is this object id a piece of fence (a gate included)? */
    isFence(id) {
        return typeof id === 'string' && id.startsWith('tp_fence_');
    },

    /** Is this object id a gate (shut or open)? */
    isGate(id) {
        return id === GATE_SHUT || id === GATE_OPEN;
    },

    /** Is the gate object open? */
    isGateOpen(obj) {
        return !!obj && obj.defId === GATE_OPEN;
    },

    /**
     * Open or shut the gate at (q, r): the piece drawn and whether the cell
     * can be walked. Returns true when it changed, false when it already was
     * so, null when there is no gate there.
     */
    setGate(tiles, q, r, open) {
        const t = tiles && tiles[r] && tiles[r][q];
        const obj = t && t.customObject;
        if (!obj || !TownProps.isGate(obj.defId)) return null;
        const id = open ? GATE_OPEN : GATE_SHUT;
        const changed = obj.defId !== id;
        obj.defId = id;
        if (t.subTerrain) t.subTerrain.passable = !!open;
        return changed;
    },

    /** Every gate on the map: [{ q, r, open }]. */
    gates(tiles) {
        const out = [];
        for (let r = 0; r < (tiles ? tiles.length : 0); r++) {
            const row = tiles[r];
            for (let q = 0; q < (row ? row.length : 0); q++) {
                const o = row[q] && row[q].customObject;
                if (o && TownProps.isGate(o.defId)) out.push({ q, r, open: o.defId === GATE_OPEN });
            }
        }
        return out;
    },

    /**
     * The gates the player left open on a hex's map, kept on the world (and
     * saved with it): world.gates[hexKey] = { 'q,r': true }. create: make the
     * record when there is none.
     */
    gateRecord(world, hexKey, create = false) {
        if (!world) return null;
        if (!world.gates || typeof world.gates !== 'object') {
            if (!create) return null;
            world.gates = {};
        }
        if (!world.gates[hexKey] && create) world.gates[hexKey] = {};
        return world.gates[hexKey] || null;
    },

    /**
     * Set every gate on the map as the record has it: open where the player
     * left it open, shut everywhere else (a gate stands shut). Returns how
     * many changed.
     */
    applyGates(tiles, record) {
        let changed = 0;
        for (const g of TownProps.gates(tiles)) {
            if (TownProps.setGate(tiles, g.q, g.r, !!(record && record[`${g.q},${g.r}`]))) changed++;
        }
        return changed;
    },

    /**
     * Join every fence on the map to its neighbours: each piece becomes the one
     * whose rails run out to exactly the sides that have fence (or a gate) —
     * corners, T-joins, run ends — and the run pieces either side of a gate
     * carry its gateposts. Changes only which piece is drawn (defId), never
     * what blocks. Returns how many pieces changed.
     */
    joinFences(tiles) {
        const d = _data();
        const join = d && d.fence && d.fence.join;
        if (!join || !tiles || !tiles.length) return 0;
        const H = tiles.length, W = tiles[0].length;
        const objAt = (q, r) => (q >= 0 && r >= 0 && q < W && r < H && tiles[r][q] && tiles[r][q].customObject) || null;
        const fenceAt = (q, r) => { const o = objAt(q, r); return !!o && TownProps.isFence(o.defId); };
        const gateAt = (q, r) => { const o = objAt(q, r); return !!o && TownProps.isGate(o.defId); };
        let changed = 0;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const obj = objAt(q, r);
                if (!obj || !TownProps.isFence(obj.defId) || TownProps.isGate(obj.defId)) continue;
                const mask = (fenceAt(q, r - 1) ? 'n' : '') + (fenceAt(q + 1, r) ? 'e' : '') + (fenceAt(q, r + 1) ? 's' : '') + (fenceAt(q - 1, r) ? 'w' : '');
                let key = mask || 'post';
                if (mask === 'ew' && gateAt(q + 1, r) && join.gateLeft) key = 'gl';
                else if (mask === 'ew' && gateAt(q - 1, r) && join.gateRight) key = 'gr';
                else if (!join.cells[key]) continue;
                const id = `tp_fence_${key}`;
                if (obj.defId !== id) { obj.defId = id; changed++; }
            }
        }
        return changed;
    },

    fieldKinds() {
        const d = _data();
        return d ? Object.keys(d.fields || {}) : [];
    },

    /**
     * Can `def` stand with its anchor (bottom-left) at (q, r)? Every cell it
     * covers must be on the map, off the roads (unless opts.onRoad) and free
     * of buildings, objects and cells the planner reserved.
     */
    fits(tiles, def, q, r, opts = {}) {
        if (!def) return false;
        const H = tiles.length, W = tiles[0].length;
        // Every cell it draws on as well as every cell it blocks (a tree's crown has no meta)
        for (const m of [...(def.meta || []), ...(def.tiles || [])]) {
            const fq = q + m.localCol, fr = r + m.localRow;
            if (fq < 1 || fr < 1 || fq >= W - 1 || fr >= H - 1) return false;
            const t = tiles[fr][fq];
            if (t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t.building) return false;
            if (t._reserved && !opts.ignoreReserved) return false;
            if (t.isRoad && !opts.onRoad) return false;
            if (t.subTerrain && t.subTerrain.id && /water/.test(t.subTerrain.id)) return false;
        }
        return true;
    },

    /** Put `def` down with its anchor at (q, r). Returns false (and changes nothing) when it doesn't fit. */
    place(tiles, def, q, r, opts = {}) {
        if (!TownProps.fits(tiles, def, q, r, opts)) return false;
        tiles[r][q].customObject = { defId: def.id, sheetPath: null, currentHealthPct: 100, planted: true };
        if (def.resource) tiles[r][q].customObject.resource = def.resource;
        const cells = new Map();
        for (const t of def.tiles || []) cells.set(`${t.localCol},${t.localRow}`, { localCol: t.localCol, localRow: t.localRow });
        for (const m of def.meta || []) cells.set(`${m.localCol},${m.localRow}`, m);
        for (const m of cells.values()) {
            const t = tiles[r + m.localRow][q + m.localCol];
            if (m.localCol !== 0 || m.localRow !== 0) t.customObjectPart = { anchorQ: q, anchorR: r };
            // A tilled field keeps the grass under it: its soil is laid over the grass with
            // ragged edges (_fieldSoil, below; ui/tilledSoil.js), so no square of bare dirt shows
            if (def.tilled) t._fieldGreen = true;
            if (m.impassable) t.subTerrain.passable = false;
        }
        if (def.tilled) {
            const H = tiles.length, W = tiles[0].length;
            // A wider green margin (two cells) for the grass layer on bare ground, so its brush has room
            for (let rr = r + def.bounds.minRow - 2; rr <= r + 2; rr++) {
                for (let qq = q + def.bounds.minCol - 2; qq <= q + def.bounds.maxCol + 2; qq++) {
                    const t = rr >= 0 && qq >= 0 && rr < H && qq < W ? tiles[rr][qq] : null;
                    if (t && !t.isRoad && !t._townSoil && !t.customBuilding && !t.customBuildingPart) t._fieldGreen = true;
                }
            }
            // The field's own cells are tilled soil, laid over the grass with ragged edges
            // (ui/tilledSoil.js, drawn by innerMapLayers/terrainRoads.js)
            const { minCol, maxCol, minRow } = def.bounds;
            for (let rr = r + minRow; rr <= r; rr++) {
                for (let qq = q + minCol; qq <= q + maxCol; qq++) {
                    if (rr < 0 || qq < 0 || rr >= H || qq >= W) continue;
                    const t = tiles[rr][qq];
                    if (!t || t.isRoad || t.customBuilding || t.customBuildingPart) continue;
                    t._fieldSoil = true;
                }
            }
        }
        return true;
    },
};
