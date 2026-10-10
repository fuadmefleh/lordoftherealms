// ActionMenu — the Economic Chronicle: the realms' economies as the gazettes
// the player has read report them (systems/economyChronicle.js →
// world/economyIndex.js): a comparison table, charts of each realm's
// indices, the sharpest shortages and gluts the price book knows
// (systems/priceKnowledge.js — town-level news only from what the player
// saw or was told), the fashions at court the player has heard of
// (world/fashions.js), and their own worth. Buttons route through
// data-am-act → ActionMenu.economyAct.
import { ActionMenu } from './_ref.js';
import { EconomyChronicle } from '../../systems/economyChronicle.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { EconomyIndex } from '../../world/economyIndex.js';

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TH = 'text-align:left; padding:3px 6px; color:var(--gold); font-weight:normal; border-bottom:1px solid rgba(255,255,255,0.12);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(255,255,255,0.05);';
const TABS = [['realms', '🏛️ Realms'], ['charts', '📈 Charts'], ['markets', '🏪 Shortages & Gluts'], ['fashions', '👗 Fashions'], ['worth', '💰 Your Worth']];
const SERIES = [['food', '🍞 Food'], ['goods', '🧺 Cost of living'], ['trade', '🐫 Trade'], ['short', '⚠️ Shortages'], ['idle', '✊ Idle hands'], ['welfare', '😊 Welfare'], ['treasury', '👑 Treasury'], ['debt', '📜 Debt ratio'], ['level', '💰 Price level (coin)'], ['coin', '💰 Coin about']];

const view = { tab: 'realms', realm: null, series: 'food' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_PLAIN) {
    return `<button data-am-act="economyAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}">${label}</button>`;
}

const idx = (v) => (v == null ? '—' : `${Math.round(v * 100)}`);
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
const hot = (v, warm = 1.15, cold = 0.85) => (v == null ? 'var(--text-secondary)' : v >= warm ? '#e67e22' : v <= cold ? '#5dade2' : 'var(--text-primary)');
const updown = (v) => (v == null ? 'var(--text-secondary)' : v > 0.05 ? '#e67e22' : v < -0.05 ? '#2ecc71' : 'var(--text-secondary)');

