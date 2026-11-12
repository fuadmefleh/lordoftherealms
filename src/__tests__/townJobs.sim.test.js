// Opt-in survey: does putting the townsfolk to work (systems/townJobs.js —
// the market's output following the named hands at each trade, wages and
// board in coin) keep the towns' production and prices in the range they were
// in? Plays the harness world a year twice from the same seed — townJobs off,
// then on — with rosters seeded in a few towns, and prints each good's mean
// stock and price in those towns, and the food cover and dearths.
//
//   JOBSIM=1 npx vitest run src/__tests__/townJobs.sim.test.js
//   JSEEDS=101,202 JDAYS=120 JTOWNS=6
//
// Not part of the normal suite (it plays a world for a year, twice).

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = ENV.JOBSIM === '1';

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const GOODS = ['grain', 'flour', 'bread', 'fish', 'meat', 'beer', 'wood', 'firewood', 'planks', 'tools', 'textiles', 'clothes', 'wool', 'boots', 'stone', 'iron'];

function play(seed, days, nTowns, on) {
    DataLoader._gamedata.townJobs = { ...DataLoader._gamedata.townJobs, enabled: on };
    const game = newGame(seed);
    const { world } = game;
    const towns = world.getSettlementViews().map(v => world.getTile(v.q, v.r).settlement).filter(Boolean).slice(0, nTowns);
    for (const s of towns) Townsfolk.seed(s, world, { q: s.q, r: s.r });
    const acc = { stock: {}, price: {}, cover: 0, dearth: 0, n: 0, coin0: 0, coin1: 0, jobs: {} };
    const coin = () => towns.reduce((t, s) => t + (s.economy ? s.economy.gold : 0) + s.folk.people.filter(p => Townsfolk.isHere(p) && typeof p.purse === 'number').reduce((a, p) => a + p.purse, 0), 0);
    acc.coin0 = coin();
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
                acc.stock[id] = (acc.stock[id] || 0) + SettlementMarket.stock(s, id) / Math.max(1, SettlementMarket.target(s, id));
                acc.price[id] = (acc.price[id] || 0) + SettlementMarket.value(world, s, tile, id, base) / base;
            }
        }
    }
    acc.coin1 = coin();
    if (on) for (const s of towns) { const c = TownJobs.crew(s, world, world.day); for (const [k, v] of Object.entries((c && c.occ) || {})) (acc.jobs[k] = acc.jobs[k] || []).push(v.factor); }
    const k = acc.n * towns.length;
    for (const id of GOODS) { acc.stock[id] /= k; acc.price[id] /= k; }
    acc.cover /= k;
    acc.towns = towns.map(s => `${s.name} (${s.type})`);
    return acc;
}

it.skipIf(!ON)('jobs survey', () => {
    const seeds = String(ENV.JSEEDS || '101').split(',').map(Number);
    const days = Number(ENV.JDAYS || 120);
    const nTowns = Number(ENV.JTOWNS || 6);
    for (const seed of seeds) {
        const off = play(seed, days, nTowns, false);
        const on = play(seed, days, nTowns, true);
        out(`\n== seed ${seed}: ${days} days, towns: ${on.towns.join(', ')} ==`);
        out('good'.padEnd(10), 'stock/target off'.padStart(17), 'on'.padStart(7), 'price/base off'.padStart(15), 'on'.padStart(7));
        for (const id of GOODS) out(id.padEnd(10), off.stock[id].toFixed(2).padStart(17), on.stock[id].toFixed(2).padStart(7), off.price[id].toFixed(2).padStart(15), on.price[id].toFixed(2).padStart(7));
        out(`food cover off ${off.cover.toFixed(3)} on ${on.cover.toFixed(3)} · dearth samples off ${off.dearth} on ${on.dearth}`);
        out(`coin (towns + folk) off ${Math.round(off.coin0)}→${Math.round(off.coin1)} · on ${Math.round(on.coin0)}→${Math.round(on.coin1)}`);
        out('crew factors at year end: ' + Object.entries(on.jobs).map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`).join(', '));
    }
}, 1200000);
