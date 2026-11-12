// ActionMenu — 🗺️ The Timeline of the Realm: the world map as it stood in any
// season since the record began. A year slider with play/pause, borders as
// they were, the player's holdings, the towns standing, markers for the
// battles, sieges, towns taken, crises, crowns and realms risen or fallen
// (hover for the line), a strip of the ages, the player's line and the wars
// along the slider (click a span to go there), and the year's happenings.
// Logic lives in systems/realmTimeline.js; this panel presents it.
//
// Opener: ActionMenu.showTimeline(game, opts) — opts { day (jump to the
// borders as of that day), focus: { q, r } (ring a place) }. Jump-to links
// from the Annals' chapters and ages, the House Chronicle's reigns and the
// Dynasty panel's chronicle lines open it at their day.
import { ActionMenu } from './_ref.js';
import { RealmTimeline } from '../../systems/realmTimeline.js';
import { Seasons } from '../../world/seasons.js';
import { lede, chips, rowList, sectionHead, esc, BTN_PLAIN, BTN_GOLD } from './uiKit.js';

const PLAY_MS = 700;
const KEY_EVERY = 12; // a grid kept every few points, for quick scrubbing
const LANE_W = 76; // px: the strip's label column

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _doc = () => (typeof document !== 'undefined' && document && typeof document.getElementById === 'function' ? document : null);
const _el = (id) => { const d = _doc(); return d ? d.getElementById(id) : null; };

/**
 * A tile's left edge on the canvas: the map is drawn as offset hexes the way
 * the main renderer lays them (core/hex.js: pointy-top, even rows shifted right
 * by half a hex), each hex a px×px cell.
 */
function _hx(q, r, px) {
    return q * px + (r % 2 === 0 ? px / 2 : 0);
}

/** The tile under a canvas point (q wrapped into the map), or null. */
export function tileAtPoint(x, y, px, w, h) {
    const r = Math.floor(y / px);
    if (r < 0 || r >= h) return null;
    const q = Math.floor((x - (r % 2 === 0 ? px / 2 : 0)) / px);
    if (q < 0 || q >= w) return null;
    return { q, r };
}

function _year(world, day) {
    return RealmTimeline.year(world, day);
}

function _when(world, day) {
    return `${Seasons.seasonOf(day)}, year ${_year(world, day)}`;
}

/** The points the slider walks: the record's frames, then today when it is newer. */
function _points(world, st) {
    const pts = RealmTimeline.points(st).map(p => ({ ...p }));
    const now = _num(world && world.day);
    if (!pts.length || now > pts[pts.length - 1].day) pts.push({ day: now, index: 'now' });
    return pts;
}

/** The grid at a point, replayed from the nearest kept grid. */
function _gridFor(view, world, st, p) {
    if (p.index === 'now') {
        if (!view.nowGrid || view.nowDay !== p.day) { view.nowGrid = RealmTimeline.gridNow(world, st); view.nowDay = p.day; }
        return view.nowGrid;
    }
    const keys = view.grids || (view.grids = new Map());
    if (keys.has(p.index)) return keys.get(p.index);
    if (view.lastGrid && view.lastGrid.index === p.index) return view.lastGrid.grid;
    let from = null;
    for (const [i, g] of keys) if (i <= p.index && (!from || i > from.index)) from = { index: i, grid: g };
    // (playing forward: on from the grid just shown)
    if (view.lastGrid && view.lastGrid.index <= p.index && (!from || view.lastGrid.index > from.index)) from = view.lastGrid;
    const grid = RealmTimeline.gridAt(st, p.index, from);
    if (p.index % KEY_EVERY === 0 || keys.size < 4) keys.set(p.index, grid);
    view.lastGrid = { index: p.index, grid };
    return grid;
}

/** The window of days a point shows the deeds of: since the point before (at least a year back). */
function _window(pts, i) {
    const d = pts[i].day;
    const prev = i > 0 ? pts[i - 1].day : d - Seasons.DAYS_PER_YEAR;
    return { from: Math.min(prev, d - Seasons.DAYS_PER_YEAR), to: d, since: prev };
}

