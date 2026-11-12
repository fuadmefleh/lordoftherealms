/**
 * Carts on the street map: the rules (systems/carts.js), the ground they take
 * (world/innerMap/carts.js) and the street's carts (ui/innerMapCarts.js) —
 * carters' handcarts in the morning, the death cart at the plague doors, a
 * caravan's wagon loaded and rolled out of the gate, the player hauling a
 * cart with someone laid on it, and a handcart bought at market.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Carts, InnerMapCarts, InnerMapCarry, Trading, Player;

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
    ({ Trading } = await import('../player/playerEconomy.js'));
    ({ Player } = await import('../player/player.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enter(hour, day = 40, player = {}) {
    const settlement = { name: 'Testby', type: 'town', population: 1200, q: 5, r: 6, kingdom: 'k1' };
    const kingdom = { id: 'k1', name: 'Valdoria', ruler: 'King Aldric', religion: { faithId: 'solaris', name: 'The Solar Covenant', piety: 50 }, wars: [], isAlive: true };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], units: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: id => (id === 'k1' ? kingdom : null),
    };
    const notes = [];
    const game = { world, player: { strength: 5, skills: {}, inventory: {}, gold: 0, ...player }, settlement, ui: { showNotification: (t, x) => notes.push(`${t}: ${x}`) }, notes };
    InnerMap.timeOfDay = hour;
    InnerMap._timeAccumulator = 0;
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = hour;
    InnerMapCarts.update(0.01, game);
    return game;
}

let simNow = 1e6;
function run(game, seconds, step = 0.25, watch = null) {
    const real = performance.now;
    performance.now = () => simNow;
    try {
        for (let t = 0; t < seconds; t += step) {
            simNow += step * 1000;
            InnerMap.updateNPCs(step);
            InnerMapCarts.update(step, game);
            if (watch && watch() === false) break;
        }
    } finally { performance.now = real; }
}

/** Anyone on their feet in the street on a cart's ground (not its own driver). */
function overlaps() {
    const bad = [];
    for (const c of InnerMap.streetCarts()) {
        for (const t of c.trail) {
            for (const n of InnerMap.npcs) {
                if (n === c.driver || n === c.load || n.state === 'gone' || n.state === 'inside_building' || n.state === 'unconscious' || n._onCart) continue;
                if (n.q === t.q && n.r === t.r) bad.push(`${n.name} on ${c.id} at ${t.q},${t.r}`);
            }
        }
    }
    return bad;
}

/** A stretch of open street: a tile with open ground on its left and right. */
function openRun() {
    const A = InnerMap.townArea();
    const free = (q, r) => InnerMapCarts._free(q, r);
    const tiles = [...A.streets].sort((a, b) => Math.hypot(a.q - A.center.q, a.r - A.center.r) - Math.hypot(b.q - A.center.q, b.r - A.center.r));
    for (const s of tiles) {
        if ([-2, -1, 0, 1, 2].every(k => free(s.q + k, s.r))) return s;
    }
    return null;
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
    InnerMapCarts._fetching = null;
    InnerMapCarry.reset();
    Utils.setSeed(11);
});

