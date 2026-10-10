// ============================================
// PUTTING-OUT — the cottage industry of the countryside
// ============================================
// Merchants put out raw wool and flax to the cottagers about a town, who
// spin and weave at home for a piece rate and hand back cloth (textiles from
// wool, linen from flax). It is cheaper than a guild workshop, slower, and the
// cloth's quality varies; the work goes where the households have time for
// it — all winter, little at harvest — and out of the slack season it draws
// hands from the fields (the town's crops fall a little: the town's `draw`,
// read by world/estates.js applyToProduction).
//
//   the player   puts out what they carry at a chosen piece rate (mean, fair,
//                generous: the wage, how many take the work, the quality),
//                pays the wages up front (into the town's coin: rural
//                incomes, the tenants' loyalty), and comes back to collect.
//                Where the town's weavers' guild holds a royal charter the
//                guild's officers may seize part of the cloth and fine the
//                merchant; an unchartered guild only fines. Villages have no
//                guild: that is why the trade went to the countryside.
//   the houses   (NPC) each town's weekly turn: where the cloth fetches more
//                than the fibre and the piece rate, the merchants put out
//                the fibre above the market's own need and bring the cloth
//                to market a week later — never in a chartered town.
//
// The heralds cry a linen glut when a realm's towns are awash with it.
// Rolls are hashes (no RNG). State: player.land.batches (systems/landMarket.js
// player record), the towns' cottage work on world.estates.towns. Tuned in
// data/estates.json → puttingOut.

import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Estates } from '../world/estates.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Guilds } from './guilds.js';
import { PriceKnowledge } from './priceKnowledge.js';
import { LandMarket } from './landMarket.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _r2 = (v) => Math.round(v * 100) / 100;

const DEFAULTS = {
    goods: { wool: { out: 'textiles', ratio: 0.9 }, flax: { out: 'linen', ratio: 0.9 } },
    rural: { village: 1, town: 0.6, city: 0.4, capital: 0.3 },
    slack: { Winter: 1, Spring: 0.3, Summer: 0.15, Autumn: 0.45 },
    away: { Winter: 0, Spring: 0.6, Summer: 0.8, Autumn: 0.6 },
    perHousehold: 0.15, landSensitivity: 0.8, npcShare: 0.5,
    rates: { fair: { label: 'Fair', share: 0.15, speed: 1, quality: 0 } },
    guildRate: 0.3, qMin: 0.85, qMax: 1.03,
    chartered: { chance: 0.4, seize: 0.25, fine: 0.1, feud: 4 },
    open: { chance: 0.15, seize: 0, fine: 0.05, feud: 1 },
    minMargin: 0.1, npcKeep: 1, npcEvery: 7, minBatch: 5, maxBatches: 6, holdDays: 60,
    glut: { below: 0.7, towns: 3, gapDays: 120 },
};

let _cfg = null;
let _cfgSrc;
/** The towns by their day of the week, per state. */
const _slotCache = new WeakMap();

function _roll(world, ...parts) {
    return Estates.roll(`${Estates.seed(world)}:po:${parts.join(':')}`);
}

