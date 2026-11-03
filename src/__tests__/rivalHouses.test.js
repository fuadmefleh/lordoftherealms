// Rival Houses in the flesh (systems/rivalHouses.js): each rival House gets a
// head with a purse, a seat and a family, and a retinue on the map that
// trades in the town markets, sits at court, shadows a hated player, ages and
// dies; the player meets it to parley, gift, insult or propose a match.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { RivalHouses, RIVAL_TYPE } from '../systems/rivalHouses.js';
import { Schemes } from '../systems/schemes.js';
import { Upbringing } from '../systems/upbringing.js';
import { LandMarket } from '../systems/landMarket.js';
import { Estates } from '../world/estates.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const rivalsOf = (game) => RivalHouses.rivals(game.player);

function days(game, n) {
    for (let i = 0; i < n; i++) endDay(game);
}

/** Put the player on a rival's retinue and return { rival, unit }. */
function meet(game) {
    const rival = rivalsOf(game)[0];
    const unit = RivalHouses.retinueOf(game.world, rival);
    game.player.q = unit.q;
    game.player.r = unit.r;
    return { rival, unit };
}

describe('rival Houses come to life', () => {
    it('gives every rival a head, a purse, a seat and a retinue on the map', () => {
        const game = newGame(311);
        expect(rivalsOf(game).length).toBeGreaterThan(0);
        days(game, 1);
        for (const r of rivalsOf(game)) {
            expect(r.head).toMatchObject({ firstName: expect.any(String), age: expect.any(Number) });
            expect(r.head.traits).toHaveLength(2);
            expect(r.gold).toBeGreaterThan(0);
            expect(r.seat).toMatchObject({ name: expect.any(String) });
            const u = RivalHouses.retinueOf(game.world, r);
            expect(u && u.type).toBe(RIVAL_TYPE);
            expect(RivalHouses.headName(r)).toMatch(/^(Lord|Lady) /);
        }
    }, 120000);

    it('rides the map, trades in the town markets and sits at court, keeping a sane purse', () => {
        const game = newGame(312);
        const start = {};
        days(game, 1);
        for (const r of rivalsOf(game)) start[r.kingdomId] = { ...RivalHouses.retinueOf(game.world, r) };
        days(game, 240);
        let moved = 0;
        let business = 0;
        for (const r of rivalsOf(game)) {
            const u = RivalHouses.retinueOf(game.world, r);
            const s = start[r.kingdomId];
            if (s && (u.q !== s.q || u.r !== s.r || r.stats.trades || r.stats.courtVisits)) moved++;
            business += r.stats.trades + r.stats.courtVisits;
            expect(Number.isFinite(r.gold) && r.gold >= 0).toBe(true);
            expect(r.gold).toBeLessThan(1e6);
            expect(r.head.age).toBeGreaterThan(0);
        }
        expect(moved).toBeGreaterThan(0);
        expect(business).toBeGreaterThan(0);
    }, 240000);

    it('a trading rival takes stock where it buys and lands it where it sells', () => {
        const game = newGame(313);
        days(game, 1);
        const rival = rivalsOf(game)[0];
        const unit = RivalHouses.retinueOf(game.world, rival);
        rival.gold = 5000;
        const t = RivalHouses._findTrade(game.world, unit, rival);
        expect(t).toBeTruthy();
        expect(t.sell / t.buy - 1).toBeGreaterThanOrEqual(RivalHouses.config().trade.minMargin);
        rival.plan = { kind: 'trade', stage: 'buying', good: t.good, qty: t.qty, from: { q: t.from.q, r: t.from.r, name: t.from.name }, to: { q: t.to.q, r: t.to.r, name: t.to.name }, since: 0 };
        const before = { from: t.from.market.stock[t.good], to: t.to.market.stock[t.good] || 0 };
        const out = { notices: [] };
        RivalHouses._arrive(game.player, game.world, rival, unit, out);
        expect(t.from.market.stock[t.good]).toBeLessThan(before.from);
        expect(rival.gold).toBeLessThan(5000);
        expect(rival.plan.stage).toBe('selling');
        RivalHouses._arrive(game.player, game.world, rival, unit, out);
        expect(t.to.market.stock[t.good]).toBeGreaterThan(before.to);
        expect(rival.stats.trades).toBe(1);
        expect(rival.plan).toBe(null);
    }, 120000);
});

