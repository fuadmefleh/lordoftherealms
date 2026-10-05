// ============================================
// PETITIONS — the Court: dilemmas brought to the player's holdings
// ============================================
// Once the player rules something — a settlement or colony, a royal office,
// or a House of standing — petitioners arrive every week or so with a
// dilemma: a land dispute, a guild wanting a monopoly, a famine plea, a
// heretic preacher… Each petition offers 2–4 choices that trade between the
// game's existing currencies (gold, karma, renown, House Prestige, kingdom
// reputation and stability, settlement happiness/loyalty/population, council
// faction support, faith presence, peoples' sentiment).
//
// Content is data-driven (data/petitions.json). A petition entry:
//   { title, icon, text, weight, expires, followUpOnly?,
//     requires: { holding: ['settlement'|'office'|'house'], minPopulation,
//                 maxPopulation, season: [...], war: bool, faith, playerReligion,
//                 peoples: n, colony, rivals, office, minPrestige },
//     ignore:  { effects, result },          // the cost of letting it expire
//     choices: [{ id, label, requires?, effects, result, chronicle?, notable?,
//                 gamble?: { chance, success: {effects, result}, failure: {...} },
//                 followUp?: { options: [{id, weight}], delay: [min, max],
//                              chance?, prior?: 'name'|'name2' } }] }
// Every key inside an `effects` object must be in Petitions.EFFECTS.
//
// Choices may schedule a follow-up petition days later that refers back to
// the original ruling ({prior} = the earlier petitioner). Unanswered
// petitions expire and their `ignore` effects apply. Rulings shape a court
// reputation (mercy / severity / justice / piety / generosity) that NPC lords
// weigh in their opinion of the player (NPCLords.getLordOpinion), and
// notable ones are written into the House chronicle.
//
// State lives on player.petitions. All randomness flows through Utils, and
// the daily tick draws none until the player actually has holdings.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { House } from './house.js';
import { Councils } from './councils.js';
import { Taxation } from './marketDynamics.js';
import { Religion } from './religion.js';

const DEFAULT_CONFIG = {
    firstDelay: 3,
    cadenceMin: 6,
    cadenceMax: 12,
    cadencePerHolding: 1,
    cadenceFloor: 3,
    maxPending: 3,
    defaultExpiry: 10,
    repeatCooldown: 45,
    historyCap: 20,
    courtCap: 20,
    housePrestige: 20,
    opinionCap: 15,
    governorDaysPerStewardship: 0.3,
    governorDaysMax: 3,
};

const COURT_AXES = ['mercy', 'severity', 'justice', 'piety', 'generosity'];
const HOLDING_KINDS = ['settlement', 'office', 'house'];
const REQUIREMENT_KEYS = ['holding', 'minPopulation', 'maxPopulation', 'season', 'war', 'faith',
    'playerReligion', 'peoples', 'colony', 'rivals', 'office', 'minPrestige'];
