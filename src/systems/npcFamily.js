// ============================================
// NPC FAMILY & SOCIAL SYSTEM — Sims-like Relationships
// ============================================
// Features:
//   - Family tree generation (spouses, parents, children, siblings)
//   - NPC-to-NPC relationship scores & opinions
//   - Player-NPC relationship bridging (dialog disposition + relationship score)
//   - Family-aware dialog helpers (gossip, reactions, family info)
//   - Social ripple effects (treating a family member well/poorly affects relatives)
//
// Works with inner map NPCs (spawned in _spawnNPCs) and
// the existing Relationships system (persistent relationship NPCs).

import { Relationships } from './relationships.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const LAST_NAMES = [
    'Stoneheart', 'Ironwood', 'Oakshield', 'Ashborne', 'Blackthorn',
    'Ravencrest', 'Whitfield', 'Wolfsbane', 'Thornwall', 'Greymoor',
    'Deepwell', 'Brightwater', 'Coldhaven', 'Firebrand', 'Goldenleaf',
    'Hawkridge', 'Stormveil', 'Silverbrook', 'Duskwood', 'Frostholm',
    'Redforge', 'Copperfield', 'Bramblewood', 'Wyndham', 'Flintlock',
    'Ashford', 'Millbrook', 'Hayward', 'Alderton', 'Crestfall',
];

// Family relationship types for NPC-to-NPC bonds
const FAMILY_BOND = {
    SPOUSE:  'spouse',
    PARENT:  'parent',
    CHILD:   'child',
    SIBLING: 'sibling',
};

// NPC opinion levels (separate from player relationship levels)
const OPINION_LABELS = [
    { id: 'loathed',      label: 'Loathed',        icon: '💀', minScore: -100, color: '#D32F2F' },
    { id: 'disliked',     label: 'Disliked',        icon: '😠', minScore: -50,  color: '#EF5350' },
    { id: 'unfriendly',   label: 'Unfriendly',      icon: '😒', minScore: -20,  color: '#FF8A65' },
    { id: 'indifferent',  label: 'Indifferent',     icon: '😐', minScore: -5,   color: '#FFD54F' },
    { id: 'friendly',     label: 'Friendly',        icon: '🙂', minScore: 20,   color: '#A5D6A7' },
    { id: 'close',        label: 'Close',           icon: '😊', minScore: 50,   color: '#66BB6A' },
    { id: 'devoted',      label: 'Devoted',         icon: '💙', minScore: 80,   color: '#4FC3F7' },
];

// Age brackets for family role assignment
const AGE_BRACKET = {
    child:    { min: 6,  max: 14 },
    young:    { min: 15, max: 24 },
    adult:    { min: 25, max: 50 },
    elder:    { min: 51, max: 72 },
};

// NPC types that can be parents
const ADULT_TYPES = ['merchant', 'guard', 'farmer', 'priest', 'blacksmith_npc', 'villager', 'noble', 'traveler', 'beggar'];

// Relationship comment templates — NPC says something about a family member
const FAMILY_COMMENTS = {
    spouse: [
        'My {spouse_title} {name} is the light of my life.',
        '{name} and I have been together for years. I couldn\'t imagine life without them.',
        '*smiles warmly* {name} is probably waiting for me at home.',
        'Have you met my {spouse_title}? {name} is wonderful.',
        'Between you and me, {name} snores something terrible. But I love them all the same.',
    ],
    child: [
        'My little {name} grows bigger every day! I\'m so proud.',
        '{name} has been getting into mischief again. Kids, right?',
        'I worry about {name}. The world is a dangerous place for children.',
        '{name} wants to be an adventurer someday. I hope they stay safe.',
        'Have you seen {name} running around? That child never sits still!',
    ],
    parent: [
        'My {parent_title} {name} taught me everything I know.',
        '{name} would be proud of what I\'ve become. At least, I hope so.',
        'I learned my trade from {name}. Best teacher you could ask for.',
        '{name} always said "hard work builds character." They were right.',
        'If {name} saw me now, they\'d probably tell me to stand up straighter.',
    ],
    sibling: [
        '{name} and I used to get into so much trouble together as kids!',
        'My {sibling_title} {name} is around here somewhere.',
        '{name} always was the {trait} one in the family.',
        'We don\'t always agree, but {name} is family and I love them.',
        'Don\'t tell {name} I said this, but they\'re actually pretty talented.',
    ],
};

