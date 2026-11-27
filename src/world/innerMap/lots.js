// ============================================
// InnerMap — building lots and vacant houses on the town map
// ============================================
// The planner (world/townPlanner.js) sets lots aside along the streets; each
// tile of one carries _lot = its id. Whose each lot is lives in the town's lot
// book (world/lotBook.js, on the settlement). On entering a town:
//
//   - a lot an AI holder has built on (its readyDay come) gets its building,
//     stood within the lot's bounds with its door on the street;
//   - a few of the town's houses stand vacant (data/lots.json → vacant), for
//     rent or sale — kept out of the residents' hands — unless the book says
//     someone has taken one;
//   - lot buildings and taken houses show their holder.
//
// The dealings (buying, renting, rent day, the AI's purchases) are
// systems/lots.js; the menu ui/innerMapLots.js.

import { InnerMap } from './_ref.js';
import { CustomBuildings, CustomObjects, SettlementWealth } from './_imports.js';
import { LotBook } from '../lotBook.js';

function _hash(q, r, salt) {
    let h = (q * 73856093) ^ (r * 19349663) ^ (salt * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i++) h = Math.imul(h ^ String(s).charCodeAt(i), 16777619);
    return h >>> 0;
}

Object.assign(InnerMap, {
    /** The town's lots: [{ id, q0, q1, r0, r1, w, h }] (rebuilt from the tiles' _lot marks if need be). */
    townLots() {
        const tiles = this._outerMapState && this._insideBuilding ? this._outerMapState.tiles : this.tiles;
        if (!tiles) return [];
        if (Array.isArray(tiles._lots)) return tiles._lots;
        const by = new Map();
        for (const row of tiles) for (const t of row) {
            if (!t || !t._lot) continue;
            const l = by.get(t._lot) || { id: t._lot, q0: t.q, q1: t.q, r0: t.r, r1: t.r };
            l.q0 = Math.min(l.q0, t.q); l.q1 = Math.max(l.q1, t.q); l.r0 = Math.min(l.r0, t.r); l.r1 = Math.max(l.r1, t.r);
            by.set(t._lot, l);
        }
        const list = [...by.values()].map(l => ({ ...l, w: l.q1 - l.q0 + 1, h: l.r1 - l.r0 + 1 }));
        tiles._lots = list;
        return list;
    },

    /** The settlement on this map. */
    _lotSettlement() {
        const wt = this._currentWorldTileRef || null;
        return (wt && wt.settlement) || null;
    },

    /**
     * The lot a tile lies in, with its state, or null.
     * @returns {{ lot, rec, price, forSale, mine } | null}
     */
    lotAt(q, r) {
        const t = this.getTile(q, r);
        if (!t || !t._lot || this._insideBuilding) return null;
        const lot = this.townLots().find(l => l.id === t._lot);
        if (!lot) return null;
        const s = this._lotSettlement();
        const rec = LotBook.lot(s, lot.id);
        return { lot, rec, price: LotBook.lotPrice(s && s.type, lot.w, lot.h), forSale: !rec, mine: LotBook.isPlayer(rec) };
    },

    /** Where a player's property on a lot stands: the lot's middle (a 3×3 footprint fits every lot). */
    lotBuildSpot(lot) {
        return { q: Math.floor((lot.q0 + lot.q1) / 2), r: Math.floor((lot.r0 + lot.r1) / 2) };
    },

    // ──────────── ON ENTERING (interiors.enter) ────────────

    /** Stand up the buildings AI holders (and the player's houses to let) have finished on their lots. */
    _raiseLotBuildings(settlement, day) {
        const book = settlement && settlement.lotBook;
        if (!book || !book.lots || typeof CustomBuildings === 'undefined' || !CustomBuildings.isLoaded || !CustomBuildings.isLoaded()) return;
        for (const lot of this.townLots()) {
            const rec = book.lots[lot.id];
            const b = rec && rec.built;
            // A newcomer's house going up (systems/arrivalCamps.js): a building site, course by course, till its day
            // (waiting on its timber: the bare lot)
            if (b && b.kind === 'settler') {
                if (b.wait || b.readyDay == null) continue;
                const span = Math.max(1, _num(b.readyDay) - _num(b.start, _num(b.readyDay) - 1));
                const p = day >= b.readyDay ? null : Math.max(0.02, Math.min(0.99, (day - _num(b.start, day)) / span));
                const at = this._lotAnchor(lot);
                if (at) {
                    const cb = this.tiles[at.r][at.q].customBuilding;
                    if (p == null) delete cb.siteP; else cb.siteP = p;
                    continue;
                }
                if (this._lotHasBuilding(lot)) continue;
                const put = this._standOnLot(lot, 'house', _strHash(`${settlement.foundingName || settlement.name}|${lot.id}|house`), settlement);
                if (put && p != null) this.tiles[put.r][put.q].customBuilding.siteP = p;
                continue;
            }
            // (a property the player built stands as that property; a house they raised to let stands like the AI's)
            if (!b || (b.by === 'player' && b.kind !== 'house') || (b.readyDay != null && day < b.readyDay)) continue;
            if (this._lotHasBuilding(lot)) continue;
            // (a tenement or row houses rise taller than the lot is deep: they may reach back
            // onto the open ground behind it — world/townHousing.js, data/townHousing.json)
            const tall = b.type === 'tenement' || b.type === 'rowhouse';
            const seed = _strHash(`${settlement.foundingName || settlement.name}|${lot.id}|${b.type}`);
            // (no room behind it for a tenement's storeys: row houses, then a house)
            // (only their ground storey needs the ground: the storeys and roof above it overhang the yards,
            // paths and back gardens behind, walked under — world/customBuildings.js footprintOf)
            if (tall && this._standOnLot(lot, b.type, seed, settlement, { overhang: 12, exact: true })) continue;
            if (b.type === 'tenement' && this._standOnLot(lot, 'rowhouse', seed, settlement, { overhang: 8, exact: true })) continue;
            // (...else the plainest town house that fits, not the culture's hut: it is a house of rooms)
            if (tall && this._standOnLot(lot, 'house', seed, settlement, { common: true })) continue;
            this._standOnLot(lot, b.type || 'house', seed, settlement);
        }
    },

    _lotHasBuilding(lot) {
        for (let r = lot.r0; r <= lot.r1; r++) for (let q = lot.q0; q <= lot.q1; q++) {
            const t = this.tiles[r] && this.tiles[r][q];
            // (another's upper storeys reaching over the lot's back are no building on it)
            if (t && (t.customBuilding || (t.customBuildingPart && !t.customBuildingPart.over))) return true;
        }
        return false;
    },

    /**
     * A design of this type that fits the lot, stood with its door on the lot's front row.
     * A type with no design that fits falls back to a house, unless opts.exact.
     * → { q, r, defId } (its anchor), or false.
     */
    _standOnLot(lot, type, seed, settlement = null, opts = {}) {
        const noHouse = type === 'house' || !!opts.exact;
        // A town that builds by its culture (tiles._townBuild, world/innerMap/terrain.js) builds its
        // own designs first, in the tier the town's wealth allows today (world/settlementWealth.js):
        // a house put up now is built as the town now is, whatever its older houses are
        const tb = this.tiles && this.tiles._townBuild;
        const own = !opts.common && tb && tb.culture && settlement && typeof CustomBuildings.getByCulture === 'function'
            ? [...CustomBuildings.getByCulture(tb.culture, type), ...(noHouse ? [] : CustomBuildings.getByCulture(tb.culture, 'house'))] : [];
        let tier = own.length ? SettlementWealth.buildingTier(SettlementWealth.score(settlement), { ring: 'mid', key: `lot:${lot.id}` }) : null;
        // (in its era's style: no grander than the age's builders raise, world/townEras.js)
        const T3 = ['poor', 'mid', 'rich'];
        if (tier && tb.eraCap && T3.indexOf(tb.eraCap) >= 0) tier = T3[Math.min(T3.indexOf(tier), T3.indexOf(tb.eraCap))];
        const usable = arr => arr.filter(d => d && d.meta && d.bounds && d.style !== 'farmstead');
        const turn = arr => arr.map((_, i) => arr[(seed + i) % arr.length]);
        const ownDefs = usable(own.map(d => CustomBuildings.tierVariant(d, tier)));
        const common = usable((CustomBuildings.getByType(type) || []).concat(noHouse ? [] : CustomBuildings.getByType('house') || []))
            // (opts.common: the kit's own town houses only, no culture's hut or hovel)
            .filter(d => !opts.common || (!d.culture && d.style !== 'hovel' && d.style !== 'croft'));
        // (the culture's own first, each list turned by the lot's seed)
        const defs = [...turn(ownDefs), ...turn(common)];
        if (!defs.length) return false;
        for (let i = 0; i < defs.length; i++) {
            const def = defs[i];
            const bw = def.bounds.maxCol - def.bounds.minCol + 1;
            const bh = def.bounds.maxRow - def.bounds.minRow + 1;
            // (opts.overhang: a taller design may reach that many rows past the lot's back, the side
            // away from its street, onto open ground: up for a lot north of its street, down for one south)
            const over = Math.max(0, Math.floor(Number(opts.overhang) || 0));
            if (bw > lot.w || bh > lot.h + over || def.bounds.maxRow > 0) continue;
            const door = (def.meta || []).find(m => m.door) || { q: 0, r: 0 };
            // Centre it on the lot, the anchor's row the lot's front
            const left = lot.q0 + Math.floor((lot.w - bw) / 2);
            const q = left - def.bounds.minCol;
            const down = bh > lot.h && lot.gate === 'north';
            const r = down ? lot.r0 - def.bounds.minRow : lot.r1 - def.bounds.maxRow;
            if (q + door.q < lot.q0 || q + door.q > lot.q1) continue;
            const top = Math.min(lot.r0, r + def.bounds.minRow), bottom = Math.max(lot.r1, r + def.bounds.maxRow);
            const fits = (def.meta || []).every(m => {
                const fq = q + m.q, fr = r + m.r;
                return fq >= lot.q0 && fq <= lot.q1 && fr >= top && fr <= bottom;
            });
            if (!fits) continue;
            // Reaching past the lot: its ground storey wants open ground (a bush or a tree in the way is
            // grubbed up, not a reason to build a cottage), the storeys and roof above only somewhere to
            // hang over — a yard, a path, grass, another lot's back garden; never water, a wall or another's
            // ground floor (_overNearLot). A tree under them comes down; a fence or a bench stays, behind.
            if ((top < lot.r0 || bottom > lot.r1) && !this._reachOk(lot, def, q, r)) continue;
            if (top < lot.r0) this._clearFlora(q + def.bounds.minCol, q + def.bounds.maxCol, top, lot.r0 - 1);
            if (bottom > lot.r1) this._clearFlora(q + def.bounds.minCol, q + def.bounds.maxCol, lot.r1 + 1, bottom + 1);
            this.tiles[r][q].customBuilding = { defId: def.id, lotId: lot.id };
            for (const m of def.meta || []) {
                const t = this.tiles[r + m.r][q + m.q];
                // (over another's upper storeys, theirs it stays: the nearer is drawn over the farther)
                if (m.walkBehind && t.customBuildingPart) continue;
                if (m.q !== 0 || m.r !== 0) t.customBuildingPart = m.walkBehind ? { anchorQ: q, anchorR: r, over: true } : { anchorQ: q, anchorR: r };
                if (m.door) {
                    t._doorMarker = { anchorQ: q, anchorR: r, defId: def.id };
                    t.subTerrain.passable = true;
                } else if (m.impassable) {
                    t.subTerrain.passable = false;
                }
            }
            return { q, r, defId: def.id };
        }
        return false;
    },

    /**
     * May a design anchored at (q, r) on the lot reach past it? Each of its cells beyond the lot:
     * a footprint cell (and, south of the lot, the step before its front) on open ground
     * (_openNearLot); a walked-behind cell over ground it may hang over (_overNearLot).
     */
    _reachOk(lot, def, q, r) {
        for (const m of def.meta || []) {
            const fq = q + m.q, fr = r + m.r;
            if (fr >= lot.r0 && fr <= lot.r1) continue;
            if (m.walkBehind) {
                if (!this._overNearLot(lot, fq, fr)) return false;
                continue;
            }
            if (!this._openNearLot(lot, fq, fq, fr, fr, true)) return false;
            if (fr > lot.r1 && m.r === def.bounds.maxRow && !this._openNearLot(lot, fq, fq, fr + 1, fr + 1, true)) return false;
        }
        return true;
    },

    /** Can a building's upper storeys hang over (q, r), beyond the lot? Not water, a wall, the map's edge, a crag or another's ground floor. */
    _overNearLot(lot, q, r) {
        const t = this.tiles[r] && this.tiles[r][q];
        if (!t || r < 1 || r >= this.tiles.length - 1 || q < 1 || q >= this.tiles[0].length - 1) return false;
        if (t._wet || t._sea || t._townWall || t.building || t.customBuilding || t._cragTop !== undefined) return false;
        if (t.customBuildingPart && !t.customBuildingPart.over) return false;
        // (a fence, a cart, a bench under it stays, drawn behind; bare blocked ground — a rock face — does not go under a roof)
        if (t.subTerrain && t.subTerrain.passable === false && !t.customObject && !t.customObjectPart) return false;
        return true;
    },

    /** Is the ground beyond a lot (rows r0..r1, columns q0..q1) open for a building to reach onto? */
    _openNearLot(lot, q0, q1, r0, r1, floraOk = false) {
        for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
            const t = this.tiles[r] && this.tiles[r][q];
            if (!t || r < 1 || r >= this.tiles.length - 1 || t.isRoad || t.building || t.customBuilding || t.customBuildingPart
                || t._wet || (t._lot && t._lot !== lot.id)) return false;
            if (t.customObject || t.customObjectPart) {
                if (floraOk && this._floraAnchor(t)) continue;
                return false;
            }
            if (t.subTerrain && t.subTerrain.passable === false) return false;
        }
        return true;
    },

    /** The anchor tile of a bush or tree (a town prop or the scatter's) on t, or null — never a memorial, field or fence. */
    _floraAnchor(t) {
        const p = t && t.customObjectPart;
        const a = p ? this.tiles[p.anchorR] && this.tiles[p.anchorR][p.anchorQ] : t;
        const o = a && a.customObject;
        if (!o || o.memory) return null;
        const d = CustomObjects.getDef(o.defId);
        if (!d) return null;
        const tags = d.tags || [];
        if (tags.some(x => x === 'field' || x === 'fence' || x === 'gate' || x === 'memory' || x === 'grave')) return null;
        return d.objectType === 'tree' || d.objectType === 'plant' || tags.includes('tree') || tags.includes('bush') ? a : null;
    },

    /** Grub up the bushes and trees on rows r0..r1, columns q0..q1 (whole, every part), the ground left open. */
    _clearFlora(q0, q1, r0, r1) {
        const H = this.tiles.length, W = H ? this.tiles[0].length : 0;
        const done = new Set();
        for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
            const t = this.tiles[r] && this.tiles[r][q];
            const a = t && (t.customObject || t.customObjectPart) ? this._floraAnchor(t) : null;
            if (!a || done.has(a)) continue;
            done.add(a);
            const aq = a.q != null ? a.q : (t.customObjectPart ? t.customObjectPart.anchorQ : q);
            const ar = a.r != null ? a.r : (t.customObjectPart ? t.customObjectPart.anchorR : r);
            a.customObject = null;
            if (a.subTerrain && !a._wet) a.subTerrain.passable = true;
            for (let y = Math.max(0, ar - 8); y <= Math.min(H - 1, ar + 2); y++) for (let x = Math.max(0, aq - 4); x <= Math.min(W - 1, aq + 4); x++) {
                const c = this.tiles[y][x];
                const cp = c.customObjectPart;
                if (cp && cp.anchorQ === aq && cp.anchorR === ar) {
                    c.customObjectPart = null;
                    if (c.subTerrain && !c._wet) c.subTerrain.passable = true;
                }
            }
        }
    },

    // ──────────── THE PLAYER'S PROPERTIES ON THEIR LOTS ────────────

    /** The anchor of the building standing on a lot, or null. */
    _lotAnchor(lot) {
        for (let r = lot.r0; r <= lot.r1; r++) for (let q = lot.q0; q <= lot.q1; q++) {
            const t = this.tiles[r] && this.tiles[r][q];
            if (t && t.customBuilding && t.customBuilding.lotId === lot.id) return { q, r, defId: t.customBuilding.defId };
        }
        return null;
    },

    /** An older map's whole-sprite property pasted at (innerQ, innerR): taken away again. */
    _clearPastedProperty(p) {
        const t = this.tiles[p.innerR] && this.tiles[p.innerR][p.innerQ];
        if (!t || !t.building || t._buildingTypeHint !== 'player_property') return;
        delete t.building; delete t._buildingTypeHint; delete t._propertyRef; delete t.buildingInfo;
        for (let dq = -1; dq <= 1; dq++) for (let dr = -2; dr <= 0; dr++) {
            const f = this.tiles[p.innerR + dr] && this.tiles[p.innerR + dr][p.innerQ + dq];
            if (f && f.subTerrain && !f._wet && !f.building && !f.customBuilding && !f.customBuildingPart && !f.customObject && !f.customObjectPart) f.subTerrain.passable = true;
        }
        this.buildings = (this.buildings || []).filter(b => !(b && b.propertyRef === p));
    },

    /**
     * The player's properties in this town, each standing on its lot as a tile-composed
     * building of its kind (data/lots.json propertyKinds; a building site while it goes up,
     * ui/innerMapLayers). A property with no lot here (an older save's, or a lot this
     * town's plan hasn't) takes a bare lot of the player's, else a free one — the
     * builders took it with the work. A lot whose property is gone (sold, seized) stands
     * bare again. The anchor tile carries _propertyRef; property.innerQ/innerR is it.
     */
    _standPlayerProperties(settlement, day = 0, player = null) {
        const wt = this._currentWorldTileRef;
        if (!settlement || !wt || this._insideBuilding || !this.tiles) return;
        const props = [...(wt.playerProperties || [])].filter(Boolean);
        if (wt.playerProperty && !props.includes(wt.playerProperty)) props.push(wt.playerProperty);
        const book = LotBook.of(settlement);
        const lots = this.townLots();
        for (const [id, rec] of Object.entries(book.lots)) {
            if (LotBook.isPropertyBuild(rec) && !props.some(p => p.lotId === id)) rec.built = null;
        }
        if (player && !Array.isArray(player.lotHoldings)) player.lotHoldings = [];
        const holdings = player ? player.lotHoldings : null;
        const isHere = h => h && h.kind === 'lot' && h.q === settlement.q && h.r === settlement.r;
        for (const p of props) {
            let lot = p.lotId ? lots.find(l => l.id === p.lotId) || null : null;
            const rec = p.lotId ? book.lots[p.lotId] : null;
            if (lot && rec && !LotBook.isPlayer(rec)) lot = null;
            if (!lot) {
                const old = p.lotId || null;
                // (the old record, on a lot this map hasn't, moves with it)
                const oldRec = old && rec && LotBook.isPlayer(rec) ? rec : null;
                if (old && oldRec) delete book.lots[old];
                const mine = lots.find(l => { const r = book.lots[l.id]; return LotBook.isPlayer(r) && !r.built; });
                const free = mine || lots.find(l => !book.lots[l.id]);
                if (!free) { delete p.lotId; if (p.innerQ != null) this._clearPastedProperty(p); delete p.innerQ; delete p.innerR; continue; }
                if (oldRec && !book.lots[free.id]) book.lots[free.id] = { ...oldRec, built: null };
                LotBook.bindProperty(settlement, free.id, p, day, (player && player.name) || 'You');
                if (holdings) {
                    const h = old ? holdings.find(x => isHere(x) && x.id === old) : null;
                    if (h) h.id = free.id;
                    else if (!holdings.some(x => isHere(x) && x.id === free.id)) holdings.push({ kind: 'lot', q: settlement.q, r: settlement.r, id: free.id, town: settlement.name, price: 0 });
                }
                lot = free;
            } else if (!LotBook.isPropertyBuild(book.lots[lot.id])) {
                LotBook.bindProperty(settlement, lot.id, p, day, (player && player.name) || 'You');
            }
            let at = this._lotAnchor(lot);
            if (!at && !this._lotHasBuilding(lot)) {
                const seed = _strHash(`${settlement.foundingName || settlement.name}|${lot.id}|${p.type}`);
                // (its own kind within the lot; else reaching a few rows back onto open ground; else a house)
                const kinds = LotBook.propertyKinds(p.type).filter(k => k !== 'house');
                for (const [list, overhang] of [[kinds, 0], [kinds, 4], [['house'], 0]]) {
                    for (const kind of list) {
                        at = this._standOnLot(lot, kind, seed, settlement, { exact: true, overhang });
                        if (at) break;
                    }
                    if (at) break;
                }
            }
            if (p.innerQ != null && (!at || p.innerQ !== at.q || p.innerR !== at.r)) this._clearPastedProperty(p);
            if (!at) { delete p.innerQ; delete p.innerR; continue; }
            const t = this.tiles[at.r][at.q];
            t._buildingTypeHint = 'player_property';
            t._propertyRef = p;
            p.innerQ = at.q;
            p.innerR = at.r;
        }
    },

    /** The town's vacant houses: a hash of the town picks them, the same each visit. Marks b._vacancy. */
    _markVacancies(settlement) {
        if (!settlement) return;
        const n = Math.max(0, Math.round(Number(LotBook.byType('vacant', settlement.type)) || 0));
        const salt = _strHash(settlement.foundingName || settlement.name || `${settlement.q},${settlement.r}`);
        const houses = (this.buildings || []).filter(b => b && b.type === 'house' && !b.isPlayerProperty && !b.isPlayerOwned && !b._lotId)
            .sort((a, b) => _hash(a.q, a.r, salt) - _hash(b.q, b.r, salt));
        for (const b of houses.slice(0, n)) {
            b._vacancy = `${b.q},${b.r}`;
            const v = LotBook.vacancy(settlement, b._vacancy);
            b._vacant = !v || v.holder === 'player';
        }
        // What the town has, for the AI's dealings while the player is away (systems/lots.js)
        LotBook.of(settlement).known = {
            lots: this.townLots().map(l => ({ id: l.id, w: l.w, h: l.h })),
            vacancies: houses.slice(0, n).map(b => b._vacancy),
            // (how many of its new streets the map had laid: world/townGrowth.js)
            ext: settlement.growth && Array.isArray(settlement.growth.streets) ? settlement.growth.streets.length : 0,
        };
    },

    /** After the owners are known: lot buildings and taken houses show their holder; vacant houses are to let. */
    _applyLotHolders(settlement) {
        if (!settlement) return;
        for (const b of this.buildings || []) {
            if (!b) continue;
            if (b._lotId) {
                const rec = LotBook.lot(settlement, b._lotId);
                if (rec) {
                    b.ownerId = rec.holder === 'player' ? 'player' : rec.holder;
                    b.ownerName = rec.holderName || 'a townsman';
                    b.ownerTitle = 'Owner';
                    if (rec.holder === 'player') b.isPlayerOwned = true;
                }
            }
            if (!b._vacancy) continue;
            const v = LotBook.vacancy(settlement, b._vacancy);
            const base = String(b.name || 'House').replace(/ \((To Let|Rented|Yours)\)$/, '');
            if (!v) {
                b.ownerId = null; b.ownerName = null; b.ownerTitle = null;
                b.name = `${base} (To Let)`;
            } else if (v.holder === 'player') {
                b.isPlayerOwned = true;
                b.ownerId = 'player';
                b.ownerName = 'You';
                b.ownerTitle = v.status === 'rented' ? 'Tenant' : 'Owner';
                b.name = `${base} (${v.status === 'rented' ? 'Rented' : 'Yours'})`;
            } else {
                b.ownerId = v.holder;
                b.ownerName = v.holderName || 'a townsman';
                b.ownerTitle = v.status === 'rented' ? 'Tenant' : 'Owner';
                b.name = base;
            }
        }
    },
});
