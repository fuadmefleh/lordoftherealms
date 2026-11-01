// ActionMenu — Landing Party (the action menu beside the coast, aboard or
// ashore beside an anchored ship): raids on coastal towns from the sea, beach
// runs past the customs house, a colony founded from the landing, and stores
// landed for a colony. Logic lives in systems/landings.js and
// player/coastalRaids.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Ships } from '../../systems/ships.js';
import { Landings } from '../../systems/landings.js';
import { CoastalRaids } from '../../player/coastalRaids.js';
import { BTN_GOLD, BTN_OFF, BTN_RED, BTN_PLAIN, CARD, esc } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 4px; color: var(--gold);';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function _pct(p) {
    return `${Math.round(p * 100)}%`;
}

function _label(id) {
    return String(id).replace(/_/g, ' ');
}

function _btn(ok, label, call, style = BTN_GOLD, reason = '') {
    if (ok) return `<button onclick="${call}" style="${style}">${label}</button>`;
    return `<button disabled title="${esc(reason)}" style="${BTN_OFF}">${label}</button>`;
}

function _raidSection(game) {
    const { player, world } = game;
    const targets = CoastalRaids.targets(player, world);
    if (!targets.length) return '';
    const C = CoastalRaids.cfg();
    const ap = player.actionPoints || 0;
    let html = `<div style="${HEAD}">⚔️ Raid from the Sea</div>`;
    html += `<div style="${NOTE}">Each ship's boats put ${C.troopsPerShip} soldiers ashore a day (your strongest go first); war galleys bombard. A town caught unready turns out only part of its garrison.</div>`;
    for (const t of targets) {
        const q = CoastalRaids.quote(player, world, t.q, t.r);
        const s = t.settlement;
        html += `<div style="${CARD}">`;
        html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="font-size:13px;">${esc(s.name)}</strong>`;
        html += `<span style="${NOTE}">${esc(s.type || 'town')}${t.kingdom ? ` · ${esc(t.kingdom.name)}` : ' · free town'}</span></div>`;
        html += `<div style="font-size:11px; color:#ccc;">Landing party: ${q.troops || 0} of ${q.landed || 0} soldiers · strength ${q.strength || 0} vs about ${q.defense || '?'}${q.alarmed ? ' <span style="color:#e08080;">(the coast is on alarm)</span>' : ''}</div>`;
        const why = q.ok ? (ap < C.ap ? `Needs ${C.ap} AP` : '') : q.reason;
        const ok = q.ok && ap >= C.ap;
        html += _btn(ok, `💰 Plunder (${C.ap} AP)`, `window._landing.raid(${t.q}, ${t.r}, 'plunder')`, BTN_RED, why);
        html += _btn(ok, '🔥 Burn the stores', `window._landing.raid(${t.q}, ${t.r}, 'burn')`, BTN_RED, why);
        if (!q.ok) html += `<div style="font-size:10px; color:#888;">${esc(q.reason)}</div>`;
        html += '</div>';
    }
    html += `<div style="${NOTE}">Plunder carries gold and the best of the market to your hold (a boat-load per ship). Burning leaves little gold but starves the town. Either way: karma, reputation, the lord remembers, and the realm's coast stays on alarm for ${C.alarmDays} days.</div>`;
    return html;
}

function _runSection(game) {
    const { player, world } = game;
    if (player.boardedShip || !Landings._anchored(player).length) return '';
    let html = `<div style="${HEAD}">🌙 Run Goods Ashore</div>`;
    if (!Landings.onOpenCoast(player, world)) {
        return html + `<div style="${NOTE}">A port or jetty has a customs house. Run goods ashore on open coast.</div>`;
    }
    const watch = Landings.coastWatch(world, player.q, player.r);
    html += `<div style="${NOTE}">Goods landed here skip the customs house: no import duty and no embargo when sold. Contraband stays contraband (the black market or a fence will take it). ` +
        `${watch ? `The coast watch of ${esc(watch.kingdom.name)}${watch.settlement ? ` (from ${esc(watch.settlement.name)})` : ''} patrols these shores.` : 'No realm watches this shore.'}</div>`;
    const opts = Landings.runOptions(player, world);
    const ap = player.actionPoints || 0;
    const R = Landings.config().run;
    let any = false;
    for (const o of opts) {
        if (!o.ok && /no duty/.test(o.reason || '')) continue;
        any = true;
        html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.06);">';
        html += `<div style="font-size:12px;">⛵ ${esc(o.shipName)}: ${esc(_label(o.goodId))}${o.ok ? ` <span style="${NOTE}">×${o.units} this trip · ${o.contraband ? 'contraband' : `${o.booked} booked`} · caught ${_pct(o.chance)}</span>` : ''}</div>`;
        html += _btn(o.ok && ap >= R.ap, `Run ashore (${R.ap} AP)`, `window._landing.run('${esc(o.shipId)}', '${esc(o.goodId)}')`, BTN_GOLD, o.ok ? `Needs ${R.ap} AP` : o.reason);
        html += '</div>';
    }
    if (!any) html += `<div style="${NOTE}">Nothing aboard owes duty or is forbidden here.</div>`;
    return html;
}

