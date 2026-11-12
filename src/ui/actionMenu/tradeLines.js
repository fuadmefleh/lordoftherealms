// ActionMenu — the Trade Lines panel: standing caravan and ship routes.
// Lists the lines (where each is, the round in hand, the running totals),
// sets up a new line stop by stop, gives each stop its orders (buy up to N
// at P or less, sell at Q or more keeping K, supply your property, load
// from it), pauses, resumes, sends a line round once more, winds it up, and
// reads its ledger round by round. Logic lives in player/tradeLines.js; this
// panel presents it in the action menu's voice (ui/actionMenu/uiKit.js).
//   showTradeLines(game, view?, lineId?, stopId?)  view: null | 'new' | 'line' | 'stop' | 'addstop' | 'ledger'
//   tradeLinesAct(game, op, ...args)              every button's action
import { ActionMenu } from './_ref.js';
import { TradeLines } from '../../player/tradeLines.js';
import { Ships } from '../../systems/ships.js';
import { Stewards } from '../../systems/stewards.js';
import { esc, lede, chips, purse, sectionHead, card, rowList, price, BTN_GOLD } from './uiKit.js';

const INPUT = 'background:rgba(0,0,0,0.3); color:#ece2c8; border:1px solid rgba(245,197,66,0.2); border-radius:5px; padding:3px 5px; font-size:11px;';
const MUTED = '#9d937c';
const OP_ICON = { buy: '🛒', sell: '💰', supply: '📦', load: '⬆️' };
const STATUS = { running: ['▶', 'good'], paused: ['⏸', 'warn'], lost: ['✖', 'bad'] };

const _g = (n) => `${Math.round(n || 0).toLocaleString('en-US')}g`;
const _signed = (n) => `${n >= 0 ? '+' : '−'}${_g(Math.abs(n))}`;
const _val = (id) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    return el ? el.value : null;
};
const _cargo = (c) => {
    const e = Object.entries(c || {}).filter(([, n]) => n > 0);
    return e.length ? e.map(([g, n]) => `${n} ${esc(TradeLines.goodName(g).toLowerCase())}`).join(', ') : 'empty';
};

function _draft(game) {
    if (!game._tradeLineDraft) game._tradeLineDraft = { kind: 'caravan', shipId: null, stops: [] };
    return game._tradeLineDraft;
}

function _runBits(r) {
    const bits = [`sold ${_g(r.revenue)}`, `bought ${_g(r.spent)}`];
    if (r.wages) bits.push(`wages ${_g(r.wages)}`);
    if (r.crew) bits.push(`crew ${_g(r.crew)}`);
    if (r.tolls) bits.push(`tolls ${_g(r.tolls)}`);
    if (r.hire) bits.push(`wagons ${_g(r.hire)}`);
    if (r.lost) bits.push(`<span style="color:#e0846a;">lost ${_g(r.lost)}</span>`);
    if (r.supplied) bits.push(`delivered ${_g(r.supplied)} of goods to your own`);
    return bits.join(' · ');
}

