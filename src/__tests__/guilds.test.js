/**
 * Town guilds (systems/guilds.js): craft and merchant guilds formed from a
 * town's industry, their market powers read in the trade path (toll, sale
 * cap, price floor, quality mark, guild rates), the membership ladder,
 * strikes that halt a trade and starve the market, monopoly precedence,
 * lobbying, a ruler's charter and abolition, saving, determinism — and
 * that none of it is a money loop.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Guilds } from '../systems/guilds.js';
import { Finance } from '../systems/finance.js';
import { Kingship } from '../systems/kingship.js';
import { Petitions } from '../systems/petitions.js';
import { Councils } from '../systems/councils.js';
import { Heralds } from '../systems/heralds.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Achievements } from '../systems/achievements.js';
import { Counsel } from '../systems/counsel.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function patch(path, value) {
    if (!_saved) _saved = JSON.parse(JSON.stringify(DataLoader._gamedata.guilds));
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata.guilds));
    const keys = path.split('.');
    let o = d;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    DataLoader._gamedata.guilds = d;
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.guilds = _saved;
    _saved = null;
    Guilds._townCache = null;
});

const GOOD = (id) => PlayerEconomy.GOODS[id.toUpperCase()];
const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** A capital at (5,5) of realm k1 and a town at (9,5); the player stands in the capital. */
function fixture(opts = {}) {
    const capital = { name: 'Highmarket', type: 'capital', population: 12000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
    const town = { name: 'Brindle', type: 'town', population: 3000, happiness: 50, kingdom: 'k1', q: 9, r: 5 };
    const village = { name: 'Ashby', type: 'village', population: 400, happiness: 50, kingdom: 'k1', q: 13, r: 5 };
    const tiles = new Map([['5,5', plains(5, 5, capital)], ['9,5', plains(9, 5, town)], ['13,5', plains(13, 5, village)]]);
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], capital: { q: 5, r: 5 }, finance: { debtRatio: 0, missed: 0, unpaid: 0 }, traits: [], treasury: 1000 }];
    const world = {
        width: 40, height: 40, day: opts.day || 50, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => [capital, town, village],
        getAllSettlements: () => [capital, town, village],
    };
    for (const s of [capital, town, village]) SettlementMarket.ensure(s);
    const player = {
        name: 'Tester', q: 5, r: 5, gold: 50000, maxInventory: 99,
        inventory: { bread: 200, grain: 200, salt: 20, tools: 10, wood: 50, stone: 50, iron: 20 },
        skills: { commerce: 3 }, reputation: { k1: 10 },
    };
    return { world, player, capital, town, village, kingdoms, tile: world.getTile(5, 5) };
}

/** Join a guild and lift the player straight to `rank` (the ladder itself is tested below). */
function makeMember(player, world, tile, gid, rank) {
    const res = Guilds.join(player, world, tile, gid);
    expect(res.success).toBe(true);
    const m = Guilds.membership(player, tile.settlement, gid);
    m.rank = rank;
    return m;
}

describe('formation from industry', () => {
    it('forms the guilds a town\'s trades support, sized by its industry', () => {
        const { world, capital, town, village } = fixture();
        for (const s of [capital, town, village]) Guilds.ensureTown(world, s, 50);
        expect(Object.keys(capital.guilds)).toEqual(expect.arrayContaining(['bakers', 'brewers', 'millers', 'smiths', 'jewellers', 'merchants']));
        // A town has its bakers but is too small for jewellers or a merchants' guild; a village has none
        expect(town.guilds.bakers).toBeTruthy();
        expect(town.guilds.jewellers).toBeUndefined();
        expect(town.guilds.merchants).toBeUndefined();
        expect(village.guilds).toBeUndefined();
        // Members follow the town's trade capacity
        expect(capital.guilds.bakers.members).toBeGreaterThan(town.guilds.bakers.members);
        const g = capital.guilds.bakers;
        expect(g.name).toBe('Bakers\' Guild of Highmarket');
        expect(g.master.name).toMatch(/\w+ \w+/);
        expect(g.treasury).toBeGreaterThan(0);
    });

    it('a guild declines and dissolves when its town loses the trade', () => {
        const { world, town } = fixture();
        Guilds.ensureTown(world, town, 50);
        expect(town.guilds.jewellers).toBeUndefined();
        expect(town.guilds.weavers).toBeTruthy();
        town.population = 500; // its trades (wool and linen weaving) shrink below half what a guild needs
        Guilds.ensureTown(world, town, 78);
        expect(town.guilds.weavers).toBeTruthy(); // one bad month is survived
        Guilds.ensureTown(world, town, 106);
        expect((town.guilds || {}).weavers).toBeUndefined();
    });

    it('takes its weekly turn on its town\'s slot in the daily tick', () => {
        const { world, player, capital } = fixture();
        for (let d = 0; d < 7; d++) { world.day = 56 + d; Guilds.processDay(world, player); }
        expect(capital.guilds && capital.guilds.bakers).toBeTruthy();
    });
});

