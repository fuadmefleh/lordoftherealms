// ActionMenu — Holdings Under Siege: every holding an enemy realm besieges
// (systems/holdingSieges.js), with the day count, stores, garrison and
// besiegers, and the player's options: relieve, supply, the governor's
// sally or terms, paying the enemy off, peace, or letting it fall. Opened
// from the top-bar banner (ui/ui/hud.js) or the Manage Holding panel.
// Buttons route through data-am-act="holdingSiegeAct" data-am-args='["act", "key", "arg"]'.
import { ActionMenu } from './_ref.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { RealmWars } from '../../systems/realmWars.js';
import { Sieges } from '../../systems/sieges.js';

const CARD = 'background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;margin-bottom:10px;';
const MUTED = 'color:var(--text-secondary);font-size:11px;';
const BTN = 'padding:6px 9px;margin:3px 3px 0 0;border-radius:6px;cursor:pointer;font-family:var(--font-body);font-size:12px;color:#eee;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _btn(label, act, key, arg = null, enabled = true, title = '', extra = '') {
    const args = JSON.stringify(arg == null ? [act, key] : [act, key, arg]);
    return `<button data-am-act="holdingSiegeAct" data-am-args='${_esc(args)}' ${enabled ? '' : 'disabled'} title="${_esc(title)}" style="${BTN}${extra}${enabled ? '' : 'opacity:0.45;cursor:not-allowed;'}">${label}</button>`;
}

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0));
    return `<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin:2px 0 6px;"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div></div>`;
}

