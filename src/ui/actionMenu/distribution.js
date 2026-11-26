// ActionMenu — Distribution: where a property's output goes (player/distribution.js).
//   distributionSection(game, tile, prop)   the manage-property panel's section: each share
//                                           (destination, percent, on the road, last delivered,
//                                           carriage a day), the rest, the batching, warnings
//   showDistributionPicker(game, planId, legId)   choose a destination ('new' share, a share, 'rest')
//   showDistribution(game)                  every plan and the goods on the road
//   distributionAct(game, op, ...args)      every button's action
// In the action menu's voice (ui/actionMenu/uiKit.js).
import { ActionMenu } from './_ref.js';
import { Distribution } from '../../player/distribution.js';
import { PlayerEconomy } from '../../player/playerEconomy.js';
import { esc, lede, chips, sectionHead, card, rowList, actRow, BTN_GOLD, BTN_PLAIN, BTN_RED } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const INPUT = 'background:rgba(0,0,0,0.3); color:#ece2c8; border:1px solid rgba(245,197,66,0.2); border-radius:5px; padding:3px 5px; font-size:11px; width:52px;';
const MUTED = '#9d937c';
const WARN = '#f0b35a';
const _g = (n) => `${Utils.formatGold(n || 0)}g`;
const _gn = (id) => esc(Distribution.goodName(id).toLowerCase());
const _btn = (label, op, args, style = BTN_PLAIN, title = '') => `<button type="button" data-am-act="distributionAct" data-am-args="${esc(JSON.stringify([op, ...args]))}" style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
const _val = (id) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    return el ? el.value : null;
};
const BATCH = { daily: 'Daily', load: 'By the load', weekly: 'Weekly' };

/** The words for a batching rule. */
function _batchText(plan) {
    const b = plan.batch;
    if (b.mode === 'daily') return 'a consignment every day there is something to send';
    if (b.mode === 'load') return `a consignment when a share has ${b.n} gathered`;
    return `a consignment every ${Distribution.config().weeklyDays} days`;
}

/** One leg's line: on the road, last delivered, carriage a day. */
function _legDesc(game, plan, leg, transit, waiting = 0) {
    const bits = [];
    if (leg.dest.kind === 'keep') return 'stays in this property\'s store';
    const same = leg.dest.q === plan.q && leg.dest.r === plan.r;
    if (same) bits.push('same hex: moved at once');
    else {
        const q = Distribution.quote(game.player, game.world, plan, leg, Math.max(1, plan.batch.n));
        if (q.ok) bits.push(`~${q.days} day${q.days > 1 ? 's' : ''} by cart${q.rob > 0.005 ? ` · <span style="color:${WARN};">${Math.round(q.rob * 100)}% robbery risk</span>` : ''}`);
    }
    if (leg.pending >= 1) bits.push(`${Math.floor(leg.pending)} gathered`);
    if (transit > 0) bits.push(`<b style="color:#ece2c8;">${transit} on the road</b>`);
    if (waiting > 0) bits.push(`<span style="color:${WARN};">${waiting} waiting there</span>`);
    if (leg.lastDay != null) bits.push(`last ${leg.lastQty} on day ${leg.lastDay}`);
    if (leg.carriage > 0) bits.push(`carriage ≈${_g(Distribution.carriagePerDay(game.world, plan, leg))}/day`);
    if (leg.tolls > 0) bits.push(`tolls ${_g(leg.tolls)}`);
    if (leg.earned > 0) bits.push(`sold for ${_g(leg.earned)}`);
    if (leg.lost > 0) bits.push(`<span style="color:#e0846a;">${leg.lost} lost</span>`);
    return bits.join(' · ');
}

/** The manage-property panel's Distribution section. */
export function distributionSection(game, tile, prop) {
    const player = game.player;
    const world = game.world;
    const good = Distribution.goodOf(prop);
    const plan = Distribution.planFor(player, tile.q, tile.r, prop.type);
    let html = sectionHead('🚚 Distribution');
    if (!plan) {
        if (!good) return html + lede(PlayerEconomy.isRecipeBuilding(prop.type) ? 'Choose a recipe first; then you can share its output out to your other works, stores and markets.' : '');
        html += lede(`Send shares of each day's ${_gn(good)} on its way by hired carters: 10% to a store-room, half to a workshop that works it, the rest sold at a market, and so on.`);
        return html + rowList([{ icon: '➕', name: 'Set up a distribution plan', desc: 'Only new output is shared out; what is stored now stays', act: 'distributionAct', args: ['ensure', tile.q, tile.r, prop.type], side: '›', tone: 'gold' }]);
    }
    const v = Distribution.view(player, world).plans.find(x => x.plan === plan);
    const sum = plan.shares.reduce((a, s) => a + s.pct, 0);
    const onRoad = Distribution.inTransit(player, plan.id).filter(c => c.status !== 'waiting').reduce((a, c) => a + c.qty, 0);
    html += chips([
        ['📦', 'Good', esc(Distribution.goodName(plan.good))],
        ['%', 'Shared out', `${sum}%`, sum > 100 ? 'bad' : ''],
        ['🚚', 'On the road', onRoad],
        plan.on ? null : ['⏸', 'Paused', ''],
    ]);
    const warns = v ? v.warnings : [];
    if (warns.length) html += `<div style="font-size:11px; color:${WARN}; margin:4px 0 6px;">⚠ ${warns.map(esc).join('<br>⚠ ')}</div>`;
    const rows = [];
    if (good && good !== plan.good) rows.push({ icon: '🔁', name: `Share out the ${_gn(good)} instead`, desc: `The plan was set for ${_gn(plan.good)}; the shares stay as they are`, act: 'distributionAct', args: ['retarget', plan.id], side: '›', tone: 'gold' });
    for (const lv of (v ? v.legs : [])) {
        const leg = lv.leg;
        if (leg.rest) continue;
        const id = `dist-pct-${plan.id}-${leg.id}`;
        rows.push(actRow({
            icon: lv.icon,
            name: `${leg.pct}% → ${esc(lv.name)}`,
            desc: _legDesc(game, plan, leg, lv.transit, lv.waiting),
            side: `<input id="${id}" type="number" min="1" max="100" value="${leg.pct}" style="${INPUT}">`
                + _btn('Set', 'pct', [plan.id, leg.id]) + _btn('Where…', 'pickFor', [plan.id, leg.id]) + _btn('✕', 'remove', [plan.id, leg.id], BTN_RED, 'Strike this share'),
        }));
    }
    const rest = v ? v.legs.find(l => l.leg.rest) : null;
    if (rest) {
        rows.push(actRow({
            icon: rest.icon,
            name: `The rest (${Math.max(0, 100 - sum)}%) → ${esc(rest.name)}`,
            desc: _legDesc(game, plan, plan.rest, rest.transit, rest.waiting),
            side: _btn('Where…', 'pickFor', [plan.id, 'rest']),
        }));
    }
    if (plan.shares.length < Distribution.config().maxShares && sum < 100) {
        rows.push({ icon: '➕', name: 'Add a share', desc: `${100 - sum}% left to share out`, act: 'showDistributionPicker', args: [plan.id, 'new'], side: '›', tone: 'gold' });
    }
    html += rowList(rows);
    // Batching: daily, when N have gathered, weekly
    const b = plan.batch;
    const pick = (mode) => _btn(BATCH[mode], 'batch', [plan.id, mode], b.mode === mode ? BTN_GOLD : BTN_PLAIN);
    html += rowList([actRow({
        icon: '🗓️',
        name: 'Consignments',
        desc: `${_batchText(plan)}. Small daily lots cost the carters' minimum fee each time; gathering a load first is cheaper.`,
        side: `${pick('daily')}${pick('load')}<input id="dist-n-${plan.id}" type="number" min="1" max="9999" value="${b.n}" style="${INPUT}" title="Units gathered before a load goes">${pick('weekly')}`,
    })], 'Batching');
    html += rowList([
        { icon: plan.on ? '⏸' : '▶', name: plan.on ? 'Pause the plan' : 'Resume the plan', desc: plan.on ? 'New output stays in store; goods on the road still arrive' : 'Share out the output again', act: 'distributionAct', args: ['toggle', plan.id], side: '›' },
        { icon: '🗺️', name: 'All plans and goods on the road', act: 'showDistribution', side: '›' },
        { icon: '✖', name: 'End this plan', desc: 'What was gathered stays in store; goods on the road still arrive', act: 'distributionAct', args: ['end', plan.id], side: '›', tone: 'bad' },
    ]);
    if (prop.autoSell) html += `<div style="font-size:11px; color:${MUTED};">Auto-sell is set aside while the plan runs: the plan says where the output goes.</div>`;
    return html;
}

