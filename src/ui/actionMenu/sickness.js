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
import { Plague } from '../../systems/plague.js';
import { esc, lede, chips, card, rowList, more, price, purse } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function hereTown(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

/** The pestilence (systems/plague.js): how bad, the gates, selling remedies. */
function pestilenceHtml(game, s) {
    const { world, player } = game;
    const p = Plague.view(player, world, s);
    if (!(p.sev > 0) && !p.quarantined && !p.controls) return '';
    const word = p.sev >= 0.7 ? 'raging' : p.sev >= 0.45 ? 'grave' : p.sev >= 0.2 ? 'spreading' : p.sev > 0 ? 'taking hold' : 'gone';
    const rows = [];
    rows.push({ icon: p.plague ? '🐀' : '🤒', name: `${p.plague ? 'The plague' : 'The sickness'} is ${word}`, desc: `${Math.round(p.sev * 100)}% — ${p.deaths ? `${p.deaths} dead of the plague these weeks` : 'none dead of the plague yet'}${p.cleanse ? `; the dead's goods burnt, it goes the slower for ${p.cleanse.until - (world.day || 1)} days` : ''}.`, tone: p.sev >= 0.45 ? 'warn' : '' });
    rows.push({ icon: p.quarantined ? '🚧' : '🚪', name: p.quarantined ? 'The gates are shut' : 'The gates stand open', desc: p.quarantined ? `No one in or out without leave${p.gate && p.gate.by === 'player' ? ', by your order' : p.gate && p.gate.by === 'law' ? ', by the law of the realm' : ''}. Trade halts at the walls; the sickness crosses to the towns about a fraction as often.` : 'Carts and travellers come and go — and the sickness with them.' });
    if (p.controls) {
        rows.push({
            icon: '📜', name: p.quarantined ? `Open the gates of ${esc(s.name)}` : `Shut the gates of ${esc(s.name)}`,
            desc: p.quarantined ? 'Trade flows again, and the sickness with it.' : 'Travellers turned away, trade halted; the towns about kept safer.',
            act: 'sicknessAct', args: ['gates', s.q, s.r],
        });
    }
    if (p.sev > 0) {
        const rem = p.remedies;
        rows.push({
            icon: '🧪', name: 'Sell remedies to the frightened',
            desc: rem.length ? `${rem.map(r => `${r.qty} ${esc(r.id.replace(/_/g, ' '))} at ${r.price}g`).join(', ')}. Their coin, your profit — past twice the fair price it is profiteering.` : 'You carry no herbs, salves or potions to sell.',
            off: !rem.length, why: 'Nothing to sell.', act: 'sicknessAct', args: ['remedies', s.q, s.r],
        });
    }
    return rowList(rows, '🐀 The pestilence') + (p.sev > 0 ? `<div style="${NOTE} margin:2px 0 6px;">On the street map: nurse the sick in the houses with crosses on their doors, burn the goods of the dead's houses — or rob them.</div>` : '');
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
        html += pestilenceHtml(game, s);
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
        else if (op === 'gates') res = Plague.setGates(player, world, s, !Plague.isQuarantined(world, s));
        else if (op === 'remedies') res = Plague.sellRemedies(player, world, s);
        else if (op === 'bribe') {
            // At a shut gate on the world map (ui/innerMapPlague.js turnedAway): in, then the panel closed
            res = Plague.bribeGate(player, world, s);
            if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
            if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
            game.ui.showNotification(res.success ? '🪙 Through the Gate' : '🚧 Gates Shut', res.success ? `${res.text} Travel on to enter.` : res.reason, res.success ? (res.caught ? 'warning' : 'success') : 'info');
            return;
        } else return;
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showSickness(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
