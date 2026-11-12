// ActionMenu — 🌳 the Family Tree and 🗝️ the Heirlooms of the House.
//
// The tree: every generation on a canvas you can drag and zoom (wheel, or the
// ＋/－ buttons), each person a card with a portrait (the LPC bust where one
// exists), name and epithet, life dates, the first title and the heirlooms
// in hand. Gold frame: rulers (the living ruler brightest); green: the line of
// succession, numbered; grey with a cross: the dead; a dashed frame: married
// in, with the House and realm they came from; "R": a reign under a regent.
// Click a person for their life: the House Chronicle lines that name them,
// a ruler's Annals chapter and Deeds counters, the heirlooms they bore.
//
// The heirlooms: what the House holds and where the lost ones lie; make one
// from a masterwork or a treasure in the packs; give, take back, pawn,
// redeem, send as dowry, and the recovery quest (buy, take, ask, search).
//
// Logic: systems/dynastyTree.js (DynastyTree.build — pure, also read by the
// chronicle book) and systems/heirlooms.js; these panels present them.
import { ActionMenu } from './_ref.js';
import { Relationships } from './_imports.js';
import { DynastyTree } from '../../systems/dynastyTree.js';
import { Heirlooms } from '../../systems/heirlooms.js';
import { Annals } from '../../systems/annals.js';
import { NpcPortrait } from '../npcPortrait.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { appearancePresetId, registerAppearance, gearKit } from '../playerAppearance.js';
import { lede, chips, sectionHead, card, actRow, rowList, price, esc, BTN_PLAIN } from './uiKit.js';

/** Card size and spacing on the tree, in canvas pixels at zoom 1. */
export const TREE_GEOM = { colW: 176, rowH: 132, cardW: 158, cardH: 78, pad: 30, portrait: 44 };

const COLORS = {
    bg: '#15110b', line: 'rgba(201,178,122,0.55)', spouse: 'rgba(255,154,213,0.55)',
    card: 'rgba(40,32,22,0.96)', cardDead: 'rgba(30,27,24,0.92)', text: '#ece2c8', dim: '#9d937c', dead: '#7d766a',
    ruler: '#f5c542', current: '#ffe08a', heir: '#7fd98a', living: 'rgba(236,226,200,0.45)', deadEdge: 'rgba(125,118,106,0.5)', sel: '#7fc7ff',
};

const MUTED = 'color:#9d937c; font-size:11px;';
const _npc = id => Relationships.getNPC(id);

/** Where a tree node's card sits (its top-left), in tree pixels. */
export function nodeRect(tree, id) {
    const p = tree && tree.layout && tree.layout[id];
    if (!p) return null;
    const G = TREE_GEOM;
    return { x: G.pad + p.x * G.colW - G.cardW / 2, y: G.pad + p.y * G.rowH, w: G.cardW, h: G.cardH };
}

/** The node under a point in tree pixels, or null. */
export function hitNode(tree, x, y) {
    for (const n of (tree && tree.nodes) || []) {
        const r = nodeRect(tree, n.id);
        if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return n;
    }
    return null;
}

/** The tree's full size in tree pixels. */
export function treeSize(tree) {
    const G = TREE_GEOM;
    return { w: G.pad * 2 + Math.max(1, tree.width || 1) * G.colW, h: G.pad * 2 + Math.max(1, tree.height || 1) * G.rowH };
}

function _trim(ctx, text, max) {
    let t = String(text || '');
    if (!ctx.measureText) return t;
    while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…';
    return t;
}

