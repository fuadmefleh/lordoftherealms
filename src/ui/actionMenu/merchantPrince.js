// ActionMenu — Merchant Prince: the market panel's Invest, Warehouse and
// Contracts tabs and 💼 Your works (stakes, fairs, the tally), opened from the
// trade window or the Counsel. Every tab is a list of action-menu rows
// (uiKit actRow): click a row to act, or use its small side buttons. Works funded in towns, rented store-rooms, forward contracts, and
// the fairs. Logic lives in systems/merchantPrince.js and
// systems/marketFairs.js; this presents it. Buttons route through
// data-am-act → ActionMenu.merchantPrinceAct.
import { ActionMenu } from './_ref.js';
import { Trading } from './_imports.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { MarketFairs } from '../../systems/marketFairs.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { TownLabour } from '../../world/townLabour.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, panelTabs, lede, chips, purse, more, actRow, rowList, price } from './uiKit.js';

const NOTE = 'font-size: 11px; color: #9d937c;';
const GOOD = '#8fd18a';
const BAD = '#e0846a';
const SMALL = 'padding:2px 8px; margin:0 0 0 4px; font-size:11px;';
// ('ledger' is the old key of Your works: the market's 📒 Ledger is the Merchant's Ledger)
const TABS = [['invest', '🏭 Invest'], ['warehouse', '📦 Warehouse'], ['contracts', '📜 Contracts'], ['ledger', '💼 Your works']];

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

/** A small merchantPrinceAct button for a listing row's side column (the row itself is then not a button). */
function sideBtn(label, args, enabled = true, title = '', style = BTN_PLAIN) {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return act(label, args, `${style} ${SMALL}`, true, title);
}

// ── Invest ──────────────────────────────────────────────

