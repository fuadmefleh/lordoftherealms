// ============================================
// THE SEASON'S RECKONING — what the player's doings changed, season by season
// ============================================
// At each season's turn (world/seasons.js: four 30-day seasons) the steward
// sets out what changed since the last one, as a report the UI shows once
// (ui/actionMenu/reckoning.js; setting "seasonReckoning") and keeps in the
// Journal afterwards:
//   - money by source: the Ledger's rows for the season (systems/ledger.js)
//   - the towns whose stalls the player moved: what was bought and sold
//     there and how the stock and price stand now against before the first
//     trade (Trading.buyGoods / sellGoods call noteTrade)
//   - lords' opinions gained and lost, with the deeds they remember from the
//     season (NPCLords.memoryOf)
//   - Prestige (with House.prestigeLog's reasons), renown, karma, fame
//   - the holdings' population, mood and unrest
//   - wars begun and ended, the coalition's stance
//   - the three biggest world events that touched the player (timed world
//     events noted daily, the harvests' record, the House's chronicle)
//
// State on player.reckoning (saved; a save from before the reckoning starts
// one on load): { start: snapshot at the season's start, cur: { towns,
// events } tallied through the season, last: the last report, history: the
// last few reports }. The snapshot is small: gold, Prestige, renown, karma,
// reputation by realm, each living lord's opinion, each holding's numbers,
// wars and the coalition.
//
// processDay(world, player) runs once a day after the books close (from
// ui/game/endDay.js, mirrored in the playtest harness). It draws no RNG and
// changes nothing but player.reckoning.

import { NPCLords } from '../world/npcLords.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Harvests } from '../world/harvests.js';
import { Economy } from '../world/economy.js';
import { Ledger } from './ledger.js';
import { House } from './house.js';
import { Holdings } from './holdings.js';
import { Coalitions } from './coalitions.js';
import { Annals } from './annals.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);

const CFG = {
    historyCap: 8,        // reports kept for the Journal
    townsCap: 12,         // towns tallied in a season
    eventsCap: 24,        // world events noted in a season
    topTowns: 5,
    topLords: 6,
    topEvents: 3,
    minOpinionShift: 1,
};
const SEVERITY = { catastrophic: 5, critical: 4, major: 4, severe: 4, moderate: 3, minor: 2, notice: 2, neutral: 1, info: 1, positive: 2 };

function _seasonKey(world) {
    return `${world && world.year != null ? world.year : 0}:${world && world.season ? world.season : ''}`;
}

