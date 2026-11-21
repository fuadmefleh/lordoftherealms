// ============================================
// REALM DECLINE — the weight of greatness
// ============================================
// A great realm rots from within unless its ruler fights it. Four STRAINS
// (0–100) sit on the realm the player rules (player.realmDecline.strains).
// Each week each creeps toward a PRESSURE worked out from the realm's size
// (its towns), its age (the realm's years and the House's years on the
// throne) and the player's holdings, less what the council does about it.
// The climb is slow (about ten years to close two thirds of the gap), so a
// strain takes years to bite; every effect scales with its BITE,
// (strain − biteFrom) / (100 − biteFrom):
//
//   GRAFT     court bloat. Each week a share of the crown's dues is skimmed
//             out of the royal treasury into real purses: the council's
//             non-family officers (a lord's share is spent in his seat's
//             town, a companion's goes into their purse, an old-court
//             officer's into the capital's) and the clerks (the capital's
//             purse). Who took what is kept (st.takers), so an audit or a
//             purge can claw it back. Fed by size, the reign's years, the
//             holdings, a lavish court, a greedy or drunken ruler; a
//             competent loyal Steward holds it down.
//   DRIFT     far provinces drifting to their own lords. Each town's
//             farness from the capital (Hex.wrappingDistance past `near`);
//             far lords think less of the crown (vassal.drift, read by
//             Kingship.opinion as "Far from the crown", so factions and
//             revolts follow from it), the crown's taxes fall by the far
//             towns' share (court.declineMods.tax, read by
//             Kingship.computeMods → kingdom.crown.mods), and once it bites
//             hard a sullen far lord may keep the king's dues
//             (vassal.refusingUntil). The Chancellor, the Royal Post and the
//             road programme pull the provinces in.
//   SOFT      heirs born in the purple. Written to player.realmDecline.purple;
//             systems/upbringing.js comeOfAge reads it: a child who grew up at
//             court (never fostered, never on a path away) comes of age with
//             craven/drunkard/greedy seeds added and less combat and
//             leadership. A march path (systems/heirPaths.js 'march') or a
//             march command (below) undoes it.
//   ENTRENCH  guilds and clergy dug in. Edicts cost more to proclaim and keep
//             (court.declineFx, read by Kingship._passCost and _payUpkeep)
//             and the Guild Coalition and the Clerical Synod move less
//             (Kingship._shiftFactions).
//
// All four press on the realm's stability through kingdom.decline.stab
// (world/kingdomState.js: "Weight of greatness").
//
// COUNTERMEASURES (each with a cooldown, all coin real): audit the treasury
// (auditors paid at the capital; a share of the skim recovered from those who
// took it; they bear a grudge), reorganise the provinces (paid out in the far
// towns; far lords lose face; a stability dip), purge the court (every skim
// seized, the guilds' and chapters' charters torn up; every lord takes a
// grudge, the House loses Prestige, the realm shakes — factions and revolts
// may follow by systems/kingship.js's own rules), move the capital (to a
// town nearer the realm's heart; dear, the old court left behind), and a
// march command for a grown soft heir.
//
// AI REALMS. A lighter single strain on every other living realm
// (kingdom.decline.s): size and age push it up; its bite costs stability and
// skims its treasury into its capital's purse. Now and then a realm deep in
// decline gets a reforming ruler (a hash roll) and starts again — old big
// realms sag and recover in long waves, giving the player openings.
//
// No shared RNG: rolls are hashes of the world seed. Weekly (cadence days).
// Runs with player = null (the interregnum): the AI realms go on, the
// player's strains wait. Saved: player.realmDecline (EXTRA_PLAYER_FIELDS),
// kingdom.decline (serializeKingdoms). Content: data/realmDecline.json.
// Prose: notable turns go through LlmProse (kind 'decline'), template text
// as the fallback.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Seasons } from '../world/seasons.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { House } from './house.js';
import { Holdings } from './holdings.js';
import { Guilds } from './guilds.js';
import { Traits } from './traits.js';
import { Companions } from './companions.js';
import { Upbringing } from './upbringing.js';
import { Ledger } from './ledger.js';
import { LlmProse } from './llmProse.js';

const YEAR = Seasons.DAYS_PER_YEAR || 120;
const STRAINS = ['graft', 'drift', 'soft', 'entrench'];
const MEASURES = ['audit', 'reorganise', 'purge', 'moveCapital'];
const LOG_CAP = 24;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _r1 = (v) => Math.round(v * 10) / 10;
const _key = (q, r) => `${q},${r}`;

const DEFAULTS = {
    enabled: true, cadence: 7, biteFrom: 20, rise: 0.006, fall: 0.012, noticeAt: 40, graveAt: 70, hysteresis: 10, historyWeeks: 18,
    size: { townsFrom: 3, townsSpan: 12, cap: 1.5, holdingsSpan: 12 },
    strains: { graft: {}, drift: {}, soft: {}, entrench: {} },
    stability: { perBite: 4, cap: 12 },
    measures: {},
    ai: { enabled: true, scale: 0.8, size: 0.4, age: 0.5, realmYears: 50, biteFrom: 25, stabilityPerBite: 8, skimShare: 0.15, reformAt: 55, reformChance: 0.12, reformKeep: 0.4, reformStability: -3 },
    text: { bite: {}, grave: {} },
};

let _cfg = null;
let _cfgSrc = null;

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

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    let h = Utils.hashStr(`${_seed(world)}|realmDecline|${key}`) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
}

/** Every living realm's towns in one pass: Map kid → [{ q, r, s }]. */
function _townsByRealm(world) {
    const out = new Map();
    const all = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
        : (world && typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
    for (const v of all) {
        if (!v || !v.kingdom) continue;
        const t = _tile(world, v.q, v.r);
        const s = (t && t.settlement) || null;
        if (!s) continue;
        if (!out.has(v.kingdom)) out.set(v.kingdom, []);
        out.get(v.kingdom).push({ q: v.q, r: v.r, s });
    }
    return out;
}

/** Crown coin spent at court reaches the capital's purse (else the realm's towns). → the coin placed. */
function _toCapital(world, k, a) {
    if (!(a > 0)) return 0;
    const placed = CrownBooks.spendAtCapital(world, k, a);
    if (placed > 0) return placed;
    const t = k && k.capital ? _tile(world, k.capital.q, k.capital.r) : null;
    if (t && t.settlement) { const p = Economy.payTown(t.settlement, a); if (p > 0) return p; }
    return Economy.payRealm(k, world, a) ? a : 0;
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, _num(world && world.width, 0) || 9999);
}

