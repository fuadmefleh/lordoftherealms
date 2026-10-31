// Hospitality (systems/hospitality.js): guest houses, inns, grand hotels and
// roadhouses — which a town keeps, the roadhouses on the open road, staying a
// night (rooms, the morning after, Fame's free room, a common room's thief),
// services, the player's own house competing for the town's travellers (its
// staff, prices, cleanliness, week), the NPC houses' week, save/load, the
// inner map's buildings and the panels. Run on a real generated world.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hospitality } from '../systems/hospitality.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerActions } from '../player/playerActions.js';
import { InnerMap } from '../world/innerMap.js';
import { ActionMenu } from '../ui/actionMenu.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
}, 60000);

function reset() {
    const { world, player } = game;
    world.hospitality = null;
    world.day = 40;
    player.gold = 20000;
    player.lodging = null;
    player._restTypeOverride = null;
    player.financeToday = { income: {}, expenses: {} };
}

/** A town of the given type (or any with houses). */
function townOf(type) {
    const { world } = game;
    return world.getSettlementViews().find(s => (!type || s.type === type) && Hospitality.kindsFor(world.getTile(s.q, s.r).settlement).length);
}

function standAt(q, r) {
    game.player.q = q;
    game.player.r = r;
}

/** Build a hospitality property here, finished. */
function build(kind, q, r) {
    const { world, player } = game;
    const tile = world.getTile(q, r);
    const res = PlayerEconomy.buildProperty(player, kind.toUpperCase(), tile, world);
    expect(res.success, res.reason).toBe(true);
    res.property.underConstruction = false;
    res.property.constructionDaysLeft = 0;
    return res.property;
}

function removeProps(q, r) {
    const { world, player } = game;
    const tile = world.getTile(q, r);
    tile.playerProperties = (tile.playerProperties || []).filter(p => !Hospitality.isKind(p.type));
    tile.playerProperty = tile.playerProperties[0] || null;
    player.properties = (player.properties || []).filter(p => !Hospitality.isKind(p.type));
}

beforeEach(reset);

describe('which houses a town keeps', () => {
    it('is a pure hash of the town: the same every time, bigger towns keep more', () => {
        const { world } = game;
        const views = world.getSettlementViews();
        for (const s of views.slice(0, 20)) {
            const a = Hospitality.kindsFor(world.getTile(s.q, s.r).settlement);
            expect(Hospitality.kindsFor(world.getTile(s.q, s.r).settlement)).toEqual(a);
        }
        const avg = type => {
            const list = views.filter(s => s.type === type);
            return list.reduce((n, s) => n + Hospitality.kindsFor(world.getTile(s.q, s.r).settlement).length, 0) / Math.max(1, list.length);
        };
        expect(avg('town')).toBeGreaterThan(avg('village'));
        const cap = views.find(s => s.type === 'capital');
        if (cap) expect(Hospitality.kindsFor(world.getTile(cap.q, cap.r).settlement)).toContain('hotel');
    });

    it('founds named houses with keepers, stars and rooms on first asking, without touching the shared RNG', () => {
        const { world } = game;
        const t = townOf('town');
        Utils.setSeed(77);
        const before = Utils.random();
        Utils.setSeed(77);
        const houses = Hospitality.townHouses(world, t.q, t.r);
        expect(Utils.random()).toBe(before);
        expect(houses.length).toBe(Hospitality.kindsFor(world.getTile(t.q, t.r).settlement).length);
        for (const h of houses) {
            expect(h.name).toMatch(/\S/);
            expect(h.name).not.toMatch(/[{}]/);
            expect(h.keeper).toMatch(/\S+ \S+/);
            expect(h.stars).toBeGreaterThanOrEqual(1);
            expect(h.rooms).toBeGreaterThan(0);
        }
        expect(Hospitality.townHouses(world, t.q, t.r).map(h => h.id)).toEqual(houses.map(h => h.id));
    });

    it('puts roadhouses on open roads away from towns', () => {
        const { world } = game;
        const sites = Hospitality._waysideSites(world);
        expect(sites.length).toBeGreaterThan(0);
        for (const s of sites) {
            const tile = world.getTile(s.q, s.r);
            expect(tile.hasRoad).toBe(true);
            expect(tile.settlement).toBeFalsy();
            const rh = Hospitality.roadhouseAt(world, s.q, s.r);
            expect(rh.kind).toBe('roadhouse');
        }
        const t = townOf();
        expect(Hospitality.roadhouseAt(world, t.q, t.r)).toBeNull();
    });
});

