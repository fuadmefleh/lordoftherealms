// ============================================
// FURNITURE CATALOGUE — the pieces a home can be furnished with
// ============================================
// Pure data and arithmetic over data/furniture.json: the items a furniture
// maker sells, what each looks like on the inner map (an interior furniture
// type, drawn with that type's art and glyph), its footprint turned or not,
// what it is worth sold back, and how a stored or placed piece resolves to
// its look (a catalogue piece by id; a house's original piece by its own
// look: { type, name, icon, passable }).
//
// A piece (player.furnitureStore[], or player.homeFurnishings[key].pieces[]):
//   { uid, id | null, look?, q?, r?, rot?, storage? }
//
// Used by world/innerMap/furnishing.js (laying pieces on an interior) and
// systems/furnishing.js (buying, storing, selling).

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    sellBack: 0.5,
    originalSellBack: 0.3,
    comfortCap: 1.2,
    maxPiecesPerHome: 40,
    storageTypes: ['chest', 'crate', 'barrel', 'sack', 'bookshelf', 'shelf', 'desk', 'cauldron', 'oven'],
    settlementOrder: ['village', 'town', 'city', 'capital'],
    items: [],
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const FurnitureCatalogue = {
    config() {
        const d = DataLoader._gamedata && DataLoader._gamedata.furniture;
        if (!d || typeof d !== 'object') return DEFAULTS;
        return { ...DEFAULTS, ...d, items: Array.isArray(d.items) ? d.items : [] };
    },

    items() { return this.config().items; },

    item(id) {
        if (!id) return null;
        return this.items().find(i => i && i.id === id) || null;
    },

    /** How far up the ladder of places a settlement type stands (village 0 …). */
    rank(settlementType) {
        const order = this.config().settlementOrder || DEFAULTS.settlementOrder;
        const i = order.indexOf(settlementType);
        return i < 0 ? 0 : i;
    },

    /** The pieces a furniture maker in a place of this type makes. */
    forSale(settlementType) {
        const rank = this.rank(settlementType);
        return this.items().filter(i => this.rank(i.minSettlement || 'village') <= rank);
    },

    /** What a piece looks like and does: { id, type, name, icon, passable, footprint, comfort, restBonus, price, original }. */
    view(piece) {
        if (!piece) return null;
        const it = this.item(piece.id);
        if (it) {
            return {
                id: it.id, type: it.type, name: it.name, icon: it.icon || '🪑',
                passable: !!it.passable,
                footprint: Array.isArray(it.footprint) ? [Math.max(1, _num(it.footprint[0], 1)), Math.max(1, _num(it.footprint[1], 1))] : [1, 1],
                comfort: _num(it.comfort), restBonus: _num(it.restBonus), price: _num(it.price), original: false, desc: it.desc || '',
            };
        }
        const look = piece.look || {};
        const type = look.type || 'crate';
        return {
            id: null, type, name: look.name || String(type).replace(/_/g, ' '), icon: look.icon || '🪑',
            passable: !!look.passable, footprint: [1, 1],
            comfort: this.typeComfort(type), restBonus: this.typeRestBonus(type), price: this.typePrice(type), original: true, desc: 'Came with the house.',
        };
    },

    /** The footprint [w, h] a piece covers, turned (rot 1) or not. */
    footprint(piece) {
        const v = this.view(piece);
        const [w, h] = v ? v.footprint : [1, 1];
        return (piece && piece.rot) % 2 === 1 ? [h, w] : [w, h];
    },

    /** The tiles a piece at (q, r) covers: its anchor is the top-left. */
    tilesOf(piece, q, r) {
        const [w, h] = this.footprint(piece);
        const out = [];
        for (let dr = 0; dr < h; dr++) for (let dq = 0; dq < w; dq++) out.push({ q: q + dq, r: r + dr });
        return out;
    },

    /** The cheapest catalogue piece of a furniture type (a house's own pieces are valued as it). */
    _typeItem(type) {
        const ofType = this.items().filter(i => i && i.type === type);
        const single = ofType.filter(i => !Array.isArray(i.footprint) || _num(i.footprint[0], 1) * _num(i.footprint[1], 1) === 1);
        const same = single.length ? single : ofType;
        if (!same.length) return null;
        return same.reduce((a, b) => (_num(b.price) < _num(a.price) ? b : a));
    },
    typeComfort(type) { const i = this._typeItem(type); return i ? _num(i.comfort) : 0; },
    typeRestBonus(type) { const i = this._typeItem(type); return i ? _num(i.restBonus) : 0; },
    typePrice(type) { const i = this._typeItem(type); return i ? _num(i.price) : 5; },

    /** Does a piece of this type keep things in it? */
    holdsThings(type) { return (this.config().storageTypes || []).includes(type); },

    /** What the furniture maker gives for it. */
    sellValue(piece) {
        const v = this.view(piece);
        if (!v) return 0;
        const c = this.config();
        return Math.max(0, Math.floor(v.price * _num(v.original ? c.originalSellBack : c.sellBack, 0.5)));
    },

    /** Is a piece's store of goods empty? */
    isEmpty(piece) {
        return !piece || !piece.storage || !Object.values(piece.storage).some(n => _num(n) > 0);
    },
};
