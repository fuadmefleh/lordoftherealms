// ============================================
// PIRATES — the open sea as a run of choices
// ============================================
// Hunting pirates, turning pirate and exploring the waters used to be one
// automatic roll each (Ships.huntPirates / commitPiracy / exploreOcean —
// still there, unchanged, as the headless path the playtest bot uses). From
// the ship's action menu they are now encounters in phases, each choice with
// its odds shown (ui/actionMenu/seaScenes.js renders them):
//
//   SIGHTING   a sail: give chase, shadow her till dusk (catch them unready),
//              hail and parley, or break off. Prey (a merchant) can be run
//              down, approached under false colours or told to strike.
//   BATTLE     broadside (wear them down, they may strike their colours),
//              grapple and board (decisive), duel their captain (your blade
//              against theirs; the crew yield when they fall), or withdraw.
//   AFTERMATH  a beaten pirate crew: ransom the captain (their haven pays —
//              and so you learn where it is), hand them to the crown (the
//              bounty), press the crew into yours, or let them go; then the
//              ship: seize her as a prize (she joins your fleet, sailed to the
//              nearest port by a prize crew), sell her, scuttle her. A taken
//              merchant: plunder and release, ransom the passengers, take
//              her as a prize, or sink her and leave no witnesses.
//
// Named pirate captains (data/pirates.json → captains) persist on the
// player's state: each has a ship, a temperament and a haven on the map (a
// lonely cove picked from the coast by a hash of the world seed), grows
// stronger raiding the lanes, and REMEMBERS you — mercy, a ransom, a beating,
// a humiliation — which changes how they parley and whether they come
// looking for you (a vengeful captain intercepts you at sea). A hanged or
// sunk captain is replaced, in time, by a successor.
//
// Piracy by the player earns INFAMY (beyond the old flat reputation hit and
// underworld heat): witnesses spread it, ransoms and prizes add to it, it
// cools slowly (faster in port). Past a threshold, navy squadrons and
// pirate hunters come after you at sea: run, fight, bribe or surrender
// (a fine, the cargo, or the cells of the nearest port).
//
// Explore the Waters: an uncharted place within reach may be found first
// (Discovery.searchWaters); otherwise a sea event with choices
// (data/pirates.json → seaEvents): derelicts, castaways, lights that point
// to uncharted land (Discovery.leadNear), a bottle with a treasure map, sea
// monsters, squalls, whales — or a pirate sail, which becomes a sighting.
//
// State: player.seaRoving (saved via SaveLoad.EXTRA_PLAYER_FIELDS; ensure()
// backfills). The daily tick (processDay: captains grow and are replaced,
// infamy cools, hunters and vengeful captains may intercept) draws from its
// own seeded stream (world seed + day), so it never moves anyone else's
// dice. Encounter choices are player actions and roll on Utils as usual.
// Explicit params, no DOM.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Difficulty } from '../core/difficulty.js';
import { Ships } from './ships.js';
import { Discovery } from './discovery.js';
import { Quests } from './quests.js';
import { Traits } from './traits.js';
import { Ailments } from './ailments.js';
import { Underworld } from './underworld.js';
import { Ledger } from './ledger.js';
import { Cartography } from './cartography.js';

const DEFAULTS = {
    activeCaptains: 4, havenCount: 3, havenMinSettlementDistance: 5, havenSpacing: 12,
    successorDays: [18, 36], growthPerDay: 0.04, maxStrength: 60,
    find: { hunt: 0.5, prey: 0.6, lookout: 0.05 },
    captainMeetRadius: 40, sightingDays: 20, havenRaidCooldownDays: 30,
    chase: { base: 0.45, speed: 0.07, seafaring: 0.02 },
    shadow: { base: 0.25, stealth: 0.06, shipStealth: 0.08 },
    flee: { base: 0.45, speed: 0.08, stealth: 0.03 },
    parley: { base: 0.15, diplomacy: 0.04, charisma: 0.01, renownPer: 400, renownCap: 0.15, regard: 0.004, honourable: 0.1, cruel: -0.15, infamy: 0.002 },
    broadside: { enemyLoss: [0.2, 0.4], hull: [3, 9], enemyHull: [4, 10], strikeBelow: 0.35 },
    board: { variance: 0.2, unready: 1.25, crewLossShare: [0.05, 0.15] },
    duel: { combat: 5, strength: 1.5, base: 10, captainMult: 0.9 },
    withdraw: { hull: [2, 6] },
    bountyPerStrength: 9, ransomPerStrength: 14, prizeSalePerStrength: 14, plunderPerStrength: [2, 5],
    renown: { victory: 3, captain: 6, hanged: 4, scuttle: 1 },
    karma: { victory: 2, spare: 3, hang: -1, press: -1, sinkMerchant: -10, ransomPassengers: -3 },
    press: { share: [0.25, 0.5], morale: -8 },
    prizeCrew: 2,
    merchant: { strength: [3, 15], gold: [50, 300], cargoUnits: [3, 10], escortChance: 0.2, escortStrength: [6, 14] },
    infamy: {
        piracy: 10, witnesses: 8, sunk: 2, ransom: 6, prize: 5, falseColours: -3,
        decayPerDay: 0.4, portDecayPerDay: 1.2, max: 100,
        huntersAt: 25, hunterChance: 0.02, hunterChancePerInfamy: 0.002, hunterCooldownDays: 6, merchantsYieldPer: 0.004,
    },
    hunters: { strength: [14, 30], perInfamy: 0.35, finePerInfamy: 8, bribePerInfamy: 5, surrenderInfamy: -20, beatInfamy: 6 },
    vengeance: { chance: 0.03, regardBelow: -30, cooldownDays: 10 },
    haven: { lootPerStrength: [8, 14], renown: 10, spotChance: 0.5 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _merge(base[k], v) : v;
    }
    return out;
}

/** A well-mixed unsigned 32-bit hash of the parts (draws no RNG). */
function _hash(...parts) {
    const s = parts.join('|');
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
    return h >>> 0;
}

function _hashRange(range, ...parts) {
    if (!Array.isArray(range)) return _num(range);
    const lo = Math.min(range[0], range[1]);
    const hi = Math.max(range[0], range[1]);
    return lo + (_hash(...parts) % (hi - lo + 1));
}

