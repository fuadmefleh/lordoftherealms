// ActionMenu — the whispering corner of a tavern: the tales about the great
// told here (fan, quash, dig for the truth, blackmail, sell), the talk about
// the player as it is told in this town (and a bard to sing it down), a tale
// of the player's own to start, and how past tales ended. Logic lives in
// systems/whispers.js and systems/gossip.js; this panel presents it.
// The action menu's voice (uiKit.js): a card a tale, its moves as rows (cost
// at the right, greyed with the reason).
import { ActionMenu } from './_ref.js';
import { Gossip } from './_imports.js';
import { Whispers } from '../../systems/whispers.js';
import { BTN_GOLD, BTN_OFF, lede, chips, card, rowList, sectionHead, more, price, purse, esc } from './uiKit.js';

const OUTCOME = { proven: ['🔥', 'bad', 'Proven'], debunked: ['🕊️', 'good', 'Debunked'], faded: ['🌫️', '', 'Forgotten'], buried: ['🤐', 'warn', 'Bought silent'] };
const MUTED = 'font-size:11px; color:#a99a78;';
const SELECT = 'max-width:100%; margin:2px 4px 6px 0; padding:4px 6px; background:rgba(0,0,0,0.3); border:1px solid rgba(245,197,66,0.22); border-radius:6px; color:#ece2c8;';

function _heatBar(heat) {
    const color = heat >= 70 ? '#e05050' : heat >= 40 ? '#e0a040' : '#c5b358';
    return `<span title="Heat ${heat}/100: how hotly it is told" style="display:inline-block; width:70px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; vertical-align:middle; overflow:hidden;">`
        + `<span style="display:block; height:100%; width:${Math.max(3, heat)}%; background:${color};"></span></span>`;
}

/** A move on a tale as a row: live when `ok`, greyed with `why` otherwise. */
function _move(ok, icon, name, desc, call, cost, gold, why, tone = '') {
    return { icon, name, desc, side: cost != null ? price(cost, gold >= cost) : '', off: !ok, why, attrs: ok ? `onclick="${call}"` : '', tone };
}

function _taleCard(v, gold) {
    const truth = v.truthKnown ? (v.truth ? '<span style="color:#e08080;">✔ true — you know it</span>' : '<span style="color:#9fd89f;">✘ a lie — you know it</span>') : 'truth unknown';
    const mine = v.planted ? 'your tale' : v.fanned ? 'you fanned it' : '';
    let body = `<div style="font-style:italic; margin:2px 0 4px;">“${esc(v.text)}”</div>`;
    body += `<div style="${MUTED}">${_heatBar(v.heat)} heat ${v.heat} · told in ${v.towns} town${v.towns === 1 ? '' : 's'} · fades in ${v.daysLeft} days · ${truth}${mine ? ` · <span style="color:#c9a0ff;">${mine}</span>` : ''}</div>`;
    if (v.hotDays > 0) body += `<div style="${MUTED} color:#e0a040;">Running hot ${v.hotDays}/${v.hardenDays} days: kept hot that long, a lie is either believed for good or debunked.</div>`;
    const rows = [
        _move(v.can.fan, '🔥', 'Fan it', 'Tell it louder here', `window._whispers.act('fan', ${v.id})`, v.costs.fan, gold, 'Not told here, or not enough gold'),
        _move(v.can.quash, '🤫', 'Quash it', `Pay to hush it (only in ${esc(v.kingdomName)})`, `window._whispers.act('quash', ${v.id})`, v.costs.quash, gold, `Only in ${esc(v.kingdomName)}, and it costs ${v.costs.quash}g`),
    ];
    if (!v.truthKnown) rows.push(_move(v.can.dig, '🔍', 'Dig for the truth', 'Ask the right people', `window._whispers.act('dig', ${v.id})`, v.costs.dig, gold, 'Asked already today, or not enough gold'));
    if (v.subjectType === 'ruler' && v.truthKnown && v.truth) {
        rows.push(_move(v.can.blackmail, '✉️', 'Blackmail', `Gold to keep quiet (about ${v.blackmailGold}g)`, `window._whispers.act('blackmail', ${v.id})`, null, gold, `You must be in ${esc(v.kingdomName)}`, 'bad'));
        for (const b of v.buyers) rows.push(_move(v.can.sell, '📜', `Sell the proof to ${esc(b.name)}`, `About ${v.sellGold}g`, `window._whispers.sell(${v.id}, '${esc(b.id)}')`, null, gold, 'Not possible here', 'bad'));
    }
    body += rowList(rows);
    return card(body, { icon: v.icon, title: `${esc(v.label)}: ${esc(v.subject)}`, side: v.subjectType === 'ruler' ? esc(v.kingdomName) : 'adventurer' });
}