function _realmCounts(grid) {
    const counts = new Map();
    for (let i = 0; i < grid.length; i++) if (grid[i]) counts.set(grid[i], (counts.get(grid[i]) || 0) + 1);
    return counts;
}

function _legendHtml(world, st, grid, day) {
    const counts = [..._realmCounts(grid)].sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (!counts.length) return '<div style="color:#9d937c; font-size:11px;">No realm held land.</div>';
    return `<div style="display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11px;">${counts.map(([code, n]) => {
        const r = RealmTimeline.realmAt(st, code, day) || { name: 'A realm', color: '#8a7a5a', ruler: '' };
        return `<span title="${esc(r.ruler ? `Ruled by ${r.ruler}` : '')}"><span style="display:inline-block; width:10px; height:10px; border-radius:2px; vertical-align:-1px; background:${esc(r.color)}; border:1px solid rgba(0,0,0,0.5);"></span> ${esc(r.name)} <span style="color:#9d937c;">${n}</span></span>`;
    }).join('')}</div>`;
}

/** What happened in the shown window: markers, wars begun and ended, towns founded and gone. */
function _happenings(world, st, win) {
    const C = RealmTimeline.config();
    const I = C.icons;
    const out = RealmTimeline.eventsBetween(st, win.since, win.to).map(e => ({ day: e.day, icon: I[e.kind] || '•', text: e.text, q: e.q, r: e.r }));
    for (const w of st.wars) {
        const a = RealmTimeline.realmAt(st, w[0], w[2]), b = RealmTimeline.realmAt(st, w[1], w[2]);
        if (!a || !b) continue;
        if (w[2] > win.since && w[2] <= win.to) out.push({ day: w[2], icon: I.war, text: `${a.name} and ${b.name} went to war.` });
        if (w[3] != null && w[3] > win.since && w[3] <= win.to) {
            const v = w[4] ? RealmTimeline.realmAt(st, w[4], w[3]) : null;
            out.push({ day: w[3], icon: I.peace, text: `The war of ${a.name} and ${b.name} ended${v ? `, won by ${v.name}` : ''}.` });
        }
    }
    for (const t of st.towns) {
        if (t[3] != null && t[3] > win.since && t[3] <= win.to) out.push({ day: t[3], icon: I.founded, text: `${t[2]} was founded.`, q: t[0], r: t[1] });
        if (t[4] != null && t[4] > win.since && t[4] <= win.to) out.push({ day: t[4], icon: I.ruined, text: `${t[2]} was abandoned or fell to ruin.`, q: t[0], r: t[1] });
    }
    return out.sort((a, b) => a.day - b.day);
}

function _happeningsHtml(world, list) {
    if (!list.length) return '<div style="color:#9d937c; font-size:11px; padding:4px 2px;">A quiet season: nothing the chronicler marked.</div>';
    return rowList(list.slice(-40).reverse().map(h => ({
        icon: h.icon, name: esc(h.text), side: `<span style="font-size:10px; color:#a99a78;">${esc(_when(world, h.day))}</span>`,
        attrs: Number.isFinite(h.q) ? `data-tl-focus="${h.q},${h.r}" title="Show where on the map"` : '',
    })));
}

