// Uncharted lands (systems/discovery.js): places on no map until found —
// chosen lazily from the generated map by a seed hash, found at sea, on foot,
// by exploring, from rumours and old maps, or first by rivals; named, sold to
// a realm's archive, gathered from, settled and contested.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { Discovery } from '../systems/discovery.js';
import { Ships } from '../systems/ships.js';
import { Rivals } from '../systems/rivals.js';
import { Delves } from '../systems/delves.js';
import { Cartography } from '../systems/cartography.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    return () => logSpy.mockRestore();
});

let game;
beforeEach(() => {
    game = newGame(101);
    Utils.setSeed(777);
});

const WATER = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'];
const isWater = (t) => !!(t && WATER.includes(t.terrain.id));
const dist = (w, a, b) => Hex.wrappingDistance(a.q, a.r, b.q, b.r, w.width);

function sites() {
    return Discovery.ensureSites(game.player, game.world);
}

/** Advance the world a day and run the discovery tick. */
function tick(n = 1) {
    let out = null;
    for (let i = 0; i < n; i++) {
        game.world.day++;
        out = Discovery.processDay(game.world, game.player);
    }
    return out;
}

function stand(q, r) {
    game.player.q = q;
    game.player.r = r;
}

function makeShip(q, r, extra = {}) {
    const ship = {
        id: 'ship_disc', typeId: 'caravel', name: 'Wayfinder', q, r, status: 'docked', condition: 100,
        customizations: [], cargo: {}, crew: Ships.getShipEffectiveStats({ typeId: 'caravel' }).crewRequired, morale: 70, ...extra,
    };
    game.player.ships = [ship];
    return ship;
}

/** A water hex `d` leagues from (q, r). */
function waterAt(q, r, d) {
    const w = game.world;
    return Hex.hexesInRange(q, r, d)
        .map(h => w.getTile(Hex.wrapQ(h.q, w.width), h.r))
        .find(t => t && isWater(t) && Hex.wrappingDistance(t.q, t.r, q, r, w.width) === d) || null;
}

describe('data', () => {
    it('is valid, and its exotic goods join the GOODS table', () => {
        expect(Discovery.validate()).toEqual([]);
        for (const g of Discovery.goods()) {
            const def = PlayerEconomy.GOODS[g.id.toUpperCase()];
            expect(def, g.id).toBeTruthy();
            expect(PlayerInventory.goodValue(g.id)).toBe(g.basePrice);
        }
    });

    it('no market sells an exotic good, so nothing buys it cheap and sells it dear', () => {
        const w = game.world;
        for (const s of w.getAllSettlements()) {
            const tile = w.getTile(s.q, s.r);
            for (const g of Discovery.goods()) {
                expect(Economy.marketAsk(w, tile, g.id)).toBe(null);
                expect(Trading.getAvailableGoods(tile.settlement, tile, w).some(x => x.id === g.id)).toBe(false);
                if (Ships.isPortTile(w, s.q, s.r)) {
                    expect(Ships.getPortMarket(w, s.q, s.r).some(e => e.id === g.id)).toBe(false);
                }
            }
        }
    });
});

describe('choosing the places', () => {
    it('picks islands, coves, valleys and reefs from the map — off any realm, far from towns', () => {
        const list = sites();
        expect(list.length).toBeGreaterThanOrEqual(6);
        const kinds = new Set(list.map(s => s.kind));
        expect(kinds.has('island')).toBe(true);
        expect(kinds.has('reef')).toBe(true);
        const w = game.world;
        const towns = w.getAllSettlements();
        for (const s of list) {
            const t = w.getTile(s.q, s.r);
            expect(t.settlement, s.name).toBeFalsy();
            expect(t.kingdom, s.name).toBeFalsy();
            expect(Math.min(...towns.map(x => dist(w, s, x)))).toBeGreaterThanOrEqual(5);
            if (s.kind === 'reef') expect(isWater(t)).toBe(true);
            else expect(isWater(t)).toBe(false);
            expect(s.discovered).toBe(null);
            expect(s.known).toBe(false);
        }
        expect(new Set(list.map(s => s.name)).size).toBe(list.length);
    });

    it('is the same for the same world and draws nothing from the game RNG', () => {
        Utils.setSeed(55);
        const a = sites().map(s => `${s.kind}@${s.q},${s.r}:${s.features.goods.join('+')}`);
        const next = Utils.random();
        Utils.setSeed(55);
        expect(Utils.random()).toBe(next);
        const again = newGame(101);
        const b = Discovery.ensureSites(again.player, again.world).map(s => `${s.kind}@${s.q},${s.r}:${s.features.goods.join('+')}`);
        expect(b).toEqual(a);
    });

    it('waits for the first day: nothing is chosen during world generation', () => {
        expect(game.player.discovery).toBeUndefined();
        tick();
        expect(Discovery.state(game.player).initialized).toBe(true);
    });
});

