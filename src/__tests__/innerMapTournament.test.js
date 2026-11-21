// Tournaments fought in person on the town's lists (systems/lists.js rules,
// world/innerMap/lists.js the field, ui/innerMapTournament.js the bouts):
// the field placed by hash, a joust pass from timing and skill, the melee
// yielding with nobody hurt past the bracket's harm, the fee / purse / wager
// moving between real purses to the cent, and the old dice path unchanged.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Lists } from '../systems/lists.js';
import { Duels } from '../systems/duels.js';
import { Player } from '../player/player.js';
import { PlayerEffects } from '../player/playerEffects.js';

let InnerMap, InnerMapTournament, InnerMapCombat;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapTournament } = await import('../ui/innerMapTournament.js'));
    ({ InnerMapCombat } = await import('../ui/innerMapCombat.js'));
});

/** A street map W×H of open grass with a road across row `road` and a block of houses. */
function makeTiles(W = 64, H = 44, road = 12) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const t = { q, r, subTerrain: { id: 'grass', passable: true } };
            if (r === road) t.isRoad = true;
            if (q >= 20 && q < 30 && r >= 2 && r < 10) t.building = { type: 'house' };
            row.push(t);
        }
        tiles.push(row);
    }
    return tiles;
}

const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'npcs', 'currentWorldTile', '_currentWorldTileRef', 'timeOfDay'];
const saved = {};
function openTown(settlement, tiles = makeTiles()) {
    for (const k of KEYS) saved[k] = InnerMap[k];
    Object.assign(InnerMap, {
        active: true, tiles, width: tiles[0].length, height: tiles.length, playerInnerQ: 30, playerInnerR: 14,
        _playerWalking: false, _insideBuilding: null, npcs: [], currentWorldTile: { q: 7, r: 9, settlement }, _currentWorldTileRef: { settlement }, timeOfDay: 12,
    });
    InnerMapTournament.reset();
    InnerMapTournament._run = null;
    InnerMapTournament._siteFor = null;
}
afterEach(() => {
    vi.restoreAllMocks();
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
    InnerMapTournament.reset();
    InnerMapTournament._run = null;
    InnerMapTournament._siteFor = null;
});

function makePlayer() {
    const p = new Player();
    Object.assign(p, { name: 'Aldric', q: 7, r: 9, gold: 500, health: 100, maxHealth: 100, renown: 10, inventory: {}, army: [] });
    p.skills = p.skills || {};
    p.skills.combat = 5;
    return p;
}

function makeTown(over = {}) {
    return { id: 77, name: 'Tallow', type: 'town', population: 900, q: 7, r: 9, economy: { gold: 2000 }, folk: { people: [] }, ...over };
}

function makeGame(player, world = {}) {
    return {
        player,
        world: { day: 400, getTile: () => null, getKingdom: () => null, ...world },
        ui: { showNotification() {}, updateStats() {}, showCustomPanel() {}, hideCustomPanel() {} },
    };
}

const r2 = (v) => Math.round(v * 100) / 100;

describe('the lists on the street map', () => {
    it('stand on open ground near the street, the same field for the same map', () => {
        const tiles = makeTiles();
        const a = InnerMap.listsSite(tiles, 7, 9);
        const b = InnerMap.listsSite(makeTiles(), 7, 9);
        expect(a).toBeTruthy();
        expect(b).toEqual(a);
        // Every cell of it open ground: no road, no house, inside the map's margin
        for (let r = a.r0; r < a.r0 + a.h; r++) {
            for (let q = a.q0; q < a.q0 + a.w; q++) {
                const t = tiles[r][q];
                expect(t.isRoad).toBeFalsy();
                expect(t.building).toBeFalsy();
            }
        }
        expect(a.q0).toBeGreaterThanOrEqual(2);
        expect(a.r0 + a.h).toBeLessThanOrEqual(tiles.length - 2);
        // Near the street (within a few paces of the road row)
        expect(Math.min(Math.abs(a.r0 - 12), Math.abs(a.r0 + a.h - 1 - 12))).toBeLessThanOrEqual(4);
        // Its parts in place: lanes either side of the barrier, the herald on the near rail, a pavilion at each end
        expect(a.laneA).toBe(a.barrier - 1);
        expect(a.laneB).toBe(a.barrier + 1);
        expect(InnerMap.onLists(a, a.herald.q, a.herald.r)).toBe(true);
        expect(a.pavilions).toHaveLength(2);
        expect(a.crowd.length).toBeGreaterThan(8);
        // Pure: the tiles are not touched
        expect(JSON.stringify(tiles)).toBe(JSON.stringify(makeTiles()));
    });

    it('find no field where there is no open ground', () => {
        const wet = makeTiles(40, 30);
        for (const row of wet) for (const t of row) { t._wet = true; t.subTerrain.passable = false; }
        expect(InnerMap.listsSite(wet, 1, 1)).toBeNull();
    });
});

