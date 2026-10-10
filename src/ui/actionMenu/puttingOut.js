// ActionMenu — the Putting-Out system: the cottagers about the town where you
// stand (households, how many have time this season, the piece rates against
// a guild workshop's, the weavers' guild's stance), putting out the wool and
// flax you carry, the work you have out and the cloth to collect, and what
// the merchant houses put out here. Logic lives in systems/puttingOut.js;
// buttons route through data-am-act → ActionMenu.puttingOutAct.
import { ActionMenu } from './_ref.js';
import { PuttingOut } from '../../systems/puttingOut.js';
import { Estates } from '../../world/estates.js';
import { Seasons } from '../../world/seasons.js';

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';

let _rate = 'fair';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="puttingOutAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The Putting-Out system at the town where you stand. */
    showPuttingOut(game, tile = null) {
        const { player, world } = game;
        const t = tile || world.getTile(player.q, player.r);
        const live = t && t.settlement;
        const C = PuttingOut.config();
        const day = world.day;
        let html = '<div style="font-size:12px; max-height:640px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Gold ${Math.floor(player.gold)}</p>`;
        html += `<div style="${NOTE}">Put out raw wool and flax to the cottagers, who spin and weave at home for a piece rate and hand back textiles and linen. Cheaper than a guild workshop and slower; the work is good or coarse by the hands it finds. They have time for it in winter, little at harvest — and out of season it takes hands from the fields. Where the weavers' guild holds a royal charter its officers may seize the cloth and fine you; the villages have no guild.</div>`;
        if (!live) {
            html += `<div style="${NOTE}">Stand in a town or village to put work out.</div>`;
        } else {
            const hh = PuttingOut.households(live);
            const slack = PuttingOut.slack(day);
            const stance = PuttingOut.guildStance(player, live);
            const rec = Estates.town(world, live.q, live.r);
            html += `<div style="${CARD}"><b>${esc(live.name)}</b>: ${hh} cottage households · ${Math.round(slack * 100)}% have time for it this ${esc(Seasons.seasonOf(day).toLowerCase())} · they spin and weave about ${PuttingOut.playerCapacity(live, day).toFixed(1)} units a day for you`
                + `<br><span style="${NOTE}">${stance.kind === 'chartered' ? `⚠️ The ${esc(stance.guild.name)} holds a royal charter: ${Math.round(C.chartered.chance * 100)}% chance its officers seize ${Math.round(C.chartered.seize * 100)}% of the cloth and fine you${stance.exempt ? ' — but you are of the guild, and let be' : ''}.`
                    : stance.kind === 'open' ? `The ${esc(stance.guild.name)} frowns on it: ${Math.round(C.open.chance * 100)}% chance of a fine${stance.exempt ? ' (you are of the guild: let be)' : ''}.` : 'No weavers\' guild here: the cottagers work unmolested.'}</span>`
                + `${rec && rec.npcWeek ? `<br><span style="${NOTE}">The merchant houses put out ${Math.round(rec.npcWeek)} units of fibre here last week.</span>` : ''}${rec && rec.wages ? `<br><span style="${NOTE}">Your piece wages paid here: ${rec.wages}g.</span>` : ''}${rec && rec.draw > 0 ? `<br><span style="${NOTE}">The cottage work keeps ${Math.round(rec.draw * 100)}% of the field work undone this season.</span>` : ''}</div>`;
            html += '<div style="margin:6px 0;">Piece rate: ';
            for (const [id, r] of Object.entries(C.rates)) html += act(`${esc(r.label)} (${Math.round(r.share * 100)}%)`, ['rate', id], _rate === id ? BTN_GOLD : BTN_PLAIN, true, `${Math.round(r.share * 100)}% of the cloth's worth a piece; ${r.speed > 1 ? 'more take the work' : r.speed < 1 ? 'fewer take the work' : 'the usual hands'}; ${r.quality > 0 ? 'finer' : r.quality < 0 ? 'coarser' : 'common'} work`);
            html += '</div>';
            for (const [input, G] of Object.entries(C.goods)) {
                const have = Math.floor((player.inventory && player.inventory[input]) || 0);
                html += `<div style="${CARD}"><b>${esc(input)}</b> → ${esc(G.out)} · you carry ${have}`;
                if (have > 0) {
                    const q = PuttingOut.quote(player, world, t, input, have, _rate);
                    html += `<br><span style="${NOTE}">All of it: about ${q.expect} ${esc(G.out)} in ${Number.isFinite(q.days) ? q.days : '—'} days for ${q.wage}g in piece wages (a guild workshop: about ${q.guildCost}g).</span><br>`;
                    for (const n of [...new Set([10, 25, have].filter(x => x >= C.minBatch && x <= have))]) {
                        const qn = PuttingOut.quote(player, world, t, input, n, _rate);
                        html += act(`Put out ${n === have ? 'all' : n} (${qn.wage}g)`, ['put', input, n], BTN_GOLD, qn.ok, qn.reason || '');
                    }
                }
                html += '</div>';
            }
        }
        const list = PuttingOut.batches(player);
        if (list.length) {
            html += `<div style="${CARD}"><b>Work out</b>`;
            for (const b of list) {
                const here = live && b.q === live.q && b.r === live.r;
                html += `<div style="margin-top:4px;">${esc(b.qty)} ${esc(b.input)} at ${esc(b.name)} (day ${b.start}, ${esc((C.rates[b.rate] || {}).label || b.rate)}): `
                    + (b.done ? `<b>${b.units} ${esc(b.output)} ready</b>${b.quality < 0.92 ? ' (coarse)' : b.quality > 1 ? ' (fine)' : ''} — waits until day ${b.readyDay + C.holdDays}` : `${Math.round(b.worked / b.qty * 100)}% spun and woven`)
                    + '</div>';
                if (b.done && here) html += act('Collect the cloth', ['collect'], BTN_GOLD);
            }
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel(`🧶 Putting-Out${live ? ` — ${live.name}` : ''}`, html);
    },

    puttingOutAct(game, op, a = null, b = null) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'rate': _rate = a || 'fair'; break;
            case 'put': res = PuttingOut.putOut(player, world, tile, a, b, _rate); break;
            case 'collect': res = PuttingOut.collect(player, world, tile); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🧶 Putting-Out', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showPuttingOut(game, tile);
    },
});
