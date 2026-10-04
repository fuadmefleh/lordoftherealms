// Values that used to be written but never read now do something:
// NPC fear, contested holy sites, settlement growth, festival envoys,
// botched bounty arrests and the kingdom military cap.

import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Religion } from '../systems/religion.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Festivals } from '../systems/festivals.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Kingdom } from '../world/kingdom.js';
import { WorldEvents } from '../world/worldEvents.js';

describe('NPC fear (fearful memory)', () => {
    it('a cowed NPC is easier to intimidate again', () => {
        const npc = { name: 'Bram', type: 'merchant' };
        expect(NpcDisposition.threatDifficulty(npc, 5)).toBe(5);
        NpcDisposition.getMemory(npc).fearful = true;
        expect(NpcDisposition.intimidationModifier(npc)).toBe(-2);
        expect(NpcDisposition.threatDifficulty(npc, 5)).toBe(3);
        expect(NpcDisposition.threatDifficulty(npc, 2)).toBe(1);
    });

    it('a frightened trader pads prices', () => {
        const npc = { name: 'Bram', type: 'merchant' };
        const calm = NpcDisposition.getPriceModifiers(npc).buy;
        NpcDisposition.getMemory(npc).fearful = true;
        const scared = NpcDisposition.getPriceModifiers(npc);
        expect(scared.buy).toBeCloseTo(calm + 0.05);
        expect(scared.reasons.some(r => r.label === 'Afraid of you')).toBe(true);
    });

    it('only a cowed NPC greets you with fear; one who stood firm is defiant', () => {
        const npc = { name: 'Bram', type: 'merchant' };
        Utils.setSeed(3);
        NpcDisposition.resolveThreat(npc, { gold: 0 }, false);
        expect(NpcDisposition.threatReaction(npc).kind).toBe('defiant');
        NpcDisposition.resolveThreat(npc, { gold: 0 }, true);
        expect(NpcDisposition.threatReaction(npc).kind).toBe('fear');
    });
});

describe('contested holy sites', () => {
    function setup(contested) {
        const site = { name: 'Shrine', incomeBonus: 100, level: 1, pilgrimCount: 0, controller: 1, contested, faithBonus: 6 };
        const tile = { holySite: site };
        const kingdom = {
            id: 1, name: 'Avalon', isAlive: true, treasury: 0, relations: {},
            religion: { faithId: 'solaris', piety: 50, unity: 50, heresies: [], holySites: [{ q: 0, r: 0 }] },
        };
        const world = { kingdoms: [kingdom], events: [], getTile: () => tile, getKingdom: () => kingdom };
        return { site, tile, kingdom, world };
    }

    it('a contested site yields half its pilgrim income and counts down to peace', () => {
        const calm = setup(false);
        Utils.setSeed(7);
        Religion.processTurn(calm.world);
        const hot = setup(true);
        hot.site.contestedDaysLeft = 2;
        Utils.setSeed(7);
        Religion.processTurn(hot.world);
        expect(calm.kingdom.religion.pilgrimIncome).toBe(10);
        expect(hot.kingdom.religion.pilgrimIncome).toBe(5);
        expect(hot.kingdom.religion.contestedSites).toBe(1);
        // Contested unrest drains piety relative to the same roll at a calm site
        expect(hot.kingdom.religion.piety).toBeCloseTo(calm.kingdom.religion.piety - Religion.CONTESTED_SITE.pietyDrain);
        expect(hot.site.contested).toBe(true);
        Religion.processTurn(hot.world);
        expect(hot.site.contested).toBe(false);
    });

    it('seizing a site starts the contest timer', () => {
        const { tile, kingdom, world } = setup(false);
        const taker = { id: 2, name: 'Bryn', isAlive: true, relations: {}, religion: { holySites: [] } };
        tile.kingdom = 2;
        world.getKingdom = id => (id === 2 ? taker : kingdom);
        Religion.processHolySiteContestation(kingdom, world);
        expect(tile.holySite.contested).toBe(true);
        expect(tile.holySite.contestedDaysLeft).toBe(Religion.CONTESTED_SITE.days);
    });

    it('pilgrims at a contested site receive thinner offerings', () => {
        const player = () => ({ karma: 0, gold: 0, renown: 0, faith: 0, health: 50, maxHealth: 100, quests: {} });
        const calm = setup(false);
        const hot = setup(true);
        Utils.setSeed(11);
        const a = Religion.completePilgrimage(player(), calm.tile, calm.world);
        Utils.setSeed(11);
        const b = Religion.completePilgrimage(player(), hot.tile, hot.world);
        expect(b.contested).toBe(true);
        expect(b.goldReward).toBe(Math.floor(a.goldReward * Religion.CONTESTED_SITE.pilgrimGoldMult));
    });
});

