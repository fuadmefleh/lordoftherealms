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

// Multi-generational Ambitions. Predicates are code (they read live game
// state), so the catalog lives here rather than in data. Each milestone/
// capstone predicate receives a flat `metrics` object (see House._metrics).
// Descriptive text can still be overridden via DataLoader.house.ambitionText.
const AMBITIONS = [
    {
        id: 'seat_of_power',
        name: 'Seat of Power',
        blurb: 'Carve out a realm of your own.',
        milestones: [
            { id: 'title', label: 'Hold a royal office', test: m => m.hasTitle },
            { id: 'army', label: 'Field an army of strength 100', test: m => m.armyStrength >= 100 },
            { id: 'first_hold', label: 'Seize your first settlement', test: m => m.settlementsHeld >= 1 },
        ],
        capstone: { id: 'realm', label: 'Hold three settlements', test: m => m.settlementsHeld >= 3 },
    },
    {
        id: 'faith_eternal',
        name: 'Faith Eternal',
        blurb: 'Spread a faith that outlives you.',
        milestones: [
            { id: 'found', label: 'Found a religion', test: m => m.hasReligion },
            { id: 'flock', label: 'Gather 1,000 followers', test: m => m.followers >= 1000 },
            { id: 'temples', label: 'Raise 3 temples', test: m => m.temples >= 3 },
        ],
        capstone: { id: 'eternal', label: '5,000 followers and 5 temples', test: m => m.followers >= 5000 && m.temples >= 5 },
    },
    {
        id: 'merchant_dynasty',
        name: 'Merchant Dynasty',
        blurb: 'Dominate the flow of coin.',
        milestones: [
            { id: 'estates', label: 'Own 5 properties', test: m => m.properties >= 5 },
            { id: 'routes', label: 'Run 3 trade routes', test: m => m.tradeRoutes >= 3 },
            { id: 'coffers', label: 'Amass 25,000 gold', test: m => m.gold >= 25000 },
        ],
        capstone: { id: 'monopoly', label: '50,000 gold and 5 trade routes', test: m => m.gold >= 50000 && m.tradeRoutes >= 5 },
    },
    {
        id: 'bloodline_of_kings',
        name: 'Bloodline of Kings',
        blurb: 'Weave your blood through the realms.',
        milestones: [
            { id: 'wed', label: 'Marry', test: m => m.married },
            { id: 'heirs2', label: 'Raise 2 children', test: m => m.children >= 2 },
            { id: 'heirs4', label: 'Raise 4 children', test: m => m.children >= 4 },
        ],
        capstone: { id: 'dynasty', label: '4 children across 2 generations', test: m => m.children >= 4 && m.generation >= 2 },
    },
    {
        id: 'the_great_house',
        name: 'The Great House',
        blurb: 'Build a name that endures the ages.',
        milestones: [
            { id: 'prestige50', label: 'Reach 50 Prestige', test: m => m.prestige >= 50 },
            { id: 'holdings8', label: 'Own 8 properties', test: m => m.properties >= 8 },
            { id: 'gen2', label: 'Survive into a 2nd generation', test: m => m.generation >= 2 },
        ],
        capstone: { id: 'great', label: '150 Prestige across 3 generations', test: m => m.prestige >= 150 && m.generation >= 3 },
    },
];

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
            stats: {},              // durable deed counters (ambition predicates read these)
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
        // Durable counter for ambition predicates and scoring.
        house.stats = house.stats || {};
        house.stats[deedId] = (house.stats[deedId] || 0) + count;
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

    // ── Ambitions (multi-generational goals) ────────────────────

    /** The catalog, for the ambition-choice UI. */
    ambitions() {
        return AMBITIONS.map(a => ({ id: a.id, name: a.name, blurb: a.blurb }));
    },

    _getAmbitionDef(id) {
        return AMBITIONS.find(a => a.id === id) || null;
    },

    /** Set the House's single active ambition. Returns the progress object or null. */
    chooseAmbition(house, id, day) {
        if (!house) return null;
        const def = House._getAmbitionDef(id);
        if (!def) return null;
        house.ambition = {
            id: def.id,
            chosenDay: day != null ? day : (house.foundedDay || 0),
            milestones: def.milestones.map(m => ({ id: m.id, done: false, day: null })),
            capstoneDone: false,
        };
        return house.ambition;
    },

    _countTemples(player) {
        const b = player && player.religion && player.religion.buildings;
        if (!Array.isArray(b)) return 0;
        return b.filter(x => {
            const t = (x.typeId || x.type || x.id || '').toString().toLowerCase();
            return t.includes('temple') || t.includes('cathedral');
        }).length;
    },

    /** Flatten the game state an ambition predicate needs into one object. */
    _metrics(player, world) {
        const house = player.house || {};
        const army = player.army || [];
        return {
            prestige: house.prestige || 0,
            generation: house.generation || 1,
            gold: player.gold || 0,
            renown: player.renown || 0,
            properties: (player.properties || []).length,
            tradeRoutes: (player.tradeRoutes || []).length,
            armyStrength: army.reduce((s, u) => s + (u.strength || 0), 0),
            hasTitle: !!player.currentTitle,
            hasReligion: !!player.religion,
            followers: (player.religion && player.religion.followers) || 0,
            temples: House._countTemples(player),
            children: (player.children || []).length,
            married: !!player.marriageDay,
            settlementsHeld: ((house.stats && house.stats.settlementHeld) || 0)
                + (house.holdings && house.holdings.settlements || 0),
        };
    },

    /**
     * Evaluate the active ambition against live state. Marks newly-completed
     * milestones (awarding Prestige + a chronicle entry) and detects the
     * capstone. Returns { milestonesCompleted:[ids], capstoneCompleted:bool,
     * ambitionId } or null if there is no active ambition.
     */
    evaluateAmbition(player, world) {
        const house = player && player.house;
        if (!house || !house.ambition) return null;
        const def = House._getAmbitionDef(house.ambition.id);
        if (!def) return null;

        const m = House._metrics(player, world);
        const out = { ambitionId: def.id, milestonesCompleted: [], capstoneCompleted: false };
        const day = world && world.day;

        for (const ms of house.ambition.milestones) {
            if (ms.done) continue;
            const msDef = def.milestones.find(x => x.id === ms.id);
            if (msDef && msDef.test(m)) {
                ms.done = true;
                ms.day = day != null ? day : 0;
                House.recordDeed(house, world, 'ambitionMilestone', {
                    reason: `${def.name}: ${msDef.label}`,
                    chronicle: `${house.name} advances "${def.name}" — ${msDef.label}.`,
                    tags: ['ambition', def.id],
                });
                out.milestonesCompleted.push(ms.id);
            }
        }

        if (!house.ambition.capstoneDone && def.capstone.test(m)) {
            house.ambition.capstoneDone = true;
            out.capstoneCompleted = true;
            House._chronicle(house, world,
                `${house.name} fulfils its great ambition: ${def.name}!`, ['ambition', 'capstone', def.id]);
        }

        return out;
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
        const ambition = House.evaluateAmbition(player, world);
        if (ambition && (ambition.milestonesCompleted.length || ambition.capstoneCompleted)) {
            results.ambition = ambition;
        }
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
