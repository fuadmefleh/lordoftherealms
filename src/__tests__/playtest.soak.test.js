// Headless playtest soak: a scripted bot (playtest/bot.js) plays generated
// worlds through the same daily sequence as ui/game/endDay.js
// (playtest/harness.js), while the test checks invariants every day — no
// exceptions, finite numbers, no runaway gold, no overfilled packs or negative
// stacks, no same-tile buy→sell money loops — and a save → JSON → load round
// trip mid-run keeps the game state and the run going.
//
// Players keep a game for decades, so the run is counted in years (120 days:
// four seasons of 30). The normal suite plays 2 seeds for SOAK_DEFAULT_YEARS;
// SOAK=1 plays the long game (5 seeds × a decade); SOAK_YEARS=100 a century
// (SOAK_DAYS overrides both). A death no longer ends the run: the heir takes
// over, or a new life begins (harness.carryOn), so a long run crosses
// generations. The game is saved and reloaded at the midpoint and every 20
// years. SOAK_VERBOSE=1 prints each run's stats, gold ledger, lives and its
// growth by year (ms/day, save size) — a slow leak shows there first.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PlayerInventory } from '../core/inventory.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { Ships } from '../systems/ships.js';
import { Underworld } from '../systems/underworld.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { WorldUnit } from '../world/units.js';
import { loadData, newGame, endDay, roundTrip, carryOn } from './playtest/harness.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { botDay, personaOf } from './playtest/bot.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const LONG = !!ENV.SOAK;
const SEEDS = ENV.SOAK_SEEDS ? ENV.SOAK_SEEDS.split(',').map(Number) : LONG ? [101, 202, 303, 404, 505] : [101, 202];
const DAYS_PER_YEAR = 120;
const SOAK_DEFAULT_YEARS = 5;
const YEARS = Number(ENV.SOAK_YEARS) || (LONG ? 10 : SOAK_DEFAULT_YEARS);
const DAYS = Number(ENV.SOAK_DAYS) || YEARS * DAYS_PER_YEAR;
const SAVE_AT = Math.floor(DAYS / 2);
const SAVE_EVERY = 20 * DAYS_PER_YEAR;
// A day costs ~60-150ms late in a run (the world fills up); generous for the slow years
const TIMEOUT = Math.max(150000, DAYS * 400);
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

