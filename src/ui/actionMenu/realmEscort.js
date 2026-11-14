// ActionMenu — the Household Guard: the escort a realm keeps for its lords
// and its crown, riding with the player. Who it is, what the crown pays and
// feeds it, its arms, morale and loyalty; send it home, ask for more men.
// Logic lives in player/realmEscort.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { RealmEscort } from '../../player/realmEscort.js';
import { esc, lede, chips, card, sectionHead, actRow, rowList, more } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): a card for the guard,
// chips for its state, a row a company, a row an order (greyed with its reason)
const NOTE = 'font-size:11px; color:#9d937c; margin:2px 0;';
const WHY = { title: 'the rank was lost', exile: 'exiled', turned: 'turned against the realm', fallen: 'fell to the last man or the realm fell', home: 'sent home', deserted: 'deserted, unpaid', another: 'another realm\'s men came', loyal: 'stood with the old crown', treason: 'broken with a coup' };

Object.assign(ActionMenu, {
    /** The Household Guard (Dynasty menu, Army Command, a settlement's actions). */
    showHouseholdGuard(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = RealmEscort.view(player, world);
        const g = v.guard;
        const R = v.rank || {};
        let html = '<div style="font-size:12px;">';
        if (message) html += `<div class="pk-card" style="border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;

        if (!g) {
            html += lede('A realm keeps a guard for its lords and its crown: its own soldiers, paid and fed by the crown, who ride and fight with you. They go home if you lose your rank or the treasury cannot pay them.');
            const rows = [];
            if (v.standing) {
                const back = v.homeUntil > (world.day || 0) ? ` You sent them home; they return unasked on day ${v.homeUntil}.` : '';
                rows.push({
                    icon: '🛡️', name: `Ask ${esc(v.standing.kingdom.name)} for a ${esc(String(R.label || 'guard').toLowerCase())}`,
                    desc: `As ${esc(v.standing.why)}.${back}`, why: esc(v.ask.reason || ''),
                    side: v.ask.ok ? `${v.ask.men} men` : '', tone: 'gold',
                    act: 'guardAct', args: ['ask'], off: !v.ask.ok,
                });
            } else {
                rows.push({ icon: '🛡️', name: 'Ask for a guard', off: true, why: esc(v.ask.reason || 'You hold no rank in a realm: a Lord\'s office or estates would earn one.') });
            }
            html += rowList(rows);
        } else {
            const k = v.kingdom;
            let body = `<div style="${NOTE}">${v.men} men of ${esc(g.kingdomName)}'s army${v.standing ? `, kept for you as ${esc(v.standing.why)}` : ''}. The crown pays ${v.wage}g a day from its treasury (${Math.floor((k && k.treasury) || 0)}g) and buys their bread.</div>`;
            if (g.owed > 0.5) body += `<div style="font-size:11px;color:#e8a0a0;">The crown owes them ${Math.round(g.owed)}g${g.arrearsDays ? `, unpaid ${g.arrearsDays} days` : ''}. Unpaid past a week, they slip away.</div>`;
            html += card(body, { icon: '🛡️', title: `${esc(R.label || 'Household guard')} of ${esc(g.kingdomName)}`, side: `since day ${g.since}`, tone: g.owed > 0.5 ? 'warn' : null });
            html += chips([
                { icon: '🔥', label: 'Morale', value: Math.round(g.morale), cls: g.morale < 30 ? 'dim' : '' },
                { icon: '🤝', label: 'Loyalty', value: Math.round(g.loyalty) },
                ['🌾', 'Bread', `${v.supplyDays} days`],
                ['💰', 'In their pockets', `${Math.round(g.pockets)}g`],
            ]);
            html += rowList(v.units.map(u => actRow({
                icon: esc(u.icon || '⚔️'), name: esc(u.name),
                desc: `${u.kit ? esc(u.kit) : 'unarmed: the armoury was bare'}${u.ammo != null && /bow/i.test(u.kit || '') ? ` · ${Math.floor(u.ammo)} arrows` : ''}`,
                side: `${u.strength} men · ${u.wage}g/day`,
            })), 'The companies');
            const r = g.record || {};
            html += `<div style="${NOTE}">${r.battles || 0} battles (${r.won || 0} won) · ${r.fallen || 0} fallen · ${r.deserted || 0} deserted · ${Math.round(r.paid || 0)}g paid, ${Math.round(r.fed || 0)}g of bread</div>`;

            html += rowList([
                {
                    icon: '➕', name: 'Ask for more men',
                    desc: v.ask.ok ? `+${v.ask.wage}g a day to the crown${v.ask.cost ? `, −${v.ask.cost} standing` : ''}` : '',
                    why: esc(v.ask.reason || ''), side: v.ask.ok ? `${v.ask.men} men` : '', tone: 'gold',
                    act: 'guardAct', args: ['ask'], off: !v.ask.ok,
                },
                { icon: '🏠', name: 'Send them home', desc: 'Back to the realm\'s army with their arms. The crown will not send them again unasked for a while.', act: 'guardAct', args: ['home'] },
            ], 'Orders');
            if (g.log && g.log.length) html += sectionHead('Lately') + g.log.slice(0, 6).map(l => `<div style="${NOTE}">Day ${l.day}: ${esc(l.text)}</div>`).join('');
        }
        if (v.past.length) {
            html += more(`Guards before (${v.past.length})`, v.past.slice(0, 4).map(p => {
                const r = p.record || {};
                return `<div style="${NOTE}">🛡️ ${esc((RealmEscort.rankDef(p.rank) || {}).label || 'Guard')} of ${esc(p.kingdomName)}, day ${p.since}–${p.ended}: ${esc(WHY[p.why] || p.why)} · ${r.fallen || 0} fallen</div>`;
            }).join(''));
        }
        html += '</div>';
        game.ui.showCustomPanel('🛡️ Household Guard', html);
    },

    guardAct(game, action) {
        const { player, world } = game;
        let res;
        if (action === 'ask') res = RealmEscort.ask(player, world);
        else if (action === 'home') res = RealmEscort.sendHome(player, world);
        else return;
        game.ui.updateStats(player, world);
        ActionMenu.showHouseholdGuard(game, { html: esc(res.message || res.reason || 'Done.'), color: res.success ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.5)' });
    },
});
