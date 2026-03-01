// ============================================
// ECONOMY — Settlement economics and trade
// ============================================

import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Kingdom } from './kingdom.js';

export const Economy = {
    /**
     * Production rates per settlement type (per day)
     */
    PRODUCTION_RATES: {
        capital: { baseGold: 50, baseFood: 100, baseGoods: 30 },
        city: { baseGold: 30, baseFood: 60, baseGoods: 20 },
        town: { baseGold: 15, baseFood: 30, baseGoods: 10 },
        village: { baseGold: 5, baseFood: 15, baseGoods: 3 },
    },

    /**
     * Resource bonuses (multipliers)
     */
    RESOURCE_BONUSES: {
        iron: { goods: 1.3, military: 1.2 },
        gold_ore: { gold: 1.5 },
        gems: { gold: 1.8, trade: 1.2 },
        timber: { goods: 1.2, construction: 1.3 },
        wheat: { food: 1.5 },
        fish: { food: 1.3 },
        horses: { military: 1.4, trade: 1.1 },
        spices: { gold: 1.3, trade: 1.4 },
        stone: { construction: 1.5, goods: 1.1 },
        salt: { food: 1.2, trade: 1.2 },
    },

    /**
     * Initialize economy data for a settlement
     */
    initSettlement(settlement) {
        if (!settlement.economy) {
            settlement.economy = {
                gold: 0,
                food: 0,
                goods: 0,
                production: { gold: 0, food: 0, goods: 0 },
                tradeRoutes: [],
                resources: [],
            };
        }
        return settlement;
    },

    /**
     * Calculate detailed production for a settlement
     */
    calculateDetailedProduction(settlement, tile, world) {
        const rates = Economy.PRODUCTION_RATES[settlement.type] || Economy.PRODUCTION_RATES.village;
        const popMod = 1 + (settlement.population / 10000) * 0.5;

        const breakdown = {
            gold: rates.baseGold * popMod,
            food: rates.baseFood * popMod,
            items: {
                'textiles': rates.baseGoods * popMod // Urban manufacturing base
            }
        };

        // Helper to apply resource bonuses
        const applyResource = (resId, isDirect) => {
            const bonus = Economy.RESOURCE_BONUSES[resId];
            if (!bonus) return;

            const multiplier = isDirect ? 1.0 : 0.5;

            if (bonus.gold) breakdown.gold *= (1 + (bonus.gold - 1) * multiplier);
            if (bonus.food) breakdown.food *= (1 + (bonus.food - 1) * multiplier);

            // Map terrain resources to specific GOODS
            const resourceToGood = {
                'iron': 'iron',
                'gold_ore': 'gold_ore',
                'gems': 'gems',
                'timber': 'wood',
                'wheat': 'food',
                'fish': 'food',
                'stone': 'stone',
                'spices': 'spices',
                'horses': 'horses'
            };

            const goodId = resourceToGood[resId];
            if (goodId) {
                // Determine base production for this specific resource
                let baseProd = isDirect ? 8 : 4;
                if (goodId === 'food') baseProd *= 1.5; // Food resources produce more volume

                const prod = baseProd * popMod;
                breakdown.items[goodId] = (breakdown.items[goodId] || 0) + prod;
            }
        };

        // Apply direct resource
        if (tile.resource) {
            applyResource(tile.resource.id, true);
        }

        // Apply nearby resources (within 2 hex radius)
        const nearbyResources = Economy.getNearbyResources(tile.q, tile.r, world, 2);
        for (const res of nearbyResources) {
            applyResource(res.id, false);
        }

        // Round all values
        breakdown.gold = Math.round(breakdown.gold);
        breakdown.food = Math.round(breakdown.food);
        for (const key in breakdown.items) {
            breakdown.items[key] = Math.round(breakdown.items[key]);
        }

        return breakdown;
    },

    /**
     * Calculate production for a settlement based on its tile and surroundings
     */
    calculateProduction(settlement, tile, world) {
        const detailed = Economy.calculateDetailedProduction(settlement, tile, world);

        // Sum total goods for legacy/summary views
        let totalItems = 0;
        for (const key in detailed.items) {
            if (key !== 'food') { // Food is tracked separately in economy.food
                totalItems += detailed.items[key];
            }
        }

        settlement.economy.production = {
            gold: detailed.gold,
            food: Math.round(detailed.food + (detailed.items.food || 0)),
            goods: totalItems,
            breakdown: detailed // Store breakdown for UI
        };

        return settlement.economy.production;
    },

    /**
     * Get resources within a radius of a hex
     */
    getNearbyResources(centerQ, centerR, world, radius) {
        const resources = [];
        const hexes = Hex.hexesInRange(centerQ, centerR, radius);

        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (tile && tile.resource) {
                resources.push(tile.resource);
            }
        }

        return resources;
    },

    /**
     * Process one day of production for a settlement
     */
    produceDaily(settlement, tile, world) {
        Economy.initSettlement(settlement);
        const prod = Economy.calculateProduction(settlement, tile, world);

        settlement.economy.gold += prod.gold;
        settlement.economy.food += prod.food;

        // Store specific goods in stockpile if settlement handles it
        if (!settlement.economy.stockpile) {
            settlement.economy.stockpile = { food: 0, gold: 0, goods: 0 };
        }

        for (const [item, amount] of Object.entries(prod.breakdown.items)) {
            if (item === 'food') continue; // Food handled above
            settlement.economy.stockpile[item] = (settlement.economy.stockpile[item] || 0) + amount;
        }

        // Legacy compatibility
        settlement.economy.goods += prod.goods;

        // Population growth based on food surplus
        const foodConsumption = settlement.population * 0.1; // Each person needs 0.1 food/day
        const foodSurplus = settlement.economy.food - foodConsumption;

        if (foodSurplus > 0) {
            // Grow population slowly
            const growthRate = Math.min(foodSurplus / settlement.population, 0.001); // Max 0.1% per day
            settlement.population = Math.floor(settlement.population * (1 + growthRate));
        } else if (foodSurplus < -foodConsumption * 0.5) {
            // Shrink population if severe food shortage
            settlement.population = Math.floor(settlement.population * 0.999);
        }

        // Consume food
        settlement.economy.food = Math.max(0, settlement.economy.food - foodConsumption);

        return settlement.economy;
    },

    /**
     * Create a trade route between two settlements
     */
    createTradeRoute(settlement1, settlement2, distance) {
        const route = {
            from: settlement1.name,
            to: settlement2.name,
            distance,
            profit: Math.max(5, Math.floor(50 / (1 + distance * 0.1))), // Profit decreases with distance
            active: true,
        };

        Economy.initSettlement(settlement1);
        Economy.initSettlement(settlement2);

        settlement1.economy.tradeRoutes.push(route);
        settlement2.economy.tradeRoutes.push({ ...route, from: settlement2.name, to: settlement1.name });

        return route;
    },

    /**
     * Process trade routes for a settlement
     */
    processTrade(settlement) {
        if (!settlement.economy || !settlement.economy.tradeRoutes) return 0;

        let totalProfit = 0;
        for (const route of settlement.economy.tradeRoutes) {
            if (route.active) {
                totalProfit += route.profit;
            }
        }

        settlement.economy.gold += totalProfit;
        return totalProfit;
    },

    /**
     * Get the total wealth of a settlement
     */
    getWealth(settlement) {
        if (!settlement.economy) return 0;
        return settlement.economy.gold + settlement.economy.goods * 2;
    },

    /**
     * Get economic summary for a settlement
     */
    getSummary(settlement, tile, world) {
        Economy.initSettlement(settlement);
        Economy.calculateProduction(settlement, tile, world);

        return {
            population: settlement.population,
            production: settlement.economy.production,
            stockpile: {
                gold: settlement.economy.gold,
                food: settlement.economy.food,
                goods: settlement.economy.goods,
            },
            tradeRoutes: settlement.economy.tradeRoutes.length,
            wealth: Economy.getWealth(settlement),
        };
    },
};

