// ============================================
// HOLY WARS — the sees of the faiths, their calls to the cross, their bans
// ============================================
// The faiths had piety, heresies, holy sites and (in a schism, systems/crises.js)
// two rites; no one spoke for them. This layer gives each faith a head:
//
//   THE SEES   one per faith, and one per rite of a faith a schism split (the
//              head of the other rite is its counter-pope). Its seat is the
//              capital of its chief realm (the most holy sites, then piety);
//              its head an NPC pontiff who ages and dies (a new one is raised,
//              and may lift his predecessor's bans) — or the player, when they
//              are a High Priest of the faith (player/scenarios.js
//              player.religion.worldFaithId). Its COFFERS are real coin: the
//              faithful crowns' weekly tithe (treasury → coffers), penances and
//              absolutions, the inquisition's seizures (systems/inquisition.js);
//              spent back into the seat's town past a reserve, and on crusaders.
//              A see the player heads keeps its coin in the player's purse.
//   HOLY WARS  a head calls the faithful against a realm: one holding a holy
//              site of the faith, one keeping a heretic rite, a ruler long
//              under the ban, an infidel at enmity with the faithful. The
//              faithful crowns answer or refuse within answerDays (piety, the
//              lord's honour, the wars it already fights, how far it is);
//              each that answers goes to war through the realms' own machinery
//              (KingdomAI.startWar, sworn for the war's term: KingdomAI.swearWar),
//              its quarrels with fellow crusaders laid down, and draws a subsidy
//              from the coffers. A ruler who answers gains piety, stability and
//              his lords' regard; one who refuses loses them and angers the see.
//              The war ends in victory (the holy site retaken, towns taken, the
//              foe fallen) or defeat (resolve spent, the term run out, every
//              crusader gone home), through KingdomAI.endWar; a vanquished
//              heretic realm returns to the see's rite, a banned one submits.
//              Its towns taken, its crusaders and outcome go on record (the
//              Annals' ages: annalChapters; the House chronicle for the player).
//              They are rare — the world waits worldGapYears after any call, a
//              head sounds out the crowns' support first, a foe lately fought
//              weighs less — and a foe is the target of one at a time: a second
//              see with a cause against it joins that call (a JOINT CRUSADE).
//   KNIGHTS    whoever fights a holy war won under the cross is hailed a
//              Knight of the Cross: the player (a vow fulfilled), the rulers
//              still in the field, the heads of rival Houses who rode with
//              their realm's host; the lords remember the crusader.
//   THE CROSS  any soul of the faith may take the cross while a holy war is
//              called or fought: a vow to reach the muster (a crusader crown's
//              town nearest the foe) and serve at the front. While under the
//              cross the crowns of the faith leave the player's lands alone
//              (systems/realmWars.js reads player.holyWars.cross). At the muster
//              the player goes to war with the foe (RealmWars.declareWar: its
//              hosts, its battles). Served: remission of sins (the charges on
//              the crowns' sheets in the faith's realms, systems/wanted.js; the
//              butcher's and perjurer's name, systems/atrocities.js), karma,
//              standing with the faith, Prestige. Never reached: a broken vow.
//   THE BAN    the see's grievance against a ruler gathers (war on the see's
//              own realm, a faithless crown, a refused call, a tolerated
//              heresy, an expelled inquisitor) and decays; at banAt the head
//              casts the ruler out. Under the ban: stability and the vassals'
//              regard fall (kingdom.church: read by world/kingdomState.js
//              KingdomStability and systems/kingship.js opinion — factions and
//              revolts follow), the faithful cool and break alliances, piety
//              sinks; the player's standing and name with the faith suffer. It
//              is lifted by penance at the seat, by payment, or by turning to a
//              counter-pope where a schism split the faith.
//
// Rules: explicit params, no domain globals; every roll a hash of the world
// seed (the calls into KingdomAI that draw Utils.random run on a dedicated
// stream: Utils.withRng). World state on world.holyWars (saved), the player's
// part on player.holyWars (saved), the realms' effects on kingdom.church
// (saved with the realm). Runs with player=null. Content: data/holyWars.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { LordInfluence } from '../world/kingdomState.js';
import { Religion } from './religion.js';
import { Devotion } from './devotion.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Laws } from './laws.js';
import { Wanted } from './wanted.js';
import { Atrocities } from './atrocities.js';
import { RealmWars } from './realmWars.js';
import { Throne } from './throne.js';
import { NPCLords } from '../world/npcLords.js';
import { RivalHouses } from './rivalHouses.js';

const YEAR = 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => Math.floor(_num(world && world.day));
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _alive = (k) => !!(k && k.isAlive !== false);
const _tkey = (q, r) => `${q},${r}`;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** A roll in [0,1): a hash of the world seed and the key. */
function _u(world, key) {
    return (_hash(`${_seed(world)}|hw|${key}`) % 100000) / 100000;
}

