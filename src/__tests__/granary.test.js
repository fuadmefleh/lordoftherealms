/**
 * Buying grain at a town's granary (ui/innerMapGranary.js): it sells from the
 * town's food store what the town can spare, and the gold goes to the town.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapGranary } from '../ui/innerMapGranary.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function setup(food) {
    const settlement = { name: 'Testby', type: 'village', population: 300, economy: { food, gold: 0 } };
    InnerMap._currentWorldTileRef = { settlement, terrain: { id: 'grassland' } };
    const notes = [];
    const game = {
        world: { day: 30, activeEvents: [], getTile: () => InnerMap._currentWorldTileRef },
        player: { gold: 500, inventory: {} },
        ui: { showNotification: (...a) => notes.push(a), updateStats() {} },
    };
    return { game, settlement, notes };
}

const granary = { type: 'granary', name: 'Granary', q: 1, r: 1 };

describe('the granary', () => {
    it('sells what it can spare, keeping the town a few days of food', () => {
        const { game, settlement } = setup(150);
        // 300 folk eat 30 a day; three days are kept back
        expect(InnerMapGranary.spare(settlement)).toBe(60);
        const items = InnerMapGranary.menuItems(game, granary).filter(i => i.action === 'granary_buy');
        expect(items.map(i => i.qty)).toEqual([1, 5, 20]);
        const price = InnerMapGranary.price(game, settlement, InnerMap._currentWorldTileRef);
        expect(InnerMapGranary.handle(game, items[1])).toBe(true);
        expect(game.player.inventory.grain).toBe(5);
        expect(game.player.gold).toBe(500 - 5 * price);
        expect(settlement.economy.food).toBe(145);
        expect(settlement.economy.gold).toBe(5 * price);
    });

    it('in a lean year has nothing to sell', () => {
        const { game, settlement, notes } = setup(80);
        expect(InnerMapGranary.spare(settlement)).toBe(0);
        expect(InnerMapGranary.menuItems(game, granary).some(i => i.action === 'granary_buy')).toBe(false);
        InnerMapGranary.handle(game, { action: 'granary_buy', qty: 5 });
        expect(game.player.inventory.grain).toBeUndefined();
        expect(notes.length).toBe(1);
    });
});

describe('the granary on the first day', () => {
    it('an established town starts with food put by; a new colony with none', async () => {
        const { Economy } = await import('../world/economy.js');
        const town = Economy.initSettlement({ type: 'town', population: 1000 });
        expect(town.economy.food).toBe(1000 * Economy.FOOD.perCapita * Economy.FOOD.startDays);
        expect(InnerMapGranary.spare(town)).toBeGreaterThan(0);
        const colony = Economy.initSettlement({ type: 'village', population: 80 }, { fresh: true });
        expect(colony.economy.food).toBe(0);
    });
});

describe('selling grain to the granary', () => {
    it('the keeper buys your grain into the store, for less than they sell it', () => {
        const { game, settlement } = setup(150);
        game.player.inventory.grain = 12;
        const tile = InnerMap._currentWorldTileRef;
        const pay = InnerMapGranary.price(game, settlement, tile, true);
        expect(pay).toBeLessThan(InnerMapGranary.price(game, settlement, tile));
        const sells = InnerMapGranary.menuItems(game, granary).filter(i => i.action === 'granary_sell');
        expect(sells.map(i => i.qty)).toEqual([1, 5, 12]);
        InnerMapGranary.handle(game, sells[2]);
        expect(game.player.inventory.grain).toBeUndefined();
        expect(game.player.gold).toBe(500 + 12 * pay);
        expect(settlement.economy.food).toBe(162);
    });

    it('a full granary buys no more than it has room for', () => {
        // 300 folk, ten days' needs: room for 300
        const { game, settlement } = setup(295);
        game.player.inventory.grain = 20;
        InnerMapGranary.handle(game, { action: 'granary_sell', qty: 20 });
        expect(game.player.inventory.grain).toBe(15);
        expect(settlement.economy.food).toBe(300);
        expect(InnerMapGranary.menuItems(game, granary).some(i => i.action === 'granary_sell')).toBe(false);
    });
});