describe('the towns\' own tournaments', () => {
    it('are held on hashed days by type, the purse and fee from data', () => {
        const capital = makeTown({ id: 3, type: 'capital' });
        const village = makeTown({ id: 4, type: 'village' });
        let held = 0;
        for (let d = 0; d < 4000; d++) {
            const t = Lists.townTourney(capital, d);
            if (t) {
                held++;
                expect(t.prizePool).toBe(Lists.config().prize.capital);
                expect(t.fee).toBe(Lists.entryFee(t.prizePool));
                expect(Lists.townTourney(capital, d)).toEqual(t);
            }
            expect(Lists.townTourney(village, d)).toBeNull();
        }
        const expected = 4000 / Lists.config().schedule.periodDays * Lists.config().schedule.chance.capital;
        expect(held).toBeGreaterThan(expected * 0.6);
        expect(held).toBeLessThan(expected * 1.4);
    });

    it('the player\'s own tournament today outranks the town\'s, and the herald cries one ahead', () => {
        const s = makeTown({ id: 9, type: 'capital' });
        const p = makePlayer();
        p.lists = { held: { key: Lists.townKey(s), day: 400, prizePool: 900, baseRenown: 5, compete: true } };
        const ev = InnerMapTournament.eventFor(p, s, 400);
        expect(ev.host).toBe('player');
        expect(ev.fee).toBe(0);
        // Some town tournament comes up within its announce window
        let found = null;
        for (let d = 0; d < 400 && !found; d++) {
            const up = Lists.upcoming(s, d);
            if (up && up.inDays > 0) found = { d, up };
        }
        expect(found).toBeTruthy();
        expect(Lists.townTourney(s, found.d + found.up.inDays)).toBeTruthy();
    });
});

