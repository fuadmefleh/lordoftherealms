// ActionMenu — 📚 The Almanac of the World: a searchable encyclopedia over
// everything the game has recorded — people, Houses, places, realms, wars and
// battles, the ages, the great works — each page linked to the pages it names,
// with "see on the map" and "see on the Timeline" where a place or a date is
// known. Logic lives in systems/almanac.js (an index built once a day); this
// panel presents it.
//
// Opener: ActionMenu.showAlmanac(game, opts) — opts { id (an entry's page),
// tab ('index' | a category), query }. Back walks the pages read before.
// Links: Journal → The Almanac (TopBar), the House panel's row.
import { ActionMenu } from './_ref.js';
import { Relationships } from './_imports.js';
import { Almanac } from '../../systems/almanac.js';
import { lede, chips, rowList, card, kv, sectionHead, panelTabs, esc } from './uiKit.js';

const TITLE = '📚 The Almanac of the World';
const MUTED = 'font-size:11px; color:#a99a78;';
const LINK = 'color:#ffe08a; cursor:pointer; border-bottom:1px dotted rgba(255,224,138,0.55);';
const FIELD = 'width:100%; box-sizing:border-box; padding:7px 10px; margin:2px 0 8px; background:rgba(0,0,0,0.3); border:1px solid rgba(245,197,66,0.22); border-radius:6px; color:#ece2c8; font-size:13px;';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _doc = () => (typeof document !== 'undefined' && document && typeof document.getElementById === 'function' ? document : null);

function _view(game) {
    let v = game._almanacView;
    if (!v || v.world !== game.world) v = game._almanacView = { world: game.world, tab: 'index', id: null, query: '', limit: 0, stack: [] };
    return v;
}

function _index(game) {
    return Almanac.index(game.player, game.world, {
        npc: (id) => (Relationships && typeof Relationships.getNPC === 'function' ? Relationships.getNPC(id) : null),
        known: (p) => (Relationships && typeof Relationships.getKnownNPCs === 'function' && p ? Relationships.getKnownNPCs(p) : []),
    });
}

function _open(id) {
    return `data-am-act="almanacOpen" data-am-args="${esc(JSON.stringify([id]))}"`;
}

/** Text with every name the Almanac knows made a link to its page. */
export function linkified(idx, text, selfId = null) {
    return Almanac.mentions(idx, text, selfId).map(p => (p.id ? `<span class="alm-link" style="${LINK}" ${_open(p.id)}>${esc(p.text)}</span>` : esc(p.text))).join('');
}

function _yearSide(year) {
    return year != null ? `<span style="${MUTED}">${esc(year)}</span>` : '';
}

/** An entry as a row of a list: icon, name, one line, the year at the right. */
function _entryRow(e) {
    return { icon: e.icon, name: esc(e.name), desc: esc(e.sub || ''), side: _yearSide(_yearOf(e)), act: 'almanacOpen', args: [e.id] };
}

let _worldForYear = null;
function _yearOf(e) {
    return e.day != null && _worldForYear ? Almanac.year(_worldForYear, e.day) : null;
}

function _resultsHtml(game, idx, v) {
    const C = Almanac.config();
    const cap = C.caps.list + _num(v.limit);
    const cat = v.tab === 'index' ? null : v.tab;
    const q = String(v.query || '').trim();
    if (!cat && !q) return _homeHtml(game, idx);
    const pool = q ? Almanac.search(idx, q, { cat, limit: cap + 1 }) : (idx.byCat[cat] || []).slice(0, cap + 1);
    if (!pool.length) return lede(q ? `Nothing in the Almanac answers to “${esc(q)}”.` : 'Nothing of this kind has been recorded yet.');
    const total = q ? null : (idx.byCat[cat] || []).length;
    let html = rowList(pool.slice(0, cap).map(_entryRow), q ? `${pool.length > cap ? `${cap}+` : pool.length} found` : `${total} recorded`);
    if (pool.length > cap) html += rowList([{ icon: '⋯', name: 'Show more', desc: 'The list is long: more of it', act: 'almanacMore', side: '›' }]);
    return html;
}

/** The front page: what the Almanac holds, the House, the latest of the world. */
function _homeHtml(game, idx) {
    const C = Almanac.config();
    const counts = Almanac.counts(idx);
    let html = lede('Everything the chroniclers, the heralds and the gossips have kept, in one book. Search a name, or open a part.');
    html += rowList(C.cats.map(c => ({ icon: c.icon, name: esc(c.label), side: `<b>${counts[c.id] || 0}</b>`, act: 'almanacTab', args: [c.id], off: !counts[c.id], why: 'None recorded yet' })));
    const mine = ['h:player', game.player && game.player.house && game.player.house.lineage && game.player.house.lineage.currentId ? `p:dyn:${game.player.house.lineage.currentId}` : null]
        .map(id => id && Almanac.get(idx, id)).filter(Boolean);
    if (mine.length) html += rowList(mine.map(_entryRow), 'Your House');
    const latest = [...(idx.byCat.war || []), ...(idx.byCat.age || []), ...(idx.byCat.work || [])]
        .filter(e => e.day != null).sort((a, b) => b.day - a.day).slice(0, 8);
    if (latest.length) html += rowList(latest.map(_entryRow), 'Lately in the world');
    return html;
}