// What an NPC says about the player based on how the player treated their family member
const FAMILY_REACTION_LINES = {
    positive: [
        'I heard you were kind to my {relation} {name}. That means a lot to me.',
        '{name} spoke well of you. Any friend of my {relation} is a friend of mine.',
        'My {relation} {name} told me about your generosity. Thank you.',
        'You helped {name}? I won\'t forget that kindness.',
    ],
    negative: [
        'I know what you did to my {relation} {name}. Don\'t think I\'ve forgotten.',
        '{name} came home upset because of you. Mind explaining yourself?',
        'You threatened my {relation}. You\'ve got some nerve talking to me.',
        'Stay away from {name}. And stay away from me.',
    ],
};

// What NPCs say about other NPCs (gossip)
const GOSSIP_LINES = {
    positive: [
        '{name}? Oh, they\'re wonderful. Always lending a hand.',
        'I like {name}. Good {type_lower}, good person.',
        '{name} and I get along well. Known them for years.',
        'You should talk to {name}. Very {trait} person.',
    ],
    neutral: [
        '{name}? Can\'t say I know them well. Seems alright.',
        'I see {name} around. We nod, exchange pleasantries. That\'s about it.',
        '{name} keeps to themselves, mostly. No complaints.',
    ],
    negative: [
        'Don\'t get me started on {name}. We have... disagreements.',
        '{name}? *scoffs* Let\'s just say we don\'t see eye to eye.',
        'I\'d steer clear of {name} if I were you.',
        '{name} and I have had our differences. Leave it at that.',
    ],
};

// ══════════════════════════════════════════════════════════════════════════════
// RUNTIME STATE
// ══════════════════════════════════════════════════════════════════════════════

// NPC-to-NPC relationships: { "npcIdA_npcIdB" => { score, type, events[] } }
let _npcRelationships = {};

// Current settlement family groups
let _familyGroups = [];

// ══════════════════════════════════════════════════════════════════════════════
// FAMILY GENERATION — deterministic, called after _spawnNPCs
// ══════════════════════════════════════════════════════════════════════════════

