// ActionMenu — rival adventurers: meet them in town (talk, duel, team up,
// hire, race, sabotage) and the Hall of Heroes leaderboard. Logic lives in
// systems/rivals.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { Rivals } from './_imports.js';
import { lede, chips, rowList, card, price, sectionHead } from './uiKit.js';
import { DuelPanel } from './duel.js';


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
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede(here.length
            ? 'Other adventurers resting here. They chase the same ruins and the same renown you do.'
            : 'No adventurers are resting here now.');
        const cfg = Rivals.config();
        const racing = !!Rivals.state(player).race;
        const gold = player.gold || 0;
        for (const r of here) {
            const att = Rivals.attitudeOf(r);
            const arch = Rivals.archetype(r.archetype);
            const team = Rivals.canTeamUp(player, r);
            const hire = Rivals.canHire(player, r);
            let body = `<div style="font-size:11px; color:#bbb; margin:0 0 2px;">${_esc(arch.label)} · ⭐ ${r.renown} renown · ${_statBar(r)}${r.claimName ? ` · 👑 pretender to ${_esc(r.claimName)}` : ''}</div>`;
            if (r.memory.length) body += `<div style="font-size:11px; color:#9d937c; font-style:italic;">Remembers: you ${_esc(r.memory[0].text)} (day ${r.memory[0].day})</div>`;
            const go = (fn, ...a) => `onclick="window._rivals.${fn}(${a.map(x => (typeof x === 'string' ? `'${x}'` : x)).join(', ')})"`;
            body += rowList([
                { icon: '💬', name: 'Talk', desc: 'Hear what they are after', attrs: go('talk', r.id) },
                { icon: '⚔️', name: 'Duel', desc: 'To first blood, fought move by move', side: `${ActionMenu.getAPCost('rival_duel')} AP`, attrs: go('duel', r.id, false) },
                Rivals.willDuel(r, true) ? { icon: '💀', name: 'Duel to the death', desc: 'One of you does not walk away', tone: 'bad', attrs: go('duel', r.id, true) } : null,
                { icon: '🤝', name: 'Team up', desc: `Delve together; they take ${Math.round(cfg.teamUp.share * 100)}% of the gold`, off: !team.ok, why: team.reason, attrs: go('teamUp', r.id) },
                { icon: '💰', name: 'Hire their sword', desc: `They join your army for ${cfg.hire.days} days`, side: hire.ok ? price(hire.cost, gold >= hire.cost) : '', off: !hire.ok, why: hire.reason, attrs: go('hire', r.id) },
                { icon: '🏁', name: 'Race them to a ruin', desc: 'First to delve it takes the pot', side: price(cfg.race.wager, gold >= cfg.race.wager), off: racing, why: 'You are already in a race', attrs: go('race', r.id) },
                { icon: '🗡️', name: 'Sabotage', desc: `${Math.round(Rivals.sabotageChance(player) * 100)}% it goes unnoticed`, side: price(cfg.sabotage.cost, gold >= cfg.sabotage.cost), tone: 'bad', attrs: go('sabotage', r.id) },
            ]);
            html += card(body, { icon: r.icon, title: _esc(r.name), side: `<span style="color:${att.color};">${att.icon} ${_esc(att.label)}</span>` });
        }
        html += rowList([{ icon: '🏆', name: 'Hall of Heroes', desc: 'Every adventurer by renown, their news, and the fallen', attrs: 'onclick="window._rivals.hall()"', side: '›' }]);
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
                const gate = Rivals.canDuel(player, world, id, toDeath);
                if (!gate.ok) return fail(gate.reason);
                if (!ap('rival_duel')) return;
                // Fought move by move in the duel panel (systems/duels.js); the outcome goes back to Rivals
                const { a, b } = Rivals.duelists(player, r);
                DuelPanel.open(game, {
                    a, b,
                    mode: toDeath ? 'toDeath' : 'firstBlood',
                    title: toDeath ? '💀 A Duel to the Death' : '⚔️ A Duel',
                    intro: `${r.icon} <b>${_esc(r.name)}</b>: "${_esc(Rivals.line(r, 'duelAccept'))}"`,
                    onFinish: (outcome) => settleDuel(id, toDeath, outcome),
                });
            },
        };
        const settleDuel = (id, toDeath, outcome) => {
            const r = Rivals.get(player, id);
            if (!r) return;
            const res = Rivals.duel(player, world, id, { toDeath, outcome });
            if (!res.success) return fail(res.reason);
            let h = `${r.icon} <b>${_esc(r.name)}</b>${res.yielded === 'a' ? ' — you yielded.' : res.yielded === 'b' ? ' yields.' : ''}<br>`;
            if (res.playerWon) {
                h += res.rivalDied
                    ? `<span style="color:#7fd07f;">You cut ${_esc(r.name)} down. +${res.renown} renown, -${res.harm} health.</span>`
                    : `<span style="color:#7fd07f;">You win the duel! +${res.renown} renown, -${res.harm} health.</span>`;
            } else {
                h += `<span style="color:#e08080;">You lose the duel. -${res.harm} health.${res.wound ? ` ${res.wound.icon || '🔴'} ${_esc(res.wound.name)}.` : ''}</span>`;
            }
            if (res.after) h += `<br><i>"${_esc(res.after)}"</i>`;
            refresh({ html: h, tone: res.playerWon ? 'good' : 'bad' });
        };
        Object.assign(window._rivals, {
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
                refresh({ html: `🗡️ ${_esc(res.text)}`, tone: res.caught ? 'bad' : 'good' });
            },
            hall: () => ActionMenu.showHallOfHeroes(game, tile),
        });

        game.ui.showCustomPanel('🗡️ Adventurers Here', html);
    },

    /** The Hall of Heroes: renown leaderboard plus rival news. */
    showHallOfHeroes(game, tile) {
        const player = game.player;
        const world = game.world;
        const rows = Rivals.leaderboard(player, world);
        const st = Rivals.state(player);
        const s = st.stats;
        let html = '<div style="max-height: 520px; overflow-y: auto; font-size: 12px;">';
        html += chips([
            ['⚔️', 'Duels', `${s.duelsWon}–${s.duelsLost}`],
            ['🏁', 'Races', `${s.racesWon}–${s.racesLost}`],
            s.slain ? ['💀', 'Slain', s.slain] : null,
        ]);
        const p = st.partner;
        const race = st.race;
        html += rowList([
            p ? { icon: '🤝', name: `Delving with ${_esc(p.name)}`, desc: `Until day ${p.until}${p.earned ? ` · ${p.earned}g taken so far` : ''}`, tone: 'good' } : null,
            race ? { icon: '🏁', name: `Racing ${_esc((Rivals.get(player, race.rivalId) || {}).name || 'a rival')} to ${_esc(race.siteName)}`, desc: `At (${race.q}, ${race.r}); they arrive about day ${race.deadline}`, tone: 'warn' } : null,
        ], 'Under way');
        html += rowList(rows.map(row => ({
            icon: row.icon,
            name: `${row.rank}. ${_esc(row.name)}${row.isPlayer ? ' (you)' : ''}`,
            desc: `${_esc(row.label)}${row.status ? ` · ${_esc(row.status)}` : ''}${row.claim ? ` · 👑 ${_esc(row.claim)}` : ''}${row.attitude ? ` · <span style="color:${row.attitude.color};">${row.attitude.icon} ${_esc(row.attitude.label)}</span>` : ''}`,
            side: `⭐ ${row.renown}`,
            tone: row.isPlayer ? 'gold' : '',
        })), 'By renown');
        const news = Rivals.news(player, 15);
        html += news.length
            ? rowList(news.map(n => ({ icon: n.icon, name: _esc(n.text), side: `day ${n.day}` })), 'Tales of the road')
            : sectionHead('Tales of the road') + '<div style="color:#888;">No word yet of the other adventurers.</div>';
        const fallen = Rivals.fallen(player);
        if (fallen.length) html += sectionHead('The fallen') + `<div style="color:#888; font-size:11px;">${fallen.map(r => `⚰️ ${_esc(r.name)} (day ${r.dead.day})`).join(' · ')}</div>`;
        html += '</div>';
        game.ui.showCustomPanel('🏆 Hall of Heroes', html);
    },
});
