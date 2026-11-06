// ============================================
// INNER MAP DIGGING — holes, filled earth and graves on the street map
// ============================================
// Digging changes the ground itself: the tile turns to bare earth (the grass
// is stripped and re-edged), a hole is dug into it (impassable, the spoil
// heaped beside it), and it can be filled in again or made a grave.
//
//   dig    — any bare outdoor ground: a hole (and sometimes something in it)
//   fill   — a hole: turned earth again, walkable
//   bury   — a hole with a body in it, next to it or carried: a grave
//   exhume — a grave: a hole again, with the body lying in it
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
    grave: { id: 'grave', name: 'Grave', icon: '⚰️', color: '#6b5034', passable: true },
};

const VERB = { dig: 'Digging', fill: 'Filling in', bury: 'Burying', exhume: 'Digging up' };

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
            this.setGround(tile, 'hole', { day });
            const body = g.body || { name: g.name || 'someone', type: 'villager', preset: null };
            InnerMapCombat.restoreBody(body, job.q, job.r, day);
            this._note(game, '⛏️ Dug up', _fill(C.text.exhume || 'You dig {name} up.', { name: body.name }), 'warning');
        }
    },

    _buryBody(game, tile, body, day) {
        const C = this.config();
        if (InnerMapCombat._carrying === body) this.drop();
        InnerMapCombat.removeBody(body);
        this.setGround(tile, 'grave', { day, name: body.name, body });
        this._note(game, '⚰️ Buried', _fill(C.text.bury || 'You bury {name}.', { name: body.name }), 'info');
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
        const lines = this.config().text.respects || [];
        const line = lines.length ? lines[Math.floor(Utils.random() * lines.length)] : 'You stand a while by the grave.';
        this._note(game, '⚰️ A grave', _fill(line, { name: d.name || 'someone' }));
    },

    /**
     * Change a tile's ground: bare earth (the grass stripped and re-edged
     * around it) with a hole, turned earth or a grave on it.
     */
    setGround(tile, kind, extra = {}) {
        const g = GROUND[kind];
        if (!tile || !g) return;
        tile._dug = { kind, ...extra };
        tile.baseTerrain = 'dirt';
        tile._tilled = true;
        tile._cachedFill = null;
        tile._cachedOverlay = undefined;
        // (tilled soil keeps the ground under it, the soil drawn over it soft-edged; a hole or grave is bare earth)
        if (kind !== 'tilled') tile.terrainDetail = null;
        tile.subTerrain = { ...g, name: kind === 'grave' && extra.name ? `Grave of ${extra.name}` : g.name };
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
        body.q = InnerMap.playerInnerQ;
        body.r = InnerMap.playerInnerR;
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
                this._drawFeature(ctx, kind, s.x, s.y, ds, q, r);
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

    _drawFeature(ctx, kind, x, y, ds, q, r) {
        const cx = x + ds / 2, cy = y + ds / 2;
        const jitter = (((q * 7919) ^ (r * 104729)) >>> 0) % 7 / 7;
        ctx.save();
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
