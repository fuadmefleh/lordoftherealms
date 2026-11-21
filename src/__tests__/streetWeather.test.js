/**
 * The weather on the street map hour by hour (world/streetWeather.js), laid on the
 * map (world/innerMap/streetWeather.js: the going in the mud, shelter, the hour's
 * weather) and felt by the player (player/wetness.js).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMap } from '../world/innerMap.js';
import { StreetWeather } from '../world/streetWeather.js';
import { Wetness } from '../player/wetness.js';
import { WeatherSystem } from '../world/weather.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

// Days of the year: spring 1-30, summer 31-60, autumn 61-90, winter 91-120
const SUMMER = 120 * 2 + 45;
const WINTER = 120 * 2 + 105;

/**
 * A world of one hex whose precipitation is `precip(H)` at absolute hour H (day × 24 + hour):
 * the street model reads the world's field at (H − 12) / 24, so H = t × 24 + 12.
 */
function world({ temperature = 0.55, precip = () => 0.3, day = SUMMER } = {}) {
    const tile = { q: 5, r: 5, temperature, terrain: { id: 'grassland' } };
    return {
        day,
        width: 40,
        height: 40,
        generationParams: { seed: 7 },
        weather: { seed: 99, precipitation: (q, r, t) => precip(t * 24 + 12) },
        getTile: (q, r) => (q === 5 && r === 5 ? tile : null),
    };
}

// Hold the street's settings for a test (no showers' wobble, a sure rainbow)
let _saved;
function withConfig(over) {
    const g = DataLoader._gamedata;
    _saved = g.streetWeather;
    const base = _saved || {};
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = { ...(base[k] || {}), ...v };
    g.streetWeather = out;
    StreetWeather.clearMemo();
}

beforeEach(() => {
    Utils.setSeed(12345);
    withConfig({ hourly: { showerAmp: 0 }, rainbow: { chance: 1 } });
});
afterEach(() => {
    DataLoader._gamedata.streetWeather = _saved;
    StreetWeather.clearMemo();
});

describe('the hour\'s weather from the world\'s', () => {
    it('reads the world\'s own precipitation field, its day\'s value at noon', () => {
        let asked = null;
        const w = world();
        w.weather.precipitation = (q, r, t) => { asked = t; return 0.5; };
        expect(StreetWeather.precipAt(w, 5, 5, SUMMER * 24 + 12)).toBe(0.5);
        expect(asked).toBe(SUMMER);
        StreetWeather.precipAt(w, 5, 5, SUMMER * 24 + 18);
        expect(asked).toBeCloseTo(SUMMER + 0.25, 6);
    });

    it('maps the precipitation to what falls, with the world weather\'s thresholds', () => {
        const at = p => StreetWeather.at(world({ precip: () => p }), 5, 5, SUMMER, 12);
        expect(at(0.2).type).toBe('clear');
        expect(at(0.55).type).toBe('cloudy');
        const light = at(0.72);
        expect(light.type).toBe('rain');
        expect(light.rain).toBeCloseTo((0.72 - 0.68) * 4, 3);
        expect(light.raining).toBe(true);
        const storm = at(0.95);
        expect(storm.type).toBe('storm');
        expect(storm.storm).toBe(true);
        expect(storm.rain).toBe(1);
        // the storm's wind is up
        expect(storm.wind.strength).toBeGreaterThan(at(0.2).wind.strength);
    });

    it('at noon agrees with the real world weather\'s day (the top bar\'s icon)', () => {
        const tile = { q: 5, r: 5, temperature: 0.5, terrain: { id: 'grassland' } };
        const w = { day: 1, width: 40, height: 40, generationParams: { seed: 7 }, getTile: () => tile };
        w.weather = new WeatherSystem(w);
        let compared = 0, rainy = 0;
        for (let d = 1; d <= 60; d++) {
            const daily = w.weather.getWeather(5, 5, d).type;
            const st = StreetWeather.at(w, 5, 5, d, 12);
            if (daily === 'heatwave' || st.type === 'heatwave') continue;
            expect(st.type).toBe(daily);
            compared++;
            if (st.raining) rainy++;
        }
        expect(compared).toBeGreaterThan(40);
        expect(rainy).toBeGreaterThan(0);
    });

    it('below freezing what falls is snow', () => {
        const st = StreetWeather.at(world({ temperature: 0.2, precip: () => 0.78, day: WINTER }), 5, 5, WINTER, 12);
        expect(st.celsius).toBeLessThan(1);
        expect(st.type).toBe('snow');
        expect(st.snow).toBeGreaterThan(0);
        expect(st.rain).toBe(0);
        expect(StreetWeather.at(world({ temperature: 0.2, precip: () => 0.9, day: WINTER }), 5, 5, WINTER, 12).type).toBe('blizzard');
    });

    it('a shower passes: dry at one hour, raining at another, as the front moves', () => {
        const rainFrom = SUMMER * 24 + 15;
        const w = world({ precip: H => (H >= rainFrom ? 0.8 : 0.3) });
        expect(StreetWeather.at(w, 5, 5, SUMMER, 13).raining).toBe(false);
        expect(StreetWeather.at(w, 5, 5, SUMMER, 16).raining).toBe(true);
    });

    it('the afternoon is warmer than the small hours', () => {
        const w = world();
        expect(StreetWeather.at(w, 5, 5, SUMMER, 15).celsius).toBeGreaterThan(StreetWeather.at(w, 5, 5, SUMMER, 3).celsius);
    });
});