describe('staying the night', () => {
    it('a booked room is an inn night; the morning brings comfort, breakfast and is paid for once', () => {
        const { world, player } = game;
        const t = townOf('town');
        standAt(t.q, t.r);
        const v = Hospitality.listAt(world, player, t.q, t.r).find(x => x.tiers.includes('private'));
        const gold = player.gold;
        const res = Hospitality.book(world, player, v.id, 'private');
        expect(res.ok).toBe(true);
        expect(player.gold).toBe(gold - res.cost);
        expect(res.cost).toBeGreaterThan(0);
        expect(player._restTypeOverride).toBe('inn');
        expect(player.lodging.id).toBe(v.id);
        // A second bed the same night is refused
        expect(Hospitality.book(world, player, v.id, 'private').ok).toBe(false);
        // Breakfast arranged (or included)
        if (!v.breakfastIncluded && v.services.includes('breakfast')) expect(Hospitality.buyService(world, player, v.id, 'breakfast').ok).toBe(true);
        player.needs.hunger = 20;
        player.needs.comfort = 20;
        world.day += 1;
        const out = Hospitality.processDay(world, player);
        expect(out.notices.some(n => /wake/.test(n.text))).toBe(true);
        expect(player.lodging).toBeNull();
        if (v.breakfastIncluded || v.services.includes('breakfast')) expect(player.needs.hunger).toBeGreaterThan(20);
        expect(player.needs.comfort).toBeGreaterThan(20);
    });

    it('services act at once and are charged; morning ones need a bed here', () => {
        const { world, player } = game;
        const t = townOf('town');
        const inn = Hospitality.listAt(world, player, t.q, t.r).find(x => x.kind === 'inn');
        if (!inn) return;
        player.needs.hygiene = 10;
        const gold = player.gold;
        const bath = Hospitality.buyService(world, player, inn.id, 'bath');
        expect(bath.ok).toBe(true);
        expect(player.needs.hygiene).toBeGreaterThan(50);
        expect(player.gold).toBeLessThan(gold);
        expect(Hospitality.buyService(world, player, inn.id, 'breakfast').ok).toBe(false);
        player.mount = null;
        Hospitality.book(world, player, inn.id, inn.tiers[0]);
        expect(Hospitality.buyService(world, player, inn.id, 'stabling').ok).toBe(false);
    });

    it('turns the poor away and lets the celebrated stay free', () => {
        const { world, player } = game;
        const t = townOf('town');
        const v = Hospitality.listAt(world, player, t.q, t.r)[0];
        player.gold = 0;
        const q = Hospitality.quote(world, player, v.id);
        expect(q.tiers.every(x => !x.ok || x.free)).toBe(true);
        player.gold = 1000;
        player.fame = { score: 99999, byRealm: {}, towns: {} };
        const fame = Hospitality.quote(world, player, v.id);
        if (fame.freeRoom) {
            const res = Hospitality.book(world, player, v.id, fame.tiers[0].id);
            expect(res.ok).toBe(true);
            expect(player.gold).toBe(1000);
        }
        player.fame = null;
    });

    it('a common room sometimes lightens your purse, deterministically', () => {
        const { world, player } = game;
        const site = Hospitality._waysideSites(world)[0];
        const rh = Hospitality.roadhouseAt(world, site.q, site.r);
        let robbed = 0;
        for (let d = 100; d < 400; d++) {
            world.day = d;
            player.gold = 500;
            player.lodging = null;
            expect(Hospitality.book(world, player, rh.id, 'common').ok).toBe(true);
            world.day = d + 1;
            const before = player.gold;
            Hospitality.processDay(world, player);
            if (player.gold < before) robbed++;
        }
        expect(robbed).toBeGreaterThan(0);
        expect(robbed).toBeLessThan(150);
    });
});

