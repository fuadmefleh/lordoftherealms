// ============================================
// INNER MAP ESCORT — the realm's household guard walking behind you
// ============================================
// The guard a realm keeps for the player (player/realmEscort.js: companies in
// player.army tagged unit.realmGuard) follows the player about the street
// map: one figure a company (at most MAX), in single file along the trail the
// player walked, foot soldiers on foot and knights on their horses, in the
// realm's livery and the arms each company was issued from the realm's
// armoury (the battlefield's soldier recipes, data/military.json →
// battlefield.looks, fitted to the kit by Arms.lookLayers). Purely visual:
// they block nothing and nothing is decided here. Out of sight indoors, on
// deck, and while a battle is fought on the map (its companies are the guard).
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
        return unit.kit ? Arms.lookLayers(layers, Arms.kitView(unit), { paint: fill.paint }) : layers;
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
        const sig = order.map(u => `${u.type}:${u.realmGuard}:${u.kit ? Arms.kitLabel(u) : ''}`).join('|');
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
        E._men.forEach((m, i) => {
            const back = E._along(at, SPACING * T_PX * (Math.floor(i / 2) + 1));
            // (two abreast: each of a pair a little to its side of the trail)
            const side = (i % 2 ? 1 : -1) * T_PX * 0.32;
            const tx = back.x + side, ty = back.y;
            const dx = tx - m.x, dy = ty - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SNAP * T_PX) { m.x = tx; m.y = ty; m.moving = false; return; }
            if (dist > 2) {
                const k = Math.min(1, step * (dist > T_PX * 2 ? 1.6 : 1) / dist);
                m.x += dx * k;
                m.y += dy * k;
                m.moving = dist > 4;
                if (m.moving) m.dir = InnerMapCharacters.getDirection(dx, dy);
            } else m.moving = false;
            // (at a halt they face the way the party was going: toward the viewer before any walking)
            if (!m.moving) m.dir = E._trail.length > 1 ? InnerMapCharacters.getDirection(E._heading.x, E._heading.y) : InnerMapCharacters.DIR_DOWN;
            m.t += dt;
        });
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
                    const f = { i, moving: m.moving, anim: m.moving ? 'walk' : 'idle' };
                    InnerMapBattle._drawRider(ctx, ds, c, f, preset, sx, sy, m.dir, m.t, horseSp, !!preset);
                } else {
                    InnerMapBattle._drawFoot(ctx, ds, preset, sx, sy, m.moving ? 'walk' : 'idle', m.dir, m.t, !!preset, false);
                }
            } });
        });
    },
};