describe('market powers in the trade path', () => {
    it('an outsider pays the guild\'s toll on its goods — into the guildhall', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const stock = capital.market.stock.bread;
        const g = capital.guilds.bakers;
        const hall = g.treasury;
        expect(Guilds.tollRate(player, capital, 'bread')).toBeCloseTo(0.12);
        const outsider = Trading.saleUnitPrice(player, GOOD('bread'), capital, world, 1, 5);
        const res = Trading.sellGoods(player, 'bread', 5, capital, world);
        expect(res.success).toBe(true);
        expect(g.treasury).toBeGreaterThan(hall);
        // A journeyman sells the same five loaves (at the same stock) untolled
        capital.market.stock.bread = stock;
        makeMember(player, world, tile, 'bakers', 1);
        expect(Guilds.tollRate(player, capital, 'bread')).toBe(0);
        const member = Trading.saleUnitPrice(player, GOOD('bread'), capital, world, 1, 5);
        expect(member).toBeGreaterThan(outsider);
        // Goods no guild guards are untolled
        expect(Guilds.saleFactor(null, capital, 'stone')).toBe(1);
    });

    it('caps what an outsider may sell a week, and the cap resets on the guild\'s turn', () => {
        const { world, player, capital } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const room = Guilds.outsiderRoom(player, capital, 'bread');
        // (five days of what the town eats)
        expect(room).toBe(Math.floor(SettlementMarket.need(capital, 'bread') * 5));
        player.inventory.bread = room + 50;
        expect(Trading.sellGoods(player, 'bread', room, capital, world).success).toBe(true);
        const no = Trading.sellGoods(player, 'bread', 5, capital, world);
        expect(no.success).toBe(false);
        expect(no.reason).toMatch(/Bakers' Guild/);
        Guilds._townWeek(world, player, capital, 57, { notices: [], income: 0, expenses: 0 });
        expect(Trading.sellGoods(player, 'bread', 5, capital, world).success).toBe(true);
    });

    it('holds a floor under its goods\' ask, glut or no glut', () => {
        const { world, capital, tile } = fixture();
        capital.market.stock.bread = SettlementMarket.target(capital, 'bread') * 2;
        const before = Trading.getAvailableGoods(capital, tile, world).find(x => x.id === 'bread');
        Guilds.ensureTown(world, capital, 50);
        const after = Trading.getAvailableGoods(capital, tile, world).find(x => x.id === 'bread');
        expect(before.scarcity).toBeLessThan(0.8);
        expect(after.price).toBeGreaterThan(before.price);
        expect(after.price).toBe(Math.floor(after.askBase * Guilds.askFloor(capital, 'bread')));
    });

    it('masters\' goods carry the mark; journeymen buy the guild\'s inputs at guild rates', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const grain = Trading.getAvailableGoods(capital, tile, world).find(x => x.id === 'grain');
        const outsiderCost = Trading.buyCost(player, grain, 20, capital);
        const m = makeMember(player, world, tile, 'bakers', 1);
        expect(Trading.buyCost(player, grain, 20, capital)).toBeLessThan(outsiderCost);
        expect(Guilds.saleFactor(player, capital, 'bread')).toBe(1);
        m.rank = 2;
        expect(Guilds.saleFactor(player, capital, 'bread')).toBeCloseTo(1.08);
        // ...and a guild man's works are harder for a crown to take
        expect(Guilds.worksShield(player, capital, 'bakery').seizeMult).toBeLessThan(1);
        expect(Guilds.worksShield(player, capital, 'smithy').seizeMult).toBe(1);
    });
});

