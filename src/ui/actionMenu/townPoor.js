// ActionMenu — the town's poor and its housing, for the People panel
// (ui/actionMenu/labour.js): the idle, how the poor are getting by (wages,
// day labour, savings, alms, begging, theft, hunger), the dole and its poor
// box, the realm's Poor Relief; the houses, their crowding and rents. The
// player gives to the poor box (an almshouse once the gifts are enough) and,
// ruling the town, sets its poor rate. Logic: systems/townPoor.js,
// world/townHousing.js.
import { ActionMenu } from './_ref.js';
import { TownPoor } from '../../systems/townPoor.js';
import { TownHousing } from '../../world/townHousing.js';
import { Taxation } from '../../systems/marketDynamics.js';
import { Laws } from '../../systems/laws.js';
import { CARD, rowList, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const SRC = {
    savings: '💰 savings', dayLabour: '🧺 day labour', church: '⛪ the church\'s alms', guild: '🔨 the guilds', nobles: '👑 the lords\' largesse',
    rate: '📜 the poor rate', crown: '🏛️ the crown\'s dole', box: '🥣 the almshouse', beg: '🙏 begging', crime: '🗡️ petty theft', pawn: '⚖️ pawning', unmet: '🥖 going without',
};
const RELIEF = { charity: 'charity alone', rate: 'a poor rate', crownDole: "the crown's dole" };
const HOUSE = { hovel: 'hovels', cottage: 'cottages', house: 'houses', townhouse: 'townhouses', row: 'rows of houses', tenement: 'tenements', lodging: 'lodging houses' };

const pct = (v) => `${Math.round(v * 100)}%`;

function _rules(game, s) {
    try {
        return Taxation.getPlayerSettlements(game.player, game.world).some(ref => ref.q === s.q && ref.r === s.r);
    } catch (e) { return false; }
}

/** A short line for other panels: how the poor get by, and the housing. */
export function poorLine(settlement) {
    const P = settlement && settlement.poor;
    if (!P) return '';
    const pl = TownPoor.plight(settlement);
    const parts = [`poor <span style="color:${pl.color};">${pl.label.toLowerCase()}</span>`];
    if (settlement.housing) {
        const c = TownHousing.crowd(settlement);
        if (c >= 1.05) parts.push(`<span style="color:${TownHousing.crowdLabel(c).color};">${TownHousing.crowdLabel(c).label.toLowerCase()}</span>`);
    }
    return parts.join(' · ');
}

/** The poor and the housing cards (exported for tests). */
export function poorHtml(game, s) {
    const { world, player } = game;
    const P = TownPoor.summary(world, s);
    let html = '';
    if (P) {
        const pl = TownPoor.plight(s);
        html += `<div style="${CARD}"><b>The poor</b> · <span style="color:${pl.color};">${pl.label}</span>`;
        html += `<div style="margin-top:4px;">${P.idle.toLocaleString()} people of idle households (${pct(P.idleShare)} of the hands)${P.deficit > 0 ? ` · short ${Utils.formatGold(P.deficit)}g a day of their bread, fuel and clothes` : ' · every household meets its basket'}</div>`;
        const by = Object.entries(P.by).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]);
        if (by.length) html += `<div style="margin-top:3px;">How they get by: ${by.map(([k, v]) => `${SRC[k] || k} ${pct(v)}`).join(' · ')}</div>`;
        if (P.hunger >= 0.005) {
            const hc = P.hunger >= 0.15 ? '#e74c3c' : '#e67e22';
            html += `<div style="margin-top:3px; color:${hc};">🥖 About ${pct(P.hunger)} of the people go short of bread${P.cut && P.cut.food ? ` (${pct(P.cut.food)} of the town's bread unbought)` : ''}.${P.dead ? ` ${P.dead.toLocaleString()} have died of hunger here.` : ''}</div>`;
        } else if (P.dead) html += `<div style="${NOTE}">${P.dead.toLocaleString()} died of hunger here in leaner days.</div>`;
        const law = s.kingdom != null ? Laws.value(world, s.kingdom, 'poorRelief') : null;
        html += `<div style="${NOTE} margin-top:4px;">Poor relief: <b>${RELIEF[P.relief] || P.relief}</b>${law && law !== P.relief ? ' (the town\'s own rate)' : ''} · savings put by ${Utils.formatGold(P.sav)}g · ${P.almshouse ? `the almshouse ${P.almshouse.by === 'player' ? 'you endowed ' : ''}` : 'the poor box '}holds <b>${Utils.formatGold(P.box)}g</b>${P.boxDays ? ` (about ${P.boxDays} days of their want)` : ''}${P.boxOut ? `, ${Utils.formatGold(P.boxOut)}g given out` : ''}.</div>`;
        html += `<div style="${NOTE}">The poor buy their bread from their wages; the idle have none. Savings, day labour, the church, the guilds and the lords, a poor rate, begging, theft and pawning carry them; what is still short goes unbought — clothes, then fuel, then bread — and hunger brings sickness, death and flight to other towns.</div>`;
        const here = player.q === s.q && player.r === s.r;
        const gold = Number(player.gold) || 0;
        const rows = [];
        const AH = (TownPoor.config().almshouse || {});
        if (here && !s.inKind) {
            for (const g of AH.gifts || [50, 200, 1000]) {
                rows.push({ icon: '🥣', name: `Give ${Utils.formatGold(g)}g to the ${P.almshouse ? 'almshouse' : 'poor box'}`, desc: !P.almshouse && P.given + g >= (AH.foundAt || 200) ? 'Endows an almshouse: its dole feeds the hungry, and the town remembers who gave it' : 'Paid out as the dole when the poor go short', side: price(g, gold >= g), act: 'townPoorAct', args: ['give', s.q, s.r, g] });
            }
        }
        if (_rules(game, s) && P.relief !== 'crownDole' && law !== 'rate') {
            const on = !!(s.ordinances && s.ordinances.poorRate === 'rate');
            rows.push({ icon: '📜', name: on ? 'End the town\'s poor rate' : 'Levy a poor rate', desc: on ? 'Its poor live on alms again' : 'The burghers pay for their poor in hard times, out of the town\'s purse', act: 'townPoorAct', args: [on ? 'rateOff' : 'rateOn', s.q, s.r, 0] });
        }
        html += rowList(rows);
        html += '</div>';
    }
    const H = TownHousing.summary(s);
    if (H) {
        const cl = TownHousing.crowdLabel(H.crowd);
        const kinds = Object.entries(H.d).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${n.toLocaleString()} ${HOUSE[id] || id}`).join(', ');
        html += `<div style="${CARD}"><b>Housing</b> · <span style="color:${cl.color};">${cl.label}</span>`;
        html += `<div style="margin-top:4px;">Houses for <b>${H.cap.toLocaleString()}</b> (${pct(H.crowd)} full) and rooms to let for ${H.rooms.toLocaleString()} more · ${kinds}</div>`;
        if (H.lodged || H.rough) html += `<div style="margin-top:3px; color:${H.rough ? '#e67e22' : '#e8a040'};">${H.lodged.toLocaleString()} lodgers in rooms let${H.rough ? ` · ${H.rough.toLocaleString()} doubled up or sleeping rough` : ''}</div>`;
        html += `<div style="margin-top:3px;">Rents ${H.rentMult >= 1 ? '+' : ''}${Math.round((H.rentMult - 1) * 100)}% on the usual · ${H.building ? `${H.building} going up · ` : ''}${Math.round(H.free)} free plots of ${Math.round(H.plots)} · next to rise: ${HOUSE[H.next] || H.next}</div>`;
        html += `<div style="${NOTE}">Past its houses, a town lets its upper rooms; past those its people double up and sleep rough — rents climb, fevers and fires spread, it grows no more and its people leave. Where plots are scarce it builds row houses and tenements. You may raise a tenement on a lot of yours and let it by the room.</div>`;
        html += '</div>';
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The poor panel's buttons: give to the box, set the town's poor rate. */
    townPoorAct(game, op, q, r, amount) {
        const { world, player } = game;
        const t = world.getTile(q, r);
        const s = t && t.settlement;
        if (!s) return;
        let res = null;
        if (op === 'give') res = TownPoor.give(player, world, s, amount);
        else if (op === 'rateOn' || op === 'rateOff') res = _rules(game, s) ? TownPoor.setRate(player, world, s, op === 'rateOn') : { success: false, reason: 'Only one who rules the town may levy its rate.' };
        if (!res) return;
        game.ui.showNotification(res.success ? (res.founded ? '🥣 An Almshouse' : '🥣 The Poor') : 'Cannot', res.success ? res.text : res.reason, res.success ? 'success' : 'error');
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        if (typeof ActionMenu.showTownPeople === 'function') ActionMenu.showTownPeople(game, t, q, r);
    },
});
