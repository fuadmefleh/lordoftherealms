// ============================================
// KINGDOM — Kingdom data and management
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

export const Kingdom = {
    // Default starting kingdoms
    DEFAULTS: [
        {
            id: 'valdoria',
            name: 'Kingdom of Valdoria',
            ruler: 'King Aldric the Wise',
            color: '#e74c3c',
            colorLight: 'rgba(231, 76, 60, 0.2)',
            culture: 'Imperial',
            description: 'A proud and ancient kingdom known for its disciplined armies and grand cities.',
            preferredTerrain: ['plains', 'grassland', 'hills'],
            traits: ['militaristic', 'orderly'],
        },
        {
            id: 'sylvaris',
            name: 'Kingdom of Sylvaris',
            ruler: 'Queen Elara the Green',
            color: '#27ae60',
            colorLight: 'rgba(39, 174, 96, 0.2)',
            culture: 'Woodland',
            description: 'Forest dwellers who live in harmony with nature, masters of archery and herbal lore.',
            preferredTerrain: ['woodland', 'seasonal_forest', 'temperate_rainforest', 'grassland'],
            placementTerrain: ['grassland'],
            traits: ['peaceful', 'nature-loving'],
        },
        {
            id: 'kharzun',
            name: 'Khanate of Kharzun',
            ruler: 'Khan Borga Ironhand',
            color: '#f39c12',
            colorLight: 'rgba(243, 156, 18, 0.2)',
            culture: 'Nomadic',
            description: 'Fierce horse riders of the steppes, united under a mighty Khan.',
            preferredTerrain: ['plains', 'savanna', 'desert'],
            traits: ['aggressive', 'mobile'],
        },
        {
            id: 'azurath',
            name: 'Theocracy of Azurath',
            ruler: 'High Priest Solon',
            color: '#8e44ad',
            colorLight: 'rgba(142, 68, 173, 0.2)',
            culture: 'Religious',
            description: 'A nation governed by faith, where priests hold more power than warriors.',
            preferredTerrain: ['desert', 'hills', 'plains'],
            traits: ['religious', 'scholarly'],
        },
        {
            id: 'merathis',
            name: 'Republic of Merathis',
            ruler: 'Consul Lyanna of Tidewatch',
            color: '#2980b9',
            colorLight: 'rgba(41, 128, 185, 0.2)',
            culture: 'Maritime',
            description: 'Expert sailors and traders who dominate the coastal trade routes.',
            preferredTerrain: ['coast', 'beach', 'grassland'],
            traits: ['mercantile', 'naval'],
        }
    ],

    /**
     * Create a kingdom instance from a default template
     */
    create(template) {
        return {
            ...template,
            territory: [],       // Array of {q, r} tiles owned
            capital: null,       // {q, r} position of capital
            cities: [],          // Array of city objects
            population: 0,
            military: 0,
            treasury: Utils.randInt(500, 2000),
            relations: {},       // kingdom_id -> relation value (-100 to 100)
            isAlive: true,
            foundedDay: 1,
            wars: [],
            allies: [],
            royalBank: {        // Each kingdom has its own royal bank
                treasury: Utils.randInt(5000, 15000),
                interestRates: {
                    small: 0.10,
                    medium: 0.15,
                    large: 0.20
                }
            },
        };
    },

    /**
     * Terrain ids that score a capital site at world generation.
     * `placementTerrain` freezes the ids the old (partly misspelt)
     * preferredTerrain lists actually matched, so seeded worlds generate
     * exactly as before; the corrected preferredTerrain drives runtime
     * behaviour (expansion, home-ground battles).
     */
    placementTerrain(kingdom) {
        return kingdom.placementTerrain || kingdom.preferredTerrain || [];
    },

    /** Does this kingdom favour this terrain (runtime: expansion, battles)? */
    prefersTerrain(kingdom, terrainId) {
        return !!terrainId && Array.isArray(kingdom && kingdom.preferredTerrain) && kingdom.preferredTerrain.includes(terrainId);
    },

    /**
     * Place kingdoms on the map — find suitable capital locations
     */
    placeKingdoms(kingdoms, tiles, mapWidth, mapHeight) {
        const placedCapitals = [];
        const idealMinDistance = Math.floor(mapWidth / 4); // Ideal spacing

        for (const kingdom of kingdoms) {
            let bestTile = null;
            let bestScore = -Infinity;

            // Try with decreasing minimum distance until placement succeeds
            // This allows multiple kingdoms on the same continent when there aren't enough
            let minCapitalDistance = idealMinDistance;
            const minAllowedDistance = Math.max(4, Math.floor(mapWidth / 10)); // absolute floor — at least 4 tiles apart

            while (minCapitalDistance >= minAllowedDistance) {
                let attempts = 0;
                const maxAttempts = 1000;

                while (attempts < maxAttempts) {
                    attempts++;
                    const q = Utils.randInt(0, mapWidth - 1);
                    const r = Utils.randInt(Math.floor(mapHeight * 0.15), Math.floor(mapHeight * 0.85)); // avoid poles

                    const tile = tiles[r][q];

                    // Must be passable land
                    if (!tile.terrain.passable) continue;
                    if (tile.terrain.id === 'coast' || tile.terrain.id === 'beach') continue;

                    // Preferred terrain bonus
                    const terrainBonus = Kingdom.placementTerrain(kingdom).includes(tile.terrain.id) ? 50 : 0;

                    // Distance from other capitals
                    let tooClose = false;
                    let distScore = 0;
                    for (const cap of placedCapitals) {
                        const dist = Hex.wrappingDistance(q, r, cap.q, cap.r, mapWidth);
                        if (dist < minCapitalDistance) {
                            tooClose = true;
                            break;
                        }
                        distScore += dist;
                    }
                    if (tooClose) continue;

                    // Score: prefer terrain match + distance from others + some randomness
                    const score = terrainBonus + distScore * 0.5 + Utils.randFloat(0, 20);
                    if (score > bestScore) {
                        bestScore = score;
                        bestTile = { q, r };
                    }
                }

                // If we found a valid position, stop reducing distance
                if (bestTile) break;

                // Reduce minimum distance and retry
                minCapitalDistance = Math.floor(minCapitalDistance * 0.6);
            }

            if (!bestTile) {
                // Last resort: find any passable land tile not already a capital
                console.warn(`Kingdom ${kingdom.name}: couldn't place with distance constraints, using fallback`);
                for (let attempt = 0; attempt < 2000; attempt++) {
                    const q = Utils.randInt(0, mapWidth - 1);
                    const r = Utils.randInt(Math.floor(mapHeight * 0.15), Math.floor(mapHeight * 0.85));
                    const tile = tiles[r][q];
                    if (!tile.terrain.passable) continue;
                    if (tile.terrain.id === 'coast' || tile.terrain.id === 'beach') continue;
                    // Just make sure we're not directly on top of another capital
                    let onCapital = false;
                    for (const cap of placedCapitals) {
                        if (cap.q === q && cap.r === r) { onCapital = true; break; }
                    }
                    if (onCapital) continue;
                    bestTile = { q, r };
                    break;
                }
            }

            if (bestTile) {
                kingdom.capital = bestTile;
                placedCapitals.push(bestTile);

                // Claim territory around capital
                const initialRadius = Utils.randInt(3, 5);
                const claimedHexes = Hex.hexesInRange(bestTile.q, bestTile.r, initialRadius);

                for (const hex of claimedHexes) {
                    const wq = Hex.wrapQ(hex.q, mapWidth);
                    const wr = hex.r;
                    if (wr < 0 || wr >= mapHeight) continue;

                    const tile = tiles[wr][wq];
                    if (tile.terrain.passable && !tile.kingdom) {
                        tile.kingdom = kingdom.id;
                        kingdom.territory.push({ q: wq, r: wr });
                    }
                }

                // Set capital tile
                tiles[bestTile.r][bestTile.q].settlement = {
                    type: 'capital',
                    name: Kingdom.generateCityName(kingdom.culture),
                    population: Utils.randInt(5000, 15000),
                    level: 3,
                    kingdom: kingdom.id,
                    founded: Utils.randInt(300, 500),
                };

                // Place 1-2 towns nearby
                const numTowns = Utils.randInt(1, 2);
                for (let i = 0; i < numTowns; i++) {
                    Kingdom.placeTown(kingdom, tiles, mapWidth, mapHeight);
                }

                // Initialize population and military from settlements
                Kingdom.initializeKingdomStats(kingdom, tiles, mapWidth, mapHeight);
            }
        }
    },

    /**
     * Initialize kingdom population & military from its settlements
     * Called at world generation so kingdoms don't start with 0 troops
     */
    initializeKingdomStats(kingdom, tiles, mapWidth, mapHeight) {
        let totalPop = 0;
        for (let r = 0; r < mapHeight; r++) {
            for (let q = 0; q < mapWidth; q++) {
                const tile = tiles[r][q];
                if (tile.settlement && tile.kingdom === kingdom.id) {
                    totalPop += tile.settlement.population;
                }
            }
        }
        kingdom.population = totalPop;

        // Military: 5-8% of population — kingdoms maintain standing armies
        const militaryPercent = Utils.randFloat(0.05, 0.08);
        kingdom.military = Math.floor(totalPop * militaryPercent);
    },

    /**
     * Raise up to `amount` new troops, respecting `kingdom.militaryCap` (what
     * the realm can support, set daily by KingdomAI.updateMilitary). With no
     * cap computed yet, all of them join. Never shrinks an over-cap army —
     * KingdomAI demobilises the excess over time.
     * @returns {number} troops actually added
     */
    recruitTroops(kingdom, amount) {
        if (!kingdom || !(amount > 0)) return 0;
        const cur = kingdom.military || 0;
        let added = Math.floor(amount);
        if (typeof kingdom.militaryCap === 'number') {
            added = Math.max(0, Math.min(added, kingdom.militaryCap - cur));
        }
        kingdom.military = cur + added;
        return added;
    },

    /**
     * Place a town in kingdom territory
     */
    placeTown(kingdom, tiles, mapWidth, mapHeight) {
        // Collect all existing settlements to check distance against
        const existingSettlements = [];
        for (let r = 0; r < mapHeight; r++) {
            for (let q = 0; q < mapWidth; q++) {
                if (tiles[r][q].settlement) {
                    existingSettlements.push({ q, r });
                }
            }
        }

        const territory = kingdom.territory.filter(t => {
            const tile = tiles[t.r][t.q];
            if (!tile.terrain.passable || tile.settlement ||
                tile.terrain.id === 'coast' || tile.terrain.id === 'beach') {
                return false;
            }

            // Check distance to all other settlements
            const minTownDist = 3;
            for (const ancient of existingSettlements) {
                if (Hex.wrappingDistance(t.q, t.r, ancient.q, ancient.r, mapWidth) < minTownDist) {
                    return false;
                }
            }

            return true;
        });

        if (territory.length === 0) return;

        const loc = Utils.randPick(territory);
        tiles[loc.r][loc.q].settlement = {
            type: 'town',
            name: Kingdom.generateCityName(kingdom.culture),
            population: Utils.randInt(500, 3000),
            level: 1,
            kingdom: kingdom.id,
            founded: Utils.randInt(500, 840),
        };
    },


    /**
     * Generate a city name based on culture
     * Uses data from Kingdom._cityNames (loaded from kingdoms.json)
     */
    generateCityName(culture, world = null) {
        const names = Kingdom._cityNames || {};
        const cultureNames = names[culture] || names.Imperial || ['Settlement'];
        // Exactly one RNG draw whatever happens next: a reroll for a taken name
        // is a hash, so the seeded stream (and every golden) is unchanged.
        const picked = Utils.randPick(cultureNames);
        if (!world || !world.tiles) return picked;
        return Kingdom.uniqueCityName(picked, culture, Kingdom.settlementNames(world));
    },

    /** Every settlement name on the map (a Set). */
    settlementNames(world) {
        const taken = new Set();
        for (const row of world.tiles || []) {
            for (const t of row) if (t && t.settlement && t.settlement.name) taken.add(t.settlement.name);
        }
        return taken;
    },

    /**
     * `name` if nobody uses it yet, otherwise a free one — chosen by a hash of
     * the name and how many are taken (no RNG): an unused name of the same
     * culture, then any culture, then an affixed variant ('New Soulkeep').
     */
    uniqueCityName(name, culture, taken) {
        if (!taken.has(name)) return name;
        const all = Kingdom._cityNames || {};
        const h = Math.abs(Utils.hashStr(`${name}|${taken.size}`));
        const pickFree = list => {
            const free = list.filter(n => !taken.has(n));
            return free.length ? free[h % free.length] : null;
        };
        const own = pickFree(all[culture] || []);
        if (own) return own;
        const any = pickFree([].concat(...Object.keys(all).sort().map(k => all[k])));
        if (any) return any;
        const affixes = ['New', 'Old', 'Upper', 'Lower', 'Great', 'Little', 'East', 'West', 'North', 'South'];
        for (let i = 0; i < affixes.length; i++) {
            const n = `${affixes[(h + i) % affixes.length]} ${name}`;
            if (!taken.has(n)) return n;
        }
        for (let k = 2; ; k++) if (!taken.has(`${name} ${k}`)) return `${name} ${k}`;
    },

    /**
     * Rename duplicate settlements in place, in map order (the first keeps its
     * name). Runs once after world generation; draws no RNG.
     */
    dedupeSettlementNames(world) {
        // `taken` starts with every name on the map, so a new name never
        // collides with a settlement further along.
        const taken = Kingdom.settlementNames(world);
        const seen = new Set();
        const cultureOf = s => {
            const k = s.kingdom != null && (world.kingdoms || []).find(x => x.id === s.kingdom);
            return (k && k.culture) || 'Imperial';
        };
        let renamed = 0;
        for (const row of world.tiles || []) {
            for (const t of row) {
                const s = t && t.settlement;
                if (!s || !s.name) continue;
                if (seen.has(s.name)) {
                    s.name = Kingdom.uniqueCityName(s.name, cultureOf(s), taken);
                    taken.add(s.name);
                    renamed++;
                }
                seen.add(s.name);
            }
        }
        return renamed;
    },

    /**
     * Generate a ruler name based on culture
     * Uses data from Kingdom._rulerTitles, _rulerNames, _epithets (loaded from kingdoms.json)
     */
    generateRulerName(culture) {
        const titles = Kingdom._rulerTitles || {};
        const names = Kingdom._rulerNames || {};
        const epithets = Kingdom._epithets || ['the Great'];

        const cultureTitles = titles[culture] || titles.Imperial || ['Ruler'];
        const cultureNames = names[culture] || names.Imperial || ['Unknown'];

        const title = Utils.randPick(cultureTitles);
        const name = Utils.randPick(cultureNames);
        const epithet = Utils.randPick(epithets);

        return `${title} ${name} ${epithet}`;
    },

    /**
     * Initialize diplomatic relations between kingdoms
     */
    initRelations(kingdoms) {
        for (const k1 of kingdoms) {
            for (const k2 of kingdoms) {
                if (k1.id === k2.id) continue;
                // -30 to 30 starting relation
                k1.relations[k2.id] = Utils.randInt(-30, 30);
            }
        }
    }
};
