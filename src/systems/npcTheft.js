// ============================================
// NPC THEFT — burglars in the houses, cutpurses in the crowd
// ============================================
// The townsfolk steal too, from each other and from the player:
//
//   BURGLARS — now and then a house in town is broken into. Who: a poor or
//   crooked townsperson (a beggar, the bold and stubborn, the hungry in a
//   dearth), one of an outlaw lair's men when a lair lies near, a servant
//   pilfering from a rich household (an inside job: no door forced), or — at
//   the player's own home — a rival House's bought man (systems/
//   rivalAgents.js). What: they weigh how rich the house is (its people's
//   trades: data roleWealth), whether it stands empty (by day the working
//   household is out; by night it sleeps), and its guards and lock. How: the
//   thief picks the lock or, past their skill, forces the door (it shows
//   splintered for a while: forcedDoor), and takes coin from the household's
//   purses and goods from its boxes — the house's own containers' stores
//   (Containers.larder, settlement.larders) where the player has seen the
//   house, else the household's strongbox (a store of the same kind, stocked
//   from the town's market). Those boxes are really emptier after.
//
//   CUTPURSES — work the crowds: the market, the square, the tavern. A lift is
//   the thief's skill against the mark's awareness (lift(): the player's own
//   pickpocketing reads the same way — awareness by who the mark is); a mark
//   who notices cries out. Off the player's map it runs as a quiet background
//   rate (pickNpcs) that warms the town's cutpurse heat (state.heat: the watch
//   cracks down — fewer lifts, more caught — and the town talks of it, now and
//   then, in its annals). The player can be a mark too (pickPlayer, or on the
//   street map ui/innerMapThieves.js): told at once if they notice, else later
//   ("Your purse feels light…").
//
// Every theft is a CASE: on the town (state.cases) when the victim is a
// townsperson, on the player (player.theftBook) when it is the player. A case
// holds what was taken (the thief's own hands: coin to their purse, the goods
// held until fenced), who saw it, whether the watch was told. Each day the
// watch may catch the thief (likelier when reported, or the thief named) —
// the goods go back; or the thief fences them (fenceDays): the goods into the
// town's market (the fence pays out of the town's purse), an outlaw's into
// the lair's hoard. The player can report a case, or confront a named thief.
// Seen by anyone: the NPC's crime on the town's record
// (StreetCrime.recordNpcCrime), the witnesses remember who. The victim knows
// (Townsfolk.note 'robbed', naming the thief if seen — a grudge they tell).
//
// The player's own property — a house (player.houses / homeFurnishings), a
// let or bought house in town (lots), a property's store — can be robbed
// while the player is away from that town. Defences: the house's upgrades
// (a stout lock, a watchdog, servants, walls — data/housing.json, read here
// by playerHome.defences), an iron-bound strongbox (its own lock), the
// player at home. The ruler's watch looks away for the ruler's own deeds
// (StreetCrime.aboveLaw) but not for thieves who rob the ruler.
//
// Explicit params; no globals; every chance a hash of the world seed, the
// place and the day — never the shared RNG, so the goldens stand.
// Tuned in data/npcTheft.json.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { StreetCrime } from './streetCrime.js';
import { OutlawLairs } from './outlawLairs.js';
import { RivalAgents } from './rivalAgents.js';
import { Containers } from './containers.js';
import { SocialSkills } from './socialSkills.js';

const DEFAULTS = {
    enabled: true,
    roleWealth: { noble: 5, merchant: 4, blacksmith_npc: 3, priest: 2, guard: 2, villager: 1, farmer: 1, beggar: 0, child: 0 },
    workingRoles: ['merchant', 'blacksmith_npc', 'farmer', 'villager', 'priest', 'guard'],
    guardedRoles: { noble: 0.3, merchant: 0.08 },
    thieves: {
        poorRoles: ['beggar', 'villager', 'farmer'], crookedTraits: ['bold', 'stubborn'], honestTraits: ['kind', 'generous', 'devout'],
        poorPurse: 6, skill: { townsfolk: [2, 4], beggar: [1, 3], urchin: [2, 5], outlaw: [3, 6], agent: [4, 7], servant: [2, 4] },
        lairRadius: 4, lairShare: 0.35, agentShare: 0.6, servantShare: 0.25, urchinMinAge: 9, urchinMaxAge: 15,
    },
    burglary: {
        perNight: { village: 0.01, town: 0.025, city: 0.04, capital: 0.05 }, dearthMult: 1.8, lairMult: 1.6, nightShare: 0.7,
        nightFrom: 22, nightTo: 4, emptyMult: { day: 1.8, night: 1, away: 2.5 }, lockByWealth: [1, 2, 3, 4, 5, 7], forceAbove: 2,
        coinShare: [0.3, 0.7], maxKinds: 3, unitShare: [0.5, 1],
        catch: { base: { village: 0.06, town: 0.1, city: 0.14, capital: 0.17 }, nightOccupied: 0.12, forced: 0.08, perSkill: -0.025, min: 0.02, max: 0.8 },
        seenChance: 0.3, fenceDays: [2, 6], fenceShare: 0.35, watchLater: { village: 0.03, town: 0.05, city: 0.06, capital: 0.07 },
        reportedMult: 2.5, namedMult: 2, forcedDays: 6, rummageSeconds: 10,
    },
    playerHome: {
        perNight: { village: 0.008, town: 0.014, city: 0.02, capital: 0.024 }, perValue: 0.0006, maxValueMult: 3, agentPerNight: 0.03,
        propertyShare: 0.35, defences: {}, servantPilfer: 0.004, lockedPieces: { iron_strongbox: 6 }, doorLock: { default: 2 },
        takeShare: [0.4, 0.9], clues: { witness: 0.4, dropped: 0.35, rumourDays: [3, 12], rumour: 0.5 },
    },
    pickpocket: {
        perDay: { village: 0.05, town: 0.12, city: 0.2, capital: 0.26 }, playerPerDay: { village: 0.02, town: 0.05, city: 0.08, capital: 0.1 },
        playerGoldLooks: 400, watchDeter: 0.08, rulerWatchMult: 0.5, heatPerLift: 1, heatDecay: 0.1, crackdownAt: 6, crackdownCatch: 0.15,
        annalAt: 4, annalEvery: 30, coinShare: [0.15, 0.45], playerCoinMax: 60, itemChance: 0.25,
        awareness: { noble: 0.6, merchant: 0.45, guard: 0.7, priest: 0.25, villager: 0.3, farmer: 0.2, beggar: 0.15, traveler: 0.35, child: 0.2 },
        playerAwareness: { base: 0.3, perIntelligence: 0.03, perStealthLevel: 0.04, wary: 0.2, waryDays: 10, max: 0.85 },
        lift: { base: 0.5, perSkill: 0.06, perAwareness: -0.45, min: 0.08, max: 0.92 },
        notice: { base: 0.2, perAwareness: 0.5, perSkill: -0.04, min: 0.05, max: 0.85 },
        watchCatch: { village: 0.25, town: 0.35, city: 0.4, capital: 0.45 }, chaseCatch: { base: 0.35, perStrength: 0.03, max: 0.8 },
        crowdMin: 4, everySeconds: [25, 55], tellAfterSeconds: [15, 40], watchRadius: 6, hearRadius: 12,
    },
    grab: { base: 0.35, perStrength: 0.04, perSkill: -0.04, min: 0.1, max: 0.85 },
    confront: { base: 0.4, perCharisma: 0.04, perStrength: 0.02, meekTraits: ['cautious', 'quiet', 'kind'], meek: 0.25, boldTraits: ['bold', 'stubborn'], bold: -0.2 },
    dropped: {},
    barks: {},
};

const MAX_CASES = 30;
const MAX_ENTRIES = 30;
// The town's watch strength by its size (world/innerMap/townLife.js keeps the same numbers)
const WATCH = { village: 2, town: 5, city: 8, capital: 12 };

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _byType = (table, type) => _num((table || {})[type], _num((table || {}).town, 0));
const _cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (_obj(v) && _obj(base[k])) ? _merge(base[k], v) : v;
    }
    return out;
}

/** Pick from weighted entries [{ w, ... }] by a hash in [0, 1). */
function _weighted(list, f) {
    const total = list.reduce((a, x) => a + Math.max(0, x.w), 0);
    if (total <= 0) return null;
    let t = f * total;
    for (const x of list) { t -= Math.max(0, x.w); if (t < 0) return x; }
    return list[list.length - 1];
}

