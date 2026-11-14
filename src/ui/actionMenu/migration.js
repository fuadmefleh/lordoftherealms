// ActionMenu — Migration: a town's comings and goings (a card in the People
// panel, ui/actionMenu/labour.js), and the realm's view — where people are
// going and why, the columns on the roads, and the player's settlers and
// borders policy over their own towns. Logic lives in systems/migration.js.
//
//   migrationHtml(game, settlement)   the town card (exported for the People panel and tests)
//   showMigration(game)                the realm view and the policy
//   migrationAct(game, op, value)      'settlers' | 'borders' → set the policy
import { ActionMenu } from './_ref.js';
import { Migration } from '../../systems/migration.js';
import { Taxation } from '../../systems/marketDynamics.js';
import { CARD, rowList, sectionHead, lede, chips, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

/** A tiny sparkline of the town's head count (inline SVG, no colours beyond the trend's). */
function spark(history, color) {
    if (!Array.isArray(history) || history.length < 2) return '';
    const W = 180, H = 28;
    const ps = history.map(h => h[1]);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const span = Math.max(1, hi - lo);
    const pts = history.map((h, i) => `${Math.round(i / (history.length - 1) * W)},${Math.round(H - 2 - (h[1] - lo) / span * (H - 4))}`).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block; margin-top:4px;" aria-label="population over the last years"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

/** One logged coming or going as a line. */
function logLine(e) {
    const R = Migration.reasonDef(e.w);
    const why = e.i ? (R.pull || R.push || '') : (R.push || R.pull || '');
    return e.i
        ? `Day ${e.d}: ${R.icon || ''} <b>${e.n}</b> came from ${esc(e.t)}${why ? ` — ${esc(why)}` : ''}${e.k === 'refugees' ? ' (refugees)' : ''}.`
        : `Day ${e.d}: ${R.icon || ''} <b>${e.n}</b> left for ${esc(e.t)}${why ? ` — ${esc(why)}` : ''}${e.k === 'refugees' ? ' (fled)' : ''}.`;
}

/** The town's comings and goings: its trend, the year's arrivals and departures and why, recent moves, its houses. */
export function migrationHtml(game, settlement) {
    const world = game && game.world;
    const t = Migration.trend(settlement, world ? world.day : null);
    if (!t) return '';
    let html = `<div style="${CARD}"><b>Comings and goings</b>`;
    if (!t.history.length && !t.recent.length) {
        html += `<div style="${NOTE}">No one has kept count of who comes and goes here yet. Come back in a month.</div></div>`;
        return html;
    }
    const pct = Math.round(t.change * 100);
    html += `<div style="margin-top:4px;">The town is <b style="color:${t.color};">${t.label}</b>${t.span >= 30 ? ` — ${pct >= 0 ? '+' : ''}${pct}% in ${t.span >= 100 ? 'the last year' : `${t.span} days`}` : ''}.</div>`;
    html += spark(t.history, t.color);
    if (t.yearIn || t.yearOut) {
        html += `<div style="margin-top:4px;">This year <b>${t.yearIn}</b> came and <b>${t.yearOut}</b> left.</div>`;
        const ins = t.why.filter(w => w.in).slice(0, 3).map(w => { const R = Migration.reasonDef(w.id); return `${R.icon || ''} ${w.n} ${esc(R.pull || R.push || w.id)}`; });
        const outs = t.why.filter(w => !w.in).slice(0, 3).map(w => { const R = Migration.reasonDef(w.id); return `${R.icon || ''} ${w.n} ${esc(R.push || R.pull || w.id)}`; });
        if (ins.length) html += `<div style="${NOTE}">Came: ${ins.join(' · ')}</div>`;
        if (outs.length) html += `<div style="${NOTE}">Left: ${outs.join(' · ')}</div>`;
    }
    if (t.vacant) html += `<div style="${NOTE} color:#e8a040;">🏚️ About ${Math.round(t.vacant * 100)}% of its houses stand empty, shuttered and going to ruin.</div>`;
    if (t.fresh) html += `<div style="${NOTE} color:#9fd59f;">🏗️ New houses stand fresh along its lanes: about ${Math.round(t.fresh * 100)}% are newly built.</div>`;
    // The named newcomers of its roster (systems/townsfolk.js)
    const folk = settlement.folk;
    if (folk && Array.isArray(folk.people) && world) {
        const fresh = folk.people.filter(p => p && p.died == null && !p.away && p.mig && world.day - p.mig.d <= 240 && p.role !== 'child');
        if (fresh.length) {
            const names = fresh.slice(-4).map(p => `${esc(p.first)} ${esc(p.last)} <small style="color:#999;">from ${esc(p.mig.from)}</small>`);
            html += `<div style="${NOTE} margin-top:4px;">New faces: ${names.join(', ')}${fresh.length > 4 ? ` and ${fresh.length - 4} more` : ''}.</div>`;
        }
        const gone = folk.people.filter(p => p && p.away && p.away.mig && world.day - p.away.d <= 240);
        if (gone.length) {
            const names = gone.slice(-3).map(p => `${esc(p.first)} ${esc(p.last)} <small style="color:#999;">to ${esc(p.away.to)}</small>`);
            html += `<div style="${NOTE}">Moved away: ${names.join(', ')}${gone.length > 3 ? ` and ${gone.length - 3} more` : ''}.</div>`;
        }
    }
    if (t.recent.length) html += `<div style="${NOTE} margin-top:4px;">${t.recent.slice(0, 5).map(logLine).join('<br>')}</div>`;
    html += `<div style="${NOTE} margin-top:4px;">People leave war, sieges, hunger, plague, harsh taxes and laws, thieves and idleness, and go where the work, the wages and the safety are — and where their kin went before them.</div>`;
    html += rowList([{ icon: '🧭', name: 'Where the people are going', desc: 'the realm\'s flows, the roads\' columns, your settlers and borders', act: 'showMigration', side: '›' }]);
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** The realm view: the year's gaining and losing towns, the great flows, the columns, and the policy. */
    showMigration(game) {
        const { world, player } = game;
        const pol = Migration.policy(world);
        const P = Migration.config().policy;
        const ruled = player ? Taxation.getPlayerSettlements(player, world) : [];
        let html = lede('Families move toward prosperous, safe towns with work, and away from war, hunger, plague and hard rule. Over the decades whole towns rise and empty.');
        const cols = Migration.columns(world);
        html += chips([
            ['🎒', 'On the roads', `${cols.length} column${cols.length === 1 ? '' : 's'}`],
            ['👥', 'Moving', cols.reduce((a, u) => a + (u.population || 0), 0).toLocaleString()],
        ]);

        // ── The player's policy over their own towns ──
        if (ruled.length) {
            html += sectionHead(`📜 Your towns (${ruled.length})`);
            html += `<div style="${NOTE}">Lower taxes draw people too (your tax rate is ${esc(String(player.taxRate || 'moderate').replace('_', ' '))}).</div>`;
            html += rowList(Object.entries(P.settlers).map(([id, d]) => ({
                icon: id === pol.settlers ? '●' : '○', name: esc(d.label), desc: esc(d.hint || ''),
                act: id === pol.settlers ? null : 'migrationAct', args: ['settlers', id],
                side: id === pol.settlers ? 'in force' : (d.cost ? `${d.cost}g a head` : '›'), tone: id === pol.settlers ? 'gold' : null,
            })), 'Settlers');
            html += rowList(Object.entries(P.borders).map(([id, d]) => ({
                icon: id === pol.borders ? '●' : '○', name: esc(d.label), desc: esc(d.hint || ''),
                act: id === pol.borders ? null : 'migrationAct', args: ['borders', id],
                side: id === pol.borders ? 'in force' : '›', tone: id === pol.borders ? (id === 'closed' ? 'warn' : 'gold') : null,
            })), 'Borders');
            const rows = [];
            for (const ref of ruled) {
                const s = ref.settlement || (world.getTile(ref.q, ref.r) || {}).settlement;
                if (!s) continue;
                const line = Migration.trendLine(s, world.day) || 'not yet counted';
                const yr = s.migr && s.migr.yr;
                rows.push({ icon: '🏘️', name: esc(s.name), desc: `${Math.round(s.population || 0).toLocaleString()} people · ${esc(line)}${yr ? ` · this year +${yr.in || 0} / −${yr.out || 0}` : ''}`, act: 'showTownPeople', args: [null, ref.q, ref.r], side: '›' });
            }
            html += rowList(rows.slice(0, 12), 'How your towns fare');
        }

        // ── The year's movement across the known world ──
        const { gaining, losing } = Migration.realmFlows(world);
        const flowRow = (x) => {
            const R = x.top ? Migration.reasonDef(x.top.id) : null;
            const why = R ? (x.top.in ? R.pull || R.push : R.push || R.pull) : '';
            return { icon: x.net > 0 ? '📈' : '📉', name: esc(x.s.name), desc: `+${x.in} / −${x.out} this year${why ? ` · most ${esc(why)}` : ''}`, side: `${x.net > 0 ? '+' : ''}${x.net}`, tone: x.net > 0 ? 'good' : 'warn', act: 'showTownPeople', args: [null, x.q, x.r] };
        };
        if (gaining.length) html += rowList(gaining.map(flowRow), 'Drawing people this year');
        if (losing.length) html += rowList(losing.map(flowRow), 'Losing people this year');

        // ── The great flows on record ──
        const big = Migration.flows(world, 10);
        if (big.length) {
            html += sectionHead('🛤️ Great movements');
            html += `<div style="${NOTE}">${big.map(f => {
                const R = Migration.reasonDef(f.w);
                return `Day ${f.d}: ${R.icon || ''} ${f.n} ${f.k === 'refugees' ? 'fled' : 'went'} from ${esc(f.from)} to ${esc(f.to)}${R.push || R.pull ? ` — ${esc(f.k === 'refugees' ? R.push || R.pull : R.pull || R.push)}` : ''}.`;
            }).join('<br>')}</div>`;
        }
        if (cols.length) {
            html += rowList(cols.slice(0, 8).map(u => ({ icon: u.icon || '🎒', name: esc(u.name), desc: `${u.population} on the road to ${esc(u.toName || '?')}`, side: `${Math.max(0, (world.day || 0) - (u.start || 0))}d` })), 'Columns on the roads');
        }
        if (!gaining.length && !losing.length && !big.length && !cols.length) html += `<div style="${NOTE}">Nobody has kept count yet: give it a few weeks.</div>`;
        game.ui.showCustomPanel('🧭 Where the People Go', `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${html}</div>`);
    },

    /** Set the player's settlers or borders policy, then show the view again. */
    migrationAct(game, op, value) {
        const ok = Migration.setPolicy(game.world, op, value);
        if (ok) {
            const d = Migration.config().policy[op][value];
            game.ui.showNotification(op === 'settlers' ? '📜 Settlers' : '🚧 Borders', `${d.label}: ${d.hint || ''}`, 'info');
        }
        ActionMenu.showMigration(game);
    },
});
