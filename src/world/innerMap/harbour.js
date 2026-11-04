// InnerMap — the shore, harbours and the ships in them.
//
// A land hex beside the sea or a lake has that water along the side(s) of
// its inner map that face it (world hex neighbours → map edges), with a
// ragged shoreline. A settlement there has a harbour: a wooden pier running
// out into the water (the LPC wood bridge planks) and ships moored by it —
// as many as the place is big, of the kinds its shipwrights know how to build
// (world/shipcraft.js). The player's own ships docked at the hex lie there too.
// At sea (a water hex, aboard your own ship) the map is open water with your
// ship in the middle and you on its deck.
//
// The ships are bluecarrot16's LPC Ship hulls (world/shipHulls.js), drawn as
// objects; placements draw on a hash stream of the hex, not on the map's
// generation RNG.

import { InnerMap } from './_ref.js';
import { CustomObjects, DataLoader, Utils } from './_imports.js';
import { Hex } from '../../core/hex.js';
import { ShipHulls } from '../shipHulls.js';
import { Shipcraft } from '../shipcraft.js';

const WATER_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);
const PIER = { id: 'pier', name: 'Pier', icon: '⚓', color: '#8b6a45', passable: true };
const BRIDGE = 'assets/lpc/Structure/Bridges/Wood Bridge A - No Rails.png';
// Plank cells of the bridge sheet (32px): planks running north-south, and east-west
// (the middle row: the top row has the bridge's rounded end)
const PLANKS_NS = { left: [7, 1], mid: [8, 1], right: [9, 1], left2: [7, 1], mid2: [8, 1], right2: [9, 1] };
const PLANKS_EW = { top: [1, 1], mid: [1, 1], bottom: [1, 1] };

