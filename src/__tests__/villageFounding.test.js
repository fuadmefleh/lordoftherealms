// Found your own settlements (systems/founding.js, world/villageFounding.js):
// settlers really leave a town you hold (or one that agrees), carry grain,
// tools and timber from your packs or its market, walk to a site picked on
// the map, and found a village of yours that grows, becomes a town and buds.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Founding } from '../systems/founding.js';
import { VillageFounding } from '../world/villageFounding.js';
import { Holdings } from '../systems/holdings.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Economy } from '../world/economy.js';
import { World } from '../world/world.js';
import { PlayerActions } from '../player/playerActions.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Make the biggest town on a land with room the player's own holding; stand the player in it. */
function holdATown(game) {
    const { world, player } = game;
    const views = world.getSettlementViews().slice().sort((a, b) => b.population - a.population);
    for (const v of views) {
        const t = world.getTile(v.q, v.r);
        if (!t.settlement || t.settlement.population < 400) continue;
        const sites = VillageFounding.bestSites(world, t, { player, maxRange: 10, limit: 3 });
        if (!sites.length) continue;
        t.settlement.colony = { loyalty: 80, foundedDay: 0, motherKingdom: t.settlement.kingdom, isPlayerColony: true, garrisonStrength: 0, indigenousRelation: 0 };
        player.colonies = [{ q: t.q, r: t.r, name: t.settlement.name, foundedDay: 0 }];
        player.q = t.q; player.r = t.r;
        player.gold = 5000;
        return { tile: t, sites };
    }
    throw new Error('no town with room around it');
}

function walk(game, maxDays = 60) {
    const { world, player } = game;
    for (let d = 0; d < maxDays; d++) {
        world.advanceDay(player, {});
        if (!world.units.some(u => !u.destroyed && u.expedition)) return d + 1;
    }
    return -1;
}

describe('surveying a site', () => {
    it('refuses water, a town, ground too near a town; scores open land on food, water, timber, stone, trade', () => {
        const game = newGame(9101, { kingdomCount: 4 });
        const { world, player } = game;
        const town = world.getSettlementViews()[0];
        expect(VillageFounding.survey(world, town.q, town.r, { player }).ok).toBe(false);
        const near = Hex.neighbors(town.q, town.r).map(n => world.getTile(n.q, n.r)).find(t => t && t.terrain.passable && !t.settlement);
        const sNear = VillageFounding.survey(world, near.q, near.r, { player });
        expect(sNear.ok).toBe(false);
        expect(sNear.reasons.join(' ')).toMatch(/Too near/);
        const water = world.tiles.flat().find(t => t.terrain.id === 'ocean');
        expect(VillageFounding.survey(world, water.q, water.r, { player }).reasons.join(' ')).toMatch(/water/);
        const best = VillageFounding.bestSites(world, town, { player, maxRange: 10, limit: 5 });
        expect(best.length).toBeGreaterThan(0);
        for (const s of best) {
            expect(s.ok).toBe(true);
            expect(s.score).toBeGreaterThan(0);
            expect(Object.keys(s.parts).sort()).toEqual(['food', 'stone', 'timber', 'trade', 'water']);
        }
        // best first
        for (let i = 1; i < best.length; i++) expect(best[i - 1].score).toBeGreaterThanOrEqual(best[i].score);
    });

    it("another realm's heartland is refused", () => {
        const game = newGame(9102, { kingdomCount: 4 });
        const { world, player } = game;
        player.allegiance = null;
        const k = world.kingdoms.find(x => x.isAlive);
        const own = world.getSettlementViews().find(s => s.kingdom === k.id);
        // a claimed hex 3 from its town, else skip
        const hex = Hex.hexesInRange(own.q, own.r, 3).map(h => world.getTile(h.q, h.r))
            .find(t => t && t.kingdom === k.id && t.terrain.passable && !t.settlement && Hex.wrappingDistance(t.q, t.r, own.q, own.r, world.width) === 3);
        if (!hex) return;
        const s = VillageFounding.survey(world, hex.q, hex.r, { player });
        expect(s.reasons.join(' ')).toMatch(/heartland/);
    });
});

