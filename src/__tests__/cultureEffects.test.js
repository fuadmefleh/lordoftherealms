/**
 * Culture's advertised effects are real: cultural buildings speed research,
 * kingdom scholarship/influence and running cultural events change what a
 * realm does, kingdoms build their own cultural buildings, and building
 * income/levels match what the UI shows (with a paid upgrade path).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Culture } from '../systems/culture.js';
import { Technology } from '../systems/technology.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses, KingdomCulture, KingdomStability } from '../world/kingdomState.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** A small fake world: a grid of plain tiles, some settlements, the given kingdoms. */
function makeWorld(kingdoms = [], settlements = []) {
    const tiles = {};
    const key = (q, r) => `${q},${r}`;
    const world = {
        day: 1,
        kingdoms,
        events: [],
        activeEvents: [],
        history: [],
        getTile(q, r) {
            if (q < 0 || r < 0 || q > 20 || r > 20) return null;
            if (!tiles[key(q, r)]) tiles[key(q, r)] = { q, r, terrain: { id: 'plains', passable: true } };
            return tiles[key(q, r)];
        },
        getKingdom(id) { return kingdoms.find(k => k.id === id) || null; },
        getAllSettlements() {
            return settlements.map(s => ({ ...world.getTile(s.q, s.r).settlement, q: s.q, r: s.r }));
        },
    };
    for (const s of settlements) {
        world.getTile(s.q, s.r).settlement = { name: s.name || 'Town', kingdom: s.kingdom, population: s.population || 500, type: 'town' };
    }
    return world;
}

function makeKingdom(id, extra = {}) {
    return {
        id,
        name: `Kingdom ${id}`,
        isAlive: true,
        treasury: 0,
        relations: {},
        allies: [],
        wars: [],
        territory: [],
        cultureData: { tradition: null, influence: 0, scholarship: 0, culturalBuildings: [], events: [] },
        ...extra,
    };
}

function makePlayer() {
    const player = { gold: 10000, renown: 0, intelligence: 0, culturalBuildings: [], properties: [] };
    Technology.initPlayer(player);
    return player;
}

function placeBuilding(player, world, type, q, r) {
    const tile = world.getTile(q, r);
    tile.settlement = { name: 'Town', population: 2000 };
    const res = Culture.buildCulturalBuilding(player, type, tile, world);
    expect(res.success).toBe(true);
    return tile;
}

describe('1. cultural buildings speed research', () => {
    it('finished libraries, universities and scriptoria add to Technology.getResearchBonus', () => {
        const world = makeWorld();
        const player = makePlayer();
        const base = Technology.getResearchBonus(player, world);

        const lib = placeBuilding(player, world, 'library', 1, 1);
        // Under construction: no bonus yet
        expect(Technology.getResearchBonus(player, world)).toBeCloseTo(base);
        lib.culturalBuilding.underConstruction = false;
        expect(Technology.getResearchBonus(player, world)).toBeCloseTo(base + 0.15);

        const uni = placeBuilding(player, world, 'university', 2, 2);
        const scr = placeBuilding(player, world, 'scriptorium', 3, 3);
        uni.culturalBuilding.underConstruction = false;
        scr.culturalBuilding.underConstruction = false;
        // 0.15 + 0.30 + 0.10 = 0.55, capped at 0.5
        expect(Technology.getCulturalResearchBonus(player, world)).toBeCloseTo(0.5);
        expect(Culture.getResearchBonus(player, world)).toBeCloseTo(0.5);
        expect(Culture.processPlayerCulture(player, world).researchBonus).toBeCloseTo(0.5);
    });

    it('a higher-level building gives +50% research per level', () => {
        const world = makeWorld();
        const player = makePlayer();
        const lib = placeBuilding(player, world, 'library', 1, 1);
        lib.culturalBuilding.underConstruction = false;
        lib.culturalBuilding.level = 2;
        expect(Technology.getCulturalResearchBonus(player, world)).toBeCloseTo(0.225);
    });
});

