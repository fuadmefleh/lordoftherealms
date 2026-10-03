// Spending House Prestige: each sink now does something.
//   Press a Claim       — take the next office, waiving reputation/renown
//   Prestigious Marriage — a noble suitor appears; marrying them pays off
//   Call in a Favor      — gold or reputation from an allied House

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { House } from '../systems/house.js';
import { Titles } from '../systems/titles.js';
import { Relationships } from '../systems/relationships.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(3));

const world = {
    day: 10,
    getKingdom: (id) => ({ id, name: 'Valemark', culture: 'Imperial' }),
};

function makePlayer(prestige = 100) {
    const player = {
        id: 'p1', lastName: 'Ashborne', gold: 0, renown: 0, reputation: {}, relationships: {},
        skills: { commerce: 10, combat: 10, leadership: 10, diplomacy: 10, stealth: 10, faith: 10 },
        strength: 10, charisma: 10, intelligence: 10,
    };
    House.initialize(player, world);
    House.award(player.house, prestige, 'test', 1);
    Titles.initialize(player);
    return player;
}

describe('Prestige sinks', () => {
    it('press a claim: takes the next office despite low reputation and renown', () => {
        const player = makePlayer();
        player.allegiance = 'k1';
        const before = player.house.prestige;
        const claim = Titles.getClaimableTitle(player, world);
        expect(claim.titleId).toBeTruthy();
        expect(Titles.meetsRequirements(player, claim.titleId, world).meets).toBe(false);

        const res = Titles.pressClaim(player, world);

        expect(res.success).toBe(true);
        expect(player.currentTitle).toBe(claim.titleId);
        expect(player.house.prestige).toBeLessThan(before);
    });

    it('press a claim: refuses without a kingdom, spending nothing', () => {
        const player = makePlayer();
        const before = player.house.prestige;
        expect(Titles.pressClaim(player, world).success).toBe(false);
        expect(player.house.prestige).toBe(before);
    });

    it('call in a favor: gold scales with generation; influence raises reputation', () => {
        const player = makePlayer();
        const gold = House.callInFavor(player, world, { kind: 'gold' });
        expect(gold.gold).toBe(House.FAVOR_GOLD_BASE + House.FAVOR_GOLD_PER_GENERATION * player.house.generation);
        expect(player.gold).toBe(gold.gold);
        House.callInFavor(player, world, { kind: 'influence', kingdomId: 'k1' });
        expect(player.reputation.k1).toBe(House.FAVOR_REPUTATION);
    });

    it('prestigious marriage: a fond noble appears, and marrying them pays off', () => {
        const player = makePlayer();
        const tile = { settlement: { name: 'Ashby', kingdom: 'k1', type: 'town', q: 1, r: 1 } };
        const res = Relationships.arrangeNobleMatch(player, tile, world);
        expect(res.success).toBe(true);
        expect(res.npc.noble).toBe(true);
        expect(player.relationships[res.npc.id].affection).toBeGreaterThanOrEqual(60);

        const prestigeBefore = player.house.prestige;
        Relationships.marry(player, res.npc.id, world);
        expect(player.renown).toBeGreaterThanOrEqual(13);
        expect(player.reputation.k1).toBe(20);
        expect(player.house.prestige).toBeGreaterThan(prestigeBefore);
    });
});
