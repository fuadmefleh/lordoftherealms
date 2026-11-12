// ============================================
// PLAYER NEEDS — Sims-style needs system
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================
import { DataLoader } from '../../core/dataLoader.js';
import { Grades } from '../../core/grades.js';
import { Hex } from '../../core/hex.js';
import { Terrain } from '../../world/terrain.js';
import { FoodSkills } from '../../systems/foodSkills.js';
import { Endurance } from '../endurance.js';
import { Economy } from '../../world/economy.js';
import { Ledger } from '../../systems/ledger.js';

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
    cooked_meat: 40, cooked_fish: 30, bread: 25, preserved_fish: 25, fish: 20, grain: 15, food: 20, vegetables: 15,
    // Wild foods: they keep you alive, they don't fill you up
    fruit: 15, honey: 15, game_meat: 15,
    // From the gardens and orchards (data/markets.json produce)
    cabbage: 12, turnips: 12, carrots: 10, onions: 8, beans: 18, apples: 12, pears: 12, plums: 10, cherries: 8,
    grapes: 10, olives: 10, dates: 16, eggs: 10, crabs: 12, berries: 10, mushrooms: 10, truffles: 12,
    cactus_fruit: 10, seaweed: 8,
    // From the water's floor (player/diving.js)
    mussels: 10, oysters: 10, crayfish: 10,
};

/**
 * Clothes: how fresh they are (player.clothesFreshness, 0..100). They wear
 * every day and soil with every bit of hygiene lost, and dirty clothes cap
 * hygiene: a bath can't make you smell clean in a shirt you've worn for a
 * fortnight. Washed by the laundry at an inn, B&B or hotel, a valet, or by
 * hand at a river, the shore or a town's well. data/hospitality.json → clothes.
 */
export const CLOTHES_DEFAULTS = {
    dailyWear: 20,       // freshness lost a day just wearing them (smelly in about three days)
    soilShare: 0.4,      // freshness lost per point of hygiene lost
    freshAt: 60,         // at or above this, hygiene is uncapped
    capFloor: 25,        // hygiene cap with filthy clothes (freshness 0)
    levels: [            // labels, highest first
        { min: 75, label: 'Fresh', icon: '👕' },
        { min: 50, label: 'Worn', icon: '👕' },
        { min: 30, label: 'Grubby', icon: '🧦' },
        { min: 0, label: 'Smelly', icon: '🤢' },
    ],
};

/**
 * Bathing (the Bathe action): free in a river, a lake or the sea — cold out
 * of summer — or a few coppers at a village's well or a town's bathhouse.
 * Bathing scrubs the clothes too when they're dirty enough to cap hygiene,
 * so a bath always gets you clean. data/hospitality.json → bathing.
 */
export const BATHING_DEFAULTS = {
    wild: { hygiene: 55, cost: 0, clothes: 80 },
    well: { hygiene: 55, cost: 1, clothes: 80, comfort: 0 },
    bathhouse: { hygiene: 75, cost: 4, clothes: 90, comfort: 8 },
    cold: { Spring: -4, Summer: 0, Autumn: -6, Winter: -14 },
};

function _bathingConfig() {
    const h = DataLoader._gamedata && DataLoader._gamedata.hospitality;
    const c = h && h.bathing;
    return c && typeof c === 'object' ? { ...BATHING_DEFAULTS, ...c } : BATHING_DEFAULTS;
}

