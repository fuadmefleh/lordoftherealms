/**
 * SettlementGenerator — lays out a settlement's street map.
 *
 * The plan itself lives in world/townPlanner.js: a winding high street and
 * cross road meeting at a market square, lanes and alleys beside them,
 * buildings fronting the streets (landmarks on the square, houses by style
 * from the centre out), back gardens and trade clutter, and farmland round
 * the edge. This module is the entry point InnerMap.generate() calls.
 */

import { InnerMap } from './innerMap.js';
import { planTown, PLAN } from './townPlanner.js';

/**
 * @param {Array}     tiles      – 2D inner-map tile grid (mutated)
 * @param {Object}    settlement – { type, name, population }
 * @param {Function}  rng        – the map's seeded random [0,1)
 * @param {number}    mapW
 * @param {number}    mapH
 * @returns {{ roadTiles: Array<{q,r}>, buildings: number }}
 */
function generate(tiles, settlement, rng, mapW, mapH, opts = {}) {
    const layout = (typeof InnerMap !== 'undefined' && InnerMap.settlementLayout)
        ? InnerMap.settlementLayout(settlement)
        : null;
    const res = planTown(tiles, settlement, rng, mapW, mapH, layout, opts);
    return { roadTiles: res.roadTiles, buildings: res.buildings, blocks: [], lots: res.lots || [] };
}

export const SettlementGenerator = {
    generate,
    PLAN,
};
