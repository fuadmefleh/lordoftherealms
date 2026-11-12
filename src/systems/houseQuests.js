// ============================================
// HOUSE QUESTS — unfinished business from the House's own history
// ============================================
// Personal quests generated from what the world really remembers of the
// player's House, never from a random table:
//
//   blood_price     a townsperson who holds a blood memory of the House (kin
//                   slain or hanged, a grave robbed, a beating) — often one
//                   handed down: "the son of the man your grandfather hanged"
//                   (systems/npcMemory.js person.nm). Pay a blood price, ask
//                   forgiveness, or face them down.
//   old_debt        wages never paid, a theft, a dismissal: repay or deny.
//   old_favour      the family of someone the House once helped (a burial, a
//                   healing, alms, a wedding, work) calls on the friendship:
//                   bring real goods from the packs, send coin, or refuse.
//   protect         the same family begs protection: reach the town in time
//                   and stand by them for days (checked from where the
//                   player stands, day by day).
//   town_amends     a town's own memory (a raid, a conquest, a harsh court):
//                   pay to rebuild, or leave it.
//   lord_grievance  a ruling lord's grievance against the House, often sworn
//                   to him by his father (world/npcLords.js memory): pay
//                   reparations into the realm's treasury, or defy it.
//   heirloom        an heirloom of the House gone astray with a trail
//                   (systems/heirlooms.js): go there and get it back (the
//                   recovery itself is Heirlooms.recover).
//
// Objectives the engine checks: reach a place (player.q/r), stay there N days,
// an heirloom held again, and a resolution chosen there (act). Consequences
// write back into the same stores: the holder's memory (NpcMemory.remember —
// amends, spurned, threatened, kept_faith, abandoned, protected), the town's
// (rememberTown), the lord's (NPCLords.rememberDeed amends_made/_refused),
// Prestige (House.award), renown, karma, standing, traits, the chronicle
// (house.history) and, for a grudge spurned or threatened, a feud
// (Nemesis.wrong). Coin paid goes to the holder's purse, the town's coffers
// or the realm's treasury (Ledger 'oldDebts').
//
// Pacing: a few a year (data/houseQuests.json config.baseDays), sooner for a
// famous House (renown, Prestige), at most maxOpen at once, the same memory
// not used again for reuseDays. Deterministic: hash rolls on the world seed
// and day — no RNG stream is drawn.
//
// The telling (hook, the holder's spoken line, the journal entry, the
// epilogue) is written from the quest's facts by LlmProse (facts only,
// checked replies); the template text in data/houseQuests.json is the
// fallback and is kept on the quest, so the quest reads whole with the
// model off.
//
// State: player.houseQuests (saved with the player). No globals; no
// import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { NPCLords } from '../world/npcLords.js';
import { NpcMemory } from './npcMemory.js';
import { Nemesis } from './nemesis.js';
import { Heirlooms } from './heirlooms.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { LlmProse } from './llmProse.js';
import { Townsfolk } from './townsfolk.js';
import { Interrupts } from '../core/interrupts.js';

const DEFAULTS = {
    enabled: true, firstDay: 90, daysPerYear: 120, baseDays: 60, minDays: 24, retryDays: 30, jitter: 0.3,
    maxOpen: 3, reuseDays: 1500, doneCap: 40, seenCap: 400, fameRenown: 400, famePrestige: 600, fameMax: 1.5,
    minWeight: 3, minAgeDays: 90, folkMinAge: 16, inheritedBonus: 6, lordMinWeight: 10, townMinWeight: 6, lordGapDays: 1200,
    lordSkip: ['amends_refused', 'amends_made', 'nemesis_poison', 'letter_', 'letters_', 'feast_', 'tourney_', 'office_', 'loan_', 'match_refused', 'child_recalled'],
};