function _presetFor(game, n) {
    try {
        if (!InnerMapCharacters.isReady || !InnerMapCharacters.isReady()) return null;
        if (n.current) return NpcPortrait.playerPreset(game.player);
        if (n.portrait && n.portrait.npcId != null) {
            const npc = _npc(n.portrait.npcId);
            if (npc) {
                if (!npc.preset) npc.preset = InnerMapCharacters.getPresetForNPC(npc.type || 'noble', npc.id || 0, npc.gender);
                if (npc.preset && InnerMapCharacters.getComposited(npc.preset)) return npc.preset;
            }
        }
        if (n.portrait && n.portrait.appearance) {
            const id = appearancePresetId(n.portrait.appearance);
            if (InnerMapCharacters.getComposited(id)) return id;
        }
        let h = 0;
        for (const c of String(n.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return InnerMapCharacters.getPresetForNPC('noble', h % 997, n.gender);
    } catch (e) {
        return null;
    }
}

/**
 * Draw the tree into a 2D context. view = { scale, ox, oy, selected } (ox/oy:
 * the canvas pixel where tree (0,0) lands). opts.portrait(ctx, node, x, y, size)
 * draws a bust and returns true, else the card shows a glyph.
 */
export function drawTree(ctx, tree, view, opts = {}) {
    const G = TREE_GEOM;
    const W = (ctx.canvas && ctx.canvas.width) || 800;
    const H = (ctx.canvas && ctx.canvas.height) || 500;
    ctx.save();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(view.ox || 0, view.oy || 0);
    ctx.scale(view.scale || 1, view.scale || 1);
    // Generation bands
    ctx.font = '600 11px Georgia, serif';
    for (let y = 0; y < (tree.height || 0); y++) {
        ctx.fillStyle = y % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(245,197,66,0.025)';
        ctx.fillRect(0, G.pad + y * G.rowH - 12, treeSize(tree).w, G.rowH);
    }

    // Spouse lines
    ctx.lineWidth = 2;
    for (const e of tree.edges) {
        if (e.kind !== 'spouse') continue;
        const a = nodeRect(tree, e.from), b = nodeRect(tree, e.to);
        if (!a || !b) continue;
        ctx.strokeStyle = COLORS.spouse;
        ctx.setLineDash && ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        ctx.moveTo(l.x + l.w, l.y + l.h / 2);
        ctx.lineTo(r.x, r.y + r.h / 2);
        ctx.stroke();
        ctx.setLineDash && ctx.setLineDash([]);
    }
    // Parent → child elbows, from the couple's midpoint when both parents are drawn
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1.5;
    for (const n of tree.nodes) {
        const c = nodeRect(tree, n.id);
        if (!c || !n.parents.length) continue;
        const ps = n.parents.map(id => nodeRect(tree, id)).filter(Boolean);
        if (!ps.length) continue;
        const sameRow = ps.filter(p => Math.abs(p.y - ps[0].y) < 1);
        const px = sameRow.reduce((s, p) => s + p.x + p.w / 2, 0) / sameRow.length;
        const py = sameRow.length > 1 ? ps[0].y + ps[0].h / 2 : ps[0].y + ps[0].h;
        const midY = c.y - 18;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, midY);
        ctx.lineTo(c.x + c.w / 2, midY);
        ctx.lineTo(c.x + c.w / 2, c.y);
        ctx.stroke();
    }

    // Cards
    for (const n of tree.nodes) {
        const r = nodeRect(tree, n.id);
        if (!r) continue;
        const edge = n.id === view.selected ? COLORS.sel
            : n.current ? COLORS.current : n.ruler ? COLORS.ruler : n.successionRank ? COLORS.heir : n.alive ? COLORS.living : COLORS.deadEdge;
        ctx.fillStyle = n.alive ? COLORS.card : COLORS.cardDead;
        ctx.strokeStyle = edge;
        ctx.lineWidth = n.current || n.id === view.selected ? 3 : n.ruler ? 2 : 1.2;
        if (n.kind === 'spouse' || n.kind === 'parent') ctx.setLineDash && ctx.setLineDash([5, 3]);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 7);
        else ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash && ctx.setLineDash([]);

        // Portrait
        const ps = G.portrait;
        const px = r.x + 6, py = r.y + 6;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px, py, ps, ps);
        const drawn = typeof opts.portrait === 'function' && opts.portrait(ctx, n, px, py, ps);
        if (!drawn) {
            ctx.fillStyle = n.alive ? COLORS.text : COLORS.dead;
            ctx.font = '22px serif';
            ctx.textAlign = 'center';
            ctx.fillText(n.ruler ? '👑' : n.gender === 'female' ? '👩' : n.gender === 'male' ? '👨' : '🧑', px + ps / 2, py + ps / 2 + 8);
            ctx.textAlign = 'left';
        }
        if (!n.alive) {
            ctx.fillStyle = 'rgba(20,18,16,0.45)';
            ctx.fillRect(px, py, ps, ps);
        }

        // Text
        const tx = px + ps + 7;
        const tw = r.x + r.w - tx - 5;
        ctx.fillStyle = n.alive ? (n.ruler ? COLORS.current : COLORS.text) : COLORS.dead;
        ctx.font = '600 12px Georgia, serif';
        ctx.fillText(_trim(ctx, `${n.alive ? '' : '† '}${n.first || n.name}`, tw), tx, r.y + 18);
        ctx.font = 'italic 10px Georgia, serif';
        ctx.fillStyle = COLORS.dim;
        const sub = n.epithet || (n.origin && n.origin.house ? `of ${n.origin.house}` : n.origin && n.origin.kingdom ? `of ${n.origin.kingdom}` : n.branch || '');
        if (sub) ctx.fillText(_trim(ctx, sub, tw), tx, r.y + 31);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = n.alive ? COLORS.text : COLORS.dead;
        ctx.fillText(_trim(ctx, n.life || '', tw), tx, r.y + 44);
        const third = !n.alive && n.cause ? n.cause : (n.titles[0] || (n.reign ? (n.alive && n.reign.to == null ? 'Reigning' : 'Ruled') : ''));
        if (third) {
            ctx.fillStyle = COLORS.dim;
            ctx.fillText(_trim(ctx, third, tw), tx, r.y + 57);
        }
        // Heirlooms in hand, the regency, the place in the line
        const marks = n.heirlooms.map(h => h.icon).join('');
        if (marks) {
            ctx.font = '12px serif';
            ctx.fillText(_trim(ctx, marks, r.w - 12), r.x + 6, r.y + r.h - 6);
        }
        ctx.font = '700 10px sans-serif';
        if (n.successionRank) {
            ctx.fillStyle = COLORS.heir;
            ctx.textAlign = 'right';
            ctx.fillText(`#${n.successionRank}`, r.x + r.w - 6, r.y + r.h - 6);
            ctx.textAlign = 'left';
        }
        if (n.regent) {
            ctx.fillStyle = '#e8a75a';
            ctx.textAlign = 'right';
            ctx.fillText('R', r.x + r.w - 6, r.y + 14);
            ctx.textAlign = 'left';
        }
        if (n.current) {
            ctx.fillStyle = COLORS.current;
            ctx.textAlign = 'right';
            ctx.fillText('★', r.x + r.w - (n.regent ? 16 : 6), r.y + 14);
            ctx.textAlign = 'left';
        }
    }
    ctx.restore();
}

