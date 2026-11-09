// ============================================================
// INNER MAP — spear fishing under the water
// ============================================================
// While diving (ui/innerMapDiving.js) with a fishing spear in the packs, the
// player strikes at the fish swimming about them (innerMapLayers/
// underwaterFish.js):
//
//   • Point at a fish and press F: close in (the strike reach) it is a
//     thrust, farther off (the throw reach) the spear is thrown on its line
//     and hauled back. Or right-click near a fish: Strike at / Throw at, with
//     the chance to hit.
//   • A ring over the fish under the cursor shows the aim: the chance to hit,
//     green to red, grey when out of reach or the spear isn't back in hand.
//   • A hit: the fish is gone from the water and into the packs (on the
//     dive's haul: a blackout loses it). A miss: the fish about it bolt.
//   • Each strike costs breath; the spear wears and may break.
//
// Without a spear, F and the menu say so plainly. The rules (odds, catch,
// wear, breath) are player/spearFishing.js; numbers in data/diving.json `spear`.

import { InnerMap } from '../world/innerMap.js';
import { SpearFishing } from '../player/spearFishing.js';
import { UnderwaterFish } from './innerMapLayers/underwaterFish.js';
import { Hotbar } from './hotbar.js';

const T = 32; // the inner map's tile size

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/** 'mackerel' → 'mackerel'; a species' name for the text. */
function _name(sp) {
    return String((sp && (sp.name || sp.id)) || 'fish').replace(/_/g, ' ');
}

const NO_SPEAR = 'You have no fishing spear. You need one to spear fish; without it you can only watch them go by.';