describe('Carts: the rules', () => {
    it('the body follows its leader, turns about when stepped back on, and faces the way it goes', () => {
        const c = Carts.make('c1', 'wagon', [{ q: 4, r: 5 }, { q: 3, r: 5 }]);
        Carts.follow(c, { q: 5, r: 5 }, { q: 6, r: 5 });
        expect(c.trail).toEqual([{ q: 5, r: 5 }, { q: 4, r: 5 }]);
        expect(c.facing).toBe(3);
        Carts.follow(c, { q: 6, r: 5 }, { q: 6, r: 6 });
        expect(c.trail).toEqual([{ q: 6, r: 5 }, { q: 5, r: 5 }]);
        expect(c.facing).toBe(2);
        // A handcart: the leader steps back onto it — it swaps round
        const h = Carts.make('c2', 'handcart', [{ q: 2, r: 2 }]);
        Carts.follow(h, { q: 3, r: 2 }, { q: 2, r: 2 });
        expect(h.trail).toEqual([{ q: 3, r: 2 }]);
        expect(h.facing).toBe(1);
    });

    it('never steps onto anyone, another cart, or ground the wheels cannot take', () => {
        const c = Carts.make('a', 'handcart', [{ q: 1, r: 1 }]);
        const other = Carts.make('b', 'handcart', [{ q: 3, r: 1 }]);
        const ctx = {
            ground: (q) => q !== 9,
            taken: (q, r) => q === 2 && r === 2,
            cartAt: (q, r) => (q === 3 && r === 1 ? other : q === 1 && r === 1 ? c : null),
        };
        expect(Carts.stepAllowed(c, { q: 2, r: 1 }, ctx)).toBe(true);
        expect(Carts.stepAllowed(c, { q: 2, r: 2 }, ctx)).toBe(false);
        expect(Carts.stepAllowed(c, { q: 3, r: 1 }, ctx)).toBe(false);
        expect(Carts.stepAllowed(c, { q: 9, r: 1 }, ctx)).toBe(false);
        expect(Carts.stepAllowed(c, { q: 1, r: 1 }, ctx)).toBe(true);
    });

    it('the death cart goes round the marked doors nearest first, sharing out the dead', () => {
        const round = Carts.plagueRound([{ q: 10, r: 0 }, { q: 2, r: 0 }, { q: 5, r: 0 }], { q: 0, r: 0 });
        expect(round.map(d => d.q)).toEqual([2, 5, 10]);
        expect([0, 1, 2].map(i => Carts.bodiesAt(i, 3, 4))).toEqual([2, 1, 1]);
        expect([0, 1, 2].map(i => Carts.bodiesAt(i, 3, 0))).toEqual([0, 0, 0]);
        const folk = { annals: [{ k: 'died', a: 1, d: 38 }, { k: 'died', a: 2, d: 30 }, { k: 'born', a: 3, d: 39 }] };
        expect(Carts.bodiesDue(folk, 40, 3).length).toBe(1);
    });

    it('hauling is slower laden; another\'s cart is theft of its use; a pulled cart or the death cart is not free', () => {
        const c = Carts.make('a', 'handcart', [{ q: 1, r: 1 }], { owner: 'town' });
        const empty = Carts.pushSpeed({ strength: 5 }, c);
        c.load = { name: 'Bram' };
        expect(Carts.pushSpeed({ strength: 5 }, c)).toBeLessThan(empty);
        expect(Carts.pushSpeed({ strength: 12 }, c)).toBeGreaterThan(Carts.pushSpeed({ strength: 5 }, c));
        expect(Carts.canUse(c)).toMatchObject({ ok: true, theft: true });
        expect(Carts.canUse({ ...c, owner: 'player' })).toMatchObject({ ok: true, theft: false });
        expect(Carts.canUse({ ...c, driver: {} }).ok).toBe(false);
        expect(Carts.canUse({ ...c, job: 'plague' }).ok).toBe(false);
        expect(Carts.canUse({ ...c, kind: 'wagon' }).ok).toBe(false);
        expect(Carts.owns({ inventory: { handcart: 1 } })).toBe(true);
        expect(Carts.owns({ inventory: {} })).toBe(false);
    });

    it('finds the caravan leaving this town today', () => {
        const world = { units: [
            { id: 't1', type: 'trade_caravan', sourceQ: 5, sourceR: 6, departed: 39 },
            { id: 't2', type: 'trade_caravan', sourceQ: 5, sourceR: 6, departed: 40, mainGood: 'salt_fish' },
            { id: 't3', type: 'trade_ship', sourceQ: 5, sourceR: 6, departed: 40 },
        ] };
        expect(Carts.departingCaravan(world, 5, 6, 40).id).toBe('t2');
        expect(Carts.departingCaravan(world, 1, 1, 40)).toBe(null);
        expect(Carts.cargoWord(world.units[1])).toBe('salt fish');
    });
});

