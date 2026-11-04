// ActionMenu — Lots & Town Houses: every building lot and house in town the
// player holds (systems/lots.js holdingsView): its town, its state (an empty
// lot, building, built; a house rented or owned), the tenant, the rent, the
// day it was last paid and any arrears — and what can be done with each:
// raise a house to let on an empty lot, let a house / take it off the
// letting, put a tenant out, give up a rented house, sell a lot or a house.
// Opened from the world action menu in town ('town_lots') and from a lot or
// house of the player's on the town map (ui/innerMapLots.js). Buttons route
// through data-am-act → townLotsAct.
import { ActionMenu } from './_ref.js';
import { Lots } from '../../systems/lots.js';
import { LotBook } from '../../world/lotBook.js';
import { BTN_GOLD, BTN_PLAIN, BTN_RED, CARD, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const STATE = {
    empty: ['📜', 'Empty lot', '#ccc'],
    building: ['🏗️', 'Building', '#f5c542'],
    built: ['🏠', 'Built', '#9fd89f'],
    rented: ['🔑', 'You rent it', '#8fc7ff'],
    owned: ['🏠', 'Yours outright', '#9fd89f'],
};

function act(label, args, style = BTN_PLAIN, title = '') {
    return `<button data-am-act="townLotsAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function daysAgo(world, d) {
    if (d == null) return 'not yet';
    const n = Math.max(0, Math.round(Number(world && world.day) - d));
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

function row(game, v) {
    const { world, player } = game;
    const [icon, label, color] = STATE[v.state] || STATE.empty;
    const here = player.q === v.q && player.r === v.r;
    const args = (op) => [op, v.q, v.r, v.ref];
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:8px; align-items:baseline;">`;
    html += `<div style="font-weight:bold; color:var(--gold);">${icon} ${esc(v.name || 'House')} <span style="font-weight:normal; color:#aaa;">· ${esc(v.town)}${here ? ' (here)' : ''}</span></div>`;
    html += `<div style="font-size:11px; color:${color}; flex-shrink:0;">${label}${v.state === 'building' && v.daysLeft ? ` — ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left` : ''}</div></div>`;

    const facts = [];
    if (v.what) facts.push(`On it: ${esc(v.what)}`);
    if (v.state === 'rented') {
        facts.push(`Rent ${v.rent}g a day, paid by you`);
        facts.push(`Last paid ${daysAgo(world, v.paidDay)}`);
    } else if (v.tenant) {
        facts.push(`Tenant: <b>${esc(v.tenant)}</b>`);
        facts.push(`Rent ${v.rent}g a day`);
        facts.push(`Last paid ${daysAgo(world, v.paidDay)}`);
        if (v.owed > 0) facts.push(`<span style="color:#e08080;">Owes ${v.owed}g (${v.missed} day${v.missed === 1 ? '' : 's'} behind)</span>`);
    } else if (v.rent != null) {
        facts.push(v.letting ? (v.ready ? `To let at ${v.rent}g a day — no tenant yet` : `To let at ${v.rent}g a day once it stands`) : `Not let (${v.rent}g a day if it were)`);
    }
    if (facts.length) html += `<div style="${NOTE} margin-top:3px;">${facts.join(' · ')}</div>`;

    const btns = [];
    if (v.canBuildHouse) btns.push(act(`🏗️ Build a House to Let (${v.houseCost}g)`, args('build'), BTN_GOLD, `Stands in ${LotBook.houseDays(worldTypeOf(world, v) || 'village')} days; let to the townsfolk for a daily rent. Other works (a shop, a workshop) are built on the lot on the town map.`));
    if (v.canLet) btns.push(act('🔑 Let it', args('let'), BTN_GOLD, 'Offer it to the townsfolk: a tenant pays you rent each day'));
    if (v.canStopLetting) btns.push(act('Stop letting', args('unlet'), BTN_PLAIN, 'Take it off the letting'));
    if (v.canEvict) btns.push(act('🚪 Put the Tenant Out', args('evict'), BTN_RED, v.owed > 0 ? `Their ${v.owed}g of arrears is lost` : 'The house goes back to let'));
    if (v.canLeave) btns.push(act('🚪 Give up the House', args('leave'), BTN_RED, 'Hand back the key: no more rent'));
    if (v.canSell) btns.push(act(`💰 Sell (${v.value}g)`, args('sell'), BTN_PLAIN, 'A townsperson buys it'));
    if (btns.length) html += `<div style="margin-top:4px;">${btns.join('')}</div>`;
    html += '</div>';
    return html;
}

function worldTypeOf(world, v) {
    const t = world && typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
    return t && t.settlement ? t.settlement.type : null;
}

Object.assign(ActionMenu, {
    /** Every lot and town house of the player's, with what can be done with each. */
    showTownLots(game, message = null) {
        const { world, player } = game;
        const list = Lots.holdingsView(world, player);
        let html = '<div style="font-size:12px;">';
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
        if (!list.length) {
            html += `<p style="${NOTE}">You hold no building lots or houses in town. Walk a town's streets: the staked-out lots are for sale, and a house or two stands empty, to rent or to buy.</p>`;
        } else {
            const income = list.filter(v => v.tenant).reduce((a, v) => a + (v.rent || 0), 0);
            const outgo = list.filter(v => v.state === 'rented').reduce((a, v) => a + (v.rent || 0), 0);
            const owed = list.reduce((a, v) => a + (v.owed || 0), 0);
            const b = player.lotRentBook;
            const parts = [`${list.length} holding${list.length === 1 ? '' : 's'}`];
            if (income) parts.push(`<span style="color:#9fd89f;">+${income}g a day in rents</span>`);
            if (outgo) parts.push(`<span style="color:#e0a080;">−${outgo}g a day in rent you pay</span>`);
            if (owed) parts.push(`<span style="color:#e08080;">${owed}g in arrears</span>`);
            html += `<div style="${NOTE}">${parts.join(' · ')}</div>`;
            if (b && (b.collected || b.paid)) html += `<div style="${NOTE}">This month so far: ${Math.round(b.collected || 0)}g collected, ${Math.round(b.paid || 0)}g paid.</div>`;
            const here = list.filter(v => v.q === player.q && v.r === player.r);
            const away = list.filter(v => !(v.q === player.q && v.r === player.r));
            for (const v of here.concat(away)) html += row(game, v);
        }
        html += '</div>';
        game.ui.showCustomPanel('🏘️ Lots & Town Houses', html);
    },

    /** Every button on the panel: op, then the holding's town (q, r) and its lot id / house key. */
    townLotsAct(game, op, q, r, ref) {
        const { world, player } = game;
        const s = world.getTile(q, r) && world.getTile(q, r).settlement;
        let res;
        switch (op) {
            case 'build': res = Lots.buildHouseOnLot(player, world, s, ref); break;
            case 'let': res = Lots.letHouse(player, world, q, r, ref); break;
            case 'unlet': res = Lots.stopLetting(player, world, q, r, ref); break;
            case 'evict': res = Lots.evictTenant(player, world, q, r, ref); break;
            case 'leave': res = Lots.leaveHouse(player, world, s, ref); break;
            case 'sell': {
                const h = (player.lotHoldings || []).find(x => x.q === q && x.r === r && (x.kind === 'lot' ? x.id : x.key) === ref);
                res = h && h.kind === 'lot' ? Lots.sellLot(player, world, q, r, ref) : Lots.sellHouse(player, world, q, r, ref);
                break;
            }
            default: return;
        }
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showTownLots(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
