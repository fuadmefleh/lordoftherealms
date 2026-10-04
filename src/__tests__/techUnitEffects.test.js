// Tech effects, recruited-unit special stats and espionage numbers that used
// to be written into data but never read: naval capacity/range, fishing,
// plague resistance, surgery, diplomacy mastery, plate armour, crossbows,
// siege engines, shield walls, longbowmen, scouts, assassins, battle mages,
// sabotage and counter-espionage.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Technology } from '../systems/technology.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Ships } from '../systems/ships.js';
import { RealmWars } from '../systems/realmWars.js';
import { Espionage } from '../systems/espionage.js';
import { Schemes } from '../systems/schemes.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(1234));

function makePlayer(techs = [], extra = {}) {
    const p = {
        name: 'Hero', gold: 100000, health: 100, maxHealth: 100, q: 5, r: 5,
        army: [], properties: [], ships: [], karma: 0, renown: 0, reputation: {},
        skills: { combat: 0, leadership: 1, commerce: 0, diplomacy: 2 },
        ...extra,
    };
    Technology.initPlayer(p);
    p.technology.implemented = techs;
    return p;
}

const unitOf = (key) => PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES[key]);
const EVEN = { cavalry: 1 / 3, archer: 1 / 3, pikeman: 1 / 3 };

describe('Recruited units keep their special stats', () => {
    it('recruiting copies siegeBonus, defenseBonus, rangeBonus, scout stats and abilities', () => {
        const p = makePlayer();
        const capital = { type: 'capital', population: 10000 };
        for (const key of ['SIEGE_ENGINE', 'SHIELD_WALL', 'LONGBOWMAN', 'SCOUT', 'ASSASSIN', 'BATTLE_MAGE']) {
            expect(PlayerMilitary.recruitUnit(p, key, capital).success).toBe(true);
        }
        const [siege, shield, bow, scout, assassin, mage] = p.army;
        expect(siege.siegeBonus).toBe(40);
        expect(shield.defenseBonus).toBe(25);
        expect(bow.rangeBonus).toBe(2);
        expect(scout.speed).toBe(8);
        expect(scout.sightRange).toBe(4);
        expect(assassin.specialAbility).toMatch(/commanders/);
        expect(assassin.commanderKillChance).toBeGreaterThan(0);
        expect(mage.spellPower).toBeGreaterThan(0);
    });

    it('units from old saves fall back to their type definition', () => {
        const old = { type: 'siege_engine', name: 'Siege Engine', strength: 5, upkeep: 20, level: 1 };
        expect(PlayerMilitary.unitTrait(old, 'siegeBonus')).toBe(40);
        expect(PlayerMilitary.getUnitDef('heavy_cavalry')).toBeTruthy();
    });

    it('recruit screens describe each special', () => {
        expect(PlayerMilitary.describeUnitTraits(PlayerMilitary.UNIT_TYPES.SIEGE_ENGINE)).toMatch(/Siege/);
        expect(PlayerMilitary.describeUnitTraits(PlayerMilitary.UNIT_TYPES.SCOUT)).toMatch(/Vision \+1/);
        expect(PlayerMilitary.describeUnitTraits(PlayerMilitary.UNIT_TYPES.MILITIA)).toBe('');
    });
});