describe('the membership ladder', () => {
    it('apprentice → journeyman → master on a masterpiece; fees and goods are real', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const gold = player.gold;
        expect(Guilds.join(player, world, tile, 'bakers').success).toBe(true);
        expect(player.gold).toBe(gold - 80); // 40 x capital fee
        const m = Guilds.membership(player, capital, 'bakers');
        expect(m.rank).toBe(0);
        // Too soon, too little standing
        let q = Guilds.advanceQuote(player, world, tile, 'bakers');
        expect(q.ok).toBe(false);
        // Standing grows with trade in the guild's goods here
        for (let i = 0; i < 6; i++) Trading.sellGoods(player, 'bread', 3, capital, world);
        expect(m.standing).toBeGreaterThan(0);
        m.standing = 25;
        world.day += 21;
        expect(Guilds.advance(player, world, tile, 'bakers').success).toBe(true);
        expect(m.rank).toBe(1);
        // Master: 30 days, standing 50, commerce 2, the masterpiece in the packs
        world.day += 30;
        m.standing = 60;
        player.inventory.grain = 5;
        q = Guilds.advanceQuote(player, world, tile, 'bakers');
        expect(q.ok).toBe(false);
        expect(q.reason).toMatch(/masterpiece/);
        player.inventory.grain = 100;
        const stock = SettlementMarket.stock(capital, 'grain');
        const res = Guilds.advance(player, world, tile, 'bakers');
        expect(res.success).toBe(true);
        expect(m.rank).toBe(2);
        expect(player.inventory.grain).toBe(70);
        expect(SettlementMarket.stock(capital, 'grain')).toBeCloseTo(stock + 30, 1);
        expect(player.guilds.stats.masterpieces).toBe(1);
        // Guildmaster is elected, not bought
        expect(Guilds.advanceQuote(player, world, tile, 'bakers').reason).toMatch(/elected/);
        expect(Achievements.ACHIEVEMENTS.GUILD_JOURNEYMAN.check(player)).toBe(true);
        expect(Achievements.ACHIEVEMENTS.MASTER_OF_THE_CRAFT.check(player)).toBe(true);
        expect(Achievements.ACHIEVEMENTS.GUILDMASTER.check(player)).toBe(false);
    });

    it('a master who stands wins an election on standing and contracts; the stipend follows', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const m = makeMember(player, world, tile, 'bakers', 2);
        m.standing = 100;
        m.contracts = 10;
        Guilds.stand(player, world, capital, 'bakers', true);
        const g = capital.guilds.bakers;
        g.nextElection = world.day;
        g.treasury = 2000;
        const out = { notices: [], income: 0, expenses: 0 };
        Guilds._election(world, player, capital, g, world.day, out);
        expect(g.master.player).toBe(true);
        expect(m.rank).toBe(3);
        expect(player.guilds.history.some(h => h.kind === 'guild_election' && h.own)).toBe(true);
        const gold = player.gold;
        Guilds._memberWeek(world, player, capital, g, world.day, out);
        expect(out.income).toBeGreaterThan(0);
        expect(player.gold).toBe(gold + out.income - out.expenses);
    });

    it('unpaid dues get a member struck from the rolls', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        makeMember(player, world, tile, 'bakers', 1);
        player.gold = 0;
        const out = { notices: [], income: 0, expenses: 0 };
        for (let i = 0; i < 3; i++) Guilds._memberWeek(world, player, capital, capital.guilds.bakers, 60 + i * 7, out);
        expect(Guilds.membership(player, capital, 'bakers')).toBe(null);
        expect(out.notices.some(n => n.title === 'Expelled')).toBe(true);
    });

    it('guild loans count on the player\'s credit; masters back it', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        makeMember(player, world, tile, 'bakers', 2);
        capital.guilds.bakers.treasury = 2000;
        const lq = Guilds.loanQuote(player, world, capital, 'bakers');
        expect(lq.ok).toBe(true);
        const gold = player.gold;
        const res = Guilds.borrow(player, world, capital, 'bakers', lq.max);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold + lq.max);
        const owed = res.loan.owed;
        expect(owed).toBeGreaterThan(lq.max);
        const out = { notices: [], income: 0, expenses: 0 };
        for (let i = 0; i < 8 && player.guilds.loans.length; i++) Guilds._memberWeek(world, player, capital, capital.guilds.bakers, 60 + i * 7, out);
        expect(player.guilds.loans.length).toBe(0);
        expect(Finance.state(player).credit.repaid).toBe(1);
        Guilds._playerDay(world, player, 120, out);
        expect(player.guilds.backing).toBe(15);
        expect(Finance.creditReport(player, world).parts.some(p => p.label === 'Guild backing')).toBe(true);
    });

    it('only the guild\'s masters may fund its guild-only works', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        expect(MerchantPrince.kind('chandler')).toBeTruthy();
        expect(MerchantPrince.investQuote(player, world, tile, 'chandler').reason).toMatch(/master of the Chandlers/);
        makeMember(player, world, tile, 'chandlers', 2);
        expect(MerchantPrince.investQuote(player, world, tile, 'chandler').reason || '').not.toMatch(/Chandlers/);
    });
});