/** The strip of lanes under the slider (spans clickable: data-tl-day). */
function _stripHtml(world, st) {
    const s = RealmTimeline.strip(world, st);
    const span = Math.max(1, s.to - s.from);
    const pct = (d) => Math.max(0, Math.min(100, ((d - s.from) / span) * 100));
    const tones = { bad: 'rgba(192,83,58,0.75)', gold: 'rgba(245,197,66,0.6)', warn: 'rgba(214,140,60,0.55)', cool: 'rgba(110,160,210,0.6)' };
    let html = `<div id="tlStrip" style="position:relative; padding-left:${LANE_W}px; margin:6px 0 2px;">`;
    for (const lane of s.lanes) {
        html += `<div class="tl-lane" style="position:relative; height:14px; margin:3px 0;">`;
        html += `<span style="position:absolute; left:-${LANE_W}px; width:${LANE_W - 6}px; top:0; font-size:10px; color:#a99a78; text-transform:uppercase; letter-spacing:1px; text-align:right;">${esc(lane.label)}</span>`;
        html += '<div style="position:absolute; inset:6px 0 auto 0; height:2px; background:rgba(255,255,255,0.06);"></div>';
        // (overlapping wars stack thin, a row each)
        const rows = [];
        for (const sp of lane.spans) {
            let row = rows.findIndex(end => end <= sp.from);
            if (row < 0) { row = rows.length; rows.push(sp.to); } else rows[row] = sp.to;
            const n = lane.id === 'wars' ? 3 : lane.id === 'ages' ? 2 : 1;
            const hgt = Math.floor(12 / n);
            const top = 1 + (row % n) * hgt;
            const left = pct(sp.from), width = Math.max(0.6, pct(sp.to) - left);
            html += `<div class="tl-span" data-tl-day="${sp.from}" title="${esc(`${sp.icon} ${sp.label} (${_year(world, sp.from)}–${sp.to >= s.to ? 'now' : _year(world, sp.to)})`)}" style="position:absolute; cursor:pointer; left:${left}%; width:${width}%; top:${top}px; height:${Math.max(3, hgt - 1)}px; border-radius:2px; background:${tones[sp.tone] || tones.warn};"></div>`;
        }
        html += '</div>';
    }
    html += `<div id="tlCursor" style="position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:#ffe08a; box-shadow:0 0 4px #ffe08a; pointer-events:none; left:${LANE_W}px;"></div>`;
    html += '</div>';
    html += `<div style="display:flex; justify-content:space-between; padding-left:${LANE_W}px; font-size:10px; color:#9d937c;"><span>Year ${_year(world, s.from)}</span><span>Year ${_year(world, s.to)}</span></div>`;
    return html;
}

/** The terrain under the borders, drawn once per open panel. */
function _terrainLayer(view, world, px) {
    const d = _doc();
    if (view.terrain && view.terrainPx === px) return view.terrain;
    if (!d || typeof d.createElement !== 'function') return null;
    const c = d.createElement('canvas');
    if (!c || typeof c.getContext !== 'function') return null;
    c.width = world.width * px + px / 2;
    c.height = world.height * px;
    const ctx = c.getContext('2d');
    if (!ctx || typeof ctx.fillRect !== 'function') return null;
    for (let r = 0; r < world.height; r++) {
        for (let q = 0; q < world.width; q++) {
            const t = world.tiles[r] && world.tiles[r][q];
            ctx.fillStyle = (t && t.terrain && t.terrain.color) || '#1b2a3a';
            ctx.fillRect(_hx(q, r, px), r * px, px, px);
        }
    }
    view.terrain = c;
    view.terrainPx = px;
    return c;
}

