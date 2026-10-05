// ActionMenu — Outlaw Lairs (Journal → Outlaw Lairs, and the action menu
// beside a lair): the lairs the player knows of, their chiefs, strength,
// raids and bargains; and at a lair, the deeds — scout, storm, strike at the
// chief, pay tribute, become partners. Logic lives in systems/outlawLairs.js;
// this panel presents it.
import { ActionMenu } from './_ref.js';
import { OutlawLairs } from './_imports.js';

const BTN = 'padding: 5px 8px; margin: 3px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_RED = BTN + 'background: #8a2c22; color: #eee;';
const BTN_OFF = BTN + 'background: #333; color: #777; cursor: not-allowed;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 4px;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _pct(p) {
    return `${Math.round(p * 100)}%`;
}

function _btn(ok, label, call, style = BTN_GOLD, reason = '') {
    if (ok) return `<button onclick="${call}" style="${style}">${label}</button>`;
    return `<button disabled title="${_esc(reason)}" style="${BTN_OFF}">${label}</button>`;
}

function _lairCard(game, lair, here) {
    const player = game.player;
    const world = game.world;
    const kind = OutlawLairs.kind(lair.kind) || {};
    const trait = OutlawLairs.leaderTrait(lair);
    const day = world.day || 0;
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold); font-size:13px;">${kind.icon || '🏕️'} ${_esc(lair.name)}</strong>`;
    const where = lair.known ? `(${lair.q}, ${lair.r})` : `near (${lair.hintQ}, ${lair.hintR})?`;
    html += `<span style="color:#aaa; white-space:nowrap; font-size:11px;">${_esc(kind.name || 'Lair')} · ${where}</span></div>`;
    if (lair.status !== 'active') {
        const how = lair.status === 'cleared' ? `Cleared by ${_esc(lair.endedByName || 'the wardens')}` : 'Scattered';
        html += `<div style="font-size:11px; color:#9ab;">${how} on day ${lair.endedDay}.</div></div>`;
        return html;
    }
    const leader = lair.leader.slain ? `<span style="color:#e0b040;">Leaderless</span> (a new chief by day ${lair.leaderlessUntil || '?'})` : `${_esc(lair.leader.name)}${lair.scouted && trait.label ? ` · <span style="color:#c9a;">${_esc(trait.label)}: ${_esc(trait.desc || '')}</span>` : ''}`;
    html += `<div style="font-size:11px; color:#ccc;">Chief: ${leader}</div>`;
    const strength = lair.scouted ? `about ${OutlawLairs.garrison(lair)} at home` : OutlawLairs.strengthLabel(lair.strength || 0);
    html += `<div style="font-size:11px; color:#ccc;">${_esc(OutlawLairs.notorietyLabel(lair.notoriety || 0))} · ${_esc(strength)} · ${lair.raids} raid(s) since day ${lair.founded}</div>`;
    for (const p of lair.parties) {
        html += `<div style="font-size:11px; color:#e0a070;">🏇 A band of ${p.strength} ${p.phase === 'home' ? 'rides home with its plunder' : `rides on ${_esc(p.targetName || 'a town')}`} (out since day ${p.sentDay})</div>`;
    }
    if (lair.scouted) html += `<div style="font-size:11px; color:#c8b070;">💰 Hoard: some ${Math.round(lair.hoard.gold || 0)} gold and ${Object.values(lair.hoard.goods || {}).reduce((a, b) => a + b, 0)} goods (scouted day ${lair.scouted.day})</div>`;
    if (lair.allied) html += `<div style="font-size:11px; color:#e0c060;">🗝️ Your partners since day ${lair.allied.since}: a weekly cut, and heat with the realm.</div>`;
    else if (lair.tribute && lair.tribute.until >= day) html += `<div style="font-size:11px; color:#e0c060;">💰 Tribute paid (${lair.tribute.paid}g): they spare you and yours until day ${lair.tribute.until}.</div>`;
    if (lair.alertUntil != null && day <= lair.alertUntil) html += `<div style="font-size:11px; color:#e08080;">⚠️ The camp is on its guard (until day ${lair.alertUntil}).</div>`;
    const bounty = (player.activeBounties || []).find(b => b && b.type === 'lair_leader' && b.lairId === lair.id);
    if (bounty) html += `<div style="font-size:11px; color:#7fd07f;">🎯 You hold the notice on ${_esc(bounty.targetName)}: ${bounty.actualPay}g.</div>`;
    if (lair.log.length) {
        html += `<div style="${HEAD} color:#9ab;">Lately</div>`;
        for (const e of lair.log.slice(-4).reverse()) html += `<div style="font-size:11px; color:#bbb;">• <span style="color:#777;">day ${e.day}</span> ${_esc(e.text)}</div>`;
    }

    if (here) {
        const ap = player.actionPoints || 0;
        const army = (player.army || []).length > 0;
        html += `<div style="${HEAD} color:#7fd07f;">Your Move</div>`;
        if (kind.intro) html += `<div style="font-size:11px; color:#aaa; font-style:italic; margin-bottom:4px;">${_esc(kind.intro)}</div>`;
        const costs = { scout: ActionMenu.getAPCost('lair_scout'), assault: ActionMenu.getAPCost('lair_assault'), strike: ActionMenu.getAPCost('lair_strike'), parley: ActionMenu.getAPCost('lair_parley') };
        html += _btn(ap >= costs.scout, `🔭 Scout (${costs.scout} AP, ${_pct(OutlawLairs.scoutChance(player, lair))})`, `window._lairs.act(${lair.id}, 'scout')`, BTN_GOLD, `Needs ${costs.scout} AP`);
        const stages = ((OutlawLairs.config().assault || {}).stages || []).map(s => OutlawLairs.stageStrength(player, world, lair, s));
        const odds = lair.scouted ? ` vs ${stages.join(' / ')}` : '';
        html += _btn(ap >= costs.assault && army, `⚔️ Storm the lair (${costs.assault} AP${odds})`, `window._lairs.act(${lair.id}, 'assault')`, BTN_RED, army ? `Needs ${costs.assault} AP` : 'You need an army');
        if (!lair.leader.slain) {
            html += _btn(ap >= costs.strike, `🗡️ Strike at the chief alone (${costs.strike} AP, ${_pct(OutlawLairs.strikeChance(player, lair))})`, `window._lairs.act(${lair.id}, 'strike')`, BTN_RED, `Needs ${costs.strike} AP`);
        }
        if (kind.parley && !lair.leader.slain && !lair.allied) {
            const price = OutlawLairs.tributePrice(player, lair);
            html += _btn(ap >= costs.parley && (player.gold || 0) >= price, `💰 Pay tribute (${price}g)`, `window._lairs.act(${lair.id}, 'tribute')`, BTN_GOLD, (player.gold || 0) < price ? `You need ${price} gold` : `Needs ${costs.parley} AP`);
        }
        if (kind.ally) {
            const can = OutlawLairs.canAlly(player, lair);
            html += _btn(can.ok && ap >= costs.parley, '🗝️ Become partners', `window._lairs.act(${lair.id}, 'ally')`, BTN_GOLD, can.reason || `Needs ${costs.parley} AP`);
            if (!can.ok && !lair.allied) html += `<div style="font-size:10px; color:#888;">${_esc(can.reason)}</div>`;
        }
        html += '<div style="font-size:10px; color:#888; margin-top:4px;">Storming is three battles — palisade, camp, the chief\'s hold; lose one and the assault fails. Scouting first lowers their strength and reveals the hoard.</div>';
    }
    html += '</div>';
    return html;
}

