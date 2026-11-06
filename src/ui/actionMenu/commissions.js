// ActionMenu — Hire the Tradesmen: a town's mill, baker, smithy, tannery…
// work your goods for a fee or a cut of the product (systems/commissions.js).
// Buttons route through data-am-act → ActionMenu.commissionAct.
import { ActionMenu } from './_ref.js';
import { Commissions } from '../../systems/commissions.js';
import { PracticeSkills } from '../../systems/practiceSkills.js';
import { Grades } from '../../core/grades.js';
import { MarketGrades } from '../../world/marketGrades.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="commissionAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
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
        let html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;"><p style="margin:0 0 6px; color:var(--text-secondary);">💰 ${Math.floor(player.gold || 0)} gold · bring your own goods; pay with gold, or let them keep a share of what they make. <span style="color:${lb.color}">${lb.name} craftsmen</span>: the better the town's hands (and your goods), the more of the work comes back Fine.</p>`;

        // Work waiting here
        const mine = Commissions.pending(player).filter(j => j.q === s.q && j.r === s.r);
        if (mine.length) {
            html += `<div style="${CARD}"><b>Your work in ${esc(s.name)}</b>`;
            let anyReady = false;
            for (const j of mine) {
                const ready = Commissions.isReady(j, world);
                anyReady = anyReady || ready;
                html += `<div style="margin:3px 0;">${ready ? '✅' : '⏳'} ${esc(j.label)} — ${goods(j.out)} <span style="${NOTE}">(${esc(j.who)}${ready ? ', ready' : `, ready on day ${j.readyDay}`})</span></div>`;
            }
            html += act('Collect what is ready', ['collect'], BTN_GOLD, anyReady, 'Nothing is ready yet.');
            html += '</div>';
        }
        const away = Commissions.pending(player).filter(j => j.q !== s.q || j.r !== s.r);
        if (away.length) html += `<div style="${NOTE}; margin:4px 0;">Elsewhere: ${away.map(j => `${esc(j.label)} in ${esc(j.town)}`).join(', ')}.</div>`;

        // What the town's tradesmen will do
        const offers = Commissions.offers(world, s);
        const usable = offers.map(o => ({ o, max: Commissions.maxRuns(player, o) }));
        usable.sort((a, b) => (b.max > 0) - (a.max > 0) || a.o.label.localeCompare(b.o.label));
        const showAll = !!opts.all;
        let shown = 0;
        for (const { o, max } of usable) {
            if (!showAll && max <= 0) continue;
            shown++;
            html += `<div style="${CARD}"><b>${o.icon ? esc(o.icon) + ' ' : ''}${esc(o.label[0].toUpperCase() + o.label.slice(1))}</b> <span style="${NOTE}">— ${esc(o.who)}, ${o.perDay} a day</span><br>`;
            html += `<span style="${NOTE}">Each: ${goods(o.in)} → ${goods(o.out)}</span><br>`;
            // The town's best hand at the work (systems/tradeSkills.js)
            const q1 = Commissions.quote(player, world, s, o, 1, 'fee');
            if (q1.master) html += `<span style="${NOTE}">Worked by ${esc(q1.master.name)}, ${esc(q1.master.role)} — ${esc(PracticeSkills.def(Commissions.skillOf(o)).name)} ${q1.master.level} (${esc(q1.master.levelName)})${q1.masterBonus > 0 ? ', finer work than most' : q1.masterBonus < 0 ? ', rougher work than most' : ''}</span><br>`;
            if (max <= 0) {
                html += `<span style="${NOTE}">You have nothing for them to work.</span></div>`;
                continue;
            }
            const counts = [...new Set([1, Math.min(max, 5), Math.min(max, 20), max])].filter(n => n >= 1);
            for (const n of counts) {
                const qf = Commissions.quote(player, world, s, o, n, 'fee');
                const qc = Commissions.quote(player, world, s, o, n, 'cut');
                html += `<div style="margin-top:3px;">×${n}: `;
                html += act(`💰 ${qf.fee}g → ${goods(qf.give)}`, ['hire', o.id, n, 'fee'], BTN_GOLD, (player.gold || 0) >= qf.fee, `Not enough gold (${qf.fee}g).`);
                const cutOk = Object.values(qc.give).some(v => v > 0);
                html += act(`✂️ their cut → ${goods(qc.give) || 'nothing'}`, ['hire', o.id, n, 'cut'], BTN_PLAIN, cutOk, 'Too little: bring more.');
                if (qf.days > 0) html += ` <span style="${NOTE}">${qf.days + 1} days</span>`;
                html += gradeNote(qf.grades);
                html += '</div>';
            }
            html += '</div>';
        }
        if (!shown) html += `<div style="${NOTE}; margin:6px 0;">You carry nothing the tradesmen here could work. Grain for the mill or the baker, wool for the weavers, hides for the tannery, iron and coal for the smithy…</div>`;
        html += act(showAll ? 'Show only what I can bring' : `Show every trade in ${esc(s.name)} (${offers.length})`, ['all', !showAll], BTN_PLAIN);
        html += '</div>';
        game.ui.showCustomPanel(`🏭 The Tradesmen of ${s.name}`, html);
    },

    commissionAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'hire') res = Commissions.commission(player, world, a, b, c);
        else if (op === 'collect') res = Commissions.collect(player, world);
        else if (op === 'all') { ActionMenu.showCommissions(game, { all: !!a }); return; }
        if (res) {
            game.ui.showNotification('🏭 Tradesmen', res.success ? res.text : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showCommissions(game);
    },
});
