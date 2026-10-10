// ActionMenu — Estates & Land: the estates about the town where you stand
// (holder, tenants, crops, rent, loyalty, worth; buy one, or make an offer),
// your own land (rents, the tenants' mood, improvements, enclosure, selling,
// settling one as a dowry) and the land market near you. Logic lives in
// world/estates.js and systems/landMarket.js; buttons route through
// data-am-act → ActionMenu.estateAct.
import { ActionMenu } from './_ref.js';
import { Estates } from '../../world/estates.js';
import { LandMarket } from '../../systems/landMarket.js';

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TH = 'text-align:left; padding:3px 6px; font-size:11px; color:var(--text-secondary); border-bottom:1px solid rgba(255,255,255,0.1);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(255,255,255,0.05);';
const TABS = [['here', '🌾 Estates here'], ['mine', '🏡 Your land'], ['market', '📜 Land for sale']];
const HOLDER_ICON = { crown: '👑', noble: '🛡️', church: '⛪', town: '🏛️', house: '⚖️', player: '🏡' };

let _tab = 'here';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="estateAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

const loyColor = (v) => (v < 25 ? '#e74c3c' : v < 45 ? '#e67e22' : v > 70 ? '#8fd18f' : 'inherit');

function cropsLine(world, e, live) {
    const o = Estates.output(world, e, live);
    const parts = Object.entries(o.goods).filter(([, n]) => n >= 0.05).map(([g, n]) => `${n.toFixed(1)} ${g}`);
    return parts.length ? `${parts.join(' · ')} a day (${Math.round(o.gross)}g)` : 'nothing yet recorded';
}