/** An integer in [lo, hi] from a hash. */
function _span(range, f) {
    const [lo, hi] = Array.isArray(range) ? range : [range, range];
    return Math.floor(_num(lo) + f * (Math.max(_num(lo), _num(hi)) - _num(lo) + 1 - 1e-9));
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _goodName(id) {
    return String(Containers.good(id).name || id).toLowerCase();
}

let _cfg = null;
let _cfgSrc;

export const NpcTheft = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.npcTheft : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    /** Is the hour (0-24) a burglar's? */
    isNight(hour) {
        const B = NpcTheft.config().burglary;
        const h = _num(hour, 12);
        return B.nightFrom > B.nightTo ? (h >= B.nightFrom || h < B.nightTo) : (h >= B.nightFrom && h < B.nightTo);
    },

    // ══════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════

    /** A town's theft record (saved with the tile): { heat, lastAnnal, night, cases, homes, houses, playerDoor, nextId }. */
    state(s) {
        if (!s) return null;
        if (!_obj(s.npcTheft)) s.npcTheft = { heat: 0, lastAnnal: null, night: null, pickDay: null, cases: [], homes: {}, houses: {}, playerDoor: null, nextId: 1 };
        const st = s.npcTheft;
        if (!Array.isArray(st.cases)) st.cases = [];
        if (!_obj(st.homes)) st.homes = {};
        if (!_obj(st.houses)) st.houses = {};
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        if (!Number.isFinite(st.heat)) st.heat = 0;
        return st;
    },

    /** The player's book of what was stolen from them (saved): { entries, nextId, waryUntil }. */
    book(player) {
        if (!player) return null;
        if (!_obj(player.theftBook)) player.theftBook = { entries: [], nextId: 1, waryUntil: null };
        const b = player.theftBook;
        if (!Array.isArray(b.entries)) b.entries = [];
        if (!Number.isFinite(b.nextId)) b.nextId = 1;
        return b;
    },

    /** The house a townsperson lives in on the street map (seen there by the player): its building key. */
    noteHome(s, pid, building) {
        const st = NpcTheft.state(s);
        if (!st || pid == null || !building) return;
        st.homes[pid] = `${String(building.type || 'house').replace(/^player_/, '')}@${_num(building.q)},${_num(building.r)}`;
    },

    /** A house's door forced open lately (shown splintered): its record, or null. */
    forcedDoor(s, bkey, day) {
        const st = s && _obj(s.npcTheft);
        const h = st && st.houses && st.houses[bkey];
        if (!h || h.forced == null) return null;
        return _num(day) - _num(h.forced) <= _num(NpcTheft.config().burglary.forcedDays, 6) ? h : null;
    },

    // ══════════════════════════════════════════════
    // WHO
    // ══════════════════════════════════════════════

    /** Wealth of a townsperson's household (0-5) from its people's trades. */
    wealthOf(people) {
        const W = NpcTheft.config().roleWealth;
        let w = 0;
        for (const p of people || []) w = Math.max(w, _num(W[p.role], 1));
        return w;
    },

    /** The households of a town: [{ head, people (adults), kids, wealth, purse }]. */
    households(folk, world, day) {
        if (!folk) return [];
        const seen = new Set();
        const out = [];
        for (const p of Townsfolk.residents(folk)) {
            if (seen.has(p.id) || p.role === 'child' || Townsfolk.age(p, day) < 16) continue;
            const sp = p.spouse != null ? Townsfolk.get(folk, p.spouse) : null;
            const adults = [p];
            if (sp && Townsfolk.isHere(sp) && !seen.has(sp.id)) adults.push(sp);
            for (const a of adults) seen.add(a.id);
            const head = adults.reduce((m, a) => (a.id < m.id ? a : m), adults[0]);
            const kids = (p.kids || []).map(id => Townsfolk.get(folk, id)).filter(k => k && Townsfolk.isHere(k) && Townsfolk.age(k, day) < 16);
            out.push({ head, people: adults, kids, wealth: NpcTheft.wealthOf(adults), purse: adults.reduce((t, a) => t + Townsfolk.purse(folk, a, world), 0) });
        }
        return out;
    },

    /** A thief's skill (1-10), stable for who they are. */
    skillOf(kind, key) {
        const S = NpcTheft.config().thieves.skill || {};
        return _clamp(_span(S[kind] || [2, 4], _frac(`skill|${key}`)), 1, 10);
    },

    _lairNear(world, s, player) {
        if (!player) return null;
        const T = NpcTheft.config().thieves;
        let best = null;
        let lairs = [];
        try { lairs = OutlawLairs.active(player) || []; } catch { lairs = []; }
        for (const l of lairs) {
            const d = Math.max(Math.abs(_num(l.q) - s.q), Math.abs(_num(l.r) - s.r));
            if (d <= _num(T.lairRadius, 4) && (!best || d < best.d)) best = { l, d };
        }
        return best ? best.l : null;
    },

    /** Is this townsperson the thieving kind (poor, crooked, desperate)? */
    isCrooked(folk, p, world, day, dearth = false) {
        const T = NpcTheft.config().thieves;
        if (!p || !Townsfolk.isHere(p) || ['guard', 'priest', 'noble', 'child'].includes(p.role) || Townsfolk.age(p, day) < 16) return false;
        const t = p.traits || [];
        if (t.some(x => (T.honestTraits || []).includes(x))) return false;
        // (the poor out of work, whatever their trade was: some of them turn to it)
        if (NpcTheft.isJobless(p) && Townsfolk.purse(folk, p, world) < _num(T.poorPurse, 6)
            && _frac(`jobless|${folk.q},${folk.r}|${p.id}|${p.job.since}`) < _num(T.joblessShare, 0.45)) return true;
        if (!(T.poorRoles || []).includes(p.role)) return false;
        const poor = Townsfolk.purse(folk, p, world) < _num(T.poorPurse, 6);
        return p.role === 'beggar' || t.some(x => (T.crookedTraits || []).includes(x)) || (dearth && poor);
    },

    /** Out of work (systems/townJobs.js: the 'unemployed', not in anyone's service)? */
    isJobless(p) {
        return !!(p && p.job && p.job.id === 'unemployed' && p.job.employer !== 'player');
    },

    /** A thief from the town's people: { name, kind, pid, skill } or null. */
    _townThief(world, s, day, salt, exclude = new Set(), opts = {}) {
        const folk = s.folk;
        if (!folk) return null;
        const dearth = (() => { try { return SettlementMarket.inDearth(s); } catch { return false; } })();
        const T = NpcTheft.config().thieves;
        const free = p => !(p.jailedUntil != null && day < p.jailedUntil);
        const pool = Townsfolk.residents(folk).filter(p => !exclude.has(p.id) && free(p) && NpcTheft.isCrooked(folk, p, world, day, dearth));
        if (opts.urchins) {
            for (const p of Townsfolk.residents(folk)) {
                const age = Townsfolk.age(p, day);
                if (exclude.has(p.id) || !free(p) || age < _num(T.urchinMinAge, 9) || age > _num(T.urchinMaxAge, 15)) continue;
                if ((p.traits || []).some(x => (T.honestTraits || []).includes(x))) continue;
                if ((p.traits || []).some(x => (T.crookedTraits || []).includes(x))) pool.push(p);
            }
        }
        if (!pool.length) return null;
        // (the out-of-work are likelier: joblessWeight entries each)
        const jw = Math.max(1, Math.round(_num(T.joblessWeight, 2)));
        const weighted = [];
        for (const q of pool) for (let i = 0; i < (NpcTheft.isJobless(q) ? jw : 1); i++) weighted.push(q);
        const p = weighted[Math.floor(_frac(`${salt}|who`) * weighted.length) % weighted.length];
        const kind = p.role === 'beggar' ? 'beggar' : (Townsfolk.age(p, day) < 16 ? 'urchin' : 'townsfolk');
        return { name: Townsfolk.name(p), kind, pid: p.id, skill: NpcTheft.skillOf(kind, `${s.q},${s.r}|${p.id}`) };
    },

    /** An outlaw from the lair near this town, or null. */
    _outlaw(world, s, player, salt) {
        const lair = NpcTheft._lairNear(world, s, player);
        if (!lair) return null;
        return { name: `one of ${lair.name || 'the outlaws'}'s men`, kind: 'outlaw', lairId: lair.id != null ? lair.id : null, skill: NpcTheft.skillOf('outlaw', `${lair.id}|${salt}`) };
    },

    /** A rival House's bought townsperson in this town (only against the player), or null. */
    _agent(player, s, salt) {
        let agents = [];
        try { agents = RivalAgents.list(player) || []; } catch { agents = []; }
        const here = agents.filter(a => a && a.q === s.q && a.r === s.r && !a.turned);
        if (!here.length) return null;
        const a = here[Math.floor(_frac(`${salt}|agent`) * here.length) % here.length];
        return { name: a.name || 'a stranger', kind: 'agent', pid: a.pid != null ? a.pid : null, agentId: a.id, rivalId: a.rivalId, rivalName: a.rivalName || 'a rival House', skill: NpcTheft.skillOf('agent', `${a.id}`) };
    },

    // ══════════════════════════════════════════════
    // BURGLARY — the townsfolk's houses
    // ══════════════════════════════════════════════

    /** The houses worth a try tonight: [{ w, hh, when, empty, lock, guarded }]. */
    targets(world, s, day, when, exclude = new Set()) {
        const C = NpcTheft.config();
        const B = C.burglary;
        const out = [];
        for (const hh of NpcTheft.households(s.folk, world, day)) {
            if (hh.people.some(p => exclude.has(p.id))) continue;
            if (hh.wealth <= 0 && hh.purse <= 2) continue;
            if (hh.people.some(p => p.robbedDay != null && day - p.robbedDay < _num(B.againAfter, 20))) continue;
            const working = hh.people.every(p => (C.workingRoles || []).includes(p.role));
            const empty = when === 'day' ? working : false;
            const emptyMult = empty ? _num(B.emptyMult.day, 1.8) : _num(B.emptyMult.night, 1);
            const w = (1 + hh.wealth * hh.wealth) * emptyMult * (1 + Math.min(3, hh.purse / 40));
            const locks = B.lockByWealth || [1, 2, 3, 4, 5, 7];
            const lock = _num(locks[Math.min(locks.length - 1, hh.wealth)], 2);
            const guarded = Math.max(...hh.people.map(p => _num((C.guardedRoles || {})[p.role], 0)));
            out.push({ w, hh, when, empty, lock, guarded });
        }
        return out;
    },

    /**
     * Tonight's burglary in a town, if there is one — the same answer every time
     * it is asked (a hash of the seed, the town, the day): { key, day, thief,
     * target, when, force, caught, seen, inside } or null.
     */
    planBurglary(world, s, day, player = null) {
        const C = NpcTheft.config();
        const B = C.burglary;
        if (!C.enabled || !s || !s.folk) return null;
        const st = NpcTheft.state(s);
        if (st.night === day) return null;
        const key = `${_seed(world)}|burgle|${s.q},${s.r}|${day}`;
        let p = _byType(B.perNight, s.type);
        let dearth = false;
        try { dearth = SettlementMarket.inDearth(s); } catch { dearth = false; }
        if (dearth) p *= _num(B.dearthMult, 1.8);
        const lair = NpcTheft._lairNear(world, s, player);
        if (lair) p *= _num(B.lairMult, 1.6);
        p /= 1 + Math.max(0, st.heat - _num(C.pickpocket.crackdownAt, 6)) * 0.1;
        if (_frac(key) >= p) return null;
        const when = _frac(`${key}|when`) < _num(B.nightShare, 0.7) ? 'night' : 'day';
        // The thief: an outlaw from the hills, or one of the town's own
        let thief = null;
        if (lair && _frac(`${key}|lair`) < _num(C.thieves.lairShare, 0.35)) thief = NpcTheft._outlaw(world, s, player, key);
        if (!thief) thief = NpcTheft._townThief(world, s, day, key);
        if (!thief && lair) thief = NpcTheft._outlaw(world, s, player, key);
        // Their own household is not a mark
        const exclude = new Set();
        if (thief && thief.pid != null) {
            const tp = Townsfolk.get(s.folk, thief.pid);
            exclude.add(thief.pid);
            if (tp) { if (tp.spouse != null) exclude.add(tp.spouse); for (const id of [...(tp.parents || []), ...(tp.kids || [])]) exclude.add(id); }
        }
        let targets = NpcTheft.targets(world, s, day, when, exclude);
        // A rich household's servant: an inside job
        let inside = false;
        if (_frac(`${key}|servant`) < _num(C.thieves.servantShare, 0.25)) {
            const rich = targets.filter(t => t.hh.wealth >= 4);
            if (rich.length) {
                const t = _weighted(rich, _frac(`${key}|richT`));
                const serv = NpcTheft._townThief(world, s, day, `${key}|serv`, new Set([...exclude, ...t.hh.people.map(x => x.id)]));
                if (serv) { thief = { ...serv, kind: 'servant', skill: NpcTheft.skillOf('servant', `${s.q},${s.r}|${serv.pid}`) }; targets = [t]; inside = true; }
            }
        }
        if (!thief || !targets.length) return null;
        const target = _weighted(targets, _frac(`${key}|target`));
        if (!target) return null;
        const force = !inside && target.lock > thief.skill + _num(B.forceAbove, 2) - 1;
        const K = B.catch;
        let c = _byType(K.base, s.type) + target.guarded + (when === 'night' && !target.empty ? _num(K.nightOccupied) : 0)
            + (force ? _num(K.forced) : 0) + thief.skill * _num(K.perSkill);
        c *= 1 + Math.max(0, st.heat - _num(C.pickpocket.crackdownAt, 6)) * _num(C.pickpocket.crackdownCatch, 0.15);
        c = _clamp(c, _num(K.min, 0.02), _num(K.max, 0.8));
        const caught = _frac(`${key}|caught`) < c;
        const seen = caught || _frac(`${key}|seen`) < _num(B.seenChance, 0.3);
        return { key, day, thief, target: { pid: target.hh.head.id, name: Townsfolk.name(target.hh.head), wealth: target.hh.wealth, lock: target.lock, empty: target.empty }, when, force, inside, caught, seen, catchChance: c };
    },

    /** The household's own boxes in town: their container records (settlement.larders) or the strongbox. */
    _houseStores(world, s, pid) {
        const st = NpcTheft.state(s);
        const bkey = st.homes[pid] || null;
        const stores = [];
        if (bkey && _obj(s.larders)) {
            for (const [k, rec] of Object.entries(s.larders)) {
                if (k.split('|')[1] === bkey && rec && _obj(rec.stock)) stores.push({ key: k, rec });
            }
        }
        if (!stores.length) {
            // The household's strongbox: a chest's store like any house's, stocked from the town's market
            const ctx = { worldQ: s.q, worldR: s.r, inSettlement: true, building: { type: 'house', q: -1, r: _num(pid) }, q: 0, r: 0, furnitureType: 'chest' };
            const tile = world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
            const rec = tile && tile.settlement === s ? Containers.larder(null, world, ctx) : NpcTheft._looseLarder(world, s, ctx);
            if (rec) stores.push({ key: Containers.key(ctx), rec });
        }
        return { bkey, stores };
    },

    /** A strongbox's store when the town isn't on a tile we can reach (a bare test town). */
    _looseLarder(world, s, ctx) {
        if (!_obj(s.larders)) s.larders = {};
        const k = Containers.key(ctx);
        if (!s.larders[k]) {
            const rec = { period: Containers.period(world), stock: {}, stolen: {}, bought: 0 };
            for (const [id, n] of Object.entries(Containers.stocked(world, ctx))) {
                const got = SettlementMarket.tracks(id) ? Math.floor(SettlementMarket.take(s, id, Math.min(n, SettlementMarket.available(s, id))) + 1e-9) : 0;
                if (got > 0) rec.stock[id] = got;
            }
            s.larders[k] = rec;
        }
        return s.larders[k];
    },

    /** Take the best of some stores: valuables first, up to maxKinds kinds. → { goods, from: { key: { id: n } } } */
    _rifle(stores, key, share = null) {
        const B = NpcTheft.config().burglary;
        const all = [];
        for (const { key: k, rec } of stores) {
            for (const [id, n] of Object.entries(rec.stock || {})) if (_num(n) >= 1) all.push({ k, rec, id, n: Math.floor(n), v: _num(Containers.good(id).basePrice, 1) });
        }
        all.sort((a, b) => (b.v - a.v) || (_frac(`${key}|${a.id}`) - _frac(`${key}|${b.id}`)));
        const goods = {};
        const from = {};
        let kinds = 0;
        for (const x of all) {
            if (!goods[x.id] && kinds >= _num(B.maxKinds, 3)) continue;
            const sh = share != null ? share : (_num(B.unitShare[0], 0.5) + _frac(`${key}|share|${x.id}`) * (_num(B.unitShare[1], 1) - _num(B.unitShare[0], 0.5)));
            const n = Math.max(1, Math.min(x.n, Math.round(x.n * sh)));
            if (!goods[x.id]) kinds++;
            goods[x.id] = _num(goods[x.id]) + n;
            x.rec.stock[x.id] = Math.max(0, _num(x.rec.stock[x.id]) - n);
            if (!x.rec.stock[x.id]) delete x.rec.stock[x.id];
            if (!_obj(x.rec.stolen)) x.rec.stolen = {};
            x.rec.stolen[x.id] = _num(x.rec.stolen[x.id]) + n;
            (from[x.k] = from[x.k] || {})[x.id] = _num((from[x.k] || {})[x.id]) + n;
        }
        return { goods, from };
    },

    /**
     * Carry out a burglary: the door picked or forced, the household's coin
     * and goods into the thief's hands (or, caught, nothing moves). opts:
     * { caught, seenBy: [names], witnesses: [npc] (on the street map) }.
     * → the case, with { text }
     */
    commitBurglary(world, s, plan, player = null, opts = {}) {
        if (!plan || !s || !s.folk) return null;
        const C = NpcTheft.config();
        const B = C.burglary;
        const st = NpcTheft.state(s);
        st.night = plan.day;
        const day = plan.day;
        const caught = opts.caught != null ? !!opts.caught : plan.caught;
        const seenBy = Array.isArray(opts.seenBy) ? opts.seenBy.filter(Boolean) : (plan.seen ? NpcTheft._neighbour(s, plan, day) : []);
        const head = Townsfolk.get(s.folk, plan.target.pid);
        if (!head) return null;
        const people = [head];
        if (head.spouse != null) { const sp = Townsfolk.get(s.folk, head.spouse); if (sp && Townsfolk.isHere(sp)) people.push(sp); }
        const { bkey, stores } = NpcTheft._houseStores(world, s, head.id);
        const c = NpcTheft._newCase(st, {
            k: 'burglary', d: day, thief: plan.thief, victim: { kind: 'npc', pid: head.id, name: Townsfolk.name(head) },
            forced: !!plan.force, inside: !!plan.inside, when: plan.when, bkey,
        });
        if (!caught) {
            // Coin: a share of the household's purses
            const shareC = _num(B.coinShare[0], 0.3) + _frac(`${plan.key}|coin`) * (_num(B.coinShare[1], 0.7) - _num(B.coinShare[0], 0.3));
            let coin = 0;
            for (const p of people) {
                const take = Math.floor(Townsfolk.purse(s.folk, p, world) * shareC);
                p.purse = _num(p.purse) - take;
                coin += take;
                c.purses[p.id] = take;
            }
            c.coin = coin;
            const r = NpcTheft._rifle(stores, plan.key);
            c.goods = r.goods;
            c.from = r.from;
            NpcTheft._pay(world, s, player, plan.thief, coin);
            c.fenceDay = day + _span(B.fenceDays, _frac(`${plan.key}|fence`));
        } else {
            c.status = 'caught';
            NpcTheft._jail(s, plan.thief, day, 'housebreaking');
        }
        if (bkey) {
            const h = st.houses[bkey] || (st.houses[bkey] = {});
            h.d = day;
            if (plan.force) h.forced = day;
            h.caseId = c.id;
        }
        c.seenBy = seenBy.slice(0, 3);
        c.named = seenBy.length > 0 || caught;
        // The household knows; a grudge against the thief if anyone saw who
        for (const p of people) p.robbedDay = day;
        for (const p of people) Townsfolk.note(p, day, 'robbed', c.named && plan.thief.pid != null ? plan.thief.pid : null, NpcTheft.describe(c) || 'little');
        // Seen by anyone: the thief's crime on the town's record
        if (c.named) {
            StreetCrime.recordNpcCrime(world, s, {
                k: 'burglary', by: plan.thief.name, byPid: plan.thief.pid != null ? plan.thief.pid : null,
                victim: c.victim.name, vuid: `pid${head.id}`, d: day, seenBy, witnesses: opts.witnesses || [], caught,
            });
        }
        // The town talks of it
        if (Array.isArray(s.folk.annals)) {
            const what = caught ? 'caught at it by the watch' : (plan.force ? 'the door forced' : (plan.inside ? 'by someone inside the house' : 'the lock picked'));
            const by = c.named ? `, and folk say it was ${plan.thief.name}` : '';
            Townsfolk.record(s.folk, world, day, { k: 'npcTheft', a: head.id, x: `The house of ${c.victim.name} was broken into {when} — ${what}${by}.` });
        }
        c.text = caught
            ? `${_cap(plan.thief.name)} was caught by the watch breaking into ${c.victim.name}'s house.`
            : `${_cap(plan.thief.name)} broke into ${c.victim.name}'s house${plan.force ? ', forcing the door,' : ''} and made off with ${NpcTheft.describe(c) || 'nothing much'}.`;
        return c;
    },

    /** A neighbour who saw who it was. */
    _neighbour(s, plan, day) {
        const folk = s.folk;
        const pool = Townsfolk.residents(folk).filter(p => p.id !== plan.target.pid && p.id !== plan.thief.pid && Townsfolk.age(p, day) >= 12);
        if (!pool.length) return ['a neighbour'];
        return [Townsfolk.name(pool[Math.floor(_frac(`${plan.key}|nb`) * pool.length) % pool.length])];
    },

    _newCase(st, fields) {
        const c = { id: st.nextId++, status: 'open', coin: 0, goods: {}, from: {}, purses: {}, seenBy: [], named: false, reported: false, fenceDay: null, ...fields };
        st.cases.push(c);
        if (st.cases.length > MAX_CASES) st.cases.splice(0, st.cases.length - MAX_CASES);
        return c;
    },

    /** The thief's coin goes where they keep it: a townsperson's purse, a lair's hoard, a rival House's purse. */
    _pay(world, s, player, thief, coin) {
        const n = Math.max(0, Math.floor(_num(coin)));
        if (!n || !thief) return 0;
        if (thief.pid != null && s.folk && thief.kind !== 'agent') {
            const p = Townsfolk.get(s.folk, thief.pid);
            if (p) { p.purse = Townsfolk.purse(s.folk, p, world) + n; return n; }
        }
        if (thief.kind === 'outlaw' && player) {
            const lair = thief.lairId != null ? OutlawLairs.find(player, thief.lairId) : null;
            if (lair) { if (!_obj(lair.hoard)) lair.hoard = { gold: 0, goods: {} }; lair.hoard.gold = _num(lair.hoard.gold) + n; return n; }
        }
        if (thief.kind === 'agent' && player && player.house && player.house.rivals) {
            const h = player.house.rivals[thief.rivalId];
            if (h) { h.purse = _num(h.purse) + n; return n; }
        }
        // (no one to hold it: it stays with the town — its purse)
        if (s.economy && Number.isFinite(s.economy.gold)) s.economy.gold += n;
        return n;
    },

    /** Take back what the thief still has of the coin (caught). → coin recovered */
    _unpay(world, s, player, thief, coin) {
        const n = Math.max(0, Math.floor(_num(coin)));
        if (!n || !thief) return 0;
        if (thief.pid != null && s.folk && thief.kind !== 'agent') {
            const p = Townsfolk.get(s.folk, thief.pid);
            if (p) { const got = Math.min(n, Math.max(0, _num(p.purse))); p.purse = _num(p.purse) - got; return got; }
        }
        if (thief.kind === 'outlaw' && player) {
            const lair = thief.lairId != null ? OutlawLairs.find(player, thief.lairId) : null;
            if (lair && lair.hoard) { const got = Math.min(n, Math.max(0, _num(lair.hoard.gold))); lair.hoard.gold -= got; return got; }
        }
        if (thief.kind === 'agent' && player && player.house && player.house.rivals) {
            const h = player.house.rivals[thief.rivalId];
            if (h) { const got = Math.min(n, Math.max(0, _num(h.purse))); h.purse -= got; return got; }
        }
        if (s.economy && Number.isFinite(s.economy.gold)) { const got = Math.min(n, Math.max(0, s.economy.gold)); s.economy.gold -= got; return got; }
        return 0;
    },

    _jail(s, thief, day, what) {
        if (thief && thief.pid != null && s.folk) {
            const p = Townsfolk.get(s.folk, thief.pid);
            if (p) { Townsfolk.note(p, day, 'jailed', null, what); p.jailedUntil = day + _num(NpcTheft.config().thieves.jailDays, 20); }
        }
    },

    /** "12 gold, 2 candles and an amulet" — what a case took. */
    describe(c) {
        if (!c) return '';
        const parts = [];
        if (_num(c.coin) > 0) parts.push(`${c.coin} gold`);
        for (const [id, n] of Object.entries(c.goods || {})) if (n > 0) parts.push(`${n} ${_goodName(id)}`);
        if (!parts.length) return '';
        return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    },

    // ══════════════════════════════════════════════
    // THE PLAYER'S OWN PROPERTY
    // ══════════════════════════════════════════════

    /**
     * What the player keeps in town that a burglar could reach: their homes
     * (the furnished layouts with things in store) and their properties' stores.
     * → [{ id, kind: 'home'|'property', q, r, name, homeKey?, pieces?, property? }]
     */
    playerSites(player, world) {
        const out = [];
        if (!player) return out;
        for (const [homeKey, rec] of Object.entries(_obj(player.homeFurnishings) || {})) {
            const m = /^(house|lot|vac|prop|bld):(-?\d+),(-?\d+)/.exec(homeKey);
            if (!m || !rec || !Array.isArray(rec.pieces)) continue;
            const pieces = rec.pieces.filter(pc => pc && _obj(pc.storage) && Object.values(pc.storage).some(n => _num(n) > 0));
            out.push({ id: `home:${homeKey}`, kind: 'home', q: Number(m[2]), r: Number(m[3]), name: rec.name || 'your house', homeKey, pieces });
        }
        // A house of player.houses not yet furnished keeps nothing in store; its upgrades still count
        for (const p of player.properties || []) {
            const tile = world && typeof world.getTile === 'function' ? world.getTile(p.q, p.r) : null;
            if (!tile || !tile.settlement) continue;
            for (const prop of tile.playerProperties || []) {
                if (!prop || prop.underConstruction || !prop.produces || prop.produces === 'gold' || !(_num(prop.storage) > 0)) continue;
                if (prop.type !== p.type && prop.id !== p.type) continue;
                out.push({ id: `prop:${p.q},${p.r}:${p.type}`, kind: 'property', q: p.q, r: p.r, name: p.name || 'your property', property: prop });
            }
        }
        return out;
    },

    /** The house of player.houses at a town, if any. */
    _houseAt(player, q, r) {
        return (player && player.houses || []).find(h => h && h.q === q && h.r === r) || null;
    },

    /** What keeps thieves off the player's place in a town: { mult, labels, upgrades, door }. */
    defencesAt(player, q, r) {
        const H = NpcTheft.config().playerHome;
        const house = NpcTheft._houseAt(player, q, r);
        const ups = (house && Array.isArray(house.upgrades)) ? house.upgrades : [];
        let mult = 1;
        const labels = [];
        for (const id of ups) {
            const d = (H.defences || {})[id];
            if (!d) continue;
            mult *= _num(d.mult, 1);
            labels.push(d.label || id);
        }
        const doorL = H.doorLock || {};
        let door = _num(doorL.default, 2);
        for (const id of ups) if (doorL[id] != null) door = Math.max(door, _num(doorL[id]));
        return { mult, labels, upgrades: ups, door };
    },

    /** What the player's things there are worth (gold). */
    siteValue(site) {
        let v = 0;
        if (site.kind === 'home') {
            for (const pc of site.pieces || []) {
                for (const [id, n] of Object.entries(pc.storage || {})) v += id === 'gold' ? _num(n) : _num(Containers.good(id).basePrice, 1) * _num(n);
            }
        } else if (site.property) {
            v = _num(Containers.good(site.property.produces).basePrice, 1) * _num(site.property.storage);
        }
        return v;
    },

    /** Tonight's burglary of one of the player's places, if any: a plan like planBurglary's. */
    planPlayerBurglary(world, player, site, day) {
        const C = NpcTheft.config();
        const H = C.playerHome;
        if (!C.enabled || !site) return null;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(site.q, site.r) : null;
        const s = tile && tile.settlement;
        if (!s) return null;
        // At home: no one tries
        if (player.q === site.q && player.r === site.r) return null;
        const value = NpcTheft.siteValue(site);
        if (value <= 0) return null;
        const key = `${_seed(world)}|burgleP|${site.id}|${day}`;
        const def = NpcTheft.defencesAt(player, site.q, site.r);
        const agent = NpcTheft._agent(player, s, key);
        let p = _byType(H.perNight, s.type) * Math.min(_num(H.maxValueMult, 3), 1 + value * _num(H.perValue)) * def.mult;
        if (site.kind === 'property') p *= _num(H.propertyShare, 0.35);
        if (agent) p += _num(H.agentPerNight, 0.03) * def.mult;
        // Servants who help themselves: an inside job no lock keeps out
        const pilfer = def.upgrades.includes('servants') && _frac(`${key}|pilfer`) < _num(H.servantPilfer, 0.004);
        if (!pilfer && _frac(key) >= p) return null;
        let thief = null;
        if (pilfer) thief = { name: 'one of your own servants', kind: 'servant', skill: NpcTheft.skillOf('servant', key) };
        else if (agent && _frac(`${key}|ag`) < _num(C.thieves.agentShare, 0.6)) thief = agent;
        if (!thief && _frac(`${key}|lair`) < _num(C.thieves.lairShare, 0.35)) thief = NpcTheft._outlaw(world, s, player, key);
        if (!thief) thief = NpcTheft._townThief(world, s, day, key);
        if (!thief) thief = NpcTheft._outlaw(world, s, player, key) || agent;
        if (!thief) return null;
        const force = thief.kind !== 'servant' && def.door > thief.skill + _num(C.burglary.forceAbove, 2) - 1;
        const K = C.burglary.catch;
        const c = _clamp(_byType(K.base, s.type) + (force ? _num(K.forced) : 0) + thief.skill * _num(K.perSkill), _num(K.min, 0.02), _num(K.max, 0.8));
        const caught = _frac(`${key}|caught`) < c;
        return { key, day, site, s, thief, force, caught, defences: def, value };
    },

    /**
     * Rob the player's place: the goods out of its boxes (an iron-bound
     * strongbox holds unless the thief's skill beats its lock) or the
     * property's store, into the thief's hands; the case on the player's book
     * with its clues. → the entry, or null (nothing to take)
     */
    commitPlayerBurglary(world, player, plan) {
        if (!plan) return null;
        const C = NpcTheft.config();
        const H = C.playerHome;
        const { site, s, thief, key, day } = plan;
        const st = NpcTheft.state(s);
        const book = NpcTheft.book(player);
        const share = _num(H.takeShare[0], 0.4) + _frac(`${key}|take`) * (_num(H.takeShare[1], 0.9) - _num(H.takeShare[0], 0.4));
        const goods = {};
        const from = {};
        let coin = 0;
        let forcedBox = null;
        let heldBox = null;
        if (!plan.caught) {
            if (site.kind === 'home') {
                for (const pc of site.pieces || []) {
                    const lock = _num((H.lockedPieces || {})[pc.id], 0);
                    if (lock > 0) {
                        if (thief.skill + _frac(`${key}|box|${pc.uid}`) * 2 < lock) { heldBox = pc; continue; }
                        forcedBox = pc;
                    }
                    for (const [id, n] of Object.entries(pc.storage || {})) {
                        const take = Math.min(_num(n), Math.max(1, Math.round(_num(n) * share)));
                        if (!(take > 0)) continue;
                        pc.storage[id] = _num(n) - take;
                        if (!(pc.storage[id] > 0)) delete pc.storage[id];
                        if (id === 'gold') coin += take;
                        else goods[id] = _num(goods[id]) + take;
                        (from[pc.uid] = from[pc.uid] || {})[id] = _num((from[pc.uid] || {})[id]) + take;
                    }
                }
            } else if (site.property) {
                const take = Math.max(1, Math.round(_num(site.property.storage) * share * 0.5));
                site.property.storage = Math.max(0, _num(site.property.storage) - take);
                goods[site.property.produces] = take;
                from.property = { [site.property.produces]: take };
            }
            if (!coin && !Object.keys(goods).length) {
                // A strongbox that held: they left with nothing — but the door is still forced
                if (!plan.force && !heldBox) return null;
            }
            NpcTheft._pay(world, s, player, thief, coin);
        }
        st.playerDoor = plan.force ? { d: day, site: site.id } : st.playerDoor;
        const e = {
            id: book.nextId++, k: 'burglary', d: day, q: site.q, r: site.r, town: s.name || 'the town', site: site.id, siteName: site.name, siteKind: site.kind,
            thief, coin, goods, from, forced: !!plan.force, forcedBox: forcedBox ? (forcedBox.look && forcedBox.look.name) || 'Iron-bound Strongbox' : null,
            heldBox: heldBox ? (heldBox.look && heldBox.look.name) || 'Iron-bound Strongbox' : null,
            status: plan.caught ? 'held' : 'open', told: false, reported: false, named: !!plan.caught, seenBy: [],
            fenceDay: plan.caught ? null : day + _span(C.burglary.fenceDays, _frac(`${key}|fence`)), clues: [],
        };
        if (plan.caught) NpcTheft._jail(s, thief, day, 'housebreaking');
        NpcTheft._clues(world, s, e, key);
        book.entries.push(e);
        if (book.entries.length > MAX_ENTRIES) book.entries.splice(0, book.entries.length - MAX_ENTRIES);
        if (e.named || e.seenBy.length) {
            StreetCrime.recordNpcCrime(world, s, { k: 'burglary', by: thief.name, byPid: thief.pid != null ? thief.pid : null, victim: player.name || 'you', vuid: 'player', d: day, seenBy: e.seenBy, caught: !!plan.caught });
        }
        // Servants in the house send word at once; otherwise the player finds out on coming back
        if (plan.defences && plan.defences.upgrades.includes('servants') && thief.kind !== 'servant') e.word = true;
        return e;
    },

    /** The clues a burglary leaves: a witness, something dropped, and later a rumour naming them. */
    _clues(world, s, e, key) {
        const C = NpcTheft.config();
        const L = C.playerHome.clues || {};
        const thief = e.thief;
        if (e.status === 'held') { e.clues.push({ k: 'caught', text: `The watch caught ${thief.name} at it.` }); return; }
        if (thief.kind !== 'servant' && _frac(`${key}|witness`) < _num(L.witness, 0.4)) {
            const nb = s.folk ? NpcTheft._neighbour(s, { key, target: { pid: null }, thief }, e.d)[0] : 'a neighbour';
            e.seenBy = [nb];
            e.named = true;
            e.clues.push({ k: 'witness', who: nb, text: `${nb} saw ${thief.name} at your door.` });
        }
        const D = C.dropped || {};
        if (_frac(`${key}|dropped`) < _num(L.dropped, 0.35) && D[thief.kind]) {
            e.clues.push({ k: 'dropped', text: `Left behind: ${_fill(D[thief.kind], { rival: thief.rivalName || 'a rival House' })}.` });
        }
        if (!e.named && _frac(`${key}|rumour`) < _num(L.rumour, 0.5)) {
            e.rumourDay = e.d + _span(L.rumourDays || [3, 12], _frac(`${key}|rumourDay`));
        }
    },

    // ══════════════════════════════════════════════
    // CUTPURSES
    // ══════════════════════════════════════════════

    /** How sharp a mark is (0-1): an NPC by who they are; the player by their wits and stealth. */
    awareness(mark, player = null, day = 0) {
        const P = NpcTheft.config().pickpocket;
        if (mark === 'player' || (mark && mark === player)) {
            const A = P.playerAwareness || {};
            let a = _num(A.base, 0.3) + _num(player && player.intelligence, 5) * _num(A.perIntelligence, 0.03);
            const lv = SocialSkills.has('stealth') ? SocialSkills.level(player, 'stealth') : _num(player && player.skills && player.skills.stealth, 1);
            a += lv * _num(A.perStealthLevel, 0.04);
            const b = player && _obj(player.theftBook);
            if (b && b.waryUntil != null && _num(day) <= b.waryUntil) a += _num(A.wary, 0.2);
            return _clamp(a, 0, _num(A.max, 0.85));
        }
        const role = mark && (mark._person ? mark._person.role : (mark.role || mark.type));
        return _num((P.awareness || {})[role], 0.3);
    },

    /**
     * One lift: the thief's skill against the mark's awareness, from a hash of
     * `key` (no shared RNG). → { ok, noticed, liftChance, noticeChance }
     * (noticed: the mark felt the hand — the lift fails and they cry out).
     */
    lift(skill, awareness, key) {
        const P = NpcTheft.config().pickpocket;
        const L = P.lift;
        const N = P.notice;
        const liftChance = _clamp(_num(L.base) + skill * _num(L.perSkill) + awareness * _num(L.perAwareness), _num(L.min, 0.08), _num(L.max, 0.92));
        const noticeChance = _clamp(_num(N.base) + awareness * _num(N.perAwareness) + skill * _num(N.perSkill), _num(N.min, 0.05), _num(N.max, 0.85));
        const noticed = _frac(`${key}|notice`) < noticeChance;
        const ok = !noticed && _frac(`${key}|lift`) < liftChance;
        return { ok, noticed, liftChance, noticeChance };
    },

    /** The watch's presence: fewer cutpurses where more of the watch walk (and in a crackdown). */
    watchFactor(s, guardsNear = null) {
        const P = NpcTheft.config().pickpocket;
        const st = NpcTheft.state(s);
        const g = guardsNear != null ? guardsNear : _num(WATCH[s && s.type], 3);
        const crack = Math.max(0, _num(st && st.heat) - _num(P.crackdownAt, 6));
        return 1 / (1 + g * _num(P.watchDeter, 0.08) + crack * 0.1);
    },

    /**
     * A cutpurse lifts from a townsperson (the background rate, off the
     * player's map, or a lift played out on it): the coin from the mark's purse
     * to the thief's. → the case (open, or caught/noticed), or null.
     * opts: { thief, mark (a roster person), key, seenBy, witnesses, caught, result }
     */
    liftFromNpc(world, s, opts) {
        const C = NpcTheft.config();
        const P = C.pickpocket;
        const { thief, mark, key } = opts;
        if (!s || !s.folk || !thief || !mark) return null;
        const st = NpcTheft.state(s);
        const day = _num(world && world.day);
        const res = opts.result || NpcTheft.lift(thief.skill, NpcTheft.awareness(mark), key);
        const c = NpcTheft._newCase(st, { k: 'pickpocket', d: day, thief, victim: { kind: 'npc', pid: mark.id, name: Townsfolk.name(mark) } });
        st.heat = _num(st.heat) + _num(P.heatPerLift, 1);
        if (res.ok) {
            const shareC = _num(P.coinShare[0], 0.15) + _frac(`${key}|coin`) * (_num(P.coinShare[1], 0.45) - _num(P.coinShare[0], 0.15));
            const take = Math.max(0, Math.floor(Townsfolk.purse(s.folk, mark, world) * shareC));
            mark.purse = _num(mark.purse) - take;
            c.coin = take;
            c.purses[mark.id] = take;
            NpcTheft._pay(world, s, null, thief, take);
            c.status = take > 0 ? 'done' : 'failed';
        } else {
            c.status = res.noticed ? 'noticed' : 'failed';
        }
        // Noticed: the mark cries out — the watch may take them, and the crowd saw who
        if (res.noticed) {
            const caught = opts.caught != null ? !!opts.caught : _frac(`${key}|watch`) < _byType(P.watchCatch, s.type);
            if (caught) { c.status = 'caught'; NpcTheft._jail(s, thief, day, 'cutting purses'); }
            c.named = true;
            c.seenBy = (opts.seenBy || [c.victim.name]).slice(0, 3);
            StreetCrime.recordNpcCrime(world, s, {
                k: 'pickpocket', by: thief.name, byPid: thief.pid != null ? thief.pid : null, victim: c.victim.name, vuid: `pid${mark.id}`,
                d: day, seenBy: c.seenBy, witnesses: opts.witnesses || [], caught,
            });
            Townsfolk.note(mark, day, 'pickpocketed', thief.pid != null ? thief.pid : null, caught ? 'caught' : '');
        }
        NpcTheft._cutpurseTalk(world, s, day);
        return c;
    },

    /** Now and then, when the cutpurses run hot, the town talks of it (never more than every annalEvery days). */
    _cutpurseTalk(world, s, day) {
        const P = NpcTheft.config().pickpocket;
        const st = NpcTheft.state(s);
        if (!s.folk || !Array.isArray(s.folk.annals) || st.heat < _num(P.annalAt, 4)) return;
        if (st.lastAnnal != null && day - st.lastAnnal < _num(P.annalEvery, 30)) return;
        st.lastAnnal = day;
        Townsfolk.record(s.folk, world, day, { k: 'npcTheft', x: `Cutpurses were working the market at ${s.name || 'town'} {when}; folk kept a hand on their purses.` });
    },

    /** Today's background lift among the townsfolk, off the player's map. → case or null */
    pickNpcs(world, s, day) {
        const C = NpcTheft.config();
        if (!C.enabled || !s || !s.folk) return null;
        const st = NpcTheft.state(s);
        if (st.pickDay === day) return null;
        const key = `${_seed(world)}|pick|${s.q},${s.r}|${day}`;
        const p = _byType(C.pickpocket.perDay, s.type) * NpcTheft.watchFactor(s);
        if (_frac(key) >= p) return null;
        const thief = NpcTheft._townThief(world, s, day, key, new Set(), { urchins: true });
        if (!thief) return null;
        const marks = Townsfolk.residents(s.folk).filter(m => m.id !== thief.pid && Townsfolk.age(m, day) >= 16 && m.role !== 'beggar')
            .map(m => ({ w: 1 + _num(C.roleWealth[m.role], 1) * 2, m }));
        const pick = _weighted(marks, _frac(`${key}|mark`));
        if (!pick) return null;
        st.pickDay = day;
        return NpcTheft.liftFromNpc(world, s, { thief, mark: pick.m, key });
    },

    /** Is a cutpurse after the player in this town today (off the street map)? → { thief, key } or null */
    planPickPlayer(world, player, s, day) {
        const C = NpcTheft.config();
        const P = C.pickpocket;
        if (!C.enabled || !player || !s || !s.folk) return null;
        if (_num(player.gold) <= 0) return null;
        const key = `${_seed(world)}|pickP|${s.q},${s.r}|${day}`;
        let p = _byType(P.playerPerDay, s.type) * NpcTheft.watchFactor(s) * Math.min(2, 0.5 + _num(player.gold) / Math.max(1, _num(P.playerGoldLooks, 400)));
        // The ruler's own watch keeps a closer eye on the ruler
        if (StreetCrime.aboveLaw(player, world, s)) p *= _num(P.rulerWatchMult, 0.5);
        if (_frac(key) >= p) return null;
        const thief = NpcTheft._townThief(world, s, day, key, new Set(), { urchins: true }) || NpcTheft._outlaw(world, s, player, key);
        return thief ? { thief, key } : null;
    },

    /**
     * A cutpurse at the player: the lift resolved (or given), the coin (and
     * perhaps a small item) moved, a case on the player's book.
     * → { ok, noticed, coin, item, entry, text }
     */
    liftFromPlayer(world, player, s, thief, key, opts = {}) {
        const C = NpcTheft.config();
        const P = C.pickpocket;
        const day = _num(world && world.day);
        const res = opts.result || NpcTheft.lift(thief.skill, NpcTheft.awareness('player', player, day), key);
        const out = { ok: res.ok, noticed: res.noticed, coin: 0, item: null, entry: null, text: '' };
        const st = NpcTheft.state(s);
        st.heat = _num(st.heat) + _num(P.heatPerLift, 1);
        if (!res.ok) {
            out.text = res.noticed ? `You feel a hand at your purse — ${thief.name}!` : '';
            return out;
        }
        const shareC = _num(P.coinShare[0], 0.15) + _frac(`${key}|coin`) * (_num(P.coinShare[1], 0.45) - _num(P.coinShare[0], 0.15));
        const coin = Math.min(_num(player.gold), Math.max(1, Math.min(_num(P.playerCoinMax, 60), Math.floor(_num(player.gold) * shareC))));
        player.gold = _num(player.gold) - coin;
        out.coin = coin;
        // Now and then a small thing from the pack too: the most precious small thing
        const goods = {};
        if (_frac(`${key}|item`) < _num(P.itemChance, 0.25) && _obj(player.inventory)) {
            const small = Object.keys(player.inventory).filter(id => _num(player.inventory[id]) > 0 && Containers.good(id).basePrice >= 5 && Containers.good(id).basePrice <= 120)
                .sort((a, b) => Containers.good(b).basePrice - Containers.good(a).basePrice);
            if (small.length) {
                const id = small[0];
                player.inventory[id] = _num(player.inventory[id]) - 1;
                if (player.inventory[id] <= 0) delete player.inventory[id];
                goods[id] = 1;
                out.item = id;
            }
        }
        NpcTheft._pay(world, s, player, thief, coin);
        const book = NpcTheft.book(player);
        const e = {
            id: book.nextId++, k: 'pickpocket', d: day, q: s.q, r: s.r, town: s.name || 'the town', site: null, siteName: null, siteKind: 'purse',
            thief, coin, goods, from: {}, forced: false, status: 'open', told: false, reported: false, named: !!opts.named, seenBy: (opts.seenBy || []).slice(0, 3),
            fenceDay: day + _span(C.burglary.fenceDays, _frac(`${key}|fence`)), clues: [],
        };
        if (e.seenBy.length) e.clues.push({ k: 'witness', who: e.seenBy[0], text: `${e.seenBy[0]} saw ${thief.name}'s hand in your purse.` });
        book.entries.push(e);
        if (book.entries.length > MAX_ENTRIES) book.entries.splice(0, book.entries.length - MAX_ENTRIES);
        book.waryUntil = day + _num((P.playerAwareness || {}).waryDays, 10);
        out.entry = e;
        out.text = NpcTheft.pickTellText(e);
        return out;
    },

    /** "Your purse feels light… 23 gold gone." */
    pickTellText(e) {
        const what = NpcTheft.describe(e);
        return `Your purse feels light… ${what || 'something'} gone.${e.clues && e.clues.length ? ` ${e.clues[0].text}` : ''}`;
    },

    /**
     * The player caught the hand at their purse (or watched a thief at a
     * door) and acts: 'grab' (seize them: the goods back), 'shout' (the watch
     * gives chase), 'fight', 'let'. Off the street map the chase is a roll.
     * → { caught, text }
     */
    chaseChance(player) {
        const K = NpcTheft.config().pickpocket.chaseCatch || {};
        return _clamp(_num(K.base, 0.35) + _num(player && player.strength, 5) * _num(K.perStrength, 0.03), 0, _num(K.max, 0.8));
    },

    grabChance(player, thief) {
        const G = NpcTheft.config().grab;
        return _clamp(_num(G.base) + _num(player && player.strength, 5) * _num(G.perStrength) + _num(thief && thief.skill, 3) * _num(G.perSkill), _num(G.min, 0.1), _num(G.max, 0.85));
    },

    /** A townsperson as a thief (the street map's cutpurse or burglar): { name, kind, pid, skill }. */
    thiefOf(s, p, day) {
        if (!p) return null;
        const kind = p.role === 'beggar' ? 'beggar' : (Townsfolk.age(p, day) < 16 ? 'urchin' : 'townsfolk');
        return { name: Townsfolk.name(p), kind, pid: p.id, skill: NpcTheft.skillOf(kind, `${s.q},${s.r}|${p.id}`) };
    },

    /** Would this townsperson cut a purse (the crooked, the poor, a sly child)? */
    isCutpurse(s, p, world, day) {
        const T = NpcTheft.config().thieves;
        if (!s || !s.folk || !p || (p.jailedUntil != null && day < p.jailedUntil)) return false;
        if (NpcTheft.isCrooked(s.folk, p, world, day)) return true;
        const age = Townsfolk.age(p, day);
        if (age < _num(T.urchinMinAge, 9) || age > _num(T.urchinMaxAge, 15)) return false;
        const t = p.traits || [];
        return !t.some(x => (T.honestTraits || []).includes(x)) && t.some(x => (T.crookedTraits || []).includes(x));
    },

    /** A burglary case caught after the fact (the watch ran the thief down): the goods back to the household. */
    catchCase(world, s, c, player = null) {
        if (!c || c.status !== 'open') return false;
        NpcTheft._restoreNpc(world, s, c, player);
        NpcTheft._jail(s, c.thief, _num(world && world.day), c.k === 'pickpocket' ? 'cutting purses' : 'housebreaking');
        c.status = 'caught';
        c.named = true;
        return true;
    },

    /** The noticed cutpurse is caught (seized, or by the watch): on the town's record. */
    thiefCaught(world, s, thief, victimName, vuid, seenBy = [], witnesses = []) {
        const day = _num(world && world.day);
        NpcTheft._jail(s, thief, day, 'cutting purses');
        return StreetCrime.recordNpcCrime(world, s, {
            k: 'pickpocket', by: thief.name, byPid: thief.pid != null ? thief.pid : null, victim: victimName, vuid, d: day, seenBy, witnesses, caught: true,
        });
    },

    // ══════════════════════════════════════════════
    // CASES: THE WATCH, THE FENCE, THE PLAYER
    // ══════════════════════════════════════════════

    /** The player's open cases in a town (or all). */
    openCases(player, q = null, r = null) {
        const b = player && _obj(player.theftBook);
        return ((b && b.entries) || []).filter(e => (e.status === 'open' || e.status === 'held') && (q == null || (e.q === q && e.r === r)));
    },

    /** The goods go back to their owner: the townsperson's boxes and purse. */
    _restoreNpc(world, s, c, player) {
        const coin = NpcTheft._unpay(world, s, player, c.thief, c.coin);
        if (s.folk) {
            let left = coin;
            for (const [pid, n] of Object.entries(c.purses || {})) {
                const p = Townsfolk.get(s.folk, Number(pid));
                const back = Math.min(left, _num(n));
                if (p && back > 0) { p.purse = _num(p.purse) + back; left -= back; }
            }
        }
        for (const [k, items] of Object.entries(c.from || {})) {
            const rec = _obj(s.larders) && s.larders[k];
            for (const [id, n] of Object.entries(items)) {
                if (rec && _obj(rec.stock)) rec.stock[id] = _num(rec.stock[id]) + n;
                else SettlementMarket.add(s, id, n);
            }
        }
        c.goods = {};
    },

    /** The thief fences the goods: into the town's market, the fence paying out of the town's purse (an outlaw's to the lair). */
    _fence(world, s, c, player) {
        const B = NpcTheft.config().burglary;
        let pay = 0;
        const lair = c.thief && c.thief.kind === 'outlaw' && player && c.thief.lairId != null ? OutlawLairs.find(player, c.thief.lairId) : null;
        for (const [id, n] of Object.entries(c.goods || {})) {
            if (lair) {
                if (!_obj(lair.hoard)) lair.hoard = { gold: 0, goods: {} };
                if (!_obj(lair.hoard.goods)) lair.hoard.goods = {};
                lair.hoard.goods[id] = _num(lair.hoard.goods[id]) + n;
                continue;
            }
            SettlementMarket.add(s, id, n);
            pay += Math.floor(_num(Containers.good(id).basePrice, 1) * n * _num(B.fenceShare, 0.35));
        }
        if (pay > 0 && s.economy && Number.isFinite(s.economy.gold)) {
            pay = Math.min(pay, Math.max(0, Math.floor(s.economy.gold)));
            s.economy.gold -= pay;
            NpcTheft._pay(world, s, player, c.thief, pay);
        }
        c.fenced = { d: _num(world && world.day), where: lair ? (lair.name || 'the outlaws\' lair') : (s.name || 'the market'), lair: !!lair };
        c.status = 'fenced';
    },

    /** One day of a case: the watch may catch the thief (the goods back), or the goods are fenced. → 'caught'|'fenced'|null */
    _caseDay(world, s, c, day, player = null, isPlayer = false) {
        if (c.status !== 'open') return null;
        const B = NpcTheft.config().burglary;
        let p = _byType(B.watchLater, s.type);
        if (c.reported) p *= _num(B.reportedMult, 2.5);
        if (c.named) p *= _num(B.namedMult, 2);
        if (_frac(`${_seed(world)}|case|${s.q},${s.r}|${isPlayer ? 'p' : 'n'}${c.id}|${day}`) < p) {
            NpcTheft._jail(s, c.thief, day, c.k === 'pickpocket' ? 'cutting purses' : 'housebreaking');
            if (isPlayer) {
                // The goods wait with the watch until the player comes for them
                c.coin = NpcTheft._unpay(world, s, player, c.thief, c.coin);
                c.status = 'held';
                c.caughtDay = day;
                c.named = true;
            } else {
                NpcTheft._restoreNpc(world, s, c, player);
                c.status = 'caught';
            }
            return 'caught';
        }
        if (c.fenceDay != null && day >= c.fenceDay) {
            NpcTheft._fence(world, s, c, player);
            return 'fenced';
        }
        return null;
    },

    /** Report a case to the watch (once): it looks harder. */
    report(player, world, id) {
        const e = NpcTheft.openCases(player).find(x => x.id === id);
        if (!e || e.status !== 'open') return { ok: false, text: 'There is nothing to report.' };
        if (e.reported) return { ok: false, text: 'The watch already knows of it.' };
        e.reported = true;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(e.q, e.r) : null;
        const s = tile && tile.settlement;
        if (e.named && s) StreetCrime.recordNpcCrime(world, s, { k: e.k, by: e.thief.name, byPid: e.thief.pid != null ? e.thief.pid : null, victim: player.name || 'you', vuid: 'player', d: _num(world && world.day), seenBy: e.seenBy, caught: false });
        return { ok: true, text: e.named ? `The watch takes down ${e.thief.name}'s name. They'll be looking.` : 'The watch hears you out and promises to keep an eye open.' };
    },

    /** The thief's name, if the player knows it. */
    suspect(e) {
        return e && e.named && e.thief ? e.thief.name : null;
    },

    /** Odds of a confrontation going the player's way. */
    confrontChance(player, world, e) {
        const K = NpcTheft.config().confront;
        let c = _num(K.base) + _num(player && player.charisma, 5) * _num(K.perCharisma) + _num(player && player.strength, 5) * _num(K.perStrength);
        const tile = world && typeof world.getTile === 'function' ? world.getTile(e.q, e.r) : null;
        const p = tile && tile.settlement && tile.settlement.folk && e.thief.pid != null ? Townsfolk.get(tile.settlement.folk, e.thief.pid) : null;
        const t = (p && p.traits) || [];
        if (t.some(x => (K.meekTraits || []).includes(x))) c += _num(K.meek);
        if (t.some(x => (K.boldTraits || []).includes(x))) c += _num(K.bold);
        return _clamp(c, 0.05, 0.95);
    },

    /** Can the player confront this thief here and now? */
    canConfront(player, world, e) {
        if (!e || e.status !== 'open' || !e.named || e.denied || !e.thief || e.thief.pid == null) return false;
        if (!player || player.q !== e.q || player.r !== e.r) return false;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(e.q, e.r) : null;
        const s = tile && tile.settlement;
        const p = s && s.folk ? Townsfolk.get(s.folk, e.thief.pid) : null;
        return !!(p && Townsfolk.isHere(p));
    },

    /** Face the named thief: they hand it back (what they still have), or deny it to your face. */
    confront(player, world, id) {
        const e = NpcTheft.openCases(player).find(x => x.id === id);
        if (!NpcTheft.canConfront(player, world, e)) return { ok: false, text: 'You can\'t put it to them here.' };
        const s = world.getTile(e.q, e.r).settlement;
        const chance = NpcTheft.confrontChance(player, world, e);
        if (_frac(`${_seed(world)}|confront|${e.id}|${_num(world.day)}`) < chance) {
            e.coin = NpcTheft._unpay(world, s, player, e.thief, e.coin);
            const text = NpcTheft._giveBack(player, e, `${_cap(e.thief.name)} turns pale and hands it back`);
            const p = Townsfolk.get(s.folk, e.thief.pid);
            if (p) Townsfolk.note(p, _num(world.day), 'shamed', null, 'theft');
            return { ok: true, text };
        }
        e.denied = true;
        return { ok: false, text: `${_cap(e.thief.name)} denies it to your face and walks off. The watch might yet do better.` };
    },

    /** The goods of a case back into the player's hands. → the text */
    _giveBack(player, e, lead) {
        const what = NpcTheft.describe(e);
        if (_num(e.coin) > 0) player.gold = _num(player.gold) + e.coin;
        if (!_obj(player.inventory)) player.inventory = {};
        for (const [id, n] of Object.entries(e.goods || {})) player.inventory[id] = _num(player.inventory[id]) + n;
        e.status = 'returned';
        e.returnedDay = e.d;
        return `${lead}: ${what || 'what little there was'}.`;
    },

    /** The text the player is told of a burglary of their place. */
    burglaryText(e) {
        const what = NpcTheft.describe(e);
        const where = e.siteKind === 'property' ? `The store of your ${e.siteName}` : `Your ${String(e.siteName || 'house').toLowerCase().replace(/^the /, '')}`;
        let t;
        if (e.status === 'held' && e.caughtDay == null) t = `${where} in ${e.town} was broken into — but the watch caught ${e.thief.name} at it.`;
        else if (!what) t = `${where} in ${e.town} was broken into${e.heldBox ? `, but the ${e.heldBox.toLowerCase()} held` : ''}. Nothing seems to be gone.`;
        else {
            const box = e.forcedBox ? `the ${e.forcedBox.toLowerCase()} has been forced; ` : (e.forced ? 'the door has been forced; ' : '');
            t = `${where} in ${e.town} has been robbed: ${box}${what} ${Object.keys(e.goods || {}).length + (e.coin > 0 ? 1 : 0) > 1 || (Object.values(e.goods || {})[0] || 0) > 1 ? 'are' : 'is'} gone.`;
            if (e.heldBox) t += ` The ${e.heldBox.toLowerCase()} held.`;
            if (e.status === 'held') t += ` The watch has since caught ${e.thief.name}, and holds what was taken for you.`;
        }
        const clues = (e.clues || []).map(c => c.text);
        return clues.length ? `${t} ${clues.join(' ')}` : t;
    },

    /** Whether the town has named the thief by now (a rumour comes, in time). */
    _rumour(world, e, day) {
        if (e.named || e.rumourDay == null || day < e.rumourDay) return null;
        e.named = true;
        const text = `They say in ${e.town} that it was ${e.thief.name} who robbed you.`;
        e.clues.push({ k: 'rumour', text });
        e.rumourDay = null;
        return text;
    },

    // ══════════════════════════════════════════════
    // EACH DAY
    // ══════════════════════════════════════════════

    /**
     * Each day: in every town with a roster but the one on the player's
     * street map (opts.onMap: the street map plays its own), tonight's
     * burglary and the cutpurses' quiet work; every open case a day on (the
     * watch, the fence); the player's places robbed while they are away; and
     * word to the player of what was taken from them, when they are there to
     * hear it (or their servants send word). → { notices, events }
     */
    processDay(world, player = null, opts = {}) {
        const notices = [];
        const events = [];
        const C = NpcTheft.config();
        if (!world || !C.enabled) return { notices, events };
        const day = _num(world.day);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const here = player && player.q != null ? `${player.q},${player.r}` : null;
        for (const s of views) {
            if (!s || s.q == null || !s.folk) continue;
            const hex = `${s.q},${s.r}`;
            const st = NpcTheft.state(s);
            st.heat = Math.max(0, _num(st.heat) * (1 - _num(C.pickpocket.heatDecay, 0.1)));
            const onMapHere = opts.onMap && hex === here;
            // A night the street map didn't play out is still a night: resolve it here
            const plan = NpcTheft.planBurglary(world, s, day, player);
            if (plan) {
                const c = NpcTheft.commitBurglary(world, s, plan, player);
                if (c) events.push({ kind: 'burglary', hex, town: s.name, text: c.text, caught: c.status === 'caught', case: c });
            }
            if (!onMapHere) {
                const pc = NpcTheft.pickNpcs(world, s, day);
                if (pc) events.push({ kind: 'pickpocket', hex, town: s.name, case: pc });
            }
            for (const c of st.cases) {
                const r = NpcTheft._caseDay(world, s, c, day, player, false);
                if (r) events.push({ kind: `case_${r}`, hex, town: s.name, case: c });
            }
        }
        if (!player) return { notices, events };

        // The player's places, robbed while they are away
        for (const site of NpcTheft.playerSites(player, world)) {
            const plan = NpcTheft.planPlayerBurglary(world, player, site, day);
            if (!plan) continue;
            const e = NpcTheft.commitPlayerBurglary(world, player, plan);
            if (e) events.push({ kind: 'playerBurglary', hex: `${site.q},${site.r}`, entry: e });
        }
        // A cutpurse at the player in town, off the street map
        const tileHere = here ? world.getTile(player.q, player.r) : null;
        const sHere = tileHere && tileHere.settlement;
        if (sHere && sHere.folk && !opts.onMap) {
            const pp = NpcTheft.planPickPlayer(world, player, sHere, day);
            if (pp) {
                const res = NpcTheft.liftFromPlayer(world, player, sHere, pp.thief, pp.key);
                if (res.noticed) {
                    const caught = _frac(`${pp.key}|chase`) < NpcTheft.chaseChance(player);
                    if (caught) NpcTheft.thiefCaught(world, sHere, pp.thief, player.name || 'you', 'player', [player.name || 'you']);
                    notices.push({ icon: '👛', title: 'Cutpurse!', type: caught ? 'success' : 'warning', text: caught
                        ? `You catch ${pp.thief.name}'s hand at your purse and hold on until the watch comes.`
                        : `You catch a hand at your purse — ${pp.thief.name} — but they slip off into the crowd. Nothing is gone.` });
                } else if (res.ok) {
                    res.entry.told = true;
                    notices.push({ icon: '👛', title: 'Purse Cut', type: 'warning', text: res.text });
                }
                events.push({ kind: 'pickPlayer', hex: here, res });
            }
        }
        // Cases against the player: the watch, the fence, the rumour, and word to the player
        const book = NpcTheft.book(player);
        for (const e of book.entries) {
            const tile = world.getTile(e.q, e.r);
            const s = tile && tile.settlement;
            if (!s) continue;
            const r = NpcTheft._caseDay(world, s, e, day, player, true);
            const rumour = NpcTheft._rumour(world, e, day);
            const present = player.q === e.q && player.r === e.r;
            if (!e.told && (present || e.word)) {
                e.told = true;
                notices.push({ icon: e.k === 'pickpocket' ? '👛' : '🚪', title: e.k === 'pickpocket' ? 'Purse Cut' : (present ? 'Robbed!' : 'Word from Home'), type: 'warning', text: e.k === 'pickpocket' ? NpcTheft.pickTellText(e) : NpcTheft.burglaryText(e) });
            } else if (r === 'caught' && e.told) {
                notices.push({ icon: '🛡️', title: 'Thief Caught', type: 'success', text: `The watch in ${e.town} has caught ${e.thief.name}. What was taken from you waits for you there.` });
            } else if (r === 'fenced' && e.told && !e.fenced.lair) {
                notices.push({ icon: '🏷️', title: 'Stolen Goods', type: 'info', text: `What was stolen from you in ${e.town} has turned up at the market there — fenced.` });
            } else if (rumour && e.told) {
                notices.push({ icon: '🗣️', title: 'A Name', type: 'info', text: rumour });
            }
            // Held by the watch and the player is here: it's theirs again
            if (e.status === 'held' && present && !NpcTheft.describe(e)) e.status = 'returned';
            else if (e.status === 'held' && present) {
                notices.push({ icon: '🛡️', title: 'Goods Returned', type: 'success', text: NpcTheft._giveBack(player, e, `The watch hands back what ${e.thief.name} took`) });
            }
        }
        return { notices, events };
    },
};