describe('the joust', () => {
    it('a strike in the window with the tip steady is a good one; late, early or none is nothing', () => {
        const J = Lists.config().joust;
        const w = 0.07;
        expect(Lists.strikeQuality({ timing: J.impactAt, aim: 0, window: w })).toBeCloseTo(1, 5);
        expect(Lists.strikeQuality({ timing: J.impactAt + w * 0.5, aim: 0, window: w })).toBeGreaterThan(0.8);
        expect(Lists.strikeQuality({ timing: J.impactAt, aim: 0.9, window: w })).toBeLessThan(0.65);
        expect(Lists.strikeQuality({ timing: J.impactAt + w * 5, aim: 0, window: w })).toBe(0);
        expect(Lists.strikeQuality({ timing: null, aim: 0, window: w })).toBe(0);
    });

    it('skill, your own horse and armour widen the window and steady the tip', () => {
        const green = { skill: 1, ownHorse: false, armour: 0 };
        const vet = { skill: 8, ownHorse: true, armour: 0.4 };
        expect(Lists.window(vet)).toBeGreaterThan(Lists.window(green));
        expect(Lists.aimSwing(vet)).toBeLessThan(Lists.aimSwing(green));
    });

    it('a lance\'s force against the seat: miss, glance, broken, unhorsed', () => {
        const strong = { attack: 8, defense: 6, armour: 0.3 };
        const weak = { attack: 2, defense: 2, armour: 0 };
        const mid = () => 0.5;
        expect(Lists.resolveLance(0.1, strong, weak, mid)).toBe('miss');
        expect(Lists.resolveLance(1, strong, weak, () => 0.99)).toBe('unhorsed');
        expect(Lists.resolveLance(0.35, weak, strong, mid)).toBe('glance');
        expect(['broken', 'unhorsed']).toContain(Lists.resolveLance(0.9, strong, { attack: 4, defense: 4, armour: 0.15 }, mid));
    });

    it('a pass from both strikes; an unhorsing wins outright, else best of three on points', () => {
        const me = { attack: 6, defense: 5, armour: 0.2, skill: 6, ownHorse: true };
        const him = { attack: 3, defense: 3, armour: 0.1, skill: 3, ownHorse: true };
        const J = Lists.config().joust;
        const pass = Lists.resolvePass({ rider: me, strike: { timing: J.impactAt, aim: 0 } }, { rider: him, strike: null }, () => 0.5);
        expect(pass.b).toBe('miss');
        expect(pass.a).not.toBe('miss');
        expect(pass.aQ).toBeCloseTo(1, 2);

        const st = Lists.newJoust();
        Lists.scorePass(st, { a: 'glance', b: 'miss', aQ: 0.5, bQ: 0 });
        expect(st.over).toBe(false);
        Lists.scorePass(st, { a: 'unhorsed', b: 'broken', aQ: 1, bQ: 0.7 });
        expect(st.over).toBe(true);
        expect(st.winner).toBe('a');
        const res = Lists.joustResult(st);
        expect(res.playerWon).toBe(true);
        expect(res.kind).toBe('joust');
        // (the broken lance you took is the bracket's harm to you)
        expect(res.aLost).toBeCloseTo(J.harm.broken, 5);

        const st2 = Lists.newJoust();
        for (const p of [{ a: 'glance', b: 'broken' }, { a: 'miss', b: 'glance' }, { a: 'glance', b: 'miss' }]) Lists.scorePass(st2, { ...p, aQ: 0.5, bQ: 0.5 });
        expect(st2.over).toBe(true);
        expect(st2.winner).toBe('b');
        // A tie after three goes to a fourth pass
        const st3 = Lists.newJoust();
        for (const p of [{ a: 'glance', b: 'glance' }, { a: 'miss', b: 'miss' }, { a: 'broken', b: 'broken' }]) Lists.scorePass(st3, { ...p, aQ: 0.5, bQ: 0.5 });
        expect(st3.over).toBe(false);
    });

    it('a better knight strikes truer (AI timing narrows with attack)', () => {
        const J = Lists.config().joust;
        const err = (rider) => {
            const rng = Lists.stream(`ai${rider.attack}`);
            let t = 0;
            for (let i = 0; i < 400; i++) t += Math.abs(Lists.aiStrike(rider, rng).timing - J.impactAt);
            return t / 400;
        };
        expect(err({ attack: 9, skill: 8 })).toBeLessThan(err({ attack: 1, skill: 1 }));
    });
});

