// ============================================
// "WHY?" — a small ⓘ beside a number that opens the factors behind it
// ============================================
// whyIcon(payload) returns the ⓘ's HTML with the explanation carried on the
// element itself (data-why, JSON), so any panel built as an HTML string can
// offer one without wiring handlers: one delegated click listener on the
// document (installed on first use) opens a popover beside the ⓘ. The
// payloads come from player/causes.js through the formatters below
// (priceWhy, sellWhy, opinionWhy, stabilityWhy, taxWhy).
//
// The popover is appended to <body>, which styles.css zooms by --ui-zoom: its
// position (from getBoundingClientRect, viewport px) is divided by the zoom
// (ui/uiScale.js toUiPx), and its max sizes are written as vw/vh ÷ zoom.

import { toUiPx } from './uiScale.js';

const POP_ID = 'whyPopover';
let _installed = false;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const signed = (n, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`;
const gold = (n) => signed(Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n), 'g');
const pctOf = (p) => signed(p, '%');
const tone = (n, good = 1) => (n * good > 0 ? 'up' : n * good < 0 ? 'down' : '');

// ── The ⓘ ─────────────────────────────────────────────

/**
 * The ⓘ that opens a payload: { title, value, rows: [[label, value, tone?]],
 * notes: [text], foot }. tone: 'up' (good for you, green) | 'down' (red) | ''.
 */
export function whyIcon(payload, title = 'Why?') {
    if (!payload) return '';
    installWhy();
    return `<span class="why-i" role="button" tabindex="0" title="${esc(title)}" data-why="${esc(JSON.stringify(payload))}">ⓘ</span>`;
}

// ── Formatters: Causes.* → payloads ───────────────────

/** The market's asking price (Causes.price) — and what you pay. Dearer is bad for a buyer. */
export function priceWhy(e) {
    if (!e) return null;
    const rows = [['Base price', `${e.base}g`, '']];
    for (const f of e.factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
        rows.push([`${esc(f.label)}${f.detail ? ` <i>(${esc(f.detail)})</i>` : ''}`, `${pctOf(f.pct)} · ${gold(f.delta)}`, tone(f.delta, -1)]);
    }
    if (Math.abs(e.rest + e.rounding) >= 0.5) rows.push(['Rounding', gold(e.rest + e.rounding), '']);
    rows.push(['<b>Market price</b>', `<b>${e.price}g</b>`, '', true]);
    if (e.you) {
        for (const f of e.you.buyFactors) rows.push([`${esc(f.label)}${f.detail ? ` <i>(${esc(f.detail)})</i>` : ''}`, pctOf(f.pct), tone(f.pct, -1)]);
        rows.push(['<b>You pay for one</b>', `<b>${e.you.buy}g</b>`, '', true]);
    }
    return {
        title: `${e.goodName} in ${e.settlement || 'this market'}`,
        value: e.summary,
        rows,
        notes: e.drivers.map(d => `${d.sign > 0 ? '▲' : '▼'} ${d.label}`),
        foot: 'Buying takes stock off the stalls (each unit dearer); selling adds it (each unit cheaper).',
    };
}

/** What the stalls pay you for one (Causes.price → you.sell). Dearer is good for a seller. */
export function sellWhy(e) {
    if (!e || !e.you || e.you.sell == null) return null;
    const rows = [[`What it is worth here (the market asks ${e.price}g)`, '', '']];
    for (const f of e.you.sellFactors) rows.push([esc(f.label), pctOf(f.pct), tone(f.pct, 1)]);
    rows.push(['<b>They pay you for one</b>', `<b>${e.you.sell}g</b>`, '', true]);
    return {
        title: `Selling ${e.goodName} in ${e.settlement || 'this market'}`,
        value: e.summary,
        rows,
        notes: e.drivers.map(d => `${d.sign > 0 ? '▲' : '▼'} ${d.label}`),
        foot: 'No stall pays more than buying it back would cost you here.',
    };
}

/** A lord's opinion of you (Causes.lordOpinion). */
export function opinionWhy(e) {
    if (!e) return null;
    const rows = [];
    for (const f of e.factors) rows.push([esc(f.label), signed(Math.round(f.delta * 10) / 10), tone(f.delta)]);
    if (!e.factors.length) rows.push(['He has formed no opinion of you yet', '0', '']);
    rows.push(['<b>His opinion</b>', `<b>${signed(Math.round(e.opinion))}</b>`, '', true]);
    for (const f of e.bonusParts) rows.push([esc(f.label), signed(Math.round(f.delta)), tone(f.delta)]);
    if (e.reputation) rows.push(['Your reputation in his realm', signed(Math.round(e.reputation)), tone(e.reputation)]);
    rows.push(['<b>Standing with him</b>', `<b>${signed(Math.round(e.total))}</b>`, '', true]);
    return { title: `What ${e.lord} thinks of you`, value: e.summary, rows, notes: [], foot: 'Remembered deeds fade with time; a blood feud passes to his heir.' };
}

/** A realm's stability (Causes.stability). */
export function stabilityWhy(e) {
    if (!e) return null;
    const rows = [['Base', String(e.base), '']];
    for (const f of e.factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) rows.push([esc(f.label), signed(Math.round(f.delta * 10) / 10), tone(f.delta)]);
    rows.push(['<b>Heading toward</b>', `<b>${Math.round(e.target)}</b>`, '', true]);
    return {
        title: `${e.kingdom}: stability ${Math.round(e.value)} (${e.label})`,
        value: e.summary,
        rows,
        notes: [`It moves ${signed(e.drift)} a day toward the target · taxes ×${e.income.toFixed(2)}`, 'Below 35 the realm grows restless and may rebel.'],
        foot: '',
    };
}

/** A town's weekly tax and its mood (Causes.tax). */
export function taxWhy(e) {
    if (!e) return null;
    const rows = [[`${e.base}g base (a quarter-gold a head) × ${Math.round(e.rate * 100)}% (${esc(e.policy)})`, `${Math.round(e.rated * 10) / 10}g`, '']];
    for (const f of e.factors.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) rows.push([esc(f.label), `${pctOf(f.pct)} · ${gold(f.delta)}`, tone(f.delta)]);
    rows.push(['<b>A week\'s tax</b>', `<b>${e.amount}g</b>`, '', true]);
    rows.push([`<b>Mood ${e.happiness}/100, heading toward ${e.moodTarget}</b>`, '', '', true]);
    for (const p of e.moodParts) rows.push([esc(p.label), signed(Math.round(p.delta * 10) / 10), p.label === 'Content by nature' ? '' : tone(p.delta)]);
    const notes = [];
    if (e.marketMood) notes.push(`${e.marketMood > 0 ? '▲ Full stalls lift' : '▼ Cold hearths sour'} the mood day by day (${signed(e.marketMood)})`);
    if (e.unrest != null && e.unrest > 0) notes.push(`Unrest ${Math.round(e.unrest)}/100`);
    return { title: `${e.town}: taxes and mood`, value: e.summary, rows, notes, foot: 'Each week the mood closes a quarter of the gap to its target.' };
}

// ── The popover ───────────────────────────────────────

function renderPayload(p) {
    const rows = (p.rows || []).map(([label, value, t, raw]) => {
        const cls = t === 'up' ? 'why-up' : t === 'down' ? 'why-down' : '';
        return `<div class="why-row${raw ? ' why-strong' : ''}"><span class="why-l">${label}</span><span class="why-v ${cls}">${value}</span></div>`;
    }).join('');
    const notes = (p.notes || []).length ? `<div class="why-notes">${p.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>` : '';
    return `<div class="why-title">${esc(p.title || 'Why?')}</div>${p.value ? `<div class="why-sum">${esc(p.value)}</div>` : ''}${rows}${notes}${p.foot ? `<div class="why-foot">${esc(p.foot)}</div>` : ''}`;
}

const STYLE = `
.why-i { display:inline-block; margin-left:4px; width:14px; height:14px; line-height:14px; text-align:center; border-radius:50%;
    font-size:11px; font-weight:700; color:var(--gold); background:rgba(245,197,66,0.12); cursor:help; vertical-align:middle; user-select:none; }
.why-i:hover, .why-i:focus { background:rgba(245,197,66,0.3); outline:none; }
#whyPopover { position:fixed; z-index:100000; max-width:min(360px, calc(90vw / var(--ui-zoom, 1))); max-height:calc(70vh / var(--ui-zoom, 1)); overflow-y:auto;
    background:rgba(20,18,28,0.97); border:1px solid rgba(245,197,66,0.45); border-radius:6px; padding:8px 10px;
    box-shadow:0 6px 24px rgba(0,0,0,0.6); font-family:var(--font-body); font-size:12px; color:var(--text-primary, #eee); }
#whyPopover .why-title { font-weight:700; color:var(--gold); font-size:13px; margin-bottom:2px; }
#whyPopover .why-sum { color:var(--text-secondary, #bbb); font-size:11px; margin-bottom:6px; }
#whyPopover .why-row { display:flex; justify-content:space-between; gap:12px; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
#whyPopover .why-row.why-strong { border-top:1px solid rgba(255,255,255,0.15); }
#whyPopover .why-l { flex:1; } #whyPopover .why-l i { color:var(--text-secondary, #aaa); font-style:normal; font-size:11px; }
#whyPopover .why-v { white-space:nowrap; text-align:right; }
#whyPopover .why-up { color:#7bd88f; } #whyPopover .why-down { color:#e57373; }
#whyPopover .why-notes { margin-top:6px; font-size:11px; color:var(--text-secondary, #bbb); }
#whyPopover .why-foot { margin-top:6px; font-size:10px; color:rgba(255,255,255,0.45); }
`;

export function closeWhy() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const el = document.getElementById(POP_ID);
    if (el && el.remove) el.remove();
}

/** Open the popover for an ⓘ element (its data-why payload). */
export function openWhy(target) {
    if (typeof document === 'undefined' || !target || typeof target.getAttribute !== 'function') return;
    let payload = null;
    try {
        payload = JSON.parse(target.getAttribute('data-why') || 'null');
    } catch {
        payload = null;
    }
    if (!payload) return;
    closeWhy();
    const pop = document.createElement('div');
    pop.id = POP_ID;
    pop.innerHTML = renderPayload(payload);
    document.body.appendChild(pop);
    // Place it under the ⓘ (or above, if it would run off the bottom), inside the window
    const r = target.getBoundingClientRect();
    const vw = toUiPx(window.innerWidth), vh = toUiPx(window.innerHeight);
    const w = pop.offsetWidth || 300, h = pop.offsetHeight || 200;
    let left = toUiPx(r.left) - 8;
    let top = toUiPx(r.bottom) + 4;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (top + h > vh - 8) top = Math.max(8, toUiPx(r.top) - h - 4);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
}

/** Install the delegated listeners and the styles (once; a no-op without a DOM). */
export function installWhy() {
    if (_installed || typeof document === 'undefined' || typeof document.addEventListener !== 'function' || !document.head) return;
    _installed = true;
    if (!document.getElementById('whyPopoverStyle')) {
        const st = document.createElement('style');
        st.id = 'whyPopoverStyle';
        st.textContent = STYLE;
        document.head.appendChild(st);
    }
    // Capture: the ⓘ answers before a row's own click (a Buy button, a hex) does
    document.addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target.closest('.why-i') : null;
        if (t) {
            ev.preventDefault();
            ev.stopPropagation();
            openWhy(t);
            return;
        }
        if (!(ev.target && ev.target.closest && ev.target.closest(`#${POP_ID}`))) closeWhy();
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeWhy();
        else if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.classList && ev.target.classList.contains('why-i')) {
            ev.preventDefault();
            openWhy(ev.target);
        }
    }, true);
}
