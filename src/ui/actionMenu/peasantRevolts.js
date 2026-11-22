// ActionMenu — 🔥 Risings: the commons risen against you (their leader,
// cause, demands, where their host is and what it has burned), your answers
// (meet the demands, parley, buy off the leader, send the royal host — or
// ride out and beat the host on the map with ⚔️ Attack), the fate of a
// rising crushed, the rebel leaders in your prison, the grievances of your
// own towns (and why), and risings elsewhere. Logic lives in
// systems/peasantRevolts.js. Rows route through data-am-act →
// ActionMenu.risingAct.
//
// Opener: ActionMenu.showRisingsPanel(game) (the House panel, "Against you").
import { ActionMenu } from './_ref.js';
import { PeasantRevolts } from '../../systems/peasantRevolts.js';
import { lede, chips, rowList, card, price, purse, esc } from './uiKit.js';

const PHASE = { gather: 'gathering', march: 'on the march', siege: 'besieging' };
const _yr = (world, day) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(day || 1)) - 1) / 120);
const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const _pron = (g) => (g === 'female' ? 'she' : 'he');

function _gTone(g, boil) {
    return g >= boil ? 'bad' : g >= boil * 0.7 ? 'warn' : '';
}

function _risingCard(game, item) {
    const { player, world } = game;
    const rv = item.rv;
    const L = rv.leader;
    const where = rv.phase === 'siege' && rv.target ? `before ${esc(rv.target.name)}`
        : rv.phase === 'march' && rv.target ? `marching on ${esc(rv.target.name)}` : `about ${esc(rv.townNames[rv.townNames.length - 1])}`;
    const facts = [
        ['👥', 'Strength', Math.round(rv.strength)],
        ['🏘️', 'Towns', rv.townNames.length],
        ['🔥', 'Estates burned', rv.burned.length],
        ['📍', 'Their host', `(${rv.q}, ${rv.r})${item.dist != null ? ` · ${item.dist} hexes off` : ''}`],
    ];
    const demands = item.demands.map(d => `${d.icon || ''} ${esc(d.label || d.id)}`).join(' · ');
    const body = lede(`${esc(L.name)}, ${esc(L.role)} of ${esc(L.town)}, leads the commons of ${esc(rv.townNames.join(', '))}, crying ${esc(rv.causeLabel)}. ${_pron(L.gender) === 'she' ? 'She' : 'He'} is ${PHASE[rv.phase] || rv.phase}, ${where}.`)
        + chips(facts)
        + `<div style="font-size:12px; margin:4px 0;"><b>They demand:</b> ${demands}</div>`
        + `<div style="font-size:11px; color:var(--text-secondary);">Ride to their host and use ⚔️ Attack to meet them in the field. Left alone, they burn the estates about them, spread to angry towns near by, and march on ${rv.against === 'holding' ? 'your holding' : 'your seat'}.</div>`;
    let html = card(body, { icon: '🔥', title: `${esc(PeasantRevolts.hostName(rv))}`, side: `since year ${_yr(world, rv.startDay)}`, tone: 'bad' });
    const rows = item.choices.map(ch => ({
        icon: ch.icon, name: esc(ch.label), desc: esc(ch.desc), off: !ch.ok, why: esc(ch.why || ''),
        side: ch.cost ? price(ch.cost, (player.gold || 0) >= ch.cost) : '',
        act: 'risingAct', args: [ch.id, rv.id],
    }));
    html += rowList(rows, 'Answer them');
    return html;
}

function _aftermathHtml(game, am) {
    const { world } = game;
    const C = PeasantRevolts.config();
    const L = am.rv.leader;
    const left = Math.max(0, Math.ceil((am.until - (world.day || 0))));
    let html = card(lede(`The rising of ${esc(L.name)} is broken. Its people wait on your word: ${esc(am.rv.townNames.join(', '))}. Fear quiets a town for a few years; then the hanged are remembered.`), { icon: '⚖️', title: 'Judge the rebels', side: `${left} days`, tone: 'warn' });
    const rows = PeasantRevolts.AFTERMATHS.map(id => {
        const A = C.aftermath[id] || {};
        const bits = [];
        bits.push(`grievance to ${Math.round((A.keep || 0) * 100)}%`);
        if (A.fear) bits.push(`fear for ${A.fearYears} years, then resentment for ${A.resentYears}`);
        if (A.hanged > 1) bits.push(`${A.hanged} hanged`);
        if (A.karma) bits.push(`karma ${A.karma > 0 ? '+' : ''}${A.karma}`);
        const desc = id === 'imprison' ? `${esc(L.name)} in chains, to question or to judge later; ${bits.join(', ')}`
            : id === 'hang_leader' ? `${esc(L.name)} on the gallows; ${bits.join(', ')}` : bits.join(', ');
        return { icon: A.icon, name: esc(A.label || id), desc: _cap(desc), act: 'risingAct', args: [id] };
    });
    html += rowList(rows, 'Their fate');
    return html;
}