describe('strikes', () => {
    it('a squeezed guild strikes: its trade halts and the town runs short of its goods', () => {
        const { world, player, capital, kingdoms } = fixture();
        Guilds.ensureTown(world, capital, 49);
        // War levies, an empty treasury and heavy taxes
        kingdoms[0].wars = ['k2'];
        kingdoms[0].finance = { debtRatio: 2, missed: 3, unpaid: 20 };
        kingdoms[0].crown = { policies: { tax: 'heavy' } };
        const g = capital.guilds.bakers;
        g.treasury = 5000;
        let day = 50;
        for (let w = 0; w < 20 && !g.strike; w++, day += 7) {
            world.day = day;
            Guilds._townWeek(world, player, capital, day, { notices: [], income: 0, expenses: 0 });
        }
        expect(g.strike).toBeTruthy();
        expect(capital.market.idle.bakery).toBe(g.strike.until);
        expect(player.guilds.history.some(h => h.kind === 'guild_strike')).toBe(true);
        // The market: the struck town against the same town at work
        const control = JSON.parse(JSON.stringify(capital));
        delete control.market.idle;
        for (let i = 0; i < 2; i++) {
            SettlementMarket.processSettlement(capital, {}, { day: world.day + i * 4, days: 4 });
            SettlementMarket.processSettlement(control, {}, { day: world.day + i * 4, days: 4 });
        }
        expect(capital.market.stock.bread).toBeLessThan(control.market.stock.bread);
        expect(SettlementMarket.scarcity(capital, 'bread')).toBeGreaterThan(SettlementMarket.scarcity(control, 'bread'));
        // The strike runs its course and the trade starts again
        Guilds._townWeek(world, player, capital, g.strike.until + 1, { notices: [], income: 0, expenses: 0 });
        expect(g.strike).toBe(null);
        expect((capital.market.idle || {}).bakery).toBeUndefined();
    });

    it('a crown that has lost patience may break a striking guild', () => {
        const { world, player, capital } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const g = capital.guilds.bakers;
        patch('config.crown.abolishChance', 1);
        Guilds._cfg = null;
        g.crown = -80;
        g.strike = { since: 50, until: 90, reason: 'test' };
        g.treasury = 5000;
        world.day = 57;
        Guilds._townWeek(world, player, capital, 57, { notices: [], income: 0, expenses: 0 });
        expect(capital.guilds && capital.guilds.bakers).toBeFalsy();
        expect(capital.guildBans.bakers).toBe(57);
        // ...and it does not re-form by itself
        Guilds.ensureTown(world, capital, 84);
        expect(capital.guilds.bakers).toBeUndefined();
    });
});

