// ============================================
// PLAYER COIN — the other side of every coin the player pays or is paid
// ============================================
// Every coin comes from somewhere and goes somewhere: when the player pays a
// fee, the coin lands in a real purse (the town that sold the service, a
// crown's chests, a gang's purse, a unit's pack); when the player is paid,
// the coin comes out of one (capped by what the payer holds). Coin truly
// found or lost — a buried hoard dug up, a purse dropped in a river — is
// booked with MoneySupply.leak, so the world's coin census closes
// (systems/coinCensus.js, __tests__/coinPlayerActions.ui.test.js).
//
// A counterparty (`to` / `from`) is one of:
//   a settlement           its market purse (Economy.payTown / drawTown)
//   a kingdom              its chests (paying in) / Economy.crownPays (paying out)
//   { purse: obj, key }    obj[key] (a gang, an NPC, a unit's pack…; key 'gold' by default)
//   { leak: 'why' }        coin made or unmade: MoneySupply.leak
//   null / 'here'          the nearest town keeping coin to the player (else lost/none)
// Only the player's real coin moves the counterparty: in a barter place
// (world/barter.js) `player.gold` pays in goods, so the coin side is measured
// as the change in Barter.coinOf. Draws no RNG.

import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Barter } from '../world/barter.js';
import { Ledger } from '../systems/ledger.js';
import { Utils } from '../core/utils.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
// (every amount moved is a whole number of cents: the smallest coin is 0.01g — Utils.cents)
const _r2 = (v) => Utils.cents(v);
const _pos = (v) => Math.max(0, _num(v));
const _obj = (v) => (v && typeof v === 'object' ? v : null);

function _isKingdom(x) {
    return !!(x && !x.economy && 'treasury' in x && x.id != null && (Array.isArray(x.territory) || x.population == null));
}

function _isTown(x) {
    return !!(x && (x.economy || (x.population != null && x.type) || x.dawnBorn || x.freshPurse || x.inKind));
}

/** The nearest town that keeps coin to the player (or `at`). */
function _nearest(world, player, at = null) {
    const q = at && Number.isFinite(at.q) ? at.q : player && player.q;
    const r = at && Number.isFinite(at.r) ? at.r : player && player.r;
    return Economy.nearestPurse(world, q, r);
}

/** A town keeps coin we can count: an economy purse, not bartering. */
function _townKeeps(s) {
    return !!(s && !s.inKind && Economy.townPurse(s) != null);
}

/** Coin into a counterparty. → what it took (the rest is booked lost). */
function _give(world, player, to, amount, why) {
    const a = _r2(_pos(amount));
    if (!(a > 0)) return 0;
    const o = _obj(to);
    if (o && o.leak) { MoneySupply.leak(world, -a, o.leak); return a; }
    if (o && o.purse && typeof o.purse === 'object') {
        const k = o.key || 'gold';
        o.purse[k] = _r2(_num(o.purse[k]) + a);
        return a;
    }
    if (_isKingdom(o)) { o.treasury = _r2(_num(o.treasury) + a); return a; }
    let s = _isTown(o) ? o : null;
    if (s && !_townKeeps(s)) {
        // (a town with no purse record yet gets one: the coin is spent there)
        if (!s.inKind && !s.economy && s.population > 0) { Economy.initSettlement(s); s.economy.gold = 0; }
        if (!_townKeeps(s)) s = null;
    }
    if (!s) s = _nearest(world, player, o && Number.isFinite(o.q) ? o : null);
    if (s) { Economy.payTown(s, a); return a; }
    MoneySupply.leak(world, -a, why || 'playerSpent');
    return a;
}

