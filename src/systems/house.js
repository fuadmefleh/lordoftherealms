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
import { DataLoader } from '../core/dataLoader.js';

// The five family-role slots. Each holds a family-member id (or null).
const ROLE_IDS = ['steward', 'marshal', 'chancellor', 'spymaster', 'heir'];

// Prestige tuning. Source of truth lives here (Housing-style defensive
// defaults); `DataLoader.house.config` overrides individual keys in-game so the
// values stay moddable without a hard dependency on the data pipeline in tests.
const CONFIG = {
    idleWindow: 90,     // days without a notable deed before Prestige decays
    decayPerDay: 1,     // Prestige eroded per idle day
    logCap: 30,         // max recent prestigeLog entries retained
    historyCap: 200,    // max chronicle entries retained
};

// Prestige awarded per notable deed. Every hooked system feeds this table, so
// unrelated systems (war, faith, titles, quests) all contribute to one
// dynastic score — the mechanism that makes them relate. Moddable via
// DataLoader.house.sources.
const SOURCES = {
    quest: 3,
    contract: 2,
    battleWon: 4,
    titleGained: 6,
    settlementHeld: 12,
    religionFounded: 15,
    artifactReforged: 10,
    ambitionMilestone: 10,  // used from Phase 3
};

// Prestige costs for things gold cannot buy. Moddable via DataLoader.house.sinks.
const SINKS = {
    pressClaim: 15,
    prestigiousMarriage: 10,
    callInFavor: 8,
    secureSuccession: 20,    // used from Phase 4
};