Object.assign(ActionMenu, {
    showTradeLines(game, view = null, lineId = null, stopId = null) {
        const player = game.player;
        const world = game.world;
        const v = TradeLines.view(player, world);
        const line = lineId ? TradeLines.line(player, lineId) : null;
        const lv = lineId ? v.lines.find(l => l.id === lineId) : null;
        const backAll = { icon: '←', name: 'Back to all lines', act: 'showTradeLines' };
        const backLine = line ? { icon: '←', name: `Back to ${esc(line.name)}`, act: 'showTradeLines', args: ['line', line.id] } : backAll;
        let html = '<div>';

        if (view === 'new') {
            const d = _draft(game);
            const ships = (player.ships || []).filter(s => s.status !== 'building' && !TradeLines.lines(player).some(l => l.kind === 'ship' && l.shipId === s.id));
            if (d.kind === 'ship' && !ships.find(s => s.id === d.shipId)) d.shipId = ships[0] ? ships[0].id : null;
            html += lede('A line goes round its stops and back to the first, again and again. Pick the stops in order; give each its orders once the line is set up.');
            const ship = d.shipId ? Ships.getShipById(player, d.shipId) : null;
            html += rowList([
                { icon: '🐫', name: 'A caravan line', desc: `Hired wagons (${_g(TradeLines.config().caravan.hire)} to hire, ${_g(TradeLines.config().caravan.wagePerDay)} a day to the drovers), ${TradeLines.config().caravan.capacity} loads, overland`, act: 'tradeLinesAct', args: ['draftKind', 'caravan'], side: d.kind === 'caravan' ? '✓' : '›', tone: d.kind === 'caravan' ? 'gold' : '' },
                { icon: '⛵', name: 'A ship line', desc: ships.length ? `One of your ships, between harbours: ${ship ? esc(ship.name) : 'choose her below'}` : 'You have no ship free to give a line', off: !ships.length, why: 'You have no ship free to give a line', act: 'tradeLinesAct', args: ['draftKind', 'ship'], side: d.kind === 'ship' ? '✓' : '›', tone: d.kind === 'ship' ? 'gold' : '' },
            ], 'What runs it');
            if (d.kind === 'ship' && ships.length > 1) {
                html += rowList(ships.map(s => ({ icon: '⛵', name: esc(s.name), desc: `${esc(s.dockedAt || s.destinationName || s.status)} · hold ${Ships.getCargoFree(s)} free`, act: 'tradeLinesAct', args: ['draftShip', s.id], side: d.shipId === s.id ? '✓' : '›', tone: d.shipId === s.id ? 'gold' : '' })), 'Which ship');
            }
            html += rowList(d.stops.map((s, i) => ({ icon: i === 0 ? '🏠' : `${i + 1}.`, name: esc(s.name), desc: i === 0 ? 'Home: each round begins and ends here' : '', act: 'tradeLinesAct', args: ['draftDrop', i], side: 'Remove', tone: 'bad' })), 'Stops so far');
            const last = d.stops[d.stops.length - 1] || null;
            const cands = TradeLines.stopCandidates(player, world, d.kind, last).filter(c => !(last && c.q === last.q && c.r === last.r));
            html += rowList(cands.map(c => ({ icon: '➕', name: esc(c.name), desc: last ? `${c.dist} hexes from ${esc(last.name)}` : `${c.dist} hexes from you`, act: 'tradeLinesAct', args: ['draftAdd', c.q, c.r, c.name], side: 'Add ›' })), d.stops.length ? 'Add the next stop' : 'The first stop (home)');
            if (!cands.length) html += lede(d.kind === 'ship' ? 'No harbour you know of is in reach.' : 'No town you know of is within a leg\'s reach.');
            const ready = d.stops.length >= 2 && (d.kind !== 'ship' || d.shipId);
            html += rowList([
                { icon: '✍️', name: 'Set up the line', desc: ready ? `${d.stops.map(s => esc(s.name)).join(' → ')} → back` : 'At least two stops', off: !ready, why: 'At least two stops (and a ship for a ship line)', act: 'tradeLinesAct', args: ['create'], side: '›', tone: 'gold' },
                backAll,
            ]);
        } else if (view === 'line' && line && lv) {
            const [sIcon, sTone] = STATUS[lv.status] || ['?', ''];
            let body = `<div style="color:#ece2c8;">${esc(lv.where)}</div>`;
            body += `<div style="margin-top:4px; color:#cbbf9f;">Aboard: ${_cargo(lv.cargo)} · ${lv.free} room</div>`;
            body += `<div style="margin-top:4px; color:#cbbf9f;">Round ${lv.run.n} so far: ${_runBits(lv.run)} · <b>${_signed(lv.run.net)}</b></div>`;
            body += `<div style="margin-top:4px; color:${MUTED};">All rounds (${lv.totals.runs}): ${_runBits(lv.totals)} · <b style="color:${lv.totals.net >= 0 ? '#8fd18a' : '#e0846a'};">${_signed(lv.totals.net)}</b>${lv.totals.losses ? ` · robbed ${lv.totals.losses} times` : ''}</div>`;
            if (lv.disband) body += '<div style="margin-top:4px; color:#f0b35a;">To be wound up at its next stop.</div>';
            html += card(body, { icon: lv.kind === 'ship' ? '⛵' : '🐫', title: esc(lv.name), side: `${sIcon} ${esc(lv.status)}${lv.ship ? ` · ${esc(lv.ship)}` : ''}`, tone: sTone });
            html += rowList(line.stops.map((s, i) => ({
                icon: i === 0 ? '🏠' : `${i + 1}.`,
                name: `${esc(s.name)}${s.id === line.atId && line.phase !== 'road' ? ' <span style="color:#d8c27a; font-size:11px;">here now</span>' : ''}${s.id === line.nextId ? ' <span style="color:#d8c27a; font-size:11px;">bound here</span>' : ''}`,
                desc: s.rules.length ? s.rules.map(r => `${OP_ICON[r.op]} ${esc(TradeLines.describeRule(r))}`).join(' · ') : 'No orders: the line only passes through',
                act: 'showTradeLines', args: ['stop', line.id, s.id], side: 'Orders ›',
            })), 'Stops and their orders');
            const rows = [];
            if (lv.status === 'running') rows.push({ icon: '⏸', name: 'Pause the line', desc: 'It stops at the next stop it reaches and waits there', act: 'tradeLinesAct', args: ['pause', line.id], side: '›' });
            else if (lv.status === 'paused') rows.push({ icon: '▶', name: 'Resume the line', desc: 'Back on the road (and paid what the drovers are owed going forward)', act: 'tradeLinesAct', args: ['resume', line.id], side: '›', tone: 'gold' });
            if (lv.status === 'running' && line.phase === 'hold') rows.push({ icon: '🔁', name: 'Send it round once more', desc: 'Your word for one more round while you are away', act: 'tradeLinesAct', args: ['again', line.id], side: '›', tone: 'gold' });
            rows.push(
                { icon: '➕', name: 'Add a stop', desc: `${line.stops.length} of ${TradeLines.config().maxStops}`, off: line.stops.length >= TradeLines.config().maxStops, why: 'As many stops as a line can keep', act: 'showTradeLines', args: ['addstop', line.id], side: '›' },
                { icon: '💰', name: `Keep at least ${_g(line.reserve)} in your purse`, desc: 'The line buys nothing that would take your purse under it', act: 'tradeLinesAct', args: ['reserve', line.id], side: 'Change ›' },
                { icon: '📒', name: 'The ledger', desc: lv.history.length ? `${lv.history.length} rounds kept, the last ${_signed(lv.history[0].net)}` : 'No round finished yet', act: 'showTradeLines', args: ['ledger', line.id], side: '›' },
                { icon: '📕', name: 'Wind up the line', desc: line.kind === 'ship' ? 'The ship keeps her hold and waits on your orders' : 'Its goods come to your packs if you stand at its stop, else they are sold where it stands', act: 'tradeLinesAct', args: ['remove', line.id], side: '›', tone: 'bad' },
                backAll,
            );
            html += rowList(rows, 'Orders for the line');
        } else if (view === 'stop' && line) {
            const stop = line.stops.find(s => s.id === stopId);
            if (!stop) return ActionMenu.showTradeLines(game, 'line', line.id);
            const goods = TradeLines.goodsFor(line.kind);
            html += lede(`What the line does at <strong>${esc(stop.name)}</strong>. It sells and delivers first, then loads and buys. Prices move as it trades: each sack bought costs a little more, each sold fetches a little less.`);
            html += rowList(stop.rules.map((r, i) => {
                const q = TradeLines.quote(player, world, line, stop, r.good);
                const now = r.op === 'buy' ? (q.buy != null ? `asks ${q.buy}g now` : 'not sold here now') : r.op === 'sell' ? (q.sell != null ? `pays ${q.sell}g now` : 'nobody buys it here') : '';
                return { icon: OP_ICON[r.op], name: esc(TradeLines.describeRule(r)), desc: now, act: 'tradeLinesAct', args: ['dropRule', line.id, stop.id, i], side: 'Strike', tone: 'bad' };
            }), 'Orders here');
            if (!stop.rules.length) html += lede('No orders yet.');
            const opts = goods.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
            let form = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">`;
            form += `<select id="tl_op" style="${INPUT}"><option value="buy">Buy</option><option value="sell">Sell</option><option value="supply">Supply my property</option><option value="load">Load from my property</option></select>`;
            form += `<select id="tl_good" style="${INPUT} max-width:150px;">${opts}</select>`;
            form += `<span style="color:${MUTED}; font-size:11px;">qty</span><input id="tl_qty" type="number" min="0" value="20" style="${INPUT} width:56px;">`;
            form += `<span style="color:${MUTED}; font-size:11px;">price</span><input id="tl_price" type="number" min="0" value="10" style="${INPUT} width:56px;">`;
            form += `<span style="color:${MUTED}; font-size:11px;">keep</span><input id="tl_keep" type="number" min="0" value="0" style="${INPUT} width:46px;">`;
            form += `<button type="button" data-am-act="tradeLinesAct" data-am-args='${esc(JSON.stringify(['addRule', line.id, stop.id]))}' style="${BTN_GOLD}">Add order</button></div>`;
            form += `<div style="margin-top:6px; font-size:11px; color:${MUTED};">Buy: up to <i>qty</i> aboard while the next unit costs <i>price</i> or less. Sell: while the next unit fetches <i>price</i> or more, keeping <i>keep</i> aboard. Supply: <i>qty</i> a visit (0 = all) to your workshop that uses it, or a town you hold. Load: what your property here has made (<i>qty</i> 0 = as much as fits).</div>`;
            html += sectionHead('A new order') + card(form);
            html += rowList([
                { icon: '🗑️', name: `Strike ${esc(stop.name)} from the line`, off: line.stops.length <= 2, why: 'A line keeps at least two stops', act: 'tradeLinesAct', args: ['dropStop', line.id, stop.id], side: '›', tone: 'bad' },
                backLine,
            ]);
        } else if (view === 'addstop' && line) {
            const last = line.stops[line.stops.length - 1];
            const cands = TradeLines.stopCandidates(player, world, line.kind, last).filter(c => !line.stops.some(s => s.q === c.q && s.r === c.r));
            html += lede(`A new stop goes in after <strong>${esc(last.name)}</strong>, before the line comes home to ${esc(line.stops[0].name)}.`);
            html += rowList(cands.map(c => ({ icon: '➕', name: esc(c.name), desc: `${c.dist} hexes from ${esc(last.name)}`, act: 'tradeLinesAct', args: ['addStop', line.id, c.q, c.r], side: 'Add ›' })), 'In reach');
            if (!cands.length) html += lede('No town you know of is in reach.');
            html += rowList([backLine]);
        } else if (view === 'ledger' && line && lv) {
            html += lede(`Every round of <strong>${esc(lv.name)}</strong>: what it sold and bought, what it cost to run, what it lost, and why goods were kept back.`);
            html += chips([['🔁', 'Rounds', lv.totals.runs], ['💰', 'Sold', _g(lv.totals.revenue)], ['🛒', 'Bought', _g(lv.totals.spent)], ['🗡️', 'Lost', _g(lv.totals.lost)], ['📒', 'Net', _signed(lv.totals.net), lv.totals.net >= 0 ? 'gold' : '']]);
            for (const r of lv.history) {
                const notes = (r.notes || []).slice(-6).map(n => `<div style="font-size:11px; color:${MUTED}; margin-top:2px;">${esc(n)}</div>`).join('');
                html += card(`<div style="color:#cbbf9f;">${_runBits(r)}</div>${notes}`, { icon: r.why === 'robbed' ? '🗡️' : r.net >= 0 ? '📒' : '📉', title: `Round ${r.n}: days ${r.startDay}–${r.endDay}${r.why ? ` (${esc(r.why)})` : ''}`, side: _signed(r.net), tone: r.net >= 0 ? 'good' : 'bad' });
            }
            if (!lv.history.length) html += lede('No round finished yet.');
            html += rowList([backLine]);
        } else {
            html += lede('Standing routes: a caravan or one of your ships goes round its stops and back, buying and selling by your orders at each, round after round. Coin comes out of your purse and goes back into it; the goods ride on the wagons or in the hold.');
            const f = v.factor;
            html += chips([purse(player.gold), ['🔁', 'Lines', `${v.lines.length} / ${TradeLines.config().maxLines}`], ['📒', 'All rounds', _signed(v.stats.net)], ['🗡️', 'Robbed', v.stats.robbed]]);
            html += rowList(v.lines.map(l => {
                const [sIcon, sTone] = STATUS[l.status] || ['?', ''];
                return {
                    icon: l.kind === 'ship' ? '⛵' : '🐫', name: `${esc(l.name)} <span style="color:${MUTED}; font-size:11px;">${l.stops.length} stops${l.ship ? ` · ${esc(l.ship)}` : ''}</span>`,
                    desc: esc(l.where), note: `Round ${l.run.n} ${_signed(l.run.net)} · all ${_signed(l.totals.net)}${l.totals.losses ? ` · robbed ${l.totals.losses}×` : ''}`,
                    act: 'showTradeLines', args: ['line', l.id], side: `${sIcon} ›`, tone: sTone,
                };
            }), 'Your lines');
            if (!v.lines.length) html += lede('You run no lines yet.');
            const rows = [
                { icon: '🐫', name: 'A new caravan line', desc: 'Hired wagons on a loop of towns', act: 'tradeLinesAct', args: ['newLine', 'caravan'], side: '›', tone: 'gold', off: v.lines.length >= TradeLines.config().maxLines, why: 'As many lines as you can run' },
                { icon: '⛵', name: 'A new ship line', desc: (player.ships || []).length ? 'One of your ships on a loop of harbours' : 'You have no ship', act: 'tradeLinesAct', args: ['newLine', 'ship'], side: '›', off: !(player.ships || []).length || v.lines.length >= TradeLines.config().maxLines, why: (player.ships || []).length ? 'As many lines as you can run' : 'You have no ship' },
            ];
            const seat = Stewards.seat(player, world, 'trade');
            if (seat) {
                rows.push(f
                    ? { icon: '📜', name: `Master of the Lines: ${esc(f.name)}`, desc: `Runs the lines while you are away · haggles ${f.haggle >= 0 ? '+' : ''}${Math.round(f.haggle * 1000) / 10}%`, act: 'showStewards', args: ['seat', 'trade'], side: '›' }
                    : { icon: '📜', name: 'Name a Master of the Lines', desc: 'Without one, a line waits at home while you are far from its stops', act: 'showStewards', args: ['appoint', 'trade'], side: 'Appoint ›', tone: 'warn' });
            }
            html += rowList(rows, 'New lines');
            if (v.log.length) html += sectionHead('Of late') + v.log.slice(0, 8).map(l => `<div style="font-size:11px; color:#bbb; padding:2px 0;">Day ${l.day}: ${esc(l.text)}</div>`).join('');
        }
        html += '</div>';
        game.ui.showCustomPanel('🔁 Trade Lines', html);
    },

    tradeLinesAct(game, op, a = null, b = null, c = null, d = null) {
        const player = game.player;
        const world = game.world;
        const say = (res, title, ok = 'success') => {
            if (!res || res.success === false) game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            else if (res.text) game.ui.showNotification(title, res.text, ok);
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            return res && res.success !== false;
        };
        const draft = _draft(game);
        switch (op) {
            case 'newLine':
                game._tradeLineDraft = { kind: a === 'ship' ? 'ship' : 'caravan', shipId: null, stops: [] };
                if (Number.isFinite(player.q)) {
                    const t = world.getTile(player.q, player.r);
                    const here = t && t.settlement && TradeLines.stopCandidates(player, world, game._tradeLineDraft.kind, null).find(s => s.q === player.q && s.r === player.r);
                    if (here) game._tradeLineDraft.stops.push({ q: here.q, r: here.r, name: here.name });
                }
                return ActionMenu.showTradeLines(game, 'new');
            case 'draftKind':
                draft.kind = a === 'ship' ? 'ship' : 'caravan';
                draft.stops = draft.kind === 'ship' ? draft.stops.filter(s => Ships.isPortTile(world, s.q, s.r)) : draft.stops;
                return ActionMenu.showTradeLines(game, 'new');
            case 'draftShip': draft.shipId = a; return ActionMenu.showTradeLines(game, 'new');
            case 'draftAdd':
                if (draft.stops.length < TradeLines.config().maxStops) draft.stops.push({ q: a, r: b, name: c });
                return ActionMenu.showTradeLines(game, 'new');
            case 'draftDrop': draft.stops.splice(a, 1); return ActionMenu.showTradeLines(game, 'new');
            case 'create': {
                const res = TradeLines.create(player, world, { kind: draft.kind, shipId: draft.shipId, stops: draft.stops });
                if (!say(res, '🔁 A New Line')) return ActionMenu.showTradeLines(game, 'new');
                game._tradeLineDraft = null;
                return ActionMenu.showTradeLines(game, 'line', res.line.id);
            }
            case 'pause': say(TradeLines.pause(player, world, a), '⏸ Line Paused', 'info'); return ActionMenu.showTradeLines(game, 'line', a);
            case 'resume': say(TradeLines.resume(player, world, a), '▶ Line Resumed'); return ActionMenu.showTradeLines(game, 'line', a);
            case 'again': say(TradeLines.sendAgain(player, world, a), '🔁 Once More'); return ActionMenu.showTradeLines(game, 'line', a);
            case 'reserve': {
                const steps = [0, 100, 250, 500, 1000, 2500, 5000];
                const line = TradeLines.line(player, a);
                const cur = line ? line.reserve || 0 : 0;
                const next = steps[(steps.indexOf(cur) + 1) % steps.length] || 0;
                say(TradeLines.setReserve(player, a, next), '💰 Purse Kept', 'info');
                return ActionMenu.showTradeLines(game, 'line', a);
            }
            case 'remove': {
                const res = TradeLines.remove(player, world, a);
                say(res, '📕 Line Wound Up', 'info');
                return ActionMenu.showTradeLines(game, TradeLines.line(player, a) ? 'line' : null, TradeLines.line(player, a) ? a : null);
            }
            case 'addStop': say(TradeLines.addStop(player, world, a, b, c), '➕ Stop Added'); return ActionMenu.showTradeLines(game, 'line', a);
            case 'dropStop': say(TradeLines.removeStop(player, world, a, b), '🗑️ Stop Struck', 'info'); return ActionMenu.showTradeLines(game, 'line', a);
            case 'addRule': {
                const rule = { op: _val('tl_op') || 'buy', good: _val('tl_good'), qty: Number(_val('tl_qty')), price: Number(_val('tl_price')), keep: Number(_val('tl_keep')) };
                say(TradeLines.addRule(player, a, b, rule), '📜 Order Given');
                return ActionMenu.showTradeLines(game, 'stop', a, b);
            }
            case 'dropRule': say(TradeLines.removeRule(player, a, b, c), '📜 Order Struck', 'info'); return ActionMenu.showTradeLines(game, 'stop', a, b);
            default: void d; return ActionMenu.showTradeLines(game);
        }
    },
});
