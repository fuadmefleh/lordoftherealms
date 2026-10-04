// Relationships — family members (split from the original monolith).
import { Relationships } from './_ref.js';
import { DataLoader, Utils, Characters, House } from './_imports.js';

Object.assign(Relationships, {
    // ────────────────────────────────────────────────────────────────────
    //  Marriage effects & gifts (data/relationships.json)
    // ────────────────────────────────────────────────────────────────────
    /** marriageEffects with defaults for any missing field. */
    getMarriageEffects() {
        const data = Relationships._getData();
        return {
            staminaBonus: 1, happinessBonus: 10, reputationBonus: 5, renownGain: 3, allianceWithSpouseKingdom: true,
            ...((data && data.marriageEffects) || {}),
        };
    },

    /** The giftItems list (fallback: a single generic gift). */
    getGiftItems() {
        const data = Relationships._getData();
        if (data && Array.isArray(data.giftItems) && data.giftItems.length > 0) return data.giftItems;
        return [{ id: 'gift', name: 'Thoughtful Gift', icon: '🎁', cost: 25, affection: 8 }];
    },

    /** Personalities that especially prize a gift (×1.5 affection). */
    GIFT_TASTES: {
        sword: ['bold', 'stoic', 'ambitious'],
        poem: ['passionate', 'witty', 'shy'],
        book: ['witty', 'stoic', 'shy'],
        flowers: ['gentle', 'kind', 'shy'],
        jewelry: ['ambitious', 'passionate'],
        ring: ['passionate', 'ambitious', 'kind'],
    },

    /** Affection a gift is worth to this NPC. */
    giftValue(gift, npc) {
        const likes = Relationships.GIFT_TASTES[gift.id] || [];
        return (gift.affection || 0) * (npc && likes.includes(npc.personality) ? 1.5 : 1);
    },

    /**
     * The best gift the player can afford for this NPC: most affection,
     * cheaper on ties. Null when nothing is affordable.
     */
    chooseGift(player, npc) {
        let best = null;
        for (const gift of Relationships.getGiftItems()) {
            if ((gift.cost || 0) > (player.gold || 0)) continue;
            const v = Relationships.giftValue(gift, npc);
            if (!best || v > best.v || (v === best.v && (gift.cost || 0) < (best.gift.cost || 0))) best = { gift, v };
        }
        return best ? best.gift : null;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Marriage
    // ────────────────────────────────────────────────────────────────────
    /**
     * Spend House Prestige to arrange a prestigious match: a noble of this
     * settlement, already well-disposed toward you, joins the people you can
     * court. Marrying them later brings extra renown and standing.
     */
    arrangeNobleMatch(player, tile, world) {
        if (player.spouse) return { success: false, reason: 'You are already married.' };
        if (!tile || !tile.settlement) return { success: false, reason: 'Matches are arranged in a settlement.' };
        const paid = House.arrangePrestigiousMarriage(player, world, {
            chronicle: `${player.house ? player.house.name : 'The House'} arranges a noble match in ${tile.settlement.name}.`,
            tags: ['marriage'],
        });
        if (!paid.success) {
            return { success: false, reason: paid.reason === 'Not enough Prestige' ? `Need ${paid.cost} Prestige (have ${paid.have}).` : paid.reason };
        }
        const npc = Relationships.generateNPC(tile.settlement, world);
        npc.occupation = 'noble';
        npc.noble = true;
        npc.attraction = Math.max(npc.attraction || 0, 90);
        npc.metDay = world ? world.day : 0;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.affection = Math.max(rel.affection || 0, 60);
        rel.score = Math.max(rel.score || 0, 40);
        return { success: true, npc };
    },

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

        // Marriage bonuses (data/relationships.json marriageEffects)
        const fx = Relationships.getMarriageEffects();
        player.maxStamina = (player.maxStamina || 10) + fx.staminaBonus;
        player.renown = (player.renown || 0) + fx.renownGain;
        // A newlywed's spirits lift
        if (fx.happinessBonus && typeof player.modifyNeed === 'function') {
            player.modifyNeed('social', fx.happinessBonus);
        }

        // Reputation with spouse's kingdom
        if (npc.kingdomId && player.reputation) {
            player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + fx.reputationBonus;
        }
        // The spouse's realm now counts you as kin: its lord's opinion of you
        // rises while the marriage lasts (NPCLords.getLordOpinion)
        player.marriageAllianceKingdom = fx.allianceWithSpouseKingdom && npc.kingdomId ? npc.kingdomId : null;

        // A noble match (arranged with Prestige) raises the House's standing
        if (npc.noble) {
            player.renown = (player.renown || 0) + 10;
            if (npc.kingdomId && player.reputation) {
                player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + 15;
            }
            House.recordPlayerDeed(player, world, 'nobleMarriage', {
                reason: `married ${npc.firstName} ${npc.dynasty}`,
                chronicle: `${npc.firstName} of House ${npc.dynasty} marries into the family.`,
                tags: ['marriage'],
            });
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
        if (fatherAge < settings.fatherMinAge || fatherAge > (settings.fatherMaxAge ?? Infinity)) return null;

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
    succeedAsHeir(player, childId, world, opts = {}) {
        const settings = Relationships._getHeirSettings();
        const child = (player.children || []).find(c => c.id === childId);

        if (!child || !child.isAlive) {
            return { success: false, reason: 'Invalid heir' };
        }
        // A regency raises an under-age heir to playable age at a stiff cost
        // (applied by House.processSuccession below).
        if (opts.regency && child.age < settings.minAgeToPlay) {
            child.age = settings.minAgeToPlay;
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

        // An heir taking up the mantle is a notable deed for the House
        // (House prestige superseded the legacy player.dynasty.prestige counter)
        if (typeof House !== 'undefined' && player.house) {
            House.award(player.house, 5, 'an heir takes up the mantle', world ? world.day : 0);
        }

        // Clear old relationships (new character doesn't know the same people personally)
        player.relationships = {};

        // House-level succession stakes: advance the generation, possibly a
        // disputed succession (securable with Prestige, else holdings fragment).
        let houseResult = null;
        if (typeof House !== 'undefined' && player.house) {
            houseResult = House.processSuccession(player, world, {
                headId: player.id,
                secure: !!opts.secure,
                regency: !!opts.regency,
            });
        }

        return {
            success: true,
            oldName,
            oldAge,
            newName: player.name,
            heir: child,
            house: houseResult,
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
