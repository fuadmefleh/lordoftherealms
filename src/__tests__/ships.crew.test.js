// Ship crews: hired at ports, paid daily; a short-handed ship sails slower,
// fights worse and nets fewer fish; storms and battles cost morale and men;
// unpaid or miserable crews desert. Crews survive save/load, and ships from
// older saves are backfilled with a full crew.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Ships } from '../systems/ships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(77));

const ship = (typeId, extra = {}) => ({
    id: 'ship_1', typeId, name: 'Gull', q: 5, r: 5, status: 'docked', condition: 100, customizations: [], cargo: {}, ...extra,
});
const player = (extra = {}) => ({
    gold: 10000, renown: 0, karma: 0, charisma: 5, health: 100, reputation: {}, ships: [], army: [], q: 5, r: 5, ...extra,
});

/** (5,5) is a settlement; `coastal` surrounds it with sea. */
const world = (coastal = true) => ({
    day: 1,
    width: 50,
    getTile: (q, r) => (q === 5 && r === 5)
        ? { q, r, settlement: { name: 'Saltmere', type: 'capital' }, terrain: { id: 'plains', passable: true } }
        : { q, r, terrain: coastal ? { id: 'ocean', passable: false } : { id: 'plains', passable: true } },
});

describe('new ships need a crew', () => {
    it('a commissioned ship starts empty and cannot sail until crewed', () => {
        const p = player();
        const w = world();
        expect(Ships.commissionShip(p, 5, 5, 'sloop', 'Gull', [], w).success).toBe(true);
        const s = p.ships[0];
        expect(s.crew).toBe(0);
        s.status = 'docked';
        expect(Ships.crewSailReason(s)).toMatch(/needs at least 1 sailors/);
        expect(Ships.boardShip(p, s.id).success).toBe(false);
        expect(Ships.moveShip(p, s.id, 9, 9, 'Elsewhere', w).success).toBe(false);
        expect(Ships.sailPlayerTo(p, s.id, 9, 9, 'Elsewhere', w).success).toBe(false);
    });

    it('sailors are hired at a port, for gold', () => {
        const s = ship('sloop', { crew: 0, morale: 70 });
        const p = player({ ships: [s], gold: 1000 });
        const res = Ships.hireCrew(p, world(), s.id);
        expect(res.success).toBe(true);
        expect(s.crew).toBe(4);
        expect(p.gold).toBe(1000 - Ships.getHireCost(4));
        expect(Ships.hireCrew(p, world(), s.id).success).toBe(false); // already full
        expect(Ships.boardShip(p, s.id).success).toBe(true);
        expect(p.boardedShip).toBe(s.id);
    });

    it('no hiring on open coast, and only what you can afford', () => {
        const s = ship('war_galley', { crew: 0, morale: 70 });
        expect(Ships.hireCrew(player({ ships: [s] }), world(false), s.id).message).toMatch(/ports/);
        const poor = player({ ships: [s], gold: Ships.getHireCost(3) + 5 });
        const res = Ships.hireCrew(poor, world(), s.id);
        expect(res.hired).toBe(3);
        expect(s.crew).toBe(3);
    });

    it('dismissing crew lowers wages', () => {
        const s = ship('sloop', { crew: 4, morale: 70 });
        const p = player({ ships: [s] });
        const before = Ships.getDailyWages(s);
        expect(Ships.dismissCrew(p, s.id, 2).success).toBe(true);
        expect(Ships.getDailyWages(s)).toBeLessThan(before);
    });
});

