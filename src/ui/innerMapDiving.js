// ============================================================
// INNER MAP — diving to the bottom of the water
// ============================================================
// Right-click water deep enough to swim in (world/innerMap/swimming.js):
// a Quick Dive, a full Dive, or Push Your Breath past its end. The player
// swims out to the spot if not there already, then goes under: hidden below
// the surface, a stream of bubbles where they went down and a ring for the
// breath running out (drawn by ui/innerMapLayers/entities.js through
// drawUnder). Walking off cuts the dive short, with what was found so far.
// What a dive brings up and costs is player/diving.js; tables in
// data/diving.json. A spot dived the same day yields less (tile._dived), and
// the bottom by a wreck (world/innerMap/harbour.js marks where she sank,
// tile._wreckSite) hides more treasure.

import { InnerMap } from '../world/innerMap.js';
import { Diving } from '../player/diving.js';
import { Hotbar } from './hotbar.js';

const LENGTHS = ['quick', 'full', 'push'];

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _worldTile(game) {
    const at = InnerMap.currentWorldTile;
    return game && game.world && at ? game.world.getTile(at.q, at.r) : null;
}

export const InnerMapDiving = {
    // { q, r, length, t, total, breathAt, game }
    _job: null,

    /** Water at (q, r) a body can dive in: swimmable, not shallows you stand in. */
    canDiveAt(tile, q, r) {
        return !!(tile && tile.subTerrain && !tile.subTerrain.passable && InnerMap.isSwimmable(q, r));
    },

    /** Is there wreckage on or under the water near (q, r)? */
    nearWreck(q, r) {
        const R = Math.max(0, Diving.config().wreckRange | 0);
        for (let dr = -R; dr <= R; dr++) {
            for (let dq = -R; dq <= R; dq++) {
                const t = InnerMap.getTile(q + dq, r + dr);
                if (t && (t._wreckSite || (t.groundItem && t.groundItem.placedBy === 'wreck'))) return true;
            }
        }
        return false;
    },

    /** Dives at this spot today. */
    picked(tile, day) {
        const d = tile && tile._dived;
        return d && d.day === day ? d.n : 0;
    },

    /** The Dive entries for a water tile. */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || !this.canDiveAt(tile, q, r)) return [];
        if (this._job) return [{ type: 'disabled', label: '🤿 Under the water…' }];
        const ok = Diving.canDive(game.player);
        if (!ok.ok) return [{ type: 'disabled', label: `🤿 Dive — ${ok.reason}` }];
        const C = Diving.config();
        const water = Diving.waterOf(tile);
        const where = `${water.deep ? 'deep ' : ''}${water.kind}`;
        return LENGTHS.map(length => {
            const p = Diving.plan(game.player, length);
            const L = C.lengths[length] || {};
            const desc = `${L.desc || 'Down to the bottom'} (${p.bottom}s down, breath ${p.breath}s; the ${where} floor)`;
            return { type: 'action', action: 'dive_' + length, length, label: L.label || 'Dive', icon: L.icon || '🤿', desc };
        });
    },

    /** Carry out a dive_* action at (q, r). Returns true when it was one. */
    handle(game, item, q, r) {
        const m = /^dive_(\w+)$/.exec(item.action || '');
        if (!m) return false;
        const length = LENGTHS.includes(m[1]) ? m[1] : 'full';
        const tile = InnerMap.getTile(q, r);
        if (!this.canDiveAt(tile, q, r)) { _note(game, '🤿 Dive', 'There is no water deep enough to dive here.', 'warning'); return true; }
        const ok = Diving.canDive(game.player);
        if (!ok.ok) { _note(game, '🤿 Dive', ok.reason, 'warning'); return true; }
        if (InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r && !InnerMap._playerWalking) {
            this.start(game, q, r, length);
            return true;
        }
        // Swim out to the spot first
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(q, r);
        if (walk && walk.started) {
            InnerMap._pendingAction = { q, r, run: () => this.start(game, q, r, length) };
        } else {
            _note(game, '🤿 Dive', (walk && walk.refused) || 'You can\'t swim out to that spot.', 'warning');
        }
        return true;
    },

    /** Go under at (q, r), where the player is. */
    start(game, q, r, length) {
        if (InnerMap.playerInnerQ !== q || InnerMap.playerInnerR !== r) return false;
        const p = Diving.plan(game.player, length);
        this._job = {
            q, r, length, t: 0, total: p.realSeconds,
            breathAt: Math.min(1, p.breath / Math.max(1, p.bottom)),
            game,
        };
        InnerMap._diving = this._job;
        if (!game.player.dives) _note(game, '🤿 Under', 'You fill your lungs and go down, feeling along the bottom for anything worth the taking.');
        return true;
    },

    /** Is the player under the water? (the renderer hides them) */
    isUnder() {
        return !!this._job;
    },

    cancel() {
        this._job = null;
        InnerMap._diving = null;
    },

    /** Each frame, from the game loop. */
    update(deltaTime, game) {
        const job = this._job;
        if (!job) return;
        if (!InnerMap.active || InnerMap._insideBuilding) { this.cancel(); return; }
        // Swimming off cuts the dive short: up with what you have
        if (InnerMap._playerWalking || InnerMap.playerInnerQ !== job.q || InnerMap.playerInnerR !== job.r) {
            this._surface(game || job.game, job, Math.min(1, job.t / job.total));
            return;
        }
        job.t += deltaTime;
        if (job.t >= job.total) this._surface(game || job.game, job, 1);
    },

    /** Back up: the dive's finds and costs (player/diving.js), told. */
    _surface(game, job, fraction) {
        this.cancel();
        const player = game && game.player;
        if (!player) return;
        const tile = InnerMap.getTile(job.q, job.r);
        const water = Diving.waterOf(tile);
        const day = (game.world && game.world.day) || 0;
        const res = Diving.dive(player, game.world, _worldTile(game), {
            kind: water.kind, deep: water.deep, length: job.length, fraction,
            nearWreck: this.nearWreck(job.q, job.r), picked: this.picked(tile, day),
        });
        if (tile) tile._dived = { day, n: this.picked(tile, day) + 1 };
        InnerMap.passHours(Math.max(1, res.plan.minutes * Math.max(0.3, fraction)) / 60);
        this._tell(game, res, fraction);
        if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        if (res.drowned && typeof game._triggerDeath === 'function') {
            InnerMap.cancelPlayerWalk();
            setTimeout(() => game._triggerDeath('drowning'), 0);
        }
    },

    _tell(game, res, fraction) {
        if (res.drowned) {
            _note(game, '🌊 Drowned', 'You stayed down too long. The light above goes out.', 'error');
            return;
        }
        if (res.blackout) {
            _note(game, '🫧 Blacked Out', 'The dark closes in. You come to at the surface, coughing up water, your hands empty.', 'error');
            return;
        }
        const list = res.finds.map(f => (f.gold ? `${f.icon} ${f.name} (${f.gold} gold)` : `${f.icon} ${f.name}${f.qty > 1 ? ` ×${f.qty}` : ''}`));
        const cut = fraction < 1 ? 'You come up early. ' : '';
        if (!list.length) {
            _note(game, '🤿 Nothing', `${cut}Silt, weed and stones: nothing worth bringing up.`, 'info');
        } else {
            _note(game, '🤿 From the Bottom', `${cut}You surface with ${list.join(', ')}.`, 'success');
        }
        for (const f of res.finds.filter(x => x.rare)) {
            _note(game, '✨ Treasure!', `${f.text || 'Something precious in the silt'}: ${f.icon} ${f.name}${f.gold ? ` (${f.gold} gold)` : ''}.`, 'success');
        }
        const dropped = Object.keys(res.dropped);
        if (dropped.length) _note(game, '🎒 Packs Full', `You have no room for ${dropped.join(', ').replace(/_/g, ' ')}, and let it sink again.`, 'warning');
        if (res.plan.over > 0 && fraction >= 1) _note(game, '🫁 Lungs Burning', `You stayed down past your breath and come up gasping (−${Math.round(res.hurt)} health).`, 'warning');
        else if (res.cold) _note(game, '🥶 Freezing Water', 'The cold down there bites to the bone.', 'warning');
    },

    /**
     * The player under the water (ui/innerMapLayers/entities.js, in place of the
     * swimmer): bubbles rising where they went down, and a ring round the spot
     * for the breath they have left: pale while it lasts, red past it.
     */
    drawUnder(ctx, px, py, ds, now) {
        const job = this._job;
        if (!job) return;
        const p = Math.min(1, job.t / Math.max(0.01, job.total));
        const waterY = py - ds * 0.3;
        ctx.save();
        // A dark shape under the surface
        ctx.fillStyle = 'rgba(10, 30, 50, 0.28)';
        ctx.beginPath();
        ctx.ellipse(px, waterY + ds * 0.08, ds * 0.22, ds * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        // Bubbles: a few at a time, rising and fading
        for (let i = 0; i < 6; i++) {
            const phase = (now * 0.9 + i / 6) % 1;
            const x = px + Math.sin(now * 2.3 + i * 1.7) * ds * 0.1 + (i % 3 - 1) * ds * 0.05;
            const y = waterY - phase * ds * 0.45;
            const rad = Math.max(1, ds * (0.025 + (i % 3) * 0.012) * (0.6 + phase * 0.6));
            ctx.strokeStyle = `rgba(235, 248, 255, ${0.85 * (1 - phase)})`;
            ctx.lineWidth = Math.max(1, ds / 40);
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.stroke();
        }
        // The ring on the water, widening
        const rp = (now * 0.8) % 1;
        ctx.strokeStyle = `rgba(230, 245, 255, ${0.55 * (1 - rp)})`;
        ctx.lineWidth = Math.max(1, ds / 24);
        ctx.beginPath();
        ctx.ellipse(px, waterY, ds * (0.15 + rp * 0.3), ds * (0.05 + rp * 0.1), 0, 0, Math.PI * 2);
        ctx.stroke();
        // The breath ring
        const R = ds * 0.42, cy = py - ds * 0.1;
        ctx.lineWidth = Math.max(2, ds * 0.06);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(px, cy, R, 0, Math.PI * 2);
        ctx.stroke();
        const past = p > job.breathAt;
        ctx.strokeStyle = past ? '#e74c3c' : '#8fd3ff';
        ctx.beginPath();
        ctx.arc(px, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();
        if (job.breathAt < 1) {
            // Where the breath runs out
            const a = -Math.PI / 2 + Math.PI * 2 * job.breathAt;
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath();
            ctx.arc(px + Math.cos(a) * R, cy + Math.sin(a) * R, Math.max(2, ds * 0.04), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },
};