export const NpcFamily = {

    /**
     * Generate family trees and NPC-NPC relationships for inner map NPCs.
     * Called from InnerMap._spawnNPCs after NPC generation.
     * Uses the same seeded RNG for determinism.
     *
     * @param {Array} npcs — Array of inner map NPC objects
     * @param {Function} rng — Seeded random number generator (returns 0-1)
     */
    generateFamilies(npcs, rng) {
        _npcRelationships = {};
        _familyGroups = [];

        if (!npcs || npcs.length === 0) return;

        // Assign ages, genders, and last names FIRST
        NpcFamily._assignDemographics(npcs, rng);

        // Group into families
        NpcFamily._buildFamilyGroups(npcs, rng);

        // Generate NPC-NPC relationships (friendship/rivalry between non-family members)
        NpcFamily._generateSocialBonds(npcs, rng);
    },

    /**
     * Assign age, gender, and base social attributes to NPCs
     */
    _assignDemographics(npcs, rng) {
        const genders = ['male', 'female'];
        for (const npc of npcs) {
            // Age based on type
            if (npc.type === 'child') {
                npc.age = Math.floor(rng() * (AGE_BRACKET.child.max - AGE_BRACKET.child.min)) + AGE_BRACKET.child.min;
            } else if (npc.type === 'noble' || npc.type === 'priest') {
                npc.age = Math.floor(rng() * (AGE_BRACKET.elder.max - AGE_BRACKET.adult.min)) + AGE_BRACKET.adult.min;
            } else {
                npc.age = Math.floor(rng() * (AGE_BRACKET.elder.max - AGE_BRACKET.young.min)) + AGE_BRACKET.young.min;
            }

            // Gender
            npc.gender = genders[Math.floor(rng() * 2)];

            // Personality traits (for social flavor)
            const traits = ['kind', 'stern', 'jovial', 'quiet', 'bold', 'cautious', 'witty', 'generous', 'stubborn', 'curious'];
            npc.personalityTraits = [];
            const traitCount = 1 + Math.floor(rng() * 2); // 1-2 traits
            const pool = [...traits];
            for (let i = 0; i < traitCount && pool.length > 0; i++) {
                const idx = Math.floor(rng() * pool.length);
                npc.personalityTraits.push(pool.splice(idx, 1)[0]);
            }

            // Initialize family fields
            npc.lastName = null;
            npc.fullName = npc.name;
            npc.familyGroupId = null;
            npc.spouseId = null;
            npc.parentIds = [];
            npc.childIds = [];
            npc.siblingIds = [];
        }
    },

    /**
     * Build family groups: pairs of adults become couples, children assigned to parents
     */
    _buildFamilyGroups(npcs, rng) {
        const adults = npcs.filter(n => ADULT_TYPES.includes(n.type) && n.age >= AGE_BRACKET.adult.min);
        const children = npcs.filter(n => n.type === 'child');
        const youngAdults = npcs.filter(n => ADULT_TYPES.includes(n.type) &&
            n.age >= AGE_BRACKET.young.min && n.age < AGE_BRACKET.adult.min);

        // Shuffle adults for pairing
        const shuffled = [...adults];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        let familyId = 0;
        const usedIds = new Set();
        const lastNamePool = [...LAST_NAMES];

        // Pair adults into couples
        while (shuffled.length >= 2 && lastNamePool.length > 0) {
            const a = shuffled.pop();
            const b = shuffled.pop();
            if (!a || !b || usedIds.has(a.id) || usedIds.has(b.id)) continue;

            // Only pair adults who aren't travelers
            if (a.type === 'traveler' || b.type === 'traveler') {
                // Put one back
                if (a.type !== 'traveler') shuffled.push(a);
                if (b.type !== 'traveler') shuffled.push(b);
                continue;
            }

            // Make them different genders for family
            if (a.gender === b.gender) b.gender = a.gender === 'male' ? 'female' : 'male';

            // Assign family
            const lnIdx = Math.floor(rng() * lastNamePool.length);
            const lastName = lastNamePool.splice(lnIdx, 1)[0];

            a.lastName = lastName;
            b.lastName = lastName;
            a.fullName = `${a.name} ${lastName}`;
            b.fullName = `${b.name} ${lastName}`;
            a.familyGroupId = familyId;
            b.familyGroupId = familyId;
            a.spouseId = b.id;
            b.spouseId = a.id;

            usedIds.add(a.id);
            usedIds.add(b.id);

            // Create spouse relationship
            NpcFamily._setNpcRelationship(a.id, b.id, {
                score: 60 + Math.floor(rng() * 35), // 60-94
                type: FAMILY_BOND.SPOUSE,
                events: [],
            });

            _familyGroups.push({
                id: familyId,
                lastName,
                parentIds: [a.id, b.id],
                childIds: [],
            });

            familyId++;
        }

        // Assign remaining adults as singles with last names
        for (const npc of shuffled) {
            if (!npc.lastName && !usedIds.has(npc.id)) {
                if (lastNamePool.length > 0) {
                    const lnIdx = Math.floor(rng() * lastNamePool.length);
                    npc.lastName = lastNamePool.splice(lnIdx, 1)[0];
                } else {
                    npc.lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
                }
                npc.fullName = `${npc.name} ${npc.lastName}`;
            }
        }

        // Young adults can be siblings or single
        for (const ya of youngAdults) {
            if (usedIds.has(ya.id)) continue;

            // Try to assign as older child of a family
            if (_familyGroups.length > 0 && rng() < 0.5) {
                const fam = _familyGroups[Math.floor(rng() * _familyGroups.length)];
                ya.lastName = fam.lastName;
                ya.fullName = `${ya.name} ${fam.lastName}`;
                ya.familyGroupId = fam.id;
                ya.parentIds = [...fam.parentIds];
                fam.childIds.push(ya.id);
                usedIds.add(ya.id);

                // Set parent-child relationships
                for (const pId of fam.parentIds) {
                    NpcFamily._setNpcRelationship(pId, ya.id, {
                        score: 70 + Math.floor(rng() * 25),
                        type: FAMILY_BOND.PARENT,
                        events: [],
                    });
                    const parent = npcs.find(n => n.id === pId);
                    if (parent && !parent.childIds.includes(ya.id)) parent.childIds.push(ya.id);
                }
            }

            if (!ya.lastName) {
                if (lastNamePool.length > 0) {
                    const lnIdx = Math.floor(rng() * lastNamePool.length);
                    ya.lastName = lastNamePool.splice(lnIdx, 1)[0];
                } else {
                    ya.lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
                }
                ya.fullName = `${ya.name} ${ya.lastName}`;
            }
        }

        // Assign children to families
        const childQueue = [...children];
        for (let i = childQueue.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [childQueue[i], childQueue[j]] = [childQueue[j], childQueue[i]];
        }

        for (const child of childQueue) {
            if (usedIds.has(child.id)) continue;

            if (_familyGroups.length > 0) {
                // Assign to a family group (prefer families with fewer children)
                const sorted = [..._familyGroups].sort((a, b) => a.childIds.length - b.childIds.length);
                // Pick from top 3 least-children families
                const topN = sorted.slice(0, Math.min(3, sorted.length));
                const fam = topN[Math.floor(rng() * topN.length)];

                child.lastName = fam.lastName;
                child.fullName = `${child.name} ${fam.lastName}`;
                child.familyGroupId = fam.id;
                child.parentIds = [...fam.parentIds];
                fam.childIds.push(child.id);
                usedIds.add(child.id);

                // Set parent-child relationships
                for (const pId of fam.parentIds) {
                    NpcFamily._setNpcRelationship(pId, child.id, {
                        score: 85 + Math.floor(rng() * 15), // parents love their kids
                        type: FAMILY_BOND.PARENT,
                        events: [],
                    });
                    const parent = npcs.find(n => n.id === pId);
                    if (parent && !parent.childIds.includes(child.id)) parent.childIds.push(child.id);
                }
            } else {
                // No families, just give them a name
                if (lastNamePool.length > 0) {
                    const lnIdx = Math.floor(rng() * lastNamePool.length);
                    child.lastName = lastNamePool.splice(lnIdx, 1)[0];
                } else {
                    child.lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
                }
                child.fullName = `${child.name} ${child.lastName}`;
            }
        }

        // Set sibling relationships
        for (const fam of _familyGroups) {
            const allChildIds = fam.childIds;
            for (let i = 0; i < allChildIds.length; i++) {
                for (let j = i + 1; j < allChildIds.length; j++) {
                    const a = npcs.find(n => n.id === allChildIds[i]);
                    const b = npcs.find(n => n.id === allChildIds[j]);
                    if (a && b) {
                        if (!a.siblingIds.includes(b.id)) a.siblingIds.push(b.id);
                        if (!b.siblingIds.includes(a.id)) b.siblingIds.push(a.id);
                        NpcFamily._setNpcRelationship(a.id, b.id, {
                            score: 40 + Math.floor(rng() * 40), // 40-79
                            type: FAMILY_BOND.SIBLING,
                            events: [],
                        });
                    }
                }
            }
        }

        // Ensure every NPC has a last name
        for (const npc of npcs) {
            if (!npc.lastName) {
                npc.lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
                npc.fullName = `${npc.name} ${npc.lastName}`;
            }
        }
    },

    /**
     * Generate non-family social bonds (friendships, rivalries) between NPCs
     */
    _generateSocialBonds(npcs, rng) {
        // Each NPC forms 0-3 opinions about non-family NPCs
        for (const npc of npcs) {
            const others = npcs.filter(n => n.id !== npc.id &&
                n.spouseId !== npc.id &&
                !npc.childIds.includes(n.id) &&
                !npc.parentIds.includes(n.id) &&
                !npc.siblingIds.includes(n.id));

            const bondCount = Math.floor(rng() * 3); // 0-2 bonds
            const shuffledOthers = [...others];
            for (let i = shuffledOthers.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [shuffledOthers[i], shuffledOthers[j]] = [shuffledOthers[j], shuffledOthers[i]];
            }

            for (let i = 0; i < bondCount && i < shuffledOthers.length; i++) {
                const other = shuffledOthers[i];
                const key = NpcFamily._relKey(npc.id, other.id);
                if (_npcRelationships[key]) continue; // Already have a relationship

                // Determine score based on type compatibility
                let baseScore = Math.floor(rng() * 80) - 20; // -20 to 59

                // Same-type NPCs tend to be friendlier (colleagues)
                if (npc.type === other.type) baseScore += 15;

                // Guards dislike beggars slightly
                if ((npc.type === 'guard' && other.type === 'beggar') ||
                    (npc.type === 'beggar' && other.type === 'guard')) {
                    baseScore -= 20;
                }

                // Merchants and travelers friendly
                if ((npc.type === 'merchant' && other.type === 'traveler') ||
                    (npc.type === 'traveler' && other.type === 'merchant')) {
                    baseScore += 15;
                }

                // Nobles slightly condescending to others
                if (npc.type === 'noble' && other.type !== 'noble') {
                    baseScore -= 5;
                }

                NpcFamily._setNpcRelationship(npc.id, other.id, {
                    score: Math.max(-100, Math.min(100, baseScore)),
                    type: 'social',
                    events: [],
                });
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // NPC-NPC RELATIONSHIP MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    _relKey(idA, idB) {
        return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
    },

    _setNpcRelationship(idA, idB, data) {
        _npcRelationships[NpcFamily._relKey(idA, idB)] = data;
    },

    /**
     * Get the relationship between two NPCs
     * @returns {{ score: number, type: string, events: Array }}
     */
    getNpcRelationship(idA, idB) {
        return _npcRelationships[NpcFamily._relKey(idA, idB)] || null;
    },

    /**
     * Modify NPC-NPC relationship score
     */
    modifyNpcRelationship(idA, idB, amount, event) {
        const key = NpcFamily._relKey(idA, idB);
        if (!_npcRelationships[key]) {
            _npcRelationships[key] = { score: 0, type: 'social', events: [] };
        }
        const rel = _npcRelationships[key];
        rel.score = Math.max(-100, Math.min(100, rel.score + amount));
        if (event) rel.events.push(event);
    },

    // ══════════════════════════════════════════════════════════════════════════
    // PLAYER-NPC RELATIONSHIP HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Get the player's relationship status with an inner map NPC.
     * Merges dialog disposition with the Relationships system score.
     * @returns {{ score: number, disposition: number, level: object, familyModifier: number }}
     */
    getPlayerNpcStatus(player, npc) {
        // Dialog disposition
        const disposition = npc._dialogMemory ? npc._dialogMemory.disposition : 50;

        // Relationships system score (if tracked)
        const relData = player.relationships?.[npc.id];
        const relScore = relData ? relData.score : 0;

        // Combine: disposition weighted 60%, relationship score weighted 40%
        const combined = Math.round((disposition / 100 * 200 - 100) * 0.6 + relScore * 0.4);

        // Family modifier: if player has good/bad relations with family members, it affects this NPC
        const familyMod = NpcFamily._getFamilyModifier(player, npc);

        const finalScore = Math.max(-100, Math.min(100, combined + familyMod));

        return {
            score: finalScore,
            disposition,
            relScore,
            familyModifier: familyMod,
            level: NpcFamily.getOpinionLabel(finalScore),
        };
    },

    /**
     * Calculate how family relationships affect this NPC's attitude toward the player.
     * If the player was kind/cruel to a family member, this NPC adjusts their opinion.
     */
    _getFamilyModifier(player, npc) {
        if (!player || !npc) return 0;
        let modifier = 0;

        // Check spouse
        if (npc.spouseId != null) {
            modifier += NpcFamily._calcFamilyImpact(player, npc.spouseId, 0.6);
        }

        // Check children
        for (const childId of (npc.childIds || [])) {
            modifier += NpcFamily._calcFamilyImpact(player, childId, 0.5);
        }

        // Check parents
        for (const parentId of (npc.parentIds || [])) {
            modifier += NpcFamily._calcFamilyImpact(player, parentId, 0.4);
        }

        // Check siblings
        for (const sibId of (npc.siblingIds || [])) {
            modifier += NpcFamily._calcFamilyImpact(player, sibId, 0.3);
        }

        return Math.max(-30, Math.min(30, Math.round(modifier)));
    },

    /**
     * Calculate the impact of the player's relationship with a family member
     */
    _calcFamilyImpact(player, relativeId, weight) {
        // Check dialog disposition of the relative
        // We need access to the NPC objects — get from InnerMap
        let relativeDisp = 50; // default neutral
        try {
            // Dynamic import avoidance: check global
            const innerMapNpcs = NpcFamily._getInnerMapNpcs();
            const relative = innerMapNpcs?.find(n => n.id === relativeId);
            if (relative?._dialogMemory) {
                relativeDisp = relative._dialogMemory.disposition;
            }
        } catch { /* fall through */ }

        // Convert disposition (0-100) to (-50 to +50) for modifier calculation
        const dispMod = (relativeDisp - 50) * weight;

        // Also include relationship system score
        // (not importing player here, just using what we have)
        return dispMod * 0.2; // Scale down to avoid extreme swings
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SOCIAL RIPPLE — treat a family member well/poorly, it affects relatives
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Apply a social ripple when the player interacts with an NPC.
     * Family members get a fraction of the disposition change.
     *
     * @param {object} npc — The NPC the player interacted with
     * @param {number} dispositionDelta — The disposition change applied to the NPC
     * @param {Array} allNpcs — All inner map NPCs
     */
    applySocialRipple(npc, dispositionDelta, allNpcs) {
        if (!npc || !allNpcs || Math.abs(dispositionDelta) < 3) return;

        const rippleTargets = [];

        // Spouse gets 50% of the impact
        if (npc.spouseId != null) {
            rippleTargets.push({ id: npc.spouseId, factor: 0.50, relation: 'spouse' });
        }

        // Parents get 35%
        for (const pId of (npc.parentIds || [])) {
            rippleTargets.push({ id: pId, factor: 0.35, relation: 'parent' });
        }

        // Children get 40%
        for (const cId of (npc.childIds || [])) {
            rippleTargets.push({ id: cId, factor: 0.40, relation: 'child' });
        }

        // Siblings get 25%
        for (const sId of (npc.siblingIds || [])) {
            rippleTargets.push({ id: sId, factor: 0.25, relation: 'sibling' });
        }

        for (const target of rippleTargets) {
            const relative = allNpcs.find(n => n.id === target.id);
            if (!relative) continue;

            // Apply ripple to dialog memory
            if (!relative._dialogMemory) {
                relative._dialogMemory = {
                    timesSpoken: 0, disposition: 50, lastAction: null,
                    giftsReceived: 0, threatened: false, flattered: false,
                    questOffered: false, rumorsTold: 0, playerTitle: null,
                };
            }

            const rippleAmount = Math.round(dispositionDelta * target.factor);
            if (rippleAmount !== 0) {
                relative._dialogMemory.disposition = Math.max(0, Math.min(100,
                    relative._dialogMemory.disposition + rippleAmount));

                // Track that this NPC heard about the player's actions
                if (!relative._dialogMemory._familyEvents) {
                    relative._dialogMemory._familyEvents = [];
                }
                relative._dialogMemory._familyEvents.push({
                    npcId: npc.id,
                    npcName: npc.name,
                    relation: target.relation,
                    delta: rippleAmount,
                    original: dispositionDelta,
                });
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // DIALOG HELPERS — used by npcDialog.js to add family/social content
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Get family description for dialog header display
     * @returns {string|null} e.g., "Married to Ada Stoneheart" or "Child of Brom & Eva Ironwood"
     */
    getFamilyTagline(npc, allNpcs) {
        if (!npc) return null;
        const parts = [];

        // Spouse
        if (npc.spouseId != null) {
            const spouse = allNpcs?.find(n => n.id === npc.spouseId);
            if (spouse) {
                parts.push(`💍 Married to ${spouse.fullName || spouse.name}`);
            }
        }

        // Parent of
        if (npc.childIds && npc.childIds.length > 0) {
            const childNames = npc.childIds
                .map(id => allNpcs?.find(n => n.id === id))
                .filter(Boolean)
                .map(c => c.name);
            if (childNames.length > 0) {
                parts.push(`👶 Parent of ${childNames.join(', ')}`);
            }
        }

        // Child of
        if (npc.parentIds && npc.parentIds.length > 0 && npc.type === 'child') {
            const parentNames = npc.parentIds
                .map(id => allNpcs?.find(n => n.id === id))
                .filter(Boolean)
                .map(p => p.name);
            if (parentNames.length > 0) {
                parts.push(`👨‍👩‍👧 Child of ${parentNames.join(' & ')}`);
            }
        }

        return parts.length > 0 ? parts.join('  •  ') : null;
    },

    /**
     * Get what the NPC says about their family
     * @returns {string|null} A dialog line about a family member
     */
    getFamilyComment(npc, allNpcs, rng) {
        if (!npc || !allNpcs) return null;
        const rand = rng || Math.random;
        const options = [];

        // Spouse comment
        if (npc.spouseId != null) {
            const spouse = allNpcs.find(n => n.id === npc.spouseId);
            if (spouse) {
                const template = FAMILY_COMMENTS.spouse[Math.floor(rand() * FAMILY_COMMENTS.spouse.length)];
                options.push(template
                    .replace(/\{name\}/g, spouse.name)
                    .replace(/\{spouse_title\}/g, spouse.gender === 'female' ? 'wife' : 'husband'));
            }
        }

        // Child comment
        if (npc.childIds && npc.childIds.length > 0) {
            const child = allNpcs.find(n => n.id === npc.childIds[Math.floor(rand() * npc.childIds.length)]);
            if (child) {
                const template = FAMILY_COMMENTS.child[Math.floor(rand() * FAMILY_COMMENTS.child.length)];
                options.push(template.replace(/\{name\}/g, child.name));
            }
        }

        // Parent comment
        if (npc.parentIds && npc.parentIds.length > 0) {
            const parent = allNpcs.find(n => n.id === npc.parentIds[Math.floor(rand() * npc.parentIds.length)]);
            if (parent) {
                const template = FAMILY_COMMENTS.parent[Math.floor(rand() * FAMILY_COMMENTS.parent.length)];
                options.push(template
                    .replace(/\{name\}/g, parent.name)
                    .replace(/\{parent_title\}/g, parent.gender === 'female' ? 'mother' : 'father'));
            }
        }

        // Sibling comment
        if (npc.siblingIds && npc.siblingIds.length > 0) {
            const sib = allNpcs.find(n => n.id === npc.siblingIds[Math.floor(rand() * npc.siblingIds.length)]);
            if (sib) {
                const traits = ['clever', 'strong', 'quiet', 'wild', 'funny', 'serious'];
                const template = FAMILY_COMMENTS.sibling[Math.floor(rand() * FAMILY_COMMENTS.sibling.length)];
                options.push(template
                    .replace(/\{name\}/g, sib.name)
                    .replace(/\{sibling_title\}/g, sib.gender === 'female' ? 'sister' : 'brother')
                    .replace(/\{trait\}/g, traits[Math.floor(rand() * traits.length)]));
            }
        }

        if (options.length === 0) return null;
        return options[Math.floor(rand() * options.length)];
    },

    /**
     * Get a family reaction line — tells the player what the NPC thinks based on
     * how the player treated their family members.
     * @returns {string|null} A line if a notable family event happened, or null
     */
    getFamilyReactionLine(npc, allNpcs) {
        if (!npc?._dialogMemory?._familyEvents) return null;

        const events = npc._dialogMemory._familyEvents;
        if (events.length === 0) return null;

        // Pick the most recent/impactful event
        const sorted = [...events].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        const event = sorted[0];

        const pool = event.delta > 0 ? FAMILY_REACTION_LINES.positive : FAMILY_REACTION_LINES.negative;
        const template = pool[Math.floor(Math.random() * pool.length)];

        return template
            .replace(/\{name\}/g, event.npcName)
            .replace(/\{relation\}/g, event.relation);
    },

    /**
     * Get what this NPC thinks about another NPC (gossip/opinions)
     * @param {object} npc — The talking NPC
     * @param {object} aboutNpc — The NPC being asked about
     * @returns {string} A gossip line
     */
    getGossipAbout(npc, aboutNpc) {
        if (!npc || !aboutNpc) return 'I don\'t know much about them.';

        const rel = NpcFamily.getNpcRelationship(npc.id, aboutNpc.id);
        const score = rel ? rel.score : 0;

        let pool;
        if (score >= 30) {
            pool = GOSSIP_LINES.positive;
        } else if (score <= -20) {
            pool = GOSSIP_LINES.negative;
        } else {
            pool = GOSSIP_LINES.neutral;
        }

        const template = pool[Math.floor(Math.random() * pool.length)];
        const typeName = aboutNpc.type ? aboutNpc.type.replace('_npc', '').replace('_', ' ') : 'person';
        const trait = (aboutNpc.personalityTraits && aboutNpc.personalityTraits.length > 0)
            ? aboutNpc.personalityTraits[0]
            : 'decent';

        return template
            .replace(/\{name\}/g, aboutNpc.fullName || aboutNpc.name)
            .replace(/\{type_lower\}/g, typeName)
            .replace(/\{trait\}/g, trait);
    },

    /**
     * Get all NPCs this NPC knows and has opinions about (for "Ask about someone" menu)
     * @returns {Array<{ npc: object, score: number, familyBond: string|null }>}
     */
    getKnownNpcs(npc, allNpcs) {
        if (!npc || !allNpcs) return [];

        const known = [];

        // Family members first (always known)
        if (npc.spouseId != null) {
            const spouse = allNpcs.find(n => n.id === npc.spouseId);
            if (spouse) {
                const rel = NpcFamily.getNpcRelationship(npc.id, spouse.id);
                known.push({ npc: spouse, score: rel?.score ?? 75, familyBond: FAMILY_BOND.SPOUSE });
            }
        }

        for (const cId of (npc.childIds || [])) {
            const child = allNpcs.find(n => n.id === cId);
            if (child) {
                const rel = NpcFamily.getNpcRelationship(npc.id, child.id);
                known.push({ npc: child, score: rel?.score ?? 80, familyBond: FAMILY_BOND.CHILD });
            }
        }

        for (const pId of (npc.parentIds || [])) {
            const parent = allNpcs.find(n => n.id === pId);
            if (parent) {
                const rel = NpcFamily.getNpcRelationship(npc.id, parent.id);
                known.push({ npc: parent, score: rel?.score ?? 70, familyBond: FAMILY_BOND.PARENT });
            }
        }

        for (const sId of (npc.siblingIds || [])) {
            const sib = allNpcs.find(n => n.id === sId);
            if (sib) {
                const rel = NpcFamily.getNpcRelationship(npc.id, sib.id);
                known.push({ npc: sib, score: rel?.score ?? 50, familyBond: FAMILY_BOND.SIBLING });
            }
        }

        // Non-family social bonds
        for (const [key, rel] of Object.entries(_npcRelationships)) {
            if (rel.type === FAMILY_BOND.SPOUSE || rel.type === FAMILY_BOND.PARENT ||
                rel.type === FAMILY_BOND.CHILD || rel.type === FAMILY_BOND.SIBLING) continue;

            const [idA, idB] = key.split('_').map(Number);
            const otherId = idA === npc.id ? idB : idB === npc.id ? idA : null;
            if (otherId == null) continue;

            // Don't duplicate
            if (known.some(k => k.npc.id === otherId)) continue;

            const otherNpc = allNpcs.find(n => n.id === otherId);
            if (otherNpc) {
                known.push({ npc: otherNpc, score: rel.score, familyBond: null });
            }
        }

        // Sort: family first, then by score
        known.sort((a, b) => {
            if (a.familyBond && !b.familyBond) return -1;
            if (!a.familyBond && b.familyBond) return 1;
            return b.score - a.score;
        });

        return known;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // OPINION LABELS
    // ══════════════════════════════════════════════════════════════════════════

    getOpinionLabel(score) {
        let best = OPINION_LABELS[0];
        for (const label of OPINION_LABELS) {
            if (score >= label.minScore) best = label;
        }
        return best;
    },

    /**
     * Get the family bond label text between two NPCs
     */
    getFamilyBondLabel(npcA, npcB) {
        if (!npcA || !npcB) return null;
        if (npcA.spouseId === npcB.id) return npcA.gender === 'female' ? 'Wife' : 'Husband';
        if (npcA.childIds?.includes(npcB.id)) return npcB.gender === 'female' ? 'Daughter' : 'Son';
        if (npcA.parentIds?.includes(npcB.id)) return npcB.gender === 'female' ? 'Mother' : 'Father';
        if (npcA.siblingIds?.includes(npcB.id)) return npcB.gender === 'female' ? 'Sister' : 'Brother';
        return null;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // INNER MAP NPC ACCESS
    // ══════════════════════════════════════════════════════════════════════════

    /** Reference to get inner map NPCs without circular import */
    _innerMapRef: null,

    setInnerMapRef(innerMap) {
        NpcFamily._innerMapRef = innerMap;
    },

    _getInnerMapNpcs() {
        if (NpcFamily._innerMapRef && NpcFamily._innerMapRef.npcs) {
            return NpcFamily._innerMapRef.npcs;
        }
        return [];
    },

    // ══════════════════════════════════════════════════════════════════════════
    // FAMILY GROUP ACCESS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Get all family groups in the current settlement
     */
    getFamilyGroups() {
        return _familyGroups;
    },

    /**
     * Get the family group for a specific NPC
     */
    getFamilyGroup(npc) {
        if (npc.familyGroupId == null) return null;
        return _familyGroups.find(f => f.id === npc.familyGroupId) || null;
    },

    /**
     * Get all family members of an NPC (including self)
     */
    getFamilyMembers(npc, allNpcs) {
        if (!npc || !allNpcs) return [npc];

        const members = new Set();
        members.add(npc.id);

        if (npc.spouseId != null) members.add(npc.spouseId);
        for (const id of (npc.childIds || [])) members.add(id);
        for (const id of (npc.parentIds || [])) members.add(id);
        for (const id of (npc.siblingIds || [])) members.add(id);

        return [...members].map(id => allNpcs.find(n => n.id === id)).filter(Boolean);
    },

    // ══════════════════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    getState() {
        return {
            npcRelationships: _npcRelationships,
            familyGroups: _familyGroups,
        };
    },

    loadState(state) {
        if (state) {
            _npcRelationships = state.npcRelationships || {};
            _familyGroups = state.familyGroups || [];
        }
    },

    reset() {
        _npcRelationships = {};
        _familyGroups = [];
    },
};
