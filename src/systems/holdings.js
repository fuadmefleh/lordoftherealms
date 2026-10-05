// ============================================
// HOLDINGS — developing the settlements the player rules
// ============================================
// The player's holdings are the settlements Taxation.getPlayerSettlements
// returns: colonies they founded or conquered, still theirs. This system lets
// the player shape them:
//
//   • Projects — a few development slots that grow with the population tier.
//     A project costs gold, materials (from the packs, or bought on the spot
//     at a markup) and days. Palisade → Stone Walls, Market Square, Granary,
//     Shrine → Temple, Barracks, Harbour, Watchtower, Workshop Quarter, Tavern
//     and Inn, Moot Hall. Their summed effects are cached on the settlement as
//     settlement.holding.fx, which the existing systems read: Taxation (tax,
//     happiness, growth), Economy (lean-season food stores, goods, sale prices,
//     recruit costs), PlayerMilitary (recruit capacity, siege defence),
//     RealmWars (war-host sieges), Ships (port prices and repairs),
//     Colonization (settlers, growth), Petitions (time to answer). Faith
//     (Religion.addPresence) and underworld heat (Underworld.addHeat) are
//     applied here each day through those systems' own APIs.
//   • A governor — a companion, a grown child or the spouse, or a hired
//     steward — whose stewardship / martial / intrigue profile boosts the
//     holding, and who skims when their loyalty is low (and may flee with
//     your gold). An ungoverned holding drifts while you are far away.
//   • A garrison of troops stationed from the player's army: it defends
//     against kingdom war hosts, bandit raids and rebels, and costs upkeep.
//   • Unrest — fed by unhappiness, low loyalty, heavy taxes and neglect,
//     calmed by order (projects, governor), troops and your presence. High
//     unrest with a weak garrison turns into rebellion, which the player must
//     crush or buy off before the rebels' deadline, or lose the holding.
//
// Per-settlement state lives on settlement.holding (saved with the tiles);
// the player's ledger lives on player.holdings (saved by SaveLoad). Nothing
// here runs, and no RNG is drawn, unless the player owns a holding.
//
// Content: data/holdings.json (read lazily through DataLoader.holdings).

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { Taxation } from './marketDynamics.js';
import { Religion } from './religion.js';
import { Relationships } from './relationships.js';
import { Companions } from './companions.js';
import { Underworld } from './underworld.js';
import { Ships } from './ships.js';
import { House } from './house.js';

const FALLBACK_CONFIG = {
    ungovernedDistance: 6,
    presentDistance: 1,
    drift: { happiness: 0.25, happinessFloor: 20, loyalty: 0.15, unrest: 0.4 },
    unrest: {
        decay: 0.25, lowHappiness: 40, happinessWeight: 1.5, lowLoyalty: 30, loyaltyWeight: 0.8,
        highTax: { high: 0.15, very_high: 0.35 }, garrisonControl: 0.8, presentRelief: 0.5,
        riskAt: 75, riskDivisor: 250, certainAt: 100, warnAt: 60,
    },
    rebellion: {
        days: 15, strengthBase: 10, strengthPerPop: 0.04, crushRatio: 1.2, garrisonLoss: 0.15,
        crushedUnrest: 35, riotUnrestDrop: 30, parleyGoldPerPop: 0.5, parleyMin: 100, parleyUnrest: 50,
        parleyHappiness: 10, parleyRenown: -5, victoryUnrest: 25, victoryHappiness: -5,
    },
    garrison: { controlPerPop: 0.02, controlMin: 20, desertShare: 0.1, siegeLoss: 0.15 },
    governor: {
        taxPerStewardship: 0.03, growthPerStewardship: 0.003, buildPerStewardship: 0.06,
        defensePerMartial: 0.04, orderPerMartial: 0.05, orderPerStewardship: 0.02, orderPerIntrigue: 0.03,
        raidPerIntrigue: 0.02, skimLoyalty: 70, skimMax: 0.5, loyaltyDrift: 0.5,
        baseLoyalty: { family: 80, companion: 60, steward: 55 }, renownPer: 0.05, renownCap: 10,
        intrigueAmbition: 2, unpaidPenalty: 15, betrayAt: 20, betrayChance: 0.04, betrayStealShare: 0.1,
        betrayStealMax: 300, betrayUnrest: 40, hireFee: 100, stewardWage: [3, 6], stewardOffers: 3, familyMinAge: 16,
    },
    raids: {
        radius: 2, chancePerRaider: 0.06, maxReduction: 0.85, foodLoss: 0.3, happiness: 6,
        populationLoss: 0.03, unrest: 8, progressLoss: 2,
    },
    materialPrices: { wood: 8, stone: 8, iron: 20, tools: 35 },
    buyMarkup: 1.5,
    cancelRefund: 0.5,
    logCap: 30,
    caps: { raidReduction: 0.85, defense: 1.5 },
};

const FALLBACK_TIERS = [
    { id: 'hamlet', name: 'Hamlet', minPopulation: 0, slots: 2 },
    { id: 'village', name: 'Village', minPopulation: 150, slots: 3 },
    { id: 'town', name: 'Town', minPopulation: 600, slots: 4 },
    { id: 'city', name: 'City', minPopulation: 2000, slots: 5 },
];

/** Every numeric effect a project or governor can contribute (settlement.holding.fx). */
const FX_KEYS = ['tax', 'happiness', 'growth', 'defense', 'militia', 'raidReduction', 'reserveDays', 'goods',
    'salePrice', 'recruitCapacity', 'recruitDiscount', 'garrisonUpkeep', 'faith', 'heatRelief', 'portPrices',
    'settlers', 'petitionDays', 'order', 'buildSpeed', 'port'];

const STAT_KEYS = ['stewardship', 'martial', 'intrigue'];

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function _key(q, r) {
    return `${q},${r}`;
}

/** Well-mixed unsigned hash of a string (deterministic offers and profiles). */
function _hash(str) {
    let h = Utils.hashStr(String(str)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

/** One level deep merge: nested config blocks keep their defaults. */
function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
            out[k] = { ...base[k], ...v };
        } else {
            out[k] = v;
        }
    }
    return out;
}

