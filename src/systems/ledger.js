// ============================================
// LEDGER — every gold flow the player has, by source, day by day
// ============================================
// One book for the player's money. Anything that earns or spends reports
// the flow with Ledger.record(player, category, signed amount): it lands in
// today's tally (player.financeToday — the running tally many systems
// already wrote into), and when the day ends Ledger.closeDay folds that
// tally into the day's finance row (the turn's own results — taxes, works,
// guild dues, army upkeep... — built by ui/game/endDay.js or the playtest
// harness) and keeps the last `days` rows on player.financeHistory.
//
// Categories carry a kind (data/chronicle.json → ledger.categories):
//   op    earned or spent running your affairs: the income statement
//   cap   capital and stock: goods bought and sold, works and properties
//         bought, loan principal (shown apart, never as profit or loss)
//   memo  paid inside a price (a guild's toll on a sale): shown, not summed
// Trading margins (each sale against the average cost of the good bought)
// come from systems/priceKnowledge.js, which reports them here by channel.
//
// statement(player, world, days) adds up the last `days` days by category
// and group: the Merchant's Ledger shows it for a season and a year.
//
// A leaf module (imports only the data): any system may record into it.
// Draws no RNG. State: player.financeToday, player.financeHistory (saved
// with the player) and player.ledgerMarks (the company's books as last read).

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;

const DEFAULTS = { days: 120, periods: [30, 120], groups: {}, categories: {} };

let _cfgSrc;
let _cfg = null;

