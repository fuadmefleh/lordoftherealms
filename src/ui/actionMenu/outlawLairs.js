// ActionMenu — Outlaw Lairs (Journal → Outlaw Lairs, and the action menu
// beside a lair): the lairs the player knows of, their chiefs, strength,
// raids and bargains; and at a lair, the deeds — scout, storm, strike at the
// chief, pay tribute, become partners. Logic lives in systems/outlawLairs.js;
// this panel presents it.
import { ActionMenu } from './_ref.js';
import { OutlawLairs } from './_imports.js';
import { esc, lede, card, rowList, sectionHead, more } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): each lair a card; at a
// lair, one row a deed with its odds and AP at the right, greyed with its
// reason. Clicks route through window._lairs (set on each render).
const NOTE = 'font-size:11px; color:#bbb; margin:1px 0;';
const _esc = esc;

function _pct(p) {
    return `${Math.round(p * 100)}%`;
}

/** A deed row: onclick into window._lairs.act(id, what). */
function _deed(lair, what, o, ok) {
    return { ...o, off: !ok, attrs: ok ? `onclick="window._lairs.act(${lair.id}, '${what}')"` : '' };
}

function _lairCard(game, lair) {
    const player = game.player;
    const world = game.world;
    const kind = OutlawLairs.kind(lair.kind) || {};
    const trait = OutlawLairs.leaderTrait(lair);
    const day = world.day || 0;
    const where = lair.known ? `(${lair.q}, ${lair.r})` : `near (${lair.hintQ}, ${lair.hintR})?`;
    const head = { icon: kind.icon || '🏕️', title: _esc(lair.name), side: `${_esc(kind.name || 'Lair')} · ${where}` };
    if (lair.status !== 'active') {
        const how = lair.status === 'cleared' ? `Cleared by ${_esc(lair.endedByName || 'the wardens')}` : 'Scattered';
        return card(`<div style="${NOTE}">${how} on day ${lair.endedDay}.</div>`, head);
    }
    let html = '';
    const leader = lair.leader.slain ? `<span style="color:#e0b040;">Leaderless</span> (a new chief by day ${lair.leaderlessUntil || '?'})` : `${_esc(lair.leader.name)}${lair.scouted && trait.label ? ` · <span style="color:#c9a;">${_esc(trait.label)}: ${_esc(trait.desc || '')}</span>` : ''}`;
    html += `<div style="${NOTE}">Chief: ${leader}</div>`;
    const strength = lair.scouted ? `about ${OutlawLairs.garrison(lair)} at home` : OutlawLairs.strengthLabel(lair.strength || 0);
    html += `<div style="${NOTE}">${_esc(OutlawLairs.notorietyLabel(lair.notoriety || 0))} · ${_esc(strength)} · ${lair.raids} raid${lair.raids === 1 ? '' : 's'} since day ${lair.founded}</div>`;
    for (const p of lair.parties) {
        html += `<div style="${NOTE} color:#e0a070;">🏇 A band of ${p.strength} ${p.phase === 'home' ? 'rides home with its plunder' : `rides on ${_esc(p.targetName || 'a town')}`} (out since day ${p.sentDay})</div>`;
    }
    if (lair.scouted) html += `<div style="${NOTE} color:#c8b070;">💰 Hoard: some ${Math.round(lair.hoard.gold || 0)} gold and ${Object.values(lair.hoard.goods || {}).reduce((a, b) => a + b, 0)} goods (scouted day ${lair.scouted.day})</div>`;
    if (lair.allied) html += `<div style="${NOTE} color:#e0c060;">🗝️ Your partners since day ${lair.allied.since}: a weekly cut, and heat with the realm.</div>`;
    else if (lair.tribute && lair.tribute.until >= day) html += `<div style="${NOTE} color:#e0c060;">💰 Tribute paid (${lair.tribute.paid}g): they spare you and yours until day ${lair.tribute.until}.</div>`;
    if (lair.alertUntil != null && day <= lair.alertUntil) html += `<div style="${NOTE} color:#e08080;">⚠️ The camp is on its guard (until day ${lair.alertUntil}).</div>`;
    const bounty = (player.activeBounties || []).find(b => b && b.type === 'lair_leader' && b.lairId === lair.id);
    if (bounty) html += `<div style="${NOTE} color:#7fd07f;">🎯 You hold the notice on ${_esc(bounty.targetName)}: ${bounty.actualPay}g.</div>`;
    if (lair.log.length) {
        html += more('Lately', lair.log.slice(-4).reverse().map(e => `<div style="${NOTE}"><span style="color:#777;">day ${e.day}</span> ${_esc(e.text)}</div>`).join(''));
    }
    return card(html, head);
}

