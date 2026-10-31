// The open sea as choices (systems/pirates.js): named pirate captains with
// havens on the map who remember you, phased encounters (sighting → battle →
// aftermath), prizes that join the fleet, infamy and the hunters it sends,
// vengeful captains, haven raids and the sea events of Explore the Waters.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Ships } from '../systems/ships.js';
import { Pirates } from '../systems/pirates.js';
import { Discovery } from '../systems/discovery.js';
import { PlayerActions } from '../player/playerActions.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
let ActionMenu;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    return () => logSpy.mockRestore();
});

let game;
let ship;
beforeEach(() => {
    game = newGame(101);
    Utils.setSeed(4242);
    ship = putToSea();
});

/** A strong galleon on the water beside a port, with the player at the helm. */
function putToSea(typeId = 'galleon') {
    const { world, player } = game;
    const ports = Discovery._worldCache(world).ports;
    for (const p of ports) {
        const water = Hex.neighbors(p.q, p.r)
            .map(n => world.getTile(Hex.wrapQ(n.q, world.width), n.r))
            .find(t => t && Ships.isWaterTile(t));
        if (!water) continue;
        const s = {
            id: 'ship_test', typeId, name: 'Test Galleon', q: water.q, r: water.r, status: 'at_sea', condition: 100,
            customizations: [], cargo: {}, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70,
        };
        player.ships = [s];
        player.boardedShip = s.id;
        player.q = water.q;
        player.r = water.r;
        return s;
    }
    throw new Error('no port with water beside it');
}

/** A pirate encounter at the battle phase against a named captain. */
function battleWith(cap, strength = 5) {
    const enemy = { ...Pirates._captainEnemy(cap), strength, str0: strength };
    return { shipId: ship.id, log: [], kind: 'hunt', phase: 'battle', enemy };
}

function winBoarding(state) {
    for (let i = 0; i < 50; i++) {
        const out = Pirates.act(game.player, game.world, state, 'board');
        if (out.state && out.state.phase === 'aftermath_crew') return out.state;
        ship.condition = 100;
        ship.crew = Ships.getShipEffectiveStats(ship).crewRequired;
    }
    throw new Error('never won the boarding');
}

describe('captains and havens', () => {
    it('places havens on lonely coasts and names captains from the data, the same for the same world', () => {
        const st = Pirates.ensure(game.player, game.world);
        expect(st.havens.length).toBeGreaterThan(0);
        for (const h of st.havens) {
            const t = game.world.getTile(h.q, h.r);
            expect(t.terrain.passable).toBe(true);
            expect(t.settlement).toBeFalsy();
            expect(Hex.neighbors(h.q, h.r).some(n => Ships.isWaterTile(game.world.getTile(Hex.wrapQ(n.q, game.world.width), n.r)))).toBe(true);
        }
        expect(Pirates.atLarge(game.player)).toHaveLength(Pirates.config().activeCaptains);
        const names = (Pirates.data().captains || []).map(c => c.name);
        for (const c of Pirates.atLarge(game.player)) expect(names).toContain(c.name);

        const other = newGame(101);
        const st2 = Pirates.ensure(other.player, other.world);
        expect(st2.havens).toEqual(st.havens);
        expect(st2.captains.map(c => c.id)).toEqual(st.captains.map(c => c.id));
    });

    it('the daily tick draws only from its own stream', () => {
        Pirates.ensure(game.player, game.world);
        Utils.setSeed(99);
        const expected = Utils.random();
        Utils.setSeed(99);
        for (let i = 0; i < 5; i++) {
            game.world.day++;
            Pirates.processDay(game.world, game.player);
        }
        expect(Utils.random()).toBe(expected);
    });

    it('captains grow at large, and a hanged one is replaced by a successor in time', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        const before = cap.strength;
        game.world.day++;
        Pirates.processDay(game.world, game.player);
        expect(cap.strength).toBeGreaterThan(before);
        cap.status = 'hanged';
        const n = Pirates.state(game.player).captains.length;
        for (let i = 0; i < 60; i++) {
            game.world.day++;
            Pirates.processDay(game.world, game.player);
        }
        expect(Pirates.state(game.player).captains.length).toBe(n + 1);
        expect(Pirates.atLarge(game.player)).toHaveLength(Pirates.config().activeCaptains);
    });
});

