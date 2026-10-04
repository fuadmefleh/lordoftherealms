// ============================================
// ECONOMY — Settlement economics and trade
// ============================================

import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Kingdom } from './kingdom.js';
import { Seasons } from './seasons.js';

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
        coal: { goods: 1.25, military: 1.1 },
        oil: { trade: 1.3, gold: 1.1 },
        cattle: { food: 1.3, goods: 1.1 },
    },

    /** What each map resource yields as settlement goods (data/economy.json). */
    RESOURCE_GOODS: {
        iron: ['iron'], gold_ore: ['gold_ore'], gems: ['gems'], timber: ['wood'],
        wheat: ['food'], fish: ['food'], stone: ['stone'], spices: ['spices'],
        horses: ['horses'], coal: ['coal'], oil: ['oil'], cattle: ['food', 'hide'],
    },

    /**
     * How the goods / military / trade / construction bonuses turn into
     * effects (see data/economy.json "resourceEffects._doc").
     */
    RESOURCE_EFFECTS: {
        radius: 2,
        nearbyWeight: 0.5,
        cap: 0.5,
        scales: {
            goods: 1, recruitCost: 0.5, armyRegen: 1, routeIncome: 1, caravanProfit: 0.5,
            salePrice: 0.25, buildCost: 0.5, buildTime: 0.5, repair: 1,
        },
    },

    /** Player properties that run better on or beside a resource. */
    PROPERTY_RESOURCE_BONUSES: {
        coal: { properties: ['forge', 'blacksmith', 'glassworks'], bonus: 0.25, radius: 1, label: 'coal-fired' },
        cattle: { properties: ['cattle_ranch', 'dairy', 'tannery'], bonus: 0.3, radius: 1, label: 'local herds' },
        oil: { properties: ['chandlery'], bonus: 0.2, radius: 1, label: 'oil seep' },
    },

    /** The bonus kinds that are applied outside gold/food production. */
    BONUS_KINDS: ['goods', 'military', 'trade', 'construction'],

    /** Scale for one effect of the resource bonuses (0 when unknown). */
    effectScale(key) {
        const scales = (Economy.RESOURCE_EFFECTS && Economy.RESOURCE_EFFECTS.scales) || {};
        return Number.isFinite(scales[key]) ? scales[key] : 0;
    },

    /**
     * Fractional bonus of one kind ('goods', 'military', 'trade',
     * 'construction', ...) that map resources give a hex: a resource on the
     * hex counts in full, one within the radius at `nearbyWeight`. Capped.
     * @returns {number} 0 .. cap
     */
    resourceBonus(world, q, r, kind) {
        return Economy.resourceBonuses(world, q, r)[kind] || 0;
    },

    /**
     * Every bonus kind at a hex, plus the resources that supply them.
     * @returns {{goods:number, military:number, trade:number, construction:number, sources:Array<{id:string, direct:boolean}>}}
     */
    resourceBonuses(world, q, r) {
        const out = { goods: 0, military: 0, trade: 0, construction: 0, sources: [] };
        if (!world || typeof world.getTile !== 'function' || !Number.isFinite(q) || !Number.isFinite(r)) return out;
        const fx = Economy.RESOURCE_EFFECTS || {};
        const radius = Number.isFinite(fx.radius) ? fx.radius : 2;
        const nearby = Number.isFinite(fx.nearbyWeight) ? fx.nearbyWeight : 0.5;
        const cap = Number.isFinite(fx.cap) ? fx.cap : 0.5;
        for (const hex of Hex.hexesInRange(q, r, radius)) {
            const tile = world.getTile(hex.q, hex.r);
            const id = tile && tile.resource && tile.resource.id;
            const bonus = id && Economy.RESOURCE_BONUSES[id];
            if (!bonus) continue;
            const direct = hex.q === q && hex.r === r;
            const weight = direct ? 1 : nearby;
            let counted = false;
            for (const kind of Economy.BONUS_KINDS) {
                if (!(bonus[kind] > 1)) continue;
                out[kind] += (bonus[kind] - 1) * weight;
                counted = true;
            }
            if (counted) out.sources.push({ id, direct });
        }
        for (const kind of Economy.BONUS_KINDS) out[kind] = Math.min(cap, out[kind]);
        return out;
    },

    /**
     * Cost and time multipliers for building on a hex: stone and timber
     * nearby make construction cheaper and faster.
     * @returns {{cost:number, time:number, bonus:number}}
     */
    constructionModifiers(world, q, r) {
        const bonus = Economy.resourceBonus(world, q, r, 'construction');
        return {
            bonus,
            cost: 1 - bonus * Economy.effectScale('buildCost'),
            time: 1 - bonus * Economy.effectScale('buildTime'),
        };
    },

    /** Build days after the local construction bonus (never below 1 if it was above 0). */
    scaleBuildDays(days, world, q, r) {
        if (!(days > 0)) return days || 0;
        return Math.max(1, Math.round(days * Economy.constructionModifiers(world, q, r).time));
    },

    /** Multiplier on recruiting soldiers at a settlement with iron, horses or coal near it. */
    recruitCostMultiplier(world, settlement) {
        if (!settlement) return 1;
        const bonus = world ? Economy.resourceBonus(world, settlement.q, settlement.r, 'military')
            : ((settlement.economy && settlement.economy.resourceBonuses && settlement.economy.resourceBonuses.military) || 0);
        return 1 - bonus * Economy.effectScale('recruitCost');
    },

    /** Multiplier on the profit a caravan earns selling at this settlement. */
    caravanProfitMultiplier(world, settlement) {
        if (!settlement) return 1;
        return 1 + Economy.resourceBonus(world, settlement.q, settlement.r, 'trade') * Economy.effectScale('caravanProfit');
    },

    /** Extra sale-price fraction in a settlement whose markets draw traders (cached daily). */
    saleBonus(settlement) {
        const b = settlement && settlement.economy && settlement.economy.resourceBonuses;
        return b ? (b.trade || 0) * Economy.effectScale('salePrice') : 0;
    },

    /**
     * Bonus a player property gets from a resource on or beside its tile
     * (coal-fired forges, herds for ranches and dairies, oil for chandlers).
     * The best matching resource counts once.
     * @returns {{bonus:number, resource:string|null, label:string|null}}
     */
    propertyResourceBonus(world, tile, propertyType) {
        const none = { bonus: 0, resource: null, label: null };
        if (!world || !tile || !propertyType || typeof world.getTile !== 'function') return none;
        let best = none;
        for (const [resId, def] of Object.entries(Economy.PROPERTY_RESOURCE_BONUSES || {})) {
            if (!def || !Array.isArray(def.properties) || !def.properties.includes(propertyType)) continue;
            if (!(def.bonus > best.bonus)) continue;
            const near = Hex.hexesInRange(tile.q, tile.r, def.radius || 0).some(h => {
                const t = world.getTile(h.q, h.r);
                return t && t.resource && t.resource.id === resId;
            });
            if (near) best = { bonus: def.bonus, resource: resId, label: def.label || resId };
        }
        return best;
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

            // Map terrain resources to specific GOODS (cattle give food and hides)
            const goods = (Economy.RESOURCE_GOODS && Economy.RESOURCE_GOODS[resId]) || [];
            const list = Array.isArray(goods) ? goods : [goods];
            list.forEach((goodId, i) => {
                // Determine base production for this specific resource
                let baseProd = isDirect ? 8 : 4;
                if (goodId === 'food') baseProd *= 1.5; // Food resources produce more volume
                if (i > 0) baseProd *= 0.5;             // By-products (hides from cattle) come in smaller amounts

                const prod = baseProd * popMod;
                breakdown.items[goodId] = (breakdown.items[goodId] || 0) + prod;
            });
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

        // Goods, military, trade and construction bonuses from nearby
        // resources. Goods lift every crafted/raw good the town turns out;
        // the rest are cached for recruitment, trade and repairs.
        const resBonuses = Economy.resourceBonuses(world, tile.q, tile.r);
        breakdown.resourceBonuses = resBonuses;
        const goodsMult = 1 + resBonuses.goods * Economy.effectScale('goods');
        if (goodsMult !== 1) {
            for (const key in breakdown.items) {
                if (key !== 'food') breakdown.items[key] *= goodsMult;
            }
        }

        // The settlement's peoples: crafts, enterprise and husbandry
        // (settlement.peoplesEffects, computed daily by systems/peoples)
        const pe = settlement.peoplesEffects;
        if (pe) {
            breakdown.gold *= 1 + (pe.gold || 0);
            breakdown.food *= 1 + (pe.food || 0);
            for (const key in breakdown.items) {
                breakdown.items[key] *= 1 + ((key === 'food' ? pe.food : pe.goods) || 0);
            }
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
        // Cached for systems that only hold the settlement (recruitment, sales)
        const rb = detailed.resourceBonuses || {};
        settlement.economy.resourceBonuses = {
            goods: rb.goods || 0, military: rb.military || 0, trade: rb.trade || 0, construction: rb.construction || 0,
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
     * Food model. Most people grow their own food (subsistence), so only the
     * gap is felt: villages run a small surplus, cities a deficit they cover
     * by buying food with their own gold. Growth slows towards a size cap per
     * settlement type; real shortfalls (broke and hungry) shrink the place.
     */
    FOOD: {
        perCapita: 0.1,                // food eaten per person per day
        selfSufficiency: { village: 1.0, town: 0.92, city: 0.82, capital: 0.75 },
        capacity: { village: 1500, town: 5000, city: 15000, capital: 30000 },
        importPrice: 0.5,              // gold per unit of food bought in
        maxGrowth: 0.0003,             // per day, before the capacity taper
        starvation: 0.003,             // daily loss at a 100% shortfall
        stockDays: 10,                 // granary holds this many days' needs
    },

    /** Feed a settlement for one day and grow or shrink its population. */
    _feedPopulation(settlement, mods = {}) {
        const F = Economy.FOOD;
        const econ = settlement.economy;
        const pop = Math.max(0, settlement.population || 0);
        if (pop <= 0) return;
        const type = F.capacity[settlement.type] ? settlement.type : 'village';

        // Refugee waves and similar raise consumption
        const needed = pop * F.perCapita * Math.max(0, 1 + (mods.consumption || 0));
        let available = econ.food + pop * F.perCapita * F.selfSufficiency[type];

        // Short? Buy food in with the settlement's own gold
        if (available < needed && econ.gold > 0) {
            const buy = Math.min(needed - available, Math.floor(econ.gold / F.importPrice));
            if (buy > 0) {
                econ.gold -= Math.ceil(buy * F.importPrice);
                econ.foodImported = (econ.foodImported || 0) + buy;
                available += buy;
            }
        }

        const surplus = available - needed;
        let change = 0;
        if (surplus > 0) {
            const cap = F.capacity[type];
            const taper = Math.max(0, 1 - pop / cap);
            const rate = Math.min(surplus / pop, F.maxGrowth) * taper * Math.max(0, 1 + (mods.growth || 0));
            if (rate > 0) change = pop * rate;
        } else if (surplus < 0) {
            change = -pop * F.starvation * (-surplus / needed);
        }
        // Daily change is often a fraction of a person; carry it over so small
        // places still grow (and starve) instead of rounding to nothing
        const total = (econ.popCarry || 0) + change;
        const whole = Math.trunc(total);
        econ.popCarry = total - whole;
        if (whole !== 0) settlement.population = Math.max(10, pop + whole);

        // What isn't eaten goes to the granary (bounded)
        econ.food = Math.min(Math.max(0, surplus), needed * F.stockDays);
    },

    /**
     * Process one day of production for a settlement
     * @param {Object} [playerBonuses] - { colonyFood } from the player's techs,
     *   applied to the player's own colonies only
     */
    produceDaily(settlement, tile, world, playerBonuses = {}, mods = {}) {
        Economy.initSettlement(settlement);
        const prod = Economy.calculateProduction(settlement, tile, world);

        // mods (from KingdomAI): { growth, consumption, production } fractional modifiers
        // from rulers and world events; damage (0-0.9) from floods/quakes
        // cuts gold and goods until repaired; production (colony policy, e.g.
        // Exploitation +0.3) scales gold and goods the other way
        const intact = 1 - Math.min(0.9, Math.max(0, mods.damage || 0));
        const output = intact * Math.max(0, 1 + (mods.production || 0));
        if (output !== 1) {
            prod.gold = Math.round(prod.gold * output);
            prod.goods = Math.round(prod.goods * output);
        }

        settlement.economy.gold += prod.gold;
        // The agricultural year: little comes to market at planting time and
        // in winter, a glut at harvest (yearly mean 1 — world/seasons.js)
        const seasonal = Seasons.settlementFoodMultiplier(Seasons.today(world));
        prod.seasonalFood = Math.round(prod.food * seasonal);
        // Aqueducts feed the player's colonies
        const foodBonus = settlement.colony && settlement.colony.isPlayerColony ? (playerBonuses.colonyFood || 0) : 0;
        settlement.economy.food += foodBonus > 0 ? Math.round(prod.seasonalFood * (1 + foodBonus)) : prod.seasonalFood;

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

        // Close-knit peoples (kinship) grow faster
        const kinship = settlement.peoplesEffects ? (settlement.peoplesEffects.growth || 0) : 0;
        Economy._feedPopulation(settlement, kinship ? { ...mods, growth: (mods.growth || 0) + kinship } : mods);

        // Thin granaries in the lean weeks sour the mood (on the live settlement;
        // getAllSettlements hands out copies)
        Economy.applyLeanSeason((tile && tile.settlement) || settlement, Seasons.today(world), settlement.economy);

        return settlement.economy;
    },

    /**
     * Days of food a settlement has put by, measured against what it must
     * bring in from outside (its need beyond what its people grow for
     * themselves — at least 5% of the need, so even villages count).
     */
    foodReserveDays(settlement, econ = settlement && settlement.economy) {
        const F = Economy.FOOD;
        const pop = Math.max(0, (settlement && settlement.population) || 0);
        if (pop <= 0 || !econ) return Infinity;
        const type = F.selfSufficiency[settlement.type] !== undefined ? settlement.type : 'village';
        const marketNeed = pop * F.perCapita * Math.max(0.05, 1 - F.selfSufficiency[type]);
        return Math.max(0, econ.food || 0) / marketNeed;
    },

    /**
     * The lean season: in late winter and early spring a settlement with
     * fewer than Seasons.CONFIG.lean.reserveDays of food in store loses
     * happiness (up to maxPenalty points), moving `step` points a day. The
     * points come back as the stores recover or the season turns. Tracked in
     * settlement.leanMood so nothing is lost or gained over a year.
     */
    applyLeanSeason(settlement, day, econ = settlement && settlement.economy) {
        if (!settlement || !econ) return 0;
        const L = Seasons.CONFIG.lean || {};
        const step = L.step > 0 ? L.step : 1;
        const target = Seasons.leanPenalty(day, Economy.foodReserveDays(settlement, econ));
        const cur = settlement.leanMood || 0;
        const next = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
        const delta = next - cur;
        if (delta === 0) return 0;
        settlement.leanMood = Math.round(next * 100) / 100;
        if (settlement.leanMood === 0) delete settlement.leanMood;
        const happiness = typeof settlement.happiness === 'number' ? settlement.happiness : 50;
        settlement.happiness = Math.max(0, Math.min(100, happiness - delta));
        return delta;
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
        // Mercantile peoples and trader diasporas work the routes harder
        const commerce = settlement.peoplesEffects ? (settlement.peoplesEffects.trade || 0) : 0;
        if (commerce && totalProfit > 0) totalProfit = Math.round(totalProfit * (1 + commerce));
        // Gems, spices, salt, horses and oil nearby draw merchants
        const rb = settlement.economy.resourceBonuses;
        const tradeMult = 1 + ((rb && rb.trade) || 0) * Economy.effectScale('routeIncome');
        if (tradeMult !== 1 && totalProfit > 0) totalProfit = Math.round(totalProfit * tradeMult);

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
            resourceBonuses: settlement.economy.production.breakdown.resourceBonuses,
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
