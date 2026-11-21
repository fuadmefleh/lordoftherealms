// ============================================
// INNER MAP — a torch or a lantern carried at night; fishing by torchlight
// ============================================
// The street map's half of systems/carriedLight.js.
//
//   THE MENU     (click yourself) Light a Torch / Light the Lantern / Put Out
//                the Torch|Lantern / Bind a Torch (a stick and resin, tallow
//                or a rag, by hand). By your own fish trap: Hang a Lantern at
//                the Trap / Take Down the Lantern.
//   EACH FRAME   (ui/game/gameLoop.js) the light burns on by the game clock
//                (a torch to nothing, the lantern's fuel); goes out in the
//                water, off the street map, or when L shutters your light
//                (ui/innerMapNight.js). LightSystem.carried: the warm pool
//                round you at night (a torch flickers); with none carried you
//                see less far (LightSystem.bareNight). FishFed.light: held by
//                the water at night, the fish gather to it (ui/innerMapLayers/
//                surfaceFish.js) and a line cast near bites the readier.
//   DRAWN        in your hand (drawHeld, from innerMapLayers/entities.js): a
//                flame on a stick, or a lantern hung from the fist; a lantern
//                hung at a trap (drawTrapLantern, innerMapLayers/fishTraps.js)
//                with its own light while it burns.
//
//   update(game) · menuItems(game) · trapItems(game, tile, q, r) · handle(game, item) 'torch_*'

import { InnerMap } from '../world/innerMap.js';
import { CarriedLight } from '../systems/carriedLight.js';
import { FishTraps } from '../systems/fishTraps.js';
import { NightStreets } from '../systems/nightStreets.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { LightSystem } from './lightSystem.js';
import { FishFed } from './fishFed.js';
import { DayClock } from './game/dayClock.js';
import { InnerMapFishTraps } from './innerMapFishTraps.js';

const T = 32;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const DIR_UP = 0, DIR_LEFT = 1, DIR_RIGHT = 3;

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _name(id) {
    const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()];
    return ((g && g.name) || String(id).replace(/_/g, ' ')).toLowerCase();
}

function _hrs(h) {
    if (h >= 1.5) return `${Math.round(h)} hours`;
    if (h >= 0.75) return 'about an hour';
    return `${Math.max(5, Math.round(h * 60 / 5) * 5)} minutes`;
}

const _rgb = (c, d) => (Array.isArray(c) && c.length >= 3 ? { r: c[0] | 0, g: c[1] | 0, b: c[2] | 0 } : d);

