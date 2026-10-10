// ActionMenu — the Hinterland: the rural sites around a town (mines, quarries,
// sheep runs, camps, fisheries...), their deposits, the crown's mining leases
// and their auctions, the player's leases (pace, outlet, books) and
// prospecting. Opened from the trade window, the Counsel and the map. Logic
// lives in world/hinterland.js and systems/concessions.js; this presents it.
// Buttons route through data-am-act → ActionMenu.hinterlandAct.
import { ActionMenu } from './_ref.js';
import { Hinterland } from '../../world/hinterland.js';
import { Concessions } from '../../systems/concessions.js';
import { Throne } from '../../systems/throne.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const gname = (id) => esc(Concessions.goodName(id));

/** A button routed to ActionMenu.hinterlandAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="hinterlandAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** A reserve bar coloured by what is left (data/hinterland.json markers). */
export function reserveBar(frac) {
    const M = Hinterland.config().markers;
    const color = frac > M.low ? '#5fbf6a' : frac > M.critical ? '#e8a040' : '#e74c3c';
    const w = Math.max(0, Math.min(100, Math.round(frac * 100)));
    return `<span style="display:inline-block; width:60px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; vertical-align:middle;"><span style="display:block; width:${w}%; height:100%; background:${color};"></span></span>`;
}

function holderText(world, site) {
    const c = Concessions.onSite(world, site);
    if (!c) return Concessions.realmOf(world, site) ? 'the crown\'s' : 'the townsfolk\'s';
    return c.holder === 'player' ? '<b style="color:var(--gold);">your lease</b>' : `${esc(c.holderName)}'s lease (to day ${c.end})`;
}

function siteCard(game, site, here) {
    const { player, world } = game;
    const d = Hinterland.describe(site);
    if (!d) return '';
    const home = world.getTile(...site.h.split(',').map(Number));
    let html = `<div style="${CARD}"><div><b>${esc(d.icon)} ${esc(d.name)}</b> · ${d.goods.map(gname).join(', ')} · ${holderText(world, site)}${home && home.settlement ? ` · near ${esc(home.settlement.name)}` : ''}</div>`;
    if (site.st === 'exhausted') return `${html}<div style="${NOTE}">Worked out and closed. A new vein may yet be struck in these hills.</div></div>`;
    html += `<div style="${NOTE}">${d.out > 0 ? `${d.out.toFixed(2)} a day lately` : 'idle lately'}${d.deposit ? ` · reserve ${reserveBar(d.reserve)} ${pct(d.reserve)} · yield ${pct(d.yield)}` : ' · renewable'}${Number.isFinite(site.idle) && site.idle > world.day ? ` · <span style="color:#e74c3c;">stalled after an accident until day ${site.idle}</span>` : ''}</div>`;
    if (d.leasable && site.st === 'open' && !Concessions.onSite(world, site)) {
        const q = Concessions.leaseQuote(player, world, site.id);
        const est = q.est;
        if (est) html += `<div style="${NOTE}">A lease: about ${est.perDay.toFixed(2)} ${gname(est.kind.first)} a day for ${est.term} days · ${Math.round(est.gross)}g gross, ${Math.round(est.wages)}g wages (${est.hands} hands), ${Math.round(est.royalty)}g royalty → about <b>${Math.round(est.net)}g net a day</b> at today's yield · reserve ${est.reserve}g</div>`;
        if (q.auction) {
            const a = q.auction;
            html += `<div style="margin-top:4px;">🔨 On auction until day ${a.closes}${a.finder === 'player' ? ' — <b style="color:var(--gold);">your finder\'s right</b>: the houses may not bid' : ''} · reserve ${a.reserve}g${a.bid > 0 ? ` · your bid <b>${a.bid}g</b>` : ''}</div>`;
            // (a refused bidder still sees what a bid would take: the reserve, or the standing bid)
            const minBid = q.minBid != null ? q.minBid : Math.max(a.reserve || 0, a.bid || 0);
            html += act(`Bid ${minBid}g`, ['bid', a.id, minBid], BTN_GOLD, q.ok, q.reason);
            if (q.ok) html += act(`Bid ${Math.round(q.minBid * 1.25)}g`, ['bid', a.id, Math.round(q.minBid * 1.25)], BTN_PLAIN);
        } else if (here) {
            html += act(`Petition for the lease (${q.minBid || (est ? est.reserve : 0)}g)`, ['petition', site.id, q.minBid || 0], BTN_GOLD, q.ok, q.reason);
            if (q.ok) html += act(`Bid ${Math.round(q.minBid * 1.3)}g`, ['petition', site.id, Math.round(q.minBid * 1.3)], BTN_PLAIN);
        } else if (!q.ok) html += `<div style="${NOTE}">${esc(q.reason)}</div>`;
    }
    return html + '</div>';
}