function _landsHtml(game, lands, boil) {
    if (!lands.length) return '';
    const rows = lands.map(t => {
        const why = t.parts.filter(p => p.v >= 2 || p.v <= -2).slice(0, 4).map(p => `${p.icon} ${esc(p.label)} ${p.v > 0 ? '+' : ''}${Math.round(p.v)}`).join(' · ');
        const ch = t.charter ? ` · 📜 charter (−${Math.round((t.charter.taxCut || 0) * 100)}% tax)` : '';
        return {
            icon: t.role === 'holding' ? '🏰' : '🏘️', name: esc(t.name),
            desc: `${why || 'Quiet'}${ch}`,
            side: `${t.g}${t.p > t.g + 3 ? ' ↑' : t.p < t.g - 3 ? ' ↓' : ''}`, tone: _gTone(t.g, boil),
        };
    });
    return rowList(rows, `Grievance in your lands (rises at ${boil})`);
}

Object.assign(ActionMenu, {
    showRisingsPanel(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = PeasantRevolts.view(player, world);
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'warn' });
        if (!v.mine.length && !v.aftermath) {
            html += lede('No rising stands against you. The commons bear taxes, hunger, bad coin and a cruel hand only so long; when a town boils over it rises with a leader, a cause and demands. Watch the grievance of your towns below.');
        }
        for (const item of v.mine) html += _risingCard(game, item);
        if (v.mine.length) html += chips([purse(player.gold)]);
        if (v.aftermath) html += _aftermathHtml(game, v.aftermath);
        if (v.prisoners.length) {
            html += rowList(v.prisoners.flatMap(pr => [
                { icon: '⛓️', name: `Hang ${esc(pr.name)}`, desc: `${esc(_cap(pr.role || 'a rebel'))} of ${esc(pr.town)}, taken in year ${_yr(world, pr.day)} for ${esc(pr.crime)}. ${pr.gender === 'female' ? 'Her' : 'His'} town remembers.`, act: 'risingAct', args: ['hangPrisoner', pr.id] },
                { icon: '🕊️', name: `Set ${esc(pr.name)} free`, desc: `${pr.gender === 'female' ? 'She walks' : 'He walks'} home to ${esc(pr.town)}; the town's anger eases.`, act: 'risingAct', args: ['freePrisoner', pr.id] },
            ]), 'Rebel leaders in your prison');
        }
        html += _landsHtml(game, v.lands, v.boilAt);
        if (v.elsewhere.length) {
            html += rowList(v.elsewhere.map(rv => ({
                icon: '🔥', name: esc(PeasantRevolts.hostName(rv)),
                desc: `${esc(rv.townNames.join(', '))} · crying ${esc(rv.causeLabel)} · ${PHASE[rv.phase] || rv.phase} at (${rv.q}, ${rv.r})`,
                side: `${Math.round(rv.strength)} strong`,
            })), 'Risings in other realms');
        }
        if (v.history.length) {
            html += rowList(v.history.map(h => ({ icon: '📜', name: `Year ${_yr(world, h.day)}`, desc: esc(h.text) })), 'On record');
        }
        html += '</div>';
        game.ui.showCustomPanel('🔥 Risings', html);
    },

    /** A choice against a rising, a crushed rising's fate, or a prisoner's. */
    risingAct(game, id, arg = null) {
        const { player, world } = game;
        const res = PeasantRevolts.act(player, world, id, arg);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        ActionMenu.showRisingsPanel(game, { ok: !!res.success, text: res.text });
    },
});