describe('Unit specials in battle', () => {
    it('siege engines add power only when attacking a settlement', () => {
        const p = makePlayer([], { army: [unitOf('SIEGE_ENGINE'), unitOf('SOLDIER')] });
        expect(PlayerMilitary.getBattleSpecials(p, { siege: true }, EVEN, EVEN).playerMult).toBeCloseTo(1.4);
        expect(PlayerMilitary.getBattleSpecials(p, {}, EVEN, EVEN).playerMult).toBe(1);
    });

    it('shield walls add power only when defending', () => {
        const p = makePlayer([], { army: [unitOf('SHIELD_WALL'), unitOf('SHIELD_WALL')] });
        expect(PlayerMilitary.getBattleSpecials(p, { defending: true }, EVEN, EVEN).playerMult).toBeCloseTo(1.2);
        expect(PlayerMilitary.getBattleSpecials(p, {}, EVEN, EVEN).playerMult).toBe(1);
    });

    it('longbow volleys hit melee-heavy foes harder', () => {
        const p = makePlayer([], { army: [unitOf('LONGBOWMAN')] });
        const vsMelee = PlayerMilitary.getBattleSpecials(p, {}, EVEN, { cavalry: 0.5, archer: 0, pikeman: 0.5 });
        const vsArchers = PlayerMilitary.getBattleSpecials(p, {}, EVEN, { cavalry: 0, archer: 1, pikeman: 0 });
        expect(vsMelee.playerMult).toBeCloseTo(1.06);
        expect(vsArchers.playerMult).toBe(1);
    });

    it('crossbow piercing scales with the ranged share; plate armour blunts the enemy', () => {
        const xbow = makePlayer(['crossbow']);
        expect(PlayerMilitary.getBattleSpecials(xbow, {}, { cavalry: 0, archer: 1, pikeman: 0 }, EVEN).playerMult).toBeCloseTo(1.25);
        const plate = makePlayer(['plate_armor']);
        const sp = PlayerMilitary.getBattleSpecials(plate, {}, EVEN, EVEN);
        expect(sp.enemyMult).toBeCloseTo(0.85);
        expect(sp.casualtyMult).toBeCloseTo(0.85);
    });

    it('battle mages weaken the enemy host', () => {
        const p = makePlayer([], { army: [unitOf('BATTLE_MAGE'), unitOf('BATTLE_MAGE')] });
        expect(PlayerMilitary.getBattleSpecials(p, {}, EVEN, EVEN).enemyMult).toBeCloseTo(0.9);
    });

    it('assassins sometimes slay the enemy commander, breaking their morale', () => {
        let slain = 0;
        let brokeOnSlain = true;
        for (let i = 0; i < 40; i++) {
            const army = [unitOf('ASSASSIN'), unitOf('ASSASSIN'), unitOf('ASSASSIN'), unitOf('ASSASSIN'), unitOf('KNIGHT')];
            const p = makePlayer([], { army });
            const res = PlayerMilitary.combat(p, 20, 'Bandits');
            if (res.commanderSlain) {
                slain++;
                if (res.tactics.moraleBreak !== 'enemy') brokeOnSlain = false;
            }
        }
        expect(slain).toBeGreaterThan(5);
        expect(slain).toBeLessThan(40);
        expect(brokeOnSlain).toBe(true);
    });

    it('armies without specials draw no extra randomness (determinism preserved)', () => {
        const run = () => {
            Utils.setSeed(77);
            const p = makePlayer([], { army: [unitOf('SOLDIER'), unitOf('KNIGHT')] });
            const res = PlayerMilitary.combat(p, 25, 'Bandits');
            return [res.victory, res.casualties, res.loot, Utils.random()];
        };
        expect(run()).toEqual(run());
    });
});

describe('Surgery saves the wounded', () => {
    it('some would-be casualties survive wounded at half strength, then heal', () => {
        let wounded = 0;
        let p;
        for (let i = 0; i < 20 && wounded === 0; i++) {
            const army = Array.from({ length: 10 }, () => unitOf('SOLDIER'));
            p = makePlayer(['surgery'], { army });
            wounded = PlayerMilitary.combat(p, 400, 'Bandits').wounded;
        }
        expect(wounded).toBeGreaterThan(0);
        const hurt = p.army.filter(u => u.woundedDays > 0);
        expect(hurt).toHaveLength(wounded);

        const healthy = makePlayer([], { army: [unitOf('SOLDIER')] });
        const injured = makePlayer([], { army: [{ ...unitOf('SOLDIER'), woundedDays: 1 }] });
        expect(PlayerMilitary.getArmyStrength(injured)).toBe(Math.floor(PlayerMilitary.getArmyStrength(healthy) / 2));
        expect(PlayerMilitary.tickWounded(injured)).toBe(1);
        expect(injured.army[0].woundedDays).toBeUndefined();
    });

    it('without Surgery nobody is carried off wounded', () => {
        const army = Array.from({ length: 10 }, () => unitOf('SOLDIER'));
        const p = makePlayer([], { army });
        expect(PlayerMilitary.combat(p, 400, 'Bandits').wounded).toBe(0);
    });
});