/** The deeds at a lair the player stands beside. */
function _deedsHtml(game, lair) {
    const player = game.player;
    const world = game.world;
    const kind = OutlawLairs.kind(lair.kind) || {};
    const ap = player.actionPoints || 0;
    const army = (player.army || []).length > 0;
    const costs = { scout: ActionMenu.getAPCost('lair_scout'), assault: ActionMenu.getAPCost('lair_assault'), strike: ActionMenu.getAPCost('lair_strike'), parley: ActionMenu.getAPCost('lair_parley') };
    const rows = [];
    rows.push(_deed(lair, 'scout', {
        icon: '🔭', name: 'Scout the camp', desc: 'Lowers their strength for a storming and reveals the hoard',
        why: `Needs ${costs.scout} AP`, side: `${_pct(OutlawLairs.scoutChance(player, lair))} · ${costs.scout} AP`,
    }, ap >= costs.scout));
    const stages = ((OutlawLairs.config().assault || {}).stages || []).map(s => OutlawLairs.stageStrength(player, world, lair, s));
    rows.push(_deed(lair, 'assault', {
        icon: '⚔️', name: 'Storm the lair', tone: 'bad',
        desc: `Three battles: palisade, camp, the chief's hold. Lose one and the assault fails.${lair.scouted ? ` Their strength: ${stages.join(' / ')}.` : ''}`,
        why: army ? `Needs ${costs.assault} AP` : 'You need an army', side: `${costs.assault} AP`,
    }, ap >= costs.assault && army));
    if (!lair.leader.slain) {
        rows.push(_deed(lair, 'strike', {
            icon: '🗡️', name: 'Strike at the chief alone', desc: 'By night, by your own hand', tone: 'bad',
            why: `Needs ${costs.strike} AP`, side: `${_pct(OutlawLairs.strikeChance(player, lair))} · ${costs.strike} AP`,
        }, ap >= costs.strike));
    }
    if (kind.parley && !lair.leader.slain && !lair.allied) {
        const price = OutlawLairs.tributePrice(player, lair);
        rows.push(_deed(lair, 'tribute', {
            icon: '💰', name: 'Pay tribute', desc: 'They spare you and yours for a while', tone: 'gold',
            why: (player.gold || 0) < price ? `You need ${price} gold` : `Needs ${costs.parley} AP`, side: `${price}g`,
        }, ap >= costs.parley && (player.gold || 0) >= price));
    }
    if (kind.ally) {
        const can = OutlawLairs.canAlly(player, lair);
        rows.push(_deed(lair, 'ally', {
            icon: '🗝️', name: 'Become partners', desc: 'A weekly cut of their take, and heat with the realm',
            why: _esc(can.reason || `Needs ${costs.parley} AP`), side: `${costs.parley} AP`,
        }, can.ok && ap >= costs.parley));
    }
    return (kind.intro ? `<div style="${NOTE} font-style:italic;">${_esc(kind.intro)}</div>` : '') + rowList(rows, 'Your move');
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
        let html = '<div style="font-size: 12px;">';
        if (message) html += card(message, { tone: 'gold' });
        const here = lairId != null ? OutlawLairs.find(player, lairId) : OutlawLairs.lairNear(player, world, player.q, player.r, 1);
        const atLair = here && here.status === 'active';
        if (!atLair) html += lede('Bandits, smugglers, deserters, cultists and beasts dig in where the law is thin. Left alone they grow and raid; the realm\'s wardens burn out some. Hear of them in taverns and on notice boards.');
        if (atLair) html += _lairCard(game, here) + _deedsHtml(game, here);
        const rest = known.filter(l => !here || l.id !== here.id);
        if (!known.length) html += `<div style="${NOTE}">You know of no outlaw lairs. Ask in the taverns, or read the notice boards.</div>`;
        const standing = rest.filter(l => l.status === 'active');
        const gone = rest.filter(l => l.status !== 'active');
        if (standing.length) html += sectionHead(atLair ? 'Other lairs you know' : 'Known lairs') + standing.map(l => _lairCard(game, l)).join('');
        if (gone.length) html += more(`Gone (${gone.length})`, gone.slice(-6).map(l => _lairCard(game, l)).join(''));
        const ws = (player.outlawLairs && player.outlawLairs.stats) || {};
        if (ws.formed) html += `<div style="${NOTE} color:#888; margin-top:6px;">Across the realms: ${ws.formed} lairs have taken root, ${ws.raids || 0} raids struck, ${ws.expeditions || 0} expeditions sent; ${ws.clearedByRealms || 0} burned out by the realms' wardens, ${ws.clearedByPlayer || 0} by you.</div>`;
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