function _roll(range) {
    if (!Array.isArray(range)) return _num(range);
    return Utils.randInt(Math.min(range[0], range[1]), Math.max(range[0], range[1]));
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _dist(world, q1, r1, q2, r2) {
    const w = (world && world.width) || 0;
    return w > 0 ? Hex.wrappingDistance(q1, r1, q2, r2, w) : Hex.distance(q1, r1, q2, r2);
}

function _skill(player, id) {
    return _num(player && player.skills && player.skills[id], 1);
}

function _train(player, skill, amount) {
    if (!player.skills) player.skills = {};
    player.skills[skill] = Math.min(10, _num(player.skills[skill], 1) + amount);
}

/** Win chance of strength a against b (sharper than a/(a+b)). */
function _odds(a, b) {
    const A = Math.max(0.1, a) ** 2;
    const B = Math.max(0.1, b) ** 2;
    return _clamp(A / (A + B), 0.05, 0.95);
}

let _cfgCache = null;
let _cfgSrc = null;

export const Pirates = {
    DEFAULTS,

    data() {
        return (DataLoader._gamedata && DataLoader._gamedata.pirates) || {};
    },

    config() {
        const src = Pirates.data().config;
        if (!_cfgCache || _cfgSrc !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSrc = src;
        }
        return _cfgCache;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            captains: [], havens: null, infamy: 0, used: [], succ: 0, nextSuccessorDay: null,
            lastHunterDay: -999, lastVengeanceDay: -999, log: [],
            stats: { captainsTaken: 0, captainsHanged: 0, ransoms: 0, prizes: 0, merchantsTaken: 0, merchantsSunk: 0, huntersBeaten: 0, havensRaided: 0 },
        };
    },

    /** player.seaRoving, created / backfilled. */
    state(player) {
        if (!player.seaRoving || typeof player.seaRoving !== 'object') player.seaRoving = Pirates._blank();
        const st = player.seaRoving;
        const b = Pirates._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!Array.isArray(st.captains)) st.captains = [];
        if (!Array.isArray(st.log)) st.log = [];
        if (!Array.isArray(st.used)) st.used = [];
        st.stats = { ...b.stats, ...(st.stats || {}) };
        st.infamy = _clamp(_num(st.infamy), 0, Pirates.config().infamy.max);
        return st;
    },

    _log(st, world, text) {
        st.log.push({ day: _day(world), text });
        if (st.log.length > 30) st.log.splice(0, st.log.length - 30);
    },

    /** Anything for the Sea Rovers log yet (a captain met, a haven known, infamy)? */
    hasLog(player) {
        const st = player && player.seaRoving;
        if (!st) return false;
        return _num(st.infamy) > 0 || (st.captains || []).some(c => c.met > 0) || (st.havens || []).some(h => h.known);
    },

    getInfamy(player) {
        return player && player.seaRoving ? _num(player.seaRoving.infamy) : 0;
    },

    infamyLevel(infamy) {
        const I = Pirates.config().infamy;
        if (infamy >= I.huntersAt * 2.5) return 'notorious';
        if (infamy >= I.huntersAt) return 'hunted';
        if (infamy >= I.huntersAt / 2) return 'whispered of';
        return 'unknown';
    },

    addInfamy(player, amount) {
        const st = Pirates.state(player);
        st.infamy = _clamp(Math.round((st.infamy + amount) * 10) / 10, 0, Pirates.config().infamy.max);
        return st.infamy;
    },

    /** Havens and the first captains, once there is a world to put them in. */
    ensure(player, world) {
        const st = Pirates.state(player);
        if (world && !st.havens) {
            st.havens = Pirates._placeHavens(world);
            const want = Pirates.config().activeCaptains;
            while (Pirates.atLarge(player).length < want && Pirates._spawnCaptain(st, world)) { /* fill */ }
        }
        return st;
    },

    atLarge(player) {
        return Pirates.state(player).captains.filter(c => c.status === 'at_large');
    },

    captain(player, id) {
        return Pirates.state(player).captains.find(c => c.id === id) || null;
    },

    haven(player, id) {
        const st = Pirates.state(player);
        return (st.havens || []).find(h => h.id === id) || null;
    },

    _settlements(world) {
        const all = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : (typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
        return (all || []).filter(s => s && Number.isFinite(s.q) && Number.isFinite(s.r));
    },

    /**
     * Lonely coves for the pirates: land on the coast, far from any town,
     * well apart, ranked by a hash of the world seed (no RNG draws).
     */
    _placeHavens(world) {
        const cfg = Pirates.config();
        const seed = _seed(world);
        const w = world.width || 0;
        const h = world.height || 0;
        if (!w || !h || typeof world.getTile !== 'function') return [];
        const cands = [];
        for (let r = 2; r < h - 2; r++) {
            for (let q = 0; q < w; q++) {
                const t = world.getTile(q, r);
                if (!t || !t.terrain || !t.terrain.passable || t.settlement || Ships.isWaterTile(t)) continue;
                let water = 0;
                for (const n of Hex.neighbors(q, r)) {
                    const nt = world.getTile(Hex.wrapQ(n.q, w), n.r);
                    if (nt && Ships.isWaterTile(nt)) water++;
                }
                if (water >= 2) cands.push({ q, r, score: _hash(seed, 'haven', q, r) });
            }
        }
        cands.sort((a, b) => a.score - b.score);
        const setts = Pirates._settlements(world);
        const names = Pirates.data().havenNames || ['Pirate Cove'];
        const out = [];
        for (const c of cands) {
            if (out.length >= cfg.havenCount) break;
            if (setts.some(s => _dist(world, c.q, c.r, s.q, s.r) < cfg.havenMinSettlementDistance)) continue;
            if (out.some(o => _dist(world, c.q, c.r, o.q, o.r) < cfg.havenSpacing)) continue;
            const i = out.length;
            out.push({ id: `haven_${i}`, name: names[(_hash(seed, 'havenName') + i) % names.length], q: c.q, r: c.r, known: false, raidedDay: null });
        }
        return out;
    },

    /** A new captain at large: the next of the named pool, then successors. */
    _spawnCaptain(st, world) {
        const D = Pirates.data();
        const cfg = Pirates.config();
        const seed = _seed(world);
        const day = _day(world);
        const pool = (D.captains || []).slice().sort((a, b) => _hash(seed, 'cpt', a.id) - _hash(seed, 'cpt', b.id));
        let tpl = pool.find(c => !st.used.includes(c.id));
        if (!tpl) {
            const N = D.successorNames || {};
            const pick = (arr, salt, d) => (arr && arr.length ? arr[_hash(seed, salt, st.succ) % arr.length] : d);
            const base = (D.captains || [])[_hash(seed, 'tplpick', st.succ) % Math.max(1, (D.captains || []).length)] || {};
            tpl = {
                id: `successor_${st.succ}`,
                name: `${pick(N.first, 'f', 'Black')} ${pick(N.last, 'l', 'Ned')}`,
                epithet: pick(N.epithets, 'e', 'the Younger'),
                icon: base.icon || '🏴‍☠️',
                shipName: pick(N.ships, 's', 'Vengeance'),
                shipType: base.shipType || 'sloop',
                strength: base.strength || [10, 18],
                temperament: ['cruel', 'greedy', 'honourable'][_hash(seed, 't', st.succ) % 3],
            };
            st.succ++;
        }
        st.used.push(tpl.id);
        const havens = st.havens || [];
        const haven = havens.length ? havens[_hash(seed, 'hv', tpl.id) % havens.length] : null;
        const cap = {
            id: tpl.id, name: tpl.name, epithet: tpl.epithet || '', icon: tpl.icon || '🏴‍☠️',
            shipName: tpl.shipName || 'Nameless', shipType: tpl.shipType || 'sloop',
            strength: _hashRange(tpl.strength || [10, 18], seed, 'str', tpl.id),
            temperament: tpl.temperament || 'greedy', havenId: haven ? haven.id : null,
            status: 'at_large', regard: 0, met: 0, beaten: 0, beatYou: 0, spared: 0, ransomed: 0, escaped: 0,
            loot: 0, lastMetDay: null, since: day, memory: [],
        };
        st.captains.push(cap);
        return cap;
    },

    /** A captain met at sea: counted, and where and when last seen (drawn on the chart). */
    _sighted(cap, player, world) {
        cap.met++;
        cap.lastMetDay = _day(world);
        if (player && Number.isFinite(player.q) && Number.isFinite(player.r)) { cap.seenQ = player.q; cap.seenR = player.r; }
    },

    _remember(cap, world, text) {
        cap.memory.push({ day: _day(world), text });
        if (cap.memory.length > 5) cap.memory.splice(0, cap.memory.length - 5);
    },

    /** What a captain remembers of you, in a line. */
    memoryLine(cap) {
        if (!cap) return '';
        const bits = [];
        if (cap.regard >= 30) bits.push('remembers your mercy');
        else if (cap.regard <= -30) bits.push('has sworn to see you drowned');
        else if (cap.regard <= -10) bits.push('bears you a grudge');
        if (cap.beaten) bits.push(`you have beaten them ${cap.beaten === 1 ? 'once' : `${cap.beaten} times`}`);
        if (cap.beatYou) bits.push(`they have beaten you ${cap.beatYou === 1 ? 'once' : `${cap.beatYou} times`}`);
        if (cap.ransomed) bits.push('you ransomed them once');
        if (!bits.length) return cap.met ? 'You have crossed wakes before.' : 'They do not know you yet.';
        return `${cap.name} ${bits.join('; ')}.`;
    },

    // ──────────── THE DAILY TICK ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:pirates:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day: captains raid the lanes (grow), the hanged are replaced,
     * infamy cools, and at sea hunters or a vengeful captain may come for
     * you. Returns { notices, threat } — threat is the start of an encounter
     * (startThreat) for the UI, or resolve it headless with autoResolve.
     */
    processDay(world, player) {
        const out = { notices: [], threat: null };
        if (!world || !player) return out;
        const st0 = player.seaRoving;
        if (!st0 && !(player.ships || []).length) return out;
        Utils.withRng(Pirates._dayRng(world), () => Pirates._tick(world, player, out));
        return out;
    },

    _tick(world, player, out) {
        const cfg = Pirates.config();
        const st = Pirates.ensure(player, world);
        const day = _day(world);
        for (const c of st.captains) {
            if (c.status === 'at_large') c.strength = Math.min(cfg.maxStrength, Math.round((c.strength + cfg.growthPerDay) * 100) / 100);
        }
        if (Pirates.atLarge(player).length < cfg.activeCaptains) {
            if (st.nextSuccessorDay == null) st.nextSuccessorDay = day + _roll(cfg.successorDays);
            else if (day >= st.nextSuccessorDay) {
                const cap = Pirates._spawnCaptain(st, world);
                st.nextSuccessorDay = null;
                if (cap) {
                    const h = Pirates.haven(player, cap.havenId);
                    const text = `A new captain flies the black flag${h && h.known ? ` out of ${h.name}` : ''}: ${cap.name} ${cap.epithet}, in the ${cap.shipName}.`;
                    Pirates._log(st, world, text);
                    out.notices.push({ icon: '🏴‍☠️', title: 'A New Sea Rover', text, type: 'warning' });
                }
            }
        }
        const atSea = Pirates._atSea(player, world);
        const I = cfg.infamy;
        if (st.infamy > 0) st.infamy = Math.max(0, Math.round((st.infamy - (atSea ? I.decayPerDay : I.portDecayPerDay)) * 10) / 10);
        if (!atSea) return;
        if (st.infamy >= I.huntersAt && day - st.lastHunterDay >= I.hunterCooldownDays) {
            const p = I.hunterChance + (st.infamy - I.huntersAt) * I.hunterChancePerInfamy;
            if (Utils.random() < p) {
                st.lastHunterDay = day;
                out.threat = Pirates._hunterThreat(player, world, st);
                return;
            }
        }
        const V = cfg.vengeance;
        if (day - st.lastVengeanceDay >= V.cooldownDays) {
            const foes = Pirates.atLarge(player).filter(c => c.regard <= V.regardBelow);
            if (foes.length && Utils.random() < V.chance * foes.length) {
                st.lastVengeanceDay = day;
                const cap = foes[Utils.randInt(0, foes.length - 1)];
                out.threat = { kind: 'vengeance', captainId: cap.id };
            }
        }
    },

    _atSea(player, world) {
        if (!player || player.boardedShip == null || !world || typeof world.getTile !== 'function') return false;
        if (Ships.getVoyage(player)) return false;
        return Ships.isWaterTile(world.getTile(player.q, player.r));
    },

    _hunterThreat(player, world, st) {
        const cfg = Pirates.config();
        const names = Pirates.data().hunterNames || ['a navy squadron'];
        const realm = Underworld._nearestKingdom(world, player.q, player.r);
        const k = realm && world.getKingdom ? world.getKingdom(realm) : null;
        return {
            kind: 'hunters',
            name: names[_hash(_seed(world), 'hunter', _day(world)) % names.length],
            realm: realm || null, realmName: (k && k.name) || null,
            strength: Math.round(_roll(cfg.hunters.strength) + st.infamy * cfg.hunters.perInfamy),
        };
    },

    // ──────────── ENCOUNTERS ────────────

    _ship(player, state) {
        return Ships.getShipById(player, state && state.shipId != null ? state.shipId : player.boardedShip);
    },

    _shipStr(player, ship) {
        return ship ? Ships._getShipCombatStrength(ship, player) : 1;
    },

    _speed(player, ship) {
        return ship ? Ships.getSailingSpeed(player, ship) : 3;
    },

    _typeSpeed(typeId) {
        const t = Ships.getShipType(typeId);
        return t ? _num(t.speed, 4) : 4;
    },

    _captainEnemy(cap) {
        return {
            type: 'pirate', captainId: cap.id, name: cap.name, epithet: cap.epithet, icon: cap.icon,
            shipName: cap.shipName, shipType: cap.shipType, temperament: cap.temperament,
            strength: Math.max(3, Math.round(cap.strength)), str0: Math.max(3, Math.round(cap.strength)),
            speed: Pirates._typeSpeed(cap.shipType),
        };
    },

    _anonPirates() {
        const data = DataLoader.ships || {};
        const ps = data.pirateStrength || { min: 8, max: 30 };
        const s = _roll([ps.min, ps.max - 1]);
        return { type: 'pirate', captainId: null, name: 'a nameless rover', epithet: '', icon: '🏴‍☠️', shipName: 'an unmarked sloop', shipType: 'sloop', temperament: 'greedy', strength: s, str0: s, speed: Pirates._typeSpeed('sloop') };
    },

    /** The captain met while hunting: near their haven, or one who is looking for you. */
    _pickCaptain(player, world) {
        const cfg = Pirates.config();
        Pirates.ensure(player, world);
        const list = Pirates.atLarge(player);
        if (!list.length) return null;
        const weights = list.map(c => {
            const h = Pirates.haven(player, c.havenId);
            const d = h ? _dist(world, player.q, player.r, h.q, h.r) : cfg.captainMeetRadius;
            let w = d <= cfg.captainMeetRadius ? 3 : 1;
            w /= 1 + d / 20;
            if (c.regard <= -30) w *= 2;
            return w;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Utils.random() * total;
        for (let i = 0; i < list.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return list[i];
        }
        return list[list.length - 1];
    },

    /**
     * Start an activity at sea (the ship's action menu). activity:
     * 'hunt' | 'prey' | 'explore'. Returns { state } for a scene, or
     * { done, notification, discovery? } when nothing (or an uncharted
     * place) was found, or { success:false, message }.
     */
    start(player, world, activity) {
        const ship = Ships.getShipById(player, player.boardedShip);
        if (!ship) return { success: false, message: 'You need to be aboard your ship on open water.' };
        const cfg = Pirates.config();
        Pirates.ensure(player, world);
        const fx = Ships.getShipEffectiveStats(ship).effects || {};
        const base = { shipId: ship.id, log: [] };
        ship.condition = Math.max(5, _num(ship.condition, 100) - 1);
        if (activity === 'explore') {
            const found = world ? Discovery.searchWaters(player, ship.id, world) : null;
            if (found) return { done: true, discovery: found.discovery, notices: found.notices || [], notification: { title: `${found.icon} Discovery`, body: found.title, type: 'success' } };
            return { state: Pirates._eventState(player, world, ship, base) };
        }
        if (activity === 'hunt') {
            const miss = Math.max(0.2, (1 - cfg.find.hunt) - cfg.find.lookout * _num(fx.explorationBonus));
            if (Utils.random() < miss) return { done: true, notification: { title: '🌊 Empty Seas', body: 'You patrol the waters but sight no black flag today.', type: 'info' } };
            const cap = Pirates._pickCaptain(player, world);
            const enemy = cap ? Pirates._captainEnemy(cap) : Pirates._anonPirates();
            if (cap) Pirates._sighted(cap, player, world);
            return { state: { ...base, kind: 'hunt', phase: 'sighting', enemy } };
        }
        if (activity === 'prey') {
            const miss = Math.max(0.15, (1 - cfg.find.prey) - cfg.find.lookout * _num(fx.explorationBonus));
            if (Utils.random() < miss) return { done: true, notification: { title: '🌊 No Prey', body: 'You lurk the shipping lanes but no fat merchantman appears.', type: 'info' } };
            return { state: { ...base, kind: 'prey', phase: 'prey_sighting', enemy: Pirates._merchantEnemy(player, world) } };
        }
        return { success: false, message: 'Unknown sea activity.' };
    },

    _merchantEnemy(player, world) {
        const M = Pirates.config().merchant;
        const names = Pirates.data().merchantNames || ['Merchantman'];
        const realm = Underworld._nearestKingdom(world, player.q, player.r);
        const k = realm && world && world.getKingdom ? world.getKingdom(realm) : null;
        const goods = (DataLoader.ships && DataLoader.ships.tradeGoods) || [];
        const good = goods.length ? goods[Utils.randInt(0, goods.length - 1)] : null;
        const escort = Utils.random() < M.escortChance;
        const str = _roll(M.strength) + (escort ? _roll(M.escortStrength) : 0);
        return {
            type: 'merchant', captainId: null, name: names[Utils.randInt(0, names.length - 1)], epithet: '', icon: '⛵',
            shipName: '', shipType: Utils.random() < 0.5 ? 'cog' : 'caravel', temperament: 'merchant',
            strength: str, str0: str, speed: Pirates._typeSpeed('cog'), escort,
            gold: _roll(M.gold), cargo: good ? { [good.id]: _roll(M.cargoUnits) } : {},
            realm: realm || null, flag: (k && k.name) || 'no realm',
        };
    },

    /**
     * A threat from the daily tick becomes an encounter state: hunters on
     * your wake, or a captain who has come looking for you.
     */
    startThreat(player, world, threat) {
        const ship = Ships.getShipById(player, player.boardedShip);
        if (!ship || !threat) return null;
        const base = { shipId: ship.id, log: [] };
        if (threat.kind === 'hunters') {
            const enemy = { type: 'hunters', captainId: null, name: threat.name, epithet: threat.realmName ? `for the crown of ${threat.realmName}` : 'pirate hunters', icon: '⚓', shipName: '', shipType: 'war_galley', temperament: 'navy', strength: threat.strength, str0: threat.strength, speed: Pirates._typeSpeed('caravel'), realm: threat.realm };
            return { ...base, kind: 'hunters', phase: 'hunters', enemy };
        }
        if (threat.kind === 'vengeance') {
            const cap = Pirates.captain(player, threat.captainId);
            if (!cap || cap.status !== 'at_large') return null;
            Pirates._sighted(cap, player, world);
            return { ...base, kind: 'vengeance', phase: 'vengeance', enemy: Pirates._captainEnemy(cap) };
        }
        return null;
    },

    // ── odds (deterministic: draw nothing) ──

    chaseChance(player, world, state) {
        const C = Pirates.config().chase;
        const ship = Pirates._ship(player, state);
        return _clamp(C.base + (Pirates._speed(player, ship) - state.enemy.speed) * C.speed + _skill(player, 'leadership') * C.seafaring, 0.05, 0.95);
    },

    shadowChance(player, world, state) {
        const S = Pirates.config().shadow;
        const ship = Pirates._ship(player, state);
        const fx = ship ? (Ships.getShipEffectiveStats(ship).effects || {}) : {};
        return _clamp(S.base + _skill(player, 'stealth') * S.stealth + _num(fx.stealthBonus) * S.shipStealth, 0.05, 0.9);
    },

    fleeChance(player, world, state) {
        const F = Pirates.config().flee;
        const ship = Pirates._ship(player, state);
        return _clamp(F.base + (Pirates._speed(player, ship) - state.enemy.speed) * F.speed + _skill(player, 'stealth') * F.stealth, 0.05, 0.95);
    },

    parleyChance(player, world, state) {
        const P = Pirates.config().parley;
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        let c = P.base + _skill(player, 'diplomacy') * P.diplomacy + _num(player.charisma, 5) * P.charisma
            + Math.min(P.renownCap, Math.max(0, _num(player.renown)) / P.renownPer);
        if (cap) c += cap.regard * P.regard;
        if (e.temperament === 'honourable') c += P.honourable;
        if (e.temperament === 'cruel') c += P.cruel;
        c += Pirates.getInfamy(player) * P.infamy; // a fellow rover is heard out
        if (e.type === 'hunters') c -= 0.1;
        return _clamp(c, 0.05, 0.9);
    },

    boardChance(player, world, state) {
        const ship = Pirates._ship(player, state);
        const mult = state.unready ? Pirates.config().board.unready : 1;
        // (tougher or softer foes by the difficulty — core/difficulty.js; exact on Normal)
        return Difficulty.againstFoe(player, _odds(Pirates._shipStr(player, ship) * mult, state.enemy.strength));
    },

    duelChance(player, world, state) {
        const D = Pirates.config().duel;
        const ail = Ailments.battleMultiplier ? Ailments.battleMultiplier(player) : 1;
        const own = (_skill(player, 'combat') * D.combat + _num(player.strength, 5) * D.strength + D.base) * ail;
        const theirs = state.enemy.str0 * D.captainMult + D.base;
        return _clamp(own / (own + theirs), 0.05, 0.95);
    },

    demandChance(player, world, state) {
        const I = Pirates.config().infamy;
        const ship = Pirates._ship(player, state);
        const ratio = Pirates._shipStr(player, ship) / Math.max(1, state.enemy.strength);
        return _clamp(0.1 + Math.min(0.4, (ratio - 1) * 0.25) + Pirates.getInfamy(player) * I.merchantsYieldPer + Math.min(0.1, _num(player.renown) / 1000), 0.05, 0.9);
    },

    /** A pirate crew talked into striking: only when you clearly outgun them. */
    _surrenderChance(player, state) {
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const ratio = Pirates._shipStr(player, Pirates._ship(player, state)) / Math.max(1, e.strength);
        if (ratio < 1.3) return 0.05;
        return _clamp(0.3 + (ratio - 1.3) * 0.3 + (cap && cap.regard > 0 ? 0.15 : 0), 0.05, 0.9);
    },

    bribeCost(player, state) {
        return Math.max(20, Math.round(Pirates.getInfamy(player) * Pirates.config().hunters.bribePerInfamy + state.enemy.strength * 2));
    },

    fineAmount(player) {
        return Math.max(25, Math.round(Pirates.getInfamy(player) * Pirates.config().hunters.finePerInfamy));
    },

    // ── the scene view ──

    /** The view of an encounter: { icon, title, text, stats, lines, log, options }. */
    view(player, world, state) {
        if (!state) return null;
        if (state.kind === 'event') return Pirates._eventView(player, world, state);
        if (state.kind === 'log') return Pirates._logView(player, world, state);
        const e = state.enemy;
        const ship = Pirates._ship(player, state);
        if (!ship) return null;
        const opt = (id, icon, label, hint, chance, extra = {}) => ({ id, icon, label, hint, chance, can: true, reason: '', cost: '', ...extra });
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const stats = [`Their strength ${Math.round(e.strength)}`, `your ship ${Math.round(Pirates._shipStr(player, ship))}`, `crew ${Ships.getCrew(ship)}`, `hull ${Math.round(ship.condition)}%`];
        const who = e.type === 'pirate' ? `${e.name}${e.epithet ? `, ${e.epithet}` : ''}${e.shipName ? ` (the ${e.shipName})` : ''}` : e.name;
        const lines = [];
        if (cap) lines.push(Pirates.memoryLine(cap));
        if (cap && cap.temperament) lines.push(`Known to be ${cap.temperament === 'honourable' ? 'a rover with a code' : cap.temperament === 'cruel' ? 'cruel: they give no quarter' : 'greedy: everything has its price'}.`);
        const out = { icon: e.icon, title: who, stats, lines, log: state.log, options: [] };
        switch (state.phase) {
            case 'sighting':
                out.text = `A black flag on the horizon: ${who}. They have seen you too.`;
                out.options.push(opt('chase', '⛵', 'Give chase', `Your ${Math.round(Pirates._speed(player, ship))} knots against their ${e.speed}.`, Pirates.chaseChance(player, world, state)));
                out.options.push(opt('shadow', '🌫️', 'Shadow them till dusk', 'Stealth and a quiet ship: fall on them unready (stronger boarding). Seen, they run.', Pirates.shadowChance(player, world, state)));
                out.options.push(opt('parley', '🗣️', 'Hail and parley', 'Talk: their surrender, word of their haven, or a truce.', Pirates.parleyChance(player, world, state)));
                out.options.push(opt('break', '↩️', 'Break off', 'Let them sail on.', null, { odds: false }));
                break;
            case 'vengeance':
                out.text = `${who} has come looking for you, guns run out.`;
                out.options.push(opt('flee', '💨', 'Run for it', 'Crowd on sail.', Pirates.fleeChance(player, world, state)));
                out.options.push(opt('parley', '🗣️', 'Parley', 'Talk them down — hard, with what lies between you.', Pirates.parleyChance(player, world, state)));
                out.options.push(opt('fight', '⚔️', 'Turn and fight', 'Clear for action.', Pirates.boardChance(player, world, state)));
                break;
            case 'parley': {
                out.text = `${e.name} will talk. Across the water, a speaking-trumpet: "What do you want?"`;
                const ratio = Pirates._shipStr(player, ship) / Math.max(1, e.strength);
                const haven = cap ? Pirates.haven(player, cap.havenId) : null;
                const price = Math.round(e.strength * 6);
                out.options.push(opt('demand', '🏳️', 'Demand their surrender', ratio >= 1.3 ? 'You have the guns; they may see sense.' : 'You are not strong enough to make them.', Pirates._surrenderChance(player, state)));
                if (haven && !haven.known) out.options.push(opt('buy_haven', '🗺️', 'Buy word of their haven', 'Gold for the bearing of their cove.', null, { cost: `${price} gold`, can: _num(player.gold) >= price, reason: `They want ${price} gold` }));
                out.options.push(opt('tribute', '💰', 'Pay them to leave these waters', 'They spare you, and the coast, for a while.', null, { cost: `${price} gold`, can: _num(player.gold) >= price, reason: `They want ${price} gold` }));
                out.options.push(opt('part', '🤝', 'Part ways', 'Each to their own course.', null, { odds: false }));
                break;
            }
            case 'prey_sighting':
                out.text = `A merchantman under the flag of ${e.flag}: ${e.name}${e.escort ? ', with an escort' : ''}, low in the water with cargo.`;
                out.options.push(opt('chase', '⛵', 'Run her down', 'A chase, then a fight.', Pirates.chaseChance(player, world, state)));
                out.options.push(opt('false_colours', '🎭', 'Approach under false colours', 'Stealth: board her before she knows you, and fewer will know your name.', Pirates.shadowChance(player, world, state) + 0.1));
                out.options.push(opt('demand', '☠️', 'Run up the black flag and demand she strike', 'Your name and your guns do the work — no blood if she yields.', Pirates.demandChance(player, world, state)));
                out.options.push(opt('break', '↩️', 'Let her pass', 'Not today.', null, { odds: false }));
                break;
            case 'hunters':
                out.text = `${e.name}, ${e.epithet}: they know your sails, and they have come for you.`;
                out.lines.push(`Your infamy: ${Math.round(Pirates.getInfamy(player))} (${Pirates.infamyLevel(Pirates.getInfamy(player))}).`);
                out.options.push(opt('flee', '💨', 'Run', 'Outsail them.', Pirates.fleeChance(player, world, state)));
                out.options.push(opt('fight', '⚔️', 'Fight', 'Beat them, and your name grows darker still.', Pirates.boardChance(player, world, state)));
                {
                    const bribe = Pirates.bribeCost(player, state);
                    out.options.push(opt('bribe', '💰', 'Bribe their captain', 'Gold for a blind eye. Refused, they keep the purse and come on.', Pirates.parleyChance(player, world, state) + 0.15, { cost: `${bribe} gold`, can: _num(player.gold) >= bribe, reason: `Needs ${bribe} gold` }));
                    const fine = Pirates.fineAmount(player);
                    out.options.push(opt('surrender', '🏳️', 'Strike your colours', `Pay a ${fine} gold fine and lose your cargo — or go to the cells if you cannot.`, null));
                }
                break;
            case 'battle': {
                out.text = state.unready ? `You are alongside the ${e.shipName || e.name} before they are ready.` : `Guns run out, grapnels ready. ${e.type === 'merchant' ? 'The merchantman will fight.' : 'Battle is joined.'}`;
                const B = Pirates.config().broadside;
                out.options.push(opt('broadside', '💥', 'Broadside', `Wear them down from range: they lose ${Math.round(B.enemyLoss[0] * 100)}–${Math.round(B.enemyLoss[1] * 100)}% and may strike; your hull takes shot.`, null, { odds: false }));
                out.options.push(opt('board', '⚓', 'Grapple and board', 'Decide it hand to hand.', Pirates.boardChance(player, world, state)));
                if (e.type === 'pirate' && e.captainId) out.options.push(opt('duel', '🤺', `Duel ${e.name}`, 'Your blade against theirs on the quarterdeck; their crew yield if they fall.', Pirates.duelChance(player, world, state)));
                out.options.push(opt('withdraw', '🏳️', 'Withdraw', e.type === 'hunters' ? 'Break away under fire (they will follow again).' : 'Break off; they get away.', null));
                break;
            }
            case 'aftermath_crew': {
                out.text = `${e.name}'s crew have thrown down their arms. ${e.captainId ? `${e.name} stands before you in chains.` : ''}`;
                const ransom = Pirates._ransomAmount(e);
                const bounty = Math.round(e.str0 * Pirates.config().bountyPerStrength);
                out.options.push(opt('ransom', '💰', 'Hold the captain for ransom', 'Their haven pays — and so you learn where it lies. They go free, and remember.', null, { cost: `~${ransom} gold`, odds: false }));
                out.options.push(opt('hang', '⚖️', 'Hand them to the crown', `The bounty (~${bounty} gold) and renown; the gallows for them.`, null, { odds: false }));
                out.options.push(opt('press', '⛓️', 'Press the crew into yours', 'Sailors for your ship; their captain set adrift, humiliated.', null, { odds: false }));
                out.options.push(opt('spare', '🕊️', 'Let them go with their lives', 'Mercy is remembered at sea.', null, { odds: false }));
                break;
            }
            case 'aftermath_ship': {
                out.text = `The ${e.shipName || 'ship'} is yours to dispose of.`;
                const why = Pirates._prizeReason(player, ship);
                const sale = Math.round(e.str0 * Pirates.config().prizeSalePerStrength * 0.6);
                out.options.push(opt('prize', '⚓', 'Seize her as a prize', 'She joins your fleet: a prize crew sails her to the nearest port.', null, { can: !why, reason: why || '', odds: false }));
                out.options.push(opt('sell', '💰', 'Sell her to a prize broker', 'Gold now, at a broker\'s price.', null, { cost: `+${sale} gold`, odds: false }));
                out.options.push(opt('scuttle', '🔥', 'Scuttle her', 'One fewer pirate hull on the sea.', null, { odds: false }));
                if (state.spared) out.options.push(opt('leave', '🕊️', 'Let them keep her', 'They sail away in her, owing you everything.', null, { odds: false }));
                break;
            }
            case 'merchant_aftermath': {
                out.text = `${e.name} has struck. Her master waits on deck, hat in hand.`;
                const cargoText = Object.entries(e.cargo || {}).map(([id, n]) => `${n} ${id}`).join(', ') || 'little';
                out.lines.push(`Her strongbox: ~${e.gold} gold. Her hold: ${cargoText}.`);
                const why = Pirates._prizeReason(player, ship);
                out.options.push(opt('plunder', '📦', 'Plunder her and let her go', 'Gold and cargo; her crew will talk in port.', null, { odds: false }));
                out.options.push(opt('ransom', '💰', 'Ransom the passengers too', 'More gold, more talk, more infamy.', null, { odds: false }));
                out.options.push(opt('prize', '⚓', 'Take the ship herself', 'Plunder, and she joins your fleet; her crew in the boats.', null, { can: !why, reason: why || '', odds: false }));
                out.options.push(opt('sink', '💀', 'Sink her — no witnesses', 'Take everything and leave nothing to tell. Your soul pays.', null, { odds: false }));
                break;
            }
            case 'haven': {
                const h = Pirates.haven(player, state.havenId);
                out.title = h ? h.name : 'A Pirate Haven';
                out.icon = '🏝️';
                out.text = `The cove of ${h ? h.name : 'the rovers'}: masts behind the point, smoke from cookfires, a battery on the headland.`;
                out.options.push(opt('assault', '⚔️', 'Bombard and storm it', 'Your guns and boarders against the haven.', Pirates.boardChance(player, world, state)));
                out.options.push(opt('night', '🌙', 'A night landing', 'Stealth: in and out with their hoard before the alarm. Seen, it is a fight in the dark.', Pirates.shadowChance(player, world, state)));
                out.options.push(opt('break', '↩️', 'Sail on', 'Another day.', null, { odds: false }));
                break;
            }
            default:
                return null;
        }
        return out;
    },

    _ransomAmount(e) {
        return Math.round(e.str0 * Pirates.config().ransomPerStrength);
    },

    _prizeReason(player, ship) {
        const full = Ships.fleetLimitReason(player);
        if (full) return full;
        const need = Pirates.config().prizeCrew;
        if (!ship || Ships.getCrew(ship) - need < Ships.getMinCrew(ship)) return `You cannot spare a prize crew of ${need}`;
        return null;
    },

    // ── acting on a choice ──

    /**
     * Act on a choice. Returns { state } to go on, or { done, notification }
     * when the encounter is over ({ invalid } for a refused choice).
     */
    act(player, world, state, choice) {
        if (!state) return { done: true };
        if (state.kind === 'event') return Pirates._eventAct(player, world, state, choice);
        if (state.kind === 'log') return { done: true, notification: null };
        const ship = Pirates._ship(player, state);
        if (!ship) return { done: true, notification: { title: 'At Sea', body: 'Your ship is no longer under you.', type: 'error' } };
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const roll = (p) => Utils.random() < p;
        const go = (phase, note, extra = {}) => ({ state: { ...state, ...extra, phase, log: [...(state.log || []), note] } });
        const end = (title, body, type = 'info', extra = {}) => ({ done: true, notification: { title, body, type }, ...extra });

        switch (state.phase) {
            case 'sighting':
            case 'prey_sighting': {
                if (choice === 'break') {
                    if (cap) Pirates._remember(cap, world, 'you let them sail on');
                    return end('↩️ Broken Off', `You let ${e.name} sail on.`, 'info');
                }
                if (choice === 'chase') {
                    const ok = roll(Pirates.chaseChance(player, world, state));
                    _train(player, 'leadership', 0.05);
                    if (ok) return go('battle', `⛵ You ran ${e.name} down.`);
                    if (cap) { cap.escaped++; Pirates._remember(cap, world, 'outran you'); }
                    return end('💨 They Got Away', `${e.name} outsailed you and was lost to sight.`, 'warning');
                }
                if (choice === 'shadow' || choice === 'false_colours') {
                    const bonus = choice === 'false_colours' ? 0.1 : 0;
                    const ok = roll(Math.min(0.95, Pirates.shadowChance(player, world, state) + bonus));
                    _train(player, 'stealth', ok ? 0.15 : 0.05);
                    if (ok) return go('battle', choice === 'false_colours' ? '🎭 Your false colours fooled them until your grapnels flew.' : '🌫️ You fell on them at dusk, unready.', { unready: true, disguised: choice === 'false_colours' });
                    if (state.phase === 'prey_sighting') return go('battle', '👀 They saw through you and cleared for action.');
                    if (cap) { cap.escaped++; Pirates._remember(cap, world, 'slipped your shadow'); }
                    return end('👀 Seen', `${e.name} spotted you and slipped away in the dark.`, 'warning');
                }
                if (choice === 'parley' && state.phase === 'sighting') {
                    const ok = roll(Pirates.parleyChance(player, world, state));
                    _train(player, 'diplomacy', ok ? 0.15 : 0.05);
                    if (ok) return go('parley', `🗣️ ${e.name} agreed to talk.`);
                    const dmg = Ships.mitigateHullDamage(ship, _roll([3, 8]));
                    ship.condition = Math.max(5, ship.condition - dmg);
                    return go('battle', `💥 ${e.name} answered with a broadside (−${dmg}% hull).`);
                }
                if (choice === 'demand' && state.phase === 'prey_sighting') {
                    const ok = roll(Pirates.demandChance(player, world, state));
                    if (ok) return Pirates._victory(player, world, { ...state, bloodless: true, log: [...(state.log || []), `☠️ ${e.name} struck her colours without a fight.`] }, ship);
                    return go('battle', `${e.name} ran out her guns.`);
                }
                return { invalid: true };
            }
            case 'vengeance': {
                if (choice === 'flee') {
                    const ok = roll(Pirates.fleeChance(player, world, state));
                    if (ok) return end('💨 Escaped', `You outran ${e.name}. They will try again.`, 'success');
                    return go('battle', `${e.name} caught you.`);
                }
                if (choice === 'parley') {
                    const ok = roll(Pirates.parleyChance(player, world, state));
                    _train(player, 'diplomacy', ok ? 0.2 : 0.05);
                    if (ok) {
                        if (cap) { cap.regard = Math.min(100, cap.regard + 25); Pirates._remember(cap, world, 'talked down by you'); }
                        return end('🗣️ Talked Down', `Hard words across the water, and then a grudging salute: ${e.name} sheers off. The feud is cooler now.`, 'success');
                    }
                    return go('battle', `${e.name} would not hear it.`);
                }
                if (choice === 'fight') return go('battle', 'You turned to meet them.');
                return { invalid: true };
            }
            case 'parley': {
                const price = Math.round(e.strength * 6);
                if (choice === 'demand') {
                    if (roll(Pirates._surrenderChance(player, state))) return Pirates._victory(player, world, { ...state, bloodless: true, log: [...(state.log || []), `🏳️ ${e.name} struck their colours.`] }, ship);
                    return go('battle', `${e.name} laughed and ran out the guns.`);
                }
                if (choice === 'buy_haven' && cap) {
                    if (_num(player.gold) < price) return { invalid: true, notification: { title: 'Purse Too Light', body: `They want ${price} gold.`, type: 'error' } };
                    player.gold -= price;
                    Ledger.record(player, 'seaFines', -price);
                    const h = Pirates.haven(player, cap.havenId);
                    if (h) h.known = true;
                    Pirates._log(Pirates.state(player), world, `Bought the bearing of ${h ? h.name : 'a haven'} from ${cap.name}.`);
                    return end('🗺️ A Haven Revealed', `For ${price} gold, ${e.name} marks ${h ? `${h.name} at (${h.q}, ${h.r})` : 'their cove'} on your chart. Sail there to raid it.`, 'success');
                }
                if (choice === 'tribute') {
                    if (_num(player.gold) < price) return { invalid: true, notification: { title: 'Purse Too Light', body: `They want ${price} gold.`, type: 'error' } };
                    player.gold -= price;
                    Ledger.record(player, 'seaFines', -price);
                    if (cap) {
                        cap.regard = Math.min(100, cap.regard + 10);
                        cap.loot += price;
                        Pirates._remember(cap, world, 'took your gold to leave');
                    }
                    return end('💰 Bought Off', `${e.name} takes ${price} gold and sails for other waters.`, 'warning');
                }
                if (choice === 'part') {
                    if (cap) {
                        cap.regard = Math.min(100, cap.regard + 3);
                        // An honourable rover who likes you tells you of a rival's cove
                        if (cap.regard >= 20) {
                            const other = Pirates.atLarge(player).find(c => c.id !== cap.id && c.havenId && !(Pirates.haven(player, c.havenId) || {}).known);
                            const h = other && Pirates.haven(player, other.havenId);
                            if (h) {
                                h.known = true;
                                return end('🤝 Parted as Friends', `${e.name} salutes you, and shouts across the water that ${other.name} lies up at ${h.name} (${h.q}, ${h.r}).`, 'success');
                            }
                        }
                    }
                    return end('🤝 Parted', `You and ${e.name} go your ways.`, 'info');
                }
                return { invalid: true };
            }
            case 'hunters': {
                if (choice === 'flee') {
                    const ok = roll(Pirates.fleeChance(player, world, state));
                    _train(player, 'stealth', ok ? 0.1 : 0.05);
                    if (ok) return end('💨 Outsailed Them', `You lost ${e.name} in the swell. They will be back.`, 'success');
                    return go('battle', `${e.name} ran you down.`);
                }
                if (choice === 'fight') return go('battle', 'You cleared for action against the hunters.');
                if (choice === 'bribe') {
                    const cost = Pirates.bribeCost(player, state);
                    if (_num(player.gold) < cost) return { invalid: true, notification: { title: 'Purse Too Light', body: `They want ${cost} gold.`, type: 'error' } };
                    player.gold -= cost;
                    Ledger.record(player, 'seaFines', -cost);
                    if (roll(Math.min(0.95, Pirates.parleyChance(player, world, state) + 0.15))) {
                        Pirates.state(player).lastHunterDay = _day(world) + 4;
                        return end('💰 A Blind Eye', `${e.name} pockets ${cost} gold and finds pressing business elsewhere.`, 'warning');
                    }
                    return go('battle', `They took your ${cost} gold — and then the guns ran out.`);
                }
                if (choice === 'surrender') return Pirates._surrender(player, world, state, ship);
                return { invalid: true };
            }
            case 'battle':
                return Pirates._battleAct(player, world, state, ship, choice, go, end);
            case 'aftermath_crew':
                return Pirates._crewFate(player, world, state, ship, choice, go, end);
            case 'aftermath_ship':
                return Pirates._shipFate(player, world, state, ship, choice, end);
            case 'merchant_aftermath':
                return Pirates._merchantFate(player, world, state, ship, choice, end);
            case 'haven':
                return Pirates._havenAct(player, world, state, ship, choice, go, end);
            default:
                return { done: true };
        }
    },

    _battleAct(player, world, state, ship, choice, go, end) {
        const cfg = Pirates.config();
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        if (choice === 'broadside') {
            const B = cfg.broadside;
            const loss = Utils.randFloat(B.enemyLoss[0], B.enemyLoss[1]) * Math.min(1.5, Pirates._shipStr(player, ship) / Math.max(1, e.strength));
            const enemy = { ...e, strength: Math.max(1, Math.round(e.strength * (1 - Math.min(0.6, loss)))) };
            const dmg = Ships.mitigateHullDamage(ship, _roll(B.hull));
            ship.condition = Math.max(5, ship.condition - dmg);
            const note = `💥 Broadsides: they lose ${Math.round(Math.min(0.6, loss) * 100)}% of their fight; your hull −${dmg}%.`;
            const strikes = enemy.strength <= e.str0 * B.strikeBelow && e.temperament !== 'cruel' && e.type !== 'hunters';
            if (strikes) {
                const next = { ...state, enemy, unready: false, log: [...(state.log || []), note, `🏳️ ${e.name} strikes their colours.`] };
                return Pirates._victory(player, world, next, ship);
            }
            return { state: { ...state, enemy, unready: false, log: [...(state.log || []), note] } };
        }
        if (choice === 'board') {
            const ok = Utils.random() < Pirates.boardChance(player, world, state);
            _train(player, 'combat', ok ? 0.1 : 0.05);
            if (ok) return Pirates._victory(player, world, { ...state, log: [...(state.log || []), '⚓ Your boarders carried their deck.'] }, ship);
            return Pirates._defeat(player, world, state, ship, 'Their crew threw your boarders back.');
        }
        if (choice === 'duel' && e.type === 'pirate' && e.captainId) {
            const ok = Utils.random() < Pirates.duelChance(player, world, state);
            _train(player, 'combat', ok ? 0.3 : 0.1);
            if (ok) {
                Traits.recordDeed(player, 'valor', 2);
                player.renown = _num(player.renown) + 2;
                return Pirates._victory(player, world, { ...state, dueled: true, log: [...(state.log || []), `🤺 You beat ${e.name} on their own quarterdeck. Their crew yield. +2 renown.`] }, ship);
            }
            const hurt = _roll([8, 18]);
            player.health = Math.max(1, _num(player.health, 100) - hurt);
            if (cap) Pirates._remember(cap, world, 'bested you blade to blade');
            return Pirates._defeat(player, world, state, ship, `${e.name} disarmed you (−${hurt} health).`);
        }
        if (choice === 'withdraw') {
            const dmg = Ships.mitigateHullDamage(ship, _roll(cfg.withdraw.hull));
            ship.condition = Math.max(5, ship.condition - dmg);
            if (cap) { cap.escaped++; Pirates._remember(cap, world, 'saw you withdraw'); cap.regard = Math.max(-100, cap.regard - 2); }
            if (e.type === 'hunters') Pirates.state(player).lastHunterDay = _day(world) - 2;
            return end('🏳️ Withdrawn', `You broke off from ${e.name} under fire (−${dmg}% hull).`, 'warning');
        }
        return { invalid: true };
    },

    /** Won the fight: the old rewards, and the aftermath choices. */
    _victory(player, world, state, ship) {
        const cfg = Pirates.config();
        const e = state.enemy;
        const crew = Ships._crewAfterBattle(ship, true);
        const note = crew.text ? `⚓${crew.text}` : null;
        const log = note ? [...(state.log || []), note] : [...(state.log || [])];
        Quests.track(player, 'battles_won');
        if (e.type === 'merchant') return { state: { ...state, log, phase: 'merchant_aftermath' } };
        if (e.type === 'hunters') {
            const st = Pirates.state(player);
            st.stats.huntersBeaten++;
            Pirates.addInfamy(player, cfg.hunters.beatInfamy);
            if (e.realm) Underworld.addHeat(player, e.realm, 10, world);
            player.renown = _num(player.renown) + 2;
            Traits.recordDeed(player, 'seafaring', 2);
            return { done: true, log, notification: { title: '⚔️ Hunters Beaten', body: `You beat off ${e.name}. +2 renown — and your name grows darker in every port of the crown.`, type: 'warning' } };
        }
        if (e.type === 'haven') return Pirates._havenWon(player, world, { ...state, log }, ship);
        // A pirate crew beaten
        Quests.track(player, 'raiders_defeated');
        Quests.track(player, 'pirates_defeated');
        Traits.recordDeed(player, 'seafaring', 2);
        const loot = Math.round(e.str0 * _roll(cfg.plunderPerStrength));
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const hoard = cap ? Math.round(cap.loot) : 0;
        player.gold = _num(player.gold) + loot + hoard;
        Ledger.record(player, 'plunder', loot + hoard);
        player.karma = _num(player.karma) + cfg.karma.victory;
        player.renown = _num(player.renown) + cfg.renown.victory;
        const dmg = Ships.mitigateHullDamage(ship, _roll([2, 6]));
        ship.condition = Math.max(5, ship.condition - dmg);
        if (cap) {
            cap.beaten++;
            cap.loot = 0;
            cap.status = 'taken';
            Pirates._remember(cap, world, 'was beaten by you');
        }
        log.push(`🏆 Victory! ${loot + hoard} gold from their strongbox${hoard ? ` (with ${hoard} they had taken from you)` : ''}. +${cfg.renown.victory} renown, +${cfg.karma.victory} karma.`);
        return { state: { ...state, log, phase: 'aftermath_crew' } };
    },

    /** Lost the fight: crew, hull, health — and what they take. */
    _defeat(player, world, state, ship, lead) {
        const e = state.enemy;
        const crew = Ships._crewAfterBattle(ship, false);
        const dmg = Ships.mitigateHullDamage(ship, _roll([6, 18]));
        ship.condition = Math.max(5, ship.condition - dmg);
        player.health = Math.max(1, _num(player.health, 100) - Math.floor(dmg / 2));
        const wound = Ailments.maybeWound(player, world, 'sea_battle');
        let body = `${lead} Ship took ${dmg}% damage.${crew.text}`;
        if (wound) body += ` ${wound.icon} You took ${wound.name.toLowerCase()} in the fighting.`;
        if (e.type === 'pirate') {
            const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
            const taken = Math.min(_num(player.gold), Math.floor(_num(player.gold) * Utils.randFloat(0.1, 0.25)));
            if (taken > 0) {
                player.gold -= taken;
                Ledger.record(player, 'robbery', -taken);
                body += ` They took ${taken} gold from your cabin.`;
            }
            if (cap) {
                cap.beatYou++;
                cap.loot += taken;
                cap.strength = Math.min(Pirates.config().maxStrength, cap.strength + 1);
                Pirates._remember(cap, world, 'beat you and took your gold');
            }
            return { done: true, notification: { title: '💀 Defeated at Sea', body, type: 'error' } };
        }
        if (e.type === 'hunters') {
            body += ' They take you in irons.';
            const out = Pirates._captured(player, world, ship, body);
            return { done: true, notification: { title: '⛓️ Taken by the Hunters', body: out, type: 'error' } };
        }
        if (e.type === 'haven') return { done: true, notification: { title: '💀 Repulsed', body: `${body} The haven's battery drove you off.`, type: 'error' } };
        // A merchant beat you off
        player.karma = _num(player.karma) - Math.floor(_num((DataLoader.ships || {}).piracyKarmaLoss, 5) / 2);
        Pirates.addInfamy(player, Pirates.config().infamy.witnesses / 2);
        return { done: true, notification: { title: '💀 Beaten Off', body: `${body} The merchant got away to tell of it.`, type: 'error' } };
    },

    /** Struck your colours to the hunters: a fine and the cargo, or the cells. */
    _surrender(player, world, state, ship) {
        const H = Pirates.config().hunters;
        const fine = Pirates.fineAmount(player);
        const cargo = Object.entries(ship.cargo || {}).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${id}`).join(', ');
        ship.cargo = {};
        if (_num(player.gold) >= fine) {
            player.gold -= fine;
            Ledger.record(player, 'seaFines', -fine);
            Pirates.addInfamy(player, H.surrenderInfamy);
            Pirates.state(player).lastHunterDay = _day(world) + 6;
            return { done: true, notification: { title: '🏳️ Colours Struck', body: `You paid a ${fine} gold fine${cargo ? ` and they seized your cargo (${cargo})` : ''}. Your infamy cools.`, type: 'warning' } };
        }
        const text = Pirates._captured(player, world, ship, `You cannot pay their ${fine} gold fine${cargo ? `; they seize your cargo (${cargo})` : ''}.`);
        return { done: true, notification: { title: '⛓️ In Irons', body: text, type: 'error' } };
    },

    /** Taken by the hunters: sailed to the nearest port and jailed there (player.jailState). */
    _captured(player, world, ship, lead) {
        const H = Pirates.config().hunters;
        const port = world ? (Ships.seaRoutes(world, player.q, player.r)[0] || null) : null;
        const inf = Pirates.getInfamy(player);
        Pirates.addInfamy(player, H.surrenderInfamy);
        if (!port) return `${lead} They let you go with a flogging and a warning.`;
        ship.status = 'docked';
        ship.q = port.q;
        ship.r = port.r;
        ship.dockedAt = port.name;
        ship.voyage = null;
        player.boardedShip = null;
        player.q = port.q;
        player.r = port.r;
        player.path = null;
        const days = Math.max(3, Math.round(3 + inf / 8));
        if (!player.jailState) {
            player.jailState = {
                daysRemaining: days, totalDays: days, offense: 'piracy', offenseNumber: 1,
                settlement: port.name, bailCost: days * 40,
                escapeChance: 0.08 + _skill(player, 'stealth') * 0.03,
            };
            player.stamina = 0;
            player.movementRemaining = 0;
        }
        return `${lead} They sail you to ${port.name} and throw you in its cells for ${days} days. Your ship is impounded at the quay.`;
    },

    _crewFate(player, world, state, ship, choice, go, end) {
        const cfg = Pirates.config();
        const st = Pirates.state(player);
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const free = (regardDelta, strengthShare, memory) => {
            if (!cap) return;
            cap.status = 'at_large';
            cap.regard = _clamp(cap.regard + regardDelta, -100, 100);
            cap.strength = Math.max(4, Math.round(cap.strength * strengthShare));
            Pirates._remember(cap, world, memory);
        };
        if (choice === 'ransom') {
            const gold = Math.round(Pirates._ransomAmount(e) * Utils.randFloat(0.8, 1.2));
            player.gold = _num(player.gold) + gold;
            Ledger.record(player, 'ransoms', gold);
            st.stats.ransoms++;
            Traits.recordDeed(player, 'greed', 1);
            let where = '';
            if (cap) {
                cap.ransomed++;
                free(-5, 0.6, 'was ransomed by you');
                const h = Pirates.haven(player, cap.havenId);
                if (h) { h.known = true; where = ` The money came out of ${h.name} (${h.q}, ${h.r}) — now on your chart.`; }
            }
            return go('aftermath_ship', `💰 ${e.name} ransomed for ${gold} gold.${where}`);
        }
        if (choice === 'hang') {
            const bounty = Math.round(e.str0 * cfg.bountyPerStrength);
            player.gold = _num(player.gold) + bounty;
            Ledger.record(player, 'pirateBounty', bounty);
            player.renown = _num(player.renown) + cfg.renown.hanged + (cap ? cfg.renown.captain - cfg.renown.hanged : 0);
            player.karma = _num(player.karma) + cfg.karma.hang;
            Traits.recordDeeds(player, { honesty: 1 });
            const realm = Underworld._nearestKingdom(world, player.q, player.r);
            if (realm && player.reputation) player.reputation[realm] = _num(player.reputation[realm]) + 3;
            if (cap) {
                cap.status = 'hanged';
                st.stats.captainsHanged++;
                Pirates._log(st, world, `${cap.name} ${cap.epithet} was handed to the crown and hanged.`);
                // Their crews remember who brought the captain to the gallows
                for (const c of Pirates.atLarge(player)) if (c.havenId === cap.havenId) c.regard = Math.max(-100, c.regard - 15);
            }
            st.stats.captainsTaken++;
            return go('aftermath_ship', `⚖️ ${e.name} handed to the crown: ${bounty} gold bounty, +renown${realm && player.reputation ? ', and the realm thanks you' : ''}.`);
        }
        if (choice === 'press') {
            Ships._ensureCrew(ship);
            const need = Ships.getShipEffectiveStats(ship).crewRequired;
            const theirs = Math.max(2, Math.round(e.str0 / 2));
            const n = Math.max(0, Math.min(need - ship.crew, Math.round(theirs * Utils.randFloat(cfg.press.share[0], cfg.press.share[1]))));
            ship.crew += n;
            Ships._setMorale(ship, ship.morale + cfg.press.morale);
            player.karma = _num(player.karma) + cfg.karma.press;
            Traits.recordDeed(player, 'cruelty', 1);
            free(-25, 0.4, 'was set adrift by you, crew pressed');
            return go('aftermath_ship', `⛓️ ${n} of their sailors pressed into your crew (morale ${cfg.press.morale}). ${cap ? `${e.name} is set adrift in a boat, swearing vengeance.` : ''}`.trim());
        }
        if (choice === 'spare') {
            player.karma = _num(player.karma) + cfg.karma.spare;
            Traits.recordDeed(player, 'mercy', 2);
            if (cap) { cap.spared++; free(30, 0.5, 'was spared by you'); }
            return go('aftermath_ship', `🕊️ You let ${e.name} go with their lives. +${cfg.karma.spare} karma.`, { spared: true });
        }
        return { invalid: true };
    },

    _shipFate(player, world, state, ship, choice, end) {
        const cfg = Pirates.config();
        const e = state.enemy;
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const lead = (state.log || []).slice(-1)[0] || '';
        if (choice === 'prize') {
            const why = Pirates._prizeReason(player, ship);
            if (why) return { invalid: true, notification: { title: 'No Prize', body: why, type: 'error' } };
            const prize = Pirates._takePrize(player, world, ship, e);
            if (cap && cap.status === 'at_large') cap.strength = Math.max(4, Math.round(cap.strength * 0.5));
            return end('⚓ A Prize!', `${lead} The ${prize.name} is yours: a prize crew sails her to ${prize.dockedAt}.`, 'success');
        }
        if (choice === 'sell') {
            const sale = Math.round(e.str0 * cfg.prizeSalePerStrength * 0.6);
            player.gold = _num(player.gold) + sale;
            Ledger.record(player, 'plunder', sale);
            if (cap && cap.status === 'at_large') cap.strength = Math.max(4, Math.round(cap.strength * 0.5));
            return end('💰 Prize Sold', `${lead} A broker's agent takes the ${e.shipName || 'ship'} off your hands for ${sale} gold.`, 'success');
        }
        if (choice === 'scuttle') {
            player.renown = _num(player.renown) + cfg.renown.scuttle;
            if (cap && cap.status === 'at_large') cap.strength = Math.max(3, Math.round(cap.strength * 0.4));
            return end('🔥 Scuttled', `${lead} You burn the ${e.shipName || 'ship'} to the waterline. +${cfg.renown.scuttle} renown.`, 'success');
        }
        if (choice === 'leave' && state.spared) {
            if (cap) cap.regard = Math.min(100, cap.regard + 5);
            return end('🕊️ Let Go', `${lead} ${e.name} sails away in the ${e.shipName || 'ship'}, dipping their flag to you.`, 'success');
        }
        return { invalid: true };
    },

    /** A captured ship joins the fleet, docked at the nearest port with a prize crew. */
    _takePrize(player, world, ship, e) {
        const cfg = Pirates.config();
        const port = world ? (Ships.seaRoutes(world, player.q, player.r)[0] || null) : null;
        const typeId = Ships.getShipType(e.shipType) ? e.shipType : 'sloop';
        Ships._ensureCrew(ship);
        ship.crew -= cfg.prizeCrew;
        const prize = {
            id: 'ship_' + (Ships._nextId++),
            typeId,
            name: e.shipName || `Prize of ${e.name}`,
            q: port ? port.q : ship.q, r: port ? port.r : ship.r,
            status: port ? 'docked' : 'anchored',
            condition: _roll([35, 65]),
            customizations: [], cargo: {},
            crew: cfg.prizeCrew, morale: Ships._getCrewSettings().startingMorale,
            dockedAt: port ? port.name : null,
            purchaseDay: _day(world), prize: true,
        };
        if (!player.ships) player.ships = [];
        player.ships.push(prize);
        const st = Pirates.state(player);
        st.stats.prizes++;
        return prize;
    },

    _merchantFate(player, world, state, ship, choice, end) {
        const cfg = Pirates.config();
        const st = Pirates.state(player);
        const e = state.enemy;
        const data = DataLoader.ships || {};
        const karmaLoss = data.piracyKarmaLoss || 5;
        const renownLoss = data.piracyRenownLoss || 2;
        const fx = Ships.getShipEffectiveStats(ship).effects || {};
        if (!['plunder', 'ransom', 'prize', 'sink'].includes(choice)) return { invalid: true };
        if (choice === 'prize') {
            const why = Pirates._prizeReason(player, ship);
            if (why) return { invalid: true, notification: { title: 'No Prize', body: why, type: 'error' } };
        }
        // The strongbox and the hold
        const gold = Math.floor(e.gold * (1 + _num(fx.captureBonus)));
        player.gold = _num(player.gold) + gold;
        Ledger.record(player, 'piracy', gold);
        const taken = {};
        const left = {};
        for (const [id, n] of Object.entries(e.cargo || {})) {
            const room = Math.max(0, Ships.getCargoFree(ship));
            const k = Math.min(room, n);
            if (k > 0) {
                if (!ship.cargo) ship.cargo = {};
                ship.cargo[id] = _num(ship.cargo[id]) + k;
                taken[id] = k;
            }
            if (n - k > 0) left[id] = n - k;
        }
        const takenText = Object.entries(taken).map(([id, n]) => `${n} ${id}`).join(', ');
        const leftText = Object.entries(left).map(([id, n]) => `${n} ${id}`).join(', ');
        Quests.track(player, 'piracy_committed');
        st.stats.merchantsTaken++;
        player.karma = _num(player.karma) - karmaLoss;
        player.renown = Math.max(0, _num(player.renown) - renownLoss);
        Traits.recordDeed(player, 'greed', 1);
        const I = cfg.infamy;
        let infamy = I.piracy + (state.disguised ? I.falseColours : 0);
        let witnesses = true;
        let extra = '';
        if (choice === 'ransom') {
            const r = Math.round(e.gold * Utils.randFloat(0.4, 0.8));
            player.gold += r;
            Ledger.record(player, 'ransoms', r);
            player.karma += cfg.karma.ransomPassengers;
            infamy += I.ransom;
            extra = ` Her passengers' families will pay ${r} gold more.`;
        } else if (choice === 'prize') {
            const prize = Pirates._takePrize(player, world, ship, { ...e, shipName: e.name });
            infamy += I.prize;
            extra = ` She joins your fleet as the ${prize.name}, sailed to ${prize.dockedAt || 'a quiet anchorage'}; her crew row for shore.`;
        } else if (choice === 'sink') {
            witnesses = false;
            infamy = I.sunk;
            player.karma += cfg.karma.sinkMerchant;
            Traits.recordDeeds(player, { cruelty: 3 });
            st.stats.merchantsSunk++;
            extra = ' She goes down with all hands. No one will tell of it — but you will remember.';
        }
        if (witnesses) infamy += I.witnesses;
        Pirates.addInfamy(player, infamy);
        // Witnesses carry your name to every crown; the sunk tell no tales
        if (witnesses) {
            const repLoss = Math.max(1, 3 - _num(fx.stealthBonus) - (state.disguised ? 1 : 0));
            for (const kId of Object.keys(player.reputation || {})) player.reputation[kId] = _num(player.reputation[kId]) - repLoss;
            Underworld.recordPiracy(player, world, player.q, player.r);
        }
        const dmg = Ships.mitigateHullDamage(ship, state.bloodless ? 0 : _roll([1, 3]));
        ship.condition = Math.max(5, ship.condition - dmg);
        return end('🏴‍☠️ Plunder', `${gold} gold from her strongbox${takenText ? `, ${takenText} into your hold` : ''}${leftText ? ` (no room for ${leftText})` : ''}.${extra} -${karmaLoss} karma, -${renownLoss} renown. Infamy ${Math.round(Pirates.getInfamy(player))}.`, 'warning');
    },

    // ──────────── HAVENS ────────────

    /** Has the haven had time to fill its hoard again since it was last raided? */
    havenRaidable(h, world) {
        return !!h && !(h.raidedDay != null && _day(world) - h.raidedDay < _num(Pirates.config().havenRaidCooldownDays, 30));
    },

    /** A known haven next to the player's ship, or null. */
    havenNear(player, world) {
        if (!player || player.boardedShip == null || !player.seaRoving || !Array.isArray(player.seaRoving.havens)) return null;
        return player.seaRoving.havens.find(h => h.known && _dist(world, player.q, player.r, h.q, h.r) <= 1
            && Pirates.havenRaidable(h, world)) || null;
    },

    /** "bears you a grudge" — a captain's regard for the player, in words. */
    grudgeWord(cap) {
        const g = _num(cap && cap.regard);
        if (g <= -30) return 'sworn to drown you';
        if (g <= -10) return 'bears you a grudge';
        if (g >= 30) return 'remembers your mercy';
        if (g >= 10) return 'well disposed';
        return cap && cap.met ? 'no grudge' : 'does not know you';
    },

    /**
     * What the player's chart shows of the rovers (ui/renderer/overlays.js,
     * the hex tooltip): known havens only, with the captains who sail from
     * them, and captains met at sea in the last `sightingDays` days where
     * they were last seen. Reads only; never places havens or draws RNG.
     * [{ kind: 'haven'|'sighting', q, r, name, ... }]
     */
    mapMarkers(player, world) {
        const st = player && player.seaRoving;
        if (!st) return [];
        const day = _day(world);
        const out = [];
        const caps = Array.isArray(st.captains) ? st.captains : [];
        const view = (c) => ({ id: c.id, name: c.name, epithet: c.epithet || '', icon: c.icon || '🏴‍☠️', shipName: c.shipName || '', strength: Math.round(_num(c.strength)), regard: Math.round(_num(c.regard)), grudge: Pirates.grudgeWord(c), met: _num(c.met) });
        for (const h of Array.isArray(st.havens) ? st.havens : []) {
            if (!h || !h.known || !Number.isFinite(h.q) || !Number.isFinite(h.r)) continue;
            const crews = caps.filter(c => c.status === 'at_large' && c.havenId === h.id);
            out.push({
                kind: 'haven', id: h.id, q: h.q, r: h.r, name: h.name,
                raidedDay: h.raidedDay, raidable: Pirates.havenRaidable(h, world),
                strength: Math.round(10 + crews.reduce((a, c) => a + _num(c.strength), 0) * 0.6),
                captains: crews.filter(c => c.met > 0).map(view), unknownCaptains: crews.filter(c => !(c.met > 0)).length,
            });
        }
        const recent = _num(Pirates.config().sightingDays, 20);
        for (const c of caps) {
            if (c.status !== 'at_large' || !(c.met > 0) || !Number.isFinite(c.seenQ) || !Number.isFinite(c.seenR)) continue;
            if (c.lastMetDay == null || day - c.lastMetDay > recent) continue;
            out.push({ kind: 'sighting', q: c.seenQ, r: c.seenR, name: c.name, day: c.lastMetDay, captain: view(c) });
        }
        return out;
    },

    /** Tooltip lines for the hex at (q, r): a known haven or a recent sighting there. */
    hexInfo(player, world, q, r) {
        const lines = [];
        for (const m of Pirates.mapMarkers(player, world)) {
            if (m.q !== q || m.r !== r) continue;
            if (m.kind === 'haven') {
                lines.push(`🏝️ ${m.name}: a pirate haven (strength ~${m.strength})${m.raidable ? '' : `, raided on day ${m.raidedDay}`}`);
                for (const c of m.captains) lines.push(`${c.icon} ${c.name}${c.epithet ? ` ${c.epithet}` : ''} (${c.shipName || 'a sloop'}): strength ${c.strength}, ${c.grudge}`);
                if (m.unknownCaptains) lines.push(`${m.unknownCaptains === 1 ? 'A captain' : `${m.unknownCaptains} captains`} you have not met sail${m.unknownCaptains === 1 ? 's' : ''} from here.`);
                if (m.raidable) lines.push('Bring your ship alongside to raid it.');
            } else {
                const c = m.captain;
                lines.push(`${c.icon} ${c.name} last sighted here on day ${m.day}: strength ${c.strength}, ${c.grudge}`);
            }
        }
        return lines;
    },

    startHavenRaid(player, world) {
        const h = Pirates.havenNear(player, world);
        const ship = Ships.getShipById(player, player.boardedShip);
        if (!h || !ship) return null;
        const caps = Pirates.atLarge(player).filter(c => c.havenId === h.id);
        const str = Math.round(10 + caps.reduce((s, c) => s + c.strength, 0) * 0.6);
        const lead = caps.slice().sort((a, b) => b.strength - a.strength)[0] || null;
        return {
            shipId: ship.id, log: [], kind: 'haven', phase: 'haven', havenId: h.id,
            enemy: { type: 'haven', captainId: lead ? lead.id : null, name: h.name, epithet: '', icon: '🏝️', shipName: '', shipType: 'sloop', temperament: 'cruel', strength: str, str0: str, speed: 0 },
        };
    },

    _havenAct(player, world, state, ship, choice, go, end) {
        if (choice === 'break') return end('↩️ Sailed On', 'You leave the haven be — for now.', 'info');
        if (choice === 'assault') return Pirates._battleAct(player, world, { ...state, phase: 'battle' }, ship, 'board', go, end);
        if (choice === 'night') {
            const ok = Utils.random() < Pirates.shadowChance(player, world, state);
            _train(player, 'stealth', ok ? 0.2 : 0.05);
            if (ok) return Pirates._havenWon(player, world, { ...state, quiet: true, log: [...(state.log || []), '🌙 Your boats slipped in under the battery.'] }, ship);
            return go('battle', '🔔 The alarm bell! It is a fight in the dark.');
        }
        return { invalid: true };
    },

    _havenWon(player, world, state, ship) {
        const cfg = Pirates.config();
        const st = Pirates.state(player);
        const h = Pirates.haven(player, state.havenId);
        const caps = Pirates.atLarge(player).filter(c => c.havenId === state.havenId);
        const loot = Math.round(state.enemy.str0 * _roll(cfg.haven.lootPerStrength) * (state.quiet ? 0.6 : 1));
        player.gold = _num(player.gold) + loot;
        Ledger.record(player, 'plunder', loot);
        player.renown = _num(player.renown) + cfg.haven.renown;
        Traits.recordDeed(player, 'valor', 2);
        if (h) h.raidedDay = _day(world);
        st.stats.havensRaided++;
        for (const c of caps) {
            c.strength = Math.max(3, Math.round(c.strength * 0.5));
            c.loot = 0;
            c.regard = Math.max(-100, c.regard - 30);
            Pirates._remember(c, world, `lost their hoard at ${h ? h.name : 'their haven'} to you`);
        }
        Pirates._log(st, world, `You raided ${h ? h.name : 'a pirate haven'} for ${loot} gold.`);
        const body = `${state.quiet ? 'In and out before dawn' : 'The haven is yours'}: ${loot} gold from the rovers' hoard. +${cfg.haven.renown} renown.${caps.length ? ` ${caps.map(c => c.name).join(' and ')} will not forgive it.` : ''}`;
        return { done: true, log: state.log, notification: { title: '🏝️ Haven Raided', body, type: 'success' } };
    },

    // ──────────── SEA EVENTS (Explore the Waters) ────────────

    _eventState(player, world, ship, base) {
        const events = Pirates.data().seaEvents || [];
        const total = events.reduce((s, ev) => s + _num(ev.weight, 1), 0);
        let roll = Utils.random() * total;
        let ev = events[events.length - 1] || null;
        for (const x of events) {
            roll -= _num(x.weight, 1);
            if (roll <= 0) { ev = x; break; }
        }
        if (!ev) return { ...base, kind: 'event', eventId: null };
        if (ev.pirate) {
            const cap = Pirates._pickCaptain(player, world);
            const enemy = cap ? Pirates._captainEnemy(cap) : Pirates._anonPirates();
            if (cap) Pirates._sighted(cap, player, world);
            return { ...base, kind: 'hunt', phase: 'sighting', enemy, log: [`${ev.icon} ${ev.title}: the lookout calls a black flag.`] };
        }
        return { ...base, kind: 'event', eventId: ev.id, enemy: Array.isArray(ev.enemy) ? _roll(ev.enemy) : null };
    },

    _eventDef(id) {
        return (Pirates.data().seaEvents || []).find(e => e.id === id) || null;
    },

    _checkChance(player, world, state, o) {
        const ship = Pirates._ship(player, state);
        if (o.fight) return Difficulty.againstFoe(player, _odds(Pirates._shipStr(player, ship), _num(state.enemy, 10)));
        const c = o.check;
        if (!c) return null;
        let p = _num(c.base, 0.5);
        if (c.skill) p += _skill(player, c.skill) * _num(c.per);
        if (c.luck) p += (_num(player.luck, 5) - 5) * c.luck;
        if (c.speed) p += (Pirates._speed(player, ship) - 4) * c.speed;
        if (c.item && _num(player.inventory && player.inventory[c.item]) > 0) p += _num(c.itemBonus);
        return _clamp(p, 0.05, 0.95);
    },

    _eventView(player, world, state) {
        const ev = Pirates._eventDef(state.eventId);
        if (!ev) return { icon: '🌊', title: 'Calm Seas', text: 'You sail the open waters but find nothing of note.', options: [{ id: 'leave', icon: '🌊', label: 'Sail on', hint: '', chance: null, odds: false }] };
        const ship = Pirates._ship(player, state);
        const stats = ship ? [`hull ${Math.round(ship.condition)}%`, `crew ${Ships.getCrew(ship)}`] : [];
        if (state.enemy) stats.unshift(`its strength ~${state.enemy}`, `your ship ${Math.round(Pirates._shipStr(player, ship))}`);
        return {
            icon: ev.icon, title: ev.title, text: ev.text, stats, log: state.log,
            options: (ev.options || []).map(o => ({
                id: o.id, icon: o.icon, label: o.label, hint: o.hint || '',
                chance: Pirates._checkChance(player, world, state, o),
                odds: o.check || o.fight ? undefined : false, can: true, reason: '', cost: '',
            })),
        };
    },

    _eventAct(player, world, state, choice) {
        const ev = Pirates._eventDef(state.eventId);
        if (!ev) return { done: true, notification: { title: '🌊 Calm Seas', body: 'You sail on.', type: 'info' } };
        const o = (ev.options || []).find(x => x.id === choice);
        if (!o) return { invalid: true };
        const ship = Pirates._ship(player, state);
        const chance = Pirates._checkChance(player, world, state, o);
        const ok = chance === null ? true : Utils.random() < chance;
        if (o.check && o.check.item && _num(player.inventory && player.inventory[o.check.item]) > 0) {
            player.inventory[o.check.item] -= 1;
            if (player.inventory[o.check.item] <= 0) delete player.inventory[o.check.item];
        }
        if (o.fight) Ships._crewAfterBattle(ship, ok);
        const outcome = (ok ? o.success : o.failure) || o.success || {};
        const bits = Pirates._applyOutcome(player, world, ship, outcome);
        const body = [outcome.text, ...bits].filter(Boolean).join(' ');
        const good = ok && !(outcome.hull > 0);
        return { done: true, notification: { title: `${ev.icon} ${ev.title}`, body: body || 'You sail on.', type: chance === null ? 'info' : (good ? 'success' : 'warning') } };
    },

    /** Apply a data-driven sea outcome. Returns short texts of what changed. */
    _applyOutcome(player, world, ship, o) {
        const out = [];
        if (o.gold) {
            let g = _roll(o.gold);
            if (g > 0) {
                g = Math.floor(g * Ships.getExplorationMultiplier(player, ship));
                player.gold = _num(player.gold) + g;
                Ledger.record(player, 'exploration', g);
                out.push(`+${g} gold.`);
            } else if (g < 0) {
                const lost = Math.min(_num(player.gold), -g);
                player.gold = _num(player.gold) - lost;
                if (lost) { Ledger.record(player, 'robbery', -lost); out.push(`−${lost} gold.`); }
            }
        }
        if (o.cargo && ship) {
            const got = [];
            for (const [id, range] of Object.entries(o.cargo)) {
                const n = Math.min(Math.max(0, Ships.getCargoFree(ship)), _roll(range));
                if (n > 0) {
                    if (!ship.cargo) ship.cargo = {};
                    ship.cargo[id] = _num(ship.cargo[id]) + n;
                    got.push(`${n} ${id}`);
                }
            }
            if (got.length) out.push(`Into the hold: ${got.join(', ')}.`);
        }
        if (o.crew && ship) {
            Ships._ensureCrew(ship);
            const need = Ships.getShipEffectiveStats(ship).crewRequired;
            const d = _roll(o.crew);
            const before = ship.crew;
            ship.crew = _clamp(ship.crew + d, 0, Math.max(need, ship.crew));
            const diff = ship.crew - before;
            if (diff > 0) out.push(`${diff} sailor${diff === 1 ? '' : 's'} sign on.`);
            if (diff < 0) out.push(`${-diff} sailor${diff === -1 ? '' : 's'} lost.`);
        }
        if (o.morale && ship) {
            Ships._ensureCrew(ship);
            Ships._setMorale(ship, ship.morale + o.morale);
        }
        if (o.hull && ship) {
            const d = _roll(o.hull);
            if (d > 0) {
                const dmg = Ships.mitigateHullDamage(ship, d);
                ship.condition = Math.max(5, ship.condition - dmg);
                out.push(`Hull −${dmg}%.`);
            } else if (d < 0) {
                ship.condition = Math.min(100, ship.condition - d);
                out.push(`Hull +${-d}%.`);
            }
        }
        if (o.health) {
            const d = _roll(o.health);
            player.health = Math.max(1, _num(player.health, 100) - d);
            if (d > 0) out.push(`−${d} health.`);
        }
        if (o.ailment) {
            const a = Ailments.inflict(player, world, o.ailment, { source: 'sea' });
            if (a) out.push(`${a.icon} ${a.name}.`);
        }
        if (o.karma) player.karma = _num(player.karma) + o.karma;
        if (o.renown) {
            player.renown = _num(player.renown) + o.renown;
            out.push(`+${o.renown} renown.`);
        }
        if (o.deed) Traits.recordDeeds(player, o.deed);
        if (o.track) Quests.track(player, o.track);
        if (o.stamina) player.movementRemaining = _num(player.movementRemaining) + o.stamina;
        if (o.rumour && world) {
            const lead = Discovery.leadNear(player, world, player.q, player.r, { radius: 30, source: 'The tale' });
            out.push(lead ? `${lead.text}.` : 'Nothing on your charts answers to it.');
        }
        if (o.map === 'treasure' && world) {
            const map = Cartography.generateTreasureMap(world);
            if (map) {
                if (!player.maps) player.maps = [];
                player.maps.push(map);
                out.push('📜 A treasure map joins your collection (Cartography → your maps).');
            }
        }
        return out;
    },

    // ──────────── THE SEA LOG ────────────

    _logView(player, world) {
        const st = Pirates.ensure(player, world);
        const lines = [];
        const inf = Pirates.getInfamy(player);
        lines.push(`Your infamy: ${Math.round(inf)} (${Pirates.infamyLevel(inf)})${inf >= Pirates.config().infamy.huntersAt ? ' — hunters are looking for you.' : '.'}`);
        for (const c of st.captains) {
            if (!c.met && c.status === 'at_large') continue;
            const h = Pirates.haven(player, c.havenId);
            const fate = c.status === 'at_large' ? `at large, strength ${Math.round(c.strength)}` : c.status === 'hanged' ? 'hanged' : 'in chains';
            lines.push(`${c.icon} ${c.name} ${c.epithet} — ${fate}${h && h.known ? `, haven ${h.name} (${h.q}, ${h.r})` : ''}. ${Pirates.memoryLine(c)}`);
        }
        for (const h of st.havens || []) if (h.known) lines.push(`🏝️ ${h.name} at (${h.q}, ${h.r})${h.raidedDay != null ? `, raided on day ${h.raidedDay}` : ''}.`);
        const s = st.stats;
        lines.push(`Captains taken ${s.captainsTaken + s.ransoms}, hanged ${s.captainsHanged}, prizes ${s.prizes}, merchants taken ${s.merchantsTaken}, havens raided ${s.havensRaided}.`);
        return {
            icon: '🏴‍☠️', title: 'The Sea Rovers', text: 'What you know of the captains who sail under the black flag, and what they know of you.',
            lines, log: st.log.slice(-6).map(l => `Day ${l.day}: ${l.text}`),
            options: [{ id: 'close', icon: '✔️', label: 'Close', hint: '', chance: null, odds: false }],
        };
    },

    // ──────────── HEADLESS ────────────

    /** The default of an encounter walked away from (or a headless threat): fight it out. */
    autoResolve(player, world, state) {
        if (!state) return null;
        let s = state;
        for (let i = 0; i < 6 && s; i++) {
            const choice = Pirates._autoChoice(s);
            if (!choice) return null;
            const out = Pirates.act(player, world, s, choice);
            if (!out || out.invalid) return null;
            if (out.state) { s = out.state; continue; }
            return out;
        }
        return null;
    },

    _autoChoice(state) {
        switch (state.phase) {
            case 'hunters': case 'vengeance': return 'fight';
            case 'battle': return 'board';
            case 'aftermath_crew': return 'hang';
            case 'aftermath_ship': return 'sell';
            case 'merchant_aftermath': return 'plunder';
            default: return null; // a sighting or an event walked away from: nothing happens
        }
    },
};
