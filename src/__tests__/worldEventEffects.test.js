// World event effects, kingdom stability, and kingdom bonuses: every effect
// key in data/worldEvents.json has a reader, and the readers do something.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { WorldEvents } from '../world/worldEvents.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses, KingdomStability } from '../world/kingdomState.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Relationships } from '../systems/relationships.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(1234));

const T = () => WorldEvents.TEMPLATES;

function makeKingdom(id, name, extra = {}) {
    return {
        id, name, isAlive: true, traits: [], relations: {}, wars: [], allies: [], territory: [],
        military: 1000, population: 0, treasury: 1000, capital: null, ...extra,
    };
}

/** Two kingdoms, one settlement each, on a small plains map. */
function makeWorld() {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 14; q++) {
        for (let r = 0; r < 14; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    const k1 = makeKingdom('k1', 'Valemark', { capital: { q: 3, r: 3 } });
    const k2 = makeKingdom('k2', 'Ostfold', { capital: { q: 10, r: 10 } });
    const s1 = { name: 'Ashby', type: 'town', kingdom: 'k1', population: 2000, q: 3, r: 3 };
    const s2 = { name: 'Kell', type: 'town', kingdom: 'k2', population: 2000, q: 10, r: 10 };
    tiles.get('3,3').settlement = s1;
    tiles.get('3,3').kingdom = 'k1';
    tiles.get('10,10').settlement = s2;
    tiles.get('10,10').kingdom = 'k2';
    const kingdoms = [k1, k2];
    return {
        day: 1,
        width: 14,
        height: 14,
        kingdoms,
        units: [],
        events: [],
        activeEvents: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        // Like World.getAllSettlements: shallow copies
        getAllSettlements: () => [{ ...s1 }, { ...s2 }],
        k1, k2, s1, s2,
    };
}

describe('event effect keys', () => {
    it('every effect key in every template has a registered reader', () => {
        const unknown = [];
        for (const t of Object.values(T())) {
            for (const [key, val] of Object.entries(t.effects || {})) {
                if (!WorldEvents.EFFECT_KEYS[key]) unknown.push(`${t.id}.${key}`);
                if (typeof val !== 'number') unknown.push(`${t.id}.${key} (not a number)`);
            }
        }
        expect(unknown).toEqual([]);
    });

    it('the six formerly hollow events carry real effects', () => {
        for (const id of ['REBELLION', 'SUCCESSION_CRISIS', 'DIPLOMATIC_MARRIAGE', 'RELIGIOUS_SCHISM', 'COMET_SIGHTING', 'ECLIPSE']) {
            const keys = Object.keys(T()[id].effects);
            expect(keys.length).toBeGreaterThan(1);
            expect(WorldEvents.describeEffects(T()[id])).not.toBe('');
        }
    });

    it('describes effects for the hex panel', () => {
        expect(WorldEvents.describeEffects({ effects: { stability: -25, taxIncome: -0.3 } }))
            .toBe('Stability −25 · Tax income −30%');
    });
});

describe('kingdom stability', () => {
    it('drifts toward a target that a rebellion drags down, cutting income', () => {
        const world = makeWorld();
        for (let d = 0; d < 60; d++) KingdomStability.processDay(world.k1, world);
        const calm = world.k1.stability;
        expect(calm).toBeCloseTo(KingdomStability.BASE, 0);

        WorldEvents.startEvent(world, 'rebellion', { kingdomId: 'k1' });
        for (let d = 0; d < 30; d++) KingdomStability.processDay(world.k1, world);
        expect(world.k1.stability).toBeLessThan(calm - 20);
        expect(KingdomStability.incomeMultiplier(world.k1)).toBeLessThan(KingdomStability.incomeMultiplier({ stability: calm }));
        // The other kingdom is untouched
        KingdomStability.processDay(world.k2, world);
        expect(world.k2.stability).toBe(KingdomStability.BASE);
    });

    it('very low stability can spark a Peasant Rebellion in that kingdom', () => {
        const world = makeWorld();
        world.k1.stability = 5;
        const saved = KingdomStability.MAX_REBELLION_CHANCE;
        KingdomStability.MAX_REBELLION_CHANCE = 10;
        try {
            const ev = KingdomStability.processDay(world.k1, world);
            expect(ev && ev.id).toBe('rebellion');
            expect(ev.kingdomId).toBe('k1');
            expect(world.events.some(e => e.timedEvent === ev)).toBe(true);
            // No second rebellion while one runs
            expect(KingdomStability.processDay(world.k1, world)).toBeNull();
        } finally {
            KingdomStability.MAX_REBELLION_CHANCE = saved;
        }
    });

    it('ruler, lord and tradition stability bonuses raise the target', () => {
        const world = makeWorld();
        world.k1.characterBonuses = { stability: 0.15, loyalty: 0.2 };
        expect(KingdomStability.target(world.k1, world).value).toBeCloseTo(KingdomStability.BASE + 25, 5);
    });
});

describe('kingdom economy reads event effects', () => {
    it('taxIncome scales treasury income, and spending elsewhere persists (the old income, books off)', () => {
        // With the Crown's Purse the treasury moves by its budget (fiscal.test.js); this is the fallback
        const fiscal = DataLoader._gamedata.fiscal;
        DataLoader._gamedata.fiscal = { ...fiscal, enabled: false };
        try {
        const a = makeWorld();
        const b = makeWorld();
        KingdomAI.updateEconomy(a.k1, a);
        KingdomAI.updateEconomy(b.k1, b);
        WorldEvents.startEvent(b, 'rebellion', { kingdomId: 'k1' });
        a.k1.treasury -= 100; // a scandal, a colony ... must not be wiped next day
        const aBefore = a.k1.treasury;
        const bBefore = b.k1.treasury;
        for (let d = 0; d < 5; d++) {
            KingdomAI.updateEconomy(a.k1, a);
            KingdomAI.updateEconomy(b.k1, b);
        }
        const incomeA = a.k1.treasury - aBefore;
        const incomeB = b.k1.treasury - bBefore;
        expect(incomeA).toBeGreaterThan(0);
        expect(incomeB).toBeLessThan(incomeA * 0.8);
        expect(a.k1.treasury).toBeLessThan(a.k1.treasuryIncomeBase * 2); // ledger, not a reset
        } finally {
            DataLoader._gamedata.fiscal = fiscal;
        }
    });

    it('growth and food-strain events move the real settlement population', () => {
        const base = makeWorld();
        const boom = makeWorld();
        const famine = makeWorld();
        boom.activeEvents.push({ id: 'x', effects: { populationGrowth: 1.0 }, kingdomId: 'k1', daysLeft: 99 });
        famine.activeEvents.push({ id: 'y', effects: { foodConsumption: 5 }, kingdomId: 'k1', daysLeft: 99 });
        for (let d = 0; d < 20; d++) {
            for (const w of [base, boom, famine]) KingdomAI.updateEconomy(w.k1, w);
        }
        // The food model itself moves the base town only slightly
        expect(Math.abs(base.s1.population - 2000)).toBeLessThan(20);
        expect(boom.s1.population).toBeGreaterThan(base.s1.population);
        expect(famine.s1.population).toBeLessThan(base.s1.population);
    });

    it('buildingDamage strikes the live settlement and cuts its gold until repaired', () => {
        const world = makeWorld();
        const tmpl = { ...T().EARTHQUAKE };
        const ev = WorldEvents._startTimedEvent(world, tmpl, { kingdomId: 'k1' });
        expect(ev).not.toBeNull();
        expect(world.s1.damage).toBeCloseTo(0.25, 5);
        expect(world.s1.population).toBe(1900); // population -5% on the real tile

        const healthy = { name: 'H', type: 'town', population: 2000 };
        const damaged = { name: 'D', type: 'town', population: 2000 };
        const tile = world.getTile(3, 3);
        Economy.produceDaily(healthy, tile, world, {}, {});
        Economy.produceDaily(damaged, tile, world, {}, { damage: 0.5 });
        expect(damaged.economy.gold).toBeLessThan(healthy.economy.gold);

        KingdomAI.updateEconomy(world.k1, world);
        expect(world.s1.damage).toBeLessThan(0.25);
    });

    it('unitAttrition thins kingdom armies; morale shifts kingdom battle morale', () => {
        const world = makeWorld();
        world.k1.population = 20000;
        KingdomAI.updateMilitary(world.k1, world);
        const before = world.k1.military;
        world.activeEvents.push({ id: 'b', effects: { unitAttrition: 0.1, morale: 20 }, kingdomId: 'k1', daysLeft: 9 });
        KingdomAI.updateMilitary(world.k1, world);
        expect(world.k1.military).toBeLessThan(before);
        expect(KingdomAI._moraleBonus(world.k1, world) - KingdomAI._moraleBonus(world.k2, world)).toBeCloseTo(0.2, 5);
        expect(KingdomAI._moraleBonus(world.k2, world)).toBeCloseTo(KingdomStability.moraleBonus(world.k2), 5);
    });

    it('succession crises sour diplomacy for that kingdom', () => {
        const world = makeWorld();
        WorldEvents.startEvent(world, 'succession_crisis', { kingdomId: 'k1' });
        expect(WorldEvents.getModifier(world, 'diplomacy', { kingdom: 'k1' })).toBeCloseTo(-0.3, 5);
        expect(WorldEvents.getModifier(world, 'diplomacy', { kingdom: 'k2' })).toBe(0);
    });
});

describe('two-kingdom and faith events', () => {
    it('a Kingdom War declares war between two realms', () => {
        const world = makeWorld();
        const ev = WorldEvents.startEvent(world, 'kingdom_war', { kingdomId: 'k1' });
        expect(ev.partnerKingdomId).toBe('k2');
        expect(world.k1.wars).toContain('k2');
        expect(world.k2.wars).toContain('k1');
        expect(ev.text).toContain('Valemark');
        expect(ev.text).toContain('Ostfold');
        // War upkeep now drains the treasury
        expect(KingdomAI.warUpkeep(world.k1, world)).toBeGreaterThan(KingdomAI.warUpkeep(world.k2, makeWorld()));
    });

    it('the war ends in a truce when the Kingdom War event passes', () => {
        const world = makeWorld();
        const ev = WorldEvents.startEvent(world, 'kingdom_war', { kingdomId: 'k1' });
        ev.daysLeft = 1;
        const chance = WorldEvents.DAILY_EVENT_CHANCE;
        WorldEvents.DAILY_EVENT_CHANCE = 0;
        try {
            const { ended } = WorldEvents.processTimedEvents(world);
            expect(ended).toContain(ev);
        } finally {
            WorldEvents.DAILY_EVENT_CHANCE = chance;
        }
        expect(world.k1.wars).not.toContain('k2');
        expect(world.k1.relations.k2).toBe(-40);
    });

    it('no war is declared between friendly realms', () => {
        const world = makeWorld();
        world.k1.relations.k2 = 30;
        expect(WorldEvents.startEvent(world, 'kingdom_war', { kingdomId: 'k1' })).toBeNull();
    });

    it('a Royal Wedding warms relations day by day and reaches both realms', () => {
        const world = makeWorld();
        const ev = WorldEvents.startEvent(world, 'diplomatic_marriage', { kingdomId: 'k1' });
        const r0 = world.k1.relations.k2;
        expect(r0).toBe(15);
        KingdomAI.updateInstitutions(world.k1, world);
        expect(world.k1.relations.k2).toBe(r0 + ev.effects.relations);
        expect(world.k2.relations.k1).toBe(r0 + ev.effects.relations);
        expect(WorldEvents.getModifier(world, 'stability', { kingdom: 'k2' })).toBe(10);
    });

    it('comets and eclipses fill the temples; schisms breed heresy', () => {
        const world = makeWorld();
        world.k1.religion = { piety: 40, unity: 50, heresies: [], name: 'the Old Faith' };
        WorldEvents.startEvent(world, 'eclipse');
        KingdomAI.updateInstitutions(world.k1, world);
        expect(world.k1.religion.piety).toBeCloseTo(42, 5);

        const schism = WorldEvents.startEvent(world, 'religious_schism', { kingdomId: 'k1' });
        expect(schism.text).toContain('the Old Faith');
        expect(WorldEvents.getModifier(world, 'heresySpread', { kingdom: 'k1' })).toBeCloseTo(0.3, 5);
    });
});

describe('player-facing effects', () => {
    it('a blizzard halves travel and freezes armies camped in the open', () => {
        const world = makeWorld();
        world.activeEvents.push({ id: 'blizzard', effects: { ...T().BLIZZARD.effects }, kingdomId: null, daysLeft: 5 });
        const army = Array.from({ length: 50 }, () => ({ strength: 5 }));
        const player = { q: 6, r: 6, movementRemaining: 10, army: army.slice() };
        const out = WorldEvents.applyPlayerDailyEffects(world, player);
        expect(player.movementRemaining).toBe(5);
        expect(out.movementChange).toBe(-5);
        expect(out.unitsLost).toBeGreaterThanOrEqual(1);
        expect(player.army.length).toBe(50 - out.unitsLost);

        const sheltered = { q: 3, r: 3, movementRemaining: 10, army: army.slice() };
        expect(WorldEvents.applyPlayerDailyEffects(world, sheltered).unitsLost).toBe(0);
    });

    it('festivals lift and plagues sap the player\'s battle morale', () => {
        const world = makeWorld();
        world.activeEvents.push({ id: 'festival', effects: { morale: 20 }, kingdomId: 'k1', daysLeft: 3 });
        expect(WorldEvents.playerMoraleBonus(world, { q: 3, r: 3 })).toBeCloseTo(0.2, 5);
        expect(WorldEvents.playerMoraleBonus(world, { q: 10, r: 10 })).toBe(0);
    });

    it('rebellions cut the taxes the player collects', () => {
        const world = makeWorld();
        const player = { taxRate: 'moderate', gold: 0, settlements: [{ q: 3, r: 3 }] };
        const calm = Taxation.collectTaxes(player, world).collected;
        WorldEvents.startEvent(world, 'rebellion', { kingdomId: 'k1' });
        const unrest = Taxation.collectTaxes(player, world).collected;
        expect(calm).toBeGreaterThan(0);
        expect(unrest).toBeLessThan(calm);
    });
});

describe('kingdom bonuses', () => {
    it('combine ruler/advisor bonuses, NPC lord trait numbers and tradition bonuses', () => {
        const kingdom = makeKingdom('k', 'K', {
            characterBonuses: { warBonus: 0.1, construction: 0.05 },
            lord: { traits: [{ id: 'builder', constructionBonus: 0.4, warBonus: -0.1 }, { id: 'tyrant', taxBonus: 0.3 }] },
            cultureData: { tradition: { name: 'Mountain Tradition', bonuses: { mining: 15, defense: 10, craftsmanship: 10 } } },
        });
        expect(KingdomBonuses.get(kingdom, 'warBonus')).toBeCloseTo(0, 5);
        expect(KingdomBonuses.get(kingdom, 'construction')).toBeCloseTo(0.55, 5);
        expect(KingdomBonuses.get(kingdom, 'tax')).toBeCloseTo(0.3, 5);
        expect(KingdomBonuses.get(kingdom, 'defense')).toBeCloseTo(0.1, 5);
        expect(KingdomBonuses.get(kingdom, 'treasury')).toBeCloseTo(0.15, 5);
        expect(KingdomBonuses.describeTradition(kingdom.cultureData.tradition)[0]).toMatch(/^Mining \+15%/);
    });

    it('a tax-loving lord raises kingdom income', () => {
        const world = makeWorld();
        const plain = KingdomAI.incomeMultiplier(world.k1, world);
        world.k1.lord = { traits: [{ id: 'tyrant', taxBonus: 0.3 }] };
        expect(KingdomAI.incomeMultiplier(world.k1, world)).toBeCloseTo(plain * 1.3, 5);
    });

    it('karmaBonus decides how much a lord cares about karma; marriage makes kin', () => {
        const lord = { kingdomId: 'k1', traits: [{ id: 'pious', karmaBonus: 0.2 }] };
        expect(NPCLords.getLordOpinion(lord, { karma: 5, renown: 0, gold: 0 })).toBe(10);
        expect(NPCLords.getLordOpinion(lord, { karma: 0, renown: 0, gold: 0, spouse: 'n1', marriageAllianceKingdom: 'k1' }))
            .toBe(NPCLords.MARRIAGE_KIN_OPINION);
    });
});

describe('relationships data', () => {
    it('marriage effects and gift items come from relationships.json', () => {
        const data = DataLoader.relationships;
        expect(Relationships.getMarriageEffects().staminaBonus).toBe(data.marriageEffects.staminaBonus);
        expect(Relationships.getGiftItems().map(g => g.id)).toEqual(data.giftItems.map(g => g.id));
        const sword = data.giftItems.find(g => g.id === 'sword');
        expect(Relationships.giftValue(sword, { personality: 'bold' })).toBe(sword.affection * 1.5);
        expect(Relationships.giftValue(sword, { personality: 'gentle' })).toBe(sword.affection);
    });

    it('a gift court action resolves to the chosen gift item and its price', () => {
        const actions = Relationships._getCourtActions();
        const ring = DataLoader.relationships.giftItems.find(g => g.id === 'ring');
        const resolved = Relationships._resolveCourtAction(actions, 'gift:ring', { gold: 500 }, { personality: 'kind' });
        expect(resolved.cost).toBe(ring.cost);
        expect(resolved.gift.id).toBe('ring');
        expect(resolved.affectionGain.max).toBeGreaterThan(resolved.affectionGain.min);
    });
});
