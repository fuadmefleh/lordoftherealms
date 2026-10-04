// Characters — generation members (split from the original monolith).
import { Characters } from './_ref.js';
import { Utils } from './_imports.js';

Object.assign(Characters, {
    // ── Name pools by culture ──────────────────────────────────────────
    FIRST_NAMES: {
        Imperial: {
            male: ['Aldric', 'Cedric', 'Edmund', 'Roland', 'Theron', 'Victor', 'Cassian', 'Lucius', 'Hadrian', 'Maximilian', 'Aurelius', 'Valerius', 'Titus', 'Gaius', 'Cato', 'Darius', 'Reginald', 'Baldwin', 'Godfrey', 'Percival'],
            female: ['Helena', 'Isabella', 'Morgana', 'Rowena', 'Vivienne', 'Serena', 'Octavia', 'Livia', 'Cornelia', 'Agrippina', 'Faustina', 'Theodora', 'Adelaide', 'Matilda', 'Eleanor', 'Beatrice', 'Constance', 'Alyssandra', 'Valentina', 'Marcella'],
        },
        Woodland: {
            male: ['Sylvan', 'Rowan', 'Faelan', 'Arden', 'Thorne', 'Alder', 'Branwen', 'Celyn', 'Eryn', 'Linden', 'Ash', 'Briar', 'Cypress', 'Elm', 'Yarrow', 'Fennel', 'Sage', 'Reed', 'Hazel', 'Wren'],
            female: ['Elara', 'Thalia', 'Lyra', 'Elowen', 'Willow', 'Ivy', 'Marigold', 'Primrose', 'Fern', 'Laurel', 'Dahlia', 'Jasmine', 'Lily', 'Rose', 'Violet', 'Hawthorn', 'Blossom', 'Aurora', 'Luna', 'Celeste'],
        },
        Nomadic: {
            male: ['Borga', 'Temur', 'Khal', 'Ragnar', 'Ulfric', 'Oghuz', 'Targon', 'Bataar', 'Erlik', 'Toghrul', 'Chagatai', 'Subotai', 'Jebe', 'Mongke', 'Hulagu', 'Argun', 'Berke', 'Nogai', 'Batu', 'Timur'],
            female: ['Yara', 'Khara', 'Nara', 'Zara', 'Shara', 'Altani', 'Mandukhai', 'Borte', 'Khulan', 'Sorghaghtani', 'Ayanga', 'Sarangerel', 'Tsetseg', 'Odval', 'Enkhtuya', 'Oyuun', 'Solongo', 'Narantsetseg', 'Ariunaa', 'Bayarmaa'],
        },
        Religious: {
            male: ['Solon', 'Matthias', 'Ezekiel', 'Silas', 'Tobias', 'Elijah', 'Isaiah', 'Malachi', 'Nathaniel', 'Zachariah', 'Jeremiah', 'Gabriel', 'Raphael', 'Michael', 'Uriel', 'Solomon', 'Abraham', 'Moses', 'Aaron', 'Josiah'],
            female: ['Miriam', 'Seraphina', 'Celeste', 'Evangeline', 'Theodora', 'Magdalena', 'Bethany', 'Naomi', 'Ruth', 'Esther', 'Deborah', 'Hannah', 'Sarah', 'Abigail', 'Tabitha', 'Priscilla', 'Lydia', 'Martha', 'Mary', 'Judith'],
        },
        Maritime: {
            male: ['Marcus', 'Tiberius', 'Cassius', 'Caspian', 'Neptune', 'Drake', 'Triton', 'Corsair', 'Sterling', 'Harbour', 'Maren', 'Reef', 'Tide', 'Storm', 'Anchor', 'Navarro', 'Aegeus', 'Peleus', 'Odysseus', 'Ajax'],
            female: ['Lyanna', 'Octavia', 'Marina', 'Cordelia', 'Nerissa', 'Portia', 'Ariel', 'Coral', 'Pearl', 'Tempest', 'Siren', 'Ondine', 'Cascade', 'Isla', 'Delta', 'Nautica', 'Calypso', 'Tethys', 'Amphitrite', 'Galatea'],
        },
    },

    DYNASTY_NAMES: {
        Imperial: ['Valorian', 'Drakonhart', 'Highcrown', 'Ironthrone', 'Goldenhelm', 'Steelblood', 'Stormborne', 'Lionmane', 'Eaglecrest', 'Wolfsbane'],
        Woodland: ['Greenleaf', 'Mosshart', 'Starbough', 'Dawnroot', 'Moonpetal', 'Silverbirch', 'Goldenbark', 'Thornbloom', 'Willowsong', 'Fernwhisper'],
        Nomadic: ['Ironhoof', 'Skyrider', 'Stormclaw', 'Thundermane', 'Bloodhawk', 'Windfang', 'Bonecrusher', 'Ashwalker', 'Sandviper', 'Firemane'],
        Religious: ['Lightbringer', 'Divineheart', 'Soulkeeper', 'Stargaze', 'Holyflame', 'Sanctimonious', 'Graceborn', 'Radiant', 'Celestine', 'Oracleblood'],
        Maritime: ['Tidecaller', 'Stormhaven', 'Deepwater', 'Saltblood', 'Wavecrest', 'Coralking', 'Anchorstone', 'Seafoam', 'Driftborn', 'Riptide'],
    },

    // ── Ruler Traits ───────────────────────────────────────────────────
    RULER_TRAITS: {
        // Positive
        brilliant_strategist: { id: 'brilliant_strategist', name: 'Brilliant Strategist', icon: '🗡️', category: 'positive', effects: { military: 0.20, warBonus: 0.15 }, description: 'Exceptional military mind' },
        silver_tongue: { id: 'silver_tongue', name: 'Silver Tongue', icon: '🗣️', category: 'positive', effects: { diplomacy: 0.25, tradeBonus: 0.10 }, description: 'Master negotiator and diplomat' },
        just_ruler: { id: 'just_ruler', name: 'Just Ruler', icon: '⚖️', category: 'positive', effects: { loyalty: 0.20, stability: 0.15 }, description: 'Fair and beloved by the people' },
        master_builder: { id: 'master_builder', name: 'Master Builder', icon: '🏗️', category: 'positive', effects: { construction: 0.25, population: 0.10 }, description: 'Great architect and city planner' },
        wise: { id: 'wise', name: 'Wise', icon: '📖', category: 'positive', effects: { stewardship: 0.15, research: 0.20 }, description: 'Deep thinker who makes sound decisions' },
        charismatic: { id: 'charismatic', name: 'Charismatic', icon: '✨', category: 'positive', effects: { loyalty: 0.15, diplomacy: 0.15 }, description: 'Natural leader who inspires others' },
        frugal: { id: 'frugal', name: 'Frugal', icon: '💎', category: 'positive', effects: { treasury: 0.20, upkeep: -0.15 }, description: 'Careful with money and resources' },
        fertile: { id: 'fertile', name: 'Fertile', icon: '🌱', category: 'positive', effects: { heirs: 0.30 }, description: 'Blessed with many children' },
        brave: { id: 'brave', name: 'Brave', icon: '🛡️', category: 'positive', effects: { military: 0.10, loyalty: 0.10 }, description: 'Fearless in battle, admired by troops' },
        devout: { id: 'devout', name: 'Devout', icon: '🙏', category: 'positive', effects: { faith: 0.25, stability: 0.10 }, description: 'Deeply religious, favored by clergy' },

        // Negative
        cruel: { id: 'cruel', name: 'Cruel', icon: '💀', category: 'negative', effects: { loyalty: -0.25, military: 0.10 }, description: 'Rules through fear and punishment' },
        paranoid: { id: 'paranoid', name: 'Paranoid', icon: '👁️', category: 'negative', effects: { diplomacy: -0.20, intrigue: 0.20 }, description: 'Trusts no one, suspects treachery everywhere' },
        decadent: { id: 'decadent', name: 'Decadent', icon: '🍷', category: 'negative', effects: { treasury: -0.20, stability: -0.15 }, description: 'Wastes gold on lavish excess' },
        weak_willed: { id: 'weak_willed', name: 'Weak-Willed', icon: '😰', category: 'negative', effects: { loyalty: -0.10, stability: -0.20 }, description: 'Easily manipulated by advisors and nobles' },
        wrathful: { id: 'wrathful', name: 'Wrathful', icon: '🔥', category: 'negative', effects: { diplomacy: -0.15, warBonus: 0.10 }, description: 'Quick to anger, slow to forgive' },
        slothful: { id: 'slothful', name: 'Slothful', icon: '😴', category: 'negative', effects: { stewardship: -0.20, construction: -0.15 }, description: 'Lazy and neglectful of duties' },
        greedy: { id: 'greedy', name: 'Greedy', icon: '🤑', category: 'negative', effects: { treasury: 0.15, loyalty: -0.20 }, description: 'Hoards wealth at the people\'s expense' },
        cowardly: { id: 'cowardly', name: 'Cowardly', icon: '🐀', category: 'negative', effects: { military: -0.20, loyalty: -0.10 }, description: 'Flees from danger, despised by warriors' },

        // Neutral / Mixed
        ambitious: { id: 'ambitious', name: 'Ambitious', icon: '🔱', category: 'neutral', effects: { expansion: 0.25, stability: -0.10 }, description: 'Driven to expand and conquer' },
        cunning: { id: 'cunning', name: 'Cunning', icon: '🦊', category: 'neutral', effects: { intrigue: 0.25, diplomacy: 0.10 }, description: 'Clever schemer who plays the long game' },
    },

    // ── Advisor Roles ──────────────────────────────────────────────────
    ADVISOR_ROLES: {
        general: {
            id: 'general', name: 'Military General', icon: '⚔️',
            description: 'Commands the armies and oversees defense',
            primarySkill: 'martial', secondarySkill: 'leadership',
            bonuses: { military: 0.15, warBonus: 0.10 },
        },
        treasurer: {
            id: 'treasurer', name: 'Royal Treasurer', icon: '💰',
            description: 'Manages the kingdom\'s finances and trade',
            primarySkill: 'stewardship', secondarySkill: 'commerce',
            bonuses: { treasury: 0.15, tradeBonus: 0.10 },
        },
        spymaster: {
            id: 'spymaster', name: 'Spymaster', icon: '🗝️',
            description: 'Handles espionage, counter-intelligence, and intrigue',
            primarySkill: 'intrigue', secondarySkill: 'cunning',
            bonuses: { intrigue: 0.20, stability: 0.05 },
        },
        chancellor: {
            id: 'chancellor', name: 'Grand Chancellor', icon: '📜',
            description: 'Manages diplomacy and foreign affairs',
            primarySkill: 'diplomacy', secondarySkill: 'charisma',
            bonuses: { diplomacy: 0.20, relations: 0.10 },
        },
        steward: {
            id: 'steward', name: 'High Steward', icon: '🏛️',
            description: 'Oversees internal administration and construction',
            primarySkill: 'stewardship', secondarySkill: 'administration',
            bonuses: { construction: 0.15, population: 0.10 },
        },
    },

    // ── Character Events ────────────────────────────────────────────────
    CHARACTER_EVENTS: [
        // Ruler events
        { id: 'heir_born', weight: 15, minAge: 18, maxAge: 50, requires: 'married', text: '{ruler} and {spouse} have been blessed with a child, {child}!', type: 'dynasty', impact: 'positive' },
        { id: 'ruler_ill', weight: 8, minAge: 40, maxAge: 100, text: '{ruler} has fallen gravely ill. The court prays for recovery.', type: 'health', impact: 'negative' },
        { id: 'ruler_recovers', weight: 6, requires: 'ill', text: '{ruler} has recovered from illness! The realm celebrates.', type: 'health', impact: 'positive' },
        { id: 'assassination_attempt', weight: 3, text: 'An assassination attempt on {ruler}! The spymaster investigates.', type: 'intrigue', impact: 'negative' },
        { id: 'trait_gained', weight: 5, text: '{ruler} has developed a reputation as {trait}.', type: 'character', impact: 'neutral' },
        { id: 'advisor_scandal', weight: 4, text: 'Scandal! The {advisorRole} of {kingdom} has been caught in corruption.', type: 'intrigue', impact: 'negative' },
        { id: 'marriage_proposal', weight: 6, text: '{kingdom} proposes a marriage alliance between {char1} and {char2}.', type: 'diplomacy', impact: 'neutral' },
        { id: 'succession_crisis', weight: 2, requires: 'no_heirs', text: 'With no clear heir, {kingdom} faces a succession crisis!', type: 'political', impact: 'negative' },
        { id: 'feast', weight: 8, text: '{ruler} hosts a grand feast, improving relations with neighboring rulers.', type: 'diplomacy', impact: 'positive' },
        { id: 'tournament', weight: 6, text: 'A grand tournament is held in {kingdom}! Knights from across the realm compete.', type: 'military', impact: 'positive' },
        { id: 'advisor_betrayal', weight: 2, text: 'The {advisorRole} of {kingdom} has been secretly working for a rival kingdom!', type: 'intrigue', impact: 'negative' },
        { id: 'dynasty_feud', weight: 4, text: 'A bitter feud erupts within the {dynasty} dynasty over inheritance rights.', type: 'dynasty', impact: 'negative' },
        { id: 'brilliant_child', weight: 3, requires: 'has_children', text: 'Young {child} of {kingdom} shows exceptional talent, impressing the court.', type: 'dynasty', impact: 'positive' },
        { id: 'marriage_celebration', weight: 5, requires: 'unmarried_heir', text: '{heir} of {kingdom} celebrates a royal wedding with {spouse}.', type: 'dynasty', impact: 'positive' },
    ],

    // ────────────────────────────────────────────────────────────────────
    //  Core Character Generation
    // ────────────────────────────────────────────────────────────────────
    /**
     * Generate a new character
     */
    generateCharacter(options = {}) {
        const culture = options.culture || 'Imperial';
        const gender = options.gender || (Utils.random() < 0.5 ? 'male' : 'female');
        const age = options.age || Utils.randInt(18, 55);
        const dynasty = options.dynasty || null;
        const isRuler = options.isRuler || false;

        const namePool = Characters.FIRST_NAMES[culture] || Characters.FIRST_NAMES.Imperial;
        const firstName = options.name || Utils.randPick(namePool[gender] || namePool.male);

        const character = {
            id: Characters._generateId(),
            firstName,
            dynasty: dynasty || Utils.randPick(Characters.DYNASTY_NAMES[culture] || Characters.DYNASTY_NAMES.Imperial),
            gender,
            age,
            culture,
            birthDay: options.birthDay || 0,
            isAlive: true,
            isRuler,

            // Skills (1-20 scale)
            skills: {
                martial: Characters._rollSkill(isRuler ? 8 : 5),
                diplomacy: Characters._rollSkill(isRuler ? 8 : 5),
                stewardship: Characters._rollSkill(isRuler ? 8 : 5),
                intrigue: Characters._rollSkill(isRuler ? 6 : 5),
                learning: Characters._rollSkill(isRuler ? 6 : 5),
            },

            // Traits (1-3 traits)
            traits: Characters._rollTraits(Utils.randInt(1, 3)),

            // Health
            health: 100,
            isIll: false,

            // Family
            spouseId: null,
            childrenIds: [],
            parentId: null,
            siblingIds: [],

            // Lifespan
            maxLifespan: Utils.randInt(55, 85),

            // Opinion modifiers toward other characters
            opinions: {},
        };

        return character;
    },

    /**
     * Generate a full name string
     */
    getFullName(character) {
        if (!character) return 'Unknown';
        return `${character.firstName} ${character.dynasty}`;
    },

    /**
     * Generate a display name with title
     */
    getDisplayName(character, kingdom) {
        if (!character) return 'Unknown';
        const titles = {
            Imperial: { male: 'King', female: 'Queen' },
            Woodland: { male: 'King', female: 'Queen' },
            Nomadic: { male: 'Khan', female: 'Khatun' },
            Religious: { male: 'High Priest', female: 'High Priestess' },
            Maritime: { male: 'Consul', female: 'Consul' },
        };
        const cultureTitles = titles[character.culture] || titles.Imperial;
        const title = character.isRuler ? (cultureTitles[character.gender] || 'Ruler') : '';
        return title ? `${title} ${character.firstName} ${character.dynasty}` : `${character.firstName} ${character.dynasty}`;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Dynasty System
    // ────────────────────────────────────────────────────────────────────
    /**
     * Create a dynasty for a kingdom
     */
    createDynasty(kingdom) {
        const dynastyName = Utils.randPick(Characters.DYNASTY_NAMES[kingdom.culture] || Characters.DYNASTY_NAMES.Imperial);

        const dynasty = {
            id: Characters._generateId(),
            name: dynastyName,
            culture: kingdom.culture,
            kingdomId: kingdom.id,
            foundedDay: 1,
            members: [],    // Array of character IDs
            prestige: Utils.randInt(10, 50),
            bloodline: [],  // Ordered list of rulers
        };

        return dynasty;
    },

    /**
     * Generate a starter royal family for a kingdom
     */
    generateRoyalFamily(kingdom, world) {
        // Create dynasty
        const dynasty = Characters.createDynasty(kingdom);

        // Generate the ruler
        const ruler = Characters.generateCharacter({
            culture: kingdom.culture,
            age: Utils.randInt(30, 55),
            dynasty: dynasty.name,
            isRuler: true,
            birthDay: -(Utils.randInt(30, 55) * 120), // Approximate birth date
        });
        ruler.kingdomId = kingdom.id;

        // Generate spouse (70% chance of being married)
        let spouse = null;
        if (Utils.random() < 0.7) {
            const spouseGender = ruler.gender === 'male' ? 'female' : 'male';
            spouse = Characters.generateCharacter({
                culture: Utils.random() < 0.7 ? kingdom.culture : Utils.randPick(Object.keys(Characters.FIRST_NAMES)),
                gender: spouseGender,
                age: Utils.randInt(ruler.age - 5, ruler.age + 5),
                dynasty: Utils.random() < 0.5 ? dynasty.name : Utils.randPick(Characters.DYNASTY_NAMES[kingdom.culture] || Characters.DYNASTY_NAMES.Imperial),
                birthDay: -(Utils.randInt(25, 50) * 120),
            });
            spouse.kingdomId = kingdom.id;
            ruler.spouseId = spouse.id;
            spouse.spouseId = ruler.id;
            dynasty.members.push(spouse.id);
        }

        // Generate children (0-4)
        const numChildren = spouse ? Utils.randInt(0, 4) : 0;
        const children = [];
        for (let i = 0; i < numChildren; i++) {
            const childAge = Utils.randInt(1, Math.min(ruler.age - 16, 25));
            const child = Characters.generateCharacter({
                culture: kingdom.culture,
                age: childAge,
                dynasty: dynasty.name,
                birthDay: -(childAge * 120),
            });
            child.kingdomId = kingdom.id;
            child.parentId = ruler.id;
            ruler.childrenIds.push(child.id);
            if (spouse) {
                child.parentId2 = spouse.id;
            }
            // Siblings reference each other
            for (const sib of children) {
                child.siblingIds.push(sib.id);
                sib.siblingIds.push(child.id);
            }
            children.push(child);
            dynasty.members.push(child.id);
        }

        // Generate advisors
        const advisors = Characters.generateAdvisors(kingdom);

        // Store everything
        dynasty.members.unshift(ruler.id);
        dynasty.bloodline.push(ruler.id);

        return {
            dynasty,
            ruler,
            spouse,
            children,
            advisors,
        };
    },

    /**
     * Generate advisors for a kingdom
     */
    generateAdvisors(kingdom) {
        const advisors = {};
        const roles = Object.keys(Characters.ADVISOR_ROLES);

        for (const roleId of roles) {
            const role = Characters.ADVISOR_ROLES[roleId];
            const advisor = Characters.generateCharacter({
                culture: kingdom.culture,
                age: Utils.randInt(25, 60),
            });
            advisor.advisorRole = roleId;
            advisor.kingdomId = kingdom.id;
            // Boost the primary skill for this role
            advisor.skills[role.primarySkill] = Math.min(20, advisor.skills[role.primarySkill] + Utils.randInt(3, 8));
            advisor.loyalty = Utils.randInt(40, 90);
            advisors[roleId] = advisor;
        }

        return advisors;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Kingdom Bonuses from Characters
    // ────────────────────────────────────────────────────────────────────
    /**
     * Calculate all bonuses a kingdom gets from its ruler and advisors
     */
    getKingdomBonuses(kingdom) {
        const bonuses = {
            military: 0,
            treasury: 0,
            diplomacy: 0,
            stability: 0,
            loyalty: 0,
            expansion: 0,
            tradeBonus: 0,
            warBonus: 0,
            construction: 0,
            population: 0,
            intrigue: 0,
            research: 0,
            faith: 0,
            // Read through KingdomBonuses (world/kingdomState.js) and Characters:
            stewardship: 0,        // treasury income (half weight)
            upkeep: 0,             // war upkeep cost
            heirs: 0,              // heir birth chance
            culture: 0,            // cultural influence growth
            relations: 0,          // diplomacy drift
            caravanProfitBonus: 0, // trade-route founding
            rulerHealth: 0,        // ruler illness/recovery
            visionRadius: 0,       // Explorer: scouts colony sites further afield (colonization.js)
        };

        if (!kingdom.characterData) return bonuses;

        // Ruler trait bonuses
        const ruler = kingdom.characterData.ruler;
        if (ruler && ruler.isAlive) {
            for (const trait of ruler.traits) {
                const traitDef = Characters.RULER_TRAITS[trait.id];
                if (traitDef && traitDef.effects) {
                    for (const [key, val] of Object.entries(traitDef.effects)) {
                        if (bonuses[key] !== undefined) {
                            bonuses[key] += val;
                        }
                    }
                }
            }

            // Ruler skill bonuses (scaled: skill / 20 * 0.15)
            bonuses.military += (ruler.skills.martial / 20) * 0.15;
            bonuses.diplomacy += (ruler.skills.diplomacy / 20) * 0.15;
            bonuses.treasury += (ruler.skills.stewardship / 20) * 0.15;
            bonuses.intrigue += (ruler.skills.intrigue / 20) * 0.10;
            bonuses.research += (ruler.skills.learning / 20) * 0.10;
        }

        // Advisor bonuses
        const advisors = kingdom.characterData.advisors;
        if (advisors) {
            for (const [roleId, advisor] of Object.entries(advisors)) {
                if (!advisor || !advisor.isAlive) continue;
                const roleDef = Characters.ADVISOR_ROLES[roleId];
                if (roleDef && roleDef.bonuses) {
                    // Scale advisor bonuses by their skill level
                    const primarySkillVal = advisor.skills[roleDef.primarySkill] || 5;
                    const skillMultiplier = primarySkillVal / 15;
                    for (const [key, val] of Object.entries(roleDef.bonuses)) {
                        if (bonuses[key] !== undefined) {
                            bonuses[key] += val * skillMultiplier;
                        }
                    }
                }

                // Disloyal advisors reduce bonuses
                if (advisor.loyalty < 30) {
                    bonuses.stability -= 0.05;
                    bonuses.intrigue -= 0.05;
                }
            }
        }

        // Spouse diplomatic bonus
        const spouse = kingdom.characterData.spouse;
        if (spouse && spouse.isAlive) {
            bonuses.diplomacy += 0.05;
            // Foreign marriage bonus
            if (spouse.culture !== kingdom.culture) {
                bonuses.diplomacy += 0.05;
                bonuses.tradeBonus += 0.05;
            }
        }

        return bonuses;
    },
});