function leaseCard(game, row) {
    const { player, world } = game;
    const { c, site, home } = row;
    const d = Hinterland.describe(site);
    if (!d) return '';
    const C = Concessions.config();
    let html = `<div style="${CARD} border-color: rgba(245,197,66,0.4);"><div><b>${esc(d.icon)} ${esc(d.name)}</b> near ${esc(home ? home.name : '?')} · ${esc(c.realm)} · until day ${c.end}</div>`;
    html += `<div style="${NOTE}">Reserve ${reserveBar(row.reserve)} ${pct(row.reserve)} · yield ${pct(row.yield)}${Number.isFinite(row.daysLeft) ? ` · about ${row.daysLeft} days of digging left at this pace` : ''} · ${site.hire} hands · royalty ${pct(c.royalty)}</div>`;
    html += `<div style="${NOTE}">Dug ${Math.round(c.dug)} · sold for ${c.revenue}g · wages ${c.wages}g · royalties ${c.royalties}g · paid ${c.fee}g for the lease · last market day <b style="color:${c.lastNet >= 0 ? '#9fd59f' : '#e74c3c'};">${c.lastNet >= 0 ? '+' : ''}${c.lastNet}g</b>${c.accidents ? ` · ${c.accidents} accident${c.accidents === 1 ? '' : 's'}` : ''}${c.owed > 0 ? ` · <span style="color:#e74c3c;">owing ${Math.ceil(c.owed)}g since day ${c.owedSince}: pay within ${C.graceDays} days or forfeit</span>` : ''}</div>`;
    html += '<div style="margin-top:4px;">Pace: ';
    for (const [id, r] of Object.entries(C.rates)) html += act(r.label || id, ['rate', c.id, id], c.rate === id ? BTN_GOLD : BTN_PLAIN, true, `${Math.round(r.out * C.boost * 100)}% of the crown's rate, wears the vein ×${r.wear}${r.accident ? `, accidents ${Math.round(r.accident * 100)}% a market day` : ''}`);
    html += '</div><div style="margin-top:2px;">Output: ';
    html += act('Sell at market', ['outlet', c.id, null], !c.outlet ? BTN_GOLD : BTN_PLAIN);
    for (const o of Concessions.outlets(player, world, c)) {
        const sel = c.outlet && c.outlet.q === o.q && c.outlet.r === o.r && c.outlet.recipe === o.recipe;
        html += act(`To your ${esc(o.recipe)} at ${esc(o.town)}`, ['outlet', c.id, { q: o.q, r: o.r, recipe: o.recipe }], sel ? BTN_GOLD : BTN_PLAIN);
    }
    html += '</div>';
    if (c.lastFed) html += `<div style="${NOTE}">Delivered to your works last turn: ${Object.entries(c.lastFed).map(([g, n]) => `${n.toFixed(1)} ${gname(g)}`).join(', ')}</div>`;
    html += act('Give the lease back', ['surrender', c.id], BTN_RED);
    return html + '</div>';
}

