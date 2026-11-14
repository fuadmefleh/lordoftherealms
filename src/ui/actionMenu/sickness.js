// ActionMenu — The Sick of the Town (systems/illness.js, systems/illnessPlayer.js):
// who is down with what and who nurses them, the sickness going round and the
// ones that have passed (and whom they took), the town's healer; pay the
// healer to go round every sick house for a month, or give alms to the poor.
// Medicine and food go to the sick by hand (the dialog's gift). Opened from
// the town's action menu ('town_sickness'); buttons route through
// data-am-act → sicknessAct.
import { ActionMenu } from './_ref.js';
import { Illness } from '../../systems/illness.js';
import { IllnessPlayer } from '../../systems/illnessPlayer.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { esc, lede, chips, card, rowList, more, price, purse } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function hereTown(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

Object.assign(ActionMenu, {
    /** The Sick of the Town: the sick, the outbreaks, the healer, physic and alms. */
    showSickness(game, message = null) {
        const { world, player } = game;
        const s = hereTown(game);
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        if (!s || !s.folk) {
            html += lede('No one here keeps count of the sick.') + '</div>';
            game.ui.showCustomPanel('🤒 The Sick of the Town', html);
            return;
        }
        const v = Illness.view(world, s);
        const day = world.day || 1;
        const going = v.out.map(o => `${o.icon} ${o.name}${o.dead ? ` (${o.dead} dead)` : ''}`).join(', ');
        html += lede(v.sick.length
            ? `${v.sick.length} of ${esc(s.name)}'s people are sick, ${v.abed} laid up abed.${going ? ` Going round: ${esc(going)}.` : ''}`
            : `No one in ${esc(s.name)} is sick just now.`);
        html += chips([
            purse(player.gold),
            ['⚕️', 'Healer', v.healer ? `${esc(v.healer.name)} (${esc(v.healer.levelName)})` : 'none on their feet'],
            v.fund ? ['💰', 'Physic paid', `${Math.round(v.fund.gold)}g left, ${v.fund.until - day} days`] : null,
            v.alms ? ['🍞', 'Alms', `${v.alms.until - day} days`] : null,
            s.sickness && s.sickness.closed ? ['🚧', 'Gates', 'quarantined'] : null,
        ]);
        if (v.sick.length) {
            const rows = v.sick.slice(0, 14).map(x => {
                const p = x.person;
                const care = [x.fam ? 'family nursing' : 'no one at home to nurse them', x.visits ? `${x.visits} healer's visit${x.visits === 1 ? '' : 's'}` : 'no healer yet', x.gift ? `your ${x.gift}` : null].filter(Boolean).join(', ');
                return {
                    icon: x.icon, name: `${esc(Townsfolk.name(p))} <span style="${NOTE}">· ${esc(Townsfolk.roleTitle(p))}, ${Townsfolk.age(p, day)}</span>`,
                    desc: `${esc(x.label)}${x.abed ? ', abed' : ''} — ${esc(care)}`,
                    side: `${x.days} day${x.days === 1 ? '' : 's'}`, tone: x.abed ? 'warn' : '',
                };
            });
            if (v.sick.length > 14) rows.push({ icon: '⋯', name: `…and ${v.sick.length - 14} more` });
            html += rowList(rows, '🛏️ The sick');
            html += `<div style="${NOTE} margin:2px 0 6px;">Bring them medicine (herbs, salves, potions) or food by hand: speak with them, or their kin, and give it.</div>`;
        }
        const c = IllnessPlayer.costs(s);
        const can = g => (player.gold || 0) >= g;
        html += rowList([
            {
                icon: '⚕️', name: v.healer ? `Pay ${esc(v.healer.name)} to go round the sick` : 'Pay a healer to go round the sick',
                desc: `For ${c.days} days every sick house is visited, fees and herbs from your coin; what is left the healer keeps.`,
                side: price(c.physician, can(c.physician)),
                off: !v.healer || !can(c.physician), why: !v.healer ? 'The town has no healer on their feet to pay.' : `Needs ${c.physician}g.`,
                act: 'sicknessAct', args: ['physician', s.q, s.r],
            },
            {
                icon: '🍞', name: 'Give alms to the poor',
                desc: `Into the poorest households' purses: they eat better and fall sick the less, for ${c.almsDays} days.`,
                side: price(c.alms, can(c.alms)), off: !can(c.alms), why: `Needs ${c.alms}g.`,
                act: 'sicknessAct', args: ['alms', s.q, s.r],
            },
        ], '⚕️ Physic and alms');
        if (v.hist.length) {
            html += more(`📜 Sicknesses past (${v.hist.length})`, rowList(v.hist.map(h => {
                const d = Illness.def(h.k) || {};
                return { icon: d.icon || '🤒', name: esc(d.name || h.k), desc: `At worst ${h.peak} sick, ${h.dead ? `${h.dead} dead` : 'no one died'}`, side: `<span style="${NOTE}">${esc(Townsfolk.when(h.from, world))}</span>` };
            })));
        }
        html += '</div>';
        game.ui.showCustomPanel('🤒 The Sick of the Town', html);
    },

    /** The panel's buttons: op, the town (q, r). */
    sicknessAct(game, op, q, r) {
        const { world, player } = game;
        const t = world.getTile(q, r);
        const s = t && t.settlement;
        if (!s) return;
        let res;
        if (op === 'physician') res = IllnessPlayer.fundPhysician(player, world, s);
        else if (op === 'alms') res = IllnessPlayer.giveAlms(player, world, s);
        else return;
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showSickness(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
