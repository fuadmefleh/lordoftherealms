// ============================================
// INNER MAP GRAVES — reading, mourning, clearing and robbing graves on the map
// ============================================
// The UI half of world/innerMap/graves.js and systems/graveyards.js. Right-
// click a grave (its marker or its mound):
//
//   - read it: the name, the years, what took them, how long the lease runs;
//   - pay your respects;
//   - your own ground, the lease run out: dig it up yourself (bones and grave
//     goods are yours) or hire the sexton;
//   - anyone else's: rob it (a dig at the spot, then a theft roll);
//   - the player's bone mill or ossuary, and their grounds: the panel.
//
// It also lays on the ground what lies flat there (renderGround): a fresh
// grave's mound and a cleared grave's open pit, in the painted art; a marker
// whose art hasn't landed is drawn as the old dug-grave mound and cross
// (ui/innerMapDigging.js) until it does.

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { GraveBook } from '../world/graveBook.js';
import { GraveArt } from '../world/graveArt.js';
import { Graveyards } from '../systems/graveyards.js';
import { Utils } from '../core/utils.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { ActionMenu } from './actionMenu.js';

const PANEL_ITEM = { type: 'action', action: 'grave_panel', label: 'Graveyards & the Dead', icon: '⚰️', desc: 'Your grounds, leases, bones, mills and your own dead' };