describe('the player\'s own house', () => {
    it('can only be built where it belongs', () => {
        const { world, player } = game;
        const village = townOf('village') || game.world.getSettlementViews().find(s => s.type === 'village');
        if (village) {
            const c = PlayerEconomy.canBuildProperty(player, 'HOTEL', world.getTile(village.q, village.r), world);
            expect(c.canBuild).toBe(false);
        }
        const t = townOf('town');
        expect(PlayerEconomy.canBuildProperty(player, 'ROADHOUSE', world.getTile(t.q, t.r), world).canBuild).toBe(false);
        const site = Hospitality._waysideSites(world)[0];
        expect(PlayerEconomy.canBuildProperty(player, 'ROADHOUSE', world.getTile(site.q, site.r), world).canBuild).toBe(true);
    });

    it('draws guests from the same travellers as the NPC houses, earns, pays its staff and books it all', () => {
        const { world, player } = game;
        const t = townOf('city') || townOf('town');
        standAt(t.q, t.r);
        const prop = build('inn', t.q, t.r);
        const tile = world.getTile(t.q, t.r);
        const view = Hospitality.listAt(world, player, t.q, t.r).find(v => v.owner === 'player');
        expect(view.name).not.toBe('Inn'); // named on first use
        const occ = Hospitality.occupancy(world, player, t.q, t.r);
        expect(Object.keys(occ).length).toBe(Hospitality.listAt(world, player, t.q, t.r).length);
        const demand = Hospitality.demand(world, t.q, t.r);
        const total = Object.values(occ).reduce((a, b) => a + b, 0);
        expect(total).toBeLessThanOrEqual(Math.round(demand) + Object.keys(occ).length);

        Hospitality.setStaff(prop, 'maid', 1);
        Hospitality.setStaff(prop, 'cook', 1);
        const gold = player.gold;
        const day = Hospitality.runProperty(world, player, tile, prop, 0, 1);
        expect(day.guests).toBe(occ[view.id]);
        expect(day.costs).toBeGreaterThanOrEqual(7); // the cook and the maid
        expect(player.gold).toBe(gold + day.takings - day.costs);
        expect(player.financeToday.expenses.hospitalityCosts || 0).toBeGreaterThan(0);
        removeProps(t.q, t.r);
    });

    it('cheaper rooms and more stars draw more guests; dirt and dear rooms fewer', () => {
        const { world, player } = game;
        const t = townOf('city') || townOf('town');
        const prop = build('inn', t.q, t.r);
        const id = `p:${t.q},${t.r}:inn`;
        const guestsAt = mult => { Hospitality.setPrice(prop, mult); return Hospitality.occupancy(world, player, t.q, t.r)[id]; };
        const cheap = guestsAt(0.6);
        const dear = guestsAt(2);
        expect(cheap).toBeGreaterThanOrEqual(dear);
        Hospitality.setPrice(prop, 1);
        const s0 = Hospitality.playerStars(prop);
        Hospitality.setStaff(prop, 'cook', 1);
        Hospitality.setStaff(prop, 'porter', 1);
        expect(Hospitality.playerStars(prop)).toBeGreaterThan(s0);
        prop.hosp.clean = 0;
        expect(Hospitality.playerStars(prop)).toBeLessThan(s0 + 0.6);
        expect(Hospitality.setPrice(prop, 0.77).ok).toBe(false);
        expect(Hospitality.setStaff(prop, 'cook', -1).ok).toBe(true);
        expect(Hospitality.setStaff(prop, 'cook', -1).ok).toBe(false);
        removeProps(t.q, t.r);
    });

    it('runs through the daily property tick and sends its news through processDay', () => {
        const { world, player } = game;
        const t = townOf('town');
        const prop = build('guest_house', t.q, t.r);
        let notices = 0;
        for (let d = 0; d < 70; d++) {
            world.day++;
            PlayerEconomy.produceGoods(player, world);
            notices += Hospitality.processDay(world, player).notices.length;
        }
        expect(prop.hosp.history.length).toBeGreaterThan(0);
        expect(prop.daysOwned).toBeGreaterThanOrEqual(70);
        expect(notices).toBeGreaterThan(0);
        // The owner stays free
        const v = Hospitality.listAt(world, player, t.q, t.r).find(x => x.owner === 'player');
        const gold = player.gold;
        expect(Hospitality.book(world, player, v.id, v.tiers[0]).ok).toBe(true);
        expect(player.gold).toBe(gold);
        removeProps(t.q, t.r);
    });
});

describe('the NPC houses\' week and the save', () => {
    it('fills, prices and records a week', () => {
        const { world, player } = game;
        const t = townOf('town');
        const houses = Hospitality.townHouses(world, t.q, t.r);
        world.day = 60;
        Hospitality.processDay(world, player);
        expect(houses.every(h => h.history.length === 1)).toBe(true);
        world.day = 61;
        Hospitality.processDay(world, player);
        expect(houses.every(h => h.history.length === 1)).toBe(true);
        world.day = 67;
        Hospitality.processDay(world, player);
        expect(houses.every(h => h.history.length === 2)).toBe(true);
    });

    it('survives a save and load, and older saves start fresh', () => {
        const { world } = game;
        const t = townOf('town');
        Hospitality.townHouses(world, t.q, t.r);
        const ws = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        expect(Object.keys(ws.hospitality.houses).length).toBeGreaterThan(0);
        const back = {};
        Hospitality.restore(ws.hospitality, back);
        expect(JSON.stringify(back.hospitality)).toBe(JSON.stringify(world.hospitality));
        Hospitality.restore(undefined, back);
        expect(back.hospitality.houses).toEqual({});
    });
});