export const PuttingOut = {
    config() {
        const d = Estates.config().puttingOut || {};
        if (_cfg && _cfgSrc === d) return _cfg;
        const C = { ...DEFAULTS, ...d };
        for (const k of ['goods', 'rural', 'slack', 'away', 'rates', 'chartered', 'open', 'glut']) C[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        _cfgSrc = d;
        _cfg = C;
        return C;
    },

    /** The cottage households about a town who might take work. */
    households(live) {
        const C = PuttingOut.config();
        if (!live) return 0;
        const hhSize = Math.max(1, _num(Estates.config().derive.householdSize, 5));
        return Math.floor(Estates.peasants(live) * _num(C.rural[live.type], 0.5) / hhSize);
    },

    /** Share of them with time for it this season. */
    slack(day) {
        return _num(PuttingOut.config().slack[Seasons.seasonOf(day)], 0.3);
    },

    /** Fibre a day the town's cottagers can spin and weave (all of them). */
    capacity(live, day) {
        return PuttingOut.households(live) * PuttingOut.slack(day) * _num(PuttingOut.config().perHousehold, 0.15);
    },

    /** The player's share of it. */
    playerCapacity(live, day) {
        return PuttingOut.capacity(live, day) * (1 - _clamp(_num(PuttingOut.config().npcShare, 0.5), 0, 0.95));
    },

    /** The weavers' guild's stance in a town: { kind: 'chartered'|'open'|null, guild, exempt }. */
    guildStance(player, live) {
        const g = live ? Guilds.guild(live, 'weavers') : null;
        if (!g) return { kind: null, guild: null, exempt: false };
        const exempt = player ? Guilds.rankOf(player, live, 'weavers') >= 1 : false;
        return { kind: g.chartered ? 'chartered' : 'open', guild: g, exempt };
    },

    /**
     * What putting out `qty` of `input` here at `rate` comes to: { ok, reason,
     * out, expect, wage, days, guildCost, stance }.
     */
    quote(player, world, tile, input, qty, rateId = 'fair') {
        const C = PuttingOut.config();
        const live = tile && tile.settlement;
        if (!live) return { ok: false, reason: 'Put work out from a town or village.' };
        const G = C.goods[input];
        if (!G) return { ok: false, reason: 'The cottagers spin wool and flax.' };
        const rate = C.rates[rateId];
        if (!rate) return { ok: false, reason: 'No such piece rate.' };
        const n = Math.floor(_num(qty));
        const have = Math.floor(_num(player && player.inventory && player.inventory[input]));
        const outBase = Estates.basePrice(G.out);
        const expect = Math.floor(n * _num(G.ratio, 0.9));
        const wage = Math.max(1, Math.round(_num(rate.share, 0.15) * outBase * expect));
        const cap = PuttingOut.playerCapacity(live, _day(world)) * _num(rate.speed, 1);
        const days = cap > 0 ? Math.ceil(n / cap) : Infinity;
        const stance = PuttingOut.guildStance(player, live);
        const base = { out: G.out, expect, wage, days, guildCost: Math.round(_num(C.guildRate, 0.3) * outBase * expect), stance, households: PuttingOut.households(live), cap };
        const st = LandMarket.playerState(player);
        if (n < _num(C.minBatch, 5)) return { ok: false, reason: `Put out at least ${C.minBatch} at a time.`, ...base };
        if (n > have) return { ok: false, reason: `You carry ${have} ${input}.`, ...base };
        if (st.batches.filter(b => !b.done).length >= _num(C.maxBatches, 6)) return { ok: false, reason: 'You have as much work out as your agents can watch.', ...base };
        if (!(cap > 0)) return { ok: false, reason: 'No cottagers here have time for it.', ...base };
        if (_num(player.gold) < wage) return { ok: false, reason: `The piece wages come to ${wage}g, paid up front.`, ...base };
        return { ok: true, ...base };
    },

    /** Put work out: the fibre leaves the packs, the wages go to the households. */
    putOut(player, world, tile, input, qty, rateId = 'fair') {
        const q = PuttingOut.quote(player, world, tile, input, qty, rateId);
        if (!q.ok) return { success: false, reason: q.reason };
        const C = PuttingOut.config();
        const live = tile.settlement;
        const n = Math.floor(qty);
        const day = _day(world);
        player.inventory[input] -= n;
        if (!(player.inventory[input] > 0)) delete player.inventory[input];
        player.gold -= q.wage;
        Ledger.record(player, 'puttingOut', -q.wage);
        // The fibre's cost goes with it into the cloth (the price book's margins)
        let basis = 0;
        const P = PriceKnowledge.state(player).pnl;
        const h = P && P.held ? P.held[input] : null;
        if (h && h.qty > 0) {
            const k = Math.min(n, h.qty);
            basis = h.cost * k / h.qty;
            h.cost = _r2(h.cost - basis);
            h.qty -= k;
            if (!(h.qty > 0)) delete P.held[input];
        }
        // Rural incomes: the wages are the cottagers' (the town's coin), a little cheer
        const econ = live.economy || (live.economy = { gold: 0, food: 0, goods: 0 });
        econ.gold = _num(econ.gold) + q.wage;
        live.happiness = _clamp(_num(live.happiness, 50) + Math.min(1, q.wage / 200), 0, 100);
        const rec = Estates.town(world, live.q, live.r);
        if (rec) { rec.poAt = day; rec.wages = Math.round(_num(rec.wages) + q.wage); }
        const st = LandMarket.playerState(player);
        const rate = C.rates[rateId];
        const quality = _r2(_clamp(_num(C.qMin, 0.85) + (_num(C.qMax, 1.03) - _num(C.qMin, 0.85)) * _roll(world, 'q', st.seq, day) + _num(rate.quality), 0.5, 1.2));
        const b = {
            id: `P${st.seq++}`, town: `${live.q},${live.r}`, q: live.q, r: live.r, name: live.name, input, output: q.out, qty: n, worked: 0,
            rate: rateId, wage: q.wage, quality, start: day, done: false, readyDay: null, basis: _r2(basis), units: null,
        };
        st.batches.push(b);
        st.stats.putOut += n;
        st.stats.wages += q.wage;
        return { success: true, batch: b, text: `${q.households} cottage households about ${live.name} take ${n} ${input} to spin and weave for ${q.wage}g: about ${q.expect} ${q.out} in ${q.days} days.` };
    },

    /** The player's batches: all, or those at a town. */
    batches(player, q = null, r = null) {
        const st = player && _obj(player.land);
        const list = st && Array.isArray(st.batches) ? st.batches : [];
        return q == null ? list : list.filter(b => b.q === q && b.r === r);
    },

    /** Batches ready to collect: [{ b }]. */
    ready(player) {
        return PuttingOut.batches(player).filter(b => b.done);
    },

    /** Collect the cloth of every finished batch here (the guild's officers may have a say). */
    collect(player, world, tile) {
        const live = tile && tile.settlement;
        if (!live) return { success: false, reason: 'Collect at the town you put the work out from.' };
        const C = PuttingOut.config();
        const st = LandMarket.playerState(player);
        const here = st.batches.filter(b => b.done && b.q === live.q && b.r === live.r);
        if (!here.length) return { success: false, reason: 'No cloth is ready here.' };
        const day = _day(world);
        const lines = [];
        let got = 0;
        for (const b of here) {
            let units = Math.max(0, Math.floor(_num(b.units)));
            const stance = PuttingOut.guildStance(player, live);
            if (stance.kind && !stance.exempt) {
                const G = C[stance.kind];
                if (_roll(world, 'guild', b.id, day) < _num(G.chance)) {
                    const seized = Math.floor(units * _num(G.seize));
                    units -= seized;
                    const fine = Math.min(Math.floor(_num(player.gold)), Math.round(_num(G.fine) * Estates.basePrice(b.output) * (units + seized)));
                    if (fine > 0) {
                        player.gold -= fine;
                        Ledger.record(player, 'fines', -fine);
                        stance.guild.treasury = _num(stance.guild.treasury) + fine;
                        st.stats.fines += fine;
                    }
                    if (seized > 0) { SettlementMarket.add(live, b.output, seized); st.stats.seized += seized; }
                    stance.guild.feud = Math.min(100, _num(stance.guild.feud) + _num(G.feud));
                    lines.push(`The officers of the ${stance.guild.name} ${seized ? `seized ${seized} ${b.output} as unlawful work and ` : ''}fined you ${fine}g${stance.kind === 'chartered' ? ' under their royal charter' : ''}.`);
                }
            }
            if (units > 0) {
                const r = PlayerInventory.addItem(player, b.output, units);
                if (!r.success) { lines.push(r.reason); continue; }
                const P = PriceKnowledge.state(player).pnl;
                if (P && P.held) {
                    const h = P.held[b.output] || (P.held[b.output] = { qty: 0, cost: 0, from: null });
                    h.qty += units;
                    h.cost = _r2(h.cost + _num(b.basis));
                    h.from = live.name;
                }
                got += units;
                st.stats.cloth += units;
            }
            st.batches = st.batches.filter(x => x !== b);
            lines.unshift(`${units} ${b.output} from the ${b.qty} ${b.input} put out on day ${b.start}${b.quality < 0.92 ? ' (coarse work)' : b.quality > 1 ? ' (fine work)' : ''}.`);
        }
        return { success: got > 0 || lines.length > 0, text: lines.join(' '), units: got };
    },

    // ── The day ───────────────────────────────────────────

    /**
     * The day's cottage work (from endDay, after the land market and before
     * the markets): the player's batches advance, the towns' draw on their
     * fields follows the season, the houses' weekly putting-out, a linen glut
     * on record. → { notices }.
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function' || !Estates.enabled() || !_obj(world.estates)) return out;
        const C = PuttingOut.config();
        const day = _day(world);
        const st = world.estates;
        const engaged = new Map();
        // The player's batches
        if (player && _obj(player.land) && player.land.batches.length) {
            const ps = player.land;
            const byTown = new Map();
            for (const b of ps.batches) if (!b.done) (byTown.get(b.town) || byTown.set(b.town, []).get(b.town)).push(b);
            for (const [key, list] of byTown) {
                const [q, r] = key.split(',').map(Number);
                const live = Estates._live(world, q, r);
                if (!live) continue;
                const cap = PuttingOut.playerCapacity(live, day);
                const per = cap / list.length;
                let used = 0;
                for (const b of list) {
                    const step = per * _num((C.rates[b.rate] || {}).speed, 1);
                    const left = b.qty - b.worked;
                    const w = Math.min(left, step);
                    b.worked = _r2(b.worked + w);
                    used += w;
                    if (b.worked >= b.qty - 1e-6) {
                        b.done = true;
                        b.readyDay = day;
                        b.units = Math.floor(b.qty * _num((C.goods[b.input] || {}).ratio, 0.9) * _num(b.quality, 1));
                        out.notices.push({ icon: '🧶', title: 'Cloth Ready', text: `The cottagers about ${b.name} have finished your ${b.input}: ${b.units} ${b.output} to collect there.`, type: 'success' });
                    }
                }
                engaged.set(key, _num(engaged.get(key)) + used);
                const rec = st.towns[key];
                if (rec) rec.poAt = day;
            }
            // Uncollected cloth: after holdDays the cottagers sell it in the town
            for (const b of ps.batches.slice()) {
                if (!b.done || day - _num(b.readyDay) < _num(C.holdDays, 60)) continue;
                const live = Estates._live(world, b.q, b.r);
                if (live && b.units > 0) SettlementMarket.add(live, b.output, b.units);
                ps.batches = ps.batches.filter(x => x !== b);
                out.notices.push({ icon: '🧶', title: 'Cloth Sold Off', text: `Nobody came for the ${b.units} ${b.output} at ${b.name}: the cottagers sold it in the market.`, type: 'warning' });
            }
        }
        // The houses' weekly putting-out, each town on its own day; the hands it
        // and the player's work draw from the fields out of the slack season
        const every = Math.max(1, Math.floor(_num(C.npcEvery, 7)));
        const season = Seasons.seasonOf(day);
        const away = _num(C.away[season], 0.5);
        const hhSize = Math.max(1, _num(Estates.config().derive.householdSize, 5));
        const slots = PuttingOut._slots(st, every);
        const mine = slots[day % every] || [];
        for (const rec of mine) PuttingOut._npcWeek(world, player, rec, day);
        // (the draw is worked out again where the work changed today: the towns on
        // their weekly turn, where the player's work is or was yesterday; every town
        // on a season's first day)
        const newSeason = (Seasons.dayOfYear(day) - 1) % Seasons.DAYS_PER_SEASON === 0;
        const prev = Array.isArray(st.poPlayer) ? st.poPlayer : [];
        st.poPlayer = [...engaged.keys()];
        const todo = newSeason ? Object.values(st.towns) : [...mine, ...[...new Set([...prev, ...st.poPlayer])].map(k => st.towns[k]).filter(Boolean)];
        for (const rec of todo) {
            const key = rec.k;
            const e = _num(engaged.get(key)) + _num(rec.npcRate);
            if (!(e > 0) && !(rec.draw > 0)) continue;
            // (worked out again only when the work or the season changes)
            const dk = season + '|' + Math.round(e * 100);
            if (rec.dk === dk) continue;
            rec.dk = dk;
            let draw = 0;
            if (e > 0 && away > 0) {
                const live = Estates._live(world, rec.q, rec.r);
                const peasantsHH = live ? Estates.peasants(live) / hhSize : 0;
                if (peasantsHH > 0) draw = _clamp(e / Math.max(0.01, _num(C.perHousehold, 0.15)) * away / peasantsHH * _num(C.landSensitivity, 0.8), 0, 0.3);
            }
            draw = Math.round(draw * 100) / 100;
            if (draw !== _num(rec.draw)) { rec.draw = draw; Estates.bumpTown(world, key); }
        }
        if (day % 14 === 5) PuttingOut._glut(world, day);
        return out;
    },

    /** The towns by their day of the week (memoised per state until a town comes or goes). */
    _slots(st, every) {
        const n = Object.keys(st.towns).length;
        let c = _slotCache.get(st);
        if (c && c.n === n && c.every === every && c.src === st.towns) return c.by;
        const by = {};
        for (const rec of Object.values(st.towns)) {
            if (!Number.isFinite(rec.poSlot)) rec.poSlot = (Math.abs(rec.q) * 5 + Math.abs(rec.r) * 11) % every;
            (by[rec.poSlot] || (by[rec.poSlot] = [])).push(rec);
        }
        c = { n, every, src: st.towns, by };
        _slotCache.set(st, c);
        return by;
    },

    /** One town's week of the houses' putting-out (none where the weavers hold a royal charter). */
    _npcWeek(world, player, rec, day) {
        const C = PuttingOut.config();
        const live = Estates._live(world, rec.q, rec.r);
        rec.npcRate = 0;
        if (!live || !live.market) return;
        // Last week's cloth comes to market
        if (_obj(rec.npcOut)) {
            for (const [g, n] of Object.entries(rec.npcOut)) if (n > 0) SettlementMarket.add(live, g, n);
            rec.npcOut = null;
        }
        const g = Guilds.guild(live, 'weavers');
        if (g && g.chartered) return;
        const cap = PuttingOut.capacity(live, day) * _clamp(_num(C.npcShare, 0.5), 0, 1) * Math.max(1, _num(C.npcEvery, 7));
        if (!(cap > 0.5)) return;
        const fair = _num((C.rates.fair || {}).share, 0.15);
        let left = cap;
        let total = 0;
        for (const [input, G] of Object.entries(C.goods)) {
            if (!(left > 0.5) || !SettlementMarket.tracks(input) || !SettlementMarket.tracks(G.out)) continue;
            const surplus = SettlementMarket.stock(live, input) - _num(C.npcKeep, 1) * SettlementMarket.target(live, input);
            if (!(surplus > 1)) continue;
            const pin = Estates.priceAt(live, input);
            const pout = Estates.priceAt(live, G.out);
            const ratio = _num(G.ratio, 0.9);
            const margin = ratio * pout - pin - fair * Estates.basePrice(G.out) * ratio;
            if (margin < _num(C.minMargin, 0.1) * ratio * pout) continue;
            const n = Math.min(surplus * 0.5, left);
            const took = SettlementMarket.take(live, input, n);
            if (!(took > 0)) continue;
            left -= took;
            total += took;
            if (!rec.npcOut) rec.npcOut = {};
            rec.npcOut[G.out] = _r2(_num(rec.npcOut[G.out]) + took * ratio * 0.95);
        }
        if (total > 0) {
            rec.npcRate = _r2(total / Math.max(1, _num(C.npcEvery, 7)));
            rec.poAt = day;
            rec.npcWeek = _r2(total);
        }
    },

    /** A realm awash with linen: on record for the heralds and the towns' talk (once per gapDays). */
    _glut(world, day) {
        const G = PuttingOut.config().glut;
        if (!SettlementMarket.tracks('linen')) return;
        const count = new Map();
        for (const s of Estates._views(world)) {
            if (s.kingdom == null) continue;
            const live = Estates._live(world, s.q, s.r);
            if (!live || !live.market || !SettlementMarket.uses(live, 'linen')) continue;
            if (SettlementMarket.scarcity(live, 'linen') < _num(G.below, 0.7)) {
                const c = count.get(s.kingdom) || { n: 0, at: live };
                c.n++;
                count.set(s.kingdom, c);
            }
        }
        const gap = Math.max(7, _num(G.gapDays, 120));
        for (const [kid, c] of count) {
            if (c.n < _num(G.towns, 3)) continue;
            const k = Estates.kingdom(world, kid);
            Estates.record(world, { key: `es:lg:${kid}:${Math.floor(day / gap)}`, kind: 'linen_glut', day, place: c.at.name, q: c.at.q, r: c.at.r, kingdomId: kid, kingdom: k ? k.name : 'the realm', n: c.n, own: false });
        }
    },

    /** The nearest town with cloth of the player's ready to collect, for the counsel: { b, dist } or null. */
    readyTip(player, world) {
        let best = null;
        for (const b of PuttingOut.ready(player)) {
            const d = Hex.wrappingDistance(player.q, player.r, b.q, b.r, world.width);
            if (!best || d < best.dist) best = { b, dist: d };
        }
        return best;
    },
};