describe('founding a village from a town you hold', () => {
    it('settlers, goods and coin really move; the party walks; the village is yours', () => {
        const game = newGame(9103, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile, sites } = holdATown(game);
        const town = tile.settlement;
        const src = Founding.source(player, world, tile.q, tile.r);
        expect(src.ok).toBe(true);
        expect(src.held).toBe(true);
        const n = Math.min(25, src.max);
        player.inventory = { ...(player.inventory || {}), grain: 20 };
        const site = sites[0];
        const plan = Founding.plan(player, world, tile, site, n);
        expect(plan.reasons).toEqual([]);
        expect(plan.purses).toBe(0);
        const grainPlan = plan.supplies.find(x => x.id === 'grain');
        expect(grainPlan.need).toBe(n * 3);
        expect(grainPlan.packs).toBe(20);

        const pop0 = town.population;
        const purse0 = town.economy.gold;
        const gold0 = player.gold;
        const grainStock0 = SettlementMarket.stock(town, 'grain');
        const res = Founding.dispatch(player, world, tile, site, n, { name: 'Newholm' });
        expect(res.reason || 'ok').toBe('ok');
        expect(town.population).toBe(pop0 - n);
        expect(player.inventory.grain || 0).toBe(0);
        expect(SettlementMarket.stock(town, 'grain')).toBeCloseTo(grainStock0 - grainPlan.market, 1);
        // what the player paid went into the town's purse (market goods + guides)
        expect(gold0 - player.gold).toBe(res.paid);
        expect(town.economy.gold - purse0).toBeCloseTo(res.paid, 0);
        const unit = res.unit;
        expect(unit.population).toBe(n);
        expect(unit.inventory.grain).toBe(n * 3);
        expect(unit.q).toBe(tile.q);

        // A second party can't take the same ground
        expect(VillageFounding.survey(world, site.q, site.r, { player }).reasons.join(' ')).toMatch(/bound/);

        const days = walk(game, 80);
        expect(days).toBeGreaterThan(0);
        const vt = world.getTile(site.q, site.r);
        const v = vt.settlement;
        expect(v).toBeTruthy();
        expect(v.name).toBe('Newholm');
        expect(v.playerFounded).toBe(true);
        expect(v.type).toBe('village');
        expect(v.motherTown).toBe(town.name);
        expect(v.population).toBeGreaterThanOrEqual(n - 2);
        expect(v.population).toBeLessThanOrEqual(n + 2);
        expect(v.colony.isPlayerColony).toBe(true);
        expect(player.colonies.some(c => c.q === vt.q && c.r === vt.r)).toBe(true);
        expect(Holdings.isHolding(player, world, vt.q, vt.r)).toBe(true);
        // its market held only what they carried (tools, timber), no stock from nowhere
        const m = v.market.stock;
        for (const [id, qty] of Object.entries(m)) {
            if (id === 'tools' || id === 'wood') continue;
            expect(qty).toBeLessThan(5);
        }
    });

    it('from a town that agrees: the player stands there and pays each settler a purse that becomes the village coin', () => {
        const game = newGame(9104, { kingdomCount: 4 });
        const { world, player } = game;
        player.gold = 5000;
        player.colonies = [];
        const views = world.getSettlementViews().slice().sort((a, b) => b.population - a.population);
        let tile = null, site = null;
        for (const v of views) {
            const t = world.getTile(v.q, v.r);
            const sites = VillageFounding.bestSites(world, t, { player, maxRange: 10, limit: 1 });
            if (sites.length && t.settlement.population > 400) { tile = t; site = sites[0]; break; }
        }
        // away from the town it won't send anyone
        player.q = site.q; player.r = site.r;
        expect(Founding.source(player, world, tile.q, tile.r).ok).toBe(false);
        player.q = tile.q; player.r = tile.r;
        if (tile.settlement.kingdom) player.reputation = { ...(player.reputation || {}), [tile.settlement.kingdom]: 0 };
        const src = Founding.source(player, world, tile.q, tile.r);
        expect(src.ok).toBe(true);
        expect(src.held).toBe(false);
        const n = Math.min(12, src.max);
        const res = Founding.dispatch(player, world, tile, site, n, {});
        expect(res.reason || 'ok').toBe('ok');
        expect(res.unit.expedition.coin).toBe(n * src.purse);
        walk(game, 80);
        const v = world.getTile(site.q, site.r).settlement;
        expect(v && v.playerFounded).toBe(true);
        expect(v.economy.gold).toBeGreaterThanOrEqual(0);
        expect(player.colonies.length).toBe(1);
        // a bad name in the realm and they won't go
        if (tile.settlement.kingdom) {
            player.reputation[tile.settlement.kingdom] = -50;
            expect(Founding.source(player, world, tile.q, tile.r).reason).toMatch(/too poor/);
        }
    });

    it('is offered in the action menu at a town you hold', () => {
        const game = newGame(9105, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile } = holdATown(game);
        const a = PlayerActions.getAvailableActions(player, tile, world).find(x => x.type === 'send_pioneers');
        expect(a).toBeTruthy();
        expect(a.label).toBe('Found a Village');
        expect(a.disabled).toBe(false);
    });
});

