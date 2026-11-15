// Every coin the player pays or is paid has a counterparty (2026-11). The
// world's coin census (CoinCensus.total, the player's purse included) moves
// only by what the books say was made or unmade (MoneySupply.bookedChange):
// a fee lands in the town, crown, captor or company that took it; a reward
// comes out of whoever gives it, capped by what they hold; coin truly found
// (a wreck's strongbox, a hoard in the wilds) or lost (dropped in the deep) is
// booked with MoneySupply.leak. Each case runs one player action between two
// snapshots of the census and asserts the change is exactly the booked change.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Barter } from '../world/barter.js';
import { Economy } from '../world/economy.js';
import { Tavern } from '../player/tavern.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Prison } from '../player/prison.js';
import { RealmPolitics } from '../player/realmPolitics.js';
import { CoastalRaids } from '../player/coastalRaids.js';
import { Diving } from '../player/diving.js';
import { SettlementServices } from '../player/settlementServices.js';
import { Wilds } from '../player/wilds.js';
import { MercContracts } from '../player/mercContracts.js';
import { SeasonalWork } from '../player/seasonalWork.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { ActionMenu } from '../ui/actionMenu.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy, warnSpy;
let game, town, tile, realms;

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    game = newGame(4242, { kingdomCount: 3 });
    const { world, player } = game;
    // (a few days for the towns' economies to open their books)
    for (let i = 0; i < 3; i++) { player.health = 100; player.starvationDays = 0; endDay(game); }
    // Stand the player in the richest town that keeps coin
    const towns = world.getSettlementViews()
        .map(v => world.getTile(v.q, v.r))
        .filter(t => t && t.settlement && t.settlement.economy && !t.settlement.inKind && t.settlement.kingdom != null)
        .sort((a, b) => b.settlement.economy.gold - a.settlement.economy.gold);
    tile = towns[0];
    town = tile.settlement;
    player.q = tile.q; player.r = tile.r;
    realms = world.kingdoms.filter(k => k && k.isAlive !== false);
    game.ui = { showNotification() {}, updateStats() {}, hideCustomPanel() {}, showCustomPanel() {} };
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

/** Run `fn` between two census snapshots: the census moves by exactly the booked change. */
function conserves(fn) {
    const { world, player } = game;
    const t0 = CoinCensus.total(world, player).total;
    const b0 = MoneySupply.bookedChange(world);
    const c0 = Barter.coinOf(player);
    const out = fn();
    const t1 = CoinCensus.total(world, player).total;
    const b1 = MoneySupply.bookedChange(world);
    expect(Math.abs((t1 - t0) - (b1 - b0))).toBeLessThan(0.05);
    return { out, moved: Math.round((Barter.coinOf(player) - c0) * 100) / 100, booked: Math.round((b1 - b0) * 100) / 100 };
}

const rich = () => { game.player.gold = 5000; };

