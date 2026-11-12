// ActionMenu — houses of hospitality (systems/hospitality.js): the guest
// houses, inns, grand hotels and roadhouses where you stand — take a room for
// the night (and sleep at once if you like), order supper, a bath, laundry or
// a valet — and, for your own house, run it: room prices, staff, cleanliness,
// this week's guests and takings against the town's other houses.
// Opened from the world action menu ('lodging'), an inn's building on the
// inner map ('lodging' / 'manage_lodging') and its furniture (a bed, the
// desk, a table, the tub). Buttons route through data-am-act → lodgingAct.
import { ActionMenu } from './_ref.js';
import { InnerMap, PlayerInventory } from './_imports.js';
import { Hospitality } from '../../systems/hospitality.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, CARD, esc, panelTabs } from './uiKit.js';

let _tab = 'stay';

function act(label, args, style = BTN_PLAIN, title = '') {
    return `<button data-am-act="lodgingAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function off(label, why) {
    return `<button disabled style="${BTN_OFF}" title="${esc(why || '')}">${label}</button>`;
}

function stars(n) {
    const full = Math.round(n);
    return `<span style="color:#f5c542;" title="${n} stars">${'★'.repeat(full)}<span style="opacity:0.3;">${'★'.repeat(Math.max(0, 5 - full))}</span></span>`;
}

function _here(game) {
    const { player, world } = game;
    return { q: player.q, r: player.r, tile: world.getTile(player.q, player.r) };
}

/** The house the player is inside on the inner map, if any. */
function _insideId() {
    const b = InnerMap && InnerMap.active ? InnerMap._insideBuilding : null;
    return b && b.establishmentId ? b.establishmentId : null;
}

function houseCard(v, occ) {
    let html = `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:8px;">`;
    html += `<div><div style="font-weight:bold; color:var(--gold);">${v.icon} ${esc(v.name)}${v.owner === 'player' ? ' <span style="font-size:10px; color:#9fd89f;">YOURS</span>' : ''}</div>`;
    html += `<div style="font-size:11px; color:#aaa;">${esc(v.kindName)} · ${stars(v.stars)} · ${esc(v.keeperTitle)}: ${esc(v.keeper)} · ${v.rooms} rooms${occ != null ? ` · ${occ} guests tonight` : ''}</div></div>`;
    html += `<div style="flex-shrink:0;">${act(v.owner === 'player' ? 'Go in' : 'Look in', ['open', v.id], BTN_GOLD)}</div></div></div>`;
    return html;
}

