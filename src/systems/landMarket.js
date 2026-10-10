// ============================================
// LAND MARKET — rents, land values and estates changing hands
// ============================================
// The estates about every town (world/estates.js) are worked by tenants who
// pay rent once a month, on the town's own day of the month:
//   coin       a sum fixed on the estate's usual crop: the tenants carry a
//              bad year (above what they can hand over it falls into arrears)
//   kind       a share of this month's crop at its price: the landlord does
//   level      low / customary / high: more rent, less loyalty — high rents
//              drive households to the nearest town (world/townLabour.js
//              moveStratum), sullen tenants sour the town, rent strikes and
//              rent riots; low rents content them
// The player's rents come out of the town's own coin (settlement.economy
// .gold, which the crown's income follows): a landlord's rent is the town's
// money, never new money. NPC landlords' purses are notional — their rents
// are counted in the crowns' taxes already — but every estate that changes
// hands moves real gold from the buyer's purse to the seller's, or to and
// from a crown's treasury and the player's purse.
//
// Land is valued at its expected yearly net rent over the realm's land rate,
// which follows the crown's bond rate (systems/finance.js). Estates change
// hands: indebted nobles sell, crowns in crisis sell, the merchant houses,
// the burghers and the church buy; a realm that loses a war may cede a crown
// estate; a town conquered loses its old crown's and nobles' estates to the
// new crown (and the player theirs, if the new realm is hostile); nobles
// leave estates to the church and settle them as dowries; landlords enclose
// where wool is dear.
//
// The player buys (listings or offers), sells, sets rents, drains, marls and
// encloses, and may settle an estate as a dowry. Every gold flow goes through
// the Ledger. Rolls are hashes of the seed, the day and the estate: no RNG is
// drawn. Tuned in data/estates.json.

import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Estates } from '../world/estates.js';
import { TownLabour } from '../world/townLabour.js';
import { Seasons } from '../world/seasons.js';
import { Finance } from './finance.js';
import { RealmWars } from './realmWars.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _r2 = (v) => Math.round(v * 100) / 100;
const RANK = { village: 0, town: 1, city: 2, capital: 3 };
const LOG_CAP = 30;
const YEAR = 120;
/** The towns and holders by their day of the month, per state (rebuilt when one comes or goes). */
const _turnCache = new WeakMap();

function _slot(key, n) {
    return (Utils.hashStr(String(key)) >>> 0) % Math.max(1, n);
}

