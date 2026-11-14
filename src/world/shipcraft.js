// ============================================
// SHIPCRAFT — what a realm's shipwrights know how to build
// ============================================
//
// A ship needs its builders to know their craft (data/ships.json: each type
// `requires` technology ids). A realm of an ordinary start knows the whole
// craft of its era. A realm born at the Dawn of Man (world/dawn.js) starts
// with none and learns it a technique at a time as the years pass
// (kingdom.shipcraft, `order` in data/ships.json `shipcraft`). An independent
// town knows its era's craft in an ordinary world and nothing in a world
// begun at the dawn. The player's own research comes on top of that (the
// shipyard is told how): systems/ships.js puts the two together.
//
// Pure model, no randomness: learning follows the realm's age.

import { DataLoader } from '../core/dataLoader.js';

const DAYS_PER_YEAR = 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const Shipcraft = {
    config() {
        const s = DataLoader._gamedata && DataLoader._gamedata.ships;
        const c = (s && s.shipcraft) || {};
        return {
            order: Array.isArray(c.order) ? c.order : ['shipbuilding', 'deep_sea_fishing', 'navigation', 'lighthouse', 'naval_warfare'],
            firstAfterYears: _num(c.firstAfterYears, 4),
            learnEveryYears: Math.max(1, _num(c.learnEveryYears, 6)),
            pierAfterYears: Math.max(0, _num(c.pierAfterYears, 3)),
        };
    },

    /** The whole craft of the era (what an ordinary start's realms know) */
    full() {
        return Shipcraft.config().order.slice();
    },

    /** What a realm's shipwrights know (an array of technology ids) */
    realmKnows(kingdom) {
        if (!kingdom) return [];
        return Array.isArray(kingdom.shipcraft) ? kingdom.shipcraft : Shipcraft.full();
    },

    /** What the shipwrights of a settlement know */
    townKnows(world, settlement) {
        if (!settlement) return [];
        const k = settlement.kingdom && world && typeof world.getKingdom === 'function' ? world.getKingdom(settlement.kingdom) : null;
        if (k && k.isAlive !== false) return Shipcraft.realmKnows(k);
        // An independent town: its era's craft — none in a world begun at the dawn
        return world && world.dawn ? [] : Shipcraft.full();
    },

    /** A realm born at the dawn starts knowing nothing (world/dawn.js foundRealm) */
    beginRealm(kingdom) {
        if (kingdom) kingdom.shipcraft = [];
    },

    /** The years teach the dawn's realms their craft (each new year, from the world tick) */
    yearly(world) {
        if (!world || !Array.isArray(world.kingdoms)) return [];
        const C = Shipcraft.config();
        const learned = [];
        for (const k of world.kingdoms) {
            if (!k || k.isAlive === false || !Array.isArray(k.shipcraft)) continue;
            const years = Math.floor((_num(world.day) - _num(k.foundedDay)) / DAYS_PER_YEAR);
            const n = years < C.firstAfterYears ? 0 : 1 + Math.floor((years - C.firstAfterYears) / C.learnEveryYears);
            const want = C.order.slice(0, Math.min(C.order.length, n));
            for (const t of want) {
                if (!k.shipcraft.includes(t)) {
                    k.shipcraft.push(t);
                    learned.push({ kingdom: k, tech: t });
                }
            }
        }
        return learned;
    },
};
