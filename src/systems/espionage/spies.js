// Espionage — spies members (split from the original monolith).
import { Espionage } from './_ref.js';
import { DataLoader, Utils, Technology, Hex, Tavern, Characters } from './_imports.js';

Object.assign(Espionage, {
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
        if (!player.espionage.sabotaged) player.espionage.sabotaged = []; // { kingdomId, penalty, daysRemaining }
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

        const gender = Utils.random() < 0.5 ? 'male' : 'female';
        const namePool = names[gender] || names.male;
        const firstName = Utils.randPick(namePool);
        const surname = Utils.randPick(names.surnames);
        const name = `${firstName} ${surname}`;

        // Generate base skills (1-5 range, based on spy quality)
        const quality = Utils.random(); // 0-1, higher = better spy
        const skillBase = Math.floor(quality * 3) + 2; // 2-4

        const skills = {
            infiltration: Math.min(10, skillBase + Utils.randInt(0, 2)),
            sabotage: Math.min(10, skillBase + Utils.randInt(0, 2)),
            gathering: Math.min(10, skillBase + Utils.randInt(0, 2)),
            combat: Math.min(10, skillBase + Utils.randInt(0, 2)),
        };

        // Pick 1-2 random traits
        const numTraits = Utils.random() < 0.3 ? 2 : 1;
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
            id: Date.now() + Math.floor(Utils.random() * 1000),
            spyId: spy.id,
            type: missionType,
            targetKingdom: targetKingdomId,
            startDay: world.day,
            duration,
            progress: 0,
            difficulty,
            captureChance: mission.captureChance || config.spyCaptureBaseChance,
        };
        // Counter-espionage guards the holdings within counterRadius of where the spy is posted
        if (missionType === 'counter_espionage') {
            activeMission.stationQ = player.q;
            activeMission.stationR = player.r;
        }

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
});
