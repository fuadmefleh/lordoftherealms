// ============================================
// INNER MAP COMPANIONS — your travelling companions walking with you
// ============================================
// The travel party (player.travelParty → Companions.members) follows the
// player about the street map, in single file along the trail the player
// walked, nearest first. The realm's household guard (ui/innerMapEscort.js),
// when there is one, falls in behind them (InnerMapCompanions.count()).
// Out of sight indoors, on deck, and while a battle is fought on the map.
// They block nothing, and they fight at your side as the guard does
// (InnerMapEscort._foe: the beast you fight or that charges you, whoever is
// fighting you; never a job's or an arena's one-on-one, and they stand aside
// for the law unless you've ordered your people to defend you against all).
// A blow's weight is their role's battle power and their mood
// (data/escort.json → fight.companions).
//
//   update(dt, game)               the trail, each companion walked to their place
//   collect(items, ctx, camera, T)  the figures into the depth-sorted pass
//                                   (innerMapLayers/entities.js)
//   menAt(q, r)                     the companions standing on a tile
// A talk that moved a companion's mood (systems/companionChatMood.js) shows
// as a short bubble rising over them ('+ pleased' / '− hurt'), BUBBLE_SECS.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { Companions } from '../systems/companions.js';
import { InnerMapEscort } from './innerMapEscort.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { RealmEscort } from '../player/realmEscort.js';
import { CompanionChatMood } from '../systems/companionChatMood.js';

const T_PX = 32;
const MAX = 4;
const SPACING = 0.9;    // tiles between companions along the trail
const SPEED = 5.5;      // tiles a second at most
const SNAP = 9;         // tiles: further than this, a figure is set down at its place
const BUBBLE_SECS = 2.8; // a mood bubble's life over a companion
const PENDING_SECS = 8;  // a reaction waits this long for its companion to be on the map

function _hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

