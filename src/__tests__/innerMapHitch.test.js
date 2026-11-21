/**
 * Your horse in your horse cart's shafts on the street map (ui/innerMapHitch.js):
 * a horse cart of your own stands beside you, too heavy to push by hand; your
 * grown horse is hitched to it beside the cart (a foal refused, not while you
 * ride), and you drive it from the seat far quicker than a handcart is pushed;
 * you climb down of yourself at a door and at the water, the horse left in the
 * shafts; the hitch is kept on the player (saved) and comes onto the next map;
 * and a horse cart bought at market pays the town exactly what you paid.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Carts, InnerMapCarts, InnerMapCarry, InnerMapPets, InnerMapHitch, Trading, Player, SaveLoad;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Carts } = await import('../systems/carts.js'));
    ({ InnerMapCarts } = await import('../ui/innerMapCarts.js'));
    ({ InnerMapCarry } = await import('../ui/innerMapCarry.js'));
    ({ InnerMapPets } = await import('../ui/innerMapPets.js'));
    ({ InnerMapHitch } = await import('../ui/innerMapHitch.js'));
    ({ Trading } = await import('../player/playerEconomy.js'));
    ({ Player } = await import('../player/player.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const GROWN = { name: 'Bramble', price: 120, acquiredDay: 1 };

function enter(player = {}) {
    const settlement = { name: 'Testby', type: 'town', population: 1200, q: 5, r: 6, kingdom: 'k1' };
    const kingdom = { id: 'k1', name: 'Valdoria', ruler: 'King Aldric', religion: { faithId: 'solaris', name: 'The Solar Covenant', piety: 50 }, wars: [], isAlive: true };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 400, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], units: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: id => (id === 'k1' ? kingdom : null),
    };
    const notes = [];
    const game = {
        world, settlement, notes,
        player: { name: 'T', q: 5, r: 6, strength: 5, skills: {}, health: 100, maxHealth: 100, reputation: {}, gold: 0, inventory: { horse_cart: 1 }, mount: { ...GROWN }, ...player },
        ui: { showNotification: (t, x) => notes.push(`${t}: ${x}`), updateStats() {} },
    };
    InnerMap.timeOfDay = 14;
    InnerMap._timeAccumulator = 0;
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = 14;
    tick(game);
    return game;
}

function tick(game, dt = 0.1, n = 1) {
    for (let i = 0; i < n; i++) {
        InnerMapCarts.update(dt, game);
        InnerMapHitch.update(dt, game);
        InnerMapPets.update(dt, game);
    }
}

const me = () => ({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
const cartOf = () => InnerMapHitch.cart();
const horse = () => InnerMapPets._pets.find(p => p.a.id === 'mount');

/** A step onto open ground the cart can take, not back onto its body. */
function nextStep(c) {
    const here = me();
    return [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dq, dr]) => ({ q: here.q + dq, r: here.r + dr }))
        .find(p => InnerMapHitch._ground(p.q, p.r) && !InnerMap.tiles[p.r][p.q].customObject
            && InnerMap._playerMayEnter(InnerMap.tiles[p.r][p.q], p.q, p.r) && !InnerMap.cartAt(p.q, p.r)
            && !(c.trail[0].q === p.q && c.trail[0].r === p.r));
}

/** Stand on open ground beside the cart (and the horse brought up beside you). */
function besideCart(c) {
    const b = c.trail[0];
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dq, dr]) => ({ q: b.q + dq, r: b.r + dr }))
        .find(p => InnerMapHitch._ground(p.q, p.r) && !InnerMap.cartAt(p.q, p.r) && InnerMap._playerMayEnter(InnerMap.tiles[p.r][p.q], p.q, p.r));
    InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r;
    const h = horse();
    if (h) { h.x = spot.q * 32 + 16; h.y = (spot.r + 1) * 32 + 16; }
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap._interiorCache = {};
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMap._avoidTiles = null;
    InnerMap._plagueDoors = [];
    InnerMapCarts.reset();
    InnerMapCarry.reset();
    Utils.setSeed(11);
});

