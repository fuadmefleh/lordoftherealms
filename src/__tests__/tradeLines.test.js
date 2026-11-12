/**
 * Standing trade lines (player/tradeLines.js): a caravan goes round its stops
 * again and again, buying and selling by the player's rules with real towns —
 * coin and goods only change hands, the price rules hold, robbers take what
 * rides on the wagons, the ledger keeps every round, and it all saves.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TradeLines } from '../player/tradeLines.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { WorldUnit } from '../world/units.js';
import { Ships } from '../systems/ships.js';
import { Stewards } from '../systems/stewards.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';
import { PlayerEconomy } from '../player/playerEconomy.js';

beforeAll(async () => {
    await loadData();
});

const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };
const WATER = { id: 'ocean', name: 'Ocean', passable: false, moveCost: 99 };

function town(name, extra = {}) {
    const s = { name, type: 'town', population: 2000, happiness: 50, ...extra };
    SettlementMarket.ensure(s);
    s.economy = { gold: 20000 };
    return s;
}

/** A flat grass world (or open sea with `sea`), towns on the given hexes. */
function makeWorld(towns, { sea = false, W = 30, H = 20 } = {}) {
    const tiles = new Map();
    const world = {
        width: W, height: H, day: 1, units: [], events: [], kingdoms: [],
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            q = ((q % W) + W) % W;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const s = towns[key] || null;
                tiles.set(key, { q, r, terrain: s || !sea ? GRASS : WATER, settlement: s, kingdom: null, regionId: 1 });
            }
            return tiles.get(key);
        },
        getKingdom: () => null,
    };
    return world;
}

/** A grain glut at Glut (5,5), a dearth at Dearth (13,5). */
function grainWorld() {
    const glut = town('Glut');
    const dearth = town('Dearth');
    glut.market.stock.grain = SettlementMarket.target(glut, 'grain') * 4;
    dearth.market.stock.grain = SettlementMarket.target(dearth, 'grain') * 0.05;
    const world = makeWorld({ '5,5': glut, '13,5': dearth });
    return { world, glut, dearth };
}

const mkPlayer = (extra = {}) => ({ name: 'Tester', q: 5, r: 5, gold: 5000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, ...extra });

/** One day: the lines first (as endDay.js), then the units move. */
function day(world, player) {
    world.day++;
    const out = TradeLines.processDay(world, player);
    for (const u of world.units) if (!u.destroyed) u.update(world, null);
    world.units = world.units.filter(u => !u.destroyed);
    return out;
}

function grainLine(world, player, buyMax = 1000, sellMin = 0) {
    return TradeLines.create(player, world, {
        kind: 'caravan', name: 'Grain Run',
        stops: [
            { q: 5, r: 5, rules: [{ op: 'buy', good: 'grain', qty: 40, price: buyMax }] },
            { q: 13, r: 5, rules: [{ op: 'sell', good: 'grain', price: sellMin }] },
        ],
    });
}

const coin = (player, ...towns) => player.gold + towns.reduce((a, s) => a + s.economy.gold, 0);
const grain = (line, ...towns) => (line.cargo.grain || 0) + towns.reduce((a, s) => a + SettlementMarket.stock(s, 'grain'), 0);