// ============================================
// TRADE ROUTES — Trade route management
// ============================================

export const TradeRoutes = {
    /**
     * Find potential trade routes for a kingdom
     */
    findPotentialRoutes(kingdom, world, maxDistance = 15) {
        const routes = [];
        const settlements = world.getAllSettlements();
        const kingdomSettlements = settlements.filter(s => s.kingdom === kingdom.id);

        for (const s1 of kingdomSettlements) {
            for (const s2 of settlements) {
                // Don't trade with self
                if (s1.q === s2.q && s1.r === s2.r) continue;

                // Calculate distance
                const dist = Hex.wrappingDistance(s1.q, s1.r, s2.q, s2.r, world.width);

                if (dist <= maxDistance) {
                    // Check if route already exists
                    const exists = s1.economy?.tradeRoutes?.some(r => r.to === s2.name);
                    if (!exists) {
                        routes.push({
                            from: s1,
                            to: s2,
                            distance: dist,
                            profit: Math.max(5, Math.floor(50 / (1 + dist * 0.1))),
                        });
                    }
                }
            }
        }

        return routes;
    },

    /**
     * Establish trade routes for a kingdom
     */
    establishRoutes(kingdom, world) {
        const potential = TradeRoutes.findPotentialRoutes(kingdom, world);

        // Sort by profit and establish top routes
        potential.sort((a, b) => b.profit - a.profit);

        const numRoutes = Math.min(potential.length, Utils.randInt(2, 5));
        const established = [];

        for (let i = 0; i < numRoutes; i++) {
            const route = potential[i];
            Economy.createTradeRoute(route.from, route.to, route.distance);
            established.push(route);
        }

        return established;
    },
};
