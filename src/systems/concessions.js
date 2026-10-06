// ============================================
// CONCESSIONS — the hinterland's day, mining leases and prospecting
// ============================================
// Drives world/hinterland.js (the rural sites around the towns) and lets
// the player and the NPC merchant houses lease the crown's deposits:
//
//   - THE DAY. On each town's market day (before MarketDynamics.updatePrices,
//     so the town's trades and works take the goods up the same turn) its
//     rural sites dig, draw down their deposits and send their goods to
//     market: half to the home settlement, half to the market town. An empty
//     mine closes (its miners leave for the nearest town, its towns go
//     short); every `every` days each town is searched for a new vein (a
//     hash roll: a waning mine is renewed or a new deposit opened, and
//     miners come in from the next town).
//   - CONCESSIONS. A crown leases its deposits. Every `auctionEvery` days
//     each realm puts one up for `auctionDays`; the player may also petition
//     for a lease on a deposit beside the town they stand in. Bids are
//     escrowed; at the close the merchant houses bid their estimate of the
//     term's net (a hash roll and their temperament), the highest bid wins
//     and the fee goes into the realm's treasury. A holder digs `boost` × the
//     crown's rate at the pace it sets (light, steady, hard — hard digs more,
//     wastes more of the vein, risks accidents and sours the town), hires
//     its hands at the home town's land wage (extra land jobs there), pays a
//     royalty on every unit to the crown, and sells into the market town at
//     its price there or delivers to its own works nearby (their own store,
//     SettlementMarket.feedWorks).
//   - REVOCATION. War with the realm, a default on its lenders
//     (systems/finance.js), arrears past the grace days, a conquest of the
//     town, or a royal edict (a crown in crisis; a realm the player rules may
//     revoke a house's lease) end a lease; so do its term and an empty vein.
//   - PROSPECTING. The player may fund a search near a town: a strike gives
//     the finder's right to lease it at the reserve price before the houses
//     may bid.
//
// Deterministic: draws no RNG (hash rolls of the world seed, the day and the
// site). State on world.hinterland (saved by systems/saveLoad.js); tuned in
// data/hinterland.json; balance in docs/economy-balance.md.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Hinterland } from '../world/hinterland.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { MerchantPrince } from './merchantPrince.js';
import { MerchantHouses } from './merchantHouses.js';
import { Finance } from './finance.js';
import { Throne } from './throne.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => _num(world && world.day);
const _roll = (k) => Hinterland.roll(k);
let _cfg = null;
let _cfgFor = null;

const DEFAULTS = {
    termDays: 240, royalty: 0.12, boost: 1.3, sellShare: 0.85, reserveShare: 0.07,
    rates: { normal: { label: 'Steady', out: 1, wear: 1, hands: 1, accident: 0, unrest: 0 } },
    accident: { killed: [2, 6], idleDays: 6, mood: 3, reputation: 2 },
    contractRange: 6, binDays: 20, auctionEvery: 30, auctionDays: 10, houseBid: [0.1, 0.22], houseMax: 3, minIncrement: 0.05,
    graceDays: 14, defaultDays: 60, edictChance: 0.05, logCap: 30,
};

function _town(world, key) {
    if (!key || key === 'none') return null;
    const [q, r] = key.split(',').map(Number);
    const t = world.getTile(q, r);
    return t && t.settlement ? t.settlement : null;
}

