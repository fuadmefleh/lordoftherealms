/**
 * The last hollow gaps: every gain path respects the inventory cap, plague
 * reaches colonies, the settlement food model is balanced and sticks, and
 * Explorer rulers' scouting has a label.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Quests } from '../systems/quests.js';
import { Ships } from '../systems/ships.js';
import { Technology } from '../systems/technology.js';
import { Economy } from '../world/economy.js';
import { KingdomBonuses } from '../world/kingdomState.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** A player whose packs are full: `slots` distinct goods and a capacity of `slots`. */
function fullPlayer(slots = 3) {
    const inventory = {};
    for (let i = 0; i < slots; i++) inventory[`junk_${i}`] = 1;
    return { gold: 0, renown: 0, karma: 0, inventory, maxInventory: slots };
}

describe('inventory cap on every gain path', () => {
    it('quest item rewards that do not fit are sold at base price', () => {
        const player = fullPlayer();
        Quests.initialize(player);
        const quest = { rewards: { items: { weapons: 2 } } };
        Quests.grantRewards(player, quest);
        expect(player.inventory.weapons).toBeUndefined();
        expect(quest.overflowSold.gold).toBe(PlayerInventory.goodValue('weapons') * 2);
        expect(player.gold).toBe(quest.overflowSold.gold);
    });

    it('owed goods still stack onto something already carried', () => {
        const player = fullPlayer();
        const res = PlayerInventory.addOrSell(player, { junk_0: 5 });
        expect(player.inventory.junk_0).toBe(6);
        expect(res.gold).toBe(0);
    });

    it('ship cargo that does not fit stays aboard', () => {
        const player = fullPlayer();
        const ship = { cargo: { iron: 4, junk_1: 2 } };
        const res = Ships.unloadCargo(ship, player);
        expect(res.packsFull).toBe(true);
        expect(ship.cargo.iron).toBe(4);
        expect(player.inventory.junk_1).toBe(3);
    });

    it('finished parts wait at the workshop until there is room', () => {
        const player = fullPlayer();
        Technology.initPlayer(player);
        player.technology.currentCrafting = { partsType: 'agri_parts', quantity: 3, progress: 2, totalDays: 3 };
        const res = Technology.processCrafting(player);
        expect(res.waitingForRoom).toBe(true);
        expect(player.technology.currentCrafting).toBeTruthy();

        delete player.inventory.junk_0; // make room
        const done = Technology.processCrafting(player);
        expect(done.completed).toBe(true);
        expect(player.inventory.agri_parts).toBe(3);
    });
});

describe('plague reaches colonies', () => {
    it('thins settlers and loyalty, cut by plague resistance', () => {
        const colony = { name: 'New Hope', type: 'village', population: 500, colony: { loyalty: 70 } };
        const tile = { q: 4, r: 4, settlement: colony };
        const world = {
            activeEvents: [{ id: 'plague', effects: {}, kingdomId: null, daysLeft: 5 }],
            getTile: (q, r) => (q === 4 && r === 4 ? tile : null),
        };
        const player = { colonies: [{ q: 4, r: 4 }], technology: { implemented: [] } };
        const hits = Technology.applyColonyPlague(player, world);
        expect(hits).toHaveLength(1);
        expect(hits[0].lost).toBe(10);
        expect(colony.population).toBe(490);
        expect(colony.colony.loyalty).toBe(68);
    });

    it('does nothing without colonies or plague', () => {
        expect(Technology.applyColonyPlague({ colonies: [] }, { activeEvents: [] })).toEqual([]);
    });
});

describe('settlement food model', () => {
    const feed = (settlement, days, mods) => {
        Economy.initSettlement(settlement);
        for (let i = 0; i < days; i++) {
            settlement.economy.food += settlement._marketFood || 0;
            Economy._feedPopulation(settlement, mods);
        }
        return settlement;
    };

    it('a village with a little market food grows, but never past its capacity', () => {
        const v = feed({ type: 'village', population: 1000, _marketFood: 20 }, 365);
        expect(v.population).toBeGreaterThan(1000);
        expect(v.population).toBeLessThan(Economy.FOOD.capacity.village);
    });

    it('a solvent city buys in food and holds steady', () => {
        const c = { type: 'city', population: 5000, _marketFood: 40 };
        Economy.initSettlement(c);
        c.economy.gold = 100000;
        feed(c, 365);
        expect(c.population).toBe(5000);
        expect(c.economy.foodImported).toBeGreaterThan(0);
        expect(c.economy.gold).toBeLessThan(100000);
    });

    it('a broke city goes hungry and shrinks', () => {
        const c = feed({ type: 'capital', population: 10000, _marketFood: 0 }, 100);
        expect(c.population).toBeLessThan(10000);
        expect(c.population).toBeGreaterThan(9000); // gradual, not a collapse
    });

    it('the granary is bounded', () => {
        const v = feed({ type: 'village', population: 200, _marketFood: 500 }, 30);
        expect(v.economy.food).toBeLessThanOrEqual(v.population * Economy.FOOD.perCapita * Economy.FOOD.stockDays);
    });
});

describe('Explorer rulers', () => {
    it('scouting shows up among kingdom bonuses', () => {
        const kingdom = { characterBonuses: { visionRadius: 0.2 } };
        expect(KingdomBonuses.get(kingdom, 'visionRadius')).toBeCloseTo(0.2);
        expect(KingdomBonuses.summary(kingdom).some(b => b.key === 'visionRadius')).toBe(true);
    });
});

describe('Romantic dinner needs a settlement', () => {
    it('is locked in the wilderness and open in town', async () => {
        const { Relationships } = await import('../systems/relationships.js');
        const npc = { id: 'npc_x', firstName: 'Ana', personality: 'kind', attraction: 50 };
        const orig = Relationships.getNPC;
        Relationships.getNPC = () => npc;
        try {
            const player = { q: 1, r: 1, relationships: {} };
            const wild = { getTile: () => ({ settlement: null }) };
            const town = { getTile: () => ({ settlement: { name: 'Holt' } }) };
            const find = (w) => Relationships.getCourtActionAvailability(player, 'npc_x', { world: w }).find(a => a.id === 'romantic_dinner');
            const inWild = find(wild);
            expect(inWild).toBeTruthy();
            expect(inWild.lockReason).toBe('Only possible in a settlement');
            expect(find(town).lockReason).not.toBe('Only possible in a settlement');
        } finally {
            Relationships.getNPC = orig;
        }
    });
});
