// ============================================
// ESPIONAGE — Spy recruitment, management & missions
// Requires: ESPIONAGE tech researched
// ============================================

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Technology } from './technology.js';
import { Hex } from '../core/hex.js';
import { Tavern } from '../player/tavern.js';
import { Characters } from '../world/characters.js';


export const Espionage = {
    // ── Default config (overridden by data/espionage.json) ──
    CONFIG: {
        maxSpies: 8,
        baseRecruitCost: 300,
        baseUpkeep: 15,
        maxActiveMissions: 5,
        missionCheckInterval: 1,
        spyCaptureBaseChance: 0.08,
        loyaltyDecayPerDay: 0.1,
        loyaltyMinBeforeBetrayal: 20,
        experiencePerMission: 50,
        levelUpThreshold: 150,
        maxSpyLevel: 5,
        requiredTech: 'espionage',
        fogRevealRadius: 4,
        fogRevealDuration: 30,
    },

    SPY_NAMES: null,
    SPY_SKILLS: null,
    SPY_TRAITS: null,
    MISSIONS: null,
    MISSION_OUTCOMES: null,
    LEVEL_TITLES: null,
    REBELLION_EFFECTS: null,

    _nextSpyId: 1,

    // ═══════════════════════════════════════
    //  DATA ACCESS HELPERS
    // ═══════════════════════════════════════

    _getData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.espionage) {
            return DataLoader.espionage;
        }
        return null;
    },

    _getConfig() {
        const data = this._getData();
        if (data && data.config) {
            return { ...this.CONFIG, ...data.config };
        }
        return this.CONFIG;
    },

    _getMissions() {
        if (this.MISSIONS) return this.MISSIONS;
        const data = this._getData();
        if (data && data.missions) return data.missions;
        return {};
    },

    _getMissionOutcomes() {
        if (this.MISSION_OUTCOMES) return this.MISSION_OUTCOMES;
        const data = this._getData();
        if (data && data.missionOutcomes) return data.missionOutcomes;
        return {};
    },

    _getSpyTraits() {
        if (this.SPY_TRAITS) return this.SPY_TRAITS;
        const data = this._getData();
        if (data && data.spyTraits) return data.spyTraits;
        return [];
    },

    _getSpyNames() {
        if (this.SPY_NAMES) return this.SPY_NAMES;
        const data = this._getData();
        if (data && data.spyNames) return data.spyNames;
        return { male: ['Shadow', 'Vex', 'Dagger'], female: ['Velvet', 'Mist', 'Ivy'], surnames: ['the Silent', 'the Quick'] };
    },

    _getLevelTitles() {
        if (this.LEVEL_TITLES) return this.LEVEL_TITLES;
        const data = this._getData();
        if (data && data.levelTitles) return data.levelTitles;
        return [
            { level: 1, title: 'Novice Agent', icon: '🔰' },
            { level: 2, title: 'Field Operative', icon: '🕵️' },
            { level: 3, title: 'Shadow Agent', icon: '🌑' },
            { level: 4, title: 'Master Spy', icon: '🎭' },
            { level: 5, title: 'Spymaster Elite', icon: '👁️' },
        ];
    },

    _getRebellionEffects() {
        if (this.REBELLION_EFFECTS) return this.REBELLION_EFFECTS;
        const data = this._getData();
        if (data && data.rebellionEffects) return data.rebellionEffects;
        return {};
    },

    // ═══════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════

    /**
     * Ensure player.espionage state exists
     */
    initPlayer(player) {
        if (!player.espionage) {
            player.espionage = {
                spies: [],
                activeMissions: [],
                completedMissions: 0,
                totalSpiesRecruited: 0,
                revealedTiles: [], // { q, r, expiresDay }
                rebellions: [],    // { kingdomId, severity, startDay, duration }
            };
        }
        if (!player.espionage.revealedTiles) player.espionage.revealedTiles = [];
        if (!player.espionage.rebellions) player.espionage.rebellions = [];
        if (!player.espionage.activeMissions) player.espionage.activeMissions = [];
    },

    /**
     * Check if the player has the espionage tech researched
     */
    hasEspionageTech(player) {
        if (typeof Technology === 'undefined') return false;
        const status = Technology.getTechStatus(player, this._getConfig().requiredTech);
        return status === 'researched' || status === 'implemented';
    },

    // ═══════════════════════════════════════
    //  SPY GENERATION & RECRUITMENT
    // ═══════════════════════════════════════

    /**
     * Generate a random spy with name, skills, and traits
     */
    generateSpy(player, world) {
        const config = this._getConfig();
        const names = this._getSpyNames();
        const traits = this._getSpyTraits();

        const gender = Math.random() < 0.5 ? 'male' : 'female';
        const namePool = names[gender] || names.male;
        const firstName = Utils.randPick(namePool);
        const surname = Utils.randPick(names.surnames);
        const name = `${firstName} ${surname}`;

        // Generate base skills (1-5 range, based on spy quality)
        const quality = Math.random(); // 0-1, higher = better spy
        const skillBase = Math.floor(quality * 3) + 2; // 2-4

        const skills = {
            infiltration: Math.min(10, skillBase + Utils.randInt(0, 2)),
            sabotage: Math.min(10, skillBase + Utils.randInt(0, 2)),
            gathering: Math.min(10, skillBase + Utils.randInt(0, 2)),
            combat: Math.min(10, skillBase + Utils.randInt(0, 2)),
        };

        // Pick 1-2 random traits
        const numTraits = Math.random() < 0.3 ? 2 : 1;
        const spyTraits = [];
        const availTraits = [...traits];
        for (let i = 0; i < numTraits && availTraits.length > 0; i++) {
            const idx = Utils.randInt(0, availTraits.length - 1);
            spyTraits.push(availTraits[idx]);
            availTraits.splice(idx, 1);
        }

        // Apply trait skill bonuses
        for (const trait of spyTraits) {
            if (trait.effect) {
                if (trait.effect.infiltration) skills.infiltration = Math.min(10, skills.infiltration + trait.effect.infiltration);
                if (trait.effect.sabotage) skills.sabotage = Math.min(10, skills.sabotage + trait.effect.sabotage);
                if (trait.effect.gathering) skills.gathering = Math.min(10, skills.gathering + trait.effect.gathering);
                if (trait.effect.combat) skills.combat = Math.min(10, skills.combat + trait.effect.combat);
            }
        }

        // Calculate upkeep based on quality and traits
        let upkeep = config.baseUpkeep + Math.floor(quality * 10);
        for (const trait of spyTraits) {
            if (trait.effect && trait.effect.upkeepReduction) {
                upkeep = Math.floor(upkeep * (1 - trait.effect.upkeepReduction));
            }
        }

        // Calculate recruit cost
        let recruitCost = config.baseRecruitCost + Math.floor(quality * 200);
        for (const trait of spyTraits) {
            if (trait.effect && trait.effect.recruitCostReduction) {
                recruitCost = Math.floor(recruitCost * (1 - trait.effect.recruitCostReduction));
            }
        }

        // Loyalty
        let loyalty = 60 + Utils.randInt(0, 30);
        for (const trait of spyTraits) {
            if (trait.effect && trait.effect.loyaltyBonus) loyalty = Math.min(100, loyalty + trait.effect.loyaltyBonus);
            if (trait.effect && trait.effect.loyaltyPenalty) loyalty = Math.max(10, loyalty + trait.effect.loyaltyPenalty);
        }

        const spy = {
            id: this._nextSpyId++,
            name,
            gender,
            skills,
            traits: spyTraits.map(t => t.id),
            loyalty,
            status: 'idle',
            currentMission: null,
            recruitDay: world ? world.day : 0,
            location: player ? { q: player.q, r: player.r } : { q: 0, r: 0 },
            missionsCompleted: 0,
            experience: 0,
            level: 1,
            upkeep,
            recruitCost,
        };

        return spy;
    },

    /**
     * Get available spies for recruitment at current location
     * Returns 2-4 candidates when called at a city
     */
    getRecruitCandidates(player, world) {
        const numCandidates = Utils.randInt(2, 4);
        const candidates = [];
        for (let i = 0; i < numCandidates; i++) {
            candidates.push(this.generateSpy(player, world));
        }
        return candidates;
    },

    /**
     * Recruit a specific spy
     */
    recruitSpy(player, spy, world) {
        this.initPlayer(player);
        const config = this._getConfig();

        if (player.espionage.spies.length >= config.maxSpies) {
            return { success: false, reason: `Maximum spy capacity reached (${config.maxSpies})` };
        }

        if (player.gold < spy.recruitCost) {
            return { success: false, reason: `Not enough gold (need ${spy.recruitCost}g)` };
        }

        player.gold -= spy.recruitCost;
        spy.recruitDay = world.day;
        spy.location = { q: player.q, r: player.r };
        player.espionage.spies.push(spy);
        player.espionage.totalSpiesRecruited++;

        return { success: true, spy, cost: spy.recruitCost };
    },

    /**
     * Dismiss a spy
     */
    dismissSpy(player, spyId) {
        this.initPlayer(player);
        const idx = player.espionage.spies.findIndex(s => s.id === spyId);
        if (idx === -1) return { success: false, reason: 'Spy not found' };

        const spy = player.espionage.spies[idx];
        if (spy.status === 'on_mission') {
            return { success: false, reason: 'Cannot dismiss a spy on an active mission' };
        }

        player.espionage.spies.splice(idx, 1);
        return { success: true, spy };
    },

    // ═══════════════════════════════════════
    //  MISSIONS
    // ═══════════════════════════════════════

    /**
     * Get available missions for a spy, filtered by level
     */
    getAvailableMissions(spy) {
        const missions = this._getMissions();
        const available = [];

        for (const [id, mission] of Object.entries(missions)) {
            available.push({
                ...mission,
                unlocked: spy.level >= (mission.requiredLevel || 1),
                lockReason: spy.level < (mission.requiredLevel || 1)
                    ? `Requires level ${mission.requiredLevel} (spy is level ${spy.level})`
                    : null,
            });
        }

        return available;
    },

    /**
     * Get kingdoms that can be targeted for a mission
     */
    getTargetKingdoms(player, world, missionType) {
        if (!world || !world.kingdoms) return [];
        const targets = [];

        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive) continue;
            // Can't target own kingdom (except counter_espionage)
            if (missionType !== 'counter_espionage' && kingdom.id === player.allegiance) continue;
            // Counter-espionage targets own kingdom
            if (missionType === 'counter_espionage' && kingdom.id !== player.allegiance) continue;

            targets.push({
                id: kingdom.id,
                name: kingdom.name,
                color: kingdom.color,
                military: kingdom.military,
                treasury: kingdom.treasury,
                territory: kingdom.territory ? kingdom.territory.length : 0,
            });
        }

        // For counter_espionage with no allegiance, allow defending current location
        if (missionType === 'counter_espionage' && targets.length === 0) {
            targets.push({ id: '_self', name: 'Your Domain', color: '#ffffff', military: 0, treasury: 0, territory: 0 });
        }

        return targets;
    },

    /**
     * Assign a spy to a mission
     */
    assignMission(player, spyId, missionType, targetKingdomId, world) {
        this.initPlayer(player);
        const config = this._getConfig();
        const missions = this._getMissions();
        const mission = missions[missionType];
        if (!mission) return { success: false, reason: 'Unknown mission type' };

        const spy = player.espionage.spies.find(s => s.id === spyId);
        if (!spy) return { success: false, reason: 'Spy not found' };
        if (spy.status !== 'idle') return { success: false, reason: 'Spy is not available' };
        if (spy.level < (mission.requiredLevel || 1)) {
            return { success: false, reason: `Spy must be level ${mission.requiredLevel} for this mission` };
        }

        const activeMissions = player.espionage.activeMissions.length;
        if (activeMissions >= config.maxActiveMissions) {
            return { success: false, reason: `Maximum active missions reached (${config.maxActiveMissions})` };
        }

        if (player.gold < (mission.goldCost || 0)) {
            return { success: false, reason: `Not enough gold (need ${mission.goldCost}g)` };
        }

        // Deduct mission cost
        player.gold -= (mission.goldCost || 0);

        // Calculate actual difficulty based on spy skills
        const primarySkill = spy.skills[mission.primarySkill] || 3;
        const skillModifier = (primarySkill - 5) * 0.05; // Each skill point ±5% difficulty
        const levelModifier = (spy.level - 1) * 0.05;
        const difficulty = Math.max(0.05, Math.min(0.95, mission.baseDifficulty - skillModifier - levelModifier));

        // Calculate duration reduction from skill
        const durationReduction = Math.floor(primarySkill * 0.3);
        const duration = Math.max(3, mission.baseDuration - durationReduction);

        const activeMission = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            spyId: spy.id,
            type: missionType,
            targetKingdom: targetKingdomId,
            startDay: world.day,
            duration,
            progress: 0,
            difficulty,
            captureChance: mission.captureChance || config.spyCaptureBaseChance,
        };

        spy.status = 'on_mission';
        spy.currentMission = activeMission.id;
        player.espionage.activeMissions.push(activeMission);

        return { success: true, mission: activeMission, spy, cost: mission.goldCost || 0 };
    },

    /**
     * Recall a spy from their current mission (with potential penalties)
     */
    recallSpy(player, spyId) {
        this.initPlayer(player);
        const spy = player.espionage.spies.find(s => s.id === spyId);
        if (!spy) return { success: false, reason: 'Spy not found' };
        if (spy.status !== 'on_mission') return { success: false, reason: 'Spy is not on a mission' };

        // Remove mission
        const mIdx = player.espionage.activeMissions.findIndex(m => m.spyId === spyId);
        if (mIdx !== -1) {
            player.espionage.activeMissions.splice(mIdx, 1);
        }

        spy.status = 'idle';
        spy.currentMission = null;

        // Loyalty penalty for recall
        spy.loyalty = Math.max(10, spy.loyalty - 5);

        return { success: true, spy };
    },

    // ═══════════════════════════════════════
    //  DAILY PROCESSING
    // ═══════════════════════════════════════

    /**
     * Process all espionage activities for the day
     * Called from game.js endDay()
     */
    processDaily(player, world) {
        this.initPlayer(player);
        const results = {
            upkeepPaid: 0,
            lostSpies: 0,
            completedMissions: [],
            rebellionUpdates: [],
            expiredReveals: 0,
        };

        // ── Pay spy upkeep ──
        for (const spy of player.espionage.spies) {
            if (spy.status === 'dead' || spy.status === 'captured') continue;
            if (player.gold >= spy.upkeep) {
                player.gold -= spy.upkeep;
                results.upkeepPaid += spy.upkeep;
            } else {
                // Can't pay — spy loyalty drops sharply
                spy.loyalty = Math.max(0, spy.loyalty - 5);
                if (spy.loyalty <= 0) {
                    spy.status = 'deserted';
                    results.lostSpies++;
                }
            }
        }

        // Remove deserted spies
        player.espionage.spies = player.espionage.spies.filter(s => s.status !== 'deserted');

        // ── Loyalty decay ──
        const config = this._getConfig();
        for (const spy of player.espionage.spies) {
            if (spy.status === 'dead' || spy.status === 'captured') continue;
            spy.loyalty = Math.max(0, spy.loyalty - config.loyaltyDecayPerDay);

            // Betrayal check
            if (spy.loyalty < config.loyaltyMinBeforeBetrayal) {
                const betrayalRisk = this._getSpyBetrayalRisk(spy);
                if (Math.random() < betrayalRisk) {
                    spy.status = 'deserted';
                    results.lostSpies++;
                    // Cancel any active mission
                    if (spy.currentMission) {
                        const mIdx = player.espionage.activeMissions.findIndex(m => m.id === spy.currentMission);
                        if (mIdx !== -1) player.espionage.activeMissions.splice(mIdx, 1);
                    }
                }
            }
        }
        player.espionage.spies = player.espionage.spies.filter(s => s.status !== 'deserted');

        // ── Advance missions ──
        const completedMissionIds = [];
        for (const mission of player.espionage.activeMissions) {
            mission.progress++;

            if (mission.progress >= mission.duration) {
                // Mission complete — resolve outcome
                const spy = player.espionage.spies.find(s => s.id === mission.spyId);
                if (spy) {
                    const outcome = this._resolveMission(player, spy, mission, world);
                    results.completedMissions.push(outcome);
                    completedMissionIds.push(mission.id);
                }
            }
        }

        // Remove completed missions
        player.espionage.activeMissions = player.espionage.activeMissions.filter(
            m => !completedMissionIds.includes(m.id)
        );

        // ── Process active rebellions ──
        for (let i = player.espionage.rebellions.length - 1; i >= 0; i--) {
            const rebellion = player.espionage.rebellions[i];
            rebellion.daysRemaining = (rebellion.daysRemaining || rebellion.duration) - 1;

            if (rebellion.daysRemaining <= 0) {
                player.espionage.rebellions.splice(i, 1);
                results.rebellionUpdates.push({ kingdomId: rebellion.kingdomId, ended: true });
            } else {
                // Apply daily rebellion effects on the kingdom
                this._applyRebellionDailyEffect(rebellion, world);
            }
        }

        // ── Expire fog-of-war reveals ──
        if (player.espionage.revealedTiles.length > 0) {
            const before = player.espionage.revealedTiles.length;
            player.espionage.revealedTiles = player.espionage.revealedTiles.filter(
                rt => rt.expiresDay > world.day
            );
            results.expiredReveals = before - player.espionage.revealedTiles.length;
        }

        return results;
    },

    /**
     * Apply spy-revealed tiles during visibility update
     * Called after player.updateVisibility()
     */
    applySpyVision(player, world) {
        this.initPlayer(player);
        if (!player.espionage.revealedTiles || player.espionage.revealedTiles.length === 0) return;

        for (const rt of player.espionage.revealedTiles) {
            if (rt.expiresDay > world.day) {
                const tile = world.getTile(rt.q, rt.r);
                if (tile) {
                    tile.explored = true;
                    tile.visible = true;
                }
            }
        }
    },

    // ═══════════════════════════════════════
    //  MISSION RESOLUTION
    // ═══════════════════════════════════════

    /**
     * Resolve a completed mission — determine outcome and apply effects
     */
    _resolveMission(player, spy, mission, world) {
        const missionDef = this._getMissions()[mission.type];
        if (!missionDef) return { type: mission.type, outcome: 'failure', text: 'Unknown mission type.' };

        // Calculate success chance
        const primarySkill = spy.skills[missionDef.primarySkill] || 3;
        const baseSuccess = 1 - mission.difficulty;
        const skillBonus = primarySkill * 0.04;
        const levelBonus = (spy.level - 1) * 0.05;
        const loyaltyFactor = spy.loyalty / 100;
        let successChance = Math.min(0.95, baseSuccess + skillBonus + levelBonus) * loyaltyFactor;

        // Player intelligence bonus
        if (player.intelligence) {
            successChance = Math.min(0.95, successChance + player.intelligence * 0.01);
        }

        // Spymaster title bonus
        if (player.currentTitle === 'spymaster') {
            successChance = Math.min(0.95, successChance + 0.10);
        }

        // Roll for outcome
        const roll = Math.random();
        let outcome;

        // Capture check (separate from success)
        const captureRoll = Math.random();
        let captured = false;
        let captureChance = mission.captureChance;

        // Trait-based capture resistance
        for (const traitId of spy.traits) {
            const trait = this._getSpyTraits().find(t => t.id === traitId);
            if (trait && trait.effect && trait.effect.captureResist) {
                captureChance = Math.max(0.01, captureChance - trait.effect.captureResist);
            }
        }

        if (captureRoll < captureChance) {
            captured = true;
        }

        if (captured && roll >= successChance) {
            outcome = 'captured';
        } else if (roll < successChance * 0.3) {
            outcome = 'criticalSuccess';
        } else if (roll < successChance) {
            outcome = 'success';
        } else if (roll < successChance + 0.15) {
            outcome = 'partialSuccess';
        } else {
            outcome = captured ? 'captured' : 'failure';
        }

        // Apply outcome
        const result = this._applyMissionOutcome(player, spy, mission, missionDef, outcome, world);

        // Update spy state
        spy.status = outcome === 'captured' ? 'captured' : 'idle';
        spy.currentMission = null;
        spy.missionsCompleted++;

        // Grant experience
        const outcomes = this._getMissionOutcomes();
        const outcomeData = outcomes[outcome] || { experienceMultiplier: 0.25 };
        const baseXP = missionDef.rewards?.experience || this._getConfig().experiencePerMission;
        const xpGained = Math.floor(baseXP * outcomeData.experienceMultiplier);
        spy.experience += xpGained;

        // Level up check
        const config = this._getConfig();
        const xpNeeded = spy.level * config.levelUpThreshold;
        if (spy.experience >= xpNeeded && spy.level < config.maxSpyLevel) {
            spy.level++;
            spy.experience -= xpNeeded;
            result.levelUp = true;
            result.newLevel = spy.level;
        }

        player.espionage.completedMissions++;
        result.xpGained = xpGained;
        result.outcome = outcome;
        result.outcomeData = outcomeData;
        result.spyName = spy.name;

        // If captured, remove spy from roster
        if (outcome === 'captured') {
            player.espionage.spies = player.espionage.spies.filter(s => s.id !== spy.id);
        }

        return result;
    },

    /**
     * Apply the effects of a mission outcome
     */
    _applyMissionOutcome(player, spy, mission, missionDef, outcome, world) {
        const result = {
            type: mission.type,
            targetKingdom: mission.targetKingdom,
            text: '',
            rewards: {},
        };

        const kingdom = world ? world.getKingdom(mission.targetKingdom) : null;
        const kingdomName = kingdom ? kingdom.name : 'the target kingdom';
        const isSuccess = outcome === 'success' || outcome === 'criticalSuccess';
        const isPartial = outcome === 'partialSuccess';

        switch (mission.type) {
            case 'gather_intel':
                result.text = this._resolveGatherIntel(player, spy, kingdom, isSuccess, isPartial, outcome, world);
                break;

            case 'steal_technology':
                result.text = this._resolveStealTechnology(player, spy, kingdom, isSuccess, isPartial, outcome, world, result);
                break;

            case 'incite_rebellion':
                result.text = this._resolveInciteRebellion(player, spy, kingdom, isSuccess, isPartial, outcome, world, result);
                break;

            case 'infiltrate_territory':
                result.text = this._resolveInfiltrateTerritory(player, spy, kingdom, isSuccess, isPartial, outcome, world, result);
                break;

            case 'sabotage':
                result.text = this._resolveSabotage(player, spy, kingdom, isSuccess, isPartial, outcome, world, result);
                break;

            case 'counter_espionage':
                result.text = this._resolveCounterEspionage(player, spy, isSuccess, isPartial, outcome);
                break;

            case 'assassinate':
                result.text = this._resolveAssassination(player, spy, kingdom, isSuccess, isPartial, outcome, world, result);
                break;

            default:
                result.text = isSuccess ? `${spy.name} completed the mission.` : `${spy.name} failed the mission.`;
        }

        // Apply diplomatic consequences on failure/capture
        if (outcome === 'captured' || (isSuccess && missionDef.consequences)) {
            this._applyDiplomaticConsequences(player, kingdom, missionDef, outcome);
        }

        // Renown reward
        if (isSuccess && missionDef.rewards && missionDef.rewards.renown) {
            player.renown = (player.renown || 0) + missionDef.rewards.renown;
            result.rewards.renown = missionDef.rewards.renown;
        }

        // Karma penalty for assassination
        if (mission.type === 'assassinate' && missionDef.consequences && missionDef.consequences.karmaPenalty) {
            if (isSuccess) {
                player.karma = (player.karma || 0) + missionDef.consequences.karmaPenalty;
                result.rewards.karma = missionDef.consequences.karmaPenalty;
            }
        }

        return result;
    },

    // ═══════════════════════════════════════
    //  MISSION-SPECIFIC RESOLUTION
    // ═══════════════════════════════════════

    _resolveGatherIntel(player, spy, kingdom, isSuccess, isPartial, outcome, world) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was captured while gathering intelligence in ${kingdomName}! The spy has been imprisoned.`;
        }

        if (isSuccess || isPartial) {
            // Generate intel rumors
            const numRumors = isSuccess ? 3 : 1;
            if (typeof Tavern !== 'undefined' && kingdom) {
                const rumors = [];
                const categories = ['military', 'kingdom_affairs', 'trade_opportunities'];
                for (let i = 0; i < numRumors; i++) {
                    const cat = Utils.randPick(categories);
                    const tile = world ? world.getTile(kingdom.capital?.q || 0, kingdom.capital?.r || 0) : null;
                    if (tile) {
                        const rumor = Tavern._generateRumor(cat, tile, world, { label: 'Spy Report', accuracy: 0.95, color: '#9b59b6' });
                        if (rumor) rumors.push(rumor);
                    }
                }
                if (rumors.length > 0) Tavern._storeRumors(player, rumors);
            }

            // Learn kingdom knowledge
            if (kingdom) {
                const categories = ['military', 'economy', 'diplomacy'];
                const toLearn = isSuccess ? categories : [Utils.randPick(categories)];
                player.learnAboutKingdom(kingdom.id, toLearn);
            }

            return isSuccess
                ? `${spy.name} successfully gathered intelligence on ${kingdomName}. ${numRumors} detailed reports received.`
                : `${spy.name} gathered partial intelligence on ${kingdomName}. Limited information obtained.`;
        }

        return `${spy.name} failed to gather useful intelligence on ${kingdomName}. The mission was a bust.`;
    },

    _resolveStealTechnology(player, spy, kingdom, isSuccess, isPartial, outcome, world, result) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was caught infiltrating ${kingdomName}'s research facilities! The spy has been captured and will face trial.`;
        }

        if (isSuccess) {
            // Find a tech that the kingdom has but the player doesn't
            let stolenTech = null;
            if (typeof Technology !== 'undefined' && kingdom && kingdom.characterData) {
                Technology.initPlayer(player);
                const playerResearched = player.technology.researched || [];
                const playerImplemented = player.technology.implemented || [];
                const playerKnown = [...playerResearched, ...playerImplemented];

                // Kingdom techs (simulated — kingdoms have tech level based on age/military)
                const allTechs = Technology.TECHS || {};
                const kingdomTechPool = Object.keys(allTechs).filter(t => {
                    const tech = allTechs[t];
                    if (!tech) return false;
                    if (playerKnown.includes(t)) return false;
                    // Simulate that kingdoms know techs up to tier based on their age/power
                    const kingdomTier = Math.min(5, Math.floor((kingdom.military || 0) / 200) + 1);
                    return (tech.tier || 1) <= kingdomTier;
                });

                if (kingdomTechPool.length > 0) {
                    stolenTech = Utils.randPick(kingdomTechPool);
                    player.technology.researched.push(stolenTech);
                    const techDef = allTechs[stolenTech];
                    result.rewards.technology = stolenTech;
                    return `${spy.name} successfully stole "${techDef ? techDef.name : stolenTech}" technology secrets from ${kingdomName}! The tech is now researched.`;
                }
            }

            // Fallback if no stealable tech found
            const goldStolen = Utils.randInt(100, 300);
            player.gold += goldStolen;
            result.rewards.gold = goldStolen;
            return `${spy.name} couldn't find new technology but stole ${goldStolen}g worth of research documents from ${kingdomName}.`;
        }

        if (isPartial) {
            // Partial — get hints/research progress instead
            if (typeof Technology !== 'undefined' && player.technology.currentResearch) {
                player.technology.currentResearch.progress = Math.min(
                    player.technology.currentResearch.totalDays,
                    (player.technology.currentResearch.progress || 0) + 3
                );
                return `${spy.name} obtained partial research notes from ${kingdomName}. Your current research advanced by 3 days.`;
            }
            return `${spy.name} obtained fragments of research from ${kingdomName}. Not enough for a breakthrough.`;
        }

        return `${spy.name} failed to access ${kingdomName}'s research facilities. Security was too tight.`;
    },

    _resolveInciteRebellion(player, spy, kingdom, isSuccess, isPartial, outcome, world, result) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was arrested while distributing seditious pamphlets in ${kingdomName}! The spy faces execution for treason.`;
        }

        if (isSuccess) {
            // Apply rebellion effects to the kingdom
            const effects = this._getRebellionEffects();
            const severity = outcome === 'criticalSuccess' ? 'large' : 'medium';
            const rebellionDef = effects[severity] || effects.medium;

            if (kingdom) {
                // Apply immediate effects
                const treasuryLoss = Math.floor((kingdom.treasury || 0) * rebellionDef.treasuryLoss);
                const militaryLoss = Math.floor((kingdom.military || 0) * rebellionDef.militaryLoss);
                kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - treasuryLoss);
                kingdom.military = Math.max(0, (kingdom.military || 0) - militaryLoss);

                // Territory loss — remove random border tiles
                if (rebellionDef.territoryLoss > 0 && kingdom.territory && kingdom.territory.length > 3) {
                    const tilesToLose = Math.min(rebellionDef.territoryLoss, Math.floor(kingdom.territory.length * 0.1));
                    for (let i = 0; i < tilesToLose; i++) {
                        const idx = Utils.randInt(0, kingdom.territory.length - 1);
                        const lost = kingdom.territory[idx];
                        // Don't remove capital
                        if (kingdom.capital && lost.q === kingdom.capital.q && lost.r === kingdom.capital.r) continue;
                        const tile = world ? world.getTile(lost.q, lost.r) : null;
                        if (tile) {
                            tile.kingdom = null;
                        }
                        kingdom.territory.splice(idx, 1);
                    }
                }

                // Track rebellion
                player.espionage.rebellions.push({
                    kingdomId: kingdom.id,
                    severity,
                    startDay: world.day,
                    duration: rebellionDef.duration,
                    daysRemaining: rebellionDef.duration,
                });

                result.rewards.rebellion = { severity, treasuryLoss, militaryLoss };
                return `${spy.name} successfully incited a ${rebellionDef.label} in ${kingdomName}! Treasury: -${treasuryLoss}g, Military: -${militaryLoss}. ${rebellionDef.description}`;
            }

            return `${spy.name} stirred unrest in ${kingdomName}.`;
        }

        if (isPartial) {
            // Minor unrest
            if (kingdom) {
                const effects = this._getRebellionEffects();
                const small = effects.small || { treasuryLoss: 0.05, militaryLoss: 0.03, duration: 5, label: 'Minor Unrest' };
                const treasuryLoss = Math.floor((kingdom.treasury || 0) * small.treasuryLoss);
                kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - treasuryLoss);

                player.espionage.rebellions.push({
                    kingdomId: kingdom.id,
                    severity: 'small',
                    startDay: world.day,
                    duration: small.duration,
                    daysRemaining: small.duration,
                });

                return `${spy.name} managed to cause minor unrest in ${kingdomName}. Treasury: -${treasuryLoss}g. The disturbance was small.`;
            }
        }

        return `${spy.name} failed to incite rebellion in ${kingdomName}. The people remain loyal to their ruler.`;
    },

    _resolveInfiltrateTerritory(player, spy, kingdom, isSuccess, isPartial, outcome, world, result) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was discovered while mapping ${kingdomName}'s territory! The spy has been imprisoned.`;
        }

        if (isSuccess || isPartial) {
            // Reveal tiles in the target kingdom
            if (kingdom && kingdom.territory && world) {
                const config = this._getConfig();
                const revealRadius = isSuccess ? config.fogRevealRadius : Math.max(2, config.fogRevealRadius - 2);
                const duration = isSuccess ? config.fogRevealDuration : Math.floor(config.fogRevealDuration / 2);

                // Pick a center point in the kingdom (capital or random territory tile)
                const center = kingdom.capital || Utils.randPick(kingdom.territory);
                if (center) {
                    const hexes = (typeof Hex !== 'undefined')
                        ? Hex.hexesInRange(center.q, center.r, revealRadius)
                        : [center];

                    let revealed = 0;
                    for (const hex of hexes) {
                        const tile = world.getTile(hex.q, hex.r);
                        if (tile) {
                            tile.explored = true;
                            tile.visible = true;
                            // Track for persistent reveal
                            player.espionage.revealedTiles.push({
                                q: hex.q,
                                r: hex.r,
                                expiresDay: world.day + duration,
                            });
                            revealed++;
                        }
                    }

                    result.rewards.tilesRevealed = revealed;
                    return isSuccess
                        ? `${spy.name} successfully infiltrated ${kingdomName}! ${revealed} tiles revealed for ${duration} days. You can now see their territory.`
                        : `${spy.name} partially mapped ${kingdomName}'s territory. ${revealed} tiles revealed for ${duration} days.`;
                }
            }

            return `${spy.name} scouted ${kingdomName}'s borders but found limited territory to reveal.`;
        }

        return `${spy.name} failed to penetrate ${kingdomName}'s borders. The territory remains shrouded.`;
    },

    _resolveSabotage(player, spy, kingdom, isSuccess, isPartial, outcome, world, result) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was caught red-handed sabotaging ${kingdomName}'s infrastructure! The spy has been seized.`;
        }

        if (isSuccess) {
            if (kingdom) {
                const missionDef = this._getMissions().sabotage;
                const treasuryDrain = Math.floor((kingdom.treasury || 0) * (missionDef.effects?.treasuryDrain || 0.10));
                kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - treasuryDrain);

                result.rewards.treasuryDrained = treasuryDrain;
                return `${spy.name} successfully sabotaged ${kingdomName}! Treasury: -${treasuryDrain}g. Infrastructure damage will slow their progress.`;
            }
            return `${spy.name} completed sabotage operations against ${kingdomName}.`;
        }

        if (isPartial) {
            if (kingdom) {
                const minorDrain = Math.floor((kingdom.treasury || 0) * 0.03);
                kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - minorDrain);
                return `${spy.name} caused minor damage to ${kingdomName}'s supplies. Treasury: -${minorDrain}g.`;
            }
        }

        return `${spy.name} failed to sabotage ${kingdomName}. Security was too tight.`;
    },

    _resolveCounterEspionage(player, spy, isSuccess, isPartial, outcome) {
        if (outcome === 'captured') {
            return `Through a twist of fate, ${spy.name} was falsely accused of espionage while on counter-espionage duty! The spy has been imprisoned.`;
        }

        if (isSuccess) {
            // Boost loyalty for successful defense
            spy.loyalty = Math.min(100, spy.loyalty + 10);
            return `${spy.name} successfully detected and neutralized an enemy intelligence operation! Your domain is safer. ${spy.name}'s loyalty increased.`;
        }

        if (isPartial) {
            return `${spy.name} detected some suspicious activity but couldn't confirm enemy spy presence. Stay vigilant.`;
        }

        return `${spy.name}'s counter-espionage sweep found nothing. Either there are no enemy agents, or they're very good.`;
    },

    _resolveAssassination(player, spy, kingdom, isSuccess, isPartial, outcome, world, result) {
        const kingdomName = kingdom ? kingdom.name : 'the target';

        if (outcome === 'captured') {
            return `${spy.name} was captured during an assassination attempt in ${kingdomName}! This is an act of war — the spy faces immediate execution.`;
        }

        if (isSuccess) {
            if (kingdom) {
                // Kill the ruler — trigger succession crisis
                if (kingdom.ruler) {
                    const oldRulerName = kingdom.ruler;
                    // Generate new ruler (succession)
                    if (typeof Characters !== 'undefined') {
                        const newRuler = Characters.generateCharacter({ culture: kingdom.culture, isRuler: true });
                        kingdom.ruler = `${newRuler.firstName} ${newRuler.dynasty}`;
                        kingdom.characterData = newRuler;
                    } else {
                        kingdom.ruler = 'New Ruler';
                    }

                    // Succession crisis penalties
                    kingdom.military = Math.max(0, Math.floor((kingdom.military || 0) * 0.7));
                    kingdom.treasury = Math.max(0, Math.floor((kingdom.treasury || 0) * 0.8));

                    result.rewards.assassination = true;
                    return `${spy.name} successfully assassinated ${oldRulerName} of ${kingdomName}! The kingdom is plunged into a succession crisis. Military: -30%, Treasury: -20%.`;
                }
            }
            return `${spy.name} completed the assassination mission in ${kingdomName}.`;
        }

        if (isPartial) {
            if (kingdom) {
                // Wounded but not killed — still causes disruption
                kingdom.military = Math.max(0, Math.floor((kingdom.military || 0) * 0.9));
                return `${spy.name} wounded the ruler of ${kingdomName} but failed to deliver a killing blow. The kingdom's military mobilizes in response.`;
            }
        }

        return `${spy.name} failed to reach their target in ${kingdomName}. Security proved impenetrable.`;
    },

    // ═══════════════════════════════════════
    //  HELPER FUNCTIONS
    // ═══════════════════════════════════════

    _getSpyBetrayalRisk(spy) {
        let risk = 0.02; // Base 2% per day at low loyalty
        for (const traitId of spy.traits || []) {
            const trait = this._getSpyTraits().find(t => t.id === traitId);
            if (trait && trait.effect && trait.effect.betrayalRisk) {
                risk += trait.effect.betrayalRisk;
            }
        }
        return risk;
    },

    _applyDiplomaticConsequences(player, kingdom, missionDef, outcome) {
        if (!kingdom || !missionDef.consequences) return;

        // Worsen relations
        if (missionDef.consequences.diplomaticPenalty && player.allegiance) {
            if (kingdom.relations && kingdom.relations[player.allegiance] !== undefined) {
                kingdom.relations[player.allegiance] += missionDef.consequences.diplomaticPenalty;
            }
        }

        // Reputation hit
        if (player.reputation && kingdom.id) {
            const penalty = outcome === 'captured'
                ? (missionDef.consequences.diplomaticPenalty || 0) * 1.5
                : missionDef.consequences.diplomaticPenalty || 0;
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + penalty;
        }
    },

    _applyRebellionDailyEffect(rebellion, world) {
        if (!world) return;
        const kingdom = world.getKingdom(rebellion.kingdomId);
        if (!kingdom || !kingdom.isAlive) return;

        // Small daily treasury drain during rebellion
        const dailyDrain = Math.floor((kingdom.treasury || 0) * 0.005);
        kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - dailyDrain);
    },

    /**
     * Get spy level title
     */
    getSpyLevelTitle(level) {
        const titles = this._getLevelTitles();
        const entry = titles.find(t => t.level === level);
        return entry || { level, title: `Level ${level}`, icon: '🔰' };
    },

    /**
     * Get total daily upkeep for all spies
     */
    getTotalUpkeep(player) {
        this.initPlayer(player);
        let total = 0;
        for (const spy of player.espionage.spies) {
            if (spy.status !== 'dead' && spy.status !== 'captured') {
                total += spy.upkeep;
            }
        }
        return total;
    },

    /**
     * Get spy by ID
     */
    getSpyById(player, spyId) {
        this.initPlayer(player);
        return player.espionage.spies.find(s => s.id === spyId) || null;
    },

    /**
     * Get mission summary for display
     */
    getMissionSummary(player) {
        this.initPlayer(player);
        return {
            totalSpies: player.espionage.spies.length,
            idleSpies: player.espionage.spies.filter(s => s.status === 'idle').length,
            activeMissions: player.espionage.activeMissions.length,
            completedMissions: player.espionage.completedMissions,
            dailyUpkeep: this.getTotalUpkeep(player),
            activeRebellions: player.espionage.rebellions.length,
            revealedTiles: player.espionage.revealedTiles.length,
        };
    },

    // ═══════════════════════════════════════
    //  SAVE / LOAD
    // ═══════════════════════════════════════

    prepareForSave(player) {
        this.initPlayer(player);
        // Track next spy ID for reload
        player.espionage._nextSpyId = this._nextSpyId;
    },

    loadState(player) {
        this.initPlayer(player);
        if (player.espionage._nextSpyId) {
            this._nextSpyId = player.espionage._nextSpyId;
        } else {
            // Calculate next ID from existing spies
            let maxId = 0;
            for (const spy of player.espionage.spies) {
                if (spy.id > maxId) maxId = spy.id;
            }
            this._nextSpyId = maxId + 1;
        }
    },
};