/** Paint the map at the current point. */
function _drawMap(game, view, st, pts, grid, win) {
    const canvas = _el('tlMap');
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.fillRect !== 'function') return;
    const world = game.world;
    const W = st.w, H = st.h, px = view.px;
    const day = pts[view.i].day;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const terrain = _terrainLayer(view, world, px);
    if (terrain) {
        ctx.globalAlpha = 0.75;
        ctx.drawImage(terrain, 0, 0);
        ctx.globalAlpha = 1;
    } else {
        ctx.fillStyle = '#1b2a3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // The realms
    const colours = new Map();
    const colourOf = (code) => {
        if (!colours.has(code)) colours.set(code, (RealmTimeline.realmAt(st, code, day) || {}).color || '#8a7a5a');
        return colours.get(code);
    };
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < grid.length; i++) {
        const c = grid[i];
        if (!c) continue;
        ctx.fillStyle = colourOf(c);
        const r = Math.floor(i / W);
        ctx.fillRect(_hx(i % W, r, px), r * px, px, px);
    }
    ctx.globalAlpha = 1;
    // The borders: a dark line where two hexes' realms differ — the east side,
    // and the bottom in two halves, each against the hex of the next row under it
    ctx.fillStyle = 'rgba(16,10,4,0.9)';
    const lw = Math.max(1, px >> 2), half = px / 2;
    const differs = (c, d) => d !== c && (c || d);
    for (let r = 0; r < H; r++) {
        const even = r % 2 === 0;
        for (let q = 0; q < W; q++) {
            const c = grid[r * W + q];
            const x = _hx(q, r, px);
            if (q + 1 < W && differs(c, grid[r * W + q + 1])) ctx.fillRect(x + px - 1, r * px, lw, px);
            if (r + 1 >= H) continue;
            const below = (qq) => (qq >= 0 && qq < W ? grid[(r + 1) * W + qq] : c);
            // even row (shifted): its left half lies over hex q below, its right half over q+1;
            // odd row: its left half over q−1 (shifted), its right half over q
            const left = even ? below(q) : below(q - 1), right = even ? below(q + 1) : below(q);
            if (differs(c, left)) ctx.fillRect(x, (r + 1) * px - 1, half, lw);
            if (differs(c, right)) ctx.fillRect(x + half, (r + 1) * px - 1, half, lw);
        }
    }
    // The player's holdings
    const hold = pts[view.i].index === 'now' ? _holdNow(game, st) : RealmTimeline.holdingsAt(st, pts[view.i].index);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2;
    for (const i of hold) { const r = Math.floor(i / W); ctx.strokeRect(_hx(i % W, r, px) - 1, r * px - 1, px + 2, px + 2); }
    // The towns standing; new ones ringed green
    const markers = [];
    for (const t of RealmTimeline.townsAt(st, day)) {
        const x = _hx(t.q, t.r, px) + px / 2, y = t.r * px + px / 2;
        const fresh = t.founded != null && t.founded > win.since;
        ctx.fillStyle = fresh ? '#8fe08a' : 'rgba(250,240,215,0.85)';
        ctx.fillRect(x - 1, y - 1, 3, 3);
        markers.push({ x, y, r: 4, text: `${t.name}${t.founded != null ? ` (founded ${_year(world, t.founded)})` : ''}`, town: true });
    }
    // The deeds of the window, faded by age
    const I = RealmTimeline.config().icons;
    const size = Math.max(11, Math.round(px * 2.6));
    ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of RealmTimeline.eventsBetween(st, win.from, win.to)) {
        if (!Number.isFinite(e.q) || !Number.isFinite(e.r)) continue;
        const x = _hx(e.q, e.r, px) + px / 2, y = e.r * px + px / 2;
        ctx.globalAlpha = e.day > win.since ? 1 : 0.45;
        ctx.fillText(I[e.kind] || '•', x, y);
        markers.push({ x, y, r: size * 0.6, text: `${I[e.kind] || ''} ${e.text} — ${_when(world, e.day)}` });
    }
    for (const t of st.towns) {
        if (t[4] == null || t[4] <= win.since || t[4] > win.to) continue;
        const x = _hx(t[0], t[1], px) + px / 2, y = t[1] * px + px / 2;
        ctx.globalAlpha = 0.9;
        ctx.fillText(I.ruined, x, y);
        markers.push({ x, y, r: size * 0.6, text: `${I.ruined} ${t[2]} was abandoned or fell to ruin — ${_when(world, t[4])}` });
    }
    ctx.globalAlpha = 1;
    // A place to ring (a jump-to link, a happening clicked)
    if (view.focus && Number.isFinite(view.focus.q)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(_hx(view.focus.q, view.focus.r, px) + px / 2, view.focus.r * px + px / 2, Math.max(8, px * 3), 0, Math.PI * 2);
        ctx.stroke();
    }
    view.markers = markers;
}