function estateCard(game, e, live) {
    const { player, world } = game;
    const C = Estates.config();
    const kind = Estates.kindOf(e.holder);
    const mine = e.holder === 'player';
    const value = LandMarket.value(world, e, live);
    const rent = Math.round(LandMarket.annualRent(world, e, live));
    const x = LandMarket.listing(world, e.id);
    const L = C.rent.levels[e.rent] || C.rent.levels.customary;
    let html = `<div style="${CARD}${mine ? ' border-color: rgba(245,197,66,0.4);' : ''}"><b>${esc(e.name)}</b> <span style="${NOTE}">${HOLDER_ICON[kind] || '🌾'} ${esc(Estates.holderName(world, e.holder))}</span>`;
    if (x) html += ` <span style="color:#f5c542; font-size:11px;">· for sale ${x.price}g</span>`;
    html += `<br><span style="${NOTE}">${Math.round(e.share * C.derive.estateShare * 100)}% of ${esc(live.name)}'s farmland · ${e.hh} tenant households · soil ${Math.round((e.soil || 1) * 100)}%${e.drained ? ' (drained)' : ''}${e.marl > 0 ? ' (marled)' : ''}${e.enclosed > 0 ? ' · <b>enclosed: sheep</b>' : ''}</span>`;
    html += `<br>Crops: ${cropsLine(world, e, live)}`;
    html += `<br>Rent: ${esc(L.label)} ${e.mode === 'kind' ? 'share of the crop' : 'in coin'} · last month ${Math.round(e.lastRent || 0)}g${e.arrears > 0 ? ` <span style="color:#e67e22;">(${e.arrears}g in arrears)</span>` : ''} · tenants' loyalty <span style="color:${loyColor(e.loyalty)};">${e.loyalty}</span>`;
    html += `<br>Worth <b>${value.toLocaleString()}g</b> <span style="${NOTE}">(${rent}g net rent a year at ${(LandMarket.landRate(world, live.kingdom != null ? live.kingdom : null) * 100).toFixed(1)}%)</span>`;
    if (e.works) html += `<br><span style="color:#7cc4e0;">${esc((C.works[e.works.kind] || {}).label || 'Works')} under way until day ${e.works.until}.</span>`;
    if (!mine) {
        const q = LandMarket.buyQuote(player, world, e.id);
        html += '<br>';
        if (q.ok) html += act(`${q.listed ? 'Buy' : 'Offer'} ${q.cost.toLocaleString()}g${q.duty ? ` (incl. ${q.duty}g duty)` : ''}`, ['buy', e.id], BTN_GOLD, player.gold >= q.cost, player.gold >= q.cost ? '' : 'You cannot afford it.');
        else html += `<span style="${NOTE}">${esc(q.reason)}</span>`;
    } else {
        const paid = e.paid || 0;
        html += `<br><span style="${NOTE}">Paid ${paid.toLocaleString()}g${paid ? ` · ${(rent / paid * 100).toFixed(1)}% a year on it` : ''} · rents banked ${Math.round(e.earned || 0)}g${e.fled ? ` · ${e.fled} households fled` : ''}</span><br>`;
        for (const [id, lv] of Object.entries(C.rent.levels)) html += act(esc(lv.label), ['rent', e.id, id], e.rent === id ? BTN_GOLD : BTN_PLAIN);
        html += act('In coin', ['mode', e.id, 'coin'], e.mode === 'coin' ? BTN_GOLD : BTN_PLAIN, true, 'A fixed sum on the usual crop: the tenants carry a bad year');
        html += act('Share of the crop', ['mode', e.id, 'kind'], e.mode === 'kind' ? BTN_GOLD : BTN_PLAIN, true, 'Rent follows the harvest and its price; the tenants like it better');
        html += '<br>';
        for (const k of ['drain', 'marl', 'enclose', 'relet']) {
            const q = LandMarket.worksQuote(player, world, e.id, k);
            if (!q.ok && (k === 'relet' ? !(e.enclosed > 0) : e.enclosed > 0)) continue;
            html += act(`${esc((C.works[k] || {}).label || k)}${q.ok ? ` (${q.cost}g, ${q.days}d)` : ''}`, ['works', e.id, k], k === 'enclose' ? BTN_RED : BTN_PLAIN, q.ok && player.gold >= q.cost, q.ok ? '' : q.reason);
        }
        const sq = LandMarket.sellQuote(player, world, e.id);
        html += '<br>';
        if (sq.ok) {
            html += act(`Sell now ${sq.quick.toLocaleString()}g`, ['sell', e.id, 'quick'], BTN_PLAIN, !!sq.buyer, sq.buyer ? `${sq.buyer} will buy` : 'No buyer about has the purse');
            html += sq.listed ? act('Take off the market', ['sell', e.id, 'withdraw'], BTN_PLAIN) : act(`List at ${sq.list.toLocaleString()}g`, ['sell', e.id, 'list'], BTN_PLAIN);
        }
        const realms = [live.kingdom, player.allegiance].filter((k, i, a) => k != null && a.indexOf(k) === i).map(k => Estates.kingdom(world, k)).filter(k => k && k.isAlive !== false);
        for (const k of realms) html += act(`Settle as a dowry in ${esc(k.name)}`, ['dowry', e.id, k.id], BTN_PLAIN, true, 'Give the estate to a noble house of the realm: reputation there and Prestige');
    }
    html += '</div>';
    return html;
}

function hereTab(game, tile) {
    const { world } = game;
    const live = tile && tile.settlement;
    if (!live) return `<div style="${NOTE}">Stand in a town or village to see the estates about it.</div>`;
    const ests = Estates.estatesOf(world, live.q, live.r);
    const C = Estates.config();
    let html = `<div style="${NOTE}">The farmland about ${esc(live.name)}: ${Math.round((1 - C.derive.estateShare) * 100)}% is the peasants' own freeholds and commons; the rest is held in estates whose tenants pay rent once a month. An estate's crops are the town's own — drain or marl its fields and the town reaps more; enclose them for sheep and it reaps less grain and more wool, and the tenants go. Land is priced at its net rent over the realm's land rate, which follows the crown's bond rate.</div>`;
    if (!ests.length) return html + `<div style="${NOTE}">The estates here are not yet surveyed (tomorrow).</div>`;
    for (const e of ests) html += estateCard(game, e, live);
    return html;
}

