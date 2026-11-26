// ActionMenu — Roads & Public Works: the roads out of the town the player
// stands in (tier, repair, crossing, closures, tolls, who keeps them), the
// works the player can fund or (as a ruler) order from the treasury —
// repairs, a track made a road, a paved highway, a stone bridge, a canal to
// a neighbouring town, harbour works — with their quote (goods at the town's
// prices, wages, days, hands), the player's works under way and their tolls,
// and the works the crowns have under way nearby. Logic lives in
// world/transport.js and systems/publicWorks.js; this presents it. Buttons
// route through data-am-act → ActionMenu.publicWorksAct.
import { ActionMenu } from './_ref.js';
import { Transport } from '../../world/transport.js';
import { PublicWorks } from '../../systems/publicWorks.js';
import { Hex } from '../../core/hex.js';
import { BTN_GOLD, BTN_DIM, CARD, lede, chips } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const BAND = { good: ['Good repair', '#5fbf6a'], worn: ['Rutted', '#d08a3a'], ruined: ['Ruined', '#e74c3c'], closed: ['Closed', '#8fb4d8'] };
const CROSS = { bridge: '🌉 bridged', ford: '🌊 a ford', ferry: '⛴️ a ferry' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="publicWorksAct" data-am-args='${esc(JSON.stringify(args))}' style="${BTN_GOLD}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function goodsLine(goods) {
    return Object.entries(goods || {}).map(([g, n]) => `${Math.round(n * 10) / 10} ${esc(g)}`).join(', ');
}

/** Quote buttons for one work: fund it (and as a toll work), or order it as the realm's ruler. */
function workButtons(game, kind, target, ruled) {
    const { world, player } = game;
    const q = PublicWorks.quote(world, kind, target);
    if (!q.ok) return '';
    const budget = Math.ceil(q.cost * (1 + (Transport.config().build.budgetPad || 0.15)));
    const can = (player.gold || 0) >= budget;
    const tip = `${q.workName}: ${goodsLine(q.goods)} (~${Utils.formatGold(q.goodsCost)}g) and ${q.hands} hands × ${q.days} days (~${Utils.formatGold(q.wages)}g)`;
    let html = `<div style="${NOTE}">${q.icon} <b>${esc(q.workName)}</b> · ~${Utils.formatGold(q.cost)}g · ${q.days} days (~${Utils.formatGold(Math.ceil(q.cost / Math.max(1, q.days)))}g a day, drawn from its budget as it builds) · ${goodsLine(q.goods)}</div><div>`;
    html += act(`Fund (${Utils.formatGold(budget)}g)`, ['commission', kind, target, false], can, can ? tip : `You need ${Utils.formatGold(budget)}g`);
    if (q.tollable) {
        const est = kind !== 'canal' ? PublicWorks.tollEstimate(world, player, kind, target) : null;
        const t = est && est.payback ? ` — tolls ~${Utils.formatGold(est.perDay)}g/day, repaid in ~${est.payback} days` : '';
        html += act(`Fund as a toll ${kind === 'bridge' ? 'bridge' : kind === 'canal' ? 'canal' : 'road'} (${Math.round(q.tollRate * 100)}%)`, ['commission', kind, target, true], can, (can ? tip : `You need ${Utils.formatGold(budget)}g`) + t);
    }
    if (ruled != null && q.kid === ruled) html += act('Order it from the treasury', ['crown', kind, target, false], true, tip);
    return html + '</div>';
}