describe('on the inner map and in the panels', () => {
    it('the layout adds the town\'s houses to its required buildings', () => {
        const { world } = game;
        const t = townOf('town');
        const s = world.getTile(t.q, t.r).settlement;
        const layout = InnerMap.settlementLayout(s);
        for (const k of Hospitality.kindsFor(s)) expect(layout.required).toContain(k);
        expect(InnerMap.INTERIOR_LAYOUTS.inn.furniture.some(f => f.type === 'bed')).toBe(true);
        expect(InnerMap.BUILDING_TYPES.hotel.actions).toContain('lodging');
    });

    it('binds buildings to their houses and gives each a keeper from the town', () => {
        const { world, player } = game;
        const t = townOf('town');
        const tile = world.getTile(t.q, t.r);
        InnerMap.currentWorldTile = { q: t.q, r: t.r };
        InnerMap._currentWorldTileRef = tile;
        InnerMap.buildings = Hospitality.kindsFor(tile.settlement).map((k, i) => ({ q: 10 + i * 5, r: 10, type: k, name: k, actions: [] }));
        InnerMap.npcs = [{ id: 1, type: 'villager', name: 'Ada', fullName: 'Ada Stone', uid: `${t.q},${t.r}#1` }, { id: 2, type: 'merchant', name: 'Brom', uid: `${t.q},${t.r}#2` }, { id: 3, type: 'villager', name: 'Una', uid: `${t.q},${t.r}#3` }, { id: 4, type: 'villager', name: 'Siv', uid: `${t.q},${t.r}#4` }, { id: 5, type: 'villager', name: 'Holt', uid: `${t.q},${t.r}#5` }];
        InnerMap._bindHospitality(world);
        InnerMap._assignHospitalityKeepers(world, new Set());
        const houses = Hospitality.townHouses(world, t.q, t.r);
        InnerMap.buildings.forEach((b, i) => {
            expect(b.establishmentId).toBe(houses[i].id);
            expect(b.name).toBe(houses[i].name);
            expect(b.ownerName).toBeTruthy();
        });
        expect(houses[0].keeperUid).toBe(`${t.q},${t.r}#1`);
        expect(houses[0].keeper).toBe('Ada Stone');
        expect(InnerMap.getBuildingActions(InnerMap.buildings[0])).toContain('lodging');
        InnerMap.buildings = [];
        InnerMap.npcs = [];
    });

    it('a roadhouse stands on its road tile\'s inner map', () => {
        const { world } = game;
        const site = Hospitality._waysideSites(world)[0];
        const tile = world.getTile(site.q, site.r);
        const tiles = Array.from({ length: 20 }, (_, r) => Array.from({ length: 20 }, (_, q) => ({ q, r, subTerrain: { passable: true }, building: null })));
        InnerMap._placeRoadhouse(tiles, tile, site.q, site.r, world);
        const at = tiles.flat().find(x => x._buildingTypeHint === 'roadhouse');
        expect(at).toBeTruthy();
        expect(at._establishmentId).toBe(`w:${site.q},${site.r}`);
    });

    it('the world menu offers lodgings and the panels render without undefined or NaN', () => {
        const { world, player } = game;
        const t = townOf('town');
        standAt(t.q, t.r);
        const actions = PlayerActions.getAvailableActions(player, world.getTile(t.q, t.r), world);
        expect(actions.some(a => a.type === 'lodging')).toBe(true);
        const prop = build('inn', t.q, t.r);
        let html = '';
        game.ui = { showCustomPanel: (title, h) => { html = title + h; }, showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {} };
        ActionMenu.showLodgings(game, world.getTile(t.q, t.r));
        expect(html).toMatch(/Lodgings/);
        for (const v of Hospitality.listAt(world, player, t.q, t.r)) {
            ActionMenu.lodgingAct(game, 'open', v.id);
            expect(html).not.toMatch(/undefined|NaN/);
        }
        ActionMenu.lodgingAct(game, 'tab', `p:${t.q},${t.r}:inn`, 'run');
        expect(html).toMatch(/Staff/);
        expect(html).not.toMatch(/undefined|NaN/);
        ActionMenu.lodgingAct(game, 'staff', `p:${t.q},${t.r}:inn`, 'maid', 1);
        expect(prop.hosp.staff.maid).toBe(1);
        removeProps(t.q, t.r);
    });
});
