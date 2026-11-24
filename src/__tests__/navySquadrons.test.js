// Royal fleets as ships on the map (world/navySquadrons.js) and running their
// blockades (systems/blockadeRunning.js): blockade squadrons on station off
// the enemy's ports, patrols out and back on their routes day by day, a
// voyage bound into a held port lying off it, and the run past — by night,
// weather, speed and stealth — or the search, the catch, the fight; and the
// patrols that bring your ships to at sea (systems/seaInterception.js).

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { NavySquadrons } from '../world/navySquadrons.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Ships } from '../systems/ships.js';
import { BlockadeRunning } from '../systems/blockadeRunning.js';
import { SeaInterception } from '../systems/seaInterception.js';
import { SeaFights } from '../systems/seaFights.js';
import { Technology } from '../systems/technology.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

let savedChance;
beforeEach(() => {
    Utils.setSeed(31);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
    DataLoader.ships.settings.voyage.eventChance = 0;
});
afterEach(() => {
    DataLoader.ships.settings.voyage.eventChance = savedChance;
    vi.restoreAllMocks();
});

const OCEAN = { id: 'ocean', passable: false };
const PLAINS = { id: 'plains', passable: true };

/**
 * Open sea, with a strip of land on rows 0-1. Realm A has a port at (5,2)
 * on the coast; realm B a port at (25,2). A's strong fleet blockades B.
 */
function makeWorld({ blockade = true, aStrength = 80, bStrength = 10, narrowMouth = false } = {}) {
    const width = 40, height = 20;
    const tiles = new Map();
    const land = new Set();
    for (let q = 0; q < width; q++) { land.add(`${q},0`); land.add(`${q},1`); }
    land.add('5,2'); land.add('25,2');
    // A's port opening onto the sea through a single hex
    if (narrowMouth) Hex.neighbors(5, 2).filter(n => !land.has(`${n.q},${n.r}`)).slice(1).forEach(n => land.add(`${n.q},${n.r}`));
    const a = { id: 'A', name: 'Avalon', color: '#3366cc', isAlive: true, wars: ['B'], allies: [], territory: [{ q: 5, r: 2 }], capital: { q: 5, r: 2 }, treasury: 100000 };
    const b = { id: 'B', name: 'Brennor', color: '#cc3333', isAlive: true, wars: ['A'], allies: [], territory: [{ q: 25, r: 2 }], capital: { q: 25, r: 2 }, treasury: 100000 };
    for (const k of [a, b]) KingdomNavy.ensure(k);
    a.navy.strength = aStrength; a.navy.portSites = [{ q: 5, r: 2 }]; a.navy.ports = 1; a.navy.settlements = 1; a.navy._init = true;
    b.navy.strength = bStrength; b.navy.portSites = [{ q: 25, r: 2 }]; b.navy.ports = 1; b.navy.settlements = 1; b.navy._init = true;
    if (blockade) b.navy.blockades = { A: 1 };
    const kingdoms = [a, b];
    const world = {
        width, height, day: 10, kingdoms, events: [],
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const isLand = land.has(key);
                const settlement = key === '5,2' ? { name: 'Avalport', type: 'town', kingdom: 'A' } : key === '25,2' ? { name: 'Brenhaven', type: 'town', kingdom: 'B' } : null;
                tiles.set(key, { q, r, terrain: isLand ? PLAINS : OCEAN, settlement: settlement ? { q, r, ...settlement } : null, kingdom: settlement ? settlement.kingdom : null });
            }
            return tiles.get(key);
        },
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
    };
    return { world, a, b };
}

const ship = (extra = {}) => ({
    id: 'ship_1', typeId: 'caravel', name: 'Gull', q: 15, r: 6, status: 'docked', condition: 100,
    customizations: [], cargo: { silk: 10 }, crew: 10, morale: 70, provisions: 200, water: 200, ...extra,
});
function captain(s, extra = {}) {
    const p = { gold: 5000, renown: 0, karma: 0, health: 100, reputation: {}, inventory: {}, skills: { stealth: 2 }, ships: [s], army: [], q: s.q, r: s.r, boardedShip: null, ...extra };
    Technology.initPlayer(p);
    return p;
}

