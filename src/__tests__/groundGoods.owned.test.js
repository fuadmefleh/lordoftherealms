// Goods on the ground, round two (systems/groundGoods.js, ui/innerMapGroundGoods.js):
// goods people set down for the day (claimed, taken back, or left), a rival
// House's retinue picking piles up, the townsfolk's finds used, sold on and
// sold second-hand, piles inside buildings taken by their people, butchered
// meat / spent arrows / wreck salvage kept by the world, and the ground
// store's goods ledger closing each day.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { GroundGoods } from '../systems/groundGoods.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Utils } from '../core/utils.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapGroundGoods } from '../ui/innerMapGroundGoods.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { secondHandHtml } from '../ui/ui/groundGoodsPanel.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** A small world: a market town at (2, 2), a road at (4, 4), wilds elsewhere. */
function makeWorld(day = 10) {
    const town = { name: 'Varrholt', q: 2, r: 2, type: 'town', population: 900 };
    SettlementMarket.ensure(town);
    Economy.initSettlement(town);
    town.economy.gold = 5000;
    for (const g of ['cabbage', 'apples', 'eggs', 'bread', 'clothes', 'linen', 'firewood', 'grain', 'wool', 'turnips']) SettlementMarket.add(town, g, 200);
    const tiles = {};
    const tileAt = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles[k]) tiles[k] = { q, r, terrain: { id: 'grassland', passable: true }, settlement: q === 2 && r === 2 ? town : null, hasRoad: q === 4 && r === 4 };
        return tiles[k];
    };
    return {
        day, width: 40, generationParams: { seed: 4242 }, kingdoms: [], units: [],
        getTile: tileAt, getKingdom: () => null, getSettlementViews: () => [town], town,
    };
}
const makePlayer = () => ({ name: 'Ada', q: 2, r: 2, gold: 100, inventory: { bread: 20 }, skills: { stealth: 1 }, reputation: {} });
const stockOf = (w, goods) => goods.reduce((a, g) => a + SettlementMarket.stock(w.town, g), 0);
const GOODS = ['cabbage', 'apples', 'eggs', 'bread', 'clothes', 'linen', 'firewood', 'grain', 'wool', 'turnips', 'pottery', 'candles', 'barrel', 'fish'];

