// ChronicleBookExport — the Annals as an illustrated book you can keep: one
// self-contained HTML file (inline CSS, the maps as inline SVG, portraits as
// data: images) that opens offline and prints to PDF through its print CSS.
//
//   render(book, opts)   the HTML string for a composed book (systems/
//                        chronicleBook.js compose). Pure: no DOM, no globals —
//                        the tests render it under node.
//   build(game, opts)    compose, paint the rulers' portraits (when the LPC
//                        sprites can be drawn), read the LLM prose where it is
//                        written (systems/llmProse.js, optional) and render.
//                        → { html, filename, book }
//   exportBook(game, { pdf })  build, then save: Electron's save dialog (and
//                        printToPDF) through the preload bridge
//                        (window.lotrDesktop, electron-preload.js), else a
//                        browser download — or, for a PDF in the browser, the
//                        print dialog on a hidden frame ("Save as PDF").
//
// Opened from the Annals panel (ui/actionMenu/annals.js), which the death
// screen, the end of the line and the victory scene all lead to.
import { ChronicleBook } from '../systems/chronicleBook.js';
import { ChronicleMaps } from '../systems/chronicleMaps.js';
import { DataLoader } from '../core/dataLoader.js';
import { Relationships } from '../systems/relationships.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
    'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'];
const roman = (i) => ROMAN[i] || String(i + 1);

