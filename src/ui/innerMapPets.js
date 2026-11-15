// ============================================
// INNER MAP PETS — your animals walking with you on the street map
// ============================================
// The animals going about with you (systems/animalCompanions.js: not kept
// at a home, and not told to wait — systems/streetFollowers.js) walk the
// street map at your back: the horse led on its rein, the dog and the cat
// after your companions (ui/innerMapCompanions.js) and before the household
// guard (ui/innerMapEscort.js), all along the trail you walked. A hawk flies
// overhead, wheeling about you, its shadow on the ground. A dog fights at
// your side (the escort's foe and strike: InnerMapEscort._foe/_strike) and
// growls when a beast starts to stalk you. Out of sight indoors, on deck,
// and while a battle is fought on the map — as the companions are.
// Clicking one (menuItems/handle, through ui/innerMapUI.js): pet, feed,
// stay here / come along, send back to wait, its card (rename, keep at a
// home: ui/animalsPanel.js).
// In a town now and then a stray dog noses about (AnimalCompanions.strayAt):
// feed it from your packs until it trusts you and it is yours.
//
//   update(dt, game)                the trail, each animal walked to its place; the stray
//   collect(items, ctx, camera, T)   into the depth-sorted pass (innerMapLayers/entities.js)
//   count()                          how many walk in the file (the guard falls in after them)

import { InnerMap } from '../world/innerMap.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapEscort } from './innerMapEscort.js';
import { InnerMapCompanions } from './innerMapCompanions.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { StreetFollowers } from '../systems/streetFollowers.js';
import { AnimalsPanel } from './animalsPanel.js';

