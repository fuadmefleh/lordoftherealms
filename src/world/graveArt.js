// ============================================
// GRAVE ART — grave markers, tombs, the crypt, the rail, ossuary and bone mill
// ============================================
// The painted sprites (assets/lpc/new/graves/<id>.png, one per thing, 128 px
// a tile, each fitted into its tiles box: scripts/make_graves.py) as
// editor-object defs, the shape CustomObjects already draws, clicks and
// blocks movement with. CustomObjects.loadAll registers GraveArt.defs().
//
// A sprite is cut into the tiles of its box, stood on the box's bottom and
// centred across it: each tile's source rect is a 128 px square of the
// sprite (reaching past its edges, which draw nothing), so the sheet draws at
// a scale of one (ui/sheetScale.js lists no width for it).
//
// Only the markers with art (data/graves.json `art`, merged from the
// manifest by build:data) get a def; one without is drawn by
// ui/innerMapGraves.js as the old dug-grave mound until its art lands.
// Pure: no randomness, no import-time effects.

import { GraveBook } from './graveBook.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The things lain flat on the ground (drawn under the sprites by ui/innerMapGraves.js), not stood up as objects. */
export const GROUND_ART = new Set(['grave_mound', 'grave_open']);
/** Walked over: the mound, the open grave is a hole (kept off), everything else stands in the way. */
const WALKABLE = new Set(['grave_mound']);

export const GraveArt = {
    /** The object id of a marker. */
    defId(id) { return `grave_${id}`; },

    /** The marker id of a def id (null if it isn't one). */
    markerOf(defId) {
        const m = /^grave_(.+)$/.exec(String(defId || ''));
        return m && GraveBook.markerDef(m[1]) ? m[1] : null;
    },

    /** The sprite's path. */
    path(id) {
        return `${GraveBook.config().artDir || 'assets/lpc/new/graves'}/${id}.png`;
    },

    /** The art's manifest entry for a marker, or null while it has none. */
    art(id) {
        const a = GraveBook.config().art;
        const e = a && a[id];
        return e && _num(e.w) > 0 && _num(e.h) > 0 ? e : null;
    },

    /** A marker's footprint [w, h] in tiles. */
    footprint(id) {
        const a = GraveArt.art(id);
        if (a && _num(a.tilesW) > 0 && _num(a.tilesH) > 0) return [Math.round(a.tilesW), Math.round(a.tilesH)];
        const d = GraveBook.markerDef(id);
        return d && Array.isArray(d.tiles) ? [Math.max(1, d.tiles[0] | 0), Math.max(1, d.tiles[1] | 0)] : [1, 1];
    },

    /**
     * Where a sprite's tiles come from: for each tile of its box (localCol
     * 0..w-1, localRow -(h-1)..0) a `artTile`-px square of the image, the
     * sprite stood on the box's bottom, centred across it.
     */
    slice(id, imgW, imgH) {
        const [tw, th] = GraveArt.footprint(id);
        const P = Math.max(1, _num(GraveBook.config().artTile, 128));
        const xoff = (tw * P - imgW) / 2;
        const tiles = [];
        for (let r = 0; r < th; r++) {
            for (let c = 0; c < tw; c++) {
                tiles.push({ localCol: c, localRow: r - (th - 1), sheetPath: GraveArt.path(id), sx: c * P - xoff, sy: imgH - (th - r) * P, sw: P, sh: P });
            }
        }
        return tiles;
    },

    /** One marker's def. */
    def(id) {
        const a = GraveArt.art(id);
        const d = GraveBook.markerDef(id);
        if (!a || !d) return null;
        const [tw, th] = GraveArt.footprint(id);
        const meta = [];
        for (let r = 0; r < th; r++) {
            for (let c = 0; c < tw; c++) {
                const lr = r - (th - 1);
                meta.push({ localCol: c, localRow: lr, impassable: !WALKABLE.has(id), interactionPoint: c === 0 && lr === 0 });
            }
        }
        return {
            id: GraveArt.defId(id),
            name: d.name || id,
            objectType: 'decoration',
            terrainBindings: [],
            spawnWeight: 0,
            townProp: true,
            graveMarker: id,
            tags: ['grave', id],
            bounds: { minCol: 0, minRow: -(th - 1), maxCol: tw - 1, maxRow: 0 },
            hasBlockedTiles: !WALKABLE.has(id),
            hasInteraction: true,
            tiles: GraveArt.slice(id, _num(a.w), _num(a.h)),
            meta,
        };
    },

    /** Every marker with art, for CustomObjects to register. */
    defs() {
        const out = [];
        for (const id of Object.keys(GraveBook.config().markers || {})) {
            const d = GraveArt.def(id);
            if (d) out.push(d);
        }
        return out;
    },

    /** Does this marker have art to stand on the map? */
    hasArt(id) { return !!GraveArt.art(id); },
};