function roadsHtml(game, town) {
    const { world, player } = game;
    const ruled = player.throne && player.throne.ruling ? player.throne.ruling.kingdomId : null;
    const segs = town ? Transport.segmentsOf(world, town.q, town.r) : Transport.segmentsNear(world, player.q, player.r, 2).slice(0, 4);
    if (!segs.length) return `<div style="${CARD}"><div style="${NOTE}">No made road leaves here. Trade goes over open country: dearer haulage, and the hills and forests make it dearer still.</div></div>`;
    let html = '';
    for (const seg of segs) {
        const d = Transport.describe(world, seg);
        const [label, color] = BAND[d.band] || BAND.good;
        const traffic = Math.round(((world.transport && world.transport.traffic) || {})[seg.key] || 0);
        html += `<div style="${CARD}"><div>${d.icon} <b>${esc(d.name)}</b> · ${esc(d.tierName)} · ${d.len} hexes · <span style="color:${color};">${label}${d.closed ? ` (${d.closed === 'snow' ? 'snow on the pass' : 'the ford in flood'})` : ''}</span></div>`;
        const bits = [`condition ${d.cond}/100`];
        if (d.rivers) bits.push(CROSS[d.crossing] || 'a crossing');
        if (d.pass) bits.push('a mountain pass (closes in winter snow)');
        if (d.toll) bits.push('💰 tolled');
        bits.push(d.kingdom ? `kept by ${esc(d.kingdom)}` : 'kept by its towns');
        if (traffic) bits.push(`~${Utils.formatGold(traffic)}g of goods a day`);
        html += `<div style="${NOTE}">${bits.join(' · ')}</div>`;
        const s = Transport.segState(world, seg);
        if (s.c < 90) html += workButtons(game, 'repair', seg.key, ruled);
        if (s.t === 'track') html += workButtons(game, 'upgrade_road', seg.key, ruled);
        if (s.t === 'road') html += workButtons(game, 'upgrade_highway', seg.key, ruled);
        if (seg.rivers.length && s.x !== 'bridge') html += workButtons(game, 'bridge', seg.key, ruled);
        html += '</div>';
    }
    return html;
}

function greatWorksHtml(game, town) {
    if (!town) return '';
    const { world, player } = game;
    const ruled = player.throne && player.throne.ruling ? player.throne.ruling.kingdomId : null;
    const W = Transport.work('canal') || {};
    let html = '';
    const key = `${town.q},${town.r}`;
    const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    const cands = views.filter(v => (v.q !== town.q || v.r !== town.r) && Math.abs(v.r - town.r) <= (W.maxDist || 10))
        .map(v => ({ v, d: Hex.wrappingDistance(v.q, v.r, town.q, town.r, world.width) }))
        .filter(x => x.d <= (W.maxDist || 10)).sort((a, b) => a.d - b.d);
    let shown = 0;
    for (const { v } of cands) {
        if (shown >= 3) break;
        const vk = `${v.q},${v.r}`;
        const pair = key < vk ? `${key}|${vk}` : `${vk}|${key}`;
        const q = PublicWorks.quote(world, 'canal', pair);
        if (!q.ok) continue;
        shown++;
        html += `<div style="${CARD}"><div>🚣 <b>A canal to ${esc(v.name)}</b></div><div style="${NOTE}">Barges cut the haulage between the two towns to a fraction, never close for mud or snow, and carry perishables before they spoil.</div>${workButtons(game, 'canal', pair, ruled)}</div>`;
    }
    const hq = PublicWorks.quote(world, 'harbour', key);
    if (hq.ok) html += `<div style="${CARD}"><div>⚓ <b>Harbour works at ${esc(town.name)}</b></div><div style="${NOTE}">New quays: every sea route from here hauls cheaper.</div>${workButtons(game, 'harbour', key, ruled)}</div>`;
    return html ? `<div style="margin-top:6px;"><b>Great works</b></div>${html}` : '';
}

const g1 = (v) => Utils.formatGold(Math.round((v || 0) * 10) / 10);

