// Headless playtest soak: a scripted bot (playtest/bot.js) plays generated
// worlds through the same daily sequence as ui/game/endDay.js
// (playtest/harness.js), while the test checks invariants every day — no
// exceptions, finite numbers, no runaway gold, no overfilled packs or negative
// stacks, no same-tile buy→sell money loops — and a save → JSON → load round
// trip mid-run keeps the game state and the run going.
//
// A simulated day costs ~40ms on an 80x60 world, so the default run is sized
// for the normal suite. SOAK=1 plays the long game (5 seeds × 800 days);
// SOAK_VERBOSE=1 prints each run's stats and gold ledger.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PlayerInventory } from '../core/inventory.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { Ships } from '../systems/ships.js';
import { Underworld } from '../systems/underworld.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const LONG = !!ENV.SOAK;
const SEEDS = ENV.SOAK_SEEDS ? ENV.SOAK_SEEDS.split(',').map(Number) : LONG ? [101, 202, 303, 404, 505] : [101, 202];
const DAYS = LONG ? 800 : 150;
const SAVE_AT = Math.floor(DAYS / 2);
const TIMEOUT = LONG ? 600000 : 60000;
const GOLD_CAP = 1e7;

// The engine logs chattily (pathfinding, generation); keep the run quiet
let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Every invariant the run must hold; returns a list of problems. */
function checkInvariants(game, phase) {
    const { player, world } = game;
    const where = `seed ${game.seed} day ${world.day} (${phase})`;
    const problems = [];
    for (const key of ['gold', 'health', 'karma', 'renown']) {
        if (!finite(player[key])) problems.push(`${where}: player.${key} = ${player[key]}`);
    }
    if (player.gold > GOLD_CAP) problems.push(`${where}: runaway economy, player gold ${Math.round(player.gold)}`);
    if (player.gold < 0) problems.push(`${where}: negative gold ${player.gold} — trace ${JSON.stringify(game.trace || [])}`);
    if (player.house && !finite(player.house.prestige)) problems.push(`${where}: house prestige = ${player.house.prestige}`);
    for (const k of world.kingdoms) {
        if (!k.isAlive) continue;
        for (const key of ['treasury', 'military']) {
            if (!finite(k[key])) problems.push(`${where}: kingdom ${k.name}.${key} = ${k[key]}`);
        }
    }
    const used = PlayerInventory.getUsedSlots(player);
    const cap = PlayerInventory.getCapacity(player);
    if (used > cap) problems.push(`${where}: inventory ${used}/${cap} slots — ${Object.keys(player.inventory).join(', ')}`);
    for (const [id, qty] of Object.entries(player.inventory || {})) {
        if (!finite(qty) || qty < 0) problems.push(`${where}: inventory ${id} = ${qty}`);
    }
    for (const ship of player.ships || []) {
        for (const [id, qty] of Object.entries(ship.cargo || {})) {
            if (!finite(qty) || qty < 0) problems.push(`${where}: ship ${ship.name} cargo ${id} = ${qty}`);
        }
    }
    for (const u of player.army || []) {
        if (!finite(u.strength)) problems.push(`${where}: army unit ${u.type} strength = ${u.strength}`);
    }
    if (player.health > (player.maxHealth || 100)) problems.push(`${where}: health ${player.health} over max ${player.maxHealth}`);
    // The world's books, every tenth day (a full scan)
    if (world.day % 10 === 0) {
        for (const k of world.kingdoms) {
            if (k.isAlive && (!finite(k.population) || k.population < 0)) problems.push(`${where}: kingdom ${k.name}.population = ${k.population}`);
        }
        for (const s of world.getAllSettlements()) {
            if (!finite(s.population) || s.population < 0) problems.push(`${where}: settlement ${s.name}.population = ${s.population}`);
            const loyalty = s.colony && s.colony.loyalty;
            if (s.colony && !finite(loyalty)) problems.push(`${where}: colony ${s.name}.loyalty = ${loyalty}`);
        }
    }
    return problems;
}