describe('Scouts', () => {
    it('extend vision and daily movement', () => {
        const p = makePlayer([], { army: [unitOf('SCOUT')] });
        expect(PlayerMilitary.getScoutVisionBonus(p)).toBe(1);
        expect(PlayerMilitary.getScoutMovementBonus(p)).toBe(1);
        const none = makePlayer([], { army: [unitOf('SOLDIER')] });
        expect(PlayerMilitary.getScoutVisionBonus(none)).toBe(0);
        expect(PlayerMilitary.getScoutMovementBonus(none)).toBe(0);
    });
});

describe('Naval techs', () => {
    it('Shipbuilding raises the fleet limit', () => {
        const fill = (p, n) => { for (let i = 0; i < n; i++) p.ships.push({ id: `s${i}`, typeId: 'x', status: 'docked' }); };
        const p = makePlayer();
        fill(p, Technology.BASE_FLEET_CAPACITY);
        expect(Ships.fleetLimitReason(p)).toMatch(/limit/);
        const tile = { q: 5, r: 5, settlement: { name: 'Port', type: 'town' } };
        const world = { day: 1, getTile: () => tile };
        const type = Ships._getShipTypes()[0];
        expect(Ships.commissionShip(p, 5, 5, type.id, 'Too Many', [], world).success).toBe(false);

        const shipwright = makePlayer(['shipbuilding']);
        fill(shipwright, Technology.BASE_FLEET_CAPACITY);
        expect(Ships.getFleetCapacity(shipwright)).toBe(Technology.BASE_FLEET_CAPACITY + 3);
        expect(Ships.commissionShip(shipwright, 5, 5, type.id, 'One More', [], world).success).toBe(true);
    });

    it('Navigation makes ships sail faster', () => {
        const ship = { typeId: Ships._getShipTypes()[0].id, customizations: [] };
        const base = Ships.getSailingSpeed(makePlayer(), ship);
        const nav = Ships.getSailingSpeed(makePlayer(['navigation']), ship);
        expect(nav).toBe(Math.max(1, Math.round(base * 1.3)));
        expect(Technology.getSailingSpeedMultiplier(makePlayer(['navigation']))).toBeCloseTo(1.3);
    });

    it('Deep Sea Fishing boosts fishing wharves and fleets', () => {
        const p = makePlayer(['deep_sea_fishing']);
        expect(Technology.getProductionBonus(p, 'fishing_wharf')).toBeCloseTo(0.4);
        expect(Technology.getProductionBonus(p, 'fishing_fleet')).toBeCloseTo(0.4);
        expect(Technology.getProductionBonus(makePlayer(), 'fishing_fleet')).toBe(0);
    });
});

