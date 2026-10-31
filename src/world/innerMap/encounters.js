// InnerMap — wilderness encounter placement.
// A wilderness inner map (no settlement) holds 0–maxPerMap encounters from its
// biome's list (data/innerMap.json → subTerrains[biome].encounters). Where and
// which are hashes of the world seed, the hex and the slot — no RNG stream is
// drawn, so the terrain (and the golden snapshots) are untouched and a hex
// revisited after a reload holds the same encounters. Slots the player has
// dealt with (player.wilds.resolved, player/wilds.js) are left empty.
import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';

const DEFAULTS = { tileChance: 0.7, maxPerMap: 3, margin: 8, minFromCentre: 6, minApart: 14 };

/** A well-mixed 32-bit hash of the parts (Utils.hashStr + a murmur finaliser). */
function _hash(...parts) {
    let h = Utils.hashStr(parts.join('|'));
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

Object.assign(InnerMap, {
    /**
     * The encounter slots of a wilderness hex: [{ slot, id, q, r }]. Pure:
     * reads only the tiles' passability and the seed. `resolved` lists the
     * slots already dealt with.
     */
    planWildEncounters(tiles, terrainId, worldQ, worldR, seed, resolved = []) {
        const config = this.CONFIG || {};
        const cfg = { ...DEFAULTS, ...(config.wilds || {}) };
        const st = config.subTerrains && config.subTerrains[terrainId];
        const defs = config.encounters || {};
        const pool = ((st && st.encounters) || []).filter(id => defs[id]);
        const H = tiles.length;
        const W = H ? tiles[0].length : 0;
        if (!pool.length || !W) return [];
        const s = String(seed == null ? 'world' : seed);
        if (_hash(s, 'wilds', worldQ, worldR) / 4294967296 >= cfg.tileChance) return [];
        const count = 1 + (_hash(s, 'wildsN', worldQ, worldR) % Math.max(1, cfg.maxPerMap));
        const cq = Math.floor(W / 2);
        const cr = Math.floor(H / 2);
        const m = Math.min(cfg.margin, Math.floor(W / 4));
        const span = (n) => Math.max(1, n - 2 * m);
        const out = [];
        const used = new Set();
        const first = _hash(s, 'wildsId', worldQ, worldR);
        for (let slot = 0; slot < count; slot++) {
            // Which: step through the biome's list so a hex never holds the same one twice
            let id = null;
            for (let k = 0; k < pool.length; k++) {
                const cand = pool[(first + slot + k) % pool.length];
                if (!used.has(cand)) { id = cand; break; }
            }
            if (!id) break;
            used.add(id);
            if (resolved.includes(slot)) continue;
            // Where: the first open spot the hash lands on
            for (let attempt = 0; attempt < 40; attempt++) {
                const q = m + (_hash(s, 'wq', worldQ, worldR, slot, attempt) % span(W));
                const r = m + (_hash(s, 'wr', worldQ, worldR, slot, attempt) % span(H));
                const t = tiles[r] && tiles[r][q];
                if (!t || !t.subTerrain || !t.subTerrain.passable) continue;
                if (t.building || t.customBuilding || t.customObject || t.customObjectPart || t.isRoad || t.playerPropertyBuilding) continue;
                if (Math.max(Math.abs(q - cq), Math.abs(r - cr)) < cfg.minFromCentre) continue;
                if (out.some(o => Math.abs(o.q - q) + Math.abs(o.r - r) < cfg.minApart)) continue;
                out.push({ slot, id, q, r });
                break;
            }
        }
        return out;
    },

    /**
     * Encounters on the current map within `radius` of the player not yet
     * seen: marks them discovered (their marker shows) and returns them.
     */
    spotWildEncounters(radius = 6) {
        const out = [];
        if (!this.active || this._insideBuilding || !Array.isArray(this.tiles)) return out;
        const pq = this.playerInnerQ;
        const pr = this.playerInnerR;
        for (let r = Math.max(0, pr - radius); r <= Math.min(this.height - 1, pr + radius); r++) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = Math.max(0, pq - radius); q <= Math.min(this.width - 1, pq + radius); q++) {
                const t = row[q];
                const e = t && t.encounter;
                if (!e || e.discovered || e.slot == null) continue;
                e.discovered = true;
                t.explored = true;
                out.push(e);
            }
        }
        return out;
    },

    /** Put the hex's encounters on its freshly generated tiles (generate() calls this). */
    _placeWildEncounters(tiles, worldTile, worldQ, worldR, game) {
        if (!worldTile || worldTile.settlement) return;
        const terrainId = worldTile.terrain ? worldTile.terrain.id : null;
        const world = game && game.world;
        const seed = world && world.generationParams ? world.generationParams.seed : null;
        const wilds = game && game.player && game.player.wilds;
        const resolved = (wilds && wilds.resolved && wilds.resolved[`${worldQ},${worldR}`]) || [];
        const defs = (this.CONFIG && this.CONFIG.encounters) || {};
        for (const p of this.planWildEncounters(tiles, terrainId, worldQ, worldR, seed, resolved)) {
            const def = defs[p.id];
            tiles[p.r][p.q].encounter = {
                key: p.id, id: p.id, slot: p.slot,
                name: def.name, icon: def.icon, description: def.description,
                wq: worldQ, wr: worldR, iq: p.q, ir: p.r, discovered: false,
            };
        }
    },
});
