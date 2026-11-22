// ============================================
// WATER SOURCES — where fresh water is, for the world layer
// ============================================
// The pure half of systems/water.js that the world's own code (the realms'
// battles in world/kingdomAI.js) can read without reaching up into systems:
// fresh water on or beside a hex (a river on it, a lake on or beside it; the
// sea is salt), a town's wells by size and era, and whether the town's own
// water record (settlement.water, kept by systems/water.js) leaves it with
// no clean well. No state, no randomness.

import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { TownEras } from './townEras.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _town() {
    const w = DataLoader._gamedata && DataLoader._gamedata.water;
    return (w && w.town) || {};
}

export const WaterSources = {
    /** Fresh water on or beside a hex: 'river', 'lake' or null. */
    freshAt(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(q, r);
        if (!tile) return null;
        if (tile.hasRiver) return 'river';
        if (tile.terrain && tile.terrain.id === 'lake') return 'lake';
        for (const n of Hex.neighbors(q, r)) {
            const nb = world.getTile(n.q, n.r);
            if (nb && nb.terrain && nb.terrain.id === 'lake') return 'lake';
        }
        return null;
    },

    /** Fresh water on the hex or any hex beside it (a camp sends men a few miles for it). */
    nearFresh(world, q, r) {
        if (WaterSources.freshAt(world, q, r)) return true;
        for (const n of Hex.neighbors(q, r)) {
            const t = world.getTile(n.q, n.r);
            if (t && t.hasRiver) return true;
        }
        return false;
    },

    /** The town's wells: by size, and one more for each two eras it has stood through. */
    wellsOf(s) {
        if (!s) return 0;
        const T = _town();
        let n = _num((T.wells || {})[s.type || 'village'], { village: 1, town: 2, city: 4, capital: 5 }[s.type] || 1);
        const st = TownEras.state(s);
        const H = st && Array.isArray(st.history) ? st.history : null;
        if (H && H.length) n += Math.floor(Math.max(0, TownEras.eraIndex(H[H.length - 1][0])) * _num(T.perEra, 0.5));
        return Math.max(1, Math.round(n));
    },

    /**
     * Has the town no clean well by its own record (fouled or dry: systems/water.js)?
     * A river or lake still waters it. (The player's poisoned well, a town crime, is
     * counted by systems/water.js view, not here.)
     */
    wellsLost(world, s) {
        const w = s && s.water;
        if (!w) return false;
        const day = _num(world && world.day);
        if (w.dry && day <= _num(w.dry.until, -1)) return true;
        let n = 0;
        for (const f of Array.isArray(w.foul) ? w.foul : []) if (day <= _num(f.until, -1)) n += Math.max(1, _num(f.n, 1));
        return n >= WaterSources.wellsOf(s);
    },

    /** No clean water at all in the town: its wells lost and no river or lake. */
    townDry(world, s) {
        return !!s && WaterSources.wellsLost(world, s) && !WaterSources.freshAt(world, s.q, s.r);
    },
};
