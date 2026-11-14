// ActionMenu — 📜 Your Crimes & Enemies (Family → Against you): each realm's
// charge sheet and the price on your head, the bounty hunters on your trail,
// the orphans of those you killed who are growing up (and the weregild that
// would settle with their families), the avengers already sworn, and the
// ways out: a pardon, penance at a church. Logic in systems/wanted.js.
import { ActionMenu } from './_ref.js';
import { Wanted } from '../../systems/wanted.js';
import { lede, chips, rowList, card, price, purse, bullets, more, esc } from './uiKit.js';

Object.assign(ActionMenu, {
    /** The dossier of your crimes and those who would answer them. message: { html, tone }. */
    showWantedPanel(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = Wanted.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        const total = v.realms.reduce((s, r) => s + r.bounty, 0);
        html += lede(v.realms.length || v.debts.length || v.avengers.length
            ? 'The crowns keep their ledgers, and the families keep their dead. What you did follows you from realm to realm, and down the years.'
            : 'No crown wants you and no orphan swears your name. Deeds done where the watch can see, or that the talk carries to a court, will change that.');
        html += chips([
            purse(player.gold),
            total ? { icon: '📜', label: 'On your head', value: `${total.toLocaleString('en-US')}g`, cls: 'bad' } : null,
            v.hunt ? { icon: '🎯', label: 'Hunted', value: esc(v.hunt.captain), cls: 'bad' } : null,
            v.debts.length ? ['🧒', 'Blood debts', v.debts.length] : null,
        ]);

        // Each realm's sheet
        for (const r of v.realms) {
            let body = `<div style="color:#e0846a; margin-bottom:4px;">${esc(r.charges)}</div>`;
            body += chips([
                ['💰', 'Price', `${r.bounty}g`, r.posted ? 'bad' : ''],
                r.grave ? ['☠️', 'Grave', `${r.grave}g`, 'bad'] : null,
                r.lesser ? ['⚖️', 'Lesser', `${r.lesser}g`] : null,
                r.huntersBeaten ? ['🎯', 'Hunters beaten', r.huntersBeaten] : null,
            ]);
            const notes = [];
            notes.push(r.posted ? '📜 Posters bear your likeness in every town; the watch may know you.' : 'No posters yet: the crown is still building its case.');
            if (r.grave) notes.push('☠️ A killing never fades: a pardon, weregild to the family, or the cells.');
            else if (r.fading) notes.push('🍂 Fading: no new crime for years (twice as fast while you keep out of the realm).');
            else if (r.fadesIn != null) notes.push(`⏳ Lesser charges begin to fade after ${r.fadesIn} more days without a new crime.`);
            body += bullets(notes);
            const q = r.pardon;
            const rows = [];
            if (q.ok) {
                rows.push(q.kind === 'grant'
                    ? { icon: '🕊️', name: 'Ask the crown\'s grace', desc: 'They favour you: a pardon, freely given', act: 'wantedAct', args: ['pardon', r.kingdomId], tone: 'gold' }
                    : { icon: '🖋️', name: 'Buy a pardon', desc: 'The chancery writes it; the posters come down', side: price(q.cost, true), act: 'wantedAct', args: ['pardon', r.kingdomId], tone: 'gold' });
            } else {
                rows.push({ icon: '🖋️', name: 'Seek a pardon', off: true, why: esc(q.reason || ''), side: q.cost ? price(q.cost, false) : '' });
            }
            body += rowList(rows);
            html += card(body, { icon: r.posted ? '📜' : '🗂️', title: esc(r.name), side: r.posted ? 'WANTED' : 'on file', tone: r.grave ? 'bad' : 'warn' });
        }

        // Penance where you stand
        const pq = v.penance;
        if (v.realms.length) {
            html += rowList([pq.ok
                ? { icon: '⛪', name: `Do penance in ${esc(pq.town.name)}`, desc: 'A night on your knees and alms to the church: the priest speaks for you to the watch', side: price(pq.cost, true), act: 'wantedAct', args: ['penance'] }
                : { icon: '⛪', name: 'Do penance at a church', off: true, why: esc(pq.reason || '') }], 'Atonement');
        }

        // The hunt
        if (v.hunt) {
            const h = v.hunt;
            html += card(`${chips([['⚔️', 'Strength', h.strength], ['📍', 'Distance', `${h.distance} hexes`], ['⏳', 'Give up in', `${h.daysLeft} days`]])}
                <div style="color:#cfc3a5;">Out of ${esc(h.fromTown || h.realm)}, on the crown's notice. They wait outside towns. Meet them on the road and you may fight, flee, hide, buy them off — or give yourself up. A realm at war with ${esc(h.realm)} is a refuge.</div>`,
            { icon: '🎯', title: esc(h.captain), side: esc(h.realm), tone: 'bad' });
        }

        // Blood debts: the children growing up
        if (v.debts.length) {
            html += rowList(v.debts.map(d => ({
                icon: d.debt.gender === 'female' ? '👧' : '👦',
                name: esc(d.debt.name),
                desc: esc(`${d.debt.vr === 'father' || d.debt.vr === 'mother' ? 'Child' : 'Kin'} of ${d.debt.victim} (${d.debt.town || 'a town'}) · ${d.years ? `of age in ${d.years} year${d.years === 1 ? '' : 's'}` : 'coming of age'}`),
                side: price(d.cost, (player.gold || 0) >= d.cost),
                act: 'wantedAct', args: ['weregild', d.debt.id],
                off: (player.gold || 0) < d.cost, why: `The weregild is ${d.cost} gold.`,
            })), 'Blood debts: pay the weregild, or wait for them to grow');
        }

        // Avengers already sworn
        if (v.avengers.length) {
            html += rowList(v.avengers.map(a => ({ icon: '⚔️', name: esc(a.name), desc: esc(a.label), side: `hatred ${a.hatred}`, tone: 'bad', act: 'showNemesisPanel' })), 'Sworn avengers');
        }

        if (v.log.length) html += more('What has passed', bullets(v.log.map(l => `${esc(l.text)} <span style="color:#8f8a7e;">(day ${l.day})</span>`)));
        html += '</div>';
        game.ui.showCustomPanel('📜 Your Crimes & Enemies', html);
    },

    /** The panel's rows (data-am-act="wantedAct"). */
    wantedAct(game, action, arg = null) {
        const { player, world } = game;
        let res;
        if (action === 'pardon') res = Wanted.pardon(player, world, arg);
        else if (action === 'penance') res = Wanted.penance(player, world);
        else if (action === 'weregild') res = Wanted.weregild(player, world, arg);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('📜 Crimes & Enemies', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showWantedPanel(game, { html: esc(res.text || 'Done.'), tone: 'good' });
    },
});