describe('settlement growthRate', () => {
    it('drives the population projection', () => {
        expect(Taxation.projectPopulation({ population: 1200, growthRate: 0.05 }, 120)).toBe(1260);
        expect(Taxation.projectPopulation({ population: 1200, growthRate: -0.1 }, 30)).toBe(1170);
        expect(Taxation.projectPopulation({ population: 1200 }, 30)).toBe(1200);
        expect(Taxation.projectPopulation({ population: 8, growthRate: -0.5 }, 120)).toBe(8);
    });

    it('feeds the tax estimate rows', () => {
        const settlement = { name: 'Holt', population: 2400, growthRate: 0.05, happiness: 50 };
        const tile = { q: 0, r: 0, settlement };
        const world = { getTile: () => tile, events: [], activeEvents: [] };
        const player = { taxRate: 'very_low', gold: 0, settlements: [{ q: 0, r: 0 }], colonies: [] };
        const orig = Taxation.getPlayerSettlements;
        Taxation.getPlayerSettlements = () => [{ q: 0, r: 0, settlement }];
        try {
            const est = Taxation.collectTaxes(player, world, { dryRun: true });
            const row = est.settlements[0];
            expect(row.growthRate).toBe(0.05);
            expect(row.projectedPopulation).toBe(2430);
            expect(row.projectedCollected).toBeGreaterThanOrEqual(row.collected);
        } finally {
            Taxation.getPlayerSettlements = orig;
        }
    });
});

describe('festival diplomacy events', () => {
    it('envoys feted in the past bring goodwill to future receptions', () => {
        const p = { reputation: {} };
        Festivals.initialize(p);
        expect(Festivals.getReputation(p).envoyGoodwill).toBe(0);
        p.festivals.diplomacyEvents = 11;
        expect(Festivals.getReputation(p).envoyGoodwill).toBe(2);
        p.festivals.diplomacyEvents = 99;
        expect(Festivals.getReputation(p).envoyGoodwill).toBe(3);
    });

    it('a received envoy warms their realm toward the one you serve', () => {
        const home = { id: 1, isAlive: true, relations: { 2: 0 } };
        const rival = { id: 2, isAlive: true, relations: { 1: -10 } };
        const world = { getKingdom: id => (id === 1 ? home : id === 2 ? rival : null) };
        expect(Festivals.envoyRelationGain({ allegiance: 1 }, world, 2, { id: 'grand' })).toBe(2);
        expect(rival.relations[1]).toBe(-8);
        expect(home.relations[2]).toBe(2);
        expect(Festivals.envoyRelationGain({ allegiance: null }, world, 2, { id: 'modest' })).toBe(0);
        expect(Festivals.envoyRelationGain({ allegiance: 2 }, world, 2, { id: 'modest' })).toBe(0);
    });
});

describe('failed bounty captures', () => {
    it('botched arrests beyond your successes cut your pay', () => {
        const p = { skills: {} };
        BountyHunting.initialize(p);
        expect(BountyHunting.getBotchPenalty(p)).toBe(0);
        p.bountyHunter.failedCaptures = 3;
        p.bountyHunter.capturesTurnedIn = 1;
        expect(BountyHunting.getBotchPenalty(p)).toBeCloseTo(0.1);
        p.bountyHunter.failedCaptures = 40;
        expect(BountyHunting.getBotchPenalty(p)).toBeCloseTo(0.25);
    });

    it('lowers what magistrates pay on turn-in', () => {
        const p = { gold: 0, renown: 0, skills: {}, activeBounties: [] };
        BountyHunting.initialize(p);
        p.bountyHunter.failedCaptures = 4; // 4 botches, 0 successes → −20%
        const b = { id: 'b1', type: 'criminal_hunt', status: 'captured_pending_decision', targetName: 'Venn', difficulty: 4, actualPay: 200, recruitedUnit: { strength: 10, upkeep: 6 } };
        p.activeBounties.push(b);
        expect(BountyHunting.resolveCapturedTarget(p, b, 'turn_in').pay).toBe(160);
    });

    it('a failed capture says the hunter\'s reputation suffered', () => {
        Utils.setSeed(2);
        const p = { skills: { combat: 1 }, army: [] };
        BountyHunting.initialize(p);
        const b = { id: 'b2', type: 'criminal_hunt', status: 'active', targetName: 'Venn', difficulty: 40, targetQ: 5, targetR: 5 };
        const res = BountyHunting.attemptCapture(p, b, { width: 20, height: 20 });
        expect(res.success).toBe(false);
        expect(res.botchPenalty).toBeCloseTo(0.05);
        expect(res.reason).toMatch(/botched arrest/);
    });
});

describe('kingdom military cap', () => {
    it('recruitment never raises the army past the cap', () => {
        const k = { military: 90, militaryCap: 100 };
        expect(Kingdom.recruitTroops(k, 50)).toBe(10);
        expect(k.military).toBe(100);
        expect(Kingdom.recruitTroops(k, 5)).toBe(0);
        const over = { military: 150, militaryCap: 100 };
        expect(Kingdom.recruitTroops(over, 5)).toBe(0);
        expect(over.military).toBe(150);
        const uncapped = { military: 10 };
        expect(Kingdom.recruitTroops(uncapped, 7)).toBe(7);
    });

    it('a recruitment drive at the cap finds no takers', () => {
        const k = { id: 1, name: 'Avalon', isAlive: true, population: 10000, military: 500, militaryCap: 500 };
        const world = { kingdoms: [k] };
        let ev = null;
        for (let seed = 1; seed < 200 && !ev; seed++) {
            Utils.setSeed(seed);
            k.military = 500;
            const e = WorldEvents.generateMilitaryEvent(world);
            if (e && /recruitment drive/i.test(e.text)) ev = e;
        }
        expect(ev).not.toBeNull();
        expect(ev.text).toMatch(/cannot feed a larger army/);
        expect(k.military).toBe(500);
    });
});
