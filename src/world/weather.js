// ============================================
// WEATHER — Weather system and simulation
// ============================================
//
// Weather is a pure function of (hex, day, seed): fronts drift east across
// the map and evolve day by day, and the season shifts where snow falls and
// where heat waves bake the land. It draws no randomness after construction,
// so reading it never disturbs the game's RNG stream.
//
// Each weather type carries gameplay effects (WEATHER_EFFECTS), read by:
//   travelSpeed      → player stamina each morning (endDay → applyPlayerDailyEffects)
//   farmProduction   → player farms (playerEconomy/property)
//   archerPower / cavalryPower → battles (PlayerMilitary.combat)
//   exposure         → health lost camping in the open (applyPlayerDailyEffects)
//   seaDanger        → ships at sea: hull damage and storm delays (Ships.processDaily)

import { Utils } from '../core/utils.js';

export const WEATHER_TYPES = {
    clear:    { name: 'Clear',     icon: '☀️' },
    cloudy:   { name: 'Cloudy',    icon: '☁️' },
    rain:     { name: 'Rain',      icon: '🌧️' },
    storm:    { name: 'Storm',     icon: '⛈️' },
    snow:     { name: 'Snow',      icon: '🌨️' },
    blizzard: { name: 'Blizzard',  icon: '❄️' },
    heatwave: { name: 'Heat Wave', icon: '🔥' },
};

export const WEATHER_EFFECTS = {
    clear:    {},
    cloudy:   {},
    rain:     { travelSpeed: -0.1, farmProduction: 0.1, archerPower: -0.15 },
    storm:    { travelSpeed: -0.3, farmProduction: -0.1, archerPower: -0.3, cavalryPower: -0.1, exposure: 2, seaDanger: 1 },
    snow:     { travelSpeed: -0.25, farmProduction: -0.3, cavalryPower: -0.2, exposure: 2 },
    blizzard: { travelSpeed: -0.5, farmProduction: -0.5, archerPower: -0.2, cavalryPower: -0.35, exposure: 5, seaDanger: 0.5 },
    heatwave: { travelSpeed: -0.15, farmProduction: -0.25, exposure: 1 },
};

const EFFECT_LABELS = {
    travelSpeed: 'Travel',
    farmProduction: 'Farms',
    archerPower: 'Archers',
    cavalryPower: 'Cavalry',
};

const WATER_TERRAINS = ['ocean', 'deep_ocean', 'sea', 'coast', 'lake'];

