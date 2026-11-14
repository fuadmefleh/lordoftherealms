// ActionMenu — the underwriter's office: open cover (hull & cargo, goods on
// the road, stock in store, works, crops) with today's quote for each, the
// covers held, claims paid and pending, the offices' standing, and — for a
// member of the Thieves' Guild — a forged claim. Logic lives in
// systems/underwriting.js; buttons route through data-am-act → ActionMenu.underwriterAct.
import { ActionMenu } from './_ref.js';
import { Underwriting, KINDS } from '../../systems/underwriting.js';
import { Underworld } from '../../systems/underworld.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, panelTabs, lede, chips, purse, actRow, rowList } from './uiKit.js';

const TABS = [['covers', '🛡️ Cover'], ['claims', '📜 Claims'], ['offices', '🏛️ Offices']];

let _tab = 'covers';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small buttons for a listing row's side column (the row itself is then not a button)
const SMALL = 'padding:2px 8px; margin:2px 0 0 4px; font-size:11px;';
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="underwriterAct" data-am-args='${esc(JSON.stringify(args))}' style="${style} ${SMALL}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function g1(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
}

function coversTab(player, world, here) {
    const C = Underwriting.config();
    let html = lede(`Open cover bills a small premium each day on what it covers that day, priced from the real dangers (the sea in season, raiders and lairs on the road, thieves, sieges, the weather). It pays each loss less ${Math.round(C.deductible * 100)}%. The house expects to win: insure to sleep at night, not to get rich.`);
    const rows = [];
    for (const kind of KINDS) {
        const K = Underwriting.kind(kind);
        const q = Underwriting.quote(player, world, kind);
        const cover = Underwriting.cover(player, kind);
        const items = q.items.slice(0, 4).map(it => `${esc(it.label)} ${it.value}g (risk ${g1(it.loss)}g a day)`).join(' · ');
        const today = `${q.items.length} item(s) worth ${q.value}g · expected loss ${g1(q.expected)}g a day${q.surcharge > 1 ? ` · ×${q.surcharge.toFixed(2)} for your recent claims` : ''}`;
        let side = '';
        let state = '';
        if (cover) {
            const attached = (world.day || 0) >= cover.attachDay;
            state = ` <span style="font-weight:400; color:#8fd18a;">· with ${esc(cover.uwName)}, ${attached ? 'in force' : `attaches day ${cover.attachDay}`}</span>`;
            side += act('Cancel', ['cancel', kind], BTN_PLAIN);
            const g = Underworld.ensure(player).guild;
            if (g && g.member && g.rank >= C.fraud.minRank && q.value > 0) {
                const cap = Math.floor(Math.min(C.fraud.maxAmount, q.value * C.fraud.maxShare));
                for (const share of [0.25, 0.5, 1]) {
                    const amt = Math.floor(cap * share);
                    if (amt >= 50) side += act(`🗝️ Forge ${amt}g`, ['fraud', kind, amt], BTN_RED, true, `A forged claim: the forger takes ${Math.round(C.fraud.forgerFee * 100)}% now; the assessors may see through it`);
                }
            }
        } else {
            for (const u of here) side += act(`Open with ${esc(u.name)}`, ['open', u.id, kind], BTN_GOLD, !Underwriting.banned(player, u.id, world.day || 0), 'This office will not insure you');
            if (!here.length) side = '';
        }
        rows.push(actRow({
            icon: K.icon, name: `${esc(K.name)} <span class="pk-price">${g1(q.premium)}<small>g a day</small></span>${state}`,
            desc: today,
            note: [items, cover ? `paid ${Math.round(cover.paid)}g so far · claims ${Math.round(cover.claimsPaid)}g` : ''].filter(Boolean).join('<br>'),
            side,
        }));
    }
    return html + rowList(rows, 'Cover, at today\'s premium');
}

function claimsTab(player, world) {
    const st = Underwriting.state(player);
    let html = chips([
        ['🧾', 'Premiums paid', `${Math.round(st.stats.premiums)}g`],
        { icon: '💰', label: 'Claims paid you', value: `${Math.round(st.stats.claimsPaid)}g`, cls: 'gold' },
        ['📜', 'Claims', st.stats.claims],
        st.stats.fraudsCaught ? ['🗝️', 'Forgeries found out', st.stats.fraudsCaught, 'bad'] : null,
    ]);
    const rows = st.claims.slice().reverse().slice(0, 20);
    if (!rows.length) return html + lede('No claims yet.');
    html += rowList(rows.map(c => {
        const status = c.status === 'pending' ? `<span style="color:#f0b35a;">assessed by day ${c.dueDay}</span>`
            : c.status === 'paid' ? `<span style="color:#8fd18a;">paid ${Math.round(c.paid)}g</span>`
                : c.status === 'denied' ? '<span style="color:#e0846a;">denied</span>' : esc(c.status);
        return {
            icon: esc((Underwriting.kind(c.kind) || {}).icon || '📜'),
            name: `${esc(c.cause)}${c.place ? ` <span style="font-weight:400; color:#9d937c;">(${esc(c.place)})</span>` : ''}`,
            desc: `day ${c.day} · loss ${Math.round(c.value)}g → claim ${Math.round(c.amount)}g · ${esc(c.uwName)}`,
            side: status,
        };
    }), 'Your claims');
    return html;
}

function officesTab(player, world) {
    const st = Underwriting.state(player);
    let html = lede('Every banking house keeps an insurance desk on its own reserves, and the underwriters\' guilds at the great ports keep their own. They bleed in wars, blockades and great storms; an office that fails voids its covers.');
    html += rowList(Underwriting.underwriters(player).map(u => {
        const book = st.books[u.id];
        const banned = Underwriting.banned(player, u.id, world.day || 0);
        const failed = u.status !== 'open';
        return {
            icon: u.type === 'bank' ? '🏦' : '⚓', name: esc(u.name),
            desc: `${u.type === 'bank' ? 'bank desk' : 'guild'} · ${esc(u.seat)}${book ? ` · loss ratio lately ${Math.round((book.lastRatio || 0) * 100)}%` : ''}${banned ? ' · <span style="color:#e0846a;">will not insure you</span>' : ''}`,
            side: failed ? '<span style="color:#e0846a;">failed</span>' : `reserves ${Math.round(Underwriting.reserveRatio(u) * 100)}%`,
            tone: failed ? 'bad' : '',
        };
    }), 'The offices');
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
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold), ['🛡️', 'Covers', s.covers], ['📅', 'Premiums today', `${g1(s.premiumToday)}g`], s.pending ? ['⏳', 'Claims pending', s.pending] : null]);
        if (!here.length) html += '<div class="pk-row-why" style="font-size:11px; margin-bottom:6px;">No underwriter writes cover here: visit a banking house or its branches, or an underwriters\' guild at a great port.</div>';
        html += panelTabs(game, {
            id: 'underwriter', title: '🛡️ The Underwriters', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showUnderwriter(game, t); },
            attrsFor: (k) => `data-am-act="underwriterAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
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
