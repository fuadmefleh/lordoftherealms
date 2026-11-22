// ============================================
// THE LAST CRISIS — the age's climax, aimed at a House grown too great
// ============================================
// Once the player's House dominates the world, the age turns against it.
//
//   THE RECKONING  weekly the House's dominance is measured (measure()): the
//             share of the world's towns its crowns hold, the share of the
//             world's armies they field (the realms' kingdom.military, plus
//             the player's own host), the coalitions' power score
//             (player.coalitions.power, systems/coalitions.js) and an
//             imperial title (HighCrowns.isEmperor, systems/highCrowns.js,
//             handed in with useHighCrowns) — and the House must tower over
//             the next greatest realm (dominance.lead × its towns), so one of
//             a small world's three or four realms is not "dominant" by
//             default. An emperor's bars are eased (emperorEase). Dominant, the reckoning gathers
//             a week at a time; slipping back, it drains twice as fast. Held
//             for holdYears (6–10, by hash) and with no world crisis running
//             (systems/crises.js), the last crisis breaks. The Age panel shows
//             the meter all along.
//   OMENS     a year or two of signs (three, sparse), fitting the kind.
//   THE KIND  chosen to fit the world (weights by hash):
//             HORDE     a great invasion put ashore near the House's realm: a
//                       Crises 'invasion' aimed at it (Crises.start with
//                       opts.aim: landing, people, host scaled to the realm's
//                       army and the player's), with its real hosts, sieges,
//                       sacks and Grand Alliance. Judged when it closes.
//             CRUSADE   the realms of other faiths (Religion.sameFaith) swear a
//                       holy war: their quarrels ended (KingdomAI.endWar), each
//                       pours treasury into levies (coin paid to its capital's
//                       town: real wages) and declares war (KingdomAI.startWar);
//                       the realm's faith loses unity.
//             BREAKAWAY a pretender of the old line (the dead realm most of the
//                       far towns once belonged to: settlement.formerKingdom)
//                       raises the far provinces as a real kingdom, taking their
//                       towns, land, a share of the levies and the chests
//                       (moved, not made); hostile neighbours back him.
//             Crusade and breakaway have a resolve that wears down weekly (faster
//             when the realm's armies outweigh the foe's), and the player can
//             fund the royal host, buy a backer out, or take the field.
//   OUTCOMES  survived (the realm alive, its capital held, holding `hold` of
//             its towns and the foe broken) → a GOLDEN AGE named for the
//             House for `golden.years` (50): kingdom.ageMods on the realm
//             (stability, taxes, growth, culture, loyalty — read through
//             KingdomBonuses.get by the kingdom AI), Prestige and renown, the
//             realms' threat toward the House eased (Coalitions.assess reads
//             threatMult), house.ages + house.ageScore (Legacy.score, the Hall
//             of Houses), a House chronicle entry and an Annals chapter.
//             failed → a DARK AGE: the realm breaks into successor states (real
//             kingdoms with lords and royal families; land, levies, chests
//             and royal bank shared out by towns), the House keeps the
//             capital and the towns nearest it, loses Prestige and renown, and
//             its rump suffers negative ageMods for `dark.years` (30).
//             At most once per long age (ageYears, 150).
//
// No shared RNG: rolls are hashes of the world seed; calls into code that
// draws Utils.random run on a dedicated stream (Utils.withRng). State on
// world.lastCrisis (saved: systems/saveLoad.js). Runs with player=null (the
// interregnum: the reckoning does not gather, a running crisis plays on, the
// House's rewards wait for the next head of it). Content: data/lastCrisis.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Seasons } from '../world/seasons.js';
import { Religion } from './religion.js';
import { Crises } from './crises.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Taxation } from './marketDynamics.js';
import { HighCrowns } from './highCrowns.js';

const YEAR = Seasons.DAYS_PER_YEAR || 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (p) => (p ? `${p.q},${p.r}` : '');
const _day = (world) => _num(world && world.day);
const _r3 = (v) => Math.round(v * 1000) / 1000;
const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const _listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|lastcrisis|${key}`) % 100000) / 100000;
}

/** A dedicated stream (mulberry32) for calls into code that draws Utils.random. */
function _rng(world, key) {
    let a = _hash(`${_seed(world)}|lastcrisisrng|${key}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _range = (world, key, [lo, hi]) => lo + _roll(world, key) * (hi - lo);
const _irange = (world, key, pair) => Math.round(_range(world, key, pair));
const _pick = (world, key, list) => { const a = _arr(list); return a.length ? a[Math.floor(_roll(world, key) * a.length) % a.length] : null; };
const _fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _dist = (world, a, b) => Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, world.width || 80);
const _kingdom = (world, id) => (id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null);
const _alive = (k) => !!(k && k.isAlive !== false);
const _views = (world) => (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : (world.getAllSettlements ? world.getAllSettlements() : []));
const _townsOf = (world, k) => (_alive(k) ? KingdomAI._settlementsOf(k, world) : []);

let _cfg = null;
let _cfgSrc;
let _prose = null;
// Personal unions and empires (systems/highCrowns.js); read defensively, replaceable with useHighCrowns
let _hc = HighCrowns || null;

const DEFAULTS = {
    enabled: true, cadence: 7, offset: 5, minYears: 15, ageYears: 150, holdYears: [6, 10], slipRate: 2,
    dominance: { share: 0.4, townShare: 0.33, power: 320, minRealms: 3, lead: 1.75, emperorEase: 0.85 },
    omensDays: [120, 240], omens: 3, hold: 0.67, breakShare: 0.5,
    weights: { horde: 1, crusade: 1, breakaway: 1 },
    horde: { hostMult: [1.0, 1.4], minHost: 400, waves: 3, land: [6, 16] },
    crusade: { years: [4, 7], minMembers: 2, maxMembers: 4, raiseMult: [1.1, 1.6], goldPerSoldier: 4, treasuryShare: 0.6, resolve: 100, weekly: -1, battleWon: -12, battleLost: 6, memberOut: -20, unityHit: 15 },
    breakaway: { years: [4, 7], share: [0.3, 0.45], minTowns: 5, backers: 2, levyShare: 0.9, resolve: 100, weekly: -1, battleWon: -12, battleLost: 6, memberOut: -20, pretenders: ['Aldred'] },
    choices: { fundCost: [200, 500, 1000], goldPerSoldier: 4, buyOffTreasury: 0.5, buyOffPerSoldier: 2, buyOffMin: 300, battleShare: 0.15, battleRadius: 8 },
    golden: { years: 50, prestige: 300, renown: 60, legacy: 600, threat: 0.75, mods: { stability: 0.1, tax: 0.08 }, names: ['the Golden Age of {house}'] },
    dark: { years: 30, prestigeLoss: 0.35, renownLoss: 0.3, legacy: -150, threat: 0.85, keep: 0.3, maxStates: 3, relations: -40, mods: { stability: -0.1, tax: -0.08 }, names: ['the Dark Age'], states: ['the Kingdom of {town}'] },
    text: {},
};

const KIND_INFO = {
    horde: { icon: '⚔️', label: 'The Great Invasion' },
    crusade: { icon: '⛪', label: 'The Holy War' },
    breakaway: { icon: '👑', label: 'The Pretender' },
};