export const RealmDecline = {
    STRAINS,
    MEASURES,

    config() {
        const src = (DataLoader._gamedata && DataLoader._gamedata.realmDecline) || null;
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        _cfg = _merge(DEFAULTS, _obj(src) || {});
        return _cfg;
    },

    strainDef(id) {
        return RealmDecline.config().strains[id] || {};
    },

    measureDef(id) {
        return RealmDecline.config().measures[id] || {};
    },

    /** The player's decline record (created/backfilled). */
    state(player) {
        if (!player) return null;
        if (!_obj(player.realmDecline)) player.realmDecline = {};
        const st = player.realmDecline;
        if (!_obj(st.strains)) st.strains = {};
        for (const id of STRAINS) if (!Number.isFinite(st.strains[id])) st.strains[id] = 0;
        if (!_obj(st.pressure)) st.pressure = {};
        if (!Array.isArray(st.history)) st.history = [];
        if (!_obj(st.marks)) st.marks = {};
        if (!_obj(st.cooldowns)) st.cooldowns = {};
        if (!Array.isArray(st.commands)) st.commands = [];
        if (!_obj(st.takers)) st.takers = {};
        if (!Array.isArray(st.log)) st.log = [];
        if (!_obj(st.stats)) st.stats = {};
        for (const k of ['graftTotal', 'recovered', 'audits', 'reorganisations', 'purges', 'capitalsMoved', 'commands', 'duesKept']) {
            if (!Number.isFinite(st.stats[k])) st.stats[k] = 0;
        }
        if (st.kingdomId === undefined) st.kingdomId = null;
        if (st.purple === undefined) st.purple = null;
        if (!Number.isFinite(st.n)) st.n = 0;
        return st;
    },

    /** 0..1: how hard a strain of this value bites. */
    bite(value, from = null) {
        const f = from == null ? RealmDecline.config().biteFrom : from;
        return _clamp((_num(value) - f) / Math.max(1, 100 - f), 0, 1);
    },

    _sizeF(towns) {
        const S = RealmDecline.config().size;
        return _clamp((towns - _num(S.townsFrom, 3)) / Math.max(1, _num(S.townsSpan, 12)), 0, _num(S.cap, 1.5));
    },

    /** Farness 0..1 of a place from the capital. */
    farness(world, k, q, r) {
        const D = RealmDecline.strainDef('drift');
        if (!k || !k.capital) return 0;
        const d = _dist(world, k.capital, { q, r });
        return _clamp((d - _num(D.near, 8)) / Math.max(1, _num(D.span, 16)), 0, 1);
    },

    _councillor(player, world, office) {
        try { return Kingship.councillor(player, world, office); } catch (e) { return null; }
    },

    // ── Pressures ───────────────────────────────────────────────

    /** Where each strain on the realm the player rules is heading, with what feeds it. */
    pressures(player, world, k, towns = null) {
        const C = RealmDecline.config();
        const day = _day(world);
        const ruling = player && player.throne && player.throne.ruling;
        const list = towns || Throne._settlementsOf(world, k).map(e => ({ q: e.q, r: e.r, s: e.settlement }));
        const T = list.length;
        const sizeF = RealmDecline._sizeF(T);
        const reignY = Math.max(0, (day - _num(ruling && ruling.since, day)) / YEAR);
        const realmY = Math.max(0, (day - _num(k.foundedDay, 0)) / YEAR);
        const court = Kingship.court(player);
        const edicts = (court && court.edicts) || {};
        const out = {};
        const make = () => {
            const parts = [];
            let v = 0;
            const add = (label, x) => { if (Math.abs(x) >= 0.005) parts.push({ label, value: Math.round(x * 100) }); v += x; };
            return { add, done: () => ({ value: Math.round(_clamp(v, 0, 1) * 1000) / 10, parts }) };
        };
        // Graft
        {
            const G = RealmDecline.strainDef('graft');
            const p = make();
            p.add('A court every realm keeps', _num(G.base));
            p.add(`The realm's size (${T} towns)`, _num(G.size) * sizeF);
            p.add(`${Math.floor(reignY)} years of your House on the throne`, _num(G.age) * _clamp(reignY / Math.max(1, _num(G.reignYears, 30)), 0, 1.2));
            const H = player ? Holdings.list(player, world).length : 0;
            if (H) p.add(`Your holdings (${H})`, _num(G.holdings) * _clamp(H / Math.max(1, _num(C.size.holdingsSpan, 12)), 0, 1));
            const f = _obj(k.fisc);
            if (f && f.courtLevel === 'lavish') p.add('A lavish court', _num(G.lavish));
            else if (f && f.courtLevel === 'frugal') p.add('A frugal court', _num(G.frugal));
            const sw = RealmDecline._councillor(player, world, 'steward');
            if (sw) {
                p.add(`${sw.name}, your Steward`, -_num(G.stewardRelief) * (sw.competence / 20) * Math.min(1, sw.loyalty / 70));
                if (sw.loyalty < 40) p.add('A disloyal Steward', _num(G.stewardDisloyal));
            }
            const earned = player ? Traits.getEarned(player) : [];
            if (earned.includes('greedy') || earned.includes('drunkard')) p.add('A ruler who looks away', _num(G.softRuler));
            out.graft = p.done();
        }
        // Drift
        {
            const D = RealmDecline.strainDef('drift');
            const p = make();
            let pop = 0, far = 0, farTowns = 0;
            for (const t of list) {
                const n = Math.max(1, _num(t.s.population));
                const fz = RealmDecline.farness(world, k, t.q, t.r);
                pop += n;
                far += n * fz;
                if (fz > 0.3) farTowns++;
            }
            const M = pop > 0 ? far / pop : 0;
            p.add(`The realm's size (${T} towns)`, _num(D.size) * sizeF);
            const ageMul = _num(D.ageFloor, 0.5) + (1 - _num(D.ageFloor, 0.5)) * _clamp(reignY / Math.max(1, _num(D.ageYears, 40)), 0, 1);
            p.add(`Far towns (${farTowns} far from ${k.capital ? 'the capital' : 'any seat'})`, _num(D.far) * M * ageMul);
            const ch = RealmDecline._councillor(player, world, 'chancellor');
            if (ch) p.add(`${ch.name}, your Chancellor`, -_num(D.chancellorRelief) * (ch.competence / 20) * Math.min(1, ch.loyalty / 70));
            if (edicts.royal_post) p.add('The Royal Post', -_num(D.royalPostRelief));
            if (edicts.road_programme) p.add('The road programme', -_num(D.roadsRelief));
            out.drift = { ...p.done(), farShare: Math.round(M * 1000) / 1000, farTowns };
        }
        // Soft heirs
        {
            const S = RealmDecline.strainDef('soft');
            const p = make();
            p.add('Life at court', _num(S.base));
            p.add(`The realm's size (${T} towns)`, _num(S.size) * sizeF);
            p.add(`${Math.floor(reignY)} years of your House on the throne`, _num(S.age) * _clamp(reignY / Math.max(1, _num(S.reignYears, 25)), 0, 1.2));
            const pr = player ? House.getPrestige(player) : 0;
            if (pr > 0) p.add('The House\'s splendour (Prestige)', _num(S.prestige) * _clamp(pr / Math.max(1, _num(S.prestigeSpan, 1500)), 0, 1));
            out.soft = p.done();
        }
        // Entrenchment
        {
            const E = RealmDecline.strainDef('entrench');
            const p = make();
            p.add('Old privileges', _num(E.base));
            const w = _num(E.realmWeight, 0.6);
            p.add(`An old realm (${Math.floor(realmY)} years), an old reign`, _num(E.age) * _clamp((w * realmY + (1 - w) * reignY) / Math.max(1, _num(E.realmYears, 40)), 0, 1.2));
            p.add(`The realm's size (${T} towns)`, _num(E.size) * sizeF);
            let guilds = 0;
            for (const t of list) { const g = Guilds.townGuilds(t.s); if (g) guilds += Object.keys(g).length; }
            if (guilds) p.add(`Guild halls (${guilds})`, _num(E.guilds) * _clamp(guilds / Math.max(1, T * _num(E.guildsPerTown, 2)), 0, 1));
            const temples = Array.isArray(k.temples) ? k.temples.length : 0;
            if (temples) p.add(`Great churches (${temples})`, _num(E.temples) * _clamp(temples / Math.max(1, _num(E.templesSpan, 5)), 0, 1));
            out.entrench = p.done();
        }
        return out;
    },

    // ── The day ─────────────────────────────────────────────────

    /** Weekly: the AI realms' sag, and the player's realm's four strains. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        const C = RealmDecline.config();
        if (!world || C.enabled === false) return out;
        const day = _day(world);
        const cadence = Math.max(1, Math.floor(_num(C.cadence, 7)));
        if (day % cadence !== 0) return out;
        const ruled = player ? Throne.ruledKingdom(player, world) : null;
        const byRealm = _townsByRealm(world);
        if (C.ai && C.ai.enabled !== false) {
            for (const k of world.kingdoms || []) {
                if (!k || k.isAlive === false || k === ruled) continue;
                RealmDecline._aiWeek(world, k, byRealm.get(k.id) || [], cadence);
            }
        }
        if (player) {
            const st = RealmDecline.state(player);
            if (ruled) RealmDecline._playerWeek(world, player, st, ruled, byRealm.get(ruled.id) || [], cadence, out);
            else if (st.kingdomId) {
                // The crown is gone: the court's fx went with it; the strains are forgotten
                st.kingdomId = null;
                st.purple = null;
                for (const id of STRAINS) st.strains[id] = 0;
                st.takers = {};
            }
            RealmDecline._commandsWeek(world, player, st, out);
        }
        return out;
    },

    _playerWeek(world, player, st, k, towns, cadence, out) {
        const C = RealmDecline.config();
        const court = Kingship.court(player);
        if (!court) return;
        const P = RealmDecline.pressures(player, world, k, towns);
        // A new crown: the old court comes with its old habits
        if (st.kingdomId !== k.id) {
            st.kingdomId = k.id;
            st.marks = {};
            st.takers = {};
            st.history = [];
            for (const id of STRAINS) st.strains[id] = Math.round(_num(P[id].value) * _num(RealmDecline.strainDef(id).start) * 10) / 10;
        }
        for (const id of STRAINS) {
            const target = _num(P[id].value);
            const cur = _num(st.strains[id]);
            const rate = target > cur ? _num(C.rise) : _num(C.fall);
            st.strains[id] = _r1(_clamp(cur + (target - cur) * rate * (cadence / 7), 0, 100));
            st.pressure[id] = target;
        }
        st.history.push({ day: _day(world), ...Object.fromEntries(STRAINS.map(id => [id, st.strains[id]])) });
        if (st.history.length > _num(C.historyWeeks, 18)) st.history.splice(0, st.history.length - _num(C.historyWeeks, 18));
        const b = Object.fromEntries(STRAINS.map(id => [id, RealmDecline.bite(st.strains[id])]));

        RealmDecline._graftWeek(world, player, st, k, court, b.graft, cadence);
        RealmDecline._driftWeek(world, player, st, k, court, towns, b.drift, P.drift, out);
        // Soft heirs: read by Upbringing.comeOfAge
        const S = RealmDecline.strainDef('soft');
        if (b.soft > 0) {
            const seeds = {};
            for (const [t, n] of Object.entries(S.seeds || {})) seeds[t] = Math.round(_num(n) * b.soft * 100) / 100;
            st.purple = { bite: Math.round(b.soft * 100) / 100, strain: st.strains.soft, seeds,
                skillLoss: b.soft >= _num(S.skillLossAt, 0.5) ? { ...(S.skillLoss || {}) } : {} };
        } else st.purple = null;
        // Entrenchment: read by Kingship._passCost / _payUpkeep / _shiftFactions
        const E = RealmDecline.strainDef('entrench');
        court.declineFx = {
            edictCost: Math.round((1 + _num(E.edictCost) * b.entrench) * 100) / 100,
            edictUpkeep: Math.round((1 + _num(E.edictUpkeep) * b.entrench) * 100) / 100,
            factionMove: Math.round((1 - _num(E.factionMove) * b.entrench) * 100) / 100,
            factions: Array.isArray(E.factions) ? E.factions.slice() : [],
        };
        // Stability (world/kingdomState.js reads kingdom.decline.stab)
        const SB = C.stability || {};
        const sum = STRAINS.reduce((s, id) => s + b[id], 0);
        k.decline = {
            s: Math.round(STRAINS.reduce((s, id) => s + st.strains[id], 0) / STRAINS.length * 10) / 10,
            stab: -Math.round(Math.min(_num(SB.cap, 12), sum * _num(SB.perBite, 4)) * 10) / 10,
            player: true, reformedDay: k.decline && k.decline.reformedDay != null ? k.decline.reformedDay : null,
        };
        RealmDecline._marks(world, player, st, k, out);
    },

    /** The skim: out of the royal treasury into the officers' and clerks' purses. */
    _graftWeek(world, player, st, k, court, b, cadence) {
        if (!(b > 0)) return;
        const G = RealmDecline.strainDef('graft');
        const rev = CrownBooks.lastRevenue(k);
        const have = Math.max(0, _num(k.treasury));
        let skim = rev > 0 ? rev * cadence * _num(G.skimShare, 0.3) * b : have * 0.002 * b;
        skim = Utils.centsDown(Math.min(skim, have * _num(G.skimTreasuryCap, 0.04)));
        if (!(skim > 0)) return;
        // The council's officers (not the family) take the takers' share, the less loyal the more
        const takers = [];
        for (const o of Kingship.OFFICES) {
            const p = RealmDecline._councillor(player, world, o);
            if (!p || p.kind === 'family') continue;
            takers.push({ p, office: o, w: Math.max(0.1, (110 - _num(p.loyalty)) / 100) * (o === 'steward' ? 2 : 1) });
        }
        const wSum = takers.reduce((s, t) => s + t.w, 0);
        const takerPot = takers.length ? skim * _num(G.takerShare, 0.6) : 0;
        let placed = 0;
        for (const t of takers) {
            const a = Utils.centsDown(takerPot * t.w / wSum);
            if (!(a > 0)) continue;
            const got = RealmDecline._payTaker(world, player, k, court, t.p, a);
            if (got > 0) {
                placed += got;
                const key = `${t.p.kind}:${t.p.id}`;
                const rec = st.takers[key] || (st.takers[key] = { kind: t.p.kind, id: t.p.id, name: t.p.name, take: 0 });
                rec.name = t.p.name;
                rec.office = t.office;
                rec.take = Utils.cents(_num(rec.take) + got);
            }
        }
        const clerks = Utils.cents(skim - placed);
        const c = clerks > 0 ? _toCapital(world, k, clerks) : 0;
        if (c > 0) {
            placed += c;
            const rec = st.takers.clerks || (st.takers.clerks = { kind: 'clerks', id: 'clerks', name: 'The clerks and hangers-on of the court', take: 0 });
            rec.take = Utils.cents(_num(rec.take) + c);
        }
        if (!(placed > 0)) return;
        k.treasury = Utils.cents(_num(k.treasury) - placed);
        CrownBooks.note(k, 'court', placed);
        st.stats.graftTotal = Utils.cents(st.stats.graftTotal + placed);
        st.lastSkim = placed;
    },

    /** One officer's skim lands somewhere real. → the coin placed. */
    _payTaker(world, player, k, court, p, a) {
        if (p.kind === 'vassal') {
            const v = court.vassals.find(x => x.id === p.id);
            const t = v && v.seat ? _tile(world, v.seat.q, v.seat.r) : null;
            if (t && t.settlement && Economy.payTown(t.settlement, a)) {
                v.grafted = Utils.cents(_num(v.grafted) + a);
                return a;
            }
            return _toCapital(world, k, a);
        }
        if (p.kind === 'companion') {
            const npc = Companions.members(player, world).find(n => n.id === p.id);
            if (npc) { npc.purse = Utils.cents(_num(npc.purse) + a); return a; }
        }
        return _toCapital(world, k, a);
    },

    /** Claw back `share` of what the takers took. → coin into the treasury. */
    _recover(world, player, k, court, st, share) {
        let back = 0;
        const cap = k.capital ? _tile(world, k.capital.q, k.capital.r) : null;
        for (const [key, rec] of Object.entries(st.takers)) {
            const want = Utils.centsDown(_num(rec.take) * share);
            if (!(want > 0)) continue;
            let got = 0;
            if (rec.kind === 'vassal') {
                const v = court.vassals.find(x => x.id === rec.id);
                const t = v && v.seat ? _tile(world, v.seat.q, v.seat.r) : null;
                if (t && t.settlement) got = Economy.drawTown(t.settlement, Math.min(want, _num(v.grafted)));
                if (v) v.grafted = Utils.cents(Math.max(0, _num(v.grafted) - got));
            } else if (rec.kind === 'companion') {
                const npc = Companions.members(player, world).find(n => n.id === rec.id);
                if (npc) { got = Utils.centsDown(Math.min(want, Math.max(0, _num(npc.purse)))); npc.purse = Utils.cents(_num(npc.purse) - got); }
            } else if (cap && cap.settlement) {
                got = Economy.drawTown(cap.settlement, want);
            }
            if (got > 0) {
                back += got;
                rec.take = Utils.cents(Math.max(0, _num(rec.take) - got));
            }
            if (!(rec.take > 0.5)) delete st.takers[key];
        }
        if (back > 0) {
            k.treasury = Utils.cents(_num(k.treasury) + back);
            st.stats.recovered = Utils.cents(st.stats.recovered + back);
        }
        return back;
    },

    /** Far lords cool; far towns' dues fall; a sullen far lord may keep the dues. */
    _driftWeek(world, player, st, k, court, towns, b, P, out) {
        const D = RealmDecline.strainDef('drift');
        const day = _day(world);
        for (const v of court.vassals) {
            const fz = v.seat ? RealmDecline.farness(world, k, v.seat.q, v.seat.r) : 0;
            v.drift = Math.round(_num(D.opinion, 35) * b * fz);
        }
        court.declineMods = b > 0 ? { tax: -Math.round(_num(D.taxShare, 0.4) * b * _num(P && P.farShare) * 1000) / 1000 } : {};
        // Once a year, if it bites hard: the sulkiest far lord keeps the king's dues
        if (b < _num(D.keepDuesAt, 0.55) || day % YEAR >= Math.max(1, _num(RealmDecline.config().cadence, 7))) return;
        let worst = null;
        for (const v of court.vassals) {
            if (v.rebel || v.refusingUntil > day || !v.seat || !(_num(v.opinion) < 0)) continue;
            const score = RealmDecline.farness(world, k, v.seat.q, v.seat.r) * -_num(v.opinion);
            if (score > 0 && (!worst || score > worst.score)) worst = { v, score };
        }
        if (!worst || _roll(world, `dues|${k.id}|${day}`) >= _num(D.keepDuesChance, 0.25)) return;
        worst.v.refusingUntil = day + _num(D.keepDuesDays, 60);
        st.stats.duesKept++;
        const text = `${Kingship.fullName(worst.v)} of ${worst.v.seat.name}, far from the crown, keeps the king's dues and his men at home this year.`;
        Kingship._log(court, world, `🧭 ${text}`);
        RealmDecline._logLine(world, st, 'dues', `🧭 ${text}`);
        out.notices.push({ icon: '🧭', title: 'A Far Lord Keeps the Dues', text, type: 'warning' });
    },

    /** Notices when a strain begins to bite and when it turns grave (with hysteresis). */
    _marks(world, player, st, k, out) {
        const C = RealmDecline.config();
        const realm = Names.realm(k.name);
        for (const id of STRAINS) {
            const v = st.strains[id];
            const m = st.marks[id] || 0;
            const def = RealmDecline.strainDef(id);
            const vars = { realm, pct: Math.round(_num(def.skimShare, 0.3) * RealmDecline.bite(v) * 100) };
            if (m < 2 && v >= _num(C.graveAt, 70)) {
                st.marks[id] = 2;
                const text = _fill(C.text.grave[id], vars);
                RealmDecline._logLine(world, st, `grave:${id}`, `${def.icon || '⚠️'} ${text}`, { strain: def.label, level: 'grave', realm });
                out.notices.push({ icon: def.icon || '⚠️', title: `${def.label}: grave`, text: `${text} (Royal Court → State of the Realm)`, type: 'error' });
                Interrupts.raise(world, { reason: `${def.label} in ${realm} turns grave`, icon: def.icon || '⚠️', source: 'realmDecline' });
                if (player.house) House._chronicle(player.house, world, text, ['realm', 'decline']);
            } else if (m < 1 && v >= _num(C.noticeAt, 40)) {
                st.marks[id] = 1;
                const text = _fill(C.text.bite[id], vars);
                RealmDecline._logLine(world, st, `bite:${id}`, `${def.icon || '⚠️'} ${text}`, { strain: def.label, level: 'biting', realm });
                out.notices.push({ icon: def.icon || '⚠️', title: `${def.label}`, text: `${text} (Royal Court → State of the Realm)`, type: 'warning' });
            } else if (m >= 2 && v < _num(C.graveAt, 70) - _num(C.hysteresis, 10)) st.marks[id] = 1;
            else if (m >= 1 && v < _num(C.noticeAt, 40) - _num(C.hysteresis, 10)) st.marks[id] = 0;
        }
    },

    _logLine(world, st, tag, text, facts = null) {
        st.n++;
        const key = `decline:${st.kingdomId || 'realm'}:${st.n}`;
        const entry = { day: _day(world), text, key };
        if (facts) {
            try { LlmProse.write(world, { kind: 'decline', key, facts: { ...facts, day: _day(world) }, fallback: text, style: 'chronicle' }); } catch (e) { /* the template stands */ }
        }
        st.log.push(entry);
        if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
    },

    /** The court chronicle's text of a log entry (the scribe's, else the template). */
    logText(world, entry) {
        if (!entry) return '';
        try { return LlmProse.text(world, entry.key, entry.text) || entry.text; } catch (e) { return entry.text; }
    },

    // ── AI realms ───────────────────────────────────────────────

    _aiWeek(world, k, towns, cadence) {
        const A = RealmDecline.config().ai;
        const C = RealmDecline.config();
        const day = _day(world);
        const d = _obj(k.decline) || (k.decline = { s: 0, stab: 0, reformedDay: null });
        if (d.player) d.player = false;
        const realmY = Math.max(0, (day - _num(k.foundedDay, 0)) / YEAR);
        const P = 100 * _clamp((_num(A.size) * RealmDecline._sizeF(towns.length)
            + _num(A.age) * _clamp(realmY / Math.max(1, _num(A.realmYears, 50)), 0, 1.2)) * _num(A.scale, 0.8), 0, 1);
        const cur = _num(d.s);
        d.s = _r1(_clamp(cur + (P - cur) * (P > cur ? _num(C.rise) : _num(C.fall)) * (cadence / 7), 0, 100));
        const b = RealmDecline.bite(d.s, _num(A.biteFrom, 25));
        d.stab = -Math.round(b * _num(A.stabilityPerBite, 8) * 10) / 10;
        // Its own court's skim: out of the chests into the capital's purse
        if (b > 0) {
            const rev = CrownBooks.lastRevenue(k);
            const want = Math.min(rev * cadence * _num(A.skimShare, 0.15) * b, Math.max(0, _num(k.treasury)) * 0.03);
            const a = Utils.centsDown(want);
            const placed = a > 0 ? _toCapital(world, k, a) : 0;
            if (placed > 0) {
                k.treasury = Utils.cents(_num(k.treasury) - placed);
                CrownBooks.note(k, 'court', placed);
                d.skimmed = Utils.cents(_num(d.skimmed) + placed);
            }
        }
        // A reforming ruler, now and then, once a year at most
        if (d.s >= _num(A.reformAt, 55) && day % YEAR < cadence && _roll(world, `reform|${k.id}|${Math.floor(day / YEAR)}`) < _num(A.reformChance, 0.12)) {
            d.s = _r1(d.s * _num(A.reformKeep, 0.4));
            d.reformedDay = day;
            k.stability = _clamp(_num(k.stability, 50) + _num(A.reformStability, -3), 0, 100);
            if (Array.isArray(world.events)) world.events.push({ text: `⚖️ A reforming hand in ${Names.realm(k.name)}: the court of ${k.ruler || 'its ruler'} is purged and its books opened.`, type: 'political' });
        }
    },

    /** How far an AI realm has sagged (for intel and the player's planning). */
    aiStanding(k) {
        const d = k && _obj(k.decline);
        if (!d) return { strain: 0, bite: 0, stab: 0, reformedDay: null, label: 'vigorous' };
        const b = RealmDecline.bite(d.s, _num(RealmDecline.config().ai.biteFrom, 25));
        return { strain: _num(d.s), bite: b, stab: _num(d.stab), reformedDay: d.reformedDay,
            label: b >= 0.6 ? 'rotting from within' : b >= 0.3 ? 'sagging' : b > 0 ? 'showing its age' : 'vigorous' };
    },

    // ── Countermeasures ─────────────────────────────────────────

    _ctx(player, world) {
        const k = Throne.ruledKingdom(player, world);
        const court = k ? Kingship.court(player) : null;
        if (!k || !court || !court.initialized) return { error: 'You rule no realm.' };
        return { k, court, st: RealmDecline.state(player), towns: Throne._settlementsOf(world, k).map(e => ({ q: e.q, r: e.r, s: e.settlement })) };
    },

    _cooldown(player, world, id) {
        const st = RealmDecline.state(player);
        const def = RealmDecline.measureDef(id);
        const last = st.cooldowns[id];
        if (!Number.isFinite(last)) return 0;
        return Math.max(0, last + Math.round(_num(def.cooldownYears) * YEAR) - _day(world));
    },

    /** The coin a measure costs the treasury now. */
    cost(player, world, id) {
        const x = RealmDecline._ctx(player, world);
        if (x.error) return 0;
        const def = RealmDecline.measureDef(id);
        if (id === 'audit') return Math.round(_num(def.cost) + _num(def.perTown) * x.towns.length);
        if (id === 'reorganise') return Math.round(_num(def.cost) + _num(def.perFarTown) * RealmDecline._farTowns(world, x.k, x.towns).length);
        if (id === 'moveCapital') return Math.round(_num(def.cost) + _num(def.perTown) * x.towns.length);
        return 0;
    },

    _farTowns(world, k, towns) {
        return towns.filter(t => RealmDecline.farness(world, k, t.q, t.r) > 0.3);
    },

    /** Can the player take this measure now? → { ok, reason?, cost } */
    can(player, world, id) {
        const x = RealmDecline._ctx(player, world);
        if (x.error) return { ok: false, reason: x.error };
        if (!MEASURES.includes(id)) return { ok: false, reason: 'No such measure.' };
        const wait = RealmDecline._cooldown(player, world, id);
        if (wait > 0) return { ok: false, reason: `Too soon: the realm needs ${Math.ceil(wait / YEAR * 10) / 10} more years before you try that again.`, wait };
        if (x.court.revolt && id !== 'purge') return { ok: false, reason: 'Not while the realm is in revolt.' };
        const cost = RealmDecline.cost(player, world, id);
        if (cost > _num(x.k.treasury)) return { ok: false, reason: `It costs ${Utils.formatGold(cost)}g from the royal treasury.`, cost };
        if (id === 'reorganise' && !RealmDecline._farTowns(world, x.k, x.towns).length) return { ok: false, reason: 'No town of the realm lies far from the capital.' };
        if (id === 'moveCapital' && !RealmDecline.capitalCandidates(player, world).length) return { ok: false, reason: 'No town of the realm would make a better seat.' };
        return { ok: true, cost };
    },

    _cut(st, id, amount) {
        st.strains[id] = _r1(Math.max(0, _num(st.strains[id]) - amount));
    },

    _done(player, world, x, id, text) {
        x.st.cooldowns[id] = _day(world);
        RealmDecline._logLine(world, x.st, id, text, { measure: RealmDecline.measureDef(id).label, realm: Names.realm(x.k.name) });
        Kingship._log(x.court, world, text);
        if (player.house) House._chronicle(player.house, world, text.replace(/^\S+\s/, ''), ['realm', 'decline']);
        Kingship.refresh(player, world);
    },

    /** Royal auditors: graft cut, a share of the skim recovered, the skimmers aggrieved. */
    audit(player, world) {
        const can = RealmDecline.can(player, world, 'audit');
        if (!can.ok) return { success: false, reason: can.reason };
        const x = RealmDecline._ctx(player, world);
        const def = RealmDecline.measureDef('audit');
        const paid = _toCapital(world, x.k, Math.min(can.cost, Math.max(0, _num(x.k.treasury))));
        x.k.treasury = Utils.cents(_num(x.k.treasury) - paid);
        CrownBooks.note(x.k, 'court', paid);
        const sw = RealmDecline._councillor(player, world, 'steward');
        const cut = _num(def.cut, 40) * (1 + _num(def.stewardBonus) * (sw ? sw.competence / 20 : 0));
        const back = RealmDecline._recover(world, player, x.k, x.court, x.st, _num(def.recover, 0.5));
        let aggrieved = 0;
        for (const v of x.court.vassals) {
            if (!(_num(v.grafted) > 0) && !x.st.takers[`vassal:${v.id}`]) continue;
            v.grudge = _num(v.grudge) + _num(def.takerGrudge, -10);
            aggrieved++;
        }
        RealmDecline._cut(x.st, 'graft', cut);
        x.st.stats.audits++;
        const text = `🧾 The royal auditors open the books of ${Names.realm(x.k.name)} (${Utils.formatGold(paid)}g): ${Utils.formatGold(back)}g of skimmed dues come back to the treasury${aggrieved ? `, and ${aggrieved} lord(s) caught at it resent it` : ''}.`;
        RealmDecline._done(player, world, x, 'audit', text);
        return { success: true, message: text.slice(3), recovered: back, paid };
    },

    /** New shires and sheriffs: drift cut; paid out in the far towns; far lords lose face. */
    reorganise(player, world) {
        const can = RealmDecline.can(player, world, 'reorganise');
        if (!can.ok) return { success: false, reason: can.reason };
        const x = RealmDecline._ctx(player, world);
        const def = RealmDecline.measureDef('reorganise');
        const far = RealmDecline._farTowns(world, x.k, x.towns);
        let paid = 0;
        const each = Utils.centsDown(can.cost / far.length);
        for (const t of far) paid += Economy.payTown(t.s, Math.min(each, Math.max(0, _num(x.k.treasury) - paid)));
        x.k.treasury = Utils.cents(_num(x.k.treasury) - paid);
        CrownBooks.note(x.k, 'works', paid);
        x.k.stability = _clamp(_num(x.k.stability, 50) + _num(def.stability, -5), 0, 100);
        let lords = 0;
        for (const v of x.court.vassals) {
            if (!v.seat || RealmDecline.farness(world, x.k, v.seat.q, v.seat.r) <= 0.3) continue;
            v.grudge = _num(v.grudge) + _num(def.farGrudge, -8);
            lords++;
        }
        RealmDecline._cut(x.st, 'drift', _num(def.cut, 35));
        x.st.stats.reorganisations++;
        const text = `🗺️ The far provinces of ${Names.realm(x.k.name)} are made over into new shires: ${far.length} towns, ${Utils.formatGold(paid)}g in sheriffs, judges and clerks${lords ? `, and ${lords} far lord(s) lose their little kingdoms` : ''}.`;
        RealmDecline._done(player, world, x, 'reorganise', text);
        return { success: true, message: text.slice(3), paid };
    },

    /** Arrests, seized purses, charters torn up: graft and entrenchment cut hard; every lord takes note. */
    purge(player, world) {
        const can = RealmDecline.can(player, world, 'purge');
        if (!can.ok) return { success: false, reason: can.reason };
        const x = RealmDecline._ctx(player, world);
        const def = RealmDecline.measureDef('purge');
        const seized = RealmDecline._recover(world, player, x.k, x.court, x.st, 1);
        const council = new Set(Kingship.OFFICES.map(o => x.court.council[o]).filter(s => s && s.kind === 'vassal').map(s => s.id));
        for (const v of x.court.vassals) {
            if (v.rebel) continue;
            v.grudge = _num(v.grudge) + _num(def.grudge, -15) + (council.has(v.id) ? _num(def.councilGrudge, -10) : 0);
        }
        x.k.stability = _clamp(_num(x.k.stability, 50) + _num(def.stability, -8), 0, 100);
        const pr = Math.min(House.getPrestige(player), Math.abs(_num(def.prestige, -20)));
        if (pr > 0 && player.house) House.spend(player.house, pr, 'a purge of the court', _day(world));
        for (const [id, n] of Object.entries(def.strains || {})) RealmDecline._cut(x.st, id, _num(n));
        x.st.stats.purges++;
        const text = `⛓️ The court of ${Names.realm(x.k.name)} is purged: officers arrested, ${Utils.formatGold(seized)}g seized for the treasury, the guilds' and chapters' old charters torn up. Every lord of the realm takes note.`;
        RealmDecline._done(player, world, x, 'purge', text);
        return { success: true, message: text.slice(3), seized };
    },

    /**
     * Towns that would make a better seat: nearer the realm's heart (the mean
     * distance to the realm's people) than the capital, best first.
     */
    capitalCandidates(player, world) {
        const x = RealmDecline._ctx(player, world);
        if (x.error) return [];
        const def = RealmDecline.measureDef('moveCapital');
        const centrality = (t) => {
            let s = 0, w = 0;
            for (const o of x.towns) { const n = Math.max(1, _num(o.s.population)); s += n * _dist(world, t, o); w += n; }
            return w > 0 ? s / w : 0;
        };
        const cap = x.k.capital;
        const here = cap ? centrality(cap) : Infinity;
        return x.towns
            .filter(t => !(cap && cap.q === t.q && cap.r === t.r))
            .map(t => ({ q: t.q, r: t.r, name: t.s.name, population: Math.round(_num(t.s.population)), reach: Math.round(centrality(t) * 10) / 10, now: Math.round(here * 10) / 10 }))
            .filter(c => c.reach < here)
            .sort((a, b) => a.reach - b.reach || b.population - a.population)
            .slice(0, Math.max(1, _num(def.candidates, 5)));
    },

    /** Raise a new seat: the treasury pays the new capital's builders; the old court is left behind. */
    moveCapital(player, world, q, r) {
        const can = RealmDecline.can(player, world, 'moveCapital');
        if (!can.ok) return { success: false, reason: can.reason };
        const c = RealmDecline.capitalCandidates(player, world).find(t => t.q === q && t.r === r);
        if (!c) return { success: false, reason: 'That town would not make a better seat.' };
        const x = RealmDecline._ctx(player, world);
        const def = RealmDecline.measureDef('moveCapital');
        const t = _tile(world, q, r);
        const paid = t && t.settlement ? Economy.payTown(t.settlement, Math.min(can.cost, Math.max(0, _num(x.k.treasury)))) : 0;
        x.k.treasury = Utils.cents(_num(x.k.treasury) - paid);
        CrownBooks.note(x.k, 'works', paid);
        const old = x.k.capital ? (_tile(world, x.k.capital.q, x.k.capital.r) || {}).settlement : null;
        x.k.capital = { q, r };
        // A lord seated there yields his seat to the crown
        for (const v of x.court.vassals) {
            if (!v.seat || v.seat.q !== q || v.seat.r !== r) continue;
            v.seat = null;
            v.grudge = _num(v.grudge) + _num(def.seatGrudge, -30);
        }
        x.k.stability = _clamp(_num(x.k.stability, 50) + _num(def.stability, -10), 0, 100);
        for (const [id, n] of Object.entries(def.strains || {})) RealmDecline._cut(x.st, id, _num(n));
        x.st.stats.capitalsMoved++;
        const text = `🏰 The crown of ${Names.realm(x.k.name)} moves its seat from ${old ? old.name : 'the old capital'} to ${c.name} (${Utils.formatGold(paid)}g in halls and walls). The old court and its hangers-on are left behind.`;
        RealmDecline._done(player, world, x, 'moveCapital', text);
        return { success: true, message: text.slice(3), paid };
    },

    // ── Hard heirs ──────────────────────────────────────────────

    /** How soft a child raised at court would come out now (0..1), or 0 when away/raised away. */
    purpleFor(player, child) {
        const st = player && _obj(player.realmDecline);
        const p = st && st.purple;
        if (!p || !child) return 0;
        return RealmDecline.raisedAway(child) ? 0 : _num(p.bite);
    },

    /** A child raised away from court (fostered, on a path, a march command). */
    raisedAway(child) {
        const up = child && child.upbringing;
        if (!up) return false;
        if (up.hardened) return true;
        if (up.placement && up.placement.kind === 'ward') return true;
        if (up.path && up.path.active) return true;
        return Array.isArray(up.pathRecord) && up.pathRecord.some(r => r && r.how === 'completed');
    },

    /** Grown children who could hold a march for two years. */
    marchCandidates(player, world) {
        const def = RealmDecline.measureDef('marchCommand');
        const st = RealmDecline.state(player);
        return (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling
            && c.upbringing && c.upbringing.comeOfAge && !c.upbringing.marchCommand
            && _num(c.age) >= _num(def.minAge, 16) && _num(c.age) <= _num(def.maxAge, 35)
            && !Upbringing.isAway(c) && !st.commands.some(m => m.childId === c.id));
    },

    /** Where a march command would be held: the realm's farthest town. */
    _marchTown(player, world) {
        const k = Throne.ruledKingdom(player, world);
        if (!k) return null;
        let best = null;
        for (const e of Throne._settlementsOf(world, k)) {
            if (k.capital && e.q === k.capital.q && e.r === k.capital.r) continue;
            const d = k.capital ? _dist(world, k.capital, e) : 0;
            if (!best || d > best.d) best = { q: e.q, r: e.r, name: e.settlement.name, s: e.settlement, d };
        }
        return best;
    },

    canCommand(player, world, childId) {
        const def = RealmDecline.measureDef('marchCommand');
        if (!Throne.ruledKingdom(player, world)) return { ok: false, reason: 'You rule no realm with marches to hold.' };
        const child = RealmDecline.marchCandidates(player, world).find(c => c.id === childId);
        if (!child) return { ok: false, reason: 'That child cannot take a march command now.' };
        const town = RealmDecline._marchTown(player, world);
        if (!town) return { ok: false, reason: 'The realm has no far town to hold.' };
        if (_num(player.gold) < _num(def.cost, 200)) return { ok: false, reason: `Their household and men cost ${Utils.formatGold(_num(def.cost, 200))} gold.` };
        return { ok: true, child, town, cost: _num(def.cost, 200) };
    },

    /** Send a grown child to hold a far border: paid from the purse into the march town's. */
    marchCommand(player, world, childId) {
        const can = RealmDecline.canCommand(player, world, childId);
        if (!can.ok) return { success: false, reason: can.reason };
        const def = RealmDecline.measureDef('marchCommand');
        const st = RealmDecline.state(player);
        const paid = Economy.payTown(can.town.s, can.cost);
        if (paid > 0) {
            player.gold = Utils.cents(_num(player.gold) - paid);
            Ledger.record(player, 'family', -paid);
        }
        const day = _day(world);
        const until = day + Math.round(_num(def.years, 2) * YEAR);
        st.commands.push({ childId, name: can.child.firstName, q: can.town.q, r: can.town.r, town: can.town.name, since: day, until });
        can.child.upbringing.marchCommand = { town: can.town.name, since: day, until };
        st.stats.commands++;
        const text = `🛡️ ${can.child.firstName} rides out to hold the march at ${can.town.name} for ${_num(def.years, 2)} years.`;
        RealmDecline._logLine(world, st, 'march', text);
        if (player.house) House._chronicle(player.house, world, text.slice(3), ['heirs', 'decline']);
        return { success: true, message: text.slice(3) };
    },

    _commandsWeek(world, player, st, out) {
        if (!st.commands.length) return;
        const def = RealmDecline.measureDef('marchCommand');
        const day = _day(world);
        for (const m of st.commands.slice()) {
            const child = (player.children || []).find(c => c && c.id === m.childId);
            if (!child || child.isAlive === false) { st.commands.splice(st.commands.indexOf(m), 1); continue; }
            if (day < m.until) continue;
            st.commands.splice(st.commands.indexOf(m), 1);
            const up = Upbringing.ensure(child);
            up.marchCommand = null;
            up.hardened = true;
            const soft = Array.isArray(def.softTraits) ? def.softTraits : [];
            const dropped = up.adultTraits.filter(t => soft.includes(t));
            up.adultTraits = up.adultTraits.filter(t => !soft.includes(t));
            const hard = def.hardTrait && Traits.TRAITS[def.hardTrait] ? def.hardTrait : null;
            if (hard && !up.adultTraits.includes(hard) && !(Traits.TRAITS[hard].opposite && up.adultTraits.includes(Traits.TRAITS[hard].opposite))) up.adultTraits.push(hard);
            const cap = Upbringing.config().skillCap;
            if (!_obj(child.skills)) child.skills = {};
            for (const [s, n] of Object.entries(def.skills || {})) child.skills[s] = Math.min(cap, _num(child.skills[s]) + _num(n));
            const scarred = Traits.TRAITS.scarred && _roll(world, `scar|${child.id}|${m.since}`) < _num(def.scarredChance, 0.25);
            if (scarred && !up.adultTraits.includes('scarred')) up.adultTraits.push('scarred');
            up.purple = 0;
            const text = `${child.firstName} comes home from the march at ${m.town}, harder for it${dropped.length ? ` — no longer ${dropped.map(t => (Traits.TRAITS[t] || { name: t }).name.toLowerCase()).join(' or ')}` : ''}${scarred ? ', and scarred' : ''}.`;
            RealmDecline._logLine(world, st, 'marchHome', `🛡️ ${text}`);
            if (player.house) House._chronicle(player.house, world, text, ['heirs', 'decline']);
            out.notices.push({ icon: '🛡️', title: `${child.firstName} Comes Home`, text, type: 'success' });
        }
    },

    // ── Read-outs ───────────────────────────────────────────────

    /** The State of the Realm, for the Royal Court. null without a crown. */
    report(player, world) {
        const x = RealmDecline._ctx(player, world);
        if (x.error) return null;
        const C = RealmDecline.config();
        const P = RealmDecline.pressures(player, world, x.k, x.towns);
        const old = x.st.history[0] || null;
        const strains = STRAINS.map(id => {
            const def = RealmDecline.strainDef(id);
            const value = _num(x.st.strains[id]);
            const bite = RealmDecline.bite(value);
            const trend = old ? _r1(value - _num(old[id])) : 0;
            const effects = [];
            if (id === 'graft') {
                if (bite > 0) effects.push(`about ${Math.round(_num(def.skimShare, 0.3) * bite * 100)}% of the crown's dues skimmed each week${x.st.lastSkim ? ` (${Utils.formatGold(x.st.lastSkim)}g last week)` : ''}`);
                effects.push(`${Utils.formatGold(x.st.stats.graftTotal)}g taken in all, ${Utils.formatGold(x.st.stats.recovered)}g recovered`);
            } else if (id === 'drift') {
                const fx = x.court.declineMods && x.court.declineMods.tax;
                if (fx) effects.push(`taxes ${Math.round(fx * 100)}% (the far towns' dues kept back)`);
                const far = x.court.vassals.filter(v => _num(v.drift) > 0);
                if (far.length) effects.push(`${far.length} far lord(s) think up to ${Math.max(...far.map(v => v.drift))} less of the crown`);
            } else if (id === 'soft') {
                if (bite > 0) effects.push(`children raised at court come of age ${bite >= 0.6 ? 'soft' : 'softer'}: fearful, greedy, fond of the cup`);
            } else if (id === 'entrench') {
                const fx = x.court.declineFx;
                if (fx && fx.edictCost > 1) effects.push(`edicts cost ×${fx.edictCost} to proclaim, ×${fx.edictUpkeep} to keep; the guilds and the synod move ×${fx.factionMove}`);
            }
            if (!effects.length || (bite === 0 && id !== 'graft')) effects.unshift('not yet biting');
            return {
                id, label: def.label || id, icon: def.icon || '', blurb: def.blurb || '', value, bite, trend,
                pressure: _num(P[id].value), parts: P[id].parts, effects,
                level: value >= _num(C.graveAt, 70) ? 'grave' : value >= _num(C.noticeAt, 40) ? 'biting' : value >= _num(C.biteFrom, 20) ? 'stirring' : 'quiet',
            };
        });
        const measures = MEASURES.map(id => ({ id, ...RealmDecline.measureDef(id), can: RealmDecline.can(player, world, id), cost: RealmDecline.cost(player, world, id) }));
        // Other realms' sag: the openings
        const neighbours = (world.kingdoms || [])
            .filter(o => o && o.isAlive !== false && o !== x.k)
            .map(o => ({ id: o.id, name: o.name, ...RealmDecline.aiStanding(o) }))
            .filter(o => o.bite > 0)
            .sort((a, b) => b.bite - a.bite);
        const takers = Object.values(x.st.takers).filter(t => t.take >= 1).sort((a, b) => b.take - a.take).slice(0, 6);
        return {
            kingdom: x.k, strains, measures, takers, stab: _num(x.k.decline && x.k.decline.stab),
            commands: x.st.commands.slice(), candidates: RealmDecline.marchCandidates(player, world), marchTown: RealmDecline._marchTown(player, world),
            capitals: RealmDecline.capitalCandidates(player, world), neighbours, log: x.st.log.slice(-6).reverse(), stats: { ...x.st.stats },
        };
    },
};
