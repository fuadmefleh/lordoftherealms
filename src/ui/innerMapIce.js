// ============================================
// INNER MAP ICE — skating, falls and the plunge: the game loop's side
// ============================================
// Once a frame on the street map (from ui/innerMapSeasons.js update):
//   - tells the map what the player brings onto the ice (InnerMap._iceGear:
//     the best skates in the packs, how laden, a cart in hand — read by
//     world/innerMap/ice.js for the glide, the slips and the crack's odds),
//     and lets the seconds pass for one down after a fall (_iceTick);
//   - in ice-cold water (a hole broken through, or any swim where the water
//     has frozen over) the cold bites by the second (player/icyWater.js
//     tick) until they climb out at the hole's edge or the bank; out after
//     more than a moment, a chill;
//   - the ice's events (onEvent, handed on by innerMapSeasons.js): a slip, a
//     horse balking at thin ice (the walk stopped), thin ice creaking, the
//     ice giving way — told, with a sound and the marks of it drawn
//     (ui/innerMapLayers/ice.js reads _fx and the skate trail).
//   - drawFallen: the player down on the ice (ui/innerMapLayers/entities.js).

import { InnerMap } from '../world/innerMap.js';
import { PlayerInventory } from '../core/inventory.js';
import { IcyWater } from '../player/icyWater.js';
import { StreetSeasons } from '../world/streetSeasons.js';
import { audioManager } from '../systems/audio.js';

const T = 32;
const TRAIL = 90;

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _show(game, n, type = 'info') {
    if (!n || !game || !game.ui || typeof game.ui.showNotification !== 'function') return;
    game.ui.showNotification(n.title, n.text, type);
}

/** A notice from data/streetSeasons.json `notices`. */
function _note(key, vars = {}) {
    const n = (StreetSeasons.config().notices || {})[key];
    if (!n) return null;
    const fill = s => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return { title: fill(n[0]), text: fill(n[1]) };
}

function _sfx(type) {
    try { audioManager.playSFX(type); } catch { /* sound is best-effort */ }
}

