// ============================================
// MINTS — specie, the realms' mints and the player's dealings in coin
// ============================================
// The daily turn of the money system and everything the player can do with
// it. The model of the coin itself (each realm's coin in circulation, the
// flows between realms, the price level) is world/moneySupply.js; this
// module drives it and adds:
//   • the weekly turn: gathers the realms in a panic (a run on one of their
//     banks, systems/finance.js) and ticks MoneySupply; crowns out of trouble
//     with debased coin proclaim a recoinage; the player's mint lease is paid
//     its share of the seigniorage
//   • the money changers: carrying gold into a realm whose coin is of another
//     purity costs a fee on the purse (Ledger 'exchange')
//   • the mint: at a realm's capital the player sells gold and silver ore and
//     gold bars at the mint's price (fine × (1 − seigniorage) × the realm's
//     price multiplier, never above askCap of the market's own ask: no
//     buy-here-sell-to-the-mint loop), up to a weekly amount — bullion bought
//     where coin is sound and cheap fetches more at a debased mint (Gresham's
//     law), within that cap and minus the changers' fee
//   • leasing a mint: a fee up front for a share of its seigniorage
//   • as ruler: the mint's seigniorage policy, a recoinage edict, debasement
//     (systems/finance.js)
//   • counterfeiting (Thieves' Guild): pass silvered copper for gain, at the
//     risk of a fine, heat and the gaol
//
// Rolls (counterfeiting) are hash rolls on the seed, the day and the
// player's count — no shared-stream draws; the tick draws no randomness at
// all. State: world.money (world/moneySupply.js, saved with the world) and
// player.mints (saved with the player). Tuned in data/mints.json.

import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Coinage } from '../world/coinage.js';
import { Economy } from '../world/economy.js';
import { Finance } from './finance.js';
import { Bourse } from './bourse.js';
import { RealmWars } from './realmWars.js';
import { Underworld } from './underworld.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