function _rng(a, b, salt) {
    let s = (((a * 73856093) ^ (b * 19349663)) + salt) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const SHIPS_BY_SIZE = { village: 1, town: 2, city: 3, capital: 4 };

Object.assign(InnerMap, {
    /**
     * Which edges of the inner map face water: { E, W, NE, NW, SE, SW: 'sea'|'lake'|null }
     * from the world hex's neighbours (Hex.neighbors order E, NE, NW, W, SW, SE).
     */
    _waterSides(world, q, r) {
        const names = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
        const out = {};
        if (!world || typeof world.getTile !== 'function') return out;
        Hex.neighbors(q, r).forEach((n, i) => {
            const t = world.getTile(n.q, n.r);
            const id = t && t.terrain && t.terrain.id;
            out[names[i]] = id && WATER_IDS.has(id) ? (id === 'lake' ? 'lake' : 'sea') : null;
        });
        return out;
    },

    /**
     * Paint the water along the sides of the map that face it (called by
     * generate() before the objects are scattered). Returns the side the
     * harbour faces ('N'|'S'|'E'|'W') or null when no water is near.
     */
    _paintShore(tiles, worldTile, worldQ, worldR, world) {
        if (!world || !worldTile || !worldTile.terrain || WATER_IDS.has(worldTile.terrain.id)) return null;
        const sides = this._waterSides(world, worldQ, worldR);
        if (!Object.values(sides).some(Boolean)) return null;
        const H = tiles.length, W = tiles[0].length;
        const rng = _rng(worldQ, worldR, 6113);
        const phase = rng() * 10;
        const wobble = (x) => Math.sin(x * 0.11 + phase) * 3 + Math.sin(x * 0.27 + phase * 2) * 1.5;
        const depthOf = (kind) => (kind === 'lake' ? 20 : 30);
        const mask = Array.from({ length: H }, () => Array(W).fill(false));
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        // The town keeps a strip of land: water stops short of any building, lot or town street
        const BUF = 2;
        const townish = (t) => !!(t && (t.building || t.customBuilding || t.customBuildingPart || t._townCore || t._lot));
        const blocked = (q, r) => {
            if (Math.abs(q - cq) < 12 && Math.abs(r - cr) < 12) return true; // where the player comes in
            for (let dr = -BUF; dr <= BUF; dr++) {
                for (let dq = -BUF; dq <= BUF; dq++) {
                    const y = r + dr, x = q + dq;
                    if (y >= 0 && y < H && x >= 0 && x < W && townish(tiles[y][x])) return true;
                }
            }
            return false;
        };
        // Water comes in from the map's edge along each row or column, up to
        // the side's depth (a ragged shore), and stops at the first thing it
        // mustn't cover — so it never runs round a house and strands it on an islet
        const fromEdge = (cells) => {
            for (const [q, r] of cells) {
                if (blocked(q, r)) break;
                mask[r][q] = true;
            }
        };
        const inRange = (lo, hi, v) => v >= lo && v <= hi;
        // east and west: rows
        for (let r = 0; r < H; r++) {
            if (sides.E) {
                const d = depthOf(sides.E) + wobble(r);
                const cells = [];
                for (let q = W - 1; q > W - d && q >= 0; q--) cells.push([q, r]);
                fromEdge(cells);
            }
            if (sides.W) {
                const d = depthOf(sides.W) + wobble(r);
                const cells = [];
                for (let q = 0; q < d && q < W; q++) cells.push([q, r]);
                fromEdge(cells);
            }
        }
        // north and south: columns (a north-east or north-west sea covers that part of the top)
        for (let q = 0; q < W; q++) {
            const top = (sides.NE && inRange(W * 0.35, W, q)) || (sides.NW && inRange(0, W * 0.65, q));
            const bottom = (sides.SE && inRange(W * 0.35, W, q)) || (sides.SW && inRange(0, W * 0.65, q));
            const topKind = sides.NE || sides.NW;
            const bottomKind = sides.SE || sides.SW;
            if (top) {
                const d = depthOf(topKind) + wobble(q);
                const cells = [];
                for (let r = 0; r < d && r < H; r++) cells.push([q, r]);
                fromEdge(cells);
            }
            if (bottom) {
                const d = depthOf(bottomKind) + wobble(q);
                const cells = [];
                for (let r = H - 1; r > H - d && r >= 0; r--) cells.push([q, r]);
                fromEdge(cells);
            }
        }
        // (a lake's shore is lake water; the sea's, sea)
        const lakeOnly = Object.values(sides).every(k => !k || k === 'lake');
        this._fillWater(tiles, mask, worldTile.terrain.id, lakeOnly ? 'lake' : 'sea');
        // A road that ran on to the map's edge now ends at the shore
        const layout = tiles._settlementLayout;
        if (layout && Array.isArray(layout.roadTiles)) layout.roadTiles = layout.roadTiles.filter(p => !(tiles[p.r] && tiles[p.r][p.q] && tiles[p.r][p.q]._wet));
        // The side the harbour faces: the deepest water
        const score = { S: (sides.SE ? 1 : 0) + (sides.SW ? 1 : 0), N: (sides.NE ? 1 : 0) + (sides.NW ? 1 : 0), E: sides.E ? 1.5 : 0, W: sides.W ? 1.5 : 0 };
        const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
        return best && best[1] > 0 ? best[0] : null;
    },

    /**
     * Water over every masked cell (world/innerMap/water.js stamps all the
     * map's water at once: the shore brush's edges, open water inside, deep
     * water further out). `kind` is 'sea' or 'lake'.
     */
    _fillWater(tiles, mask, terrainId, kind = 'sea') {
        this._erodeUntileableStubs(mask);
        const cells = [];
        for (let r = 0; r < mask.length; r++) for (let q = 0; q < mask[r].length; q++) if (mask[r][q]) cells.push([q, r]);
        this._markWet(tiles, cells, kind);
        this._stampWater(tiles);
    },

    _isOpenWater(t) {
        return !!(t && t._sea && t.subTerrain && t.subTerrain.passable === false && !t.customObject && !t.customObjectPart && !t._pier);
    },

    /**
     * A pier from the shore out into the water on the harbour side. Returns
     * { cells, tip, side } or null.
     */
    _layPier(tiles, side, worldQ, worldR) {
        if (!side) return null;
        const H = tiles.length, W = tiles[0].length;
        const rng = _rng(worldQ, worldR, 7207);
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const dir = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[side];
        const along = side === 'N' || side === 'S';
        const off = Math.round((rng() - 0.5) * 16);
        // Walk from the middle toward the water to find the shore
        let q = along ? cq + off : cq, r = along ? cr : cr + off;
        let steps = 0;
        while (q > 1 && r > 1 && q < W - 2 && r < H - 2 && !tiles[r][q]._sea && steps < 80) { q += dir[0]; r += dir[1]; steps++; }
        if (!tiles[r] || !tiles[r][q] || !tiles[r][q]._sea) return null;
        // back onto the last dry cell, then out over the water
        q -= dir[0] * 2; r -= dir[1] * 2;
        let length = 12 + Math.floor(rng() * 6);
        // (the tip stays a few cells inside the map)
        while (length > 4) {
            const tq = q + dir[0] * (length - 1), tr = r + dir[1] * (length - 1);
            if (tq >= 4 && tr >= 4 && tq < W - 4 && tr < H - 4) break;
            length--;
        }
        const cells = [];
        for (let i = 0; i < length; i++) {
            const pq = q + dir[0] * i, pr = r + dir[1] * i;
            for (let w = -1; w <= 1; w++) {
                const x = along ? pq + w : pq, y = along ? pr : pr + w;
                const t = tiles[y] && tiles[y][x];
                if (!t) continue;
                const cell = along
                    ? (w < 0 ? (i % 2 ? PLANKS_NS.left2 : PLANKS_NS.left) : w > 0 ? (i % 2 ? PLANKS_NS.right2 : PLANKS_NS.right) : (i % 2 ? PLANKS_NS.mid2 : PLANKS_NS.mid))
                    : (w < 0 ? PLANKS_EW.top : w > 0 ? PLANKS_EW.bottom : PLANKS_EW.mid);
                t.paving = { sheetPath: BRIDGE, sx: cell[0] * 32, sy: cell[1] * 32 };
                t.terrainDetail = null; // (no grass or shore drawn over the planks)
                t.subTerrain = { ...PIER };
                t._pier = true;
                // (an object the pier runs through goes whole, not cut in two)
                if ((t.customObject || t.customObjectPart) && this._clearWholeObject) this._clearWholeObject(tiles, x, y);
                t.customObject = null;
                t.customObjectPart = null;
                cells.push({ q: x, r: y });
            }
        }
        const tip = { q: q + dir[0] * (length - 1), r: r + dir[1] * (length - 1) };
        return { cells, tip, side, along };
    },

    /** Can this hull lie with its anchor at (q, r)? Its hull all on open water, a cell clear round it. */
    _shipFits(tiles, def, q, r) {
        const H = tiles.length, W = tiles[0].length;
        for (const m of ShipHulls.footprint(def)) {
            const x = q + m.localCol, y = r + m.localRow;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
            if (!this._isOpenWater(tiles[y][x])) return false;
        }
        // everything it draws must stay on the map
        for (const t of def.tiles) {
            const x = q + t.localCol, y = r + t.localRow;
            if (x < 0 || y < 0 || x >= W || y >= H) return false;
        }
        return true;
    },

    /** Moor a hull with its anchor at (q, r) (the caller checked _shipFits) */
    _moorShip(tiles, def, q, r, extra = {}) {
        // (the living water works its shore out again: ui/innerMapLayers/waterFx.js)
        this._waterStamp = (this._waterStamp || 0) + 1;
        tiles[r][q].customObject = { defId: def.id, sheetPath: null, currentHealthPct: 100, planted: true, ...extra };
        for (const m of ShipHulls.footprint(def)) {
            const t = tiles[r + m.localRow][q + m.localCol];
            if (m.localCol !== 0 || m.localRow !== 0) t.customObjectPart = { anchorQ: q, anchorR: r };
        }
        return { q, r, id: def.id };
    },

    /** Find a berth for a hull near (q, r): the nearest spot it fits, searching outward */
    _berth(tiles, def, near, maxRadius = 45) {
        for (let rad = 2; rad <= maxRadius; rad += 2) {
            for (let dr = -rad; dr <= rad; dr += 2) {
                for (let dq = -rad; dq <= rad; dq += 2) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const q = near.q + dq, r = near.r + dr;
                    if (this._shipFits(tiles, def, q, r)) return { q, r };
                }
            }
        }
        return null;
    },

    /**
     * The harbour of a settlement on the water: a pier and the town's ships
     * (generation; hash-placed). Records the pier tip on the map for the
     * player's own ships later.
     */
    _layHarbour(tiles, worldTile, worldQ, worldR, world) {
        const side = this._paintShore(tiles, worldTile, worldQ, worldR, world);
        if (!side) return null;
        const s = worldTile.settlement;
        if (!s) return { side };
        const pier = this._layPier(tiles, side, worldQ, worldR);
        if (!pier) return { side };
        tiles[pier.tip.r][pier.tip.q]._pierTip = side;
        // The town's own ships: as many as it is big, of the kinds its shipwrights build
        const craft = new Set(Shipcraft.townKnows(world, s));
        // a hull the town keeps if its shipwrights can build any ship type it stands for
        // (a rowboat is no sailing ship: the skiff stands for the fishing vessel here)
        const canHull = (hullId) => ShipHulls.typesFor(hullId).filter(t => t !== 'rowboat').some(t => {
            const st = this._shipType(t);
            const req = st && Array.isArray(st.requires) ? st.requires : ['shipbuilding'];
            return req.every(x => craft.has(x));
        });
        const hulls = ShipHulls.ids().filter(canHull);
        if (!hulls.length) return { side, pier };
        const rng = _rng(worldQ, worldR, 8311);
        const n = SHIPS_BY_SIZE[s.type] || 1;
        const placed = [];
        for (let i = 0; i < n; i++) {
            // bigger ports keep bigger ships
            const pick = hulls[Math.min(hulls.length - 1, Math.floor(rng() * Math.min(hulls.length, 1 + i + (s.type === 'capital' ? 2 : s.type === 'city' ? 1 : 0))))];
            const def = CustomObjects.getDef(pick);
            if (!def) continue;
            const at = this._berth(tiles, def, pier.tip);
            if (at) placed.push(this._moorShip(tiles, def, at.q, at.r, { harbour: true }));
        }
        return { side, pier, placed };
    },

    /** The ship type definition (data/ships.json), for what a hull needs */
    _shipType(typeId) {
        const g = DataLoader._gamedata;
        const types = g && g.ships && g.ships.shipTypes;
        return Array.isArray(types) ? types.find(t => t.id === typeId) || null : null;
    },

    /** The player's ships docked at this hex, moored at the pier (on enter; earlier ones are cleared) */
    _mooringPlayerShips(game) {
        const tiles = this.tiles;
        const player = game && game.player;
        if (!tiles || !player || !this.currentWorldTile) return [];
        // Clear any of the player's ships moored on an earlier visit
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[r].length; q++) {
                const o = tiles[r][q].customObject;
                if (o && o.playerShip) this._unmoor(tiles, q, r);
            }
        }
        const { q: wq, r: wr } = this.currentWorldTile;
        const ships = (player.ships || []).filter(s => s && s.q === wq && s.r === wr && s.status !== 'sunk');
        if (!ships.length) return [];
        let tip = null;
        for (let r = 0; r < tiles.length && !tip; r++) for (let q = 0; q < tiles[r].length; q++) if (tiles[r][q]._pierTip) { tip = { q, r }; break; }
        if (!tip) {
            // no pier: the nearest open water to the middle
            const c = { q: Math.floor(tiles[0].length / 2), r: Math.floor(tiles.length / 2) };
            tip = c;
        }
        const out = [];
        for (const s of ships) {
            const def = CustomObjects.getDef(ShipHulls.hullFor(s.typeId) || 'hull_sloop');
            if (!def) continue;
            const at = this._berth(tiles, def, tip, 55);
            if (at) out.push(this._moorShip(tiles, def, at.q, at.r, { playerShip: s.id, label: s.name }));
        }
        return out;
    },

    _unmoor(tiles, q, r) {
        this._waterStamp = (this._waterStamp || 0) + 1;
        const o = tiles[r][q].customObject;
        const def = o && CustomObjects.getDef(o.defId);
        tiles[r][q].customObject = null;
        for (const m of ShipHulls.footprint(def)) {
            const t = tiles[r + m.localRow] && tiles[r + m.localRow][q + m.localCol];
            if (t && t.customObjectPart && t.customObjectPart.anchorQ === q && t.customObjectPart.anchorR === r) t.customObjectPart = null;
        }
    },

    /**
     * At sea, aboard your own ship: open water all round, your ship in the
     * middle and you on its deck (the deck is walkable). Called by enter()
     * on a water hex. Returns the ship placed, or null.
     */
    _layOpenSea(game, tiles, worldTile) {
        const player = game && game.player;
        const H = tiles.length, W = tiles[0].length;
        // On a lake its shores lie along the sides that face land (world/innerMap/water.js)
        const onLake = !!(worldTile.terrain && worldTile.terrain.id === 'lake' && this._lakeMask);
        const mask = onLake ? this._lakeMask(tiles, worldTile, game && game.world) : Array.from({ length: H }, () => Array(W).fill(true));
        this._fillWater(tiles, mask, worldTile.terrain ? worldTile.terrain.id : 'ocean', onLake ? 'lake' : 'sea');
        const shipId = player && player.boardedShip;
        const ship = shipId && (player.ships || []).find(s => s && s.id === shipId);
        const def = CustomObjects.getDef(ShipHulls.hullFor(ship ? ship.typeId : 'sloop') || 'hull_sloop');
        if (!def) return null;
        // the deck's middle at the map's middle, where the player stands
        const deck = def.meta.filter(m => m.hull);
        const midCol = Math.round(deck.reduce((a, m) => a + m.localCol, 0) / deck.length);
        const midRow = Math.round(deck.reduce((a, m) => a + m.localRow, 0) / deck.length);
        const q = Math.floor(W / 2) - midCol, r = Math.floor(H / 2) - midRow;
        if (!this._shipFits(tiles, def, q, r)) return null;
        this._moorShip(tiles, def, q, r, { playerShip: ship ? ship.id : null, label: ship ? ship.name : null, aboard: true });
        // You walk the deck
        for (const m of deck) {
            const t = tiles[r + m.localRow][q + m.localCol];
            t.subTerrain = { ...PIER, id: 'deck', name: 'Deck' };
            t._deck = true;
            t._deep = false; // (the water under the hull isn't the deep you'd drown in)
        }
        return { q, r, id: def.id };
    },
});

