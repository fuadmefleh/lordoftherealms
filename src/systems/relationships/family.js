// Relationships — family members (split from the original monolith).
import { Relationships } from './_ref.js';
import { DataLoader, Utils, Characters } from './_imports.js';

Object.assign(Relationships, {
    // ────────────────────────────────────────────────────────────────────
    //  Marriage
    // ────────────────────────────────────────────────────────────────────
    marry(player, npcId, world) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };
        if (player.spouse) return { success: false, reason: 'Already married!' };

        const rel = Relationships.getRelationship(player, npcId);

        player.spouse = npcId;
        player.marriageDay = world ? world.day : 0;
        npc.isMarried = true;
        npc.isRomantic = true;
        rel.affection = Math.max(rel.affection, 80);
        rel.romantic = true;

        // Marriage bonuses
        player.maxStamina = (player.maxStamina || 10) + 1;
        player.renown = (player.renown || 0) + 3;

        // Reputation with spouse's kingdom
        if (npc.kingdomId && player.reputation) {
            player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + 5;
        }

        return { success: true, npc, spouse: npc };
    },

    divorce(player, world) {
        if (!player.spouse) return { success: false, reason: 'Not married' };

        const npc = Relationships.getNPC(player.spouse);
        const rel = player.relationships[player.spouse];

        if (npc) {
            npc.isMarried = false;
            npc.isRomantic = false;
        }
        if (rel) {
            rel.affection = Math.max(0, rel.affection - 40);
            rel.score = Math.max(-100, rel.score - 30);
            rel.romantic = false;
        }

        player.spouse = null;
        player.marriageDay = null;
        player.karma = (player.karma || 0) - 5;
        player.renown = Math.max(0, (player.renown || 0) - 2);

        return { success: true, exSpouse: npc };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Children & Dynasty
    // ────────────────────────────────────────────────────────────────────
    /**
     * Check if a child could be born this year (called from endDay processing)
     */
    checkChildbirth(player, world) {
        if (!player.spouse) return null;
        const settings = Relationships._getHeirSettings();

        if ((player.children || []).length >= settings.maxChildren) return null;

        const spouse = Relationships.getNPC(player.spouse);
        if (!spouse) return null;

        // Age checks
        const motherAge = player.gender === 'female' ? player.age : spouse.age;
        const fatherAge = player.gender === 'male' ? player.age : spouse.age;

        if (motherAge < settings.motherMinAge || motherAge > settings.motherMaxAge) return null;
        if (fatherAge < settings.fatherMinAge) return null;

        // Only check once per year (roughly every daysPerYear days)
        if (world.day % settings.daysPerYear !== 0) return null;

        // Chance of child
        const rel = Relationships.getRelationship(player, player.spouse);
        const affectionBonus = (rel.affection || 50) / 200; // 0 to 0.5
        const chance = settings.childbirthChancePerYear + affectionBonus;

        if (Utils.random() > chance) return null;

        // Generate child!
        return Relationships.generateChild(player, spouse, world);
    },

    generateChild(player, spouse, world) {
        const culture = spouse.culture || 'Imperial';
        const gender = Utils.random() < 0.5 ? 'male' : 'female';

        const namePool = (typeof Characters !== 'undefined' && Characters.FIRST_NAMES[culture])
            ? Characters.FIRST_NAMES[culture]
            : { male: ['Edmund'], female: ['Helena'] };

        const firstName = Utils.randPick(namePool[gender]);

        // Roll traits for child
        const childTraits = Relationships._getChildTraits();
        const traits = [];
        for (const [id, trait] of Object.entries(childTraits)) {
            if (Utils.random() < trait.chance) {
                traits.push({ ...trait });
            }
        }

        const child = {
            id: `child_${Relationships._nextId++}`,
            firstName,
            dynasty: player.dynasty?.name || player.name,
            gender,
            age: 0,
            culture,
            birthDay: world ? world.day : 0,
            isAlive: true,
            traits,

            // Inherited base stats (blend of parents + random)
            strength: Math.floor(((player.strength || 5) + Utils.randInt(3, 7)) / 2),
            charisma: Math.floor(((player.charisma || 5) + Utils.randInt(3, 7)) / 2),
            intelligence: Math.floor(((player.intelligence || 5) + Utils.randInt(3, 7)) / 2),
            faith: Math.floor(((player.faith || 5) + Utils.randInt(3, 7)) / 2),
            luck: Math.floor(((player.luck || 5) + Utils.randInt(3, 7)) / 2),

            // Skills start at 0, grow as they age
            skills: {
                commerce: 0, combat: 0, leadership: 0,
                diplomacy: 0, stealth: 0, cartography: 0,
            },

            // Will be set when taking over as heir
            health: 100,
            maxHealth: 100,
        };

        // Apply trait effects
        for (const trait of traits) {
            if (trait.effects) {
                if (trait.effects.allStats) {
                    child.strength += trait.effects.allStats;
                    child.charisma += trait.effects.allStats;
                    child.intelligence += trait.effects.allStats;
                    child.faith += trait.effects.allStats;
                    child.luck += trait.effects.allStats;
                }
                if (trait.effects.strength) child.strength += trait.effects.strength;
                if (trait.effects.intelligence) child.intelligence += trait.effects.intelligence;
                if (trait.effects.charisma) child.charisma += trait.effects.charisma;
                if (trait.effects.luck) child.luck += trait.effects.luck;
                if (trait.effects.faith) child.faith += trait.effects.faith;
                if (trait.effects.maxHealth) child.maxHealth += trait.effects.maxHealth;
                if (trait.effects.combat) child.skills.combat += trait.effects.combat;
                if (trait.effects.stealth) child.skills.stealth += trait.effects.stealth;
                if (trait.effects.diplomacy) child.skills.diplomacy += trait.effects.diplomacy;
            }
        }

        if (!player.children) player.children = [];
        player.children.push(child);

        // Auto-designate first child as heir if no heir set
        if (!player.heir) {
            player.heir = child.id;
        }

        return child;
    },

    /**
     * Age children (called yearly)
     */
    ageChildren(player, world) {
        if (!player.children) return;
        const settings = Relationships._getHeirSettings();

        for (const child of player.children) {
            if (!child.isAlive) continue;
            child.age++;

            // Skill growth as children age
            if (child.age >= 8 && child.age <= 18) {
                const growthChance = 0.3;
                const skillKeys = Object.keys(child.skills);
                for (const skill of skillKeys) {
                    if (Utils.random() < growthChance) {
                        child.skills[skill] = Math.min(child.skills[skill] + 1, 5);
                    }
                }
            }

            // Older children can get stronger stats
            if (child.age >= 14) {
                if (Utils.random() < 0.2) {
                    const stat = Utils.randPick(['strength', 'charisma', 'intelligence', 'faith', 'luck']);
                    child[stat] = (child[stat] || 5) + 1;
                }
            }
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  Player Aging & Death
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process player aging (called every daysPerYear days)
     * Returns { aged, died, deathEvent } or null
     */
    processAging(player, world) {
        const settings = Relationships._getHeirSettings();
        if (world.day % settings.daysPerYear !== 0) return null;

        player.age++;

        // Age spouse
        const spouse = player.spouse ? Relationships.getNPC(player.spouse) : null;
        if (spouse) spouse.age++;

        // Age all known NPCs
        for (const npc of Relationships._npcs) {
            if (npc.isAlive) npc.age++;
            // NPC death (old age)
            if (npc.age > Utils.randInt(55, 85) && Utils.random() < 0.15) {
                npc.isAlive = false;
                if (player.spouse === npc.id) {
                    player.spouse = null;
                    player.marriageDay = null;
                }
            }
        }

        // Age children
        Relationships.ageChildren(player, world);

        // Player death check
        if (player.age > player.maxLifespan) {
            const yearsOver = player.age - player.maxLifespan;
            const deathChance = yearsOver * settings.deathChancePerYearOverMax;
            if (Utils.random() < deathChance) {
                return { aged: true, died: true, age: player.age };
            }
        }

        // Health deterioration in old age
        if (player.age > 50) {
            const healthLoss = Math.floor((player.age - 50) * 0.5);
            player.maxHealth = Math.max(50, 100 - healthLoss);
            if (player.health > player.maxHealth) {
                player.health = player.maxHealth;
            }
        }

        return { aged: true, died: false, age: player.age };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Heir System
    // ────────────────────────────────────────────────────────────────────
    /**
     * Get eligible heirs from children
     */
    getEligibleHeirs(player) {
        if (!player.children) return [];
        const settings = Relationships._getHeirSettings();
        return player.children.filter(c => c.isAlive && c.age >= settings.minAgeToPlay);
    },

    /**
     * Set the designated heir
     */
    designateHeir(player, childId) {
        const child = (player.children || []).find(c => c.id === childId);
        if (!child) return { success: false, reason: 'Child not found' };
        if (!child.isAlive) return { success: false, reason: 'That child has passed away' };

        player.heir = childId;
        return { success: true, heir: child };
    },

    /**
     * Take over as an heir — creates a new player from the child's stats
     * Returns the transformed player data
     */
    succeedAsHeir(player, childId, world) {
        const settings = Relationships._getHeirSettings();
        const child = (player.children || []).find(c => c.id === childId);

        if (!child || !child.isAlive) {
            return { success: false, reason: 'Invalid heir' };
        }
        if (child.age < settings.minAgeToPlay) {
            return { success: false, reason: `Heir must be at least ${settings.minAgeToPlay} years old` };
        }

        // Store old player info for history
        const oldName = player.name;
        const oldAge = player.age;

        // Transfer heir stats to player
        player.firstName = child.firstName;
        player.lastName = child.dynasty || '';
        player.name = `${child.firstName} ${child.dynasty}`;
        player.gender = child.gender;
        player.age = child.age;
        player.title = `Heir of ${oldName}`;

        // Stats — child's developed stats
        player.strength = child.strength || 5;
        player.charisma = child.charisma || 5;
        player.intelligence = child.intelligence || 5;
        player.faith = child.faith || 5;
        player.luck = child.luck || 5;

        // Skills — child learned some, plus base
        player.skills = {
            commerce: Math.max(1, child.skills?.commerce || 0),
            combat: Math.max(1, child.skills?.combat || 0),
            leadership: Math.max(1, child.skills?.leadership || 0),
            diplomacy: Math.max(1, child.skills?.diplomacy || 0),
            stealth: Math.max(1, child.skills?.stealth || 0),
            cartography: child.skills?.cartography || 0,
        };

        // Health — full for young heir
        player.health = child.maxHealth || 100;
        player.maxHealth = child.maxHealth || 100;
        player.stamina = 10;
        player.maxStamina = 10;

        // Inheritance — partial gold, renown, reputation
        player.gold = Math.floor(player.gold * settings.inheritanceGoldPercent);
        player.renown = Math.floor((player.renown || 0) * settings.inheritanceRenownPercent);

        // Reputation partially inherited
        for (const kId of Object.keys(player.reputation || {})) {
            player.reputation[kId] = Math.floor(player.reputation[kId] * settings.inheritanceReputationPercent);
        }

        // Reset karma
        player.karma = 0;

        // New lifespan
        player.maxLifespan = Utils.randInt(settings.playerMaxLifespan.min, settings.playerMaxLifespan.max);

        // Keep dynasty, clear personal relationships
        player.spouse = null;
        player.marriageDay = null;
        player.heir = null;

        // Remove this child from children, keep others as siblings
        player.children = player.children.filter(c => c.id !== childId);

        // Keep properties, army, religion but clear personal items
        player.inventory = { bread: 10 };
        player.allegiance = null;
        player.kingdomTitle = null;

        // Increase dynasty prestige
        if (player.dynasty) {
            player.dynasty.prestige = (player.dynasty.prestige || 0) + 5;
        }

        // Clear old relationships (new character doesn't know the same people personally)
        player.relationships = {};

        return {
            success: true,
            oldName,
            oldAge,
            newName: player.name,
            heir: child,
        };
    },

    // ────────────────────────────────────────────────────────────────────
    //  NPC-Initiated Events (called in endDay)
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process daily relationship events
     * Returns array of event notifications
     */
    processDailyEvents(player, world) {
        const events = [];

        Relationships.cleanupTravelParty(player);

        // Marriage events
        if (player.spouse) {
            const data = Relationships._getData();
            const marriageEvents = data?.marriageEvents || [];
            for (const evt of marriageEvents) {
                if (evt.requiresChildren && (!player.children || player.children.length === 0)) continue;
                if (Utils.random() < (evt.chance || 0)) {
                    const spouse = Relationships.getNPC(player.spouse);
                    if (!spouse) continue;

                    const rel = Relationships.getRelationship(player, player.spouse);
                    rel.affection = Math.max(0, Math.min(100, rel.affection + (evt.value || 0)));

                    let text = evt.text
                        .replace('{spouse}', spouse.firstName)
                        .replace('{child}', player.children?.length > 0 ? player.children[player.children.length - 1].firstName : 'your child');

                    events.push({ type: 'marriage', text, impact: evt.value > 0 ? 'positive' : 'negative' });
                }
            }
        }

        // NPC-initiated courting events for NPCs the player knows
        const data = Relationships._getData();
        const courtEvents = data?.npcCourtEvents || [];
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            if (!rel.romantic) continue;
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            for (const evt of courtEvents) {
                if (Utils.random() < (evt.chance || 0)) {
                    let text = evt.text
                        .replace('{npc}', npc.firstName)
                        .replace('{item}', Utils.randPick(['pressed flower', 'carved charm', 'ribbon', 'sweet cake']));

                    if (evt.affectionGain) {
                        rel.affection = Math.max(0, Math.min(100, (rel.affection || 0) + evt.affectionGain));
                    }
                    if (evt.relationGain) {
                        rel.score = Math.max(-100, Math.min(100, (rel.score || 0) + evt.relationGain));
                    }

                    events.push({ type: 'court', text, npc: npc.firstName });
                    break; // One event per NPC per day
                }
            }
        }

        // Childbirth check
        const newChild = Relationships.checkChildbirth(player, world);
        if (newChild) {
            const traitStr = newChild.traits.length > 0
                ? ` Traits: ${newChild.traits.map(t => `${t.icon} ${t.name}`).join(', ')}`
                : '';
            events.push({
                type: 'childbirth',
                text: `🎉 A ${newChild.gender === 'male' ? 'son' : 'daughter'} has been born! Welcome ${newChild.firstName} ${newChild.dynasty}!${traitStr}`,
                child: newChild,
            });
        }

        // Relationship decay for NPCs not interacted with recently
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            // Slow decay if not interacted in a while
            const daysSinceInteraction = (world?.day || 0) - (npc.lastInteraction || 0);
            if (daysSinceInteraction > 30 && Utils.random() < 0.05) {
                if (rel.score > 0) rel.score = Math.max(0, rel.score - 1);
                if (rel.affection > 0 && !npc.isMarried) rel.affection = Math.max(0, rel.affection - 1);
            }
        }

        return events;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Save / Load Support
    // ────────────────────────────────────────────────────────────────────
    /**
     * Get serializable state for saving
     */
    getState() {
        return {
            npcs: Relationships._npcs,
            nextId: Relationships._nextId,
        };
    },

    /**
     * Restore state from save data
     */
    loadState(state, player) {
        if (state) {
            Relationships._npcs = state.npcs || [];
            Relationships._nextId = state.nextId || 1;
        }
        // Also restore from player for backward compat
        if (player._relationshipNpcs) {
            Relationships._npcs = player._relationshipNpcs;
        }
        if (player._relationshipNextId) {
            Relationships._nextId = player._relationshipNextId;
        }
    },

    /**
     * Store state on player before saving
     */
    prepareForSave(player) {
        player._relationshipNpcs = Relationships._npcs;
        player._relationshipNextId = Relationships._nextId;
    },
});
