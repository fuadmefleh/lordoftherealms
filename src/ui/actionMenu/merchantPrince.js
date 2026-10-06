// ActionMenu — Merchant Prince: the market panel's Invest, Warehouse and
// Contracts sections (opened from the trade window, the Counsel or the
// ledger). Works funded in towns, rented store-rooms, forward contracts, and
// the fairs. Logic lives in systems/merchantPrince.js and
// systems/marketFairs.js; this presents it. Buttons route through
// data-am-act → ActionMenu.merchantPrinceAct.
import { ActionMenu } from './_ref.js';
import { Trading } from './_imports.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { MarketFairs } from '../../systems/marketFairs.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { TownLabour } from '../../world/townLabour.js';

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TABS = [['invest', '🏭 Invest'], ['warehouse', '📦 Warehouse'], ['contracts', '📜 Contracts'], ['ledger', '📒 Holdings']];

let _tab = 'invest';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const g = (n) => `${Math.round(n).toLocaleString()}g`;
const gname = (id) => esc(MerchantPrince.goodName(id));

/** A button routed to ActionMenu.merchantPrinceAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="merchantPrinceAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function goodsList(obj) {
    return Object.entries(obj || {}).map(([id, n]) => `${Math.round(n * 100) / 100} ${gname(id)}`).join(' + ') || '—';
}

function stockLine(s, id) {
    const info = SettlementMarket.info(s, id);
    return `<span style="color:${info.color};">${gname(id)} ${info.label} (${Math.floor(info.stock)} in store)</span>`;
}

// ── Invest ──────────────────────────────────────────────

function investTab(game, tile) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    if (!s) return '<div style="color:#aaa;">Stand in a town to fund works there.</div>';
    let html = `<div style="${NOTE}">Fund works in ${esc(s.name)}: they run in its market after the town's own trades, taking real inputs from its stores and selling real output, and pay you a share of the value they add at the town's prices. A works stands idle when its inputs run short or its goods glut the stalls; a war, an empty royal treasury or a ruined name can cost you it.</div>`;
    const kinds = MerchantPrince.kinds();
    for (const [id, def] of Object.entries(kinds)) {
        if (!SettlementMarket.hasTrade(s, id)) continue;
        const q = MerchantPrince.investQuote(player, world, tile, id);
        const w = SettlementMarket.works(s, id);
        const m = MerchantPrince.runMargin(s, id);
        html += `<div style="${CARD}"><div><b>${esc(def.icon || '')} ${esc(def.name)}</b>${w ? ` · level ${w.lvl}${w.owner !== 'player' ? ` (${w.owner === 'crown' ? 'the crown\'s' : 'the town\'s'})` : ''} · repair ${pct(w.cond)}` : ''}</div>`;
        html += `<div style="${NOTE}">${goodsList(m.ins)} → ${goodsList(m.outs)} · a run adds <b style="color:${m.perRun > 0 ? '#2ecc71' : '#e74c3c'};">${m.perRun.toFixed(1)}g</b> at today's prices · the town's own trade works ${SettlementMarket.tradeCapacity(s, id).toFixed(1)} a day</div>`;
        html += `<div style="${NOTE}">${Object.keys(m.ins).map(x => stockLine(s, x)).join(' · ')} → ${Object.keys(m.outs).map(x => stockLine(s, x)).join(' · ')}</div>`;
        if (w && w.owner === 'player') html += `<div style="font-size:11px;">Last market day: ${w.runs} runs, ${Math.round(w.va)}g added</div>`;
        if (q.lvl) {
            const label = `${w ? 'Extend to level ' + q.lvl : 'Build'} (${g(q.gold)}${Object.keys(q.materials).length ? ` + ${goodsList(q.materials)}` : ''})`;
            html += act(label, ['invest', id], BTN_GOLD, q.ok, q.reason);
            const hands = TownLabour.worksHands(id, 1);
            const lab = s.labour;
            const wage = lab && lab.wage ? lab.wage.craft : TownLabour.baseWage(s.type, 'craft');
            html += `<span style="${NOTE}"> +${q.runs} runs a day · your share ${pct(q.share)}${q.tithe > 0 ? `, the crown takes ${pct(q.tithe)} of it` : ''}${hands > 0 ? ` · hires ${hands} hands at ${wage.toFixed(2)}g a day${lab && lab.fill && lab.fill.craft < 0.95 ? ` (artisans are scarce here: ${pct(lab.fill.craft)} of places filled)` : ''}` : ''}</span>`;
        } else if (q.reason) html += `<div style="${NOTE}">${esc(q.reason)}</div>`;
        html += '</div>';
    }
    return html;
}

// ── Warehouse ───────────────────────────────────────────

function warehouseTab(game, tile) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    let html = `<div style="${NOTE}">A store-room keeps goods outside your packs, to sell into this town's market later — buy the harvest glut and sell in the lean weeks. Goods keep twice as well as on a stall, rent falls due weekly, and thieves follow the guild, your heat and outlaws on the roads.</div>`;
    if (!s) return html + '<div style="color:#aaa;">Stand in a town to rent or use a store-room.</div>';
    const w = MerchantPrince.warehouseAt(player, tile.q, tile.r);
    const sizes = MerchantPrince.sizes();
    if (!w) {
        html += '<div>';
        for (const [id, sz] of Object.entries(sizes)) {
            html += act(`Rent a ${esc(sz.name.toLowerCase())}: ${sz.units} units (${sz.keyFee}g key, ${sz.rent}g a week)`, ['rent', id], BTN_GOLD, player.gold >= sz.keyFee);
        }
        html += '</div>';
    } else {
        const sz = sizes[w.size] || {};
        const theft = MerchantPrince.theftChance(player, world, w);
        html += `<div style="${CARD}"><b>${esc(sz.name || 'Store-room')}</b> in ${esc(w.town)} · ${Math.floor(MerchantPrince.used(w))}/${MerchantPrince.capacity(w)} units · rent ${sz.rent}g due day ${w.nextRent}${w.arrears > 0 ? ` · <span style="color:#e74c3c;">owed ${w.arrears}g</span>` : ''} · theft risk ${pct(theft)} a week</div>`;
        for (const [id, qty] of Object.entries(w.goods)) {
            const n = Math.floor(qty + 1e-9);
            const unit = n > 0 ? Math.floor(MerchantPrince.saleQuote(player, world, w, id, 1)) : 0;
            const rate = MerchantPrince.spoilRate(id);
            html += `<div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding:3px 0;">`
                + `<span>${gname(id)} × <b>${n}</b>${rate > 0 ? ` <span style="${NOTE}">spoils ${(rate * 700).toFixed(1)}% a week</span>` : ''} <span style="${NOTE}">· sells at ${unit}g</span></span><span>`
                + act('Sell 10', ['sell', w.id, id, 10], BTN_PLAIN, n >= 1)
                + act('Sell all', ['sell', w.id, id, n], BTN_PLAIN, n >= 1)
                + act('To packs', ['withdraw', w.id, id, n], BTN_PLAIN, n >= 1)
                + '</span></div>';
        }
        // From the packs
        const carried = Object.entries(player.inventory || {}).filter(([id, n]) => n >= 1 && MerchantPrince._good(id));
        if (carried.length) {
            html += '<h5 style="margin:8px 0 2px;">Store from your packs</h5><div>';
            for (const [id, n] of carried) html += act(`${gname(id)} × ${Math.floor(n)}`, ['deposit', w.id, id, Math.floor(n)], BTN_PLAIN, MerchantPrince.room(w) > 0);
            html += '</div>';
        }
        // Straight from the stalls
        const market = marketEntries(game, tile);
        if (market.length) {
            html += '<h5 style="margin:8px 0 2px;">Buy from the stalls into store</h5><div>';
            for (const e of market) {
                html += act(`${gname(e.id)} ${e.price}g · ${e.stockLabel || ''}`, ['buy', w.id, e.id, 20], BTN_PLAIN, e.quantity > 0 && MerchantPrince.room(w) > 0 && player.gold >= e.price, 'Buy 20 (the price climbs as the stall empties)');
            }
            html += '</div>';
        }
        html += '<div style="margin-top:6px;">';
        for (const [id, sz2] of Object.entries(sizes)) if (id !== w.size) html += act(`Move to a ${esc(sz2.name.toLowerCase())} (${sz2.units} units, ${sz2.rent}g a week)`, ['rent', id], BTN_PLAIN);
        html += act('Give up the lease', ['close', w.id], BTN_RED, MerchantPrince.used(w) < 1);
        html += '</div>';
    }
    const others = MerchantPrince.state(player).warehouses.filter(x => x !== w);
    if (others.length) {
        html += '<h5 style="margin:10px 0 4px;">Your other store-rooms</h5>';
        for (const o of others) html += `<div style="font-size:12px;">${esc(o.town)}: ${Math.floor(MerchantPrince.used(o))}/${MerchantPrince.capacity(o)} units — ${Object.entries(o.goods).map(([id, n]) => `${Math.floor(n)} ${gname(id)}`).join(', ') || 'empty'}</div>`;
    }
    return html;
}

/** The town's stalls the store-room can buy from, cheapest stock first (Trading.getAvailableGoods). */
function marketEntries(game, tile) {
    return Trading.getAvailableGoods(tile.settlement, tile, game.world)
        .filter(e => e.quantity > 0 && SettlementMarket.tracks(e.id))
        .sort((x, y) => x.scarcity - y.scarcity).slice(0, 12);
}

