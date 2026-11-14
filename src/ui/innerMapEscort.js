// ============================================
// INNER MAP ESCORT — the realm's household guard walking behind you
// ============================================
// The guard a realm keeps for the player (player/realmEscort.js: companies in
// player.army tagged unit.realmGuard) follows the player about the street
// map: one figure a company (at most MAX), in single file along the trail the
// player walked, foot soldiers on foot and knights on their horses, in the
// realm's livery and the arms each company was issued from the realm's
// armoury (the battlefield's soldier recipes, data/military.json →
// battlefield.looks, fitted to the kit by Arms.lookLayers). They block
// nothing, but they fight at your side (data/escort.json -> fight): the beast
// you fight, or one charging or attacking you, and whoever is fighting you
// (never an arena bout or a job's duel: those stay one against one; and
// never the law: the watch, the gaoler, a castle's guard, it stands aside). Out of
// sight indoors, on deck, and while a battle is fought on the map (its
// companies are the guard).
//
//   update(dt, game)              the trail, each figure walked to its place
//   collect(items, ctx, camera, T) the figures into the depth-sorted pass
//                                  (innerMapLayers/entities.js)

import { InnerMap } from '../world/innerMap.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { Battlefield } from '../player/battlefield.js';
import { RealmEscort } from '../player/realmEscort.js';
import { Arms } from '../systems/arms.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCompanions } from './innerMapCompanions.js';
import { Utils } from '../core/utils.js';

const T_PX = 32;
const MAX = 6;
const SPACING = 0.95;   // tiles between followers along the trail
const SPEED = 5.5;      // tiles a second at most
const SNAP = 9;         // tiles: further than this, a figure is set down at its place

function _hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

