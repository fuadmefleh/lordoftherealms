// ActionMenu — the Royal Mint & the realms' coin: each realm's coin purity,
// price level, coin in circulation and its trend, and the exchange rates
// between the coins (the 💰 Coin tab, anywhere); at a capital, selling gold
// and silver to the mint and leasing it (🏛️ The Mint); for a ruler the mint's
// policy, a recoinage edict and debasement (👑 Your coin); for a Thieves'
// Guild hand, passing false coin (🕯️ Coiners). Logic lives in
// systems/mints.js and world/moneySupply.js; buttons route through
// data-am-act → ActionMenu.mintAct.
import { ActionMenu } from './_ref.js';
import { Mints, BULLION } from '../../systems/mints.js';
import { MoneySupply } from '../../world/moneySupply.js';
import { Finance } from '../../systems/finance.js';
import { Underworld } from '../../systems/underworld.js';
import { PlayerInventory } from '../../core/inventory.js';
import { BTN_GOLD, BTN_DIM, panelTabs, intelBadge, closedBooks, lede, bullets, chips, purse, sectionHead, card, actRow, rowList, price } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';

const NOTE = 'font-size: 11px; color: #9d937c;';
// A quiet table: the head in the section-head voice, hairline row rules
const TH = 'text-align:left; padding:3px 6px; font-size:9.5px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600; color:rgba(245,197,66,0.7); border-bottom:1px solid rgba(245,197,66,0.14);';
const TD = 'padding:4px 6px; border-bottom:1px solid rgba(245,197,66,0.07);';
const SMALL = 'padding:2px 8px; margin:0 0 0 4px; font-size:11px;';
const TABS = [['coin', '💰 Coin'], ['mint', '🏛️ The Mint'], ['crown', '👑 Your coin'], ['coiners', '🕯️ Coiners']];
const FLOW_LABEL = { trade: 'Trade', tribute: 'Tribute (chests)', loans: 'Crown loans (chests)', plunder: 'Plunder (chests)', gresham: 'Gresham', flight: 'Flight', mint: 'Mint', wear: 'Wear', debase: 'Debasement (chests)', recoin: 'Recoinage', counterfeit: 'False coin (purse)', cheat: 'Conjured (purse)', drift: 'Travellers & pilgrims', fisc: 'Taxes & crown spending', other: 'Wages, rents & spending' };

let _tab = 'coin';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const updown = (v) => (v == null ? '#9d937c' : v > 0.005 ? '#f0b35a' : v < -0.005 ? '#7cc4e0' : '#9d937c');

