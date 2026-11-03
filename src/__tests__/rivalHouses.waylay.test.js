// The rival Houses come for you and deal with each other (systems/rivalHouses.js):
// a bitter, stronger rival rides out to waylay the player through the road
// encounters; the Houses hold opinions of one another — one favourite to a
// court, matches between them, allies sharing a grudge.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { RivalHouses } from '../systems/rivalHouses.js';
import { House } from '../systems/house.js';
import { WorldUnit } from '../world/units.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

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

/** A rival ready to waylay: hot feud, no hunt yet, its retinue near the player. */
function bitter(game) {
    const { player, world } = game;
    const rival = rivalsOf(game)[0];
    const unit = RivalHouses.retinueOf(world, rival);
    rival.feud = 95;
    rival.lastWaylayDay = null;
    player.army = [];
    unit.q = player.q;
    unit.r = (player.r + 3) % world.height;
    return { rival, unit };
}

describe('waylaying the player', () => {
    it('only a bitter rival, stronger than your army and in reach, rides out', () => {
        const game = newGame(331);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(true);
        rival.feud = 50;
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(false);
        rival.feud = 95;
        player.army = [{ strength: RivalHouses.strength(rival) * 2 }];
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(false);
        player.army = [];
        rival.lastWaylayDay = world.day - 10;
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(false);
        rival.lastWaylayDay = null;
        unit.q = (player.q + Math.floor(world.width / 2)) % world.width;
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(false);
    }, 120000);

    it('the hunt turns the retinue hostile, warns you, and a robbery on the road fills their purse and cools the feud', () => {
        const game = newGame(332);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        const out = { notices: [] };
        RivalHouses._startWaylay(player, world, rival, unit, out);
        expect(unit.hostile).toBe(true);
        expect(WorldUnit.isHostile(unit)).toBe(true);
        expect(out.notices.some(n => n.title === 'A Rival Hunts You')).toBe(true);
        expect(RivalHouses.doing(world, rival)).toMatch(/hunting you/);
        // The road encounter robbed you: the coin sits on the retinue until the House's day
        unit.inventory.gold = 120;
        const gold = rival.gold;
        const feud = rival.feud;
        RivalHouses._hunt(player, world, rival, unit, out);
        expect(rival.plan).toBe(null);
        expect(unit.hostile).toBe(false);
        expect(rival.feud).toBe(feud - 15);
        expect(rival.lastWaylayDay).toBe(world.day);
        // The day's tick banks the coin
        unit.inventory.gold = 120;
        rival.lastDay = null;
        rival.feud = 0; // no new hunt
        RivalHouses.processDay(player, world);
        expect(rival.gold).toBeGreaterThanOrEqual(gold + 120 - 200); // banked (less any week's upkeep or a new errand's spend)
        expect(unit.inventory.gold).toBe(0);
    }, 120000);

    it('the retinue closes in day by day, and the harness encounter falls on you once', () => {
        const game = newGame(333);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        player.gold = 1000;
        RivalHouses._startWaylay(player, world, rival, unit, { notices: [] });
        let robbedOn = null;
        for (let i = 0; i < 8 && rival.plan && rival.plan.kind === 'waylay'; i++) {
            const before = player.gold;
            endDay(game);
            if (player.gold < before && robbedOn == null) robbedOn = i;
        }
        expect(robbedOn).not.toBe(null);
        expect(rival.plan && rival.plan.kind === 'waylay').toBeFalsy();
        expect(unit.hostile).toBe(false);
        expect(rival.stats.waylays).toBe(1);
    }, 120000);

    it('beating off an ambush takes from their purse and costs you no honour', () => {
        const game = newGame(334);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        RivalHouses._startWaylay(player, world, rival, unit, { notices: [] });
        rival.gold = 1000;
        rival.guard = 4;
        player.reputation[rival.kingdomId] = 5;
        const karma = player.karma || 0;
        const text = RivalHouses.onAttacked(player, world, unit, true);
        expect(text).toMatch(/no honour lost/);
        expect(rival.gold).toBe(800);
        expect(player.reputation[rival.kingdomId]).toBe(5);
        expect(player.karma || 0).toBe(karma);
        expect(rival.guard).toBe(2);
        expect(rival.plan).toBe(null);
        expect(unit.hostile).toBe(false);
    }, 120000);

    it('a hunt with no sight of you is given up', () => {
        const game = newGame(335);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        RivalHouses._startWaylay(player, world, rival, unit, { notices: [] });
        world.day = rival.plan.until;
        const out = { notices: [] };
        RivalHouses._hunt(player, world, rival, unit, out);
        expect(rival.plan).toBe(null);
        expect(out.notices.some(n => n.title === 'The Hunt Is Off')).toBe(true);
    }, 120000);

    it('PlayerMilitary routes a beaten ambush to the rival as self-defence', () => {
        const game = newGame(336);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = bitter(game);
        RivalHouses._startWaylay(player, world, rival, unit, { notices: [] });
        player.reputation[rival.kingdomId] = 0;
        player.q = unit.q;
        player.r = unit.r;
        PlayerMilitary.attackUnit(player, unit, world, { defending: true, combatResult: { victory: true, casualties: 0, loot: 0 } });
        expect(rival.plan).toBe(null);
        expect(player.reputation[rival.kingdomId]).toBe(0);
    }, 120000);
});