/** A work's books: where its money went (wages to which town, what materials from whom), its burn and how long its budget lasts. */
function booksHtml(game, w, live) {
    const { world } = game;
    const b = w.book || {};
    const goods = Object.entries(b.goods || {});
    const goodsGold = goods.reduce((s, [, e]) => s + (e.gold || 0), 0);
    const towns = Object.entries(b.towns || {}).sort((x, y) => y[1] - x[1]);
    let html = `<div style="${NOTE}">Funded ${Utils.formatGold(b.funded != null ? b.funded : (w.spent || 0) + (w.budget || 0))}g · spent ${Utils.formatGold(w.spent)}g${live ? ` · <b>budget left ${Utils.formatGold(w.budget)}g</b>` : ''}${b.refunded ? ` · returned ${Utils.formatGold(b.refunded)}g` : ''}${w.toll ? ` · tolls earned ${Utils.formatGold(w.tollIncome)}g` : ''}</div>`;
    if (b.wages || goods.length) {
        html += `<div style="${NOTE}">Where it went: wages ${g1(b.wages)}g${goods.length ? ` · materials ${g1(goodsGold)}g (${goods.map(([g, e]) => `${Math.round(e.n * 10) / 10} ${esc(g)} for ${g1(e.gold)}g`).join(', ')})` : ''}${towns.length ? ` · paid into ${towns.slice(0, 3).map(([t, v]) => `${esc(t)} ${g1(v)}g`).join(', ')}` : ''}</div>`;
    }
    if (live) {
        const o = PublicWorks.outlook(world, w);
        const lasts = o.lastsDays == null ? '' : o.covers ? ` · the budget covers it (what is not spent comes back)` : ` · <span style="color:#d08a3a;">the budget lasts about ${o.lastsDays} days</span>`;
        html += `<div style="${NOTE}">Spends ~${g1(o.burn)}g a day (a full day: wages ${g1(o.wageDay)}g for ${w.hands} hands, materials ~${g1(o.goodsDay)}g) · ~${o.daysLeft} days of work left, ~${Utils.formatGold(Math.round(o.toFinish))}g more to finish${lasts}</div>`;
    }
    const days = (b.days || []).slice(-3).reverse();
    for (const r of days) {
        const parts = [];
        if (r.wages) parts.push(`wages ${g1(r.wages)}g to ${esc(r.wageTown || 'the town')} (${r.hands || w.hands} hands)`);
        for (const x of r.goods || []) parts.push(`${Math.round(x.n * 100) / 100} ${esc(x.g)} at ${g1(x.n > 0 ? x.gold / x.n : 0)}g from ${esc(x.from)}`);
        if (parts.length) html += `<div style="${NOTE} padding-left:8px;">Day ${r.d}: ${parts.join(' · ')}</div>`;
    }
    return html;
}

function myWorksHtml(game) {
    const { world } = game;
    const list = PublicWorks.playerWorks(world).filter(w => w.status !== 'abandoned').slice(-10).reverse();
    if (!list.length) return '';
    let html = '<div style="margin-top:6px;"><b>Your works</b></div>';
    for (const w of list) {
        const pct = Math.round(PublicWorks.progress(w) * 100);
        const live = w.status === 'building' || w.status === 'stalled';
        const why = w.stall === 'funds' ? '<span style="color:#e74c3c;">stalled: funds</span>' : w.stall === 'materials' ? '<span style="color:#d08a3a;">waiting for materials</span>' : w.stall === 'slow' ? 'materials short' : '';
        html += `<div style="${CARD}"><div>${w.icon || '🏗️'} <b>${esc(w.name)}</b> · ${live ? `${pct}%` : w.status === 'done' ? `finished day ${w.done}` : w.status}${why ? ` · ${why}` : ''}</div>`;
        html += booksHtml(game, w, live);
        if (live) {
            const room = PublicWorks.fundRoom(world, w);
            const gold = Math.floor(game.player.gold || 0);
            let btns = '';
            if (room > 0) {
                btns += act(`Add what is left (${Utils.formatGold(room)}g)`, ['fund', w.id, room], gold >= room, gold >= room ? 'What finishing it still wants at today\'s prices, with the reserve, less the budget it holds' : `You need ${Utils.formatGold(room)}g`);
                for (const a of [100, 500, 1000, 5000]) if (a < room) btns += act(`+${Utils.formatGold(a)}g`, ['fund', w.id, a], gold >= a, gold >= a ? '' : `You need ${Utils.formatGold(a)}g`);
            } else btns += `<button disabled style="${BTN_DIM}" title="The budget covers what is left; what is not spent comes back to you">Fully funded</button>`;
            html += `<div>${btns}${act('Abandon', ['abandon', w.id], true, 'What is left of the budget comes back; what was built is lost')}</div>`;
        }
        html += '</div>';
    }
    return html;
}

