/**
 * Structural guard for the playerEconomy.js split (PlayerEconomy object into
 * routes/auctions/property/caravans modules + Trading kept as its own module,
 * both re-exported by the barrel). Behaviour is further covered by the existing
 * unit.economy / golden.economy / player suites.
 */
import { describe, it, expect } from 'vitest';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';

const PE_MEMBERS = [
    'PROPERTY_TYPES', 'GOODS', 'RECIPES', 'ROUTE_CREATION_COST', 'ROUTE_DISPATCH_COST',
    'ensureEconomyState', 'getRouteGoodsOptions', 'createPersistentRoute', 'cancelPersistentRoute',
    'upgradeRouteProtection', 'upgradeRouteRoadQuality', '_getRouteById', '_dispatchRouteCaravan',
    '_tickPersistentRoutes', '_recordRouteLoss', '_recordRouteSuccess', '_generateAuctionLot',
    '_applyAuctionReward', 'ensureAuctionListings', 'placeAuctionBid', '_processAuctions',
    'canBuildProperty', 'buildProperty', 'produceGoods', 'collectGoods', 'startCaravan',
    'startStorageCaravan', 'upgradeProperty', 'updateCaravans', 'spawnTravelingMerchant',
    'setWorkshopRecipe', 'depositToWorkshop', 'sendFishingBoat',
];

describe('playerEconomy split — structural equivalence', () => {
    it('PlayerEconomy exposes all 33 original members', () => {
        const keys = new Set(Object.keys(PlayerEconomy));
        expect(PE_MEMBERS.filter((m) => !keys.has(m))).toEqual([]);
        expect(PE_MEMBERS).toHaveLength(33);
    });

    it('Trading is re-exported and functional', () => {
        expect(typeof Trading.calculatePrice).toBe('function');
        expect(typeof Trading.getAvailableGoods).toBe('function');
    });

    it('cross-references resolve (Trading sees PlayerEconomy.GOODS)', () => {
        expect(PlayerEconomy.GOODS).toBeTruthy();
        const good = { id: 'firewood', basePrice: 100 };
        const price = Trading.calculatePrice(good, { type: 'town' }, { terrain: { id: 'plains' }, resource: { id: 'none' } });
        expect(Number.isFinite(price)).toBe(true);
    });
});
