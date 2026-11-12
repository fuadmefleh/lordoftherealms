// Pressure clocks (systems/pressure.js): the world answers a mighty House on a
// cadence that follows its power — a league of the realms
// (systems/coalitions.js), a realm marching on a holding
// (systems/holdingSieges.js), sagas brought to its court (systems/sagas.js) —
// while a weak one is seldom troubled. Plus the coalition leftovers: a league's
// end ends the wars it started; its history keeps why; the Threats panel's
// text follows the league's stage.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Pressure } from '../systems/pressure.js';
import { Coalitions } from '../systems/coalitions.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { RealmWars } from '../systems/realmWars.js';
import { Holdings } from '../systems/holdings.js';
import { Sagas } from '../systems/sagas.js';
import { House } from '../systems/house.js';
import { Quests } from '../systems/quests.js';
import { Relationships } from '../systems/relationships.js';
import { Economy } from '../world/economy.js';
import { World } from '../world/world.js';
import { Player } from '../player/player.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});
afterEach(() => {
    vi.restoreAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function drawsDuring(fn) {
    const base = Utils.getRng();
    let n = 0;
    Utils.setRng(() => { n++; return base(); });
    try { fn(); } finally { Utils.setRng(base); }
    return n;
}

const M = () => Pressure.config().might;
/** A power score that gives this might. */
const scoreFor = (might) => M().floor + might * (M().full - M().floor);

describe('Pressure — the helper', () => {
    it('heat escalates a reign, is capped, cools over the years, and half passes to an heir', () => {
        const H = Pressure.config().heat;
        const cfg = Pressure.clockConfig('coalition');
        const holder = {};
        Pressure.wind(holder, 'coalition', 1, 7, { days: 7, generation: 1 });
        const cold = Pressure.wind(holder, 'coalition', 1, 14, { generation: 1 }).interval;
        for (let i = 0; i < 10; i++) Pressure.spend(holder, 14);
        expect(holder.clock.heat).toBe(H.max);
        const hot = Pressure.wind(holder, 'coalition', 1, 14, { generation: 1 }).interval;
        expect(hot).toBeCloseTo(cfg.fastDays / (1 + H.step * H.max), 0);
        expect(hot).toBeLessThan(cold);
        Pressure.wind(holder, 'coalition', 1, 14 + H.yearDays * 5, { generation: 1 });
        expect(holder.clock.heat).toBeCloseTo(H.max - 5 * H.decayPerYear, 2);
        const before = holder.clock.heat;
        Pressure.wind(holder, 'coalition', 1, 14 + H.yearDays * 5, { generation: 2 });
        expect(holder.clock.heat).toBeCloseTo(before * H.heirKeep, 2);
        // a century later it is cold again
        Pressure.wind(holder, 'coalition', 1, 14 + H.yearDays * 100, { generation: 2 });
        expect(holder.clock.heat).toBe(0);
    });

    it('reads its tuning from data/coalitions.json → pressure', () => {
        const data = DataLoader._gamedata.coalitions.pressure;
        expect(data).toBeTruthy();
        expect(Pressure.config().might.full).toBe(data.might.full);
        expect(Pressure.clockConfig('coalition').slowDays).toBe(data.clocks.coalition.slowDays);
    });

    it('might runs 0 → 1 from floor to full; a stale reckoning counts as none', () => {
        expect(Pressure.mightOf(0)).toBe(0);
        expect(Pressure.mightOf(M().floor)).toBe(0);
        expect(Pressure.mightOf(M().full)).toBe(1);
        expect(Pressure.mightOf(9999)).toBe(1);
        const mid = Pressure.mightOf((M().floor + M().full) / 2);
        expect(mid).toBeCloseTo(0.5, 2);
        const player = { coalitions: { power: { day: 100, score: M().full } } };
        expect(Pressure.might(player, { day: 110 }).might).toBe(1);
        expect(Pressure.might(player, { day: 100 + M().staleDays + 1 }).might).toBe(0);
        expect(Pressure.might({}, { day: 5 }).might).toBe(0);
    });

    it('the interval shortens as might grows, and is endless below minMight', () => {
        const cfg = Pressure.clockConfig('coalition');
        expect(Pressure.interval(cfg.minMight / 2, cfg)).toBe(Infinity);
        const a = Pressure.interval(cfg.minMight, cfg);
        const b = Pressure.interval(0.6, cfg);
        const c = Pressure.interval(1, cfg);
        expect(a).toBeCloseTo(cfg.slowDays, 5);
        expect(c).toBeCloseTo(cfg.fastDays, 5);
        expect(b).toBeLessThan(a);
        expect(c).toBeLessThan(b);
    });

    it('a clock winds, ripens near its interval, is spent, and drains when the House is weak — drawing no RNG', () => {
        const holder = {};
        const cfg = Pressure.clockConfig('coalition');
        let ripeDay = null;
        const n = drawsDuring(() => {
            for (let day = 7; day <= 2000 && ripeDay == null; day += 7) {
                if (Pressure.wind(holder, 'coalition', 1, day, { days: 7, seed: 3 }).ripe) ripeDay = day;
            }
        });
        expect(n).toBe(0);
        expect(ripeDay).toBeGreaterThan(cfg.fastDays * (1 - cfg.jitter) - 14);
        expect(ripeDay).toBeLessThan(cfg.fastDays * (1 + cfg.jitter) + 14);
        Pressure.spend(holder, ripeDay);
        expect(holder.clock.charge).toBe(0);
        expect(holder.clock.fired).toBe(1);
        expect(holder.clock.heat).toBe(1); // each firing escalates the next
        // weak: nothing gathers; what had gathered drains
        Pressure.wind(holder, 'coalition', 1, ripeDay + 70, { seed: 3 });
        const had = holder.clock.charge;
        expect(had).toBeGreaterThan(0);
        Pressure.wind(holder, 'coalition', 0, ripeDay + 140, { seed: 3 });
        expect(holder.clock.charge).toBeLessThan(had);
        // paused: neither winds nor drains
        const before = holder.clock.charge;
        Pressure.wind(holder, 'coalition', 1, ripeDay + 300, { seed: 3, paused: true });
        expect(holder.clock.charge).toBe(before);
    });
});

// ── Coalitions on the clock ─────────────────────────────────────────

/** Stub the weekly reckoning: the player's power is `score`, the given realms bear `hostility`. */
function stubReckoning(world, score, hostility, n = 3) {
    const realms = world.kingdoms.filter(k => k.isAlive && k.capital).slice(0, n);
    vi.spyOn(Coalitions, 'power').mockImplementation(() => ({ score, parts: { towns: score }, realm: null }));
    vi.spyOn(Coalitions, 'assessAll').mockImplementation(() => realms.map(k => ({
        kingdomId: k.id, name: k.name, fear: hostility, envy: 0, grudge: 0, vendetta: 0, generations: 0, hostility, prox: 1, reasons: [],
    })));
    return realms;
}

function runWeeks(game, days) {
    const { world, player } = game;
    const out = { formed: [], notices: [] };
    const end = world.day + days;
    while (world.day < end) {
        world.day++;
        const r = Coalitions.processDay(world, player);
        if (r.formed) out.formed.push({ day: world.day, c: r.formed });
        out.notices.push(...r.notices);
        // a sworn league is answered at once (paid off) so the clock can run again
        if (r.formed) Coalitions._end(player, world, 'appeased', 'test', null, { endWars: true });
    }
    return out;
}

describe('Coalitions — the courts tire of a rising House', () => {
    it('a middling House, short of formAt, still draws a league on the clock — at the lesser grudge bar', () => {
        const game = newGame(4242);
        game.player.allegiance = null;
        const C = Coalitions.config();
        const score = scoreFor(0.6);
        expect(score).toBeLessThan(Coalitions.formThreshold(game.player));
        // hostility enough for the primed bar, not for the usual one
        const hostility = Math.ceil(C.joinAt * Pressure.clockConfig('coalition').joinShare) + 1;
        expect(hostility).toBeLessThan(C.joinAt);
        stubReckoning(game.world, score, hostility);
        const res = runWeeks(game, 3600); // 30 years
        expect(res.formed.length).toBeGreaterThanOrEqual(2);
        expect(res.formed[0].c.via).toBe('pressure');
        // a believable cadence: no closer than the cooldown plus the clock
        for (let i = 1; i < res.formed.length; i++) expect(res.formed[i].day - res.formed[i - 1].day).toBeGreaterThanOrEqual(C.cooldown.appeased);
        // the envoys rode first
        expect(res.notices.some(n => n.title === 'Envoys on the Roads')).toBe(true);
        expect(Coalitions.state(game.player).history[0].via).toBe('pressure');
    });

    it('a mightier House draws them sooner; a weak one never', () => {
        const first = (might) => {
            const game = newGame(4242);
            game.player.allegiance = null;
            stubReckoning(game.world, scoreFor(might), 30);
            const res = runWeeks(game, 2400);
            vi.restoreAllMocks();
            return res.formed.length ? res.formed[0].day : Infinity;
        };
        const strong = first(0.95);
        const middling = first(0.4);
        const weak = first(0.1);
        expect(strong).toBeLessThan(middling);
        expect(middling).toBeLessThan(Infinity);
        expect(weak).toBe(Infinity);
    });
});

// ── A league's end ends its wars ────────────────────────────────────

describe('Coalitions — the leftovers', () => {
    function strongGame() {
        const game = newGame(4242);
        const { world, player } = game;
        player.allegiance = null;
        const realms = world.kingdoms.filter(k => k.isAlive && k.capital).slice(0, 3);
        // a holding so the members can make war on it
        for (const k of realms) {
            for (let dq = 1; dq < 4; dq++) {
                const t = world.getTile(k.capital.q + dq, k.capital.r);
                if (t && !t.settlement && t.terrain && t.terrain.passable !== false && !/water|ocean|sea|lake/i.test(t.terrain.id || '')) {
                    t.playerProperties = [{ type: 'farm', level: 2, storage: 0, cost: 500 }];
                    player.properties.push({ q: t.q, r: t.r, type: 'farm' });
                    break;
                }
            }
        }
        return { game, realms };
    }

    it('a league humbled ends the wars it started, but a member\'s own older war runs on', () => {
        const { game, realms } = strongGame();
        const { world, player } = game;
        stubReckoning(world, 400, 80);
        // the second realm was at war with the player before the league
        const prior = realms[1];
        RealmWars.declareWar(player, world, prior, 'an old quarrel');
        let c = null;
        while (!c && world.day < 400) { world.day++; c = Coalitions.processDay(world, player).formed || c; }
        expect(c).toBeTruthy();
        Coalitions.defy(player, world);
        const members = Coalitions.members(player);
        const started = members.filter(m => !m.priorWar && RealmWars.atWarWith(player, m.kingdomId));
        expect(started.length).toBeGreaterThan(0);
        expect(members.find(m => m.kingdomId === prior.id).priorWar).toBe(true);
        Coalitions._end(player, world, 'humbled', 'you no longer tower over them', { notices: [] });
        for (const m of started) expect(RealmWars.atWarWith(player, m.kingdomId)).toBe(false);
        expect(RealmWars.atWarWith(player, prior.id)).toBe(true);
        // and the levy is lifted
        expect(Coalitions.active(player)).toBeNull();
    });

    it('a league broken down to one member ends that member\'s league war too', () => {
        const { game } = strongGame();
        const { world, player } = game;
        stubReckoning(world, 400, 80, 2);
        let c = null;
        while (!c && world.day < 400) { world.day++; c = Coalitions.processDay(world, player).formed || c; }
        Coalitions.defy(player, world);
        const [a, b] = Coalitions.members(player);
        expect(RealmWars.atWarWith(player, b.kingdomId)).toBe(true);
        player.gold = 1e6;
        const res = Coalitions.splitMember(player, world, a.kingdomId, 'gold');
        expect(res.success).toBe(true);
        expect(Coalitions.active(player)).toBeNull();
        expect(RealmWars.atWarWith(player, a.kingdomId)).toBe(false);
        expect(RealmWars.atWarWith(player, b.kingdomId)).toBe(false);
        const h = Coalitions.state(player).history[0];
        expect(h.how).toBe('broken');
        expect(h.why).toBe('you split its members apart');
        expect(h.casusBelli).toBeTruthy();
        expect(h.cb).toBeTruthy();
        expect(Number.isFinite(h.activeDay)).toBe(true);
        expect(h.left).toEqual([{ name: a.name, why: 'bought out', day: world.day }]);
    });

    it('the Threats panel follows the league\'s stage, and Past leagues say why', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { game } = strongGame();
        const { world, player } = game;
        stubReckoning(world, 400, 80, 2);
        let c = null;
        while (!c && world.day < 400) { world.day++; c = Coalitions.processDay(world, player).formed || c; }
        let html = '';
        const g = { player, world, ui: { showCustomPanel: (t, h) => { html = h; }, showNotification() {}, updateStats() {} } };
        ActionMenu.showThreatsPanel(g);
        expect(html).toContain('refuses to receive you');
        expect(html).toContain('If it marches');
        expect(html).not.toMatch(/Its members levy \d+% on what you sell in their towns, cancel your licences, and their lords will not receive you/);
        Coalitions.defy(player, world);
        ActionMenu.showThreatsPanel(g);
        expect(html).toMatch(/Its members levy \d+% on what you sell/);
        expect(html).toContain(`At war since day ${world.day}`);
        player.gold = 1e6;
        Coalitions.splitMember(player, world, Coalitions.members(player)[0].kingdomId, 'gold');
        ActionMenu.showThreatsPanel(g);
        expect(html).toContain('Past leagues');
        expect(html).toContain('you split its members apart');
        expect(html).toContain('bought out');
        expect(html).toContain(`marched day ${world.day}`);
    }, 120000);
});

// ── Holding sieges on the clock ─────────────────────────────────────

/** Plains, a kingdom k1 with a town at (12,12), our colony at (5,5). */
function siegeWorld(day = 7) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, treasury: 500, territory: [{ q: 12, r: 12 }], population: 5000, lord: { name: 'Lord Varr', memory: [] } };
    tiles.get('12,12').settlement = { name: 'Varrholt', type: 'town', q: 12, r: 12, kingdom: 'k1', population: 2000 };
    return {
        day, width: 16, kingdoms: [kingdom], units: [], events: [], generationParams: { seed: 7 },
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
}

