// ============================================
// INNER MAP HORSE SWIM — your horse through the fords and across the rivers
// ============================================
// The street map's side of player/horseSwim.js (its rules and numbers:
// data/horseSwim.json):
//
//   • Riding through a ford or a bank's shallows: the horse slows to a
//     careful splashing walk (InnerMap._horsePace, read by
//     world/innerMap/movement.js), the water rings and splashes at its
//     hooves (collect), the rider's legs a little wet (HorseSwim.wade).
//   • Ridden into deep river or lake water the horse swims (ui/innerMapPets.js
//     _checkRide no longer throws you off at the water: InnerMapPets._swimsYou):
//     slow (swimSpeed of a walk, not a swimmer's stroke), the current pushing
//     a little less than a swimmer (resist, from game/gameLoop.js
//     _currentStep), no strokes of your own (carrying(): gameLoop _swimStep
//     leaves the swim to the horse), you soaked waist-deep, the packs wet on a
//     long swim. Drawn sunk: only its head, neck and back above the water, you
//     waist-deep in the saddle holding on (drawSwimRider, from the player's
//     pass in innerMapLayers/entities.js).
//   • Its strength: so many cells of swimming; it flags (told), then panics
//     and throws you, scrambles for the bank and waits there. Ashore it gets
//     its wind back; blown, it refuses deep water until it has. A foal won't
//     swim; nor any horse into near-freezing water or where the water has
//     frozen on the map (gate(): InnerMap._swimAllowed / _swimRefusal while
//     you ride, set after the game loop's own from player/swimming.js).
//   • Led on its rein (not ridden) it follows you into the water and swims
//     behind you on the same rules — or balks at the bank and waits there.
//   • Carried out of the map by the river on its back, you come into the next
//     map still riding it, still swimming: the ride and its swim state go on
//     (ui/innerMapPets.js keeps the ride across the map change).
//   • Your horse cart still stops at deep water (fords are fine: ui/innerMapHitch.js).
//
//   gate(game)                         after the game loop's swim allowance: the horse's rules while ridden
//   update(dt, game)                   after InnerMapPets.update: strength spent and got back, told
//   carrying() / resist()              swimming you now? / its hold against the current
//   collect(items, ctx, camera, T, sheets)   splashes at the hooves; a led horse swimming
//   drawSwimRider(ctx, o)              you on a swimming horse, waist-deep (false: not now)

import { InnerMap } from '../world/innerMap.js';
import { InnerMapPets } from './innerMapPets.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { HorseSwim } from '../player/horseSwim.js';

const T_PX = 32;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _tile(q, r) {
    return InnerMap.tiles && InnerMap.tiles[r] && InnerMap.tiles[r][q];
}

/** Water over a horse's depth: it swims here. */
function _deep(q, r) {
    const t = _tile(q, r);
    return !!(t && !InnerMap._insideBuilding && !(t.subTerrain && t.subTerrain.passable) && InnerMap.isSwimmable(q, r));
}

/** A ford or a bank's shallows: water a horse wades (not ice, a bridge, a pier or a deck). */
function _wade(q, r) {
    const t = _tile(q, r);
    if (!t || InnerMap._insideBuilding || !t._wet || !t.subTerrain || !t.subTerrain.passable) return false;
    if (t._bridge || t._pier || t._deck) return false;
    return !/frozen|ice/.test(String(t.subTerrain.id || ''));
}

/** A horse's cell from its walking record's place (world px, cell centres at +16). */
function _cell(m) {
    return { q: Math.floor(m.x / T_PX), r: Math.floor(m.y / T_PX) };
}

function _isHorse(m) {
    return !!(m && m.a && !m.fly && InnerMapPets._rideCfg(m.a));
}

