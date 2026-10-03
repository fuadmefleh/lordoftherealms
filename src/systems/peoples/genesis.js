// Peoples — genesis members (split from the original monolith).
import { Peoples } from './_ref.js';
import { Utils, Kingdom } from './_imports.js';

Object.assign(Peoples, {
    // ─────────────────────────────────────────────
    // ANCIENT TRIBAL ROOTS — The founding peoples
    // ─────────────────────────────────────────────
    TRIBAL_ROOTS: {
        // Imperial subcultures
        ironborn: {
            id: 'ironborn', name: 'Ironborn', parentCulture: 'Imperial',
            icon: '⚒️', color: '#8b8b8b',
            origin: 'mountain forges', homeland: 'highlands',
            traits: ['industrious', 'stubborn', 'proud'],
            customs: ['Forge-Lighting Ceremony', 'Anvil Oaths', 'Iron Blessing of Newborns'],
            cuisine: ['smoked meats', 'root stews', 'hearth bread', 'iron-kettle ale'],
            artForms: ['metalwork', 'stone carving', 'war chants'],
            proverb: '"Iron remembers every hammer stroke."',
            ancestralMemory: 'The Ironborn remember the First Forge, deep in the Ashpeak mountains, where their ancestors tamed fire and steel.',
            values: { craftsmanship: 9, honor: 7, tradition: 8 },
        },
        crownlanders: {
            id: 'crownlanders', name: 'Crownlanders', parentCulture: 'Imperial',
            icon: '👑', color: '#d4af37',
            origin: 'river valleys', homeland: 'plains',
            traits: ['diplomatic', 'ambitious', 'literate'],
            customs: ['Court Assemblies', 'Harvest Tithe Festival', 'The Grand Procession'],
            cuisine: ['wheat bread', 'honeyed wine', 'roast fowl', 'cheese wheels'],
            artForms: ['calligraphy', 'tapestry weaving', 'courtly music'],
            proverb: '"A crown is earned at the table, not the battlefield."',
            ancestralMemory: 'The Crownlanders trace their line to the River Council, where seven chieftains broke bread and swore the First Compact.',
            values: { diplomacy: 9, learning: 8, ambition: 7 },
        },
        shieldfolk: {
            id: 'shieldfolk', name: 'Shieldfolk', parentCulture: 'Imperial',
            icon: '🛡️', color: '#c0392b',
            origin: 'border marches', homeland: 'hills',
            traits: ['vigilant', 'loyal', 'martial'],
            customs: ['The Vigil of Shields', 'Border Blessing', 'Scar Stories'],
            cuisine: ['salted pork', 'campaign bread', 'watchtower soup', 'mead'],
            artForms: ['shield painting', 'ballads of valor', 'siege engineering'],
            proverb: '"We sleep so others may not."',
            ancestralMemory: 'The Shieldfolk were born from the Wardens who stood against the Shadow Tide, holding the passes when all seemed lost.',
            values: { duty: 10, courage: 9, sacrifice: 8 },
        },

        // Woodland subcultures
        mosswalkers: {
            id: 'mosswalkers', name: 'Mosswalkers', parentCulture: 'Woodland',
            icon: '🌿', color: '#27ae60',
            origin: 'deep forest floors', homeland: 'forest',
            traits: ['quiet', 'observant', 'patient'],
            customs: ['Whispering Rites', 'Mushroom Circles', 'Tree-Naming Ceremonies'],
            cuisine: ['forest mushroom broths', 'moss tea', 'acorn cakes', 'wild berry preserves'],
            artForms: ['moss gardens', 'root weaving', 'whisper songs'],
            proverb: '"The forest speaks to those who learn to be still."',
            ancestralMemory: 'The Mosswalkers believe they were the first to hear the Heartwood sing — the deep vibration of the oldest tree in creation.',
            values: { harmony: 10, patience: 9, stewardship: 8 },
        },
        canopiers: {
            id: 'canopiers', name: 'Canopiers', parentCulture: 'Woodland',
            icon: '🌳', color: '#2ecc71',
            origin: 'treetop villages', homeland: 'dense_forest',
            traits: ['agile', 'daring', 'free-spirited'],
            customs: ['Sky Dances', 'Vine-Jumping Trials', 'Canopy Markets'],
            cuisine: ['sun-dried fruits', 'honeycomb', 'bird eggs', 'leaf-wrapped fish'],
            artForms: ['aerial acrobatics', 'wood flute music', 'bark painting'],
            proverb: '"Those who fear falling never learn to fly."',
            ancestralMemory: 'The Canopiers say their first mother climbed the World-Tree and never came down, building the first sky-village among its branches.',
            values: { freedom: 10, courage: 7, joy: 9 },
        },
        rootkeepers: {
            id: 'rootkeepers', name: 'Rootkeepers', parentCulture: 'Woodland',
            icon: '🌱', color: '#1abc9c',
            origin: 'sacred groves', homeland: 'forest',
            traits: ['wise', 'mystical', 'reclusive'],
            customs: ['Planting Moon Festival', 'Seed Memory Rituals', 'Bark Reading'],
            cuisine: ['herbal stews', 'elderflower wine', 'root vegetables', 'sap syrup'],
            artForms: ['herbalism', 'prophecy chanting', 'living sculpture (trained vines)'],
            proverb: '"Every oak was once an acorn with the courage to grow."',
            ancestralMemory: 'The Rootkeepers guard the Seed Vaults — ancient caches of every plant that ever lived, hidden in root caverns.',
            values: { wisdom: 10, spirituality: 9, preservation: 8 },
        },

        // Nomadic subcultures
        windrunners: {
            id: 'windrunners', name: 'Windrunners', parentCulture: 'Nomadic',
            icon: '🌬️', color: '#3498db',
            origin: 'open steppe', homeland: 'plains',
            traits: ['restless', 'swift', 'passionate'],
            customs: ['Storm Chasing', 'Horse Breaking Ceremonies', 'Wind Songs'],
            cuisine: ['mare milk', 'dried jerky', 'steppe berries', 'fermented grain drink'],
            artForms: ['throat singing', 'horseback archery displays', 'felt embroidery'],
            proverb: '"A Windrunner tied down is a Windrunner already dead."',
            ancestralMemory: 'They say the first Windrunner caught the tail of a cyclone and rode it across the steppe, mapping every horizon.',
            values: { freedom: 10, endurance: 9, wanderlust: 8 },
        },
        sandshapers: {
            id: 'sandshapers', name: 'Sandshapers', parentCulture: 'Nomadic',
            icon: '🏜️', color: '#e67e22',
            origin: 'desert oases', homeland: 'desert',
            traits: ['resourceful', 'secretive', 'resilient'],
            customs: ['Water Sharing Oaths', 'Sand Paintings', 'Star Navigation Rites'],
            cuisine: ['flatbread', 'date paste', 'spiced camel milk', 'honeyed locusts'],
            artForms: ['sand sculpture', 'astronomical charts', 'desert glass jewelry'],
            proverb: '"The desert gives nothing freely — and teaches everything."',
            ancestralMemory: 'The Sandshapers remember the Year of Glass, when lightning struck the great dunes and their ancestors forged the first desert-glass mirrors.',
            values: { resilience: 10, knowledge: 8, community: 7 },
        },
        bonecarvers: {
            id: 'bonecarvers', name: 'Bonecarvers', parentCulture: 'Nomadic',
            icon: '🦴', color: '#d35400',
            origin: 'hunting grounds', homeland: 'savanna',
            traits: ['fierce', 'respectful of nature', 'spiritual'],
            customs: ['Hunt Blessings', 'Bone Oracle Readings', 'Ancestor Mask Wearing'],
            cuisine: ['fire-roasted game', 'bone marrow soup', 'wild grain porridge', 'blood sausage'],
            artForms: ['bone carving', 'animal mask crafting', 'war drumming'],
            proverb: '"Honor the beast, and its spirit will run with you forever."',
            ancestralMemory: 'The Bonecarvers carry the Great Tusk — a mammoth bone inscribed with the names of every tribe elder for a thousand years.',
            values: { respect: 9, strength: 8, ancestry: 10 },
        },

        // Religious subcultures
        sunweavers: {
            id: 'sunweavers', name: 'Sunweavers', parentCulture: 'Religious',
            icon: '☀️', color: '#f1c40f',
            origin: 'hilltop temples', homeland: 'hills',
            traits: ['devout', 'joyful', 'generous'],
            customs: ['Dawn Chorus', 'Light Festivals', 'Sun Cloth Weaving'],
            cuisine: ['saffron rice', 'golden honey cakes', 'marigold tea', 'sun-dried tomatoes'],
            artForms: ['gold-thread textiles', 'sunrise paintings', 'hymn composition'],
            proverb: '"Every dawn is proof that darkness cannot last."',
            ancestralMemory: 'The Sunweavers tell of a time when the sun died for three days, and their ancestor wove a cloth of pure light to call it back.',
            values: { faith: 10, generosity: 9, hope: 8 },
        },
        ashpilgrims: {
            id: 'ashpilgrims', name: 'Ashpilgrims', parentCulture: 'Religious',
            icon: '🕯️', color: '#95a5a6',
            origin: 'volcanic monasteries', homeland: 'mountains',
            traits: ['contemplative', 'austere', 'fearless'],
            customs: ['Ash Fasting', 'Ember Walking', 'Silence Weeks'],
            cuisine: ['ash bread', 'mineral water', 'smoked lentils', 'bitter herb tea'],
            artForms: ['fire poetry', 'obsidian sculpting', 'chant meditation'],
            proverb: '"Through the ashes, truth."',
            ancestralMemory: 'The Ashpilgrims were born when a volcano buried their village. The survivors walked through the ash for forty days and emerged enlightened.',
            values: { endurance: 10, truth: 9, humility: 8 },
        },
        starcallers: {
            id: 'starcallers', name: 'Starcallers', parentCulture: 'Religious',
            icon: '⭐', color: '#9b59b6',
            origin: 'observatory towers', homeland: 'plains',
            traits: ['intellectual', 'mystical', 'visionary'],
            customs: ['Constellation Naming', 'Eclipse Rituals', 'Starfall Prayers'],
            cuisine: ['midnight berries', 'silver-leaf tea', 'starfruit wine', 'moonbread'],
            artForms: ['celestial cartography', 'astral poetry', 'crystal lens crafting'],
            proverb: '"We are all stardust, remembering where we came from."',
            ancestralMemory: 'The Starcallers claim their founder once climbed a tower so high she touched the stars and brought back a fragment of cosmic truth.',
            values: { knowledge: 10, wonder: 9, vision: 8 },
        },

        // Maritime subcultures
        tidecallers: {
            id: 'tidecallers', name: 'Tidecallers', parentCulture: 'Maritime',
            icon: '🌊', color: '#2980b9',
            origin: 'tidal flats', homeland: 'coast',
            traits: ['intuitive', 'adaptable', 'communal'],
            customs: ['Tide Reading', 'Shell Offering', 'Storm Vigils'],
            cuisine: ['seaweed wraps', 'shellfish chowder', 'salted fish', 'kelp beer'],
            artForms: ['shell mosaic', 'wave music (sea-organ)', 'tide prediction'],
            proverb: '"The tide waits for no one, but rewards those who know its rhythm."',
            ancestralMemory: 'The Tidecallers built the first sea-wall — a living barrier of coral and stone that protected their village from the Great Tsunami.',
            values: { adaptability: 10, community: 9, intuition: 8 },
        },
        deepdivers: {
            id: 'deepdivers', name: 'Deepdivers', parentCulture: 'Maritime',
            icon: '🐚', color: '#1f6f8b',
            origin: 'pearl beds', homeland: 'coast',
            traits: ['brave', 'secretive', 'wealthy'],
            customs: ['First Dive Ceremonies', 'Pearl Gifting', 'Deep Breath Competitions'],
            cuisine: ['raw fish', 'pearl oysters', 'coral tea', 'sea cucumber delicacies'],
            artForms: ['pearl jewelry', 'underwater sculpture', 'diving ballads'],
            proverb: '"The greatest treasures are found where others fear to go."',
            ancestralMemory: 'The Deepdivers discovered the Sunken City — an ancient civilization beneath the waves — and traded its secrets for generations.',
            values: { courage: 10, discovery: 9, secrecy: 7 },
        },
        sailweavers: {
            id: 'sailweavers', name: 'Sailweavers', parentCulture: 'Maritime',
            icon: '⛵', color: '#48c9b0',
            origin: 'shipyard coves', homeland: 'coast',
            traits: ['inventive', 'social', 'mercantile'],
            customs: ['Ship Christening', 'Harbor Festivals', 'Trade Wind Prayers'],
            cuisine: ['rum-glazed fish', 'ship biscuit', 'tropical fruit platters', 'spiced cider'],
            artForms: ['sail painting', 'sea shanty composition', 'ship figure carving'],
            proverb: '"A good ship and a fair wind — what more could the heart desire?"',
            ancestralMemory: 'The Sailweavers built the Eternal Fleet — ships so masterfully crafted that some still sail, crewed by the descendants of their original builders.',
            values: { craftsmanship: 9, adventure: 8, commerce: 10 },
        },
    },

    // ─────────────────────────────────────────────
    // CULTURAL EVOLUTION STAGES
    // ─────────────────────────────────────────────
    EVOLUTION_STAGES: [
        { id: 'nomadic_band', name: 'Nomadic Band', population: [10, 50], icon: '🏕️', description: 'Small kinship groups wandering the land' },
        { id: 'tribal_camp', name: 'Tribal Camp', population: [50, 200], icon: '⛺', description: 'Seasonal camps where tribes gather for trade and marriage' },
        { id: 'chiefdom', name: 'Chiefdom', population: [200, 500], icon: '🦅', description: 'A powerful chief unites several bands under one rule' },
        { id: 'village', name: 'Village', population: [500, 2000], icon: '🏘️', description: 'Settled communities with shared governance and craft specialization' },
        { id: 'town', name: 'Town', population: [2000, 5000], icon: '🏙️', description: 'A thriving hub where multiple peoples have intermingled for generations' },
        { id: 'city', name: 'City', population: [5000, 15000], icon: '🏰', description: 'A great city where diverse subcultures form distinct quarters and guilds' },
        { id: 'metropolis', name: 'Metropolis', population: [15000, 50000], icon: '🌆', description: 'A cosmopolitan center where cultures fuse into something new' },
    ],

    // ─────────────────────────────────────────────
    // INTER-CULTURAL DYNAMICS
    // ─────────────────────────────────────────────
    INTERACTION_TYPES: {
        TRADE: { id: 'trade', name: 'Trade Exchange', icon: '🤝', harmonyBonus: 2, description: 'Subcultures trading goods and techniques' },
        FESTIVAL: { id: 'festival', name: 'Joint Festival', icon: '🎊', harmonyBonus: 5, description: 'Celebrating together builds bonds across cultural lines' },
        INTERMARRIAGE: { id: 'intermarriage', name: 'Intermarriage', icon: '💒', harmonyBonus: 3, description: 'Families joined across tribal lines' },
        SHARED_DEFENSE: { id: 'shared_defense', name: 'Shared Defense', icon: '🛡️', harmonyBonus: 8, description: 'Standing together against a common threat forges deep unity' },
        RIVALRY: { id: 'rivalry', name: 'Cultural Rivalry', icon: '⚔️', harmonyBonus: -5, description: 'Old grudges and competing traditions cause friction' },
        RELIGIOUS_RIFT: { id: 'religious_rift', name: 'Religious Rift', icon: '⛪', harmonyBonus: -4, description: 'Differing spiritual practices create division' },
        CUISINE_FUSION: { id: 'cuisine_fusion', name: 'Cuisine Fusion', icon: '🍲', harmonyBonus: 3, description: 'Blending culinary traditions creates beloved new dishes' },
        ART_EXCHANGE: { id: 'art_exchange', name: 'Artistic Exchange', icon: '🎨', harmonyBonus: 4, description: 'Artists from different traditions inspire each other' },
    },

    // ─────────────────────────────────────────────
    // HYBRID CULTURE GENERATION
    // ─────────────────────────────────────────────
    HYBRID_PREFIXES: ['Neo-', 'Greater ', 'Free ', 'United ', 'New '],

    HYBRID_SUFFIXES: [' Compact', ' Fellowship', ' Accord', ' Confluence', ' Hearth'],

    // ─────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────
    /**
     * Initialize the multicultural peoples system for the entire world.
     * Called during world generation.
     */
    initialize(world) {
        // 1. Generate the ancient tribal history
        Peoples.generateTribalGenesis(world);

        // 2. Assign demographic populations to every settlement
        Peoples.populateSettlements(world);

        // 3. Generate the cultural evolution history (tribes → villages → kingdoms)
        Peoples.generateCulturalEvolution(world);

        // 4. Generate cultural landmarks & diaspora events
        Peoples.generateDiasporaHistory(world);

        console.log('[Peoples] Multicultural society initialized');
    },

    // ─────────────────────────────────────────────
    // TRIBAL GENESIS — Deep history generation
    // ─────────────────────────────────────────────
    /**
     * Generate the origin stories of each tribe and when they arrived at their homeland.
     */
    generateTribalGenesis(world) {
        world.tribalHistory = [];
        const genesisYear = Utils.randInt(1, 30);

        // The Great Awakening — all peoples emerge
        world.tribalHistory.push({
            year: genesisYear,
            text: '🌅 The Great Awakening: Across the land, scattered bands of people emerge from the wilds — each carrying the seeds of a unique culture.',
            type: 'genesis',
        });

        // Each tribal root gets an origin event
        const tribes = Object.values(Peoples.TRIBAL_ROOTS);
        for (const tribe of tribes) {
            const year = Utils.randInt(genesisYear + 5, genesisYear + 80);
            world.tribalHistory.push({
                year,
                text: `${tribe.icon} The ${tribe.name} establish themselves in the ${tribe.origin}. ${tribe.ancestralMemory}`,
                type: 'tribal_origin',
                tribe: tribe.id,
            });
        }

        // Generate inter-tribal encounters
        for (let i = 0; i < 8; i++) {
            const t1 = Utils.randPick(tribes);
            const t2 = Utils.randPick(tribes.filter(t => t.id !== t1.id));
            const year = Utils.randInt(genesisYear + 50, 200);
            const encounter = Utils.randPick([
                `${t1.icon}${t2.icon} The ${t1.name} and ${t2.name} meet for the first time at a river crossing. ${Utils.randPick(['They share a cautious meal.', 'Words are exchanged — some friendly, some not.', 'A trade of gifts begins a lasting connection.', 'Mistrust marks the encounter, but curiosity wins.'])}`,
                `${t1.icon}${t2.icon} A ${t1.name} hunting party saves a ${t2.name} child lost in the wilds. The debt of gratitude echoes for generations.`,
                `${t1.icon}${t2.icon} The ${t1.name} and ${t2.name} compete for the same hunting grounds. A council of elders meets to draw boundaries.`,
                `${t1.icon}${t2.icon} A ${t2.name} healer cures a ${t1.name} elder of a mysterious illness, earning respect across tribal lines.`,
            ]);
            world.tribalHistory.push({ year, text: encounter, type: 'encounter', tribes: [t1.id, t2.id] });
        }

        world.tribalHistory.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // SETTLEMENT DEMOGRAPHICS
    // ─────────────────────────────────────────────
    /**
     * Assign a multicultural demographic breakdown to each settlement.
     * Each settlement is composed of people from multiple subcultures.
     */
    populateSettlements(world) {
        const allSettlements = world.getAllSettlements();

        for (const s of allSettlements) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement) continue;

            const settlement = tile.settlement;
            const kingdom = settlement.kingdom ? world.getKingdom(settlement.kingdom) : null;
            const primaryCulture = kingdom ? kingdom.culture : Utils.randPick(['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime']);

            // Get the subcultures for this parent culture (the "home" peoples)
            let homeTribes = Object.values(Peoples.TRIBAL_ROOTS).filter(t => t.parentCulture === primaryCulture);
            // Fallback: if no tribes match this culture, pick from all tribes
            if (homeTribes.length === 0) {
                homeTribes = Object.values(Peoples.TRIBAL_ROOTS);
            }
            // And some potential "diaspora" peoples from other cultures
            const foreignTribes = Object.values(Peoples.TRIBAL_ROOTS).filter(t => t.parentCulture !== primaryCulture);

            // Build demographic composition
            const demographics = [];
            let remainingPop = settlement.population;

            // 1. Primary subculture: 30-55% of population
            const primaryTribe = Utils.randPick(homeTribes);
            const primaryShare = Utils.randFloat(0.30, 0.55);
            const primaryPop = Math.floor(remainingPop * primaryShare);
            demographics.push({
                tribe: primaryTribe,
                population: primaryPop,
                share: primaryShare,
                status: 'founding',    // This subculture founded the settlement
                arrivalYear: settlement.founded || Utils.randInt(100, 400),
                sentiment: Utils.randInt(60, 90), // 0-100, how content this group is
                influence: Utils.randInt(50, 80),  // 0-100, political/social influence
            });
            remainingPop -= primaryPop;

            // 2. Secondary subculture (same parent): 15-30%
            const secondaryTribe = Utils.randPick(homeTribes.filter(t => t.id !== primaryTribe.id)) || primaryTribe;
            if (secondaryTribe.id !== primaryTribe.id) {
                const secondaryShare = Utils.randFloat(0.15, 0.30);
                const secondaryPop = Math.floor(settlement.population * secondaryShare);
                demographics.push({
                    tribe: secondaryTribe,
                    population: Math.min(secondaryPop, remainingPop),
                    share: secondaryShare,
                    status: 'co-founder',
                    arrivalYear: (settlement.founded || Utils.randInt(100, 400)) + Utils.randInt(5, 40),
                    sentiment: Utils.randInt(50, 85),
                    influence: Utils.randInt(30, 60),
                });
                remainingPop -= Math.min(secondaryPop, remainingPop);
            }

            // 3. Diaspora peoples (from other cultures): 1-3 groups, small shares
            const numDiaspora = Utils.randInt(1, 3);
            const shuffledForeign = Utils.shuffle([...foreignTribes]);
            for (let i = 0; i < numDiaspora && i < shuffledForeign.length && remainingPop > 0; i++) {
                const diasporaTribe = shuffledForeign[i];
                const diasporaShare = Utils.randFloat(0.03, 0.12);
                const diasporaPop = Math.max(1, Math.floor(settlement.population * diasporaShare));
                demographics.push({
                    tribe: diasporaTribe,
                    population: Math.min(diasporaPop, remainingPop),
                    share: diasporaShare,
                    status: Utils.randPick(['immigrant', 'refugee', 'trader', 'exile', 'pilgrim']),
                    arrivalYear: (settlement.founded || Utils.randInt(100, 400)) + Utils.randInt(30, 300),
                    sentiment: Utils.randInt(30, 75),
                    influence: Utils.randInt(5, 25),
                });
                remainingPop -= Math.min(diasporaPop, remainingPop);
            }

            // 4. Remaining unaligned "common folk"
            if (remainingPop > 0) {
                const thirdHomeTribe = Utils.randPick(homeTribes);
                demographics.push({
                    tribe: thirdHomeTribe,
                    population: remainingPop,
                    share: remainingPop / settlement.population,
                    status: 'mixed',
                    arrivalYear: (settlement.founded || 400) + Utils.randInt(50, 200),
                    sentiment: Utils.randInt(40, 70),
                    influence: Utils.randInt(10, 30),
                });
            }

            // Store demographics on the settlement
            settlement.demographics = demographics;

            // Calculate cultural harmony (0-100)
            settlement.culturalHarmony = Peoples.calculateHarmony(demographics);

            // Generate a unique cultural identity for this settlement
            settlement.culturalIdentity = Peoples.generateSettlementIdentity(settlement, demographics);

            // Track cultural quarter names
            settlement.culturalQuarters = Peoples.generateQuarters(settlement, demographics);
        }
    },

    /**
     * Calculate overall cultural harmony of a settlement based on its demographics.
     */
    calculateHarmony(demographics) {
        if (demographics.length <= 1) return 90;

        let totalSentiment = 0;
        let totalPop = 0;
        let diversityBonus = Math.min(demographics.length * 3, 15); // Diversity can be enriching
        let frictionPenalty = 0;

        for (const group of demographics) {
            totalSentiment += group.sentiment * group.population;
            totalPop += group.population;
        }

        // Check for inter-cultural friction
        const cultures = new Set(demographics.map(d => d.tribe.parentCulture));
        if (cultures.size > 2) frictionPenalty += 5;    // Many different cultures = more complexity
        if (cultures.size > 3) frictionPenalty += 5;

        // Check for large disparity in influence
        const influences = demographics.map(d => d.influence).sort((a, b) => b - a);
        if (influences.length > 1 && influences[0] - influences[influences.length - 1] > 50) {
            frictionPenalty += 10; // One group dominating creates resentment
        }

        const avgSentiment = totalPop > 0 ? totalSentiment / totalPop : 50;
        return Math.max(0, Math.min(100, Math.floor(avgSentiment + diversityBonus - frictionPenalty)));
    },

    /**
     * Generate a unique cultural identity summary for a settlement.
     */
    generateSettlementIdentity(settlement, demographics) {
        const founding = demographics.find(d => d.status === 'founding');
        const allCuisines = [];
        const allArtForms = [];
        const allCustoms = [];

        for (const demo of demographics) {
            allCuisines.push(...demo.tribe.cuisine);
            allArtForms.push(...demo.tribe.artForms);
            allCustoms.push(...demo.tribe.customs);
        }

        // Pick unique highlights
        const signatureDish = Utils.randPick(allCuisines);
        const signatureArt = Utils.randPick(allArtForms);
        const signatureFestival = Utils.randPick(allCustoms);

        // Generate a blended identity description
        const tribeNames = demographics.map(d => d.tribe.name);
        let identityDesc;
        if (demographics.length >= 4) {
            identityDesc = `A cosmopolitan settlement where the traditions of the ${tribeNames.slice(0, 3).join(', ')}, and others blend into a vibrant tapestry of life.`;
        } else if (demographics.length >= 2) {
            identityDesc = `A settlement shaped by the meeting of ${tribeNames.join(' and ')} traditions, each contributing their heritage to the whole.`;
        } else {
            identityDesc = `A settlement steeped in ${tribeNames[0]} tradition, carrying ancient customs into the present day.`;
        }

        return {
            description: identityDesc,
            signatureDish,
            signatureArt,
            signatureFestival,
            foundingPeople: founding ? founding.tribe.name : 'Unknown',
            culturalMotto: founding ? founding.tribe.proverb : '"We endure."',
            numSubcultures: demographics.length,
            dominantValues: Peoples.getDominantValues(demographics),
        };
    },

    /**
     * Get the dominant cultural values across all demographic groups.
     */
    getDominantValues(demographics) {
        const valueCounts = {};
        for (const demo of demographics) {
            for (const [value, strength] of Object.entries(demo.tribe.values)) {
                valueCounts[value] = (valueCounts[value] || 0) + strength * demo.population;
            }
        }

        return Object.entries(valueCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([value]) => value);
    },

    /**
     * Generate named cultural quarters within a settlement.
     */
    generateQuarters(settlement, demographics) {
        if (settlement.population < 500) return []; // Too small for distinct quarters

        const quarters = [];
        const quarterNames = {
            ironborn: ['The Forge Quarter', 'Anvil Row', 'Hammersmiths\' Ward'],
            crownlanders: ['Crown Hill', 'The Noble Quarter', 'High Street'],
            shieldfolk: ['Garrison Ward', 'The Shieldwall', 'Watchmen\'s Row'],
            mosswalkers: ['The Green Quarter', 'Mossgate', 'Whispering Lane'],
            canopiers: ['Treetop Ward', 'Sky Quarter', 'The Canopy'],
            rootkeepers: ['The Grove', 'Root Market', 'Seedkeeper\'s Row'],
            windrunners: ['The Steppe Quarter', 'Wind Market', 'Freedom Row'],
            sandshapers: ['The Oasis Quarter', 'Sandstone Row', 'Star Lane'],
            bonecarvers: ['Hunters\' Ward', 'Bone Market', 'The Kraal'],
            sunweavers: ['The Golden Quarter', 'Sun Market', 'Dawn Street'],
            ashpilgrims: ['Ash Ward', 'The Cloister', 'Ember Lane'],
            starcallers: ['Star Quarter', 'Observatory Row', 'Moon Lane'],
            tidecallers: ['The Wharfs', 'Tide Quarter', 'Shell Street'],
            deepdivers: ['Pearl Row', 'The Deep Quarter', 'Divers\' Wharf'],
            sailweavers: ['Sailmakers\' Ward', 'Harbor Quarter', 'Chandler Row'],
        };

        for (const demo of demographics) {
            if (demo.population >= 50 && demo.share >= 0.05) {
                const names = quarterNames[demo.tribe.id] || [`${demo.tribe.name} Quarter`];
                quarters.push({
                    name: Utils.randPick(names),
                    tribe: demo.tribe.id,
                    tribeName: demo.tribe.name,
                    tribeIcon: demo.tribe.icon,
                    population: demo.population,
                    specialty: Utils.randPick(demo.tribe.artForms),
                    mood: demo.sentiment > 70 ? 'thriving' : demo.sentiment > 40 ? 'content' : 'restless',
                });
            }
        }

        return quarters;
    },
});
