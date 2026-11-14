// ActionMenu — Threats: where the player's enemies stand. The power the
// realms see in you (and the marks at which they worry and band together),
// each realm's fear, envy and grudge (blood feuds down the generations), the
// league sworn against you with its terms and members — buy one out, seal a
// match, cede a town, pay or bow to the whole, or throw the terms back — and
// the rival Houses' agents you have unmasked in your towns (turn them or
// expose them; ask around a town to find them). Logic lives in
// systems/coalitions.js and systems/rivalAgents.js; this panel presents it.
// The action menu's voice (uiKit.js): every move a row through threatsAct,
// its cost at the right, greyed with the reason.
import { ActionMenu } from './_ref.js';
import { Coalitions } from '../../systems/coalitions.js';
import { RivalAgents } from '../../systems/rivalAgents.js';
import { esc, bullets, lede, chips, card, rowList, sectionHead, more, price, purse } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';

const PART_LABELS = {
    towns: '🏰 Towns held', properties: '🏭 Properties', crown: '👑 Crown', title: '🏅 Office', army: '⚔️ Army',
    wealth: '💰 Wealth', prestige: '⭐ Prestige', renown: '📣 Renown', conquests: '🔥 Recent conquests',
};
const HOW = { appeased: '🕊️ appeased', humbled: '🏳️ disbanded (you were cut down)', broken: '🏆 broken' };
const CB_ICON = { vendetta: '🔴', conquest: '🔥', crown: '👑', power: '⚖️' };
const MUTED = 'font-size:11px; color:#a99a78;';

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:3px 0;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

/** A move as a row routed through threatsAct: live when ok, greyed with the reason otherwise. */
function _row(icon, name, desc, action, args, ok = true, why = '', side = '', tone = '') {
    return { icon, name, desc, side, tone, off: !ok, why: why || desc, act: 'threatsAct', args: [action, ...args] };
}

/** "🏰 Towns held" → a chip ['🏰', 'Towns held', n]. */
function _partChip(key, n) {
    const L = PART_LABELS[key] || key;
    const sp = L.indexOf(' ');
    return sp > 0 ? [L.slice(0, sp), L.slice(sp + 1), Math.round(n)] : ['', L, Math.round(n)];
}

function _powerCard(world, v) {
    const p = v.power || { score: 0, parts: {} };
    const color = p.score >= v.form ? '#e06060' : p.score >= v.concern ? '#f5c542' : '#7fd07f';
    let pw = _bar(p.score, v.form, color);
    pw += `<div style="${MUTED}">The realms start to watch at ${v.concern}; held past ${v.form} for ${Coalitions.config().brewWeeks} weeks, they may swear a league against you. ${p.day != null ? `Last reckoned on day ${p.day}.` : 'Reckoned weekly.'}</div>`;
    const parts = Object.entries(p.parts || {}).filter(([, n]) => n > 0);
    if (parts.length) pw += chips(parts.map(([k, n]) => _partChip(k, n)));
    if (!v.active && v.pressure > 0) pw += `<div style="color:#f5c542;">🕊️ Envoys ride between the courts: ${v.pressure} week${v.pressure > 1 ? 's' : ''} of talk of a league${v.primed && p.score < v.form ? ' (the courts have tired of your rise: lesser grudges will serve)' : ''}.</div>`;
    else if (!v.active && v.clock > 0.05) pw += `<div style="${MUTED}">⏳ The courts' patience with your rise: ${Math.round((1 - v.clock) * 100)}% left. The mightier you grow, the faster it wears.</div>`;
    if (!v.active && v.cooldownUntil > (world.day || 0)) pw += `<div style="${MUTED}">The last league's memory is fresh: none will be sworn before day ${v.cooldownUntil}.</div>`;
    return card(pw, { icon: '⚖️', title: 'Your power in the courts\' eyes', side: `<b style="color:${color};">${Math.round(p.score)}</b> / ${v.form}` });
}