describe('hunting pirates', () => {
    it('a sighting offers chase, shadow, parley and break off, with odds', () => {
        let res = null;
        for (let i = 0; i < 30 && !(res && res.state); i++) res = Pirates.start(game.player, game.world, 'hunt');
        expect(res.state.phase).toBe('sighting');
        const v = Pirates.view(game.player, game.world, res.state);
        expect(v.options.map(o => o.id)).toEqual(['chase', 'shadow', 'parley', 'break']);
        for (const o of v.options.filter(o => o.chance != null)) expect(o.chance).toBeGreaterThan(0);
        expect(v.title).toContain(res.state.enemy.name);
    });

    it('beaten and ransomed: gold, their haven on your chart, and a captain who remembers', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        const after = winBoarding(battleWith(cap));
        expect(cap.status).toBe('taken');
        const gold = game.player.gold;
        const out = Pirates.act(game.player, game.world, after, 'ransom');
        expect(out.state.phase).toBe('aftermath_ship');
        expect(game.player.gold).toBeGreaterThan(gold);
        expect(cap.status).toBe('at_large');
        expect(cap.ransomed).toBe(1);
        expect(Pirates.haven(game.player, cap.havenId).known).toBe(true);
        expect(Pirates.memoryLine(cap)).toMatch(/ransomed/);
        // ...and her ship joins the fleet, sailed to port by a prize crew
        const fleet = game.player.ships.length;
        const crew = ship.crew;
        const done = Pirates.act(game.player, game.world, out.state, 'prize');
        expect(done.done).toBe(true);
        expect(game.player.ships.length).toBe(fleet + 1);
        const prize = game.player.ships[game.player.ships.length - 1];
        expect(prize.status).toBe('docked');
        expect(prize.dockedAt).toBeTruthy();
        expect(ship.crew).toBe(crew - Pirates.config().prizeCrew);
    });

    it('handed to the crown: the bounty, and their crews hate you for it', () => {
        const st = Pirates.ensure(game.player, game.world);
        const cap = st.captains[0];
        const mate = st.captains.find(c => c !== cap && c.havenId === cap.havenId);
        const after = winBoarding(battleWith(cap));
        const gold = game.player.gold;
        Pirates.act(game.player, game.world, after, 'hang');
        expect(cap.status).toBe('hanged');
        expect(game.player.gold).toBeGreaterThan(gold);
        if (mate) expect(mate.regard).toBeLessThan(0);
    });

    it('pressing the crew fills your berths and makes an enemy', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        ship.crew = 10;
        const after = winBoarding(battleWith(cap, 20));
        const crew = ship.crew;
        Pirates.act(game.player, game.world, after, 'press');
        expect(ship.crew).toBeGreaterThan(crew);
        expect(cap.regard).toBeLessThanOrEqual(-25);
    });

    it('a defeat costs gold to the captain, who remembers beating you', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        game.player.gold = 1000;
        ship.crew = 1;
        ship.condition = 10;
        let out = null;
        for (let i = 0; i < 50; i++) {
            out = Pirates.act(game.player, game.world, battleWith(cap, 60), 'board');
            if (out.done) break;
        }
        expect(out.done).toBe(true);
        expect(cap.beatYou).toBeGreaterThan(0);
        expect(cap.loot).toBeGreaterThan(0);
    });

    it('a broadside wears them down until a greedy crew strikes', () => {
        const cap = Pirates.ensure(game.player, game.world).captains.find(c => c.temperament !== 'cruel')
            || Pirates.ensure(game.player, game.world).captains[0];
        cap.temperament = 'greedy';
        let state = battleWith(cap, 30);
        let out = null;
        for (let i = 0; i < 10; i++) {
            out = Pirates.act(game.player, game.world, state, 'broadside');
            if (!out.state || out.state.phase !== 'battle') break;
            state = out.state;
            ship.condition = 100;
        }
        expect(out.state.phase).toBe('aftermath_crew');
    });
});

