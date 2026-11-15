// Coin conservation checks for single actions (2026-11): snapshot the world's
// coin census (CoinCensus.total, the player's purse included) and the books
// (MoneySupply.bookedChange) around one call, and report what moved unbooked.
// A closed action has unbooked ≈ 0: every coin it paid out came from a real
// purse, every coin it took went into one, or it was booked with
// MoneySupply.leak (coin truly lost or found).

import { CoinCensus } from '../../systems/coinCensus.js';
import { MoneySupply } from '../../world/moneySupply.js';
import { newGame, endDay } from './harness.js';

/** A small live game, one day in (the towns' purses are set up on the first day). */
export function coinGame(seed = 101, days = 1) {
    const g = newGame(seed, { kingdomCount: 4 });
    for (let i = 0; i < days; i++) endDay(g);
    return g;
}

/** Run `fn` and measure the census against the books → { result, delta, booked, unbooked }. */
export function measure(world, player, fn) {
    const c0 = CoinCensus.total(world, player).total;
    const b0 = MoneySupply.bookedChange(world);
    const result = fn();
    const c1 = CoinCensus.total(world, player).total;
    const b1 = MoneySupply.bookedChange(world);
    const delta = Math.round((c1 - c0) * 100) / 100;
    const booked = Math.round((b1 - b0) * 100) / 100;
    return { result, delta, booked, unbooked: Math.round((delta - booked) * 100) / 100 };
}

/** The living towns that keep a coin purse, richest first: [{ q, r, settlement }]. */
export function coinTowns(world) {
    const out = [];
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        const s = t && t.settlement;
        if (s && !s.inKind && s.economy && Number.isFinite(s.economy.gold) && s.kingdom != null) out.push({ q: v.q, r: v.r, settlement: s });
    }
    return out.sort((a, b) => b.settlement.economy.gold - a.settlement.economy.gold);
}

/** Put the player in a town (q, r) — the payer/payee most player actions look for. */
export function standIn(player, town) {
    player.q = town.q;
    player.r = town.r;
    return town.settlement;
}

/** (alias of measure, kept for the specs written against it) */
export const coinAround = measure;