/** The panel body for a town (exported for tests). */
export function hinterlandHtml(game, tile) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    let html = '';
    if (s) {
        const sites = Hinterland.sitesOf(world, tile.q, tile.r);
        const key = `${tile.q},${tile.r}`;
        const feeds = Hinterland.sites(world).filter(x => x.m === key && x.h !== key);
        html += `<div style="${NOTE}">The villages and countryside around ${esc(s.name)} dig, cut, shear and fish; half of what they bring goes to their own market, half to the nearest market town. Deposits run down as they are dug: the yield falls past half the vein, and a worked-out mine closes (its towns go short and its miners leave). The crown leases its deposits: the holder pays the lease, a royalty on every unit, and the hands at the local wage.</div>`;
        html += `<h5 style="margin:10px 0 4px;">${esc(s.name)}'s hinterland</h5>`;
        if (!sites.length) html += `<div style="${NOTE}">No rural sites work for ${esc(s.name)}.</div>`;
        for (const site of sites) html += siteCard(game, site, true);
        if (feeds.length) {
            html += '<h5 style="margin:10px 0 4px;">Selling into this market</h5>';
            for (const site of feeds) html += siteCard(game, site, true);
        }
        const auctions = s.kingdom ? Concessions.auctions(world, s.kingdom).filter(a => !sites.some(x => x.id === a.site) && !feeds.some(x => x.id === a.site)) : [];
        if (auctions.length) {
            html += `<h5 style="margin:10px 0 4px;">🔨 Leases on auction in the realm</h5>`;
            for (const a of auctions) {
                const site = Hinterland.site(world, a.site);
                if (site) html += siteCard(game, site, false);
            }
        }
        const pq = Concessions.prospectQuote(player, world, tile);
        html += `<div style="${CARD}"><b>⛏️ Prospecting</b><div style="${NOTE}">Send prospectors into the hills around ${esc(s.name)}: ${pq.cost}g, ${pq.days} days, about a ${pct(pq.chance)} chance of a strike. A strike is yours to lease at the reserve price before the merchant houses may bid.</div>`;
        html += act(`Fund a search (${pq.cost}g)`, ['prospect'], BTN_GOLD, pq.ok, pq.reason);
        html += '</div>';
    } else html += `<div style="${NOTE}">Stand in a town to see its hinterland, bid for its leases and send prospectors out.</div>`;

    const mine = Concessions.mine(player, world);
    html += '<h5 style="margin:10px 0 4px;">Your leases</h5>';
    if (!mine.length) html += `<div style="${NOTE}">You hold no mining leases.</div>`;
    for (const row of mine) html += leaseCard(game, row);

    // A realm the player rules may revoke the houses' leases
    const ruled = Throne.ruledKingdom(player, world);
    const st = world.hinterland;
    if (ruled && st) {
        const theirs = st.concessions.filter(c => c.status === 'active' && c.kingdomId === ruled.id && c.holder !== 'player');
        if (theirs.length) {
            html += `<h5 style="margin:10px 0 4px;">Leases in your realm</h5>`;
            for (const c of theirs) {
                const site = Hinterland.site(world, c.site);
                const d = site && Hinterland.describe(site);
                html += `<div style="${NOTE}">${d ? `${esc(d.icon)} ${esc(d.name)}` : 'A lease'} · ${esc(c.holderName)} · until day ${c.end} ${act('Revoke by edict', ['revoke', c.id], BTN_RED)}</div>`;
            }
        }
    }

    const news = Hinterland.recent(world, 60).filter(n => n.kind !== 'auction').slice(0, 5);
    if (news.length) {
        html += `<div style="${CARD}"><b>Word from the hills</b><div style="${NOTE}">`;
        html += news.map(n => n.kind === 'strike' ? `Day ${n.day}: a new ${esc(String(n.site).toLowerCase())} is struck near ${esc(n.place)}.`
            : n.kind === 'vein' ? `Day ${n.day}: a fresh vein in the ${esc(String(n.site).toLowerCase())} near ${esc(n.place)}.`
                : n.kind === 'exhausted' ? `Day ${n.day}: the ${esc(String(n.site).toLowerCase())} near ${esc(n.place)} is worked out${n.to ? `; its miners leave for ${esc(n.to)}` : ''}.`
                    : `Day ${n.day}: ${n.n} killed in a fall at the ${esc(String(n.site).toLowerCase())} near ${esc(n.place)}.`).join('<br>');
        html += '</div></div>';
    }
    const sum = Concessions.summary(player, world);
    if (sum.log.length) {
        html += '<h5 style="margin:10px 0 4px;">Recent</h5>';
        for (const l of sum.log.slice(0, 6)) html += `<div style="${NOTE}">Day ${l.day}: ${esc(l.text)}</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Hinterland panel for the town on `tile` (or at q, r; the player's own tile by default). */
    showHinterland(game, tile = null, q = null, r = null) {
        const world = game.world;
        let t = tile && typeof tile === 'object' ? tile : null;
        if (!t && Number.isFinite(q) && Number.isFinite(r)) t = world.getTile(q, r);
        if (!t) t = world.getTile(game.player.q, game.player.r);
        const html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;"><p style="margin:0 0 6px; color:var(--text-secondary);">💰 ${Math.floor(game.player.gold).toLocaleString()} gold${t && t.settlement ? ` · at ${esc(t.settlement.name)}` : ''}</p>${hinterlandHtml(game, t)}</div>`;
        game.ui.showCustomPanel(`⛏️ The Hinterland${t && t.settlement ? ` of ${t.settlement.name}` : ''}`, html);
    },

    /** Every button on the panel: op + its arguments. */
    hinterlandAct(game, op, a = null, b = null) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'petition': res = Concessions.petition(player, world, a, b || null); break;
            case 'bid': res = Concessions.bid(player, world, a, b); break;
            case 'rate': res = Concessions.setRate(player, world, a, b); break;
            case 'outlet': res = Concessions.setOutlet(player, world, a, b || null); break;
            case 'surrender': res = Concessions.surrender(player, world, a); break;
            case 'revoke': res = Concessions.revokeByEdict(player, world, a); break;
            case 'prospect': res = Concessions.prospect(player, world, tile); break;
            default: return;
        }
        if (res) {
            const text = res.success ? (res.spent != null ? `Done: −${res.spent} gold.` : 'Done.') : (res.reason || 'Not possible.');
            game.ui.showNotification('⛏️ Hinterland', text, res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showHinterland(game, tile);
    },
});
