// ============================================
// INNER MAP BATTLE — the battlefield on the hex's own street map
// ============================================
// A field battle fought where it happens: the inner map of the hex is the
// battlefield (same renderer, same ground, trees, water), both armies stand
// on it as companies of LPC soldiers, and the player commands them. The
// fight itself is player/battlefield.js (pure, seeded); this is its eyes and
// hands:
//
//   open(game, battle, opts)   enter the hex's map (if not there), find the
//                              open ground, draw both armies up, the HUD
//   start(game, { enemy, ctx, hex, objective, onDone })
//                              FieldBattle.start + open: the entry point for
//                              any caller with an enemy description
//   openHost(game, spec, opts) a realm's host (player/generalship.js spec):
//                              onDone gets Generalship's outcome shape
//   update(dt, game)           the fixed-step ticks (paused / 1× / 2× / 4×),
//                              the commander (the player's own figure) kept
//                              behind the company they lead, the camera, the
//                              particles from the battle's events
//   collect(items, …)          the figures, horses, the fallen into the
//                              depth-sorted pass (innerMapLayers/entities.js)
//   renderOverlay(ctx, camera) arrows in flight, dust, blood, the company
//                              plates, the orders drawn on the ground
//   click / key                select (click, shift-click, 1-9, 0), orders
//                              (right-click ground: march; right-click a foe:
//                              charge or loose; H hold, C charge, F loose,
//                              B fall back, L lead), Space pause, WASD/arrows pan
//
// Figures are composited from LPC layers by the recipes in data/military.json
// → battlefield.looks (registered once with InnerMapCharacters.registerPreset),
// horses are the game's horse sheets (InnerMapAnimals.drawAt). Only arrows,
// dust and blood are drawn in code.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { Battlefield } from '../player/battlefield.js';
import { Arms } from '../systems/arms.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { esc } from './actionMenu/uiKit.js';
import { Hotbar } from './hotbar.js';

const HUD_ID = 'battlefieldHud';
const SPEEDS = [1, 2, 4];