describe('the Houses among themselves', () => {
    it('each House has a regard for every other, the same both ways', () => {
        const game = newGame(341);
        days(game, 1);
        const rs = rivalsOf(game);
        expect(rs.length).toBeGreaterThan(1);
        for (const a of rs) for (const b of rs) if (a !== b) expect(RivalHouses.tie(a, b)).toBe(RivalHouses.tie(b, a));
    }, 120000);

    it('one favourite to a court: only the best-standing House draws the pension, and an ousted one bears a grudge', () => {
        const game = newGame(342);
        days(game, 1);
        const { player, world } = game;
        const [a, b] = rivalsOf(game);
        const k = world.kingdoms.find(x => x && x.isAlive);
        k.treasury = 100000;
        a.standing = { [k.id]: 40 };
        b.standing = { [k.id]: 30 };
        const live = [a, b];
        RivalHouses._courts(player, world, live, { notices: [] });
        expect(a.favouriteOf).toEqual([String(k.id)]);
        expect(b.favouriteOf).toEqual([]);
        const ga = a.gold;
        const gb = b.gold;
        world.day = 7;
        RivalHouses._courtWeek(world, a, live);
        RivalHouses._courtWeek(world, b, live);
        expect(a.gold).toBeGreaterThan(ga);
        expect(b.gold).toBe(gb);
        // b rises past a: a is ousted
        b.standing[k.id] = 55;
        const tie = RivalHouses.tie(a, b);
        const out = { notices: [] };
        RivalHouses._courts(player, world, live, out);
        expect(b.favouriteOf).toEqual([String(k.id)]);
        expect(RivalHouses.tie(a, b)).toBe(Math.max(-100, tie - 15));
        expect(out.notices.some(n => n.title === 'A New Favourite')).toBe(true);
    }, 120000);

    it('Houses on good terms wed their children and become allies; a wrong to one angers the other', () => {
        const game = newGame(343);
        days(game, 1);
        const { player, world } = game;
        const [a, b] = rivalsOf(game);
        a.head.children = [{ firstName: 'Corin', gender: 'male', age: 22 }];
        b.head.children = [{ firstName: 'Liesl', gender: 'female', age: 20 }];
        RivalHouses.bond(a, b, 60 - RivalHouses.tie(a, b)); // 60
        const out = { notices: [] };
        let wed = false;
        for (let i = 0; i < 30 && !wed; i++) {
            RivalHouses._yearOfHouses(player, world, [a, b], out);
            wed = !!a.head.children[0].wed;
            if (!wed) RivalHouses.bond(a, b, 60 - RivalHouses.tie(a, b));
        }
        expect(wed).toBe(true);
        expect(a.head.children[0].wedHouse).toBe(b.name);
        expect(b.head.children[0].wed).toBe('another House');
        expect(RivalHouses.tie(a, b)).toBeGreaterThanOrEqual(50);
        expect(out.notices.some(n => n.title === 'Rival Houses Wed')).toBe(true);
        // Allies share a grudge
        a.feud = 10;
        b.feud = 10;
        House.accrueRivalFeud(player, world, a.kingdomId, 20, 'test');
        expect(a.feud).toBe(30);
        expect(b.feud).toBe(20);
        // Enemies are glad of it
        RivalHouses.bond(a, b, -200);
        b.feud = 20;
        House.accrueRivalFeud(player, world, a.kingdomId, 20, 'test');
        expect(b.feud).toBe(15);
    }, 120000);

    it('the overview shows allies, rivals at odds and a hunt', () => {
        const game = newGame(344);
        days(game, 1);
        const [a, b] = rivalsOf(game);
        RivalHouses.bond(a, b, 100);
        const { unit } = bitter(game);
        RivalHouses._startWaylay(game.player, game.world, a, unit, { notices: [] });
        let shown = null;
        game.ui = { showCustomPanel: vi.fn((title, html) => { shown = { title, html }; }), showNotification: vi.fn(), hideCustomPanel: vi.fn() };
        ActionMenu.showRivalHouses(game);
        expect(shown.html).toMatch(/allied with/);
        expect(shown.html).toMatch(/hunting you on the roads/);
    }, 120000);
});