export const InnerMapEscort = {
    _men: [],          // [{ unit, preset, horse, x, y, dir, moving, t }]
    _trail: [],        // the player's walked points, newest last ({ x, y } world px)
    _sig: '',
    _map: null,
    _shown: false,
    _heading: { x: 0, y: -1 },   // the player's last way of walking (unit vector)
    _pending: new Set(),

    _hidden(game) {
        return !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active
            || !game || !game.player || game.player.boardedShip;
    },

    /** The layers a company's figure wears: its type's recipe, its realm's livery, its kit. */
    layersFor(unit, i) {
        const looks = Battlefield.config().looks || {};
        const R = looks.recipes || {};
        const recipe = R[unit.type] || (/archer|bow/.test(String(unit.type)) ? R.archer : R.foot) || [];
        const skins = looks.skins || ['Peach'];
        const hairs = looks.hairs || ['Short 01 - Buzzcut/Brown'];
        const liv = InnerMapBattle._realmLivery(unit.realmGuard) || { shirt: 'Navy', paint: 'Blue', legs: 'Charcoal', plume: 'White' };
        const h = _hash(`guard:${unit.realmGuard}:${unit.type}:${i}`);
        const fill = { skin: skins[h % skins.length], hair: hairs[(h >>> 4) % hairs.length], shirt: liv.shirt, legs: liv.legs || 'Charcoal', paint: liv.paint || 'Red', plume: liv.plume || 'White' };
        const layers = recipe.map(l => l.replace(/\{(\w+)\}/g, (_, k) => fill[k] || ''));
        const worn = unit.kit ? Arms.lookLayers(layers, Arms.kitView(unit), { paint: fill.paint }) : layers;
        // ...as the world's era wears it (world/eraWardrobe.js: no plate before the high kingdoms)
        return InnerMapCharacters.eraLayers(worn, `guard:${unit.realmGuard}:${unit.type}:${i}`);
    },

    _preset(unit, i) {
        const layers = InnerMapEscort.layersFor(unit, i);
        if (!layers.length) return null;
        const id = `guard:${_hash(layers.join('|')).toString(36)}`;
        if (!InnerMapCharacters.getComposited(id) && !InnerMapEscort._pending.has(id)) {
            InnerMapEscort._pending.add(id);
            InnerMapCharacters.registerPreset(id, layers).finally(() => InnerMapEscort._pending.delete(id));
        }
        return id;
    },

    /** The figures, rebuilt when the guard's companies (or their kit) change. */
    _sync(player, at) {
        const units = RealmEscort.units(player);
        // (knights ride ahead of the foot: nearest the player first)
        const order = units.slice().sort((a, b) => (b.type === 'knight') - (a.type === 'knight')).slice(0, MAX);
        const sig = InnerMapCharacters.eraId() + '|' + order.map(u => `${u.type}:${u.realmGuard}:${u.kit ? Arms.kitLabel(u) : ''}`).join('|');
        if (sig === InnerMapEscort._sig && InnerMapEscort._men.length === order.length) return;
        InnerMapEscort._sig = sig;
        const old = InnerMapEscort._men;
        InnerMapEscort._men = order.map((unit, i) => {
            const was = old[i];
            return {
                unit, preset: InnerMapEscort._preset(unit, i), horse: unit.type === 'knight' || unit.type === 'cavalry',
                x: was ? was.x : at.x + (i % 2 ? 1 : -1) * T_PX * 0.32, y: was ? was.y : at.y + T_PX * SPACING * (Math.floor(i / 2) + 1),
                dir: was ? was.dir : InnerMapCharacters.DIR_DOWN, moving: false, t: i * 0.37,
            };
        });
    },

    /** The point `d` world px back along the trail from the player (the trail's end, short of it). */
    _along(at, d) {
        let left = d;
        let px = at.x, py = at.y;
        for (let i = InnerMapEscort._trail.length - 1; i >= 0; i--) {
            const p = InnerMapEscort._trail[i];
            const seg = Math.hypot(px - p.x, py - p.y);
            if (seg >= left) {
                const k = seg > 0 ? left / seg : 0;
                return { x: px + (p.x - px) * k, y: py + (p.y - py) * k };
            }
            left -= seg;
            px = p.x; py = p.y;
        }
        // (short of trail: the file goes on behind, the way the player came — south at first)
        const h = InnerMapEscort._heading;
        return { x: px - h.x * left, y: py - h.y * left };
    },

    update(dt, game) {
        const E = InnerMapEscort;
        E._shown = false;
        if (E._hidden(game) || !RealmEscort.guard(game.player)) {
            if (!InnerMap.active || (game && game.player && !RealmEscort.guard(game.player))) { E._men = []; E._trail = []; E._sig = ''; E._map = null; }
            return;
        }
        E._shown = true;
        const at = InnerMap.getPlayerWorldPos();
        // A new map: the guard stands about you where you came in
        if (E._map !== InnerMap.tiles) {
            E._map = InnerMap.tiles;
            E._trail = [];
            E._men = [];
            E._sig = '';
            E._heading = { x: 0, y: -1 };
        }
        E._sync(game.player, at);
        const last = E._trail[E._trail.length - 1];
        if (!last || Math.hypot(last.x - at.x, last.y - at.y) >= T_PX * 0.4) {
            if (last) {
                const d = Math.hypot(at.x - last.x, at.y - last.y) || 1;
                E._heading = { x: (at.x - last.x) / d, y: (at.y - last.y) / d };
            }
            E._trail.push({ x: at.x, y: at.y });
            if (E._trail.length > 80) E._trail.splice(0, E._trail.length - 80);
        }
        const step = SPEED * T_PX * Math.max(0, Math.min(dt, 0.1));
        const foe = E._foe(game);
        const fc = E._fightCfg();
        E._men.forEach((m, i) => {
            let tx, ty;
            m.fighting = false;
            if (foe) {
                // Round the foe, each to his own side of it
                const fp = E._foePos(foe);
                const ang = (i / Math.max(1, E._men.length)) * Math.PI * 2 + 0.6;
                tx = fp.x + Math.cos(ang) * T_PX * 0.95;
                ty = fp.y + Math.sin(ang) * T_PX * 0.75;
                if (Math.hypot(fp.x - m.x, fp.y - m.y) <= fc.reach * T_PX) {
                    m.fighting = true;
                    m.dir = InnerMapCharacters.getDirection(fp.x - m.x, fp.y - m.y);
                    m.swingT = (m.swingT == null ? i * 0.23 : m.swingT) + dt;
                    if (m.swingT >= fc.swingEvery) {
                        m.swingT = 0;
                        E._strike(game, m, foe);
                    }
                }
            } else {
                m.swingT = null;
                // (behind your companions, when they walk with you: ui/innerMapCompanions.js)
                const lead = InnerMapCompanions.count() * 0.9;
                const back = E._along(at, SPACING * T_PX * (Math.floor(i / 2) + 1 + lead));
                // (two abreast: each of a pair a little to its side of the trail)
                const side = (i % 2 ? 1 : -1) * T_PX * 0.32;
                tx = back.x + side; ty = back.y;
            }
            const dx = tx - m.x, dy = ty - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SNAP * T_PX) { m.x = tx; m.y = ty; m.moving = false; m.walkHold = 0; return; }
            // Walking is judged by how far a figure actually went, not how far
            // it has left to go: trailing the player it closes the gap each
            // frame (a couple of px), so the gap alone read as standing still
            // and the guard glided along in the idle pose. A short hold keeps
            // the stride from flickering frame to frame.
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
            // (at a halt they face the way the party was going: toward the viewer before any walking)
            if (!m.moving && !m.fighting) m.dir = E._trail.length > 1 ? InnerMapCharacters.getDirection(E._heading.x, E._heading.y) : InnerMapCharacters.DIR_DOWN;
            m.t += dt;
        });
    },

    // ── Fighting at the player's side ──

    _fightCfg() {
        const f = RealmEscort.config().fight || {};
        const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
        return { swingEvery: n(f.swingEvery, 1.1), reach: n(f.reach, 1.4), joinRange: n(f.joinRange, 8), damage: f.damage || {} };
    },

    /**
     * Whom the guard falls on: { kind: 'beast', a } | { kind: 'npc', npc } | null.
     * The beast you fight, or one charging or attacking you; the one you set
     * on once they fight back, or anyone fighting you. Never a job's opponent
     * or an arena bout (those are one against one).
     */
    _foe(game) {
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const range = InnerMapEscort._fightCfg().joinRange;
        const cheb = (q, r) => Math.max(Math.abs(q - me.q), Math.abs(r - me.r));
        const animals = InnerMap.animals || [];
        const fight = InnerMapAnimals._fight;
        if (fight && fight.a && fight.a.state !== 'dead' && animals.includes(fight.a)) return { kind: 'beast', a: fight.a };
        for (const a of animals) {
            if (!a || (a.state !== 'charge' && a.state !== 'attack')) continue;
            const p = InnerMap.animalPos(a);
            if (cheb(p.q, p.r) <= 3) return { kind: 'beast', a };
        }
        const ok = (npc) => {
            if (!npc || npc._taskFoe || npc.state === 'gone' || npc.state === 'inside_building') return false;
            // The law: the town watch, the gaoler and a castle's guards. A lord's
            // household guard stands aside for the law; the crown's guard (and any
            // guard ordered to defend you against all comers) does not
            if (InnerMapEscort.isLaw(npc) && !InnerMapEscort.defendsAgainstLaw(game)) return false;
            const h = InnerMapCombat._npcHealth.get(npc.id);
            return !!h && h.current > 0 && cheb(npc.q, npc.r) <= range;
        };
        const npcs = InnerMap.npcs || [];
        for (const [id, r] of InnerMapCombat._npcReactions) {
            if (!r || r.mode !== 'fight') continue;
            const npc = npcs.find(n => n.id === id);
            if (ok(npc)) return { kind: 'npc', npc };
        }
        return null;
    },

    /**
     * Does the guard fight the law for you? Always when it is the crown's guard
     * (it serves the ruler, not the watch); otherwise only when you've ordered it
     * to defend you against all comers (player.escortStance === 'all').
     */
    defendsAgainstLaw(game) {
        const player = game && game.player;
        if (!player) return false;
        if (player.escortStance === 'all') return true;
        const g = RealmEscort.guard(player);
        return !!(g && g.rank === 'crown');
    },

    /** The guard's figures standing on an inner-map tile (for a click). */
    menAt(q, r) {
        if (!InnerMapEscort._shown) return [];
        return InnerMapEscort._men.filter(m => Math.round((m.x - T_PX / 2) / T_PX) === q && Math.round((m.y - T_PX / 2) / T_PX) === r);
    },

    /** Is this one the law (the watch, the gaoler, a castle's guard)? The escort stands aside for them. */
    isLaw(npc) {
        return !!(npc && (npc.type === 'guard' || npc._gaoler || npc._castleGuard));
    },

    /** The foe's place in escort px (T_PX tiles, the centre of its tile). */
    _foePos(foe) {
        if (foe.kind === 'beast') {
            const p = InnerMap.animalPos(foe.a);
            return { x: p.q * T_PX + T_PX / 2, y: p.r * T_PX + T_PX / 2 };
        }
        return { x: foe.npc.q * T_PX + T_PX / 2, y: foe.npc.r * T_PX + T_PX / 2 };
    },

    /** One guardsman's blow (or a companion's: `baseDmg` their own, ui/innerMapCompanions.js). */
    _strike(game, m, foe, baseDmg = null) {
        const C = InnerMapEscort._fightCfg();
        const base = baseDmg != null ? baseDmg : (Number(C.damage[m.unit.type] != null ? C.damage[m.unit.type] : C.damage._default) || 8);
        const dmg = Math.max(1, Math.round(base * (0.8 + Utils.random() * 0.4)));
        const T = InnerMapRenderer.TILE_SIZE;
        if (foe.kind === 'beast') {
            const a = foe.a;
            if (a.state === 'dead') return;
            const p = InnerMap.animalPos(a);
            const at = { q: Math.round(p.q), r: Math.round(p.r) };
            InnerMapCombat._spawnFloat(at.q * T + T / 2, at.r * T + T * 0.1, dmg, 'normal');
            InnerMapCombat._spawnHitFlash(at.q * T + T / 2, at.r * T + T / 2);
            const from = { q: Math.round((m.x - T_PX / 2) / T_PX), r: Math.round((m.y - T_PX / 2) / T_PX) };
            const res = InnerMap.hurtAnimal(game.world, a, dmg, from, InnerMap.animalConfig());
            for (const ev of (res && res.events) || []) InnerMapAnimals._event(game, ev);
            if (res && res.killed) {
                if (InnerMapAnimals._fight && InnerMapAnimals._fight.a === a) InnerMapAnimals._fight = null;
                InnerMapAnimals._killed(game, a);
            }
            return;
        }
        const npc = foe.npc;
        const health = InnerMapCombat._npcHealth.get(npc.id);
        if (!health || health.current <= 0) return;
        const hit = dmg;
        health.current = Math.max(0, health.current - hit);
        InnerMapCombat._spawnFloat(npc.q * T + T / 2, npc.r * T + T * 0.1, hit, 'normal');
        InnerMapCombat._spawnHitFlash(npc.q * T + T / 2, npc.r * T + T / 2);
        if (health.current <= 0) {
            const ia = InnerMapCombat._attackState;
            if (ia && ia.npc && ia.npc.id === npc.id) InnerMapCombat.cancelAttack();
            InnerMapCombat._knockOutNPC(npc, game);
        } else {
            InnerMapCombat._maybeBreak(npc, game);
        }
    },

    collect(items, ctx, camera, T) {
        const E = InnerMapEscort;
        if (!E._shown || !E._men.length || !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const horseSp = InnerMap.animalSpecies ? InnerMap.animalSpecies('horse', InnerMap.animalConfig()) : null;
        const k = T / T_PX;
        E._men.forEach((m, i) => {
            const wx = m.x * k, wy = m.y * k;
            const s = camera.worldToScreenFast(wx, wy);
            const sx = s.x, sy = s.y;
            if (sx < -ds * 3 || sx > W + ds * 3 || sy < -ds * 3 || sy > H + ds * 3) return;
            const preset = m.preset && InnerMapCharacters.getComposited(m.preset) ? m.preset : null;
            items.push({ sortY: wy + T / 2, zLayer: 2, sortX: wx / T, draw: () => {
                if (m.horse && horseSp) {
                    const c = { id: 9000 + i, order: { type: 'hold' }, state: 'formed' };
                    const f = { i, moving: m.moving, anim: m.fighting ? 'fight' : m.moving ? 'walk' : 'idle' };
                    InnerMapBattle._drawRider(ctx, ds, c, f, preset, sx, sy, m.dir, m.t, horseSp, !!preset);
                } else {
                    const anim = m.fighting ? (m.unit.type === 'archer' ? 'halfslash' : 'slash') : m.moving ? 'walk' : 'idle';
                    InnerMapBattle._drawFoot(ctx, ds, preset, sx, sy, anim, m.dir, m.t, !!preset, false);
                }
            } });
        });
    },
};
