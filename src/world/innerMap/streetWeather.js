// ============================================
// InnerMap — the weather on the street, hour by hour
// ============================================
// The hex's weather at this hour (world/streetWeather.js) laid on the street map:
//
//   • _sw — the state the renderer and the game loop read (rain, snow, storm,
//     wind, puddles, mud, rainbow, fireflies, mist), bound by bindStreetWeather
//     (ui/innerMapWeather.js, every quarter hour of the map's clock). It also
//     sets InnerMap.weather to the hour's own weather, with its wind — the top
//     bar's hex weather stays the day's, the street sees the shower pass.
//   • weatherPace(q, r, mode) — ONE × speed for the going in the mud after
//     rain, read by the player's walk ('foot', or 'ride' on horseback:
//     movement.js), the carts ('cart': ui/innerMapCarts.js) and the townsfolk
//     ('npc', who also hurry in the rain: npcs.js). On unpaved roads and soft
//     ground (an unpaved road the season's mud doesn't slow: only soft ground,
//     world/streetSeasons.js pace) — the rain's fresh mud on top of the
//     season's mud of past days, never counted twice.
//   • isCoveredAt(q, r) — out of the rain: indoors, or under the eaves (the
//     cell just below a building's roof).
//   • _weatherPick(npc, period) — townsfolk out in heavy rain go home or
//     shelter under the eaves (world/innerMap/townLife.js asks).
//   • forceStreetWeather(over) — QA: hold the street at a given weather.
//
// Nothing is saved: it is all a pure function of the hex, the day and the hour.
// Draws from Utils only for who goes where out of the rain.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';
import { StreetWeather } from '../streetWeather.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// The pace table's slots: [road, soft] × [foot, ride, cart, npc]
const MODES = { foot: 0, ride: 1, cart: 2, npc: 3 };
const _isBuildingCell = t => !!(t && (t.building || t.buildingInfo || t.customBuilding || t.customBuildingPart));

