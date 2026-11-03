// ============================================
// INNER MAP REACTIONS — the street reacts when the player turns violent
// ============================================
// The UI half of systems/streetCrime.js. When the player starts beating
// someone (assault) or kills them (murder) on the inner map:
//
//   - the witnesses are chosen (StreetCrime.selectWitnesses) and the deed
//     recorded (StreetCrime.record: rumour, heat, karma, memories);
//   - each witness reacts on the spot (StreetCrime.reactionFor): a bark over
//     their head, then they flee to the edge of the map, cower where they
//     stand, stand and shout, come at the player (kin), or run to arrest
//     (guards, who also come running from out of sight);
//   - a guard who reaches the player opens the watch's choice scene
//     (ui/actionMenu/streetWatch.js);
//   - arriving in a town where an unanswered crime is still remembered, the
//     nearest guard comes for the player.
//
// Barks are drawn over the NPCs after the sprites (render, called from
// InnerMapCombat.render).

import { InnerMap } from '../world/innerMap.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Duels } from '../systems/duels.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { ActionMenu } from './actionMenu.js';
import { NpcDialog } from './npcDialog.js';
import { labelZoom, textPx } from './mapInk.js';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _dist(aq, ar, bq, br) {
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br));
}

export const InnerMapReactions = {
    // npc.id → { mode: 'fight'|'arrest', until, repath, incidentId, speed, confronted }
    _responders: new Map(),
    // npcs given a burst of speed to flee: npc.id → original speed
    _fleeing: new Map(),
    _visitKey: null,
    _lastTick: 0,
    _arrivalAt: 0,
    _arrivalChecked: true,

    /**
     * The player has harmed `victim`: pick the witnesses, record the crime,
     * and set the street reacting. Returns StreetCrime.record's result plus
     * the witnesses.
     */
    onViolence(game, victim, crime) {
        if (!game || !game.player || !victim || !InnerMap.active) return null;
        const C = StreetCrime.config();
        const player = game.player;
        const world = game.world;
        const day = (world && world.day) || 0;
        const scene = { q: victim.q, r: victim.r, indoors: !!InnerMap._insideBuilding };
        const npcs = InnerMap.npcs || [];
        const witnesses = StreetCrime.selectWitnesses(npcs, scene, victim);
        let playerAttack = 0;
        try { playerAttack = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true }).attack; } catch (e) { playerAttack = 0; }
        const seed = `${day}|${StreetCrime.npcKey(victim)}|${crime}`;
        for (const w of witnesses) {
            w.react = StreetCrime.reactionFor(w, crime, { seed, victimName: victim.name, playerAttack });
            w.mood = w.react.mood;
        }
        const wt = InnerMap.currentWorldTile || {};
        const res = StreetCrime.record(player, world, { crime, victim, witnesses, q: wt.q, r: wt.r, scene, onMap: npcs });

        // The street reacts
        const secs = (C.reactions && C.reactions.barkSeconds) || 3.6;
        for (const w of witnesses) {
            const npc = w.npc;
            if (npc._dialogFrozen) continue;
            if (w.react.bark) this.bark(npc, w.react.bark, secs);
            switch (w.react.act) {
                case 'arrest': this._respond(npc, 'arrest', res && res.incident); break;
                case 'fight': this._respond(npc, 'fight', res && res.incident); break;
                case 'flee': this._flee(npc, scene); break;
                case 'cower': this._hold(npc, 10); break;
                default: this._hold(npc, 5); break;
            }
        }
        // A beaten victim cries out
        if (crime === 'assault' && !victim._barked) {
            victim._barked = true;
            const line = StreetCrime.bark('victim', 'assault', StreetCrime._moodOf(victim), { victim: victim.name }, seed);
            if (line) this.bark(victim, line, secs);
        }

        if (game.ui && typeof game.ui.showNotification === 'function') {
            const seen = witnesses.filter(w => w.seen);
            const guards = witnesses.filter(w => w.react.act === 'arrest').length;
            if (seen.length) {
                const names = seen.slice(0, 3).map(w => w.npc.name).join(', ');
                game.ui.showNotification(crime === 'murder' ? '👁️ Witnessed!' : '👁️ Seen!',
                    `${seen.length} saw you ${crime === 'murder' ? 'kill' : 'attack'} ${victim.name} (${names}${seen.length > 3 ? '…' : ''}). They will remember it, and the town will talk.${guards ? ` The watch is coming!` : ''}`,
                    'warning');
            } else if (crime === 'murder') {
                game.ui.showNotification('🤫 Unseen', `No one saw you kill ${victim.name}. The body will be found all the same.`, 'warning');
            }
        }
        return { ...(res || {}), witnesses };
    },

    /** A line shouted over an NPC's head for `secs` seconds. */
    bark(npc, text, secs = 3.6) {
        if (!npc || !text) return;
        npc._bark = { text, until: _now() + secs * 1000 };
    },

    /** Freeze an NPC where they stand (cowering, shouting) for a while. */
    _hold(npc, secs) {
        if (npc.state === 'inside_building' && !InnerMap._insideBuilding) return;
        npc.path = null;
        npc.moveProgress = 0;
        if (npc.state === 'walking') npc.state = 'idle';
        npc.idleTimer = Math.max(npc.idleTimer || 0, secs);
        const dq = InnerMap.playerInnerQ - npc.q;
        const dr = InnerMap.playerInnerR - npc.r;
        npc.facing = InnerMapCharacters.getDirection(dq, dr);
    },

    /** Run for the edge of the map (gone for this visit); indoors, cower instead. */
    _flee(npc, scene) {
        if (scene.indoors) { this._hold(npc, 12); return; }
        const edge = InnerMap._findNearestEdgeTile(npc.q, npc.r);
        const path = edge ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
        if (!path || path.length < 2) { this._hold(npc, 10); return; }
        const run = (StreetCrime.config().reactions || {}).runSpeed || 2.4;
        if (!this._fleeing.has(npc.id)) this._fleeing.set(npc.id, npc.speed);
        npc.speed = (this._fleeing.get(npc.id) || npc.speed || 1) * run;
        npc.departing = true;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
    },

    /** Send an NPC after the player: to fight (kin) or to arrest (the watch). */
    _respond(npc, mode, incident) {
        const R = StreetCrime.config().reactions || {};
        const prev = this._responders.get(npc.id);
        if (prev && prev.mode === 'arrest' && mode === 'fight') return;
        this._responders.set(npc.id, {
            mode, until: _now() + (R.chaseSeconds || 30) * 1000, repath: 0,
            incidentId: incident ? incident.id : (prev && prev.incidentId), speed: prev ? prev.speed : npc.speed,
            confronted: false,
        });
        npc.speed = (prev ? prev.speed : npc.speed || 1) * (R.runSpeed || 2.4);
        npc.departing = false;
    },

    /** Stop chasing (the matter is settled, or the player got away). */
    release(npcId) {
        const r = this._responders.get(npcId);
        this._responders.delete(npcId);
        const npc = (InnerMap.npcs || []).find(n => n.id === npcId);
        if (npc && r && r.speed) npc.speed = r.speed;
        if (npc) {
            npc.path = null;
            if (npc.state === 'walking') npc.state = 'idle';
            npc.idleTimer = 3;
        }
        InnerMapCombat._npcReactions.delete(npcId);
    },

    /** The player resists: the guard fights. */
    guardResists(npcId) {
        const r = this._responders.get(npcId);
        if (r) {
            r.mode = 'fight';
            r.until = _now() + 60000;
        }
        InnerMapCombat._npcReactions.set(npcId, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
    },

    reset() {
        this._responders.clear();
        this._fleeing.clear();
    },

    // ══════════════════════════════════════════════
    // UPDATE — each frame, from InnerMapCombat.update
    // ══════════════════════════════════════════════

    update(deltaTime, game) {
        if (!InnerMap.active) { this.reset(); this._visitKey = null; return; }
        const wt = InnerMap.currentWorldTile || {};
        const key = `${wt.q},${wt.r}`;
        // A new visit: another town, or this one again after time away on the world map
        const now = _now();
        const away = now - this._lastTick > 1500;
        this._lastTick = now;
        if (key !== this._visitKey || away) {
            this._visitKey = key;
            this.reset();
            this._arrivalAt = _now();
            this._arrivalChecked = false;
        }
        // Arriving where an unanswered crime is still remembered: the watch comes
        if (!this._arrivalChecked && _now() - this._arrivalAt > 2500 && !InnerMap._insideBuilding) {
            this._arrivalChecked = true;
            this._watchOnArrival(game, key);
        }
        if (this._responders.size) this._driveResponders(deltaTime, game);
    },

    _watchOnArrival(game, key) {
        if (!game || !game.player || game.player.jailState) return;
        const day = (game.world && game.world.day) || 0;
        const inc = StreetCrime.pendingAt(game.player, key, day);
        if (!inc) return;
        const hidden = new Set(StreetCrime.config().sight.hiddenStates || []);
        let best = null;
        for (const n of InnerMap.npcs || []) {
            if (n.type !== 'guard' || hidden.has(n.state)) continue;
            const d = _dist(n.q, n.r, InnerMap.playerInnerQ, InnerMap.playerInnerR);
            if (!best || d < best.d) best = { n, d };
        }
        if (!best) return;
        this.bark(best.n, StreetCrime.watchBark(`${key}|${inc.id}`) || 'You there! Stop!');
        this._respond(best.n, 'arrest', inc);
        if (game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification('🛡️ The Watch', `${best.n.name} has recognised you: the ${inc.k === 'murder' ? 'killing' : 'beating'} of ${inc.victim} has not been forgotten here.`, 'error');
        }
    },

    _driveResponders(deltaTime, game) {
        const now = _now();
        const pq = InnerMap.playerInnerQ;
        const pr = InnerMap.playerInnerR;
        for (const [id, r] of [...this._responders]) {
            const npc = (InnerMap.npcs || []).find(n => n.id === id);
            if (!npc || npc.state === 'gone') { this._responders.delete(id); continue; }
            if (now > r.until) { this.release(id); continue; }
            if (npc._dialogFrozen) continue;
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            const d = _dist(npc.q, npc.r, pq, pr);
            if (d <= 1) {
                npc.path = null;
                npc.moveProgress = 0;
                if (npc.state === 'walking') npc.state = 'idle';
                npc.idleTimer = 5;
                npc.facing = InnerMapCharacters.getDirection(pq - npc.q, pr - npc.r);
                if (r.mode === 'fight') {
                    if (!InnerMapCombat._npcReactions.has(id)) {
                        InnerMapCombat._npcReactions.set(id, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
                    }
                } else if (r.mode === 'arrest' && !r.confronted) {
                    this._confront(game, npc, r);
                }
                continue;
            }
            // Keep going while the path still ends beside the player; re-plan
            // (keeping the step under way) when they have moved off
            r.repath -= deltaTime;
            const walking = npc.path && npc.pathIndex < npc.path.length;
            const end = walking ? npc.path[npc.path.length - 1] : null;
            if (walking && (r.repath > 0 || _dist(end.q, end.r, pq, pr) <= 1)) continue;
            r.repath = 0.6;
            const path = InnerMap._findPath(npc.q, npc.r, pq, pr);
            if (!path || path.length < 3) continue;
            const step = walking ? npc.path[npc.pathIndex] : null;
            const keep = step && path[1] && path[1].q === step.q && path[1].r === step.r ? npc.moveProgress : 0;
            // Stop a step short of the player
            npc.path = path.slice(1, -1);
            npc.pathIndex = 0;
            npc.moveProgress = keep;
            if (!keep) { npc.prevQ = npc.q; npc.prevR = npc.r; }
            npc.state = 'walking';
            npc._targetBuilding = null;
        }
    },

    /** A guard has caught up with the player: the watch's choice scene. */
    _confront(game, npc, r) {
        if (!game || !game.player || game.player.jailState) return;
        if (game._scene || NpcDialog.active) return; // try again next frame
        r.confronted = true;
        const inc = r.incidentId != null ? StreetCrime._incident(game.player, r.incidentId) : null;
        const day = (game.world && game.world.day) || 0;
        const open = inc && !inc.answered ? inc : StreetCrime.pendingAt(game.player, this._visitKey, day);
        if (!open) { this.release(npc.id); return; }
        r.incidentId = open.id;
        this.openWatch(game, npc, open);
    },

    /** Open the watch's scene for a guard and an incident. */
    openWatch(game, npc, incident) {
        if (!game || !npc || !incident) return;
        if (InnerMapCombat._attackState) InnerMapCombat.cancelAttack();
        ActionMenu.showScene(game, 'street_watch', { incidentId: incident.id, guardId: npc.id, guardName: npc.name || 'The guard' });
    },

    // ══════════════════════════════════════════════
    // RENDER — barks over heads, on top of the sprites
    // ══════════════════════════════════════════════

    render(ctx, camera) {
        if (!InnerMap.active || !InnerMap.npcs) return;
        const now = _now();
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        for (const npc of InnerMap.npcs) {
            const b = npc._bark;
            if (!b) continue;
            if (now > b.until) { npc._bark = null; continue; }
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            let wx = npc.q * T + T / 2;
            let wy = npc.r * T + T / 2;
            if (npc.path && npc.pathIndex < npc.path.length) {
                const t = npc.path[npc.pathIndex];
                wx += (t.q * T + T / 2 - wx) * (npc.moveProgress || 0);
                wy += (t.r * T + T / 2 - wy) * (npc.moveProgress || 0);
            }
            const s = camera.worldToScreen(wx, wy);
            const charScale = npc.type === 'child' ? 0.7 : 1.0;
            const left = (b.until - now) / 1000;
            const alpha = Math.min(1, left / 0.4);
            this._drawBubble(ctx, b.text, s.x, s.y - ds * 1.75 * charScale, camera.zoom, alpha);
        }
    },

    _drawBubble(ctx, text, x, y, zoom, alpha) {
        const shown = text.length > 48 ? `${text.slice(0, 47)}…` : text;
        const px = textPx(11 * labelZoom(zoom), 11);
        ctx.save();
        ctx.globalAlpha *= Math.max(0, alpha);
        ctx.font = `700 ${px}px 'Inter', sans-serif`;
        const w = ctx.measureText(shown).width + px * 1.2;
        const h = px * 1.7;
        const bx = x - w / 2;
        const by = y - h;
        ctx.fillStyle = 'rgba(250, 244, 228, 0.95)';
        ctx.strokeStyle = 'rgba(60, 40, 20, 0.85)';
        ctx.lineWidth = Math.max(1, px * 0.1);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, w, h, h * 0.4);
        else ctx.rect(bx, by, w, h);
        ctx.moveTo(x - px * 0.4, by + h);
        ctx.lineTo(x, by + h + px * 0.55);
        ctx.lineTo(x + px * 0.4, by + h);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3a2412';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shown, x, by + h / 2);
        ctx.restore();
    },
};
