// ============================================================
// HAGGLING — face to face with a stall's keeper on the street map
// ============================================================
// At a staffed market stall (world/innerMap/stalls.js) the keeper names a
// price for a lot of their wares — or for a lot of yours they deal in — and
// the player counters, round by round, until they shake on it, the player
// walks away, or the keeper's patience runs out and they will not deal with
// the player again that day (kept on the townsperson's memory: the
// NpcDisposition memory is the person's own, settlement.folk).
//
// The asking price starts from the market's own (Trading.buyCost for a buy,
// the sale Trading.sellGoods would make for a sale) and is moved by:
//   - the keeper's mood and what they think of the player
//     (NpcDisposition.getPriceModifiers: disposition, traits, the player's
//     name and brand, a grudge or a kindness remembered),
//   - their margin, how much of the good the town has (a glut gives, a
//     dearth holds firm), the hour (the market's last hours sell cheaper,
//     perishables most), the tongue (a foreigner with no words is asked more
//     and cannot flatter or find fault),
//   - the player's Haggling against the keeper's, and their charisma.
//
// The keeper's walk-away price is hidden; every counter below it costs
// patience (a rude lowball twice over) and moves their ask a share of the way.
// Flattery, finding fault (talking up your own goods when selling) and
// scoffing are one try each a haggle, by the player's skills and the keeper's
// temper.
//
// The coin: a struck deal goes through the stall's own trade path
// (Trading.buyGoods / Trading.sellToStall) with the haggled total for that
// one transaction: the goods leave or join the town market's stock and the
// coin moves between the player and the town's purse exactly as a plain
// trade, to the cent. Every haggled price is held inside the market's
// buy-and-sell-back gap (bound): a haggled buy never under what selling the
// lot straight back would fetch plus a share of the gap, a haggled sale never
// over the sale price plus a smaller share of the gap to the buy-back — so no
// haggle, either way round, is a loop. Tuned in data/haggling.json.
//
// Randomness: the tactics' rolls draw from Utils (seedable); the lines are a
// hash of the keeper, the good and the round. No globals: player, world,
// settlement, keeper and hour are passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerEconomy, Trading } from './playerEconomy.js';
import { OddJobs } from './oddJobs.js';
import { Crafting } from './crafting.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { Languages } from '../systems/languages.js';
import { Underworld } from '../systems/underworld.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Fame } from '../systems/fame.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketStalls } from '../world/marketStalls.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { Cultures } from '../world/cultures.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Up to a whole cent (what a buyer pays). */
const _up = (x) => { const v = Number(x); return Number.isFinite(v) ? Math.ceil(v * 100 - 1e-7) / 100 : 0; };
const _down = (x) => Utils.centsDown(x);

function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const DEFAULT_CLOSE = 18;

