// ActionMenu — Laws: the laws of the realms (systems/laws.js). Three tabs:
// the realm you stand in (each law, and what it means for you), every realm
// at a glance, and — for a ruler — the crown's own laws, to change by
// proclamation (a cost to the treasury and to stability, and a wait before
// the same law can be changed again). Opened from the Kingdom menu, the Royal
// Court and the Counsel. Buttons route through data-am-act → ActionMenu.lawsAct.
import { ActionMenu } from './_ref.js';
import { Laws } from '../../systems/laws.js';
import { TownSchool } from '../../systems/townSchool.js';
import { panelTabs, lede, chips, rowList, card, price, more } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TABS = [['here', '📍 This realm'], ['realms', '🗺️ All realms'], ['crown', '👑 Your crown']];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    if (!k) return lede('No crown holds this land. Out here there is no law but what a stronger arm makes.');
    let html = lede(`The laws of <b>${esc(k.name)}</b>, under ${esc(k.ruler || 'its crown')}. What each means for you is on its line.`);
    html += rowList(Laws.of(game.world, k.id).map(({ law, option, set }) => {
        const you = forYou(game, k, law.id, option);
        return {
            icon: law.icon,
            name: esc(law.name),
            desc: esc(option && option.desc ? option.desc : law.desc),
            note: you ? `<b>For you:</b> ${esc(you)}` : '',
            side: `${esc(option ? option.label : '—')}${set ? '' : '<br><small style="color:#8f8a7e;">old custom</small>'}`,
            tone: 'gold',
            title: law.desc,
        };
    }));
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
    if (!k) return lede('You rule no realm. Only a ruler may change a realm\'s laws.');
    const C = Laws.config();
    let html = lede(`Proclaim the laws of <b>${esc(k.name)}</b>. Each change costs the treasury and some stability (more for a hard law); a law can't be changed again for ${C.cooldownDays} days.`);
    html += chips([
        ['💰', 'Treasury', `${Math.floor(k.treasury || 0)}g`, 'gold'],
        ['⚖️', 'Stability', Math.round(k.stability || 0)],
    ]);
    for (const { law, option } of Laws.of(world, k.id)) {
        const last = k.laws && k.laws.changed && k.laws.changed[law.id];
        const rows = law.options.filter(o => !(option && o.id === option.id)).map(o => {
            const can = Laws.canEnact(player, world, law.id, o.id);
            return {
                icon: '📜',
                name: `Make it ${esc(o.label.toLowerCase())}`,
                desc: esc(o.desc || ''),
                side: can.ok ? `${price(can.cost, (k.treasury || 0) >= can.cost)}<br><small style="color:#e0846a;">−${can.stability} stab.</small>` : '',
                off: !can.ok, why: esc(can.reason || ''),
                act: 'lawsAct', args: ['enact', law.id, o.id],
            };
        });
        const head = `<div style="font-size:11px; color:#9d937c; margin-bottom:2px;">${esc(law.desc)}${last != null ? ` · last changed on day ${last}` : ''}</div>`;
        html += card(head + rowList(rows), { icon: law.icon, title: esc(law.name), side: esc(option ? option.label : '—'), tone: 'gold' });
    }
    const hist = (k.laws && Array.isArray(k.laws.history)) ? k.laws.history.slice(-6).reverse() : [];
    html += more(`Proclamations (${hist.length})`, rowList(hist.map(h => {
        const L = Laws.law(h.law);
        const to = L && L.options.find(o => o.id === h.to);
        return { icon: L ? L.icon : '📜', name: esc(L ? L.name : h.law), desc: esc(to ? to.label : h.to), side: `day ${h.day}` };
    })));
    return html;
}

/** The towns the player may found a school in: the one stood in (a holding or a town of the realm), and on the crown tab the realm's towns. */
function schoolsSection(game, tab) {
    const { player, world } = game;
    const towns = [];
    const here = world.getTile(player.q, player.r);
    if (here && here.settlement && here.settlement.folk) towns.push(here.settlement);
    const k = tab === 'crown' ? Laws.ruled(player, world) : null;
    if (k && typeof world.getSettlementViews === 'function') {
        for (const s of world.getSettlementViews()) if (s && s.folk && s.kingdom === k.id && !towns.includes(s)) towns.push(s);
    }
    const rows = [];
    for (const s of towns) {
        const can = TownSchool.canFound(player, world, s);
        const founded = s.folk.school && s.folk.school.founded;
        if (!can.ok && !founded && !/treasury|costs/.test(can.reason || '')) continue;
        const lit = TownSchool.townLiteracy(s.folk, world.day || 1);
        const literate = lit.known ? ` · about ${Math.round(lit.share * 100)} in 100 grown folk can write` : '';
        if (founded) {
            rows.push({ icon: '🏫', name: esc(s.name), desc: `School founded on day ${founded.d}${literate}`, side: 'founded', tone: 'good' });
            continue;
        }
        rows.push({
            icon: '🏫', name: `Found a school in ${esc(s.name)}`,
            desc: `Half builds it, half endows its fund; ${can.payer === 'crown' ? 'paid from the treasury' : 'paid from your purse'}${literate}`,
            title: 'More of the town sends its children to learn their letters, more each year.',
            side: can.cost != null ? price(can.cost, can.ok) : '',
            off: !can.ok, why: esc(can.reason || ''),
            act: 'lawsAct', args: ['foundSchool', s.q, s.r],
        });
    }
    return rowList(rows, '🏫 Schools');
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
        // Founding a town's school by decree: the ruler for the realm's towns, a lord for a holding (systems/townSchool.js)
        if (t !== 'realms') html += schoolsSection(game, t);
        html += '</div>';
        game.ui.showCustomPanel('📜 Laws', html);
    },

    /** Every button on the panel. */
    lawsAct(game, op, a = null, b = null) {
        if (op === 'foundSchool') {
            const tile = game.world.getTile(a, b);
            const res = TownSchool.found(game.player, game.world, tile && tile.settlement);
            game.ui.showNotification('🏫 A school founded', res.success ? res.text : res.reason, res.success ? 'success' : 'error');
            if (res.success) game.ui.updateStats(game.player, game.world);
            ActionMenu.showLaws(game, Laws.ruled(game.player, game.world) ? 'crown' : 'here');
            return;
        }
        if (op !== 'enact') return;
        const res = Laws.enact(game.player, game.world, a, b);
        game.ui.showNotification('📜 Laws', res.success ? res.text : res.reason, res.success ? 'success' : 'error');
        if (res.success) game.ui.updateStats(game.player, game.world);
        ActionMenu.showLaws(game, 'crown');
    },
});
