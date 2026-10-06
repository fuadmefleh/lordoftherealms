// ============================================
// MARKET FAIRS & MARKET NEWS — the seasons of trade
// ============================================
// Fairs: on fixed days of the year (data/merchantPrince.json → fairs) the
// great towns hold fairs. Merchants from afar bring stock — real goods put
// into the town's store (world/settlementMarket.js), which then sell, spoil
// and travel on along the trade links like any other — and while the fair
// is on the stalls deal closer: the market asks less (SettlementMarket.fairAsk,
// read by Economy.marketAskBase) and pays more for what it buys
// (Trading.sellShare), still never above buying it back (Trading.saleUnitCap).
// The fair lives on the town's market (market.fair) and is saved with it.
//
// News: every few days the worst food dearth in the world, and in the weeks
// after the harvest the deepest grain glut at a city or capital, are put on
// record for the heralds to cry (systems/heralds.js reads the records on
// player.merchantPrince.history: market_fair, market_dearth, market_glut);
// the tavern's merchants talk of fairs on or coming (fairsNear).
//
// World-level and deterministic: no RNG, no player state but the records.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { MerchantPrince } from './merchantPrince.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const FOOD_STAPLES = ['grain', 'bread', 'fish', 'meat'];

export const MarketFairs = {

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.merchantPrince) || {};
    },

    /** The fairs of the year: [{ id, name, day, days, sites, goods, ask, sell }]. */
    list() {
        const f = _obj(MarketFairs.data().fairs);
        return (f && Array.isArray(f.list) ? f.list : []).filter(x => x && x.id && Number.isFinite(x.day));
    },

    news() {
        return {
            every: 7, dearthScarcity: 1.6, glutScarcity: 0.68, harvestWindow: [64, 96], minType: 'town', repeatDays: 40, tavernRadius: 20, tavernAhead: 10,
            ...(_obj(MarketFairs.data().news) || {}),
        };
    },

    /** The settlements a fair is held at (live ones, in world order). */
    sites(world, fair) {
        const out = [];
        const sites = Array.isArray(fair.sites) ? fair.sites : ['capital'];
        const seen = new Set();
        const add = (s) => {
            if (!s || seen.has(`${s.q},${s.r}`)) return;
            const t = world.getTile(s.q, s.r);
            if (!t || !t.settlement) return;
            seen.add(`${s.q},${s.r}`);
            out.push(t.settlement);
        };
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        if (sites.includes('capital')) {
            for (const k of world.kingdoms || []) {
                if (k.isAlive === false || !k.capital) continue;
                add(views.find(s => s.q === k.capital.q && s.r === k.capital.r) || null);
            }
        }
        for (const s of views) if (sites.includes(s.type)) add(s);
        return out;
    },

    /** Open a fair at a town: the merchants' goods land in its store. */
    open(world, s, fair) {
        const m = SettlementMarket.ensure(s);
        if (!m) return null;
        const day = _day(world);
        for (const [id, share] of Object.entries(fair.goods || {})) {
            if (!SettlementMarket.uses(s, id)) continue;
            const n = Math.round(SettlementMarket.target(s, id) * _num(share));
            if (n > 0) SettlementMarket.add(s, id, n);
        }
        m.fair = {
            id: fair.id, name: fair.name || 'Fair', start: day, until: day + Math.max(1, _num(fair.days, 7)) - 1,
            ask: _num(fair.ask, 1), sell: _num(fair.sell, 0.7),
        };
        return m.fair;
    },

    /** Fairs on now: [{ settlement, fair }]. */
    current(world) {
        const out = [];
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            const f = SettlementMarket.fair(s);
            if (f) out.push({ settlement: s, fair: f });
        }
        return out;
    },

    /** The next fair of the year after `day`: { fair, inDays }. */
    next(day) {
        const doy = Seasons.dayOfYear(day);
        let best = null;
        for (const f of MarketFairs.list()) {
            let d = f.day - doy;
            if (d <= 0) d += Seasons.DAYS_PER_YEAR;
            if (!best || d < best.inDays) best = { fair: f, inDays: d };
        }
        return best;
    },

    /**
     * Fairs within `radius` of (q, r) that are on, or open within `ahead`
     * days: [{ name, town, q, r, on, inDays, dist }], nearest first.
     */
    fairsNear(world, q, r, radius = null, ahead = null) {
        const N = MarketFairs.news();
        const rad = radius == null ? N.tavernRadius : radius;
        const ah = ahead == null ? N.tavernAhead : ahead;
        const out = [];
        const W = (world && world.width) || 0;
        const near = (s) => Math.abs(s.r - r) <= rad && Hex.wrappingDistance(q, r, s.q, s.r, W) <= rad;
        for (const { settlement: s, fair } of MarketFairs.current(world)) {
            if (near(s)) out.push({ name: fair.name, town: s.name, q: s.q, r: s.r, on: true, inDays: 0, until: fair.until, dist: Hex.wrappingDistance(q, r, s.q, s.r, W) });
        }
        const doy = Seasons.dayOfYear(_day(world));
        for (const f of MarketFairs.list()) {
            let d = f.day - doy;
            if (d < 0) d += Seasons.DAYS_PER_YEAR;
            if (!(d > 0 && d <= ah)) continue;
            for (const s of MarketFairs.sites(world, f)) {
                if (near(s)) out.push({ name: f.name, town: s.name, q: s.q, r: s.r, on: false, inDays: d, dist: Hex.wrappingDistance(q, r, s.q, s.r, W) });
            }
        }
        out.sort((a, b) => (a.inDays - b.inDays) || (a.dist - b.dist));
        return out;
    },

    _rank(type) {
        return { village: 0, town: 1, city: 2, capital: 3 }[type] || 0;
    },

    /** Put the week's market news on record for the heralds. */
    _news(world, player, out) {
        const N = MarketFairs.news();
        const day = _day(world);
        if (day % Math.max(1, _num(N.every, 7)) !== 0) return;
        const st = MerchantPrince.state(player);
        const recent = (kind, name) => st.history.some(h => h.kind === kind && h.place === name && day - _num(h.day) < _num(N.repeatDays, 40));
        const minRank = MarketFairs._rank(N.minType);
        let dearth = null, glut = null;
        const doy = Seasons.dayOfYear(day);
        const harvest = Array.isArray(N.harvestWindow) && doy >= N.harvestWindow[0] && doy <= N.harvestWindow[1];
        for (const s of world.getSettlementViews()) {
            if (!s.market) continue;
            const rank = MarketFairs._rank(s.type);
            if (rank >= minRank && SettlementMarket.inDearth(s)) {
                let worst = null;
                for (const id of FOOD_STAPLES) {
                    if (!SettlementMarket.uses(s, id)) continue;
                    const sc = SettlementMarket.scarcity(s, id);
                    if (!worst || sc > worst.sc) worst = { id, sc };
                }
                if (worst && worst.sc >= N.dearthScarcity && !recent('dearth', s.name) && (!dearth || worst.sc > dearth.sc)) dearth = { s, ...worst };
            }
            if (harvest && rank >= 2) {
                const sc = SettlementMarket.scarcity(s, 'grain');
                if (sc <= N.glutScarcity && SettlementMarket.stock(s, 'grain') >= 20 && !recent('glut', s.name) && (!glut || sc < glut.sc)) glut = { s, id: 'grain', sc };
            }
        }
        for (const [kind, x] of [['dearth', dearth], ['glut', glut]]) {
            if (!x) continue;
            const h = MerchantPrince.record(player, world, {
                key: `mkt:${kind}:${x.s.name}:${day}`, kind, place: x.s.name, q: x.s.q, r: x.s.r, kingdomId: x.s.kingdom || null,
                good: MerchantPrince.goodName(x.id).replace(/^\S+\s/, ''), pct: Math.round((x.sc - 1) * 100),
            });
            if (h) out.news.push(h);
        }
    },

    /**
     * One day: close the fairs that are over, open the ones whose day has
     * come, and put the week's market news on record. Run before the
     * markets' day (MarketDynamics.updatePrices). → { opened, closed, news, notices }
     */
    processDay(world, player) {
        const out = { opened: [], closed: [], news: [], notices: [] };
        if (!world || typeof world.getSettlementViews !== 'function') return out;
        const day = _day(world);
        for (const { settlement: s, fair } of MarketFairs.current(world)) {
            if (day > _num(fair.until)) {
                delete s.market.fair;
                out.closed.push({ town: s.name, name: fair.name });
            }
        }
        const doy = Seasons.dayOfYear(day);
        for (const f of MarketFairs.list()) {
            if (f.day !== doy) continue;
            for (const s of MarketFairs.sites(world, f)) {
                if (SettlementMarket.fair(s)) continue;
                MarketFairs.open(world, s, f);
                out.opened.push({ town: s.name, name: f.name, q: s.q, r: s.r });
                if (player) {
                    MerchantPrince.record(player, world, { key: `fair:${f.id}:${s.name}:${day}`, kind: 'fair', place: s.name, fair: f.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, days: _num(f.days, 7) });
                    if (player.q === s.q && player.r === s.r) {
                        out.notices.push({ icon: '🎪', title: f.name, text: `The ${f.name} opens in ${s.name}: merchants from afar fill the square, and the stalls deal closer for ${_num(f.days, 7)} days.`, type: 'success' });
                    }
                }
            }
        }
        if (player) MarketFairs._news(world, player, out);
        return out;
    },
};