describe('turning pirate', () => {
    function plunder(choice) {
        const state = { shipId: ship.id, log: [], kind: 'prey', phase: 'merchant_aftermath', enemy: Pirates._merchantEnemy(game.player, game.world) };
        return Pirates.act(game.player, game.world, state, choice);
    }

    it('plunder: gold, cargo into the hold, infamy and the old reputation hit', () => {
        const k = Object.keys(game.player.reputation || {})[0];
        const rep = k ? game.player.reputation[k] : 0;
        const gold = game.player.gold;
        const out = plunder('plunder');
        expect(out.done).toBe(true);
        expect(game.player.gold).toBeGreaterThan(gold);
        expect(Pirates.getInfamy(game.player)).toBe(Pirates.config().infamy.piracy + Pirates.config().infamy.witnesses);
        if (k) expect(game.player.reputation[k]).toBeLessThan(rep);
        expect(Pirates.state(game.player).stats.merchantsTaken).toBe(1);
    });

    it('sinking her leaves no witnesses: little infamy, a heavy soul', () => {
        const karma = game.player.karma;
        plunder('sink');
        expect(Pirates.getInfamy(game.player)).toBe(Pirates.config().infamy.sunk);
        expect(game.player.karma).toBeLessThan(karma - 10);
    });

    it('infamy brings hunters at sea; striking your colours costs a fine and cools it', () => {
        Pirates.ensure(game.player, game.world);
        Pirates.state(game.player).infamy = 90;
        let threat = null;
        for (let i = 0; i < 80 && !threat; i++) {
            game.world.day++;
            threat = Pirates.processDay(game.world, game.player).threat;
            Pirates.state(game.player).infamy = 90;
        }
        expect(threat && threat.kind).toBe('hunters');
        const state = Pirates.startThreat(game.player, game.world, threat);
        expect(Pirates.view(game.player, game.world, state).options.map(o => o.id)).toEqual(['flee', 'fight', 'bribe', 'surrender']);
        game.player.gold = 5000;
        const out = Pirates.act(game.player, game.world, state, 'surrender');
        expect(out.done).toBe(true);
        expect(game.player.gold).toBe(5000 - Pirates.fineAmount({ seaRoving: { infamy: 90 } }));
        expect(Pirates.getInfamy(game.player)).toBeLessThan(90);
    });

    it('unable to pay the hunters, you go to the cells of the nearest port', () => {
        Pirates.state(game.player).infamy = 60;
        game.player.gold = 0;
        const state = Pirates.startThreat(game.player, game.world, { kind: 'hunters', name: 'Commodore Test', strength: 20 });
        Pirates.act(game.player, game.world, state, 'surrender');
        expect(game.player.jailState).toBeTruthy();
        expect(game.player.boardedShip).toBeNull();
        expect(ship.status).toBe('docked');
    });
});

describe('grudges, havens and the sea log', () => {
    it('a captain with a grudge comes looking for you', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        cap.regard = -80;
        let threat = null;
        for (let i = 0; i < 200 && !threat; i++) {
            game.world.day++;
            threat = Pirates.processDay(game.world, game.player).threat;
        }
        expect(threat).toEqual({ kind: 'vengeance', captainId: cap.id });
        const state = Pirates.startThreat(game.player, game.world, threat);
        expect(state.phase).toBe('vengeance');
        expect(Pirates.autoResolve(game.player, game.world, state).notification).toBeTruthy();
    });

    it('a known haven beside the ship can be raided for the rovers\' hoard', () => {
        const st = Pirates.ensure(game.player, game.world);
        const h = st.havens[0];
        h.known = true;
        const water = Hex.neighbors(h.q, h.r).map(n => game.world.getTile(Hex.wrapQ(n.q, game.world.width), n.r)).find(t => t && Ships.isWaterTile(t));
        game.player.q = water.q;
        game.player.r = water.r;
        const tile = game.world.getTile(water.q, water.r);
        expect(PlayerActions.getAvailableActions(game.player, tile, game.world).some(a => a.type === 'raid_haven')).toBe(true);
        let state = Pirates.startHavenRaid(game.player, game.world);
        state = { ...state, enemy: { ...state.enemy, strength: 3, str0: 3 } };
        const gold = game.player.gold;
        let out = null;
        for (let i = 0; i < 40; i++) {
            out = Pirates.act(game.player, game.world, state, 'assault');
            if (out.notification && out.notification.title.includes('Haven Raided')) break;
            ship.condition = 100;
        }
        expect(out.notification.title).toContain('Haven Raided');
        expect(game.player.gold).toBeGreaterThan(gold);
        expect(h.raidedDay).toBe(game.world.day);
        expect(Pirates.havenNear(game.player, game.world)).toBeNull();
    });

    it('the Sea Rovers log lists what you know', () => {
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        cap.met = 1;
        expect(Pirates.hasLog(game.player)).toBe(true);
        const v = Pirates.view(game.player, game.world, { kind: 'log' });
        expect(v.lines.join(' ')).toContain(cap.name);
    });

    it('survives a save and load', () => {
        const st = Pirates.ensure(game.player, game.world);
        st.infamy = 33;
        st.captains[0].regard = -40;
        const back = roundTrip(game);
        expect(back.player.seaRoving.infamy).toBe(33);
        expect(back.player.seaRoving.captains[0].regard).toBe(-40);
        expect(back.player.seaRoving.havens).toEqual(st.havens);
    });
});