const CHOICE_REQUIREMENT_KEYS = ['gold', 'prestige', 'faith', 'playerReligion', 'office'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;

function factionMeta(id) {
    return Councils.FACTIONS.find(f => f.id === id) || null;
}

function demoByTribe(settlement, tribeId) {
    if (!settlement || !Array.isArray(settlement.demographics) || !tribeId) return null;
    return settlement.demographics.find(d => d && d.tribe && d.tribe.id === tribeId) || null;
}

function shiftSentiment(demo, v) {
    if (!demo) return;
    demo.sentiment = clamp(Math.round((demo.sentiment || 0) + v), 0, 100);
}

// ── Effect registry ─────────────────────────────────────────────
// apply(c, value): c = { player, world, ctx, settlement, kingdom, day }
// describe(value, ctx, c): short human text, or null when it would do nothing here.
const EFFECTS = {
    gold: {
        apply(c, v) { c.player.gold = Math.max(0, (c.player.gold || 0) + v); },
        describe: (v) => `${signed(v)} gold`,
    },
    karma: {
        apply(c, v) { c.player.karma = (c.player.karma || 0) + v; },
        describe: (v) => `${signed(v)} karma`,
    },
    renown: {
        apply(c, v) { c.player.renown = Math.max(0, (c.player.renown || 0) + v); },
        describe: (v) => `${signed(v)} renown`,
    },
    prestige: {
        apply(c, v) {
            const house = c.player.house;
            if (!house) return;
            if (v > 0) House.award(house, v, 'court ruling', c.day);
            else if (v < 0) {
                const loss = Math.min(house.prestige || 0, -v);
                if (loss > 0) House.spend(house, loss, 'court ruling', c.day);
            }
        },
        describe: (v, ctx, c) => (c && !c.player.house) ? null : `${signed(v)} Prestige`,
    },
    reputation: {
        apply(c, v) {
            const k = c.ctx.kingdomId;
            if (!k) return;
            if (!c.player.reputation) c.player.reputation = {};
            c.player.reputation[k] = (c.player.reputation[k] || 0) + v;
        },
        describe: (v, ctx) => ctx.kingdomId ? `${signed(v)} reputation (${ctx.kingdomName || 'realm'})` : null,
    },
    happiness: {
        apply(c, v) {
            if (!c.settlement) return;
            c.settlement.happiness = clamp(Taxation.getHappiness(c.settlement) + v, 0, 100);
        },
        describe: (v, ctx) => ctx.q != null ? `${signed(v)} happiness` : null,
    },
    loyalty: {
        apply(c, v) {
            const col = c.settlement && c.settlement.colony;
            if (!col || typeof col.loyalty !== 'number') return;
            col.loyalty = clamp(col.loyalty + v, 0, 100);
        },
        describe: (v, ctx, c) => (c && c.settlement && c.settlement.colony) ? `${signed(v)} loyalty` : null,
    },
    population: {
        apply(c, v) {
            if (!c.settlement) return;
            c.settlement.population = Math.max(10, (c.settlement.population || 0) + v);
        },
        describe: (v, ctx) => ctx.q != null ? `${signed(v)} population` : null,
    },
    stability: {
        apply(c, v) {
            if (!c.kingdom) return;
            const base = typeof c.kingdom.stability === 'number' ? c.kingdom.stability : 60;
            c.kingdom.stability = clamp(base + v, 0, 100);
        },
        describe: (v, ctx) => ctx.kingdomId ? `${signed(v)} stability (${ctx.kingdomName || 'realm'})` : null,
    },
    faction: {
        apply(c, v) {
            const state = Councils._ensureState(c.player);
            for (const [id, amt] of Object.entries(v || {})) {
                const f = state.factions[id];
                if (f) f.support = clamp(f.support + amt, 0, 100);
            }
        },
        describe: (v) => Object.entries(v || {}).map(([id, amt]) => {
            const m = factionMeta(id);
            return `${m ? `${m.icon} ${m.name}` : id} ${signed(amt)}`;
        }).join(', ') || null,
    },
    councilApproval: {
        apply(c, v) {
            const state = Councils._ensureState(c.player);
            state.approval = clamp(state.approval + v, 0, 100);
        },
        describe: (v) => `${signed(v)} council approval`,
    },
    faith: {
        // Your own faith's presence in the settlement when you have founded
        // one; otherwise the piety of the local kingdom's established faith.
        apply(c, v) {
            const rel = c.player.religion;
            if (rel && c.ctx.q != null) {
                if (v > 0) Religion.addPresence(rel, c.ctx.q, c.ctx.r, v / 100);
                else if (rel.presence) {
                    const key = `${c.ctx.q},${c.ctx.r}`;
                    if (rel.presence[key]) rel.presence[key] = Math.max(0, rel.presence[key] + v / 100);
                }
                return;
            }
            const kr = c.kingdom && c.kingdom.religion;
            if (kr && typeof kr.piety === 'number') kr.piety = clamp(kr.piety + v, 0, 100);
        },
        describe: (v, ctx) => `${signed(v)} faith${ctx.faith ? ` (${ctx.faith})` : ''}`,
    },
    followers: {
        apply(c, v) {
            const rel = c.player.religion;
            if (rel) rel.followers = Math.max(0, (rel.followers || 0) + v);
        },
        describe: (v, ctx, c) => (c && !c.player.religion) ? null : `${signed(v)} followers`,
    },
    peoplesSentiment: {
        apply(c, v) { shiftSentiment(demoByTribe(c.settlement, c.ctx.people), v); },
        describe: (v, ctx) => ctx.people ? `${ctx.peopleName} mood ${signed(v)}` : null,
    },
    rivalPeoplesSentiment: {
        apply(c, v) { shiftSentiment(demoByTribe(c.settlement, c.ctx.rivalPeople), v); },
        describe: (v, ctx) => ctx.rivalPeople ? `${ctx.rivalPeopleName} mood ${signed(v)}` : null,
    },
    allPeoplesSentiment: {
        apply(c, v) {
            for (const d of (c.settlement && c.settlement.demographics) || []) shiftSentiment(d, v);
        },
        describe: (v, ctx, c) => (c && c.settlement && (c.settlement.demographics || []).length) ? `every people's mood ${signed(v)}` : null,
    },
    court: {
        apply(c, v) {
            const st = Petitions._state(c.player);
            const cap = Petitions.config().courtCap;
            for (const [axis, amt] of Object.entries(v || {})) {
                if (!COURT_AXES.includes(axis)) continue;
                st.court[axis] = clamp((st.court[axis] || 0) + amt, -cap, cap);
            }
        },
        // Court reputation is shown separately (it is the ruling's character, not a cost)
        describe: () => null,
    },
    rivalFeud: {
        apply(c, v) {
            const id = c.ctx.rivalId || Petitions._topRivalId(c.player);
            if (id) House.accrueRivalFeud(c.player, c.world, id, v, 'a court ruling');
        },
        describe: (v, ctx) => `${ctx.rival || 'rival'} feud ${signed(v)}`,
    },
};

export const Petitions = {

    EFFECTS,
    COURT_AXES,
    HOLDING_KINDS,
    REQUIREMENT_KEYS,
    CHOICE_REQUIREMENT_KEYS,

    // ── Data ────────────────────────────────────────────────────

    data() {
        return DataLoader.petitions || (DataLoader.get && DataLoader.get('petitions')) || { petitions: {} };
    },

    config() {
        return { ...DEFAULT_CONFIG, ...(Petitions.data().config || {}) };
    },

    defs() {
        return Petitions.data().petitions || {};
    },

    getDef(id) {
        return Petitions.defs()[id] || null;
    },

    axisMeta() {
        return Petitions.data().courtAxes || {};
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        return {
            pending: [],
            scheduled: [],
            history: [],
            notable: [],
            court: COURT_AXES.reduce((a, k) => { a[k] = 0; return a; }, {}),
            lastSeen: {},
            stats: { ruled: 0, ignored: 0 },
            nextId: 1,
            nextDay: null,
        };
    },

    _state(player) {
        if (!player) return null;
        if (!player.petitions || typeof player.petitions !== 'object') player.petitions = Petitions._blank();
        return Petitions.loadState(player);
    },

    /** Backfill missing fields (older saves / partial state). Idempotent. */
    loadState(player) {
        if (!player) return null;
        if (!player.petitions || typeof player.petitions !== 'object') player.petitions = Petitions._blank();
        const st = player.petitions;
        const blank = Petitions._blank();
        for (const k of ['pending', 'scheduled', 'history', 'notable']) {
            if (!Array.isArray(st[k])) st[k] = [];
        }
        st.court = { ...blank.court, ...(st.court || {}) };
        if (!st.lastSeen || typeof st.lastSeen !== 'object') st.lastSeen = {};
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.nextDay === undefined) st.nextDay = null;
        return st;
    },

    pending(player) {
        return (player && player.petitions && player.petitions.pending) || [];
    },

    history(player) {
        return (player && player.petitions && player.petitions.history) || [];
    },

    courtStanding(player) {
        const st = player && player.petitions;
        return (st && st.court) || Petitions._blank().court;
    },

    // ── Holdings & context ──────────────────────────────────────

    _atWar(player, world) {
        const wars = player && player.realmWars && player.realmWars.wars;
        if (wars && Object.keys(wars).length) return true;
        const k = player && player.allegiance && world && world.getKingdom ? world.getKingdom(player.allegiance) : null;
        return !!(k && Array.isArray(k.wars) && k.wars.length);
    },

    _houseQualifies(player) {
        const house = player && player.house;
        if (!house) return false;
        return (house.prestige || 0) >= Petitions.config().housePrestige || (house.generation || 1) > 1;
    },

    _topRivalId(player) {
        const rivals = player && player.house && player.house.rivals;
        if (!rivals) return null;
        const top = Object.values(rivals).slice().sort((a, b) => (b.feud || 0) - (a.feud || 0))[0];
        return top ? top.kingdomId : null;
    },

    /**
     * Every place the player could be petitioned from: owned settlements and
     * colonies, the capital of the realm they serve in office, and the House.
     * Deterministic — draws no RNG.
     */
    holdingContexts(player, world) {
        const out = [];
        if (!player || !world) return out;
        for (const ref of Taxation.getPlayerSettlements(player, world)) {
            out.push({ kind: 'settlement', q: ref.q, r: ref.r, settlement: ref.settlement });
        }
        if (player.currentTitle && player.allegiance && world.getKingdom) {
            const k = world.getKingdom(player.allegiance);
            const cap = k && k.capital;
            const tile = cap && world.getTile ? world.getTile(cap.q, cap.r) : null;
            if (tile && tile.settlement) out.push({ kind: 'office', q: cap.q, r: cap.r, settlement: tile.settlement, kingdomId: k.id });
            else if (k) out.push({ kind: 'office', kingdomId: k.id });
        }
        if (Petitions._houseQualifies(player)) out.push({ kind: 'house' });
        return out;
    },

    /** Does the player rule anything petitioners would come to? */
    hasHoldings(player, world) {
        return Petitions.holdingContexts(player, world).length > 0;
    },

    /** Is this tile one of the player's seats of court (a holding, property, house or office seat)? */
    canHoldCourtAt(player, world, tile) {
        if (!player || !tile || !Petitions.hasHoldings(player, world)) return false;
        const at = (o) => o && o.q === tile.q && o.r === tile.r;
        if (Taxation.getPlayerSettlements(player, world).some(at)) return true;
        if ((player.properties || []).some(at)) return true;
        if ((player.houses || []).some(at)) return true;
        if (player.currentTitle && tile.settlement && player.allegiance && tile.settlement.kingdom === player.allegiance) return true;
        return false;
    },

    _kingdomFor(player, world, base) {
        const id = base.kingdomId || (base.settlement && base.settlement.kingdom) || player.allegiance || null;
        const k = id && world && world.getKingdom ? world.getKingdom(id) : null;
        return { id: k ? k.id : null, kingdom: k };
    },

    _faithName(player, kingdom) {
        if (player && player.religion && player.religion.name) return player.religion.name;
        if (kingdom && kingdom.religion) {
            const f = Religion.getKingdomFaith(kingdom);
            return (f && f.name) || kingdom.religion.name || null;
        }
        return null;
    },

    /** The two largest peoples of a settlement (deterministic). */
    _peoplesPair(settlement) {
        const demos = ((settlement && settlement.demographics) || []).filter(d => d && d.tribe && d.tribe.id);
        const sorted = demos.slice().sort((a, b) => (b.population || 0) - (a.population || 0));
        return sorted.slice(0, 2);
    },

    /** Would this petition fit this holding right now? */
    isEligible(def, base, player, world) {
        if (!def || !base) return false;
        const req = def.requires || {};
        const kinds = req.holding || ['settlement', 'office'];
        if (!kinds.includes(base.kind)) return false;
        const s = base.settlement || null;
        const pop = (s && s.population) || 0;
        if (req.minPopulation != null && (!s || pop < req.minPopulation)) return false;
        if (req.maxPopulation != null && (!s || pop > req.maxPopulation)) return false;
        if (Array.isArray(req.season) && !req.season.includes(world && world.season)) return false;
        if (req.war === true && !Petitions._atWar(player, world)) return false;
        if (req.war === false && Petitions._atWar(player, world)) return false;
        if (req.playerReligion && !player.religion) return false;
        if (req.faith && !Petitions._faithName(player, Petitions._kingdomFor(player, world, base).kingdom)) return false;
        if (req.peoples && Petitions._peoplesPair(s).length < req.peoples) return false;
        if (req.colony && !(s && s.colony)) return false;
        if (req.rivals && !Petitions._topRivalId(player)) return false;
        if (req.office && !player.currentTitle) return false;
        if (req.minPrestige != null && ((player.house && player.house.prestige) || 0) < req.minPrestige) return false;
        return true;
    },

    _randomName() {
        const names = Petitions.data().names || {};
        const given = names.given && names.given.length ? names.given : ['Petitioner'];
        const family = names.family && names.family.length ? names.family : [''];
        return `${Utils.randPick(given)} ${Utils.randPick(family)}`.trim();
    },

    /** Build a petition's context (draws names from Utils). */
    _buildCtx(def, base, player, world) {
        const { id: kingdomId, kingdom } = Petitions._kingdomFor(player, world, base);
        const s = base.settlement || null;
        const [pa, pb] = Petitions._peoplesPair(s);
        const rivalId = Petitions._topRivalId(player);
        const rival = rivalId && player.house.rivals[rivalId];
        return {
            kind: base.kind,
            q: s ? base.q : null,
            r: s ? base.r : null,
            settlementName: s ? s.name : null,
            kingdomId,
            kingdomName: kingdom ? kingdom.name : null,
            name: Petitions._randomName(),
            name2: Petitions._randomName(),
            people: pa ? pa.tribe.id : null,
            peopleName: pa ? (pa.tribe.name || pa.tribe.id) : null,
            rivalPeople: pb ? pb.tribe.id : null,
            rivalPeopleName: pb ? (pb.tribe.name || pb.tribe.id) : null,
            faith: Petitions._faithName(player, kingdom),
            house: (player.house && player.house.name) || 'your House',
            rivalId: rivalId || null,
            rival: rival ? rival.name : null,
            prior: null,
            priorChoice: null,
        };
    },

    /** Fill {tokens} in petition text from its context. */
    fill(text, ctx) {
        const c = ctx || {};
        const map = {
            name: c.name, name2: c.name2,
            settlement: c.settlementName || 'your lands',
            kingdom: c.kingdomName || 'the realm',
            people: c.peopleName || 'one people', rivalPeople: c.rivalPeopleName || 'another',
            faith: c.faith || 'the faith',
            house: c.house || 'your House',
            rival: c.rival || 'a rival House',
            prior: c.prior || 'the petitioner', priorChoice: c.priorChoice || 'your ruling',
        };
        return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
    },

    /**
     * Extra days petitioners wait at a holding: a Moot Hall (settlement.holding.fx)
     * and a governor who keeps them in hand while you are away (their
     * stewardship; systems/holdings.js).
     */
    _holdingDays(world, ctx) {
        const tile = ctx && ctx.q != null && world && typeof world.getTile === 'function' ? world.getTile(ctx.q, ctx.r) : null;
        const h = tile && tile.settlement && tile.settlement.holding;
        const fx = h && h.fx;
        let days = (fx && fx.petitionDays > 0) ? Math.round(fx.petitionDays) : 0;
        const gov = h && !h.lost && h.governor;
        if (gov) {
            const cfg = Petitions.config();
            days += Math.min(cfg.governorDaysMax, Math.floor((Number(gov.stewardship) || 0) * cfg.governorDaysPerStewardship));
        }
        return days;
    },

    _create(player, world, def, defId, ctx) {
        const st = Petitions._state(player);
        const day = (world && world.day) || 0;
        const petition = {
            id: st.nextId++,
            defId,
            title: Petitions.fill(def.title, ctx),
            icon: def.icon || '📜',
            text: Petitions.fill(def.text, ctx),
            arrivedDay: day,
            expiresDay: day + (def.expires || Petitions.config().defaultExpiry) + Petitions._holdingDays(world, ctx),
            ctx,
        };
        st.pending.push(petition);
        st.lastSeen[defId] = day;
        return petition;
    },

    /**
     * Bring a specific petition to court (tests, events, debug). Uses the
     * first holding that fits unless `base` is given. Returns it or null.
     */
    spawn(player, world, defId, base = null) {
        const def = Petitions.getDef(defId);
        if (!def) return null;
        const b = base || Petitions.holdingContexts(player, world).find(h => Petitions.isEligible(def, h, player, world));
        if (!b) return null;
        return Petitions._create(player, world, def, defId, Petitions._buildCtx(def, b, player, world));
    },

    /**
     * Bring a petition whose definition travels with it (sagas — systems/sagas.js
     * — write their own dilemmas). The def is stored on the petition, so it
     * needs no entry in data/petitions.json and is saved with the court.
     */
    spawnCustom(player, world, defId, def, base = null) {
        if (!def || !Array.isArray(def.choices)) return null;
        const b = base || Petitions.holdingContexts(player, world).find(h => Petitions.isEligible(def, h, player, world));
        if (!b) return null;
        const p = Petitions._create(player, world, def, defId, Petitions._buildCtx(def, b, player, world));
        p.def = def;
        return p;
    },

    /** A petition's definition: its own (saga petitions) or the catalogue's. */
    defOf(petition) {
        return (petition && petition.def) || Petitions.getDef(petition && petition.defId);
    },

    _spawnRandom(player, world) {
        const st = Petitions._state(player);
        const day = (world && world.day) || 0;
        const cfg = Petitions.config();
        const busy = new Set(st.pending.map(p => p.defId));
        const items = [];
        const bases = Petitions.holdingContexts(player, world);
        for (const [id, def] of Object.entries(Petitions.defs())) {
            if (def.followUpOnly || busy.has(id)) continue;
            const seen = st.lastSeen[id];
            if (seen != null && day - seen < cfg.repeatCooldown) continue;
            for (const base of bases) {
                if (Petitions.isEligible(def, base, player, world)) {
                    items.push({ value: { id, def, base }, weight: def.weight || 1 });
                }
            }
        }
        if (!items.length) return null;
        const pick = Utils.weightedPick(items);
        return Petitions._create(player, world, pick.def, pick.id, Petitions._buildCtx(pick.def, pick.base, player, world));
    },

    _cadence(player, world) {
        const cfg = Petitions.config();
        const holdings = Petitions.holdingContexts(player, world).length;
        const cut = Math.max(0, holdings - 1) * cfg.cadencePerHolding;
        const lo = Math.max(cfg.cadenceFloor, cfg.cadenceMin - cut);
        const hi = Math.max(lo, cfg.cadenceMax - cut);
        return Utils.randInt(lo, hi);
    },

    // ── Choices & effects ───────────────────────────────────────

    _effectCtx(player, world, ctx) {
        const tile = ctx && ctx.q != null && world && world.getTile ? world.getTile(ctx.q, ctx.r) : null;
        const kingdom = ctx && ctx.kingdomId && world && world.getKingdom ? world.getKingdom(ctx.kingdomId) : null;
        return {
            player, world, ctx: ctx || {},
            settlement: (tile && tile.settlement) || null,
            kingdom: kingdom || null,
            day: (world && world.day) || 0,
        };
    },

    /** Apply an effects object. Unknown keys are ignored (the registry test guards the data). */
    applyEffects(player, world, ctx, effects) {
        const c = Petitions._effectCtx(player, world, ctx);
        for (const [key, value] of Object.entries(effects || {})) {
            const fx = EFFECTS[key];
            if (fx) fx.apply(c, value);
        }
    },

    /** Human-readable list of what an effects object would do here. */
    describeEffects(effects, ctx, player = null, world = null) {
        const c = player ? Petitions._effectCtx(player, world, ctx) : null;
        const out = [];
        for (const [key, value] of Object.entries(effects || {})) {
            const fx = EFFECTS[key];
            if (!fx) continue;
            const d = fx.describe(value, ctx || {}, c);
            if (d) out.push(d);
        }
        return out;
    },

    /** Gold a choice needs on hand (its own requirement or its gold cost). */
    _goldNeeded(choice) {
        const req = (choice.requires && choice.requires.gold) || 0;
        const cost = choice.effects && choice.effects.gold < 0 ? -choice.effects.gold : 0;
        return Math.max(req, cost);
    },

    /** Can the player make this choice? { ok, reason } */
    canChoose(player, petition, choice) {
        if (!choice) return { ok: false, reason: 'No such choice.' };
        const req = choice.requires || {};
        const gold = Petitions._goldNeeded(choice);
        if (gold > 0 && (player.gold || 0) < gold) return { ok: false, reason: `Needs ${gold} gold.` };
        if (req.prestige && ((player.house && player.house.prestige) || 0) < req.prestige) {
            return { ok: false, reason: `Needs ${req.prestige} Prestige.` };
        }
        if (req.playerReligion && !player.religion) return { ok: false, reason: 'Needs a faith of your own.' };
        if (req.faith && !(petition && petition.ctx && petition.ctx.faith)) return { ok: false, reason: 'No faith to call upon here.' };
        if (req.office && !player.currentTitle) return { ok: false, reason: 'Needs a royal office.' };
        return { ok: true };
    },

    _find(player, petitionId) {
        return Petitions.pending(player).find(p => p.id === petitionId) || null;
    },

    _remove(player, petition) {
        const st = Petitions._state(player);
        st.pending = st.pending.filter(p => p !== petition);
    },

    _record(player, world, petition, entry) {
        const st = Petitions._state(player);
        const cfg = Petitions.config();
        st.history.push({
            day: (world && world.day) || 0,
            petitionId: petition.id,
            defId: petition.defId,
            title: petition.title,
            icon: petition.icon,
            where: petition.ctx && petition.ctx.settlementName,
            ...entry,
        });
        if (st.history.length > cfg.historyCap) st.history = st.history.slice(-cfg.historyCap);
    },

    /** Schedule a chained follow-up petition. Returns the schedule entry or null. */
    _scheduleFollowUp(player, world, petition, choice) {
        const fu = choice.followUp;
        if (!fu || !Array.isArray(fu.options) || !fu.options.length) return null;
        if (fu.chance != null && fu.chance < 1 && Utils.random() >= fu.chance) return null;
        const options = fu.options.filter(o => Petitions.getDef(o.id));
        if (!options.length) return null;
        const id = options.length === 1 ? options[0].id
            : Utils.weightedPick(options.map(o => ({ value: o.id, weight: o.weight || 1 })));
        const [lo, hi] = Array.isArray(fu.delay) ? fu.delay : [7, 14];
        const day = (world && world.day) || 0;
        const ctx = {
            ...petition.ctx,
            prior: petition.ctx[fu.prior || 'name'] || petition.ctx.name,
            priorChoice: Petitions.fill(choice.label, petition.ctx),
        };
        const entry = { defId: id, dueDay: day + Utils.randInt(lo, Math.max(lo, hi)), ctx, from: petition.defId };
        Petitions._state(player).scheduled.push(entry);
        return entry;
    },

    /**
     * Rule on a petition. Returns { success, text, effects: string[],
     * followUp } or { success:false, reason }.
     */
    rule(player, world, petitionId, choiceId) {
        const petition = Petitions._find(player, petitionId);
        if (!petition) return { success: false, reason: 'No such petition.' };
        const def = Petitions.defOf(petition);
        const choice = def && (def.choices || []).find(ch => ch.id === choiceId);
        const can = Petitions.canChoose(player, petition, choice);
        if (!can.ok) return { success: false, reason: can.reason };

        const ctx = petition.ctx;
        let effects = { ...(choice.effects || {}) };
        let text = Petitions.fill(choice.result, ctx);
        const described = Petitions.describeEffects(choice.effects, ctx, player, world);
        Petitions.applyEffects(player, world, ctx, choice.effects);
        if (choice.gamble) {
            const won = Utils.random() < (choice.gamble.chance || 0.5);
            const branch = won ? choice.gamble.success : choice.gamble.failure;
            if (branch) {
                described.push(...Petitions.describeEffects(branch.effects, ctx, player, world));
                Petitions.applyEffects(player, world, ctx, branch.effects);
                effects = { ...effects, gamble: won ? 'success' : 'failure' };
                if (branch.result) text = `${text} ${Petitions.fill(branch.result, ctx)}`.trim();
            }
        }

        Petitions._remove(player, petition);
        const st = Petitions._state(player);
        st.stats.ruled++;
        const followUp = Petitions._scheduleFollowUp(player, world, petition, choice);

        const notable = !!(choice.notable || choice.chronicle);
        const entry = {
            outcome: 'ruled',
            choiceId: choice.id,
            choice: Petitions.fill(choice.label, ctx),
            result: text,
            court: { ...((choice.effects && choice.effects.court) || {}) },
            notable,
        };
        Petitions._record(player, world, petition, entry);
        if (notable) {
            st.notable.push({ day: (world && world.day) || 0, title: petition.title, choice: entry.choice, court: entry.court });
            if (st.notable.length > 10) st.notable = st.notable.slice(-10);
            if (player.house) {
                const line = choice.chronicle
                    ? Petitions.fill(choice.chronicle, ctx)
                    : `${player.house.name} ruled on "${petition.title}": ${entry.choice}.`;
                House._chronicle(player.house, world, line, ['court', petition.defId]);
            }
        }
        return { success: true, text, effects: described, followUp, gamble: effects.gamble || null };
    },

    _ignore(player, world, petition, reason) {
        const def = Petitions.defOf(petition);
        const ig = (def && def.ignore) || {};
        const described = Petitions.describeEffects(ig.effects, petition.ctx, player, world);
        Petitions.applyEffects(player, world, petition.ctx, ig.effects);
        Petitions._remove(player, petition);
        const st = Petitions._state(player);
        st.stats.ignored++;
        const text = Petitions.fill(ig.result || 'The petitioners went away unheard.', petition.ctx);
        Petitions._record(player, world, petition, { outcome: reason, result: text, notable: false });
        return { petition, text, effects: described };
    },

    /** Send petitioners away unheard — the ignore cost applies at once. */
    dismiss(player, world, petitionId) {
        const petition = Petitions._find(player, petitionId);
        if (!petition) return { success: false, reason: 'No such petition.' };
        return { success: true, ...Petitions._ignore(player, world, petition, 'dismissed') };
    },

    _arriveScheduled(player, world, entry) {
        const def = Petitions.getDef(entry.defId);
        if (!def) return null;
        const ctx = { ...entry.ctx };
        // The place may have changed hands since the original ruling.
        if (ctx.q != null) {
            const tile = world && world.getTile ? world.getTile(ctx.q, ctx.r) : null;
            const owned = Taxation.getPlayerSettlements(player, world).some(s => s.q === ctx.q && s.r === ctx.r);
            const officeSeat = ctx.kind === 'office' && tile && tile.settlement;
            if (!tile || !tile.settlement || (!owned && !officeSeat)) return null;
        }
        const kinds = (def.requires && def.requires.holding) || ['settlement', 'office'];
        if (!kinds.includes(ctx.kind)) return null;
        return Petitions._create(player, world, def, entry.defId, ctx);
    },

    // ── Daily tick ──────────────────────────────────────────────

    /**
     * Advance the court one day: expire unanswered petitions, deliver due
     * follow-ups, and — once the player has holdings — bring new petitioners
     * on a cadence. Draws no RNG until the player has holdings.
     * @returns {{ arrived: object[], expired: object[] }}
     */
    processDay(player, world) {
        const out = { arrived: [], expired: [] };
        if (!player || !world) return out;
        const hasState = !!player.petitions;
        const holdings = Petitions.hasHoldings(player, world);
        if (!hasState && !holdings) return out;
        const st = Petitions._state(player);
        const day = world.day || 0;
        const cfg = Petitions.config();

        for (const p of st.pending.slice()) {
            if (day >= p.expiresDay) out.expired.push(Petitions._ignore(player, world, p, 'expired'));
        }

        for (const entry of st.scheduled.slice()) {
            if (day < entry.dueDay) continue;
            st.scheduled = st.scheduled.filter(e => e !== entry);
            const p = Petitions._arriveScheduled(player, world, entry);
            if (p) out.arrived.push(p);
        }

        if (!holdings) return out;
        if (st.nextDay == null) {
            st.nextDay = day + cfg.firstDelay;
            return out;
        }
        if (day < st.nextDay || st.pending.length >= cfg.maxPending) return out;
        const p = Petitions._spawnRandom(player, world);
        if (p) out.arrived.push(p);
        st.nextDay = day + Petitions._cadence(player, world);
        return out;
    },

    /** Days until a pending petition expires. */
    daysLeft(petition, world) {
        return Math.max(0, petition.expiresDay - ((world && world.day) || 0));
    },
};