afterEach(() => {
    if (InnerMapCarts.pushing) InnerMapCarts._release(null, { quiet: true });
    Object.assign(InnerMapPets, { _pets: [], _trail: [], _sig: '', _map: null, _shown: false, _stray: null, riding: null, hitched: null, _hitchPos: null });
    Object.assign(InnerMapHitch, { _tiles: null, _lastGround: null });
    InnerMap._rideSpeed = 0;
    InnerMap._insideBuilding = null;
});

describe('Hitching your horse to your horse cart', () => {
    it('the horse cart stands beside you; it is not pushed by hand', () => {
        const game = enter();
        const c = cartOf();
        expect(c).toBeTruthy();
        expect(c.kind).toBe('horsecart');
        expect(c.horse).toBeFalsy();
        expect(Math.max(...c.trail.map(t => Math.max(Math.abs(t.q - me().q), Math.abs(t.r - me().r))))).toBeLessThanOrEqual(1);
        expect(InnerMapCarts.take(game, c)).toBe(false);
        const items = InnerMapCarts.menuItems(game, null, c.trail[0].q, c.trail[0].r).map(i => i.action);
        expect(items).not.toContain('cart_take');
    }, 60000);

    it('a foal is refused, not while riding, and only beside the cart', () => {
        let game = enter({ mount: { name: 'Pip', price: 120, acquiredDay: 400, age: 0, bornDay: 399 } });
        let c = cartOf();
        besideCart(c);
        tick(game);
        const foal = horse();
        expect(foal).toBeTruthy();
        expect(InnerMapHitch.whyNotHitch(game, c, foal)).toMatch(/foal/);
        const mi = InnerMapHitch.menuItems(game, c.trail[0].q, c.trail[0].r);
        expect(mi.map(i => i.action)).not.toContain('hitch_on');
        expect(mi.some(i => i.type === 'disabled' && /foal/.test(i.label))).toBe(true);
        expect(InnerMapHitch.hitch(game, c, foal)).toBe(false);
        expect(c.horse).toBeFalsy();

        // A grown horse: not while you ride, not from across the street
        InnerMapCarts.reset();
        Object.assign(InnerMapPets, { _pets: [], _sig: '', _map: null });
        InnerMapHitch._tiles = null;
        InnerMap._cache = {};
        InnerMap.active = false;
        game = enter();
        c = cartOf();
        besideCart(c);
        tick(game);
        const h = horse();
        InnerMapPets.riding = 'mount';
        expect(InnerMapHitch.whyNotHitch(game, c, h)).toMatch(/saddle/);
        InnerMapPets.riding = null;
        const far = { ...me() };
        InnerMap.playerInnerQ = c.trail[0].q + 6;
        expect(InnerMapHitch.whyNotHitch(game, c, h)).toMatch(/beside/);
        InnerMap.playerInnerQ = far.q; InnerMap.playerInnerR = far.r;
        expect(InnerMapHitch.whyNotHitch(game, c, h)).toBe(null);
        const hitch = InnerMapHitch.menuItems(game, c.trail[0].q, c.trail[0].r).find(i => i.action === 'hitch_on');
        expect(hitch.label).toBe('Hitch Bramble to the Cart');
        expect(InnerMapHitch.handle(game, hitch)).toBe(true);
        expect(c.horse).toBe('mount');
        expect(InnerMapHitch.driving()).toBe(true);
        expect(game.player.streetHitch).toEqual({ horse: 'mount', driving: true });
        // (hitched: it can't be ridden, and it is out of the file)
        expect(InnerMapPets._whyNotRide(game, h)).toBeTruthy();
        tick(game);
        expect(InnerMapPets.count()).toBe(0);
    }, 60000);

    it('driving is far quicker than pushing a handcart; laden a little slower', () => {
        const game = enter();
        const c = cartOf();
        besideCart(c);
        tick(game);
        const base = InnerMap._playerSpeed;
        const push = Carts.pushSpeed(game.player, Carts.make('h', 'handcart', [{ q: 0, r: 0 }]));
        expect(InnerMapHitch.hitch(game, c, horse())).toBe(true);
        const drive = InnerMap._playerSpeed / base;
        expect(drive).toBeCloseTo(Carts.config().hitch.speed, 6);
        expect(drive).toBeGreaterThan(push * 2);
        c.variant = 'loaded';
        tick(game);
        const laden = InnerMap._playerSpeed / base;
        expect(laden).toBeLessThan(drive);
        expect(laden).toBeGreaterThan(push * 1.5);
        c.variant = 'empty';
        tick(game);
        // The cart trails behind the horse along the path
        let walked = 0;
        for (let i = 0; i < 6; i++) {
            const here = me();
            const next = nextStep(c);
            if (!next) break;
            InnerMap.playerInnerQ = next.q; InnerMap.playerInnerR = next.r;
            tick(game);
            expect(c.trail[0]).toEqual(here);
            walked++;
        }
        expect(walked).toBeGreaterThan(1);
        expect(InnerMapPets._hitchPos.x).toBe(InnerMap.getPlayerWorldPos().x);
        // Climbing down by the menu: the walk given back whole, the horse in the shafts
        const down = InnerMapHitch.menuItems(game, me().q, me().r).find(i => i.action === 'hitch_down');
        expect(down.label).toBe('Climb Down from the Cart');
        InnerMapHitch.handle(game, down);
        expect(InnerMapHitch.driving()).toBe(false);
        expect(InnerMap._playerSpeed).toBe(base);
        expect(c.horse).toBe('mount');
        expect(c.horseAt).toBeTruthy();
        expect(Math.abs(c.horseAt.q - c.trail[0].q) + Math.abs(c.horseAt.r - c.trail[0].r)).toBe(1);
    }, 60000);

    it('you climb down of yourself at a door and at the water, the horse left in the shafts', () => {
        const game = enter();
        const c = cartOf();
        besideCart(c);
        tick(game);
        const base = InnerMap._playerSpeed;
        InnerMapHitch.hitch(game, c, horse());
        // Into the water (deeper than a ford): you climb down; the horse stands on the last dry ground
        let from = me();
        let next = nextStep(c);
        const t = InnerMap.tiles[next.r][next.q];
        const was = { isWater: t.isWater };
        t.isWater = true;
        InnerMap.playerInnerQ = next.q; InnerMap.playerInnerR = next.r;
        tick(game);
        t.isWater = was.isWater;
        expect(InnerMapHitch.driving()).toBe(false);
        expect(c.horse).toBe('mount');
        expect(c.horseAt).toEqual(from);
        expect(InnerMap._playerSpeed).toBe(base);
        expect(game.notes.some(n => /water/.test(n))).toBe(true);
        expect(game.player.streetHitch.driving).toBe(false);
        // Back up, and in at a door: left standing outside, the horse in the shafts
        InnerMap.playerInnerQ = from.q; InnerMap.playerInnerR = from.r;
        const drive = InnerMapHitch.menuItems(game, c.trail[0].q, c.trail[0].r).find(i => i.action === 'hitch_drive');
        expect(drive.label).toBe('Drive the Cart');
        InnerMapHitch.handle(game, drive);
        expect(InnerMapHitch.driving()).toBe(true);
        from = me();
        InnerMap._insideBuilding = { q: 1, r: 1 };
        tick(game);
        expect(InnerMapHitch.driving()).toBe(false);
        expect(c.parked).toBe(true);
        expect(c.horse).toBe('mount');
        expect(c.horseAt).toEqual(from);
        expect(InnerMap._playerSpeed).toBe(base);
        InnerMap._insideBuilding = null;
        tick(game);
        expect(cartOf()).toBe(c);
        expect(c.horse).toBe('mount');
        // A door tile in the way, driving: down at the door
        InnerMap.playerInnerQ = from.q; InnerMap.playerInnerR = from.r;
        InnerMapHitch.drive(game, c);
        next = nextStep(c);
        const d = InnerMap.tiles[next.r][next.q];
        d._isDoor = true;
        InnerMap.playerInnerQ = next.q; InnerMap.playerInnerR = next.r;
        tick(game);
        d._isDoor = undefined;
        expect(InnerMapHitch.driving()).toBe(false);
        expect(game.notes.some(n => /door/.test(n))).toBe(true);
        // Unhitched: the horse back in your file
        const off = InnerMapHitch.menuItems(game, c.trail[0].q, c.trail[0].r).find(i => i.action === 'hitch_off');
        expect(off.label).toBe('Unhitch Bramble');
        InnerMapHitch.handle(game, off);
        expect(c.horse).toBe(null);
        expect(game.player.streetHitch).toBe(null);
        tick(game);
        expect(InnerMapPets.hitched).toBe(null);
        expect(InnerMapPets.count()).toBe(3);
    }, 60000);

    it('the hitch is saved and comes onto the next map, you still on the seat', () => {
        let game = enter();
        let c = cartOf();
        besideCart(c);
        tick(game);
        InnerMapHitch.hitch(game, c, horse());
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('streetHitch');
        const saved = JSON.parse(JSON.stringify(SaveLoad._pickDefined(game.player, SaveLoad.EXTRA_PLAYER_FIELDS)));
        expect(saved.streetHitch).toEqual({ horse: 'mount', driving: true });
        // Off the map (an edge crossed) and onto the next: hitched, driving, the cart behind you
        InnerMap.active = false;
        tick(game);
        expect(game.player.streetHitch).toEqual({ horse: 'mount', driving: true });
        InnerMap._cache = {};
        game = enter({ streetHitch: saved.streetHitch });
        c = cartOf();
        expect(c).toBeTruthy();
        expect(c.horse).toBe('mount');
        expect(InnerMapCarts.pushing).toBe(c);
        expect(Math.abs(c.trail[0].q - me().q) + Math.abs(c.trail[0].r - me().r)).toBe(1);
        // Parked hitched, then the next map: hitched, standing beside you, the horse in the shafts
        InnerMapHitch.climbDown(game, null);
        const parked = JSON.parse(JSON.stringify(game.player.streetHitch));
        expect(parked).toEqual({ horse: 'mount', driving: false });
        InnerMap.active = false;
        tick(game);
        InnerMap._cache = {};
        game = enter({ streetHitch: parked });
        c = cartOf();
        expect(c.horse).toBe('mount');
        expect(InnerMapCarts.pushing).toBe(null);
        expect(c.horseAt).toBeTruthy();
        // With no horse cart in the pack any more: no hitch
        InnerMap.active = false;
        tick(game);
        InnerMap._cache = {};
        game = enter({ streetHitch: parked, inventory: {} });
        expect(cartOf()).toBe(null);
        expect(game.player.streetHitch).toBe(null);
    }, 60000);
});