function nearbyHtml(game) {
    const { world, player } = game;
    const list = PublicWorks.works(world, w => w.owner !== 'player' && (w.status === 'building' || w.status === 'stalled')
        && Hex.wrappingDistance(w.q, w.r, player.q, player.r, world.width) <= 12);
    if (!list.length) return '';
    const name = (id) => { const k = world.getKingdom ? world.getKingdom(id) : null; return k ? k.name : 'a crown'; };
    return `<div style="${CARD}"><div><b>🚧 Works under way nearby</b></div>${list.slice(0, 6).map(w => `<div style="${NOTE}">${w.icon || '🏗️'} ${esc(w.name)} for ${esc(name(w.owner))} · ${Math.round(PublicWorks.progress(w) * 100)}% · ${w.hands} hands hired</div>`).join('')}</div>`;
}

Object.assign(ActionMenu, {
    /** The Roads & Public Works panel for the town on `tile` (or the roads near the player). */
    showPublicWorks(game, tile = null) {
        const world = game.world;
        const t = tile && typeof tile === 'object' ? tile : world.getTile(game.player.q, game.player.r);
        const town = t && t.settlement ? { q: t.q != null ? t.q : game.player.q, r: t.r != null ? t.r : game.player.r, name: t.settlement.name } : null;
        if (town && t.settlement && Number.isFinite(t.settlement.q)) { town.q = t.settlement.q; town.r = t.settlement.r; }
        const sum = PublicWorks.summary(world);
        const head = lede('Good roads haul cheaper and faster, so prices between their towns draw together. Tolls on works you fund are yours.')
            + chips([
                ['🛣️', 'Roads', sum.segments],
                ['✅', 'Good', sum.bands.good],
                ['〰️', 'Rutted', sum.bands.worn, sum.bands.worn ? '' : 'dim'],
                ['💥', 'Ruined', sum.bands.ruined, sum.bands.ruined ? '' : 'dim'],
                sum.bands.closed ? ['⛔', 'Closed', sum.bands.closed] : null,
                ['🚣', 'Canals', sum.canals, sum.canals ? '' : 'dim'],
                ['🔨', 'Works under way', sum.works, sum.works ? '' : 'dim'],
            ]);
        const html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${head}${roadsHtml(game, town)}${greatWorksHtml(game, town)}${myWorksHtml(game)}${nearbyHtml(game)}</div>`;
        game.ui.showCustomPanel(`🛣️ Roads & Public Works${town ? ` — ${town.name}` : ''}`, html);
    },

    /** The panel's buttons: op + its arguments. */
    publicWorksAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'commission') res = PublicWorks.commission(world, player, a, b, { by: 'player', toll: !!c });
        else if (op === 'crown') res = PublicWorks.commission(world, player, a, b, { asRuler: true, toll: !!c });
        else if (op === 'fund') res = PublicWorks.fund(world, player, a, b != null ? Number(b) : null);
        else if (op === 'abandon') res = PublicWorks.abandon(world, player, a);
        if (res) game.ui.showNotification('🛣️ Public Works', res.message, res.success ? 'success' : 'error');
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showPublicWorks(game, world.getTile(player.q, player.r));
    },
});
