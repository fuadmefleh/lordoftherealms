// ============================================
// WORLD PREVIEW — the land a New Game will make, small enough to draw
// ============================================
//
// The New Game screen (components/WorldPreview.jsx) shows the world its
// settings and seed make before it is made. build() runs the real generator's
// first stage (World.generateLand: the terrain, then the realms' capitals,
// first lands and first towns, drawn exactly as World.generate draws them) and
// summarise() packs it into flat typed arrays a canvas can paint and a worker
// can post. Nothing here reads a global: the size and params come in.

import { World } from './world/index.js';
import { Terrain } from './terrain.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';

export const WorldPreview = {
    /**
     * Generate the land for `params` (as World.generate takes them) on a
     * width × height map and summarise it. The caller's RNG stream and id
     * counter are left as they were.
     * @returns {Object} see summarise()
     */
    build(width, height, params = {}) {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const ids = Utils.getIdCounter();
        const outerRng = Utils.getRng();
        let world;
        try {
            // (the World's weather draws a little at construction: from a stream of
            // its own, as generateLand reseeds before the land is drawn anyway)
            Utils.setSeed(1);
            world = new World(width, height);
            world.generateLand(params);
        } finally {
            Utils.setRng(outerRng);
            Utils.setIdCounter(ids);
        }
        const out = WorldPreview.summarise(world);
        out.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
        return out;
    },

    /**
     * A generated world as flat arrays, index i = r * width + q:
     * `terrain` (index into `types`), `riverTo` (the hex a river there flows
     * into, -1 none), `realm` (1 + index into `kingdoms`, 0 none); `types`
     * [{ id, name, color, water }] from Terrain.TYPES (data/terrain.json);
     * `kingdoms` [{ id, name, color, capital: {q, r, name} }]; `towns`
     * [{ q, r, type, name, realm }]; `stats` { land, water, river } in hexes.
     */
    summarise(world) {
        const W = world.width;
        const H = world.height;
        const N = W * H;
        const types = [];
        const typeIndex = new Map();
        const byId = {};
        for (const t of Object.values(Terrain.TYPES || {})) if (t && t.id) byId[t.id] = t;
        const typeOf = (terrain) => {
            const id = (terrain && terrain.id) || 'none';
            let i = typeIndex.get(id);
            if (i === undefined) {
                const def = byId[id] || terrain || {};
                i = types.length;
                typeIndex.set(id, i);
                types.push({ id, name: def.name || id, color: def.color || '#000000', water: WorldPreview._isWater(id) });
            }
            return i;
        };
        const kingdoms = (world.kingdoms || []).map(k => ({
            id: k.id, name: k.name, color: k.color || '#ffffff',
            capital: k.capital ? { q: k.capital.q, r: k.capital.r, name: null } : null,
        }));
        const realmIndex = new Map(kingdoms.map((k, i) => [k.id, i + 1]));
        const terrain = new Uint16Array(N);
        const riverTo = new Int32Array(N).fill(-1);
        const realm = new Uint8Array(N);
        const towns = [];
        const stats = { land: 0, water: 0, river: 0 };
        for (let r = 0; r < H; r++) {
            const row = world.tiles[r] || [];
            for (let q = 0; q < W; q++) {
                const t = row[q];
                if (!t) continue;
                const i = r * W + q;
                const ti = typeOf(t.terrain);
                terrain[i] = ti;
                if (types[ti].water) stats.water++; else stats.land++;
                if (t.hasRiver) {
                    stats.river++;
                    if (Number.isInteger(t.riverDir) && t.riverDir >= 0) {
                        const n = Hex.neighbors(q, r)[t.riverDir];
                        if (n && n.r >= 0 && n.r < H) riverTo[i] = n.r * W + Hex.wrapQ(n.q, W);
                    }
                }
                if (t.kingdom) realm[i] = realmIndex.get(t.kingdom) || 0;
                if (t.settlement) {
                    const s = t.settlement;
                    towns.push({ q, r, type: s.type || 'town', name: s.name || '', realm: realmIndex.get(s.kingdom) || 0 });
                }
            }
        }
        for (const k of kingdoms) {
            if (!k.capital) continue;
            const t = world.tiles[k.capital.r] && world.tiles[k.capital.r][k.capital.q];
            k.capital.name = (t && t.settlement && t.settlement.name) || null;
        }
        return {
            width: W, height: H,
            seed: world.generationParams ? world.generationParams.seed : null,
            terrain, riverTo, realm, types, kingdoms, towns, stats,
        };
    },

    /** Terrain ids that are water (Terrain.WATER_IDS: the seas and lakes) */
    _isWater(id) {
        return (Terrain.WATER_IDS || []).includes(id);
    },

    /** The ArrayBuffers of a summary, to transfer from a worker */
    transferables(summary) {
        return summary ? [summary.terrain.buffer, summary.riverTo.buffer, summary.realm.buffer] : [];
    },
};