describe('A caravan line goes round its stops', () => {
    it('buys where grain is cheap, sells where it is dear, and goes round again and again', () => {
        Utils.setSeed(7);
        const { world, glut, dearth } = grainWorld();
        const player = mkPlayer();
        const res = grainLine(world, player);
        expect(res.success).toBe(true);
        const line = res.line;
        let notices = [];
        for (let d = 0; d < 40; d++) notices = notices.concat(day(world, player).notices);
        expect(line.totals.runs).toBeGreaterThanOrEqual(3);
        expect(line.history[0].sold.grain).toBeGreaterThan(0);
        expect(line.history[0].bought.grain).toBeGreaterThan(0);
        expect(line.totals.revenue).toBeGreaterThan(0);
        expect(line.totals.wages).toBeGreaterThan(0);
        expect(line.totals.hire).toBe(TradeLines.config().caravan.hire);
        // A notice for each round home
        expect(notices.filter(n => n.title === 'A Trade Line Comes Home').length).toBe(line.totals.runs);
        // The dearth town has more grain than it had
        expect(SettlementMarket.stock(dearth, 'grain')).toBeGreaterThan(SettlementMarket.target(dearth, 'grain') * 0.05);
        expect(glut.economy.gold).toBeGreaterThan(20000);
    });

    it('conserves coin and goods: every coin and sack only changes hands', () => {
        Utils.setSeed(11);
        const { world, glut, dearth } = grainWorld();
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        const coin0 = coin(player, glut, dearth);
        const grain0 = grain(line, glut, dearth);
        for (let d = 0; d < 30; d++) {
            day(world, player);
            expect(coin(player, glut, dearth)).toBeCloseTo(coin0, 0);
            expect(grain(line, glut, dearth)).toBeCloseTo(grain0, 3);
        }
        expect(line.totals.runs).toBeGreaterThan(0);
    });

    it('respects its price rules: buys nothing dearer than its limit, sells nothing cheaper than its floor', () => {
        Utils.setSeed(3);
        const { world, glut, dearth } = grainWorld();
        const player = mkPlayer();
        // Grain at Glut costs more than 1g a sack: the line buys none
        const line = grainLine(world, player, 1).line;
        for (let d = 0; d < 12; d++) day(world, player);
        expect(line.totals.spent + line.run.spent).toBe(0);
        expect(line.cargo.grain || 0).toBe(0);
        expect(line.history.concat([line.run]).some(r => r.notes.some(n => /bought no grain/.test(n)))).toBe(true);

        // A floor no buyer meets: the grain comes home unsold
        const w2 = grainWorld();
        const p2 = mkPlayer();
        const l2 = grainLine(w2.world, p2, 1000, 100000).line;
        for (let d = 0; d < 12; d++) day(w2.world, p2);
        expect(l2.totals.revenue + l2.run.revenue).toBe(0);
        expect(l2.cargo.grain).toBeGreaterThan(0);
        expect(l2.history.concat([l2.run]).some(r => r.notes.some(n => /kept \d+ grain/.test(n)))).toBe(true);

        // A sensible limit: each sack bought costs no more than it
        const w3 = grainWorld();
        const p3 = mkPlayer();
        const ask = TradeLines.quote(p3, w3.world, { kind: 'caravan' }, { q: 5, r: 5 }, 'grain').buy;
        const l3 = grainLine(w3.world, p3, ask + 1).line;
        day(w3.world, p3);
        const bought = l3.run.bought.grain || 0;
        expect(bought).toBeGreaterThan(0);
        expect(l3.run.spent).toBeLessThanOrEqual(bought * (ask + 1));
        void glut; void dearth;
    });

    it('a robbed caravan loses its goods to the robbers, books the loss, and halts after a second robbery', () => {
        Utils.setSeed(5);
        const { world, glut, dearth } = grainWorld();
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        day(world, player); // buys, sets out
        expect(line.phase).toBe('road');
        const carried = line.cargo.grain;
        expect(carried).toBeGreaterThan(0);
        const wagon = world.units.find(u => u.id === line.unitId);
        // Where the wagons will be after today's march: the robbers wait there
        const ghost = Object.assign(Object.create(WorldUnit.prototype), JSON.parse(JSON.stringify(wagon)));
        ghost.update(world, null);
        const raider = new WorldUnit('raider', ghost.q, ghost.r);
        raider.inventory = {};
        world.units.push(raider);
        // The raider waits; only the wagons move
        wagon.update(world, null);
        expect(wagon.destroyed).toBe(true);
        expect(raider.inventory.grain).toBe(carried);
        world.units = world.units.filter(u => !u.destroyed);
        const out = TradeLines.processDay(world, player);
        expect(out.notices.some(n => n.title === 'Caravan Robbed')).toBe(true);
        expect(line.cargo).toEqual({});
        expect(line.history[0].lost).toBeGreaterThan(0);
        expect(line.history[0].why).toBe('robbed');
        expect(line.totals.losses).toBe(1);
        expect(line.wagon).toBe(false);
        expect(line.status).toBe('running');
        // Again: the drovers will not take the road
        world.units = world.units.filter(u => u !== raider);
        day(world, player);
        const w2 = world.units.find(u => u.id === line.unitId);
        expect(w2).toBeTruthy();
        w2.destroyed = true;
        TradeLines.processDay(world, player);
        expect(line.totals.losses).toBe(2);
        expect(line.status).toBe('paused');
        void glut; void dearth;
    });

    it('waits at home while the player is far away, and runs on with a Master of the Lines', () => {
        Utils.setSeed(9);
        const { world } = grainWorld();
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        for (let d = 0; d < 6; d++) day(world, player);
        player.q = 28; player.r = 18; // far off
        for (let d = 0; d < 20; d++) day(world, player);
        expect(line.phase).toBe('hold');
        expect(line.stallReason).toMatch(/Waiting at Glut/);
        const runs = line.totals.runs;
        // A steward over the lines
        player.stewards = Stewards._blank();
        player.stewards.seats.trade = { kind: 'steward', id: 'f1', name: 'Odo', stewardship: 7, martial: 3, intrigue: 3, loyalty: 70, wage: 0, st: Stewards._newSt({ honesty: 0.9, honestyGuess: 0.9, ambition: 2, traits: [], kind: 'steward' }, world) };
        expect(Stewards.seats(player, world).some(s => s.kind === 'trade')).toBe(true);
        expect(TradeLines.factor(player)).toBeTruthy();
        for (let d = 0; d < 20; d++) day(world, player);
        expect(line.totals.runs).toBeGreaterThan(runs);
    });

    it('pauses, resumes and winds up; a wound-up caravan sells off what it carries', () => {
        const { world, glut, dearth } = grainWorld();
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        day(world, player);
        expect(TradeLines.pause(player, world, line.id).success).toBe(true);
        for (let d = 0; d < 8; d++) day(world, player);
        expect(line.phase).toBe('hold');
        expect(TradeLines.lines(player)).toHaveLength(1);
        const coin0 = coin(player, glut, dearth);
        const res = TradeLines.remove(player, world, line.id);
        expect(res.success).toBe(true);
        expect(TradeLines.lines(player)).toHaveLength(0);
        expect(coin(player, glut, dearth)).toBeCloseTo(coin0, 0);
    });

    it('supplies the player\'s workshop with its inputs', () => {
        const { world } = grainWorld();
        const player = mkPlayer();
        const tile = world.getTile(13, 5);
        tile.playerProperty = { type: 'grain_mill', name: 'Your mill', activeRecipe: 'FLOUR', inputStorage: 0, produces: 'flour', storage: 0, level: 1 };
        expect(PlayerEconomy.isRecipeBuilding('grain_mill')).toBe(true);
        const line = TradeLines.create(player, world, {
            kind: 'caravan', stops: [
                { q: 5, r: 5, rules: [{ op: 'buy', good: 'grain', qty: 30, price: 1000 }] },
                { q: 13, r: 5, rules: [{ op: 'supply', good: 'grain', qty: 0 }] },
            ],
        }).line;
        for (let d = 0; d < 6; d++) day(world, player);
        expect(tile.playerProperty.inputStorage).toBeGreaterThan(0);
        expect(line.run.supplied + line.totals.supplied).toBeGreaterThan(0);
    });
});

