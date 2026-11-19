// ActionMenu — Estates & Land: the estates about the town where you stand
// (holder, tenants, crops, rent due and paid, loyalty, worth; buy one, or make
// an offer), your own land (rents, the tenants' mood, pressing them for their
// arrears, improvements, enclosure, selling,
// settling one as a dowry) and the land market near you. Logic lives in
// world/estates.js and systems/landMarket.js; buttons route through
// data-am-act → ActionMenu.estateAct.
import { ActionMenu } from './_ref.js';
import { Estates } from '../../world/estates.js';
import { LandMarket } from '../../systems/landMarket.js';
import { panelTabs, lede, bullets, chips, purse, kv, card, actRow, rowList, price, more } from './uiKit.js';
import { Names } from '../../core/names.js';
import { Utils } from '../../core/utils.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TABS = [['here', '🌾 Estates here'], ['mine', '🏡 Your land'], ['market', '📜 Land for sale']];
const HOLDER_ICON = { crown: '👑', noble: '🛡️', church: '⛪', town: '🏛️', house: '⚖️', player: '🏡' };

let _tab = 'here';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** An estate deed as a row in the panels' voice (uiKit actRow), routed to estateAct. */
function deed(o, args, ok = true, why = '') {
    return actRow({ ...o, act: ok ? 'estateAct' : null, args: ok ? args : null, off: !ok, why: why ? esc(why) : '' });
}

const loyColor = (v) => (v < 25 ? '#e74c3c' : v < 45 ? '#e67e22' : v > 70 ? '#8fd18f' : 'inherit');
const WORK_ICON = { drain: '💧', marl: '⛏️', enclose: '🐑', relet: '🏘️' };

function cropsLine(world, e, live) {
    const o = Estates.output(world, e, live);
    const parts = Object.entries(o.goods).filter(([, n]) => n >= 0.05).map(([g, n]) => `${n.toFixed(1)} ${g}`);
    return parts.length ? `${parts.join(' · ')} a day (${Utils.formatGold(o.gross)}g)` : 'nothing yet recorded';
}

