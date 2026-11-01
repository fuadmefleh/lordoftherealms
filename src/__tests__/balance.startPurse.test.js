// Opt-in balance probe: can a Wanderer build up from a light purse?
// The scripted bot (playtest/bot.js) plays generated worlds from several
// starting purses and reports gold at days 30/60/120/240/365, days broke,
// days starving and any death. It works odd jobs while poor (below the bot's
// POOR_BELOW), so a run shows whether wages beat the cost of living.
//
//   BALANCE=1 npx vitest run src/__tests__/balance.startPurse.test.js
//   PURSES=250,100 PSEEDS=101,202 PDAYS=365 TRACE=1 (a line a day)
//
// Not part of the normal suite: a year of three seeds × four purses takes minutes.

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Scenarios } from '../player/scenarios.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const MARKS = [30, 60, 120, 240, 365];

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

it.skipIf(!ENV.BALANCE)('start purse probe', () => {
    const wanderer = (Scenarios.origin('wanderer') || {}).gold;
    const SEEDS = (ENV.PSEEDS || '101,202,303').split(',').map(Number);
    const PURSES = (ENV.PURSES || `10000,500,${wanderer},100`).split(',').map(Number);
    const DAYS = Number(ENV.PDAYS || 365);
    const rows = [];
    for (const purse of PURSES) {
        for (const seed of SEEDS) {
            const game = newGame(seed);
            game.player.gold = purse;
            const stats = {};
            const marks = {};
            let died = null;
            let starveDays = 0;
            let broke = 0;
            let minGold = purse;
            for (let i = 0; i < DAYS; i++) {
                botDay(game, stats);
                const res = endDay(game);
                const p = game.player;
                if (ENV.TRACE) {
                    const t = game.world.getTile(p.q, p.r);
                    rows.push(`  d${game.world.day} g=${Math.round(p.gold)} hp=${Math.round(p.health)} food=${p.getFoodCount()} at=${t && t.settlement ? `${t.settlement.name}/${t.settlement.type}` : `${p.q},${p.r}`}`);
                }
                if ((p.starvationDays || 0) > 0) starveDays++;
                if (p.gold < 20) broke++;
                minGold = Math.min(minGold, p.gold);
                if (MARKS.includes(i + 1)) marks[i + 1] = Math.round(p.gold);
                if (res.died) { died = `${res.died}@${game.world.day}`; break; }
            }
            const top = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
            rows.push(`purse=${purse} seed=${seed} gold@${MARKS.join('/')}=${MARKS.map(d => marks[d] ?? '-').join('/')} min=${Math.round(minGold)} brokeDays=${broke} starveDays=${starveDays} died=${died} | ${top}`);
        }
    }
    process.stdout.write(`\n${rows.join('\n')}\n`);
}, 3600000);
