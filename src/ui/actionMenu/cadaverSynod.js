// ActionMenu — ⚰️ The Synod of the Dead (Dynasty → The Synod of the Dead): the
// tombs of dead kings and House heads within your realm's reach, what trying
// one would do to his heirs, the sentences (the river, unhallowed ground), and
// the synods held, yours and the world's. Logic: systems/cadaverSynod.js.
import { ActionMenu } from './_ref.js';
import { CadaverSynod } from '../../systems/cadaverSynod.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';
import { Names } from '../../core/names.js';

Object.assign(ActionMenu, {
    /** The synod panel. message: { html, tone } shown on top. */
    showCadaverSynod(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = CadaverSynod.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede('Dig up a dead enemy, seat him on a throne in his vestments and try him before your bishops. A deacon answers for him; he is always found guilty. His acts are void, his heirs\' right is in doubt — and the faith will not forgive you.');
        html += chips([
            v.ruler ? ['👑', 'Treasury', `${Math.round(v.ruler.treasury)}g`, v.ruler.treasury >= v.cost ? '' : 'bad'] : ['👑', 'No crown', ''],
            ['⚖️', 'A synod costs', `${v.cost}g`],
            v.known ? ['⚰️', 'Tombs beyond reach', v.known] : null,
        ]);
        if (!v.reach.length) html += card(esc(v.ruler ? 'No dead enemy lies in a town of your realm. Take the towns where they are buried, and their tombs are yours.' : 'Only a crown can call a synod. Win one, and the tombs in its towns are yours to open.'), { tone: 'warn' });
        for (const r of v.reach) {
            const t = r.tomb;
            const f = r.forecast || {};
            let body = `<div style="color:#cfc3a5; margin:2px 0 6px;">${t.kind === 'king' ? `King of ${esc(t.realm ? Names.realm(t.realm) : 'a fallen realm')}` : `Head of ${esc(t.house || 'a House')}`}, dead since day ${t.died}${t.heir ? `; succeeded by ${esc(t.heir)}` : ''}. Lies in ${esc(t.town || 'his tomb')}.</div>`;
            const what = [];
            if (f.heirsRule) what.push(`His line still rules ${esc(f.realm)}: their stability falls, they hate you, you gain a claim on their throne, their next succession may be contested.`);
            if (f.own) what.push('He was a king of the old line of your own realm: its pretender\'s blood is declared bastard.');
            if (f.rival) what.push(`${esc(f.rival)} is shamed at every court and will never forgive it.`);
            what.push('Your faith, your realm and every crown think the worse of you.');
            body += `<div style="margin:0 0 6px;">${what.join(' ')}</div>`;
            body += rowList(v.sentences.map(s => (r.can.ok
                ? { icon: s.id === 'river' ? '🌊' : '⚰️', name: esc(s.label), desc: s.scale < 1 ? 'Half the outrage, half the effect; no grave goods' : 'The full synod; his grave goods to your packs', side: price(r.can.cost, true), act: 'cadaverSynodAct', args: ['hold', t.id, s.id], tone: 'bad' }
                : { icon: s.id === 'river' ? '🌊' : '⚰️', name: esc(s.label), off: true, why: esc(r.can.reason || 'Not now.') })));
            html += card(body, { icon: t.kind === 'king' ? '👑' : '🛡️', title: esc(t.name), side: esc(t.town || ''), tone: r.can.ok ? 'warn' : '' });
        }
        if (v.synods.length) {
            html += rowList(v.synods.map(s => ({ icon: '⚰️', name: esc(s.name), desc: esc(s.ai ? s.text : `Tried by ${s.by}${s.sentence === 'river' ? ', thrown in the river' : ', buried in unhallowed ground'}`), side: `day ${s.day}` })), 'Synods held');
        }
        html += '</div>';
        game.ui.showCustomPanel('⚰️ The Synod of the Dead', html);
    },

    /** The panel's rows (data-am-act="cadaverSynodAct"). */
    cadaverSynodAct(game, action, tombId, sentence = 'river') {
        const { player, world } = game;
        if (action !== 'hold') return;
        const res = CadaverSynod.hold(player, world, tombId, sentence);
        if (!res || !res.success) {
            game.ui.showNotification('⚰️ The Synod', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showCadaverSynod(game, { html: esc(res.text || 'Done.'), tone: 'bad' });
    },
});
