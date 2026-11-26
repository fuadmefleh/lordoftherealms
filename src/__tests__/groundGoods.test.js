// Goods left on the ground (systems/groundGoods.js, ui/innerMapGroundGoods.js):
// dropped by the amount at either level, kept by the world across the street
// map's regeneration and a save, thrown away and booked, taken by others to
// somewhere real (a market, a house, a lair's hoard, a trader's cargo),
// perishables rotting, and someone's goods just set down stolen if lifted.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { GroundGoods } from '../systems/groundGoods.js';
import { Grades } from '../core/grades.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapGroundGoods } from '../ui/innerMapGroundGoods.js';
import { Underworld } from '../systems/underworld.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** A small world: a town at (2, 2), a road at (4, 4), wilds elsewhere. */
function makeWorld(day = 10) {
    const town = { name: 'Varrholt', q: 2, r: 2, type: 'town', population: 900 };
    SettlementMarket.ensure(town);
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
const makePlayer = () => ({ name: 'Ada', q: 2, r: 2, gold: 100, inventory: { bread: 20, iron: 6 }, skills: { stealth: 1 }, reputation: {} });

describe('dropping', () => {
    it('sets down an amount at the roadside, merging, keeping grades, taking from the packs', () => {
        const w = makeWorld(), p = makePlayer();
        Grades.add(p, 'iron', 2, 'fine');
        const a = GroundGoods.drop(w, p, 'bread', 5, { q: 4, r: 4 });
        expect(a.ok).toBe(true);
        expect(p.inventory.bread).toBe(15);
        GroundGoods.drop(w, p, 'bread', 3, { q: 4, r: 4 });
        const piles = GroundGoods.at(w, 4, 4);
        expect(piles.length).toBe(1);
        expect(piles[0].qty).toBe(8);
        // The fine iron goes with the pile (the worst first, so Common first) and comes back on pick-up
        GroundGoods.drop(w, p, 'iron', 6, { q: 4, r: 4 });
        const iron = GroundGoods.at(w, 4, 4).find(x => x.good === 'iron');
        expect(iron.grades.fine).toBe(2);
        expect(p.inventory.iron).toBeUndefined();
        const got = GroundGoods.pickUp(w, p, 4, 4, iron.id, 6);
        expect(got.ok).toBe(true);
        expect(p.inventory.iron).toBe(6);
        expect(Grades.counts(p, 'iron').fine).toBe(2);
        expect(GroundGoods.at(w, 4, 4).some(x => x.good === 'iron')).toBe(false);
    });

    it('refuses more than is carried, and a full hex', () => {
        const w = makeWorld(), p = makePlayer();
        expect(GroundGoods.drop(w, p, 'bread', 25, { q: 1, r: 1 }).ok).toBe(false);
        p.inventory = { bread: 100 };
        const cap = GroundGoods.config().perHex;
        for (let i = 0; i < cap; i++) GroundGoods.leave(w, 1, 1, 'wood', 1, { by: `x${i}` });
        expect(GroundGoods.drop(w, p, 'bread', 1, { q: 1, r: 1 }).ok).toBe(false);
        expect(p.inventory.bread).toBe(100);
    });

    it('throwing away destroys and books it', () => {
        const w = makeWorld(), p = makePlayer();
        const res = GroundGoods.throwAway(w, p, 'bread', 4);
        expect(res.ok).toBe(true);
        expect(p.inventory.bread).toBe(16);
        expect(GroundGoods.state(w).books.destroyed.bread).toBe(4);
        expect(GroundGoods.count(w)).toBe(0);
    });
});

describe('on the street map', () => {
    /** A bare grass map, 30 × 30, for hex (2, 2). */
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
        InnerMap.active = true;
        InnerMap.width = 30;
        InnerMap.height = 30;
        InnerMap.currentWorldTile = { q: 2, r: 2 };
        InnerMap._insideBuilding = null;
        InnerMap.npcs = [];
        InnerMap.roads = [];
        InnerMap.playerInnerQ = 10;
        InnerMap.playerInnerR = 10;
        InnerMap.tiles = streetMap();
    });

    it('drops beside the player, and the pile comes back at its spot when the map is drawn afresh', () => {
        const w = makeWorld(), p = makePlayer();
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        InnerMapGroundGoods.bind(game);
        const res = InnerMapGroundGoods.dropAt(game, 'bread', 4);
        expect(res.ok).toBe(true);
        const { q, r } = res.pile.spot;
        expect(Math.max(Math.abs(q - 10), Math.abs(r - 10))).toBeLessThanOrEqual(2);
        expect(InnerMap.getTile(q, r).groundItem.pileId).toBe(res.pile.id);
        // Another 2 onto the same pile beside you
        InnerMapGroundGoods.dropAt(game, 'bread', 2);
        expect(GroundGoods.at(w, 2, 2)[0].qty).toBe(6);
        // The map regenerated (a new visit): the world still has it, laid where it was
        InnerMap.tiles = streetMap();
        InnerMapGroundGoods.update(0.016, game);
        expect(InnerMap.getTile(q, r).groundItem).toMatchObject({ itemId: 'bread', quantity: 6, pileId: res.pile.id });
        // Picked up from the ground: half
        InnerMapGroundGoods.pickUp(game, q, r, 3);
        expect(p.inventory.bread).toBe(17);
        expect(InnerMap.getTile(q, r).groundItem.quantity).toBe(3);
        const menu = InnerMapGroundGoods.menuItems(game, q, r);
        expect(menu.filter(m => m.action === 'gg_pickup').length).toBe(2);
    });

    it('goods left on the world map show up on the street map of the hex', () => {
        const w = makeWorld(), p = makePlayer();
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        GroundGoods.drop(w, p, 'bread', 5, { q: 2, r: 2 });
        InnerMapGroundGoods.bind(game);
        const pile = GroundGoods.at(w, 2, 2)[0];
        expect(pile.spot).toBeTruthy();
        expect(InnerMap.getTile(pile.spot.q, pile.spot.r).groundItem.quantity).toBe(5);
    });

    it('a beggar near walks to a pile, takes it, and it goes into the market', () => {
        const w = makeWorld(), p = makePlayer();
        const notes = [];
        const game = { world: w, player: p, ui: { showNotification: (t, m) => notes.push(m), updateStats() {} } };
        const pile = GroundGoods.leave(w, 2, 2, 'bread', 4, { by: 'market', day: 0, spot: { q: 20, r: 20 } });
        InnerMapGroundGoods.bind(game);
        const npc = { id: 7, name: 'Wat', type: 'villager', job: 'beggar', q: 20, r: 21, state: 'idle' };
        InnerMap.npcs = [npc];
        const before = SettlementMarket.stock(w.town, 'bread');
        // (a sure chance for the test)
        const spy = vi.spyOn(GroundGoods, 'takeChance').mockReturnValue(1e9);
        for (let i = 0; i < 10 && GroundGoods.find(w, 2, 2, pile.id); i++) InnerMapGroundGoods.update(3.1, game);
        spy.mockRestore();
        expect(GroundGoods.find(w, 2, 2, pile.id)).toBeNull();
        expect(InnerMap.getTile(20, 20).groundItem).toBeUndefined();
        expect(SettlementMarket.stock(w.town, 'bread')).toBeCloseTo(before + 4, 5);
        expect(npc._gg).toBeNull();
    });
});