describe('the player pays and is paid by someone: the census closes', () => {
    it('the player stands in a coin town (not in kind)', () => {
        expect(Barter.inKind(game.player)).toBe(false);
        expect(town.economy.gold).toBeGreaterThan(100);
    });

    it('a round of drinks: the coin goes into the town', () => {
        rich();
        const before = town.economy.gold;
        const r = conserves(() => Tavern._buyDrinks(game.player, tile, game.world));
        expect(r.moved).toBe(-Tavern.DRINK_COST);
        expect(town.economy.gold).toBeCloseTo(before + Tavern.DRINK_COST, 2);
    });

    it("an informant's hire and daily upkeep go to the informant's town", () => {
        rich();
        const r = conserves(() => Tavern._hireInformant(game.player, tile, game.world));
        expect(r.moved).toBe(-Tavern.HIRE_INFORMANT_COST);
        const r2 = conserves(() => Tavern.processInformants(game.player, game.world));
        expect(r2.moved).toBeLessThan(0);
        expect(r2.booked).toBe(0);
    });

    it("buying freedom from servitude pays the captors", () => {
        rich();
        game.player.indenturedServitude = { canBuyFreedom: true, freedomCost: 120, captor: 'Bandits', daysRemaining: 5 };
        const r = conserves(() => PlayerMilitary.buyFreedom(game.player, game.world));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBe(-120);
    });

    it("an overseer's bribe is spent in the nearest town", () => {
        rich();
        game.player.indenturedServitude = { canBuyFreedom: true, freedomCost: 200, captor: 'Bandits', daysRemaining: 5 };
        const r = conserves(() => Prison.bribeOverseer(game.player, game.world));
        expect(r.moved).toBe(-Prison.servitudeBribeCost({ indenturedServitude: { freedomCost: 200 } }));
        game.player.indenturedServitude = null;
    });

    it("a property's upgrade pays its town's builders", () => {
        rich();
        const type = Object.keys(PlayerEconomy.PROPERTY_TYPES)[0].toLowerCase();
        tile.playerProperty = { type, level: 1, storage: 0 };
        const r = conserves(() => PlayerEconomy.upgradeProperty(game.player, tile, game.world));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBe(-r.out.cost);
        tile.playerProperty = null;
    });

    it("a trade route's guards are hired at its home town", () => {
        rich();
        PlayerEconomy.ensureEconomyState(game.player);
        game.player.tradeRoutes.push({ id: 'R-test', protection: 0, roadQuality: 0, fromPos: { q: tile.q, r: tile.r } });
        const r = conserves(() => PlayerEconomy.upgradeRouteProtection(game.player, 'R-test', false, game.world));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBe(-r.out.cost);
        const r2 = conserves(() => PlayerEconomy.upgradeRouteRoadQuality(game.player, 'R-test', false, game.world));
        expect(r2.moved).toBe(-r2.out.cost);
    });

    it('an auction stake is held by the auction house and handed back when raised', () => {
        rich();
        PlayerEconomy.ensureEconomyState(game.player);
        game.player.auctions.active = [];
        game.player.auctions.nextRefreshDay = 0;
        PlayerEconomy.ensureAuctionListings(game.player, game.world);
        const lot = game.player.auctions.active[0];
        const r = conserves(() => PlayerEconomy.placeAuctionBid(game.player, lot.id, game.world));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBeLessThan(0);
        // Bid again over our own stake: the old stake comes back, the new one goes in
        const r2 = conserves(() => PlayerEconomy.placeAuctionBid(game.player, lot.id, game.world));
        expect(r2.moved).toBe(-lot.minIncrement);
    });

    it("a mercenary company's bonus is spent where it camps", () => {
        rich();
        PlayerMilitary._ensureMercenaryState(game.player);
        game.player.mercenaryCompanies.push({ id: 'C-test', name: 'Test Company', loyalty: 50, dailyWage: 10, daysRemaining: 5 });
        const r = conserves(() => PlayerMilitary.payMercenaryBonus(game.player, 'C-test', 120, game.world));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBe(-120);
        game.player.mercenaryCompanies = game.player.mercenaryCompanies.filter(c => c.id !== 'C-test');
    });

    it("an envoy's fee goes half to each court's chests", () => {
        rich();
        const [a, b] = realms;
        const ta = a.treasury, tb = b.treasury;
        const r = conserves(() => RealmPolitics._payCourts(game.world, game.player, 101, a, b));
        expect(r.moved).toBe(-101);
        expect(a.treasury - ta + b.treasury - tb).toBeCloseTo(101, 2);
    });

    it("a coastal raid's plunder comes out of the town's own purse, no more than it holds", () => {
        rich();
        const before = town.economy.gold;
        const res = {};
        const r = conserves(() => CoastalRaids._sack(game.player, game.world, town, [], true, res));
        expect(res.plunder).toBeGreaterThan(0);
        expect(res.plunder).toBeLessThanOrEqual(before);
        expect(r.moved).toBe(res.plunder);
        expect(r.booked).toBe(0);
    });

    it("a wreck's coin off the bottom is booked found; let go in a blackout, booked lost", () => {
        rich();
        game.player.dive = { gold: 0, haul: {}, treasures: 0, finds: 0 };
        const r = conserves(() => Diving.take(game.player, { gold: 40 }, game.world));
        expect(r.moved).toBe(40);
        expect(r.booked).toBe(40);
        const r2 = conserves(() => PlayerCoin.lost(game.world, game.player, 40, 'lostAtSea'));
        expect(r2.moved).toBe(-40);
        expect(r2.booked).toBe(-40);
        game.player.dive = null;
    });

    it('the stable buys tamed horses out of the town purse', () => {
        rich();
        game.player.inventory.horse = 2;
        const r = conserves(() => SettlementServices.sellTamedHorses(game.player, town));
        expect(r.out.success).toBe(true);
        expect(r.moved).toBe(r.out.gold);
        expect(r.moved).toBeGreaterThan(0);
    });

    it("a wilds cache is coin found; a loss in the wilds goes to the nearest town", () => {
        rich();
        const r = conserves(() => Wilds._applyOutcome(game.player, game.world, {}, {}, { gold: [25, 25] }));
        expect(r.moved).toBe(25);
        expect(r.booked).toBe(25);
        const r2 = conserves(() => Wilds._applyOutcome(game.player, game.world, {}, {}, { gold: [-15, -15] }));
        expect(r2.moved).toBe(-15);
        expect(r2.booked).toBe(0);
    });

    it("a mercenary contract's retainer comes out of the employer's chests and towns", () => {
        rich();
        const k = realms[0];
        const c = { type: 'escort', kingdomId: k.id, payment: 300, losses: 0, loot: 0, log: [], opposition: 'bandits' };
        game.player.activeContract = c;
        const r = conserves(() => MercContracts._finish(game.player, game.world, c, 'defeat', 0, null));
        expect(r.moved).toBeGreaterThan(0);
        expect(r.booked).toBe(0);
    });

    it("a sowing contract's share is paid out of the town's purse at harvest", () => {
        rich();
        game.player.plantingContracts = [{ settlementName: town.name, q: tile.q, r: tile.r, signedDay: 0, dueDay: -1, payout: 60 }];
        const r = conserves(() => SeasonalWork.processDaily(game.player, game.world));
        expect(r.moved).toBeGreaterThan(0);
        expect(r.booked).toBe(0);
    });

    it('a battle\'s spoils come out of the beaten band\'s packs', () => {
        rich();
        const band = { type: 'raider', q: tile.q, r: tile.r, inventory: { gold: 200 } };
        game.world.units.push(band);
        try {
            const r = conserves(() => PlayerMilitary._battleSpoils(game.player, true, 40, { lootPurse: band.inventory }));
            expect(r.moved).toBeGreaterThan(0);
            expect(r.moved + band.inventory.gold).toBe(200);
        } finally {
            game.world.units.splice(game.world.units.indexOf(band), 1);
        }
    });

    it("the crown's tribute is drawn from its chests (PlayerCoin.receive from a realm)", () => {
        rich();
        const k = realms[1];
        const r = conserves(() => PlayerCoin.receive(game.world, game.player, 150, k, 'rivalTribute'));
        expect(r.moved).toBe(r.out);
        expect(r.out).toBeGreaterThan(0);
    });

    it("the army's upkeep is spent in the town nearest the camp", () => {
        rich();
        game.player.army = [{ type: 'militia', strength: 10, upkeep: 2, experience: 0 }];
        const r = conserves(() => PlayerMilitary.payUpkeep(game.player, game.world));
        expect(r.moved).toBeLessThanOrEqual(0);
        game.player.army = [];
    });

    it("reinforcing and aiding a colony pays the colony's own purse (the action menu)", () => {
        rich();
        town.colony = { garrisonStrength: 10, loyalty: 50 };
        const spy = vi.spyOn(ActionMenu, 'showManageColonyMenu').mockImplementation(() => {});
        try {
            const before = town.economy.gold;
            const r = conserves(() => ActionMenu.reinforceColony(game, tile.q, tile.r));
            expect(r.moved).toBe(-100);
            const r2 = conserves(() => ActionMenu.sendGoldToColony(game, tile.q, tile.r));
            expect(r2.moved).toBe(-150);
            expect(town.economy.gold).toBeCloseTo(before + 250, 2);
        } finally {
            spy.mockRestore();
            delete town.colony;
        }
    });

    it('a gift of gold to a townsperson goes into their own purse', () => {
        rich();
        if (!town.folk) town.folk = { people: [] };
        if (!Array.isArray(town.folk.people)) town.folk.people = [];
        const person = { id: 'gift-test', first: 'Ada', purse: 5 };
        town.folk.people.push(person);
        try {
            const r = conserves(() => PlayerCoin.pay(game.world, game.player, 30, { purse: person, key: 'purse' }, 'donation'));
            expect(r.moved).toBe(-30);
            expect(person.purse).toBe(35);
        } finally {
            town.folk.people.splice(town.folk.people.indexOf(person), 1);
        }
    });

    it("a companion spends their own purse in the towns: their keep, kit, and coin sent home", () => {
        const npc = { id: 'comp-test', firstName: 'Bram', isAlive: true, purse: 200, kingdomId: town.kingdom, settlementQ: tile.q, settlementR: tile.r, companion: { values: [] } };
        Relationships._npcs.push(npc);
        try {
            const before = town.economy.gold;
            const r = conserves(() => Companions._spend(game.player, [npc], game.world, 15));
            expect(r.out).toBeGreaterThan(2);
            expect(npc.purse).toBeCloseTo(200 - r.out, 2);
            expect(town.economy.gold).toBeCloseTo(before + r.out, 2);
            expect(r.booked).toBe(0);
        } finally {
            Relationships._npcs.splice(Relationships._npcs.indexOf(npc), 1);
        }
    });

    it("with no world, a headless payment still pays as asked", () => {
        const p = { gold: 10, q: 0, r: 0 };
        expect(PlayerCoin.receive(null, p, 20, null)).toBe(20);
        expect(p.gold).toBe(30);
        expect(Economy.townPurse(null)).toBe(null);
    });
});
