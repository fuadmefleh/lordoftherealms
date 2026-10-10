// ActionMenu — the Bourse: share prices with sparkline charts, buying and
// selling, the player's portfolio and dividends, floating their own trading
// company, and the exchange's news (manias, crashes, panics). Logic lives in
// systems/bourse.js; buttons route through data-am-act → ActionMenu.bourseAct.
import { ActionMenu } from './_ref.js';
import { Bourse } from '../../systems/bourse.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 7px 9px; margin: 6px 0;';
const TABS = [['board', '📈 The Board'], ['portfolio', '💼 Portfolio'], ['company', '⚖️ Your Company'], ['news', '📰 News']];
const KIND_LABEL = { house: 'Merchant house', bank: 'Banking house', company: 'Your company', venture: 'Chartered venture', monopoly: 'Royal monopoly' };

let _tab = 'board';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="bourseAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
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
    let html = `<div style="font-size:11px; color:#999;">Prices follow each listing's book value and profits, with the crowd's moods on top. A round trip costs the spread (${Math.round(Bourse.config().spread * 100)}%) and the broker (${Math.round(Bourse.config().commission * 100)}%). Spies in a listing's realm tell you what it is really worth. Market mood ${Math.round(st.mood * 100)}%.</div>`;
    for (const l of Bourse.listed(player)) {
        if (l.kind === 'company') continue;
        const held = (st.holdings[l.id] || {}).shares || 0;
        const insight = Bourse.insight(player, world, l);
        const mania = l.mania ? ` <span style="color:#e0a040;">🎈 ${l.mania.burst ? 'the bubble has burst' : 'a mania'}</span>` : '';
        html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; align-items:center; gap:6px;"><div>${esc(l.icon)} <b>${esc(l.name)}</b> <span style="font-size:10px; color:#999;">${KIND_LABEL[l.kind] || l.kind}</span>${mania}<br>`;
        html += `<span style="font-size:13px;"><b>${l.price.toFixed(2)}g</b></span> ${change(l)} · last dividend ${l.lastDiv.toFixed(2)}g · book ${l.book.toFixed(2)}g${insight ? ` · <span style="color:#9fc7ff;" title="Your informants' reckoning">worth ≈${l.fair.toFixed(2)}g · return ${Math.round(l.roe * 100)}% a year</span>` : ''}${held ? ` · <b>you hold ${held}</b>` : ''}</div>`;
        html += `<div>${sparkline([...(l.history || []), l.price])}</div></div><div>`;
        for (const n of [1, 5, 25]) {
            const q = Bourse.quoteTrade(l, n, 'buy');
            html += act(`Buy ${n} (${Math.ceil(q.total)}g)`, ['buy', l.id, n], BTN_GOLD, atFloor && player.gold >= q.total);
        }
        if (held) {
            for (const n of [...new Set([Math.min(5, held), held])]) html += act(`Sell ${n}`, ['sell', l.id, n], BTN_PLAIN, atFloor);
        }
        html += '</div></div>';
    }
    return html;
}

function portfolioTab(player) {
    const st = Bourse.state(player);
    const rows = Bourse.portfolio(player);
    let html = `<div style="font-size:12px;">Dividends received ${Math.round(st.stats.dividends)}g · brokers paid ${Math.round(st.stats.fees)}g${st.stats.payouts ? ` · buy-outs paid you ${Math.round(st.stats.payouts)}g` : ''}</div>`;
    if (!rows.length) return html + '<div style="color:#aaa; font-size:12px; margin-top:6px;">You hold no shares.</div>';
    let value = 0;
    let cost = 0;
    for (const p of rows) {
        value += p.value;
        cost += p.cost;
        const gain = p.value - p.cost;
        html += `<div style="font-size:12px; margin-top:4px;">${esc(p.listing.icon)} <b>${esc(p.listing.name)}</b>: ${p.shares} share${p.shares === 1 ? '' : 's'} · worth ${Math.round(p.value)}g (paid ${Math.round(p.cost)}g, <span style="color:${gain >= 0 ? '#8fd18f' : '#e08080'};">${gain >= 0 ? '+' : ''}${Math.round(gain)}g</span>) · dividends ${Math.round(p.dividends)}g</div>`;
    }
    html += `<div style="font-size:12px; margin-top:6px;"><b>Total ${Math.round(value)}g</b> for ${Math.round(cost)}g paid.</div>`;
    return html;
}

function companyTab(player, world, atFloor) {
    const c = MerchantHouses.company(player);
    const C = Bourse.config().float;
    if (!c) return '<div style="color:#aaa; font-size:12px;">Found a trading company first: then its shares can be floated here.</div>';
    const outside = (c.float && c.float.outside) || 0;
    const value = MerchantHouses.companyValue(player);
    let html = `<div style="font-size:11px; color:#999;">Float shares of ${esc(c.name)} to raise capital for the company. The brokers buy at ${Math.round(C.discount * 100)}% under its worth and keep ${Math.round(C.fee * 100)}%. Outside shareholders then take ${Math.round(C.payout * 100)}% of each week's profit in proportion to their shares, and their part of anything you draw out. You keep control up to ${C.maxOutside} shares in 100.</div>`;
    html += `<div style="${CARD}">Company worth ${Math.round(value)}g · outsiders hold <b>${outside}</b> of 100 shares${c.float && c.float.raised ? ` · raised ${Math.round(c.float.raised)}g` : ''}`;
    const l = Bourse.listed(player).find(x => x.kind === 'company');
    if (l) html += `<br>Price <b>${l.price.toFixed(2)}g</b> ${sparkline([...(l.history || []), l.price])} · return ${Math.round(l.roe * 100)}% a year`;
    html += '<div>';
    for (const n of [5, 10, 20]) {
        const q = Bourse.floatQuote(player, world, n);
        html += act(`Float ${n} (${q.cash}g to the company)`, ['float', n], BTN_GOLD, atFloor && outside + n <= C.maxOutside && value >= C.minValue);
    }
    if (l && outside > 0) {
        for (const n of [...new Set([Math.min(5, outside), outside])]) {
            const q = Bourse.quoteTrade(l, n, 'buy');
            html += act(`Buy back ${n} (${Math.ceil(q.total)}g)`, ['buyBack', n], BTN_PLAIN, atFloor && player.gold >= q.total);
        }
    }
    html += '</div></div>';
    return html;
}

function newsTab(player, world) {
    const rows = Bourse.recent(player, world, 120).slice().reverse();
    if (!rows.length) return '<div style="color:#aaa; font-size:12px;">A quiet season on the floor.</div>';
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
    return rows.slice(0, 25).map(h => `<div style="font-size:12px; margin-top:3px;">Day ${h.day}: ${(T[h.kind] || (() => esc(h.kind)))(h)}</div>`).join('');
}

Object.assign(ActionMenu, {
    /** The Bourse (on the floor of an exchange in a great capital; read-only elsewhere). */
    showBourse(game) {
        const player = game.player;
        const world = game.world;
        const st = Bourse.state(player);
        const ex = Bourse.exchangeAt(player, world);
        let html = '<div style="font-size:12px; max-height:640px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">${ex ? `The floor of the Bourse of <b>${esc(ex.name)}</b>` : `The Bourse sits at ${st.exchanges.map(e => esc(e.name)).join(' and ') || 'the great capitals'}: trade there.`} · shares held ${Math.round(Bourse.portfolioValue(player))}g · gold ${Math.floor(player.gold)}</p>`;
        html += '<div style="margin:6px 0;">';
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
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