describe('monopoly precedence', () => {
    it('a monopoly (whoever holds it) > the guild\'s privileges > the open market; a standing charter is never overridden', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        // The guild's own privileges
        expect(Guilds.saleFactor(player, capital, 'tools')).toBeLessThan(1);
        expect(Guilds.askFloor(capital, 'tools')).toBeGreaterThan(0);
        // A merchant house's monopoly sets them aside (and bars everyone else)
        capital.monopolies = { tools: { holder: 'r1', holderName: 'House Vell' } };
        expect(Guilds.saleFactor(player, capital, 'tools')).toBe(1);
        expect(Guilds.askFloor(capital, 'tools')).toBe(0);
        expect(Trading.monopolyBlock(capital, 'tools', player)).toMatch(/House Vell/);
        // A guild's monopoly bars outsiders, not its journeymen
        capital.monopolies = { tools: { holder: 'guild', holderName: 'Smiths\' Guild of Highmarket', guildId: 'smiths' } };
        expect(Trading.monopolyBlock(capital, 'tools', player)).toMatch(/Smiths/);
        makeMember(player, world, tile, 'smiths', 1);
        expect(Trading.monopolyBlock(capital, 'tools', player)).toBe(null);
        expect(Trading.sellGoods(player, 'tools', 2, capital, world).success).toBe(true);
        // A crown edict fills the empty slots: the guild's charter stands, the crown takes the rest
        player.throne = { ruling: { kingdomId: 'k1', court: null } };
        const court = Kingship.court(player);
        court.edicts.crown_monopolies = true;
        Kingship.syncCrownMonopolies(player, world);
        expect(capital.monopolies.tools.holder).toBe('guild');
        expect(capital.monopolies.weapons.holder).toBe('crown');
        // ...and on the crown's goods the guild's privileges give way to it
        expect(Guilds.saleFactor(null, capital, 'weapons')).toBe(1);
        expect(Guilds.askFloor(capital, 'weapons')).toBe(0);
        // A guild lobbies only for an empty slot
        const g = capital.guilds.smiths;
        g.treasury = 5000;
        g.crown = 100;
        Guilds._lobby(world, null, capital, g, Guilds.def('smiths'), 60, { notices: [] });
        expect(capital.monopolies.weapons.holder).toBe('crown');
    });
});

