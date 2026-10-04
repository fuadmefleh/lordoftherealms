// ============================================
// CULTURE — Cultural buildings & influence system
// ============================================

import { Utils } from '../core/utils.js';
import { Technology } from './technology.js';
import { KingdomCulture } from '../world/kingdomState.js';


export const Culture = {

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
                culturalBuildings: [],                 // kingdom-built: [{q,r,type,name,icon,...}]
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

    /**
     * Kingdom cultural buildings. A realm occasionally commissions one in a
     * town that has none, paying from its treasury only when it holds a
     * comfortable reserve (cost × reserveMult) so war chests aren't drained.
     */
    KINGDOM_BUILDING: { maxPerKingdom: 3, dailyChance: 1 / 90, reserveMult: 3 },

    processTurn(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.cultureData) continue;
            const cd = kingdom.cultureData;
            if (!Array.isArray(cd.culturalBuildings)) cd.culturalBuildings = [];
            if (!Array.isArray(cd.events)) cd.events = [];

            // A fallen realm's buildings pass to whoever holds the town
            if (!kingdom.isAlive) {
                Culture._tickKingdomBuildings(kingdom, world);
                continue;
            }

            // 1-2. Scholarship and influence growth from finished buildings
            const growth = Culture._tickKingdomBuildings(kingdom, world);
            cd.scholarship = Math.min(100,
                cd.scholarship + growth.scholarship + Utils.randFloat(-0.1, 0.3)
            );
            cd.influence = Math.min(100,
                cd.influence + growth.influence + Utils.randFloat(-0.05, 0.15)
            );

            // 3. Random cultural events (1% per day). Their effects are read
            //    while they run by KingdomCulture (world/kingdomState.js).
            if (Utils.random() < 0.01 && cd.events.length < 2) {
                const evt = Utils.randPick(Culture.CULTURAL_EVENTS);
                if (kingdom.treasury >= evt.cost) {
                    kingdom.treasury -= evt.cost;
                    cd.events.push({ ...evt, daysLeft: Utils.randInt(3, 7) });
                    world.events.push({
                        category: 'cultural',
                        text: `${evt.icon} ${kingdom.name}: ${evt.name}! ${evt.description}`,
                        kingdom: kingdom.id,
                        impact: 'positive',
                    });
                }
            }

            // 4. Expire finished events
            for (let i = cd.events.length - 1; i >= 0; i--) {
                cd.events[i].daysLeft--;
                if (cd.events[i].daysLeft <= 0) {
                    cd.events.splice(i, 1);
                }
            }

            // 5. Commission a new cultural building now and then
            Culture.considerKingdomBuilding(kingdom, world);
        }
    },

    /**
     * Advance a kingdom's buildings one day: hand captured ones to the town's
     * new owner, count down construction, and return the day's scholarship
     * (scholarshipBonus × 0.05) and influence (influencePerDay × 0.1) growth.
     */
    _tickKingdomBuildings(kingdom, world) {
        const out = { scholarship: 0, influence: 0 };
        const list = kingdom.cultureData.culturalBuildings;
        for (let i = list.length - 1; i >= 0; i--) {
            const b = list[i];
            const tile = world.getTile(b.q, b.r);
            const holder = tile && tile.settlement ? tile.settlement.kingdom : null;
            if (holder !== kingdom.id) {
                list.splice(i, 1);
                const captor = holder != null && world.getKingdom ? world.getKingdom(holder) : null;
                if (captor && captor.isAlive && captor.cultureData && Array.isArray(captor.cultureData.culturalBuildings)) {
                    captor.cultureData.culturalBuildings.push(b);
                }
                continue;
            }
            if (!kingdom.isAlive) continue;
            if (b.underConstruction) {
                b.constructionDaysLeft = (b.constructionDaysLeft || 0) - 1;
                if (b.constructionDaysLeft <= 0) {
                    b.underConstruction = false;
                    b.constructionDaysLeft = 0;
                }
                continue;
            }
            out.scholarship += (b.scholarshipBonus || 0) * 0.05;
            out.influence += (b.influencePerDay || 0) * 0.1;
        }
        return out;
    },

    /** Maybe commission a cultural building in one of the kingdom's towns. Returns it, or null. */
    considerKingdomBuilding(kingdom, world) {
        const cfg = Culture.KINGDOM_BUILDING;
        const cd = kingdom.cultureData;
        if (cd.culturalBuildings.length >= cfg.maxPerKingdom) return null;
        if (Utils.random() >= cfg.dailyChance) return null;

        const sites = world.getAllSettlements().filter(s => s.kingdom === kingdom.id
            && !cd.culturalBuildings.some(b => b.q === s.q && b.r === s.r));
        if (sites.length === 0) return null;
        const site = Utils.randPick(sites);
        const treasury = kingdom.treasury || 0;
        const options = Object.values(Culture.BUILDING_TYPES).filter(t => treasury >= t.cost * cfg.reserveMult
            && (!t.requiredPopulation || (site.population || 0) >= t.requiredPopulation));
        if (options.length === 0) return null;
        const type = Utils.randPick(options);

        kingdom.treasury = treasury - type.cost;
        const days = type.constructionDays || 0;
        const building = {
            q: site.q,
            r: site.r,
            type: type.id,
            name: type.name,
            icon: type.icon,
            scholarshipBonus: type.scholarshipBonus || 0,
            influencePerDay: type.influencePerDay || 0,
            underConstruction: days > 0,
            constructionDaysLeft: days,
        };
        cd.culturalBuildings.push(building);
        if (Array.isArray(world.events)) {
            world.events.push({
                category: 'cultural',
                text: `${type.icon} ${kingdom.name} begins building a ${type.name} in ${site.name || 'one of its towns'}.`,
                kingdom: kingdom.id,
                impact: 'positive',
            });
        }
        return building;
    },

    /** What each cultural event effect does while it runs (see KingdomCulture). */
    EVENT_EFFECTS: {
        morale: 'stability and battle morale',
        scholarship: 'scholarship',
        research: 'scholarship',
        influence: 'cultural influence',
        renown: 'diplomacy',
        industry: 'construction and income',
        trade: 'trade routes and income',
        faith: 'piety',
    },

    /**
     * Display summary of a kingdom's culture: its buildings, running events
     * and what scholarship/influence currently do for it.
     */
    describeKingdom(kingdom) {
        const cd = kingdom && kingdom.cultureData;
        if (!cd) return { buildings: [], events: [], effects: [] };
        const pct = v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
        const stab = KingdomCulture.stabilityMod(kingdom);
        return {
            buildings: (cd.culturalBuildings || []).map(b => `${b.icon} ${b.name}${b.underConstruction ? ' (building)' : ''}`),
            events: (cd.events || []).map(e => `${e.icon} ${e.name}: +${e.value} ${Culture.EVENT_EFFECTS[e.effect] || e.effect} (${e.daysLeft}d)`),
            effects: [
                `Income ${pct(KingdomCulture.bonus(kingdom, 'stewardship') * 0.5 + KingdomCulture.bonus(kingdom, 'treasury'))}`,
                `Construction ${pct(KingdomCulture.bonus(kingdom, 'construction'))}`,
                `Diplomacy +${Math.floor(KingdomCulture.bonus(kingdom, 'diplomacy') * 10)}/envoy`,
                `Stability ${stab >= 0 ? '+' : ''}${Math.round(stab)}`,
            ],
        };
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

    // ─────────────────────────────────────────────
    // LEVELS & UPGRADES
    // ─────────────────────────────────────────────

    /**
     * A cultural building can be raised to level 3. Going from level L to
     * L+1 costs cost × 0.5 × L gold (Library: 300, then 600). Income, renown
     * and influence scale with the level; research and morale gain +50% per
     * level above 1.
     */
    LEVELS: { max: 3, upgradeCostFactor: 0.5, perLevelBonus: 0.5 },

    /** Multiplier on research and morale bonuses for a building's level. */
    levelMultiplier(building) {
        const level = Math.max(1, (building && building.level) || 1);
        return 1 + Culture.LEVELS.perLevelBonus * (level - 1);
    },

    /** Gold per day a finished building pays before tech multipliers (incomeBonus × level × 0.1). */
    dailyIncome(building) {
        if (!building) return 0;
        return (building.incomeBonus || 0) * Math.max(1, building.level || 1) * 0.1;
    },

    /** Gold to raise a building one level, or null at the cap / unknown type. */
    getUpgradeCost(building) {
        if (!building) return null;
        const level = Math.max(1, building.level || 1);
        if (level >= Culture.LEVELS.max) return null;
        const type = Object.values(Culture.BUILDING_TYPES).find(t => t.id === building.type);
        if (!type) return null;
        return Math.round(type.cost * Culture.LEVELS.upgradeCostFactor * level);
    },

    /** Can the player upgrade the cultural building on this tile? { can, cost, reason } */
    canUpgrade(player, tile) {
        const b = tile && tile.culturalBuilding;
        if (!b || b.owner !== 'player') return { can: false, reason: 'You do not own a cultural building here' };
        if (b.underConstruction) return { can: false, reason: 'Still under construction' };
        const cost = Culture.getUpgradeCost(b);
        if (cost === null) return { can: false, reason: 'Already at the highest level' };
        if ((player.gold || 0) < cost) return { can: false, cost, reason: `Need ${cost} gold (have ${Math.floor(player.gold || 0)})` };
        return { can: true, cost };
    },

    /** Pay gold to raise the player's cultural building on this tile one level. */
    upgradeCulturalBuilding(player, tile) {
        const check = Culture.canUpgrade(player, tile);
        if (!check.can) return { success: false, reason: check.reason };
        const b = tile.culturalBuilding;
        player.gold -= check.cost;
        b.level = Math.max(1, b.level || 1) + 1;
        return { success: true, building: b, level: b.level, cost: check.cost };
    },

    /**
     * Process daily culture income & bonuses for the player. Income is
     * dailyIncome() per finished building × the culture tech multiplier;
     * fractions carry over to the next day so a 1.5/day Library really
     * pays 3 gold every 2 days.
     */
    processPlayerCulture(player, world) {
        if (!player.culturalBuildings || player.culturalBuildings.length === 0) return {
            income: 0, renown: 0, researchBonus: 0,
        };

        let totalIncome = 0;
        let totalRenown = 0;
        // Philosophy and the printing press amplify your cultural buildings
        const cultureMult = 1 + Technology.getEffectTotal(player, 'cultureBonus');

        for (const bRef of player.culturalBuildings) {
            const tile = world.getTile(bRef.q, bRef.r);
            if (!tile || !tile.culturalBuilding) continue;
            if (tile.culturalBuilding.underConstruction) continue; // Still being built

            const b = tile.culturalBuilding;
            totalIncome += Culture.dailyIncome(b);

            if (b.renownPerDay) {
                totalRenown += b.renownPerDay * Math.max(1, b.level || 1);
            }
        }

        const owed = totalIncome * cultureMult + (player.cultureIncomeCarry || 0);
        const income = Math.floor(owed);
        player.cultureIncomeCarry = owed - income;
        totalRenown *= cultureMult;
        player.gold += income;
        player.renown += totalRenown;

        return { income, renown: totalRenown, researchBonus: Culture.getResearchBonus(player, world) };
    },

    /**
     * Combined research bonus from the player's finished cultural buildings
     * (Library +15%, University +30%, Scriptorium +10%, +50% each per level
     * above 1, capped at +50%). Technology.getResearchBonus folds it into
     * research time.
     */
    getResearchBonus(player, world) {
        return Technology.getCulturalResearchBonus(player, world);
    },

    /**
     * Army morale from the player's finished theaters: each adds
     * moraleBonus / 500 (+0.02 for a Theater, +50% per level above 1),
     * capped at +0.06 — on the same scale as a festival's morale boost
     * (0.03–0.08).
     */
    getMoraleBonus(player, world) {
        if (!player.culturalBuildings || !world) return 0;
        let bonus = 0;
        for (const bRef of player.culturalBuildings) {
            const tile = world.getTile(bRef.q, bRef.r);
            if (!tile || !tile.culturalBuilding) continue;
            if (tile.culturalBuilding.underConstruction) continue;
            bonus += (tile.culturalBuilding.moraleBonus || 0) / 500 * Culture.levelMultiplier(tile.culturalBuilding);
        }
        return Math.min(0.06, bonus);
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
            total += tile.culturalBuilding.influencePerDay * Math.max(1, tile.culturalBuilding.level || 1);
        }
        return total;
    },
};