// The LLM's prose (another module, written apart): found if it exists, never required
const PROSE_MODULES = import.meta.glob('../systems/llmProse.js');

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _fmt = (n) => Math.round(_num(n)).toLocaleString('en-US');

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _fill(s, vars) {
    return String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _cfg() {
    const gd = DataLoader._gamedata;
    return (gd && gd.chronicleBook) || {};
}

function _safeColor(c, fallback = '#8a7a5a') {
    const s = String(c || '');
    return /^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(s) ? s : fallback;
}

// ── Pictures ────────────────────────────────────────

/** The House's arms: a heater shield in the sigil's colour, its charge, a ribbon with the motto. */
export function armsSvg(house, size = 180) {
    const sig = (house && house.sigil) || {};
    const field = _safeColor(sig.color, '#7a1f1f');
    const icon = esc(sig.icon || '⚜');
    const id = `sh${Math.abs(String(house && house.name).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`;
    return `<svg class="arms" viewBox="0 0 120 140" width="${size}" height="${Math.round(size * 140 / 120)}" role="img" aria-label="The arms of ${esc(house && house.name)}">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient></defs>
<path d="M10 8 H110 V62 C110 100 84 122 60 134 C36 122 10 100 10 62 Z" fill="${field}" stroke="#b8963e" stroke-width="5"/>
<path d="M10 8 H110 V62 C110 100 84 122 60 134 C36 122 10 100 10 62 Z" fill="url(#${id})"/>
<path d="M18 16 H102 V62 C102 95 80 114 60 125 C40 114 18 95 18 62 Z" fill="none" stroke="#f3e2a8" stroke-opacity=".55" stroke-width="1.5"/>
<text x="60" y="80" font-size="46" text-anchor="middle" dominant-baseline="middle">${icon}</text>
</svg>`;
}

/** A portrait: the painted bust when there is one, else a medallion with the ruler's initial. */
function _portrait(src, name, gender) {
    if (src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) {
        return `<figure class="portrait"><img src="${src}" alt="${esc(name)}" width="128" height="128"></figure>`;
    }
    const initial = esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
    return `<figure class="portrait medallion ${gender === 'female' ? 'f' : 'm'}" aria-label="${esc(name)}"><span>${initial}</span></figure>`;
}

const MAP_WATER = '#b9cdd2', MAP_LAND = '#e7dcc0', MAP_PEAK = '#c9b993';

/**
 * A border snapshot (systems/chronicleMaps.js) as inline SVG: one path per
 * realm colour, the borders inked, the seats of the larger realms named,
 * the House's holdings in gold, the realm it rules marked with a crown.
 */
export function mapSvg(mark, opts = {}) {
    const rows = ChronicleMaps.decode(mark);
    if (!rows.length) return '';
    const w = mark.w || rows[0].length, h = mark.h || rows.length;
    const color = { '~': MAP_WATER, '.': MAP_LAND, '^': MAP_PEAK };
    for (const [L, , , c] of _arr(mark.realms)) color[L] = _safeColor(c);
    const paths = {};
    for (let y = 0; y < rows.length; y++) {
        const row = rows[y];
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            let n = 1;
            while (x + n < row.length && row[x + n] === ch) n++;
            (paths[ch] = paths[ch] || []).push(`M${x} ${y}h${n}v1h-${n}z`);
            x += n;
        }
    }
    // Borders: between two different realms, or a realm and unclaimed land (not the shore)
    const ink = [];
    const isRealm = (c) => c && c !== '~' && c !== '.' && c !== '^';
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) {
            const c = rows[y][x];
            const r = rows[y][x + 1], d = rows[y + 1] && rows[y + 1][x];
            if (r && r !== c && (isRealm(c) || isRealm(r)) && c !== '~' && r !== '~') ink.push(`M${x + 1} ${y}v1`);
            if (d && d !== c && (isRealm(c) || isRealm(d)) && c !== '~' && d !== '~') ink.push(`M${x} ${y + 1}h1`);
        }
    }
    const order = ['~', '.', '^', ...Object.keys(paths).filter(k => !'~.^'.includes(k))];
    let body = '';
    for (const ch of order) {
        if (!paths[ch]) continue;
        const realm = isRealm(ch);
        body += `<path d="${paths[ch].join('')}" fill="${color[ch] || MAP_LAND}"${realm ? ' fill-opacity=".82"' : ''}/>`;
    }
    if (ink.length) body += `<path d="${ink.join('')}" stroke="#3a2c18" stroke-width=".18" stroke-linecap="square" fill="none"/>`;
    if (mark.crown) {
        const crownCells = paths[mark.crown];
        if (crownCells) body += `<path d="${crownCells.join('')}" fill="none" stroke="#b8963e" stroke-width=".12" stroke-opacity=".9"/>`;
    }
    for (const cell of _arr(mark.own)) {
        const x = cell % w, y = Math.floor(cell / w);
        body += `<rect x="${x + 0.2}" y="${y + 0.2}" width=".6" height=".6" fill="#d4a017" stroke="#5a3d00" stroke-width=".08"/>`;
    }
    // The seats of the larger realms
    const big = _arr(mark.realms).slice().sort((a, b) => b[4] - a[4]).slice(0, opts.labels != null ? opts.labels : 8).map(r => r[0]);
    const names = Object.fromEntries(_arr(mark.realms).map(r => [r[0], r[2]]));
    const fs = Math.max(1.2, w / 34);
    for (const [L, x, y] of _arr(mark.seats)) {
        if (!big.includes(L) || opts.labels === 0) continue;
        body += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r=".55" fill="#2a1f10"/>`;
        body += `<text x="${x + 0.5}" y="${y - 0.5}" font-size="${fs.toFixed(2)}" text-anchor="middle" class="seat">${esc(names[L] || '')}${L === mark.crown ? ' ♛' : ''}</text>`;
    }
    return `<svg class="map" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(mark.label || 'A map of the realm')}"><rect width="${w}" height="${h}" fill="${MAP_WATER}"/>${body}<rect width="${w}" height="${h}" fill="none" stroke="#3a2c18" stroke-width=".3"/></svg>`;
}

function _mapLegend(mark, max = 10) {
    const realms = _arr(mark.realms).slice().sort((a, b) => b[4] - a[4]).slice(0, max);
    if (!realms.length) return '';
    return `<ul class="legend">${realms.map(([L, , name, c]) => `<li><i style="background:${_safeColor(c)}"></i>${esc(name)}${L === mark.crown ? ' <b title="ruled by the House">♛</b>' : ''}</li>`).join('')}${_arr(mark.own).length ? '<li><i class="own"></i>Holdings of the House</li>' : ''}</ul>`;
}

function _mapFigure(mark, cls = '') {
    if (!mark) return '';
    return `<figure class="mapfig ${cls}">${mapSvg(mark)}<figcaption>${esc(mark.label || '')}${mark.year && !String(mark.label || '').includes(String(mark.year)) ? ` <span class="yr">(year ${esc(mark.year)})</span>` : ''}</figcaption>${_mapLegend(mark)}</figure>`;
}

