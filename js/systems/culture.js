// ============================================
// CULTURE — Cultural buildings & influence system
// ============================================

const Culture = {

    // ─────────────────────────────────────────────
    // CULTURAL BUILDING TYPES
    // ─────────────────────────────────────────────

    BUILDING_TYPES: {
        LIBRARY: {
            id: 'library',
            name: 'Library',
            icon: '📚',
            cost: 600,
            constructionDays: 6,
            description: 'Repository of knowledge. Increases research speed and spreads cultural influence.',
            influenceRadius: 3,
            influencePerDay: 2,
            scholarshipBonus: 5,
            researchBonus: 0.15,    // +15% research speed
            incomeBonus: 15,
            requiredSettlement: true,
        },
        THEATER: {
            id: 'theater',
            name: 'Theater',
            icon: '🎭',
            cost: 800,
            constructionDays: 8,
            description: 'Stage for drama, music, and storytelling. Boosts morale and attracts visitors.',
            influenceRadius: 4,
            influencePerDay: 3,
            scholarshipBonus: 2,
            moraleBonus: 10,
            incomeBonus: 25,
            requiredSettlement: true,
        },
        UNIVERSITY: {
            id: 'university',
            name: 'University',
            icon: '🏫',
            cost: 1500,
            constructionDays: 14,
            description: 'Centre of higher learning. Major boost to research, technology, and cultural prestige.',
            influenceRadius: 6,
            influencePerDay: 5,
            scholarshipBonus: 12,
            researchBonus: 0.30,   // +30% research speed
            incomeBonus: 40,
            requiredSettlement: true,
            requiredPopulation: 1000,
        },
        MONUMENT: {
            id: 'monument',
            name: 'Grand Monument',
            icon: '🏛️',
            cost: 1000,
            constructionDays: 10,
            description: 'An imposing monument celebrating your achievements. Generates renown.',
            influenceRadius: 5,
            influencePerDay: 4,
            scholarshipBonus: 1,
            renownPerDay: 1,
            incomeBonus: 20,
            requiredSettlement: false,
        },
        SCRIPTORIUM: {
            id: 'scriptorium',
            name: 'Scriptorium',
            icon: '📜',
            cost: 400,
            constructionDays: 4,
            description: 'A workshop for copying manuscripts and recording history.',
            influenceRadius: 2,
            influencePerDay: 1,
            scholarshipBonus: 8,
            researchBonus: 0.10,
            incomeBonus: 10,
            requiredSettlement: false,
        },
    },

    // ─────────────────────────────────────────────
    // CULTURAL TRADITIONS (kingdom-level)
    // ─────────────────────────────────────────────

    TRADITIONS: {
        Imperial: {
            name: 'Imperial Tradition',
            icon: '👑',
            bonuses: { military: 10, diplomacy: 5, trade: 5 },
            description: 'Strict hierarchy, formal courts, codified law',
        },
        Woodland: {
            name: 'Sylvan Tradition',
            icon: '🌿',
            bonuses: { nature: 15, stealth: 10, archery: 10 },
            description: 'Oral histories sung under ancient oaks',
        },
        Nomadic: {
            name: 'Steppe Tradition',
            icon: '🐎',
            bonuses: { cavalry: 15, endurance: 10, raiding: 5 },
            description: 'Songs around campfires, horse epics, sky worship',
        },
        Religious: {
            name: 'Theocratic Tradition',
            icon: '📖',
            bonuses: { faith: 15, scholarship: 10, diplomacy: 5 },
            description: 'Scripture study, philosophical debate, illumination',
        },
        Maritime: {
            name: 'Maritime Tradition',
            icon: '⚓',
            bonuses: { trade: 15, navigation: 10, exploration: 5 },
            description: 'Sea shanties, port festivals, navigation charts',
        },
    },

    // ─────────────────────────────────────────────
    // CULTURAL EVENTS (generated periodically)
    // ─────────────────────────────────────────────

    CULTURAL_EVENTS: [
        { id: 'grand_festival', name: 'Grand Festival', icon: '🎉', effect: 'morale', value: 15, cost: 300, description: 'A kingdom-wide celebration of art and music' },
        { id: 'book_fair', name: 'Book Fair', icon: '📖', effect: 'scholarship', value: 10, cost: 150, description: 'Scholars and scribes gather to trade manuscripts' },
        { id: 'bardic_competition', name: 'Bardic Competition', icon: '🎵', effect: 'renown', value: 8, cost: 200, description: 'The finest bards compete for glory and patronage' },
        { id: 'philosophical_debate', name: 'Philosophical Debate', icon: '💭', effect: 'scholarship', value: 12, cost: 100, description: 'Great minds clash over fundamental questions' },
        { id: 'art_exhibition', name: 'Art Exhibition', icon: '🎨', effect: 'influence', value: 10, cost: 250, description: 'Masterworks displayed for public admiration' },
    ],

    // ─────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────

    /**
     * Assign cultural data to kingdoms at world gen.
     */
    initialize(world) {
        for (const kingdom of world.kingdoms) {
            const tradition = Culture.TRADITIONS[kingdom.culture] || Culture.TRADITIONS.Imperial;
            kingdom.cultureData = {
                tradition: tradition,
                influence: Utils.randInt(10, 40),     // 0-100
                scholarship: Utils.randInt(5, 25),    // 0-100
                culturalBuildings: [],                 // [{q,r,type}]
                events: [],                            // active cultural events
            };
        }

        // Generate cultural history
        Culture.generateCulturalHistory(world);
    },

    // ─────────────────────────────────────────────
    // CULTURAL HISTORY
    // ─────────────────────────────────────────────

    generateCulturalHistory(world) {
        const events = [
            { year: Utils.randInt(50, 100), text: '📚 The first written scripts emerged, replacing oral tradition across several kingdoms.' },
            { year: Utils.randInt(150, 250), text: '🎭 The Golden Age of Drama: traveling theater troupes brought stories to every corner of the realms.' },
            { year: Utils.randInt(300, 400), text: '🏫 The first universities were founded, marking the dawn of systematic scholarship.' },
            { year: Utils.randInt(450, 550), text: '📜 The Great Library was established, housing thousands of manuscripts from all cultures.' },
            { year: Utils.randInt(550, 650), text: '🎵 The Bardic Traditions were codified — wandering bards became keepers of history.' },
            { year: Utils.randInt(650, 750), text: '🎨 A Renaissance of art swept through the realms, producing masterworks still celebrated today.' },
            { year: Utils.randInt(750, 840), text: '💡 New philosophical movements challenged old assumptions, sparking an era of intellectual ferment.' },
        ];

        for (const event of events) {
            if (event.year < (world.year || 853)) {
                world.history.push(event);
            }
        }

        // Kingdom-specific cultural milestones
        for (const kingdom of world.kingdoms) {
            const milestoneYear = kingdom.foundedDay
                ? world.baseYear + Math.floor(kingdom.foundedDay / 120)
                : Utils.randInt(400, 700);

            if (milestoneYear < (world.year || 853)) {
                const tradition = Culture.TRADITIONS[kingdom.culture];
                world.history.push({
                    year: milestoneYear,
                    text: `${tradition ? tradition.icon : '🏛️'} ${kingdom.name} codified its ${kingdom.culture} cultural traditions, establishing schools and artistic guilds.`,
                });
            }
        }

        world.history.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DAILY PROCESSING
    // ─────────────────────────────────────────────

    processTurn(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.cultureData) continue;

            // 1. Scholarship growth from buildings
            let scholarshipGrowth = 0;
            for (const bRef of kingdom.cultureData.culturalBuildings) {
                const tile = world.getTile(bRef.q, bRef.r);
                if (!tile || !tile.culturalBuilding) continue;
                if (tile.culturalBuilding.underConstruction) continue;
                scholarshipGrowth += tile.culturalBuilding.scholarshipBonus * 0.05;
            }
            kingdom.cultureData.scholarship = Math.min(100,
                kingdom.cultureData.scholarship + scholarshipGrowth + Utils.randFloat(-0.1, 0.3)
            );

            // 2. Influence spread from cultural buildings
            let influenceGrowth = 0;
            for (const bRef of kingdom.cultureData.culturalBuildings) {
                const tile = world.getTile(bRef.q, bRef.r);
                if (!tile || !tile.culturalBuilding) continue;
                if (tile.culturalBuilding.underConstruction) continue;
                influenceGrowth += tile.culturalBuilding.influencePerDay * 0.1;
            }
            kingdom.cultureData.influence = Math.min(100,
                kingdom.cultureData.influence + influenceGrowth + Utils.randFloat(-0.05, 0.15)
            );

            // 3. Random cultural events (1% per day)
            if (Math.random() < 0.01 && kingdom.cultureData.events.length < 2) {
                const evt = Utils.randPick(Culture.CULTURAL_EVENTS);
                if (kingdom.treasury >= evt.cost) {
                    kingdom.treasury -= evt.cost;
                    kingdom.cultureData.events.push({ ...evt, daysLeft: Utils.randInt(3, 7) });
                    world.events.push({
                        category: 'cultural',
                        text: `${evt.icon} ${kingdom.name}: ${evt.name}! ${evt.description}`,
                        kingdom: kingdom.id,
                        impact: 'positive',
                    });
                }
            }

            // 4. Expire finished events
            for (let i = kingdom.cultureData.events.length - 1; i >= 0; i--) {
                kingdom.cultureData.events[i].daysLeft--;
                if (kingdom.cultureData.events[i].daysLeft <= 0) {
                    kingdom.cultureData.events.splice(i, 1);
                }
            }
        }
    },

    // ─────────────────────────────────────────────
    // PLAYER CULTURAL BUILDINGS
    // ─────────────────────────────────────────────

    /**
     * Build a cultural building (player action)
     */
    buildCulturalBuilding(player, buildingType, tile, world) {
        const type = Culture.BUILDING_TYPES[buildingType.toUpperCase()];
        if (!type) return { success: false, reason: 'Unknown building type' };

        if (player.gold < type.cost) {
            return { success: false, reason: `Need ${type.cost} gold (have ${Math.floor(player.gold)})` };
        }

        if (!tile.terrain.passable) {
            return { success: false, reason: 'Cannot build on this terrain' };
        }

        if (tile.culturalBuilding || tile.playerProperty || tile.religiousBuilding) {
            return { success: false, reason: 'Tile already has a building' };
        }

        if (type.requiredSettlement && !tile.settlement) {
            return { success: false, reason: 'Must be built in a settlement' };
        }

        if (type.requiredPopulation && tile.settlement && tile.settlement.population < type.requiredPopulation) {
            return { success: false, reason: `Settlement needs at least ${type.requiredPopulation} population` };
        }

        player.gold -= type.cost;

        const constructionDays = type.constructionDays || 0;

        tile.culturalBuilding = {
            type: type.id,
            name: type.name,
            icon: type.icon,
            owner: 'player',
            influencePerDay: type.influencePerDay,
            influenceRadius: type.influenceRadius,
            scholarshipBonus: type.scholarshipBonus,
            researchBonus: type.researchBonus || 0,
            moraleBonus: type.moraleBonus || 0,
            renownPerDay: type.renownPerDay || 0,
            incomeBonus: type.incomeBonus || 0,
            level: 1,
            underConstruction: constructionDays > 0,
            constructionDaysLeft: constructionDays,
            constructionDaysTotal: constructionDays,
        };

        // Track for player
        if (!player.culturalBuildings) player.culturalBuildings = [];
        player.culturalBuildings.push({ q: tile.q, r: tile.r, type: type.id });

        // Boost intelligence
        player.intelligence = Math.min(10, player.intelligence + 0.3);

        return { success: true, building: tile.culturalBuilding, underConstruction: constructionDays > 0, constructionDays };
    },

    /**
     * Process daily culture income & bonuses for the player
     */
    processPlayerCulture(player, world) {
        if (!player.culturalBuildings || player.culturalBuildings.length === 0) return {
            income: 0, renown: 0, researchBonus: 0,
        };

        let totalIncome = 0;
        let totalRenown = 0;
        let totalResearchBonus = 0;

        for (const bRef of player.culturalBuildings) {
            const tile = world.getTile(bRef.q, bRef.r);
            if (!tile || !tile.culturalBuilding) continue;
            if (tile.culturalBuilding.underConstruction) continue; // Still being built

            const b = tile.culturalBuilding;
            totalIncome += b.incomeBonus * b.level * 0.1;

            if (b.renownPerDay) {
                totalRenown += b.renownPerDay * b.level;
            }

            if (b.researchBonus) {
                totalResearchBonus += b.researchBonus;
            }
        }

        totalIncome = Math.floor(totalIncome);
        player.gold += totalIncome;
        player.renown += totalRenown;

        return { income: totalIncome, renown: totalRenown, researchBonus: totalResearchBonus };
    },

    /**
     * Get combined research bonus from player's cultural buildings
     */
    getResearchBonus(player, world) {
        if (!player.culturalBuildings) return 0;
        let bonus = 0;
        for (const bRef of player.culturalBuildings) {
            const tile = world.getTile(bRef.q, bRef.r);
            if (!tile || !tile.culturalBuilding) continue;
            if (tile.culturalBuilding.underConstruction) continue;
            bonus += tile.culturalBuilding.researchBonus || 0;
        }
        return bonus;
    },

    /**
     * Get player's total cultural influence
     */
    getInfluence(player, world) {
        if (!player.culturalBuildings) return 0;
        let total = 0;
        for (const bRef of player.culturalBuildings) {
            const tile = world.getTile(bRef.q, bRef.r);
            if (!tile || !tile.culturalBuilding) continue;
            if (tile.culturalBuilding.underConstruction) continue;
            total += tile.culturalBuilding.influencePerDay * tile.culturalBuilding.level;
        }
        return total;
    },
};