function _hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** A visual-only pseudo-random in [0,1) (particles: never the battle's dice). */
let _fxSeed = 1;
function _fx() {
    _fxSeed = (_fxSeed * 1103515245 + 12345) & 0x7fffffff;
    return _fxSeed / 0x7fffffff;
}

export const InnerMapBattle = {
    active: false,
    bf: null,
    battle: null,
    game: null,
    opts: null,
    speed: 1,
    paused: false,
    _acc: 0,
    selected: new Set(),
    cam: null,
    particles: [],
    _keys: {},
    _presetsReady: false,
    _looks: new Map(),     // company id → [presetId per variant]
    _lastField: null,      // the field just fought: its fallen stay on the map
    _cmdT: 0,
    _ending: false,

    // ── Entry points ───────────────────────────────────────────────────

    /**
     * Fight `enemy` ({ strength, name, type?, unitId?, composition?, purse? })
     * on the battlefield. ctx as FieldBattle.start (terrainId, defending,
     * ambushed, weather). opts: { hex {q,r}, objective {type:'rout'|'hold',
     * seconds}, title, onDone(result, bf) }. False if there is nothing to
     * fight with.
     */
    start(game, { enemy, ctx = {}, hex = null, objective = null, title = null, onDone = null, layout = null } = {}) {
        const battle = FieldBattle.start(game.player, enemy, game.world, ctx);
        if (!battle || battle.success === false) return Promise.resolve(false);
        return InnerMapBattle.open(game, battle, { hex, objective, title, onDone, enemy, layout, ...(enemy.purse !== undefined ? { lootPurse: enemy.purse } : {}) });
    },

    /**
     * A realm's host in the field (Generalship.prepareBattle's spec). onDone
     * receives Battlefield.hostOutcome — { victory, hostLost, enemyLost,
     * retinueLost, withdrew } — ready for Generalship.settleBattle.
     */
    openHost(game, spec, { onDone = null, title = null } = {}) {
        const battle = Battlefield.hostBattle(game.player, game.world, spec);
        const where = spec.where || {};
        return InnerMapBattle.open(game, battle, {
            hex: { q: where.q, r: where.r },
            objective: spec.kind === 'assault' || spec.kind === 'raid' ? { type: 'rout' } : null,
            // Storming a town or falling on a village: their men in the streets, yours from outside
            layout: spec.kind === 'assault' || spec.kind === 'raid' ? 'assault' : null,
            title: title || `${spec.host.kingdomName || 'Your host'} against ${spec.enemy.kingdomName || 'the enemy'}`,
            host: spec,
            liveries: { player: InnerMapBattle._realmLivery(spec.host.kingdomId), enemy: InnerMapBattle._realmLivery(spec.enemy.kingdomId) },
            onDone,
        });
    },

    /**
     * The battle `battle` (a FieldBattle.start battle) fought on the map of
     * opts.hex (the player's hex by default). Enters that map first when the
     * player is elsewhere. Resolves true once the armies stand on the field.
     */
    async open(game, battle, opts = {}) {
        if (InnerMapBattle.active) return false;
        const hex = opts.hex && typeof opts.hex.q === 'number' ? opts.hex : { q: game.player.q, r: game.player.r };
        try {
            await InnerMapBattle._enterMap(game, hex);
        } catch (err) {
            console.warn('[InnerMapBattle] could not enter the map:', err);
        }
        if (!InnerMap.active || !InnerMap.tiles) return false;
        const field = InnerMapBattle._fieldFromMap();
        const prefer = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const area = Battlefield.pickArea(field, prefer, Math.min(48, field.w - 4), Math.min(26, field.h - 4));
        const bf = Battlefield.create(game.player, battle, field, {
            area, objective: opts.objective || null, enemy: opts.enemy || null, world: game.world, layout: opts.layout || null,
            ...(opts.lootPurse !== undefined ? { lootPurse: opts.lootPurse } : {}),
        });
        InnerMapBattle.active = true;
        InnerMapBattle.bf = bf;
        InnerMapBattle.battle = battle;
        InnerMapBattle.game = game;
        InnerMapBattle.opts = opts;
        InnerMapBattle.speed = 1;
        InnerMapBattle.paused = true; // the armies are drawn up: the player gives the word
        InnerMapBattle._acc = 0;
        InnerMapBattle._ending = false;
        InnerMapBattle.particles = [];
        InnerMapBattle._lastField = null;
        InnerMapBattle.selected = new Set(bf.companies.filter(c => c.side === 'player').slice(0, 1).map(c => c.id));
        // The ground of the battle in sight, end to end
        for (let r = Math.max(0, Math.floor(bf.area.y0) - 6); r <= Math.min(field.h - 1, Math.ceil(bf.area.y1) + 6); r++) {
            for (let q = 0; q < field.w; q++) {
                const t = InnerMap.tiles[r][q];
                if (t) { t.explored = true; t.visible = true; }
            }
        }
        // The player stands where the commander stands
        InnerMap.cancelPlayerWalk && InnerMap.cancelPlayerWalk();
        InnerMap.playerInnerQ = Math.round(bf.commander.x);
        InnerMap.playerInnerR = Math.round(bf.commander.y);
        InnerMapRenderer._playerFacing = bf.sides.player.dir > 0 ? InnerMapCharacters.DIR_RIGHT : InnerMapCharacters.DIR_LEFT;
        // The camera: pulled back to see the field, over the middle of it
        const cam = game.innerMapCamera;
        InnerMapBattle._savedZoom = { min: cam.minZoom, zoom: cam.zoom, target: cam.targetZoom };
        const T = InnerMapRenderer.tileSize;
        const fit = Math.min(game.canvas.width / ((bf.area.x1 - bf.area.x0 + 6) * T), game.canvas.height / ((bf.area.y1 - bf.area.y0 + 10) * T));
        cam.minZoom = Math.min(cam.minZoom, Math.max(0.35, fit * 0.8));
        cam.targetZoom = Math.max(cam.minZoom, Math.min(cam.zoom, fit));
        InnerMapBattle.cam = { x: bf.area.cx * T + T / 2, y: bf.area.cy * T + T / 2 };
        cam.centerOn(InnerMapBattle.cam.x, InnerMapBattle.cam.y);
        InnerMapBattle._looks.clear();
        InnerMapBattle._registerLooks(game, bf, opts);
        InnerMapBattle._bindKeys(true);
        InnerMapBattle._buildHud();
        // (the street map's hotbar makes way for the companies)
        Hotbar.hide();
        if (game.ui) game.ui.hideCustomPanel();
        game.ui && game.ui.showNotification('⚔️ The Field',
            `Your companies are drawn up against the ${battle.enemyName}. Select them (click, 1-9), right-click to march or charge — Space to begin.`, 'info');
        return true;
    },

    /** Enter the hex's map (leaving a building, or another hex's map, first). */
    async _enterMap(game, hex) {
        const here = InnerMap.active && InnerMap.currentWorldTile;
        if (InnerMap.active && InnerMap._insideBuilding && typeof game._leaveBuilding === 'function') game._leaveBuilding();
        if (InnerMap.active && here && here.q === hex.q && here.r === hex.r) return;
        if (InnerMap.active) game.exitInnerMap({ quiet: true });
        await game.enterInnerMap(hex.q, hex.r);
    },

    /** The street map as the battle's ground. */
    _fieldFromMap() {
        const tiles = InnerMap.tiles;
        const h = tiles.length, w = h ? tiles[0].length : 0;
        const at = (q, r) => (q >= 0 && r >= 0 && q < w && r < h ? tiles[r][q] : null);
        const COVER = new Set(['trees', 'brush']);
        const SLOW = new Set(['mud', 'marsh', 'swamp', 'snow', 'sand', 'tall_grass']);
        return {
            w, h,
            pass: (q, r) => {
                const t = at(q, r);
                return !!(t && t.subTerrain && t.subTerrain.passable && !t.building && t.subTerrain.id !== 'cliff');
            },
            cover: (q, r) => {
                const t = at(q, r);
                return t && t.subTerrain && COVER.has(t.subTerrain.id) ? 1 : 0;
            },
            slow: (q, r) => {
                const t = at(q, r);
                if (!t || !t.subTerrain) return 1;
                if (t.road) return 1.1;
                if (COVER.has(t.subTerrain.id)) return 0.65;
                return SLOW.has(t.subTerrain.id) ? 0.75 : 1;
            },
            // Built-up ground: streets, houses and their yards (pickArea keeps out of it)
            town: (q, r) => {
                for (let dy = -3; dy <= 3; dy += 3) {
                    for (let dx = -3; dx <= 3; dx += 3) {
                        const t = at(q + dx, r + dy);
                        if (t && (t.road || t.building || t.customBuilding || t.lot)) return true;
                    }
                }
                return false;
            },
            high: (q, r) => {
                const t = at(q, r);
                return t && t._cragTop ? 1 : 0;
            },
        };
    },

    // ── Looks ──────────────────────────────────────────────────────────

    _lookCfg() {
        return Battlefield.config().looks || {};
    },

    /** A realm's livery from data (picked by its id). */
    _realmLivery(kingdomId) {
        const L = (InnerMapBattle._lookCfg().liveries || {});
        const list = L.realms || [];
        if (!list.length) return null;
        return list[_hash(String(kingdomId || 'realm')) % list.length];
    },

    /** The livery a side wears. */
    _livery(bf, side, opts) {
        const L = InnerMapBattle._lookCfg().liveries || {};
        if (opts && opts.liveries && opts.liveries[side]) return opts.liveries[side];
        if (side === 'player') return L.player || { shirt: 'Navy', paint: 'Blue', legs: 'Charcoal', plume: 'White' };
        if (bf.enemyInfo.rabble) return null; // mismatched: each man his own
        const unit = bf.battle.unitId && InnerMapBattle.game && InnerMapBattle.game.world.units.find(u => u.id === bf.battle.unitId);
        const realm = unit && (unit.kingdom || unit.kingdomId);
        return InnerMapBattle._realmLivery(realm || bf.enemyLabel);
    },

    /**
     * The layers a figure of company `c` wears: its unit type's recipe or its
     * kind's, the side's livery, skin and hair by variant. Your own men wear
     * the arms they were issued in place of the recipe's (Arms.lookLayers).
     */
    layersFor(bf, c, variant, opts) {
        const looks = InnerMapBattle._lookCfg();
        const R = looks.recipes || {};
        const rabble = c.side === 'enemy' && bf.enemyInfo.rabble;
        const recipe = (rabble && R[`${c.kind}_rabble`]) || (c.typeId && R[c.typeId]) || R[c.kind] || R.foot || [];
        const skins = looks.skins || ['Peach'];
        const hairs = looks.hairs || ['Short 01 - Buzzcut/Brown'];
        const rab = ((looks.liveries || {}).rabble || [{ shirt: 'Brown', legs: 'Charcoal', paint: 'Brown', plume: 'Black' }]);
        const h = _hash(`${c.side}:${c.kind}:${variant}${c.guard != null ? `:${c.guard}` : ''}`);
        // (a realm's household guard riding with you wears its realm's livery: player/realmEscort.js)
        const liv = (c.guard != null && InnerMapBattle._realmLivery(c.guard)) || InnerMapBattle._livery(bf, c.side, opts) || rab[h % rab.length];
        const fill = { skin: skins[h % skins.length], hair: hairs[(h >>> 4) % hairs.length], shirt: liv.shirt, legs: liv.legs || 'Charcoal', paint: liv.paint || 'Red', plume: liv.plume || 'White' };
        const layers = recipe.map(l => l.replace(/\{(\w+)\}/g, (_, k) => fill[k] || ''));
        // Your soldiers show the arms they were issued (systems/arms.js kits): one man of the company per variant
        const armed = c.side === 'player' && Array.isArray(c.units) ? c.units.filter(u => u && u.kit) : [];
        return armed.length ? Arms.lookLayers(layers, Arms.kitView(armed[variant % armed.length]), { paint: fill.paint }) : layers;
    },

    _registerLooks(game, bf, opts) {
        const n = Math.max(1, Number(InnerMapBattle._lookCfg().variants) || 3);
        const waits = [];
        for (const c of bf.companies) {
            const ids = [];
            for (let v = 0; v < n; v++) {
                const layers = InnerMapBattle.layersFor(bf, c, v, opts);
                const id = `bf:${_hash(layers.join('|')).toString(36)}`;
                ids.push(id);
                if (!InnerMapCharacters.getComposited(id) && !InnerMapBattle._pending?.has(id)) {
                    InnerMapBattle._pending = InnerMapBattle._pending || new Set();
                    InnerMapBattle._pending.add(id);
                    waits.push(InnerMapCharacters.registerPreset(id, layers).finally(() => InnerMapBattle._pending.delete(id)));
                }
            }
            InnerMapBattle._looks.set(c.id, ids);
        }
        InnerMapBattle._presetsReady = !waits.length;
        Promise.all(waits).then(() => { InnerMapBattle._presetsReady = true; });
    },

    _presetOf(c, f) {
        const ids = InnerMapBattle._looks.get(c.id);
        return ids ? ids[f.i % ids.length] : null;
    },

    // ── The frame ─────────────────────────────────────────────────────

    update(dt, game) {
        const B = InnerMapBattle;
        if (!B.active) return;
        if (!InnerMap.active) { B._close(); return; }
        // Settled from elsewhere (the day ended, the captains took over): just close
        if (B.battle.done && !B._ending) { B._close(); return; }
        const cfg = Battlefield.config();
        if (!B.paused && !B.bf.over) {
            B._acc += dt * B.speed;
            let guard = 40;
            while (B._acc >= cfg.step && guard-- > 0 && !B.bf.over) {
                B._acc -= cfg.step;
                Battlefield.tick(B.bf);
                B._drainEvents();
            }
            if (!B.battle.host) Battlefield.sync(B.bf);
        }
        B._tickParticles(B.paused ? 0 : dt * B.speed);
        B._followCommander(game, dt);
        B._panCamera(game, dt);
        B._updateHud();
        if (B.bf.over && !B._ending) {
            B._ending = true;
            setTimeout(() => B._finish(), 1600);
        }
    },

    /** The player's own figure: walked to where the commander stands. */
    _followCommander(game, dt) {
        const cm = InnerMapBattle.bf.commander;
        if (!cm) return;
        InnerMapBattle._cmdT -= dt;
        if (InnerMapBattle._cmdT > 0) return;
        InnerMapBattle._cmdT = 0.5;
        const q = Math.round(cm.x), r = Math.round(cm.y);
        if (Math.abs(q - InnerMap.playerInnerQ) + Math.abs(r - InnerMap.playerInnerR) >= 2) InnerMap.movePlayerTo(q, r);
    },

    _panCamera(game, dt) {
        const k = InnerMapBattle._keys;
        const cam = game.innerMapCamera;
        const v = 520 / Math.max(0.3, cam.zoom) * dt;
        const c = InnerMapBattle.cam;
        if (k.a || k.arrowleft) c.x -= v;
        if (k.d || k.arrowright) c.x += v;
        if (k.w || k.arrowup) c.y -= v;
        if (k.s || k.arrowdown) c.y += v;
        const T = InnerMapRenderer.tileSize;
        c.x = Math.max(0, Math.min(InnerMap.width * T, c.x));
        c.y = Math.max(0, Math.min(InnerMap.height * T, c.y));
    },

    /** Where the camera looks (ui/game/gameLoop.js follows it while the battle is on). */
    cameraTarget() {
        return InnerMapBattle.cam;
    },

    // ── Events → particles ─────────────────────────────────────────────

    _drainEvents() {
        const B = InnerMapBattle;
        const bf = B.bf;
        for (const e of bf.events) {
            if (e.type === 'volley') {
                const a = bf.companies.find(c => c.id === e.from);
                const b = bf.companies.find(c => c.id === e.to);
                if (!a || !b) continue;
                const shooters = a.figures.filter(f => f.alive);
                const marks = b.figures.filter(f => f.alive);
                for (const f of shooters) {
                    const m = marks[Math.floor(_fx() * marks.length)] || b;
                    B.particles.push({ kind: 'arrow', x0: f.x, y0: f.y, x1: m.x + (_fx() - 0.5) * 1.6, y1: m.y + (_fx() - 0.5) * 1.2, t: -_fx() * 0.35, dur: Math.max(0.4, e.flight), arc: 1.2 + e.flight * 1.4 });
                }
            } else if (e.type === 'fall') {
                for (let i = 0; i < 6; i++) B.particles.push({ kind: 'blood', x: e.x + (_fx() - 0.5) * 0.4, y: e.y + (_fx() - 0.5) * 0.3, vx: (_fx() - 0.5) * 1.6, vz: 1 + _fx() * 1.8, z: 0.8, t: 0, dur: 0.7 });
            } else if (e.type === 'blow') {
                if (_fx() < 0.6) for (let i = 0; i < 2; i++) B.particles.push({ kind: 'blood', x: e.x + (_fx() - 0.5) * 2, y: e.y + (_fx() - 0.5) * 1.5, vx: (_fx() - 0.5) * 1.2, vz: 0.8 + _fx(), z: 0.9, t: 0, dur: 0.5 });
            } else if (e.type === 'clash') {
                for (let i = 0; i < (e.horse ? 14 : 8); i++) B.particles.push({ kind: 'dust', x: e.x + (_fx() - 0.5) * 3, y: e.y + (_fx() - 0.5) * 2, r: 0.4 + _fx() * 0.6, t: 0, dur: 1.2 + _fx() });
            }
        }
        bf.events.length = 0;
        // Horse at the gallop raise dust
        for (const c of bf.companies) {
            if (c.kind !== 'horse' || !c.moving || _fx() > 0.35) continue;
            const f = c.figures.find(x => x.alive && x.moving);
            if (f) B.particles.push({ kind: 'dust', x: f.x - c.dx * 0.8, y: f.y + 0.2, r: 0.3 + _fx() * 0.3, t: 0, dur: 0.8 });
        }
        if (B.particles.length > 900) B.particles.splice(0, B.particles.length - 900);
    },

    _tickParticles(dt) {
        const B = InnerMapBattle;
        if (!dt) return;
        B.particles = B.particles.filter(p => {
            p.t += dt;
            if (p.kind === 'blood') {
                p.x += p.vx * dt;
                p.z += p.vz * dt;
                p.vz -= 9 * dt;
                if (p.z < 0) { p.z = 0; p.vx = 0; p.vz = 0; }
            }
            return p.t < p.dur + (p.kind === 'blood' ? 6 : 0);
        });
    },

    // ── Drawing ───────────────────────────────────────────────────────

    /** The figures in the depth-sorted pass (innerMapLayers/entities.js). */
    collect(items, ctx, camera, T) {
        const B = InnerMapBattle;
        const bf = B.bf || B._lastField;
        if (!bf || !InnerMap.active || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const now = performance.now() / 1000;
        const ready = InnerMapCharacters.isReady() || B._presetsReady;
        const horseSp = InnerMap.animalSpecies ? InnerMap.animalSpecies('horse', InnerMap.animalConfig()) : null;
        for (const c of bf.companies) {
            const sel = B.active && B.selected.has(c.id);
            for (const f of c.figures) {
                const wx = f.x * T + T / 2, wy = f.y * T + T / 2;
                const s = camera.worldToScreenFast(wx, wy);
                const sx = s.x, sy = s.y;
                if (sx < -ds * 3 || sx > W + ds * 3 || sy < -ds * 3 || sy > H + ds * 3) continue;
                const preset = B._presetOf(c, f);
                // (once it is over the living march off with the army: only the fallen stay)
                if (f.alive && !B.active) continue;
                if (!f.alive) {
                    items.push({ sortY: wy, zLayer: 0, sortX: f.x, draw: () => B._drawFallen(ctx, ds, c, f, preset, sx, sy, horseSp) });
                    continue;
                }
                const dir = InnerMapCharacters.getDirection(f.fx || c.dx, f.fy || c.dy);
                // (weapons and shields show only in the combat poses: a soldier standing holds them
                // ready, an archer his bow, which he also holds up to shoot)
                const armed = true;
                const anim = f.anim === 'fight' ? (c.kind === 'archer' ? 'halfslash' : 'slash')
                    : f.anim === 'shoot' ? 'ready' : (f.anim === 'idle' && armed) ? 'ready' : f.anim;
                const tm = now + f.i * 0.37 + c.id * 0.11;
                const routed = c.state === 'routed';
                items.push({ sortY: wy + T / 2, zLayer: 2, sortX: f.x, draw: () => {
                    if (sel) {
                        ctx.save();
                        ctx.strokeStyle = 'rgba(245,197,66,0.9)';
                        ctx.lineWidth = Math.max(1.5, ds * 0.05);
                        ctx.beginPath();
                        ctx.ellipse(sx, sy + ds * 0.18, ds * (c.kind === 'horse' ? 0.62 : 0.36), ds * (c.kind === 'horse' ? 0.2 : 0.13), 0, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.restore();
                    }
                    if (c.kind === 'horse' && horseSp) B._drawRider(ctx, ds, c, f, preset, sx, sy, dir, tm, horseSp, ready);
                    else B._drawFoot(ctx, ds, preset, sx, sy, anim, dir, tm, ready, routed);
                } });
            }
        }
        // The enemy's captain behind their line
        const fc = bf.foeCaptain;
        if (fc && B.active) {
            const lead = bf.companies.find(c => c.id === fc.ledId);
            const preset = lead && lead.figures[0] ? B._presetOf(lead, lead.figures[0]) : null;
            const wx = fc.x * T + T / 2, wy = fc.y * T + T / 2;
            const s = camera.worldToScreenFast(wx, wy);
            const sx = s.x, sy = s.y;
            const dir = bf.sides.enemy.dir > 0 ? InnerMapCharacters.DIR_RIGHT : InnerMapCharacters.DIR_LEFT;
            items.push({ sortY: wy + T / 2, zLayer: 2, sortX: fc.x, draw: () => {
                B._drawFoot(ctx, ds, preset, sx, sy, fc.moving ? 'walk' : 'idle', dir, now, ready, false);
            } });
        }
    },

    _drawFoot(ctx, ds, preset, sx, sy, anim, dir, tm, ready, routed) {
        const cw = ds * 1.2, ch = ds * 1.8;
        ctx.beginPath();
        ctx.ellipse(sx, sy + ds * 0.15, cw * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        if (!(ready && preset && InnerMapCharacters.drawCharacter(ctx, preset, anim, dir, routed ? tm * 1.4 : tm, sx - cw / 2, sy - ch + ds * 0.3, cw, ch))) {
            ctx.fillStyle = 'rgba(60,60,80,0.8)';
            ctx.beginPath(); ctx.ellipse(sx, sy - ds * 0.3, ds * 0.18, ds * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        }
    },

    /** A horseman: the horse from its sheet, the rider seated on its back. */
    _drawRider(ctx, ds, c, f, preset, sx, sy, dir, tm, sp, ready) {
        const facing = ['up', 'left', 'down', 'right'][dir];
        const fake = { id: `bf${c.id}_${f.i}`, facing, state: f.moving ? 'walk' : 'idle', moving: f.moving, animT: tm * (c.order.type === 'charge' || c.state === 'routed' ? 1.8 : 1), hp: 1, maxHp: 1 };
        if (f.anim === 'fight') { fake.state = 'attack'; fake.atkT = (tm % 0.9); }
        const scale = 0.72;
        const side = dir === InnerMapCharacters.DIR_LEFT || dir === InnerMapCharacters.DIR_RIGHT;
        const cw = ds * 1.2, ch = ds * 1.8;
        // The saddle on the horse's sheet (128px cells, feet at 124): the back ~70px up seen
        // side-on, ~84px seen from the front or behind; the rider's hips there (~42px down his 64)
        const k = (Number(sp.drawTiles) || 2) * scale * ds / (Number(sp.frameW) || 128);
        const feet = sy + ds * 0.3;
        const saddle = feet - (side ? 70 : 84) * k;
        const top = saddle - 42 * (ch / 64);
        // a little behind the withers, toward the tail
        const along = side ? (dir === InnerMapCharacters.DIR_RIGHT ? -1 : 1) * 6 * k : 0;
        const back = dir === InnerMapCharacters.DIR_UP;
        const drawMan = () => {
            if (!(ready && preset)) return;
            ctx.save();
            // Only the rider above the saddle and his thigh on the flank: the horse hides the rest
            ctx.beginPath();
            ctx.rect(sx - cw, top - ds, cw * 2, saddle - top + ds + (side ? 0.22 : 0.12) * ds);
            ctx.clip();
            InnerMapCharacters.drawCharacter(ctx, preset, f.anim === 'fight' ? 'slash' : 'ready', dir, tm, sx + along - cw / 2, top, cw, ch);
            ctx.restore();
        };
        if (back) drawMan();
        InnerMapAnimals.drawAt(ctx, fake, sp, sx, feet, ds, { scale });
        if (!back) drawMan();
    },

    /** One of the fallen: a man across his tile, a pool of blood; a horse down. */
    _drawFallen(ctx, ds, c, f, preset, sx, sy, horseSp) {
        const age = InnerMapBattle.bf ? Math.max(0, InnerMapBattle.bf.t - f.fellAt) : 99;
        const fall = Math.min(1, age / 0.45);
        const ease = 1 - (1 - fall) * (1 - fall);
        const pool = Math.min(1, age / 3);
        ctx.save();
        if (pool > 0) {
            ctx.beginPath();
            ctx.ellipse(sx, sy + ds * 0.12, ds * 0.55 * pool, ds * 0.26 * pool, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(110,10,10,0.6)';
            ctx.fill();
        }
        if (c.kind === 'horse' && horseSp) {
            const fake = { id: `bf${c.id}_${f.i}`, facing: f.side > 0 ? 'right' : 'left', state: 'dead', deadT: age, hp: 0, maxHp: 1 };
            InnerMapAnimals.drawAt(ctx, fake, horseSp, sx, sy + ds * 0.3, ds, { scale: 0.72, noShadow: true });
        } else if (preset && InnerMapCharacters.getComposited(preset)) {
            const cw = ds * 1.2 * 0.85, ch = ds * 1.8 * 0.85;
            ctx.translate(sx, sy - ds * 0.35 * (1 - ease));
            ctx.rotate(f.side * (Math.PI / 2) * ease);
            ctx.filter = `grayscale(${0.4 * ease}) brightness(${1 - 0.22 * ease})`;
            InnerMapCharacters.drawCharacter(ctx, preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, -cw / 2, -ch / 2, cw, ch);
            ctx.filter = 'none';
        }
        ctx.restore();
    },

    /** Over the figures: arrows, dust, blood, the orders, the company plates. */
    renderOverlay(ctx, camera) {
        const B = InnerMapBattle;
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const bf = B.bf;
        const T = InnerMapRenderer.tileSize;
        const ds = T * camera.zoom;
        const toS = (x, y) => { const s = camera.worldToScreenFast(x * T + T / 2, y * T + T / 2); return { x: s.x, y: s.y }; };
        ctx.save();
        // Dust
        for (const p of B.particles) {
            if (p.kind !== 'dust') continue;
            const s = toS(p.x, p.y);
            const k = p.t / p.dur;
            ctx.fillStyle = `rgba(170,150,115,${0.35 * (1 - k)})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y - ds * 0.2 - k * ds * 0.6, ds * p.r * (0.6 + k), 0, Math.PI * 2);
            ctx.fill();
        }
        // Blood
        for (const p of B.particles) {
            if (p.kind !== 'blood') continue;
            const s = toS(p.x, p.y);
            const fade = p.t > p.dur ? Math.max(0, 1 - (p.t - p.dur) / 6) : 1;
            ctx.fillStyle = `rgba(150,15,15,${0.85 * fade})`;
            const r = Math.max(1, ds * 0.035);
            ctx.fillRect(Math.round(s.x - r / 2), Math.round(s.y - p.z * ds * 0.6), Math.ceil(r), Math.ceil(r));
        }
        // Arrows in flight: a shaft along the arc, pointing the way it flies
        ctx.lineCap = 'round';
        for (const p of B.particles) {
            if (p.kind !== 'arrow' || p.t < 0 || p.t > p.dur) continue;
            const k = p.t / p.dur;
            const at = (u) => {
                const x = p.x0 + (p.x1 - p.x0) * u, y = p.y0 + (p.y1 - p.y0) * u;
                const s = toS(x, y);
                return { x: s.x, y: s.y - ds * (0.9 + Math.sin(Math.PI * u) * p.arc) };
            };
            const a = at(k), b = at(Math.max(0, k - 0.06));
            const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const L = ds * 0.42;
            const ux = (a.x - b.x) / len, uy = (a.y - b.y) / len;
            ctx.strokeStyle = 'rgba(70,50,30,0.95)';
            ctx.lineWidth = Math.max(1, ds * 0.035);
            ctx.beginPath(); ctx.moveTo(a.x - ux * L, a.y - uy * L); ctx.lineTo(a.x, a.y); ctx.stroke();
            ctx.strokeStyle = 'rgba(235,235,225,0.9)';
            ctx.beginPath(); ctx.moveTo(a.x - ux * L, a.y - uy * L); ctx.lineTo(a.x - ux * L * 0.75, a.y - uy * L * 0.75); ctx.stroke();
        }
        if (!bf || !B.active) { ctx.restore(); return; }
        // The selection box being dragged
        if (B._drag) {
            const d = B._drag;
            ctx.fillStyle = 'rgba(245,197,66,0.08)';
            ctx.strokeStyle = 'rgba(245,197,66,0.85)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
            ctx.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
            ctx.setLineDash([]);
        }
        // Orders of the companies selected, drawn on the ground
        for (const c of bf.companies) {
            if (!B.selected.has(c.id) || !Battlefield.alive(c)) continue;
            let tx = null, ty = null, color = 'rgba(245,197,66,0.8)';
            if (c.order.type === 'move') { tx = c.order.x; ty = c.order.y; }
            else if (c.order.type === 'charge' || c.order.type === 'volley') {
                const t = bf.companies.find(x => x.id === c.order.targetId);
                if (t) { tx = t.x; ty = t.y; color = c.order.type === 'charge' ? 'rgba(230,80,60,0.85)' : 'rgba(150,200,255,0.85)'; }
            } else if (c.state === 'withdrawing') { tx = bf.sides.player.dir > 0 ? 1 : bf.field.w - 2; ty = c.y; color = 'rgba(200,200,200,0.7)'; }
            if (tx == null) continue;
            const a = toS(c.x, c.y), b = toS(tx, ty);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, ds * 0.05);
            ctx.setLineDash([ds * 0.25, ds * 0.18]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(b.x, b.y, ds * 0.18, 0, Math.PI * 2); ctx.stroke();
        }
        // The company plates: icon, name, men and spirit
        for (const c of bf.companies) {
            if (!Battlefield.alive(c)) continue;
            const alive = c.figures.filter(f => f.alive);
            if (!alive.length) continue;
            let top = Infinity, mx = 0;
            for (const f of alive) { top = Math.min(top, f.y); mx += f.x; }
            mx /= alive.length;
            const s = toS(mx, top);
            const mine = c.side === 'player';
            const sel = B.selected.has(c.id);
            const n = mine ? bf.companies.filter(x => x.side === 'player').indexOf(c) + 1 : 0;
            const label = `${mine && n <= 9 ? `${n} ` : ''}${c.icon} ${c.name}`;
            const fs = Math.max(10, Math.min(14, ds * 0.32));
            ctx.font = `600 ${fs}px var(--font-body, sans-serif)`;
            const tw = ctx.measureText(label).width;
            const w = Math.max(tw + 12, ds * 1.6), h = fs + 12;
            const x = Math.round(s.x - w / 2), y = Math.round(s.y - ds * (c.kind === 'horse' ? 2.6 : 2.0) - h);
            ctx.fillStyle = mine ? (sel ? 'rgba(60,48,15,0.88)' : 'rgba(18,26,44,0.82)') : 'rgba(48,16,16,0.82)';
            ctx.strokeStyle = sel ? 'rgba(245,197,66,0.95)' : mine ? 'rgba(120,160,230,0.6)' : 'rgba(220,110,90,0.6)';
            ctx.lineWidth = 1;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            ctx.fillStyle = c.state === 'routed' ? '#e8a070' : '#f0e6d0';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label, s.x, y + 2);
            // strength (red) and spirit (gold) under the name
            const bw = w - 8, by = y + fs + 4;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x + 4, by, bw, 3); ctx.fillRect(x + 4, by + 4, bw, 2);
            ctx.fillStyle = mine ? '#6fb0ff' : '#e0604a';
            ctx.fillRect(x + 4, by, Math.round(bw * Math.max(0, c.str / c.str0)), 3);
            ctx.fillStyle = c.morale < Battlefield.config().morale.waver ? '#e08a50' : '#e8c060';
            ctx.fillRect(x + 4, by + 4, Math.round(bw * Math.max(0, Math.min(1, c.morale / Math.max(0.01, c.morale0)))), 2);
            if (c.state === 'routed' || c.state === 'withdrawing') {
                ctx.font = `700 ${Math.round(fs * 0.85)}px var(--font-body, sans-serif)`;
                ctx.fillStyle = c.state === 'routed' ? '#ff9a6a' : '#cfd8e0';
                ctx.fillText(c.state === 'routed' ? 'ROUTED' : 'FALLING BACK', s.x, y - fs);
            }
        }
        ctx.restore();
    },

    // ── Input ─────────────────────────────────────────────────────────

    /** The company under a screen point (its figures, a little slack). */
    _companyAt(camera, screenX, screenY) {
        const bf = InnerMapBattle.bf;
        const T = InnerMapRenderer.tileSize;
        const w = camera.screenToWorld(screenX, screenY);
        const x = w.x / T - 0.5, y = w.y / T - 0.5;
        let best = null, bd = 1.3;
        for (const c of bf.companies) {
            if (!Battlefield.alive(c)) continue;
            for (const f of c.figures) {
                if (!f.alive) continue;
                // a figure stands about a tile tall above its feet
                const d = Math.hypot(f.x - x, (f.y - 0.6) - y);
                if (d < bd) { bd = d; best = c; }
            }
        }
        return { c: best, x, y };
    },

    /** A click on the map while the battle is on: true when it was ours. */
    click(game, q, r, button, screenX, screenY, shift = false) {
        const B = InnerMapBattle;
        if (!B.active) return false;
        const bf = B.bf;
        shift = shift || !!B._shift;
        const hit = B._companyAt(game.innerMapCamera, screenX, screenY);
        if (button === 'left') {
            if (hit.c && hit.c.side === 'player') {
                if (shift) { if (B.selected.has(hit.c.id)) B.selected.delete(hit.c.id); else B.selected.add(hit.c.id); }
                else B.selected = new Set([hit.c.id]);
            } else if (!shift) {
                B.selected.clear();
            }
            B._updateHud(true);
            return true;
        }
        if (button === 'right') {
            const mine = [...B.selected].map(id => bf.companies.find(c => c.id === id)).filter(c => c && Battlefield.standing(c));
            if (!mine.length) return true;
            if (hit.c && hit.c.side === 'enemy') {
                for (const c of mine) Battlefield.order(bf, c.id, { type: c.kind === 'archer' ? 'volley' : 'charge', targetId: hit.c.id });
            } else {
                // March: the companies keep their places relative to each other
                const cx = mine.reduce((s, c) => s + c.x, 0) / mine.length, cy = mine.reduce((s, c) => s + c.y, 0) / mine.length;
                for (const c of mine) Battlefield.order(bf, c.id, { type: 'move', x: hit.x + (c.x - cx), y: hit.y + (c.y - cy) });
            }
            B._updateHud(true);
            return true;
        }
        return true;
    },

    /** A box dragged on the screen (canvas px): select your companies with a man inside it (shift adds). */
    _boxSelect(d, add) {
        const B = InnerMapBattle;
        const cam = B.game.innerMapCamera;
        const T = InnerMapRenderer.tileSize;
        const a = cam.screenToWorld(d.x0, d.y0), b = cam.screenToWorld(d.x1, d.y1);
        const x0 = Math.min(a.x, b.x) / T - 0.5, x1 = Math.max(a.x, b.x) / T - 0.5;
        // (a man stands about a tile tall above his feet: a box over his head still takes him)
        const y0 = Math.min(a.y, b.y) / T - 0.5, y1 = Math.max(a.y, b.y) / T - 0.5 + 0.8;
        const ids = Battlefield.inBox(B.bf, 'player', x0, y0, x1, y1);
        if (!add) B.selected = new Set(ids);
        else for (const id of ids) B.selected.add(id);
        B._updateHud(true);
    },

    /** Orders for the selected companies from the HUD or the keys. */
    command(what) {
        const B = InnerMapBattle;
        const bf = B.bf;
        if (!B.active || !bf || bf.over) return;
        const mine = [...B.selected].map(id => bf.companies.find(c => c.id === id)).filter(c => c && Battlefield.standing(c));
        const foes = bf.companies.filter(c => c.side === 'enemy' && Battlefield.alive(c) && c.state !== 'fled');
        const nearest = (c, filter = () => true) => foes.filter(filter).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        if (what === 'pause') B.paused = !B.paused;
        else if (what === 'speed') B.speed = SPEEDS[(SPEEDS.indexOf(B.speed) + 1) % SPEEDS.length];
        else if (what === 'retreat') { Battlefield.retreat(bf); B.paused = false; }
        else if (what === 'captains') { Battlefield.setCaptains(bf, !bf.aiSide.player); if (bf.aiSide.player) B.paused = false; }
        else if (what === 'finish') {
            // The captains fight the rest of it out (no more orders from you)
            Battlefield.fightOut(bf);
            B._drainEvents();
        } else if (what === 'all') B.selected = new Set(bf.companies.filter(c => c.side === 'player' && Battlefield.standing(c)).map(c => c.id));
        else {
            for (const c of mine) {
                if (what === 'hold') Battlefield.order(bf, c.id, { type: 'hold' });
                else if (what === 'charge') { const t = nearest(c, f => c.kind !== 'horse' || f.kind !== 'foot') || nearest(c); if (t) Battlefield.order(bf, c.id, { type: 'charge', targetId: t.id }); }
                else if (what === 'volley') { const t = nearest(c); if (t) Battlefield.order(bf, c.id, { type: c.kind === 'archer' ? 'volley' : 'charge', targetId: t.id }); }
                else if (what === 'fallback') Battlefield.order(bf, c.id, { type: 'move', x: c.x - bf.sides.player.dir * 6, y: c.y });
                else if (what === 'lead') { Battlefield.lead(bf, c.id); break; }
            }
        }
        B._updateHud(true);
    },

    /** A key while the battle is on: true when it was ours. */
    key(game, e) {
        const B = InnerMapBattle;
        if (!B.active) return false;
        const k = String(e.key || '').toLowerCase();
        if (k === ' ' || k === 'spacebar') { B.command('pause'); e.preventDefault(); return true; }
        if (k === 'escape') {
            if (document.getElementById('customPanel')) return false;
            B.selected.clear(); B._updateHud(true); return true;
        }
        if (/^[1-9]$/.test(k)) {
            const mine = B.bf.companies.filter(c => c.side === 'player');
            const c = mine[Number(k) - 1];
            if (c && Battlefield.standing(c)) {
                if (e.shiftKey) B.selected.add(c.id); else B.selected = new Set([c.id]);
            }
            B._updateHud(true);
            return true;
        }
        const map = { 0: 'all', h: 'hold', c: 'charge', f: 'volley', b: 'fallback', l: 'lead', '+': 'speed', '=': 'speed' };
        if (map[k]) { B.command(map[k]); return true; }
        if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'r', 't', 'm'].includes(k)) return true;
        return false;
    },

    _bindKeys(on) {
        const B = InnerMapBattle;
        if (on && !B._kd) {
            B._kd = (e) => { B._keys[String(e.key || '').toLowerCase()] = true; };
            B._ku = (e) => { B._keys[String(e.key || '').toLowerCase()] = false; };
            window.addEventListener('keydown', B._kd);
            window.addEventListener('keyup', B._ku);
            B._blur = () => { B._keys = {}; };
            window.addEventListener('blur', B._blur);
            // (a shift-click adds a company to the selection: the click handler has no event)
            // Drag a box on the field with the left button to select every company of yours inside it
            B._md = (e) => {
                B._shift = !!e.shiftKey;
                const g = B.game;
                B._dragFrom = e.button === 0 && g && g.canvas && e.target === g.canvas ? g._clientToCanvas(e.clientX, e.clientY) : null;
                B._drag = null;
            };
            B._mm = (e) => {
                const from = B._dragFrom;
                if (!from || !B.active) return;
                const p = B.game._clientToCanvas(e.clientX, e.clientY);
                if (!B._drag && Math.hypot(p.x - from.x, p.y - from.y) < 8) return;
                B._drag = { x0: from.x, y0: from.y, x1: p.x, y1: p.y };
            };
            B._mu = (e) => {
                if (e.button !== 0) return;
                const d = B._drag;
                B._dragFrom = null;
                B._drag = null;
                if (d && B.active) B._boxSelect(d, !!e.shiftKey);
            };
            window.addEventListener('mousedown', B._md, true);
            window.addEventListener('mousemove', B._mm, true);
            window.addEventListener('mouseup', B._mu, true);
        } else if (!on && B._kd) {
            window.removeEventListener('keydown', B._kd);
            window.removeEventListener('keyup', B._ku);
            window.removeEventListener('blur', B._blur);
            window.removeEventListener('mousedown', B._md, true);
            window.removeEventListener('mousemove', B._mm, true);
            window.removeEventListener('mouseup', B._mu, true);
            B._kd = B._ku = B._blur = B._md = B._mm = B._mu = null;
            B._keys = {};
            B._drag = B._dragFrom = null;
        }
    },

    // ── The HUD ───────────────────────────────────────────────────────

    _buildHud() {
        document.getElementById(HUD_ID)?.remove();
        const el = document.createElement('div');
        el.id = HUD_ID;
        el.innerHTML = `
            <div class="bfh-top"></div>
            <div class="bfh-bottom"><div class="bfh-cards"></div><div class="bfh-orders"></div></div>`;
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-bf]');
            if (!b) return;
            const [act, arg] = b.dataset.bf.split(':');
            if (act === 'sel') {
                const id = Number(arg);
                if (e.shiftKey) { if (InnerMapBattle.selected.has(id)) InnerMapBattle.selected.delete(id); else InnerMapBattle.selected.add(id); }
                else InnerMapBattle.selected = new Set([id]);
                InnerMapBattle._updateHud(true);
            } else InnerMapBattle.command(act);
        });
        // Clicks on the HUD never reach the map below
        for (const ev of ['mousedown', 'mouseup', 'contextmenu', 'wheel', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
        document.body.appendChild(el);
        if (!document.getElementById('battlefieldHudStyle')) {
            const st = document.createElement('style');
            st.id = 'battlefieldHudStyle';
            st.textContent = `
#${HUD_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 900; font-family: var(--font-body, sans-serif); color: #eadfc8; }
#${HUD_ID} .bfh-top { pointer-events: auto; position: absolute; top: 58px; left: 50%; transform: translateX(-50%); background: rgba(16,14,12,0.88); border: 1px solid rgba(201,162,74,0.55); border-radius: 6px; padding: 6px 10px; min-width: 520px; box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
#${HUD_ID} .bfh-title { font-family: var(--font-display, serif); color: var(--gold, #e8c060); font-size: 15px; text-align: center; margin-bottom: 4px; }
#${HUD_ID} .bfh-sides { display: flex; gap: 10px; align-items: center; font-size: 12px; }
#${HUD_ID} .bfh-side { flex: 1; }
#${HUD_ID} .bfh-bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin-top: 2px; }
#${HUD_ID} .bfh-bar > div { height: 100%; }
#${HUD_ID} .bfh-ctl { display: flex; gap: 6px; justify-content: center; margin-top: 6px; flex-wrap: wrap; }
#${HUD_ID} button { pointer-events: auto; font: 600 12px var(--font-body, sans-serif); color: #eadfc8; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 4px 9px; cursor: pointer; }
#${HUD_ID} button:hover { background: rgba(255,255,255,0.18); }
#${HUD_ID} button.on { background: var(--gold, #e8c060); color: #1a1a1a; border-color: transparent; }
#${HUD_ID} button.red { background: #6e2a24; }
#${HUD_ID} .bfh-bottom { pointer-events: auto; position: absolute; bottom: 116px; left: 50%; transform: translateX(-50%); background: rgba(16,14,12,0.9); border: 1px solid rgba(201,162,74,0.55); border-radius: 6px; padding: 6px 8px; max-width: calc(96vw / var(--ui-zoom, 1)); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
#${HUD_ID} .bfh-cards { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
#${HUD_ID} .bfh-card { width: 118px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 4px 6px; cursor: pointer; font-size: 11px; }
#${HUD_ID} .bfh-card.sel { border-color: var(--gold, #e8c060); background: rgba(232,192,96,0.12); }
#${HUD_ID} .bfh-card.down { opacity: 0.45; }
#${HUD_ID} .bfh-card .nm { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${HUD_ID} .bfh-card .st { color: #b9ad94; }
#${HUD_ID} .bfh-orders { display: flex; gap: 5px; justify-content: center; margin-top: 6px; flex-wrap: wrap; }
#${HUD_ID} .bfh-log { font-size: 11px; color: #c9bda2; text-align: center; margin-top: 4px; min-height: 14px; }
`;
            document.head.appendChild(st);
        }
        InnerMapBattle._hudKey = null;
        InnerMapBattle._updateHud(true);
    },

    _updateHud(force = false) {
        const B = InnerMapBattle;
        const el = document.getElementById(HUD_ID);
        if (!el || !B.bf) return;
        const bf = B.bf;
        const now = performance.now();
        if (!force && B._hudAt && now - B._hudAt < 200) return;
        B._hudAt = now;
        const s = Battlefield.strengths(bf);
        const pct = (a, b) => Math.max(0, Math.min(100, Math.round(a / Math.max(1, b) * 100)));
        const objective = bf.objective.type === 'hold'
            ? `Hold the field: ${Math.max(0, Math.ceil(bf.objective.seconds - bf.t))}s`
            : 'Break them';
        const last = bf.log[bf.log.length - 1];
        const title = (B.opts && B.opts.title) || `Battle against the ${bf.enemyLabel}`;
        el.querySelector('.bfh-top').innerHTML = `
            <div class="bfh-title">⚔️ ${esc(title)}</div>
            <div class="bfh-sides">
                <div class="bfh-side">Your army <strong>${Math.round(s.pStr)}</strong> / ${Math.round(s.pStr0)}<div class="bfh-bar"><div style="width:${pct(s.pStr, s.pStr0)}%;background:#4f9fe0"></div></div></div>
                <div style="font-size:11px;color:#a99;text-align:center;min-width:110px;">${esc(objective)}<br>${B.paused ? '⏸ paused' : `▶ ${B.speed}×`} · ${Math.floor(bf.t)}s<br><span title="The day's clock stands while you fight; the battle takes this much of it">🕐 ${Battlefield.gameHours(bf)}h of the day</span></div>
                <div class="bfh-side" style="text-align:right;">${esc(bf.enemyLabel)} <strong>${Math.round(s.eStr)}</strong> / ${Math.round(s.eStr0)}<div class="bfh-bar"><div style="width:${pct(s.eStr, s.eStr0)}%;background:#e0604a;margin-left:auto"></div></div></div>
            </div>
            <div class="bfh-ctl">
                <button data-bf="pause" class="${B.paused ? 'on' : ''}" title="Space">${B.paused ? '▶ Begin / Resume' : '⏸ Pause'}</button>
                <button data-bf="speed" title="+">⏩ ${B.speed}×</button>
                <button data-bf="captains" class="${bf.aiSide.player ? 'on' : ''}" title="Your captains give the orders">🧭 Captains command</button>
                <button data-bf="finish" title="Fight the rest of it out at once">🎲 Let the captains finish it</button>
                <button data-bf="retreat" class="red" title="Every company leaves the field">🎺 Sound the retreat</button>
            </div>
            <div class="bfh-log">${last ? esc(last.text) : ''}</div>`;
        const mine = bf.companies.filter(c => c.side === 'player');
        el.querySelector('.bfh-cards').innerHTML = mine.map((c, i) => {
            const st = c.state === 'formed' ? (c.engaged.length ? 'fighting' : ({ hold: 'holding', move: 'marching', charge: 'charging', volley: 'loosing' }[c.order.type] || c.order.type))
                : c.state === 'routed' ? 'ROUTED' : c.state === 'withdrawing' ? 'falling back' : c.state === 'fled' ? 'off the field' : 'cut down';
            const led = bf.commander && bf.commander.ledId === c.id ? ' ★' : '';
            return `<div class="bfh-card ${B.selected.has(c.id) ? 'sel' : ''} ${Battlefield.standing(c) ? '' : 'down'}" data-bf="sel:${c.id}" title="${i < 9 ? `Key ${i + 1}` : ''}">
                <div class="nm">${i + 1}. ${c.icon} ${esc(c.name)}${led}</div>
                <div class="st">${c.figures.filter(f => f.alive).length} men · ${esc(st)}</div>
                <div class="bfh-bar"><div style="width:${pct(c.str, c.str0)}%;background:#4f9fe0"></div></div>
                <div class="bfh-bar" style="height:3px"><div style="width:${pct(c.morale, c.morale0)}%;background:${c.morale < Battlefield.config().morale.waver ? '#e08a50' : '#e8c060'}"></div></div>
            </div>`;
        }).join('');
        const sel = [...B.selected].map(id => bf.companies.find(c => c.id === id)).filter(Boolean);
        const archers = sel.some(c => c.kind === 'archer');
        el.querySelector('.bfh-orders').innerHTML = `
            <button data-bf="all" title="0">All</button>
            <button data-bf="hold" title="H">🛡️ Hold</button>
            <button data-bf="charge" title="C">⚔️ Charge</button>
            ${archers ? '<button data-bf="volley" title="F">🏹 Loose</button>' : ''}
            <button data-bf="fallback" title="B">↩️ Fall back</button>
            <button data-bf="lead" title="L">★ Lead</button>
            <span style="font-size:11px;color:#998d76;align-self:center;margin-left:6px;">${sel.length ? 'Right-click ground to march, a foe to attack' : 'Click a company (1-9, or drag a box round them) to command it'}</span>`;
    },

    // ── The end ───────────────────────────────────────────────────────

    /** The fight is over: the aftermath, the report, the HUD away (the fallen stay). */
    _finish() {
        const B = InnerMapBattle;
        if (!B.active) return;
        const game = B.game;
        const bf = B.bf;
        const opts = B.opts || {};
        let result;
        try {
            if (B.battle.host) result = Battlefield.hostOutcome(bf, opts.host || {});
            else result = Battlefield.conclude(game.player, bf, game.world);
        } catch (err) {
            console.error('[InnerMapBattle] aftermath failed:', err);
        }
        B._close();
        B._passBattleTime(game, bf);
        if (typeof opts.onDone === 'function') {
            try { opts.onDone(result, bf); } catch (err) { console.error('[InnerMapBattle] onDone:', err); }
        }
    },

    /**
     * The day's clock stood still while the battle was fought (ui/game/
     * gameLoop.js skips InnerMap.updateTime while it is on); now it moves on
     * by the battle's hours (Battlefield.gameHours), and the commander feels
     * each of them (hunger, fatigue: the hourly needs).
     */
    _passBattleTime(game, bf) {
        if (!bf || !InnerMap.active) return;
        const hours = Battlefield.gameHours(bf);
        const before = Math.floor(Number(InnerMap.timeOfDay) || 0);
        InnerMap.passHours(hours);
        const passed = Math.max(0, Math.floor(Number(InnerMap.timeOfDay) || 0) - before);
        const p = game && game.player;
        if (p && p.needs && typeof p.decayNeedsPerHour === 'function') {
            for (let i = 0; i < passed; i++) p.decayNeedsPerHour({ insideBuilding: false, isNight: InnerMap.timeOfDay >= 21 || InnerMap.timeOfDay < 6, isRaining: !!(InnerMap._weather && InnerMap._weather.type === 'rain'), inOwnHouse: false });
        }
        bf.gameHours = hours;
    },

    /** Leave the field mid-battle (the map left, the day ended): the captains fight it out. */
    abandon(game) {
        const B = InnerMapBattle;
        if (!B.active || B._ending) return;
        Battlefield.fightOut(B.bf);
        B._ending = true;
        B._finish();
    },

    _close() {
        const B = InnerMapBattle;
        const game = B.game;
        B._lastField = B.bf; // its fallen lie where they fell while you stay on this map
        if (B._lastField) { B._lastField._mapTiles = InnerMap.tiles; B._lastField.over = B._lastField.over || { winner: 'ended' }; }
        B.active = false;
        B.bf = null;
        B.selected.clear();
        B._bindKeys(false);
        document.getElementById(HUD_ID)?.remove();
        if (InnerMap.active) Hotbar.show();
        if (game && B._savedZoom) {
            const cam = game.innerMapCamera;
            cam.minZoom = B._savedZoom.min;
            cam.targetZoom = Math.max(cam.minZoom, B._savedZoom.target);
        }
        B._savedZoom = null;
    },

    /** The fallen of the last battle, while still on its map. */
    lastFieldHere() {
        const lf = InnerMapBattle._lastField;
        if (lf && lf._mapTiles !== InnerMap.tiles) InnerMapBattle._lastField = null;
        return InnerMapBattle._lastField;
    },
};

// The collector reads the last field only while its map is up
const _collect = InnerMapBattle.collect;
InnerMapBattle.collect = function (items, ctx, camera, T) {
    if (!InnerMapBattle.active) InnerMapBattle.lastFieldHere();
    return _collect.call(InnerMapBattle, items, ctx, camera, T);
};
