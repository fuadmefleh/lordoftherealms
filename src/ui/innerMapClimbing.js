// ============================================================
// INNER MAP — climbing the crags, and the body's skills told
// ============================================================
// The crags' faces (world/innerMap/climbing.js) can be climbed by the player
// as far as their Climbing skill reaches (player/climbing.js): click a crag's
// top, or a face, and the path goes up it — or right-click a face and Climb
// Up / Climb Down. Each frame this tells the map how tall a face the player
// can take on now (InnerMap._climbMax: 0 when too spent or laden), picks up a
// climb the walk has come to (InnerMap._climbRequest), and plays it out: the
// player on the rock facing it (the LPC Climb sheet), row by row, then at the
// far end — or, if they slip, dropping to the foot, hurt. Climbing XP and a
// level-up are told when they get there.
//
// Endurance (player/endurance.js): each tile walked here is a little XP
// (onStep); level-ups queued from anywhere (walking, labour, the world map's
// miles) are told by flushSkillUps, called each frame on either map.

import { InnerMap } from '../world/innerMap.js';
import { Climbing } from '../player/climbing.js';
import { Endurance } from '../player/endurance.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';

const FALL_SECONDS = 0.35;

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _ctx(game) {
    const at = InnerMap.currentWorldTile;
    const world = game && game.world;
    return { world, worldTile: world && at ? world.getTile(at.q, at.r) : null };
}

export const InnerMapClimbing = {
    _refusal: null,

    /** Is the player on the rock? */
    isClimbing() {
        return !!InnerMap._climb;
    },

    /** Each frame on the inner map, before the walk is advanced. */
    update(dt, game) {
        const player = game && game.player;
        if (!player || !InnerMap.active) return;
        // How tall a face may the player take on now?
        const ctx = _ctx(game);
        const ok = InnerMap._insideBuilding ? { ok: false, reason: null } : Climbing.canClimb(player, 0, ctx);
        InnerMap._climbMax = ok.ok ? Climbing.maxRows(player, ctx.world, ctx.worldTile) : 0;
        InnerMap._climbPathCost = Climbing.config().pathCost;
        this._refusal = ok.ok ? null : ok.reason;

        const c = InnerMap._climb;
        if (c && c.tiles !== InnerMap.tiles) InnerMap.abandonClimb();
        if (!InnerMap._climb && InnerMap._climbRequest) this.begin(game, InnerMap._climbRequest);
        if (InnerMap._climb) this._advance(dt, game);
        this.flushSkillUps(game);
    },

    /** Start up (or down) a face. → true when under way */
    begin(game, link) {
        const player = game.player;
        InnerMap._climbRequest = null;
        const ctx = _ctx(game);
        const can = Climbing.canClimb(player, link.rows, ctx);
        if (!can.ok) {
            InnerMap.cancelPlayerWalk();
            _note(game, '🧗 Can\'t Climb', can.reason, 'warning');
            return false;
        }
        const plan = Climbing.plan(player, { rows: link.rows, down: !link.up, ...ctx });
        InnerMap._climb = { link, plan, elapsed: 0, duration: plan.duration, tiles: InnerMap.tiles, falling: false, fallT: 0, fallDuration: FALL_SECONDS };
        InnerMapRenderer._playerFacing = InnerMapCharacters.DIR_UP;
        if (!player._climbedBefore) {
            Object.defineProperty(player, '_climbedBefore', { value: true, configurable: true, enumerable: false, writable: true });
            _note(game, '🧗 Climbing', `You find a hold and ${link.up ? 'start up' : 'lower yourself down'} the face — ${link.rows} rows of rock. Taller faces, and winter, take more skill; tired or laden, you won't try.`, 'info');
        }
        return true;
    },

    _advance(dt, game) {
        const c = InnerMap._climb;
        const slip = c.plan.slip;
        if (c.falling) {
            c.fallT += dt;
            if (c.fallT >= c.fallDuration) this._complete(game, true);
            return;
        }
        c.elapsed += dt;
        if (slip && c.elapsed >= slip.at * c.duration) {
            const p = InnerMap._climbPos();
            c.elapsed = slip.at * c.duration;
            c.slipX = p.x;
            c.slipY = p.y;
            c.falling = true;
            return;
        }
        if (c.elapsed >= c.duration) this._complete(game, false);
    },

    _complete(game, fell) {
        const c = InnerMap._climb;
        const l = c.link;
        const foot = l.up ? { q: l.fromQ, r: l.fromR } : { q: l.toQ, r: l.toR };
        const end = fell ? foot : { q: l.toQ, r: l.toR };
        InnerMap.finishClimb(end.q, end.r, fell);
        const player = game.player;
        const res = Climbing.finish(player, c.plan);
        for (const n of res.notices.slice(0, 2)) _note(game, `${n.icon} ${n.title}`, n.text, n.type);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        if (player.health <= 0 && typeof game._triggerDeath === 'function') {
            setTimeout(() => game._triggerDeath('a fall'), 0);
        }
    },

    /** The player took a step on the map: a little Endurance for the miles. */
    onStep(game) {
        const player = game && game.player;
        if (!player || InnerMap._climb || (typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming())) return;
        Endurance.walked(player, 'step', 1);
    },

    /** Tell the body skills' level-ups queued from anywhere (player._skillUps). */
    flushSkillUps(game) {
        const player = game && game.player;
        for (const up of Endurance.takeQueued(player)) _note(game, `${up.icon} ${up.name} Improved`, up.text, 'success');
    },

    // ══════════════════════════════════════════════
    // THE MENU
    // ══════════════════════════════════════════════

    /** Climb entries for a right-clicked tile: a face (up it or down it). */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || !tile || !InnerMap.isCliffFace(tile)) return [];
        const to = InnerMap.climbTargetFor(q, r);
        if (!to) return [];
        const up = InnerMap.standLevel(InnerMap.getTile(to.q, to.r)) > InnerMap.playerLevel();
        // the face's height
        let r0 = r, r1 = r;
        while (InnerMap.isCliffFace(InnerMap.getTile(q, r0 - 1))) r0--;
        while (InnerMap.isCliffFace(InnerMap.getTile(q, r1 + 1))) r1++;
        const rows = r1 - r0 + 1;
        const label = up ? 'Climb Up' : 'Climb Down';
        const ctx = _ctx(game);
        const can = Climbing.canClimb(game.player, rows, ctx);
        if (!can.ok) return [{ type: 'disabled', label: `🧗 ${label} — ${can.reason}` }];
        const chance = Math.round(Climbing.slipChance(game.player, rows, ctx.world, ctx.worldTile) * 100);
        return [{
            type: 'action', action: 'climb_face', icon: '🧗', label,
            desc: `${rows} rows of rock${chance > 0 ? ` · ${chance}% chance to slip` : ''}`,
        }];
    },

    /** Run a climb entry. → true when handled */
    handle(game, item, q, r) {
        if (!item || item.action !== 'climb_face') return false;
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(q, r);
        if (!walk || !walk.started) _note(game, '🧗 No Way Up', this._refusal || 'You can\'t find a way to that face from here.', 'warning');
        return true;
    },
};