// ── A ship struck down: her wreck breaks up into salvage ──
Object.assign(InnerMap, {
    wreckConfig() {
        const g = DataLoader._gamedata;
        return (g && g.wrecks) || { spread: 2, pieces: {}, loot: [], crateGoods: ['fish'], maxCargoCrates: 4 };
    },

    /**
     * Scatter a struck hull's salvage on the water where she lay (the wreck
     * movement.js _removeCustomObject left: { anchorQ, anchorR, defId }).
     * Each piece is a ground item a swimmer (or someone wading the shallows)
     * picks up: planks, rope, sailcloth, iron fittings, crates (her hold's
     * goods when `cargo` is given, else a trader's stores), now and then a
     * strongbox of gold. → the pieces placed, [{ q, r, item }].
     */
    scatterWreck(wreck, { cargo = null } = {}) {
        if (!wreck || !this.tiles) return [];
        const C = this.wreckConfig();
        const def = CustomObjects.getDef(wreck.defId);
        const foot = def ? ShipHulls.footprint(def) : [];
        const H = this.tiles.length, W = this.tiles[0].length;
        const spread = Math.max(0, C.spread | 0);
        // Where she lay, and the water round her
        const cells = [];
        const seen = new Set();
        const consider = (q, r, near) => {
            const k = `${q},${r}`;
            if (seen.has(k) || q < 0 || r < 0 || q >= W || r >= H) return;
            seen.add(k);
            const t = this.tiles[r][q];
            if (!t || t.groundItem || t.customObject || t.customObjectPart || t.building || t._pier || t._deck) return;
            const water = t._wet || t._sea || /_water$/.test((t.subTerrain && t.subTerrain.id) || '');
            if (!water) return;
            cells.push({ q, r, near });
        };
        for (const m of foot) consider(wreck.anchorQ + m.localCol, wreck.anchorR + m.localRow, true);
        for (const m of foot) {
            for (let dr = -spread; dr <= spread; dr++) {
                for (let dq = -spread; dq <= spread; dq++) consider(wreck.anchorQ + m.localCol + dq, wreck.anchorR + m.localRow + dr, false);
            }
        }
        if (!cells.length) return [];
        // Mostly where she went down, a few drifted off
        const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Utils.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
        const pick = shuffle(cells.filter(c => c.near)).concat(shuffle(cells.filter(c => !c.near)));
        const range = C.pieces[wreck.defId] || [4, 6];
        const n = Math.min(pick.length, Utils.randInt(range[0], range[1]));
        // Her hold, crate by crate
        const goods = DataLoader._gamedata && DataLoader._gamedata.playerEconomy ? DataLoader._gamedata.playerEconomy.GOODS || {} : {};
        const goodOf = id => goods[String(id).toUpperCase()] || null;
        const hold = Object.entries(cargo || {}).filter(([id, q]) => q > 0 && goodOf(id));
        const crates = hold.slice(0, Math.max(0, C.maxCargoCrates | 0));
        const loot = (C.loot || []).filter(l => !l.hulls || l.hulls.includes(wreck.defId));
        const total = loot.reduce((s, l) => s + (l.weight || 1), 0);
        const out = [];
        for (let i = 0; i < n; i++) {
            const at = pick[i];
            let item;
            if (i < crates.length) {
                // A crate from her hold: a share of what she carried
                const [id, qty] = crates[i];
                const g = goodOf(id);
                item = { itemId: id, quantity: Math.max(1, Math.round(qty)), name: g.name, icon: g.icon, kind: 'crate' };
            } else {
                let roll = Utils.random() * total;
                let l = loot[loot.length - 1];
                for (const x of loot) { roll -= x.weight || 1; if (roll <= 0) { l = x; break; } }
                if (l.kind === 'chest') {
                    const gold = Utils.randInt(l.gold[0], l.gold[1]);
                    item = { itemId: 'gold', quantity: 1, gold, name: `Strongbox (${gold} gold)`, icon: '💰', kind: 'chest' };
                } else {
                    const id = l.itemId || Utils.randPick(C.crateGoods || ['fish']);
                    const g = goodOf(id) || { name: id, icon: '📦' };
                    const q = Array.isArray(l.qty) ? Utils.randInt(l.qty[0], l.qty[1]) : 1;
                    item = { itemId: id, quantity: q, name: l.name || g.name, icon: g.icon, kind: l.kind };
                }
            }
            const t = this.tiles[at.r][at.q];
            t.groundItem = {
                itemId: item.itemId, quantity: item.quantity, name: item.quantity > 1 && item.kind !== 'chest' ? `${item.name} ×${item.quantity}` : item.name,
                icon: item.icon, placedBy: 'wreck', gold: item.gold || 0,
                salvage: { kind: item.kind, frame: Utils.randInt(0, 9), phase: Utils.random() * Math.PI * 2 },
            };
            out.push({ q: at.q, r: at.r, item: t.groundItem });
        }
        return out;
    },
});
