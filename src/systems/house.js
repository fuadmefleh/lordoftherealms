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
import { Ledger } from './ledger.js';

// The five family-role slots. Each holds a family-member id (or null).
const ROLE_IDS = ['steward', 'marshal', 'chancellor', 'spymaster', 'heir'];

// The tables below are the House's content and tuning. data/house.json is the
// source of truth (`config`, `roles`, `sources`, `sourceScales`, `sinks`,
// `ambitions`); these constants are identical defensive defaults, used when
// the data pipeline isn't loaded (unit tests, standalone tools), and each data
// table is laid over them key by key. `DataLoader.house.<table>` (a runtime /
// mod override) is laid over both, last.
const CONFIG = {
    idleWindow: 90,     // days without a notable deed before Prestige decays
    decayPerDay: 1,     // Prestige eroded per idle day
    logCap: 30,         // max recent prestigeLog entries retained
    historyCap: 600,    // max chronicle entries retained (the Annals read back every generation's)
    wealthMarkDays: 30, // the Annals' wealth curve: one mark of the purse a season
    wealthMarkCap: 240, // marks kept (older ones thinned to every other)
    roleBaseLoyalty: 60,          // starting loyalty for a newly-appointed relative
    roleLoyaltyDriftDays: 60,     // cadence of loyalty drift
    roleDisloyaltyThreshold: 25,  // below this, a passed-over relative may press a claim
    rivalFeudDecayDays: 30,       // cadence at which feuds cool
    rivalFeudDecay: 1,            // feud shed per decay tick
    rivalActionCadence: 45,       // cadence at which a rival may move
    rivalClaimFeud: 60,           // feud at/above which a rival may threaten a claim
};

// Family-role definitions: which member skill each office scales off, plus
// display text for the assignment UI.
const ROLE_DEFS = {
    steward:    { label: 'Steward',    skill: 'commerce',   blurb: 'Runs the estates — raises property income.' },
    marshal:    { label: 'Marshal',    skill: 'combat',     blurb: 'Commands the host — lowers army upkeep.' },
    chancellor: { label: 'Chancellor', skill: 'diplomacy',  blurb: 'Holds the court — improves diplomacy.' },
    spymaster:  { label: 'Spymaster',  skill: 'stealth',    blurb: 'Runs the shadows — aids espionage.' },
    heir:       { label: 'Heir',       skill: 'leadership', blurb: 'Groomed to inherit the House.' },
};

// Prestige awarded per notable deed. Every hooked system feeds this table, so
// unrelated systems (war, faith, titles, quests) all contribute to one
// dynastic score — the mechanism that makes them relate.
const SOURCES = {
    quest: 3,
    contract: 2,
    battleWon: 4,
    titleGained: 6,
    settlementHeld: 12,
    religionFounded: 15,
    templeRaised: 4,        // a temple or monastery of the House's faith (PlayerReligion.buildReligiousBuilding)
    miracle: 2,             // PlayerReligion.performMiracle (scaled per miracle by sourceScales.miracle)
    artifactReforged: 10,   // a legendary artifact made whole (LegendaryArtifacts.reforgeArtifact)
    nobleMarriage: 8,
    festivalHosted: 3,      // Festivals.hostFestival (scaled by budget tier)
    achievement: 2,         // a deed for the records (Achievements.checkAchievements, scaled by tier)
    ambitionMilestone: 10,  // used from Phase 3
};

// Per-deed multipliers by kind: House.deedScale(deedId, kind). A kind not
// listed scales 1; a 0 awards nothing (a plague called down is no glory).
const SOURCE_SCALES = {
    miracle: { plague: 0, smite: 0.5, resurrection: 3, revelation: 1.5 },
    festivalHosted: { modest: 1, fine: 1.5, grand: 2.5 },
    achievement: { bronze: 1, silver: 2, gold: 4, legendary: 8 },
};

// Prestige costs for things gold cannot buy.
const SINKS = {
    pressClaim: 15,
    prestigiousMarriage: 10,
    callInFavor: 8,
    secureSuccession: 20,    // used from Phase 4
};