export const Ledger = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.chronicle && gd.chronicle.ledger) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = { ...DEFAULTS, ...o, groups: { ...(o.groups || {}) }, categories: { ...(o.categories || {}) } };
        }
        return _cfg;
    },

    /** A category's definition: { id, name, group, kind } (unknown ones are 'op' in 'other'). */
    category(id) {
        const c = Ledger.config().categories[id] || {};
        return { id, name: c.name || String(id).replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()), group: c.group || 'other', kind: c.kind || 'op' };
    },

    group(id) {
        const g = Ledger.config().groups[id] || {};
        return { id, name: g.name || id, icon: g.icon || '❔' };
    },

    /** Today's running tally (created when missing): { income: {}, expenses: {} }. */
    today(player) {
        if (!player) return { income: {}, expenses: {} };
        let t = player.financeToday;
        if (!_obj(t)) t = player.financeToday = { income: {}, expenses: {} };
        if (!_obj(t.income)) t.income = {};
        if (!_obj(t.expenses)) t.expenses = {};
        return t;
    },

    /**
     * A flow of gold (or of worth) for the player: + earned, − spent. Margins
     * may be negative (a loss), kept on the income side so the category nets.
     */
    record(player, category, amount) {
        const a = _num(amount);
        if (!player || !category || !a) return 0;
        const t = Ledger.today(player);
        const kind = Ledger.category(category).kind;
        // Margins and capital flows net within their category; plain spending is an expense
        if (a > 0 || kind !== 'op' || Ledger._netted(category)) t.income[category] = _r2(_num(t.income[category]) + a);
        else t.expenses[category] = _r2(_num(t.expenses[category]) - a);
        return a;
    },

    /** Categories that net gains and losses on one line (trading margins, the company's books). */
    _netted(category) {
        return Ledger.category(category).group === 'trade' && category !== 'forwardPenalties' && category !== 'seaTrade'
            || category === 'company';
    },

    // ── The day's close ─────────────────────────────────────

    /**
     * The turn's results as a finance row's income and expenses (the same
     * sources ui/game/endDay.js reads) — for the playtest harness and any
     * caller without its own: { day, income, expenses }.
     */
    fromResults(world, player, { princeDay = null, guildDay = null, taxCollected = 0, holdingsDay = null, intelCost = 0, propertyUpkeep = 0 } = {}) {
        const row = { day: _num(world && world.day), season: world ? world.season : null, year: world ? world.year : null, goldEnd: _num(player && player.gold), income: {}, expenses: {} };
        const put = (side, k, v) => { if (_num(v) > 0) row[side][k] = _num(row[side][k]) + _num(v); };
        if (princeDay) {
            put('income', 'industry', princeDay.income);
            put('expenses', 'warehouseRent', princeDay.rent);
            put('expenses', 'worksWages', princeDay.wages);
        }
        if (guildDay) {
            put('income', 'guilds', guildDay.income);
            put('expenses', 'guildDues', guildDay.expenses);
        }
        put('income', 'taxes', taxCollected);
        if (holdingsDay) put('expenses', 'holdings', holdingsDay.upkeep);
        put('expenses', 'informants', intelCost);
        put('expenses', 'propertyUpkeep', propertyUpkeep);
        return row;
    },

    /**
     * End of the day: today's recorded flows join the day's row (`dayFinance`,
     * { day, income, expenses, ... }), the company's books since yesterday
     * join as 'company' and 'dividends', the totals are set (op categories
     * only), the row is kept (the last `days`) and a fresh tally begins.
     * Returns the row.
     */
    closeDay(player, world, dayFinance = null) {
        if (!player) return null;
        const row = _obj(dayFinance) || { day: _num(world && world.day), income: {}, expenses: {} };
        if (!_obj(row.income)) row.income = {};
        if (!_obj(row.expenses)) row.expenses = {};
        if (row.goldEnd === undefined) row.goldEnd = _num(player.gold);
        if (row.day === undefined) row.day = _num(world && world.day);
        Ledger._company(player);
        const t = _obj(player.financeToday);
        if (t) {
            for (const [k, v] of Object.entries(_obj(t.income) || {})) if (_num(v)) row.income[k] = _r2(_num(row.income[k]) + _num(v));
            for (const [k, v] of Object.entries(_obj(t.expenses) || {})) if (_num(v)) row.expenses[k] = _r2(_num(row.expenses[k]) + _num(v));
        }
        let inc = 0, exp = 0;
        for (const [k, v] of Object.entries(row.income)) {
            if (Ledger.category(k).kind !== 'op') continue;
            if (_num(v) >= 0) inc += _num(v);
            else exp -= _num(v);
        }
        for (const [k, v] of Object.entries(row.expenses)) if (Ledger.category(k).kind === 'op') exp += _num(v);
        row.totalIncome = Math.round(inc);
        row.totalExpenses = Math.round(exp);
        row.netChange = row.totalIncome - row.totalExpenses;
        if (!Array.isArray(player.financeHistory)) player.financeHistory = [];
        player.financeHistory.push(row);
        const cap = Math.max(1, Math.floor(_num(Ledger.config().days, 120)));
        if (player.financeHistory.length > cap) player.financeHistory.splice(0, player.financeHistory.length - cap);
        player.financeToday = { income: {}, expenses: {} };
        return row;
    },

    /** The trading company's profit since the last close: dividends apart, the rest as 'company'. */
    _company(player) {
        const c = player.merchant && player.merchant.company;
        const pnl = c && _obj(c.pnl);
        if (!pnl) return;
        const sum = (o) => Object.values(_obj(o) || {}).reduce((a, b) => a + _num(b), 0);
        const div = _num(pnl.income && pnl.income.dividends);
        const net = sum(pnl.income) - sum(pnl.expenses) - div;
        const marks = _obj(player.ledgerMarks) || (player.ledgerMarks = {});
        if (marks.co !== c.foundedDay) { marks.co = c.foundedDay; marks.div = div; marks.net = net; return; }
        const dDiv = div - _num(marks.div), dNet = net - _num(marks.net);
        marks.div = div;
        marks.net = net;
        if (dDiv) Ledger.record(player, 'dividends', dDiv);
        if (dNet) Ledger.record(player, 'company', dNet);
    },

    // ── Reading the book ────────────────────────────────────

    /**
     * The last `days` days by category: { days, from, to, op: { income:
     * [{ id, name, group, amount }], expenses: [...], net }, cap: [...],
     * memo: [...], groups: [{ id, name, icon, net }] }.
     */
    statement(player, world, days = 30) {
        const today = _num(world && world.day, Infinity);
        const rows = (player && Array.isArray(player.financeHistory) ? player.financeHistory : [])
            .filter(r => r && (!Number.isFinite(today) || _num(r.day) > today - days));
        const by = {};
        for (const r of rows) {
            for (const [k, v] of Object.entries(_obj(r.income) || {})) by[k] = _num(by[k]) + _num(v);
            for (const [k, v] of Object.entries(_obj(r.expenses) || {})) by[k] = _num(by[k]) - _num(v);
        }
        const out = { days, from: rows.length ? rows[0].day : null, to: rows.length ? rows[rows.length - 1].day : null, op: { income: [], expenses: [], net: 0 }, cap: [], memo: [], groups: [] };
        const groups = {};
        for (const [k, v] of Object.entries(by)) {
            const amount = Math.round(v);
            if (!amount) continue;
            const c = Ledger.category(k);
            const line = { id: k, name: c.name, group: c.group, amount };
            if (c.kind === 'memo') { out.memo.push(line); continue; }
            if (c.kind === 'cap') { out.cap.push(line); continue; }
            (amount >= 0 ? out.op.income : out.op.expenses).push(line);
            out.op.net += amount;
            groups[c.group] = _num(groups[c.group]) + amount;
        }
        const desc = (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || (a.id < b.id ? -1 : 1);
        out.op.income.sort(desc);
        out.op.expenses.sort(desc);
        out.cap.sort(desc);
        out.memo.sort(desc);
        out.groups = Object.entries(groups).map(([id, net]) => ({ ...Ledger.group(id), net: Math.round(net) })).sort((a, b) => b.net - a.net || (a.id < b.id ? -1 : 1));
        return out;
    },

    /** The amount a category came to over the last `days` days (signed: + earned, − spent). */
    total(player, world, category, days = 30) {
        const today = _num(world && world.day, Infinity);
        let s = 0;
        for (const r of (player && Array.isArray(player.financeHistory) ? player.financeHistory : [])) {
            if (!r || (Number.isFinite(today) && _num(r.day) <= today - days)) continue;
            s += _num(r.income && r.income[category]) - _num(r.expenses && r.expenses[category]);
        }
        return Math.round(s * 100) / 100;
    },
};