function investTab(game, tile) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    if (!s) return lede('Stand in a town to fund works there.');
    let html = lede(`Fund works in <b>${esc(s.name)}</b>: they take over a share of the town’s own trade, run on its stores, and pay you a share of the value they add. Idle trade, short inputs or glutted stalls stand a works idle; a war or an empty royal treasury can cost you it.`);
    const rows = [];
    for (const [id, def] of Object.entries(MerchantPrince.kinds())) {
        if (!SettlementMarket.hasTrade(s, id)) continue;
        const q = MerchantPrince.investQuote(player, world, tile, id);
        const w = SettlementMarket.works(s, id);
        const m = MerchantPrince.runMargin(s, id);
        const owner = w && w.owner !== 'player' ? ` (${w.owner === 'crown' ? 'the crown\'s' : 'the town\'s'})` : '';
        const level = w ? ` <span style="font-weight:400; color:#9d937c;">· level ${w.lvl}${owner} · repair ${pct(w.cond)}</span>` : '';
        const margin = `${goodsList(m.ins)} → ${goodsList(m.outs)} · a run adds <b style="color:${m.perRun > 0 ? GOOD : BAD};">${m.perRun.toFixed(1)}g</b> today`;
        const notes = [`${Object.keys(m.ins).map(x => stockLine(s, x)).join(' · ')} → ${Object.keys(m.outs).map(x => stockLine(s, x)).join(' · ')}`];
        if (w && w.owner === 'player') notes.push(`Last market day: ${w.runs} runs${w.took > 0 ? ` (${w.took} of the town's trade)` : ''}, ${Math.round(w.va)}g added`);
        if (q.lvl) {
            const hands = TownLabour.worksHands(id, 1);
            const lab = s.labour;
            const wage = lab && lab.wage ? lab.wage.craft : TownLabour.baseWage(s.type, 'craft');
            notes.push(`+${q.runs} runs a day · your share ${pct(q.share)}${q.tithe > 0 ? ` (the crown takes ${pct(q.tithe)} of it)` : ''}${hands > 0 ? ` · hires ${hands} hands at ${wage.toFixed(2)}g a day${lab && lab.fill && lab.fill.craft < 0.95 ? ` (artisans scarce: ${pct(lab.fill.craft)} of places filled)` : ''}` : ''}`);
            const mats = Object.keys(q.materials).length ? ` + ${goodsList(q.materials)}` : '';
            rows.push({
                icon: def.icon || '🏭', name: `${w ? `Extend the ${esc(def.name.toLowerCase())} to level ${q.lvl}` : `Build a ${esc(def.name.toLowerCase())}`}${level}`,
                desc: margin, note: notes.join('<br>'),
                act: 'merchantPrinceAct', args: ['invest', id], off: !q.ok, why: `${esc(q.reason || '')} · ${margin}`,
                side: `${price(q.gold, player.gold >= q.gold)}${mats ? `<small style="color:#9d937c;">${mats}</small>` : ''}`, tone: 'gold',
            });
        } else {
            rows.push({ icon: def.icon || '🏭', name: `${esc(def.name)}${level}`, desc: margin, note: [...notes, q.reason ? esc(q.reason) : ''].filter(Boolean).join('<br>') });
        }
    }
    return html + (rows.length ? rowList(rows, 'Works this town’s trade can carry') : `<div style="${NOTE}">No trade here a works could take on.</div>`);
}

// ── Warehouse ───────────────────────────────────────────

function warehouseTab(game, tile) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    let html = lede('A store-room keeps goods out of your packs (twice as well as on a stall) to sell into this town later: buy the harvest glut, sell in the lean weeks. Rent falls due weekly; thieves follow the guild, your heat and the outlaws.');
    if (!s) return html + `<div style="${NOTE}">Stand in a town to rent or use a store-room.</div>`;
    const w = MerchantPrince.warehouseAt(player, tile.q, tile.r);
    const sizes = MerchantPrince.sizes();
    if (!w) {
        html += rowList(Object.entries(sizes).map(([id, sz]) => ({
            icon: '📦', name: `Rent a ${esc(sz.name.toLowerCase())}`, desc: `${sz.units} units · ${sz.rent}g a week`,
            act: 'merchantPrinceAct', args: ['rent', id], off: player.gold < sz.keyFee, why: `${sz.units} units · ${sz.rent}g a week · the key costs ${sz.keyFee}g`,
            side: price(sz.keyFee, player.gold >= sz.keyFee), tone: 'gold',
        })), `Store-rooms in ${esc(s.name)}`);
    } else {
        const sz = sizes[w.size] || {};
        const theft = MerchantPrince.theftChance(player, world, w);
        html += chips([
            ['📦', esc(sz.name || 'Store-room'), `${Math.floor(MerchantPrince.used(w))}/${MerchantPrince.capacity(w)} units`],
            ['🗝️', 'Rent', `${sz.rent}g, due day ${w.nextRent}`],
            w.arrears > 0 ? { icon: '⚠️', label: 'Owed', value: `<span style="color:${BAD};">${w.arrears}g</span>` } : null,
            ['🦹', 'Theft risk', `${pct(theft)} a week`],
        ]);
        const stored = Object.entries(w.goods).map(([id, qty]) => {
            const n = Math.floor(qty + 1e-9);
            const unit = n > 0 ? Math.floor(MerchantPrince.saleQuote(player, world, w, id, 1)) : 0;
            const rate = MerchantPrince.spoilRate(id);
            return actRow({
                icon: '📦', name: `${gname(id)} × ${n}`,
                desc: `sells here at ${unit}g${rate > 0 ? ` · spoils ${(rate * 700).toFixed(1)}% a week` : ''}`,
                side: sideBtn('Sell 10', ['sell', w.id, id, 10], n >= 1) + sideBtn('Sell all', ['sell', w.id, id, n], n >= 1) + sideBtn('To packs', ['withdraw', w.id, id, n], n >= 1),
            });
        });
        html += rowList(stored, 'In store');
        if (!stored.length) html += `<div style="${NOTE}">The store-room is empty.</div>`;
        // From the packs
        const room = MerchantPrince.room(w) > 0;
        const carried = Object.entries(player.inventory || {}).filter(([id, n]) => n >= 1 && MerchantPrince._good(id));
        html += rowList(carried.map(([id, n]) => ({
            icon: '🎒', name: `${gname(id)} × ${Math.floor(n)}`, desc: 'Store all of it',
            act: 'merchantPrinceAct', args: ['deposit', w.id, id, Math.floor(n)], off: !room, why: 'The store-room is full', side: 'Store ›',
        })), 'Store from your packs');
        // Straight from the stalls
        html += rowList(marketEntries(game, tile).map(e => ({
            icon: '🛒', name: gname(e.id), desc: `buy 20 into store · ${esc(e.stockLabel || '')} (the price climbs as the stall empties)`,
            act: 'merchantPrinceAct', args: ['buy', w.id, e.id, 20], off: !(room && player.gold >= e.price),
            why: room ? 'Your purse is short' : 'The store-room is full', side: price(e.price, player.gold >= e.price),
        })), 'Buy from the stalls into store');
        const lease = Object.entries(sizes).filter(([id]) => id !== w.size).map(([id, sz2]) => ({
            icon: '↔️', name: `Move to a ${esc(sz2.name.toLowerCase())}`, desc: `${sz2.units} units · ${sz2.rent}g a week`, act: 'merchantPrinceAct', args: ['rent', id], side: '›',
        }));
        lease.push({ icon: '🚪', name: 'Give up the lease', desc: 'Hand back the key', act: 'merchantPrinceAct', args: ['close', w.id], off: MerchantPrince.used(w) >= 1, why: 'Empty the store-room first', tone: 'bad', side: '›' });
        html += rowList(lease, 'The lease');
    }
    const others = MerchantPrince.state(player).warehouses.filter(x => x !== w);
    html += rowList(others.map(o => ({
        icon: '📦', name: esc(o.town), desc: Object.entries(o.goods).map(([id, n]) => `${Math.floor(n)} ${gname(id)}`).join(', ') || 'empty',
        side: `${Math.floor(MerchantPrince.used(o))}/${MerchantPrince.capacity(o)}`,
    })), 'Your other store-rooms');
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
    let html = lede('A forward contract fixes today’s price (a little more for the wait) for goods you deliver by a set day, in parts if you like. Miss the day and a quarter of the undelivered value is forfeit, and your name suffers.');
    html += rowList(st.forwards.map(f => {
        const left = f.qty - f.delivered;
        const can = MerchantPrince.deliverable(player, world, f);
        const due = f.dueDay - (world.day || 0);
        return actRow({
            icon: '📜', name: `${f.qty} ${gname(f.good)} to ${esc(f.town)} at ${f.unitPrice}g`,
            desc: `delivered ${f.delivered} · <span style="color:${due <= 3 ? BAD : 'inherit'};">due day ${f.dueDay} (${due} days)</span>`,
            side: sideBtn(`From packs (${Math.min(left, can.inventory)})`, ['deliver', f.id, left, 'inventory'], can.inventory > 0, '', BTN_GOLD)
                + sideBtn(`From store (${Math.min(left, can.warehouse)})`, ['deliver', f.id, left, 'warehouse'], can.warehouse > 0, '', BTN_GOLD),
        });
    }), 'Your contracts');
    if (!s) return html;
    const F = MerchantPrince.config().forwards;
    const open = st.forwards.length < F.maxOpen;
    const goods = SettlementMarket.config().goodIds.filter(id => SettlementMarket.uses(s, id) && MerchantPrince._good(id));
    const offers = [];
    for (const id of goods) {
        const qty = Math.max(F.minQty, Math.round(SettlementMarket.need(s, id) * 7));
        const q = MerchantPrince.forwardQuote(player, world, tile, id, qty, 30);
        if (!q.ok) continue;
        offers.push({ id, q, scarcity: SettlementMarket.scarcity(s, id) });
    }
    offers.sort((a, b) => b.scarcity - a.scarcity);
    html += rowList(offers.slice(0, 10).map(({ id, q }) => actRow({
        icon: '🤝', name: `${q.qty} ${gname(id)} at <b>${q.unitPrice}g</b> <span style="font-weight:400; color:#9d937c;">(now ${q.spot}g)</span>`,
        desc: stockLine(s, id),
        side: [20, 30, 45].map(d => sideBtn(`${d} days`, ['sign', id, q.qty, d], open, open ? '' : `You hold ${F.maxOpen} contracts already`)).join(''),
    })), `What ${esc(s.name)} will contract for`);
    return html;
}