describe('the ground after rain', () => {
    it('puddles and mud form in the rain and dry out after it', () => {
        const stopH = SUMMER * 24 + 12;
        const w = world({ precip: H => (H < stopH ? 0.86 : 0.3) });
        const dry = StreetWeather.at(world(), 5, 5, SUMMER, 14);
        expect(dry.puddles).toBe(0);
        expect(dry.mud).toBe(0);
        const after = StreetWeather.at(w, 5, 5, SUMMER, 14);
        expect(after.raining).toBe(false);
        expect(after.puddles).toBeGreaterThan(0.5);
        expect(after.mud).toBeGreaterThan(0.3);
        expect(after.sinceRain).toBeCloseTo(2, 5);
        // a day on: the puddles gone, the mud drying
        const later = StreetWeather.at(w, 5, 5, SUMMER + 1, 14);
        expect(later.puddles).toBeLessThan(after.puddles);
        expect(later.puddles).toBeLessThan(0.05);
        expect(later.mud).toBeLessThan(after.mud);
    });
});

describe('a rainbow', () => {
    const stopAt = (hour) => SUMMER * 24 + hour;

    it('shows a little while after a good rain clears with the sun out', () => {
        const w = world({ precip: H => (H < stopAt(12) ? 0.85 : 0.2) });
        expect(StreetWeather.at(w, 5, 5, SUMMER, 12.75).rainbow).toBeGreaterThan(0);
        // ...and is gone a couple of hours on
        expect(StreetWeather.at(w, 5, 5, SUMMER, 15).rainbow).toBe(0);
    });

    it('not while it rains, not without rain before, not under cloud, not at night', () => {
        expect(StreetWeather.at(world({ precip: () => 0.85 }), 5, 5, SUMMER, 12.75).rainbow).toBe(0);
        expect(StreetWeather.at(world({ precip: () => 0.2 }), 5, 5, SUMMER, 12.75).rainbow).toBe(0);
        expect(StreetWeather.at(world({ precip: H => (H < stopAt(12) ? 0.85 : 0.64) }), 5, 5, SUMMER, 12.75).rainbow).toBe(0);
        expect(StreetWeather.at(world({ precip: H => (H < stopAt(0) ? 0.85 : 0.2) }), 5, 5, SUMMER, 0.75).rainbow).toBe(0);
    });
});

describe('fireflies', () => {
    it('only on warm, dry summer nights', () => {
        const clear = world({ precip: () => 0.2 });
        expect(StreetWeather.at(clear, 5, 5, SUMMER, 22).fireflies).toBeGreaterThan(0);
        expect(StreetWeather.at(clear, 5, 5, SUMMER, 14).fireflies).toBe(0);
        expect(StreetWeather.at(world({ precip: () => 0.8 }), 5, 5, SUMMER, 22).fireflies).toBe(0);
        expect(StreetWeather.at(world({ temperature: 0.3, precip: () => 0.2, day: WINTER }), 5, 5, WINTER, 22).fireflies).toBe(0);
    });

    it('no mist at noon', () => {
        expect(StreetWeather.at(world({ precip: () => 0.6 }), 5, 5, SUMMER, 12).fog).toBe(0);
    });
});

/** A player with needs and clothes, as the needs mixin keeps them. */
function player() {
    return {
        wetness: 0,
        clothesFreshness: 100,
        needs: { hunger: 80, energy: 80, social: 80, fun: 80, hygiene: 80, comfort: 80 },
        modifyNeed(n, a) { this.needs[n] = Math.max(0, Math.min(100, this.needs[n] + a)); },
        soilClothes(a) { this.clothesFreshness = Math.max(0, this.clothesFreshness - a); },
    };
}

