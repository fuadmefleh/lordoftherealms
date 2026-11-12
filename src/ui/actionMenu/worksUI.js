// ActionMenu — the "under construction" card shared by the build panels:
// a progress bar, work-days left, an ETA at the pace of the seasons, today's
// pace (season, weather, crews) and buttons to hire or let go crews of hands
// (systems/construction.js).
import { Construction } from '../../systems/construction.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, card } from './uiKit.js';

const _bar = (pct, fill, h = 8) => `<div style="background:rgba(0,0,0,0.35); border-radius:4px; height:${h}px; overflow:hidden; margin:6px 0 3px;"><div style="width:${pct}%; height:100%; background:${fill}; transition:width 0.3s;"></div></div>`;

/**
 * HTML for a build under way at (q, r). `reopen` redraws the panel after
 * hiring or dismissing a crew. Installs window._worksHire / window._worksDismiss.
 */
export function worksCard(game, rec, q, r, reopen, opts = {}) {
    if (!rec || !rec.underConstruction) return '';
    const world = game.world;
    const C = Construction.config();
    const pct = Math.round(Construction.progress(rec) * 100);
    const left = Math.max(0, Math.ceil(Construction.total(rec) - Construction.done(rec)));
    const eta = Construction.eta(rec, world, q, r);
    const p = Construction.pace(world, q, r, rec);
    const crews = Math.max(0, Math.floor(rec.crews || 0));
    const max = Math.max(0, Math.floor(C.crews.max || 0));
    const wage = Construction.crewWage(world, q, r);
    const color = pct > 66 ? '#8fd18a' : pct > 33 ? '#f0b35a' : '#e0846a';
    const paceTxt = `today's pace ×${p.pace.toFixed(2)}${p.notes.length ? ` (${p.notes.join(', ')})` : ''}`;
    const canHire = crews < max && (game.player.gold || 0) >= wage;
    const btns = [
        `<button style="${canHire ? BTN_GOLD : BTN_OFF}" ${canHire ? 'onclick="window._worksHire()"' : 'disabled'} title="${C.crews.hands} more labourers from the nearest town, paid daily: +${Math.round(C.crews.speedPerCrew * 100)}% pace">Hire a crew (${wage}g/day)</button>`,
        crews > 0 ? `<button style="${BTN_PLAIN}" onclick="window._worksDismiss()">Let a crew go</button>` : '',
    ].join('');
    const body = _bar(pct, color)
        + `<div style="font-size:11px; color:#9d937c;">${pct}% done · ${left} work-day${left !== 1 ? 's' : ''} left · ${paceTxt}</div>`
        + `<div style="font-size:11px; color:#9d937c; margin-top:2px;">Crews hired: ${crews}/${max}${crews ? ` · ${Math.round(crews * wage * 10) / 10}g a day` : ''}${opts.note ? ` · ${opts.note}` : ''}</div>`
        + `<div style="margin-top:4px;">${btns}</div>`;
    window._worksHire = () => {
        const res = Construction.hireCrew(game.player, rec, world, q, r);
        if (!res.success) game.ui.showNotification('Cannot Hire', res.reason, 'error');
        else game.ui.showNotification('🏗️ Crew Hired', `${res.crews} crew${res.crews > 1 ? 's' : ''} now at work (${res.wage}g a day each).`, 'info');
        game.ui.updateStats(game.player, world);
        if (typeof reopen === 'function') reopen();
    };
    window._worksDismiss = () => {
        Construction.dismissCrew(rec);
        if (typeof reopen === 'function') reopen();
    };
    return card(body, { icon: '🏗️', title: opts.title || 'Under Construction', side: `done in ~${eta} day${eta !== 1 ? 's' : ''}`, tone: 'gold' });
}
