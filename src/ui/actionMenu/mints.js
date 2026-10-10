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

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TH = 'text-align:left; padding:3px 6px; font-size:11px; color:var(--text-secondary); border-bottom:1px solid rgba(255,255,255,0.1);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(255,255,255,0.05);';
const TABS = [['coin', '💰 Coin'], ['mint', '🏛️ The Mint'], ['crown', '👑 Your coin'], ['coiners', '🕯️ Coiners']];
const FLOW_LABEL = { trade: 'Trade', tribute: 'Tribute', loans: 'Crown loans', gresham: 'Gresham', flight: 'Flight', mint: 'Mint', wear: 'Wear', debase: 'Debasement', recoin: 'Recoinage', counterfeit: 'False coin', player: 'Other', drift: 'Travellers & pilgrims', fisc: 'Taxes & crown spending' };

let _tab = 'coin';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const updown = (v) => (v == null ? '#aaa' : v > 0.005 ? '#e8a040' : v < -0.005 ? '#7cc4e0' : '#aaa');

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="mintAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
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
    let html = `<div style="${NOTE}">Each realm strikes its own coin. Its <b>price level</b> follows the coin about against its people, as against the world's (100 = the norm): a realm awash in coin is dear, one drained of it cheap. Clipped coin (less silver in each piece) raises prices on top. Coin flows with the balance of trade, tribute and crown loans; war and panics hoard it; debased coin drives the good abroad. Rates are the silver in each coin against ${here ? `the coin of <b>${esc(here.name)}</b>, where you stand` : 'its neighbour'}; the money changers charge for a purity gap when you cross a border with gold.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Realm</th><th style="${TH}">Silver</th><th style="${TH}">Price level</th><th style="${TH}">All prices</th><th style="${TH}">Coin about</th><th style="${TH}">4 weeks</th><th style="${TH}">Hoarded</th>${here ? `<th style="${TH}">Rate · changers</th>` : ''}<th style="${TH}">Mint last week</th></tr>`;
    for (const r of rows) {
        const me = here && r.id === here.id;
        html += `<tr${me ? ' style="background:rgba(245,197,66,0.08);"' : ''}><td style="${TD}">${esc(r.name)}</td>`
            + `<td style="${TD} color:${r.purity < 1 ? '#e67e22' : 'inherit'};">${Math.round(r.purity * 100)}%</td>`
            + `<td style="${TD}">${Math.round(r.level * 100)}</td>`
            + `<td style="${TD} color:${updown(r.mult - 1)};">${pct(r.mult - 1)}</td>`
            + `<td style="${TD}">${r.coin == null ? '—' : `${r.coin.toLocaleString()}g ${sparkline(r.hist)}`}</td>`
            + `<td style="${TD} color:${updown(r.trend)};">${r.trend == null ? '—' : pct(r.trend)}</td>`
            + `<td style="${TD}">${r.vel < 0.995 ? `${Math.round((1 - r.vel) * 100)}%` : '—'}</td>`
            + (here ? `<td style="${TD}">${me ? '—' : `${r.rate.toFixed(2)}${r.fee > 0 ? ` · <span style="color:#e67e22;">${(r.fee * 100).toFixed(1)}%</span>` : ''}`}</td>` : '')
            + `<td style="${TD}">${Math.round(r.struck)}g struck · ${Math.round(r.seign)}g to the crown</td></tr>`;
    }
    html += '</table>';
    const mine = here ? rows.find(r => r.id === here.id) : null;
    if (mine && mine.last) {
        const parts = Object.entries(mine.last).filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `${FLOW_LABEL[k] || k} <span style="color:${v > 0 ? '#8fd18f' : '#e08080'};">${v > 0 ? '+' : ''}${Math.round(v)}g</span>`);
        const broad = MoneySupply.broadMoney(world, here, Finance.openBanks(player).filter(b => b.kingdomId === here.id).reduce((s, b) => s + Math.max(0, b.capital || 0), 0));
        html += `<div style="${CARD}"><b>${esc(here.name)}</b>: last week's coin ${parts.length ? parts.join(' · ') : 'stood still'}.<br><span style="${NOTE}">Coin about ${Math.round(broad.coin).toLocaleString()}g · in the crown's chests ${Math.round(broad.treasury).toLocaleString()}g · in the banks' vaults ${Math.round(broad.banks).toLocaleString()}g (the chests and vaults move no prices until they are spent).</span></div>`;
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
    let html = `<div style="${NOTE}">The mint of <b>${esc(k.name)}</b> strikes coin of ${Math.round((k.finance && k.finance.purity != null ? k.finance.purity : 1) * 100)}% silver and takes ${Math.round(pol.seigniorage * 100)}% seigniorage. It pays for bullion at its fine worth, less the seigniorage, in the realm's own prices — never more than the market here asks. A mint where the coin is clipped or dear pays more: bullion bought where coin is sound and cheap fetches its best price there.</div>`;
    html += `<div style="${CARD}"><b>Sell bullion</b>`;
    let any = false;
    for (const g of BULLION) {
        const have = Math.floor((player.inventory && player.inventory[g]) || 0);
        const q = Mints.bullionQuote(player, world, tile, g);
        if (!have && !q.ok) continue;
        any = true;
        const name = PlayerInventory.describe ? PlayerInventory.describe({ [g]: 1 }).replace(/^1\s*/, '') : g;
        html += `<div style="margin-top:4px;">${esc(name)}: <b>${q.unit.toFixed(2)}g</b> each${q.ask ? ` <span style="${NOTE}">(the market asks ${q.ask.toFixed(2)}g)</span>` : ''} · you carry ${have} · the mint takes ${q.room} more this week<br>`;
        for (const n of [...new Set([1, 10, have].filter(x => x > 0 && x <= have))]) html += act(`Sell ${n === have ? 'all' : n}`, ['sell', g, n], BTN_GOLD, q.ok, q.reason || '');
        html += '</div>';
    }
    if (!any) html += `<div style="${NOTE}">You carry no gold ore, silver ore or gold bars.</div>`;
    html += '</div>';
    // The lease
    const lq = Mints.leaseQuote(player, world, tile);
    const st = player.mints;
    html += `<div style="${CARD}"><b>Lease the mint</b><br>`;
    if (st && st.lease && st.lease.kingdomId === k.id) {
        html += `You hold this mint until day ${st.lease.until}: ${Math.round(st.lease.share * 100)}% of its seigniorage, ${Math.round(st.lease.earned || 0)}g so far for ${st.lease.fee}g.`;
    } else {
        html += `<span style="${NOTE}">${Math.round(lq.share * 100)}% of the mint's seigniorage for ${lq.days} days, for ${lq.fee}g now (its seigniorage lately: ${Math.round(lq.avg || 0)}g a week, from the bullion it buys and the foreign coin it restrikes).</span><br>`;
        html += act(`Lease for ${lq.fee}g`, ['lease'], BTN_GOLD, lq.ok && player.gold >= lq.fee, lq.reason || '');
    }
    html += '</div>';
    return html;
}

