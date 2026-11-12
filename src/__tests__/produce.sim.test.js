// Opt-in produce survey: do the vegetables and fruit (data/markets.json produce)
// keep sane prices over the years, follow the seasons, keep the greengrocers
// stocked and leave the towns fed? Runs the harness world and prints, by
// season, each produce good's mean price against its base, the share of
// towns holding it, the towns in dearth, and a few towns' greengrocer wares.
//
//   PRODUCESIM=1 npx vitest run src/__tests__/produce.sim.test.js
//   PSEEDS=101,202 PDAYS=240
//
// Not part of the normal suite (it plays a world for years).

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketStalls } from '../world/marketStalls.js';
import { Seasons } from '../world/seasons.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = ENV.PRODUCESIM === '1';

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

it.skipIf(!ON)('produce survey', () => {
    const seeds = String(ENV.PSEEDS || '101').split(',').map(Number);
    const days = Number(ENV.PDAYS || 240);
    for (const seed of seeds) {
        // PBASE=1: the markets as they were before produce (its goods, presses and section dropped), to compare
        if (ENV.PBASE === '1') {
            const M = DataLoader._gamedata.markets;
            const P = new Set(Object.keys((M.produce && M.produce.goods) || {}));
            DataLoader._gamedata.markets = {
                ...M, produce: {},
                goods: Object.fromEntries(Object.entries(M.goods).filter(([id]) => !P.has(id))),
                recipes: M.recipes.filter(r => !['cider_press', 'perry_press', 'winepress', 'meadery'].includes(r.id)),
            };
        }
        const game = newGame(seed);
        const { world } = game;
        const C = SettlementMarket.config();
        // (and the dairy's, the apothecary's and the fishmonger's goods: milk, cheese, butter, salves, tonics, crabs)
        const extra = ['cheese', 'butter', 'crab', 'healing_salve', 'poultice', 'tonic', 'meat']
            .filter(id => SettlementMarket.tracks(id) && PlayerEconomy.GOODS[id.toUpperCase()] && !C.produceIds.includes(id));
        const ids = [...C.produceIds, 'grain', 'bread', 'cider', 'wine', 'mead', ...extra];
        const bySeason = {};
        const startDay = world.day;
        for (let d = 0; d < days; d++) {
            // (the player kept fed and idle, as the economy survey does)
            game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0;
            const res = endDay(game);
            if (res && res.died) { out(`  died ${res.died} day ${world.day}`); break; }
            if ((world.day - startDay) % 5 !== 0) continue;
            const season = `${Seasons.seasonOf(world.day)}${Math.floor((world.day - 1) / 120) + 1}`;
            const S = bySeason[season] || (bySeason[season] = { n: 0, price: {}, held: {}, dearth: 0, towns: 0, cover: 0, grocer: 0, fill: {} });
            S.n++;
            const towns = world.getSettlementViews();
            // (the stock against its target in the eight biggest towns: does it pile up?)
            const big = towns.filter(s => s.market).sort((a, b) => (b.population || 0) - (a.population || 0)).slice(0, 8);
            for (const s of big) {
                for (const id of ids) {
                    if (!SettlementMarket.uses(s, id)) continue;
                    (S.fill[id] || (S.fill[id] = [])).push(SettlementMarket.stock(s, id) / Math.max(1e-6, SettlementMarket.target(s, id)));
                }
            }
            for (const s of towns) {
                if (!s.market) continue;
                S.towns++;
                if (SettlementMarket.inDearth(s)) S.dearth++;
                S.cover += SettlementMarket.foodCover(s);
                const tile = world.getTile(s.q, s.r);
                if (MarketStalls.wares(s, 'greengrocer', tile).filter(id => SettlementMarket.tracks(id)).length >= 2) S.grocer++;
                for (const id of ids) {
                    const base = PlayerEconomy.GOODS[id.toUpperCase()].basePrice;
                    const v = SettlementMarket.value(world, s, tile, id, base) / base;
                    (S.price[id] || (S.price[id] = [])).push(v);
                    if (SettlementMarket.available(s, id) >= 1) S.held[id] = (S.held[id] || 0) + 1;
                }
            }
        }
        const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
        out(`\n== seed ${seed}: ${days} days, ${world.getSettlementViews().length} towns ==`);
        const seasons = Object.keys(bySeason);
        out('good'.padEnd(10), ...seasons.map(x => x.padStart(18)));
        for (const id of ids) {
            out(id.padEnd(10), ...seasons.map(x => {
                const S = bySeason[x];
                const p = med(S.price[id] || []);
                const held = Math.round(100 * (S.held[id] || 0) / Math.max(1, S.towns));
                return `x${p.toFixed(2)} ${String(held).padStart(3)}%held`.padStart(18);
            }));
        }
        out('stock / target, 8 biggest towns (median, max):');
        for (const id of ids) {
            out(id.padEnd(10), ...seasons.map(x => {
                const f = (bySeason[x].fill[id] || []);
                return (f.length ? `${med(f).toFixed(2)} ${Math.max(...f).toFixed(2)}` : '-').padStart(18);
            }));
        }
        out('dearth%'.padEnd(10), ...seasons.map(x => `${(100 * bySeason[x].dearth / Math.max(1, bySeason[x].towns)).toFixed(1)}%`.padStart(18)));
        out('cover'.padEnd(10), ...seasons.map(x => `${(bySeason[x].cover / Math.max(1, bySeason[x].towns)).toFixed(3)}`.padStart(18)));
        out('grocer>=2'.padEnd(10), ...seasons.map(x => `${(100 * bySeason[x].grocer / Math.max(1, bySeason[x].towns)).toFixed(0)}%`.padStart(18)));
        // A few towns' greengrocer stalls today
        const towns = world.getSettlementViews().filter(s => s.market).sort((a, b) => (b.population || 0) - (a.population || 0));
        const pick = [towns[0], towns[Math.floor(towns.length / 2)], towns[towns.length - 1]];
        for (const s of pick) {
            const tile = world.getTile(s.q, s.r);
            const land = SettlementMarket.landProfile(world, s.q, s.r);
            const wares = MarketStalls.wares(s, 'greengrocer', tile).filter(id => SettlementMarket.tracks(id));
            out(`  ${s.name} (${s.type}, ${s.population}, ${s.culture || '?'}, temp ${land.temp.toFixed(2)}) day ${world.day} [${MarketStalls.artFor('greengrocer', wares)}]:`,
                wares.map(id => `${id} ${Math.floor(SettlementMarket.stock(s, id))}@${(SettlementMarket.value(world, s, tile, id, PlayerEconomy.GOODS[id.toUpperCase()].basePrice)).toFixed(1)}g`).join(', '));
        }
    }
}, 3600000);