function _landfallSection(game) {
    const { player, world } = game;
    if (player.boardedShip || !Landings._anchored(player).length) return '';
    const tile = world.getTile(player.q, player.r);
    if (tile && tile.settlement) return '';
    const L = Landings.config().landfall;
    const q = Landings.landfallQuote(player, world);
    let html = `<div style="${HEAD}">🏕️ Found a Colony Here</div>`;
    html += `<div style="${NOTE}">The landing party brings its own stores: ${q.cost}g instead of the usual price, ${L.supplies} founding stores (food, timber, stone, tools) off the hold, and ${L.settlers} settlers from the ship. It has no quay: build a jetty there so ships can berth — until then supplies come ashore a boat-load a day.</div>`;
    const ok = q.ok && (player.actionPoints || 0) >= L.ap;
    html += _btn(ok, `🏕️ Found a landfall colony (${L.ap} AP, ${q.cost}g)`, 'window._landing.landfall()', BTN_GOLD, q.ok ? `Needs ${L.ap} AP` : q.reason);
    if (!q.ok) html += `<div style="font-size:10px; color:#888;">${esc(q.reason)}</div>`;
    return html;
}

function _supplySection(game) {
    const { player, world } = game;
    const q = Landings.supplyQuote(player, world);
    if (!q.ok) return '';
    let html = `<div style="${HEAD}">📦 Land Stores for ${esc(q.settlement.name)}</div>`;
    const quay = !Ships.awaitsQuay(q.tile);
    html += `<div style="${NOTE}">Food goes to the colony's granary, every good to its market; word of a well-supplied colony draws settlers. ${quay ? 'The quay takes any amount.' : 'No quay yet: a boat-load a day (build a jetty here).'}</div>`;
    let any = false;
    for (const ship of q.ships) {
        const allowance = Ships.getFerryAllowance(ship, world, player.q, player.r);
        for (const [id, n] of Object.entries(ship.cargo || {})) {
            if (!(n > 0)) continue;
            any = true;
            html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 0;">';
            html += `<div style="font-size:12px;">⛵ ${esc(ship.name)}: ${esc(_label(id))} <span style="${NOTE}">×${n}</span></div>`;
            html += _btn(allowance > 0, 'Land', `window._landing.supply('${esc(ship.id)}', '${esc(id)}')`, BTN_PLAIN, 'The boat has made all its trips today');
            html += '</div>';
        }
    }
    if (!any) html += `<div style="${NOTE}">The hold is empty.</div>`;
    return html;
}

Object.assign(ActionMenu, {
    /** The landing party: raids from the sea, beach runs, a landfall colony, stores for a colony. */
    showLandingParty(game) {
        const { player, world } = game;
        let html = '<div style="max-height:470px; overflow-y:auto;">';
        html += _raidSection(game) + _runSection(game) + _landfallSection(game) + _supplySection(game);
        const sum = Landings.summary(player, world);
        if (sum.alarms.length) {
            html += `<div style="${HEAD}">⚠️ Coasts on Alarm</div>`;
            for (const a of sum.alarms) html += `<div style="${NOTE}">${esc(a.name)} watches its shores until day ${a.until}.</div>`;
        }
        if (sum.log.length) {
            html += `<div style="${HEAD}">Lately</div>`;
            for (const e of sum.log.slice().reverse()) html += `<div style="${NOTE}">• day ${e.day}: ${esc(e.text)}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🛶 Landing Party', html);

        const after = (res, title) => {
            if (!res || res.success === false) {
                game.ui.showNotification(title, (res && (res.reason || res.message)) || 'It cannot be done.', 'error');
                return;
            }
            if (res.text) game.ui.showNotification(title, res.text, res.caught ? 'error' : 'success');
            game.ui.updateStats(player, world);
            ActionMenu.showLandingParty(game);
        };
        window._landing = {
            raid: (q, r, mode) => {
                const res = CoastalRaids.raid(player, world, q, r, mode);
                if (!res.success) return after(res, '⚔️ Raid');
                const goods = CoastalRaids.describeGoods(res.goods);
                const text = res.victory
                    ? `Your boats fell on the town${res.burned ? ' and put its stores to the torch' : ''}. ${res.plunder || 0}g taken${goods ? `, and ${goods} to the hold` : ''}. Soldiers lost: ${res.casualties || 0}.`
                    : `The garrison threw your landing back into the sea. Soldiers lost: ${res.casualties || 0}.`;
                game.ui.showNotification(res.victory ? '🔥 Raid from the Sea' : '⚔️ Landing Repelled', text, res.victory ? 'success' : 'error');
                game.ui.updateStats(player, world);
                ActionMenu.showLandingParty(game);
            },
            run: (shipId, goodId) => after(Landings.runAshore(player, world, shipId, goodId), '🌙 Beach Run'),
            landfall: () => {
                const res = Landings.foundLandfall(player, world);
                after(res, '🏕️ Landfall');
                if (res && res.success && typeof game.renderer?.markDirty === 'function') game.renderer.markDirty();
            },
            supply: (shipId, goodId) => after(Landings.supplyColony(player, world, shipId, goodId), '📦 Stores Landed'),
        };
    },
});
