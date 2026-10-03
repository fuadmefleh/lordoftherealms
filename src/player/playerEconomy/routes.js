// PlayerEconomy — routes members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure } from './_imports.js';

Object.assign(PlayerEconomy, {
    /**
     * Property types, goods and recipes are game content: they live in
     * data/playerEconomy.json and DataLoader installs them at startup.
     */
    PROPERTY_TYPES: {},
    GOODS: {},
    RECIPES: {},

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

        const routeId = `${isSmuggling ? 'SR' : 'TR'}-${Date.now()}-${Math.floor(Utils.random() * 999)}`;
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
});
