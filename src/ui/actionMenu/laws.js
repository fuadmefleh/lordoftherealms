// ActionMenu — Laws: the laws of the realms (systems/laws.js). Three tabs:
// the realm you stand in (each law, and what it means for you), every realm
// at a glance, and — for a ruler — the crown's own laws, to change by
// proclamation (a cost to the treasury and to stability, and a wait before
// the same law can be changed again). Opened from the Kingdom menu, the Royal
// Court and the Counsel. Buttons route through data-am-act → ActionMenu.lawsAct.
import { ActionMenu } from './_ref.js';
import { Laws } from '../../systems/laws.js';
import { BTN_GOLD, BTN_DIM, CARD, panelTabs, lede, chips, bullets, sectionHead } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TABS = [['here', '📍 This realm'], ['realms', '🗺️ All realms'], ['crown', '👑 Your crown']];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="lawsAct" data-am-args='${esc(JSON.stringify(args))}' style="${BTN_GOLD}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** The realm the player stands in (a town's crown, or whoever holds the land). */
function hereKingdom(game) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    const kid = tile && (tile.settlement ? tile.settlement.kingdom : tile.kingdom);
    return kid != null ? (world.getKingdom ? world.getKingdom(kid) : (world.kingdoms || []).find(k => k.id === kid)) : null;
}

/** What a law means for the player, in this realm. */
function forYou(game, k, lawId, option) {
    const { player, world } = game;
    if (!option) return '';
    if (lawId === 'foreignLand' && option.id === 'subjects') {
        return Laws.isSubject(player, k.id) ? 'You are sworn to the realm: you may hold land here.' : 'You are not sworn to this realm: you may not buy or rent land or houses here.';
    }
    if (lawId === 'privatePrisons' && option.id === 'allowed') return 'Anyone who sets on you and wins may take you for their prison camp.';
    if (lawId === 'vice') {
        // The town's own ordinance on top of the realm's (Laws.gambling)
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (s) {
            const g = Laws.gambling(world, s);
            if (g.forbiddenBy === 'town') return `${s.name} bans dice and cards by its own ordinance: no gaming house here, only back rooms behind some honest front.`;
            if (g.forbiddenBy === 'realm') return 'No gaming house may open: dice and cards go on in back rooms, behind some honest front, and the watch raids them.';
            return `In ${s.name} the tables may stand in the open.`;
        }
        return option.id === 'forbidden' ? 'No gaming house may open in this realm: only back rooms behind some honest front.' : '';
    }
    if (lawId === 'punishment') {
        const p = Laws.punishment(world, k.id);
        if (p.fine === 1 && p.jail === 1 && p.deter === 1) return 'The watch fines and jails by long custom.';
        const street = p.deter < 1 ? ' Footpads and brawlers fear it: one who downs you is less likely to finish you or rob you.'
            : p.deter > 1 ? ' Footpads and brawlers fear it little: one who downs you is more likely to finish you or rob you.' : '';
        return `The watch's fines ×${p.fine}, days in the cells ×${p.jail}.${street}`;
    }
    return '';
}

function hereTab(game) {
    const k = hereKingdom(game);
    if (!k) return `<div style="${CARD}">No crown holds this land. Out here there is no law but what a stronger arm makes.</div>`;
    let html = lede(`The laws of <b>${esc(k.name)}</b>, under ${esc(k.ruler || 'its crown')}.`);
    for (const { law, option, set } of Laws.of(game.world, k.id)) {
        html += `<div style="${CARD}">`;
        html += `<div style="font-weight:bold;">${law.icon} ${esc(law.name)}: <span style="color:var(--gold);">${esc(option ? option.label : '—')}</span>${set ? '' : ` <small style="${NOTE}">(by old custom)</small>`}</div>`;
        html += `<div style="${NOTE}">${esc(law.desc)}</div>`;
        if (option && option.desc) html += `<div style="margin-top:2px;">${esc(option.desc)}</div>`;
        const you = forYou(game, k, law.id, option);
        if (you) html += bullets([`<b>For you:</b> ${esc(you)}`]);
        html += '</div>';
    }
    return html;
}