// ── Panel state (one tree view at a time) ───────────────────────────────
let _tv = null;

function _personHtml(game, tree, id) {
    const s = id ? DynastyTree.lifeSummary(game.player, game.world, id, { tree }) : null;
    if (!s) return lede('Click a person on the tree for their life.');
    const n = tree.nodes.find(x => x.id === id);
    const tags = [];
    if (n.current) tags.push({ icon: '★', label: 'Head of the House', cls: 'gold' });
    else if (n.ruler) tags.push({ icon: '👑', label: 'Ruled', value: n.reign ? `${n.reign.fromYear}–${n.reign.toYear != null ? n.reign.toYear : ''}` : '' });
    if (n.successionRank) tags.push({ icon: '⚜️', label: 'In line', value: `#${n.successionRank}`, cls: n.successionRank === 1 ? 'gold' : '' });
    if (n.regent) tags.push({ icon: '🛡️', label: 'Regent', value: esc(n.regent.name) });
    tags.push(n.alive ? { icon: '❤️', label: 'Living', value: n.age != null ? `aged ${n.age}` : '' } : { icon: '✝', label: 'Died', value: n.diedYear != null ? String(n.diedYear) : '' });
    let body = chips(tags);
    const facts = [];
    if (n.titles.length) facts.push(`<b>Titles:</b> ${n.titles.map(esc).join(', ')}`);
    if (n.traits.length) facts.push(`<b>Traits:</b> ${n.traits.map(esc).join(', ')}`);
    if (n.origin && (n.origin.house || n.origin.kingdom || n.origin.town)) {
        facts.push(`<b>Came from:</b> ${[n.origin.house ? `the House of ${esc(n.origin.house)}` : '', n.origin.kingdom ? esc(n.origin.kingdom) : '', n.origin.town ? esc(n.origin.town) : ''].filter(Boolean).join(', ')}${n.origin.royal ? ' (royal blood)' : n.origin.noble ? ' (noble)' : ''}`);
    }
    if (n.branch) facts.push(`<b>Branch:</b> ${esc(n.branch)}`);
    if (!n.alive && n.cause) facts.push(`<b>Cause of death:</b> ${esc(n.cause)}`);
    if (facts.length) body += `<div style="font-size:12px; line-height:1.6; margin:4px 0;">${facts.join('<br>')}</div>`;
    let html = card(body, { icon: n.ruler ? '👑' : n.alive ? '🧬' : '🕯️', title: `${esc(n.name)}${n.epithet ? ` <i style="font-weight:400;">${esc(n.epithet)}</i>` : ''}`, side: esc(n.life), tone: n.current ? 'gold' : '' });

    // A ruler's chapter of the Annals
    if (s.reignKey) {
        try {
            const book = Annals.compose(game.player, game.world, { spouseName: (() => { const sp = game.player.spouse != null ? _npc(game.player.spouse) : null; return sp ? sp.firstName : null; })() });
            const ch = book.chapters.find(c => c.id === `g${s.reignKey.generation}_${s.reignKey.startDay}`) || book.chapters.find(c => c.generation === s.reignKey.generation);
            if (ch) {
                const paras = (ch.paragraphs || []).slice(0, 2).map(p => `<p style="margin:0 0 6px; font-family:Georgia, serif; font-size:12.5px; line-height:1.55; color:#e8dcc0;">${esc(p.text)}</p>`).join('');
                html += sectionHead('From the Annals') + paras + rowList([{ icon: '📖', name: esc(ch.title), desc: 'Read the whole chapter', act: 'showAnnals', args: [{ chapter: ch.id }], side: '›' }]);
            }
        } catch (e) { /* the Annals are optional here */ }
    }
    if (s.deeds.length) html += sectionHead('Deeds & Records') + chips(s.deeds.map(d => ({ label: esc(d.label), value: d.value.toLocaleString('en-US') })));
    if (s.lines.length) {
        html += rowList(s.lines.map(l => ({ icon: '·', name: esc(l.text), side: l.year != null ? `<span style="${MUTED}">${l.year}</span>` : '' })), 'Life');
    }
    if (s.heirlooms.length) {
        html += rowList(s.heirlooms.map(h => ({
            icon: h.icon, name: esc(h.name), desc: `${h.holds ? 'In hand' : 'Bore it'} · ${esc(h.tier)}${h.bonus ? ` · ${esc(h.bonus)}` : ''}`,
            act: 'showHeirloom', args: [h.id], side: '›',
        })), 'Heirlooms');
    }
    // Kin to step to
    const kin = [...n.parents, ...n.spouses, ...tree.nodes.filter(x => x.parents.includes(n.id)).map(x => x.id)]
        .map(k => tree.nodes.find(x => x.id === k)).filter(Boolean);
    if (kin.length) html += rowList(kin.map(k => ({ icon: k.alive ? '🧬' : '🕯️', name: esc(k.name), desc: esc(k.life), act: 'dynastyTreeSelect', args: [k.id], side: '›' })), 'Kin');
    return html;
}