describe('finding a place', () => {
    it('on foot: the finder names it, earns renown and a chronicle entry; ruins and natives appear', () => {
        const site = sites().find(s => s.kind !== 'reef' && (s.features.ruins || s.features.natives)) || sites().find(s => s.kind !== 'reef');
        stand(site.q, site.r);
        const renown = game.player.renown || 0;
        const out = tick();
        expect(out.found).toContain(site);
        expect(site.discovered.by).toBe('player');
        expect(site.known).toBe(true);
        expect(site.naming).toBeTruthy();
        expect(game.player.renown).toBeGreaterThan(renown);
        expect(out.notices.some(n => n.title.startsWith('Discovery'))).toBe(true);
        // The finder's own name is among the choices
        expect(site.nameOptions.some(n => n.includes(game.player.lastName))).toBe(true);
        const prestige = game.player.house.prestige;
        const res = Discovery.nameSite(game.player, game.world, site.id, site.nameOptions[1]);
        expect(res.success).toBe(true);
        expect(site.name).toBe(site.nameOptions[1]);
        expect(site.naming).toBe(null);
        expect(game.player.house.prestige).toBeGreaterThan(prestige);
        expect(game.player.house.history.some(h => h.text.includes(site.name) && h.tags.includes('discovery'))).toBe(true);
        if (site.ruinsAt) {
            const t = game.world.getTile(site.ruinsAt.q, site.ruinsAt.r);
            expect(Delves.isDelveSite(t)).toBe(true);
            expect(t.improvement.name).toContain(site.name);
        }
        if (site.nativesAt) {
            const t = game.world.getTile(site.nativesAt.q, site.nativesAt.r);
            expect(t.indigenous.peopleId).toBe(site.features.natives);
            expect(t.indigenous.discovered).toBe(true);
        }
    });

    it('takes the default name when the finder gives none', () => {
        const site = sites().find(s => s.kind !== 'reef');
        stand(site.q, site.r);
        tick();
        const first = site.nameOptions[0];
        tick(Discovery.config().namingDays + 1);
        expect(site.naming).toBe(null);
        expect(site.name).toBe(first);
    });

    it('at sea: a lookout may sight a reef or island within a few leagues', () => {
        const site = sites().find(s => s.kind === 'reef' || s.kind === 'island');
        const spot = waterAt(site.q, site.r, 3);
        expect(spot).toBeTruthy();
        const ship = makeShip(spot.q, spot.r, { status: 'at_sea' });
        stand(spot.q, spot.r);
        game.player.boardedShip = ship.id;
        let days = 0;
        while (!site.discovered && days < 40) { tick(); days++; }
        expect(site.discovered && site.discovered.by).toBe('player');
        expect(['sighting', 'sea']).toContain(site.discovered.how);
    });

    it('the explore-ocean activity can turn one up', () => {
        const site = sites().find(s => s.kind === 'reef' || s.kind === 'island');
        const spot = waterAt(site.q, site.r, 4);
        const ship = makeShip(spot.q, spot.r, { status: 'at_sea' });
        stand(spot.q, spot.r);
        game.player.boardedShip = ship.id;
        let res = null;
        for (let i = 0; i < 30 && !(res && res.discovery); i++) res = Discovery.exploreOcean(game.player, ship.id, game.world);
        expect(res.discovery).toBe(site);
        expect(site.discovered.how).toBe('exploration');
    });

    it('an uncharted reef can hole the hull of the ship that finds it', () => {
        const reefs = sites().filter(s => s.kind === 'reef');
        let hit = false;
        for (let seed = 1; seed < 30 && !hit; seed++) {
            game = newGame(101);
            Utils.setSeed(seed);
            const site = Discovery.ensureSites(game.player, game.world).find(s => s.kind === 'reef');
            const spot = waterAt(site.q, site.r, 1);
            const ship = makeShip(spot.q, spot.r, { status: 'at_sea' });
            stand(spot.q, spot.r);
            game.player.boardedShip = ship.id;
            tick();
            hit = ship.condition < 100;
        }
        expect(reefs.length).toBeGreaterThan(0);
        expect(hit).toBe(true);
    });
});