/** A dedicated stream (mulberry32) for calls into code that draws Utils.random. */
function _rng(world, key) {
    let a = _hash(`${_seed(world)}|hwrng|${key}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _range(world, key, span, d = [0, 0]) {
    const [lo, hi] = Array.isArray(span) && span.length === 2 ? span : d;
    return lo + (hi - lo) * _u(world, key);
}

function _fill(t, vars) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _dist(world, a, b) {
    if (!a || !b || !Number.isFinite(a.q) || !Number.isFinite(b.q)) return Infinity;
    return Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? (world.getSettlementViews() || []) : [];
}

function _townsOf(world, k) {
    if (!k) return [];
    const out = [];
    for (const s of _views(world)) if (s && s.kingdom === k.id && Number.isFinite(s.q)) out.push(s);
    return out;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _rite(k) {
    return (k && k.religion && k.religion.rite) || 'orthodox';
}

function _ruled(player, world) {
    try { return player ? Throne.ruledKingdom(player, world) : null; } catch (err) { return null; }
}

const DEFAULTS = {
    enabled: true, weekDay: 3,
    see: { headAge: [46, 64], lifespan: [66, 84], titheShare: 0.0015, titheCap: 40, reserve: 3000, spendShare: 0.06, liftOnNewHead: 0.4, names: ['Clement'], femaleNames: ['Honoria'], titles: { default: 'Patriarch' }, reformedTitle: 'Reformed {title}' },
    call: { everyWeeks: 4, chance: 0.05, militancyMult: 0.35, gapYears: [6, 12], worldGapYears: [12, 22], minSupport: 0.35, noSupportYears: 1, foeRestYears: 30, foeRestMult: 0.1, jointChance: 0.6, firstAfterDays: 300, maxActive: 2, answerDays: 40, warYears: [2, 4], casus: { holySite: 3, heretic: 2, excommunicate: 2.5, infidel: 0.6 }, infidelMinMilitancy: 1, infidelRelation: -30, banYears: 1, subsidyShare: 0.25, subsidyCap: 2500 },
    answer: { base: 0.25, perPiety: 0.006, perMilitancy: 0.08, honour: 0.06, atWar: 0.2, maxWars: 2, farDistance: 70, farFloor: 0.25, pietyAnswer: 6, pietyRefuse: -6, stabAnswer: 4, stabRefuse: -6, stabDays: 240, vassalAnswer: 8, vassalRefuse: -12, refuseGrievance: 35, standingAnswer: 6, standingRefuse: -10, prestigeAnswer: 25, victoryPrestige: 60 },
    war: { resolve: 100, weekly: -1.2, outweighed: 1.5, memberOut: -20, victoryTowns: 2, victoryShare: 0.34, minDays: 180, victoryPiety: 8, defeatPiety: -8, tribute: 0.25 },
    cross: { musterDays: 100, musterRange: 3, serveDays: 40, frontRange: 5, lesserKeep: 0, graveKeep: 0.4, butcherKeep: 0.5, perfidyKeep: 0.6, karma: 12, standing: 18, prestige: 70, reputation: 8, takeStanding: 4, broken: { standing: -25, karma: -10, prestige: 40, grievance: 30 } },
    ban: { banAt: 100, decay: 0.03, atWarSeat: 12, lowPiety: 4, pietyFloor: 15, tolerance: 1.5, stab: -12, vassal: -25, relWeekly: -2, relFloor: -60, allianceBreak: 0.08, pietyWeekly: -0.6, standing: -30, repWeekly: -1, repFloor: -40, price: { base: 400, treasuryShare: 0.12, purseShare: 0.15, max: 6000 }, penanceShare: 0.4, penancePrestige: 30, liftStanding: 10, aiPenanceWeeks: [16, 60], counterPope: 0.04 },
    knight: { title: 'Knight of the Cross', honourFame: 12, servedDeed: 0.5, rival: { chance: 0.3, outfitShare: 0.08, outfitMin: 40, outfitCap: 400, renown: 15, standing: 10, death: 0.06, defeatRenown: -5, guardsLost: 1 } },
    text: {},
};

const CASUS_ICON = { holySite: '⛪', heretic: '🔥', excommunicate: '🔔', infidel: '⚔️' };

export const HolyWars = {
    // ──────────── CONFIG & STATE ────────────

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.holyWars) || {};
        const C = { ...DEFAULTS, ...d };
        for (const k of ['see', 'call', 'answer', 'war', 'cross', 'ban', 'knight', 'text']) C[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        C.knight.rival = { ...DEFAULTS.knight.rival, ...(_obj(d.knight && d.knight.rival) || {}) };
        C.call.casus = { ...DEFAULTS.call.casus, ...(_obj(d.call && d.call.casus) || {}) };
        C.cross.broken = { ...DEFAULTS.cross.broken, ...(_obj(d.cross && d.cross.broken) || {}) };
        C.ban.price = { ...DEFAULTS.ban.price, ...(_obj(d.ban && d.ban.price) || {}) };
        return C;
    },

    text(key, vars = {}) {
        const T = HolyWars.config().text;
        const t = key.includes('.') ? key.split('.').reduce((o, k) => (o ? o[k] : null), T) : T[key];
        const s = _fill(typeof t === 'string' ? t : '', vars);
        // (a line that opens on 'the Kingdom of …' still starts with a capital)
        // (the casus lines are clauses set mid-sentence: left as written)
        return key.startsWith('casus.') ? s : s.charAt(0).toUpperCase() + s.slice(1);
    },

    _blank() {
        return { v: 1, n: 1, sees: {}, wars: [], past: [], log: [] };
    },

    state(world) {
        if (!world) return HolyWars._blank();
        if (!_obj(world.holyWars) || world.holyWars.v !== 1) world.holyWars = HolyWars._blank();
        const st = world.holyWars;
        if (!_obj(st.sees)) st.sees = {};
        for (const k of ['wars', 'past', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        return st;
    },

    serialize(world) {
        return world && _obj(world.holyWars) ? JSON.parse(JSON.stringify(world.holyWars)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.holyWars = _obj(saved) && saved.v === 1 ? JSON.parse(JSON.stringify(saved)) : null;
        HolyWars.state(world);
    },

    /** player.holyWars: the cross, the vows on record, the crusades served. */
    pstate(player) {
        if (!player) return { cross: null, past: [], crusades: 0, atWar: [], log: [] };
        if (!_obj(player.holyWars)) player.holyWars = { cross: null, past: [], crusades: 0, atWar: [], log: [] };
        const p = player.holyWars;
        if (!Array.isArray(p.past)) p.past = [];
        if (!Array.isArray(p.atWar)) p.atWar = [];
        if (!Array.isArray(p.log)) p.log = [];
        if (!Array.isArray(p.served)) p.served = [];
        p.crusades = _num(p.crusades);
        return p;
    },

    _plog(player, world, text) {
        const p = HolyWars.pstate(player);
        p.log.unshift({ d: _day(world), text });
        if (p.log.length > 30) p.log.length = 30;
    },

    _log(world, entry) {
        const st = HolyWars.state(world);
        st.log.push({ day: _day(world), ...entry });
        if (st.log.length > 160) st.log.splice(0, st.log.length - 160);
    },

    // ──────────── THE SEES ────────────

    /** A see's key: the faith, and its rite where a schism split it. */
    keyOf(faithId, rite = 'orthodox') {
        return `${faithId}|${rite || 'orthodox'}`;
    },

    /** The see's key of a realm's church (null: no faith). */
    keyOfRealm(k) {
        return k && k.religion && k.religion.faithId ? HolyWars.keyOf(k.religion.faithId, _rite(k)) : null;
    },

    see(world, key) {
        return key ? HolyWars.state(world).sees[key] || null : null;
    },

    seeOfRealm(world, k) {
        return HolyWars.see(world, HolyWars.keyOfRealm(k));
    },

    /** Every living realm whose church is this see's. */
    flock(world, key) {
        return (world && world.kingdoms || []).filter(k => _alive(k) && HolyWars.keyOfRealm(k) === key);
    },

    /** Does the player head this see (a High Priest of the faith, the old rite)? */
    playerHeads(player, see) {
        const r = player && player.religion;
        return !!(see && r && r.worldFaithId && r.worldFaithId === see.faithId && see.rite === 'orthodox');
    },

    /** "His Holiness Clement IV, Hierarch of the Sun" (or the player's name). */
    headLabel(see) {
        if (!see || !see.head) return 'the head of the faith';
        return see.head.player ? see.head.name : `${see.head.name}, ${see.title}`;
    },

    _title(faithId, rite) {
        const S = HolyWars.config().see;
        const t = (S.titles || {})[faithId] || (S.titles || {}).default || 'Patriarch';
        return rite && rite !== 'orthodox' ? _fill(S.reformedTitle || 'Reformed {title}', { title: t }) : t;
    },

    _newHead(world, see, day, key) {
        const S = HolyWars.config().see;
        const female = _u(world, `${key}|g`) < 0.15 && _arr(S.femaleNames).length;
        const pool = female ? S.femaleNames : S.names;
        const base = pool[_hash(`${_seed(world)}|${key}|name`) % pool.length] || 'Clement';
        if (!_obj(see.names)) see.names = {};
        const n = (see.names[base] = _num(see.names[base]) + 1);
        const age = _range(world, `${key}|age`, S.headAge, [46, 64]);
        const life = Math.max(age + 2, _range(world, `${key}|life`, S.lifespan, [66, 84]));
        return { name: `${base} ${ROMAN[Math.min(n, ROMAN.length) - 1]}`, gender: female ? 'female' : 'male', born: Math.round(day - age * YEAR), since: day, dies: Math.round(day + (life - age) * YEAR) };
    },

    _seatScore(world, k, faithId) {
        const sites = _arr(k.religion && k.religion.holySites).filter(s => {
            const t = world.getTile ? world.getTile(s.q, s.r) : null;
            return t && t.holySite && (!t.holySite.faithId || t.holySite.faithId === faithId);
        }).length;
        return sites * 25 + _num(k.religion && k.religion.piety) + _num(k.population) / 2000;
    },

    /** Weekly: a see for every faith and rite the realms keep; seats, heads, deaths. */
    _syncSees(world, player, day, out) {
        const st = HolyWars.state(world);
        const groups = new Map();
        for (const k of world.kingdoms || []) {
            if (!_alive(k) || !k.capital) continue;
            const key = HolyWars.keyOfRealm(k);
            if (!key || !Religion.FAITHS[k.religion.faithId]) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(k);
        }
        for (const [key, realms] of groups) {
            let see = st.sees[key];
            const [faithId, rite] = key.split('|');
            if (!see) {
                see = st.sees[key] = { key, faithId, rite, title: HolyWars._title(faithId, rite), kingdomId: null, q: null, r: null, town: null, head: null, coffers: 0, bans: {}, grievance: {}, nextCall: day + _num(HolyWars.config().call.firstAfterDays, 300) + Math.floor(_u(world, `${key}|first`) * YEAR), names: {}, founded: day };
            }
            if (!_obj(see.bans)) see.bans = {};
            if (!_obj(see.grievance)) see.grievance = {};
            const heads = HolyWars.playerHeads(player, see);
            // The seat: the High Priest's see, else the realm it stood in (while it keeps the faith), else the chief realm
            let seat = null;
            if (heads && player.religion.see) seat = realms.find(k => k.id === player.religion.see.kingdomId) || null;
            if (!seat) seat = realms.find(k => k.id === see.kingdomId) || null;
            if (!seat) seat = realms.slice().sort((a, b) => HolyWars._seatScore(world, b, faithId) - HolyWars._seatScore(world, a, faithId) || (String(a.id) < String(b.id) ? -1 : 1))[0];
            if (seat) {
                const moved = see.kingdomId != null && see.kingdomId !== seat.id;
                if (moved && see.coffers > 0) MoneySupply.transfer(world, see.kingdomId, seat.id, see.coffers, 'church');
                see.kingdomId = seat.id;
                const cap = heads && player.religion.see ? player.religion.see : seat.capital;
                see.q = cap.q;
                see.r = cap.r;
                const s = _settlementAt(world, cap.q, cap.r);
                see.town = (s && s.name) || see.town || 'the holy city';
            }
            // The head: the player, else a pontiff who ages and dies
            if (heads) {
                see.head = { player: true, name: player.name || 'you', since: see.head && see.head.player ? see.head.since : day };
            } else if (!see.head || see.head.player || day >= _num(see.head.dies, Infinity)) {
                const old = see.head && !see.head.player ? see.head : null;
                see.head = HolyWars._newHead(world, see, day, `${key}|${day}`);
                if (old) {
                    const text = HolyWars.text('headDies', { old: `${old.name}, ${see.title}`, faith: Religion.FAITHS[faithId].name, new: HolyWars.headLabel(see) });
                    HolyWars._log(world, { kind: 'head', key, text });
                    if (Array.isArray(world.events)) world.events.push({ text: `🕯️ ${text}`, type: 'religious', category: 'religious' });
                    if (player && HolyWars._playerFaith(player) === faithId) out.notices.push({ icon: '🕯️', title: 'A New Head of the Faith', text, type: 'info' });
                    // A new head may lift his predecessor's bans
                    for (const who of Object.keys(see.bans)) {
                        if (_u(world, `lift|${key}|${who}|${day}`) < _num(HolyWars.config().see.liftOnNewHead, 0.4)) HolyWars._lift(world, player, see, who, ' on his raising', out);
                    }
                }
            }
        }
        // A see whose every realm is gone: its coffers go into its old seat's town
        for (const key of Object.keys(st.sees)) {
            if (groups.has(key)) continue;
            const see = st.sees[key];
            if (st.wars.some(w => w.seeKey === key)) continue;
            if (see.coffers > 0) {
                const paid = Economy.payNearest(world, see.q, see.r, see.coffers);
                if (paid) see.coffers = 0;
            }
            if (!(see.coffers > 0)) delete st.sees[key];
        }
    },

    /** Coin into a see: its coffers (from a realm's purse in `fromKid`), or the High Priest's own purse. */
    deposit(world, player, see, amount, fromKid = null) {
        const a = _r2(Math.max(0, _num(amount)));
        if (!see || !(a > 0)) return 0;
        if (HolyWars.playerHeads(player, see)) {
            player.gold = _r2(_num(player.gold) + a);
            Ledger.record(player, 'faith', a);
            return a;
        }
        see.coffers = _r2(_num(see.coffers) + a);
        if (fromKid != null && see.kingdomId != null && fromKid !== see.kingdomId) MoneySupply.transfer(world, fromKid, see.kingdomId, a, 'church');
        return a;
    },

    /** Coin out of a see's coffers (never more than it holds) → what was drawn. */
    withdraw(world, see, amount) {
        if (!see) return 0;
        const a = _r2(Math.max(0, Math.min(_num(see.coffers), _num(amount))));
        if (!(a > 0)) return 0;
        see.coffers = _r2(see.coffers - a);
        return a;
    },

    /** The faithful crowns' tithe, and the coffers spent back into the seat's town. */
    _coffersWeek(world, player, see) {
        const S = HolyWars.config().see;
        if (!HolyWars.playerHeads(player, see)) {
            for (const k of HolyWars.flock(world, see.key)) {
                if (see.bans[k.id]) continue;
                // (a crown the player rules pays too: its chests, not the player's purse)
                const due = Math.floor(Math.min(_num(S.titheCap, 40), Math.max(0, _num(k.treasury)) * _num(S.titheShare, 0.0015)));
                if (due <= 0) continue;
                k.treasury = _r2(_num(k.treasury) - due);
                HolyWars.deposit(world, player, see, due, k.id);
            }
        }
        const over = _num(see.coffers) - _num(S.reserve, 3000);
        if (over > 0 && Number.isFinite(see.q)) {
            const s = _settlementAt(world, see.q, see.r);
            const spend = _r2(over * _num(S.spendShare, 0.06));
            const paid = s ? Economy.payTown(s, spend) : 0;
            see.coffers = _r2(see.coffers - paid);
        }
    },

    // ──────────── THE BAN ────────────

    /** The ban a realm's ruler lies under (in its own church's see), or null. */
    banOf(world, k) {
        const see = HolyWars.seeOfRealm(world, k);
        return see && see.bans[k.id] ? { see, ban: see.bans[k.id] } : null;
    },

    isBanned(world, kingdomId) {
        return !!HolyWars.banOf(world, _kingdom(world, kingdomId));
    },

    /** The bans on the player: personal, or on the realm they rule. → [{ see, ban, who }] */
    playerBans(player, world) {
        if (!player || !world) return [];
        const st = HolyWars.state(world);
        const k = _ruled(player, world);
        const out = [];
        for (const see of Object.values(st.sees)) {
            if (see.bans.player) out.push({ see, ban: see.bans.player, who: 'player' });
            if (k && see.bans[k.id] && see.key === HolyWars.keyOfRealm(k)) out.push({ see, ban: see.bans[k.id], who: k.id });
        }
        return out;
    },

    /** Is the player cast out of this faith (any of its rites)? */
    playerBannedFrom(player, world, faithId) {
        return HolyWars.playerBans(player, world).some(b => b.see.faithId === faithId);
    },

    /** Add to the see's grievance against a realm's ruler (kingdom id) or the player ('player'). */
    grievance(world, see, who, amount) {
        if (!see || who == null || !amount) return 0;
        see.grievance[who] = Math.max(0, _num(see.grievance[who]) + amount);
        return see.grievance[who];
    },

    /** The see of the faith the player keeps (their creed), or of the realm they rule. */
    playerSee(player, world) {
        const fid = HolyWars._playerFaith(player);
        if (!fid) return null;
        const k = _ruled(player, world);
        if (k && k.religion && k.religion.faithId === fid) return HolyWars.seeOfRealm(world, k);
        return HolyWars.see(world, HolyWars.keyOf(fid, 'orthodox')) || Object.values(HolyWars.state(world).sees).find(s => s.faithId === fid) || null;
    },

    _playerFaith(player) {
        const c = player ? Devotion.creed(player) : null;
        return c && c.id && c.id !== 'own' ? c.id : null;
    },

    /** The see's grievance against the player: on the realm they rule if it keeps the see, else on them. */
    playerGrievance(player, world, see, amount) {
        if (!see) return 0;
        const k = _ruled(player, world);
        const who = k && HolyWars.keyOfRealm(k) === see.key ? k.id : 'player';
        return HolyWars.grievance(world, see, who, amount);
    },

    _ban(world, player, see, who, reason, out) {
        if (!see || see.bans[who]) return null;
        const B = HolyWars.config().ban;
        const day = _day(world);
        const [lo, hi] = Array.isArray(B.aiPenanceWeeks) ? B.aiPenanceWeeks : [16, 60];
        see.bans[who] = { since: day, reason: reason || '', head: HolyWars.headLabel(see), penanceAt: day + 7 * Math.round(lo + (hi - lo) * _u(world, `pen|${see.key}|${who}|${day}`)) };
        see.grievance[who] = 0;
        const k = who === 'player' ? null : _kingdom(world, who);
        const why = reason ? ` for ${reason}` : '';
        const faith = Religion.FAITHS[see.faithId];
        const mine = who === 'player' || (player && k && _ruled(player, world) === k);
        if (k) {
            const text = HolyWars.text('banWorld', { head: HolyWars.headLabel(see), realm: Names.realm(k.name), why });
            HolyWars._log(world, { kind: 'ban', key: see.key, realm: k.id, text });
            if (Array.isArray(world.events)) world.events.push({ text: `🔔 ${text}`, type: 'religious', category: 'religious', kingdom: k.id });
            if (player && !mine && HolyWars._playerFaith(player) === see.faithId) out.notices.push({ icon: '🔔', title: 'A Ruler Cast Out', text, type: 'info' });
        }
        if (mine) {
            const text = HolyWars.text('banYou', { head: HolyWars.headLabel(see), faith: faith ? faith.name : 'the faith', why });
            Devotion._addStanding(player, see.faithId, _num(B.standing, -30));
            HolyWars._plog(player, world, text);
            if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} was cast out of ${faith ? faith.name : 'the faith'} by ${HolyWars.headLabel(see)}${why}.`, ['faith', 'ban']);
            out.notices.push({ icon: '🔔', title: 'Excommunicated', text, type: 'error' });
            Interrupts.raise(world, { reason: 'You are excommunicated', icon: '🔔', source: 'holyWars' });
        }
        return see.bans[who];
    },

    _lift(world, player, see, who, how, out) {
        if (!see || !see.bans[who]) return false;
        delete see.bans[who];
        see.grievance[who] = 0;
        const k = who === 'player' ? null : _kingdom(world, who);
        const mine = who === 'player' || (player && k && _ruled(player, world) === k);
        if (k) {
            const text = HolyWars.text('liftWorld', { head: HolyWars.headLabel(see), realm: Names.realm(k.name), how: how || '' });
            HolyWars._log(world, { kind: 'lift', key: see.key, realm: k.id, text });
            if (Array.isArray(world.events)) world.events.push({ text: `🕊️ ${text}`, type: 'religious', category: 'religious', kingdom: k.id });
        }
        if (mine && player) {
            Devotion._addStanding(player, see.faithId, _num(HolyWars.config().ban.liftStanding, 10));
            const text = `${HolyWars.headLabel(see)} lifts the ban on you${how || ''}. The faithful may know you again.`;
            HolyWars._plog(player, world, text);
            if (out) out.notices.push({ icon: '🕊️', title: 'The Ban Lifted', text, type: 'success' });
        }
        return true;
    },

    /** What lifting a ban costs: a crown's (its chests) or the player's (their purse). */
    banPrice(world, player, see, who) {
        const P = HolyWars.config().ban.price;
        const k = who === 'player' ? null : _kingdom(world, who);
        const base = _num(P.base, 400) + (k && !(player && _ruled(player, world) === k) ? Math.max(0, _num(k.treasury)) * _num(P.treasuryShare, 0.12)
            : Math.max(0, _num(player && player.gold)) * _num(P.purseShare, 0.15) + (k ? Math.max(0, _num(k.treasury)) * _num(P.treasuryShare, 0.12) * 0.5 : 0));
        return Math.round(Math.min(_num(P.max, 6000), base));
    },

    /** Another rite of the same faith (a schism's counter-pope), or null. */
    counterSee(world, see) {
        if (!see) return null;
        const st = HolyWars.state(world);
        return Object.values(st.sees).find(s => s.faithId === see.faithId && s.key !== see.key && HolyWars.flock(world, s.key).length) || null;
    },

    /** The see's grievances: a week's wrongs, decay, bans. AI heads only. */
    _grievanceWeek(world, player, see, out) {
        const B = HolyWars.config().ban;
        const seat = _kingdom(world, see.kingdomId);
        const auto = !HolyWars.playerHeads(player, see);
        for (const k of HolyWars.flock(world, see.key)) {
            if (k.id === see.kingdomId) continue;
            let g = _num(see.grievance[k.id]);
            if (_alive(seat) && _arr(k.wars).includes(seat.id)) g += _num(B.atWarSeat, 12);
            if (_num(k.religion.piety, 50) < _num(B.pietyFloor, 15)) g += _num(B.lowPiety, 4);
            if (Laws.value(world, k.id, 'heresy') === 'tolerance') g += _num(B.tolerance, 1.5);
            g *= 1 - _num(B.decay, 0.03);
            see.grievance[k.id] = Math.round(g * 10) / 10;
            if (auto && g >= _num(B.banAt, 100) && !see.bans[k.id]) {
                const why = _alive(seat) && _arr(k.wars).includes(seat.id) ? 'making war on the faithful' : _num(k.religion.piety, 50) < _num(B.pietyFloor, 15) ? 'faithlessness' : 'defying the Church';
                HolyWars._ban(world, player, see, k.id, why, out);
            }
        }
        for (const who of Object.keys(see.grievance)) {
            if (who !== 'player') { if (!_alive(_kingdom(world, who))) delete see.grievance[who]; continue; }
            const g = _num(see.grievance.player) * (1 - _num(B.decay, 0.03));
            see.grievance.player = Math.round(g * 10) / 10;
            if (auto && player && g >= _num(B.banAt, 100) && !see.bans.player) HolyWars._ban(world, player, see, 'player', 'defying the Church', out);
        }
        // Bans on realms gone, or on a realm that left the see's church
        for (const who of Object.keys(see.bans)) {
            if (who === 'player') { if (!player) delete see.bans.player; continue; }
            const k = _kingdom(world, who);
            if (!_alive(k) || HolyWars.keyOfRealm(k) !== see.key) delete see.bans[who];
        }
    },

    /** The AI crowns under the ban make their peace: penance and payment, or a counter-pope. */
    _aiAbsolution(world, player, see, day, out) {
        if (HolyWars.playerHeads(player, see)) return;
        const B = HolyWars.config().ban;
        const mine = _ruled(player, world);
        for (const who of Object.keys(see.bans)) {
            if (who === 'player') continue;
            const k = _kingdom(world, who);
            if (!_alive(k) || k === mine) continue;
            const ban = see.bans[who];
            if (day < _num(ban.penanceAt)) continue;
            const price = HolyWars.banPrice(world, null, see, who);
            if (_num(k.treasury) >= price * 1.5) {
                k.treasury = _r2(_num(k.treasury) - price);
                HolyWars.deposit(world, player, see, price, k.id);
                HolyWars._lift(world, player, see, who, `: its ruler came barefoot to ${see.town} and paid ${Utils.formatGold(price)} gold in penance`, out);
                continue;
            }
            const other = HolyWars.counterSee(world, see);
            if (other && _u(world, `cp|${see.key}|${who}|${day}`) < _num(B.counterPope, 0.04)) {
                HolyWars._turnToCounterPope(world, player, k, see, other, out);
            }
        }
    },

    /** A realm leaves its see for the other rite's: the ban is void in its eyes. */
    _turnToCounterPope(world, player, k, see, other, out) {
        k.religion.rite = other.rite;
        delete see.bans[k.id];
        see.grievance[k.id] = _num(HolyWars.config().ban.banAt, 100) * 0.5;
        // The old rite's faithful think the worse of it
        for (const o of HolyWars.flock(world, see.key)) {
            if (!o.relations) o.relations = {};
            o.relations[k.id] = Math.max(-100, _num(o.relations[k.id]) - 15);
            if (k.relations) k.relations[o.id] = Math.max(-100, _num(k.relations[o.id]) - 15);
        }
        const text = HolyWars.text('counterPope', { realm: Names.realm(k.name, true), head: HolyWars.headLabel(see), other: HolyWars.headLabel(other) });
        HolyWars._log(world, { kind: 'counterPope', key: see.key, realm: k.id, text });
        if (Array.isArray(world.events)) world.events.push({ text: `⛪ ${text}`, type: 'religious', category: 'religious', kingdom: k.id });
        if (player && _ruled(player, world) === k && out) out.notices.push({ icon: '⛪', title: 'The Other Rite', text, type: 'warning' });
        return text;
    },

    /** The realms' church standing, weekly: kingdom.church { stab, vassal, banned } (read by stability and the vassals). */
    _realmsWeek(world, player, day) {
        const A = HolyWars.config().answer;
        const B = HolyWars.config().ban;
        for (const k of world.kingdoms || []) {
            if (!_alive(k) || !k.religion) continue;
            const ch = _obj(k.church) || {};
            const b = HolyWars.banOf(world, k);
            let stab = 0;
            let vassal = 0;
            if (b) {
                stab += _num(B.stab, -12);
                vassal += _num(B.vassal, -25);
                k.religion.piety = _clamp(_num(k.religion.piety, 50) + _num(B.pietyWeekly, -0.6), 0, 100);
                // The faithful cool towards a ruler cast out, and break with him
                for (const o of HolyWars.flock(world, b.see.key)) {
                    if (o.id === k.id) continue;
                    for (const [x, y] of [[k, o], [o, k]]) {
                        if (!x.relations) x.relations = {};
                        const r = _num(x.relations[y.id]);
                        if (r > _num(B.relFloor, -60)) x.relations[y.id] = Math.max(_num(B.relFloor, -60), r + _num(B.relWeekly, -2));
                    }
                    if (_arr(k.allies).includes(o.id) && !KingdomAI.isPlayerRuled(o) && !KingdomAI.isPlayerRuled(k) && _u(world, `ally|${k.id}|${o.id}|${day}`) < _num(B.allianceBreak, 0.08)) {
                        k.allies = k.allies.filter(id => id !== o.id);
                        o.allies = _arr(o.allies).filter(id => id !== k.id);
                        if (Array.isArray(world.events)) world.events.push({ text: `${o.name} breaks its alliance with ${Names.realm(k.name)}, whose ruler lies under the ban.`, type: 'diplomatic' });
                    }
                }
            }
            if (_num(ch.refusedUntil) > day) { stab += _num(A.stabRefuse, -6); vassal += _num(A.vassalRefuse, -12); }
            if (_num(ch.answeredUntil) > day) { stab += _num(A.stabAnswer, 4); vassal += _num(A.vassalAnswer, 8); }
            if (stab || vassal || b || k.church) {
                k.church = { ...ch, stab, vassal, banned: !!b };
                if (!stab && !vassal && !b && !(ch.refusedUntil > day) && !(ch.answeredUntil > day)) delete k.church;
            }
        }
        // The player cast out: the faithful realms think the less of them
        if (player) {
            for (const { see } of HolyWars.playerBans(player, world)) {
                if (!player.reputation) player.reputation = {};
                for (const k of HolyWars.flock(world, see.key)) {
                    const r = _num(player.reputation[k.id]);
                    if (r > _num(B.repFloor, -40)) player.reputation[k.id] = Math.max(_num(B.repFloor, -40), r + _num(B.repWeekly, -1));
                }
            }
        }
    },

    // ──────────── HOLY WARS ────────────

    active(world) {
        return HolyWars.state(world).wars;
    },

    war(world, id) {
        return HolyWars.state(world).wars.find(w => w.id === id) || null;
    },

    /** The holy wars against a realm (as the foe). */
    against(world, kingdomId) {
        return HolyWars.state(world).wars.filter(w => w.target === kingdomId);
    },

    /** Those a see may call a holy war against: [{ k, casus, site, weight }]. */
    targets(world, see, opts = {}) {
        const C = HolyWars.config().call;
        if (!see) return [];
        const faithful = HolyWars.flock(world, see.key).filter(k => !see.bans[k.id]);
        if (!faithful.length) return [];
        const ids = new Set(faithful.map(k => k.id));
        const out = [];
        const day = _day(world);
        const st = HolyWars.state(world);
        // (a foe one holy war at a time — a second see joins that one instead: _joinCrusade;
        // a foe lately fought weighs less, so one realm is not the world's target every decade)
        const rest = _num(C.foeRestYears, 20) * YEAR;
        const add = (k, casus, site = null) => {
            if (!_alive(k) || k.id === see.kingdomId || out.some(o => o.k.id === k.id)) return;
            if (!opts.targeted && st.wars.some(w => w.target === k.id)) return;
            const lately = st.past.some(h => h.target === k.id && h.outcome !== 'unanswered' && day - _num(h.to) < rest);
            out.push({ k, casus, site, weight: _num(C.casus[casus], 1) * (lately ? _num(C.foeRestMult, 0.15) : 1) });
        };
        // Holy sites of the faith in other hands
        for (const k of world.kingdoms || []) {
            if (!_alive(k) || ids.has(k.id) || !k.religion) continue;
            for (const ref of _arr(k.religion.holySites)) {
                const t = world.getTile ? world.getTile(ref.q, ref.r) : null;
                if (t && t.holySite && t.holySite.faithId === see.faithId) { add(k, 'holySite', { q: ref.q, r: ref.r, name: t.holySite.name }); break; }
            }
        }
        // The other rite: heretics
        for (const k of world.kingdoms || []) {
            if (_alive(k) && k.religion && k.religion.faithId === see.faithId && !ids.has(k.id) && HolyWars.keyOfRealm(k) !== see.key) add(k, 'heretic');
        }
        // A ruler long under the ban
        for (const k of faithful.length ? HolyWars.flock(world, see.key) : []) {
            const b = see.bans[k.id];
            if (b && day - _num(b.since) >= _num(C.banYears, 1) * YEAR) add(k, 'excommunicate');
        }
        // The infidel at enmity with the faithful (a militant faith only)
        const faith = Religion.FAITHS[see.faithId];
        if (faith && _num(faith.virtues && faith.virtues.militancy) >= _num(C.infidelMinMilitancy, 1)) {
            for (const k of world.kingdoms || []) {
                if (!_alive(k) || !k.religion || k.religion.faithId === see.faithId) continue;
                if (faithful.some(f => _num(f.relations && f.relations[k.id]) <= _num(C.infidelRelation, -30) || _arr(f.wars).includes(k.id))) add(k, 'infidel');
            }
        }
        // (the player's realm can be a target; a realm the player rules as High Priest's seat never)
        return out.filter(o => faithful.some(f => f.id !== o.k.id));
    },

    _casusText(world, war) {
        const holder = _kingdom(world, war.target);
        return HolyWars.text(`casus.${war.casus}`, { site: war.site ? war.site.name : 'holy site', holder: holder ? Names.realm(holder.name) : 'the infidel', target: holder ? Names.realm(holder.name, true) : 'the foe' });
    },

    /**
     * Call a holy war (the see's head: the AI, or the player as High Priest).
     * → the war record, or null.
     */
    call(world, player, see, target, casus, site = null, out = { notices: [] }) {
        const C = HolyWars.config();
        const day = _day(world);
        if (!see || !_alive(target)) return null;
        const st = HolyWars.state(world);
        const invited = HolyWars.flock(world, see.key).filter(k => k.id !== target.id && !see.bans[k.id]).map(k => k.id);
        if (!invited.length) return null;
        const years = _range(world, `years|${see.key}|${day}`, C.call.warYears, [2, 4]);
        const war = {
            id: st.n++, seeKey: see.key, faithId: see.faithId, rite: see.rite, head: HolyWars.headLabel(see), byPlayer: HolyWars.playerHeads(player, see),
            called: day, phase: 'call', answerBy: day + _num(C.call.answerDays, 40), until: day + _num(C.call.answerDays, 40) + Math.round(years * YEAR),
            target: target.id, targetName: target.name, casus, site, invited, answered: [], refused: [], members: [],
            resolve: _num(C.war.resolve, 100), towns0: _townsOf(world, target).map(s => ({ q: s.q, r: s.r, name: s.name })), gained: [], subsidies: 0, crusaders: [],
            playerAnswer: null,
        };
        war.name = `the Holy War against ${Names.realm(target.name)}`;
        st.wars.push(war);
        see.lastCall = day;
        st.nextAny = day + Math.round(_range(world, `any|${war.id}`, C.call.worldGapYears, [8, 14]) * YEAR);
        const casusText = HolyWars._casusText(world, war);
        const text = HolyWars.text('callWorld', { icon: CASUS_ICON[casus] || '⛪', head: war.head, target: Names.realm(target.name), casus: casusText });
        HolyWars._log(world, { kind: 'call', war: war.id, key: see.key, text });
        if (Array.isArray(world.events)) world.events.push({ text, type: 'religious', category: 'religious', kingdom: target.id });
        if (player) {
            const mine = _ruled(player, world);
            if (mine && mine.id === target.id) {
                out.notices.push({ icon: '⚔️', title: 'A Holy War Against You', text: HolyWars.text('callYou', { head: war.head, target: Names.realm(target.name), casus: casusText }), type: 'error' });
                Interrupts.raise(world, { reason: 'A holy war is called against your realm', icon: '⚔️', source: 'holyWars' });
            } else if ((mine && invited.includes(mine.id)) || HolyWars._playerFaith(player) === see.faithId) {
                out.notices.push({ icon: '⛪', title: 'A Holy War Is Called', text: HolyWars.text('callPlayer', { head: war.head, target: Names.realm(target.name), casus: casusText, days: _num(C.call.answerDays, 40) }), type: 'warning' });
                if (mine && invited.includes(mine.id)) Interrupts.raise(world, { reason: 'The Church calls your realm to a holy war', icon: '⛪', source: 'holyWars' });
            }
        }
        // The see's own realm answers at once (unless it is the player's to answer)
        const seat = _kingdom(world, see.kingdomId);
        if (_alive(seat) && invited.includes(seat.id) && !(player && _ruled(player, world) === seat) && HolyWars.answerWill(world, war, seat) > 0) HolyWars._join(world, player, war, seat, out);
        return war;
    },

    /** The AI heads weigh their calls. */
    _aiCalls(world, player, see, day, out) {
        const C = HolyWars.config().call;
        if (HolyWars.playerHeads(player, see)) return;
        const st = HolyWars.state(world);
        if (st.wars.some(w => w.seeKey === see.key || _arr(w.joint).includes(see.key))) return;
        const week = Math.floor(day / 7);
        if (week % Math.max(1, _num(C.everyWeeks, 4)) !== 0) return;
        // Another see's call against a foe this one has its own cause against: a joint crusade
        if (HolyWars._joinCrusade(world, player, see, out)) return;
        if (day < _num(see.nextCall)) return;
        // (the world's holy wars come years apart: st.nextAny, set by every call)
        if (st.wars.length >= _num(C.maxActive, 2) || day < _num(st.nextAny)) return;
        const faith = Religion.FAITHS[see.faithId];
        const chance = _num(C.chance, 0.05) * (1 + _num(faith && faith.virtues && faith.virtues.militancy) * _num(C.militancyMult, 0.35));
        if (_u(world, `call|${see.key}|${week}`) >= chance) return;
        // A head sounds out the crowns before he calls: a cause no one would fight for waits
        const cands = HolyWars.targets(world, see).filter(c => HolyWars.support(world, see, c.k, player) >= _num(C.minSupport, 0));
        if (!cands.length) { see.nextCall = day + Math.round(_num(C.noSupportYears, 1) * YEAR); return; }
        const total = cands.reduce((s, c) => s + c.weight, 0);
        let roll = _u(world, `callPick|${see.key}|${week}`) * total;
        let pick = cands[cands.length - 1];
        for (const c of cands) { roll -= c.weight; if (roll <= 0) { pick = c; break; } }
        HolyWars.call(world, player, see, pick.k, pick.casus, pick.site, out);
    },

    /**
     * The support a call would find: the sum of the AI crowns' will to answer
     * (answerWill) among the see's faithful (the player's crown not counted:
     * no one can tell what it will say).
     */
    support(world, see, target, player = null) {
        if (!see || !target) return 0;
        const mine = _ruled(player, world);
        const probe = { faithId: see.faithId, target: target.id };
        let sum = 0;
        for (const k of HolyWars.flock(world, see.key)) {
            if (k.id === target.id || see.bans[k.id] || (mine && mine.id === k.id)) continue;
            sum += HolyWars.answerWill(world, probe, k);
        }
        return Math.round(sum * 100) / 100;
    },

    /**
     * A joint crusade: while another see's holy war is being called against a
     * foe this see has a cause against too, its head may (jointChance, once a
     * war) bless that war rather than call his own — his faithful crowns are
     * summoned to it, his seat answers at once. A foe is the target of one
     * holy war at a time; this is the only way more than one see fights it.
     */
    _joinCrusade(world, player, see, out) {
        const C = HolyWars.config().call;
        const st = HolyWars.state(world);
        for (const war of st.wars) {
            if (war.phase !== 'call' || war.seeKey === see.key) continue;
            if (!Array.isArray(war.joint)) war.joint = [];
            if (!Array.isArray(war.jointAsked)) war.jointAsked = [];
            if (war.jointAsked.includes(see.key)) continue;
            war.jointAsked.push(see.key);
            if (!HolyWars.targets(world, see, { targeted: true }).some(c => c.k.id === war.target)) continue;
            if (_u(world, `joint|${see.key}|${war.id}`) >= _num(C.jointChance, 0.5)) continue;
            const target = _kingdom(world, war.target);
            const more = HolyWars.flock(world, see.key).filter(k => k.id !== war.target && !see.bans[k.id] && !war.invited.includes(k.id)).map(k => k.id);
            if (!_alive(target) || !more.length) continue;
            war.joint.push(see.key);
            war.invited.push(...more);
            // (the newly summoned decide by the call's end: a week's grace for the last of them)
            war.answerBy = Math.max(war.answerBy, _day(world) + 7);
            see.lastCall = _day(world);
            const text = HolyWars.text('joint', { head: HolyWars.headLabel(see), target: Names.realm(target.name), other: war.head });
            HolyWars._log(world, { kind: 'joint', war: war.id, key: see.key, text });
            if (Array.isArray(world.events)) world.events.push({ text: `✝️ ${text}`, type: 'religious', category: 'religious', kingdom: target.id });
            if (player && out && (HolyWars._playerFaith(player) === see.faithId || (_ruled(player, world) && more.includes(_ruled(player, world).id)))) out.notices.push({ icon: '✝️', title: 'A Joint Crusade', text, type: 'warning' });
            const seat = _kingdom(world, see.kingdomId);
            if (_alive(seat) && more.includes(seat.id) && !(player && _ruled(player, world) === seat) && HolyWars.answerWill(world, war, seat) > 0) HolyWars._join(world, player, war, seat, out);
            return true;
        }
        return false;
    },

    /** The see a crown answers to in a war: its own where its see joined the crusade, else the calling see. */
    _seeFor(world, war, k) {
        const key = HolyWars.keyOfRealm(k);
        return key && _arr(war.joint).includes(key) ? HolyWars.see(world, key) : HolyWars.see(world, war.seeKey);
    },

    /** How willing an AI crown is to answer (0..1). */
    answerWill(world, war, k) {
        const A = HolyWars.config().answer;
        if (_arr(k.wars).length >= _num(A.maxWars, 2) && !_arr(k.wars).includes(war.target)) return 0;
        const faith = Religion.FAITHS[(k.religion && k.religion.faithId) || war.faithId];
        const target = _kingdom(world, war.target);
        // The limits every aggressor keeps (KingdomAI.mayOpenWar): a truce honoured, and
        // a foe already beset by maxWarsOn + 1 (a crusade may bring one more than a lone
        // realm) is left to them — the faithful don't pile on without end
        if (target && !_arr(k.wars).includes(target.id)
            && !KingdomAI.mayOpenWar(k, target, world, { rested: false, founding: false, beset: false, maxOn: _num(A.maxOnFoe, KingdomAI.WAR.maxWarsOn + 1) })) return 0;
        let p = _num(A.base, 0.25) + _num(k.religion && k.religion.piety, 50) * _num(A.perPiety, 0.006)
            + _num(faith && faith.virtues && faith.virtues.militancy) * _num(A.perMilitancy, 0.08)
            + LordInfluence.lean(k, 'honor') * _num(A.honour, 0.06)
            - _arr(k.wars).filter(id => id !== war.target).length * _num(A.atWar, 0.2);
        if (target && k.relations) p += Math.max(-0.2, Math.min(0.2, -_num(k.relations[target.id]) / 300));
        if (_arr(k.allies).includes(war.target)) p -= 0.35;
        const d = target && target.capital && k.capital ? _dist(world, k.capital, target.capital) : 30;
        p *= Math.max(_num(A.farFloor, 0.25), 1 - d / _num(A.farDistance, 70));
        return _clamp(p, 0, 0.95);
    },

    /** A crown takes up the cross: its war, its oath, the see's subsidy. */
    _join(world, player, war, k, out) {
        const C = HolyWars.config();
        const target = _kingdom(world, war.target);
        if (!_alive(target) || war.members.includes(k.id)) return false;
        // Its quarrels with fellow crusaders end first
        for (const id of war.members) {
            const m = _kingdom(world, id);
            if (_alive(m) && _arr(k.wars).includes(m.id)) KingdomAI.endWar(k, m, world, { text: `🕊️ ${k.name} and ${m.name} lay down their quarrel for the holy war.` });
        }
        if (!Array.isArray(k.wars)) k.wars = [];
        if (!k.wars.includes(target.id)) Utils.withRng(_rng(world, `war|${war.id}|${k.id}`), () => KingdomAI.startWar(k, target, world));
        KingdomAI.swearWar(k, target, world, war.until);
        war.members.push(k.id);
        if (!war.answered.includes(k.id)) war.answered.push(k.id);
        war.refused = war.refused.filter(id => id !== k.id);
        k.religion.piety = _clamp(_num(k.religion.piety, 50) + _num(C.answer.pietyAnswer, 6), 0, 100);
        k.church = { ...(_obj(k.church) || {}), answeredUntil: _day(world) + _num(C.answer.stabDays, 240) };
        // The see's subsidy: coin from its coffers to the crusader's chests
        const see = HolyWars._seeFor(world, war, k);
        if (see && !war.byPlayer) {
            const pay = HolyWars.withdraw(world, see, Math.min(_num(C.call.subsidyCap, 2500), _num(see.coffers) * _num(C.call.subsidyShare, 0.25)));
            if (pay > 0) {
                k.treasury = _r2(_num(k.treasury) + pay);
                if (see.kingdomId !== k.id) MoneySupply.transfer(world, see.kingdomId, k.id, pay, 'church');
                war.subsidies = _r2(_num(war.subsidies) + pay);
            }
        }
        HolyWars._rivalsTakeCross(world, player, war, k, out);
        const text = HolyWars.text('joined', { realm: Names.realm(k.name, true), target: Names.realm(target.name) });
        HolyWars._log(world, { kind: 'joined', war: war.id, key: war.seeKey, realm: k.id, text });
        if (Array.isArray(world.events)) world.events.push({ text: `✝️ ${text}`, type: 'military', category: 'MILITARY' });
        if (player && _ruled(player, world) && _ruled(player, world).id === war.target && out) out.notices.push({ icon: '⚔️', title: 'A Crusader Comes', text, type: 'warning' });
        return true;
    },

    _refuse(world, player, war, k, out) {
        const C = HolyWars.config();
        if (war.refused.includes(k.id) || war.members.includes(k.id)) return;
        war.refused.push(k.id);
        k.religion.piety = _clamp(_num(k.religion.piety, 50) + _num(C.answer.pietyRefuse, -6), 0, 100);
        k.church = { ...(_obj(k.church) || {}), refusedUntil: _day(world) + _num(C.answer.stabDays, 240) };
        const see = HolyWars._seeFor(world, war, k);
        if (see && !war.byPlayer) HolyWars.grievance(world, see, k.id, _num(C.answer.refuseGrievance, 35));
        HolyWars._log(world, { kind: 'refused', war: war.id, key: war.seeKey, realm: k.id, text: HolyWars.text('refused', { realm: Names.realm(k.name, true) }) });
    },

    /** The faithful crowns answer through the call's weeks; at its end the war stands or comes to nothing. */
    _callWeek(world, player, war, day, out) {
        const mine = _ruled(player, world);
        for (const id of war.invited) {
            if (war.answered.includes(id) || war.refused.includes(id)) continue;
            const k = _kingdom(world, id);
            if (!_alive(k)) continue;
            if (mine && mine.id === id) continue; // the player's crown answers by the player's word
            const decide = war.called + Math.floor(_u(world, `dec|${war.id}|${id}`) * Math.max(1, war.answerBy - war.called));
            if (day < decide && day < war.answerBy) continue;
            if (_u(world, `ans|${war.id}|${id}`) < HolyWars.answerWill(world, war, k)) HolyWars._join(world, player, war, k, out);
            else HolyWars._refuse(world, player, war, k, out);
        }
        if (day < war.answerBy) return;
        // The player's crown never answered: a refusal
        if (mine && war.invited.includes(mine.id) && !war.answered.includes(mine.id) && !war.refused.includes(mine.id)) {
            HolyWars._refuse(world, player, war, mine, out);
            HolyWars._playerRefused(world, player, war, out, true);
        }
        war.phase = 'war';
        if (!war.members.length) HolyWars._end(world, player, war, war.answered.length ? 'defeat' : 'unanswered', out);
    },

    /** A week of a holy war: who is still in it, the towns taken, the resolve. */
    _warWeek(world, player, war, day, out) {
        const C = HolyWars.config().war;
        const target = _kingdom(world, war.target);
        if (!_alive(target)) return HolyWars._end(world, player, war, 'victory', out);
        let yielded = false;
        for (const id of war.members.slice()) {
            const m = _kingdom(world, id);
            if (_alive(m) && _arr(m.wars).includes(target.id)) continue;
            // (the foe, its last town about to fall, capitulated to this crusader: KingdomAI._capitulates)
            if (_alive(m) && _arr(world.warHistory).some(h => h.victor === id && day - _num(h.day) <= 7 && ((h.a === id && h.b === target.id) || (h.b === id && h.a === target.id)))) { yielded = true; continue; }
            war.members = war.members.filter(x => x !== id);
            war.resolve = _num(war.resolve) + _num(C.memberOut, -20);
        }
        if (yielded) return HolyWars._end(world, player, war, 'victory', out);
        if (war.phase === 'war' && !war.members.length) return HolyWars._end(world, player, war, 'defeat', out);
        if (!war.members.length) return null;
        // Towns of the foe now flying a crusader's banner
        const ids = new Set(war.members.concat(war.answered));
        war.gained = war.towns0.filter(t => { const s = _settlementAt(world, t.q, t.r); return s && ids.has(s.kingdom); }).map(t => t.name);
        let siteTaken = false;
        if (war.casus === 'holySite' && war.site) {
            const t = world.getTile ? world.getTile(war.site.q, war.site.r) : null;
            siteTaken = !!(t && t.holySite && ids.has(t.holySite.controller));
        }
        const ours = war.members.reduce((s, id) => s + _num((_kingdom(world, id) || {}).military), 0);
        war.resolve = _num(war.resolve) + _num(C.weekly, -1.2) * (_num(target.military) > ours ? _num(C.outweighed, 1.5) : 1);
        // Towns win it only when enough of the foe's fell (a share of a great realm, at least
        // victoryTowns) and the war has run minDays: a holy war is a campaign, not a raid.
        // The holy site retaken or the foe fallen ends it at once.
        const need = HolyWars.townsToWin(war);
        if (siteTaken || (war.gained.length >= need && day - _num(war.answerBy, war.called) >= _num(C.minDays, 0))) return HolyWars._end(world, player, war, 'victory', out);
        if (war.resolve <= 0 || day >= war.until) return HolyWars._end(world, player, war, war.gained.length ? 'victory' : 'defeat', out);
        return null;
    },

    /** The foe's towns that must fall to win: victoryShare of what it held when called, at least victoryTowns. */
    townsToWin(war) {
        const C = HolyWars.config().war;
        const n = _arr(war && war.towns0).length;
        return Math.max(1, Math.min(n || 1, Math.max(_num(C.victoryTowns, 2), Math.ceil(n * _num(C.victoryShare, 0)))));
    },

    /** The holy war ends: peace through the realms' machinery, the record, the crusaders' reward. */
    _end(world, player, war, outcome, out) {
        const C = HolyWars.config();
        const st = HolyWars.state(world);
        const day = _day(world);
        const target = _kingdom(world, war.target);
        const see = HolyWars.see(world, war.seeKey);
        const win = outcome === 'victory';
        if (_alive(target)) {
            for (const id of war.members) {
                const m = _kingdom(world, id);
                if (!_alive(m) || !_arr(m.wars).includes(target.id)) continue;
                // (the oath is spent: the war may end)
                if (m.warState && m.warState[target.id]) m.warState[target.id].sworn = 0;
                if (target.warState && target.warState[m.id]) target.warState[m.id].sworn = 0;
                KingdomAI.endWar(m, target, world, { victor: win ? m : target, tribute: _num(C.war.tribute, 0.25), text: win ? `🕊️ ${target.name} submits to ${m.name} and the faith.` : `🕊️ ${m.name} goes home from the holy war against ${target.name}.` });
            }
        }
        for (const id of war.answered) {
            const m = _kingdom(world, id);
            if (_alive(m) && m.religion) m.religion.piety = _clamp(_num(m.religion.piety, 50) + (win ? _num(C.war.victoryPiety, 8) : _num(C.war.defeatPiety, -8)), 0, 100);
        }
        // A vanquished heretic returns to the see's rite; a ruler under the ban submits
        if (win && _alive(target) && see) {
            if (war.casus === 'heretic' && target.religion && target.religion.faithId === see.faithId) {
                if (see.rite === 'orthodox') delete target.religion.rite; else target.religion.rite = see.rite;
            }
            if (war.casus === 'excommunicate' && see.bans[target.id]) HolyWars._lift(world, player, see, target.id, ', the realm having submitted', out);
        }
        const gains = war.gained.length ? `; ${war.gained.length === 1 ? 'the town' : 'the towns'} of ${war.gained.slice(0, 4).join(', ')}${war.gained.length > 4 ? ' and more' : ''} taken` : '';
        const memberNames = war.answered.map(id => (_kingdom(world, id) || {}).name).filter(Boolean);
        const text = outcome === 'unanswered'
            ? HolyWars.text('unanswered', { head: war.head, target: Names.realm(war.targetName) })
            : HolyWars.text(win ? 'victory' : 'defeat', { target: Names.realm(war.targetName), gains });
        st.past.unshift({ id: war.id, name: war.name, seeKey: war.seeKey, faithId: war.faithId, head: war.head, target: war.target, targetName: war.targetName, casus: war.casus, site: war.site, from: war.called, to: day, outcome, members: memberNames, gained: war.gained.slice(), crusaders: war.crusaders.slice(), subsidies: war.subsidies });
        if (st.past.length > 40) st.past.length = 40;
        HolyWars._log(world, { kind: 'end', war: war.id, key: war.seeKey, outcome, text });
        if (Array.isArray(world.events)) world.events.push({ text: `${win ? '✝️' : '🏳️'} ${text}`, type: 'military', category: 'MILITARY' });
        st.wars = st.wars.filter(w => w !== war);
        if (see) see.nextCall = day + Math.round(_range(world, `gap|${war.id}`, C.call.gapYears, [4, 8]) * YEAR);
        // The rulers who fought it to the end hailed Knights of the Cross; the rival Houses come home
        if (win) HolyWars._knightLords(world, war);
        HolyWars._rivalsHome(world, player, war, win, out);
        // The player's part
        if (player) {
            const p = HolyWars.pstate(player);
            const mine = _ruled(player, world);
            if (mine && war.answered.includes(mine.id) && win && player.house) {
                House.award(player.house, _num(C.answer.victoryPrestige, 60), 'holy war won', day);
                House._chronicle(player.house, world, `${Names.realm(mine.name, true)} fought in ${war.name}, won${gains}.`, ['war', 'faith', 'crusade']);
            }
            if (mine && mine.id === war.target && player.house) House._chronicle(player.house, world, `${war.name} against ${Names.realm(mine.name)} ended in ${win ? 'defeat for the realm' : 'the crusaders going home'}${gains}.`, ['war', 'faith']);
            if (p.cross && p.cross.warId === war.id) {
                if (p.cross.arrived != null && outcome !== 'unanswered') HolyWars._fulfil(world, player, war, out);
                else HolyWars._release(world, player, war, out);
            }
            if (p.atWar.includes(war.target)) {
                if (RealmWars.atWarWith(player, war.target)) RealmWars.endWar(player, world, war.target, 'holy war over');
                p.atWar = p.atWar.filter(id => id !== war.target);
            }
            // Served under the cross in a holy war won: a Knight of the Cross
            if (win && _arr(p.served).includes(war.id)) HolyWars._knightPlayer(world, player, war, out);
            const touched = (mine && (war.answered.includes(mine.id) || mine.id === war.target)) || war.crusaders.includes(player.name || 'you') || HolyWars._playerFaith(player) === war.faithId;
            if (touched && out) out.notices.push({ icon: win ? '✝️' : '🏳️', title: win ? 'The Holy War Won' : outcome === 'unanswered' ? 'The Call Unanswered' : 'The Holy War Lost', text, type: win ? 'success' : 'info' });
        }
        return outcome;
    },

    // ──────────── THE PLAYER'S CROWN ────────────

    /** Calls the realm the player rules is invited to answer. */
    invitations(player, world) {
        const k = _ruled(player, world);
        if (!k) return [];
        return HolyWars.state(world).wars.filter(w => w.phase === 'call' && w.invited.includes(k.id) && !w.answered.includes(k.id) && !w.refused.includes(k.id));
    },

    /** The player's crown answers a call (yes) or refuses it. */
    answer(player, world, warId, yes) {
        const C = HolyWars.config().answer;
        const war = HolyWars.war(world, warId);
        const k = _ruled(player, world);
        if (!war || !k || !war.invited.includes(k.id)) return { success: false, reason: 'Your crown was not called to this war.' };
        if (war.answered.includes(k.id) || war.refused.includes(k.id)) return { success: false, reason: 'Your crown has already answered.' };
        const out = { notices: [] };
        if (yes) {
            if (!HolyWars._join(world, player, war, k, out)) return { success: false, reason: 'The war cannot be joined.' };
            Devotion._addStanding(player, war.faithId, _num(C.standingAnswer, 6));
            if (player.house) {
                House.award(player.house, _num(C.prestigeAnswer, 25), 'answered the holy war', _day(world));
                House._chronicle(player.house, world, `${Names.realm(k.name, true)} answered the call to ${war.name}.`, ['war', 'faith', 'crusade']);
            }
            war.playerAnswer = 'yes';
            const text = `${Names.realm(k.name, true)} takes up the cross against ${Names.realm(war.targetName)}. Your lords are glad of it, the faithful gladder; the war is sworn until day ${war.until}.`;
            HolyWars._plog(player, world, text);
            return { success: true, text };
        }
        HolyWars._refuse(world, player, war, k, out);
        HolyWars._playerRefused(world, player, war, out, false);
        const text = `You refuse ${war.head}. Your realm's piety and its lords' regard suffer; the see will remember.`;
        return { success: true, text };
    },

    _playerRefused(world, player, war, out, silent) {
        const C = HolyWars.config().answer;
        war.playerAnswer = 'no';
        Devotion._addStanding(player, war.faithId, _num(C.standingRefuse, -10));
        HolyWars._plog(player, world, `Refused the call to ${war.name}.`);
        if (silent && out) out.notices.push({ icon: '⛪', title: 'The Call Unanswered', text: `Your crown never answered ${war.head}'s call to ${war.name}. The Church counts it a refusal.`, type: 'warning' });
    },

    // ──────────── THE CROSS ────────────

    /** The holy wars the player may take the cross for: [{ war, ok, reason }]. */
    crossOptions(player, world) {
        const fid = HolyWars._playerFaith(player);
        const p = HolyWars.pstate(player);
        const mine = _ruled(player, world);
        return HolyWars.state(world).wars.filter(w => w.faithId === fid).map(war => {
            let reason = null;
            if (p.cross) reason = 'You are already under a vow.';
            else if (HolyWars.playerBannedFrom(player, world, war.faithId)) reason = 'The Church will not take the vow of one cast out.';
            else if (mine && mine.id === war.target) reason = 'This holy war is against your own realm.';
            else if (war.crusaders.includes(player.name || 'you')) reason = 'You have already served in this war.';
            return { war, ok: !reason, reason };
        });
    },

    /** The muster for a war: the crusaders' town nearest the foe's capital (else the see's seat). */
    musterOf(world, war) {
        const target = _kingdom(world, war.target);
        const goal = (target && target.capital) || (war.towns0[0] || null);
        let best = null;
        let bd = Infinity;
        for (const id of war.members.length ? war.members : war.invited) {
            for (const s of _townsOf(world, _kingdom(world, id))) {
                const d = _dist(world, s, goal);
                if (d < bd) { bd = d; best = s; }
            }
        }
        if (best) return { q: best.q, r: best.r, town: best.name };
        const see = HolyWars.see(world, war.seeKey);
        return see && Number.isFinite(see.q) ? { q: see.q, r: see.r, town: see.town } : null;
    },

    takeCross(player, world, warId) {
        const C = HolyWars.config().cross;
        const opt = HolyWars.crossOptions(player, world).find(o => o.war.id === warId);
        if (!opt) return { success: false, reason: 'There is no such holy war of your faith.' };
        if (!opt.ok) return { success: false, reason: opt.reason };
        const war = opt.war;
        const muster = HolyWars.musterOf(world, war);
        if (!muster) return { success: false, reason: 'There is nowhere to muster.' };
        const day = _day(world);
        const p = HolyWars.pstate(player);
        p.cross = { warId: war.id, target: war.target, targetName: war.targetName, faithId: war.faithId, seeKey: war.seeKey, taken: day, muster, by: day + _num(C.musterDays, 100), arrived: null, served: 0 };
        Devotion._addStanding(player, war.faithId, _num(C.takeStanding, 4));
        const text = HolyWars.text('crossTaken', { target: Names.realm(war.targetName), town: muster.town, by: p.cross.by });
        HolyWars._plog(player, world, text);
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} took the cross against ${Names.realm(war.targetName)}.`, ['faith', 'crusade']);
        return { success: true, text };
    },

    /** Does the cross shield the player's lands from this realm (a crown of the faith, not the foe)? */
    shields(player, k) {
        const c = player && player.holyWars && player.holyWars.cross;
        return !!(c && k && k.religion && k.religion.faithId === c.faithId && k.id !== c.target);
    },

    _crossDay(world, player, day, out) {
        const p = HolyWars.pstate(player);
        const c = p.cross;
        if (!c) return;
        const C = HolyWars.config().cross;
        const war = HolyWars.war(world, c.warId);
        if (!war) { p.cross = null; return; }
        const here = { q: player.q, r: player.r };
        if (c.arrived == null) {
            if (_dist(world, here, c.muster) <= _num(C.musterRange, 3)) {
                c.arrived = day;
                const target = _kingdom(world, war.target);
                if (_alive(target) && !RealmWars.atWarWith(player, target.id)) {
                    RealmWars.declareWar(player, world, target, 'holy war');
                    if (!p.atWar.includes(target.id)) p.atWar.push(target.id);
                }
                const text = HolyWars.text('mustered', { town: c.muster.town, target: Names.realm(war.targetName) });
                HolyWars._plog(player, world, text);
                out.notices.push({ icon: '✝️', title: 'At the Muster', text, type: 'info' });
            } else if (day > c.by) {
                HolyWars._breakVow(world, player, war, out);
            }
            return;
        }
        let near = _dist(world, here, c.muster) <= _num(C.frontRange, 5);
        if (!near) for (const t of war.towns0) { if (_dist(world, here, t) <= _num(C.frontRange, 5)) { near = true; break; } }
        if (near) c.served++;
        if (c.served >= _num(C.serveDays, 40)) HolyWars._fulfil(world, player, war, out);
    },

    /** The vow kept: remission of sins, the faith's thanks, a crusader's name. */
    _fulfil(world, player, war, out) {
        const C = HolyWars.config().cross;
        const p = HolyWars.pstate(player);
        const day = _day(world);
        const remit = [];
        // The crowns' charges in the faith's realms
        let lifted = 0;
        for (const k of world.kingdoms || []) {
            if (!k || !k.religion || k.religion.faithId !== war.faithId) continue;
            const rec = Wanted.realm(player, k.id);
            if (!rec) continue;
            const before = _num(rec.lesser) + _num(rec.grave);
            rec.lesser = Math.round(_num(rec.lesser) * _num(C.lesserKeep, 0));
            rec.grave = Math.round(_num(rec.grave) * _num(C.graveKeep, 0.4));
            for (const [label, ch] of Object.entries(rec.charges || {})) if (!ch.grave && !(rec.lesser > 0)) delete rec.charges[label];
            if (!(rec.lesser + rec.grave > 0)) { rec.posted = false; rec.charges = {}; }
            lifted += before - (rec.lesser + rec.grave);
        }
        if (lifted > 0) remit.push(`${Utils.formatGold(Math.round(lifted))}g of bounties lifted`);
        const a = player.atrocities;
        if (_obj(a) && (_num(a.butcher) > 0 || _num(a.perfidy) > 0)) {
            Atrocities.state(player);
            a.butcher = Math.round(_num(a.butcher) * _num(C.butcherKeep, 0.5) * 1000) / 1000;
            a.perfidy = Math.round(_num(a.perfidy) * _num(C.perfidyKeep, 0.6) * 1000) / 1000;
            remit.push('your dark deeds half forgotten');
        }
        player.karma = Math.min(100, _num(player.karma) + _num(C.karma, 12));
        remit.push(`karma +${_num(C.karma, 12)}`);
        Devotion._addStanding(player, war.faithId, _num(C.standing, 18));
        if (!player.reputation) player.reputation = {};
        for (const k of world.kingdoms || []) if (_alive(k) && k.religion && k.religion.faithId === war.faithId && k.id !== war.target) player.reputation[k.id] = Math.min(100, _num(player.reputation[k.id]) + _num(C.reputation, 8));
        if (player.house) {
            House.award(player.house, _num(C.prestige, 70), 'crusade', day);
            House._chronicle(player.house, world, `${player.name || 'The head of the House'} served in ${war.name} and was granted remission of sins.`, ['faith', 'crusade', 'war']);
        }
        p.crusades++;
        if (!Array.isArray(p.served)) p.served = [];
        if (!p.served.includes(war.id)) p.served.unshift(war.id);
        if (p.served.length > 12) p.served.length = 12;
        // The crusading crowns' rulers remember who rode with them
        const dd = NPCLords.deedDef('crusader');
        for (const id of war.answered) {
            const m = _kingdom(world, id);
            if (_alive(m) && m.lord) NPCLords.rememberDeed(world, m.lord, 'crusader', { weight: dd ? Math.round(dd.weight * _num(HolyWars.config().knight.servedDeed, 0.5)) : undefined, note: war.name });
        }
        p.past.unshift({ warId: war.id, name: war.name, taken: p.cross ? p.cross.taken : day, done: day, how: 'fulfilled' });
        if (p.past.length > 12) p.past.length = 12;
        p.cross = null;
        war.crusaders.push(player.name || 'you');
        const text = HolyWars.text('fulfilled', { remit: remit.join(', ') });
        HolyWars._plog(player, world, text);
        if (out) out.notices.push({ icon: '✝️', title: 'The Vow Fulfilled', text, type: 'success' });
    },

    _release(world, player, war, out) {
        const p = HolyWars.pstate(player);
        if (!p.cross) return;
        p.past.unshift({ warId: war.id, name: war.name, taken: p.cross.taken, done: _day(world), how: 'released' });
        if (p.past.length > 12) p.past.length = 12;
        p.cross = null;
        const text = HolyWars.text('released', { target: Names.realm(war.targetName) });
        HolyWars._plog(player, world, text);
        if (out) out.notices.push({ icon: '✝️', title: 'Released from the Vow', text, type: 'info' });
    },

    _breakVow(world, player, war, out) {
        const B = HolyWars.config().cross.broken;
        const p = HolyWars.pstate(player);
        const c = p.cross;
        Devotion._addStanding(player, war.faithId, _num(B.standing, -25));
        player.karma = Math.max(-100, _num(player.karma) + _num(B.karma, -10));
        if (player.house) {
            House.spend(player.house, Math.min(_num(player.house.prestige), _num(B.prestige, 40)), 'a broken crusader vow', _day(world));
            House._chronicle(player.house, world, `${player.name || 'The head of the House'} broke a crusader's vow.`, ['faith', 'crusade']);
        }
        const see = HolyWars.see(world, war.seeKey);
        if (see && !war.byPlayer) HolyWars.playerGrievance(player, world, see, _num(B.grievance, 30));
        p.past.unshift({ warId: war.id, name: war.name, taken: c ? c.taken : _day(world), done: _day(world), how: 'broken' });
        if (p.past.length > 12) p.past.length = 12;
        p.cross = null;
        const text = HolyWars.text('broken', { town: c ? c.muster.town : 'the muster', target: Names.realm(war.targetName) });
        HolyWars._plog(player, world, text);
        if (out) out.notices.push({ icon: '💔', title: 'A Broken Vow', text, type: 'error' });
    },

    // ──────────── CRUSADERS' HONOURS ────────────
    // Whoever takes the cross and fights a holy war to victory is hailed a
    // Knight of the Cross: the player (a vow fulfilled in a war won), the
    // rulers whose crowns were still in the field at its end (kingdom.lord
    // .crossKnight), and the heads of rival Houses who rode with their realm's
    // host (rival.head.crossKnight). The honour is on the person and dies with
    // them. Each record { title, day, war, faithId, wars }.

    knightTitle() {
        return HolyWars.config().knight.title || 'Knight of the Cross';
    },

    /** The crusader's honour of the player, a lord or a rival head (null: none). */
    knightOf(who) {
        if (!who) return null;
        const p = _obj(who.holyWars);
        if (p && _obj(p.knight)) return !p.knight.name || p.knight.name === (who.name || 'you') ? p.knight : null;
        return _obj(who.crossKnight) || null;
    },

    /** "Knight of the Cross" ("…, twice" and more for a veteran of several), or null. */
    styleOf(who) {
        const k = HolyWars.knightOf(who);
        if (!k) return null;
        const n = _num(k.wars, 1);
        return `${k.title || HolyWars.knightTitle()}${n >= 2 ? ` (${n === 2 ? 'twice' : `${n} crusades`})` : ''}`;
    },

    _dub(rec, world, war) {
        if (_obj(rec)) { rec.wars = _num(rec.wars, 1) + 1; rec.last = war.name; return rec; }
        return { title: HolyWars.knightTitle(), day: _day(world), war: war.name, faithId: war.faithId, wars: 1 };
    },

    /** The player served in a holy war won: the title, the House's honour, the lords' memory. */
    _knightPlayer(world, player, war, out) {
        const K = HolyWars.config().knight;
        const p = HolyWars.pstate(player);
        const day = _day(world);
        const first = !HolyWars.knightOf(player);
        p.knight = first ? { ...HolyWars._dub(null, world, war), name: player.name || 'you' } : HolyWars._dub(p.knight, world, war);
        p.served = p.served.filter(id => id !== war.id);
        const title = p.knight.title || HolyWars.knightTitle();
        if (player.house) {
            const h = player.house;
            if (!Array.isArray(h.honours)) h.honours = [];
            const id = `cross_knight:${player.name || 'you'}`;
            if (!h.honours.some(x => x.id === id)) h.honours.push({ id, name: `${title} (${player.name || 'the head of the House'})`, fame: _num(K.honourFame, 12), day, generation: h.generation || 1 });
            House._chronicle(h, world, `${player.name || 'The head of the House'} was hailed ${first ? 'a' : 'again a'} ${title} for ${war.name}.`, ['faith', 'crusade', 'honour']);
        }
        // The faithful rulers honour a crusader; the vanquished foe does not forget
        for (const k of world.kingdoms || []) {
            if (!_alive(k) || !k.lord || !k.religion || k.religion.faithId !== war.faithId || k.id === war.target) continue;
            NPCLords.rememberDeed(world, k.lord, 'crusader', { note: title });
        }
        const foe = _kingdom(world, war.target);
        if (_alive(foe) && foe.lord) NPCLords.rememberDeed(world, foe.lord, 'crusaded_against', { note: war.name });
        const text = HolyWars.text('knighted', { title, war: war.name });
        HolyWars._plog(player, world, text);
        if (out) out.notices.push({ icon: '✝️', title, text, type: 'success' });
    },

    /** The rulers whose crowns fought the holy war to victory. */
    _knightLords(world, war) {
        for (const id of war.members) {
            const m = _kingdom(world, id);
            if (!_alive(m) || !m.lord) continue;
            const first = !m.lord.crossKnight;
            m.lord.crossKnight = HolyWars._dub(m.lord.crossKnight, world, war);
            if (first && Array.isArray(world.events)) world.events.push({ text: `✝️ ${HolyWars.text('knightedWorld', { lord: m.lord.name || 'The ruler', realm: Names.realm(m.name), title: m.lord.crossKnight.title })}`, type: 'religious', category: 'religious', kingdom: m.id });
        }
    },

    /** The rival Houses of a realm that answers: their heads may take the cross with its host (they pay to ride). */
    _rivalsTakeCross(world, player, war, k, out) {
        if (!player) return;
        const R = HolyWars.config().knight.rival;
        for (const rival of RivalHouses.rivals(player)) {
            if (!rival || rival.cadet || rival.kingdomId !== k.id || !rival.head || rival.head.captiveOf || rival.cross) continue;
            const h = rival.head;
            const lean = 0.6 + _num(h.martial, 5) / 10 + (RivalHouses.has(h, 'proud') ? 0.3 : 0) + (RivalHouses.has(h, 'courtly') ? 0.1 : 0) - (RivalHouses.has(h, 'homebody') ? 0.4 : 0);
            if (_u(world, `rivalCross|${war.id}|${rival.houseKey || rival.kingdomId}`) >= _num(R.chance, 0.3) * lean) continue;
            const outfit = Math.round(Math.min(_num(R.outfitCap, 400), Math.max(_num(R.outfitMin, 40), _num(rival.gold) * _num(R.outfitShare, 0.08))));
            if (_num(rival.gold) < outfit * 2) continue;
            // (the outfitting is bought at the seat: the House's coin into its town)
            rival.gold = _r2(_num(rival.gold) - outfit);
            RivalHouses._spendAtSeat(world, rival, outfit);
            rival.cross = { warId: war.id, war: war.name, target: war.targetName, taken: _day(world), outfit };
            const text = HolyWars.text('rivalCross', { name: RivalHouses.headName(rival), realm: Names.realm(k.name), target: Names.realm(war.targetName) });
            RivalHouses._note(rival, world, `Took the cross against ${Names.realm(war.targetName)}.`);
            HolyWars._log(world, { kind: 'rivalCross', war: war.id, key: war.seeKey, text });
            if (out) out.notices.push({ icon: '✝️', title: 'A Rival Takes the Cross', text, type: 'info' });
        }
    },

    /** The holy war over: the rival Houses' heads come home hailed, beaten — or not at all. */
    _rivalsHome(world, player, war, win, out) {
        if (!player) return;
        const R = HolyWars.config().knight.rival;
        for (const rival of RivalHouses.rivals(player)) {
            if (!rival || !rival.cross || rival.cross.warId !== war.id) continue;
            rival.cross = null;
            if (!rival.head) continue;
            const name = RivalHouses.headName(rival);
            const key = `${war.id}|${rival.houseKey || rival.kingdomId}`;
            if (_u(world, `rivalFell|${key}`) < _num(R.death, 0.06)) {
                const text = HolyWars.text('rivalFell', { name, war: war.name });
                RivalHouses._note(rival, world, `Fell in ${war.name}.`);
                if (out) out.notices.push({ icon: '⚰️', title: 'A Rival Falls on Crusade', text, type: 'info' });
                // (the heir's making draws dice: a stream of its own)
                Utils.withRng(_rng(world, `rivalHeir|${key}`), () => RivalHouses._succeed(world, rival, out || { notices: [] }, player));
                continue;
            }
            if (win) {
                rival.head.crossKnight = HolyWars._dub(rival.head.crossKnight, world, war);
                rival.renown = _num(rival.renown) + _num(R.renown, 15);
                if (!_obj(rival.standing)) rival.standing = {};
                for (const id of new Set(war.members.concat(war.answered))) {
                    if (id !== war.target) rival.standing[id] = _num(rival.standing[id]) + _num(R.standing, 10);
                }
                const text = HolyWars.text('rivalKnighted', { name, war: war.name, title: rival.head.crossKnight.title });
                RivalHouses._note(rival, world, `Came home from ${war.name} a ${rival.head.crossKnight.title}.`, 'triumph');
                if (player.house) House._chronicle(player.house, world, text, ['rival', 'crusade']);
                if (out) out.notices.push({ icon: '✝️', title: 'A Rival Hailed', text, type: 'info' });
            } else {
                rival.renown = Math.max(0, _num(rival.renown) + _num(R.defeatRenown, -5));
                rival.guard = Math.max(0, _num(rival.guard) - _num(R.guardsLost, 1));
                RivalHouses._note(rival, world, `Came home beaten from ${war.name}.`);
            }
        }
    },

    // ──────────── THE PLAYER UNDER THE BAN ────────────

    /** Ways out of a ban: [{ how, ok, reason, cost }]. */
    absolutionOptions(player, world, seeKey, who) {
        const see = HolyWars.see(world, seeKey);
        if (!see || !see.bans[who]) return [];
        const B = HolyWars.config().ban;
        const price = HolyWars.banPrice(world, player, see, who);
        const at = Number.isFinite(player.q) && _dist(world, { q: player.q, r: player.r }, see) <= 1;
        const pen = Math.round(price * _num(B.penanceShare, 0.4));
        const k = who === 'player' ? null : _kingdom(world, who);
        const treasury = k ? _num(k.treasury) : 0;
        const opts = [
            { how: 'penance', cost: pen, prestige: _num(B.penancePrestige, 30), ok: at && _num(player.gold) >= pen, reason: !at ? `Do penance at ${see.town}, before ${HolyWars.headLabel(see)}.` : _num(player.gold) < pen ? `The penance comes to ${Utils.formatGold(pen)} gold.` : null },
            { how: 'pay', cost: price, ok: _num(player.gold) + treasury >= price, reason: _num(player.gold) + treasury < price ? `The see asks ${Utils.formatGold(price)} gold.` : null, fromTreasury: !!k },
        ];
        const other = HolyWars.counterSee(world, see);
        if (other) opts.push({ how: 'counterPope', cost: 0, ok: true, other: HolyWars.headLabel(other), reason: null });
        return opts;
    },

    /** The player seeks absolution: penance at the seat, payment, or a counter-pope. */
    seekAbsolution(player, world, seeKey, who, how) {
        const see = HolyWars.see(world, seeKey);
        const opt = HolyWars.absolutionOptions(player, world, seeKey, who).find(o => o.how === how);
        if (!see || !opt) return { success: false, reason: 'There is no such ban.' };
        if (!opt.ok) return { success: false, reason: opt.reason };
        const out = { notices: [] };
        const k = who === 'player' ? null : _kingdom(world, who);
        if (how === 'counterPope') {
            const other = HolyWars.counterSee(world, see);
            if (k) {
                HolyWars._turnToCounterPope(world, player, k, see, other, out);
            } else {
                delete see.bans.player;
                see.grievance.player = 0;
                HolyWars.pstate(player).rite = other.rite;
            }
            const text = `You turn to ${HolyWars.headLabel(other)}, who calls the ban void. The old rite's faithful think you a schismatic.`;
            HolyWars._plog(player, world, text);
            return { success: true, text };
        }
        let cost = opt.cost;
        let fromTreasury = 0;
        if (how === 'pay' && k) {
            fromTreasury = Math.min(cost, Math.max(0, _num(k.treasury)));
            k.treasury = _r2(_num(k.treasury) - fromTreasury);
            HolyWars.deposit(world, player, see, fromTreasury, k.id);
            cost -= fromTreasury;
        }
        if (cost > 0) {
            player.gold = _r2(_num(player.gold) - cost);
            Ledger.record(player, 'holyWar', -cost);
            HolyWars.deposit(world, player, see, cost, null);
        }
        if (how === 'penance' && player.house) House.spend(player.house, Math.min(_num(player.house.prestige), opt.prestige), 'penance before the see', _day(world));
        HolyWars._lift(world, player, see, who, how === 'penance' ? `, after your penance at ${see.town}` : ', for a gift to the see', out);
        return { success: true, text: (out.notices[0] && out.notices[0].text) || 'The ban is lifted.', cost: opt.cost };
    },

    // ──────────── THE PLAYER AS HEAD OF THE FAITH ────────────

    /** The see the player heads (as High Priest), or null. */
    headedSee(player, world) {
        return Object.values(HolyWars.state(world).sees).find(s => HolyWars.playerHeads(player, s)) || null;
    },

    /** A High Priest calls a holy war. */
    proclaimHolyWar(player, world, targetId) {
        const see = HolyWars.headedSee(player, world);
        if (!see) return { success: false, reason: 'Only the head of a faith may call a holy war.' };
        if (HolyWars.state(world).wars.some(w => w.seeKey === see.key)) return { success: false, reason: 'Your see already wages a holy war.' };
        const t = HolyWars.targets(world, see).find(o => o.k.id === targetId);
        if (!t) return { success: false, reason: 'The faith has no cause against that realm.' };
        const out = { notices: [] };
        const war = HolyWars.call(world, player, see, t.k, t.casus, t.site, out);
        if (!war) return { success: false, reason: 'No crown of the faith could answer.' };
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} called ${war.name}.`, ['faith', 'crusade']);
        return { success: true, text: `You call ${war.name}. The faithful crowns have ${HolyWars.config().call.answerDays} days to answer.` };
    },

    /** A High Priest casts out a ruler of the faith, or lifts his ban. */
    pronounceBan(player, world, kingdomId, lift = false) {
        const see = HolyWars.headedSee(player, world);
        const k = _kingdom(world, kingdomId);
        if (!see) return { success: false, reason: 'Only the head of a faith may cast a ruler out.' };
        if (!_alive(k) || HolyWars.keyOfRealm(k) !== see.key) return { success: false, reason: 'That ruler is not of your faith.' };
        if (_ruled(player, world) === k) return { success: false, reason: 'You cannot cast yourself out.' };
        const out = { notices: [] };
        if (lift) {
            if (!see.bans[k.id]) return { success: false, reason: 'That ruler is not under the ban.' };
            HolyWars._lift(world, player, see, k.id, ' by your word', out);
            return { success: true, text: `You lift the ban on ${Names.realm(k.name)}.` };
        }
        if (see.bans[k.id]) return { success: false, reason: 'That ruler is already cast out.' };
        HolyWars._ban(world, player, see, k.id, 'defying the Church', out);
        if (!player.reputation) player.reputation = {};
        player.reputation[k.id] = Math.max(-100, _num(player.reputation[k.id]) - 25);
        return { success: true, text: `You cast the ruler of ${Names.realm(k.name)} out of the faith. His lords' oaths loosen, and the faithful turn from him.` };
    },

    // ──────────── THE DAY ────────────

    processDay(world, player = null) {
        const out = { notices: [] };
        const C = HolyWars.config();
        if (!world || C.enabled === false || !Array.isArray(world.kingdoms)) return out;
        const st = HolyWars.state(world);
        const day = _day(world);
        if (player) HolyWars._crossDay(world, player, day, out);
        if (((day % 7) + 7) % 7 !== _num(C.weekDay, 3) % 7) return out;
        // (a rival's vow for a war that ended while no one lived to see it)
        if (player) for (const r of RivalHouses.rivals(player)) if (r && r.cross && !st.wars.some(w => w.id === r.cross.warId)) r.cross = null;
        HolyWars._syncSees(world, player, day, out);
        for (const see of Object.values(st.sees)) {
            HolyWars._coffersWeek(world, player, see);
            HolyWars._grievanceWeek(world, player, see, out);
            HolyWars._aiAbsolution(world, player, see, day, out);
        }
        for (const war of st.wars.slice()) {
            if (war.phase === 'call') HolyWars._callWeek(world, player, war, day, out);
            if (st.wars.includes(war)) HolyWars._warWeek(world, player, war, day, out);
        }
        for (const see of Object.values(st.sees)) HolyWars._aiCalls(world, player, see, day, out);
        HolyWars._realmsWeek(world, player, day);
        return out;
    },

    // ──────────── THE RECORD ────────────

    /** The holy wars the House lived through, as the Annals' ages. */
    annalChapters(world, fromDay = 0) {
        const st = world && _obj(world.holyWars);
        if (!st) return [];
        const yr = (d) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(_num(d, 1))) - 1) / YEAR);
        const out = [];
        for (const h of _arr(st.past)) {
            if (_num(h.to) < fromDay || h.outcome === 'unanswered') continue;
            const lines = st.log.filter(e => e.war === h.id).map(e => e.text).filter(Boolean);
            const name = String(h.name || 'a holy war');
            out.push({
                id: `age_holy${h.id}`, kind: 'holyWar', icon: h.outcome === 'victory' ? '✝️' : '🏳️',
                title: `${name.charAt(0).toUpperCase() + name.slice(1)}, years ${yr(h.from)}–${yr(h.to)}`,
                fromYear: yr(h.from), toYear: yr(h.to), live: false, outcome: h.outcome,
                paragraphs: [{ year: yr(h.from), text: `In the year ${yr(h.from)}, ${lines.slice(0, 6).map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(' ')}${h.members.length ? ` The crowns of ${h.members.join(', ')} took the cross${h.crusaders.length ? `, and with them ${h.crusaders.join(', ')}` : ''}.` : ''}` }],
            });
        }
        return out;
    },

    /** For the panel: the see of the player's faith, the wars, the bans, the cross. */
    view(world, player) {
        const st = HolyWars.state(world);
        const mine = _ruled(player, world);
        const see = HolyWars.playerSee(player, world) || (mine ? HolyWars.seeOfRealm(world, mine) : null);
        return {
            see, headed: HolyWars.headedSee(player, world), mine,
            sees: Object.values(st.sees),
            wars: st.wars.slice(), past: st.past.slice(0, 8),
            invitations: HolyWars.invitations(player, world),
            cross: HolyWars.pstate(player).cross, crossOptions: HolyWars.crossOptions(player, world),
            bans: HolyWars.playerBans(player, world),
            p: HolyWars.pstate(player),
            knight: HolyWars.knightOf(player),
        };
    },
};