describe('the melee in the ring', () => {
    function setup() {
        const s = makeTown();
        openTown(s);
        const player = makePlayer();
        const game = makeGame(player);
        const ev = { ...Lists.townTourney(s, 400) || { key: Lists.townKey(s), day: 400, prizePool: 150, fee: 22, host: 'town' }, day: 400, baseRenown: 0, site: InnerMapTournament.site(), settlement: s };
        InnerMapTournament.enter(game, ev);
        return { s, player, game, ev };
    }

    it('the knight fights as his own profile, yields beaten, and nobody dies', () => {
        const { player, game } = setup();
        const run = InnerMapTournament.run(game);
        expect(run).toBeTruthy();
        expect(InnerMapTournament.startMelee(game)).toBe(true);
        const M = InnerMapTournament._melee;
        const npc = M.npc;
        expect(InnerMap.npcs).toContain(npc);
        expect(npc._taskFoe).toBeTruthy();
        // (squared up within a blow of you)
        expect(Math.max(Math.abs(npc.q - InnerMap.playerInnerQ), Math.abs(npc.r - InnerMap.playerInnerR))).toBeLessThanOrEqual(1);
        expect(InnerMapCombat._attackState && InnerMapCombat._attackState.npc).toBe(npc);
        // (fights with the bracket knight's own numbers)
        expect(Duels.fromNpc(npc).attack).toBeCloseTo(run.field[0].attack, 5);
        // Blows exchanged: you take some, then he yields at the line
        player.health = 70;
        npc._taskFoe.onYield();
        expect(InnerMapTournament._melee).toBeNull();
        expect(InnerMap.npcs).not.toContain(npc);
        expect(player.health).toBe(100);                       // put back: the bracket books the bruises
        expect(run.bouts).toHaveLength(1);
        expect(run.bouts[0].result.playerWon).toBe(true);
        expect(run.bouts[0].result.yielded).toBe('b');
        expect(run.bouts[0].result.aLost).toBeCloseTo(0.3, 5);
        expect(player.lists.bouts[0].won).toBe(true);
    });

    it('floored by him is a lost bout, never a knockout on the street', () => {
        const { player, game } = setup();
        const run = InnerMapTournament.run(game);
        InnerMapTournament.startMelee(game);
        const npc = InnerMapTournament._melee.npc;
        player.health = 0;
        InnerMapCombat._knockOutPlayer(game, npc);
        expect(InnerMapCombat._playerOut).toBeFalsy();
        // (on your feet: your health put back, less the bracket's bruises for a lost bout)
        const harm = Duels.config().tournament.harm;
        expect(player.health).toBeGreaterThanOrEqual(100 - harm[1]);
        expect(player.health).toBeLessThanOrEqual(100);
        expect(run.bouts[0].result.playerWon).toBe(false);
        expect(run.bouts[0].result.yielded).toBe('a');
        expect(player.lists.done).toBe(true);                   // out: the results
    });

    it('you yield yourself when beaten low', () => {
        const { player, game } = setup();
        InnerMapTournament.startMelee(game);
        player.health = Math.floor(player.maxHealth * Lists.config().melee.yieldAt);
        InnerMapTournament.update(0.1, game);
        expect(InnerMapTournament._melee).toBeNull();
        expect(player.lists.done).toBe(true);
        expect(player.health).toBeGreaterThan(0);
    });
});

