// ============================================
// TERRAIN — Terrain types and generation
// ============================================

const Terrain = {
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
        ICE: { id: 'ice', name: 'Ice Sheet', color: '#e5f9ff', moveCost: 3, passable: true, icon: '🧊' },
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
        const tiles = [];

        // Noise Parameters from C#
        const terrainOctaves = params.terrainOctaves || 6;
        const terrainFreq = params.terrainFreq || 1.1; // Reduced from 1.5 for much larger landmasses
        const heatOctaves = params.heatOctaves || 4;
        const heatFreq = params.heatFreq || 3.0;
        const moistOctaves = params.moistOctaves || 4;
        const moistFreq = params.moistFreq || 2.0;

        // Water Levels
        const deepWaterLevel = params.deepWaterLevel || 0.2;
        const shallowWaterLevel = params.shallowWaterLevel || 0.4;
        const waterThreshold = params.waterThreshold || 0.42;
        const dirtLevel = params.dirtLevel || 0.5;
        const hillsLevel = params.hillsLevel || 0.65;
        const highlandsLevel = params.highlandsLevel || 0.8;
        const riverCount = params.riverCount !== undefined ? params.riverCount : 40;
        const continentCount = params.continentCount || 3;

        // Generate continent seed points using a jittered grid for better distribution
        const seeds = [];
        const cols = Math.ceil(Math.sqrt(continentCount * (width / height)));
        const rows = Math.ceil(continentCount / cols);

        for (let i = 0; i < continentCount; i++) {
            const gridCol = i % cols;
            const gridRow = Math.floor(i / cols);

            // Jittered grid placement
            const targetQ = (gridCol + 0.5 + (Math.random() - 0.5) * 0.6) * (width / cols);
            const targetR = (gridRow + 0.5 + (Math.random() - 0.5) * 0.6) * (height / rows);

            // Clamp R to keep somewhat away from extreme poles for better playability
            const finalR = Utils.clamp(targetR, height * 0.2, height * 0.8);

            seeds.push({
                q: targetQ,
                r: finalR,
                // Reduce radius as count increases to keep them distinct
                radius: (width / (cols * 1.8)) * (0.8 + Math.random() * 0.4)
            });
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

                // Height Noise (Base)
                let baseElev = Utils.fbm(nx * terrainFreq + 10, ny_r * terrainFreq + 10, terrainOctaves, 2.0, 0.5);
                baseElev = (baseElev + 1) / 2; // Normalize 0-1

                // Ridged Noise (for sharper peaks)
                let ridged = 1.0 - Math.abs(Utils.fbm(nx * terrainFreq * 2 + 50, ny_r * terrainFreq * 2 + 50, 4, 2.0, 0.5));
                ridged = Math.pow(ridged, 2.5);

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

                // Increase base land presence
                let elevation = (baseElev * 0.25) + (continentWeight * 0.65) + (ridged * 0.1);

                // Polar bias: encourage water at poles (r=0 and r=height)
                // Tapered more to keep land closer to poles
                const polarDist = Math.abs((r / height) - 0.5) * 2; // 0 at equator, 1 at poles
                elevation -= Math.pow(polarDist, 4) * 0.2; // Power of 4 makes it sharper at the very edges

                // Simple longitudinal "Sea Lane" bias to ensure at least one vertical gap
                // Tapered to be less aggressive
                const seaLane = Math.cos(angle + 1.0) * 0.5 + 0.5; // 0-1 based on longitude
                elevation -= Math.pow(seaLane, 6) * 0.1; // Power 6 creates a thinner, more focused lane

                // Power curve to make high peaks rare
                elevation = Utils.clamp(elevation, -0.2, 1.2); // Allow room for biases before clamp
                elevation = (elevation < 0) ? elevation : Math.pow(elevation, 1.1);
                elevation = Utils.clamp(elevation, 0, 1);

                // Heat Noise
                let heat = Utils.fbm(nx + 20, ny_r + 20, heatOctaves, 2.0, 0.5);
                heat = (heat + 1) / 2;

                // Gradient for Latitude Heat
                const lat = 1 - Math.abs((r / height) - 0.5) * 2; // 0 at poles, 1 at equator
                // Simplified heat calculation blending noise and latitude
                heat = (heat * 0.3) + (lat * 0.7);

                // Moisture Noise
                let moisture = Utils.fbm(nx + 30, ny_r + 30, moistOctaves, 2.0, 0.5);
                moisture = (moisture + 1) / 2;

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

        // Sprinkle super-peaks (Post-processing)
        const numPeaks = Utils.randInt(8, 14);
        for (let i = 0; i < numPeaks; i++) {
            const pq = Math.floor(Math.random() * width);
            const pr = Math.floor(Math.random() * height);
            const root = tiles[pr][pq];

            // Only boost peaks on existing hills/land to keep them realistic
            if (root.elevation > 0.45) {
                const peakRadius = Utils.randInt(2, 4);
                const boost = Utils.randFloat(0.25, 0.45);

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

        // Generate Rivers (C# Logic adaptation)
        Terrain.generateRivers(tiles, width, height, riverCount);

        // Classify Water Bodies (Lake vs Sea vs Ocean)
        Terrain.classifyWaterBodies(tiles, width, height);

        // Classify Terrain
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                tile.terrain = Terrain.classifyTerrain(tile);

                // Functional Island Generation: Convert some water to ISLAND
                if (tile.terrain.id === 'ocean' || tile.terrain.id === 'coast') {
                    const seed = Utils.hashStr(`${q}_${r}_island`);
                    const rng = Utils.seededRandom(Math.abs(seed));

                    // Even lower frequency: 0.5% chance in ocean, 1% in coast
                    const chance = (tile.terrain.id === 'ocean') ? 0.005 : 0.01;
                    if (rng() < chance) {
                        tile.terrain = Terrain.TYPES.ISLAND;
                        tile.elevation = 0.45; // Move above water threshold
                    }
                }

                tile.resource = Terrain.rollResource(tile.terrain.id, q, r);
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

        // Identify connected regions for reachable pathfinding
        Terrain.identifyRegions(tiles, width, height);

        return tiles;
    },

    generateRivers(tiles, width, height, riverCount = 40) {
        // Only start from mountains (matching classifyTerrain threshold)
        const minRiverHeight = 0.72;

        // Find viable river sources (mountains)
        let viableTiles = [];
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const t = tiles[r][q];
                if (t.elevation > minRiverHeight) viableTiles.push(t);
            }
        }

        Utils.shuffle(viableTiles);

        // Safety check
        if (viableTiles.length === 0) return;

        let created = 0;

        for (const startTile of viableTiles) {
            if (created >= riverCount) break;
            if (startTile.hasRiver) continue;

            let current = startTile;
            let path = [current];
            let length = 0;
            let reachedWater = false;

            // Safety break
            if (startTile.elevation < 0.4) continue;

            while (length < 100) {
                const neighbors = Hex.neighbors(current.q, current.r);
                let candidates = [];

                for (const n of neighbors) {
                    const wq = Hex.wrapQ(n.q, width);
                    if (n.r < 0 || n.r >= height) continue;
                    const nt = tiles[n.r][wq];

                    if (path.includes(nt)) continue; // No loops

                    // Strictly downhill candidates
                    if (nt.elevation < current.elevation) {
                        candidates.push(nt);
                    }
                }

                if (candidates.length === 0) {
                    // Local minimum (Stuck on land) -> Form a Lake!
                    // Force elevation down to create a lake
                    current.elevation = 0.38; // Lake level (just below water threshold)
                    reachedWater = true;
                    // Optional: could expand lake to neighbors here for larger lakes
                    break;
                }

                // Sort candidates to find the "Best" flow
                // Priority:
                // 1. Existing Water (Ocean/Coast) - Best outcome
                // 2. Existing River - Merge
                // 3. Steepest descent (lowest elevation) - Standard flow
                candidates.sort((a, b) => {
                    const aIsWater = a.elevation < 0.42;
                    const bIsWater = b.elevation < 0.42;

                    // Prioritize Water
                    if (aIsWater && !bIsWater) return -1;
                    if (!aIsWater && bIsWater) return 1;

                    // Prioritize Existing Rivers (Merge)
                    if (a.hasRiver && !b.hasRiver) return -1;
                    if (!a.hasRiver && b.hasRiver) return 1;

                    // Prioritize Steepest Descent
                    return a.elevation - b.elevation;
                });

                const nextTile = candidates[0];

                // If we hit water, we're done
                if (nextTile.elevation < 0.42) {
                    path.push(nextTile);
                    reachedWater = true;
                    break;
                }

                // If we hit a river, we merge and done
                if (nextTile.hasRiver) {
                    path.push(nextTile);
                    reachedWater = true;
                    break;
                }

                path.push(nextTile);
                current = nextTile;
                length++;
            }

            // Allow rivers that reached water OR are reasonably long inland rivers (that formed lakes)
            if (path.length > 2 && reachedWater) {
                created++;
                for (let i = 0; i < path.length; i++) {
                    const t = path[i];
                    t.hasRiver = true;
                    if (i === 0) t.riverSource = true;
                }
            }
        }
    },

    classifyTerrain(tile) {
        const { elevation: elev, moisture: moist, temperature: temp, hasRiver } = tile;
        const T = Terrain.TYPES;

        // Elevation Based Types
        if (elev < 0.42) {
            // Use pre-calculated water type if available
            if (tile.waterBodyType === 'lake') return T.LAKE;
            if (tile.waterBodyType === 'sea') return T.SEA;

            // Default to Ocean/Deep Ocean/Coast
            if (elev < 0.2) return T.DEEP_OCEAN;
            if (elev < 0.4) return T.OCEAN;
            return T.COAST;
        }
        if (elev > 0.88) return T.SNOW_PEAK;
        if (elev > 0.70) return T.MOUNTAIN;
        if (elev > 0.60) return T.HIGHLANDS;
        if (elev > 0.52) return T.HILLS;

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

        return T.GRASSLAND; // Default
    },

    rollResource(terrainId, q, r) {
        const chances = Terrain.RESOURCE_CHANCES[terrainId];
        if (!chances) return null;

        const seed = Utils.hashStr(`${q}_${r}_res`);
        const rng = Utils.seededRandom(Math.abs(seed));

        for (const { resource, chance } of chances) {
            if (rng() < chance) {
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
                    if (group.length <= 5) type = 'lake';
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
    }
};
