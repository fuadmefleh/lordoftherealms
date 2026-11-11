// ============================================
// INNER MAP DIGGING — holes, filled earth and graves on the street map
// ============================================
// Digging changes the ground itself: the tile turns to bare earth (the grass
// is stripped and re-edged), a hole is dug into it (impassable, the spoil
// heaped beside it), and it can be filled in again or made a grave.
//
//   dig    — any bare outdoor ground: a hole (and sometimes something in it)
//   fill   — a hole: turned earth again, walkable
//   bury   — a hole with a body in it, next to it or carried: a burial mound,
//            plain earth with no name on it, settling into the ground
//   mark   — a burial mound: raise a grave marker (one carried, or a cross
//            carved from wood carried) and it is a named grave
//   exhume — a grave or mound: a hole again, the body lying in it (the marker
//            comes back to the pack)
//
// Burials are kept on the world (world/burials.js, world.burials[hex], saved),
// the tile's _dug the record itself; world/innerMap/graves.js lays them.
//
// The work takes time at the spot (InnerMapDigging.update, from the game
// loop): the player walks beside the tile, faces it and swings; walking off
// stops it. Tuning and wording live in data/digging.json.
//
// What lies on a tile is kept on the tile (tile._dug = { kind, name, day }),
// so it lasts as long as the town's street map does. Ground features are
// drawn under the sprites (renderGround, from the depth-sorted pass).

import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { drawTilledSoil } from './tilledSoil.js';
import { Endurance } from '../player/endurance.js';
import { Carrying } from '../systems/carrying.js';
import { InnerMapDowned } from './innerMapDowned.js';
import { Burials } from '../world/burials.js';
import { GraveArt } from '../world/graveArt.js';
import { GraveBook } from '../world/graveBook.js';
import { CustomObjects } from '../world/customObjects.js';

const DEFAULTS = {
    seconds: { dig: 5, fill: 3, bury: 4, exhume: 5 },
    toolSpeed: 0.6,
    tools: ['tools'],
    needs: { energy: -6, hygiene: -6 },
    carrySpeed: 0.6,
    finds: [],
    text: {},
};

const GROUND = {
    hole: { id: 'dug_hole', name: 'Hole', icon: '🕳️', color: '#3b2a1c', passable: false },
    filled: { id: 'turned_earth', name: 'Turned Earth', icon: '⬛', color: '#6b5034', passable: true },
    grave: { id: 'grave', name: 'Burial Mound', icon: '⚰️', color: '#6b5034', passable: true },
};

const VERB = { dig: 'Digging', fill: 'Filling in', bury: 'Burying', exhume: 'Digging up', mark: 'Raising the marker' };

function _cheb(aq, ar, bq, br) {
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br));
}

