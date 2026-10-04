/**
 * Colony policies and indigenous diplomacy are real: a colony follows the
 * policy it was founded with, its productionBonus scales its gold and goods,
 * and a tribe's temperament (hostility) and tradeability shape talks with it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Colonization } from '../world/colonization.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('colony policy', () => {
    it('policies come from colonization.json with descriptions', () => {
        expect(Colonization.POLICIES.exploitation.productionBonus).toBeGreaterThan(0);
        expect(Colonization.POLICIES.exploitation.description).toBeTruthy();
    });

    it("a colony's own policy beats its mother kingdom's", () => {
        const kingdom = { colonization: { policy: 'coexistence' } };
        expect(Colonization.getColonyPolicy({ policy: 'exploitation' }, kingdom).id).toBe('exploitation');
        expect(Colonization.getColonyPolicy({}, kingdom).id).toBe('coexistence');
        expect(Colonization.getColonyPolicy({ policy: 'bogus' }, null).id).toBe('coexistence');
    });

    it('productionBonus applies only to colonies', () => {
        expect(Colonization.getProductionBonus({ colony: { policy: 'exploitation' } }, null)).toBeCloseTo(0.3);
        expect(Colonization.getProductionBonus({ population: 500 }, null)).toBe(0);
    });

    it('Economy.produceDaily scales gold by the production modifier', () => {
        const tile = { q: 0, r: 0, terrain: { id: 'plains' } };
        const world = { getTile: () => tile, width: 10, height: 10 };
        const make = () => ({ type: 'village', population: 400, level: 0, q: 0, r: 0 });
        const plain = make();
        const exploited = make();
        Utils.setSeed(5);
        Economy.produceDaily(plain, tile, world, {}, {});
        Utils.setSeed(5);
        Economy.produceDaily(exploited, tile, world, {}, { production: 0.3 });
        expect(plain.economy.gold).toBeGreaterThan(0);
        expect(exploited.economy.gold).toBeGreaterThan(plain.economy.gold);
    });

    it('loyalty drifts by the colony policy, not the kingdom policy', () => {
        const mk = (policy) => {
            const settlement = { name: 'C', population: 100, level: 0, colony: { loyalty: 50, policy, garrisonStrength: 0 } };
            const tile = { q: 5, r: 5, settlement };
            const world = {
                day: 1, width: 40, height: 40, events: [],
                getTile: (q, r) => (q === 5 && r === 5 ? tile : null),
            };
            const kingdom = { id: 'k', capital: { q: 5, r: 6 }, territory: [], colonization: { policy: 'manifest_destiny', colonies: [{ q: 5, r: 5 }] } };
            Utils.setSeed(1);
            Colonization.processKingdomColonies(kingdom, world);
            return settlement.colony.loyalty;
        };
        // coexistence +0.15 vs exploitation -0.1 per day
        expect(mk('coexistence') - mk('exploitation')).toBeCloseTo(0.25, 5);
    });

    it("the colony panel's indigenous relation tracks its neighbours", () => {
        const settlement = { name: 'C', population: 100, level: 0, colony: { loyalty: 50, policy: 'coexistence', garrisonStrength: 0 } };
        const tiles = { '5,5': { q: 5, r: 5, settlement }, '6,5': { q: 6, r: 5, indigenous: { relation: -40 } } };
        const world = { day: 1, width: 40, height: 40, events: [], getTile: (q, r) => tiles[`${q},${r}`] || null };
        const kingdom = { id: 'k', capital: { q: 5, r: 6 }, territory: [], colonization: { policy: 'coexistence', colonies: [{ q: 5, r: 5 }] } };
        Colonization.processKingdomColonies(kingdom, world);
        expect(settlement.colony.indigenousRelation).toBe(-40);
    });
});

describe('indigenous diplomacy', () => {
    it('hostility blends temperament with relations', () => {
        const fierce = { hostility: 0.6, relation: 0 };
        const gentle = { hostility: 0.1, relation: 0 };
        expect(Colonization.getTribeHostility(fierce)).toBe(60);
        expect(Colonization.getTribeHostility(gentle)).toBe(10);
        expect(Colonization.getTribeDisposition(fierce)).toBe('Wary');
        expect(Colonization.getTribeDisposition(gentle)).toBe('Friendly');
        fierce.relation = 50;
        expect(Colonization.getTribeHostility(fierce)).toBe(30);
    });

    it('only trusting tribes share knowledge', () => {
        expect(Colonization.canLearnFromTribe({ hostility: 0.6, relation: 0 })).toBe(false);
        expect(Colonization.canLearnFromTribe({ hostility: 0.2, relation: 0 })).toBe(true);
    });

    it('keen traders warm faster and pay better than reluctant ones', () => {
        const keen = { hostility: 0.4, tradeability: 0.8, relation: 0 };
        const shy = { hostility: 0.4, tradeability: 0.2, relation: 0 };
        const p1 = { gold: 500, karma: 0 };
        const p2 = { gold: 500, karma: 0 };
        Utils.setSeed(9);
        const a = Colonization.tradeWithTribe(p1, keen);
        Utils.setSeed(9);
        const b = Colonization.tradeWithTribe(p2, shy);
        expect(a.success && b.success).toBe(true);
        expect(keen.relation).toBeGreaterThan(shy.relation);
        expect(a.profit).toBeGreaterThan(b.profit);
        expect(p1.gold).toBeGreaterThan(p2.gold);
    });

    it('trade and tribute cost gold and fail without it', () => {
        const ind = { hostility: 0.4, tradeability: 0.5, relation: 0 };
        expect(Colonization.tradeWithTribe({ gold: 10 }, ind).success).toBe(false);
        const p = { gold: 100, renown: 0 };
        const res = Colonization.tributeToTribe(p, ind);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(0);
        expect(p.renown).toBe(5);
        expect(ind.relation).toBe(25);
    });

    it('fierce tribes raid encroaching colonies; gentle ones do not', () => {
        const run = (temperament) => {
            const colonySettlement = { name: 'Fort', population: 200, colony: { loyalty: 60 } };
            const tiles = {};
            for (let q = 0; q < 6; q++) for (let r = 0; r < 6; r++) tiles[`${q},${r}`] = { q, r };
            tiles['2,2'].indigenous = { name: 'Tribe', population: 100, hostility: temperament, relation: -10 };
            tiles['3,2'].kingdom = 'k';
            tiles['3,2'].settlement = colonySettlement;
            const world = {
                width: 6, height: 6, events: [],
                tiles: [...Array(6)].map((_, r) => [...Array(6)].map((__, q) => tiles[`${q},${r}`])),
                getTile: (q, r) => tiles[`${q},${r}`] || null,
                getKingdom: () => ({ colonization: { policy: 'coexistence' } }),
            };
            Utils.setSeed(3);
            for (let d = 0; d < 400; d++) Colonization.processIndigenous(world);
            return world.events.filter(e => e.text.includes('raided')).length;
        };
        expect(run(0.75)).toBeGreaterThan(0);
        expect(run(0.1)).toBe(0);
    });
});