describe('getting wet', () => {
    it('rises out in the rain, not indoors or under the eaves', () => {
        const out = player();
        Wetness.tick(out, 0.5, { rain: 0.8, celsius: 15 });
        expect(out.wetness).toBeGreaterThan(20);
        const inside = player();
        Wetness.tick(inside, 0.5, { rain: 0.8, covered: true, indoors: true, celsius: 15 });
        expect(inside.wetness).toBe(0);
        const eaves = player();
        Wetness.tick(eaves, 0.5, { rain: 0.8, covered: true, celsius: 15 });
        expect(eaves.wetness).toBe(0);
        // a swim soaks you at once
        const swim = player();
        Wetness.tick(swim, 0.1, { swimming: true, celsius: 15 });
        expect(swim.wetness).toBe(100);
    });

    it('dries indoors, faster by a fire, slowly out of the rain', () => {
        const a = player(), b = player(), c = player();
        a.wetness = b.wetness = c.wetness = 80;
        Wetness.tick(a, 1, { indoors: true, covered: true, celsius: 12 });
        Wetness.tick(b, 1, { indoors: true, covered: true, nearFire: true, celsius: 12 });
        Wetness.tick(c, 1, { celsius: 12 });
        expect(a.wetness).toBeLessThan(80);
        expect(b.wetness).toBeLessThan(a.wetness);
        expect(c.wetness).toBeGreaterThan(a.wetness);
        expect(c.wetness).toBeLessThan(80);
    });

    it('wet is uncomfortable — more so in the cold — and spoils the clothes; told when soaked', () => {
        const warm = player(), cold = player();
        warm.wetness = cold.wetness = 90;
        warm._wetTold = cold._wetTold = true;
        Wetness.tick(warm, 1, { rain: 1, celsius: 18 });
        Wetness.tick(cold, 1, { rain: 1, celsius: 8 });
        expect(warm.needs.comfort).toBeLessThan(80);
        expect(cold.needs.comfort).toBeLessThan(warm.needs.comfort);
        expect(warm.clothesFreshness).toBeLessThan(100);
        expect(Wetness.coldFactor(cold)).toBeGreaterThan(1.5);
        const p = player();
        const res = Wetness.tick(p, 2, { rain: 1, celsius: 15 });
        expect(Wetness.level(p).label).toBe('Soaked');
        expect(res.notices.length).toBe(1);
    });
});

