// ============================================================
// SHIP HULLS — the LPC ships as inner-map objects
// ============================================================
// bluecarrot16's LPC Ship tileset is modular: deck, hull, masts, shrouds,
// sails and crow's nests on separate layers. scripts/extract-ships.js lifts
// the four ships the artist composed in the tileset's Tiled map into
// data/shipHulls.json (skiff, sloop, brig, galleon); this turns each into an
// editor-object def (the shape CustomObjects draws), anchored at the hull's
// waterline, with every layer's tiles in drawing order. 64px tiles (cannon
// ports) are cut into four 32px pieces so the renderer can place them.
//
// A def's `sortRow` (the deck's top row, relative to the anchor) makes the
// depth sort treat the ship as standing there: someone on the deck or on a
// pier south of it is drawn in front.
//
// `hullFor(typeId)` maps the game's ship types (data/ships.json) onto them.
// Pure; no randomness; no import-time effects.

import { DataLoader } from '../core/dataLoader.js';

const T = 32;
const HULL_LAYERS = new Set(['deck', 'ship']);

/** Which drawn hull stands for each ship type */
const TYPE_TO_HULL = {
    rowboat: 'hull_skiff', fishing_vessel: 'hull_skiff', sloop: 'hull_sloop', cog: 'hull_sloop',
    caravel: 'hull_brig', war_galley: 'hull_brig', galleon: 'hull_galleon',
};

const NAMES = { hull_skiff: 'Skiff', hull_sloop: 'Sloop', hull_brig: 'Brig', hull_galleon: 'Galleon' };

function _data() {
    const g = DataLoader._gamedata;
    return (g && g.shipHulls) || null;
}

let _cache = null;
let _src = null;

export const ShipHulls = {
    /** The hull ids drawn, smallest first */
    ids() {
        const d = _data();
        return d ? d.ships.map(s => s.id) : [];
    },

    hullFor(typeId) {
        return TYPE_TO_HULL[typeId] || null;
    },

    /** The ship types each hull stands for (the shipyard's names for it) */
    typesFor(hullId) {
        return Object.keys(TYPE_TO_HULL).filter(k => TYPE_TO_HULL[k] === hullId);
    },

    /** Every hull as an object def, for CustomObjects to register */
    defs() {
        const d = _data();
        if (!d) return [];
        if (_cache && _src === d) return _cache;
        _src = d;
        _cache = d.ships.map(s => ShipHulls._def(s));
        return _cache;
    },

    def(id) {
        return ShipHulls.defs().find(x => x.id === id) || null;
    },

    _def(ship) {
        const base = ship.waterline;
        const tiles = [];
        const hull = new Set();
        let deckTop = 0;
        for (const t of ship.tiles) {
            const pieces = [];
            if (t.sw > T || t.sh > T) {
                // A big tile anchored at its bottom-left cell: cut into 32px pieces
                const cw = Math.round(t.sw / T), ch = Math.round(t.sh / T);
                for (let dy = 0; dy < ch; dy++) {
                    for (let dx = 0; dx < cw; dx++) {
                        pieces.push({ col: t.col + dx, row: t.row - (ch - 1) + dy, sx: t.sx + dx * T, sy: t.sy + dy * T });
                    }
                }
            } else {
                pieces.push({ col: t.col, row: t.row, sx: t.sx, sy: t.sy });
            }
            for (const p of pieces) {
                const localRow = p.row - base;
                tiles.push({ localCol: p.col, localRow, sheetPath: t.sheet, sx: p.sx, sy: p.sy, sw: T, sh: T });
                if (HULL_LAYERS.has(t.layer)) {
                    hull.add(`${p.col},${localRow}`);
                    deckTop = Math.min(deckTop, localRow);
                }
            }
        }
        let minCol = 0, maxCol = 0, minRow = 0;
        for (const t of tiles) {
            minCol = Math.min(minCol, t.localCol); maxCol = Math.max(maxCol, t.localCol);
            minRow = Math.min(minRow, t.localRow);
        }
        const meta = [...hull].map(k => {
            const [c, r] = k.split(',').map(Number);
            return { localCol: c, localRow: r, impassable: true, hull: true, interactionPoint: c === 0 && r === 0 };
        });
        return {
            id: ship.id,
            name: NAMES[ship.id] || 'Ship',
            objectType: 'decoration',
            terrainBindings: [],
            spawnWeight: 0,
            shipHull: true,
            tags: ['ship'],
            bounds: { minCol, minRow, maxCol, maxRow: 0 },
            sortRow: deckTop,
            hasBlockedTiles: true,
            hasInteraction: true,
            tiles,
            meta,
            size: { w: ship.w, h: ship.h },
        };
    },

    /** The cells a hull covers in the water (relative to its anchor) */
    footprint(def) {
        return (def && def.meta ? def.meta : []).filter(m => m.hull);
    },
};