Object.assign(ActionMenu, {
    /**
     * 🌳 The Family Tree. opts { focus (a person id) }.
     */
    showDynastyTree(game, opts = {}) {
        const player = game.player;
        if (!player || !player.house) {
            game.ui.showCustomPanel('🌳 Family Tree', lede('There is no House yet to draw.'));
            return;
        }
        DynastyTree.sync(player, game.world, { npc: _npc });
        const tree = DynastyTree.build(player, game.world, { npc: _npc });
        const selected = opts.focus && tree.nodes.some(n => n.id === opts.focus) ? opts.focus : tree.current;
        const living = tree.nodes.filter(n => n.alive).length;
        const items = Heirlooms.list(player);
        let html = lede(`${esc(tree.house.name)}${tree.house.motto ? ` — <i>&ldquo;${esc(tree.house.motto)}&rdquo;</i>` : ''}. Drag to move, scroll or use ＋/－ to zoom, click a person for their life.`);
        html += chips([
            { icon: '🌳', label: 'Generations', value: tree.generations },
            { icon: '👑', label: 'Rulers', value: tree.rulers.length, cls: 'gold' },
            { icon: '❤️', label: 'Living', value: living },
            { icon: '🕯️', label: 'Dead', value: tree.nodes.length - living },
            { icon: '⚜️', label: 'In line', value: tree.succession.length },
            items.length ? { icon: '🗝️', label: 'Heirlooms', value: items.length } : null,
        ]);
        html += `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:4px 0;">
            <button type="button" id="dtZoomIn" style="${BTN_PLAIN}">＋</button>
            <button type="button" id="dtZoomOut" style="${BTN_PLAIN}">－</button>
            <button type="button" id="dtFit" style="${BTN_PLAIN}">Fit</button>
            <button type="button" data-am-act="showHeirlooms" style="${BTN_PLAIN}">🗝️ Heirlooms</button>
            <span style="${MUTED}"><span style="color:${COLORS.current};">■</span> ruler · <span style="color:${COLORS.heir};">■</span> line of succession (#) · <span style="color:${COLORS.dead};">†</span> dead · dashed: wed in · R: regency</span>
        </div>`;
        html += `<canvas id="dtCanvas" width="900" height="460" style="width:100%; height:calc(52vh / var(--ui-zoom, 1)); min-height:260px; display:block; border:1px solid rgba(245,197,66,0.18); border-radius:8px; cursor:grab; touch-action:none;"></canvas>`;
        html += `<div id="dtInfo" style="margin-top:8px;">${_personHtml(game, tree, selected)}</div>`;
        game.ui.showCustomPanel('🌳 Family Tree', html);
        _tv = { game, tree, scale: 1, ox: 0, oy: 0, selected, canvas: null };
        ActionMenu._bindDynastyTree(game);
        // The busts need the character sprites (loaded on a town map): fetch them, then redraw
        if (!InnerMapCharacters.isReady || !InnerMapCharacters.isReady() || (player.appearance && !InnerMapCharacters.getComposited(NpcPortrait.playerPreset(player)))) {
            const view = _tv;
            Promise.resolve(NpcPortrait.ensureLoaded())
                .then(() => (player.appearance ? registerAppearance(player.appearance, gearKit(player)) : null))
                .then(() => { if (_tv === view) ActionMenu._drawDynastyTree(); })
                .catch(() => { /* the crowns stand in */ });
        }
    },

    /** Select a person on the open tree (or open the tree on them). */
    dynastyTreeSelect(game, id) {
        const info = typeof document !== 'undefined' && document.getElementById ? document.getElementById('dtInfo') : null;
        if (!_tv || !info || _tv.game !== game) return ActionMenu.showDynastyTree(game, { focus: id });
        _tv.selected = id;
        info.innerHTML = _personHtml(game, _tv.tree, id);
        ActionMenu._centerOn(id);
        ActionMenu._drawDynastyTree();
    },

    _drawDynastyTree() {
        if (!_tv || !_tv.canvas || !_tv.canvas.isConnected) return;
        const ctx = _tv.canvas.getContext('2d');
        if (!ctx) return;
        drawTree(ctx, _tv.tree, _tv, {
            portrait: (c, n, x, y, size) => {
                const preset = _presetFor(_tv.game, n);
                return preset ? NpcPortrait.drawBust(c, preset, 0, x, y, size) : false;
            },
        });
    },

    _centerOn(id) {
        if (!_tv || !_tv.canvas) return;
        const r = nodeRect(_tv.tree, id);
        if (!r) return;
        _tv.ox = _tv.canvas.width / 2 - (r.x + r.w / 2) * _tv.scale;
        _tv.oy = _tv.canvas.height / 3 - (r.y + r.h / 2) * _tv.scale;
    },

    _bindDynastyTree(game) {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const canvas = document.getElementById('dtCanvas');
        if (!canvas || !canvas.getContext || !canvas.addEventListener) return;
        _tv.canvas = canvas;
        // Real pixels for the drawn size (the panel is CSS-zoomed: ui/uiScale.js)
        const rect0 = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        if (rect0 && rect0.width > 50) {
            canvas.width = Math.round(rect0.width);
            canvas.height = Math.round(rect0.height);
        }
        const size = treeSize(_tv.tree);
        const fit = () => {
            const s = Math.min(canvas.width / size.w, canvas.height / size.h, 1.2);
            _tv.scale = Math.max(0.25, s);
            _tv.ox = (canvas.width - size.w * _tv.scale) / 2;
            _tv.oy = Math.max(4, (canvas.height - size.h * _tv.scale) / 2);
        };
        fit();
        if (_tv.tree.nodes.length > 12) {
            _tv.scale = Math.max(_tv.scale, 0.7);
            ActionMenu._centerOn(_tv.selected);
        }
        const toCanvas = (e) => {
            const r = canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
        };
        const zoomAt = (f, cx, cy) => {
            const ns = Math.max(0.2, Math.min(2.5, _tv.scale * f));
            _tv.ox = cx - (cx - _tv.ox) * (ns / _tv.scale);
            _tv.oy = cy - (cy - _tv.oy) * (ns / _tv.scale);
            _tv.scale = ns;
            ActionMenu._drawDynastyTree();
        };
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const p = toCanvas(e);
            zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
        }, { passive: false });
        let drag = null;
        canvas.addEventListener('pointerdown', (e) => {
            const p = toCanvas(e);
            drag = { x: p.x, y: p.y, ox: _tv.ox, oy: _tv.oy, moved: 0 };
            canvas.style.cursor = 'grabbing';
            if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const p = toCanvas(e);
            drag.moved = Math.max(drag.moved, Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y));
            _tv.ox = drag.ox + (p.x - drag.x);
            _tv.oy = drag.oy + (p.y - drag.y);
            ActionMenu._drawDynastyTree();
        });
        const up = (e) => {
            if (!drag) return;
            const was = drag;
            drag = null;
            canvas.style.cursor = 'grab';
            if (was.moved > 5) return;
            const p = toCanvas(e);
            const n = hitNode(_tv.tree, (p.x - _tv.ox) / _tv.scale, (p.y - _tv.oy) / _tv.scale);
            if (n) {
                _tv.selected = n.id;
                const info = document.getElementById('dtInfo');
                if (info) info.innerHTML = _personHtml(game, _tv.tree, n.id);
                ActionMenu._drawDynastyTree();
            }
        };
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', () => { drag = null; });
        const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
        btn('dtZoomIn', () => zoomAt(1.2, canvas.width / 2, canvas.height / 2));
        btn('dtZoomOut', () => zoomAt(1 / 1.2, canvas.width / 2, canvas.height / 2));
        btn('dtFit', () => { fit(); ActionMenu._drawDynastyTree(); });
        ActionMenu._drawDynastyTree();
        NpcPortrait.ensureLoaded().then(() => ActionMenu._drawDynastyTree());
    },

    // ── 🗝️ Heirlooms ───────────────────────────────

    _heirloomRow(h) {
        const where = {
            held: ['In hand', 'good'], child: ['With a child', ''], pawned: ['In pawn', 'warn'], stolen: ['Stolen', 'bad'],
            lost: ['Lost', 'bad'], sold: ['Sold away', 'bad'], dowry: ['Given in dowry', ''],
        }[h.status] || [h.status, ''];
        const k = Heirlooms.kind(h.kind);
        const bonus = Heirlooms.describeBonus(h);
        return {
            icon: h.icon, name: esc(h.name),
            desc: `${esc(k.label)} · ${esc(Heirlooms.tier(h).label)} (legend ${Math.round(Heirlooms.legend(h))})${bonus ? ` · ${esc(bonus)}` : ''}`,
            note: h.trail ? `Lies in ${esc(h.trail.place)}${h.trail.holder ? `, with ${esc(h.trail.holder)}` : ''}` : (h.pawn ? `Pledged in ${esc(h.pawn.place)} until day ${h.pawn.due}` : ''),
            act: 'showHeirloom', args: [h.id], side: where[0], tone: where[1],
        };
    },

    /** 🗝️ The House's heirlooms, the lost ones sought, and what in the packs could become one. */
    showHeirlooms(game) {
        const player = game.player;
        if (!player || !player.house) {
            game.ui.showCustomPanel('🗝️ Heirlooms', lede('Only a House keeps heirlooms.'));
            return;
        }
        const items = Heirlooms.list(player);
        let html = lede('Named things that carry the House\'s story. Each deed done with one in hand adds to its legend, and its legend to what it gives the one who holds it. They pass to the heir; they can be lost.');
        const held = items.filter(h => h.status === 'held');
        html += chips([
            { icon: '🗝️', label: 'Heirlooms', value: items.length },
            { icon: '✋', label: 'In hand', value: held.length, cls: 'gold' },
            { icon: '⚔️', label: 'Battle', value: `+${Math.round(Heirlooms.bonus(player, 'battlePower') * 1000) / 10}%` },
            { icon: '🤝', label: 'Negotiation', value: `+${Math.round(Heirlooms.bonus(player, 'negotiation') * 1000) / 10}%` },
        ]);
        const kept = items.filter(h => !Heirlooms.quests(player).includes(h));
        html += kept.length ? rowList(kept.map(h => ActionMenu._heirloomRow(h)), 'The House holds') : lede('The House has no heirlooms yet. Great deeds forge them; a masterwork or a treasure can be made one; the deep places hide them.');
        const sought = Heirlooms.quests(player);
        if (sought.length) html += rowList(sought.map(h => ActionMenu._heirloomRow(h)), 'Lost — to be recovered');
        const el = Heirlooms.eligible(player);
        if (el.length) {
            html += rowList(el.map(e => ({
                icon: Heirlooms.kind(e.kind).icon, name: `Make an heirloom of your ${esc(String(e.itemId).replace(/_/g, ' '))}`,
                desc: e.how === 'masterwork' ? 'A masterwork of your own hand: it becomes a named heirloom' : 'A treasure carried home: it becomes a named heirloom',
                act: 'heirloomForge', args: [e.itemId], side: '›',
            })), 'From the packs');
        }
        html += rowList([{ icon: '🌳', name: 'Family Tree', desc: 'Who bore them, generation by generation', act: 'showDynastyTree', side: '›' }]);
        game.ui.showCustomPanel('🗝️ Heirlooms', html);
    },

    /** One heirloom: its story, who bore it, and what can be done with it. */
    showHeirloom(game, id) {
        const player = game.player;
        const h = Heirlooms.get(player, id);
        if (!h) return ActionMenu.showHeirlooms(game);
        const k = Heirlooms.kind(h.kind);
        const bonus = Heirlooms.describeBonus(h);
        let html = card(
            `${chips([{ label: esc(k.label) }, { label: 'Legend', value: `${Math.round(Heirlooms.legend(h))} · ${esc(Heirlooms.tier(h).label)}`, cls: 'gold' }, bonus ? { label: esc(bonus) } : null])}`
            + (h.status === 'held' ? '' : `<div style="${MUTED}">${h.status === 'child' ? 'Held by a child of the House: it gives nothing until it is back in the ruler\'s hand.' : 'Out of the House\'s hands: it gives nothing.'}</div>`),
            { icon: h.icon, title: esc(h.name), side: esc(h.status) });
        html += rowList((h.history || []).map(l => ({ icon: '·', name: esc(l.text), side: `<span style="${MUTED}">${DynastyTree.year(game.world, l.day)}</span>` })), 'Its story');
        if ((h.bearers || []).length) {
            html += rowList(h.bearers.map(b => ({
                icon: '✋', name: esc(b.name), desc: `${DynastyTree.year(game.world, b.from)}–${b.to != null ? DynastyTree.year(game.world, b.to) : 'now'}`,
                act: 'showDynastyTree', args: [{ focus: b.id }], side: '›',
            })), 'Borne by');
        }
        const rows = [];
        const act = (verb, arg = null) => ({ act: 'heirloomAct', args: arg == null ? [id, verb] : [id, verb, arg] });
        if (h.status === 'held') {
            for (const c of (player.children || []).filter(x => x && x.isAlive !== false && !x.isSibling)) {
                rows.push({ icon: '🎁', name: `Give it to ${esc(c.firstName)}`, desc: 'It leaves your hand: a gift the child keeps until you take it back', ...act('give', c.id) });
            }
            const t = game.world && game.world.getTile ? game.world.getTile(player.q, player.r) : null;
            const inTown = !!(t && t.settlement);
            rows.push({ icon: '⚖️', name: 'Pawn it', desc: `The moneylenders lend on it; redeem it within ${Heirlooms.config().pawn.termDays} days or it is sold`, side: price(Heirlooms.pawnValue(h)), off: !inTown, why: 'There are moneylenders only in a town', ...act('pawn') });
        }
        if (h.status === 'child') rows.push({ icon: '↩', name: 'Take it back', desc: 'Back into the ruler\'s hand', ...act('takeBack') });
        if (h.status === 'held' || h.status === 'child') {
            for (const c of Heirlooms.dowryChildren(player)) {
                rows.push({ icon: '💐', name: `Send it with ${esc(c.firstName)} as dowry`, desc: `Into ${esc(c.upbringing.spouse.kingdomName || 'their realm')}: standing and Prestige, and it leaves the House`, ...act('dowry', c.id), tone: 'warn' });
            }
        }
        if (h.status === 'pawned' && h.pawn) {
            const here = Heirlooms.isHere(player, game.world, h);
            rows.push({ icon: '🔓', name: 'Redeem it', desc: `From the moneylenders of ${esc(h.pawn.place)}`, side: price(h.pawn.redeem, (player.gold || 0) >= h.pawn.redeem), off: !here, why: `The moneylenders of ${esc(h.pawn.place)} hold it: go there`, ...act('redeem') });
        }
        const o = Heirlooms.recoverOptions(player, game.world, id);
        if (o) {
            const away = `It lies in ${esc(o.place)}: go there`;
            if (o.buy != null) rows.push({ icon: '💰', name: 'Buy it back', desc: `From ${esc(o.holder || 'its keeper')}`, side: price(o.buy, (player.gold || 0) >= o.buy), off: !o.here, why: away, ...act('buy') });
            if (o.take != null) rows.push({ icon: '🗡️', name: 'Take it back', desc: `By stealth or force: about ${Math.round(o.take * 100)}% to get away with it; caught, you are hurt`, off: !o.here, why: away, ...act('take'), tone: 'warn' });
            if (o.ask) rows.push({ icon: '🤝', name: 'Ask for it back', desc: `The court gives it back to a House it honours (standing ${o.ask.rep}/${o.ask.need})`, off: !o.here, why: away, ...act('ask') });
            if (o.search != null) rows.push({ icon: '🔦', name: 'Search the ground', desc: `Once a day: about ${Math.round(o.search * 100)}% to find it`, off: !o.here, why: away, ...act('search') });
        }
        if (rows.length) html += rowList(rows, 'What to do');
        html += rowList([{ icon: '←', name: 'All heirlooms', act: 'showHeirlooms' }]);
        game.ui.showCustomPanel('🗝️ Heirlooms', html);
    },

    /** Make an heirloom of a masterwork or treasure in the packs. */
    heirloomForge(game, itemId) {
        const r = Heirlooms.forgeFromItem(game.player, game.world, itemId);
        if (!r.success) {
            game.ui.showNotification('🗝️ Heirlooms', r.reason, 'error');
            return ActionMenu.showHeirlooms(game);
        }
        game.ui.showNotification(`${r.item.icon} ${r.item.name}`, `An heirloom of ${game.player.house.name} from this day.`, 'success');
        if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
        ActionMenu.showHeirloom(game, r.item.id);
    },

    /** The heirloom's actions: give, takeBack, pawn, redeem, dowry, buy, take, ask, search. */
    heirloomAct(game, id, verb, arg = null) {
        const p = game.player;
        const w = game.world;
        let r;
        switch (verb) {
            case 'give': r = Heirlooms.give(p, w, id, arg); break;
            case 'takeBack': r = Heirlooms.takeBack(p, w, id); break;
            case 'pawn': r = Heirlooms.pawn(p, w, id); break;
            case 'redeem': r = Heirlooms.redeem(p, w, id); break;
            case 'dowry': r = Heirlooms.giveAsDowry(p, w, id, arg); break;
            case 'buy': case 'take': case 'ask': case 'search': r = Heirlooms.recover(p, w, id, verb); break;
            default: r = { success: false, reason: 'Unknown.' };
        }
        const h = Heirlooms.get(p, id);
        const name = h ? h.name : 'The heirloom';
        const done = {
            give: `${name} is given.`, takeBack: `${name} is back in your hand.`, pawn: `${name} is pledged for ${r.gold} gold.`,
            redeem: `${name} is redeemed.`, dowry: `${name} goes with the bride or groom into ${r.realm}.`,
            buy: `${name} is the House's again.`, take: `${name} is the House's again.`, ask: `${name} is given back.`, search: `You find ${name}!`,
        }[verb];
        game.ui.showNotification(`${h ? h.icon : '🗝️'} ${name}`, r.success ? done : r.reason, r.success ? 'success' : (r.failed ? 'warning' : 'error'));
        if (game.ui.updateStats) game.ui.updateStats(p, w);
        ActionMenu.showHeirloom(game, id);
    },
});
