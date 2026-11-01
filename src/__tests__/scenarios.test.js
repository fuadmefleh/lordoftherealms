// Origins, difficulty and victory goals (player/scenarios.js, core/difficulty.js,
// systems/victory.js): each origin shapes the player through the real systems,
// the Wanderer on Normal changes nothing, each difficulty knob moves the number
// it is read into, the goals are detected from real state, and the record
// survives save/load (old saves backfill) and carries into heirs and new lives.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Difficulty } from '../core/difficulty.js';
import { Scenarios } from '../player/scenarios.js';
import { Victory } from '../systems/victory.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Throne } from '../systems/throne.js';
import { Guilds } from '../systems/guilds.js';
import { Pirates } from '../systems/pirates.js';
import { Ships } from '../systems/ships.js';
import { Finance } from '../systems/finance.js';
import { RealmWars } from '../systems/realmWars.js';
import { Ailments } from '../systems/ailments.js';
import { Relationships } from '../systems/relationships.js';
import { Afterlife } from '../player/afterlife.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { Trading } from '../player/playerEconomy/trading.js';

beforeAll(async () => {
    await loadData();
});

/** A market town of the world, with its tile. */
function aMarket(world) {
    for (const v of world.getSettlementViews()) {
        const tile = world.getTile(v.q, v.r);
        if (tile && tile.settlement && ['town', 'city', 'capital'].includes(tile.settlement.type)) return { tile, s: tile.settlement };
    }
    return null;
}

describe('the Wanderer on Normal', () => {
    it('sets only the light purse and draws no randomness', () => {
        const a = newGame(41);
        const b = newGame(41);
        const report = Scenarios.apply(b.player, b.world, {});
        expect(report.origin).toBe('wanderer');
        expect(Utils.random()).toBeTypeOf('number');
        const sa = SaveLoad.serializePlayer(a.player);
        const sb = SaveLoad.serializePlayer(b.player);
        delete sb.scenario;
        // A few coins and the open road (data/scenarios.json), whatever the player was made with
        expect(sb.gold).toBe(250);
        delete sa.gold;
        delete sb.gold;
        expect(sb).toEqual(sa);
        expect(b.player.scenario).toMatchObject({ id: 'wanderer', difficulty: 'normal', victory: 'none', guidedStart: true });
        expect(report.welcome).toContain('You are a wanderer');
    }, 60000);

    it('leaves the shared RNG stream where it was', () => {
        const a = newGame(42);
        const ra = Utils.random();
        const b = newGame(42);
        Scenarios.apply(b.player, b.world, { origin: 'wanderer', difficulty: 'normal' });
        expect(Utils.random()).toBe(ra);
    }, 60000);

    it('Normal is 1 on every knob, whatever the data says', () => {
        const lvl = Difficulty.levels().normal;
        for (const k of Difficulty.KNOBS) expect(lvl[k]).toBe(1);
        expect(Difficulty.mult({}, 'buyPrice')).toBe(1);
        expect(Difficulty.mult(null, 'hostility')).toBe(1);
    });
});