/** The purse across the generations, as a small line. */
function _wealthSvg(marks) {
    const pts = _arr(marks).filter(m => Number.isFinite(m.gold));
    if (pts.length < 2) return '';
    const W = 600, H = 120, pad = 6;
    const d0 = pts[0].day, d1 = pts[pts.length - 1].day || d0 + 1;
    const max = Math.max(1, ...pts.map(p => p.gold)), min = Math.min(0, ...pts.map(p => p.gold));
    const X = (d) => pad + (W - 2 * pad) * ((d - d0) / Math.max(1, d1 - d0));
    const Y = (g) => H - pad - (H - 2 * pad) * ((g - min) / Math.max(1, max - min));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)} ${Y(p.gold).toFixed(1)}`).join('');
    const peak = pts.reduce((a, b) => (b.gold > a.gold ? b : a), pts[0]);
    return `<figure class="wealth"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The House's purse over the years"><path d="${line}" fill="none" stroke="#7a5a1e" stroke-width="2"/><circle cx="${X(peak.day).toFixed(1)}" cy="${Y(peak.gold).toFixed(1)}" r="3.5" fill="#b8963e"/></svg>
<figcaption>The purse from the year ${esc(pts[0].year)} (${_fmt(pts[0].gold)} gold) to the year ${esc(pts[pts.length - 1].year)} (${_fmt(pts[pts.length - 1].gold)} gold); at its height ${_fmt(peak.gold)} gold, in the year ${esc(peak.year)}.</figcaption></figure>`;
}

// ── Prose ───────────────────────────────────────────

function _paras(paragraphs) {
    return _arr(paragraphs).map((p, i) => {
        const text = esc(p.text);
        const cls = [i === 0 ? 'first' : '', p.quiet ? 'quiet' : ''].filter(Boolean).join(' ');
        return `<p${cls ? ` class="${cls}"` : ''}>${text}</p>`;
    }).join('\n');
}

const _split = (text) => String(text || '').split(/\n\s*\n|\n/).map(t => t.trim()).filter(Boolean).map(text => ({ text }));

/** The text for one part: the LLM's where written, else what the caller has. */
function _prose(opts, kind, vars, fallback) {
    const look = opts.prose;
    if (typeof look !== 'function') return fallback;
    const keys = _arr((_cfg().proseKeys || {})[kind]);
    for (const k of keys) {
        let t = null;
        try { t = look(_fill(k, vars)); } catch (e) { t = null; }
        if (typeof t === 'string' && t.trim()) return t;
    }
    return fallback;
}

function _momentsHtml(moments, titles) {
    const kinds = ['battles', 'works', 'deaths'].filter(k => _arr(moments && moments[k]).length);
    if (!kinds.length) return '';
    return `<div class="moments">${kinds.map(k => {
        const t = (titles && titles[k]) || { title: k, icon: '' };
        return `<section class="mom ${k}"><h4>${esc(t.icon || '')} ${esc(t.title)}</h4><ul>${moments[k].map(m => `<li><span class="yr">${esc(m.year)}</span> ${esc(m.text)}</li>`).join('')}</ul></section>`;
    }).join('')}</div>`;
}

function _treeHtml(tree) {
    const line = _arr(tree && tree.line);
    if (!line.length) return '<p class="quiet">The line is not yet written.</p>';
    return `<ol class="tree">${line.map((r, i) => {
        const kids = _arr(r.children);
        return `<li class="gen">
<div class="couple"><div class="ruler${r.live ? ' live' : ''}"><span class="gn">${roman(i)}</span> <b>${esc(r.name)}</b>${r.epithet ? ` <i>${esc(r.epithet)}</i>` : ''}<small>${esc(r.from)}${r.to && r.to !== r.from ? `–${esc(r.to)}` : ''}${r.live ? ' · reigning' : ''}</small></div>${r.spouse ? `<span class="wed">m.</span><div class="spouse">${esc(r.spouse)}</div>` : ''}</div>
${kids.length ? `<ul class="kids">${kids.map(k => `<li class="${k.ruled ? 'heir' : ''}${k.alive ? '' : ' dead'}">${esc(k.name)}${k.born ? ` <small>b. ${esc(k.born)}</small>` : ''}${k.alive ? '' : ' <small>†</small>'}</li>`).join('')}</ul>` : ''}
</li>`;
    }).join('')}</ol>`;
}

function _ledgerHtml(st) {
    if (!st || (!st.op.income.length && !st.op.expenses.length)) return '';
    const rows = (list) => list.slice(0, 10).map(l => `<tr><td>${esc(l.name)}</td><td class="n">${_fmt(l.amount)}</td></tr>`).join('');
    return `<h3>The Ledger, the last year</h3><div class="cols2">