function _leagueHtml(player, world, v, gold) {
    const c = v.active;
    const members = Coalitions.members(player);
    let lg = `<div style="${MUTED}">Against ${esc(c.target)} · led by ${esc(c.leaderName)} · ${c.stage === 'forming' ? `<span style="color:#f5c542;">terms open until day ${c.dueDay}</span>` : '<span style="color:#e06060;">at war</span>'} · sworn day ${c.formed}${c.generation && player.house && c.generation < (player.house.generation || 1) ? ' · against your forebear' : ''}</div>`;
    lg += `<div style="font-style:italic; margin:3px 0;">${CB_ICON[c.cb] || ''} “${esc(c.casusBelli)}”</div>`;
    if (c.stage === 'active' && Number.isFinite(c.activeDay)) lg += `<div style="${MUTED}">At war since day ${c.activeDay}.</div>`;
    lg += `<div style="${MUTED}">Resolve ${Math.round(Math.max(0, c.resolve))}</div>${_bar(c.resolve, 100, '#e06060')}`;
    const levy = Math.round(Coalitions.config().embargoLevy * 100);
    lg += bullets(c.stage === 'forming' ? [
        `While its terms stand, only ${esc(c.leaderName)}'s lord refuses to receive you; the other members still trade and talk.`,
        `If it marches, its members levy ${levy}% on what you sell in their towns, cancel your licences, and none of their lords will receive you.`,
        'Splitting its members now, before it marches, is cheaper than breaking it in the field.',
    ] : [
        `Its members levy ${levy}% on what you sell in their towns, cancel your licences, and their lords will not receive you.`,
        'Breaking their hosts, outlasting them, and splitting them wears its resolve down; your growth hardens it.',
    ]);
    const q = v.quote;
    const prestige = (player.house && player.house.prestige) || 0;
    lg += rowList([
        _row('💰', 'Pay the league', 'Every member stands down; the courts see you bend.', 'concede', ['gold'], gold >= q.gold, `Needs ${q.gold}g.`, price(q.gold, gold >= q.gold)),
        _row('🙇', 'Bow', 'Every member stands down; your House pays in Prestige.', 'concede', ['prestige'], prestige >= q.prestige, `Needs ⭐${q.prestige} Prestige.`, `⭐ ${q.prestige}`),
        c.stage === 'forming' ? _row('⚔️', 'Throw their terms back', 'War from every member at once.', 'defy', [], true, '', '', 'bad') : null,
    ], 'Answer the whole league');
    const gone = Object.values(c.members || {}).filter(m => m.left);
    if (gone.length) lg += `<div style="${MUTED}">Gone from it: ${gone.map(m => `${esc(m.name)} (${esc(m.why || 'left')}${Number.isFinite(m.leftDay) ? `, day ${m.leftDay}` : ''})`).join('; ')}</div>`;
    if (Array.isArray(c.log) && c.log.length) {
        lg += more('The league\'s doings', `<div style="${MUTED}">${c.log.slice(-4).reverse().map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`);
    }
    let html = card(lg, { icon: '⚜️', title: esc(c.name), side: c.stage === 'forming' ? 'forming' : 'at war', tone: 'bad' });

    // Split it: each member bought out, wed away, or given a town
    const kids = Coalitions.marriageable(player);
    const cedable = Coalitions.cedable(player, world);
    for (const m of members) {
        const k = world.getKingdom(m.kingdomId);
        const a = v.realms.find(r => r.kingdomId === m.kingdomId);
        const cost = Coalitions.buyOffPrice(player, world, m.kingdomId);
        const war = [m.war === 'holdings' ? 'war on your holdings' : null, m.realmWar ? 'war on your realm' : null].filter(Boolean).join(', ') || (c.stage === 'active' ? 'levies only' : 'waiting');
        let army = '';
        if (k) {
            const seen = RealmIntel.seen(player, world, k, 'military', 'military', k.military || 0, typeof player.knowsAbout !== 'function' || player.knowsAbout(k.id, 'military'));
            army = seen.exact ? seen.text : esc(seen.text);
        }
        const rows = [
            _row('💰', 'Buy out', 'They leave the league and make peace with you.', 'split', [m.kingdomId, 'gold', ''], gold >= cost, `Needs ${cost}g.`, price(cost, gold >= cost)),
            ...kids.slice(0, 2).map(child => _row('💍', `Wed ${esc(child.firstName)} into ${esc(m.name)}`, 'A match seals their leaving.', 'split', [m.kingdomId, 'marriage', child.id])),
            ...cedable.slice(0, 2).map(h => _row('🏰', `Cede ${esc(h.name)}`, 'A town of yours to them; they leave the league and remember the gift.', 'split', [m.kingdomId, 'cede', `${h.q},${h.r}`], true, '', '', 'bad')),
        ];
        html += rowList(rows, `${m.leader ? '👑 ' : ''}${esc(m.name)} — ${war}${army ? ` · army ${army}` : ''}${a ? ` · hostility ${a.hostility}` : ''}`);
    }
    return html;
}