describe('their lives', () => {
    it('ages on the year\'s last day; a dead head is followed by a grown child, and the feud cools', () => {
        const game = newGame(314);
        days(game, 1);
        const rival = rivalsOf(game)[0];
        rival.head.age = 95; // past the oldest a head lives
        rival.head.children = [{ firstName: 'Osric', gender: 'male', age: 30 }, { firstName: 'Mira', gender: 'female', age: 12 }];
        rival.feud = 50;
        const out = { notices: [] };
        RivalHouses._yearOf(game.world, rival, out, game.player);
        expect(rival.head.firstName).toBe('Osric');
        expect(rival.head.age).toBe(31);
        expect(rival.feud).toBe(35);
        expect(rival.stats.heads).toBe(2);
        expect(out.notices.some(n => /dies/.test(n.text))).toBe(true);
        expect(game.player.house.history.some(h => /Osric/.test(h.text))).toBe(true);
    }, 120000);
});

describe('their purses pay for their plots', () => {
    it('a rival too poor to pay hatches nothing; a rich one pays for the plot', () => {
        const game = newGame(315);
        days(game, 1);
        const { player, world } = game;
        for (const r of rivalsOf(game)) { r.feud = 100; r.gold = 0; }
        player.house.schemes = [];
        world.day = 20;
        expect(Schemes._plot(player, world)).toBe(null);
        const rich = rivalsOf(game)[0];
        rich.gold = 1000;
        let scheme = null;
        for (let i = 0; i < 20 && !scheme; i++) scheme = Schemes._plot(player, world);
        expect(scheme && scheme.rivalId).toBe(rich.kingdomId);
        expect(rich.gold).toBe(1000 - 150);
    }, 120000);
});

