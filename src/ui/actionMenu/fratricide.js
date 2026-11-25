// ActionMenu — ➰ The Bowstring (Dynasty → The Bowstring): the realm's law on
// the heir's brothers, the brothers condemned at your accession (spare one,
// or give the word), the brothers you spared (and their plots), those in the
// cage, the mothers' schemes for their sons, the dead, and the bowstrings of
// the other realms. Logic: systems/fratricide.js.
import { ActionMenu } from './_ref.js';
import { Fratricide } from '../../systems/fratricide.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';

Object.assign(ActionMenu, {
    /** The bowstring panel. message: { html, tone } shown on top. */
    showFratricide(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = Fratricide.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede(v.realm
            ? (v.law === 'fratricide'
                ? `In ${esc(v.realm.name)} the law is the bowstring: when the seat passes, the new ruler's brothers die, so that no brother can rise for the crown. Every mother at court knows it.`
                : v.law === 'cage'
                    ? `In ${esc(v.realm.name)} the law is the cage: when the seat passes, the new ruler's brothers are shut up in the palace for life.`
                    : `In ${esc(v.realm.name)} the brothers of the heir live. Change the law of succession in the Laws panel, if you dare.`)
            : 'Only a crown makes the law on the heir\'s brothers. Under the law of fratricide, the brothers of a new ruler are strangled on the day of the accession.');
        html += chips([
            v.lawLabel ? ['📜', 'The law', esc(v.lawLabel)] : null,
            ['➰', 'Strangled', v.stats.strangled, v.stats.strangled ? 'bad' : ''],
            v.stats.spared ? ['🕊️', 'Spared', v.stats.spared, 'gold'] : null,
            v.stats.caged ? ['🔒', 'Caged', v.stats.caged] : null,
            v.stats.poisoned ? ['🍷', 'Poisoned', v.stats.poisoned, 'bad'] : null,
        ]);

        if (v.pending && v.pending.brothers.length) {
            const c = v.spareCost;
            const rows = [];
            for (const b of v.pending.brothers) {
                rows.push({ icon: '🕊️', name: `Spare ${esc(b.name)}`, desc: `Aged ${b.age}. Against the law: stability −${c.stability}, Prestige −${c.prestige}, the lords' opinion −${c.opinion}`, act: 'fratricideAct', args: ['spare', b.id], tone: 'gold' });
                rows.push({ icon: '➰', name: `Give the word for ${esc(b.name)}`, desc: 'Now, and not wait for the days to run out', act: 'fratricideAct', args: ['strangle', b.id], tone: 'bad' });
            }
            html += card(rowList(rows), { icon: '➰', title: 'The mutes wait for your word', side: `${v.pending.daysLeft} day${v.pending.daysLeft === 1 ? '' : 's'} left`, tone: 'bad' });
        }

        if (v.spared.length) {
            html += rowList(v.spared.flatMap(s => [
                { icon: s.plotted ? '🗡️' : '🕊️', name: esc(s.name), desc: s.plotted ? `Caught plotting on day ${s.plotted}` : `Spared on day ${s.day}, aged ${s.age}`, side: s.plotted ? 'plotting' : 'spared', tone: s.plotted ? 'bad' : 'gold' },
                { icon: '➰', name: `The bowstring after all for ${esc(s.name)}`, desc: s.plotted ? 'He earned it' : 'Your mercy was a loan: the court will remember it', act: 'fratricideAct', args: ['strangle', s.id], tone: 'bad' },
                s.plotted ? { icon: '⛵', name: `Send ${esc(s.name)} abroad under guard`, desc: 'Alive, and never to return', act: 'fratricideAct', args: ['exile', s.id] } : null,
            ]), 'The brothers you spared');
        }

        if (v.schemes.length) {
            html += rowList(v.schemes.flatMap(s => [
                { icon: '🍷', name: `${esc(s.motherName)} schemes`, desc: `For ${esc(s.forName)}, against ${esc(s.againstName)}${s.guarded ? ' · guarded' : ''}`, side: `day ${s.strikeDay}?`, tone: 'bad' },
                s.guarded ? null : { icon: '🛡️', name: `Guard ${esc(s.againstName)}`, desc: 'Guards and a taster, day and night', side: price(Fratricide.config().mothers.guardCost, (player.gold || 0) >= Fratricide.config().mothers.guardCost), act: 'fratricideAct', args: ['guard', s.id] },
                { icon: '🚪', name: `Send ${esc(s.motherName)} from court`, desc: 'The scheme ends; her love for you with it, and her son\'s', act: 'fratricideAct', args: ['banish', s.id] },
            ]), 'Mothers at court');
        }

        if (v.law === 'fratricide' && v.sons.length > 1) {
            html += rowList(v.sons.map(s => ({ icon: s.heir ? '👑' : '👦', name: esc(s.name), desc: `Aged ${s.age} · son of ${esc(s.mother)}`, side: s.heir ? 'heir' : 'must die if another reigns', tone: s.heir ? 'gold' : 'warn' })), 'Your sons: only one will live');
        }
        if (v.caged.length) html += rowList(v.caged.map(c => ({ icon: '🔒', name: esc(c.name), desc: `Aged ${c.age}, in the cage since day ${c.since}` })), 'In the cage');
        if (v.dead.length) html += rowList(v.dead.map(d => ({ icon: d.how === 'strangled' ? '➰' : '🍷', name: esc(d.name), desc: d.how === 'strangled' ? 'Strangled with the bowstring' : 'Poisoned', side: `day ${d.day}` })), 'The dead');
        if (v.history.length) html += rowList(v.history.map(h => ({ icon: '·', name: esc(h.text), side: `day ${h.day}` })), 'Lately');
        if (v.world.length) html += rowList(v.world.map(e => ({ icon: e.kind === 'harem' ? '🍷' : e.kind === 'adopt' ? '📜' : e.kind === 'repeal' ? '🕊️' : '➰', name: esc(e.text), side: `day ${e.day}` })), 'The bowstrings of the world');
        html += '</div>';
        game.ui.showCustomPanel('➰ The Bowstring', html);
    },

    /** The panel's rows (data-am-act="fratricideAct"). */
    fratricideAct(game, action, id) {
        const { player, world } = game;
        let res;
        if (action === 'spare') res = Fratricide.spare(player, world, id);
        else if (action === 'strangle') res = Fratricide.strangle(player, world, id);
        else if (action === 'exile') res = Fratricide.exile(player, world, id);
        else if (action === 'guard') res = Fratricide.guard(player, world, id);
        else if (action === 'banish') res = Fratricide.banish(player, world, id);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('➰ The Bowstring', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showFratricide(game, { html: esc(res.text || 'Done.'), tone: action === 'spare' || action === 'guard' ? 'good' : 'bad' });
    },
});