function _agentsHtml(player, world, gold) {
    const agents = RivalAgents.known(player);
    const st = RivalAgents.state(player);
    let html = sectionHead('Rival agents in your towns');
    if (!agents.length) html += `<div style="${MUTED}">None known by name. Rival Houses buy townsfolk where you hold land and works: keep a spymaster and idle spies, post counter-espionage, and ask around.</div>`;
    for (const a of agents) {
        const K = RivalAgents.kind(a.kind);
        const rows = [{
            icon: K.icon, name: `${esc(a.name)}, ${esc(a.role)} of ${esc(a.town)}`,
            desc: `${esc(K.label)} of ${esc(a.rivalName)} · in their pay since about day ${a.day}${a.acts ? `, ${a.acts} deed${a.acts > 1 ? 's' : ''} done` : ''}${a.knownDay ? ` · found out day ${a.knownDay}` : ''}`,
            side: a.turned ? 'turned: yours' : '', tone: a.turned ? 'good' : 'bad',
        }];
        if (!a.turned) {
            const cost = RivalAgents.turnCost(player, a);
            rows.push(_row('💰', 'Turn them', 'They feed their master false word and tell you of its plots.', 'turn', [a.id], gold >= cost, `Needs ${cost}g.`, price(cost, gold >= cost)));
            rows.push(_row('📢', 'Expose them', 'Named a traitor and driven out; the rival is shamed — and angrier.', 'expose', [a.id], true, '', '', 'bad'));
        }
        html += rowList(rows);
    }
    const tile = world.getTile ? world.getTile(player.q, player.r) : null;
    if (tile && tile.settlement) {
        const inq = RivalAgents.config().inquiry;
        html += rowList([_row('🍺', `Ask around ${esc(tile.settlement.name)}`, 'Loosen tongues: anyone here in a rival\'s pay is likelier to be found out.', 'inquire', [player.q, player.r], gold >= inq.gold, `Needs ${inq.gold}g.`, price(inq.gold, gold >= inq.gold))]);
    }
    const s = st.stats;
    // The rival Houses' work against you so far (RivalAgents.tally: bought, leaks, sabotage, exposed, turned, inquiries)
    const tally = typeof RivalAgents.tally === 'function' ? RivalAgents.tally(player, world) : null;
    if (tally && (tally.recruited || tally.leaks || tally.inquiries || tally.turned || tally.exposed || tally.sabotaged)) {
        html += `<div style="${MUTED} margin-top:4px;">Agents against you so far: ${esc(tally.text)}</div>`;
        const serving = (tally.serving || []).filter(a => a.days != null);
        if (serving.length) html += `<div style="${MUTED} color:#9fd89f;">Turned and serving you: ${serving.map(a => `${esc(a.name)} (against ${esc(a.rivalName)}, ${a.days} day${a.days === 1 ? '' : 's'})`).join('; ')}</div>`;
    } else if (s.exposed || s.turned || s.sabotaged) html += `<div style="${MUTED} margin-top:4px;">Exposed ${s.exposed} · turned ${s.turned} · sabotage suffered ${s.sabotaged}</div>`;
    if (st.log.length) html += more('Lately', `<div style="${MUTED}">${st.log.slice(0, 4).map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`);
    return html;
}