/** Standing with the living realms: "friendly/neutral/hostile, at war" (≥10 / −30…10 / below). */
function standingOf(game) {
    const rep = game.player.reputation || {};
    const wars = Object.keys((game.player.realmWars && game.player.realmWars.wars) || {}).length;
    const vals = (game.world.kingdoms || []).filter(k => k && k.isAlive).map(k => rep[k.id] || 0);
    const n = (f) => vals.filter(f).length;
    return `${n(v => v >= 10)}/${n(v => v > -30 && v < 10)}/${n(v => v <= -30)} min ${Math.round(Math.min(0, ...vals))}${wars ? ` war ${wars}` : ''}`;
}

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
    // The trading company's books: its capital is money too
    const company = MerchantHouses.company(player);
    if (company) {
        if (!finite(company.capital) || company.capital < 0) problems.push(`${where}: company capital = ${company.capital}`);
        if (company.capital > GOLD_CAP) problems.push(`${where}: runaway company, capital ${Math.round(company.capital)}`);
        for (const post of company.posts) {
            for (const [id, qty] of Object.entries(post.stock)) {
                if (!finite(qty) || qty < 0) problems.push(`${where}: post ${post.name} stock ${id} = ${qty}`);
            }
        }
    }
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
    // Tongues (systems/languages.js): every fluency a number in 0..100, and an interpreter on a wage
    for (const [lang, v] of Object.entries(player.languages || {})) {
        if (!finite(v) || v < 0 || v > 100) problems.push(`${where}: language ${lang} fluency = ${v}`);
    }
    if (player.translator && !(player.translator.wage >= 0)) problems.push(`${where}: interpreter wage = ${player.translator.wage}`);
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
 * A trading company's factor buys and sells here by the same rules, so a
 * post here (or next door) is an outlet too, and so is a supply contract
 * the company could deliver to on this tile or next door.
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
        // A factor's buying price at a post here
        for (const g of Trading.getAvailableGoods(tile.settlement, tile, world)) {
            const unit = MerchantHouses.factorBuyUnit(p, world, tile, g.id);
            if (unit != null && (!buys[g.id] || unit < buys[g.id].price)) buys[g.id] = { price: unit, via: 'post' };
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
                // A factor selling at a post there, and contracts wanting it delivered there
                offers.push({ via: 'post', price: MerchantHouses.factorSaleUnit(p, world, at, id) });
                const contracts = [...MerchantHouses.board(player), ...((MerchantHouses.company(player) || {}).contracts || [])];
                for (const ct of contracts) {
                    if (ct.good === id && ct.q === at.q && ct.r === at.r) offers.push({ via: 'contract', price: MerchantHouses.contractUnitPay(world, ct) });
                }
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
        buildings: game.world.tiles.flat().filter(t => t.religiousBuilding || t.culturalBuilding)
            .map(t => `${t.q},${t.r}:${t.religiousBuilding ? t.religiousBuilding.type : ''}/${t.culturalBuilding ? t.culturalBuilding.type : ''}`).join(' '),
        terrain: terrainDigest(game.world),
        // World units (raiders, caravans, processions, guardians, war hosts, ...) come back as they were
        units: game.world.units.map(u => `${u.id}:${u.type}@${u.q},${u.r}>${u.targetQ},${u.targetR}:${u.strength}:${u.age}${u.destroyed ? 'x' : ''}`),
        unitClasses: game.world.units.every(u => u instanceof WorldUnit),
        // ...and the player's caravans still find their units
        caravanUnits: (p.caravans || []).filter(c => c.unitId).map(c => game.world.units.some(u => u.id === c.unitId)),
        // Every settlement's goods market (stock, trend, shortages, trade links)
        markets: Utils.hashStr(JSON.stringify(game.world.getSettlementViews().map(s => [s.q, s.r, s.market || null]))),
        // The trading company, rival houses, contracts and the towns' monopolies
        merchant: Utils.hashStr(JSON.stringify(p.merchant || null)),
        // Merchant Prince: works funded, store-rooms, forward contracts, market news
        merchantPrince: Utils.hashStr(JSON.stringify(p.merchantPrince || null)),
        // Patronage: clients, commissions, Great Works; the world's wonders
        patronage: Utils.hashStr(JSON.stringify(p.patronage || null)),
        greatWorks: Utils.hashStr(JSON.stringify(game.world.greatWorks || null)),
        // Underwriters (covers, claims, guilds), bills of exchange, the Bourse (listings, holdings, manias)
        underwriting: Utils.hashStr(JSON.stringify(p.underwriting || null)),
        bills: Utils.hashStr(JSON.stringify(p.bills || null)),
        bourse: Utils.hashStr(JSON.stringify(p.bourse || null)),
        monopolies: game.world.getAllSettlements().filter(s => s.monopolies).map(s => `${s.q},${s.r}:${JSON.stringify(s.monopolies)}`).join(' '),
        idCounter: Utils.getIdCounter(),
    };
}

/** Delve guardians: one live unit per awakened guardian, never a duplicate after a load. */
function guardianProblems(game, phase) {
    const out = [];
    const st = game.player.delves;
    for (const g of (st && st.guardians) || []) {
        if (g.slain || g.gone) continue;
        const n = game.world.units.filter(u => u.delveGuardianId === g.id && !u.destroyed).length;
        if (n > 1) out.push(`seed ${game.seed} day ${game.world.day} (${phase}): ${n} units for guardian ${g.name}`);
    }
    return out;
}

// SOAK_GEN='{"startYear":1}' plays other worlds (here: one begun at the Dawn of Man)
const SOAK_GEN = ENV.SOAK_GEN ? JSON.parse(ENV.SOAK_GEN) : {};

