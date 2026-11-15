// The smallest coin is 0.01g (2026-11): a mint strikes nothing smaller, so
// every amount of coin that changes hands is a whole number of cents and every
// purse holds one. Fractions are fine (12.5g), float tails are not (0.1937g,
// 17.4000001g). The paths coin moves by — PlayerCoin, Economy.payTown /
// drawTown / crownPays, MoneySupply's books — quantize with Utils.cents before
// one purse is debited and another credited (both sides the same sum, so the
// census still closes); a payer short of the sum gives what it holds, down to
// the cent; CoinCensus.tidyCents rounds any stray purse daily and books the
// residue (MoneySupply.leak 'cents'). The player sees coin to the cent with no
// trailing zeros (Utils.formatGold).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { Barter } from '../world/barter.js';
import { Economy } from '../world/economy.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { purse, price } from '../ui/actionMenu/uiKit.js';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { botDay } from './playtest/bot.js';

let logSpy, warnSpy;
let game;

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    game = newGame(4242, { kingdomCount: 3 });
    for (let i = 0; i < 3; i++) { game.player.health = 100; game.player.starvationDays = 0; endDay(game); }
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

/** Every purse in the world (and the player's) that is not a whole number of cents. */
function offCents(world, player) {
    const bad = [];
    CoinCensus.each(world, player, (h, key, kind) => {
        if (typeof h[key] === 'number' && !Utils.isCents(h[key])) bad.push(`${kind}.${key}=${h[key]}`);
    });
    if (!Utils.isCents(player.gold)) bad.push(`player.gold=${player.gold}`);
    return bad;
}

describe('Utils: cents', () => {
    it('rounds to the cent, float-safely, halves away from zero', () => {
        expect(Utils.cents(1.005)).toBe(1.01);
        expect(Utils.cents(0.29)).toBe(0.29);
        expect(Utils.cents(0.1937)).toBe(0.19);
        expect(Utils.cents(1095.4999999)).toBe(1095.5);
        expect(Utils.cents(17.4000001)).toBe(17.4);
        expect(Utils.cents(0.1 + 0.2)).toBe(0.3);
        expect(Utils.cents(-2.345)).toBe(-2.35);
        expect(Object.is(Utils.cents(-0.001), 0)).toBe(true);
        expect(Utils.cents(NaN)).toBe(0);
        expect(Utils.cents('12.5')).toBe(12.5);
    });

    it('centsDown gives what a short payer holds, down to the cent', () => {
        expect(Utils.centsDown(0.1999)).toBe(0.19);
        expect(Utils.centsDown(0.29)).toBe(0.29);
        expect(Utils.centsDown(4.56)).toBe(4.56);
        expect(Utils.centsDown(-1.239)).toBe(-1.23);
    });

    it('isCents', () => {
        expect(Utils.isCents(12.5)).toBe(true);
        expect(Utils.isCents(0.1 + 0.2)).toBe(true);
        expect(Utils.isCents(0.1937)).toBe(false);
        expect(Utils.isCents(NaN)).toBe(false);
    });
});

describe('coin shown to the player: to the cent, no trailing zeros', () => {
    it('Utils.formatGold', () => {
        expect(Utils.formatGold(12.5)).toBe('12.5');
        expect(Utils.formatGold(0.19)).toBe('0.19');
        expect(Utils.formatGold(210)).toBe('210');
        expect(Utils.formatGold(1095.4999999)).toBe('1,095.5');
        expect(Utils.formatGold(12.50)).toBe('12.5');
        expect(Utils.formatGold(3.999)).toBe('4');
        expect(Utils.formatGold(1234567.891)).toBe('1,234,567.89');
        expect(Utils.formatGold(undefined)).toBe('0');
    });

    it('formatNumber keeps at most two decimals', () => {
        expect(Utils.formatNumber(1095.4999999)).toBe((1095.5).toLocaleString());
        expect(Utils.formatNumber(1000)).toBe((1000).toLocaleString());
    });

    it("the panels' purse chip and row prices", () => {
        expect(purse(12.5).value).toBe('12.5g');
        expect(purse(1095.4999999).value).toBe('1,095.5g');
        expect(purse(210).value).toBe('210g');
        expect(price(0.19)).toContain('0.19<small>g');
        expect(price(41)).toContain('41<small>g');
    });
});