describe('squadrons on the map', () => {
    it('a blockade squadron lies on the water at the mouth of each held port; a patrol off its own', () => {
        const { world } = makeWorld();
        const list = NavySquadrons.list(world);
        const bl = list.filter(s => s.kind === 'blockade');
        expect(bl).toHaveLength(1);
        expect(bl[0]).toMatchObject({ kingdomId: 'A', targetId: 'B', port: { q: 25, r: 2 } });
        const t = world.getTile(bl[0].q, bl[0].r);
        expect(t.terrain.id).toBe('ocean');
        expect(Hex.offsetDistance(bl[0].q, bl[0].r, 25, 2)).toBe(1);
        expect(bl[0].ships).toBeGreaterThanOrEqual(1);
        const patrols = list.filter(s => s.kind === 'patrol' && s.kingdomId === 'A');
        expect(patrols.length).toBeGreaterThanOrEqual(1);
        for (const h of patrols[0].route) expect(world.getTile(h.q, h.r).terrain.id).toBe('ocean');
    });

    it('patrols move along their routes from day to day, the same way each time', () => {
        const { world } = makeWorld();
        const where = () => NavySquadrons.list(world).filter(s => s.kind === 'patrol').map(s => `${s.id}@${s.q},${s.r}`).join(' ');
        const d10 = where();
        world.day = 11;
        const d11 = where();
        expect(d11).not.toBe(d10);
        world.day = 10;
        expect(where()).toBe(d10);
    });

    it('a big fleet with one port sends out no two patrols on the same water', () => {
        const { world, a } = makeWorld({ blockade: false, aStrength: 300, narrowMouth: true });
        const patrols = NavySquadrons.list(world).filter(s => s.kind === 'patrol' && s.kingdomId === 'A');
        expect(patrols.length).toBeGreaterThanOrEqual(1);
        const keys = patrols.map(s => s.route.map(h => `${h.q},${h.r}`).join(';'));
        expect(new Set(keys).size).toBe(keys.length);
        // the whole fleet still sails: the merged squadrons carry it
        expect(patrols.reduce((t, s) => t + s.strength, 0)).toBeGreaterThanOrEqual(KingdomNavy.effectiveStrength(a) - patrols.length);
    });

    it('no blockade, no blockade squadron; a fleet too small keeps to harbour', () => {
        const { world } = makeWorld({ blockade: false, bStrength: 3 });
        const list = NavySquadrons.list(world);
        expect(list.some(s => s.kind === 'blockade')).toBe(false);
        expect(list.some(s => s.kingdomId === 'B')).toBe(false);
    });

    it('the blockader\'s own ships and its allies pass; others are held', () => {
        const { world, b } = makeWorld();
        expect(NavySquadrons.holdsShip(world, { allegiance: 'A' }, 25, 2)).toBeNull();
        expect(NavySquadrons.holdsShip(world, { allegiance: null }, 25, 2)).not.toBeNull();
        expect(NavySquadrons.holdsShip(world, { allegiance: 'B' }, 25, 2)).not.toBeNull();
        expect(b.navy.blockades.A).toBe(1);
        expect(NavySquadrons.holdsShip(world, {}, 5, 2)).toBeNull();
    });

    it('the odds of slipping past: better by night, in fog, in a fast quiet ship; worse past many sail and a close blockade', () => {
        const base = { speed: 5, squadronSpeed: 5, ships: 1 };
        const day = NavySquadrons.slipChance(base).chance;
        expect(NavySquadrons.slipChance({ ...base, night: true }).chance).toBeGreaterThan(day);
        expect(NavySquadrons.slipChance({ ...base, weather: 'fog' }).chance).toBeGreaterThan(day);
        expect(NavySquadrons.slipChance({ ...base, speed: 8 }).chance).toBeGreaterThan(day);
        expect(NavySquadrons.slipChance({ ...base, stealth: 5, shipStealth: 1 }).chance).toBeGreaterThan(day);
        expect(NavySquadrons.slipChance({ ...base, ships: 5 }).chance).toBeLessThan(day);
        expect(NavySquadrons.slipChance({ ...base, closed: true }).chance).toBeLessThan(day);
        const best = NavySquadrons.slipChance({ ...base, night: true, weather: 'fog', speed: 12, stealth: 10, shipStealth: 3 }).chance;
        expect(best).toBeLessThanOrEqual(0.9);
    });
});