// Multi-generational Ambitions. These five are the first tier, kept as the
// fallback when data is missing; data/house.json `ambitions` restates them
// (with their rewards) and adds the tiers that follow (each entry's
// `requires` names the ambition it succeeds). Milestones are `req` maps over
// the flat `metrics` object (see House._metrics) — so a new tier is data only.
const AMBITIONS = [
    {
        id: 'seat_of_power',
        tier: 1,
        name: 'Seat of Power',
        blurb: 'Carve out a realm of your own.',
        milestones: [
            { id: 'title', label: 'Hold a royal office', req: { hasTitle: true } },
            { id: 'army', label: 'Field an army of strength 100', req: { armyStrength: 100 } },
            { id: 'first_hold', label: 'Seize your first settlement', req: { settlementsHeld: 1 } },
        ],
        capstone: { id: 'realm', label: 'Hold three settlements', req: { settlementsHeld: 3 } },
    },
    {
        id: 'faith_eternal',
        tier: 1,
        name: 'Faith Eternal',
        blurb: 'Spread a faith that outlives you.',
        milestones: [
            { id: 'found', label: 'Found a religion', req: { hasReligion: true } },
            { id: 'flock', label: 'Gather 1,000 followers', req: { followers: 1000 } },
            { id: 'temples', label: 'Raise 3 temples', req: { temples: 3 } },
        ],
        capstone: { id: 'eternal', label: '5,000 followers and 5 temples', req: { followers: 5000, temples: 5 } },
    },
    {
        id: 'merchant_dynasty',
        tier: 1,
        name: 'Merchant Dynasty',
        blurb: 'Dominate the flow of coin.',
        milestones: [
            { id: 'estates', label: 'Own 5 properties', req: { properties: 5 } },
            { id: 'routes', label: 'Run 3 trade routes', req: { tradeRoutes: 3 } },
            { id: 'coffers', label: 'Amass 25,000 gold', req: { gold: 25000 } },
        ],
        capstone: { id: 'monopoly', label: '50,000 gold and 5 trade routes', req: { gold: 50000, tradeRoutes: 5 } },
    },
    {
        id: 'bloodline_of_kings',
        tier: 1,
        name: 'Bloodline of Kings',
        blurb: 'Weave your blood through the realms.',
        milestones: [
            { id: 'wed', label: 'Marry', req: { married: true } },
            { id: 'heirs2', label: 'Raise 2 children', req: { children: 2 } },
            { id: 'heirs4', label: 'Raise 4 children', req: { children: 4 } },
        ],
        capstone: { id: 'dynasty', label: '4 children across 2 generations', req: { children: 4, generation: 2 } },
    },
    {
        id: 'the_great_house',
        tier: 1,
        name: 'The Great House',
        blurb: 'Build a name that endures the ages.',
        milestones: [
            { id: 'prestige50', label: 'Reach 50 Prestige', req: { prestige: 50 } },
            { id: 'holdings8', label: 'Own 8 properties', req: { properties: 8 } },
            { id: 'gen2', label: 'Survive into a 2nd generation', req: { generation: 2 } },
        ],
        capstone: { id: 'great', label: '150 Prestige across 3 generations', req: { prestige: 150, generation: 3 } },
    },
];

/** A predicate from a data `req` map: every metric at least its value (true = the flag is set). */
function _reqTest(req) {
    const entries = Object.entries(req || {});
    return m => entries.length > 0 && entries.every(([k, v]) => (v === true ? !!m[k] : v === false ? !m[k] : (m[k] || 0) >= v));
}

function _compileStep(step) {
    if (!step || !step.id) return null;
    return { ...step, label: step.label || step.id, test: typeof step.test === 'function' ? step.test : _reqTest(step.req) };
}

let _catalogSrc;
let _catalog = null;

/** The full ambition catalog: the code tier, overlaid and extended by data/house.json. */
function _ambitionCatalog() {
    const gd = DataLoader._gamedata;
    const src = gd && gd.house && Array.isArray(gd.house.ambitions) ? gd.house.ambitions : null;
    if (_catalog && src === _catalogSrc) return _catalog;
    _catalogSrc = src;
    const out = AMBITIONS.map(a => ({ ...a, milestones: a.milestones.map(_compileStep), capstone: _compileStep(a.capstone) }));
    for (const d of src || []) {
        if (!d || !d.id) continue;
        const base = out.find(a => a.id === d.id);
        const milestones = Array.isArray(d.milestones) ? d.milestones.map(_compileStep).filter(Boolean) : null;
        const capstone = d.capstone ? _compileStep(d.capstone) : null;
        if (base) {
            Object.assign(base, { ...d, milestones: milestones || base.milestones, capstone: capstone || base.capstone });
        } else if (milestones && capstone) {
            out.push({ tier: 2, name: d.id, blurb: '', ...d, milestones, capstone });
        }
    }
    _catalog = out;
    return out;
}

