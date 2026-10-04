// War Galleys are sea units: they never fight inland, blockade ports you
// raid or besiege, fight at full strength on the water and escort your ships.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Ships } from '../systems/ships.js';
import { Technology } from '../systems/technology.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

function makePlayer(extra = {}) {
    const p = {
        name: 'Hero', gold: 100000, health: 100, maxHealth: 100, q: 5, r: 5,
        army: [], properties: [], ships: [], karma: 0, renown: 0, reputation: {},
        skills: { combat: 0, leadership: 1, commerce: 0, diplomacy: 2 },
        ...extra,
    };
    Technology.initPlayer(p);
    return p;
}

const unit = (key) => PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES[key]);

/** A world where (5,5) holds a settlement; `coastal` puts water all around it. */
function makeWorld(coastal, settlement) {
    return {
        day: 100,
        width: 50,
        height: 50,
        events: [],
        getKingdom: () => null,
        getTile: (q, r) => (q === 5 && r === 5)
            ? { q, r, settlement, terrain: { id: 'plains', passable: true } }
            : { q, r, terrain: coastal ? { id: 'ocean', passable: false } : { id: 'plains', passable: true } },
    };
}

describe('War Galley data', () => {
    it('is a sea unit recruited only at ports', () => {
        const def = PlayerMilitary.UNIT_TYPES.WAR_GALLEY;
        expect(def.domain).toBe('sea');
        expect(def.requiresPort).toBe(true);
        const town = { type: 'town', population: 5000 };
        expect(PlayerMilitary.isUnitAvailable(def, town).available).toBe(false);
        expect(PlayerMilitary.isUnitAvailable(def, town, { isPort: false }).reason).toMatch(/port/);
        expect(PlayerMilitary.isUnitAvailable(def, town, { isPort: true }).available).toBe(true);
        // other units don't care about ports
        expect(PlayerMilitary.isUnitAvailable(PlayerMilitary.UNIT_TYPES.SOLDIER, town).available).toBe(true);
    });

    it('recruiting at a port carries the sea domain onto the unit', () => {
        const p = makePlayer();
        const town = { type: 'town', population: 5000 };
        expect(PlayerMilitary.recruitUnit(p, 'WAR_GALLEY', town).success).toBe(false);
        expect(PlayerMilitary.recruitUnit(p, 'WAR_GALLEY', town, { isPort: true }).success).toBe(true);
        expect(p.army[0].domain).toBe('sea');
        expect(PlayerMilitary.isNavalUnit(p.army[0])).toBe(true);
    });

    it('recruit screens explain what a galley does', () => {
        const text = PlayerMilitary.describeUnitTraits(PlayerMilitary.UNIT_TYPES.WAR_GALLEY);
        expect(text).toMatch(/never fights on land/);
        expect(text).toMatch(/escorts your ships/);
        expect(text).toMatch(/ports/);
    });
});

describe('galleys stay out of land battles', () => {
    it('add nothing to land army strength or formation', () => {
        const p = makePlayer({ army: [unit('SOLDIER')] });
        const before = PlayerMilitary.getArmyStrength(p);
        const compBefore = PlayerMilitary.getArmyComposition(p);
        p.army.push(unit('WAR_GALLEY'), unit('WAR_GALLEY'));
        expect(PlayerMilitary.getArmyStrength(p)).toBe(before);
        expect(PlayerMilitary.getArmyComposition(p)).toEqual(compBefore);
        expect(PlayerMilitary.getNavalStrength(p)).toBe(40);
        expect(PlayerMilitary.getTheatreStrength(p, 'land')).toBe(before);
    });

    it('a fleet of galleys alone cannot fight on land', () => {
        const p = makePlayer({ army: [unit('WAR_GALLEY')] });
        const result = PlayerMilitary.combat(p, 10, 'Bandits', {});
        expect(result.victory).toBe(false);
        expect(result.reason).toMatch(/galleys cannot fight on land/);
        expect(p.army).toHaveLength(1);
    });

    it('never die in a land battle, however badly it goes', () => {
        for (let seed = 1; seed <= 20; seed++) {
            Utils.setSeed(seed);
            const p = makePlayer({ army: [unit('WAR_GALLEY'), unit('MILITIA'), unit('MILITIA'), unit('WAR_GALLEY')] });
            PlayerMilitary.combat(p, 500, 'Bandits', {});
            expect(p.army.filter(u => u.type === 'war_galley')).toHaveLength(2);
            // and earn no experience there
            for (const g of p.army.filter(u => u.type === 'war_galley')) expect(g.experience).toBe(0);
        }
    });
});

