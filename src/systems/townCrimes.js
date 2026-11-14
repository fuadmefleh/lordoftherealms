// ============================================
// TOWN CRIMES — deplorable acts against a whole town
// ============================================
// Four deeds done to a town rather than a person (the town's Back Rooms →
// ui/actionMenu/townCrimes.js). Each works through the systems that already
// carry its weight, and leaves marks that outlast the doer:
//
//   POISON THE WELL   poison (or carrion) down the town's well: its named
//                     townsfolk fall sick of the flux (systems/illness.js
//                     _infect: the course, the healer, the deaths, the sick
//                     share that idles the town's hands — world/townLabour.js);
//                     the well stays foul some days, striking more each day.
//                     A town without a roster keeps an abstract sickness
//                     whose `share` idles its hands the same way.
//   FALSE PLAGUE      paid criers cry plague: traders shun the town
//                     (shunFactor, read by MarketDynamics._disrupt on every
//                     trade link to it), some of its people flee to the next
//                     town till it passes (population moved, not made: fewer
//                     mouths over the same stores, so its prices fall). The
//                     physicians may find no plague (exposed: the scare ends)
//                     and the lie may be traced back to the one who paid.
//   BURN THE GRANARY  the town's granary (settlement.economy.food) and the
//                     market's grain and flour burn — worst in the lean weeks;
//                     the fire may take the street (a town fire, systems/
//                     townMemory.js). Hunger follows through the existing
//                     readers (Economy._feedPopulation, the lean-season mood,
//                     the market's scarcity and dearth); the crown, short of
//                     bread, buys grain at a premium (sellToCrown: its
//                     treasury pays, the grain goes to the town's market).
//   HOARD GRAIN       in a hungry town (a famine of the age, systems/crises.js;
//                     a market dearth; the lean weeks with thin stores) buy
//                     grain off the market (its purse paid, its stock taken)
//                     into a rented loft; sell it back dear. Legal — unless
//                     the crown forbids engrossing (systems/engrossing.js),
//                     when the loft is thrown open. Selling a hungry town its
//                     bread at a famine price is never forgotten.
//
// Being seen: odds() — the act's base, Stealth, the Underworld traits, the
// realm's heat on you and the town's size. A witness who knows your face
// names you at once; one who saw a figure may come forward later while the
// town's hunt runs. Named: heat and a rumour (Gossip), the town's and the
// witness's memory (NpcMemory — the blood kinds feed the Nemesis), the
// lord's memory (NPCLords), Prestige lost and a line in the House chronicle
// (the Annals read it), and the watch takes you if you stay. Unnamed or
// not, the town remembers the deed (TownMemory mark 'crime': its history,
// its mood) and its annals tell it.
//
// State: on the settlement (settlement.townCrimes: well, scare, hunt, want —
// saved with the tile); the player's lofts and deeds on player.townCrimes
// (saved). Player actions draw Utils' stream; the daily tick rolls hashes of
// the world seed, the town and the day. Runs with player = null.
// Content and tuning: data/townCrimes.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { Harvests } from '../world/harvests.js';
import { NPCLords } from '../world/npcLords.js';
import { TownMarks } from '../world/townMarks.js';
import { Townsfolk } from './townsfolk.js';
import { Illness } from './illness.js';
import { TownMemory } from './townMemory.js';
import { NpcMemory } from './npcMemory.js';
import { Gossip } from './gossip.js';
import { Underworld } from './underworld.js';
import { House } from './house.js';
import { Engrossing } from './engrossing.js';
import { Crises } from './crises.js';

const ACTS = ['well', 'scare', 'granary'];
const STRANGERS = ['a washerwoman', 'a carter', 'a night-soil man', 'a beggar child', 'an alewife', 'a watchman off duty'];

const DEFAULTS = {
    daysPerYear: 120,
    ap: { well: 2, scare: 2, granary: 3, hoard: 1 },
    odds: { base: { well: 0.42, scare: 0.18, granary: 0.5 }, named: { well: 0.45, scare: 0.35, granary: 0.5 }, stealthPerPoint: 0.035, heatPer: 0.004, size: {}, min: 0.04, max: 0.9 },
    hunt: { days: 60, nameChance: 0.18, arrestChance: 0.3, townHeat: 10 },
    caught: {
        prestige: { well: 40, scare: 15, granary: 30 },
        lordDeed: { well: 'raid', granary: 'raid', scare: 'insult' },
        rumor: { well: 'well_poisoning', scare: 'plague_lie', granary: 'granary_arson' },
        crime: { well: 'well_poisoning', scare: 'false_alarm', granary: 'arson' },
        memory: { well: 'well_poisoned', scare: 'plague_lie', granary: 'granary_burnt' },
        happiness: { well: -8, scare: -4, granary: -6 },
    },
    well: { means: [{ item: 'poison', qty: 1, label: 'a vial of poison', strength: 1 }], firstShare: 0.12, dailyShare: 0.03, foulDays: 8, abstractShare: 0.25, maxTracked: 80, happiness: -5 },
    scare: { cost: 40, days: 30, tradeFactor: 0.25, fleeShare: 0.12, exposeChance: 0.05, traceChance: 0.45, tracePerStealth: 0.03, happiness: -4, minPop: 150 },
    granary: { tinder: [{ item: 'lamp_oil', qty: 1, label: 'a flask of lamp oil' }], share: 0.55, leanShare: 0.85, marketGoods: ['grain', 'flour'], spreadChance: 0.2, spreadShare: [0.04, 0.12], crownPremium: 1.5, wantDays: 45, happiness: -6 },
    hoard: { loftFee: 2, spoil: 0.01, grudgeRatio: 1.5, lowReserveDays: 4, maxPerBuy: 200, batch: 5 },
    lines: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _key = (q, r) => `${q},${r}`;
const _day = world => _num(world && world.day, 0);
const _r1 = v => Math.round(v * 10) / 10;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}
const _frac = str => _hash(str) / 4294967296;