// ── Contracts ───────────────────────────────────────────

function contractsTab(game, tile) {
    const { player, world } = game;
    const st = MerchantPrince.state(player);
    const s = tile && tile.settlement;
    let html = `<div style="${NOTE}">A forward contract fixes today's price for goods you deliver by a set day, in parts if you like, from your packs or your store-room in the town. The town pays what the lot is worth here now, a little more for the wait; miss the day and a quarter of the undelivered value is forfeit, and your name suffers.</div>`;
    for (const f of st.forwards) {
        const left = f.qty - f.delivered;
        const can = MerchantPrince.deliverable(player, world, f);
        const due = f.dueDay - (world.day || 0);
        html += `<div style="${CARD}"><b>${f.qty} ${gname(f.good)}</b> to ${esc(f.town)} at ${f.unitPrice}g · delivered ${f.delivered} · <span style="color:${due <= 3 ? '#e74c3c' : '#ccc'};">due day ${f.dueDay} (${due} days)</span><div>`;
        html += act(`Deliver from packs (${Math.min(left, can.inventory)})`, ['deliver', f.id, left, 'inventory'], BTN_GOLD, can.inventory > 0);
        html += act(`Deliver from store (${Math.min(left, can.warehouse)})`, ['deliver', f.id, left, 'warehouse'], BTN_GOLD, can.warehouse > 0);
        html += '</div></div>';
    }
    if (!s) return html;
    const F = MerchantPrince.config().forwards;
    const open = st.forwards.length < F.maxOpen;
    html += `<h5 style="margin:10px 0 4px;">What ${esc(s.name)} will contract for</h5>`;
    const goods = SettlementMarket.config().goodIds.filter(id => SettlementMarket.uses(s, id) && MerchantPrince._good(id));
    const rows = [];
    for (const id of goods) {
        const qty = Math.max(F.minQty, Math.round(SettlementMarket.need(s, id) * 7));
        const q = MerchantPrince.forwardQuote(player, world, tile, id, qty, 30);
        if (!q.ok) continue;
        rows.push({ id, q, scarcity: SettlementMarket.scarcity(s, id) });
    }
    rows.sort((a, b) => b.scarcity - a.scarcity);
    for (const { id, q } of rows.slice(0, 10)) {
        html += `<div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding:3px 0;"><span>${stockLine(s, id)} · ${q.qty} at <b>${q.unitPrice}g</b> (now ${q.spot}g)</span><span>`
            + act('20 days', ['sign', id, q.qty, 20], BTN_PLAIN, open)
            + act('30 days', ['sign', id, q.qty, 30], BTN_PLAIN, open)
            + act('45 days', ['sign', id, q.qty, 45], BTN_PLAIN, open)
            + '</span></div>';
    }
    return html;
}

