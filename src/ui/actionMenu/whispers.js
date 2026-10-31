// ActionMenu — the whispering corner of a tavern: the tales about the great
// told here (fan, quash, dig for the truth, blackmail, sell), the talk about
// the player as it is told in this town (and a bard to sing it down), a tale
// of the player's own to start, and how past tales ended. Logic lives in
// systems/whispers.js and systems/gossip.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Gossip } from './_imports.js';
import { Whispers } from '../../systems/whispers.js';
import { BTN_GOLD, BTN_PLAIN, BTN_RED, BTN_OFF, CARD } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px;';
const OUTCOME = { proven: ['🔥', '#e08080', 'Proven'], debunked: ['🕊️', '#7fd07f', 'Debunked'], faded: ['🌫️', '#999', 'Forgotten'], buried: ['🤐', '#c5b358', 'Bought silent'] };

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _btn(ok, label, call, style = BTN_GOLD, why = '') {
    return ok ? `<button onclick="${call}" style="${style}">${label}</button>` : `<button disabled title="${_esc(why)}" style="${BTN_OFF}">${label}</button>`;
}

function _heatBar(heat) {
    const color = heat >= 70 ? '#e05050' : heat >= 40 ? '#e0a040' : '#c5b358';
    return `<span title="Heat ${heat}/100" style="display:inline-block; width:90px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; vertical-align:middle; overflow:hidden;">`
        + `<span style="display:block; height:100%; width:${Math.max(3, heat)}%; background:${color};"></span></span>`;
}

function _taleCard(v) {
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold);">${v.icon} ${_esc(v.label)}: ${_esc(v.subject)}</strong>`;
    html += `<span style="color:#999; font-size:11px; white-space:nowrap;">${v.subjectType === 'ruler' ? _esc(v.kingdomName) : 'adventurer'}</span></div>`;
    html += `<div style="color:#ddd; font-style:italic; margin:4px 0;">"${_esc(v.text)}"</div>`;
    const truth = v.truthKnown ? (v.truth ? '<span style="color:#e08080;">✔ True. You know it.</span>' : '<span style="color:#7fd07f;">✘ A lie. You know it.</span>') : '<span style="color:#888;">Truth unknown</span>';
    html += `<div style="font-size:11px; color:#aaa;">${_heatBar(v.heat)} heat ${v.heat} · ${v.towns} town${v.towns === 1 ? '' : 's'} · ${v.daysLeft} days left · ${truth}${v.planted ? ' · <span style="color:#c9a0ff;">your tale</span>' : v.fanned ? ' · <span style="color:#c9a0ff;">you fanned it</span>' : ''}${v.hotDays > 0 ? ` · <span style="color:#e0a040;" title="Kept this hot for ${v.hardenDays} days, a lie comes to a reckoning: believed, or debunked">running hot ${v.hotDays}/${v.hardenDays} days</span>` : ''}</div>`;
    html += '<div style="margin-top:4px;">';
    html += _btn(v.can.fan, `🔥 Fan it (${v.costs.fan}g)`, `window._whispers.act('fan', ${v.id})`, BTN_PLAIN, 'Not told here, or not enough gold');
    html += _btn(v.can.quash, `🤫 Quash it (${v.costs.quash}g)`, `window._whispers.act('quash', ${v.id})`, BTN_PLAIN, `Only in ${v.kingdomName}, and it costs ${v.costs.quash}g`);
    if (!v.truthKnown) html += _btn(v.can.dig, `🔍 Dig for the truth (${v.costs.dig}g)`, `window._whispers.act('dig', ${v.id})`, BTN_PLAIN, 'Asked already today, or not enough gold');
    if (v.subjectType === 'ruler' && v.truthKnown && v.truth) {
        html += _btn(v.can.blackmail, `✉️ Blackmail (~${v.blackmailGold}g)`, `window._whispers.act('blackmail', ${v.id})`, BTN_RED, `You must be in ${v.kingdomName}`);
        for (const b of v.buyers) html += _btn(v.can.sell, `📜 Sell proof to ${_esc(b.name)} (~${v.sellGold}g)`, `window._whispers.sell(${v.id}, '${b.id}')`, BTN_RED);
    }
    html += '</div></div>';
    return html;
}

