// ============================================
// NEMESIS — an enemy that remembers you
// ============================================
// The game already keeps grudges in many places: a ruling lord's memory of
// your deeds and the blood feuds sworn to his heirs (world/npcLords.js
// rememberDeed / vendettaOf, data/lordMemory.json), the rival Houses' feud
// and what their heads remember (house.rivals, systems/rivalHouses.js), the
// adventurers' attitude (systems/rivals.js). This layer picks out, at most,
// one to three of them and makes each a NEMESIS: a named enemy with a story.
//
//   Born of a deed   a lord whose vendetta runs deep (a town you took, kin
//                    you killed, an oath you broke), a rival head you
//                    insulted or beat, an adventurer you humiliated, a
//                    sibling passed over for the seat (disinherited), or any
//                    wrong another system reports (Nemesis.wrong). Grudges
//                    wait in the wings until a place is free.
//   Escalates        hatred (0–100) grows a little every year and moves
//                    through grudge → enmity → vendetta → obsession; each
//                    stage strikes more often and opens harsher acts:
//                    slander, suits at court, plots (Schemes.hatch), raids on
//                    your caravans, bought allies (another court's ear, another
//                    House's grudge), and assassins. What they pay comes out
//                    of a real purse (a House's gold, a realm's treasury, an
//                    adventurer's coin, their own) and what they win goes in.
//   Learns you       your habits are tracked (player.nemesis.habits): the
//                    stances you fight with (FieldBattle.play → noteStance),
//                    your caravans' routes, the towns you keep to. Each enemy
//                    reads them week by week; a habit read is countered — their
//                    men fight harder against your favourite stance
//                    (battleRead → FieldBattle._rollPhase), their raiders find
//                    your busiest road, their slander and their blades find
//                    you where you stay. Change your habits and they must learn
//                    again.
//   Worst moments    sick, at war, a new head on the seat, a regency: they
//                    strike sooner, and harder.
//   Generations      when the bearer dies their child (or the realm's new
//                    lord, the House's new head) takes up the quarrel, cooled
//                    a little — or lets it lie. On the player's side the feud
//                    passes to the heir with the seat, and the enemy tests
//                    the new head early.
//   Endings          revenge (they count the debt paid), reconciliation (a
//                    blood price), marriage (a child wed into their line),
//                    the line dying out, or the hatred fading.
//
// Voice: every taunt, letter and biography is a template first. A prose
// provider (set with Nemesis.setProse — the LLM prose seam, see below) may
// rewrite it from the facts later; nothing ever waits on it.
//
// Rules: explicit params, no domain globals; the day runs on its own seeded
// stream (world seed + day, Utils.withRng) so no other system's dice move.
// State on player.nemesis (saved). Content and tuning in data/nemesis.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NPCLords } from '../world/npcLords.js';
import { House } from './house.js';
import { RivalHouses } from './rivalHouses.js';
import { Rivals } from './rivals.js';
import { Schemes } from './schemes.js';
import { Ailments } from './ailments.js';
import { Regency } from './regency.js';
import { RealmWars } from './realmWars.js';
import { Heirs } from './heirs.js';
import { Ledger } from './ledger.js';
import { NpcMemory } from './npcMemory.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _r1 = (v) => Math.round(v * 10) / 10;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _range(v, d) {
    return Array.isArray(v) && v.length === 2 ? v : d;
}

function _roll(v, d) {
    const [a, b] = _range(v, d);
    return Utils.randInt(Math.round(a), Math.round(b));
}

const FIRST = {
    male: ['Aldric', 'Bertram', 'Corvin', 'Dunstan', 'Edric', 'Fulk', 'Garrick', 'Hugo', 'Ivo', 'Lothar', 'Merek', 'Osric', 'Ranulf', 'Sigard', 'Tancred', 'Wulfric'],
    female: ['Adela', 'Brunhild', 'Cecily', 'Edith', 'Griselda', 'Hawise', 'Isolde', 'Matilda', 'Petronel', 'Rohese', 'Sibyl', 'Ysolde'],
};

const DEFAULTS = {
    maxActive: 3, birthGapDays: 60, recentlyEndedDays: 1200, daysPerYear: 120,
    maxActs: 30, maxLetters: 8, maxPast: 20, maxGrudges: 6,
    birth: { lordVendetta: 25, houseFeud: 70, houseMemory: -8, rivalAttitude: -70, folkGrudge: -20, folkMinAge: 16, kinChance: 0.5, kinMinAge: 16, startHatred: [30, 50], perScore: 0.3 },
    stages: [
        { id: 'grudge', min: 0, label: 'Grudge', icon: '😠', every: 240 },
        { id: 'enmity', min: 35, label: 'Enmity', icon: '😡', every: 150 },
        { id: 'vendetta', min: 60, label: 'Vendetta', icon: '🩸', every: 100 },
        { id: 'obsession', min: 85, label: 'Obsession', icon: '💀', every: 70 },
    ],
    growthPerYear: 3, fadeBelow: 8, revengeSated: 120,
    inherit: { share: 0.8, letGoBelow: 15, slainBonus: 20, bloodHeirChance: 0.6, heirCarry: 0.9, testWithin: [20, 45] },
    moments: { sick: 2, war: 1.6, succession: 2, regency: 1.5, successionDays: 120, earlyShare: 0.6, bonus: 0.1 },
    learn: { perWeek: 0.02, resetShare: 0.35, cap: 0.9, minSamples: 3 },
    counter: { stance: 0.35, route: 0.4, place: 0.3 },
    habitDecay: { place: 0.985, stance: 0.99 },
    reconcile: { base: 0.75, perHatred: 0.009, perDiplomacy: 0.03, costPerHatred: 12, minCost: 150, maxHatred: 70, cooldown: 120, failHatred: 6 },
    match: { maxHatred: 65, dowryPerHatred: 6, minDowry: 200, minAge: 16 },
    accuse: { rep: 3, hatred: 6, stayDays: 120 },
    acts: {
        slander: { min: 0, weight: 3, rep: [3, 8], renown: 1 },
        suit: { min: 30, weight: 2, fine: [80, 300], winBase: 0.55, perDiplomacy: -0.04, perRep: -0.004 },
        scheme: { min: 35, weight: 3, types: ['theft', 'sabotage', 'incite_unrest', 'slander', 'raid_property'], maxActive: 3 },
        raid: { min: 45, weight: 3, base: 0.45, perProtection: -0.12, delayDays: [10, 30] },
        allies: { min: 50, weight: 2, cost: 200, deedWeight: -8, feud: 8 },
        assassin: { min: 70, weight: 1, cooldown: 360, cost: 250, base: 0.3, sick: 0.15, guard: -0.25, perArmy: -0.002, maxArmy: 0.2, wounds: ['gash', 'head_wound', 'cracked_ribs', 'slashed_face'], health: [10, 25] },
    },
    sate: { slander: 2, suit: 4, scheme: 5, raid: 8, allies: 3, assassin: 25 },
    foiled: 5,
    purse: { bloodStart: [100, 400], kinStart: [50, 200], incomePerYear: 150, cap: 5000 },
};

// ── The prose seam ─────────────────────────────────────────────
// LLM PROSE SEAM: systems/llmProse.js (LlmProse.write / LlmProse.text) is
// meant to be handed in here by whoever owns the LLM settings —
// Nemesis.setProse(LlmProse). write(world, { kind, key, facts, fallback })
// returns the fallback at once and fills the text in later; text(world, key,
// fallback) reads it back. Until then (and always in tests) the templates stand.
const TEMPLATE_PROSE = {
    write: (world, o) => o.fallback,
    text: (world, key, fallback) => fallback,
};
let _prose = TEMPLATE_PROSE;

