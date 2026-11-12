// Opt-in survey: do the townsfolk's own trade (systems/townTrade.js — shopping
// into larders, producers to market, barter, pedlars) keep the towns' markets,
// prices and food in the range they were in, the households fed, and the
// purses neither drained nor ballooning? Plays the harness world a year twice
// from the same seed — townTrade off, then on — with rosters seeded in a few
// towns, and prints a table.
//
//   TTSIM=1 npx vitest run src/__tests__/townTrade.sim.test.js
//   TTSEEDS=101,202 TTDAYS=120 TTTOWNS=6
//
// Not part of the normal suite (it plays a world for a year, twice).

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownTrade } from '../systems/townTrade.js';
import { Utils } from '../core/utils.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = ENV.TTSIM === '1';
let BASE = null;

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    BASE = DataLoader._gamedata.townTrade;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const GOODS = ['grain', 'bread', 'fish', 'meat', 'eggs', 'cabbage', 'beer', 'firewood', 'candles', 'salt', 'clothes', 'tools'];
const q = (arr, f) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

function play(seed, days, nTowns, on) {
    DataLoader._gamedata.townTrade = { ...BASE, enabled: on };
    const game = newGame(seed);
    const { world } = game;
    const towns = world.getSettlementViews().map(v => world.getTile(v.q, v.r).settlement).filter(Boolean).slice(0, nTowns);
    for (const s of towns) Townsfolk.seed(s, world, { q: s.q, r: s.r });
    const acc = { stock: {}, price: {}, cover: 0, dearth: 0, n: 0, fed: [], hungry: 0, adultsN: 0 };
    const purses = () => towns.flatMap(s => s.folk.people.filter(p => Townsfolk.isHere(p) && Townsfolk.age(p, world.day) >= 16).map(p => Townsfolk.purse(s.folk, p, world)));
    const coin = () => towns.reduce((t, s) => t + (s.economy ? s.economy.gold : 0), 0);
    acc.p0 = purses();
    acc.townCoin0 = coin();
    for (let d = 0; d < days; d++) {
        game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0;
        endDay(game);
        if (d % 5 !== 4) continue;
        acc.n++;
        for (const s of towns) {
            const tile = world.getTile(s.q, s.r);
            acc.cover += SettlementMarket.foodCover(s);
            if (SettlementMarket.inDearth(s)) acc.dearth++;
            for (const id of GOODS) {
                const base = PlayerEconomy.GOODS[id.toUpperCase()].basePrice;
                const tgt = SettlementMarket.target(s, id);
                acc.stock[id] = (acc.stock[id] || 0) + (tgt > 0 ? SettlementMarket.stock(s, id) / tgt : 0);
                acc.price[id] = (acc.price[id] || 0) + SettlementMarket.value(world, s, tile, id, base) / base;
            }
            const st = s.townTrade;
            if (st) for (const h of Object.values(st.hh)) if (h && h.cover != null) acc.fed.push(h.cover);
            for (const p of s.folk.people) {
                if (!Townsfolk.isHere(p) || Townsfolk.age(p, world.day) < 16) continue;
                acc.adultsN++;
                if (p.hungry != null && world.day - p.hungry < 5) acc.hungry++;
            }
        }
    }
    const k = acc.n * towns.length;
    for (const id of GOODS) { acc.stock[id] /= k; acc.price[id] /= k; }
    acc.cover /= k;
    acc.p1 = purses();
    acc.townCoin1 = coin();
    const all = world.getSettlementViews().map(v => world.getTile(v.q, v.r).settlement).filter(Boolean);
    acc.worldCoin = Math.round(all.reduce((t, s) => t + (s.economy ? s.economy.gold : 0) + (s.folk ? s.folk.people.reduce((x, p) => x + (typeof p.purse === 'number' ? p.purse : 0), 0) : 0), 0));
    acc.worldStock = {};
    const ks = (world.kingdoms || []).filter(k => k && !k.destroyed && k.isAlive !== false);
    acc.realms = `${ks.length} realms, treasuries ${Math.round(ks.reduce((t, k) => t + (Number(k.treasury) || 0), 0))}, units ${(world.units || []).length}, towns ${all.length}, day ${world.day}, rng probe ${Math.round(Utils.random() * 1e6)}`;
    for (const id of ['eggs', 'cabbage', 'bread', 'grain']) acc.worldStock[id] = Math.round(all.reduce((t, s) => t + SettlementMarket.stock(s, id), 0));
    acc.towns = towns.map(s => `${s.name} (${s.type}${s.inKind ? ', barter' : ''})`);
    const books = towns.map(s => (s.townTrade && s.townTrade.book) || {});
    const sum = (key) => books.reduce((t, b) => t + (Number(b[key]) || 0), 0);
    acc.book = { bought: sum('bought'), eaten: sum('eaten'), bartered: sum('bartered'), pedlarSales: sum('pedlarSales'), delivered: sum('delivered'), withheld: sum('withheld'), cheats: sum('cheats'), caught: sum('caught'), grudges: sum('grudges'), street: sum('street'), settled: sum('pedlarsSettled'), common: sum('common') };
    acc.pedlars = towns.reduce((t, s) => t + TownTrade.pedlars(s).length, 0);
    return acc;
}

