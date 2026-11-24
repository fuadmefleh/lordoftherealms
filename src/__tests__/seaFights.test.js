// Sea fights under sail (systems/seaFights.js): ships with headings, speed by
// the wind, broadsides that bear only on the beam, raking across the bow,
// chain shot for the rigging, grappling into a boarding, fleeing, squadron
// orders, a headless auto-resolve, and the fight written back to the fleet
// and into the pirates' phased scene.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SeaFights } from '../systems/seaFights.js';
import { Ships } from '../systems/ships.js';
import { Technology } from '../systems/technology.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(7));

const us = (extra = {}) => ({ id: 'p0', side: 'player', name: 'Gull', typeId: 'caravel', flagship: true, shipId: 'ship_1', guns: 12, crew: 10, ...extra });
const pirate = (str = 12, type = 'sloop') => SeaFights.enemyFromPirates({ type: 'pirate', name: 'Red Annet', shipName: 'Wasp', shipType: type, strength: str, str0: str, temperament: 'greedy' });

/** Two ships placed by hand: the fight's start positions overwritten. */
function placed(a, b, opts = {}) {
    const f = SeaFights.create([a], [b], { seed: 11, ...opts });
    return f;
}

describe('sailing by the wind', () => {
    it('a sailing ship is fastest on a beam reach and crawls head to wind; a galley rows regardless', () => {
        const f = SeaFights.create([us()], pirate(), { seed: 3 });
        f.wind.dir = 0; // blowing toward the east
        const F = SeaFights.flagship(f);
        const beam = SeaFights.sailFactor(f, F, Math.PI / 2);
        const run = SeaFights.sailFactor(f, F, 0);
        const head = SeaFights.sailFactor(f, F, Math.PI);
        expect(beam).toBeGreaterThan(run);
        expect(run).toBeGreaterThan(head);
        expect(head).toBeLessThan(0.2);
        const g = SeaFights._spec({ id: 'g', side: 'player', typeId: 'war_galley' });
        expect(SeaFights.sailFactor(f, g, Math.PI)).toBeGreaterThan(0.7);
    });

    it('no sailing ship points closer than the wind allows: she tacks', () => {
        const f = SeaFights.create([us()], pirate(), { seed: 3 });
        f.wind.dir = 0;
        const F = SeaFights.flagship(f);
        const h = SeaFights._tack(f, F, Math.PI);
        const off = Math.abs(((h - 0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        expect(Math.PI - off).toBeLessThanOrEqual(SeaFights.config().noSailHeadTo * Math.PI / 180 + 1e-6);
    });
});

describe('broadsides', () => {
    it('guns bear on the beam: a ship abeam is hit, one dead ahead only by the chasers', () => {
        const fa = placed(us(), pirate()[0]);
        const [A, B] = fa.ships;
        Object.assign(A, { x: 0, y: 0, heading: Math.PI, order: 'hold', reloadLeft: 0 });
        Object.assign(B, { x: 0, y: 4, heading: Math.PI, reloadLeft: 99 });
        SeaFights._fire(fa, A, 0.25);
        const abeam = 100 - B.hull;
        expect(abeam).toBeGreaterThan(0);
        expect(fa.events.some(e => e.type === 'broadside')).toBe(true);

        const fb = placed(us(), pirate()[0]);
        const [C, D] = fb.ships;
        Object.assign(C, { x: 0, y: 0, heading: Math.PI, reloadLeft: 0 });
        Object.assign(D, { x: -4, y: 0, heading: Math.PI, reloadLeft: 99 });
        fb.n = fa.n - 0; // the same dice
        SeaFights._fire(fb, C, 0.25);
        expect(fb.events.some(e => e.type === 'chase')).toBe(true);
        expect(100 - D.hull).toBeLessThan(abeam);
    });

    it('crossing her bow rakes her: more damage than the same shot on her beam', () => {
        const shot = (targetHeading) => {
            const f = placed(us(), pirate()[0]);
            const [A, B] = f.ships;
            Object.assign(A, { x: 0, y: 0, heading: Math.PI, reloadLeft: 0 });
            Object.assign(B, { x: 0, y: 4, heading: targetHeading, reloadLeft: 99 });
            f.n = 0;
            SeaFights._fire(f, A, 0.25);
            return { dmg: 100 - B.hull, rake: f.events[0] && f.events[0].rake };
        };
        const beam = shot(Math.PI);          // she sails alongside: we hit her side
        const rake = shot(-Math.PI / 2);     // she points straight at us: we hit her bow
        expect(rake.rake).toBe(true);
        expect(beam.rake).toBe(false);
        expect(rake.dmg).toBeGreaterThan(beam.dmg * 1.5);
    });

    it('chain shot cuts rigging, grape kills men, round breaks the hull', () => {
        const fire = (shotType) => {
            const f = placed(us(), pirate(20, 'caravel')[0]);
            const [A, B] = f.ships;
            Object.assign(A, { x: 0, y: 0, heading: Math.PI, reloadLeft: 0, shot: shotType });
            Object.assign(B, { x: 0, y: 3, heading: Math.PI, reloadLeft: 99 });
            f.n = 0;
            SeaFights._fire(f, A, 0.25);
            return { hull: 100 - B.hull, rig: 100 - B.rigging, crew: B.crewStart - B.crew + (B._crewF || 0) };
        };
        const round = fire('round'), chain = fire('chain'), grape = fire('grape');
        expect(chain.rig).toBeGreaterThan(round.rig);
        expect(round.hull).toBeGreaterThan(chain.hull);
        expect(grape.crew).toBeGreaterThan(round.crew);
    });
});

describe('the course of a fight', () => {
    it('the same seed and orders give the same fight', () => {
        const run = () => {
            const f = SeaFights.create([us()], pirate(), { seed: 99 });
            SeaFights.orderFlagship(f, 'broadside');
            for (let i = 0; i < 400 && !f.outcome; i++) SeaFights.advance(f, 0.1);
            return JSON.stringify({ o: f.outcome, ships: f.ships.map(s => [Math.round(s.x * 100), Math.round(s.hull), s.crew]) });
        };
        expect(run()).toBe(run());
    });

    it('grappling with the flagship ends the sailing in a boarding; the deck decides it', () => {
        const f = placed(us(), pirate()[0]);
        const [A, B] = f.ships;
        Object.assign(A, { x: 0, y: 0, heading: Math.PI, speed: 0.3, order: 'grapple', target: B.id, _grT: 0 });
        Object.assign(B, { x: -0.5, y: 1.2, heading: Math.PI, speed: 0.3 });
        f.seed = 1;
        for (let i = 0; i < 200 && !f.outcome; i++) { A._grT = 0; SeaFights._grapple(f, A); }
        expect(f.outcome).toMatchObject({ kind: 'boarding', enemyId: B.id, by: 'player' });
        expect(SeaFights.boardingStrength(f, B.id)).toBeGreaterThan(0);
        SeaFights.finishBoarding(f, true);
        expect(f.outcome.kind).toBe('victory');
        expect(B.struck).toBe(true);
    });

    it('lost on deck, the fight is lost', () => {
        const f = placed(us(), pirate()[0]);
        f.outcome = { kind: 'boarding', enemyId: 'e0', by: 'enemy' };
        SeaFights.finishBoarding(f, false);
        expect(f.outcome).toMatchObject({ kind: 'defeat', how: 'boarded' });
    });

    it('a fast ship ordered to flee gets away from a slow one', () => {
        const f = SeaFights.create([us({ typeId: 'caravel', knots: 7 })], SeaFights.enemyFromPirates({ type: 'pirate', name: 'Slow', shipType: 'cog', strength: 10, str0: 10 }), { seed: 5 });
        SeaFights.orderFlagship(f, 'flee');
        for (let i = 0; i < 4000 && !f.outcome; i++) SeaFights.advance(f, 0.25);
        expect(['escaped']).toContain(f.outcome.kind);
    });

    it('a merchant runs, and strikes once run down', () => {
        let struck = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const f = SeaFights.create([us({ guns: 25, crew: 20, typeId: 'war_galley' })], SeaFights.enemyFromPirates({ type: 'merchant', name: 'Fat Cog', shipType: 'cog', strength: 6, str0: 6 }), { seed });
            SeaFights.autoResolve(f);
            if (f.outcome.kind === 'victory') struck++;
        }
        expect(struck).toBeGreaterThanOrEqual(7);
    });

    it('auto-resolve always ends the fight, a boarding rolled by the crews', () => {
        for (let seed = 1; seed <= 12; seed++) {
            const f = SeaFights.create([us()], pirate(14), { seed });
            const o = SeaFights.autoResolve(f);
            expect(['victory', 'defeat', 'escaped', 'enemy_fled']).toContain(o.kind);
        }
    });

    it('a stronger ship wins more often than a weaker one', () => {
        const wins = (guns, crew) => {
            let n = 0;
            for (let seed = 1; seed <= 30; seed++) {
                const f = SeaFights.create([us({ guns, crew, typeId: 'war_galley' })], pirate(14), { seed });
                if (SeaFights.autoResolve(f).kind === 'victory') n++;
            }
            return n;
        };
        expect(wins(30, 24)).toBeGreaterThan(wins(6, 4));
    });

    it('strike your colours: lost', () => {
        const f = SeaFights.create([us()], pirate(), { seed: 2 });
        SeaFights.strike(f);
        expect(f.outcome).toMatchObject({ kind: 'defeat', how: 'struck' });
    });
});

describe('the squadron', () => {
    it('on "follow" the consorts keep station on the flagship; on "hold" they lie still', () => {
        const f = SeaFights.create([us(), { id: 'p1', side: 'player', name: 'Tern', typeId: 'caravel', shipId: 'ship_2', guns: 12, crew: 10 }], pirate(), { seed: 8 });
        SeaFights.orderFlagship(f, 'flee');
        for (let i = 0; i < 160; i++) SeaFights.advance(f, 0.25);
        const F = SeaFights.flagship(f);
        const T = SeaFights.ship(f, 'p1');
        expect(SeaFights._dist(F, T)).toBeLessThan(12);
        expect(Math.abs(Math.cos(F.heading - T.heading))).toBeGreaterThan(0.8);
        SeaFights.orderSquadron(f, 'hold');
        for (let i = 0; i < 40; i++) SeaFights.advance(f, 0.25);
        expect(T.speed).toBeLessThan(0.2);
        expect(T.order).toBe('hold');
    });

    it('your side is the ship you are aboard, your crewed ships in company and your war galleys', () => {
        const flag = { id: 's1', typeId: 'caravel', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 90, crew: 10, morale: 70, customizations: [], cargo: {} };
        const mate = { id: 's2', typeId: 'sloop', name: 'Tern', q: 6, r: 5, status: 'anchored', condition: 100, crew: 4, morale: 70, customizations: [], cargo: {} };
        const far = { id: 's3', typeId: 'sloop', name: 'Far', q: 20, r: 5, status: 'at_sea', condition: 100, crew: 4, morale: 70, customizations: [], cargo: {} };
        const p = { q: 5, r: 5, boardedShip: 's1', ships: [flag, mate, far], army: [{ id: 'u1', type: 'war_galley', name: 'Sea Hawk', domain: 'sea', strength: 20, level: 1 }], skills: {} };
        Technology.initPlayer(p);
        const side = SeaFights.playerSide(p, { width: 40, height: 30 });
        expect(side.map(s => s.name)).toEqual(['Gull', 'Tern', 'Sea Hawk']);
        expect(side[0].flagship).toBe(true);
        expect(side[0].hull).toBe(90);
    });
});

describe('afterwards', () => {
    it('writes hull and crew back to your ships; a sunk consort is gone, a mauled galley wounded', () => {
        const flag = { id: 's1', typeId: 'caravel', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, crew: 10, morale: 70, customizations: [], cargo: {} };
        const mate = { id: 's2', typeId: 'sloop', name: 'Tern', q: 5, r: 5, status: 'at_sea', condition: 100, crew: 4, morale: 70, customizations: [], cargo: {} };
        const p = { q: 5, r: 5, boardedShip: 's1', ships: [flag, mate], army: [{ id: 'u1', type: 'war_galley', name: 'Sea Hawk', domain: 'sea', strength: 20, level: 1 }], skills: {} };
        Technology.initPlayer(p);
        const f = SeaFights.create(SeaFights.playerSide(p, { width: 40, height: 30 }), pirate(), { seed: 4 });
        const [F, T, G] = SeaFights.ships(f, 'player');
        F.hull = 62; F.rigging = 50; F.crew = 7;
        T.sunk = true;
        G.hull = 40;
        f.outcome = { kind: 'victory' };
        const res = SeaFights.applyToFleet(p, { width: 40, height: 30 }, f);
        expect(flag.condition).toBe(58);
        expect(flag.crew).toBe(7);
        expect(p.ships.map(s => s.id)).toEqual(['s1']);
        expect(p.army[0].woundedDays).toBeGreaterThanOrEqual(5);
        expect(res.lost).toEqual(['Tern']);
        // once only
        expect(SeaFights.applyToFleet(p, {}, f).lines).toEqual([]);
    });

    it('a pirate beaten under sail goes on to the pirates\' own aftermath; a defeat ends it', () => {
        const flag = { id: 's1', typeId: 'caravel', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, crew: 10, morale: 70, customizations: [], cargo: {} };
        const p = { q: 5, r: 5, boardedShip: 's1', ships: [flag], army: [], skills: {}, gold: 100, renown: 0, karma: 0, health: 100, reputation: {} };
        Technology.initPlayer(p);
        const world = { width: 40, height: 30, day: 10, getTile: () => ({ terrain: { id: 'ocean' } }), kingdoms: [] };
        const state = { shipId: 's1', kind: 'hunt', phase: 'battle', log: [], enemy: { type: 'pirate', captainId: null, name: 'a nameless rover', shipName: 'an unmarked sloop', shipType: 'sloop', temperament: 'greedy', strength: 10, str0: 10, speed: 5 } };
        const won = SeaFights.create(SeaFights.playerSide(p, world), SeaFights.enemyFromPirates(state.enemy), { seed: 1 });
        won.outcome = { kind: 'victory', boarded: true, enemyId: 'e0' };
        const out = SeaFights.settlePirates(p, world, state, won);
        expect(out.state && out.state.phase).toBe('aftermath_crew');
        expect(p.gold).toBeGreaterThan(100);

        const lost = SeaFights.create(SeaFights.playerSide(p, world), SeaFights.enemyFromPirates(state.enemy), { seed: 2 });
        lost.outcome = { kind: 'defeat', how: 'beaten' };
        const out2 = SeaFights.settlePirates(p, world, state, lost);
        expect(out2.done).toBe(true);
        expect(out2.notification.type).toBe('error');
        expect(Ships.getShipById(p, 's1')).toBeTruthy();
    });
});