describe('others take it, to somewhere real', () => {
    const runDays = (w, p, from, to, opts = {}) => { for (let d = from; d <= to; d++) { w.day = d; GroundGoods.processDay(w, p, d, opts); } };

    it('in a town: a good the market trades into its stock, anything else into a house', () => {
        const w = makeWorld(0), p = makePlayer();
        GroundGoods.leave(w, 2, 2, 'wood', 6, { by: 'player', day: 0 });
        GroundGoods.leave(w, 2, 2, 'iron_sword', 1, { by: 'player', day: 0 });
        const wood0 = SettlementMarket.stock(w.town, 'wood');
        p.q = 9; // (away: told later, rolled up)
        runDays(w, p, 1, 120, { views: [] });
        expect(GroundGoods.at(w, 2, 2).length).toBe(0);
        expect(SettlementMarket.stock(w.town, 'wood')).toBeGreaterThanOrEqual(wood0 + 6 - 1e-6);
        expect(w.town.finds.iron_sword).toBe(1);
        const books = GroundGoods.state(w).books.taken;
        expect(books.market.wood).toBe(6);
        expect(books.house.iron_sword).toBe(1);
        const line = GroundGoods.goneLine(w, 2, 2);
        expect(line).toMatch(/6 wood/);
        expect(GroundGoods.goneLine(w, 2, 2)).toBe(''); // (told once)
    });

    it('in the wilds near an active lair: into its hoard; on a road with a trader: into its cargo', () => {
        const w = makeWorld(0), p = makePlayer();
        const lair = { name: 'Black Hollow', q: 11, r: 10, status: 'active', hoard: { gold: 0, goods: {} } };
        GroundGoods.leave(w, 10, 10, 'iron', 3, { by: 'player', day: 0 });
        runDays(w, p, 1, 400, { views: [w.town], lairs: [lair] });
        expect(GroundGoods.at(w, 10, 10).length).toBe(0);
        expect(lair.hoard.goods.iron).toBe(3);
        const trader = { type: 'trade_caravan', name: 'a salt caravan', q: 4, r: 4, cargo: {} };
        w.units.push(trader);
        p.q = 30; p.r = 30; // (far off: the carter sets nothing down for the day where nobody is about)
        GroundGoods.leave(w, 4, 4, 'wood', 5, { by: 'player', day: 400 });
        runDays(w, p, 401, 700, { views: [w.town] });
        expect(trader.cargo.wood).toBe(5);
    });

    it('more is taken in towns than in the wilds, and valuables go faster', () => {
        const pile = { good: 'wood', qty: 1, grades: {} };
        expect(GroundGoods.takeChance(pile, 'town')).toBeGreaterThan(GroundGoods.takeChance(pile, 'road'));
        expect(GroundGoods.takeChance(pile, 'road')).toBeGreaterThan(GroundGoods.takeChance(pile, 'wilds'));
        expect(GroundGoods.takeChance({ good: 'gems', qty: 3, grades: {} }, 'wilds')).toBeGreaterThan(GroundGoods.takeChance(pile, 'wilds'));
    });

    it('perishables rot (booked), durable goods do not', () => {
        const w = makeWorld(0), p = makePlayer();
        GroundGoods.leave(w, 10, 10, 'fish', 10, { by: 'player', day: 0 });
        GroundGoods.leave(w, 10, 10, 'stone', 10, { by: 'player', day: 0 });
        // (held: nobody comes by, only the weather)
        runDays(w, p, 1, 8, { views: [], hold: '10,10' });
        const fish = GroundGoods.at(w, 10, 10).find(x => x.good === 'fish');
        const rotted = GroundGoods.state(w).books.rotted.fish;
        expect(rotted).toBeGreaterThan(0);
        expect((fish ? fish.qty : 0) + rotted).toBe(10);
        expect(GroundGoods.at(w, 10, 10).find(x => x.good === 'stone').qty).toBe(10);
    });

    it("a town's market throws out a little spoiled food (out of its stock), and the beggars clear it", () => {
        const w = makeWorld(0), p = makePlayer();
        SettlementMarket.add(w.town, 'bread', 200);
        const spy = vi.spyOn(GroundGoods, 'config').mockReturnValue({ ...GroundGoods.config(), refuse: { enabled: true, chance: 1, goods: ['bread'], maxQty: 3 } });
        const before = SettlementMarket.stock(w.town, 'bread');
        GroundGoods.processDay(w, p, 1);
        spy.mockRestore();
        const pile = GroundGoods.at(w, 2, 2).find(x => x.refuse);
        expect(pile).toBeTruthy();
        expect(SettlementMarket.stock(w.town, 'bread')).toBeCloseTo(before - pile.qty, 5);
        const n = pile.qty;
        const res = GroundGoods.takeBy(w, 2, 2, pile.id, null, { kind: 'town' });
        expect(res.where).toBe('eaten');
        expect(GroundGoods.state(w).books.eaten.bread).toBe(n);
    });
});