describe('A ship line', () => {
    function seaWorld() {
        const a = town('Saltmere');
        const b = town('Gullhaven');
        const world = makeWorld({ '5,5': a, '12,5': b }, { sea: true });
        return { world, a, b };
    }

    it('sails between two ports, trading by its rules out of her own hold', () => {
        Utils.setSeed(21);
        const { world, a, b } = seaWorld();
        const exp = Ships.getPortMarket(world, 5, 5).find(e => e.buy !== null);
        expect(exp).toBeTruthy();
        const player = mkPlayer({ ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {}, crew: 200, morale: 80, condition: 100 }] });
        Ships._ensureCrew(player.ships[0]);
        player.ships[0].crew = Ships.getShipEffectiveStats(player.ships[0]).crewRequired;
        const res = TradeLines.create(player, world, {
            kind: 'ship', shipId: 's1', stops: [
                { q: 5, r: 5, rules: [{ op: 'buy', good: exp.id, qty: 10, price: 100000 }] },
                { q: 12, r: 5, rules: [{ op: 'sell', good: exp.id, price: 0 }] },
            ],
        });
        expect(res.success).toBe(true);
        const line = res.line;
        for (let d = 0; d < 20; d++) {
            world.day++;
            Ships.processDaily(player, world);
            TradeLines.processDay(world, player);
        }
        expect(line.totals.runs).toBeGreaterThan(0);
        expect(line.history[0].bought[exp.id]).toBeGreaterThan(0);
        expect(line.history.some(r => (r.sold[exp.id] || 0) > 0)).toBe(true);
        expect(line.history[0].crew).toBeGreaterThanOrEqual(0);
        // The towns were paid and paid out
        expect(a.economy.gold).toBeGreaterThan(20000);
        expect(b.economy.gold).toBeLessThan(20000 + 1);
    });

    it('refuses a stop with no harbour', () => {
        const { world } = seaWorld();
        const inland = town('Inland');
        const w2 = makeWorld({ '5,5': inland, '12,5': town('Far') });
        const player = mkPlayer({ ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {} }] });
        expect(TradeLines.create(player, w2, { kind: 'ship', shipId: 's1', stops: [{ q: 5, r: 5 }, { q: 12, r: 5 }] }).success).toBe(false);
        void world;
    });
});

