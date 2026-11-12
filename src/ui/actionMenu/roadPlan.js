// ActionMenu — lay a line of works at once: a road (or a stone road, or an
// irrigation channel) from one hex to another, every hex along the way
// commissioned in one go instead of walking to each and clicking Build.
//
//   showRoutePlanner(game, key, q, r)          — pick where the line runs to (a town nearby, or a click on the map)
//   routeTo(game, key, q, r, tq, tr)           — the survey: the route on the map, the hexes, the cost and time
//   commissionRoute(game, key, q, r, tq, tr)   — pay for the whole line; each hex becomes its own work site
//
// The logic is systems/infrastructure.js planRoute / commissionRoute; the
// works then go up day by day like any other (player/playerWorks.js).
import { ActionMenu } from './_ref.js';
import { Infrastructure, Technology, Hex } from './_imports.js';
import { BTN_PLAIN, lede, chips, purse, rowList, card, kv, price } from './uiKit.js';

const PICK_BAR_ID = 'routePickBar';
const LINE_TYPES = ['DIRT_ROAD', 'STONE_ROAD', 'IRRIGATION_CHANNEL'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The line works this player may lay: [{ key, infra }]. */
export function lineTypes(player) {
    const out = [];
    for (const key of LINE_TYPES) {
        const infra = Infrastructure.TYPES[key];
        if (!infra) continue;
        if (infra.requiredTech && !Technology.isImplemented(player, infra.requiredTech)) continue;
        out.push({ key, infra });
    }
    return out;
}

function _clearPreview(game) {
    if (game && game.renderer) game.renderer.roadPlan = null;
}

function _endPick(game) {
    if (!game) return;
    if (game._hexPick && game._hexPick._route) game._hexPick = null;
    if (game._routePickWas) {
        game.isProcessingTurn = game._routePickWas.processing;
        if (game.camera && game._routePickWas.following != null) game.camera.following = game._routePickWas.following;
        game._routePickWas = null;
    }
    const bar = typeof document !== 'undefined' && document.getElementById(PICK_BAR_ID);
    if (bar) bar.remove();
}

/** Bring the surveyed line into view below the panel (which sits over the top half of the map). */
function _showLine(game, path) {
    const cam = game && game.camera;
    const R = game && game.renderer;
    if (!cam || typeof cam.centerOn !== 'function' || !R || typeof R.getHexPixelPos !== 'function' || !path || !path.length) return;
    const mid = path[Math.floor(path.length / 2)];
    const pos = mid && R.getHexPixelPos(mid.q, mid.r);
    if (!pos) return;
    cam.following = false;
    cam.centerOn(pos.x, pos.y - ((cam._cy || 400) * 0.5) / (cam.zoom || 1));
}

Object.assign(ActionMenu, {
    /** Where should the line run to? Towns near at hand, or any hex picked on the map. */
    showRoutePlanner(game, key, q, r) {
        const { player, world } = game;
        const infra = Infrastructure.TYPES[key];
        if (!infra) return;
        _clearPreview(game);
        let html = lede(`Lay a ${esc(infra.name.toLowerCase())} from here to anywhere overland: every hex along the way is commissioned at once, and each goes up as its own work site. You need not stand on each one.`);
        html += chips([purse(player.gold)]);
        html += rowList([{
            icon: '🗺️', name: 'Pick the far end on the map',
            desc: 'Click any hex; the route is surveyed and shown before you pay.',
            act: 'routePickOnMap', args: [key, q, r],
        }], 'To a hex of your choosing');
        // Towns within a day or three of road-building
        const towns = (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [])
            // (only towns the player has found: the list must not lift the fog)
            .filter(s => { const t = typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null; return !t || t.explored !== false; })
            .map(s => ({ s, d: Hex.wrappingDistance(q, r, s.q, s.r, world.width) }))
            .filter(x => x.d >= 2 && x.d <= 30)
            .sort((a, b) => a.d - b.d)
            .slice(0, 8);
        html += rowList(towns.map(({ s, d }) => ({
            icon: s.type === 'village' ? '🏘️' : '🏰', name: esc(s.name || 'A settlement'),
            desc: `${d} hexes away${s.type ? ` · ${esc(s.type)}` : ''}`,
            act: 'routeTo', args: [key, q, r, s.q, s.r],
        })), 'To a town nearby');
        game.ui.showCustomPanel(`${infra.icon} Lay a ${esc(infra.name)}`, html);
    },

    /** Step the panel aside and take the next map click as the line's far end. */
    routePickOnMap(game, key, q, r) {
        const infra = Infrastructure.TYPES[key];
        if (!infra) return;
        game._routePickWas = { processing: !!game.isProcessingTurn, following: game.camera ? game.camera.following : null };
        const cancel = () => { _endPick(game); _clearPreview(game); ActionMenu.showRoutePlanner(game, key, q, r); };
        game._hexPick = {
            _route: true,
            onPick: (tq, tr) => {
                _endPick(game);
                ActionMenu.routeTo(game, key, q, r, tq, tr);
            },
            onCancel: cancel,
        };
        game.isProcessingTurn = true;
        if (game.camera) game.camera.following = false;
        game.ui.hideCustomPanel();
        let bar = document.getElementById(PICK_BAR_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = PICK_BAR_ID;
            bar.style.cssText = 'position:fixed;left:0;right:0;top:64px;display:flex;justify-content:center;pointer-events:none;z-index:900;';
            document.body.appendChild(bar);
        }
        bar.innerHTML = '<div style="pointer-events:auto;max-width:calc(96vw / var(--ui-zoom, 1));background:rgba(18,20,28,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,0.5);font-size:12px;color:var(--text-primary);display:flex;gap:10px;align-items:center;">'
            + `<strong style="color:var(--gold);">${infra.icon} Click where the ${esc(infra.name.toLowerCase())} should run to</strong>`
            + '<span style="color:#9d937c;">drag to look around · Esc to cancel</span>'
            + `<button onclick="window._routePickCancel()" style="${BTN_PLAIN}">Cancel</button></div>`;
        window._routePickCancel = cancel;
    },

    /** The survey: the route drawn on the map, what it costs, how long it takes. */
    routeTo(game, key, q, r, tq, tr) {
        const { player, world } = game;
        const plan = Infrastructure.planRoute(player, key, world, { q, r }, { q: tq, r: tr });
        const infra = Infrastructure.TYPES[key];
        if (!plan.ok) {
            _clearPreview(game);
            game.ui.showNotification(`${infra ? infra.icon : '🛤️'} No route`, esc(plan.reason), 'warning');
            ActionMenu.showRoutePlanner(game, key, q, r);
            return;
        }
        if (game.renderer) game.renderer.roadPlan = { segments: plan.segments };
        _showLine(game, plan.path);
        const canPay = (player.gold || 0) >= plan.cost;
        const blocked = plan.segments.filter(s => s.status === 'blocked');
        const has = plan.segments.filter(s => s.status === 'has').length;
        const towns = plan.segments.filter(s => s.status === 'town').length;
        let html = lede(`The surveyors' line, ${plan.path.length - 1} hexes, is marked on the map: <span style="color:#8fd18a;">green</span> to build, <span style="color:#c9b98a;">pale</span> already done, <span style="color:#e57a5a;">red</span> where this work can't go.`);
        html += chips([purse(player.gold)]);
        html += card(
            kv('Hexes to build', `${plan.build.length}`)
            + kv('Cost', price(plan.cost, canPay))
            + kv('Work-days', plan.days > 0 ? `${plan.days} (all hexes worked at once; winter, rain and snow slow them, crews speed them)` : 'Instant')
            + (has ? kv('Already done', `${has} hex${has > 1 ? 'es' : ''}`) : '')
            + (towns ? kv('Through towns', `${towns} (their own streets)`) : ''),
            { title: `${infra.icon} ${esc(infra.name)}`, side: price(plan.cost, canPay) },
        );
        if (blocked.length) {
            html += rowList(blocked.slice(0, 6).map(s => ({ icon: '⛔', name: `Hex ${s.q}, ${s.r}`, desc: esc(s.reason || 'Not here'), off: true })), `Gaps in the line (${blocked.length})`);
        }
        const rows = [];
        if (plan.build.length) {
            rows.push(canPay
                ? { icon: '🏗️', name: `Commission all ${plan.build.length} hexes`, desc: `Hands hired from the nearest towns; each hex goes up as its own site.`, side: price(plan.cost, true), act: 'commissionRoute', args: [key, q, r, tq, tr], tone: 'gold' }
                : { icon: '🏗️', name: `Commission all ${plan.build.length} hexes`, off: true, why: `Need ${plan.cost} gold`, side: price(plan.cost, false) });
        } else {
            rows.push({ icon: '✓', name: 'Nothing to build along that way', off: true, why: 'It is all done already, or no hex will take this work.' });
        }
        rows.push({ icon: '🗺️', name: 'Pick another far end', act: 'routePickOnMap', args: [key, q, r] });
        html += rowList(rows);
        game.ui.showCustomPanel(`${infra.icon} Lay a ${esc(infra.name)}`, html);
    },

    /** Pay for the whole line at once. */
    commissionRoute(game, key, q, r, tq, tr) {
        const { player, world } = game;
        if (ActionMenu.commitPendingAP && !ActionMenu.commitPendingAP(game)) return;
        const plan = Infrastructure.planRoute(player, key, world, { q, r }, { q: tq, r: tr });
        const res = Infrastructure.commissionRoute(player, key, world, plan);
        const infra = Infrastructure.TYPES[key];
        _clearPreview(game);
        if (!res.success) {
            game.ui.showNotification('Cannot Build', esc(res.reason || 'Nothing was built'), 'error');
            return;
        }
        const when = res.days > 0 ? ` The work begins tomorrow; about ${res.days} work-days for the slowest hex.` : '';
        game.ui.showNotification('🏗️ Works Commissioned', `${res.built.length} hexes of ${esc(infra.name.toLowerCase())} paid for: ${res.cost} gold.${when}`, 'success');
        game.ui.updateStats(player, world);
        game.ui.hideCustomPanel();
        if (game.renderer && typeof player.getReachableHexes === 'function') game.renderer.reachableHexes = player.getReachableHexes(world);
    },
});
