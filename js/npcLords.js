// ============================================
// NPC LORDS — Dynamic lord characters
// ============================================

const NPCLords = {
    /**
     * Lord personality traits
     */
    TRAITS: {
        AMBITIOUS: { id: 'ambitious', name: 'Ambitious', expansionBonus: 0.3, warBonus: 0.2 },
        CAUTIOUS: { id: 'cautious', name: 'Cautious', expansionBonus: -0.2, diplomacyBonus: 0.3 },
        GREEDY: { id: 'greedy', name: 'Greedy', tradeBonus: 0.4, taxBonus: 0.2 },
        HONORABLE: { id: 'honorable', name: 'Honorable', diplomacyBonus: 0.3, loyaltyBonus: 0.2 },
        CRUEL: { id: 'cruel', name: 'Cruel', warBonus: 0.3, loyaltyBonus: -0.3 },
        PIOUS: { id: 'pious', name: 'Pious', faithBonus: 0.4, karmaBonus: 0.2 },
        CUNNING: { id: 'cunning', name: 'Cunning', diplomacyBonus: 0.2, tradeBonus: 0.2 },
        BRAVE: { id: 'brave', name: 'Brave', warBonus: 0.3, loyaltyBonus: 0.1 },
    },

    /**
     * Generate a new lord for a kingdom
     */
    generateLord(kingdom) {
        const traits = [];
        const numTraits = Utils.randInt(1, 3);

        const availableTraits = Object.values(NPCLords.TRAITS);
        for (let i = 0; i < numTraits; i++) {
            const trait = Utils.randPick(availableTraits);
            if (!traits.find(t => t.id === trait.id)) {
                traits.push(trait);
            }
        }

        return {
            name: kingdom.ruler,
            age: Utils.randInt(25, 65),
            traits,
            ambition: Utils.randInt(1, 10),
            honor: Utils.randInt(1, 10),
            intelligence: Utils.randInt(1, 10),
            martial: Utils.randInt(1, 10),
            diplomacy: Utils.randInt(1, 10),
            stewardship: Utils.randInt(1, 10),
            relationships: {}, // Relationships with other lords
            goals: NPCLords.generateGoals(traits),
        };
    },

    /**
     * Generate goals based on traits
     */
    generateGoals(traits) {
        const goals = [];

        for (const trait of traits) {
            switch (trait.id) {
                case 'ambitious':
                    goals.push({ type: 'expand', priority: 'high' });
                    goals.push({ type: 'conquer', priority: 'medium' });
                    break;
                case 'greedy':
                    goals.push({ type: 'wealth', priority: 'high' });
                    goals.push({ type: 'trade', priority: 'high' });
                    break;
                case 'pious':
                    goals.push({ type: 'faith', priority: 'high' });
                    goals.push({ type: 'peace', priority: 'medium' });
                    break;
                case 'honorable':
                    goals.push({ type: 'alliance', priority: 'high' });
                    goals.push({ type: 'justice', priority: 'medium' });
                    break;
                case 'cruel':
                    goals.push({ type: 'domination', priority: 'high' });
                    goals.push({ type: 'fear', priority: 'medium' });
                    break;
            }
        }

        // Always have at least one goal
        if (goals.length === 0) {
            goals.push({ type: 'survive', priority: 'high' });
        }

        return goals;
    },

    /**
     * Initialize lords for all kingdoms
     */
    initializeLords(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.lord) {
                kingdom.lord = NPCLords.generateLord(kingdom);
            }
        }
    },

    /**
     * Process lord actions
     */
    processLordActions(kingdom, world) {
        if (!kingdom.lord || !kingdom.isAlive) return;

        const lord = kingdom.lord;

        // Age the lord
        if (world.day % 120 === 0) { // Once per year
            lord.age++;

            // Death from old age
            if (lord.age > 70 && Math.random() < (lord.age - 70) * 0.1) {
                NPCLords.lordDies(kingdom, world);
                return;
            }
        }

        // Pursue goals
        for (const goal of lord.goals) {
            if (Math.random() < 0.3) { // 30% chance to pursue each goal
                NPCLords.pursueGoal(kingdom, lord, goal, world);
            }
        }

        // Update relationships
        NPCLords.updateRelationships(kingdom, lord, world);
    },

    /**
     * Lord dies and is replaced
     */
    lordDies(kingdom, world) {
        const oldLord = kingdom.lord;

        // Delegate to Characters system if available
        if (typeof Characters !== 'undefined' && kingdom.characterData) {
            const result = Characters.handleSuccession(kingdom, world);
            if (result) {
                // Sync NPC lord data with new ruler
                const newRuler = kingdom.characterData.ruler;
                kingdom.lord = NPCLords.generateLord(kingdom);
                kingdom.lord.name = kingdom.ruler;
                kingdom.lord.age = newRuler.age;
                kingdom.lord.martial = newRuler.skills.martial;
                kingdom.lord.diplomacy = newRuler.skills.diplomacy;
                kingdom.lord.stewardship = newRuler.skills.stewardship;
                return;
            }
        }

        // Fallback: original behavior
        const newLord = NPCLords.generateLord(kingdom);
        kingdom.lord = newLord;
        kingdom.ruler = newLord.name;

        world.events.push({
            category: 'political',
            text: `${kingdom.name}: ${oldLord.name} has died at age ${oldLord.age}. ${newLord.name} succeeds to power.`,
            kingdom: kingdom.id,
            impact: 'neutral',
        });
    },

    /**
     * Pursue a goal
     */
    pursueGoal(kingdom, lord, goal, world) {
        switch (goal.type) {
            case 'expand':
                // More aggressive expansion
                if (Math.random() < 0.5) {
                    KingdomAI.tryExpand(kingdom, world);
                }
                break;

            case 'wealth':
                // Focus on trade
                if (Math.random() < 0.6) {
                    TradeRoutes.establishRoutes(kingdom, world);
                }
                break;

            case 'conquer':
                // More likely to declare war
                if (Math.random() < 0.4) {
                    KingdomAI.considerWar(kingdom, world);
                }
                break;

            case 'alliance':
                // Improve relations with neighbors
                const neighbors = world.kingdoms.filter(k =>
                    k.isAlive && k.id !== kingdom.id && !kingdom.wars.includes(k.id)
                );
                if (neighbors.length > 0) {
                    const target = Utils.randPick(neighbors);
                    kingdom.relations[target.id] = Math.min(100, (kingdom.relations[target.id] || 0) + 5);
                    target.relations[kingdom.id] = Math.min(100, (target.relations[kingdom.id] || 0) + 5);
                }
                break;

            case 'peace':
                // Try to end wars
                if (kingdom.wars.length > 0 && Math.random() < 0.4) {
                    const enemy = world.getKingdom(kingdom.wars[0]);
                    if (enemy) {
                        KingdomAI.makePeace(kingdom, enemy, world);
                    }
                }
                break;
        }
    },

    /**
     * Update lord relationships
     */
    updateRelationships(kingdom, lord, world) {
        for (const otherKingdom of world.kingdoms) {
            if (!otherKingdom.isAlive || otherKingdom.id === kingdom.id) continue;
            if (!otherKingdom.lord) continue;

            const otherLord = otherKingdom.lord;
            const currentRel = lord.relationships[otherLord.name] || 0;

            // Personality compatibility
            let change = 0;

            // Honorable lords like other honorable lords
            const bothHonorable = lord.traits.some(t => t.id === 'honorable') &&
                otherLord.traits.some(t => t.id === 'honorable');
            if (bothHonorable) change += 2;

            // Cruel lords dislike honorable lords
            const cruelVsHonorable =
                (lord.traits.some(t => t.id === 'cruel') && otherLord.traits.some(t => t.id === 'honorable')) ||
                (lord.traits.some(t => t.id === 'honorable') && otherLord.traits.some(t => t.id === 'cruel'));
            if (cruelVsHonorable) change -= 2;

            // Ambitious lords compete
            const bothAmbitious = lord.traits.some(t => t.id === 'ambitious') &&
                otherLord.traits.some(t => t.id === 'ambitious');
            if (bothAmbitious) change -= 1;

            // Update relationship
            lord.relationships[otherLord.name] = Utils.clamp(currentRel + change, -100, 100);

            // Personal relationships influence kingdom relations
            if (Math.abs(lord.relationships[otherLord.name]) > 50) {
                const influence = Math.sign(lord.relationships[otherLord.name]) * 2;
                kingdom.relations[otherKingdom.id] = Utils.clamp(
                    (kingdom.relations[otherKingdom.id] || 0) + influence,
                    -100,
                    100
                );
            }
        }
    },

    /**
     * Get lord description
     */
    getLordDescription(lord) {
        if (!lord) return 'No ruler';

        const traitNames = lord.traits.map(t => t.name).join(', ');
        return `${lord.name}, age ${lord.age}. ${traitNames || 'Unremarkable'}.`;
    },

    /**
     * Get lord's opinion of player
     */
    getLordOpinion(lord, player) {
        if (!lord) return 0;

        let opinion = 0;

        // Based on player karma
        if (lord.traits.some(t => t.id === 'pious')) {
            opinion += player.karma * 2;
        }

        // Based on player renown
        if (lord.traits.some(t => t.id === 'ambitious')) {
            opinion += Math.floor(player.renown / 10);
        }

        // Based on player wealth
        if (lord.traits.some(t => t.id === 'greedy')) {
            opinion += Math.floor(player.gold / 1000);
        }

        return Utils.clamp(opinion, -100, 100);
    },
};