/** A small mintAct button for a row's side column (the row itself is then not a button). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="mintAct" data-am-args='${esc(JSON.stringify(args))}' style="${style} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** A small inline line of the coin in circulation, week by week. */
function sparkline(hist, w = 110, h = 24) {
    const v = (hist || []).map(r => r[1]).filter(x => Number.isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (x - lo) / span * (h - 2)).toFixed(1)}`).join(' ');
    const color = v[v.length - 1] >= v[0] ? '#e8a040' : '#7cc4e0';
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function coinTab(game) {
    const { player, world } = game;
    const here = Mints.realmHere(player, world);
    const rows = Mints.realmTable(world, here ? here.id : null);
    let html = lede('Each realm strikes its own coin. Its <b>price level</b> (100 = the norm) follows how much coin is about for its people: a realm awash in coin is dear, one drained of it cheap.');
    html += bullets([
        'Clipped coin (less silver in each piece) raises prices on top.',
        'Coin flows with the balance of trade, tribute and crown loans; war and panics hoard it; debased coin drives the good abroad.',
        `Rates are the silver in each coin against ${here ? `the coin of <b>${esc(here.name)}</b>, where you stand` : 'its neighbour'}; money changers charge for the purity gap when you cross a border with gold.`,
    ]);
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Realm</th><th style="${TH}">Silver</th><th style="${TH}">Price level</th><th style="${TH}">All prices</th><th style="${TH}">Coin about</th><th style="${TH}">4 weeks</th><th style="${TH}">Hoarded</th>${here ? `<th style="${TH}">Rate · changers</th>` : ''}<th style="${TH}">Mint last week</th></tr>`;
    for (const r of rows) {
        const me = here && r.id === here.id;
        // What the mint struck and the crown took is in the mint's books (systems/realmIntel.js)
        const why = RealmIntel.whyLabel(player, world, r.id, 'mint');
        html += `<tr${me ? ' style="background:rgba(245,197,66,0.07); color:#ffe9a8;"' : ''}><td style="${TD}">${esc(r.name)}${why ? ` ${intelBadge(why)}` : ''}</td>`
            + `<td style="${TD} color:${r.purity < 1 ? '#f0b35a' : 'inherit'};">${Math.round(r.purity * 100)}%</td>`
            + `<td style="${TD}">${Math.round(r.level * 100)}</td>`
            + `<td style="${TD} color:${updown(r.mult - 1)};">${pct(r.mult - 1)}</td>`
            + `<td style="${TD}">${r.coin == null ? '—' : `${r.coin.toLocaleString()}g ${sparkline(r.hist)}`}</td>`
            + `<td style="${TD} color:${updown(r.trend)};">${r.trend == null ? '—' : pct(r.trend)}</td>`
            + `<td style="${TD}">${r.vel < 0.995 ? `${Math.round((1 - r.vel) * 100)}%` : '—'}</td>`
            + (here ? `<td style="${TD}">${me ? '—' : `${r.rate.toFixed(2)}${r.fee > 0 ? ` · <span style="color:#f0b35a;">${(r.fee * 100).toFixed(1)}%</span>` : ''}`}</td>` : '')
            + (why ? `<td style="${TD}">${Math.round(r.struck)}g struck · ${Math.round(r.seign)}g to the crown</td></tr>` : `<td style="${TD} ${NOTE}">🔒</td></tr>`);
    }
    html += '</table>';
    const mine = here ? rows.find(r => r.id === here.id) : null;
    const mineWhy = mine ? RealmIntel.whyLabel(player, world, mine.id, 'mint') : '';
    if (mine && mine.last && !mineWhy) html += closedBooks(`Where ${here.name}'s coin came from and went, and what lies in its crown's chests,`);
    if (mine && mine.last && mineWhy) {
        const parts = Object.entries(mine.last).filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `${FLOW_LABEL[k] || k} <span style="color:${v > 0 ? '#8fd18a' : '#e0846a'};">${v > 0 ? '+' : ''}${Math.round(v)}g</span>`);
        const broad = MoneySupply.broadMoney(world, here, Finance.openBanks(player).filter(b => b.kingdomId === here.id).reduce((s, b) => s + Math.max(0, b.capital || 0), 0));
        let body = `<div style="margin-bottom:6px;">Last week's coin ${parts.length ? parts.join(' · ') : 'stood still'}.</div>`;
        body += chips([
            ['', 'Coin about', `${Math.round(broad.coin).toLocaleString()}g`],
            ['', 'In the crown\'s chests', `${Math.round(broad.treasury).toLocaleString()}g`],
            ['', 'In the banks\' vaults', `${Math.round(broad.banks).toLocaleString()}g`],
        ]);
        if (broad.coffers > 0) body += chips([['', "In the great houses' coffers", `${Math.round(broad.coffers).toLocaleString()}g`]]);
        if (broad.player > 0) body += chips([['', 'In your purse', `${Math.round(broad.player).toLocaleString()}g`]]);
        body += `<div style="${NOTE}">The coin about is every purse in the realm: its towns, its people, guilds, gangs, inns, merchants, caravans. The crown's chests, the great houses' coffers, the vaults and your own purse move no prices until they are spent.</div>`;
        html += card(body, { icon: '💰', title: `${esc(here.name)}'s coin`, side: intelBadge(mineWhy) });
    }
    const st = player.mints;
    if (st && st.stats && st.stats.exchangeFees > 0) html += `<div style="${NOTE}">The money changers have had ${Math.round(st.stats.exchangeFees)}g of you.</div>`;
    return html;
}

