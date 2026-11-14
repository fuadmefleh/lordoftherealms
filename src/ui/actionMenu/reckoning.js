// ActionMenu — ⏳ The Season's Reckoning: what the player's doings changed in
// the world over a season — money by source, the markets their trade moved,
// lords won and lost (and the deeds they remember), Prestige and fame, the
// holdings, wars and the coalition, and the three biggest events that
// touched them. Shown once at each season's turn (ui/game/endDay.js; setting
// "seasonReckoning") and kept in the Journal (Journal → Season's Reckoning).
// Logic lives in systems/reckoning.js; this panel presents it.
//
// Opener: ActionMenu.showReckoning(game, tab) — tab 'last' | 'now' | 'past'.
import { ActionMenu } from './_ref.js';
import { Reckoning } from '../../systems/reckoning.js';
import { panelTabs, esc, lede, bullets, chips, card, more } from './uiKit.js';
import { Names } from '../../core/names.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const UP = '#7bd88f', DOWN = '#e57373';
const TABS = [['last', '⏳ Last season'], ['now', '📅 This season so far'], ['past', '📚 Earlier seasons']];

const sgn = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
const col = (n) => (n > 0 ? UP : n < 0 ? DOWN : 'var(--text-secondary)');
const num = (n) => `<span style="color:${col(n)}; font-weight:bold;">${sgn(n)}</span>`;
const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

/** A section of the report as a card: '💰 Money by source' → icon + title; nothing when empty. */
function _card(title, body) {
    if (!body) return '';
    const sp = title.indexOf(' ');
    return card(body, { icon: title.slice(0, sp), title: title.slice(sp + 1) });
}

function _money(m) {
    let html = chips([
        ['💰', 'Purse', `${m.goldFrom.toLocaleString()}g → ${m.goldTo.toLocaleString()}g (${num(m.change)}g)`],
        ['', 'Earned less spent', `${num(m.net)}g`],
    ]);
    const line = (l) => `<div style="display:flex; justify-content:space-between; font-size:12px;"><span>${esc(l.name)}</span><span style="color:${col(l.amount)};">${sgn(l.amount)}g</span></div>`;
    if (m.income.length) html += `<div style="${NOTE} margin-top:4px;">Came in from</div>${m.income.map(line).join('')}`;
    if (m.expenses.length) html += `<div style="${NOTE} margin-top:4px;">Went out on</div>${m.expenses.map(line).join('')}`;
    if (!m.income.length && !m.expenses.length) html += `<div style="${NOTE}">No money moved through your books this season.</div>`;
    return html;
}

function _towns(towns) {
    if (!towns.length) return '';
    return towns.map(t => {
        const goods = t.goods.map(g => {
            const did = [g.bought ? `bought ${g.bought}` : '', g.sold ? `sold ${g.sold}` : ''].filter(Boolean).join(', ');
            const stock = g.stockFrom != null && g.stockTo != null ? ` · stock ${g.stockFrom} → ${g.stockTo}` : '';
            const price = g.pricePct != null && g.pricePct !== 0 ? ` · price ${num(g.pricePct)}% since your first trade` : '';
            return `<div style="font-size:12px; margin-left:8px;">${esc(g.name)}: you ${did}${stock}${price}</div>`;
        }).join('');
        return `<div style="margin-bottom:4px;"><b>${esc(t.name)}</b>${goods}</div>`;
    }).join('') + bullets(['What you buy leaves the stalls dearer; what you sell gluts them.', 'The town’s own trade moves them too.']);
}

function _lords(lords) {
    if (!lords.length) return '';
    return lords.map(l => {
        const deeds = l.deeds.map(d => `${esc(d.icon)} ${esc(d.label)}${d.note ? ` (${esc(d.note)})` : ''} ${num(d.weight)}`).join(' · ');
        const head = l.newLord ? `${esc(l.lord)} now rules ${esc(Names.realm(l.realm))} (after ${esc(l.newLord)})` : `${esc(l.lord)} of ${esc(Names.realm(l.realm))}`;
        return `<div style="margin-bottom:4px;"><div>${head}: ${l.from != null ? `${sgn(l.from)} → ${sgn(l.to)} (${num(l.delta)})` : sgn(l.to)}</div>${deeds ? `<div style="${NOTE} margin-left:8px;">Remembers: ${deeds}</div>` : ''}</div>`;
    }).join('');
}

