// ActionMenu — the Merchant's Ledger: the player's economic information.
// A price book of every good across the towns the player has news of (with
// the age and source of each price), the best known buy-here, sell-there
// spreads within a few days' travel, the price history of the markets visited
// last, and the player's books: an income statement by source over a season
// or a year (systems/ledger.js — every flow, from the stalls and ports to the
// works, dividends, dues and interest), their net worth
// (systems/economyChronicle.js) and their trading margins by good and route.
// Everything comes from the player's price book (systems/priceKnowledge.js) —
// what they have seen or been told, never the live markets. Buttons route
// through data-am-act → ActionMenu.merchantLedgerAct.
import { ActionMenu } from './_ref.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Hex } from '../../core/hex.js';
import { Ledger } from '../../systems/ledger.js';
import { EconomyChronicle } from '../../systems/economyChronicle.js';
import { BTN_GOLD, BTN_PLAIN, panelTabs } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TH = 'text-align:left; padding:3px 6px; color:var(--gold); font-weight:normal; border-bottom:1px solid rgba(255,255,255,0.12);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(255,255,255,0.05);';
const TABS = [['book', '📖 Price Book'], ['spreads', '⚖️ Best Spreads'], ['history', '📈 Price History'], ['pnl', '💹 Profit & Loss']];
const RANGES = [3, 5, 8, 12];

