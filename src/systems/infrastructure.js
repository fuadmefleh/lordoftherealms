// ============================================
// INFRASTRUCTURE — Roads, bridges, irrigation
// ============================================

import { Technology } from './technology.js';
import { Hex } from '../core/hex.js';


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
            if (!terrainOk && infra.allowRiverTiles && tile.river) {
                terrainOk = true;
            }
            if (!terrainOk) {
                return { can: false, reason: `Requires ${infra.requiredTerrain.join(' or ')} terrain` };
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

        return { can: true, cost };
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

        const buildDays = infra.buildTime || 0;

        // Place infrastructure on tile
        tile.infrastructure = {
            id: infra.id,
            name: infra.name,
            icon: infra.icon,
            moveCostOverride: infra.moveCostOverride,
            moveCostReduction: infra.moveCostReduction,
            productivityBonus: infra.productivityBonus || 0,
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
            // World-generated roads (connecting settlements) act like dirt roads
            baseCost = Math.max(1, Math.ceil(baseCost * 0.5));
        }

        return baseCost;
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
     * Count total road tiles the player has built
     */
    countInfrastructure(world) {
        const counts = { dirt_road: 0, stone_road: 0, bridge: 0, irrigation_channel: 0 };
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
                available.push({ ...infra, actualCost: check.cost });
            }
        }
        return available;
    },
};
