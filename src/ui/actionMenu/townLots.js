// ActionMenu — Lots & Town Houses: every building lot and house in town the
// player holds (systems/lots.js holdingsView): its town, its state (an empty
// lot, building, built; a house rented or owned), the tenant, the rent, the
// day it was last paid and any arrears — and what can be done with each:
// raise a house to let on an empty lot (or have it blessed as a burial
// ground: systems/graveyards.js), let a house / take it off the
// letting, put a tenant out, give up a rented house, sell a lot or a house.
// Opened from the world action menu in town ('town_lots') and from a lot or
// house of the player's on the town map (ui/innerMapLots.js). Buttons route
// through data-am-act → townLotsAct.
import { ActionMenu } from './_ref.js';
import { Lots } from '../../systems/lots.js';
import { LotBook } from '../../world/lotBook.js';
import { Graveyards } from '../../systems/graveyards.js';
import { esc, lede, chips, card, rowList, price } from './uiKit.js';
// (a hard landlord: the stocks, winter evictions, your cellars — ui/actionMenu/peopleCrimes.js)
import { landlordRows, evictNote, captivesHtml } from './peopleCrimes.js';
import { PeopleCrimes } from '../../systems/peopleCrimes.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const STATE = {
    empty: ['📜', 'Empty lot', '#ccc'],
    building: ['🏗️', 'Building', '#f5c542'],
    built: ['🏠', 'Built', '#9fd89f'],
    rented: ['🔑', 'You rent it', '#8fc7ff'],
    owned: ['🏠', 'Yours outright', '#9fd89f'],
};

function daysAgo(world, d) {
    if (d == null) return 'not yet';
    const n = Math.max(0, Math.round(Number(world && world.day) - d));
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

function row(game, v) {
    const { world, player } = game;
    const [icon, label, color] = STATE[v.state] || STATE.empty;
    const here = player.q === v.q && player.r === v.r;
    const act = (op) => ({ act: 'townLotsAct', args: [op, v.q, v.r, v.ref] });

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
    const gold = player.gold || 0;
    const rows = [];
    if (v.canBuildHouse) {
        rows.push({ icon: '🏗️', name: 'Build a House to Let', desc: `Stands in ${LotBook.houseDays(worldTypeOf(world, v) || 'village')} days, then let for a daily rent. Shops and workshops are built on the town map.`, side: price(v.houseCost, gold >= v.houseCost), ...act('build') });
        const fee = Graveyards.consecrateFee(world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement);
        rows.push({ icon: '⛪', name: 'Make it a Burial Ground', desc: 'The priest blesses it; the townsfolk lease its plots from you', side: price(fee, gold >= fee), ...act('consecrate') });
    }
    if (v.canLet) rows.push({ icon: '🔑', name: 'Let it', desc: 'Offer it to the townsfolk: a tenant pays you rent each day', ...act('let') });
    if (v.canStopLetting) rows.push({ icon: '🔒', name: 'Stop letting', desc: 'Take it off the letting', ...act('unlet') });
    if (v.canEvict) rows.push({ icon: '🚪', name: 'Put the Tenant Out', desc: (v.owed > 0 ? `Their ${v.owed}g of arrears is lost` : 'The house goes back to let') + evictNote(game), tone: 'bad', ...act('evict') });
    for (const r of landlordRows(game, v)) rows.push(r);
    if (v.canLeave) rows.push({ icon: '🚪', name: 'Give up the House', desc: 'Hand back the key: no more rent', tone: 'bad', ...act('leave') });
    if (v.canSell) rows.push({ icon: '💰', name: 'Sell', desc: 'A townsperson buys it', side: price(v.value), tone: 'good', ...act('sell') });

    const state = `<span style="color:${color};">${label}${v.state === 'building' && v.daysLeft ? ` — ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left` : ''}</span>`;
    const body = `<div style="${NOTE}">${esc(v.town)}${here ? ' (here)' : ''}${facts.length ? ` · ${facts.join(' · ')}` : ''}</div>${rowList(rows)}`;
    return card(body, { icon, title: esc(v.name || 'House'), side: state });
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
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        if (!list.length) {
            html += lede('You hold no building lots or houses in town. Walk a town’s streets: the staked-out lots are for sale, and a house or two stands empty to rent or buy.');
        } else {
            const income = list.filter(v => v.tenant).reduce((a, v) => a + (v.rent || 0), 0);
            const outgo = list.filter(v => v.state === 'rented').reduce((a, v) => a + (v.rent || 0), 0);
            const owed = list.reduce((a, v) => a + (v.owed || 0), 0);
            const b = player.lotRentBook;
            html += chips([
                ['🏘️', 'Holdings', list.length],
                income ? ['🔑', 'Rents in', `+${income}g/day`, 'gold'] : null,
                outgo ? ['🏠', 'Rent you pay', `−${outgo}g/day`] : null,
                owed ? ['⚠️', 'Arrears', `${owed}g`] : null,
                b && (b.collected || b.paid) ? ['📅', 'This month', `${Math.round(b.collected || 0)}g in, ${Math.round(b.paid || 0)}g out`] : null,
            ]);
            const here = list.filter(v => v.q === player.q && v.r === player.r);
            const away = list.filter(v => !(v.q === player.q && v.r === player.r));
            for (const v of here.concat(away)) html += row(game, v);
        }
        html += captivesHtml(game);
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
            case 'consecrate': res = Graveyards.consecrate(player, world, s, ref); break;
            case 'let': res = Lots.letHouse(player, world, q, r, ref); break;
            case 'unlet': res = Lots.stopLetting(player, world, q, r, ref); break;
            case 'evict': {
                // (in winter the household goes into the snow: systems/peopleCrimes.js)
                const e = PeopleCrimes.evictInWinter(player, world, q, r, ref);
                res = { success: e.ok, text: e.text, reason: e.text };
                break;
            }
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