// ── Ledger ──────────────────────────────────────────────

function ledgerTab(game) {
    const { player, world } = game;
    const st = MerchantPrince.state(player);
    const s = st.stats;
    let html = `<div style="${CARD}">Invested ${g(s.invested)} · earned ${g(s.earned)} (crown's tithe ${g(s.tithe)}, hands' wages ${g(s.wages || 0)}) · repairs ${g(s.repairs)} · rent ${g(s.rent)} · forwards paid ${g(s.forwardIncome)}, penalties ${g(s.penalties)} · stolen ≈${g(s.stolen)}, spoiled ≈${g(s.spoiled)}</div>`;
    html += '<h5 style="margin:8px 0 4px;">Works</h5>';
    const invs = MerchantPrince.investments(player, world);
    if (!invs.length) html += `<div style="${NOTE}">None yet. Fund a mill, bakehouse or brewhouse from a town's market.</div>`;
    for (const x of invs) {
        const w = x.works || {};
        html += `<div style="font-size:12px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.06);">${esc((x.def && x.def.icon) || '')} <b>${esc((x.def && x.def.name) || x.inv.recipe)}</b> in ${esc(x.inv.town)} · level ${w.lvl || 0} · repair ${pct(w.cond == null ? 1 : w.cond)} · put in ${g(x.inv.invested)}, earned ${g(x.inv.earned)} (last ${g(x.inv.lastPay || 0)}${x.inv.lastWages ? ` after ${g(x.inv.lastWages)} wages` : ''})`;
        html += ` ${act(`Repair (${x.repairCost}g)`, ['repair', x.inv.id], BTN_PLAIN, x.repairCost > 0 && player.gold >= x.repairCost)}${act('Sell stake', ['sellStake', x.inv.id], BTN_RED)}</div>`;
    }
    const fairs = MarketFairs.fairsNear(world, player.q, player.r, 30, 20);
    html += '<h5 style="margin:10px 0 4px;">Fairs</h5>';
    if (fairs.length) for (const f of fairs.slice(0, 6)) html += `<div style="font-size:12px;">🎪 ${esc(f.name)} at ${esc(f.town)} — ${f.on ? `on until day ${f.until}` : `opens in ${f.inDays} days`} (${f.dist} hexes)</div>`;
    else {
        const nx = MarketFairs.next(world.day || 0);
        html += `<div style="${NOTE}">${nx ? `The next fair of the year is the ${esc(nx.fair.name)}, in ${nx.inDays} days.` : 'No fairs are held.'}</div>`;
    }
    if (st.log.length) {
        html += '<h5 style="margin:10px 0 4px;">Recent</h5>';
        for (const l of st.log.slice(-8).reverse()) html += `<div style="${NOTE}">Day ${l.day}: ${esc(l.text)}</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Merchant Prince panel: invest, warehouse, contracts and the holdings ledger. */
    showMerchantPrince(game, tile = null, tab = null) {
        const player = game.player;
        const world = game.world;
        const t = tile || world.getTile(player.q, player.r);
        if (tab) _tab = tab;
        const fair = t && t.settlement && SettlementMarket.fair(t.settlement);
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">💰 ${Math.floor(player.gold).toLocaleString()} gold${t && t.settlement ? ` · at ${esc(t.settlement.name)}` : ''}${fair ? ` · <b style="color:#f5c542;">🎪 the ${esc(fair.name)} is on until day ${fair.until}</b>` : ''}</p>`;
        html += '<div style="margin:6px 0;">';
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
        if (_tab === 'warehouse') html += warehouseTab(game, t);
        else if (_tab === 'contracts') html += contractsTab(game, t);
        else if (_tab === 'ledger') html += ledgerTab(game);
        else html += investTab(game, t);
        html += '</div>';
        game.ui.showCustomPanel('🏭 Merchant Prince', html);
    },

    /** Every button on the panel: op + its arguments. */
    merchantPrinceAct(game, op, a = null, b = null, c = null, d = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'invest'; break;
            case 'open': _tab = a || 'invest'; break;
            case 'invest': res = MerchantPrince.invest(player, world, tile, a); break;
            case 'repair': res = MerchantPrince.repair(player, world, a); break;
            case 'sellStake': res = MerchantPrince.sellStake(player, world, a); break;
            case 'rent': res = MerchantPrince.rentWarehouse(player, world, tile, a); break;
            case 'close': res = MerchantPrince.closeWarehouse(player, world, a); break;
            case 'deposit': res = MerchantPrince.deposit(player, world, a, b, c); break;
            case 'withdraw': res = MerchantPrince.withdraw(player, world, a, b, c); break;
            case 'buy': res = MerchantPrince.buyInto(player, world, a, b, c); break;
            case 'sell': res = MerchantPrince.sellFrom(player, world, a, b, c); break;
            case 'sign': res = MerchantPrince.signForward(player, world, tile, a, b, c); break;
            case 'deliver': res = MerchantPrince.deliverForward(player, world, a, b, c || d || 'inventory'); break;
            default: return;
        }
        if (res) {
            const text = res.success
                ? (res.earned != null ? `Done: +${res.earned} gold.` : res.spent != null ? `Done: −${res.spent} gold.` : res.gold != null ? `Done: +${res.gold} gold.` : 'Done.')
                : (res.reason || 'Not possible.');
            game.ui.showNotification('🏭 Merchant Prince', text, res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showMerchantPrince(game, tile);
    },
});
