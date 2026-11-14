// ActionMenu — the Bourse: share prices with sparkline charts, buying and
// selling, the player's portfolio and dividends, floating their own trading
// company, and the exchange's news (manias, crashes, panics). Logic lives in
// systems/bourse.js; buttons route through data-am-act → ActionMenu.bourseAct.
import { ActionMenu } from './_ref.js';
import { Bourse } from '../../systems/bourse.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, panelTabs, lede, chips, purse, actRow, rowList, price } from './uiKit.js';

const TABS = [['board', '📈 The Board'], ['portfolio', '💼 Portfolio'], ['company', '⚖️ Your Company'], ['news', '📰 News']];
const KIND_LABEL = { house: 'Merchant house', bank: 'Banking house', company: 'Your company', venture: 'Chartered venture', monopoly: 'Royal monopoly' };

let _tab = 'board';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small buttons for a listing row's side column (the row itself is then not a button)
const SMALL = 'padding:2px 8px; margin:2px 0 0 4px; font-size:11px;';
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="bourseAct" data-am-args='${esc(JSON.stringify(args))}' style="${style} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** A small inline SVG line of the weekly prices (and today's), coloured by the trend. */
function sparkline(values, w = 120, h = 28) {
    const v = values.filter(x => Number.isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (x - lo) / span * (h - 2)).toFixed(1)}`).join(' ');
    const color = v[v.length - 1] >= v[0] ? '#7cc47c' : '#d06868';
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function change(l) {
    const h = l.history || [];
    if (!h.length) return '';
    const from = h[Math.max(0, h.length - 5)];
    if (!(from > 0)) return '';
    const pct = (l.price / from - 1) * 100;
    return `<span style="color:${pct >= 0 ? '#8fd18f' : '#e08080'};">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
}

function boardTab(player, world, atFloor) {
    const st = Bourse.state(player);
    const C = Bourse.config();
    let html = lede(`Prices follow each listing's book value and profits, with the crowd's moods on top. A round trip costs the spread (${Math.round(C.spread * 100)}%) and the broker (${Math.round(C.commission * 100)}%); spies in a listing's realm tell you what it is really worth.`);
    html += chips([['🌡️', 'Market mood', `${Math.round(st.mood * 100)}%`]]);
    const rows = [];
    for (const l of Bourse.listed(player)) {
        if (l.kind === 'company') continue;
        const held = (st.holdings[l.id] || {}).shares || 0;
        const insight = Bourse.insight(player, world, l);
        const mania = l.mania ? ` <span style="color:#e0a040;">🎈 ${l.mania.burst ? 'the bubble has burst' : 'a mania'}</span>` : '';
        let side = '';
        for (const n of [1, 5, 25]) {
            const q = Bourse.quoteTrade(l, n, 'buy');
            side += act(`Buy ${n} · ${Math.ceil(q.total)}g`, ['buy', l.id, n], BTN_GOLD, atFloor && player.gold >= q.total);
        }
        if (held) for (const n of [...new Set([Math.min(5, held), held])]) side += act(`Sell ${n}`, ['sell', l.id, n], BTN_PLAIN, atFloor);
        rows.push(actRow({
            icon: esc(l.icon),
            name: `${esc(l.name)} <span class="pk-price">${l.price.toFixed(2)}<small>g</small></span> ${change(l)}${mania}`,
            desc: `${KIND_LABEL[l.kind] || esc(l.kind)} · dividend ${l.lastDiv.toFixed(2)}g · book ${l.book.toFixed(2)}g${held ? ` · <b>you hold ${held}</b>` : ''}`,
            note: `${sparkline([...(l.history || []), l.price])}${insight ? ` <span style="color:#9fc7ff;" title="Your informants' reckoning">worth ≈${l.fair.toFixed(2)}g · return ${Math.round(l.roe * 100)}% a year</span>` : ''}`,
            side,
        }));
    }
    return html + rowList(rows, 'Listings');
}

function portfolioTab(player) {
    const st = Bourse.state(player);
    const rows = Bourse.portfolio(player);
    let value = 0;
    let cost = 0;
    for (const p of rows) { value += p.value; cost += p.cost; }
    let html = chips([
        { icon: '💼', label: 'Worth', value: `${Math.round(value)}g`, cls: 'gold' },
        ['🧾', 'Paid', `${Math.round(cost)}g`],
        ['💰', 'Dividends', `${Math.round(st.stats.dividends)}g`],
        ['🤝', 'Brokers', `${Math.round(st.stats.fees)}g`],
        st.stats.payouts ? ['🏁', 'Buy-outs paid you', `${Math.round(st.stats.payouts)}g`] : null,
        st.stats.buyBacks ? ['↩️', 'Bought back', `${Math.round(st.stats.buyBacks)}g`] : null,
    ]);
    if (!rows.length) return html + lede('You hold no shares. Buy them on 📈 The Board, on the floor of an exchange.');
    html += rowList(rows.map(p => {
        const gain = p.value - p.cost;
        return {
            icon: esc(p.listing.icon), name: `${esc(p.listing.name)} <span style="font-weight:400; color:#9d937c;">× ${p.shares}</span>`,
            desc: `paid ${Math.round(p.cost)}g · dividends ${Math.round(p.dividends)}g · <span style="color:${gain >= 0 ? '#8fd18a' : '#e0846a'};">${gain >= 0 ? '+' : ''}${Math.round(gain)}g</span>`,
            side: `${Math.round(p.value)}g`, tone: 'gold',
        };
    }), 'Your shares');
    return html;
}