function siegePlayer(world, score, hostility = 30) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male',
        gold: 10000, renown: 20, karma: 0, reputation: { k1: 0 }, properties: [], colonies: [], children: [],
        inventory: { bread: 100 }, army: [], q: 0, r: 0, taxRate: 'moderate',
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    const settlement = {
        name: 'Newhope', type: 'village', population: 400, level: 1, kingdom: null, happiness: 60,
        colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 10 },
    };
    Economy.initSettlement(settlement);
    world.getTile(5, 5).settlement = settlement;
    player.colonies.push({ q: 5, r: 5, name: 'Newhope', foundedDay: 0 });
    Holdings.processDay(player, world);
    player.coalitions = { power: { day: world.day, score }, realms: { k1: { hostility } } };
    return player;
}

/** Run only the siege clock (and the reckoning's freshness) for `days`. */
function siegeDays(world, player, days, each = null) {
    const notices = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        player.coalitions.power.day = world.day;
        notices.push(...HoldingSieges.processDay(world, player).notices);
        if (each) each();
    }
    return notices;
}

describe('HoldingSieges — a mighty House draws sieges', () => {
    it('ripe, a hostile realm at peace demands tribute for the holding, then marches on it when refused', () => {
        const world = siegeWorld();
        const player = siegePlayer(world, M().full);
        const notices = siegeDays(world, player, 400, () => {
            // refused: the ultimatum runs out and RealmWars declares (as its daily tick does)
            const u = player.realmWars && player.realmWars.ultimatums && player.realmWars.ultimatums.k1;
            if (u && world.day >= u.dueDay) RealmWars.declareWar(player, world, world.kingdoms[0], 'ultimatum ignored');
            return null;
        });
        const covets = notices.findIndex(n => /Covets Newhope/.test(n.title));
        const marches = notices.findIndex(n => /Marches on Newhope/.test(n.title));
        expect(covets).toBeGreaterThanOrEqual(0);
        expect(marches).toBeGreaterThan(covets);
        const war = player.realmWars.wars.k1;
        const host = war.hosts.find(h => h.aimed);
        expect(host).toBeTruthy();
        expect(host.targetQ).toBe(5);
        expect(host.target.kind).toBe('colony');
        expect(world.units.some(u => u.id === host.id)).toBe(true);
    });

    it('at war, the realm sends a host straight at the holding; the cooldown keeps it from spamming', () => {
        const world = siegeWorld();
        const player = siegePlayer(world, M().full);
        RealmWars.declareWar(player, world, world.kingdoms[0], 'test');
        player.realmWars.wars.k1.lastHostDay = 1e9; // (RealmWars' own hosts are not ticked here)
        const notices = siegeDays(world, player, 1800, () => {
            // hosts that marched go home again, so only the clock's cooldown spaces them
            player.realmWars.wars.k1.hosts = [];
            world.kingdoms[0].military = 1000;
        });
        const marches = notices.filter(n => /Marches on Newhope/.test(n.title));
        const PC = Pressure.clockConfig('siege');
        expect(marches.length).toBeGreaterThanOrEqual(2);
        const H = Pressure.config().heat;
        expect(marches.length).toBeLessThanOrEqual(Math.ceil(1800 / (PC.cooldownDays + PC.fastDays * (1 - PC.jitter) / (1 + H.step * H.max))) + 1);
    });

    it('a weak House is left alone, and nothing is drawn from the RNG', () => {
        const world = siegeWorld();
        const player = siegePlayer(world, M().floor);
        let notices = [];
        const n = drawsDuring(() => { notices = siegeDays(world, player, 720); });
        expect(n).toBe(0);
        expect(notices).toEqual([]);
        expect(Object.keys(player.realmWars.ultimatums || {})).toEqual([]);
    });

    it('a House with no holding to besiege keeps no siege clock at all', () => {
        const world = siegeWorld();
        const player = siegePlayer(world, M().full);
        player.colonies = [];
        world.getTile(5, 5).settlement = null;
        player.realmWars = undefined;
        siegeDays(world, player, 60);
        expect(player.realmWars).toBeUndefined();
    });
});