describe('set down for the day (claimed piles)', () => {
    it('stallholders, householders set goods down out of the market, claimed; most are taken back next day, the rest lie abandoned', () => {
        const w = makeWorld(0), p = makePlayer();
        const before = stockOf(w, GOODS);
        let made = 0, abandoned = 0;
        for (let d = 1; d <= 60; d++) {
            w.day = d;
            GroundGoods.processDay(w, p, d, { views: [w.town], hold: '2,2' });
            const piles = GroundGoods.at(w, 2, 2);
            made += piles.filter(x => x.claim && x.day === d).length;
            abandoned += piles.filter(x => x.abandoned === d).length;
            // (today's set-downs are claimed for today: the owner is about)
            for (const x of piles.filter(y => y.claim)) expect(GroundGoods.claimed(x, d)).toBe(true);
            expect(GroundGoods.ledger(w).closes).toBe(true);
        }
        expect(made).toBeGreaterThan(20);
        expect(abandoned).toBeGreaterThan(0);
        expect(abandoned).toBeLessThan(made / 3);
        const books = GroundGoods.state(w).books;
        expect(Object.values(books.reclaimed).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        // Nothing appeared or vanished: what left the stalls is back in them or still on the ground
        const back = stockOf(w, GOODS);
        // (refuse of goods outside this list counted out: only these goods' stock was summed)
        const rotted = GOODS.reduce((a, g) => a + (books.rotted[g] || 0), 0);
        const lying = Object.values(GroundGoods.state(w).hexes).flat().filter(x => GOODS.includes(x.good)).reduce((a, x) => a + x.qty, 0);
        expect(back + lying + rotted).toBeCloseTo(before, 1);
        expect(GroundGoods.state(w).books.flow.in.setDown).toBeGreaterThan(0);
    });

    it('nobody sets anything down far from the player', () => {
        const w = makeWorld(0), p = makePlayer();
        p.q = 30; p.r = 30;
        for (let d = 1; d <= 10; d++) GroundGoods.processDay(w, p, d, { views: [w.town] });
        expect(GroundGoods.count(w)).toBe(0);
    });

    it("a caravan's camp in the wilds comes out of its cargo and goes back into it", () => {
        const w = makeWorld(0), p = makePlayer();
        p.q = 8; p.r = 8;
        const u = { id: 'cv1', type: 'trade_caravan', name: 'a wool train', q: 9, r: 9, cargo: { wool: 40 } };
        w.units.push(u);
        let seen = null;
        for (let d = 1; d <= 30 && !seen; d++) {
            GroundGoods.processDay(w, p, d, { views: [w.town] });
            seen = GroundGoods.at(w, 9, 9).find(x => x.claim && x.claim.kind === 'camp') || null;
        }
        expect(seen).toBeTruthy();
        expect(u.cargo.wool + seen.qty).toBe(40);
        expect(GroundGoods.reclaim(w, 9, 9, seen.id).where).toBe('caravan');
        expect(u.cargo.wool).toBe(40);
    });

    it('taking it with the owner close by is theft; with the owner stepped away it is not', () => {
        const w = makeWorld(5), p = makePlayer();
        SettlementMarket.take(w.town, 'apples', 4);
        const pile = GroundGoods.setDown(w, 2, 2, 'apples', 4, { kind: 'stall', name: 'a stallholder', day: 5, from: { kind: 'market', q: 2, r: 2 } });
        const rnd = vi.spyOn(Utils, 'random').mockReturnValue(0);
        const caught = GroundGoods.pickUp(w, p, 2, 2, pile.id, 2, { day: 5, ownerNear: true, scene: { witnesses: 3 } });
        rnd.mockRestore();
        expect(caught.theft).toBe(true);
        expect(caught.ok).toBe(false);
        const free = GroundGoods.pickUp(w, p, 2, 2, pile.id, 2, { day: 5, ownerNear: false });
        expect(free.ok).toBe(true);
        expect(free.theft).toBeFalsy();
        // The owner comes back for the rest: into the market's stock
        const st0 = SettlementMarket.stock(w.town, 'apples');
        expect(GroundGoods.reclaim(w, 2, 2, pile.id).where).toBe('market');
        expect(SettlementMarket.stock(w.town, 'apples')).toBe(st0 + 2);
        expect(GroundGoods.ledger(w).closes).toBe(true);
    });
});

describe('the street map: owners stand about what they set down', () => {
    function streetMap() {
        const tiles = [];
        for (let r = 0; r < 30; r++) {
            const row = [];
            for (let q = 0; q < 30; q++) row.push({ q, r, subTerrain: { id: 'grass', passable: true } });
            tiles.push(row);
        }
        return tiles;
    }
    beforeEach(() => {
        Object.assign(InnerMap, { active: true, width: 30, height: 30, currentWorldTile: { q: 2, r: 2 }, _insideBuilding: null, roads: [], playerInnerQ: 5, playerInnerR: 5, timeOfDay: 10 });
        InnerMap.tiles = streetMap();
        InnerMap.npcs = [
            { id: 'n1', name: 'Hild Ash', type: 'merchant', q: 20, r: 20, state: 'idle' },
            { id: 'n2', name: 'Osric Fenn', type: 'villager', q: 3, r: 25, state: 'idle', _home: { q: 4, r: 24, type: 'house' } },
        ];
    });

    it('binds a stall pile to a merchant and lays it beside him; near him taking is theft, far it is not', () => {
        const w = makeWorld(5), p = makePlayer();
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        const pile = GroundGoods.setDown(w, 2, 2, 'apples', 3, { kind: 'stall', name: 'a stallholder', day: 5, from: { kind: 'market', q: 2, r: 2 } });
        InnerMapGroundGoods.bind(game);
        expect(pile.claim.npcId).toBe('n1');
        expect(pile.claim.name).toBe('Hild Ash');
        expect(pile.claim.role).toBe('a stallholder');
        expect(Math.max(Math.abs(pile.spot.q - 20), Math.abs(pile.spot.r - 20))).toBeLessThanOrEqual(2);
        expect(InnerMapGroundGoods.ownerNear(game, pile, pile.spot.q, pile.spot.r)).toBe(true);
        const menu = InnerMapGroundGoods.menuItems(game, pile.spot.q, pile.spot.r);
        expect(menu.find(m => m.action === 'gg_pickup').desc).toMatch(/theft/);
        InnerMap.npcs[0].q = 2; InnerMap.npcs[0].r = 2;
        expect(InnerMapGroundGoods.ownerNear(game, pile, pile.spot.q, pile.spot.r)).toBe(false);
        expect(InnerMapGroundGoods.menuItems(game, pile.spot.q, pile.spot.r).find(m => m.action === 'gg_pickup').desc).toMatch(/stepped away/);
    });

    it("washing goes by the owner's door, and the owner walks back for it at his hour", () => {
        const w = makeWorld(5), p = makePlayer();
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        SettlementMarket.take(w.town, 'linen', 2);
        const pile = GroundGoods.setDown(w, 2, 2, 'linen', 2, { kind: 'household', name: 'a washerwoman', day: 5, backHour: 14, from: { kind: 'market', q: 2, r: 2 } });
        InnerMapGroundGoods.bind(game);
        expect(pile.claim.npcId).toBe('n2');
        expect(Math.max(Math.abs(pile.spot.q - 4), Math.abs(pile.spot.r - 25))).toBeLessThanOrEqual(1);
        InnerMap._findPath = () => null;
        InnerMap.timeOfDay = 15;
        const owner = InnerMap.npcs[1];
        owner.q = pile.spot.q + 1; owner.r = pile.spot.r;
        InnerMapGroundGoods.update(5, game); // (the scan: he sets off for it)
        expect(owner._gg && owner._gg.reclaim).toBe(true);
        InnerMapGroundGoods.update(0.1, game); // (beside it: he stoops)
        InnerMapGroundGoods.update(5, game); // (and takes it home)
        expect(GroundGoods.find(w, 2, 2, pile.id)).toBeNull();
        expect(InnerMap.getTile(pile.spot.q, pile.spot.r).groundItem).toBeFalsy();
        expect(GroundGoods.ledger(w).closes).toBe(true);
    });
});

describe("a rival House's retinue picks piles up", () => {
    it('into the House stores where it stays and rides; the head grabs valuables; sold in a market town', () => {
        const w = makeWorld(20), p = makePlayer();
        const rival = { name: 'House Vane', houseKey: 'vane', kingdomId: 3, gold: 50, stats: {}, head: { name: 'Lord Aldric Vane', traits: ['grasping'] } };
        GroundGoods.leave(w, 6, 6, 'wood', 6, { by: 'player', day: 1 });
        GroundGoods.leave(w, 7, 7, 'gems', 2, { by: 'someone', day: 1 });
        GroundGoods.leave(w, 7, 7, 'stone', 3, { by: 'someone', day: 1, claim: { owner: 'x', until: 99 } });
        let got = [];
        for (let d = 20; d < 200 && GroundGoods.count(w) > 1; d++) got = got.concat(GroundGoods.retinueGlean(w, rival, [{ q: 6, r: 6, stay: false }, { q: 7, r: 7, stay: true }], d));
        expect(rival.stores.wood).toBe(6);
        expect(rival.stores.gems).toBe(2);
        expect(got.find(g => g.good === 'gems').head).toBe(true);
        // (someone's set down is left alone)
        expect(GroundGoods.at(w, 7, 7).find(x => x.good === 'stone').qty).toBe(3);
        expect(GroundGoods.state(w).books.taken.rival.wood).toBe(6);
        expect(GroundGoods.state(w).gone['6,6'][0]).toMatchObject({ good: 'wood', qty: 6 });
        // In a market town: sold at a discount, the town paying
        const gold0 = rival.gold, purse0 = w.town.economy.gold, wood0 = SettlementMarket.stock(w.town, 'wood');
        RivalHouses._storesDay(w, rival, w.town, 21);
        expect(SettlementMarket.stock(w.town, 'wood')).toBe(wood0 + 6);
        expect(rival.gold - gold0).toBeCloseTo(purse0 - w.town.economy.gold, 2);
        expect(rival.gold).toBeGreaterThan(gold0);
        expect(GroundGoods.ledger(w).closes).toBe(true);
    });

    it('rides through: the hexes passed and the stay are gleaned by RivalHouses._gleanDay', () => {
        const w = makeWorld(30), p = makePlayer();
        const rival = { name: 'House Vane', houseKey: 'vane', kingdomId: 3, gold: 0, stats: {}, head: { name: 'Aldric', traits: [] } };
        const route = [5, 5, 6, 5, 7, 5, 8, 5];
        const unit = { q: 8, r: 5, route, step: 3 };
        const spy = vi.spyOn(GroundGoods, 'retinueGlean').mockReturnValue([]);
        RivalHouses._gleanDay(p, w, rival, unit, route, 0, { notices: [] });
        expect(spy.mock.calls[0][2]).toEqual([{ q: 6, r: 5, stay: false }, { q: 7, r: 5, stay: false }, { q: 8, r: 5, stay: true }]);
        spy.mockRestore();
    });
});

describe("the townsfolk's finds", () => {
    it('are used up, faster past the cap, and sold second-hand to the player (the town paid)', () => {
        const w = makeWorld(0), p = makePlayer();
        w.town.finds = { old_boot: 120 };
        for (let d = 1; d <= 30; d++) GroundGoods.processDay(w, p, d, { views: [w.town] });
        w.town.finds.iron_sword = 2;
        expect(w.town.finds.old_boot).toBeLessThan(80);
        expect(GroundGoods.state(w).books.finds.used).toBeGreaterThan(40);
        const row = GroundGoods.secondHand(w.town).find(x => x.good === 'iron_sword');
        expect(row).toBeTruthy();
        expect(secondHandHtml({ player: p }, w.town)).toContain('data-ui-act="ggBuyUsed"');
        p.gold = 1000;
        const purse0 = w.town.economy.gold;
        const res = GroundGoods.buyUsed(w, p, w.town, 'iron_sword', 1);
        expect(res.ok).toBe(true);
        expect(p.inventory.iron_sword).toBe(1);
        expect(w.town.economy.gold - purse0).toBeCloseTo(res.cost, 2);
        expect(p.gold).toBeCloseTo(1000 - res.cost, 2);
    });

    it('a good the market deals in trickles into its stock', () => {
        const w = makeWorld(0), p = makePlayer();
        w.town.finds = { wood: 8 };
        const s0 = SettlementMarket.stock(w.town, 'wood');
        for (let d = 1; d <= 20; d++) GroundGoods.processDay(w, p, d, { views: [w.town] });
        expect(w.town.finds).toBeUndefined();
        expect(SettlementMarket.stock(w.town, 'wood')).toBeCloseTo(s0 + 8, 2);
    });
});

describe('piles inside buildings', () => {
    it("a home's household puts them in its larder; a tavern's staff sell them on; servants clear refuse; your own house is left alone", () => {
        const w = makeWorld(0), p = makePlayer();
        w.town.larders = { '2,2|house@5,6|7,8|chest': { period: 1, stock: {}, stolen: {}, bought: 0 } };
        const a = GroundGoods.leave(w, 2, 2, 'iron', 3, { by: 'player', day: 0, inside: 'house_5_6' });
        const b = GroundGoods.leave(w, 2, 2, 'wood', 4, { by: 'player', day: 0, inside: 'tavern_9_9' });
        const c = GroundGoods.leave(w, 2, 2, 'bread', 2, { by: 'market', day: 0, inside: 'tavern_9_9', refuse: true });
        const d = GroundGoods.leave(w, 2, 2, 'stone', 5, { by: 'player', day: 0, inside: 'house_1_1' });
        d.insideOwn = true;
        const wood0 = SettlementMarket.stock(w.town, 'wood');
        p.q = 30; p.r = 30;
        for (let day = 1; day <= 40; day++) GroundGoods.processDay(w, p, day, { views: [w.town] });
        expect(GroundGoods.find(w, 2, 2, a.id)).toBeNull();
        expect(w.town.larders['2,2|house@5,6|7,8|chest'].stock.iron).toBe(3);
        expect(GroundGoods.find(w, 2, 2, b.id)).toBeNull();
        expect(SettlementMarket.stock(w.town, 'wood')).toBeGreaterThanOrEqual(wood0 + 4 - 1e-6);
        expect(GroundGoods.find(w, 2, 2, c.id)).toBeNull();
        expect(GroundGoods.find(w, 2, 2, d.id)).toBeTruthy();
        expect(GroundGoods.state(w).books.taken.larder.iron).toBe(3);
        expect(GroundGoods.ledger(w).closes).toBe(true);
    });

    it("a house standing empty (to let): nobody lives there; the landlord's man clears it in time, into the town", () => {
        const w = makeWorld(0);
        w.town.larders = { '2,2|house@5,6|7,8|chest': { period: 1, stock: {}, stolen: {}, bought: 0 } };
        const e = GroundGoods.leave(w, 2, 2, 'iron', 2, { by: 'player', day: 0, inside: 'house_5_6' });
        e.insideVacant = true;
        const res = GroundGoods.takeBy(w, 2, 2, e.id, null, {}, { views: [w.town] });
        expect(res.who).toMatch(/landlord/);
        expect(res.where).not.toBe('larder');
        expect(w.town.larders['2,2|house@5,6|7,8|chest'].stock.iron).toBeUndefined();
    });
});

describe('butchered meat, spent arrows, wreck salvage: kept by the world', () => {
    function streetMap() {
        const tiles = [];
        for (let r = 0; r < 30; r++) {
            const row = [];
            for (let q = 0; q < 30; q++) row.push({ q, r, subTerrain: { id: q > 25 ? 'shallow_water' : 'grass', passable: q <= 25 }, _wet: q > 25 });
            tiles.push(row);
        }
        return tiles;
    }
    beforeEach(() => {
        Object.assign(InnerMap, { active: true, width: 30, height: 30, currentWorldTile: { q: 10, r: 10 }, _insideBuilding: null, npcs: [], roads: [], playerInnerQ: 5, playerInnerR: 5 });
        InnerMap.tiles = streetMap();
    });

    it('lie on, drawn as before, after the map is drawn afresh; meat goes off; arrows stack', () => {
        const w = makeWorld(3), p = makePlayer();
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        InnerMapGroundGoods.bind(game);
        const meat = InnerMapGroundGoods.lay(game, InnerMap.getTile(8, 8), 'venison', 6, { kind: 'meat', by: 'player', src: 'meat', label: 'Venison' });
        InnerMapGroundGoods.lay(game, InnerMap.getTile(9, 9), 'arrows', 1, { kind: 'arrows', by: 'player', src: 'arrows' });
        InnerMapGroundGoods.lay(game, InnerMap.getTile(9, 9), 'arrows', 1, { kind: 'arrows', by: 'player', src: 'arrows' });
        InnerMapGroundGoods.lay(game, InnerMap.getTile(27, 4), 'gold', 1, { kind: 'salvage', by: 'wreck', src: 'salvage', label: 'Strongbox (40 gold)', gold: 40, salvage: { kind: 'chest', frame: 2, phase: 1 } });
        expect(InnerMap.getTile(8, 8).groundItem).toMatchObject({ placedBy: 'butcher', kind: 'meat', pileId: meat.id });
        expect(InnerMap.getTile(9, 9).groundItem.quantity).toBe(2);
        // Drawn afresh (left and came back): all where they were, the strongbox still in the water
        InnerMap.tiles = streetMap();
        InnerMapGroundGoods.bind(game);
        expect(InnerMap.getTile(8, 8).groundItem.itemId).toBe('venison');
        expect(InnerMap.getTile(9, 9).groundItem).toMatchObject({ placedBy: 'hunt', quantity: 2 });
        expect(InnerMap.getTile(27, 4).groundItem).toMatchObject({ placedBy: 'wreck', salvage: { kind: 'chest' }, gold: 40 });
        expect(InnerMapGroundGoods.menuItems(game, 27, 4)[1].label).toMatch(/Salvage/);
        // The strongbox's coin through PlayerCoin.found
        const found = vi.spyOn(PlayerCoin, 'found').mockImplementation(() => 40);
        InnerMapGroundGoods.pickUp(game, 27, 4);
        expect(found).toHaveBeenCalledWith(w, p, 40, 'salvage', 'exploration');
        found.mockRestore();
        // The meat goes off on the ground
        for (let d = 4; d <= 12; d++) GroundGoods.processDay(w, p, d, { views: [w.town], hold: '10,10' });
        const m = GroundGoods.find(w, 10, 10, meat.id);
        expect(m ? m.qty : 0).toBeLessThan(6);
        expect(GroundGoods.state(w).books.rotted.venison).toBeGreaterThan(0);
        const L = GroundGoods.ledger(w);
        expect(L.inBy).toMatchObject({ meat: 6, arrows: 2, salvage: 1 });
        expect(L.closes).toBe(true);
    });

    it('a strongbox nobody swims out to sinks in time (booked)', () => {
        const w = makeWorld(0);
        GroundGoods.leave(w, 3, 3, 'gold', 1, { kind: 'salvage', by: 'wreck', gold: 25, day: 0 });
        for (let d = 1; d <= 120; d++) GroundGoods.processDay(w, null, d, { views: [w.town] });
        expect(GroundGoods.count(w)).toBe(0);
        expect(GroundGoods.state(w).books.sunk.gold).toBe(1);
    });
});

describe('the goods ledger', () => {
    it('closes each day through drops, pick-ups, rot, finders, refuse and set-downs over a long run', () => {
        const w = makeWorld(0), p = makePlayer();
        p.inventory = { bread: 50, wood: 30, fish: 20, iron: 10 };
        GroundGoods.drop(w, p, 'wood', 10, { q: 4, r: 4 });
        GroundGoods.drop(w, p, 'fish', 10, { q: 2, r: 2 });
        GroundGoods.drop(w, p, 'iron', 5, { q: 12, r: 12 });
        for (let d = 1; d <= 200; d++) {
            w.day = d;
            if (d === 50) GroundGoods.drop(w, p, 'bread', 10, { q: 2, r: 2 });
            if (d === 60) { const x = GroundGoods.at(w, 2, 2).find(y => y.by === 'player'); if (x) GroundGoods.pickUp(w, p, 2, 2, x.id, 1); }
            GroundGoods.processDay(w, p, d, { views: [w.town] });
            const L = w.groundGoods.census;
            expect(Math.abs(L.gap)).toBeLessThan(0.01);
            expect(L.day).toBe(d);
        }
        const L = GroundGoods.ledger(w);
        expect(L.in).toBeGreaterThan(25);
        expect(L.outBy.rotted).toBeGreaterThan(0);
        expect(GroundGoods.ledgerLine(w)).toMatch(/books close/);
    });

    it('an older store without flows opens its ledger with what lies about', () => {
        const w = makeWorld(0);
        GroundGoods.restore({ seq: 3, hexes: { '1,1': [{ id: 'g1', good: 'wood', qty: 4, grades: {}, by: 'player', day: 0 }] }, books: { left: {}, picked: {} } }, w);
        const L = GroundGoods.ledger(w);
        expect(L.opening).toBe(4);
        expect(L.closes).toBe(true);
    });
});