function companyTab(player, world, atFloor) {
    const c = MerchantHouses.company(player);
    const C = Bourse.config().float;
    if (!c) return lede('Found a trading company first: then its shares can be floated here.');
    const outside = (c.float && c.float.outside) || 0;
    const value = MerchantHouses.companyValue(player);
    let html = lede(`Float shares of ${esc(c.name)} to raise capital. The brokers buy at ${Math.round(C.discount * 100)}% under its worth and keep ${Math.round(C.fee * 100)}%; outsiders then take ${Math.round(C.payout * 100)}% of each week's profit by their shares, and their part of anything you draw out. You keep control up to ${C.maxOutside} shares in 100.`);
    const l = Bourse.listed(player).find(x => x.kind === 'company');
    html += chips([
        { icon: '⚖️', label: 'Worth', value: `${Math.round(value)}g`, cls: 'gold' },
        ['👥', 'Outsiders hold', `${outside} of 100`],
        c.float && c.float.raised ? ['💰', 'Raised', `${Math.round(c.float.raised)}g`] : null,
        l ? ['📈', 'Price', `${l.price.toFixed(2)}g · ${Math.round(l.roe * 100)}% a year`] : null,
    ]);
    const rows = [];
    for (const n of [5, 10, 20]) {
        const q = Bourse.floatQuote(player, world, n);
        const ok = atFloor && outside + n <= C.maxOutside && value >= C.minValue;
        const why = !atFloor ? 'Only on the floor of an exchange' : outside + n > C.maxOutside ? `You would lose control (more than ${C.maxOutside} outside)` : `The company must be worth ${C.minValue}g`;
        rows.push({ icon: '⚖️', name: `Float ${n} shares`, desc: `${q.cash}g to the company`, act: 'bourseAct', args: ['float', n], off: !ok, why, side: `+${q.cash}g`, tone: 'gold' });
    }
    if (l && outside > 0) {
        for (const n of [...new Set([Math.min(5, outside), outside])]) {
            const q = Bourse.quoteTrade(l, n, 'buy');
            const ok = atFloor && player.gold >= q.total;
            rows.push({ icon: '↩️', name: `Buy back ${n} shares`, desc: 'From the outside holders, at the board price', act: 'bourseAct', args: ['buyBack', n], off: !ok, why: atFloor ? 'Your purse is short' : 'Only on the floor of an exchange', side: price(q.total, player.gold >= q.total) });
        }
    }
    return html + rowList(rows) + (l ? `<div style="margin-top:4px;">${sparkline([...(l.history || []), l.price])}</div>` : '');
}

function newsTab(player, world) {
    const rows = Bourse.recent(player, world, 120).slice().reverse();
    if (!rows.length) return lede('A quiet season on the floor.');
    const T = {
        mania: h => `🎈 A mania for ${esc(h.listing)} at ${esc(h.place || 'the Bourse')}.`,
        crash: h => `📉 ${esc(h.listing)} crashes${h.bank ? `; ${esc(h.bank)} loses ${h.amount}g it lent on the shares` : ''}.`,
        panic: h => `😱 Panic on the floor: ${h.why === 'bank_failed' ? `${esc(h.bank || 'a house')} has failed` : `${esc(h.kingdom || 'a crown')} defaults`}.`,
        fleet_lost: h => `🌊 ${esc(h.listing)} has lost a fleet: ${h.pct}% of its capital.`,
        revoked: h => `👑 The crown revokes the charter of ${esc(h.listing)}: ${h.pct}% of its capital gone.`,
        float: h => `⚖️ ${esc(h.listing)} floats ${h.pct} shares.`,
        delisted: h => `🤝 ${esc(h.listing)} is bought out; its shareholders are paid.`,
        wiped: h => `💀 ${esc(h.listing)} is struck from the board: its shares are worthless.`,
    };
    return rowList(rows.slice(0, 25).map(h => ({ name: `<span style="font-weight:400;">${(T[h.kind] || (() => esc(h.kind)))(h)}</span>`, side: `<span style="color:#9d937c; font-size:10.5px;">day ${h.day}</span>` })));
}

Object.assign(ActionMenu, {
    /** The Bourse (on the floor of an exchange in a great capital; read-only elsewhere). */
    showBourse(game) {
        const player = game.player;
        const world = game.world;
        const st = Bourse.state(player);
        const ex = Bourse.exchangeAt(player, world);
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold), ['💼', 'Shares', `${Math.round(Bourse.portfolioValue(player))}g`], ex ? { icon: '🏛️', label: 'On the floor at', value: esc(ex.name), cls: 'gold' } : null]);
        if (!ex) html += `<div class="pk-row-why" style="font-size:11px; margin-bottom:6px;">Read-only here: shares change hands on the floor at ${st.exchanges.map(e => esc(e.name)).join(' and ') || 'the great capitals'}.</div>`;
        html += panelTabs(game, {
            id: 'bourse', title: '📈 The Bourse', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showBourse(game); },
            attrsFor: (k) => `data-am-act="bourseAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'portfolio') html += portfolioTab(player);
        else if (_tab === 'company') html += companyTab(player, world, !!ex);
        else if (_tab === 'news') html += newsTab(player, world);
        else html += boardTab(player, world, !!ex);
        html += '</div>';
        game.ui.showCustomPanel('📈 The Bourse', html);
    },

    bourseAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'board'; break;
            case 'buy': res = Bourse.buy(player, world, a, b); break;
            case 'sell': res = Bourse.sell(player, world, a, b); break;
            case 'float': res = Bourse.float(player, world, a); break;
            case 'buyBack': res = Bourse.buyBack(player, world, a); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('📈 The Bourse', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showBourse(game);
    },
});