export const LastCrisis = {
    KINDS: Object.keys(KIND_INFO),
    KIND_INFO,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.lastCrisis;
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        _cfg = _merge(DEFAULTS, _obj(src) || {});
        return _cfg;
    },

    /** Hand in the LLM prose writer (systems/llmProse.js: { write, text }). */
    useProse(impl) {
        _prose = impl && typeof impl.write === 'function' && typeof impl.text === 'function' ? impl : null;
    },

    /** Hand in systems/highCrowns.js ({ isEmperor(player), crownsOf(player, world) }) when it exists. */
    useHighCrowns(impl) {
        _hc = impl && typeof impl === 'object' ? impl : null;
    },

    // ── State ─────────────────────────────────────────

    state(world) {
        if (!world) return null;
        let st = _obj(world.lastCrisis);
        if (!st || st.v !== 1) {
            st = world.lastCrisis = { v: 1, seq: 0, phase: 'watch', held: 0, need: null, last: null, trial: null, age: null, log: [], history: [], acts: [], nextAllowed: 0 };
        }
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.lastCrisis);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.lastCrisis = _obj(saved) && saved.v === 1 ? saved : null;
        const st = LastCrisis.state(world);
        // The realms it raised keep their look (the save keeps only the plain fields)
        for (const look of _arr(st.looks)) {
            const k = _kingdom(world, look.id);
            if (!k) continue;
            if (!k.colorLight) k.colorLight = look.colorLight;
            if (!Array.isArray(k.preferredTerrain)) k.preferredTerrain = look.preferredTerrain;
            if (k.foundedDay == null) k.foundedDay = look.foundedDay;
        }
        // ageMods are not saved with the kingdoms: lay them on again
        LastCrisis._applyMods(world, st, null);
    },

    // ── Dominance ─────────────────────────────────────

    /** The crowns the House holds: every crown (HighCrowns) or the one it rules. */
    _crowns(world, player) {
        if (!player) return [];
        if (_hc && typeof _hc.crownsOf === 'function') {
            try {
                // (entries are { kingdomId, kingdom, … }; a bare id or kingdom is taken too)
                const list = _arr(_hc.crownsOf(player, world)).map(x => (typeof x === 'string' ? _kingdom(world, x)
                    : x && x.kingdomId != null ? _kingdom(world, x.kingdomId) || x.kingdom || null
                        : x && x.id != null ? _kingdom(world, x.id) || x : null)).filter(_alive);
                if (list.length) return list;
            } catch (e) { /* fall back to the one crown */ }
        }
        const realm = KingdomAI.playerRealm(world);
        return realm ? [realm] : [];
    },

    _emperor(player) {
        if (!player || !_hc || typeof _hc.isEmperor !== 'function') return false;
        try { return !!_hc.isEmperor(player); } catch (e) { return false; }
    },

    /** The player's own host (land units), as the coalitions reckon it. */
    _army(player) {
        let s = 0;
        for (const u of _arr(player && player.army)) {
            if (!u || u.naval || u.isShip) continue;
            s += _num(u.strength) * (1 + (_num(u.level, 1) - 1) * 0.2);
        }
        return s;
    },

    /**
     * How far the House dominates the world: { realm, crowns, myTowns, allTowns,
     * townShare, mightShare, share, power, emperor, dominant, progress (0–1 toward dominance) }.
     */
    measure(world, player) {
        const D = LastCrisis.config().dominance;
        const out = { realm: null, crowns: [], myTowns: 0, allTowns: 0, townShare: 0, mightShare: 0, share: 0, power: 0, emperor: false, rival: null, rivalTowns: 0, lead: 0, dominant: false, progress: 0 };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        const crowns = LastCrisis._crowns(world, player);
        out.crowns = crowns;
        out.realm = KingdomAI.playerRealm(world) || crowns[0] || null;
        const views = _views(world);
        out.allTowns = views.length;
        const ids = new Set(crowns.map(k => k.id));
        let mine = 0;
        for (const k of crowns) mine += _townsOf(world, k).length;
        // Towns the player holds in their own name, outside their crowns
        for (const ref of Taxation.getPlayerSettlements(player, world)) {
            const t = world.getTile(ref.q, ref.r);
            if (t && t.settlement && !ids.has(t.settlement.kingdom)) mine++;
        }
        out.myTowns = mine;
        out.townShare = out.allTowns ? _r3(mine / out.allTowns) : 0;
        const army = LastCrisis._army(player);
        let myMight = army, allMight = army;
        for (const k of world.kingdoms) {
            if (!_alive(k)) continue;
            allMight += Math.max(0, _num(k.military));
            if (ids.has(k.id)) myMight += Math.max(0, _num(k.military));
        }
        out.mightShare = allMight > 0 ? _r3(myMight / allMight) : 0;
        out.share = _r3(0.5 * out.townShare + 0.5 * out.mightShare);
        out.power = _num(player.coalitions && player.coalitions.power && player.coalitions.power.score);
        out.emperor = LastCrisis._emperor(player);
        const live = world.kingdoms.filter(_alive).length;
        // The next greatest realm outside the House's crowns: dominance is towering over it, not
        // merely being one of three or four (a small world's realms each hold a quarter of it)
        let rival = null, rivalTowns = 0;
        for (const k of world.kingdoms) {
            if (!_alive(k) || ids.has(k.id)) continue;
            const n = _townsOf(world, k).length;
            if (n > rivalTowns) { rival = k; rivalTowns = n; }
        }
        out.rival = rival;
        out.rivalTowns = rivalTowns;
        out.lead = rivalTowns > 0 ? _r3(mine / rivalTowns) : (mine > 0 ? 99 : 0);
        // An emperor's title eases every bar (× emperorEase): the world measures a high crown more harshly
        const ease = out.emperor ? _clamp(_num(D.emperorEase, 1), 0.3, 1) : 1;
        const reach = Math.max(out.share / (_num(D.share, 0.4) * ease), out.townShare / (_num(D.townShare, 0.33) * ease), out.power / (_num(D.power, 320) * ease));
        const lead = _num(D.lead, 0) > 0 ? out.lead / (_num(D.lead) * ease) : reach;
        out.progress = _r3(Math.min(reach, lead));
        out.dominant = !!crowns.length && live >= _num(D.minRealms, 3) && out.progress >= 1;
        out.progress = Math.min(1, out.progress);
        return out;
    },

    /**
     * How close is the reckoning: { stage, dominance (0–1), held, need, pct (0–1),
     * label, kind, measure }. stage: watch | omens | trial | age | spent.
     */
    meter(world, player) {
        const st = LastCrisis.state(world);
        const m = LastCrisis.measure(world, player);
        const need = _num(st.need, LastCrisis._need(world, st));
        const out = { stage: st.phase, dominance: m.progress, held: st.held, need, pct: 0, kind: st.trial ? st.trial.kind : null, measure: m, label: '' };
        if (st.phase === 'watch') {
            const spent = _num(st.nextAllowed) > _day(world);
            // Half the meter is dominance itself, half is how long it has been held
            const heldPart = 0.5 * Math.min(1, st.held / Math.max(1, need));
            out.pct = _r3(m.dominant ? 0.5 + heldPart : Math.max(0.5 * m.progress, heldPart));
            if (spent) { out.stage = 'spent'; out.label = 'The age has had its reckoning.'; } else if (!m.crowns.length) out.label = 'The reckoning comes to crowns: you rule none.';
            else if (m.dominant) out.label = st.held >= need ? 'The reckoning is upon you: it waits only for the world to be still.' : `The world bears your greatness ill: about ${Math.max(1, Math.ceil((need - st.held) / YEAR))} more years.`;
            else out.label = st.held > 0 ? 'Your greatness has slipped; the reckoning ebbs.' : 'You do not yet dominate the world.';
        } else {
            out.pct = 1;
            out.label = st.phase === 'omens' ? 'The omens gather.' : st.phase === 'trial' ? 'The last crisis is upon you.' : `${_cap(st.age && st.age.name)}.`;
        }
        return out;
    },

    _need(world, st) {
        return Math.round(_range(world, `hold:${st.seq}`, LastCrisis.config().holdYears) * YEAR);
    },

    // ── The tick ──────────────────────────────────────

    /** One day (weekly work). Call after Crises.processDay. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = LastCrisis.config();
        if (!world || !C.enabled || !Array.isArray(world.kingdoms)) return out;
        const st = LastCrisis.state(world);
        const day = _day(world);
        const before = st.log.length;
        // A House's reward or ruin waits for its next head (the interregnum)
        if (player) LastCrisis._settleHouse(world, st, player);
        if (day % Math.max(1, _num(C.cadence, 7)) === _num(C.offset, 5) % Math.max(1, _num(C.cadence, 7))) {
            if (st.need == null) st.need = LastCrisis._need(world, st);
            if (st.phase === 'watch') LastCrisis._watch(world, st, player, day);
            else if (st.phase === 'omens') LastCrisis._omens(world, st, player, day);
            else if (st.phase === 'trial') LastCrisis._trial(world, st, player, day);
            if (st.phase === 'age') LastCrisis._age(world, st, player, day);
            // While the last crisis runs, no world crisis begins beside it
            if ((st.phase === 'omens' || (st.phase === 'trial' && st.trial && st.trial.kind !== 'horde'))) {
                const cs = Crises.state(world);
                if (cs && !cs.active) cs.nextDay = Math.max(_num(cs.nextDay), day + YEAR);
            }
        }
        if (player) {
            for (const e of st.log.slice(before)) {
                if (!e.big) continue;
                out.notices.push({ icon: e.icon || '📜', title: e.title || 'The Last Crisis', text: LastCrisis.line(world, e), type: e.tone || 'warning' });
            }
        }
        return out;
    },

    _watch(world, st, player, day) {
        const C = LastCrisis.config();
        if (!player) return; // the reckoning gathers against a living House
        const m = LastCrisis.measure(world, player);
        if (m.dominant) st.held = Math.min(st.need, st.held + _num(C.cadence, 7));
        else st.held = Math.max(0, st.held - _num(C.cadence, 7) * _num(C.slipRate, 2));
        if (!m.dominant || st.held < st.need) return;
        if (day < _num(C.minYears) * YEAR || day < _num(st.nextAllowed)) return;
        if (Crises.active(world)) return; // it waits for the world to be still
        LastCrisis._beginOmens(world, st, player, m, day);
    },

    _houseName(player) {
        const h = player && player.house;
        const n = (h && h.name) || (player && player.lastName ? `House ${player.lastName}` : 'the House');
        return n;
    },

    _vars(world, st) {
        const realm = _kingdom(world, st.realmId);
        const house = st.house || 'the House';
        return {
            house, houseShort: String(house).replace(/^House\s+/i, ''), realm: realm ? Names.realm(realm.name) : (st.realmName || 'the realm'),
            people: st.trial && st.trial.people ? st.trial.people.name : 'strangers', faith: st.trial && st.trial.faith ? st.trial.faith : 'old gods',
            old: st.trial && st.trial.old ? st.trial.old : 'the old kings', pretender: st.trial && st.trial.pretender ? st.trial.pretender : 'a pretender',
        };
    },

    /**
     * Bring the last crisis on now, past the meter (tests, a scenario, a debug
     * console): its omens begin. opts.kind forces the kind. → true when it began.
     */
    start(world, player, opts = {}) {
        const st = LastCrisis.state(world);
        if (!st || st.phase !== 'watch' || !player) return false;
        if (opts.kind && !KIND_INFO[opts.kind]) return false; // horde | crusade | breakaway
        const m = LastCrisis.measure(world, player);
        if (!m.realm) return false;
        if (st.need == null) st.need = LastCrisis._need(world, st);
        LastCrisis._beginOmens(world, st, player, m, _day(world), opts.kind || null);
        return st.phase === 'omens';
    },

    _beginOmens(world, st, player, m, day, forced = null) {
        const C = LastCrisis.config();
        const realm = m.realm;
        st.seq++;
        st.house = LastCrisis._houseName(player);
        st.realmId = realm.id;
        st.realmName = realm.name;
        const kind = forced || LastCrisis._choose(world, realm, st);
        if (!kind) { st.held = Math.round(st.need * 0.75); st.seq--; return; }
        st.trial = { kind, ...LastCrisis._prepare(world, realm, kind, st) };
        st.phase = 'omens';
        st.omenStart = day;
        st.omenEnd = day + _irange(world, `omens:${st.seq}`, C.omensDays);
        st.omensTold = 0;
        st.startDay = day;
        LastCrisis._omen(world, st);
        Interrupts.raise(world, { reason: 'Omens of the last crisis', icon: KIND_INFO[kind].icon, source: 'lastCrisis' });
    },

    /** One of the omens (spread over the omen years). */
    _omen(world, st) {
        const T = (LastCrisis.config().text.omens || {})[st.trial.kind];
        st.omensTold = _num(st.omensTold) + 1;
        LastCrisis._log(world, st, 'omens', T, LastCrisis._vars(world, st), { big: st.omensTold === 1, icon: '🌠', title: 'An omen' });
    },

    _omens(world, st, player, day) {
        const C = LastCrisis.config();
        const n = Math.max(1, _num(C.omens, 3));
        const span = Math.max(1, st.omenEnd - st.omenStart);
        if (st.omensTold < n && day >= st.omenStart + span * st.omensTold / n) LastCrisis._omen(world, st);
        if (day < st.omenEnd) return;
        // A world crisis struck in the meantime: the reckoning waits for it
        if (Crises.active(world)) return;
        LastCrisis._beginTrial(world, st, player, day);
    },

    // ── The kinds ────────────────────────────────────

    /** Which kind of reckoning fits this world and this realm. */
    _choose(world, realm, st) {
        const C = LastCrisis.config();
        const w = {};
        if (LastCrisis._landing(world, realm)) w.horde = _num(C.weights.horde, 1);
        const infidels = LastCrisis._infidels(world, realm);
        if (infidels.length >= _num(C.crusade.minMembers, 2)) w.crusade = _num(C.weights.crusade, 1) * (1 + infidels.length / 4);
        const towns = _townsOf(world, realm);
        if (towns.length >= _num(C.breakaway.minTowns, 5)) {
            const conquered = towns.filter(t => t.settlement.formerKingdom && t.settlement.formerKingdom !== realm.id).length;
            w.breakaway = _num(C.weights.breakaway, 1) * (1 + towns.length / 12 + conquered / Math.max(1, towns.length));
        }
        const kinds = Object.keys(w).filter(k => w[k] > 0);
        if (!kinds.length) return null;
        const total = kinds.reduce((s, k) => s + w[k], 0);
        let roll = _roll(world, `kind:${st.seq}`) * total;
        for (const k of kinds) { roll -= w[k]; if (roll <= 0) return k; }
        return kinds[kinds.length - 1];
    },

    /** The living realms of another faith (or rite) than the realm's, mightiest first. */
    _infidels(world, realm) {
        if (!realm || !realm.religion) return [];
        return world.kingdoms.filter(k => _alive(k) && k.id !== realm.id && k.religion && !Religion.sameFaith(k, realm) && !_arr(k.allies).includes(realm.id))
            .sort((a, b) => _num(b.military) - _num(a.military) || (a.id < b.id ? -1 : 1));
    },

    /** Where a horde comes ashore against the realm: a coast or the world's rim near its towns. */
    _landing(world, realm) {
        const H = LastCrisis.config().horde;
        const towns = _townsOf(world, realm);
        if (!towns.length) return null;
        const Hh = world.height || 60;
        const W = world.width || 80;
        const cands = [];
        for (let r = 0; r < Hh; r++) {
            for (let q = 0; q < W; q++) {
                const t = world.getTile(q, r);
                if (!t || !t.terrain || !t.terrain.passable || t.settlement) continue;
                const rim = r <= 1 || r >= Hh - 2;
                if (!rim && !Hex.neighbors(q, r).some(n => { const nt = world.getTile(Hex.wrapQ(n.q, W), n.r); return nt && nt.terrain && !nt.terrain.passable; })) continue;
                let best = Infinity;
                for (const s of towns) {
                    const stile = world.getTile(s.q, s.r);
                    if (stile && t.regionId != null && stile.regionId != null && stile.regionId !== t.regionId) continue;
                    const d = _dist(world, { q, r }, s);
                    if (d < best) best = d;
                }
                if (best < H.land[0] || best > H.land[1]) continue;
                cands.push({ q, r, edge: rim ? (r < Hh / 2 ? 'the northern edge of the world' : 'the southern edge of the world') : 'the coast', score: (t.kingdom === realm.id ? -3 : 0) - Math.abs(best - 9) });
            }
        }
        if (!cands.length) return null;
        cands.sort((a, b) => b.score - a.score || a.r - b.r || a.q - b.q);
        const top = cands.slice(0, 12);
        return top[Math.floor(_roll(world, `land:${realm.id}`) * top.length) % top.length];
    },

    /** The particulars a kind needs from its first omen (the people, the faith, the old line). */
    _prepare(world, realm, kind, st) {
        const C = LastCrisis.config();
        if (kind === 'horde') {
            const peoples = _arr(Crises.config().invasion.peoples);
            return { people: _pick(world, `people:${st.seq}`, peoples) || { name: 'the Varangar', realm: 'the Varangar Dominion', host: 'Varangar Warband', culture: 'Nordic', from: 'the frozen sea' } };
        }
        if (kind === 'crusade') {
            const inf = LastCrisis._infidels(world, realm);
            const lead = inf[0];
            return { faith: lead && lead.religion ? lead.religion.name || lead.religion.faithId : 'the other faiths' };
        }
        // The old line: the fallen realm most of the far towns once flew the banner of
        const towns = _townsOf(world, realm);
        const counts = {};
        for (const t of towns) {
            const f = t.settlement.formerKingdom;
            if (f && f !== realm.id) counts[f] = (counts[f] || 0) + 1;
        }
        const oldId = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1))[0];
        const old = _kingdom(world, oldId);
        const first = _pick(world, `pretender:${st.seq}`, C.breakaway.pretenders) || 'Aldred';
        return { oldId: old ? old.id : null, old: old ? Names.realm(old.name) : `the old kings of ${Names.realm(realm.name)}`, pretender: first };
    },

    _beginTrial(world, st, player, day) {
        const realm = _kingdom(world, st.realmId);
        if (!_alive(realm)) { LastCrisis._abandon(world, st, day); return; }
        let ok = false;
        const kind = st.trial.kind;
        st.towns0 = _townsOf(world, realm).length;
        if (kind === 'horde') ok = LastCrisis._beginHorde(world, st, realm, player, day);
        else if (kind === 'crusade') ok = LastCrisis._beginCrusade(world, st, realm, day);
        else if (kind === 'breakaway') ok = LastCrisis._beginBreakaway(world, st, realm, day);
        if (!ok) {
            // The world changed under the omens: another kind, else it passes for now
            const alt = st.trial.retried ? null : LastCrisis._choose(world, realm, { seq: st.seq + 7 });
            if (alt && alt !== kind) {
                st.trial = { kind: alt, retried: true, ...LastCrisis._prepare(world, realm, alt, st) };
                return LastCrisis._beginTrial(world, st, player, day);
            }
            LastCrisis._abandon(world, st, day);
            return;
        }
        st.phase = 'trial';
        st.trialDay = day;
        st.capital0 = realm.capital ? { q: realm.capital.q, r: realm.capital.r } : null;
        if (kind !== 'horde') st.towns0 = _townsOf(world, realm).length;
        Interrupts.raise(world, { reason: `${KIND_INFO[st.trial.kind].label} begins`, icon: KIND_INFO[st.trial.kind].icon, source: 'lastCrisis' });
    },

    /** The omens came to nothing (the realm fell some other way): the age goes on. */
    _abandon(world, st, day) {
        st.phase = 'watch';
        st.trial = null;
        st.held = 0;
        st.need = null;
        st.nextAllowed = day + 10 * YEAR;
    },

    _beginHorde(world, st, realm, player, day) {
        const H = LastCrisis.config().horde;
        const at = LastCrisis._landing(world, realm);
        if (!at) return false;
        const people = st.trial.people;
        const host = Math.max(_num(H.minHost), Math.round((_num(realm.military) + LastCrisis._army(player)) * _range(world, `host:${st.seq}`, H.hostMult)));
        const c = Crises.start(world, 'invasion', { force: true, aim: { at, people, host, waves: H.waves, realmId: realm.id, name: `the Great Coming of ${String(people.name).replace(/^the /, '')}`, by: 'lastCrisis' } });
        if (!c) return false;
        // Its omens were ours: the host lands within weeks
        c.phaseEnd = Math.min(_num(c.phaseEnd, day), day + 14);
        st.trial.uid = c.uid;
        st.trial.host = host;
        st.trial.at = { q: at.q, r: at.r };
        LastCrisis._log(world, st, 'begin', (LastCrisis.config().text.begin || {}).horde, LastCrisis._vars(world, st), { big: true, icon: '⚔️', title: KIND_INFO.horde.label, tone: 'error' });
        return true;
    },

    /** Levies a foe raises for the war out of its own chests (the wages paid in its capital's town). */
    _raise(world, k, men, gps, share) {
        const want = Math.max(0, Math.round(men)) * gps;
        const paid = Math.floor(Math.min(want, Math.max(0, _num(k.treasury)) * share));
        if (!(paid > 0)) return { men: 0, gold: 0 };
        k.treasury = _num(k.treasury) - paid;
        const seat = k.capital || null;
        if (seat && Economy.nearestPurse(world, seat.q, seat.r)) Economy.payNearest(world, seat.q, seat.r, paid);
        else k.treasury += paid;
        const got = Math.floor(paid / gps);
        k.military = _num(k.military) + got;
        return { men: got, gold: paid };
    },

    _war(world, a, b) {
        if (!_alive(a) || !_alive(b) || a.id === b.id) return;
        if (!Array.isArray(a.wars)) a.wars = [];
        if (!Array.isArray(b.wars)) b.wars = [];
        if (!a.wars.includes(b.id)) Utils.withRng(_rng(world, `war:${a.id}:${b.id}:${_day(world)}`), () => KingdomAI.startWar(a, b, world));
        // A sworn war: the lords' peace and weariness do not end it, only the verdict (_judge ends it)
        const C = LastCrisis.config();
        const yrs = Math.max(..._arr(C.crusade && C.crusade.years), ..._arr(C.breakaway && C.breakaway.years), 1);
        if (typeof KingdomAI.swearWar === 'function') KingdomAI.swearWar(a, b, world, _day(world) + Math.round((yrs + 1) * YEAR));
    },

    _beginCrusade(world, st, realm, day) {
        const X = LastCrisis.config().crusade;
        const members = LastCrisis._infidels(world, realm).slice(0, Math.max(1, _num(X.maxMembers, 4)));
        if (members.length < _num(X.minMembers, 2)) return false;
        // Their own quarrels end before the holy war
        for (const a of members) {
            for (const b of members) {
                if (a.id < b.id && _arr(a.wars).includes(b.id)) KingdomAI.endWar(a, b, world, { text: `🕊️ ${a.name} and ${b.name} lay down their quarrel for the holy war.` });
            }
        }
        const target = _num(realm.military) * _range(world, `raise:${st.seq}`, X.raiseMult);
        const each = target / members.length;
        const names = [];
        for (const m of members) {
            const r = LastCrisis._raise(world, m, Math.max(0, each - _num(m.military) * 0.5), _num(X.goldPerSoldier, 4), _num(X.treasuryShare, 0.6));
            LastCrisis._war(world, m, realm);
            names.push(m.name);
            if (r.men) LastCrisis._log(world, st, 'member', LastCrisis.config().text.member, { ...LastCrisis._vars(world, st), realm: Names.realm(m.name), gold: r.gold, men: r.men });
        }
        if (realm.religion) realm.religion.unity = Math.max(0, _num(realm.religion.unity, 50) - _num(X.unityHit, 15));
        st.trial.foes = members.map(m => m.id);
        st.trial.resolve = _num(X.resolve, 100);
        st.trial.until = day + Math.round(_range(world, `years:${st.seq}`, X.years) * YEAR);
        LastCrisis._log(world, st, 'begin', (LastCrisis.config().text.begin || {}).crusade, { ...LastCrisis._vars(world, st), members: _listNames(names.map(n => Names.realm(n, true))) }, { big: true, icon: '⛪', title: KIND_INFO.crusade.label, tone: 'error' });
        return true;
    },

    _beginBreakaway(world, st, realm, day) {
        const X = LastCrisis.config().breakaway;
        const towns = _townsOf(world, realm);
        if (towns.length < _num(X.minTowns, 5) || !realm.capital) return false;
        const capKey = _key(realm.capital);
        const far = towns.filter(t => _key(t) !== capKey).sort((a, b) => _dist(world, b, realm.capital) - _dist(world, a, realm.capital) || (a.q - b.q) || (a.r - b.r));
        const n = _clamp(Math.round(towns.length * _range(world, `share:${st.seq}`, X.share)), 2, far.length);
        // The pretender's towns: the farthest, and those nearest it (one province, not scattered)
        const seat = far[0];
        const mine = far.slice().sort((a, b) => _dist(world, a, seat) - _dist(world, b, seat)).slice(0, n);
        const pretender = `${st.trial.pretender} of ${st.trial.old}`;
        const k = LastCrisis._raiseRealm(world, st, {
            from: realm, seat, towns: mine, keep: towns.filter(t => !mine.includes(t)),
            name: _fill('the Kingdom of {town}', { town: seat.settlement.name }), ruler: pretender, share: (n / towns.length) * _num(X.levyShare, 0.9), key: `pretender:${st.seq}`,
        });
        if (!k) return false;
        k.description = `The crown ${pretender} raised against ${st.house}.`;
        LastCrisis._war(world, k, realm);
        // Hostile neighbours back the pretender
        const backers = world.kingdoms.filter(o => _alive(o) && o.id !== realm.id && o.id !== k.id && !_arr(o.allies).includes(realm.id) && _num(o.relations && o.relations[realm.id]) < -10)
            .sort((a, b) => _num(a.relations[realm.id]) - _num(b.relations[realm.id]) || (a.id < b.id ? -1 : 1)).slice(0, Math.max(0, _num(X.backers, 2)));
        for (const b of backers) {
            LastCrisis._war(world, b, realm);
            LastCrisis._log(world, st, 'backer', LastCrisis.config().text.backer, { ...LastCrisis._vars(world, st), realm: Names.realm(b.name, true), pretender });
        }
        st.trial.pretenderId = k.id;
        st.trial.pretender = pretender;
        st.trial.ptowns0 = mine.length;
        st.trial.foes = [k.id, ...backers.map(b => b.id)];
        st.trial.resolve = _num(X.resolve, 100);
        st.trial.until = day + Math.round(_range(world, `years:${st.seq}`, X.years) * YEAR);
        LastCrisis._log(world, st, 'begin', (LastCrisis.config().text.begin || {}).breakaway, { ...LastCrisis._vars(world, st), pretender, towns: _listNames(mine.map(t => t.settlement.name)) }, { big: true, icon: '👑', title: KIND_INFO.breakaway.label, tone: 'error' });
        return true;
    },

    /**
     * A realm carved out of `from`: its towns and the land nearest them, a
     * share of the levies, the chests and the royal bank (moved, not made),
     * a lord and a royal family. opts { from, seat, towns, keep, name, ruler, share, key }.
     */
    _raiseRealm(world, st, opts) {
        const from = opts.from;
        let k = null;
        Utils.withRng(_rng(world, `raise:${opts.key}`), () => {
            const ids = new Set(world.kingdoms.map(x => x.id));
            let n = 1;
            while (ids.has(`successor_${n}`)) n++;
            const used = new Set(world.kingdoms.map(x => String(x.color || '').toLowerCase()));
            const color = ['#6d4c41', '#455a64', '#ad1457', '#6a1b9a', '#2e7d32', '#d84315', '#00838f', '#9e9d24', '#4527a0'].find(x => !used.has(x)) || '#5d4037';
            const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
            const name = String(opts.name).replace(/^the /i, '').replace(/^./, ch => ch.toUpperCase());
            k = Kingdom.create({
                id: `successor_${n}`, name, ruler: opts.ruler || Kingdom.generateRulerName(from.culture), color,
                colorLight: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`, culture: from.culture,
                description: `A crown risen from ${Names.realm(from.name)}.`,
                preferredTerrain: Array.isArray(from.preferredTerrain) ? from.preferredTerrain.slice() : ['plains', 'grassland', 'hills'], traits: [],
            });
            // (no coin from nowhere: the chests and the vault are shared out of the old realm's below)
            k.treasury = 0;
            if (k.royalBank) k.royalBank.treasury = 0;
            k.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
            k.truces = {};
            k.warState = {};
            if (from.religion) k.religion = { ...JSON.parse(JSON.stringify(from.religion)), heresies: [], holySites: [], pilgrimIncome: 0 };
            for (const o of world.kingdoms) {
                if (!o.relations) o.relations = {};
                const rel = o.id === from.id ? _num(LastCrisis.config().dark.relations, -40) : _num(o.relations[from.id]);
                o.relations[k.id] = rel;
                k.relations[o.id] = rel;
            }
            world.kingdoms.push(k);
            k.isAlive = true;
            k.foundedDay = _day(world);
            k.capital = { q: opts.seat.q, r: opts.seat.r };
            k.stability = 50;
            k.wars = [];
            if (!Array.isArray(st.looks)) st.looks = [];
            st.looks.push({ id: k.id, colorLight: k.colorLight, preferredTerrain: k.preferredTerrain, foundedDay: k.foundedDay });
        });
        if (!k) return null;
        LastCrisis._partition(world, from, [{ k, towns: opts.towns }], opts.keep);
        const share = _clamp(_num(opts.share), 0, 0.9);
        const men = Math.round(_num(from.military) * share);
        from.military = Math.max(0, _num(from.military) - men);
        k.military = Math.max(20, men);
        if (k.military > men) from.military = Math.max(0, _num(from.military) - (k.military - men));
        const gold = Math.floor(Math.max(0, _num(from.treasury)) * share);
        from.treasury = _num(from.treasury) - gold;
        k.treasury = gold;
        MoneySupply.transfer(world, from.id, k.id, gold, 'partition');
        if (from.royalBank && k.royalBank) {
            const v = Math.floor(Math.max(0, _num(from.royalBank.treasury)) * share);
            from.royalBank.treasury -= v;
            k.royalBank.treasury = v;
        }
        k.population = opts.towns.reduce((s, t) => s + _num(t.settlement.population), 0);
        Utils.withRng(_rng(world, `court:${opts.key}`), () => {
            try { Kingdom.initializeKingdomStats(k, world.tiles, world.width, world.height); } catch (e) { /* a sparse realm */ }
            k.lord = NPCLords.generateLord(k);
            if (Characters && typeof Characters.generateRoyalFamily === 'function') {
                k.characterData = Characters.generateRoyalFamily(k, world);
                if (!opts.ruler) k.ruler = Characters.getDisplayName(k.characterData.ruler, k);
            }
            KingdomNavy.ensure(k);
        });
        if (opts.ruler) { k.ruler = opts.ruler; if (k.lord) k.lord.name = opts.ruler; }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        return k;
    },

    /** Share `from`'s land among the groups' towns and the kept ones (each tile to its nearest town). */
    _partition(world, from, groups, keep) {
        const anchors = [...groups.flatMap(g => g.towns.map(t => ({ t, k: g.k }))), ..._arr(keep).map(t => ({ t, k: from }))];
        if (!anchors.length) return;
        const moved = new Map();
        for (const tile of _arr(from.territory)) {
            let best = null, bd = Infinity;
            for (const a of anchors) {
                const d = _dist(world, tile, a.t);
                if (d < bd) { bd = d; best = a; }
            }
            if (!best || best.k === from) continue;
            moved.set(_key(tile), best.k);
        }
        for (const g of groups) for (const t of g.towns) moved.set(_key(t), g.k);
        from.territory = _arr(from.territory).filter(t => !moved.has(_key(t)));
        for (const [key, k] of moved) {
            const [q, r] = key.split(',').map(Number);
            const tile = world.getTile(q, r);
            if (!tile) continue;
            tile.kingdom = k.id;
            if (!k.territory.some(t => t.q === q && t.r === r)) k.territory.push({ q, r });
            if (tile.settlement && tile.settlement.kingdom === from.id) {
                if (!tile.settlement.formerKingdom) tile.settlement.formerKingdom = from.id;
                tile.settlement.kingdom = k.id;
            }
        }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    },

    _trial(world, st, player, day) {
        const C = LastCrisis.config();
        const realm = _kingdom(world, st.realmId);
        const t = st.trial;
        // The realm broken outright: no need to wait for the end
        const towns = _townsOf(world, realm).length;
        if (!_alive(realm) || towns < _num(st.towns0) * _num(C.breakShare, 0.5)) return LastCrisis._judge(world, st, player, day, false);
        if (t.kind === 'horde') {
            const c = Crises.active(world);
            if (c && c.uid === t.uid) return;
            const done = Crises.history(world).find(h => h.uid === t.uid);
            t.outcome = done ? done.outcome : 'gone';
            const invaders = done && done.data ? _kingdom(world, done.data.realmId) : null;
            const foeBroken = t.outcome === 'repelled' || !_alive(invaders) || _townsOf(world, invaders).length === 0;
            return LastCrisis._judge(world, st, player, day, foeBroken);
        }
        const X = C[t.kind] || {};
        // Foes that made peace with the realm or fell are out of it
        for (const id of _arr(t.foes).slice()) {
            const f = _kingdom(world, id);
            if (_alive(f) && _arr(f.wars).includes(realm.id)) continue;
            if (t.kind === 'breakaway' && id === t.pretenderId && _alive(f) && _townsOf(world, f).length) {
                LastCrisis._war(world, f, realm); // a pretender does not make peace: he is king or nothing
                continue;
            }
            t.foes = t.foes.filter(x => x !== id);
            if (id !== t.pretenderId) t.resolve = _num(t.resolve) + _num(X.memberOut, -20);
        }
        const foes = t.foes.map(id => _kingdom(world, id)).filter(_alive);
        const foeMight = foes.reduce((s, f) => s + _num(f.military), 0);
        const ours = _num(realm.military) + LastCrisis._army(player && KingdomAI.playerRealm(world) === realm ? player : null);
        // The foe's resolve wears down, faster when the realm's armies outweigh theirs
        t.resolve = _num(t.resolve) + _num(X.weekly, -1) * (ours > foeMight ? 1.5 : 1) + (foeMight > ours * 1.5 ? 0.5 : 0);
        const pret = t.kind === 'breakaway' ? _kingdom(world, t.pretenderId) : null;
        const pretGone = t.kind === 'breakaway' && (!_alive(pret) || _townsOf(world, pret).length === 0);
        if (t.resolve <= 0 || !foes.length || pretGone) return LastCrisis._judge(world, st, player, day, true);
        if (day >= _num(t.until)) {
            const broken = foeMight <= ours && (t.kind !== 'breakaway' || _townsOf(world, pret).length <= Math.floor(_num(t.ptowns0) / 3));
            return LastCrisis._judge(world, st, player, day, broken);
        }
    },

    /** The reckoning's verdict: a Golden Age or a Dark one. */
    _judge(world, st, player, day, foeBroken) {
        const C = LastCrisis.config();
        const realm = _kingdom(world, st.realmId);
        const t = st.trial;
        const towns = _townsOf(world, realm);
        const capitalHeld = _alive(realm) && !!st.capital0 && towns.some(x => _key(x) === _key(st.capital0));
        const kept = _num(st.towns0) ? towns.length / st.towns0 : 0;
        const survived = !!foeBroken && _alive(realm) && capitalHeld && kept >= _num(C.hold, 0.67) - 1e-9;
        // The wars of it end (the invasion's own wars end with it)
        if (_alive(realm)) {
            for (const id of _arr(t.foes)) {
                const f = _kingdom(world, id);
                if (!_alive(f) || !_arr(f.wars).includes(realm.id)) continue;
                if (survived && id === t.pretenderId) continue; // the pretender submits below
                KingdomAI.endWar(realm, f, world, { victor: survived ? realm : f, text: survived ? `🕊️ ${f.name} sues ${Names.realm(realm.name)} for peace.` : `🕊️ ${Names.realm(realm.name)} buys peace of ${f.name}.` });
            }
        }
        // A pretender beaten: his towns and land come back, his crown is no more
        if (survived && t.kind === 'breakaway') {
            const p = _kingdom(world, t.pretenderId);
            if (_alive(p)) {
                const back = _townsOf(world, p);
                if (back.length) LastCrisis._partition(world, p, [{ k: realm, towns: back }], []);
                for (const x of _arr(p.territory)) { const tile = world.getTile(x.q, x.r); if (tile) tile.kingdom = realm.id; if (!realm.territory.some(y => y.q === x.q && y.r === x.r)) realm.territory.push({ q: x.q, r: x.r }); }
                p.territory = [];
                realm.military = _num(realm.military) + Math.round(_num(p.military) * 0.5);
                if (_num(p.treasury) > 0) { MoneySupply.transfer(world, p.id, realm.id, p.treasury, 'partition'); realm.treasury = _num(realm.treasury) + p.treasury; p.treasury = 0; }
                p.military = 0;
                for (const id of [...(p.wars || [])]) { const o = _kingdom(world, id); if (o) KingdomAI.endWar(p, o, world, { text: `🕊️ The pretender's war is over.` }); }
                p.isAlive = false;
                p.conqueredBy = realm.id;
                p.conqueredDay = day;
                if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
            }
        }
        st.history.push({ seq: st.seq, kind: t.kind, startDay: st.startDay, trialDay: st.trialDay, endDay: day, outcome: survived ? 'golden' : 'dark', house: st.house, realm: st.realmName });
        if (survived) LastCrisis._golden(world, st, day);
        else LastCrisis._dark(world, st, day);
        LastCrisis._settleHouse(world, st, player);
        Interrupts.raise(world, { reason: survived ? 'A Golden Age begins' : 'A Dark Age begins', icon: survived ? '🌅' : '🌑', source: 'lastCrisis' });
    },

    _golden(world, st, day) {
        const G = LastCrisis.config().golden;
        const v = LastCrisis._vars(world, st);
        const name = _fill(_pick(world, `golden:${st.seq}`, G.names) || 'the Golden Age of {house}', v);
        st.age = { kind: 'golden', name, startDay: day, until: day + Math.round(_num(G.years, 50) * YEAR), realmId: st.realmId, house: st.house, settled: false, successors: [] };
        st.phase = 'age';
        LastCrisis._applyMods(world, st, null);
        LastCrisis._log(world, st, 'survived', LastCrisis.config().text.survived, { ...v, age: name }, { big: true, icon: '🌅', title: _cap(name), tone: 'success' });
    },

    _dark(world, st, day) {
        const D = LastCrisis.config().dark;
        const v = LastCrisis._vars(world, st);
        const name = _fill(_pick(world, `dark:${st.seq}`, D.names) || 'the Dark Age', v);
        st.age = { kind: 'dark', name, startDay: day, until: day + Math.round(_num(D.years, 30) * YEAR), realmId: st.realmId, house: st.house, settled: false, successors: [] };
        st.phase = 'age';
        LastCrisis._log(world, st, 'failed', LastCrisis.config().text.failed, { ...v, age: name }, { big: true, icon: '🌑', title: _cap(name), tone: 'error' });
        st.age.successors = LastCrisis._fragment(world, st);
        LastCrisis._applyMods(world, st, null);
    },

    /**
     * The realm breaks into successor states: the House keeps its capital and
     * the towns nearest it (dark.keep), the rest go to up to dark.maxStates
     * new crowns, each around a far town. → the new realms' ids.
     */
    _fragment(world, st) {
        const D = LastCrisis.config().dark;
        const realm = _kingdom(world, st.realmId);
        const towns = _townsOf(world, realm);
        if (!_alive(realm) || towns.length < 2) return [];
        const seat = (realm.capital && towns.find(t => _key(t) === _key(realm.capital))) || towns[0];
        const sorted = towns.slice().sort((a, b) => _dist(world, a, seat) - _dist(world, b, seat) || a.q - b.q || a.r - b.r);
        const keepN = Math.max(1, Math.ceil(towns.length * _num(D.keep, 0.3)));
        const keep = sorted.slice(0, keepN);
        const rest = sorted.slice(keepN);
        if (!rest.length) return [];
        const nStates = _clamp(Math.round(rest.length / 3), 1, Math.max(1, _num(D.maxStates, 3)));
        // Seeds far from the seat and from each other; each town to its nearest seed
        const seeds = [rest[rest.length - 1]];
        while (seeds.length < nStates) {
            let best = null, bd = -1;
            for (const t of rest) {
                if (seeds.includes(t)) continue;
                const d = Math.min(...seeds.map(s => _dist(world, s, t)), _dist(world, seat, t));
                if (d > bd) { bd = d; best = t; }
            }
            if (!best) break;
            seeds.push(best);
        }
        const groups = seeds.map(s => ({ seed: s, towns: [] }));
        for (const t of rest) {
            let g = groups[0], bd = Infinity;
            for (const x of groups) { const d = _dist(world, x.seed, t); if (d < bd) { bd = d; g = x; } }
            g.towns.push(t);
        }
        const out = [];
        const total = towns.length;
        let keepNow = keep.slice();
        const v = LastCrisis._vars(world, st);
        groups.forEach((g, i) => {
            if (!g.towns.length) return;
            const others = groups.slice(i + 1).flatMap(x => x.towns);
            const name = _fill(_pick(world, `state:${st.seq}:${i}`, D.states) || 'the Kingdom of {town}', { town: g.seed.settlement.name });
            const k = LastCrisis._raiseRealm(world, st, { from: realm, seat: g.seed, towns: g.towns, keep: [...keepNow, ...others], name, share: g.towns.length / total * 0.9, key: `state:${st.seq}:${i}` });
            if (!k) return;
            out.push(k.id);
            LastCrisis._log(world, st, 'fragment', LastCrisis.config().text.fragment, { ...v, state: Names.realm(k.name, true), town: g.seed.settlement.name }, { icon: '🗺️' });
        });
        keepNow = null;
        return out;
    },

    /** The age's crown mods on the realm (kingdom.ageMods → KingdomBonuses.get), while the House rules it. */
    _applyMods(world, st, player) {
        const age = st && st.age;
        for (const k of _arr(world && world.kingdoms)) if (k && k.ageMods && (!age || k.id !== age.realmId)) delete k.ageMods;
        if (!age || st.phase !== 'age') return;
        const realm = _kingdom(world, age.realmId);
        if (!realm) return;
        // (a House that has lost the crown carries the age's name, not its fortunes)
        const ruled = player ? KingdomAI.playerRealm(world) === realm : true;
        if (_alive(realm) && ruled) realm.ageMods = { ...(LastCrisis.config()[age.kind] || {}).mods };
        else delete realm.ageMods;
    },

    _age(world, st, player, day) {
        const age = st.age;
        if (!age) { st.phase = 'watch'; return; }
        LastCrisis._applyMods(world, st, player);
        if (day < age.until) return;
        LastCrisis._log(world, st, age.kind === 'golden' ? 'goldenEnd' : 'darkEnd', (LastCrisis.config().text || {})[age.kind === 'golden' ? 'goldenEnd' : 'darkEnd'], { ...LastCrisis._vars(world, st), age: age.name }, { big: true, icon: age.kind === 'golden' ? '🌇' : '🌄', title: _cap(age.name), tone: 'info' });
        const h = st.history[st.history.length - 1];
        if (h) { h.ageName = age.name; h.ageEnd = day; }
        st.age = null;
        st.phase = 'watch';
        st.trial = null;
        st.held = 0;
        st.need = null;
        st.nextAllowed = _num(h && h.endDay, day) + Math.round(_num(LastCrisis.config().ageYears, 150) * YEAR);
        LastCrisis._applyMods(world, st, player);
    },

    /** The House's share of the verdict: Prestige, renown, the legacy score, its chronicle. Once. */
    _settleHouse(world, st, player) {
        const age = st && st.age;
        const house = player && player.house;
        if (!age || age.settled || !house) return;
        if (house.name && age.house && house.name !== age.house) return;
        age.settled = true;
        const day = _day(world);
        if (age.kind === 'golden') {
            const G = LastCrisis.config().golden;
            House.award(house, Math.round(_num(G.prestige)), `${age.name}`, day);
            player.renown = _num(player.renown) + _num(G.renown);
            house.ageScore = _num(house.ageScore) + _num(G.legacy);
        } else {
            const D = LastCrisis.config().dark;
            const loss = Math.floor(Math.max(0, _num(house.prestige)) * _num(D.prestigeLoss));
            if (loss > 0) House.spend(house, loss, `${age.name}`, day);
            player.renown = Math.max(0, Math.round(_num(player.renown) * (1 - _num(D.renownLoss))));
            house.ageScore = _num(house.ageScore) + _num(D.legacy);
        }
        if (!Array.isArray(house.ages)) house.ages = [];
        house.ages.push({ kind: age.kind, name: age.name, day: age.startDay, until: age.until, realm: st.realmName || null });
        House._chronicle(house, world, age.kind === 'golden'
            ? `The last crisis of the age is weathered. The chroniclers name the years to come ${age.name}.`
            : `The last crisis of the age breaks the House's crown. ${_cap(age.name)} begins.`, ['crisis', age.kind === 'golden' ? 'golden_age' : 'dark_age']);
    },

    // ── Effects read elsewhere ───────────────────────

    /** The age now running ({ kind, name, startDay, until, realmId, successors }) or null. */
    currentAge(world) {
        const st = world && _obj(world.lastCrisis);
        return st && st.phase === 'age' && st.age ? st.age : null;
    },

    /** How the realms' hostility toward the House is scaled (Coalitions.assess): awe in a Golden Age, contempt in a Dark. */
    threatMult(world, player) {
        const age = LastCrisis.currentAge(world);
        if (!age || !player || (player.house && age.house && player.house.name !== age.house)) return 1;
        return _num((LastCrisis.config()[age.kind] || {}).threat, 1);
    },

    // ── The chronicle ────────────────────────────────

    _log(world, st, kind, list, vars, opts = {}) {
        const n = st.log.length;
        const text = _fill(_pick(world, `${st.seq}:${kind}:${n}`, list) || '', vars);
        if (!text) return null;
        const e = { day: _day(world), seq: st.seq, kind, text, n, big: !!opts.big, icon: opts.icon || null, title: opts.title || null, tone: opts.tone || null };
        st.log.push(e);
        if (st.log.length > 60) st.log.splice(0, st.log.length - 60);
        if (_prose) {
            try { _prose.write(world, { kind: 'crisis', key: `lastCrisis:${st.seq}:${n}`, facts: { crisis: 'the last crisis of the age', kind: st.trial ? st.trial.kind : null, event: kind, ...vars }, fallback: text, style: 'chronicle' }); } catch (err) { /* the template stands */ }
        }
        // The heralds cry it with the world's crises (systems/heralds.js reads world.crises.news)
        const cs = Crises.state(world);
        if (cs) {
            cs.news.push({ key: `lastCrisis:${st.seq}:${n}`, kind: opts.big ? 'crisis_grave' : 'crisis', day: e.day, text, q: null, r: null, kingdomId: st.realmId || null });
            if (cs.news.length > 40) cs.news.splice(0, cs.news.length - 40);
        }
        if (Array.isArray(world.events)) world.events.push({ text: `${opts.icon || '📜'} ${text}`, type: 'crisis' });
        return e;
    },

    line(world, e) {
        if (!e) return '';
        if (_prose) {
            try { return _prose.text(world, `lastCrisis:${e.seq}:${e.n}`, e.text) || e.text; } catch (err) { return e.text; }
        }
        return e.text;
    },

    /** The last crisis as a chapter of the Annals (systems/annals.js `ages`). */
    annalChapters(world, fromDay = 0) {
        const st = world && _obj(world.lastCrisis);
        if (!st || !st.log.length) return [];
        const yr = (d) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(_num(d, 1))) - 1) / YEAR);
        const bySeq = new Map();
        for (const e of st.log) {
            if (!bySeq.has(e.seq)) bySeq.set(e.seq, []);
            bySeq.get(e.seq).push(e);
        }
        const out = [];
        for (const [seq, entries] of bySeq) {
            const h = st.history.find(x => x.seq === seq);
            const live = !h;
            const from = live ? st.startDay : h.startDay;
            if (!live && _num(h.ageEnd, h.endDay) < fromDay) continue;
            const kind = live ? (st.trial && st.trial.kind) : h.kind;
            const name = h && h.outcome ? (h.ageName || (st.age && st.age.name) || KIND_INFO[kind].label) : 'The last crisis of the age';
            const byYear = new Map();
            for (const e of entries) {
                const y = yr(e.day);
                if (!byYear.has(y)) byYear.set(y, []);
                byYear.get(y).push(LastCrisis.line(world, e));
            }
            out.push({
                id: `age_last${seq}`, kind: 'last', icon: h ? (h.outcome === 'golden' ? '🌅' : '🌑') : (KIND_INFO[kind] || {}).icon || '📜',
                title: `${_cap(name)}, ${live ? `year ${yr(from)} to the present` : `years ${yr(from)}–${h.ageEnd ? yr(h.ageEnd) : 'the present'}`}`,
                fromYear: yr(from), toYear: live || !h.ageEnd ? null : yr(h.ageEnd), live: live || !h.ageEnd, outcome: h ? h.outcome : null,
                paragraphs: [...byYear.entries()].map(([y, lines]) => ({ year: y, text: `In the year ${y}, ${lines.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(' ')}` })),
            });
        }
        return out;
    },

    // ── The player's part ────────────────────────────

    /** The foe nearest the player (a member, backer or the pretender), with its distance. */
    _nearFoe(world, st, player) {
        const t = st.trial;
        if (!t || !player || !Number.isFinite(player.q)) return null;
        let best = null;
        for (const id of _arr(t.foes)) {
            const f = _kingdom(world, id);
            if (!_alive(f)) continue;
            const pts = [...(f.capital ? [f.capital] : []), ..._townsOf(world, f)];
            for (const p of pts) {
                const d = _dist(world, p, player);
                if (!best || d < best.dist) best = { k: f, dist: d, at: p };
            }
        }
        return best;
    },

    buyOffPrice(world, k) {
        const X = LastCrisis.config().choices;
        return Math.max(_num(X.buyOffMin, 300), Math.round(Math.max(0, _num(k.treasury)) * _num(X.buyOffTreasury, 0.5) + _num(k.military) * _num(X.buyOffPerSoldier, 2)));
    },

    /** The choices open to the player in the trial: [{ id, icon, label, desc, ok, why, cost, args }]. */
    choices(player, world) {
        const st = LastCrisis.state(world);
        const out = [];
        if (!player || st.phase !== 'trial' || !st.trial) return out;
        const X = LastCrisis.config().choices;
        const realm = _kingdom(world, st.realmId);
        const rules = _alive(realm) && KingdomAI.playerRealm(world) === realm;
        const gold = _num(player.gold);
        for (const amt of _arr(X.fundCost)) {
            out.push({ id: 'fund', args: [amt], icon: '🛡️', label: `Pay ${amt} gold into the royal host`, desc: `${Math.floor(amt / X.goldPerSoldier)} more men under the banner of ${realm ? Names.realm(realm.name) : 'the realm'}.`, ok: rules && gold >= amt, why: !rules ? 'You no longer rule the realm.' : gold < amt ? 'Not enough gold.' : '', cost: amt });
        }
        if (st.trial.kind === 'horde') return out;
        for (const id of _arr(st.trial.foes)) {
            const f = _kingdom(world, id);
            if (!_alive(f) || id === st.trial.pretenderId) continue;
            const price = LastCrisis.buyOffPrice(world, f);
            out.push({ id: 'buyoff', args: [id], icon: '💰', label: `Buy ${Names.realm(f.name)} out of the war`, desc: `Gold to its chests, and it goes home. The others call it treachery, and lose heart.`, ok: rules && gold >= price, why: !rules ? 'You no longer rule the realm.' : gold < price ? 'Not enough gold.' : '', cost: price });
        }
        const near = LastCrisis._nearFoe(world, st, player);
        const army = LastCrisis._army(player);
        const ok = !!near && near.dist <= X.battleRadius && army > 0;
        out.push({ id: 'battle', args: [], icon: '⚔️', label: near ? `Take the field against ${Names.realm(near.k.name)}` : 'Take the field', desc: near ? `Their army near ${near.dist} hexes away: ${Math.round(_num(near.k.military) * X.battleShare)} men in the field.` : 'No foe is near.', ok, why: !near ? 'No foe is near.' : near.dist > X.battleRadius ? `Ride within ${X.battleRadius} hexes of the foe.` : army <= 0 ? 'You have no army.' : '' });
        return out;
    },

    /** The foe's field army the player meets in battle (the UI fights it with PlayerMilitary.combat). */
    battleFoe(player, world) {
        const st = LastCrisis.state(world);
        const near = LastCrisis._nearFoe(world, st, player);
        if (!near) return null;
        return { kingdom: near.k, strength: Math.max(10, Math.round(_num(near.k.military) * LastCrisis.config().choices.battleShare)), at: near.at };
    },

    /** Do one of the choices. battle takes { victory } from the fight the caller ran. → { success, text } */
    act(player, world, id, ...args) {
        const st = LastCrisis.state(world);
        const ch = LastCrisis.choices(player, world).find(x => x.id === id && JSON.stringify(x.args || []) === JSON.stringify(args.slice(0, (x.args || []).length)));
        if (!ch || !ch.ok) return { success: false, text: (ch && ch.why) || 'You cannot do that now.' };
        const X = LastCrisis.config().choices;
        const realm = _kingdom(world, st.realmId);
        const t = st.trial;
        const day = _day(world);
        const v = { ...LastCrisis._vars(world, st), player: player.name || 'The head of the House' };
        const rec = (text) => { st.acts.push({ day, seq: st.seq, id, text }); if (st.acts.length > 40) st.acts.splice(0, st.acts.length - 40); };
        if (id === 'fund') {
            const amt = _num(args[0]);
            player.gold -= amt;
            realm.treasury = _num(realm.treasury) + amt;
            const men = Math.floor(amt / X.goldPerSoldier);
            realm.military = _num(realm.military) + men;
            Ledger.record(player, 'crisisAid', -amt);
            LastCrisis._log(world, st, 'funded', LastCrisis.config().text.funded, { ...v, gold: amt, men });
            rec(`paid ${amt} gold into the royal host`);
            return { success: true, text: `${Utils.formatGold(amt)}g into the royal chests: ${men} more men answer the summons.` };
        }
        if (id === 'buyoff') {
            const f = _kingdom(world, args[0]);
            const price = LastCrisis.buyOffPrice(world, f);
            player.gold -= price;
            f.treasury = _num(f.treasury) + price;
            Ledger.record(player, 'crisisAid', -price);
            KingdomAI.endWar(realm, f, world, { text: `🕊️ ${f.name} takes gold and leaves the war against ${Names.realm(realm.name)}.` });
            t.foes = t.foes.filter(x => x !== f.id);
            t.resolve = _num(t.resolve) + _num((LastCrisis.config()[t.kind] || {}).memberOut, -20);
            LastCrisis._log(world, st, 'boughtOff', LastCrisis.config().text.boughtOff, { ...v, foe: Names.realm(f.name, true), gold: price });
            rec(`bought ${Names.realm(f.name)} out of the war`);
            return { success: true, text: `${Names.realm(f.name, true)} takes ${Utils.formatGold(price)}g and goes home.` };
        }
        if (id === 'battle') {
            const r = _obj(args[0]) || {};
            const foe = LastCrisis.battleFoe(player, world);
            if (!foe) return { success: false, text: 'No foe is near.' };
            const f = foe.kingdom;
            const XK = LastCrisis.config()[t.kind] || {};
            let extra = '';
            if (r.victory) {
                f.military = Math.max(0, Math.round(_num(f.military) - foe.strength * 0.8));
                t.resolve = _num(t.resolve) + _num(XK.battleWon, -12);
                if (player.house) House.award(player.house, 15, `broke the army of ${Names.realm(f.name)}`, day);
                // Beaten, the pretender's nearest town opens its gates
                if (f.id === t.pretenderId) {
                    const towns = _townsOf(world, f).sort((a, b) => _dist(world, a, player) - _dist(world, b, player));
                    const town = towns.find(x => !f.capital || _key(x) !== _key(f.capital)) || towns[0];
                    if (town) {
                        LastCrisis._partition(world, f, [{ k: realm, towns: [town] }], towns.filter(x => x !== town));
                        if (_townsOf(world, f).length === 0) f.isAlive = false;
                        else KingdomAI.afterTownLoss(f, realm, world);
                        LastCrisis._log(world, st, 'retaken', LastCrisis.config().text.retaken, { ...v, town: town.settlement.name });
                        extra = ` ${town.settlement.name} opens its gates to you.`;
                    }
                }
                LastCrisis._log(world, st, 'battleWon', LastCrisis.config().text.battleWon, { ...v, foe: Names.realm(f.name) });
            } else {
                realm.military = Math.max(0, Math.round(_num(realm.military) - foe.strength * 0.2));
                t.resolve = _num(t.resolve) + _num(XK.battleLost, 6);
                LastCrisis._log(world, st, 'battleLost', LastCrisis.config().text.battleLost, { ...v, foe: Names.realm(f.name) });
            }
            rec(r.victory ? `broke the army of ${Names.realm(f.name)}` : `was beaten by ${Names.realm(f.name)}`);
            return { success: true, text: r.victory ? `The army of ${Names.realm(f.name)} is broken.${extra}` : `Beaten in the field; the enemy takes heart.` };
        }
        return { success: false, text: 'You cannot do that now.' };
    },

    /** What the Age panel shows: { meter, phase, trial, age, history, choices, acts, foes, log }. */
    view(player, world) {
        const st = LastCrisis.state(world);
        const meter = LastCrisis.meter(world, player);
        const t = st.trial;
        const foes = t ? _arr(t.foes).map(id => _kingdom(world, id)).filter(_alive).map(k => ({ id: k.id, name: k.name, military: Math.round(_num(k.military)), pretender: k.id === t.pretenderId })) : [];
        const realm = _kingdom(world, st.realmId);
        return {
            meter, phase: st.phase, trial: t, age: st.age, history: st.history.slice().reverse(), foes,
            realm: realm ? { name: realm.name, military: Math.round(_num(realm.military)), towns: _townsOf(world, realm).length, towns0: st.towns0,
                ptowns: t && t.kind === 'breakaway' && t.pretenderId && _alive(_kingdom(world, t.pretenderId)) ? _townsOf(world, _kingdom(world, t.pretenderId)).length : null } : null,
            choices: LastCrisis.choices(player, world), acts: st.acts.filter(a => a.seq === st.seq).slice().reverse(),
            log: st.log.filter(e => e.seq === st.seq).slice(-6).reverse(), omenEnd: st.omenEnd, until: t ? t.until : null, crisisUid: t ? t.uid : null,
            hold: LastCrisis.config().hold,
        };
    },
};