function mineTab(game) {
    const { player, world } = game;
    const mine = LandMarket.mine(player, world);
    if (!mine.length) return `<div style="${NOTE}">You hold no land. Estates come on the market when their lords fall into debt or a crown needs money; a holder may also take an offer above the land's worth (the Church never sells). See the estates about any town, or the land for sale near you.</div>`;
    const s = LandMarket.summary(player, world);
    let html = `<div style="${CARD}"><b>${s.n} estate(s)</b> worth ${s.value.toLocaleString()}g · ${s.rent.toLocaleString()}g net rent a year expected${s.yield != null ? ` (${(s.yield * 100).toFixed(1)}% on the ${s.paid.toLocaleString()}g paid)` : ''} · ${s.earned.toLocaleString()}g banked</div>`;
    for (const e of mine) {
        const live = Estates._liveOfKey(world, e.town);
        if (live) html += estateCard(game, e, live);
    }
    const st = LandMarket.playerState(player);
    if (st.log.length) html += `<div style="${NOTE}">${st.log.slice(0, 6).map(l => `Day ${l.day}: ${esc(l.text)}`).join('<br>')}</div>`;
    return html;
}

function marketTab(game) {
    const { player, world } = game;
    const list = LandMarket.listingsNear(world, player.q, player.r, 25);
    let html = `<div style="${NOTE}">Estates on the market within 25 hexes. A listing waits a week for a buyer before the merchant houses, the burghers, the realm's nobles or the Church take it; unsold, its price falls each month.</div>`;
    if (!list.length) return html + `<div style="${NOTE}">No land is for sale near you.</div>`;
    const WHY = { debts: 'its lord is in debt', crown: 'the crown needs money', player: 'yours', default: '' };
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Estate</th><th style="${TH}">Near</th><th style="${TH}">Seller</th><th style="${TH}">Price</th><th style="${TH}">Worth</th><th style="${TH}">Hexes</th><th style="${TH}"></th></tr>`;
    for (const { x, e, live, dist } of list) {
        const value = LandMarket.value(world, e, live);
        html += `<tr><td style="${TD}">${esc(e.name)}</td><td style="${TD}">${esc(live.name)}</td><td style="${TD}">${esc(Estates.holderName(world, x.seller))}${WHY[x.reason] ? ` <span style="${NOTE}">(${WHY[x.reason]})</span>` : ''}</td>`
            + `<td style="${TD}">${x.price.toLocaleString()}g</td><td style="${TD}">${value.toLocaleString()}g</td><td style="${TD}">${dist}</td>`
            + `<td style="${TD}">${x.seller === 'player' ? '' : act('See', ['see', live.q, live.r], BTN_PLAIN)}</td></tr>`;
    }
    return html + '</table>';
}

Object.assign(ActionMenu, {
    /** Estates & land: the estates here, your land, land for sale. */
    showEstates(game, tile = null, tab = null) {
        const { player, world } = game;
        const t = tile || world.getTile(player.q, player.r);
        if (tab) _tab = tab;
        if (!Estates.enabled()) {
            game.ui.showCustomPanel('🌾 Estates', `<div style="${NOTE}">There is no market in land.</div>`);
            return;
        }
        let html = '<div style="font-size:12px; max-height:640px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Gold ${Math.floor(player.gold)}</p><div style="margin:6px 0;">`;
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
        if (_tab === 'mine') html += mineTab(game);
        else if (_tab === 'market') html += marketTab(game);
        else html += hereTab(game, t);
        html += '</div>';
        game.ui.showCustomPanel(`🌾 Estates & Land${t && t.settlement && _tab === 'here' ? ` — ${t.settlement.name}` : ''}`, html);
    },

    estateAct(game, op, a = null, b = null) {
        const { player, world } = game;
        let tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'here'; break;
            case 'see': _tab = 'here'; tile = world.getTile(a, b) || tile; break;
            case 'buy': res = LandMarket.buy(player, world, a); break;
            case 'sell': res = LandMarket.sell(player, world, a, b || 'quick'); break;
            case 'rent': res = LandMarket.setRent(player, world, a, b, null); break;
            case 'mode': res = LandMarket.setRent(player, world, a, null, b); break;
            case 'works': res = LandMarket.improve(player, world, a, b); break;
            case 'dowry': res = LandMarket.dowry(player, world, a, b); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🌾 Estates', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        // An estate of yours far off stays in view on its own town's page
        const e = typeof a === 'string' ? Estates.estate(world, a) : null;
        if (e && _tab === 'here' && e.holder === 'player') {
            const live = Estates._liveOfKey(world, e.town);
            if (live) tile = world.getTile(live.q, live.r) || tile;
        }
        ActionMenu.showEstates(game, tile);
    },
});