describe('Carts on the street map', () => {
    it('a parked cart is solid: paths go round it, the player cannot walk into it', () => {
        enter(14);
        const s = openRun();
        expect(s).toBeTruthy();
        const c = InnerMapCarts._add('handcart', [{ q: s.q, r: s.r }], { owner: 'town' });
        expect(InnerMap.cartAt(s.q, s.r)).toBe(c);
        expect(InnerMap._playerMayEnter(InnerMap.tiles[s.r][s.q], s.q, s.r)).toBe(false);
        const path = InnerMap._findPath(s.q - 2, s.r, s.q + 2, s.r);
        expect(path).toBeTruthy();
        expect(path.some(p => p.q === s.q && p.r === s.r)).toBe(false);
        // Hauled by the player, it is theirs to step on (it swaps round)
        c.pusher = 'player';
        c.parked = false;
        InnerMap._cartsChanged();
        expect(InnerMap._playerMayEnter(InnerMap.tiles[s.r][s.q], s.q, s.r)).toBe(true);
    }, 60000);

    it('carters pull loaded handcarts between the stores in the morning, never onto anyone', () => {
        const game = enter(7);
        const C = Carts.config().carters;
        // (a carter on the map for certain: the first grown townsman about)
        const n = InnerMap.npcs.find(x => x._person && x.type !== 'guard' && x.type !== 'child' && x.state !== 'inside_building');
        expect(n).toBeTruthy();
        n._person.job = { id: C.jobs[0] };
        const seen = new Set();
        const moved = new Map();
        const bad = [];
        run(game, 240, 0.25, () => {
            for (const c of InnerMap.streetCarts()) {
                if (c.job === 'carter' && c.driver) {
                    seen.add(c.id);
                    const k = `${c.trail[0].q},${c.trail[0].r}`;
                    if (!moved.has(c.id)) moved.set(c.id, new Set());
                    moved.get(c.id).add(k);
                    expect(InnerMap._cartGround(c.trail[0].q, c.trail[0].r)).toBe(true);
                }
            }
            bad.push(...overlaps());
        });
        expect(seen.size).toBeGreaterThan(0);
        expect(Math.max(...[...moved.values()].map(s => s.size))).toBeGreaterThan(3);
        expect(bad).toEqual([]);
    }, 120000);

    it('the player lays someone senseless on their own cart and wheels them off at a slow walk', () => {
        const game = enter(14, 40, { inventory: { handcart: 1 } });
        const mine = InnerMap.streetCarts().find(c => c.owner === 'player');
        expect(mine).toBeTruthy();
        expect(Carts.canUse(mine).theft).toBe(false);
        // Someone knocked out, over the player's shoulder
        const victim = InnerMap.npcs.find(x => x.state !== 'inside_building' && x.type !== 'guard');
        victim.state = 'unconscious';
        victim._ko = { at: 0, until: Infinity, side: 1, hpShare: 0.3 };
        victim.q = InnerMap.playerInnerQ; victim.r = InnerMap.playerInnerR;
        expect(InnerMapCarry.pickUp(game, victim)).toBe(true);
        // The menu offers the cart beside them
        const items = InnerMapCarts.menuItems(game, null, InnerMap.playerInnerQ, InnerMap.playerInnerR);
        const lay = items.find(i => i.action === 'cart_lay');
        expect(lay).toBeTruthy();
        expect(InnerMapCarts.handle(game, lay)).toBe(true);
        expect(InnerMapCarry.person).toBe(null);
        expect(victim._onCart).toBe(mine.id);
        expect(mine.load).toBe(victim);
        // Take the handles and walk off: the cart, and them on it, follow
        const base = InnerMap._playerSpeed;
        expect(InnerMapCarts.take(game, mine)).toBe(true);
        expect(InnerMap._playerSpeed).toBeLessThan(base);
        let walked = 0;
        for (let i = 0; i < 6; i++) {
            const here = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
            const next = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dq, dr]) => ({ q: here.q + dq, r: here.r + dr }))
                .find(p => InnerMap._cartGround(p.q, p.r) && !InnerMap.tiles[p.r][p.q].customObject && InnerMap._playerMayEnter(InnerMap.tiles[p.r][p.q], p.q, p.r) && !(mine.trail[0].q === p.q && mine.trail[0].r === p.r));
            if (!next) break;
            InnerMap.playerInnerQ = next.q; InnerMap.playerInnerR = next.r;
            InnerMapCarts.update(0.1, game);
            walked++;
            expect(mine.trail[0]).toEqual(here);
            expect(victim.q).toBe(here.q);
            expect(victim.r).toBe(here.r);
        }
        expect(walked).toBeGreaterThan(2);
        // Going indoors: the cart is left at the step, its speed given back
        InnerMap._insideBuilding = { q: 1, r: 1 };
        InnerMapCarts.update(0.1, game);
        expect(InnerMapCarts.pushing).toBe(null);
        expect(mine.parked).toBe(true);
        expect(InnerMap._playerSpeed).toBe(base);
        InnerMap._insideBuilding = null;
        // Lifted off again, over the shoulder
        InnerMap.playerInnerQ = mine.trail[0].q + (InnerMapCarts._free(mine.trail[0].q + 1, mine.trail[0].r) ? 1 : -1);
        InnerMap.playerInnerR = mine.trail[0].r;
        expect(InnerMapCarts.liftOff(game, mine)).toBe(true);
        expect(InnerMapCarry.person).toBe(victim);
        expect(victim._onCart).toBe(null);
        expect(mine.load).toBe(null);
        // Taking someone up while hauling lets the cart go, and the walk comes back whole in the end
        InnerMapCarry.putDown(game);
        expect(InnerMap._playerSpeed).toBe(base);
        expect(InnerMapCarts.take(game, mine)).toBe(true);
        victim.state = 'unconscious';
        expect(InnerMapCarry.pickUp(game, victim)).toBe(true);
        InnerMapCarts.update(0.1, game);
        expect(InnerMapCarts.pushing).toBe(null);
        InnerMapCarry.putDown(game);
        expect(InnerMap._playerSpeed).toBeCloseTo(base, 6);
        InnerMapCarry.reset();
    }, 60000);

    it('taking a town cart in sight of the townsfolk is theft of its use', () => {
        const game = enter(14);
        const s = openRun();
        const c = InnerMapCarts._add('handcart', [{ q: s.q, r: s.r }], { owner: 'town' });
        InnerMap.playerInnerQ = s.q + 1; InnerMap.playerInnerR = s.r;
        const w = InnerMap.npcs.find(x => x.state !== 'inside_building' && x.state !== 'gone');
        w.state = 'idle'; w.q = s.q + 2; w.r = s.r + 1;
        game.player.karma = 0;
        expect(InnerMapCarts.take(game, c)).toBe(true);
        expect(game.notes.some(t => /Seen/.test(t))).toBe(true);
        expect(w._bark && w._bark.text).toBeTruthy();
        InnerMapCarts._release(game, { quiet: true });
    }, 60000);

    it('in a plague, the death cart goes to the marked doors, takes up the dead and makes for the churchyard or the pit', () => {
        const game = enter(6);
        const s = game.settlement;
        const day = game.world.day;
        s.sickness = { k: 'plague', d: day, epi: true };
        const houses = InnerMap._townBuildings().filter(b => b.type === 'house').slice(0, 3);
        expect(houses.length).toBeGreaterThan(1);
        InnerMap._plagueDoors = houses;
        // Two of the town dead these days
        const folk = s.folk;
        folk.annals.push({ k: 'died', a: folk.people[0].id, d: day, x: 'the plague' }, { k: 'died', a: folk.people[1].id, d: day - 1, x: 'the plague' });
        const doors = houses.map(h => InnerMap._findPassableAdjacentTile(h.q, h.r));
        let cart = null;
        const visited = new Set();
        let maxBodies = 0;
        const bad = [];
        run(game, 400, 0.25, () => {
            InnerMap._plagueDoors = houses;
            cart = cart || InnerMap.streetCarts().find(c => c.job === 'plague');
            if (!cart) return true;
            maxBodies = Math.max(maxBodies, cart.bodies);
            if (cart.phase === 'door' && cart.stopT > 0 && cart.driver) {
                doors.forEach((d, i) => { if (Math.max(Math.abs(cart.driver.q - d.q), Math.abs(cart.driver.r - d.r)) <= 3) visited.add(i); });
            }
            bad.push(...overlaps());
            return cart.job !== 'plague_done';
        });
        expect(cart).toBeTruthy();
        expect(visited.size).toBe(doors.length);
        expect(maxBodies).toBe(2);
        expect(cart.job).toBe('plague_done');
        expect(cart.driver).toBe(null);
        expect(game.notes.some(t => /death cart/.test(t))).toBe(true);
        expect(bad).toEqual([]);
        // Not again the same morning
        run(game, 10);
        expect(InnerMap.streetCarts().filter(c => c.job === 'plague').length).toBe(0);
    }, 120000);

    it('a caravan leaving today is loaded at the market and rolls out of the gate', () => {
        const game = enter(8);
        const day = game.world.day;
        game.world.units.push({ id: 'trade_9', type: 'trade_caravan', sourceQ: 5, sourceR: 6, departed: day, mainGood: 'wool', toName: 'Farholt' });
        let wagon = null, loaded = false, rolled = false, gone = false, merchant = null;
        const bad = [];
        run(game, 400, 0.25, () => {
            const w = InnerMap.streetCarts().find(c => c.kind === 'wagon');
            if (w) {
                wagon = w;
                merchant = merchant || w.driver;
                if (w.phase === 'load') { loaded = true; expect((w.porters || []).length).toBeGreaterThan(0); }
                if (w.phase === 'out' && w.driver && w.driver.state === 'walking') rolled = true;
                bad.push(...overlaps());
            } else if (wagon) { gone = true; return false; }
            return true;
        });
        expect(wagon).toBeTruthy();
        expect(wagon.trail.length).toBe(2);
        expect(loaded).toBe(true);
        expect(rolled).toBe(true);
        expect(gone).toBe(true);
        expect(merchant.state).toBe('gone');
        expect(bad).toEqual([]);
        // Once only
        run(game, 20);
        expect(InnerMap.streetCarts().some(c => c.kind === 'wagon')).toBe(false);
    }, 120000);
});

describe('A handcart of your own', () => {
    it('is a market good the woodworkers sell and the cartwrights make from planks and iron', () => {
        const gd = DataLoader._gamedata;
        expect(gd.playerEconomy.GOODS.HANDCART.id).toBe('handcart');
        expect(gd.marketStalls.trades.woodworker.goods).toContain('handcart');
        expect(gd.markets.goods.handcart).toBeTruthy();
        expect(gd.markets.recipes.find(x => x.out && x.out.handcart)).toMatchObject({ in: { planks: 6 } });
        expect(gd.crafting.recipes.find(r => r.result && r.result.handcart)).toBeTruthy();
        // Bought at a town's market: in the pack, and the cart stands beside you on the street
        const s = { name: 'Cartham', type: 'town', population: 3000 };
        const goods = Trading.getAvailableGoods(s, null, null);
        const good = goods.find(g => g.id === 'handcart');
        expect(good).toBeTruthy();
        good.quantity = Math.max(1, good.quantity);
        const player = new Player();
        player.gold = 500;
        player.inventory = {};
        const res = Trading.buyGoods(player, good, 1, s);
        expect(res.success).toBe(true);
        expect(player.gold).toBeLessThan(500);
        expect(Carts.owns(player)).toBe(true);
    });
});
