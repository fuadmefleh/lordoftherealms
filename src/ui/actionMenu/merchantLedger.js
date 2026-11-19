// ActionMenu — the Merchant's Ledger: the player's economic information.
// A price book of every good across the towns the player has news of (with
// the age and source of each price), the best known buy-here, sell-there
// spreads within a few days' travel, the price history of the markets visited
// last, and the player's books: an income statement by source over a season
// or a year (systems/ledger.js — every flow, from the stalls and ports to the
// works, dividends, dues and interest), their net worth
// (systems/economyChronicle.js — one line here, the breakdown on the Chronicle's
// 💰 Your Worth tab) and their trading margins by good and route. The trading
// company's diagnosis lives on its own Ledger tab (merchantHouses.js).
// Everything comes from the player's price book (systems/priceKnowledge.js) —
// what they have seen or been told, never the live markets. Buttons route
// through data-am-act → ActionMenu.merchantLedgerAct.
import { ActionMenu } from './_ref.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { PriceNews } from '../../systems/priceNews.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { PriceAnchors } from '../../world/priceAnchors.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Hex } from '../../core/hex.js';
import { Ledger } from '../../systems/ledger.js';
import { EconomyChronicle } from '../../systems/economyChronicle.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { BTN_GOLD, BTN_PLAIN, panelTabs, lede, bullets, chips, purse, sectionHead, kv, rowList, card, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';

// The action menu's voice (uiKit): muted notes, quiet tables — a head in the
// section-head style and hairline gold row rules
const NOTE = 'font-size: 11px; color: #9d937c;';
const TH = 'text-align:left; padding:3px 6px; font-size:10px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#9d937c; border-bottom:1px solid rgba(245,197,66,0.14);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(245,197,66,0.07);';
const GOOD = '#8fd18a';
const BAD = '#e0846a';
const WARN = '#f0b35a';
const TABS = [['book', '📖 Price Book'], ['spreads', '⚖️ Best Spreads'], ['history', '📈 Price History'], ['post', '📮 News & Post'], ['pnl', '💹 Profit & Loss']];
const RANGES = [3, 5, 8, 12];

const view = { tab: 'book', good: null, days: 8, town: null, period: 30, postTown: null, plantGood: null };

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
    const color = k.age <= C.freshDays ? GOOD : k.age > C.staleDays ? WARN : '#9d937c';
    return `<span title="${esc(src.name)}${k.via ? ` (${esc(k.via)})` : ''}">${src.icon}</span> <span style="color:${color};">${PriceKnowledge.ageText(k.age)}</span>`;
}

/** Trust in a quote: a word and a share, coloured (sure / likely / doubtful / idle talk). */
function trustCell(k) {
    const t = Number.isFinite(k.trust) ? k.trust : PriceKnowledge.trust(k.src, k.age);
    const color = t >= 85 ? GOOD : t >= 65 ? '#d8cfb6' : t >= 45 ? WARN : BAD;
    return `<span style="color:${color};" title="How far to trust it: its source and its age">${PriceNews.trustWord(t)} ${t}%</span>`;
}