function _listHtml(game, idx, v) {
    const cat = Almanac.config().cats.find(c => c.id === v.tab);
    const ph = cat ? `Search ${cat.label.toLowerCase()}…` : 'Search people, Houses, places, realms, wars…';
    let html = `<input id="almanacSearch" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(ph)}" value="${esc(v.query || '')}" style="${FIELD}" aria-label="Search the Almanac">`;
    html += `<div id="almanacResults">${_resultsHtml(game, idx, v)}</div>`;
    return html;
}

function _pageHtml(game, idx, v) {
    const pg = Almanac.page(idx, v.id);
    if (!pg) return lede('That page is no longer in the Almanac.') + rowList([{ icon: '←', name: 'Back', act: 'almanacBack' }]);
    const e = pg.entry;
    const cat = Almanac.config().cats.find(c => c.id === e.cat);
    let head = `<div style="${MUTED} text-transform:uppercase; letter-spacing:1px;">${esc(cat ? cat.label : '')}</div>`;
    head += `<div style="font-size:13px; line-height:1.45; margin:2px 0 6px;">${linkified(idx, e.sub || '', e.id)}</div>`;
    head += pg.facts.map(f => kv(esc(f[0]), linkified(idx, f[1], e.id))).join('');
    let html = card(head, { icon: e.icon, title: esc(e.name), side: e.day != null ? `<span style="${MUTED}">${esc(Almanac.year(game.world, e.day))}</span>` : '' });

    const nav = [];
    if (v.stack.length) nav.push({ icon: '←', name: 'Back', desc: _backLabel(idx, v), act: 'almanacBack' });
    if (Number.isFinite(e.q) && Number.isFinite(e.r)) nav.push({ icon: '📍', name: 'See on the map', desc: 'Close the Almanac and look there', act: 'almanacMap', args: [e.q, e.r], side: '›' });
    if (e.tlDay != null && game.world && game.world.timeline && game.world.timeline.base) {
        nav.push({ icon: '🗺️', name: 'See on the Timeline', desc: `The realm as it stood in ${Almanac.year(game.world, e.tlDay)}`, act: 'almanacTimeline', args: [e.tlDay, Number.isFinite(e.q) ? e.q : null, Number.isFinite(e.r) ? e.r : null], side: '›' });
    }
    if (e.id === 'h:player') nav.push({ icon: '📖', name: 'The Annals', desc: 'The House told as a book', act: 'showAnnals', side: '›' });
    if (e.id.startsWith('p:dyn:')) nav.push({ icon: '🌳', name: 'On the Family Tree', act: 'showDynastyTree', args: [{ focus: e.id.slice(6) }], side: '›' });
    html += rowList(nav);

    if (pg.lines.length) {
        html += rowList(pg.lines.slice().reverse().map(l => ({ icon: l.icon || '·', name: linkified(idx, l.text, e.id), side: _yearSide(l.year) })), 'The record');
    }
    for (const s of pg.sections) {
        if (Array.isArray(s.facts) && s.facts.length) html += sectionHead(esc(s.title)) + s.facts.map(f => kv(esc(f[0]), esc(f[1]))).join('');
        if (Array.isArray(s.rows) && s.rows.length) html += rowList(s.rows.map(l => ({ icon: l.icon || '·', name: linkified(idx, l.text, e.id), side: _yearSide(l.year) })), esc(s.title));
    }
    const cats = Almanac.config().cats;
    const rel = cats.filter(c => pg.related[c.id] && pg.related[c.id].length);
    if (rel.length) {
        html += sectionHead('See also');
        for (const c of rel) {
            const list = pg.related[c.id];
            html += rowList(list.slice(0, 24).map(_entryRow), `${c.icon} ${esc(c.label)}${list.length > 24 ? ` (${list.length})` : ''}`);
        }
    }
    return html;
}

function _backLabel(idx, v) {
    const prev = v.stack[v.stack.length - 1];
    if (!prev) return '';
    if (prev.id) { const e = Almanac.get(idx, prev.id); return e ? e.name : ''; }
    const c = Almanac.config().cats.find(x => x.id === prev.tab);
    return c ? c.label : 'The index';
}