describe('meeting a rival', () => {
    it('is offered on the map within a hex, and parley, gift and insult move the feud', () => {
        const game = newGame(316);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        const acts = [];
        addWildernessActions(acts, player, world.getTile(player.q, player.r), world);
        expect(acts.some(a => a.type === 'meet_rival_house')).toBe(true);

        rival.feud = 40;
        player.gold = 2000;
        const cost = RivalHouses.giftCost(rival);
        const before = rival.gold;
        const g = RivalHouses.gift(player, world, rival.kingdomId);
        expect(g.success).toBe(true);
        expect(rival.feud).toBe(25);
        expect(rival.gold).toBe(before + cost);
        expect(player.gold).toBe(2000 - cost);

        const p = RivalHouses.parley(player, world, rival.kingdomId);
        expect(p.success).toBe(true);
        expect(rival.feud).toBe(p.ok ? 17 : 28);
        expect(RivalHouses.parley(player, world, rival.kingdomId).success).toBe(false); // once a day

        world.day += 1;
        const renown = player.renown || 0;
        const f = rival.feud;
        expect(RivalHouses.insult(player, world, rival.kingdomId).success).toBe(true);
        expect(rival.feud).toBe(f + (RivalHouses.has(rival.head, 'proud') ? 15 : 10));
        expect(player.renown).toBe(renown + 3);

        player.q = (player.q + 5) % world.width;
        expect(RivalHouses.parley(player, world, rival.kingdomId).success).toBe(false);
    }, 120000);

    it('a match between the Houses weds the children and ends most of the feud', () => {
        const game = newGame(317);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        const child = { id: 'c-ada', firstName: 'Ada', gender: 'female', age: 19, isAlive: true, traits: [], skills: {} };
        Upbringing.ensure(child);
        child.upbringing.comeOfAge = true;
        player.children = [child];
        rival.head.children = [{ firstName: 'Bertram', gender: 'male', age: 21 }];
        rival.feud = 80;
        player.gold = 1000;
        expect(RivalHouses.proposeMatch(player, world, rival.kingdomId, 'c-ada', 0).success).toBe(false);
        rival.feud = 60;
        const res = RivalHouses.proposeMatch(player, world, rival.kingdomId, 'c-ada', 0);
        expect(res.success).toBe(true);
        expect(child.upbringing.spouse.name).toBe(`Bertram ${RivalHouses.surname(rival)}`);
        expect(rival.head.children[0].wed).toBe('Ada');
        expect(rival.feud).toBe(20);
        expect(player.gold).toBe(700);
        expect(RivalHouses.matchableChildren(rival)).toHaveLength(0);
    }, 120000);

    it('falling on a retinue takes from their purse and inflames the feud; losing angers them a little', () => {
        const game = newGame(320);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = meet(game);
        rival.gold = 1000;
        rival.feud = 10;
        player.reputation[rival.kingdomId] = 0;
        const gold = player.gold;
        const text = RivalHouses.onAttacked(player, world, unit, true);
        expect(text).toMatch(/take 200 gold/);
        expect(player.gold).toBe(gold + 200);
        // ...and they hire guards for the road after it
        expect(rival.guard).toBe(2);
        expect(rival.gold).toBe(800 - 2 * RivalHouses.config().guard.cost);
        expect(unit.strength).toBe(RivalHouses.strength(rival));
        expect(text).toMatch(/2 more guards/);
        expect(rival.feud).toBeGreaterThanOrEqual(40);
        expect(player.reputation[rival.kingdomId]).toBe(-10);
        const f = rival.feud;
        RivalHouses.onAttacked(player, world, unit, false);
        expect(rival.feud).toBe(Math.min(100, f + 10));
    }, 120000);

    it('the meeting opens a conversation and the overview renders', async () => {
        const { ConversationScene } = await import('../ui/conversationScene.js');
        const game = newGame(318);
        days(game, 1);
        const { unit, rival } = meet(game);
        let cfg = null;
        const scene = { isOpen: true, overlay: { querySelector: () => null }, choices() {}, afterSpoken() {}, setMood() {}, npc() {}, leave() {}, thinking() {} };
        const spy = vi.spyOn(ConversationScene, 'open').mockImplementation((c) => { cfg = c; return scene; });
        let shown = null;
        game.ui = { showCustomPanel: vi.fn((title, html) => { shown = { title, html }; }), showNotification: vi.fn(), hideCustomPanel: vi.fn(), updateStats: vi.fn() };
        try {
            ActionMenu.showRivalHead(game, unit.id);
            expect(cfg.name).toContain(rival.head.firstName);
        } finally {
            spy.mockRestore();
        }
        ActionMenu.showRivalHouses(game);
        expect(shown.title).toMatch(/Rival Houses/);
        for (const r of rivalsOf(game)) expect(shown.html).toContain(r.head.firstName);
    }, 120000);
});

describe('saving and leaving', () => {
    it('heads and retinues survive a save; a House no longer your rival rides off the map', () => {
        let game = newGame(319);
        days(game, 30);
        const names = rivalsOf(game).map(r => `${r.head.firstName}:${r.gold}`);
        game = roundTrip(game);
        expect(rivalsOf(game).map(r => `${r.head.firstName}:${r.gold}`)).toEqual(names);
        for (const r of rivalsOf(game)) expect(RivalHouses.retinueOf(game.world, r)).toBeTruthy();
        days(game, 5);
        const gone = rivalsOf(game)[0];
        delete game.player.house.rivals[gone.kingdomId];
        RivalHouses.processDay(game.player, game.world);
        expect(RivalHouses.retinues(game.world).some(u => u.houseKey === gone.houseKey)).toBe(false);
    }, 240000);
});
