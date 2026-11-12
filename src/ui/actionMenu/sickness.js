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
import { BTN_GOLD, BTN_OFF, CARD, esc, lede, chips } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const H = 'font-weight:bold; color:var(--gold); margin:8px 0 3px;';

function act(label, args, style = BTN_GOLD, title = '') {
    return `<button data-am-act="sicknessAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

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
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
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
            ['⚕️', 'Healer', v.healer ? `${esc(v.healer.name)} (${esc(v.healer.levelName)})` : 'none on their feet'],
            v.fund ? ['💰', 'Physic paid', `${Math.round(v.fund.gold)}g left, ${v.fund.until - day} days`] : null,
            v.alms ? ['🍞', 'Alms', `${v.alms.until - day} days`] : null,
            s.sickness && s.sickness.closed ? ['🚧', 'Gates', 'quarantined'] : null,
        ]);
        if (v.sick.length) {
            html += `<div style="${H}">🛏️ The Sick</div><div style="${CARD}">`;
            for (const x of v.sick.slice(0, 14)) {
                const p = x.person;
                const care = [x.fam ? 'family nursing' : 'no one at home to nurse them', x.visits ? `${x.visits} healer's visit${x.visits === 1 ? '' : 's'}` : 'no healer yet', x.gift ? `your ${x.gift}` : null].filter(Boolean).join(', ');
                html += `<div style="margin:2px 0;">${x.icon} <b>${esc(Townsfolk.name(p))}</b>, ${esc(Townsfolk.roleTitle(p))}, ${Townsfolk.age(p, day)} — ${esc(x.label.toLowerCase())}${x.abed ? ', abed' : ''}, ${x.days} day${x.days === 1 ? '' : 's'}. <span style="${NOTE}">${esc(care)}</span></div>`;
            }
            if (v.sick.length > 14) html += `<div style="${NOTE}">…and ${v.sick.length - 14} more.</div>`;
            html += `<div style="${NOTE}; margin-top:4px;">Bring them medicine (herbs, salves, potions) or food by hand: speak with them, or their kin, and give it.</div></div>`;
        }
        const c = IllnessPlayer.costs(s);
        html += `<div style="${H}">⚕️ Physic and Alms</div><div style="${CARD}">`;
        const can = g => (player.gold || 0) >= g;
        html += v.healer
            ? act(`⚕️ Pay ${esc(v.healer.name)} to Go Round the Sick (${c.physician}g)`, ['physician', s.q, s.r], can(c.physician) ? BTN_GOLD : BTN_OFF, `For ${c.days} days: every sick house visited, fees and herbs from your coin; what is left the healer keeps.`)
            : `<span style="${NOTE}">The town has no healer on their feet to pay.</span> `;
        html += act(`🍞 Give Alms to the Poor (${c.alms}g)`, ['alms', s.q, s.r], can(c.alms) ? BTN_GOLD : BTN_OFF, `Into the poorest households' purses: they eat better and fall sick the less, for ${c.almsDays} days.`);
        html += '</div>';
        if (v.hist.length) {
            html += `<div style="${H}">📜 Sicknesses Past</div><div style="${CARD}">`;
            for (const h of v.hist) {
                const d = Illness.def(h.k) || {};
                html += `<div>${d.icon || '🤒'} ${esc(d.name || h.k)} ${esc(Townsfolk.when(h.from, world))}: at worst ${h.peak} sick, ${h.dead ? `${h.dead} dead` : 'no one died'}.</div>`;
            }
            html += '</div>';
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