function crownTab(game) {
    const { player, world } = game;
    const k = Finance.ruledKingdom(player, world);
    if (!k) return `<div style="${NOTE}">When you rule a realm, its mint is yours to run: what it charges, when to call in clipped coin, and — in a crisis — when to clip it.</div>`;
    const rec = MoneySupply.ensureRealm(world, k);
    const P = Mints.config().mint.policies;
    const purity = k.finance && k.finance.purity != null ? k.finance.purity : 1;
    let html = `<div style="${CARD}"><b>The mint of ${esc(k.name)}</b>: ${Math.round(purity * 100)}% silver · price level ${Math.round(MoneySupply.level(world, k.id) * 100)} · ${Math.round(rec.coin).toLocaleString()}g about · last week ${Math.round(rec.mint.lastStruck)}g struck, ${Math.round(rec.mint.lastSeign)}g seigniorage.</div>`;
    html += `<div style="${CARD}"><b>Seigniorage</b> <span style="${NOTE}">A greedy mint keeps more of each piece, and sellers take their bullion elsewhere.</span><br>`;
    for (const [id, p] of Object.entries(P)) html += act(esc(p.label), ['policy', id], rec.mint.policy === id ? BTN_GOLD : BTN_PLAIN);
    html += '</div>';
    const rq = Mints.recoinQuote(world, k);
    html += `<div style="${CARD}"><b>Recoinage</b> <span style="${NOTE}">Call in the clipped coin and strike it anew at full weight. The crown makes up half the missing silver; the holders lose the rest, so there is less coin about and prices fall.</span><br>`;
    html += rq.ok ? act(`Proclaim a recoinage (${rq.cost}g)`, ['recoin'], BTN_GOLD, k.treasury >= rq.cost, k.treasury >= rq.cost ? '' : 'The treasury cannot pay for it.') : `<span style="${NOTE}">${esc(rq.reason)}</span>`;
    html += '</div>';
    html += `<div style="${CARD}"><b>Debase the coin</b> <span style="${NOTE}">Recoin at a tenth less silver: gold for the crown now, more coin about (prices rise), trust lost, and the good coin flees abroad.</span><br>${act('Clip the coin', ['debase'], BTN_RED, purity > 0.55)}</div>`;
    return html;
}

function coinersTab(game, tile) {
    const { player, world } = game;
    const uw = player.underworld;
    if (!uw || !uw.guild || !uw.guild.member) return `<div style="${NOTE}">Coiners keep to the Thieves' Guild. You know none of them.</div>`;
    const C = Mints.config().counterfeit;
    let html = `<div style="${NOTE}">The guild's coiners silver copper blanks with good coin and pass them in the markets. Clipped coin is easier to fake; a hot name is easier to catch. Caught, you lose the stake and pay a fine as large again, and may see the inside of the gaol.</div>`;
    for (const stake of [C.minStake, Math.round((C.minStake + C.maxStake) / 2), C.maxStake]) {
        const q = Mints.counterfeitQuote(player, world, tile, stake);
        if (!q.ok) { html += `<div style="${NOTE}">${esc(q.reason)}</div>`; break; }
        html += `<div style="${CARD}">Stake ${q.stake}g → clear ${q.gain}g · ${Math.round(q.chance * 100)}% chance of the watch (heat in ${esc(q.kingdom.name)} ${Math.round(Underworld.getHeat(player, q.kingdom.id))})<br>${act(`Pass ${q.stake}g of false coin`, ['counterfeit', q.stake], BTN_RED, player.gold >= q.stake)}</div>`;
    }
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
        let html = '<div style="font-size:12px; max-height:640px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Gold ${Math.floor(player.gold)}</p><div style="margin:6px 0;">`;
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
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