const T_PX = 32;
const SPACING = 1.1;     // tiles between animals along the trail (a dog side-on is near two tiles long)
const HORSE_GAP = 1.6;   // a led horse's room on the trail, in front and behind
const SPEED = 6;         // tiles a second at most
const SNAP = 9;          // tiles: further than this, an animal is set down at its place
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Which way it faces, from a step. */
function _facing(dx, dy, was = 'down') {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return was;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

/** A little generator of its own (the street map's dice are not the world's). */
let _seed = 0x2545F491;
function _rand() {
    _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
    return ((_seed >>> 0) % 100000) / 100000;
}

function _notify(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

export const InnerMapPets = {
    _pets: [],       // [{ a, x, y, facing, moving, t, walkHold, stay, fighting, atkT, swingT, fly }]
    _trail: [],
    _heading: { x: 0, y: -1 },
    _sig: '',
    _map: null,
    _shown: false,
    _stray: null,    // { key, x, y, home, tx, ty, wait, facing, moving, t }
    _told: new Set(),

    _hidden(game) {
        return !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active
            || !game || !game.player || game.player.boardedShip;
    },

    /** How many walk in the file behind you (the flyers don't). */
    count() {
        if (!InnerMapPets._shown) return 0;
        // (in places in the file: a led horse takes three)
        return InnerMapPets._pets.filter(p => !p.fly && !p.stay).reduce((n, p) => n + (p.a && p.a.id === 'mount' ? 3 : 1), 0);
    },

    /** The animals that walk with you now, horse first (it's led on the rein right behind). */
    walkers(player, world = null) {
        return AnimalCompanions.travelling(player, world)
            .filter(a => StreetFollowers.walks(player, StreetFollowers.animalKey(a.id)))
            .sort((a, b) => (b.id === 'mount') - (a.id === 'mount'));
    },

    /** Its look: the sheets and frame layout (data/animalCompanions.json sprite, or an animals.json species). */
    sprite(a) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        const cache = InnerMapPets._sprites || (InnerMapPets._sprites = new Map());
        const breed = AnimalCompanions.breed(a.species, a.breed) || {};
        const key = `${a.species}|${a.breed}`;
        if (cache.has(key)) return cache.get(key);
        let out = null;
        if (sp.spriteFrom && InnerMap.animalSpecies) {
            const base = InnerMap.animalSpecies(sp.spriteFrom, InnerMap.animalConfig());
            if (base) out = { ...base, scale: _num(base.scale, 1) * _num(sp.spriteScale, 1) };
        } else if (sp.sprite) {
            out = { ...sp.sprite, scale: _num(sp.sprite.scale, 1) * _num(breed.scale, 1) };
        }
        cache.set(key, out);
        return out;
    },

    _sync(game, at) {
        const P = InnerMapPets;
        const list = P.walkers(game.player, game.world);
        const sig = list.map(a => `${a.id}:${a.species}:${a.breed}`).join('|');
        if (sig === P._sig && P._pets.length === list.length) {
            // (the same animals: keep each record pointing at the live one, renamed or fed)
            P._pets.forEach((p, i) => { p.a = list[i]; });
            return;
        }
        P._sig = sig;
        const old = new Map(P._pets.map(p => [p.a.id, p]));
        const born = P._spawnAt || {};
        P._pets = list.map((a, i) => {
            const was = old.get(a.id);
            const sp = AnimalCompanions.species(a.species) || {};
            const from = born[a.id];
            return {
                a, fly: !!sp.flies,
                x: was ? was.x : from ? from.x : at.x + (i % 2 ? 1 : -1) * T_PX * 0.4, y: was ? was.y : from ? from.y : at.y + T_PX * SPACING * (i + 1),
                facing: was ? was.facing : 'down', moving: false, t: i * 0.37, walkHold: 0,
                stay: was ? was.stay : null, fighting: false, atkT: 0, swingT: null, angle: i * 1.7,
            };
        });
        P._spawnAt = {};
    },

    _along(at, d) {
        let left = d;
        let px = at.x, py = at.y;
        const trail = InnerMapPets._trail;
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
        const h = InnerMapPets._heading;
        return { x: px - h.x * left, y: py - h.y * left };
    },

    update(dt, game) {
        const P = InnerMapPets;
        P._shown = false;
        if (P._hidden(game)) {
            if (!InnerMap.active) { P._pets = []; P._trail = []; P._sig = ''; P._map = null; P._stray = null; }
            return;
        }
        const at = InnerMap.getPlayerWorldPos();
        if (P._map !== InnerMap.tiles) {
            P._map = InnerMap.tiles;
            P._trail = []; P._pets = []; P._sig = ''; P._heading = { x: 0, y: -1 };
            P._stray = null; P._strayChecked = false;
            P._told = new Set();
        }
        try { P._updateStray(dt, game, at); } catch { P._stray = null; }
        P._sync(game, at);
        if (!P._pets.length) return;
        P._shown = true;
        const last = P._trail[P._trail.length - 1];
        if (!last || Math.hypot(last.x - at.x, last.y - at.y) >= T_PX * 0.4) {
            if (last) {
                const d = Math.hypot(at.x - last.x, at.y - last.y) || 1;
                P._heading = { x: (at.x - last.x) / d, y: (at.y - last.y) / d };
            }
            P._trail.push({ x: at.x, y: at.y });
            if (P._trail.length > 80) P._trail.splice(0, P._trail.length - 80);
        }
        const step = SPEED * T_PX * Math.max(0, Math.min(dt, 0.1));
        let foe = null, fc = null;
        try { foe = InnerMapEscort._foe(game); fc = InnerMapEscort._fightCfg(); } catch { foe = null; }
        const lead = InnerMapCompanions.count() * 0.9;
        P._growl(game);
        let slot = 0, back = lead;
        for (const m of P._pets) {
            m.t += dt;
            if (m.fly) { P._flyAbout(m, dt, at); continue; }
            let tx, ty;
            m.fighting = false;
            const dmg = foe && !m.stay ? AnimalCompanions.streetDamage(m.a, game.world) : 0;
            if (dmg > 0) {
                const fp = InnerMapEscort._foePos(foe);
                const ang = (slot / Math.max(1, P._pets.length)) * Math.PI * 2 + 1.1;
                tx = fp.x + Math.cos(ang) * T_PX * 0.8;
                ty = fp.y + Math.sin(ang) * T_PX * 0.6;
                if (Math.hypot(fp.x - m.x, fp.y - m.y) <= fc.reach * T_PX) {
                    m.fighting = true;
                    m.facing = _facing(fp.x - m.x, fp.y - m.y, m.facing);
                    m.swingT = (m.swingT == null ? 0.3 : m.swingT) + dt;
                    if (m.swingT >= fc.swingEvery * 0.8) {
                        m.swingT = 0;
                        m.atkT = 0;
                        InnerMapEscort._strike(game, m, foe, dmg);
                    }
                }
            } else if (m.stay) {
                m.swingT = null;
                tx = m.stay.x; ty = m.stay.y;
            } else {
                m.swingT = null;
                // (the horse, long as it is, on its rein a good step behind; the dogs and cats a little to one side)
                back += m.a.id === 'mount' ? HORSE_GAP : SPACING;
                const pt = P._along(at, T_PX * back);
                if (m.a.id === 'mount') back += HORSE_GAP - SPACING;
                // (to the side of the way you're going, not of the map)
                const side = m.a.id === 'mount' ? 0 : (slot % 2 ? 1 : -1) * T_PX * 0.35;
                tx = pt.x - P._heading.y * side; ty = pt.y + P._heading.x * side;
            }
            if (!m.stay) slot++;
            m.atkT += dt;
            const dx = tx - m.x, dy = ty - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SNAP * T_PX) { m.x = tx; m.y = ty; m.moving = false; m.walkHold = 0; continue; }
            let moved = 0;
            if (dist > 0.5) {
                const k = Math.min(1, step * (dist > T_PX * 2 ? 1.6 : 1) / dist);
                m.x += dx * k;
                m.y += dy * k;
                moved = dist * k;
            }
            if (dt > 0 && moved / dt > T_PX * 0.5) {
                m.walkHold = 0.2;
                if (!m.fighting) m.facing = _facing(dx, dy, m.facing);
            } else m.walkHold = Math.max(0, (m.walkHold || 0) - dt);
            m.moving = m.walkHold > 0 && !m.fighting;
            if (!m.moving && !m.fighting && !m.stay && P._trail.length > 1) m.facing = _facing(P._heading.x, P._heading.y, m.facing);
        }
    },

    /** A hawk wheels about you, high up, its shadow on the ground. */
    _flyAbout(m, dt, at) {
        const target = m.stay || at;
        m.angle = _num(m.angle) + dt * 0.9;
        const r = T_PX * 1.6;
        const nx = target.x + Math.cos(m.angle) * r;
        const ny = target.y + Math.sin(m.angle) * r * 0.55;
        const dx = nx - m.x, dy = ny - m.y;
        const d = Math.hypot(dx, dy);
        const k = d > T_PX * 6 ? 1 : Math.min(1, (T_PX * 7 * Math.min(dt, 0.1)) / Math.max(1, d));
        m.x += dx * k; m.y += dy * k;
        m.facing = _facing(-Math.sin(m.angle), Math.cos(m.angle) * 0.55, m.facing);
        m.moving = true;
    },

    /** A dog growls once at each beast that starts to stalk you. */
    _growl(game) {
        const P = InnerMapPets;
        const dog = P._pets.find(m => m.a.species === 'dog' && !m.stay);
        if (!dog) return;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        for (const b of InnerMap.animals || []) {
            if (!b || (b.state !== 'stalk' && b.state !== 'charge') || P._told.has(b)) continue;
            const p = InnerMap.animalPos(b);
            if (Math.max(Math.abs(p.q - me.q), Math.abs(p.r - me.r)) > 12) continue;
            P._told.add(b);
            const sp = InnerMap.animalSpecies(b.species, InnerMap.animalConfig()) || {};
            _notify(game, `${AnimalCompanions.icon(dog.a)} ${dog.a.name} Growls`, AnimalCompanions.line('growl', { name: dog.a.name, what: `a ${String(sp.name || b.species).toLowerCase()}` }), 'warning');
        }
    },

    // ── The stray ──

    _walkable(q, r) {
        const t = InnerMap.getTile && InnerMap.getTile(q, r);
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.building && !t.customObject && !t.customBuilding && !t.customBuildingPart);
    },

    _settlement(game) {
        const w = game && game.world;
        const p = game && game.player;
        const t = w && typeof w.getTile === 'function' && p ? w.getTile(p.q, p.r) : null;
        return (t && t.settlement) || null;
    },

    _updateStray(dt, game, at) {
        const P = InnerMapPets;
        const s = P._settlement(game);
        if (!s) { P._stray = null; return; }
        const info = AnimalCompanions.strayAt(game.world, s, game.player);
        if (!info) { P._stray = null; return; }
        if (!P._stray || P._stray.key !== info.key) {
            if (P._strayChecked === info.key) return;
            P._strayChecked = info.key;
            // somewhere a few tiles off, on open ground
            const q0 = InnerMap.playerInnerQ, r0 = InnerMap.playerInnerR;
            _seed = (_seed ^ (q0 * 73856093) ^ (r0 * 19349663)) >>> 0 || 1;
            let spot = null;
            for (let i = 0; i < 40 && !spot; i++) {
                const ang = _rand() * Math.PI * 2, d = 5 + _rand() * 4;
                const q = Math.round(q0 + Math.cos(ang) * d), r = Math.round(r0 + Math.sin(ang) * d);
                if (P._walkable(q, r)) spot = { q, r };
            }
            if (!spot) return;
            const x = spot.q * T_PX + T_PX / 2, y = spot.r * T_PX + T_PX / 2;
            P._stray = { key: info.key, x, y, home: { ...spot }, tx: x, ty: y, wait: 1, facing: 'down', moving: false, t: 0 };
        }
        const S = P._stray;
        S.t += dt;
        S.trust = info.trust;
        // (once it has had something from you it hangs about near you)
        if (info.trust > 0) {
            const d = Math.hypot(at.x - S.x, at.y - S.y);
            if (d > T_PX * 2.5) { S.tx = at.x + T_PX * 1.6; S.ty = at.y + T_PX * 0.6; S.wait = 0; }
        }
        const dx = S.tx - S.x, dy = S.ty - S.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
            const k = Math.min(1, (T_PX * (info.trust > 0 ? 4 : 1.6) * Math.min(dt, 0.1)) / dist);
            S.x += dx * k; S.y += dy * k;
            S.facing = _facing(dx, dy, S.facing);
            S.moving = true;
            return;
        }
        S.moving = false;
        S.wait -= dt;
        if (S.wait > 0 || info.trust > 0) return;
        // sniff about: to a neighbouring open tile near where it was first seen
        const cq = Math.round((S.x - T_PX / 2) / T_PX), cr = Math.round((S.y - T_PX / 2) / T_PX);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const [dq, dr] = dirs[Math.floor(_rand() * 4)];
        const q = cq + dq, r = cr + dr;
        if (P._walkable(q, r) && Math.abs(q - S.home.q) + Math.abs(r - S.home.r) <= 4) { S.tx = q * T_PX + T_PX / 2; S.ty = r * T_PX + T_PX / 2; }
        S.wait = 0.8 + _rand() * 2.5;
    },

    // ── Clicking one ──

    /** Is it on (or just about) the clicked tile? (a pacing animal is hard to land on: a little leeway) */
    _at(m, q, r) {
        const cx = q * T_PX + T_PX / 2, cy = r * T_PX + T_PX / 2;
        return Math.hypot(m.x - cx, m.y - cy) <= T_PX * 0.85;
    },

    petsAt(q, r) {
        if (!InnerMapPets._shown) return [];
        return InnerMapPets._pets.filter(m => InnerMapPets._at(m, q, r) || (m.fly && InnerMapPets._at({ x: m.x, y: m.y + T_PX * 1.4 }, q, r)));
    },

    /** The context menu's entries for your animals (and the stray) on this tile. */
    menuItems(game, q, r) {
        const out = [];
        const player = game && game.player;
        if (!player) return out;
        for (const m of InnerMapPets.petsAt(q, r)) {
            const a = m.a;
            out.push({ type: 'header', label: `${AnimalCompanions.icon(a)} ${a.name} — ${AnimalCompanions.kindName(a)}, ${AnimalCompanions.ageText(a, game.world)}` });
            out.push({ type: 'disabled', label: `💛 Bond ${Math.round(_num(a.bond))} · 🍖 Belly ${Math.round(_num(a.hunger))} · ❤️ Health ${Math.round(_num(a.health))}` });
            out.push({ type: 'action', action: 'pet_pet', petId: a.id, label: a.species === 'hawk' ? 'Call to the Fist' : 'Pet', icon: '🤚', desc: 'A moment\'s fuss: it trusts you more (once a day counts)' });
            const foods = AnimalCompanions.foodsFor(player, a);
            if (foods.length) out.push({ type: 'action', action: 'pet_feed', petId: a.id, label: `Feed (${foods[0].id.replace(/_/g, ' ')})`, icon: '🍖', desc: `From your packs: ${foods.map(f => `${f.id.replace(/_/g, ' ')} ×${f.have}`).join(', ')}` });
            else out.push({ type: 'disabled', label: `🍖 Nothing in your packs ${a.name} will eat` });
            if (m.stay) out.push({ type: 'action', action: 'pet_come', petId: a.id, label: 'Come Along', icon: '👣', desc: `${a.name} falls in behind you again` });
            else out.push({ type: 'action', action: 'pet_stay', petId: a.id, label: 'Stay Here', icon: '✋', desc: `${a.name} waits on this spot until you call it (or leave the map)` });
            out.push({ type: 'action', action: 'pet_wait', petId: a.id, label: 'Wait at the Inn', icon: '🏠', desc: 'Leave it at your lodging or camp while you walk the streets (Who Walks With You)' });
            out.push({ type: 'action', action: 'pet_card', petId: a.id, label: 'Its Card', icon: '📜', desc: 'Name, age, what it does for you; rename it, keep it at home' });
            out.push({ type: 'separator' });
        }
        const S = InnerMapPets._stray;
        if (S && InnerMapPets._at(S, q, r)) {
            const s = InnerMapPets._settlement(game);
            const info = s ? AnimalCompanions.strayAt(game.world, s, player) : null;
            if (info) {
                const need = AnimalCompanions.config().strayTrust;
                out.push({ type: 'header', label: '🐕 A Stray Dog' });
                out.push({ type: 'disabled', label: info.trust > 0 ? `It watches you, wagging a little (trust ${Math.round(info.trust)}/${need})` : 'Thin, wary, nosing in the gutter for scraps' });
                const sp = AnimalCompanions.species('dog') || {};
                const inv = player.inventory || {};
                const foods = Object.keys(sp.eats || {}).filter(id => _num(inv[id]) >= 1).slice(0, 3);
                for (const f of foods) out.push({ type: 'action', action: 'pet_stray', food: f, label: `Offer it ${f.replace(/_/g, ' ')}`, icon: '🍖', desc: `Win it over (${f.replace(/_/g, ' ')} ×${Math.floor(_num(inv[f]))} in your packs)` });
                if (!foods.length) out.push({ type: 'disabled', label: '🍖 You have nothing a dog would eat (meat, fish, bread, eggs)' });
                out.push({ type: 'separator' });
            }
        }
        return out;
    },

    /** A menu choice of ours? (true when handled) */
    handle(game, item) {
        if (!item || !/^pet_/.test(item.action || '')) return false;
        const player = game.player, world = game.world;
        const m = InnerMapPets._pets.find(p => p.a && p.a.id === item.petId);
        let res = null;
        switch (item.action) {
            case 'pet_pet': res = AnimalCompanions.pet(player, item.petId, world); break;
            case 'pet_feed': res = AnimalCompanions.feed(player, item.petId, null, world); break;
            case 'pet_stay': if (m) { m.stay = { x: m.x, y: m.y }; res = { success: true, text: `${m.a.name} sits and stays.` }; } break;
            case 'pet_come': if (m) { m.stay = null; res = { success: true, text: `${m.a.name} comes running.` }; } break;
            case 'pet_wait': {
                StreetFollowers.set(player, StreetFollowers.animalKey(item.petId), false);
                const a = AnimalCompanions.get(player, item.petId);
                res = { success: true, text: `${a ? a.name : 'It'} goes back to wait for you.` };
                break;
            }
            case 'pet_card': AnimalsPanel.show(game, item.petId); return true;
            case 'pet_stray': {
                const s = InnerMapPets._settlement(game);
                const S = InnerMapPets._stray;
                res = AnimalCompanions.offerFood(world, player, s, item.food);
                if (res.success && res.joined && S) {
                    InnerMapPets._spawnAt = { [res.animal.id]: { x: S.x, y: S.y } };
                    InnerMapPets._stray = null;
                    _notify(game, `🐕 ${res.animal.name}`, res.text, 'success');
                    return true;
                }
                break;
            }
            default: return false;
        }
        if (res) _notify(game, res.success ? '🐾 Your Animals' : '🐾 Not Now', res.success ? res.text : res.reason, res.success ? 'info' : 'warning');
        if (game.ui && game.ui.updateStats) game.ui.updateStats(player, world);
        return true;
    },

    // ── Drawing ──

    _drawOne(ctx, m, sp, fx, fy, ds, o = {}) {
        const pseudo = {
            id: m.a.id, facing: m.facing, state: m.fighting && m.atkT < 0.5 && sp.sheets && sp.sheets.attack ? 'attack' : 'walk',
            moving: !!m.moving || !!o.flying, animT: m.t, atkT: m.atkT, hp: 1, maxHp: 1,
        };
        if (!InnerMapAnimals.drawAt(ctx, pseudo, sp, fx, fy, ds, { noShadow: !!o.noShadow })) {
            ctx.save();
            ctx.fillStyle = 'rgba(120,85,50,0.9)';
            ctx.beginPath(); ctx.ellipse(fx, fy - ds * 0.2, ds * 0.25, ds * 0.15, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    },

    collect(items, ctx, camera, T) {
        const P = InnerMapPets;
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const k = T / T_PX;
        const off = (sx, sy) => sx < -ds * 4 || sx > W + ds * 4 || sy < -ds * 4 || sy > H + ds * 4;
        if (P._shown) {
            for (const m of P._pets) {
                const sp = P.sprite(m.a);
                if (!sp) continue;
                const wx = m.x * k, wy = m.y * k;
                const s = camera.worldToScreenFast(wx, wy);
                const sx = s.x, sy = s.y;
                if (off(sx, sy)) continue;
                if (m.fly) {
                    // high overhead: its shadow on the ground, the bird well above
                    const alt = ds * 1.5;
                    items.push({ sortY: wy, zLayer: 1, sortX: wx / T, draw: () => {
                        ctx.save();
                        ctx.globalAlpha = 0.22;
                        ctx.fillStyle = '#000';
                        ctx.beginPath(); ctx.ellipse(sx, sy + ds * 0.3, ds * 0.32, ds * 0.1, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.restore();
                    } });
                    items.push({ sortY: wy + T * 6, zLayer: 3, sortX: wx / T, draw: () => P._drawOne(ctx, m, sp, sx, sy + ds * 0.3 - alt, ds, { noShadow: true, flying: true }) });
                    continue;
                }
                items.push({ sortY: wy + T / 2, zLayer: 2, sortX: wx / T, draw: () => P._drawOne(ctx, m, sp, sx, sy + ds * 0.3, ds) });
            }
        }
        const S = P._stray;
        if (S) {
            const sp = P.sprite({ species: 'dog', breed: 'mutt' });
            if (sp) {
                const wx = S.x * k, wy = S.y * k;
                const s = camera.worldToScreenFast(wx, wy);
                const sx = s.x, sy = s.y;
                const tile = InnerMap.getTile && InnerMap.getTile(Math.round((S.x - T_PX / 2) / T_PX), Math.round((S.y - T_PX / 2) / T_PX));
                if (!off(sx, sy) && (!tile || tile.visible !== false)) {
                    const m = { a: { id: 'stray' }, facing: S.facing, moving: S.moving, t: S.t, atkT: 9 };
                    items.push({ sortY: wy + T / 2, zLayer: 2, sortX: wx / T, draw: () => P._drawOne(ctx, m, sp, sx, sy + ds * 0.3, ds) });
                }
            }
        }
    },
};
