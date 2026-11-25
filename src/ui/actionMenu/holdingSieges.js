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
import { lede, card, rowList, price, more } from './uiKit.js';
import { InnerMapBattle } from '../innerMapBattle.js';
import { Utils } from '../../core/utils.js';
import { Names } from '../../core/names.js';

const MUTED = 'color:var(--text-secondary);font-size:11px;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const _days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const _cap = (t) => { const x = String(t == null ? '' : t); return x.charAt(0).toUpperCase() + x.slice(1); };

/**
 * The besieged town's stores in words: how long they last at the pace they are eaten
 * (stores are counted in days of full rations; a port the sea still feeds eats them slower).
 */
function _storesText(stores, left, eat) {
    const full = Math.round(stores);
    if (left == null) return `Stores: ${full} days of food, none eaten`;
    const rate = Math.round(eat * 100) / 100;
    const pace = rate < 1 ? ` (${full} days at full rations, eaten at ${rate === 0.5 ? 'half' : `${Math.round(rate * 100)}%`} pace)` : rate > 1 ? ` (${full} days at full rations, eaten ${rate}× as fast)` : '';
    return `Stores last ${left} more day${left === 1 ? '' : 's'}${pace}`;
}

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0));
    return `<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin:2px 0 6px;"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div></div>`;
}