function mintTab(game, tile) {
    const { player, world } = game;
    const at = Mints.mintAt(world, tile);
    if (!at) return `<div style="${NOTE}">The realms strike their coin at their capitals: stand in one to sell gold and silver to its mint, or to lease it.</div>`;
    const k = at.kingdom;
    const rec = MoneySupply.ensureRealm(world, k);
    const pol = MoneySupply.policy(rec);
    let html = lede(`The mint of <b>${esc(k.name)}</b> strikes coin of ${Math.round((k.finance && k.finance.purity != null ? k.finance.purity : 1) * 100)}% silver and takes ${Math.round(pol.seigniorage * 100)}% seigniorage.`);
    html += bullets([
        'It pays for bullion at its fine worth, less the seigniorage, in the realm\'s own prices — never more than the market here asks.',
        'A mint where the coin is clipped or dear pays more: buy bullion where coin is sound and cheap, sell it there.',
    ]);
    const rows = [];
    for (const g of BULLION) {
        const have = Math.floor((player.inventory && player.inventory[g]) || 0);
        const q = Mints.bullionQuote(player, world, tile, g);
        if (!have && !q.ok) continue;
        const name = PlayerInventory.describe ? PlayerInventory.describe({ [g]: 1 }).replace(/^1\s*/, '') : g;
        const btns = [...new Set([1, 10, have].filter(x => x > 0 && x <= have))].map(n => act(`Sell ${n === have ? 'all' : n}`, ['sell', g, n], BTN_GOLD, q.ok, q.reason || '')).join('');
        rows.push(actRow({
            icon: /silver/.test(g) ? '🥈' : '🥇',
            name: `${esc(name)} <span class="pk-price">${q.unit.toFixed(2)}<small>g</small></span> <small style="color:#9d937c; font-weight:400;">each</small>`,
            desc: `${q.ask ? `the market asks ${q.ask.toFixed(2)}g · ` : ''}you carry ${have} · the mint takes ${q.room} more this week`,
            note: !q.ok && q.reason ? `<span style="color:#c98a6a;">${esc(q.reason)}</span>` : '',
            side: btns,
        }));
    }
    html += sectionHead('Sell bullion');
    html += rows.length ? rowList(rows) : `<div style="${NOTE}">You carry no gold ore, silver ore or gold bars.</div>`;
    // The lease
    const lq = Mints.leaseQuote(player, world, tile);
    const st = player.mints;
    html += sectionHead('Lease the mint');
    if (st && st.lease && st.lease.kingdomId === k.id) {
        html += rowList([{
            icon: '🏛️', name: 'Your lease',
            desc: `You hold this mint until day ${st.lease.until}: ${Math.round(st.lease.share * 100)}% of its seigniorage, ${Math.round(st.lease.earned || 0)}g so far for ${st.lease.fee}g.`,
            side: `+${Math.round(st.lease.earned || 0)}g`, tone: 'good',
        }]);
    } else {
        const canLease = lq.ok && player.gold >= lq.fee;
        const share = `${Math.round(lq.share * 100)}% of the mint's seigniorage for ${lq.days} days, for ${lq.fee}g now.`;
        html += rowList([{
            icon: '🏛️', name: `Lease for ${lq.fee}g`, desc: share,
            note: `Its seigniorage lately: ${Math.round(lq.avg || 0)}g a week, from the bullion it buys and the foreign coin it restrikes.`,
            act: 'mintAct', args: ['lease'], off: !canLease,
            why: `${lq.reason ? esc(lq.reason) : 'Your purse is short'} · ${share}`,
            title: lq.reason || '',
            side: price(lq.fee, player.gold >= lq.fee),
        }]);
    }
    return html;
}

function crownTab(game) {
    const { player, world } = game;
    const k = Finance.ruledKingdom(player, world);
    if (!k) return `<div style="${NOTE}">When you rule a realm, its mint is yours to run: what it charges, when to call in clipped coin, and — in a crisis — when to clip it.</div>`;
    const rec = MoneySupply.ensureRealm(world, k);
    const P = Mints.config().mint.policies;
    const purity = k.finance && k.finance.purity != null ? k.finance.purity : 1;
    let html = lede(`<b>The mint of ${esc(k.name)}</b>.`);
    html += chips([
        ['', 'Silver', `${Math.round(purity * 100)}%`],
        // (the coin in hand: old finer pieces not yet restruck, and the clipping — world/moneySupply.js fineness)
        ['', 'In hand', `${Math.round(MoneySupply.fineness(world, k).circulating * 100)}%`],
        ['', 'Clipped', `${Math.round(MoneySupply.fineness(world, k).clip * 100)}%`],
        ['', 'Price level', Math.round(MoneySupply.level(world, k.id) * 100)],
        ['', 'Coin about', `${Math.round(rec.coin).toLocaleString()}g`],
        ['', 'Last week', `${Math.round(rec.mint.lastStruck)}g struck, ${Math.round(rec.mint.lastSeign)}g seigniorage`, 'gold'],
    ]);
    html += sectionHead('Seigniorage');
    html += `<div style="${NOTE} margin:-2px 0 4px;">A greedy mint keeps more of each piece, and sellers take their bullion elsewhere.</div>`;
    html += rowList(Object.entries(P).map(([id, p]) => {
        const on = rec.mint.policy === id;
        return {
            icon: on ? '✅' : '⚖️', name: esc(p.label),
            desc: `keeps ${Math.round((p.seigniorage || 0) * 100)}% of each piece · draws ×${p.draw} the bullion`,
            act: 'mintAct', args: ['policy', id], side: on ? 'current' : '', tone: on ? 'gold' : '',
        };
    }));
    const rq = Mints.recoinQuote(world, k);
    html += sectionHead('Recoinage');
    const recoinDesc = 'Call in the debased and clipped coin and strike it anew at full weight.';
    const recoinNote = 'The crown makes up half the missing silver; the holders lose the rest, so there is less coin about and prices fall.';
    html += rowList([rq.ok ? {
        icon: '💰', name: `Proclaim a recoinage (${rq.cost}g)`, desc: recoinDesc, note: recoinNote,
        act: 'mintAct', args: ['recoin'], off: k.treasury < rq.cost, why: 'The treasury cannot pay for it.',
        side: price(rq.cost, k.treasury >= rq.cost),
    } : { icon: '💰', name: 'Proclaim a recoinage', desc: recoinDesc, note: recoinNote, off: true, why: esc(rq.reason) }]);
    html += sectionHead('Debase the coin');
    html += rowList([{
        icon: '✂️', name: 'Clip the coin',
        desc: 'Recoin at a tenth less silver: gold for the crown now; more coin about (prices rise); trust lost, and the good coin flees abroad.',
        act: 'mintAct', args: ['debase'], off: purity <= 0.55,
        why: `Recoin at a tenth less silver · the coin is down to ${Math.round(purity * 100)}% silver already`,
        side: `${Math.round(purity * 100)}% silver`, tone: 'bad',
    }]);
    return html;
}