// ── Sagas on the clock ──────────────────────────────────────────────

function sagaGame(score) {
    Utils.setSeed(4242);
    const w = new World(80, 60);
    w.generate({ kingdomCount: 10, seed: 4242 });
    w.day = 1;
    const p = new Player({ firstName: 'Saga', lastName: 'Tester', gender: 'female', age: 25 });
    p.placeInWorld(w);
    Quests.initialize(p);
    House.initialize(p, w);
    p.gold = 5000;
    p.inventory = { food: 100 };
    p.army = [];
    // far from everything, so only the court hook can bring word
    p.q = -999; p.r = -999;
    p.coalitions = { power: { day: 1, score } };
    return { w, p };
}

function sagaDays(w, p, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        w.day++;
        w.events = [];
        p.coalitions.power.day = w.day;
        notices.push(...Sagas.processDay(w, p).notices);
    }
    return notices;
}

describe('Sagas — the stage grows with the House', () => {
    it('a mighty House sees more sagas, and word of them is brought to its court', () => {
        const strong = sagaGame(M().full);
        const strongNotices = sagaDays(strong.w, strong.p, 500);
        const weak = sagaGame(M().floor);
        sagaDays(weak.w, weak.p, 500);
        const s = Sagas.state(strong.p).stats.started;
        const w = Sagas.state(weak.p).stats.started;
        expect(s).toBeGreaterThan(w);
        const hooked = [...Sagas.state(strong.p).active, ...Sagas.state(strong.p).done].filter(x => x.hooked);
        expect(hooked.length).toBeGreaterThan(0);
        expect(strongNotices.some(n => /Word is brought to your court/.test(n.text))).toBe(true);
        expect([...Sagas.state(weak.p).active, ...Sagas.state(weak.p).done].some(x => x.hooked)).toBe(false);
    });

    it('a mighty House may have one more saga running at once', () => {
        const { w, p } = sagaGame(M().full);
        const cfg = Sagas.config();
        let most = 0;
        for (let i = 0; i < 600; i++) {
            sagaDays(w, p, 1);
            most = Math.max(most, Sagas.state(p).active.length);
        }
        expect(most).toBeLessThanOrEqual(cfg.maxActive + 1);
    });
});