/** One besieged holding's card. */
function siegeCardHtml(player, d) {
    const s = d.siege;
    const k = s.key;
    let html = '';
    html += `<div style="${MUTED}margin-bottom:6px;">Besieged by ${_esc(s.hostName)} of ${_esc(Names.realm(s.kingdomName))}${s.port ? (d.enemyFleet ? ' · ⛵ their fleet closes the harbour' : ' · ⛵ ships still bring food (stores fall at half pace)') : ''}</div>`;

    html += '<div style="display:flex;gap:8px;">';
    // The defenders
    html += '<div style="flex:1;">';
    html += `<div style="color:#4fc3f7;font-weight:bold;">🛡️ Defenders</div>`;
    html += `<div>Garrison <strong>${Math.round(s.garrison)}</strong> · storm defence <strong>${d.defense}</strong></div>`;
    html += `<div>Morale ${Math.round(s.morale)}</div>${_bar(s.morale, 100, '#4fc3f7')}`;
    html += `<div>${_storesText(s.stores, d.storesDaysLeft, d.eatsPerDay)}</div>${_bar(s.stores, s.storesStart, '#f1c40f')}`;
    html += `<div>Walls ${s.walls > 0 ? `+${Math.round(s.walls * 100)}% at ${Math.round(s.wallHp)}%` : 'none'}</div>`;
    html += `<div style="${MUTED}">Commanded by ${_esc(d.commander.name)}${d.commander.governor ? ` (martial ${d.commander.martial})` : ''}</div>`;
    if (s.townSick) html += '<div style="color:#e57373;">🤒 Disease inside the walls</div>';
    if (s.stores <= 0) html += '<div style="color:#e57373;">The town is starving.</div>';
    if (d.ateDead) html += '<div style="color:#e57373;">🦴 The garrison has eaten its dead.</div>';
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
            html += `<div style="${MUTED}">📦 ${c.via === 'ship' ? 'Ship' : 'Caravan'} with ${[c.food ? `${c.food} food` : '', c.gold ? `${Utils.formatGold(c.gold)} gold` : ''].filter(Boolean).join(' and ')} — arrives day ${c.arriveDay} (${Math.round(c.catch * 100)}% risk of capture)</div>`;
        }
    }

    // Options: one row each, greyed with the reason when it can't be done
    const army = d.army;
    const gold = player.gold || 0;
    const go = (act, arg = null) => ({ act: 'holdingSiegeAct', args: arg == null ? [act, k] : [act, k, arg] });
    const packs = Sieges._foodInPacks(player);
    const food = Math.min(50, packs);
    const routes = d.supply;
    const rows = [
        { icon: '⚔️', name: 'Relieve it', desc: `Your army ${army} against ${Math.round(s.besiegers)}; the garrison sallies to help if its heart is in it`,
            off: !d.canRelieve, why: army <= 0 ? 'You have no army to relieve it with' : player.boardedShip ? 'Come ashore first'
                : `March your army to ${_esc(s.name)} (${d.distance === Infinity ? '?' : d.distance} hexes away) to fight the host there`, tone: 'bad', ...go('relieve') },
        { icon: '🐫', name: `Caravan: ${food} food`, desc: `${_days(routes.caravan.days)} · ${Math.round(routes.caravan.catch * 100)}% risk of capture · ${d.foodPerDay} food feeds the town a day`,
            off: food <= 0, why: 'You carry no food to send', ...go('supply', `caravan:${food}:0`) },
        { icon: '🐫', name: 'Caravan: 300 gold', desc: `${_days(routes.caravan.days)} · hires men inside the walls and lifts their spirits`, side: price(300, gold >= 300),
            off: gold < 300, why: 'Needs 300g', ...go('supply', 'caravan:0:300') },
        s.port ? { icon: '⛵', name: `Ship: ${food} food + 200 gold`, desc: `${_days(routes.ship.days)} · ${Math.round(routes.ship.catch * 100)}% risk · runs the blockade by sea`, side: price(200, gold >= 200),
            off: !(routes.ship.can && gold >= 200), why: _esc(routes.ship.reason || 'Needs 200g'), ...go('supply', `ship:${food}:200`) } : null,
        { icon: '🗡️', name: 'Order a sally', desc: `${_esc(_cap(d.commander.name))} leads part of the garrison against the lines`,
            off: !d.canSally, why: `Not again until day ${s.nextSallyDay}`, ...go('sally') },
        { icon: '🤝', name: 'Governor\'s terms', desc: `${Math.round(d.termsChance * 100)}% they take your gold and march away; a refusal disheartens the town`, side: price(d.termsPrice, gold >= d.termsPrice),
            off: !(d.canParley && gold >= d.termsPrice), why: d.canParley ? `Needs ${Utils.formatGold(d.termsPrice)}g` : `They won't parley again until day ${s.nextParleyDay}`, ...go('terms') },
        { icon: '💰', name: `Pay ${_esc(Names.realm(s.kingdomName))} to lift it`, desc: 'The host marches home; the war goes on', side: price(d.buyOffPrice, gold >= d.buyOffPrice),
            off: gold < d.buyOffPrice, why: `Needs ${Utils.formatGold(d.buyOffPrice)}g`, ...go('buyoff') },
        d.peacePrice != null ? { icon: '🕊️', name: 'Buy peace', desc: 'End the whole war; every siege it brought is lifted', side: price(d.peacePrice, gold >= d.peacePrice),
            off: gold < d.peacePrice, why: `Needs ${Utils.formatGold(d.peacePrice)}g`, ...go('peace') } : null,
        { icon: '🏳️', name: 'Let it fall', desc: 'Order the gates opened. The town goes to the enemy', tone: 'bad', ...go('yield') },
        // Starving: the dead to the kitchens, or clean hands (systems/eatingTheDead.js)
        s.stores <= 0 ? { icon: '🦴', name: 'Order them to eat their dead', desc: `About ${d.eatDeadDays} days more. The town will never be the same, nor its name; the faith will not forgive it`,
            off: !d.eatDead.ok, why: _esc(d.eatDead.why), tone: 'bad', ...go('eatDead') } : null,
        s.stores <= 0 ? { icon: d.eatDeadForbid ? '🕊️' : '✋', name: d.eatDeadForbid ? 'Leave it to the governor' : 'Forbid them to touch the dead', desc: d.eatDeadForbid ? 'You have forbidden it: they starve with clean hands' : `Left alone, a starving ${d.commander.governor ? 'governor' : 'captain'} may do it on his own`, ...go('forbidEat') } : null,
    ];
    html += rowList(rows, 'What you can do');

    if (s.log && s.log.length) {
        html += more('The siege so far', s.log.slice(-3).reverse().map(e => `<div style="${MUTED}">Day ${e.day}: ${_esc(e.text)}</div>`).join(''));
    }
    return card(html, { icon: '🏰', title: _esc(s.name), side: `day ${d.day} of the siege`, tone: 'bad' });
}