export const LandMarket = {
    // ── The player's record ───────────────────────────────

    _blank() {
        return { batches: [], log: [], seq: 1, stats: { bought: 0, sold: 0, spent: 0, received: 0, rents: 0, works: 0, enclosed: 0, dowries: 0, confiscated: 0, putOut: 0, cloth: 0, wages: 0, fines: 0, seized: 0 } };
    },

    /** player.land: the putting-out batches, the land log and the counters. */
    playerState(player) {
        if (!player) return LandMarket._blank();
        let s = _obj(player.land);
        if (!s) s = player.land = LandMarket._blank();
        const b = LandMarket._blank();
        if (!Array.isArray(s.batches)) s.batches = [];
        if (!Array.isArray(s.log)) s.log = [];
        if (!Number.isFinite(s.seq)) s.seq = 1;
        s.stats = { ...b.stats, ...(_obj(s.stats) || {}) };
        return s;
    },

    serializePlayer(player) {
        const s = player && _obj(player.land);
        return s ? JSON.parse(JSON.stringify(s)) : null;
    },

    loadState(player) {
        return LandMarket.playerState(player);
    },

    _log(player, world, text) {
        const s = LandMarket.playerState(player);
        s.log.unshift({ day: _day(world), text });
        if (s.log.length > LOG_CAP) s.log.length = LOG_CAP;
    },

    // ── Values ────────────────────────────────────────────

    /** The realm's land rate (a year): its bond rate's swing about the reference, war and unrest. */
    landRate(world, kid) {
        const V = Estates.config().value;
        const k = Estates.kingdom(world, kid);
        if (!k || k.isAlive === false) return _num(V.free, 0.065);
        let r = _num(V.base, 0.055) + _num(V.bondShare, 0.5) * (Finance.bondApr(k, _day(world)) - _num(V.bondRef, 0.06));
        if (Array.isArray(k.wars) && k.wars.length) r += _num(V.war, 0.01);
        if (_num(k.stability, 50) < 35) r += _num(V.unrest, 0.01);
        return _clamp(r, _num(V.min, 0.04), _num(V.max, 0.09));
    },

    /** Share of the crop an estate's rent takes (its level on the crop land, the grazier's lease on the enclosed). */
    rentShare(est) {
        const R = Estates.config().rent;
        const L = R.levels[est && est.rent] || R.levels.customary;
        const enc = _clamp(_num(est && est.enclosed), 0, 1);
        return _num(L.share, 0.25) * (1 - enc) + _num(R.enclosed, 0.6) * enc;
    },

    /** Share of what is due the tenants actually pay at a loyalty. */
    collectFactor(loyalty) {
        return _clamp(0.7 + 0.3 * _num(loyalty, 55) / 75, 0.7, 1);
    },

    /** Expected net rent a year (gold): the usual crop × the rent share × collection × (1 − steward). */
    annualRent(world, est, live = null) {
        const R = Estates.config().rent;
        const t = live || Estates._liveOfKey(world, est.town);
        const gross = est.avg != null ? _num(est.avg) : Estates.output(world, est, t).gross;
        return gross * YEAR * LandMarket.rentShare(est) * LandMarket.collectFactor(est.loyalty) * (1 - _num(R.steward, 0.08));
    },

    /** The estate's price: its expected yearly net rent over the realm's land rate. */
    value(world, est, live = null, rate = null) {
        if (!est) return 0;
        const t = live || Estates._liveOfKey(world, est.town);
        if (!t) return 0;
        if (rate == null) rate = LandMarket.landRate(world, t.kingdom != null ? t.kingdom : null);
        return Math.max(0, Math.round(LandMarket.annualRent(world, est, t) / rate));
    },

    // ── The day ───────────────────────────────────────────

    /**
     * The day's land market (from endDay, before the markets): estates for
     * new towns (every resyncDays), each town's month on its own day (rents,
     * tenants, loyalty, flight, values, a conquered town's estates), the
     * holders' month, listings and sales, war's terms, the year's bequests,
     * dowries and enclosures, and the player's improvements. → { notices }.
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function' || !Estates.enabled()) return out;
        const st = Estates.state(world);
        const C = Estates.config();
        const day = _day(world);
        const D = C.derive;
        const nT = Math.max(1, Math.floor(_num(D.turnDays, 30)));
        if (st.syncAt == null || day - _num(st.syncAt) >= _num(D.resyncDays, 60)) {
            Estates.derive(world, day);
        }
        const turn = ((day % nT) + nT) % nT;
        const tb = LandMarket._turns(st, nT);
        for (const rec of tb.towns[turn] || []) LandMarket._townMonth(world, player, rec, day, out);
        for (const h of tb.holders[turn] || []) LandMarket._holderMonth(world, player, h, day, out);
        // Crowns in crisis sell land (each realm on its own day)
        const ks = st.kslot || (st.kslot = {});
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false) continue;
            if (!Number.isFinite(ks[k.id])) ks[k.id] = _slot(`crown:${k.id}`, nT);
            if (ks[k.id] !== turn) continue;
            LandMarket._crownMonth(world, k, day, out);
        }
        LandMarket._sales(world, player, day, out);
        LandMarket._warTerms(world, player, day, out);
        if (Seasons.dayOfYear(day) === 2) LandMarket._year(world, player, day, out);
        if (player) LandMarket._playerDay(world, player, day, out);
        return out;
    },

    /**
     * The towns and holders by their day of the month (memoised per state
     * until a town or holder comes or goes; the slots are saved on them).
     */
    _turns(st, nT) {
        const nt = Object.keys(st.towns).length, nh = Object.keys(st.holders).length;
        let tb = _turnCache.get(st);
        if (tb && tb.nt === nt && tb.nh === nh && tb.nT === nT && tb.towns0 === st.towns && tb.holders0 === st.holders) return tb;
        tb = { nt, nh, nT, towns0: st.towns, holders0: st.holders, towns: {}, holders: {} };
        for (const rec of Object.values(st.towns)) {
            if (!Number.isFinite(rec.slot)) rec.slot = _slot(`town:${rec.k}`, nT);
            (tb.towns[rec.slot] || (tb.towns[rec.slot] = [])).push(rec);
        }
        for (const h of Object.values(st.holders)) {
            if (h.kind === 'player' || h.kind === 'crown') continue;
            if (!Number.isFinite(h.slot)) h.slot = _slot(`holder:${h.id}`, nT);
            (tb.holders[h.slot] || (tb.holders[h.slot] = [])).push(h);
        }
        _turnCache.set(st, tb);
        return tb;
    },

    /** A town's month: each estate's tenants, rent and loyalty; a conquered town's land changes masters. */
    _townMonth(world, player, rec, day, out) {
        const live = Estates._live(world, rec.q, rec.r);
        if (!live) return;
        const C = Estates.config();
        const R = C.rent;
        const st = world.estates;
        const kid = live.kingdom != null ? live.kingdom : null;
        if (kid !== rec.kid) {
            LandMarket._conquest(world, player, rec, live, rec.kid, kid, day, out);
            rec.kid = kid;
        }
        rec.name = live.name || rec.name;
        if (!rec.base) Estates._baseFromMarket(rec, live);
        const poRecent = _num(rec.poAt, -999) >= day - 30;
        const rate = LandMarket.landRate(world, kid);
        for (const id of rec.ests) {
            const e = st.estates[id];
            if (!e) continue;
            e.hh = Estates.households(world, e, live);
            const gross = Estates.output(world, e, live).gross;
            e.avg = e.avg == null ? _r2(gross) : _r2(e.avg + _num(R.avgAlpha, 0.25) * (gross - e.avg));
            const L = R.levels[e.rent] || R.levels.customary;
            const share = LandMarket.rentShare(e);
            const due = (e.mode === 'kind' ? gross : e.avg) * 30 * share;
            const cap = gross * 30 * _num(R.capacity, 0.5);
            // (what the tenants can hand over this month; of it, what the bailiff collects)
            const owed = Math.min(due, cap);
            let paid = owed * LandMarket.collectFactor(e.loyalty);
            const strike = e.loyalty < _num(R.strikeBelow, 20) && _roll(world, 'strike', id, day) < _num(R.strikeChance, 0.4);
            if (strike) paid = 0;
            const arrears = strike ? due > 1 : due - owed > Math.max(1, due * 0.05);
            const net = paid * (1 - _num(R.steward, 0.08));
            e.lastDue = Math.round(due);
            e.lastRent = 0;
            e.arrears = arrears ? Math.round(_num(e.arrears) + due - (strike ? 0 : owed)) : Math.max(0, Math.round(_num(e.arrears) * 0.5));
            // The rent reaches its holder
            if (e.holder === 'player') {
                if (player) {
                    const econ = live.economy || (live.economy = { gold: 0, food: 0, goods: 0 });
                    const take = Math.floor(Math.min(net, Math.max(0, _num(econ.gold))));
                    if (take > 0) {
                        econ.gold = _num(econ.gold) - take;
                        player.gold = _num(player.gold) + take;
                        Ledger.record(player, 'estateRents', take);
                        const ps = LandMarket.playerState(player);
                        ps.stats.rents += take;
                        e.earned = _num(e.earned) + take;
                        e.lastRent = take;
                    }
                }
            } else if (Estates.kindOf(e.holder) !== 'crown') {
                const h = Estates.ensureHolder(world, e.holder);
                h.purse = _num(h.purse) + net;
                h.inc = _num(h.inc) + net;
                e.lastRent = Math.round(net);
            } else {
                e.lastRent = Math.round(net);
            }
            // Loyalty drifts to what the rent and the times make of it
            const target = _num(L.loyalty, 55) + (e.mode === 'kind' ? _num(R.kindBonus, 6) : 0) - (arrears ? _num(R.arrearsHit, 8) : 0)
                + (poRecent ? _num(R.putOutBonus, 5) : 0) + (e.drained ? _num(R.drainBonus, 3) : 0) - (strike ? 5 : 0);
            e.loyalty = Math.round(_clamp(_num(e.loyalty, 55) + _num(R.loyaltyStep, 0.35) * (target - _num(e.loyalty, 55)), 0, 100));
            if (e.holder === 'player') LandMarket._tenantsMood(world, player, rec, live, e, L, strike, day, out);
            e.value = LandMarket.value(world, e, live, rate);
        }
    },

    /** The player's tenants: flight from high rents, a sullen or contented town, rent riots. */
    _tenantsMood(world, player, rec, live, e, L, strike, day, out) {
        const C = Estates.config();
        const R = C.rent;
        const hhSize = Math.max(1, _num(C.derive.householdSize, 5));
        if (_num(L.flight) > 0 && e.hh > 4) {
            const n = Math.max(1, Math.round(e.hh * _num(L.flight) * (1 + Math.max(0, 40 - e.loyalty) / 40)));
            const dest = LandMarket._refuge(world, live, false);
            const moved = dest ? TownLabour.moveStratum(live, dest, 'peasants', n * hhSize) : 0;
            if (moved > 0) {
                e.fled = _num(e.fled) + Math.round(moved / hhSize);
                LandMarket._log(player, world, `${Math.round(moved / hhSize)} households left ${e.name} for ${dest.name}: the rent is more than they can bear.`);
            }
        }
        const h = typeof live.happiness === 'number' ? live.happiness : 50;
        if (e.loyalty < _num(R.sullenBelow, 25)) live.happiness = _clamp(h - _num(R.sullenMood, 1.5), 0, 100);
        else if (e.loyalty > _num(R.contentAbove, 70)) live.happiness = _clamp(h + _num(R.contentMood, 0.5), 0, 100);
        if (e.loyalty < _num(R.riotBelow, 20) && _roll(world, 'riot', e.id, day) < _num(R.riotChance, 0.25)) {
            live.happiness = _clamp(_num(live.happiness, 50) - _num(R.riotMood, 5), 0, 100);
            Estates.record(world, { key: `es:riot:${e.id}:${day}`, kind: 'riot', why: 'rent', day, place: live.name, q: live.q, r: live.r, kingdomId: live.kingdom != null ? live.kingdom : null, estate: e.name, holder: 'you', own: true });
            out.notices.push({ icon: '🔥', title: 'Rent Riot', text: `Your tenants at ${e.name} near ${live.name} have risen over the rent: hedges torn, the bailiff beaten. Lower the rent or take it in kind.`, type: 'error' });
        }
        if (strike) out.notices.push({ icon: '✊', title: 'Rent Strike', text: `The tenants of ${e.name} near ${live.name} withheld this month's rent.`, type: 'warning' });
    },

    /** The town the displaced go to: the nearest of its size or larger (any, failing one), within 14 hexes. */
    _refuge(world, live, bigger = true) {
        let best = null, bd = Infinity;
        const views = Estates._views(world);
        for (const s of views) {
            if (s.q === live.q && s.r === live.r) continue;
            if (Math.abs(s.r - live.r) > 14) continue;
            const d = Hex.wrappingDistance(s.q, s.r, live.q, live.r, world.width);
            if (d > 14) continue;
            const rank = _num(RANK[s.type]) - _num(RANK[live.type]);
            const score = d + (bigger && rank < 0 ? 100 : 0);
            if (score < bd) { bd = score; best = s; }
        }
        return best ? Estates._live(world, best.q, best.r) || null : null;
    },

    /** A town changed realm: the old crown's and nobles' estates pass to the new crown; the player's may be confiscated. */
    _conquest(world, player, rec, live, oldKid, newKid, day, out) {
        const st = world.estates;
        const W = Estates.config().war;
        const k = Estates.kingdom(world, newKid);
        for (const id of rec.ests) {
            const e = st.estates[id];
            if (!e) continue;
            const kind = Estates.kindOf(e.holder);
            const h = Estates.holder(world, e.holder);
            let take = false;
            if ((kind === 'crown' || kind === 'noble') && h && oldKid != null && String(h.kid) === String(oldKid)) take = true;
            if (kind === 'player' && player && k) {
                const rep = _num(player.reputation && player.reputation[k.id]);
                if (rep < _num(W.confiscateBelow, -20) || RealmWars.atWarWith(player, k.id)) take = true;
            }
            if (!take) continue;
            const to = k ? `crown:${k.id}` : `town:${rec.q}:${rec.r}`;
            const from = Estates.holderName(world, e.holder);
            if (kind === 'player') {
                LandMarket.playerState(player).stats.confiscated++;
                out.notices.push({ icon: '⚖️', title: 'Estate Confiscated', text: `${k ? k.name : 'The new masters'} took ${live.name}, and with it your estate of ${e.name}.`, type: 'error' });
                LandMarket._log(player, world, `${e.name} near ${live.name} was confiscated by ${k ? k.name : 'the new masters'}.`);
            }
            LandMarket._setHolder(world, e, to, day);
            Estates.record(world, { key: `es:conf:${e.id}:${day}`, kind: 'confiscated', day, place: live.name, q: live.q, r: live.r, kingdomId: newKid, estate: e.name, holder: from, buyer: Estates.holderName(world, to), own: kind === 'player' });
        }
    },

    _setHolder(world, e, to, day) {
        Estates.setHolder(world, e, to);
        e.since = day;
        if (to !== 'player') { e.rent = 'customary'; e.mode = 'coin'; }
        const st = world.estates;
        st.sales = st.sales.filter(x => x.id !== e.id);
    },

    /** A holder's month: its rents spent (nobles by their extravagance and the war levies), debts, distress sales. */
    _holderMonth(world, player, h, day, out) {
        const N = Estates.config().npc;
        const held = Estates.heldBy(world, h.id);
        const land = held.reduce((s, e) => s + (_num(e.value) || LandMarket.value(world, e)), 0);
        const P = N.purse || {};
        if (h.purse == null) {
            const r = _roll(world, 'purse', h.id, 0);
            const span = Array.isArray(P[h.kind]) ? P[h.kind] : [0.1, 0.3];
            h.purse = Math.round(h.kind === 'house' || h.kind === 'town' ? span[0] + r * (span[1] - span[0]) : land * (span[0] + r * (span[1] - span[0])));
        }
        const inc = _num(h.inc);
        h.inc = 0;
        if (h.kind === 'house') h.purse += _num(N.houseIncome, 4) * 30;
        if (h.kind === 'town') {
            const [, q, r] = String(h.id).split(':');
            const live = Estates._live(world, Number(q), Number(r));
            if (live) h.purse += _num(N.townIncome, 0.002) * _num(live.population) * 30;
        }
        let spend = inc * _num((N.spend || {})[h.kind], 0.85);
        if (h.kind === 'noble') {
            spend *= 1 + _num(N.extravagance, 0.3) * (2 * _roll(world, 'spend', h.id, day) - 1);
            const k = Estates.kingdom(world, h.kid);
            if (k && Array.isArray(k.wars) && k.wars.length) spend += inc * _num(N.warLevy, 0.15);
        }
        h.purse -= spend;
        if (h.debt > 0) {
            h.debt *= 1 + _num(N.debtRate, 0.01);
            const pay = Math.min(Math.max(0, h.purse), h.debt);
            h.purse -= pay;
            h.debt -= pay;
        }
        if (h.purse < 0) { h.debt = _num(h.debt) - h.purse; h.purse = 0; }
        h.purse = Math.round(h.purse);
        h.debt = Math.round(h.debt);
        // Deep in debt: the cheapest estate goes on the market
        const st = world.estates;
        if (held.length && h.debt > _num(N.distressAt, 0.25) * land && !st.sales.some(x => x.seller === h.id)) {
            const e = held.slice().sort((a, b) => _num(a.value) - _num(b.value))[0];
            LandMarket._list(world, e, Math.round(_num(e.value) * _num(N.distressPrice, 0.92)), h.id, 'debts', day);
        }
    },

    /** A crown deep in debt, or with an empty treasury at war, sells a crown estate now and then. */
    _crownMonth(world, k, day, out) {
        const N = Estates.config().npc;
        const id = `crown:${k.id}`;
        const st = world.estates;
        if (st.sales.some(x => x.seller === id)) return;
        const debt = Finance.crownDebt(k);
        const strained = debt > _num(N.crownSellAt, 0.8) * Finance.crownCapacity(k) || (Array.isArray(k.wars) && k.wars.length && _num(k.treasury) < 100);
        if (!strained || _roll(world, 'crownsell', k.id, day) >= _num(N.crownChance, 0.3)) return;
        const held = Estates.heldBy(world, id);
        if (!held.length) return;
        const e = held.slice().sort((a, b) => _num(a.value) - _num(b.value))[0];
        LandMarket._list(world, e, Math.round(_num(e.value) * _num(N.crownPrice, 0.95)), id, 'crown', day);
    },

    /** Put an estate on the market. */
    _list(world, e, price, seller, reason, day) {
        const st = world.estates;
        if (!e || !(price > 0) || st.sales.some(x => x.id === e.id)) return null;
        const N = Estates.config().npc;
        const x = { id: e.id, price, seller, reason, day, until: day + _num(N.relist, 30) };
        st.sales.push(x);
        return x;
    },

    /** The listings: after `wait` days the richest purse that can pay buys; unsold ones are cut, then withdrawn. */
    _sales(world, player, day, out) {
        const st = world.estates;
        if (!st.sales.length) return;
        const N = Estates.config().npc;
        for (const x of st.sales.slice()) {
            const e = st.estates[x.id];
            if (!e || e.holder !== x.seller) { st.sales = st.sales.filter(y => y !== x); continue; }
            if (day - x.day < _num(N.wait, 7) || (day - x.day) % 3 !== 0) continue;
            const buyer = LandMarket._buyer(world, e, x.price, x.seller, day);
            if (buyer) {
                buyer.purse = Math.round(_num(buyer.purse) - x.price);
                LandMarket._paySeller(world, player, x.seller, x.price, e, out);
                const live = Estates._liveOfKey(world, e.town);
                const from = Estates.holderName(world, x.seller);
                LandMarket._setHolder(world, e, buyer.id, day);
                Estates.record(world, {
                    key: `es:sold:${e.id}:${day}`, kind: 'sold', why: x.reason, day, place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null,
                    kingdomId: live && live.kingdom != null ? live.kingdom : null, estate: e.name, holder: from, buyer: buyer.name, price: x.price, own: x.seller === 'player',
                });
                continue;
            }
            if (day >= x.until) {
                x.price = Math.round(x.price * _num(N.relistCut, 0.92));
                x.until = day + _num(N.relist, 30);
                if (x.price < _num(N.withdrawAt, 0.65) * _num(e.value)) st.sales = st.sales.filter(y => y !== x);
            }
        }
    },

    /** Who buys: the richest purse of a house, the town's burghers, a noble of the realm or (now and then) the church. */
    _buyer(world, e, price, seller, day) {
        const st = world.estates;
        const live = Estates._liveOfKey(world, e.town);
        const kid = live && live.kingdom != null ? String(live.kingdom) : null;
        const townId = `town:${String(e.town).replace(',', ':')}`;
        let best = null;
        for (const h of Object.values(st.holders)) {
            if (!h || h.id === seller || h.purse == null || _num(h.purse) < price || _num(h.debt) > 0) continue;
            if (h.kind === 'noble' && String(h.kid) !== String(kid)) continue;
            if (h.kind === 'town' && h.id !== townId) continue;
            if (h.kind === 'church' && (String(h.kid) !== String(kid) || _roll(world, 'church', e.id, day) >= _num(Estates.config().npc.churchBuys, 0.3))) continue;
            if (h.kind === 'player' || h.kind === 'crown') continue;
            if (!best || h.purse > best.purse || (h.purse === best.purse && h.id < best.id)) best = h;
        }
        return best;
    },

    /** The price reaches the seller: a crown's treasury, the player's purse (Ledger), an NPC's purse. */
    _paySeller(world, player, seller, price, e, out) {
        const kind = Estates.kindOf(seller);
        if (kind === 'crown') {
            const k = Estates.kingdom(world, String(seller).slice(6));
            if (k) k.treasury = _num(k.treasury) + price;
        } else if (kind === 'player') {
            if (player) {
                player.gold = _num(player.gold) + price;
                Ledger.record(player, 'estatesSold', price);
                const ps = LandMarket.playerState(player);
                ps.stats.sold++;
                ps.stats.received += price;
                LandMarket._log(player, world, `Sold ${e.name} for ${price}g.`);
                out.notices.push({ icon: '🌾', title: 'Estate Sold', text: `${e.name} has found a buyer: ${price}g.`, type: 'success' });
            }
        } else {
            const h = Estates.ensureHolder(world, seller);
            h.purse = Math.round(_num(h.purse) + price);
        }
    },

    /** The peace: a realm that lost a war may cede its best crown estate to the victor's crown. */
    _warTerms(world, player, day, out) {
        const st = world.estates;
        const hist = Array.isArray(world.warHistory) ? world.warHistory : [];
        if (st.warSeq == null) { st.warSeq = _num(world.warHistorySeq, hist.length ? hist[hist.length - 1].id : 0); return; }
        const W = Estates.config().war;
        for (const w of hist) {
            if (!w || !(w.id > st.warSeq)) continue;
            st.warSeq = w.id;
            if (w.victor == null) continue;
            const loserId = String(w.victor) === String(w.a) ? w.b : w.a;
            const victor = Estates.kingdom(world, w.victor);
            if (!victor || victor.isAlive === false) continue;
            if (_roll(world, 'cede', w.id, loserId) >= _num(W.cedeChance, 0.5)) continue;
            const held = Estates.heldBy(world, `crown:${loserId}`);
            if (!held.length) continue;
            const e = held.slice().sort((a, b) => _num(b.value) - _num(a.value))[0];
            const live = Estates._liveOfKey(world, e.town);
            const from = Estates.holderName(world, e.holder);
            LandMarket._setHolder(world, e, `crown:${victor.id}`, day);
            Estates.record(world, { key: `es:cede:${e.id}:${day}`, kind: 'ceded', day, place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null, kingdomId: victor.id, estate: e.name, holder: from, buyer: victor.name, own: false });
        }
    },

    /** The year's turn (at sowing): marl wears off; bequests to the church, dowries between noble houses, enclosures where wool is dear. */
    _year(world, player, day, out) {
        const C = Estates.config();
        const N = C.npc;
        const st = world.estates;
        const Y = Math.floor(day / YEAR);
        const wear = _num((C.works.marl || {}).wear, 0.02);
        for (const e of Object.values(st.estates)) {
            if (e.marl > 0) {
                const w = Math.min(e.marl, wear);
                e.marl = _r2(e.marl - w);
                e.soil = _r2(Math.max(0.5, _num(e.soil, 1) - w));
                Estates.bumpTown(world, e.town);
            }
        }
        // Bequests: a noble with two or more estates leaves one to the church
        const nobles = Object.values(st.holders).filter(h => h.kind === 'noble');
        for (const h of nobles) {
            const held = Estates.heldBy(world, h.id);
            if (held.length < 2 || _roll(world, 'bequest', h.id, Y) >= _num(N.bequest, 0.05)) continue;
            const e = held.slice().sort((a, b) => _num(a.value) - _num(b.value))[0];
            const live = Estates._liveOfKey(world, e.town);
            LandMarket._setHolder(world, e, `church:${h.kid != null ? h.kid : 'free'}`, day);
            Estates.record(world, { key: `es:beq:${e.id}:${Y}`, kind: 'bequest', day, place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null, kingdomId: h.kid, estate: e.name, holder: h.name, buyer: Estates.holderName(world, e.holder), own: false });
        }
        // Dowries: in each realm now and then a noble estate passes to another house
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || _roll(world, 'dowry', k.id, Y) >= _num(N.dowry, 0.25)) continue;
            const mine = nobles.filter(h => String(h.kid) === String(k.id));
            if (mine.length < 2) continue;
            const from = mine[Math.floor(_roll(world, 'dowryFrom', k.id, Y) * mine.length)];
            const to = mine.filter(h => h !== from)[Math.floor(_roll(world, 'dowryTo', k.id, Y) * (mine.length - 1))];
            const held = Estates.heldBy(world, from.id);
            if (!to || !held.length) continue;
            const e = held[Math.floor(_roll(world, 'dowryEst', k.id, Y) * held.length)];
            const live = Estates._liveOfKey(world, e.town);
            LandMarket._setHolder(world, e, to.id, day);
            Estates.record(world, { key: `es:dowry:${e.id}:${Y}`, kind: 'dowry', day, place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null, kingdomId: k.id, estate: e.name, holder: from.name, buyer: to.name, own: false });
        }
        // Enclosures: nobles and houses turn fields to sheep where wool is dear and grain cheap
        for (const e of Object.values(st.estates)) {
            const kind = Estates.kindOf(e.holder);
            if ((kind !== 'noble' && kind !== 'house') || e.enclosed > 0) continue;
            const live = Estates._liveOfKey(world, e.town);
            if (!live || !live.market) continue;
            const wool = Estates.priceAt(live, 'wool') / Math.max(0.01, Estates.basePrice('wool'));
            const grain = Estates.priceAt(live, 'grain') / Math.max(0.01, Estates.basePrice('grain'));
            if (wool * wool < _num(N.woolAbove, 1.3) || grain * grain >= _num(N.grainBelow, 1.0)) continue;
            if (_roll(world, 'enclose', e.id, Y) >= _num(N.npcEnclose, 0.12)) continue;
            LandMarket._enclose(world, null, e, live, day, out, false);
        }
    },

    /** Enclose an estate: its fields go to sheep, most of its households leave, perhaps a riot. */
    _enclose(world, player, e, live, day, out, own) {
        const C = Estates.config();
        const W = C.works.enclose || {};
        const hhSize = Math.max(1, _num(C.derive.householdSize, 5));
        const before = Estates.households(world, e, live);
        e.enclosed = 1;
        Estates.bumpTown(world, e.town);
        const after = Estates.households(world, e, live);
        const leave = Math.max(0, before - after) * hhSize;
        const dest = LandMarket._refuge(world, live, true);
        const moved = dest && leave > 0 ? TownLabour.moveStratum(live, dest, 'peasants', leave) : 0;
        e.hh = Estates.households(world, e, live);
        e.loyalty = Math.round(_clamp(_num(e.loyalty, 55) - _num(C.rent.enclosureHit, 15), 0, 100));
        const chance = _clamp((60 - _num(e.loyalty, 55)) / 60, _num(W.riotMin, 0.1), _num(W.riotMax, 0.9));
        const riot = _roll(world, 'enclRiot', e.id, day) < chance;
        const place = live.name;
        const holder = Estates.holderName(world, e.holder);
        Estates.record(world, { key: `es:encl:${e.id}:${day}`, kind: 'enclosure', day, place, q: live.q, r: live.r, kingdomId: live.kingdom != null ? live.kingdom : null, estate: e.name, holder, n: Math.round(moved / hhSize), to: dest ? dest.name : null, own: !!own });
        if (riot) {
            live.happiness = _clamp(_num(live.happiness, 50) - _num(C.rent.riotMood, 5) - 1, 0, 100);
            Estates.record(world, { key: `es:riot:${e.id}:${day}`, kind: 'riot', why: 'enclosure', day, place, q: live.q, r: live.r, kingdomId: live.kingdom != null ? live.kingdom : null, estate: e.name, holder, own: !!own });
        }
        if (own && out) {
            out.notices.push({ icon: '🐑', title: riot ? 'Enclosure Riot' : 'Fields Enclosed', type: riot ? 'error' : 'info',
                text: `${e.name} is hedged and runs sheep now${moved ? `: ${Math.round(moved / hhSize)} households left for ${dest.name}` : ''}.${riot ? ' The cottagers tore down the hedges and the town is in uproar.' : ''}` });
        }
        return { moved, riot, dest };
    },

    // ── The player's day ──────────────────────────────────

    _playerDay(world, player, day, out) {
        const mine = Estates.heldBy(world, 'player');
        for (const e of mine) {
            const w = e.works;
            if (!w || day < _num(w.until)) continue;
            e.works = null;
            const live = Estates._liveOfKey(world, e.town);
            const W = Estates.config().works;
            const smax = _num(W.soilMax, 1.3);
            if (w.kind === 'drain') { e.drained = true; e.soil = _r2(Math.min(smax, _num(e.soil, 1) + _num(W.drain.soil, 0.1))); }
            else if (w.kind === 'marl') { const add = Math.min(_num(W.marl.soil, 0.06), smax - _num(e.soil, 1)); e.marl = _r2(_num(e.marl) + Math.max(0, add)); e.soil = _r2(_num(e.soil, 1) + Math.max(0, add)); }
            else if (w.kind === 'enclose' && live) { LandMarket.playerState(player).stats.enclosed++; LandMarket._enclose(world, player, e, live, day, out, true); }
            else if (w.kind === 'relet') e.enclosed = 0;
            Estates.bumpTown(world, e.town);
            const label = (W[w.kind] || {}).label || w.kind;
            out.notices.push({ icon: '🌾', title: 'Estate Works Done', text: `${label} at ${e.name}: done.`, type: 'success' });
            LandMarket._log(player, world, `${label} at ${e.name}: done.`);
        }
        // Landed gentry: a little Prestige a month
        if (mine.length && day % 30 === 0 && player.house) {
            const H = Estates.config().holding || {};
            House.award(player.house, Math.min(_num(H.prestigeMax, 3), mine.length * _num(H.prestige, 1)), 'landed estates', day);
        }
    },

    // ── The player's dealings ─────────────────────────────

    /** The player's estates. */
    mine(player, world) {
        return Estates.heldBy(world, 'player');
    },

    /** The listing of an estate on the market, or null. */
    listing(world, id) {
        const st = world && _obj(world.estates);
        return st ? st.sales.find(x => x.id === id) || null : null;
    },

    /** Listings within `radius` hexes of (q, r) (all when radius is null): [{ x, e, live, dist }]. */
    listingsNear(world, q, r, radius = 20) {
        const st = world && _obj(world.estates);
        if (!st) return [];
        const out = [];
        for (const x of st.sales) {
            const e = st.estates[x.id];
            const live = e ? Estates._liveOfKey(world, e.town) : null;
            if (!e || !live) continue;
            const d = q == null ? 0 : Hex.wrappingDistance(q, r, live.q, live.r, world.width);
            if (radius != null && d > radius) continue;
            out.push({ x, e, live, dist: d });
        }
        return out.sort((a, b) => a.dist - b.dist || a.x.price - b.x.price);
    },

    /**
     * What it would cost the player to buy an estate: the listing's price or
     * the holder's ask, plus the crown's duty. → { ok, reason, price, duty, cost, value, listed }.
     */
    buyQuote(player, world, id) {
        const st = Estates.state(world);
        const e = st.estates[id];
        if (!e) return { ok: false, reason: 'No such estate.' };
        if (e.holder === 'player') return { ok: false, reason: 'It is yours already.' };
        const live = Estates._liveOfKey(world, e.town);
        if (!live) return { ok: false, reason: 'The town is gone.' };
        const V = Estates.config().value;
        const value = LandMarket.value(world, e, live);
        const x = LandMarket.listing(world, id);
        let price;
        if (x) price = x.price;
        else {
            const kind = Estates.kindOf(e.holder);
            const prem = (V.premium || {})[kind];
            if (prem == null) return { ok: false, reason: kind === 'church' ? 'The Church never sells its land.' : 'Not for sale.', value };
            if (kind === 'crown') {
                const rep = _num(player && player.reputation && player.reputation[live.kingdom]);
                if (rep < _num(V.crownRep, 10)) return { ok: false, reason: `The crown sells its demesne only to those it trusts (reputation ${_num(V.crownRep, 10)}).`, value };
            }
            const h = Estates.holder(world, e.holder);
            const distressed = h && _num(h.debt) > 0;
            price = Math.round(value * prem * (distressed ? _num(V.distressAsk, 0.95) : 1));
        }
        if (!(price > 0)) return { ok: false, reason: 'The estate yields nothing to sell.', value };
        const duty = live.kingdom != null ? Math.round(price * _num(V.duty, 0.03)) : 0;
        return { ok: true, price, duty, cost: price + duty, value, listed: !!x, estate: e, town: live };
    },

    /** Buy an estate (a listing at its price, or the holder's ask). */
    buy(player, world, id) {
        const q = LandMarket.buyQuote(player, world, id);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.cost) return { success: false, reason: `It costs ${q.cost}g with the crown's duty; you have ${Math.floor(_num(player.gold))}g.` };
        const e = q.estate;
        const seller = e.holder;
        const day = _day(world);
        player.gold -= q.cost;
        Ledger.record(player, 'estatesBought', -q.cost);
        if (q.duty > 0) {
            const k = Estates.kingdom(world, q.town.kingdom);
            if (k) k.treasury = _num(k.treasury) + q.duty;
        }
        LandMarket._paySeller(world, player, seller, q.price, e, { notices: [] });
        const from = Estates.holderName(world, seller);
        LandMarket._setHolder(world, e, 'player', day);
        e.paid = q.cost;
        e.earned = 0;
        e.bought = day;
        const ps = LandMarket.playerState(player);
        ps.stats.bought++;
        ps.stats.spent += q.cost;
        LandMarket._log(player, world, `Bought ${e.name} near ${q.town.name} from ${from} for ${q.price}g (+${q.duty}g duty).`);
        Estates.record(world, { key: `es:sold:${e.id}:${day}`, kind: 'sold', why: 'player', day, place: q.town.name, q: q.town.q, r: q.town.r, kingdomId: q.town.kingdom != null ? q.town.kingdom : null, estate: e.name, holder: from, buyer: player.name || 'a newcomer', price: q.price, own: true });
        return { success: true, text: `${e.name} is yours: ${e.hh} tenant households, ${Math.round(LandMarket.annualRent(world, e, q.town))}g a year in rents expected.`, cost: q.cost };
    },

    /** What a quick sale would fetch now (the richest buyer who can pay), and the listing price otherwise. */
    sellQuote(player, world, id) {
        const st = Estates.state(world);
        const e = st.estates[id];
        if (!e || e.holder !== 'player') return { ok: false, reason: 'That estate is not yours.' };
        const V = Estates.config().value;
        const value = LandMarket.value(world, e);
        const quick = Math.round(value * _num(V.quickSale, 0.9));
        const buyer = quick > 0 ? LandMarket._buyer(world, e, quick, 'player', _day(world)) : null;
        return { ok: value > 0, reason: value > 0 ? null : 'It would fetch nothing.', value, quick, buyer: buyer ? buyer.name : null, list: Math.round(value * _num(V.listAsk, 0.95)), listed: !!LandMarket.listing(world, id) };
    },

    /** Sell: to the richest buyer now at the quick price, or put it on the market at the asking price. */
    sell(player, world, id, how = 'quick') {
        const q = LandMarket.sellQuote(player, world, id);
        if (!q.ok) return { success: false, reason: q.reason };
        const st = world.estates;
        const e = st.estates[id];
        const day = _day(world);
        if (how === 'withdraw') {
            st.sales = st.sales.filter(x => x.id !== id);
            return { success: true, text: `${e.name} is off the market.` };
        }
        if (how === 'list') {
            if (q.listed) return { success: false, reason: 'It is on the market already.' };
            LandMarket._list(world, e, q.list, 'player', 'player', day);
            return { success: true, text: `${e.name} is on the market at ${q.list}g.` };
        }
        const buyer = LandMarket._buyer(world, e, q.quick, 'player', day);
        if (!buyer) return { success: false, reason: 'No buyer about has the purse for it: put it on the market instead.' };
        buyer.purse = Math.round(_num(buyer.purse) - q.quick);
        const out = { notices: [] };
        LandMarket._paySeller(world, player, 'player', q.quick, e, out);
        LandMarket._setHolder(world, e, buyer.id, day);
        const live = Estates._liveOfKey(world, e.town);
        Estates.record(world, { key: `es:sold:${e.id}:${day}`, kind: 'sold', why: 'player', day, place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null, kingdomId: live && live.kingdom != null ? live.kingdom : null, estate: e.name, holder: player.name || 'you', buyer: buyer.name, price: q.quick, own: true });
        return { success: true, text: `${buyer.name} bought ${e.name} for ${q.quick}g.`, gold: q.quick };
    },

    /** Set an estate's rent: level ('low' | 'customary' | 'high') and/or mode ('coin' | 'kind'). */
    setRent(player, world, id, level = null, mode = null) {
        const e = Estates.estate(world, id);
        if (!e || e.holder !== 'player') return { success: false, reason: 'That estate is not yours.' };
        const L = Estates.config().rent.levels;
        if (level != null) {
            if (!L[level]) return { success: false, reason: 'No such rent.' };
            e.rent = level;
        }
        if (mode != null) {
            if (mode !== 'coin' && mode !== 'kind') return { success: false, reason: 'Rent is paid in coin or in kind.' };
            e.mode = mode;
        }
        return { success: true, text: `${e.name}: ${L[e.rent].label.toLowerCase()} rent, ${e.mode === 'kind' ? 'a share of the crop' : 'in coin'}.` };
    },

    /** The cost and days of an improvement on an estate: { ok, reason, cost, days, label }. */
    worksQuote(player, world, id, kind) {
        const e = Estates.estate(world, id);
        if (!e || e.holder !== 'player') return { ok: false, reason: 'That estate is not yours.' };
        const W = Estates.config().works;
        const w = W[kind];
        if (!_obj(w) || !w.label) return { ok: false, reason: 'No such works.' };
        if (e.works) return { ok: false, reason: `${(W[e.works.kind] || {}).label || 'Works'} are under way until day ${e.works.until}.` };
        if (kind === 'drain' && e.drained) return { ok: false, reason: 'The fields are drained already.' };
        if (kind === 'marl' && _num(e.marl) >= _num(w.again, 0.03)) return { ok: false, reason: 'The marl is still in the soil.' };
        if ((kind === 'drain' || kind === 'marl') && _num(e.soil, 1) >= _num(W.soilMax, 1.3)) return { ok: false, reason: 'The soil is as good as it gets.' };
        if ((kind === 'drain' || kind === 'marl' || kind === 'enclose') && e.enclosed > 0) return { ok: false, reason: 'The estate runs sheep.' };
        if (kind === 'relet' && !(e.enclosed > 0)) return { ok: false, reason: 'The estate is let to tenants already.' };
        const live = Estates._liveOfKey(world, e.town);
        const hh = kind === 'relet' ? Math.round(Estates.peasants(live) * _num(Estates.config().derive.estateShare, 0.6) * e.share / Math.max(1, _num(Estates.config().derive.householdSize, 5))) : Estates.households(world, e, live);
        const cost = Math.max(_num(w.min, 30), Math.round(_num(w.perHousehold, 5) * hh));
        return { ok: true, cost, days: Math.max(1, Math.round(_num(w.days, 15))), label: w.label, hh };
    },

    /** Start an improvement (drain, marl, enclose, relet): paid now, the hands' wages to the town. */
    improve(player, world, id, kind) {
        const q = LandMarket.worksQuote(player, world, id, kind);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.cost) return { success: false, reason: `${q.label} costs ${q.cost}g.` };
        const e = Estates.estate(world, id);
        const live = Estates._liveOfKey(world, e.town);
        player.gold -= q.cost;
        Ledger.record(player, 'estateWorks', -q.cost);
        if (live) {
            const econ = live.economy || (live.economy = { gold: 0, food: 0, goods: 0 });
            econ.gold = _num(econ.gold) + Math.round(q.cost * _num(Estates.config().works.wageShare, 0.8));
        }
        e.works = { kind, until: _day(world) + q.days, cost: q.cost };
        e.spent = _num(e.spent) + q.cost;
        LandMarket.playerState(player).stats.works++;
        return { success: true, text: `${q.label} at ${e.name}: ${q.cost}g, done by day ${e.works.until}.` };
    },

    /** Settle an estate on a realm's nobility as a dowry: standing there and Prestige for the House. */
    dowry(player, world, id, kid) {
        const e = Estates.estate(world, id);
        if (!e || e.holder !== 'player') return { success: false, reason: 'That estate is not yours.' };
        const k = Estates.kingdom(world, kid);
        if (!k || k.isAlive === false) return { success: false, reason: 'No such realm.' };
        const D = Estates.config().dowry;
        const value = LandMarket.value(world, e);
        const nobles = Object.values(world.estates.holders).filter(h => h.kind === 'noble' && String(h.kid) === String(k.id));
        const n = Math.max(1, Math.floor(_num(Estates.config().derive.nobles, 4)));
        const to = nobles.length ? nobles[(Utils.hashStr(`${e.id}:${_day(world)}`) >>> 0) % nobles.length].id : `noble:${k.id}:${(Utils.hashStr(e.id) >>> 0) % n}`;
        const rep = Math.min(_num(D.maxRep, 25), Math.round(value / Math.max(1, _num(D.perRep, 150))));
        const pres = Math.min(_num(D.maxPrestige, 10), Math.round(value / Math.max(1, _num(D.perPrestige, 500))));
        if (!player.reputation) player.reputation = {};
        player.reputation[k.id] = _num(player.reputation[k.id]) + rep;
        if (player.house && pres > 0) House.award(player.house, pres, `${e.name} settled as a dowry in ${k.name}`, _day(world));
        const live = Estates._liveOfKey(world, e.town);
        LandMarket._setHolder(world, e, to, _day(world));
        LandMarket.playerState(player).stats.dowries++;
        Estates.record(world, { key: `es:dowry:${e.id}:${_day(world)}`, kind: 'dowry', day: _day(world), place: live ? live.name : e.town, q: live ? live.q : null, r: live ? live.r : null, kingdomId: k.id, estate: e.name, holder: player.name || 'you', buyer: Estates.holderName(world, to), own: true });
        return { success: true, text: `${e.name} is settled on ${Estates.holderName(world, to)} as a dowry: +${rep} reputation in ${k.name}${pres ? `, +${pres} Prestige` : ''}.` };
    },

    /** Summary of the player's land: { n, value, rent (a year), paid, earned, yield }. */
    summary(player, world) {
        const mine = LandMarket.mine(player, world);
        let value = 0, rent = 0, paid = 0, earned = 0;
        for (const e of mine) {
            value += LandMarket.value(world, e);
            rent += LandMarket.annualRent(world, e);
            paid += _num(e.paid);
            earned += _num(e.earned);
        }
        return { n: mine.length, value: Math.round(value), rent: Math.round(rent), paid: Math.round(paid), earned: Math.round(earned), yield: paid > 0 ? rent / paid : null };
    },

    // ── The Steward's Counsel ─────────────────────────────

    /** An estate on the market within reach, at no more than its value, that the player can afford. */
    saleTip(player, world) {
        if (!player || !world || !_obj(world.estates)) return null;
        const K = Estates.config().counsel || {};
        let best = null;
        for (const { x, e, live, dist } of LandMarket.listingsNear(world, player.q, player.r, _num(K.saleRadius, 12))) {
            if (x.seller === 'player') continue;
            const value = LandMarket.value(world, e, live);
            if (!(value > 0) || x.price > value * _num(K.bargainAt, 1) || x.price * 1.04 > _num(player.gold)) continue;
            if (!best || x.price / value < best.ratio) best = { ratio: x.price / value, x, e, live, dist, value };
        }
        return best;
    },

    /** The player's restless tenants: [{ e, live }] under restlessBelow loyalty or in arrears. */
    restless(player, world) {
        const K = Estates.config().counsel || {};
        return LandMarket.mine(player, world).filter(e => _num(e.loyalty, 55) < _num(K.restlessBelow, 30) || _num(e.arrears) > 0)
            .map(e => ({ e, live: Estates._liveOfKey(world, e.town) })).filter(x => x.live);
    },
};

function _roll(world, ...parts) {
    return Estates.roll(`${Estates.seed(world)}:${parts.join(':')}`);
}