describe('an undercrewed ship', () => {
    it('sails slower', () => {
        const full = ship('caravel', { crew: 10, morale: 70 });
        const half = ship('caravel', { crew: 5, morale: 70 });
        expect(Ships.getSailingSpeed(null, half)).toBeLessThan(Ships.getSailingSpeed(null, full));
        expect(Ships.getSailHexCost(full)).toBe(2);
        expect(Ships.getSailHexCost(ship('caravel', { crew: 0 }))).toBe(4);
    });

    it('fights worse', () => {
        const full = ship('war_galley', { crew: 20, morale: 70 });
        const short = ship('war_galley', { crew: 6, morale: 70 });
        expect(Ships._getShipCombatStrength(short)).toBeLessThan(Ships._getShipCombatStrength(full));
        // and so does a demoralised crew
        const glum = ship('war_galley', { crew: 20, morale: 10 });
        expect(Ships._getShipCombatStrength(glum)).toBeLessThan(Ships._getShipCombatStrength(full));
    });

    it('catches fewer fish with its nets', () => {
        const p = (crew) => player({ ships: [ship('fishing_vessel', { customizations: ['fishing_nets'], crew, morale: 70 })] });
        expect(Ships.getFishingBonus(p(2), 5, 5)).toBe(2);
        expect(Ships.getFishingBonus(p(1), 5, 5)).toBe(1);
        expect(Ships.getFishingBonus(p(0), 5, 5)).toBe(0);
    });
});

describe('wages and morale', () => {
    it('crews are paid daily', () => {
        const s = ship('sloop', { crew: 4, morale: 70 });
        const p = player({ ships: [s], gold: 1000, financeToday: { income: {}, expenses: {} } });
        const out = Ships.processDaily(p, null);
        expect(out.crew.paid).toBe(true);
        expect(out.crew.wages).toBe(4);
        expect(p.financeToday.expenses.crewWages).toBe(4);
        expect(p.gold).toBe(1000 - 4 - Ships.getShipType('sloop').dailyUpkeep);
    });

    it('unpaid crews lose heart and finally desert', () => {
        const s = ship('war_galley', { crew: 20, morale: 70 });
        const p = player({ ships: [s], gold: 0 });
        const first = Ships.processDaily(p, null);
        expect(first.crew.paid).toBe(false);
        expect(s.morale).toBe(55);
        let deserted = 0;
        for (let d = 0; d < 6; d++) {
            for (const x of Ships.processDaily(p, null).crew.deserted) deserted += x.count;
        }
        expect(deserted).toBeGreaterThan(0);
        expect(s.crew).toBeLessThan(20);
    });

    it('paid crews recover morale in harbour', () => {
        const s = ship('sloop', { crew: 4, morale: 40 });
        const p = player({ ships: [s] });
        Ships.processDaily(p, null);
        expect(s.morale).toBe(43);
    });

    it('storms at sea shake the crew and can take a sailor', () => {
        const w = { weather: { getWeather: () => ({ type: 'storm' }) }, getTile: () => null };
        const s = ship('war_galley', { status: 'anchored', crew: 20, morale: 70 });
        const p = player({ ships: [s], gold: 100000 });
        let lost = 0;
        for (let d = 0; d < 6; d++) {
            const out = Ships.processDaily(p, w);
            lost += out.stormReports[0].crewLost;
        }
        expect(s.morale).toBeLessThan(70);
        expect(lost).toBeGreaterThan(0);
        expect(s.crew).toBeLessThanOrEqual(20 - lost);
    });

    it('defeats at sea cost sailors and morale; victories raise morale', () => {
        let sawDefeat = false;
        let sawVictory = false;
        for (let seed = 1; seed <= 60 && !(sawDefeat && sawVictory); seed++) {
            Utils.setSeed(seed);
            const s = ship('sloop', { status: 'at_sea', crew: 4, morale: 70 });
            const p = player({ ships: [s] });
            const res = Ships.huntPirates(p, s.id, null);
            if (res.type === 'error') {
                sawDefeat = true;
                expect(s.crew).toBeLessThan(4);
                expect(s.morale).toBeLessThan(70);
            } else if (res.type === 'success') {
                sawVictory = true;
                expect(s.morale).toBeGreaterThan(70);
            }
        }
        expect(sawDefeat && sawVictory).toBe(true);
    });
});

describe('save / load', () => {
    it('crew and morale survive a round trip', () => {
        const p = new Player();
        p.ships = [ship('sloop', { crew: 3, morale: 52 })];
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.ships[0].crew).toBe(3);
        expect(back.ships[0].morale).toBe(52);
    });

    it('ships from older saves are backfilled with a full crew', () => {
        const p = new Player();
        p.ships = [ship('galleon')];
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        delete json.ships[0].crew;
        delete json.ships[0].morale;
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.ships[0].crew).toBe(30);
        expect(back.ships[0].morale).toBe(70);
    });
});
