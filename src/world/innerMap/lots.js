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
import { CustomBuildings } from './_imports.js';
import { LotBook } from '../lotBook.js';

function _hash(q, r, salt) {
    let h = (q * 73856093) ^ (r * 19349663) ^ (salt * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

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
            // (a property the player built stands as that property; a house they raised to let stands like the AI's)
            if (!b || (b.by === 'player' && b.kind !== 'house') || (b.readyDay != null && day < b.readyDay)) continue;
            if (this._lotHasBuilding(lot)) continue;
            this._standOnLot(lot, b.type || 'house', _strHash(`${settlement.name}|${lot.id}|${b.type}`));
        }
    },

    _lotHasBuilding(lot) {
        for (let r = lot.r0; r <= lot.r1; r++) for (let q = lot.q0; q <= lot.q1; q++) {
            const t = this.tiles[r] && this.tiles[r][q];
            if (t && (t.customBuilding || t.customBuildingPart)) return true;
        }
        return false;
    },

    /** A design of this type that fits the lot, stood with its door on the lot's front row. */
    _standOnLot(lot, type, seed) {
        const defs = (CustomBuildings.getByType(type) || []).concat(type === 'house' ? [] : CustomBuildings.getByType('house') || [])
            .filter(d => d && d.meta && d.bounds && d.style !== 'farmstead');
        if (!defs.length) return false;
        const start = seed % defs.length;
        for (let i = 0; i < defs.length; i++) {
            const def = defs[(start + i) % defs.length];
            const bw = def.bounds.maxCol - def.bounds.minCol + 1;
            const bh = def.bounds.maxRow - def.bounds.minRow + 1;
            if (bw > lot.w || bh > lot.h || def.bounds.maxRow > 0) continue;
            const door = (def.meta || []).find(m => m.door) || { q: 0, r: 0 };
            // Centre it on the lot, the anchor's row the lot's front
            const left = lot.q0 + Math.floor((lot.w - bw) / 2);
            const q = left - def.bounds.minCol;
            const r = lot.r1 - def.bounds.maxRow;
            if (q + door.q < lot.q0 || q + door.q > lot.q1) continue;
            const fits = (def.meta || []).every(m => {
                const fq = q + m.q, fr = r + m.r;
                return fq >= lot.q0 && fq <= lot.q1 && fr >= lot.r0 && fr <= lot.r1;
            });
            if (!fits) continue;
            this.tiles[r][q].customBuilding = { defId: def.id, lotId: lot.id };
            for (const m of def.meta || []) {
                const t = this.tiles[r + m.r][q + m.q];
                if (m.q !== 0 || m.r !== 0) t.customBuildingPart = { anchorQ: q, anchorR: r };
                if (m.door) {
                    t._doorMarker = { anchorQ: q, anchorR: r, defId: def.id };
                    t.subTerrain.passable = true;
                } else if (m.impassable) {
                    t.subTerrain.passable = false;
                }
            }
            return true;
        }
        return false;
    },

    /** The town's vacant houses: a hash of the town picks them, the same each visit. Marks b._vacancy. */
    _markVacancies(settlement) {
        if (!settlement) return;
        const n = Math.max(0, Math.round(Number(LotBook.byType('vacant', settlement.type)) || 0));
        const salt = _strHash(settlement.name || `${settlement.q},${settlement.r}`);
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
