// ActionMenu — 🗡️ Nemeses: the dossier on the named enemies who remember you
// (Dynasty → Nemeses). Each: who carries the feud now and how far it has
// come (stage, hatred, generations), the deed it was born of, what they
// have learnt of your habits, their last blows and letters, and what you can
// do — a blood price, a match between your children and their line, the
// proof of a foiled blow laid before a court. Grudges in the wings and past
// feuds below. Logic lives in systems/nemesis.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Nemesis } from '../../systems/nemesis.js';
import { lede, chips, sectionHead, rowList, card, price, bullets, more, esc } from './uiKit.js';

const OUTCOME = { struck: ['❌', 'bad'], foiled: ['🛡️', 'good'], hidden: ['🌑', ''], yours: ['⚖️', 'gold'], fizzled: ['·', ''] };

function _bar(value) {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    const col = pct >= 85 ? '#c0533a' : pct >= 60 ? '#d9703f' : pct >= 35 ? '#d9a13f' : '#b5a46a';
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:4px 0 6px;"><div style="width:${pct}%;height:100%;background:${col};"></div></div>`;
}

function _year(world, day) {
    const Y = Nemesis.config().daysPerYear || 120;
    // (the calendar year, as Calendar.date counts it: the world's baseYear + whole years)
    const base = Number.isFinite(world && world.baseYear) ? world.baseYear : 1;
    return `year ${base + Math.floor((Math.max(1, day) - 1) / Y)}`;
}

Object.assign(ActionMenu, {
    /** The nemesis dossier. message: { html, tone } shown on top. */
    showNemesisPanel(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Nemesis.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });

        html += lede(v.active.length
            ? 'They have not forgotten. Every enemy here learns how you fight, where you trade and where you stay — and waits for the hour you are weakest.'
            : 'No one has yet sworn themselves your enemy. Deeds are remembered: a town taken, kin slain, a seat denied, a rival shamed.');
        const m = v.moment;
        if (m.why.length) html += chips([{ icon: '⚠️', label: 'The hour is ripe', value: m.why.join(', '), cls: 'bad' }]);

        for (const a of v.active) {
            const nm = a.nm;
            let body = `<div style="color:#cfc3a5; margin-bottom:4px;">${esc(a.bio)}</div>`;
            body += chips([
                [a.stage.icon, a.stage.label, Math.round(nm.hatred)],
                ['🧬', 'Generation', nm.generation],
                ['💰', 'Purse', `${Math.round(a.purse).toLocaleString('en-US')}g`],
                nm.evidence > 0 ? ['📜', 'Proof held', nm.evidence, 'gold'] : null,
            ]);
            body += _bar(nm.hatred);
            body += `<div style="font-style:italic; color:#e0b9a8; margin:4px 0;">"${esc(a.taunt)}"</div>`;
            if (a.learnt.length) {
                body += sectionHead('What they know of you');
                body += bullets(a.learnt.map(l => `${esc(l.text)} <span style="color:#9d937c;">(${Math.round(l.read * 100)}% read)</span>`));
            }
            const acts = (nm.acts || []).slice(0, 5).map(x => {
                const [ic, tone] = OUTCOME[x.outcome] || ['•', ''];
                return { icon: ic, name: esc(x.kind === 'scheme' && x.outcome === 'hidden' ? 'A plot in the dark' : x.text), desc: `${_year(world, x.day)}, day ${x.day}`, tone };
            });
            if (acts.length) body += rowList(acts, 'Their last blows');
            const letters = (nm.letters || []).slice(0, 3).map(l => `<p style="margin:4px 0; color:#d8ccaf;">✉️ <i>${esc(Nemesis.letterText(world, l))}</i> <span style="color:#8f8a7e;">(day ${l.day})</span></p>`).join('');
            if (letters) body += more(`Letters (${nm.letters.length})`, letters);

            const rows = [];
            const rc = a.reconcile;
            rows.push(rc.ok
                ? { icon: '🕊️', name: 'Offer a blood price', desc: `Seek peace (${Math.round(rc.chance * 100)}% they accept)`, side: price(rc.cost, true), act: 'nemesisAct', args: ['reconcile', nm.id] }
                : { icon: '🕊️', name: 'Offer a blood price', off: true, why: esc(rc.reason) });
            const mt = a.match;
            rows.push(mt.ok
                ? { icon: '💍', name: `Offer ${esc(mt.children[0].firstName)} in marriage`, desc: `Wed into ${esc(nm.line || nm.name)} and end the feud`, side: price(mt.dowry, (player.gold || 0) >= mt.dowry), act: 'nemesisAct', args: ['match', nm.id, mt.children[0].id] }
                : { icon: '💍', name: 'Propose a match', off: true, why: esc(mt.reason) });
            const ac = a.accuse;
            rows.push(ac.ok
                ? { icon: '⚖️', name: 'Accuse them at court', desc: 'Lay the proof of a foiled blow before the court', act: 'nemesisAct', args: ['accuse', nm.id] }
                : { icon: '⚖️', name: 'Accuse them at court', off: true, why: esc(ac.reason) });
            body += rowList(rows, 'What you can do');

            html += card(body, { icon: a.kind.icon, title: esc(nm.name), side: esc(a.kind.label), tone: nm.hatred >= 60 ? 'bad' : 'warn' });
        }

        // Your habits, as they would read them
        const hb = v.habits;
        const habits = [
            hb.stance ? `⚔️ In the field you favour <b>${esc(hb.stance.label)}</b> (${Math.round(hb.stance.share * 100)}%).` : null,
            hb.route ? `🐪 Your busiest road runs <b>${esc(hb.route.label)}</b>.` : null,
            hb.place ? `🏘️ You keep most to <b>${esc(hb.place.label)}</b> (${Math.round(hb.place.share * 100)}% of your town days).` : null,
        ].filter(Boolean);
        if (habits.length) html += sectionHead('Your habits') + bullets(habits) + `<div style="color:#8f8a7e;">Vary them, and your enemies must learn you again.</div>`;

        if (v.grudges.length) {
            html += rowList(v.grudges.map(g => ({ icon: Nemesis.kindDef(g.kind).icon, name: esc(g.name), desc: esc(`${g.deed.label}${g.deed.note ? ` (${g.deed.note})` : ''}`), side: 'waiting' })), 'Grudges in the wings');
        }
        if (v.past.length) {
            html += rowList(v.past.map(p => {
                const H = Nemesis.howDef(p.ended.how);
                return { icon: H.icon, name: esc(p.name), desc: esc(p.ended.text), side: `${esc(H.label)} · day ${p.ended.day}` };
            }), 'Feuds that ended');
        }
        html += '</div>';
        game.ui.showCustomPanel('🗡️ Nemeses', html);
    },

    /** The dossier's rows (data-am-act="nemesisAct"). */
    nemesisAct(game, action, id, arg = null) {
        const player = game.player;
        const world = game.world;
        let res;
        if (action === 'reconcile') res = Nemesis.reconcile(player, world, id);
        else if (action === 'match') res = Nemesis.proposeMatch(player, world, id, arg);
        else if (action === 'accuse') res = Nemesis.accuse(player, world, id);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('🗡️ Nemeses', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showNemesisPanel(game, { html: esc(res.text || 'Done.'), tone: res.accepted === false ? 'bad' : 'good' });
    },
});