describe('politics', () => {
    it('lobbies an NPC crown for a charter or a monopoly with its purse', () => {
        const { world, player, capital, kingdoms } = fixture();
        Guilds.ensureTown(world, capital, 50);
        const g = capital.guilds.bakers;
        g.crown = 60;
        let won = false;
        for (let d = 50; d < 400 && !won; d += 28) {
            g.treasury = 2000;
            Guilds._lobby(world, player, capital, g, Guilds.def('bakers'), d, { notices: [] });
            won = g.chartered || !!(capital.monopolies && capital.monopolies.bread);
        }
        expect(won).toBe(true);
        expect(kingdoms[0].treasury).toBeGreaterThan(1000);
        if (g.chartered) expect(Guilds.tollRate(null, capital, 'bread')).toBeCloseTo(0.2);
        else expect(capital.monopolies.bread).toMatchObject({ holder: 'guild', guildId: 'bakers' });
    });

    it('in the realm the player rules it petitions the crown; granting gives it the monopoly', () => {
        const { world, player, capital } = fixture();
        player.throne = { ruling: { kingdomId: 'k1' } };
        Guilds.ensureTown(world, capital, 50);
        const g = capital.guilds.bakers;
        g.treasury = 2000;
        Guilds._lobby(world, player, capital, g, Guilds.def('bakers'), 50, { notices: [] });
        const p = Petitions.pending(player).find(x => x.defId.startsWith('guild_lobby_'));
        expect(p).toBeTruthy();
        expect(g.treasury).toBe(1800);
        const gold = player.gold;
        expect(Petitions.rule(player, world, p.id, 'grant').success).toBe(true);
        expect(player.gold).toBe(gold + 200);
        expect(capital.monopolies.bread).toMatchObject({ holder: 'guild', guildId: 'bakers' });
        Guilds._memberWeek(world, player, capital, g, 57, { notices: [], income: 0, expenses: 0 });
        expect(g.lobbying).toBe(null);
        expect(g.treasury).toBe(1800); // the purse was spent
    });

    it('a ruler abolishes a guild by edict, or charters one', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        makeMember(player, world, tile, 'bakers', 1);
        expect(Guilds.abolish(player, world, capital, 'bakers').success).toBe(false);
        player.throne = { ruling: { kingdomId: 'k1' } };
        const merchants = Councils._ensureState(player).factions.merchants.support;
        const res = Guilds.abolish(player, world, capital, 'bakers');
        expect(res.success).toBe(true);
        expect(capital.guilds.bakers).toBeUndefined();
        expect(Guilds.membership(player, capital, 'bakers')).toBe(null);
        expect(Guilds.saleFactor(player, capital, 'bread')).toBe(1);
        expect(Councils._ensureState(player).factions.merchants.support).toBeLessThan(merchants);
        Guilds.ensureTown(world, capital, 78);
        expect(capital.guilds.bakers).toBeUndefined();
        // A charter re-founds it, chartered — with an empty hall, so charter-and-abolish pays nothing
        const gold = player.gold;
        const treasury = world.getKingdom('k1').treasury;
        expect(Guilds.charter(player, world, capital, 'bakers').success).toBe(true);
        expect(capital.guilds.bakers.chartered).toBe(true);
        expect(Guilds.abolish(player, world, capital, 'bakers').success).toBe(true);
        expect(Guilds.charter(player, world, capital, 'bakers').success).toBe(true);
        expect(player.gold).toBe(gold);
        expect(world.getKingdom('k1').treasury).toBe(treasury);
        expect(Guilds.tollRate(null, capital, 'bread')).toBeCloseTo(0.2);
        expect(player.guilds.history.some(h => h.kind === 'guild_abolished')).toBe(true);
    });

    it('feuds with the player\'s works that undercut it, and wrecks them in the end', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        MerchantPrince.invest(player, world, tile, 'bakery');
        const w = SettlementMarket.works(capital, 'bakery');
        const g = capital.guilds.bakers;
        const out = { notices: [], income: 0, expenses: 0 };
        for (let i = 0; i < 8; i++) {
            w.runs = 5;
            Guilds._feudWeek(world, player, capital, g, Guilds.def('bakers'), 57 + i * 7, out);
        }
        expect(w.cond).toBeLessThan(1);
        expect(out.notices.some(n => n.title === 'Guild Sabotage')).toBe(true);
        // A journeyman's works are the guild's own
        const g2 = capital.guilds.brewers;
        MerchantPrince.invest(player, world, tile, 'brewery');
        makeMember(player, world, tile, 'brewers', 1);
        SettlementMarket.works(capital, 'brewery').runs = 5;
        Guilds._feudWeek(world, player, capital, g2, Guilds.def('brewers'), 57, out);
        expect(g2.feud).toBe(0);
    });

    it('the heralds cry a strike and the counsel points at it', () => {
        const { world, player, capital } = fixture();
        Guilds.ensureTown(world, capital, 50);
        Guilds._startStrike(world, player, capital, capital.guilds.bakers, 50, 'the price of bread', { notices: [] });
        const rec = Heralds._records(player);
        expect(rec.market.some(x => x.h.kind === 'guild_strike')).toBe(true);
        const near = Guilds.strikesNear(world, 5, 5, 4);
        expect(near[0]).toMatchObject({ town: 'Highmarket', goods: ['bread'] });
        const c = Counsel.scan(player, world, { fresh: true });
        expect(c.items.some(i => i.rule === 'guild_strike' && i.action.panel === 'guilds')).toBe(true);
    });
});

