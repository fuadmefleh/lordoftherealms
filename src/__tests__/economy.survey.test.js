// Opt-in world economy survey: is the economy's money and goods sane over years?
// Runs the harness world (the player kept fed and idle, or the bot with
// ECON_BOT=1) and prints, every SAMPLE days, the world's purses (towns,
// crowns, coin in circulation, the player), the goods in the towns' markets,
// the price level (the markets' scarcity) and the food situation, so a pass
// on the economy can compare before and after.
//
//   ECONSIM=1 npx vitest run src/__tests__/economy.survey.test.js
//   ESEEDS=101,202,303 EDAYS=720 SAMPLE=120 ECON_BOT=1
//
// Not part of the normal suite: three seeds × six years take minutes.

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { SettlementMarket } from '../world/settlementMarket.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const k = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`);

/** One line of the world's economy. */
export function survey(game) {
    const { world, player } = game;
    const towns = world.getSettlementViews();
    const C = SettlementMarket.config();
    const gold = [], pops = [], scar = [], foodScar = [];
    let pop = 0, broke = 0, dearth = 0, foodless = 0, granary = 0, stockVal = 0, legacyGoods = 0;
    const byGood = {};
    for (const s of towns) {
        const e = s.economy || {};
        gold.push(e.gold || 0);
        if (!((e.gold || 0) >= 20)) broke++;
        pops.push(s.population || 0);
        pop += s.population || 0;
        granary += e.food || 0;
        legacyGoods += e.goods || 0;
        if (!s.market) continue;
        if (SettlementMarket.inDearth(s)) dearth++;
        let food = 0, n = 0, sum = 0, fsum = 0, fn = 0;
        for (const id of C.goodIds) {
            const st = SettlementMarket.stock(s, id);
            if (C.isFood[id]) food += st;
            if (!SettlementMarket.uses(s, id)) continue;
            const sc = SettlementMarket.scarcity(s, id);
            (byGood[id] || (byGood[id] = [])).push(sc);
            sum += sc; n++;
            if (C.isFood[id]) { fsum += sc; fn++; }
            stockVal += st;
        }
        if (food < 1) foodless++;
        if (n) scar.push(sum / n);
        if (fn) foodScar.push(fsum / fn);
    }
    const ks = (world.kingdoms || []).filter(kd => kd && kd.isAlive !== false);
    const treas = ks.map(kd => kd.treasury || 0);
    let coin = 0;
    const realms = (world.money && world.money.realms) || {};
    for (const R of Object.values(realms)) coin += (R && R.coin) || 0;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return {
        day: world.day,
        towns: towns.length,
        broke,
        pop,
        townGold: sum(gold), townGoldMed: pct(gold, 0.5), townGoldP95: pct(gold, 0.95), townGoldMax: Math.max(0, ...gold),
        goldPerHead: sum(gold) / Math.max(1, pop),
        treasury: sum(treas), treasuryMed: pct(treas, 0.5), realms: ks.length,
        coin,
        player: player ? player.gold : 0,
        scarMed: pct(scar, 0.5), scarP5: pct(scar, 0.05), scarP95: pct(scar, 0.95),
        foodScarMed: pct(foodScar, 0.5), foodScarP95: pct(foodScar, 0.95),
        dearth, foodless, granary, stockUnits: stockVal, legacyGoods,
        dearest: Object.entries(byGood).map(([id, a]) => [id, pct(a, 0.5)]).sort((x, y) => y[1] - x[1]).slice(0, 8),
        cheapest: Object.entries(byGood).map(([id, a]) => [id, pct(a, 0.5)]).sort((x, y) => x[1] - y[1]).slice(0, 5),
    };
}

export function line(r) {
    return `d${r.day} towns=${r.towns} pop=${k(r.pop)} | townGold=${k(r.townGold)} (med ${k(r.townGoldMed)} p95 ${k(r.townGoldP95)} max ${k(r.townGoldMax)}, ${r.goldPerHead.toFixed(2)}/head, ${r.broke} broke)`
        + ` treas=${k(r.treasury)} (med ${k(r.treasuryMed)}, ${r.realms} realms) coin=${k(r.coin)} player=${k(r.player)}`
        + ` | scarcity med ${r.scarMed.toFixed(2)} [${r.scarP5.toFixed(2)}-${r.scarP95.toFixed(2)}] food ${r.foodScarMed.toFixed(2)}/p95 ${r.foodScarP95.toFixed(2)}`
        + ` dearth=${r.dearth} foodless=${r.foodless} stock=${k(r.stockUnits)} granary=${k(r.granary)} legacyGoods=${k(r.legacyGoods)}`;
}

it.skipIf(!ENV.ECONSIM)('world economy survey', () => {
    const SEEDS = (ENV.ESEEDS || '101,202,303').split(',').map(Number);
    const DAYS = Number(ENV.EDAYS || 720);
    const SAMPLE = Number(ENV.SAMPLE || 120);
    const rows = [];
    for (const seed of SEEDS) {
        const game = newGame(seed);
        const stats = {};
        rows.push(`seed ${seed}`);
        rows.push(`  ${line(survey(game))}`);
        for (let i = 1; i <= DAYS; i++) {
            if (ENV.ECON_BOT) botDay(game, stats);
            else { game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0; }
            const res = endDay(game);
            if (res && res.died) { rows.push(`  died ${res.died} day ${game.world.day}`); break; }
            if (i % SAMPLE === 0) {
                const r = survey(game);
                rows.push(`  ${line(r)}`);
                if (ENV.EGOODS) rows.push(`    dearest ${r.dearest.map(([id, v]) => `${id} ${v.toFixed(2)}`).join(', ')} | cheapest ${r.cheapest.map(([id, v]) => `${id} ${v.toFixed(2)}`).join(', ')}`);
            }
        }
    }
    process.stdout.write(`\n${rows.join('\n')}\n`);
}, 3_600_000);
