// ============================================
// PLAYER NEEDS — Sims-style needs system
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================

export const PlayerNeedsMethods = {
    /**
     * Decay needs over one inner-map hour.
     * Called from the game loop each time innerMap.timeOfDay advances.
     * Rates are per-hour; 16 waking hours × rate is about one day's drain.
     */
    decayNeedsPerHour(context = {}) {
        return; // needs system disabled
        if (!this.needs) return;

        // Base hourly decay rates (per hour, so ~16 hrs drains the amount)
        // At default rates a full night's sleep + decent day refills most bars.
        const rates = {
            hunger:  -3.0,   // ~48 over 16 hrs → need to eat 1-2 meals
            energy:  -2.5,   // ~40 over 16 hrs → need ~6-8 hrs rest
            social:  -1.5,   // ~24 → talking/tavern helps
            fun:     -1.8,   // ~29 → exploring/events help
            hygiene: -1.0,   // ~16 → slow decline
            comfort: -1.2,   // ~19 → being outdoors/traveling hurts
        };

        // Context modifiers
        if (context.insideBuilding) {
            rates.comfort += 0.8;  // Indoors is comfortable
            rates.hygiene += 0.3;  // Slightly better indoors
        }
        if (context.isNight) {
            rates.energy -= 1.0;   // Extra tired at night
            rates.fun    -= 0.5;   // Boring at night
        }
        if (context.isRaining) {
            rates.hygiene += 0.5;  // Rain = partial cleaning
            rates.comfort -= 0.8;  // But uncomfortable
            rates.fun     -= 0.3;
        }
        if (context.inOwnHouse) {
            rates.comfort += 1.5;  // Home comfort
            rates.hygiene += 0.5;
        }

        for (const [need, rate] of Object.entries(rates)) {
            this.needs[need] = Math.max(0, Math.min(100, this.needs[need] + rate));
        }
    },

    /**
     * Modify a specific need by the given amount (positive = satisfy, negative = drain).
     * Clamps to [0, 100].
     */
    modifyNeed(need, amount) {
        if (!this.needs || this.needs[need] == null) return;
        this.needs[need] = Math.max(0, Math.min(100, this.needs[need] + amount));
    },

    /**
     * Get the player's overall mood (0-100) based on the average of all needs.
     * Returns { score, label, icon, effects }
     */
    getMood() {
        if (!this.needs) return { score: 75, label: 'Fine', icon: '😐', effects: {} };

        const vals = Object.values(this.needs);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const lowest = Math.min(...vals);

        // Mood is weighted: average matters but lowest need drags it down
        const score = Math.round(avg * 0.6 + lowest * 0.4);

        let label, icon;
        if (score >= 85)      { label = 'Ecstatic';  icon = '😄'; }
        else if (score >= 70) { label = 'Happy';     icon = '😊'; }
        else if (score >= 50) { label = 'Fine';      icon = '😐'; }
        else if (score >= 30) { label = 'Tense';     icon = '😟'; }
        else if (score >= 15) { label = 'Miserable'; icon = '😩'; }
        else                  { label = 'Desperate'; icon = '😵'; }

        // Gameplay effects based on mood
        const effects = {};
        if (score >= 80) {
            effects.combatBonus = 1;       // +1 combat skill in fights
            effects.charismaBonus = 1;     // Better prices / diplomacy
            effects.reputationGain = 0.5;  // Slight renown bonus per day
        } else if (score < 30) {
            effects.combatPenalty = -1;
            effects.charismaPenalty = -1;
            effects.movementPenalty = -2;  // Sluggish movement
        }
        if (score < 15) {
            effects.healthDrain = 3;       // Desperation hurts health
            effects.movementPenalty = -4;
        }

        return { score, label, icon, effects };
    },

    /**
     * Get need category ("high" / "mid" / "low" / "critical")
     */
    getNeedLevel(need) {
        const v = this.needs ? this.needs[need] : 100;
        if (v >= 60) return 'high';
        if (v >= 30) return 'mid';
        if (v >= 10) return 'low';
        return 'critical';
    },

    /**
     * Apply overnight rest to needs (called during endDay when player rests).
     * Where they rest matters: inn > own house > camp > outdoors.
     */
    restOvernight(restType = 'outdoors') {
        if (!this.needs) return;

        // Energy recovery depends on shelter quality
        const energyGain = {
            inn:      70,    // Full rest at an inn
            ownHouse: 65,    // Rest at player's own house
            camp:     40,    // Rough camping
            outdoors: 25,    // Sleeping rough
        }[restType] || 25;

        const comfortGain = {
            inn:      40,
            ownHouse: 45,
            camp:     15,
            outdoors: 5,
        }[restType] || 5;

        const hygieneGain = {
            inn:      25,    // Inns have wash basins
            ownHouse: 20,
            camp:     0,
            outdoors: -5,    // Gets dirtier
        }[restType] || 0;

        this.modifyNeed('energy', energyGain);
        this.modifyNeed('comfort', comfortGain);
        this.modifyNeed('hygiene', hygieneGain);

        // Hunger still decays overnight
        this.modifyNeed('hunger', -15);

        // Social / fun don't change much overnight
        this.modifyNeed('social', -5);
        this.modifyNeed('fun', -5);
    },

    /**
     * Reset per-day need tracking
     */
    resetDailyNeedTracking() {
        this._needWarnings = {};
        this._lastNeedDecayHour = 8;
    },
};
