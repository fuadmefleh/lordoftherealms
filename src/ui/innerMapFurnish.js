// ============================================
// INNER MAP FURNISH — arranging the furniture of a home you own
// ============================================
// The UI half of world/innerMap/furnishing.js and systems/furnishing.js.
// Inside a building of the player's, the context menu offers Furnish (and,
// on a piece, Move / Put in Store). Furnish opens the edit mode:
//
//   - a palette (top right) lists the pieces in the furniture store: Place
//     picks one up to set down;
//   - left-click a piece on the floor to pick it up and move it;
//   - while holding a piece, a ghost follows the cursor, green where it may
//     stand and red (with the reason) where it may not; left-click sets it
//     down, R turns a long piece, Put in Store puts it away (a chest only
//     when empty), right-click or Esc puts it back where it was;
//   - Esc or Done (or walking out) ends the mode.
//
// Wired in from the game loop's inner-map click (click) and the renderer's
// layer hook (InnerMapRenderer.onFurnishLayer).

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { FurnitureCatalogue } from '../world/furnitureCatalogue.js';
import { Furnishing } from '../systems/furnishing.js';
import { furnitureGlyph, drawGlyph } from './icons.js';

const PANEL_ID = 'furnishPanel';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function _notify(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

export const InnerMapFurnish = {
    active: false,
    _game: null,
    // The piece in hand, its turn, and where it came from ({ key, q, r, rot } | null: the store)
    held: null,
    rot: 0,
    heldFrom: null,
    _homeKey: null,
    _keys: null,
    _lastHover: null,

    /** May the player furnish where they stand? */
    available() {
        return !!(InnerMap.active && InnerMap._insideBuilding && InnerMap.isOwnHome && InnerMap.isOwnHome());
    },

    /** Context-menu entries inside a home of the player's. */
    menuItems(game, tile, q, r) {
        if (!this.available() || this.active) return [];
        const items = [{ type: 'separator' }, { type: 'header', label: '🪑 Your Home' }];
        const f = tile && tile._furniture;
        if (f && InnerMap._movableFurniture(tile)) {
            items.push({ type: 'action', action: 'furnish_move', label: `Move the ${f.name}`, icon: '✋', desc: 'Pick it up and set it down elsewhere', fq: q, fr: r });
            items.push({ type: 'action', action: 'furnish_putaway', label: `Put the ${f.name} in Store`, icon: '📦', desc: 'Into your furniture store, to set down later or sell', fq: q, fr: r });
        }
        const n = Furnishing.store(game.player).length;
        items.push({ type: 'action', action: 'furnish_start', label: 'Furnish', icon: '🪑', desc: n ? `Arrange the furniture; ${n} piece${n === 1 ? '' : 's'} in store to set down` : 'Arrange the furniture. Buy more from a furniture maker in town.' });
        return items;
    },

    /** A context-menu action of ours → true when handled. */
    handle(game, item) {
        switch (item && item.action) {
            case 'furnish_start': this.start(game); return true;
            case 'furnish_move':
                this.start(game);
                this.liftAt(item.fq, item.fr);
                return true;
            case 'furnish_putaway': {
                const was = this.active;
                this.start(game);
                if (this.liftAt(item.fq, item.fr)) this.putAwayHeld();
                if (!was) this.stop();
                return true;
            }
            default: return false;
        }
    },

    start(game) {
        if (!this.available()) { _notify(game, '🪑 Furnish', 'You can only furnish a home of your own.', 'error'); return false; }
        this._game = game;
        InnerMap.adoptHomeFurniture(game.player);
        this._homeKey = InnerMap.furnishHomeKey();
        if (!this.active) {
            this.active = true;
            this._keys = (e) => this._onKey(e);
            if (typeof window !== 'undefined') window.addEventListener('keydown', this._keys, true);
        }
        this.renderPanel();
        return true;
    },

    stop() {
        if (this.held) this.cancelHold();
        this.active = false;
        if (this._keys && typeof window !== 'undefined') window.removeEventListener('keydown', this._keys, true);
        this._keys = null;
        this._homeKey = null;
        if (typeof document !== 'undefined') {
            const el = document.getElementById(PANEL_ID);
            if (el) el.remove();
        }
    },

    _onKey(e) {
        if (!this.active) return;
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'r' || e.key === 'R') {
            this.rotate();
        } else if (e.key === 'Escape') {
            if (this.held) this.cancelHold();
            else this.stop();
        } else {
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.renderPanel();
    },

    _player() { return this._game && this._game.player; },

    /** Take a piece out of the store into the hand. */
    pickFromStore(uid) {
        const player = this._player();
        if (!player) return false;
        if (this.held) this.cancelHold();
        const piece = Furnishing.takeFromStore(player, uid);
        if (!piece) return false;
        this.held = piece;
        this.rot = piece.rot || 0;
        this.heldFrom = null;
        this.renderPanel();
        return true;
    },

    /** Pick up the piece standing at (q, r). */
    liftAt(q, r) {
        const player = this._player();
        if (!player) return false;
        const piece = InnerMap.pieceAt(player, q, r);
        if (!piece) return false;
        if (this.held) this.cancelHold();
        const from = { key: this._homeKey, q: piece.q, r: piece.r, rot: piece.rot || 0 };
        if (!InnerMap.liftPiece(player, piece.uid)) return false;
        this.held = piece;
        this.rot = piece.rot || 0;
        this.heldFrom = from;
        this.renderPanel();
        return true;
    },

    rotate() {
        if (!this.held) return;
        const [w, h] = FurnitureCatalogue.view(this.held).footprint;
        if (w !== h) this.rot = (this.rot + 1) % 2;
    },

    /** Set the piece in hand down at (q, r). → { ok, reason } */
    drop(q, r) {
        const player = this._player();
        if (!this.held || !player) return { ok: false, reason: 'Nothing in hand.' };
        const res = InnerMap.placePiece(player, this.held, q, r, this.rot);
        if (res.ok) {
            this.held = null;
            this.heldFrom = null;
        }
        this.renderPanel();
        return res;
    },

    /** Put the piece in hand back where it came from (its spot, or the store). */
    cancelHold() {
        const player = this._player();
        const piece = this.held;
        this.held = null;
        if (!piece || !player) return;
        const from = this.heldFrom;
        this.heldFrom = null;
        if (from) {
            const here = this.available() && InnerMap.furnishHomeKey() === from.key;
            if (here && InnerMap.placePiece(player, piece, from.q, from.r, from.rot).ok) return;
            // Not here any more (walked out): it goes back to its spot in the layout, laid on the next visit
            const rec = player.homeFurnishings && player.homeFurnishings[from.key];
            if (rec && !here) {
                piece.q = from.q; piece.r = from.r; piece.rot = from.rot;
                rec.pieces.push(piece);
                return;
            }
        }
        delete piece.q; delete piece.r;
        Furnishing.store(player).push(piece);
    },

    /** The piece in hand into the furniture store (refused while it holds goods). */
    putAwayHeld() {
        const player = this._player();
        if (!this.held) return false;
        const res = Furnishing.putAway(player, this.held);
        if (!res.success) {
            _notify(this._game, '📦 Put Away', res.text, 'warning');
            this.cancelHold();
            this.renderPanel();
            return false;
        }
        this.held = null;
        this.heldFrom = null;
        _notify(this._game, '📦 Put Away', res.text, 'success');
        this.renderPanel();
        return true;
    },

    /**
     * An inner-map click while furnishing (game loop). → true when it was ours.
     * Left: set down / pick up. Right: put back what's in hand, or end the mode.
     */
    click(game, q, r, button = 'left') {
        if (!this.active) return false;
        if (!this.available()) { this.stop(); return false; }
        this._game = game;
        if (button === 'right') {
            if (this.held) this.cancelHold();
            else this.stop();
            this.renderPanel();
            return true;
        }
        if (this.held) {
            const res = this.drop(q, r);
            if (!res.ok) _notify(game, '🪑 Furnish', res.reason, 'warning');
            return true;
        }
        if (!this.liftAt(q, r)) {
            const t = InnerMap.getTile(q, r);
            if (t && t._furniture) _notify(game, '🪑 Furnish', `The ${t._furniture.name} is built in.`, 'info');
        }
        return true;
    },

    // ──────────── THE PALETTE ────────────

    renderPanel() {
        if (typeof document === 'undefined') return;
        let el = document.getElementById(PANEL_ID);
        if (!this.active) { if (el) el.remove(); return; }
        const player = this._player();
        if (!el) {
            el = document.createElement('div');
            el.id = PANEL_ID;
            el.style.cssText = 'position:fixed;top:132px;left:16px;width:270px;max-height:65vh;overflow:auto;zoom:var(--ui-zoom,1);z-index:950;'
                + 'background:rgba(20,16,12,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:8px;padding:10px 12px;'
                + 'font-family:var(--font-body,Georgia,serif);font-size:12px;color:#e8dcc0;box-shadow:0 6px 24px rgba(0,0,0,0.5);';
            el.addEventListener('click', (e) => this._onPanelClick(e));
            document.body.appendChild(el);
        }
        const rec = InnerMap.homeLayout(player, false);
        const btn = (act, label, extra = '', gold = false) => `<button data-fa="${act}" ${extra} style="padding:3px 9px;margin:3px 4px 0 0;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;${gold ? 'background:#f5c542;color:#1a1a1a;' : 'background:rgba(255,255,255,0.12);color:#e8dcc0;'}">${label}</button>`;
        let html = `<div style="font-family:var(--font-display,'Cinzel',serif);color:#f5c542;font-size:14px;margin-bottom:4px;">🪑 Furnishing</div>`;
        html += `<div style="color:#aaa;font-size:11px;margin-bottom:6px;">${_esc((rec && rec.name) || 'Your home')} · comfort +${InnerMap.homeComfort()}/h</div>`;
        if (this.held) {
            const v = FurnitureCatalogue.view(this.held);
            const [w, h] = v.footprint;
            html += `<div style="background:rgba(245,197,66,0.1);border-radius:6px;padding:6px 8px;margin-bottom:6px;">`;
            html += `<div>In hand: <b>${_esc(v.icon)} ${_esc(v.name)}</b></div>`;
            html += `<div style="color:#aaa;font-size:11px;">Click a floor tile to set it down. Right-click or Esc puts it back.</div>`;
            if (w !== h) html += btn('rotate', '↻ Turn (R)');
            html += btn('putaway', '📦 Put in Store');
            html += btn('cancel', '✖ Put Back');
            html += '</div>';
        } else {
            html += `<div style="color:#aaa;font-size:11px;margin-bottom:6px;">Click a piece on the floor to pick it up and move it.</div>`;
        }
        const stored = Furnishing.storeView(player);
        html += `<div style="color:#f5c542;font-weight:bold;margin-top:4px;">📦 In store (${stored.length})</div>`;
        if (!stored.length) html += `<div style="color:#888;font-size:11px;padding:4px 0;">Nothing in store. A furniture maker in town sells beds, chests, tables and hearths.</div>`;
        for (const { piece, view } of stored) {
            const fp = view.footprint[0] * view.footprint[1] > 1 ? ` <span style="color:#888;">${view.footprint[0]}×${view.footprint[1]}</span>` : '';
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-top:1px solid rgba(255,255,255,0.05);">`;
            html += `<span>${_esc(view.icon)} ${_esc(view.name)}${fp}</span>${btn('pick', 'Place', `data-uid="${_esc(piece.uid)}"`, true)}</div>`;
        }
        html += `<div style="margin-top:8px;text-align:right;">${btn('done', 'Done (Esc)')}</div>`;
        el.innerHTML = html;
    },

    _onPanelClick(e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-fa]') : null;
        if (!b) return;
        e.stopPropagation();
        switch (b.dataset.fa) {
            case 'pick': this.pickFromStore(b.dataset.uid); break;
            case 'rotate': this.rotate(); break;
            case 'putaway': this.putAwayHeld(); break;
            case 'cancel': this.cancelHold(); break;
            case 'done': this.stop(); return;
        }
        this.renderPanel();
    },

    // ──────────── THE GHOST ────────────

    /** Drawn after the highlights (InnerMapRenderer.onFurnishLayer). */
    render(ctx, camera) {
        if (!this.active) return;
        if (!this.available()) { this.stop(); return; }
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const hov = InnerMapRenderer._hoveredInnerHex;
        const player = this._player();
        ctx.save();
        if (this.held) {
            if (!hov) { ctx.restore(); return; }
            const trial = { ...this.held, rot: this.rot };
            const chk = InnerMap.furnishCheck(trial, hov.q, hov.r, { player });
            const v = FurnitureCatalogue.view(this.held);
            const art = InnerMapRenderer._interiorArt && InnerMapRenderer._interiorArt.furniture && InnerMapRenderer._interiorArt.furniture[v.type];
            const img = art && InnerMapRenderer._getSheetByPath(art.sheet);
            for (const c of FurnitureCatalogue.tilesOf(trial, hov.q, hov.r)) {
                const s = camera.worldToScreen(c.q * T, c.r * T);
                const x = Math.floor(s.x), y = Math.floor(s.y);
                ctx.globalAlpha = 0.65;
                if (img) {
                    ctx.drawImage(img, art.sx, art.sy, 32, 32, x, y, ds, ds);
                } else {
                    const g = furnitureGlyph(v);
                    if (g) drawGlyph(ctx, g, x + ds / 2, y + ds / 2, ds * 0.6, '#f0e0b0');
                }
                ctx.globalAlpha = 1;
                ctx.fillStyle = chk.ok ? 'rgba(93,219,106,0.28)' : 'rgba(224,80,70,0.32)';
                ctx.fillRect(x, y, ds, ds);
                ctx.strokeStyle = chk.ok ? 'rgba(93,219,106,0.9)' : 'rgba(224,80,70,0.9)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, ds - 2, ds - 2);
            }
            if (!chk.ok && chk.reason && ds >= 14) {
                const s = camera.worldToScreen(hov.q * T, hov.r * T);
                ctx.font = 'bold 12px Georgia, serif';
                const tw = ctx.measureText(chk.reason).width + 10;
                ctx.fillStyle = 'rgba(20,10,8,0.85)';
                ctx.fillRect(s.x, s.y - 20, tw, 17);
                ctx.fillStyle = '#f0a090';
                ctx.textBaseline = 'middle';
                ctx.fillText(chk.reason, s.x + 5, s.y - 11);
            }
        } else if (hov) {
            // What a click would pick up
            const piece = InnerMap.pieceAt(player, hov.q, hov.r);
            if (piece) {
                ctx.strokeStyle = 'rgba(245,197,66,0.95)';
                ctx.lineWidth = 2;
                for (const c of FurnitureCatalogue.tilesOf(piece, piece.q, piece.r)) {
                    const s = camera.worldToScreen(c.q * T, c.r * T);
                    ctx.strokeRect(Math.floor(s.x) + 1, Math.floor(s.y) + 1, ds - 2, ds - 2);
                }
            }
        }
        ctx.restore();
    },
};

InnerMapRenderer.onFurnishLayer = (ctx, camera) => InnerMapFurnish.render(ctx, camera);