Object.assign(ActionMenu, {
    /**
     * The houses of hospitality where you stand, or one house (`id`; on the
     * inner map, the one you are inside).
     */
    showLodgings(game, tile = null, id = null, message = null) {
        const { player, world } = game;
        const here = _here(game);
        id = id || _insideId();
        if (!id) {
            const list = Hospitality.listAt(world, player, here.q, here.r);
            if (list.length === 1) id = list[0].id;
            else {
                let html = '<div style="font-size:12px;">';
                if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
                if (!list.length) html += '<div style="color:#aaa;">No one here lets rooms. A town or a roadhouse on the road will have a bed.</div>';
                else {
                    const occ = Hospitality.occupancy(world, player, here.q, here.r);
                    html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Where to lay your head in ${esc((here.tile && here.tile.settlement && here.tile.settlement.name) || 'these parts')}:</p>`;
                    for (const v of list) html += houseCard(v, occ[v.id]);
                }
                html += '</div>';
                game.ui.showCustomPanel('🛏️ Lodgings', html);
                return;
            }
        }
        const v = Hospitality.get(world, player, id);
        if (!v) {
            game.ui.showNotification('🛏️ Lodgings', 'That house is gone.', 'info');
            return;
        }
        if (v.owner === 'npc' && ActionMenu.refuseIfOutlawed(game, here.tile)) return;
        const own = v.owner === 'player';
        if (!own) _tab = 'stay';
        let html = '<div style="font-size:12px;">';
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
        html += `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold); font-size:14px;">${v.icon} ${esc(v.name)}</div>`;
        html += `<div style="font-size:11px; color:#aaa;">${esc(v.kindName)} · ${stars(v.stars)} · reputation ${v.rep} · ${esc(v.keeperTitle)}: ${esc(v.keeper)} · ${v.rooms} rooms</div>`;
        html += `<div style="font-size:11px; color:#bbb; margin-top:4px; font-style:italic;">${esc(v.blurb)}</div></div>`;
        if (own) {
            html += panelTabs(game, {
                id: 'lodging', title: `${v.icon} ${v.name}`, tabs: [['stay', '🛏️ Stay'], ['run', '📒 Run the house']], active: _tab,
                go: (k) => { _tab = k; ActionMenu.showLodgings(game, null, id); },
                attrsFor: (k) => `data-am-act="lodgingAct" data-am-args='${esc(JSON.stringify(['tab', id, k]))}'`,
            });
        }
        html += own && _tab === 'run' ? ActionMenu._lodgingRunHtml(game, v) : ActionMenu._lodgingStayHtml(game, v);
        html += '</div>';
        game.ui.showCustomPanel(`${v.icon} ${v.name}`, html);
    },

    _lodgingStayHtml(game, v) {
        const { player, world } = game;
        const q = Hospitality.quote(world, player, v.id);
        let html = '';
        if (v.underConstruction) return `${html}<div style="color:#d8c89f;">The builders are still at work. No guests yet.</div>`;
        if (q.full) html += '<div style="color:#e0a080; margin:4px 0;">"Full up tonight, I\'m afraid — unless you\'ll pay for the best we have."</div>';
        if (q.bookedHere) html += `<div style="color:#9fd89f; margin:4px 0;">You have ${esc((Hospitality.tier(player.lodging.tier) || {}).name || 'a room').toLowerCase()} here tonight.</div>`;
        else if (q.booked) html += `<div style="color:#d8c89f; margin:4px 0;">You already have a bed for tonight at ${esc(player.lodging.name)}.</div>`;
        html += '<div style="font-weight:bold; margin-top:8px;">Rooms for the night</div>';
        for (const t of q.tiers) {
            const T = Hospitality.tier(t.id) || {};
            const fx = [T.comfort ? `comfort ${T.comfort > 0 ? '+' : ''}${T.comfort}` : '', T.hygiene ? `hygiene ${T.hygiene > 0 ? '+' : ''}${T.hygiene}` : '', T.health ? `health +${T.health}` : '', T.theft >= 0.05 && v.owner !== 'player' ? 'keep a hand on your purse' : ''].filter(Boolean).join(' · ');
            html += `<div style="${CARD} display:flex; justify-content:space-between; align-items:center; gap:8px;"><div><b>${t.icon} ${esc(t.short)}</b> — ${t.free ? '<span style="color:#9fd89f;">free</span>' : `${t.price} gold`}`;
            html += `<div style="font-size:10px; color:#999;">An inn's night's rest${v.breakfastIncluded ? ', breakfast included' : ''}${fx ? ` · ${esc(fx)}` : ''}</div></div><div style="flex-shrink:0;">`;
            html += t.ok ? act('Book', ['book', v.id, t.id]) + act('💤 Book & sleep', ['sleep', v.id, t.id], BTN_GOLD) : off('Book', t.reason);
            html += '</div></div>';
        }
        if (q.services.length) {
            html += '<div style="font-weight:bold; margin-top:10px;">Services</div>';
            for (const s of q.services) {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);"><span>${s.icon} ${esc(s.name)} — ${s.free ? '<span style="color:#9fd89f;">free</span>' : `${s.price}g`}${s.morning ? ' <span style="font-size:10px; color:#999;">(in the morning)</span>' : ''}</span>`;
                html += s.ok ? act('Order', ['service', v.id, s.id]) : off('Order', s.reason);
                html += '</div>';
            }
        }
        if (q.bookedHere) html += `<div style="margin-top:10px;">${act('💤 Retire for the night', ['retire'], BTN_GOLD)}</div>`;
        return html;
    },

    _lodgingRunHtml(game, v) {
        const { player, world } = game;
        const prop = v._prop;
        const rep = Hospitality.report(world, player, world.getTile(v.q, v.r), prop);
        const C = Hospitality.config().player;
        let html = `<div style="${CARD}">`;
        html += `<div>🛏️ Tonight: <b>${rep.forecast}</b> of ${v.rooms} rooms taken (the ${v.kind === 'roadhouse' ? 'road' : 'town'} sends about ${rep.demand} travellers a night)</div>`;
        html += `<div>📒 Yesterday: ${rep.today.guests || 0} guests · takings ${rep.today.takings || 0}g · staff & supplies ${rep.today.costs || 0}g</div>`;
        if (rep.lastWeek) html += `<div>📅 Last week: ${rep.lastWeek.guests} guest-nights · takings ${rep.lastWeek.takings}g · costs ${rep.lastWeek.costs}g · <b>${rep.lastWeek.takings - rep.lastWeek.costs >= 0 ? '+' : ''}${rep.lastWeek.takings - rep.lastWeek.costs}g</b></div>`;
        if (v.history.length) html += `<div style="font-size:11px; color:#aaa;">Weekly occupancy: ${v.history.map(h => `${h}%`).join(' · ')}</div>`;
        html += `<div>🧽 Cleanliness ${rep.clean}% ${rep.clean < 50 ? '<span style="color:#e08080;">(guests notice — hire a chambermaid)</span>' : ''} · ⭐ reputation ${v.rep}</div>`;
        html += `<div style="margin-top:4px;">${act('🧽 Scrub it yourself', ['scrub', v.id])}</div></div>`;

        html += '<div style="font-weight:bold; margin-top:8px;">Room prices</div><div>';
        for (const m of C.priceSteps || []) {
            const label = `${Math.round(m * 100)}%`;
            html += m === rep.priceMult ? `<button disabled style="${BTN_GOLD}">${label}</button>` : act(label, ['price', v.id, m]);
        }
        html += `<div style="font-size:10px; color:#999;">Of the going rate for ${/^[aeiou]/i.test((Hospitality.kind(v.kind) || {}).noun || '') ? 'an' : 'a'} ${esc((Hospitality.kind(v.kind) || {}).noun || 'house')} of ${v.stars} stars. Dearer rooms draw fewer guests.</div></div>`;

        html += '<div style="font-weight:bold; margin-top:8px;">Staff</div>';
        for (const [role, def] of Object.entries(C.staff || {})) {
            const n = rep.staff[role] || 0;
            const what = [def.stars ? `+${def.stars}★ each` : '', def.clean ? `+${def.clean}% clean a day` : '', def.spend ? `guests spend +${Math.round(def.spend * 100)}%` : '', def.theftCut ? 'fewer thefts' : ''].filter(Boolean).join(', ');
            html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);"><span>${def.icon} ${esc(def.name)} × <b>${n}</b> <span style="font-size:10px; color:#999;">(${def.wage}g/day; ${esc(what)})</span></span><span>`;
            html += n < (def.max || 9) ? act('Hire', ['staff', v.id, role, 1]) : off('Hire', 'No work for more');
            html += n > 0 ? act('Let go', ['staff', v.id, role, -1], BTN_RED) : off('Let go', 'None to let go');
            html += '</span></div>';
        }
        if (rep.rivals.length) {
            html += '<div style="font-weight:bold; margin-top:8px;">The competition</div>';
            for (const r of rep.rivals) html += `<div style="font-size:11px; color:#bbb;">${esc(r.name)} (${esc(r.kind)}) · ${stars(r.stars)} · price ${Math.round(r.priceMult * 100)}% · ${r.guests}/${r.rooms} rooms tonight</div>`;
        }
        return html;
    },

    /** Every button on the lodging panel: op + its arguments. */
    lodgingAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        const show = (id, msg) => ActionMenu.showLodgings(game, null, id, msg);
        if (op === 'open') { _tab = 'stay'; show(a); return; }
        if (op === 'tab') { _tab = b; show(a); return; }
        if (op === 'retire') {
            if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
            if (typeof game.endDay === 'function') game.endDay();
            return;
        }
        if (op === 'book' || op === 'sleep') {
            const res = Hospitality.book(world, player, a, b);
            game.ui.updateStats(player, world);
            if (res.ok && op === 'sleep') {
                game.ui.showNotification('🛏️ Lodgings', res.text, 'success');
                if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
                if (typeof game.endDay === 'function') game.endDay();
                return;
            }
            show(a, res);
            return;
        }
        if (op === 'service') {
            const res = Hospitality.buyService(world, player, a, b);
            if (res.ok && res.item) {
                const got = PlayerInventory.addItem(player, res.item.id, res.item.qty);
                if (!got || !got.success) res.text += ' (Your pack is full — you eat it on the spot.)';
            }
            game.ui.updateStats(player, world);
            show(a, res);
            return;
        }
        const v = Hospitality.get(world, player, a);
        if (!v || v.owner !== 'player') { show(null, { ok: false, text: 'That is not your house.' }); return; }
        let res = { ok: false, text: '' };
        if (op === 'price') res = Hospitality.setPrice(v._prop, b);
        else if (op === 'staff') res = Hospitality.setStaff(v._prop, b, c);
        else if (op === 'scrub') res = Hospitality.scrub(player, v._prop);
        _tab = 'run';
        game.ui.updateStats(player, world);
        show(a, res);
    },
});