function _holdNow(game, st) {
    const keys = (game.player && game.player.holdings && game.player.holdings.keys) || [];
    const out = [];
    for (const k of keys) {
        const [q, r] = String(k).split(',').map(Number);
        if (Number.isFinite(q) && Number.isFinite(r)) out.push(r * st.w + q);
    }
    return out;
}

/** Repaint everything that follows the slider (no full panel redraw). */
function _update(game) {
    const view = game._timelineView;
    const world = game.world;
    const st = world && world.timeline;
    if (!view || !st || !st.base) return;
    const pts = view.pts;
    view.i = Math.max(0, Math.min(pts.length - 1, view.i));
    const p = pts[view.i];
    const grid = _gridFor(view, world, st, p);
    const win = _window(pts, view.i);
    const year = _el('tlYear');
    if (year) year.innerHTML = `${esc(_when(world, p.day))}${p.index === 'now' ? ' <span style="font-size:11px; color:#8fe08a;">(today)</span>' : ''}`;
    const counts = _realmCounts(grid);
    const wars = RealmTimeline.warsAt(st, p.day).length;
    const towns = RealmTimeline.townsAt(st, p.day).length;
    const box = _el('tlChips');
    if (box) box.innerHTML = chips([['👑', 'Realms', counts.size], ['🔥', 'Wars', wars], ['🏘️', 'Towns', towns]]);
    const slider = _el('tlSlider');
    if (slider && String(slider.value) !== String(view.i)) slider.value = String(view.i);
    const cur = _el('tlCursor');
    if (cur && cur.style) {
        const s = RealmTimeline.strip(world, st);
        const f = Math.max(0, Math.min(1, (p.day - s.from) / Math.max(1, s.to - s.from)));
        cur.style.left = `calc(${LANE_W}px + (100% - ${LANE_W}px) * ${f.toFixed(4)})`;
    }
    const legend = _el('tlLegend');
    if (legend) legend.innerHTML = _legendHtml(world, st, grid, p.day);
    const ev = _el('tlEvents');
    if (ev) ev.innerHTML = _happeningsHtml(world, _happenings(world, st, win));
    _drawMap(game, view, st, pts, grid, win);
}

function _stop(view) {
    if (view && view.timer) { clearInterval(view.timer); view.timer = null; }
    const b = _el('tlPlay');
    if (b && view) b.innerHTML = '▶ Play';
}

function _play(game) {
    const view = game._timelineView;
    if (!view || typeof setInterval !== 'function') return;
    if (view.timer) { _stop(view); return; }
    if (view.i >= view.pts.length - 1) view.i = 0;
    const canvas = _el('tlMap');
    view.timer = setInterval(() => {
        // The panel closed or replaced: stop
        if (!canvas || _el('tlMap') !== canvas || game._timelineView !== view) { _stop(view); return; }
        if (view.i >= view.pts.length - 1) { _stop(view); return; }
        view.i++;
        _update(game);
    }, PLAY_MS);
    const b = _el('tlPlay');
    if (b) b.innerHTML = '⏸ Pause';
}

