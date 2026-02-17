// ============================================
// PEOPLES — Multicultural society simulation
// ============================================
// Places are composed of many different peoples from different subcultures.
// Tribes formed first, eventually cooperating to create villages, then kingdoms.
// Each population retains its subcultural identity: traditions, cuisine,
// art forms, ancestral memories, and regional pride.
// ============================================

const Peoples = {

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
        { id: 'chiefdom', name: 'Chiefdom', population: [200, 500], icon: '🪶', description: 'A powerful chief unites several bands under one rule' },
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

    // ─────────────────────────────────────────────
    // CULTURAL EVOLUTION HISTORY
    // ─────────────────────────────────────────────

    /**
     * Generate the history of how tribes came together to form villages and kingdoms.
     */
    generateCulturalEvolution(world) {
        if (!world.tribalHistory) world.tribalHistory = [];

        const tribes = Object.values(Peoples.TRIBAL_ROOTS);

        // Phase 1: Tribal Cooperation (Years 100-300)
        // Tribes start working together — forming proto-villages
        for (const kingdom of world.kingdoms) {
            const homeTribes = tribes.filter(t => t.parentCulture === kingdom.culture);
            if (homeTribes.length < 2) continue;

            const coopYear = Utils.randInt(100, 200);
            const t1 = homeTribes[0];
            const t2 = homeTribes[1];

            world.tribalHistory.push({
                year: coopYear,
                text: `${t1.icon}${t2.icon} The ${t1.name} and ${t2.name} sign the Compact of ${Utils.randPick(['Shared Fires', 'Broken Bread', 'Joined Hands', 'Open Roads', 'Common Waters'])}. Their bands begin settling together, forming the first permanent villages.`,
                type: 'cooperation',
                kingdom: kingdom.id,
            });

            // Phase 2: Village Formation (Years 200-400)
            const villageYear = coopYear + Utils.randInt(50, 150);
            const villageName = settlement_name_for_kingdom(kingdom);
            world.tribalHistory.push({
                year: villageYear,
                text: `🏘️ The village of ${villageName} is founded as a joint settlement of ${homeTribes.map(t => t.name).join(', ')}. Each people maintains its customs but shares governance through a Council of Elders.`,
                type: 'village_formation',
                kingdom: kingdom.id,
            });

            // Phase 3: Chiefdom Consolidation (Years 300-500)
            const chiefYear = villageYear + Utils.randInt(80, 200);
            const chiefName = Utils.randPick([t1.name, t2.name]);
            world.tribalHistory.push({
                year: chiefYear,
                text: `🪶 A great leader from the ${chiefName} unites the villages into a chiefdom. ${Utils.randPick([
                    'Skeptics are won over by promises of protection and shared prosperity.',
                    'The other peoples accept on the condition that their customs be forever honored.',
                    'A great feast is held where leaders of all peoples break bread together.',
                    'The unification is sealed by marriages between the leading families of each people.',
                ])}`,
                type: 'chiefdom',
                kingdom: kingdom.id,
            });

            // Phase 4: Kingdom Formation (Years 400-700)
            const kingdomYear = chiefYear + Utils.randInt(100, 250);
            world.tribalHistory.push({
                year: kingdomYear,
                text: `👑 ${kingdom.name} is formally established! The ${homeTribes.map(t => t.name).join(', ')} and various diaspora peoples are united under ${kingdom.ruler}. Each subculture retains its own quarter, festivals, and traditions within the new realm.`,
                type: 'kingdom_formation',
                kingdom: kingdom.id,
            });

            // Phase 5: Cultural Challenges (post-formation)
            const challengeYear = kingdomYear + Utils.randInt(20, 100);
            const t3 = homeTribes.length > 2 ? homeTribes[2] : t2;
            world.tribalHistory.push({
                year: challengeYear,
                text: `${Utils.randPick([
                    `⚔️ The ${t1.name} and ${t3.name} clash over representation in ${kingdom.name}'s council. A compromise grants rotating leadership between the peoples.`,
                    `🎊 ${kingdom.name} establishes the Festival of Many Peoples — a celebration where each subculture showcases its traditions. It becomes the realm's most beloved holiday.`,
                    `📜 ${kingdom.name} codifies the Rights of All Peoples, guaranteeing each subculture the freedom to practice its customs, speak its language, and honor its ancestors.`,
                    `🍲 A great famine forces the peoples of ${kingdom.name} to pool their knowledge. ${t1.name} foraging skills combined with ${t2.name} preservation techniques save thousands of lives.`,
                ])}`,
                type: 'cultural_challenge',
                kingdom: kingdom.id,
            });
        }

        world.tribalHistory.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DIASPORA & MIGRATION
    // ─────────────────────────────────────────────

    /**
     * Generate migration and diaspora events that explain why foreign peoples are in settlements.
     */
    generateDiasporaHistory(world) {
        if (!world.tribalHistory) world.tribalHistory = [];

        const allSettlements = world.getAllSettlements();
        const tribes = Object.values(Peoples.TRIBAL_ROOTS);

        // Generate diaspora events
        const diasporaReasons = [
            { reason: 'famine', text: (tribe, dest) => `${tribe.icon} A terrible famine drives the ${tribe.name} from their homeland. Many find refuge in ${dest}, forming a small but resilient community.` },
            { reason: 'war', text: (tribe, dest) => `${tribe.icon} War in their homeland forces ${tribe.name} refugees to seek safety in ${dest}. They bring their skills and traditions to a new home.` },
            { reason: 'trade', text: (tribe, dest) => `${tribe.icon} ${tribe.name} merchants establish a permanent trading post in ${dest}. Over generations, their quarter becomes an integral part of the city.` },
            { reason: 'pilgrimage', text: (tribe, dest) => `${tribe.icon} ${tribe.name} pilgrims, drawn by sacred sites near ${dest}, decide to settle permanently, enriching the spiritual life of the community.` },
            { reason: 'exploration', text: (tribe, dest) => `${tribe.icon} Adventurous ${tribe.name} explorers discover ${dest} and send word home. A steady stream of settlers follows, drawn by opportunity.` },
            { reason: 'exile', text: (tribe, dest) => `${tribe.icon} A faction of the ${tribe.name} is exiled after a political dispute. They find welcome in ${dest} and bring unique knowledge.` },
            { reason: 'marriage', text: (tribe, dest) => `${tribe.icon} A marriage alliance between a ${tribe.name} noble family and a prominent household in ${dest} leads to a steady migration of kin and retainers.` },
        ];

        for (const s of allSettlements) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.demographics) continue;

            const diasporaGroups = tile.settlement.demographics.filter(d =>
                ['immigrant', 'refugee', 'trader', 'exile', 'pilgrim'].includes(d.status)
            );

            for (const group of diasporaGroups) {
                const event = Utils.randPick(diasporaReasons);
                const year = group.arrivalYear;
                if (year < (world.year || 853)) {
                    world.tribalHistory.push({
                        year,
                        text: event.text(group.tribe, s.name || 'a distant settlement'),
                        type: 'diaspora',
                        tribe: group.tribe.id,
                        settlement: s.name,
                    });
                }
            }
        }

        world.tribalHistory.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DAILY PROCESSING
    // ─────────────────────────────────────────────

    /**
     * Process daily cultural dynamics — called each turn.
     */
    processTurn(world) {
        const allSettlements = world.getAllSettlements();

        for (const s of allSettlements) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.demographics) continue;

            const settlement = tile.settlement;

            // 1. Organic population shifts between demographics
            Peoples.processPopulationDrift(settlement);

            // 2. Cultural interactions (rare events)
            if (Math.random() < 0.005) { // 0.5% per day per settlement
                Peoples.generateCulturalInteraction(settlement, world);
            }

            // 3. Slow harmony drift
            settlement.culturalHarmony = Peoples.calculateHarmony(settlement.demographics);

            // 4. Cultural harmony effects on settlement
            if (settlement.culturalHarmony > 80) {
                // High harmony = population growth bonus
                settlement.population += Utils.randInt(0, 2);
            } else if (settlement.culturalHarmony < 30) {
                // Low harmony = some people leave
                if (Math.random() < 0.1) {
                    settlement.population = Math.max(10, settlement.population - Utils.randInt(1, 5));
                }
            }
        }
    },

    /**
     * Small organic population shifts between demographic groups.
     */
    processPopulationDrift(settlement) {
        if (!settlement.demographics || settlement.demographics.length < 2) return;

        // Natural growth — larger groups grow slightly faster
        for (const demo of settlement.demographics) {
            const growthRate = 0.0001 * (1 + demo.sentiment / 200);
            const growth = Math.floor(demo.population * growthRate);
            demo.population += growth;
        }

        // Recalculate shares
        const totalPop = settlement.demographics.reduce((sum, d) => sum + d.population, 0);
        if (totalPop > 0) {
            for (const demo of settlement.demographics) {
                demo.share = demo.population / totalPop;
            }
            settlement.population = totalPop;
        }
    },

    /**
     * Generate a random cultural interaction event within a settlement.
     */
    generateCulturalInteraction(settlement, world) {
        if (!settlement.demographics || settlement.demographics.length < 2) return;

        const d1 = Utils.randPick(settlement.demographics);
        const d2 = Utils.randPick(settlement.demographics.filter(d => d.tribe.id !== d1.tribe.id));
        if (!d2) return;

        const interaction = Utils.randPick(Object.values(Peoples.INTERACTION_TYPES));

        // Apply harmony effects
        d1.sentiment = Utils.clamp(d1.sentiment + interaction.harmonyBonus, 0, 100);
        d2.sentiment = Utils.clamp(d2.sentiment + interaction.harmonyBonus, 0, 100);

        // Generate event
        const eventText = `${interaction.icon} In ${settlement.name}: ${interaction.description} — The ${d1.tribe.name} and ${d2.tribe.name} ${interaction.harmonyBonus > 0 ? 'grow closer' : 'experience tension'}.`;

        world.events.push({
            category: 'cultural',
            text: eventText,
            settlement: settlement.name,
            impact: interaction.harmonyBonus > 0 ? 'positive' : 'negative',
        });

        // Occasionally generate a hybrid tradition
        if (interaction.harmonyBonus > 3 && Math.random() < 0.1) {
            Peoples.generateHybridTradition(settlement, d1, d2, world);
        }
    },

    /**
     * Generate a hybrid cultural tradition from two subcultures mixing.
     */
    generateHybridTradition(settlement, demo1, demo2, world) {
        const t1 = demo1.tribe;
        const t2 = demo2.tribe;

        const hybridCustoms = [
            `The ${Utils.randPick(t1.customs).split(' ')[0]} ${Utils.randPick(t2.customs).split(' ').slice(-1)[0]}`,
            `${t1.name}-${t2.name} ${Utils.randPick(['Unity Dance', 'Harmony Feast', 'Bridge Festival', 'Shared Song'])}`,
        ];

        const hybridDish = `${Utils.randPick(t1.cuisine).split(' ')[0]} ${Utils.randPick(t2.cuisine).split(' ').slice(-1)[0]}`;

        if (!settlement.hybridTraditions) settlement.hybridTraditions = [];
        const tradition = {
            name: Utils.randPick(hybridCustoms),
            cuisine: hybridDish,
            parents: [t1.name, t2.name],
            year: world.year,
        };
        settlement.hybridTraditions.push(tradition);

        world.events.push({
            category: 'cultural',
            text: `🌟 A new tradition is born in ${settlement.name}! The "${tradition.name}" emerges from the blending of ${t1.name} and ${t2.name} customs. The locals also develop a taste for "${hybridDish}."`,
            settlement: settlement.name,
            impact: 'positive',
        });
    },

    // ─────────────────────────────────────────────
    // QUERY HELPERS
    // ─────────────────────────────────────────────

    /**
     * Get a formatted demographics summary for a settlement.
     */
    getDemographicsSummary(settlement) {
        if (!settlement || !settlement.demographics) return null;

        return settlement.demographics
            .sort((a, b) => b.population - a.population)
            .map(d => ({
                name: d.tribe.name,
                icon: d.tribe.icon,
                population: d.population,
                share: (d.share * 100).toFixed(1),
                status: d.status,
                sentiment: d.sentiment,
                influence: d.influence,
                parentCulture: d.tribe.parentCulture,
                proverb: d.tribe.proverb,
            }));
    },

    /**
     * Get cultural harmony label and color.
     */
    getHarmonyDisplay(harmony) {
        if (harmony >= 80) return { label: 'Harmonious', color: '#2ecc71', icon: '🕊️' };
        if (harmony >= 60) return { label: 'Cooperative', color: '#27ae60', icon: '🤝' };
        if (harmony >= 40) return { label: 'Stable', color: '#f1c40f', icon: '⚖️' };
        if (harmony >= 20) return { label: 'Tense', color: '#e67e22', icon: '😤' };
        return { label: 'Volatile', color: '#e74c3c', icon: '🔥' };
    },

    /**
     * Get all tribal roots for a given parent culture.
     */
    getTribesForCulture(cultureName) {
        return Object.values(Peoples.TRIBAL_ROOTS).filter(t => t.parentCulture === cultureName);
    },

    /**
     * Get formatted tribal history for the history panel.
     * Merges tribal history with world history for a unified timeline.
     */
    getMergedHistory(world) {
        const merged = [];

        // Regular world history — assign stable IDs
        if (world.history) {
            for (let i = 0; i < world.history.length; i++) {
                const event = world.history[i];
                merged.push({ ...event, id: event.id || `world_${i}`, source: 'world' });
            }
        }

        // Tribal/peoples history — assign stable IDs
        if (world.tribalHistory) {
            for (let i = 0; i < world.tribalHistory.length; i++) {
                const event = world.tribalHistory[i];
                merged.push({ ...event, id: event.id || `tribal_${i}`, source: 'peoples' });
            }
        }

        return merged.sort((a, b) => a.year - b.year);
    },

    /**
     * Discover a random piece of world history for the player.
     * @param {Player} player - The player
     * @param {Object} world - The world
     * @param {Object} [options] - Optional filters
     * @param {string} [options.kingdom] - Kingdom ID to prefer entries about
     * @param {string} [options.type] - Preferred entry type (e.g., 'tribal_origin', 'kingdom_formation')
     * @param {number[]} [options.eraRange] - [minYear, maxYear] to filter by era
     * @param {number} [options.count] - Number of entries to discover (default: 1)
     * @returns {Array} Array of newly discovered history entries (empty if nothing new)
     */
    discoverLore(player, world, options = {}) {
        if (!player.discoveredLore) player.discoveredLore = new Set();

        const allHistory = Peoples.getMergedHistory(world);
        let candidates = allHistory.filter(e => !player.discoveredLore.has(e.id));

        // Apply filters to narrow candidates
        if (options.kingdom) {
            const kingdomEntries = candidates.filter(e => e.kingdom === options.kingdom || (e.text && e.text.includes(world.getKingdom(options.kingdom)?.name)));
            if (kingdomEntries.length > 0) candidates = kingdomEntries;
        }

        if (options.type) {
            const typeEntries = candidates.filter(e => e.type === options.type);
            if (typeEntries.length > 0) candidates = typeEntries;
        }

        if (options.eraRange) {
            const eraEntries = candidates.filter(e => e.year >= options.eraRange[0] && e.year < options.eraRange[1]);
            if (eraEntries.length > 0) candidates = eraEntries;
        }

        if (candidates.length === 0) return [];

        const count = Math.min(options.count || 1, candidates.length);
        const discovered = [];

        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * candidates.length);
            const entry = candidates[idx];
            player.discoveredLore.add(entry.id);
            discovered.push(entry);
            candidates.splice(idx, 1);
        }

        return discovered;
    },

    /**
     * Build HTML for displaying a settlement's demographics in the UI.
     */
    buildDemographicsHTML(settlement) {
        if (!settlement || !settlement.demographics) return '';

        const demos = Peoples.getDemographicsSummary(settlement);
        if (!demos || demos.length === 0) return '';

        const harmony = settlement.culturalHarmony || 50;
        const harmonyDisplay = Peoples.getHarmonyDisplay(harmony);
        const identity = settlement.culturalIdentity;

        let html = `
            <div class="info-section-title">Peoples & Cultures</div>
            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                <div class="info-row">
                    <span class="info-label">${harmonyDisplay.icon} Cultural Harmony</span>
                    <span class="info-value" style="color: ${harmonyDisplay.color};">${harmonyDisplay.label} (${harmony}/100)</span>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; margin: 4px 0 8px 0; overflow: hidden;">
                    <div style="background: ${harmonyDisplay.color}; height: 100%; width: ${harmony}%; border-radius: 4px; transition: width 0.3s;"></div>
                </div>
        `;

        if (identity) {
            html += `
                <div style="color: var(--text-secondary); font-size: 12px; font-style: italic; margin-bottom: 8px; line-height: 1.4;">
                    ${identity.description}
                </div>
                <div style="color: var(--gold); font-size: 11px; margin-bottom: 6px;">
                    🏛️ Founded by: <span style="color: #fff;">${identity.foundingPeople}</span>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    🎨 Known for: <span style="color: #fff;">${identity.signatureArt}</span>
                </div>
                <div style="color: var(--gold); font-size: 11px; margin-bottom: 8px;">
                    🍲 Signature dish: <span style="color: #fff;">${identity.signatureDish}</span>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    🎉 Festival: <span style="color: #fff;">${identity.signatureFestival}</span>
                </div>
            `;

            if (identity.dominantValues && identity.dominantValues.length > 0) {
                html += `
                    <div style="color: var(--gold); font-size: 11px; margin-bottom: 6px;">
                        ⭐ Core Values: <span style="color: #fff;">${identity.dominantValues.map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(', ')}</span>
                    </div>
                `;
            }

            if (identity.culturalMotto) {
                html += `<div style="color: var(--text-secondary); font-size: 11px; font-style: italic;">📜 Motto: ${identity.culturalMotto}</div>`;
            }
        }

        html += `</div>`;

        // Population breakdown
        html += `<div style="margin-bottom: 8px;">`;
        for (const demo of demos) {
            const barWidth = Math.max(5, demo.share);
            const sentimentColor = demo.sentiment > 70 ? '#2ecc71' : demo.sentiment > 40 ? '#f1c40f' : '#e74c3c';
            const statusLabel = demo.status.charAt(0).toUpperCase() + demo.status.slice(1);

            html += `
                <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 4px; border-left: 3px solid ${demo.icon === '⚒️' ? '#8b8b8b' : sentimentColor};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="color: #fff; font-size: 13px;">${demo.icon} <strong>${demo.name}</strong></span>
                        <span style="color: var(--text-secondary); font-size: 11px;">${Utils.formatNumber(demo.population)} (${demo.share}%)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary);">
                        <span>${statusLabel} • ${demo.parentCulture}</span>
                        <span style="color: ${sentimentColor};">Mood: ${demo.sentiment > 70 ? '😊' : demo.sentiment > 40 ? '😐' : '😠'} ${demo.sentiment}/100</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.1); border-radius: 2px; height: 3px; margin-top: 4px; overflow: hidden;">
                        <div style="background: ${sentimentColor}; height: 100%; width: ${barWidth}%; border-radius: 2px;"></div>
                    </div>
                </div>
            `;
        }
        html += `</div>`;

        // Cultural quarters
        if (settlement.culturalQuarters && settlement.culturalQuarters.length > 0) {
            html += `<div class="info-section-title" style="font-size: 12px;">Cultural Quarters</div>`;
            for (const q of settlement.culturalQuarters) {
                const moodColor = q.mood === 'thriving' ? '#2ecc71' : q.mood === 'content' ? '#f1c40f' : '#e74c3c';
                html += `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; color: var(--text-secondary);">
                        <span>${q.tribeIcon} ${q.name}</span>
                        <span style="color: ${moodColor};">${q.mood}</span>
                    </div>
                `;
            }
        }

        // Hybrid traditions
        if (settlement.hybridTraditions && settlement.hybridTraditions.length > 0) {
            html += `<div class="info-section-title" style="font-size: 12px; margin-top: 8px;">Hybrid Traditions</div>`;
            for (const trad of settlement.hybridTraditions) {
                html += `
                    <div style="font-size: 11px; padding: 3px 0; color: var(--text-secondary);">
                        🌟 <strong style="color: #fff;">${trad.name}</strong> — born from ${trad.parents.join(' & ')} (Year ${trad.year})
                    </div>
                `;
            }
        }

        return html;
    },

    /**
     * Build HTML for displaying tribal history in the Peoples History panel.
     * If discoveredLore is provided, only discovered entries are shown; others appear as hidden.
     */
    buildTribalHistoryHTML(world, discoveredLore) {
        const history = Peoples.getMergedHistory(world);
        if (!history || history.length === 0) return '<p style="color: var(--text-secondary);">No recorded history.</p>';

        const totalEntries = history.length;
        const hasDiscoveryFilter = discoveredLore instanceof Set;
        const discoveredCount = hasDiscoveryFilter ? history.filter(e => discoveredLore.has(e.id)).length : totalEntries;

        let html = `
            <div style="margin-bottom: 16px;">
                <p style="color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 12px;">
                    ${hasDiscoveryFilter
                        ? 'Piece together the world\'s history by exploring ruins, talking to locals, visiting taverns, and discovering ancient places. Each interaction may reveal a fragment of the past.'
                        : 'The peoples of this world trace their roots to ancient tribes that roamed the land. Over centuries, these tribes learned to cooperate — sharing fires, breaking bread, and building villages together. From those first tentative alliances grew the great kingdoms of today, each a tapestry of many peoples united under one banner but proud of their distinct heritages.'
                    }
                </p>
                ${hasDiscoveryFilter ? `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px;">
                    <span style="color: var(--gold); font-size: 13px;">📜 Lore Discovered</span>
                    <span style="color: ${discoveredCount === totalEntries ? '#2ecc71' : 'var(--text-secondary)'}; font-size: 13px; font-weight: bold;">
                        ${discoveredCount} / ${totalEntries}
                    </span>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; margin-bottom: 12px; overflow: hidden;">
                    <div style="background: var(--gold); height: 100%; width: ${Math.round(discoveredCount / totalEntries * 100)}%; border-radius: 4px; transition: width 0.3s;"></div>
                </div>
                ` : ''}
            </div>
        `;

        // Group by era
        const eras = [
            { name: '🌅 The Dawn Age', range: [0, 100], desc: 'Tribes emerge and find their homelands' },
            { name: '🤝 Age of First Contact', range: [100, 250], desc: 'Peoples meet, trade, and sometimes clash' },
            { name: '🏘️ Age of Villages', range: [250, 450], desc: 'Tribes cooperate to build shared settlements' },
            { name: '👑 Age of Kingdoms', range: [450, 700], desc: 'Chiefdoms consolidate into realms' },
            { name: '🌍 The Present Age', range: [700, 9999], desc: 'A world of many peoples in many places' },
        ];

        for (const era of eras) {
            const eraEvents = history.filter(e => e.year >= era.range[0] && e.year < era.range[1]);
            if (eraEvents.length === 0) continue;

            const eraDiscovered = hasDiscoveryFilter ? eraEvents.filter(e => discoveredLore.has(e.id)).length : eraEvents.length;

            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-family: var(--font-display); color: var(--gold); font-size: 16px; margin-bottom: 4px;">${era.name}</div>
                        ${hasDiscoveryFilter ? `<span style="color: var(--text-secondary); font-size: 11px;">${eraDiscovered}/${eraEvents.length}</span>` : ''}
                    </div>
                    <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 12px; font-style: italic;">${era.desc}</div>
                    <div style="position: relative; padding-left: 20px;">
                        <div style="position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.1);"></div>
            `;

            for (const event of eraEvents) {
                const isDiscovered = !hasDiscoveryFilter || discoveredLore.has(event.id);
                const dotColor = isDiscovered
                    ? (event.source === 'peoples' ? 'var(--gold)' : '#3498db')
                    : 'rgba(255,255,255,0.15)';

                if (isDiscovered) {
                    html += `
                        <div style="margin-bottom: 14px; position: relative;">
                            <div style="position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; background: ${dotColor}; border-radius: 50%; box-shadow: 0 0 6px ${dotColor};"></div>
                            <div style="color: var(--gold); font-size: 13px; margin-bottom: 2px;">Year ${event.year}</div>
                            <div style="color: var(--text-primary); line-height: 1.4; font-size: 13px;">${event.text}</div>
                        </div>
                    `;
                } else {
                    html += `
                        <div style="margin-bottom: 14px; position: relative; opacity: 0.4;">
                            <div style="position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; background: ${dotColor}; border-radius: 50%;"></div>
                            <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 2px;">Year ???</div>
                            <div style="color: var(--text-secondary); line-height: 1.4; font-size: 13px; font-style: italic;">Undiscovered — explore the world to learn more...</div>
                        </div>
                    `;
                }
            }

            html += `</div></div>`;
        }

        return html;
    },
};

// Helper: get a settlement name from a kingdom for history text
function settlement_name_for_kingdom(kingdom) {
    return Kingdom.generateCityName(kingdom.culture);
}
