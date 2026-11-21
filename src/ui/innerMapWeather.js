// ============================================
// The weather on the street map — the game loop's side
// ============================================
// Once a frame on the street map (ui/game/gameLoop.js):
//   - the hour's street weather laid on the map (world/innerMap/streetWeather.js
//     bindStreetWeather: rain, snow, the storm, wind, puddles, mud, the going);
//   - the player getting wet out in it, and drying indoors or by a fire
//     (player/wetness.js), told when soaked through and dry again;
//   - the storm's lightning struck (the flash and the bolt: innerMapLayers/
//     weatherFx.js) and its thunder sent after it, nearer the sooner
//     (systems/audio sfx 'thunder' / 'thunder_far').
// Its own random stream for the lightning (cosmetic, never the game's RNG).
//
// QA from the console (the engine's dev handle):
//   InnerMap.forceStreetWeather({ type: 'storm' })            rain, wind, lightning
//   InnerMap.forceStreetWeather({ type: 'rain', rain: 0.3 })  a light shower
//   InnerMap.forceStreetWeather({ type: 'snow' }) / ({ type: 'blizzard' })
//   InnerMap.forceStreetWeather({ type: 'clear', rainbow: 1 })
//   InnerMap.forceStreetWeather({ type: 'clear', fireflies: 1 })   (best at night)
//   InnerMap.forceStreetWeather({ fog: 1 })   ({ mud: 1, puddles: 1 })
//   InnerMap.forceStreetWeather(null)          back to the world's weather

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { StreetWeather } from '../world/streetWeather.js';
import { Wetness } from '../player/wetness.js';
import { audioManager } from '../systems/audio.js';
import { InnerMapCarts } from './innerMapCarts.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function _mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const _rand = _mulberry(0x7b011e);

export const InnerMapWeather = {
    _lastH: null,
    _acc: 0,
    _strikeIn: 4,
    _thunder: [],     // [{ at, kind }] on this module's clock
    _clock: 0,

    update(game, dt) {
        if (!InnerMap.active || !game || !game.world || !InnerMap.bindStreetWeather) return;
        const world = game.world;
        const hour = InnerMap.streetHour();
        const sw = InnerMap.bindStreetWeather(world, hour);
        // (a cart in hand takes the mud as wheels do: world/innerMap/streetWeather.js weatherPace)
        InnerMap._wxCartInHand = InnerMapCarts._baseSpeed != null;
        const step = Math.max(0, Math.min(0.25, _num(dt)));
        this._clock += step;

        // ── The player: wet out in it, dry indoors ──
        const player = game.player;
        const H = Math.floor(_num(world.day, 1)) * 24 + hour;
        if (this._lastH == null || H < this._lastH || H - this._lastH > 24) this._lastH = H;
        const dh = H - this._lastH;
        if (player && sw && dh >= 1 / 30) {
            this._lastH = H;
            const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
            const indoors = !!InnerMap._insideBuilding;
            const res = Wetness.tick(player, dh, {
                rain: sw.rain,
                snow: sw.snow,
                covered: indoors || InnerMap.isCoveredAt(q, r),
                indoors,
                nearFire: this._nearFire(),
                swimming: !!(InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()),
                celsius: sw.celsius,
                wind: sw.wind ? sw.wind.strength : 0,
                world,
            });
            for (const n of res.notices.slice(0, 2)) {
                if (game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(n.title.startsWith(n.icon) ? n.title : `${n.icon} ${n.title}`, n.text, n.type);
            }
            if (res.caught && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        } else if (!sw) {
            this._lastH = H;
        }
        const lvl = player ? Wetness.level(player) : null;
        InnerMapRenderer._wxPlayerWet = player ? Wetness.get(player) : 0;
        InnerMapRenderer._wxWetLabel = lvl ? lvl.label : null;

        // ── The storm: lightning, then the thunder ──
        if (sw && sw.storm && sw.type === 'storm' && step > 0) {
            this._strikeIn -= step;
            if (this._strikeIn <= 0) {
                const fx = StreetWeather.config().fx || {};
                const ev = Array.isArray(fx.lightningEvery) ? fx.lightningEvery : [5, 16];
                this._strikeIn = _num(ev[0], 5) + _rand() * (_num(ev[1], 16) - _num(ev[0], 5));
                const near = _rand() < 0.45;
                // (indoors the flash isn't seen, but the thunder is heard)
                if (!InnerMap._insideBuilding && InnerMapRenderer._wxStrike) InnerMapRenderer._wxStrike(near);
                const td = Array.isArray(fx.thunderDelay) ? fx.thunderDelay : [0.8, 4.5];
                const delay = near ? _num(td[0], 0.8) + _rand() * 0.6 : _num(td[0], 0.8) + 1 + _rand() * (_num(td[1], 4.5) - _num(td[0], 0.8) - 1);
                if (this._thunder.length < 4) this._thunder.push({ at: this._clock + delay, kind: near ? 'thunder' : 'thunder_far' });
            }
        }
        for (let i = this._thunder.length - 1; i >= 0; i--) {
            if (this._thunder[i].at > this._clock) continue;
            const kind = this._thunder[i].kind;
            this._thunder.splice(i, 1);
            try { audioManager.playSFX(kind); } catch { /* sound is best-effort */ }
        }
    },

    /** A fire's glow within reach of the player (the ambient layer's glows on screen: hearths, campfires, braziers). */
    _nearFire() {
        const gl = InnerMapRenderer._ambGl;
        const n = _num(InnerMapRenderer._ambGlN, 0);
        if (!gl || !n) return false;
        const T = 32;
        const reach = _num((StreetWeather.config().wetness || {}).fireTiles, 2.5) * T;
        const px = InnerMap.playerInnerQ * T + T / 2, py = InnerMap.playerInnerR * T + T / 2;
        for (let i = 0; i < n && i < gl.length; i++) {
            const g = gl[i];
            if (!g || g.alpha < 0.2) continue;
            if (Math.abs(g.x - px) <= reach && Math.abs(g.y - py) <= reach) return true;
        }
        return false;
    },
};