function _refresh(game, plan) {
    if (!plan) { ActionMenu.showDistribution(game); return; }
    const tile = game.world.getTile(plan.q, plan.r);
    const prop = tile && PlayerEconomy.findPropertyAt(tile, plan.type);
    if (!prop) { ActionMenu.showDistribution(game); return; }
    tile.playerProperty = prop;
    ActionMenu.showManagePropertyMenu(game, tile);
}

Object.assign(ActionMenu, {
    /** Choose where a share (legId), the rest ('rest') or a new share ('new') goes. */
    showDistributionPicker(game, planId, legId) {
        const player = game.player;
        const world = game.world;
        const plan = Distribution.plan(player, planId);
        if (!plan) { ActionMenu.showDistribution(game); return; }
        const sum = plan.shares.reduce((a, s) => a + s.pct, 0);
        const leg = legId === 'new' ? null : (legId === 'rest' ? plan.rest : plan.shares.find(s => s.id === legId));
        let html = '<div>';
        html += rowList([{ icon: '←', name: `Back to ${esc(plan.name || 'the property')}`, act: 'distributionAct', args: ['back', plan.id], side: '' }]);
        const what = legId === 'new' ? 'the new share' : legId === 'rest' ? 'the rest' : `this ${leg ? leg.pct : ''}% share`;
        html += lede(`Where does ${what} of the ${_gn(plan.good)} go? Your works that use it, your stores, the towns you hold, or a market to sell in. Carters charge by weight and distance (less on roads); a border costs tolls.`);
        if (legId === 'new') {
            const room = 100 - sum;
            html += `<div style="display:flex; align-items:center; gap:8px; margin:4px 0 8px; font-size:12px; color:#ece2c8;">Percent of each day's output:
                <input id="dist-new-pct" type="range" min="1" max="${room}" value="${Math.min(10, room)}" oninput="document.getElementById('dist-new-pct-n').value=this.value" style="flex:1;">
                <input id="dist-new-pct-n" type="number" min="1" max="${room}" value="${Math.min(10, room)}" oninput="document.getElementById('dist-new-pct').value=this.value" style="${INPUT}"> <span style="color:${MUTED};">of ${room}% left</span></div>`;
        }
        const sample = Math.max(1, plan.batch.n);
        const rows = [];
        for (const c of Distribution.destinations(player, world, plan.q, plan.r, plan.type, plan.good)) {
            if (legId !== 'rest' && c.dest.kind === 'keep') continue;
            const taken = plan.shares.some(s => s !== leg && JSON.stringify(s.dest) === JSON.stringify(c.dest));
            let side = '';
            if (c.dest.kind !== 'keep') {
                const q = Distribution.quote(player, world, plan, { dest: c.dest, route: null }, sample);
                side = !q.ok ? `<span style="color:#e0846a;">no way</span>` : q.days === 0 ? 'here' : `${q.days}d · ${_g(q.fee)}/${sample}`;
            }
            const cur = leg && JSON.stringify(leg.dest) === JSON.stringify(c.dest);
            rows.push({
                icon: c.icon, name: esc(c.name), desc: [c.dist ? `${c.dist} hexes` : '', c.note].filter(Boolean).map(esc).join(' · ') || (c.dest.kind === 'keep' ? 'Leave it in this property\'s store' : ''),
                note: !c.ok && c.why ? `<span style="color:${WARN};">${esc(c.why)}</span>` : '',
                off: taken, why: 'Already has a share',
                act: 'distributionAct', args: ['pick', plan.id, legId, c.dest], side: cur ? '✓' : side, tone: cur ? 'gold' : '',
            });
        }
        html += rowList(rows, 'Destinations');
        html += '</div>';
        game.ui.showCustomPanel('🚚 Distribution — Destination', html);
    },

    /** Every plan, and the goods on the road. */
    showDistribution(game) {
        const player = game.player;
        const world = game.world;
        const v = Distribution.view(player, world);
        let html = '<div>';
        html += lede('Standing plans for where your properties\' output goes, and the carters\' consignments now on the road. Set a plan up from a property\'s own panel.');
        const st = v.stats;
        html += chips([
            ['📋', 'Plans', v.plans.length],
            ['🚚', 'On the road', v.transit.filter(c => c.status !== 'waiting').reduce((a, c) => a + c.qty, 0)],
            ['💰', 'Sales', _g(st.earned)],
            ['🐴', 'Carriage', _g(st.carriage)],
            st.tolls ? ['🧾', 'Tolls', _g(st.tolls)] : null,
            st.lost ? ['🗡️', 'Lost', st.lost, 'bad'] : null,
        ]);
        if (!v.plans.length) html += lede('No plans yet.');
        for (const p of v.plans) {
            const legs = p.legs.map(l => `${l.pct}% ${esc(l.name)}${l.transit ? ` <span style="color:${MUTED};">(${l.transit} on the road)</span>` : ''}${l.waiting ? ` <span style="color:${WARN};">(${l.waiting} waiting)</span>` : ''}`).join('<br>');
            const warn = p.warnings.length ? `<div style="font-size:11px; color:${WARN}; margin-top:4px;">⚠ ${p.warnings.map(esc).join('<br>⚠ ')}</div>` : '';
            html += card(`<div style="font-size:12px; color:#ece2c8;">${legs}</div><div style="font-size:11px; color:${MUTED}; margin-top:3px;">${esc(_batchText(p.plan))} · ${p.plan.totals.made} made since day ${p.plan.since}</div>${warn}`
                + `<div style="margin-top:4px;">${_btn('Manage ›', 'back', [p.plan.id], BTN_GOLD)}</div>`, {
                icon: '🏭', title: `${esc(p.name)} <span style="font-size:11px; color:${MUTED}; font-weight:400;">at ${esc(p.where)} · ${_gn(p.good)}</span>`,
                side: p.plan.on ? '' : '⏸ paused',
            });
        }
        if (v.transit.length) {
            const day = world.day || 0;
            html += rowList(v.transit.map(c => ({
                icon: c.status === 'waiting' ? '⏳' : c.status === 'return' ? '↩️' : '🚚',
                name: `${c.qty} ${_gn(c.good)} → ${esc(c.status === 'return' ? `back to ${c.from.name}` : c.toName)}`,
                desc: c.status === 'waiting' ? `waiting there until day ${c.waitUntil}${c.why ? `: ${esc(c.why)}` : ''}` : `from ${esc(c.from.name)}, set out day ${c.departDay}`,
                side: c.status === 'waiting' ? 'waiting' : `${Math.max(0, c.arriveDay - day)}d`,
            })), 'On the road');
        }
        if (v.log && v.log.length) html += rowList(v.log.slice(0, 8).map(e => ({ icon: '·', name: `<span style="font-weight:400;">${esc(e.text)}</span>`, side: `day ${e.day}` })), 'Lately');
        html += '</div>';
        game.ui.showCustomPanel('🚚 Distribution', html);
    },

    distributionAct(game, op, ...args) {
        const player = game.player;
        const world = game.world;
        const say = (res, ok = null) => {
            if (res && !res.success) game.ui.showNotification('🚚 Distribution', res.reason, 'error');
            else if (ok) game.ui.showNotification('🚚 Distribution', ok, 'success');
        };
        if (op === 'ensure') {
            const [q, r, type] = args;
            const res = Distribution.ensurePlan(player, world, q, r, type);
            say(res);
            if (res.success) _refresh(game, res.plan);
            return;
        }
        const plan = Distribution.plan(player, args[0]);
        if (!plan) { ActionMenu.showDistribution(game); return; }
        if (op === 'back') { _refresh(game, plan); return; }
        if (op === 'pickFor') { ActionMenu.showDistributionPicker(game, plan.id, args[1]); return; }
        if (op === 'pick') {
            const [, legId, dest] = args;
            let res;
            if (legId === 'new') res = Distribution.addShare(player, world, plan.id, dest, Number(_val('dist-new-pct-n') || _val('dist-new-pct') || 10));
            else if (legId === 'rest') res = Distribution.setRest(player, world, plan.id, dest);
            else res = Distribution.updateShare(player, world, plan.id, legId, { dest });
            say(res, res.success && res.text ? res.text : null);
            if (res.success) _refresh(game, plan); else ActionMenu.showDistributionPicker(game, plan.id, legId);
            return;
        }
        if (op === 'pct') {
            const legId = args[1];
            say(Distribution.updateShare(player, world, plan.id, legId, { pct: Number(_val(`dist-pct-${plan.id}-${legId}`)) }));
        } else if (op === 'remove') {
            say(Distribution.removeShare(player, world, plan.id, args[1]));
        } else if (op === 'batch') {
            say(Distribution.setBatch(player, plan.id, args[1], args[1] === 'load' ? Number(_val(`dist-n-${plan.id}`)) : null));
        } else if (op === 'retarget') {
            const res = Distribution.retarget(player, world, plan.id);
            say(res, res.success ? res.text : null);
        } else if (op === 'toggle') {
            say(Distribution.setOn(player, plan.id, !plan.on));
        } else if (op === 'end') {
            const tile = world.getTile(plan.q, plan.r);
            say(Distribution.removePlan(player, world, plan.id), 'The plan is ended.');
            const prop = tile && PlayerEconomy.findPropertyAt(tile, plan.type);
            if (prop) { tile.playerProperty = prop; ActionMenu.showManagePropertyMenu(game, tile); } else ActionMenu.showDistribution(game);
            return;
        }
        _refresh(game, plan);
    },
});