describe('2. kingdom scholarship and influence have effects', () => {
    it('scholarship raises stewardship and construction, influence raises diplomacy', () => {
        const k = makeKingdom(1);
        expect(KingdomBonuses.get(k, 'stewardship')).toBeCloseTo(0);
        k.cultureData.scholarship = 100;
        k.cultureData.influence = 100;
        expect(KingdomBonuses.get(k, 'stewardship')).toBeCloseTo(0.10);
        expect(KingdomBonuses.get(k, 'construction')).toBeCloseTo(0.20);
        expect(KingdomBonuses.get(k, 'diplomacy')).toBeCloseTo(0.30);
    });

    it('scholarship raises kingdom income', () => {
        const world = makeWorld();
        const low = makeKingdom(1, { stability: 50 });
        const high = makeKingdom(2, { stability: 50 });
        high.cultureData.scholarship = 100;
        expect(KingdomAI.incomeMultiplier(high, world)).toBeGreaterThan(KingdomAI.incomeMultiplier(low, world));
        expect(KingdomAI.incomeMultiplier(high, world) / KingdomAI.incomeMultiplier(low, world)).toBeCloseTo(1.05);
    });

    it('learning and prestige move the stability target', () => {
        const world = makeWorld();
        const k = makeKingdom(1, { treasury: 100 });
        k.cultureData.scholarship = 40;
        k.cultureData.influence = 40;
        const neutral = KingdomStability.target(k, world).value;
        k.cultureData.scholarship = 100;
        k.cultureData.influence = 100;
        expect(KingdomStability.target(k, world).value).toBeCloseTo(neutral + 6);
        k.cultureData.scholarship = 0;
        k.cultureData.influence = 0;
        expect(KingdomStability.target(k, world).value).toBeCloseTo(neutral - 4);
    });

    it('envoys warm toward a far more influential realm', () => {
        const a = makeKingdom(1);
        const b = makeKingdom(2);
        a.cultureData.influence = 20;
        b.cultureData.influence = 80;
        expect(KingdomCulture.admiration(a, b)).toBe(3);
        expect(KingdomCulture.admiration(b, a)).toBe(0);

        const run = (targetInfluence) => {
            const x = makeKingdom(1);
            const y = makeKingdom(2);
            x.cultureData.influence = 20;
            y.cultureData.influence = targetInfluence;
            const world = makeWorld([x, y]);
            Utils.setSeed(42);
            KingdomAI.considerDiplomacy(x, world);
            return x.relations[2];
        };
        expect(run(80) - run(20)).toBe(3);
    });
});

describe('3. cultural events apply while they run', () => {
    const withEvent = (effect, value, extra = {}) => {
        const k = makeKingdom(1, extra);
        k.cultureData.events.push({ id: 'e', name: 'E', icon: '*', effect, value, daysLeft: 3 });
        return k;
    };

    it('every event in data/culture.json has an effect that is read', () => {
        expect(Culture.CULTURAL_EVENTS.length).toBe(13);
        for (const ev of Culture.CULTURAL_EVENTS) {
            expect(Culture.EVENT_EFFECTS[ev.effect]).toBeTruthy();
        }
    });

    it('morale events lift stability and battle morale', () => {
        const world = makeWorld();
        const plain = makeKingdom(1, { treasury: 100 });
        const fest = withEvent('morale', 15, { treasury: 100 });
        expect(KingdomStability.target(fest, world).value - KingdomStability.target(plain, world).value).toBeCloseTo(3);
        expect(KingdomAI._moraleBonus(fest, world) - KingdomAI._moraleBonus(plain, world)).toBeCloseTo(0.075);
    });

    it('scholarship, research, influence and faith events grow their stat daily', () => {
        const world = makeWorld();
        const fair = withEvent('scholarship', 10);
        KingdomAI.updateInstitutions(fair, world);
        expect(fair.cultureData.scholarship).toBeCloseTo(1);

        const symposium = withEvent('research', 15);
        KingdomAI.updateInstitutions(symposium, world);
        expect(symposium.cultureData.scholarship).toBeCloseTo(1.5);

        const expo = withEvent('influence', 10);
        KingdomAI.updateInstitutions(expo, world);
        expect(expo.cultureData.influence).toBeCloseTo(1);

        const walk = withEvent('faith', 10, { religion: { piety: 50 } });
        KingdomAI.updateInstitutions(walk, world);
        expect(walk.religion.piety).toBeCloseTo(51);
    });

    it('renown, industry and trade events feed kingdom bonuses', () => {
        expect(KingdomBonuses.get(withEvent('renown', 8), 'diplomacy')).toBeCloseTo(0.2);
        expect(KingdomBonuses.get(withEvent('industry', 12), 'construction')).toBeCloseTo(0.12);
        expect(KingdomBonuses.get(withEvent('industry', 12), 'treasury')).toBeCloseTo(0.06);
        expect(KingdomBonuses.get(withEvent('trade', 10), 'tradeBonus')).toBeCloseTo(0.10);
        expect(KingdomBonuses.get(withEvent('trade', 10), 'treasury')).toBeCloseTo(0.05);
    });

    it('expired events stop counting', () => {
        const k = withEvent('morale', 15);
        k.cultureData.events[0].daysLeft = 0;
        expect(KingdomCulture.eventValue(k, 'morale')).toBe(0);
    });
});