export const Concessions = {
    // ── Config ─────────────────────────────────────────────

    config() {
        const H = Hinterland.config();
        if (_cfgFor === H && _cfg) return _cfg;
        const c = H.concessions || {};
        _cfgFor = H;
        _cfg = { ...DEFAULTS, ...c, rates: { ...DEFAULTS.rates, ...(c.rates || {}) }, accident: { ...DEFAULTS.accident, ...(c.accident || {}) } };
        return _cfg;
    },

    rate(id) {
        const R = Concessions.config().rates;
        return R[id] || R.normal;
    },

    basePrice(goodId) {
        const g = PlayerEconomy.GOODS && PlayerEconomy.GOODS[String(goodId).toUpperCase()];
        return g && g.basePrice > 0 ? g.basePrice : 0;
    },

    goodName(goodId) {
        const g = PlayerEconomy.GOODS && PlayerEconomy.GOODS[String(goodId).toUpperCase()];
        return g ? g.name : String(goodId).replace(/_/g, ' ');
    },

    // ── Readers ───────────────────────────────────────────

    /** A concession by id, or null. */
    get(world, id) {
        const st = world && _obj(world.hinterland);
        return st && Array.isArray(st.concessions) ? st.concessions.find(c => c.id === id) || null : null;
    },

    /** The live concession on a site, or null. */
    onSite(world, site) {
        if (!site || !site.c) return null;
        const c = Concessions.get(world, site.c);
        return c && c.status === 'active' ? c : null;
    },

    /** The player's active concessions: [{ c, site, home, market, yield, reserve }]. */
    mine(player, world) {
        const st = world && _obj(world.hinterland);
        const out = [];
        for (const c of (st && Array.isArray(st.concessions)) ? st.concessions : []) {
            if (c.holder !== 'player' || c.status !== 'active') continue;
            const site = Hinterland.site(world, c.site);
            out.push({ c, site, home: site ? _town(world, site.h) : null, market: site ? _town(world, site.m) : null,
                yield: Hinterland.yieldOf(site), reserve: Hinterland.reserveFrac(site), daysLeft: Hinterland.daysLeft(site) });
        }
        return out;
    },

    /** Open auctions, optionally in one realm. */
    auctions(world, kingdomId = null) {
        const st = world && _obj(world.hinterland);
        return ((st && Array.isArray(st.auctions)) ? st.auctions : []).filter(a => a.status === 'open' && (kingdomId == null || a.kingdomId === kingdomId));
    },

    /** Open auctions of sites within `radius` hexes of (q, r): [{ a, site, dist }]. */
    auctionsNear(world, q, r, radius = 10) {
        const out = [];
        for (const a of Concessions.auctions(world)) {
            const site = Hinterland.site(world, a.site);
            if (!site) continue;
            const d = Hex.wrappingDistance(site.q, site.r, q, r, world.width);
            if (d <= radius) out.push({ a, site, dist: d });
        }
        return out.sort((x, y) => x.dist - y.dist);
    },

    /** The realm that owns a site (its home town's), or null. */
    realmOf(world, site) {
        const home = site ? _town(world, site.h) : null;
        return home && home.kingdom && typeof world.getKingdom === 'function' ? world.getKingdom(home.kingdom) || null : null;
    },

    /** Can the crown lease this site (a leasable deposit, open, in a realm, not held or on auction)? */
    leasable(world, site) {
        const k = site && Hinterland.kind(site.kind);
        if (!k || !k.leasable || site.st !== 'open') return false;
        if (Concessions.onSite(world, site)) return false;
        return !!Concessions.realmOf(world, site);
    },

    /**
     * What a lease of the site is worth over a term at a rate: { perDay (its
     * first good, at today's yield and a holder's boost), gross (gold a day
     * at the market town's prices today), wages, royalty (on base prices),
     * net, term, cap (share of the term the reserve lasts), reserve price }.
     */
    estimate(world, site, rateId = 'normal') {
        const C = Concessions.config();
        const k = Hinterland.kind(site && site.kind);
        if (!k) return null;
        const rt = Concessions.rate(rateId);
        const home = _town(world, site.h);
        const y = Hinterland.yieldOf(site);
        const mult = y * _num(C.boost, 1.3) * _num(rt.out, 1);
        // (priced at what the market town pays today: a glutted market is worth less)
        const market = _town(world, site.m) || home;
        let gross = 0, units = 0;
        for (const [g, per] of Object.entries(k.good)) {
            gross += per * mult * Concessions.basePrice(g) * (market ? SettlementMarket.scarcity(market, g) : 1);
            if (g === k.first) units = per * mult;
        }
        const term = Math.max(1, _num(C.termDays, 240));
        const wage = home ? TownLabour.baseWage(home.type, 'land') : 0.4;
        const hands = Math.round(k.hands * _num(rt.hands, 1));
        const wages = hands * wage;
        let atBase = 0;
        for (const [g, per] of Object.entries(k.good)) atBase += per * mult * Concessions.basePrice(g);
        const royalty = atBase * _num(C.royalty, 0.12);
        // (a deposit can't give more than is left in it over the term)
        const cap = k.deposit ? _clamp(_num(site.res) / Math.max(0.01, units * term * _num(rt.wear, 1)), 0, 1) : 1;
        const net = gross * _num(C.sellShare, 0.85) - wages - royalty;
        const reserve = Math.max(50, Math.round(gross * term * cap * _num(C.reserveShare, 0.07) / 10) * 10);
        return { perDay: units, gross, wages, royalty, net, term, cap, hands, reserve, kind: k };
    },

    /** What the player may do about a site here: { ok, reason, est, auction, finder, minBid }. */
    leaseQuote(player, world, siteId) {
        const site = Hinterland.site(world, siteId);
        if (!site) return { ok: false, reason: 'No such site.' };
        const k = Hinterland.kind(site.kind);
        const est = Concessions.estimate(world, site);
        const auction = Concessions.auctions(world).find(a => a.site === site.id) || null;
        const out = { ok: false, reason: '', site, kind: k, est, auction };
        if (!k || !k.leasable) return { ...out, reason: `The crown does not lease ${k ? k.name.toLowerCase() + 's' : 'it'}.` };
        if (site.st !== 'open') return { ...out, reason: 'The workings are exhausted.' };
        const held = Concessions.onSite(world, site);
        if (held) return { ...out, reason: held.holder === 'player' ? 'You hold this lease.' : `${held.holderName} holds the lease until day ${held.end}.` };
        const realm = Concessions.realmOf(world, site);
        if (!realm) return { ...out, reason: 'No crown claims it to lease.' };
        const home = _town(world, site.h);
        if (MerchantPrince.hostile(player, world, home)) return { ...out, reason: `${realm.name} will not lease to an enemy.` };
        if (Concessions._defaulted(player, world, realm.id)) return { ...out, reason: `${realm.name}'s lenders name you a defaulter: no lease until you make it good.` };
        const C = Concessions.config();
        const finder = !!(auction && auction.finder === 'player');
        const cur = auction ? Math.max(auction.reserve, _num(auction.bid)) : est.reserve;
        const minBid = auction && auction.bid > 0 ? Math.ceil(cur * (1 + _num(C.minIncrement, 0.05))) : cur;
        return { ...out, ok: true, finder, minBid, realm };
    },

    // ── Bidding ───────────────────────────────────────────

    _here(player, world, site) {
        const t = player && world.getTile(player.q, player.r);
        const s = t && t.settlement;
        if (!s) return null;
        const key = _key(player.q, player.r);
        return key === site.h || key === site.m ? s : null;
    },

    _escrow(player, world, a, fee, out) {
        const add = fee - _num(a.bid);
        if (add > _num(player.gold)) return { success: false, reason: `You need ${add} gold for the bond on your bid.` };
        player.gold -= add;
        a.bid = fee;
        a.bidDay = _day(world);
        return { success: true, spent: add, ...out };
    },

    /**
     * Petition the crown for a lease on a deposit beside the town you stand
     * in: an auction opens with your bid (escrowed) and closes in auctionDays.
     */
    petition(player, world, siteId, fee = null) {
        const q = Concessions.leaseQuote(player, world, siteId);
        if (!q.ok) return { success: false, reason: q.reason };
        if (!Concessions._here(player, world, q.site)) return { success: false, reason: 'Petition the crown\'s officers in the town beside the workings.' };
        if (q.auction) return Concessions.bid(player, world, q.auction.id, fee == null ? q.minBid : fee);
        const bid = Math.max(q.minBid, Math.round(_num(fee, q.minBid)));
        const a = Concessions._openAuction(world, q.site, q.realm, null);
        const res = Concessions._escrow(player, world, a, bid, { auction: a });
        if (!res.success) {
            const st = Hinterland.state(world);
            st.auctions = st.auctions.filter(x => x !== a);
            return res;
        }
        Concessions._log(world, `Petitioned ${q.realm.name} for the lease of the ${q.kind.name.toLowerCase()} near ${_town(world, q.site.h).name}: bid ${bid}g.`);
        return res;
    },

    /** Bid on an open auction (raise your escrowed bid to `fee`). Stand in a town of the realm. */
    bid(player, world, auctionId, fee) {
        const a = Concessions.auctions(world).find(x => x.id === auctionId);
        if (!a) return { success: false, reason: 'That auction has closed.' };
        const q = Concessions.leaseQuote(player, world, a.site);
        if (!q.ok) return { success: false, reason: q.reason };
        const t = world.getTile(player.q, player.r);
        if (!t || !t.settlement || t.settlement.kingdom !== a.kingdomId) return { success: false, reason: 'Bid at the crown\'s offices in one of its towns.' };
        const want = Math.round(_num(fee, q.minBid));
        if (want < q.minBid) return { success: false, reason: `The least bid is ${q.minBid} gold.` };
        const res = Concessions._escrow(player, world, a, want, { auction: a });
        if (res.success) Concessions._log(world, `Bid ${want}g for the ${q.kind.name.toLowerCase()} lease near ${_town(world, q.site.h).name}.`);
        return res;
    },

    _openAuction(world, site, realm, finder) {
        const st = Hinterland.state(world);
        const C = Concessions.config();
        const day = _day(world);
        const est = Concessions.estimate(world, site);
        const a = {
            id: `A${st.seq++}`, site: site.id, kingdomId: realm.id, realm: realm.name, opens: day,
            closes: day + Math.max(1, finder ? _num(Hinterland.config().prospect.finderDays, 20) : _num(C.auctionDays, 10)),
            reserve: est.reserve, royalty: _num(C.royalty, 0.12), term: _num(C.termDays, 240), bid: 0, finder: finder || null, status: 'open',
        };
        st.auctions.push(a);
        return a;
    },

    /** The bidders for concessions: the player's rival houses when there is a company, else the houses of the realm. */
    houses(player, world) {
        const active = player ? MerchantHouses.activeRivals(player) : [];
        const defs = active.length ? active : (MerchantHouses.data().rivalHouses || []);
        const seed = Hinterland.seed(world);
        return defs.map(d => ({ id: d.id, name: d.name, icon: d.icon || '⚖️', bid: _num(MerchantHouses.temperament(d).bid, 1), rival: active.includes(d) ? d : null }))
            .sort((a, b) => (Utils.hashStr(`${seed}:${a.id}`) >>> 0) - (Utils.hashStr(`${seed}:${b.id}`) >>> 0));
    },

    /** Close an auction: the houses bid, the highest wins; the player's escrow becomes the fee or comes back. */
    _close(world, player, a, out) {
        const st = Hinterland.state(world);
        const C = Concessions.config();
        const day = _day(world);
        a.status = 'closed';
        const site = Hinterland.site(world, a.site);
        const realm = typeof world.getKingdom === 'function' ? world.getKingdom(a.kingdomId) : null;
        const homeT = site ? _town(world, site.h) : null;
        const where = homeT ? homeT.name : 'the workings';
        const refund = () => {
            if (a.bid > 0 && player) {
                player.gold += a.bid;
                Concessions._log(world, `Your ${a.bid}g bond on the lease near ${where} comes back.`);
            }
        };
        if (!site || site.st !== 'open' || !realm || realm.isAlive === false || Concessions.onSite(world, site)) { refund(); a.winner = null; return; }
        const est = Concessions.estimate(world, site);
        let best = null;
        if (a.finder !== 'player') {
            const [lo, hi] = Array.isArray(C.houseBid) ? C.houseBid : [0.1, 0.22];
            const held = {};
            for (const c of st.concessions) if (c.status === 'active' && c.holder !== 'player') held[c.holder] = _num(held[c.holder]) + 1;
            for (const h of Concessions.houses(player, world)) {
                if (_num(held[h.id]) >= _num(C.houseMax, 3)) continue;
                const share = lo + _roll(`hl:bid:${Hinterland.seed(world)}:${a.id}:${h.id}`) * Math.max(0, hi - lo);
                const fee = Math.round(Math.max(0, est.net) * est.term * est.cap * share * h.bid);
                if (fee < a.reserve) continue;
                if (!best || fee > best.fee) best = { h, fee };
            }
        }
        const playerWins = a.bid > 0 && a.bid >= a.reserve && (!best || a.bid >= best.fee);
        if (playerWins) {
            const c = Concessions._grant(world, site, realm, 'player', 'you', a.bid, a);
            Concessions._log(world, `Won the lease of the ${Hinterland.kind(site.kind).name.toLowerCase()} near ${_town(world, site.h).name} for ${a.bid}g (until day ${c.end}).`);
            out.notices.push({ icon: '⛏️', title: 'Concession Won', text: `${realm.name} grants you the ${Hinterland.kind(site.kind).name.toLowerCase()} near ${_town(world, site.h).name} for ${a.term} days: ${a.bid}g paid, ${Math.round(a.royalty * 100)}% royalty on every unit dug.`, type: 'success' });
            a.winner = 'player';
            a.price = a.bid;
            return;
        }
        if (a.bid > 0) {
            refund();
            if (best) out.notices.push({ icon: best.h.icon, title: 'Outbid', text: `${best.h.name} outbids you (${best.fee}g) for the lease near ${_town(world, site.h).name}. Your bond comes back.`, type: 'warning' });
        }
        if (best) {
            Concessions._grant(world, site, realm, best.h.id, best.h.name, best.fee, a);
            a.winner = best.h.id;
            a.price = best.fee;
        } else a.winner = null;
    },

    _grant(world, site, realm, holder, holderName, fee, a) {
        const st = Hinterland.state(world);
        const day = _day(world);
        const c = {
            id: `C${st.seq++}`, site: site.id, kingdomId: realm.id, realm: realm.name, holder, holderName,
            fee, royalty: _num(a.royalty, 0.12), start: day, end: day + _num(a.term, 240), rate: 'normal', outlet: null,
            status: 'active', owed: 0, owedSince: null, dug: 0, revenue: 0, wages: 0, royalties: 0, net: 0, accidents: 0, lastNet: 0,
        };
        st.concessions.push(c);
        site.c = c.id;
        site.hire = Math.round(Hinterland.kind(site.kind).hands * _num(Concessions.rate('normal').hands, 1));
        realm.treasury = _num(realm.treasury) + fee;
        // Keep the record list bounded: old, ended leases fall off
        const ended = st.concessions.filter(x => x.status !== 'active');
        if (ended.length > 60) {
            const drop = new Set(ended.slice(0, ended.length - 60));
            st.concessions = st.concessions.filter(x => !drop.has(x));
        }
        return c;
    },

    // ── Running a lease ───────────────────────────────────

    _mine(player, world, concId) {
        const c = Concessions.get(world, concId);
        if (!c || c.holder !== 'player' || c.status !== 'active') return null;
        return c;
    },

    /** Set the pace: 'light', 'normal' or 'hard'. */
    setRate(player, world, concId, rateId) {
        const c = Concessions._mine(player, world, concId);
        if (!c) return { success: false, reason: 'No such lease.' };
        if (!Concessions.config().rates[rateId]) return { success: false, reason: 'No such pace.' };
        c.rate = rateId;
        const site = Hinterland.site(world, c.site);
        if (site) site.hire = Math.round(Hinterland.kind(site.kind).hands * _num(Concessions.rate(rateId).hands, 1));
        return { success: true };
    },

    /**
     * Where the output goes: null (sold into the market town) or one of your
     * works within contractRange that uses it: { q, r, recipe }.
     */
    outlets(player, world, c) {
        const site = c && Hinterland.site(world, c.site);
        const k = site && Hinterland.kind(site.kind);
        if (!k) return [];
        const C = Concessions.config();
        const st = _obj(player && player.merchantPrince);
        const out = [];
        for (const inv of (st && Array.isArray(st.investments)) ? st.investments : []) {
            const ins = SettlementMarket.recipeGoods(inv.recipe, 'in');
            if (!Object.keys(k.good).some(g => g in ins)) continue;
            if (Hex.wrappingDistance(site.q, site.r, inv.q, inv.r, world.width) > _num(C.contractRange, 6)) continue;
            out.push({ q: inv.q, r: inv.r, recipe: inv.recipe, town: inv.town });
        }
        return out;
    },

    setOutlet(player, world, concId, outlet = null) {
        const c = Concessions._mine(player, world, concId);
        if (!c) return { success: false, reason: 'No such lease.' };
        if (!outlet) { c.outlet = null; return { success: true }; }
        const ok = Concessions.outlets(player, world, c).find(o => o.q === outlet.q && o.r === outlet.r && o.recipe === outlet.recipe);
        if (!ok) return { success: false, reason: 'You have no works nearby that use it.' };
        c.outlet = { q: ok.q, r: ok.r, recipe: ok.recipe, town: ok.town };
        return { success: true };
    },

    /** Give the lease back to the crown (no refund). */
    surrender(player, world, concId) {
        const c = Concessions._mine(player, world, concId);
        if (!c) return { success: false, reason: 'No such lease.' };
        Concessions._end(world, c, 'surrendered');
        Concessions._log(world, `Gave the lease near ${c.realm} back to the crown.`);
        return { success: true };
    },

    /** A realm the player rules revokes a house's lease by edict. */
    revokeByEdict(player, world, concId) {
        const c = Concessions.get(world, concId);
        if (!c || c.status !== 'active') return { success: false, reason: 'No such lease.' };
        if (c.holder === 'player') return Concessions.surrender(player, world, concId);
        const ruled = Throne.ruledKingdom(player, world);
        if (!ruled || ruled.id !== c.kingdomId) return { success: false, reason: 'Only the crown of the realm may revoke it.' };
        Concessions._end(world, c, 'edict');
        Concessions._log(world, `By your edict ${c.holderName} lose their lease in ${c.realm}.`);
        return { success: true };
    },

    _end(world, c, why) {
        c.status = why;
        c.endedDay = _day(world);
        const site = Hinterland.site(world, c.site);
        if (site && site.c === c.id) { site.c = null; site.hire = 0; }
    },

    /** Has the player defaulted on the realm's lenders lately (systems/finance.js)? */
    _defaulted(player, world, kingdomId) {
        const f = player && _obj(player.finance);
        if (!f) return false;
        if (_obj(f.wanted) && f.wanted[kingdomId]) return true;
        const days = _num(Concessions.config().defaultDays, 60);
        const day = _day(world);
        return (Array.isArray(f.history) ? f.history : []).some(h => h && h.kind === 'player_default' && h.kingdomId === kingdomId && day - _num(h.day) <= days);
    },

    // ── Prospecting ───────────────────────────────────────

    /** Can the player fund a search near the town on `tile`? → { ok, reason, cost, days, chance }. */
    prospectQuote(player, world, tile) {
        const P = Hinterland.config().prospect;
        const s = tile && tile.settlement;
        const out = { ok: false, reason: '', cost: _num(P.cost, 160), days: _num(P.days, 8), chance: _num(P.playerChance, 0.6) };
        if (!s) return { ...out, reason: 'Stand in a town to send prospectors out.' };
        const st = Hinterland.state(world);
        if (st.prospects.some(p => p.q === tile.q && p.r === tile.r && p.status === 'digging')) return { ...out, reason: 'Your prospectors are already out here.' };
        if (!Hinterland.prospectHexes(world, s).length) return { ...out, reason: `There are no hills or mountains near ${s.name} left to search.` };
        if (_num(player.gold) < out.cost) return { ...out, reason: `You need ${out.cost} gold.` };
        return { ...out, ok: true };
    },

    prospect(player, world, tile) {
        const q = Concessions.prospectQuote(player, world, tile);
        if (!q.ok) return { success: false, reason: q.reason };
        const st = Hinterland.state(world);
        player.gold -= q.cost;
        const p = { id: `P${st.seq++}`, q: tile.q, r: tile.r, town: tile.settlement.name, start: _day(world), due: _day(world) + q.days, cost: q.cost, status: 'digging' };
        st.prospects.push(p);
        const L = Concessions._ledger(world);
        L.prospecting = _num(L.prospecting) + q.cost;
        Concessions._log(world, `Sent prospectors into the hills around ${p.town} (${q.cost}g, ${q.days} days).`);
        return { success: true, spent: q.cost, prospect: p };
    },

    _prospectsDay(world, player, day, out) {
        const st = Hinterland.state(world);
        const P = Hinterland.config().prospect;
        for (const p of st.prospects) {
            if (p.status !== 'digging' || day < p.due) continue;
            const t = world.getTile(p.q, p.r);
            const town = t && t.settlement;
            const hit = town && _roll(`hl:pp:${Hinterland.seed(world)}:${p.id}`) < _num(P.playerChance, 0.6)
                ? Hinterland.strike(world, town, `hl:pp:${Hinterland.seed(world)}:${p.id}`, day, { newOnly: true, by: 'player' }) : null;
            p.status = hit ? 'struck' : 'dry';
            if (!hit) {
                out.notices.push({ icon: '⛏️', title: 'Dry Holes', text: `Your prospectors come back from the hills around ${p.town} with nothing but blisters.`, type: 'info' });
                continue;
            }
            p.site = hit.site.id;
            const k = Hinterland.kind(hit.site.kind);
            Concessions._newsStrike(world, town, hit, day, out, true);
            const realm = Concessions.realmOf(world, hit.site);
            if (realm && k.leasable) {
                const a = Concessions._openAuction(world, hit.site, realm, 'player');
                out.notices.push({ icon: k.icon, title: 'A Strike!', text: `Your prospectors strike a ${k.name.toLowerCase()} near ${p.town}. As its finder you may lease it from ${realm.name} at the reserve price (${a.reserve}g) until day ${a.closes}, before the merchant houses may bid.`, type: 'success' });
            } else {
                out.notices.push({ icon: k.icon, title: 'A Strike!', text: `Your prospectors strike a ${k.name.toLowerCase()} near ${p.town}. The townsfolk will work it.`, type: 'success' });
            }
        }
        if (st.prospects.length > 20) st.prospects = st.prospects.filter(p => p.status === 'digging').concat(st.prospects.filter(p => p.status !== 'digging').slice(-10));
    },

    // ── The day ───────────────────────────────────────────

    _ledger(world) {
        const st = Hinterland.state(world);
        return st.ledger;
    },

    _log(world, text) {
        const st = Hinterland.state(world);
        st.log.push({ day: _day(world), text });
        const cap = Math.max(5, _num(Concessions.config().logCap, 30));
        if (st.log.length > cap) st.log.splice(0, st.log.length - cap);
    },

    _newsStrike(world, town, hit, day, out, own = false) {
        const k = Hinterland.kind(hit.site.kind);
        const h = Hinterland.record(world, {
            key: `${hit.kind}:${hit.site.id}:${day}`, kind: hit.kind, place: town.name, site: k ? k.name : 'mine', good: k ? k.first : null,
            q: hit.site.q, r: hit.site.r, kingdomId: town.kingdom || null, own,
        });
        if (h) out.news.push(h);
        // Miners follow a new strike from the next town
        if (hit.kind === 'strike') {
            const from = Concessions._nearest(world, town);
            if (from) TownLabour.moveStratum(from, town, 'peasants', _num(Hinterland.config().prospect.strikeMigrants, 12), 60);
        }
    },

    /** The nearest other settlement to a town (for miners moving). */
    _nearest(world, town) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        let best = null, bestD = Infinity;
        for (const s of views) {
            if (s === town || (s.q === town.q && s.r === town.r)) continue;
            if (Math.abs(s.r - town.r) > 12) continue;
            const d = Hex.wrappingDistance(s.q, s.r, town.q, town.r, world.width);
            if (d < bestD) { best = world.getTile(s.q, s.r).settlement; bestD = d; }
        }
        return best;
    },

    /**
     * The hinterland's day (before MarketDynamics.updatePrices): the sites of
     * each town on its market day dig and deliver, leases are paid, veins
     * are struck; auctions open and close; leases end.
     * → { notices, news, income, wages, royalties, fees }
     */
    processDay(world, player = null) {
        const out = { notices: [], news: [], income: 0, wages: 0, royalties: 0, fees: 0 };
        if (!world || typeof world.getTile !== 'function') return out;
        const st = Hinterland.state(world);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        Hinterland.sync(world, day);
        const k = SettlementMarket.tickDays();
        const turn = ((day % k) + k) % k;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const P = Hinterland.config().prospect;
        const every = Math.max(1, Math.floor(_num(P.every, 60)));
        const seed = Hinterland.seed(world);
        const seedN = Utils.hashStr(`hl:off:${seed}`) >>> 0;
        for (const town of views) {
            if (k > 1 && SettlementMarket.slot(town.q, town.r) !== turn) continue;
            const tk = _key(town.q, town.r);
            for (const site of Hinterland.sitesOf(world, town.q, town.r)) Concessions._siteTurn(world, player, site, town, k, day, out);
            // The search for new veins (not on a town's first look)
            const off = (seedN + Math.abs(town.q) * 7919 + Math.abs(town.r) * 104729) % every;
            const bucket = Math.floor((day + off) / every);
            const was = st.prospected[tk];
            if (was !== bucket) {
                st.prospected[tk] = bucket;
                if (was != null && _roll(`hl:pros:${seed}:${tk}:${bucket}`) < _num(P.chance, 0.1)) {
                    const hit = Hinterland.strike(world, town, `hl:pros:${seed}:${tk}:${bucket}`, day);
                    if (hit) Concessions._newsStrike(world, town, hit, day, out);
                }
            }
        }
        Concessions._prospectsDay(world, player, day, out);
        Concessions._auctionsDay(world, player, day, out);
        Concessions._leasesDay(world, player, day, out);
        return out;
    },

    /** One market turn of a site: dig, draw down, deliver (and a lease's books). */
    _siteTurn(world, player, site, town, k, day, out) {
        const C = Concessions.config();
        const c = Concessions.onSite(world, site);
        const rt = c ? Concessions.rate(c.rate) : null;
        const mult = c ? _num(C.boost, 1.3) * _num(rt.out, 1) : 1;
        const res = Hinterland.output(world, site, town, k, day, mult);
        const kd = Hinterland.kind(site.kind);
        site.out = _r2(_num(res.goods[kd.first]) / Math.max(1, k));
        site.dug = _r2(res.dug);
        site.day = day;
        const gone = Hinterland.deplete(site, res.dug, c ? _num(rt.wear, 1) : 1);
        const market = _town(world, site.m) || town;
        if (c) Concessions._leaseTurn(world, player, c, site, kd, res.goods, town, market, k, day, out);
        else Hinterland.deliver(world, site, res.goods, town, market);
        if (gone === 'exhausted') Concessions._exhausted(world, player, site, town, day, out);
    },

    /** A lease's turn: sell (or deliver to the works), pay the hands and the royalty; accidents and unrest. */
    _leaseTurn(world, player, c, site, kd, goods, home, market, k, day, out) {
        const C = Concessions.config();
        const rt = Concessions.rate(c.rate);
        let revenue = 0, royalty = 0;
        const mt = world.getTile(market.q, market.r);
        let fed = null;
        const outlet = c.holder === 'player' && c.outlet ? world.getTile(c.outlet.q, c.outlet.r) : null;
        const works = outlet && outlet.settlement ? SettlementMarket.works(outlet.settlement, c.outlet.recipe) : null;
        for (const [g, units] of Object.entries(goods)) {
            if (!(units > 0) || !SettlementMarket.tracks(g)) continue;
            const base = Concessions.basePrice(g);
            royalty += units * base * _num(c.royalty, C.royalty);
            // To the holder's works first (their own store, up to binDays of runs)
            if (works && works.owner === 'player') {
                const per = _num(SettlementMarket.recipeGoods(c.outlet.recipe, 'in')[g]);
                if (per > 0) {
                    const took = SettlementMarket.feedWorks(outlet.settlement, c.outlet.recipe, g, units, per * _num(works.cap) * _num(C.binDays, 20));
                    fed = fed || {};
                    fed[g] = _num(fed[g]) + took;
                    // (what the store can't take is sold into that town's market)
                    if (units - took > 0) revenue += (units - took) * SettlementMarket.value(world, outlet.settlement, outlet, g, base, SettlementMarket.stock(outlet.settlement, g)) * _num(C.sellShare, 0.85);
                    continue;
                }
            }
            // Sold into the market town at what the lot is worth there (its scarcity curve)
            const s0 = SettlementMarket.stock(market, g);
            revenue += units * SettlementMarket.value(world, market, mt, g, base, s0 + units / 2) * _num(C.sellShare, 0.85);
            SettlementMarket.add(market, g, units);
        }
        const wage = home.labour && home.labour.wage ? _num(home.labour.wage.land, TownLabour.baseWage(home.type, 'land')) : TownLabour.baseWage(home.type, 'land');
        const hands = _num(site.hire);
        const wages = hands * wage * Math.max(1, k);
        const net = revenue - wages - royalty;
        c.dug = _r2(_num(c.dug) + _num(site.dug));
        c.revenue = Math.round(_num(c.revenue) + revenue);
        c.wages = Math.round(_num(c.wages) + wages);
        c.lastNet = Math.round(net);
        c.lastFed = fed;
        const realm = typeof world.getKingdom === 'function' ? world.getKingdom(c.kingdomId) : null;
        if (c.holder === 'player') {
            const L = Concessions._ledger(world);
            if (player) {
                let paid = royalty;
                if (net >= 0) {
                    const g = Math.floor(net);
                    player.gold += g;
                    out.income += g;
                } else {
                    // The hands and the crown are paid from the purse; what it can't cover is owed
                    const owe = Math.ceil(-net);
                    const can = Math.min(owe, Math.max(0, Math.floor(_num(player.gold))));
                    player.gold -= can;
                    out.wages += can;
                    if (owe > can) {
                        c.owed = _num(c.owed) + (owe - can);
                        if (c.owedSince == null) c.owedSince = day;
                        paid = Math.max(0, royalty - (owe - can));
                    }
                }
                // Arrears are settled first from a good turn
                if (c.owed > 0 && net > 0 && player.gold > 0) {
                    const pay = Math.min(c.owed, Math.floor(player.gold));
                    player.gold -= pay;
                    c.owed -= pay;
                    if (c.owed <= 0) { c.owed = 0; c.owedSince = null; }
                }
                c.royalties = Math.round(_num(c.royalties) + paid);
                if (realm) realm.treasury = _num(realm.treasury) + paid;
                out.royalties += paid;
                c.net = Math.round(_num(c.net) + net);
                L.revenue = Math.round(_num(L.revenue) + revenue);
                L.wages = Math.round(_num(L.wages) + wages);
                L.royalties = Math.round(_num(L.royalties) + paid);
                L.net = Math.round(_num(L.net) + net);
            }
        } else {
            c.royalties = Math.round(_num(c.royalties) + royalty);
            c.net = Math.round(_num(c.net) + net);
            if (realm) realm.treasury = _num(realm.treasury) + royalty;
            // A rival house's profit is its capital (systems/merchantHouses.js)
            const rival = player ? MerchantHouses.getRival(player, c.holder) : null;
            if (rival && rival.status === 'active') rival.capital = Math.max(0, _num(rival.capital) + net);
        }
        // Accidents in a pit worked hard; a hard pace sours the town
        if (_num(rt.accident) > 0 && _roll(`hl:acc:${Hinterland.seed(world)}:${c.id}:${day}`) < _num(rt.accident)) {
            const A = C.accident;
            const [lo, hi] = Array.isArray(A.killed) ? A.killed : [2, 6];
            const n = Math.round(lo + _roll(`hl:accn:${c.id}:${day}`) * Math.max(0, hi - lo));
            home.population = Math.max(10, _num(home.population) - n);
            home.happiness = _clamp(_num(home.happiness, 50) - _num(A.mood, 3), 0, 100);
            site.idle = day + _num(A.idleDays, 6);
            c.accidents = _num(c.accidents) + 1;
            const kd2 = Hinterland.kind(site.kind);
            const own = c.holder === 'player';
            const h = Hinterland.record(world, { key: `accident:${site.id}:${day}`, kind: 'accident', place: home.name, site: kd2.name, n, q: site.q, r: site.r, kingdomId: home.kingdom || null, own, holder: c.holderName });
            if (h) out.news.push(h);
            if (own && player) {
                if (home.kingdom) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[home.kingdom] = _clamp(_num(player.reputation[home.kingdom]) - _num(A.reputation, 2), -100, 100);
                }
                out.notices.push({ icon: '💥', title: 'Pit Accident', text: `A gallery falls in at your ${kd2.name.toLowerCase()} near ${home.name}: ${n} miners are killed and the pit stands idle for ${_num(A.idleDays, 6)} days. The town blames your pace.`, type: 'error' });
            }
        }
        if (_num(rt.unrest) > 0) home.happiness = _clamp(_num(home.happiness, 50) - _num(rt.unrest), 0, 100);
    },

    /** An empty mine closes: its lease ends, its miners leave for the nearest town, the news goes out. */
    _exhausted(world, player, site, town, day, out) {
        const c = Concessions.onSite(world, site);
        const k = Hinterland.kind(site.kind);
        if (c) {
            Concessions._end(world, c, 'exhausted');
            if (c.holder === 'player') out.notices.push({ icon: '🕳️', title: 'Worked Out', text: `Your ${k.name.toLowerCase()} near ${town.name} is worked out. The lease ends with it.`, type: 'warning' });
        }
        site.hire = 0;
        const to = Concessions._nearest(world, town);
        const n = Math.round(_num(Hinterland.config().prospect.exhaustMigrants, 1.5) * k.hands);
        let moved = 0;
        if (to && n > 0) moved = TownLabour.moveStratum(town, to, 'peasants', n, 60);
        const h = Hinterland.record(world, {
            key: `exhausted:${site.id}:${day}`, kind: 'exhausted', place: town.name, site: k.name, good: k.first, to: to ? to.name : null, n: moved,
            q: site.q, r: site.r, kingdomId: town.kingdom || null, own: !!(c && c.holder === 'player'),
        });
        if (h) out.news.push(h);
    },

    _auctionsDay(world, player, day, out) {
        const st = Hinterland.state(world);
        const C = Concessions.config();
        for (const a of st.auctions) if (a.status === 'open' && day >= a.closes) Concessions._close(world, player, a, out);
        // Each realm puts one deposit up every auctionEvery days (staggered by realm)
        const every = Math.max(1, Math.floor(_num(C.auctionEvery, 30)));
        const seed = Hinterland.seed(world);
        let byRealm = null;
        const offs = st._aucOff || (Object.defineProperty(st, '_aucOff', { value: new Map(), enumerable: false }), st._aucOff);
        for (const realm of world.kingdoms || []) {
            if (!realm || realm.isAlive === false) continue;
            let off = offs.get(realm.id);
            if (off === undefined) { off = (Utils.hashStr(`hl:auc:${seed}:${realm.id}`) >>> 0) % every; offs.set(realm.id, off); }
            if ((day + off) % every !== 0) continue;
            if (!byRealm) {
                byRealm = new Map();
                for (const site of Hinterland.sites(world)) {
                    if (!Concessions.leasable(world, site) || st.auctions.some(a => a.status === 'open' && a.site === site.id)) continue;
                    const home = _town(world, site.h);
                    const arr = byRealm.get(home.kingdom);
                    if (arr) arr.push(site); else byRealm.set(home.kingdom, [site]);
                }
            }
            const pool = (byRealm.get(realm.id) || []).map(s => ({ s, v: Concessions.estimate(world, s).net })).filter(x => x.v > 0)
                .sort((x, y) => y.v - x.v || (x.s.id < y.s.id ? -1 : 1)).slice(0, 3);
            if (!pool.length) continue;
            const pick = pool[Math.floor(_roll(`hl:aucp:${seed}:${realm.id}:${day}`) * pool.length) % pool.length].s;
            const a = Concessions._openAuction(world, pick, realm, null);
            const h = Hinterland.record(world, { key: `auction:${a.id}`, kind: 'auction', place: _town(world, pick.h).name, site: Hinterland.kind(pick.kind).name, q: pick.q, r: pick.r, kingdomId: realm.id, reserve: a.reserve, closes: a.closes });
            if (h) out.news.push(h);
        }
        if (st.auctions.length > 40) st.auctions = st.auctions.filter(a => a.status === 'open').concat(st.auctions.filter(a => a.status !== 'open').slice(-20));
    },

    /** Leases end: their term, war, a default, arrears, a conquest, a royal edict. */
    _leasesDay(world, player, day, out) {
        const st = Hinterland.state(world);
        const C = Concessions.config();
        const weekly = day % 7 === 5;
        for (const c of st.concessions) {
            if (c.status !== 'active') continue;
            const site = Hinterland.site(world, c.site);
            const home = site ? _town(world, site.h) : null;
            const own = c.holder === 'player';
            const say = (title, text) => { if (own) out.notices.push({ icon: '📜', title, text, type: 'error' }); };
            if (!site || !home) { Concessions._end(world, c, 'lost'); continue; }
            if (day >= c.end) {
                Concessions._end(world, c, 'expired');
                if (own) out.notices.push({ icon: '📜', title: 'Lease Ended', text: `Your lease of the ${Hinterland.kind(site.kind).name.toLowerCase()} near ${home.name} has run its term. ${c.realm} will put it up again.`, type: 'info' });
                continue;
            }
            if (home.kingdom !== c.kingdomId) {
                Concessions._end(world, c, 'conquest');
                say('Lease Void', `${home.name} has new masters, and they do not honour ${c.realm}'s lease of the ${Hinterland.kind(site.kind).name.toLowerCase()}.`);
                continue;
            }
            if (!own) continue;
            if (MerchantPrince.hostile(player, world, home)) {
                Concessions._end(world, c, 'war');
                say('Lease Revoked', `${c.realm} is at war with you: its officers take back your ${Hinterland.kind(site.kind).name.toLowerCase()} near ${home.name}.`);
                continue;
            }
            if (Concessions._defaulted(player, world, c.kingdomId)) {
                Concessions._end(world, c, 'default');
                say('Lease Revoked', `You defaulted on ${c.realm}'s lenders: the crown takes back your ${Hinterland.kind(site.kind).name.toLowerCase()} near ${home.name}.`);
                continue;
            }
            if (c.owed > 0 && c.owedSince != null && day - c.owedSince > _num(C.graceDays, 14)) {
                Concessions._end(world, c, 'arrears');
                // (a forfeited lease is a missed payment on the player's credit, systems/finance.js)
                const f = player && _obj(player.finance);
                if (f && _obj(f.credit)) f.credit.missed = _num(f.credit.missed) + 1;
                say('Lease Forfeit', `You owe ${Math.ceil(c.owed)}g in wages and royalties at the ${Hinterland.kind(site.kind).name.toLowerCase()} near ${home.name}: ${c.realm} forfeits the lease.`);
                continue;
            }
            if (weekly && !MerchantPrince.inOwnRealm(player, world, home) && MerchantPrince.crownInCrisis(world, home)
                && _roll(`hl:edict:${Hinterland.seed(world)}:${c.id}:${day}`) < _num(C.edictChance, 0.05)) {
                Concessions._end(world, c, 'edict');
                say('Lease Revoked', `By royal edict ${c.realm}, its treasury empty, takes back your ${Hinterland.kind(site.kind).name.toLowerCase()} near ${home.name} to work it for the crown.`);
            }
        }
    },

    /** The player's ledger and leases for panels: { leases, ledger, log }. */
    summary(player, world) {
        const st = world && _obj(world.hinterland);
        return { leases: Concessions.mine(player, world), ledger: st ? { ...st.ledger } : {}, log: st && Array.isArray(st.log) ? st.log.slice(-10).reverse() : [] };
    },
};