// ── The "brain" seam (Spec 2 readiness) ─────────────────────────
// Rival/claim decisions and narration route through a swappable provider whose
// default is this deterministic rule engine. Spec 2 replaces it via
// House.setBrain(llmProvider) to give rivals a voice and propose actions from a
// fixed menu — without touching any call site. The engine stays authoritative:
// it draws the RNG and validates, the brain only *decides/narrates*.
const DEFAULT_BRAIN = {
    // ctx: { rival, config, roll, house, world } → { act: boolean, type }
    decideRivalAction(ctx) {
        const feud = (ctx.rival && ctx.rival.feud) || 0;
        const act = feud >= ctx.config.rivalClaimFeud && ctx.roll < feud / 200;
        return { act, type: 'claim_threat' };
    },
    // ctx: { rival, options: schemeTypeId[] (mildest first), roll, house, world }
    // → one of ctx.options. The engine validates the pick (see Schemes._plot).
    chooseScheme(ctx) {
        const opts = ctx.options || [];
        return opts[Math.min(opts.length - 1, Math.floor((ctx.roll || 0) * opts.length))];
    },
    // ctx: { rival, options: [{ id, worth, about }] (only errands worth
    // something today, in a fixed order), roll, house, world } → an option id,
    // drawn by worth. The engine validates the pick (RivalHouses._choose).
    chooseErrand(ctx) {
        const opts = ctx.options || [];
        const total = opts.reduce((a, o) => a + Math.max(0, o.worth || 0), 0);
        let roll = (ctx.roll || 0) * total;
        for (const o of opts) {
            roll -= Math.max(0, o.worth || 0);
            if (roll < 0) return o.id;
        }
        return 'home';
    },
    // Voice seam. Return a string to override built-in text, or null to keep it.
    narrate() { return null; },
};

