/**
 * Mechanics that used to be promised but hollow: NPC requests become real
 * quests, smelted ingots have value, the Chancellor's tax perk pays, travel
 * companions help, and gossip bounties/warrants can be settled.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Quests } from '../systems/quests.js';
import { Gossip } from '../systems/gossip.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Relationships } from '../systems/relationships.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { SettlementServices } from '../player/settlementServices.js';
import { SMELT_RECIPES, CRAFT_RECIPES } from '../ui/objectActions/data.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makePlayer(overrides = {}) {
    return {
        gold: 1000, karma: 0, renown: 0, health: 50, maxHealth: 100, inventory: {}, reputation: {},
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        relationships: {}, travelParty: [], criminalRecord: {},
        ...overrides,
    };
}

describe('NPC requests become quests', () => {
    it('accepting a hook creates a tracked quest that pays out on completion', () => {
        const player = makePlayer();
        Quests.initialize(player);
        Quests.track(player, 'ruins_explored', 4); // progress before accepting doesn't count
        const res = Quests.createNpcTask(player, { text: 'Explore the ruins.', type: 'explore_ruins', reward: 'treasure' }, { id: 3, name: 'Edda' });
        expect(res.success).toBe(true);
        expect(player.quests.active.some(q => q.id === res.quest.id)).toBe(true);

        expect(Quests.updateProgress(player, { width: 0, height: 0, tiles: [] })).toHaveLength(0);
        Quests.track(player, 'ruins_explored');
        const gold = player.gold;
        const done = Quests.updateProgress(player, { width: 0, height: 0, tiles: [] });
        expect(done.map(q => q.id)).toContain(res.quest.id);
        expect(player.gold).toBe(gold + Quests.NPC_TASK_REWARDS.treasure.gold);
    });

    it('every dialogue hook type maps to an objective', async () => {
        const { NPC_QUEST_HOOKS } = await import('../ui/npcDialog.data.js');
        for (const hook of Object.values(NPC_QUEST_HOOKS).flat()) {
            expect(Quests.NPC_TASK_OBJECTIVES[hook.type], hook.type).toBeTruthy();
            expect(Quests.NPC_TASK_REWARDS[hook.reward], hook.reward).toBeTruthy();
        }
    });

    it('item rewards land in the inventory', () => {
        const player = makePlayer();
        Quests.initialize(player);
        Quests.grantRewards(player, { rewards: { gold: 0, items: { weapons: 1 } } });
        expect(player.inventory.weapons).toBe(1);
    });
});

describe('smelting has a point', () => {
    it('ingots and bars are tradeable goods worth more than their ore', () => {
        for (const r of SMELT_RECIPES) {
            const [outId] = Object.keys(r.result);
            const good = PlayerEconomy.GOODS[outId.toUpperCase()];
            expect(good, outId).toBeTruthy();
            const inputValue = Object.entries(r.ingredients)
                .reduce((sum, [id, n]) => sum + PlayerEconomy.GOODS[id.toUpperCase()].basePrice * n, 0);
            expect(good.basePrice).toBeGreaterThan(inputValue);
        }
    });

    it('ingots feed forge recipes', () => {
        expect(CRAFT_RECIPES.some(r => r.ingredients.iron_ingot)).toBe(true);
        expect(CRAFT_RECIPES.some(r => r.ingredients.gold_bar)).toBe(true);
    });
});

describe("Chancellor's tax perk", () => {
    it('adds 10% to settlement taxes', () => {
        expect(Taxation.officeTaxMultiplier(makePlayer())).toBe(1);
        expect(Taxation.officeTaxMultiplier(makePlayer({ currentTitle: 'chancellor' }))).toBeCloseTo(1.1);
    });
});

describe('travel companions', () => {
    it('add bonuses by occupation and heal the player daily', () => {
        const knight = { id: 'rnpc_t1', firstName: 'Ser Ada', occupation: 'knight', isAlive: true };
        const healer = { id: 'rnpc_t2', firstName: 'Mira', occupation: 'healer', isAlive: true };
        Relationships._npcs.push(knight, healer);
        const player = makePlayer({ travelParty: [knight.id, healer.id] });
        player.relationships[knight.id] = { score: 10, history: [] };
        player.relationships[healer.id] = { score: 10, history: [] };

        expect(PlayerEffects.companionBonus(player, 'power')).toBeCloseTo(0.10);
        const res = PlayerEffects.processCompanions(player, { day: 5 });
        expect(res.healed).toBe(5);
        expect(player.health).toBe(55);
        expect(player.relationships[knight.id].score).toBe(11);
        expect(PlayerEffects.companionBonus(makePlayer(), 'power')).toBe(0);
    });
});

describe('gossip bounties and warrants', () => {
    function wantedPlayer() {
        const player = makePlayer();
        Gossip.initializePlayer(player);
        player.gossip.rumors.push({
            id: 1, type: 'murder', perpetrator: 'You', victim: { name: 'Tom' }, locationName: 'Ashford',
            severity: 95, credibility: 1, spreadTo: ['2,3'], consequencesApplied: {}, dayCreated: 0,
        });
        player.gossip.bounties.push({ rumorId: 1, kingdom: 'k1', gold: 120, issuedDay: 0 });
        player.gossip.warrants = { k1: { issuedDay: 0, rumorId: 1 } };
        return player;
    }
    const world = { getTile: (q, r) => (q === 2 && r === 3 ? { q, r, settlement: { name: 'Ashford', kingdom: 'k1' } } : null) };

    it('a warrant gets the player refused service', () => {
        const verdict = Gossip.refusesService(wantedPlayer(), 2, 3, world);
        expect(verdict.refused).toBe(true);
    });

    it('settling at the guard tower pays the bounty, lifts the warrant and calms the guards', () => {
        const player = wantedPlayer();
        const settlement = { name: 'Ashford', type: 'town', kingdom: 'k1' };
        const res = SettlementServices.payFines(player, settlement);
        expect(res.success).toBe(true);
        expect(res.bountiesCleared).toBe(1);
        expect(res.warrantLifted).toBe(true);
        expect(player.gold).toBeLessThan(1000 - 120);
        expect(Gossip.refusesService(player, 2, 3, world).refused).toBe(false);
        expect(Gossip.checkGuardHostility(player, 2, 3, world).hostile).toBe(false);
    });

    it('a clean player has nothing to settle', () => {
        const player = makePlayer();
        Gossip.initializePlayer(player);
        expect(SettlementServices.payFines(player, { kingdom: 'k1' }).success).toBe(false);
    });
});