export const InnerMapCompanions = {
    _men: [],          // [{ npc, preset, x, y, dir, moving, t, walkHold, bubble? }]
    _pending: [],      // mood reactions not yet shown: [{ npcId, text, tone, age }]
    _trail: [],        // the player's walked points, newest last ({ x, y } world px)
    _sig: '',
    _map: null,
    _shown: false,
    _heading: { x: 0, y: -1 },

    _hidden(game) {
        return !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active
            || !game || !game.player || game.player.boardedShip;
    },

    /** How many walk behind you now (the household guard falls in after them). */
    count() {
        return InnerMapCompanions._shown ? InnerMapCompanions._men.length : 0;
    },

    /** A companion's look: their own, if they have one, else a traveller's, fixed by who they are. */
    presetFor(npc) {
        if (npc && npc.preset && !String(npc.preset).startsWith('player:')) return npc.preset;
        return InnerMapCharacters.getPresetForNPC('traveler', _hash(String(npc && npc.id)), npc && npc.gender) || null;
    },

    /** A companion's blow before the dice: base + role power x perPower, times mood and bonds. */
    damageOf(player, npc) {
        const f = (RealmEscort.config().fight || {}).companions || {};
        const base = Number.isFinite(f.base) ? f.base : 5;
        const per = Number.isFinite(f.perPower) ? f.perPower : 50;
        let power = 0, eff = 1;
        try { power = Number(PlayerEffects.companionRole(npc).power) || 0; } catch { power = 0; }
        try { eff = Number(Companions.effectiveness(player, npc)); } catch { eff = 1; }
        if (!Number.isFinite(eff) || eff <= 0) eff = 1;
        return Math.max(1, (base + power * per) * eff);
    },

    _sync(player, at) {
        let members = [];
        try { members = Companions.members(player).filter(n => n && n.isAlive !== false).slice(0, MAX); } catch { members = []; }
        const sig = InnerMapCharacters.eraId() + '|' + members.map(n => n.id).join('|');
        if (sig === InnerMapCompanions._sig && InnerMapCompanions._men.length === members.length) return;
        InnerMapCompanions._sig = sig;
        const old = new Map(InnerMapCompanions._men.map(m => [m.npc.id, m]));
        InnerMapCompanions._men = members.map((npc, i) => {
            const was = old.get(npc.id);
            return {
                npc, preset: InnerMapCompanions.presetFor(npc),
                x: was ? was.x : at.x + (i % 2 ? 1 : -1) * T_PX * 0.3, y: was ? was.y : at.y + T_PX * SPACING * (i + 1),
                dir: was ? was.dir : InnerMapCharacters.DIR_DOWN, moving: false, t: i * 0.41, walkHold: 0,
                bubble: was ? was.bubble : null,
            };
        });
    },

    /** The point `d` world px back along the trail from the player. */
    _along(at, d) {
        let left = d;
        let px = at.x, py = at.y;
        const trail = InnerMapCompanions._trail;
        for (let i = trail.length - 1; i >= 0; i--) {
            const p = trail[i];
            const seg = Math.hypot(px - p.x, py - p.y);
            if (seg >= left) {
                const k = seg > 0 ? left / seg : 0;
                return { x: px + (p.x - px) * k, y: py + (p.y - py) * k };
            }
            left -= seg;
            px = p.x; py = p.y;
        }
        const h = InnerMapCompanions._heading;
        return { x: px - h.x * left, y: py - h.y * left };
    },

    /** Talks that moved a companion's mood: a bubble over each (held a while for one not yet on the map). */
    _takeReactions(dt, game) {
        const C = InnerMapCompanions;
        for (const r of CompanionChatMood.drainReactions(game && game.player)) C._pending.push({ ...r, age: 0 });
        if (!C._pending.length) return;
        C._pending = C._pending.filter(r => {
            const m = C._shown && C._men.find(x => x.npc && x.npc.id === r.npcId);
            if (m) { m.bubble = { text: r.text, tone: r.tone, t: 0 }; return false; }
            r.age += Math.max(0, dt || 0);
            return r.age < PENDING_SECS;
        });
    },

    update(dt, game) {
        const C = InnerMapCompanions;
        C._shown = false;
        try { C._takeReactions(dt, game); } catch { C._pending = []; }
        if (C._hidden(game)) {
            if (!InnerMap.active) { C._men = []; C._trail = []; C._sig = ''; C._map = null; }
            return;
        }
        const at = InnerMap.getPlayerWorldPos();
        // A new map: they stand about you where you came in
        if (C._map !== InnerMap.tiles) {
            C._map = InnerMap.tiles;
            C._trail = [];
            C._men = [];
            C._sig = '';
            C._heading = { x: 0, y: -1 };
        }
        C._sync(game.player, at);
        if (!C._men.length) return;
        C._shown = true;
        const last = C._trail[C._trail.length - 1];
        if (!last || Math.hypot(last.x - at.x, last.y - at.y) >= T_PX * 0.4) {
            if (last) {
                const d = Math.hypot(at.x - last.x, at.y - last.y) || 1;
                C._heading = { x: (at.x - last.x) / d, y: (at.y - last.y) / d };
            }
            C._trail.push({ x: at.x, y: at.y });
            if (C._trail.length > 60) C._trail.splice(0, C._trail.length - 60);
        }
        const step = SPEED * T_PX * Math.max(0, Math.min(dt, 0.1));
        let foe = null, fc = null;
        try { foe = InnerMapEscort._foe(game); fc = InnerMapEscort._fightCfg(); } catch { foe = null; }
        C._men.forEach((m, i) => {
            let tx, ty;
            m.fighting = false;
            if (foe) {
                // Round the foe, each to their own side of it (off the guard's angles)
                const fp = InnerMapEscort._foePos(foe);
                const ang = (i / Math.max(1, C._men.length)) * Math.PI * 2 + 2.2;
                tx = fp.x + Math.cos(ang) * T_PX * 0.9;
                ty = fp.y + Math.sin(ang) * T_PX * 0.7;
                if (Math.hypot(fp.x - m.x, fp.y - m.y) <= fc.reach * T_PX) {
                    m.fighting = true;
                    m.dir = InnerMapCharacters.getDirection(fp.x - m.x, fp.y - m.y);
                    m.swingT = (m.swingT == null ? 0.5 + i * 0.29 : m.swingT) + dt;
                    if (m.swingT >= fc.swingEvery) {
                        m.swingT = 0;
                        InnerMapEscort._strike(game, m, foe, C.damageOf(game.player, m.npc));
                    }
                }
            } else {
                m.swingT = null;
                const back = C._along(at, SPACING * T_PX * (i + 1));
                // (a little to alternate sides of the trail, so they don't walk in one another)
                tx = back.x + (i % 2 ? 1 : -1) * T_PX * 0.18; ty = back.y;
            }
            const dx = tx - m.x, dy = ty - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SNAP * T_PX) { m.x = tx; m.y = ty; m.moving = false; m.walkHold = 0; return; }
            let moved = 0;
            if (dist > 0.5) {
                const k = Math.min(1, step * (dist > T_PX * 2 ? 1.6 : 1) / dist);
                m.x += dx * k;
                m.y += dy * k;
                moved = dist * k;
            }
            if (dt > 0 && moved / dt > T_PX * 0.6) {
                m.walkHold = 0.2;
                if (!m.fighting) m.dir = InnerMapCharacters.getDirection(dx, dy);
            } else m.walkHold = Math.max(0, (m.walkHold || 0) - dt);
            m.moving = m.walkHold > 0 && !m.fighting;
            if (!m.moving && !m.fighting) m.dir = C._trail.length > 1 ? InnerMapCharacters.getDirection(C._heading.x, C._heading.y) : InnerMapCharacters.DIR_DOWN;
            m.t += dt;
            if (m.bubble && (m.bubble.t += dt) >= BUBBLE_SECS) m.bubble = null;
        });
        // (reactions that came in this frame, now the figures are placed)
        if (C._pending.length) C._takeReactions(0, null);
    },

    /** The companions standing on an inner-map tile (for a click). */
    menAt(q, r) {
        if (!InnerMapCompanions._shown) return [];
        return InnerMapCompanions._men.filter(m => Math.round((m.x - T_PX / 2) / T_PX) === q && Math.round((m.y - T_PX / 2) / T_PX) === r);
    },

    /** A mood bubble rising over a companion's head, fading as it goes. */
    _drawBubble(ctx, sx, sy, ds, b) {
        const k = Math.min(1, b.t / BUBBLE_SECS);
        const alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        if (alpha <= 0) return;
        const y = sy - ds * (1.25 + 0.45 * k);
        const px = Math.max(10, Math.round(ds * 0.36));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${px}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(b.text).width + px * 0.9;
        const h = px * 1.45;
        ctx.fillStyle = 'rgba(20,16,10,0.78)';
        if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(sx - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); }
        else ctx.fillRect(sx - w / 2, y - h / 2, w, h);
        ctx.fillStyle = b.tone === 'good' ? '#9be08a' : '#f08a7a';
        ctx.fillText(b.text, sx, y + 0.5);
        ctx.restore();
    },

    collect(items, ctx, camera, T) {
        const C = InnerMapCompanions;
        if (!C._shown || !C._men.length || !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const k = T / T_PX;
        for (const m of C._men) {
            const wx = m.x * k, wy = m.y * k;
            // (worldToScreenFast hands back one shared object: copy out before the deferred draw)
            const s = camera.worldToScreenFast(wx, wy);
            const sx = s.x, sy = s.y;
            if (sx < -ds * 3 || sx > W + ds * 3 || sy < -ds * 3 || sy > H + ds * 3) continue;
            const preset = m.preset && InnerMapCharacters.getComposited(m.preset) ? m.preset : null;
            const anim = m.fighting ? 'slash' : m.moving ? 'walk' : 'idle';
            items.push({ sortY: wy + T / 2, zLayer: 2, sortX: wx / T, draw: () => {
                InnerMapBattle._drawFoot(ctx, ds, preset, sx, sy, anim, m.dir, m.t, !!preset, false);
            } });
            if (m.bubble) {
                const b = m.bubble;
                // (over the figures just in front of them)
                items.push({ sortY: wy + T * 3, zLayer: 3, sortX: wx / T, draw: () => InnerMapCompanions._drawBubble(ctx, sx, sy, ds, b) });
            }
        }
    },
};