/** Wire the slider, buttons, strip, list and hover once the panel is painted. */
function _bind(game) {
    const view = game._timelineView;
    const root = _el('tlRoot');
    if (!root || typeof root.addEventListener !== 'function' || root._tlBound) return;
    root._tlBound = true;
    const slider = _el('tlSlider');
    if (slider && typeof slider.addEventListener === 'function') {
        slider.addEventListener('input', () => { _stop(view); view.i = Number(slider.value) || 0; _update(game); });
    }
    root.addEventListener('click', (e) => {
        const t = e.target && typeof e.target.closest === 'function' ? e.target : null;
        if (!t) return;
        const btn = t.closest('[data-tl]');
        if (btn) {
            const a = btn.getAttribute('data-tl');
            if (a === 'play') { _play(game); return; }
            _stop(view);
            if (a === 'prev') view.i--;
            else if (a === 'next') view.i++;
            else if (a === 'first') view.i = 0;
            else if (a === 'last') view.i = view.pts.length - 1;
            _update(game);
            return;
        }
        const span = t.closest('[data-tl-day]');
        if (span) {
            _stop(view);
            const d = Number(span.getAttribute('data-tl-day'));
            view.i = _indexFor(view.pts, game.world.timeline, d);
            _update(game);
            return;
        }
        const f = t.closest('[data-tl-focus]');
        if (f) {
            const [q, r] = String(f.getAttribute('data-tl-focus')).split(',').map(Number);
            view.focus = { q, r };
            _update(game);
        }
    });
    const canvas = _el('tlMap');
    const tip = _el('tlTip');
    if (canvas && tip && typeof canvas.addEventListener === 'function') {
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            // (the panel is CSS-zoomed: work in the canvas's own pixels, place the tip in percent)
            const x = (e.clientX - rect.left) * canvas.width / rect.width;
            const y = (e.clientY - rect.top) * canvas.height / rect.height;
            let best = null, bd = Infinity;
            for (const m of view.markers || []) {
                const d = Math.hypot(m.x - x, m.y - y);
                if (d <= Math.max(m.r, 6) && (d < bd || (best && best.town && !m.town))) { best = m; bd = d; }
            }
            let text = best ? best.text : '';
            if (!text) {
                const st = game.world.timeline;
                const at = tileAtPoint(x, y, view.px, st.w, st.h);
                const grid = at && view.pts[view.i] && _gridFor(view, game.world, st, view.pts[view.i]);
                const code = grid ? grid[at.r * st.w + at.q] : 0;
                const realm = code ? RealmTimeline.realmAt(st, code, view.pts[view.i].day) : null;
                if (realm) text = `${realm.name}${realm.ruler ? ` — ${realm.ruler}` : ''}`;
            }
            if (!text) { tip.style.display = 'none'; return; }
            tip.textContent = text;
            tip.style.display = 'block';
            const fx = x / canvas.width, fy = y / canvas.height;
            tip.style.left = fx > 0.6 ? 'auto' : `${(fx * 100).toFixed(2)}%`;
            tip.style.right = fx > 0.6 ? `${((1 - fx) * 100).toFixed(2)}%` : 'auto';
            tip.style.top = `calc(${(fy * 100).toFixed(2)}% + 12px)`;
        });
        canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    }
}

function _indexFor(pts, st, day) {
    if (!pts.length) return 0;
    const idx = RealmTimeline.pointFor(st, day);
    const i = pts.findIndex(p => p.index === idx);
    // A day after the last frame: today
    if (pts[pts.length - 1].index === 'now' && day > (pts[pts.length - 2] || pts[0]).day) return pts.length - 1;
    return i < 0 ? pts.length - 1 : i;
}

