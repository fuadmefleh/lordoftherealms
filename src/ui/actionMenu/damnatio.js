// ActionMenu — 🔥 Wipe Their Name (Dynasty → Wipe Their Name): the Houses your
// crown has destroyed (a fallen realm's dynasty whose old seat you hold, the
// old royal line of the realm you rule) and the four acts that erase one —
// deface its tombs, burn its chronicles, rename its towns, kill or geld its
// last sons; then the one who remembers, and the names wiped before. Logic:
// systems/damnatio.js.
import { ActionMenu } from './_ref.js';
import { Damnatio } from '../../systems/damnatio.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';

Object.assign(ActionMenu, {
    /** The damnatio panel. message: { html, tone } shown on top. */
    showDamnatio(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = Damnatio.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede('A House you have broken can be made never to have been: its tombs emptied, its books burnt, its towns renamed, its last sons gone. Its name vanishes from the Annals and the Timeline — unless someone survives to remember it.');
        if (!v.houses.length) html += card(esc(v.ruler ? 'No House you have destroyed is within your reach: take the old seat of a fallen realm, or the crown of a line you overthrew.' : 'Only a crown can wipe a name from the world.'), { tone: 'warn' });
        for (const h of v.houses) {
            const rec = h.rec;
            const done = h.acts.filter(a => a.done).length;
            let body = chips([
                ['🏚️', h.kind === 'line' ? 'The old line of' : 'Fallen realm', esc(h.realm || '')],
                ['🔥', 'Done', `${done}/4`, done === 4 ? 'bad' : ''],
                rec && rec.erased ? ['💀', 'Erased', `day ${rec.erased.day}`, 'bad'] : null,
                rec && rec.restored ? ['📜', 'Restored', esc(rec.restored.by), 'gold'] : null,
            ]);
            if (h.sons.length) body += `<div style="color:#cfc3a5; margin:2px 0 6px;">Sons left: ${h.sons.map(esc).join(', ')}.</div>`;
            if (h.towns.length) body += `<div style="color:#cfc3a5; margin:2px 0 6px;">Towns that bear their name: ${h.towns.map(esc).join(', ')}.</div>`;
            const rows = [];
            for (const a of h.acts) {
                if (a.done) { rows.push({ icon: '✔️', name: esc(a.label), desc: 'Done' }); continue; }
                if (a.id === 'sons' && !h.sons.length) {
                    // No son of the blood is known to live: the act is only the search, and the record of it
                    rows.push(a.can.ok
                        ? { icon: '🗡️', name: 'Hunt down their last sons', desc: 'No son of the blood is known to live: the search is made, and written down as done', side: price(a.can.gold, true), act: 'damnatioAct', args: ['act', h.key, 'sons', 'kill'], tone: 'warn' }
                        : { icon: '🗡️', name: esc(a.label), off: true, why: esc(a.can.reason || 'Not now.') });
                    continue;
                }
                if (a.id === 'sons') {
                    for (const how of ['kill', 'geld']) {
                        rows.push(a.can.ok
                            ? { icon: how === 'kill' ? '🗡️' : '✂️', name: how === 'kill' ? 'Put their last sons to death' : 'Geld their last sons and send them to a monastery', desc: how === 'kill' ? 'No one of the blood left to remember' : 'Alive, but a gelded son remembers', side: price(a.can.gold, true), act: 'damnatioAct', args: ['act', h.key, 'sons', how], tone: 'bad' }
                            : { icon: '🗡️', name: esc(a.label), off: true, why: esc(a.can.reason || 'Not now.') });
                    }
                    continue;
                }
                rows.push(a.can.ok
                    ? { icon: a.icon, name: esc(a.label), desc: a.id === 'towns' && !h.towns.length ? 'No town you hold bears their name: a decree that none ever shall' : '', side: price(a.can.gold, true), act: 'damnatioAct', args: ['act', h.key, a.id], tone: 'warn' }
                    : { icon: a.icon, name: esc(a.label), off: true, why: esc(a.can.reason || 'Not now.') });
            }
            body += rowList(rows);
            if (rec && rec.erased && !rec.restored && rec.rememberer) {
                body += rowList([{ icon: '🕯️', name: `${esc(rec.rememberer.label || rec.rememberer.name)} remembers`, desc: `Hire blades to silence them (${Math.round(v.silenceChance * 100)}%)`, side: price(v.silenceGold, (player.gold || 0) >= v.silenceGold), act: 'damnatioAct', args: ['silence', h.key], tone: 'bad' }], 'Who remembers');
            }
            html += card(body, { icon: '🛡️', title: esc(h.name), side: esc((h.seat && h.seat.name) || ''), tone: rec && rec.erased ? 'bad' : 'warn' });
        }
        if (v.past.length) {
            html += rowList(v.past.map(r => ({
                icon: r.restored ? '📜' : '💀', name: esc(r.name),
                desc: esc(r.restored ? `Restored by ${r.restored.by} on day ${r.restored.day}` : r.aiText || `Wiped from the world by ${r.by}`),
                side: r.erased ? `day ${r.erased.day}` : '',
            })), 'Names wiped from the world');
        }
        html += '</div>';
        game.ui.showCustomPanel('🔥 Wipe Their Name', html);
    },

    /** The panel's rows (data-am-act="damnatioAct"). */
    damnatioAct(game, action, key, act = null, how = null) {
        const { player, world } = game;
        let res;
        if (action === 'act') res = Damnatio.act(player, world, key, act, { how });
        else if (action === 'silence') res = Damnatio.silence(player, world, key);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('🔥 Wipe Their Name', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showDamnatio(game, { html: esc(res.text || 'Done.'), tone: res.failed ? 'warn' : 'bad' });
    },
});