function _resultHtml(res) {
    if (!res) return '';
    let html = '';
    if (res.stages) {
        for (const s of res.stages) {
            html += `<div style="font-size:12px; color:${s.victory ? '#7fd07f' : '#e08080'};">${s.victory ? '✔' : '✘'} ${_esc(s.name)} (strength ${s.enemy}) — ${s.victory ? 'taken' : 'thrown back'}${s.casualties ? `, ${s.casualties} of yours fell` : ''}${s.loot ? `, ${s.loot}g looted` : ''}</div>`;
        }
        if (res.cleared && res.rewards) {
            const r = res.rewards;
            const goods = Object.entries(r.goods || {}).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ');
            html += `<div style="font-size:12px; color:var(--gold); margin-top:4px;">🏆 The lair is yours to burn. Hoard: ${r.gold} gold${goods ? `, ${_esc(goods)}` : ''}. +${r.renown} renown${r.prestige ? `, +${r.prestige} Prestige` : ''}${r.reputation ? `, +${r.reputation} standing with the realm` : ''}.</div>`;
            const left = Object.keys(r.left || {});
            if (left.length) html += `<div style="font-size:11px; color:#e0a070;">Your packs are full: ${_esc(left.join(', '))} left behind.</div>`;
        } else if (!res.cleared) {
            html += '<div style="font-size:12px; color:#e08080; margin-top:4px;">The assault fails. The outlaws crow about it in every tavern.</div>';
        }
        return html;
    }
    return `<div style="font-size:12px; color:#eee;">${_esc(res.text || '')}</div>`;
}