export const Reckoning = {
    config() {
        return CFG;
    },

    /** The record (created when missing). */
    state(player) {
        if (!player) return null;
        let r = player.reckoning;
        if (!_obj(r)) r = player.reckoning = { start: null, cur: null, last: null, history: [] };
        if (!_obj(r.cur)) r.cur = { towns: {}, events: [] };
        if (!_obj(r.cur.towns)) r.cur.towns = {};
        if (!Array.isArray(r.cur.events)) r.cur.events = [];
        if (!Array.isArray(r.history)) r.history = [];
        if (r.start !== null && !_obj(r.start)) r.start = null;
        if (r.last !== null && !_obj(r.last)) r.last = null;
        return r;
    },

    // ── The snapshot ──────────────────────────────────────

    /** The player's realm-facing kingdoms: allegiance, holdings, where they stand, their wars. */
    _realms(world, player) {
        const ids = new Set();
        if (player.allegiance != null) ids.add(player.allegiance);
        for (const h of Holdings.list(player, world)) if (h.settlement && h.settlement.kingdom != null) ids.add(h.settlement.kingdom);
        const here = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const hk = here && (here.kingdom != null ? here.kingdom : here.settlement && here.settlement.kingdom);
        if (hk != null) ids.add(hk);
        const wars = player.realmWars && _obj(player.realmWars.wars);
        if (wars) for (const k of Object.keys(wars)) ids.add(isNaN(k) ? k : Number(k));
        return ids;
    },

    /** The small picture of the player's standing kept at a season's start. */
    snapshot(world, player) {
        const day = _num(world && world.day);
        const opinions = {};
        for (const k of _arr(world && world.kingdoms)) {
            if (!k || k.isAlive === false || !k.lord) continue;
            opinions[k.id] = { name: k.name, lord: k.lord.name || '', v: Math.round(NPCLords.getLordOpinion(k.lord, player, world)) };
        }
        const holdings = {};
        for (const h of Holdings.list(player, world)) {
            const s = h.settlement;
            holdings[h.key] = {
                name: s.name || h.key, pop: Math.round(_num(s.population)),
                happy: Math.round(_num(s.happiness, 50)), unrest: Math.round(_num(s.holding && s.holding.unrest)),
            };
        }
        const rep = {};
        for (const [k, v] of Object.entries(_obj(player.reputation) || {})) if (_num(v)) rep[k] = Math.round(_num(v));
        const wars = Object.keys(_obj(player.realmWars && player.realmWars.wars) || {});
        const liege = player.allegiance != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(player.allegiance) : null;
        const c = Coalitions.active(player);
        return {
            day, season: world ? world.season : null, year: world ? world.year : null,
            gold: Math.round(_num(player.gold)), prestige: Math.round(House.getPrestige(player)),
            renown: Math.round(_num(player.renown)), karma: Math.round(_num(player.karma)), rep,
            opinions, holdings, wars, liegeWars: liege ? _arr(liege.wars).slice() : [],
            coalition: c ? { id: c.id, name: c.name || 'the league', members: Coalitions.members(player).length } : null,
        };
    },

    // ── Through the season ────────────────────────────────

    /**
     * A trade at a town's stalls (Trading.buyGoods / sellGoods, called before
     * the stock moves): the tally the report reads, and the stock and price
     * level before the player's first trade there this season.
     */
    noteTrade(player, settlement, goodId, qty, side, gold = 0) {
        if (!player || !settlement || !goodId || !(qty > 0)) return;
        const st = Reckoning.state(player);
        const name = settlement.name || `${settlement.q},${settlement.r}`;
        let t = st.cur.towns[name];
        if (!t) {
            if (Object.keys(st.cur.towns).length >= CFG.townsCap) return;
            t = st.cur.towns[name] = { q: _num(settlement.q, null), r: _num(settlement.r, null), goods: {} };
        }
        let g = t.goods[goodId];
        if (!g) {
            const tracked = SettlementMarket.tracks(goodId) && settlement.market;
            g = t.goods[goodId] = {
                bought: 0, sold: 0, spent: 0, earned: 0,
                s0: tracked ? Math.round(SettlementMarket.stock(settlement, goodId)) : null,
                p0: tracked ? Math.round(SettlementMarket.scarcity(settlement, goodId) * 1000) / 1000 : null,
            };
        }
        if (side === 'buy') { g.bought += qty; g.spent += Math.round(_num(gold)); }
        else { g.sold += qty; g.earned += Math.round(_num(gold)); }
    },

    /** Note the running world events that reach the player's realms (once each). */
    _noteEvents(world, player, st) {
        const realms = Reckoning._realms(world, player);
        for (const ev of _arr(world && world.activeEvents)) {
            if (!ev) continue;
            const key = `${ev.id}|${ev.regionName || ''}|${ev.text || ''}`;
            if (st.cur.events.some(e => e.key === key)) continue;
            const touches = ev.kingdomId == null || realms.has(ev.kingdomId) || (ev.partnerKingdomId != null && realms.has(ev.partnerKingdomId));
            if (!touches) continue;
            if (st.cur.events.length >= CFG.eventsCap) {
                // keep the heaviest
                const lightest = st.cur.events.reduce((m, e, i, a) => (e.score < a[m].score ? i : m), 0);
                if (st.cur.events[lightest].score >= Reckoning._eventScore(ev, realms)) continue;
                st.cur.events.splice(lightest, 1);
            }
            st.cur.events.push({ key, day: _num(world.day), icon: ev.icon || '📜', text: ev.text || ev.name || ev.id, score: Reckoning._eventScore(ev, realms) });
        }
    },

    _eventScore(ev, realms) {
        let s = SEVERITY[ev.severity] || 2;
        if (ev.kingdomId != null && realms.has(ev.kingdomId)) s += 2;
        if (ev.startedWar) s += 2;
        return s;
    },

    /**
     * The day's tick, after the books close: start the record, note the
     * world's events, and at a season's turn build the report (returned) and
     * start the next season's snapshot. { report|null }.
     */
    processDay(world, player) {
        if (!world || !player) return { report: null };
        const st = Reckoning.state(player);
        if (!st.start) {
            st.start = Reckoning.snapshot(world, player);
            return { report: null };
        }
        if (`${st.start.year != null ? st.start.year : 0}:${st.start.season || ''}` === _seasonKey(world)) {
            Reckoning._noteEvents(world, player, st);
            return { report: null };
        }
        const report = Reckoning.report(world, player);
        // Today is the new season's first day: the closed season ended yesterday
        report.toDay = Math.max(report.fromDay, report.toDay - 1);
        st.last = report;
        st.history.push(report);
        if (st.history.length > CFG.historyCap) st.history.splice(0, st.history.length - CFG.historyCap);
        st.start = Reckoning.snapshot(world, player);
        st.cur = { towns: {}, events: [] };
        Reckoning._noteEvents(world, player, st);
        return { report };
    },

    // ── The report ────────────────────────────────────────

    /** What changed from the season's start to now (also "the season so far"). */
    report(world, player) {
        const st = Reckoning.state(player);
        const a = st.start || Reckoning.snapshot(world, player);
        const b = Reckoning.snapshot(world, player);
        const out = {
            season: a.season, year: a.year, fromDay: a.day, toDay: b.day, days: Math.max(0, b.day - a.day),
            money: Reckoning._money(world, player, a, b),
            towns: Reckoning._towns(world, st),
            lords: Reckoning._lords(world, a, b),
            prestige: Reckoning._prestige(player, a, b),
            fame: Reckoning._fame(world, a, b),
            holdings: Reckoning._holdings(a, b),
            wars: Reckoning._wars(world, player, a, b),
            events: Reckoning._events(world, player, st, a),
        };
        out.headline = Reckoning.headline(out);
        return out;
    },

    _money(world, player, a, b) {
        const rows = _arr(player.financeHistory).filter(r => r && _num(r.day) > a.day && _num(r.day) <= b.day);
        const by = {};
        for (const r of rows) {
            for (const [k, v] of Object.entries(_obj(r.income) || {})) by[k] = _num(by[k]) + _num(v);
            for (const [k, v] of Object.entries(_obj(r.expenses) || {})) by[k] = _num(by[k]) - _num(v);
        }
        const income = [], expenses = [];
        let net = 0;
        for (const [k, v] of Object.entries(by)) {
            const amount = Math.round(v);
            if (!amount) continue;
            const c = Ledger.category(k);
            if (c.kind !== 'op') continue;
            (amount > 0 ? income : expenses).push({ id: k, name: c.name, amount });
            net += amount;
        }
        income.sort((x, y) => y.amount - x.amount || (x.id < y.id ? -1 : 1));
        expenses.sort((x, y) => x.amount - y.amount || (x.id < y.id ? -1 : 1));
        return { goldFrom: a.gold, goldTo: b.gold, change: b.gold - a.gold, net, income: income.slice(0, 6), expenses: expenses.slice(0, 6) };
    },

    _towns(world, st) {
        const out = [];
        for (const [name, t] of Object.entries(st.cur.towns)) {
            const tile = world && typeof world.getTile === 'function' && t.q != null ? world.getTile(t.q, t.r) : null;
            const s = tile && tile.settlement;
            const goods = [];
            let volume = 0;
            for (const [id, g] of Object.entries(t.goods)) {
                const tracked = s && s.market && SettlementMarket.tracks(id) && g.p0 != null;
                const p1 = tracked ? SettlementMarket.scarcity(s, id) : null;
                const g0 = Economy._goods()[id.toUpperCase()];
                goods.push({
                    id, name: (g0 && g0.name) || id.replace(/_/g, ' '), bought: g.bought, sold: g.sold, spent: g.spent, earned: g.earned,
                    stockFrom: g.s0, stockTo: tracked ? Math.round(SettlementMarket.stock(s, id)) : null,
                    pricePct: tracked && g.p0 > 0 ? Math.round((p1 / g.p0 - 1) * 100) : null,
                });
                volume += g.bought + g.sold;
            }
            goods.sort((x, y) => (y.bought + y.sold) - (x.bought + x.sold) || (x.id < y.id ? -1 : 1));
            out.push({ name, volume, goods: goods.slice(0, 4) });
        }
        return out.sort((x, y) => y.volume - x.volume || (x.name < y.name ? -1 : 1)).slice(0, CFG.topTowns);
    },

    _lords(world, a, b) {
        const out = [];
        for (const [kid, now] of Object.entries(b.opinions)) {
            const was = a.opinions[kid];
            const from = was ? was.v : null;
            const delta = from == null ? 0 : now.v - from;
            const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(isNaN(kid) ? kid : Number(kid)) || world.getKingdom(kid) : null;
            const deeds = k && k.lord ? NPCLords.memoryOf(k.lord, b.day).filter(m => m.day > a.day && !m.inherited)
                .map(m => ({ icon: m.icon, label: m.label, note: m.note, weight: Math.round(m.weight) })).slice(0, 4) : [];
            const newLord = was && was.lord !== now.lord;
            if (Math.abs(delta) < CFG.minOpinionShift && !deeds.length && !newLord) continue;
            out.push({ kingdomId: kid, realm: now.name, lord: now.lord, from, to: now.v, delta, deeds, newLord: newLord ? was.lord : null });
        }
        return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.realm < y.realm ? -1 : 1)).slice(0, CFG.topLords);
    },

    _prestige(player, a, b) {
        const log = _arr(player.house && player.house.prestigeLog).filter(e => e && _num(e.day) > a.day && _num(e.day) <= b.day);
        const by = {};
        for (const e of log) {
            const r = String(e.reason || 'other').replace(/:.*$/, '').trim() || 'other';
            by[r] = _num(by[r]) + _num(e.delta);
        }
        const reasons = Object.entries(by).map(([reason, delta]) => ({ reason, delta: Math.round(delta) })).filter(r => r.delta)
            .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.reason < y.reason ? -1 : 1)).slice(0, 4);
        return { from: a.prestige, to: b.prestige, delta: b.prestige - a.prestige, reasons };
    },

    _fame(world, a, b) {
        const rep = [];
        const keys = new Set([...Object.keys(a.rep), ...Object.keys(b.rep)]);
        for (const k of keys) {
            const d = _num(b.rep[k]) - _num(a.rep[k]);
            if (!d) continue;
            const kk = world && typeof world.getKingdom === 'function' ? world.getKingdom(isNaN(k) ? k : Number(k)) || world.getKingdom(k) : null;
            rep.push({ realm: kk ? kk.name : String(k), delta: d });
        }
        rep.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.realm < y.realm ? -1 : 1));
        return { renown: { from: a.renown, to: b.renown, delta: b.renown - a.renown }, karma: { from: a.karma, to: b.karma, delta: b.karma - a.karma }, reputation: rep.slice(0, 4) };
    },

    _holdings(a, b) {
        const out = [];
        for (const [key, now] of Object.entries(b.holdings)) {
            const was = a.holdings[key];
            out.push({ name: now.name, gained: !was, popFrom: was ? was.pop : null, popTo: now.pop, happyFrom: was ? was.happy : null, happyTo: now.happy, unrestFrom: was ? was.unrest : null, unrestTo: now.unrest });
        }
        for (const [key, was] of Object.entries(a.holdings)) if (!b.holdings[key]) out.push({ name: was.name, lost: true, popFrom: was.pop, popTo: null, happyFrom: was.happy, happyTo: null, unrestFrom: was.unrest, unrestTo: null });
        return out;
    },

    _wars(world, player, a, b) {
        const nameOf = (id) => {
            const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(isNaN(id) ? id : Number(id)) || world.getKingdom(id) : null;
            return k ? k.name : String(id);
        };
        const began = b.wars.filter(w => !a.wars.includes(w)).map(nameOf);
        const ended = a.wars.filter(w => !b.wars.includes(w)).map(nameOf);
        const liegeBegan = b.liegeWars.filter(w => !a.liegeWars.includes(w)).map(nameOf);
        const liegeEnded = a.liegeWars.filter(w => !b.liegeWars.includes(w)).map(nameOf);
        let coalition = null;
        const ca = a.coalition, cb = b.coalition;
        if (!ca && cb) coalition = `${cb.name} formed against you (${cb.members} realm${cb.members === 1 ? '' : 's'})`;
        else if (ca && !cb) coalition = `${ca.name} against you broke up`;
        else if (ca && cb && ca.id !== cb.id) coalition = `${ca.name} ended; ${cb.name} formed against you`;
        else if (ca && cb && ca.members !== cb.members) coalition = `${cb.name} ${cb.members > ca.members ? 'grew' : 'shrank'} to ${cb.members} realm${cb.members === 1 ? '' : 's'}`;
        else if (cb) coalition = `${cb.name} still stands against you (${cb.members} realm${cb.members === 1 ? '' : 's'})`;
        return { began, ended, liegeBegan, liegeEnded, coalition, atWar: b.wars.map(nameOf) };
    },

    _events(world, player, st, a) {
        const list = st.cur.events.map(e => ({ icon: e.icon, text: e.text, day: e.day, score: e.score }));
        // The harvests the player's realms reaped (world/harvests.js)
        const realms = Reckoning._realms(world, player);
        for (const h of Harvests.history(world)) {
            if (!h || _num(h.day) <= a.day) continue;
            if (h.kingdomId != null && !realms.has(h.kingdomId)) continue;
            const TEXT = {
                famine: ['🥀', `Famine in ${h.place}`, 5], poor: ['🥀', `A poor harvest in ${h.place}${h.pct ? ` (${h.pct}% of a normal year)` : ''}`, 4],
                failing: ['🥀', `The harvest failing in ${h.place}`, 3], blight: ['🦠', `${Harvests.blightName(h.blight)} in ${h.place}${h.from ? `, spread from ${h.from}` : ''}`, 3],
                plenty: ['🌾', `A rich harvest in ${h.place}${h.pct ? ` (${h.pct}% of a normal year)` : ''}`, 3], bumper: ['🌾', `A bumper harvest coming in ${h.place}`, 2],
            }[h.kind];
            if (!TEXT) continue;
            list.push({ icon: TEXT[0], text: TEXT[1], day: h.day, score: TEXT[2] });
        }
        // The House's chronicle: wars, crowns, sieges, deaths (systems/house.js)
        for (const e of _arr(player.house && player.house.history)) {
            if (!e || _num(e.day) <= a.day) continue;
            const w = Annals.weight(e.tags);
            if (w < 4) continue;
            list.push({ icon: '📜', text: e.text, day: e.day, score: Math.min(6, w / 2 + 1) });
        }
        return list.sort((x, y) => y.score - x.score || x.day - y.day).slice(0, CFG.topEvents).map(({ icon, text, day }) => ({ icon, text, day }));
    },

    /** One line: "Spring, year 2: +340g, Prestige +12, Valoria's lord +9, 2 towns' stalls moved." */
    headline(r) {
        const bits = [];
        bits.push(`${r.money.change >= 0 ? '+' : '−'}${Math.abs(r.money.change)}g`);
        if (r.prestige.delta) bits.push(`Prestige ${r.prestige.delta > 0 ? '+' : '−'}${Math.abs(r.prestige.delta)}`);
        const l = r.lords[0];
        if (l && l.delta) bits.push(`${l.realm}'s lord ${l.delta > 0 ? '+' : '−'}${Math.abs(l.delta)}`);
        if (r.towns.length) bits.push(`${r.towns.length} market${r.towns.length === 1 ? '' : 's'} moved by your trade`);
        if (r.wars.began.length) bits.push(`war with ${r.wars.began.join(', ')}`);
        return `${r.season || 'The season'}${r.year != null ? `, year ${r.year}` : ''}: ${bits.join(', ')}`;
    },

    // ── Save and load ─────────────────────────────────────

    serialize(player) {
        const r = player && _obj(player.reckoning);
        return r ? JSON.parse(JSON.stringify(r)) : null;
    },

    /** After a load: an older save starts its record now (the season's report counts from the load). */
    loadState(player, world = null) {
        if (!player) return;
        const st = Reckoning.state(player);
        if (!st.start && world) st.start = Reckoning.snapshot(world, player);
    },
};
