/**
 * NPC lord goals and stats do something: every goal a trait can give has a
 * real effect on the lord's kingdom, the lord's honor, intelligence, ambition
 * and stewardship are read by the kingdom AI, and the 'colonize' goal sends
 * only the lord's own realm's pioneers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomStability, LordInfluence } from '../world/kingdomState.js';
import { Colonization } from '../world/colonization.js';
import lordData from '../../data/npcLords.json';

const MID = { ambition: 5.5, honor: 5.5, intelligence: 5.5, stewardship: 5.5 };

function lord(goals = [], stats = {}) {
    return { name: 'Lord Test', traits: [], goals, goalsVersion: NPCLords.GOALS_VERSION, relationships: {}, age: 40, ...MID, ...stats };
}

function kingdom(id, extra = {}) {
    return {
        id, name: `Realm ${id}`, isAlive: true, territory: [], wars: [], allies: [], relations: {}, truces: {},
        military: 500, treasury: 10000, population: 10000, stability: 60, ...extra,
    };
}

/** A strip world: A holds columns 0-3, B columns 4-7, C columns 8-11; one town each. */
function makeWorld() {
    const tiles = {};
    const ks = [kingdom('A'), kingdom('B'), kingdom('C')];
    for (let q = 0; q < 12; q++) {
        for (let r = 0; r < 3; r++) {
            const owner = ks[Math.floor(q / 4)];
            tiles[`${q},${r}`] = { q, r, kingdom: owner.id, terrain: { id: 'plains', passable: true } };
            owner.territory.push({ q, r });
        }
    }
    const towns = [['1,1', 'Aton', 'A'], ['5,1', 'Bury', 'B'], ['9,1', 'Cove', 'C']];
    for (const [key, name, kid] of towns) {
        const [q, r] = key.split(',').map(Number);
        tiles[key].settlement = { name, type: 'capital', kingdom: kid, population: 5000, q, r };
        ks.find(k => k.id === kid).capital = { q, r };
    }
    const world = {
        day: 100, width: 12, height: 3, kingdoms: ks, units: [], events: [], activeEvents: [],
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: (id) => ks.find(k => k.id === id) || null,
        getAllSettlements: () => Object.values(tiles).filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
    return { world, tiles, A: ks[0], B: ks[1], C: ks[2] };
}

beforeEach(() => Utils.setSeed(1234));

describe('generateGoals', () => {
    it('every data trait gives at least one goal, and every goal type is one pursueGoal handles', () => {
        const handled = ['expand', 'wealth', 'conquer', 'alliance', 'peace', 'colonize',
            'trade', 'faith', 'justice', 'domination', 'fear', 'survive'];
        for (const trait of Object.values(lordData.traits)) {
            const goals = NPCLords.generateGoals([trait]);
            expect(goals.length, trait.id).toBeGreaterThan(0);
            expect(goals.every(g => handled.includes(g.type)), trait.id).toBe(true);
            // Only a lord with no goal-bearing trait falls back to survive alone
            expect(trait.goals && trait.goals.length, trait.id).toBeGreaterThan(0);
        }
    });

    it('dedupes goals across traits, keeping the highest priority', () => {
        const goals = NPCLords.generateGoals([
            { id: 'x', goals: [['conquer', 'medium'], ['domination', 'medium']] },
            { id: 'y', goals: [['conquer', 'high']] },
        ]);
        expect(goals.filter(g => g.type === 'conquer')).toEqual([{ type: 'conquer', priority: 'high' }]);
        expect(goals).toHaveLength(2);
    });

    it('falls back to survive with no traits, and to the trait table for saved traits without goals', () => {
        expect(NPCLords.generateGoals([])).toEqual([{ type: 'survive', priority: 'high' }]);
        const goals = NPCLords.generateGoals([{ id: 'greedy', name: 'Greedy', tradeBonus: 0.4 }]);
        expect(goals.map(g => g.type)).toEqual(['wealth', 'trade']);
    });

    it('lords from older saves are given the new goals on their next day', () => {
        const { world, A } = makeWorld();
        A.lord = lord([{ type: 'survive', priority: 'high' }]);
        A.lord.traits = [{ id: 'cruel', name: 'Cruel' }];
        delete A.lord.goalsVersion;
        NPCLords.processLordActions(A, world);
        expect(A.lord.goals.map(g => g.type)).toEqual(['domination', 'fear']);
        expect(A.lord.goalsVersion).toBe(NPCLords.GOALS_VERSION);
    });
});

describe('goal effects', () => {
    it('trade: gold scaled by towns, routes and roads, and warmer relations with a trade partner', () => {
        const { world, tiles, A, B } = makeWorld();
        A.lord = lord([{ type: 'trade', priority: 'high' }]);
        const before = A.treasury;
        const plain = NPCLords.pursueTrade(A, world);
        expect(plain).toBe(4); // one town
        expect(A.treasury).toBe(before + 4);

        tiles['1,1'].settlement.economy = { tradeRoutes: [{ to: 'Bury' }, { to: 'Cove' }] };
        tiles['0,0'].hasRoad = true;
        tiles['2,0'].hasRoad = true;
        const relBefore = (A.relations.B || 0) + (A.relations.C || 0);
        const gold = NPCLords.pursueTrade(A, world);
        expect(gold).toBe(4 + 2 + 1); // town + two routes + two road tiles
        expect((A.relations.B || 0) + (A.relations.C || 0)).toBe(relBefore + 3);
        expect(B.relations.A === 3 || world.kingdoms[2].relations.A === 3).toBe(true);
    });

    it('faith: piety rises, a temple is funded, and temples keep paying piety and tithes', () => {
        const { world, A } = makeWorld();
        A.lord = lord([{ type: 'faith', priority: 'high' }]);
        A.religion = { piety: 40, unity: 50 };
        A.treasury = 5000;
        NPCLords.pursueFaith(A, world);
        expect(A.religion.piety).toBeGreaterThanOrEqual(42);

        const temple = KingdomAI.fundTemple(A, world);
        expect(temple.type).toBe('monastery_npc'); // one town: no cathedral yet
        expect(A.treasury).toBe(5000 - 600);
        expect(world.events.some(e => /raises a monastery/.test(e.text))).toBe(true);

        const fx = KingdomAI.templeEffects(A);
        expect(fx.piety).toBeGreaterThan(0);
        expect(fx.income).toBeGreaterThan(0);
        const piety = A.religion.piety;
        const gold = A.treasury;
        KingdomAI.updateInstitutions(A, world);
        expect(A.religion.piety).toBeGreaterThan(piety);
        expect(A.treasury).toBe(gold + fx.income);

        // Faith steadies the realm
        NPCLords.updateModifiers(A);
        expect(LordInfluence.mod(A, 'stability')).toBe(3);
    });

    it('a temple is never bought with more than a third of the treasury', () => {
        const { world, A } = makeWorld();
        A.religion = { piety: 40 };
        A.treasury = 500;
        expect(KingdomAI.fundTemple(A, world)).toBe(null);
        expect(A.treasury).toBe(500);
    });

    it('justice: steadier realm, longer truces, brigands hunted and fewer bands forming on its land', () => {
        const { world, A, B } = makeWorld();
        A.lord = lord([{ type: 'justice', priority: 'high' }]);
        NPCLords.updateModifiers(A);
        expect(LordInfluence.mod(A, 'stability')).toBe(5);
        expect(KingdomStability.target(A, world).parts.some(p => p.label === 'Lord\'s rule' && p.value === 5)).toBe(true);

        const onLand = { type: 'raider', q: 2, r: 0 };
        const abroad = { type: 'raider', q: 6, r: 0 };
        world.units.push(abroad, onLand);
        expect(NPCLords.pursueJustice(A, world)).toBe(onLand);
        expect(onLand.destroyed).toBe(true);
        expect(abroad.destroyed).toBeUndefined();

        let suppressed = 0;
        for (let i = 0; i < 400; i++) if (NPCLords.suppressesRaiders(world, 1, 0)) suppressed++;
        expect(suppressed).toBeGreaterThan(140);
        expect(suppressed).toBeLessThan(260);
        expect(NPCLords.suppressesRaiders(world, 5, 0)).toBe(false); // B has no such lord

        KingdomAI.startWar(A, B, world);
        KingdomAI.endWar(A, B, world);
        expect(A.truces.B - B.truces.A).toBe(45);
    });

    it('domination: a larger army, more war appetite, pressure and tribute from the weakest neighbour', () => {
        const { world, A, B, C } = makeWorld();
        A.lord = lord([{ type: 'domination', priority: 'high' }]);
        A.military = 1000;
        B.military = 300;
        C.military = 200;
        NPCLords.updateModifiers(A);
        expect(LordInfluence.mod(A, 'military')).toBeCloseTo(0.1);
        expect(LordInfluence.warAppetite(A)).toBeCloseTo(1.1);

        // The weakest is the one pressed
        const first = NPCLords.pursueDomination(A, world);
        expect(first.target).toBe(C);
        expect(C.relations.A).toBe(-NPCLords.GOAL_TUNING.domination.pressure);
        expect(B.relations.A || 0).toBe(0);

        let paid = 0;
        for (let i = 0; i < 40; i++) {
            const out = NPCLords.pursueDomination(A, world);
            if (out && out.tribute) paid += out.tribute;
        }
        expect(paid).toBeGreaterThan(0);
        expect(world.events.some(e => /cows Realm [BC] into paying/.test(e.text))).toBe(true);
        // Soured relations open the door to war through the normal war system
        expect(A.wars.length).toBeGreaterThan(0);
    });

    it('domination leaves allies and truce partners alone', () => {
        const { world, A, B, C } = makeWorld();
        A.military = 1000;
        B.military = 100;
        C.military = 100;
        A.allies = ['B'];
        A.truces = { C: world.day + 50 };
        expect(NPCLords.pursueDomination(A, world)).toBe(null);
    });

    it('fear: stability held by force, dissent crushed, and neighbours grow wary', () => {
        const { world, A, B, C } = makeWorld();
        A.lord = lord([{ type: 'fear', priority: 'high' }]);
        NPCLords.updateModifiers(A);
        expect(LordInfluence.mod(A, 'stability')).toBe(8);

        A.stability = 20;
        expect(NPCLords.pursueFear(A, world)).toBe(true);
        expect(A.stability).toBe(23);
        expect((B.relations.A || 0) + (C.relations.A || 0)).toBe(-2);
        A.stability = 70;
        expect(NPCLords.pursueFear(A, world)).toBe(false);
        expect(A.stability).toBe(70);
    });

    it('survive: banks gold in peace, defends better, keeps armies lean, and sues for peace when outmatched', () => {
        const { world, A, B } = makeWorld();
        A.lord = lord([{ type: 'survive', priority: 'high' }]);
        NPCLords.updateModifiers(A);
        expect(LordInfluence.mod(A, 'defense')).toBeCloseTo(0.1);
        expect(LordInfluence.mod(A, 'upkeep')).toBeCloseTo(-0.2);
        A.military = 1000;
        expect(KingdomAI.warUpkeep(A, world)).toBe(8); // 10 × 0.8

        const before = A.treasury;
        expect(NPCLords.pursueSurvival(A, world)).toBe(3);
        expect(A.treasury).toBe(before + 3);

        A.military = 100;
        B.military = 900;
        KingdomAI.startWar(A, B, world);
        let result = null;
        for (let i = 0; i < 30 && A.wars.length; i++) result = NPCLords.pursueSurvival(A, world);
        expect(result).toBe('peace');
        expect(A.wars).toEqual([]);
        expect(KingdomAI.hasTruce(A, B, world)).toBe(true);
    });

    it('survive does not sue a war it is winning while it is young', () => {
        const { world, A, B } = makeWorld();
        A.lord = lord([{ type: 'survive', priority: 'high' }]);
        A.military = 900;
        B.military = 100;
        KingdomAI.startWar(A, B, world);
        for (let i = 0; i < 30; i++) NPCLords.pursueSurvival(A, world);
        expect(A.wars).toEqual(['B']);
    });
});

describe('lord stats', () => {
    it('honor: truces kept longer, allies kept through rough patches, less war appetite', () => {
        const { world, A, B } = makeWorld();
        A.lord = lord([], { honor: 10 });
        B.lord = lord([], { honor: 1 });
        KingdomAI.startWar(A, B, world);
        KingdomAI.endWar(A, B, world);
        expect(A.truces.B).toBe(world.day + KingdomAI.WAR.truceDays + 45);
        expect(B.truces.A).toBe(world.day + KingdomAI.WAR.truceDays - 45);
        expect(LordInfluence.allianceFloor(A)).toBe(15);
        expect(LordInfluence.allianceFloor(B)).toBe(45);
        expect(LordInfluence.warAppetite(A)).toBeLessThan(LordInfluence.warAppetite(B));
    });

    it('ambition and intelligence: how often and how well goals are pursued', () => {
        const { A, B } = makeWorld();
        A.lord = lord([], { ambition: 10, intelligence: 10 });
        B.lord = lord([], { ambition: 1, intelligence: 1 });
        const goal = { type: 'trade', priority: 'high' };
        expect(LordInfluence.goalChance(A, goal)).toBeCloseTo(0.3 * 1.25 * 1.15);
        expect(LordInfluence.goalChance(B, goal)).toBeCloseTo(0.3 * 0.75 * 0.85);
        expect(LordInfluence.goalChance(A, { type: 'x', priority: 'low' })).toBeCloseTo(0.3 * 0.5 * 1.25 * 1.15);
        expect(LordInfluence.warAppetite(A)).toBeGreaterThan(1);
        expect(LordInfluence.diplomacyBonus(A)).toBeCloseTo(0.15);
        expect(LordInfluence.diplomacyBonus(B)).toBeCloseTo(-0.15);
    });

    it('an ambitious lord declares war on a slightly stronger rival a cautious one would not', () => {
        const setup = (ambition, honor) => {
            const { world, A, B, C } = makeWorld();
            C.isAlive = false;
            A.lord = lord([], { ambition, honor });
            A.relations.B = -60;
            A.military = 1000;
            B.military = 1250; // A (with population) is ~0.93 of B
            KingdomAI.considerWar(A, world);
            return A.wars.includes('B');
        };
        // Utils.random() < 0.1 "desperate" roll is avoided by seed: check both with the same seed
        Utils.setSeed(99);
        const bold = setup(10, 1);
        Utils.setSeed(99);
        const meek = setup(1, 10);
        expect(bold).toBe(true);
        expect(meek).toBe(false);
    });

    it('stewardship: ±10% on the realm\'s income', () => {
        const { world, A, B } = makeWorld();
        A.lord = lord([], { stewardship: 10 });
        B.lord = lord([], { stewardship: 1 });
        A.stability = 50;
        B.stability = 50;
        expect(KingdomAI.incomeMultiplier(A, world)).toBeCloseTo(1.1);
        expect(KingdomAI.incomeMultiplier(B, world)).toBeCloseTo(0.9);
    });
});

describe('colonize goal', () => {
    it('sends only the lord\'s own realm\'s pioneers', () => {
        const { world, A, B, C } = makeWorld();
        // Wilderness east of the realms for the pioneers to aim at
        for (const k of [A, B, C]) k.treasury = 5000;
        const getTile = world.getTile;
        world.width = 60;
        world.height = 40;
        world.getTile = (q, r) => getTile(q, r)
            || (r >= 0 && r < 40 && q >= 0 && q < 60 ? { q, r, terrain: { id: 'plains', passable: true } } : null);
        for (const k of [A, B, C]) k.capital = { q: k.capital.q, r: 20 };

        const settler = Colonization.launchKingdomPioneers(A, world);
        expect(settler).toBeTruthy();
        expect(settler.kingdomId).toBe('A');
        expect(world.units.every(u => u.kingdomId === 'A')).toBe(true);
        expect(A.colonization.pioneersActive).toBe(1);
        expect(B.colonization).toBeUndefined();
        expect(C.colonization).toBeUndefined();
        expect(B.treasury).toBe(5000);

        // Through the goal itself: other realms never move
        A.lord = lord([{ type: 'colonize', priority: 'high' }]);
        for (let i = 0; i < 60; i++) NPCLords.pursueGoal(A, A.lord, { type: 'colonize' }, world);
        expect(world.units.every(u => u.kingdomId === 'A')).toBe(true);
        expect(A.colonization.pioneersActive).toBe(2); // capped at two parties
        expect(B.treasury).toBe(5000);
        expect(C.treasury).toBe(5000);
    });

    it('a poor or weak realm sends no one', () => {
        const { world, A } = makeWorld();
        A.treasury = 100;
        expect(Colonization.launchKingdomPioneers(A, world)).toBe(null);
        expect(world.units).toEqual([]);
    });
});
