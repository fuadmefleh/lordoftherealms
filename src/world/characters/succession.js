// Characters — succession members (split from the original monolith).
import { Characters } from './_ref.js';
import { Utils } from './_imports.js';

Object.assign(Characters, {
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
        if (successionType === 'distant_relative' || (successionType === 'regent' && Utils.random() < 0.3)) {
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
            if (Utils.random() < 0.5) {
                const spouseGender = heir.gender === 'male' ? 'female' : 'male';
                const newSpouse = Characters.generateCharacter({
                    culture: Utils.random() < 0.7 ? kingdom.culture : Utils.randPick(Object.keys(Characters.FIRST_NAMES)),
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
        if (Utils.random() < 0.02) {
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
        if (Utils.random() < 0.05) {
            Characters._triggerCharacterEvent(kingdom, world);
        }

        // ── Heir birth chance (every 30 days if married, ruler < 50) ──
        if (world.day % 30 === 0 && data.spouse && data.spouse.isAlive && ruler.age < 50) {
            const fertilityBonus = ruler.traits.some(t => t.id === 'fertile') ? 0.15 : 0;
            if (Utils.random() < 0.08 + fertilityBonus) {
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
                if (advisor.loyalty < 10 && Utils.random() < 0.3) {
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
                if (Utils.random() < deathChance) {
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
            if (!char.isIll && char.age > 45 && Utils.random() < 0.02) {
                char.isIll = true;
                char.health = Math.max(20, char.health - Utils.randInt(20, 50));
            }

            // Recovery from illness
            if (char.isIll && Utils.random() < 0.3) {
                char.isIll = false;
                char.health = Math.min(100, char.health + Utils.randInt(10, 30));
            }

            // Ill characters have higher death chance
            if (char.isIll && Utils.random() < 0.05) {
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
        let roll = Utils.random() * totalWeight;
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
                if (Utils.random() > survivalChance) {
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
});