function _notify(game, n, kind = 'info') {
    if (n && game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(n.title, n.text, kind);
}

export const InnerMapHorseSwim = {
    _st: new Map(),     // horse id → its swim state (HorseSwim.fresh + inWater): kept across maps
    _led: new Map(),    // horse id → { cell, dry: { x, y } } on this map
    _player: null,
    _map: null,
    _cell: null,        // the player's last cell while riding
    _clock: 0,
    _told: new Map(),   // notice key → the clock when told

    /** Its swim state (made fresh the first time). */
    state(a) {
        if (!a) return null;
        let st = this._st.get(a.id);
        if (!st) { st = { ...HorseSwim.fresh(a), inWater: false }; this._st.set(a.id, st); }
        return st;
    },

    /** The water's cold and the horse's age, for its refusal. */
    _ctx(game, a) {
        const sw = InnerMap._sw;
        const celsius = sw && Number.isFinite(sw.celsius) ? sw.celsius
            : InnerMap.temperature && Number.isFinite(InnerMap.temperature.celsius) ? InnerMap.temperature.celsius : null;
        return {
            young: AnimalCompanions.isYoung(a, game && game.world),
            celsius,
            frozen: !!(InnerMap._ss && InnerMap._ss.frozenCells > 0),
        };
    },

    /** Why this horse won't go into deep water now, or null. */
    refusal(game, m) {
        if (!m || !m.a) return null;
        return HorseSwim.refusal(m.a, this.state(m.a), this._ctx(game, m.a));
    },

    /** Is the horse under you swimming you now? */
    carrying() {
        return !!(InnerMapPets.riding && InnerMapPets.mounted() && InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming());
    },

    /** How much of the current a swimming horse holds against (0..1). */
    resist() {
        return Math.max(0, Math.min(1, _num(HorseSwim.config().currentResist, 0.35)));
    },

    /**
     * While you ride: the horse decides whether you may go into deep water (not
     * your own swimming: player/swimming.js), and why not. Once in, always on to
     * the shore.
     */
    gate(game) {
        const m = InnerMapPets.riding ? InnerMapPets.mounted() : null;
        if (!m || !game) return;
        if (InnerMap.isPlayerSwimming()) { InnerMap._swimAllowed = true; InnerMap._swimRefusal = null; return; }
        const why = this.refusal(game, m);
        InnerMap._swimAllowed = !why;
        InnerMap._swimRefusal = why;
    },

    /** Told once, or again only after `every` seconds. */
    _tell(game, key, n, kind = 'info', every = Infinity) {
        if (!n) return;
        const was = this._told.get(key);
        if (was != null && this._clock - was < every) return;
        this._told.set(key, this._clock);
        _notify(game, n, kind);
    },

    /** The nearest ground a horse can stand on, dry ground first. */
    _bank(q0, r0) {
        let wet = null;
        for (let d = 1; d <= 14; d++) {
            for (let dq = -d; dq <= d; dq++) {
                for (let dr = -d; dr <= d; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== d) continue;
                    const q = q0 + dq, r = r0 + dr;
                    const t = _tile(q, r);
                    if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customObject || t.customBuildingPart) continue;
                    if (!t._wet) return { q, r };
                    if (!wet && _wade(q, r)) wet = { q, r };
                }
            }
            if (wet) return wet;
        }
        return wet;
    },

    _stayAt(m, cell) {
        m.stay = cell ? { x: cell.q * T_PX + T_PX / 2, y: cell.r * T_PX + T_PX / 2 } : { x: m.x, y: m.y };
    },

    update(dt, game) {
        if (!game || !game.player) return;
        if (game.player !== this._player) {
            this._player = game.player;
            this._st.clear(); this._led.clear(); this._told.clear(); this._cell = null;
        }
        if (!InnerMap.active || InnerMap._insideBuilding) { this._cell = null; return; }
        if (InnerMap.tiles !== this._map) { this._map = InnerMap.tiles; this._led.clear(); this._cell = null; }
        const sec = Math.max(0, Math.min(0.25, _num(dt)));
        this._clock += sec;
        const P = InnerMapPets;
        let rid = P.riding ? P.mounted() : null;
        // (no diving from the saddle: you slip off its back to go under)
        if (rid && InnerMap._underwater) { P.dismount(game, `You slip off ${rid.a.name}'s back and dive.`); rid = null; }
        if (!rid) this._cell = null;
        for (const m of P._pets || []) {
            if (!_isHorse(m)) continue;
            const st = this.state(m.a);
            if (m === rid) this._ridden(game, m, st, sec);
            else if (m.a.id !== P.hitched) this._ledHorse(game, m, st, sec);
        }
    },

    /** The horse you ride: wading, swimming, spent, ashore. */
    _ridden(game, m, st, sec) {
        const player = game.player;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const key = `${q},${r}`;
        const moved = this._cell != null && this._cell !== key;
        const walking = !!InnerMap._playerWalking || !!this._wasWalking;
        this._wasWalking = !!InnerMap._playerWalking;
        this._cell = key;
        const name = { name: m.a.name };
        if (InnerMap.isPlayerSwimming()) {
            if (!st.inWater) {
                st.inWater = true;
                this._tell(game, `swimIn:${m.a.id}`, HorseSwim.notice('swimIn', name), 'info', 90);
            }
            HorseSwim.soakRider(player);
            const res = HorseSwim.swim(st, { cells: moved && walking ? 1 : 0, drift: moved && !walking ? 1 : 0, dt: sec });
            if (res.flagging) _notify(game, HorseSwim.notice('flag', name), 'warning');
            const lost = HorseSwim.soakPacks(player, st);
            if (lost.length) _notify(game, HorseSwim.notice('packs', { lost: lost.map(l => `${l.n} ${l.id.replace(/_/g, ' ')}`).join(', ') }), 'warning');
            if (res.spent || st.stamina <= 0) this._throw(game, m, st);
            return;
        }
        if (st.inWater) {
            st.inWater = false;
            _notify(game, HorseSwim.notice('ashore', name), 'info');
        }
        if (moved && _wade(q, r)) {
            HorseSwim.wade(player);
            this._tell(game, `wade:${m.a.id}`, HorseSwim.notice('wade', name), 'info', 120);
        }
        if (HorseSwim.rest(st, sec)) this._tell(game, `rested:${m.a.id}`, HorseSwim.notice('rested', name), 'info', 30);
    },

    /** Spent under you: it throws you and makes for the bank, where it waits. */
    _throw(game, m, st) {
        const P = InnerMapPets;
        P.dismount(game);
        st.inWater = false;
        this._stayAt(m, this._bank(InnerMap.playerInnerQ, InnerMap.playerInnerR));
        this._cell = null;
        _notify(game, HorseSwim.notice('throw', { name: m.a.name }), 'error');
    },

    /** A horse led on its rein: after you into the water, or balking at the bank. */
    _ledHorse(game, m, st, sec) {
        const c = _cell(m);
        const key = `${c.q},${c.r}`;
        let rec = this._led.get(m.a.id);
        if (!rec) { rec = { cell: null, dry: null }; this._led.set(m.a.id, rec); }
        const moved = rec.cell != null && rec.cell !== key;
        rec.cell = key;
        const name = { name: m.a.name };
        if (!_deep(c.q, c.r)) {
            const t = _tile(c.q, c.r);
            if (t && t.subTerrain && t.subTerrain.passable) rec.dry = { q: c.q, r: c.r };
            if (st.inWater) {
                st.inWater = false;
                if (st.strokes > 2) this._tell(game, `ashore:${m.a.id}`, HorseSwim.notice('ashore', name), 'info', 30);
            }
            if (HorseSwim.rest(st, sec)) this._tell(game, `rested:${m.a.id}`, HorseSwim.notice('rested', name), 'info', 30);
            return;
        }
        // (told to stay, or making for the bank already)
        if (m.stay) return;
        if (!st.inWater) {
            const why = this.refusal(game, m);
            if (why) {
                this._stayAt(m, rec.dry || this._bank(c.q, c.r));
                this._tell(game, `refuse:${m.a.id}`, HorseSwim.notice('refuseLed', { ...name, why }), 'warning', 20);
                return;
            }
            st.inWater = true;
        }
        const res = HorseSwim.swim(st, { cells: moved ? 1 : 0, dt: sec });
        if (res.flagging) this._tell(game, `flag:${m.a.id}`, HorseSwim.notice('flag', name), 'warning', 30);
        if (res.spent || st.stamina <= 0) {
            this._stayAt(m, this._bank(c.q, c.r) || rec.dry);
            st.inWater = false;
            _notify(game, HorseSwim.notice('ledSpent', name), 'warning');
        }
    },

    /** Is this walking record a led horse in deep water (drawn here, sunk, not by ui/innerMapPets.js)? */
    swimDraw(m) {
        if (!_isHorse(m) || m.a.id === InnerMapPets.riding || m.a.id === InnerMapPets.hitched) return false;
        const c = _cell(m);
        return _deep(c.q, c.r);
    },

    // ── Drawing ──

    /** A ring and a splash of water about the hooves of a wading horse. */
    _drawWade(ctx, fx, fy, ds, moving, now, sheets) {
        ctx.save();
        const ripple = sheets && sheets.get && sheets.get('water_ripple');
        if (ripple) {
            const fr = Math.floor(now * 6) % 4;
            const rw = ds * 1.6;
            ctx.globalAlpha = 0.85;
            ctx.drawImage(ripple, fr * 32, 0, 32, 32, Math.round(fx - rw / 2), Math.round(fy - rw * 0.55), Math.round(rw), Math.round(rw * 0.75));
            ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(225,242,255,0.65)';
        ctx.lineWidth = Math.max(1, ds / 22);
        const p = (now * 1.4) % 1;
        ctx.globalAlpha = 0.7 * (1 - p);
        ctx.beginPath();
        ctx.ellipse(fx, fy - ds * 0.06, ds * (0.45 + p * 0.35), ds * (0.12 + p * 0.07), 0, 0, Math.PI * 2);
        ctx.stroke();
        // (striding through it: droplets thrown up from the hooves)
        if (moving) {
            ctx.fillStyle = 'rgba(230,245,255,0.85)';
            for (let i = 0; i < 6; i++) {
                const ph = (now * 2.6 + i / 6) % 1;
                const side = i % 2 ? 1 : -1;
                const x = fx + side * ds * (0.18 + 0.1 * (i % 3)) + side * ph * ds * 0.18;
                const y = fy - ds * 0.08 - Math.sin(ph * Math.PI) * ds * 0.28;
                ctx.globalAlpha = 0.9 * (1 - ph);
                ctx.beginPath();
                ctx.arc(x, y, Math.max(1, ds * 0.03), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    },

    /** The ring the water makes round a swimming horse, at the surface. */
    _drawSurface(ctx, px, waterY, ds, side, moving, now, sheets) {
        ctx.save();
        const ripple = sheets && sheets.get && sheets.get('water_ripple');
        const w = side ? ds * 2.1 : ds * 1.4;
        if (ripple) {
            const fr = Math.floor(now * 6) % 4;
            ctx.drawImage(ripple, fr * 32, 0, 32, 32, Math.round(px - w / 2), Math.round(waterY - w * 0.3), Math.round(w), Math.round(w * 0.55));
        }
        ctx.strokeStyle = 'rgba(230,245,255,0.75)';
        ctx.lineWidth = Math.max(1, ds / 20);
        ctx.beginPath();
        ctx.ellipse(px, waterY, w * 0.42, ds * 0.1, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (moving) {
            const p = (now * 1.2) % 1;
            ctx.globalAlpha = 0.6 * (1 - p);
            ctx.beginPath();
            ctx.ellipse(px, waterY, w * (0.5 + p * 0.3), ds * (0.13 + p * 0.06), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    },

    /**
     * A horse in deep water: sunk to its back (only the head, neck and the top
     * of the back above the surface), bobbing. → the saddle's height on screen
     * and the water line, or null when it can't be drawn.
     */
    _drawSunk(ctx, m, px, py, ds, dir, moving, now, sheets, before = null) {
        const sp = InnerMapPets.sprite(m.a);
        if (!sp) return null;
        const side = dir === 1 || dir === 3;
        const k = (_num(sp.drawTiles, 2) * _num(sp.scale, 1) * ds) / _num(sp.frameW, 112);
        const bob = Math.sin(now * 2.4 + _num(m.t)) * ds * 0.03;
        const waterY = py + ds * 0.02;
        // (the back just clear of the water, the head and neck well up: a horse swims high in front)
        const backH = (side ? 70 : 84) * k;
        const feet = waterY + backH - (side ? 12 : 8) * k + bob;
        const saddle = feet - backH;
        const pseudo = {
            id: m.a.id, facing: ['up', 'left', 'down', 'right'][dir] || 'down', state: 'walk',
            moving: !!moving, animT: _num(m.t) * 0.6, idleT: _num(m.t), atkT: 9, hp: 1, maxHp: 1,
        };
        if (before) before(saddle, waterY);
        ctx.save();
        ctx.beginPath();
        ctx.rect(px - ds * 4, waterY - ds * 5, ds * 8, ds * 5);
        ctx.clip();
        const ok = InnerMapAnimals.drawAt(ctx, pseudo, sp, px, feet, ds, { noShadow: true });
        ctx.restore();
        if (!ok) return null;
        this._drawSurface(ctx, px, waterY, ds, side, moving, now, sheets);
        return { saddle, waterY, k, side };
    },

    /**
     * You on your horse swimming (the player's pass): the horse sunk to its
     * back, you in the saddle waist-deep, holding on. False when not swimming
     * it (or it can't be drawn): the caller draws you as it would.
     * o: { preset, px, py, ds, dir, walking, now, sheets }
     */
    drawSwimRider(ctx, o) {
        if (!this.carrying()) return false;
        const m = InnerMapPets.mounted();
        if (!m || !o || !o.preset) return false;
        const { preset, px, py, ds, dir, walking, now, sheets } = o;
        const cw = ds * 1.2, ch = ds * 1.8;
        const RIGHT = 3;
        const rider = (saddle, waterY, k, side) => {
            const top = saddle - 42 * (ch / 64);
            const along = side ? (dir === RIGHT ? -1 : 1) * 6 * k : 0;
            ctx.save();
            ctx.beginPath();
            ctx.rect(px - cw, top - ds, cw * 2, Math.min(saddle + 0.12 * ds, waterY) - (top - ds));
            ctx.clip();
            // (bent low over its neck, holding on: a little lower in the saddle)
            InnerMapCharacters.drawCharacter(ctx, preset, 'ready', dir, now, px + along - cw / 2, top + ds * 0.04, cw, ch);
            ctx.restore();
        };
        let geo = null;
        const DOWN = 2;
        if (dir === DOWN) {
            // (coming towards you: you first, the horse's head and neck in front of you, nearer)
            geo = this._drawSunk(ctx, m, px, py, ds, dir, walking, now, sheets, (saddle, waterY) => {
                const sp = InnerMapPets.sprite(m.a);
                const k = (_num(sp && sp.drawTiles, 2) * _num(sp && sp.scale, 1) * ds) / _num(sp && sp.frameW, 112);
                rider(saddle, waterY, k, false);
            });
        } else {
            // (going away from you, or across: the horse, then you on its back, nearer)
            geo = this._drawSunk(ctx, m, px, py, ds, dir, walking, now, sheets);
            if (geo) rider(geo.saddle, geo.waterY, geo.k, geo.side);
        }
        return !!geo;
    },

    /** Splashes at a wading horse's hooves (ridden or led), and a led horse swimming. */
    collect(items, ctx, camera, T, sheets = null) {
        if (!InnerMap.active || InnerMap._insideBuilding || !camera) return;
        const P = InnerMapPets;
        const ds = T * camera.zoom;
        const k = T / T_PX;
        const now = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
        const rid = P.riding ? P.mounted() : null;
        if (rid && !InnerMap.isPlayerSwimming() && _wade(InnerMap.playerInnerQ, InnerMap.playerInnerR)) {
            const at = InnerMap.getPlayerWorldPos();
            const s = camera.worldToScreenFast(at.x * k, at.y * k);
            const sx = s.x, sy = s.y;
            const walking = !!at.walking;
            items.push({ sortY: at.y * k + T / 2 + 0.5, zLayer: 2, sortX: at.x * k / T, draw: () => this._drawWade(ctx, sx, sy + ds * 0.3, ds, walking, now, sheets) });
        }
        if (!P._shown) return;
        for (const m of P._pets || []) {
            if (!_isHorse(m) || m === rid || m.a.id === P.riding || m.a.id === P.hitched) continue;
            const c = _cell(m);
            const deep = _deep(c.q, c.r);
            if (!deep && !_wade(c.q, c.r)) continue;
            const t = _tile(c.q, c.r);
            if (t && t.visible === false) continue;
            const wx = m.x * k, wy = m.y * k;
            const s = camera.worldToScreenFast(wx, wy);
            const sx = s.x, sy = s.y;
            const moving = !!m.moving;
            if (deep) {
                const dir = { up: 0, left: 1, down: 2, right: 3 }[m.facing] ?? 2;
                items.push({ sortY: wy + T / 2, zLayer: 2, sortX: wx / T, draw: () => this._drawSunk(ctx, m, sx, sy, ds, dir, moving, now, sheets) });
            } else {
                items.push({ sortY: wy + T / 2 + 0.5, zLayer: 2, sortX: wx / T, draw: () => this._drawWade(ctx, sx, sy + ds * 0.3, ds, moving, now, sheets) });
            }
        }
    },
};

// The hooks the walk and the ride read (absent, they change nothing):
// the pace through the water while you ride (world/innerMap/movement.js)...
InnerMap._horsePace = function (next, inWater) {
    if (!(this._rideSpeed > 0) || !InnerMapPets.riding) return 0;
    const C = HorseSwim.config();
    if (inWater) return Math.max(0.05, _num(C.swimSpeed, 0.6));
    if (next && _wade(next.q, next.r)) return Math.max(0.05, _num(C.wadePace, 0.55));
    return 0;
};
// ...whether the horse under you swims rather than throwing you at the water (ui/innerMapPets.js _checkRide)...
InnerMapPets._swimsYou = (game, m) => !!(m && m.a && !HorseSwim.refusal(m.a, null, InnerMapHorseSwim._ctx(game, m.a)));
// ...and a led horse swimming, drawn here rather than there (ui/innerMapPets.js collect)
InnerMapPets._swimDraw = (m) => InnerMapHorseSwim.swimDraw(m);
