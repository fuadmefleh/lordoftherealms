// ActionMenu — Threats: where the player's enemies stand. The power the
// realms see in you (and the marks at which they worry and band together),
// each realm's fear, envy and grudge (blood feuds down the generations), the
// league sworn against you with its terms and members — buy one out, seal a
// match, cede a town, pay or bow to the whole, or throw the terms back — and
// the rival Houses' agents you have unmasked in your towns (turn them or
// expose them; ask around a town to find them). Logic lives in
// systems/coalitions.js and systems/rivalAgents.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Coalitions } from '../../systems/coalitions.js';
import { RivalAgents } from '../../systems/rivalAgents.js';
import { BTN_GOLD, BTN_DARK, BTN_RED, BTN_OFF, CARD, esc } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; color: var(--gold);';
const PART_LABELS = {
    towns: '🏰 Towns held', properties: '🏭 Properties', crown: '👑 Crown', title: '🏅 Office', army: '⚔️ Army',
    wealth: '💰 Wealth', prestige: '⭐ Prestige', renown: '📣 Renown', conquests: '🔥 Recent conquests',
};
const HOW = { appeased: '🕊️ appeased', humbled: '🏳️ disbanded (you were cut down)', broken: '🏆 broken' };

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:3px 0;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _btn(label, action, args, style, ok = true, title = '') {
    const a = esc(JSON.stringify([action, ...args]));
    return ok
        ? `<button data-am-act="threatsAct" data-am-args="${a}" style="${style}" title="${esc(title)}">${label}</button>`
        : `<button style="${BTN_OFF}" disabled title="${esc(title)}">${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The Threats panel (Dynasty → Threats, Realm Wars → Threats). */
    showThreatsPanel(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Coalitions.view(player, world);
        const gold = player.gold || 0;
        let html = '<div style="font-size:12px; max-height:520px; overflow-y:auto;">';
        if (message) html += `<div style="${CARD} border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;

        // ── Your power, as the courts measure it ──
        const p = v.power || { score: 0, parts: {} };
        const color = p.score >= v.form ? '#e06060' : p.score >= v.concern ? '#f5c542' : '#7fd07f';
        html += `<div style="${CARD}">`;
        html += `<div style="display:flex;justify-content:space-between;"><b>Your power in the courts' eyes</b><span style="color:${color};font-weight:bold;">${Math.round(p.score)}</span></div>`;
        html += _bar(p.score, v.form, color);
        html += `<div style="color:var(--text-secondary);font-size:11px;">The realms watch at ${v.concern}; past ${v.form} for ${Coalitions.config().brewWeeks} weeks they may swear a league against you.${p.day != null ? ` Last reckoned on day ${p.day}.` : ' Reckoned weekly.'}</div>`;
        const parts = Object.entries(p.parts || {}).filter(([, n]) => n > 0);
        if (parts.length) html += `<div style="margin-top:4px;font-size:11px;color:#bbb;">${parts.map(([k, n]) => `${PART_LABELS[k] || k} ${Math.round(n)}`).join(' · ')}</div>`;
        if (!v.active && v.pressure > 0) html += `<div style="margin-top:4px;color:#f5c542;">🕊️ Envoys ride between the courts: ${v.pressure} week${v.pressure > 1 ? 's' : ''} of talk of a league.</div>`;
        if (!v.active && v.cooldownUntil > (world.day || 0)) html += `<div style="margin-top:4px;color:#999;">The last league's memory is fresh: none will be sworn before day ${v.cooldownUntil}.</div>`;
        html += '</div>';

        // ── The league ──
        const c = v.active;
        if (c) {
            const members = Coalitions.members(player);
            html += `<div style="${CARD} border-color:rgba(224,96,96,0.5);">`;
            html += `<div style="font-weight:bold;color:#e08080;font-size:13px;">⚜️ ${esc(c.name)}</div>`;
            html += `<div style="color:#ccc;">Against ${esc(c.target)} · led by ${esc(c.leaderName)} · ${c.stage === 'forming' ? `<span style="color:#f5c542;">terms open until day ${c.dueDay}</span>` : '<span style="color:#e06060;">at war</span>'} · sworn day ${c.formed}${c.generation && player.house && c.generation < (player.house.generation || 1) ? ' · against your forebear' : ''}</div>`;
            html += `<div style="font-style:italic;color:#bbb;margin:3px 0;">"${esc(c.casusBelli)}"</div>`;
            html += `<div style="font-size:11px;">Resolve ${Math.round(Math.max(0, c.resolve))}</div>${_bar(c.resolve, 100, '#e06060')}`;
            html += `<div style="font-size:11px;color:var(--text-secondary);">Its members levy ${Math.round(Coalitions.config().embargoLevy * 100)}% on what you sell in their towns, cancel your licences, and their lords will not receive you. Breaking their hosts, outlasting them, and splitting them wears its resolve down; your growth hardens it.</div>`;
            const q = v.quote;
            html += '<div style="margin-top:6px;">';
            html += _btn(`💰 Pay the league (${q.gold}g)`, 'concede', ['gold'], BTN_GOLD, gold >= q.gold, 'Every member stands down; the courts see you bend.');
            html += _btn(`🙇 Bow (${q.prestige} Prestige)`, 'concede', ['prestige'], BTN_DARK, ((player.house && player.house.prestige) || 0) >= q.prestige, 'Every member stands down; your House pays in Prestige.');
            if (c.stage === 'forming') html += _btn('⚔️ Throw their terms back', 'defy', [], BTN_RED, true, 'War from every member at once.');
            html += '</div>';
            const kids = Coalitions.marriageable(player);
            const cedable = Coalitions.cedable(player, world);
            for (const m of members) {
                const k = world.getKingdom(m.kingdomId);
                const a = v.realms.find(r => r.kingdomId === m.kingdomId);
                const price = Coalitions.buyOffPrice(player, world, m.kingdomId);
                const war = [m.war === 'holdings' ? 'war on your holdings' : null, m.realmWar ? 'war on your realm' : null].filter(Boolean).join(', ') || (c.stage === 'active' ? 'levies only' : 'waiting');
                html += '<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:6px;padding-top:6px;">';
                html += `<div>${m.leader ? '👑 ' : ''}<b>${esc(m.name)}</b> <span style="color:#aaa;">— ${war}${k ? ` · army ${(() => { const s = RealmIntel.seen(player, world, k, 'military', 'military', k.military || 0, typeof player.knowsAbout !== 'function' || player.knowsAbout(k.id, 'military')); return s.exact ? s.text : esc(s.text); })()}` : ''}${a ? ` · hostility ${a.hostility}` : ''}</span></div>`;
                html += _btn(`💰 Buy out (${price}g)`, 'split', [m.kingdomId, 'gold', ''], BTN_GOLD, gold >= price, 'They leave the league and make peace with you.');
                for (const child of kids.slice(0, 2)) html += _btn(`💍 Wed ${esc(child.firstName)} into ${esc(m.name)}`, 'split', [m.kingdomId, 'marriage', child.id], BTN_DARK, true, 'A match seals their leaving.');
                for (const h of cedable.slice(0, 2)) html += _btn(`🏰 Cede ${esc(h.name)}`, 'split', [m.kingdomId, 'cede', `${h.q},${h.r}`], BTN_RED, true, 'A town of yours to them; they leave the league and remember the gift.');
                html += '</div>';
            }
            if (Array.isArray(c.log) && c.log.length) {
                html += `<div style="margin-top:6px;font-size:11px;color:#999;">${c.log.slice(-4).reverse().map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;
            }
            html += '</div>';
        }

        // ── The realms' regard ──
        html += `<div style="${HEAD}">The realms' regard</div>`;
        if (!v.realms.length) html += '<div style="color:#aaa;">The courts have not yet taken your measure (it is done weekly).</div>';
        for (const r of v.realms.slice(0, 10)) {
            const hc = r.hostility >= v.joinAt ? '#e06060' : r.hostility >= v.joinAt / 2 ? '#f5c542' : '#7fd07f';
            const member = c && Coalitions.isMember(player, r.kingdomId);
            html += `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);">`;
            html += `<div style="display:flex;justify-content:space-between;"><span><b>${esc(r.name)}</b>${member ? ' ⚜️' : ''}</span><span style="color:${hc};">hostility ${r.hostility}</span></div>`;
            html += `<div style="font-size:11px;color:#bbb;">😨 fear ${r.fear} · 😒 envy ${r.envy} · 🗡️ grudge ${r.grudge}${r.vendetta >= 1 ? ` · 🩸 blood feud ${Math.round(r.vendetta)}${r.generations ? ` (${r.generations} gen.)` : ''}` : ''} · ${Math.round((r.prox || 0) * 100)}% near</div>`;
            if (r.reasons && r.reasons.length) html += `<div style="font-size:11px;color:#999;font-style:italic;">${esc(r.reasons.join('; '))}</div>`;
            html += '</div>';
        }

        // ── Rival agents ──
        const agents = RivalAgents.known(player);
        const st = RivalAgents.state(player);
        html += `<div style="${HEAD}">Rival agents in your towns</div>`;
        if (!agents.length) html += `<div style="color:#aaa;">None known by name. Rival Houses buy townsfolk where you hold land and works — listen to the towns' news, keep a spymaster and idle spies, post counter-espionage, and ask around.</div>`;
        for (const a of agents) {
            const K = RivalAgents.kind(a.kind);
            html += `<div style="${CARD}">`;
            html += `<div>${K.icon} <b>${esc(a.name)}</b>, ${esc(a.role)} of ${esc(a.town)} — ${esc(K.label.toLowerCase())} of ${esc(a.rivalName)}${a.turned ? ' <span style="color:#7fd07f;">(turned: yours now)</span>' : ''}</div>`;
            html += `<div style="font-size:11px;color:#999;">In their pay since about day ${a.day}${a.acts ? `; ${a.acts} time${a.acts > 1 ? 's' : ''} they have done their master's work` : ''}${a.knownDay ? `; found out day ${a.knownDay}` : ''}.</div>`;
            if (!a.turned) {
                const cost = RivalAgents.turnCost(player, a);
                html += _btn(`💰 Turn (${cost}g)`, 'turn', [a.id], BTN_GOLD, gold >= cost, 'They feed their master false word and tell you of its plots.');
                html += _btn('📢 Expose', 'expose', [a.id], BTN_RED, true, 'Named a traitor and driven out; the rival is shamed — and angrier.');
            }
            html += '</div>';
        }
        const tile = world.getTile ? world.getTile(player.q, player.r) : null;
        if (tile && tile.settlement) {
            const inq = RivalAgents.config().inquiry;
            html += _btn(`🍺 Ask around ${esc(tile.settlement.name)} (${inq.gold}g)`, 'inquire', [player.q, player.r], BTN_DARK, gold >= inq.gold, 'Loosen tongues: anyone here in a rival\'s pay is likelier to be found out.');
        }
        const s = st.stats;
        if (s.exposed || s.turned || s.sabotaged) html += `<div style="font-size:11px;color:#999;margin-top:4px;">Exposed ${s.exposed} · turned ${s.turned} · sabotage suffered ${s.sabotaged}</div>`;
        if (st.log.length) html += `<div style="font-size:11px;color:#888;margin-top:4px;">${st.log.slice(0, 4).map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;

        // ── Past leagues ──
        if (v.history && v.history.length) {
            html += `<div style="${HEAD}">Past leagues</div>`;
            const L = v.stats || {};
            html += `<div style="font-size:11px;color:#999;">Sworn ${L.formed || 0} · broken ${L.broken || 0} · appeased ${L.appeased || 0} · disbanded ${L.humbled || 0} · members bought ${L.boughtOff || 0}, wed ${L.married || 0}, given towns ${L.ceded || 0} · terms defied ${L.defied || 0}</div>`;
            for (const h of v.history.slice(0, 5)) {
                html += `<div style="font-size:11px;color:#bbb;padding:2px 0;">⚜️ <b>${esc(h.name)}</b> (${esc(h.members.join(', '))}), day ${h.formed}–${h.ended}: ${HOW[h.how] || h.how}</div>`;
            }
        }
        html += '</div>';
        game.ui.showCustomPanel('⚜️ Threats', html);
    },

    /** The Threats panel's buttons (data-am-act="threatsAct"). */
    threatsAct(game, action, ...args) {
        const player = game.player;
        const world = game.world;
        let res;
        if (action === 'concede') res = Coalitions.concede(player, world, args[0]);
        else if (action === 'defy') res = Coalitions.defy(player, world);
        else if (action === 'split') res = Coalitions.splitMember(player, world, args[0], args[1], args[2] || null);
        else if (action === 'turn') res = RivalAgents.turn(player, world, args[0]);
        else if (action === 'expose') res = RivalAgents.expose(player, world, args[0]);
        else if (action === 'inquire') res = RivalAgents.inquire(player, world, args[0], args[1]);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('⚜️ Threats', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        for (const n of res.notices || []) game.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
        game.ui.updateStats(player, world);
        ActionMenu.showThreatsPanel(game, { html: esc(res.text || 'Done.'), color: 'rgba(127,208,127,0.4)' });
    },
});