/** One besieged holding's card. */
function siegeCardHtml(player, d) {
    const s = d.siege;
    const k = s.key;
    let html = `<div style="${CARD}border:1px solid rgba(231,76,60,0.55);">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:baseline;"><strong style="color:#ff8a70;font-size:13px;">🏰 ${_esc(s.name)}</strong><span style="${MUTED}">day ${d.day} of the siege · (${s.q}, ${s.r})</span></div>`;
    html += `<div style="${MUTED}margin-bottom:6px;">Besieged by ${_esc(s.hostName)} of ${_esc(s.kingdomName)}${s.port ? (d.enemyFleet ? ' · ⛵ their fleet closes the harbour' : ' · ⛵ ships still bring food (stores fall at half pace)') : ''}</div>`;

    html += '<div style="display:flex;gap:8px;">';
    // The defenders
    html += '<div style="flex:1;">';
    html += `<div style="color:#4fc3f7;font-weight:bold;">🛡️ Defenders</div>`;
    html += `<div>Garrison <strong>${Math.round(s.garrison)}</strong> · storm defence <strong>${d.defense}</strong></div>`;
    html += `<div>Morale ${Math.round(s.morale)}</div>${_bar(s.morale, 100, '#4fc3f7')}`;
    html += `<div>Stores ${Math.round(s.stores)} day(s)${d.storesDaysLeft != null ? ` · −${d.eatsPerDay}/day` : ''}</div>${_bar(s.stores, s.storesStart, '#f1c40f')}`;
    html += `<div>Walls ${s.walls > 0 ? `+${Math.round(s.walls * 100)}% at ${Math.round(s.wallHp)}%` : 'none'}</div>`;
    html += `<div style="${MUTED}">Commanded by ${_esc(d.commander.name)}${d.commander.governor ? ` (martial ${d.commander.martial})` : ''}</div>`;
    if (s.townSick) html += '<div style="color:#e57373;">🤒 Disease inside the walls</div>';
    if (s.stores <= 0) html += '<div style="color:#e57373;">The town is starving.</div>';
    html += '</div>';
    // The besiegers
    html += '<div style="flex:1;">';
    html += `<div style="color:#e74c3c;font-weight:bold;">🚩 Besiegers</div>`;
    html += `<div>Strength <strong>${Math.round(s.besiegers)}</strong> (of ${Math.round(s.besiegersStart)})</div>`;
    html += `<div>Morale ${Math.round(s.besiegerMorale)}</div>${_bar(s.besiegerMorale, 100, '#e74c3c')}`;
    html += `<div>Their stores ${Math.round(s.besiegerStores)} day(s)</div>`;
    html += `<div>${s.ramBuilt ? '🐏 A ram stands at the gate' : `🐏 Building a ram (${Math.round(s.ram)}/${HoldingSieges.config().ramDays})`}</div>`;
    if (s.besiegerSick > 0) html += '<div style="color:#7fd07f;">🤒 Fever in their camp</div>';
    html += '</div></div>';

    if (s.convoys.length) {
        for (const c of s.convoys) {
            html += `<div style="${MUTED}">📦 ${c.via === 'ship' ? 'Ship' : 'Caravan'} with ${[c.food ? `${c.food} food` : '', c.gold ? `${c.gold} gold` : ''].filter(Boolean).join(' and ')} — arrives day ${c.arriveDay} (${Math.round(c.catch * 100)}% risk of capture)</div>`;
        }
    }

    // Options
    html += '<div style="margin-top:6px;">';
    const army = d.army;
    html += d.canRelieve
        ? _btn(`⚔️ Relieve it (your army ${army} vs ${Math.round(s.besiegers)})`, 'relieve', k, null, true, 'Attack the besiegers; the garrison sallies to help if its heart is in it.', 'border-color:rgba(231,76,60,0.7);')
        : `<div style="${MUTED}">⚔️ To relieve it, march your army to ${_esc(s.name)} (${d.distance === Infinity ? '?' : d.distance} hexes away) and fight the war host there.</div>`;
    html += '</div><div style="margin-top:4px;">';
    const packs = Sieges._foodInPacks(player);
    const food = Math.min(50, packs);
    const routes = d.supply;
    html += _btn(`🐫 Caravan: ${food} food (${routes.caravan.days}d, ${Math.round(routes.caravan.catch * 100)}% risk)`, 'supply', k, `caravan:${food}:0`, food > 0, `${d.foodPerDay} food is one day of stores here.`);
    html += _btn(`🐫 Caravan: 300 gold (${routes.caravan.days}d)`, 'supply', k, 'caravan:0:300', player.gold >= 300, 'Hires men inside the walls and lifts their spirits.');
    if (s.port) {
        html += _btn(`⛵ Ship: ${food} food + 200 gold (${routes.ship.days}d, ${Math.round(routes.ship.catch * 100)}% risk)`, 'supply', k, `ship:${food}:200`,
            routes.ship.can && player.gold >= 200, routes.ship.reason || 'Runs the blockade by sea.');
    }
    html += '</div><div style="margin-top:4px;">';
    html += _btn(`🗡️ Order a sally`, 'sally', k, null, d.canSally, d.canSally ? `${d.commander.name} leads part of the garrison against the lines.` : `Not again until day ${s.nextSallyDay}.`);
    html += _btn(`🤝 Governor's terms: ${d.termsPrice}g (${Math.round(d.termsChance * 100)}%)`, 'terms', k, null, d.canParley && player.gold >= d.termsPrice,
        d.canParley ? 'Your gold, if they agree to march away. A refusal disheartens the town.' : `They won't parley again until day ${s.nextParleyDay}.`);
    html += _btn(`💰 Pay ${_esc(s.kingdomName)} to lift it: ${d.buyOffPrice}g`, 'buyoff', k, null, player.gold >= d.buyOffPrice, 'The host marches home; the war goes on.');
    if (d.peacePrice != null) html += _btn(`🕊️ Buy peace: ${d.peacePrice}g`, 'peace', k, null, player.gold >= d.peacePrice, 'End the whole war; every siege it brought is lifted.');
    html += _btn('🏳️ Let it fall', 'yield', k, null, true, 'Order the gates opened. The town goes to the enemy.', 'border-color:rgba(150,150,150,0.5);');
    html += '</div>';

    if (s.log && s.log.length) {
        html += `<div style="margin-top:6px;">`;
        for (const e of s.log.slice(-3).reverse()) html += `<div style="${MUTED}">Day ${e.day}: ${_esc(e.text)}</div>`;
        html += '</div>';
    }
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** Holdings Under Siege: one card per besieged holding, and the recent outcomes. */
    showHoldingSiegesPanel(game) {
        const player = game.player;
        const world = game.world;
        const sieges = HoldingSieges.list(player);
        let html = '<div style="max-height:560px;overflow-y:auto;font-size:12px;">';
        if (!sieges.length) html += `<div style="${MUTED}">None of your holdings is under siege.</div>`;
        for (const s of sieges) {
            const d = HoldingSieges.describe(player, world, s.key);
            if (d) html += siegeCardHtml(player, d);
        }
        const hist = (player.realmWars && player.realmWars.siegeHistory) || [];
        if (hist.length) {
            const label = { relieved: 'relieved', held: 'held', terms: 'bought off by the governor', bought: 'bought off', fallen: 'fell', lifted: 'lifted by peace' };
            html += `<div style="${CARD}"><div style="font-weight:bold;margin-bottom:4px;">Past sieges</div>`;
            for (const h of hist.slice().reverse()) html += `<div style="${MUTED}">${_esc(h.name)} — ${label[h.outcome] || h.outcome} after ${h.days} day(s) (${_esc(h.kingdomName || '')})</div>`;
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel(`🏰 Holdings Under Siege${sieges.length ? ` (${sieges.length})` : ''}`, html);
    },

    /** Buttons of the Holdings Under Siege panel. */
    holdingSiegeAct(game, act, key, arg = null) {
        const player = game.player;
        const world = game.world;
        const siege = HoldingSieges.list(player).find(s => s.key === key);
        if (!siege) { ActionMenu.showHoldingSiegesPanel(game); return; }
        let res;
        if (act === 'relieve') {
            res = HoldingSieges.relieve(player, world, key);
            if (res.success) {
                game.ui.showNotification(res.victory ? '🎺 Siege Relieved' : '⚔️ Relief Beaten Back', res.message, res.victory ? 'success' : 'error');
            }
        } else if (act === 'supply') {
            const [via, food, gold] = String(arg).split(':');
            res = HoldingSieges.sendSupplies(player, world, key, { via, food: Number(food), gold: Number(gold) });
            if (res.success) game.ui.showNotification('📦 Supplies Sent', `They should reach ${siege.name} in ${res.days} day(s), if the besiegers don't catch them.`, 'info');
        } else if (act === 'sally') {
            res = HoldingSieges.sally(player, world, key);
            if (res.success) game.ui.showNotification(res.won ? '🗡️ Sally!' : '🗡️ Sally Fails', res.text, res.won ? 'success' : 'warning');
        } else if (act === 'terms') {
            res = HoldingSieges.negotiate(player, world, key);
            if (res.success) game.ui.showNotification(res.accepted ? '🤝 Terms Accepted' : '🤝 Terms Refused', res.text, res.accepted ? 'success' : 'warning');
        } else if (act === 'buyoff') {
            res = HoldingSieges.buyOff(player, world, key);
            if (res.success) game.ui.showNotification('💰 Siege Bought Off', res.text, 'success');
        } else if (act === 'peace') {
            res = RealmWars.sueForPeace(player, world, siege.kingdomId);
            if (res.success) game.ui.showNotification('🕊️ Peace Bought', `The war with ${siege.kingdomName} is over. −${res.cost} gold.`, 'success');
        } else if (act === 'yield') {
            res = HoldingSieges.yieldHolding(player, world, key);
            if (res.success) game.ui.showNotification('🏴 Holding Yielded', res.text || `${siege.name} is lost.`, 'error');
        } else {
            return;
        }
        if (res && res.success === false) game.ui.showNotification('🏰 Siege', res.reason || 'Not possible right now.', 'error');
        game.ui.updateStats(player, world);
        ActionMenu.showHoldingSiegesPanel(game);
    },
});