Object.assign(InnerMap, {
    /** This hour's street weather (world/streetWeather.js at), or null. */
    _sw: null,
    _swKey: '',
    /** QA: fields held over the computed weather (forceStreetWeather). */
    _swForced: null,
    _swPace: null,
    /** The player has a cart in hand (pushed, or driven hitched): set each frame by ui/innerMapWeather.js. */
    _wxCartInHand: false,

    /** The map's clock as a fraction of the day's hours (12.5 is half past noon). */
    streetHour() {
        const acc = Number.isFinite(this._timeAccumulator) && this.TIME_SCALE ? this._timeAccumulator / this.TIME_SCALE : 0;
        return _num(this.timeOfDay, 12) + Math.max(0, Math.min(0.999, acc));
    },

    /**
     * Work out the street's weather now (world, the map's hex, its day and hour) and lay it on
     * the map. Returns the state (null off a map, without weather). Cheap when the quarter hour
     * hasn't moved on (the model remembers its last answer).
     */
    bindStreetWeather(world, hour = this.streetHour()) {
        const at = this.currentWorldTile;
        if (!this.active || !at || !world) { this._sw = null; this._swPace = null; return null; }
        const day = Math.floor(_num(world.day, _num(this.worldDay, 1)));
        let st = StreetWeather.at(world, at.q, at.r, day, hour);
        if (!st) { this._sw = null; this._swPace = null; return null; }
        if (this._swForced) st = this._applyForced(st, this._swForced);
        this._sw = st;
        const key = `${st.type}|${Math.round(st.rain * 20)}|${Math.round(st.snow * 20)}|${Math.round(st.mud * 50)}|${Math.round(st.wind.strength * 20)}|${this._ss ? this._ss.mud : 0}|${day}`;
        if (key !== this._swKey) {
            this._swKey = key;
            this._buildWeatherPace(st);
        }
        // The street's weather is the hour's (HUD, water, ambient smoke and the townsfolk's talk read it);
        // laid again when entering a map or a new day put the day's back
        const w = this.weather;
        const intensity = st.rain > 0 ? st.rain : st.snow > 0 ? st.snow : st.intensity;
        if (!w || !w.hourly || w.type !== st.type || Math.abs(_num(w.intensity) - intensity) > 0.04 || Math.abs(_num(w.wind) - st.wind.strength) > 0.04) {
            this.weather = { type: st.type, intensity, wind: st.wind.strength, hourly: true };
        }
        // ...and the air as warm as the hour (cooler in the small hours, warmest of an afternoon)
        const c = Math.round(st.celsius);
        if (!this.temperature || this.temperature.celsius !== c) {
            this.temperature = { value: Math.max(0, Math.min(1, (c + 30) / 80)), celsius: c, fahrenheit: Math.round(c * 1.8 + 32) };
        }
        return st;
    },

    /** Merge a forced weather over the model's (QA): type sets what falls; any field may be given. */
    _applyForced(st, f) {
        const out = { ...st, wind: { ...st.wind } };
        if (f.type) {
            out.type = f.type;
            const heavy = f.type === 'storm' || f.type === 'blizzard';
            out.rain = f.type === 'rain' ? _num(f.rain, 0.7) : f.type === 'storm' ? 1 : 0;
            out.snow = f.type === 'snow' ? _num(f.snow, 0.7) : f.type === 'blizzard' ? 1 : 0;
            out.storm = heavy;
            out.intensity = heavy ? 1 : Math.max(out.rain, out.snow, f.type === 'cloudy' ? 0.6 : 0);
            out.cloud = f.type === 'clear' || f.type === 'heatwave' ? 0 : f.type === 'cloudy' ? 0.7 : 1;
            out.sun = f.type === 'clear' || f.type === 'heatwave' ? 1 : f.type === 'cloudy' ? 0.3 : 0;
            if (heavy) out.wind.strength = Math.max(out.wind.strength, 0.9);
        }
        for (const k of ['rain', 'snow', 'puddles', 'mud', 'damp', 'rainbow', 'fireflies', 'fog', 'cloud', 'sun', 'celsius', 'sinceRain']) {
            if (Number.isFinite(Number(f[k]))) out[k] = Number(f[k]);
        }
        if (Number.isFinite(Number(f.wind))) {
            const s = Math.max(0, Math.min(1, Number(f.wind)));
            const len = Math.hypot(out.wind.x, out.wind.y) || 1;
            out.wind = { x: out.wind.x / len * s || s, y: out.wind.y / len * s, strength: s };
        }
        if (f.storm != null) out.storm = !!f.storm;
        out.raining = out.rain > 0;
        out.snowing = out.snow > 0;
        return out;
    },

    /**
     * QA: hold the street at a weather until cleared — e.g.
     * InnerMap.forceStreetWeather({ type: 'storm' }), ({ type: 'clear', rainbow: 1 }),
     * ({ type: 'clear', fireflies: 1 }), ({ fog: 1 }), ({ mud: 1, puddles: 1 }); null clears it.
     */
    forceStreetWeather(over) {
        this._swForced = over && typeof over === 'object' ? { ...over } : null;
        this._swKey = '';
        StreetWeather.clearMemo();
        return this._swForced;
    },

    /** The × speed table for this hour's mud ([road, soft] × [foot, ride, cart, npc]), or null when it doesn't slow. */
    _buildWeatherPace(st) {
        this._swPace = null;
        if (!st) return;
        const P = StreetWeather.config().pace;
        const dailyMud = this._ss ? _num(this._ss.mud, 0) : 0;
        const total = Math.max(dailyMud, _num(st.mud, 0));
        const hurry = (st.rain > 0 || st.storm) ? _num(P.hurryInRain, 1.15) : 1;
        const t = new Float32Array(8);
        let any = hurry !== 1;
        const modes = ['foot', 'ride', 'cart', 'foot'];
        for (let m = 0; m < 4; m++) {
            // an unpaved road: the season's own pace leaves it be, so all of the mud is the weather's
            const road = StreetWeather.mudPace(total, 'road', modes[m]);
            // soft ground: the season's mud already slows it (_groundPace), only the rain's fresh mud over it
            const soft = total > dailyMud ? StreetWeather.mudPace(total, 'soft', modes[m]) / StreetWeather.mudPace(dailyMud, 'soft', modes[m]) : 1;
            t[m] = road; t[4 + m] = soft;
            if (road !== 1 || soft !== 1) any = true;
        }
        if (!any) return;
        this._swPace = { t, hurry };
    },

    /**
     * × speed of the weather over cell (q, r): the mud after rain on unpaved roads and soft
     * ground. mode 'foot' | 'ride' | 'cart' | 'npc' (townsfolk: they also hurry in the rain).
     * 1 indoors, off the map, on paving, grass, in dry weather.
     */
    weatherPace(q, r, mode = 'foot') {
        const P = this._swPace;
        if (!P || this._insideBuilding) return 1;
        // (the player pushing a cart or driving one hitched: the wheels' pace, not the feet's — ui/innerMapWeather.js sets it)
        const m = this._wxCartInHand && (mode === 'foot' || mode === 'ride') ? 2 : MODES[mode] != null ? MODES[mode] : 0;
        const row = this.tiles && this.tiles[r];
        const t = row ? row[q] : null;
        let k = 1;
        if (t && this._groundKind) {
            const g = this._groundKind(t);
            if (g === 'road') k = P.t[m];
            else if (g === 'soft') k = P.t[4 + m];
        }
        return m === 3 ? k * P.hurry : k;
    },

    /** Is cell (q, r) out of the rain: indoors, or under a building's eaves? */
    isCoveredAt(q, r) {
        if (this._insideBuilding) return true;
        const tiles = this.tiles;
        const t = tiles && tiles[r] ? tiles[r][q] : null;
        if (!t) return false;
        if (t._isInterior || _isBuildingCell(t)) return true;
        // the eaves: the roof overhangs the cell in front of its wall
        const up = tiles[r - 1] ? tiles[r - 1][q] : null;
        return _isBuildingCell(up);
    },

    /**
     * A townsperson choosing what to do next in the rain (world/innerMap/townLife.js):
     * in heavy rain most go home or under the eaves, in light rain a few. Returns
     * true when they've set off out of the rain.
     */
    _weatherPick(npc /* , period */) {
        const sw = this._sw;
        if (!sw || this._insideBuilding || !(sw.rain > 0 || sw.snow > 0.6)) return false;
        if (!npc || npc.type === 'guard' || npc.type === 'traveler') return false;
        const S = StreetWeather.config().shelter;
        const heavy = sw.storm || sw.rain >= _num(S.heavyAt, 0.55) || sw.snow >= 0.85;
        const rnd = Utils.random;
        if (rnd() >= (heavy ? _num(S.heavyShare, 0.65) : _num(S.lightShare, 0.2))) return false;
        if (rnd() < _num(S.eavesShare, 0.4) && this._townBuildings) {
            // the nearest of a few buildings: stand at its door, out of the wet
            const blds = this._townBuildings();
            let best = null, bd = Infinity;
            for (let i = 0; i < 4 && blds.length; i++) {
                const b = blds[Math.floor(rnd() * blds.length)];
                const d = Math.abs(b.q - npc.q) + Math.abs(b.r - npc.r);
                if (d < bd) { bd = d; best = b; }
            }
            if (best && bd < 14) {
                const door = this._findPassableAdjacentTile(best.q, best.r);
                if (door && this._goStand(npc, door, 'stroll', 2)) return true;
            }
        }
        return npc._home ? this._goHome(npc, 'home') : false;
    },
});