Object.assign(ActionMenu, {
    /** The whispering corner (tavern → 'The whispering corner'). */
    showWhispersPanel(game, tile, message = null) {
        const player = game.player;
        const world = game.world;
        const { q, r } = tile;
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">A corner table, a guttering candle, people talking low. The great are talked about here, and so are you. Some of it is true.</p>';

        // Tales about the great told in this town
        const tales = Whispers.listenAt(player, q, r);
        html += `<div style="${HEAD} color: var(--gold);">Tales Told Here</div>`;
        if (!tales.length) html += `<div style="${CARD} color:#999;">Nothing about the great is going round ${_esc(tile.settlement.name)} just now.</div>`;
        for (const sc of tales) html += _taleCard(Whispers.view(player, world, sc, q, r));

        // Talk about the player, as it is told here
        const talk = Gossip.getTavernGossip(player, q, r, world);
        const bard = Whispers.config().bard.cost;
        html += `<div style="${HEAD} color:#9ab;">Talk of You</div>`;
        if (!talk.length) html += `<div style="${CARD} color:#999;">Nobody here is talking about you. Yet.</div>`;
        for (const t of talk) {
            html += `<div style="${CARD}"><div>${t.icon || '🗣️'} <span style="color:#ddd;">"${_esc(t.text)}"</span></div>`;
            html += `<div style="font-size:11px; color:#999;">${_esc(t.freshness)}${t.telling ? ` · told here as: <span style="color:#e0b040;">${_esc(t.telling.label)}</span>` : ''}${t.hasBounty ? ` · <span style="color:#e08080;">bounty ${t.bountyGold}g</span>` : ''}</div>`;
            if (t.refutable) html += _btn((player.gold || 0) >= bard, `🎻 Pay a bard to sing it down (${bard}g)`, `window._whispers.sing(${t.id})`, BTN_PLAIN, `The bard wants ${bard}g`);
            html += '</div>';
        }

        // Start a tale of your own
        const targets = Whispers.plantTargets(player, world);
        const kinds = Whispers.kinds();
        const cost = Whispers.config().plant.cost;
        html += `<div style="${HEAD} color:#c9a0ff;">Start a Tale</div>`;
        html += `<div style="${CARD}"><div style="color:#aaa; margin-bottom:4px;">Say it loud enough, in enough taverns, and it becomes true, or near enough: keep a lie red-hot for ${Whispers.config().harden.days} days and it is either believed for good (likelier the more of the realm tells it and the shakier its subject) or debunked. If it's traced back to you, the talk will be about you instead.</div>`;
        if (!targets.length) {
            html += '<div style="color:#888;">There is no one worth talking about.</div>';
        } else {
            html += '<select id="whispers-target" onchange="window._whispers.kinds()" style="max-width:100%; margin:2px 4px 2px 0;">';
            targets.forEach((t, i) => { html += `<option value="${i}">${_esc(t.name)}${t.realm ? ` (${_esc(t.realm)})` : ' (adventurer)'}</option>`; });
            html += '</select><select id="whispers-kind" style="max-width:100%; margin:2px 4px 2px 0;"></select>';
            html += `<br>${_btn((player.gold || 0) >= cost, `🕯️ Start the tale (${cost}g)`, 'window._whispers.plant()', BTN_GOLD, `It costs ${cost}g to set tongues wagging`)}`;
        }
        html += '</div>';

        // How tales ended
        const done = Whispers.record(player, 6);
        if (done.length) {
            html += `<div style="${HEAD} color:#999;">How the Tales Ended</div>`;
            for (const d of done) {
                const [icon, color, word] = OUTCOME[d.state] || OUTCOME.faded;
                html += `<div style="padding:3px 0; color:#bbb;"><span style="color:${color};">${icon} ${word}</span> <span style="color:#777; font-size:10px;">day ${d.day}</span> ${_esc(d.text)}${d.planted || d.fanned ? ` <span style="color:#c9a0ff; font-size:10px;">(${d.planted ? 'your tale' : 'you fanned it'}${d.hardened ? ', a lie now believed' : ''}${d.traced ? ', traced to you' : ''})</span>` : ''}</div>`;
            }
        }

        // The player's tallies
        const ws = Whispers.stats(player);
        if (Object.values(ws).some(n => n > 0)) {
            html += `<div style="margin-top:8px; font-size:10px; color:#888;">Your whispering: ${ws.planted} planted · ${ws.fanned} fanned · ${ws.quashed} quashed · ${ws.hardened} lies believed · ${ws.debunked} debunked · ${ws.traced} traced to you · ${ws.blackmailed} blackmailed · ${ws.sold} proofs sold</div>`;
        }
        html += '</div>';

        const reopen = (res) => {
            if (!res.ok) {
                game.ui.showNotification('🕯️ Whispers', res.reason, 'error');
                return;
            }
            game.ui.updateStats(player, world);
            const bad = res.refused || res.noticed;
            ActionMenu.showWhispersPanel(game, tile, { html: `🕯️ ${_esc(res.text)}`, color: bad ? 'rgba(224,80,80,0.5)' : null });
        };
        window._whispers = {
            act: (what, id) => {
                if (what === 'fan') reopen(Whispers.fan(player, world, id, q, r));
                else if (what === 'quash') reopen(Whispers.quash(player, world, id, q, r));
                else if (what === 'dig') reopen(Whispers.dig(player, world, id));
                else if (what === 'blackmail') reopen(Whispers.blackmail(player, world, id, q, r));
            },
            sell: (id, buyerId) => reopen(Whispers.sell(player, world, id, buyerId)),
            sing: (rumorId) => reopen(Whispers.singDown(player, world, rumorId, q, r)),
            kinds: () => {
                const sel = document.getElementById('whispers-target');
                const out = document.getElementById('whispers-kind');
                if (!sel || !out) return;
                const t = targets[Number(sel.value)];
                out.innerHTML = (t ? t.kinds : []).map(k => `<option value="${k}">${(kinds[k] && kinds[k].icon) || ''} ${_esc((kinds[k] && kinds[k].label) || k)}</option>`).join('');
            },
            plant: () => {
                const sel = document.getElementById('whispers-target');
                const kind = document.getElementById('whispers-kind');
                const t = sel && targets[Number(sel.value)];
                if (!t || !kind || !kind.value) return;
                reopen(Whispers.plant(player, world, { ...t, kind: kind.value }, q, r));
            },
        };
        game.ui.showCustomPanel(`🕯️ The Whispering Corner — ${tile.settlement.name}`, html);
        window._whispers.kinds();
    },
});