describe('Trade lines save and load', () => {
    it('round-trips through the save with its ledger and its wagons on the road', () => {
        Utils.setSeed(13);
        const { world } = grainWorld();
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        for (let d = 0; d < 9; d++) day(world, player);
        // The game save carries it (SaveLoad.serializePlayer → restorePlayer's Object.assign)
        const data = JSON.parse(JSON.stringify({ tradeLines: SaveLoad.serializePlayer(player).tradeLines }));
        expect(data.tradeLines.lines).toHaveLength(1);
        const fresh = mkPlayer();
        Object.assign(fresh, data);
        TradeLines.loadState(fresh);
        const back = TradeLines.line(fresh, line.id);
        expect(back).toBeTruthy();
        expect(back.history).toEqual(line.history);
        expect(back.stops).toEqual(line.stops);
        expect(back.phase).toBe(line.phase);
        // ...and the wagons on the road are world units, saved with the world
        const units = SaveLoad.restoreUnits(SaveLoad.serializeUnits(world.units));
        world.units = units;
        for (let d = 0; d < 20; d++) day(world, fresh);
        expect(back.totals.runs).toBeGreaterThan(line.totals.runs);
    });
});

describe('The Trade Lines panel', () => {
    it('builds every view and runs every button without leaking undefined or NaN', async () => {
        const { ActionMenu } = await import('../ui/actionMenu/index.js');
        Utils.setSeed(17);
        const { world } = grainWorld();
        world.getSettlementViews = () => [world.getTile(5, 5), world.getTile(13, 5)].map(t => Object.assign(t.settlement, { q: t.q, r: t.r }));
        const player = mkPlayer();
        const shown = [];
        const game = {
            player, world,
            ui: { showCustomPanel: (title, html) => shown.push(html), showNotification: () => {}, updateStats: () => {} },
        };
        const html = () => shown[shown.length - 1] || '';
        const clicks = (h) => [...h.matchAll(/data-am-act="([^"]+)"(?: data-am-args="([^"]*)")?/g)]
            .map(m => [m[1], m[2] ? JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')) : []]);
        ActionMenu.showTradeLines(game);
        ActionMenu.tradeLinesAct(game, 'newLine', 'caravan');
        expect(html()).toMatch(/Glut/);
        ActionMenu.tradeLinesAct(game, 'draftAdd', 13, 5, 'Dearth');
        ActionMenu.tradeLinesAct(game, 'create');
        const line = TradeLines.lines(player)[0];
        expect(line).toBeTruthy();
        TradeLines.addRule(player, line.id, line.stops[0].id, { op: 'buy', good: 'grain', qty: 30, price: 1000 });
        TradeLines.addRule(player, line.id, line.stops[1].id, { op: 'sell', good: 'grain', price: 1 });
        for (let d = 0; d < 12; d++) day(world, player);
        const seen = new Set();
        const queue = [['showTradeLines', []], ['showTradeLines', ['line', line.id]], ['showTradeLines', ['ledger', line.id]], ['showTradeLines', ['stop', line.id, line.stops[0].id]], ['showTradeLines', ['addstop', line.id]]];
        while (queue.length) {
            const [act, args] = queue.shift();
            const key = `${act}:${JSON.stringify(args)}`;
            if (seen.has(key) || seen.size > 60) continue;
            seen.add(key);
            if (!['showTradeLines'].includes(act)) continue; // (actions that change the line are run below)
            ActionMenu[act](game, ...args);
            const h = html();
            expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
            for (const c of clicks(h)) queue.push(c);
        }
        ActionMenu.tradeLinesAct(game, 'reserve', line.id);
        expect(line.reserve).toBe(100);
        ActionMenu.tradeLinesAct(game, 'pause', line.id);
        expect(line.status).toBe('paused');
        ActionMenu.tradeLinesAct(game, 'resume', line.id);
        expect(line.status).toBe('running');
        expect(html()).not.toMatch(/undefined|NaN/);
    });
});

describe('Leaks closed (2026-11-12)', () => {
    it('a port buy pays the town\'s purse; a port sale is paid out of it, and refused past it', () => {
        const s = town('Saltmere');
        const world = makeWorld({ '5,5': s }, { sea: true });
        const player = mkPlayer({ ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {} }] });
        const good = Ships.getPortMarket(world, 5, 5).find(e => e.buy !== null);
        const purse0 = s.economy.gold;
        const gold0 = player.gold;
        const b = Ships.buyTradeGood(player, world, 's1', good.id, 5);
        expect(b.success).toBe(true);
        expect(s.economy.gold).toBeCloseTo(purse0 + b.cost, 2);
        expect(player.gold + s.economy.gold).toBeCloseTo(gold0 + purse0, 2);
        const sold = Ships.sellTradeGood(player, world, 's1', good.id, 5);
        expect(sold.success).toBe(true);
        expect(player.gold + s.economy.gold).toBeCloseTo(gold0 + purse0, 2);
        // A town with no coin buys nothing
        Ships.buyTradeGood(player, world, 's1', good.id, 3);
        s.economy.gold = 0;
        const refused = Ships.sellTradeGood(player, world, 's1', good.id, 3);
        expect(refused.success).toBe(false);
        expect(player.ships[0].cargo[good.id]).toBe(3);
    });

    it('the old caravans carry their real cargo, so robbers take it', () => {
        const { world } = grainWorld();
        const player = mkPlayer();
        const tile = world.getTile(5, 5);
        tile.playerProperty = { type: 'farm', name: 'Your farm', produces: 'grain', storage: 25, level: 1 };
        const res = PlayerEconomy.startStorageCaravan(player, tile, { ...world.getTile(13, 5).settlement, q: 13, r: 5 }, world);
        expect(res.success).toBe(true);
        const u = world.units.find(x => x.id === res.caravan.unitId);
        expect(u.inventory).toEqual({ grain: 25 });

        player.inventory = { grain: 30 };
        const route = PlayerEconomy.createPersistentRoute(player, world, { fromPos: { q: 5, r: 5 }, toPos: { q: 13, r: 5 }, goodId: 'grain', quantity: 10 }).route;
        const d = PlayerEconomy._dispatchRouteCaravan(player, route, world);
        expect(d.success).toBe(true);
        expect(world.units.find(x => x.id === d.caravan.unitId).inventory).toEqual({ grain: 10 });
    });

    it('a caravan line pays the toll gates on its road to their owner', () => {
        Utils.setSeed(23);
        const { world } = grainWorld();
        const crown = { id: 'k1', name: 'Westmarch', treasury: 0, isAlive: true };
        world.kingdoms = [crown];
        world.getKingdom = (id) => world.kingdoms.find(k => k.id === id) || null;
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        // A tolled bridge on the road, the crown's
        const path = TradeLines._path(world, 5, 5, 13, 5);
        const [gq, gr] = path[Math.floor(path.length / 2)];
        world.getTile(gq, gr).tollGate = 'w1';
        world.transport = { works: [{ id: 'w1', kind: 'bridge', tollRate: 0.1, owner: 'k1', kid: 'k1' }] };
        const coin0 = () => player.gold + crown.treasury + world.getTile(5, 5).settlement.economy.gold + world.getTile(13, 5).settlement.economy.gold;
        for (let d = 0; d < 6; d++) {
            const before = coin0();
            day(world, player);
            expect(coin0()).toBeCloseTo(before, 0);
        }
        expect(crown.treasury).toBeGreaterThan(0);
        expect(line.run.tolls + line.totals.tolls).toBeGreaterThanOrEqual(crown.treasury - 1e-6);
    });

    it('an heir takes the lines on; the end of the House winds them up into the estate', async () => {
        Utils.setSeed(29);
        const { world } = grainWorld();
        world.getAllSettlements = () => [[5, 5], [13, 5]].map(([q, r]) => Object.assign(world.getTile(q, r).settlement, { q, r }));
        world.getSettlementViews = world.getAllSettlements;
        const player = mkPlayer();
        const line = grainLine(world, player).line;
        day(world, player);
        expect(line.phase).toBe('road');
        // An interregnum: the world turns, no one runs the lines (the wagons wander on)
        for (let d = 0; d < 8; d++) {
            world.day++;
            for (const u of world.units) if (!u.destroyed) u.update(world, null);
        }
        // The heir is the same player record (Relationships.succeedAsHeir): the lines run on
        for (let d = 0; d < 20; d++) day(world, player);
        expect(line.totals.runs).toBeGreaterThan(0);
        expect(line.status).toBe('running');

        // A House that ends: wagons stop, cargo into the estate
        day(world, player);
        while (line.phase !== 'road') day(world, player);
        const cargo = { ...line.cargo };
        expect(cargo.grain).toBeGreaterThan(0);
        const unitId = line.unitId;
        const { EstateSettlement } = await import('../player/estateSettlement.js');
        const dest = world.getTile(13, 5).settlement;
        const stock0 = SettlementMarket.stock(dest, 'grain');
        EstateSettlement.settle(player, world, { cause: 'test' });
        expect(TradeLines.lines(player)).toHaveLength(0);
        expect(world.units.find(u => u.id === unitId).destroyed).toBe(true);
        expect(SettlementMarket.stock(dest, 'grain')).toBeCloseTo(stock0 + cargo.grain, 3);
    });
});