describe('exploring the waters', () => {
    it('every sea event and every choice resolves', () => {
        const events = Pirates.data().seaEvents.filter(e => !e.pirate);
        expect(events.length).toBeGreaterThan(4);
        for (const ev of events) {
            for (const o of ev.options) {
                const state = { shipId: ship.id, log: [], kind: 'event', eventId: ev.id, enemy: Array.isArray(ev.enemy) ? ev.enemy[0] : null };
                const v = Pirates.view(game.player, game.world, state);
                expect(v.options.length).toBe(ev.options.length);
                const out = Pirates.act(game.player, game.world, state, o.id);
                expect(out.done, `${ev.id}/${o.id}`).toBe(true);
                expect(out.notification.body.length).toBeGreaterThan(0);
                expect(out.notification.body).not.toMatch(/undefined|NaN/);
                ship.condition = 100;
            }
        }
    });

    it('a bottle can hold a treasure map', () => {
        const maps = (game.player.maps || []).length;
        for (let i = 0; i < 40 && (game.player.maps || []).length === maps; i++) {
            Pirates.act(game.player, game.world, { shipId: ship.id, log: [], kind: 'event', eventId: 'bottle' }, 'open');
        }
        expect(game.player.maps.length).toBe(maps + 1);
        expect(game.player.maps[game.player.maps.length - 1].type).toBe('treasure');
    });

    it('starting an exploration gives a discovery, or a scene', () => {
        const res = Pirates.start(game.player, game.world, 'explore');
        expect(res.state || res.discovery).toBeTruthy();
    });
});

describe('the sea scene UI', () => {
    it('renders every phase and acts through the panel without leaking undefined', () => {
        const html = [];
        const notes = [];
        const g = {
            player: game.player, world: game.world,
            ui: {
                showCustomPanel: (t, h) => html.push(`${t}\n${h}`), hideCustomPanel() {}, updateStats() {},
                showNotification: (t, b) => notes.push(`${t} ${b}`),
            },
            endDay() {},
        };
        const cap = Pirates.ensure(game.player, game.world).captains[0];
        for (const phase of ['sighting', 'vengeance', 'parley', 'battle', 'aftermath_crew', 'aftermath_ship']) {
            ActionMenu.showScene(g, 'sea', { ...battleWith(cap), phase });
        }
        ActionMenu.showScene(g, 'sea', { shipId: ship.id, log: [], kind: 'prey', phase: 'prey_sighting', enemy: Pirates._merchantEnemy(game.player, game.world) });
        ActionMenu.showScene(g, 'sea', { kind: 'log' });
        ActionMenu.sceneAct(g, 'close');
        ActionMenu.showScene(g, 'sea', battleWith(cap, 2));
        for (let i = 0; i < 6 && g._scene; i++) {
            const phase = g._scene.state.phase;
            ActionMenu.sceneAct(g, { battle: 'board', aftermath_crew: 'spare', aftermath_ship: 'leave' }[phase] || 'board');
        }
        expect(html.length).toBeGreaterThan(8);
        for (const h of html.concat(notes)) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
        // doSeaActivity opens a scene or reports the empty sea
        ActionMenu.doSeaActivity(g, 'hunt_pirates');
        ActionMenu.doSeaActivity(g, 'commit_piracy');
        ActionMenu.doSeaActivity(g, 'explore_ocean');
        ActionMenu.doSeaActivity(g, 'sea_rovers');
    });
});