export const InnerMapSpearFishing = {
    _game: null,
    _keysBound: false,
    // The spear in flight (drawn): { x0, y0, x1, y1, t0, dur, hit, mode }
    _flight: null,
    _wornTold: false,

    /** Is the diver under the water (InnerMapDiving sets this module's game each frame)? */
    _under(game) {
        return !!(game && game.player && game.player.dive && InnerMap._underwater);
    },

    /** The cursor, in tiles on the inner map (null when off the canvas). */
    cursor(game) {
        const cam = game && game.innerMapCamera;
        if (!cam || game.mouseX == null || game.mouseY == null || typeof cam.screenToWorld !== 'function') return null;
        const w = cam.screenToWorld(game.mouseX, game.mouseY);
        return { x: w.x / T, y: w.y / T };
    },

    /** The fish under the cursor (within aimRadius of it), or null. */
    aimed(game) {
        const c = this.cursor(game);
        if (!c) return null;
        return UnderwaterFish.nearest(c.x, c.y, Number(SpearFishing.config().aimRadius) || 0.9);
    },

    /** What a strike at this fish would be → { species, dist, speed, mode, chance } */
    targetOf(game, f) {
        const p = UnderwaterFish._diver();
        const dist = Math.hypot(f.x - p.x, f.y - p.y);
        const t = { species: f.sp, dist, speed: UnderwaterFish.speedOf(f) };
        const mode = SpearFishing.modeFor(dist);
        return { ...t, mode, chance: mode && game && game.player ? SpearFishing.hitChance(game.player, t, mode) : 0 };
    },

    // ══════════════════════════════════════════════
    // THE MENU (right-click while under)
    // ══════════════════════════════════════════════

    /** The spear entries for a cell clicked under the water. */
    menuItems(game, q, r) {
        if (!this._under(game)) return [];
        if (!SpearFishing.hasSpear(game.player)) {
            return UnderwaterFish.fish.length ? [{ type: 'disabled', label: '🔱 Spear Fishing — you have no fishing spear' }] : [];
        }
        const cx = q + 0.5, cy = r + 0.5;
        const near = UnderwaterFish.fish
            .map(f => ({ f, d: Math.hypot(f.x - cx, f.y - cy) }))
            .filter(x => x.d <= 1.2)
            .sort((a, b) => a.d - b.d)
            .slice(0, 3);
        const M = SpearFishing.config().modes;
        const items = [];
        for (const { f } of near) {
            const t = this.targetOf(game, f);
            const name = _name(f.sp);
            if (!t.mode) {
                items.push({ type: 'disabled', label: `🔱 The ${name} — out of reach of your spear` });
                continue;
            }
            const m = M[t.mode];
            items.push({
                type: 'action', action: 'dive_spear', fish: f, icon: '🔱',
                label: `${t.mode === 'strike' ? 'Strike at' : 'Throw at'} the ${name}`,
                desc: `${Math.round(t.chance * 100)}% to hit · ${m.breath}s of breath (F at the cursor)`,
            });
        }
        return items;
    },

    /** The dive_spear action. */
    handle(game, item) {
        const f = item && item.fish;
        if (!f || !UnderwaterFish.fish.includes(f)) { _note(game, '🔱 Spear Fishing', 'It has swum off.', 'info'); return true; }
        this.strikeAt(game, f);
        return true;
    },

    // ══════════════════════════════════════════════
    // THE STRIKE
    // ══════════════════════════════════════════════

    /** F: strike at the fish under the cursor. */
    strikeAimed(game) {
        if (!this._under(game)) return false;
        if (!SpearFishing.hasSpear(game.player)) { _note(game, '🔱 No Fishing Spear', NO_SPEAR, 'warning'); return false; }
        const f = this.aimed(game);
        if (!f) { _note(game, '🔱 Spear Fishing', 'Point at a fish, then press F to strike at it.', 'info'); return false; }
        return this.strikeAt(game, f);
    },

    /** Strike at (or throw at) a fish. → true when the spear went */
    strikeAt(game, f) {
        const player = game && game.player;
        if (!player) return false;
        const can = SpearFishing.canStrike(player);
        if (!can.ok) {
            if (can.noSpear) _note(game, '🔱 No Fishing Spear', NO_SPEAR, 'warning');
            else if (!can.cooling) _note(game, '🔱 Spear Fishing', can.reason, 'warning');
            return false;
        }
        const t = this.targetOf(game, f);
        if (!t.mode) { _note(game, '🔱 Out of Reach', `The ${_name(f.sp)} is too far off for your spear. Swim closer.`, 'info'); return false; }
        const p = UnderwaterFish._diver();
        const res = SpearFishing.strike(player, t);
        if (!res.ok) { _note(game, '🔱 Spear Fishing', res.reason, 'warning'); return false; }
        const M = SpearFishing.config().modes[res.mode] || {};
        this._flight = { x0: p.x, y0: p.y, x1: f.x, y1: f.y, t0: _now(), dur: res.mode === 'throw' ? 0.35 : 0.18, hit: res.hit, mode: res.mode, back: Number(M.cooldown) || 0.8 };
        const name = _name(f.sp);
        if (res.hit) {
            UnderwaterFish.remove(f);
            const c = res.catch;
            if (res.kept) {
                _note(game, '🔱 Speared!', `${res.mode === 'throw' ? 'Your throw takes' : 'You run through'} the ${name}: ${c.icon} ${c.name}${c.bigger ? ' — a big one' : ''}.`, 'success');
            } else {
                _note(game, '🎒 Packs Full', `You spear the ${name}, but there is no room for it; you let it go.`, 'warning');
            }
        } else {
            const n = UnderwaterFish.scare(f.x, f.y, Number(res.scare && res.scare.radius) || 3, Number(res.scare && res.scare.seconds) || 2.5);
            _note(game, '🔱 Missed', `The spear goes wide of the ${name}${n > 1 ? ' and the fish about it scatter' : ' and it bolts'}.`, 'info');
        }
        if (res.broke) {
            _note(game, '💥 Spear Broken', res.snapped ? `The ${name} wrenches on the point and the shaft snaps. Your fishing spear is gone.` : 'The worn shaft gives at last and breaks. Your fishing spear is gone.', 'error');
            this._wornTold = false;
        } else if (!this._wornTold && res.wear / Math.max(1, res.durability) >= 0.8) {
            this._wornTold = true;
            _note(game, '🔱 Spear Worn', 'Your fishing spear is getting worn; the shaft creaks. It will not last much longer.', 'warning');
        }
        if (res.levelUp) _note(game, `${res.levelUp.icon} ${res.levelUp.name} Improved`, res.levelUp.text, 'success');
        if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        return true;
    },

    // ══════════════════════════════════════════════
    // EACH FRAME, AND THE KEY
    // ══════════════════════════════════════════════

    /** Each frame while under (from InnerMapDiving.update). */
    update(deltaTime, game) {
        this._bindKeys(game);
        if (game && game.player) SpearFishing.tick(game.player, deltaTime);
    },

    _bindKeys(game) {
        if (game) this._game = game;
        if (this._keysBound || typeof window === 'undefined' || !window.addEventListener) return;
        this._keysBound = true;
        // One listener only, even when this module is reloaded
        if (window.__spearKeys) window.removeEventListener('keydown', window.__spearKeys);
        window.__spearKeys = (e) => {
            if (e.key !== 'f' && e.key !== 'F') return;
            if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
            const g = this._game;
            if (!g || !InnerMap.active || !this._under(g)) return;
            this.strikeAimed(g);
        };
        window.addEventListener('keydown', window.__spearKeys);
    },

    // ══════════════════════════════════════════════
    // DRAWING (from innerMapLayers/underwater.js, over the fish)
    // ══════════════════════════════════════════════

    draw(ctx, camera, ds, now = _now()) {
        const game = this._game;
        if (!this._under(game)) { this._flight = null; return; }
        this._drawFlight(ctx, camera, ds, now);
        if (!SpearFishing.hasSpear(game.player)) return;
        const f = this.aimed(game);
        if (!f) return;
        const t = this.targetOf(game, f);
        const cooling = SpearFishing.cooldown(game.player) > 0;
        const s = camera.worldToScreenFast(f.x * T, f.y * T);
        const rad = Math.max(ds * 0.35, (Number(f.sp.length) || 0.5) * ds * 0.6);
        const col = !t.mode || cooling ? 'rgba(190, 200, 205, 0.7)'
            : t.chance >= 0.6 ? 'rgba(120, 230, 140, 0.95)' : t.chance >= 0.3 ? 'rgba(240, 200, 90, 0.95)' : 'rgba(240, 110, 90, 0.95)';
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.5, ds / 18);
        if (!t.mode) ctx.setLineDash([ds / 8, ds / 10]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Ticks at the four points of the ring
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(s.x + Math.cos(a) * rad * 0.7, s.y + Math.sin(a) * rad * 0.7);
            ctx.lineTo(s.x + Math.cos(a) * rad * 1.25, s.y + Math.sin(a) * rad * 1.25);
            ctx.stroke();
        }
        // The chance, or why not
        const label = !t.mode ? 'out of reach' : cooling ? '…' : `${t.mode === 'throw' ? 'throw' : 'strike'} ${Math.round(t.chance * 100)}%`;
        ctx.font = `600 ${Math.max(10, Math.round(ds * 0.28))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 20, 25, 0.8)';
        ctx.strokeText(label, s.x, s.y - rad * 1.3);
        ctx.fillStyle = col;
        ctx.fillText(label, s.x, s.y - rad * 1.3);
        ctx.restore();
    },

    /** The spear going out (and, thrown, coming back on its line). */
    _drawFlight(ctx, camera, ds, now) {
        const fl = this._flight;
        if (!fl) return;
        const age = now - fl.t0;
        const back = fl.mode === 'throw' ? Math.max(0.3, fl.back * 0.6) : 0.15;
        if (age > fl.dur + back) { this._flight = null; return; }
        // Out to the mark, then back to the hand
        const k = age <= fl.dur ? age / fl.dur : 1 - (age - fl.dur) / back;
        const p = UnderwaterFish._diver();
        const x0 = age <= fl.dur ? fl.x0 : p.x, y0 = age <= fl.dur ? fl.y0 : p.y;
        const tipX = x0 + (fl.x1 - x0) * k, tipY = y0 + (fl.y1 - y0) * k;
        const a = camera.worldToScreenFast(x0 * T, y0 * T);
        const b = camera.worldToScreenFast(tipX * T, tipY * T);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = ds * 0.9;
        ctx.save();
        // The line, for a throw
        if (fl.mode === 'throw') {
            ctx.strokeStyle = 'rgba(220, 230, 225, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        // The shaft and its point
        ctx.strokeStyle = '#8a6a3e';
        ctx.lineWidth = Math.max(2, ds / 14);
        ctx.beginPath();
        ctx.moveTo(b.x - Math.cos(ang) * len, b.y - Math.sin(ang) * len);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = '#c9d2d6';
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(ang) * ds * 0.14, b.y + Math.sin(ang) * ds * 0.14);
        ctx.lineTo(b.x + Math.cos(ang + 2.5) * ds * 0.1, b.y + Math.sin(ang + 2.5) * ds * 0.1);
        ctx.lineTo(b.x + Math.cos(ang - 2.5) * ds * 0.1, b.y + Math.sin(ang - 2.5) * ds * 0.1);
        ctx.closePath();
        ctx.fill();
        // A burst of bubbles where it struck (a cloud of red for a hit)
        if (age > fl.dur * 0.8 && age < fl.dur + 0.4) {
            const e = camera.worldToScreenFast(fl.x1 * T, fl.y1 * T);
            const ph = Math.min(1, (age - fl.dur * 0.8) / 0.5);
            for (let i = 0; i < 6; i++) {
                const an = i * 1.05 + fl.t0;
                const r = ds * (0.1 + ph * 0.35);
                ctx.fillStyle = fl.hit ? `rgba(170, 40, 40, ${0.45 * (1 - ph)})` : `rgba(225, 248, 255, ${0.7 * (1 - ph)})`;
                ctx.beginPath();
                ctx.arc(e.x + Math.cos(an) * r, e.y + Math.sin(an) * r, Math.max(1, ds * 0.04), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    },
};