/**
 * Same-tile arbitrage probe: what the player could buy here right now and
 * at once sell back here, or in a settlement one hex away (town market,
 * fence, black market, port), for more.
 * Run for the player as they are and for a trade-buffed version of them
 * (trade agreements with every realm), since bonuses are what open loops.
 */
function probeArbitrage(game) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement) return [];
    const buffed = Object.create(player);
    buffed.tradeAgreements = Object.fromEntries(world.kingdoms.map(k => [k.id, { untilDay: world.day + 99 }]));
    const found = [];
    for (const p of [player, buffed]) {
        const who = p === player ? 'player' : 'buffed';
        const buys = {};
        const discount = Math.max(0.5, 1 - Trading.buyDiscount(p, tile.settlement));
        for (const g of Trading.getAvailableGoods(tile.settlement, tile, world)) {
            if (g.quantity > 0) buys[g.id] = { price: Math.ceil(g.price * discount), via: 'market' };
        }
        const port = Ships.isPortTile(world, tile.q, tile.r) ? Ships.getPortMarket(world, tile.q, tile.r) : [];
        for (const e of port) {
            if (e.buy && (!buys[e.id] || e.buy < buys[e.id].price)) buys[e.id] = { price: e.buy, via: 'port' };
        }
        // The ship's chandler's provisions
        if (port.length) {
            const item = Ships._getProvisionSettings().item;
            const price = Ships.provisionPrice(world, tile.q, tile.r);
            if (!buys[item] || price < buys[item].price) buys[item] = { price, via: 'chandler' };
        }
        // Sell back here, or one hex away (settlements next door)
        const outlets = [tile, ...Hex.neighbors(tile.q, tile.r)
            .map(n => world.getTile(Hex.wrapQ(n.q, world.width), n.r))
            .filter(t => t && t.settlement)];
        for (const [id, buy] of Object.entries(buys)) {
            const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === id);
            for (const at of outlets) {
                const offers = [];
                if (good) offers.push({ via: 'market', price: Trading.saleUnitPrice(p, good, at.settlement, world) });
                offers.push({ via: 'blackMarket', price: Underworld.blackMarketPrice(world, at, id) });
                if (Underworld.hasGuildPresence(at.settlement)) offers.push({ via: 'fence', price: Underworld.fencePrice(p, id, world, at) });
                const atPort = at === tile ? port : Ships.isPortTile(world, at.q, at.r) ? Ships.getPortMarket(world, at.q, at.r) : [];
                const e = atPort.find(x => x.id === id);
                if (e) offers.push({ via: 'port', price: Ships.portSaleUnitPrice(p, world, at.q, at.r, e) });
                for (const o of offers) {
                    if (o.price > buy.price) {
                        found.push(`${who} ${id}: buy ${buy.price} (${buy.via}) at ${tile.settlement.name} → sell ${Math.round(o.price * 100) / 100} (${o.via}) at ${at.settlement.name}`);
                    }
                }
            }
        }
    }
    return found;
}

/** Terrain, rivers and resources of the whole map, compactly (a reload must regenerate them). */
function terrainDigest(world) {
    const parts = [];
    for (const row of world.tiles) {
        parts.push(row.map(t => `${t.terrain.id}${t.hasRiver ? '~' : ''}${t.resource ? t.resource.id : ''}${t.settlement ? '#' : ''}`).join(','));
    }
    return Utils.hashStr(parts.join('|'));
}

/** The state a save → load round trip must keep. */
function snapshot(game) {
    const p = game.player;
    return {
        day: game.world.day, gold: p.gold, health: p.health, karma: p.karma, renown: p.renown,
        q: p.q, r: p.r, inventory: { ...p.inventory },
        army: (p.army || []).length, ships: (p.ships || []).map(s => [s.id, s.crew, s.status]),
        colonies: (p.colonies || []).length, properties: (p.properties || []).length,
        prestige: p.house && p.house.prestige, party: (p.travelParty || []).slice(),
        guild: JSON.stringify(Underworld.ensure(p).guild),
        petitions: ((p.petitions && p.petitions.pending) || []).length,
        kingdoms: game.world.kingdoms.map(k => [k.id, k.isAlive, Math.round(k.treasury), k.religion && Math.round(k.religion.piety),
            k.cultureData && Math.round(k.cultureData.influence)]),
        holySites: game.world.tiles.flat().filter(t => t.holySite).map(t => `${t.q},${t.r}:${t.holySite.controller}`).join(' '),
        terrain: terrainDigest(game.world),
    };
}

