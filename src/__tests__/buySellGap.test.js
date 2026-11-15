/**
 * No buy-and-sell-back loop (player/playerEconomy/trading.js): at the same
 * place on the same day, no good sells for more than it costs to buy — the
 * market's own sale (Trading.saleUnitPrice), a trading post's factor
 * (MerchantHouses.factorSaleUnit) and a trade line's haggling factor — under
 * any mix of the modifiers that move either side: the market's stock (glut to
 * dearth, on the stalls or not), trade agreements, techs and other trade
 * bonuses (and penalties), a town's sale bonus, a fair, the guild's floor,
 * toll, master's mark and guild rates, the difficulty, and a tariff.
 *
 * (Regression: a century soak on seed 202 found liquor at Dewglen bought for
 * 44 and sold back for 48.09 in the same market — the cap under the buy-back
 * price read the good's open-market ask, which is null while the good is off
 * the stalls, and an uncapped sale then ran past the ask the market charged.)
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Guilds } from '../systems/guilds.js';
import { Technology } from '../systems/technology.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
beforeAll(async () => {
    await loadData();
    game = newGame(202);
});
afterEach(() => vi.restoreAllMocks());

/** Every market town of the world with its tile (a sample: every `step`th). */
function towns(world, step = 1) {
    const out = [];
    for (const row of world.tiles) for (const t of row) if (t.settlement) out.push(t);
    return out.filter((_, i) => i % step === 0);
}

/** The modifier mixes swept: each sets the spies and the town's state. */
const MIXES = [];
for (const trade of [-0.3, 0, 0.4, 1.5]) {
    for (const profit of [0, 0.5]) {
        for (const guild of ['none', 'outsider', 'master', 'member']) {
            for (const fair of [false, true]) MIXES.push({ trade, profit, guild, fair, saleBonus: trade > 0 ? 0.3 : 0 });
        }
    }
}

function applyMix(mix, s) {
    vi.spyOn(PlayerEffects, 'tradeBonus').mockReturnValue(mix.trade);
    vi.spyOn(Technology, 'getTradeProfitBonus').mockReturnValue(mix.profit);
    vi.spyOn(Technology, 'getEffectTotal').mockImplementation((p, key) => (key === 'tradePriceDiscount' ? mix.profit / 2 : 0));
    vi.spyOn(Economy, 'saleBonus').mockReturnValue(mix.saleBonus);
    if (mix.guild === 'none') {
        vi.spyOn(Guilds, 'askFloor').mockReturnValue(0);
        vi.spyOn(Guilds, 'saleFactor').mockReturnValue(1);
        vi.spyOn(Guilds, 'inputDiscount').mockReturnValue(0);
    } else {
        // (the guild's floor under the ask; an outsider pays its toll, a master's goods carry its mark)
        vi.spyOn(Guilds, 'askFloor').mockReturnValue(1.3);
        vi.spyOn(Guilds, 'saleFactor').mockReturnValue(mix.guild === 'outsider' ? 0.85 : mix.guild === 'master' ? 1.25 : 1);
        vi.spyOn(Guilds, 'inputDiscount').mockReturnValue(mix.guild === 'member' ? 0.15 : 0);
    }
    const old = s.market.fair;
    if (mix.fair) s.market.fair = { ask: 0.6, sell: 0.95 };
    return () => { s.market.fair = old; };
}

