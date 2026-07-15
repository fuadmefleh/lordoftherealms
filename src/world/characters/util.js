// Characters — util members (split from the original monolith).
import { Characters } from './_ref.js';
import { Utils } from './_imports.js';

Object.assign(Characters, {
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
});
