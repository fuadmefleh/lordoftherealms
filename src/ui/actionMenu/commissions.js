// ActionMenu — Hire the Tradesmen: a town's mill, baker, smithy, tannery…
// work your goods for a fee or a cut of the product (systems/commissions.js).
// Buttons route through data-am-act → ActionMenu.commissionAct.
import { ActionMenu } from './_ref.js';
import { Commissions } from '../../systems/commissions.js';
import { PracticeSkills } from '../../systems/practiceSkills.js';
import { Grades } from '../../core/grades.js';
import { MarketGrades } from '../../world/marketGrades.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, lede, chips, purse, actRow, rowList, price } from './uiKit.js';

const NOTE = 'font-size: 11px; color: #9d937c;';
// Small buttons for a row's side column (the row itself is then not a button)
const SMALL = 'padding:2px 8px; margin:2px 0 0 4px; font-size:11px;';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="commissionAct" data-am-args='${esc(JSON.stringify(args))}' style="${style} ${SMALL}">${label}</button>`;
}

/** The graded part of a quote ({ good: { fine: n, … } }) as coloured chips, or ''. */
const gradeNote = (grades) => {
    const parts = [];
    for (const [g, e] of Object.entries(grades || {})) {
        for (const id of ['masterwork', 'excellent', 'fine', 'poor']) {
            if (e[id] > 0) { const gr = Grades.get(id); parts.push(`<span style="color:${gr.color}">${e[id]} ${gr.name}</span> ${esc(Commissions._goodName(g).toLowerCase())}`); }
        }
    }
    return parts.length ? ` <span style="font-size:11px;">(${parts.join(', ')}; the rest Common)</span>` : '';
};

const goods = (obj) => Object.entries(obj).filter(([, n]) => n > 0).map(([g, n]) => `${+(+n).toFixed(2)} ${esc(Commissions._goodName(g).toLowerCase())}`).join(' + ');

Object.assign(ActionMenu, {
    /** The tradesmen of the town the player is in, and the work waiting there */
    showCommissions(game, opts = {}) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s) return;
        // (the town's craftsmanship sets the grades the work comes out in — world/marketGrades.js)
        const lb = MarketGrades.label(MarketGrades.level(s));
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold || 0), { icon: '⚒️', label: 'Craftsmen', value: `<span style="color:${lb.color}">${esc(lb.name)}</span>` }]);
        html += lede('Bring your own goods and pay in gold (💰) or let them keep a share of what they make (✂️). The better the town\'s hands and your goods, the more comes back Fine.');

        // Work waiting here
        const mine = Commissions.pending(player).filter(j => j.q === s.q && j.r === s.r);
        if (mine.length) {
            const rows = mine.map(j => {
                const ready = Commissions.isReady(j, world);
                return { icon: ready ? '✅' : '⏳', name: esc(j.label), desc: `${goods(j.out)} · ${esc(j.who)}`, side: ready ? 'ready' : `day ${j.readyDay}`, tone: ready ? 'good' : '' };
            });
            const anyReady = mine.some(j => Commissions.isReady(j, world));
            rows.push({ icon: '📦', name: 'Collect what is ready', desc: 'Into your packs', act: 'commissionAct', args: ['collect'], off: !anyReady, why: 'Nothing is ready yet', side: '›', tone: 'gold' });
            html += rowList(rows, `Your work in ${esc(s.name)}`);
        }
        const away = Commissions.pending(player).filter(j => j.q !== s.q || j.r !== s.r);
        if (away.length) html += `<div style="${NOTE} margin:4px 0;">Elsewhere: ${away.map(j => `${esc(j.label)} in ${esc(j.town)}`).join(', ')}.</div>`;

        // What the town's tradesmen will do
        const offers = Commissions.offers(world, s);

        // Order a piece of arms or armour: the weaponsmith buys the stuff out of the town's stock
        const armsOffers = offers.filter(o => o.kind === 'craft' && Commissions.isArmsOffer(o));
        if (armsOffers.length) {
            const rows = armsOffers.map(o => ({ o, q: Commissions.quote(player, world, s, o, 1, 'fee', { supply: true }) }))
                .sort((x, y) => (x.q.short.length > 0) - (y.q.short.length > 0) || x.q.total - y.q.total);
            html += rowList(rows.slice(0, opts.all ? rows.length : 12).map(({ o, q }) => {
                const short = q.short.length > 0;
                const desc = `${q.days + 1} day${q.days ? 's' : ''}, stuff and work${gradeNote(q.grades)}`;
                return {
                    icon: o.icon ? esc(o.icon) : '⚔️', name: esc(o.label), desc,
                    act: 'commissionAct', args: ['order', o.id],
                    off: short || (player.gold || 0) < q.total,
                    why: short ? `${esc(s.name)} has no ${q.short.map(g => esc(Commissions._goodName(g).toLowerCase())).join(' or ')} to spare` : `${desc} · your purse is short`,
                    side: price(q.total, (player.gold || 0) >= q.total),
                };
            }), `⚔️ Order arms and armour from ${esc(armsOffers[0].who)}`);
        }
        const usable = offers.map(o => ({ o, max: Commissions.maxRuns(player, o) }));
        usable.sort((a, b) => (b.max > 0) - (a.max > 0) || a.o.label.localeCompare(b.o.label));
        const showAll = !!opts.all;
        let shown = 0;
        for (const { o, max } of usable) {
            if (!showAll && max <= 0) continue;
            shown++;
            // The town's best hand at the work (systems/tradeSkills.js)
            const q1 = Commissions.quote(player, world, s, o, 1, 'fee');
            const master = q1.master ? ` · worked by ${esc(q1.master.name)}, ${esc(q1.master.role)} (${esc(PracticeSkills.def(Commissions.skillOf(o)).name)} ${q1.master.level}${q1.masterBonus > 0 ? ', finer work than most' : q1.masterBonus < 0 ? ', rougher work than most' : ''})` : '';
            const head = `${o.icon ? esc(o.icon) + ' ' : ''}${esc(o.label[0].toUpperCase() + o.label.slice(1))} <span style="text-transform:none; letter-spacing:0; font-weight:400;">— ${esc(o.who)}, ${o.perDay} a day</span>`;
            const rows = [];
            if (max <= 0) {
                rows.push({ icon: '·', name: `Each: ${goods(o.in)} → ${goods(o.out)}`, off: true, why: `You have nothing for them to work${master}` });
            } else {
                for (const n of [...new Set([1, Math.min(max, 5), Math.min(max, 20), max])].filter(x => x >= 1)) {
                    const qf = Commissions.quote(player, world, s, o, n, 'fee');
                    const qc = Commissions.quote(player, world, s, o, n, 'cut');
                    const cutOk = Object.values(qc.give).some(v => v > 0);
                    rows.push(actRow({
                        icon: `×${n}`, name: `${n} run${n > 1 ? 's' : ''} → you get ${goods(qf.give)}`,
                        desc: `${n === 1 ? `each: ${goods(o.in)} → ${goods(o.out)} · ` : ''}${qf.days > 0 ? `${qf.days + 1} days` : 'today'}${n === 1 ? master : ''}${gradeNote(qf.grades)}`,
                        note: `their cut instead: you get ${goods(qc.give) || 'nothing'}`,
                        side: act(`💰 ${qf.fee}g`, ['hire', o.id, n, 'fee'], BTN_GOLD, (player.gold || 0) >= qf.fee, `Not enough gold (${qf.fee}g).`)
                            + act('✂️ Their cut', ['hire', o.id, n, 'cut'], BTN_PLAIN, cutOk, 'Too little: bring more.'),
                    }));
                }
            }
            html += rowList(rows, head);
        }
        if (!shown) html += `<div style="${NOTE} margin:6px 0;">You carry nothing the tradesmen here could work. Grain for the mill or the baker, wool for the weavers, hides for the tannery, iron and coal for the smithy…</div>`;
        html += rowList([{ icon: '🔎', name: showAll ? 'Show only what I can bring' : `Show every trade in ${esc(s.name)}`, desc: showAll ? 'Hide the trades you have nothing for' : `${offers.length} trades in all`, act: 'commissionAct', args: ['all', !showAll], side: '›' }]);
        html += '</div>';
        game.ui.showCustomPanel(`🏭 The Tradesmen of ${s.name}`, html);
    },

    commissionAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'hire') res = Commissions.commission(player, world, a, b, c);
        else if (op === 'order') res = Commissions.commission(player, world, a, 1, 'fee', { supply: true });
        else if (op === 'collect') res = Commissions.collect(player, world);
        else if (op === 'all') { ActionMenu.showCommissions(game, { all: !!a }); return; }
        if (res) {
            game.ui.showNotification('🏭 Tradesmen', res.success ? res.text : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showCommissions(game);
    },
});