it.skipIf(!ON)('town trade survey', () => {
    const seeds = String(ENV.TTSEEDS || '101').split(',').map(Number);
    const days = Number(ENV.TTDAYS || 120);
    const nTowns = Number(ENV.TTTOWNS || 6);
    for (const seed of seeds) {
        const off = play(seed, days, nTowns, false);
        const on = play(seed, days, nTowns, true);
        out(`\n== seed ${seed}: ${days} days, towns: ${on.towns.join(', ')} ==`);
        out('| good | stock/target off | on | price/base off | on |');
        out('|---|---|---|---|---|');
        for (const id of GOODS) out(`| ${id} | ${off.stock[id].toFixed(2)} | ${on.stock[id].toFixed(2)} | ${off.price[id].toFixed(2)} | ${on.price[id].toFixed(2)} |`);
        out(`food cover off ${off.cover.toFixed(3)} on ${on.cover.toFixed(3)} · dearth samples off ${off.dearth} on ${on.dearth}`);
        out(`households' food eaten / wanted (on): median ${q(on.fed, 0.5).toFixed(2)}, 10th pct ${q(on.fed, 0.1).toFixed(2)}, share under half ${(on.fed.filter(x => x < 0.5).length / Math.max(1, on.fed.length)).toFixed(3)}`);
        out(`hungry adult-samples off ${off.hungry}/${off.adultsN} on ${on.hungry}/${on.adultsN}`);
        for (const [name, r] of [['off', off], ['on', on]]) {
            out(`purses ${name}: start median ${q(r.p0, 0.5).toFixed(1)} → end median ${q(r.p1, 0.5).toFixed(1)}, 10th ${q(r.p1, 0.1).toFixed(1)}, 90th ${q(r.p1, 0.9).toFixed(1)}, max ${q(r.p1, 1).toFixed(1)}, at zero ${r.p1.filter(x => x <= 0.01).length}/${r.p1.length} · towns' purses ${Math.round(r.townCoin0)} → ${Math.round(r.townCoin1)}`);
        }
        out(`realms off: ${off.realms}`);
        out(`realms on:  ${on.realms}`);
        out(`world: all towns' and folk's coin off ${off.worldCoin} on ${on.worldCoin}; stock off ${JSON.stringify(off.worldStock)} on ${JSON.stringify(on.worldStock)}`);
        out(`books (on): ${JSON.stringify(Object.fromEntries(Object.entries(on.book).map(([k, v]) => [k, Math.round(v * 100) / 100])))} · pedlars about ${on.pedlars}`);
    }
}, 2400000);