describe('A horse cart of your own', () => {
    it('is a market good the woodworkers sell; buying one pays the town exactly what you paid', async () => {
        const gd = DataLoader._gamedata;
        expect(gd.playerEconomy.GOODS.HORSE_CART.id).toBe('horse_cart');
        expect(gd.marketStalls.trades.woodworker.goods).toContain('horse_cart');
        expect(gd.markets.goods.horse_cart).toBeTruthy();
        expect(gd.markets.recipes.find(x => x.out && x.out.horse_cart)).toBeTruthy();
        expect(gd.crafting.recipes.find(r => r.result && r.result.horse_cart)).toBeTruthy();
        const s = { name: 'Cartham', type: 'town', population: 3000 };
        const good = Trading.getAvailableGoods(s, null, null).find(g => g.id === 'horse_cart');
        expect(good).toBeTruthy();
        good.quantity = Math.max(1, good.quantity);
        const player = new Player();
        player.gold = 1000;
        player.inventory = {};
        const { Economy } = await import('../world/economy.js');
        Economy.initSettlement(s);
        const town0 = Number(s.economy.gold) || 0;
        const res = Trading.buyGoods(player, good, 1, s);
        expect(res.success).toBe(true);
        const paid = Utils.cents(1000 - player.gold);
        expect(paid).toBeGreaterThan(0);
        expect(Utils.cents(s.economy.gold - town0)).toBe(paid);
        // (whole cents)
        expect(Utils.cents(paid)).toBe(paid);
        expect(Carts.owns(player, 'horsecart')).toBe(true);
        expect(Carts.owns(player)).toBe(false);
    });
});