export const InnerMapIce = {
    /** Seconds in ice-cold water this time in (0 out of it). */
    _inSecs: 0,
    _deathSent: false,
    _balkAt: 0,
    _skatesTold: null,
    /** What the layer draws: { crack: { q, r, at }, splash: { q, r, at }, fall: { at } } (performance.now ms) */
    _fx: { crack: null, splash: null, fall: null },
    /** The skate marks: a ring of { x, y, at } in world px. */
    _trail: [],
    _trailTiles: null,

    /** What the player brings onto the ice. */
    gear(game) {
        const player = game && game.player;
        if (!player) return null;
        let laden = 0;
        try {
            const cap = PlayerInventory.getCapacity(player);
            laden = cap > 0 ? PlayerInventory.getUsedSlots(player) / cap : 0;
        } catch { laden = 0; }
        const carts = typeof InnerMap.streetCarts === 'function' ? InnerMap.streetCarts() : [];
        const cart = carts.some(c => c && (c.pusher === 'player' || c.driver === 'player'));
        return { skates: IcyWater.bestSkates(player), laden, cart };
    },

    update(game, dt) {
        if (!InnerMap.active || !game) return;
        const sec = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 1 / 60;
        InnerMap._iceGear = this.gear(game);
        if (InnerMap._iceTick) InnerMap._iceTick(sec);
        if (InnerMap.tiles !== this._trailTiles) { this._trail.length = 0; this._trailTiles = InnerMap.tiles; this._skatesTold = null; }
        this._coldWater(game, sec);
        this._trackSkates(game);
    },

    /** Ice-cold water: the cold by the second, and out of it a chill. */
    _coldWater(game, sec) {
        const player = game.player;
        if (!player) return;
        const ss = InnerMap._ss;
        const icy = !!(ss && ss.frozenCells > 0) && !InnerMap._insideBuilding && !InnerMap._aboardBoat
            && typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming();
        if (icy) {
            const res = IcyWater.tick(player, sec, this._inSecs);
            this._inSecs += sec;
            for (const n of res.notices) _show(game, n, 'error');
            if (typeof game.ui.updateStats === 'function' && Math.floor(this._inSecs) !== Math.floor(this._inSecs - sec)) game.ui.updateStats(player, game.world);
            if (res.dead && !this._deathSent && typeof game._triggerDeath === 'function') {
                this._deathSent = true;
                InnerMap.cancelPlayerWalk();
                setTimeout(() => { this._deathSent = false; game._triggerDeath('the cold'); }, 0);
            }
            return;
        }
        if (this._inSecs > 0) {
            const secs = this._inSecs;
            this._inSecs = 0;
            const res = IcyWater.out(player, game.world, secs);
            for (const n of res.notices) _show(game, n, res.ailment ? 'warning' : 'info');
            if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        }
    },

    /** The skate marks behind a skater, and the skates told once a map. */
    _trackSkates(game) {
        const s = InnerMap._skate;
        const gear = InnerMap._iceGear;
        if (!s || !gear || !gear.skates || !InnerMap._playerWalking || s.v <= 1.02) return;
        const t = InnerMap.tiles && InnerMap.tiles[InnerMap.playerInnerR] && InnerMap.tiles[InnerMap.playerInnerR][InnerMap.playerInnerQ];
        if (!t || t._iced !== 2) return;
        if (this._skatesTold !== gear.skates) {
            this._skatesTold = gear.skates;
            _show(game, _note('skates', { skates: String(gear.skates).replace(/_/g, ' ') }), 'info');
        }
        const pos = InnerMap.getPlayerWorldPos();
        const last = this._trail[this._trail.length - 1];
        if (last && Math.hypot(last.x - pos.x, last.y - pos.y) < 5) return;
        this._trail.push({ x: pos.x, y: pos.y + T * 0.15, at: _now(), cut: !last || Math.hypot(last.x - pos.x, last.y - pos.y) > T * 1.5 });
        if (this._trail.length > TRAIL) this._trail.shift();
    },

    /** One of the ice's events (from innerMapSeasons.js, which tells crack and thin itself). */
    onEvent(game, ev) {
        if (!ev || !game) return;
        const now = _now();
        const player = game.player;
        switch (ev.kind) {
            case 'thin':
                this._fx.crack = { q: ev.q, r: ev.r, at: now };
                _sfx('ice_crack');
                break;
            case 'crack': {
                this._fx.crack = null;
                this._fx.splash = { q: ev.q, r: ev.r, at: now };
                _sfx('ice_break');
                const res = IcyWater.plunge(player);
                _show(game, res.notice, 'error');
                if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
                break;
            }
            case 'slip': {
                this._fx.fall = { at: now, dir: InnerMap._skate ? { dq: InnerMap._skate.dq, dr: InnerMap._skate.dr } : null };
                _sfx('ice_thump');
                const res = IcyWater.fall(player);
                _show(game, res.notice, 'warning');
                if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
                if (player && player.health <= 0 && typeof game._triggerDeath === 'function') setTimeout(() => game._triggerDeath('a fall'), 0);
                break;
            }
            case 'balk':
                InnerMap.cancelPlayerWalk();
                if (now - this._balkAt > 4000) {
                    this._balkAt = now;
                    _show(game, _note('balk'), 'warning');
                }
                break;
            default:
                break;
        }
    },

    /** Is the player down on the ice now (for the draw)? → 0..1 how far into the fall, or null. */
    fallen() {
        if (!(InnerMap._iceDown > 0) || !this._fx.fall) return null;
        const age = (_now() - this._fx.fall.at) / 1000;
        return Math.max(0, age);
    },

    /**
     * The player down on the ice (ui/innerMapLayers/entities.js): the body tipped over
     * on its side, then pushing back up as the fall wears off. drawBody(ctx, x, y, w, h).
     */
    drawFallen(ctx, drawBody, px, py, ds, charW, charH) {
        const age = this.fallen();
        if (age == null) return false;
        const left = Math.max(0, InnerMap._iceDown);
        // over in a quarter second; up again over the last half second
        const down = Math.min(1, age / 0.25) * Math.min(1, left / 0.5);
        const side = this._fx.fall.dir && this._fx.fall.dir.dq < 0 ? -1 : 1;
        ctx.save();
        ctx.translate(px, py + ds * 0.15);
        ctx.beginPath();
        ctx.ellipse(0, 0, charW * (0.2 + 0.25 * down), ds * 0.07, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();
        ctx.rotate(side * down * Math.PI * 0.45);
        drawBody(ctx, -charW / 2, -charH + ds * 0.15, charW, charH);
        ctx.restore();
        return true;
    },
};