describe('the village over the years', () => {
    it('is fed and grows, becomes a town, and sends out a daughter village', () => {
        const game = newGame(9106, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile, sites } = holdATown(game);
        // an independent holding: no realm runs its year, the founding module does
        player.allegiance = null;
        const res = Founding.dispatch(player, world, tile, sites[0], 30, { name: 'Firstfield' });
        expect(res.reason || 'ok').toBe('ok');
        walk(game, 80);
        const vt = world.getTile(sites[0].q, sites[0].r);
        const v = vt.settlement;
        expect(v).toBeTruthy();
        v.kingdom = null; vt.kingdom = null;
        const pop0 = v.population;
        // run the village's own years (a year is 120 days)
        Utils.setSeed(5);
        const start = world.day;
        let town = null, budded = false;
        for (let d = 1; d <= 120 * 30; d++) {
            world.day = start + d;
            world.year = world.baseYear + Math.floor((world.day - 1) / 120);
            VillageFounding.processDay(world, player, {});
            if (!town && v.type === 'town') town = world.year - v.founded;
            if (world.units.some(u => !u.destroyed && u.expedition && u.expedition.bud)) budded = true;
            if (town && budded) break;
        }
        if (process.env.FOUND_VERBOSE) console.info('growth', { pop0, pop: v.population, townAfterYears: town, budded, year: world.year - v.founded });
        expect(v.population).toBeGreaterThan(pop0 * 5);
        expect(town).not.toBeNull();
        expect(town).toBeGreaterThanOrEqual(12);
        expect(budded).toBe(true);
        expect(VillageFounding.state(player).budded).toBeGreaterThan(0);
    });
});

describe('save and load', () => {
    it('a party on the road and a founded village survive a save', () => {
        const game = newGame(9107, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile, sites } = holdATown(game);
        const res = Founding.dispatch(player, world, tile, sites[0], 20, { name: 'Savedale' });
        expect(res.reason || 'ok').toBe('ok');
        world.advanceDay(player, {});
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        const savedPlayer = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        expect(savedPlayer.founding).toBeTruthy();
        const again = new World(world.width, world.height);
        Utils.setSeed(1);
        again.generate({ ...(world.generationParams || {}) });
        SaveLoad.restoreWorld(saved, again);
        const party = again.units.find(u => u.expedition);
        expect(party).toBeTruthy();
        expect(party.expedition.name).toBe('Savedale');
        expect(party.population).toBe(20);
        expect(typeof party.update).toBe('function');
        player.colonies = savedPlayer.colonies;
        game.world = again;
        walk({ world: again, player }, 80);
        const v = again.getTile(sites[0].q, sites[0].r).settlement;
        expect(v && v.name).toBe('Savedale');
        const saved2 = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(again)));
        const third = new World(world.width, world.height);
        third.generate({ ...(world.generationParams || {}) });
        SaveLoad.restoreWorld(saved2, third);
        const v3 = third.getTile(sites[0].q, sites[0].r).settlement;
        expect(v3.playerFounded).toBe(true);
        expect(v3.colony.isPlayerColony).toBe(true);
        expect(v3.population).toBe(v.population);
    });
});