describe('coastal warfare', () => {
    it('galleys blockade a port you raid', () => {
        const settlement = { name: 'Saltmere', type: 'village', population: 400, kingdom: null };
        const world = makeWorld(true, settlement);
        const tile = world.getTile(5, 5);
        expect(PlayerMilitary.settlementTheatre(world, tile)).toBe('coastal');

        const p = makePlayer({ army: [unit('SOLDIER'), unit('SOLDIER'), unit('WAR_GALLEY'), unit('WAR_GALLEY')] });
        const parts = PlayerMilitary.getTheatreStrengthBreakdown(p, 'coastal');
        expect(parts.naval).toBe(20); // 50% of 40
        expect(parts.total).toBe(PlayerMilitary.getArmyStrength(p) + 20);

        const result = PlayerMilitary.raidSettlement(p, settlement, tile, world);
        expect(result.theatre).toBe('coastal');
        expect(result.navalSupport).toBe(20);
    });

    it('galleys cannot reach an inland settlement', () => {
        const settlement = { name: 'Dryford', type: 'village', population: 400, kingdom: null };
        const world = makeWorld(false, settlement);
        const tile = world.getTile(5, 5);
        expect(PlayerMilitary.settlementTheatre(world, tile)).toBe('land');
        const p = makePlayer({ army: [unit('SOLDIER'), unit('SOLDIER'), unit('SOLDIER'), unit('WAR_GALLEY')] });
        const result = PlayerMilitary.raidSettlement(p, settlement, tile, world);
        expect(result.theatre).toBe('land');
        expect(result.navalSupport).toBe(0);
    });

    it('a port siege still needs a land army', () => {
        const settlement = { name: 'Saltmere', type: 'town', population: 2000, kingdom: null };
        const world = makeWorld(true, settlement);
        const p = makePlayer({ army: [unit('WAR_GALLEY'), unit('WAR_GALLEY'), unit('WAR_GALLEY'), unit('WAR_GALLEY'), unit('WAR_GALLEY')] });
        const result = PlayerMilitary.attackSettlement(p, settlement, world.getTile(5, 5), world);
        expect(result.success).toBe(false);
        expect(result.reason).toMatch(/land army/);
    });
});

describe('fighting at sea', () => {
    it('galleys fight at full strength on the water, soldiers at half, and your ship joins in', () => {
        const ship = { id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, customizations: [], cargo: {} };
        const p = makePlayer({ army: [unit('SOLDIER'), unit('WAR_GALLEY')], ships: [ship], boardedShip: 'ship_1' });
        const parts = PlayerMilitary.getTheatreStrengthBreakdown(p, 'sea');
        expect(parts.naval).toBe(20);
        expect(parts.land).toBe(Math.floor(PlayerMilitary.getArmyStrength(p) * 0.5));
        expect(parts.ship).toBeGreaterThan(0);
        expect(PlayerMilitary.tileTheatre({ terrain: { id: 'ocean' } })).toBe('sea');
        expect(PlayerMilitary.tileTheatre({ terrain: { id: 'plains' } }, p)).toBe('sea'); // aboard ship
    });

    it('a pirate attacked from your ship is fought at sea', () => {
        const ship = { id: 'ship_1', typeId: 'war_galley', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, customizations: [], cargo: {} };
        const p = makePlayer({ army: [unit('WAR_GALLEY')], ships: [ship], boardedShip: 'ship_1' });
        const world = { day: 1, events: [], getTile: (q, r) => ({ q, r, terrain: { id: 'ocean', passable: false } }), getKingdom: () => null };
        const pirate = { id: 'u1', type: 'pirate', name: 'Pirate Ship', strength: 10, q: 5, r: 5, inventory: {} };
        const result = PlayerMilitary.attackUnit(p, pirate, world);
        expect(result.noArmy).toBeUndefined();
        expect(result.theatre).toBe('sea');
        expect(result.navalSupport).toBe(20);
        expect(result.shipSupport).toBeGreaterThan(0);
    });

    it('galleys escort your ships in sea fights', () => {
        const ship = { id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, customizations: [], cargo: {} };
        const alone = makePlayer({ ships: [ship] });
        const escorted = makePlayer({ ships: [ship], army: [unit('WAR_GALLEY'), unit('WAR_GALLEY')] });
        expect(Ships.getEscortStrength(alone)).toBe(0);
        expect(Ships.getEscortStrength(escorted)).toBe(20); // 50% of 40
        expect(Ships._getShipCombatStrength(ship, escorted)).toBe(Ships._getShipCombatStrength(ship, alone) + 20);

        // ...which wins more pirate hunts
        const wins = (player) => {
            let n = 0;
            for (let seed = 1; seed <= 200; seed++) {
                Utils.setSeed(seed);
                const s = { ...ship, crew: 4, morale: 70 };
                const pl = { ...player, ships: [s], gold: 0 };
                if (Ships.huntPirates(pl, s.id, null).type === 'success') n++;
            }
            return n;
        };
        expect(wins(escorted)).toBeGreaterThan(wins(alone));
    });
});

describe('older saves', () => {
    it('a galley saved without its domain is still a sea unit and gets it back on load', () => {
        const old = { type: 'war_galley', name: 'War Galley', strength: 20, upkeep: 15, level: 1, experience: 0 };
        expect(Ships.isNavalUnit(old)).toBe(true);
        const p = makePlayer({ army: [old, { type: 'soldier', name: 'Soldier', strength: 10, upkeep: 5, level: 1 }] });
        Ships.restoreFromSave(p);
        expect(p.army[0].domain).toBe('sea');
        expect(p.army[1].domain).toBeUndefined();
    });
});
