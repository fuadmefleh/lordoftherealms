// ============================================
// WEATHER — Weather system and simulation
// ============================================

import { Utils } from '../core/utils.js';

export class WeatherSystem {
    constructor(world) {
        this.world = world;
        this.offset = 0; // Moves the weather map
        this.speed = 0.5; // Speed of weather movement
        this.globalState = 'clear'; // clear, sunny, overcast

        // Weather noise offsets
        this.noiseOffsetX = Math.random() * 1000;
        this.noiseOffsetY = Math.random() * 1000;
    }

    /**
     * Update weather simulation
     * @param {number} deltaTime - Time in seconds
     */
    update(deltaTime) {
        // Move weather patterns from West to East usually
        this.offset += this.speed * deltaTime;
    }

    /**
     * Get weather at a specific location
     * @param {number} q - Axial q
     * @param {number} r - Axial r
     * @returns {{type: string, intensity: number}}
     */
    getWeather(q, r) {
        // Use time offset to animate noise
        const timeScale = 0.05;
        const scale = 0.1;

        // Wrap q for seamless weather on wrapping map
        // Map q to angle
        const angle = (q / this.world.width) * Math.PI * 2;
        const nx = Math.cos(angle) + this.offset * timeScale; // Move along cylinder
        const ny = Math.sin(angle);
        const nz = r * scale;

        // 3D noise would be ideal, but we can fake it with 2D noise + time offset
        // Using existing 2D noise utils

        // Rain/Precipitation noise
        // We add offset to x for movement
        const rainNoise = Utils.fbm(
            q * scale + this.offset * timeScale,
            r * scale,
            3,
            2.0,
            0.5
        );

        const normalizedRain = (rainNoise + 1) / 2; // 0..1

        // Temperature influence
        const tile = this.world.getTile(q, r);
        if (!tile) return { type: 'none', intensity: 0 };

        const temp = tile.temperature;

        // Determine weather type
        if (normalizedRain > 0.65) {
            // High precipitation
            if (temp < 0.3) {
                return { type: 'snow', intensity: (normalizedRain - 0.65) * 3 };
            } else if (temp > 0.8) {
                // In deserts, rain is rare, maybe sandstorm?
                // Or just very rare rain
                if (normalizedRain > 0.85) return { type: 'storm', intensity: 1.0 };
                return { type: 'clear', intensity: 0 };
            } else {
                if (normalizedRain > 0.8) return { type: 'storm', intensity: 1.0 };
                return { type: 'rain', intensity: (normalizedRain - 0.65) * 3 };
            }
        } else if (normalizedRain > 0.4) {
            // Cloudy
            return { type: 'cloudy', intensity: (normalizedRain - 0.4) * 2 };
        }

        return { type: 'clear', intensity: 0 };
    }

    /**
     * Get dynamic temperature at a location
     * @param {number} q - Axial q
     * @param {number} r - Axial r
     */
    getTemperature(q, r) {
        const tile = this.world.getTile(q, r);
        if (!tile) return 0;

        // Base temperature from biome/terrain generation (0.0 - 1.0)
        let temp = tile.temperature;

        // Seasonal influence
        // Spring: 0, Summer: +0.2, Autumn: 0, Winter: -0.2
        let seasonalOffset = 0;
        const season = this.world.season; // 'Spring', 'Summer', 'Autumn', 'Winter'

        switch (season) {
            case 'Summer': seasonalOffset = 0.15; break;
            case 'Winter': seasonalOffset = -0.15; break;
            case 'Autumn': seasonalOffset = -0.05; break;
            case 'Spring': seasonalOffset = 0.05; break;
        }

        // Daily fluctuation (Day/Night) - simplistic sine wave based on time of day if available?
        // For now, let's just use a random small fluctuation or noise
        // meaningful time of day not fully implemented yet, assume "Day"

        // Adjust for elevation (already in base temp, but maybe refine)
        // temp -= tile.elevation * 0.1; 

        // Final calculation
        let finalTemp = temp + seasonalOffset;

        // Clamp 0-1
        finalTemp = Math.max(0, Math.min(1, finalTemp));

        // Convert to logic degrees (e.g. -20C to 40C)
        // Map 0 -> -30C, 1 -> 50C
        const degreesC = Math.round((finalTemp * 80) - 30);

        return {
            value: finalTemp,
            celsius: degreesC,
            fahrenheit: Math.round(degreesC * 1.8 + 32)
        };
    }
}