describe('Plague resistance', () => {
    function plagueWorld() {
        const tile = { q: 5, r: 5, kingdom: 'k1', terrain: { id: 'plains' } };
        return {
            events: [],
            activeEvents: [{ id: 'plague', kingdomId: 'k1', regionName: 'Varr', effects: { population: -0.15 } }],
            getTile: (q, r) => (q === 5 && r === 5 ? tile : null),
        };
    }

    it('a plague over your tile sickens you less with medicine techs', () => {
        const exposed = makePlayer();
        const out = Technology.applyPlagueExposure(exposed, plagueWorld());
        expect(out.healthLost).toBe(Technology.PLAGUE_EXPOSURE.healthLoss);

        const physician = makePlayer(['herbalism', 'plague_prevention']);
        expect(Technology.getPlagueResistance(physician)).toBeCloseTo(0.55);
        const out2 = Technology.applyPlagueExposure(physician, plagueWorld());
        expect(out2.healthLost).toBeLessThan(out.healthLost);
    });

    it('plague kills fewer soldiers with resistance', () => {
        const losses = (techs) => {
            Utils.setSeed(9);
            let lost = 0;
            for (let i = 0; i < 20; i++) {
                const p = makePlayer(techs, { army: Array.from({ length: 20 }, () => unitOf('SOLDIER')) });
                lost += Technology.applyPlagueExposure(p, plagueWorld()).unitsLost;
            }
            return lost;
        };
        expect(losses(['herbalism', 'plague_prevention'])).toBeLessThan(losses([]));
    });

    it('no plague, no harm', () => {
        const p = makePlayer();
        expect(Technology.applyPlagueExposure(p, { activeEvents: [], getTile: () => null })).toBeNull();
    });
});

describe('Diplomacy Mastery', () => {
    it('raises effective diplomacy by 30%', () => {
        expect(PlayerEffects.effectiveDiplomacy(makePlayer())).toBe(2);
        expect(PlayerEffects.effectiveDiplomacy(makePlayer(['diplomacy_mastery']))).toBeCloseTo(2.6);
    });

    it('cuts tribute and peace prices by 20%', () => {
        const kingdom = { id: 'k1', military: 1000 };
        const plain = makePlayer();
        const envoy = makePlayer(['diplomacy_mastery']);
        expect(RealmWars.tribute(kingdom, envoy)).toBe(Math.round(RealmWars.tribute(kingdom) * 0.8));
        expect(RealmWars.peacePrice(envoy, kingdom)).toBe(Math.round(RealmWars.peacePrice(plain, kingdom) * 0.8));
    });
});

describe('Espionage numbers', () => {
    it('sabotage cuts the kingdom settlements output for a while', () => {
        const p = makePlayer();
        Espionage.initPlayer(p);
        const settlement = { kingdom: 'k1', economy: { gold: 1000, goods: 500, production: { gold: 100, goods: 40 } } };
        const kingdom = { id: 'k1', name: 'Varr', treasury: 1000 };
        const world = { day: 1, getAllSettlements: () => [settlement], getKingdom: () => kingdom };
        const spy = { name: 'Vex' };
        Espionage._resolveSabotage(p, spy, kingdom, true, false, 'success', world, { rewards: {} });
        expect(p.espionage.sabotaged).toHaveLength(1);
        expect(p.espionage.sabotaged[0].penalty).toBeCloseTo(0.15);

        Espionage._applySabotageDailyEffect(p.espionage.sabotaged[0], world);
        expect(settlement.economy.gold).toBe(1000 - 15);
        expect(settlement.economy.goods).toBe(500 - 6);
    });

    it('counter-espionage uses detectionBonus, doubled within counterRadius of the station', () => {
        const p = makePlayer();
        Espionage.initPlayer(p);
        const near = { target: { q: 6, r: 5 } };
        const far = { target: { q: 30, r: 30 } };
        const base = Schemes.revealChance(p, near);
        p.espionage.activeMissions.push({ type: 'counter_espionage', stationQ: 5, stationR: 5 });
        const { detectionBonus, counterRadius } = Schemes.counterEspionageEffects();
        expect(detectionBonus).toBeCloseTo(0.30);
        expect(counterRadius).toBe(3);
        expect(Schemes.revealChance(p, far)).toBeCloseTo(base + detectionBonus);
        expect(Schemes.revealChance(p, near)).toBeCloseTo(base + 2 * detectionBonus);
        expect(Schemes.isCovered(p, near)).toBe(true);
        expect(Schemes.isCovered(p, far)).toBe(false);
    });
});
