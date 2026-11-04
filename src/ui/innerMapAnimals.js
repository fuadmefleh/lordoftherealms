// ============================================
// INNER MAP ANIMALS — drawing the deer, and their menu
// ============================================
// The herds themselves (where they graze, how they wander and bolt) live in
// world/innerMap/animals.js on InnerMap.animals; this draws them from their
// walk sheets (data/animals.json: a row per direction, up/left/down/right),
// feeds them the player's stealth each frame, and offers "Hunt" on one —
// which runs the hunt of ui/mapTasks/wildTasks.js on that very animal
// (ActionMenu.huntAnimal), its outcome judged by the hunting rules as ever.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapTasks } from './innerMapTasks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : String(v[k])));

export const InnerMapAnimals = {
    _imgs: new Map(),

    /** The sheet at `path`, or null while it loads. */
    image(path) {
        if (!path || typeof Image === 'undefined') return null;
        let img = this._imgs.get(path);
        if (!img) {
            img = new Image();
            img.src = path;
            this._imgs.set(path, img);
        }
        return img.complete && img.naturalWidth ? img : null;
    },

    /** Which cell of the sheet: its row by facing, its frame by the walk. */
    frame(a, sp) {
        const rows = sp.rows || { up: 0, left: 1, down: 2, right: 3 };
        const row = _num(rows[a.facing], _num(rows.down, 2));
        const moving = !!(a.next || a.moving);
        if (!moving) return { row, col: 0 };
        const fps = a.state === 'flee' ? _num(sp.fleeFps, 12) : _num(sp.walkFps, 6);
        const phase = (a.id ? a.id.length * 0.37 : 0);
        return { row, col: Math.floor(a.animT * fps + phase) % Math.max(1, _num(sp.cols, 4)) };
    },

    /**
     * Draw one animal with its feet at (fx, fy) on screen; `ds` is a tile's
     * size on screen. False when the sheet is not loaded yet.
     */
    drawAt(ctx, a, sp, fx, fy, ds) {
        const img = this.image(sp.sheet);
        if (!img) return false;
        const fw = _num(sp.frameW, 112), fh = _num(sp.frameH, 112);
        const k = (_num(sp.drawTiles, 2) * _num(sp.scale, 1) * ds) / fw;
        const [ax, ay] = Array.isArray(sp.anchor) ? sp.anchor : [fw / 2, fh];
        const { row, col } = this.frame(a, sp);
        // A soft shadow under the body: long side on, short end on
        const side = a.facing === 'left' || a.facing === 'right';
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(fx, fy - ds * 0.04, (side ? 0.5 : 0.2) * ds * _num(sp.scale, 1), ds * 0.08 * _num(sp.scale, 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = k < 1; // a sheet scaled down is smoothed; scaled up it stays crisp
        ctx.drawImage(img, col * fw, row * fh, fw, fh, Math.round(fx - ax * k), Math.round(fy - ay * k), Math.round(fw * k), Math.round(fh * k));
        ctx.imageSmoothingEnabled = smooth;
        return true;
    },

    /** Push the visible animals into the depth-sorted sprite list (ui/innerMapLayers/entities.js). */
    collect(items, ctx, camera, T) {
        const list = InnerMap.animals;
        if (!list || !list.length || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const cfg = InnerMap.animalConfig();
        const W = ctx.canvas.width, H = ctx.canvas.height;
        for (const a of list) {
            const sp = InnerMap.animalSpecies(a.species, cfg);
            if (!sp) continue;
            const p = InnerMap.animalPos(a);
            const tile = InnerMap.tiles[Math.round(p.r)] && InnerMap.tiles[Math.round(p.r)][Math.round(p.q)];
            if (!tile || !tile.visible) continue;
            const s = camera.worldToScreenFast(p.q * T + T / 2, p.r * T + T / 2);
            const fx = s.x, fy = s.y + ds * 0.3;
            if (fx < -ds * 3 || fx > W + ds * 3 || fy < -ds * 3 || fy > H + ds * 3) continue;
            items.push({ sortY: p.r * T + T, zLayer: 2, sortX: p.q, draw: () => {
                if (!this.drawAt(ctx, a, sp, fx, fy, ds)) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(150,100,50,0.9)';
                    ctx.beginPath(); ctx.ellipse(fx, fy - ds * 0.3, ds * 0.3, ds * 0.18, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
            } });
        }
    },

    /** Each frame: the herds' lives, with the player's walk and stealth. */
    update(dt, game) {
        if (!InnerMap.active || InnerMap._insideBuilding || !InnerMap.animals || !InnerMap.animals.length) return;
        const player = game && game.player;
        // A hunt put aside without a word (another task begun over it): its beast goes free
        if (!(InnerMapTasks.isActive && InnerMapTasks.isActive())) {
            for (const a of InnerMap.animals.slice()) if (a.hunted) InnerMap.releaseAnimal(a);
        }
        InnerMap.updateAnimals(dt, {
            walking: !!InnerMap._playerWalking,
            stealth: _num(player && player.skills && player.skills.stealth, 1),
        });
    },

    /** "Hunt the stag" for an animal at (q, r) in the context menu. */
    menuItems(game, q, r) {
        if (InnerMap._insideBuilding || !InnerMap.animals || !InnerMap.animals.length) return [];
        const cfg = InnerMap.animalConfig();
        const h = cfg.hunt || {};
        const out = [];
        for (const a of InnerMap.getAnimalsNear(q, r, 1).slice(0, 2)) {
            const sp = InnerMap.animalSpecies(a.species, cfg);
            if (!sp) continue;
            const name = sp.name || a.species;
            const mood = a.state === 'flee' ? 'running' : a.state === 'alert' ? 'watching you' : a.state === 'walk' ? 'ambling' : 'grazing';
            out.push({ type: 'separator' });
            out.push({ type: 'header', label: `${sp.icon || '🦌'} ${name}, ${mood}` });
            if (a.hunted || (InnerMapTasks.isActive && InnerMapTasks.isActive())) {
                out.push({ type: 'disabled', label: a.hunted ? 'You are stalking it' : 'Finish what you are doing first' });
                continue;
            }
            const lower = name.toLowerCase();
            out.push({ type: 'action', action: 'hunt_animal', label: `${h.label || 'Hunt'} the ${lower}`, icon: h.icon || '🏹',
                desc: _fmt(h.desc || 'Creep up on the {name} and loose.', { name: lower }), animal: a });
        }
        return out;
    },
};
