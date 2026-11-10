// ActionMenu — the tax guide: what each of the crown's taxes, levels and
// budget lines is (the Crown's Treasury, actionMenu/treasury.js) and what the
// player's own settlement tax does (the Royal Treasury's Taxes tab,
// ui/techTreasury.js). The prose lives in data (data/fiscal.json `explain`,
// data/market.json `taxGuide`) with {pct:path} / {num:path} / {x:path}
// placeholders filled from the live tuning; the per-level effects are computed
// here from the same numbers the simulation reads (world/crownBooks.js burden,
// stabilityMod; systems/marketDynamics.js Taxation), so the guide cannot drift
// from the rules.
import { CrownBooks } from '../../world/crownBooks.js';
import { DataLoader } from '../../core/dataLoader.js';
import { CARD, more, bullets, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
export const TAXES = ['land', 'poll', 'excise'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A number shown plainly: up to 4 decimals, no trailing zeros. */
const _plain = (v) => String(Math.round(_num(v) * 10000) / 10000);
const _signed = (v, digits = 1) => {
    const r = Math.round(_num(v) * 10 ** digits) / 10 ** digits;
    return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : '±0';
};

function _path(obj, path) {
    let o = obj;
    for (const p of String(path).split('.')) {
        if (o == null || typeof o !== 'object') return undefined;
        o = o[p];
    }
    return o;
}

/** Fill {pct:a.b} (as a percent), {num:a.b} (as is), {x:a.b} (as ×n) and {c100:a.b} (×100: a sum per hundred) from `src`; {name} from `extra`. */
export function fill(str, src = CrownBooks.config(), extra = {}) {
    return String(str == null ? '' : str).replace(/\{(?:(pct|num|x|c100):)?([\w.]+)\}/g, (m, kind, path) => {
        const v = kind ? _path(src, path) : extra[path];
        if (typeof v !== 'number' || !Number.isFinite(v)) return typeof v === 'string' ? v : m;
        if (kind === 'pct') return `${_plain(v * 100)}%`;
        if (kind === 'x') return `×${_plain(v)}`;
        if (kind === 'c100') return _plain(v * 100);
        return _plain(v);
    });
}

function _explain() {
    const e = CrownBooks.config().explain;
    return e && typeof e === 'object' ? e : {};
}

/** One line of the crown's books in a sentence (the hover on its row). '' when the data has none. */
export function lineTip(line) {
    const L = _explain().lines || {};
    return L[line] ? fill(L[line]) : '';
}

/** A tax's name and icon (data/fiscal.json explain.taxes). */
export function taxName(tax) {
    const t = (_explain().taxes || {})[tax] || {};
    return `${t.icon ? t.icon + ' ' : ''}${t.name || tax}`;
}

/**
 * What one tax at one level does next to Standard, from the rules themselves:
 * its take × the level's mult, the people's burden (CrownBooks.burden: base ×
 * the weighted tax index) and the realm's stability (−(index − 1) × perLevel).
 * → { mult, burden (percentage points), stability }
 */
export function levelEffect(tax, levelId) {
    const C = CrownBooks.config();
    const W = C.burden.weights || {};
    let sum = 0;
    for (const t of TAXES) sum += _num(W[t], 1 / 3);
    const share = sum > 0 ? _num(W[tax], 1 / 3) / sum : 1 / 3;
    const mult = CrownBooks.levelMult(levelId);
    const dIndex = share * (mult - 1);
    return {
        mult,
        burden: _num(C.burden.base, 0.15) * dIndex * 100,
        stability: -dIndex * _num(C.stability.perLevel, 12),
    };
}

/** "×1.3 its take · burden +2.3 pts · stability −1.8" (for a button's hover and the guide). */
export function levelEffectText(tax, levelId) {
    const e = levelEffect(tax, levelId);
    if (Math.abs(e.mult - 1) < 1e-9) return 'The customary due: the base rate, no extra burden.';
    return `×${_plain(e.mult)} its take · people's burden ${_signed(e.burden)} pts · stability ${_signed(e.stability)} (next to Standard)`;
}

/** An army-pay level in figures. */
export function armyLevelText(id) {
    const L = (CrownBooks.config().army.levels || {})[id] || {};
    return `×${_plain(_num(L.mult, 1))} wages · keeps ${Math.round(_num(L.cap, 1) * 100)}% of the army · stability ${_signed(_num(L.stability))}`;
}

/** A court level in figures. */
export function courtLevelText(id) {
    const L = (CrownBooks.config().court.levels || {})[id] || {};
    const parts = [`×${_plain(_num(L.mult, 1))} cost`];
    if (_num(L.corruption) > 0) parts.push(`corruption ${_signed(_num(L.corruption) * 100, 2)} pts a day`);
    parts.push(`stability ${_signed(_num(L.stability))}`);
    return parts.join(' · ');
}

/** The short line beside a tax's level buttons: what it falls on and how it is reckoned. */
export function taxControlNote(tax) {
    const t = (_explain().taxes || {})[tax];
    return t ? `<div style="${NOTE} margin:1px 0 2px;">${esc(fill(t.on))}</div>` : '';
}

/** A tax's hover: who pays, on what, how. */
export function taxTip(tax) {
    const t = (_explain().taxes || {})[tax];
    return t ? [fill(t.who), fill(t.how)].filter(Boolean).join(' ') : '';
}

const _lvLabel = (id) => {
    const L = CrownBooks.config().levels[id] || {};
    return `${L.icon || ''} ${L.label || id}`.trim();
};

/**
 * The "ℹ️ What are these?" section of the Crown's Treasury: every tax (who,
 * on what, how, the levels and what each does, its current level when the
 * realm's rates are given), the army and the court, the terms, and every
 * line of the books. `b` is Fiscal.budget (or null).
 */
export function crownTaxGuide(b = null, open = false) {
    const E = _explain();
    const T = E.taxes || {};
    let body = '';
    if (E.intro) body += `<div style="${NOTE} margin:4px 0;">${fill(E.intro)}</div>`;
    for (const tax of TAXES) {
        const t = T[tax];
        if (!t) continue;
        const cur = b && b.rates ? b.rates[tax] : null;
        body += `<div style="${CARD}" title="${esc(taxTip(tax))}"><b>${esc(taxName(tax))}</b>${cur ? ` · <span style="${NOTE}">now ${esc(_lvLabel(cur))} (×${_plain(CrownBooks.levelMult(cur))})</span>` : ''}`;
        body += `<div style="font-size:11px; margin-top:3px;"><b>Who pays:</b> ${fill(t.who)}<br><b>On:</b> ${fill(t.on)}<br><b>How much:</b> ${fill(t.how)}</div>`;
        const rows = CrownBooks.LEVELS.map(id => {
            const e = levelEffect(tax, id);
            const here = id === cur;
            return `<tr${here ? ' style="color:var(--gold);"' : ''}><td style="padding:1px 6px 1px 0;">${esc(_lvLabel(id))}${here ? ' ◂' : ''}</td><td style="padding:1px 6px;">×${_plain(e.mult)}</td><td style="padding:1px 6px;">${_signed(e.burden)} pts</td><td style="padding:1px 6px;">${_signed(e.stability)}</td></tr>`;
        }).join('');
        body += `<table style="font-size:11px; border-collapse:collapse; margin-top:4px;"><tr style="color:var(--text-secondary);"><td style="padding:1px 6px 1px 0;">Level</td><td style="padding:1px 6px;">Take</td><td style="padding:1px 6px;">Burden</td><td style="padding:1px 6px;">Stability</td></tr>${rows}</table>`;
        if (t.weight) body += `<div style="${NOTE} margin-top:2px;">${fill(t.weight)}</div>`;
        body += '</div>';
    }
    if (E.collection) body += `<div style="${NOTE} margin:4px 0;">${fill(E.collection)}</div>`;
    if (E.levels) body += `<div style="font-size:11px; margin:6px 0 2px;"><b>Tax levels.</b> ${fill(E.levels)}</div>`;
    if (Array.isArray(E.raise) && E.raise.length) {
        body += `<div style="font-size:11px; margin-top:6px;"><b>Raising a tax:</b></div>`;
        body += `<div style="font-size:11px;">${bullets(E.raise.map(s => fill(s)))}</div>`;
    }
    if (E.lower) body += `<div style="font-size:11px;"><b>Lowering it:</b> ${fill(E.lower)}</div>`;
    const A = CrownBooks.config().army.levels || {};
    const Ct = CrownBooks.config().court.levels || {};
    body += `<div style="${CARD}"><b>⚔️ Army pay</b>${b ? ` · <span style="${NOTE}">now ${esc((A[b.armyPay] || {}).label || b.armyPay)}</span>` : ''}<div style="${NOTE}">${fill(E.army || '')}</div>`
        + bullets(Object.keys(A).map(id => `<b>${esc(A[id].label || id)}</b>: ${esc(armyLevelText(id))}${A[id].blurb ? ` <span style="${NOTE}">${esc(A[id].blurb)}</span>` : ''}`)) + '</div>';
    body += `<div style="${CARD}"><b>🏛️ The court</b>${b ? ` · <span style="${NOTE}">now ${esc((Ct[b.courtLevel] || {}).label || b.courtLevel)}</span>` : ''}<div style="${NOTE}">${fill(E.court || '')}</div>`
        + bullets(Object.keys(Ct).map(id => `<b>${esc(Ct[id].label || id)}</b>: ${esc(courtLevelText(id))}${Ct[id].blurb ? ` <span style="${NOTE}">${esc(Ct[id].blurb)}</span>` : ''}`)) + '</div>';
    const terms = E.terms || {};
    if (Object.keys(terms).length) body += `<div style="font-size:11px; margin-top:6px;"><b>Terms</b></div><div style="font-size:11px;">${bullets(Object.values(terms).map(s => fill(s)))}</div>`;
    const lines = E.lines || {};
    const L = (ids) => ids.filter(l => lines[l]).map(l => `<b>${esc(lineLabel(l))}</b>: ${esc(lineTip(l))}`);
    body += `<div style="font-size:11px; margin-top:6px;"><b style="color:var(--gold);">Revenue lines</b></div><div style="font-size:11px;">${bullets(L(CrownBooks.REVENUE_LINES))}</div>`;
    body += `<div style="font-size:11px;"><b style="color:#e08080;">Spending lines</b></div><div style="font-size:11px;">${bullets(L(CrownBooks.EXPENSE_LINES))}</div>`;
    body += `<div style="font-size:11px;"><b>Below the line</b></div><div style="font-size:11px;">${bullets(L([...CrownBooks.FINANCE_LINES, 'other']))}</div>`;
    const html = more('ℹ️ What are these? The taxes, the levels and every line of the books', `<div class="tax-guide">${body}</div>`);
    return open ? html.replace('<details class="pk-more">', '<details class="pk-more" open>') : html;
}

/** The books' line labels (the Treasury table's names). */
export const LINE_LABEL = {
    land: 'Land tax', poll: 'Hearth tax', excise: 'Excise', customs: 'Customs & tolls', demesne: 'Demesne & monopolies',
    seigniorage: 'Seigniorage', farms: 'Tax farms sold', levy: 'Extraordinary levy', sales: 'Offices & land sold',
    army: 'Army wages', arms: 'Arms & armour', court: 'Court & administration', works: 'Roads & works', debt: 'Debt service', dole: 'Dole & granaries',
    purse: 'The ruler\'s purse', loans: 'Borrowed', debase: 'Debasement', other: 'Other (events, tribute, temples)',
};
export function lineLabel(l) {
    return LINE_LABEL[l] || l;
}

// ── The player's own settlement tax (systems/marketDynamics.js Taxation) ──

function _marketGuide() {
    const gd = DataLoader._gamedata;
    const g = gd && gd.market && gd.market.taxGuide;
    return g && typeof g === 'object' ? g : {};
}

/** A settlement tax level in figures: happiness target, growth a year, welfare. */
export function settlementLevelText(rate) {
    if (!rate) return '';
    const target = Math.max(0, Math.min(100, 50 + _num(rate.happinessBonus) * 1.5));
    const welfare = (_num(rate.rate) - 0.15) * 100;
    return `Takes ${Math.round(_num(rate.rate) * 100)}% · happiness heads for ${Math.round(target)} · growth ${_signed(_num(rate.growthBonus) * 100, 0)}% a year · welfare ${_signed(-welfare, 0)} pts`;
}

/**
 * The "ℹ️ What is this tax?" section of the Royal Treasury's Taxes tab: what
 * the player's settlement tax is, who pays, how it is reckoned, each level in
 * figures and what it does. `rates` is Taxation.TAX_RATES, `perHead` its base.
 */
export function settlementTaxGuide(rates, currentId, perHead = 0.25) {
    const G = _marketGuide();
    const extra = { perHead };
    let body = '';
    if (G.what) body += `<div style="font-size:11px; margin:4px 0;">${fill(G.what, {}, extra)}</div>`;
    if (G.who) body += `<div style="font-size:11px;"><b>Who pays:</b> ${fill(G.who, {}, extra)}</div>`;
    if (G.how) body += `<div style="font-size:11px;"><b>How much:</b> ${fill(G.how, {}, extra)}</div>`;
    const rows = Object.values(rates || {}).map(r => {
        const here = r.id === currentId;
        return `<li${here ? ' style="color:var(--gold);"' : ''}><b>${esc(r.name)}</b>${here ? ' ◂ now' : ''}: ${esc(settlementLevelText(r))}</li>`;
    }).join('');
    if (rows) body += `<div style="font-size:11px; margin-top:4px;"><b>The rates:</b></div><ul class="pk-list" style="font-size:11px;">${rows}</ul>`;
    if (Array.isArray(G.effects) && G.effects.length) body += `<div style="font-size:11px;"><b>What it does:</b></div><div style="font-size:11px;">${bullets(G.effects.map(s => fill(s, {}, extra)))}</div>`;
    return more('ℹ️ What is this tax? Who pays it, how it is reckoned, what each rate does', body);
}