describe('4. kingdoms build cultural buildings', () => {
    it('a rich kingdom commissions one, pays for it, builds it, and it grows scholarship', () => {
        const k = makeKingdom(1, { treasury: 100000 });
        const world = makeWorld([k], [{ q: 2, r: 2, kingdom: 1, population: 2000 }]);
        Culture.KINGDOM_BUILDING.dailyChance = 1;
        let b;
        try {
            Utils.setSeed(7);
            b = Culture.considerKingdomBuilding(k, world);
        } finally {
            Culture.KINGDOM_BUILDING.dailyChance = 1 / 90;
        }
        expect(b).toBeTruthy();
        expect(k.cultureData.culturalBuildings).toHaveLength(1);
        const type = Object.values(Culture.BUILDING_TYPES).find(t => t.id === b.type);
        expect(k.treasury).toBe(100000 - type.cost);
        expect(b.underConstruction).toBe(type.constructionDays > 0);

        for (let i = 0; i < type.constructionDays; i++) Culture._tickKingdomBuildings(k, world);
        expect(b.underConstruction).toBe(false);
        const growth = Culture._tickKingdomBuildings(k, world);
        expect(growth.scholarship).toBeCloseTo(type.scholarshipBonus * 0.05);
        expect(growth.influence).toBeCloseTo(type.influencePerDay * 0.1);
    });

    it('a poor kingdom does not build, and a captured town hands its building over', () => {
        const poor = makeKingdom(1, { treasury: 100 });
        const rival = makeKingdom(2);
        const world = makeWorld([poor, rival], [{ q: 2, r: 2, kingdom: 1 }]);
        Culture.KINGDOM_BUILDING.dailyChance = 1;
        try {
            expect(Culture.considerKingdomBuilding(poor, world)).toBeNull();
        } finally {
            Culture.KINGDOM_BUILDING.dailyChance = 1 / 90;
        }

        poor.cultureData.culturalBuildings.push({ q: 2, r: 2, type: 'library', name: 'Library', icon: '📚', scholarshipBonus: 5, influencePerDay: 2, underConstruction: false });
        world.getTile(2, 2).settlement.kingdom = 2;
        Culture._tickKingdomBuildings(poor, world);
        expect(poor.cultureData.culturalBuildings).toHaveLength(0);
        expect(rival.cultureData.culturalBuildings).toHaveLength(1);
    });
});

describe('5. income display matches payout; buildings can be upgraded', () => {
    it('dailyIncome is incomeBonus × level × 0.1 and is what processPlayerCulture pays', () => {
        const world = makeWorld();
        const player = makePlayer();
        const tile = placeBuilding(player, world, 'library', 1, 1);
        const b = tile.culturalBuilding;
        b.underConstruction = false;
        expect(Culture.dailyIncome(b)).toBeCloseTo(1.5);

        const start = player.gold;
        for (let i = 0; i < 10; i++) Culture.processPlayerCulture(player, world);
        expect(player.gold - start).toBe(15);
    });

    it('upgrading costs gold, raises the level and multiplies income', () => {
        const world = makeWorld();
        const player = makePlayer();
        const tile = placeBuilding(player, world, 'library', 1, 1);
        const b = tile.culturalBuilding;
        expect(Culture.canUpgrade(player, tile).can).toBe(false); // under construction
        b.underConstruction = false;

        expect(Culture.getUpgradeCost(b)).toBe(300);
        const gold = player.gold;
        const res = Culture.upgradeCulturalBuilding(player, tile);
        expect(res.success).toBe(true);
        expect(b.level).toBe(2);
        expect(player.gold).toBe(gold - 300);
        expect(Culture.dailyIncome(b)).toBeCloseTo(3);
        expect(Culture.getInfluence(player, world)).toBe(4);

        expect(Culture.getUpgradeCost(b)).toBe(600);
        Culture.upgradeCulturalBuilding(player, tile);
        expect(b.level).toBe(3);
        expect(Culture.getUpgradeCost(b)).toBeNull();
        expect(Culture.upgradeCulturalBuilding(player, tile).success).toBe(false);
    });

    it('cannot upgrade without the gold', () => {
        const world = makeWorld();
        const player = makePlayer();
        const tile = placeBuilding(player, world, 'scriptorium', 4, 4);
        tile.culturalBuilding.underConstruction = false;
        player.gold = 10;
        const res = Culture.upgradeCulturalBuilding(player, tile);
        expect(res.success).toBe(false);
        expect(tile.culturalBuilding.level).toBe(1);
        expect(player.gold).toBe(10);
    });

    it('the upgrade action is offered on your own finished building', async () => {
        const { addWildernessActions } = await import('../player/actions/wildernessActions.js');
        const world = makeWorld();
        const player = makePlayer();
        const tile = placeBuilding(player, world, 'library', 1, 1);
        const actions = [];
        addWildernessActions(actions, player, tile, world);
        expect(actions.some(a => a.type === 'upgrade_cultural')).toBe(false);
        tile.culturalBuilding.underConstruction = false;
        const after = [];
        addWildernessActions(after, player, tile, world);
        expect(after.some(a => a.type === 'upgrade_cultural')).toBe(true);
    });
});
