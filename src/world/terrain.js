// ============================================
// TERRAIN — Terrain types and generation
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

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
        const desertFactor = desertFactorMap[desertFreq] || 1.0;

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

                // Apply hill density: compress hills region
                if (elevation > waterThreshold && elevation < mountainLevel) {
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
            }
            tiles.push(row);
        }

        // Sprinkle super-peaks (Post-processing) — scaled by mountain density
        const numPeaks = Math.round(Utils.randInt(8, 14) * mountainDensity);
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
        // Worlds since terrainGen 10: water drains as water does (rain gathers downhill into
        // branching river systems, basins fill into lakes); older worlds keep their rivers
        if (terrainGen >= 10) Terrain.generateHydrology(tiles, width, height, rng, { riverCount: scaledRiverCount, lakeFreq, waterLevel: waterThreshold, mountainLevel });
        else Terrain.generateRivers(tiles, width, height, scaledRiverCount, lakeFreq, { v2: terrainGen >= 2, waterThreshold, mountainLevel, highlandsLevel });

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
                    if (islandRng() < chance) {
                        tile.terrain = Terrain.TYPES.ISLAND;
                        tile.elevation = 0.45;
                    }
                }

                tile.resource = Terrain.rollResource(tile.terrain.id, q, r, resMultiplier, strategicMultiplier);
            }
        }

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
                        tile.terrain = Terrain.classifyTerrain(tile);
                    }
                }
            }
        }

        // No river left drawn on a hex that became water
        Terrain.cleanRivers(tiles);

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

        // 1. Hollows pressed into the land (not by the sea, not on the mountains)
        const inland = [];
        for (let i = 0; i < N; i++) {
            const t = at(i);
            if (water[i] || t.elevation < waterLevel + 0.03 || t.elevation >= mountainLevel) continue;
            if (nbrs(i).some(j => water[j])) continue;
            inland.push(i);
        }
        const basins = lakeMult > 0 ? Math.round(inland.length / H.basinsPerLand * lakeMult) : 0;
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

        // 3. Lakes: the land's true hollows (a flood of the heights as they are), up to
        // maxLake hexes each (their deepest)
        if (lakeMult > 0) {
            const plain = new Float64Array(N);
            for (let i = 0; i < N; i++) plain[i] = at(i).elevation;
            const { filled: lf } = flood(plain);
            const depthOf = (i) => lf[i] - plain[i];
            const inHollow = new Uint8Array(N);
            for (let i = 0; i < N; i++) if (!water[i] && depthOf(i) > H.minLakeDepth) inHollow[i] = 1;
            const done = new Uint8Array(N);
            const maxLake = Math.max(1, Math.round(H.maxLake * Math.min(2, 0.5 + lakeMult * 0.5)));
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
                // a shallow hollow of the noise is a lake only sometimes (more with lakeFreq)
                if (deepest < H.minLakeDepth * 2 && rng() > Math.min(1, 0.5 * lakeMult)) continue;
                group.sort((a, b) => depthOf(b) - depthOf(a));
                for (const j of group.slice(0, maxLake)) {
                    const t = at(j);
                    t.elevation = lakeLevel;
                    t._lake = true;
                    water[j] = 1;
                }
            }
        }

        // Drainage over the heights with a little jitter (HYDRO.jitter), so water on an even
        // slope wanders and meets other water rather than running beside it to the sea; the
        // lakes are water now, so a river runs into a lake and out at its spill point
        const z = new Float64Array(N);
        for (let i = 0; i < N; i++) z[i] = at(i).elevation + (rng() - 0.5) * H.jitter;
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
        // (a share of the land, by the rivers asked for: riverCount 40 is the usual)
        const target = Math.max(0, Math.round(landFlows.length * H.riverShare * (o.riverCount ?? 40) / 40));
        if (!target) return;
        const T = Math.max(H.minFlow, landFlows[Math.min(landFlows.length - 1, target)]);
        const isRiver = new Uint8Array(N);
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
        const fed = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (isRiver[i]) fed[recv[i]] = 1;
        for (let i = 0; i < N; i++) {
            if (!isRiver[i]) continue;
            const t = at(i), d = at(recv[i]);
            t.hasRiver = true;
            t.riverDir = Hex.directionTo(t.q, t.r, d.q, d.r, width);
            t.riverSource = !fed[i];
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