Object.assign(ActionMenu, {
    /**
     * Open the Timeline of the Realm. `opts.day` jumps to the borders as of
     * that day; `opts.focus` { q, r } rings a place. Safe from anywhere with a game.
     */
    showTimeline(game, opts = {}) {
        if (!game || !game.world) return;
        const world = game.world;
        const st = world.timeline;
        const prev = game._timelineView;
        if (prev) _stop(prev);
        if (!st || !st.base) {
            game.ui.showCustomPanel('🗺️ The Timeline of the Realm', `<div style="font-size:12px;">${lede('The chronicler has not yet begun the record of the realm. It opens at the end of today, and grows by a map each season.')}</div>`);
            return;
        }
        const pts = _points(world, st);
        // The after-day refresh calls again with the same opts: keep the place on the slider
        // (or with none, while the timeline is the panel showing)
        const same = !!prev && prev.world === world && (prev.opts === opts || (opts.day == null && !opts.focus && !!_el('tlRoot')));
        // Grids replayed before still hold while no frame was added or merged
        const sig = `${st.frames.length}:${st.frames.length ? st.frames[st.frames.length - 1][0] : st.base.d}`;
        const view = game._timelineView = {
            opts, world, pts, sig,
            i: same ? Math.min(prev.i, pts.length - 1) : pts.length - 1,
            focus: opts.focus || (same ? prev.focus : null),
            grids: same && prev.grids && prev.sig === sig ? prev.grids : new Map(),
            terrain: same ? prev.terrain : null, terrainPx: same ? prev.terrainPx : 0,
            // (even, so a half-hex shift lands on whole pixels)
            px: Math.max(4, Math.min(8, Math.floor(640 / Math.max(1, st.w)))) & ~1,
            markers: [], timer: null,
        };
        if (!same && opts.day != null) view.i = _indexFor(pts, st, _num(opts.day));

        const first = _year(world, st.base.d);
        let html = '<div id="tlRoot" style="font-size:12px;">';
        html += lede(`The realm as the chroniclers kept it, a map each season since the year ${first}${st.start > 2 ? ' (when this record was opened)' : ''}: borders as they stood, your holdings in gold, the battles, sieges, crises and crowns where they happened. Hover the map for what is there; click a span below the slider to go to it.`);
        html += `<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px; margin:4px 0;">
            <div id="tlYear" style="font-family:var(--font-display); font-size:17px; color:var(--gold);">${esc(_when(world, pts[view.i].day))}</div>
            <div id="tlChips"></div></div>`;
        const W = st.w * view.px + view.px / 2, H = st.h * view.px;
        html += `<div id="tlMapBox" style="position:relative; border:1px solid rgba(245,197,66,0.25); border-radius:6px; overflow:hidden; background:#0d131c;">
            <canvas id="tlMap" width="${W}" height="${H}" style="display:block; width:100%; height:auto; image-rendering:pixelated; cursor:crosshair;"></canvas>
            <div id="tlTip" style="position:absolute; display:none; max-width:60%; padding:4px 8px; font-size:11px; line-height:1.35; color:#f2e6c8; background:rgba(16,12,8,0.92); border:1px solid rgba(245,197,66,0.35); border-radius:5px; pointer-events:none; z-index:2;"></div>
        </div>`;
        html += `<div style="display:flex; align-items:center; gap:4px; margin-top:6px;">
            <button id="tlPlay" data-tl="play" type="button" style="${BTN_GOLD} margin:0;">▶ Play</button>
            <button data-tl="first" type="button" style="${BTN_PLAIN} margin:0;" title="The first year of the record">⏮</button>
            <button data-tl="prev" type="button" style="${BTN_PLAIN} margin:0;" title="A season back">‹</button>
            <input id="tlSlider" type="range" min="0" max="${pts.length - 1}" step="1" value="${view.i}" style="flex:1; accent-color:#f5c542;" aria-label="Year">
            <button data-tl="next" type="button" style="${BTN_PLAIN} margin:0;" title="A season on">›</button>
            <button data-tl="last" type="button" style="${BTN_PLAIN} margin:0;" title="Today">⏭</button>
        </div>`;
        html += _stripHtml(world, st);
        html += sectionHead('The realms');
        html += '<div id="tlLegend"></div>';
        html += sectionHead('In these seasons');
        html += '<div id="tlEvents" style="max-height:220px; overflow-y:auto;"></div>';
        html += rowList([{ icon: '📖', name: 'The Annals', desc: 'The House\'s story as a book', act: 'showAnnals' }]);
        html += '</div>';
        game.ui.showCustomPanel('🗺️ The Timeline of the Realm', html);
        _update(game);
        _bind(game);
    },
});

/** For tests: the view's pieces as HTML, without a document. */
export const TimelineView = {
    points: _points,
    window: _window,
    happenings: _happenings,
    happeningsHtml: _happeningsHtml,
    stripHtml: _stripHtml,
    legendHtml: _legendHtml,
};