describe('running the blockade', () => {
    /** A voyage to Brenhaven sailed until she lies off the blockade. */
    function toTheBlockade() {
        const { world, a, b } = makeWorld();
        const s = ship();
        const p = captain(s);
        const go = Ships.startVoyage(p, world, s.id, 25, 2, 'Brenhaven');
        expect(go.success).toBe(true);
        let held = null;
        for (let i = 0; i < 20 && Ships.getVoyage(p); i++) {
            world.day++;
            const out = Ships.processDaily(p, world);
            if (out.voyage && out.voyage.blockade) { held = out.voyage; break; }
        }
        return { world, a, b, s, p, held };
    }

    it('a voyage bound into a blockaded port heaves to off it, short of the harbour, and waits', () => {
        const { world, s, p, held } = toTheBlockade();
        expect(held).toBeTruthy();
        expect(s.status).not.toBe('docked');
        expect(s.voyage.blockade).toMatchObject({ portName: 'Brenhaven', dir: 'in', kingdomId: 'A' });
        expect(p.q === 25 && p.r === 2).toBe(false);
        // Another day: still lying off, the scene asked again
        world.day++;
        const out = Ships.processDaily(p, world);
        expect(out.voyage.blockade).toBeTruthy();
        expect(s.status).not.toBe('docked');
    });

    it('the scene offers the run by day and by dark, the search, the fight under sail and at once', () => {
        const { world, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        expect(st).toMatchObject({ kind: 'blockade', phase: 'sighted', dir: 'in' });
        const v = BlockadeRunning.view(p, world, st);
        const ids = v.options.map(o => o.id);
        expect(ids).toEqual(expect.arrayContaining(['run_now', 'run_night', 'submit', 'fight_sail', 'fight', 'wait', 'turn_back']));
        const runDay = v.options.find(o => o.id === 'run_now').chance;
        const runNight = v.options.find(o => o.id === 'run_night').chance;
        expect(runNight).toBeGreaterThan(runDay);
    });

    it('slipped past: she makes port, and may trade in the shut harbour at a runner\'s price', () => {
        const { world, s, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        expect(Ships._closedPortMessage(world, 25, 2)).toBeTruthy();
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = BlockadeRunning.act(p, world, st, 'run_night');
        expect(res.done).toBe(true);
        expect(res.endDay).toBe(true);
        expect(s.status).toBe('docked');
        expect(s.voyage).toBeUndefined();
        expect(p.q).toBe(25);
        expect(p.blockadeRun).toMatchObject({ q: 25, r: 2 });
        expect(Ships._closedPortMessage(world, 25, 2, p)).toBeNull();
        expect(Ships._closedPortMessage(world, 25, 2)).toBeTruthy();
    });

    it('seen: strike, and they take a share of the cargo and send you off', () => {
        const { world, s, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        const caught = BlockadeRunning.act(p, world, st, 'run_now');
        expect(caught.state.phase).toBe('caught');
        const v = BlockadeRunning.view(p, world, caught.state);
        expect(v.options.map(o => o.id)).toEqual(expect.arrayContaining(['fight_sail', 'fight', 'flee', 'strike']));
        const res = BlockadeRunning.act(p, world, caught.state, 'strike');
        expect(res.done).toBe(true);
        expect(s.cargo.silk).toBe(7);
        expect(s.voyage).toBeUndefined();
        expect(s.status).toBe('at_sea');
    });

    it('a loose blockade searches and lets a neutral through for dues; a close one turns her away', () => {
        // Loose: the blockader is not three times the defender
        const loose = makeWorld({ aStrength: 30, bStrength: 15 });
        const s1 = ship();
        const p1 = captain(s1);
        Ships.startVoyage(p1, loose.world, s1.id, 25, 2, 'Brenhaven');
        for (let i = 0; i < 20 && !(s1.voyage && s1.voyage.blockade); i++) { loose.world.day++; Ships.processDaily(p1, loose.world); }
        const st1 = BlockadeRunning.start(p1, loose.world);
        expect(st1.closed).toBe(false);
        BlockadeRunning.act(p1, loose.world, st1, 'submit');
        expect(s1.status).toBe('docked');
        expect(s1.cargo.silk).toBe(9);

        const { world, s, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        expect(st.closed).toBe(true);
        BlockadeRunning.act(p, world, st, 'submit');
        expect(s.status).not.toBe('docked');
        expect(s.voyage).toBeUndefined();
        expect(s.cargo.silk).toBe(10);
    });

    it('beating the squadron off thins the blockader\'s fleet and takes her in', () => {
        const { world, a, s, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        const before = a.navy.strength;
        const f = SeaFights.create(SeaFights.playerSide(p, world), BlockadeRunning.enemySpecs(world, st), { seed: 3 });
        f.outcome = { kind: 'victory' };
        for (const e of SeaFights.ships(f, 'enemy')) e.struck = true;
        const res = BlockadeRunning.settleFight(p, world, st, f);
        expect(res.done).toBe(true);
        expect(a.navy.strength).toBeLessThan(before);
        expect(s.status).toBe('docked');
        expect(p.renown).toBeGreaterThan(0);
    });

    it('fought at once, the fight is sailed out and settled', () => {
        const { world, p } = toTheBlockade();
        const st = BlockadeRunning.start(p, world);
        const res = BlockadeRunning.act(p, world, st, 'fight');
        expect(res.done).toBe(true);
        expect(res.notification).toBeTruthy();
        expect(Ships.getVoyage(p) && Ships.getVoyage(p).blockade).toBeFalsy();
    });

    it('leaving a held port: she waits in the harbour mouth; staying ties her up again', () => {
        const { world } = makeWorld();
        const s = ship({ q: 25, r: 2, dockedAt: 'Brenhaven' });
        const p = captain(s);
        Ships.startVoyage(p, world, s.id, 5, 2, 'Avalport');
        world.day++;
        const out = Ships.processDaily(p, world);
        expect(out.voyage.blockade).toMatchObject({ dir: 'out', portName: 'Brenhaven' });
        expect(p.q).toBe(25);
        const st = BlockadeRunning.start(p, world);
        BlockadeRunning.act(p, world, st, 'turn_back');
        expect(s.status).toBe('docked');
        expect(p.boardedShip).toBeNull();
    });

    it('the blockade gone, the voyage sails on into port', () => {
        const { world, b, s, p } = toTheBlockade();
        b.navy.blockades = {};
        NavySquadrons.reset(world);
        for (let i = 0; i < 5 && Ships.getVoyage(p); i++) { world.day++; Ships.processDaily(p, world); }
        expect(s.status).toBe('docked');
        expect(s.dockedAt).toBe('Brenhaven');
    });
});

describe('patrols intercept your ships', () => {
    /** A's patrol at sea, and a ship of yours (A at war with you) on its water today. */
    function onPatrol({ aboard = true, war = true } = {}) {
        const { world, a, b } = makeWorld({ blockade: false });
        NavySquadrons.reset(world);
        const sq = NavySquadrons.list(world).find(s => s.kind === 'patrol' && s.kingdomId === 'A');
        const s = ship({ q: sq.q, r: sq.r, status: 'anchored' });
        const p = captain(s, { boardedShip: aboard ? s.id : null, realmWars: war ? { wars: { A: { score: 0 } } } : null, reputation: war ? {} : { A: -80 } });
        return { world, a, b, s, p, sq };
    }

    it('a patrol sweeps water along its route each day; a path across it finds it, one far off does not', () => {
        const { world, sq } = onPatrol();
        expect(sq.swept.length).toBeGreaterThanOrEqual(1);
        expect(sq.swept.some(h => h.q === sq.q && h.r === sq.r)).toBe(true);
        expect(NavySquadrons.patrolsAlong(world, [{ q: sq.q, r: sq.r }])[0]).toMatchObject({ distance: 0 });
        expect(NavySquadrons.patrolsAlong(world, [{ q: 30, r: 18 }])).toEqual([]);
    });

    it('the odds of being brought to: worse at war, close by, past many sail; better in fog, by dark, in a fast quiet ship', () => {
        const base = { distance: 0, ships: 2, speed: 5, squadronSpeed: 5, war: true };
        const c = NavySquadrons.catchChance(base).chance;
        expect(NavySquadrons.catchChance({ ...base, war: false }).chance).toBeLessThan(c);
        expect(NavySquadrons.catchChance({ ...base, distance: 2 }).chance).toBeLessThan(c);
        expect(NavySquadrons.catchChance({ ...base, ships: 5 }).chance).toBeGreaterThan(c);
        expect(NavySquadrons.catchChance({ ...base, weather: 'fog' }).chance).toBeLessThan(c);
        expect(NavySquadrons.catchChance({ ...base, night: 1 }).chance).toBeLessThan(c);
        expect(NavySquadrons.catchChance({ ...base, speed: 9, stealth: 4, shipStealth: 1 }).chance).toBeLessThan(c);
    });

    it('no hostility, no interception: a realm at peace with you lets her be', () => {
        const env = onPatrol({ war: false });
        env.p.reputation = {};
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        expect(Ships._interceptShips(env.p, env.world)).toEqual([]);
    });

    it('aboard, she is held on the voyage\'s day: the scene offers fight under sail, at once, flee and strike', () => {
        const { world, s, p, sq } = onPatrol();
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const reports = Ships._interceptShips(p, world, { shipId: s.id, path: [{ q: sq.q, r: sq.r }] });
        vi.restoreAllMocks();
        expect(reports[0]).toMatchObject({ pending: true, kingdomId: 'A', stance: 'war' });
        // held, she is not stopped twice in a day
        expect(Ships._interceptShips(p, world)).toEqual([]);
        const st = SeaInterception.start(p, world);
        const v = SeaInterception.view(p, world, st);
        expect(v.options.map(o => o.id)).toEqual(['fight_sail', 'fight', 'flee', 'strike']);
        expect(v.options.find(o => o.id === 'flee').chance).toBeGreaterThan(0);
    });

    it('struck at war: half the cargo and a fine; the ship goes on', () => {
        const { world, a, s, p, sq } = onPatrol();
        SeaInterception.hold(p, world, s, sq, 'war');
        const gold = p.gold;
        const res = SeaInterception.act(p, world, SeaInterception.start(p, world), 'strike');
        expect(res.done).toBe(true);
        expect(s.cargo.silk).toBe(5);
        expect(p.gold).toBeLessThan(gold);
        expect(a.treasury).toBeGreaterThan(100000);
        expect(s.intercept).toBeNull();
    });

    it('outsailed: away clear, the hold untouched; failing, the choice narrows to fight or strike', () => {
        const env = onPatrol();
        SeaInterception.hold(env.p, env.world, env.s, env.sq, 'war');
        vi.spyOn(Utils, 'random').mockReturnValue(0.999);
        const miss = SeaInterception.act(env.p, env.world, SeaInterception.start(env.p, env.world), 'flee');
        expect(miss.state.fled).toBe(true);
        expect(SeaInterception.view(env.p, env.world, miss.state).options.map(o => o.id)).toEqual(['fight_sail', 'fight', 'strike']);
        vi.restoreAllMocks();
        const again = onPatrol();
        SeaInterception.hold(again.p, again.world, again.s, again.sq, 'war');
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const ok = SeaInterception.act(again.p, again.world, SeaInterception.start(again.p, again.world), 'flee');
        expect(ok.report.outcome).toBe('fled');
        expect(again.s.cargo.silk).toBe(10);
    });

    it('fought at once, the fight is sailed out and settled', () => {
        const { world, s, p, sq } = onPatrol();
        SeaInterception.hold(p, world, s, sq, 'war');
        const res = SeaInterception.act(p, world, SeaInterception.start(p, world), 'fight');
        expect(res.done).toBe(true);
        expect(res.report.fought).toBe(true);
        expect(['victory', 'defeat', 'drawn']).toContain(res.report.outcome);
        expect(s.intercept).toBeNull();
    });

    it('left undecided, her master settles it the next day', () => {
        const { world, s, p, sq } = onPatrol();
        SeaInterception.hold(p, world, s, sq, 'war');
        world.day++;
        const out = Ships.processDaily(p, world);
        expect(out.interceptions.some(ic => ic.shipId === s.id && !ic.pending)).toBe(true);
    });
});