describe('the same place, the same day: never sell above the buy price', () => {
    it('a market sale or a factor sale never beats buying the good back, across goods, stock and modifiers', () => {
        const { world, player } = game;
        const bad = [];
        let checked = 0;
        for (const tile of towns(world, 11)) {
            const s = tile.settlement;
            SettlementMarket.ensure(s);
            const ids = Object.keys(s.market.stock).filter(id => SettlementMarket.tracks(id) && PlayerEconomy.GOODS[id.toUpperCase()]).slice(0, 8);
            for (const id of ids) {
                const good = PlayerEconomy.GOODS[id.toUpperCase()];
                const stock0 = s.market.stock[id];
                const target = SettlementMarket.target(s, id) || 10;
                for (const level of [0.02, 0.4, 3, 40]) {
                    s.market.stock[id] = Math.max(1, Math.round(target * level));
                    for (const mix of MIXES) {
                        const undo = applyMix(mix, s);
                        try {
                            const entry = Trading._marketEntry(good, s, tile, world, null, 0);
                            // The cheapest the player (or a factor) could buy it here: one unit, and five
                            const buy1 = Math.min(Trading.buyCost(player, entry, 1, s), MerchantHouses.factorBuyUnit(player, world, tile, id) ?? Infinity);
                            const buy5 = Trading.buyCost(player, entry, 5, s);
                            for (const tariff of [1, 0.9]) {
                                const sell1 = Trading.saleUnitPrice(player, good, s, world, tariff, 1);
                                const sell5 = Trading.saleUnitPrice(player, good, s, world, tariff, 5) * 5;
                                const post = MerchantHouses.factorSaleUnit(player, world, tile, id, 1);
                                checked++;
                                if (sell1 > buy1 || post > buy1 || sell5 > buy5) {
                                    bad.push(`${s.name} ${id} stock ${s.market.stock[id]} ${JSON.stringify(mix)} tariff ${tariff}: buy ${buy1}/${buy5} sell ${sell1.toFixed(2)}/${sell5.toFixed(2)} post ${post.toFixed(2)}`);
                                }
                            }
                        } finally {
                            undo();
                            vi.restoreAllMocks();
                        }
                    }
                }
                s.market.stock[id] = stock0;
            }
        }
        expect(checked).toBeGreaterThan(1500);
        expect(bad.slice(0, 10)).toEqual([]);
    }, 300000);

    it('a good off the stalls (too little in store to list) is still capped under its buy-back price', () => {
        const { world, player } = game;
        // A good the town keeps but doesn't list at this stock (beer in a village: not a staple there)
        let hit = 0;
        for (const tile of towns(world)) {
            const s = tile.settlement;
            SettlementMarket.ensure(s);
            for (const id of Object.keys(s.market.stock)) {
                const key = id.toUpperCase();
                const good = PlayerEconomy.GOODS[key];
                if (!good || !SettlementMarket.tracks(id)) continue;
                const old = s.market.stock[id];
                s.market.stock[id] = 1;
                if (Economy.marketAsk(world, tile, id) == null) {
                    vi.spyOn(PlayerEffects, 'tradeBonus').mockReturnValue(1.5);
                    const sell = Trading.saleUnitPrice(player, good, s, world, 1, 1);
                    // ...it fetches less than the market would charge for it once the sale stocks it
                    s.market.stock[id] = 2;
                    const entry = Trading._marketEntry(good, s, tile, world, null, 0);
                    const buyBack = Trading.buyCost(player, entry, 1, s);
                    vi.restoreAllMocks();
                    expect(sell, `${s.name} ${id}`).toBeLessThan(buyBack);
                    hit++;
                }
                s.market.stock[id] = old;
                if (hit >= 40) return;
            }
        }
        expect(hit).toBeGreaterThan(0);
    }, 120000);

    it("a trade line's haggling factor sells no dearer than it buys at the same stop", async () => {
        const { TradeLines } = await import('../player/tradeLines.js');
        const { world, player } = game;
        const tile = towns(world).find(t => t.settlement.type !== 'village');
        const s = tile.settlement;
        SettlementMarket.ensure(s);
        const id = 'grain';
        const good = PlayerEconomy.GOODS.GRAIN;
        vi.spyOn(PlayerEffects, 'tradeBonus').mockReturnValue(1.5);
        const haggle = 0.08;
        const entry = Trading._marketEntry(good, s, tile, world, null, 0);
        const factorBuy = Math.ceil(Trading.buyCost(player, entry, 1, s) * (1 - haggle));
        const factorSell = TradeLines.saleTotal(player, good, s, world, 1, 1, haggle);
        expect(factorSell).toBeLessThan(factorBuy);
        expect(SettlementMarket.tracks(id)).toBe(true);
    });
});