function coinersTab(game, tile) {
    const { player, world } = game;
    const uw = player.underworld;
    if (!uw || !uw.guild || !uw.guild.member) return `<div style="${NOTE}">Coiners keep to the Thieves' Guild. You know none of them.</div>`;
    const C = Mints.config().counterfeit;
    let html = lede('The guild\'s coiners silver copper blanks with good coin and pass them in the markets.');
    html += bullets([
        'Clipped coin is easier to fake; a hot name is easier to catch.',
        'Caught, you lose the stake, pay a fine as large again, and may see the inside of the gaol.',
    ]);
    const rows = [];
    let stop = '';
    for (const stake of [C.minStake, Math.round((C.minStake + C.maxStake) / 2), C.maxStake]) {
        const q = Mints.counterfeitQuote(player, world, tile, stake);
        if (!q.ok) { stop = `<div style="${NOTE}">${esc(q.reason)}</div>`; break; }
        const desc = `Stake ${q.stake}g → clear ${q.gain}g · ${Math.round(q.chance * 100)}% chance of the watch (heat in ${esc(q.kingdom.name)} ${Math.round(Underworld.getHeat(player, q.kingdom.id))})`;
        rows.push({
            icon: '🕯️', name: `Pass ${q.stake}g of false coin`, desc,
            act: 'mintAct', args: ['counterfeit', q.stake], off: player.gold < q.stake, why: `${desc} · your purse is short`,
            side: `${price(q.stake, player.gold >= q.stake)} → <span style="color:#8fd18a;">+${q.gain}g</span>`,
        });
    }
    html += rowList(rows, 'False coin');
    html += stop;
    return html;
}

Object.assign(ActionMenu, {
    /** The Royal Mint & the realms' coin. */
    showMint(game, tile = null) {
        const { player, world } = game;
        const t = tile || world.getTile(player.q, player.r);
        if (!Mints.enabled()) {
            game.ui.showCustomPanel('💰 The Mint', `<div style="${NOTE}">The realms' mints are closed.</div>`);
            return;
        }
        let html = '<div>';
        html += chips([purse(player.gold)]);
        html += panelTabs(game, {
            id: 'mint', title: '💰 The Mint & the Coin', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showMint(game, t); },
            attrsFor: (k) => `data-am-act="mintAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'mint') html += mintTab(game, t);
        else if (_tab === 'crown') html += crownTab(game);
        else if (_tab === 'coiners') html += coinersTab(game, t);
        else html += coinTab(game);
        html += '</div>';
        game.ui.showCustomPanel('💰 The Mint & the Coin', html);
    },

    mintAct(game, op, a = null, b = null) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'coin'; break;
            case 'sell': res = Mints.sellBullion(player, world, tile, a, b); break;
            case 'lease': res = Mints.leaseMint(player, world, tile); break;
            case 'policy': res = Mints.setPolicy(player, world, a); break;
            case 'recoin': res = Mints.royalRecoin(player, world); break;
            case 'debase': res = Mints.royalDebase(player, world); break;
            case 'counterfeit': res = Mints.counterfeit(player, world, tile, a); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('💰 The Mint', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success && !res.caught ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showMint(game, tile);
    },
});
