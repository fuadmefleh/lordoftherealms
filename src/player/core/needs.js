// ============================================
// PLAYER NEEDS — Sims-style needs system
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================

/** Waking hours in one day — the inner-map day and the world-map day share it. */
export const WAKING_HOURS = 16;

/**
 * How much each need drains over one world-map day of travel (16 waking hours).
 * Balanced against the daily ration (+35 hunger), a night's rest and the
 * tavern/social actions so that ordinary play holds every bar steady and only
 * days of neglect pull a bar into the red. Social and fun are the slow ones.
 */
export const WORLD_DAY_DECAY = {
    hunger:  20,
    energy:  35,
    social:   7,
    fun:      7,
    hygiene:  8,
    comfort: 10,
};

/** Hunger restored by the daily ration eaten at day's end. */
export const DAILY_RATION_HUNGER = 35;

/** Hunger restored by a deliberate meal (Eat a Meal action), by food type. */
export const MEAL_HUNGER = {
    cooked_meat: 40, cooked_fish: 30, bread: 25, preserved_fish: 25, fish: 20, grain: 15,
};

export const PlayerNeedsMethods = {
    /**
     * Master switch for the needs system. While false, needs don't decay,
     * low-need warnings don't fire, mood has no gameplay effect and the HUD
     * needs bars stay hidden. On by default (also for saves made before the
     * switch existed — they simply don't carry the key).
     */
    needsEnabled: true,

    /**
     * Decay needs over one inner-map hour.
     * Called from the game loop each time innerMap.timeOfDay advances.
     * Rates are per-hour; the inner map drains about 1.5× a world-map day
     * (WORLD_DAY_DECAY) because food, beds, baths and benches are all a few
     * steps away there. Hours spent here are subtracted from the world-map
     * drain applied at day's end, so a day is never counted twice.
     */
    decayNeedsPerHour(context = {}) {
        if (!this.needsEnabled || !this.needs) return;
        this._needHoursToday = (this._needHoursToday || 0) + 1;

        // Base hourly decay rates (~16 waking hours drains the shown amount)
        const rates = {
            hunger:  -2.0,   // ~32 over a day → one or two meals
            energy:  -2.5,   // ~40 → a night's sleep
            social:  -1.0,   // ~16 → talking/tavern helps
            fun:     -1.0,   // ~16 → games, music, exploring
            hygiene: -0.8,   // ~13 → slow decline
            comfort: -1.0,   // ~16 → sitting, being indoors
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
     * Drain a world-map day's worth of needs (called from endDay before the
     * ration and the night's rest). Inner-map hours already decayed today are
     * subtracted, so time spent walking a town isn't charged twice.
     * Returns the fraction of a day that was applied (0..1).
     */
    decayNeedsForDay() {
        if (!this.needsEnabled || !this.needs) return 0;
        const innerHours = Math.max(0, this._needHoursToday || 0);
        const fraction = Math.max(0, 1 - innerHours / WAKING_HOURS);
        if (fraction <= 0) return 0;
        for (const [need, amount] of Object.entries(WORLD_DAY_DECAY)) {
            this.modifyNeed(need, -amount * fraction);
        }
        return fraction;
    },

    /**
     * Eat one ration from the pack right now (world-map "Eat a Meal").
     * Best food first, same order as the daily ration. Returns
     * { success, food, hunger } or { success: false, reason }.
     */
    eatMeal() {
        if (!this.inventory) return { success: false, reason: 'You have no food.' };
        for (const food of Object.keys(MEAL_HUNGER)) {
            if (this.inventory[food] > 0) {
                this.inventory[food]--;
                if (this.inventory[food] <= 0) delete this.inventory[food];
                const hunger = MEAL_HUNGER[food];
                this.modifyNeed('hunger', hunger);
                this.modifyNeed('comfort', 3);
                return { success: true, food, hunger };
            }
        }
        return { success: false, reason: 'You have no food.' };
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
        if (!this.needs || !this.needsEnabled) return { score: 75, label: 'Fine', icon: '😐', effects: {} };

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

        // Gameplay effects based on mood — turned into numbers by the MOOD
        // section of player/playerEffects.js (battle power, personal damage,
        // trade prices, diplomacy, reputation gains) and by endDay (health,
        // movement).
        const effects = {};
        if (score >= 80) {
            effects.combatBonus = 1;       // +5% battle power / personal damage
            effects.charismaBonus = 1;     // +3% trade prices, +1 diplomacy
            effects.reputationGain = 0.5;  // +10% reputation earned
        } else if (score < 30) {
            effects.combatPenalty = -1;    // −5% battle power / personal damage
            effects.charismaPenalty = -1;  // −3% trade prices, −1 diplomacy
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
        if (!this.needs || !this.needsEnabled) return;

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
        this._needHoursToday = 0;
    },
};
