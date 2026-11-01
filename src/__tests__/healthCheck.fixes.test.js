// Health check 2026-11 (docs/health-check-2026-11.md): the hollow spots the
// re-sweep found in the run-shape systems, fixed —
//   - a forming league charges the terms its letter named, not a re-quote
//   - an interregnum does not run down a forming league's ultimatum
//   - ceding a holding earns the cede's reputation once, not cede + buy-off
//   - the lords' war appetite (threat.personality.*.war) stiffens a league
//   - an informant's leak costs the data's leakResolve
//   - a goal already won survives a change of goal (and switching back)
//   - an heir is not offered the founder's First Steps again
//   - the difficulty's buy prices reach the guild contracts' and factors' quotes;
//     its foes' strength reaches mercenary contracts
//   - a won goal is notable enough for the Annals

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Coalitions } from '../systems/coalitions.js';
import { RealmWars } from '../systems/realmWars.js';
import { Victory } from '../systems/victory.js';
import { FirstSteps } from '../systems/firstSteps.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Annals } from '../systems/annals.js';
import { MercContracts } from '../player/mercContracts.js';
import { Trading } from '../player/playerEconomy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Difficulty } from '../core/difficulty.js';
import { Achievements } from '../systems/achievements.js';
import { Ledger } from '../systems/ledger.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const SEED = 4242;

function weekDay(from) {
    const C = Coalitions.config();
    let d = Math.max(1, from);
    while ((d + C.offset) % C.cadence !== 0) d++;
    return d;
}

function runCoalitions(game, until) {
    while (game.world.day < until) {
        game.world.day++;
        Coalitions.processDay(game.world, game.player, {});
    }
}

function landBeside(world, q, r) {
    for (let rad = 1; rad <= 3; rad++) {
        for (let dq = -rad; dq <= rad; dq++) {
            for (let dr = -rad; dr <= rad; dr++) {
                const t = world.getTile(q + dq, r + dr);
                if (!t || t.settlement || !t.terrain || t.terrain.passable === false || /water|ocean|sea|lake/i.test(t.terrain.id || '')) continue;
                if (Array.isArray(t.playerProperties) && t.playerProperties.length) continue;
                return t;
            }
        }
    }
    return null;
}

/** A league sworn against an overmighty player (as coalitions.test.js does it). */
function swearLeague(game) {
    const { world, player } = game;
    player.allegiance = null;
    for (const k of world.kingdoms.filter(x => x.isAlive && x.capital).slice(0, 3)) {
        const t = landBeside(world, k.capital.q, k.capital.r);
        if (!t) continue;
        t.playerProperties = [{ type: 'farm', level: 2, storage: 0, cost: 500 }];
        player.properties.push({ q: t.q, r: t.r, type: 'farm' });
    }
    player.army = [{ id: 'u1', type: 'infantry', domain: 'land', strength: 2500, level: 1 }];
    player.gold = 120000;
    player.renown = 300;
    player.house.prestige = 400;
    const d1 = weekDay(game.world.day + 1);
    runCoalitions(game, d1);
    runCoalitions(game, weekDay(d1 + 1));
    return Coalitions.active(player);
}

describe('health check 2026-11 — coalitions', () => {
    it('a forming league charges the gold its letter named, however its power has moved since', () => {
        const game = newGame(SEED);
        const c = swearLeague(game);
        expect(c && c.stage).toBe('forming');
        const named = c.terms.gold;
        c.lastPower = c.lastPower * 3 + 500; // the weekly re-reckoning moved on
        expect(Coalitions.concessionQuote(game.player, game.world).gold).not.toBe(named);
        const gold0 = game.player.gold;
        expect(Coalitions.concede(game.player, game.world, 'gold').success).toBe(true);
        expect(gold0 - game.player.gold).toBe(named);
    });

    it('days the House did not tick (an interregnum) do not run down the ultimatum', () => {
        const game = newGame(SEED);
        const c = swearLeague(game);
        const left = c.dueDay - game.world.day;
        expect(left).toBeGreaterThan(1);
        game.world.day += 60; // the world turned on without the player
        Coalitions.processDay(game.world, game.player, {});
        expect(c.stage).toBe('forming');
        expect(c.dueDay - game.world.day).toBe(left - 1);
    });

    it('the lords\' war appetite sets the league\'s starting resolve', () => {
        const game = newGame(SEED);
        const c = swearLeague(game);
        const R = Coalitions.config().resolve;
        const ks = Object.keys(c.members).map(id => game.world.getKingdom(Number(id)) || game.world.getKingdom(id));
        const want = Math.min(R.max, Math.round((R.start + ks.reduce((s, k) => s + R.perMember * Coalitions.warWill(k), 0)) * 10) / 10);
        expect(c.formed).toBe(game.world.day);
        expect(c.resolve).toBeCloseTo(want, 5);
        // ...and the personalities really differ
        const pers = Coalitions.config().threat.personality;
        const k = ks[0];
        expect(Coalitions.warWill(k)).toBe(pers[KingdomAI.personalityId(k)] ? pers[KingdomAI.personalityId(k)].war : 1);
    });

    it('an informant\'s leak costs the league the data\'s leakResolve', () => {
        const game = newGame(SEED);
        const c = swearLeague(game);
        const kid = Coalitions.members(game.player)[0].kingdomId;
        const informant = Coalitions.data().agents.kinds.informant;
        const was = informant.leakResolve;
        try {
            informant.leakResolve = 7;
            c.resolve = 50;
            expect(Coalitions.onAgent(game.player, game.world, kid, 'leak')).toBe(7);
            expect(c.resolve).toBe(57);
        } finally {
            informant.leakResolve = was;
        }
    });

    it('ceding a holding earns the cede\'s reputation once', () => {
        const game = newGame(SEED);
        const c = swearLeague(game);
        const m = Coalitions.members(game.player).find(x => !x.leader);
        const hold = { q: 1, r: 1, name: 'Fennick', kind: 'colony' };
        const cedable = vi.spyOn(Coalitions, 'cedable').mockReturnValue([hold]);
        const capture = vi.spyOn(RealmWars, '_captureHolding').mockImplementation(() => {});
        try {
            game.player.reputation = { [m.kingdomId]: 0 };
            const res = Coalitions.splitMember(game.player, game.world, m.kingdomId, 'cede', '1,1');
            expect(res.success).toBe(true);
            expect(game.player.reputation[m.kingdomId]).toBe(Coalitions.config().cede.reputation);
            expect(c.bought).toContain(m.kingdomId);
        } finally {
            cedable.mockRestore();
            capture.mockRestore();
        }
    });
});

