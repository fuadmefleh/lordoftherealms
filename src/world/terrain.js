// ============================================
// TERRAIN — Terrain types and generation
// ============================================

import { Utils } from '../core/utils.js';
import { Hex, MinHeap } from '../core/hex.js';

export const Terrain = {
    // Terrain type definitions
    TYPES: {
        DEEP_OCEAN: { id: 'deep_ocean', name: 'Deep Ocean', color: '#002b59', moveCost: Infinity, passable: false, icon: '🌊' },
        OCEAN: { id: 'ocean', name: 'Ocean', color: '#005b96', moveCost: Infinity, passable: false, icon: '🌊' },
        COAST: { id: 'coast', name: 'Coastal Waters', color: '#6497b1', moveCost: Infinity, passable: false, icon: '🏖️' },
        BEACH: { id: 'beach', name: 'Beach', color: '#e8d5a3', moveCost: 2, passable: true, icon: '🏖️' },

        // Water Bodies
        LAKE: { id: 'lake', name: 'Lake', color: '#5dade2', moveCost: Infinity, passable: false, icon: '💧' },
        SEA: { id: 'sea', name: 'Sea', color: '#0077be', moveCost: Infinity, passable: false, icon: '🌊' },

        // C# Inspired Biomes
        ICE: { id: 'ice', name: 'Ice Sheet', color: '#e5f9ff', moveCost: 3, passable: true, icon: '❄️' },
        SNOW: { id: 'snow', name: 'Snow', color: '#ffffff', moveCost: 3, passable: true, icon: '❄️' },
        TUNDRA: { id: 'tundra', name: 'Tundra', color: '#bce4ce', moveCost: 2, passable: true, icon: '🥶' },
        GRASSLAND: { id: 'grassland', name: 'Grassland', color: '#88aa55', moveCost: 2, passable: true, icon: '🌿' },
        WOODLAND: { id: 'woodland', name: 'Woodland', color: '#668844', moveCost: 2, passable: true, icon: '🌳' },
        BOREAL_FOREST: { id: 'boreal_forest', name: 'Boreal Forest', color: '#446633', moveCost: 3, passable: true, icon: '🌲' },
        SEASONAL_FOREST: { id: 'seasonal_forest', name: 'Seasonal Forest', color: '#557733', moveCost: 3, passable: true, icon: '🍂' },
        TEMPERATE_RAINFOREST: { id: 'temperate_rainforest', name: 'Temperate Rainforest', color: '#335522', moveCost: 3, passable: true, icon: '🌧️' },
        TROPICAL_RAINFOREST: { id: 'tropical_rainforest', name: 'Tropical Rainforest', color: '#224411', moveCost: 4, passable: true, icon: '🌴' },
        SAVANNA: { id: 'savanna', name: 'Savanna', color: '#ddbb66', moveCost: 2, passable: true, icon: '🦁' },
        DESERT: { id: 'desert', name: 'Desert', color: '#d4a843', moveCost: 3, passable: true, icon: '🏜️' },

        PLAINS: { id: 'plains', name: 'Plains', color: '#7daa4e', moveCost: 2, passable: true, icon: '🌾' },
        HILLS: { id: 'hills', name: 'Hills', color: '#8a7a5a', moveCost: 3, passable: true, icon: '⛰️' },
        MOUNTAIN: { id: 'mountain', name: 'Mountain', color: '#808080', moveCost: 5, passable: true, icon: '🏔️' },
        SNOW_PEAK: { id: 'snow_peak', name: 'Snow Peak', color: '#f0f0f0', moveCost: Infinity, passable: false, icon: '🗻' },
        SWAMP: { id: 'swamp', name: 'Swamp', color: '#4a6a3a', moveCost: 4, passable: true, icon: '🐸' },
        ISLAND: { id: 'island', name: 'Island', color: '#e8d5a3', moveCost: 3, passable: true, icon: '🏝️' },
        HIGHLANDS: { id: 'highlands', name: 'Highlands', color: '#6d7a5b', moveCost: 4, passable: true, icon: '⛰️' },
    },

    // Resources that can appear on tiles
    RESOURCES: {
        IRON: { id: 'iron', name: 'Iron Deposits', icon: '⛏️', color: '#8a7a7a' },
        GOLD_ORE: { id: 'gold_ore', name: 'Gold Veins', icon: '✨', color: '#ffd700' },
        GEMS: { id: 'gems', name: 'Gemstones', icon: '💎', color: '#4ae0e0' },
        TIMBER: { id: 'timber', name: 'Rich Timber', icon: '🌲', color: '#8b5a2b' },
        WHEAT: { id: 'wheat', name: 'Fertile Soil', icon: '🌾', color: '#daa520' },
        FISH: { id: 'fish', name: 'Fishing Grounds', icon: '🐟', color: '#4682b4' },
        HORSES: { id: 'horses', name: 'Wild Horses', icon: '🐴', color: '#8b4513' },
        SPICES: { id: 'spices', name: 'Spice Plants', icon: '🌶️', color: '#ff4500' },
        STONE: { id: 'stone', name: 'Quarry Stone', icon: '⛰️', color: '#808080' },
        SALT: { id: 'salt', name: 'Salt Flats', icon: '🧂', color: '#f0f0f0' },
        COAL: { id: 'coal', name: 'Coal', icon: '⚫', color: '#333333' },
        OIL: { id: 'oil', name: 'Oil', icon: '🛢️', color: '#111111' },
        CATTLE: { id: 'cattle', name: 'Cattle', icon: '🐄', color: '#a0522d' },
    },

    RESOURCE_CHANCES: {
        mountain: [{ resource: 'iron', chance: 0.15 }, { resource: 'gold_ore', chance: 0.05 }, { resource: 'coal', chance: 0.15 }, { resource: 'gems', chance: 0.02 }],
        hills: [{ resource: 'iron', chance: 0.1 }, { resource: 'coal', chance: 0.1 }, { resource: 'stone', chance: 0.15 }],
        forest: [{ resource: 'timber', chance: 0.3 }],
        boreal_forest: [{ resource: 'timber', chance: 0.35 }],
        seasonal_forest: [{ resource: 'timber', chance: 0.25 }],
        tropical_rainforest: [{ resource: 'timber', chance: 0.4 }, { resource: 'gems', chance: 0.05 }, { resource: 'spices', chance: 0.1 }],
        temperate_rainforest: [{ resource: 'timber', chance: 0.35 }],
        woodland: [{ resource: 'timber', chance: 0.15 }],
        plains: [{ resource: 'wheat', chance: 0.2 }, { resource: 'cattle', chance: 0.1 }, { resource: 'horses', chance: 0.08 }],
        grassland: [{ resource: 'wheat', chance: 0.15 }, { resource: 'cattle', chance: 0.15 }, { resource: 'horses', chance: 0.06 }],
        coast: [{ resource: 'fish', chance: 0.25 }],
        lake: [{ resource: 'fish', chance: 0.15 }],
        sea: [{ resource: 'fish', chance: 0.2 }],
        ocean: [{ resource: 'fish', chance: 0.05 }],
        desert: [{ resource: 'oil', chance: 0.05 }, { resource: 'salt', chance: 0.15 }],
        savanna: [{ resource: 'cattle', chance: 0.2 }, { resource: 'spices', chance: 0.1 }],
        island: [{ resource: 'timber', chance: 0.2 }, { resource: 'spices', chance: 0.1 }, { resource: 'gems', chance: 0.05 }, { resource: 'fish', chance: 0.2 }],
        highlands: [{ resource: 'stone', chance: 0.15 }, { resource: 'iron', chance: 0.05 }, { resource: 'timber', chance: 0.1 }]
    },

    // Biome Table mapping [Heat][Moisture]
    // Heat: Coldest (0), Colder (1), Cold (2), Warm (3), Warmer (4), Warmest (5)
    // Moisture: Dryest (0), Dryer (1), Dry (2), Wet (3), Wetter (4), Wettest (5)
    BIOME_TABLE: [
        // Coldest
        ['ICE', 'ICE', 'SNOW', 'SNOW', 'SNOW', 'SNOW'],
        // Colder
        ['TUNDRA', 'TUNDRA', 'SNOW', 'SNOW', 'SNOW', 'SNOW'],
        // Cold
        ['TUNDRA', 'TUNDRA', 'WOODLAND', 'WOODLAND', 'BOREAL_FOREST', 'BOREAL_FOREST'],
        // Warm
        ['PLAINS', 'PLAINS', 'BOREAL_FOREST', 'WOODLAND', 'TEMPERATE_RAINFOREST', 'TEMPERATE_RAINFOREST'],
        // Warmer
        ['PLAINS', 'PLAINS', 'SEASONAL_FOREST', 'SEASONAL_FOREST', 'TROPICAL_RAINFOREST', 'TROPICAL_RAINFOREST'],
        // Warmest
        ['DESERT', 'SAVANNA', 'SAVANNA', 'TROPICAL_RAINFOREST', 'TROPICAL_RAINFOREST', 'TROPICAL_RAINFOREST']
    ],

    generateMap(width, height, params = {}) {
        // (worlds made before the hex-distance fix keep the old metric: world/world/generation.js)
        if (!((Number(params.terrainGen) || 1) >= 3) && Hex._legacy === 0) {
            return Hex.withLegacyMetric(() => Terrain.generateMap(width, height, params));
        }
        const tiles = [];

        // Seeded RNG support
        let rng;
        if (params.seed) {
            const seedVal = typeof params.seed === 'string' ? Math.abs(Utils.hashStr(params.seed)) : params.seed;
            rng = Utils.seededRandom(seedVal);
        } else {
            rng = () => Utils.random(); // seedable (Math.random unless a seed is set)
        }

        // Noise Parameters
        const terrainOctaves = params.terrainOctaves || 6;
        const terrainFreq = params.terrainFreq || 1.1;
        const heatOctaves = params.heatOctaves || 4;
        const heatFreq = params.heatFreq || 3.0;
        const moistOctaves = params.moistOctaves || 4;
        const moistFreq = params.moistFreq || 2.0;

        // Water Levels
        const deepWaterLevel = params.deepWaterLevel || 0.2;
        const shallowWaterLevel = params.shallowWaterLevel || 0.4;
        const waterThreshold = params.waterThreshold || 0.42;
        const dirtLevel = params.dirtLevel || 0.5;
        const hillsLevel = params.hillsLevel || 0.52;
        const highlandsLevel = params.highlandsLevel || 0.60;
        const mountainLevel = params.mountainLevel || 0.70;
        const snowPeakLevel = params.snowPeakLevel || 0.88;
        const riverCount = params.riverCount !== undefined ? params.riverCount : 40;
        const continentCount = params.continentCount || 3;
        // Generator revision: worlds made since 2 sprinkle their peaks on
        // land and run rivers off the world's own levels. Saved worlds
        // without it regenerate exactly as they were made.
        const terrainGen = params.terrainGen || 1;

        // New parameters
        const continentSize = params.continentSize || 'medium';
        const islandFreq = params.islandFreq !== undefined ? params.islandFreq : 1.0;
        const landMass = params.landMass !== undefined ? params.landMass : 45; // percentage 15-85
        const mountainDensity = params.mountainDensity !== undefined ? params.mountainDensity / 100 : 1.0;
        const hillDensity = params.hillDensity !== undefined ? params.hillDensity / 100 : 1.0;
        const flatness = params.flatness || 'normal';
        const temperature = params.temperature || 'normal';
        const rainfall = params.rainfall || 'normal';
        const polarIce = params.polarIce || 'normal';
        const desertFreq = params.desertFreq || 'normal';
        const forestDensity = params.forestDensity !== undefined ? params.forestDensity / 100 : 1.0;
        const coastalDetail = params.coastalDetail !== undefined ? params.coastalDetail : 5;
        const lakeFreq = params.lakeFreq || 'normal';
        const resourceDensity = params.resourceDensity || 'normal';
        const strategicRes = params.strategicRes || 'normal';

        // Compute derived factors from high-level params
        const continentSizeFactors = {
            small: 0.5,
            medium: 1.0,
            large: 1.5,
            pangaea: 2.5
        };
        const sizeFactor = continentSizeFactors[continentSize] || 1.0;

        // Land mass adjustment for continent weight
        const landBias = (landMass - 45) / 100; // -0.30 to +0.40

        // Temperature bias: shift heat
        const tempBiasMap = { frozen: -0.35, cold: -0.2, cool: -0.1, normal: 0, warm: 0.1, hot: 0.2, scorching: 0.35 };
        const tempBias = tempBiasMap[temperature] || 0;

        // Rainfall bias: shift moisture
        const rainBiasMap = { arid: -0.25, dry: -0.12, normal: 0, wet: 0.12, tropical: 0.25 };
        const rainBias = rainBiasMap[rainfall] || 0;

        // Polar ice factor
        const polarIceMap = { none: 0, minimal: 0.05, normal: 0.2, extensive: 0.4, iceAge: 0.65 };
        const polarFactor = polarIceMap[polarIce] !== undefined ? polarIceMap[polarIce] : 0.2;

        // Flatness: power curve for elevation
        const flatnessMap = { rugged: 0.8, normal: 1.1, flat: 1.4, veryFlat: 1.8 };
        const flatnessPow = flatnessMap[flatness] || 1.1;

        // Desert frequency factor
        const desertFactorMap = { none: 0, few: 0.5, normal: 1.0, many: 1.8, wasteland: 3.0 };
        // (since terrainGen 14 'none' means none: it used to fall through to normal)
        const desertFactor = terrainGen >= 14 ? (desertFactorMap[desertFreq] ?? 1.0) : (desertFactorMap[desertFreq] || 1.0);

        // Generate continent seed points using a jittered grid for better distribution
        const seeds = [];

        if (continentSize === 'pangaea') {
            // Pangaea: one massive central continent with small satellite seeds
            seeds.push({
                q: width * 0.5 + (rng() - 0.5) * width * 0.1,
                r: height * 0.5 + (rng() - 0.5) * height * 0.1,
                radius: (width / 2) * 0.9
            });
            // Add a few small satellite seeds for natural coastline variation
            for (let i = 0; i < Math.min(continentCount - 1, 4); i++) {
                const angle = (i / 4) * Math.PI * 2 + rng() * 0.5;
                const dist = width * 0.25 + rng() * width * 0.15;
                seeds.push({
                    q: width * 0.5 + Math.cos(angle) * dist,
                    r: Utils.clamp(height * 0.5 + Math.sin(angle) * dist * 0.6, height * 0.15, height * 0.85),
                    radius: (width / 6) * (0.6 + rng() * 0.4)
                });
            }
        } else {
            const cols = Math.ceil(Math.sqrt(continentCount * (width / height)));
            const rows = Math.ceil(continentCount / cols);

            for (let i = 0; i < continentCount; i++) {
                const gridCol = i % cols;
                const gridRow = Math.floor(i / cols);

                // Jittered grid placement
                const targetQ = (gridCol + 0.5 + (rng() - 0.5) * 0.6) * (width / cols);
                const targetR = (gridRow + 0.5 + (rng() - 0.5) * 0.6) * (height / rows);

                // Clamp R to keep somewhat away from extreme poles for better playability
                const finalR = Utils.clamp(targetR, height * 0.15, height * 0.85);

                seeds.push({
                    q: targetQ,
                    r: finalR,
                    // Scale radius by sizeFactor; reduce as count increases to keep them distinct
                    radius: (width / (cols * 1.8)) * (0.8 + rng() * 0.4) * sizeFactor
                });
            }
        }

        // Worlds since terrainGen 11: continents sized to the land asked for (landMass is the
        // share of the map that is land, as the setting says), with warped, ragged coasts, on
        // noise that wraps round the world's seam without mirroring (Terrain._land11)
        const land11 = terrainGen >= 11
            ? Terrain._land11({ width, height, rng, seeds, landMass, continentCount, continentSize, terrainOctaves, mountainDensity, polarFactor, plates: terrainGen >= 12, sharpRanges: terrainGen >= 13, relief: terrainGen >= 14, islandFreq, coastalDetail })
            : null;

        for (let r = 0; r < height; r++) {
            const row = [];
            for (let q = 0; q < width; q++) {
                // Coordinates
                // Simple wrapping noise
                const angle = (q / width) * Math.PI * 2;
                const nx = Math.cos(angle) * 1.0;
                const ny = Math.sin(angle) * 1.0;
                const ny_r = (r / height) * 2.0; // Y component

                // Coastal detail offset for more interesting coastlines
                const detailScale = coastalDetail / 5.0;

                // Height Noise (Base)
                let baseElev = Utils.fbm(nx * terrainFreq + 10, ny_r * terrainFreq + 10, terrainOctaves, 2.0, 0.5);
                baseElev = (baseElev + 1) / 2; // Normalize 0-1

                // Add coastal detail noise for more fractal coastlines
                if (detailScale !== 1.0) {
                    const detailNoise = Utils.fbm(nx * terrainFreq * 3.0 * detailScale + 77, ny_r * terrainFreq * 3.0 * detailScale + 77, 3, 2.0, 0.5);
                    baseElev += detailNoise * 0.05 * detailScale;
                }

                // Ridged Noise (for sharper peaks)
                let ridged = 1.0 - Math.abs(Utils.fbm(nx * terrainFreq * 2 + 50, ny_r * terrainFreq * 2 + 50, 4, 2.0, 0.5));
                ridged = Math.pow(ridged, 2.5);
                // Scale ridged noise by mountain density
                ridged *= mountainDensity;

                // Create Continents Bias
                const continentNoise = Utils.fbm(nx * 1.2, ny_r * 1.2, 2, 2.0, 0.5);

                // Calculate bias from overlapping seeds
                let maxBias = 0;
                for (const seed of seeds) {
                    const dist = Hex.wrappingDistance(q, r, seed.q, seed.r, width);
                    const bias = 1.0 - Utils.clamp(dist / seed.radius, 0, 1);
                    if (bias > maxBias) maxBias = bias;
                }

                // Sharpen the seed bias for more distinct continent edges
                let seedBias = Math.pow(maxBias, 0.8);

                let continentWeight = (continentNoise * 0.3) + (seedBias * 0.7);
                continentWeight = Utils.clamp(continentWeight, 0, 1);

                // Increase base land presence + apply land mass bias
                let elevation = (baseElev * 0.25) + (continentWeight * 0.65) + (ridged * 0.1) + landBias;

                // Polar bias: encourage water at poles using the configurable polar factor
                const polarDist = Math.abs((r / height) - 0.5) * 2; // 0 at equator, 1 at poles
                elevation -= Math.pow(polarDist, 4) * polarFactor;

                // Simple longitudinal "Sea Lane" bias to ensure at least one vertical gap
                const seaLane = Math.cos(angle + 1.0) * 0.5 + 0.5;
                elevation -= Math.pow(seaLane, 6) * 0.1;

                // Power curve for flatness control
                elevation = Utils.clamp(elevation, -0.2, 1.2);
                elevation = (elevation < 0) ? elevation : Math.pow(elevation, flatnessPow);
                elevation = Utils.clamp(elevation, 0, 1);

                // (since terrainGen 11 the height is the land field's, set to sea level below)
                let relief;
                if (land11 && terrainGen >= 14) [elevation, relief] = land11.sample(q, r);
                else if (land11) elevation = land11.height(q, r);

                // Apply hill density: compress hills region
                if (!land11 && elevation > waterThreshold && elevation < mountainLevel) {
                    const landRange = mountainLevel - waterThreshold;
                    const normalizedLand = (elevation - waterThreshold) / landRange;
                    // Compress or expand the hilly part of the elevation
                    const adjusted = Math.pow(normalizedLand, 1.0 / hillDensity);
                    elevation = waterThreshold + adjusted * landRange;
                }

                // Heat Noise
                let heat = Utils.fbm(nx + 20, ny_r + 20, heatOctaves, 2.0, 0.5);
                heat = (heat + 1) / 2;

                // Gradient for Latitude Heat
                const lat = 1 - Math.abs((r / height) - 0.5) * 2; // 0 at poles, 1 at equator
                heat = (heat * 0.3) + (lat * 0.7);
                // Apply temperature bias
                heat = Utils.clamp(heat + tempBias, 0, 1);

                // Apply desert frequency: shift dry+hot biomes
                if (desertFactor !== 1.0 && heat > 0.6) {
                    // Make hot areas drier or wetter depending on desert factor
                    heat = Utils.clamp(heat + (desertFactor - 1.0) * 0.08, 0, 1);
                }

                // Moisture Noise
                let moisture = Utils.fbm(nx + 30, ny_r + 30, moistOctaves, 2.0, 0.5);
                moisture = (moisture + 1) / 2;
                // Apply rainfall bias
                moisture = Utils.clamp(moisture + rainBias, 0, 1);

                // Apply desert factor to moisture (reduce moisture in hot areas)
                if (desertFactor > 1.0 && heat > 0.55) {
                    moisture = Utils.clamp(moisture - (desertFactor - 1.0) * 0.12 * heat, 0, 1);
                } else if (desertFactor < 1.0 && heat > 0.55) {
                    moisture = Utils.clamp(moisture + (1.0 - desertFactor) * 0.1, 0, 1);
                }

                // Adjust forest density via moisture in land areas
                if (forestDensity !== 1.0 && elevation >= waterThreshold) {
                    // Bias moisture to increase/decrease forest coverage
                    moisture = Utils.clamp(moisture * (0.5 + forestDensity * 0.5), 0, 1);
                }

                // Adjust Moisture by Height (C# logic)
                if (elevation < deepWaterLevel) moisture += 0.8 * elevation;
                else if (elevation < shallowWaterLevel) moisture += 0.3 * elevation;

                // Clamp
                elevation = Utils.clamp(elevation, 0, 1);
                heat = Utils.clamp(heat, 0, 1);
                moisture = Utils.clamp(moisture, 0, 1);

                row.push({
                    q, r,
                    elevation,
                    temperature: heat,
                    moisture,
                    terrain: null,
                    resource: null,
                    kingdom: null,
                    settlement: null,
                    improvement: null,
                    explored: false,
                    visible: false,
                    hasRiver: false,
                    hasRoad: false,
                    riverSource: false
                });
                if (relief !== undefined) row[row.length - 1]._relief = relief;
            }
            tiles.push(row);
        }

        // terrainGen 11: the sea set so the land is landMass% of the map, then the land's
        // heights spread over the lowlands, hills and mountains (Terrain._seaLevel11)
        if (land11) Terrain._seaLevel11(tiles, width, height, { landMass, waterThreshold, hillsLevel, highlandsLevel, mountainLevel, snowPeakLevel, hillDensity, mountainDensity, flatnessPow, deepWaterLevel });

        // ── terrainGen 16: passes through the long ranges, before the climate and the rivers
        // so both run over them (Terrain._passes16, data/terrain.json passes) ──
        if (terrainGen >= 16) Terrain._passes16(tiles, width, height, { rng: params.seed ? Utils.seededRandom(Math.abs(Utils.hashStr(`passes:${params.seed}`)) || 1) : () => Utils.random(), waterThreshold, hillsLevel, highlandsLevel, mountainLevel, snowPeakLevel });

        // Sprinkle super-peaks (Post-processing) — scaled by mountain density
        // (since terrainGen 12 the mountains stand in ranges along the plates' seams instead)
        const numPeaks = terrainGen >= 12 ? 0 : Math.round(Utils.randInt(8, 14) * mountainDensity);
        for (let i = 0; i < numPeaks; i++) {
            let pq = Math.floor(rng() * width);
            let pr = Math.floor(rng() * height);
            // Most of the map is sea: a peak dropped there raises nothing,
            // and with no mountains no river has a source
            for (let tries = 0; terrainGen >= 2 && tiles[pr][pq].elevation <= 0.45 && tries < 40; tries++) {
                pq = Math.floor(rng() * width);
                pr = Math.floor(rng() * height);
            }
            const root = tiles[pr][pq];

            // Only boost peaks on existing hills/land to keep them realistic
            if (root.elevation > 0.45) {
                const peakRadius = Utils.randInt(2, 4);
                const boost = Utils.randFloat(0.25, 0.45) * mountainDensity;

                for (let r = pr - peakRadius; r <= pr + peakRadius; r++) {
                    for (let q = pq - peakRadius; q <= pq + peakRadius; q++) {
                        if (r < 0 || r >= height) continue;
                        const wq = Hex.wrapQ(q, width);
                        const dist = Hex.wrappingDistance(pq, pr, wq, r, width);

                        if (dist <= peakRadius) {
                            const falloff = 1 - (dist / peakRadius);
                            tiles[r][wq].elevation = Utils.clamp(tiles[r][wq].elevation + (boost * falloff), 0, 1);
                        }
                    }
                }
            }
        }

        // Generate Rivers — scale count by map size relative to default 120x80
        const scaledRiverCount = Math.round(riverCount * Math.sqrt((width * height) / (120 * 80)));
        // (since terrainGen 11 the springs are counted by the land itself: the count is not
        // scaled up again by the map's size)
        // Worlds since terrainGen 10: water drains as water does (rain gathers downhill into
        // branching river systems, basins fill into lakes); older worlds keep their rivers
        // Worlds since terrainGen 12: the climate on the finished heights (colder up high, rain
        // off the sea on the prevailing winds, dry in the lee of the ranges: Terrain._climate12)
        if (terrainGen >= 12) Terrain._climate12(tiles, width, height, { waterThreshold, rainBias: rainBias * 0.75, desertBelts: terrainGen >= 13, desertFactor, wideBelts: terrainGen >= 14 });
        if (terrainGen >= 10) Terrain.generateHydrology(tiles, width, height, rng, { riverCount: terrainGen >= 11 ? riverCount : scaledRiverCount, lakeFreq, waterLevel: waterThreshold, mountainLevel, hillsLevel, valleyLakes: terrainGen >= 11 });
        else Terrain.generateRivers(tiles, width, height, scaledRiverCount, lakeFreq, { v2: terrainGen >= 2, waterThreshold, mountainLevel, highlandsLevel });

        // (since terrainGen 12 the country beside a river or lake is greener)
        if (terrainGen >= 12) Terrain._riverbanks12(tiles, width, height);

        // ── terrainGen 16 coasts: fjords cut into cold high coasts (Terrain._fjords16) ──
        const coastRng = terrainGen >= 16 ? (params.seed ? Utils.seededRandom(Math.abs(Utils.hashStr(`coasts:${params.seed}`)) || 1) : rng) : null;
        if (terrainGen >= 16) Terrain._fjords16(tiles, width, height, coastRng, { waterThreshold, hillsLevel });

        // Classify Water Bodies (Lake vs Sea vs Ocean)
        Terrain.classifyWaterBodies(tiles, width, height);

        // Store thresholds on Terrain for classifyTerrain to use
        Terrain._currentThresholds = {
            waterThreshold,
            deepWaterLevel,
            hillsLevel,
            highlandsLevel,
            mountainLevel,
            snowPeakLevel
        };

        // Resource density multiplier
        const resDensityMap = { scarce: 0.3, low: 0.6, normal: 1.0, abundant: 1.5, rich: 2.5 };
        const resMultiplier = resDensityMap[resourceDensity] || 1.0;
        const strategicMap = { scarce: 0.4, normal: 1.0, abundant: 2.0 };
        const strategicMultiplier = strategicMap[strategicRes] || 1.0;

        // Classify Terrain
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                tile.terrain = Terrain.classifyTerrain(tile);

                // Functional Island Generation: Convert some water to ISLAND
                if (tile.terrain.id === 'ocean' || tile.terrain.id === 'coast') {
                    const islandSeed = Utils.hashStr(`${q}_${r}_island`);
                    const islandRng = Utils.seededRandom(Math.abs(islandSeed));

                    // Scale island chance by islandFreq parameter
                    const baseChance = (tile.terrain.id === 'ocean') ? 0.005 : 0.01;
                    const chance = baseChance * islandFreq;
                    // (since terrainGen 15 a river's mouth is not stopped up by an islet)
                    const mouth = terrainGen >= 15 && Hex.neighbors(q, r).some((n, i) => n.r >= 0 && n.r < height
                        && tiles[n.r][Hex.wrapQ(n.q, width)].hasRiver && tiles[n.r][Hex.wrapQ(n.q, width)].riverDir === (i + 3) % 6);
                    if (islandRng() < chance && !mouth) {
                        tile.terrain = Terrain.TYPES.ISLAND;
                        tile.elevation = 0.45;
                    }
                }
            }
        }

        // Worlds since terrainGen 15: what is mined lies in a few ore fields, each mineral in its
        // own places, so lands must trade for what they lack (Terrain._mineralFields)
        const minerals = terrainGen >= 15
            ? Terrain._mineralFields(tiles, width, height, params.seed ? Utils.seededRandom(Math.abs(Utils.hashStr(`minerals:${params.seed}`)) || 1) : rng)
            : null;
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                tile.resource = minerals
                    ? Terrain.rollResource15(tile, minerals, resMultiplier, strategicMultiplier)
                    : Terrain.rollResource(tile.terrain.id, q, r, resMultiplier, strategicMultiplier);
            }
        }

        // ── terrainGen 16 coasts: beaches on low warm shores, skerries off rocky ones (Terrain._shores16) ──
        if (terrainGen >= 16) Terrain._shores16(tiles, width, height, coastRng, { waterThreshold });

        // --- Post-process: Sink single-tile "noise" islands ---
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                // Only target land that isn't already marked as an intentional ISLAND
                if (tile.terrain.passable && tile.terrain.id !== 'island') {
                    const neighbors = Hex.neighbors(q, r);
                    let landNeighbors = 0;
                    for (const n of neighbors) {
                        const wq = Hex.wrapQ(n.q, width);
                        if (n.r < 0 || n.r >= height) continue;
                        if (tiles[n.r][wq].elevation >= 0.42) {
                            landNeighbors++;
                        }
                    }
                    // If it's a lone tile in the ocean, sink it
                    if (landNeighbors === 0) {
                        tile.elevation = 0.38;
                        // (since terrainGen 11 a speck of land in a lake goes under as lake, not sea)
                        const inLake = terrainGen >= 11 && neighbors.some(n => n.r >= 0 && n.r < height && tiles[n.r][Hex.wrapQ(n.q, width)]._lake);
                        if (inLake) { tile._lake = true; tile.waterBodyType = 'lake'; tile.hasRiver = false; }
                        tile.terrain = Terrain.classifyTerrain(tile);
                    }
                }
            }
        }

        // No river left drawn on a hex that became water
        Terrain.cleanRivers(tiles);

        // Worlds since terrainGen 15: a small river that runs on through dry country dries up
        // there; any other river that would end on land ends in a lake instead (Terrain._riverEnds15)
        if (terrainGen >= 15) Terrain._riverEnds15(tiles, width, height, { waterThreshold });

        // Worlds since terrainGen 16: marshes on the low wet flats, and deltas at the mouths of
        // the greatest rivers (Terrain._wetlands16, data/terrain.json wetlands)
        if (terrainGen >= 16) {
            Terrain._wetlands16(tiles, width, height, {
                waterThreshold, rainfall, minerals, resMultiplier, strategicMultiplier,
                rng: params.seed ? Utils.seededRandom(Math.abs(Utils.hashStr(`wetlands:${params.seed}`)) || 1) : rng,
            });
        }

        // Identify connected regions for reachable pathfinding
        Terrain.identifyRegions(tiles, width, height);

        return tiles;
    },

    /**
     * Run rivers from the high ground down to the sea. `levels.v2` (worlds
     * made since terrainGen 2) reads the world's own water and mountain
     * levels and falls back to the highlands when there are few mountains;
     * without it the old fixed levels and lake quirks are kept, so a saved
     * world (regenerated from its seed on load) comes back as it was.
     */
    generateRivers(tiles, width, height, riverCount = 40, lakeFreq = 'normal', levels = {}) {
        const v2 = !!levels.v2;
        const waterLevel = v2 ? (levels.waterThreshold || 0.42) : 0.42;
        // Only start from mountains (just above classifyTerrain's threshold)
        const minRiverHeight = v2 ? (levels.mountainLevel || 0.70) + 0.02 : 0.72;
        const lakeLevel = waterLevel - 0.04;
        const isWater = (t) => t.elevation < waterLevel;

        // Lake expansion based on lakeFreq
        const lakeExpandMap = { none: 0, few: 0, normal: 0, many: 2, abundant: 4 };
        const lakeExpand = lakeExpandMap[lakeFreq] || 0;
        const allowLakes = lakeFreq !== 'none';

        // Find viable river sources (mountains)
        let viableTiles = [];
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const t = tiles[r][q];
                if (t.elevation > minRiverHeight) viableTiles.push(t);
            }
        }
        // Few mountains: the highlands feed rivers too
        if (v2 && viableTiles.length < riverCount * 2) {
            const highland = levels.highlandsLevel || 0.60;
            viableTiles = tiles.flat().filter(t => t.elevation > highland);
        }

        Utils.shuffle(viableTiles);

        // Safety check
        if (viableTiles.length === 0) return;

        let created = 0;

        for (const startTile of viableTiles) {
            if (created >= riverCount) break;
            if (startTile.hasRiver) continue;

            let current = startTile;
            const path = [current];
            const onPath = new Set([current]);
            // How the river ends: 'water' (sea or lake), 'merge' (joins a
            // river), 'lake' (pools in a basin it makes), or null (gave out)
            let ending = null;
            let mouth = null;

            while (path.length <= 100) {
                const candidates = [];
                for (const n of Hex.neighbors(current.q, current.r)) {
                    if (n.r < 0 || n.r >= height) continue;
                    const nt = tiles[n.r][Hex.wrapQ(n.q, width)];
                    if (onPath.has(nt)) continue; // No loops
                    // Strictly downhill
                    if (nt.elevation < current.elevation) candidates.push(nt);
                }

                if (candidates.length === 0) {
                    // Local minimum on land: pools into a lake, or gives out
                    if (allowLakes) ending = 'lake';
                    break;
                }

                // Best flow: open water, then an existing river (merge),
                // then the steepest descent
                candidates.sort((a, b) => {
                    const aw = isWater(a), bw = isWater(b);
                    if (aw !== bw) return aw ? -1 : 1;
                    if (a.hasRiver !== b.hasRiver) return a.hasRiver ? -1 : 1;
                    return a.elevation - b.elevation;
                });
                const next = candidates[0];

                if (isWater(next)) { ending = 'water'; mouth = next; break; }
                if (next.hasRiver) { ending = 'merge'; mouth = next; break; }

                path.push(next);
                onPath.add(next);
                current = next;
            }

            // The land the river runs over: a lake's basin (the last tile) is
            // water once flooded, so the river stops on the tile before it
            if (!v2) {
                // Old worlds: the basin flooded even for a river too short
                // to keep, and a river that gave out on land still counted
                if (ending === 'lake' && path.length < 3) { path[path.length - 1].elevation = lakeLevel; Terrain._expandLake(tiles, width, height, path[path.length - 1], lakeExpand, waterLevel, lakeLevel, null); continue; }
                if (!ending && !allowLakes && path.length >= 3) ending = 'gaveOut';
            }
            if (ending === 'lake') {
                if (path.length < 3) continue;
                mouth = path.pop();
            }
            if (!ending || path.length < 2) continue;

            if (ending === 'lake') {
                mouth.elevation = lakeLevel;
                Terrain._expandLake(tiles, width, height, mouth, lakeExpand, waterLevel, lakeLevel, v2 ? onPath : null);
            }

            created++;
            // Each river hex remembers which way it flows (riverDir, the
            // Hex.neighbors index of the next hex downstream): the renderer
            // joins a hex only to its own downstream and its upstreams, so
            // rivers running side by side don't fuse into one wide stream
            for (let i = 0; i < path.length; i++) {
                const t = path[i];
                const down = i + 1 < path.length ? path[i + 1] : mouth;
                t.hasRiver = true;
                // A river that gave out (old worlds only) has no downstream
                t.riverDir = down ? Hex.directionTo(t.q, t.r, down.q, down.r, width) : -1;
                if (i === 0) t.riverSource = true;
            }
        }
    },

    /**
     * Water as it drains (worlds since terrainGen 10). Instead of a fixed
     * number of rivers each running straight downhill from a peak (which on
     * the smooth noise gave long parallel rivers and hardly a lake):
     *
     *   1. basins: a few hollows are pressed into the uplands and plains
     *      (more in cold country, as glaciers left them; HYDRO.basinsPerLand
     *      x lakeFreq), beside the hollows the noise already has;
     *   2. drainage: a priority flood from the sea over the land (with a
     *      little jitter, so flow on an even slope wanders and meets rather
     *      than running side by side) gives every hex the hex its water runs
     *      to, and fills every hollow to its spill point;
     *   3. lakes: a hollow deeper than the jitter fills with water up to
     *      HYDRO.maxLake hexes (its deepest), by lakeFreq; a river runs into
     *      it and out of it at its spill point;
     *   4. rivers: every hex gathers its rain (more where it is moist, less
     *      in the frozen north) and passes it, with all it was given, down
     *      to the next; the hexes carrying the most water (HYDRO.riverShare
     *      of the land, x riverCount / 40) are the rivers, so small streams
     *      join into trunks, as rivers do; a system shorter than
     *      HYDRO.minLength from source to mouth is let go.
     *
     * Sets elevation (lakes below the water level, flagged _lake), hasRiver,
     * riverDir (the Hex.neighbors index downstream) and riverSource.
     * Randomness from `rng` (the world's seeded generator).
     */
    generateHydrology(tiles, width, height, rng, o = {}) {
        const H = Terrain.HYDRO;
        const waterLevel = o.waterLevel || 0.42;
        const mountainLevel = o.mountainLevel || 0.70;
        const lakeLevel = waterLevel - 0.04;
        const lakeMult = ({ none: 0, few: 0.5, normal: 1, many: 2, abundant: 3 })[o.lakeFreq || 'normal'] ?? 1;
        const N = width * height;
        const at = (i) => tiles[Math.floor(i / width)][i % width];
        const nbrCache = new Array(N);
        const nbrs = (i) => {
            let a = nbrCache[i];
            if (a) return a;
            const q = i % width, r = Math.floor(i / width);
            a = [];
            for (const n of Hex.neighbors(q, r)) {
                if (n.r < 0 || n.r >= height) continue;
                a.push(n.r * width + Hex.wrapQ(n.q, width));
            }
            nbrCache[i] = a;
            return a;
        };
        const water = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (at(i).elevation < waterLevel) water[i] = 1;

        // (since terrainGen 11 the lakes lie in the valleys, dammed on their rivers: below)
        const valley = !!o.valleyLakes;

        // 1. Hollows pressed into the land (not by the sea, not on the mountains)
        const inland = [];
        for (let i = 0; i < N; i++) {
            const t = at(i);
            if (water[i] || t.elevation < waterLevel + 0.03 || t.elevation >= mountainLevel) continue;
            if (nbrs(i).some(j => water[j])) continue;
            inland.push(i);
        }
        const basins = lakeMult > 0 && !valley ? Math.round(inland.length / H.basinsPerLand * lakeMult) : 0;
        for (let k = 0, tries = 0; k < basins && tries < basins * 6 && inland.length; tries++) {
            const i = inland[Math.floor(rng() * inland.length)];
            const t = at(i);
            // glacial country is full of lakes: a hollow in the cold is likelier kept
            if (rng() > 0.45 + 0.55 * (1 - (t.temperature ?? 0.5))) continue;
            const ring = nbrs(i).map(j => at(j));
            const rim = Math.min(...ring.map(n => n.elevation));
            const depth = H.basinDepth[0] + rng() * (H.basinDepth[1] - H.basinDepth[0]);
            const floor = Math.max(waterLevel + 0.002, Math.min(t.elevation, rim) - depth);
            if (floor >= rim - 0.01) continue;
            t.elevation = floor;
            // a broader hollow: the ring sinks a little too, never below the floor; now and
            // then a wide one (HYDRO.wideBasin), its ring sunk deep and the ring beyond a little
            const wide = rng() < H.wideBasin;
            for (const n of ring) if (n.elevation < mountainLevel) n.elevation = Math.max(floor + 0.004, n.elevation - depth * (wide ? 0.85 : 0.35 * rng()));
            if (wide) {
                const ringIds = new Set(nbrs(i));
                for (const j of ringIds) {
                    for (const j2 of nbrs(j)) {
                        if (j2 === i || ringIds.has(j2) || water[j2]) continue;
                        const n2 = at(j2);
                        if (n2.elevation < mountainLevel) n2.elevation = Math.max(floor + 0.01, n2.elevation - depth * 0.4);
                    }
                }
            }
            k++;
        }

        // 2. A priority flood from the sea over a height field (min-heap on the filled
        // height): every hex's filled height (its hollow filled to the spill point), the
        // hex its water runs on to, and the order they were reached (the sea first). Only the
        // sea drains: a lake fills to its spill point and runs on out of it, as a lake does
        const flood = (z) => {
            const filled = new Float64Array(N);
            const recv = new Int32Array(N).fill(-1);
            const seen = new Uint8Array(N);
            const heap = [];
            const push = (v, i) => {
                heap.push([v, i]);
                let c = heap.length - 1;
                while (c > 0) {
                    const p = (c - 1) >> 1;
                    if (heap[p][0] <= heap[c][0]) break;
                    [heap[p], heap[c]] = [heap[c], heap[p]];
                    c = p;
                }
            };
            const pop = () => {
                const top = heap[0];
                const last = heap.pop();
                if (heap.length) {
                    heap[0] = last;
                    let c = 0;
                    for (;;) {
                        const a = 2 * c + 1, b = a + 1;
                        let m = c;
                        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
                        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
                        if (m === c) break;
                        [heap[m], heap[c]] = [heap[c], heap[m]];
                        c = m;
                    }
                }
                return top;
            };
            let outlets = 0;
            for (let i = 0; i < N; i++) {
                if (!water[i] || at(i)._lake) continue;
                seen[i] = 1;
                filled[i] = z[i];
                push(z[i], i);
                outlets++;
            }
            if (!outlets) {
                let lo = 0;
                for (let i = 1; i < N; i++) if (z[i] < z[lo]) lo = i;
                seen[lo] = 1;
                filled[lo] = z[lo];
                push(z[lo], lo);
            }
            const order = [];
            while (heap.length) {
                const [, c] = pop();
                order.push(c);
                for (const n of nbrs(c)) {
                    if (seen[n]) continue;
                    seen[n] = 1;
                    filled[n] = Math.max(z[n], filled[c] + 1e-6);
                    recv[n] = c;
                    push(filled[n], n);
                }
            }
            return { filled, recv, order };
        };

        const jit = new Float64Array(N);
        if (valley) for (let i = 0; i < N; i++) jit[i] = (rng() - 0.5) * H.jitter;
        if (valley && lakeMult > 0) Terrain._valleyLakes({ N, at, nbrs, water, flood, jit, rng, lakeMult, lakeLevel, mountainLevel, H });

        // 3. Lakes: the land's true hollows (a flood of the heights as they are), up to
        // maxLake hexes each (their deepest); with valley lakes only the deep ones, whole
        if (lakeMult > 0) {
            const plain = new Float64Array(N);
            for (let i = 0; i < N; i++) plain[i] = at(i).elevation;
            const { filled: lf } = flood(plain);
            const depthOf = (i) => lf[i] - plain[i];
            const inHollow = new Uint8Array(N);
            for (let i = 0; i < N; i++) if (!water[i] && depthOf(i) > H.minLakeDepth) inHollow[i] = 1;
            const done = new Uint8Array(N);
            const maxLake = Math.max(1, Math.round(H.maxLake * Math.min(2, 0.5 + lakeMult * 0.5)));
            const basinsFound = [];
            for (let i = 0; i < N; i++) {
                if (!inHollow[i] || done[i]) continue;
                const group = [i];
                done[i] = 1;
                for (let g = 0; g < group.length; g++) {
                    for (const n of nbrs(group[g])) {
                        if (inHollow[n] && !done[n]) { done[n] = 1; group.push(n); }
                    }
                }
                const deepest = Math.max(...group.map(depthOf));
                if (valley) {
                    // a speck of a hollow in the noise is no lake; a real basin fills whole (the
                    // deepest few only, by the root of the land: below)
                    if (group.length >= 2 && deepest >= H.minLakeDepth * 3
                        && !group.some(g => nbrs(g).some(n => water[n] && !inHollow[n]))) basinsFound.push({ group, deepest });
                    continue;
                } else if (deepest < H.minLakeDepth * 2 && rng() > Math.min(1, 0.5 * lakeMult)) continue;
                group.sort((a, b) => depthOf(b) - depthOf(a));
                for (const j of group.slice(0, valley ? maxLake * 2 : maxLake)) {
                    const t = at(j);
                    t.elevation = lakeLevel;
                    t._lake = true;
                    water[j] = 1;
                }
            }
            if (valley) {
                let landN = 0;
                for (let i = 0; i < N; i++) if (!water[i]) landN++;
                basinsFound.sort((a, b) => b.deepest - a.deepest);
                const keepN = Math.round(Math.sqrt(landN) * H.v11.hollowLakesPerRoot * lakeMult);
                for (const { group } of basinsFound.slice(0, keepN)) {
                    group.sort((a, b) => depthOf(b) - depthOf(a));
                    for (const j of group.slice(0, maxLake * 2)) {
                        const t = at(j);
                        t.elevation = lakeLevel;
                        t._lake = true;
                        water[j] = 1;
                    }
                }
            }
        }

        // Drainage over the heights with a little jitter (HYDRO.jitter), so water on an even
        // slope wanders and meets other water rather than running beside it to the sea; the
        // lakes are water now, so a river runs into a lake and out at its spill point
        const z = new Float64Array(N);
        for (let i = 0; i < N; i++) z[i] = at(i).elevation + (valley ? jit[i] : (rng() - 0.5) * H.jitter);
        const { recv, order } = flood(z);

        // 4. Rivers: the rain gathered downhill; the hexes carrying the most water
        const flow = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            const t = at(i);
            if (water[i] && !t._lake) continue;
            const cold = (t.temperature ?? 0.5) < 0.15 ? 0.5 : 1;
            flow[i] = (0.35 + (t.moisture ?? 0.5)) * cold;
        }
        for (let k = order.length - 1; k >= 0; k--) {
            const c = order[k];
            if (recv[c] >= 0) flow[recv[c]] += flow[c];
        }
        const landFlows = [];
        for (let i = 0; i < N; i++) if (!water[i]) landFlows.push(flow[i]);
        if (!landFlows.length) return;
        landFlows.sort((a, b) => b - a);
        const isRiver = new Uint8Array(N);
        if (valley) {
            // Since terrainGen 11 a river rises at a spring in the hills or mountains and runs
            // down the drainage to the sea or a lake, as rivers do; where two meet, one is a
            // tributary of the other; every lake drains by a river (Terrain._traceRivers)
            Terrain._traceRivers({ N, at, nbrs, water, recv, order, flow, isRiver, rng, H,
                land: landFlows.length, riverCount: o.riverCount ?? 40,
                hillsLevel: o.hillsLevel || 0.52, mountainLevel });
        } else {
        // (a share of the land, by the rivers asked for: riverCount 40 is the usual)
        const target = Math.max(0, Math.round(landFlows.length * H.riverShare * (o.riverCount ?? 40) / 40));
        if (!target) return;
        const T = Math.max(H.minFlow, landFlows[Math.min(landFlows.length - 1, target)]);
        for (let i = 0; i < N; i++) if (!water[i] && flow[i] >= T && recv[i] >= 0) isRiver[i] = 1;
        // A stream that reaches the sea within a hex or two is no river: a system whose
        // longest course is shorter than HYDRO.minLength is let go (walked from the mouth up)
        const longest = new Int32Array(N);
        for (let k = order.length - 1; k >= 0; k--) {
            const c = order[k];
            if (!isRiver[c]) continue;
            const d = recv[c];
            if (isRiver[d] && longest[c] + 1 > longest[d]) longest[d] = longest[c] + 1;
        }
        // (the mouth: a river hex whose next hex is not river; its longest course is the system's)
        const keep = new Uint8Array(N);
        for (let k = 0; k < order.length; k++) {
            const c = order[k];
            if (!isRiver[c]) continue;
            const d = recv[c];
            if (!isRiver[d]) keep[c] = longest[c] + 1 >= H.minLength ? 1 : 0;
            else keep[c] = keep[d];
        }
        for (let i = 0; i < N; i++) if (isRiver[i] && !keep[i]) isRiver[i] = 0;
        // Headwaters: each river climbs on up its biggest feeder while that still carries
        // HYDRO.headFlow, so it rises in the hills and mountains, not half way down them
        const donors = new Array(N);
        for (let i = 0; i < N; i++) {
            const d = recv[i];
            if (d < 0 || water[i]) continue;
            (donors[d] || (donors[d] = [])).push(i);
        }
        for (let i = 0; i < N; i++) {
            if (!isRiver[i]) continue;
            let c = i;
            for (let steps = 0; steps < 40; steps++) {
                const ds = donors[c];
                if (!ds) break;
                if (ds.some(j => isRiver[j])) break; // (fed already: not a source)
                let best = -1;
                for (const j of ds) if (best < 0 || flow[j] > flow[best]) best = j;
                if (best < 0 || flow[best] < H.headFlow) break;
                isRiver[best] = 1;
                c = best;
            }
        }
        }
        const fed = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (isRiver[i]) fed[recv[i]] = 1;
        for (let i = 0; i < N; i++) {
            if (!isRiver[i]) continue;
            const t = at(i), d = at(recv[i]);
            t.hasRiver = true;
            t.riverDir = Hex.directionTo(t.q, t.r, d.q, d.r, width);
            // (a river out of a lake rises in the lake, not at a spring)
            t.riverSource = !fed[i] && !(valley && nbrs(i).some(j => at(j)._lake && recv[j] === i));
        }
    },

    /**
     * Rivers as they run (worlds since terrainGen 11). Springs are chosen in
     * the hills and mountains (the highest first, with a little chance,
     * spaced and counted by the root of the land, HYDRO.v11.springsPerRoot /
     * spacingRoot / lengthRoot, so a big continent has longer rivers, not a web; land
     * hexes, by riverCount), each far enough from the sea that its river runs
     * HYDRO.v11.minLength hexes or more. Each river follows the drainage
     * (`recv`) down to the sea or a lake. A river that meets one already laid
     * joins it as a tributary, if it has run HYDRO.v11.minBranch hexes of its
     * own first (else it is no river). Every lake of HYDRO.v11.lakeOutflow
     * hexes or more drains by a river from its spill point. Fills `isRiver`.
     */
    _traceRivers({ N, at, nbrs, water, recv, order, flow, isRiver, rng, H, land, riverCount, hillsLevel, mountainLevel }) {
        const V = H.v11;
        // (by the root of the land, and spaced by it: a continent twice as wide has twice the
        // rivers, each twice as long, not four times as many crowded together)
        const root = Math.sqrt(land);
        const want = Math.max(1, Math.round(root * V.springsPerRoot * riverCount / 40));
        const spacing = Math.max(V.springSpacing, Math.round(root / V.spacingRoot));
        const minLength = Math.max(V.minLength, Math.round(root / V.lengthRoot));
        // how many hexes from each land hex down to water
        const steps = new Int32Array(N);
        for (let k = 0; k < order.length; k++) {
            const c = order[k];
            if (water[c]) continue;
            const d = recv[c];
            steps[c] = d < 0 ? 0 : (water[d] ? 1 : steps[d] + 1);
        }
        // the water a spring may reach: down to the sea, or a lake
        const cands = [];
        for (let i = 0; i < N; i++) {
            if (water[i] || recv[i] < 0) continue;
            const e = at(i).elevation;
            if (e < hillsLevel || steps[i] < minLength) continue;
            // (the highest country first, a wet slope before a dry one, with some chance)
            cands.push({ i, v: Math.min(e, mountainLevel + 0.1) + (at(i).moisture ?? 0.5) * 0.08 + rng() * 0.12 });
        }
        cands.sort((a, b) => b.v - a.v);
        const near = new Uint8Array(N);
        const mark = (i) => {
            let fr = [i];
            near[i] = 1;
            for (let d = 0; d < spacing; d++) {
                const next = [];
                for (const c of fr) for (const n of nbrs(c)) if (!near[n]) { near[n] = 1; next.push(n); }
                fr = next;
            }
        };
        // walk a river down from `i`: -> its course, or null if it is too short before it meets another
        const course = (i, minOwn) => {
            const path = [];
            let c = i;
            for (let s = 0; c >= 0 && !water[c] && !isRiver[c] && s < 400; s++) { path.push(c); c = recv[c]; }
            if (c >= 0 && isRiver[c] && path.length < minOwn) return null;
            return path;
        };
        let made = 0;
        for (const { i } of cands) {
            if (made >= want) break;
            if (near[i] || isRiver[i]) continue;
            const path = course(i, V.minBranch);
            if (!path || path.length < Math.min(minLength, steps[i])) continue;
            for (const c of path) isRiver[c] = 1;
            mark(i);
            made++;
        }
        // Every lake drains by a river from its spill point (to the sea or the next lake)
        const lakeOf = new Int32Array(N).fill(-1);
        const lakeSize = new Map();
        for (let i = 0; i < N; i++) {
            if (!at(i)._lake || lakeOf[i] >= 0) continue;
            const g = [i];
            lakeOf[i] = i;
            for (let k = 0; k < g.length; k++) for (const n of nbrs(g[k])) if (at(n)._lake && lakeOf[n] < 0) { lakeOf[n] = i; g.push(n); }
            lakeSize.set(i, g.length);
        }
        for (let i = 0; i < N; i++) {
            if (lakeOf[i] < 0 || lakeSize.get(lakeOf[i]) < V.lakeOutflow) continue;
            const c = recv[i];
            if (c < 0 || water[c]) continue;
            for (const h of course(c, 0)) isRiver[h] = 1;
        }
        return isRiver;
    },

    /**
     * Lakes in the valleys (worlds since terrainGen 11). The water is first
     * run off the land as it lies; then, on streams in the hills and plains
     * away from the sea, a valley is dammed (a moraine, a rockfall, a lip of
     * hard rock) and fills from its lowest ground up within the country that
     * drains to the dam, so a lake follows the contours: long and branching
     * up a valley and its side valleys, round in a bowl, and a river runs in
     * at its head and out over the dam. More in cold country, where the ice
     * left them; in the far cold a scatter of small kettle ponds besides.
     * Lakes are kept HYDRO.lakeSpacing apart. Marks tiles _lake at lakeLevel.
     */
    _valleyLakes({ N, at, nbrs, water, flood, jit, rng, lakeMult, lakeLevel, mountainLevel, H }) {
        const z0 = new Float64Array(N);
        for (let i = 0; i < N; i++) z0[i] = at(i).elevation + jit[i];
        const { recv, order } = flood(z0);
        const flow = new Float64Array(N);
        let landN = 0;
        for (let i = 0; i < N; i++) {
            if (water[i]) continue;
            landN++;
            flow[i] = 0.35 + (at(i).moisture ?? 0.5);
        }
        for (let k = order.length - 1; k >= 0; k--) {
            const c = order[k];
            if (recv[c] >= 0) flow[recv[c]] += flow[c];
        }
        const donors = new Array(N);
        for (let i = 0; i < N; i++) {
            const d = recv[i];
            if (d >= 0 && !water[i]) (donors[d] || (donors[d] = [])).push(i);
        }
        // how far each land hex is from the sea (to 4)
        const seaDist = new Uint8Array(N).fill(9);
        let ring = [];
        for (let i = 0; i < N; i++) if (water[i] && !at(i)._lake) { seaDist[i] = 0; ring.push(i); }
        for (let d = 1; d <= 4 && ring.length; d++) {
            const next = [];
            for (const c of ring) for (const n of nbrs(c)) if (seaDist[n] > d) { seaDist[n] = d; next.push(n); }
            ring = next;
        }
        const noGo = new Uint8Array(N);
        const halo = (lake) => {
            let fr = lake.slice();
            for (const j of fr) noGo[j] = 1;
            for (let d = 0; d < H.lakeSpacing; d++) {
                const next = [];
                for (const c of fr) for (const n of nbrs(c)) if (!noGo[n]) { noGo[n] = 1; next.push(n); }
                fr = next;
            }
        };
        const fill = (lake) => {
            for (const j of lake) {
                const t = at(j);
                t.elevation = lakeLevel;
                t._lake = true;
                water[j] = 1;
            }
            halo(lake);
        };
        // grow from `start` over the lowest ground first, within `allowed`, to `size` hexes
        const grow = (start, size, allowed) => {
            const lake = [start];
            const inLake = new Set([start]);
            const front = [];
            const add = (c) => {
                for (const n of nbrs(c)) {
                    if (inLake.has(n) || water[n] || noGo[n] || seaDist[n] < 2 || !allowed(n) || at(n)._pass) continue;   // (no lake drowns a mountain pass: terrainGen 16)
                    if (at(n).elevation >= mountainLevel + 0.06) continue;
                    inLake.add(n);
                    front.push(n);
                }
            };
            add(start);
            while (lake.length < size && front.length) {
                let bi = 0;
                for (let k = 1; k < front.length; k++) if (at(front[k]).elevation < at(front[bi]).elevation) bi = k;
                const c = front[bi];
                front[bi] = front[front.length - 1];
                front.pop();
                lake.push(c);
                add(c);
            }
            return lake;
        };

        // 1. Dammed valleys on the streams
        const cands = [];
        for (let i = 0; i < N; i++) {
            if (water[i] || seaDist[i] < 3 || recv[i] < 0) continue;
            const t = at(i);
            if (t.elevation >= mountainLevel + 0.04 || flow[i] < H.lakeMinFlow) continue;
            const cold = 1 - (t.temperature ?? 0.5);
            cands.push({ i, v: rng() * (1 + H.coldLakes * cold) + Math.min(0.3, flow[i] / 200) });
        }
        cands.sort((a, b) => b.v - a.v);
        // (by the root of the land: a continent twice as wide has twice the lakes, not four times)
        const want = Math.round(Math.sqrt(landN) * H.lakesPerRoot * lakeMult);
        const sizeMult = Math.min(1.6, 0.7 + 0.3 * lakeMult);
        let made = 0;
        for (const { i } of cands) {
            if (made >= want) break;
            if (noGo[i] || water[i] || at(i)._pass) continue;
            // the country that drains to this hex (the lake may fill only that)
            const basin = new Set([i]);
            const stack = [i];
            while (stack.length && basin.size < 600) {
                const c = stack.pop();
                for (const j of donors[c] || []) if (!basin.has(j)) { basin.add(j); stack.push(j); }
            }
            if (basin.size < 5) continue;
            const span = H.lakeSize[1] - H.lakeSize[0];
            const size = Math.min(Math.floor(basin.size * 0.6),
                Math.round((H.lakeSize[0] + span * Math.pow(rng(), 1.3)) * sizeMult));
            if (size < 2) continue;
            const lake = grow(i, size, (n) => basin.has(n));
            if (lake.length < 2) continue;
            fill(lake);
            made++;
        }

        // 2. Kettle ponds in the far cold
        const cold = [];
        for (let i = 0; i < N; i++) if (!water[i] && seaDist[i] >= 2 && (at(i).temperature ?? 0.5) < H.kettleTemp && at(i).elevation < mountainLevel) cold.push(i);
        const ponds = Math.round(Math.sqrt(cold.length) * H.kettlesPerRoot * lakeMult);
        for (let k = 0, tries = 0; k < ponds && tries < ponds * 5 && cold.length; tries++) {
            const i = cold[Math.floor(rng() * cold.length)];
            if (noGo[i] || water[i] || at(i)._pass) continue;
            const e = at(i).elevation;
            const lake = grow(i, 1 + Math.floor(rng() * 3), (n) => at(n).elevation <= e + 0.03);
            fill(lake);
            k++;
        }
    },

    /** Tunables for generateHydrology (worlds since terrainGen 10) */
    HYDRO: {
        basinsPerLand: 25,    // inland hexes per hollow pressed in (at lakeFreq normal)
        basinDepth: [0.03, 0.08],
        jitter: 0.04,         // routing noise, so flow on an even slope wanders and meets
        minLakeDepth: 0.015,  // a hollow this much below its spill point holds water
        maxLake: 9,           // most hexes a lake fills (x by lakeFreq, up to 2x)
        riverShare: 0.12,     // share of the land hexes that are river at riverCount 40 (the usual)
        minFlow: 5,           // no stream thinner than this (the rain of ~5 hexes)
        minLength: 3,         // no river system shorter than this, source to mouth
        headFlow: 2.2,        // a river climbs its biggest feeder while that carries this much
        wideBasin: 0.3,       // share of the hollows pressed in two hexes wide
        // rivers since terrainGen 11: from springs in the hills (Terrain._traceRivers)
        v11: {
            springsPerRoot: 0.42, // springs per root of the land hexes (at riverCount 40): ~13 on 950 land, ~32 on 6000
            springSpacing: 3,   // fewest hexes between one spring and the next...
            spacingRoot: 9,     // ...or the root of the land / this, if more
            minLength: 5,       // no river shorter than this, spring to the sea or a lake...
            lengthRoot: 12,     // ...or the root of the land / this, if more
            hollowLakesPerRoot: 0.08, // deep natural hollows filled, per root of the land
            minBranch: 3,       // a tributary runs this far on its own before it joins
            lakeOutflow: 3,     // a lake this big (hexes) always drains by a river
        },
        // valley lakes (terrainGen 11, Terrain._valleyLakes)
        lakesPerRoot: 0.26,   // dammed valley lakes per root of the land hexes (at lakeFreq normal): ~8 on 950 land, ~20 on 6000
        lakeSize: [3, 30],    // hexes a valley lake fills (skewed small; x up to 1.6 by lakeFreq)
        lakeMinFlow: 4,       // a lake is dammed only on a stream carrying this much rain
        lakeSpacing: 3,       // hexes between one lake and the next
        coldLakes: 1.5,       // how much likelier a lake is in cold country
        kettleTemp: 0.25,     // below this the land is strewn with kettle ponds
        kettlesPerRoot: 0.5,  // kettle ponds per root of the cold land hexes (at normal)
    },

    /**
     * The land field of worlds since terrainGen 11. Each continent seed is
     * sized so the continents together make about the land asked for
     * (landMass % of the map); the distance to a seed is taken through a
     * domain warp, so coasts are ragged with bays and peninsulas, not round
     * blobs; a broad noise at the continents' own scale adds and takes away
     * land, and ridges raise ranges. The noise is laid on the hex grid in
     * true proportion (rows 0.866 apart) and wraps round the world's east-
     * west seam by blending with its copy one world over, so the map is
     * neither stretched nor mirrored. -> { height(q, r) } (a raw height,
     * not yet set to sea level: Terrain._seaLevel11)
     */
    _land11({ width, height, rng, seeds, landMass, continentCount, continentSize, terrainOctaves, mountainDensity, polarFactor, plates = false, sharpRanges = false, relief = false, islandFreq = 1, coastalDetail = 5 }) {
        const target = width * height * Utils.clamp(landMass, 5, 95) / 100;
        const count = continentSize === 'pangaea' ? 1 : Math.max(1, continentCount);
        const sizeMul = ({ small: 0.75, medium: 1, large: 1.25, pangaea: 1.3 })[continentSize] || 1;
        // (a continent's radius in grid units, rows 0.866 apart: its share of the land)
        const radius = Math.sqrt(target * 0.866 / count / Math.PI) * sizeMul;
        const f = 1 / (radius * 1.4);           // the broad noise: about a continent across
        const warp = radius * 0.55;              // how far the coasts are pushed about
        const ox = rng() * 200, oy = rng() * 200;
        const W = width;
        // fbm that wraps east-west: blended with its copy one world over
        const wrapped = (x, y, fr, oct, sx, sy) => {
            const t = x / W;
            const a = Utils.fbm(x * fr + sx, y * fr + sy, oct, 2.0, 0.5);
            const b = Utils.fbm((x - W) * fr + sx, y * fr + sy, oct, 2.0, 0.5);
            return (a * (1 - t) + b * t) / Math.sqrt((1 - t) * (1 - t) + t * t);
        };
        // (worlds since terrainGen 12: ranges where the plates press together, Terrain._plates)
        const uplift = plates && !relief ? Terrain._plates({ width, height, rng, radius, count, wrapped, f, ox, oy, sharp: sharpRanges }) : null;
        const cont = seeds.map((s, i) => ({
            x: s.q + 0.25, y: s.r * 0.866,
            rad: (i === 0 || continentSize !== 'pangaea' ? radius : radius * 0.35) * (0.85 + rng() * 0.3),
            id: i,
        }));
        // Worlds since terrainGen 14: a continent is not one round mass but a body with two or
        // three lobes (so it is long, bent or forked: peninsulas, gulfs, an inland sea's
        // shores), and small islands and archipelagos lie off the coasts and out at sea (as
        // many as the Islands setting asks); the coasts take a finer fringe of bays and capes
        // (the Coastal Detail setting)
        const isles = [];
        const detail = Utils.clamp(coastalDetail / 5, 0, 2);
        if (relief) {
            const bodies = cont.slice();
            for (const c of bodies) {
                const lobes = 1 + Math.floor(rng() * 2.4);
                let a = rng() * Math.PI * 2;
                for (let k = 0; k < lobes; k++) {
                    a += (0.6 + rng() * 1.6) * (rng() < 0.5 ? -1 : 1) + (k ? Math.PI * 0.5 : 0);
                    const dist = c.rad * (0.55 + rng() * 0.4);
                    cont.push({
                        x: ((c.x + Math.cos(a) * dist) % W + W) % W,
                        y: Utils.clamp(c.y + Math.sin(a) * dist * 0.8, height * 0.866 * 0.08, height * 0.866 * 0.92),
                        rad: c.rad * (0.45 + rng() * 0.3),
                        id: c.id,
                    });
                }
            }
            // archipelagos: a few groups of small islands, each strung along a line
            const groups = Math.round((count + 1) * 1.5 * Utils.clamp(islandFreq, 0, 3));
            for (let g = 0; g < groups; g++) {
                let gx = rng() * W, gy = (0.12 + rng() * 0.76) * height * 0.866;
                const ga = rng() * Math.PI * 2;
                const n = 2 + Math.floor(rng() * 5);
                for (let k = 0; k < n; k++) {
                    isles.push({ x: gx, y: gy, rad: Math.max(1.8, radius * (0.09 + rng() * 0.13)) });
                    const step = radius * (0.18 + rng() * 0.2);
                    gx = ((gx + Math.cos(ga + (rng() - 0.5)) * step) % W + W) % W;
                    gy = Utils.clamp(gy + Math.sin(ga + (rng() - 0.5)) * step, 2, height * 0.866 - 2);
                }
            }
        }
        // (the pull of the nearest body of each continent, through the warped coordinates)
        const pull = (wx, wy, c) => {
            let dx = Math.abs(wx - c.x);
            dx = Math.min(dx, W - dx);
            const d = Math.hypot(dx, wy - c.y) / c.rad;
            return 1 - Utils.clamp(d, 0, 1.6) / 1.6;
        };
        const byId = new Float64Array(cont.length);
        const sample = (q, r) => {
            const x = q + (r % 2 === 0 ? 0.5 : 0);
            const y = r * 0.866;
            let wx = x + warp * wrapped(x, y, f * 1.6, 4, ox + 11, oy + 3);
            let wy = y + warp * wrapped(x, y, f * 1.6, 4, ox + 47, oy + 29);
            if (relief) {
                // a second, finer warp: the fringe of bays and capes
                wx += warp * 0.22 * detail * wrapped(x, y, f * 5, 3, ox + 61, oy + 17);
                wy += warp * 0.22 * detail * wrapped(x, y, f * 5, 3, ox + 83, oy + 41);
            }
            let best = 0, second = 0, bi = -1, si = -1;
            if (relief) {
                byId.fill(0);
                for (const c of cont) { const b = pull(wx, wy, c); if (b > byId[c.id]) byId[c.id] = b; }
                for (let i = 0; i < seeds.length; i++) {
                    const b = byId[i];
                    if (b > best) { second = best; si = bi; best = b; bi = i; } else if (b > second) { second = b; si = i; }
                }
            } else {
                for (const c of cont) {
                    const b = pull(wx, wy, c);
                    if (b > best) { second = best; best = b; } else if (b > second) second = b;
                }
            }
            return { x, y, wx, wy, best, second, bi, si };
        };
        if (relief) {
            const uplift14 = Terrain._plates({ width, height, rng, radius, count, wrapped, f, ox, oy, sharp: true, foothills: true });
            return {
                /** -> [the land's shape (for the sea level), its relief (for its heights)] */
                sample(q, r) {
                    const { x, y, wx, wy, best, second, bi, si } = sample(q, r);
                    let isle = 0;
                    for (const c of isles) { const b = pull(wx, wy, c); if (b > isle) isle = b; }
                    // (a strait only where two continents truly come near each other, so a lone coast
                    // is not cut along a straight line where two far-off pulls happen to be equal)
                    // (and its line bent well off the straight: the sea between two lands winds)
                    const ragged = wrapped(x, y, f * 1.8, 3, ox + 130, oy + 150) * 1.1 + wrapped(x, y, f * 5, 2, ox + 140, oy + 160) * 0.2;
                    // (signed by which of the two it is, so the noise moves the line itself, not
                    // only its width: a winding sound, not a ruled canal)
                    const lead = bi < si ? best - second : second - best;
                    // (and only at the two lands' margins: where they overlap deep they have grown
                    // into one, and a strait there would be a canal through the heart of it)
                    const margin = Utils.clamp((second - 0.08) / 0.12, 0, 1) * (1 - Utils.clamp((second - 0.32) / 0.14, 0, 1));
                    const strait = Utils.clamp(1 - Math.abs(lead + ragged) / 0.16, 0, 1) * margin;
                    const broad = wrapped(x, y, f, terrainOctaves, ox, oy);
                    const fringe = wrapped(x, y, f * 6, 3, ox + 171, oy + 191) * 0.07 * detail;
                    const polar = Math.abs((r / height) - 0.5) * 2;
                    const [up, foot] = uplift14(wx, wy, x, y);
                    const core = Math.min(best, 0.5) / 0.5;
                    // (islands rise from the sea floor: they stand clear of the broad noise's dips)
                    const land = Math.max(core * 0.5 + broad * 0.24 - strait * 0.26, isle * 0.62 - 0.08)
                        + up * 0.12 * mountainDensity + fringe - Math.pow(polar, 4) * (0.2 + polarFactor);
                    // the relief: ranges on the seams, foothills about them, and a rolling country of
                    // scattered hills between (higher a little inland, lower by the sea)
                    const rolls = wrapped(x, y, f * 5.5, 2, ox + 241, oy + 263);
                    const knolls = Math.max(0, rolls) * Math.max(0, rolls);
                    // (the crest sharpened, so only the highest crags of a range carry snow)
                    const peaks = 0.45 + 0.55 * Math.abs(wrapped(x, y, f * 13, 2, ox + 307, oy + 331));
                    const rel = Math.pow(Math.max(0, up), 1.6) * (0.7 + 0.6 * peaks) * mountainDensity + Math.min(0, up) + foot * 0.45 + knolls * 0.55 + core * 0.12 + broad * 0.08;
                    return [land, rel];
                },
                height(q, r) { return this.sample(q, r)[0]; },
            };
        }
        return {
            height(q, r) {
                const { x, y, wx, wy, best, second } = sample(q, r);
                // (a sea between two continents where their pulls meet, so they stay apart)
                const ragged = wrapped(x, y, f * 4, 3, ox + 130, oy + 150) * 0.12;
                const strait = second > 0.05 ? Utils.clamp(1 - (best - second + ragged) / 0.16, 0, 1) : 0;
                const broad = wrapped(x, y, f, terrainOctaves, ox, oy);           // -1..1
                let ridge = 1 - Math.abs(wrapped(x, y, f * 3, 4, ox + 90, oy + 70));
                ridge = Math.pow(ridge, 3) * mountainDensity;
                const polar = Math.abs((r / height) - 0.5) * 2;
                if (uplift) {
                    // ranges along the plates' seams take the place of most of the scattered ridges
                    const up = uplift(wx, wy, x, y) * mountainDensity;
                    // (the heart of a continent is land, not a mountain: its pull levels off inland,
                    // so the heights come from the ranges and the broad roll of the land)
                    const core = Math.min(best, 0.5) / 0.5;
                    return core * 0.42 + broad * 0.26 + ridge * 0.04 + up * 0.4 - strait * 0.3 - Math.pow(polar, 3) * (0.25 + polarFactor);
                }
                return best * 0.62 + broad * 0.3 + ridge * 0.12 - strait * 0.3 - Math.pow(polar, 3) * (0.25 + polarFactor);
            },
        };
    },

    /**
     * Tectonic plates (worlds since terrainGen 12): a few more plates than
     * continents, each drifting its own way. Where two plates press together
     * the land is pushed up into a long range along their seam (where they
     * pull apart, a little lower: rifts); a ragged ridge noise breaks each
     * range into peaks and passes. -> uplift(x, y, wx, wy) in about 0..1, for
     * the land field (Terrain._land11), on the warped grid coordinates.
     */
    _plates({ width, height, rng, radius, count, wrapped, f, ox, oy, sharp = false, foothills = false }) {
        const W = width;
        const n = Math.max(4, count * 2 + 2);
        const plates = [];
        for (let i = 0; i < n; i++) {
            const a = rng() * Math.PI * 2;
            plates.push({ x: rng() * W, y: (0.1 + rng() * 0.8) * height * 0.866, vx: Math.cos(a), vy: Math.sin(a) });
        }
        // (since terrainGen 13 the ranges are narrower and more broken: chains, not massifs)
        const seamW = sharp ? Math.max(1.2, radius * 0.065) : Math.max(1.6, radius * 0.11);
        return (wx, wy, x, y) => {
            let a = null, b = null, da = Infinity, db = Infinity;
            for (const p of plates) {
                let dx = Math.abs(wx - p.x);
                dx = Math.min(dx, W - dx);
                const d = Math.hypot(dx, wy - p.y);
                if (d < da) { db = da; b = a; da = d; a = p; } else if (d < db) { db = d; b = p; }
            }
            if (!a || !b) return foothills ? [0, 0] : 0;
            // how far from the seam (the bisector between the two nearest plates)
            const seam = (db - da) / 2;
            if (foothills) {
                // (since terrainGen 14) -> [the range, its foothills: a broader, lower skirt of
                // hills either side, rough with knolls]
                if (seam > seamW * 6) return [0, 0];
                let nx = b.x - a.x;
                if (Math.abs(nx) > W / 2) nx -= Math.sign(nx) * W;
                const ny = b.y - a.y;
                const len = Math.hypot(nx, ny) || 1;
                const press = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) / len;
                if (press <= 0) return [Math.exp(-(seam * seam) / (2 * seamW * seamW)) * press * 0.15, 0];
                const p = Utils.clamp(press / 1.2, 0, 1);
                const cragN = 1 - Math.abs(wrapped(x, y, f * 9, 3, ox + 210, oy + 230));
                const near = Math.exp(-(seam * seam) / (2 * seamW * seamW));
                const wide = Math.exp(-(seam * seam) / (2 * 9 * seamW * seamW));
                return [near * p * (0.35 + 0.65 * cragN * cragN), wide * p * (0.4 + 0.6 * cragN)];
            }
            if (seam > seamW * 3) return 0;
            // press: the plates' drift against each other, across the seam
            let nx = b.x - a.x;
            if (Math.abs(nx) > W / 2) nx -= Math.sign(nx) * W;
            const ny = b.y - a.y;
            const len = Math.hypot(nx, ny) || 1;
            const press = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) / len;   // -2..2: + colliding
            const near = Math.exp(-(seam * seam) / (2 * seamW * seamW));
            const cragN = 1 - Math.abs(wrapped(x, y, f * (sharp ? 9 : 6), 3, ox + 210, oy + 230));
            const crags = sharp ? 0.35 + 0.65 * cragN * cragN : 0.55 + 0.45 * cragN;
            return press > 0 ? near * Utils.clamp(press / 1.2, 0, 1) * crags : near * press * 0.15;
        };
    },

    /**
     * The climate of worlds since terrainGen 12, on the finished heights:
     *  - it is colder the higher the land (a lapse with height above the sea);
     *  - rain comes off the sea on the prevailing winds (trade winds from the
     *    east in the tropics, westerlies from the west in the middle
     *    latitudes, easterlies again near the poles): the air takes up water
     *    over the sea and lets it fall over the land, most where the land
     *    rises, so the windward side of a range is wet and the lee lies in
     *    its rain shadow, and the heart of a great continent is dry;
     *  - a little of the old noise stays, so it is not all bands.
     * Writes tile.temperature and tile.moisture (0..1).
     */
    _climate12(tiles, width, height, { waterThreshold, rainBias = 0, desertBelts = false, desertFactor = 1, wideBelts = false }) {
        const rain = new Float64Array(width * height);
        // (rain carries further inland on a bigger map, so a big continent is not all dry: the
        // air lets fall a share of its water per hex by the map's scale)
        const scale = Math.sqrt((120 * 80) / Math.max(1, width * height));
        const base = 0.07 * Utils.clamp(scale, 0.35, 1.5);
        // one row's rain with the wind blowing east (dir 1) or west (-1)
        const sweep = (r, dir, out, weight) => {
            const row = tiles[r];
            let air = 0.6;
            // two laps round the world, so the air reaching the first coast has crossed the sea
            for (let lap = 0; lap < 2; lap++) {
                let prevE = waterThreshold;
                for (let s2 = 0; s2 < width; s2++) {
                    const q = dir > 0 ? s2 : width - 1 - s2;
                    const e = row[q].elevation;
                    if (e < waterThreshold) {
                        air = Math.min(1, air + 0.12);
                        prevE = waterThreshold;
                        continue;
                    }
                    const rise = Math.max(0, e - prevE);
                    const fall = Utils.clamp(base + rise * 4.5, 0, 0.65) * air;
                    air = Math.max(0, air - fall) + fall * 0.25;  // (some taken up again from the wet land)
                    if (lap === 1) out[r * width + q] += fall * weight;
                    prevE = e;
                }
            }
        };
        const smooth = (a, b, x) => { const t = Utils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
        for (let r = 0; r < height; r++) {
            const lat = Math.abs((r / Math.max(1, height - 1)) - 0.5) * 2;   // 0 equator .. 1 pole
            // the westerlies of the middle latitudes, fading into the easterlies either side
            const west = smooth(0.22, 0.42, lat) * (1 - smooth(0.62, 0.82, lat));
            if (west > 0.001) sweep(r, 1, rain, west);
            if (west < 0.999) sweep(r, -1, rain, 1 - west);
        }
        // spread a little between rows (the wind is not a ruler)
        const sm = new Float64Array(rain.length);
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                let sum = 0, w = 0;
                for (let dr = -2; dr <= 2; dr++) {
                    const rr = r + dr;
                    if (rr < 0 || rr >= height) continue;
                    for (let dq = -1; dq <= 1; dq++) {
                        const k = (dr === 0 ? 2 : 1) * (dq === 0 ? 2 : 1) / (1 + Math.abs(dr));
                        sum += rain[rr * width + Hex.wrapQ(q + dq, width)] * k;
                        w += k;
                    }
                }
                sm[r * width + q] = sum / w;
            }
        }
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const t = tiles[r][q];
                if (t.elevation < waterThreshold) continue;
                const wet = 1 - Math.exp(-sm[r * width + q] * 14 / Utils.clamp(scale, 0.35, 1.5));
                t.moisture = Utils.clamp(wet * 0.65 + t.moisture * 0.35 + rainBias, 0, 1);
                // colder with height (a hill a little, a mountain much)
                t.temperature = Utils.clamp(t.temperature - Math.max(0, t.elevation - waterThreshold) * 0.45, 0, 1);
                if (desertBelts) {
                    // (since terrainGen 13) the subtropical dry belts, where the air that rose at the
                    // equator comes down dry, about a third of the way to the poles: hot and parched,
                    // the great deserts, worst inland and in the lee (the Desert setting widens them)
                    // (the belt wanders north and south and comes and goes along its length,
                    // and a wet coast or a well-watered country keeps it off)
                    const tq = q / width;
                    const wob = (sx, sy, fr) => {
                        const a1 = Utils.fbm(q * fr + sx, r * fr + sy, 3, 2.0, 0.5);
                        const a2 = Utils.fbm((q - width) * fr + sx, r * fr + sy, 3, 2.0, 0.5);
                        return a1 * (1 - tq) + a2 * tq;
                    };
                    const fr = 6 / Math.max(40, width);
                    // (since terrainGen 14 it wanders further, with a finer kink, so it is no stripe)
                    const lat = Math.abs((r / Math.max(1, height - 1)) - 0.5) * 2
                        + (wideBelts ? wob(311, 97, fr) * 0.2 + wob(401, 157, fr * 2.5) * 0.07 : wob(311, 97, fr) * 0.12);
                    const patch = Utils.clamp(0.75 + wob(517, 233, fr * 1.6) * 1.2, 0, 1.4);
                    const belt = Math.exp(-Math.pow((lat - 0.3) / 0.11, 2)) * patch * Utils.clamp(desertFactor, 0, 3);
                    if (belt > 0.02) {
                        const dry = Utils.clamp(belt * (1.35 - t.moisture * 1.0), 0, 1);
                        t.moisture = Utils.clamp(t.moisture * (1 - 0.88 * dry), 0, 1);
                        t.temperature = Utils.clamp(t.temperature + 0.36 * dry, 0, 1);
                    }
                }
            }
        }
    },

    /** Worlds since terrainGen 12: land by a river or lake is greener (it waters the country beside it) */
    _riverbanks12(tiles, width, height) {
        const wet = [];
        for (const row of tiles) for (const t of row) if (t.hasRiver || t._lake) wet.push(t);
        for (const t of wet) {
            if (t.hasRiver) t.moisture = Utils.clamp((t.moisture ?? 0.5) + 0.18, 0, 1);
            for (const n of Hex.neighbors(t.q, t.r)) {
                if (n.r < 0 || n.r >= height) continue;
                const nt = tiles[n.r][Hex.wrapQ(n.q, width)];
                if (!nt._lake) nt.moisture = Utils.clamp((nt.moisture ?? 0.5) + 0.1, 0, 1);
            }
        }
    },

    /**
     * Set the sea level of a terrainGen 11 world: the raw heights are ranked,
     * the sea fills the lowest (100 - landMass)% (deeper further from the
     * shore), and the land's heights are spread from the water level to the
     * peaks by rank, shaped by flatness and hill density, so a world has about
     * as much lowland, hill and mountain whatever its size or land share.
     */
    _seaLevel11(tiles, width, height, { landMass, waterThreshold, hillsLevel, highlandsLevel, mountainLevel, snowPeakLevel, hillDensity, mountainDensity, flatnessPow, deepWaterLevel }) {
        const all = [];
        for (const row of tiles) for (const t of row) all.push(t);
        const sorted = all.map(t => t.elevation).sort((a, b) => a - b);
        const n = sorted.length;
        const seaShare = 1 - Utils.clamp(landMass, 5, 95) / 100;
        const cut = sorted[Math.min(n - 1, Math.floor(seaShare * n))];
        const lo = sorted[0];
        // rank of each land height among the land (0 at the shore, 1 the highest peak)
        const landVals = sorted.slice(Math.floor(seaShare * n));
        const rankOf = (v) => {
            let a = 0, b = landVals.length - 1;
            while (a < b) { const m = (a + b + 1) >> 1; if (landVals[m] <= v) a = m; else b = m - 1; }
            return landVals.length > 1 ? a / (landVals.length - 1) : 0;
        };
        // (the height a land rank stands at, by bands: most land low, then hills and highlands,
        // a fringe of mountains and a few snowy peaks; hill and mountain density widen or
        // narrow their bands, a flatter world lowers them all)
        const flat = Utils.clamp(1.1 / flatnessPow, 0.5, 1.5);
        // (worlds since terrainGen 14, ranked by relief, keep a little less upland: a smaller
        // skirt of hills and highlands about the ranges, the snow on the highest crags only)
        const r14 = all[0]._relief !== undefined;
        const share = {
            snow: (r14 ? 0.012 : 0.02) * mountainDensity * flat,
            mtn: 0.07 * mountainDensity * flat,
            high: (r14 ? 0.075 : 0.09) * hillDensity * flat,
            hill: (r14 ? 0.17 : 0.20) * hillDensity * flat,
        };
        const k4 = 1 - share.snow, k3 = k4 - share.mtn, k2 = k3 - share.high, k1 = Math.max(0.05, k2 - share.hill);
        const knots = [
            [0, waterThreshold + 0.005], [k1, hillsLevel], [k2, highlandsLevel], [k3, mountainLevel], [k4, snowPeakLevel], [1, 1],
        ];
        const bandHeight = (rk) => {
            for (let i = 1; i < knots.length; i++) {
                if (rk <= knots[i][0]) {
                    const [r0, e0] = knots[i - 1], [r1, e1] = knots[i];
                    return e0 + (e1 - e0) * ((rk - r0) / Math.max(1e-9, r1 - r0));
                }
            }
            return 1;
        };
        // (worlds since terrainGen 14 rank the land by its relief, not by how far inland it lies:
        // the mountains stand on the ranges, wherever on the continent they run, and the
        // heart of a continent can be a wide plain)
        let reliefRank = null;
        if (all[0]._relief !== undefined) {
            const land = all.filter(t => t.elevation >= cut);
            land.sort((a, b) => a._relief - b._relief);
            reliefRank = new Map();
            land.forEach((t, i) => reliefRank.set(t, land.length > 1 ? i / (land.length - 1) : 0));
        }
        for (const t of all) {
            const v = t.elevation;
            if (v < cut) {
                const k = (v - lo) / Math.max(1e-9, cut - lo);           // 0 deepest .. 1 the shore
                t.elevation = Utils.clamp(deepWaterLevel * 0.5 + (waterThreshold - 0.005 - deepWaterLevel * 0.5) * Math.pow(k, 0.7), 0, waterThreshold - 0.005);
            } else {
                t.elevation = Utils.clamp(bandHeight(reliefRank ? reliefRank.get(t) : rankOf(v)), 0, 1);
            }
            delete t._relief;
        }
    },

    /** Tuning for Terrain._passes16 (data/terrain.json passes; set by DataLoader) */
    PASSES: {},

    /**
     * Worlds since terrainGen 16: a long mountain range is a wall with gateways.
     * Run on the finished heights (after Terrain._seaLevel11), before the climate and
     * the rivers. Each range (a connected band of mountain/snow peak) long enough is
     * crossed by one to three passes where good lowland lies on both sides: each
     * follows the lowest saddle across (a search on height with a little jitter, so
     * it bends), its hexes set to highlands at the crest falling to hills at the
     * feet, its flanking peaks pulled down to bare mountain (the way must cross
     * the range's spine, not skirt its end). Pass hexes are marked `tile._pass`
     * (the pass's number). Returns (and keeps on Terrain._lastPasses16, for tests
     * and probes) { ranges: [{ id, size, length, crossings }], passes: [...] }.
     */
    _passes16(tiles, width, height, { rng, waterThreshold, hillsLevel, highlandsLevel, mountainLevel, snowPeakLevel }) {
        const c = {
            minRangeHexes: 14, minRangeLength: 10, hexesPerPass: 20, maxPerRange: 3, window: 8, strip: 3,
            minLowland: 25, spacing: 0.7, apart: 5, crest: 0.55, foot: 0.5, shoulder: 0.5, jitter: 1.5,
            ...(Terrain.PASSES || {}),
        };
        const N = width * height;
        const elev = new Float64Array(N);
        for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) elev[r * width + q] = tiles[r][q].elevation;
        const nbr = new Int32Array(N * 6).fill(-1);
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                Hex.neighbors(q, r).forEach((n, k) => {
                    if (n.r >= 0 && n.r < height) nbr[(r * width + q) * 6 + k] = n.r * width + Hex.wrapQ(n.q, width);
                });
            }
        }
        const jit = new Float64Array(N);
        for (let i = 0; i < N; i++) jit[i] = rng();
        const isMtn = i => elev[i] > mountainLevel;
        const isLow = i => elev[i] >= waterThreshold && elev[i] <= highlandsLevel;
        // (a hex's place on the plane: even rows sit half a hex east)
        const px = i => (i % width) + (((i / width) | 0) & 1 ? 0 : 0.5);
        const py = i => ((i / width) | 0) * 0.866;
        const dX = (a, b) => { let d = px(b) - px(a); if (d > width / 2) d -= width; if (d < -width / 2) d += width; return d; };
        // components of a kind of hex
        const comps = (test) => {
            const id = new Int32Array(N).fill(-1);
            const list = [];
            for (let s = 0; s < N; s++) {
                if (id[s] >= 0 || !test(s)) continue;
                const members = [s];
                id[s] = list.length;
                for (let p = 0; p < members.length; p++) {
                    for (let k = 0; k < 6; k++) {
                        const j = nbr[members[p] * 6 + k];
                        if (j >= 0 && id[j] < 0 && test(j)) { id[j] = list.length; members.push(j); }
                    }
                }
                list.push(members);
            }
            return { id, list };
        };
        const low = comps(isLow);
        const goodLow = i => low.id[i] >= 0 && low.list[low.id[i]].length >= c.minLowland;
        const ranges = comps(isMtn);
        // a walk through one range from s: distances and parents
        const walk = (s, rid) => {
            const dist = new Map([[s, 0]]);
            const par = new Map();
            const q = [s];
            let far = s;
            for (let p = 0; p < q.length; p++) {
                const i = q[p];
                if (dist.get(i) > dist.get(far)) far = i;
                for (let k = 0; k < 6; k++) {
                    const j = nbr[i * 6 + k];
                    if (j >= 0 && ranges.id[j] === rid && !dist.has(j)) { dist.set(j, dist.get(i) + 1); par.set(j, i); q.push(j); }
                }
            }
            return { far, par };
        };
        // what a step onto a hex costs the search for a saddle: the higher the dearer, a peak
        // dearest (with a little jitter, so the way bends like a notch, not a cut)
        const stepCost = (j) => {
            const e = elev[j];
            return isMtn(j)
                ? 3 + 60 * (e - mountainLevel) + (e > snowPeakLevel ? 4 : 0) + c.jitter * jit[j]
                : (e > highlandsLevel ? 1.6 : 1) + c.jitter * 0.3 * jit[j];
        };
        // the cheapest way across the range through spine[k], within a strip across it
        const cross = (spine, k) => {
            const S = spine.length - 1;
            const site = spine[k];
            const a = spine[Math.max(0, k - 3)], b = spine[Math.min(S, k + 3)];
            let tx = dX(a, b), ty = py(b) - py(a);
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl; ty /= tl;
            const sq = site % width, sr = (site / width) | 0;
            const inWin = new Map();   // hex → side (+1 / -1 / 0)
            for (const h of Hex.hexesInRange(sq, sr, c.window)) {
                if (h.r < 0 || h.r >= height) continue;
                const i = h.r * width + Hex.wrapQ(h.q, width);
                if (elev[i] < waterThreshold) continue;
                const ox = dX(site, i), oy = py(i) - py(site);
                if (Math.abs(ox * tx + oy * ty) > c.strip + 0.5) continue;
                const cr = tx * oy - ty * ox;
                inWin.set(i, cr > 0.5 ? 1 : cr < -0.5 ? -1 : 0);
            }
            const sources = [], targets = new Set();
            for (const [i, side] of inWin) {
                if (!goodLow(i)) continue;
                if (side > 0) sources.push(i);
                else if (side < 0) targets.add(i);
            }
            if (!sources.length || !targets.size) return null;
            // (cheapest ways in from either side; the pass is where they meet on the range's spine)
            const flood = (starts) => {
                const cost = new Map(), par = new Map();
                const heap = new MinHeap((x, y) => x[0] < y[0]);
                for (const s of starts) { cost.set(s, 0); heap.push([0, s]); }
                while (heap.size()) {
                    const [d, i] = heap.pop();
                    if (d > cost.get(i)) continue;
                    for (let n = 0; n < 6; n++) {
                        const j = nbr[i * 6 + n];
                        if (j < 0 || !inWin.has(j)) continue;
                        const nd = d + stepCost(j);
                        if (nd < (cost.has(j) ? cost.get(j) : Infinity)) { cost.set(j, nd); par.set(j, i); heap.push([nd, j]); }
                    }
                }
                return { cost, par };
            };
            const A = flood(sources), B = flood([...targets]);
            let mid = -1, best = Infinity;
            for (let m = Math.max(0, k - 1); m <= Math.min(S, k + 1); m++) {
                const i = spine[m];
                if (!A.cost.has(i) || !B.cost.has(i)) continue;
                const v = A.cost.get(i) + B.cost.get(i) - stepCost(i);
                if (v < best) { best = v; mid = i; }
            }
            if (mid < 0) return null;
            const trace = (F, i) => { const out = [i]; while (F.par.has(out[out.length - 1])) out.push(F.par.get(out[out.length - 1])); return out; };
            const path = trace(A, mid).reverse().concat(trace(B, mid).slice(1));
            let maxE = 0, bars = 0;
            for (const i of path) { maxE = Math.max(maxE, elev[i]); if (isMtn(i)) bars++; }
            return { k, path, maxE, bars, score: maxE + 0.004 * bars + 0.002 * path.length };
        };
        const crestLevel = highlandsLevel + (mountainLevel - highlandsLevel) * Utils.clamp(c.crest, 0, 0.95);
        const footLevel = hillsLevel + (highlandsLevel - hillsLevel) * Utils.clamp(c.foot, 0, 1);
        const at = i => ({ q: i % width, r: (i / width) | 0 });
        const info = { ranges: [], passes: [] };
        ranges.list.forEach((members, rid) => {
            if (members.length < c.minRangeHexes) return;
            const end1 = walk(members[0], rid).far;
            const { far: end2, par } = walk(end1, rid);
            const spine = [end2];
            while (par.has(spine[spine.length - 1])) spine.push(par.get(spine[spine.length - 1]));
            const S = spine.length - 1;
            if (S < c.minRangeLength) return;
            const want = Utils.clamp(Math.ceil(S / c.hexesPerPass), 1, c.maxPerRange);
            const margin = Math.min(4, Math.floor(S / 4));
            const cands = [];
            for (let k = margin; k <= S - margin; k += 2) {
                const x = cross(spine, k);
                if (x) cands.push(x);
            }
            cands.sort((x, y) => x.score - y.score);
            const gap = Math.max(3, (S / want) * c.spacing);
            const chosen = [];
            for (const x of cands) {
                if (chosen.length >= want) break;
                if (chosen.some(o => Math.abs(o.k - x.k) < gap)) continue;
                // (no pass runs beside another: their climbs lie apart hexes apart or more)
                const climb = x.path.filter(i => elev[i] > highlandsLevel);
                if (chosen.some(o => o.path.some(i => elev[i] > highlandsLevel
                    && climb.some(j => Hex.wrappingOffsetDistance(i % width, (i / width) | 0, j % width, (j / width) | 0, width) < c.apart)))) continue;
                chosen.push(x);
            }
            const range = { id: rid, size: members.length, length: S, want, sites: cands.length, crossings: [] };
            for (const x of chosen) {
                const p = x.path;
                const id = info.passes.length + 1;
                const pass = { id, range: rid, from: at(p[0]), to: at(p[p.length - 1]), path: p.map(at), hexes: [], saddle: x.maxE, crest: crestLevel };
                // the climb: from the first to the last hex above the highlands line
                let lo = 0, hi = p.length - 1;
                while (lo < hi && elev[p[lo]] <= highlandsLevel) lo++;
                while (hi > lo && elev[p[hi]] <= highlandsLevel) hi--;
                const seg = p.slice(lo, hi + 1);
                let top = 0;
                seg.forEach((i, n) => { if (elev[i] > elev[seg[top]]) top = n; });
                // (each foot stands a little above the land it climbs from, so no hollow holds water)
                const footA = Math.min(crestLevel - 0.01, Math.max(footLevel, (lo > 0 ? elev[p[lo - 1]] : footLevel) + 0.003));
                const footB = Math.min(crestLevel - 0.01, Math.max(footLevel, (hi < p.length - 1 ? elev[p[hi + 1]] : footLevel) + 0.003));
                const set = new Set(seg);
                seg.forEach((i, n) => {
                    const t = n <= top
                        ? (top === 0 ? 1 : n / top)
                        : (seg.length - 1 === top ? 1 : (seg.length - 1 - n) / (seg.length - 1 - top));
                    const foot = n <= top ? footA : footB;
                    elev[i] = foot + (crestLevel - foot) * t;
                    const tile = tiles[(i / width) | 0][i % width];
                    tile.elevation = elev[i];
                    tile._pass = id;
                    pass.hexes.push(at(i));
                });
                // the shoulders: the peaks either side come down to bare rock
                for (const i of seg) {
                    for (let n = 0; n < 6; n++) {
                        const j = nbr[i * 6 + n];
                        if (j < 0 || set.has(j) || !isMtn(j)) continue;
                        elev[j] = mountainLevel + 0.005 + (elev[j] - mountainLevel - 0.005) * (1 - Utils.clamp(c.shoulder, 0, 1));
                        tiles[(j / width) | 0][j % width].elevation = elev[j];
                    }
                }
                range.crossings.push(pass);
                info.passes.push(pass);
            }
            info.ranges.push(range);
        });
        Terrain._lastPasses16 = info;
        return info;
    },


    /** Flood up to `count` low land hexes beside a new lake (not the river's own) */
    _expandLake(tiles, width, height, lake, count, waterLevel, lakeLevel, keep) {
        let expanded = 0;
        for (const ln of Hex.neighbors(lake.q, lake.r)) {
            if (expanded >= count) break;
            if (ln.r < 0 || ln.r >= height) continue;
            const lt = tiles[ln.r][Hex.wrapQ(ln.q, width)];
            if (keep && (lt.hasRiver || keep.has(lt))) continue;
            if (lt.elevation >= waterLevel && lt.elevation < 0.6) {
                lt.elevation = lakeLevel;
                expanded++;
            }
        }
    },

    /**
     * How rivers end, in worlds since terrainGen 15. A river reaches the sea or
     * a lake, except that a small one (fed by fewer than RIVER_END.bigRiver
     * river hexes) running RIVER_END.aridRun hexes or more through arid
     * country (desert, or dry savanna and plains) sinks into the sand there:
     * the course below is let go, down to where another river joins it. Any
     * river still ending on land (its next hex neither water nor river) ends
     * in a lake: the hex it runs into becomes one, unless that course ran
     * through dry country for a while, where a river may well die out.
     */
    RIVER_END: { aridRun: 5, bigRiver: 25, dryMoisture: 0.3 },

    _riverEnds15(tiles, width, height, { waterThreshold = 0.42 } = {}) {
        const C = Terrain.RIVER_END;
        const WATER = new Set(Terrain.WATER_IDS);
        const at = (q, r) => (r < 0 || r >= height) ? null : tiles[r][Hex.wrapQ(q, width)];
        const down = (t) => {
            if (!t.hasRiver || !Number.isInteger(t.riverDir) || t.riverDir < 0) return null;
            const n = Hex.neighbors(t.q, t.r)[t.riverDir];
            return at(n.q, n.r);
        };
        const dryLand = (t) => t && t.terrain && (t.terrain.id === 'desert'
            || (['savanna', 'plains', 'tundra'].includes(t.terrain.id) && (t.moisture ?? 0.5) < C.dryMoisture));
        // (the country a river runs through: its own banks are kept green by it, so judge by
        // the land on either side: half or more of it dry)
        const arid = (t) => {
            let dry = 0, land = 0;
            for (const n of Hex.neighbors(t.q, t.r)) {
                const o = at(n.q, n.r);
                if (!o || o.hasRiver || WATER.has(o.terrain.id)) continue;
                land++;
                if (dryLand(o)) dry++;
            }
            return dryLand(t) || (land >= 2 && dry * 2 >= land);
        };
        // river hexes in order from the springs down, and how many river hexes feed each
        const rivers = [];
        const into = new Map();
        for (const row of tiles) for (const t of row) {
            if (!t.hasRiver) continue;
            rivers.push(t);
            const d = down(t);
            if (d && d.hasRiver) into.set(d, (into.get(d) || 0) + 1);
        }
        const feed = new Map();
        const indeg = new Map(into);
        const queue = rivers.filter(t => !indeg.get(t));
        for (let k = 0; k < queue.length; k++) {
            const t = queue[k];
            const f = (feed.get(t) || 0) + 1;
            feed.set(t, f);
            const d = down(t);
            if (d && d.hasRiver) {
                feed.set(d, (feed.get(d) || 0) + f);
                indeg.set(d, indeg.get(d) - 1);
                if (!indeg.get(d)) queue.push(d);
            }
        }
        // the run of dry country each river hex has come through (from its spring down)
        const dryRun = new Map();
        const ended = new Set();
        for (const t of queue) {
            if (ended.has(t)) continue;
            const run = arid(t) ? (dryRun.get(t) || 0) + 1 : 0;
            dryRun.set(t, run);
            const d = down(t);
            if (run >= C.aridRun && (feed.get(t) || 0) < C.bigRiver && d && d.hasRiver && !WATER.has(d.terrain.id)) {
                // it sinks here: the course below is let go until another river joins it
                let c = d;
                while (c && c.hasRiver && !WATER.has(c.terrain.id) && (into.get(c) || 0) <= 1) {
                    const next = down(c);
                    c.hasRiver = false;
                    c.riverSource = false;
                    delete c.riverDir;
                    ended.add(c);
                    c = next;
                }
                // (a tributary still joining below now rises where the dry river would have met it)
                if (c && c.hasRiver && (into.get(c) || 0) > 1) into.set(c, into.get(c) - 1);
                continue;
            }
            if (d && d.hasRiver && run > (dryRun.get(d) || 0)) dryRun.set(d, run);
        }
        // a river still ending on land ends in a lake, unless it dried out in the desert
        for (const t of rivers) {
            if (!t.hasRiver) continue;
            const d = down(t);
            if (!d || d.hasRiver || WATER.has(d.terrain.id)) continue;
            if ((dryRun.get(t) || 0) >= C.aridRun) continue;
            if (d.settlement) continue;
            d.elevation = waterThreshold - 0.04;
            d._lake = true;
            d.waterBodyType = 'lake';
            d.resource = null;
            d.terrain = Terrain.classifyTerrain(d);
        }
        // (a hex left with a river but nothing upstream is a spring now)
        const fed = new Set();
        for (const t of rivers) if (t.hasRiver) { const d = down(t); if (d && d.hasRiver) fed.add(d); }
        for (const t of rivers) if (t.hasRiver && !fed.has(t) && !t.riverSource) {
            const fromLake = Hex.neighbors(t.q, t.r).some(n => { const o = at(n.q, n.r); return o && o._lake; });
            if (!fromLake) t.riverSource = true;
        }
    },

    // ── Coasts with character (worlds since terrainGen 16) ─────────────
    /** Tunables (data/terrain.json coasts, see _coasts there); these are the fallbacks */
    COASTS: {
        fjords: { perMap: 6, minLength: 3, maxLength: 8, minLatitude: 0.55, maxTemp: 0.4, highFlanks: 2, spacing: 7, depth: 0.012, tries: 40 },
        beaches: { minTemp: 0.42, maxRise: 0.03, seedChance: 0.14, runMin: 2, runMax: 6, notOn: ['swamp', 'ice', 'snow', 'tundra', 'desert'] },
        skerries: { chance: 0.05, nearFjord: 0.25, reach: 2, rocky: ['hills', 'highlands', 'mountain', 'snow_peak'] },
    },

    /** The coasts tuning: data/terrain.json coasts over the fallbacks above */
    _coastCfg() {
        const d = Terrain.COASTS_DATA || {};
        const C = Terrain.COASTS;
        return {
            fjords: { ...C.fjords, ...(d.fjords || {}) },
            beaches: { ...C.beaches, ...(d.beaches || {}) },
            skerries: { ...C.skerries, ...(d.skerries || {}) },
        };
    },

    /**
     * Fjords (worlds since terrainGen 16), cut before the water bodies are
     * classified. On cold coasts far from the equator, where hills or
     * mountains meet the open sea, a few narrow winding inlets (3-8 hexes)
     * run inland from the sea, each hex flanked by high ground. An inlet only
     * ever widens the sea it opens off (each new hex touches no water but the
     * hex before it, so it never reaches another sea or a lake), never runs
     * over a river or a lake, and is dropped if it would leave any land cut
     * off. The water is set just under sea level so it classes as the
     * coastal waters ships sail. Marks each fjord hex tile._fjord; returns
     * how many fjords were cut.
     */
    _fjords16(tiles, width, height, rng, { waterThreshold = 0.42, hillsLevel = 0.52 } = {}) {
        const C = Terrain._coastCfg().fjords;
        const N = width * height;
        const WL = Math.min(waterThreshold, 0.42);          // (classifyWaterBodies' own level)
        const idx = (q, r) => r * width + q;
        const at = (q, r) => (r < 0 || r >= height) ? null : tiles[r][Hex.wrapQ(q, width)];
        const nbrs = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r)).filter(Boolean);
        const isWater = (t) => t.elevation < WL;
        const lat = (r) => Math.abs((r / Math.max(1, height - 1)) - 0.5) * 2;
        // the open sea: water bodies of more than 15 hexes that are not lakes
        const body = new Int32Array(N).fill(-1);
        const open = [];
        for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) {
            const s = tiles[r][q];
            if (!isWater(s) || body[idx(q, r)] >= 0) continue;
            const id = open.length;
            const group = [s];
            body[idx(q, r)] = id;
            for (let k = 0; k < group.length; k++) {
                for (const o of nbrs(group[k])) {
                    if (isWater(o) && body[idx(o.q, o.r)] < 0) { body[idx(o.q, o.r)] = id; group.push(o); }
                }
            }
            open.push(group.length > 15 && !group.every(t => t._lake));
        }
        const isSea = (t) => isWater(t) && !t._lake && open[body[idx(t.q, t.r)]];
        // how far inland each land hex lies (hexes from the nearest water)
        const depth = new Int32Array(N).fill(-1);
        const queue = [];
        for (const row of tiles) for (const t of row) if (isWater(t)) { depth[idx(t.q, t.r)] = 0; queue.push(t); }
        for (let k = 0; k < queue.length; k++) {
            const t = queue[k];
            for (const o of nbrs(t)) if (depth[idx(o.q, o.r)] < 0) { depth[idx(o.q, o.r)] = depth[idx(t.q, t.r)] + 1; queue.push(o); }
        }
        const high = (t) => t && !isWater(t) && t.elevation >= hillsLevel;
        const cold = (t) => lat(t.r) >= C.minLatitude && (t.temperature ?? 0.5) <= C.maxTemp;
        const carvable = (t) => t && !isWater(t) && !t.hasRiver && !t._lake && !t.settlement && !t._pass
            && !nbrs(t).some(o => o._lake);
        // mouths: open sea beside cold high ground
        const mouths = [];
        for (const row of tiles) for (const t of row) {
            if (!isSea(t)) continue;
            if (nbrs(t).some(o => high(o) && cold(o) && carvable(o))) mouths.push(t);
        }
        for (let i = mouths.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [mouths[i], mouths[j]] = [mouths[j], mouths[i]]; }
        const scale = Math.sqrt(N / (120 * 80));
        const target = Math.max(0, Math.round(C.perMap * scale));
        const spacing = C.spacing * Math.max(0.6, scale);
        const made = [];
        // would carving these hexes leave any land hex cut off from the rest?
        const cutsLand = (path) => {
            const inPath = new Set(path);
            const flank = new Set();
            for (const p of path) for (const o of nbrs(p)) if (!isWater(o) && !inPath.has(o)) flank.add(o);
            if (!flank.size) return true;
            const start = flank.values().next().value;
            const seen = new Set([start]);
            const reached = [start];
            let found = 1;
            for (let k = 0; k < reached.length && found < flank.size && k < 6000; k++) {
                for (const o of nbrs(reached[k])) {
                    if (isWater(o) || inPath.has(o) || seen.has(o)) continue;
                    seen.add(o);
                    reached.push(o);
                    if (flank.has(o)) found++;
                }
            }
            return found < flank.size;
        };
        for (let m = 0; m < mouths.length && made.length < target && m < target * C.tries; m++) {
            const mouth = mouths[m];
            if (made.some(f => Hex.wrappingDistance(f.q, f.r, mouth.q, mouth.r, width) < spacing)) continue;
            const want = C.minLength + Math.floor(rng() * (C.maxLength - C.minLength + 1));
            const path = [];
            const inPath = new Set();
            let prev = mouth, dir = -1;
            for (let step = 0; step < want; step++) {
                const ring = Hex.neighbors(prev.q, prev.r);
                let best = null, bestScore = -Infinity, bestDir = -1;
                for (let d = 0; d < 6; d++) {
                    const n = at(ring[d].q, ring[d].r);
                    if (!carvable(n) || inPath.has(n) || !cold(n)) continue;
                    // (inland, never along the shore or back)
                    if (step > 0 && depth[idx(n.q, n.r)] < depth[idx(prev.q, prev.r)]) continue;
                    // (straight on or a turn of 60 degrees, so it touches only the hex before it)
                    if (dir >= 0 && d !== dir && d !== (dir + 1) % 6 && d !== (dir + 5) % 6) continue;
                    // (it touches no water but the inlet itself, and the open sea only at the mouth)
                    const touch = nbrs(n).filter(o => isWater(o) || inPath.has(o));
                    if (step === 0 ? touch.some(o => !isSea(o)) : touch.some(o => o !== prev)) continue;
                    // (between high ground)
                    const highFlanks = nbrs(n).filter(o => o !== prev && !inPath.has(o) && high(o)).length;
                    if (highFlanks < C.highFlanks) continue;
                    const score = highFlanks + (d === dir ? 0.5 : 0) + depth[idx(n.q, n.r)] * 0.3 + rng() * 2;
                    if (score > bestScore) { bestScore = score; best = n; bestDir = d; }
                }
                if (!best) break;
                path.push(best);
                inPath.add(best);
                prev = best;
                dir = bestDir;
            }
            if (path.length < C.minLength || cutsLand(path)) continue;
            for (const t of path) {
                t.elevation = WL - C.depth;
                t._fjord = true;
                t.hasRiver = false;
                t.riverSource = false;
                delete t.riverDir;
            }
            made.push(mouth);
        }
        return made.length;
    },

    /**
     * Beaches and skerries (worlds since terrainGen 16), once the terrain is
     * classed and the resources rolled.
     *  - A fjord hex the old islet roll made an island goes back under.
     *  - Beaches: low shore land (hardly above the sea) in warm and temperate
     *    country, with no hills behind it, becomes BEACH in short patchy runs
     *    along the shore; steep coasts (hills, highlands, mountains at the
     *    water) stay rocky.
     *  - Skerries: off rocky high coasts and fjord mouths, a few one-hex
     *    ISLAND islets on the shelf, a hex or two out, never touching the
     *    shore, a fjord, another islet or a river's mouth; each keeps the
     *    fishing ground its water had.
     * Returns { beaches, skerries } counts.
     */
    _shores16(tiles, width, height, rng, { waterThreshold = 0.42 } = {}) {
        const cfg = Terrain._coastCfg();
        const { beaches: B, skerries: S } = cfg;
        const T = Terrain.TYPES;
        const WATER = new Set(Terrain.WATER_IDS);
        const at = (q, r) => (r < 0 || r >= height) ? null : tiles[r][Hex.wrapQ(q, width)];
        const nbrs = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r)).filter(Boolean);
        const seaWater = (t) => t && WATER.has(t.terrain.id) && t.terrain.id !== 'lake' && t.waterBodyType !== 'lake';
        // fjords stay open water
        for (const row of tiles) for (const t of row) {
            if (t._fjord && t.terrain.id === 'island') {
                t.elevation = Math.min(waterThreshold, 0.42) - cfg.fjords.depth;
                t.terrain = Terrain.classifyTerrain(t);
                t.resource = null;
            }
        }
        // beaches, in runs along the shore
        const notOn = new Set(B.notOn || []);
        const hillsLvl = (Terrain._currentThresholds || {}).hillsLevel || 0.52;
        const beachable = (t) => t && t.terrain.passable && !WATER.has(t.terrain.id) && t.terrain.id !== 'island'
            && t.terrain.id !== 'beach' && !notOn.has(t.terrain.id) && !t.hasRiver && !t.settlement && !t._lake
            && t.elevation < hillsLvl && t.elevation - waterThreshold <= B.maxRise && (t.temperature ?? 0.5) >= B.minTemp
            && nbrs(t).some(seaWater) && !nbrs(t).some(o => !WATER.has(o.terrain.id) && o.elevation >= hillsLvl);
        const cand = [];
        for (const row of tiles) for (const t of row) if (beachable(t)) cand.push(t);
        let beaches = 0;
        const used = new Set();
        for (const t of cand) {
            if (used.has(t) || rng() >= B.seedChance) continue;
            const len = B.runMin + Math.floor(rng() * (B.runMax - B.runMin + 1));
            const run = [t];
            used.add(t);
            for (let k = 0; k < run.length && run.length < len; k++) {
                for (const o of nbrs(run[k])) {
                    if (run.length >= len) break;
                    if (!used.has(o) && beachable(o)) { used.add(o); run.push(o); }
                }
            }
            for (const b of run) { b.terrain = T.BEACH; b.resource = null; beaches++; }
        }
        // skerries off the rocky coasts
        const rocky = new Set(S.rocky || []);
        const reach = Math.max(1, S.reach | 0);
        const near = (t, test) => {
            for (let dr = -reach; dr <= reach; dr++) for (let dq = -reach - 1; dq <= reach + 1; dq++) {
                const o = at(t.q + dq, t.r + dr);
                if (o && Hex.wrappingDistance(t.q, t.r, o.q, o.r, width) <= reach && test(o)) return true;
            }
            return false;
        };
        let skerries = 0;
        for (const row of tiles) for (const t of row) {
            if (!(t.terrain.id === 'coast' || t.terrain.id === 'ocean') || t.waterBodyType === 'lake' || t._fjord) continue;
            const ns = Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r));
            // (open water all round: no shore, islet or fjord beside it, no river running in)
            if (ns.some(o => !o || !WATER.has(o.terrain.id) || o._fjord || o.waterBodyType === 'lake')) continue;
            if (ns.some((o, i) => o.hasRiver && o.riverDir === (i + 3) % 6)) continue;
            if (!near(t, o => rocky.has(o.terrain.id))) continue;
            const chance = near(t, o => o._fjord) ? S.nearFjord : S.chance;
            if (rng() >= chance) continue;
            t.terrain = T.ISLAND;
            t.elevation = 0.45;
            t._skerry = true;
            if (t.resource && t.resource.id !== 'fish') t.resource = null;
            skerries++;
        }
        return { beaches, skerries };
    },
    /** Tunables for Terrain._wetlands16 (data/terrain.json wetlands overrides them) */
    WETLANDS_DEFAULTS: {
        on: ['grassland', 'plains', 'woodland', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'savanna', 'boreal_forest', 'tundra', 'beach'],
        lowBand: 0.03, waterBand: 0.015, minMoisture: 0.62, wetBonus: 0.08,
        minTemp: 0.3, coldTemp: 0.38, coldPenalty: 0.35,
        patchesPerLand: 0.004, patchSpacing: 4, patchMin: 3, patchMax: 7, grow: 1.5,
        riverBonus: 0.15, lakeBonus: 0.2, seaBonus: 0.1, lowPenalty: 0.25, jitter: 0.15,
        rainfall: { arid: 0.05, dry: 0.4, normal: 1, wet: 1.6, tropical: 2.2 },
        delta: { minFeed: 18, maxDeltas: 4, spacing: 8, maxRise: 0.06, fan: 3, branch: true },
    },

    /**
     * Wetlands, in worlds since terrainGen 16 (data/terrain.json wetlands,
     * documented there under _wetlands). Runs once the rivers are final.
     * 1. Marshes: patches of a few hexes on flat, low, wet ground, likeliest
     *    along lowland rivers, at lake margins and by river mouths.
     * 2. Deltas: the mouths of the few greatest rivers that reach the sea
     *    across a flat coast fan out into marsh, and where it fits the river
     *    splits above the sea into a second channel: the hex where it splits
     *    keeps its riverDir and gains tile.riverBranch (the direction of the
     *    distributary hex), which itself flows straight to the sea.
     * Hexes turned to marsh roll their resource again (marsh: fish; no mines).
     */
    _wetlands16(tiles, width, height, ctx = {}) {
        const C = { ...Terrain.WETLANDS_DEFAULTS, ...(Terrain.WETLANDS || {}) };
        const D = { ...Terrain.WETLANDS_DEFAULTS.delta, ...(C.delta || {}) };
        const SWAMP = Terrain.TYPES.SWAMP;
        if (!SWAMP) return { marsh: 0, deltas: [] };
        const rng = ctx.rng || (() => Utils.random());
        const wt = ctx.waterThreshold ?? 0.42;
        const WATER = new Set(Terrain.WATER_IDS);
        const SEA = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
        const ON = new Set(C.on || []);
        const at = (q, r) => (r < 0 || r >= height) ? null : tiles[r][Hex.wrapQ(q, width)];
        const nbrs = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r));
        const isWater = (t) => !!(t && t.terrain && WATER.has(t.terrain.id));
        const isSea = (t) => !!(t && t.terrain && SEA.has(t.terrain.id) && !t._lake);
        const down = (t) => (t.hasRiver && Number.isInteger(t.riverDir) && t.riverDir >= 0) ? nbrs(t)[t.riverDir] : null;
        const rerollResource = (t) => {
            t.resource = ctx.minerals
                ? Terrain.rollResource15(t, ctx.minerals, ctx.resMultiplier ?? 1, ctx.strategicMultiplier ?? 1)
                : Terrain.rollResource(t.terrain.id, t.q, t.r, ctx.resMultiplier ?? 1, ctx.strategicMultiplier ?? 1);
        };
        const toMarsh = (t) => {
            if (t.terrain && t.terrain.id === 'swamp') return false;
            t.terrain = SWAMP;
            rerollResource(t);
            return true;
        };

        // ---- 1. marsh patches ----
        // what lies beside each land hex: a river, a lake, the sea at a river's mouth
        const near = new Map();
        let land = 0;
        for (const row of tiles) for (const t of row) {
            if (!t.terrain || !t.terrain.passable || isWater(t)) continue;
            land++;
            const ns = nbrs(t);
            near.set(t, {
                river: t.hasRiver || ns.some(n => n && n.hasRiver),
                lake: ns.some(n => n && (n._lake || (n.terrain && n.terrain.id === 'lake'))),
                mouth: !!(t.hasRiver && isSea(down(t))) || ns.some(n => n && n.hasRiver && isSea(down(n))),
                sea: ns.some(isSea),
            });
        }
        // eligibility: k widens the bands (1 for a seed, C.grow for a patch growing out)
        const score = (t, k = 1) => {
            if (!t || !ON.has(t.terrain && t.terrain.id) || t.settlement) return -Infinity;
            const nb = near.get(t);
            if (!nb) return -Infinity;
            const watered = nb.river || nb.lake || nb.sea;
            const rise = (t.elevation ?? 0.5) - wt;
            if (rise < 0 || rise > (C.lowBand + (watered ? C.waterBand : 0)) * k) return -Infinity;
            const m = t.moisture ?? 0.5;
            if (m < C.minMoisture - (nb.river || nb.lake ? C.wetBonus : 0) - (k - 1) * 0.05) return -Infinity;
            const temp = t.temperature ?? 0.5;
            if (temp < C.minTemp) return -Infinity;
            let s = m + (t.hasRiver ? C.riverBonus : nb.river ? C.riverBonus * 0.5 : 0)
                + (nb.lake ? C.lakeBonus : 0) + (nb.mouth ? C.seaBonus : 0)
                - (rise / Math.max(1e-6, C.lowBand)) * C.lowPenalty;
            if (temp < C.coldTemp) s -= C.coldPenalty;
            return s;
        };
        const cand = [];
        for (const t of near.keys()) {
            const s = score(t);
            if (s > -Infinity) cand.push({ t, s: s + rng() * C.jitter });
        }
        cand.sort((a, b) => b.s - a.s || a.t.r - b.t.r || a.t.q - b.t.q);
        const rainF = (C.rainfall || {})[ctx.rainfall || 'normal'] ?? 1;
        const want = Math.round(land * C.patchesPerLand * rainF);
        const seeds = [];
        let marsh = 0;
        for (const { t } of cand) {
            if (seeds.length >= want) break;
            if (t.terrain.id === 'swamp') continue;
            if (seeds.some(o => Hex.wrappingDistance(t.q, t.r, o.q, o.r, width) < C.patchSpacing)) continue;
            // grow the patch out over its best eligible neighbours
            const size = C.patchMin + Math.floor(rng() * (C.patchMax - C.patchMin + 1));
            const patch = [t];
            const inPatch = new Set(patch);
            while (patch.length < size) {
                let best = null, bestS = -Infinity;
                for (const p of patch) for (const n of nbrs(p)) {
                    if (!n || inPatch.has(n) || n.terrain.id === 'swamp') continue;
                    const s = score(n, C.grow);
                    if (s > bestS) { bestS = s; best = n; }
                }
                if (!best) break;
                patch.push(best);
                inPatch.add(best);
            }
            if (patch.length < C.patchMin) continue;
            seeds.push(t);
            for (const p of patch) if (toMarsh(p)) marsh++;
        }

        // ---- 2. deltas ----
        const deltas = [];
        if (D.maxDeltas > 0) {
            // how many river hexes feed each (itself included), from the springs down
            const rivers = [];
            const indeg = new Map();
            for (const row of tiles) for (const t of row) {
                if (!t.hasRiver) continue;
                rivers.push(t);
                const d = down(t);
                if (d && d.hasRiver) indeg.set(d, (indeg.get(d) || 0) + 1);
            }
            const feed = new Map();
            const queue = rivers.filter(t => !indeg.get(t));
            for (let k = 0; k < queue.length; k++) {
                const t = queue[k];
                const f = (feed.get(t) || 0) + 1;
                feed.set(t, f);
                const d = down(t);
                if (d && d.hasRiver) {
                    feed.set(d, (feed.get(d) || 0) + f);
                    indeg.set(d, indeg.get(d) - 1);
                    if (!indeg.get(d)) queue.push(d);
                }
            }
            const flat = (t) => !!(t && t.terrain && t.terrain.passable && !t.settlement && !isWater(t)
                && (ON.has(t.terrain.id) || t.terrain.id === 'swamp')
                && (t.elevation ?? 0.5) - wt <= D.maxRise && (t.temperature ?? 0.5) >= C.minTemp);
            const mouths = rivers.filter(t => t.hasRiver && isSea(down(t)) && (feed.get(t) || 0) >= D.minFeed && flat(t))
                .sort((a, b) => feed.get(b) - feed.get(a) || a.r - b.r || a.q - b.q);
            const maxDeltas = Math.max(1, Math.round(D.maxDeltas * Math.sqrt((width * height) / (120 * 80))));
            for (const m of mouths) {
                if (deltas.length >= maxDeltas) break;
                if (deltas.some(o => Hex.wrappingDistance(m.q, m.r, o.q, o.r, width) < D.spacing)) continue;
                const out = down(m);
                // the hex above the mouth: the river hex flowing into it with the most behind it
                const mn = nbrs(m);
                const ins = mn.filter((n, i) => n && n.hasRiver && n.riverDir === (i + 3) % 6);
                const up = ins.reduce((a, n) => (!a || feed.get(n) > feed.get(a) ? n : a), null);
                const delta = { q: m.q, r: m.r, feed: feed.get(m), marsh: [], branch: null };
                if (toMarsh(m)) marsh++;
                delta.marsh.push(m);
                if (up && flat(up) && toMarsh(up)) { marsh++; delta.marsh.push(up); }
                // the fan: the lowest flat land beside the mouth, by the sea first
                const fan = [...new Set([...mn, ...(up ? nbrs(up) : [])])]
                    .filter(n => n && n !== m && n !== up && flat(n) && !n.hasRiver && n.terrain.id !== 'swamp')
                    .sort((a, b) => (nbrs(b).some(isSea) - nbrs(a).some(isSea)) || a.elevation - b.elevation || a.r - b.r || a.q - b.q);
                for (const n of fan.slice(0, D.fan)) if (toMarsh(n)) { marsh++; delta.marsh.push(n); }
                // the distributary: from the mouth (or a hex above it) through a low hex
                // beside it that touches the sea elsewhere than the main outlet
                if (D.branch) {
                    let best = null;
                    for (const from of [...ins, m]) {
                        if (!from || !from.hasRiver || Number.isInteger(from.riverBranch)) continue;
                        nbrs(from).forEach((dh, i) => {
                            if (!dh || dh === m || dh.hasRiver || !flat(dh)) return;
                            // nothing may already flow into it
                            if (nbrs(dh).some((o, j) => o && o.hasRiver && o.riverDir === (j + 3) % 6)) return;
                            nbrs(dh).forEach((s, j) => {
                                if (!isSea(s) || s === out) return;
                                const gap = Hex.wrappingDistance(s.q, s.r, out.q, out.r, width);
                                // (the farther from the main outlet the better; from above the mouth
                                // rather than the mouth itself, so the split is a channel's length up)
                                const v = gap * 10 + (from !== m ? 5 : 0) - dh.elevation;
                                if (gap >= 1 && (!best || v > best.v)) best = { from, dirFrom: i, dh, dirOut: j, v };
                            });
                        });
                    }
                    if (best) {
                        best.from.riverBranch = best.dirFrom;
                        best.dh.hasRiver = true;
                        best.dh.riverSource = false;
                        best.dh.riverDir = best.dirOut;
                        best.dh.riverDistributary = true;
                        if (toMarsh(best.dh)) { marsh++; delta.marsh.push(best.dh); }
                        delta.branch = { q: best.dh.q, r: best.dh.r };
                    }
                }
                m._delta = true;
                deltas.push(delta);
            }
        }
        return { marsh, deltas };
    },

    /**
     * Drop river marks from hexes that ended up as water after the terrain
     * pass (sunk islets, flooded basins), so no river is drawn on the sea.
     */
    cleanRivers(tiles) {
        for (const row of tiles) {
            for (const t of row) {
                if (t.hasRiver && t.terrain && Terrain.WATER_IDS.includes(t.terrain.id)) {
                    t.hasRiver = false;
                    t.riverSource = false;
                    delete t.riverDir;
                }
            }
        }
    },

    classifyTerrain(tile) {
        const { elevation: elev, moisture: moist, temperature: temp, hasRiver } = tile;
        const T = Terrain.TYPES;

        // Use configurable thresholds if available, otherwise defaults
        const thresholds = Terrain._currentThresholds || {};
        const waterThresh = thresholds.waterThreshold || 0.42;
        const deepWater = thresholds.deepWaterLevel || 0.2;
        const hillsLvl = thresholds.hillsLevel || 0.52;
        const highlandsLvl = thresholds.highlandsLevel || 0.60;
        const mountainLvl = thresholds.mountainLevel || 0.70;
        const snowPeakLvl = thresholds.snowPeakLevel || 0.88;

        // Elevation Based Types
        if (elev < waterThresh) {
            // Use pre-calculated water type if available
            if (tile.waterBodyType === 'lake') return T.LAKE;
            if (tile.waterBodyType === 'sea') return T.SEA;

            // Default to Ocean/Deep Ocean/Coast
            if (elev < deepWater) return T.DEEP_OCEAN;
            if (elev < waterThresh - 0.02) return T.OCEAN;
            return T.COAST;
        }
        if (elev > snowPeakLvl) return T.SNOW_PEAK;
        if (elev > mountainLvl) return T.MOUNTAIN;
        if (elev > highlandsLvl) return T.HIGHLANDS;
        if (elev > hillsLvl) return T.HILLS;

        // Force Snow/Ice for below freezing temps on flat land
        if (temp < 0.25) {
            if (elev < 0.45 || temp < 0.15) return T.ICE;
            return T.SNOW;
        }

        // Otherwise use Biome Table
        // Map Heat 0-1 to 0-5
        const heatIdx = Math.floor(temp * 6);
        const moistIdx = Math.floor(moist * 6);

        const h = Utils.clamp(heatIdx, 0, 5);
        const m = Utils.clamp(moistIdx, 0, 5);

        const biomeName = Terrain.BIOME_TABLE[h][m];

        if (biomeName && T[biomeName]) {
            return T[biomeName];
        }

        // Fallback — return GRASSLAND or the first available type
        return T.GRASSLAND || Object.values(T)[0] || { id: 'grassland', name: 'Grassland', color: '#88aa55', moveCost: 2, passable: true, icon: '🌿' };
    },

    rollResource(terrainId, q, r, densityMultiplier = 1.0, strategicMultiplier = 1.0) {
        const chances = Terrain.RESOURCE_CHANCES[terrainId];
        if (!chances) return null;

        const seed = Utils.hashStr(`${q}_${r}_res`);
        const rng = Utils.seededRandom(Math.abs(seed));

        // Strategic resources list
        const strategicResources = ['iron', 'gold_ore', 'gems', 'coal', 'oil', 'horses'];

        for (const { resource, chance } of chances) {
            const isStrategic = strategicResources.includes(resource);
            const mult = isStrategic ? densityMultiplier * strategicMultiplier : densityMultiplier;
            if (rng() < chance * mult) {
                return Terrain.RESOURCES[resource.toUpperCase()];
            }
        }
        return null;
    },

    /**
     * The ore fields of worlds since terrainGen 15 (data/terrain.json
     * mineralFields). Each mineral gets a few fields, by the square root of
     * the land, centred on the land it likes and kept apart from its own
     * kind, so iron is in some ranges and not others, salt in some dry
     * country, silver and gold in a few places on the whole world. Marks each
     * hex in a field with tile.ores = { mineral: strength 0..1 } (1 at a
     * field's heart). -> { fields, byMineral } (a mineral's id -> its config)
     */
    NO_ORES: Object.freeze({}),

    _mineralFields(tiles, width, height, rng) {
        const cfg = Terrain.MINERAL_FIELDS || {};
        const land = [];
        for (const row of tiles) for (const t of row) if (t.terrain && t.terrain.passable || (t.terrain && ['mountain', 'snow_peak'].includes(t.terrain.id))) land.push(t);
        const root = Math.sqrt(land.length);
        const scale = Utils.clamp(root / 64, 0.6, 3);
        const fields = [];
        for (const [id, c] of Object.entries(cfg)) {
            if (!c || id.startsWith('_')) continue;
            const centre = new Set(c.centre || []);
            const cands = land.filter(t => centre.has(t.terrain.id));
            if (!cands.length) continue;
            const want = Math.max(c.min || 1, Math.round(root * (c.perRoot || 0)));
            const spacing = (c.spacing || 10) * scale;
            const placed = [];
            for (let tries = 0; placed.length < want && tries < want * 40; tries++) {
                const t = cands[Math.floor(rng() * cands.length) % cands.length];
                if (placed.some(p => Hex.wrappingDistance(p.q, p.r, t.q, t.r, width) < spacing)) continue;
                placed.push({ q: t.q, r: t.r });
            }
            const radius = Math.max(2, (c.radius || 3) * Math.sqrt(scale));
            for (const p of placed) {
                // (a field is not a round blot: its rim wobbles with the hash of each hex)
                const R = Math.ceil(radius * 1.3);
                for (const h of Hex.hexesInRange(p.q, p.r, R)) {
                    if (h.r < 0 || h.r >= height) continue;
                    const t = tiles[h.r][Hex.wrapQ(h.q, width)];
                    const d = Hex.wrappingDistance(p.q, p.r, t.q, t.r, width);
                    const wob = 0.75 + 0.5 * ((Math.abs(Utils.hashStr(`mf:${id}:${t.q},${t.r}`)) % 1000) / 1000);
                    const k = 1 - d / (radius * wob);
                    if (k <= 0) continue;
                    if (!t.ores) t.ores = {};
                    t.ores[id] = Math.max(t.ores[id] || 0, k);
                }
                fields.push({ mineral: id, q: p.q, r: p.r, radius });
            }
        }
        // (every other hex of such a world is marked too, with no ore: the mark is how the
        // hinterland knows this world's veins lie in fields)
        for (const row of tiles) for (const t of row) if (!t.ores) t.ores = Terrain.NO_ORES;
        return { fields, byMineral: cfg };
    },

    /**
     * A hex's resource in worlds since terrainGen 15: the minerals only inside
     * their ore fields (likelier toward a field's heart), everything else
     * (stone, timber, fish, farmland, herds, spices) by the old chances.
     */
    rollResource15(tile, minerals, densityMultiplier = 1.0, strategicMultiplier = 1.0) {
        const { q, r } = tile;
        const id = tile.terrain && tile.terrain.id;
        const cfg = minerals.byMineral;
        const rng = Utils.seededRandom(Math.abs(Utils.hashStr(`${q}_${r}_res`)));
        // the minerals of the fields this hex lies in, strongest first
        if (tile.ores) {
            const here = Object.entries(tile.ores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
            for (const [m, k] of here) {
                const c = cfg[m];
                if (!c || !(c.on || []).includes(id) || !Terrain.RESOURCES[m.toUpperCase()]) continue;
                const chance = ((c.edge || 0.1) + ((c.core || 0.35) - (c.edge || 0.1)) * k) * densityMultiplier * strategicMultiplier;
                if (rng() < chance) return Terrain.RESOURCES[m.toUpperCase()];
            }
        }
        const chances = Terrain.RESOURCE_CHANCES[id];
        if (!chances) return null;
        for (const { resource, chance } of chances) {
            if (cfg[resource]) continue;     // (a mineral: only in its fields, above)
            if (rng() < chance * (resource === 'horses' ? densityMultiplier * strategicMultiplier : densityMultiplier)) {
                return Terrain.RESOURCES[resource.toUpperCase()];
            }
        }
        return null;
    },

    classifyWaterBodies(tiles, width, height) {
        const visited = new Set();
        const waterThreshold = 0.42; // Include Coast in connectivity check
        const oceanGroups = []; // Track large bodies to ensure connectivity

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const key = `${q},${r}`;

                if (tile.elevation < waterThreshold && !visited.has(key)) {
                    // Found a new water body, flood fill to find extent
                    const group = [];
                    const queue = [tile];
                    visited.add(key);
                    group.push(tile);

                    let ptr = 0;
                    while (ptr < queue.length) {
                        const curr = queue[ptr++];
                        const neighbors = Hex.neighbors(curr.q, curr.r);

                        for (const n of neighbors) {
                            const wq = Hex.wrapQ(n.q, width);
                            if (n.r < 0 || n.r >= height) continue;

                            const neighbor = tiles[n.r][wq];
                            const nKey = `${neighbor.q},${neighbor.r}`; // Use neighbor's own q/r which should correspond to wq/n.r logic? 
                            // Wait, tiles[n.r][wq] has {q: wq, r: n.r}. Yes.
                            // But let's be safe and use wq indices for key
                            const safeKey = `${wq},${n.r}`;

                            if (neighbor.elevation < waterThreshold && !visited.has(safeKey)) {
                                visited.add(safeKey);
                                group.push(neighbor);
                                queue.push(neighbor);
                            }
                        }
                    }

                    // Determine Type
                    let type = 'ocean';
                    // (a lake filled by the drainage, terrainGen 10, is a lake at any size)
                    if (group.length <= 5 || group.every(t => t._lake)) type = 'lake';
                    else if (group.length <= 15) type = 'sea';

                    // Assign to all tiles in group
                    for (const t of group) {
                        t.waterBodyType = type;
                    }

                    // Store groups of 'ocean' type for connectivity check
                    if (type === 'ocean') {
                        oceanGroups.push(group);
                    }
                }
            }
        }

        // --- World Ocean Connectivity ---
        // If we have multiple disconnected "oceans", carve a strait between them
        if (oceanGroups.length > 1) {
            // Sort by size to find largest as "Main Ocean"
            oceanGroups.sort((a, b) => b.length - a.length);
            const mainOcean = oceanGroups[0];

            for (let i = 1; i < oceanGroups.length; i++) {
                const subOcean = oceanGroups[i];

                // Find closest points between mainOcean and subOcean
                let bestDist = Infinity;
                let startTile = null;
                let endTile = null;

                // Sample points to speed up search if groups are huge
                const stepA = Math.max(1, Math.floor(mainOcean.length / 50));
                const stepB = Math.max(1, Math.floor(subOcean.length / 50));

                for (let a = 0; a < mainOcean.length; a += stepA) {
                    for (let b = 0; b < subOcean.length; b += stepB) {
                        const tA = mainOcean[a];
                        const tB = subOcean[b];
                        const d = Hex.wrappingDistance(tA.q, tA.r, tB.q, tB.r, width);

                        if (d < bestDist) {
                            bestDist = d;
                            startTile = tA;
                            endTile = tB;
                        }
                    }
                }

                // Carve a strait (Strait Carver)
                if (startTile && endTile) {
                    this.carveStrait(tiles, startTile, endTile, width, height);
                }
            }
        }
    },

    /**
     * Carve a sea-level path between two points to ensure connectivity
     */
    carveStrait(tiles, start, end, width, height) {
        // Simple line carving using a path of hexes
        // We use a simple greedy approach for the "strait"
        let currQ = start.q;
        let currR = start.r;

        const maxSteps = 100;
        let steps = 0;

        while ((currQ !== end.q || currR !== end.r) && steps < maxSteps) {
            steps++;
            const neighbors = Hex.neighbors(currQ, currR);
            let bestNext = null;
            let minDist = Infinity;

            for (const n of neighbors) {
                const wq = Hex.wrapQ(n.q, width);
                if (n.r < 0 || n.r >= height) continue;

                const dist = Hex.wrappingDistance(wq, n.r, end.q, end.r, width);
                if (dist < minDist) {
                    minDist = dist;
                    bestNext = { q: wq, r: n.r };
                }
            }

            if (!bestNext) break;

            currQ = bestNext.q;
            currR = bestNext.r;

            // Carve the tile and its immediate neighbors to make a decent strait
            const carveRadius = 1;
            const affected = Hex.neighbors(currQ, currR);
            affected.push({ q: currQ, r: currR });

            for (const aff of affected) {
                const awq = Hex.wrapQ(aff.q, width);
                if (aff.r < 0 || aff.r >= height) continue;

                const tile = tiles[aff.r][awq];
                // Force to coastal level at minimum
                if (tile.elevation > 0.38) {
                    tile.elevation = 0.38;
                    tile.waterBodyType = 'ocean'; // Force classification
                }
            }
        }
    },

    identifyRegions(tiles, width, height) {
        const visited = new Set();
        let regionCounter = 0;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const key = `${q},${r}`;

                if (!visited.has(key)) {
                    regionCounter++;
                    const queue = [tile];
                    visited.add(key);
                    tile.regionId = regionCounter;

                    const getCategory = (t) => {
                        if (['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(t.terrain.id)) return 'water';
                        if (t.terrain.passable) return 'land';
                        return 'impassable';
                    };

                    const category = getCategory(tile);

                    let ptr = 0;
                    while (ptr < queue.length) {
                        const curr = queue[ptr++];
                        const neighbors = Hex.neighbors(curr.q, curr.r);

                        for (const n of neighbors) {
                            const wq = Hex.wrapQ(n.q, width);
                            if (n.r < 0 || n.r >= height) continue;

                            const neighbor = tiles[n.r][wq];
                            const nKey = `${wq},${n.r}`;

                            if (!visited.has(nKey) && getCategory(neighbor) === category) {
                                visited.add(nKey);
                                neighbor.regionId = regionCounter;
                                queue.push(neighbor);
                            }
                        }
                    }
                }
            }
        }
    },

    // ── Region naming ────────────────────────────────────────────────
    // Water terrain ids used for region categorisation and coast detection.
    WATER_IDS: ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'],

    // Family noun used to name a land region, keyed by terrain id.
    REGION_FAMILY: {
        woodland: 'Woodlands', seasonal_forest: 'Woodlands',
        boreal_forest: 'Pinewoods', temperate_rainforest: 'Rainforest',
        tropical_rainforest: 'Jungle',
        grassland: 'Grasslands', plains: 'Plains', savanna: 'Savanna',
        hills: 'Hills', highlands: 'Highlands', mountain: 'Mountains',
        desert: 'Desert', tundra: 'Tundra', snow: 'Snowfields', ice: 'Frostlands',
        swamp: 'Marshes', beach: 'Shores', island: 'Isles',
    },

    // Short flavour description keyed by family noun.
    REGION_DESC: {
        Woodlands: 'Forests and rolling hills stretch across this peaceful land.',
        Pinewoods: 'Dark evergreens crowd the cold northern reaches.',
        Rainforest: 'Mist clings to a dense, dripping canopy.',
        Jungle: 'Tangled green swallows all who wander from the path.',
        Grasslands: 'Open grass ripples for miles beneath a wide sky.',
        Plains: 'Flat, fertile country good for farm and road alike.',
        Savanna: 'Golden grass and scattered trees bake in the sun.',
        Hills: 'Low hills fold the land into hidden valleys.',
        Highlands: 'Windswept heights look down on the lands below.',
        Mountains: 'Sheer peaks and narrow passes bar easy travel.',
        Desert: 'Sun-scorched dunes stretch to a shimmering horizon.',
        Tundra: 'A frozen plain endures beneath pale, low light.',
        Snowfields: 'Deep snow blankets a silent, sleeping country.',
        Frostlands: 'Ancient ice grips this bitter, unforgiving land.',
        Marshes: 'Reed and bog conspire to swallow careless feet.',
        Shores: 'Sand and tide mark where the land meets the sea.',
        Isles: 'Scattered land rises from the surrounding waters.',
    },

    /**
     * Check whether a terrain id is a water body.
     */
    isWaterId(id) {
        return Terrain.WATER_IDS.includes(id);
    },

    /**
     * Derive a human-readable region name for a tile's region.
     * Pure and deterministic (no RNG, no globals) — safe for world/ layer.
     * e.g. "Coastal Woodlands", "Highlands", "Open Waters".
     */
    getRegionName(tile, world) {
        if (!tile || !world) return 'Uncharted Lands';
        const info = Terrain._regionInfo(tile, world);
        if (info.isWater) return info.coastal ? 'Coastal Waters' : 'Open Waters';
        // (worlds since terrainGen 16: a gap through a range, Terrain._passes16)
        if (tile._pass) return 'Mountain Pass';
        const noun = Terrain.REGION_FAMILY[info.dominant] || 'Wilds';
        return info.coastal ? `Coastal ${noun}` : noun;
    },

    /**
     * Derive a short flavour description for a tile's region. Deterministic.
     */
    getRegionDescription(tile, world) {
        if (!tile || !world) return 'An unexplored stretch of the realm.';
        const info = Terrain._regionInfo(tile, world);
        if (info.isWater) return 'Restless waters roll toward a far horizon.';
        if (tile._pass) return 'A narrow way climbs between the peaks: the one road through the range.';
        const noun = Terrain.REGION_FAMILY[info.dominant] || 'Wilds';
        return Terrain.REGION_DESC[noun] || 'Untamed country awaits the bold.';
    },

    /**
     * Internal: bounded BFS over the tile's region to find the dominant
     * passable terrain and whether the region touches water. Deterministic
     * (fixed neighbour order, capped iteration).
     */
    _regionInfo(tile, world) {
        const MAX = 500;
        const counts = {};
        let coastal = false;
        const visited = new Set([`${tile.q},${tile.r}`]);
        const queue = [tile];
        let ptr = 0;
        while (ptr < queue.length && ptr < MAX) {
            const curr = queue[ptr++];
            if (curr.terrain.passable) {
                counts[curr.terrain.id] = (counts[curr.terrain.id] || 0) + 1;
            }
            const neighbors = Hex.neighbors(curr.q, curr.r);
            for (const n of neighbors) {
                const nb = world.getTile(n.q, n.r);
                if (!nb) continue;
                if (Terrain.isWaterId(nb.terrain.id)) coastal = true;
                const nKey = `${nb.q},${nb.r}`;
                if (!visited.has(nKey) && nb.regionId === tile.regionId) {
                    visited.add(nKey);
                    queue.push(nb);
                }
            }
        }
        let dominant = tile.terrain.id;
        let best = -1;
        for (const [id, c] of Object.entries(counts)) {
            if (c > best) { best = c; dominant = id; }
        }
        return { dominant, coastal, isWater: Terrain.isWaterId(tile.terrain.id) };
    },
};