describe('no money loop', () => {
    it('buying at guild rates and selling straight back loses; a master\'s mark never beats buying back', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        makeMember(player, world, tile, 'bakers', 2);
        for (const id of ['grain', 'bread']) {
            const entry = Trading.getAvailableGoods(capital, tile, world).find(x => x.id === id);
            const cost = Trading.buyCost(player, entry, 10, capital);
            expect(Trading.buyGoods(player, entry, 10, capital).success).toBe(true);
            const res = Trading.sellGoods(player, id, 10, capital, world);
            expect(res.success).toBe(true);
            expect(res.earned).toBeLessThan(cost);
        }
    });

    it('a guild contract pays less than buying its goods here', () => {
        const { world, player, capital, tile } = fixture();
        Guilds.ensureTown(world, capital, 50);
        makeMember(player, world, tile, 'bakers', 1);
        capital.market.stock.grain = SettlementMarket.target(capital, 'grain') * 0.5;
        const offers = Guilds.contractOffers(player, world, capital, 'bakers');
        expect(offers.length).toBe(1);
        const o = offers[0];
        const entry = Trading.getAvailableGoods(capital, tile, world).find(x => x.id === 'grain');
        expect(o.total).toBeLessThan(Trading.buyCost(player, entry, o.qty, capital));
        // Taking it sets the money aside; delivering pays it and stocks the town
        expect(Guilds.takeContract(player, world, tile, 'bakers', 'grain').success).toBe(true);
        const stock = SettlementMarket.stock(capital, 'grain');
        const res = Guilds.deliverContract(player, world, player.guilds.contracts[0].id);
        expect(res.success).toBe(true);
        expect(res.earned).toBe(o.total);
        expect(SettlementMarket.stock(capital, 'grain')).toBeCloseTo(stock + o.qty, 1);
        expect(player.guilds.contracts.length).toBe(0);
    });
});

describe('save, load and determinism', () => {
    it('round-trips the guilds with their towns and the player\'s memberships; older saves backfill', () => {
        let game = newGame(101);
        for (let d = 0; d < 10; d++) { game.player.health = 100; endDay(game); }
        const v = game.world.getSettlementViews().map(x => game.world.getTile(x.q, x.r)).find(t => t.settlement.guilds && t.settlement.guilds.bakers);
        expect(v).toBeTruthy();
        game.player.q = v.q;
        game.player.r = v.r;
        game.player.gold = 5000;
        expect(Guilds.join(game.player, game.world, v, 'bakers').success).toBe(true);
        const before = JSON.stringify(v.settlement.guilds);
        game = roundTrip(game);
        const t2 = game.world.getTile(v.q, v.r);
        expect(JSON.stringify(t2.settlement.guilds)).toBe(before);
        expect(Guilds.rankOf(game.player, t2.settlement, 'bakers')).toBe(0);
        // An older save without guild state
        const p = { guilds: undefined };
        Guilds.loadState(p);
        expect(p.guilds).toBe(null);
        const half = { guilds: { memberships: { a: { rank: 1 } } } };
        Guilds.loadState(half);
        expect(half.guilds.stats.bestRank).toBe(-1);
        expect(half.guilds.memberships.a.standing).toBe(0);
        expect(Array.isArray(half.guilds.contracts)).toBe(true);
    });

    it('is deterministic and draws nothing from the shared RNG', () => {
        const run = () => {
            const game = newGame(202);
            for (let d = 0; d < 40; d++) { game.player.health = 100; endDay(game); }
            return game.world.getSettlementViews().map(x => game.world.getTile(x.q, x.r).settlement.guilds || null);
        };
        expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
        const { world, player } = fixture();
        Utils.setSeed(7);
        const a = [Utils.random(), Utils.random()];
        Utils.setSeed(7);
        Utils.random();
        for (let d = 49; d < 120; d++) { world.day = d; Guilds.processDay(world, player); }
        expect(Utils.random()).toBe(a[1]);
    });
});
