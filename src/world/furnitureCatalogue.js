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
// A decoration (an item of kind 'decor' or 'wall', in the same store, or in
// player.homeFurnishings[key].decor[]): { uid, id | null, look?, q?, r?, face?, on?, cell? }
// (a house's own: look { kind, decor | wallDecor }). Its tile look is
// tile._decor (on a table, desk, shelf …) or tile._wallDecor (on a wall).
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
    maxDecorPerHome: 40,
    decorOn: ['table', 'bar', 'desk', 'shelf', 'counter', 'workbench', 'dresser', 'cupboard'],
    decorCap: { comfort: 0.3, cheer: 0.6, light: 4, prestige: 3 },
    windowJob: { price: 40, name: 'Window', icon: '🪟', comfort: 0.05, cheer: 0.05 },
    makers: {},
    items: [],
};

const FX = ['comfort', 'cheer', 'light', 'prestige'];

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
                id: it.id, type: it.type, name: it.name, icon: it.icon || '💺',
                passable: !!it.passable,
                footprint: Array.isArray(it.footprint) ? [Math.max(1, _num(it.footprint[0], 1)), Math.max(1, _num(it.footprint[1], 1))] : [1, 1],
                comfort: _num(it.comfort), restBonus: _num(it.restBonus), price: _num(it.price), original: false, desc: it.desc || '',
                kind: it.kind === 'decor' || it.kind === 'wall' ? it.kind : 'furniture',
                decor: it.decor || null, wallDecor: it.wallDecor || null, onWindow: !!it.onWindow,
                cheer: _num(it.cheer), light: _num(it.light), prestige: _num(it.prestige), maker: it.maker || 'joiner',
            };
        }
        const look = piece.look || {};
        if (look.kind === 'decor' || look.kind === 'wall') {
            // (a house's own mugs or tapestry: valued as the cheapest of its kind the makers sell)
            const like = this.decorItem(look.kind, look.kind === 'decor' ? look.decor : look.wallDecor);
            const name = look.name || (like && like.name) || String(look.decor || look.wallDecor || 'trinket').replace(/_/g, ' ');
            return {
                id: null, type: look.kind === 'decor' ? 'decor' : 'wall_decor', name, icon: look.icon || (like && like.icon) || '✨',
                passable: true, footprint: [1, 1], comfort: like ? _num(like.comfort) : 0, restBonus: 0, price: like ? _num(like.price) : 2,
                original: true, desc: 'Came with the house.', kind: look.kind,
                decor: look.kind === 'decor' ? look.decor || null : null, wallDecor: look.kind === 'wall' ? look.wallDecor || null : null,
                onWindow: !!(like && like.onWindow) || look.wallDecor === 'curtains',
                cheer: like ? _num(like.cheer) : 0, light: like ? _num(like.light) : 0, prestige: like ? _num(like.prestige) : 0, maker: (like && like.maker) || 'joiner',
            };
        }
        const type = look.type || 'crate';
        return {
            id: null, type, name: look.name || String(type).replace(/_/g, ' '), icon: look.icon || '💺',
            // (a house's own bed or table keeps the size it came at: world/innerMap/interiors.js PIECE_SPANS)
            passable: !!look.passable, footprint: Array.isArray(look.footprint) ? [Math.max(1, _num(look.footprint[0], 1)), Math.max(1, _num(look.footprint[1], 1))] : [1, 1],
            comfort: this.typeComfort(type), restBonus: this.typeRestBonus(type), price: this.typePrice(type), original: true, desc: 'Came with the house.',
            kind: 'furniture', decor: null, wallDecor: null, onWindow: false, cheer: 0, light: 0, prestige: 0, maker: 'joiner',
        };
    },

    /** 'decor' (on a table …), 'wall' (on a wall) or null (furniture on the floor). */
    decorKind(piece) {
        const v = this.view(piece);
        return v && (v.kind === 'decor' || v.kind === 'wall') ? v.kind : null;
    },

    /** The cheapest item the makers sell of a decoration look ('decor', 'mugs' | 'wall', 'tapestry'). */
    decorItem(kind, look) {
        if (!look) return null;
        const field = kind === 'wall' ? 'wallDecor' : 'decor';
        const same = this.items().filter(i => i && i.kind === kind && i[field] === look);
        return same.length ? same.reduce((a, b) => (_num(b.price) < _num(a.price) ? b : a)) : null;
    },

    /** May a decoration stand on furniture of this type (a table, a desk, a shelf …)? */
    holdsDecor(type) { return (this.config().decorOn || DEFAULTS.decorOn).includes(type); },

    /**
     * What a home's decorations do, all together and capped (decorCap):
     * looks = [{ kind: 'decor' | 'wall', look: 'mugs' | 'tapestry' | 'window' }]
     * (a window, knocked through, counts as windowJob). → { comfort, cheer, light, prestige }
     */
    decorEffects(looks) {
        const c = this.config();
        const cap = { ...DEFAULTS.decorCap, ...(c.decorCap || {}) };
        const win = { ...DEFAULTS.windowJob, ...(c.windowJob || {}) };
        const sum = { comfort: 0, cheer: 0, light: 0, prestige: 0 };
        for (const l of looks || []) {
            if (!l || !l.look) continue;
            const src = l.kind === 'wall' && l.look === 'window' ? win : this.decorItem(l.kind, l.look);
            if (!src) continue;
            for (const k of FX) sum[k] += Math.max(0, _num(src[k]));
        }
        for (const k of FX) sum[k] = Math.round(Math.min(Math.max(0, _num(cap[k])), sum[k]) * 100) / 100;
        return sum;
    },

    /** The makers (joiner, weaver, potter, chandler, smith): { id: { name, icon } }. */
    makers() { return this.config().makers || {}; },

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