export const Nemesis = {
    /** Give the nemeses a prose provider ({ write, text }); null puts the templates back. */
    setProse(provider) {
        _prose = provider && typeof provider.write === 'function' && typeof provider.text === 'function' ? provider : TEMPLATE_PROSE;
    },

    resetProse() {
        _prose = TEMPLATE_PROSE;
    },

    /** Ask for prose (never waits): the template comes back now. */
    _write(world, kind, key, facts, fallback) {
        try {
            const r = _prose.write(world, { kind, key, facts, fallback, style: 'medieval, bitter, terse' });
            return typeof r === 'string' && r ? r : fallback;
        } catch {
            return fallback;
        }
    },

    /** Read prose back: the provider's text for the key, else the template. */
    prose(world, key, fallback) {
        try {
            const r = _prose.text(world, key, fallback);
            return typeof r === 'string' && r ? r : fallback;
        } catch {
            return fallback;
        }
    },

    // ── Data ────────────────────────────────────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.nemesis)) || {};
    },

    config() {
        const src = _obj(Nemesis.data().config) || {};
        const out = { ...DEFAULTS, ...src };
        for (const k of ['birth', 'inherit', 'moments', 'learn', 'counter', 'habitDecay', 'reconcile', 'match', 'accuse', 'sate', 'purse']) {
            out[k] = { ...DEFAULTS[k], ...(_obj(src[k]) || {}) };
        }
        out.acts = {};
        for (const k of Object.keys(DEFAULTS.acts)) out.acts[k] = { ...DEFAULTS.acts[k], ...(_obj(src.acts && src.acts[k]) || {}) };
        out.stages = Array.isArray(src.stages) && src.stages.length ? src.stages : DEFAULTS.stages;
        return out;
    },

    _text(group, key, fallback = '') {
        const g = _obj(Nemesis.data()[group]);
        const v = g ? g[key] : null;
        return v != null ? v : fallback;
    },

    kindDef(kind) {
        const K = _obj(Nemesis.data().kinds) || {};
        return K[kind] || { icon: '⚔️', label: 'an enemy' };
    },

    howDef(how) {
        const H = _obj(Nemesis.data().hows) || {};
        return H[how] || { icon: '•', label: how };
    },

    // ── State ───────────────────────────────────────────

    _blank() {
        return {
            list: [], past: [], grudges: [], settled: [], ended: {},
            habits: { stance: {}, place: {}, route: {} },
            lastGen: null, successionDay: null, lastBirthDay: -1e9, lastDay: null, nextId: 1,
        };
    },

    state(player) {
        if (!player) return Nemesis._blank();
        let st = player.nemesis;
        if (!_obj(st)) st = player.nemesis = Nemesis._blank();
        const b = Nemesis._blank();
        for (const k of ['list', 'past', 'grudges', 'settled']) if (!Array.isArray(st[k])) st[k] = [];
        if (!_obj(st.ended)) st.ended = {};
        if (!_obj(st.habits)) st.habits = b.habits;
        for (const k of ['stance', 'place', 'route']) if (!_obj(st.habits[k])) st.habits[k] = {};
        if (!(st.nextId > 0)) st.nextId = st.list.length + st.past.length + 1;
        if (!Number.isFinite(st.lastBirthDay)) st.lastBirthDay = -1e9;
        if (st.lastGen === undefined) st.lastGen = null;
        if (st.successionDay === undefined) st.successionDay = null;
        if (st.lastDay === undefined) st.lastDay = null;
        return st;
    },

    serialize(player) {
        return player && player.nemesis ? JSON.parse(JSON.stringify(player.nemesis)) : null;
    },

    loadState(player) {
        if (player) Nemesis.state(player);
    },

    active(player) {
        return player && player.nemesis && Array.isArray(player.nemesis.list) ? player.nemesis.list : [];
    },

    get(player, id) {
        return Nemesis.active(player).find(n => n.id === id) || null;
    },

    past(player) {
        return player && player.nemesis && Array.isArray(player.nemesis.past) ? player.nemesis.past : [];
    },

    stage(nm) {
        const S = Nemesis.config().stages;
        const h = _num(nm && nm.hatred);
        let out = S[0];
        for (const s of S) if (h >= _num(s.min)) out = s;
        return out;
    },

    _refKey(c) {
        const r = c.ref || {};
        return `${c.kind}:${r.kingdomId != null ? r.kingdomId : r.rivalId != null ? r.rivalId : r.childId != null ? r.childId : r.folkRef != null ? r.folkRef : c.name}`;
    },

    // ── Habits (what you do, for them to learn) ─────────

    /** A stance taken in a field battle (player/fieldBattle.js). */
    noteStance(player, stanceId) {
        if (!player || !stanceId || stanceId === 'withdraw') return;
        const h = Nemesis.state(player).habits.stance;
        h[stanceId] = _r1(_num(h[stanceId]) + 1);
    },

    _notePlace(player, world) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const s = tile && tile.settlement;
        if (!s) return;
        const h = Nemesis.state(player).habits.place;
        const key = `${player.q},${player.r}`;
        const e = h[key] || (h[key] = { n: 0, name: s.name || 'a town', kingdom: s.kingdom != null ? s.kingdom : null, q: player.q, r: player.r });
        e.n = _r1(e.n + 1);
        e.name = s.name || e.name;
        e.kingdom = s.kingdom != null ? s.kingdom : e.kingdom;
    },

    _routes(player) {
        return [...((player && player.tradeRoutes) || []), ...((player && player.smugglingRoutes) || [])].filter(Boolean);
    },

    _noteRoutes(player) {
        const h = Nemesis.state(player).habits.route;
        const live = new Set();
        for (const r of Nemesis._routes(player)) {
            if (r.id == null) continue;
            live.add(String(r.id));
            h[r.id] = { n: _num(r.totalRuns), from: r.fromName || '?', to: r.toName || '?' };
        }
        for (const k of Object.keys(h)) if (!live.has(k)) delete h[k];
    },

    _decayHabits(player) {
        const C = Nemesis.config().habitDecay;
        const h = Nemesis.state(player).habits;
        for (const k of Object.keys(h.place)) {
            h.place[k].n = _r1(h.place[k].n * _num(C.place, 0.985));
            if (h.place[k].n < 0.5) delete h.place[k];
        }
        for (const k of Object.keys(h.stance)) {
            h.stance[k] = Math.round(h.stance[k] * _num(C.stance, 0.99) * 100) / 100;
            if (h.stance[k] < 0.2) delete h.stance[k];
        }
    },

    /** The player's strongest habit of a kind: { key, share, n, label, entry } or null (too few to read). */
    topHabit(player, kind) {
        const h = Nemesis.state(player).habits[kind] || {};
        const n = (v) => (typeof v === 'number' ? v : _num(v && v.n));
        let total = 0, best = null, bestN = 0;
        for (const [k, v] of Object.entries(h)) {
            const x = n(v);
            total += x;
            if (x > bestN || (x === bestN && best != null && k < best)) { best = k; bestN = x; }
        }
        if (!best || total < Nemesis.config().learn.minSamples) return null;
        const v = h[best];
        let label = best;
        if (kind === 'place') label = v.name;
        else if (kind === 'route') label = `${v.from} to ${v.to}`;
        else {
            const gd = DataLoader._gamedata;
            const st = gd && gd.military && gd.military.fieldBattle && gd.military.fieldBattle.stances;
            label = (st && st[best] && st[best].name) || best.replace(/^./, c => c.toUpperCase());
        }
        return { key: best, share: bestN / total, n: bestN, label, entry: v };
    },

    /** What a nemesis has learnt of you, as lines: [{ kind, text, read }] (read 0–1). */
    learnt(player, nm) {
        const out = [];
        for (const kind of ['stance', 'route', 'place']) {
            const top = Nemesis.topHabit(player, kind);
            const read = _num(nm.read && nm.read[kind]);
            if (!top || read < 0.1 || (nm.readTop && nm.readTop[kind] !== top.key)) continue;
            out.push({ kind, read, text: _fill(Nemesis._text('learnt', kind, 'They know your ways.'), { what: top.label }) });
        }
        return out;
    },

    _learn(player, nm) {
        const L = Nemesis.config().learn;
        if (!_obj(nm.read)) nm.read = {};
        if (!_obj(nm.readTop)) nm.readTop = {};
        for (const kind of ['stance', 'route', 'place']) {
            const top = Nemesis.topHabit(player, kind);
            if (!top) continue;
            if (nm.readTop[kind] !== top.key) {
                // A new habit: what they knew of the old one is worth little now
                nm.read[kind] = _num(nm.read[kind]) * _num(L.resetShare, 0.35);
                nm.readTop[kind] = top.key;
            }
            nm.read[kind] = Math.min(_num(L.cap, 0.9), _r1((_num(nm.read[kind]) + _num(L.perWeek) * (0.5 + _num(nm.hatred) / 100)) * 100) / 100);
        }
    },

    // ── The battle seam (player/fieldBattle.js) ─────────

    /** The nemesis whose men these are, or null. enemy: FieldBattle's enemy ({ unitId, ... }). */
    ownerOf(player, world, enemy) {
        if (!player || !player.nemesis || !enemy) return null;
        const unit = enemy.unitId != null && world && Array.isArray(world.units) ? world.units.find(u => u && u.id === enemy.unitId) : null;
        const u = unit || enemy;
        for (const nm of Nemesis.active(player)) {
            if (u.nemesisId != null && u.nemesisId === nm.id) return nm;
            const kid = nm.ref && nm.ref.kingdomId;
            if (kid == null) continue;
            if (nm.kind === 'house' && u.rivalId === kid && u.houseKey != null) return nm;
            if (nm.kind === 'lord' && u.kingdomId === kid && u.type !== 'rival_retinue') return nm;
        }
        return null;
    },

    /**
     * Their men know how you fight: { nemesisId, name, stance, mult, text } when
     * the enemy is a nemesis's and they have read your favourite stance — the
     * enemy's power is multiplied by `mult` in a phase you fight with it.
     */
    battleRead(player, world, enemy) {
        const nm = Nemesis.ownerOf(player, world, enemy);
        if (!nm) return null;
        const top = Nemesis.topHabit(player, 'stance');
        const read = _num(nm.read && nm.read.stance);
        if (!top || read <= 0 || (nm.readTop && nm.readTop.stance !== top.key)) return null;
        const mult = 1 + _num(Nemesis.config().counter.stance) * read * top.share;
        return { nemesisId: nm.id, name: nm.name, stance: top.key, mult: Math.round(mult * 1000) / 1000, text: `${nm.name}'s men are ready for your ${top.label}.` };
    },

    // ── Wrongs and births ───────────────────────────────

    /**
     * A wrong done that may raise a nemesis: spec { kind ('blood' by default,
     * or lord/house/rival/kin with ref), name, ref, line, deed: { key, label,
     * note }, score, age, gender }. It waits among the grudges until a place
     * is free (the weekly turn). Returns the grudge, or null.
     */
    wrong(player, world, spec = {}) {
        if (!player || !spec || !spec.name) return null;
        const st = Nemesis.state(player);
        const g = {
            kind: spec.kind || 'blood', name: String(spec.name), ref: _obj(spec.ref) || {}, line: spec.line || null,
            deed: { key: (spec.deed && spec.deed.key) || 'wrong', label: (spec.deed && spec.deed.label) || 'the wrong you did', note: (spec.deed && spec.deed.note) || null },
            score: _num(spec.score, 40), day: _day(world),
        };
        if (spec.age != null) g.age = spec.age;
        if (spec.gender) g.gender = spec.gender;
        const key = Nemesis._refKey(g);
        if (Nemesis.active(player).some(n => n.refKey === key)) return null;
        st.grudges = st.grudges.filter(x => Nemesis._refKey(x) !== key);
        st.grudges.unshift(g);
        if (st.grudges.length > Nemesis.config().maxGrudges) st.grudges.length = Nemesis.config().maxGrudges;
        return g;
    },

    /** Everyone who could become a nemesis now, strongest first. */
    candidates(player, world) {
        const B = Nemesis.config().birth;
        const day = _day(world);
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k || !k.isAlive || !k.lord) continue;
            const v = NPCLords.vendettaOf(k.lord, day);
            if (v.weight < B.lordVendetta || !v.causes.length) continue;
            const c = v.causes[0];
            out.push({ kind: 'lord', ref: { kingdomId: k.id }, name: k.lord.name || k.ruler || `the lord of ${Names.realm(k.name)}`, line: k.name, score: v.weight, deed: { key: c.key, label: c.label, note: c.note } });
        }
        const rivals = (player.house && player.house.rivals) || {};
        for (const r of Object.values(rivals)) {
            if (!r || _num(r.feud) < B.houseFeud) continue;
            const worst = (world ? RivalHouses.memoryOf(r, world) : []).filter(m => m.now <= B.houseMemory).sort((a, b) => a.now - b.now)[0];
            if (!worst) continue;
            out.push({ kind: 'house', ref: { kingdomId: r.kingdomId }, name: r.head ? RivalHouses.headName(r) : r.name, line: r.name, score: _num(r.feud), deed: { key: worst.kind, label: RivalHouses.memoryLabel(worst), note: worst.note || null } });
        }
        if (player.rivals) {
            for (const r of Rivals.alive(player)) {
                if (_num(r.attitude) > B.rivalAttitude) continue;
                const m = (r.memory || []).filter(x => _num(x.delta) < 0).sort((a, b) => a.delta - b.delta)[0];
                if (!m) continue;
                out.push({ kind: 'rival', ref: { rivalId: r.id }, name: r.name, line: null, score: -_num(r.attitude), deed: { key: 'slight', label: 'what passed between you', note: m.text } });
            }
        }
        for (const c of Nemesis._folkGrudges(player, world)) out.push(c);
        for (const g of Nemesis.state(player).grudges) out.push(g);
        const st = Nemesis.state(player);
        const C = Nemesis.config();
        const taken = new Set(Nemesis.active(player).map(n => n.refKey));
        return out.filter(c => {
            const key = Nemesis._refKey(c);
            return !taken.has(key) && !(st.ended[key] != null && day - st.ended[key] < C.recentlyEndedDays);
        }).sort((a, b) => b.score - a.score);
    },

    /**
     * Townsfolk who carry a bitter memory of the player's House (systems/npcMemory.js
     * person.nm — kin slain, a father hanged, a home burnt): the bitterest grown
     * one in each town, as a candidate avenger ('blood', ref.folkRef 'q,r#id').
     */
    _folkGrudges(player, world) {
        const B = Nemesis.config().birth;
        const out = [];
        if (!world || typeof world.getSettlementViews !== 'function' || !player.house) return out;
        const day = _day(world);
        const Y = Nemesis.config().daysPerYear;
        for (const s of world.getSettlementViews()) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            let best = null;
            for (const p of folk.people) {
                if (!p || p.died != null || !Array.isArray(p.nm) || !p.nm.length) continue;
                if ((day - _num(p.born, day)) / Y < B.folkMinAge) continue;
                for (const e of p.nm) {
                    if (!e || !(_num(e.w) < 0)) continue;
                    const w = NpcMemory.weightAt(e, day);
                    if (w > B.folkGrudge || (best && w >= best.w)) continue;
                    if (NpcMemory.actorOf(e, player).gen == null) continue;
                    best = { p, e, w };
                }
            }
            if (!best) continue;
            const { p, e, w } = best;
            const label = NpcMemory._label(e, 'you', 'speech') || 'the wrong your House did them';
            out.push({
                kind: 'blood', ref: { folkRef: `${s.q},${s.r}#${p.id}` }, name: `${p.first}${p.last ? ` ${p.last}` : ''}`, line: p.last || null,
                score: -w, age: Math.floor((day - _num(p.born, day)) / Y), gender: p.gender === 'female' ? 'female' : 'male',
                deed: { key: e.k, label, note: s.name || null },
            });
        }
        return out;
    },

    _surname(name) {
        const parts = String(name || '').trim().split(/\s+/);
        const of = parts.indexOf('of');
        if (of > 0) return parts.slice(of).join(' ');
        return parts.length > 1 ? parts[parts.length - 1] : null;
    },

    _birth(player, world, c, out) {
        const C = Nemesis.config();
        const st = Nemesis.state(player);
        const day = _day(world);
        const [h0] = _range(C.birth.startHatred, [30, 50]);
        const [, h1] = _range(C.birth.startHatred, [30, 50]);
        const nm = {
            id: `nm${st.nextId++}`, kind: c.kind, ref: { ...(c.ref || {}) }, refKey: Nemesis._refKey(c),
            name: c.name, line: c.line || Nemesis._surname(c.name), generation: 1, bearers: [],
            origin: { deed: c.deed.key, label: c.deed.label, note: c.deed.note || null, day, against: player.name || 'you', gen: (player.house && player.house.generation) || 1 },
            hatred: Math.round(Utils.clamp(h0 + _num(c.score) * C.birth.perScore, h0, Math.max(h1, 75))),
            bornDay: day, lastActDay: day, dueDay: day + Math.round(Nemesis.stage({ hatred: h0 }).every * Utils.randFloat(0.5, 1)),
            grownDay: day, agedDay: day, sated: 0, evidence: 0, read: {}, readTop: {}, acts: [], letters: [],
            reconcileAfter: day, lastAssassinDay: -1e9,
        };
        if (c.kind === 'blood' || c.kind === 'kin') {
            nm.age = _num(c.age, Utils.randInt(20, 35));
            nm.gender = c.gender || (Utils.random() < 0.75 ? 'male' : 'female');
            nm.purse = _roll(c.kind === 'kin' ? C.purse.kinStart : C.purse.bloodStart, [100, 300]);
        }
        nm.hatred = Math.round(Utils.clamp(nm.hatred, 0, 100));
        st.list.push(nm);
        st.lastBirthDay = day;
        st.grudges = st.grudges.filter(g => Nemesis._refKey(g) !== nm.refKey);
        const vars = Nemesis._vars(player, world, nm);
        Nemesis._letter(player, world, nm, 'birth', vars);
        const text = `${nm.name}, ${Nemesis.kindDef(nm.kind).label}, has sworn enmity against you for ${nm.origin.label}${nm.origin.note ? ` (${nm.origin.note})` : ''}.`;
        Nemesis._chronicle(player, world, text);
        out.notices.push({ icon: '🩸', title: 'A Nemesis Is Born', text: `${text} See Dynasty → Nemeses.`, type: 'warning' });
        Interrupts.raise(world, { reason: `${nm.name} has sworn enmity against you`, icon: '🩸', source: 'nemesis' });
        return nm;
    },

    _births(player, world, out) {
        const C = Nemesis.config();
        const st = Nemesis.state(player);
        if (Nemesis.active(player).length >= C.maxActive) return null;
        if (_day(world) - st.lastBirthDay < C.birthGapDays) return null;
        const c = Nemesis.candidates(player, world)[0];
        return c ? Nemesis._birth(player, world, c, out) : null;
    },

    // ── The bearer of the feud ──────────────────────────

    _kingdom(world, id) {
        if (!world || id == null) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
        return ((world.kingdoms) || []).find(k => k && k.id === id) || null;
    },

    /** Who carries the feud now: { name } alive, { dead, slain } dead, { gone } nothing left. */
    _bearer(player, world, nm) {
        const r = nm.ref || {};
        if (nm.kind === 'lord') {
            const k = Nemesis._kingdom(world, r.kingdomId);
            if (!k || !k.isAlive) return { gone: true };
            return { name: (k.lord && k.lord.name) || k.ruler || nm.name };
        }
        if (nm.kind === 'house') {
            const rv = player.house && player.house.rivals && player.house.rivals[r.kingdomId];
            if (!rv) return { gone: true };
            return { name: rv.head ? RivalHouses.headName(rv) : nm.name };
        }
        if (nm.kind === 'rival') {
            const rv = player.rivals ? Rivals.get(player, r.rivalId) : null;
            if (!rv) return { dead: true };
            if (rv.dead) return { dead: true, slain: /\byou/i.test(String(rv.dead.cause || '')) };
            return { name: rv.name };
        }
        if (nm.kind === 'kin') {
            const ch = (player.children || []).find(x => x && x.id === r.childId);
            if (!ch || ch.isAlive === false) return { dead: true };
            return { name: nm.name };
        }
        if (r.folkRef) {
            // A townsperson (systems/townsfolk.js): their death hands the feud to a grown child of theirs
            const got = NpcMemory.resolve(world, r.folkRef);
            if (got && got.p && got.p.died == null) return { name: nm.name };
            const folk = got && got.folk;
            const Y = Nemesis.config().daysPerYear;
            const kid = folk && got.p ? folk.people.find(o => o && o.died == null && Array.isArray(o.parents) && o.parents.includes(got.p.id)
                && (_day(world) - _num(o.born)) / Y >= 14) : null;
            if (kid) return { name: `${kid.first}${kid.last ? ` ${kid.last}` : ''}`, folkRef: `${folk.q},${folk.r}#${kid.id}`, age: Math.floor((_day(world) - _num(kid.born)) / Y) };
            return { dead: true };
        }
        return nm.dead ? { dead: true, slain: !!nm.slain } : { name: nm.name };
    },

    _checkBearer(player, world, nm, out) {
        const b = Nemesis._bearer(player, world, nm);
        if (b.gone) return Nemesis._end(player, world, nm, 'extinct', out);
        if (b.dead) {
            const I = Nemesis.config().inherit;
            const chance = _num(I.bloodHeirChance) * (0.5 + _num(nm.hatred) / 100) + (b.slain ? 0.2 : 0);
            if (Utils.random() >= chance) return Nemesis._end(player, world, nm, 'extinct', out);
            const gender = Utils.random() < 0.7 ? 'male' : 'female';
            const first = Utils.randPick(FIRST[gender]);
            const sur = nm.line && !/^(House|the)\b/.test(nm.line) ? nm.line : (Nemesis._surname(nm.name) || '');
            const purse = nm.kind === 'rival' ? _num((Rivals.get(player, nm.ref.rivalId) || {}).gold) : _num(nm.purse);
            nm.kind = 'blood';
            nm.ref = {};
            nm.age = Utils.randInt(17, 28);
            nm.gender = gender;
            nm.purse = Math.max(50, Math.round(purse));
            nm.dead = null;
            return Nemesis._inherit(player, world, nm, `${first} ${sur}`.trim(), b.slain, out);
        }
        if (b.name && Nemesis._bare(b.name) !== Nemesis._bare(nm.name)) {
            if (b.folkRef) { nm.ref = { folkRef: b.folkRef }; nm.refKey = Nemesis._refKey(nm); nm.age = b.age; }
            return Nemesis._inherit(player, world, nm, b.name, false, out);
        }
        if (b.name) nm.name = b.name;
        return nm;
    },

    /** A name without its style: "King Hazel Goldenbark" and "Queen Hazel Goldenbark" are one person. */
    _bare(name) {
        return String(name || '').replace(/^((King|Queen|Lord|Lady|Prince|Princess|Duke|Duchess|Count|Countess|Baron|Baroness|Emperor|Empress|High|Grand|Chief|Sir|Dame|Regent)\s+)+/i, '').trim();
    },

    /** The feud passes to the next bearer — whole, cooled, or let lie. */
    _inherit(player, world, nm, newName, slain, out) {
        const I = Nemesis.config().inherit;
        const day = _day(world);
        const old = nm.name;
        nm.bearers.push({ name: old, to: day });
        if (nm.bearers.length > 12) nm.bearers.splice(0, nm.bearers.length - 12);
        nm.name = newName;
        nm.generation = _num(nm.generation, 1) + 1;
        nm.hatred = Math.round(Utils.clamp(_num(nm.hatred) * _num(I.share, 0.8) + (slain ? _num(I.slainBonus) : 0), 0, 100));
        nm.sated = 0;
        // The parent's notes on you: half of what they had learnt
        for (const k of Object.keys(nm.read || {})) nm.read[k] = Math.round(nm.read[k] * 50) / 100;
        if (nm.hatred < _num(I.letGoBelow, 15)) {
            return Nemesis._end(player, world, nm, 'reconciled', out, Nemesis._text('ends', 'letGo', '{name} chose to let the quarrel lie.'));
        }
        nm.dueDay = Math.min(_num(nm.dueDay, day), day + Nemesis.stage(nm).every);
        const vars = { ...Nemesis._vars(player, world, nm), parent: 'parent', old };
        Nemesis._letter(player, world, nm, 'inherit', vars);
        const text = `${old} is dead, and ${newName} takes up the quarrel with ${(player.house && player.house.name) || 'you'}${slain ? ', swearing to avenge the blood you spilt' : ''}.`;
        Nemesis._chronicle(player, world, text);
        out.notices.push({ icon: '🩸', title: 'The Feud Passes On', text, type: 'warning' });
        return nm;
    },

    _end(player, world, nm, how, out, textTpl = null) {
        const st = Nemesis.state(player);
        const day = _day(world);
        const vars = Nemesis._vars(player, world, nm);
        const text = _fill(textTpl || Nemesis._text('ends', how, '{name}: the feud is over.'), vars);
        nm.ended = { day, how, text };
        st.list = st.list.filter(n => n !== nm);
        st.ended[nm.refKey] = day;
        const keep = { id: nm.id, kind: nm.kind, name: nm.name, line: nm.line, generation: nm.generation, origin: nm.origin, bornDay: nm.bornDay, ended: nm.ended, acts: (nm.acts || []).length, bearers: (nm.bearers || []).map(b => b.name) };
        st.past.unshift(keep);
        if (st.past.length > Nemesis.config().maxPast) st.past.length = Nemesis.config().maxPast;
        Nemesis._chronicle(player, world, text);
        const H = Nemesis.howDef(how);
        if (out) out.notices.push({ icon: H.icon, title: `Feud Ended — ${H.label}`, text, type: how === 'revenge' ? 'warning' : 'success' });
        return null;
    },

    // ── Voice ───────────────────────────────────────────

    _vars(player, world, nm) {
        const place = Nemesis.topHabit(player, 'place');
        return {
            name: nm.name, you: (player && player.name) || 'you', house: (player && player.house && player.house.name) || 'your House',
            deed: nm.origin ? nm.origin.label : 'what you did', place: place ? place.label : 'your towns', line: nm.line || nm.name,
            parent: 'parent',
        };
    },

    _facts(player, world, nm, extra = {}) {
        return {
            enemy: nm.name, kind: Nemesis.kindDef(nm.kind).label, line: nm.line || null, generation: nm.generation,
            stage: Nemesis.stage(nm).id, hatred: Math.round(nm.hatred), cause: nm.origin && nm.origin.label,
            causeNote: (nm.origin && nm.origin.note) || null, target: (player && player.name) || 'you',
            targetHouse: (player && player.house && player.house.name) || null,
            recent: (nm.acts || []).slice(0, 3).map(a => a.text), ...extra,
        };
    },

    /** A taunt in the enemy's voice: the template, or the prose provider's line for this stage. */
    taunt(player, world, nm) {
        const stage = Nemesis.stage(nm).id;
        const T = _obj(Nemesis.data().taunts) || {};
        const pool = nm.generation > 1 && Array.isArray(Nemesis.data().inheritedTaunts) && _hash(`${nm.id}:${nm.generation}`) % 2 === 0
            ? Nemesis.data().inheritedTaunts : (T[stage] || ['I have not forgotten.']);
        const tpl = pool[_hash(`${nm.id}:${stage}:${nm.generation}`) % pool.length];
        const fallback = _fill(tpl, Nemesis._vars(player, world, nm));
        const key = `nemesis:${nm.id}:taunt:${nm.generation}:${stage}`;
        Nemesis._write(world, 'taunt', key, Nemesis._facts(player, world, nm), fallback);
        return Nemesis.prose(world, key, fallback);
    },

    /** A short biography for the dossier (template, or the provider's prose). */
    biography(player, world, nm) {
        const Y = Nemesis.config().daysPerYear;
        const since = Math.max(0, Math.floor((_day(world) - _num(nm.bornDay)) / Y));
        const bearers = (nm.bearers || []).map(b => b.name);
        const fallback = `${nm.name}, ${Nemesis.kindDef(nm.kind).label}${nm.line && !nm.name.includes(nm.line) ? ` of ${/^[A-Z][a-z]+ of /.test(nm.line) ? `the ${nm.line}` : nm.line}` : ''}. `
            + `The feud began ${since ? `${since} year${since === 1 ? '' : 's'} ago` : 'this year'} over ${nm.origin.label}${nm.origin.note ? ` (${nm.origin.note})` : ''}`
            + `${bearers.length ? `, and has passed from ${bearers.join(' to ')} to ${nm.name}` : ''}. `
            + `${(nm.acts || []).length ? `They have struck at you ${nm.acts.length} time${nm.acts.length === 1 ? '' : 's'}.` : 'They have not yet struck.'}`;
        const key = `nemesis:${nm.id}:bio:${nm.generation}:${(nm.acts || []).length}`;
        Nemesis._write(world, 'biography', key, Nemesis._facts(player, world, nm, { years: since, bearers }), fallback);
        return Nemesis.prose(world, key, fallback);
    },

    _letter(player, world, nm, kind, vars) {
        const tpl = Nemesis._text('letters', kind, null);
        if (!tpl) return null;
        const day = _day(world);
        const fallback = _fill(tpl, vars);
        const key = `nemesis:${nm.id}:letter:${kind}:${day}`;
        Nemesis._write(world, 'letter', key, Nemesis._facts(player, world, nm, { letter: kind, why: vars.why || null }), fallback);
        const letter = { day, kind, key, text: fallback };
        nm.letters.unshift(letter);
        if (nm.letters.length > Nemesis.config().maxLetters) nm.letters.length = Nemesis.config().maxLetters;
        return letter;
    },

    /** A letter's text as it reads now (the provider may have written it since). */
    letterText(world, letter) {
        return letter ? Nemesis.prose(world, letter.key, letter.text) : '';
    },

    _chronicle(player, world, text) {
        if (player && player.house && text) House._chronicle(player.house, world, text, ['nemesis']);
    },

    // ── Worst moments ───────────────────────────────────

    /** How ripe the hour is: { mult, why: ['sick', 'war', …] }. */
    moment(player, world) {
        const M = Nemesis.config().moments;
        const why = [];
        const ill = Ailments.list(player).some(a => a && a.kind === 'disease');
        if (ill || (_num(player.maxHealth) > 0 && _num(player.health, 100) < 0.4 * _num(player.maxHealth))) why.push('sick');
        try { if (RealmWars.wars(player).length) why.push('war'); } catch { /* no wars kept */ }
        const st = Nemesis.state(player);
        if (st.successionDay != null && _day(world) - st.successionDay <= _num(M.successionDays, 120)) why.push('succession');
        if (Regency.active(player)) why.push('regency');
        let mult = 1;
        for (const w of why) mult *= _num(M[w], 1);
        return { mult: Math.min(4, mult), why };
    },

    _whyText(why) {
        const W = _obj(Nemesis.data().momentWords) || {};
        const words = why.map(w => W[w] || w);
        return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] || '');
    },

    // ── The succession on the player's side ─────────────

    _watchSuccession(player, world, out) {
        const st = Nemesis.state(player);
        const gen = player.house ? _num(player.house.generation, 1) : null;
        if (gen == null) return;
        if (st.lastGen != null && gen > st.lastGen) Nemesis._onSuccession(player, world, out);
        st.lastGen = gen;
    },

    _onSuccession(player, world, out) {
        const C = Nemesis.config();
        const st = Nemesis.state(player);
        const day = _day(world);
        st.successionDay = day;
        for (const nm of Nemesis.active(player)) {
            nm.hatred = Math.round(_num(nm.hatred) * _num(C.inherit.heirCarry, 0.9));
            nm.dueDay = Math.min(_num(nm.dueDay, day), day + _roll(C.inherit.testWithin, [20, 45]));
            Nemesis._letter(player, world, nm, 'succession', Nemesis._vars(player, world, nm));
            out.notices.push({ icon: '🩸', title: 'An Old Enemy Waits', text: `${nm.name} has not forgotten ${nm.origin.label}. The quarrel passes to you with the seat.`, type: 'warning' });
        }
        // Brothers and sisters older than the new head, passed over for the seat
        for (const c of player.children || []) {
            if (!c || !c.isSibling || c.isAlive === false) continue;
            if (_num(c.age) < C.birth.kinMinAge || _num(c.age) <= _num(player.age)) continue;
            if (Utils.random() >= C.birth.kinChance) continue;
            Nemesis.wrong(player, world, {
                kind: 'kin', name: `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`, ref: { childId: c.id }, line: c.dynasty || null,
                deed: { key: 'disinherited', label: 'the seat that should have been theirs', note: `passed over for ${player.firstName || player.name}` },
                score: 60, age: _num(c.age), gender: c.gender,
            });
        }
    },

    // ── The purse ───────────────────────────────────────

    purse(player, world, nm) {
        const r = nm.ref || {};
        if (nm.kind === 'house') { const rv = player.house && player.house.rivals && player.house.rivals[r.kingdomId]; return rv ? _num(rv.gold, 1000) : 0; }
        if (nm.kind === 'lord') { const k = Nemesis._kingdom(world, r.kingdomId); return k ? _num(k.treasury) : 0; }
        if (nm.kind === 'rival') { const rv = player.rivals ? Rivals.get(player, r.rivalId) : null; return rv ? _num(rv.gold) : 0; }
        return _num(nm.purse);
    },

    _pay(player, world, nm, amount) {
        const a = Math.round(amount);
        const r = nm.ref || {};
        if (nm.kind === 'house') {
            const rv = player.house && player.house.rivals && player.house.rivals[r.kingdomId];
            if (rv && Number.isFinite(rv.gold)) rv.gold = Math.max(0, rv.gold + a);
        } else if (nm.kind === 'lord') {
            const k = Nemesis._kingdom(world, r.kingdomId);
            if (k) k.treasury = Math.max(0, _num(k.treasury) + a);
        } else if (nm.kind === 'rival') {
            const rv = player.rivals ? Rivals.get(player, r.rivalId) : null;
            if (rv) rv.gold = Math.max(0, _num(rv.gold) + a);
        } else {
            nm.purse = Math.min(Nemesis.config().purse.cap, Math.max(0, _num(nm.purse) + a));
        }
    },

    // ── The week ────────────────────────────────────────

    _rng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:nemesis:${_day(world)}`) % 233279) + 1);
    },

    /** One day: habits noted, the succession watched; once a week the enemies move. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world || player.interregnum) return out;
        const st = Nemesis.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        Utils.withRng(Nemesis._rng(world), () => {
            Nemesis._notePlace(player, world);
            Nemesis._watchSuccession(player, world, out);
            if (day % 7 === 0) Nemesis._week(player, world, out);
        });
        return out;
    },

    _week(player, world, out) {
        const C = Nemesis.config();
        const st = Nemesis.state(player);
        const day = _day(world);
        Nemesis._decayHabits(player);
        Nemesis._noteRoutes(player);
        Nemesis._readSettled(player, world, out);
        const moment = Nemesis.moment(player, world);
        for (const nm of st.list.slice()) {
            if (!Nemesis._checkBearer(player, world, nm, out)) continue;
            if (!Nemesis.get(player, nm.id)) continue;
            // The years: hatred grows, an avenger ages and gathers coin
            if (day - _num(nm.grownDay) >= 30) {
                nm.hatred = Math.min(100, _r1(_num(nm.hatred) + C.growthPerYear * (day - nm.grownDay) / C.daysPerYear));
                nm.grownDay = day;
            }
            if ((nm.kind === 'blood' || nm.kind === 'kin') && day - _num(nm.agedDay) >= C.daysPerYear) {
                nm.agedDay = day;
                nm.age = _num(nm.age, 30) + 1;
                Nemesis._pay(player, world, nm, C.purse.incomePerYear);
                const p = nm.age < 45 ? 0.01 : Math.min(0.5, Math.pow((nm.age - 45) / 35, 2));
                if (nm.kind === 'blood' && Utils.random() < p) { nm.dead = { day }; continue; }
            }
            if (_num(nm.hatred) < C.fadeBelow) { Nemesis._end(player, world, nm, 'faded', out); continue; }
            Nemesis._sync(player, world, nm);
            Nemesis._learn(player, nm);
            const every = Nemesis.stage(nm).every;
            const early = moment.mult > 1 ? every * (1 - 1 / moment.mult) * _num(C.moments.earlyShare, 0.6) : 0;
            if (day >= _num(nm.dueDay) - early) Nemesis._act(player, world, nm, moment, out);
        }
        Nemesis._births(player, world, out);
    },

    /** Keep the old grudge counters as hot as the nemesis (the waylays, ambushes and plots read them). */
    _sync(player, world, nm) {
        const target = Math.round(_num(nm.hatred) * 0.8);
        const r = nm.ref || {};
        if (nm.kind === 'house') {
            const rv = player.house && player.house.rivals && player.house.rivals[r.kingdomId];
            if (rv && _num(rv.feud) < target) House.accrueRivalFeud(player, world, r.kingdomId, target - _num(rv.feud));
        } else if (nm.kind === 'rival') {
            const rv = player.rivals ? Rivals.get(player, r.rivalId) : null;
            if (rv && _num(rv.attitude) > -target) rv.attitude = -target;
        }
    },

    /** The plots they set (Schemes._settle notes them on player.nemesis.settled): sated or inflamed. */
    _readSettled(player, world, out) {
        const st = Nemesis.state(player);
        const list = st.settled.splice(0);
        for (const s of list) {
            const nm = Nemesis.get(player, s.nemesisId);
            if (!nm) continue;
            const act = nm.acts.find(a => a.schemeId === s.schemeId && a.outcome === 'hidden');
            if (s.outcome === 'struck') {
                if (act) act.outcome = 'struck';
                Nemesis._sate(player, world, nm, 'scheme', out);
            } else if (s.outcome === 'foiled') {
                if (act) act.outcome = 'foiled';
                nm.hatred = Math.min(100, _num(nm.hatred) + Nemesis.config().foiled);
                nm.evidence = _num(nm.evidence) + 1;
            } else if (act) act.outcome = s.outcome || 'fizzled';
        }
    },

    _sate(player, world, nm, kind, out) {
        const C = Nemesis.config();
        const s = _num(C.sate[kind]);
        nm.sated = _num(nm.sated) + s;
        nm.hatred = Math.max(0, _r1(_num(nm.hatred) - s * 0.4));
        if (nm.sated >= C.revengeSated && Nemesis.get(player, nm.id)) Nemesis._end(player, world, nm, 'revenge', out);
    },

    // ── Acts ────────────────────────────────────────────

    _options(player, world, nm) {
        const C = Nemesis.config();
        const day = _day(world);
        const h = _num(nm.hatred);
        const purse = Nemesis.purse(player, world, nm);
        const ok = {
            slander: true,
            suit: _num(player.gold) > 0,
            scheme: Schemes.active(player).length < _num(C.acts.scheme.maxActive, 3) && Nemesis._schemeTypes(player, world, nm).length > 0,
            raid: Nemesis._routes(player).length > 0,
            allies: purse >= C.acts.allies.cost,
            assassin: purse >= C.acts.assassin.cost && day - _num(nm.lastAssassinDay, -1e9) >= C.acts.assassin.cooldown,
        };
        return Object.keys(C.acts).filter(k => ok[k] && h >= _num(C.acts[k].min)).map(k => ({ id: k, w: _num(C.acts[k].weight, 1) * (1 + (h - _num(C.acts[k].min)) / 50) }));
    },

    _schemeTypes(player, world, nm) {
        const want = Nemesis.config().acts.scheme.types || [];
        try {
            return Schemes.eligibleTypes(player, world, _num(nm.hatred)).filter(t => want.includes(t));
        } catch {
            return [];
        }
    },

    _act(player, world, nm, moment, out) {
        const opts = Nemesis._options(player, world, nm);
        const day = _day(world);
        nm.lastActDay = day;
        nm.dueDay = day + Math.round(Nemesis.stage(nm).every * Utils.randFloat(0.8, 1.2));
        if (!opts.length) return null;
        let roll = Utils.random() * opts.reduce((s, o) => s + o.w, 0);
        let pick = opts[opts.length - 1].id;
        for (const o of opts) { roll -= o.w; if (roll <= 0) { pick = o.id; break; } }
        const fn = { slander: '_doSlander', suit: '_doSuit', scheme: '_doScheme', raid: '_doRaid', allies: '_doAllies', assassin: '_doAssassin' }[pick];
        const res = Nemesis[fn](player, world, nm, moment);
        if (!res) return null;
        const rec = { day, kind: pick, text: res.text, outcome: res.outcome };
        if (res.schemeId != null) rec.schemeId = res.schemeId;
        nm.acts.unshift(rec);
        if (nm.acts.length > Nemesis.config().maxActs) nm.acts.length = Nemesis.config().maxActs;
        if (res.outcome === 'foiled') {
            nm.hatred = Math.min(100, _num(nm.hatred) + Nemesis.config().foiled);
            nm.evidence = _num(nm.evidence) + 1;
        }
        if (res.hidden) return rec;
        let text = res.text;
        if (moment.why.length) {
            const why = Nemesis._whyText(moment.why);
            text += _fill(Nemesis._text('acts', 'moment', ' They chose the hour well: you are {why}.'), { why });
            if (!(nm.letters || []).some(l => l.kind === 'moment' && day - l.day < 240)) Nemesis._letter(player, world, nm, 'moment', { ...Nemesis._vars(player, world, nm), why });
        }
        text += ` "${Nemesis.taunt(player, world, nm)}"`;
        out.notices.push({ icon: Nemesis.stage(nm).icon || '🩸', title: `${nm.name} Strikes`, text, type: res.outcome === 'foiled' ? 'warning' : 'error' });
        if (res.outcome !== 'foiled') Interrupts.raise(world, { reason: `${nm.name} strikes`, icon: '🩸', source: 'nemesis' });
        if (res.outcome === 'struck') Nemesis._sate(player, world, nm, pick, out);
        return rec;
    },

    _realmOf(player, world, place) {
        const kid = place && place.entry && place.entry.kingdom != null ? place.entry.kingdom : player.allegiance;
        const k = Nemesis._kingdom(world, kid);
        return k ? { id: k.id, name: k.name || 'the realm', k } : null;
    },

    _doSlander(player, world, nm, moment) {
        const A = Nemesis.config().acts.slander;
        const place = Nemesis.topHabit(player, 'place');
        const realm = Nemesis._realmOf(player, world, place);
        if (!realm) return null;
        const n = Math.round(_roll(A.rep, [3, 8]) * (1 + _num(nm.read && nm.read.place) * 0.5) * (1 + (moment.mult - 1) * 0.25));
        if (!player.reputation) player.reputation = {};
        player.reputation[realm.id] = _num(player.reputation[realm.id]) - n;
        player.renown = Math.max(0, _num(player.renown) - _num(A.renown));
        return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'slander'), { name: nm.name, place: place ? place.label : 'the towns', realm: Names.realm(realm.name), n }) };
    },

    _doSuit(player, world, nm, moment) {
        const A = Nemesis.config().acts.suit;
        const realm = Nemesis._realmOf(player, world, Nemesis.topHabit(player, 'place'));
        if (!realm) return null;
        const dip = _num(player.skills && player.skills.diplomacy);
        const rep = _num(player.reputation && player.reputation[realm.id]);
        const win = Utils.clamp(A.winBase + A.perDiplomacy * dip + A.perRep * rep + (moment.mult > 1 ? Nemesis.config().moments.bonus : 0), 0.1, 0.9);
        if (Utils.random() < win) {
            const fine = Math.min(Math.floor(_num(player.gold)), Math.round(_roll(A.fine, [80, 300]) * (0.5 + _num(nm.hatred) / 100)));
            if (fine <= 0) return null;
            player.gold -= fine;
            Ledger.record(player, 'nemesisSuit', -fine);
            Nemesis._pay(player, world, nm, fine);
            return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'suitWon'), { name: nm.name, realm: Names.realm(realm.name), n: fine }) };
        }
        return { outcome: 'foiled', text: _fill(Nemesis._text('acts', 'suitLost'), { name: nm.name, realm: Names.realm(realm.name) }) };
    },

    _doScheme(player, world, nm) {
        const types = Nemesis._schemeTypes(player, world, nm);
        if (!types.length) return null;
        const type = Utils.randPick(types);
        const scheme = Schemes.hatch(player, world, { kingdomId: nm.ref && nm.ref.kingdomId != null ? nm.ref.kingdomId : null, name: nm.name }, type);
        if (!scheme) return null;
        scheme.nemesisId = nm.id;
        // Hidden until it strikes or is found out (Schemes reveals it as any plot)
        return { outcome: 'hidden', hidden: true, schemeId: scheme.id, text: `Set a plot in the dark (${type.replace(/_/g, ' ')}).` };
    },

    _doRaid(player, world, nm, moment) {
        const A = Nemesis.config().acts.raid;
        const routes = Nemesis._routes(player);
        if (!routes.length) return null;
        const top = Nemesis.topHabit(player, 'route');
        const target = (top && routes.find(r => String(r.id) === top.key)) || routes.slice().sort((a, b) => _num(b.totalRuns) - _num(a.totalRuns))[0];
        const known = top && String(target.id) === top.key && nm.readTop && nm.readTop.route === top.key;
        const chance = Utils.clamp(A.base + Nemesis.config().counter.route * _num(nm.read && nm.read.route) * (known ? 1 : 0.3)
            + A.perProtection * _num(target.protection) + (moment.mult > 1 ? Nemesis.config().moments.bonus : 0), 0.05, 0.95);
        const vars = { name: nm.name, from: target.fromName || '?', to: target.toName || '?' };
        if (Utils.random() >= chance) return { outcome: 'foiled', text: _fill(Nemesis._text('acts', 'raidMissed'), vars) };
        if (target.activeCaravanId && world && Array.isArray(world.units)) {
            const u = world.units.find(x => x && x.id === target.activeCaravanId);
            if (u) u.destroyed = true;
        }
        target.activeCaravanId = null;
        target.raidedRuns = _num(target.raidedRuns) + 1;
        target.lastResult = 'raided';
        target.lastProfit = 0;
        target.prosperity = Math.max(0, _num(target.prosperity) - 0.35);
        target.nextDispatchIn = Math.max(_num(target.nextDispatchIn), _roll(A.delayDays, [10, 30]));
        return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'raidRoute'), vars) };
    },

    _doAllies(player, world, nm) {
        const A = Nemesis.config().acts.allies;
        const day = _day(world);
        if (nm.kind === 'house') {
            const others = Object.values((player.house && player.house.rivals) || {}).filter(r => r && r.kingdomId !== nm.ref.kingdomId);
            if (others.length) {
                const o = Utils.randPick(others);
                Nemesis._pay(player, world, nm, -A.cost);
                if (Number.isFinite(o.gold)) o.gold += A.cost;
                House.accrueRivalFeud(player, world, o.kingdomId, A.feud, `${nm.name}'s gold`);
                return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'alliesHouse'), { name: nm.name, rival: o.name }) };
            }
        }
        // A court that thinks well of you is the one worth poisoning
        const own = nm.ref && nm.ref.kingdomId;
        const ks = ((world && world.kingdoms) || []).filter(k => k && k.isAlive && k.lord && k.id !== own)
            .sort((a, b) => _num(player.reputation && player.reputation[b.id]) - _num(player.reputation && player.reputation[a.id]));
        const k = ks[0];
        if (!k) return null;
        Nemesis._pay(player, world, nm, -A.cost);
        k.treasury = _num(k.treasury) + A.cost;
        NPCLords.rememberDeed(world, k.lord, 'nemesis_poison', { note: nm.name, weight: A.deedWeight, day });
        return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'allies'), { name: nm.name, lord: k.lord.name || 'the lord', realm: Names.realm(k.name) }) };
    },

    _doAssassin(player, world, nm, moment) {
        const A = Nemesis.config().acts.assassin;
        const day = _day(world);
        nm.lastAssassinDay = day;
        Nemesis._pay(player, world, nm, -A.cost);
        const place = Nemesis.topHabit(player, 'place');
        const atHaunt = place && place.entry && place.entry.q === player.q && place.entry.r === player.r;
        const men = ((player.army) || []).reduce((s, u) => s + _num(u && (u.count != null ? u.count : u.strength), 1), 0);
        const guard = ((player.army) || []).some(u => u && u.realmGuard != null);
        const chance = Utils.clamp(A.base
            + Nemesis.config().counter.place * _num(nm.read && nm.read.place) * (atHaunt ? 1 : 0.3)
            + (moment.why.includes('sick') ? A.sick : 0)
            + (guard ? A.guard : 0)
            - Math.min(A.maxArmy, -A.perArmy * men), 0.05, 0.85);
        const where = atHaunt ? ` in ${place.label}` : '';
        if (Utils.random() >= chance) return { outcome: 'foiled', text: _fill(Nemesis._text('acts', 'assassinFoiled'), { name: nm.name, where }) };
        const id = Utils.randPick(A.wounds || ['gash']);
        const w = Ailments.inflict(player, world, id, { source: 'assassin' });
        const loss = _roll(A.health, [10, 25]);
        player.health = Math.max(1, _num(player.health, 100) - loss);
        return { outcome: 'struck', text: _fill(Nemesis._text('acts', 'assassinHit'), { name: nm.name, where, wound: w ? String(w.name).toLowerCase() : 'deep wound' }) };
    },

    // ── What the player can do ──────────────────────────

    reconcileCost(nm) {
        const R = Nemesis.config().reconcile;
        return Math.max(R.minCost, Math.round(_num(nm.hatred) * R.costPerHatred));
    },

    reconcileChance(player, nm) {
        const R = Nemesis.config().reconcile;
        return Utils.clamp(R.base - R.perHatred * _num(nm.hatred) + R.perDiplomacy * _num(player.skills && player.skills.diplomacy), 0.05, 0.95);
    },

    canReconcile(player, world, nm) {
        const R = Nemesis.config().reconcile;
        if (!nm) return { ok: false, reason: 'No such enemy.' };
        if (_num(nm.hatred) > R.maxHatred) return { ok: false, reason: `${nm.name} will hear no talk of peace (hatred ${Math.round(nm.hatred)}; at most ${R.maxHatred}).` };
        if (_day(world) < _num(nm.reconcileAfter)) return { ok: false, reason: `${nm.name} spurned your last offer; wait until day ${nm.reconcileAfter}.` };
        const cost = Nemesis.reconcileCost(nm);
        if (_num(player.gold) < cost) return { ok: false, reason: `The blood price is ${cost}g.` };
        return { ok: true, cost, chance: Nemesis.reconcileChance(player, nm) };
    },

    /** Offer a blood price. The roll is a hash of the day (no shared dice). */
    reconcile(player, world, id) {
        const nm = Nemesis.get(player, id);
        const can = Nemesis.canReconcile(player, world, nm);
        if (!can.ok) return { success: false, reason: can.reason };
        const R = Nemesis.config().reconcile;
        const day = _day(world);
        const roll = (_hash(`${_seed(world)}:${nm.id}:${day}:reconcile`) % 10000) / 10000;
        if (roll >= can.chance) {
            nm.hatred = Math.min(100, _num(nm.hatred) + R.failHatred);
            nm.reconcileAfter = day + R.cooldown;
            return { success: true, accepted: false, text: `${nm.name} refuses your blood price. "${Nemesis.taunt(player, world, nm)}"` };
        }
        player.gold -= can.cost;
        Ledger.record(player, 'nemesisPeace', -can.cost);
        Nemesis._pay(player, world, nm, can.cost);
        const r = nm.ref || {};
        if (nm.kind === 'house') House.accrueRivalFeud(player, world, r.kingdomId, -40);
        else if (nm.kind === 'rival') { const rv = player.rivals ? Rivals.get(player, r.rivalId) : null; if (rv) rv.attitude = Math.max(_num(rv.attitude), 0); }
        else if (nm.kind === 'lord') { const k = Nemesis._kingdom(world, r.kingdomId); if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'gift', { weight: 10, note: 'a blood price' }); }
        const out = { notices: [] };
        Nemesis._end(player, world, nm, 'reconciled', out);
        return { success: true, accepted: true, cost: can.cost, text: nm.ended.text };
    },

    /** Grown, unwed children of yours who could be offered (and the dowry). */
    matchOptions(player, world, nm) {
        const M = Nemesis.config().match;
        if (!nm || !nm.ref || nm.ref.kingdomId == null) return { ok: false, reason: `${nm ? nm.name : 'They'} has no House to wed into.` };
        if (_num(nm.hatred) > M.maxHatred) return { ok: false, reason: `Not while the hatred runs so hot (${Math.round(nm.hatred)}; at most ${M.maxHatred}).` };
        const kids = (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling && _num(c.age) >= M.minAge && !(c.upbringing && c.upbringing.spouse));
        if (!kids.length) return { ok: false, reason: 'You have no grown child unwed.' };
        const dowry = Math.max(M.minDowry, Math.round(_num(nm.hatred) * M.dowryPerHatred));
        return { ok: true, children: kids, dowry };
    },

    proposeMatch(player, world, id, childId) {
        const nm = Nemesis.get(player, id);
        const opt = Nemesis.matchOptions(player, world, nm);
        if (!opt.ok) return { success: false, reason: opt.reason };
        const child = opt.children.find(c => c.id === childId) || opt.children[0];
        const res = Heirs.marryForAlliance(player, world, child.id, nm.ref.kingdomId, { dowry: opt.dowry, minReputation: -1000, deed: 'child_wed' });
        if (!res.success) return res;
        if (nm.kind === 'house') {
            const rv = player.house && player.house.rivals && player.house.rivals[nm.ref.kingdomId];
            const rc = rv ? RivalHouses.matchableChildren(rv)[0] : null;
            if (rc && res.child.upbringing && res.child.upbringing.spouse) {
                res.child.upbringing.spouse.name = `${rc.firstName} ${RivalHouses.surname(rv)}`;
                rv.head.children[rc.idx].wed = res.child.firstName;
            }
            House.accrueRivalFeud(player, world, nm.ref.kingdomId, -50);
        }
        const out = { notices: [] };
        Nemesis._end(player, world, nm, 'married', out, _fill(Nemesis._text('ends', 'married'), { child: res.child.firstName, line: nm.line || nm.name, name: nm.name }));
        return { success: true, cost: opt.dowry, text: nm.ended.text };
    },

    canAccuse(player, world, nm) {
        if (!nm) return { ok: false, reason: 'No such enemy.' };
        if (_num(nm.evidence) < 1) return { ok: false, reason: 'You have no proof yet — foil one of their blows first.' };
        if (!Nemesis._realmOf(player, world, Nemesis.topHabit(player, 'place'))) return { ok: false, reason: 'No court to hear you.' };
        return { ok: true };
    },

    /** Lay the proof of a foiled blow before a court: standing won, the enemy held back a while (and angrier). */
    accuse(player, world, id) {
        const nm = Nemesis.get(player, id);
        const can = Nemesis.canAccuse(player, world, nm);
        if (!can.ok) return { success: false, reason: can.reason };
        const A = Nemesis.config().accuse;
        const realm = Nemesis._realmOf(player, world, Nemesis.topHabit(player, 'place'));
        nm.evidence -= 1;
        if (!player.reputation) player.reputation = {};
        player.reputation[realm.id] = _num(player.reputation[realm.id]) + A.rep;
        nm.dueDay = _num(nm.dueDay, _day(world)) + A.stayDays;
        nm.hatred = Math.min(100, _num(nm.hatred) + A.hatred);
        const text = `You lay the proof of ${nm.name}'s treachery before the court of ${Names.realm(realm.name)}. Your standing there rises; ${nm.name} must lie low a while, and hates you the more for it.`;
        nm.acts.unshift({ day: _day(world), kind: 'accused', text, outcome: 'yours' });
        Nemesis._chronicle(player, world, text);
        return { success: true, text };
    },

    // ── For the dossier ─────────────────────────────────

    /** Where the feud stands, for the panel. */
    view(player, world) {
        const st = Nemesis.state(player);
        const moment = Nemesis.moment(player, world);
        return {
            moment,
            active: st.list.map(nm => ({
                nm, stage: Nemesis.stage(nm), kind: Nemesis.kindDef(nm.kind), taunt: Nemesis.taunt(player, world, nm),
                bio: Nemesis.biography(player, world, nm), learnt: Nemesis.learnt(player, nm), purse: Nemesis.purse(player, world, nm),
                reconcile: Nemesis.canReconcile(player, world, nm), match: Nemesis.matchOptions(player, world, nm), accuse: Nemesis.canAccuse(player, world, nm),
            })),
            grudges: st.grudges.slice(),
            past: st.past.slice(),
            habits: { stance: Nemesis.topHabit(player, 'stance'), route: Nemesis.topHabit(player, 'route'), place: Nemesis.topHabit(player, 'place') },
        };
    },
};