describe('rumours, maps and rivals', () => {
    it('tavern notice boards carry rumours of a place near the town, without drawing RNG', () => {
        const w = game.world;
        sites();
        const towns = w.getAllSettlements();
        let found = null;
        for (let d = 0; d < 40 && !found; d++) {
            w.day++;
            for (const s of towns) {
                const r = Discovery.tavernRumors(game.player, w, w.getTile(s.q, s.r));
                if (r.length) { found = r[0]; break; }
            }
        }
        expect(found).toBeTruthy();
        const site = Discovery.get(game.player, found.siteId);
        expect(site.hint).toBe('rumoured');
        expect(Hex.wrappingDistance(site.hintQ, site.hintR, site.q, site.r, w.width)).toBeLessThanOrEqual(Discovery.config().rumour.blur * 2);
        expect(Discovery.journal(game.player).hinted).toContain(site);
    });

    it('ancient maps can chart one — the same map always marks the same place', () => {
        sites();
        let hit = null;
        for (let i = 0; i < 40 && !hit; i++) {
            const map = { id: `ancient_test_${i}`, type: 'ancient', centerQ: 10, centerR: 10, radius: 15 };
            const res = Discovery.chartFromMap(game.player, game.world, map);
            if (res) hit = { map, res };
        }
        expect(hit).toBeTruthy();
        expect(hit.res.site.hint).toBe('charted');
        expect(hit.map.discoverySiteId).toBe(hit.res.site.id);
        // Re-reading changes nothing, and Cartography.applyMap goes through the same door
        expect(Discovery.chartFromMap(game.player, game.world, hit.map)).toBe(null);
        const map2 = { ...hit.map, discoverySiteId: undefined, tiles: [], deliberateErrors: [], createdBy: 'Unknown', accuracy: 0.5 };
        const g2 = newGame(101);
        const r2 = Cartography.applyMap(g2.player, map2, g2.world, { detected: true });
        expect(r2.discovery && r2.discovery.site.id).toBe(hit.res.site.id);
    });

    it('rival adventurers may find a place first, and sell it to a realm', () => {
        const w = game.world;
        sites();
        w.day = Discovery.config().rivals.startDay;
        Rivals.ensureCast(game.player, w);
        let site = null;
        for (let i = 0; i < 400 && !site; i++) {
            tick();
            site = Discovery.sites(game.player).find(s => s.discovered && s.discovered.by !== 'player');
        }
        expect(site).toBeTruthy();
        expect(Rivals.get(game.player, site.discovered.by)).toBeTruthy();
        expect(site.known).toBe(true);
        expect(site.knownBy.length).toBe(1);
        expect(Rivals.news(game.player).some(n => n.text.includes(site.name))).toBe(true);
        // The player can still reach it, but it is not theirs to name or sell
        stand(site.q, site.r);
        tick();
        expect(site.visited).toBe(true);
        expect(site.discovered.by).not.toBe('player');
        expect(Discovery.nameSite(game.player, w, site.id, 'Mine').success).toBe(false);
    });
});