Object.assign(ActionMenu, {
    /** Holdings Under Siege: one card per besieged holding, and the recent outcomes. */
    showHoldingSiegesPanel(game) {
        const player = game.player;
        const world = game.world;
        const sieges = HoldingSieges.list(player);
        let html = '<div style="max-height:560px;overflow-y:auto;font-size:12px;">';
        html += lede(sieges.length
            ? 'An enemy host sits before your walls. Stores run down each day; when they are gone the town starves, and a ram brings the storm.'
            : 'None of your holdings is under siege.');
        for (const s of sieges) {
            const d = HoldingSieges.describe(player, world, s.key);
            if (d) html += siegeCardHtml(player, d);
        }
        const hist = (player.realmWars && player.realmWars.siegeHistory) || [];
        if (hist.length) {
            const label = { relieved: 'relieved', held: 'held', terms: 'bought off by the governor', bought: 'bought off', fallen: 'fell', lifted: 'lifted by peace' };
            html += rowList(hist.slice().reverse().map(h => ({ icon: h.outcome === 'fallen' ? '🏴' : '🏰', name: _esc(h.name), desc: `${label[h.outcome] || h.outcome} after ${h.days} day${h.days === 1 ? '' : 's'}${h.kingdomName ? ` · ${_esc(h.kingdomName)}` : ''}`, tone: h.outcome === 'fallen' ? 'bad' : 'good' })), 'Past sieges');
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
        // The relief: on the holding's own ground yourself, or the captains' roll
        if (act === 'relieve' && arg !== 'captains') {
            const why = HoldingSieges._relieveBlock(player, world, HoldingSieges._get(player, key));
            if (why) { game.ui.showNotification('🏰 Siege', why, 'error'); return; }
            game.ui.showCustomPanel(`⚔️ Relieve ${siege.name}`, `<div style="font-size:12px;">${rowList([
                { icon: '⚔️', name: 'Take the field — command the relief yourself', desc: `Fought on ${_esc(siege.name)}'s own ground against the besiegers; the garrison's sally keeps some of them busy`, side: 'on the ground', tone: 'gold', act: 'holdingSiegeAct', args: ['relieveField', key] },
                { icon: '🎲', name: 'Let the captains fight it', desc: 'Settled at once on the odds', side: 'at once', act: 'holdingSiegeAct', args: ['relieve', key, 'captains'] },
            ])}</div>`);
            return;
        }
        if (act === 'relieveField') {
            const fight = HoldingSieges.relieveBattle(player, world, key);
            if (!fight) { ActionMenu.holdingSiegeAct(game, 'relieve', key, 'captains'); return; }
            const done = (fought) => {
                const r = HoldingSieges.relieve(player, world, key, fought ? { combatResult: fought } : {});
                if (r.success) game.ui.showNotification(r.victory ? '🎺 Siege Relieved' : '⚔️ Relief Beaten Back', r.message, r.victory ? 'success' : 'error');
                else game.ui.showNotification('🏰 Siege', r.reason || 'Not possible right now.', 'error');
                game.ui.updateStats(player, world);
                ActionMenu.showHoldingSiegesPanel(game);
            };
            InnerMapBattle.start(game, { ...fight, title: `The relief of ${siege.name}`, onDone: (fought) => { if (fought) done(fought); } })
                .then((ok) => { if (!ok) done(null); });
            return;
        }
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
            if (res.success) game.ui.showNotification('🕊️ Peace Bought', `The war with ${siege.kingdomName} is over. −${Utils.formatGold(res.cost)} gold.`, 'success');
        } else if (act === 'eatDead') {
            res = HoldingSieges.eatDead(player, world, key);
            if (res.success) game.ui.showNotification('🦴 They Eat Their Dead', res.text, 'warning');
        } else if (act === 'forbidEat') {
            res = HoldingSieges.forbidEatDead(player, world, key);
            if (res.success) game.ui.showNotification('🦴 The Dead', res.text, 'info');
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
