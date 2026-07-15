// ============================================
// THE HOUSE — Dynasty spine (Spec 1)
// ============================================
// The player is the current *head* of a persistent House that outlives any
// single character. This module owns the House entity, the Prestige currency,
// multi-generational Ambitions, family roles, and rival-House feuds.
//
// Phase 0 (this commit): scaffolding only — a blank House is created at game
// start, ticks as a no-op each day, and round-trips through save/load. No
// Prestige sources/sinks, ambitions, succession stakes, or bonuses yet; those
// arrive in later phases. Behaviour is intentionally invisible in-game.
//
// Determinism: no module has import-time side effects and nothing here draws
// from Utils' RNG during initialize() (that would perturb the shared seed
// stream during world/player creation). Randomised outcomes in later phases
// flow through Utils.* per the repo's hard rules.

import { Utils } from '../core/utils.js';

// The five family-role slots. Each holds a family-member id (or null).
const ROLE_IDS = ['steward', 'marshal', 'chancellor', 'spymaster', 'heir'];

export const House = {

    ROLE_IDS,

    // ── Construction ────────────────────────────────────────────

    /**
     * Build a blank House. Deterministic — derives its id from stable player
     * fields rather than RNG so it never disturbs world/player generation.
     */
    _blankHouse(player, world) {
        const lastName = (player && player.lastName) ? player.lastName : '';
        const foundedDay = (world && world.day) ? world.day : 0;
        return {
            id: `house_${(lastName || 'player').toLowerCase().replace(/\s+/g, '_')}`,
            name: lastName ? `House ${lastName}` : 'Your House',
            motto: '',
            sigil: { icon: '🛡️', color: '#c9a227' },
            foundedDay,

            // Prestige — the dynastic currency (fed/spent in later phases).
            prestige: 0,
            prestigeLog: [],        // recent { day, delta, reason }, capped
            lastNotableDay: foundedDay,

            headId: (player && player.id) || null,
            generation: 1,

            ambition: null,         // one active ambition (Phase 3)
            roles: ROLE_IDS.reduce((acc, id) => { acc[id] = null; return acc; }, {}),
            holdings: {},           // derived snapshot for scoring/fragmentation
            rivals: {},             // { houseKey: { feud, lastActedDay } }
            history: [],            // { day, generation, text, tags[] } chronicle
        };
    },

    /**
     * Ensure the player has a House. Called once during game setup, after the
     * relationships system is initialized. Idempotent.
     */
    initialize(player, world) {
        if (!player) return null;
        if (!player.house) {
            player.house = House._blankHouse(player, world);
        }
        return player.house;
    },

    // ── Daily tick ──────────────────────────────────────────────

    /**
     * Advance the House one day. Phase 0: no-op. Later phases apply Prestige
     * decay, evaluate ambitions, drift role loyalty, and accrue rival feuds.
     * @returns {object} a results bag for the UI layer (empty for now).
     */
    processDaily(player, world) {
        if (!player || !player.house) return {};
        return {};
    },

    // ── Persistence ─────────────────────────────────────────────

    /**
     * Serialize the House to plain JSON-safe data. Phase 0 state is already
     * plain, so this is a shallow structured copy; later phases that introduce
     * Sets/Maps convert them here.
     */
    serialize(house) {
        if (!house) return null;
        return {
            id: house.id,
            name: house.name,
            motto: house.motto,
            sigil: house.sigil,
            foundedDay: house.foundedDay,
            prestige: house.prestige,
            prestigeLog: house.prestigeLog || [],
            lastNotableDay: house.lastNotableDay,
            headId: house.headId,
            generation: house.generation,
            ambition: house.ambition,
            roles: house.roles,
            holdings: house.holdings || {},
            rivals: house.rivals || {},
            history: house.history || [],
        };
    },

    /**
     * Restore the House from save data onto the player. Missing/legacy saves
     * get a fresh blank House so older saves keep loading.
     */
    deserialize(player, world, data) {
        if (!player) return null;
        if (!data) {
            player.house = House._blankHouse(player, world);
            return player.house;
        }
        const blank = House._blankHouse(player, world);
        player.house = {
            ...blank,
            ...data,
            sigil: { ...blank.sigil, ...(data.sigil || {}) },
            roles: { ...blank.roles, ...(data.roles || {}) },
        };
        return player.house;
    },
};