describe('coin in the lists', () => {
    it('the fee into the town, the purse out of it, the wager to and from the bookie: to the cent', () => {
        const s = makeTown();
        const bookie = { id: 501, name: 'Odo', age: 40, purse: 300 };
        s.folk.people.push(bookie);
        openTown(s);
        InnerMap.npcs = [{ id: 61, name: 'Odo', type: 'merchant', q: 30, r: 16, state: 'idle', _person: bookie }];
        const player = makePlayer();
        const game = makeGame(player);
        const ev = { key: Lists.townKey(s), day: 400, prizePool: 150, fee: Lists.entryFee(150), host: 'town', baseRenown: 0, site: InnerMapTournament.site(), settlement: s };
        const total = () => r2(player.gold + s.economy.gold + bookie.purse);
        const before = total();

        InnerMapTournament.enter(game, ev);
        expect(player.gold).toBe(500 - ev.fee);
        expect(s.economy.gold).toBe(2000 + ev.fee);

        const w = InnerMapTournament.placeWager(game, 25);
        expect(w).toBeTruthy();
        expect(bookie.purse).toBe(325);
        expect(total()).toBe(before);

        // Three bouts won (however fought), then the results
        const run = InnerMapTournament.run(game);
        run.bouts = run.field.map(o => ({ opponent: o, result: { playerWon: true, aLost: 0 } }));
        const gold0 = player.gold, town0 = s.economy.gold;
        const out = InnerMapTournament.finish(game);
        expect(out.champion).toBe(true);
        expect(out.gold).toBe(150);
        expect(s.economy.gold).toBe(town0 - 150);
        const due = Lists.wagerPayout(25, w.odds, true);
        expect(r2(player.gold - gold0)).toBe(r2(150 + due));
        expect(bookie.purse).toBe(r2(325 - due));
        expect(total()).toBe(before);
        expect(Utils.isCents ? Utils.isCents(player.gold) : true).toBe(true);
        expect(player.lists.done).toBe(true);
    });

    it('a capital\'s purse is the crown\'s; a hired destrier is paid to the town', () => {
        const kingdom = { id: 2, name: 'Arn', treasury: 5000, territory: [] };
        const s = makeTown({ type: 'capital', kingdom: 2 });
        openTown(s);
        const player = makePlayer();
        const game = makeGame(player, { getKingdom: (id) => (id === 2 ? kingdom : null) });
        expect(Lists.sponsor(s, game.world)).toBe(kingdom);
        const ev = { key: Lists.townKey(s), day: 400, prizePool: 360, fee: Lists.entryFee(360), host: 'town', baseRenown: 0, site: InnerMapTournament.site(), settlement: s };
        InnerMapTournament.enter(game, ev);
        expect(kingdom.treasury).toBe(5000 + ev.fee);
        const g0 = player.gold, t0 = s.economy.gold;
        expect(InnerMapTournament.startJoust(game, { hire: true })).toBe(true);
        expect(player.gold).toBe(g0 - Lists.config().hireHorse);
        expect(s.economy.gold).toBe(t0 + Lists.config().hireHorse);
        expect(InnerMapTournament.hidesPlayer()).toBe(true);
    });

    it('a pass ridden in person: the strike is read off the meter, the score kept', () => {
        const s = makeTown();
        openTown(s);
        const player = makePlayer();
        const game = makeGame(player);
        const ev = { key: Lists.townKey(s), day: 400, prizePool: 150, fee: 0, host: 'town', baseRenown: 0, site: InnerMapTournament.site(), settlement: s };
        InnerMapTournament.enter(game, ev);
        InnerMapTournament.startJoust(game, { hire: true });
        const J = InnerMapTournament._joust;
        InnerMapTournament.update(1.5, game);                  // ready → the charge
        expect(J.phase).toBe('charge');
        const C = Lists.config().joust;
        InnerMapTournament.update(C.chargeSeconds * C.impactAt, game);
        expect(InnerMapTournament.key(game, { type: 'keydown', key: ' ', preventDefault() {} })).toBe(true);
        expect(J.strike.timing).toBeCloseTo(C.impactAt, 1);
        InnerMapTournament.update(C.chargeSeconds, game);      // the pass is over
        expect(J.phase).toBe('result');
        expect(J.st.passes).toHaveLength(1);
        expect(J.st.passes[0].a).not.toBe('miss');
    });
});

describe('the old dice path still settles it', () => {
    it('Quick Results fights the bracket by instinct exactly as the menu does', () => {
        const s = makeTown();
        openTown(s);
        const ev = { key: Lists.townKey(s), day: 400, prizePool: 150, fee: 0, host: 'town', baseRenown: 0, site: InnerMapTournament.site(), settlement: s };
        // The menu's way, by hand
        const p1 = makePlayer();
        const g1 = makeGame(p1);
        InnerMapTournament.enter(g1, ev);
        const field = InnerMapTournament.run(g1).field;
        Utils.setSeed(4242);
        const want = [];
        for (const opp of field) {
            const r = Duels.autoResolve(Duels.fromPlayer(p1, { mods: PlayerEffects.duelModifiers(p1) }), opp, { mode: 'tournament', playerYieldAt: 0.15 });
            want.push(r.playerWon);
            if (!r.playerWon) break;
        }
        // The lists' Quick Results
        InnerMapTournament.reset();
        InnerMapTournament._run = null;
        const p2 = makePlayer();
        const g2 = makeGame(p2);
        InnerMapTournament.enter(g2, ev);
        const run = InnerMapTournament.run(g2);
        Utils.setSeed(4242);
        const bouts = [];
        const orig = Duels.settleTournament;
        vi.spyOn(Duels, 'settleTournament').mockImplementation((pl, opts) => { bouts.push(...opts.bouts); return orig.call(Duels, pl, opts); });
        InnerMapTournament.quickResults(g2);
        expect(run.field.map(f => f.name)).toEqual(field.map(f => f.name));
        expect(bouts.map(b => b.result.playerWon)).toEqual(want);
        expect(p2.lists.done).toBe(true);
    });
});