/** Your estate's business: the rent, the works, a dowry (folded away: most days nobody needs it). */
function manageRows(game, e, live) {
    const { player, world } = game;
    const C = Estates.config();
    const rows = [];
    for (const [id, lv] of Object.entries(C.rent.levels)) {
        const on = e.rent === id;
        rows.push(deed({
            icon: on ? '●' : '○', name: `${esc(lv.label)} rent`,
            desc: `${Math.round((lv.share || 0) * 100)}% of the crop's worth · loyalty settles near ${lv.loyalty}${lv.flight ? ' · some tenants leave' : ''}`,
            side: on ? 'set' : 'Set ›', tone: on ? 'good' : null,
        }, ['rent', e.id, id], !on));
    }
    const modes = [
        ['coin', 'Rent in coin', 'A fixed sum on the usual crop: the tenants carry a bad year'],
        ['kind', 'Rent as a share of the crop', 'Rent follows the harvest and its price; the tenants like it better'],
    ];
    for (const [m, name, desc] of modes) {
        const on = e.mode === m;
        rows.push(deed({ icon: on ? '●' : '○', name, desc, side: on ? 'set' : 'Set ›', tone: on ? 'good' : null }, ['mode', e.id, m], !on));
    }
    for (const k of ['drain', 'marl', 'enclose', 'relet']) {
        const q = LandMarket.worksQuote(player, world, e.id, k);
        if (!q.ok && (k === 'relet' ? !(e.enclosed > 0) : e.enclosed > 0)) continue;
        const can = q.ok && player.gold >= q.cost;
        rows.push(deed({
            icon: WORK_ICON[k] || '🔨', name: esc((C.works[k] || {}).label || k),
            desc: q.ok ? `${q.days} days of work${k === 'enclose' ? ': the town reaps less grain, more wool, and the tenants go' : ''}` : '',
            side: q.ok ? price(q.cost, player.gold >= q.cost) : '', tone: k === 'enclose' ? 'bad' : null,
        }, ['works', e.id, k], can, q.ok ? `It costs ${Utils.formatGold(q.cost)}g.` : q.reason));
    }
    const realms = [live.kingdom, player.allegiance].filter((k, i, a) => k != null && a.indexOf(k) === i).map(k => Estates.kingdom(world, k)).filter(k => k && k.isAlive !== false);
    for (const k of realms) {
        rows.push(deed({ icon: '💍', name: `Settle as a dowry in ${esc(Names.realm(k.name))}`, desc: 'Give the estate to a noble house of the realm: reputation there and Prestige' }, ['dowry', e.id, k.id]));
    }
    return rows;
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
    let body = `<div class="pk-row-desc" style="margin:0 0 4px;">${Math.round(e.share * C.derive.estateShare * 100)}% of ${esc(live.name)}'s farmland · ${e.lastDue == null && !e.hh ? Estates.households(world, e, live) : e.hh} tenant households · soil ${Math.round((e.soil || 1) * 100)}%${e.drained ? ' (drained)' : ''}${e.marl > 0 ? ' (marled)' : ''}${e.enclosed > 0 ? ' · <b>enclosed: sheep</b>' : ''}</div>`;
    body += kv('Crops', cropsLine(world, e, live));
    const dueLine = e.lastDue != null ? `due ${Utils.formatGold(e.lastDue)}g / paid ${Utils.formatGold(e.lastPaid != null ? e.lastPaid : e.lastRent || 0)}g${e.lastBack > 0 ? ` (${Utils.formatGold(e.lastBack)}g of it arrears)` : ''} · ${Utils.formatGold(e.lastRent || 0)}g to the holder` : `none collected yet · about ${Utils.formatGold(LandMarket.monthlyRent(world, e, live))}g a month expected`;
    body += kv('Rent', `${esc(L.label)} ${e.mode === 'kind' ? 'share of the crop' : 'in coin'} · ${e.lastDue != null ? 'last month ' : ''}${dueLine}${e.arrears > 0 ? ` <span style="color:#e67e22;">(${Utils.formatGold(e.arrears)}g in arrears)</span>` : ''}`);
    body += kv('Tenants\' loyalty', `<span style="color:${loyColor(e.loyalty)};">${e.loyalty}</span>`);
    body += kv('Worth', `<b>${Utils.formatGold(value)}g</b> <span style="${NOTE}">(${Utils.formatGold(rent)}g net rent a year at ${(LandMarket.landRate(world, live.kingdom != null ? live.kingdom : null) * 100).toFixed(1)}%)</span>`);
    if (e.works) body += `<div class="pk-row-desc" style="color:#7cc4e0;">${esc((C.works[e.works.kind] || {}).label || 'Works')} under way until day ${e.works.until}.</div>`;
    if (!mine) {
        const q = LandMarket.buyQuote(player, world, e.id);
        if (q.ok) {
            const can = player.gold >= q.cost;
            body += rowList([deed({
                icon: '💰', name: q.listed ? 'Buy the estate' : 'Make an offer',
                desc: q.listed ? 'It is on the market at this price' : 'Above its worth: the holder may take it',
                note: q.duty ? `incl. ${Utils.formatGold(q.duty)}g duty` : '',
                side: price(q.cost, can), tone: 'gold',
            }, ['buy', e.id], can, can ? '' : `It costs ${Utils.formatGold(q.cost)}g; you have ${Utils.formatGold(player.gold)}g.`)]);
        } else {
            body += `<div class="pk-row-desc" style="margin-top:4px;">${esc(q.reason)}</div>`;
        }
    } else {
        const paid = e.paid || 0;
        body += chips([
            ['', 'Paid', `${Utils.formatGold(paid)}g${paid ? ` · ${(rent / paid * 100).toFixed(1)}% a year on it` : ''}`],
            ['', 'Rents banked', `${Utils.formatGold(e.earned || 0)}g`, 'gold'],
            e.fled ? ['', 'Households fled', e.fled] : null,
        ]);
        const rows = [];
        if (e.arrears > 0) {
            const pq = LandMarket.pressQuote(player, world, e.id);
            rows.push(deed({
                icon: '⚖️', name: 'Press for arrears',
                desc: pq.ok ? `Send the bailiff: loyalty −${pq.loyalty}${pq.risk > 0 ? `, ${Math.round(pq.risk * 100)}% chance of a rent riot (nothing collected)` : ''}` : '',
                side: pq.ok ? price(pq.amount) : '', tone: 'bad',
            }, ['press', e.id], pq.ok, pq.ok ? '' : pq.reason));
        }
        const sq = LandMarket.sellQuote(player, world, e.id);
        if (sq.ok) {
            rows.push(deed({ icon: '🤝', name: 'Sell now', desc: sq.buyer ? `${esc(sq.buyer)} will buy` : '', side: price(sq.quick) }, ['sell', e.id, 'quick'], !!sq.buyer, 'No buyer about has the purse'));
            rows.push(sq.listed
                ? deed({ icon: '📜', name: 'Take it off the market', desc: 'It is listed for sale' }, ['sell', e.id, 'withdraw'])
                : deed({ icon: '📜', name: 'List it for sale', desc: 'Wait for a buyer at the asking price', side: price(sq.list) }, ['sell', e.id, 'list']));
        }
        body += rowList(rows);
        body += more('Rent, works and dowry', rowList(manageRows(game, e, live)));
    }
    return card(body, {
        icon: HOLDER_ICON[kind] || '🌾', title: esc(e.name),
        side: `${esc(Estates.holderName(world, e.holder))}${x ? ` · <span style="color:#f5c542;">for sale ${Utils.formatGold(x.price)}g</span>` : ''}`,
        tone: mine ? 'good' : null,
    });
}

