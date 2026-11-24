// ActionMenu helper — the convict roll at one of your sites (a mine or
// quarry, a ship, a war galley): who is chained there, for what, and how
// many days they have left (systems/penalLabour.js). A card in the action
// menu's voice, a row a convict (uiKit rowList), for the property, ship and
// fleet panels.
import { PenalLabour } from '../../systems/penalLabour.js';
import { rowList, card, esc } from './uiKit.js';

const NOTE = 'font-size:11px; color:#9d937c;';

/** The roll for a site key ('prop:q,r:type' | 'ship:id' | 'galley:id'). opts = { empty, note, title }. */
export function convictRoll(game, siteKey, opts = {}) {
    const { player, world } = game;
    const list = PenalLabour.convictsAt(player, siteKey);
    const day = (world && world.day) || 0;
    const head = opts.title || 'Convicts';
    if (!list.length) return opts.empty ? card(`<div style="${NOTE}">${esc(opts.empty)}</div>`, { icon: '⛓️', title: head, side: '0' }) : '';
    const rows = list.slice().sort((a, b) => a.until - b.until).map(c => ({
        icon: c.kind === 'mines' ? '⛏️' : '⚓',
        name: esc(c.name),
        desc: `for ${esc(c.crime || 'a crime')} · since day ${c.from}`,
        side: `${Math.max(0, c.until - day)}d left`,
        tone: c.until - day <= 7 ? 'good' : '',
    }));
    return card(`${opts.note ? `<div style="${NOTE} margin-bottom:4px;">${esc(opts.note)}</div>` : ''}${rowList(rows)}`, { icon: '⛓️', title: head, side: `${list.length}`, tone: 'warn' });
}