describe('coin moves in whole cents and the census closes', () => {
    it('a town short of the sum pays what it holds, to the cent', () => {
        const { world, player } = game;
        expect(Barter.inKind(player)).toBe(false);
        const t = coinTowns(world)[0];
        standIn(player, t);
        const s = t.settlement;
        // (leave the town 0.19g: the rest goes into another town's purse, a closed move)
        const other = coinTowns(world).find(x => x.settlement !== s).settlement;
        PlayerCoin.move(world, s, other, Utils.cents(s.economy.gold - 0.19));
        expect(s.economy.gold).toBe(0.19);
        player.gold = Utils.cents(player.gold);
        const g0 = player.gold;
        const m = measure(world, player, () => PlayerCoin.receive(world, player, 5.4321, s, null, { strict: true }));
        expect(m.result).toBe(0.19);
        expect(m.unbooked).toBe(0);
        expect(s.economy.gold).toBe(0);
        expect(player.gold).toBe(Utils.cents(g0 + 0.19));
    });

    it('a fractional fee or reward moves the same whole cents out of one purse and into the other', () => {
        const { world, player } = game;
        const s = coinTowns(world)[0].settlement;
        player.gold = Utils.cents(player.gold);
        const t0 = s.economy.gold, p0 = player.gold;
        const paid = measure(world, player, () => PlayerCoin.pay(world, player, 1.23456, s));
        expect(paid.result).toBe(1.23);
        expect(paid.unbooked).toBe(0);
        expect(s.economy.gold).toBe(Utils.cents(t0 + 1.23));
        expect(player.gold).toBe(Utils.cents(p0 - 1.23));
        const got = measure(world, player, () => PlayerCoin.receive(world, player, 0.1937, s));
        expect(got.result).toBe(0.19);
        expect(got.unbooked).toBe(0);
        expect(Utils.isCents(player.gold)).toBe(true);
        expect(Utils.isCents(s.economy.gold)).toBe(true);
    });

    it('Economy.payTown / drawTown move whole cents and say so', () => {
        const { world, player } = game;
        const s = coinTowns(world)[0].settlement;
        const m = measure(world, player, () => {
            const a = Economy.drawTown(s, 2.71828);
            const b = Economy.payTown(s, a);
            return [a, b];
        });
        expect(m.result).toEqual([2.72, 2.72]);
        expect(m.unbooked).toBe(0);
        const k = world.kingdoms.find(x => x && x.isAlive !== false && x.treasury > 10);
        const c = measure(world, player, () => {
            const got = Economy.crownPays(k, world, 3.14159);
            Economy.payTown(s, got);
            return got;
        });
        expect(c.result).toBe(3.14);
        expect(c.unbooked).toBe(0);
    });

    it('tidyCents rounds a stray purse and books the residue: the census stays closed', () => {
        const { world, player } = game;
        const k = world.kingdoms.find(x => x && x.isAlive !== false && x.treasury > 10);
        const s = coinTowns(world)[0].settlement;
        k.treasury = Utils.cents(k.treasury) + 0.004321;
        s.economy.gold = Utils.cents(s.economy.gold) + 0.0071;
        const m = measure(world, player, () => CoinCensus.tidyCents(world, player));
        expect(Math.abs(m.unbooked)).toBeLessThan(0.01);
        expect(Utils.isCents(k.treasury)).toBe(true);
        expect(Utils.isCents(s.economy.gold)).toBe(true);
    });

    it('after months of play every purse in the world is a whole number of cents', () => {
        const stats = {};
        for (let d = 0; d < 90; d++) {
            game.player.health = 100; game.player.starvationDays = 0;
            botDay(game, stats);
            endDay(game);
        }
        expect(offCents(game.world, game.player)).toEqual([]);
    }, 120000);
});
