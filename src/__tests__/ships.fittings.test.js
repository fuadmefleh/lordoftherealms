// Ship fittings do what the shipyard says: armor soaks hull damage, boarding
// planks take prizes, lookouts and charts pay off at sea, deep-sea nets help
// fishing, and a luxury cabin brings renown and charisma.

import { describe, it, expect, beforeAll } from 'vitest';
import { Ships } from '../systems/ships.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const ship = (typeId, customizations = [], extra = {}) => ({
    id: 's1', typeId, name: 'Test', q: 5, r: 5, status: 'docked', condition: 100, customizations, cargo: {}, ...extra,
});
const player = (extra = {}) => ({ gold: 0, renown: 0, karma: 0, charisma: 5, health: 100, reputation: {}, ships: [], ...extra });

describe('armor', () => {
    it('reinforced hull soaks hull damage; an unarmored rowboat takes it all', () => {
        expect(Ships.mitigateHullDamage(ship('rowboat'), 10)).toBe(10);
        const plain = Ships.mitigateHullDamage(ship('sloop'), 10);
        const reinforced = Ships.mitigateHullDamage(ship('sloop', ['reinforced_hull']), 10);
        expect(plain).toBeLessThan(10);
        expect(reinforced).toBeLessThan(plain);
        expect(Ships.mitigateHullDamage(ship('galleon', ['reinforced_hull']), 1)).toBe(1);
    });

    it('a reinforced hull rides out a storm at sea with less damage', () => {
        const world = { weather: { getWeather: () => ({ type: 'storm' }) }, getTile: () => null };
        const damageOver30Days = (fittings) => {
            const s = ship('sloop', fittings, { status: 'anchored' });
            const p = player({ gold: 10000, ships: [s] });
            Utils.setSeed(11);
            let total = 0;
            for (let d = 0; d < 30; d++) {
                const out = Ships.processDaily(p, world);
                for (const rep of out.stormReports) total += rep.damage;
                s.condition = 100;
            }
            return total;
        };
        expect(damageOver30Days(['reinforced_hull'])).toBeLessThan(damageOver30Days([]));
    });
});

describe('boarding planks', () => {
    it('sometimes seize the beaten pirate as a prize', () => {
        let prizes = 0;
        for (let seed = 1; seed <= 300; seed++) {
            const s = ship('war_galley', ['boarding_planks']);
            const p = player({ ships: [s] });
            Utils.setSeed(seed);
            const res = Ships.huntPirates(p, s.id, null);
            if (res.prize) prizes++;
        }
        expect(prizes).toBeGreaterThan(0);
    });

    it('without planks there are never prizes', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const s = ship('war_galley');
            const p = player({ ships: [s] });
            Utils.setSeed(seed);
            expect(Ships.huntPirates(p, s.id, null).prize || 0).toBe(0);
        }
    });
});

describe('exploration fittings', () => {
    it("navigator's quarters and a crow's nest raise sea reward gold", () => {
        const p = player();
        const bare = ship('galleon');
        const fitted = ship('galleon', ['navigator_quarters', 'crows_nest']);
        expect(Ships.getExplorationMultiplier(p, fitted)).toBeCloseTo(Ships.getExplorationMultiplier(p, bare) + 0.5);
        const a = player();
        const b = player();
        Ships._applyReward(a, { gold: 100 }, bare);
        Ships._applyReward(b, { gold: 100 }, fitted);
        expect(b.gold).toBeGreaterThan(a.gold);
    });

    it("a crow's nest (stealth -1) makes piracy cost more reputation", () => {
        const loss = (fittings) => {
            for (let seed = 1; seed < 300; seed++) {
                const s = ship('galleon', fittings);
                const p = player({ ships: [s], reputation: { k1: 0 } });
                Utils.setSeed(seed);
                const res = Ships.commitPiracy(p, s.id, null);
                if (res.icon === '🏴‍☠️') return -p.reputation.k1;
            }
            return null;
        };
        expect(loss([])).toBe(3);
        expect(loss(['crows_nest'])).toBe(4);
    });
});

describe('deep-sea nets', () => {
    it('give extra fishing casts when the ship is moored alongside', () => {
        const s = ship('fishing_vessel', ['fishing_nets']);
        const p = player({ ships: [s] });
        expect(Ships.getFishingBonus(p, 5, 6)).toBe(2);
        expect(Ships.getFishingBonus(p, 9, 9)).toBe(0);
        s.status = 'moving';
        expect(Ships.getFishingBonus(p, 5, 6)).toBe(0);
    });
});

describe('luxury cabin', () => {
    it('grants renown once and charisma while the ship is owned', () => {
        const s = ship('galleon');
        const p = player({ gold: 5000, ships: [s] });
        const res = Ships.upgradeShip(p, s.id, ['luxury_cabin']);
        expect(res.success).toBe(true);
        expect(p.renown).toBe(5);
        expect(p.charisma).toBe(6);
        Ships.sellShip(p, s.id);
        expect(p.charisma).toBe(5);
        expect(p.renown).toBe(5);
    });
});