/** A small seeded stream (mulberry32) for the daily tick: never the shared RNG. */
function _stream(str) {
    let a = _hash(str) || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _seed = world => (world && (world.seed != null ? world.seed : (world.generationParams && world.generationParams.seed))) || 0;

let _cfg = null;
let _cfgSrc;

export const TownCrimes = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townCrimes : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const m = k => ({ ...DEFAULTS[k], ...(_obj(d[k]) || {}) });
            _cfg = {
                daysPerYear: _num(d.daysPerYear, DEFAULTS.daysPerYear),
                ap: m('ap'), odds: m('odds'), hunt: m('hunt'), caught: m('caught'),
                well: m('well'), scare: m('scare'), granary: m('granary'), hoard: m('hoard'),
                lines: { ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    /** A line of prose (a hash of the seed picks it), {vars} filled in. */
    line(kind, vars = {}, seed = '') {
        const pool = TownCrimes.config().lines[kind] || [];
        if (!pool.length) return '';
        const t = pool[Math.floor(_frac(`${seed}|${kind}`) * pool.length) % pool.length];
        return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
    },

    // ── State ─────────────────────────────────────────

    /** The town's record of what was done to it (settlement.townCrimes). */
    townState(s, create = false) {
        if (!s) return null;
        if (!_obj(s.townCrimes)) {
            if (!create) return null;
            s.townCrimes = {};
        }
        return s.townCrimes;
    },

    /** The player's lofts and deeds (player.townCrimes, saved). */
    state(player) {
        if (!player) return null;
        if (!_obj(player.townCrimes)) player.townCrimes = { hoards: {}, deeds: [] };
        const st = player.townCrimes;
        if (!_obj(st.hoards)) st.hoards = {};
        if (!Array.isArray(st.deeds)) st.deeds = [];
        return st;
    },

    _deed(player, rec) {
        const st = TownCrimes.state(player);
        st.deeds.unshift(rec);
        if (st.deeds.length > 30) st.deeds.length = 30;
        return rec;
    },

    _kingdom(world, s) {
        if (!world || !s || s.kingdom == null) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(s.kingdom) || null;
        return ((world.kingdoms) || []).find(k => k && k.id === s.kingdom) || null;
    },

    _views(world) {
        return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews().filter(Boolean) : [];
    },

    _held(player, item) {
        return Math.floor(_num(player && player.inventory && player.inventory[item]));
    },

    _take(player, item, qty) {
        const have = TownCrimes._held(player, item);
        const n = Math.min(have, qty);
        if (n <= 0) return 0;
        player.inventory[item] = have - n;
        if (player.inventory[item] <= 0) delete player.inventory[item];
        return n;
    },

    _ap(player, act) {
        const cost = _num(TownCrimes.config().ap[act], 0);
        if (!(cost > 0) || typeof (player && player.actionPoints) !== 'number') return null;
        return player.actionPoints < cost ? `You need ${cost} action points for that.` : null;
    },

    _spendAp(player, act) {
        const cost = _num(TownCrimes.config().ap[act], 0);
        if (cost > 0 && typeof player.actionPoints === 'number') player.actionPoints = Math.max(0, player.actionPoints - cost);
    },

    // ── Being seen ────────────────────────────────────

    /** The chance someone sees the deed, and the share of those who know your face. */
    odds(player, world, s, act) {
        const O = TownCrimes.config().odds;
        const stealth = _num(player && player.skills && player.skills.stealth, 1);
        let traits = 0;
        try { traits = _num(Underworld.traitBonus(player)); } catch (e) { traits = 0; }
        let heat = 0;
        try { heat = s && s.kingdom != null ? _num(Underworld.getHeat(player, s.kingdom)) : 0; } catch (e) { heat = 0; }
        const p = _num((O.base || {})[act], 0.4) - stealth * _num(O.stealthPerPoint, 0.035) - traits
            + heat * _num(O.heatPer, 0.004) + _num((O.size || {})[s && s.type], 0);
        return { seen: _clamp(p, _num(O.min, 0.04), _num(O.max, 0.9)), named: _clamp(_num((O.named || {})[act], 0.4), 0, 1) };
    },

    /** Someone who might have seen: a grown resident of the roster, else a stranger. */
    _witness(s, rnd, day = 0) {
        const folk = s && s.folk;
        const adults = folk && Array.isArray(folk.people)
            ? Townsfolk.residents(folk).filter(p => p.born == null || Townsfolk.age(p, day) >= 12)
            : [];
        if (adults.length) {
            const p = adults[Math.floor(rnd() * adults.length) % adults.length];
            return { name: Townsfolk.name(p), id: p.id };
        }
        return { name: STRANGERS[Math.floor(rnd() * STRANGERS.length) % STRANGERS.length], id: null };
    },

    /** Roll whether the deed was seen: → { seen, named, witness }. */
    detect(player, world, s, act, rnd = Utils.random) {
        const o = TownCrimes.odds(player, world, s, act);
        if (!(rnd() < o.seen)) return { seen: false, named: false, witness: null };
        const witness = TownCrimes._witness(s, rnd, _day(world));
        return { seen: true, named: rnd() < o.named, witness };
    },

    /** The town hunts whoever did it; a witness who saw a figure may name you later. */
    _startHunt(world, s, act, det, day) {
        const H = TownCrimes.config().hunt;
        const ts = TownCrimes.townState(s, true);
        ts.hunt = { act, d: day, until: day + _num(H.days, 60), seen: !!det.seen, named: false };
        if (det.witness) { ts.hunt.witness = det.witness.name; if (det.witness.id != null) ts.hunt.wid = det.witness.id; }
        return ts.hunt;
    },

    /**
     * The culprit is named: heat and a rumour, the town's and the witness's memory, the
     * lord's, Prestige lost and a line in the House chronicle. → the text of it.
     */
    _named(player, world, s, act, witness, day) {
        const C = TownCrimes.config().caught;
        const ts = TownCrimes.townState(s, true);
        const k = TownCrimes._kingdom(world, s);
        // The watch's heat: the caught share over the deed's own
        try {
            const def = Underworld.crimeDef(C.crime[act]);
            const extra = Math.max(0, _num(def.caughtHeat) - _num(def.heat));
            if (s.kingdom != null && extra > 0) Underworld.addHeat(player, s.kingdom, extra, world);
        } catch (e) { /* no underworld */ }
        // The talk: a rumour that spreads town to town (reputation, a bounty)
        try {
            Gossip.reportCrime(player, world, {
                crimeType: C.rumor[act],
                victim: { name: `the folk of ${s.name}`, type: 'peasant', icon: '🏘️' },
                q: s.q, r: s.r,
                scene: { npcs: [{ name: witness || 'a witness', type: 'peasant', id: 'tc-witness', q: 0, r: 0 }], q: 0, r: 0, radius: 1 },
            });
        } catch (e) { /* no gossip */ }
        // The town remembers, and so does the one who named you
        const kind = C.memory[act];
        try { NpcMemory.rememberTown(world, s, { kind, player, day }); } catch (e) { /* no memory */ }
        const folk = s.folk;
        if (folk && Array.isArray(folk.people)) {
            const hunt = ts.hunt;
            const wp = hunt && hunt.wid != null ? Townsfolk.get(folk, hunt.wid) : null;
            if (wp) { try { NpcMemory.remember(world, { folk, person: wp }, { kind, player, day }); } catch (e) { /* none */ } }
            // The well's sick remember drinking of it; the kin of its dead remember them
            const well = ts.well;
            if (act === 'well' && well && Array.isArray(well.cases)) {
                for (const id of well.cases) {
                    const p = Townsfolk.get(folk, id);
                    if (!p) continue;
                    try {
                        if (p.died != null) NpcMemory.rememberKin(world, { folk, person: p }, { kind, player, day, victim: p });
                        else NpcMemory.remember(world, { folk, person: p }, { kind, player, day });
                    } catch (e) { /* none */ }
                }
            }
        }
        // The lord of the town remembers who did it to his people
        if (k && k.lord && C.lordDeed[act]) {
            try { NPCLords.rememberDeed(world, k.lord, C.lordDeed[act], { day, note: s.name }); } catch (e) { /* none */ }
        }
        s.happiness = _clamp(_num(s.happiness, 50) + _num(C.happiness[act]), 0, 100);
        // The House's name: Prestige lost, a line in its chronicle (the Annals read it)
        const what = act === 'well' ? `poisoned the well of ${s.name}` : act === 'granary' ? `burnt the granary of ${s.name}` : `cried a false plague on ${s.name}`;
        let lost = 0;
        if (player && player.house) {
            const h = player.house;
            lost = Math.min(_num(h.prestige), _num(C.prestige[act]));
            if (lost > 0) {
                h.prestige -= lost;
                House._logPrestige(h, day, -lost, `named: ${what}`);
            }
            House._chronicle(h, world, `${player.name || 'The head of the House'} was named as the one who ${what}${witness ? `, by ${witness}` : ''}.`, ['crime', 'townCrime', act]);
        }
        // The town's history names the culprit now
        let mark = ts.marks && ts.marks[act] ? TownMarks.markById(s, ts.marks[act]) : null;
        if (!mark && act === 'scare') mark = TownCrimes._mark(world, s, 'scare', {}, day);
        if (mark) mark.by = (player && player.name) || mark.by || null;
        if (ts.hunt && ts.hunt.act === act) { ts.hunt.named = true; ts.hunt.namedDay = day; }
        if (folk && Array.isArray(folk.annals)) {
            try { Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${player && player.name ? player.name : 'A stranger'} was named {when} as the one who ${what}.` }); } catch (e) { /* none */ }
        }
        const st = TownCrimes.state(player);
        const deed = st.deeds.find(x => x.act === act && x.q === s.q && x.r === s.r && !x.caught);
        if (deed) { deed.caught = true; deed.caughtDay = day; }
        return { lost, text: `You are named as the one who ${what}${lost ? ` — the House loses ${lost} Prestige` : ''}.` };
    },

    /** The town's history keeps the deed (TownMemory mark 'crime'). → the mark */
    _mark(world, s, act, info, day) {
        const ts = TownCrimes.townState(s, true);
        ts.marks = ts.marks || {};
        const m = TownMemory.mark(s, 'crime', { crime: act, ...info, d: day }, world);
        if (m) ts.marks[act] = m.id;
        return m;
    },

    /** Common to every act: the crime's heat and deeds, the town's mark and annals, the deed log, the hunt. */
    _afterAct(player, world, s, act, det, day, info = {}) {
        const C = TownCrimes.config().caught;
        try { Underworld.recordCrime(player, world, C.crime[act], { kingdom: s.kingdom || null, q: s.q, r: s.r }); } catch (e) { /* none */ }
        const ts = TownCrimes.townState(s, true);
        ts.marks = ts.marks || {};
        // (a plague scare is no crime in the town's eyes until it is known for a lie: marked when exposed or traced)
        if (act !== 'scare') TownCrimes._mark(world, s, act, info, day);
        TownCrimes._deed(player, { act, q: s.q, r: s.r, town: s.name, d: day, caught: false, seen: !!det.seen });
        if (act !== 'scare') TownCrimes._startHunt(world, s, act, det, day);
        let named = null;
        if (det.named) named = TownCrimes._named(player, world, s, act, det.witness && det.witness.name, day);
        return named;
    },

    // ── The well ──────────────────────────────────────

    /** What the player could put down the well: the first means held, or null. */
    wellMeans(player) {
        for (const m of TownCrimes.config().well.means || []) if (TownCrimes._held(player, m.item) >= _num(m.qty, 1)) return m;
        return null;
    },

    /** Is the town's well foul today? */
    wellFoul(s, day) {
        const w = s && s.townCrimes && s.townCrimes.well;
        return !!(w && day <= _num(w.until, -1));
    },

    canPoisonWell(player, world, s) {
        if (!s) return { ok: false, why: 'There is no town here.' };
        if (TownCrimes.wellFoul(s, _day(world))) return { ok: false, why: 'The well is foul already.' };
        const ap = TownCrimes._ap(player, 'well');
        if (ap) return { ok: false, why: ap };
        const m = TownCrimes.wellMeans(player);
        if (!m) return { ok: false, why: `You carry nothing to foul it with (${(TownCrimes.config().well.means || []).map(x => x.label).join(', or ')}).` };
        return { ok: true, means: m };
    },

    /** Strike `share` of the town's healthy with the flux from the well (a roster), or an abstract sickness. */
    _strikeWell(world, s, rec, day, share, rnd) {
        const W = TownCrimes.config().well;
        const folk = s.folk;
        if (!Illness.on()) return 0;
        if (folk && Array.isArray(folk.people)) {
            try { Illness.state(world, s, folk, day); } catch (e) { /* fresh roster */ }
            const open = Townsfolk.residents(folk).filter(p => !p.ill && !Illness._immune(p, 'flux', day));
            let n = Math.min(open.length, Math.round(open.length * share));
            if (n === 0 && open.length && share > 0 && rnd() < open.length * share) n = 1;
            for (let i = 0; i < n; i++) {
                const p = open.splice(Math.floor(rnd() * open.length) % open.length, 1)[0];
                if (!p) break;
                if (Illness._infect(folk, p, 'flux', day, rnd, 'a poisoned well')) {
                    if (rec.cases.length < _num(W.maxTracked, 80)) rec.cases.push(p.id);
                    rec.struck = _num(rec.struck) + 1;
                }
            }
            return n;
        }
        // No roster: the town keeps an abstract sickness (it seeds the roster it gets; its share idles hands)
        s.sickness = { k: 'flux', d: day, until: _num(rec.until, day) + 6, abs: true, share: Math.round(_num(W.abstractShare, 0.25) * _num(rec.str, 1) * 100) / 100, from: null };
        rec.struck = Math.max(_num(rec.struck), Math.round(_num(s.population) * share * 0.1));
        return 0;
    },

    poisonWell(player, world, s, rnd = Utils.random) {
        const can = TownCrimes.canPoisonWell(player, world, s);
        if (!can.ok) return { success: false, reason: can.why };
        const W = TownCrimes.config().well;
        const day = _day(world);
        const m = can.means;
        TownCrimes._take(player, m.item, _num(m.qty, 1));
        TownCrimes._spendAp(player, 'well');
        const ts = TownCrimes.townState(s, true);
        const rec = { d: day, until: day + _num(W.foulDays, 8), str: _num(m.strength, 1), means: m.item, cases: [], struck: 0, dead: 0 };
        ts.well = rec;
        TownCrimes._strikeWell(world, s, rec, day, _num(W.firstShare, 0.12) * rec.str, rnd);
        s.happiness = _clamp(_num(s.happiness, 50) + _num(W.happiness, -5), 0, 100);
        const det = TownCrimes.detect(player, world, s, 'well', rnd);
        const named = TownCrimes._afterAct(player, world, s, 'well', det, day, { means: m.item });
        const vars = { town: s.name, means: m.label, witness: det.witness ? det.witness.name : '' };
        let text = TownCrimes.line('wellDone', vars, `${s.name}|${day}`);
        if (named) text += ` ${TownCrimes.line('wellNamed', vars, `${s.name}|${day}`)} ${named.text}`;
        else if (det.seen) text += ` ${TownCrimes.line('wellSeen', vars, `${s.name}|${day}`)}`;
        return { success: true, text, seen: det.seen, named: !!named, struck: rec.struck };
    },

    // ── The false plague ──────────────────────────────

    /** The scare running in a town today (not exposed), or null. */
    scareOf(s, day) {
        const sc = s && s.townCrimes && s.townCrimes.scare;
        return sc && !sc.exposed && day <= _num(sc.until, -1) ? sc : null;
    },

    /**
     * The trade factor of a link while either end is under a plague scare: traders keep
     * away (MarketDynamics._disrupt multiplies the link's factor by it).
     */
    shunFactor(world, link) {
        if (!link) return 1;
        const day = _day(world);
        const f = _num(TownCrimes.config().scare.tradeFactor, 0.25);
        let out = 1;
        for (const s of [link.a, link.b]) if (s && s.townCrimes && TownCrimes.scareOf(s, day)) out *= f;
        return out;
    },

    _nearestTown(world, s) {
        let best = null, bd = Infinity;
        for (const o of TownCrimes._views(world)) {
            if (o === s || (o.q === s.q && o.r === s.r) || !Number.isFinite(o.q)) continue;
            const d = world.width ? Hex.wrappingDistance(s.q, s.r, o.q, o.r, world.width) : Hex.distance(s.q, s.r, o.q, o.r);
            if (d < bd) { bd = d; best = o; }
        }
        return best;
    },

    canScare(player, world, s) {
        const S = TownCrimes.config().scare;
        if (!s) return { ok: false, why: 'There is no town here.' };
        const day = _day(world);
        if (TownCrimes.scareOf(s, day)) return { ok: false, why: 'The town is already in a plague panic.' };
        if (_num(s.population) < _num(S.minPop, 150)) return { ok: false, why: 'Too few folk here for a panic to take.' };
        const ap = TownCrimes._ap(player, 'scare');
        if (ap) return { ok: false, why: ap };
        if (_num(player && player.gold) < _num(S.cost, 40)) return { ok: false, why: `The criers and beggars want ${S.cost}g.` };
        return { ok: true };
    },

    spreadScare(player, world, s, rnd = Utils.random) {
        const can = TownCrimes.canScare(player, world, s);
        if (!can.ok) return { success: false, reason: can.why };
        const S = TownCrimes.config().scare;
        const day = _day(world);
        const cost = _num(S.cost, 40);
        player.gold -= cost;
        Economy.payTown(s, cost); // the criers and beggars spend it in town
        TownCrimes._spendAp(player, 'scare');
        const ts = TownCrimes.townState(s, true);
        const to = TownCrimes._nearestTown(world, s);
        const pop = Math.max(0, _num(s.population));
        const fled = to ? Math.max(0, Math.floor(pop * _num(S.fleeShare, 0.12))) : 0;
        if (fled > 0) {
            s.population = pop - fled;
            to.population = _num(to.population) + fled;
        }
        if (ts.marks) delete ts.marks.scare; // (a new scare: its own mark, when it comes to light)
        ts.scare = { d: day, until: day + _num(S.days, 30), fled, to: to ? { q: to.q, r: to.r, name: to.name } : null, exposed: false };
        s.happiness = _clamp(_num(s.happiness, 50) + _num(S.happiness, -4), 0, 100);
        const det = TownCrimes.detect(player, world, s, 'scare', rnd);
        const named = TownCrimes._afterAct(player, world, s, 'scare', det, day, {});
        if (named) ts.scare.traced = true;
        const vars = { town: s.name, witness: det.witness ? det.witness.name : '' };
        let text = TownCrimes.line('scareDone', vars, `${s.name}|${day}`);
        if (fled > 0) text += ` ${fled} folk take to the roads for ${to.name}.`;
        if (named) text += ` ${TownCrimes.line('scareNamed', vars, `${s.name}|${day}`)} ${named.text}`;
        return { success: true, text, fled, named: !!named };
    },

    /** The scare ends (run its course, or exposed): the ones who fled come home. */
    _endScare(world, s, sc) {
        if (sc.to && sc.fled > 0 && world && typeof world.getTile === 'function') {
            const t = world.getTile(sc.to.q, sc.to.r);
            const o = t && t.settlement;
            const back = o ? Math.min(sc.fled, Math.max(0, _num(o.population) - 10)) : 0;
            if (back > 0) {
                o.population -= back;
                s.population = _num(s.population) + back;
            }
            sc.returned = back;
        }
        delete s.townCrimes.scare;
    },

    // ── The granary ───────────────────────────────────

    tinderOf(player) {
        for (const t of TownCrimes.config().granary.tinder || []) if (TownCrimes._held(player, t.item) >= _num(t.qty, 1)) return t;
        return null;
    },

    canBurnGranary(player, world, s) {
        if (!s) return { ok: false, why: 'There is no town here.' };
        if (!s.economy || !(_num(s.economy.food) > 0)) return { ok: false, why: 'The granary is empty: there is nothing in it to burn.' };
        const ts = TownCrimes.townState(s);
        if (ts && ts.want && _day(world) <= _num(ts.want.until, -1)) return { ok: false, why: 'The granary is still a ruin from the last fire.' };
        const ap = TownCrimes._ap(player, 'granary');
        if (ap) return { ok: false, why: ap };
        const t = TownCrimes.tinderOf(player);
        if (!t) return { ok: false, why: `You need something to start it (${(TownCrimes.config().granary.tinder || []).map(x => x.label).join(', or ')}).` };
        return { ok: true, tinder: t };
    },

    burnGranary(player, world, s, rnd = Utils.random) {
        const can = TownCrimes.canBurnGranary(player, world, s);
        if (!can.ok) return { success: false, reason: can.why };
        const G = TownCrimes.config().granary;
        const day = _day(world);
        TownCrimes._take(player, can.tinder.item, _num(can.tinder.qty, 1));
        TownCrimes._spendAp(player, 'granary');
        const lean = Seasons.isLean(day);
        const share = _clamp(lean ? _num(G.leanShare, 0.85) : _num(G.share, 0.55), 0, 1);
        const econ = s.economy;
        const food = Math.max(0, _num(econ.food));
        const burnt = { granary: Math.round(food * share) };
        econ.food = Math.round((food - burnt.granary) * 100) / 100;
        for (const g of G.marketGoods || []) {
            const n = SettlementMarket.stock(s, g) * share;
            burnt[g] = Math.round(SettlementMarket.take(s, g, n));
        }
        s.happiness = _clamp(_num(s.happiness, 50) + _num(G.happiness, -6), 0, 100);
        const ts = TownCrimes.townState(s, true);
        ts.want = { d: day, until: day + _num(G.wantDays, 45), premium: _num(G.crownPremium, 1.5) };
        // The fire may take the street about it: a town fire, with all a fire brings
        let spread = null;
        if (rnd() < _num(G.spreadChance, 0.2)) {
            const [a, b] = Array.isArray(G.spreadShare) ? G.spreadShare : [0.04, 0.12];
            spread = TownMemory.mark(s, 'fire', { cause: 'arson', share: a + rnd() * (b - a), great: false }, world);
        }
        const det = TownCrimes.detect(player, world, s, 'granary', rnd);
        const total = Object.values(burnt).reduce((a, v) => a + v, 0);
        const named = TownCrimes._afterAct(player, world, s, 'granary', det, day, { burnt: total, lean });
        const vars = { town: s.name, witness: det.witness ? det.witness.name : '' };
        let text = `${TownCrimes.line('granaryDone', vars, `${s.name}|${day}`)} About ${total} measures of grain, flour and stored food are lost${lean ? ', in the lean weeks when nothing will replace them' : ''}.`;
        if (spread) text += ` ${TownCrimes.line('granarySpread', vars, `${s.name}|${day}`)}`;
        if (named) text += ` ${TownCrimes.line('granaryNamed', vars, `${s.name}|${day}`)} ${named.text}`;
        else if (det.seen) text += ' Someone saw a figure running from the fire.';
        return { success: true, text, burnt, lean, spread: !!spread, named: !!named };
    },

    // ── Grain: hoarding, and the crown's need ─────────

    _grainGood() {
        return Object.values(Economy._goods()).find(g => g && g.id === 'grain') || { id: 'grain', basePrice: 4 };
    },

    _tileOf(world, s) {
        return world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
    },

    /** What a unit of grain costs at the town's market today. */
    grainPrice(world, s) {
        return Economy.marketPrice(TownCrimes._grainGood(), s, TownCrimes._tileOf(world, s), world);
    },

    /** Why the town is hungry (a famine of the age, a dearth, the lean weeks on thin stores), or null. */
    hungry(world, s) {
        if (!s) return null;
        const day = _day(world);
        try {
            const c = Crises.active(world);
            if (c && c.kind === 'famine' && c.phase === 'hungry' && c.data && Array.isArray(c.data.regions)
                && c.data.regions.includes(Harvests.regionOf(world, s.q, s.r))) return `the famine (${c.name || 'the Hungry Years'})`;
        } catch (e) { /* no crisis */ }
        if (SettlementMarket.inDearth(s)) return 'a dearth in the market';
        if (Seasons.isLean(day) && s.economy && Economy.foodReserveDays(s) < _num(TownCrimes.config().hoard.lowReserveDays, 4)) return 'the lean weeks, its stores thin';
        const ts = TownCrimes.townState(s);
        if (ts && ts.want && day <= _num(ts.want.until, -1)) return 'its granary burnt';
        return null;
    },

    hoardAt(player, s) {
        const st = TownCrimes.state(player);
        return st && s ? st.hoards[_key(s.q, s.r)] || null : null;
    },

    canHoard(player, world, s) {
        if (!s) return { ok: false, why: 'There is no town here.' };
        if (s.kingdom != null && Engrossing.banned(world, s.kingdom)) return { ok: false, why: 'The crown has forbidden engrossing here.' };
        const why = TownCrimes.hungry(world, s);
        if (!why) return { ok: false, why: 'The town is not hungry: grain hoarded now would fetch no more than it cost.' };
        const ap = TownCrimes._ap(player, 'hoard');
        if (ap) return { ok: false, why: ap };
        if (SettlementMarket.available(s, 'grain') < 1) return { ok: false, why: 'There is no grain left in the market to buy.' };
        if (_num(player && player.gold) < TownCrimes.grainPrice(world, s)) return { ok: false, why: 'You cannot pay for a single measure.' };
        return { ok: true, why };
    },

    /** Buy up to `qty` grain off the market into a loft here (the price climbs as the stock falls). */
    hoardGrain(player, world, s, qty) {
        const can = TownCrimes.canHoard(player, world, s);
        if (!can.ok) return { success: false, reason: can.why };
        const H = TownCrimes.config().hoard;
        const want = Math.min(Math.max(1, Math.floor(_num(qty, 1))), _num(H.maxPerBuy, 200));
        const step = Math.max(1, _num(H.batch, 5));
        let n = 0, spent = 0;
        while (n < want) {
            const unit = TownCrimes.grainPrice(world, s);
            const b = Math.min(step, want - n, SettlementMarket.available(s, 'grain'), Math.floor(_num(player.gold) / unit));
            if (!(b > 0)) break;
            const got = Math.floor(SettlementMarket.take(s, 'grain', b));
            if (!(got > 0)) break;
            player.gold -= got * unit;
            spent += got * unit;
            n += got;
        }
        if (!(n > 0)) return { success: false, reason: 'You could buy nothing.' };
        Economy.payTown(s, spent); // the grain sellers' takings
        TownCrimes._spendAp(player, 'hoard');
        const st = TownCrimes.state(player);
        const k = _key(s.q, s.r);
        const h = st.hoards[k] || (st.hoards[k] = { q: s.q, r: s.r, town: s.name, grain: 0, paid: 0, d: _day(world) });
        h.grain = _r1(h.grain + n);
        h.paid = Math.round(h.paid + spent);
        return { success: true, bought: n, spent, text: `You buy ${n} measures of grain off ${s.name}'s market for ${spent}g and lock them in a rented loft. The price at the market cross climbs behind you.` };
    },

    /** Sell up to `qty` of the loft back into the market (its purse pays; the price falls as it fills). */
    sellHoard(player, world, s, qty) {
        const h = TownCrimes.hoardAt(player, s);
        if (!h || !(h.grain >= 1)) return { success: false, reason: 'You hold no grain here.' };
        const H = TownCrimes.config().hoard;
        const want = Math.min(Math.floor(h.grain), Math.max(1, Math.floor(_num(qty, h.grain))));
        const avg = h.grain > 0 ? h.paid / h.grain : 0;
        const step = Math.max(1, _num(H.batch, 5));
        const hungry = TownCrimes.hungry(world, s);
        let n = 0, got = 0, best = 0;
        while (n < want) {
            const unit = TownCrimes.grainPrice(world, s);
            const b = Math.min(step, want - n);
            const paid = Economy.drawTown(s, unit * b);
            const units = unit > 0 ? Math.floor(paid / unit + 1e-9) : 0;
            if (paid > units * unit) Economy.payTown(s, paid - units * unit); // (change back to the purse)
            if (!(units > 0)) break;
            SettlementMarket.add(s, 'grain', units);
            got += units * unit;
            n += units;
            best = Math.max(best, unit);
            if (units < b) break;
        }
        if (!(n > 0)) return { success: false, reason: `The merchants of ${s.name} have no coin left to buy with.` };
        player.gold = _num(player.gold) + got;
        h.grain = _r1(h.grain - n);
        h.paid = Math.max(0, Math.round(h.paid - avg * n));
        const st = TownCrimes.state(player);
        if (!(h.grain >= 0.5)) delete st.hoards[_key(s.q, s.r)];
        let text = `You sell ${n} measures of grain into ${s.name}'s market for ${got}g${avg > 0 ? ` (they cost you ${Math.round(avg * n)}g)` : ''}.`;
        let grudge = false;
        if (hungry && avg > 0 && best >= avg * _num(H.grudgeRatio, 1.5)) {
            grudge = TownCrimes._grudge(player, world, s, _day(world));
            if (grudge) text += ` ${TownCrimes.line('hoardGrudge', { town: s.name }, `${s.name}|${_day(world)}`)}`;
        }
        return { success: true, sold: n, earned: got, grudge, text };
    },

    /** The town remembers who sold it its own bread at a famine price (the town, and a few of its folk). */
    _grudge(player, world, s, day) {
        let any = false;
        try { any = !!NpcMemory.rememberTown(world, s, { kind: 'grain_hoarded', player, day }); } catch (e) { any = false; }
        const folk = s.folk;
        if (folk && Array.isArray(folk.people)) {
            const res = Townsfolk.residents(folk).sort((a, b) => _frac(`hoard|${a.id}|${day}`) - _frac(`hoard|${b.id}|${day}`)).slice(0, 5);
            for (const p of res) { try { if (NpcMemory.remember(world, { folk, person: p }, { kind: 'grain_hoarded', player, day })) any = true; } catch (e) { /* none */ } }
            try { Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${player.name || 'A stranger'} sold the town its own grain at a famine price {when}.` }); } catch (e) { /* none */ }
        }
        return any;
    },

    /** Does the crown want grain here (its granary burnt, or the town hungry)? → the premium, or 0. */
    crownWants(world, s) {
        if (!s || s.kingdom == null) return 0;
        const k = TownCrimes._kingdom(world, s);
        if (!k || !(_num(k.treasury) > 0)) return 0;
        const ts = TownCrimes.townState(s);
        if (ts && ts.want && _day(world) <= _num(ts.want.until, -1)) return _num(ts.want.premium, 1.5);
        return TownCrimes.hungry(world, s) ? Math.max(1, _num(TownCrimes.config().granary.crownPremium, 1.5) - 0.25) : 0;
    },

    /** Sell grain (the loft here first, then your packs) to the crown: its treasury pays a premium, the town's market gets the grain. */
    sellToCrown(player, world, s, qty) {
        const prem = TownCrimes.crownWants(world, s);
        if (!(prem > 0)) return { success: false, reason: 'The crown is buying no grain here.' };
        const k = TownCrimes._kingdom(world, s);
        const h = TownCrimes.hoardAt(player, s);
        const have = Math.floor(_num(h && h.grain)) + TownCrimes._held(player, 'grain');
        if (!(have > 0)) return { success: false, reason: 'You have no grain to sell.' };
        const unit = Math.max(1, Math.round(TownCrimes.grainPrice(world, s) * prem));
        const n = Math.min(have, Math.max(1, Math.floor(_num(qty, have))), Math.floor(_num(k.treasury) / unit));
        if (!(n > 0)) return { success: false, reason: 'The crown\'s treasury cannot pay for a single measure.' };
        const fromLoft = Math.min(n, Math.floor(_num(h && h.grain)));
        if (fromLoft > 0) {
            const avg = h.grain > 0 ? h.paid / h.grain : 0;
            h.grain = _r1(h.grain - fromLoft);
            h.paid = Math.max(0, Math.round(h.paid - avg * fromLoft));
            if (!(h.grain >= 0.5)) delete TownCrimes.state(player).hoards[_key(s.q, s.r)];
        }
        if (n > fromLoft) TownCrimes._take(player, 'grain', n - fromLoft);
        const pay = n * unit;
        k.treasury = Math.round((_num(k.treasury) - pay) * 100) / 100;
        player.gold = _num(player.gold) + pay;
        SettlementMarket.add(s, 'grain', n);
        try { if (k.lord) NPCLords.rememberDeed(world, k.lord, 'gift', { day: _day(world), note: `grain for ${s.name}`, weight: Math.min(6, 1 + n / 50) }); } catch (e) { /* none */ }
        return { success: true, sold: n, earned: pay, text: `The crown's factor takes ${n} measures of grain for ${s.name} at ${unit}g each — ${pay}g from the treasury of ${k.name}. The bread goes to the market cross.` };
    },

    // ── The days ──────────────────────────────────────

    /** One day: the foul well, the scares, the hunts; the player's lofts. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        const day = _day(world);
        const seed = _seed(world);
        for (const s of TownCrimes._views(world)) {
            if (!_obj(s.townCrimes)) continue;
            TownCrimes._townDay(world, player, s, day, seed, out);
        }
        if (player && _obj(player.townCrimes)) TownCrimes._loftsDay(world, player, day, out);
        return out;
    },

    _knows(player, s) {
        return !!player && Math.abs(_num(player.q) - s.q) + Math.abs(_num(player.r) - s.r) <= 6;
    },

    _townDay(world, player, s, day, seed, out) {
        const ts = s.townCrimes;
        const W = TownCrimes.config().well;
        const roll = key => _frac(`${seed}|tc|${key}|${s.q},${s.r}|${day}`);
        // The foul well: more fall sick each day it stays foul; the dead counted
        const w = ts.well;
        if (w) {
            if (day > w.d && day <= _num(w.until, -1)) TownCrimes._strikeWell(world, s, w, day, _num(W.dailyShare, 0.03) * _num(w.str, 1), _stream(`${seed}|well|${s.q},${s.r}|${day}`));
            const folk = s.folk;
            if (folk && Array.isArray(folk.people)) {
                let dead = 0;
                for (const id of w.cases) { const p = Townsfolk.get(folk, id); if (p && p.died != null && p.died >= w.d) dead++; }
                w.dead = dead;
            }
            if (day > _num(w.until) + 15) {
                const m = ts.marks && ts.marks.well ? TownMarks.markById(s, ts.marks.well) : null;
                if (m) { m.dead = _num(w.dead); m.struck = _num(w.struck); }
                if (folk && Array.isArray(folk.annals) && w.dead > 0) {
                    try { Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${w.dead} died of the poisoned well {when}.` }); } catch (e) { /* none */ }
                }
                if (TownCrimes._knows(player, s)) out.notices.push({ icon: '🚰', title: `The Well of ${s.name}`, text: `The well of ${s.name} runs clean again. ${_num(w.struck)} fell sick of it${w.dead ? `, ${w.dead} died` : ''}.`, type: 'info' });
                delete ts.well;
            }
        }
        // The scare: it may be exposed (none while the town truly is sick); the fled come home at its end
        const sc = ts.scare;
        if (sc) {
            const sick = TownCrimes.wellFoul(s, day) || (() => {
                try { const k = Illness.townSickness(s, day); return !!(k && k.k && (Illness.def(k.k) || {}).serious); } catch (e) { return false; }
            })();
            if (!sc.exposed && !sick && day > sc.d && roll('expose') < _num(TownCrimes.config().scare.exposeChance, 0.05)) {
                sc.exposed = true;
                if (!(ts.marks && ts.marks.scare && TownMarks.markById(s, ts.marks.scare))) TownCrimes._mark(world, s, 'scare', {}, day);
                if (TownCrimes._knows(player, s)) out.notices.push({ icon: '⚕️', title: `No Plague at ${s.name}`, text: TownCrimes.line('exposed', { town: s.name }, `${s.name}|${day}`), type: 'info' });
                const S = TownCrimes.config().scare;
                const stealth = _num(player && player.skills && player.skills.stealth, 1);
                const st = player && TownCrimes.state(player);
                const ours = st && st.deeds.some(x => x.act === 'scare' && x.q === s.q && x.r === s.r && x.d === sc.d);
                if (ours && !sc.traced && roll('trace') < _clamp(_num(S.traceChance, 0.45) - stealth * _num(S.tracePerStealth, 0.03), 0.05, 0.95)) {
                    sc.traced = true;
                    const r = TownCrimes._named(player, world, s, 'scare', 'the criers you paid', day);
                    out.notices.push({ icon: '🐀', title: 'The Plague Lie Traced', text: `${TownCrimes.line('traced', { town: s.name }, `${s.name}|${day}`)} ${r.text}`, type: 'warning' });
                }
            }
            if (sc.exposed || day > _num(sc.until, -1)) TownCrimes._endScare(world, s, sc);
        }
        // The hunt for the culprit: a witness may come forward; a named culprit in town is taken
        const h = ts.hunt;
        if (h) {
            const H = TownCrimes.config().hunt;
            const st = player ? TownCrimes.state(player) : null;
            const ours = st && st.deeds.some(x => x.act === h.act && x.q === s.q && x.r === s.r && x.d === h.d);
            if (ours && !h.named && h.seen && (day - h.d) % 7 === 0 && day > h.d && roll('name') < _num(H.nameChance, 0.18)) {
                const r = TownCrimes._named(player, world, s, h.act, h.witness, day);
                out.notices.push({ icon: '👁️', title: `Named in ${s.name}`, text: `${h.witness || 'A witness'} has come forward. ${r.text}`, type: 'warning' });
            }
            if (ours && h.named && !h.taken && player.q === s.q && player.r === s.r && !player.jailState && roll('arrest') < _num(H.arrestChance, 0.3)) {
                h.taken = day;
                let jail = null;
                try { jail = Underworld._arrest(player, world, s, h.act === 'well' ? 'poisoning the town well' : h.act === 'granary' ? 'burning the granary' : 'crying false plague'); } catch (e) { jail = null; }
                out.notices.push({ icon: '⛓️', title: `Taken in ${s.name}`, text: `${TownCrimes.line('arrested', { town: s.name }, `${s.name}|${day}`)}${jail ? ` ${jail.text}` : ''}`, type: 'warning' });
            }
            if (day > _num(h.until, -1) || h.taken) {
                if (!h.named && s.folk && Array.isArray(s.folk.annals)) {
                    try { Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: `Whoever ${h.act === 'well' ? 'poisoned the well' : 'burnt the granary'} was never found; the hunt was given up {when}.` }); } catch (e) { /* none */ }
                }
                delete ts.hunt;
            }
        }
        if (ts.want && day > _num(ts.want.until, -1)) delete ts.want;
        if (!Object.keys(ts).some(k => k !== 'marks')) {
            if (!ts.marks || !Object.keys(ts.marks).length) delete s.townCrimes;
        }
    },

    /** The player's lofts, weekly: rot, the loft's rent, the crown's ban, the town's notice. */
    _loftsDay(world, player, day, out) {
        const st = TownCrimes.state(player);
        const H = TownCrimes.config().hoard;
        for (const [k, h] of Object.entries(st.hoards)) {
            if (!h || (day - _num(h.d)) % 7 !== 0 || day === h.d) continue;
            const t = world && typeof world.getTile === 'function' ? world.getTile(h.q, h.r) : null;
            const s = t && t.settlement;
            if (!s) { delete st.hoards[k]; continue; }
            // The crown forbids engrossing: the loft is thrown open, its grain sold at the cross
            if (s.kingdom != null && Engrossing.banned(world, s.kingdom)) {
                SettlementMarket.add(s, 'grain', Math.floor(h.grain));
                out.notices.push({ icon: '📜', title: `Your Loft in ${s.name}`, text: TownCrimes.line('hoardSeized', { town: s.name }, `${s.name}|${day}`), type: 'warning' });
                delete st.hoards[k];
                continue;
            }
            // Rot
            h.grain = _r1(h.grain * (1 - _num(H.spoil, 0.01)));
            // The loft's rent, to the town; unpaid, the loft-keeper sells grain to cover it
            const fee = _num(H.loftFee, 2);
            if (_num(player.gold) >= fee) { player.gold -= fee; Economy.payTown(s, fee); } else {
                const unit = Math.max(1, TownCrimes.grainPrice(world, s));
                const sell = Math.min(h.grain, Math.ceil(fee / unit));
                h.grain = _r1(h.grain - sell);
                SettlementMarket.add(s, 'grain', sell);
            }
            // A loft full of grain in a hungry town is noticed (once a season)
            if (h.grain >= 10 && TownCrimes.hungry(world, s) && day - _num(h.noticed, -1e9) >= 30) {
                h.noticed = day;
                try { NpcMemory.rememberTown(world, s, { kind: 'grain_hoarded', player, day, weight: -4 }); } catch (e) { /* none */ }
            }
            if (!(h.grain >= 0.5)) delete st.hoards[k];
        }
    },

    // ── For the panel ─────────────────────────────────

    view(player, world, s) {
        const day = _day(world);
        const ts = TownCrimes.townState(s) || {};
        return {
            day,
            well: TownCrimes.canPoisonWell(player, world, s),
            wellFoul: TownCrimes.wellFoul(s, day) ? ts.well : null,
            scare: TownCrimes.canScare(player, world, s),
            scareOn: TownCrimes.scareOf(s, day),
            granary: TownCrimes.canBurnGranary(player, world, s),
            reserveDays: s && s.economy ? Math.round(Economy.foodReserveDays(s) * 10) / 10 : null,
            lean: Seasons.isLean(day),
            hoard: TownCrimes.canHoard(player, world, s),
            loft: TownCrimes.hoardAt(player, s),
            grainPrice: s ? TownCrimes.grainPrice(world, s) : 0,
            grainStock: s ? SettlementMarket.available(s, 'grain') : 0,
            hungry: TownCrimes.hungry(world, s),
            crown: TownCrimes.crownWants(world, s),
            banned: s && s.kingdom != null ? Engrossing.banned(world, s.kingdom) : false,
            hunt: ts.hunt || null,
            odds: Object.fromEntries(ACTS.map(a => [a, TownCrimes.odds(player, world, s, a)])),
            deeds: (TownCrimes.state(player) || { deeds: [] }).deeds.slice(0, 8),
            lofts: Object.values((TownCrimes.state(player) || { hoards: {} }).hoards),
        };
    },
};