function runSoak(seed) {
    let game = newGame(seed, SOAK_GEN);
    const stats = {};
    const problems = [];
    const arbitrage = new Set();
    const history = [];
    let died = null;
    const lives = [];
    let lifePeak = 0;
    const growth = [];
    let yearStart = performance.now();
    const startDay = game.world.day;
    for (let i = 0; i < DAYS; i++) {
        const day = game.world.day;
        try {
            botDay(game, stats);
        } catch (e) {
            throw new Error(`seed ${seed} day ${day}: bot action threw: ${e.stack}`);
        }
        problems.push(...checkInvariants(game, 'after actions'));
        // (weekly in runs past a decade: the probe walks every market and a millennium is long)
        if (DAYS <= 10 * DAYS_PER_YEAR || i % 7 === 0) for (const a of probeArbitrage(game)) arbitrage.add(a);
        let res;
        try {
            res = endDay(game);
        } catch (e) {
            throw new Error(`seed ${seed} day ${day}: endDay threw: ${e.stack}`);
        }
        problems.push(...checkInvariants(game, 'after endDay'));
        const pl = game.player;
        lifePeak = Math.max(lifePeak, pl.gold || 0);
        history.push([game.world.day, Math.round(pl.gold), Math.round(pl.health), pl.getFoodCount(), pl.starvationDays || 0,
            pl.jailState ? 'jail' : pl.indenturedServitude ? 'servitude' : '', `${pl.q},${pl.r}`]);
        if (history.length > 12) history.shift();
        if (problems.length) break;
        if (res.died) {
            // The death screen's choice: the heir, else a new life (harness.carryOn)
            // (read before carryOn: an heir takes over the same player object)
            const was = game.player.name;
            const diedAge = Math.round(pl.age);
            const temper = game.world.day > 150 ? personaOf(game).id : 'labourer';
            const purse = `peak ${Math.round(lifePeak)}g, left ${Math.round(pl.gold || 0)}g`;
            const family = (pl.children || []).filter(c => c && c.isAlive !== false && !c.isSibling).map(c => `${c.firstName} ${Math.round(c.age)}${c.upbringing && c.upbringing.spouse ? `~${c.upbringing.spouse.kind}@${Math.round(c.age - (game.world.day - c.upbringing.spouse.day) / 120)}` : ''}`).join(' ');
            const next = carryOn(game, res.died);
            const kids = (game.player.children || []).filter(c => c && !c.isSibling && c.isAlive !== false).length;
            lives.push(`${was} [${temper}, ${purse}; kids: ${family || 'none'}${pl.spouse ? '; wed' : ''}]: ${res.died} at ${diedAge} on day ${game.world.day} → ${next.how ? `${next.how} ${game.player.name}, ${Math.round(game.player.age)}${kids ? ` with ${kids} child${kids === 1 ? '' : 'ren'}` : ''}` : 'the end'}`);
            lifePeak = game.player.gold || 0;
            if (!next.how) { died = `${res.died} on day ${game.world.day}`; break; }
        }
        if ((i + 1) % DAYS_PER_YEAR === 0) {
            const now = performance.now();
            const bytes = JSON.stringify({ world: SaveLoad.serializeWorld(game.world), player: SaveLoad.serializePlayer(game.player) }).length;
            growth.push({ year: (i + 1) / DAYS_PER_YEAR, msPerDay: Math.round((now - yearStart) / DAYS_PER_YEAR), saveKB: Math.round(bytes / 1024), gold: Math.round(game.player.gold), age: game.player.age, life: game.player.maxLifespan, standing: standingOf(game) });
            yearStart = performance.now();
        }
        if (i === SAVE_AT || (i > 0 && i % SAVE_EVERY === 0)) {
            const before = snapshot(game);
            game = roundTrip(game);
            expect(snapshot(game), `seed ${seed}: save/load round trip changed state`).toEqual(before);
            problems.push(...checkInvariants(game, 'after load'));
        }
        if (i >= SAVE_AT && i <= SAVE_AT + 3) {
            problems.push(...guardianProblems(game, i === SAVE_AT ? 'after load' : 'after reload day'));
        }
    }
    return { game, stats, problems, arbitrage: [...arbitrage], died, history, lives, growth, days: game.world.day - startDay };
}

const totals = {};

