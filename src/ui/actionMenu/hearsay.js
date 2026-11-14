// ActionMenu — What people say of you: the hearsay about the player known in
// this town (systems/hearsay.js) — how far it has gone, how it has grown in
// the telling, who started it — the folk here who remember your talks, and
// the tales you have told about yourself (a mixed story is a risk).
import { ActionMenu } from './_ref.js';
import { Hearsay } from '../../systems/hearsay.js';
import { lede, chips, rowList, more, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const LEVEL = ['as first told', 'grown in the telling', 'much grown', 'garbled past knowing'];

function _reach(r) {
    if (r >= 0.85) return 'all the town';
    if (r >= 0.6) return 'most folk';
    if (r >= 0.35) return 'many';
    if (r >= 0.15) return 'a few';
    return 'a handful';
}

Object.assign(ActionMenu, {
    /** The "What people say of you" panel for the town the player stands in. */
    showHearsay(game) {
        const { player, world } = game;
        const key = `${player.q},${player.r}`;
        const v = Hearsay.view(player, world, key);
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += chips([
            ['👂', 'Tales here', v.here.length],
            ['🛣️', 'Told elsewhere only', v.elsewhere],
            ['🧑‍🤝‍🧑', 'Folk who remember you', v.people.length],
        ]);
        if (!v.here.length) {
            html += lede(`Nobody in ${esc(v.town)} has much to say of you yet. What you tell people in free talk — who you are, what you've done, what you swear — is remembered, and repeated.`);
        }
        html += rowList(v.here.map(r => ({
            icon: r.icon, name: esc(r.label), desc: `“${esc(r.text)}”`,
            note: `First told by ${esc(r.teller || 'someone')} in ${esc(r.origin || 'town')} · ${LEVEL[Math.min(3, r.level)]}${r.towns > 1 ? ` · heard in ${r.towns} towns` : ''}`,
            side: _reach(r.reach), tone: r.ill ? 'bad' : r.exposed ? 'warn' : 'gold',
            title: `${Math.round(r.reach * 100)}% of ${v.town} has heard it`,
        })), `What ${esc(v.town)} says of you`);

        if (v.people.length) {
            html += rowList(v.people.map(p => ({
                icon: p.caught ? '🎭' : p.net >= 3 ? '🙂' : p.net < 0 ? '😠' : '😐', name: esc(p.name),
                desc: p.items.length ? esc(p.items.join('; ')) : 'Small talk.',
                side: esc(p.ago), tone: p.caught || p.net < 0 ? 'bad' : p.net >= 3 ? 'good' : '',
                note: p.caught ? 'Caught you telling two tales.' : '',
            })), 'Who here remembers your talk');
        }

        const claims = v.claims.filter(c => c.values.length);
        if (claims.length) {
            const rows = claims.map(c => ({
                icon: c.mixed ? '⚠️' : '📜', name: esc(c.topic.charAt(0).toUpperCase() + c.topic.slice(1)),
                desc: c.values.map(x => `“${esc(x.v)}” to ${esc(x.to)} (${esc(x.town)})${x.lie ? ' — not true' : ''}`).join(' · '),
                tone: c.mixed ? 'warn' : '', side: c.mixed ? 'two tales' : '',
            }));
            html += more('The tales you have told about yourself', rowList(rows));
            if (claims.some(c => c.mixed)) html += `<div style="${NOTE} margin:2px 0 6px;">⚠️ Where you have told different people different things, anyone who has heard both will catch you out.</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('👂 What People Say of You', html);
    },
});