function _standing(p, f) {
    const bits = [];
    let html = `<div>Prestige ${p.from} → ${p.to} (${num(p.delta)})</div>`;
    if (p.reasons.length) html += `<div style="${NOTE} margin-left:8px;">${p.reasons.map(r => `${esc(r.reason)} ${num(r.delta)}`).join(' · ')}</div>`;
    if (f.renown.delta) bits.push(`renown ${f.renown.from} → ${f.renown.to} (${num(f.renown.delta)})`);
    if (f.karma.delta) bits.push(`karma ${f.karma.from} → ${f.karma.to} (${num(f.karma.delta)})`);
    if (bits.length) html += `<div>${bits.join(' · ')}</div>`;
    if (f.reputation.length) html += `<div style="${NOTE}">Your name: ${f.reputation.map(r => `${esc(r.realm)} ${num(r.delta)}`).join(' · ')}</div>`;
    return html;
}

function _holdings(hs) {
    if (!hs.length) return '';
    return hs.map(h => {
        if (h.lost) return `<div><b>${esc(h.name)}</b> — <span style="color:${DOWN};">lost</span></div>`;
        if (h.gained) return `<div><b>${esc(h.name)}</b> — <span style="color:${UP};">newly yours</span> · ${h.popTo} souls · mood ${h.happyTo} · unrest ${h.unrestTo}</div>`;
        return `<div><b>${esc(h.name)}</b>: ${h.popFrom} → ${h.popTo} souls (${num(h.popTo - h.popFrom)}) · mood ${h.happyFrom} → ${h.happyTo} (${num(h.happyTo - h.happyFrom)}) · unrest ${h.unrestFrom} → ${h.unrestTo} (${num(-(h.unrestTo - h.unrestFrom))})</div>`;
    }).join('');
}

function _wars(w) {
    const out = [];
    if (w.began.length) out.push(`<div style="color:${DOWN};">⚔️ War began with ${w.began.map(esc).join(', ')}</div>`);
    if (w.ended.length) out.push(`<div style="color:${UP};">🕊️ Peace with ${w.ended.map(esc).join(', ')}</div>`);
    if (w.liegeBegan.length) out.push(`<div>Your liege went to war with ${w.liegeBegan.map(esc).join(', ')}</div>`);
    if (w.liegeEnded.length) out.push(`<div>Your liege made peace with ${w.liegeEnded.map(esc).join(', ')}</div>`);
    if (w.coalition) out.push(`<div>🤝 ${esc(w.coalition)}</div>`);
    if (!w.began.length && w.atWar.length) out.push(`<div style="${NOTE}">Still at war with ${w.atWar.map(esc).join(', ')}</div>`);
    return out.join('');
}

function _events(evs) {
    if (!evs.length) return '';
    return evs.map(e => `<div>${esc(e.icon)} ${esc(_cap(e.text))} <span style="${NOTE}">(day ${e.day})</span></div>`).join('');
}

/** One report as HTML (also used by the render test). */
export function reckoningHtml(r) {
    if (!r) return `<div style="${NOTE}">No season has turned since your record began. The first reckoning comes at the next change of season.</div>`;
    let html = `<div style="font-weight:bold; margin:8px 0 2px;">${esc(r.headline)} <span style="${NOTE} font-weight:normal;">· days ${r.fromDay}–${r.toDay}</span></div>`;
    html += _card('💰 Money by source', _money(r.money));
    html += _card('🏪 Markets your trade moved', _towns(r.towns));
    html += _card('👑 Lords won and lost', _lords(r.lords));
    html += _card('⚜️ Prestige and fame', _standing(r.prestige, r.fame));
    html += _card('🏰 Your holdings', _holdings(r.holdings));
    html += _card('⚔️ Wars and leagues', _wars(r.wars));
    html += _card('📜 The season\'s biggest events', _events(r.events));
    return html;
}

Object.assign(ActionMenu, {
    /** The Season's Reckoning panel. */
    showReckoning(game, tab = 'last') {
        if (!game || !game.player || !game.ui) return;
        const st = Reckoning.state(game.player);
        const active = TABS.some(t => t[0] === tab) ? tab : 'last';
        const sub = panelTabs(game, {
            id: 'reckoning', title: '⏳ The Season\'s Reckoning', tabs: TABS, active,
            go: (key) => ActionMenu.showReckoning(game, key),
            attrsFor: (key) => `data-am-act="showReckoning" data-am-args='${JSON.stringify([key])}'`,
        });
        let body;
        if (active === 'now') body = reckoningHtml(Reckoning.report(game.world, game.player));
        else if (active === 'past') {
            const past = st.history.slice(0, -1).reverse();
            body = past.length
                ? past.map(r => more(esc(r.headline), reckoningHtml(r))).join('')
                : `<div style="${NOTE}">No earlier seasons are kept yet.</div>`;
        } else body = reckoningHtml(st.last);
        const html = `${sub}<div style="max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:380px;">
            ${lede('Your steward’s account of what your doings changed in the world. It opens at each season’s turn (Settings can switch that off).')}
            ${body}</div>`;
        game.ui.showCustomPanel('⏳ The Season\'s Reckoning', html);
    },
});