describe('headless playtest soak', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: the bot plays ${DAYS} days (${+(DAYS / DAYS_PER_YEAR).toFixed(1)} years) without breaking an invariant`, () => {
            const { game, stats, problems, arbitrage, died, history, lives, growth, days } = runSoak(seed);
            for (const [k, v] of Object.entries(stats)) totals[k] = (totals[k] || 0) + v;
            if (ENV.SOAK_VERBOSE) {
                const uw = game.player.underworld;
                const report = {
                    days, died, gold: Math.round(game.player.gold), lives, growth: growth.map(g => `y${g.year} ${g.msPerDay}ms/day ${g.saveKB}KB ${g.gold}g age ${g.age}/${g.life} realms ${g.standing}`), stats, ledger: game.ledger,
                    history: died ? history.map(h => h.join(' ')) : undefined,
                    rivalHouses: RivalHouses.rivals(game.player).filter(r => r.head).map(r => `${RivalHouses.headName(r)} ${r.head.age} (${r.name}, head #${(r.stats && r.stats.heads) || 1}): ${Math.round(r.gold)}g, feud ${Math.round(r.feud || 0)}, ${r.head.children.length} kids, trades ${r.stats.trades} (${Math.round(r.stats.tradeProfit)}g), court ${r.stats.courtVisits}, plots paid ${r.stats.plotsPaid}`),
                    uw: uw && { guild: uw.guild, rackets: uw.rackets, stats: uw.stats },
                    company: MerchantHouses.company(game.player) && (({ capital, reputation, posts, stats: cs, contracts }) => ({
                        capital: Math.round(capital), reputation, posts: posts.map(p => `${p.name}: ${JSON.stringify(p.stock)} ${JSON.stringify(p.lastWeek)}`),
                        stats: cs, contracts: contracts.length, pnl: MerchantHouses.profitAndLoss(game.player),
                        rivals: MerchantHouses.rivals(game.player).map(r => `${r.name} ${r.status} ${Math.round(r.capital)}`),
                    }))(MerchantHouses.company(game.player)),
                    arbitrage: arbitrage.slice(0, 20),
                    languages: game.player.languages, native: game.player.nativeLanguage, interpreter: !!game.player.translator,
                    world: (({ kingdoms, dawn }) => ({
                        realms: kingdoms.filter(k => k.isAlive).length,
                        settlements: game.world.getAllSettlements().length,
                        dawn: dawn && { villages: dawn.villagesFounded, towns: dawn.townsRisen, realms: dawn.realmsBorn, done: dawn.realmsDone, over: dawn.over },
                    }))(game.world),
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
        // A world begun at the Dawn of Man has no towns, guilds or courts for its
        // first years: the long-game list is for worlds that start with realms
        if (SOAK_GEN.startYear && SOAK_GEN.startYear < 200) {
            for (const key of ['foodBought', 'travelDays', 'oddJobs']) {
                expect(totals[key] || 0, `the bot never did "${key}" — ${JSON.stringify(totals)}`).toBeGreaterThan(0);
            }
            return;
        }
        for (const key of ['foodBought', 'recruited', 'sales', 'coloniesFounded', 'guildJoined', 'delvesStarted',
            'petitionsRuled', 'companionsHired', 'shipsBought', 'crewHired', 'voyages', 'daysAtSea', 'propertiesBuilt',
            'companyFounded', 'postsOpened', 'ordersSet', 'worksFunded',
            // The long game also rides with (and now and then robs) the merchant caravans
            // ...and bids for the crowns' mining leases (systems/concessions.js)
            ...(LONG ? ['escortsHired', 'escortsPaid', 'caravansRobbed', 'craftGuildJoined', 'guildRankUp', 'leaseBids',
                // ...and insures, is paid on its claims and buys shares on the Bourse
                'coversOpened', 'claimsPaid', 'sharesBoughtBourse',
                // ...and carries grain to where the crop reports say the harvest is failing
                'harvestTrades',
                // ...and buys an estate and puts work out to the cottagers (systems/landMarket.js, systems/puttingOut.js)
                'estatesBought', 'workPutOut',
                // ...and funds a public work and sells bullion to a mint (systems/publicWorks.js, systems/mints.js)
                'publicWorksFunded', 'bullionSold',
                // ...and travels abroad, takes lessons in the tongue, bathes and hires the town's tradesmen
                'foreignTownDays', 'langLessons', 'commissioned'] : [])]) {
            expect(totals[key] || 0, `the bot never did "${key}" — ${JSON.stringify(totals)}`).toBeGreaterThan(0);
        }
    });
});
