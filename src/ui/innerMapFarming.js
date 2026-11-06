// ============================================
// INNER MAP FARMING — till, sow, water, harvest; and the crops drawn
// ============================================
// The menu on a patch of ground (Till Land; on tilled soil Plant <crop> and
// Sow the Row; on a crop Water / Water the Field, Harvest / Harvest the
// Field, Pull It Up), the work itself (walk beside the tile, a short swing
// through InnerMapDigging's job — its progress ring and animation — then the
// inner-map clock moves on), and the crops on the map: each tilled cell's
// stage drawn from the LPC crop sheets (data/crops.json → art), depth-sorted
// with the people walking among them.
//
// The rules and the state are systems/crops.js (player.farmPlots by hex);
// laying the tilled soil back on a regenerated map is world/innerMap/farmPlots.js.

import { InnerMap } from '../world/innerMap.js';
import { Crops } from '../systems/crops.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { FoodSkills } from '../systems/foodSkills.js';
import { sheetScale } from './sheetScale.js';
import { loadSheetInto } from '../core/customSheets.js';
import { DataLoader } from '../core/dataLoader.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

/** A farming level-up, announced */
function _skillUp(game, up) {
    if (up) _note(game, `${up.icon} ${up.name} Improved`, up.text, 'success');
}

function _refresh(game) {
    if (game && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
}

function _plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

export const InnerMapFarming = {
    _imgs: new Map(),

    /** The world hex this map belongs to: { q, r } or null. */
    hex() {
        return InnerMap.currentWorldTile || null;
    },

    /** The player's cell at inner (q, r) of this map, or null. */
    cellAt(game, q, r) {
        const h = this.hex();
        if (!h || !game || !game.player) return null;
        return Crops.cell(game.player, h.q, h.r, q, r);
    },

    _isTilled(tile) {
        return !!(tile && tile.subTerrain && tile.subTerrain.id === 'tilled_soil');
    },

    /**
     * May the player till this tile? { ok, reason, quiet } — quiet: a tile
     * nobody would think of tilling (a road, a wall), so no menu entry at all.
     */
    canTill(game, tile, q, r) {
        if (!tile || InnerMap._insideBuilding || tile._isInterior) return { ok: false, quiet: true };
        if (this._isTilled(tile)) return { ok: false, quiet: true };
        if (tile._wet || tile._sea || !InnerMapDigging.canDig(tile)) return { ok: false, quiet: true };
        if (tile._dug) return { ok: false, quiet: true };
        const h = this.hex();
        if (!h) return { ok: false, quiet: true };
        const wt = InnerMap._currentWorldTileRef;
        if (wt && wt.settlement) {
            // In town: your own lot, or open ground away from the streets
            if (tile._lot) {
                const at = InnerMap.lotAt ? InnerMap.lotAt(q, r) : null;
                if (!at || !at.mine) return { ok: false, reason: 'Someone else\'s lot: buy or rent it first' };
            } else if (this._nearRoad(q, r, Crops.config().townRoadBuffer)) {
                return { ok: false, reason: 'Town ground by the street: farm your own lot, or out past the houses' };
            }
        }
        if (!Crops.hasRoom(game.player, h.q, h.r)) return { ok: false, reason: `You already work ${Crops.config().maxCellsPerHex} patches here` };
        return { ok: true };
    },

    _nearRoad(q, r, d) {
        const n = Math.max(0, Math.floor(Number(d) || 0));
        for (let dr = -n; dr <= n; dr++) {
            for (let dq = -n; dq <= n; dq++) {
                const t = InnerMap.getTile(q + dq, r + dr);
                if (t && (t.isRoad || t.building || t.customBuilding)) return true;
            }
        }
        return false;
    },

    /** The nearest water to draw from (a stream, pond, the sea, a well or fountain): its distance in tiles, or null. */
    waterDistance(q, r) {
        const reach = Math.max(1, Number(Crops.config().waterReach) || 30);
        let best = null;
        for (let dr = -reach; dr <= reach; dr++) {
            for (let dq = -reach; dq <= reach; dq++) {
                const d = Math.max(Math.abs(dq), Math.abs(dr));
                if (best != null && d >= best) continue;
                const t = InnerMap.getTile(q + dq, r + dr);
                if (!t) continue;
                const frozen = /frozen|ice/.test((t.subTerrain && t.subTerrain.id) || '');
                const wet = (t._wet || t._sea) && !frozen;
                const well = t.customObject && /well|fountain|water_barrel|pump|trough/.test(String(t.customObject.defId || ''));
                if (wet || well) best = d;
            }
        }
        return best;
    },

    /** Tilled cells joined to (q, r) through tilled cells that pass `want(cell, tile)`, nearest first. */
    _field(game, q, r, want, limit = 60) {
        const out = [];
        const seen = new Set([`${q},${r}`]);
        const queue = [[q, r]];
        while (queue.length && out.length < limit) {
            const [cq, cr] = queue.shift();
            for (const [dq, dr] of N4) {
                const nq = cq + dq, nr = cr + dr, k = `${nq},${nr}`;
                if (seen.has(k)) continue;
                seen.add(k);
                const t = InnerMap.getTile(nq, nr);
                if (!this._isTilled(t)) continue;
                queue.push([nq, nr]);
                const cell = this.cellAt(game, nq, nr);
                if (want(cell, t)) out.push({ q: nq, r: nr });
            }
        }
        return out;
    },

    _emptyCell: (cell) => !cell || !cell.crop,
    _thirsty: (cell) => !!(cell && cell.crop && !cell.dead && !cell.watered && !Crops.isRipe(cell)),
    _ripe: (cell) => Crops.isRipe(cell),

    // ══════════════════════════════════════════════
    // MENU
    // ══════════════════════════════════════════════

    /** Context-menu entries for an outdoor tile (ui/innerMapUI.js terrain actions). */
    menuItems(game, tile, q, r) {
        const items = [];
        if (!game || !game.player || !tile || InnerMap._insideBuilding) return items;
        InnerMap._farmOwner = game.player;
        if (!this._isTilled(tile)) {
            const chk = this.canTill(game, tile, q, r);
            if (chk.ok) items.push({ type: 'action', action: 'farm_till', label: 'Till Land', icon: '🌾', desc: 'Turn the soil here for sowing' });
            else if (!chk.quiet) items.push({ type: 'disabled', label: `🌾 Till Land — ${chk.reason}` });
            return items;
        }
        const player = game.player;
        const world = game.world;
        const h = this.hex();
        const cell = this.cellAt(game, q, r);
        const status = Crops.status(cell);
        const line = Crops.describe(cell, world, h && h.q, h && h.r);
        if (status.phase === 'tilled') {
            const season = Crops.season(world);
            const held = Crops.seedsHeld(player, season);
            const more = this._field(game, q, r, this._emptyCell, 1).length > 0;
            for (const s of held) {
                if (!s.inSeason) {
                    items.push({ type: 'disabled', label: `${s.crop.icon} ${s.crop.name} — sown in ${s.crop.sow.join(' or ')}, not ${season}` });
                    continue;
                }
                const days = Crops.growDays(s.crop);
                items.push({ type: 'action', action: 'farm_plant', cropId: s.crop.id, label: `Plant ${s.crop.name}`, icon: s.crop.icon, desc: `${_plural(s.qty, 'seed', 'seeds')} · ripe in about ${days} days with water` });
                if (more && s.qty > 1) items.push({ type: 'action', action: 'farm_plant_row', cropId: s.crop.id, label: `Sow the Row (${s.crop.name})`, icon: '🌱', desc: 'Sow this and the empty tilled ground joined to it, while the seed lasts' });
            }
            if (!held.length) items.push({ type: 'disabled', label: '🌱 Plant — you carry no seed (markets sell it)' });
            return items;
        }
        items.push({ type: 'header', label: `${status.crop.icon} ${status.crop.name}` });
        if (status.phase === 'ripe') {
            items.push({ type: 'action', action: 'farm_harvest', label: `Harvest ${status.crop.name}`, icon: '🧺', desc: line });
            if (this._field(game, q, r, this._ripe, 1).length) items.push({ type: 'action', action: 'farm_harvest_all', label: 'Harvest the Field', icon: '🧺', desc: 'Everything ripe that joins this patch' });
            return items;
        }
        if (status.phase === 'dead') {
            items.push({ type: 'action', action: 'farm_clear', label: 'Clear the Dead Plants', icon: '🥀', desc: line });
            return items;
        }
        // Growing
        if (!cell.watered) {
            const d = this.waterDistance(q, r);
            if (d == null) items.push({ type: 'disabled', label: `💧 Water — no water within reach. ${line}` });
            else {
                items.push({ type: 'action', action: 'farm_water', label: 'Water', icon: '💧', desc: `${line} · water ${_plural(d, 'step', 'steps')} away` });
                if (this._field(game, q, r, this._thirsty, 1).length) items.push({ type: 'action', action: 'farm_water_all', label: 'Water the Field', icon: '💧', desc: 'Every dry crop that joins this patch' });
            }
        } else {
            items.push({ type: 'disabled', label: `💧 ${line}` });
        }
        items.push({ type: 'action', action: 'farm_clear', label: 'Pull It Up', icon: '✂️', desc: 'Dig the crop out: the seed is lost' });
        return items;
    },

    /** Run a farm_* menu action. True when it was one. */
    handle(game, item, q, r) {
        switch (item && item.action) {
            case 'farm_till': this.till(game, q, r); return true;
            case 'farm_plant': this.plant(game, q, r, item.cropId, false); return true;
            case 'farm_plant_row': this.plant(game, q, r, item.cropId, true); return true;
            case 'farm_water': this.water(game, q, r, false); return true;
            case 'farm_water_all': this.water(game, q, r, true); return true;
            case 'farm_harvest': this.harvest(game, q, r, false); return true;
            case 'farm_harvest_all': this.harvest(game, q, r, true); return true;
            case 'farm_clear': this.clear(game, q, r); return true;
            default: return false;
        }
    },

    // ══════════════════════════════════════════════
    // THE WORK
    // ══════════════════════════════════════════════

    /** Walk beside (q, r) and work it a while; then `done(tile)`, and the clock moves on. */
    _work(game, kind, q, r, verb, done) {
        const C = Crops.config();
        // A practised farmer works quicker (systems/foodSkills.js)
        const quick = kind === 'clear' ? 1 : FoodSkills.farmWorkMult(game && game.player);
        const res = InnerMapDigging.start(game, kind, q, r, {
            seconds: (Number(C.seconds[kind]) || 1.5) * quick,
            verb,
            needs: kind === 'till' ? { energy: -3, hygiene: -2 } : { energy: -1 },
            onDone: (g, tile) => {
                this._spendMinutes((Number(C.minutes[kind]) || 10) * quick);
                done(tile);
            },
        });
        if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach that spot.', 'error');
        return res;
    },

    _spendMinutes(min) {
        if (!(min > 0)) return;
        InnerMap.passHours(min / 60);
    },

    till(game, q, r) {
        const tile = InnerMap.getTile(q, r);
        const chk = this.canTill(game, tile, q, r);
        if (!chk.ok) { _note(game, '❌ Cannot Till', chk.reason || 'This ground cannot be tilled.', 'error'); return; }
        this._work(game, 'till', q, r, 'Tilling', (t) => {
            const again = this.canTill(game, t, q, r);
            const h = this.hex();
            if (!again.ok || !h) return;
            const rec = Crops.markTilled(game.player, h.q, h.r, q, r);
            if (!rec.ok) { _note(game, '❌ Cannot Till', rec.reason, 'error'); return; }
            InnerMap.setTilled(t);
            InnerMap._refreshGrassLayer(InnerMap.tiles);
            _note(game, '🌾 Till Land', 'You turn the soil. It is ready for seed.', 'success');
            _skillUp(game, FoodSkills.farmWork(game.player, 'till'));
        });
    },

    plant(game, q, r, cropId, row) {
        const h = this.hex();
        if (!h) return;
        const player = game.player;
        // (ground tilled before the fields were kept: take it on now)
        if (!this.cellAt(game, q, r) && this._isTilled(InnerMap.getTile(q, r))) {
            const rec = Crops.markTilled(player, h.q, h.r, q, r);
            if (!rec.ok) { _note(game, '🌱 Plant', rec.reason, 'warning'); return; }
        }
        const chk = Crops.canPlant(player, game.world, h.q, h.r, q, r, cropId);
        if (!chk.ok) { _note(game, '🌱 Plant', chk.reason, 'warning'); return; }
        this._work(game, 'plant', q, r, 'Sowing', () => {
            const res = Crops.plant(player, game.world, h.q, h.r, q, r, cropId);
            if (!res.ok) { _note(game, '🌱 Plant', res.reason, 'warning'); return; }
            _skillUp(game, FoodSkills.farmWork(player, 'sow'));
            _refresh(game);
            if (row) {
                const next = this._field(game, q, r, (c, t) => this._emptyCell(c) && this._isTilled(t), 1)[0];
                if (next && (player.inventory[res.crop.seed] || 0) > 0) { this.plant(game, next.q, next.r, cropId, true); return; }
            }
            const left = player.inventory[res.crop.seed] || 0;
            _note(game, `${res.crop.icon} Sown`, `You sow ${res.crop.name.toLowerCase()}. ${left ? `${_plural(left, 'seed', 'seeds')} left.` : 'That was the last of your seed.'} Keep it watered.`, 'success');
        });
    },

    water(game, q, r, all) {
        const h = this.hex();
        if (!h) return;
        const d = this.waterDistance(q, r);
        if (d == null) { _note(game, '💧 Water', 'There is no water within reach to carry from. Pray for rain.', 'warning'); return; }
        // A long haul from the water costs more time
        const extra = Math.min(30, d);
        this._work(game, 'water', q, r, 'Watering', () => {
            this._spendMinutes(extra);
            const res = Crops.water(game.player, h.q, h.r, q, r);
            if (!res.ok) { _note(game, '💧 Water', res.reason, 'info'); return; }
            _skillUp(game, FoodSkills.farmWork(game.player, 'water'));
            if (all) {
                const next = this._field(game, q, r, this._thirsty, 1)[0];
                if (next) { this.water(game, next.q, next.r, true); return; }
            }
            _note(game, '💧 Watered', all ? 'The field has its water for today.' : 'You water the crop. It will grow well today.', 'success');
        });
    },

    harvest(game, q, r, all, tally = null) {
        const h = this.hex();
        if (!h) return;
        const got = tally || {};
        this._work(game, 'harvest', q, r, 'Harvesting', () => {
            const res = Crops.harvest(game.player, h.q, h.r, q, r);
            if (!res.ok) {
                _note(game, '🧺 Harvest', res.reason, res.full ? 'error' : 'info');
                return;
            }
            got[res.good] = (got[res.good] || 0) + res.qty;
            _skillUp(game, FoodSkills.farmWork(game.player, 'harvest', res.qty));
            _refresh(game);
            if (all) {
                const next = this._field(game, q, r, this._ripe, 1)[0];
                if (next) { this.harvest(game, next.q, next.r, true, got); return; }
            }
            const what = Object.entries(got).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ');
            const lv = FoodSkills.level(game.player, 'farming');
            _note(game, '🧺 Harvest', `You bring in ${what}.${lv > 1 ? ` (🌾 Farming ${lv}: +${FoodSkills.perk(game.player, 'farming', 'yield')}% harvest)` : ''}`, 'success');
        });
    },

    clear(game, q, r) {
        const h = this.hex();
        if (!h) return;
        this._work(game, 'clear', q, r, 'Clearing', () => {
            const res = Crops.clear(game.player, h.q, h.r, q, r);
            if (res.ok) _note(game, '🌾 Cleared', 'The ground is bare tilled soil again.', 'info');
        });
    },

    // ══════════════════════════════════════════════
    // DRAWING
    // ══════════════════════════════════════════════

    image(path) {
        if (!path || typeof Image === 'undefined') return null;
        let img = this._imgs.get(path);
        if (!img) {
            img = new Image();
            // (a sheet repainted in the modern style loads its repaint, else the original: core/customSheets.js)
            loadSheetInto(img, path, DataLoader._gamedata);
            this._imgs.set(path, img);
        }
        return img.complete && img.naturalWidth ? img : null;
    },

    /** The art cell for a cell's status: { sheet, c, r, h } or null. */
    artFor(status) {
        const C = Crops.config();
        const crop = status && status.crop;
        if (!crop || !crop.art) return null;
        const pick = (sheetKey, cell) => cell ? { sheet: C.sheets[sheetKey] || sheetKey, c: cell[0], r: cell[1], h: cell[2] || 1 } : null;
        if (status.phase === 'sown') return C.sownArt ? pick(C.sownArt.sheet, C.sownArt.cell) : null;
        if (status.phase === 'ripe' || (status.phase === 'dead' && status.ripe)) return pick(crop.art.sheet, crop.art.ripe);
        const stages = crop.art.stages || [];
        const i = Math.max(0, Math.min(stages.length - 1, status.artIndex || 0));
        return status.artIndex < 0 && C.sownArt ? pick(C.sownArt.sheet, C.sownArt.cell) : pick(crop.art.sheet, stages[i]);
    },

    /** Push this map's crops into the depth-sorted sprite list (ui/innerMapLayers/entities.js). */
    collect(items, ctx, camera, T) {
        const player = InnerMap._farmOwner;
        if (InnerMap._insideBuilding || !player || !player.farmPlots) return;
        const h = this.hex();
        if (!h) return;
        const plot = Crops.plot(player, h.q, h.r);
        if (!plot) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        for (const [key, cell] of Object.entries(plot.cells)) {
            if (!cell || !cell.crop) continue;
            const [q, r] = key.split(',').map(Number);
            const tile = InnerMap.getTile(q, r);
            if (!tile || !tile.visible) continue;
            const s = camera.worldToScreenFast(q * T, r * T);
            const x = s.x, y = s.y;
            if (x < -ds * 2 || x > W + ds || y < -ds * 2 || y > H + ds * 2) continue;
            const status = Crops.status(cell);
            const art = this.artFor(status);
            items.push({ sortY: r * T + T * 0.6, zLayer: 0, sortX: q, draw: () => this._drawCrop(ctx, status, art, x, y, ds, q, r) });
        }
    },

    _drawCrop(ctx, status, art, x, y, ds, q = null, r = null) {
        ctx.save();
        // Damp earth under a watered crop: the tilled ground's own piece, from the damp sheet
        if (status.watered && status.phase !== 'dead' && !(q != null && InnerMapDigging.drawTilled(ctx, q, r, x, y, ds, 'wet'))) {
            ctx.fillStyle = 'rgba(25, 18, 40, 0.28)';
            ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(ds) + 1, Math.ceil(ds) + 1);
        }
        const img = art && this.image(art.sheet);
        if (img) {
            if (status.phase === 'dead') {
                ctx.filter = status.dead === 'frost' ? 'grayscale(0.7) brightness(1.15) contrast(0.8)' : 'sepia(0.9) saturate(0.6) brightness(0.7)';
                ctx.globalAlpha = 0.85;
            }
            const smooth = ctx.imageSmoothingEnabled;
            ctx.imageSmoothingEnabled = false;
            const hh = art.h || 1;
            const k = sheetScale(img);   // (wheat is a high-res sheet: ui/sheetScale.js)
            ctx.imageSmoothingEnabled = k > 1;
            ctx.drawImage(img, art.c * 32 * k, (art.r - hh + 1) * 32 * k, 32 * k, 32 * hh * k,
                Math.round(x), Math.round(y - ds * (hh - 1)), Math.round(ds), Math.round(ds * hh));
            ctx.imageSmoothingEnabled = smooth;
        } else {
            // Still loading: a green tuft
            ctx.fillStyle = status.phase === 'ripe' ? '#d9b44a' : status.phase === 'dead' ? '#7a5a3a' : '#4f8a3a';
            ctx.beginPath();
            ctx.ellipse(x + ds / 2, y + ds * 0.6, ds * 0.22, ds * 0.18, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },
};