// ── Your works ──────────────────────────────────────────

function holdingsTab(game) {
    const { player, world } = game;
    const st = MerchantPrince.state(player);
    const s = st.stats;
    let html = chips([
        ['🏭', 'Invested', g(s.invested)],
        { icon: '💰', label: 'Earned', value: g(s.earned), cls: 'gold' },
        ['📜', 'Forwards', `${g(s.forwardIncome)} (${s.forwardsDone || 0} done, ${s.forwardsFailed || 0} failed)`],
    ]);
    html += more('The full tally', `<div style="${NOTE}">Crown's tithe ${g(s.tithe)} · hands' wages ${g(s.wages || 0)} · repairs ${g(s.repairs)} · store-room rent ${g(s.rent)} · contract penalties ${g(s.penalties)} · stolen ≈${g(s.stolen)} · spoiled ≈${g(s.spoiled)}</div>`);
    const invs = MerchantPrince.investments(player, world);
    html += rowList(invs.map(x => {
        const w = x.works || {};
        return actRow({
            icon: (x.def && x.def.icon) || '🏭', name: `${esc((x.def && x.def.name) || x.inv.recipe)} in ${esc(x.inv.town)}`,
            desc: `level ${w.lvl || 0} · repair ${pct(w.cond == null ? 1 : w.cond)} · put in ${g(x.inv.invested)}, earned ${g(x.inv.earned)} (last ${g(x.inv.lastPay || 0)}${x.inv.lastWages ? ` after ${g(x.inv.lastWages)} wages` : ''})`,
            side: sideBtn(`Repair ${x.repairCost}g`, ['repair', x.inv.id], x.repairCost > 0 && player.gold >= x.repairCost) + sideBtn('Sell stake', ['sellStake', x.inv.id], true, '', BTN_RED),
        });
    }), 'Your works');
    if (!invs.length) html += `<div style="${NOTE}">None yet. Fund a mill, bakehouse or brewhouse from a town's 🏭 Invest tab.</div>`;
    const fairs = MarketFairs.fairsNear(world, player.q, player.r, 30, 20);
    if (fairs.length) {
        html += rowList(fairs.slice(0, 6).map(f => ({ icon: '🎪', name: esc(f.name), desc: `at ${esc(f.town)} · ${f.dist} hexes`, side: f.on ? `on to day ${f.until}` : `in ${f.inDays} days`, tone: f.on ? 'gold' : '' })), 'Fairs near you');
    } else {
        const nx = MarketFairs.next(world.day || 0);
        if (nx) html += `<div style="${NOTE} margin-top:6px;">🎪 The next fair of the year is the ${esc(nx.fair.name)}, in ${nx.inDays} days.</div>`;
    }
    if (st.log.length) html += more('Recent dealings', st.log.slice(-8).reverse().map(l => `<div style="${NOTE}">Day ${l.day}: ${esc(l.text)}</div>`).join(''));
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
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold), t && t.settlement ? ['📍', 'At', esc(t.settlement.name)] : null, fair ? { icon: '🎪', label: `The ${esc(fair.name)}`, value: `on to day ${fair.until}`, cls: 'gold' } : null]);
        html += panelTabs(game, {
            id: 'merchantPrince', title: '🏭 Merchant Prince', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showMerchantPrince(game, t); },
            attrsFor: (k) => `data-am-act="merchantPrinceAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'warehouse') html += warehouseTab(game, t);
        else if (_tab === 'contracts') html += contractsTab(game, t);
        else if (_tab === 'ledger') html += holdingsTab(game);
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