/** A small line chart of { x, y } points (oldest first). */
function sparkline(points, { w = 260, h = 54, color = '#f5c542', fmt = (v) => String(Math.round(v)) } = {}) {
    if (points.length < 2) return `<span style="${NOTE}">${points.length ? `${fmt(points[0].y)} on day ${points[0].x}` : 'not enough gazettes yet'}</span>`;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (x) => 4 + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * (w - 8);
    const sy = (y) => h - 6 - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * (h - 14);
    const path = points.map(p => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    return `<svg width="${w}" height="${h}" style="vertical-align:middle; background:rgba(255,255,255,0.03); border-radius:4px;">`
        + `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="2"/>`
        + `<circle cx="${sx(last.x).toFixed(1)}" cy="${sy(last.y).toFixed(1)}" r="3" fill="${color}"/>`
        + `<text x="4" y="10" font-size="9" fill="#aaa">${esc(fmt(y1))}</text><text x="4" y="${h - 1}" font-size="9" fill="#aaa">${esc(fmt(y0))}</text>`
        + '</svg>'
        + ` <span style="${NOTE}">days ${x0}–${x1}, last ${esc(fmt(last.y))}</span>`;
}

const SERIES_FMT = {
    food: (v) => `${Math.round(v * 100)}`, goods: (v) => `${Math.round(v * 100)}`, idle: (v) => `${Math.round(v * 100)}%`,
    welfare: (v) => `${Math.round(v * 100)}`, debt: (v) => `${Math.round(v * 100)}%`, treasury: (v) => `${Math.round(v).toLocaleString()}g`,
    level: (v) => `${Math.round(v * 100)}`, coin: (v) => `${Math.round(v).toLocaleString()}g`,
};

// ── Realms ──────────────────────────────────────────────

function realmsTab(game) {
    const g = EconomyChronicle.gazette(game.player, game.world);
    if (!g.realms.length && !g.world) {
        return `<div style="${NOTE}">You have read no gazette yet. Every town with a market posts one each week: the realms' prices, trade, work and money. Stand in a market town to read it.</div>`;
    }
    let html = `<div style="${NOTE}">From the gazettes you have read${g.at ? `, the last at ${esc(g.at)} on day ${g.read}` : ''}. Indices: 100 = goods at their base price (season, scarcity, debased coin and the coin about all count; 'coin' is the realm's price level from its coin in circulation, 100 = the world's norm). Your own realm's gazette is this week's; other realms' news is a week older. Changes are over the last ${EconomyIndex.config().changeWeeks} weeks.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Realm</th><th style="${TH}">Food</th><th style="${TH}">Cost of living</th><th style="${TH}">Change</th><th style="${TH}">Trade</th><th style="${TH}">Short / dearth</th><th style="${TH}">Idle</th><th style="${TH}">Treasury</th><th style="${TH}">Debt · coin</th><th style="${TH}">As of</th></tr>`;
    const row = (name, x, link) => {
        const n = x.now, t = x.then;
        const ch = t && t.goods > 0 ? n.goods / t.goods - 1 : null;
        const fch = t && t.food > 0 ? n.food / t.food - 1 : null;
        return `<tr><td style="${TD}">${link}</td>`
            + `<td style="${TD} color:${hot(n.food)};">${idx(n.food)}${fch != null ? ` <span style="font-size:10px; color:${updown(fch)};">${pct(fch)}</span>` : ''}</td>`
            + `<td style="${TD} color:${hot(n.goods)};">${idx(n.goods)}</td>`
            + `<td style="${TD} color:${updown(ch)};">${pct(ch)}</td>`
            + `<td style="${TD}">${Math.round(n.trade).toLocaleString()}</td>`
            + `<td style="${TD}">${n.short} / ${n.dearth} <span style="${NOTE}">of ${n.towns}</span></td>`
            + `<td style="${TD}">${Math.round(n.idle * 100)}%</td>`
            + `<td style="${TD}">${n.treasury == null ? '—' : `${Math.round(n.treasury).toLocaleString()}g`}</td>`
            + `<td style="${TD}">${n.debt == null ? '—' : `${Math.round(n.debt * 100)}%`}${n.purity != null && n.purity < 1 ? ` · <span style="color:#e67e22;">${Math.round(n.purity * 100)}% silver</span>` : ''}${n.level != null && Math.abs(n.level - 1) >= 0.02 ? ` · <span style="color:${n.level > 1 ? '#e8a040' : '#7cc4e0'};" title="Price level from the coin about (100 = the world's norm)">coin ${Math.round(n.level * 100)}</span>` : ''}</td>`
            + `<td style="${TD}">day ${x.asOf}</td></tr>`;
    };
    for (const r of g.realms) html += row(r.name, r, act(`${esc(r.name)}${r.alive ? '' : ' †'}`, ['realm', r.id], view.realm === r.id ? BTN_GOLD : BTN_PLAIN));
    if (g.world && g.world.now) html += row('The world', g.world, '<b>🌍 The world</b>');
    return html + '</table>';
}

// ── Charts ──────────────────────────────────────────────

function chartsTab(game) {
    const g = EconomyChronicle.gazette(game.player, game.world);
    const list = [...g.realms.map(r => ({ id: r.id, name: r.name, history: r.history })), ...(g.world ? [{ id: '*', name: 'The world', history: g.world.history }] : [])];
    if (!list.length) return `<div style="${NOTE}">No gazette read yet.</div>`;
    if (!list.some(x => x.id === view.realm)) view.realm = list[0].id;
    let html = `<div style="margin:6px 0;">${list.map(x => act(esc(x.name), ['realm', x.id], x.id === view.realm ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    html += `<div style="margin:6px 0;">${SERIES.map(([id, label]) => act(label, ['series', id], id === view.series ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    const sel = list.find(x => x.id === view.realm);
    const fmt = SERIES_FMT[view.series] || ((v) => String(Math.round(v)));
    html += `<div style="padding:6px 0;"><b>${esc(sel.name)}</b> — ${esc((SERIES.find(s => s[0] === view.series) || [])[1] || view.series)}<br>`;
    html += sparkline(sel.history.filter(r => r[view.series] != null).map(r => ({ x: r.day, y: r[view.series] })), { fmt }) + '</div>';
    // Every known realm's food index side by side
    html += '<h5 style="margin:10px 0 4px;">Food in every realm you have news of</h5>';
    for (const x of list) {
        html += `<div style="padding:2px 0;"><span style="display:inline-block; width:120px;">${esc(x.name)}</span>${sparkline(x.history.map(r => ({ x: r.day, y: r.food })), { w: 200, h: 34, fmt: SERIES_FMT.food })}</div>`;
    }
    return html;
}

// ── Shortages and gluts ─────────────────────────────────

function marketsTab(game) {
    const { player, world } = game;
    const sig = EconomyChronicle.marketSignals(player, world, { limit: 10 });
    let html = `<div style="${NOTE}">The sharpest shortages and gluts in your price book: only towns you visited, your factors and stewards report, merchants you met or tavern talk told of. Old news may be wrong.</div>`;
    const table = (title, list, color) => {
        let t = `<h5 style="margin:10px 0 4px;">${title}</h5>`;
        if (!list.length) return t + `<div style="${NOTE}">None that you know of.</div>`;
        t += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Good</th><th style="${TH}">Town</th><th style="${TH}">Stock</th><th style="${TH}">Asks</th><th style="${TH}">Pays</th><th style="${TH}">News</th></tr>`;
        for (const x of list) {
            const src = PriceKnowledge.sourceInfo(x.src);
            t += `<tr><td style="${TD}">${x.icon} ${esc(x.name)}</td><td style="${TD}">${esc(x.town)}</td><td style="${TD} color:${color};">${Math.round(x.scarcity * 100)}%</td><td style="${TD}">${x.ask}g</td><td style="${TD}">${x.bid}g</td><td style="${TD}"><span title="${esc(src.name)}">${src.icon}</span> ${PriceKnowledge.ageText(x.age)}</td></tr>`;
        }
        return t + '</table>';
    };
    html += table('⚠️ Short (dear)', sig.short, '#e67e22');
    html += table('📦 Glutted (cheap)', sig.glut, '#5dade2');
    return html;
}

// ── Fashions ────────────────────────────────────────────

function fashionsTab(game) {
    const { player, world } = game;
    const list = EconomyChronicle.knownFashions(player, world);
    let html = `<div style="${NOTE}">Fashions at court move what the nobles and merchants buy for a season: their goods grow dear where the fashion reaches, and exotic goods no market keeps fetch more. They spread from a capital and fade. The heralds, the gazette and the tavern carry the news; a patron with standing at a court can set one (Patronage → Fashion at Court).</div>`;
    if (!list.length) return html + `<div style="${NOTE} margin-top:6px;">You have heard of no fashion yet.</div>`;
    for (const x of list) {
        const d = x.def || {};
        const goods = x.goods.map(g => `${g.icon} ${esc(g.name)} ${g.mult >= 1 ? `+${Math.round((g.mult - 1) * 100)}%` : `${Math.round((g.mult - 1) * 100)}%`}`).join(' · ');
        html += `<div style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">`;
        html += `<b>${d.icon || '👗'} ${esc(d.name || x.fashion.id)}</b> <span style="${NOTE}">from ${esc(x.fashion.place)}${x.fashion.by === 'player' ? ' (set by you)' : ''} · day ${x.fashion.start}</span><br>`;
        html += `<span style="font-size:11px;">${esc(d.text || '')}</span><br><span style="font-size:11px;">${goods}</span><br>`;
        html += `<span style="${NOTE}">${x.running ? `${esc(x.stage)} · ${x.daysLeft} days left` : `over (day ${x.fashion.end})`}</span></div>`;
    }
    return html;
}

// ── Worth ───────────────────────────────────────────────

function worthTab(game) {
    const { player, world } = game;
    const nw = EconomyChronicle.netWorth(player, world);
    const A = nw.assets, D = nw.debts;
    const line = (label, v, neg = false) => (v ? `<tr><td style="${TD}">${label}</td><td style="${TD} text-align:right; color:${neg ? '#e74c3c' : 'var(--text-primary)'};">${neg ? '−' : ''}${Math.round(v).toLocaleString()}g</td></tr>` : '');
    let html = `<div style="margin:6px 0; font-size:13px;">Net worth: <b style="color:${nw.total >= 0 ? '#2ecc71' : '#e74c3c'};">${Math.round(nw.total).toLocaleString()}g</b></div>`;
    html += `<table style="border-collapse:collapse; font-size:12px; min-width:280px;">`;
    html += line('💰 Gold in hand', A.gold) + line('🏦 Bank deposits', A.deposits) + line('📜 Royal bonds', A.bonds)
        + line('📦 Goods (at the best price you know the stalls pay)', A.goods) + line('🏠 Properties (book value)', A.properties)
        + line('🏭 Works (what you put in, as they stand)', A.works) + line('⛵ Ships', A.ships) + line('⚖️ Trading company', A.company)
        + line('Loans owed', D.loans, true) + line('Guild loans', D.guildLoans, true) + line('Rent in arrears', D.arrears, true);
    html += '</table>';
    html += '<h5 style="margin:10px 0 4px;">Week by week</h5>';
    html += sparkline(EconomyChronicle.worthHistory(player).map(p => ({ x: p.day, y: p.worth })), { fmt: (v) => `${Math.round(v).toLocaleString()}g` });
    html += `<div style="margin-top:8px;">${act('📒 Income statement (Merchant\'s Ledger)', ['ledger'], BTN_GOLD)}</div>`;
    return html;
}

Object.assign(ActionMenu, {
    /** The Economic Chronicle: realms, charts, shortages and gluts, fashions, your worth. */
    showEconomy(game, tab = null) {
        if (tab) view.tab = tab;
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += `<div style="margin:6px 0;">${TABS.map(([id, label]) => act(label, ['tab', id], view.tab === id ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
        if (view.tab === 'charts') html += chartsTab(game);
        else if (view.tab === 'markets') html += marketsTab(game);
        else if (view.tab === 'fashions') html += fashionsTab(game);
        else if (view.tab === 'worth') html += worthTab(game);
        else html += realmsTab(game);
        html += '</div>';
        game.ui.showCustomPanel('📰 The Economic Chronicle', html);
    },

    /** Every button on the chronicle: op + its argument. */
    economyAct(game, op, a = null) {
        switch (op) {
            case 'tab': view.tab = a || 'realms'; break;
            case 'realm': view.realm = a; if (view.tab === 'realms') view.tab = 'charts'; break;
            case 'series': view.series = a || 'food'; break;
            case 'ledger': ActionMenu.showMerchantLedger(game, 'pnl'); return;
            default: return;
        }
        ActionMenu.showEconomy(game);
    },
});