export const Haggling = {
    config() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.haggling);
    },

    enabled() {
        return Haggling.config().enabled !== false;
    },

    // ── Who will haggle ─────────────────────────────────────

    /** The world day as a whole number. */
    _day(world) {
        return Math.floor(_num(world && world.day, 0));
    },

    /** Has this keeper sent the player away today? */
    spurned(npc, world) {
        if (!npc) return false;
        const mem = NpcDisposition.getMemory(npc);
        return mem.haggleSpurned != null && mem.haggleSpurned === Haggling._day(world);
    },

    /** Mark the keeper as done with the player for today (remembered on the townsperson). */
    spurn(npc, world) {
        if (!npc) return;
        const mem = NpcDisposition.getMemory(npc);
        mem.haggleSpurned = Haggling._day(world);
        mem.lastAction = 'haggle_spurned';
    },

    // ── What moves the price ────────────────────────────────

    /** The market's closing hour (data/townScenes.json market.close). */
    closeHour() {
        const m = _obj(_obj(DataLoader._gamedata && DataLoader._gamedata.townScenes).market);
        return _num(m.close, DEFAULT_CLOSE);
    },

    /** 0 through the market day, rising to 1 over its last hours (and after close). */
    lateness(hour, close = Haggling.closeHour()) {
        const h = _num(hour, 10);
        const span = Math.max(0.5, _num(_obj(Haggling.config().late).hours, 2.5));
        return _clamp((h - (close - span)) / span, 0, 1);
    },

    /** Food spoils: the keeper would rather sell it cheap at dusk than carry it home. */
    perishable(goodId) {
        return Seasons.priceGroup(goodId) === 'food';
    },

    /**
     * The tongue of the haggle: { lang, value 0-100, via, share (of the words
     * heard), words (can flatter, find fault, scoff) }.
     */
    tongue(player, world, settlement) {
        const lang = Languages.settlementLanguage(world, settlement);
        const c = Languages.comprehension(player, lang);
        const W = _obj(Haggling.config().words);
        const words = c.value >= _num(W.need, 40);
        return {
            lang, value: c.value, via: c.via, words,
            share: c.via === 'translator' || c.value >= 80 ? 1 : _clamp((c.value - 10) / 70, 0, 1),
        };
    },

    _traitSum(npc, table) {
        let s = 0;
        for (const t of (npc && npc.personalityTraits) || []) s += _num(_obj(table)[t]);
        return s;
    },

    _good(goodId) {
        return PlayerEconomy.GOODS[String(goodId || '').toUpperCase()] || null;
    },

    _name(goodId) {
        const g = Haggling._good(goodId);
        return String((g && g.name) || String(goodId).replace(/_/g, ' ')).toLowerCase();
    },

    _kingdom(settlement) {
        return settlement && settlement.kingdom != null ? settlement.kingdom : null;
    },

    /** The stall's market entry for a good (Common grade): Trading.stallGoods. */
    _entry(ctx) {
        const list = Trading.stallGoods(ctx.settlement, ctx.tile || null, ctx.world || null, ctx.tradeId);
        return list.find(g => g.id === ctx.goodId) || null;
    },

    /** Units of a good the stall has in its Common lot. */
    _commonQty(entry) {
        if (!entry) return 0;
        return Math.max(0, Math.floor(entry.lots ? _num(entry.lots.common) : _num(entry.quantity)));
    },

    /**
     * What selling `qty` straight back would fetch once the buy has taken them
     * (the stock lower, the price higher): the sale at today's stock, by the
     * scarcity the lot leaves.
     */
    _sellBackAfterBuy(player, good, settlement, world, qty) {
        const sale = Trading.saleUnitPrice(player, good, settlement, world, 1, qty) * qty;
        if (!(settlement && settlement.market && SettlementMarket.tracks(good.id))) return sale;
        const s0 = SettlementMarket.stock(settlement, good.id);
        let now = 0, after = 0;
        for (let j = 0; j < qty; j++) {
            now += SettlementMarket.scarcity(settlement, good.id, s0 + j);
            after += SettlementMarket.scarcity(settlement, good.id, Math.max(0, s0 - qty + j));
        }
        return now > 0 ? sale * Math.max(1, after / now) : sale;
    },

    /**
     * The market's price for the lot and the economy's bound on any haggle:
     * buy → { list, bound (the least it may go for) }; sell → { list, bound
     * (the most it may fetch), purse }. Or { error }.
     */
    market(ctx) {
        const { player, world, settlement, goodId, side } = ctx;
        const qty = Math.max(1, Math.floor(_num(ctx.qty, 1)));
        const good = Haggling._good(goodId);
        if (!good) return { error: 'No such goods.' };
        const B = _obj(Haggling.config().bound);
        if (side === 'buy') {
            const entry = ctx.entry || Haggling._entry(ctx);
            if (!entry) return { error: `Nothing of that on the stall today.` };
            if (Haggling._commonQty(entry) < qty) return { error: `Not that many ${Haggling._name(goodId)} on the stall.` };
            const blocked = Trading.monopolyBlock(settlement, goodId, player);
            if (blocked) return { error: blocked };
            const list = Trading.buyCost(player, entry, qty, settlement);
            if (!(list > 0)) return { error: 'They will not price it.' };
            const back = Haggling._sellBackAfterBuy(player, good, settlement, world, qty);
            const share = _clamp(_num(B.buyGapShare, 0.35), 0, 1);
            const bound = Math.min(list, Math.max(_up(back + 0.01), _up(back + share * Math.max(0, list - back))));
            return { list, bound, entry, qty };
        }
        // Selling: what the town market would pay (Trading.sellGoods), its checks first
        if (!MarketStalls.accepts(ctx.tradeId, goodId)) {
            const t = MarketStalls.trade(ctx.tradeId);
            return { error: `The ${String((t && t.name) || 'stall').toLowerCase()} doesn't deal in ${Haggling._name(goodId)}.` };
        }
        if (good.noMarket) return { error: `No stall buys ${Haggling._name(goodId)}.` };
        if (_num(player && player.inventory && player.inventory[goodId]) < qty) return { error: 'You have not got that many.' };
        const blocked = Trading.monopolyBlock(settlement, goodId, player);
        if (blocked) return { error: blocked };
        const legality = Underworld.legalSaleCheck(player, goodId, qty, settlement, world);
        if (!legality.ok) return { error: legality.reason };
        const policy = TradePolicy.saleCheck(player, world, settlement, goodId, qty);
        if (!policy.ok) return { error: policy.reason };
        const quality = Crafting.saleMult(player, goodId, qty, null);
        const list = Math.floor(Trading.saleUnitPrice(player, good, settlement, world, legality.priceMult * policy.mult, qty) * qty * quality);
        if (!(list > 0)) return { error: 'They will not give you a coin for it.' };
        const capUnit = Trading.saleUnitCap(player, goodId, settlement, world, null, qty);
        const share = _clamp(_num(B.sellGapShare, 0.3), 0, 1);
        let bound = Number.isFinite(capUnit)
            ? _down(list + share * Math.max(0, capUnit * qty - list))
            : _down(list * _num(B.noCapSell, 1.08));
        bound = Math.max(list, bound);
        // ...and never more than the town's purse can pay with the duty and toll inside it
        const purse = Economy.townPurse(settlement);
        if (purse != null) {
            const outlay = Trading.saleOutlay(player, settlement, goodId, list, policy);
            const ratio = list > 0 && outlay > 0 ? outlay / list : 1;
            bound = Math.min(bound, _down(purse / ratio));
            if (bound < list) return { error: `The merchants of ${settlement.name || 'this town'} have only ${Math.floor(purse)} gold to spend.` };
        }
        return { list, bound, qty, quality };
    },

    /**
     * The keeper's opening: { ask, floor (their hidden walk-away), factors:
     * [{ label, pct }] } — for a sale `ask` is their bid and `floor` the most
     * they will pay.
     */
    quote(ctx, mk = null) {
        const C = Haggling.config();
        const M = _obj(C.margin), G = _obj(C.give);
        const m = mk || Haggling.market(ctx);
        if (m.error) return { error: m.error };
        const { player, world, settlement, npc, goodId, side } = ctx;
        const pm = NpcDisposition.getPriceModifiers(npc, { player, world, kingdomId: Haggling._kingdom(settlement) });
        if (pm.refuses) return { error: pm.refuseReason, refuses: true };
        const info = settlement ? SettlementMarket.info(settlement, goodId) : { scarcity: 1 };
        const scarcity = _num(info.scarcity, 1);
        const late = Haggling.lateness(ctx.hour, ctx.close != null ? ctx.close : Haggling.closeHour());
        const perish = Haggling.perishable(goodId);
        const tongue = ctx.tongue || Haggling.tongue(player, world, settlement);
        const factors = [];
        const note = (label, frac) => { const pct = Math.round(frac * 100); if (pct) factors.push({ label, pct }); };

        // Their margin over the market's price
        let margin = _num(M.base, 0.12);
        note('Their margin', margin);
        const sc = _clamp((scarcity - 1) * _num(M.scarcity, 0.1), -_num(M.scarcityCap, 0.06), _num(M.scarcityCap, 0.06));
        margin += sc;
        if (sc) note(sc > 0 ? 'Scarce in town' : 'Plenty in town', sc);
        const lateCut = late * _num(M.late, 0.08) * (side === 'buy' ? 1 : -0.5);
        margin -= lateCut;
        if (lateCut) note(side === 'buy' ? 'End of the market day' : 'Late to be buying', -lateCut);
        const foreign = tongue.via === 'translator' ? 0 : (1 - tongue.share) * _num(M.foreign, 0.06);
        margin += foreign;
        if (foreign >= 0.005) note('A foreigner\'s price', foreign);

        // How far they will give
        let give = _num(G.base, 0.1);
        const glut = (side === 'buy' ? 1 - scarcity : scarcity - 1) * _num(G.glut, 0.1);
        const gc = Array.isArray(G.glutCap) ? G.glutCap : [-0.05, 0.08];
        give += _clamp(glut, gc[0], gc[1]);
        if (side === 'buy') give += late * (perish ? _num(G.latePerishable, 0.15) : _num(G.late, 0.06));
        else give -= late * (perish ? _num(G.late, 0.06) : 0);
        const lvl = SocialSkills.has('haggling') ? SocialSkills.level(player, 'haggling') : 1;
        const kLvl = SocialSkills.has('haggling') ? SocialSkills.npcLevel(npc, 'haggling', world) : 1;
        const edge = _clamp((lvl - kLvl) * _num(G.skillPerLevel, 0.01), -_num(G.skillCap, 0.05), _num(G.skillCap, 0.05));
        give += edge;
        if (Math.round(edge * 100)) note(`Your Haggling ${lvl} vs their ${kLvl}`, -edge);
        const cha = (_num(player && player.charisma, 5) - 5) * _num(G.charismaPerPoint, 0.006);
        give += cha;
        give += Haggling._traitSum(npc, G.traits);
        give = _clamp(give, 0, 0.5);
        margin = _clamp(margin, 0, 0.5);

        // Their mood and your name (NpcDisposition): on everything they say
        for (const r of pm.reasons || []) factors.push({ label: r.label, pct: r.pct });
        const mood = side === 'buy' ? pm.buy : pm.sell;

        let ask, floor;
        if (side === 'buy') {
            floor = Math.max(m.bound, _up(m.list * (1 - give) * mood));
            ask = Math.max(_up(floor * 1.02), _up(m.list * (1 + margin) * mood));
        } else {
            floor = Math.min(m.bound, _down(m.list * (1 + give) * mood));
            ask = Math.min(_down(floor * 0.98), _down(m.list * (1 - margin) * mood));
            ask = Math.max(0.01, ask);
        }
        return { ask, floor, give, margin, factors, late, tongue, scarcity, list: m.list, bound: m.bound, level: lvl, keeperLevel: kLvl, mood };
    },

    /** The keeper's patience for this haggle (rounds before they lose their temper). */
    patience(npc, tongue) {
        const P = _obj(Haggling.config().patience);
        const d = _num(NpcDisposition.getMemory(npc).disposition, 50);
        let p = _num(P.base, 4) + Math.round((d - 50) / Math.max(1, _num(P.perDisposition, 20)));
        p += Haggling._traitSum(npc, P.traits);
        if (tongue && !tongue.words) p += _num(P.noWords, -1);
        return _clamp(Math.round(p), _num(P.min, 1), _num(P.max, 7));
    },

    // ── The haggle ──────────────────────────────────────────

    /**
     * Open a haggle. ctx: { player, world, settlement, tile, npc (the keeper),
     * tradeId, goodId, side: 'buy' | 'sell', qty, hour }.
     * → { ok, session, reply } or { ok: false, reason }
     */
    start(ctx) {
        if (!Haggling.enabled()) return { ok: false, reason: 'Nobody haggles here.' };
        const { npc, settlement } = ctx;
        if (!npc || !settlement || !MarketStalls.trade(ctx.tradeId)) return { ok: false, reason: 'There is nobody minding the stall.' };
        if (settlement.inKind) return { ok: false, reason: 'They barter here, goods for goods: no coin to haggle over.' };
        if (Haggling.spurned(npc, ctx.world)) return { ok: false, reason: `${npc.name || 'The keeper'} won't deal with you again today.`, spurned: true, reply: Haggling.line('spurned', npc, ctx, {}) };
        const tongue = Haggling.tongue(ctx.player, ctx.world, settlement);
        const mk = Haggling.market(ctx);
        if (mk.error) return { ok: false, reason: mk.error };
        const q = Haggling.quote({ ...ctx, tongue }, mk);
        if (q.error) return { ok: false, reason: q.error, refuses: !!q.refuses };
        const patience = Haggling.patience(npc, tongue);
        const session = {
            side: ctx.side, goodId: ctx.goodId, qty: mk.qty, tradeId: ctx.tradeId,
            npcId: npc.id != null ? npc.id : null, keeper: npc.name || 'The keeper',
            list: q.list, bound: q.bound, floor: q.floor, ask: q.ask, ask0: q.ask,
            patience, patience0: patience, round: 0, lastOffer: null, calledBack: false,
            used: {}, tongue, late: q.late, quality: _num(mk.quality, 1), factors: q.factors, level: q.level, keeperLevel: q.keeperLevel,
            log: [], over: null, price: null, mood: null, result: null,
        };
        const reply = Haggling.line(q.late >= 0.5 ? 'openLate' : (ctx.side === 'buy' ? 'openBuy' : 'openSell'), npc, ctx, { price: q.ask }, session);
        session.log.push({ who: 'keeper', text: reply });
        return { ok: true, session, reply };
    },

    /** The price as said aloud: "12.5g". */
    _say(n) {
        return `${Utils.formatGold(n)}g`;
    },

    /** A line of the keeper's (or 'you'), filled in: picked by a hash of the keeper, the good and the round. */
    line(kind, npc, ctx, vals = {}, session = null) {
        const C = Haggling.config();
        const pool = _obj(C.lines)[kind];
        const list = Array.isArray(pool) ? pool : (typeof pool === 'string' ? [pool] : []);
        if (!list.length) return '';
        const qty = session ? session.qty : Math.max(1, Math.floor(_num(ctx && ctx.qty, 1)));
        const goodId = session ? session.goodId : ctx && ctx.goodId;
        const pick = list[_hash(kind, npc && npc.id, goodId, session ? session.round : 0, session ? session.log.length : 0) % list.length];
        return Haggling._fill(pick, { qty, goodId, ctx, ...vals });
    },

    _fill(text, v) {
        const good = Haggling._name(v.goodId);
        const lot = `${v.qty} ${good}`;
        return String(text)
            .replace(/\{price\}/g, v.price != null ? Haggling._say(v.price) : '')
            .replace(/\{offer\}/g, v.offer != null ? Haggling._say(v.offer) : '')
            .replace(/\{lot\}/g, v.qty === 1 ? good : lot)
            .replace(/\{good\}/g, good.charAt(0).toUpperCase() + good.slice(1))
            .replace(/\{town\}/g, (v.ctx && v.ctx.settlement && v.ctx.settlement.name) || 'town');
    },

    /** The player's own line for a move. */
    youSay(session, move, vals = {}, ctx = null) {
        const Y = _obj(Haggling.config().you);
        if (move === 'flaw') {
            const F = _obj(Haggling.config().flaws);
            const pool = Array.isArray(F[session.tradeId]) ? F[session.tradeId] : (Array.isArray(F.any) ? F.any : ['Shoddy, this.']);
            return pool[_hash('flaw', session.npcId, session.goodId, session.round) % pool.length];
        }
        return Haggling._fill(Y[move] || '', { qty: session.qty, goodId: session.goodId, ctx, ...vals });
    },

    /** The player's offer for a move (a total for the lot), or null for moves that name no price. */
    offerFor(session, move) {
        const O = _obj(Haggling.config().offers);
        const buy = session.side === 'buy';
        const r = (x) => (buy ? _up(x) : _down(x));
        switch (move) {
            case 'low': return buy ? r(session.ask * _num(O.low, 0.7)) : null;
            case 'mid': return buy ? r(session.ask * _num(O.mid, 0.85)) : null;
            case 'sellHigh': return buy ? null : r(session.ask * _num(O.sellHigh, 1.3));
            case 'sellMid': return buy ? null : r(session.ask * _num(O.sellMid, 1.15));
            case 'half': {
                const from = session.lastOffer != null ? session.lastOffer
                    : session.ask * (buy ? _num(O.low, 0.7) : _num(O.sellHigh, 1.3));
                return r((from + session.ask) / 2);
            }
            case 'accept': return session.ask;
            default: return null;
        }
    },

    /** The moves open to the player now: [{ id, label, offer, off, why, tactic }]. */
    moves(session) {
        if (!session || session.over) return [];
        const buy = session.side === 'buy';
        const out = [];
        const pct = (x) => `${Math.round(x * 100)}%`;
        const O = _obj(Haggling.config().offers);
        if (buy) {
            out.push({ id: 'low', label: `Offer ${pct(_num(O.low, 0.7))}`, offer: Haggling.offerFor(session, 'low') });
            out.push({ id: 'mid', label: `Offer ${pct(_num(O.mid, 0.85))}`, offer: Haggling.offerFor(session, 'mid') });
        } else {
            out.push({ id: 'sellHigh', label: `Ask ${pct(_num(O.sellHigh, 1.3))}`, offer: Haggling.offerFor(session, 'sellHigh') });
            out.push({ id: 'sellMid', label: `Ask ${pct(_num(O.sellMid, 1.15))}`, offer: Haggling.offerFor(session, 'sellMid') });
        }
        out.push({ id: 'half', label: 'Meet them halfway', offer: Haggling.offerFor(session, 'half') });
        const words = session.tongue && session.tongue.words;
        const noWords = 'You haven\'t the words in their tongue: learn it, or hire an interpreter.';
        const tactic = (id, label) => {
            const used = !!session.used[id];
            out.push({ id, label, tactic: true, off: used || !words, why: used ? 'Tried already.' : (!words ? noWords : '') });
        };
        tactic('flatter', 'Flatter them');
        if (buy) tactic('flaw', 'Point out a flaw');
        else tactic('praise', 'Talk up your goods');
        tactic('scoff', 'Scoff at the price');
        out.push({ id: 'accept', label: `${buy ? 'Pay' : 'Take'} ${Haggling._say(session.ask)}`, offer: session.ask });
        out.push({ id: 'walk', label: 'Walk away' });
        return out;
    },

    /** Is this offer good enough for the keeper? */
    _meets(session, offer) {
        return session.side === 'buy' ? offer >= session.floor - 1e-9 : offer <= session.floor + 1e-9;
    },

    /** The keeper takes `share` of the way from their ask toward the player's offer (never past their walk-away). */
    _concede(session, offer, share) {
        const buy = session.side === 'buy';
        const target = buy ? Math.max(session.floor, offer) : Math.min(session.floor, offer);
        const next = session.ask + (target - session.ask) * _clamp(share, 0, 1);
        session.ask = buy ? Math.max(session.floor, _up(next)) : Math.min(session.floor, _down(next));
    },

    /** Move the keeper's ask and their walk-away by a fraction toward the player (a tactic that worked). */
    _cut(session, askCut, floorCut) {
        const buy = session.side === 'buy';
        if (buy) {
            session.floor = Math.max(session.bound, _up(session.floor * (1 - floorCut)));
            session.ask = Math.max(session.floor, _up(session.ask * (1 - askCut)));
        } else {
            session.floor = Math.min(session.bound, _down(session.floor * (1 + floorCut)));
            session.ask = Math.min(session.floor, _down(session.ask * (1 + askCut)));
        }
    },

    _concession(session, npc) {
        const K = _obj(Haggling.config().concession);
        const edge = _num(session.level, 1) - _num(session.keeperLevel, 1);
        return _clamp(_num(K.base, 0.35) + edge * _num(K.skillPerLevel, 0.03) + Haggling._traitSum(npc, K.traits), 0.05, 0.9);
    },

    /** The chance a tactic works. */
    tacticChance(session, move, ctx) {
        const T = _obj(_obj(Haggling.config().tactics)[move]);
        const { player, npc } = ctx;
        let c = _num(T.chance, 0.3);
        const d = _num(NpcDisposition.getMemory(npc).disposition, 50);
        if (move === 'flatter') {
            c += (_num(player.charisma, 5) - 5) * _num(T.perCharisma, 0.04);
            if (SocialSkills.has('persuasion')) c += (SocialSkills.level(player, 'persuasion') - 1) * _num(T.perPersuasion, 0.02);
            c += (d - 50) * _num(T.perDisposition, 0.005);
            c += Haggling._traitSum(npc, T.traits);
        } else if (move === 'flaw' || move === 'praise') {
            c += _num(player.skills && player.skills.commerce) * _num(T.perCommerce, 0.04);
            c += (_num(session.level, 1) - 1) * _num(T.perHaggling, 0.02);
            const sc = ctx.settlement ? _num(SettlementMarket.info(ctx.settlement, session.goodId).scarcity, 1) : 1;
            if (move === 'flaw') {
                if (Haggling.perishable(session.goodId)) c += session.late * _num(T.latePerishable, 0.2);
                if (sc < 0.9) c += _num(T.glut, 0.1);
            } else {
                if (sc > 1.1) c += _num(T.scarce, 0.15);
                if (_num(session.quality, 1) > 1 || (ctx.player && Crafting.saleMult(ctx.player, session.goodId, session.qty, null) > 1)) c += _num(T.fineGrade, 0.15);
            }
        } else if (move === 'scoff') {
            c += (_num(player.strength, 5) - 5) * _num(T.perStrength, 0.03);
            c += Fame.scores(player, Haggling._kingdom(ctx.settlement)).good * _num(T.perFame, 0.002);
            c += Haggling._traitSum(npc, T.traits);
        }
        if (session.tongue && session.tongue.via === 'translator') c *= _num(_obj(Haggling.config().words).translator, 0.8);
        return _clamp(c, 0.05, 0.9);
    },

    /**
     * The player's move: 'low' | 'mid' | 'sellHigh' | 'sellMid' | 'half' |
     * 'accept' | 'walk' | 'flatter' | 'flaw' | 'praise' | 'scoff'.
     * ctx as for start. A deal struck goes through the stall's trade at once.
     * → { you, reply, over, deal (the trade result), session }
     */
    respond(session, move, ctx) {
        if (!session || session.over) return { reply: '', over: session && session.over, session };
        const C = Haggling.config();
        const { npc } = ctx;
        const buy = session.side === 'buy';
        session.round++;
        const say = (kind, vals = {}) => {
            const t = Haggling.line(kind, npc, ctx, vals, session);
            session.log.push({ who: 'keeper', text: t, kind });
            return t;
        };
        const you = (text) => { if (text) session.log.push({ who: 'you', text }); return text; };
        const out = { session, over: null };

        if (move === 'walk') {
            out.you = you(Haggling.youSay(session, 'walk', {}, ctx));
            const W = _obj(C.walkAway);
            const room = buy ? session.ask > session.floor * _num(W.room, 1.03) : session.ask * _num(W.room, 1.03) < session.floor;
            if (!session.calledBack && session.patience >= _num(W.minPatience, 2) && room) {
                session.calledBack = true;
                session.patience -= 1;
                const back = _num(W.back, 0.4);
                session.ask = buy ? Math.max(session.floor, _up(session.floor + (session.ask - session.floor) * back))
                    : Math.min(session.floor, _down(session.floor - (session.floor - session.ask) * back));
                out.reply = say('callback', { price: session.ask });
                out.calledBack = true;
                return out;
            }
            session.over = 'walked';
            out.reply = say('walked');
            out.over = 'walked';
            return out;
        }

        if (['flatter', 'flaw', 'praise', 'scoff'].includes(move)) {
            if (session.used[move]) { session.round--; return { ...out, reply: '', error: 'Tried already.' }; }
            if (!(session.tongue && session.tongue.words)) { session.round--; return { ...out, reply: '', error: 'You haven\'t the words.' }; }
            session.used[move] = true;
            const T = _obj(_obj(C.tactics)[move]);
            out.you = you(Haggling.youSay(session, move, {}, ctx));
            const ok = Utils.random() < Haggling.tacticChance(session, move, ctx);
            out.tactic = { move, ok };
            if (ok) {
                Haggling._cut(session, _num(T.askCut, 0.05), _num(T.floorCut, 0.03));
                if (T.disposition) NpcDisposition.adjustDisposition(npc, _num(T.disposition), ctx.player);
                out.reply = say(`${move}Ok`, { price: session.ask });
            } else {
                session.patience -= _num(T.failPatience, 1);
                if (T.failDisposition) NpcDisposition.adjustDisposition(npc, _num(T.failDisposition), ctx.player);
                out.reply = say(`${move}Fail`, { price: session.ask });
            }
            return Haggling._afterRound(session, out, ctx, say);
        }

        const offer = Haggling.offerFor(session, move);
        if (offer == null) { session.round--; return { ...out, reply: '', error: 'No such move.' }; }
        out.you = you(Haggling.youSay(session, move, { offer, price: session.ask }, ctx));
        // Their own price, or better for them: done at their price
        const atAsk = buy ? offer >= session.ask : offer <= session.ask;
        if (move === 'accept' || atAsk) return Haggling._strike(session, session.ask, out, ctx, say);
        if (Haggling._meets(session, offer)) {
            // An offer they could live with: early on, with patience to spare, they hold out
            // for some of the difference (a counter halfway); as it runs short they take it
            const hold = _num(C.hold, 0.5) * _clamp((session.patience - 1) / Math.max(1, session.patience0), 0, 1);
            const need = buy ? session.floor + (session.ask - session.floor) * hold : session.floor - (session.floor - session.ask) * hold;
            if ((buy ? offer >= need - 1e-9 : offer <= need + 1e-9) || session.patience <= 1) return Haggling._strike(session, offer, out, ctx, say);
            session.patience -= 1;
            session.lastOffer = offer;
            const mid = (session.ask + offer) / 2;
            session.ask = buy ? Math.max(offer, _up(mid)) : Math.min(offer, _down(mid));
            out.reply = say(session.patience === 1 ? 'thin' : (buy ? 'counterBuy' : 'counterSell'), { price: session.ask, offer });
            return out;
        }
        // Below what they'll take: they come down a way, their patience frays
        const L = _obj(C.lowball);
        const ratio = buy ? offer / session.floor : session.floor / offer;
        let kind = buy ? 'counterBuy' : 'counterSell';
        if (ratio < _num(L.rude, 0.75)) {
            session.patience -= 2;
            NpcDisposition.adjustDisposition(npc, -2, ctx.player);
            kind = 'lowball';
        } else {
            session.patience -= 1;
            if (ratio < _num(L.fair, 0.9)) NpcDisposition.adjustDisposition(npc, -1, ctx.player);
        }
        session.lastOffer = offer;
        Haggling._concede(session, offer, Haggling._concession(session, npc));
        if (session.patience === 1 && kind !== 'lowball') kind = 'thin';
        out.reply = say(kind, { price: session.ask, offer });
        return Haggling._afterRound(session, out, ctx, say);
    },

    /** Patience spent: they send the player off for the day. */
    _afterRound(session, out, ctx, say) {
        if (session.patience > 0) return out;
        session.over = 'refused';
        Haggling.spurn(ctx.npc, ctx.world);
        NpcDisposition.adjustDisposition(ctx.npc, _num(_obj(Haggling.config().refuse).disposition, -5), ctx.player);
        out.reply = say('refuse');
        out.over = 'refused';
        Haggling._train(ctx.player, session, false);
        return out;
    },

    /** Practice: Haggling (systems/socialSkills.js) and a little charisma (player/oddJobs.js). */
    _train(player, session, dealt) {
        const X = _obj(Haggling.config().xp);
        const xp = (dealt ? _num(X.haggling, 2) : _num(X.haggling, 2) / 2) + session.round * _num(X.perRound, 0.5);
        const ev = SocialSkills.train(player, 'haggling', xp);
        const cha = OddJobs.gainXp(player, { attrs: { charisma: 1 } }, _num(X.charisma, 0.6) * (dealt ? 1 : 0.5));
        session.xp = { haggling: xp, event: ev || null, charisma: cha };
    },

    /**
     * Shake on it at `price`: the stall's own trade with the haggled total
     * (Trading.buyGoods / sellToStall), checked against the bound afresh.
     */
    _strike(session, price, out, ctx, say) {
        const fresh = Haggling.market({ ...ctx, goodId: session.goodId, side: session.side, qty: session.qty, tradeId: session.tradeId });
        if (fresh.error) {
            session.over = 'failed';
            out.over = 'failed';
            out.reason = fresh.error;
            out.reply = '';
            return out;
        }
        const buy = session.side === 'buy';
        const total = buy ? Math.max(fresh.bound, Utils.cents(price)) : Math.min(fresh.bound, Utils.centsDown(price));
        const { player, settlement, world } = ctx;
        const res = buy
            ? Trading.buyGoods(player, fresh.entry, session.qty, settlement, null, { totalCost: total })
            : Trading.sellToStall(player, session.tradeId, session.goodId, session.qty, settlement, world, null, { totalEarned: total });
        out.deal = res;
        if (!res.success) {
            // (no coin, no room: the haggle stands, the deal does not)
            session.round--;
            out.reason = res.reason;
            out.reply = '';
            return out;
        }
        session.over = 'deal';
        session.price = buy ? res.spent : res.earned;
        out.over = 'deal';
        // How they feel about it: a hard bargain leaves them grudging, a good price warm
        const A = _obj(Haggling.config().after);
        const span = buy ? session.ask0 - session.floor : session.floor - session.ask0;
        const got = buy ? session.price - session.floor : session.floor - session.price;
        const r = span > 0 ? _clamp(got / span, 0, 1) : 1;
        let kind = 'accept';
        if (r >= _num(A.warmAt, 0.5)) {
            session.mood = 'warm';
            kind = 'warm';
            NpcDisposition.adjustDisposition(ctx.npc, _num(A.warm, 3), player);
        } else if (r < _num(A.grudgingUnder, 0.15)) {
            session.mood = 'grudging';
            kind = 'grudging';
            NpcDisposition.adjustDisposition(ctx.npc, _num(A.grudging, -1), player);
        } else {
            session.mood = 'content';
        }
        const mem = NpcDisposition.getMemory(ctx.npc);
        mem.lastAction = 'haggled';
        mem.haggles = _num(mem.haggles) + 1;
        out.reply = say(kind, { price: session.price });
        Haggling._train(player, session, true);
        return out;
    },

    /** A line as the player hears it (the words they lack in the keeper's tongue: Cultures.hear). */
    heard(session, text) {
        const t = session && session.tongue;
        if (!t || !text || t.share >= 0.999 || !t.lang) return text;
        return Cultures.hear(text, t.lang, t.share);
    },

    /** An onlooker's remark, picked by a hash (or null). */
    crowdLine(session, key = '') {
        const pool = _obj(Haggling.config().lines).crowd;
        if (!Array.isArray(pool) || !pool.length || !session) return null;
        return pool[_hash('crowd', session.npcId, session.round, key) % pool.length];
    },
};