Object.assign(ActionMenu, {
    /** The whispering corner (tavern → 'The whispering corner'). */
    showWhispersPanel(game, tile, message = null) {
        const player = game.player;
        const world = game.world;
        const { q, r } = tile;
        const gold = player.gold || 0;
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        if (message) html += card(message.html, { tone: message.color ? 'bad' : 'gold' });
        html += lede('A corner table, a guttering candle, people talking low. The great are talked about here, and so are you. Some of it is true.');
        html += chips([purse(gold)]);

        // Tales about the great told in this town
        const tales = Whispers.listenAt(player, q, r);
        html += sectionHead('Tales told here');
        if (!tales.length) html += lede(`Nothing about the great is going round ${esc(tile.settlement.name)} just now.`);
        for (const sc of tales) html += _taleCard(Whispers.view(player, world, sc, q, r), gold);

        // Talk about the player, as it is told here
        const talk = Gossip.getTavernGossip(player, q, r, world);
        const bard = Whispers.config().bard.cost;
        if (!talk.length) html += sectionHead('Talk of you') + lede('Nobody here is talking about you. Yet.');
        else {
            html += rowList(talk.map(t => {
                const meta = [esc(t.freshness), t.telling ? `told here as: <span style="color:#e0b040;">${esc(t.telling.label)}</span>` : '', t.hasBounty ? `<span style="color:#e08080;">bounty ${t.bountyGold}g</span>` : ''].filter(Boolean).join(' · ');
                if (!t.refutable) return { icon: t.icon || '🗣️', name: `“${esc(t.text)}”`, desc: meta };
                const ok = gold >= bard;
                return { icon: t.icon || '🗣️', name: `“${esc(t.text)}”`, desc: meta, note: '🎻 Pay a bard to sing it down', side: price(bard, ok), off: !ok, why: `${meta} · the bard wants ${bard}g`, attrs: ok ? `onclick="window._whispers.sing(${t.id})"` : '' };
            }), 'Talk of you');
        }

        // Start a tale of your own
        const targets = Whispers.plantTargets(player, world);
        const kinds = Whispers.kinds();
        const cost = Whispers.config().plant.cost;
        html += sectionHead('Start a tale');
        let start = `<div style="${MUTED} margin-bottom:6px;">Keep a lie red-hot for ${Whispers.config().harden.days} days and it is either believed for good (likelier the more of the realm tells it) or debunked. Traced back to you, the talk turns on you.</div>`;
        if (!targets.length) {
            start += `<div style="${MUTED}">There is no one worth talking about.</div>`;
        } else {
            start += `<select id="whispers-target" onchange="window._whispers.kinds()" style="${SELECT}" aria-label="About whom">`;
            targets.forEach((t, i) => { start += `<option value="${i}">${esc(t.name)}${t.realm ? ` (${esc(t.realm)})` : ' (adventurer)'}</option>`; });
            start += `</select><select id="whispers-kind" style="${SELECT}" aria-label="What tale"></select><br>`;
            start += gold >= cost
                ? `<button onclick="window._whispers.plant()" style="${BTN_GOLD}">🕯️ Start the tale (${cost}g)</button>`
                : `<button disabled title="It costs ${cost}g to set tongues wagging" style="${BTN_OFF}">🕯️ Start the tale (${cost}g)</button>`;
        }
        html += card(start);

        // How tales ended, and the player's tallies
        const done = Whispers.record(player, 6);
        const ws = Whispers.stats(player);
        if (done.length || Object.values(ws).some(n => n > 0)) {
            let past = rowList(done.map(d => {
                const [icon, tone, word] = OUTCOME[d.state] || OUTCOME.faded;
                const mine = d.planted || d.fanned ? `${d.planted ? 'your tale' : 'you fanned it'}${d.hardened ? ', a lie now believed' : ''}${d.traced ? ', traced to you' : ''}` : '';
                return { icon, name: esc(d.text), desc: mine, side: `${word} <span style="${MUTED}">· day ${d.day}</span>`, tone };
            }));
            if (Object.values(ws).some(n => n > 0)) {
                past += chips([['🕯️', 'Planted', ws.planted], ['🔥', 'Fanned', ws.fanned], ['🤫', 'Quashed', ws.quashed], ['✔', 'Lies believed', ws.hardened], ['🕊️', 'Debunked', ws.debunked], ['👣', 'Traced to you', ws.traced], ['✉️', 'Blackmailed', ws.blackmailed], ['📜', 'Proofs sold', ws.sold]].filter(c => c[2] > 0));
            }
            html += more('How the tales ended', past);
        }
        html += '</div>';

        const reopen = (res) => {
            if (!res.ok) {
                game.ui.showNotification('🕯️ Whispers', res.reason, 'error');
                return;
            }
            game.ui.updateStats(player, world);
            const bad = res.refused || res.noticed;
            ActionMenu.showWhispersPanel(game, tile, { html: `🕯️ ${esc(res.text)}`, color: bad ? 'rgba(224,80,80,0.5)' : null });
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
                out.innerHTML = (t ? t.kinds : []).map(k => `<option value="${k}">${(kinds[k] && kinds[k].icon) || ''} ${esc((kinds[k] && kinds[k].label) || k)}</option>`).join('');
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