describe('the planner panel', () => {
    it('draws sources, sites and the bill, and sends the party', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const game = newGame(9108, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile, sites } = holdATown(game);
        const shown = [];
        const notes = [];
        game.ui = {
            showCustomPanel: (title, html) => shown.push({ title, html }),
            hideCustomPanel: () => {},
            showNotification: (t, m, kind) => notes.push({ t, m, kind }),
            updateStats: () => {},
        };
        game.renderer = {};
        ActionMenu.showFoundVillage(game, tile.q, tile.r);
        let html = shown[shown.length - 1].html;
        expect(html).toMatch(/Settlers from/);
        expect(html).toMatch(/Pick the site on the map/);
        expect(html).toMatch(/data-am-act="foundVillageSite"/);
        ActionMenu.foundVillageSite(game, sites[0].q, sites[0].r);
        html = shown[shown.length - 1].html;
        expect(html).toMatch(/The bill/);
        expect(html).toMatch(/data-am-act="foundVillageGo"/);
        expect(game.renderer.roadPlan.segments.length).toBeGreaterThan(1);
        const pop0 = tile.settlement.population;
        ActionMenu.foundVillageGo(game);
        expect(notes.pop().kind).toBe('success');
        expect(tile.settlement.population).toBeLessThan(pop0);
        expect(world.units.some(u => !u.destroyed && u.expedition)).toBe(true);
        // a hex picked on the map that won't do says why
        ActionMenu.foundVillageSite(game, tile.q, tile.r);
        expect(shown[shown.length - 1].html).toMatch(/Not here/);
    });
});

describe('paying in kind and the old Found Colony', () => {
    it('a town that barters is paid in goods, not coin', async () => {
        const { Barter } = await import('../world/barter.js');
        const game = newGame(9109, { kingdomCount: 4 });
        const { world, player } = game;
        const { tile, sites } = holdATown(game);
        world.barter = { allCoin: null, coinDay: null };
        for (const v of world.getSettlementViews()) {
            const t = world.getTile(v.q, v.r);
            if (t !== tile) t.settlement.coinSince = 1;
        }
        expect(Barter.active(world, tile.settlement)).toBe(true);
        Barter.install(player, world);
        player.inventory = { ...(player.inventory || {}), hide: 400, wool: 400 };
        const town = tile.settlement;
        Economy.initSettlement(town);
        SettlementMarket.ensure(town);
        const purse0 = town.economy.gold;
        const hide0 = SettlementMarket.stock(town, 'hide') + SettlementMarket.stock(town, 'wool');
        const coin0 = Barter.coinOf(player);
        const plan = Founding.plan(player, world, tile, sites[0], 15);
        expect(plan.inKind).toBe(true);
        expect(plan.reasons).toEqual([]);
        const res = Founding.dispatch(player, world, tile, sites[0], 15, {});
        expect(res.reason || 'ok').toBe('ok');
        expect(town.economy.gold).toBe(purse0);
        expect(Barter.coinOf(player)).toBe(coin0);
        expect(SettlementMarket.stock(town, 'hide') + SettlementMarket.stock(town, 'wool')).toBeGreaterThan(hide0);
        expect((player.inventory.hide || 0) + (player.inventory.wool || 0)).toBeLessThan(800);
    });

    it("the old Found Colony's price goes to a real purse and its first hands leave a real town", async () => {
        const { Colonization } = await import('../world/colonization.js');
        const game = newGame(9110, { kingdomCount: 4 });
        const { world, player } = game;
        player.allegiance = null;
        player.gold = 2000;
        const towns = world.getSettlementViews();
        let site = null;
        for (const t of world.tiles.flat()) {
            if (!t.terrain.passable || t.settlement || t.kingdom || t.playerProperty) continue;
            const d = Math.min(...towns.map(s => Hex.wrappingDistance(t.q, t.r, s.q, s.r, world.width)));
            if (d >= Colonization.MIN_SETTLEMENT_DISTANCE && d <= 10) { site = t; break; }
        }
        expect(site).toBeTruthy();
        const payee = Colonization._colonyPayee(world, player, site);
        expect(payee.town).toBeTruthy();
        Economy.initSettlement(payee.town);
        const purse0 = payee.town.economy.gold;
        const donor = Colonization._settlerDonor(site, world);
        const pop0 = donor ? donor.population : 0;
        const res = Colonization.foundPlayerColony(player, site, world, site.q, site.r, 'Oldway', 'coexistence');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(2000 - Colonization.COLONY_COST);
        expect(payee.town.economy.gold - purse0).toBe(Colonization.COLONY_COST);
        expect(res.paidTo).toBe(payee.town.name);
        if (donor) {
            expect(res.firstColonists).toBeGreaterThan(0);
            expect(donor.population).toBe(pop0 - res.firstColonists);
            expect(site.settlement.colony.recruitment.enRoute).toBe(res.firstColonists);
        }
    });
});
