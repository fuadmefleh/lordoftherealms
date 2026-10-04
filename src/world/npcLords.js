// ============================================
// NPC LORDS — Dynamic lord characters
// ============================================

import { Utils } from '../core/utils.js';
import { KingdomAI } from './kingdomAI.js';
import { KingdomStability, LordInfluence } from './kingdomState.js';
import { TradeRoutes } from './economy.js';
import { Characters } from './characters.js';
import { Colonization } from './colonization.js';

export const NPCLords = {
    /** Opinion bonus a lord holds for the player married into their realm. */
    MARRIAGE_KIN_OPINION: 20,

    /**
     * Lord personality traits (overridden by data/npcLords.json). The number
     * fields feed the kingdom through KingdomBonuses (world/kingdomState.js):
     * expansionBonus, warBonus, diplomacyBonus, tradeBonus, taxBonus,
     * loyaltyBonus, faithBonus, defenseBonus, researchBonus, stabilityBonus,
     * constructionBonus; karmaBonus weighs the player's karma in getLordOpinion.
     * `goals` lists the goals the trait gives a lord ([type, priority]).
     */
    TRAITS: {
        AMBITIOUS: { id: 'ambitious', name: 'Ambitious', expansionBonus: 0.3, warBonus: 0.2, goals: [['expand', 'high'], ['conquer', 'medium'], ['colonize', 'medium']] },
        CAUTIOUS: { id: 'cautious', name: 'Cautious', expansionBonus: -0.2, diplomacyBonus: 0.3, goals: [['survive', 'high'], ['alliance', 'medium']] },
        GREEDY: { id: 'greedy', name: 'Greedy', tradeBonus: 0.4, taxBonus: 0.2, goals: [['wealth', 'high'], ['trade', 'high']] },
        HONORABLE: { id: 'honorable', name: 'Honorable', diplomacyBonus: 0.3, loyaltyBonus: 0.2, goals: [['alliance', 'high'], ['justice', 'medium']] },
        CRUEL: { id: 'cruel', name: 'Cruel', warBonus: 0.3, loyaltyBonus: -0.3, goals: [['domination', 'high'], ['fear', 'medium']] },
        PIOUS: { id: 'pious', name: 'Pious', faithBonus: 0.4, karmaBonus: 0.2, goals: [['faith', 'high'], ['peace', 'medium']] },
        CUNNING: { id: 'cunning', name: 'Cunning', diplomacyBonus: 0.2, tradeBonus: 0.2, goals: [['trade', 'medium'], ['alliance', 'medium']] },
        BRAVE: { id: 'brave', name: 'Brave', warBonus: 0.3, loyaltyBonus: 0.1, goals: [['conquer', 'medium'], ['justice', 'low']] },
    },

    /** Bumped when goal generation changes; older lords get fresh goals. */
    GOALS_VERSION: 2,

    /**
     * Standing effects of a goal on the lord's kingdom (kingdom.lordModifiers,
     * read through LordInfluence in kingdomState.js), scaled by priority.
     *   stability   — points on the stability target
     *   military    — share added to the army the realm keeps
     *   defense     — share added to defensive battle power
     *   upkeep      — share added to war upkeep (negative = leaner)
     *   warAppetite — added to LordInfluence.warAppetite
     *   truceDays   — extra days the lord keeps a truce
     *   lawful      — chance a bandit band forming on his land is put down
     */
    GOAL_EFFECTS: {
        justice: { stability: 5, truceDays: 45, lawful: 0.5 },
        fear: { stability: 8 },
        faith: { stability: 3 },
        domination: { military: 0.1, warAppetite: 0.1 },
        survive: { defense: 0.1, upkeep: -0.2 },
    },

    /** Tuning for the goal actions in pursueGoal. */
    GOAL_TUNING: {
        trade: { perTown: 4, perRoute: 1, perRoad: 0.5, maxRoads: 20, partnerRelations: 3 },
        faith: { piety: 2, templeChance: 0.15 },
        domination: { weakRatio: 0.7, cowRatio: 0.5, pressure: 3, tributeChance: 0.25, tribute: 0.03, warChance: 0.1 },
        fear: { relations: -2, crushStability: 3 },
        survive: { peaceChance: 0.35, wearyDays: 90, savingsPerTown: 3 },
        colonize: { chance: 0.1 },
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
            kingdomId: kingdom.id,
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
            goalsVersion: NPCLords.GOALS_VERSION,
        };
    },

    /**
     * Goals from traits (data/npcLords.json `goals`, falling back to the
     * built-in trait table for older saved trait objects). Duplicates keep
     * their highest priority; a lord with no goal-bearing trait just survives.
     */
    generateGoals(traits) {
        const rank = { high: 3, medium: 2, low: 1 };
        const byType = new Map();
        for (const trait of traits || []) {
            if (!trait) continue;
            let list = trait.goals;
            if (!Array.isArray(list)) {
                const known = Object.values(NPCLords.TRAITS).find(t => t && t.id === trait.id);
                list = (known && known.goals) || [];
            }
            for (const entry of list) {
                const [type, priority = 'medium'] = Array.isArray(entry) ? entry : [entry.type, entry.priority];
                if (!type) continue;
                const prev = byType.get(type);
                if (!prev || (rank[priority] || 0) > (rank[prev.priority] || 0)) byType.set(type, { type, priority });
            }
        }
        const goals = [...byType.values()];

        // Always have at least one goal
        if (goals.length === 0) {
            goals.push({ type: 'survive', priority: 'high' });
        }

        return goals;
    },

    /**
     * Recompute the kingdom's standing goal effects (kingdom.lordModifiers)
     * from the lord's goals. Deterministic — no randomness.
     */
    updateModifiers(kingdom) {
        const mods = {};
        const lord = kingdom.lord;
        for (const goal of (lord && lord.goals) || []) {
            const fx = NPCLords.GOAL_EFFECTS[goal.type];
            if (!fx) continue;
            const w = LordInfluence.GOAL_PRIORITY_WEIGHT[goal.priority] || LordInfluence.GOAL_PRIORITY_WEIGHT.medium;
            for (const [k, v] of Object.entries(fx)) mods[k] = (mods[k] || 0) + v * w;
        }
        kingdom.lordModifiers = mods;
        return mods;
    },

    /**
     * Raider spawn hook (World.processUnits): a band forming on the land of a
     * lord who keeps the law may be put down at once. Returns true when it is.
     */
    suppressesRaiders(world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile || !tile.kingdom) return false;
        const kingdom = world.getKingdom(tile.kingdom);
        if (!kingdom || !kingdom.isAlive) return false;
        const lawful = Utils.clamp(LordInfluence.mod(kingdom, 'lawful'), 0, 0.9);
        return lawful > 0 && Utils.random() < lawful;
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
        if (!lord.kingdomId) lord.kingdomId = kingdom.id; // older saves
        if (lord.goalsVersion !== NPCLords.GOALS_VERSION) {
            lord.goals = NPCLords.generateGoals(lord.traits);
            lord.goalsVersion = NPCLords.GOALS_VERSION;
        }

        // Age the lord
        if (world.day % 120 === 0) { // Once per year
            lord.age++;

            // Death from old age (a player-ruled realm's lord is only its
            // steward — the player's line holds the throne)
            const playerRuled = !!(kingdom.crown && kingdom.crown.playerRuled);
            if (!playerRuled && lord.age > 70 && Utils.random() < (lord.age - 70) * 0.1) {
                NPCLords.lordDies(kingdom, world);
                return;
            }
        }

        // Standing effects of the lord's goals (stability, armies, truces, law)
        NPCLords.updateModifiers(kingdom);

        // Pursue goals — ambition, intelligence and priority set how often
        for (const goal of lord.goals) {
            if (Utils.random() < LordInfluence.goalChance(kingdom, goal)) {
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
                NPCLords.updateModifiers(kingdom);
                return;
            }
        }

        // Fallback: original behavior
        const newLord = NPCLords.generateLord(kingdom);
        kingdom.lord = newLord;
        kingdom.ruler = newLord.name;
        NPCLords.updateModifiers(kingdom);

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
                if (Utils.random() < 0.5) {
                    KingdomAI.tryExpand(kingdom, world);
                }
                break;

            case 'wealth':
                // Focus on trade
                if (Utils.random() < 0.6) {
                    TradeRoutes.establishRoutes(kingdom, world);
                }
                break;

            case 'conquer':
                // More likely to declare war
                if (Utils.random() < 0.4) {
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
                if (kingdom.wars.length > 0 && Utils.random() < 0.4) {
                    const enemy = world.getKingdom(kingdom.wars[0]);
                    if (enemy) {
                        KingdomAI.makePeace(kingdom, enemy, world);
                    }
                }
                break;

            case 'colonize':
                // Send this realm's pioneers into the wilderness (only this realm's)
                if (Utils.random() < NPCLords.GOAL_TUNING.colonize.chance) {
                    Colonization.launchKingdomPioneers(kingdom, world);
                }
                break;

            case 'trade':
                NPCLords.pursueTrade(kingdom, world);
                break;

            case 'faith':
                NPCLords.pursueFaith(kingdom, world);
                break;

            case 'justice':
                NPCLords.pursueJustice(kingdom, world);
                break;

            case 'domination':
                NPCLords.pursueDomination(kingdom, world);
                break;

            case 'fear':
                NPCLords.pursueFear(kingdom, world);
                break;

            case 'survive':
                NPCLords.pursueSurvival(kingdom, world);
                break;
        }
    },

    // ── Goal actions ─────────────────────────────

    /** Settlement tiles flying this kingdom's banner. */
    _towns(kingdom, world) {
        const out = [];
        for (const t of kingdom.territory || []) {
            const tile = world.getTile(t.q, t.r);
            if (tile && tile.settlement && tile.settlement.kingdom === kingdom.id) out.push(tile.settlement);
        }
        return out;
    },

    /** Stewardship multiplier on gold a lord's own schemes bring in (0.75-1.25). */
    _stewardMult(kingdom) {
        return 1 + LordInfluence.lean(kingdom, 'stewardship') * 0.25;
    },

    _shiftRelations(a, b, delta) {
        if (!a.relations) a.relations = {};
        a.relations[b.id] = Utils.clamp((a.relations[b.id] || 0) + delta, -100, 100);
    },

    /**
     * Trade: the lord's factors work the realm's markets and routes — gold
     * scaled by towns, trade routes and roads — and warm a trading partner.
     */
    pursueTrade(kingdom, world) {
        const T = NPCLords.GOAL_TUNING.trade;
        const towns = NPCLords._towns(kingdom, world);
        if (towns.length === 0) return 0;
        const names = new Map(world.getAllSettlements().map(s => [s.name, s.kingdom]));
        let routes = 0;
        const partners = new Set();
        for (const town of towns) {
            for (const route of (town.economy && town.economy.tradeRoutes) || []) {
                routes++;
                const partnerId = names.get(route.to);
                if (partnerId && partnerId !== kingdom.id) partners.add(partnerId);
            }
        }
        let roads = 0;
        for (const t of kingdom.territory || []) {
            const tile = world.getTile(t.q, t.r);
            if (tile && (tile.hasRoad || tile.infrastructure)) roads++;
        }
        const gold = Math.round((towns.length * T.perTown + routes * T.perRoute + Math.min(roads, T.maxRoads) * T.perRoad)
            * NPCLords._stewardMult(kingdom));
        kingdom.treasury = (kingdom.treasury || 0) + gold;

        const friends = [...partners].map(id => world.getKingdom(id))
            .filter(k => k && k.isAlive && !(kingdom.wars || []).includes(k.id));
        if (friends.length > 0) {
            const partner = Utils.randPick(friends);
            NPCLords._shiftRelations(kingdom, partner, T.partnerRelations);
            NPCLords._shiftRelations(partner, kingdom, T.partnerRelations);
        }
        return gold;
    },

    /** Faith: the lord leads the realm in devotion and may fund a temple. */
    pursueFaith(kingdom, world) {
        const T = NPCLords.GOAL_TUNING.faith;
        if (kingdom.religion && typeof kingdom.religion.piety === 'number') {
            kingdom.religion.piety = Utils.clamp(kingdom.religion.piety + T.piety, 0, 100);
        }
        if (Utils.random() < T.templeChance) return KingdomAI.fundTemple(kingdom, world);
        return null;
    },

    /** Justice: wardens hunt the brigands on the lord's land. */
    pursueJustice(kingdom, world) {
        const onOurLand = (u) => {
            const tile = world.getTile(u.q, u.r);
            return !!tile && tile.kingdom === kingdom.id;
        };
        const raider = (world.units || []).find(u => u.type === 'raider' && !u.destroyed && onOurLand(u));
        if (!raider) return null;
        raider.destroyed = true;
        if (Array.isArray(world.events)) {
            world.events.push({
                text: `⚖️ ${kingdom.lord.name}'s wardens hunt down a band of brigands in ${kingdom.name}.`,
                type: 'political',
                kingdom: kingdom.id,
            });
        }
        return raider;
    },

    /**
     * Domination: lean on the weakest neighbour — threats sour relations
     * (opening the door to war through KingdomAI.considerWar), and a badly
     * outmatched realm may be cowed into paying tribute.
     */
    pursueDomination(kingdom, world) {
        const T = NPCLords.GOAL_TUNING.domination;
        const mine = kingdom.military || 0;
        const weak = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id
            && !(kingdom.allies || []).includes(k.id) && !(kingdom.wars || []).includes(k.id)
            && !KingdomAI.hasTruce(kingdom, k, world) && (k.military || 0) < mine * T.weakRatio);
        if (weak.length === 0) return null;
        const target = weak.reduce((a, b) => ((b.military || 0) < (a.military || 0) ? b : a));
        NPCLords._shiftRelations(kingdom, target, -T.pressure);
        NPCLords._shiftRelations(target, kingdom, -T.pressure);

        let tribute = 0;
        if ((target.military || 0) < mine * T.cowRatio && Utils.random() < T.tributeChance) {
            tribute = Math.floor(Math.max(0, target.treasury || 0) * T.tribute);
            if (tribute > 0) {
                target.treasury -= tribute;
                kingdom.treasury = (kingdom.treasury || 0) + tribute;
                if (Array.isArray(world.events)) {
                    world.events.push({
                        text: `👑 ${kingdom.name} cows ${target.name} into paying ${tribute} gold in tribute.`,
                        type: 'political',
                        kingdom: kingdom.id,
                    });
                }
            }
        }
        if (Utils.random() < T.warChance) KingdomAI.considerWar(kingdom, world);
        return { target, tribute };
    },

    /**
     * Fear: rule by the sword. Dissent is crushed when the realm grows
     * restless, but neighbours look on the tyrant with growing distrust.
     */
    pursueFear(kingdom, world) {
        const T = NPCLords.GOAL_TUNING.fear;
        const others = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id);
        if (others.length > 0) NPCLords._shiftRelations(Utils.randPick(others), kingdom, T.relations);
        const stability = KingdomStability.ensure(kingdom);
        if (stability < KingdomStability.UNREST_THRESHOLD) {
            kingdom.stability = Math.min(100, stability + T.crushStability);
            if (Array.isArray(world.events)) {
                world.events.push({
                    text: `🪓 ${kingdom.lord.name}'s soldiers crush dissent in ${kingdom.name}.`,
                    type: 'political',
                    kingdom: kingdom.id,
                });
            }
            return true;
        }
        return false;
    },

    /**
     * Survive: at war, sue for peace when outmatched or the war drags on; at
     * peace, bank gold against hard times.
     */
    pursueSurvival(kingdom, world) {
        const T = NPCLords.GOAL_TUNING.survive;
        for (const enemyId of kingdom.wars || []) {
            const enemy = world.getKingdom(enemyId);
            if (!enemy || !enemy.isAlive) continue;
            const state = kingdom.warState && kingdom.warState[enemyId];
            const days = state ? (world.day || 0) - state.since : 0;
            const outmatched = (kingdom.military || 0) < (enemy.military || 0);
            if ((outmatched || days > T.wearyDays) && Utils.random() < T.peaceChance) {
                KingdomAI.makePeace(kingdom, enemy, world);
                return 'peace';
            }
            return null;
        }
        const towns = NPCLords._towns(kingdom, world).length;
        const saved = Math.round(towns * T.savingsPerTown * NPCLords._stewardMult(kingdom));
        kingdom.treasury = (kingdom.treasury || 0) + saved;
        return saved;
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
     * How each lord trait weighs the player's court reputation — the
     * mercy/severity/justice/piety/generosity built up by ruling on petitions
     * (systems/petitions.js keeps it on player.petitions.court).
     */
    COURT_OPINION_WEIGHTS: {
        honorable: { justice: 1, mercy: 0.25 },
        pious: { piety: 1, mercy: 0.25 },
        cruel: { severity: 1, mercy: -0.5 },
        cautious: { mercy: 0.5, severity: -0.25 },
        greedy: { generosity: -0.5 },
        brave: { severity: 0.25, justice: 0.25 },
        cunning: { justice: -0.25 },
    },
    /** Cap on the opinion the court reputation can move, either way. */
    COURT_OPINION_CAP: 15,

    /** Opinion this lord forms from the player's notable rulings at court. */
    courtOpinion(lord, player) {
        const court = player && player.petitions && player.petitions.court;
        if (!lord || !court || !Array.isArray(lord.traits)) return 0;
        let total = 0;
        for (const t of lord.traits) {
            const w = t && NPCLords.COURT_OPINION_WEIGHTS[t.id];
            if (!w) continue;
            for (const [axis, weight] of Object.entries(w)) total += (court[axis] || 0) * weight;
        }
        return Utils.clamp(Math.round(total), -NPCLords.COURT_OPINION_CAP, NPCLords.COURT_OPINION_CAP);
    },

    /**
     * Get lord's opinion of player
     */
    getLordOpinion(lord, player) {
        if (!lord) return 0;

        let opinion = 0;

        // Based on player karma: traits with a karmaBonus (Pious: 0.2 → ×2)
        const karmaWeight = lord.traits.reduce((s, t) => s + ((t && t.karmaBonus) || 0), 0) * 10;
        if (karmaWeight) {
            opinion += (player.karma || 0) * karmaWeight;
        }

        // Based on player renown
        if (lord.traits.some(t => t.id === 'ambitious')) {
            opinion += Math.floor(player.renown / 10);
        }

        // Based on player wealth
        if (lord.traits.some(t => t.id === 'greedy')) {
            opinion += Math.floor(player.gold / 1000);
        }

        // Kin by marriage (relationships.json marriageEffects.allianceWithSpouseKingdom)
        if (player.spouse && player.marriageAllianceKingdom && player.marriageAllianceKingdom === lord.kingdomId) {
            opinion += NPCLords.MARRIAGE_KIN_OPINION;
        }

        // Rulings at court — lords remember a merciful, harsh, just or pious ruler
        opinion += NPCLords.courtOpinion(lord, player);

        return Utils.clamp(opinion, -100, 100);
    },
};