export const House = {

    ROLE_IDS,

    _getConfig() {
        const override = (typeof DataLoader !== 'undefined' && DataLoader.house && DataLoader.house.config)
            ? DataLoader.house.config : null;
        return override ? { ...CONFIG, ...override } : CONFIG;
    },

    _getSources() {
        const override = (typeof DataLoader !== 'undefined' && DataLoader.house && DataLoader.house.sources)
            ? DataLoader.house.sources : null;
        return override ? { ...SOURCES, ...override } : SOURCES;
    },

    _getSinks() {
        const override = (typeof DataLoader !== 'undefined' && DataLoader.house && DataLoader.house.sinks)
            ? DataLoader.house.sinks : null;
        return override ? { ...SINKS, ...override } : SINKS;
    },

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
            House._chronicle(player.house, world, `${player.house.name} enters history.`, ['founding']);
        }
        return player.house;
    },

    /**
     * Found or re-style the House — set its name, motto, and sigil. Called from
     * the founding/rename dialog. Ensures the House exists first, so it is safe
     * to call before or after initialize().
     */
    found(player, world, { name, motto, sigil } = {}) {
        const house = House.initialize(player, world);
        if (name) {
            const trimmed = String(name).trim();
            house.name = /^house\s/i.test(trimmed) ? trimmed : `House ${trimmed}`;
        }
        if (motto != null) house.motto = String(motto);
        if (sigil) house.sigil = { ...house.sigil, ...sigil };
        return house;
    },

    // ── Prestige — the dynastic currency ────────────────────────

    /**
     * Award Prestige for a notable deed. Positive amounts only; resets the
     * idle-decay clock. Returns the new Prestige total.
     */
    award(house, amount, reason, day) {
        if (!house || !(amount > 0)) return house ? house.prestige : 0;
        house.prestige += amount;
        House._touch(house, day);
        House._logPrestige(house, day, amount, reason);
        return house.prestige;
    },

    /**
     * Spend Prestige on something gold cannot buy (claim, prestigious marriage,
     * secured succession, …). Returns false and changes nothing if the House
     * cannot afford it. Spending counts as House activity (resets decay clock).
     */
    spend(house, amount, reason, day) {
        if (!house || !(amount > 0)) return false;
        if (house.prestige < amount) return false;
        house.prestige -= amount;
        House._touch(house, day);
        House._logPrestige(house, day, -amount, reason);
        return true;
    },

    /**
     * Erode Prestige once the House has gone `idleWindow` days without a notable
     * deed. Returns the amount decayed (0 if not idle or already at zero).
     */
    applyDecay(house, day) {
        if (!house || house.prestige <= 0) return 0;
        const cfg = House._getConfig();
        const idle = (day || 0) - (house.lastNotableDay || 0);
        if (idle <= cfg.idleWindow) return 0;
        const dec = Math.min(house.prestige, cfg.decayPerDay);
        house.prestige -= dec;
        if (dec > 0) House._logPrestige(house, day, -dec, 'decay');
        return dec;
    },

    _touch(house, day) {
        if (day != null) house.lastNotableDay = day;
    },

    _logPrestige(house, day, delta, reason) {
        const cfg = House._getConfig();
        house.prestigeLog = house.prestigeLog || [];
        house.prestigeLog.push({ day: day != null ? day : 0, delta, reason: reason || '' });
        if (house.prestigeLog.length > cfg.logCap) {
            house.prestigeLog = house.prestigeLog.slice(-cfg.logCap);
        }
    },

    /** Append an entry to the generational chronicle (also the LLM memory seam). */
    _chronicle(house, world, text, tags) {
        const cfg = House._getConfig();
        house.history = house.history || [];
        house.history.push({
            day: (world && world.day) || 0,
            generation: house.generation || 1,
            text,
            tags: tags || [],
        });
        if (house.history.length > cfg.historyCap) {
            house.history = house.history.slice(-cfg.historyCap);
        }
    },

    // ── Prestige sources & sinks ────────────────────────────────

    /**
     * Record a notable deed and award its Prestige. `deedId` keys the SOURCES
     * table; unknown deeds award nothing. opts: { count, scale, reason,
     * chronicle, tags }. Returns the Prestige awarded.
     */
    recordDeed(house, world, deedId, opts = {}) {
        if (!house) return 0;
        const base = House._getSources()[deedId];
        if (!(base > 0)) return 0;
        const count = opts.count != null ? opts.count : 1;
        const scale = opts.scale != null ? opts.scale : 1;
        const amount = Math.round(base * count * scale);
        if (amount <= 0) return 0;
        const day = world && world.day;
        House.award(house, amount, opts.reason || deedId, day);
        if (opts.chronicle) House._chronicle(house, world, opts.chronicle, opts.tags || [deedId]);
        return amount;
    },

    /** Convenience: record a deed straight from a player (no-op without a House). */
    recordPlayerDeed(player, world, deedId, opts = {}) {
        if (!player || !player.house) return 0;
        return House.recordDeed(player.house, world, deedId, opts);
    },

    /**
     * Pay a Prestige sink. Returns { success, cost, remaining } or
     * { success:false, reason }. opts: { cost (override), chronicle, tags }.
     */
    _paySink(player, world, sinkId, opts = {}) {
        const house = player && player.house;
        if (!house) return { success: false, reason: 'No House' };
        const cost = opts.cost != null ? opts.cost : House._getSinks()[sinkId];
        if (!(cost >= 0)) return { success: false, reason: 'Unknown sink' };
        const day = world && world.day;
        if (!House.spend(house, cost, sinkId, day)) {
            return { success: false, reason: 'Not enough Prestige', cost, have: house.prestige };
        }
        if (opts.chronicle) House._chronicle(house, world, opts.chronicle, opts.tags || [sinkId]);
        return { success: true, cost, remaining: house.prestige };
    },

    pressClaim(player, world, opts = {}) {
        return House._paySink(player, world, 'pressClaim', opts);
    },
    arrangePrestigiousMarriage(player, world, opts = {}) {
        return House._paySink(player, world, 'prestigiousMarriage', opts);
    },
    callInFavor(player, world, opts = {}) {
        return House._paySink(player, world, 'callInFavor', opts);
    },
    secureSuccession(player, world, opts = {}) {
        return House._paySink(player, world, 'secureSuccession', opts);
    },

    // ── Daily tick ──────────────────────────────────────────────

    /**
     * Advance the House one day. Applies Prestige decay. Later phases add
     * ambition evaluation, role-loyalty drift, and rival-feud accrual.
     * @returns {object} a results bag for the UI layer.
     */
    processDaily(player, world) {
        if (!player || !player.house) return {};
        const day = (world && world.day) || 0;
        const results = {};
        const decayed = House.applyDecay(player.house, day);
        if (decayed > 0) results.prestigeDecayed = decayed;
        return results;
    },

    // ── Persistence ─────────────────────────────────────────────

    /**
     * Serialize the House to plain JSON-safe data. Phase 0 state is already
     * plain, so this is a shallow structured copy; later phases that introduce
     * Sets/Maps convert them here.
     */
    serialize(house) {
        if (!house) return null;
        // House state is plain JSON-safe data (no Sets/Maps yet), so a deep
        // structured clone is both correct and robust as fields are added in
        // later phases. When Sets/Maps arrive, convert them here.
        return JSON.parse(JSON.stringify(house));
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