const PERSON_KINDS = ['blood_price', 'old_debt', 'old_favour', 'protect'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const _day = (world) => _num(world && world.day, 0);
function _fill(t, vars) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : '')).replace(/\s+/g, ' ').trim();
}
function _seed(world) {
    return (world && world.generationParams && world.generationParams.seed) || (world && world.seed) || 1;
}
/** A hash roll in [0, 1): the same inputs, the same roll. */
function _roll(world, ...parts) {
    return ((Utils.hashStr(`${_seed(world)}|${parts.join('|')}`) >>> 0) % 100000) / 100000;
}
function _pname(p) { return p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone'; }
function _goodName(id) { return String(id || '').replace(/_/g, ' '); }

let _cfgSrc;
let _cfg = null;

export const HouseQuests = {
    // ── Tuning ───────────────────────────────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.houseQuests) || {};
    },

    config() {
        const d = HouseQuests.data();
        if (_cfg && _cfgSrc === d) return _cfg;
        _cfgSrc = d;
        _cfg = { ...DEFAULTS, ...((d && d.config) || {}) };
        return _cfg;
    },

    kind(id) { return (HouseQuests.data().kinds || {})[id] || null; },

    words() { return HouseQuests.data().words || {}; },

    // ── State ────────────────────────────────────────

    _blank() {
        return { open: [], done: [], seen: {}, nextDay: null, seq: 1 };
    },

    state(player) {
        if (!player) return HouseQuests._blank();
        let st = player.houseQuests;
        if (!_obj(st)) st = player.houseQuests = HouseQuests._blank();
        if (!Array.isArray(st.open)) st.open = [];
        if (!Array.isArray(st.done)) st.done = [];
        if (!_obj(st.seen)) st.seen = {};
        if (!(st.seq > 0)) st.seq = st.open.length + st.done.length + 1;
        if (st.nextDay === undefined) st.nextDay = null;
        return st;
    },

    serialize(player) {
        return player && player.houseQuests ? JSON.parse(JSON.stringify(player.houseQuests)) : null;
    },

    loadState(player) {
        if (player) HouseQuests.state(player);
    },

    open(player) { return player && player.houseQuests && Array.isArray(player.houseQuests.open) ? player.houseQuests.open : []; },
    done(player) { return player && player.houseQuests && Array.isArray(player.houseQuests.done) ? player.houseQuests.done : []; },
    get(player, id) { return HouseQuests.open(player).find(q => q.id === id) || null; },

    // ── Where the business lies ──────────────────────

    _views(world) {
        return world && typeof world.getSettlementViews === 'function' ? (world.getSettlementViews() || []) : [];
    },

    _folkAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const s = t && t.settlement;
        return { settlement: s || null, folk: s && s.folk && Array.isArray(s.folk.people) ? s.folk : null };
    },

    _person(world, ref) {
        const m = /^(-?\d+),(-?\d+)#(\d+)$/.exec(String(ref || ''));
        if (!m) return null;
        const { settlement, folk } = HouseQuests._folkAt(world, +m[1], +m[2]);
        if (!folk) return null;
        const p = folk.people.find(x => x && x.id === +m[3]) || null;
        return p ? { p, folk, settlement } : null;
    },

    _kingdom(world, id) {
        if (id == null || !world) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
        return ((world.kingdoms) || []).find(k => k && k.id === id) || null;
    },

    _kingdomAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!t) return null;
        const k = t.kingdom != null ? t.kingdom : (t.settlement && t.settlement.kingdom);
        return k != null ? k : null;
    },

    _kinWord(rel, gender) {
        const K = (HouseQuests.words().kin || {})[rel];
        if (!K) return 'kin';
        return gender === 'female' ? K.f : K.m;
    },

    _years(world, fromDay) {
        const C = HouseQuests.config();
        const n = Math.max(0, Math.round((_day(world) - _num(fromDay, _day(world))) / Math.max(1, C.daysPerYear)));
        const Y = HouseQuests.words().yearsAgo || {};
        if (n === 0) return Y['0'] || 'this year';
        if (n === 1) return Y['1'] || 'a year ago';
        return _fill(Y.many || '{n} years ago', { n });
    },

    /** "the hanging of Hal Miller by order of your grandfather" — a memory's deed, told about rather than by the holder. */
    _deedLabel(e, actorWord, whomName) {
        const def = NpcMemory.kind(e.k) || {};
        return _fill(def.label || e.k, { actor: actorWord, whom: whomName });
    },

    _price(def, weight) {
        const P = (def && def.price) || {};
        const v = _num(P.base, 50) + Math.abs(_num(weight)) * _num(P.perWeight, 10);
        const c = Math.max(_num(P.min, 0), Math.min(_num(P.max, 1e9), v));
        return Math.round(c / 5) * 5;
    },

    _kindForEpisode(k) {
        for (const id of ['blood_price', 'old_debt', 'old_favour']) {
            const def = HouseQuests.kind(id);
            if (def && Array.isArray(def.sources) && def.sources.includes(k)) return id;
        }
        return null;
    },

    // ── Candidates ───────────────────────────────────

    /**
     * Everything that could become a quest now, strongest first:
     * [{ kind, src, score, ... the source's particulars }]. Pure read.
     */
    candidates(world, player) {
        const out = [];
        if (!world || !player || !player.house) return out;
        const C = HouseQuests.config();
        const st = HouseQuests.state(player);
        const day = _day(world);
        const used = (src) => st.seen[src] != null && day - st.seen[src] < C.reuseDays;
        const busy = new Set(st.open.map(q => q.holder && q.holder.ref).filter(Boolean));
        const busySrc = new Set(st.open.map(q => q.src));
        const nemeses = new Set(Nemesis.active(player).map(n => n.refKey));

        for (const s of HouseQuests._views(world)) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            for (const p of folk.people) {
                if (!p || p.died != null || p.away || !Array.isArray(p.nm) || !p.nm.length) continue;
                if ((day - _num(p.born, day)) / C.daysPerYear < C.folkMinAge) continue;
                const ref = `${s.q},${s.r}#${p.id}`;
                if (busy.has(ref)) continue;
                for (const e of p.nm) {
                    if (!e || !e.k) continue;
                    const kind = HouseQuests._kindForEpisode(e.k);
                    if (!kind) continue;
                    const a = NpcMemory.actorOf(e, player);
                    if (a.gen == null) continue;
                    const inherited = a.gen > 0 || _num(e.g) > 0;
                    if (!inherited && day - _num(e.d, day) < C.minAgeDays) continue;
                    const w = NpcMemory.weightAt(e, day);
                    if (Math.abs(w) < C.minWeight) continue;
                    if (kind === 'old_favour' ? w <= 0 : w >= 0) continue;
                    if (kind === 'blood_price' && nemeses.has(`blood:${ref}`)) continue;
                    const src = `p:${ref}:${e.k}:${_num(e.d)}`;
                    if (used(src) || busySrc.has(src)) continue;
                    const score = Math.abs(w) + (inherited ? C.inheritedBonus : 0) + _roll(world, 'score', src, day) * 4;
                    out.push({ kind, src, score, s, p, e, w, a, ref });
                }
            }
            if (Array.isArray(folk.nm) && HouseQuests.kind('town_amends')) {
                const T = HouseQuests.kind('town_amends');
                for (const e of folk.nm) {
                    if (!e || !(T.sources || []).includes(e.k)) continue;
                    const a = NpcMemory.actorOf(e, player);
                    if (a.gen == null) continue;
                    if (a.gen === 0 && day - _num(e.d, day) < C.minAgeDays) continue;
                    const w = NpcMemory.weightAt(e, day);
                    if (w > -C.townMinWeight) continue;
                    const src = `t:${s.q},${s.r}:${e.k}:${_num(e.d)}`;
                    if (used(src) || busySrc.has(src)) continue;
                    const score = Math.abs(w) + (a.gen > 0 ? C.inheritedBonus : 0) + _roll(world, 'score', src, day) * 4;
                    out.push({ kind: 'town_amends', src, score, s, e, w, a });
                }
            }
        }

        if (HouseQuests.kind('lord_grievance')) {
            for (const k of world.kingdoms || []) {
                if (!k || k.isAlive === false || !k.lord || !k.capital) continue;
                if (st.open.some(q => q.kind === 'lord_grievance' && q.kingdomId === k.id)) continue;
                // One grievance of a realm at a time, and not again for years (its own answer — amends refused — is never one)
                if (used(`lk:${k.id}`)) continue;
                const skip = (key) => (C.lordSkip || []).some(p => (p.endsWith('_') ? key.startsWith(p) : key === p));
                const worst = NPCLords.memoryOf(k.lord, day).filter(m => m.weight <= -C.lordMinWeight && !skip(m.key) && (m.inherited || day - m.day >= C.minAgeDays))
                    .sort((x, y) => x.weight - y.weight)[0];
                if (!worst) continue;
                const src = `l:${k.id}:${worst.key}:${worst.day}`;
                if (used(src)) continue;
                const score = Math.abs(worst.weight) + (worst.inherited ? C.inheritedBonus : 0) + _roll(world, 'score', src, day) * 4;
                out.push({ kind: 'lord_grievance', src, score, k, m: worst, w: worst.weight });
            }
        }

        if (HouseQuests.kind('heirloom')) {
            for (const h of Heirlooms.quests(player)) {
                if (!h.trail || h.trail.q == null) continue;
                if (st.open.some(q => q.kind === 'heirloom' && q.heirloomId === h.id)) continue;
                const src = `h:${h.id}:${_num(h.trail.since)}`;
                if (used(src)) continue;
                const score = 10 + Heirlooms.legend(h) / 2 + _roll(world, 'score', src, day) * 4;
                out.push({ kind: 'heirloom', src, score, h });
            }
        }

        return out.sort((x, y) => y.score - x.score);
    },

    // ── Building a quest ─────────────────────────────

    /** The days until the next quest: shorter for a famous House, a hash jitter around it. */
    interval(world, player) {
        const C = HouseQuests.config();
        const renown = _num(player && player.renown);
        const prestige = _num(player && player.house && player.house.prestige);
        const fame = Math.min(C.fameMax, Math.max(0, renown / Math.max(1, C.fameRenown) + prestige / Math.max(1, C.famePrestige)));
        const base = Math.max(C.minDays, C.baseDays / (1 + fame));
        const j = 1 + C.jitter * (_roll(world, 'gap', _day(world)) * 2 - 1);
        return Math.max(C.minDays, Math.round(base * j));
    },

    _build(world, player, c, want = null) {
        const st = HouseQuests.state(player);
        const day = _day(world);
        const W = HouseQuests.words();
        let kind = c.kind;
        if (kind === 'old_favour') {
            const P = HouseQuests.kind('protect');
            const can = P && (P.sources || []).includes(c.e.k);
            if (want === 'protect' && !can) return null;
            if (can && (want === 'protect' || (want !== 'old_favour' && _roll(world, 'protect', c.src) < _num(P.chance, 0.35)))) kind = 'protect';
        }
        const def = HouseQuests.kind(kind);
        if (!def) return null;
        const q = {
            id: `hq${st.seq++}`, kind, icon: def.icon || '📜', src: c.src, day, status: 'open',
            deadline: day + _num(def.deadlineDays, 240), weight: Math.round(_num(c.w) * 10) / 10,
        };
        let vars = {};
        let target = null;

        if (PERSON_KINDS.includes(kind)) {
            const p = c.p, e = c.e, s = c.s;
            const holder = _pname(p);
            const victim = e.vr ? (e.vn || 'their kin') : holder;
            const kin = e.vr ? HouseQuests._kinWord(e.vr, p.gender) : null;
            const deed = HouseQuests._deedLabel(e, c.a.word, victim);
            const line = NpcMemory._say(e, c.a.word, 'own');
            q.holder = { ref: c.ref, name: holder, gender: p.gender === 'female' ? 'female' : 'male', kin, victim: e.vr ? victim : null, victimRel: e.vr || null };
            q.episode = { k: e.k, d: _num(e.d), by: e.by, g: _num(e.g) };
            q.ep = HouseQuests._epCopy(e);
            q.actor = { word: c.a.word, gen: c.a.gen, name: e.by };
            q.kingdomId = s.kingdom != null ? s.kingdom : HouseQuests._kingdomAt(world, s.q, s.r);
            target = { q: s.q, r: s.r, place: s.name || 'the town' };
            vars = {
                holder, town: target.place, victim, kin: kin || '', kinCap: _cap(kin || ''), deed, line: line ? `"${line}"` : '',
                kinPhrase: kin ? _fill(W.kinPhrase || 'the {kin} of {victim}', { kin, victim }) : (W.selfPhrase || 'who lived it'),
                kinLine: kin ? _fill(W.kinLine || 'They are the {kin} of {victim}. ', { kin, victim }) + ' ' : '',
                years: HouseQuests._years(world, e.d), actor: c.a.word,
            };
            if (kind === 'blood_price' || kind === 'old_debt') q.price = HouseQuests._price(def, c.w);
            if (kind === 'old_favour') {
                const list = def.goods || [];
                const g = list[Math.floor(_roll(world, 'goods', c.src) * list.length)] || { item: 'bread', qty: [6, 10], need: 'the family is in want' };
                const [lo, hi] = Array.isArray(g.qty) ? g.qty : [g.qty || 5, g.qty || 5];
                const qty = lo + Math.floor(_roll(world, 'qty', c.src) * (hi - lo + 1));
                q.goods = { item: g.item, qty };
                q.need = g.need;
                q.price = Math.max(10, Math.round(qty * Math.max(2, _num(HouseQuests._goodValue(g.item), 4)) * 1.2));
                Object.assign(vars, { need: g.need, qty, goodName: _goodName(g.item), price: q.price });
            }
            if (kind === 'protect') {
                const threats = def.threats || ['danger has come to their door'];
                q.threat = threats[Math.floor(_roll(world, 'threat', c.src) * threats.length)];
                q.stay = Math.max(1, _num(def.stayDays, 3));
                Object.assign(vars, { threat: q.threat, days: _num(def.deadlineDays, 40), stay: q.stay });
            }
            if (q.price != null) vars.price = q.price;
            if (kind === 'blood_price') q.title = _fill(kin ? def.title : (def.titleSelf || def.title), vars);
            else q.title = _fill(def.title, vars);
        } else if (kind === 'town_amends') {
            const s = c.s, e = c.e;
            const deed = HouseQuests._deedLabel(e, c.a.word, e.vn || (s.name || 'the town'));
            const def2 = NpcMemory.kind(e.k) || {};
            const line = def2.sayTown ? _fill(def2.sayTown, { Actor: _cap(c.a.word), actor: c.a.word, vn: e.vn || '', vr: '' }) : '';
            target = { q: s.q, r: s.r, place: s.name || 'the town' };
            q.townRef = `${s.q},${s.r}`;
            q.episode = { k: e.k, d: _num(e.d), by: e.by, g: _num(e.g) };
            q.ep = HouseQuests._epCopy(e);
            q.actor = { word: c.a.word, gen: c.a.gen, name: e.by };
            q.kingdomId = s.kingdom != null ? s.kingdom : HouseQuests._kingdomAt(world, s.q, s.r);
            q.price = HouseQuests._price(def, c.w);
            vars = { town: target.place, deed, years: HouseQuests._years(world, e.d), line: line ? `"${line}"` : '', price: q.price, holder: target.place };
            q.title = _fill(def.title, vars);
        } else if (kind === 'lord_grievance') {
            const k = c.k, m = c.m;
            const lord = k.lord.name || k.ruler || `the lord of ${k.name}`;
            const seat = HouseQuests._folkAt(world, k.capital.q, k.capital.r).settlement;
            target = { q: k.capital.q, r: k.capital.r, place: (seat && seat.name) || k.name };
            q.kingdomId = k.id;
            q.lordDeed = m.key;
            q.price = HouseQuests._price(def, m.weight);
            const fromLine = m.inherited && m.from ? _fill(W.fromLine || 'It came to {lord} from {from}. ', { lord, from: m.from }) + ' ' : '';
            vars = { lord, realm: k.name || 'the realm', deed: m.label, seat: target.place, fromLine, price: q.price, years: HouseQuests._years(world, m.day), line: m.recall ? `"${m.recall}"` : '' };
            q.holder = { name: lord, lord: true };
            q.title = _fill(def.title, vars);
        } else if (kind === 'heirloom') {
            const h = c.h;
            target = { q: h.trail.q, r: h.trail.r, place: h.trail.place || 'a far town' };
            q.heirloomId = h.id;
            const how = (W.how || {})[h.status] || h.status;
            q.kingdomId = HouseQuests._kingdomAt(world, h.trail.q, h.trail.r);
            // Who sent word: a grown townsperson of the trail's town (a hash pick), if any
            const { folk } = HouseQuests._folkAt(world, h.trail.q, h.trail.r);
            const grown = folk ? folk.people.filter(p => p && p.died == null && !p.away && (day - _num(p.born, day)) / HouseQuests.config().daysPerYear >= 16) : [];
            const informant = grown.length ? grown[Math.floor(_roll(world, 'informant', c.src) * grown.length)] : null;
            if (informant) q.holder = { ref: `${h.trail.q},${h.trail.r}#${informant.id}`, name: _pname(informant), gender: informant.gender === 'female' ? 'female' : 'male', informant: true };
            vars = {
                heirloom: h.name, place: target.place, years: HouseQuests._years(world, h.trail.since), how, keeper: h.trail.holder || 'someone',
                holderLine: informant ? _fill(W.holderLine || '{holder} of {place} has sent word of it. ', { holder: _pname(informant), place: target.place }) + ' ' : '',
                holder: informant ? _pname(informant) : target.place,
            };
            q.title = _fill(def.title, vars);
        }
        if (!target) return null;
        q.target = target;
        q.vars = vars;
        q.objectives = HouseQuests._objectives(kind, def, q, vars);
        q.tell = {
            hook: _fill(def.hook, vars),
            line: vars.line ? String(vars.line).replace(/^"|"$/g, '') : '',
            journal: _fill(def.journal, vars),
            ask: _fill(def.ask, vars),
            epilogue: '',
        };
        q.tellGen = _num(player.house && player.house.generation, 1);
        q.tellWho = player.name || player.firstName || null;
        HouseQuests._writeProse(world, player, q, ['hook', 'line', 'journal']);
        return q;
    },

    /** What a quest keeps of its source memory, to tell it again from a later ruler's side. */
    _epCopy(e) {
        const ep = { k: e.k, d: _num(e.d), by: e.by, bg: _num(e.bg, 1), bs: e.bs || 'm' };
        for (const k of ['bh', 'vr', 'vn', 'g', 'fr']) if (e[k] != null) ep[k] = e[k];
        return ep;
    },

    /**
     * The kinship words ("your grandfather") are the current ruler's: when the
     * ruler has changed since the quest was told, tell it again from their side.
     * → true when it was retold.
     */
    _retell(world, player, q) {
        if (!q || !q.ep || !player || q.status !== 'open') return false;
        const gen = _num(player.house && player.house.generation, 1);
        const who = player.name || player.firstName || null;
        if (q.tellGen === gen && q.tellWho === who) return false;
        q.tellGen = gen;
        q.tellWho = who;
        const a = NpcMemory.actorOf(q.ep, player);
        const def = HouseQuests.kind(q.kind);
        if (a.gen == null || !def || !q.vars) return false;
        const v = q.vars;
        v.actor = a.word;
        if (q.kind === 'town_amends') {
            v.deed = HouseQuests._deedLabel(q.ep, a.word, q.ep.vn || v.town);
            const d2 = NpcMemory.kind(q.ep.k) || {};
            const line = d2.sayTown ? _fill(d2.sayTown, { Actor: _cap(a.word), actor: a.word, vn: q.ep.vn || '', vr: '' }) : '';
            v.line = line ? `"${line}"` : '';
        } else {
            v.deed = HouseQuests._deedLabel(q.ep, a.word, v.victim);
            const line = NpcMemory._say(q.ep, a.word, 'own');
            v.line = line ? `"${line}"` : '';
        }
        if (q.actor) { q.actor.word = a.word; q.actor.gen = a.gen; }
        q.tell.hook = _fill(def.hook, v);
        q.tell.line = v.line ? String(v.line).replace(/^"|"$/g, '') : '';
        q.tell.journal = _fill(def.journal, v);
        q.tell.ask = _fill(def.ask, v);
        HouseQuests._writeProse(world, player, q, ['hook', 'line', 'journal']);
        return true;
    },

    _goodValue(item) {
        const v = PlayerInventory.goodValue(item);
        return v > 0 ? v : 4;
    },

    _objectives(kind, def, q, vars) {
        const t = q.target;
        const reach = { type: 'reach', q: t.q, r: t.r, text: `Go to ${t.place}`, done: false };
        if (kind === 'protect') {
            reach.by = q.deadline;
            return [reach, { type: 'stay', days: q.stay, current: 0, text: `Stand by ${vars.holder} for ${q.stay} days`, done: false }];
        }
        if (kind === 'heirloom') {
            return [reach, { type: 'retrieve', id: q.heirloomId, text: `Bring ${vars.heirloom} home`, done: false }];
        }
        return [reach, { type: 'resolve', text: _fill(def.ask, vars), done: false }];
    },

    // ── The telling ──────────────────────────────────

    /** The facts a telling is written from: only what the quest holds (names, places, deeds, numbers). */
    facts(world, player, q) {
        const v = q.vars || {};
        const f = {
            ruler: player && (player.name || player.firstName) || null,
            house: player && player.house && player.house.name || null,
            matter: q.kind.replace(/_/g, ' '),
            title: q.title,
            place: q.target && q.target.place,
        };
        if (q.holder) {
            f.holder = q.holder.name;
            if (q.holder.kin) { f.holderIs = `the ${q.holder.kin} of ${q.holder.victim}`; f.victim = q.holder.victim; }
        }
        for (const k of ['deed', 'years', 'need', 'threat', 'lord', 'realm', 'seat', 'heirloom', 'keeper', 'how']) if (v[k] != null && v[k] !== '') f[k] = v[k];
        if (q.actor) f.doneBy = q.actor.word.replace(/^your /, "the ruler's ").replace(/^you$/, 'the ruler');
        if (v.line) f.theyRemember = String(v.line).replace(/^"|"$/g, '');
        if (q.price != null) f.price = `${q.price} gold`;
        if (q.goods) f.goods = `${q.goods.qty} ${_goodName(q.goods.item)}`;
        if (q.stay) f.standDays = q.stay;
        if (q.outcome) { f.outcome = q.outcome; f.ending = q.tell && q.tell.epilogue; }
        return f;
    },

    _key(q, part) { return `houseQuest:${q.id}:${part}`; },

    _writeProse(world, player, q, parts) {
        const P = HouseQuests.data().prose || {};
        const facts = HouseQuests.facts(world, player, q);
        for (const part of parts) {
            const fb = q.tell && q.tell[part];
            if (!fb) continue;
            try {
                LlmProse.write(world, { kind: `quest_${part}`, key: HouseQuests._key(q, part), facts, fallback: fb, style: P[part] || null });
            } catch (e) { /* the template stands */ }
        }
    },

    /** A telling of a quest: the model's text when written, else the template. */
    text(world, q, part) {
        const fb = (q && q.tell && q.tell[part]) || '';
        if (!q) return '';
        try { return LlmProse.text(world, HouseQuests._key(q, part), fb) || fb; } catch (e) { return fb; }
    },

    // ── The day ──────────────────────────────────────

    /**
     * Check the open quests (reach, stay, retrieve, deadlines, a holder dead)
     * and, when the time comes, let a new one arrive. → { notices, started, ended }.
     */
    processDay(world, player) {
        const out = { notices: [], started: [], ended: [] };
        try {
            const C = HouseQuests.config();
            if (!world || !player || C.enabled === false || !player.house) return out;
            const st = HouseQuests.state(player);
            const day = _day(world);
            for (const q of [...st.open]) { HouseQuests._retell(world, player, q); HouseQuests._check(world, player, q, out); }
            if (st.nextDay == null) st.nextDay = Math.max(C.firstDay, day + Math.round(HouseQuests.interval(world, player) / 2));
            if (day >= st.nextDay) {
                if (st.open.length >= C.maxOpen) {
                    st.nextDay = day + C.retryDays;
                } else {
                    const q = HouseQuests.generate(world, player);
                    st.nextDay = day + (q ? HouseQuests.interval(world, player) : C.retryDays);
                    if (q) {
                        out.started.push(q);
                        out.notices.push({ icon: q.icon, title: q.title, text: HouseQuests.text(world, q, 'hook'), type: 'info' });
                        Interrupts.raise(world, { reason: `A matter for the House: ${q.title}`, icon: q.icon || '📜', source: 'houseQuests' });
                    }
                }
            }
        } catch (e) { /* never break the day */ }
        return out;
    },

    /** Start the strongest quest the House's history offers now (pacing aside). → the quest, or null. */
    generate(world, player, opts = {}) {
        if (!world || !player || !player.house) return null;
        const C = HouseQuests.config();
        const st = HouseQuests.state(player);
        if (st.open.length >= C.maxOpen && !opts.force) return null;
        // opts.kind (tests, debug): only that kind — a favour can be asked as a plea for protection
        const list = HouseQuests.candidates(world, player).filter(c => !opts.kind || c.kind === opts.kind || (opts.kind === 'protect' && c.kind === 'old_favour'));
        for (const c of list) {
            const q = HouseQuests._build(world, player, c, opts.kind || null);
            if (!q || (opts.kind && q.kind !== opts.kind)) continue;
            st.open.push(q);
            st.seen[c.src] = _day(world);
            if (q.kind === 'lord_grievance') st.seen[`lk:${q.kingdomId}`] = _day(world) - HouseQuests.config().reuseDays + HouseQuests.config().lordGapDays;
            HouseQuests._trimSeen(st);
            return q;
        }
        return null;
    },

    _trimSeen(st) {
        const C = HouseQuests.config();
        const keys = Object.keys(st.seen);
        if (keys.length <= C.seenCap) return;
        keys.sort((a, b) => st.seen[a] - st.seen[b]);
        for (const k of keys.slice(0, keys.length - C.seenCap)) delete st.seen[k];
    },

    at(player, q) {
        return !!(player && q && q.target && player.q === q.target.q && player.r === q.target.r);
    },

    _check(world, player, q, out) {
        if (q.status !== 'open') return;
        const day = _day(world);
        // The holder may have died before the matter was settled
        if (q.holder && q.holder.ref && !q.holder.informant) {
            const who = HouseQuests._person(world, q.holder.ref);
            if (world && typeof world.getTile === 'function' && who && who.p.died != null) {
                HouseQuests._end(world, player, q, 'gone', {}, out);
                return;
            }
        }
        if (q.kind === 'heirloom') {
            const h = Heirlooms.get(player, q.heirloomId);
            if (!h) { HouseQuests._end(world, player, q, 'cold_trail', {}, out); return; }
            if (h.trail && h.trail.q != null && (h.trail.q !== q.target.q || h.trail.r !== q.target.r)) {
                q.target = { q: h.trail.q, r: h.trail.r, place: h.trail.place || q.target.place };
                q.objectives[0].q = h.trail.q; q.objectives[0].r = h.trail.r; q.objectives[0].text = `Go to ${q.target.place}`;
                q.objectives[0].done = false;
            }
        }
        for (const o of q.objectives) {
            if (o.type === 'reach') {
                if (!o.done && HouseQuests.at(player, q)) { o.done = true; o.doneDay = day; }
            } else if (o.type === 'stay') {
                const reached = q.objectives[0].done;
                if (reached && !o.done && HouseQuests.at(player, q) && o.lastDay !== day) {
                    o.current = _num(o.current) + 1;
                    o.lastDay = day;
                }
                o.done = _num(o.current) >= _num(o.days, 1);
            } else if (o.type === 'retrieve') {
                const h = Heirlooms.get(player, o.id);
                o.done = !!h && (h.status === 'held' || h.status === 'child');
            }
        }
        if (q.kind === 'protect' && q.objectives.every(o => o.done)) {
            HouseQuests._end(world, player, q, 'protected', { ...(HouseQuests.kind('protect').done || {}), memoryKind: 'protected' }, out);
            return;
        }
        if (q.kind === 'heirloom' && q.objectives[1] && q.objectives[1].done) {
            HouseQuests._end(world, player, q, 'recovered', HouseQuests.kind('heirloom').done || {}, out);
            return;
        }
        const late = q.kind === 'protect' ? (!q.objectives[0].done && day > q.objectives[0].by) || day > q.deadline + q.stay * 3 : day > q.deadline;
        if (late) HouseQuests.lapse(world, player, q.id, out);
    },

    // ── Resolving ────────────────────────────────────

    /**
     * The ways to settle a quest now: [{ id, label, desc, ok, why, cost }]. Only
     * offered once the player has reached the place (and stands there).
     */
    options(world, player, id) {
        const q = HouseQuests.get(player, id);
        if (!q) return [];
        const def = HouseQuests.kind(q.kind) || {};
        const here = HouseQuests.at(player, q);
        const away = here ? null : `Go to ${q.target.place} first.`;
        const v = { ...(q.vars || {}), price: q.price };
        if (q.kind === 'heirloom') {
            const o = Heirlooms.recoverOptions(player, world, q.heirloomId);
            if (!o) return [];
            const rows = [];
            if (o.buy != null) rows.push({ id: 'buy', label: 'Buy it back', desc: `${o.holder || 'They'} ask ${o.buy} gold.`, cost: o.buy, ok: here && _num(player.gold) >= o.buy, why: away || (_num(player.gold) < o.buy ? `You need ${o.buy} gold.` : null) });
            if (o.take != null) rows.push({ id: 'take', label: 'Take it', desc: `About ${Math.round(o.take * 100)}% to get away with it.`, ok: here, why: away });
            if (o.ask) rows.push({ id: 'ask', label: 'Ask for it', desc: `Your standing there: ${o.ask.rep} (need ${o.ask.need}).`, ok: here && o.ask.ok, why: away || (o.ask.ok ? null : `Your standing is ${o.ask.rep}; you need ${o.ask.need}.`) });
            if (o.search != null) rows.push({ id: 'search', label: 'Search for it', desc: 'Once a day, until you find it.', ok: here, why: away });
            return rows;
        }
        if (q.kind === 'protect') return [];
        const rows = [];
        for (const [oid, od] of Object.entries(def.options || {})) {
            const r = { id: oid, label: od.label || oid, desc: _fill(od.desc || '', v), ok: here, why: away };
            if (oid === 'pay' || oid === 'coin') {
                r.cost = q.price;
                if (here && _num(player.gold) < _num(q.price)) { r.ok = false; r.why = `You need ${q.price} gold.`; }
            }
            if (oid === 'deliver' && q.goods) {
                const have = _num(player.inventory && player.inventory[q.goods.item]);
                if (here && have < q.goods.qty) { r.ok = false; r.why = `You carry ${have} of ${q.goods.qty} ${_goodName(q.goods.item)}.`; }
            }
            if (oid === 'plead') {
                const ch = HouseQuests._pleadChance(player, q, od);
                r.desc = `${r.desc} (about ${Math.round(ch * 100)}%)`;
            }
            rows.push(r);
        }
        return rows;
    },

    _pleadChance(player, q, od) {
        const dip = _num(player && player.skills && player.skills.diplomacy);
        const ch = _num(od.base, 0.3) + dip * _num(od.perDiplomacy, 0.03) + Math.abs(_num(q.weight)) * _num(od.perWeight, -0.006);
        return Math.max(_num(od.min, 0.05), Math.min(_num(od.max, 0.8), ch));
    },

    /**
     * Settle a quest by a choice from options(). → { success, outcome?, text?, reason? }.
     * Heirloom choices go through Heirlooms.recover.
     */
    act(world, player, id, choice) {
        const q = HouseQuests.get(player, id);
        if (!q) return { success: false, reason: 'There is no such matter.' };
        const opt = HouseQuests.options(world, player, id).find(o => o.id === choice);
        if (!opt) return { success: false, reason: 'That is not a way to settle it.' };
        if (!opt.ok) return { success: false, reason: opt.why || 'Not now.' };
        const out = { notices: [], started: [], ended: [] };
        const def = HouseQuests.kind(q.kind) || {};
        const od = (def.options || {})[choice] || {};
        const day = _day(world);

        if (q.kind === 'heirloom') {
            const r = Heirlooms.recover(player, world, q.heirloomId, choice);
            if (r && r.success) {
                q.objectives[0].done = true;
                q.objectives[1].done = true;
                HouseQuests._end(world, player, q, 'recovered', def.done || {}, out);
                return { success: true, outcome: 'recovered', text: q.tell.epilogue };
            }
            return { success: false, reason: (r && r.reason) || 'It did not work.', failed: !!(r && r.failed) };
        }

        let outcome = null;
        const eff = { ...od };
        if (q.kind === 'blood_price' || q.kind === 'old_debt') {
            if (choice === 'pay') {
                HouseQuests._payPerson(world, player, q, q.price);
                outcome = q.kind === 'blood_price' ? 'settled' : 'repaid';
                eff.memoryKind = 'amends';
                eff.memory = Math.max(4, Math.abs(HouseQuests._liveWeight(world, q)) * _num(od.memoryShare, 1));
            } else if (choice === 'plead') {
                const ch = HouseQuests._pleadChance(player, q, od);
                if (_roll(world, 'plead', q.id, day) < ch) {
                    outcome = 'forgiven';
                    eff.memoryKind = 'amends';
                    eff.memory = Math.max(3, Math.abs(HouseQuests._liveWeight(world, q)) * _num(od.memoryShare, 0.6));
                } else {
                    outcome = 'spurned';
                    Object.assign(eff, { prestige: 0, karma: 0, rep: 0, trait: null, memoryKind: 'spurned', memory: _num(od.failMemory, -6) });
                }
            } else if (choice === 'confront') {
                outcome = q.kind === 'blood_price' ? 'confronted' : 'denied';
                eff.memoryKind = 'threatened';
            }
        } else if (q.kind === 'old_favour') {
            if (choice === 'deliver') {
                const inv = player.inventory || {};
                const left = _num(inv[q.goods.item]) - q.goods.qty;
                if (left > 0) inv[q.goods.item] = left; else delete inv[q.goods.item];
                outcome = 'kept_faith';
                eff.memoryKind = 'kept_faith';
            } else if (choice === 'coin') {
                HouseQuests._payPerson(world, player, q, q.price);
                outcome = 'coin_sent';
                eff.memoryKind = 'kept_faith';
            } else if (choice === 'refuse') {
                outcome = 'refused';
                eff.memoryKind = 'abandoned';
            }
        } else if (q.kind === 'town_amends') {
            if (choice === 'pay') {
                HouseQuests._payTown(world, player, q, q.price);
                outcome = 'town_rebuilt';
                eff.memoryKind = 'amends';
            } else {
                outcome = 'town_left';
                eff.memoryKind = 'spurned';
            }
        } else if (q.kind === 'lord_grievance') {
            if (choice === 'pay') {
                HouseQuests._payRealm(world, player, q, q.price);
                outcome = 'lord_mended';
                const lordW = Math.abs(_num(q.weight)) * _num(od.lordShare, 0.8);
                eff.lordWeight = Math.max(_num((NPCLords.deedDef('amends_made') || {}).weight, 12), Math.round(lordW * 10) / 10);
            } else {
                outcome = 'lord_defied';
            }
        }
        if (!outcome) return { success: false, reason: 'Nothing came of it.' };
        q.objectives.forEach(o => { o.done = true; });
        HouseQuests._end(world, player, q, outcome, eff, out);
        return { success: true, outcome, text: q.tell.epilogue, notices: out.notices };
    },

    /** Leave a matter be (from the journal): it ends as if left too long. */
    dismiss(world, player, id) {
        const q = HouseQuests.get(player, id);
        if (!q) return { success: false, reason: 'There is no such matter.' };
        const out = { notices: [], started: [], ended: [] };
        HouseQuests.lapse(world, player, id, out);
        return { success: true, outcome: q.outcome, text: q.tell.epilogue };
    },

    /** The matter was left too long: its lapse consequences. */
    lapse(world, player, id, out = { notices: [], started: [], ended: [] }) {
        const q = HouseQuests.get(player, id);
        if (!q) return out;
        const def = HouseQuests.kind(q.kind) || {};
        const L = { ...(def.lapse || {}) };
        let outcome = 'lapsed';
        if (q.kind === 'lord_grievance') outcome = 'lapsed_lord';
        else if (q.kind === 'town_amends') { outcome = 'lapsed_town'; L.memoryKind = 'spurned'; }
        else if (q.kind === 'heirloom') outcome = 'cold_trail';
        else if (q.kind === 'protect') { outcome = 'abandoned'; L.memoryKind = 'abandoned'; }
        else if (q.kind === 'old_favour') { L.memoryKind = 'abandoned'; }
        else L.memoryKind = 'spurned';
        if (q.kind === 'blood_price' && L.nemesisAt != null && Math.abs(HouseQuests._liveWeight(world, q)) < L.nemesisAt) delete L.nemesisScore;
        HouseQuests._end(world, player, q, outcome, L, out);
        return out;
    },

    /** The source grievance's weight as it stands today (the holder's memory), else as when the quest began. */
    _liveWeight(world, q) {
        if (!q.holder || !q.holder.ref || !q.episode) return _num(q.weight);
        const who = HouseQuests._person(world, q.holder.ref);
        const e = who && Array.isArray(who.p.nm) ? who.p.nm.find(x => x.k === q.episode.k && _num(x.d) === q.episode.d) : null;
        return e ? NpcMemory.weightAt(e, _day(world)) : _num(q.weight);
    },

    // ── Coin goes somewhere ──────────────────────────

    _payPerson(world, player, q, amount) {
        const a = Math.max(0, Math.round(_num(amount)));
        player.gold = _num(player.gold) - a;
        Ledger.record(player, 'oldDebts', -a);
        const who = HouseQuests._person(world, q.holder && q.holder.ref);
        if (who) who.p.purse = (typeof who.p.purse === 'number' ? who.p.purse : 0) + a;
    },

    _payTown(world, player, q, amount) {
        const a = Math.max(0, Math.round(_num(amount)));
        player.gold = _num(player.gold) - a;
        Ledger.record(player, 'oldDebts', -a);
        const { settlement } = HouseQuests._folkAt(world, q.target.q, q.target.r);
        if (settlement && settlement.economy && Number.isFinite(settlement.economy.gold)) settlement.economy.gold += a;
    },

    _payRealm(world, player, q, amount) {
        const a = Math.max(0, Math.round(_num(amount)));
        player.gold = _num(player.gold) - a;
        Ledger.record(player, 'oldDebts', -a);
        const k = HouseQuests._kingdom(world, q.kingdomId);
        if (k) k.treasury = _num(k.treasury) + a;
    },

    // ── Ending ───────────────────────────────────────

    _end(world, player, q, outcome, eff = {}, out = null) {
        const st = HouseQuests.state(player);
        const day = _day(world);
        const ended = outcome !== 'gone';
        q.status = ['lapsed', 'lapsed_lord', 'lapsed_town', 'cold_trail', 'abandoned', 'gone'].includes(outcome) ? 'failed' : 'done';
        q.outcome = outcome;
        q.endDay = day;
        const applied = ended ? HouseQuests._apply(world, player, q, outcome, eff) : [];
        q.effects = applied;
        const T = HouseQuests.data().outcomes || {};
        q.tell.epilogue = _fill(T[outcome] || 'The matter is closed.', { ...(q.vars || {}), price: q.price, goodName: q.goods ? _goodName(q.goods.item) : '' });
        HouseQuests._writeProse(world, player, q, ['epilogue']);
        if (player.house && ended) House._chronicle(player.house, world, `${q.title}: ${q.tell.epilogue}`, ['houseQuest']);
        st.open = st.open.filter(x => x !== q);
        st.done.unshift(q);
        if (st.done.length > HouseQuests.config().doneCap) st.done.length = HouseQuests.config().doneCap;
        if (out) {
            out.ended.push(q);
            out.notices.push({ icon: q.icon, title: q.title, text: HouseQuests.text(world, q, 'epilogue'), type: q.status === 'done' ? 'success' : 'warning' });
        }
        return q;
    },

    /** Apply a quest's consequences; → plain words of what changed. */
    _apply(world, player, q, outcome, eff) {
        const day = _day(world);
        const said = [];
        if (_num(eff.prestige) > 0 && player.house) {
            House.award(player.house, eff.prestige, `${q.title}`, day);
            said.push(`+${eff.prestige} Prestige`);
        }
        if (_num(eff.renown)) { player.renown = _num(player.renown) + eff.renown; said.push(`${eff.renown > 0 ? '+' : ''}${eff.renown} renown`); }
        if (_num(eff.karma)) { player.karma = _num(player.karma) + eff.karma; said.push(`${eff.karma > 0 ? '+' : ''}${eff.karma} karma`); }
        if (_num(eff.rep) && q.kingdomId != null) {
            if (!player.reputation) player.reputation = {};
            player.reputation[q.kingdomId] = _num(player.reputation[q.kingdomId]) + eff.rep;
            said.push(`${eff.rep > 0 ? '+' : ''}${eff.rep} standing`);
        }
        if (Array.isArray(eff.trait) && eff.trait[0]) { try { Traits.recordDeed(player, eff.trait[0], _num(eff.trait[1], 1)); } catch (e) { /* no traits */ } }

        // Memory: the holder (and through them their kin's stories), the town, the lord
        const memKind = eff.memoryKind;
        if (memKind && q.holder && q.holder.ref && !q.holder.informant && PERSON_KINDS.includes(q.kind)) {
            const who = HouseQuests._person(world, q.holder.ref);
            if (who) {
                const def = NpcMemory.kind(memKind) || {};
                const w = Number.isFinite(eff.memory) ? eff.memory : _num(def.weight);
                const victim = q.holder.victimRel ? { name: q.holder.victim, rel: q.holder.victimRel } : null;
                if (w) {
                    NpcMemory.remember(world, { folk: who.folk, person: who.p }, { kind: memKind, weight: Math.round(w * 10) / 10, player, victim, day });
                    said.push(w > 0 ? `${q.holder.name} will remember it kindly` : `${q.holder.name} will remember it`);
                }
                if (q.kind === 'protect' && outcome === 'abandoned' && _num(eff.hurt) > 0) {
                    try { Townsfolk.injure(who.p, day, eff.hurt, eff.hurt); } catch (e) { /* no roster */ }
                }
            }
        }
        if (memKind && q.kind === 'town_amends' && q.townRef) {
            const [tq, tr] = q.townRef.split(',').map(Number);
            const w = Number.isFinite(eff.memory) ? eff.memory : _num((NpcMemory.kind(memKind) || {}).weight);
            if (w) NpcMemory.rememberTown(world, { q: tq, r: tr }, { kind: memKind, weight: w, player, day });
        }
        const lordDeed = eff.lordDeed;
        if (lordDeed && q.kind === 'lord_grievance') {
            const k = HouseQuests._kingdom(world, q.kingdomId);
            if (k && k.lord) {
                const opts = { day, note: q.lordDeed || undefined };
                if (Number.isFinite(eff.lordWeight)) opts.weight = eff.lordWeight;
                NPCLords.rememberDeed(world, k.lord, lordDeed, opts);
                said.push(lordDeed === 'amends_made' ? `${q.vars.lord} counts it mended` : `${q.vars.lord} will remember it`);
            }
        }
        // A blood grudge spurned or threatened becomes a feud
        if (_num(eff.nemesisScore) > 0 && q.kind === 'blood_price' && q.holder && q.holder.ref) {
            const who = HouseQuests._person(world, q.holder.ref);
            if (who && who.p.died == null) {
                const g = Nemesis.wrong(player, world, {
                    kind: 'blood', name: q.holder.name, ref: { folkRef: q.holder.ref }, line: who.p.last || null,
                    deed: { key: q.episode ? q.episode.k : 'wrong', label: q.vars.deed || 'the wrong your House did them', note: q.target.place },
                    score: eff.nemesisScore + Math.abs(_num(q.weight)) / 2,
                    age: Math.floor((day - _num(who.p.born, day)) / HouseQuests.config().daysPerYear), gender: q.holder.gender,
                });
                if (g) { q.feud = true; said.push(`${q.holder.name} has sworn a grudge`); }
            }
        }
        return said;
    },

    // ── Reading ──────────────────────────────────────

    /** The holder's line when the player talks to them in town (ui/npcDialog), or null. */
    dialogLine(world, player, npcRef) {
        try {
            const open = HouseQuests.open(player);
            if (!open.length) return null;
            const ref = NpcMemory.refOf(world, npcRef);
            if (!ref) return null;
            const q = open.find(x => x.holder && x.holder.ref === ref);
            if (!q) return null;
            HouseQuests._retell(world, player, q);
            return HouseQuests.text(world, q, 'line') || HouseQuests.text(world, q, 'hook') || null;
        } catch (e) {
            return null;
        }
    },

    /** Rows for the journal: { open: [...], past: [...] } with the tellings resolved. */
    view(world, player) {
        for (const q of HouseQuests.open(player)) HouseQuests._retell(world, player, q);
        const row = (q) => ({
            id: q.id, kind: q.kind, icon: q.icon, title: q.title, status: q.status, outcome: q.outcome || null,
            place: q.target && q.target.place, here: HouseQuests.at(player, q),
            hook: HouseQuests.text(world, q, 'hook'), line: HouseQuests.text(world, q, 'line'),
            journal: HouseQuests.text(world, q, 'journal'), ask: q.tell && q.tell.ask,
            epilogue: q.outcome ? HouseQuests.text(world, q, 'epilogue') : '',
            daysLeft: q.status === 'open' ? Math.max(0, _num(q.deadline) - _day(world)) : null,
            objectives: (q.objectives || []).map(o => ({ text: o.type === 'stay' ? `${o.text} (${_num(o.current)}/${o.days})` : o.text, done: !!o.done })),
            effects: q.effects || [], day: q.day, endDay: q.endDay || null,
            options: q.status === 'open' ? HouseQuests.options(world, player, q.id) : [],
        });
        return { open: HouseQuests.open(player).map(row), past: HouseQuests.done(player).slice(0, 12).map(row) };
    },
};
