// ============================================
// CHARACTERS — Dynasty, Advisors, Succession, Marriage & Character Events
// ============================================

import { Utils } from '../core/utils.js';

export const Characters = {

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
        const gender = options.gender || (Math.random() < 0.5 ? 'male' : 'female');
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
        if (Math.random() < 0.7) {
            const spouseGender = ruler.gender === 'male' ? 'female' : 'male';
            spouse = Characters.generateCharacter({
                culture: Math.random() < 0.7 ? kingdom.culture : Utils.randPick(Object.keys(Characters.FIRST_NAMES)),
                gender: spouseGender,
                age: Utils.randInt(ruler.age - 5, ruler.age + 5),
                dynasty: Math.random() < 0.5 ? dynasty.name : Utils.randPick(Characters.DYNASTY_NAMES[kingdom.culture] || Characters.DYNASTY_NAMES.Imperial),
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

    // ────────────────────────────────────────────────────────────────────
    //  Succession System
    // ────────────────────────────────────────────────────────────────────

    /**
     * Handle ruler death and succession
     */
    handleSuccession(kingdom, world) {
        const charData = kingdom.characterData;
        if (!charData) return;

        const oldRuler = charData.ruler;
        const oldRulerName = Characters.getDisplayName(oldRuler, kingdom);
        oldRuler.isAlive = false;
        oldRuler.isRuler = false;
        oldRuler.deathDay = world.day;

        // Find heir (eldest living child first, then spouse, then random dynasty member)
        let heir = null;
        let successionType = 'normal';

        // Eldest eligible child
        if (oldRuler.childrenIds.length > 0) {
            const children = oldRuler.childrenIds
                .map(id => Characters._findCharacter(kingdom, id))
                .filter(c => c && c.isAlive && c.age >= 16)
                .sort((a, b) => b.age - a.age);

            if (children.length > 0) {
                heir = children[0];
                successionType = 'heir';
            }
        }

        // Spouse as regent
        if (!heir && charData.spouse && charData.spouse.isAlive) {
            heir = charData.spouse;
            successionType = 'regent';
        }

        // Random dynasty member
        if (!heir) {
            heir = Characters.generateCharacter({
                culture: kingdom.culture,
                age: Utils.randInt(20, 40),
                dynasty: charData.dynasty.name,
                isRuler: true,
            });
            heir.kingdomId = kingdom.id;
            successionType = 'distant_relative';
        }

        // Succession crisis chance
        let crisisOccurred = false;
        if (successionType === 'distant_relative' || (successionType === 'regent' && Math.random() < 0.3)) {
            crisisOccurred = Characters._triggerSuccessionCrisis(kingdom, heir, world);
        }

        // Install new ruler
        heir.isRuler = true;
        charData.ruler = heir;
        charData.dynasty.bloodline.push(heir.id);
        if (!charData.dynasty.members.includes(heir.id)) {
            charData.dynasty.members.push(heir.id);
        }

        // Update kingdom ruler name
        kingdom.ruler = Characters.getDisplayName(heir, kingdom);

        // Generate new spouse if heir is unmarried
        if (!heir.spouseId) {
            if (Math.random() < 0.5) {
                const spouseGender = heir.gender === 'male' ? 'female' : 'male';
                const newSpouse = Characters.generateCharacter({
                    culture: Math.random() < 0.7 ? kingdom.culture : Utils.randPick(Object.keys(Characters.FIRST_NAMES)),
                    gender: spouseGender,
                    age: Utils.randInt(heir.age - 5, heir.age + 5),
                    dynasty: Utils.randPick(Characters.DYNASTY_NAMES[kingdom.culture] || Characters.DYNASTY_NAMES.Imperial),
                });
                newSpouse.kingdomId = kingdom.id;
                heir.spouseId = newSpouse.id;
                newSpouse.spouseId = heir.id;
                charData.spouse = newSpouse;
                charData.dynasty.members.push(newSpouse.id);
            } else {
                charData.spouse = null;
            }
        } else {
            // Find spouse in existing characters
            const existingSpouse = Characters._findCharacter(kingdom, heir.spouseId);
            charData.spouse = existingSpouse;
        }

        // Update the NPC Lord data to stay in sync
        if (kingdom.lord) {
            kingdom.lord.name = kingdom.ruler;
            kingdom.lord.age = heir.age;
        }

        // Event
        const eventText = crisisOccurred
            ? `👑 Succession Crisis in ${kingdom.name}! ${oldRulerName} has died. After a disputed succession, ${Characters.getFullName(heir)} seizes power.`
            : `👑 ${oldRulerName} of ${kingdom.name} has died at age ${oldRuler.age}. ${Characters.getDisplayName(heir, kingdom)} ascends to the throne (${successionType}).`;

        world.events.push({
            category: 'political',
            text: eventText,
            kingdom: kingdom.id,
            impact: crisisOccurred ? 'negative' : 'neutral',
        });

        return { heir, successionType, crisisOccurred };
    },

    /**
     * Trigger a succession crisis
     */
    _triggerSuccessionCrisis(kingdom, heir, world) {
        // Crisis effects
        const effects = Utils.randPick([
            'civil_war',
            'pretender',
            'nobles_revolt',
            'regency_council',
        ]);

        switch (effects) {
            case 'civil_war':
                // Lose territory and military
                kingdom.military = Math.floor(kingdom.military * 0.6);
                kingdom.treasury = Math.floor(kingdom.treasury * 0.7);
                // Reduce stability through advisor loyalty
                if (kingdom.characterData.advisors) {
                    for (const advisor of Object.values(kingdom.characterData.advisors)) {
                        if (advisor) advisor.loyalty = Math.max(0, advisor.loyalty - 30);
                    }
                }
                break;

            case 'pretender':
                // A pretender claims the throne — weaken the kingdom
                kingdom.military = Math.floor(kingdom.military * 0.8);
                // Relations drop with neighbors
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.max(-100, (kingdom.relations[k] || 0) - 20);
                }
                break;

            case 'nobles_revolt':
                // Nobles rebel — lose some territory
                const tilesToLose = Math.min(Math.floor(kingdom.territory.length * 0.1), 5);
                for (let i = 0; i < tilesToLose; i++) {
                    if (kingdom.territory.length > 3) {
                        const lostTile = kingdom.territory.pop();
                        const tile = world.getTile(lostTile.q, lostTile.r);
                        if (tile) {
                            tile.kingdom = null;
                        }
                    }
                }
                break;

            case 'regency_council':
                // Mild crisis — temporary debuffs
                heir.skills.martial = Math.max(1, heir.skills.martial - 3);
                heir.skills.diplomacy = Math.max(1, heir.skills.diplomacy - 3);
                break;
        }

        return true;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Marriage & Diplomacy
    // ────────────────────────────────────────────────────────────────────

    /**
     * Attempt a diplomatic marriage between two kingdoms
     */
    arrangeMarriage(kingdom1, kingdom2, world) {
        const data1 = kingdom1.characterData;
        const data2 = kingdom2.characterData;
        if (!data1 || !data2) return false;

        // Find eligible characters in each kingdom
        const eligible1 = Characters._getEligibleForMarriage(kingdom1);
        const eligible2 = Characters._getEligibleForMarriage(kingdom2);

        if (eligible1.length === 0 || eligible2.length === 0) return false;

        const char1 = Utils.randPick(eligible1);
        const char2 = Utils.randPick(eligible2.filter(c => c.gender !== char1.gender) || eligible2);

        if (!char2) return false;

        // Perform marriage
        char1.spouseId = char2.id;
        char2.spouseId = char1.id;

        // Improve relations
        const boost = Utils.randInt(15, 35);
        kingdom1.relations[kingdom2.id] = Math.min(100, (kingdom1.relations[kingdom2.id] || 0) + boost);
        kingdom2.relations[kingdom1.id] = Math.min(100, (kingdom2.relations[kingdom1.id] || 0) + boost);

        // Form alliance if relations are now high enough
        if ((kingdom1.relations[kingdom2.id] || 0) > 60 && !kingdom1.allies.includes(kingdom2.id)) {
            kingdom1.allies.push(kingdom2.id);
            kingdom2.allies.push(kingdom1.id);
        }

        world.events.push({
            category: 'diplomatic',
            text: `💒 A royal marriage between ${Characters.getFullName(char1)} of ${kingdom1.name} and ${Characters.getFullName(char2)} of ${kingdom2.name}! Relations strengthened.`,
            kingdom: kingdom1.id,
            impact: 'positive',
        });

        return true;
    },

    /**
     * Get eligible characters for marriage
     */
    _getEligibleForMarriage(kingdom) {
        const eligible = [];
        const data = kingdom.characterData;
        if (!data) return eligible;

        // Check ruler
        if (data.ruler && data.ruler.isAlive && !data.ruler.spouseId && data.ruler.age >= 16) {
            eligible.push(data.ruler);
        }
        // Check children
        if (data.children) {
            for (const child of data.children) {
                if (child.isAlive && !child.spouseId && child.age >= 16) {
                    eligible.push(child);
                }
            }
        }
        return eligible;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Daily Processing
    // ────────────────────────────────────────────────────────────────────

    /**
     * Process character system each day for all kingdoms
     */
    processTurn(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.characterData) continue;
            Characters.processKingdomCharacters(kingdom, world);
        }

        // Consider diplomatic marriages between kingdoms (rare)
        if (Math.random() < 0.02) {
            Characters._considerDiplomaticMarriages(world);
        }
    },

    /**
     * Process character-related events for a single kingdom
     */
    processKingdomCharacters(kingdom, world) {
        const data = kingdom.characterData;
        if (!data) return;

        const ruler = data.ruler;
        if (!ruler || !ruler.isAlive) return;

        // ── Age characters (once per year = every 120 days) ──
        if (world.day % 120 === 0) {
            Characters._ageCharacters(kingdom, world);
        }

        // ── Apply kingdom bonuses from characters ──
        const bonuses = Characters.getKingdomBonuses(kingdom);
        kingdom.characterBonuses = bonuses;

        // ── Random character events (5% chance per day per kingdom) ──
        if (Math.random() < 0.05) {
            Characters._triggerCharacterEvent(kingdom, world);
        }

        // ── Heir birth chance (every 30 days if married, ruler < 50) ──
        if (world.day % 30 === 0 && data.spouse && data.spouse.isAlive && ruler.age < 50) {
            const fertilityBonus = ruler.traits.some(t => t.id === 'fertile') ? 0.15 : 0;
            if (Math.random() < 0.08 + fertilityBonus) {
                Characters._birthChild(kingdom, ruler, data.spouse, world);
            }
        }

        // ── Advisor loyalty drift ──
        if (world.day % 60 === 0 && data.advisors) {
            for (const [roleId, advisor] of Object.entries(data.advisors)) {
                if (!advisor) continue;
                // Loyalty drifts based on ruler traits
                let loyaltyChange = Utils.randInt(-5, 5);
                if (ruler.traits.some(t => t.id === 'just_ruler' || t.id === 'charismatic')) loyaltyChange += 3;
                if (ruler.traits.some(t => t.id === 'cruel' || t.id === 'paranoid')) loyaltyChange -= 3;
                advisor.loyalty = Utils.clamp(advisor.loyalty + loyaltyChange, 0, 100);

                // Very disloyal advisor may leave or betray
                if (advisor.loyalty < 10 && Math.random() < 0.3) {
                    world.events.push({
                        category: 'political',
                        text: `🚪 The ${Characters.ADVISOR_ROLES[roleId].name} of ${kingdom.name}, ${Characters.getFullName(advisor)}, has abandoned their post!`,
                        kingdom: kingdom.id,
                        impact: 'negative',
                    });
                    // Replace advisor
                    const newAdvisor = Characters.generateCharacter({
                        culture: kingdom.culture,
                        age: Utils.randInt(25, 55),
                    });
                    newAdvisor.advisorRole = roleId;
                    newAdvisor.kingdomId = kingdom.id;
                    newAdvisor.loyalty = Utils.randInt(50, 80);
                    const roleDef = Characters.ADVISOR_ROLES[roleId];
                    newAdvisor.skills[roleDef.primarySkill] = Math.min(20, newAdvisor.skills[roleDef.primarySkill] + Utils.randInt(3, 8));
                    data.advisors[roleId] = newAdvisor;
                }
            }
        }
    },

    /**
     * Age all characters in a kingdom and handle natural deaths
     */
    _ageCharacters(kingdom, world) {
        const data = kingdom.characterData;
        const allChars = Characters._getAllKingdomCharacters(kingdom);

        for (const char of allChars) {
            if (!char.isAlive) continue;
            char.age++;

            // Death chance increases sharply after maxLifespan
            if (char.age >= char.maxLifespan) {
                const deathChance = (char.age - char.maxLifespan + 1) * 0.15;
                if (Math.random() < deathChance) {
                    char.isAlive = false;
                    char.deathDay = world.day;

                    // If this was the ruler, trigger succession
                    if (char === data.ruler) {
                        Characters.handleSuccession(kingdom, world);
                        return; // Succession handles its own events
                    }

                    // Otherwise just announce
                    if (char === data.spouse) {
                        world.events.push({
                            category: 'political',
                            text: `${Characters.getFullName(char)} of ${kingdom.name}, spouse of the ruler, has died at age ${char.age}.`,
                            kingdom: kingdom.id,
                            impact: 'neutral',
                        });
                        data.spouse = null;
                        if (data.ruler) data.ruler.spouseId = null;
                    }
                }
            }

            // Illness
            if (!char.isIll && char.age > 45 && Math.random() < 0.02) {
                char.isIll = true;
                char.health = Math.max(20, char.health - Utils.randInt(20, 50));
            }

            // Recovery from illness
            if (char.isIll && Math.random() < 0.3) {
                char.isIll = false;
                char.health = Math.min(100, char.health + Utils.randInt(10, 30));
            }

            // Ill characters have higher death chance
            if (char.isIll && Math.random() < 0.05) {
                char.isAlive = false;
                char.deathDay = world.day;

                if (char === data.ruler) {
                    Characters.handleSuccession(kingdom, world);
                    return;
                }
            }
        }
    },

    /**
     * Birth a new child
     */
    _birthChild(kingdom, parent1, parent2, world) {
        const data = kingdom.characterData;
        const child = Characters.generateCharacter({
            culture: kingdom.culture,
            age: 0,
            dynasty: data.dynasty.name,
            birthDay: world.day,
        });
        child.kingdomId = kingdom.id;
        child.parentId = parent1.id;
        child.parentId2 = parent2.id;
        child.maxLifespan = Utils.randInt(55, 90);

        // Child inherits some parent skills (reduced)
        for (const skill of Object.keys(child.skills)) {
            const parentAvg = ((parent1.skills[skill] || 5) + (parent2.skills[skill] || 5)) / 2;
            child.skills[skill] = Math.max(1, Math.floor(parentAvg * 0.5 + Utils.randInt(1, 5)));
        }

        parent1.childrenIds.push(child.id);

        // Add siblings
        if (data.children) {
            for (const sib of data.children) {
                if (sib.isAlive) {
                    child.siblingIds.push(sib.id);
                    sib.siblingIds.push(child.id);
                }
            }
            data.children.push(child);
        } else {
            data.children = [child];
        }

        data.dynasty.members.push(child.id);
        data.dynasty.prestige += 5;

        world.events.push({
            category: 'dynasty',
            text: `👶 A child, ${Characters.getFullName(child)}, is born in the royal family of ${kingdom.name}!`,
            kingdom: kingdom.id,
            impact: 'positive',
        });
    },

    /**
     * Trigger a random character event
     */
    _triggerCharacterEvent(kingdom, world) {
        const data = kingdom.characterData;
        const ruler = data.ruler;
        if (!ruler) return;

        // Filter applicable events
        const applicable = Characters.CHARACTER_EVENTS.filter(e => {
            if (e.minAge && ruler.age < e.minAge) return false;
            if (e.maxAge && ruler.age > e.maxAge) return false;
            if (e.requires === 'married' && !data.spouse) return false;
            if (e.requires === 'ill' && !ruler.isIll) return false;
            if (e.requires === 'no_heirs' && ruler.childrenIds.length > 0) return false;
            if (e.requires === 'has_children' && (!data.children || data.children.filter(c => c.isAlive).length === 0)) return false;
            if (e.requires === 'unmarried_heir') {
                const unmarriedHeir = data.children && data.children.find(c => c.isAlive && c.age >= 16 && !c.spouseId);
                if (!unmarriedHeir) return false;
            }
            return true;
        });

        if (applicable.length === 0) return;

        // Weighted pick
        const totalWeight = applicable.reduce((s, e) => s + e.weight, 0);
        let roll = Math.random() * totalWeight;
        let chosen = applicable[0];
        for (const e of applicable) {
            roll -= e.weight;
            if (roll <= 0) { chosen = e; break; }
        }

        // Fill in template text
        let text = chosen.text;
        text = text.replace('{ruler}', Characters.getFullName(ruler));
        text = text.replace('{kingdom}', kingdom.name);
        text = text.replace('{dynasty}', data.dynasty.name);

        if (data.spouse) {
            text = text.replace('{spouse}', Characters.getFullName(data.spouse));
        }

        if (data.children && data.children.length > 0) {
            const livingChild = data.children.find(c => c.isAlive);
            if (livingChild) {
                text = text.replace('{child}', Characters.getFullName(livingChild));
                text = text.replace('{heir}', Characters.getFullName(livingChild));
            }
        }

        if (data.advisors) {
            const roleKeys = Object.keys(data.advisors).filter(k => data.advisors[k]);
            if (roleKeys.length > 0) {
                const randomRole = Utils.randPick(roleKeys);
                text = text.replace('{advisorRole}', Characters.ADVISOR_ROLES[randomRole].name);
            }
        }

        // Resolve {char1}, {char2} for marriage proposals
        text = text.replace('{char1}', Characters.getFullName(ruler));
        const otherKingdoms = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id && k.characterData);
        if (otherKingdoms.length > 0) {
            const otherK = Utils.randPick(otherKingdoms);
            const otherRuler = otherK.characterData.ruler;
            if (otherRuler) {
                text = text.replace('{char2}', Characters.getFullName(otherRuler));
            }
        }

        // Handle trait gained
        if (chosen.id === 'trait_gained') {
            const traitKeys = Object.keys(Characters.RULER_TRAITS).filter(
                t => !ruler.traits.some(rt => rt.id === t)
            );
            if (traitKeys.length > 0) {
                const newTraitId = Utils.randPick(traitKeys);
                const newTrait = Characters.RULER_TRAITS[newTraitId];
                ruler.traits.push(newTrait);
                text = text.replace('{trait}', newTrait.name);
            }
        }

        // Handle specific event effects
        Characters._applyEventEffects(chosen, kingdom, world);

        world.events.push({
            category: chosen.type || 'political',
            text: text,
            kingdom: kingdom.id,
            impact: chosen.impact || 'neutral',
        });
    },

    /**
     * Apply mechanical effects of character events
     */
    _applyEventEffects(event, kingdom, world) {
        switch (event.id) {
            case 'ruler_ill':
                if (kingdom.characterData.ruler) {
                    kingdom.characterData.ruler.isIll = true;
                    kingdom.characterData.ruler.health -= Utils.randInt(20, 40);
                }
                break;

            case 'ruler_recovers':
                if (kingdom.characterData.ruler) {
                    kingdom.characterData.ruler.isIll = false;
                    kingdom.characterData.ruler.health = Math.min(100, kingdom.characterData.ruler.health + 30);
                }
                break;

            case 'assassination_attempt': {
                const ruler = kingdom.characterData.ruler;
                const spymaster = kingdom.characterData.advisors?.spymaster;
                // Spymaster skill determines survival chance
                const survivalChance = spymaster ? 0.5 + (spymaster.skills.intrigue / 40) : 0.4;
                if (Math.random() > survivalChance) {
                    // Ruler dies from assassination
                    world.events.push({
                        category: 'political',
                        text: `💀 The assassination of ${Characters.getFullName(ruler)} in ${kingdom.name} succeeds! The realm is thrown into chaos.`,
                        kingdom: kingdom.id,
                        impact: 'negative',
                    });
                    Characters.handleSuccession(kingdom, world);
                } else {
                    ruler.health -= Utils.randInt(10, 30);
                }
                break;
            }

            case 'advisor_scandal': {
                const advisors = kingdom.characterData.advisors;
                if (advisors) {
                    const roleKeys = Object.keys(advisors).filter(k => advisors[k]);
                    if (roleKeys.length > 0) {
                        const role = Utils.randPick(roleKeys);
                        advisors[role].loyalty -= 20;
                        kingdom.treasury = Math.floor(kingdom.treasury * 0.9);
                    }
                }
                break;
            }

            case 'advisor_betrayal': {
                const advisors = kingdom.characterData.advisors;
                if (advisors) {
                    const roleKeys = Object.keys(advisors).filter(k => advisors[k]);
                    if (roleKeys.length > 0) {
                        const role = Utils.randPick(roleKeys);
                        // Replace the traitor
                        const newAdvisor = Characters.generateCharacter({
                            culture: kingdom.culture,
                            age: Utils.randInt(25, 55),
                        });
                        newAdvisor.advisorRole = role;
                        newAdvisor.kingdomId = kingdom.id;
                        newAdvisor.loyalty = Utils.randInt(50, 80);
                        advisors[role] = newAdvisor;
                    }
                }
                // Relations drop with all neighbors
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.max(-100, (kingdom.relations[k] || 0) - 10);
                }
                break;
            }

            case 'feast':
                // Improve relations slightly with all kingdoms
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.min(100, (kingdom.relations[k] || 0) + 5);
                }
                kingdom.treasury -= Utils.randInt(50, 200);
                break;

            case 'tournament':
                kingdom.military = Math.floor(kingdom.military * 1.05);
                kingdom.treasury -= Utils.randInt(100, 300);
                break;

            case 'heir_born':
                Characters._birthChild(
                    kingdom,
                    kingdom.characterData.ruler,
                    kingdom.characterData.spouse,
                    world
                );
                break;

            case 'succession_crisis':
                Characters._triggerSuccessionCrisis(kingdom, kingdom.characterData.ruler, world);
                break;
        }
    },

    /**
     * Consider arranging marriages between kingdoms for diplomacy
     */
    _considerDiplomaticMarriages(world) {
        const aliveKingdoms = world.kingdoms.filter(k => k.isAlive && k.characterData);
        if (aliveKingdoms.length < 2) return;

        const k1 = Utils.randPick(aliveKingdoms);
        const potentialPartners = aliveKingdoms.filter(k =>
            k.id !== k1.id &&
            !k1.wars.includes(k.id) &&
            (k1.relations[k.id] || 0) > -20
        );

        if (potentialPartners.length === 0) return;
        const k2 = Utils.randPick(potentialPartners);

        Characters.arrangeMarriage(k1, k2, world);
    },

    // ────────────────────────────────────────────────────────────────────
    //  Initialization
    // ────────────────────────────────────────────────────────────────────

    /**
     * Initialize the character system for all kingdoms in the world
     */
    initialize(world) {
        for (const kingdom of world.kingdoms) {
            const familyData = Characters.generateRoyalFamily(kingdom, world);
            kingdom.characterData = familyData;

            // Update kingdom's ruler name to match the generated character
            kingdom.ruler = Characters.getDisplayName(familyData.ruler, kingdom);
        }
        console.log('Character system initialized for all kingdoms.');
    },

    // ────────────────────────────────────────────────────────────────────
    //  Utility / Private
    // ────────────────────────────────────────────────────────────────────

    _idCounter: 0,

    _generateId() {
        return `char_${Date.now()}_${Characters._idCounter++}`;
    },

    _rollSkill(base) {
        return Utils.clamp(base + Utils.randInt(-3, 5), 1, 20);
    },

    _rollTraits(count) {
        const allTraits = Object.values(Characters.RULER_TRAITS);
        const picked = [];
        const available = [...allTraits];

        for (let i = 0; i < count && available.length > 0; i++) {
            const idx = Utils.randInt(0, available.length - 1);
            picked.push(available[idx]);
            available.splice(idx, 1);
        }
        return picked;
    },

    /**
     * Find a character by ID within a kingdom's character data
     */
    _findCharacter(kingdom, charId) {
        const data = kingdom.characterData;
        if (!data) return null;

        if (data.ruler && data.ruler.id === charId) return data.ruler;
        if (data.spouse && data.spouse.id === charId) return data.spouse;
        if (data.children) {
            const child = data.children.find(c => c.id === charId);
            if (child) return child;
        }
        if (data.advisors) {
            for (const advisor of Object.values(data.advisors)) {
                if (advisor && advisor.id === charId) return advisor;
            }
        }
        return null;
    },

    /**
     * Get all characters in a kingdom (alive and dead)
     */
    _getAllKingdomCharacters(kingdom) {
        const chars = [];
        const data = kingdom.characterData;
        if (!data) return chars;

        if (data.ruler) chars.push(data.ruler);
        if (data.spouse) chars.push(data.spouse);
        if (data.children) chars.push(...data.children);
        if (data.advisors) {
            for (const advisor of Object.values(data.advisors)) {
                if (advisor) chars.push(advisor);
            }
        }
        return chars;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Serialization for Save/Load
    // ────────────────────────────────────────────────────────────────────

    /**
     * Serialize character data for saving
     */
    serialize(kingdom) {
        if (!kingdom.characterData) return null;
        const data = kingdom.characterData;
        return {
            dynasty: data.dynasty,
            ruler: data.ruler,
            spouse: data.spouse,
            children: data.children,
            advisors: data.advisors,
        };
    },

    /**
     * Restore character data from save
     */
    deserialize(kingdom, savedData) {
        if (!savedData) return;
        kingdom.characterData = savedData;
    },
};