function realmsTab(game) {
    const { world } = game;
    const realms = (world.kingdoms || []).filter(k => k && k.isAlive !== false);
    const laws = Laws.list();
    let html = `<div style="display:grid; grid-template-columns: 1.3fr repeat(${laws.length}, 1fr); gap:4px 8px; align-items:center;">`;
    html += `<span style="${NOTE}">Realm</span>${laws.map(l => `<span style="${NOTE}">${l.icon} ${esc(l.name)}</span>`).join('')}`;
    for (const k of realms) {
        html += `<span><b>${esc(k.name)}</b></span>`;
        for (const l of laws) {
            const o = Laws.option(world, k.id, l.id);
            html += `<span>${esc(o ? o.label : '—')}</span>`;
        }
    }
    return html + '</div>';
}

function crownTab(game) {
    const { player, world } = game;
    const k = Laws.ruled(player, world);
    if (!k) return `<div style="${CARD}">You rule no realm. Only a ruler may change a realm's laws.</div>`;
    const C = Laws.config();
    let html = chips([
        ['💰', 'Treasury', `${Math.floor(k.treasury || 0)}g`, 'gold'],
        ['⚖️', 'Stability', Math.round(k.stability || 0)],
    ]);
    html += lede(`Proclaim the laws of <b>${esc(k.name)}</b>.`);
    html += bullets([
        `Each change costs the treasury ${Math.round(C.changeCost.treasury)}g and the realm ${Math.round(C.changeCost.stability)} stability (more for a hard law).`,
        `A law can't be changed again for ${C.cooldownDays} days.`,
    ]);
    for (const { law, option } of Laws.of(world, k.id)) {
        html += `<div style="${CARD}">`;
        html += `<div style="font-weight:bold;">${law.icon} ${esc(law.name)}: <span style="color:var(--gold);">${esc(option ? option.label : '—')}</span></div>`;
        html += `<div style="${NOTE}">${esc(law.desc)}</div>`;
        html += '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">';
        for (const o of law.options) {
            if (option && o.id === option.id) continue;
            const can = Laws.canEnact(player, world, law.id, o.id);
            const tip = `${o.desc || ''}${can.ok ? ` — ${can.cost}g, stability −${can.stability}` : ` — ${can.reason}`}`;
            html += act(`Make it ${esc(o.label.toLowerCase())}${can.ok ? ` (${can.cost}g, −${can.stability} stab.)` : ''}`, ['enact', law.id, o.id], can.ok, tip);
        }
        html += '</div>';
        const last = k.laws && k.laws.changed && k.laws.changed[law.id];
        if (last != null) html += `<div style="${NOTE} margin-top:2px;">Last changed on day ${last}.</div>`;
        html += '</div>';
    }
    const hist = (k.laws && Array.isArray(k.laws.history)) ? k.laws.history.slice(-6).reverse() : [];
    if (hist.length) {
        html += sectionHead('📖 Proclamations');
        for (const h of hist) {
            const L = Laws.law(h.law);
            const to = L && L.options.find(o => o.id === h.to);
            html += `<div style="${NOTE}">Day ${h.day}: ${esc(L ? L.name : h.law)} — ${esc(to ? to.label : h.to)}</div>`;
        }
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Laws panel: `tab` is 'here', 'realms' or 'crown'. */
    showLaws(game, tab = null) {
        const ruler = !!Laws.ruled(game.player, game.world);
        const t = tab || (ruler ? 'crown' : 'here');
        let html = '<div style="font-size:12px;">';
        html += panelTabs(game, {
            id: 'laws', title: '📜 Laws', tabs: TABS.filter(([id]) => id !== 'crown' || ruler), active: t,
            go: (k) => { ActionMenu.showLaws(game, k); },
            attrsFor: (k) => `data-am-act="showLaws" data-am-args='${esc(JSON.stringify([k]))}'`,
        });
        html += t === 'realms' ? realmsTab(game) : t === 'crown' ? crownTab(game) : hereTab(game);
        html += '</div>';
        game.ui.showCustomPanel('📜 Laws', html);
    },

    /** Every button on the panel. */
    lawsAct(game, op, a = null, b = null) {
        if (op !== 'enact') return;
        const res = Laws.enact(game.player, game.world, a, b);
        game.ui.showNotification('📜 Laws', res.success ? res.text : res.reason, res.success ? 'success' : 'error');
        if (res.success) game.ui.updateStats(game.player, game.world);
        ActionMenu.showLaws(game, 'crown');
    },
});