function _day(world) {
    return world && Number.isFinite(world.day) ? world.day : 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A deterministic roll in [0, 1) from a key. */
function _roll(key) {
    return (_hash(key) % 1000003) / 1000003;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _purity(k) {
    return Coinage.purity(k);
}

/** Bullion the mint takes: the goods with a fine value. */
export const BULLION = ['gold_ore', 'silver_ore', 'gold_bar'];

export const Mints = {
    config() {
        return MoneySupply.config();
    },

    enabled() {
        return MoneySupply.enabled();
    },

    // ── Player state ──────────────────────────────────────

    _blank() {
        return {
            realm: null, lease: null, lastCounterfeit: null, counterfeits: 0,
            stats: { sold: 0, soldGold: 0, exchangeFees: 0, leaseFees: 0, leaseEarned: 0, passed: 0, caught: 0, counterfeitGain: 0 },
            log: [],
        };
    },

    state(player) {
        if (!player) return Mints._blank();
        let st = player.mints;
        if (!_obj(st)) st = player.mints = Mints._blank();
        const b = Mints._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!_obj(st.stats)) st.stats = b.stats;
        for (const k of Object.keys(b.stats)) st.stats[k] = _num(st.stats[k]);
        if (!Array.isArray(st.log)) st.log = [];
        st.counterfeits = _num(st.counterfeits);
        return st;
    },

    serialize(player) {
        return player && _obj(player.mints) ? JSON.parse(JSON.stringify(player.mints)) : null;
    },

    /** Backfill on load (older saves: none until the first dealing). */
    loadState(player) {
        if (player && _obj(player.mints)) Mints.state(player);
    },

    _log(player, world, text) {
        const st = Mints.state(player);
        st.log.push({ day: _day(world), text });
        if (st.log.length > 30) st.log.splice(0, st.log.length - 30);
    },

    // ── Reading ───────────────────────────────────────────

    /** The realm (and its money record) whose mint sits on this tile: a living realm's capital. */
    mintAt(world, tile) {
        const s = tile && tile.settlement;
        if (!s || s.kingdom == null) return null;
        const k = _kingdom(world, s.kingdom);
        if (!k || k.isAlive === false || !k.capital || k.capital.q !== tile.q || k.capital.r !== tile.r) return null;
        return { kingdom: k, settlement: s };
    },

    /** The realm the player stands in (the tile's owner, or the town's), or null. */
    realmHere(player, world) {
        const tile = player && world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        if (!tile) return null;
        const kid = tile.settlement && tile.settlement.kingdom != null ? tile.settlement.kingdom : tile.kingdom;
        const k = kid != null ? _kingdom(world, kid) : null;
        return k && k.isAlive !== false ? k : null;
    },

    /** The money changers' fee (a share of the purse) between two realms' coins. */
    exchangeFee(world, fromKid, toKid) {
        if (fromKid == null || toKid == null || fromKid === toKid) return 0;
        const E = Mints.config().exchange;
        const gap = Math.abs(_purity(_kingdom(world, fromKid)) - _purity(_kingdom(world, toKid)));
        if (!(gap > 1e-9)) return 0;
        return _clamp(gap * _num(E.perPurity), 0, _num(E.max, 0.05));
    },

    /**
     * Every living realm's coin, against `localKid`'s: [{ id, name, purity,
     * level, mult, coin, perHead, trend, vel, rate, fee, struck, seign, policy }].
     */
    realmTable(world, localKid = null) {
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false) continue;
            const R = MoneySupply.realm(world, k.id);
            out.push({
                id: k.id, name: k.name, purity: _purity(k), level: MoneySupply.level(world, k.id),
                mult: Coinage.priceMultiplier(world, { kingdom: k.id }),
                coin: R ? Math.round(R.coin) : null, perHead: R && R.pop > 0 ? _r2(R.coin / R.pop) : null,
                trend: MoneySupply.trend(world, k.id, 4), vel: R ? R.vel : 1,
                rate: localKid != null ? MoneySupply.exchangeRate(world, k.id, localKid) : 1,
                fee: localKid != null ? Mints.exchangeFee(world, k.id, localKid) : 0,
                struck: R ? R.mint.lastStruck : 0, seign: R ? R.mint.lastSeign : 0, policy: R ? R.mint.policy : 'normal',
                last: R ? R.last : null, hist: R ? R.hist : [],
            });
        }
        return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },

    // ── The daily turn ────────────────────────────────────

    /** Realms with a run on one of their banks today (systems/finance.js). */
    _panics(world, player) {
        const set = new Set();
        const day = _day(world);
        const banks = player && player.finance && Array.isArray(player.finance.banks) ? player.finance.banks : [];
        for (const b of banks) if (b && b.status === 'open' && b.kingdomId != null && Finance.inPanic(b, day)) set.add(b.kingdomId);
        // A crash or a panic on the Bourse does the same in its exchange's realm
        for (const kid of Bourse.panicRealms(world, player)) set.add(kid);
        return set;
    },

    /** → { notices: [{ icon, title, text, type }], news } */
    processDay(world, player = null) {
        const out = { notices: [], news: null };
        if (!world || !Mints.enabled()) return out;
        const news = MoneySupply.processDay(world, { panic: Mints._panics(world, player) });
        out.news = news;
        if (news) {
            Mints._crownsWeek(world, player, out);
            if (player) Mints._leaseWeek(world, player, out);
            const here = player ? Mints.realmHere(player, world) : null;
            const ruled = player ? Finance._ruledId(player) : null;
            for (const h of news) {
                if (h.kingdomId !== ruled && !(here && here.id === h.kingdomId)) continue;
                out.notices.push(h.kind === 'coin_short'
                    ? { icon: '💰', title: 'Coin Is Short', text: `Coin is scarce in ${h.kingdom}: prices there stand ${Math.abs(h.pct)}% under the world's.`, type: 'info' }
                    : { icon: '💰', title: 'A Flood of Coin', text: `Coin floods ${h.kingdom}: prices there stand ${h.pct}% over the world's.`, type: 'info' });
            }
        }
        if (player) Mints._changers(world, player, out);
        return out;
    },

    /** Crowns out of trouble call in their clipped coin. */
    _crownsWeek(world, player, out) {
        const R = Mints.config().recoinage;
        const ruled = player ? Finance._ruledId(player) : null;
        for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
            if (k.id === ruled) continue;
            const f = k.finance;
            if (!f || !(f.purity < 1 - _num(R.minGap, 0.05))) continue;
            if (_num(f.debtRatio) >= _num(R.maxDebtRatio, 0.3) || (f.levy && _num(f.levy.until) >= _day(world))) continue;
            const q = Mints.recoinQuote(world, k);
            if (!q.ok || _num(k.treasury) < q.cost * _num(R.treasuryCover, 4)) continue;
            const res = Mints.recoin(world, k);
            if (res.success && player && (player.allegiance === k.id || (Mints.realmHere(player, world) || {}).id === k.id)) {
                out.notices.push({ icon: '💰', title: 'Recoinage', text: res.text, type: 'info' });
            }
        }
    },

    /** What a recoinage would cost the crown now: { ok, cost, coinAfter, reason }. */
    recoinQuote(world, k) {
        const R = Mints.config().recoinage;
        const rec = k ? MoneySupply.realm(world, k.id) : null;
        const p = _purity(k);
        if (!k || !rec) return { ok: false, cost: 0, reason: 'The realm has no mint yet.' };
        if (p >= 1) return { ok: false, cost: 0, reason: 'The coin is already of full weight.' };
        const last = rec.mint.lastRecoin;
        if (last != null && _day(world) - last < _num(R.cooldown, 120)) return { ok: false, cost: 0, reason: `The last recoinage was on day ${last}: the mint cannot call the coin in again so soon.` };
        const share = _num(R.crownShare, 0.5);
        const cost = Math.ceil(rec.coin * (1 - p) * share);
        return { ok: true, cost, coinAfter: Math.round(rec.coin * (p + (1 - p) * share)), purity: p };
    },

    /** A recoinage edict: the old coin is called in and struck anew at full purity. */
    recoin(world, k, opts = {}) {
        const q = Mints.recoinQuote(world, k);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(k.treasury) < q.cost) return { success: false, reason: `The treasury needs ${q.cost}g to make up the silver.` };
        const R = Mints.config().recoinage;
        const rec = MoneySupply.realm(world, k.id);
        k.treasury = _num(k.treasury) - q.cost;
        MoneySupply.adjust(world, k.id, q.coinAfter - rec.coin, 'recoin');
        const f = Finance.kingdomState(k);
        f.purity = 1;
        rec.mint.lastRecoin = _day(world);
        k.stability = _clamp(_num(k.stability, 50) + _num(R.stability, 2), 0, 100);
        MoneySupply.record(world, { kind: 'recoinage', kingdomId: k.id, kingdom: k.name, purity: Math.round(q.purity * 100), cost: q.cost, own: !!opts.own });
        return { success: true, cost: q.cost, text: `${k.name} calls in its clipped coin (${Math.round(q.purity * 100)}% silver) and strikes it anew at full weight. The crown pays ${q.cost}g to make up the silver; there is less coin about, and prices ease.` };
    },

    /** The player's mint lease: paid its share each week, ended by its term, by war or by conquest. */
    _leaseWeek(world, player, out) {
        const st = player.mints;
        const L = st && st.lease;
        if (!L) return;
        const k = _kingdom(world, L.kingdomId);
        const day = _day(world);
        const rec = k ? MoneySupply.realm(world, k.id) : null;
        if (!k || k.isAlive === false || !rec) {
            st.lease = null;
            out.notices.push({ icon: '💰', title: 'Mint Lease Void', text: `The realm whose mint you leased is no more, and your lease with it.`, type: 'warning' });
            return;
        }
        if (RealmWars.atWarWith(player, k.id)) {
            st.lease = null;
            if (rec.mint.lease) rec.mint.lease = null;
            out.notices.push({ icon: '💰', title: 'Mint Lease Revoked', text: `${k.name} is at war with you: its master of the mint turns your clerks out.`, type: 'warning' });
            return;
        }
        const pay = Math.floor(_num(rec.mint.lastSeign) * _num(L.share));
        if (pay > 0) {
            const paid = Math.min(pay, Math.max(0, Math.floor(_num(k.treasury))));
            if (paid > 0) {
                k.treasury -= paid;
                player.gold = _num(player.gold) + paid;
                Ledger.record(player, 'mintLease', paid);
                L.earned = _num(L.earned) + paid;
                st.stats.leaseEarned += paid;
            }
        }
        if (day >= _num(L.until)) {
            st.lease = null;
            rec.mint.lease = null;
            out.notices.push({ icon: '💰', title: 'Mint Lease Ended', text: `Your lease of the mint of ${k.name} has run its term: it paid you ${Math.round(_num(L.earned))}g for ${Math.round(_num(L.fee))}g.`, type: 'info' });
        }
    },

    /** The money changers at a border: a fee on the purse when the coins differ in purity. */
    _changers(world, player, out) {
        const st = Mints.state(player);
        const here = Mints.realmHere(player, world);
        if (!here) return;
        const from = st.realm;
        st.realm = here.id;
        if (from == null || from === here.id) return;
        const rate = Mints.exchangeFee(world, from, here.id);
        const E = Mints.config().exchange;
        const gold = Math.floor(_num(player.gold));
        if (!(rate > 0) || gold < _num(E.minGold, 50)) return;
        const fee = Math.max(1, Math.round(gold * rate));
        player.gold = _num(player.gold) - fee;
        Ledger.record(player, 'exchange', -fee);
        st.stats.exchangeFees += fee;
        const fk = _kingdom(world, from);
        out.notices.push({ icon: '💱', title: 'Money Changers', text: `The changers of ${here.name} assay your ${fk ? fk.name : 'foreign'} coin (${Math.round(_purity(fk) * 100)}% silver against ${Math.round(_purity(here) * 100)}%) and keep ${fee}g for the exchange.`, type: 'info' });
    },

    // ── The mint: selling bullion ─────────────────────────

    /**
     * What the mint on this tile pays for a unit of `good`: { unit, ask, room
     * (units it still takes this week), ok, reason }.
     */
    bullionQuote(player, world, tile, good) {
        const at = Mints.mintAt(world, tile);
        if (!at) return { ok: false, unit: 0, room: 0, reason: 'There is no mint here: the realms strike their coin at their capitals.' };
        const M = Mints.config().mint;
        const fine = _num(M.fine[good]);
        if (!(fine > 0)) return { ok: false, unit: 0, room: 0, reason: 'The mint does not buy that.' };
        // (read-only: the counsel asks too)
        const rec = MoneySupply.realm(world, at.kingdom.id);
        const pol = MoneySupply.policy(rec);
        const mult = Coinage.priceMultiplier(world, at.settlement);
        let unit = fine * (1 - _num(pol.seigniorage)) * mult;
        const ask = Economy.marketAsk(world, tile, good);
        if (ask != null && ask > 0) unit = Math.min(unit, ask * _num(M.askCap, 0.95));
        unit = Math.max(0, Math.floor(unit * 100) / 100);
        const room = Math.max(0, Math.floor((_num(M.playerWeeklyFine) - _num(rec && rec.mint && rec.mint.playerWeek)) / fine));
        if (player && RealmWars.atWarWith(player, at.kingdom.id)) return { ok: false, unit, ask, room: 0, fine, reason: `${at.kingdom.name} is at war with you.` };
        return { ok: room > 0 && unit > 0, unit, ask, room, fine, kingdom: at.kingdom, reason: room > 0 ? null : 'The mint has bought all it will from you this week.' };
    },

    /** Sell bullion to the mint at its price. */
    sellBullion(player, world, tile, good, qty) {
        if (!Mints.enabled()) return { success: false, reason: 'The mints are closed.' };
        const q = Mints.bullionQuote(player, world, tile, good);
        if (!q.ok) return { success: false, reason: q.reason };
        const have = Math.floor(_num(player.inventory && player.inventory[good]));
        const n = Math.min(Math.floor(_num(qty)), have, q.room);
        if (n <= 0) return { success: false, reason: have > 0 ? q.reason || 'The mint will take no more.' : 'You carry none.' };
        const gold = Math.floor(q.unit * n);
        player.inventory[good] = have - n;
        if (player.inventory[good] <= 0) delete player.inventory[good];
        player.gold = _num(player.gold) + gold;
        Ledger.record(player, 'goodsSold', gold);
        const rec = MoneySupply.ensureRealm(world, q.kingdom);
        MoneySupply._fill(rec);
        rec.mint.pending[good] = _num(rec.mint.pending[good]) + n;
        rec.mint.playerWeek = _num(rec.mint.playerWeek) + n * q.fine;
        const st = Mints.state(player);
        st.stats.sold += n;
        st.stats.soldGold += gold;
        const name = PlayerInventory.describe ? PlayerInventory.describe({ [good]: n }) : `${n} ${good}`;
        Mints._log(player, world, `Sold ${name} to the mint of ${q.kingdom.name} for ${gold}g.`);
        return { success: true, gold, qty: n, text: `The mint of ${q.kingdom.name} weighs your ${name} and pays ${gold}g in new coin.` };
    },

    // ── Leasing a mint ────────────────────────────────────

    leaseQuote(player, world, tile) {
        const at = Mints.mintAt(world, tile);
        if (!at) return { ok: false, reason: 'There is no mint here.' };
        const C = Mints.config().concession;
        const k = at.kingdom;
        const rec = MoneySupply.ensureRealm(world, k);
        const st = player ? Mints.state(player) : null;
        const weeks = Math.max(1, Math.round(_num(C.termDays, 120) / 7));
        const avg = MoneySupply.avgSeign(rec);
        const fee = Math.max(_num(C.minFee, 150), Math.round(avg * weeks * _num(C.share, 0.5) * _num(C.feeShare, 0.9)));
        const base = { kingdom: k, fee, weeks, avg: _r2(avg), share: _num(C.share, 0.5), days: _num(C.termDays, 120) };
        if (st && st.lease) return { ...base, ok: false, reason: st.lease.kingdomId === k.id ? 'You already hold this mint.' : 'You already hold a mint lease.' };
        if (rec.mint.lease) return { ...base, ok: false, reason: 'Another holds the lease.' };
        if (player && RealmWars.atWarWith(player, k.id)) return { ...base, ok: false, reason: `${k.name} is at war with you.` };
        if (!(avg > 0)) return { ...base, ok: false, reason: 'The mint has struck nothing lately: there is no seigniorage to share.' };
        return { ...base, ok: true };
    },

    leaseMint(player, world, tile) {
        const q = Mints.leaseQuote(player, world, tile);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.fee) return { success: false, reason: `The lease costs ${q.fee}g.` };
        const day = _day(world);
        player.gold -= q.fee;
        q.kingdom.treasury = _num(q.kingdom.treasury) + q.fee;
        Ledger.record(player, 'mintLease', -q.fee);
        const st = Mints.state(player);
        st.lease = { kingdomId: q.kingdom.id, realm: q.kingdom.name, day, until: day + q.days, share: q.share, fee: q.fee, earned: 0 };
        st.stats.leaseFees += q.fee;
        MoneySupply.realm(world, q.kingdom.id).mint.lease = 'player';
        Mints._log(player, world, `Leased the mint of ${q.kingdom.name} for ${q.fee}g.`);
        return { success: true, fee: q.fee, text: `You lease the mint of ${q.kingdom.name} for ${q.days} days: ${Math.round(q.share * 100)}% of its seigniorage is yours each week (lately about ${Math.round(q.avg)}g a week in all).` };
    },

    // ── As ruler ──────────────────────────────────────────

    setPolicy(player, world, policy) {
        const k = Finance.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const P = Mints.config().mint.policies;
        if (!P[policy]) return { success: false, reason: 'No such policy.' };
        const rec = MoneySupply.ensureRealm(world, k);
        rec.mint.policy = policy;
        return { success: true, text: `The mint of ${k.name} now takes ${Math.round(_num(P[policy].seigniorage) * 100)}% seigniorage.` };
    },

    royalRecoin(player, world) {
        const k = Finance.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        return Mints.recoin(world, k, { own: true });
    },

    royalDebase(player, world) {
        return Finance.royalDebase(player, world);
    },

    // ── Counterfeiting ────────────────────────────────────

    counterfeitQuote(player, world, tile, stake = null) {
        const C = Mints.config().counterfeit;
        const s = tile && tile.settlement;
        const k = s && s.kingdom != null ? _kingdom(world, s.kingdom) : null;
        if (!k || k.isAlive === false) return { ok: false, reason: 'False coin passes only in a realm\'s towns.' };
        const uw = Underworld.ensure(player);
        if (!uw.guild.member || _num(uw.guild.rank) < _num(C.minRank, 1)) return { ok: false, reason: 'Only the Thieves\' Guild knows the coiners, and only its trusted hands.' };
        const st = Mints.state(player);
        const day = _day(world);
        if (st.lastCounterfeit != null && day - st.lastCounterfeit < _num(C.cooldown, 7)) return { ok: false, reason: `The coiners want a week between batches (next on day ${st.lastCounterfeit + _num(C.cooldown, 7)}).` };
        const amount = Math.floor(_clamp(_num(stake, C.minStake), _num(C.minStake, 100), _num(C.maxStake, 600)));
        const heat = Underworld.getHeat(player, k.id);
        const p = _purity(k);
        const chance = _clamp((_num(C.base) + heat * _num(C.heatPer) - _num(uw.guild.rank) * _num(C.rankCut)) * (_num(C.looser, 0.6) + (1 - _num(C.looser, 0.6)) * p), 0.03, 0.9);
        return { ok: true, kingdom: k, stake: amount, gain: Math.floor(amount * _num(C.gain)), chance: _r2(chance), fine: Math.round(amount * _num(C.fineShare, 1)) };
    },

    counterfeit(player, world, tile, stake = null) {
        const q = Mints.counterfeitQuote(player, world, tile, stake);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.stake) return { success: false, reason: `The coiners want ${q.stake}g of good coin to silver their copper.` };
        const C = Mints.config().counterfeit;
        const st = Mints.state(player);
        const day = _day(world);
        st.lastCounterfeit = day;
        st.counterfeits++;
        const roll = _roll(`coin:${_seed(world)}:${day}:${st.counterfeits}:${q.kingdom.id}`);
        if (roll < q.chance) {
            const loss = Math.min(Math.floor(_num(player.gold)), q.stake + q.fine);
            player.gold -= loss;
            Ledger.record(player, 'fraud', -loss);
            Underworld.addHeat(player, q.kingdom.id, _num(C.caughtHeat, 15), world);
            st.stats.caught++;
            let jail = '';
            if (_roll(`coin-arrest:${_seed(world)}:${day}:${st.counterfeits}`) < _num(C.arrestChance, 0.5)) {
                const res = Underworld._arrest(player, world, tile.settlement, 'coining');
                if (res) jail = ` ${res.text}`;
            }
            Mints._log(player, world, `Caught passing false coin in ${q.kingdom.name}: lost ${loss}g.`);
            return { success: true, caught: true, loss, text: `A money changer bites a piece and spits. The watch takes your false coin and fines you: ${loss}g lost, and ${q.kingdom.name} will know your face.${jail}` };
        }
        const gain = q.gain;
        player.gold = _num(player.gold) + gain;
        Ledger.record(player, 'fraud', gain);
        Underworld.addHeat(player, q.kingdom.id, _num(C.passHeat, 4), world);
        MoneySupply.adjust(world, q.kingdom.id, q.stake + gain, 'counterfeit');
        st.stats.passed++;
        st.stats.counterfeitGain += gain;
        Mints._log(player, world, `Passed false coin in ${q.kingdom.name}: ${gain}g gained.`);
        return { success: true, caught: false, gain, text: `The silvered pieces pass from hand to hand in the markets of ${q.kingdom.name}. You clear ${gain}g, and the realm has a little more coin than it knows.` };
    },

    // ── Counsel ───────────────────────────────────────────

    /**
     * The nearest mint (within mintRadius) that pays at least bullionGain more
     * for bullion the player carries than the market here would: { good, qty,
     * kingdom, q, r, unit, here, dist } or null. Read-only.
     */
    bullionTip(player, world) {
        if (!player || !world || !Mints.enabled() || typeof world.getTile !== 'function') return null;
        const inv = player.inventory || {};
        const goods = BULLION.filter(g => _num(inv[g]) >= 1);
        if (!goods.length) return null;
        const C = Mints.config().counsel;
        const tile = world.getTile(player.q, player.r);
        let best = null;
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || !k.capital) continue;
            const dist = Hex.wrappingDistance ? Hex.wrappingDistance(player.q, player.r, k.capital.q, k.capital.r, world.width) : 0;
            if (dist > _num(C.mintRadius, 25)) continue;
            const mt = world.getTile(k.capital.q, k.capital.r);
            for (const g of goods) {
                const q = Mints.bullionQuote(player, world, mt, g);
                if (!q.ok) continue;
                const here = tile && tile.settlement ? _num(Economy.marketAsk(world, tile, g), 0) * 0.7 : 0;
                const ref = here > 0 ? here : 0;
                if (ref > 0 && q.unit < ref * (1 + _num(C.bullionGain, 0.05))) continue;
                const value = q.unit * Math.min(_num(inv[g]), q.room);
                if (!best || value > best.value) best = { good: g, qty: Math.floor(_num(inv[g])), kingdom: k.name, q: k.capital.q, r: k.capital.r, unit: q.unit, value, dist };
            }
        }
        return best;
    },

    /** For the counsel: the ruled realm's coin out of line ({ kind, level, purity }) or null. */
    ruledCoinWarning(player, world) {
        const k = player ? Finance.ruledKingdom(player, world) : null;
        if (!k || !Mints.enabled()) return null;
        const N = Mints.config().news;
        const level = MoneySupply.level(world, k.id);
        const purity = _purity(k);
        if (purity < 1) return { kind: 'debased', level, purity, kingdom: k.name, recoin: Mints.recoinQuote(world, k) };
        if (level <= _num(N.shortAt, 0.94)) return { kind: 'short', level, purity, kingdom: k.name };
        if (level >= _num(N.floodAt, 1.07)) return { kind: 'flood', level, purity, kingdom: k.name };
        return null;
    },
};
