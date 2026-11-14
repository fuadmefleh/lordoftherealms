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
import { BTN_GOLD, BTN_DIM, lede, chips, purse, actRow, rowList } from './uiKit.js';

const NOTE = 'font-size: 11px; color: #9d937c;';
// Small buttons for a listing row's side column (the row itself is then not a button)
const SMALL = 'padding:2px 8px; margin:2px 0 0 4px; font-size:11px;';

let _rate = 'fair';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="puttingOutAct" data-am-args='${esc(JSON.stringify(args))}' style="${style} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The Putting-Out system at the town where you stand. */
    showPuttingOut(game, tile = null) {
        const { player, world } = game;
        const t = tile || world.getTile(player.q, player.r);
        const live = t && t.settlement;
        const C = PuttingOut.config();
        const day = world.day;
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold)]);
        html += lede('Put out raw wool and flax to the cottagers to spin and weave at home for a piece rate: cheaper than a guild workshop, slower, and good or coarse by the hands it finds. They have time in winter, little at harvest.');
        if (!live) {
            html += `<div style="${NOTE}">Stand in a town or village to put work out.</div>`;
        } else {
            const hh = PuttingOut.households(live);
            const slack = PuttingOut.slack(day);
            const stance = PuttingOut.guildStance(player, live);
            const rec = Estates.town(world, live.q, live.r);
            html += chips([
                ['🏡', 'Cottages', hh],
                ['⏳', `Free this ${esc(Seasons.seasonOf(day).toLowerCase())}`, `${Math.round(slack * 100)}%`],
                ['🧶', 'Work for you', `${PuttingOut.playerCapacity(live, day).toFixed(1)} a day`],
            ]);
            const notes = [
                stance.kind === 'chartered' ? `⚠️ The ${esc(stance.guild.name)} holds a royal charter: ${Math.round(C.chartered.chance * 100)}% chance its officers seize ${Math.round(C.chartered.seize * 100)}% of the cloth and fine you${stance.exempt ? ' — but you are of the guild, and let be' : ''}.`
                    : stance.kind === 'open' ? `The ${esc(stance.guild.name)} frowns on it: ${Math.round(C.open.chance * 100)}% chance of a fine${stance.exempt ? ' (you are of the guild: let be)' : ''}.` : 'No weavers\' guild here: the cottagers work unmolested.',
                rec && rec.npcWeek ? `The merchant houses put out ${Math.round(rec.npcWeek)} units of fibre here last week.` : '',
                rec && rec.wages ? `Your piece wages paid here: ${rec.wages}g.` : '',
                rec && rec.draw > 0 ? `The cottage work keeps ${Math.round(rec.draw * 100)}% of the field work undone this season.` : '',
            ].filter(Boolean);
            html += `<div style="${NOTE} margin-bottom:6px;">${notes.join(' ')}</div>`;
            // The piece rate: a choice, so its rows light the one in force
            html += rowList(Object.entries(C.rates).map(([id, r]) => ({
                icon: _rate === id ? '✅' : '⚖️', name: `${esc(r.label)} <span style="font-weight:400; color:#9d937c;">· ${Math.round(r.share * 100)}% of the cloth's worth a piece</span>`,
                desc: `${r.speed > 1 ? 'more take the work' : r.speed < 1 ? 'fewer take the work' : 'the usual hands'}; ${r.quality > 0 ? 'finer' : r.quality < 0 ? 'coarser' : 'common'} work`,
                act: _rate === id ? null : 'puttingOutAct', args: ['rate', id], side: _rate === id ? 'in force' : 'Use ›', tone: _rate === id ? 'gold' : '',
            })), 'Piece rate');
            const put = [];
            for (const [input, G] of Object.entries(C.goods)) {
                const have = Math.floor((player.inventory && player.inventory[input]) || 0);
                if (!have) {
                    put.push({ icon: '🧺', name: `${esc(input)} → ${esc(G.out)}`, off: true, why: `You carry no ${esc(input)}` });
                    continue;
                }
                const q = PuttingOut.quote(player, world, t, input, have, _rate);
                const side = [...new Set([10, 25, have].filter(x => x >= C.minBatch && x <= have))].map(n => {
                    const qn = PuttingOut.quote(player, world, t, input, n, _rate);
                    return act(`${n === have ? 'All' : n} · ${qn.wage}g`, ['put', input, n], BTN_GOLD, qn.ok, qn.reason || '');
                }).join('');
                put.push(actRow({
                    icon: '🧺', name: `${esc(input)} → ${esc(G.out)} <span style="font-weight:400; color:#9d937c;">· you carry ${have}</span>`,
                    desc: `all of it: about ${q.expect} ${esc(G.out)} in ${Number.isFinite(q.days) ? q.days : '—'} days for ${q.wage}g (a guild workshop: about ${q.guildCost}g)`,
                    side,
                }));
            }
            html += rowList(put, 'Put out');
        }
        const list = PuttingOut.batches(player);
        html += rowList(list.map(b => {
            const here = live && b.q === live.q && b.r === live.r;
            const grade = b.quality < 0.92 ? ' (coarse)' : b.quality > 1 ? ' (fine)' : '';
            return {
                icon: b.done ? '📦' : '🧶',
                name: `${esc(b.qty)} ${esc(b.input)} at ${esc(b.name)}`,
                desc: b.done ? `<b>${b.units} ${esc(b.output)} ready</b>${grade} · waits until day ${b.readyDay + C.holdDays}` : `${Math.round(b.worked / b.qty * 100)}% spun and woven · put out day ${b.start}, ${esc((C.rates[b.rate] || {}).label || b.rate)}`,
                act: b.done && here ? 'puttingOutAct' : null, args: ['collect'],
                side: b.done ? (here ? 'Collect ›' : 'ready') : '',
                tone: b.done ? 'gold' : '',
            };
        }), 'Work out');
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
