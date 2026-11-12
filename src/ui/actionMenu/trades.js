// ActionMenu — a town's Trades & Workers (systems/townJobs.js): each trade,
// the named hands at it (rank, years, hurt, hungry, at your order) and how
// its output stands against a full complement. Shown in the People panel
// (actionMenu/labour.js). Pure string builder.
import { TownJobs } from '../../systems/townJobs.js';
import { rowList, sectionHead, esc } from './uiKit.js';

const RANK = { apprentice: 'apprentice', journeyman: 'journeyman', master: '' };

/** The Trades & Workers section for a settlement ('' for a town nobody has walked through yet). */
export function tradesHtml(game, settlement) {
    const world = game && game.world;
    const rows = TownJobs.trades(settlement, world);
    if (!rows || !rows.length) return '';
    const out = [];
    for (const r of rows) {
        if (!r.workers.length && !r.planned) continue;
        const who = r.workers.map(w => {
            const bits = [RANK[w.rank] || '', w.years >= 1 && w.rank === 'master' ? `${w.years}y` : '', w.state || ''].filter(Boolean).join(', ');
            return `${esc(w.name)}${bits ? ` <small style="color:#9a927f;">(${esc(bits)})</small>` : ''}`;
        }).join(' · ');
        const f = r.factor;
        const tone = f == null ? '' : f < 0.6 ? 'bad' : f < 0.9 ? 'warn' : 'good';
        const side = f == null ? `${r.workers.length}` : `<span style="color:${f < 0.6 ? '#e07a5f' : f < 0.9 ? '#e8b04a' : '#9fd59f'};">${Math.round(f * 100)}%</span>`;
        out.push({
            icon: r.icon || '•',
            name: `${esc(r.name.charAt(0).toUpperCase() + r.name.slice(1))}${r.planned ? ` <small style="color:#9a927f;">${r.workers.length}/${r.planned}</small>` : ''}`,
            desc: who || '<i>No one — the trade stands empty.</i>',
            side, tone,
            title: f == null ? '' : `Output of ${r.goods.slice(0, 6).join(', ')}${r.goods.length > 6 ? '…' : ''} at ${Math.round(f * 100)}% of a full complement`,
        });
    }
    if (!out.length) return '';
    return `${sectionHead('🔨 Trades &amp; Workers')}<div style="font-size:11px; color:var(--text-secondary); margin:2px 0 4px;">The town's named masters, journeymen and apprentices. Each trade's goods come to market as its hands allow: lose the smith and the iron goods dwindle till another takes up the forge.</div>${rowList(out)}`;
}