export const Holdings = {
    FX_KEYS,
    STAT_KEYS,

    // ──────────── DATA ────────────

    data() {
        return DataLoader.holdings || (DataLoader.get && DataLoader.get('holdings')) || {};
    },

    config() {
        return _merge(FALLBACK_CONFIG, Holdings.data().config || {});
    },

    projects() {
        return Holdings.data().projects || {};
    },

    project(id) {
        return Holdings.projects()[id] || null;
    },

    tiers() {
        const t = Holdings.data().tiers;
        return (Array.isArray(t) && t.length ? t : FALLBACK_TIERS).slice().sort((a, b) => a.minPopulation - b.minPopulation);
    },

    // ──────────── STATE ────────────

    _blankLedger() {
        return {
            keys: [],
            log: [],
            stats: { projects: 0, raidsRepelled: 0, raidsSuffered: 0, rebellions: 0, rebellionsCrushed: 0, holdingsLost: 0, betrayals: 0 },
        };
    },

    /** The player's holdings ledger (created and backfilled on demand). */
    ensureLedger(player) {
        if (!player) return null;
        if (!player.holdings || typeof player.holdings !== 'object' || Array.isArray(player.holdings)) {
            player.holdings = Holdings._blankLedger();
        }
        const st = player.holdings;
        const blank = Holdings._blankLedger();
        if (!Array.isArray(st.keys)) st.keys = [];
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    _emptyFx() {
        const fx = {};
        for (const k of FX_KEYS) fx[k] = 0;
        fx.skim = 0;
        fx.taxMult = 1;
        fx.rebellion = false;
        return fx;
    },

    /** A settlement's development record (created and backfilled on demand). */
    ensure(settlement) {
        if (!settlement) return null;
        if (!settlement.holding || typeof settlement.holding !== 'object') settlement.holding = {};
        const h = settlement.holding;
        if (!h.built || typeof h.built !== 'object' || Array.isArray(h.built)) h.built = {};
        if (!Array.isArray(h.queue)) h.queue = [];
        if (h.governor === undefined) h.governor = null;
        if (!Array.isArray(h.garrison)) h.garrison = [];
        h.unrest = _clamp(_num(h.unrest), 0, 100);
        if (h.rebellion === undefined) h.rebellion = null;
        if (h.lastRaidDay === undefined) h.lastRaidDay = null;
        if (typeof h.drifting !== 'boolean') h.drifting = false;
        if (!h.fx || typeof h.fx !== 'object') h.fx = Holdings._emptyFx();
        return h;
    },

    /** Plain-data copy of the player's ledger for the save file. */
    serialize(player) {
        return player && player.holdings ? JSON.parse(JSON.stringify(player.holdings)) : null;
    },

    /**
     * Backfill after loading: the ledger (older saves have none) and every
     * owned settlement's record, with its cached effects recomputed.
     */
    loadState(player, world = null) {
        if (!player) return null;
        const owned = world ? Holdings.list(player, world) : [];
        if (!player.holdings && !owned.length) {
            player.holdings = null;
            return null;
        }
        const st = Holdings.ensureLedger(player);
        for (const ref of owned) {
            Holdings.ensure(ref.settlement);
            ref.settlement.holding.lost = false;
            Holdings.refresh(ref.settlement);
        }
        // Towns developed once and lost since (saves from before the lost flag):
        // only their walls still stand
        const ownedKeys = new Set(owned.map(o => o.key));
        if (world && typeof world.getAllSettlements === 'function') {
            for (const s of world.getAllSettlements()) {
                if (!s || !s.holding || ownedKeys.has(_key(s.q, s.r))) continue;
                s.holding.lost = true;
                Holdings.refresh(s);
            }
        }
        if (world && owned.length) st.keys = owned.map(o => o.key);
        return st;
    },

    _log(player, world, text) {
        const st = Holdings.ensureLedger(player);
        st.log.push({ day: (world && world.day) || 0, text });
        const cap = Holdings.config().logCap;
        if (st.log.length > cap) st.log.splice(0, st.log.length - cap);
    },

    // ──────────── QUERIES ────────────

    /** The player's holdings: [{ q, r, key, settlement }]. Draws no RNG. */
    list(player, world) {
        return Taxation.getPlayerSettlements(player, world).map(ref => ({ ...ref, key: _key(ref.q, ref.r) }));
    },

    find(player, world, q, r) {
        return Holdings.list(player, world).find(h => h.q === q && h.r === r) || null;
    },

    isHolding(player, world, q, r) {
        return !!Holdings.find(player, world, q, r);
    },

    /** Population tier index (0 = hamlet). */
    tierIndex(settlement) {
        const pop = _num(settlement && settlement.population);
        const tiers = Holdings.tiers();
        let idx = 0;
        tiers.forEach((t, i) => { if (pop >= t.minPopulation) idx = i; });
        return idx;
    },

    tier(settlement) {
        return Holdings.tiers()[Holdings.tierIndex(settlement)];
    },

    slots(settlement) {
        return _num(Holdings.tier(settlement).slots, 2);
    },

    /** Slots in use: finished projects plus new ones under construction (an upgrade reuses its slot). */
    usedSlots(holding) {
        if (!holding) return 0;
        const built = Object.keys(holding.built || {}).length;
        const building = (holding.queue || []).filter(p => {
            const def = Holdings.project(p.id);
            return !(def && def.upgradeOf);
        }).length;
        return built + building;
    },

    /** Beside the water (the settlement is a port): a harbour can be built. */
    isCoastal(world, q, r) {
        return !!(world && typeof world.getTile === 'function' && Ships.isPortTile(world, q, r));
    },

    _materialPrice(goodId) {
        const cfg = Holdings.config();
        return Math.round(_num(cfg.materialPrices[goodId], 10) * _num(cfg.buyMarkup, 1.5));
    },

    /** Gold and materials a project needs, and what buying the missing materials here costs. */
    quote(player, projectId) {
        const def = Holdings.project(projectId);
        if (!def) return null;
        const inv = (player && player.inventory) || {};
        const materials = Object.entries(def.materials || {}).map(([id, need]) => {
            const have = Math.max(0, _num(inv[id]));
            return { id, need, have, missing: Math.max(0, need - have), price: Holdings._materialPrice(id) };
        });
        const buyCost = materials.reduce((s, m) => s + m.missing * m.price, 0);
        return { gold: _num(def.gold), materials, buyCost, total: _num(def.gold) + buyCost };
    },

    /**
     * Can the player start this project here now? { ok, reason, quote }.
     * opts.buyMissing (default true): buy materials the packs lack, at a markup.
     */
    canStart(player, world, q, r, projectId, opts = {}) {
        const buyMissing = opts.buyMissing !== false;
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { ok: false, reason: 'You do not rule this settlement.' };
        const def = Holdings.project(projectId);
        if (!def) return { ok: false, reason: 'Unknown project.' };
        const h = Holdings.ensure(ref.settlement);
        if (h.rebellion) return { ok: false, reason: 'The town is in revolt. Put the rebellion down first.' };
        if (h.built[projectId]) return { ok: false, reason: 'Already built.' };
        if (h.queue.some(p => p.id === projectId)) return { ok: false, reason: 'Already under construction.' };
        const replacedBy = Object.entries(Holdings.projects()).find(([id, d]) => d.upgradeOf === projectId && h.built[id]);
        if (replacedBy) return { ok: false, reason: `Already improved into ${replacedBy[1].name}.` };
        if (def.minTier && Holdings.tierIndex(ref.settlement) < def.minTier) {
            const t = Holdings.tiers()[def.minTier];
            return { ok: false, reason: `Needs a ${t ? t.name.toLowerCase() : 'larger settlement'} (population ${t ? t.minPopulation : '?'}+).` };
        }
        if (def.upgradeOf && !h.built[def.upgradeOf]) {
            const base = Holdings.project(def.upgradeOf);
            return { ok: false, reason: `Build the ${base ? base.name : def.upgradeOf} first.` };
        }
        if (def.coastal && !Holdings.isCoastal(world, q, r)) return { ok: false, reason: 'Only a holding beside the water can build this.' };
        if (!def.upgradeOf && Holdings.usedSlots(h) >= Holdings.slots(ref.settlement)) {
            return { ok: false, reason: 'No free development slot. The town must grow first.' };
        }
        const quote = Holdings.quote(player, projectId);
        const missing = quote.materials.filter(m => m.missing > 0);
        if (missing.length && !buyMissing) {
            return { ok: false, reason: `Missing ${missing.map(m => `${m.missing} ${m.id}`).join(', ')}.`, quote };
        }
        const need = quote.gold + (buyMissing ? quote.buyCost : 0);
        if (_num(player.gold) < need) return { ok: false, reason: `Needs ${need} gold.`, quote };
        return { ok: true, quote };
    },

    /** Start a project: pay gold and materials, then it builds day by day. */
    startProject(player, world, q, r, projectId, opts = {}) {
        const check = Holdings.canStart(player, world, q, r, projectId, opts);
        if (!check.ok) return { success: false, reason: check.reason };
        const ref = Holdings.find(player, world, q, r);
        const def = Holdings.project(projectId);
        const h = Holdings.ensure(ref.settlement);
        const quote = check.quote;
        let paid = quote.gold;
        if (!player.inventory) player.inventory = {};
        for (const m of quote.materials) {
            const used = Math.min(m.need, m.have);
            if (used > 0) {
                player.inventory[m.id] -= used;
                if (player.inventory[m.id] <= 0) delete player.inventory[m.id];
            }
        }
        paid += quote.buyCost;
        player.gold -= paid;
        const days = Economy.scaleBuildDays(_num(def.days, 5), world, q, r);
        h.queue.push({ id: projectId, progress: 0, days, startedDay: (world && world.day) || 0, paid });
        Holdings.ensureLedger(player);
        Holdings._log(player, world, `Work begins on a ${def.name} in ${ref.settlement.name}.`);
        return { success: true, project: def, days, cost: paid, text: `Work begins on the ${def.name} in ${ref.settlement.name} (${days} days, ${paid}g).` };
    },

    /** Abandon a project under construction for part of its gold back. */
    cancelProject(player, world, q, r, projectId) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        const h = Holdings.ensure(ref.settlement);
        const entry = h.queue.find(p => p.id === projectId);
        if (!entry) return { success: false, reason: 'Nothing like that is being built.' };
        h.queue = h.queue.filter(p => p !== entry);
        const refund = Math.floor(_num(entry.paid) * Holdings.config().cancelRefund);
        player.gold = _num(player.gold) + refund;
        const def = Holdings.project(projectId);
        return { success: true, refund, text: `Work on the ${def ? def.name : projectId} stops. ${refund}g comes back to you.` };
    },

    // ──────────── EFFECTS ────────────

    /**
     * The holding's effects: its finished projects plus its governor, the
     * governor's skim, and a rebellion's stopped taxes.
     * opts.withProject: include that project as if it were finished (projections).
     * opts.governor: use this governor record instead (candidate previews).
     */
    computeFx(settlement, opts = {}) {
        const h = Holdings.ensure(settlement);
        const fx = Holdings._emptyFx();
        const built = { ...h.built };
        if (opts.withProject) {
            built[opts.withProject] = 1;
            const def = Holdings.project(opts.withProject);
            if (def && def.upgradeOf) delete built[def.upgradeOf];
        }
        for (const id of Object.keys(built)) {
            const def = Holdings.project(id);
            for (const [k, v] of Object.entries((def && def.effects) || {})) {
                if (!FX_KEYS.includes(k)) continue;
                // A town no longer yours keeps its walls; its harbour, markets,
                // workshops and drill yards stop working for you.
                if (h.lost && k !== 'defense') continue;
                fx[k] += _num(v);
            }
        }
        const gov = opts.governor !== undefined ? opts.governor : h.governor;
        const cfg = Holdings.config();
        if (gov) {
            const G = cfg.governor;
            const s = _num(gov.stewardship), m = _num(gov.martial), i = _num(gov.intrigue);
            fx.tax += s * G.taxPerStewardship;
            fx.growth += s * G.growthPerStewardship;
            fx.buildSpeed += s * G.buildPerStewardship;
            fx.defense += m * G.defensePerMartial;
            fx.order += m * G.orderPerMartial + s * G.orderPerStewardship + i * G.orderPerIntrigue;
            fx.raidReduction += i * G.raidPerIntrigue;
            fx.skim = Holdings.skimRate(gov);
        }
        fx.raidReduction = Math.min(_num(cfg.caps.raidReduction, 0.85), fx.raidReduction);
        fx.defense = Math.min(_num(cfg.caps.defense, 1.5), fx.defense);
        fx.rebellion = !!h.rebellion;
        fx.taxMult = fx.rebellion ? 0 : (1 + fx.tax) * (1 - fx.skim);
        for (const k of Object.keys(fx)) if (typeof fx[k] === 'number') fx[k] = Math.round(fx[k] * 10000) / 10000;
        return fx;
    },

    /** Recompute and cache settlement.holding.fx (read by the other systems). */
    refresh(settlement) {
        const h = Holdings.ensure(settlement);
        h.fx = Holdings.computeFx(settlement);
        return h.fx;
    },

    /** Share of the taxes a governor pockets: none while loyal, more the craftier and less loyal they are. */
    skimRate(gov) {
        if (!gov) return 0;
        const G = Holdings.config().governor;
        const disloyalty = Math.max(0, G.skimLoyalty - _num(gov.loyalty, 50)) / 100;
        return _clamp(disloyalty * (0.5 + _num(gov.intrigue) / 10), 0, G.skimMax);
    },

    /** Short text for a project's effects ("+12% tax, +2 happiness"). */
    describeEffects(effects) {
        const labels = Holdings.data().effectLabels || {};
        const out = [];
        for (const [k, v] of Object.entries(effects || {})) {
            if (k === 'port') { out.push('a proper harbour (docked ships repaired)'); continue; }
            const meta = labels[k] || { label: k };
            const val = meta.pct ? `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%` : `${v > 0 ? '+' : ''}${v}`;
            out.push(`${val} ${meta.label}`);
        }
        return out;
    },

    // ──────────── DEFENCE & GARRISON ────────────

    unitStrength(unit) {
        return _num(unit && unit.strength) * (1 + (_num(unit && unit.level, 1) - 1) * 0.2);
    },

    garrisonStrength(holding) {
        return Math.floor(((holding && holding.garrison) || []).reduce((s, u) => s + Holdings.unitStrength(u), 0));
    },

    /** Daily gold the stationed troops cost (a Barracks makes it cheaper). */
    garrisonUpkeep(holding) {
        if (!holding) return 0;
        const base = (holding.garrison || []).reduce((s, u) => s + _num(u.upkeep), 0);
        const mult = Math.max(0, 1 + _num(holding.fx && holding.fx.garrisonUpkeep));
        return Math.round(base * mult);
    },

    /**
     * How hard a settlement is to take: the colony's own guard (or 10) and a
     * share of its people, plus stationed troops and militia, times its walls.
     * Without a holding record this is exactly the old war-host formula.
     */
    defenseRating(settlement, fxOverride = null) {
        if (!settlement) return 0;
        const colony = settlement.colony;
        const base = _num(colony && colony.garrisonStrength) || 10;
        const pop = _num(settlement.population) * 0.01;
        const h = settlement.holding;
        if (!h) return base + pop;
        const fx = fxOverride || h.fx || {};
        return (base + pop + Holdings.garrisonStrength(h) + _num(fx.militia)) * (1 + _num(fx.defense));
    },

    rebelStrength(settlement) {
        const R = Holdings.config().rebellion;
        return Math.round(R.strengthBase + _num(settlement && settlement.population) * R.strengthPerPop);
    },

    _present(player, world, q, r) {
        if (!player || typeof player.q !== 'number' || typeof player.r !== 'number') return false;
        return Hex.wrappingDistance(player.q, player.r, q, r, world.width) <= Holdings.config().presentDistance;
    },

    _distance(player, world, q, r) {
        if (!player || typeof player.q !== 'number' || typeof player.r !== 'number') return Infinity;
        return Hex.wrappingDistance(player.q, player.r, q, r, world.width);
    },

    /** Army units that can be stationed: soldiers, not hired mercenaries or warships. */
    stationable(player) {
        return ((player && player.army) || []).filter(u => u && !u.mercenary && !Ships.isNavalUnit(u));
    },

    /** Station `count` of the player's `unitType` troops here (you must be there). */
    stationTroops(player, world, q, r, unitType, count = 1) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        if (!Holdings._present(player, world, q, r)) return { success: false, reason: 'You must be at the holding to station troops.' };
        const h = Holdings.ensure(ref.settlement);
        let moved = 0;
        for (let i = (player.army || []).length - 1; i >= 0 && moved < count; i--) {
            const u = player.army[i];
            if (!u || u.type !== unitType || u.mercenary || Ships.isNavalUnit(u)) continue;
            player.army.splice(i, 1);
            h.garrison.push(u);
            moved++;
        }
        if (!moved) return { success: false, reason: 'No such troops in your army.' };
        Holdings.refresh(ref.settlement);
        return { success: true, moved, text: `${moved} ${unitType}${moved === 1 ? '' : 's'} take up quarters in ${ref.settlement.name}.` };
    },

    /** Take `count` of the garrison's `unitType` troops back into your army (you must be there). */
    withdrawTroops(player, world, q, r, unitType, count = 1) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        if (!Holdings._present(player, world, q, r)) return { success: false, reason: 'You must be at the holding to march troops out.' };
        const h = Holdings.ensure(ref.settlement);
        if (!player.army) player.army = [];
        let moved = 0;
        for (let i = h.garrison.length - 1; i >= 0 && moved < count; i--) {
            if (h.garrison[i].type !== unitType) continue;
            player.army.push(h.garrison.splice(i, 1)[0]);
            moved++;
        }
        if (!moved) return { success: false, reason: 'No such troops in the garrison.' };
        Holdings.refresh(ref.settlement);
        return { success: true, moved, text: `${moved} ${unitType}${moved === 1 ? '' : 's'} rejoin your army.` };
    },

    /** Lose a share of a garrison (deterministic: the most recently stationed go first). */
    _garrisonLosses(holding, share) {
        const n = (holding.garrison || []).length;
        if (!n || !(share > 0)) return 0;
        const lost = Math.min(n, Math.ceil(n * share));
        holding.garrison.splice(n - lost, lost);
        return lost;
    },

    /** A war host was beaten off at the walls: the garrison takes its losses. */
    onSiegeRepelled(settlement) {
        if (!settlement || !settlement.holding) return 0;
        return Holdings._garrisonLosses(settlement.holding, Holdings.config().garrison.siegeLoss);
    },

    // ──────────── GOVERNORS ────────────

    _addMods(profile, mods) {
        if (!mods) return;
        for (const k of STAT_KEYS) profile[k] += _num(mods[k]);
        profile.loyaltyMod += _num(mods.loyalty);
    },

    _clampProfile(p) {
        for (const k of STAT_KEYS) p[k] = _clamp(Math.round(p[k]), 0, 10);
        return p;
    },

    /** A companion's or spouse's governing profile: traits, occupation and a little of their own (hash of id). */
    npcProfile(npc) {
        const d = Holdings.data();
        const id = (npc && npc.id) || 'npc';
        const p = { stewardship: 2, martial: 2, intrigue: 1, loyaltyMod: 0 };
        for (const k of STAT_KEYS) p[k] += _hash(`${id}:${k}`) % 3;
        for (const t of (npc && npc.traits) || []) Holdings._addMods(p, (d.governorTraits || {})[t]);
        Holdings._addMods(p, (d.governorOccupations || {})[npc && npc.occupation]);
        return Holdings._clampProfile(p);
    },

    /** A grown child's profile from their skills and gifts. */
    childProfile(child) {
        const sk = (child && child.skills) || {};
        const p = {
            stewardship: _num(sk.commerce) + Math.floor(_num(child.intelligence, 5) / 3),
            martial: _num(sk.combat) + Math.floor(_num(child.strength, 5) / 3),
            intrigue: _num(sk.stealth) + Math.floor(_num(sk.diplomacy) / 2),
            loyaltyMod: 0,
        };
        for (const t of (child && child.traits) || []) {
            const id = typeof t === 'string' ? t : (t && t.id);
            Holdings._addMods(p, (Holdings.data().governorTraits || {})[id]);
        }
        return Holdings._clampProfile(p);
    },

    /** Stewards for hire at this holding this month (deterministic: hash of place and month). */
    stewardOffers(world, q, r) {
        const d = Holdings.data();
        const G = Holdings.config().governor;
        const names = d.stewardNames || {};
        const given = names.given && names.given.length ? names.given : ['Steward'];
        const family = names.family && names.family.length ? names.family : [''];
        const month = Math.floor(_num(world && world.day) / 30);
        const out = [];
        for (let n = 0; n < G.stewardOffers; n++) {
            const seed = `${q},${r}:${month}:${n}`;
            const h = (k) => _hash(`${seed}:${k}`);
            const [wLo, wHi] = Array.isArray(G.stewardWage) ? G.stewardWage : [3, 6];
            out.push({
                kind: 'steward',
                id: `steward_${q}_${r}_${month}_${n}`,
                name: `${given[h('g') % given.length]} ${family[h('f') % family.length]}`.trim(),
                stewardship: 3 + (h('s') % 6),
                martial: 1 + (h('m') % 5),
                intrigue: 1 + (h('i') % 6),
                loyaltyMod: 0,
                wage: wLo + (h('w') % (Math.max(0, wHi - wLo) + 1)),
                fee: G.hireFee,
            });
        }
        return out;
    },

    /** Ids already governing somewhere. */
    _governing(player, world) {
        const ids = new Set();
        for (const ref of Holdings.list(player, world)) {
            const g = ref.settlement.holding && ref.settlement.holding.governor;
            if (g) ids.add(g.id);
        }
        return ids;
    },

    /**
     * Who could govern this holding: travelling companions, grown children
     * and the spouse, and stewards for hire.
     * @returns {Array<{kind, id, name, stewardship, martial, intrigue, loyalty, wage, fee}>}
     */
    governorCandidates(player, world, q, r) {
        const G = Holdings.config().governor;
        const busy = Holdings._governing(player, world);
        const out = [];
        const seen = new Set();
        const push = (c) => {
            if (busy.has(c.id) || seen.has(c.id)) return;
            seen.add(c.id);
            out.push(c);
        };
        if (player && player.spouse) {
            const sp = Relationships.getNPC(player.spouse);
            if (sp && sp.isAlive !== false) {
                const p = Holdings.npcProfile(sp);
                push({ kind: 'family', id: sp.id, name: `${sp.firstName || 'Your spouse'} (spouse)`, ...p,
                    loyalty: _clamp(G.baseLoyalty.family + p.loyaltyMod, 0, 100), wage: 0, fee: 0 });
            }
        }
        for (const child of (player && player.children) || []) {
            if (!child || child.isAlive === false || _num(child.age) < G.familyMinAge) continue;
            const p = Holdings.childProfile(child);
            push({ kind: 'family', id: child.id, name: `${child.firstName || 'Your child'} (${child.gender === 'female' ? 'daughter' : 'son'})`, ...p,
                loyalty: _clamp(G.baseLoyalty.family + p.loyaltyMod, 0, 100), wage: 0, fee: 0 });
        }
        for (const npc of Companions.members(player, world)) {
            const p = Holdings.npcProfile(npc);
            const approval = _num(npc.companion && npc.companion.approval, G.baseLoyalty.companion);
            push({ kind: 'companion', id: npc.id, name: `${npc.firstName || 'Companion'}${npc.occupation ? ` (${npc.occupation})` : ''}`, ...p,
                loyalty: _clamp(approval + p.loyaltyMod, 0, 100), wage: _num(npc.companion && npc.companion.wage, 2), fee: 0 });
        }
        for (const s of Holdings.stewardOffers(world, q, r)) {
            push({ ...s, loyalty: _clamp(G.baseLoyalty.steward + s.loyaltyMod, 0, 100) });
        }
        return out;
    },

    /** Appoint a governor from governorCandidates (by id). */
    appointGovernor(player, world, q, r, candidateId) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        const cand = Holdings.governorCandidates(player, world, q, r).find(c => c.id === candidateId);
        if (!cand) return { success: false, reason: 'That candidate is not available.' };
        if (_num(cand.fee) > _num(player.gold)) return { success: false, reason: `Hiring costs ${cand.fee} gold.` };
        const h = Holdings.ensure(ref.settlement);
        if (h.governor) Holdings.dismissGovernor(player, world, q, r);
        player.gold = _num(player.gold) - _num(cand.fee);
        // A governor stays at their post: a companion — or a spouse travelling
        // with you — leaves the party (and cannot be invited back while in office)
        const inParty = cand.kind === 'companion' || Relationships.isInTravelParty(player, cand.id);
        if (inParty) {
            Relationships.removeFromTravelParty(player, cand.id);
            const npc = Relationships.getNPC(cand.id);
            if (npc) npc.governing = ref.key;
        }
        h.governor = {
            kind: cand.kind, id: cand.id, name: cand.name,
            stewardship: cand.stewardship, martial: cand.martial, intrigue: cand.intrigue,
            loyaltyMod: cand.loyaltyMod || 0, loyalty: cand.loyalty, wage: _num(cand.wage),
            appointedDay: _num(world && world.day), unpaid: 0, warned: false,
            ...(inParty && cand.kind !== 'companion' ? { rejoinParty: true } : {}),
        };
        Holdings.ensureLedger(player);
        Holdings.refresh(ref.settlement);
        Holdings._log(player, world, `${cand.name} is made governor of ${ref.settlement.name}.`);
        return { success: true, governor: h.governor, text: `${cand.name} now governs ${ref.settlement.name}.` };
    },

    /** Relieve the governor. A companion rejoins your travels. */
    dismissGovernor(player, world, q, r) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        const h = Holdings.ensure(ref.settlement);
        if (!h.governor) return { success: false, reason: 'No governor to dismiss.' };
        const g = h.governor;
        Holdings._releaseGovernor(player, g, true);
        h.governor = null;
        Holdings.refresh(ref.settlement);
        return { success: true, text: `${g.name} steps down as governor of ${ref.settlement.name}.` };
    },

    /** A governor leaves office; a companion who is still welcome rejoins the party. */
    _releaseGovernor(player, g, rejoin) {
        if (!g || (g.kind !== 'companion' && !g.rejoinParty)) return;
        const npc = Relationships.getNPC(g.id);
        if (!npc) return;
        delete npc.governing;
        if (rejoin && npc.isAlive !== false) {
            Relationships.ensureTravelParty(player);
            if (!player.travelParty.includes(npc.id)) player.travelParty.push(npc.id);
            npc.isTravelingWithPlayer = true;
        }
    },

    /** Where a governor's loyalty settles: their kind, your renown, the town's mood, their ambition, unpaid wages. */
    governorLoyaltyTarget(player, settlement, gov) {
        const G = Holdings.config().governor;
        let base = _num(G.baseLoyalty[gov.kind], 55);
        if (gov.kind === 'companion') {
            const npc = Relationships.getNPC(gov.id);
            base = _num(npc && npc.companion && npc.companion.approval, base);
        }
        const renown = Math.min(G.renownCap, _num(player && player.renown) * G.renownPer);
        const mood = (Taxation.getHappiness(settlement) - 50) / 10;
        const ambition = _num(gov.intrigue) * G.intrigueAmbition;
        const unpaid = _num(gov.unpaid) > 0 ? G.unpaidPenalty : 0;
        return _clamp(base + _num(gov.loyaltyMod) + renown + mood - ambition - unpaid, 0, 100);
    },

    // ──────────── REBELLION ────────────

    /** Crush the rebels by force: called after the player's battle (PlayerMilitary.combat) at the holding. */
    resolveRebellion(player, world, q, r, victory) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        const h = Holdings.ensure(ref.settlement);
        if (!h.rebellion) return { success: false, reason: 'There is no rebellion here.' };
        if (!victory) {
            return { success: true, crushed: false, text: `The rebels of ${ref.settlement.name} hold the streets.` };
        }
        const R = Holdings.config().rebellion;
        h.rebellion = null;
        h.unrest = R.victoryUnrest;
        ref.settlement.happiness = _clamp(Taxation.getHappiness(ref.settlement) + R.victoryHappiness, 0, 100);
        const st = Holdings.ensureLedger(player);
        st.stats.rebellionsCrushed++;
        Holdings.refresh(ref.settlement);
        const text = `The rising in ${ref.settlement.name} is crushed.`;
        Holdings._log(player, world, text);
        if (player.house) House._chronicle(player.house, world, text, ['war']);
        return { success: true, crushed: true, text };
    },

    /** Gold the rebels' leaders want to lay down arms. */
    parleyCost(settlement) {
        const R = Holdings.config().rebellion;
        return Math.max(R.parleyMin, Math.round(_num(settlement && settlement.population) * R.parleyGoldPerPop));
    },

    /** Buy the rebels off: gold and a little of your renown, and the town calms somewhat. */
    parley(player, world, q, r) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return { success: false, reason: 'You do not rule this settlement.' };
        const h = Holdings.ensure(ref.settlement);
        if (!h.rebellion) return { success: false, reason: 'There is no rebellion here.' };
        const cost = Holdings.parleyCost(ref.settlement);
        if (_num(player.gold) < cost) return { success: false, reason: `The rebels want ${cost} gold.` };
        const R = Holdings.config().rebellion;
        player.gold -= cost;
        player.renown = Math.max(0, _num(player.renown) + R.parleyRenown);
        h.rebellion = null;
        h.unrest = R.parleyUnrest;
        ref.settlement.happiness = _clamp(Taxation.getHappiness(ref.settlement) + R.parleyHappiness, 0, 100);
        Holdings.refresh(ref.settlement);
        const text = `You buy peace in ${ref.settlement.name} for ${cost}g.`;
        Holdings._log(player, world, text);
        return { success: true, cost, text };
    },

    _startRebellion(player, world, ref, h, out) {
        const R = Holdings.config().rebellion;
        const day = _num(world.day);
        h.rebellion = { startDay: day, deadline: day + R.days, strength: Holdings.rebelStrength(ref.settlement) };
        Holdings.ensureLedger(player).stats.rebellions++;
        const text = `${ref.settlement.name} rises in revolt (rebels ${h.rebellion.strength} strong). Crush it or buy them off within ${R.days} days, or lose the town.`;
        out.rebellions.push({ q: ref.q, r: ref.r, name: ref.settlement.name, text });
        Holdings._log(player, world, text);
    },

    /** The rebels win: the town throws off your rule. */
    _loseToRebels(player, world, ref, h, out) {
        const s = ref.settlement;
        const tile = world.getTile(ref.q, ref.r);
        const oldKingdom = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (oldKingdom) {
            oldKingdom.territory = (oldKingdom.territory || []).filter(t => t.q !== ref.q || t.r !== ref.r);
            if (oldKingdom.colonization && Array.isArray(oldKingdom.colonization.colonies)) {
                oldKingdom.colonization.colonies = oldKingdom.colonization.colonies.filter(c => c.q !== ref.q || c.r !== ref.r);
            }
        }
        s.kingdom = null;
        if (tile) tile.kingdom = null;
        if (s.colony) s.colony.isPlayerColony = false;
        player.colonies = (player.colonies || []).filter(c => c.q !== ref.q || c.r !== ref.r);
        if (Array.isArray(player.settlements)) player.settlements = player.settlements.filter(c => c.q !== ref.q || c.r !== ref.r);
        const lostTroops = h.garrison.length;
        Holdings._releaseGovernor(player, h.governor, true);
        h.governor = null;
        h.garrison = [];
        h.queue = [];
        h.rebellion = null;
        h.unrest = 0;
        h.lost = true;
        s.happiness = 50;
        Holdings.refresh(s);
        const st = Holdings.ensureLedger(player);
        st.stats.holdingsLost++;
        st.keys = st.keys.filter(k => k !== ref.key);
        const text = `The rebels hold ${s.name}. It is a free town now and no longer yours${lostTroops ? ` (${lostTroops} stationed troops lost)` : ''}.`;
        out.lost.push({ q: ref.q, r: ref.r, name: s.name, text });
        Holdings._log(player, world, text);
        if (player.house) House._chronicle(player.house, world, `${s.name} rebels and casts off ${player.house.name}.`, ['war']);
    },

    /** A holding lost some other way (stormed by a war host, ...): its garrison and governor are gone with it. */
    _onLost(player, world, key, out) {
        const [q, r] = key.split(',').map(Number);
        const tile = world.getTile(q, r);
        const s = tile && tile.settlement;
        const h = s && s.holding;
        if (!h) return;
        const lostTroops = (h.garrison || []).length;
        if (h.governor) Holdings._releaseGovernor(player, h.governor, true);
        h.governor = null;
        h.garrison = [];
        h.queue = [];
        h.rebellion = null;
        h.lost = true;
        Holdings.refresh(s);
        const text = `${s.name} is no longer yours${lostTroops ? `; its ${lostTroops} stationed troops are lost` : ''}.`;
        out.lost.push({ q, r, name: s.name, text });
        Holdings._log(player, world, text);
    },

    // ──────────── DAILY ────────────

    /**
     * Daily tick for every holding: governors' loyalty and wages, construction,
     * faith and the watch, neglect, unrest and rebellion, bandit raids, and the
     * garrisons' upkeep. Draws RNG only when the player owns holdings (betrayal
     * by a disloyal governor, a rebellion at high unrest, a raid with bandits near).
     * @returns {{ notices: string[], completed: Array, raids: Array, rebellions: Array, lost: Array, upkeep: number }}
     */
    processDay(player, world) {
        const out = { notices: [], completed: [], raids: [], rebellions: [], lost: [], upkeep: 0 };
        if (!player || !world || typeof world.getTile !== 'function') return out;
        const owned = Holdings.list(player, world);
        const keys = new Set(owned.map(o => o.key));
        if (player.holdings && Array.isArray(player.holdings.keys)) {
            for (const key of player.holdings.keys) if (!keys.has(key)) Holdings._onLost(player, world, key, out);
        }
        if (!owned.length) {
            if (player.holdings) player.holdings.keys = [];
            return out;
        }
        const st = Holdings.ensureLedger(player);
        st.keys = owned.map(o => o.key);
        const cfg = Holdings.config();

        for (const ref of owned) {
            const s = ref.settlement;
            const h = Holdings.ensure(s);
            if (h.lost) h.lost = false; // retaken
            Holdings._tickGovernor(player, world, ref, h, out);
            Holdings.refresh(s);

            if (h.rebellion) {
                Holdings._tickRebellion(player, world, ref, h, out);
                continue;
            }

            Holdings._tickProjects(player, world, ref, h, out);
            const fx = h.fx;

            // Your faith tended at the shrine or temple
            if (fx.faith > 0 && player.religion) Religion.addPresence(player.religion, ref.q, ref.r, fx.faith);
            // Your own watch keeps your name out of the reports — the realm's
            // own, or for an independent holding the nearest realm's
            if (fx.heatRelief > 0) {
                const watchKingdom = s.kingdom || Underworld._nearestKingdom(world, ref.q, ref.r);
                if (watchKingdom && Underworld.getHeat(player, watchKingdom) > 0) {
                    Underworld.addHeat(player, watchKingdom, -fx.heatRelief, world);
                }
            }

            Holdings._tickUnrest(player, world, ref, h, out);
            if (!h.rebellion) Holdings._raid(player, world, ref, h, out);
            Holdings.refresh(s);
        }

        // Garrison upkeep and governors' wages
        let upkeep = 0;
        for (const ref of owned) upkeep += Holdings.garrisonUpkeep(ref.settlement.holding);
        if (upkeep > 0) {
            if (_num(player.gold) >= upkeep) {
                player.gold -= upkeep;
                out.upkeep += upkeep;
            } else {
                let deserted = 0;
                for (const ref of owned) deserted += Holdings._garrisonLosses(ref.settlement.holding, cfg.garrison.desertShare);
                if (deserted) out.notices.push(`Unpaid, ${deserted} of your garrison troops desert.`);
            }
        }
        for (const ref of owned) {
            const g = ref.settlement.holding.governor;
            if (!g || !(g.wage > 0)) continue;
            if (_num(player.gold) >= g.wage) {
                player.gold -= g.wage;
                out.upkeep += g.wage;
                g.unpaid = 0;
            } else {
                g.unpaid = _num(g.unpaid) + 1;
            }
        }
        for (const ref of owned) Holdings.refresh(ref.settlement);
        return out;
    },

    _tickGovernor(player, world, ref, h, out) {
        const g = h.governor;
        if (!g) return;
        if (g.kind === 'companion' || g.kind === 'family') {
            const person = g.kind === 'companion' || g.id === player.spouse
                ? Relationships.getNPC(g.id)
                : (player.children || []).find(c => c && c.id === g.id);
            if (!person || person.isAlive === false) {
                out.notices.push(`${g.name}, governor of ${ref.settlement.name}, is gone. The seat stands empty.`);
                h.governor = null;
                return;
            }
        }
        const G = Holdings.config().governor;
        const target = Holdings.governorLoyaltyTarget(player, ref.settlement, g);
        const cur = _num(g.loyalty, 50);
        g.loyalty = Math.round((cur < target ? Math.min(target, cur + G.loyaltyDrift) : Math.max(target, cur - G.loyaltyDrift)) * 100) / 100;
        if (g.loyalty < G.betrayAt + 10 && !g.warned) {
            g.warned = true;
            out.notices.push(`Word reaches you that ${g.name}, governor of ${ref.settlement.name}, grows restless and greedy.`);
        } else if (g.loyalty >= G.betrayAt + 15) {
            g.warned = false;
        }
        if (g.loyalty < G.betrayAt && Utils.random() < G.betrayChance * (1 + _num(g.intrigue) / 10)) {
            const stolen = Math.min(G.betrayStealMax, Math.floor(_num(player.gold) * G.betrayStealShare));
            player.gold = _num(player.gold) - stolen;
            h.unrest = _clamp(h.unrest + G.betrayUnrest, 0, 100);
            h.governor = null;
            const npc = g.kind === 'companion' ? Relationships.getNPC(g.id) : null;
            if (npc) delete npc.governing;
            Holdings.ensureLedger(player).stats.betrayals++;
            const text = `${g.name} betrays you and flees ${ref.settlement.name}${stolen ? ` with ${stolen} of your gold` : ''}. The town is in uproar.`;
            out.notices.push(text);
            Holdings._log(player, world, text);
        }
    },

    _tickProjects(player, world, ref, h, out) {
        if (!h.queue.length) return;
        const speed = Math.max(0.1, 1 + _num(h.fx && h.fx.buildSpeed));
        for (const p of h.queue.slice()) {
            p.progress = Math.round((_num(p.progress) + speed) * 100) / 100;
            if (p.progress < p.days) continue;
            const def = Holdings.project(p.id) || { name: p.id };
            h.queue = h.queue.filter(x => x !== p);
            h.built[p.id] = _num(world.day);
            if (def.upgradeOf) delete h.built[def.upgradeOf];
            Holdings.ensureLedger(player).stats.projects++;
            const text = `The ${def.name} in ${ref.settlement.name} is finished.`;
            out.completed.push({ q: ref.q, r: ref.r, id: p.id, name: def.name, settlement: ref.settlement.name, text });
            Holdings._log(player, world, text);
            Holdings.refresh(ref.settlement);
        }
    },

    /** Neglect, then unrest; past the line with too few troops, rebellion. */
    _tickUnrest(player, world, ref, h, out) {
        const cfg = Holdings.config();
        const U = cfg.unrest;
        const s = ref.settlement;
        const fx = h.fx;
        const dist = Holdings._distance(player, world, ref.q, ref.r);
        const present = dist <= cfg.presentDistance;

        // An ungoverned holding drifts while its lord is far away
        h.drifting = !h.governor && dist > cfg.ungovernedDistance;
        if (h.drifting) {
            const hap = Taxation.getHappiness(s);
            if (hap > cfg.drift.happinessFloor) s.happiness = Math.max(cfg.drift.happinessFloor, hap - cfg.drift.happiness);
            if (s.colony && typeof s.colony.loyalty === 'number') s.colony.loyalty = Math.max(0, s.colony.loyalty - cfg.drift.loyalty);
        }

        let d = -U.decay;
        const hap = Taxation.getHappiness(s);
        if (hap < U.lowHappiness) d += (U.lowHappiness - hap) / U.lowHappiness * U.happinessWeight;
        const loy = s.colony && typeof s.colony.loyalty === 'number' ? s.colony.loyalty : null;
        if (loy !== null && loy < U.lowLoyalty) d += (U.lowLoyalty - loy) / U.lowLoyalty * U.loyaltyWeight;
        d += _num((U.highTax || {})[player.taxRate]);
        if (h.drifting) d += cfg.drift.unrest;
        if (present) d -= U.presentRelief;
        d -= _num(fx.order);
        const control = Holdings.garrisonStrength(h) / Math.max(cfg.garrison.controlMin, _num(s.population) * cfg.garrison.controlPerPop);
        d -= Math.min(1, control) * U.garrisonControl;
        const before = h.unrest;
        h.unrest = Math.round(_clamp(h.unrest + d, 0, 100) * 100) / 100;
        if (before < U.warnAt && h.unrest >= U.warnAt) {
            out.notices.push(`Unrest is rising in ${s.name} (${Math.round(h.unrest)}). A weak garrison there invites revolt.`);
        }

        if (h.unrest < U.riskAt) return;
        const R = cfg.rebellion;
        const strongEnough = Holdings.garrisonStrength(h) > 0 && Holdings.defenseRating(s) >= Holdings.rebelStrength(s) * R.crushRatio;
        if (h.unrest >= U.certainAt) {
            if (strongEnough) {
                const lost = Holdings._garrisonLosses(h, R.garrisonLoss);
                h.unrest = Math.max(0, h.unrest - R.riotUnrestDrop);
                s.happiness = _clamp(hap - 3, 0, 100);
                out.notices.push(`Riots in ${s.name} are put down by the garrison${lost ? ` (${lost} troops lost)` : ''}.`);
            } else {
                Holdings._startRebellion(player, world, ref, h, out);
            }
            return;
        }
        if (!strongEnough && Utils.random() < (h.unrest - U.riskAt) / U.riskDivisor) {
            Holdings._startRebellion(player, world, ref, h, out);
        }
    },

    _tickRebellion(player, world, ref, h, out) {
        const R = Holdings.config().rebellion;
        const reb = h.rebellion;
        if (Holdings.garrisonStrength(h) > 0 && Holdings.defenseRating(ref.settlement) >= reb.strength * R.crushRatio) {
            const lost = Holdings._garrisonLosses(h, R.garrisonLoss);
            h.rebellion = null;
            h.unrest = R.crushedUnrest;
            Holdings.ensureLedger(player).stats.rebellionsCrushed++;
            const text = `The garrison of ${ref.settlement.name} crushes the rising${lost ? ` (${lost} troops lost)` : ''}.`;
            out.notices.push(text);
            Holdings._log(player, world, text);
            Holdings.refresh(ref.settlement);
            return;
        }
        if (_num(world.day) >= reb.deadline) Holdings._loseToRebels(player, world, ref, h, out);
    },

    /** Bandits within reach may fall on the holding; walls, watchtowers, troops and militia beat them off. */
    _raid(player, world, ref, h, out) {
        const R = Holdings.config().raids;
        const day = _num(world.day);
        if (h.lastRaidDay != null && day - h.lastRaidDay < 7) return;
        const raiders = (world.units || []).filter(u => u && !u.destroyed && u.type === 'raider'
            && Hex.wrappingDistance(u.q, u.r, ref.q, ref.r, world.width) <= R.radius);
        if (!raiders.length) return;
        const reduction = Math.min(R.maxReduction, _num(h.fx.raidReduction));
        const chance = 1 - Math.pow(1 - R.chancePerRaider * (1 - reduction), raiders.length);
        if (Utils.random() >= chance) return;
        const raider = raiders.slice().sort((a, b) => _num(b.strength) - _num(a.strength))[0];
        const attack = _num(raider.strength, 10) * Utils.randFloat(0.8, 1.3);
        const defense = Holdings.defenseRating(ref.settlement);
        const s = ref.settlement;
        h.lastRaidDay = day;
        const st = Holdings.ensureLedger(player);
        if (defense >= attack) {
            raider.destroyed = true;
            st.stats.raidsRepelled++;
            const text = `${raider.name || 'Raiders'} fall on ${s.name} and are beaten off.`;
            out.raids.push({ q: ref.q, r: ref.r, repelled: true, text });
            return;
        }
        if (s.economy) s.economy.food = Math.floor(_num(s.economy.food) * (1 - R.foodLoss));
        s.happiness = _clamp(Taxation.getHappiness(s) - R.happiness, 0, 100);
        s.population = Math.max(10, Math.round(_num(s.population) * (1 - R.populationLoss)));
        h.unrest = _clamp(h.unrest + R.unrest, 0, 100);
        for (const p of h.queue) p.progress = Math.max(0, _num(p.progress) - R.progressLoss);
        st.stats.raidsSuffered++;
        const text = `${raider.name || 'Raiders'} sack the outskirts of ${s.name}: stores burned, people lost (−${R.happiness} happiness).`;
        out.raids.push({ q: ref.q, r: ref.r, repelled: false, text });
        Holdings._log(player, world, text);
    },

    // ──────────── SUMMARY ────────────

    /** This week's tax take from one holding (dry run of Taxation.collectTaxes). */
    weeklyTax(player, world, q, r) {
        const res = Taxation.collectTaxes(player, world, { dryRun: true });
        const entry = (res.settlements || []).find(e => e.q === q && e.r === r);
        return entry ? entry.collected : 0;
    },

    /** The numbers the Manage Holding panel shows. */
    stats(player, world, q, r) {
        const ref = Holdings.find(player, world, q, r);
        if (!ref) return null;
        const s = ref.settlement;
        const h = Holdings.ensure(s);
        const fx = h.fx && h.fx.taxMult !== undefined ? h.fx : Holdings.refresh(s);
        const policy = Taxation.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || Taxation.TAX_RATES.MODERATE;
        const reserve = Economy.foodReserveDays(s);
        return {
            name: s.name,
            tier: Holdings.tier(s),
            slots: Holdings.slots(s),
            used: Holdings.usedSlots(h),
            population: _num(s.population),
            happiness: Math.round(Taxation.getHappiness(s)),
            happinessTarget: Math.round(_clamp(50 + policy.happinessBonus * 1.5 + Taxation.peoplesMood(s) + _num(fx.happiness) + Taxation.patronageMood(s), 0, 100)),
            loyalty: s.colony && typeof s.colony.loyalty === 'number' ? Math.round(s.colony.loyalty) : null,
            unrest: Math.round(h.unrest),
            defense: Math.round(Holdings.defenseRating(s)),
            rebels: Holdings.rebelStrength(s),
            garrison: Holdings.garrisonStrength(h),
            garrisonUnits: h.garrison.length,
            upkeep: Holdings.garrisonUpkeep(h),
            reserveDays: isFinite(reserve) ? Math.round(reserve * 10) / 10 : null,
            growth: Math.round((_num(policy.growthBonus) + _num(fx.growth)) * 1000) / 10,
            weeklyTax: Holdings.weeklyTax(player, world, q, r),
            skim: Math.round(_num(fx.skim) * 100),
            rebellion: h.rebellion,
            drifting: !!h.drifting,
            governor: h.governor,
            fx,
        };
    },

    /** What finishing a project would change here: effect lines plus gold a week and defence. */
    projectEffect(player, world, q, r, projectId) {
        const ref = Holdings.find(player, world, q, r);
        const def = Holdings.project(projectId);
        if (!ref || !def) return null;
        const s = ref.settlement;
        const h = Holdings.ensure(s);
        const now = h.fx && h.fx.taxMult !== undefined ? h.fx : Holdings.refresh(s);
        const after = Holdings.computeFx(s, { withProject: projectId });
        const tax = Holdings.weeklyTax(player, world, q, r);
        const taxAfter = now.taxMult > 0 ? Math.floor(tax * after.taxMult / now.taxMult) : 0;
        const replaced = def.upgradeOf ? Holdings.project(def.upgradeOf) : null;
        return {
            lines: Holdings.describeEffects(def.effects),
            replaces: replaced ? replaced.name : null,
            taxDelta: taxAfter - tax,
            defenseBefore: Math.round(Holdings.defenseRating(s, now)),
            defenseAfter: Math.round(Holdings.defenseRating(s, after)),
            happinessDelta: Math.round((after.happiness - now.happiness) * 10) / 10,
        };
    },
};