function _fill(line, vars) {
    return String(line || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

export const InnerMapDigging = {
    // { kind, q, r, t, total, corpse, then, game }
    _job: null,
    _baseSpeed: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.digging;
        const c = { ...DEFAULTS, ...(src || {}) };
        c.seconds = { ...DEFAULTS.seconds, ...((src && src.seconds) || {}) };
        c.text = { ...DEFAULTS.text, ...((src && src.text) || {}) };
        return c;
    },

    /** What has been dug at a tile: { kind:'hole'|'filled'|'grave', name?, day } or null. */
    dugAt(q, r) {
        const t = InnerMap.getTile(q, r);
        return (t && t._dug) || null;
    },

    /** Bare outdoor ground a hole can go in (not a road, a doorway, a building or a thing). */
    canDig(tile) {
        if (!tile || tile._isInterior || InnerMap._insideBuilding) return false;
        if (tile._dug && tile._dug.kind !== 'filled') return false;
        if (!tile.subTerrain || !tile.subTerrain.passable) return false;
        // (no hole or grave in the shallows, a ford, a beach's wash)
        if (tile._wet || tile._sea || tile._shallow || tile._ford || /water/.test(tile.subTerrain.id || '')) return false;
        if (tile.isRoad || tile._doorMarker || tile.building || tile.customBuilding) return false;
        if (tile.customObject || tile.customObjectPart || tile.groundItem) return false;
        if (InnerMap.playerInnerQ === tile.q && InnerMap.playerInnerR === tile.r && InnerMap._playerWalking) return false;
        return true;
    },

    /** A hole on or next to (q, r), nearest first. */
    holeNear(q, r) {
        let best = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                const d = this.dugAt(q + dq, r + dr);
                if (d && d.kind === 'hole' && (!best || Math.abs(dq) + Math.abs(dr) < best.n)) best = { q: q + dq, r: r + dr, n: Math.abs(dq) + Math.abs(dr) };
            }
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** The nearest diggable tile beside (q, r) (a grave dug next to a body). */
    diggableNear(q, r) {
        let best = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                if (!dq && !dr) continue;
                const t = InnerMap.getTile(q + dq, r + dr);
                if (!this.canDig(t)) continue;
                if (t.q === InnerMap.playerInnerQ && t.r === InnerMap.playerInnerR) continue;
                const n = Math.abs(dq) + Math.abs(dr) + _cheb(t.q, t.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) * 0.01;
                if (!best || n < best.n) best = { q: t.q, r: t.r, n };
            }
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** Is the player at work? (for the swing animation) */
    isWorking() {
        return !!(this._job && this._job.t != null);
    },

    /** The tile being worked, for the player to face. */
    workTile() {
        return this._job ? { q: this._job.q, r: this._job.r } : null;
    },

    /**
     * Go and do some ground work at (q, r): walk beside it (never onto it),
     * then work there for the configured time.
     * @param {object} game
     * @param {'dig'|'fill'|'bury'|'exhume'} kind
     * @param {number} q
     * @param {number} r
     * @param {object} [opts] { corpse, then: { kind, corpse } }
     */
    start(game, kind, q, r, opts = {}) {
        this.cancel();
        if (InnerMapCombat._attackState) InnerMapCombat.cancelAttack();
        // (other ground work — tilling, sowing, harvesting (ui/innerMapFarming.js) — brings its own
        // time, label, needs and what to do when done: opts.seconds, opts.verb, opts.needs, opts.onDone;
        // opts.onTile: work on something lying on the ground (a carcass) may be done standing on it)
        const total = Number(opts.seconds) > 0 ? Number(opts.seconds) : this._seconds(game, kind);
        const job = { kind, q, r, t: null, total, corpse: opts.corpse || null, then: opts.then || null, game, onDone: opts.onDone || null, verb: opts.verb || null, needs: opts.needs || null };
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const near = _cheb(pq, pr, q, r);
        if (near === 1 || (opts.onTile && near === 0 && !InnerMap._playerWalking)) {
            this._begin(job);
            return 'now';
        }
        // Stand beside the spot: the nearest open tile next to it
        let spot = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                if (!dq && !dr) continue;
                const t = InnerMap.getTile(q + dq, r + dr);
                if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customObject || t.customObjectPart) continue;
                const n = _cheb(t.q, t.r, pq, pr) + (dq && dr ? 0.5 : 0);
                if (!spot || n < spot.n) spot = { q: t.q, r: t.r, n };
            }
        }
        if (!spot) return 'unreachable';
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(spot.q, spot.r);
        if (!walk || !walk.started) return 'unreachable';
        this._job = job;
        InnerMap._pendingAction = { q, r, run: () => { if (this._job === job) this._begin(job); } };
        return 'walking';
    },

    cancel() {
        this._job = null;
    },

    _seconds(game, kind) {
        const C = this.config();
        const base = Number(C.seconds[kind]) || 4;
        const inv = (game && game.player && game.player.inventory) || {};
        const tooled = (C.tools || []).some(id => (inv[id] || 0) > 0);
        return tooled ? base * (Number(C.toolSpeed) || 1) : base;
    },

    _begin(job) {
        job.t = 0;
        this._job = job;
        job.startQ = InnerMap.playerInnerQ;
        job.startR = InnerMap.playerInnerR;
    },

    /** Each frame, from the game loop. */
    update(deltaTime, game) {
        this._updateCarry(game);
        const job = this._job;
        if (!job || job.t == null) return;
        if (!InnerMap.active || InnerMap._insideBuilding) { this.cancel(); return; }
        // Walking away stops the work
        if (InnerMap._playerWalking || InnerMap.playerInnerQ !== job.startQ || InnerMap.playerInnerR !== job.startR) {
            this.cancel();
            return;
        }
        job.t += deltaTime;
        if (job.t < job.total) return;
        this._job = null;
        this._finish(job, game || job.game);
    },

    /** How far along the work is (0-1), for the progress ring. */
    progress() {
        const j = this._job;
        return j && j.t != null ? Math.min(1, j.t / j.total) : 0;
    },

    _note(game, title, body, kind = 'info') {
        if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
    },

    _finish(job, game) {
        const C = this.config();
        const tile = InnerMap.getTile(job.q, job.r);
        if (!tile) return;
        const day = (game && game.world && game.world.day) || 0;
        const player = game && game.player;
        if (typeof job.onDone === 'function') {
            if (player && typeof player.modifyNeed === 'function') {
                for (const [need, v] of Object.entries(job.needs || {})) {
                    // Hard work: the hardy tire less, and it builds Endurance (player/endurance.js)
                    if (need === 'energy' && v < 0) Endurance.labour(player, -v);
                    else player.modifyNeed(need, v);
                }
            }
            job.onDone(game, tile);
            return;
        }
        if (player && typeof player.modifyNeed === 'function') {
            for (const [need, v] of Object.entries(C.needs || {})) {
                if (need === 'energy' && v < 0) Endurance.labour(player, -v);
                else player.modifyNeed(need, v);
            }
        }
        if (job.kind === 'dig') {
            if (!this.canDig(tile)) return;
            this.setGround(tile, 'hole', { day });
            const found = this._rollFind(game);
            this._note(game, '⛏️ A hole', found || C.text.dig || 'You dig a hole.', found ? 'success' : 'info');
            if (job.then && job.then.kind === 'bury' && job.then.corpse) {
                this.start(game, 'bury', job.q, job.r, { corpse: job.then.corpse });
            }
        } else if (job.kind === 'fill') {
            if (!tile._dug || tile._dug.kind !== 'hole') return;
            // A body lying in the hole is buried by filling it
            const body = InnerMapCombat.corpsesHere().find(c => c.q === job.q && c.r === job.r && c !== InnerMapCombat._carrying);
            if (body) { this._buryBody(game, tile, body, day); return; }
            this.setGround(tile, 'filled', { day });
            this._note(game, '⬛ Filled in', C.text.fill || 'You fill the hole in.');
        } else if (job.kind === 'bury') {
            if (!tile._dug || tile._dug.kind !== 'hole') return;
            const body = job.corpse && InnerMapCombat._corpses.includes(job.corpse) ? job.corpse : this._bodyIn(job.q, job.r);
            if (!body) { this._note(game, '🕳️ Nothing to bury', 'There is no body to lay in it.'); return; }
            this._buryBody(game, tile, body, day);
        } else if (job.kind === 'exhume') {
            if (!tile._dug || tile._dug.kind !== 'grave') return;
            const g = tile._dug;
            // Someone still breathing down there: dug out alive (ui/innerMapDowned.js)
            const live = InnerMapDowned.liveAt(job.q, job.r);
            if (live) { InnerMapDowned.rescue(game, live, null); return; }
            // The marker comes down and back to the pack; the burial goes off the record (world/burials.js)
            const item = Burials.takeMarker(g, player, day);
            InnerMap.clearBurialMarker(job.q, job.r);
            Burials.unbury(game && game.world, InnerMap._burialHex(), job.q, job.r);
            this.setGround(tile, 'hole', { day });
            const body = g.body || { name: g.name || 'someone', type: 'villager', preset: null };
            InnerMapCombat.restoreBody(body, job.q, job.r, day);
            const back = item ? ` You pull up the marker and keep it (${item.replace(/_/g, ' ')}).` : '';
            this._note(game, '⛏️ Dug up', _fill(C.text.exhume || 'You dig {name} up.', { name: body.name }) + back, 'warning');
            if (item && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        }
    },

    /** Lay a body in the hole: a plain, unmarked mound of earth (on the world's record, world/burials.js). */
    _buryBody(game, tile, body, day) {
        const C = this.config();
        if (InnerMapCombat._carrying === body) this.drop();
        InnerMapCombat.removeBody(body);
        const g = Burials.bury(game && game.world, InnerMap._burialHex(), tile.q, tile.r, body, day, InnerMap._graveSettlement());
        if (g) InnerMap.layBurial(tile.q, tile.r, g, day);
        else this.setGround(tile, 'grave', { day, name: body.name, body: Burials.plainBody(body) });
        this._note(game, '⚰️ Buried', _fill(C.text.bury || 'You bury {name}.', { name: body.name }), 'info');
    },

    /**
     * Raise a grave marker on the burial at (q, r): walk beside it and set it
     * (choice from Burials.markerOptions: one from the pack, or a cross carved).
     */
    raiseMarker(game, q, r, choice) {
        if (!choice) return 'none';
        const secs = Number(choice.seconds) > 0 ? Number(choice.seconds) : 3;
        return this.start(game, 'mark', q, r, {
            seconds: secs,
            verb: choice.how === 'carve' ? 'Carving a cross' : VERB.mark,
            needs: {},
            onDone: (g) => this._raiseMarker(g, q, r, choice, (g.world && g.world.day) || 0),
        });
    },

    _raiseMarker(game, q, r, choice, day) {
        const world = game && game.world;
        const head = InnerMap.burialHeadFree(q, r);
        const res = Burials.placeMarker(world, game && game.player, InnerMap._burialHex(), q, r, choice, day, head);
        if (!res.success) { this._note(game, '🪦 No marker', res.reason, 'error'); return res; }
        InnerMap.layBurial(q, r, res.grave, day);
        this._note(game, '🪦 A grave', res.text, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, world);
        return res;
    },

    /** A body lying in the hole at (q, r), next to it, or carried by the player standing beside it. */
    _bodyIn(q, r) {
        const here = InnerMapCombat.corpsesHere();
        return here.find(c => c.q === q && c.r === r)
            || (InnerMapCombat._carrying && here.includes(InnerMapCombat._carrying) ? InnerMapCombat._carrying : null)
            || here.find(c => _cheb(c.q, c.r, q, r) <= 1)
            || null;
    },

    _rollFind(game) {
        const C = this.config();
        for (const f of C.finds || []) {
            if (Utils.random() >= (Number(f.chance) || 0)) continue;
            let gold = 0;
            if (Array.isArray(f.gold) && game && game.player) {
                gold = Utils.randInt(f.gold[0], f.gold[1]);
                game.player.gold = (game.player.gold || 0) + gold;
                if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
            }
            return _fill(f.text, { gold });
        }
        return null;
    },

    /** A word over a grave. */
    payRespects(game, q, r) {
        const d = this.dugAt(q, r);
        if (!d || d.kind !== 'grave') return;
        // (a grave with a marker, or a bare mound only you know is a grave)
        const day = (game && game.world && game.world.day) || 0;
        const marked = Burials.isLegible(d, day);
        const T = this.config().text;
        const lines = (marked ? T.respects : T.respectsMound || T.respects) || [];
        const years = GraveBook.yearsBetween(d.day, day);
        const line = lines.length ? lines[Math.floor(Utils.random() * lines.length)] : 'You stand a while by the grave.';
        this._note(game, marked ? '🕯️ A Grave' : '🕯️ A Burial Mound', _fill(line, { name: d.name || 'someone', years: `${years} year${years === 1 ? '' : 's'}` }));
    },

    /** Read a marked grave of the player's own (as a churchyard grave reads). */
    readGrave(game, q, r) {
        const d = this.dugAt(q, r);
        if (!d || d.kind !== 'grave') return;
        const day = (game && game.world && game.world.day) || 0;
        const m = Burials.markerNow(d, day);
        const title = m ? (GraveBook.markerDef(m) || {}).name || 'A Grave' : 'A Burial Mound';
        this._note(game, `🪦 ${title}`, Burials.readLines(d, game && game.world, day).join(' '));
    },

    /**
     * Change a tile's ground: bare earth (the grass stripped and re-edged
     * around it) with a hole, turned earth or a grave on it.
     */
    setGround(tile, kind, extra = {}) {
        const g = GROUND[kind];
        if (!tile || !g) return;
        // (the ground as it was before the spade: a burial mound left long enough grows back over to it, world/burials.js)
        if (!tile._dug && !tile._undug) tile._undug = { baseTerrain: tile.baseTerrain, subTerrain: tile.subTerrain ? { ...tile.subTerrain } : null, terrainDetail: tile.terrainDetail || null, tilled: !!tile._tilled };
        tile._dug = { kind, ...extra };
        // (the ground stays as it was — grass and all — and the turned soil is drawn over it, ragged-edged
        // (_soilPatch): no square of bare dirt. Tilled soil likewise keeps the ground under it.)
        const was = tile._undug;
        if (was && was.baseTerrain) { tile.baseTerrain = was.baseTerrain; tile.terrainDetail = was.terrainDetail || null; }
        tile._tilled = true;
        tile._cachedFill = null;
        tile._cachedOverlay = undefined;
        // (a burial is a nameless mound until a marker is raised over it: world/burials.js)
        tile.subTerrain = { ...g, name: kind === 'grave' ? Burials.label(tile._dug, extra.day || 0) || 'Burial Mound' : g.name };
        if (InnerMap.tiles) InnerMap._refreshGrassLayer(InnerMap.tiles);
    },

    // ══════════════════════════════════════════════
    // CARRYING A BODY
    // ══════════════════════════════════════════════

    /** Pick up a body: it comes along with the player (who walks slower). */
    carry(body) {
        if (!body) return;
        InnerMapCombat._carrying = body;
        body.moved = true;
        if (this._baseSpeed == null) this._baseSpeed = InnerMap._playerSpeed;
        InnerMap._playerSpeed = this._baseSpeed * (Number(this.config().carrySpeed) || 1);
    },

    /** Put the carried body down where the player stands. */
    drop() {
        const body = InnerMapCombat._carrying;
        InnerMapCombat._carrying = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
        if (body) { body.q = InnerMap.playerInnerQ; body.r = InnerMap.playerInnerR; }
        return body;
    },

    _updateCarry() {
        const body = InnerMapCombat._carrying;
        if (!body) return;
        // Leaving the street (a building, the world map): the body is left behind
        if (!InnerMap.active || body.key !== InnerMapCombat._mapKey() || !InnerMapCombat._corpses.includes(body)) {
            this.drop();
            return;
        }
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        // A fresh body bleeds on the ground behind it, a drop every few steps (systems/carrying.js)
        if ((body.q !== q || body.r !== r) && Carrying.drips(body, typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())) InnerMapCombat.dripBlood(body, body.q, body.r);
        body.q = q;
        body.r = r;
    },

    // ══════════════════════════════════════════════
    // RENDER — the ground features, under the sprites
    // ══════════════════════════════════════════════

    renderGround(ctx, camera, range, T) {
        if (!InnerMap.tiles || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = range;
        for (let r = Math.max(0, rMin); r <= Math.min(InnerMap.height - 1, rMax); r++) {
            const row = InnerMap.tiles[r];
            if (!row) continue;
            for (let q = Math.max(0, qMin); q <= Math.min(InnerMap.width - 1, qMax); q++) {
                const tile = row[q];
                if (!tile || !tile.visible) continue;
                const kind = tile._dug ? tile._dug.kind : (tile.subTerrain && tile.subTerrain.id === 'tilled_soil' ? 'tilled' : null);
                if (!kind) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                // (a burial of the player's: its mound and, wanting a standing one, its marker)
                if (kind === 'grave') this._drawBurial(ctx, tile._dug, s.x, s.y, ds, q, r);
                else this._drawFeature(ctx, kind, s.x, s.y, ds, q, r);
            }
        }
        // The work under way: a ring filling round the spot
        const job = this._job;
        if (job && job.t != null) {
            const s = camera.worldToScreenFast(job.q * T + T / 2, job.r * T + T / 2);
            ctx.save();
            ctx.lineWidth = Math.max(2, ds * 0.07);
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#f5c542';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress());
            ctx.stroke();
            ctx.restore();
        }
    },

    /** Is (q, r) tilled ground? */
    isTilledAt(q, r) {
        const t = InnerMap.getTile(q, r);
        return !!(t && ((t._dug && t._dug.kind === 'tilled') || (t.subTerrain && t.subTerrain.id === 'tilled_soil')));
    },

    /** Draw tilled ground at (q, r) ('dry' | 'wet', for watered ground), ragged-edged over the ground (ui/tilledSoil.js). */
    drawTilled(ctx, q, r, x, y, ds, which = 'dry') {
        return drawTilledSoil(ctx, (dq, dr) => this.isTilledAt(q + dq, r + dr), q, r, x, y, ds, which);
    },

    /** A grave sprite (world/graveArt.js), loaded, or null. */
    _graveImg(id) {
        if (!GraveArt.hasArt(id)) return null;
        const img = CustomObjects.getImage(GraveArt.path(id));
        return img && img.complete && img.naturalWidth ? img : null;
    },

    /**
     * A burial: the churchyard's fresh mound of turned earth (its painted art,
     * centred on the tile, fading as it settles), and its marker drawn at the
     * mound's head when none stands on the tile above (world/innerMap/graves.js).
     */
    _drawBurial(ctx, g, x, y, ds, q, r) {
        const day = InnerMap._burialDay ? InnerMap._burialDay() : (InnerMap.worldDay || 0);
        const P = Number(GraveBook.config().artTile) || 128;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.save();
        ctx.globalAlpha = Burials.moundAlpha(g, day);
        const mound = this._graveImg('grave_mound');
        // Fresh (burial.freshDays): bare, dark, damp turned earth with its clods — the churchyard's
        // grassed mound, flowers and all, only once it has weathered
        const fresh = !g.marker && (day - (Number(g.day) || 0)) < (Number((this.config().burial || {}).freshDays) || 30);
        if (fresh) {
            this._freshMound(ctx, x + ds / 2, y + ds / 2, ds, q, r);
        } else if (mound) {
            const w = mound.naturalWidth * ds / P, h = mound.naturalHeight * ds / P;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(mound, Math.floor(x + (ds - w) / 2), Math.floor(y + (ds - h) / 2), w, h);
        } else {
            // (the art still loading) a low heap of turned earth
            const cx = x + ds / 2, cy = y + ds / 2;
            const grad = ctx.createLinearGradient(cx - ds * 0.3, cy, cx + ds * 0.3, cy);
            grad.addColorStop(0, '#5e4229');
            grad.addColorStop(0.45, '#8a6845');
            grad.addColorStop(1, '#4e361f');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.28, ds * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        const m = Burials.markerNow(g, day);
        const head = InnerMap.getTile(q, r - 1);
        const standing = head && head._burialOf && head._burialOf.q === q && head._burialOf.r === r && head.customObject;
        if (m && !standing) {
            const img = this._graveImg(m);
            if (img) {
                // set into the head of the mound, a little smaller than a stone in the churchyard
                const k = 0.7;
                const w = img.naturalWidth * ds / P * k, h = img.naturalHeight * ds / P * k;
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(img, Math.floor(x + (ds - w) / 2), Math.floor(y + ds * 0.35 - h), w, h);
            } else {
                this._drawFeature(ctx, 'grave', x, y, ds, q, r);
            }
        }
        ctx.imageSmoothingEnabled = smooth;
    },

    /**
     * Turned soil over the ground: a ragged-edged patch (a hash of the tile shapes it), darker at its
     * heart, crumbs of earth scattered round its rim — so a dug spot blends into the grass about it.
     */
    _soilPatch(ctx, cx, cy, ds, q, r, rad = 0.48) {
        const h = (i) => ((((q * 73856093) ^ (r * 19349663) ^ (i * 83492791)) >>> 0) % 1000) / 1000;
        const n = 16;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = (i % n) / n * Math.PI * 2;
            const k = rad * (0.82 + 0.3 * h(i % n));
            const px = cx + Math.cos(a) * ds * k, py = cy + Math.sin(a) * ds * k * 0.92;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, ds * 0.05, cx, cy, ds * rad * 1.1);
        grad.addColorStop(0, '#4a3220');
        grad.addColorStop(0.75, '#5e4129');
        grad.addColorStop(1, 'rgba(94, 65, 41, 0.75)');
        ctx.fillStyle = grad;
        ctx.fill();
        // crumbs thrown out over the grass
        for (let i = 0; i < 10; i++) {
            const a = h(i + 40) * Math.PI * 2, d = ds * rad * (0.95 + 0.35 * h(i + 60));
            const s = Math.max(1.5, ds * (0.025 + 0.03 * h(i + 80)));
            ctx.fillStyle = i % 2 ? '#5a3d26' : '#3f2a19';
            ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.92, s, s * 0.8);
        }
        ctx.restore();
    },

    /**
     * A fresh grave: a long low heap of dark, damp, freshly turned earth on its soil patch —
     * lumpy, clods of earth on it and round it, a wet sheen here and there. No grass, no flowers.
     */
    _freshMound(ctx, cx, cy, ds, q, r) {
        const h = (i) => ((((q * 2654435761) ^ (r * 40503) ^ (i * 2246822519)) >>> 0) % 1000) / 1000;
        this._soilPatch(ctx, cx, cy + ds * 0.04, ds, q, r, 0.5);
        ctx.save();
        // its shadow, then the heap: a long rounded hump lying along the tile
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(cx + ds * 0.03, cy + ds * 0.1, ds * 0.32, ds * 0.44, 0, 0, Math.PI * 2);
        ctx.fill();
        const n = 18;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = (i % n) / n * Math.PI * 2;
            const k = 0.92 + 0.12 * h(i % n);
            const px = cx + Math.cos(a) * ds * 0.29 * k, py = cy + Math.sin(a) * ds * 0.42 * k;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const g = ctx.createLinearGradient(cx - ds * 0.3, cy - ds * 0.3, cx + ds * 0.3, cy + ds * 0.3);
        g.addColorStop(0, '#6b4a2e');
        g.addColorStop(0.4, '#55391f');
        g.addColorStop(1, '#2f1f12');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(25, 15, 8, 0.6)';
        ctx.lineWidth = Math.max(1, ds * 0.02);
        ctx.stroke();
        // the ridge along its top, and the spade's cuts across it
        ctx.strokeStyle = 'rgba(140, 105, 70, 0.35)';
        ctx.lineWidth = Math.max(1, ds * 0.025);
        ctx.beginPath();
        ctx.moveTo(cx - ds * 0.04, cy - ds * 0.34);
        ctx.quadraticCurveTo(cx - ds * 0.07, cy, cx - ds * 0.03, cy + ds * 0.32);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.45)';
        for (let i = 0; i < 4; i++) {
            const yy = cy - ds * 0.24 + i * ds * 0.15;
            ctx.beginPath();
            ctx.moveTo(cx - ds * 0.2, yy + ds * 0.02);
            ctx.lineTo(cx + ds * 0.18, yy - ds * 0.02 + h(i + 5) * ds * 0.03);
            ctx.stroke();
        }
        // clods, lit on top; a wet sheen
        for (let i = 0; i < 12; i++) {
            const a = h(i + 20) * Math.PI * 2, d = h(i + 30);
            const x = cx + Math.cos(a) * ds * 0.24 * d, y = cy + Math.sin(a) * ds * 0.36 * d;
            const s = Math.max(2, ds * (0.04 + 0.04 * h(i + 50)));
            ctx.fillStyle = i % 3 ? '#3b2716' : '#62452a';
            ctx.fillRect(Math.round(x), Math.round(y), s, s * 0.85);
            ctx.fillStyle = 'rgba(160, 125, 90, 0.35)';
            ctx.fillRect(Math.round(x), Math.round(y), s, Math.max(1, s * 0.3));
        }
        ctx.fillStyle = 'rgba(200, 210, 220, 0.12)';
        ctx.beginPath();
        ctx.ellipse(cx - ds * 0.1, cy - ds * 0.12, ds * 0.06, ds * 0.03, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    _drawFeature(ctx, kind, x, y, ds, q, r) {
        const cx = x + ds / 2, cy = y + ds / 2;
        const jitter = (((q * 7919) ^ (r * 104729)) >>> 0) % 7 / 7;
        ctx.save();
        // Holes, filled earth: their turned soil, ragged-edged over the ground (no square of dirt)
        if (kind === 'hole' || kind === 'filled') this._soilPatch(ctx, cx, cy, ds, q, r, kind === 'hole' ? 0.5 : 0.44);
        if (kind === 'hole') {
            // The spoil heap, then the dark pit
            ctx.fillStyle = '#7a5a3a';
            ctx.beginPath();
            ctx.ellipse(cx + ds * 0.3, cy + ds * 0.3, ds * 0.22, ds * 0.14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#5a3f26';
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.42, ds * 0.34, 0, 0, Math.PI * 2);
            ctx.fill();
            const g = ctx.createRadialGradient(cx, cy + ds * 0.04, ds * 0.04, cx, cy, ds * 0.34);
            g.addColorStop(0, '#0d0805');
            g.addColorStop(1, '#2a1b10');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.03, ds * 0.34, ds * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (kind === 'tilled' && this.drawTilled(ctx, q, r, x, y, ds)) {
            // Ploughed ground, from the plowed-soil sheet, its edges by the ground tilled round it
        } else if (kind === 'tilled') {
            // (the sheet still loading) dark turned soil in furrows
            const sz = Math.ceil(ds) + 1;
            ctx.fillStyle = 'rgba(78, 52, 30, 0.55)';
            ctx.fillRect(x, y, sz, sz);
            const rows = 4;
            for (let i = 0; i < rows; i++) {
                const fy = y + (i + 0.5) * sz / rows;
                ctx.fillStyle = 'rgba(40, 24, 12, 0.6)';
                ctx.fillRect(x + sz * 0.06, fy, sz * 0.88, Math.max(1, sz * 0.07));
                ctx.fillStyle = 'rgba(150, 112, 74, 0.45)';
                ctx.fillRect(x + sz * 0.06, fy - Math.max(1, sz * 0.05), sz * 0.88, Math.max(1, sz * 0.04));
            }
        } else if (kind === 'filled') {
            ctx.fillStyle = 'rgba(70, 48, 28, 0.55)';
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.4, ds * 0.32, jitter, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(40, 26, 14, 0.5)';
            for (let i = 0; i < 4; i++) {
                const a = jitter * 6 + i * 1.7;
                ctx.fillRect(cx + Math.cos(a) * ds * 0.2, cy + Math.sin(a) * ds * 0.15, ds * 0.06, ds * 0.05);
            }
        } else if (kind === 'grave') {
            // A raised mound with a wooden marker at its head
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.1, ds * 0.36, ds * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            const g = ctx.createLinearGradient(cx - ds * 0.3, cy, cx + ds * 0.3, cy);
            g.addColorStop(0, '#5e4229');
            g.addColorStop(0.45, '#8a6845');
            g.addColorStop(1, '#4e361f');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.06, ds * 0.3, ds * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
            const w = Math.max(2, ds * 0.07);
            ctx.fillStyle = '#6b4a2b';
            ctx.strokeStyle = '#2b1a0c';
            ctx.lineWidth = Math.max(1, ds * 0.02);
            ctx.fillRect(cx - w / 2, cy - ds * 0.62, w, ds * 0.42);
            ctx.strokeRect(cx - w / 2, cy - ds * 0.62, w, ds * 0.42);
            ctx.fillRect(cx - ds * 0.14, cy - ds * 0.52, ds * 0.28, w);
            ctx.strokeRect(cx - ds * 0.14, cy - ds * 0.52, ds * 0.28, w);
        }
        ctx.restore();
    },

    /** The player's swing while working, facing the spot (null when not at work). */
    playerAnim() {
        const job = this._job;
        if (!job || job.t == null) return null;
        const dq = job.q - InnerMap.playerInnerQ;
        const dr = job.r - InnerMap.playerInnerR;
        return { anim: 'slash', direction: InnerMapCharacters.getDirection(dq, dr) };
    },

    /** What the work is called, for the HUD line. */
    label() {
        const j = this._job;
        return j && j.t != null ? j.verb || VERB[j.kind] || 'Working' : null;
    },
};
