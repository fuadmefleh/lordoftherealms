// ============================================
// PUBLIC WORKS — roads, bridges, canals and harbours; tolls
// ============================================
// The works that change the roads of world/transport.js:
//
//   repair            restore a segment to good repair
//   upgrade_road      a track made a road
//   upgrade_highway   a road paved as a highway (may be tolled)
//   bridge            a stone bridge over a ford or a washed-out crossing (may be tolled)
//   canal             a canal between two towns of one region (may be tolled)
//   harbour           harbour works at a port: its sea links haul cheaper
//
// Who builds: the NPC crowns on their weekly turn (staggered by realm),
// weighing their treasury, debt, people's welfare, war and temper (data/
// transport.json realms); the player as an investor (their own gold; they
// collect the tolls, less the crown's share abroad) or as a ruler (the
// realm's treasury; the tolls go to it).
//
// A work is built with real goods and real hands: every day it buys stone,
// timber and iron from its site town's market (and the town at the road's
// other end) at the going price — at most drawShare of a stock a day, so a
// short market slows the work while its price climbs — and hires land hands
// in the site town (systems/labour.js reads Transport.handsAt), paid the
// town's land wage. Materials short of the labour stall it; winter halves
// the pace. The player's budget is paid up front and what is left refunded.
//
// Tolls: NPC trade over a tolled work pays its rate on the value carried
// (afterFlows, taken out of the two towns' trade income — a transfer, never
// new money); merchant caravans pay at the gate (caravanToll); the player
// pays a fee crossing a gate they don't own (playerCrossing), and a fare on
// a ferry. The player's tolls are booked in the Ledger ('roadTolls').
//
// Deterministic; no RNG. State on world.transport (world/transport.js).

import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Transport } from '../world/transport.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Seasons } from '../world/seasons.js';
import { Ledger } from './ledger.js';
import { CrownBooks } from '../world/crownBooks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);
const ROAD_WORKS = ['repair', 'upgrade_road', 'upgrade_highway', 'bridge'];
const TRAFFIC_DAYS = 28;

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

function _basePrice(goodId) {
    const gd = DataLoader._gamedata;
    const G = gd && gd.playerEconomy && gd.playerEconomy.GOODS;
    const g = G && G[String(goodId).toUpperCase()];
    return g && g.basePrice > 0 ? g.basePrice : 5;
}

function _town(world, q, r) {
    const t = world && world.getTile(q, r);
    return t && t.settlement ? t.settlement : null;
}

function _ruledId(player) {
    const r = player && player.throne && player.throne.ruling;
    return r && r.kingdomId != null ? r.kingdomId : null;
}