describe('health check 2026-11 — the run\'s shape', () => {
    it('a goal already won survives a change of goal, and switching back does not win it twice', () => {
        const game = newGame(SEED);
        const p = game.player;
        const ids = Object.keys(Victory.defs());
        expect(ids.length).toBeGreaterThan(1);
        Victory.setGoal(p, ids[0]);
        p.scenario.startDay = 0;
        const won = { id: ids[0], name: 'X', day: 50, by: p.name };
        p.scenario.victoryAchieved = won;
        Victory.setGoal(p, ids[1]);
        expect(p.scenario.victoryAchieved).toBeNull();
        expect(p.scenario.pastVictories).toContainEqual(won);
        expect(Victory.wonThisLife(p.scenario, won)).toBe(true);
        Victory.setGoal(p, ids[0]);
        expect(p.scenario.victoryAchieved).toEqual(won);
        expect(Victory.check(p, game.world, { force: true })).toBeNull();
        // A past life's win of the same goal is not this life's
        p.scenario.startDay = 100;
        Victory.setGoal(p, ids[1]);
        Victory.setGoal(p, ids[0]);
        expect(p.scenario.victoryAchieved).toBeNull();
    });

    it('a won goal weighs enough to be told in the Annals', () => {
        expect(Annals.weight(['victory'])).toBeGreaterThanOrEqual(Annals.config().minWeight);
    });

    it('an heir is not offered the founder\'s First Steps again', () => {
        const game = newGame(SEED);
        const p = game.player;
        FirstSteps.skip(p);
        expect(FirstSteps.canResume(p)).toBe(true);
        p.house.generation = (p.house.generation || 1) + 1;
        expect(FirstSteps.canResume(p)).toBe(false);
    });
});

describe('health check 2026-11 — difficulty reaches every quote', () => {
    it('a factor\'s buying quote carries the difficulty\'s prices, as the purchase does', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        Difficulty.state(player);
        let tile = null;
        let entry = null;
        for (const s of world.getSettlementViews()) {
            const t = world.getTile(s.q, s.r);
            entry = t && t.settlement ? Trading.getAvailableGoods(t.settlement, t, world).find(g => g.quantity > 0 && g.price > 20) : null;
            if (entry) { tile = t; break; }
        }
        expect(entry).toBeTruthy();
        player.scenario.difficulty = 'normal';
        const normal = MerchantHouses.factorBuyUnit(player, world, tile, entry.id);
        player.scenario.difficulty = 'brutal';
        const brutal = MerchantHouses.factorBuyUnit(player, world, tile, entry.id);
        expect(brutal).toBeGreaterThan(normal);
        expect(brutal).toBe(Trading.buyCost(player, entry, 1, tile.settlement));
    });

    it('mercenary contracts are won less often against tougher foes', () => {
        const game = newGame(SEED);
        const p = game.player;
        Difficulty.state(p);
        p.scenario.difficulty = 'normal';
        const base = MercContracts.winChance(100, 100, p);
        expect(base).toBe(MercContracts.winChance(100, 100));
        p.scenario.difficulty = 'hard';
        expect(MercContracts.winChance(100, 100, p)).toBeLessThan(base);
        p.scenario.difficulty = 'easy';
        expect(MercContracts.winChance(100, 100, p)).toBeGreaterThan(base);
    });
});

describe('health check 2026-11 — what the audit flagged', () => {
    it("Peacekeeper wants positive relations everywhere, not a stranger's zero", () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const def = Object.values(Achievements.ACHIEVEMENTS || Achievements.achievements || {}).find(a => a && a.id === 'peacekeeper');
        expect(def).toBeTruthy();
        player.reputation = {};
        expect(def.check(player, world)).toBe(false);
        for (const k of world.kingdoms) player.reputation[k.id] = 5;
        expect(def.check(player, world)).toBe(true);
    });

    it("the rackets and the Guildmaster's cut are named ledger categories", () => {
        for (const id of ['racket', 'guild']) {
            expect(Ledger.config().categories[id], id).toBeTruthy();
            expect(Ledger.category(id).group).toBe('labour');
        }
    });
});