describe('the street map', () => {
    /** A 4 × 1 strip: an unpaved road, paving, grass, trodden soil. */
    function strip() {
        const sub = { id: 'grass', passable: true };
        return [[
            { q: 0, r: 0, isRoad: true, baseTerrain: 'dirt', subTerrain: sub },
            { q: 1, r: 0, isRoad: true, paving: 'cobble', subTerrain: sub },
            { q: 2, r: 0, baseTerrain: 'grass', subTerrain: sub },
            { q: 3, r: 0, _townSoil: true, baseTerrain: 'dirt', subTerrain: sub },
        ]];
    }
    let keep;
    beforeEach(() => {
        keep = { tiles: InnerMap.tiles, active: InnerMap.active, at: InnerMap.currentWorldTile, inside: InnerMap._insideBuilding, ss: InnerMap._ss, weather: InnerMap.weather, temp: InnerMap.temperature };
        InnerMap.tiles = strip();
        InnerMap._insideBuilding = null;
        InnerMap._ss = null;
        InnerMap._wxCartInHand = false;
        InnerMap.forceStreetWeather(null);
    });
    afterEach(() => {
        InnerMap.tiles = keep.tiles; InnerMap.active = keep.active; InnerMap.currentWorldTile = keep.at;
        InnerMap._insideBuilding = keep.inside; InnerMap._ss = keep.ss; InnerMap.weather = keep.weather; InnerMap.temperature = keep.temp;
        InnerMap._sw = null; InnerMap._swPace = null; InnerMap._swKey = ''; InnerMap._wxCartInHand = false;
    });

    it('mud slows the unpaved road — feet a little, horses more, carts most — and not the paving or grass', () => {
        InnerMap._buildWeatherPace({ mud: 1, rain: 0, storm: false });
        const foot = InnerMap.weatherPace(0, 0, 'foot'), ride = InnerMap.weatherPace(0, 0, 'ride'), cart = InnerMap.weatherPace(0, 0, 'cart');
        expect(foot).toBeLessThan(1);
        expect(ride).toBeLessThan(foot);
        expect(cart).toBeLessThan(ride);
        expect(InnerMap.weatherPace(1, 0, 'cart')).toBe(1);
        expect(InnerMap.weatherPace(2, 0, 'foot')).toBe(1);
        expect(InnerMap.weatherPace(3, 0, 'foot')).toBeLessThan(1);
        // a cart in hand takes the mud as wheels do
        InnerMap._wxCartInHand = true;
        expect(InnerMap.weatherPace(0, 0, 'foot')).toBe(cart);
        InnerMap._wxCartInHand = false;
        // indoors nothing
        InnerMap._insideBuilding = { name: 'Inn' };
        expect(InnerMap.weatherPace(0, 0, 'cart')).toBe(1);
    });

    it('dry ground goes at its pace; townsfolk hurry in the rain', () => {
        InnerMap._buildWeatherPace({ mud: 0, rain: 0, storm: false });
        expect(InnerMap.weatherPace(0, 0, 'cart')).toBe(1);
        InnerMap._buildWeatherPace({ mud: 0, rain: 0.8, storm: false });
        expect(InnerMap.weatherPace(2, 0, 'npc')).toBeGreaterThan(1);
        expect(InnerMap.weatherPace(2, 0, 'foot')).toBe(1);
    });

    it('the season\'s mud of past days on soft ground is not counted twice', () => {
        InnerMap._ss = { mud: 0.8 };
        InnerMap._buildWeatherPace({ mud: 0.5, rain: 0, storm: false });
        expect(InnerMap.weatherPace(3, 0, 'foot')).toBe(1);     // (already slowed by _groundPace)
        expect(InnerMap.weatherPace(0, 0, 'foot')).toBeLessThan(1);
    });

    it('binds the hour\'s weather onto the map, and a forced weather for QA', () => {
        InnerMap.active = true;
        InnerMap.currentWorldTile = { q: 5, r: 5 };
        const w = world({ precip: () => 0.8 });
        const st = InnerMap.bindStreetWeather(w, 14);
        expect(st.type).toBe('rain');
        expect(InnerMap.weather.type).toBe('rain');
        expect(InnerMap.weather.hourly).toBe(true);
        expect(InnerMap.temperature.celsius).toBe(Math.round(st.celsius));
        InnerMap.forceStreetWeather({ type: 'storm' });
        expect(InnerMap.bindStreetWeather(w, 14).storm).toBe(true);
        expect(InnerMap.weather.type).toBe('storm');
        InnerMap.forceStreetWeather(null);
        expect(InnerMap.bindStreetWeather(w, 14).type).toBe('rain');
    });

    it('under the eaves is out of the rain; the open street is not', () => {
        InnerMap.tiles = [
            [{ q: 0, r: 0, customBuildingPart: { id: 'b' }, subTerrain: { passable: false } }, { q: 1, r: 0, subTerrain: { passable: true } }],
            [{ q: 0, r: 1, subTerrain: { passable: true } }, { q: 1, r: 1, subTerrain: { passable: true } }],
        ];
        expect(InnerMap.isCoveredAt(0, 1)).toBe(true);
        expect(InnerMap.isCoveredAt(1, 1)).toBe(false);
    });

    it('townsfolk in a downpour head home', () => {
        InnerMap._sw = { rain: 1, snow: 0, storm: true };
        const went = [];
        const keepHome = InnerMap._goHome, keepBlds = InnerMap._townBuildings;
        InnerMap._goHome = (npc, act) => { went.push(act); return true; };
        InnerMap._townBuildings = () => [];
        try {
            let n = 0;
            for (let i = 0; i < 40; i++) if (InnerMap._weatherPick({ type: 'farmer', q: 0, r: 0, _home: { q: 3, r: 3 } }, 'morning')) n++;
            expect(n).toBeGreaterThan(10);
            expect(went.every(a => a === 'home')).toBe(true);
            // the watch keeps its beat
            expect(InnerMap._weatherPick({ type: 'guard', q: 0, r: 0, _home: { q: 3, r: 3 } }, 'morning')).toBe(false);
            InnerMap._sw = { rain: 0, snow: 0, storm: false };
            expect(InnerMap._weatherPick({ type: 'farmer', q: 0, r: 0, _home: { q: 3, r: 3 } }, 'morning')).toBe(false);
        } finally {
            InnerMap._goHome = keepHome; InnerMap._townBuildings = keepBlds;
        }
    });
});