function goodPicker(goods) {
    return `<div style="margin:6px 0;">${goods.map(id => act(gname(id), ['good', id], id === view.good ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
}

// ── Price book ──────────────────────────────────────────

function bookTab(game) {
    const { player, world } = game;
    const goods = PriceKnowledge.knownGoods(player);
    if (!goods.length) {
        return lede('You know no prices yet.') + bullets([
            'Visit markets, or buy merchants’ talk in a tavern.',
            'Hail caravans on the road.',
            'Open trading posts, and hold towns whose stewards report.',
        ]);
    }
    if (!goods.includes(view.good)) view.good = goods.includes('grain') ? 'grain' : goods[0];
    let html = goodPicker(goods);
    const list = PriceKnowledge.known(player, world, view.good);
    html += lede(`What ${esc(goodDef(view.good).name.toLowerCase())} cost and fetched when you last had news of each town. Asking prices from hearsay are estimated from what the good was said to be worth.`);
    html += rowList([{ icon: '🗺️', name: 'Show on the trade map', desc: `Every known price of ${esc(goodDef(view.good).name.toLowerCase())}, coloured on the map`, act: 'merchantLedgerAct', args: ['map', view.good], side: '›', tone: 'gold' }]);
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Town</th><th style="${TH}">Asks</th><th style="${TH}">Pays</th><th style="${TH}">Stock</th><th style="${TH}">Hexes</th><th style="${TH}">News</th><th style="${TH}">Trust</th></tr>`;
    for (const k of list) {
        // (labelled against the good's anchor, as SettlementMarket.info: a good dear everywhere for years is its normal)
        const l = PriceAnchors.label(world, view.good, k.scarcity);
        const d = Hex.wrappingDistance(player.q, player.r, k.q, k.r, world.width);
        html += `<tr><td style="${TD}">${esc(k.name)}</td><td style="${TD}">${Utils.formatGold(k.ask)}g</td><td style="${TD}">${Utils.formatGold(k.bid)}g</td><td style="${TD} color:${l.color};">${l.label}</td><td style="${TD}">${d}</td><td style="${TD}">${ageCell(k)}${k.via ? `<br><span style="${NOTE}">${esc(k.via)}</span>` : ''}</td><td style="${TD}">${trustCell(k)}</td></tr>`;
    }
    return html + '</table>';
}

// ── Spreads ─────────────────────────────────────────────

function spreadsTab(game) {
    const { player, world } = game;
    const C = PriceKnowledge.config();
    let html = lede('The best known buy-here, sell-there margins within a few days on foot. Old news may be wrong, and a big lot moves the price against you.');
    html += `<div style="margin:6px 0;"><span style="${NOTE}">Within</span> ${RANGES.map(d => act(`${d} days`, ['days', d], d === view.days ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    const list = PriceKnowledge.spreads(player, world, { days: view.days, limit: 15 });
    if (!list.length) return html + `<div style="${NOTE}">Your news shows no margin within ${view.days} days. Learn more markets.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Good</th><th style="${TH}">Buy at</th><th style="${TH}">Sell at</th><th style="${TH}">Margin</th><th style="${TH}">Oldest news</th></tr>`;
    for (const x of list) {
        html += `<tr><td style="${TD}">${gname(x.good)}</td>`;
        html += `<td style="${TD}">${esc(x.buy.name)} ${Utils.formatGold(x.buy.ask)}g<br><span style="${NOTE}">${ageCell(x.buy)}</span></td>`;
        html += `<td style="${TD}">${esc(x.sell.name)} ${Utils.formatGold(x.sell.bid)}g<br><span style="${NOTE}">${ageCell(x.sell)}</span></td>`;
        html += `<td style="${TD} color:${GOOD};">+${Utils.formatGold(x.margin)}g (${Math.round(x.pct * 100)}%)<br><span style="${NOTE}">${x.dist} hexes apart</span></td>`;
        html += `<td style="${TD}">${PriceKnowledge.ageText(x.age)} ${act('🗺️', ['map', x.good])}</td></tr>`;
    }
    return html + '</table>';
}

// ── History ─────────────────────────────────────────────

function sparkline(points, w = 220, h = 46) {
    if (points.length < 2) return `<span style="${NOTE}">${points.length ? `${Utils.formatGold(points[0].price)}g on day ${points[0].day}` : 'no samples'}</span>`;
    const xs = points.map(p => p.day), ys = points.map(p => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (x) => 4 + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * (w - 8);
    const sy = (y) => h - 6 - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * (h - 14);
    const path = points.map(p => `${sx(p.day).toFixed(1)},${sy(p.price).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    return `<svg width="${w}" height="${h}" style="vertical-align:middle; background:rgba(0,0,0,0.25); border:1px solid rgba(245,197,66,0.1); border-radius:6px;">`
        + `<polyline points="${path}" fill="none" stroke="#ffcf6a" stroke-width="2"/>`
        + `<circle cx="${sx(last.day).toFixed(1)}" cy="${sy(last.price).toFixed(1)}" r="3" fill="#ffcf6a"/>`
        + `<text x="4" y="10" font-size="9" fill="#9d937c">${Utils.formatGold(y1)}g</text><text x="4" y="${h - 1}" font-size="9" fill="#9d937c">${Utils.formatGold(y0)}g</text>`
        + '</svg>'
        + ` <span style="${NOTE}">days ${x0}–${x1}, last ${Utils.formatGold(last.price)}g</span>`;
}

function historyTab(game) {
    const { player } = game;
    const towns = PriceKnowledge.historyTowns(player);
    if (!towns.length) return lede('You keep the prices of the markets you visit. Visit a few and their history shows here.');
    const goods = PriceKnowledge.knownGoods(player);
    if (!goods.includes(view.good)) view.good = goods.includes('grain') ? 'grain' : goods[0];
    let html = lede(`Asking prices you saw in the ${towns.length} markets you visited last (a sample every few days).`);
    html += goodPicker(goods);
    html += sectionHead(`${gname(view.good)} by market`);
    for (const t of towns) {
        html += `<div style="padding:6px 2px; border-bottom:1px solid rgba(245,197,66,0.07);"><div style="font-weight:600; color:#ece2c8; margin-bottom:3px;">${esc(t.name)}</div>${sparkline(PriceKnowledge.history(player, t.q, t.r, view.good))}</div>`;
    }
    return html;
}

// ── News and post ───────────────────────────────────────

/** Towns to send for: the nearest markets (known or not), nearest first. */
function postTowns(world, player) {
    const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() || [] : [];
    return views.filter(v => v && Number.isFinite(v.q) && !(v.q === player.q && v.r === player.r))
        .map(v => ({ q: v.q, r: v.r, name: v.name || 'a town', d: Hex.wrappingDistance(player.q, player.r, v.q, v.r, world.width) }))
        .sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : 1))
        .slice(0, 14);
}