describe('goods, archives, colonies and contests', () => {
    function findOne(pred = () => true) {
        const site = sites().find(s => s.kind !== 'reef' && s.features.goods.length && pred(s));
        stand(site.q, site.r);
        tick();
        Discovery.nameSite(game.player, game.world, site.id, null);
        return site;
    }

    it('gathers exotic goods into the packs, within the inventory cap', () => {
        const site = findOne();
        game.player.inventory = {};
        const res = Discovery.gather(game.player, game.world, site.id);
        expect(res.success).toBe(true);
        for (const [g, n] of Object.entries(res.got)) expect(game.player.inventory[g]).toBe(n);
        expect(Discovery.gather(game.player, game.world, site.id).success).toBe(false); // once a day
        // Full packs: nothing new fits
        tick(10);
        stand(site.q, site.r);
        game.player.inventory = {};
        for (let i = 0; i < PlayerInventory.getCapacity(game.player); i++) game.player.inventory[`junk_${i}`] = 1;
        const full = Discovery.gather(game.player, game.world, site.id);
        expect(full.success).toBe(false);
        expect(PlayerInventory.getUsedSlots(game.player)).toBe(PlayerInventory.getCapacity(game.player));
    });

    it('sells the chart to a royal archive once per realm', () => {
        const site = findOne();
        const w = game.world;
        const town = w.getAllSettlements().find(s => ['town', 'city', 'capital'].includes(s.type) && s.kingdom && (w.getKingdom(s.kingdom).treasury || 0) > 500);
        stand(town.q, town.r);
        const k = w.getKingdom(town.kingdom);
        const gold = game.player.gold;
        const treasury = k.treasury;
        const offer = Discovery.archiveOffer(game.player, w, site);
        expect(offer.price).toBeGreaterThan(0);
        const res = Discovery.sellToArchive(game.player, w, site.id);
        expect(res.success).toBe(true);
        expect(game.player.gold).toBe(gold + offer.price);
        expect(k.treasury).toBe(treasury - offer.price);
        expect(site.knownBy).toContain(k.id);
        expect(Discovery.sellToArchive(game.player, w, site.id).success).toBe(false);
    });

    it('a colony there claims it; a realm that knows of it may contest the claim', () => {
        const site = findOne();
        const w = game.world;
        game.player.gold = 5000;
        const res = Discovery.foundColony(game.player, w, site.id);
        expect(res.success, res.message).toBe(true);
        expect(site.claim.by).toBe('player');
        expect(Discovery._maxStock(site)).toBe(Discovery.config().stock.claimedMax);
        // A strong realm learns of it and contests
        const k = w.kingdoms.find(x => x.isAlive && x.id !== game.player.allegiance);
        site.knownBy.push(k.id);
        site.contest = { kingdomId: k.id, kingdomName: k.name, startDay: w.day, deadline: w.day + 1, tribute: 300, fleet: 9999 };
        tick();
        expect(site.claim.by).toBe(k.id);
        const col = w.getTile(game.player.q, game.player.r);
        expect(col.settlement.colony.isPlayerColony).toBe(false);
        expect((game.player.colonies || []).some(c => c.q === col.q && c.r === col.r)).toBe(false);
    });

    it('paying tribute ends a contest', () => {
        const site = findOne();
        game.player.gold = 5000;
        expect(Discovery.foundColony(game.player, game.world, site.id).success).toBe(true);
        const k = game.world.kingdoms.find(x => x.isAlive);
        site.knownBy.push(k.id);
        site.contest = { kingdomId: k.id, kingdomName: k.name, startDay: 0, deadline: game.world.day + 5, tribute: 300, fleet: 50 };
        const gold = game.player.gold;
        expect(Discovery.payTribute(game.player, game.world, site.id).success).toBe(true);
        expect(game.player.gold).toBe(gold - 300);
        expect(site.contest).toBe(null);
        expect(site.claim.by).toBe('player');
        expect(site.knownBy).not.toContain(k.id);
    });
});

describe('expeditions', () => {
    it('sail into open sea far from every port and end there, the player at the helm', () => {
        const w = game.world;
        const port = w.getAllSettlements().find(s => Ships.isPortTile(w, s.q, s.r) && Ships.seaRoutes(w, s.q, s.r).length);
        const ship = makeShip(port.q, port.r, { cargo: { food: 200 } });
        stand(port.q, port.r);
        const targets = Discovery.expeditionTargets(game.player, w, ship);
        const open = targets.find(t => t.id === 'open');
        expect(open).toBeTruthy();
        const res = Discovery.startExpedition(game.player, w, ship.id, 'open');
        expect(res.success, res.message).toBe(true);
        let last = null;
        for (let i = 0; i < 60 && Ships.getVoyage(game.player); i++) {
            w.day++;
            last = Ships.processDaily(game.player, w);
            if (Ships.describeVoyageEvent(game.player)) Ships.resolveVoyageEvent(game.player, w, null);
            Discovery.processDay(w, game.player);
        }
        expect(last.voyage.expeditionDone).toBe(true);
        expect(game.player.boardedShip).toBe(ship.id);
        expect(ship.status).toBe('at_sea');
        expect(isWater(w.getTile(game.player.q, game.player.r))).toBe(true);
    });
});

describe('saving', () => {
    it('round-trips the places, finds and claims; older saves get a blank record', () => {
        const site = sites().find(s => s.kind !== 'reef');
        stand(site.q, site.r);
        tick();
        Discovery.nameSite(game.player, game.world, site.id, site.nameOptions[1]);
        const before = JSON.stringify(game.player.discovery);
        const g2 = roundTrip(game);
        expect(JSON.stringify(g2.player.discovery)).toBe(before);
        if (site.ruinsAt) expect(g2.world.getTile(site.ruinsAt.q, site.ruinsAt.r).improvement.discoverySite).toBe(site.id);
        const old = { ...game.player };
        delete old.discovery;
        Discovery.loadState(old);
        expect(old.discovery.sites).toEqual([]);
        expect(old.discovery.initialized).toBe(false);
    });
});