function _fill(line, vars) {
    return String(line || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

function _note(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

/** Who can see the player at work here: { witnesses, guards, hour }. */
function _scene(q, r) {
    let witnesses = 0, guards = 0;
    for (const n of InnerMap.npcs || []) {
        if (!n || n.state === 'unconscious' || n._asleep) continue;
        if (Math.max(Math.abs(n.q - q), Math.abs(n.r - r)) > 7) continue;
        if (n.type === 'guard') guards++;
        else witnesses++;
    }
    return { witnesses, guards, hour: Number.isFinite(InnerMap.timeOfDay) ? InnerMap.timeOfDay : 12 };
}

export const InnerMapGraves = {
    /** Menu items for a tile on the town map (a grave, a plot, a grave work), or []. */
    menuItems(game, tile, q, r) {
        const items = [];
        if (!tile || InnerMap._insideBuilding) return items;
        const co = tile.customObject || (tile.customObjectPart ? (InnerMap.getTile(tile.customObjectPart.anchorQ, tile.customObjectPart.anchorR) || {}).customObject : null);
        if (co && co.graveWork) {
            items.push({ type: 'separator' });
            items.push({ type: 'header', label: co.graveWork.kind === 'bone_mill' ? '🦴 Your Bone Mill' : '⚱️ Your Ossuary Shrine' });
            items.push(PANEL_ITEM);
            return items;
        }
        const at = InnerMap.plotAt(q, r);
        if (!at) return items;
        const world = game.world;
        const info = Graveyards.graveAt(world, at.s, at.ground.id, at.i);
        items.push({ type: 'separator' });
        const ref = { groundId: at.ground.id, plot: at.i, gq: at.q, gr: at.r };
        if (!info) {
            const open = at.ground.open && at.ground.open[at.i] != null;
            items.push({ type: 'header', label: open ? '🕳️ An Open Grave' : at.ground.owner === 'player' ? '⚰️ An Empty Plot — Yours' : '⚰️ An Empty Plot' });
            if (at.ground.owner === 'player') items.push(PANEL_ITEM);
            return items;
        }
        const g = info.grave;
        items.push({ type: 'header', label: info.legible ? `⚰️ ${g.name}` : '⚰️ An Old Grave' });
        items.push({ type: 'action', action: 'grave_read', label: info.legible ? 'Read the Grave' : 'Look at the Grave', icon: '📜', desc: info.legible ? 'Who lies here, and since when' : 'The marker is long gone', ...ref });
        items.push({ type: 'action', action: 'grave_respects', label: 'Pay Your Respects', icon: '🕯️', desc: 'Stand a while by the grave', ...ref });
        if (info.mine && info.expired && !g.kin) {
            items.push({ type: 'action', action: 'grave_dig', label: 'Dig Up the Lapsed Grave', icon: '⛏️', desc: 'The lease has run out: the bones (and any grave goods) are yours, the plot free', ...ref });
            const fee = Math.round(Number(GraveBook.byType(GraveBook.config().sextonFee, at.s.type)) || 4);
            items.push({ type: 'action', action: 'grave_sexton', label: `Have the Sexton Clear It (${fee}g)`, icon: '👷', desc: 'He digs; the bones come to you', ...ref });
        } else if (!g.kin) {
            items.push({ type: 'action', action: 'grave_rob', label: 'Rob the Grave', icon: '🌒', desc: 'Dig down to what was buried with them. A theft — and worse, if you are seen', ...ref });
        }
        if (info.mine) items.push(PANEL_ITEM);
        return items;
    },

    /** Run a grave action. Returns true when it was one of ours. */
    handle(game, item) {
        const { world, player } = game;
        const s = InnerMap.plotAt(item.gq, item.gr) ? InnerMap.plotAt(item.gq, item.gr).s : (InnerMap._graveSettlement && InnerMap._graveSettlement());
        switch (item.action) {
            case 'grave_panel':
                if (typeof ActionMenu.showGraveyards === 'function') ActionMenu.showGraveyards(game);
                return true;
            case 'grave_read': {
                const info = s && Graveyards.graveAt(world, s, item.groundId, item.plot);
                if (!info) return true;
                const g = info.grave;
                if (!info.legible) { _note(game, '⚰️ An Old Grave', GraveBook.config().text.unmarked || 'Its marker is long gone.'); return true; }
                const lines = [GraveBook.epitaph(g, world)];
                if (g.cause) lines.push(`Taken by ${g.cause}.`);
                const years = GraveBook.yearsBetween(g.died, world.day);
                lines.push(years ? `${years} year${years === 1 ? '' : 's'} in the ground.` : 'Buried this year.');
                if (g.kin) lines.push('Of your own blood.');
                else if (g.until == null) lines.push('Held in perpetuity.');
                else if (info.expired) lines.push('Its lease has run out.');
                else lines.push(`Leased until ${GraveBook.yearOf(g.until, world)}.`);
                _note(game, `⚰️ ${(GraveBook.markerDef(info.marker) || {}).name || 'A Grave'}`, lines.join(' '));
                return true;
            }
            case 'grave_respects': {
                const info = s && Graveyards.graveAt(world, s, item.groundId, item.plot);
                if (!info) return true;
                const lines = GraveBook.config().text.respects || ['You stand a while by the grave of {name}.'];
                const years = GraveBook.yearsBetween(info.grave.died, world.day);
                const name = info.legible ? info.grave.name : 'someone long forgotten';
                _note(game, '🕯️ A Grave', _fill(lines[Math.floor(Utils.random() * lines.length)], { name, years: `${years} year${years === 1 ? '' : 's'}` }));
                return true;
            }
            case 'grave_sexton': {
                const res = Graveyards.clearPlot(player, world, s, item.groundId, item.plot, 'sexton');
                this._after(game, res, '👷 The Sexton');
                return true;
            }
            case 'grave_dig':
            case 'grave_rob': {
                const rob = item.action === 'grave_rob';
                const secs = (InnerMapDigging.config().seconds || {}).exhume || 5;
                const out = InnerMapDigging.start(game, 'exhume', item.gq, item.gr, {
                    seconds: rob ? secs * 1.4 : secs,
                    verb: rob ? 'Robbing the grave' : 'Digging up the grave',
                    onDone: (g) => {
                        const res = rob
                            ? Graveyards.robGrave(g.player, g.world, s, item.groundId, item.plot, _scene(item.gq, item.gr))
                            : Graveyards.clearPlot(g.player, g.world, s, item.groundId, item.plot, 'self');
                        this._after(g, res, rob ? '🌒 Grave Robbing' : '⛏️ Dug Up', res.caught ? 'error' : null);
                    },
                });
                if (out === 'unreachable') _note(game, '⛏️ Can\'t reach it', 'There is nowhere to stand beside that grave.', 'error');
                return true;
            }
        }
        return false;
    },

    _after(game, res, title, kind = null) {
        if (res.success) _note(game, title, res.text, kind || 'success');
        else _note(game, title, res.reason || res.text, kind || 'error');
        if (game.ui && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
        if (InnerMap.refreshGraves) InnerMap.refreshGraves(game.world);
    },

    // ══════════════════════════════════════════════
    // RENDER — what lies flat on a grave, under the sprites
    // ══════════════════════════════════════════════

    _img(id) {
        if (!GraveArt.hasArt(id)) return null;
        const img = CustomObjects.getImage(GraveArt.path(id));
        return img && img.complete && img.naturalWidth ? img : null;
    },

    /** A ground sprite (the mound, the open pit) on the tile below the head (the grave's length toward the viewer), centred on it. */
    _drawFlat(ctx, img, x, y, ds) {
        const P = Number(GraveBook.config().artTile) || 128;
        const w = img.naturalWidth * ds / P, h = img.naturalHeight * ds / P;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, Math.floor(x + (ds - w) / 2), Math.floor(y + ds + (ds - h) / 2), w, h);
        ctx.imageSmoothingEnabled = smooth;
    },

    renderGround(ctx, camera, range, T) {
        if (!InnerMap.tiles || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = range;
        for (let r = Math.max(0, rMin - 1); r <= Math.min(InnerMap.height - 1, rMax); r++) {
            const row = InnerMap.tiles[r];
            if (!row) continue;
            for (let q = Math.max(0, qMin - 1); q <= Math.min(InnerMap.width - 1, qMax); q++) {
                const tile = row[q];
                const show = tile && tile._graveShow;
                if (!show || !tile.visible) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                const x = s.x, y = s.y;
                if (show.open) {
                    const img = this._img('grave_open');
                    if (img) this._drawFlat(ctx, img, x, y, ds);
                    else InnerMapDigging._drawFeature(ctx, 'hole', x, y + ds, ds, q, r + 1);
                    continue;
                }
                if (show.fresh) {
                    const img = this._img('grave_mound');
                    if (img) this._drawFlat(ctx, img, x, y, ds);
                    else InnerMapDigging._drawFeature(ctx, 'filled', x, y + ds, ds, q, r + 1);
                }
                // A marker whose art hasn't landed: the old dug-grave mound and cross, until it does
                if (show.marker && !show.art && show.marker !== 'grave_mound') InnerMapDigging._drawFeature(ctx, 'grave', x, y, ds, q, r);
            }
        }
    },
};