/** The search box re-bound after each render; focused only when the Almanac has just opened (focus). */
function _bindSearch(game, focus) {
    const d = _doc();
    const input = d && d.getElementById('almanacSearch');
    if (!input || typeof input.addEventListener !== 'function') return;
    let t = null;
    input.addEventListener('input', () => {
        const v = _view(game);
        v.query = input.value || '';
        v.limit = 0;
        if (t && typeof clearTimeout === 'function') clearTimeout(t);
        const run = () => {
            const out = d.getElementById('almanacResults');
            if (out) { _worldForYear = game.world; out.innerHTML = _resultsHtml(game, _index(game), v); }
        };
        t = typeof setTimeout === 'function' ? setTimeout(run, 120) : (run(), null);
    });
    if (focus && typeof input.focus === 'function') { try { input.focus(); const n = String(input.value || '').length; if (input.setSelectionRange) input.setSelectionRange(n, n); } catch (e) { /* (a stub) */ } }
}

Object.assign(ActionMenu, {
    /** Open the Almanac (Journal → The Almanac; the House panel). */
    showAlmanac(game, opts = {}) {
        if (!game || !game.world) return;
        // (the search box takes the keyboard only when the Almanac first opens, not on every redraw)
        const d = _doc();
        const root = d && d.getElementById('almanacRoot');
        const fresh = !root || !root.isConnected;
        const v = _view(game);
        if (opts.tab) { v.tab = opts.tab; v.id = null; }
        if (opts.id) v.id = opts.id;
        if (opts.query != null) v.query = String(opts.query);
        const idx = _index(game);
        _worldForYear = game.world;
        const C = Almanac.config();
        const tabs = [['index', '📚 Index', 'Search everything'], ...C.cats.map(c => [c.id, `${c.icon} ${c.label}`, c.label])];
        const tabRow = panelTabs(game, {
            id: 'almanac', title: TITLE, tabs, active: v.id ? (C.cats.some(c => c.id === (Almanac.get(idx, v.id) || {}).cat) ? Almanac.get(idx, v.id).cat : v.tab) : v.tab,
            go: (key) => ActionMenu.almanacTab(game, key),
            attrsFor: (key) => `data-am-act="almanacTab" data-am-args='${JSON.stringify([key])}'`,
        });
        let html = `<div id="almanacRoot" style="padding:2px 4px;">${tabRow}`;
        if (v.id) html += _pageHtml(game, idx, v);
        else {
            const counts = Almanac.counts(idx);
            if (v.tab === 'index') html += chips(C.cats.filter(c => counts[c.id]).map(c => ({ icon: c.icon, label: c.label, value: counts[c.id] })));
            html += _listHtml(game, idx, v);
        }
        html += '</div>';
        game.ui.showCustomPanel(TITLE, html);
        if (!v.id) _bindSearch(game, fresh);
    },

    /** Open an entry's page (the page read now goes on the back stack). */
    almanacOpen(game, id) {
        const v = _view(game);
        if (v.id === id) return;
        v.stack.push({ id: v.id, tab: v.tab, query: v.query });
        if (v.stack.length > 40) v.stack.shift();
        ActionMenu.showAlmanac(game, { id });
    },

    /** A part of the Almanac (a tab): its list, searchable. */
    almanacTab(game, tab) {
        const v = _view(game);
        if (v.id || v.tab !== tab) v.stack.push({ id: v.id, tab: v.tab, query: v.query });
        v.query = '';
        v.limit = 0;
        ActionMenu.showAlmanac(game, { tab });
    },

    almanacBack(game) {
        const v = _view(game);
        const prev = v.stack.pop();
        if (!prev) { v.id = null; v.tab = 'index'; } else { v.id = prev.id; v.tab = prev.tab || 'index'; v.query = prev.query || ''; }
        ActionMenu.showAlmanac(game, {});
    },

    almanacMore(game) {
        const v = _view(game);
        v.limit = _num(v.limit) + Almanac.config().caps.list;
        ActionMenu.showAlmanac(game, {});
    },

    /** Close the Almanac and look at a place on the map. */
    almanacMap(game, q, r) {
        game.ui.hideCustomPanel();
        if (!game.renderer || !game.camera || typeof game.renderer.getHexPixelPos !== 'function') return;
        const pos = game.renderer.getHexPixelPos(q, r);
        if (!pos || typeof game.camera.centerOn !== 'function') return;
        game.camera.following = false;
        game.camera.centerOn(pos.x, pos.y);
    },

    /** The Timeline of the Realm at the day (ringing the place, when there is one). */
    almanacTimeline(game, day, q = null, r = null) {
        ActionMenu.showTimeline(game, { day, ...(Number.isFinite(q) && Number.isFinite(r) ? { focus: { q, r } } : {}) });
    },
});
