// ActionMenu — rival adventurers: meet them in town (talk, duel, team up,
// hire, race, sabotage) and the Hall of Heroes leaderboard. Logic lives in
// systems/rivals.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { Rivals } from './_imports.js';

const BTN = 'padding: 5px 8px; margin: 3px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DARK = BTN + 'background: #444; color: #eee;';
const BTN_RED = BTN + 'background: #7a2e2e; color: #fff;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _statBar(rival) {
    const s = rival.stats;
    return `⚔️ ${s.prowess} · 🧠 ${s.cunning} · 🙏 ${s.faith} · 💬 ${s.charm} · Lv ${rival.level}`;
}

Object.assign(ActionMenu, {
    /** Rivals resting in this settlement: talk, duel, team up, hire, race, sabotage. */
    showRivalsPanel(game, tile, message = null) {
        const player = game.player;
        const world = game.world;
        const here = Rivals.rivalsAt(player, world, tile.q, tile.r);
        let html = '<div style="max-height: 500px; overflow-y: auto; font-size: 12px;">';
        if (message) {
            html += `<div style="${CARD} border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;
        }
        if (!here.length) {
            html += '<div style="color:#aaa;">No adventurers are resting here now.</div>';
        }
        for (const r of here) {
            const att = Rivals.attitudeOf(r);
            const arch = Rivals.archetype(r.archetype);
            html += `<div style="${CARD}">`;
            html += `<div style="display:flex; justify-content:space-between;"><div><span style="font-size:16px;">${r.icon}</span> <b>${_esc(r.name)}</b> <span style="color:#aaa;">— ${_esc(arch.label)}</span></div>`;
            html += `<div style="color:${att.color};">${att.icon} ${_esc(att.label)} (${r.attitude})</div></div>`;
            html += `<div style="font-size:11px; color:#bbb; margin:2px 0;">⭐ ${r.renown} renown · ${_statBar(r)}${r.claimName ? ` · 👑 pretender to ${_esc(r.claimName)}` : ''}</div>`;
            if (r.memory.length) {
                const m = r.memory[0];
                html += `<div style="font-size:11px; color:#999; font-style:italic;">Remembers: you ${_esc(m.text)} (day ${m.day})</div>`;
            }
            const team = Rivals.canTeamUp(player, r);
            const hire = Rivals.canHire(player, r);
            html += '<div style="margin-top:4px;">';
            html += `<button onclick="window._rivals.talk('${r.id}')" style="${BTN_DARK}">💬 Talk</button>`;
            html += `<button onclick="window._rivals.duel('${r.id}', false)" style="${BTN_GOLD}">⚔️ Duel (${ActionMenu.getAPCost('rival_duel')} AP)</button>`;
            if (Rivals.willDuel(r, true)) html += `<button onclick="window._rivals.duel('${r.id}', true)" style="${BTN_RED}">💀 To the death</button>`;
            if (team.ok) html += `<button onclick="window._rivals.teamUp('${r.id}')" style="${BTN_DARK}">🤝 Team up (${Math.round(Rivals.config().teamUp.share * 100)}% share)</button>`;
            if (hire.ok) html += `<button onclick="window._rivals.hire('${r.id}')" style="${BTN_DARK}">💰 Hire (${hire.cost}g)</button>`;
            if (!Rivals.state(player).race) html += `<button onclick="window._rivals.race('${r.id}')" style="${BTN_DARK}">🏁 Race (${Rivals.config().race.wager}g)</button>`;
            html += `<button onclick="window._rivals.sabotage('${r.id}')" style="${BTN_RED}">🗡️ Sabotage (${Rivals.config().sabotage.cost}g, ${Math.round(Rivals.sabotageChance(player) * 100)}%)</button>`;
            html += '</div></div>';
        }
        html += `<button onclick="window._rivals.hall()" style="${BTN_DARK} width:100%;">🏆 Hall of Heroes</button>`;
        html += '</div>';

        const refresh = (msg) => {
            game.ui.updateStats(player, world);
            ActionMenu.showRivalsPanel(game, tile, msg);
        };
        const fail = (reason) => game.ui.showNotification('🗡️ Rivals', reason, 'error');
        const ap = (type) => ActionMenu.spendAP(player, type, game);

        window._rivals = {
            talk: (id) => {
                const res = Rivals.talk(player, world, id);
                if (!res.success) return fail(res.reason);
                const r = Rivals.get(player, id);
                refresh({ html: `${r.icon} <b>${_esc(r.name)}</b>: "${_esc(res.text)}"` });
            },
            duel: (id, toDeath) => {
                const r = Rivals.get(player, id);
                if (!r) return;
                if (!Rivals.willDuel(r, toDeath)) return fail(`${r.name}: "${Rivals.line(r, 'duelRefuse')}"`);
                if (!ap('rival_duel')) return;
                const res = Rivals.duel(player, world, id, { toDeath });
                if (!res.success) return fail(res.reason);
                let h = `${r.icon} <b>${_esc(r.name)}</b>: "${_esc(res.accept)}"<br>`;
                if (res.playerWon) {
                    h += res.rivalDied
                        ? `<span style="color:#7fd07f;">You cut ${_esc(r.name)} down. +${res.renown} renown, -${res.harm} health.</span>`
                        : `<span style="color:#7fd07f;">You win the duel! +${res.renown} renown, -${res.harm} health.</span>`;
                } else {
                    h += `<span style="color:#e08080;">You lose the duel. -${res.harm} health.</span>`;
                }
                if (res.after) h += `<br><i>"${_esc(res.after)}"</i>`;
                refresh({ html: h, color: res.playerWon ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.4)' });
            },
            teamUp: (id) => {
                const gate = Rivals.canTeamUp(player, Rivals.get(player, id));
                if (!gate.ok) return fail(gate.reason);
                if (!ap('rival_team_up')) return;
                const res = Rivals.teamUp(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🤝 "${_esc(res.text)}" — ${_esc(res.partner.name)} delves with you until day ${res.partner.until} (+${Math.round(res.partner.bonus * 100)}% to delve checks, ${Math.round(res.partner.share * 100)}% of the gold).` });
            },
            hire: (id) => {
                const gate = Rivals.canHire(player, Rivals.get(player, id));
                if (!gate.ok) return fail(gate.reason);
                if (!ap('rival_hire')) return;
                const res = Rivals.hire(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `💰 "${_esc(res.text)}" (-${res.cost}g; they join your army for ${Rivals.config().hire.days} days)` });
            },
            race: (id) => {
                if (!ap('rival_race')) return;
                const res = Rivals.race(player, world, id);
                if (!res.success) return fail(res.reason);
                const days = res.race.deadline - world.day;
                refresh({ html: `🏁 "${_esc(res.text)}" — the race is on to <b>${_esc(res.race.siteName)}</b> at (${res.race.q}, ${res.race.r}). They will be there in about ${days} days. Delve it first to take the ${res.race.wager * 2}g pot.` });
            },
            sabotage: (id) => {
                if (!ap('rival_sabotage')) return;
                const res = Rivals.sabotage(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🗡️ ${_esc(res.text)}`, color: res.caught ? 'rgba(224,96,96,0.4)' : 'rgba(127,208,127,0.4)' });
            },
            hall: () => ActionMenu.showHallOfHeroes(game, tile),
        };

        game.ui.showCustomPanel('🗡️ Adventurers Here', html);
    },

    /** The Hall of Heroes: renown leaderboard plus rival news. */
    showHallOfHeroes(game, tile) {
        const player = game.player;
        const world = game.world;
        const rows = Rivals.leaderboard(player, world);
        const st = Rivals.state(player);
        let html = '<div style="max-height: 520px; overflow-y: auto; font-size: 12px;">';
        html += '<table style="width:100%; border-collapse:collapse;">';
        for (const row of rows) {
            const bg = row.isPlayer ? 'background: rgba(245,197,66,0.12);' : '';
            html += `<tr style="${bg} border-bottom: 1px solid rgba(255,255,255,0.06);">`;
            html += `<td style="padding:4px; color:#aaa; width:22px;">${row.rank}.</td>`;
            html += `<td style="padding:4px;">${row.icon} <b>${_esc(row.name)}</b><div style="font-size:10px; color:#999;">${_esc(row.label)}${row.status ? ` · ${_esc(row.status)}` : ''}${row.claim ? ` · 👑 ${_esc(row.claim)}` : ''}</div></td>`;
            html += `<td style="padding:4px; text-align:right; color:var(--gold);">⭐ ${row.renown}</td>`;
            html += `<td style="padding:4px; text-align:right; color:${row.attitude ? row.attitude.color : '#ccc'}; font-size:11px;">${row.attitude ? `${row.attitude.icon} ${_esc(row.attitude.label)}` : ''}</td>`;
            html += '</tr>';
        }
        html += '</table>';

        const p = st.partner;
        const race = st.race;
        if (p || race) {
            html += `<div style="${CARD}">`;
            if (p) html += `<div>🤝 Delving partner: <b>${_esc(p.name)}</b> until day ${p.until}${p.earned ? ` (${p.earned}g taken so far)` : ''}</div>`;
            if (race) html += `<div>🏁 Racing ${_esc((Rivals.get(player, race.rivalId) || {}).name || 'a rival')} to <b>${_esc(race.siteName)}</b> (${race.q}, ${race.r}) — they arrive about day ${race.deadline}.</div>`;
            html += '</div>';
        }

        const s = st.stats;
        html += `<div style="font-size:11px; color:#999; margin:6px 0;">Duels ${s.duelsWon}–${s.duelsLost} · Races ${s.racesWon}–${s.racesLost} · Rivals slain ${s.slain}</div>`;

        html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 4px;">Tales of the Road</div>';
        const news = Rivals.news(player, 15);
        if (!news.length) html += '<div style="color:#888;">No word yet of the other adventurers.</div>';
        for (const n of news) {
            html += `<div style="padding:3px 0; color:#ccc;"><span style="color:#888; font-size:10px;">Day ${n.day}</span> ${n.icon} ${_esc(n.text)}</div>`;
        }
        const fallen = Rivals.fallen(player);
        if (fallen.length) {
            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin: 10px 0 4px;">The Fallen</div>';
            html += `<div style="color:#888; font-size:11px;">${fallen.map(r => `⚰️ ${_esc(r.name)} (day ${r.dead.day})`).join(' · ')}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🏆 Hall of Heroes', html);
    },
});