<table class="stats"><caption>Earned</caption>${rows(st.op.income) || '<tr><td>Nothing booked</td><td></td></tr>'}</table>
<table class="stats"><caption>Spent</caption>${rows(st.op.expenses) || '<tr><td>Nothing booked</td><td></td></tr>'}</table></div>
<p class="net">Net: <b>${_fmt(st.op.net)}</b> gold</p>`;
}

function _deedsHtml(deeds) {
    if (!_arr(deeds).length) return '';
    return `<h3>Deeds &amp; Records</h3><div class="deeds">${deeds.map(s => `<table class="stats"><caption>${esc(s.icon || '')} ${esc(s.title)}</caption>${s.rows.map(r => `<tr><td>${esc(r.label)}${r.current ? ' <small>(now)</small>' : ''}</td><td class="n">${_fmt(r.value)}</td></tr>`).join('')}</table>`).join('')}</div>`;
}

// ── The book ────────────────────────────────────────

const CSS = `
:root{--ink:#2b2116;--soft:#6b5a43;--gold:#9a7425;--rule:#c9b27a;--paper:#f6efdc;--paper2:#efe4c8}
*{box-sizing:border-box}
html{background:#d9ccab}
body{margin:0;color:var(--ink);font:17px/1.62 Georgia,"Palatino Linotype","Book Antiqua",serif;background:#d9ccab}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;justify-content:center;padding:8px 16px;background:#2b2116;color:#f3e7c6;font:14px system-ui,sans-serif}
.toolbar button{font:inherit;color:#2b2116;background:#e9d9a6;border:1px solid #b8963e;border-radius:4px;padding:5px 12px;cursor:pointer}
.page{max-width:820px;margin:24px auto;padding:56px 64px;background:linear-gradient(180deg,var(--paper),var(--paper2));box-shadow:0 2px 14px rgba(40,25,5,.35);border:1px solid #cdbb8e}
h1,h2,h3,h4{font-weight:normal;color:var(--ink);line-height:1.25}
h2{font-size:28px;text-align:center;margin:4px 0 6px}
h3{font-size:19px;color:var(--gold);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--rule);padding-bottom:4px;margin:28px 0 12px}
h4{font-size:15px;margin:0 0 6px;color:var(--soft);letter-spacing:.04em;text-transform:uppercase}
.kicker{text-align:center;font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:var(--soft)}
.dates{text-align:center;color:var(--soft);font-style:italic;margin-bottom:18px}
.orn{text-align:center;color:var(--gold);letter-spacing:.6em;margin:18px 0}
p{margin:0 0 12px;text-align:justify;hyphens:auto}
p.first::first-letter{float:left;font-size:58px;line-height:48px;padding:6px 8px 0 0;color:var(--gold)}
p.quiet,.quiet{font-style:italic;color:var(--soft)}
.title{text-align:center;padding-top:90px;min-height:900px}
.title h1{font-size:44px;margin:26px 0 8px;letter-spacing:.02em}
.title .motto{font-style:italic;font-size:20px;color:var(--soft)}
.title .sub{margin-top:40px;color:var(--soft)}
.title .rank{margin-top:10px;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.toc ol{list-style:none;padding:0;margin:0}
.toc li{display:flex;gap:8px;border-bottom:1px dotted var(--rule);padding:5px 0}
.toc li a{color:var(--ink);text-decoration:none;flex:1}
.toc .n{color:var(--gold);min-width:42px}
.head{display:flex;gap:22px;align-items:center;justify-content:center;margin-bottom:10px}
.portrait{margin:0;flex:0 0 auto}
.portrait img{width:128px;height:128px;image-rendering:pixelated;border:3px double var(--gold);border-radius:50%;background:#e2d3a8;object-fit:cover}
.medallion{width:118px;height:118px;border-radius:50%;border:3px double var(--gold);display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 40% 35%,#f4e6bd,#cdb47a)}
.medallion span{font-size:56px;color:#5b4320}
.head .titles{flex:1;min-width:0}
.mapfig{margin:22px 0 8px;page-break-inside:avoid;break-inside:avoid}
.mapfig svg.map{width:100%;height:auto;display:block;border:1px solid #8a7246;background:${MAP_WATER}}
.mapfig figcaption{text-align:center;font-style:italic;color:var(--soft);font-size:14px;margin-top:6px}
.seat{font-family:Georgia,serif;fill:#21180c;paint-order:stroke;stroke:#f6efdc;stroke-width:.35px}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center;padding:0;margin:6px 0 0;font-size:13px;color:var(--soft)}
.legend i{display:inline-block;width:11px;height:11px;margin-right:5px;vertical-align:-1px;border:1px solid #5a4a2a}
.legend i.own{background:#d4a017}
.moments{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:20px 0 4px;page-break-inside:avoid;break-inside:avoid}
.mom{background:rgba(201,178,122,.16);border:1px solid rgba(154,116,37,.35);border-radius:3px;padding:10px 12px}
.mom ul{margin:0;padding:0;list-style:none;font-size:14px;line-height:1.45}
.mom li{margin-bottom:5px}
.yr{color:var(--gold);font-variant-numeric:oldstyle-nums}
.atlas{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.atlas figure{margin:0;break-inside:avoid}
.atlas svg{width:100%;height:auto;border:1px solid #8a7246}
.atlas figcaption{font-size:13px;text-align:center;font-style:italic;color:var(--soft)}
.tree{list-style:none;padding:0;margin:0}
.tree .gen{position:relative;padding:0 0 18px 0;margin-left:14px;border-left:2px solid var(--rule);padding-left:18px}
.tree .gen:last-child{border-left-color:transparent}
.couple{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ruler,.spouse{border:1px solid var(--gold);background:#fbf5e3;border-radius:4px;padding:5px 10px}
.ruler.live{box-shadow:0 0 0 2px rgba(184,150,62,.4)}
.ruler small{display:block;color:var(--soft);font-size:12px}
.gn{color:var(--gold);font-size:13px}
.wed{color:var(--soft);font-style:italic}
.spouse{border-style:dashed;font-size:15px}
.kids{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:8px 0 0}
.kids li{font-size:14px;border:1px solid var(--rule);border-radius:12px;padding:1px 10px;background:rgba(255,255,255,.4)}
.kids li.heir{border-color:var(--gold);font-weight:bold}
.kids li.dead{color:var(--soft)}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}
.summary div{text-align:center;border:1px solid var(--rule);padding:8px;border-radius:3px}
.summary b{display:block;font-size:22px;color:var(--gold);font-weight:normal}
.summary span{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--soft)}
.cols2,.deeds{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
table.stats{width:100%;border-collapse:collapse;font-size:14px;break-inside:avoid}
table.stats caption{text-align:left;font-weight:bold;color:var(--soft);padding:4px 0}
table.stats td{border-bottom:1px dotted var(--rule);padding:3px 2px}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.net{text-align:right}
.wealth{margin:10px 0}
.wealth svg{width:100%;height:auto;background:rgba(255,255,255,.35);border:1px solid var(--rule)}
.wealth figcaption{font-size:13px;color:var(--soft);font-style:italic}
.epitaph{text-align:center;font-style:italic;font-size:19px;margin:24px 0}
.colophon{text-align:center;font-size:13px;color:var(--soft);margin-top:30px}
@media (max-width:700px){.page{padding:28px 18px;margin:12px 0}.title{min-height:auto;padding-top:30px}.head{flex-direction:column}}
@page{size:A4;margin:16mm 14mm}
@media print{
html,body{background:#fff}
.toolbar{display:none}
.page{box-shadow:none;border:0;margin:0;max-width:none;padding:0;background:#fff;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.title{min-height:auto;padding-top:60mm}
a{color:inherit;text-decoration:none}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

/**
 * The whole book as one HTML document. opts: { portraits: { sectionId:
 * dataURL }, prose: (key) => text|null (the LLM's written prose), scribe:
 * (chapter) => text|null (the court scribe's retelling), toolbar (default
 * true: the Print button on screen) }.
 */
export function render(book, opts = {}) {
    const cfg = _cfg();
    const house = book.house || {};
    const hid = book.houseId || house.name || 'house';
    const portraits = opts.portraits || {};
    const sections = _arr(book.sections);
    const first = sections[0], last = sections[sections.length - 1];
    const from = book.foundedYear || (first && first.from) || book.year;
    const to = (book.ended && book.ended.year) || book.year;
    const gens = sections.length;
    const vars = { house: house.name || 'the House', from, to, generations: gens, generationsWord: gens === 1 ? 'generation' : 'generations', last: last ? last.ruler.name : '', rank: (book.appendix && book.appendix.rank) || '' };
    const pick = (list) => _arr(list)[0] || '';
    const foreword = _prose(opts, 'foreword', { house: hid }, _fill(pick(book.ended ? cfg.forewordEnded : cfg.foreword), vars));
    const epilogue = _prose(opts, 'epilogue', { house: hid }, _fill(pick(book.ended ? cfg.epilogueEnded : cfg.epilogue), vars));

    const out = [];
    out.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(book.title || 'The Annals')}</title><meta name="generator" content="Lord of the Realms — the illustrated chronicle"><style>${CSS}</style></head><body>`);
    if (opts.toolbar !== false) out.push(`<div class="toolbar"><span>${esc(book.title)}</span><button type="button" onclick="window.print()">Print / Save as PDF</button></div>`);

    // Title page
    out.push(`<section class="page title" id="title">${armsSvg(house, 190)}<h1>${esc(book.title)}</h1>${house.motto ? `<div class="motto">&ldquo;${esc(house.motto)}&rdquo;</div>` : ''}
<div class="sub">Being the chronicle of ${esc(house.name || 'the House')}, ${gens} ${vars.generationsWord}, from the year ${esc(from)} to the year ${esc(to)}${book.ended ? ', when the line ended' : ''}.</div>
${book.appendix && book.appendix.rank ? `<div class="rank">${esc(book.appendix.rankIcon || '')} ${esc(book.appendix.rank)}</div>` : ''}</section>`);

    // Contents and foreword
    const toc = sections.map(s => `<li><span class="n">${roman(s.index)}.</span><a href="#${esc(s.id)}">${esc(s.chapter.title)}</a></li>`);
    const extra = [];
    if (book.annals && book.annals.legacy) extra.push(['legacy', book.annals.legacy.title || 'Legacy']);
    if (_arr(book.ages).length) extra.push(['ages', 'The ages of the world']);
    if (_arr(book.annals && book.annals.before).length) extra.push(['before', 'The books of the lines before']);
    if (_arr(book.atlas).length) extra.push(['atlas', 'The realm through the years']);
    extra.push(['tree', 'The line of the House'], ['appendix', 'Appendix: the House in numbers']);
    toc.push(...extra.map(([id, t]) => `<li><span class="n">·</span><a href="#${id}">${esc(t)}</a></li>`));
    out.push(`<section class="page toc" id="contents"><h2>Contents</h2><div class="orn">✦ ✦ ✦</div><ol>${toc.join('')}</ol>
${foreword ? `<h3>Foreword</h3>${_paras(_split(foreword))}` : ''}</section>`);

    // The chapters, one per reign
    for (const s of sections) {
        const ch = s.chapter;
        const vars2 = { house: hid, chapter: s.id };
        const llm = _prose(opts, 'chapter', vars2, null);
        const scribed = !llm && typeof opts.scribe === 'function' ? opts.scribe(ch) : null;
        const prose = llm || scribed;
        const summary = _prose(opts, 'summary', vars2, null);
        const yrs = s.years != null && !s.live ? ` · ${s.years} year${s.years === 1 ? '' : 's'}` : '';
        out.push(`<section class="page chapter" id="${esc(s.id)}">
<div class="head">${_portrait(portraits[s.id], s.ruler.name, s.ruler.gender)}<div class="titles"><div class="kicker">Chapter ${roman(s.index)}</div><h2>${esc(ch.title)}</h2>
<div class="dates">${esc(s.from)}${s.to !== s.from ? ` – ${s.live ? 'the present' : esc(s.to)}` : ''}${yrs}${s.cause ? ` · died of ${esc(s.cause)}` : ''}</div></div></div>
${prose ? _paras(_split(prose)) : _paras(ch.paragraphs)}
${summary ? `<div class="orn">✦</div>${_paras(_split(summary))}` : ''}
${_mapFigure(s.map)}
${_momentsHtml(s.moments, book.momentTitles)}
</section>`);
    }

    // The Legacy, and the epitaph of an ended line
    const L = book.annals && book.annals.legacy;
    if (L) {
        const legacy = _prose(opts, 'legacy', { house: hid }, null);
        const epitaph = book.ended ? _prose(opts, 'epitaph', { house: hid }, book.epitaph || '') : '';
        out.push(`<section class="page" id="legacy"><div class="kicker">The House as it stands</div><h2>${esc(L.rankIcon || '')} ${esc(L.title || 'Legacy')}</h2><div class="orn">✦ ✦ ✦</div>
${legacy ? _paras(_split(legacy)) : _paras(L.paragraphs)}${epitaph ? `<div class="epitaph">${esc(epitaph)}</div>` : ''}</section>`);
    }

    // The ages of the world: the great crises of the House's years (systems/crises.js)
    const ages = _arr(book.ages);
    if (ages.length) {
        out.push(`<section class="page" id="ages"><div class="kicker">Beyond the House</div><h2>The ages of the world</h2><div class="orn">✦ ✦ ✦</div>`);
        for (const a of ages) out.push(`<h3>${esc(a.icon || '')} ${esc(a.title)}</h3>${_paras(a.paragraphs)}`);
        out.push('</section>');
    }

    // Lines before a new life
    const before = _arr(book.annals && book.annals.before);
    if (before.length) {
        out.push(`<section class="page" id="before"><h2>The books of the lines before</h2><div class="orn">✦ ✦ ✦</div>`);
        for (const b of before.slice().reverse()) {
            out.push(`<h3>${esc(b.title)}</h3>`);
            for (const c of _arr(b.chapters)) out.push(`<h4>${esc(c.title)}</h4>${_paras(c.paragraphs)}`);
            if (b.legacy && _arr(b.legacy.paragraphs).length) out.push(`<h4>${esc(b.legacy.title)}</h4>${_paras(b.legacy.paragraphs)}`);
        }
        out.push('</section>');
    }

    // The atlas
    const atlas = _arr(book.atlas);
    if (atlas.length) {
        out.push(`<section class="page" id="atlas"><h2>The realm through the years</h2><div class="orn">✦ ✦ ✦</div><div class="atlas">${atlas.map(m => `<figure>${mapSvg(m, { labels: 0 })}<figcaption>${esc(m.label)}${m.year && !String(m.label || '').includes(String(m.year)) ? ` (year ${esc(m.year)})` : ''}</figcaption></figure>`).join('')}</div></section>`);
    }

    // The family tree
    out.push(`<section class="page" id="tree"><h2>The line of ${esc(house.name || 'the House')}</h2><div class="orn">✦ ✦ ✦</div>${_treeHtml(book.tree)}</section>`);

    // Appendix
    const A = book.appendix || {};
    out.push(`<section class="page" id="appendix"><h2>Appendix: the House in numbers</h2><div class="orn">✦ ✦ ✦</div>
<div class="summary"><div><b>${_fmt(A.generations)}</b><span>Generations</span></div><div><b>${_fmt(A.years)}</b><span>Years ruled</span></div><div><b>${_fmt(A.prestige)}</b><span>Prestige</span></div><div><b>${_fmt(A.score)}</b><span>Legacy</span></div><div><b>${_fmt(A.gold)}</b><span>Gold in the purse</span></div></div>
${_wealthSvg(A.wealth)}
${_ledgerHtml(A.ledger)}
${_deedsHtml(A.deeds)}
${epilogue ? `<h3>Epilogue</h3>${_paras(_split(epilogue))}` : ''}
<div class="colophon">Set down in the year ${esc(book.year)}, day ${esc(book.day)}. Lord of the Realms.</div></section>`);
    out.push('</body></html>');
    return out.join('\n');
}

// ── In the game ─────────────────────────────────────

async function _llmProse() {
    const load = PROSE_MODULES['../systems/llmProse.js'];
    if (!load) return null;
    try {
        const m = await load();
        return m && m.LlmProse && typeof m.LlmProse.text === 'function' ? m.LlmProse : null;
    } catch (e) {
        return null;
    }
}

/** The rulers' portraits as data: URLs, painted from their remembered looks (empty when sprites can't be drawn). */
async function _portraits(book, game) {
    const out = {};
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return out;
    try {
        const [{ NpcPortrait }, App] = await Promise.all([import('./npcPortrait.js'), import('./playerAppearance.js')]);
        await Promise.race([NpcPortrait.ensureLoaded(), new Promise(r => setTimeout(r, 4000))]);
        for (const s of book.sections) {
            const a = s.ruler.appearance;
            let preset = null;
            if (a) preset = await Promise.race([App.registerAppearance(a, s.live ? App.gearKit(game.player) : null), new Promise(r => setTimeout(() => r(null), 2500))]);
            if (!preset) preset = `${s.ruler.gender === 'female' ? 'female' : 'male'}_noble`;
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const ctx = c.getContext && c.getContext('2d');
            if (!ctx) continue;
            if (NpcPortrait.drawBust(ctx, preset, 0, 0, 0, 128)) out[s.id] = c.toDataURL('image/png');
        }
    } catch (e) { /* the medallions stand in */ }
    return out;
}

function _npc(id) {
    try {
        return id != null ? Relationships.getNPC(id) : null;
    } catch (e) {
        return null;
    }
}

function _spouseName(game) {
    const npc = _npc(game.player && game.player.spouse);
    return npc ? `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}` : null;
}

export function filenameFor(book, ext = 'html') {
    const base = String(book.title || 'The Annals').replace(/[^\p{L}\p{N} '-]+/gu, '').replace(/\s+/g, ' ').trim() || 'The Annals';
    return `${base} - year ${book.year}.${ext}`;
}

export const ChronicleBookExport = {
    render, mapSvg, armsSvg, filenameFor,

    /** Compose and render the book for this game. opts: { scribe, portraits:false, spouseName }. */
    async build(game, opts = {}) {
        const { player, world } = game;
        const spouseName = opts.spouseName || _spouseName(game);
        const book = ChronicleBook.compose(player, world, { spouseName, npc: _npc });
        const P = await _llmProse();
        const hid = book.houseId || (book.house && book.house.name) || 'house';
        if (P && typeof P.write === 'function') {
            // Ask for the foreword and epilogue (written in the background; the templates stand until then)
            const facts = {
                house: book.house.name, motto: book.house.motto, from: book.foundedYear, to: book.year, ended: !!book.ended,
                rulers: book.sections.map(s => `${s.ruler.name}${s.ruler.epithet ? ` ${s.ruler.epithet}` : ''} (${s.from}–${s.live ? 'now' : s.to})`),
            };
            for (const kind of ['foreword', 'epilogue']) {
                const key = `book:${hid}:${kind}`;
                try {
                    if (!P.text(world, key, null)) P.write(world, { kind, key, facts, fallback: null });
                } catch (e) { /* the template stands */ }
            }
        }
        const portraits = opts.portraits === false ? {} : await _portraits(book, game);
        const html = render(book, {
            portraits,
            prose: P ? (key) => P.text(world, key, null) : null,
            scribe: opts.scribe || null,
        });
        return { html, book, filename: filenameFor(book, 'html') };
    },

    /** Build and save the book: { pdf } prints it to PDF instead. Resolves { ok, how }. */
    async exportBook(game, opts = {}) {
        const { html, filename } = await ChronicleBookExport.build(game, opts);
        const desk = typeof window !== 'undefined' ? window.lotrDesktop : null;
        if (opts.pdf) {
            if (desk && typeof desk.saveChroniclePdf === 'function') return desk.saveChroniclePdf(html, filename.replace(/\.html$/, '.pdf'));
            return ChronicleBookExport.printInFrame(html);
        }
        if (desk && typeof desk.saveChronicle === 'function') return desk.saveChronicle(html, filename);
        return ChronicleBookExport.download(html, filename);
    },

    /** A browser download of the file. */
    download(html, filename) {
        if (typeof document === 'undefined' || typeof Blob === 'undefined') return { ok: false, how: 'none' };
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
        return { ok: true, how: 'download' };
    },

    /** The print dialog on the book (the browser's "Save as PDF"), from a hidden frame. */
    printInFrame(html) {
        if (typeof document === 'undefined') return { ok: false, how: 'none' };
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(f);
        const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
        if (!doc) { f.remove(); return { ok: false, how: 'none' }; }
        doc.open();
        doc.write(html);
        doc.close();
        setTimeout(() => {
            try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* no print */ }
            setTimeout(() => f.remove(), 60000);
        }, 400);
        return { ok: true, how: 'print' };
    },
};
