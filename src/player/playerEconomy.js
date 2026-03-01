// ============================================
// PLAYER ECONOMY — Economic path systems
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { InnerMap } from '../world/innerMap.js';
import { Quests } from '../systems/quests.js';
import { Technology } from '../systems/technology.js';
import { Infrastructure } from '../systems/infrastructure.js';


export const PlayerEconomy = {
    /**
     * Property types the player can own
     */
    PROPERTY_TYPES: {
        FARM: {
            id: 'farm',
            name: 'Farm',
            icon: '🌾',
            cost: 500,
            constructionDays: 5,
            produces: 'grain', // Changed from 'food'
            productionRate: 10,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland'],
            description: 'Produces grain that can be milled or sold. Upkeep: 5g/day'
        },
        PASTURE: {
            id: 'pasture',
            name: 'Pasture',
            icon: '🐑',
            cost: 500,
            constructionDays: 4,
            produces: 'wool',
            productionRate: 8,
            upkeep: 5,
            requiredTerrain: ['plains', 'grassland', 'hills'],
            description: 'Raises sheep for wool. Upkeep: 5g/day'
        },
        LOGGING_CAMP: {
            id: 'logging_camp',
            name: 'Logging Camp',
            icon: '🪓',
            cost: 400,
            constructionDays: 3,
            produces: 'wood',
            productionRate: 6,
            upkeep: 5,
            requiredTerrain: ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest'],
            description: 'Harvests wood from forests. Upkeep: 5g/day'
        },
        MINE: {
            id: 'mine',
            name: 'Mine',
            icon: '⛏️',
            cost: 1000,
            constructionDays: 10,
            produces: 'iron',
            productionRate: 5,
            upkeep: 15,
            requiredResource: ['iron', 'gold_ore', 'gems', 'stone'],
            description: 'Extracts valuable resources for sale. Upkeep: 15g/day'
        },
        WORKSHOP: {
            id: 'workshop',
            name: 'Workshop',
            icon: '🔨',
            cost: 800,
            constructionDays: 7,
            produces: null, // Variable based on recipe
            productionRate: 5, // Process rate
            upkeep: 10,
            requiredSettlement: true,
            description: 'Processes raw materials into goods. Upkeep: 10g/day'
        },
        TRADING_POST: {
            id: 'trading_post',
            name: 'Trading Post',
            icon: '🏪',
            cost: 600,
            constructionDays: 6,
            produces: null,
            productionRate: 0,
            upkeep: 5,
            requiredSettlement: true,
            description: 'Attracts traveling merchants. Upkeep: 5g/day'
        },
        FISHING_WHARF: {
            id: 'fishing_wharf',
            name: 'Fishing Wharf',
            icon: '⚓',
            cost: 800,
            constructionDays: 8,
            produces: 'fish',
            productionRate: 0, // Depends on boats
            upkeep: 10,
            requiredTerrain: ['coast', 'beach'],
            description: 'Send boats to collect fish from nearby waters. Upkeep: 10g/day'
        },
        BREWERY: {
            id: 'brewery',
            name: 'Brewery',
            icon: '🍺',
            cost: 700,
            constructionDays: 6,
            produces: null, // Variable based on recipe (beer or liquor)
            productionRate: 6,
            upkeep: 8,
            requiredSettlement: true,
            description: 'Brews beer from grain or distills liquor. Sells well at taverns. Upkeep: 8g/day'
        },
        TAVERN: {
            id: 'tavern',
            name: 'Tavern',
            icon: '🍻',
            cost: 900,
            constructionDays: 8,
            produces: 'gold', // Earns gold directly from patrons
            productionRate: 0, // Income calculated dynamically based on settlement size
            upkeep: 12,
            requiredSettlement: true,
            description: 'A place for drink, gambling, and gossip. Earns gold daily from patrons. Upkeep: 12g/day'
        },
    },

    /**
     * Goods and their base prices
     */
    GOODS: {
        GRAIN: { id: 'grain', name: 'Grain', icon: '🌾', basePrice: 5 },
        FLOUR: { id: 'flour', name: 'Flour', icon: '🥡', basePrice: 10 },
        BREAD: { id: 'bread', name: 'Bread', icon: '🍞', basePrice: 15 },
        FISH: { id: 'fish', name: 'Raw Fish', icon: '🐟', basePrice: 8 },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoked Fish', icon: '🍥', basePrice: 20 },
        WOOD: { id: 'wood', name: 'Wood', icon: '🌲', basePrice: 8 },
        FIREWOOD: { id: 'firewood', name: 'Firewood', icon: '🔥', basePrice: 12 },
        WOOL: { id: 'wool', name: 'Wool', icon: '🐑', basePrice: 10 },
        TEXTILES: { id: 'textiles', name: 'Textiles', icon: '🧵', basePrice: 25 },
        CLOTHES: { id: 'clothes', name: 'Clothes', icon: '👕', basePrice: 40 },
        STONE: { id: 'stone', name: 'Stone', icon: '⛰️', basePrice: 8 },
        IRON: { id: 'iron', name: 'Iron', icon: '⚒️', basePrice: 20 },
        TOOLS: { id: 'tools', name: 'Tools', icon: '🔧', basePrice: 35 },
        WEAPONS: { id: 'weapons', name: 'Weapons', icon: '⚔️', basePrice: 60 },
        GOLD_ORE: { id: 'gold_ore', name: 'Gold Ore', icon: '💰', basePrice: 40 },
        GEMS: { id: 'gems', name: 'Gems', icon: '💎', basePrice: 60 },
        SPICES: { id: 'spices', name: 'Spices', icon: '🧂', basePrice: 45 },
        HORSES: { id: 'horses', name: 'Horses', icon: '🐴', basePrice: 55 },
        BEER: { id: 'beer', name: 'Beer', icon: '🍺', basePrice: 12 },
        LIQUOR: { id: 'liquor', name: 'Liquor', icon: '🥃', basePrice: 30 },
        LUXURIES: { id: 'luxuries', name: 'Luxuries', icon: '💍', basePrice: 100 },
        // Fishing catches
        SMALL_FISH: { id: 'small_fish', name: 'Small Fry', icon: '🐠', basePrice: 3 },
        LARGE_FISH: { id: 'large_fish', name: 'Large Cod', icon: '🐟', basePrice: 12 },
        CRAB: { id: 'crab', name: 'Crab', icon: '🦀', basePrice: 14 },
        SWORDFISH: { id: 'swordfish', name: 'Swordfish', icon: '🗡️', basePrice: 28 },
        LOBSTER: { id: 'lobster', name: 'Lobster', icon: '🦞', basePrice: 22 },
        GOLDEN_FISH: { id: 'golden_fish', name: 'Golden Fish', icon: '✨', basePrice: 55 },
        BOOT: { id: 'boot', name: 'Old Boot', icon: '👢', basePrice: 0 },
        SEAWEED: { id: 'seaweed', name: 'Seaweed', icon: '🌿', basePrice: 2 },
        // Prospecting finds
        ORE: { id: 'ore', name: 'Iron Ore', icon: '⛏️', basePrice: 25 },
        // Foraging / hunting misc
        HERBS: { id: 'herbs', name: 'Herbs', icon: '🌿', basePrice: 5 },
        PELTS: { id: 'pelts', name: 'Pelts', icon: '🦊', basePrice: 12 },
        BERRIES: { id: 'berries', name: 'Berries', icon: '🫐', basePrice: 3 },
        MUSHROOMS: { id: 'mushrooms', name: 'Mushrooms', icon: '🍄', basePrice: 4 },
        MEAT: { id: 'meat', name: 'Meat', icon: '🥩', basePrice: 6 },
        HIDE: { id: 'hide', name: 'Hide', icon: '🟤', basePrice: 8 },
        ANTLER: { id: 'antler', name: 'Antler', icon: '🦌', basePrice: 15 },
        FEATHER: { id: 'feather', name: 'Feather', icon: '🪶', basePrice: 4 },
        HORSE: { id: 'horse', name: 'Horse', icon: '🐴', basePrice: 120 },
        // Technology Parts
        AGRI_PARTS: { id: 'agri_parts', name: 'Agricultural Implements', icon: '🌱', basePrice: 50 },
        INDUSTRY_PARTS: { id: 'industry_parts', name: 'Industrial Components', icon: '⚙️', basePrice: 75 },
        MILITARY_PARTS: { id: 'military_parts', name: 'Military Supplies', icon: '🗡️', basePrice: 80 },
        INFRA_PARTS: { id: 'infra_parts', name: 'Engineering Plans', icon: '📐', basePrice: 60 },
        COMMERCE_PARTS: { id: 'commerce_parts', name: 'Trade Documents', icon: '📜', basePrice: 50 },
    },

    /**
     * Crafting Recipes for Workshops
     */
    RECIPES: {
        FIREWOOD: { id: 'firewood', name: 'Split Firewood', input: 'wood', inputQty: 2, output: 'firewood', outputQty: 5, description: 'Prepare fuel for heating.' },
        FLOUR: { id: 'flour', name: 'Mill Flour', input: 'grain', inputQty: 2, output: 'flour', outputQty: 2, description: 'Grind grain into flour.' },
        BREAD: { id: 'bread', name: 'Bake Bread', input: 'flour', inputQty: 1, output: 'bread', outputQty: 4, description: 'Bake nutritious bread.' },
        PRESERVED_FISH: { id: 'preserved_fish', name: 'Smoke Fish', input: 'fish', inputQty: 2, output: 'preserved_fish', outputQty: 3, description: 'Preserve fish for long-term storage.' },
        TEXTILES: { id: 'textiles', name: 'Weave Textiles', input: 'wool', inputQty: 3, output: 'textiles', outputQty: 2, description: 'Weave wool into cloth.' },
        CLOTHES: { id: 'clothes', name: 'Tailor Clothes', input: 'textiles', inputQty: 1, output: 'clothes', outputQty: 2, description: 'Sew warm clothing.' },
        TOOLS: { id: 'tools', name: 'Forge Tools', input: 'iron', inputQty: 1, output: 'tools', outputQty: 2, description: 'Smith essential tools.' },
        WEAPONS: { id: 'weapons', name: 'Forge Weapons', input: 'iron', inputQty: 2, output: 'weapons', outputQty: 1, description: 'Forge weapons for war.' },
        LUXURIES: { id: 'luxuries', name: 'Refine Luxuries', input: 'gold_ore', inputQty: 2, output: 'luxuries', outputQty: 1, description: 'Craft fine jewelry.' },
        BEER: { id: 'beer', name: 'Brew Beer', input: 'grain', inputQty: 3, output: 'beer', outputQty: 4, description: 'Brew ale from grain. Popular at taverns.' },
        LIQUOR: { id: 'liquor', name: 'Distill Liquor', input: 'grain', inputQty: 5, output: 'liquor', outputQty: 2, description: 'Distill strong spirits from grain. High value.' },
    },

    ROUTE_CREATION_COST: {
        legal: 280,
        smuggling: 220,
    },

    ROUTE_DISPATCH_COST: {
        legal: 120,
        smuggling: 95,
    },

    ensureEconomyState(player) {
        if (!Array.isArray(player.tradeRoutes)) player.tradeRoutes = [];
        if (!Array.isArray(player.smugglingRoutes)) player.smugglingRoutes = [];
        if (!player.auctions) {
            player.auctions = { active: [], won: [], nextRefreshDay: 1, nextId: 1 };
        }
        if (!Array.isArray(player.auctions.active)) player.auctions.active = [];
        if (!Array.isArray(player.auctions.won)) player.auctions.won = [];
        if (!player.auctions.nextRefreshDay) player.auctions.nextRefreshDay = 1;
        if (!player.auctions.nextId) player.auctions.nextId = 1;
        if (!player.auctions.lastProcessedDay) player.auctions.lastProcessedDay = 0;
    },

    getRouteGoodsOptions(player) {
        if (!player.inventory) return [];
        const options = [];
        for (const [goodId, qty] of Object.entries(player.inventory)) {
            if (qty <= 0) continue;
            const entry = Object.values(PlayerEconomy.GOODS).find(g => g.id === goodId);
            options.push({
                id: goodId,
                name: entry ? entry.name : goodId,
                icon: entry ? entry.icon : '📦',
                qty,
            });
        }
        return options.sort((a, b) => b.qty - a.qty);
    },

    createPersistentRoute(player, world, config = {}) {
        PlayerEconomy.ensureEconomyState(player);

        const isSmuggling = !!config.isSmuggling;
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const fromPos = config.fromPos;
        const toPos = config.toPos;
        const goodId = config.goodId;
        const quantity = Math.max(1, Math.floor(config.quantity || 1));
        const frequencyDays = Math.max(1, Math.floor(config.frequencyDays || 3));

        if (!fromPos || !toPos || !goodId) return { success: false, reason: 'Invalid route parameters' };

        const fromTile = world.getTile(fromPos.q, fromPos.r);
        const toTile = world.getTile(toPos.q, toPos.r);
        if (!fromTile || !toTile || !fromTile.settlement || !toTile.settlement) {
            return { success: false, reason: 'Routes require settlement endpoints' };
        }

        const distance = Hex.wrappingDistance(fromPos.q, fromPos.r, toPos.q, toPos.r, world.width);
        if (distance < 2) return { success: false, reason: 'Destination is too close' };
        if (distance > 20) return { success: false, reason: 'Destination is too far (max 20)' };

        const creationCost = isSmuggling ? PlayerEconomy.ROUTE_CREATION_COST.smuggling : PlayerEconomy.ROUTE_CREATION_COST.legal;
        if (player.gold < creationCost) return { success: false, reason: `Need ${creationCost} gold to establish route` };

        const duplicate = routePool.find(r =>
            r.fromPos.q === fromPos.q &&
            r.fromPos.r === fromPos.r &&
            r.toPos.q === toPos.q &&
            r.toPos.r === toPos.r &&
            r.goodId === goodId
        );
        if (duplicate) return { success: false, reason: 'A matching route already exists' };

        const routeId = `${isSmuggling ? 'SR' : 'TR'}-${Date.now()}-${Math.floor(Math.random() * 999)}`;
        const route = {
            id: routeId,
            isSmuggling,
            fromPos: { q: fromPos.q, r: fromPos.r },
            toPos: { q: toPos.q, r: toPos.r },
            fromName: fromTile.settlement.name,
            toName: toTile.settlement.name,
            goodId,
            quantity,
            frequencyDays,
            nextDispatchIn: 0,
            prosperity: 0,
            protection: 0,
            roadQuality: 0,
            totalRuns: 0,
            successfulRuns: 0,
            raidedRuns: 0,
            lastResult: 'idle',
            lastProfit: 0,
            createdOnDay: world.day || 1,
            activeCaravanId: null,
        };

        player.gold -= creationCost;
        routePool.push(route);

        return { success: true, route, creationCost };
    },

    cancelPersistentRoute(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const idx = routePool.findIndex(r => r.id === routeId);
        if (idx < 0) return { success: false, reason: 'Route not found' };
        const [removed] = routePool.splice(idx, 1);
        return { success: true, route: removed };
    },

    upgradeRouteProtection(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const route = routePool.find(r => r.id === routeId);
        if (!route) return { success: false, reason: 'Route not found' };
        if (route.protection >= 5) return { success: false, reason: 'Protection already maxed' };

        const cost = 180 + route.protection * 90;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        route.protection += 1;
        return { success: true, route, cost };
    },

    upgradeRouteRoadQuality(player, routeId, isSmuggling = false) {
        PlayerEconomy.ensureEconomyState(player);
        const routePool = isSmuggling ? player.smugglingRoutes : player.tradeRoutes;
        const route = routePool.find(r => r.id === routeId);
        if (!route) return { success: false, reason: 'Route not found' };
        if (route.roadQuality >= 5) return { success: false, reason: 'Road quality already maxed' };

        const cost = 200 + route.roadQuality * 100;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        route.roadQuality += 1;
        return { success: true, route, cost };
    },

    _getRouteById(player, routeId, isSmuggling = false) {
        const pool = isSmuggling ? (player.smugglingRoutes || []) : (player.tradeRoutes || []);
        return pool.find(r => r.id === routeId) || null;
    },

    _dispatchRouteCaravan(player, route, world) {
        if (!route || route.activeCaravanId) return { success: false, reason: 'Route already has an active caravan' };

        const dispatchCost = route.isSmuggling ? PlayerEconomy.ROUTE_DISPATCH_COST.smuggling : PlayerEconomy.ROUTE_DISPATCH_COST.legal;
        if (player.gold < dispatchCost) {
            route.lastResult = 'stalled_funds';
            return { success: false, reason: 'Not enough gold for dispatch' };
        }

        if (!player.inventory) player.inventory = {};
        if ((player.inventory[route.goodId] || 0) < route.quantity) {
            route.lastResult = 'stalled_goods';
            return { success: false, reason: 'Not enough goods in inventory' };
        }

        const fromTile = world.getTile(route.fromPos.q, route.fromPos.r);
        const toTile = world.getTile(route.toPos.q, route.toPos.r);
        if (!fromTile || !toTile || !toTile.settlement) {
            route.lastResult = 'stalled_invalid';
            return { success: false, reason: 'Route endpoint is invalid' };
        }

        const goods = { [route.goodId]: route.quantity };
        const dist = Hex.wrappingDistance(route.fromPos.q, route.fromPos.r, route.toPos.q, route.toPos.r, world.width);

        let expectedProfit = 0;
        const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === route.goodId);
        if (good) {
            let unitPrice = good.basePrice * (1 + dist * 0.05);
            const sizeMultiplier = { village: 0.8, town: 1.0, city: 1.2, capital: 1.5 };
            unitPrice *= sizeMultiplier[toTile.settlement.type] || 1.0;
            expectedProfit = Math.floor(unitPrice * route.quantity);
        }

        player.gold -= dispatchCost;
        player.inventory[route.goodId] -= route.quantity;
        if (player.inventory[route.goodId] <= 0) delete player.inventory[route.goodId];

        const caravan = {
            from: route.fromName,
            to: route.toName,
            fromPos: { q: route.fromPos.q, r: route.fromPos.r },
            toPos: { q: route.toPos.q, r: route.toPos.r },
            currentPos: { q: route.fromPos.q, r: route.fromPos.r },
            distance: dist,
            goods,
            expectedProfit,
            daysRemaining: Math.max(1, Math.ceil(dist / 2)),
            status: 'traveling',
            routeId: route.id,
            isSmugglingRoute: !!route.isSmuggling,
        };

        const caravanUnit = new WorldUnit('caravan', route.fromPos.q, route.fromPos.r, route.toPos.q, route.toPos.r);
        caravanUnit.playerOwned = true;
        caravanUnit.goods = { ...goods };
        caravanUnit.isSmugglingRoute = !!route.isSmuggling;
        world.units.push(caravanUnit);

        caravan.unitId = caravanUnit.id;

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        route.activeCaravanId = caravanUnit.id;
        route.nextDispatchIn = Math.max(1, route.frequencyDays);
        route.totalRuns = (route.totalRuns || 0) + 1;
        route.lastResult = 'dispatched';

        return { success: true, caravan };
    },

    _tickPersistentRoutes(player, world) {
        const allRoutes = [...(player.tradeRoutes || []), ...(player.smugglingRoutes || [])];
        for (const route of allRoutes) {
            if (route.activeCaravanId) {
                const unitAlive = world.units.some(u => u.id === route.activeCaravanId && !u.destroyed);
                if (!unitAlive) route.activeCaravanId = null;
            }

            if (route.nextDispatchIn > 0) route.nextDispatchIn--;
            if (route.activeCaravanId) continue;
            if (route.nextDispatchIn > 0) continue;

            PlayerEconomy._dispatchRouteCaravan(player, route, world);
        }
    },

    _recordRouteLoss(route) {
        route.activeCaravanId = null;
        route.raidedRuns = (route.raidedRuns || 0) + 1;
        route.lastResult = 'raided';
        route.lastProfit = 0;
        route.prosperity = Math.max(0, (route.prosperity || 0) - 0.35);
    },

    _recordRouteSuccess(route, finalProfit) {
        route.activeCaravanId = null;
        route.successfulRuns = (route.successfulRuns || 0) + 1;
        route.lastResult = 'profit';
        route.lastProfit = finalProfit;

        const protectionGrowth = (route.protection || 0) * 0.05;
        const roadGrowth = (route.roadQuality || 0) * 0.06;
        route.prosperity = Math.min(6, (route.prosperity || 0) + 0.18 + protectionGrowth + roadGrowth);
    },

    _generateAuctionLot(player, world) {
        const types = ['rare_item', 'artifact', 'land'];
        const type = Utils.randPick(types);
        const rarityRoll = Math.random();
        const rarity = rarityRoll > 0.92 ? 'legendary' : rarityRoll > 0.68 ? 'epic' : 'rare';
        const rarityMult = rarity === 'legendary' ? 2.2 : rarity === 'epic' ? 1.55 : 1.0;

        let title = '';
        let description = '';
        let reward = {};
        let basePrice = Math.floor((160 + (world.day || 1) * 3 + Math.random() * 120) * rarityMult);

        if (type === 'rare_item') {
            const goodsPool = ['gems', 'luxuries', 'weapons', 'tools', 'spices', 'liquor'];
            const goodId = Utils.randPick(goodsPool);
            const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === goodId);
            const amount = rarity === 'legendary' ? 6 : rarity === 'epic' ? 4 : 3;
            title = `${good ? good.icon : '📦'} Crate of ${good ? good.name : goodId}`;
            description = `Contraband and import stock sold by anonymous brokers.`;
            reward = { kind: 'item', goodId, amount, label: `${amount} ${good ? good.name : goodId}` };
        } else if (type === 'artifact') {
            const artifacts = ['Sun Idol', 'Royal Signet', 'Sage Astrolabe', 'Banner of Conquest', 'Sainted Reliquary'];
            const skillPool = ['commerce', 'diplomacy', 'leadership', 'stealth'];
            const skill = Utils.randPick(skillPool);
            const renown = rarity === 'legendary' ? 30 : rarity === 'epic' ? 20 : 12;
            const skillBonus = rarity === 'legendary' ? 2 : 1;
            title = `🗿 ${Utils.randPick(artifacts)}`;
            description = `A priceless relic sought by nobles, guilds, and collectors.`;
            reward = { kind: 'artifact', skill, skillBonus, renown, label: `+${renown} renown, +${skillBonus} ${skill}` };
            basePrice = Math.floor(basePrice * 1.3);
        } else {
            const estates = ['Riverside Estate', 'Border Ranch', 'Oakfield Holdings', 'Old Port Warehouse', 'Vineyard Rights'];
            title = `🏞️ ${Utils.randPick(estates)}`;
            description = `Land rights with tax and rent privileges.`;
            const taxBonus = rarity === 'legendary' ? 0.15 : rarity === 'epic' ? 0.1 : 0.06;
            reward = { kind: 'land', taxBonus, renown: 8, label: `+${Math.round(taxBonus * 100)}% tax output` };
            basePrice = Math.floor(basePrice * 1.15);
        }

        return {
            id: `AUC-${player.auctions.nextId++}`,
            type,
            rarity,
            title,
            description,
            reward,
            basePrice,
            currentBid: Math.floor(basePrice * 0.9),
            minIncrement: Math.max(20, Math.floor(basePrice * 0.07)),
            topBidder: 'ai',
            endsOnDay: (world.day || 1) + Utils.randInt(4, 7),
        };
    },

    _applyAuctionReward(player, lot) {
        if (!lot || !lot.reward) return;
        const reward = lot.reward;

        if (reward.kind === 'item') {
            if (!player.inventory) player.inventory = {};
            player.inventory[reward.goodId] = (player.inventory[reward.goodId] || 0) + reward.amount;
        } else if (reward.kind === 'artifact') {
            player.renown = (player.renown || 0) + (reward.renown || 0);
            if (!player.skills) player.skills = {};
            const current = player.skills[reward.skill] || 1;
            player.skills[reward.skill] = Math.min(10, current + (reward.skillBonus || 1));
        } else if (reward.kind === 'land') {
            player.renown = (player.renown || 0) + (reward.renown || 0);
            player.landTaxBonus = (player.landTaxBonus || 0) + (reward.taxBonus || 0);
        }

        player.auctions.won.push({
            day: (typeof window !== 'undefined' && window.game && window.game.world) ? window.game.world.day : null,
            title: lot.title,
            rarity: lot.rarity,
            reward: reward.label,
            price: lot.currentBid,
        });
    },

    ensureAuctionListings(player, world) {
        PlayerEconomy.ensureEconomyState(player);
        if ((player.auctions.active || []).length > 0) return;
        if ((world.day || 1) < (player.auctions.nextRefreshDay || 1)) return;

        player.auctions.active = [];
        for (let i = 0; i < 3; i++) {
            player.auctions.active.push(PlayerEconomy._generateAuctionLot(player, world));
        }
        player.auctions.nextRefreshDay = (world.day || 1) + 8;
    },

    placeAuctionBid(player, auctionId, world) {
        PlayerEconomy.ensureEconomyState(player);
        const lot = (player.auctions.active || []).find(a => a.id === auctionId);
        if (!lot) return { success: false, reason: 'Auction lot not found' };

        const nextBid = lot.currentBid + lot.minIncrement;
        if (player.gold < nextBid) return { success: false, reason: `Need ${nextBid} gold` };

        player.gold -= nextBid;

        if (lot.topBidder === 'player' && lot.playerStake) {
            player.gold += lot.playerStake;
        }

        lot.playerStake = nextBid;
        lot.currentBid = nextBid;
        lot.topBidder = 'player';
        lot.lastBidDay = world.day || 1;

        return { success: true, lot, bid: nextBid };
    },

    _processAuctions(player, world) {
        PlayerEconomy.ensureEconomyState(player);
        const events = [];

        if ((player.auctions.lastProcessedDay || 0) === (world.day || 1)) {
            return events;
        }

        PlayerEconomy.ensureAuctionListings(player, world);

        for (const lot of player.auctions.active) {
            if (lot.topBidder === 'player') {
                const pressureChance = 0.28 + (lot.rarity === 'legendary' ? 0.18 : lot.rarity === 'epic' ? 0.1 : 0.04);
                if (Math.random() < pressureChance) {
                    const increment = lot.minIncrement + Utils.randInt(0, Math.floor(lot.minIncrement * 0.5));
                    lot.currentBid += increment;
                    lot.topBidder = 'ai';
                    if (lot.playerStake) {
                        player.gold += lot.playerStake;
                        lot.playerStake = 0;
                    }
                }
            } else if (Math.random() < 0.2) {
                lot.currentBid += Utils.randInt(Math.floor(lot.minIncrement * 0.4), lot.minIncrement);
            }
        }

        for (let i = player.auctions.active.length - 1; i >= 0; i--) {
            const lot = player.auctions.active[i];
            if ((world.day || 1) < lot.endsOnDay) continue;

            if (lot.topBidder === 'player') {
                PlayerEconomy._applyAuctionReward(player, lot);
                events.push({
                    eventType: 'auction',
                    title: 'Auction Won!',
                    message: `${lot.title} secured for ${lot.currentBid}g. Reward: ${lot.reward.label}`,
                    severity: 'success',
                });
            } else {
                events.push({
                    eventType: 'auction',
                    title: 'Auction Lost',
                    message: `${lot.title} sold to another bidder.`,
                    severity: 'default',
                });
            }

            player.auctions.active.splice(i, 1);
        }

        player.auctions.lastProcessedDay = world.day || 1;

        return events;
    },

    /**
     * Check if player can build a property at a location
     */
    canBuildProperty(player, propertyType, tile, world) {
        const prop = PlayerEconomy.PROPERTY_TYPES[propertyType.toUpperCase()];
        if (!prop) return { canBuild: false, reason: 'Invalid property type' };

        // Check gold
        if (player.gold < prop.cost) {
            return { canBuild: false, reason: `Need ${prop.cost} gold (have ${player.gold})` };
        }

        // Check if already has THIS TYPE of property here (allow multiple different types)
        if (tile.playerProperties) {
            const existingOfType = tile.playerProperties.find(p => p.type === prop.id);
            if (existingOfType) {
                return { canBuild: false, reason: `Already have a ${prop.name} here` };
            }
        }

        // Check terrain requirements
        if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
            // Special case for Fishing Wharf: can be built on coastal land adjacent to water
            if (propertyType.toUpperCase() === 'FISHING_WHARF') {
                // Only ocean/sea counts — lakes and rivers do not
                const nearbyOcean = Hex.neighbors(tile.q, tile.r).some(n => {
                    const nt = world.getTile(n.q, n.r);
                    return nt && ['ocean', 'deep_ocean', 'coast', 'sea'].includes(nt.terrain.id);
                });

                if (!nearbyOcean && !prop.requiredTerrain.includes(tile.terrain.id)) {
                    return { canBuild: false, reason: 'Requires a coastal location (adjacent to ocean or sea)' };
                }

                if (!tile.terrain.passable) {
                    return { canBuild: false, reason: 'Must be built on land' };
                }

                // Must have a settlement to serve as a port
                if (!tile.settlement) {
                    return { canBuild: false, reason: 'Requires a coastal settlement' };
                }

            } else {
                return { canBuild: false, reason: `Requires ${prop.requiredTerrain.join(' or ')} terrain` };
            }
        }

        // Fishing wharf always requires a settlement (even when terrain is coast/beach)
        if (propertyType.toUpperCase() === 'FISHING_WHARF' && !tile.settlement) {
            return { canBuild: false, reason: 'Requires a coastal settlement' };
        }

        // Check resource requirements
        if (prop.requiredResource) {
            if (!tile.resource || !prop.requiredResource.includes(tile.resource.id)) {
                return { canBuild: false, reason: `Requires ${prop.requiredResource.join(' or ')} resource` };
            }
        }

        // Check settlement requirements
        if (prop.requiredSettlement) {
            let hasSettlement = tile.settlement != null;

            // Allow Workshops and Breweries to be built adjacent to settlements
            if (!hasSettlement && (propertyType.toUpperCase() === 'WORKSHOP' || propertyType.toUpperCase() === 'BREWERY')) {
                // Check neighbors
                const neighbors = Hex.neighbors(tile.q, tile.r);
                for (const n of neighbors) {
                    const nTile = world.getTile(n.q, n.r);
                    if (nTile && nTile.settlement) {
                        hasSettlement = true;
                        break;
                    }
                }
            }

            if (!hasSettlement) {
                return { canBuild: false, reason: 'Requires a settlement (or adjacent for Workshops)' };
            }
        }

        return { canBuild: true, property: prop };
    },

    /**
     * Build a property
     */
    buildProperty(player, propertyType, tile, world) {
        const check = PlayerEconomy.canBuildProperty(player, propertyType, tile, world);
        if (!check.canBuild) return { success: false, reason: check.reason };

        const prop = check.property;

        // Deduct cost
        player.gold -= prop.cost;

        // Determine what this property produces
        let produces = prop.produces;
        if (prop.id === 'mine' && tile.resource) {
            produces = tile.resource.id; // Mine produces whatever resource is there
        }

        // Create property object
        const constructionDays = prop.constructionDays || 0;
        const newProperty = {
            type: prop.id,
            name: prop.name,
            icon: prop.icon,
            produces,
            productionRate: prop.productionRate,
            upkeep: prop.upkeep || 0,
            level: 1,
            daysOwned: 0,
            storage: 0,
            inputStorage: 0, // For workshops
            activeRecipe: null, // For workshops
            autoSell: false,
            hasLab: false,   // Lab upgrade for technology research
            underConstruction: constructionDays > 0,
            constructionDaysLeft: constructionDays,
            constructionDaysTotal: constructionDays,
        };

        // Initialize playerProperties array if it doesn't exist
        if (!tile.playerProperties) {
            tile.playerProperties = [];
        }

        // Add property to tile's array
        tile.playerProperties.push(newProperty);

        // Also maintain the old playerProperty for backwards compatibility (use the first one)
        tile.playerProperty = tile.playerProperties[0];

        // Add to player's properties list
        if (!player.properties) player.properties = [];
        player.properties.push({
            q: tile.q,
            r: tile.r,
            type: prop.id,
            name: prop.name,
            produces,
        });

        // Initialize player inventory if needed
        if (!player.inventory) player.inventory = {};

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.5);

        // Place property on inner map (assigns inner tile position and updates cache)
        if (typeof InnerMap !== 'undefined') {
            InnerMap.placePropertyOnInnerMap(tile, newProperty, tile.q, tile.r);
        }

        return { success: true, property: tile.playerProperty, underConstruction: constructionDays > 0, constructionDays };
    },

    /**
     * Produce goods from all properties
     */
    produceGoods(player, world) {
        if (!player.properties || player.properties.length === 0) return {};

        const production = {};

        for (const prop of player.properties) {
            const tile = world.getTile(prop.q, prop.r);
            if (!tile || !tile.playerProperty) continue;

            const property = tile.playerProperty;
            if (property.underConstruction) continue; // Still building

            // Handle retooling countdown (workshop/brewery recipe change)
            if (property.retooling) {
                property.retoolingDaysLeft = (property.retoolingDaysLeft || 0) - 1;
                if (property.retoolingDaysLeft <= 0) {
                    property.retooling = false;
                    property.retoolingDaysLeft = 0;
                }
                property.daysOwned = (property.daysOwned || 0) + 1;
                continue; // No production during retooling
            }

            // Tavern earns gold directly — handled separately
            if (property.type === 'tavern') {
                const upkeepCost = (property.upkeep || 0) * property.level;
                if (player.gold >= upkeepCost) {
                    player.gold -= upkeepCost;
                    // Calculate tavern income based on settlement size
                    let baseIncome = 15;
                    if (tile.settlement) {
                        const pop = tile.settlement.population || 50;
                        if (tile.settlement.type === 'capital') baseIncome = 35;
                        else if (tile.settlement.type === 'town') baseIncome = 25;
                        baseIncome += Math.floor(pop / 100) * 2; // +2g per 100 pop
                    }
                    // Level bonus
                    baseIncome = Math.floor(baseIncome * (1 + (property.level - 1) * 0.15));
                    // Commerce skill bonus
                    baseIncome = Math.floor(baseIncome * (1 + player.skills.commerce * 0.05));
                    // Beer/liquor stock bonus (if player has stocked the tavern)
                    const beerStock = property.beerStock || 0;
                    const liquorStock = property.liquorStock || 0;
                    if (beerStock > 0) {
                        baseIncome = Math.floor(baseIncome * 1.3);
                        property.beerStock = Math.max(0, beerStock - 2); // Consume 2 beer/day
                    }
                    if (liquorStock > 0) {
                        baseIncome = Math.floor(baseIncome * 1.2);
                        property.liquorStock = Math.max(0, liquorStock - 1); // Consume 1 liquor/day
                    }
                    // Gambling tables bonus
                    if (property.gamblingTables) {
                        baseIncome = Math.floor(baseIncome * (1 + property.gamblingTables * 0.15));
                    }
                    player.gold += baseIncome;
                    property.storage = (property.storage || 0) + baseIncome; // Track total earnings in storage
                    property.todayIncome = baseIncome;
                    production['tavern_income'] = (production['tavern_income'] || 0) + baseIncome;
                }
                property.daysOwned = (property.daysOwned || 0) + 1;
                continue;
            }

            if (!property.produces) continue; // Trading posts don't produce

            // Calculate production
            let amount = property.productionRate;

            // Resource Bonus for Logging Camp
            if (property.type === 'logging_camp' && tile.resource && tile.resource.id === 'timber') {
                amount *= 1.5; // 50% bonus for timber resource
            }

            // Level bonus (10% per level)
            amount *= (1 + (property.level - 1) * 0.1);

            // Commerce skill bonus (5% per level)
            amount *= (1 + player.skills.commerce * 0.05);

            // Technology production bonus
            if (typeof Technology !== 'undefined') {
                const techBonus = Technology.getProductionBonus(player, property.type);
                if (techBonus > 0) amount *= (1 + techBonus);
            }

            // Infrastructure irrigation bonus (for farms/irrigated farms)
            if (typeof Infrastructure !== 'undefined' && (property.type === 'farm' || property.type === 'irrigated_farm')) {
                const irrigBonus = Infrastructure.getIrrigationBonus(tile);
                if (irrigBonus > 0) amount *= (1 + irrigBonus);
            }

            amount = Math.floor(amount);

            let producedAmount = amount;
            let producedGood = property.produces;
            let consumedInput = false;

            // Workshop & Brewery Specific Logic (recipe-based production)
            if (property.type === 'workshop' || property.type === 'brewery') {
                if (!property.activeRecipe) {
                    producedAmount = 0; // No recipe, no production
                } else {
                    const recipe = PlayerEconomy.RECIPES[property.activeRecipe];
                    if (recipe) {
                        // Check input storage
                        const inputNeeded = recipe.inputQty;
                        const outputQty = recipe.outputQty;

                        // Calculate max runs based on input
                        const maxRuns = Math.floor((property.inputStorage || 0) / inputNeeded);

                        // Calculate desired runs based on production rate (which we treat as number of runs or output? Let's treat rate as raw output capacity)
                        // But for simplicity, let's say rate = number of recipe runs per day?
                        // Or rate = amount of output units? 
                        // Let's stick to rate = output units.
                        // So desired runs = amount / outputQty

                        let runs = Math.floor(amount / outputQty);
                        if (runs < 1) runs = 1; // Minimum 1 run if rate allows at least something? Or maybe strict.

                        const actualRuns = Math.min(runs, maxRuns);

                        if (actualRuns > 0) {
                            property.inputStorage -= actualRuns * inputNeeded;
                            producedAmount = actualRuns * outputQty;
                            producedGood = recipe.output;
                            consumedInput = true;
                        } else {
                            producedAmount = 0; // Not enough input
                        }
                    }
                }
            }

            // Pay upkeep
            const upkeepCost = (property.upkeep || 0) * property.level;

            // Only produce if upkeep paid (and inputs valid for workshop)
            if (player.gold >= upkeepCost) {
                player.gold -= upkeepCost;

                if (producedAmount > 0) {
                    // Add to property storage if upkeep paid
                    property.storage = (property.storage || 0) + producedAmount;

                    // Track production
                    production[producedGood] = (production[producedGood] || 0) + producedAmount;
                }
            }

            // Increment days owned
            property.daysOwned++;

            // Auto sell if enabled (simple logic)
            if (property.autoSell && property.storage > 0 && producedAmount > 0) {
                const sellAmount = property.storage;
                // ... same as before
                const goodType = producedGood.toUpperCase();
                const good = PlayerEconomy.GOODS[goodType];
                if (good) {
                    const income = Math.floor(sellAmount * good.basePrice * 0.5);
                    player.gold += income;
                    property.storage = 0;
                }
            }
        }

        return production;
    },

    /**
     * Collect goods from properties into player inventory
     */
    collectGoods(player, world) {
        if (!player.properties || player.properties.length === 0) return {};

        if (!player.inventory) player.inventory = {};
        const collected = {};

        for (const prop of player.properties) {
            const tile = world.getTile(prop.q, prop.r);
            if (!tile || !tile.playerProperty) continue;

            const property = tile.playerProperty;
            if (!property.produces || property.storage <= 0) continue;

            // Move from property storage to player inventory
            const goodType = property.produces;
            player.inventory[goodType] = (player.inventory[goodType] || 0) + property.storage;
            collected[goodType] = (collected[goodType] || 0) + property.storage;
            property.storage = 0;
        }

        return collected;
    },

    /**
     * Start a caravan to sell goods at a distant settlement
     */
    startCaravan(player, fromPos, toSettlement, goods, world) {
        const cost = 200;
        if (player.gold < cost) {
            return { success: false, reason: `Need ${cost} gold to start a caravan` };
        }

        // Check if player has the goods
        if (!player.inventory) player.inventory = {};
        for (const [goodType, quantity] of Object.entries(goods)) {
            if (!player.inventory[goodType] || player.inventory[goodType] < quantity) {
                return { success: false, reason: `Not enough ${goodType} in inventory` };
            }
        }

        // Calculate distance
        const dist = Hex.wrappingDistance(
            fromPos.q, fromPos.r,
            toSettlement.q, toSettlement.r,
            world.width
        );

        if (dist > 20) {
            return { success: false, reason: 'Destination too far (max 20 tiles)' };
        }

        // Calculate expected profit
        let expectedProfit = 0;
        for (const [goodType, quantity] of Object.entries(goods)) {
            const goodId = goodType.toUpperCase();
            const good = PlayerEconomy.GOODS[goodId] || PlayerEconomy.GOODS[goodType]; // Try both

            if (good) {
                let price = good.basePrice;
                // Distant settlements pay more
                price *= (1 + dist * 0.05);
                // Settlement size bonus
                const sizeMultiplier = {
                    village: 0.8,
                    town: 1.0,
                    city: 1.2,
                    capital: 1.5,
                };
                price *= sizeMultiplier[toSettlement.type] || 1.0;
                expectedProfit += Math.floor(price * quantity);
            }
        }

        // Deduct cost and goods
        player.gold -= cost;
        for (const [goodType, quantity] of Object.entries(goods)) {
            player.inventory[goodType] -= quantity;
        }

        // Create caravan
        const caravan = {
            from: fromPos.name || 'Your Location',
            to: toSettlement.name,
            fromPos: { q: fromPos.q, r: fromPos.r },
            toPos: { q: toSettlement.q, r: toSettlement.r },
            currentPos: { q: fromPos.q, r: fromPos.r },
            distance: dist,
            goods: { ...goods },
            expectedProfit,
            daysRemaining: Math.ceil(dist / 2), // Travels 2 tiles per day
            status: 'traveling',
        };

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.3);

        return { success: true, caravan };
    },

    /**
     * Start a caravan specifically from property storage
     * toSettlement can be a Settlement OR a Player Property object (must have q, r, name, type)
     */
    startStorageCaravan(player, tile, toSettlement, world) {
        if (!tile.playerProperty) return { success: false, reason: 'No property here' };

        const property = tile.playerProperty;
        if (property.storage <= 0) return { success: false, reason: 'Storage is empty' };

        // Determine property output
        const outputGood = property.produces;
        if (!outputGood) return { success: false, reason: 'Nothing to ship' };

        const goods = {};
        goods[outputGood] = property.storage;

        // Use regular caravan logic but don't deduct from inventory, deduct from storage
        const cost = 200;
        if (player.gold < cost) {
            return { success: false, reason: `Need ${cost} gold` };
        }

        const dist = Hex.wrappingDistance(
            tile.q, tile.r,
            toSettlement.q, toSettlement.r,
            world.width
        );

        if (dist > 20) return { success: false, reason: 'Destination too far' };

        // Calculate expected profit OR just mark as internal transfer
        let expectedProfit = 0;
        let isInternalTransfer = false;

        // Internal Transfer Logic: If destination is a Workshop owned by player
        if (toSettlement.isPlayerProperty && (toSettlement.type === 'workshop' || toSettlement.type === 'brewery')) {
            isInternalTransfer = true;
            expectedProfit = 0; // No gold profit, materials transfer
        } else {
            // Standard Trade
            const goodId = outputGood.toUpperCase();
            const good = PlayerEconomy.GOODS[goodId];

            if (good) {
                let price = good.basePrice;
                price *= (1 + dist * 0.05); // Distance bonus
                const sizeMultiplier = {
                    village: 0.8, town: 1.0, city: 1.2, capital: 1.5
                };
                price *= sizeMultiplier[toSettlement.type] || 1.0;
                expectedProfit = Math.floor(price * property.storage);
            }
        }

        // Deduct cost and storage
        player.gold -= cost;
        property.storage = 0;

        // Create caravan
        const caravan = {
            from: property.name,
            to: toSettlement.name,
            fromPos: { q: tile.q, r: tile.r },
            toPos: { q: toSettlement.q, r: toSettlement.r },
            currentPos: { q: tile.q, r: tile.r },
            distance: dist,
            goods: { ...goods },
            expectedProfit,
            daysRemaining: dist, // Still useful for estimate, but actual movement handled by unit
            status: 'traveling',
            isInternalTransfer,
            targetPropertyType: toSettlement.isPlayerProperty ? toSettlement.type : null,
            unitId: null // To be filled
        };

        // Spawn physical unit
        const caravanUnit = new WorldUnit('caravan', tile.q, tile.r, toSettlement.q, toSettlement.r);
        caravanUnit.playerOwned = true; // Mark as player's
        caravanUnit.goods = { ...goods }; // Give it the goods
        world.units.push(caravanUnit);
        caravan.unitId = caravanUnit.id;

        if (!player.caravans) player.caravans = [];
        player.caravans.push(caravan);

        return { success: true, caravan };
    },

    /**
     * Upgrade a property
     */
    upgradeProperty(player, tile) {
        if (!tile.playerProperty) return { success: false, reason: 'No property' };

        const property = tile.playerProperty;
        if (property.level >= 5) return { success: false, reason: 'Max level reached' };

        const cost = Math.floor(PlayerEconomy.PROPERTY_TYPES[property.type.toUpperCase()].cost * 0.5 * (property.level + 1));

        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        player.gold -= cost;
        property.level++;

        return { success: true, level: property.level, cost };
    },

    /**
     * Update all player caravans
     */
    updateCaravans(player, world) {
        const completed = [];
        PlayerEconomy.ensureEconomyState(player);

        // Tick route and auction systems first (daily)
        PlayerEconomy._tickPersistentRoutes(player, world);
        const auctionEvents = PlayerEconomy._processAuctions(player, world);
        if (auctionEvents.length > 0) completed.push(...auctionEvents);

        if (!player.caravans || player.caravans.length === 0) return completed;

        for (let i = player.caravans.length - 1; i >= 0; i--) {
            const caravan = player.caravans[i];

            if (caravan.status === 'traveling') {
                // If using physical units
                if (caravan.unitId) {
                    const unit = world.units.find(u => u.id === caravan.unitId);

                    if (!unit) {
                        // Unit is gone! Likely destroyed by raiders or bug
                        // Check if it was robbed? World events would have logged it.
                        caravan.status = 'lost';
                        if (caravan.routeId) {
                            const routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                            if (routeRef) PlayerEconomy._recordRouteLoss(routeRef);
                            completed.push({
                                ...caravan,
                                finalProfit: 0,
                                status: 'lost',
                                message: `${caravan.from} → ${caravan.to} caravan was raided and lost.`,
                            });
                        }
                        // Maybe notify player here via return object?
                        // For now just remove
                        player.caravans.splice(i, 1);
                        continue;
                    }

                    // Update caravan position for UI tracking
                    caravan.currentPos = { q: unit.q, r: unit.r };

                    // Update remaining distance estimate
                    const dist = Hex.wrappingDistance(unit.q, unit.r, caravan.toPos.q, caravan.toPos.r, world.width);
                    caravan.daysRemaining = Math.ceil(dist / unit.speed);

                    if (unit.arrived) {
                        // Mark for completion processing below
                        // We handled the physical arrival, now handle the economic transaction
                        unit.destroyed = true; // Remove the physical unit now
                    } else if (unit.destroyed) {
                        caravan.status = 'lost';
                        if (caravan.routeId) {
                            const routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                            if (routeRef) PlayerEconomy._recordRouteLoss(routeRef);
                            completed.push({
                                ...caravan,
                                finalProfit: 0,
                                status: 'lost',
                                message: `${caravan.from} → ${caravan.to} caravan was destroyed en route.`,
                            });
                        }
                        player.caravans.splice(i, 1);
                        continue;
                    } else {
                        // Still traveling
                        continue;
                    }
                } else {
                    // Fallback for old saves or logical-only caravans (legacy)
                    caravan.daysRemaining--;
                    if (caravan.daysRemaining > 0) continue;
                }

                // processing completion (either physical arrival or legacy timer)
                caravan.status = 'completed';

                if (caravan.isInternalTransfer) {
                    // ... (existing logic)
                    const targetTile = world.getTile(caravan.toPos.q, caravan.toPos.r);
                    if (targetTile && targetTile.playerProperty && (targetTile.playerProperty.type === 'workshop' || targetTile.playerProperty.type === 'brewery')) {
                        for (const qty of Object.values(caravan.goods)) {
                            targetTile.playerProperty.inputStorage = (targetTile.playerProperty.inputStorage || 0) + qty;
                        }
                    }
                    completed.push({ ...caravan, finalProfit: 0 });
                } else {
                    // ... (existing commercial logic)
                    // Recalculate based on current market prices
                    let marketValue = 0;
                    for (const [goodId, qty] of Object.entries(caravan.goods)) {
                        const currentPrice = MarketDynamics.getPrice(goodId);
                        marketValue += currentPrice * qty;
                    }

                    const dist = Hex.wrappingDistance(caravan.fromPos.q, caravan.fromPos.r, caravan.toPos.q, caravan.toPos.r, world.width);
                    const distanceMultiplier = 1 + (dist * 0.05); // 5% per hex

                    const targetTile = world.getTile(caravan.toPos.q, caravan.toPos.r);
                    let settlementMultiplier = 1.0;
                    if (targetTile && targetTile.settlement) {
                        if (targetTile.settlement.type === 'capital') settlementMultiplier = 1.5;
                        else if (targetTile.settlement.type === 'city') settlementMultiplier = 1.2;
                    }

                    let grossRevenue = Math.floor(marketValue * distanceMultiplier * settlementMultiplier);

                    let routeRef = null;
                    if (caravan.routeId) {
                        routeRef = PlayerEconomy._getRouteById(player, caravan.routeId, caravan.isSmugglingRoute);
                        if (routeRef) {
                            const prosperityBonus = 1 + (routeRef.prosperity || 0) * 0.04;
                            const roadBonus = 1 + (routeRef.roadQuality || 0) * 0.06;
                            grossRevenue = Math.floor(grossRevenue * prosperityBonus * roadBonus);

                            if (caravan.isSmugglingRoute) {
                                const smuggleMultiplier = 1.35 + (routeRef.prosperity || 0) * 0.05;
                                grossRevenue = Math.floor(grossRevenue * smuggleMultiplier);
                            }
                        }
                    }

                    const bonus = 1 + player.skills.commerce * 0.05;
                    let finalProfit = Math.floor(grossRevenue * bonus);

                    let smuggleCaught = false;
                    if (caravan.isSmugglingRoute && routeRef) {
                        const stealth = player.skills?.stealth || 1;
                        const caughtChance = Math.max(0.06, Math.min(0.62,
                            0.28 + dist * 0.01 - stealth * 0.02 - (routeRef.protection || 0) * 0.03
                        ));

                        if (Math.random() < caughtChance) {
                            smuggleCaught = true;
                            const confiscated = Math.floor(finalProfit * (0.35 + Math.random() * 0.2));
                            finalProfit = Math.max(0, finalProfit - confiscated);

                            const fine = Math.min(player.gold, Math.floor(confiscated * 0.4));
                            player.gold -= fine;
                            player.karma = (player.karma || 0) - 2;
                            if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                            player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;

                            if (targetTile && targetTile.settlement && targetTile.settlement.kingdom && player.reputation) {
                                player.reputation[targetTile.settlement.kingdom] = (player.reputation[targetTile.settlement.kingdom] || 0) - 4;
                            }
                        }
                    }

                    player.gold += finalProfit;
                    completed.push({
                        ...caravan,
                        finalProfit,
                        status: smuggleCaught ? 'smuggling_caught' : 'completed',
                        message: smuggleCaught
                            ? `${caravan.from} → ${caravan.to}: guards intercepted part of the shipment.`
                            : `${caravan.from} → ${caravan.to}: route delivered successfully.`,
                    });

                    if (routeRef) {
                        PlayerEconomy._recordRouteSuccess(routeRef, finalProfit);
                    }

                    // Track for quests
                    Quests.trackCaravanCompleted(player);

                    // Increase commerce skill
                    player.skills.commerce = Math.min(10, player.skills.commerce + 0.2);
                }

                // Remove from active caravans
                player.caravans.splice(i, 1);
            }
        }

        return completed;
    },

    /**
     * Spawn traveling merchant at trading post
     */
    spawnTravelingMerchant(player, world) {
        if (!player.properties) return null;

        // Find trading posts
        const tradingPosts = player.properties.filter(p => p.type === 'trading_post');
        if (tradingPosts.length === 0) return null;

        // 20% chance per trading post per day
        for (const post of tradingPosts) {
            if (Math.random() < 0.2) {
                const tile = world.getTile(post.q, post.r);
                if (!tile) continue;

                // Merchant wants to buy random goods
                const availableKeys = Object.keys(PlayerEconomy.GOODS);
                const wantsToBuyKey = Utils.randPick(availableKeys);
                const good = PlayerEconomy.GOODS[wantsToBuyKey];

                const quantity = Utils.randInt(5, 20);
                let pricePerUnit = good.basePrice * 1.1; // Pays 10% above base

                return {
                    location: post,
                    wantsToBuy: good.id,
                    quantity,
                    pricePerUnit: Math.floor(pricePerUnit),
                    daysRemaining: 3, // Stays for 3 days
                };
            }
        }

        return null;
    },
    /**
     * Set active recipe for a workshop
     */
    setWorkshopRecipe(tile, recipeId, player) {
        if (!tile.playerProperty || (tile.playerProperty.type !== 'workshop' && tile.playerProperty.type !== 'brewery')) return { success: false, reason: 'Not a workshop or brewery' };

        const prop = tile.playerProperty;
        const isChange = prop.activeRecipe && prop.activeRecipe !== recipeId;

        // If changing recipe (not first selection), charge retooling cost
        if (isChange && player) {
            const propType = PlayerEconomy.PROPERTY_TYPES[prop.type.toUpperCase()] || {};
            const baseCost = propType.recipeChangeCost || 150;
            const retoolingCost = Math.floor(baseCost * prop.level);

            if (player.gold < retoolingCost) {
                return { success: false, reason: `Need ${retoolingCost} gold to retool workshop` };
            }

            player.gold -= retoolingCost;

            // Return old input storage to player inventory
            if (prop.inputStorage > 0 && prop.activeRecipe) {
                const oldRecipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                if (oldRecipe && player.inventory) {
                    player.inventory[oldRecipe.input] = (player.inventory[oldRecipe.input] || 0) + prop.inputStorage;
                }
                prop.inputStorage = 0;
            }

            // Set retooling downtime
            const retoolingDays = propType.retoolingDays || 2;
            prop.retooling = true;
            prop.retoolingDaysLeft = retoolingDays;
        }

        prop.activeRecipe = recipeId;
        const recipe = PlayerEconomy.RECIPES[recipeId];
        if (recipe) {
            prop.produces = recipe.output;
        }
        return { success: true, wasChange: isChange };
    },

    /**
     * Deposit goods into workshop input storage
     */
    depositToWorkshop(player, tile, goodId, amount) {
        if (!tile.playerProperty || (tile.playerProperty.type !== 'workshop' && tile.playerProperty.type !== 'brewery')) return { success: false, reason: 'Not a workshop or brewery' };

        if (!player.inventory[goodId] || player.inventory[goodId] < amount) {
            return { success: false, reason: 'Not enough goods' };
        }

        // Validate good matches recipe input? 
        // Or just allow generic input storage. Let's validate against current recipe to be safe.
        const recipe = PlayerEconomy.RECIPES[tile.playerProperty.activeRecipe];
        if (!recipe) return { success: false, reason: 'No recipe selected' };
        if (recipe.input !== goodId) return { success: false, reason: `Recipe needs ${recipe.input}` };

        player.inventory[goodId] -= amount;
        tile.playerProperty.inputStorage = (tile.playerProperty.inputStorage || 0) + amount;

        return { success: true };
    },

    /**
     * Send a fishing boat to a resource
     */
    sendFishingBoat(player, tile, targetQ, targetR, world) {
        if (!tile.playerProperty || tile.playerProperty.type !== 'fishing_wharf') return { success: false, reason: 'Not a fishing wharf' };

        const cost = 50;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold` };

        // Limit boats per wharf
        const activeBoats = world.units.filter(u =>
            u.type === 'fishing_boat' &&
            u.sourceQ === tile.q &&
            u.sourceR === tile.r &&
            !u.destroyed
        );

        if (activeBoats.length >= tile.playerProperty.level) {
            return { success: false, reason: `Max boats dispatched (Upgrade for more)` };
        }

        player.gold -= cost;

        // Create Unit
        const boat = new WorldUnit('fishing_boat', tile.q, tile.r, targetQ, targetR);
        // Explicitly set source on the boat instance
        boat.sourceQ = tile.q;
        boat.sourceR = tile.r;
        boat.homeWharf = { q: tile.q, r: tile.r }; // Reference to home

        world.units.push(boat);

        return { success: true, boat };
    },
};

// ============================================
// TRADING — Player trading with settlements
// ============================================

export const Trading = {
    /**
     * Get available goods at a settlement
     */
    getAvailableGoods(settlement, tile) {
        const goods = [];
        if (!settlement.marketStock) settlement.marketStock = {};

        // Helper to add good
        const addGood = (goodKey, qtyMult) => {
            const good = PlayerEconomy.GOODS[goodKey];
            if (!good) return;

            const baseQty = Math.floor(settlement.population * qtyMult);
            const bought = settlement.marketStock[good.id] || 0;
            const available = Math.max(0, baseQty - bought);

            goods.push({
                ...good,
                quantity: available,
                price: Trading.calculatePrice(good, settlement, tile),
            });
        };

        // All settlements have basic food
        addGood('GRAIN', 0.1);
        addGood('BREAD', 0.05);

        // Larger settlements have more variety
        if (settlement.type === 'town' || settlement.type === 'city' || settlement.type === 'capital') {
            addGood('TOOLS', 0.02);
            addGood('WOOD', 0.05);
            addGood('STONE', 0.03);
        }

        if (settlement.type === 'city' || settlement.type === 'capital') {
            addGood('WEAPONS', 0.01);
            addGood('LUXURIES', 0.005);
            addGood('GEMS', 0.002);
        }

        // All settlements with taverns sell beer and liquor
        if (settlement.type === 'town' || settlement.type === 'capital') {
            addGood('BEER', 0.08);
            addGood('LIQUOR', 0.03);
        }

        return goods;
    },

    /**
     * Calculate price based on settlement and resources
     */
    calculatePrice(good, settlement, tile) {
        let price = good.basePrice;

        // Larger settlements have better prices (cheaper to buy)
        const sizeMultiplier = {
            village: 1.2,
            town: 1.0,
            city: 0.9,
            capital: 0.8,
        };
        price *= sizeMultiplier[settlement.type] || 1.0;

        // Temperature based demand for Firewood and Warm Clothes
        const world = (typeof window !== 'undefined' && window.game) ? window.game.world : null;

        if (world && world.weather) {
            const temp = tile.temperature ?? 15; // default 15
            const isCold = temp < 5;

            if (good.id === 'firewood') {
                if (isCold) price *= 1.5; // High demand in cold
                else price *= 0.8; // Low demand elsewhere
            }
            if (good.id === 'clothes') {
                if (isCold) price *= 1.3;
            }
        } else {
            // Fallback to biome based logic
            const isCold = ['tundra', 'snowy_wasteland', 'ice_sheet', 'taiga', 'boreal_forest'].includes(tile.terrain.id);
            if (good.id === 'firewood') {
                if (isCold) price *= 1.5;
                else price *= 0.8;
            }
        }

        // Resource bonuses affect prices
        if (tile.resource) {
            if (good.id === 'grain' && ['wheat'].includes(tile.resource.id)) price *= 0.7;
            if ((good.id === 'bread' || good.id === 'flour') && ['wheat'].includes(tile.resource.id)) price *= 0.85;
            if (good.id === 'weapons' && tile.resource.id === 'iron') price *= 0.8;
            if (good.id === 'luxuries' && ['gems', 'spices'].includes(tile.resource.id)) price *= 0.85;
            if (good.id === 'stone' && tile.resource.id === 'stone') price *= 0.7;
            if (good.id === 'gold_ore' && tile.resource.id === 'gold_ore') price *= 0.7;
        }

        return Math.floor(price);
    },

    // Moved to PlayerEconomy object

    /**
     * Buy goods from a settlement
     */
    buyGoods(player, good, quantity, settlement) {
        const totalCost = good.price * quantity;

        if (player.gold < totalCost) {
            return { success: false, reason: 'Not enough gold' };
        }

        if (quantity > good.quantity) {
            return { success: false, reason: 'Not enough in stock' };
        }

        player.gold -= totalCost;

        // Add to player inventory
        if (!player.inventory) player.inventory = {};
        player.inventory[good.id] = (player.inventory[good.id] || 0) + quantity;

        // Reduce settlement stock
        if (!settlement.marketStock) settlement.marketStock = {};
        settlement.marketStock[good.id] = (settlement.marketStock[good.id] || 0) + quantity;

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, spent: totalCost };
    },

    /**
     * Sell goods to a settlement
     */
    sellGoods(player, goodId, quantity) {
        if (!player.inventory || !player.inventory[goodId] || player.inventory[goodId] < quantity) {
            return { success: false, reason: 'Not enough in inventory' };
        }

        // Find the good in PlayerEconomy.GOODS
        let good = null;
        for (const key in PlayerEconomy.GOODS) {
            if (PlayerEconomy.GOODS[key].id === goodId) {
                good = PlayerEconomy.GOODS[key];
                break;
            }
        }

        if (!good) return { success: false, reason: 'Invalid good' };

        // Sell for 70% of base price
        const sellPrice = Math.floor(good.basePrice * 0.7);
        const totalEarned = sellPrice * quantity;

        player.inventory[goodId] -= quantity;
        player.gold += totalEarned;

        // Increase commerce skill
        player.skills.commerce = Math.min(10, player.skills.commerce + 0.1);

        return { success: true, earned: totalEarned };
    },
};