function _clothesConfig() {
    const h = DataLoader._gamedata && DataLoader._gamedata.hospitality;
    const c = h && h.clothes;
    return c && typeof c === 'object' ? { ...CLOTHES_DEFAULTS, ...c } : CLOTHES_DEFAULTS;
}

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
            // The furniture you've given it (world/innerMap/furnishing.js homeComfort, already capped)
            if (Number.isFinite(context.homeComfort)) rates.comfort += Math.max(0, context.homeComfort);
        }

        // The hardy tire slower (player/endurance.js)
        if (rates.energy < 0) rates.energy *= Endurance.energyMult(this);
        // Well fed after a practised cook's meal: hunger comes back slower (systems/foodSkills.js)
        if (rates.hunger < 0) rates.hunger *= FoodSkills.hungerDrainMult(this);
        FoodSkills.tickWellFed(this, 1);
        for (const [need, rate] of Object.entries(rates)) {
            this.needs[need] = Math.max(0, Math.min(100, this.needs[need] + rate));
        }
        // An hour's wear on the clothes, and the cap they put on hygiene
        this.soilClothes(_clothesConfig().dailyWear / WAKING_HOURS - Math.min(0, rates.hygiene) * _clothesConfig().soilShare);
        this.needs.hygiene = Math.min(this.needs.hygiene, this.hygieneCap());
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
            this.modifyNeed(need, -amount * fraction * (need === 'energy' ? Endurance.energyMult(this) : need === 'hunger' ? FoodSkills.hungerDrainMult(this) : 1));
        }
        this.wellFed = null; // the well-fed spell lasts the day at most
        this.soilClothes(_clothesConfig().dailyWear * fraction);
        this.modifyNeed('hygiene', 0); // re-apply the clothes' cap
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
                // A practised cook makes more of a cooked ration (systems/foodSkills.js)
                const hunger = Math.round(MEAL_HUNGER[food] * FoodSkills.heartyMult(this, food));
                this.modifyNeed('hunger', hunger);
                this.modifyNeed('comfort', 3);
                const wellFed = FoodSkills.afterEating(this, food);
                return { success: true, food, hunger, wellFed };
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
        if (need === 'hygiene') {
            // Getting dirty dirties the clothes; dirty clothes cap how clean you can be
            if (amount < 0) this.soilClothes(-amount * _clothesConfig().soilShare);
            this.needs.hygiene = Math.min(this.needs.hygiene, this.hygieneCap());
        }
    },

    /** How fresh the clothes are, 0..100 (old saves: fresh). */
    getClothesFreshness() {
        const f = this.clothesFreshness;
        return typeof f === 'number' && Number.isFinite(f) ? Math.max(0, Math.min(100, f)) : 100;
    },

    /** Wear and dirt on the clothes (good clothes in the pack wear slower: their grade's effect — core/grades.js). */
    soilClothes(amount) {
        if (!this.needsEnabled || !(amount > 0)) return;
        this.clothesFreshness = Math.max(0, this.getClothesFreshness() - amount / this.clothesDurability());
    },

    /** How well the best clothes carried hold up: the best grade's effect (1 without any graded clothes). */
    clothesDurability() {
        const C = DataLoader._gamedata && DataLoader._gamedata.craftGrades;
        const kinds = (C && Array.isArray(C.clothing)) ? C.clothing : ['clothes'];
        const best = Grades.bestOf(this, kinds);
        return best ? Math.max(0.5, Grades.effectMult(best.index)) : 1;
    },

    /**
     * Wash the clothes up to `freshness` (never makes them dirtier).
     * Returns the freshness gained.
     */
    washClothes(freshness = 100) {
        const before = this.getClothesFreshness();
        this.clothesFreshness = Math.max(before, Math.min(100, freshness));
        return this.clothesFreshness - before;
    },

    /** The highest hygiene the clothes allow: 100 when fresh enough, down to capFloor when filthy. */
    hygieneCap() {
        const C = _clothesConfig();
        const f = this.getClothesFreshness();
        if (f >= C.freshAt) return 100;
        return Math.round(C.capFloor + (100 - C.capFloor) * (f / C.freshAt) ** 2);
    },

    /** Where clothes can be washed by hand here: 'the river', 'the shore', 'the town well', or null. */
    washWaterHere(world) {
        const tile = world && world.getTile(this.q, this.r);
        if (!tile || !tile.terrain || !tile.terrain.passable) return null;
        if (tile.hasRiver) return 'the river';
        for (const n of Hex.neighbors(this.q, this.r)) {
            const nb = world.getTile(n.q, n.r);
            if (nb && nb.terrain && Terrain.isWaterId(nb.terrain.id)) return 'the shore';
        }
        if (tile.settlement) return 'the town well';
        return null;
    },

    /** Scrub the clothes by hand at water (the Wash Clothes action). Returns { success, where, gained } or { success: false, reason }. */
    washClothesByHand(world) {
        const where = this.washWaterHere(world);
        if (!where) return { success: false, reason: 'There is no water here to wash in.' };
        const C = _clothesConfig();
        // A cake of soap scrubs them cleaner (its grade: how much — core/grades.js)
        const soap = this.getClothesFreshness() < 100 ? this.useSoap() : null;
        const gained = this.washClothes((typeof C.washByHand === 'number' ? C.washByHand : 80) + (soap ? soap.clothes : 0));
        if (!(gained > 0)) return { success: false, reason: 'Your clothes are as clean as scrubbing will get them.' };
        this.modifyNeed('comfort', -4); // damp clothes
        return { success: true, where, gained: Math.round(gained), soap: !!soap };
    },

    /**
     * Use a cake of soap from the pack (the best first) → { hygiene, clothes }
     * the extra it gives (data/craftGrades.json soap × its grade's effect), or
     * null when there is none.
     */
    useSoap() {
        if (!(this.inventory && this.inventory.soap > 0)) return null;
        const D = (DataLoader._gamedata && DataLoader._gamedata.craftGrades && DataLoader._gamedata.craftGrades.soap) || {};
        const fx = Grades.remove(this, 'soap', 1, { order: 'best' }).effect;
        return { hygiene: Math.round((typeof D.hygiene === 'number' ? D.hygiene : 15) * fx), clothes: Math.round((typeof D.clothes === 'number' ? D.clothes : 15) * fx) };
    },

    /**
     * Where the player can bathe here: { kind: 'wild'|'well'|'bathhouse',
     * where, label, cost } or null. A town has a bathhouse, a village its
     * well; out of town, a river, a lake or the shore.
     */
    bathePlace(world) {
        const where = this.washWaterHere(world);
        if (!where) return null;
        const B = _bathingConfig();
        const tile = world.getTile(this.q, this.r);
        const s = tile && tile.settlement;
        if (s && where === 'the town well') {
            const kind = s.type === 'village' ? 'well' : 'bathhouse';
            return {
                kind, where: kind === 'well' ? `the well in ${s.name}` : `the bathhouse in ${s.name}`,
                label: kind === 'well' ? 'Wash at the Well' : 'Visit the Bathhouse',
                cost: Math.max(0, Math.round((B[kind] || {}).cost || 0)),
            };
        }
        const lake = where === 'the shore' && world && Hex.neighbors(this.q, this.r).some(n => {
            const nb = world.getTile(n.q, n.r);
            return nb && nb.terrain && nb.terrain.id === 'lake';
        });
        const water = where === 'the river' ? 'the river' : lake ? 'the lake' : 'the sea';
        return { kind: 'wild', where: water, label: `Bathe in ${water}`, cost: 0 };
    },

    /**
     * Bathe (the Bathe action): pay if it's a well or bathhouse, scrub the
     * clothes when they'd cap you, then wash. Cold water out of summer is
     * a shock. → { success, where, kind, cost, gained, clothes, cold } or
     * { success: false, reason }.
     */
    bathe(world) {
        const place = this.bathePlace(world);
        if (!place) return { success: false, reason: 'There is no water here to bathe in.' };
        if (!this.needs) return { success: false, reason: 'You feel clean enough.' };
        if ((this.gold || 0) < place.cost) return { success: false, reason: `It costs ${place.cost} gold.` };
        const B = _bathingConfig();
        const spec = B[place.kind] || BATHING_DEFAULTS[place.kind];
        if (place.cost > 0) {
            // The well's keeper or the bathhouse is the town's: the coin goes to its purse
            this.gold -= place.cost;
            const here = world.getTile(this.q, this.r);
            Economy.payTown(here && here.settlement, place.cost);
            Ledger.record(this, 'lodging', -place.cost);
        }
        // Soap in the pack: a cleaner bath and cleaner clothes (core/grades.js)
        const soap = this.useSoap();
        // Dirty clothes would cap the bath: they get scrubbed first
        let clothes = 0;
        if (this.getClothesFreshness() < (_clothesConfig().freshAt || 60)) clothes = this.washClothes((spec.clothes || 80) + (soap ? soap.clothes : 0));
        const before = this.needs.hygiene;
        this.modifyNeed('hygiene', (spec.hygiene || 50) + (soap ? soap.hygiene : 0));
        let cold = 0;
        if (place.kind === 'wild') {
            const season = (world && world.season) || 'Summer';
            cold = Math.round(((B.cold || {})[season]) || 0);
        } else {
            cold = Math.round(spec.comfort || 0);
        }
        if (cold) this.modifyNeed('comfort', cold);
        return { success: true, where: place.where, kind: place.kind, cost: place.cost, gained: Math.round(this.needs.hygiene - before), clothes: Math.round(clothes), cold, soap: !!soap };
    },

    /** { freshness, label, icon, cap, smelly } for the HUD and panels. */
    clothesState() {
        const C = _clothesConfig();
        const freshness = Math.round(this.getClothesFreshness());
        const lv = (C.levels || CLOTHES_DEFAULTS.levels).find(l => freshness >= l.min) || CLOTHES_DEFAULTS.levels[3];
        return { freshness, label: lv.label, icon: lv.icon, cap: this.hygieneCap(), capped: freshness < C.freshAt, smelly: freshness < C.smellyBelow };
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
        }[restType] * Endurance.recoveryMult(this) || 25;

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