export const House = {

    ROLE_IDS,

    // The active decision/narration provider (deterministic by default).
    _brain: DEFAULT_BRAIN,

    /** Inject a provider (Spec 2's LLM brain). Missing methods fall back to the
     *  deterministic defaults, so a partial provider is safe. */
    setBrain(provider) {
        const brain = { ...DEFAULT_BRAIN, ...(provider || {}) };
        // A menu pick is handed the deterministic choice as ctx.fallback, so a
        // provider that has no answer yet (a cold cache) picks exactly as the
        // engine would have
        for (const k of ['chooseScheme', 'chooseErrand']) {
            if (brain[k] === DEFAULT_BRAIN[k]) continue;
            const fn = brain[k];
            brain[k] = (ctx) => fn({ ...ctx, fallback: DEFAULT_BRAIN[k](ctx) });
        }
        House._brain = brain;
        return House._brain;
    },

    /** Restore the deterministic default provider. */
    resetBrain() {
        House._brain = DEFAULT_BRAIN;
    },

    /**
     * One table of the House's tuning: the code default, data/house.json's
     * table over it, then a runtime `DataLoader.house[key]` override over both.
     * Returns the default object itself when nothing overrides it.
     */
    _table(key, defaults) {
        const gd = DataLoader._gamedata;
        const data = gd && gd.house && gd.house[key] && typeof gd.house[key] === 'object' ? gd.house[key] : null;
        const override = DataLoader.house && DataLoader.house[key] && typeof DataLoader.house[key] === 'object' ? DataLoader.house[key] : null;
        if (!data && !override) return defaults;
        return { ...defaults, ...(data || {}), ...(override || {}) };
    },

    _getConfig() { return House._table('config', CONFIG); },
    _getSources() { return House._table('sources', SOURCES); },
    _getSinks() { return House._table('sinks', SINKS); },

    /** The multiplier a deed of this kind earns (sourceScales; 1 when unlisted). */
    deedScale(deedId, kind) {
        const t = House._table('sourceScales', SOURCE_SCALES)[deedId];
        const v = t && kind != null ? t[kind] : undefined;
        return typeof v === 'number' && Number.isFinite(v) ? v : 1;
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
            name: lastName ? `House ${lastName}` : (player && player.firstName) ? `House ${player.firstName}` : 'Your House',
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
            schemes: [],            // rival plots in flight (see systems/schemes.js)
            history: [],            // { day, generation, text, tags[] } chronicle
            stats: {},              // durable deed counters (ambition predicates read these)
            roleLoyalty: {},        // { memberId: loyalty } for appointed relatives
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
        House.migrateLegacyPrestige(player);
        return player.house;
    },

    /**
     * Fold the legacy `player.dynasty.prestige` counter (pre-House saves) into
     * House Prestige once, then drop it so there is a single source of truth.
     * Returns the amount migrated.
     */
    migrateLegacyPrestige(player) {
        if (!player || !player.house || !player.dynasty) return 0;
        if (!Object.prototype.hasOwnProperty.call(player.dynasty, 'prestige')) return 0;
        const legacy = Math.max(0, Math.floor(player.dynasty.prestige || 0));
        delete player.dynasty.prestige;
        if (legacy > 0) {
            player.house.prestige = (player.house.prestige || 0) + legacy;
            House._logPrestige(player.house, player.house.lastNotableDay || 0, legacy, 'legacy dynasty prestige');
        }
        return legacy;
    },

    /** The player's dynastic Prestige (House Prestige). */
    getPrestige(player) {
        return (player && player.house && player.house.prestige) || 0;
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
    /**
     * Call in a favor from an allied House. opts.kind picks what it brings:
     *   'gold'      — a purse that grows with the House's generation
     *   'influence' — +15 reputation with opts.kingdomId
     * Without a kind it only pays the Prestige (legacy callers).
     */
    callInFavor(player, world, opts = {}) {
        if (opts.kind === 'influence' && !opts.kingdomId) return { success: false, reason: 'Choose a kingdom to sway.' };
        const res = House._paySink(player, world, 'callInFavor', opts);
        if (!res.success || !opts.kind) return res;
        if (opts.kind === 'gold') {
            const gold = House.FAVOR_GOLD_BASE + House.FAVOR_GOLD_PER_GENERATION * (player.house.generation || 1);
            player.gold = (player.gold || 0) + gold;
            res.gold = gold;
        } else if (opts.kind === 'influence') {
            if (!player.reputation) player.reputation = {};
            player.reputation[opts.kingdomId] = (player.reputation[opts.kingdomId] || 0) + House.FAVOR_REPUTATION;
            res.reputation = House.FAVOR_REPUTATION;
        }
        return res;
    },

    FAVOR_GOLD_BASE: 150,
    FAVOR_GOLD_PER_GENERATION: 75,
    FAVOR_REPUTATION: 15,
    secureSuccession(player, world, opts = {}) {
        return House._paySink(player, world, 'secureSuccession', opts);
    },

    // ── Ambitions (multi-generational goals) ────────────────────

    /**
     * The ambitions open to choose, for the ambition-choice UI: without a
     * House, the first tier; with one, every ambition whose predecessor the
     * House has fulfilled and that it has not fulfilled itself.
     */
    ambitions(house = null) {
        return _ambitionCatalog()
            .filter(a => (house ? House.canPursue(house, a.id) : (a.tier || 1) === 1))
            .map(a => ({ id: a.id, name: a.name, blurb: a.blurb, tier: a.tier || 1, reward: a.reward || null, requires: a.requires || null }));
    },

    _getAmbitionDef(id) {
        return _ambitionCatalog().find(a => a.id === id) || null;
    },

    /** Has the House fulfilled this ambition (in any generation)? */
    fulfilled(house, id) {
        return !!(house && Array.isArray(house.ambitionsDone) && house.ambitionsDone.includes(id));
    },

    /** May the House take up this ambition: its predecessor fulfilled, itself not yet? */
    canPursue(house, id) {
        const def = House._getAmbitionDef(id);
        if (!def || !house) return false;
        if (House.fulfilled(house, id)) return false;
        return !def.requires || House.fulfilled(house, def.requires);
    },

    /** Set the House's single active ambition. Returns the progress object or null. */
    chooseAmbition(house, id, day) {
        if (!house) return null;
        const def = House._getAmbitionDef(id);
        if (!def || !House.canPursue(house, id)) return null;
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
            karma: player.karma || 0,
            colonies: (player.colonies || []).length,
            isRuler: !!(player.throne && player.throne.ruling),
            honours: Array.isArray(house.honours) ? house.honours.length : 0,
            ambitionsDone: Array.isArray(house.ambitionsDone) ? house.ambitionsDone.length : 0,
        };
    },

    /**
     * Pay an ambition's reward (data/house.json): Prestige, gold, renown,
     * standing with every living realm, and a lasting honour (which raises the
     * House's fame everywhere — systems/fame.js). Returns a summary.
     */
    _payReward(player, world, def) {
        const house = player.house;
        const r = def.reward || {};
        const day = world && world.day;
        const got = [];
        if (r.prestige > 0) { House.award(house, r.prestige, `ambition fulfilled: ${def.name}`, day); got.push(`+${r.prestige} Prestige`); }
        if (r.gold > 0) {
            player.gold = (player.gold || 0) + r.gold;
            Ledger.record(player, 'ambitionRewards', r.gold);
            got.push(`+${r.gold} gold`);
        }
        if (r.renown > 0) { player.renown = (player.renown || 0) + r.renown; got.push(`+${r.renown} renown`); }
        if (r.reputation) {
            if (!player.reputation) player.reputation = {};
            for (const k of (world && world.kingdoms) || []) {
                if (k && k.isAlive !== false) player.reputation[k.id] = (player.reputation[k.id] || 0) + r.reputation;
            }
            got.push(`+${r.reputation} standing in every realm`);
        }
        if (r.honour && r.honour.id) {
            if (!Array.isArray(house.honours)) house.honours = [];
            if (!house.honours.some(h => h.id === r.honour.id)) {
                house.honours.push({ id: r.honour.id, name: r.honour.name || r.honour.id, fame: r.honour.fame || 0, day: day || 0, generation: house.generation || 1 });
                got.push(`the honour "${r.honour.name || r.honour.id}"`);
            }
        }
        return got;
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
            if (!Array.isArray(house.ambitionsDone)) house.ambitionsDone = [];
            if (!house.ambitionsDone.includes(def.id)) house.ambitionsDone.push(def.id);
            out.reward = House._payReward(player, world, def);
            out.unlocked = _ambitionCatalog().filter(a => a.requires === def.id).map(a => a.name);
            House._chronicle(house, world,
                `${house.name} fulfils its great ambition: ${def.name}!${out.reward.length ? ` (${out.reward.join(', ')})` : ''}`, ['ambition', 'capstone', def.id]);
        }

        return out;
    },

    // ── Family roles ────────────────────────────────────────────

    /** Role metadata for the assignment UI. */
    roleDefs() {
        const t = House._table('roles', ROLE_DEFS);
        if (t === ROLE_DEFS) return ROLE_DEFS;
        // Data may restate a role in part: merge each over its default
        const out = {};
        for (const id of ROLE_IDS) out[id] = { ...ROLE_DEFS[id], ...((t[id] && typeof t[id] === 'object') ? t[id] : {}) };
        return out;
    },

    /** Find an assignable family member (a living child) by id. */
    _findMember(player, memberId) {
        if (!memberId) return null;
        for (const c of (player.children || [])) {
            if (c.id === memberId) return c;
        }
        return null;
    },

    /** Assign a living child to a role. A member holds at most one role. */
    assignRole(player, roleId, memberId) {
        const house = player && player.house;
        if (!house || !ROLE_DEFS[roleId]) return { success: false, reason: 'Invalid role' };
        const member = House._findMember(player, memberId);
        if (!member) return { success: false, reason: 'Not a family member' };
        if (member.isAlive === false) return { success: false, reason: 'They have passed away' };
        // Offices are for grown children at home (systems/upbringing.js); the
        // heir may be named at any age — a regency heir inherits young.
        if (roleId !== 'heir') {
            const up = member.upbringing;
            const grown = up ? !!up.comeOfAge : (member.age || 0) >= 16;
            if (!grown) return { success: false, reason: `${member.firstName || 'They'} must come of age (16) to hold an office` };
            const p = up && up.placement;
            if (p && p.kind === 'ward' && !p.returned) {
                return { success: false, reason: `${member.firstName || 'They'} is away as a ward and cannot hold an office` };
            }
        }

        // One role per member — vacate any prior appointment.
        for (const rid of ROLE_IDS) {
            if (house.roles[rid] === memberId) house.roles[rid] = null;
        }
        house.roles[roleId] = memberId;
        house.roleLoyalty = house.roleLoyalty || {};
        if (house.roleLoyalty[memberId] == null) {
            house.roleLoyalty[memberId] = House._getConfig().roleBaseLoyalty;
        }
        // Keep the legacy heir field in sync so the death screen still works.
        if (roleId === 'heir') player.heir = memberId;
        return { success: true, role: roleId, memberId };
    },

    clearRole(player, roleId) {
        const house = player && player.house;
        if (!house || !ROLE_DEFS[roleId]) return false;
        house.roles[roleId] = null;
        if (roleId === 'heir') player.heir = null;
        return true;
    },

    /** Compute the modifiers granted by currently-appointed relatives. Bonuses
     *  scale with the member's relevant skill and their loyalty. */
    getRoleBonuses(player) {
        const bonuses = { propertyIncomeMult: 1, armyUpkeepMult: 1, diplomacyBonus: 0, espionageBonus: 0 };
        const house = player && player.house;
        if (!house || !house.roles) return bonuses;

        const effSkill = (memberId, skill) => {
            const m = House._findMember(player, memberId);
            if (!m) return 0;
            const raw = (m.skills && m.skills[skill]) || 0;
            const loyalty = (house.roleLoyalty && house.roleLoyalty[memberId]);
            const factor = loyalty == null ? 1 : Utils.clamp(loyalty / 100, 0, 1);
            return raw * factor;
        };

        if (house.roles.steward) {
            bonuses.propertyIncomeMult = 1 + Math.min(0.5, effSkill(house.roles.steward, 'commerce') * 0.03);
        }
        if (house.roles.marshal) {
            bonuses.armyUpkeepMult = Math.max(0.5, 1 - Math.min(0.4, effSkill(house.roles.marshal, 'combat') * 0.03));
        }
        if (house.roles.chancellor) {
            bonuses.diplomacyBonus = Math.round(effSkill(house.roles.chancellor, 'diplomacy') * 0.5);
        }
        if (house.roles.spymaster) {
            bonuses.espionageBonus = Math.round(effSkill(house.roles.spymaster, 'stealth') * 0.5);
        }
        return bonuses;
    },

    /** Periodically drift appointed relatives' loyalty. A passed-over,
     *  disloyal role-holder sets a pending claim (feeds succession disputes).
     *  Returns { claimant: memberId|null }. */
    _driftRoleLoyalty(player, world) {
        const house = player && player.house;
        if (!house || !house.roleLoyalty) return { claimant: null };
        const cfg = House._getConfig();
        const day = (world && world.day) || 0;
        if (day % cfg.roleLoyaltyDriftDays !== 0) return { claimant: null };

        let claimant = null;
        for (const memberId of Object.keys(house.roleLoyalty)) {
            const stillAssigned = ROLE_IDS.some(rid => house.roles[rid] === memberId);
            const m = House._findMember(player, memberId);
            if (!m || m.isAlive === false || !stillAssigned) continue;

            let drift = Utils.randInt(-4, 5);
            const traits = m.traits || [];
            const hasTrait = id => traits.some(t => (t.id || t) === id);
            if (hasTrait('ambitious')) drift -= 3;
            if (hasTrait('loyal') || hasTrait('content')) drift += 3;
            // Serving in a non-heir office while another is the heir breeds resentment.
            const inNonHeirOffice = ROLE_IDS.some(rid => rid !== 'heir' && house.roles[rid] === memberId);
            if (house.roles.heir && house.roles.heir !== memberId && inNonHeirOffice) drift -= 1;

            house.roleLoyalty[memberId] = Utils.clamp((house.roleLoyalty[memberId] || cfg.roleBaseLoyalty) + drift, 0, 100);
            if (house.roles.heir !== memberId && house.roleLoyalty[memberId] < cfg.roleDisloyaltyThreshold) {
                claimant = memberId;
            }
        }
        if (claimant) house._pendingClaim = true;
        return { claimant };
    },

    // ── Rival Houses (the antagonist) ───────────────────────────

    /** Seed persistent rivals from the strongest kingdom dynasties. Deterministic
     *  (sorted by military, no RNG) and idempotent. Called once at game setup. */
    seedRivals(player, world, count = 3) {
        const house = player && player.house;
        if (!house) return [];
        house.rivals = house.rivals || {};
        if (Object.keys(house.rivals).length > 0) return Object.keys(house.rivals);

        const kingdoms = ((world && world.kingdoms) || [])
            .filter(k => k && k.isAlive && k.id !== player.allegiance)
            .slice()
            .sort((a, b) => (b.military || 0) - (a.military || 0))
            .slice(0, count);

        for (const k of kingdoms) {
            const dyn = k.characterData && k.characterData.dynasty;
            house.rivals[k.id] = {
                kingdomId: k.id,
                name: (dyn && dyn.name) ? `House ${dyn.name}` : (k.name || k.id),
                feud: 0,
                lastActedDay: (world && world.day) || 0,
            };
        }
        return Object.keys(house.rivals);
    },

    /** Increase a seeded rival's feud (0–100). No-op for non-rival kingdoms. */
    accrueRivalFeud(player, world, kingdomId, amount, reason) {
        const house = player && player.house;
        if (!house || !house.rivals || !kingdomId) return 0;
        const rival = house.rivals[kingdomId];
        if (!rival) return 0;
        const before = rival.feud || 0;
        rival.feud = Utils.clamp(before + amount, 0, 100);
        rival.lastActedDay = (world && world.day) || rival.lastActedDay;
        for (const t of [30, 60, 90]) {
            if (before < t && rival.feud >= t) {
                House._chronicle(house, world,
                    `${rival.name} grows openly hostile to ${house.name}${reason ? ` (${reason})` : ''}.`,
                    ['rival', 'feud']);
            }
        }
        // The rival Houses' ties to one another (systems/rivalHouses.js): a wrong
        // done to one angers its allies, and pleases its enemies a little
        const T = (DataLoader._gamedata && DataLoader._gamedata.rivalHouses && DataLoader._gamedata.rivalHouses.ties) || {};
        const gained = rival.feud - before;
        if (gained > 0) {
            for (const other of Object.values(house.rivals)) {
                const tie = (other && other.ties && other.ties[kingdomId]) || 0;
                if (!other || other === rival) continue;
                if (tie >= (T.allyAt ?? 50)) other.feud = Utils.clamp((other.feud || 0) + gained * (T.spill ?? 0.5), 0, 100);
                else if (tie <= (T.enemyAt ?? -50)) other.feud = Utils.clamp((other.feud || 0) - gained * (T.spill ?? 0.5) / 2, 0, 100);
            }
        }
        return rival.feud;
    },

    /** Daily rival processing: feuds cool over time; a sufficiently aggrieved
     *  rival may threaten a claim on the House's holdings (inflaming the next
     *  succession). Returns an action descriptor or null. */
    _processRivals(player, world) {
        const house = player && player.house;
        if (!house || !house.rivals || Object.keys(house.rivals).length === 0) return null;
        const cfg = House._getConfig();
        const day = (world && world.day) || 0;

        if (cfg.rivalFeudDecayDays > 0 && day % cfg.rivalFeudDecayDays === 0) {
            for (const key of Object.keys(house.rivals)) {
                const r = house.rivals[key];
                r.feud = Utils.clamp((r.feud || 0) - cfg.rivalFeudDecay, 0, 100);
            }
        }

        if (cfg.rivalActionCadence > 0 && day % cfg.rivalActionCadence === 0) {
            const hottest = Object.values(house.rivals).sort((a, b) => (b.feud || 0) - (a.feud || 0))[0];
            if (hottest) {
                // Engine draws the RNG; the (swappable) brain decides.
                const roll = Utils.random();
                const decision = House._brain.decideRivalAction({ rival: hottest, config: cfg, roll, house, world });
                if (decision && decision.act) {
                    house._pendingClaim = true;
                    const text = House._brain.narrate('rival_threat', { rival: hottest, house, world })
                        || `${hottest.name} eyes your holdings, waiting for weakness.`;
                    House._chronicle(house, world, text, ['rival', 'threat']);
                    return { kingdomId: hottest.kingdomId, name: hottest.name, type: decision.type || 'claim_threat', feud: hottest.feud };
                }
            }
        }
        return null;
    },

    // ── Succession with stakes ──────────────────────────────────

    /** Classify a player's heirs so the death screen can branch. */
    assessSuccession(player, minAge = 16) {
        const children = (player && player.children || []).filter(c => c.isAlive);
        const adults = children.filter(c => (c.age || 0) >= minAge);
        const minors = children.filter(c => (c.age || 0) < minAge);
        return {
            hasAdultHeir: adults.length > 0,
            hasMinorHeir: minors.length > 0,
            adults,
            minors,
            // Eldest minor — the candidate for a regency.
            regent: minors.slice().sort((a, b) => (b.age || 0) - (a.age || 0))[0] || null,
        };
    },

    _maxRivalFeud(house) {
        const rivals = house.rivals || {};
        let max = 0;
        for (const k of Object.keys(rivals)) {
            const f = (rivals[k] && rivals[k].feud) || 0;
            if (f > max) max = f;
        }
        return max;
    },

    /** Chance the succession is contested. High Prestige smooths it; rival feuds
     *  and a pending claim inflame it. Phases 5/6 feed the claimant/feud signals. */
    _disputeChance(house, opts = {}) {
        let c = 0.25;
        c -= Math.min(0.2, (house.prestige || 0) / 500);
        c += Math.min(0.3, House._maxRivalFeud(house) / 200);
        if (house._pendingClaim || opts.claimant) c += 0.25;
        return Utils.clamp(c, 0.02, 0.9);
    },

    /** Shed holdings on a bad succession: strip the held title and skim gold.
     *  Deliberately does NOT delete world properties (avoids orphaning tiles);
     *  it models fragmentation via titles + coin. */
    _fragmentHoldings(player, severity = 1) {
        const lost = [];
        if (player.currentTitle) {
            lost.push({ type: 'title', id: player.currentTitle });
            player.currentTitle = null;
            player.kingdomTitle = null;
            player.title = 'Nobody';
        }
        const goldLoss = Math.floor((player.gold || 0) * 0.1 * severity);
        if (goldLoss > 0) {
            player.gold -= goldLoss;
            lost.push({ type: 'gold', amount: goldLoss });
        }
        return lost;
    },

    /**
     * Apply House-level succession stakes. Called from Relationships.succeedAsHeir
     * after the heir has taken over. Advances the generation, may contest the
     * succession (securable by spending Prestige, else holdings fragment), and
     * chronicles it. Returns a descriptor for the UI.
     * opts: { headId, secure (spend Prestige to avoid a dispute), regency,
     *         disputeChance (override), claimant }.
     */
    processSuccession(player, world, opts = {}) {
        const house = player && player.house;
        if (!house) return { generation: 1, disputed: false, secured: false, fragmented: [], regency: false };

        house.generation = (house.generation || 1) + 1;
        house.headId = opts.headId != null ? opts.headId : (player.id || house.headId);
        const day = world && world.day;

        const result = {
            generation: house.generation,
            disputed: false,
            secured: false,
            fragmented: [],
            regency: !!opts.regency,
        };

        const disputeChance = opts.disputeChance != null
            ? opts.disputeChance : House._disputeChance(house, opts);
        if (Utils.random() < disputeChance) {
            result.disputed = true;
            const cost = House._getSinks().secureSuccession;
            if (opts.secure && house.prestige >= cost) {
                House.spend(house, cost, 'secured succession', day);
                result.secured = true;
            } else {
                result.fragmented.push(...House._fragmentHoldings(player, opts.regency ? 2 : 1));
            }
        }

        // A regency always leaves the House weaker even without a dispute.
        if (opts.regency && !result.disputed) {
            result.fragmented.push(...House._fragmentHoldings(player, 1));
        }

        house._pendingClaim = false; // consumed
        House._chronicle(house, world,
            `Generation ${house.generation}: ${player.name} succeeds`
            + `${result.disputed ? (result.secured ? ' (dispute quelled)' : ' amid a disputed succession') : ''}`
            + `${result.regency ? ' under a regency' : ''}.`,
            ['succession']);
        return result;
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
        House.markWealth(player, world);
        const ambition = House.evaluateAmbition(player, world);
        if (ambition && (ambition.milestonesCompleted.length || ambition.capstoneCompleted)) {
            results.ambition = ambition;
        }
        const roleDrift = House._driftRoleLoyalty(player, world);
        if (roleDrift.claimant) results.claimant = roleDrift.claimant;
        const rivalAction = House._processRivals(player, world);
        if (rivalAction) results.rival = rivalAction;
        return results;
    },

    /**
     * The Annals' wealth curve (systems/annals.js): the purse's peak and low
     * each day, and a mark every `wealthMarkDays` — kept on the House so it
     * outlives a succession. Reads only; draws no RNG.
     */
    markWealth(player, world) {
        const house = player && player.house;
        if (!house || !world) return;
        const day = world.day || 0;
        const gold = Math.round(typeof player.gold === 'number' && isFinite(player.gold) ? player.gold : 0);
        const gen = house.generation || 1;
        const peak = house.wealthPeak;
        if (!peak || gold > peak.gold) house.wealthPeak = { gold, day, generation: gen };
        const cfg = House._getConfig();
        if (!Array.isArray(house.wealthMarks)) house.wealthMarks = [];
        const marks = house.wealthMarks;
        const last = marks[marks.length - 1];
        if (last && day - last.day < cfg.wealthMarkDays) return;
        marks.push({ day, gold, generation: gen });
        if (marks.length > cfg.wealthMarkCap) {
            // Thin the older half so a long dynasty keeps its whole curve
            const half = Math.floor(marks.length / 2);
            house.wealthMarks = marks.slice(0, half).filter((m, i) => i % 2 === 0).concat(marks.slice(half));
        }
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
        House.migrateLegacyPrestige(player);
        return player.house;
    },
};
