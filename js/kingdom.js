// ============================================
// KINGDOM — Kingdom data and management
// ============================================

const Kingdom = {
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
            preferredTerrain: ['forest', 'dense_forest', 'grassland'],
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
     * Place kingdoms on the map — find suitable capital locations
     */
    placeKingdoms(kingdoms, tiles, mapWidth, mapHeight) {
        const placedCapitals = [];
        const minCapitalDistance = Math.floor(mapWidth / 4); // Keep kingdoms apart

        for (const kingdom of kingdoms) {
            let bestTile = null;
            let bestScore = -Infinity;
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
                const terrainBonus = kingdom.preferredTerrain.includes(tile.terrain.id) ? 50 : 0;

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
            }
        }
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
     */
    generateCityName(culture) {
        const names = {
            Imperial: [
                'Crownhaven', 'Irongate', 'Stonewall', 'Highkeep', 'Kingsbridge',
                'Whitehall', 'Greywatch', 'Northhold', 'Eastmere', 'Dragonspire',
                'Goldcrest', 'Silverford', 'Hammerfell', 'Thornwall', 'Embervale'
            ],
            Woodland: [
                'Greenhollow', 'Mosswood', 'Ferndale', 'Willowmere', 'Birchroot',
                'Dewglen', 'Oakshade', 'Starbloom', 'Moongrove', 'Leafveil',
                'Blossomreach', 'Thornheart', 'Misthaven', 'Elderwood', 'Sunpetal'
            ],
            Nomadic: [
                'Windspear', 'Sunrock', 'Dusthold', 'Bonecrest', 'Ironhoof',
                'Skyfall', 'Redmane', 'Thundercamp', 'Ashplain', 'Stormridge',
                'Hawknest', 'Bloodsand', 'Flamepeak', 'Wolfden', 'Eaglerock'
            ],
            Religious: [
                'Holyspire', 'Solarum', 'Celestia', 'Sanctum', 'Divinara',
                'Soulkeep', 'Blessingford', 'Lightreach', 'Gracemere', 'Faithhold',
                'Templeguard', 'Starfall', 'Oraclewatch', 'Hymnsgate', 'Prayerveil'
            ],
            Maritime: [
                'Tidewatch', 'Harbordeep', 'Saltbay', 'Coralhaven', 'Wavecrest',
                'Anchorpoint', 'Stormport', 'Seabreeze', 'Pearlshore', 'Driftwood',
                'Sailmere', 'Shellhaven', 'Fogport', 'Riptide', 'Deepwater'
            ]
        };

        const cultureNames = names[culture] || names.Imperial;
        return Utils.randPick(cultureNames);
    },

    /**
     * Generate a ruler name based on culture
     */
    generateRulerName(culture) {
        const titles = {
            Imperial: ['King', 'Queen', 'Emperor', 'Empress'],
            Woodland: ['Queen', 'King', 'Elder', 'Sage'],
            Nomadic: ['Khan', 'Chieftain', 'Warlord'],
            Religious: ['High Priest', 'High Priestess', 'Prophet', 'Oracle'],
            Maritime: ['Consul', 'Admiral', 'Lord', 'Lady']
        };

        const names = {
            Imperial: [
                'Aldric', 'Cedric', 'Edmund', 'Roland', 'Theron', 'Victor',
                'Helena', 'Isabella', 'Morgana', 'Rowena', 'Vivienne'
            ],
            Woodland: [
                'Elara', 'Sylvan', 'Thalia', 'Rowan', 'Faelan', 'Arden',
                'Lyra', 'Elowen', 'Briar', 'Cypress', 'Willow'
            ],
            Nomadic: [
                'Borga', 'Temur', 'Khal', 'Drogo', 'Ragnar', 'Ulfric',
                'Yara', 'Khara', 'Nara', 'Zara', 'Shara'
            ],
            Religious: [
                'Solon', 'Matthias', 'Ezekiel', 'Silas', 'Tobias',
                'Miriam', 'Seraphina', 'Celeste', 'Evangeline', 'Theodora'
            ],
            Maritime: [
                'Lyanna', 'Marcus', 'Octavia', 'Tiberius', 'Cassius',
                'Marina', 'Cordelia', 'Nerissa', 'Portia', 'Caspian'
            ]
        };

        const epithets = [
            'the Wise', 'the Bold', 'the Just', 'the Great', 'the Fair',
            'the Strong', 'the Brave', 'the Merciful', 'the Stern', 'the Cunning',
            'Ironhand', 'Stormborn', 'the Unifier', 'the Defender', 'the Reformer'
        ];

        const cultureTitles = titles[culture] || titles.Imperial;
        const cultureNames = names[culture] || names.Imperial;

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
