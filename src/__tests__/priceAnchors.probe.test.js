// Opt-in probe: town prices of a few goods, and a recruit's kit, after a
// stretch of days (seed 101 by default). Before/after numbers for the price
// anchors and the craftsmen's floor (world/priceAnchors.js).
//
//   PRICEPROBE=1 npx vitest run src/__tests__/priceAnchors.probe.test.js
//   PSEED=101 PDAYS=240

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Arms } from '../systems/arms.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

it.skipIf(!ENV.PRICEPROBE)('prints town prices and a kit', () => {
    const game = newGame(Number(ENV.PSEED || 101));
    const days = Number(ENV.PDAYS || 240);
    const goods = ['boots', 'leather', 'hide', 'gambeson', 'textiles', 'wool', 'clothes', 'tools', 'weapons', 'bread', 'grain', 'chainmail', 'steel', 'iron'];
    const report = (label) => {
        const { world } = game;
        const lines = [label];
        for (const g of goods) {
            const def = PlayerEconomy.GOODS[g.toUpperCase()];
            const ps = [], sc = [];
            for (const v of world.getSettlementViews()) {
                const t = world.getTile(v.q, v.r);
                const s = t && t.settlement;
                if (!s || !s.market) continue;
                ps.push(Economy.marketPrice(def, s, t, world));
                sc.push(SettlementMarket.scarcity(s, g));
            }
            const a = world.priceAnchors && world.priceAnchors.f ? world.priceAnchors.f[g] : undefined;
            lines.push(`  ${g.padEnd(10)} base ${def.basePrice} median ${med(ps)} (p10 ${med(ps.slice().sort((x, y) => x - y).slice(0, Math.ceil(ps.length / 5)))}) scarcity ${med(sc).toFixed(2)} anchor ${a == null ? '-' : a.toFixed(3)}`);
        }
        for (const type of ['militia', 'soldier']) {
            const costs = [], feet = [];
            for (const v of world.getSettlementViews()) {
                const t = world.getTile(v.q, v.r);
                const s = t && t.settlement;
                if (!s || !s.market || s.type === 'village') continue;
                const q = Arms.kitQuote({ gold: 1e9, inventory: {} }, type, s, world, { noPack: true });
                if (!q || !(q.cost > 0)) continue;
                costs.push(q.cost);
                if (q.slots.feet && q.slots.feet.price) feet.push(q.slots.feet.price);
            }
            lines.push(`  ${type} kit (towns+): median ${med(costs)} (boots ${med(feet)}) over ${costs.length}`);
        }
        process.stdout.write(lines.join('\n') + '\n');
    };
    // (PBASE=1: the anchors and the craftsmen's floor off, for the before numbers)
    if (ENV.PBASE) { SettlementMarket.config().anchors.enabled = false; SettlementMarket.config().craftFloor.enabled = false; }
    for (let d = 0; d < days; d++) {
        // (the player kept fed and idle, as economy.survey.test.js)
        game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0;
        endDay(game);
        if (d + 1 === 1 || (d + 1) % 120 === 0 || d + 1 === days) report(`day ${game.world.day}`);
    }
}, 3600000);