describe('drawn on the street', () => {
    /** A canvas context that takes any call and counts them. */
    function recorder() {
        const calls = {};
        const base = { canvas: { width: 800, height: 600 }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false };
        const ctx = new Proxy(base, {
            get(t, k) {
                if (k in t) return t[k];
                return (...args) => { calls[k] = (calls[k] || 0) + 1; return args.length ? undefined : undefined; };
            },
            set(t, k, v) { t[k] = v; return true; },
        });
        return { ctx, calls };
    }
    const camera = { zoom: 2, x: 200, y: 100, worldToScreenFast(x, y) { return { x: x * 2 - 200, y: y * 2 - 100 }; } };
    const canvas = { width: 800, height: 600 };

    function lay() {
        const tiles = [];
        for (let r = 0; r < 12; r++) {
            const row = [];
            for (let q = 0; q < 20; q++) {
                const water = q >= 16;
                row.push({
                    q, r, explored: true, visible: true, moisture: 0.7,
                    isRoad: r === 5, _townSoil: r === 6, baseTerrain: water ? 'water' : r === 6 ? 'dirt' : 'grass',
                    _wet: water, subTerrain: { id: water ? 'lake_water' : 'grass', passable: !water },
                });
            }
            tiles.push(row);
        }
        InnerMap.tiles = tiles;
    }

    it('rain, puddles, mud, splashes, lightning, snow, mist, a rainbow and fireflies draw without a hitch', async () => {
        const { InnerMapRenderer } = await import('../ui/innerMapRenderer.js');
        await import('../ui/innerMapLayers.js');
        const keepTiles = InnerMap.tiles, keepInside = InnerMap._insideBuilding;
        lay();
        InnerMap._insideBuilding = null;
        InnerMapRenderer._frameRange = { qMin: 0, qMax: 19, rMin: 0, rMax: 11 };
        InnerMapRenderer._wxCache = null;
        const wind = { x: 0.6, y: 0.1, strength: 0.8 };
        const base = { hour: 14, celsius: 14, cloud: 1, sun: 0, wind, damp: 1, mud: 0.9, puddles: 0.9, rainbow: 0, fireflies: 0, fog: 0, snow: 0, rain: 1, storm: true, type: 'storm' };
        try {
            // a storm: the ground pass with puddles, mud and splashes over a few frames, then the air
            InnerMap._sw = base;
            const a = recorder();
            for (let i = 0; i < 10; i++) {
                InnerMapRenderer._ambientT = 100 + i * 0.05;
                InnerMapRenderer._renderWeatherGround(a.ctx, camera);
            }
            InnerMapRenderer._wxStrike(true);
            InnerMapRenderer._ambientT += 0.02;
            expect(InnerMapRenderer._renderWeatherFx(a.ctx, canvas, camera, 0.016)).toBe(true);
            expect(a.calls.fillRect).toBeGreaterThan(20);
            expect(a.calls.lineTo).toBeGreaterThan(100);
            expect(a.calls.stroke).toBeGreaterThan(1);
            // snow, a blizzard
            InnerMap._sw = { ...base, type: 'blizzard', rain: 0, snow: 1, celsius: -5, puddles: 0.5 };
            const b = recorder();
            InnerMapRenderer._renderWeatherGround(b.ctx, camera);
            InnerMapRenderer._renderWeatherFx(b.ctx, canvas, camera, 0.016);
            expect(b.calls.fillRect).toBeGreaterThan(100);
            // a clear dawn's mist; a rainbow; a summer night's fireflies; a wet player dripping
            InnerMap._sw = { ...base, type: 'clear', rain: 0, storm: false, fog: 0.8, rainbow: 1, fireflies: 1, sun: 1, cloud: 0 };
            InnerMapRenderer._wxPlayerWet = 90;
            const c = recorder();
            InnerMapRenderer._renderWeatherLow(c.ctx, camera);
            InnerMapRenderer._renderWeatherFx(c.ctx, canvas, camera, 0.016);
            expect(c.calls.fillRect).toBeGreaterThan(0);
            // indoors none of it
            InnerMap._insideBuilding = { name: 'Inn' };
            expect(InnerMapRenderer._renderWeatherFx(recorder().ctx, canvas, camera, 0.016)).toBe(false);
        } finally {
            InnerMap.tiles = keepTiles; InnerMap._insideBuilding = keepInside; InnerMap._sw = null;
            InnerMapRenderer._wxPlayerWet = 0; InnerMapRenderer._wxCache = null;
        }
    });
});