export const PublicWorks = {
    KINDS: ['repair', 'upgrade_road', 'upgrade_highway', 'bridge', 'canal', 'harbour'],

    // ── The day ───────────────────────────────────────────

    /**
     * The roads' day (world/transport.js tick: wear, upkeep, weather), the
     * works' progress, and the crowns' weekly turns. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function') return out;
        const day = _day(world);
        const st = Transport.state(world);
        if (st.pwDay === day) return out;
        st.pwDay = day;
        Transport.tick(world, day);
        for (const w of st.works) {
            if (!w || (w.status !== 'building' && w.status !== 'stalled')) continue;
            PublicWorks._progress(world, player, w, day, out);
        }
        // The crowns weigh their roads, each on its own day of the week
        const ruled = _ruledId(player);
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || k.id === ruled) continue;
            if (Transport.hash(`pw:${k.id}`) % 7 !== ((day % 7) + 7) % 7) continue;
            PublicWorks._realmTurn(world, k, day);
        }
        // Old finished works are forgotten (their effects stay on the roads)
        const keep = _num(Transport.config().build.keepDone, 40);
        const done = st.works.filter(w => w && w.status !== 'building' && w.status !== 'stalled' && !w.toll);
        if (done.length > keep) {
            const drop = new Set(done.slice(0, done.length - keep));
            st.works = st.works.filter(w => !drop.has(w));
        }
        return out;
    },

    // ── Quotes and commissions ────────────────────────────

    /** The target of a work: a segment (road works), a pair of towns (canal) or a town (harbour), or a reason it can't be. */
    _target(world, kind, target) {
        const st = Transport.state(world);
        if (ROAD_WORKS.includes(kind)) {
            const seg = Transport.segment(world, target);
            if (!seg) return { reason: 'There is no such road.' };
            const s = Transport.segState(world, seg);
            const B = Transport.config().bands;
            if (kind === 'repair' && _num(s.c) >= 90) return { reason: 'The road is in good repair.' };
            if (kind === 'upgrade_road' && s.t !== 'track') return { reason: 'Only a track can be made a road.' };
            if (kind === 'upgrade_highway' && s.t !== 'road') return { reason: 'Only a road can be paved as a highway.' };
            if (kind === 'bridge' && (!seg.rivers.length || s.x === 'bridge')) return { reason: seg.rivers.length ? 'A bridge already carries the road.' : 'The road crosses no river.' };
            const big = (_num(seg.a.s && seg.a.s.population) >= _num(seg.b.s && seg.b.s.population)) ? seg.a : seg.b;
            const alt = big === seg.a ? seg.b : seg.a;
            const mid = seg.gate >= 0 ? Transport.hexOf(world, seg.gate) : big;
            return { seg, s, hexes: seg.len, site: big, alt, q: mid.q, r: mid.r, kid: seg.kid, name: Transport.describe(world, seg).name, worn: _num(s.c) < B.worn };
        }
        if (kind === 'canal') {
            const [ak, bk] = String(target).split('|');
            if (!ak || !bk) return { reason: 'A canal joins two towns.' };
            const [aq, ar] = ak.split(',').map(Number), [bq, br] = bk.split(',').map(Number);
            const a = _town(world, aq, ar), b = _town(world, bq, br);
            if (!a || !b) return { reason: 'A canal joins two towns.' };
            const pk = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
            if (st.canals[pk]) return { reason: 'A canal already joins them.' };
            const W = Transport.work('canal') || {};
            const d = Hex.wrappingDistance(aq, ar, bq, br, world.width);
            if (d < _num(W.minDist, 3) || d > _num(W.maxDist, 10)) return { reason: `A canal needs towns ${_num(W.minDist, 3)}–${_num(W.maxDist, 10)} hexes apart (these are ${d}).` };
            const ta = world.getTile(aq, ar), tb = world.getTile(bq, br);
            if (!ta || !tb || ta.regionId === undefined || ta.regionId !== tb.regionId) return { reason: 'Both towns must stand on one land.' };
            const ports = KingdomNavy.isPortTile(world, aq, ar) || KingdomNavy.isPortTile(world, bq, br);
            let river = 0;
            if (!ports) {
                let dq = bq - aq;
                if (Math.abs(dq) > world.width / 2) dq -= Math.sign(dq) * world.width;
                for (const p of Hex.lineDraw(aq, ar, aq + dq, br)) {
                    const t = world.getTile(Hex.wrapQ(p.q, world.width), p.r);
                    if (t && t.hasRiver) river++;
                }
            }
            if (!ports && river < 1) return { reason: 'A canal needs a port at one end or a river between them.' };
            const site = _num(a.population) >= _num(b.population) ? { q: aq, r: ar, s: a } : { q: bq, r: br, s: b };
            const alt = site.s === a ? { q: bq, r: br, s: b } : { q: aq, r: ar, s: a };
            return { pair: pk, hexes: d, site, alt, q: Math.round(aq + (bq - aq) / 2), r: Math.round((ar + br) / 2), kid: site.s.kingdom != null ? site.s.kingdom : null, name: `${a.name} – ${b.name}` };
        }
        if (kind === 'harbour') {
            const [q, r] = String(target).split(',').map(Number);
            const s = _town(world, q, r);
            if (!s) return { reason: 'Harbour works need a town.' };
            if (!KingdomNavy.isPortTile(world, q, r)) return { reason: `${s.name} is no port.` };
            if (st.harbours[_key(q, r)]) return { reason: `${s.name} has its harbour works.` };
            return { town: _key(q, r), hexes: 1, site: { q, r, s }, alt: null, q, r, kid: s.kingdom != null ? s.kingdom : null, name: s.name };
        }
        return { reason: 'Unknown work.' };
    },

    /** Cost multiplier for the realm a work is in: the Royal Road-Building edict pays part of it. */
    _edict(world, kid) {
        const k = _kingdom(world, kid);
        return k ? Math.max(0.1, 1 + KingdomBonuses.crownEffect(k, 'roadCost')) : 1;
    },

    /**
     * What a work would take: { ok, reason, kind, name, goods {g: n}, goodsCost
     * (at the site's prices now), wages, cost (both), days, hands, tollRate, q, r }.
     */
    quote(world, kind, target) {
        const W = Transport.work(kind);
        if (!W) return { ok: false, reason: 'Unknown work.' };
        const tg = PublicWorks._target(world, kind, target);
        if (tg.reason) return { ok: false, reason: tg.reason };
        const B = Transport.config().build;
        const mult = W.perHex ? tg.hexes : 1;
        const goods = {};
        let goodsCost = 0;
        const site = tg.site && tg.site.s;
        for (const [g, n] of Object.entries(W.goods || {})) {
            const units = Math.ceil(_num(n) * mult * 10) / 10;
            if (!(units > 0)) continue;
            goods[g] = units;
            const sc = site && SettlementMarket.tracks(g) ? SettlementMarket.scarcity(site, g) : 1;
            goodsCost += units * _basePrice(g) * sc;
        }
        const days = Math.max(_num(W.minDays, 1), Math.ceil(_num(W.days, 1) * (W.perHex ? tg.hexes : 1)));
        const hands = _num(W.hands, 20);
        const wage = PublicWorks._wage(site);
        const wages = hands * wage * days * _num(B.wageMult, 1);
        const edict = PublicWorks._edict(world, tg.kid);
        const cost = Math.round((goodsCost + wages) * edict);
        return {
            ok: true, kind, target: String(target), name: `${W.name}: ${tg.name}`, workName: W.name, icon: W.icon || '🏗️',
            goods, goodsCost: Math.round(goodsCost * edict), wages: Math.round(wages * edict), cost, days, hands,
            tollRate: _num(W.toll), playerToll: _num(W.playerToll), tollable: _num(W.toll) > 0, kid: tg.kid, q: tg.q, r: tg.r, site: tg.site, alt: tg.alt,
        };
    },

    /** A hand's daily land wage in a town. */
    _wage(s) {
        const lab = s && s.labour;
        const w = lab && lab.wage && Number.isFinite(lab.wage.land) ? lab.wage.land : TownLabour.baseWage(s ? s.type : 'town', 'land');
        return Math.max(0.1, _num(w, 0.4));
    },

    /** Works under way on this target. */
    _busy(world, kind, target) {
        const st = Transport.state(world);
        const t = String(target);
        return st.works.some(w => w && (w.status === 'building' || w.status === 'stalled') && w.target === t
            && (ROAD_WORKS.includes(kind) ? ROAD_WORKS.includes(w.kind) : w.kind === kind));
    },

    /**
     * Commission a work. `by`: 'player' (their gold: they collect its tolls)
     * or a kingdom id (its treasury: an NPC crown, or the player's own realm
     * with opts.asRuler). opts.toll: charge a toll over it (tollable works).
     * → { success, message, work, quote }
     */
    commission(world, player, kind, target, opts = {}) {
        const q = PublicWorks.quote(world, kind, target);
        if (!q.ok) return { success: false, message: q.reason };
        if (PublicWorks._busy(world, kind, q.target)) return { success: false, message: 'Works are already under way there.' };
        const st = Transport.state(world);
        const B = Transport.config().build;
        const day = _day(world);
        let owner, payer, budget = 0;
        if (opts.by === 'player' || (opts.by == null && !opts.asRuler)) {
            if (!player) return { success: false, message: 'No one to pay for it.' };
            const mine = st.works.filter(w => w && w.owner === 'player' && (w.status === 'building' || w.status === 'stalled')).length;
            if (mine >= _num(B.maxPlayer, 4)) return { success: false, message: `You have ${mine} works under way already.` };
            const k = _kingdom(world, q.kid);
            if (k && Array.isArray(k.wars) && player.kingdomId != null && k.wars.includes(player.kingdomId)) return { success: false, message: `${k.name} is at war with your realm.` };
            budget = Math.ceil(q.cost * (1 + _num(B.budgetPad, 0.15)));
            if (_num(player.gold) < budget) return { success: false, message: `You need ${budget}g (the estimate and a reserve; what is left is returned).` };
            player.gold -= budget;
            Ledger.record(player, 'publicWorks', -budget);
            owner = 'player'; payer = 'player';
        } else {
            const kid = opts.asRuler ? _ruledId(player) : opts.by;
            const k = _kingdom(world, kid);
            if (!k || k.isAlive === false) return { success: false, message: 'No crown to pay for it.' };
            if (opts.asRuler && q.kid !== kid) return { success: false, message: 'That lies outside your realm.' };
            if (_num(k.treasury) < q.cost * 0.5) return { success: false, message: `The treasury of ${k.name} cannot bear it (${q.cost}g).` };
            owner = kid; payer = 'crown';
        }
        const id = `pw${st.seq++}`;
        const site = q.site, alt = q.alt;
        const w = {
            id, kind, target: q.target, name: q.name, icon: q.icon, owner, payer, kid: q.kid,
            toll: !!(opts.toll && q.tollable), tollRate: opts.toll && q.tollable ? q.tollRate : 0, playerToll: q.playerToll,
            status: 'building', started: day, done: null, days: q.days, daysDone: 0, hands: q.hands,
            need: { ...q.goods }, got: Object.fromEntries(Object.keys(q.goods).map(g => [g, 0])),
            est: q.cost, spent: 0, budget, tollIncome: 0, stall: null,
            tq: site.q, tr: site.r, aq: alt ? alt.q : null, ar: alt ? alt.r : null, q: q.q, r: q.r,
        };
        st.works.push(w);
        return { success: true, message: `${q.name} begun: about ${q.days} days, ${q.hands} hands hired in ${site.s ? site.s.name : 'the town'}.`, work: w, quote: q };
    },

    /** Put more gold into a stalled work of the player's (about what is left to do). */
    fund(world, player, workId) {
        const st = Transport.state(world);
        const w = st.works.find(x => x && x.id === workId);
        if (!w || w.owner !== 'player' || (w.status !== 'building' && w.status !== 'stalled')) return { success: false, message: 'No such work of yours under way.' };
        const left = Math.max(20, Math.ceil(w.est * Math.max(0.1, 1 - PublicWorks.progress(w)) * 0.6));
        if (_num(player.gold) < left) return { success: false, message: `You need ${left}g.` };
        player.gold -= left;
        w.budget = _num(w.budget) + left;
        Ledger.record(player, 'publicWorks', -left);
        if (w.stall === 'funds') { w.stall = null; w.status = 'building'; }
        return { success: true, message: `${left}g more for the ${w.name}.` };
    },

    /** Abandon a work of the player's: what is left of the budget comes back, what was built is lost. */
    abandon(world, player, workId) {
        const st = Transport.state(world);
        const w = st.works.find(x => x && x.id === workId);
        if (!w || w.owner !== 'player' || (w.status !== 'building' && w.status !== 'stalled')) return { success: false, message: 'No such work of yours under way.' };
        const back = Math.floor(_num(w.budget));
        w.budget = 0;
        w.status = 'abandoned';
        w.done = _day(world);
        if (back > 0) { player.gold += back; Ledger.record(player, 'publicWorks', back); }
        return { success: true, message: `The ${w.name} is abandoned; ${back}g of its budget returned.` };
    },

    /** Share of a work done: the lesser of its days and its materials. */
    progress(w) {
        const dayF = _num(w.days) > 0 ? Math.min(1, _num(w.daysDone) / w.days) : 1;
        let need = 0, got = 0;
        for (const [g, n] of Object.entries(w.need || {})) { need += _num(n); got += Math.min(_num(n), _num(w.got && w.got[g])); }
        const goodsF = need > 0 ? got / need : 1;
        return Math.min(dayF, goodsF);
    },

    // ── Building ──────────────────────────────────────────

    /** Spend from the work's payer; false when it can't. */
    _pay(world, player, w, amount) {
        if (!(amount > 0)) return true;
        if (w.payer === 'player') {
            if (_num(w.budget) + 1e-9 < amount) return false;
            w.budget = _r2(_num(w.budget) - amount);
        } else {
            const k = _kingdom(world, w.owner);
            if (!k || k.isAlive === false) return false;
            if (_num(k.treasury) - amount < _num(Transport.config().upkeep.floor, 400)) return false;
            k.treasury = _num(k.treasury) - amount;
            CrownBooks.note(k, 'works', amount);
        }
        w.spent = _r2(_num(w.spent) + amount);
        return true;
    },

    _progress(world, player, w, day, out) {
        const B = Transport.config().build;
        const site = _town(world, w.tq, w.tr);
        if (!site) { w.status = 'abandoned'; w.done = day; return; }
        const alt = w.aq != null ? _town(world, w.aq, w.ar) : null;
        const edict = PublicWorks._edict(world, w.kid);
        // Materials: bought at the going price, a share of the stock a day
        const share = Math.max(0.01, _num(B.drawShare, 0.3));
        const pace = Math.max(1, _num(w.days));
        let short = false;
        for (const [g, n] of Object.entries(w.need || {})) {
            let want = Math.min(_num(n) - _num(w.got[g]), (_num(n) / pace) * 1.6 + 0.05);
            if (!(want > 0.001)) continue;
            for (const town of [site, alt]) {
                if (!town || !(want > 0.001) || !SettlementMarket.tracks(g)) continue;
                const avail = SettlementMarket.stock(town, g) * share;
                const take = Math.min(want, avail);
                if (!(take > 0.01)) continue;
                const price = _basePrice(g) * SettlementMarket.scarcity(town, g) * edict;
                if (!PublicWorks._pay(world, player, w, take * price)) { w.stall = 'funds'; break; }
                SettlementMarket.take(town, g, take);
                w.got[g] = _r2(_num(w.got[g]) + take);
                want -= take;
            }
            if (want > 0.05) short = true;
        }
        if (w.stall === 'funds') {
            w.status = 'stalled';
            PublicWorks._stallNote(w, out, 'the money has run out');
            return;
        }
        // Labour: the hands are paid every day; they build as far as the materials allow
        const wage = PublicWorks._wage(site) * w.hands * _num(B.wageMult, 1) * edict;
        const matF = PublicWorks.progress({ ...w, days: 0 });
        const ahead = _num(w.daysDone) / Math.max(1, w.days) > matF + 0.15;
        const pay = ahead ? wage * 0.5 : wage;
        if (!PublicWorks._pay(world, player, w, pay)) {
            w.status = 'stalled';
            w.stall = 'funds';
            PublicWorks._stallNote(w, out, 'the hands want their wages');
            return;
        }
        w.status = 'building';
        w.stall = ahead ? 'materials' : (short ? 'slow' : null);
        if (!ahead) w.daysDone = _r2(_num(w.daysDone) + (Seasons.seasonOf(day) === 'Winter' && w.kind !== 'repair' ? 0.5 : 1));
        if (PublicWorks.progress(w) >= 0.999) PublicWorks._complete(world, player, w, day, out);
    },

    _stallNote(w, out, why) {
        if (w.owner !== 'player' || w._noted === w.stall) return;
        w._noted = w.stall;
        out.notices.push({ icon: '🚧', title: 'Works Stalled', text: `The ${w.name} has stopped: ${why}. Fund it from the Public Works panel.`, type: 'warning' });
    },

    _complete(world, player, w, day, out) {
        const st = Transport.state(world);
        w.status = 'done';
        w.done = day;
        w.stall = null;
        const W = Transport.work(w.kind) || {};
        let kind = null;
        if (ROAD_WORKS.includes(w.kind)) {
            const seg = Transport.segment(world, w.target);
            if (seg) {
                const fields = { c: 100 };
                if (W.to) { fields.t = W.to; if (seg.rivers.length) fields.x = 'bridge'; }
                if (w.kind === 'bridge') { fields.x = 'bridge'; fields.cl = null; }
                if (w.toll) fields.toll = w.id;
                const s = Transport.setSegment(world, seg, fields);
                if (w.kind === 'bridge') delete s.wash;
                kind = w.kind === 'upgrade_highway' ? 'highway_opened' : w.kind === 'bridge' ? 'bridge_built' : w.kind === 'upgrade_road' ? 'road_built' : null;
                if (kind) Transport.record(world, { kind, seg, day, own: w.owner === 'player', work: w.id });
            }
        } else if (w.kind === 'canal') {
            st.canals[w.target] = { id: w.id, owner: w.owner, toll: !!w.toll, day };
            const [ak, bk] = w.target.split('|');
            const [aq, ar] = ak.split(',').map(Number), [bq, br] = bk.split(',').map(Number);
            const a = _town(world, aq, ar), b = _town(world, bq, br);
            Transport.record(world, { kind: 'canal_opened', place: a ? a.name : 'the town', other: b ? b.name : 'the town', q: w.q, r: w.r, day, kingdomId: w.kid, own: w.owner === 'player', work: w.id });
        } else if (w.kind === 'harbour') {
            st.harbours[w.target] = { id: w.id, owner: w.owner, day };
            const s = _town(world, w.tq, w.tr);
            Transport.record(world, { kind: 'harbour_built', place: s ? s.name : 'the port', other: '', q: w.tq, r: w.tr, day, kingdomId: w.kid, own: w.owner === 'player', work: w.id });
        }
        if (w.owner === 'player' && player) {
            const back = Math.floor(_num(w.budget));
            w.budget = 0;
            if (back > 0) { player.gold += back; Ledger.record(player, 'publicWorks', back); }
            out.notices.push({ icon: w.icon || '🏗️', title: 'Works Finished', text: `The ${w.name} is finished (${Math.round(w.spent)}g spent${back > 0 ? `, ${back}g returned` : ''}).${w.toll ? ' Its tolls are yours.' : ''}`, type: 'success' });
        }
    },

    // ── The crowns ────────────────────────────────────────

    /** An NPC crown's weekly look at its roads: one new work at most. */
    _realmTurn(world, k, day) {
        const C = Transport.config();
        const R = C.realms;
        const st = Transport.state(world);
        const mine = st.works.filter(w => w && w.owner === k.id && (w.status === 'building' || w.status === 'stalled'));
        // A stalled work of the crown's is given up once it has stood a season
        for (const w of mine) if (w.status === 'stalled' && day - _num(w.started) > 120) { w.status = 'abandoned'; w.done = day; }
        if (mine.filter(w => w.status === 'building').length >= _num(C.build.maxPerRealm, 2)) return null;
        const f = _obj(k.finance) || {};
        if (_num(f.missed) > 0 || _num(f.debtRatio) > _num(R.maxDebt, 0.5)) return null;
        const pm = _num(R.personality[KingdomAI.personalityId(k)], 1);
        const tr = _num(k.treasury);
        const atWar = Array.isArray(k.wars) && k.wars.length > 0;
        const segs = Transport.segments(world).filter(s => s.kid === k.id);
        const busy = new Set(st.works.filter(w => w && (w.status === 'building' || w.status === 'stalled')).map(w => w.target));
        const go = (kind, target) => {
            if (busy.has(String(target))) return null;
            const q = PublicWorks.quote(world, kind, target);
            if (!q.ok || q.cost > tr * 0.25) return null;
            const res = PublicWorks.commission(world, null, kind, target, { by: k.id, toll: q.tollable && KingdomAI.personalityId(k) !== 'peaceful' && _num(f.debtRatio) > 0.2 });
            return res.success ? res.work : null;
        };
        if (tr < _num(R.repairAt, 1500) * pm) return null;
        // 1. Bridges washed away, then ruined roads
        for (const seg of segs) {
            const s = Transport.segState(world, seg);
            if (s.wash && s.x !== 'bridge') { const w = go('bridge', seg.key); if (w) return w; }
        }
        let worst = null;
        for (const seg of segs) {
            const s = Transport.segState(world, seg);
            if (_num(s.c) < C.bands.worn && (!worst || _num(s.c) < _num(Transport.segState(world, worst).c))) worst = seg;
        }
        if (worst) { const w = go('repair', worst.key); if (w) return w; }
        if (atWar) return null;
        const welfare = (EconomyIndex.latest(world, k.id) || {}).welfare;
        if (Number.isFinite(welfare) && welfare > 0 && welfare < _num(R.minWelfare, 0.35)) return null;
        // Each kind of great work at most once in its interval per realm (a failed search waits too)
        const due = (what, every) => day - _num(st.realms[`${what}:${k.id}`], -1e9) >= every;
        const mark = (what) => { st.realms[`${what}:${k.id}`] = day; };
        // 2. The busiest road a tier up (traffic: gold a day carried over it, measured by afterFlows)
        if (tr >= _num(R.upgradeAt, 9000) * pm && due('upgrade', _num(R.upgradeEvery, 120))) {
            let best = null, bestV = _num(R.upgradeTraffic, 30) / pm;
            for (const seg of segs) {
                const s = Transport.segState(world, seg);
                if (!Transport.nextTier(s.t)) continue;
                const v = _num(st.traffic && st.traffic[seg.key]) * (s.t === 'track' ? 2 : 1);
                if (v > bestV) { bestV = v; best = seg; }
            }
            if (best) {
                const s = Transport.segState(world, best);
                const w = go(s.t === 'track' ? 'upgrade_road' : 'upgrade_highway', best.key);
                if (w) { mark('upgrade'); return w; }
            }
        }
        // 3. Harbour works at its great ports, then a canal
        const wantHarbour = tr >= _num(R.harbourAt, 20000) * pm && due('harbour', _num(R.harbourEvery, 360));
        const wantCanal = tr >= _num(R.canalAt, 30000) * pm && due('canal', _num(R.canalEvery, 360));
        if (!wantHarbour && !wantCanal) return null;
        const towns = (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []).filter(v => v.kingdom === k.id || (_town(world, v.q, v.r) || {}).kingdom === k.id);
        if (wantHarbour) {
            mark('harbour');
            const port = towns.filter(v => KingdomNavy.isPortTile(world, v.q, v.r) && !st.harbours[_key(v.q, v.r)])
                .sort((x, y) => _num(y.population) - _num(x.population))[0];
            if (port) { const w = go('harbour', _key(port.q, port.r)); if (w) return w; }
        }
        // (canals are rare: at most canalPerTowns of the world's towns, and only where no good road runs)
        const canals = Object.keys(st.canals).length + st.works.filter(w => w && w.kind === 'canal' && (w.status === 'building' || w.status === 'stalled')).length;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews().length : 0;
        if (wantCanal && canals < Math.max(1, Math.floor(views * _num(R.canalPerTowns, 0.06)))) {
            mark('canal');
            let best = null, bestV = 0;
            for (let i = 0; i < towns.length; i++) {
                for (let j = i + 1; j < towns.length; j++) {
                    const a = towns[i], b = towns[j];
                    const ak = _key(a.q, a.r), bk = _key(b.q, b.r);
                    const pk = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
                    if (st.canals[pk]) continue;
                    const band = Transport.linkBand(world, a, b);
                    if (band === 'good' || band === 'canal') continue;
                    const v = _num(a.population) * _num(b.population);
                    if (v <= bestV) continue;
                    if (PublicWorks._target(world, 'canal', pk).reason) continue;
                    best = pk; bestV = v;
                }
            }
            if (best) {
                const w = go('canal', best);
                if (w) return w;
            }
        }
        return null;
    },

    // ── Tolls ─────────────────────────────────────────────

    /** Pay a toll to a work's owner (the player's share booked in the Ledger; the crown's cut abroad). */
    _payToll(world, player, w, amount) {
        if (!(amount > 0)) return 0;
        w.tollIncome = _r2(_num(w.tollIncome) + amount);
        const st = Transport.state(world);
        st.stats.tolls = _r2(_num(st.stats.tolls) + amount);
        if (w.owner === 'player') {
            const k = _kingdom(world, w.kid);
            const foreign = k && k.id !== _ruledId(player);
            const cut = foreign ? amount * _num(Transport.config().build.crownShare, 0.25) : 0;
            if (cut > 0 && k) { k.treasury = _num(k.treasury) + cut; CrownBooks.note(k, 'customs', cut); }
            if (player) {
                const mine = amount - cut;
                player.gold = _num(player.gold) + mine;
                Ledger.record(player, 'roadTolls', _r2(mine));
            }
            return amount;
        }
        const k = _kingdom(world, w.owner);
        if (k) { k.treasury = _num(k.treasury) + amount; CrownBooks.note(k, 'customs', amount); }
        return amount;
    },

    /**
     * After the day's NPC trade (MarketDynamics): links over tolled works pay
     * their rate on the value carried, out of the two towns' trade income
     * (an embodied link's caravan pays at the gate instead); and each road
     * segment's traffic (gold a day) is measured for the crowns and the Steward.
     */
    afterFlows(world, links, player = null, day = null) {
        if (!world || !Array.isArray(links)) return 0;
        const st = Transport.state(world);
        if (!_obj(st.tAcc)) st.tAcc = {};
        if (!_obj(st.traffic)) st.traffic = {};
        if (!Number.isFinite(st.tFrom)) st.tFrom = _num(day);
        if (_num(day) - st.tFrom >= TRAFFIC_DAYS) {
            const span = Math.max(1, _num(day) - st.tFrom);
            st.traffic = {};
            for (const [key, v] of Object.entries(st.tAcc)) st.traffic[key] = _r2(v / span);
            st.tAcc = {};
            st.tFrom = _num(day);
        }
        let paid = 0;
        for (const l of links) {
            const val = _num(l.val);
            if (!(val > 0) || l.sea) continue;
            if (l.road && Array.isArray(l._ids) && l._rt) {
                for (const id of l._ids) {
                    const seg = l._rt.segs[id];
                    if (seg) st.tAcc[seg.key] = _num(st.tAcc[seg.key]) + val;
                }
            }
            if (!l.tolls || !(l.toll > 0) || l.embody === true) continue;
            let due = val * l.toll;
            const ia = _num(l.a.economy && l.a.economy.tradeIncome), ib = _num(l.b.economy && l.b.economy.tradeIncome);
            due = Math.min(due, ia + ib);
            if (!(due > 0.01)) continue;
            const fa = ia + ib > 0 ? ia / (ia + ib) : 0.5;
            if (l.a.economy) l.a.economy.tradeIncome = _r2(ia - due * fa);
            if (l.b.economy) l.b.economy.tradeIncome = _r2(ib - due * (1 - fa));
            for (const id of l.tolls) {
                const w = st.works.find(x => x && x.id === id);
                if (!w) continue;
                const rate = _num(w.tollRate);
                paid += PublicWorks._payToll(world, player, w, due * (l.toll > 0 ? rate / l.toll : 0));
            }
        }
        return paid;
    },

    /** A merchant caravan at a toll gate pays the work's rate on its cargo, once per work. */
    caravanToll(world, u, tile, player = null) {
        const id = tile && tile.tollGate;
        if (!id || !u) return 0;
        if (!Array.isArray(u.tollWorks)) u.tollWorks = [];
        if (u.tollWorks.includes(id)) return 0;
        u.tollWorks.push(id);
        const st = Transport.state(world);
        const w = st.works.find(x => x && x.id === id);
        if (!w || !(w.tollRate > 0)) return 0;
        const due = Math.min(Math.floor(_num(u.purse)), Math.round(_num(u.value) * w.tollRate));
        if (!(due > 0)) return 0;
        u.purse = _num(u.purse) - due;
        PublicWorks._payToll(world, player, w, due);
        return due;
    },

    /**
     * The player steps on a toll gate or a ferry: the toll to the gate's
     * owner (nothing at their own), the ferryman's fare. → gold paid.
     */
    playerCrossing(world, player, tile) {
        if (!world || !player || !tile || player.boardedShip) return 0;
        let paid = 0;
        if (tile.tollGate) {
            const st = Transport.state(world);
            const w = st.works.find(x => x && x.id === tile.tollGate);
            const own = w && (w.owner === 'player' || (w.owner === _ruledId(player)));
            const fee = w ? Math.round(_num(w.playerToll)) : 0;
            if (w && !own && fee > 0 && _num(player.gold) >= fee) {
                player.gold -= fee;
                Ledger.record(player, 'roadTolls', -fee);
                PublicWorks._payToll(world, null, w, fee);
                paid += fee;
            }
        }
        if (tile.roadCross === 'ferry') {
            const fare = Math.round(_num(Transport.config().rivers.ferryFare, 2));
            if (fare > 0 && _num(player.gold) >= fare) {
                player.gold -= fare;
                Ledger.record(player, 'roadTolls', -fare);
                paid += fare;
            }
        }
        return paid;
    },

    // ── Reading ───────────────────────────────────────────

    works(world, filter = null) {
        const st = _obj(world && world.transport);
        const list = st && Array.isArray(st.works) ? st.works.filter(Boolean) : [];
        return filter ? list.filter(filter) : list;
    },

    playerWorks(world) {
        return PublicWorks.works(world, w => w.owner === 'player');
    },

    /** Estimated toll income a day (to the player, after the crown's cut) and payback of a tolled work on a segment. */
    tollEstimate(world, player, kind, segKey) {
        const q = PublicWorks.quote(world, kind, segKey);
        if (!q.ok || !q.tollable) return null;
        const st = Transport.state(world);
        const traffic = _num(st.traffic && st.traffic[segKey]);
        const k = _kingdom(world, q.kid);
        const foreign = k && k.id !== _ruledId(player);
        const perDay = traffic * q.tollRate * (foreign ? 1 - _num(Transport.config().build.crownShare, 0.25) : 1);
        return { perDay: _r2(perDay), cost: q.cost, payback: perDay > 0 ? Math.round(q.cost / perDay) : null, traffic };
    },

    /** One line for the HUD / panels about the roads where the player stands. */
    summary(world) {
        const st = _obj(world && world.transport) || {};
        const segs = Transport.segments(world);
        const bands = { good: 0, worn: 0, ruined: 0, closed: 0 };
        for (const seg of segs) bands[Transport.band(Transport.segState(world, seg))]++;
        return { segments: segs.length, bands, works: (st.works || []).filter(w => w && w.status === 'building').length, canals: Object.keys(st.canals || {}).length, upkeep: _num(st.stats && st.stats.upkeep), tolls: _num(st.stats && st.stats.tolls) };
    },
};
