// ============================================
// INFRASTRUCTURE — Roads, bridges, irrigation
// ============================================

import { Technology } from './technology.js';
import { Hex } from '../core/hex.js';
import { Quests } from './quests.js';
import { Economy } from '../world/economy.js';
import { KingdomBonuses } from '../world/kingdomState.js';


export const Infrastructure = {
    // ── Infrastructure Types ──
    TYPES: {
        DIRT_ROAD: {
            id: 'dirt_road',
            name: 'Dirt Road',
            icon: '🛤️',
            cost: 30,
            buildTime: 2, // days
            moveCostOverride: 1, // always costs 1 to traverse
            moveCostReduction: null,
            requiredTech: 'road_building',
            requiredTerrain: null, // any passable land
            description: 'A cleared dirt path. Movement cost is always 1.',
            renderColor: '#8B7355',
            renderWidth: 2,
        },
        STONE_ROAD: {
            id: 'stone_road',
            name: 'Stone Road',
            icon: '🛣️',
            cost: 80,
            buildTime: 4,
            moveCostOverride: 1, // always costs 1 to traverse
            moveCostReduction: null,
            requiredTech: 'paved_roads',
            requiredTerrain: null,
            upgradesFrom: 'dirt_road', // can upgrade existing dirt road
            description: 'A paved stone road. Movement cost is always 1.',
            renderColor: '#A0A0A0',
            renderWidth: 3,
        },
        BRIDGE: {
            id: 'bridge',
            name: 'Bridge',
            icon: '🌉',
            cost: 150,
            buildTime: 6,
            moveCostOverride: 1,
            moveCostReduction: null,
            requiredTech: 'bridge_construction',
            requiredTerrain: ['swamp', 'highlands'], // or tiles adjacent to rivers
            allowRiverTiles: true, // can also be placed on tiles with rivers
            description: 'A sturdy bridge. Negates river and swamp penalties (cost = 1).',
            renderColor: '#8B4513',
            renderWidth: 4,
        },
        IRRIGATION_CHANNEL: {
            id: 'irrigation_channel',
            name: 'Irrigation Channel',
            icon: '💧',
            cost: 60,
            buildTime: 3,
            moveCostOverride: null,
            moveCostReduction: null,
            requiredTech: 'irrigation',
            requiredTerrain: ['plains', 'grassland', 'savanna', 'desert', 'hills'],
            description: 'Water channels that boost farm productivity on this hex by 50%.',
            productivityBonus: 0.50,
            renderColor: '#4FC3F7',
            renderWidth: 2,
        },
    },

    // ═══════════════════════════════════════
    //  INFRASTRUCTURE PLACEMENT
    // ═══════════════════════════════════════

    /**
     * Check if player can build infrastructure on a tile
     */
    canBuild(player, infraType, tile, world) {
        const infra = Infrastructure.TYPES[infraType.toUpperCase()];
        if (!infra) return { can: false, reason: 'Unknown infrastructure type' };

        // Check tech requirement
        if (infra.requiredTech && !Technology.isImplemented(player, infra.requiredTech)) {
            const tech = Technology.getTechByID(infra.requiredTech);
            return { can: false, reason: `Requires: ${tech ? tech.name : infra.requiredTech}` };
        }

        // Check gold
        let cost = infra.cost;
        // If upgrading from dirt to stone, reduce cost
        if (infra.upgradesFrom && tile.infrastructure && tile.infrastructure.id === infra.upgradesFrom) {
            cost = Math.floor(cost * 0.6); // 40% discount for upgrade
        }
        // Stone and timber close at hand cut the cost and the time
        const local = world ? Economy.constructionModifiers(world, tile.q, tile.r) : { cost: 1 };
        cost = Math.round(cost * local.cost);
        // A royal road-building programme (an edict of the realm, systems/kingship.js) pays for part of it
        if (world && tile.kingdom && /road|bridge/.test(infra.id) && typeof world.getKingdom === 'function') {
            const roadFx = KingdomBonuses.crownEffect(world.getKingdom(tile.kingdom), 'roadCost');
            if (roadFx) cost = Math.max(1, Math.round(cost * Math.max(0.1, 1 + roadFx)));
        }
        const buildDays = world ? Economy.scaleBuildDays(infra.buildTime || 0, world, tile.q, tile.r) : (infra.buildTime || 0);
        if (player.gold < cost) {
            return { can: false, reason: `Need ${cost} gold (have ${Math.floor(player.gold)})` };
        }

        // Check terrain passability
        if (!tile.terrain.passable) {
            return { can: false, reason: 'Cannot build on impassable terrain' };
        }

        // Check terrain requirements
        if (infra.requiredTerrain) {
            let terrainOk = infra.requiredTerrain.includes(tile.terrain.id);
            // Bridge: allow on tiles with rivers too
            if (!terrainOk && infra.allowRiverTiles && (tile.hasRiver || tile.river)) {
                terrainOk = true;
            }
            if (!terrainOk) {
                return { can: false, reason: `Requires ${infra.requiredTerrain.join(' or ')} terrain` };
            }
        }

        // Docks (jetties) need open water beside them; settlements on the
        // water are ports already
        if (infra.requiresCoast) {
            if (tile.settlement) {
                return { can: false, reason: 'Settlements on the water are already ports' };
            }
            if (!Infrastructure.isCoastal(tile, world)) {
                return { can: false, reason: 'Must be built on land next to open water' };
            }
        }

        // Check if same infrastructure already exists
        if (tile.infrastructure) {
            if (tile.infrastructure.id === infra.id) {
                return { can: false, reason: `Already has a ${infra.name} here` };
            }
            // Allow upgrade
            if (infra.upgradesFrom && tile.infrastructure.id === infra.upgradesFrom) {
                // OK — upgrading
            } else if (!infra.upgradesFrom) {
                // Can replace different types (e.g., road with irrigation or vice versa)
                // For simplicity, one infrastructure per tile
                return { can: false, reason: `Already has ${tile.infrastructure.name}. Remove it first.` };
            }
        }

        // Irrigation channels should only be on farm-suitable land
        if (infra.id === 'irrigation_channel') {
            // OK on required terrain (already checked)
        }

        return { can: true, cost, buildDays };
    },

    /**
     * Build infrastructure on a tile
     */
    build(player, infraType, tile, world) {
        const check = Infrastructure.canBuild(player, infraType, tile, world);
        if (!check.can) return { success: false, reason: check.reason };

        const infra = Infrastructure.TYPES[infraType.toUpperCase()];
        const cost = check.cost;

        player.gold -= cost;

        const buildDays = check.buildDays != null ? check.buildDays : (infra.buildTime || 0);

        // Place infrastructure on tile
        tile.infrastructure = {
            id: infra.id,
            name: infra.name,
            icon: infra.icon,
            moveCostOverride: infra.moveCostOverride,
            moveCostReduction: infra.moveCostReduction,
            productivityBonus: infra.productivityBonus || 0,
            isDock: !!infra.isDock,
            renderColor: infra.renderColor,
            renderWidth: infra.renderWidth,
            builtDay: world ? world.day : 0,
            underConstruction: buildDays > 0,
            constructionDaysLeft: buildDays,
            constructionDaysTotal: buildDays,
        };

        // Track tile coordinates for construction tick
        tile.infrastructure._tileQ = tile.q;
        tile.infrastructure._tileR = tile.r;

        if (infra.id === 'dirt_road' || infra.id === 'stone_road') Quests.track(player, 'roads_built');

        return { success: true, infrastructure: tile.infrastructure, cost, buildDays };
    },

    /**
     * Remove infrastructure from a tile (refund 25%)
     */
    demolish(player, tile) {
        if (!tile.infrastructure) return { success: false, reason: 'No infrastructure here' };

        const infra = Infrastructure.TYPES[tile.infrastructure.id.toUpperCase()] ||
            Object.values(Infrastructure.TYPES).find(t => t.id === tile.infrastructure.id);
        const refund = infra ? Math.floor(infra.cost * 0.25) : 0;

        player.gold += refund;
        const name = tile.infrastructure.name;
        tile.infrastructure = null;

        return { success: true, refund, name };
    },

    /** Water terrains a jetty can reach out into. */
    COAST_WATER: ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'],

    /** Is this land tile next to open water? */
    isCoastal(tile, world) {
        if (!tile || !world || !world.getTile) return false;
        return Hex.neighbors(tile.q, tile.r).some(n => {
            const t = world.getTile(n.q, n.r);
            return !!(t && t.terrain && Infrastructure.COAST_WATER.includes(t.terrain.id));
        });
    },

    /** Does this tile have a finished dock (a jetty) ships can berth at? */
    hasDock(tile) {
        const infra = tile && tile.infrastructure;
        return !!(infra && !infra.underConstruction && (infra.isDock || infra.id === 'jetty'));
    },

    // ═══════════════════════════════════════
    //  MOVEMENT COST CALCULATION
    // ═══════════════════════════════════════

    /**
     * Get effective movement cost for a tile, considering infrastructure
     */
    getEffectiveMoveCost(tile) {
        if (!tile || !tile.terrain.passable) return Infinity;

        let baseCost = tile.terrain.moveCost;

        if (tile.infrastructure && !tile.infrastructure.underConstruction) {
            // Stone road / bridge: override to fixed cost
            if (tile.infrastructure.moveCostOverride !== null && tile.infrastructure.moveCostOverride !== undefined) {
                return tile.infrastructure.moveCostOverride;
            }
            // Dirt road: reduce cost
            if (tile.infrastructure.moveCostReduction) {
                baseCost = Math.max(1, Math.ceil(baseCost * tile.infrastructure.moveCostReduction));
            }
        } else if (tile.hasRoad) {
            // World-generated roads (connecting settlements): ×0.5 by default; a
            // track, a highway, a rutted or ruined road, spring mud and a pass in
            // snow come from the road's state (world/transport.js bakes them)
            const m = tile.roadMove > 0 ? tile.roadMove : 0.5;
            baseCost = Math.max(1, Math.ceil(baseCost * m - 1e-9)) + (tile.roadExtra > 0 ? tile.roadExtra : 0);
        }

        return baseCost;
    },

    /** Extra stamina the player pays to ford a river tile with no crossing. */
    RIVER_CROSSING_PENALTY: 2,

    /**
     * Does a finished road or bridge on this tile already carry travellers
     * over its river? World-generated roads are drawn with a bridge where
     * they meet a river, so they count too. Irrigation channels don't.
     */
    hasRiverCrossing(tile) {
        const infra = tile.infrastructure;
        if (infra && !infra.underConstruction) {
            // Roads and bridges are the infrastructure that touches movement
            const isRoute = (infra.moveCostOverride !== null && infra.moveCostOverride !== undefined) ||
                !!infra.moveCostReduction;
            if (isRoute) return true;
        }
        // ...unless its bridge is down (a ford or a ferry: world/transport.js)
        return !!tile.hasRoad && tile.roadCross !== 'ford' && tile.roadCross !== 'ferry';
    },

    /**
     * Extra movement the player pays to enter a river tile: +2 by default,
     * 0 where a road/bridge spans it, reduced by riverCrossReduction techs
     * (Bridge Construction halves it to +1). Always an integer.
     */
    getRiverPenalty(tile, player) {
        if (!tile || !tile.hasRiver || !tile.terrain || !tile.terrain.passable) return 0;
        if (Infrastructure.hasRiverCrossing(tile)) return 0;
        // Bridge Construction, plus a Grand Bridge's wardens (systems/patronage.js → player.patronage.fx)
        const pfx = player && player.patronage && player.patronage.fx;
        const reduction = player ? Technology.getEffectTotal(player, 'riverCrossReduction')
            + (pfx && Number.isFinite(pfx.riverCross) ? pfx.riverCross : 0) : 0;
        const factor = Math.max(0, 1 - Math.min(1, reduction));
        // A road's ford or ferry is easier than wading where there is no road
        const base = tile.hasRoad && Number.isFinite(tile.roadCrossMove) ? tile.roadCrossMove : Infrastructure.RIVER_CROSSING_PENALTY;
        return Math.round(base * factor);
    },

    /**
     * Movement cost for the player specifically: the shared terrain/infra cost
     * plus the river-fording penalty. Kept separate from getEffectiveMoveCost
     * so world units and NPCs are unaffected.
     */
    getPlayerMoveCost(tile, player) {
        const base = Infrastructure.getEffectiveMoveCost(tile);
        if (base === Infinity) return base;
        return base + Infrastructure.getRiverPenalty(tile, player);
    },

    /**
     * Get farm productivity bonus from irrigation on this tile
     */
    getIrrigationBonus(tile) {
        if (!tile.infrastructure || tile.infrastructure.underConstruction) return 0;
        return tile.infrastructure.productivityBonus || 0;
    },

    // ═══════════════════════════════════════
    //  ROAD NETWORK HELPERS
    // ═══════════════════════════════════════

    /**
     * Check if two hexes are connected by a road network
     */
    hasRoadConnection(world, startQ, startR, endQ, endR) {
        // While a day is simulated the road network can't change: flood it
        // once per start (e.g. a capital with many colonies) and look the
        // end up in what the search would have reached
        if (typeof world.isSimulatingDay === 'function' && world.isSimulatingDay()
            && Number.isInteger(startQ) && Number.isInteger(startR) && Number.isInteger(endQ) && Number.isInteger(endR)) {
            return world.dayMemo('roadReach', startQ, startR, () => Infrastructure._roadReach(world, startQ, startR))
                .has(`${endQ},${endR}`);
        }
        // BFS only through road/bridge tiles (both world-generated and player-built)
        const visited = new Set();
        const queue = [{ q: startQ, r: startR }];
        visited.add(`${startQ},${startR}`);

        const startTile = world.getTile(startQ, startR);
        if (!startTile || (!startTile.infrastructure && !startTile.hasRoad)) return false;
        // Don't count under-construction infrastructure as usable roads
        if (startTile.infrastructure && startTile.infrastructure.underConstruction) {
            if (!startTile.hasRoad) return false;
        }

        while (queue.length > 0) {
            const current = queue.shift();
            if (current.q === endQ && current.r === endR) return true;

            const neighbors = Hex.neighbors(current.q, current.r);
            for (const n of neighbors) {
                const wq = Hex.wrapQ(n.q, world.width);
                const wr = n.r;
                if (wr < 0 || wr >= world.height) continue;

                const key = `${wq},${wr}`;
                if (visited.has(key)) continue;

                const nTile = world.getTile(wq, wr);
                if (!nTile) continue;

                // Accept world-generated roads
                if (nTile.hasRoad) {
                    visited.add(key);
                    queue.push({ q: wq, r: wr });
                    continue;
                }

                // Accept player-built road/bridge infrastructure (skip under construction)
                if (!nTile.infrastructure || nTile.infrastructure.underConstruction) continue;
                const isRoad = ['dirt_road', 'stone_road', 'bridge'].includes(nTile.infrastructure.id);
                if (!isRoad) continue;

                visited.add(key);
                queue.push({ q: wq, r: wr });
            }
        }
        return false;
    },

    /**
     * Every hex hasRoadConnection's search from (startQ, startR) would visit
     * if it never stopped early, as "q,r" keys (the start as given, the rest
     * wrapped). Empty when the start is not on a usable road.
     */
    _roadReach(world, startQ, startR) {
        const reached = new Set();
        const startTile = world.getTile(startQ, startR);
        if (!startTile || (!startTile.infrastructure && !startTile.hasRoad)) return reached;
        if (startTile.infrastructure && startTile.infrastructure.underConstruction && !startTile.hasRoad) return reached;

        const visited = new Set([`${startQ},${startR}`]);
        const queue = [{ q: startQ, r: startR }];
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            reached.add(`${current.q},${current.r}`);
            for (const n of Hex.neighbors(current.q, current.r)) {
                const wq = Hex.wrapQ(n.q, world.width);
                const wr = n.r;
                if (wr < 0 || wr >= world.height) continue;
                const key = `${wq},${wr}`;
                if (visited.has(key)) continue;
                const nTile = world.getTile(wq, wr);
                if (!nTile) continue;
                if (!nTile.hasRoad) {
                    if (!nTile.infrastructure || nTile.infrastructure.underConstruction) continue;
                    if (!['dirt_road', 'stone_road', 'bridge'].includes(nTile.infrastructure.id)) continue;
                }
                visited.add(key);
                queue.push({ q: wq, r: wr });
            }
        }
        return reached;
    },

    /**
     * Count total road tiles the player has built
     */
    countInfrastructure(world) {
        const counts = { dirt_road: 0, stone_road: 0, bridge: 0, irrigation_channel: 0, jetty: 0 };
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (tile.infrastructure && counts.hasOwnProperty(tile.infrastructure.id)) {
                    counts[tile.infrastructure.id]++;
                }
            }
        }
        return counts;
    },

    /**
     * Get available infrastructure types a player can build at a given tile
     */
    getAvailableTypes(player, tile, world) {
        const available = [];
        for (const [key, infra] of Object.entries(Infrastructure.TYPES)) {
            const check = Infrastructure.canBuild(player, key, tile, world);
            if (check.can) {
                available.push({ ...infra, actualCost: check.cost, actualDays: check.buildDays });
            }
        }
        return available;
    },
};
