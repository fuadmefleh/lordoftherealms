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
    _generateId() {
        return `char_${Utils.nextId()}`;
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
        // One person, one record: a child who inherited (or wed in) is still in
        // the children's list as the ruler (or spouse) too — written once, as
        // the ruler, and a place-mark left in the list (childRefs) for the load
        let children = data.children;
        let childRefs = null;
        if (Array.isArray(data.children)) {
            children = [];
            data.children.forEach((c, i) => {
                const as = c && c === data.ruler ? 'ruler' : c && c === data.spouse ? 'spouse' : null;
                if (as) (childRefs || (childRefs = [])).push({ i, as });
                else children.push(c);
            });
        }
        const out = {
            dynasty: data.dynasty,
            ruler: data.ruler,
            spouse: data.spouse,
            children,
            advisors: data.advisors,
        };
        if (childRefs) out.childRefs = childRefs;
        return out;
    },

    /**
     * Restore character data from save: the ruler (or spouse) put back in the
     * children's list where they stood, the same record (an older save that
     * wrote them twice: the copy in the list swapped for the ruler's own).
     */
    deserialize(kingdom, savedData) {
        if (!savedData) return;
        const refs = Array.isArray(savedData.childRefs) ? savedData.childRefs : null;
        delete savedData.childRefs;
        if (Array.isArray(savedData.children)) {
            const same = (c, p) => c && p && c !== p && c.id != null && c.id === p.id;
            savedData.children = savedData.children.map(c => (same(c, savedData.ruler) ? savedData.ruler : same(c, savedData.spouse) ? savedData.spouse : c));
            if (refs) {
                for (const r of refs.slice().sort((a, b) => a.i - b.i)) {
                    const who = savedData[r.as];
                    if (who && !savedData.children.includes(who)) savedData.children.splice(Math.min(r.i, savedData.children.length), 0, who);
                }
            }
        }
        kingdom.characterData = savedData;
    },
});
