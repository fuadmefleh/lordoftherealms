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

const BTN = 'padding: 4px 8px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
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
    const tip = `${q.workName}: ${goodsLine(q.goods)} (~${q.goodsCost}g) and ${q.hands} hands × ${q.days} days (~${q.wages}g)`;
    let html = `<div style="${NOTE}">${q.icon} <b>${esc(q.workName)}</b> · ~${q.cost}g · ${q.days} days · ${goodsLine(q.goods)}</div><div>`;
    html += act(`Fund (${budget}g)`, ['commission', kind, target, false], can, can ? tip : `You need ${budget}g`);
    if (q.tollable) {
        const est = kind !== 'canal' ? PublicWorks.tollEstimate(world, player, kind, target) : null;
        const t = est && est.payback ? ` — tolls ~${est.perDay}g/day, repaid in ~${est.payback} days` : '';
        html += act(`Fund as a toll ${kind === 'bridge' ? 'bridge' : kind === 'canal' ? 'canal' : 'road'} (${Math.round(q.tollRate * 100)}%)`, ['commission', kind, target, true], can, (can ? tip : `You need ${budget}g`) + t);
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
        if (traffic) bits.push(`~${traffic}g of goods a day`);
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
        html += `<div style="${NOTE}">Spent ${Math.round(w.spent)}g${live ? ` · budget left ${Math.round(w.budget)}g` : ''}${w.toll ? ` · tolls earned ${Math.round(w.tollIncome)}g` : ''}</div>`;
        if (live) html += `<div>${act('Add funds', ['fund', w.id])}${act('Abandon', ['abandon', w.id])}</div>`;
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
        const head = `<div style="${NOTE}">Roads of the known world: ${sum.segments} stretches · ${sum.bands.good} in good repair, ${sum.bands.worn} rutted, ${sum.bands.ruined} ruined${sum.bands.closed ? `, ${sum.bands.closed} closed` : ''} · ${sum.canals} canal(s) · works under way: ${sum.works}. Good roads haul cheaper and faster, so prices between their towns draw together; tolls on works you fund are yours.</div>`;
        const html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${head}${roadsHtml(game, town)}${greatWorksHtml(game, town)}${myWorksHtml(game)}${nearbyHtml(game)}</div>`;
        game.ui.showCustomPanel(`🛣️ Roads & Public Works${town ? ` — ${town.name}` : ''}`, html);
    },

    /** The panel's buttons: op + its arguments. */
    publicWorksAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'commission') res = PublicWorks.commission(world, player, a, b, { by: 'player', toll: !!c });
        else if (op === 'crown') res = PublicWorks.commission(world, player, a, b, { asRuler: true, toll: !!c });
        else if (op === 'fund') res = PublicWorks.fund(world, player, a);
        else if (op === 'abandon') res = PublicWorks.abandon(world, player, a);
        if (res) game.ui.showNotification('🛣️ Public Works', res.message, res.success ? 'success' : 'error');
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showPublicWorks(game, world.getTile(player.q, player.r));
    },
});