function runSoak(seed) {
    let game = newGame(seed);
    const stats = {};
    const problems = [];
    const arbitrage = new Set();
    const history = [];
    let died = null;
    const startDay = game.world.day;
    for (let i = 0; i < DAYS; i++) {
        const day = game.world.day;
        try {
            botDay(game, stats);
        } catch (e) {
            throw new Error(`seed ${seed} day ${day}: bot action threw: ${e.stack}`);
        }
        problems.push(...checkInvariants(game, 'after actions'));
        for (const a of probeArbitrage(game)) arbitrage.add(a);
        let res;
        try {
            res = endDay(game);
        } catch (e) {
            throw new Error(`seed ${seed} day ${day}: endDay threw: ${e.stack}`);
        }
        problems.push(...checkInvariants(game, 'after endDay'));
        const pl = game.player;
        history.push([game.world.day, Math.round(pl.gold), Math.round(pl.health), pl.getFoodCount(), pl.starvationDays || 0,
            pl.jailState ? 'jail' : pl.indenturedServitude ? 'servitude' : '', `${pl.q},${pl.r}`]);
        if (history.length > 12) history.shift();
        if (problems.length) break;
        if (res.died) { died = `${res.died} on day ${game.world.day}`; break; }
        if (i === SAVE_AT) {
            const before = snapshot(game);
            game = roundTrip(game);
            expect(snapshot(game), `seed ${seed}: save/load round trip changed state`).toEqual(before);
            problems.push(...checkInvariants(game, 'after load'));
        }
    }
    return { game, stats, problems, arbitrage: [...arbitrage], died, history, days: game.world.day - startDay };
}

const totals = {};

describe('headless playtest soak', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: the bot plays ${DAYS} days without breaking an invariant`, () => {
            const { game, stats, problems, arbitrage, died, history, days } = runSoak(seed);
            for (const [k, v] of Object.entries(stats)) totals[k] = (totals[k] || 0) + v;
            if (ENV.SOAK_VERBOSE) {
                const uw = game.player.underworld;
                const report = {
                    days, died, gold: Math.round(game.player.gold), stats, ledger: game.ledger,
                    history: died ? history.map(h => h.join(' ')) : undefined,
                    uw: uw && { guild: uw.guild, rackets: uw.rackets, stats: uw.stats },
                    arbitrage: arbitrage.slice(0, 20),
                };
                process.stdout.write(`seed ${seed} ${JSON.stringify(report, null, 1)}\n`);
            }
            expect(problems, problems.slice(0, 10).join('\n')).toEqual([]);
            expect(arbitrage, `same-tile buy→sell loops:\n${arbitrage.slice(0, 10).join('\n')}`).toEqual([]);
            // A pauper's death late in a long run is a hard-luck story the game
            // allows (jailed, broke, sick, on barren ground). Anything else is a
            // bug: dying with money in the purse, or dying early.
            const pauperDeath = died && game.player.gold < 200 && days >= Math.min(DAYS, 300);
            if (!pauperDeath) {
                expect(died, `the bot died: ${history.map(h => h.join(' ')).join(' | ')}`).toBe(null);
                expect(days).toBe(DAYS);
            }
        }, TIMEOUT);
    }

    it('the bot reached the systems it is meant to exercise', () => {
        for (const key of ['foodBought', 'recruited', 'sales', 'coloniesFounded', 'guildJoined', 'delvesStarted',
            'petitionsRuled', 'companionsHired', 'shipsBought', 'crewHired', 'voyages', 'daysAtSea', 'propertiesBuilt']) {
            expect(totals[key] || 0, `the bot never did "${key}" — ${JSON.stringify(totals)}`).toBeGreaterThan(0);
        }
    });
});