const view = { tab: 'book', good: null, days: 8, town: null, period: 30 };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function goodDef(id) {
    const gd = DataLoader._gamedata;
    const goods = (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
    return goods[String(id).toUpperCase()] || { id, name: id, icon: '📦' };
}

const gname = (id) => `${goodDef(id).icon || ''} ${esc(goodDef(id).name)}`;

function act(label, args, style = BTN_PLAIN) {
    return `<button data-am-act="merchantLedgerAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}">${label}</button>`;
}

function ageCell(k) {
    const src = PriceKnowledge.sourceInfo(k.src);
    const C = PriceKnowledge.config();
    const color = k.age <= C.freshDays ? '#2ecc71' : k.age > C.staleDays ? '#e67e22' : 'var(--text-secondary)';
    return `<span title="${esc(src.name)}">${src.icon}</span> <span style="color:${color};">${PriceKnowledge.ageText(k.age)}</span>`;
}

function goodPicker(goods) {
    return `<div style="margin:6px 0;">${goods.map(id => act(gname(id), ['good', id], id === view.good ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
}

// ── Price book ──────────────────────────────────────────

function bookTab(game) {
    const { player, world } = game;
    const goods = PriceKnowledge.knownGoods(player);
    if (!goods.length) return `<div style="${NOTE}">You know no prices yet. Visit markets, buy merchants' talk in a tavern, hail caravans on the road, or open trading posts and hold towns whose stewards report.</div>`;
    if (!goods.includes(view.good)) view.good = goods.includes('grain') ? 'grain' : goods[0];
    let html = goodPicker(goods);
    const list = PriceKnowledge.known(player, world, view.good);
    html += `<div style="${NOTE}">What ${esc(goodDef(view.good).name.toLowerCase())} cost and fetched when you last had news of each town. Asking prices from hearsay are estimated from what the good was said to be worth. ${act('🗺️ Show on the trade map', ['map', view.good], BTN_GOLD)}</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Town</th><th style="${TH}">Asks</th><th style="${TH}">Pays</th><th style="${TH}">Stock</th><th style="${TH}">Hexes</th><th style="${TH}">News</th></tr>`;
    for (const k of list) {
        const l = SettlementMarket.label(k.scarcity);
        const d = Hex.wrappingDistance(player.q, player.r, k.q, k.r, world.width);
        html += `<tr><td style="${TD}">${esc(k.name)}</td><td style="${TD}">${k.ask}g</td><td style="${TD}">${k.bid}g</td><td style="${TD} color:${l.color};">${l.label}</td><td style="${TD}">${d}</td><td style="${TD}">${ageCell(k)}</td></tr>`;
    }
    return html + '</table>';
}

// ── Spreads ─────────────────────────────────────────────

function spreadsTab(game) {
    const { player, world } = game;
    const C = PriceKnowledge.config();
    let html = `<div style="${NOTE}">The best margins your news shows between two towns within reach (about ${C.hexesPerDay} hexes a day): buy at the cheapest known asking price, sell where the stalls are known to pay most. Old news may be wrong, and a big lot moves the price against you.</div>`;
    html += `<div style="margin:6px 0;">Within ${RANGES.map(d => act(`${d} days`, ['days', d], d === view.days ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    const list = PriceKnowledge.spreads(player, world, { days: view.days, limit: 15 });
    if (!list.length) return html + `<div style="${NOTE}">Your news shows no margin within ${view.days} days. Learn more markets.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Good</th><th style="${TH}">Buy at</th><th style="${TH}">Sell at</th><th style="${TH}">Margin</th><th style="${TH}">Oldest news</th></tr>`;
    for (const x of list) {
        html += `<tr><td style="${TD}">${gname(x.good)}</td>`;
        html += `<td style="${TD}">${esc(x.buy.name)} ${x.buy.ask}g<br><span style="${NOTE}">${ageCell(x.buy)}</span></td>`;
        html += `<td style="${TD}">${esc(x.sell.name)} ${x.sell.bid}g<br><span style="${NOTE}">${ageCell(x.sell)}</span></td>`;
        html += `<td style="${TD} color:#2ecc71;">+${x.margin}g (${Math.round(x.pct * 100)}%)<br><span style="${NOTE}">${x.dist} hexes apart</span></td>`;
        html += `<td style="${TD}">${PriceKnowledge.ageText(x.age)} ${act('🗺️', ['map', x.good])}</td></tr>`;
    }
    return html + '</table>';
}

// ── History ─────────────────────────────────────────────

function sparkline(points, w = 220, h = 46) {
    if (points.length < 2) return `<span style="${NOTE}">${points.length ? `${points[0].price}g on day ${points[0].day}` : 'no samples'}</span>`;
    const xs = points.map(p => p.day), ys = points.map(p => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (x) => 4 + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * (w - 8);
    const sy = (y) => h - 6 - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * (h - 14);
    const path = points.map(p => `${sx(p.day).toFixed(1)},${sy(p.price).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    return `<svg width="${w}" height="${h}" style="vertical-align:middle; background:rgba(255,255,255,0.03); border-radius:4px;">`
        + `<polyline points="${path}" fill="none" stroke="#f5c542" stroke-width="2"/>`
        + `<circle cx="${sx(last.day).toFixed(1)}" cy="${sy(last.price).toFixed(1)}" r="3" fill="#f5c542"/>`
        + `<text x="4" y="10" font-size="9" fill="#aaa">${y1}g</text><text x="4" y="${h - 1}" font-size="9" fill="#aaa">${y0}g</text>`
        + '</svg>'
        + ` <span style="${NOTE}">days ${x0}–${x1}, last ${last.price}g</span>`;
}

function historyTab(game) {
    const { player } = game;
    const towns = PriceKnowledge.historyTowns(player);
    if (!towns.length) return `<div style="${NOTE}">You keep the prices of the markets you visit. Visit a few and their history shows here.</div>`;
    const goods = PriceKnowledge.knownGoods(player);
    if (!goods.includes(view.good)) view.good = goods.includes('grain') ? 'grain' : goods[0];
    let html = `<div style="${NOTE}">Asking prices you saw in the ${towns.length} markets you visited last (a sample every few days).</div>`;
    html += goodPicker(goods);
    for (const t of towns) {
        html += `<div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);"><b>${esc(t.name)}</b><br>${sparkline(PriceKnowledge.history(player, t.q, t.r, view.good))}</div>`;
    }
    return html;
}

// ── Profit and loss ─────────────────────────────────────

const col = (n) => `<span style="color:${n >= 0 ? '#2ecc71' : '#e74c3c'};">${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString()}g</span>`;

/** The income statement over the chosen period, by group and category, and the net worth. */
function statementHtml(game) {
    const { player, world } = game;
    const periods = Ledger.config().periods || [30, 120];
    if (!periods.includes(view.period)) view.period = periods[0];
    const st = Ledger.statement(player, world, view.period);
    let html = `<div style="margin:6px 0;">Over the last ${periods.map(d => act(d === 30 ? '30 days (a season)' : d === 120 ? '120 days (a year)' : `${d} days`, ['period', d], d === view.period ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    html += `<div style="${NOTE}">Every gold flow you had, by source. Trading lines are margins: each sale against the average cost of what you bought (the cash for the goods is under capital and stock). ${st.from != null ? `Days ${st.from}–${st.to}.` : ''}</div>`;
    if (!st.op.income.length && !st.op.expenses.length && !st.cap.length) return html + `<div style="${NOTE}">Nothing on the books yet: the ledger fills as the days pass.</div>`;
    html += `<div style="margin:6px 0; font-size:13px;">Net income: <b>${col(st.op.net)}</b></div>`;
    if (st.groups.length) html += `<div style="font-size:11px; margin-bottom:4px;">${st.groups.map(g => `${g.icon} ${esc(g.name)} ${col(g.net)}`).join(' · ')}</div>`;
    const lines = (list) => list.map(l => `<tr><td style="${TD}">${esc(l.name)} <span style="${NOTE}">${esc(Ledger.group(l.group).icon)}</span></td><td style="${TD} text-align:right;">${col(l.amount)}</td></tr>`).join('');
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Income</th><th style="${TH} text-align:right;"></th></tr>${lines(st.op.income)}`;
    html += `<tr><th style="${TH}">Expenses</th><th style="${TH}"></th></tr>${lines(st.op.expenses)}</table>`;
    if (st.cap.length) html += `<h5 style="margin:8px 0 4px;">📦 Capital and stock (not profit or loss)</h5><table style="width:100%; border-collapse:collapse; font-size:12px;">${lines(st.cap)}</table>`;
    if (st.memo.length) html += `<div style="${NOTE} margin-top:4px;">Of which inside your prices: ${st.memo.map(l => `${esc(l.name)} ${Math.abs(l.amount).toLocaleString()}g`).join(' · ')}</div>`;
    const nw = EconomyChronicle.netWorth(player, world);
    const A = nw.assets;
    html += `<h5 style="margin:10px 0 4px;">💰 Net worth: ${col(nw.total)}</h5>`;
    html += `<div style="${NOTE}">gold ${A.gold.toLocaleString()} · deposits ${A.deposits.toLocaleString()} · bonds ${A.bonds.toLocaleString()} · goods ${A.goods.toLocaleString()} · properties ${A.properties.toLocaleString()} · works ${A.works.toLocaleString()} · ships ${A.ships.toLocaleString()} · company ${A.company.toLocaleString()} − debts ${(nw.debts.loans + nw.debts.guildLoans + nw.debts.arrears).toLocaleString()} ${act('📰 More', ['economy', 'worth'])}</div>`;
    return html;
}

function pnlTab(game) {
    const p = PriceKnowledge.pnl(game.player);
    let html = statementHtml(game);
    html += '<h5 style="margin:12px 0 4px;">⚖️ Trading margins by good</h5>';
    html += `<div style="${NOTE}">Your dealings at the stalls, ports, store-rooms, forward contracts and with traders on the road: each sale against the average cost of what you bought of that good (goods found, looted or made count as free). Routes run from where you last bought the good to where you sold it.</div>`;
    html += `<div style="margin:6px 0; font-size:13px;">Trading profit so far: <b>${col(p.total)}</b></div>`;
    if (!p.goods.length) return html + `<div style="${NOTE}">No trades yet.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Good</th><th style="${TH}">Bought</th><th style="${TH}">Sold</th><th style="${TH}">Profit</th></tr>`;
    for (const g of p.goods) {
        html += `<tr><td style="${TD}">${gname(g.id)}</td><td style="${TD}">${g.bought} for ${g.spent.toLocaleString()}g</td><td style="${TD}">${g.sold} for ${g.earned.toLocaleString()}g</td><td style="${TD}">${col(g.profit)}</td></tr>`;
    }
    html += '</table>';
    if (p.routes.length) {
        html += '<h5 style="margin:10px 0 4px;">Routes</h5>';
        html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Route</th><th style="${TH}">Sales</th><th style="${TH}">Goods</th><th style="${TH}">Profit</th></tr>`;
        for (const r of p.routes) {
            const goods = Object.entries(r.goods).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => goodDef(id).icon || id).join(' ');
            html += `<tr><td style="${TD}">${esc(r.route)}</td><td style="${TD}">${r.trips}</td><td style="${TD}">${goods}</td><td style="${TD}">${col(r.profit)}</td></tr>`;
        }
        html += '</table>';
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Merchant's Ledger: price book, best spreads, price history, profit and loss. */
    showMerchantLedger(game, tab = null) {
        if (tab) view.tab = tab;
        const { player } = game;
        let html = '<div style="font-size:12px;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">💰 ${Math.floor(player.gold).toLocaleString()} gold · news of ${PriceKnowledge.towns(player).length} towns ${act('📰 Economic Chronicle', ['economy'])}</p>`;
        html += panelTabs(game, {
            id: 'ledger', title: "📒 Merchant's Ledger", tabs: TABS, active: view.tab,
            go: (k) => { ActionMenu.showMerchantLedger(game, k); },
            attrsFor: (k) => `data-am-act="merchantLedgerAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (view.tab === 'spreads') html += spreadsTab(game);
        else if (view.tab === 'history') html += historyTab(game);
        else if (view.tab === 'pnl') html += pnlTab(game);
        else html += bookTab(game);
        html += '</div>';
        game.ui.showCustomPanel("📒 Merchant's Ledger", html);
    },

    /** Every button on the ledger: op + its argument. */
    merchantLedgerAct(game, op, a = null) {
        switch (op) {
            case 'tab': view.tab = a || 'book'; break;
            case 'good': view.good = a; break;
            case 'days': view.days = Number(a) || 8; break;
            case 'period': view.period = Number(a) || 30; break;
            case 'economy': ActionMenu.showEconomy(game, a || null); return;
            case 'map':
                // The trade map, on this good
                if (game.renderer) {
                    game.renderer.tradeMapGood = a;
                    if (game.ui && typeof game.ui.setMapMode === 'function') game.ui.setMapMode('prices');
                }
                return;
            default: return;
        }
        ActionMenu.showMerchantLedger(game);
    },
});
