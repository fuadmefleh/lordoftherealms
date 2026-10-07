// ActionMenu — the underwriter's office: open cover (hull & cargo, goods on
// the road, stock in store, works, crops) with today's quote for each, the
// covers held, claims paid and pending, the offices' standing, and — for a
// member of the Thieves' Guild — a forged claim. Logic lives in
// systems/underwriting.js; buttons route through data-am-act → ActionMenu.underwriterAct.
import { ActionMenu } from './_ref.js';
import { Underwriting, KINDS } from '../../systems/underwriting.js';
import { Underworld } from '../../systems/underworld.js';

const BTN = 'padding: 5px 9px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const TABS = [['covers', '🛡️ Cover'], ['claims', '📜 Claims'], ['offices', '🏛️ Offices']];

let _tab = 'covers';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="underwriterAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function g1(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
}

function coversTab(player, world, here) {
    const C = Underwriting.config();
    let html = `<div style="font-size:11px; color:#999;">Open cover bills a premium each day on what it covers that day, priced from the real dangers: the season at sea, hostile squadrons, raiders and lairs along the road, each store-room's thieves, sieges and crowns in crisis, the weather in the fields. It pays each loss less ${Math.round(C.deductible * 100)}%. The house expects to win: insure to sleep at night, not to get rich.</div>`;
    for (const kind of KINDS) {
        const K = Underwriting.kind(kind);
        const q = Underwriting.quote(player, world, kind);
        const cover = Underwriting.cover(player, kind);
        html += `<div style="${CARD}"><b>${K.icon} ${esc(K.name)}</b>`;
        if (cover) {
            const attached = (world.day || 0) >= cover.attachDay;
            html += ` · with <b>${esc(cover.uwName)}</b> · ${attached ? 'in force' : `attaches day ${cover.attachDay}`} · paid ${Math.round(cover.paid)}g · claims ${Math.round(cover.claimsPaid)}g`;
        }
        html += `<div style="font-size:12px; margin-top:4px;">Today: ${q.items.length} item(s) worth ${q.value}g · expected loss ${g1(q.expected)}g · premium <b>${g1(q.premium)}g a day</b>${q.surcharge > 1 ? ` (×${q.surcharge.toFixed(2)} for your recent claims)` : ''}</div>`;
        for (const it of q.items.slice(0, 4)) html += `<div style="font-size:11px; color:#aaa;">· ${esc(it.label)}: ${it.value}g, risk ${g1(it.loss)}g a day</div>`;
        html += '<div>';
        if (cover) {
            html += act('Cancel cover', ['cancel', kind], BTN_PLAIN);
            const g = Underworld.ensure(player).guild;
            if (g && g.member && g.rank >= C.fraud.minRank && q.value > 0) {
                const cap = Math.floor(Math.min(C.fraud.maxAmount, q.value * C.fraud.maxShare));
                for (const share of [0.25, 0.5, 1]) {
                    const amt = Math.floor(cap * share);
                    if (amt >= 50) html += act(`🗝️ Forge a claim of ${amt}g`, ['fraud', kind, amt], BTN_RED, true, `The forger takes ${Math.round(C.fraud.forgerFee * 100)}% now; the assessors may see through it`);
                }
            }
        } else {
            for (const u of here) html += act(`Open with ${esc(u.name)}`, ['open', u.id, kind], BTN_GOLD, !Underwriting.banned(player, u.id, world.day || 0));
        }
        html += '</div></div>';
    }
    return html;
}

function claimsTab(player, world) {
    const st = Underwriting.state(player);
    let html = `<div style="font-size:12px;">Premiums paid ${Math.round(st.stats.premiums)}g · claims paid ${Math.round(st.stats.claimsPaid)}g · ${st.stats.claims} claim(s)${st.stats.fraudsCaught ? ` · ${st.stats.fraudsCaught} forgery found out` : ''}</div>`;
    const rows = st.claims.slice().reverse().slice(0, 20);
    if (!rows.length) html += '<div style="color:#aaa; font-size:12px; margin-top:6px;">No claims yet.</div>';
    for (const c of rows) {
        const status = c.status === 'pending' ? `<span style="color:#e0c060;">with the assessors until day ${c.dueDay}</span>`
            : c.status === 'paid' ? `<span style="color:#8fd18f;">paid ${Math.round(c.paid)}g</span>`
                : c.status === 'denied' ? '<span style="color:#e06060;">denied</span>' : esc(c.status);
        html += `<div style="font-size:12px; margin-top:4px;">Day ${c.day} · ${esc((Underwriting.kind(c.kind) || {}).icon || '')} ${esc(c.cause)}${c.place ? ` (${esc(c.place)})` : ''} · loss ${Math.round(c.value)}g → claim ${Math.round(c.amount)}g · ${esc(c.uwName)} · ${status}</div>`;
    }
    return html;
}

function officesTab(player, world) {
    const st = Underwriting.state(player);
    let html = '<div style="font-size:11px; color:#999;">Every banking house keeps an insurance desk on its own reserves; the underwriters\' guilds at the great ports keep their own. They write cover for the world\'s merchants too, and bleed in wars, blockades and great storms. An office that fails voids its covers.</div>';
    for (const u of Underwriting.underwriters(player)) {
        const book = st.books[u.id];
        const ratio = Underwriting.reserveRatio(u);
        html += `<div style="font-size:12px; margin-top:5px;"><b>${esc(u.name)}</b> (${u.type === 'bank' ? 'bank desk' : 'guild'}) · ${esc(u.seat)} · ${u.status !== 'open' ? '<span style="color:#e06060;">failed</span>' : `reserves ${Math.round(ratio * 100)}%`}${book ? ` · loss ratio lately ${Math.round((book.lastRatio || 0) * 100)}%` : ''}${Underwriting.banned(player, u.id, world.day || 0) ? ' · <span style="color:#e06060;">will not insure you</span>' : ''}</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The underwriter's office (a banking house's desk or an underwriters' guild serving this place). */
    showUnderwriter(game, tile = null) {
        const player = game.player;
        const world = game.world;
        const t = tile || world.getTile(player.q, player.r);
        const here = Underwriting.underwritersAt(player, world, t);
        const s = Underwriting.summary(player, world);
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">${s.covers} cover(s) · premiums today ${g1(s.premiumToday)}g · claims pending ${s.pending} · paid to you ${Math.round(s.paid)}g · gold ${Math.floor(player.gold)}</p>`;
        if (!here.length) html += '<div style="font-size:11px; color:#c9a;">No underwriter writes cover here: visit a banking house or its branches, or an underwriters\' guild at a great port.</div>';
        html += '<div style="margin:6px 0;">';
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
        if (_tab === 'claims') html += claimsTab(player, world);
        else if (_tab === 'offices') html += officesTab(player, world);
        else html += coversTab(player, world, here);
        html += '</div>';
        game.ui.showCustomPanel('🛡️ The Underwriters', html);
    },

    underwriterAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'covers'; break;
            case 'open': res = Underwriting.openCover(player, world, a, b); break;
            case 'cancel': res = Underwriting.cancelCover(player, world, a); break;
            case 'fraud': res = Underwriting.falseClaim(player, world, a, b); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🛡️ Underwriters', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showUnderwriter(game, tile);
    },
});