Object.assign(ActionMenu, {
    /** Journal → Outlaw Lairs; with a lair id beside the player, its deeds as well. */
    showOutlawLairs(game, lairId = null, message = null) {
        const player = game.player;
        const world = game.world;
        const known = OutlawLairs.known(player);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: rgba(245,197,66,0.4);">${message}</div>`;
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">Bandits, smugglers, deserters, cultists and beasts dig in where the law is thin. Left alone they grow, raid the roads and burn villages; the realm\'s wardens come for some. Hear of them in taverns and on notice boards, and deal with them as you will.</p>';
        const here = lairId != null ? OutlawLairs.find(player, lairId) : OutlawLairs.lairNear(player, world, player.q, player.r, 1);
        if (here && here.status === 'active') html += _lairCard(game, here, true);
        const rest = known.filter(l => !here || l.id !== here.id);
        if (!known.length) html += `<div style="${CARD} color:#999;">You know of no outlaw lairs. Ask in the taverns, or read the notice boards.</div>`;
        const ws = (player.outlawLairs && player.outlawLairs.stats) || {};
        if (ws.formed) html += `<div style="font-size:11px; color:#888;">Across the realms: ${ws.formed} lair(s) have taken root, ${ws.raids || 0} raid(s) struck, ${ws.expeditions || 0} expedition(s) sent, ${ws.clearedByRealms || 0} lair(s) burned out by the realms' wardens and ${ws.clearedByPlayer || 0} by you.</div>`;
        const standing = rest.filter(l => l.status === 'active');
        const gone = rest.filter(l => l.status !== 'active');
        if (standing.length) html += `<div style="${HEAD} color:var(--gold);">Known Lairs</div>`;
        for (const l of standing) html += _lairCard(game, l, false);
        if (gone.length) html += `<div style="${HEAD} color:#999;">Gone</div>`;
        for (const l of gone.slice(-6)) html += _lairCard(game, l, false);
        html += '</div>';

        window._lairs = {
            act: (id, what) => {
                const apType = { scout: 'lair_scout', assault: 'lair_assault', strike: 'lair_strike', tribute: 'lair_parley', ally: 'lair_parley' }[what];
                if (!apType) return;
                if ((player.actionPoints || 0) < ActionMenu.getAPCost(apType)) {
                    game.ui.showNotification('⚡ Not Enough Action Points', `That takes ${ActionMenu.getAPCost(apType)} AP.`, 'error');
                    return;
                }
                const fn = { scout: OutlawLairs.scout, assault: OutlawLairs.assault, strike: OutlawLairs.strike, tribute: OutlawLairs.payTribute, ally: OutlawLairs.ally }[what];
                const res = fn(player, world, id);
                if (!res.success) {
                    game.ui.showNotification('🏕️ Outlaws', res.reason, 'error');
                    return;
                }
                ActionMenu.spendAP(player, apType, game);
                game.ui.updateStats(player, world);
                if (res.stages && res.stages.some(s => s.captured)) {
                    game.ui.hideCustomPanel();
                    game.ui.showNotification('⛓️ Captured', 'Your army broken, you are dragged off in chains by the outlaws.', 'error');
                    return;
                }
                ActionMenu.showOutlawLairs(game, id, _resultHtml(res));
            },
        };
        game.ui.showCustomPanel('🏕️ Outlaw Lairs', html);
    },
});
