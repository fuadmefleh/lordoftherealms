// ActionMenu — the last crisis of the age, shown at the head of 🌋 The Age:
// how close the reckoning is (a meter, before it breaks), its omens, the
// trial itself (the foes, the realm's towns held, the choices), and the
// Golden or Dark Age that follows. Logic lives in systems/lastCrisis.js; this
// module builds the section (lastCrisisHtml, called by ui/actionMenu/crises.js)
// and composes the field battle (PlayerMilitary.combat, its result handed to
// LastCrisis.act). Rows route through data-am-act → ActionMenu.lastCrisisAct.
import { ActionMenu } from './_ref.js';
import { PlayerMilitary } from './_imports.js';
import { LastCrisis } from '../../systems/lastCrisis.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';

const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const _yr = (world, day) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(day || 1)) - 1) / 120);
const _pc = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

function _bar(frac, tone = '#d8a64a') {
    const w = Math.max(0, Math.min(100, Math.round((Number(frac) || 0) * 100)));
    return `<div style="height:8px; border-radius:4px; background:rgba(255,255,255,0.08); overflow:hidden; margin:4px 0 6px;"><div style="height:100%; width:${w}%; background:${tone};"></div></div>`;
}

/** The section at the head of the Age panel. */
export function lastCrisisHtml(game) {
    const { player, world } = game;
    if (!world) return '';
    const v = LastCrisis.view(player, world);
    const m = v.meter;
    let html = '';
    if (v.phase === 'watch') {
        const ms = m.measure;
        const facts = [['🏰', 'Towns of the world', _pc(ms.townShare)], ['⚔️', 'Arms of the world', _pc(ms.mightShare)]];
        if (ms.power) facts.push(['', 'Might', Math.round(ms.power)]);
        if (ms.emperor) facts.push(['👑', 'Emperor', 'yes']);
        const tone = m.pct >= 0.75 ? '#c0533a' : m.pct >= 0.5 ? '#d8a64a' : '#8a9a6a';
        const body = `${_bar(m.pct, tone)}<div style="font-size:12px; margin:2px 0 6px;">${esc(m.label)}</div>${chips(facts)}`
            + '<div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">A House that holds a third of the world\'s towns, or its arms, long enough brings the last crisis of the age upon itself: once in a long age, and aimed at it.</div>';
        html += card(body, { icon: '⏳', title: 'The reckoning', side: m.stage === 'spent' ? 'spent' : `${Math.round(m.pct * 100)}%` });
    } else if (v.phase === 'omens') {
        const recent = v.log.map(e => `<div style="font-size:12px; margin:3px 0;"><span style="color:#a99a78;">Year ${_yr(world, e.day)}:</span> ${esc(LastCrisis.line(world, e))}</div>`).join('');
        html += card(`${lede('The age is turning against your House. What comes will be aimed at your crown, and sized to it.')}${recent}`, { icon: '🌠', title: 'Omens of the last crisis', side: v.omenEnd ? `breaks about year ${_yr(world, v.omenEnd)}` : '', tone: 'warn' });
    } else if (v.phase === 'trial' && v.trial) {
        const info = LastCrisis.KIND_INFO[v.trial.kind] || {};
        const facts = [];
        if (v.realm) facts.push(['🏰', 'Your towns', `${v.realm.towns} of ${v.realm.towns0 || v.realm.towns}`], ['⚔️', 'Royal host', v.realm.military]);
        if (v.trial.kind !== 'horde') {
            facts.push(['🔥', 'Their resolve', Math.max(0, Math.round(v.trial.resolve || 0))]);
            if (v.until) facts.push(['⏳', 'Until', `year ${_yr(world, v.until)}`]);
        }
        const foes = v.foes.map(f => `${f.pretender ? '👑 ' : ''}${esc(f.name)} (${f.military})`).join(', ');
        const recent = v.log.map(e => `<div style="font-size:12px; margin:3px 0;"><span style="color:#a99a78;">Year ${_yr(world, e.day)}:</span> ${esc(LastCrisis.line(world, e))}</div>`).join('');
        const keep = `Hold your capital and ${Math.round((v.hold || 0.67) * 100)}% of your towns${v.trial.kind === 'horde' ? ' until the invaders are beaten or settle' : ' until the enemy\'s resolve breaks'}, and the age will bear your House's name.`;
        html += card(`${chips(facts)}${foes ? `<div style="font-size:12px; margin:4px 0;"><b>Against you:</b> ${foes}</div>` : ''}${lede(keep)}${recent}`, { icon: info.icon, title: esc(info.label), side: 'the last crisis', tone: 'bad' });
        const rows = v.choices.map(ch => ({
            icon: ch.icon, name: esc(ch.label), desc: esc(ch.desc), off: !ch.ok, why: esc(ch.why),
            side: ch.cost ? price(ch.cost, (player && player.gold || 0) >= ch.cost) : '',
            act: 'lastCrisisAct', args: [ch.id, ...(ch.args || [])],
        }));
        if (rows.length) html += rowList(rows, 'Meet the last crisis');
        if (v.trial.kind === 'horde') html += '<div style="font-size:11px; color:var(--text-secondary); margin:2px 2px 8px;">The invasion itself, its hosts and your choices against them, is below.</div>';
        if (v.acts.length) html += `<div style="font-size:11px; color:var(--text-secondary); margin:2px 2px 8px;"><b style="color:#d8c27a;">Your part:</b> ${v.acts.slice(0, 6).map(a => `year ${_yr(world, a.day)}, ${esc(a.text)}`).join(' · ')}</div>`;
    } else if (v.phase === 'age' && v.age) {
        const golden = v.age.kind === 'golden';
        const left = Math.max(0, Math.ceil((v.age.until - (world.day || 0)) / 120));
        const what = golden
            ? 'Your realm is steadier, its taxes richer, its people more and its culture brighter; the realms think twice before banding against you.'
            : `The realm is broken${(v.age.successors || []).length ? ` into ${(v.age.successors || []).length + 1} crowns` : ''}: what is left of it is restless and poorer, and the House is a lesser name.`;
        html += card(`${lede(esc(what))}<div style="font-size:12px;">About ${left} more years.</div>`, { icon: golden ? '🌅' : '🌑', title: esc(_cap(v.age.name)), side: golden ? 'a Golden Age' : 'a Dark Age', tone: golden ? 'good' : 'bad' });
    }
    if (v.history.length && v.phase !== 'age') {
        html += rowList(v.history.slice(0, 3).map(h => ({ icon: h.outcome === 'golden' ? '🌅' : '🌑', name: esc(_cap(h.ageName || (h.outcome === 'golden' ? 'A Golden Age' : 'A Dark Age'))), desc: `The last crisis of years ${_yr(world, h.trialDay || h.startDay)}–${_yr(world, h.endDay)}: ${esc(h.house || '')}` })), 'The ages on record');
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The last crisis's rows: a choice id and its arguments (the battle is fought here). */
    lastCrisisAct(game, id, ...args) {
        const { player, world } = game;
        let res;
        if (id === 'battle') {
            const foe = LastCrisis.battleFoe(player, world);
            if (!foe) return ActionMenu.showCrisesPanel(game, { ok: false, text: 'No foe is near.' });
            const tile = world.getTile(foe.at.q, foe.at.r);
            const fight = PlayerMilitary.combat(player, foe.strength, `the army of ${foe.kingdom.name}`, { world, terrainId: tile && tile.terrain && tile.terrain.id });
            if (fight.reason) return ActionMenu.showCrisesPanel(game, { ok: false, text: fight.reason });
            res = LastCrisis.act(player, world, 'battle', { victory: !!fight.victory });
        } else {
            res = LastCrisis.act(player, world, id, ...args);
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        ActionMenu.showCrisesPanel(game, { ok: !!res.success, text: res.text });
    },
});