/** The letters on the road, correspondents, how to send for prices, the talk heard and false talk to plant. */
function postTab(game) {
    const { player, world } = game;
    const V = PriceNews.view(player, world);
    const day = world.day || 0;
    let html = lede('News of prices travels as fast as the people who carry it. Send for a town’s prices, keep correspondents, and weigh the talk you hear: some of it is planted to mislead.');
    // Letters on the road
    html += rowList(V.letters.map(L => ({
        icon: L.kind === 'corr' ? '🖋️' : L.kind === 'merchant' ? '📜' : '✉️',
        name: `Prices from ${esc(L.n)}`,
        desc: `${esc(L.via)} · ${L.snap ? `written day ${L.writeDay}` : `to be written about day ${L.writeDay}`}`,
        side: L.due ? `${L.due} d` : 'today',
    })), '✉️ Letters on the road');
    // Correspondents
    const corr = V.corr.map(c => ({
        icon: '🖋️', name: esc(c.n), desc: `Writes every ${c.every} days · ${Utils.formatGold(c.wage)}g a letter · next in ${c.due} d${c.unpaid ? ' · unpaid!' : ''}`,
        act: 'merchantLedgerAct', args: ['dismiss', c.id], side: 'dismiss', tone: c.unpaid ? 'bad' : null,
    }));
    const here = V.here;
    if (here && here.s.market) {
        const mine = V.corr.find(c => c.q === here.q && c.r === here.r);
        for (const ev of PriceNews.config().correspondents.every || [7, 14, 30]) {
            if (mine && mine.every === ev) continue;
            corr.push({
                icon: '➕', name: mine ? `${esc(here.name)}: write every ${ev} days` : `Take on a correspondent in ${esc(here.name)}, every ${ev} days`,
                desc: `${Utils.formatGold(PriceNews.wage(here.type))}g a letter, paid when they write`, act: 'merchantLedgerAct', args: ['corr', ev], side: '›', tone: 'gold',
            });
        }
    }
    html += rowList(corr, '🖋️ Correspondents');
    if (!here) html += `<div style="${NOTE}">Stand in a town to send for prices, take on a correspondent or put talk about.</div>`;
    // Send for a town's prices (the town picked is also the one false talk is about)
    const towns = here ? postTowns(world, player) : [];
    const picked = view.postTown ? towns.find(t => t.q === view.postTown.q && t.r === view.postTown.r) : null;
    if (!picked) view.postTown = null;
    if (here) {
        html += sectionHead('📮 Send for a town’s prices');
        html += `<div style="margin:6px 0;">${towns.map(t => act(`${esc(t.name)} <span style="${NOTE}">${t.d}</span>`, ['postTown', [t.q, t.r]], picked === t ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
        if (picked) {
            html += rowList(PriceNews.letterOptions(player, world, picked.q, picked.r).map(o => ({
                icon: o.icon, name: esc(o.name),
                desc: o.kind === 'merchant'
                    ? `Written there today, here in about ${o.days} d · ${Math.round(o.reliability * 100)}% arrive`
                    : `There and back in about ${o.days} d · the prices of day ${day + o.out} · ${Math.round(o.reliability * 100)}% arrive`,
                act: o.ok ? 'merchantLedgerAct' : null, args: ['letter', [picked.q, picked.r, o.id]],
                off: !o.ok, why: o.why ? esc(o.why) : '', side: price(o.price, (player.gold || 0) >= o.price),
            })));
        }
    }
    // Talk heard
    const heard = V.heard.map(h => {
        const qt = PriceKnowledge.quote(player, world, h.q, h.r, h.g);
        const state = h.checked
            ? (h.f ? `<span style="color:${BAD};">proved false</span>` : `<span style="color:${GOOD};">confirmed</span>`)
            : (qt && qt.news === h.id ? trustCell(qt) : `<span style="${NOTE}">superseded</span>`);
        return {
            icon: '🗣️', name: `${gname(h.g)} ${h.k === 'dear' ? 'dear' : 'cheap'} in ${esc(h.n)}`,
            desc: `Heard ${PriceNews.agoText(day - h.hd)}, as of ${PriceNews.agoText(h.age)} · ${h.on === h.n ? `talk out of ${esc(h.n)}` : `talk heard in ${esc(h.on)}`}`,
            side: state,
        };
    });
    html += rowList(heard, '🗣️ Word on the road');
    if (!heard.length) html += `<div style="${NOTE}">You have heard no talk of prices yet. News of dearths and gluts spreads town to town.</div>`;
    // Plant false talk
    if (here) {
        const goods = PriceNews._goods();
        if (!goods.includes(view.plantGood)) view.plantGood = goods.includes('grain') ? 'grain' : goods[0];
        let body = `<div style="${NOTE}">Pay the talkers of ${esc(here.name)} to spread a lie about the town picked above. Rival houses and caravans that hear it waste a trip. You may be caught: heat with the underworld, a whisperer’s name, the rival houses’ anger.</div>`;
        body += `<div style="margin:6px 0;">${goods.map(id => act(gname(id), ['plantGood', id], id === view.plantGood ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
        if (picked) {
            body += rowList(['dear', 'glut'].map(kind => {
                const c = PriceNews.canPlant(player, world, picked.q, picked.r, view.plantGood, kind);
                return {
                    icon: kind === 'dear' ? '📈' : '📉',
                    name: `“${esc(goodDef(view.plantGood).name)} is ${kind === 'dear' ? 'dear' : 'going cheap'} in ${esc(picked.name)}”`,
                    desc: kind === 'dear' ? 'Lures merchants to haul it there for nothing' : 'Keeps merchants away from that market',
                    act: c.ok ? 'merchantLedgerAct' : null, args: ['plant', kind], off: !c.ok, why: c.why ? esc(c.why) : '',
                    side: c.fee != null ? price(c.fee, c.ok) : '',
                };
            }));
        } else body += `<div style="${NOTE}">Pick a town above first.</div>`;
        html += card(body, { title: 'Put false price talk about', icon: '🐍', tone: 'bad' });
    }
    return html;
}

// ── Profit and loss ─────────────────────────────────────

const col = (n) => `<span style="color:${n >= 0 ? GOOD : BAD};">${n >= 0 ? '+' : ''}${Utils.formatGold(n)}g</span>`;

/** The income statement over the chosen period, by group and category, and the net worth (one line). */
function statementHtml(game) {
    const { player, world } = game;
    const periods = Ledger.config().periods || [30, 120];
    if (!periods.includes(view.period)) view.period = periods[0];
    const st = Ledger.statement(player, world, view.period);
    let html = `<div style="margin:6px 0;"><span style="${NOTE}">Over the last</span> ${periods.map(d => act(d === 30 ? '30 days (a season)' : d === 120 ? '120 days (a year)' : `${d} days`, ['period', d], d === view.period ? BTN_GOLD : BTN_PLAIN)).join('')}</div>`;
    html += lede(`Every gold flow you had, by source${st.from != null ? ` (days ${st.from}–${st.to})` : ''}. Trading lines are margins; the cash paid for goods sits under capital and stock.`);
    if (!st.op.income.length && !st.op.expenses.length && !st.cap.length) return html + `<div style="${NOTE}">Nothing on the books yet: the ledger fills as the days pass.</div>`;
    html += kv('Net income', col(st.op.net));
    if (st.groups.length) html += chips(st.groups.map(g => [g.icon, esc(g.name), col(g.net)]));
    const lines = (list) => list.map(l => `<tr${l.desc ? ` title="${esc(l.desc)}"` : ''}><td style="${TD}">${esc(l.name)} <span style="${NOTE}">${esc(Ledger.group(l.group).icon)}</span></td><td style="${TD} text-align:right;">${col(l.amount)}</td></tr>`).join('');
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Income</th><th style="${TH} text-align:right;"></th></tr>${lines(st.op.income)}`;
    html += `<tr><th style="${TH}">Expenses</th><th style="${TH}"></th></tr>${lines(st.op.expenses)}</table>`;
    if (st.cap.length) html += `${sectionHead('📦 Capital and stock (not profit or loss)')}<table style="width:100%; border-collapse:collapse; font-size:12px;">${lines(st.cap)}</table>`;
    if (st.memo.length) html += `<div style="${NOTE} margin-top:4px;">Of which inside your prices: ${st.memo.map(l => `${esc(l.name)} ${Utils.formatGold(Math.abs(l.amount))}g`).join(' · ')}</div>`;
    // Net worth in one line: the breakdown and its history are the Chronicle's 💰 Your Worth tab
    const nw = EconomyChronicle.netWorth(player, world);
    html += rowList([{ icon: '💰', name: 'Net worth', desc: 'What you own less what you owe, week by week', act: 'merchantLedgerAct', args: ['economy', 'worth'], side: col(nw.total), tone: 'gold' }]);
    return html;
}

/**
 * The trading company's books read for the owner (MerchantHouses.diagnosis):
 * the trading margin with stock at its sale value, the running costs, what
 * thieves and the road took, each post's own books, and why it is making or
 * losing money. '' without a company. Shared with the Trading Company panel.
 */
export function companyDiagnosisHtml(player, world) {
    const d = MerchantHouses.diagnosis(player, world);
    if (!d) return '';
    const g = (n) => `${Utils.formatGold(n)}g`;
    let html = sectionHead('🔎 Why the company makes or loses money');
    html += kv('Sold (stalls and contracts)', g(d.trading.sales + d.trading.contracts));
    html += kv('Bought', g(d.trading.purchases));
    html += kv('Stock held and on the road (at sale value)', g(d.trading.stock + d.trading.inTransit));
    html += kv('Trading margin', col(d.trading.margin));
    html += kv('Wages, rent and running costs', col(-d.overhead.total));
    if (d.losses.robbed + d.losses.convoys + d.losses.skimmed > 0) html += kv('Stolen, lost on the road, skimmed', col(-(d.losses.robbed + d.losses.convoys + d.losses.skimmed)));
    if (d.investments.out > 0) html += kv('Ventures and shares (out / back)', `${g(d.investments.out)} / ${g(d.investments.back)}`);
    const tone = { bad: BAD, warn: WARN, good: GOOD };
    html += d.advice.map(a => `<div style="margin:3px 0; color:${tone[a.tone] || '#ece2c8'};">${a.icon} ${esc(a.text)}</div>`).join('');
    if (d.posts.length) {
        html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:4px;"><tr><th style="${TH}">Post</th><th style="${TH}">Sold</th><th style="${TH}">Bought</th><th style="${TH}">Wages + rent</th><th style="${TH}">Stock</th></tr>`;
        for (const p of d.posts) {
            html += `<tr><td style="${TD}">${esc(p.name)}</td><td style="${TD}">${g(p.sales)}</td><td style="${TD}">${g(p.purchases)}</td><td style="${TD}">${g(p.wages + p.rent)}</td><td style="${TD}">${g(p.stock)}</td></tr>`;
        }
        html += '</table>';
    }
    return html;
}

function pnlTab(game) {
    const p = PriceKnowledge.pnl(game.player);
    let html = statementHtml(game);
    // The company's own books (and why it makes or loses money) live on the Trading Company's Ledger tab
    if (MerchantHouses.company(game.player)) {
        html += rowList([{ icon: '⚖️', name: 'Your trading company’s books', desc: 'Its profit and loss, each post, and why it makes or loses money', act: 'merchantLedgerAct', args: ['company'], side: '›' }]);
    }
    html += sectionHead('⚖️ Your own trading, by good');
    html += lede('Each sale set against the average cost of what you bought of that good (goods found, looted or made count as free).');
    html += kv('Trading profit so far', col(p.total));
    if (!p.goods.length) return html + `<div style="${NOTE}">No trades yet.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><tr><th style="${TH}">Good</th><th style="${TH}">Bought</th><th style="${TH}">Sold</th><th style="${TH}">Profit</th></tr>`;
    for (const g of p.goods) {
        html += `<tr><td style="${TD}">${gname(g.id)}</td><td style="${TD}">${g.bought} for ${Utils.formatGold(g.spent)}g</td><td style="${TD}">${g.sold} for ${Utils.formatGold(g.earned)}g</td><td style="${TD}">${col(g.profit)}</td></tr>`;
    }
    html += '</table>';
    if (p.routes.length) {
        html += sectionHead('Routes');
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
        html += `<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:6px; flex-wrap:wrap;">${chips([purse(player.gold), ['📰', 'News of', `${PriceKnowledge.towns(player).length} towns`]])}${act('📰 Economic Chronicle', ['economy'])}</div>`;
        html += panelTabs(game, {
            id: 'ledger', title: "📒 Merchant's Ledger", tabs: TABS, active: view.tab,
            go: (k) => { ActionMenu.showMerchantLedger(game, k); },
            attrsFor: (k) => `data-am-act="merchantLedgerAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (view.tab === 'spreads') html += spreadsTab(game);
        else if (view.tab === 'history') html += historyTab(game);
        else if (view.tab === 'pnl') html += pnlTab(game);
        else if (view.tab === 'post') html += postTab(game);
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
            case 'postTown': view.postTown = Array.isArray(a) ? { q: Number(a[0]), r: Number(a[1]) } : null; break;
            case 'plantGood': view.plantGood = a; break;
            case 'letter':
            case 'corr':
            case 'dismiss':
            case 'plant': {
                const { player, world } = game;
                const res = op === 'letter' ? PriceNews.orderLetter(player, world, Number(a[0]), Number(a[1]), a[2])
                    : op === 'corr' ? PriceNews.hireCorrespondent(player, world, Number(a))
                        : op === 'dismiss' ? PriceNews.dismissCorrespondent(player, a)
                            : (view.postTown ? PriceNews.plant(player, world, view.postTown.q, view.postTown.r, view.plantGood, a) : { success: false, reason: 'Pick a town first.' });
                if (game.ui && typeof game.ui.showNotification === 'function') {
                    game.ui.showNotification(res.success ? '📮 News & Post' : 'Not possible', res.success ? res.text : res.reason, res.success ? (res.caught ? 'warning' : 'success') : 'warning');
                }
                if (res.success && typeof game.updateUI === 'function') game.updateUI();
                break;
            }
            case 'economy': ActionMenu.showEconomy(game, a || null); return;
            case 'company': ActionMenu.showTradingCompany(game, game.world.getTile(game.player.q, game.player.r), 'overview'); return;
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