function hereTab(game, tile) {
    const { world } = game;
    const live = tile && tile.settlement;
    if (!live) return lede('Stand in a town or village to see the estates about it.');
    const ests = Estates.estatesOf(world, live.q, live.r);
    const C = Estates.config();
    let html = lede(`The farmland about <b>${esc(live.name)}</b>: ${Math.round((1 - C.derive.estateShare) * 100)}% is the peasants' own freeholds and commons; the rest is held in estates whose tenants pay rent once a month.`);
    html += bullets([
        'An estate’s crops feed the town: drain or marl its fields and the town reaps more.',
        'Enclose it for sheep and the town reaps less grain, more wool, and the tenants go.',
        'Land is priced at its net rent over the realm’s land rate (which follows the crown’s bond rate).',
    ]);
    if (!ests.length) return html + lede('The estates here are not yet surveyed (tomorrow).');
    for (const e of ests) html += estateCard(game, e, live);
    return html;
}

function mineTab(game) {
    const { player, world } = game;
    const mine = LandMarket.mine(player, world);
    if (!mine.length) {
        return lede('You hold no land yet.') + bullets([
            'Estates come on the market when their lords fall into debt or a crown needs money.',
            'A holder may also take an offer above the land’s worth (the Church never sells).',
            'Look over the estates about any town, or the land for sale near you.',
        ]);
    }
    const s = LandMarket.summary(player, world);
    let html = chips([
        ['🌾', 'Estates', s.n],
        ['', 'Worth', `${Utils.formatGold(s.value)}g`],
        ['', 'Net rent a year expected', `${Utils.formatGold(s.rent)}g${s.yield != null ? ` (${(s.yield * 100).toFixed(1)}% on the ${Utils.formatGold(s.paid)}g paid)` : ''}`],
        ['', 'Banked', `${Utils.formatGold(s.earned)}g`, 'gold'],
    ]);
    for (const e of mine) {
        const live = Estates._liveOfKey(world, e.town);
        if (live) html += estateCard(game, e, live);
    }
    const st = LandMarket.playerState(player);
    if (st.log.length) html += rowList(st.log.slice(0, 6).map(l => ({ icon: '📜', name: esc(l.text), side: `day ${l.day}` })), 'Lately');
    return html;
}

function marketTab(game) {
    const { player, world } = game;
    const list = LandMarket.listingsNear(world, player.q, player.r, 25);
    let html = lede('Estates on the market within 25 hexes.');
    html += bullets([
        'A listing waits a week for a buyer before the merchant houses, burghers, nobles or the Church take it.',
        'Unsold, its price falls each month.',
    ]);
    if (!list.length) return html + lede('No land is for sale near you.');
    const WHY = { debts: 'its lord is in debt', crown: 'the crown needs money', player: 'yours', default: '' };
    html += rowList(list.map(({ x, e, live, dist }) => {
        const value = LandMarket.value(world, e, live);
        const yours = x.seller === 'player';
        return {
            icon: '🌾', name: `${esc(e.name)} <span style="${NOTE} font-weight:400;">near ${esc(live.name)} · ${dist} hex${dist === 1 ? '' : 'es'}</span>`,
            desc: `Sold by ${esc(Estates.holderName(world, x.seller))}${WHY[x.reason] ? ` (${WHY[x.reason]})` : ''} · worth ${Utils.formatGold(value)}g`,
            side: price(x.price, player.gold >= x.price), tone: 'gold',
            act: yours ? null : 'estateAct', args: yours ? null : ['see', live.q, live.r],
            title: yours ? '' : 'See it on its town\'s page',
        };
    }), 'Land for sale');
    return html;
}

Object.assign(ActionMenu, {
    /** Estates & land: the estates here, your land, land for sale. */
    showEstates(game, tile = null, tab = null) {
        const { player, world } = game;
        const t = tile || world.getTile(player.q, player.r);
        if (tab) _tab = tab;
        if (!Estates.enabled()) {
            game.ui.showCustomPanel('🌾 Estates', lede('There is no market in land.'));
            return;
        }
        let html = '<div>';
        html += chips([purse(player.gold)]);
        html += panelTabs(game, {
            id: 'estates', title: '🌾 Estates & Land', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showEstates(game, t); },
            attrsFor: (k) => `data-am-act="estateAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
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
            case 'press': res = LandMarket.pressArrears(player, world, a); break;
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