// Integer hash → 0..1, used for lattice value noise.
function hash01(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function smooth(t) {
    return t * t * (3 - 2 * t);
}

export class WeatherSystem {
    constructor(world) {
        this.world = world;
        this.offset = 0; // Visual-only clock, advanced by update()
        this.speed = 0.5;
        this.globalState = 'clear';

        // Drawn once from the seeded RNG; also seed the weather fields
        this.noiseOffsetX = Utils.random() * 1000;
        this.noiseOffsetY = Utils.random() * 1000;
        this.seed = Math.floor(this.noiseOffsetX * 1000) | 0;
    }

    /**
     * Visual clock only — gameplay weather changes once a day.
     * @param {number} deltaTime - Time in seconds
     */
    update(deltaTime) {
        this.offset += this.speed * deltaTime;
    }

    /** Value noise that wraps every `periodX` lattice cells along x. */
    _valueNoise(x, y, periodX) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const tx = smooth(x - x0);
        const ty = smooth(y - y0);
        const wrap = (ix) => ((ix % periodX) + periodX) % periodX;
        const a = hash01(wrap(x0), y0, this.seed);
        const b = hash01(wrap(x0 + 1), y0, this.seed);
        const c = hash01(wrap(x0), y0 + 1, this.seed);
        const d = hash01(wrap(x0 + 1), y0 + 1, this.seed);
        return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }

    /** Precipitation 0..1 at a hex on a given day: two drifting, evolving fronts. */
    precipitation(q, r, day = this.world.day || 1) {
        const width = this.world.width || 80;
        const cell = 7; // hexes per lattice cell
        const period = Math.max(1, Math.round(width / cell));
        const x = (q / width) * period;
        const y = r / cell;
        // Fronts drift east; the second moves at another speed so patterns evolve
        const a = this._valueNoise(x - day * 0.45, y, period);
        const b = this._valueNoise(x * 2 - day * 0.8 + 0.5 * period, y * 2 + 31, period * 2);
        const v = a * 0.65 + b * 0.35;
        // Stretch the averaged noise back toward the full 0..1 range
        return Math.max(0, Math.min(1, (v - 0.5) * 1.45 + 0.5));
    }

    /**
     * Get weather at a specific location (today, unless a day is given)
     * @returns {{type: string, intensity: number}}
     */
    getWeather(q, r, day) {
        const tile = this.world.getTile(q, r);
        if (!tile) return { type: 'none', intensity: 0 };

        const rain = this.precipitation(q, r, day);
        const temp = this._seasonalTemp(tile, day);
        const baseTemp = typeof tile.temperature === 'number' ? tile.temperature : 0.5;
        const isWater = !!(tile.terrain && WATER_TERRAINS.includes(tile.terrain.id));

        if (rain > 0.68) {
            if (temp < 0.3) {
                if (rain > 0.85) return { type: 'blizzard', intensity: 1 };
                return { type: 'snow', intensity: Math.min(1, (rain - 0.68) * 4) };
            }
            if (baseTemp > 0.8 && !isWater) {
                // Deserts: rain is rare, but violent when it comes
                return rain > 0.92 ? { type: 'storm', intensity: 1 } : { type: 'clear', intensity: 0 };
            }
            if (rain > 0.9) return { type: 'storm', intensity: 1 };
            return { type: 'rain', intensity: Math.min(1, (rain - 0.68) * 4) };
        }
        if (rain > 0.45) return { type: 'cloudy', intensity: (rain - 0.45) * 4 };
        if (!isWater && temp > 0.82 && rain < 0.3) {
            return { type: 'heatwave', intensity: Math.min(1, (temp - 0.82) * 6) };
        }
        return { type: 'clear', intensity: 0 };
    }

    /** Gameplay effects of the weather at a hex today. */
    getEffects(q, r, day) {
        const w = this.getWeather(q, r, day);
        return WEATHER_EFFECTS[w.type] || {};
    }

    /** Short "Travel −25% · Farms −30%" summary for tooltips and messages. */
    describeEffects(type) {
        const fx = WEATHER_EFFECTS[type] || {};
        const parts = [];
        for (const key in EFFECT_LABELS) {
            const v = fx[key];
            if (!v) continue;
            parts.push(`${EFFECT_LABELS[key]} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`);
        }
        if (fx.exposure) parts.push('Exposure outdoors');
        if (fx.seaDanger) parts.push('Dangerous seas');
        return parts.join(' · ');
    }

    /** Forecast for the next `days` days at a hex (index 0 = tomorrow). */
    getForecast(q, r, days = 3) {
        const today = this.world.day || 1;
        const out = [];
        for (let i = 1; i <= days; i++) out.push(this.getWeather(q, r, today + i).type);
        return out;
    }

    _seasonOf(day) {
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        return seasons[Math.floor(((day - 1) % 120) / 30)];
    }

    _seasonalTemp(tile, day) {
        const base = typeof tile.temperature === 'number' ? tile.temperature : 0.5;
        const season = day === undefined ? this.world.season : this._seasonOf(day);
        let seasonalOffset = 0;
        switch (season) {
            case 'Summer': seasonalOffset = 0.15; break;
            case 'Winter': seasonalOffset = -0.15; break;
            case 'Autumn': seasonalOffset = -0.05; break;
            case 'Spring': seasonalOffset = 0.05; break;
        }
        return Math.max(0, Math.min(1, base + seasonalOffset));
    }

    /**
     * Get dynamic temperature at a location
     * @param {number} q - Axial q
     * @param {number} r - Axial r
     */
    getTemperature(q, r) {
        const tile = this.world.getTile(q, r);
        if (!tile) return 0;

        const finalTemp = this._seasonalTemp(tile);

        // Convert to logic degrees: 0 -> -30C, 1 -> 50C
        const degreesC = Math.round((finalTemp * 80) - 30);

        return {
            value: finalTemp,
            celsius: degreesC,
            fahrenheit: Math.round(degreesC * 1.8 + 32)
        };
    }

    serialize() {
        return { seed: this.seed };
    }

    deserialize(data) {
        if (data && typeof data.seed === 'number') this.seed = data.seed;
    }
}