describe('theirs, just set down', () => {
    it('lifting it with the owner about is theft: caught, it stays; away, it is yours and hot', () => {
        const w = makeWorld(5), p = makePlayer();
        const pile = GroundGoods.leave(w, 2, 2, 'wood', 4, { by: 'townsfolk', byName: 'Hild Ash', day: 5, claim: { owner: 'pid9', name: 'Hild Ash', until: 6 } });
        expect(GroundGoods.claimed(pile, 5)).toBe(true);
        const rnd = vi.spyOn(Utils, 'random').mockReturnValue(0);
        const caught = GroundGoods.pickUp(w, p, 2, 2, pile.id, 4, { day: 5, ownerNear: true, scene: { witnesses: 2 } });
        expect(caught.ok).toBe(false);
        expect(caught.caught).toBe(true);
        expect(pile.qty).toBe(4);
        expect(p.gold).toBeLessThan(100);
        rnd.mockReturnValue(0.999);
        const hot = vi.spyOn(Underworld, 'markHot');
        const got = GroundGoods.pickUp(w, p, 2, 2, pile.id, 4, { day: 5, ownerNear: true, scene: {} });
        rnd.mockRestore();
        expect(got.ok).toBe(true);
        expect(got.theft).toBe(true);
        expect(hot).toHaveBeenCalled();
        hot.mockRestore();
        expect(p.inventory.wood).toBe(4);
        expect(GroundGoods.find(w, 2, 2, pile.id)).toBeNull();
    });

    it('once the claim runs out (or no owner is about) it is anyone\'s', () => {
        const w = makeWorld(5), p = makePlayer();
        p.inventory = {};
        const pile = GroundGoods.leave(w, 2, 2, 'wood', 2, { by: 'townsfolk', day: 5, claim: { owner: 'pid9', name: 'Hild', until: 6 } });
        expect(GroundGoods.pickUp(w, p, 2, 2, pile.id, 1, { day: 5, ownerNear: false }).theft).toBeFalsy();
        expect(GroundGoods.claimed(pile, 7)).toBe(false);
        expect(GroundGoods.pickUp(w, p, 2, 2, pile.id, 1, { day: 7 }).theft).toBeFalsy();
        expect(p.inventory.wood).toBe(2);
    });
});

describe('saved with the world', () => {
    it('serialize/restore keeps the piles and the books', () => {
        const w = makeWorld(), p = makePlayer();
        GroundGoods.drop(w, p, 'bread', 5, { q: 2, r: 2, spot: { q: 3, r: 4 } });
        GroundGoods.throwAway(w, p, 'bread', 1);
        const data = JSON.parse(JSON.stringify(GroundGoods.serialize(w)));
        const w2 = makeWorld();
        GroundGoods.restore(data, w2);
        expect(GroundGoods.at(w2, 2, 2)[0]).toMatchObject({ good: 'bread', qty: 5, spot: { q: 3, r: 4 }, by: 'player' });
        expect(GroundGoods.state(w2).books.destroyed.bread).toBe(1);
        // (an older save: none)
        const w3 = makeWorld();
        GroundGoods.restore(undefined, w3);
        expect(GroundGoods.count(w3)).toBe(0);
    });
});