function _pastHtml(v) {
    if (!v.history || !v.history.length) return '';
    const L = v.stats || {};
    let html = sectionHead('Past leagues');
    html += chips([['', 'Sworn', L.formed || 0], ['', 'Broken', L.broken || 0], ['', 'Appeased', L.appeased || 0], ['', 'Disbanded', L.humbled || 0], ['', 'Bought out', L.boughtOff || 0], ['', 'Wed', L.married || 0], ['', 'Towns given', L.ceded || 0], ['', 'Terms defied', L.defied || 0]]);
    html += rowList(v.history.slice(0, 5).map(h => {
        const sub = [];
        if (h.casusBelli) sub.push(`${CB_ICON[h.cb] || ''} sworn “${esc(h.casusBelli)}”`.trim());
        if (h.via === 'pressure') sub.push('the courts tired of your rise');
        sub.push(Number.isFinite(h.activeDay) ? `marched day ${h.activeDay}` : 'never marched');
        if (Array.isArray(h.left) && h.left.length) sub.push(`left early: ${h.left.map(m => `${esc(m.name)} (${esc(m.why)}${Number.isFinite(m.day) ? `, day ${m.day}` : ''})`).join('; ')}`);
        return {
            icon: '⚜️', name: `${esc(h.name)} <span style="${MUTED}">(${esc((h.members || []).join(', '))})</span>`,
            desc: `${HOW[h.how] || esc(h.how)}${h.why ? ` — ${esc(h.why)}` : ''}`,
            note: `<span style="${MUTED}">${sub.join(' · ')}</span>`,
            side: `<span style="${MUTED}">day ${h.formed}–${h.ended}</span>`,
        };
    }));
    return html;
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
        if (message) html += card(message.html, { tone: 'good' });
        html += lede('Who is set against you: how the realms measure your power, the league they may swear, and the rival Houses\' agents in your towns.');
        html += chips([purse(gold), player.house ? ['⭐', 'Prestige', player.house.prestige || 0] : null]);
        html += _powerCard(world, v);
        if (v.active) html += _leagueHtml(player, world, v, gold);

        // ── The realms' regard ──
        if (!v.realms.length) html += sectionHead('The realms\' regard') + `<div style="${MUTED}">The courts have not yet taken your measure (it is done weekly).</div>`;
        else {
            const c = v.active;
            html += rowList(v.realms.slice(0, 10).map(r => {
                const member = c && Coalitions.isMember(player, r.kingdomId);
                const tone = r.hostility >= v.joinAt ? 'bad' : r.hostility >= v.joinAt / 2 ? 'warn' : 'good';
                return {
                    icon: member ? '⚜️' : '🏰', name: esc(r.name),
                    desc: `😨 fear ${r.fear} · 😒 envy ${r.envy} · 🗡️ grudge ${r.grudge}${r.vendetta >= 1 ? ` · 🔴 blood feud ${Math.round(r.vendetta)}${r.generations ? ` (${r.generations} gen.)` : ''}` : ''} · ${Math.round((r.prox || 0) * 100)}% near`,
                    note: r.reasons && r.reasons.length ? `<span style="${MUTED} font-style:italic;">${esc(r.reasons.join('; '))}</span>` : '',
                    side: `hostility ${r.hostility}`, tone,
                };
            }), `The realms' regard · a league draws on realms past ${v.joinAt}`);
        }

        html += _agentsHtml(player, world, gold);
        html += _pastHtml(v);
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