describe('origins', () => {
    it('the Disinherited: a weak blood claim, Prestige, little gold, a feuding elder sibling', () => {
        const g = newGame(51);
        const r = Scenarios.apply(g.player, g.world, { origin: 'disinherited', victory: 'crown' });
        const p = g.player;
        const kid = p.scenario.realm;
        expect(kid).toBeDefined();
        expect(Throne.claimStrength(p, kid)).toBe(18);
        expect(Throne.claims(p, g.world)[0].sources.map(s => s.id)).toContain('blood');
        expect(p.gold).toBe(400);
        expect(p.house.prestige).toBeGreaterThanOrEqual(30);
        expect(p.house.rivals[kid].feud).toBe(55);
        expect(p.house.rivals[kid].name).toMatch(/your elder (brother|sister)/);
        expect(g.world.getTile(p.q, p.r).settlement.kingdom).toBe(kid);
        expect(p.scenario.guidedStart).toBe(false);
        expect(r.welcome).not.toMatch(/\{\w+\}/);
    }, 60000);

    it('the Guild Journeyman: a journeyman of a town guild, an indenture paid weekly, stock in the packs', () => {
        const g = newGame(52);
        const r = Scenarios.apply(g.player, g.world, { origin: 'apprentice' });
        const p = g.player;
        const st = Guilds.state(p);
        const m = Object.values(st.memberships)[0];
        expect(m).toBeDefined();
        expect(m.rank).toBe(1);
        expect(p.q).toBe(m.q);
        const loan = st.loans.find(l => l.indenture);
        expect(loan).toMatchObject({ owed: 600, weekly: 50 });
        expect(p.gold).toBe(300);
        expect(p.skills.commerce).toBe(4);
        const s = g.world.getTile(m.q, m.r).settlement;
        expect(Guilds.rankOf(p, s, m.guild)).toBe(1);
        expect(r.welcome).not.toMatch(/\{\w+\}/);
        // A week on, the guild has taken its due
        for (let d = 0; d < 8; d++) endDay(g);
        const after = Guilds.state(p).loans.find(l => l.indenture);
        expect(!after || after.owed < 600).toBe(true);
    }, 120000);

    it('the Exiled Monarch: a strong claim, a disputed succession, loyal swords, gold to raise the banners', () => {
        const g = newGame(53);
        Scenarios.apply(g.player, g.world, { origin: 'exiled_monarch' });
        const p = g.player;
        const kid = p.scenario.realm;
        expect(Throne.claimStrength(p, kid)).toBe(45);
        expect(Throne.crisisFor(p, kid)).toBeTruthy();
        expect(p.army.length).toBe(5);
        const armyStrength = PlayerMilitary.getArmyStrength(p);
        expect(Throne.canPress(p, g.world, kid, { armyStrength }).ok).toBe(true);
        expect(g.world.getTile(p.q, p.r).settlement.kingdom).not.toBe(kid);
        expect(p.title).toContain('Exiled Monarch');
    }, 60000);

    it("the Pirate's Widow: a crewed sloop at a port, infamy at sea", () => {
        const g = newGame(54);
        Scenarios.apply(g.player, g.world, { origin: 'pirate_widow' });
        const p = g.player;
        expect(p.ships.length).toBe(1);
        const ship = p.ships[0];
        expect(ship.typeId).toBe('sloop');
        expect(ship.crew).toBe(Ships.getShipEffectiveStats(ship).crewRequired);
        expect(Ships.crewSailReason(ship)).toBeFalsy();
        expect(Ships.isPortTile(g.world, p.q, p.r)).toBe(true);
        expect(Pirates.getInfamy(p)).toBe(20);
    }, 60000);

    it('the Sellsword Captain: a company drawing wages, a crown debt paid daily', () => {
        const g = newGame(55);
        Scenarios.apply(g.player, g.world, { origin: 'sellsword', victory: 'conqueror' });
        const p = g.player;
        expect(p.army.length).toBe(6);
        const loan = Finance.state(p).loans[0];
        expect(loan).toMatchObject({ totalOwed: 1500 });
        expect(loan.dailyPayment).toBeGreaterThan(0);
        const k = g.world.getTile(p.q, p.r).settlement.kingdom;
        expect(p.mercRep[k]).toBe(15);
        for (let d = 0; d < 3; d++) endDay(g);
        expect(Finance.state(p).loans[0].totalOwed).toBeLessThan(1500);
    }, 120000);

    it('every origin applies on another world and the days run on', () => {
        for (const id of Object.keys(Scenarios.origins())) {
            const g = newGame(60);
            expect(() => Scenarios.apply(g.player, g.world, { origin: id, difficulty: 'hard', victory: 'dynasty' })).not.toThrow();
            expect(g.player.scenario).toMatchObject({ id, difficulty: 'hard', victory: 'dynasty' });
            for (let d = 0; d < 2; d++) endDay(g);
        }
    }, 240000);
});

