// ============================================
// PLAYER LIFECYCLE — Daily turn, food, kingdom, discovery
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================

import { Hex } from '../../core/hex.js';
import { Technology } from '../../systems/technology.js';
import { Housing } from '../../systems/housing.js';
import { Religion } from '../../systems/religion.js';
import { SettlementServices } from '../settlementServices.js';
import { DAILY_RATION_HUNGER, MEAL_HUNGER } from './needs.js';
import { PlayerMilitary } from '../playerMilitary.js';

export const PlayerLifecycleMethods = {
    /**
     * Consume 1 unit of food (best type first). Returns true if food was consumed.
     */
    consumeFood() {
        this._lastFood = null;
        if (!this.inventory) return false;
        // Player.FOOD_TYPES order — cooked food first, wild foods last
        for (const food of (this.constructor && this.constructor.FOOD_TYPES) || Object.keys(MEAL_HUNGER)) {
            if (this.inventory[food] && this.inventory[food] > 0) {
                this.inventory[food]--;
                if (this.inventory[food] <= 0) delete this.inventory[food];
                // What was eaten (raw rations can bring on the flux — systems/ailments.js)
                this._lastFood = food;
                return true;
            }
        }
        return false;
    },

    /**
     * Rest (end day — restore stamina).
     * `world` is optional; when given, ending the day in a settlement counts
     * as finding rough lodgings rather than sleeping in a ditch.
     */
    endDay(world = null) {
        // The day's wear on needs (minus hours already lived on the inner map)
        this.decayNeedsForDay();

        // Daily food consumption — eat 1 food per day
        if (this.consumeFood()) {
            // Fed — reset starvation counter
            this.starvationDays = 0;
            // Eating food satisfies hunger
            this.modifyNeed('hunger', DAILY_RATION_HUNGER);
        } else if (this.jailState || this.indenturedServitude) {
            // Prisoners and bonded workers get their captors' thin gruel: no
            // starving to death in a cell you can't leave to buy bread
            this.starvationDays = 0;
            this.modifyNeed('hunger', DAILY_RATION_HUNGER / 2);
        } else {
            // No food — increment starvation
            this.starvationDays = (this.starvationDays || 0) + 1;

            // Escalating health loss: 5 + 3 per consecutive day starving
            const starveDmg = 5 + (this.starvationDays * 3);
            this.health = Math.max(0, this.health - starveDmg);
        }

        // A free night restores full stamina — so permanent maxStamina gains
        // (tamed horses, ...) actually lengthen the day's travel. Jail and
        // servitude keep it at zero below.
        if (!this.jailState && !this.indenturedServitude && this.maxStamina > 0) {
            this.stamina = this.maxStamina;
        }

        // Apply technology movement bonus
        let staminaBonus = 0;
        if (typeof Technology !== 'undefined') {
            staminaBonus = Technology.getMovementBonus(this);
        }
        // Housing: stable/road upgrades always help; a night at home restores extra
        staminaBonus += Housing.getTotalBonuses(this).movement + Housing.getHomeStaminaBonus(this);
        // A riding horse and a temple blessing carry you further
        staminaBonus += SettlementServices.movementBonus(this);
        // Scouts in the army find the quick paths
        staminaBonus += PlayerMilitary.getScoutMovementBonus(this);
        this.movementRemaining = this.stamina + staminaBonus;

        // Only regenerate health if not starving
        if (this.starvationDays === 0) {
            this.health = Math.min(this.health + 5 + SettlementServices.healthRegenBonus(this), this.maxHealth);
        }

        // Reduce max stamina while starving (weakened)
        const effectiveStamina = this.starvationDays > 0
            ? Math.max(2, this.stamina - this.starvationDays)
            : this.stamina;
        this.movementRemaining = Math.min(this.movementRemaining, effectiveStamina + staminaBonus);

        // Reset action points
        this.actionPoints = this.maxActionPoints;

        // Reset daily recruitment counter
        this._recruitedThisTurn = 0;

        // Block movement if in jail or servitude
        if (this.jailState) {
            this.movementRemaining = 0;
            this.stamina = 0;
            this.actionPoints = 0;
        }
        if (this.indenturedServitude) {
            this.movementRemaining = 0;
            this.stamina = 0;
            this.actionPoints = 0;
        }

        // ── Overnight needs rest ──
        // Determine rest quality from context
        let restType = 'outdoors';
        if (this.houses && this.houses.length > 0) {
            // Check if player is on a tile with their own house
            const hasHouseHere = this.houses.some(h => h.q === this.q && h.r === this.r);
            if (hasHouseHere) restType = 'ownHouse';
        }
        // A paid inn room (tavern) beats everything; a deliberate camp (Rest /
        // Camp) beats sleeping rough. The override is spent either way.
        const override = this._restTypeOverride;
        this._restTypeOverride = null;
        if (override === 'inn') restType = 'inn';
        else if (restType === 'outdoors' && override) restType = override;
        // Ending the day inside a settlement finds at least a common-room bench
        if (restType === 'outdoors' && world && typeof world.getTile === 'function') {
            const here = world.getTile(this.q, this.r);
            if (here && here.settlement) restType = 'camp';
        }
        this._lastRestType = restType;
        this.restOvernight(restType);

        // Apply mood effects
        const mood = this.getMood();
        if (mood.effects.healthDrain) {
            this.health = Math.max(0, this.health - mood.effects.healthDrain);
        }
        if (mood.effects.movementPenalty) {
            this.movementRemaining = Math.max(1, this.movementRemaining + mood.effects.movementPenalty);
        }

        // Reset daily need tracking
        this.resetDailyNeedTracking();
    },

    /**
     * Pledge allegiance to a kingdom
     * Player can only be pledged to one kingdom at a time
     */
    pledgeAllegiance(kingdomId, world) {
        if (this.allegiance) {
            return { success: false, reason: `Already pledged to ${world.getKingdom(this.allegiance)?.name}` };
        }

        const kingdom = world.getKingdom(kingdomId);
        if (!kingdom) {
            return { success: false, reason: 'Kingdom not found' };
        }

        this.allegiance = kingdomId;
        this.kingdomTitle = 'citizen'; // Default title
        this.title = `Citizen of ${kingdom.name}`;

        return { success: true, kingdom };
    },

    /**
     * Break allegiance with current kingdom
     */
    breakAllegiance(world) {
        if (!this.allegiance) {
            return { success: false, reason: 'Not pledged to any kingdom' };
        }

        const oldKingdom = world.getKingdom(this.allegiance);
        this.allegiance = null;
        this.kingdomTitle = null;
        this.title = 'Nobody';

        return { success: true, oldKingdom };
    },

    /**
     * Set kingdom title (e.g., 'king', 'treasurer', 'lord')
     * This would typically be granted by game events or player actions
     */
    setKingdomTitle(title) {
        if (!this.allegiance) {
            return { success: false, reason: 'Must be pledged to a kingdom first' };
        }

        this.kingdomTitle = title;
        return { success: true };
    },

    /**
     * Discover holy sites within visible radius
     */
    discoverNearbyHolySites(world, radius) {
        const neighbors = Hex.hexesInRange(this.q, this.r, radius);
        for (const { q, r } of neighbors) {
            const tile = world.getTile(q, r);
            if (tile && tile.holySite) {
                const key = `${q},${r}`;
                if (!this.discoveredHolySites.has(key)) {
                    this.discoveredHolySites.add(key);
                    // Also discover the associated extinct faith if applicable
                    if (tile.holySite.faithId && typeof Religion !== 'undefined') {
                        const faith = Religion.FAITHS[tile.holySite.faithId];
                        if (faith && faith.extinct) {
                            this.discoverExtinctFaith(faith.id, tile.holySite.name);
                        }
                    }
                }
            }
        }
    },

    /**
     * Discover an extinct faith by ID
     * @returns {boolean} true if newly discovered
     */
    discoverExtinctFaith(faithId, source) {
        if (!this.discoveredExtinctFaiths) this.discoveredExtinctFaiths = new Set();
        if (this.discoveredExtinctFaiths.has(faithId)) return false;
        this.discoveredExtinctFaiths.add(faithId);
        return true;
    },

    /**
     * Check if the player knows a specific category about a kingdom
     */
    knowsAbout(kingdomId, category) {
        if (!kingdomId) return false;
        if (!this.kingdomKnowledge) this.kingdomKnowledge = {};
        const k = this.kingdomKnowledge[kingdomId];
        if (!k) return false;
        return !!k[category];
    },

    /**
     * Learn something about a kingdom
     * @param {string} kingdomId
     * @param {string|string[]} categories - one or more of: basics, ruler, peoples, religion, military, diplomacy, economy
     * @returns {string[]} newly learned categories
     */
    learnAboutKingdom(kingdomId, categories) {
        if (!kingdomId) return [];
        if (!this.kingdomKnowledge) this.kingdomKnowledge = {};
        if (!this.kingdomKnowledge[kingdomId]) {
            this.kingdomKnowledge[kingdomId] = {};
        }
        const cats = Array.isArray(categories) ? categories : [categories];
        const newlyLearned = [];
        for (const cat of cats) {
            if (!this.kingdomKnowledge[kingdomId][cat]) {
                this.kingdomKnowledge[kingdomId][cat] = true;
                newlyLearned.push(cat);
            }
        }
        return newlyLearned;
    },
};
