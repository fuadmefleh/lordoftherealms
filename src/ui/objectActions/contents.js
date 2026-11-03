// The "what's inside" window for chests, crates, barrels, shelves and sacks:
// lists the contents (systems/containers.js) and lets the player take them —
// or, when they aren't the player's, steal them at the odds shown.
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { Containers } from '../../systems/containers.js';
import { MODAL_STYLE, MODAL_HEADER_STYLE, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from './data.js';
import { _btn, _removeModal, _showStoreModal } from './logic.js';

const MODAL_ID = 'objActionModal';

/** Where this container is, whose it is, and the realm's law over it. */
export function containerContext(game, furnitureType, q, r) {
    const wt = InnerMap.currentWorldTile || { q: game.player.q, r: game.player.r };
    const wTile = game.world && game.world.getTile ? game.world.getTile(wt.q, wt.r) : null;
    const settlement = wTile && wTile.settlement;
    const b = InnerMap._insideBuilding || null;
    return {
        worldQ: wt.q, worldR: wt.r, q, r, furnitureType,
        building: b ? { type: b.type, q: b.q, r: b.r, name: b.name, isPlayerOwned: b.isPlayerOwned, isPlayerProperty: b.isPlayerProperty } : null,
        inSettlement: !!settlement,
        kingdom: (settlement && settlement.kingdom) || (wTile && wTile.kingdom) || null,
        settlementName: settlement && settlement.name,
    };
}

/** Who could see the player reach in: people near, guards among them, the owner at home. */
export function theftScene(game, ctx) {
    const T = Containers.cfg('theft');
    const pq = InnerMap.playerInnerQ;
    const pr = InnerMap.playerInnerR;
    const near = (InnerMap.npcs || []).filter(n => n && n.state !== 'at_building' && !n.departed
        && Math.abs(n.q - pq) + Math.abs(n.r - pr) <= T.witnessRange);
    const guards = near.filter(n => /guard|soldier|watch/i.test(String(n.type || ''))).length;
    const owner = ctx.building ? near.find(n => n.type !== 'traveler' && !/guard/i.test(String(n.type || ''))) : null;
    return {
        witnesses: near.length - guards - (owner ? 1 : 0),
        guards,
        ownerInside: !!owner,
        ownerName: owner && owner.name,
        hour: InnerMap.timeOfDay,
    };
}

function _riskColour(c) {
    return c < 0.25 ? '#5ddb6a' : c < 0.5 ? '#e0c060' : '#e06a5a';
}

/**
 * Open a container. Your own chests open the storage window (put and take);
 * everything else shows what's inside.
 */
export function showContentsModal(game, objDef, anchorQ, anchorR) {
    const furnitureType = (objDef && (objDef.furnitureType || objDef.type)) || 'chest';
    const ctx = containerContext(game, furnitureType, anchorQ, anchorR);
    const access = Containers.access(ctx);
    if (access === 'own') { _showStoreModal(game, objDef, anchorQ, anchorR); return; }

    _removeModal(MODAL_ID);
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = MODAL_STYLE + 'min-width:400px;max-width:500px;';
    const name = (objDef && objDef.name) || furnitureType;
    const icon = (objDef && objDef.icon) || '📦';
    let lastMsg = null;

    const render = () => {
        const player = game.player;
        const scene = theftScene(game, ctx);
        ctx.ownerName = scene.ownerName;
        const items = Object.entries(Containers.contents(player, game.world, ctx)).filter(([, n]) => n > 0);
        const whose = access === 'free'
            ? 'No one claims this. Take what you like.'
            : ctx.building
                ? `This belongs to ${scene.ownerName || `whoever keeps ${/^the\s/i.test(ctx.building.name || '') ? ctx.building.name : `the ${ctx.building.name || 'place'}`}`}. Anything you take, you steal.`
                : `This belongs to someone in ${ctx.settlementName || 'town'}. Anything you take, you steal.`;
        const watchers = access === 'steal'
            ? [scene.ownerInside ? 'the owner is here' : null,
                scene.guards ? `${scene.guards} guard${scene.guards === 1 ? '' : 's'} in sight` : null,
                scene.witnesses > 0 ? `${scene.witnesses} other${scene.witnesses === 1 ? '' : 's'} nearby` : null]
                .filter(Boolean).join(', ') || 'no one is watching'
            : '';

        const rows = items.map(([id, n]) => {
            const g = Containers.good(id);
            let buttons;
            if (access === 'steal') {
                const one = Containers.stealOdds(player, ctx, id, 1, scene);
                const all = Containers.stealOdds(player, ctx, id, n, scene);
                const tip = one.parts.map(p => `${p.label}: ${p.delta >= 0 ? '+' : ''}${Math.round(p.delta * 100)}%`).join('&#10;');
                buttons = `
                    <button title="${tip}" onclick="window._containerAct('steal','${id}',1)" style="background:rgba(224,106,90,0.18);color:#e8a090;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">Steal 1 <span style="color:${_riskColour(one.chance)}">(${Math.round(one.chance * 100)}% caught)</span></button>
                    ${n > 1 ? `<button title="${tip}" onclick="window._containerAct('steal','${id}',${n})" style="background:rgba(224,106,90,0.18);color:#e8a090;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">All <span style="color:${_riskColour(all.chance)}">(${Math.round(all.chance * 100)}%)</span></button>` : ''}`;
            } else {
                buttons = `
                    <button onclick="window._containerAct('take','${id}',1)" style="background:rgba(93,219,106,0.2);color:#5ddb6a;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">Take 1</button>
                    ${n > 1 ? `<button onclick="window._containerAct('take','${id}',${n})" style="background:rgba(93,219,106,0.2);color:#5ddb6a;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">Take all</button>` : ''}`;
            }
            return `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;font-size:12px">
                    <span>${g.icon} ${g.name} ×${n} <span style="color:#888">· ${g.basePrice}g each</span></span>
                    <span style="display:flex;gap:4px;flex-shrink:0">${buttons}</span>
                </div>`;
        }).join('');

        modal.innerHTML = `
            <div style="${MODAL_HEADER_STYLE}">
                <span style="font-size:28px">${icon}</span>
                <div>
                    <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">${name}</div>
                    <div style="font-size:11px;color:#999">${whose}</div>
                </div>
            </div>
            <div style="${MODAL_BODY_STYLE}">
                ${watchers ? `<div style="font-size:11px;color:#bbb">👁 ${watchers}${InnerMap.timeOfDay >= 22 || InnerMap.timeOfDay < 5 ? ' · the dark is on your side' : ''}</div>` : ''}
                ${lastMsg ? `<div style="font-size:12px;padding:6px 8px;border-radius:4px;background:${lastMsg.bad ? 'rgba(224,106,90,0.15)' : 'rgba(93,219,106,0.12)'};color:${lastMsg.bad ? '#e8a090' : '#9fe0a6'}">${lastMsg.text}</div>` : ''}
                <div style="display:flex;flex-direction:column;gap:3px">
                    ${rows || '<div style="font-size:12px;color:#777;padding:8px">Empty. Nothing worth having.</div>'}
                </div>
            </div>
            <div style="${MODAL_FOOTER_STYLE}">
                ${_btn('Close', false, `document.getElementById('${MODAL_ID}').remove()`)}
            </div>`;
    };

    window._containerAct = (kind, goodId, qty) => {
        const player = game.player;
        const scene = theftScene(game, ctx);
        ctx.ownerName = scene.ownerName;
        const res = kind === 'steal'
            ? Containers.steal(player, game.world, ctx, goodId, qty, scene)
            : Containers.take(player, game.world, ctx, goodId, qty);
        lastMsg = { text: res.text, bad: !res.ok };
        if (res.caught) {
            game.ui.showNotification('🚨 Caught stealing!', res.text, 'error');
            if (res.jailDays) { modal.remove(); game.ui.updateStats(player, game.world); return; }
        }
        game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        render();
    };

    render();
    document.body.appendChild(modal);
}