describe('difficulty knobs', () => {
    it('scales the starting purse', () => {
        const g = newGame(61);
        Scenarios.apply(g.player, g.world, { difficulty: 'hard' });
        expect(g.player.gold).toBe(Math.round(250 * 0.6));
        const b = newGame(61);
        Scenarios.apply(b.player, b.world, { difficulty: 'brutal' });
        expect(b.player.gold).toBe(Math.round(250 * 0.3));
        const e = newGame(61);
        Scenarios.apply(e.player, e.world, { origin: 'disinherited', difficulty: 'easy' });
        expect(e.player.gold).toBe(600);
    }, 60000);

    it('moves market prices both ways', () => {
        const g = newGame(62);
        const p = g.player;
        const { tile, s } = aMarket(g.world);
        const entry = Trading.getAvailableGoods(s, tile, g.world).find(e => e.quantity > 3 && e.basePrice > 0);
        expect(entry).toBeDefined();
        p.scenario = { ...Difficulty.blank(), difficulty: 'normal' };
        const buyN = Trading.buyCost(p, entry, 3, s);
        const sellN = Trading.saleUnitPrice(p, entry, s, null, 1, 1);
        p.scenario.difficulty = 'brutal';
        expect(Trading.buyCost(p, entry, 3, s)).toBeGreaterThan(buyN);
        expect(Trading.saleUnitPrice(p, entry, s, null, 1, 1)).toBeCloseTo(sellN * 0.85, 6);
        p.scenario.difficulty = 'easy';
        expect(Trading.buyCost(p, entry, 3, s)).toBeLessThan(buyN);
    }, 60000);

    it('makes realms more or less hostile', () => {
        const g = newGame(63);
        const p = g.player;
        const k = g.world.kingdoms.find(x => x.isAlive && x.id !== p.allegiance);
        p.reputation[k.id] = -50;
        p.scenario = { ...Difficulty.blank() };
        const n = RealmWars.hostility(p, k, g.world.day);
        p.scenario.difficulty = 'hard';
        expect(RealmWars.hostility(p, k, g.world.day)).toBeCloseTo(n * 1.3, 6);
        p.scenario.difficulty = 'easy';
        expect(RealmWars.hostility(p, k, g.world.day)).toBeCloseTo(n * 0.6, 6);
    }, 60000);

    it('makes foes stronger in the field', () => {
        const g = newGame(64);
        const p = g.player;
        for (let i = 0; i < 3; i++) p.army.push(PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')));
        p.scenario = { ...Difficulty.blank() };
        const enemy = { strength: 30, name: 'Bandits' };
        const a = FieldBattle.start(p, enemy, g.world, {});
        p.scenario.difficulty = 'brutal';
        const b = FieldBattle.start(p, enemy, g.world, {});
        expect(b.eMult).toBeCloseTo(a.eMult * 1.4, 6);
    }, 60000);

    it('makes sickness more or less deadly', () => {
        const g = newGame(65);
        const p = g.player;
        p.scenario = { ...Difficulty.blank() };
        const n = Ailments.careFactor(p, g.world).mult;
        p.scenario.difficulty = 'hard';
        expect(Ailments.careFactor(p, g.world).mult).toBeCloseTo(n * 1.3, 6);
        expect(Ailments.careFactor(p, g.world).parts).toContain('a cruel world');
    }, 60000);
});

describe('victory goals', () => {
    it('a sandbox game never wins', () => {
        const g = newGame(71);
        Scenarios.apply(g.player, g.world, {});
        expect(Victory.check(g.player, g.world, { force: true })).toBeNull();
    }, 60000);

    it('Wear a Crown: won when the player rules a kingdom, once', () => {
        const g = newGame(72);
        const p = g.player;
        Scenarios.apply(p, g.world, { victory: 'crown' });
        expect(Victory.check(p, g.world)).toBeNull();
        const k = g.world.kingdoms.find(x => x.isAlive);
        Throne.state(p).ruling = { kingdomId: k.id, since: 0, policies: {}, levyTotal: 0, peaceCooldown: {} };
        const won = Victory.check(p, g.world);
        expect(won).toMatchObject({ id: 'crown' });
        expect(p.scenario.victoryAchieved.id).toBe('crown');
        expect(Victory.check(p, g.world)).toBeNull();
        expect(p.house.history.some(h => (h.tags || []).includes('victory'))).toBe(true);
    }, 60000);

    it('Merchant Prince reads net worth (weekly)', () => {
        const g = newGame(73);
        const p = g.player;
        Scenarios.apply(p, g.world, { victory: 'merchant_prince' });
        expect(Victory.progress(p, g.world).pct).toBeLessThan(1);
        p.gold = 200000;
        expect(Victory.check(p, g.world, { force: true })).toMatchObject({ id: 'merchant_prince' });
    }, 60000);

    it('Dynasty reads the House generations', () => {
        const g = newGame(74);
        const p = g.player;
        Scenarios.apply(p, g.world, { victory: 'dynasty' });
        expect(Victory.check(p, g.world)).toBeNull();
        p.house.generation = 4;
        expect(Victory.check(p, g.world)).toMatchObject({ id: 'dynasty' });
    }, 60000);

    it('Conqueror reads the settlements held; Monopolist reads monopolies held', () => {
        const g = newGame(75);
        const p = g.player;
        Scenarios.apply(p, g.world, { victory: 'conqueror' });
        const views = g.world.getSettlementViews().slice(0, 8);
        p.settlements = views.map(v => ({ q: v.q, r: v.r }));
        expect(Victory.check(p, g.world)).toMatchObject({ id: 'conqueror' });

        const h = newGame(76);
        Scenarios.apply(h.player, h.world, { victory: 'monopoly' });
        expect(Victory.check(h.player, h.world, { force: true })).toBeNull();
        for (const v of h.world.getSettlementViews().slice(0, 3)) {
            const s = h.world.getTile(v.q, v.r).settlement;
            s.monopolies = { ...(s.monopolies || {}), salt: { holder: 'player', holderName: 'Your company', sinceDay: 0, untilDay: null } };
        }
        expect(Victory.monopolies(h.player, h.world).length).toBe(3);
        expect(Victory.check(h.player, h.world, { force: true })).toMatchObject({ id: 'monopoly' });
    }, 60000);

    it('the goal can be chosen or changed mid-game', () => {
        const g = newGame(77);
        Scenarios.apply(g.player, g.world, {});
        expect(Victory.setGoal(g.player, 'dynasty').success).toBe(true);
        expect(g.player.scenario.victory).toBe('dynasty');
        expect(Victory.setGoal(g.player, 'nope').success).toBe(false);
    }, 60000);
});

describe('persistence and succession', () => {
    it('the scenario survives save and load', () => {
        const g = newGame(81);
        Scenarios.apply(g.player, g.world, { origin: 'sellsword', difficulty: 'hard', victory: 'conqueror' });
        const back = roundTrip(g);
        expect(back.player.scenario).toMatchObject({ id: 'sellsword', difficulty: 'hard', victory: 'conqueror', guidedStart: false });
        expect(Difficulty.mult(back.player, 'hostility')).toBe(1.3);
    }, 120000);

    it('an old save is the Wanderer on Normal with no goal', () => {
        const g = newGame(82);
        delete g.player.scenario;
        const back = roundTrip(g);
        expect(back.player.scenario).toMatchObject({ id: 'wanderer', difficulty: 'normal', victory: 'none', victoryAchieved: null });
    }, 120000);

    it('an heir keeps the difficulty and the goal', () => {
        const g = newGame(83);
        const p = g.player;
        Scenarios.apply(p, g.world, { difficulty: 'brutal', victory: 'dynasty' });
        const child = Relationships.generateChild(p, { culture: 'Imperial' }, g.world);
        child.age = Relationships._getHeirSettings().minAgeToPlay;
        const res = Relationships.succeedAsHeir(p, child.id, g.world, {});
        expect(res.success).toBe(true);
        expect(p.scenario).toMatchObject({ difficulty: 'brutal', victory: 'dynasty' });
        expect(Victory.progress(p, g.world).text).toContain('generation 2');
    }, 60000);

    it('a new life keeps the difficulty and the goal, not the old win', () => {
        const g = newGame(84);
        const p = g.player;
        Scenarios.apply(p, g.world, { difficulty: 'hard', victory: 'crown' });
        p.scenario.victoryAchieved = { id: 'crown', name: 'Wear a Crown', day: 5, by: p.name };
        const cand = Afterlife.candidates(g.world)[0];
        const res = Afterlife.becomeStranger(p, g.world, cand);
        expect(res.success).toBe(true);
        expect(res.player.scenario).toMatchObject({ id: 'stranger', difficulty: 'hard', victory: 'crown', victoryAchieved: null, guidedStart: false });
        expect(res.player.scenario.pastVictories.length).toBe(1);
    }, 60000);
});