export const InnerMapTorchlight = {
    _game: null,
    _carried: { radius: 185, intensity: 0.9, color: { r: 255, g: 168, b: 72 }, flicker: true },
    _light: { x: 0, y: 0, near: 3.5, bonus: 0, radius: 5, glow: 0, pull: 7, ring: [0.8, 1.8], reach: 3, speed: 0.7, extra: 3, comeEvery: 4, lure: 1, boat: false, kind: null },

    /** The world clock in game hours */
    now(game) {
        const w = game && game.world;
        return (w && Number.isFinite(w.day) ? w.day : 0) * 24 + DayClock.now();
    },

    // ── Each frame ──

    update(game) {
        this._game = game;
        const player = game && game.player;
        if (!player) { LightSystem.carried = null; FishFed.light = null; return; }
        const st = CarriedLight.state(player, false);
        const C = CarriedLight.config();
        LightSystem.bareNight = _num(C.bareNight, 110);
        if (!st || !st.lit) { LightSystem.carried = null; FishFed.light = null; return; }
        // Off the street map: put out (a torch's stub kept)
        if (!InnerMap.active) { CarriedLight.putOut(player, this.now(game)); LightSystem.carried = null; FishFed.light = null; return; }
        const now = this.now(game);
        for (const n of CarriedLight.tick(player, now)) _note(game, n.kind.startsWith('torch') ? '🔥 Torch' : '🏮 Lantern', n.text, /out|gone/.test(n.kind) ? 'warning' : 'info');
        // In the water: out it goes
        if (st.lit && (InnerMap._underwater || (InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()))) {
            const was = CarriedLight.douse(player, now);
            _note(game, was === 'torch' ? '🔥 Torch' : '🏮 Lantern', was === 'torch' ? 'The water puts your torch out with a hiss. It is no good now.' : 'You put the lantern out before the water does.', 'warning');
        }
        // L shuttered your light (ui/innerMapNight.js): a carried light goes out
        if (st.lit && !NightStreets.lit(player)) {
            const was = CarriedLight.putOut(player, now);
            _note(game, was === 'torch' ? '🔥 Torch' : '🏮 Lantern', was === 'torch' ? 'You snuff the torch against the ground. The dark closes in.' : 'You blow out the lantern.', 'info');
        }
        if (!st.lit) { LightSystem.carried = null; FishFed.light = null; return; }
        const K = CarriedLight.kind(st.lit);
        const c = this._carried;
        c.radius = _num(K.radius, 160); c.intensity = _num(K.intensity, 0.85);
        c.color = _rgb(K.color, c.color); c.flicker = st.lit === 'torch';
        LightSystem.carried = c;
        // Held over the water at night: the fish are drawn to it
        const s = CarriedLight.strength(LightSystem.ambientDarkness);
        if (s <= 0 || InnerMap._insideBuilding || InnerMap._underwater || !InnerMap.getPlayerWorldPos) { FishFed.light = null; return; }
        const pos = InnerMap.getPlayerWorldPos();
        const F = C.fish || {};
        const L = this._light;
        L.x = pos.x / T; L.y = pos.y / T; L.kind = st.lit;
        L.near = _num(F.near, 3.5); L.bonus = _num(K.biteBonus) * s;
        L.radius = (60 + _num(LightSystem.ambientDarkness) * c.radius) / T * 0.8;
        L.glow = _num(F.glow, 0.75) * s; L.pull = _num(F.pull, 7); L.ring = Array.isArray(F.ring) ? F.ring : [0.8, 1.8];
        L.reach = _num(F.reach, 3); L.speed = _num(F.speed, 0.7); L.extra = _num(F.extra, 3); L.comeEvery = _num(F.comeEvery, 4);
        L.lure = _num(K.lure, 1) * s; L.boat = !!InnerMap._aboardBoat;
        FishFed.light = L;
    },

    // ── The menu ──

    /** Your own entries (click yourself) */
    menuItems(game) {
        const player = game && game.player;
        if (!player || !CarriedLight.config().enabled || InnerMap._underwater) return [];
        const st = CarriedLight.state(player, false);
        const out = [];
        const lit = st && st.lit;
        const night = CarriedLight.strength(LightSystem.ambientDarkness) > 0;
        const torches = CarriedLight.torches(player);
        const inv = player.inventory || {};
        const lantern = _num(inv[CarriedLight.config().lantern.item]) >= 1;
        const plan = CarriedLight.bindPlan(player);
        if (!lit && !torches.stub && !torches.fresh && !lantern && !plan) return [];
        out.push({ type: 'header', label: '🔥 Light' });
        if (lit === 'torch') {
            out.push({ type: 'action', action: 'torch_out', label: 'Put Out the Torch', icon: '🔥', desc: `About ${_hrs(st.stub)} of it left; the stub is kept${torches.fresh ? `, ${torches.fresh} more in your packs` : ''}` });
        } else if (lit === 'lantern') {
            const fuels = CarriedLight.fuelsInPacks(player).reduce((n, f) => n + f.have, 0);
            out.push({ type: 'action', action: 'torch_out', label: 'Put Out the Lantern', icon: '🏮', desc: `Oil for ${_hrs(st.fuel)} in it${fuels ? `, ${fuels} more to burn in your packs` : ''}` });
        }
        if (lit !== 'torch' && (torches.stub > 0 || torches.fresh > 0)) {
            const what = torches.stub > 0 ? `The part-burnt one (${_hrs(torches.stub)} left)` : `One of your ${torches.fresh} torches: it burns ${_hrs(_num(CarriedLight.config().torch.hours, 3))}`;
            out.push({ type: 'action', action: 'torch_light', label: 'Light a Torch', icon: '🔥', desc: `${what}. ${night ? 'A wide flickering light; by the water at night the fish come to it' : 'By day it only burns away'}` });
        }
        if (lit !== 'lantern' && lantern) {
            const why = CarriedLight.whyNot(player, 'lantern');
            if (why) out.push({ type: 'disabled', label: `🏮 Light the Lantern — ${why}` });
            else {
                const fuel = st ? st.fuel : 0;
                const f = CarriedLight.fuelsInPacks(player)[0];
                out.push({ type: 'action', action: 'torch_lantern', label: 'Light the Lantern', icon: '🏮', desc: fuel > 0 ? `Oil for ${_hrs(fuel)} in it. A steady light that lasts` : `Filled first (one ${_name(f.id)}: ${_hrs(f.hours)}). A steady light that lasts` });
            }
        }
        if (plan) out.push({ type: 'action', action: 'torch_bind', label: 'Bind a Torch', icon: '🪵', desc: `One ${_name(plan.stick)} and one ${_name(plan.binder)} → ${plan.makes} torch${plan.makes > 1 ? 'es' : ''}` });
        return out;
    },

    /** By your own fish trap: hang a lantern there, or take it down */
    trapItems(game, tile, q, r) {
        const player = game && game.player, world = game && game.world;
        if (!player || !world || !CarriedLight.config().enabled || InnerMap._insideBuilding || InnerMap._underwater) return [];
        const hex = InnerMapFishTraps._hex();
        if (!hex) return [];
        const trap = FishTraps.near(world, hex.q, hex.r, q, r, 1);
        if (!trap) return [];
        const reach = Math.max(1, _num(FishTraps.config().reach, 2));
        const far = Math.max(Math.abs(trap.x - InnerMap.playerInnerQ), Math.abs(trap.y - InnerMap.playerInnerR)) > reach;
        const now = this.now(game);
        if (trap.lantern) {
            const left = Math.max(0, _num(trap.lantern.until) - now);
            if (far) return [{ type: 'disabled', label: '🏮 Take Down the Lantern — come closer' }];
            return [{ type: 'action', action: 'torch_unhang', trapId: trap.id, label: 'Take Down the Lantern', icon: '🏮', desc: left > 0 ? `Burning: oil for ${_hrs(left)} more. No poacher comes near it while it burns` : 'It has burnt out' }];
        }
        if (!(_num((player.inventory || {})[CarriedLight.config().lantern.item]) >= 1)) return [];
        if (far) return [{ type: 'disabled', label: '🏮 Hang a Lantern at the Trap — come closer' }];
        const st = CarriedLight.state(player, false);
        const fuel = st ? st.fuel : 0;
        if (!(fuel > 0) && !CarriedLight.fuelsInPacks(player).length) return [{ type: 'disabled', label: '🏮 Hang a Lantern at the Trap — nothing to burn in it' }];
        return [{ type: 'action', action: 'torch_hang', trapId: trap.id, label: 'Hang a Lantern at the Trap', icon: '🏮', desc: 'On the marker stake: no poacher comes near it while it burns. The lantern and its oil stay with the trap' }];
    },

    handle(game, item) {
        if (!item || !/^torch_/.test(item.action || '')) return false;
        const player = game && game.player;
        if (!player) return true;
        const now = this.now(game);
        if (item.action === 'torch_light' || item.action === 'torch_lantern') {
            const kind = item.action === 'torch_light' ? 'torch' : 'lantern';
            const res = CarriedLight.light(player, kind, now);
            if (!res.ok) { _note(game, kind === 'torch' ? '🔥 No Torch' : '🏮 No Light', res.text.charAt(0).toUpperCase() + res.text.slice(1) + '.', 'warning'); return true; }
            // (lit, it shows you: the shutter is open)
            if (player.nightStreets) player.nightStreets.lightOut = false;
            LightSystem.playerLightDoused = false;
            const night = CarriedLight.strength(LightSystem.ambientDarkness) > 0;
            _note(game, kind === 'torch' ? '🔥 Torch Lit' : '🏮 Lantern Lit', kind === 'torch'
                ? `The pitch catches and flares.${night ? ' The dark draws back from you; everyone sees you coming, and by the water the fish come up to the light.' : ''}`
                : `${res.used ? `You fill it (${_name(res.used)}) and light the wick. ` : 'You light the wick. '}${night ? 'A steady glow about you.' : ''}`, 'info');
            this.update(game);
            return true;
        }
        if (item.action === 'torch_out') {
            const was = CarriedLight.putOut(player, now);
            if (was) _note(game, was === 'torch' ? '🔥 Torch' : '🏮 Lantern', was === 'torch' ? 'You put the torch out and keep the stub.' : 'You blow out the lantern.', 'info');
            this.update(game);
            return true;
        }
        if (item.action === 'torch_bind') {
            const res = CarriedLight.bindTorch(player);
            if (!res.ok) _note(game, '🪵 Bind a Torch', res.text, 'warning');
            else {
                _note(game, '🪵 Torches', `You bind ${_name(res.binder)} about the head of ${res.stick === 'sticks' ? 'a stout stick' : `the ${_name(res.stick)}`}: ${res.made} torch${res.made > 1 ? 'es' : ''}.`, 'info');
                if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
            }
            return true;
        }
        if (item.action === 'torch_hang' || item.action === 'torch_unhang') {
            const trap = FishTraps.find(game.world, item.trapId);
            if (!trap) { _note(game, '🧺 The Trap', 'The trap is gone.', 'warning'); return true; }
            if (item.action === 'torch_hang') {
                const res = CarriedLight.hangLantern(trap, player, now);
                _note(game, '🏮 Lantern', res.ok ? `${res.text} No poacher will come at it while it burns.` : res.text, res.ok ? 'info' : 'warning');
            } else {
                const res = CarriedLight.takeDownLantern(trap, player, now);
                if (res.ok) _note(game, '🏮 Lantern', res.left > 0 ? `You take the lantern down, still burning: oil for ${_hrs(res.left)} left in it.` : 'You take the burnt-out lantern down.', 'info');
            }
            this.update(game);
            return true;
        }
        return true;
    },

    // ── Drawing ──

    /**
     * The light in your hand (innerMapLayers/entities.js, about the player's sprite):
     * behind = the pass before the body (facing away, the hand is behind you).
     */
    drawHeld(ctx, px, py, ds, dir, now, behind) {
        const g = this._game;
        const kind = g && g.player ? CarriedLight.lit(g.player) : null;
        if (!kind || !InnerMap.active || InnerMap._underwater) return;
        if ((dir === DIR_UP) !== !!behind) return;
        const side = dir === DIR_LEFT ? -1 : dir === DIR_RIGHT ? 1 : dir === DIR_UP ? -1 : 1;
        const hx = px + side * ds * (dir === DIR_LEFT || dir === DIR_RIGHT ? 0.2 : 0.24);
        const hy = py - ds * 0.32;
        if (kind === 'torch') this._drawTorch(ctx, hx, hy, ds, now, side);
        else this._drawLantern(ctx, hx, hy + ds * 0.04, ds, now, true);
    },

    _drawTorch(ctx, hx, hy, ds, now, side) {
        const tip = { x: hx + side * ds * 0.05, y: hy - ds * 0.3 };
        ctx.save();
        // the shaft, held near its foot; the pitch-black wrapped head
        ctx.strokeStyle = '#5a3a1c';
        ctx.lineWidth = Math.max(1.5, ds * 0.055);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx - side * ds * 0.02, hy + ds * 0.08);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.fillStyle = '#2b1d12';
        ctx.fillRect(tip.x - ds * 0.04, tip.y - ds * 0.02, ds * 0.08, ds * 0.07);
        this._drawFlame(ctx, tip.x, tip.y - ds * 0.01, ds, now, 1);
        ctx.restore();
    },

    /** A flickering flame whose foot is at (x, y): outer orange, inner yellow, a white heart, a soft glow */
    _drawFlame(ctx, x, y, ds, now, scale) {
        const f1 = Math.sin(now * 13.1 + x * 0.07), f2 = Math.sin(now * 21.7 + y * 0.05), f3 = Math.sin(now * 7.3);
        const h = ds * scale * (0.2 + f1 * 0.03 + f2 * 0.02), w = ds * scale * (0.075 + f3 * 0.01);
        const lean = (f2 * 0.5 + f3 * 0.3) * ds * scale * 0.03;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(x, y - h * 0.4, 0, x, y - h * 0.4, ds * scale * 0.42);
        glow.addColorStop(0, 'rgba(255,170,70,0.38)');
        glow.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y - h * 0.4, ds * scale * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const tongue = (k, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x - w * k, y);
            ctx.quadraticCurveTo(x - w * k * 1.1, y - h * k * 0.5, x + lean * k, y - h * k);
            ctx.quadraticCurveTo(x + w * k * 1.1, y - h * k * 0.5, x + w * k, y);
            ctx.closePath();
            ctx.fill();
        };
        tongue(1, 'rgba(240,110,30,0.92)');
        tongue(0.68, 'rgba(255,196,64,0.95)');
        tongue(0.34, 'rgba(255,246,200,0.95)');
    },

    /** A horn lantern hung from (hx, hy): its bail, the frame, the glowing panes (dark when out) */
    _drawLantern(ctx, hx, hy, ds, now, lit) {
        const w = ds * 0.13, h = ds * 0.17;
        const sway = Math.sin(now * 2.1) * ds * 0.012;
        const x = hx + sway - w / 2, y = hy + ds * 0.05;
        ctx.save();
        ctx.strokeStyle = '#2a2118';
        ctx.lineWidth = Math.max(1, ds * 0.025);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + sway, y); ctx.stroke();
        if (lit) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, ds * 0.4);
            g.addColorStop(0, 'rgba(255,200,110,0.4)');
            g.addColorStop(1, 'rgba(255,160,60,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, ds * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = '#3a2c1c';
        ctx.fillRect(x - ds * 0.012, y, w + ds * 0.024, ds * 0.03);
        ctx.fillRect(x - ds * 0.012, y + h - ds * 0.02, w + ds * 0.024, ds * 0.03);
        ctx.fillStyle = lit ? `rgba(255,${200 + Math.round(Math.sin(now * 9) * 12)},110,0.95)` : 'rgba(70,60,48,0.9)';
        ctx.fillRect(x, y + ds * 0.03, w, h - ds * 0.05);
        ctx.fillStyle = '#3a2c1c';
        ctx.fillRect(x + w / 2 - ds * 0.01, y + ds * 0.03, ds * 0.02, h - ds * 0.05);
        ctx.restore();
    },

    /** A lantern hung on a trap's marker stake, its top at (x, y) (innerMapLayers/fishTraps.js) */
    drawTrapLantern(ctx, trap, x, y, cs, now, hour) {
        if (!trap || !trap.lantern) return;
        this._drawLantern(ctx, x + cs * 0.06, y, cs, now, CarriedLight.lanternBurning(trap, hour));
    },
};

// A lantern hung at a fish trap lights the water about it (LightSystem.moreLights)
LightSystem.moreLights.push((ls, camera) => {
    const world = InnerMapFishTraps._world;
    if (!world || !InnerMap.active || InnerMap._insideBuilding) return;
    const hour = _num(InnerMapFishTraps._nowH);
    for (const trap of InnerMapFishTraps.here(world)) {
        if (!CarriedLight.lanternBurning(trap, hour)) continue;
        const sc = camera.worldToScreenFast((trap.x + 0.5) * T, (trap.y + 0.2) * T);
        ls.addLight(sc.x, sc.y, 95 * camera.zoom, { r: 255, g: 200, b: 120 }, 0.75, 'point');
    }
});