/** Coin out of a counterparty: at most what it holds. → what it gave. */
function _take(world, player, from, amount, why, strict = false) {
    const a = _r2(_pos(amount));
    if (!(a > 0)) return 0;
    const o = _obj(from);
    if (o && o.leak) { MoneySupply.leak(world, a, o.leak); return a; }
    if (o && o.purse && typeof o.purse === 'object') {
        const k = o.key || 'gold';
        // (a purse short of the sum gives what it holds, down to the cent)
        const t = Math.min(a, Utils.centsDown(_pos(o.purse[k])));
        o.purse[k] = _r2(_num(o.purse[k]) - t);
        return t;
    }
    if (_isKingdom(o)) return Economy.crownPays(o, world, a);
    let s = _isTown(o) ? o : null;
    // (a town that barters has no coin to give; one with no purse record yet pays as
    // Economy.drawTown has it — a record-less town is not counted, a dawn-born one is empty)
    if (s && s.inKind) s = null;
    if (s) return Economy.drawTown(s, a);
    if (strict) return 0;
    if (!s) s = _nearest(world, player, o && Number.isFinite(o.q) ? o : null);
    if (s) return Economy.drawTown(s, a);
    // (no town keeps coin anywhere: nothing to be paid from — with no world at all,
    // a headless call with nobody to draw on, the sum is paid as asked)
    return world ? 0 : a;
}

export const PlayerCoin = {
    /**
     * The player pays `amount` to `to` (callers check the player can). The
     * player's purse goes down by `amount`; the real coin that left it lands
     * in `to`. `category` books the Ledger (omit when the caller books it).
     * → the amount paid
     */
    pay(world, player, amount, to = null, category = null, why = null) {
        const a = _r2(_pos(amount));
        if (!player || !(a > 0)) return 0;
        const c0 = _pos(Barter.coinOf(player));
        player.gold = _r2(_num(player.gold) - a);
        const moved = _r2(c0 - _pos(Barter.coinOf(player)));
        if (moved > 0) _give(world, player, to, moved, why || category);
        if (category) Ledger.record(player, category, -a);
        return a;
    },

    /**
     * The player is paid up to `amount` by `from`: what `from` holds of it
     * (opts.full: the whole amount, the rest made good from the nearest town;
     * opts.strict: only `from` itself, never the nearest town in its place).
     * `category` books the Ledger. → what the player got
     */
    receive(world, player, amount, from = null, category = null, opts = {}) {
        const want = _r2(_pos(amount));
        if (!player || !(want > 0)) return 0;
        let got = _take(world, player, from, want, opts.why || category, !!opts.strict);
        got = _r2(got);
        if (opts.full && got < want) got = _r2(got + _take(world, player, null, _r2(want - got)));
        if (!(got > 0)) return 0;
        const c0 = _pos(Barter.coinOf(player));
        player.gold = _r2(_num(player.gold) + got);
        // (in a barter place the purse took goods, not the coin: the coin goes back)
        const landed = _r2(_pos(Barter.coinOf(player)) - c0);
        if (landed < got) _give(world, player, from, _r2(got - landed), opts.why || category);
        if (category) Ledger.record(player, category, got);
        return got;
    },

    /** Coin the player finds that was in no purse (treasure, a wreck): booked found. → amount */
    found(world, player, amount, why = 'treasure', category = null) {
        return PlayerCoin.receive(world, player, amount, { leak: why }, category);
    },

    /** Coin the player loses out of the world (dropped in the deep, burnt): booked lost. → amount */
    lost(world, player, amount, why = 'lost', category = null) {
        const a = Math.min(_r2(_pos(amount)), Utils.centsDown(_pos(player && player.gold)));
        return PlayerCoin.pay(world, player, a, { leak: why }, category);
    },

    /** Move coin between two non-player purses (a refund, a pot settled). → amount moved */
    move(world, from, to, amount, player = null) {
        const got = _take(world, player, from, amount);
        if (got > 0) _give(world, player, to, got);
        return got;
    },

    /**
     * A payer for goods sold on the spot where the player stands
     * (PlayerInventory.addOrSell): fn(gold) → what the nearest town's purse
     * could pay of it (drawn out of it). With no world, pays as asked.
     */
    payerHere(world, player, at = null) {
        return (gold) => _take(world, player, at ? { q: at.q, r: at.r } : null, gold);
    },

    /** The nearest town that keeps coin to the player (or `at`: {q, r}). */
    nearestTown(world, player, at = null) {
        return _nearest(world, player, at);
    },

    /** The settlement on the player's tile, if any. */
    townHere(world, player) {
        const t = world && typeof world.getTile === 'function' && player ? world.getTile(player.q, player.r) : null;
        return (t && t.settlement) || null;
    },
};
