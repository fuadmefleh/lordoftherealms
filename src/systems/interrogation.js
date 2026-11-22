// ============================================
// INTERROGATION — the dungeon: putting a prisoner to the question
// ============================================
// Those you hold can be made to talk, and what they give up is real: the
// game already holds it, and you did not know it.
//
//   WHO      a townsperson in your cellar (systems/peopleCrimes.js captives),
//            a rival House's child you took on the road (systems/
//            rivalCaptives.js), an outlaw you took for a bounty and have not
//            yet turned in (systems/bountyHunting.js), a crushed rising's
//            leader (systems/peasantRevolts.js prisoners: knows the
//            ringleaders), a PRISONER OF WAR — a captain, knight or lord
//            taken from a realm's beaten host or a town stormed
//            (takePrisoners, from player/fieldBattle.js and systems/
//            sieges.js): ransomed out of the realm's treasury, sent home,
//            sent to the scaffold, or made to tell its realm's books and
//            army (player.interrogation.eyes, read by systems/realmIntel.js).
//            Interrogation.held(). Your own spies taken abroad
//            (player.espionage.takenSpies) may be tortured by that crown.
//   THE LADDER  talk, threaten, no sleep and no bread, the rack and the
//            irons, the fire (data/interrogation.json steps). One session a
//            day each. Whether they break: the step, the strain of the
//            sessions they held out, their hurt body, against their resolve
//            (a townsperson's traits, a rival child's blood loyalty, an
//            outlaw's hardness); a kind word works on the gentle steps
//            (diplomacy), a dreaded name on the hard ones (Atrocities
//            butcher). The body pays (hp, mended a little each day; a cellar
//            prisoner's hunger, read by PeopleCrimes' starving; the fire may
//            leave a brand, MaimMarks), and they may die under it.
//   WHAT THEY KNOW (a fixed hash per prisoner and secret, data know):
//            a hidden plot of a rival House against you (Schemes: revealed,
//            its agent a suspect you can confront) · a rival's bought man in
//            your towns (RivalAgents: a NAME) · who robbed you (NpcTheft's
//            open case: a NAME) · an outlaw lair not on your charts
//            (OutlawLairs.reveal) · buried treasure not yet found (a treasure
//            map in your collection) · a rival House's purse, ambition and
//            errand, and an informant on its plots (house.informants, read by
//            Schemes.revealChance).
//   LIES     broken under the irons they may name an innocent instead: a real
//            townsperson, a lord of your court. A name looks the same either
//            way. Accuse them (true: the agent exposed, the thief named;
//            false: the town and the kin remember, the realm's regard and a
//            lord's grudge) or, where systems/executions.js exists, condemn
//            them (a false one comes out weeks later, worse).
//   THE PRICE  karma, cruelty and dread (Traits), the name for cruelty
//            (Atrocities butcher), the realm's law on torture (systems/laws.js
//            'torture': forbidden / for treason only / free) — word of an
//            unlawful session that gets out costs heat with the crown and the
//            realm's regard; the realm's faith (systems/maimFaith.js stance:
//            a sacred body weighs heavier, the clergy turn); gossip; the
//            lords' memory (lordMemory torture / torture_heard); the
//            prisoner's own memory and the kin's (npcMemory tortured); a
//            rival House's feud and memory (and a child dead in your keeping
//            is blood owed: rival.maimOwed, Maiming's vengeance).
//   THE AI   a rival House holding a child of yours as a hostage, with a hot
//            feud, may put the child to the question: the child is hurt and
//            the House hatches a plot from what it learned (weekly, rare).
//
// State: player.interrogation (subjects, names, intel, log, stats; saved).
// Explicit params, no globals. The player's own sessions roll hashes of the
// world seed (no shared dice); the AI's plot draws on its own seeded stream.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { NPCLords } from '../world/npcLords.js';
import { Townsfolk } from './townsfolk.js';
import { PeopleCrimes } from './peopleCrimes.js';
import { RivalCaptives } from './rivalCaptives.js';
import { RivalHouses } from './rivalHouses.js';
import { MaimMarks } from './maimMarks.js';
import { MaimFaith } from './maimFaith.js';
import { Schemes } from './schemes.js';
import { RivalAgents } from './rivalAgents.js';
import { NpcTheft } from './npcTheft.js';
import { OutlawLairs } from './outlawLairs.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Atrocities } from './atrocities.js';
import { Gossip } from './gossip.js';
import { NpcMemory } from './npcMemory.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Devotion } from './devotion.js';
import { Kingship } from './kingship.js';
import { Throne } from './throne.js';
import { Nemesis } from './nemesis.js';
import { BountyHunting } from './bountyHunting.js';
import { Executions } from './executions.js';
import { PeasantRevolts } from './peasantRevolts.js';
import { RealmWars } from './realmWars.js';
import { Ledger } from './ledger.js';

/** The scaffold (systems/executions.js), when it is enabled. */
function _executions() {
    return Executions && typeof Executions.condemn === 'function' ? Executions : null;
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** 0..1, fixed for a key in this world (no shared stream). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|interrogation|${key}`) % 100000) / 100000;
}

function _words(gender) {
    const f = gender === 'female';
    return { he: f ? 'she' : 'he', He: f ? 'She' : 'He', him: f ? 'her' : 'him', his: f ? 'her' : 'his' };
}

function _dist(world, q1, r1, q2, r2) {
    if (typeof Hex.wrappingDistance === 'function') return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
    return Hex.distance(q1, r1, q2, r2);
}

const DEFAULTS = {
    enabled: true, recoverPerDay: 3, strainPer: 0.03, hpPer: 0.003, diplomacyPer: 0.01, dreadPer: 0.002, dreadMax: 0.15, deathBelowHp: 45, deathPerHp: 0.006,
    steps: {
        talk: { label: 'Talk with them', icon: '🗣️', gentle: true, break: 0.08, strain: 0.5, hp: 0, death: 0, lie: 0, lieEmpty: 0, harsh: false },
        threaten: { label: 'Threaten them', icon: '😠', gentle: true, break: 0.16, strain: 1, hp: 0, death: 0, lie: 0.1, lieEmpty: 0.2, cruelty: 0.3, dread: 0.5, karma: -1, butcher: 0.3, harsh: false },
        deprive: { label: 'No sleep, no bread', icon: '🌑', break: 0.24, strain: 1.5, hp: 14, hunger: 2, death: 0.01, lie: 0.25, lieEmpty: 0.45, cruelty: 1, dread: 0.8, karma: -2, butcher: 1, harsh: true },
        irons: { label: 'The rack and the irons', icon: '⛓️', break: 0.38, strain: 2, hp: 26, death: 0.03, lie: 0.45, lieEmpty: 0.75, cruelty: 2.5, dread: 1.5, karma: -4, butcher: 2.5, harsh: true },
        fire: { label: 'The fire', icon: '🔥', break: 0.52, strain: 2.5, hp: 32, mark: 'brand', markChance: 0.5, death: 0.06, lie: 0.55, lieEmpty: 0.85, cruelty: 4, dread: 2.5, karma: -6, butcher: 4, harsh: true },
    },
    resolve: { base: 0.05, traits: {}, rivalBlood: 0.15, heir: 0.06, outlaw: 0.08, noble: 0.05, minBreak: 0.02, maxBreak: 0.92 },
    know: {
        scheme: { self: 1, town: 0.4, rival: 0.75, outlaw: 0.25 }, agent: { self: 1, town: 0.35, rival: 0.6, outlaw: 0 },
        thief: { town: 0.4, outlaw: 0.3 }, lair: { town: 0.25, outlaw: 0.85, townRadius: 10, outlawRadius: 25 },
        cache: { town: 0.15, outlaw: 0.5, townRadius: 8, outlawRadius: 15 }, intel: { rival: 1, intelDays: 120 }, accomplice: { rebel: 0.9 }, realm: { captain: 0.7, knight: 0.8, lord: 1, days: 120 },
    },
    leak: { captive: 0.05, rival: 0.12, bounty: 0.08, rebel: 0.08, pow: 0.15 },
    pow: {},
    spies: {},
    brand: { heat: 6, rep: -4, sacredMult: 1.5, harshMult: 0.5, clergy: 2, lawfulRep: 0.3, rivalFeud: 25, rivalOthers: 4, courtGrudge: 2, deathFeud: 100 },
    names: { falseRep: -6, falseGrudge: 15, courtGrudge: 3, trueRep: 2, keep: 30 },
    ai: { enabled: true, feud: 70, weekly: 0.02, everyDays: 240, hp: 30, markChance: 0.25 },
    lines: {},
};

/** The order a broken prisoner gives things up. */
const PRIORITY = { scheme: 1, agent: 2, accomplice: 2, realm: 3, intel: 3, lair: 4, thief: 5, cache: 6 };
/** How hard each harsh step weighs on the doer's name. */
const SEVERITY = { deprive: 1, irons: 2, fire: 3 };

let _cfg = null;
let _cfgSrc;

export const Interrogation = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.interrogation : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const steps = {};
            const ds = _obj(d.steps) || {};
            for (const id of Object.keys({ ...DEFAULTS.steps, ...ds })) steps[id] = { ...(DEFAULTS.steps[id] || {}), ...(_obj(ds[id]) || {}) };
            const know = {};
            for (const k of Object.keys(DEFAULTS.know)) know[k] = { ...DEFAULTS.know[k], ...(_obj((_obj(d.know) || {})[k]) || {}) };
            _cfg = {
                ...DEFAULTS, ...d, steps, know,
                resolve: { ...DEFAULTS.resolve, ...(_obj(d.resolve) || {}) },
                leak: { ...DEFAULTS.leak, ...(_obj(d.leak) || {}) },
                brand: { ...DEFAULTS.brand, ...(_obj(d.brand) || {}) },
                names: { ...DEFAULTS.names, ...(_obj(d.names) || {}) },
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                pow: { ...DEFAULTS.pow, ...(_obj(d.pow) || {}) },
                spies: { ...DEFAULTS.spies, ...(_obj(d.spies) || {}) },
                lines: { ...DEFAULTS.lines, ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    enabled() { return Interrogation.config().enabled !== false; },

    /** The steps of the ladder, in order: [{ id, ...def }]. */
    steps() {
        return Object.entries(Interrogation.config().steps).map(([id, s]) => ({ id, ...s }));
    },

    step(id) { return Interrogation.config().steps[id] || null; },

    line(key, vars = {}, salt = '') {
        const pool = Interrogation.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── State ──────────────────────────────────────────────

    _blank() {
        return { v: 1, subjects: {}, names: [], nextName: 1, intel: {}, log: [], lastWeek: null, aiDays: {}, pows: [], nextPow: 1, eyes: {}, spiesDone: [], stats: { sessions: 0, harsh: 0, broken: 0, died: 0, names: 0, lies: 0, told: 0, falseActed: 0 } };
    },

    state(player) {
        if (!player) return null;
        if (!_obj(player.interrogation)) player.interrogation = Interrogation._blank();
        const st = player.interrogation;
        const b = Interrogation._blank();
        if (!_obj(st.subjects)) st.subjects = {};
        if (!Array.isArray(st.names)) st.names = [];
        if (!(st.nextName > 0)) st.nextName = st.names.length + 1;
        if (!_obj(st.intel)) st.intel = {};
        if (!Array.isArray(st.log)) st.log = [];
        if (!_obj(st.aiDays)) st.aiDays = {};
        if (!Array.isArray(st.pows)) st.pows = [];
        if (!(st.nextPow > 0)) st.nextPow = st.pows.length + 1;
        if (!_obj(st.eyes)) st.eyes = {};
        if (!Array.isArray(st.spiesDone)) st.spiesDone = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && _obj(player.interrogation) ? JSON.parse(JSON.stringify(player.interrogation)) : null;
    },

    loadState(player) {
        if (player && player.interrogation) Interrogation.state(player);
    },

    _log(st, day, text) {
        st.log.unshift({ day, text });
        if (st.log.length > 30) st.log.length = 30;
    },

    _by(player) { return (player && player.name) || 'a stranger'; },

    // ── Those you hold ─────────────────────────────────────

    /** The realm whose law reaches the player now (the one ruled, else where they stand, else their allegiance). */
    _playerRealm(player, world) {
        try { const k = Throne.ruledKingdom(player, world); if (k) return k.id; } catch (e) { /* no throne */ }
        const t = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        if (t && t.settlement && t.settlement.kingdom != null) return t.settlement.kingdom;
        return player && player.allegiance != null ? player.allegiance : null;
    },

    /** The settlement nearest a hex with a roster of townsfolk, or null. */
    _nearestTown(world, q, r) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        let best = null;
        for (const s of views) {
            if (!s || !s.folk || !Array.isArray(s.folk.people)) continue;
            const d = Number.isFinite(q) ? _dist(world, q, r, s.folk.q != null ? s.folk.q : s.q, s.folk.r != null ? s.folk.r : s.r) : 0;
            if (!best || d < best.d) best = { s, d };
        }
        return best ? best.s : null;
    },

    /**
     * Everyone the player holds who can be put to the question:
     * [{ key, kind ('captive'|'rival'|'bounty'), id, name, gender, desc, body,
     *    q, r, kingdomId, town (settlement or null), folk, person, cap, rival, bounty }].
     */
    held(player, world) {
        const out = [];
        if (!player || !Interrogation.enabled()) return out;
        for (const cap of PeopleCrimes.captives(player)) {
            if (!cap || cap.dead) continue;
            const { s, folk, p } = PeopleCrimes.personAt(world, cap.q, cap.r, cap.pid);
            if (!p || p.died != null) continue;
            out.push({ key: `cap:${cap.id}`, kind: 'captive', id: cap.id, name: cap.name, gender: p.gender === 'female' ? 'female' : 'male', body: p, person: p, folk, town: s,
                q: cap.q, r: cap.r, kingdomId: cap.kingdom != null ? cap.kingdom : s && s.kingdom != null ? s.kingdom : null, cap,
                desc: `In your cellar at ${cap.town || 'a town'}, ${Math.max(0, _day(world) - _num(cap.day))} days` });
        }
        let rivals = [];
        try { rivals = RivalCaptives.targets(player, world); } catch (e) { rivals = []; }
        for (const t of rivals) {
            if (!t || !t.cap || !t.body) continue; // (wards at your court are guests, not prisoners)
            out.push({ key: `riv:${t.cap.id}`, kind: 'rival', id: t.cap.id, name: t.name, gender: t.body.gender === 'female' ? 'female' : 'male', body: t.body, rival: t.rival, cap: t.cap,
                q: player.q, r: player.r, kingdomId: Interrogation._playerRealm(player, world), town: null, desc: t.desc });
        }
        for (const b of player.activeBounties || []) {
            if (!b || b.type !== 'criminal_hunt' || b.status !== 'captured_pending_decision') continue;
            const q = Number.isFinite(b.targetQ) ? b.targetQ : player.q;
            const r = Number.isFinite(b.targetR) ? b.targetR : player.r;
            let kid = b.kingdomId != null ? b.kingdomId : null;
            if (kid == null && world && typeof world.getTile === 'function' && b.fromQ != null) {
                const t = world.getTile(b.fromQ, b.fromR);
                if (t && t.settlement) kid = t.settlement.kingdom;
            }
            out.push({ key: `bty:${b.id}`, kind: 'bounty', id: b.id, name: b.targetName || 'the outlaw', gender: b.gender === 'female' ? 'female' : 'male', body: b, bounty: b,
                q, r, kingdomId: kid, town: Interrogation._nearestTown(world, q, r), desc: `Taken for ${b.crime || 'his crimes'}, awaiting your word` });
        }
        // A crushed rising's leader in your prison (systems/peasantRevolts.js)
        let rebels = [];
        try { rebels = PeasantRevolts.prisoners(player); } catch (e) { rebels = []; }
        for (const pr of rebels) {
            if (!pr || pr.kind !== 'rebel_leader') continue;
            const f = pr.pid != null ? PeopleCrimes.personAt(world, pr.q, pr.r, pr.pid) : { s: null, folk: null, p: null };
            if (f.p && f.p.died != null) continue;
            out.push({ key: `reb:${pr.id}`, kind: 'rebel', id: pr.id, name: pr.name, gender: pr.gender === 'female' ? 'female' : 'male', body: f.p || pr, person: f.p || null, folk: f.folk, town: f.s,
                q: pr.q, r: pr.r, kingdomId: pr.kingdomId != null ? pr.kingdomId : f.s ? f.s.kingdom : null, rebel: pr,
                desc: `Led the rising at ${pr.town || 'a town'}${pr.cause ? ` over ${pr.cause}` : ''}` });
        }
        // Prisoners of war: captains, knights and lords taken from a beaten host or a fallen town
        for (const w of Interrogation.state(player).pows) {
            if (!w || w.condemned) continue;
            out.push({ key: `pow:${w.id}`, kind: 'pow', id: w.id, name: w.name, gender: w.gender === 'female' ? 'female' : 'male', body: w, pow: w,
                q: player.q, r: player.r, kingdomId: Interrogation._playerRealm(player, world), foe: w.kingdomId, town: null,
                desc: `${w.title} of ${w.realm}, taken ${w.how} day ${w.day}` });
        }
        return out;
    },

    find(player, world, key) {
        return Interrogation.held(player, world).find(h => h.key === String(key)) || null;
    },

    /** The prisoner's record in the dungeon (strain, body, what they told). */
    subject(player, h, world) {
        const st = Interrogation.state(player);
        let s = st.subjects[h.key];
        const day = _day(world);
        if (!_obj(s)) s = st.subjects[h.key] = { name: h.name, strain: 0, hp: 100, hpDay: day, sessions: 0, lastDay: null, told: [], tortured: false, broke: 0 };
        if (!Array.isArray(s.told)) s.told = [];
        // (they mend a little each day)
        const C = Interrogation.config();
        s.hp = Math.min(100, _num(s.hp, 100) + Math.max(0, day - _num(s.hpDay, day)) * _num(C.recoverPerDay, 3));
        s.hpDay = day;
        return s;
    },

    /** How the prisoner's body is, in words. */
    bodyWord(hp) {
        return hp >= 90 ? 'whole' : hp >= 65 ? 'bruised' : hp >= 40 ? 'hurt' : hp >= 20 ? 'badly hurt' : 'near death';
    },

    // ── The law ────────────────────────────────────────────

    /** The realm's law on torture: 'forbidden' | 'treason' | 'free' (no realm: no one's law). */
    law(world, kingdomId) {
        if (kingdomId == null) return 'free';
        let v = null;
        try { v = Laws.value(world, kingdomId, 'torture'); } catch (e) { v = null; }
        return v || 'treason';
    },

    /** Is this prisoner one the law calls a traitor: a plotter's tool, a rival's bought man, blood of a House at feud with you? */
    treason(player, world, h) {
        if (!h) return false;
        if (h.kind === 'rival') {
            const rid = h.rival && h.rival.kingdomId;
            return _num(h.rival && h.rival.feud) >= 60 || Schemes.active(player).some(s => String(s.realmId != null ? s.realmId : s.rivalId) === String(rid) || String(s.rivalId) === String(rid));
        }
        if (h.kind === 'rebel') return true;
        if (h.kind === 'pow') {
            try { return !!RealmWars._state(player).wars[h.foe]; } catch (e) { return false; }
        }
        if (h.kind === 'captive' && h.person) {
            const pid = h.person.id;
            const at = (o) => o && o.q === h.q && o.r === h.r && o.pid === pid;
            if (Schemes.active(player).some(s => at(s.agent))) return true;
            if (RivalAgents.list(player).some(a => at(a) && !a.turned)) return true;
            // (a name given under the question is grounds enough for the law)
            return Interrogation.state(player).names.some(n => n.claim === 'agent' && at(n) && n.status === 'open');
        }
        return false;
    },

    /** Is the step lawful on this prisoner where they are held? */
    lawful(player, world, h, stepId) {
        const step = Interrogation.step(stepId);
        if (!step || !step.harsh) return true;
        const law = Interrogation.law(world, h.kingdomId);
        if (law === 'free') return true;
        if (law === 'treason') return Interrogation.treason(player, world, h);
        return false;
    },

    // ── What they know ─────────────────────────────────────

    /** Every real secret this prisoner could hold, before their own knowing: [{ key, type, chance, ... }]. */
    _secrets(player, world, h) {
        const K = Interrogation.config().know;
        const day = _day(world);
        const out = [];
        const add = (o) => { if (o.chance > 0) out.push(o); };
        const pid = h.person ? h.person.id : null;
        const townKind = h.kind === 'captive' || h.kind === 'rebel';
        const self = (o) => townKind && pid != null && o && o.q === h.q && o.r === h.r && o.pid === pid;
        const sameTown = (o) => townKind && o && o.q === h.q && o.r === h.r;
        const field = h.kind !== 'rival' && h.kind !== 'pow';
        const rid = h.kind === 'rival' && h.rival ? h.rival.kingdomId : null;
        // Plots against you
        for (const s of Schemes.active(player)) {
            if (!s || s.revealed) continue;
            let c = 0;
            if (self(s.agent)) c = K.scheme.self;
            else if (rid != null && (String(s.realmId) === String(rid) || String(s.rivalId) === String(rid))) c = K.scheme.rival;
            else if (sameTown(s.agent)) c = K.scheme.town;
            else if (h.kind === 'bounty' && s.type === 'raid_property') c = K.scheme.outlaw;
            add({ key: `scheme:${s.id}`, type: 'scheme', chance: _num(c), scheme: s });
        }
        // Bought men in your towns (a name)
        for (const a of RivalAgents.list(player)) {
            if (!a || a.known || a.turned) continue;
            let c = 0;
            if (self(a)) c = K.agent.self;
            else if (rid != null && String(a.rivalId) === String(rid)) c = K.agent.rival;
            else if (sameTown(a)) c = K.agent.town;
            else if (h.kind === 'bounty') c = K.agent.outlaw;
            add({ key: `agent:${a.id}`, type: 'agent', chance: _num(c), agent: a });
        }
        // Who robbed you (a name)
        if (field) {
            let cases = [];
            try { cases = NpcTheft.openCases(player); } catch (e) { cases = []; }
            for (const e of cases) {
                if (!e || e.named || !e.thief || e.thief.pid == null) continue;
                if (self({ q: e.q, r: e.r, pid: e.thief.pid })) continue; // (they will not name themselves)
                const c = townKind ? (sameTown(e) ? K.thief.town : 0) : (e.lairId != null || (h.town && h.town.folk && h.town.folk.q === e.q && h.town.folk.r === e.r) ? K.thief.outlaw : 0);
                add({ key: `thief:${e.id}`, type: 'thief', chance: _num(c), theft: e });
            }
        }
        // Outlaw lairs not on your charts
        if (field) {
            const radius = h.kind === 'bounty' ? K.lair.outlawRadius : K.lair.townRadius;
            const c = h.kind === 'bounty' ? K.lair.outlaw : K.lair.town;
            for (const l of (player.outlawLairs ? OutlawLairs.state(player).lairs : []) || []) {
                if (!l || l.known || l.status !== 'active' || !Number.isFinite(l.q)) continue;
                if (_dist(world, h.q, h.r, l.q, l.r) > _num(radius, 10)) continue;
                add({ key: `lair:${l.id}`, type: 'lair', chance: _num(c), lair: l });
            }
        }
        // Buried treasure no one has found
        if (field && world && typeof world.getTile === 'function') {
            const R = Math.round(_num(h.kind === 'bounty' ? K.cache.outlawRadius : K.cache.townRadius, 8));
            const c = h.kind === 'bounty' ? K.cache.outlaw : K.cache.town;
            const mapped = new Set((player.maps || []).filter(m => m && m.treasureQ != null).map(m => `${m.treasureQ},${m.treasureR}`));
            const W = _num(world.width, 0);
            if (c > 0 && Number.isFinite(h.q)) {
                for (let dr = -R; dr <= R; dr++) {
                    for (let dq = -R; dq <= R; dq++) {
                        let q = h.q + dq;
                        const r = h.r + dr;
                        if (W > 0) q = ((q % W) + W) % W;
                        const t = world.getTile(q, r);
                        if (!t || !t.buried || t.buried.discovered || mapped.has(`${q},${r}`)) continue;
                        if (_dist(world, h.q, h.r, q, r) > R) continue;
                        add({ key: `cache:${q},${r}`, type: 'cache', chance: _num(c), q, r, tile: t });
                    }
                }
            }
        }
        // A rival House's purse, ambition and errand (once a season of intelDays)
        if (h.kind === 'rival' && h.rival) {
            const per = Math.max(1, _num(K.intel.intelDays, 120));
            add({ key: `intel:${rid}:${Math.floor(day / per)}`, type: 'intel', chance: _num(K.intel.rival, 1), rival: h.rival });
        }
        // A rising's ringleaders, known to its leader by name (systems/peasantRevolts.js knows.accomplices)
        if (h.kind === 'rebel' && h.rebel) {
            const names = (h.rebel.knows && Array.isArray(h.rebel.knows.accomplices)) ? h.rebel.knows.accomplices : [];
            for (const nm of names) {
                const f = PeopleCrimes.personByName(world, h.q, h.r, nm);
                if (!f.p || f.p.died != null) continue;
                add({ key: `accomplice:${h.q},${h.r}#${f.p.id}`, type: 'accomplice', chance: _num(K.accomplice && K.accomplice.rebel, 0.9), person: f.p, folk: f.folk, settlement: f.s });
            }
        }
        // A captain or lord of a realm: its treasury, its army and its war plans
        if (h.kind === 'pow' && h.pow) {
            const per = Math.max(1, _num(K.realm && K.realm.days, 120));
            const kc = _num(K.realm && K.realm[h.pow.rank], 0.8);
            add({ key: `realm:${h.pow.kingdomId}:${Math.floor(day / per)}`, type: 'realm', chance: kc, pow: h.pow });
        }
        return out;
    },

    /** What this prisoner knows and has not yet told, best first. */
    knows(player, world, h) {
        const sub = Interrogation.subject(player, h, world);
        const told = new Set(sub.told);
        return Interrogation._secrets(player, world, h)
            .filter(s => !told.has(s.key) && _roll(world, `know|${h.key}|${s.key}`) < s.chance)
            .sort((a, b) => (PRIORITY[a.type] || 9) - (PRIORITY[b.type] || 9));
    },

    // ── How hard they are ──────────────────────────────────

    /** Their resolve: what is taken off every step's chance. */
    resolve(player, world, h) {
        const R = Interrogation.config().resolve;
        let v = _num(R.base);
        const traits = (h.person && h.person.traits) || [];
        for (const t of traits) v += _num((R.traits || {})[t]);
        if (h.kind === 'rival') {
            v += _num(R.rivalBlood);
            try { if (RivalCaptives.isHeir(h.rival, h.body)) v += _num(R.heir); } catch (e) { /* no heir */ }
        }
        if (h.kind === 'bounty') v += _num(R.outlaw) + _num(h.bounty && h.bounty.difficulty) * 0.01;
        if (h.person && h.person.role === 'noble') v += _num(R.noble);
        if (h.kind === 'rebel') v += _num(R.rebel, 0.1);
        if (h.kind === 'pow' && h.pow) v += _num((R.pow || {})[h.pow.rank], 0.1);
        return v;
    },

    /** The chance this step breaks them today. */
    breakChance(player, world, h, stepId) {
        const C = Interrogation.config();
        const step = Interrogation.step(stepId);
        if (!step) return 0;
        const sub = Interrogation.subject(player, h, world);
        let c = _num(step.break) + _num(sub.strain) * _num(C.strainPer) + (100 - _num(sub.hp, 100)) * _num(C.hpPer) - Interrogation.resolve(player, world, h);
        if (step.gentle) c += _num(player.skills && player.skills.diplomacy) * _num(C.diplomacyPer);
        else c += Math.min(_num(C.dreadMax), Atrocities.butcher(player) * _num(C.dreadPer));
        if (stepId === 'threaten') c += Math.min(_num(C.dreadMax), Atrocities.butcher(player) * _num(C.dreadPer));
        return Utils.clamp(c, _num(C.resolve.minBreak, 0.02), _num(C.resolve.maxBreak, 0.92));
    },

    /** The chance they die under this step today. */
    deathChance(player, world, h, stepId) {
        const C = Interrogation.config();
        const step = Interrogation.step(stepId);
        if (!step || !(_num(step.hp) > 0)) return 0;
        const sub = Interrogation.subject(player, h, world);
        const after = _num(sub.hp, 100) - _num(step.hp);
        if (after <= 0) return 1;
        return Utils.clamp(_num(step.death) + Math.max(0, _num(C.deathBelowHp, 45) - after) * _num(C.deathPerHp), 0, 1);
    },

    /** For the panel: each step with its odds and what it would cost here. */
    options(player, world, h) {
        const sub = Interrogation.subject(player, h, world);
        const asked = sub.lastDay === _day(world);
        return Interrogation.steps().map(s => ({
            ...s, chance: Interrogation.breakChance(player, world, h, s.id), death: Interrogation.deathChance(player, world, h, s.id),
            lawful: Interrogation.lawful(player, world, h, s.id), ok: !asked, why: asked ? 'Once a day: let them sit with it till tomorrow.' : '',
        }));
    },

    // ── A session ──────────────────────────────────────────

    /**
     * Put a prisoner to the question. → { success, text, broke, told, died, reason }
     * (Whether what they said is true is not in the answer: the player cannot tell.)
     */
    question(player, world, key, stepId) {
        if (!player || !Interrogation.enabled()) return { success: false, reason: 'Not in this world.' };
        const h = Interrogation.find(player, world, key);
        if (!h) return { success: false, reason: 'You hold no such prisoner.' };
        const step = Interrogation.step(stepId);
        if (!step) return { success: false, reason: 'No such thing.' };
        const st = Interrogation.state(player);
        const sub = Interrogation.subject(player, h, world);
        const day = _day(world);
        if (sub.lastDay === day) return { success: false, reason: `${h.name} has had enough for one day.` };
        const w = _words(h.gender);
        const vars = { Name: h.name, name: h.name, ...w };
        const salt = `${h.key}|${sub.sessions}|${day}`;
        const chance = Interrogation.breakChance(player, world, h, stepId);
        const death = Interrogation.deathChance(player, world, h, stepId);
        const lawful = Interrogation.lawful(player, world, h, stepId);
        sub.lastDay = day;
        sub.sessions++;
        st.stats.sessions++;
        const parts = [];
        // The body pays
        if (_num(step.hp) > 0) sub.hp = Math.max(0, _num(sub.hp, 100) - _num(step.hp));
        if (_num(step.hunger) > 0 && h.cap && h.kind === 'captive') h.cap.hunger = _num(h.cap.hunger) + _num(step.hunger);
        if (step.mark && h.body && _roll(world, `mark|${salt}`) < _num(step.markChance)) {
            try {
                if (MaimMarks && typeof MaimMarks.mark === 'function' && !MaimMarks.whyNot(h.body, step.mark)) {
                    MaimMarks.mark(h.body, step.mark, { day, by: Interrogation._by(player), why: 'the question' });
                    parts.push(`The iron leaves its mark on ${w.his} face for life.`);
                }
            } catch (e) { /* no marks */ }
        }
        // The price to you
        const brand = step.harsh || _num(step.cruelty) > 0 ? Interrogation._brand(player, world, h, stepId, lawful, sub) : { seen: false };
        // Dead under it?
        if (death > 0 && _roll(world, `death|${salt}`) < death) {
            const text = Interrogation._died(player, world, h, sub);
            st.stats.died++;
            Interrogation._log(st, day, `${h.name} died under ${String(step.label || stepId).toLowerCase()}.`);
            return { success: true, died: true, broke: false, text: [Interrogation.line('died', vars, salt) || `${h.name} dies under the question.`, text, ...parts].filter(Boolean).join(' '), seen: brand.seen };
        }
        // Do they break?
        if (_roll(world, `break|${salt}`) >= chance) {
            sub.strain = _num(sub.strain) + _num(step.strain);
            const hold = Interrogation.line('holds', vars, salt) || `${h.name} tells you nothing.`;
            return { success: true, broke: false, text: [hold, ...parts, brand.line].filter(Boolean).join(' '), seen: brand.seen };
        }
        sub.broke++;
        st.stats.broken++;
        sub.strain = _num(sub.strain) * 0.5;
        const known = Interrogation.knows(player, world, h);
        let told = null;
        let text = '';
        const lieRoll = _roll(world, `lie|${salt}`);
        if (known.length && lieRoll >= _num(step.lie)) {
            const sec = known[0];
            sub.told.push(sec.key);
            told = sec.type;
            text = Interrogation._tell(player, world, h, sec);
            st.stats.told++;
        } else if (lieRoll < (known.length ? _num(step.lie) : _num(step.lieEmpty))) {
            const n = Interrogation._lie(player, world, h, salt);
            if (n) { told = 'name'; text = Interrogation._nameText(h, n); st.stats.lies++; }
        }
        if (!text) text = Interrogation.line('nothing', vars, salt) || `${h.name} has nothing more to tell.`;
        Interrogation._log(st, day, `${h.name} broke under ${String(step.label || stepId).toLowerCase()}.`);
        return { success: true, broke: true, told, text: [text, ...parts, brand.line].filter(Boolean).join(' '), seen: brand.seen };
    },

    /** What a session costs the one who orders it. → { seen, line } */
    _brand(player, world, h, stepId, lawful, sub) {
        const C = Interrogation.config();
        const B = C.brand;
        const st = Interrogation.state(player);
        const step = Interrogation.step(stepId);
        const day = _day(world);
        const sev = _num(SEVERITY[stepId], step.harsh ? 1 : 0.3);
        const kid = h.kingdomId;
        // Faith: the realm's and your own creed's (systems/maimFaith.js, read defensively)
        let realmStance = 'mild';
        let rf = null;
        let ownStance = 'mild';
        try { rf = MaimFaith.realmFaith(world, kid); realmStance = rf ? MaimFaith.stanceOfFaith(rf) : 'mild'; } catch (e) { realmStance = 'mild'; }
        try { ownStance = MaimFaith.playerStance(player); } catch (e) { ownStance = 'mild'; }
        const fMult = (s) => (s === 'sacred' ? _num(B.sacredMult, 1.5) : s === 'harsh' ? _num(B.harshMult, 0.5) : 1);
        // Character
        player.karma = Utils.clamp(_num(player.karma) + Math.round(_num(step.karma) * (lawful ? 0.5 : 1) * fMult(ownStance)), -100, 100);
        try { Traits.recordAggression(player, kid, { cruelty: _num(step.cruelty) * (lawful ? 0.6 : 1) * fMult(ownStance), dread: _num(step.dread) }); } catch (e) { /* no traits */ }
        if (ownStance === 'sacred' && step.harsh && Number.isFinite(player.faith)) player.faith = Math.max(0, Math.round((player.faith - 0.3 * sev) * 100) / 100);
        if (!step.harsh) return { seen: false };
        st.stats.harsh++;
        // Word gets out?
        const leak = _num(C.leak[h.kind], 0.06) * (lawful ? 2 : 1) * sev;
        const seen = _roll(world, `leak|${h.key}|${sub.sessions}|${day}`) < leak;
        const at = Atrocities.state(player);
        if (at) at.butcher = Math.min(_num((Atrocities.config().infamy || {}).max, 300), _num(at.butcher) + _num(step.butcher) * (seen ? 1 : 0.4));
        const first = !sub.tortured;
        sub.tortured = true;
        // The prisoner's own memory, and the House of a rival's child
        if (first && h.kind === 'captive' && h.folk && h.person) {
            try { NpcMemory.remember(world, { folk: h.folk, person: h.person }, { kind: 'tortured', player, kin: false }); } catch (e) { /* no memory */ }
        }
        if (first && h.kind === 'rival' && h.rival) {
            try {
                House.accrueRivalFeud(player, world, h.rival.kingdomId, _num(B.rivalFeud, 25), `${h.name} put to the irons`);
                RivalHouses.remember(h.rival, world, 'tortured', (h.body && h.body.firstName) || null);
                RivalHouses._note(h.rival, world, `${(h.body && h.body.firstName) || 'Their child'} was put to the irons in your keeping.`, 'attacked');
            } catch (e) { /* no House */ }
        }
        if (first && player.house) House._chronicle(player.house, world, `${Interrogation._by(player)} had ${h.name} put to the question${h.town && h.town.name ? ` at ${h.town.name}` : ''}.`, ['cruelty']);
        let line = '';
        if (seen) {
            const place = (h.town && h.town.name) || (h.kind === 'captive' && h.cap && h.cap.town) || null;
            try { Gossip.spreadDeed(player, world, 'torture', { q: h.q, r: h.r, location: place || undefined, kingdom: kid, victim: h.name }); } catch (e) { /* no gossip */ }
            if (kid != null) {
                if (!player.reputation) player.reputation = {};
                const rep = Math.round(_num(B.rep) * sev * fMult(realmStance) * (lawful ? _num(B.lawfulRep, 0.3) : 1));
                if (rep) player.reputation[kid] = _num(player.reputation[kid]) + rep;
                if (!lawful && !PeopleCrimes._aboveLaw(player, kid)) {
                    try { Underworld.addHeat(player, kid, _num(B.heat) * sev * fMult(realmStance), world); } catch (e) { /* no heat */ }
                }
                if (rf && realmStance !== 'harsh') {
                    try { Devotion._addStanding(player, rf, -_num(B.clergy) * sev * fMult(realmStance)); } catch (e) { /* no devotion */ }
                }
                try { NPCLords.rememberRealm(world, kid, h.kind === 'rival' || (h.person && h.person.role === 'noble') ? 'torture' : 'torture_heard', { note: String(h.name).slice(0, 60) }); } catch (e) { /* no lord */ }
            }
            if (h.kind === 'rival' && h.rival) {
                try { NPCLords.rememberRealm(world, h.rival.kingdomId, 'torture', { note: String(h.name).slice(0, 60) }); } catch (e) { /* no lord */ }
                for (const o of Object.values((player.house && player.house.rivals) || {})) {
                    if (o && o !== h.rival) o.feud = Utils.clamp(_num(o.feud) + _num(B.rivalOthers, 4), 0, 100);
                }
            }
            if (h.kind === 'captive' && h.folk && h.person) {
                try { NpcMemory.rememberKin(world, { folk: h.folk, person: h.person }, { kind: 'tortured', player }); } catch (e) { /* no memory */ }
            }
            // Your own court's lords think the less of it
            let court = null;
            try { court = Throne.ruledKingdom(player, world) ? Kingship.court(player) : null; } catch (e) { court = null; }
            for (const v of (court && court.vassals) || []) v.grudge = _num(v.grudge) + _num(B.courtGrudge, 2);
            line = lawful ? 'Word of it gets out; the law allows it, but the realm hears what you do.' : 'Word of it gets out of the cellar: the realm talks, and the crown\'s men take an interest.';
            Interrogation._log(st, day, `Word got out that ${h.name} was put to the question.`);
        }
        return { seen, line, lawful };
    },

    /** They die in your keeping. → the text of what follows. */
    _died(player, world, h, sub) {
        const C = Interrogation.config();
        const day = _day(world);
        const st = Interrogation.state(player);
        sub.dead = day;
        delete st.subjects[h.key];
        if (h.kind === 'captive') {
            if (h.folk && h.person) Townsfolk.slay(h.folk, h.person, day, 'died under the question', world);
            if (h.cap) h.cap.dead = day; // (the body stays in the cellar: PeopleCrimes may find it)
            if (player.house) House._chronicle(player.house, world, `${h.name} of ${(h.cap && h.cap.town) || 'the town'} died under the question in a cellar of yours.`, ['cruelty']);
            return 'The body is still in the cellar.';
        }
        if (h.kind === 'rival' && h.rival) {
            const rival = h.rival;
            const c = h.body;
            const first = (c && c.firstName) || 'the child';
            const kids = (rival.head && rival.head.children) || [];
            const i = kids.indexOf(c);
            if (i >= 0) kids.splice(i, 1);
            try { RivalCaptives._free(player, world, h.cap); } catch (e) { /* gone */ }
            const want = Math.max(20, _num(C.brand.deathFeud, 100) - _num(rival.feud));
            try {
                House.accrueRivalFeud(player, world, rival.kingdomId, want, `${first} died in your keeping`);
                RivalHouses.remember(rival, world, 'diedInYourKeeping', first);
                RivalHouses._note(rival, world, `${first} died in your keeping.`, 'attacked');
            } catch (e) { /* no House */ }
            rival.truceUntil = null;
            // (blood owed: their hired blades come for your children — systems/maiming.js reads maimOwed)
            rival.maimOwed = { act: 'eye', n: 1, day, until: day + 1800, victim: first };
            try {
                Nemesis.wrong(player, world, { kind: 'house', ref: { kingdomId: rival.kingdomId }, name: RivalHouses.headName(rival), line: rival.name, score: 90, age: _num(rival.head && rival.head.age, 40), gender: rival.head && rival.head.gender === 'female' ? 'female' : 'male', deed: { key: 'tortured', label: `${first}, dead in your keeping`, note: rival.name } });
            } catch (e) { /* no nemesis */ }
            if (player.house) House._chronicle(player.house, world, `${h.name} of ${rival.name} died under the question in the keeping of ${Interrogation._by(player)}.`, ['cruelty', 'rival']);
            return `${rival.name} will want blood for ${first}, and every House will hear of it.`;
        }
        if (h.kind === 'rebel' && h.rebel) {
            if (h.folk && h.person) Townsfolk.slay(h.folk, h.person, day, 'died under the question', world);
            try { PeasantRevolts.releasePrisoner(player, world, h.rebel.id, 'died'); } catch (e) { /* gone */ }
            if (player.house) House._chronicle(player.house, world, `${h.name}, who led the rising at ${h.rebel.town || 'a town'}, died under the question.`, ['cruelty']);
            return `${h.rebel.town || 'The town'} will call ${h.gender === 'female' ? 'her' : 'him'} a martyr when it hears.`;
        }
        if (h.kind === 'pow' && h.pow) {
            Interrogation._powGone(player, h.pow);
            const P = Interrogation.config().pow;
            if (!player.reputation) player.reputation = {};
            player.reputation[h.pow.kingdomId] = _num(player.reputation[h.pow.kingdomId]) + _num(P.deathRep, -12);
            try { NPCLords.rememberRealm(world, h.pow.kingdomId, 'torture', { note: h.name }); } catch (e) { /* no lord */ }
            if (player.house) House._chronicle(player.house, world, `${h.name} of ${h.pow.realm}, a prisoner of war, died under the question.`, ['cruelty', 'war']);
            return `${h.pow.realm} will not forget that a ${h.pow.title.toLowerCase()} of theirs died in your keeping; no ransom comes for the dead.`;
        }
        if (h.kind === 'bounty' && h.bounty) {
            h.bounty.status = 'dead';
            try { BountyHunting._removeBounty(player, h.bounty.id); } catch (e) { /* gone */ }
            return 'No magistrate pays for a corpse taken in a cellar.';
        }
        return '';
    },

    // ── What they give up ──────────────────────────────────

    /** A true secret told: its effect on the game. → the text. */
    _tell(player, world, h, sec) {
        const day = _day(world);
        const st = Interrogation.state(player);
        const N = h.name;
        if (sec.type === 'scheme') {
            const s = sec.scheme;
            s.revealed = true;
            try { Schemes._suspect(player, world, s, 'plotting'); } catch (e) { /* no suspect */ }
            Interrogation._log(st, day, `${N} gave up a plot: ${Schemes.describe(s)}.`);
            return `${N} talks. ${Schemes.describe(s)}. The plot is out now: guard against it, or buy them off (Dynasty → Threats).`;
        }
        if (sec.type === 'agent') {
            const a = sec.agent;
            const n = Interrogation._addName(player, world, h, { name: a.name, q: a.q, r: a.r, pid: a.pid, town: a.town, role: a.role, claim: 'agent', rivalId: a.rivalId, rivalName: a.rivalName, truth: { type: 'agent', id: a.id } });
            return Interrogation._nameText(h, n);
        }
        if (sec.type === 'thief') {
            const e = sec.theft;
            const tile = world && typeof world.getTile === 'function' ? world.getTile(e.q, e.r) : null;
            const town = (tile && tile.settlement && tile.settlement.name) || 'the town';
            const n = Interrogation._addName(player, world, h, { name: e.thief.name, q: e.q, r: e.r, pid: e.thief.pid, town, claim: 'thief', truth: { type: 'thief', id: e.id } });
            return Interrogation._nameText(h, n);
        }
        if (sec.type === 'lair') {
            const l = sec.lair;
            OutlawLairs.reveal(player, l.id);
            let men = '';
            try { men = `, some ${OutlawLairs.garrison(l)} men at home`; } catch (e) { men = ''; }
            Interrogation._log(st, day, `${N} told where ${l.name} lies.`);
            return `${N} tells you where ${l.name} lies, ${(l.leader && l.leader.name) || 'its chief'}'s hold${men}, and a hoard of about ${Utils.formatGold(Math.round(_num(l.hoard && l.hoard.gold)))} gold. It is on your charts now (Journal → Outlaw Lairs).`;
        }
        if (sec.type === 'cache') {
            if (!Array.isArray(player.maps)) player.maps = [];
            player.maps.push({
                id: `treasure_q${sec.q}_${sec.r}_${day}`, type: 'treasure', name: 'A Prisoner\'s Map', icon: '💎', quality: 'basic', accuracy: 0.9,
                centerQ: sec.q, centerR: sec.r, radius: 2, createdDay: day, createdBy: N, value: 80, treasureQ: sec.q, treasureR: sec.r,
                tiles: [], deliberateErrors: [], isPropaganda: false, isStolen: false, isAncient: false,
                notes: `Scratched out by ${N} in your dungeon: "dig here".`,
            });
            Interrogation._log(st, day, `${N} told of a buried hoard.`);
            return `${N} scratches a map in the dirt of the floor: something buried, that no one has dug up. It is in your maps now (Cartography → your maps).`;
        }
        if (sec.type === 'accomplice') {
            const p = sec.person;
            let role = '';
            try { role = Townsfolk.roleTitle(p); } catch (e) { role = ''; }
            const n = Interrogation._addName(player, world, h, { name: Townsfolk.name(p), q: h.q, r: h.r, pid: p.id, town: (sec.settlement && sec.settlement.name) || h.rebel.town, role, gender: p.gender, claim: 'rebel', truth: { type: 'accomplice', q: h.q, r: h.r, pid: p.id } });
            return Interrogation._nameText(h, n);
        }
        if (sec.type === 'realm') {
            const w = sec.pow;
            const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(w.kingdomId) : null;
            const per = _num(Interrogation.config().know.realm && Interrogation.config().know.realm.days, 120);
            st.eyes[w.kingdomId] = day + per; // (read by systems/realmIntel.js: its books and its army are open to you)
            let plan = '';
            try {
                const war = RealmWars._state(player).wars[w.kingdomId];
                const host = war && (war.hosts || []).find(x => x && x.target);
                if (host) plan = ` Its host of some ${Math.round(_num(host.strength))} marches on ${host.target.name || 'your lands'}.`;
                else if (war) plan = ' It has no host in the field against you yet.';
            } catch (e) { plan = ''; }
            Interrogation._log(st, day, `${N} told you the strength of ${w.realm}.`);
            if (!k) return `${N} talks of ${w.realm}, but it is no more.`;
            return `${N} talks. ${Names.realm(k.name)} has some ${Utils.formatGold(Math.round(_num(k.treasury)))} gold in its treasury and ${Math.round(_num(k.military))} men under arms.${plan} For a season you can read its books and its army as if you sat at its court.`;
        }
        if (sec.type === 'intel') {
            const rival = sec.rival;
            const C = Interrogation.config().know.intel;
            const house = player.house;
            if (house) {
                if (!_obj(house.informants)) house.informants = {};
                // (read by Schemes.revealChance: this House's plots come to light more often)
                house.informants[rival.kingdomId] = { name: N, town: 'your dungeon', q: player.q, r: player.r, pid: null, untilDay: day + _num(C.intelDays, 120) };
            }
            let doing = '';
            let amb = '';
            try { doing = RivalHouses.doing(world, rival) || ''; } catch (e) { doing = ''; }
            try { const a = rival.ambition && RivalHouses.config().ambitions[rival.ambition.id]; amb = a && a.name ? a.name.toLowerCase() : ''; } catch (e) { amb = ''; }
            const gold = Math.round(_num(rival.gold));
            st.intel[rival.kingdomId] = { day, house: rival.name, gold, ambition: amb, doing: String(doing || ''), feud: Math.round(_num(rival.feud)), until: day + _num(C.intelDays, 120) };
            Interrogation._log(st, day, `${N} told you the secrets of ${rival.name}.`);
            return `${N} talks about home. ${rival.name} has some ${Utils.formatGold(gold)} gold in its coffers${amb ? `; ${RivalHouses.headName(rival)} means to ${amb}` : ''}${doing ? `; ${RivalHouses.headName(rival)} is ${doing}` : ''}. For a season you will hear of their plots before they strike.`;
        }
        return '';
    },

    // ── Names given ────────────────────────────────────────

    _addName(player, world, h, o) {
        const st = Interrogation.state(player);
        const C = Interrogation.config().names;
        const n = { id: st.nextName++, day: _day(world), from: h.name, fromKey: h.key, status: 'open', ...o };
        st.names.unshift(n);
        st.stats.names++;
        // (keep the record short: settled ones go first)
        if (st.names.length > _num(C.keep, 30)) {
            const open = st.names.filter(x => x.status === 'open' || (x.status === 'condemned' && !x.fate));
            const rest = st.names.filter(x => !open.includes(x));
            st.names = open.concat(rest).slice(0, _num(C.keep, 30));
        }
        Interrogation._log(st, _day(world), `${h.name} named ${n.name}${n.town ? ` of ${n.town}` : ''}.`);
        return n;
    },

    _claimText(n) {
        if (n.claim === 'agent') return `in the pay of ${n.rivalName || 'a rival House'}`;
        if (n.claim === 'thief') return 'the one who robbed you';
        if (n.claim === 'outlaw') return 'a friend of the outlaws, who feeds and hides them';
        if (n.claim === 'rebel') return 'one of the ringleaders of the rising';
        return 'a traitor';
    },

    _nameText(h, n) {
        const who = n.vassalId != null ? `${n.name}, ${n.role || 'a lord of your court'}` : `${n.name}${n.role ? `, ${n.role}` : ''}${n.town ? ` of ${n.town}` : ''}`;
        return `${h.name} gives you a name: ${who}, ${Interrogation._claimText(n)}. Is it true? Only acting on it will tell (🔗 The Dungeon → Names given).`;
    },

    /** Under pain, an innocent named: a real townsperson, or a lord of your court. → the name record, or null. */
    _lie(player, world, h, salt) {
        const day = _day(world);
        const rivals = Object.values((player.house && player.house.rivals) || {}).filter(r => r && r.name);
        const rival = rivals.length ? rivals[_hash(`liar|${salt}`) % rivals.length] : null;
        const claim = h.kind === 'bounty' ? 'outlaw' : h.kind === 'rival' ? 'agent' : rival ? (_roll(world, `claim|${salt}`) < 0.6 ? 'agent' : 'thief') : 'outlaw';
        const theRival = h.kind === 'rival' && h.rival ? h.rival : rival;
        // A rival's child names one of your own lords, when you have a court
        if (h.kind === 'rival') {
            let court = null;
            try { court = Throne.ruledKingdom(player, world) ? Kingship.court(player) : null; } catch (e) { court = null; }
            const vs = ((court && court.vassals) || []).filter(v => v && !v.rebel);
            if (vs.length && _roll(world, `lord|${salt}`) < 0.5) {
                const v = vs[_hash(`vassal|${salt}`) % vs.length];
                let name = v.name || 'a lord';
                try { name = Kingship.fullName(v); } catch (e) { /* plain */ }
                return Interrogation._addName(player, world, h, { name, vassalId: v.id, role: v.seat && v.seat.name ? `lord of ${v.seat.name}` : 'a lord of your court', claim: 'agent', rivalId: theRival ? theRival.kingdomId : null, rivalName: theRival ? theRival.name : null, truth: null });
            }
        }
        const s = h.kind === 'captive' ? h.town : h.town || Interrogation._nearestTown(world, player.q, player.r);
        const folk = s && s.folk;
        if (!folk) return null;
        const realAgents = new Set(RivalAgents.list(player).map(a => `${a.q},${a.r}#${a.pid}`));
        const pool = Townsfolk.residents(folk).filter(p => p && p !== h.person && Townsfolk.isHere(p) && !p.rnpc && p.role !== 'child'
            && Townsfolk.age(p, day) >= 17 && !realAgents.has(`${folk.q},${folk.r}#${p.id}`));
        if (!pool.length) return null;
        const p = pool[_hash(`innocent|${salt}`) % pool.length];
        let role = '';
        try { role = Townsfolk.roleTitle(p); } catch (e) { role = ''; }
        return Interrogation._addName(player, world, h, { name: Townsfolk.name(p), q: folk.q, r: folk.r, pid: p.id, town: s.name || 'the town', role, gender: p.gender, claim,
            rivalId: claim === 'agent' && theRival ? theRival.kingdomId : null, rivalName: claim === 'agent' && theRival ? theRival.name : null, truth: null });
    },

    /** The names you have been given and not yet acted on (or condemned, awaiting the truth). */
    names(player) {
        return Interrogation.state(player).names;
    },

    _nameRec(player, id) {
        return Interrogation.state(player).names.find(n => String(n.id) === String(id)) || null;
    },

    /** The townsperson or lord behind a name: { folk, person, settlement } | { vassal } | null. */
    _whoIs(player, world, n) {
        if (n.vassalId != null) {
            let court = null;
            try { court = Kingship.court(player); } catch (e) { court = null; }
            const v = ((court && court.vassals) || []).find(x => x && String(x.id) === String(n.vassalId));
            return v ? { vassal: v } : null;
        }
        const tile = world && typeof world.getTile === 'function' ? world.getTile(n.q, n.r) : null;
        const s = tile && tile.settlement;
        const p = s && s.folk && n.pid != null ? Townsfolk.get(s.folk, n.pid) : null;
        return p ? { folk: s.folk, person: p, settlement: s } : null;
    },

    /** Does the scaffold exist in this build (systems/executions.js)? */
    canCondemn() { return !!_executions(); },

    /** The truth of a name acted on: the agent exposed, the thief named. → text */
    _actTrue(player, world, n) {
        const C = Interrogation.config().names;
        const t = n.truth || {};
        if (t.type === 'agent') {
            const a = RivalAgents._find(player, t.id);
            if (!a) return `${n.name} is gone from ${n.town || 'the town'}; whoever paid them has lost them.`;
            if (!a.known) { try { RivalAgents._reveal(player, world, a, null); } catch (e) { a.known = true; } }
            const r = RivalAgents.expose(player, world, a.id);
            return r && r.success ? `It was true. ${r.text}` : `It was true, but ${n.name} cannot be found.`;
        }
        if (t.type === 'accomplice') {
            const who = Interrogation._whoIs(player, world, n);
            // (the ringleaders taken, the town's anger loses its voice: its grievance falls — read by the risings' boil)
            const rec = world && world.peasantRevolts && world.peasantRevolts.towns ? world.peasantRevolts.towns[`${n.q},${n.r}`] : null;
            if (rec) rec.g = Math.max(0, _num(rec.g) - _num(C.ringleaderCalm, 8));
            if (who && who.person) { if (!who.person.mem) who.person.mem = { timesSpoken: 0, disposition: 50 }; who.person.mem.disposition = 0; who.person.mem.grudge = true; }
            return `It was true: ${n.name} was one of them. With the ringleaders named, ${n.town || 'the town'} grows quiet, for now.`;
        }
        if (t.type === 'thief') {
            const e = NpcTheft.openCases(player).find(x => String(x.id) === String(t.id));
            if (!e) return `It was true, but what ${n.name} took is long gone.`;
            e.named = true;
            let r = null;
            try { r = NpcTheft.report(player, world, e.id); } catch (er) { r = null; }
            const tile = world && typeof world.getTile === 'function' ? world.getTile(n.q, n.r) : null;
            const kid = tile && tile.settlement ? tile.settlement.kingdom : null;
            if (kid != null) { if (!player.reputation) player.reputation = {}; player.reputation[kid] = _num(player.reputation[kid]) + _num(C.trueRep, 2); }
            return `It was true: ${n.name} turns grey when you say it. ${r && r.text ? r.text : 'The watch has the name.'} Face them in town to get it back.`;
        }
        return '';
    },

    /** An innocent wronged on a tortured man's word. → text */
    _actFalse(player, world, n) {
        const mult = 1;
        const C = Interrogation.config().names;
        const st = Interrogation.state(player);
        st.stats.falseActed++;
        const who = Interrogation._whoIs(player, world, n);
        if (who && who.vassal) {
            const v = who.vassal;
            v.grudge = _num(v.grudge) + Math.round(_num(C.falseGrudge, 15) * mult);
            let court = null;
            try { court = Kingship.court(player); } catch (e) { court = null; }
            for (const o of (court && court.vassals) || []) if (o && o !== v) o.grudge = _num(o.grudge) + Math.round(_num(C.courtGrudge, 3) * mult);
            if (player.house) House._chronicle(player.house, world, `${Interrogation._by(player)} accused ${n.name} of treason on a tortured prisoner's word, and it was false.`, ['court']);
            return `${n.name} swears on ${v.gender === 'female' ? 'her' : 'his'} father's sword it is a lie, and the court believes ${v.gender === 'female' ? 'her' : 'him'}. ${n.name} will not forget it, and the other lords watch you now.`;
        }
        if (who && who.person) {
            const kid = who.settlement && who.settlement.kingdom;
            if (kid != null) { if (!player.reputation) player.reputation = {}; player.reputation[kid] = _num(player.reputation[kid]) + Math.round(_num(C.falseRep, -6) * mult); }
            try {
                NpcMemory.remember(world, { folk: who.folk, person: who.person }, { kind: 'named_under_torture', player, kin: true });
                NpcMemory.rememberTown(world, who.settlement, { kind: 'named_under_torture', player, victim: n.name });
            } catch (e) { /* no memory */ }
            try { PeopleCrimes._annal(who.folk, world, `${n.name} was named a traitor by ${Interrogation._by(player)} on a tortured prisoner's word, and it was a lie`); } catch (e) { /* no annal */ }
            const g = _words(who.person.gender);
            return `${n.name} denies it before all ${n.town || 'the town'}, and the town believes ${g.him}: whoever named ${g.him} lied to stop the pain. ${n.town || 'The town'} thinks the less of you.`;
        }
        return `${n.name} is nowhere to be found, and no one will say it was true.`;
    },

    /** Accuse the named openly. → { success, text, reason } */
    accuse(player, world, id) {
        const n = Interrogation._nameRec(player, id);
        if (!n || n.status !== 'open') return { success: false, reason: 'There is no such name to act on.' };
        n.status = 'accused';
        n.actedDay = _day(world);
        const text = n.truth ? Interrogation._actTrue(player, world, n) : Interrogation._actFalse(player, world, n);
        n.outcome = n.truth ? 'true' : 'false';
        return { success: true, text, truth: !!n.truth };
    },

    /**
     * Hand the named to the scaffold (systems/executions.js: they wait on its
     * list for your word, where you choose the day, the method, or mercy). The
     * scaffold is told whether they are guilty; an innocent put to death on a
     * tortured man's word may be found out later (Executions' own surfacing).
     * → { success, text, reason }
     */
    condemn(player, world, id) {
        const n = Interrogation._nameRec(player, id);
        if (!n || n.status !== 'open') return { success: false, reason: 'There is no such name to act on.' };
        const Ex = _executions();
        if (!Ex) return { success: false, reason: 'There is no scaffold to send them to.' };
        const who = Interrogation._whoIs(player, world, n);
        if (!who) return { success: false, reason: `${n.name} cannot be found.` };
        const person = who.vassal ? { kind: 'vassal', id: who.vassal.id } : { kind: 'folk', q: n.q, r: n.r, pid: n.pid };
        const crime = n.claim === 'agent' ? 'spying' : n.claim === 'thief' ? 'theft' : n.claim === 'rebel' ? 'rebellion' : 'banditry';
        const crimeLabel = n.claim === 'agent' ? `serving ${n.rivalName || 'a rival House'}` : n.claim === 'thief' ? 'robbing you' : n.claim === 'rebel' ? 'stirring the rising' : 'harbouring outlaws';
        let entry = null;
        try { entry = Ex.condemn(player, world, person, { crime, crimeLabel, source: 'interrogation', ref: n.id, guilty: !!n.truth }); } catch (e) { entry = null; }
        if (!entry) return { success: false, reason: `${n.name} cannot be brought to the scaffold now.` };
        n.status = 'condemned';
        n.actedDay = _day(world);
        n.outcome = n.truth ? 'true' : 'false';
        // (the truth's effect lands now: the bought man known, the thief named; the scaffold does the rest)
        if (n.truth && n.truth.type === 'agent') {
            const a = RivalAgents._find(player, n.truth.id);
            if (a && !a.known) { try { RivalAgents._reveal(player, world, a, null); } catch (e) { a.known = true; } }
        } else if (n.truth && n.truth.type === 'thief') {
            const e = NpcTheft.openCases(player).find(x => String(x.id) === String(n.truth.id));
            if (e) e.named = true;
        }
        return { success: true, text: `${n.name} is taken on the word of ${n.from}, and waits on the scaffold's list for your word (⚖️ The Scaffold).` };
    },

    /** Let a name lie. */
    drop(player, world, id) {
        const n = Interrogation._nameRec(player, id);
        if (!n || n.status !== 'open') return { success: false, reason: 'There is no such name.' };
        n.status = 'dropped';
        return { success: true, text: `You let ${n.name}'s name lie.` };
    },

    // ── The days ───────────────────────────────────────────

    /** Weekly: what the scaffold made of those you condemned; a rival House questions a child of yours. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!player || !world || !Interrogation.enabled() || player.interregnum) return out;
        if (!player.interrogation && !(player.children || []).some(c => c && c.upbringing && c.upbringing.heldBy) && !(player.espionage && Array.isArray(player.espionage.takenSpies) && player.espionage.takenSpies.length)) return out;
        const st = Interrogation.state(player);
        const day = _day(world);
        if (st.lastWeek != null && day - _num(st.lastWeek) < 7) return out;
        st.lastWeek = day;
        // What the scaffold made of those you condemned on a prisoner's word (systems/executions.js fateOf)
        const Ex = _executions();
        for (const n of st.names) {
            if (n.status !== 'condemned' || n.fate || !Ex || typeof Ex.fateOf !== 'function') continue;
            let f = null;
            try { f = Ex.fateOf(player, 'interrogation', n.id); } catch (e) { f = null; }
            if (f && !f.waiting && f.outcome) {
                n.fate = f.outcome;
                Interrogation._log(st, day, `${n.name}, named by ${n.from}: ${String(f.outcome).replace(/_/g, ' ')}.`);
            }
        }
        // Prune the dead and the freed from the dungeon's record
        const live = new Set(Interrogation.held(player, world).map(h => h.key));
        for (const k of Object.keys(st.subjects)) if (!live.has(k)) delete st.subjects[k];
        Interrogation._powWeek(world, player, day, out);
        Interrogation._spiesWeek(world, player, day, out);
        Interrogation._aiWeek(world, player, day, out);
        return out;
    },

    // ── Prisoners of war ───────────────────────────────────

    _realmCulture(world, kid) {
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
        return (k && k.culture) || 'Imperial';
    },

    /** A captain's, knight's or lord's name from the realm's culture (a hash pick: no shared dice). */
    _powName(world, kid, key) {
        const gd = DataLoader._gamedata || {};
        const ch = gd.characters || {};
        const cul = Interrogation._realmCulture(world, kid);
        const firsts = ((ch.firstNames || {})[cul] || (ch.firstNames || {}).Imperial || {}).male || ['Edmund', 'Roland', 'Cedric'];
        const lasts = (ch.dynastyNames || {})[cul] || (ch.dynastyNames || {}).Imperial || ['Ashby', 'Vane', 'Holt'];
        const f = firsts[_hash(`${key}|first`) % firsts.length];
        const l = Array.isArray(lasts) && lasts.length ? lasts[_hash(`${key}|last`) % lasts.length] : 'Holt';
        return `${f} ${String(l).replace(/^House /, '')}`;
    },

    /**
     * After you beat a realm's host in the field or take one of its towns: a
     * captain, a knight, or (from a great host) a lord may be taken. A hash
     * roll; how = 'in the field' | 'at <town>'. → the prisoner, or null.
     */
    takePrisoners(player, world, o = {}) {
        if (!player || !world || !Interrogation.enabled()) return null;
        const P = Interrogation.config().pow;
        const kid = o.kingdomId;
        const k = kid != null && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
        if (!k || k.isAlive === false) return null;
        const strength = _num(o.strength);
        if (strength < _num(P.minStrength, 20)) return null;
        const st = Interrogation.state(player);
        const day = _day(world);
        const key = `pow|${kid}|${day}|${o.how || ''}|${st.nextPow}`;
        const chance = Math.min(_num(P.maxChance, 0.7), _num(P.chance, 0.35) + strength * _num(P.perStrength, 0.0025) + (o.siege ? _num(P.siegeBonus, 0.15) : 0));
        if (_roll(world, key) >= chance) return null;
        const rank = strength >= _num(P.lordAt, 90) && _roll(world, `${key}|lord`) < _num(P.lordChance, 0.5) ? 'lord'
            : strength >= _num(P.knightAt, 40) ? 'knight' : 'captain';
        const title = { lord: 'Lord', knight: 'Ser', captain: 'Captain' }[rank];
        const name = `${title} ${Interrogation._powName(world, kid, key)}`;
        const w = { id: st.nextPow++, name, title: { lord: 'A lord', knight: 'A knight', captain: 'A captain' }[rank], rank, gender: 'male', kingdomId: kid, realm: Names.realm(k.name), day, how: o.how || 'in the field', offered: null, grumbled: 0 };
        st.pows.push(w);
        Interrogation._log(st, day, `${name} of ${w.realm} taken ${w.how}.`);
        if (player.house) House._chronicle(player.house, world, `${Interrogation._by(player)} took ${name} of ${w.realm} prisoner ${w.how}.`, ['war']);
        return w;
    },

    _powGone(player, w) {
        const st = Interrogation.state(player);
        st.pows = st.pows.filter(x => x !== w);
        delete st.subjects[`pow:${w.id}`];
    },

    _pow(player, id) {
        return Interrogation.state(player).pows.find(x => String(x.id) === String(id)) || null;
    },

    /** What their crown would pay to have them home (out of its treasury). */
    powRansom(player, world, w) {
        const P = Interrogation.config().pow;
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(w.kingdomId) : null;
        if (!k || k.isAlive === false) return 0;
        const base = _num((P.ransom || {})[w.rank], { lord: 500, knight: 200, captain: 80 }[w.rank] || 100);
        const hurt = MaimMarks.any(w) ? _num(P.maimedShare, 0.6) : 1;
        return Math.max(0, Math.floor(Math.min(base * hurt, _num(k.treasury) * _num(P.treasuryShare, 0.3))));
    },

    /** Their crown pays out of its treasury into your purse, and they ride home. */
    ransomPow(player, world, id) {
        const w = Interrogation._pow(player, id);
        if (!w) return { success: false, reason: 'You hold no such prisoner.' };
        const paid = Interrogation.powRansom(player, world, w);
        if (!(paid > 0)) return { success: false, reason: `${w.realm} has nothing in its treasury to pay.` };
        const k = world.getKingdom(w.kingdomId);
        k.treasury = _num(k.treasury) - paid;
        player.gold = Utils.cents(_num(player.gold) + paid);
        try { Ledger.record(player, 'ransoms', paid); } catch (e) { /* no ledger */ }
        Interrogation._powGone(player, w);
        const text = `${w.realm} pays ${Utils.formatGold(paid)} gold out of its treasury, and ${w.name} rides home.`;
        Interrogation._log(Interrogation.state(player), _day(world), text);
        return { success: true, paid, text };
    },

    /** Send them home for nothing: the realm thinks better of you. */
    releasePow(player, world, id) {
        const P = Interrogation.config().pow;
        const w = Interrogation._pow(player, id);
        if (!w) return { success: false, reason: 'You hold no such prisoner.' };
        const sub = Interrogation.state(player).subjects[`pow:${w.id}`];
        const hurt = MaimMarks.any(w) || !!(sub && sub.tortured);
        Interrogation._powGone(player, w);
        if (!player.reputation) player.reputation = {};
        if (!hurt) {
            player.reputation[w.kingdomId] = _num(player.reputation[w.kingdomId]) + _num(P.releaseRep, 6);
            try { Traits.recordDeed(player, 'mercy', 2); } catch (e) { /* no traits */ }
            try { NPCLords.rememberRealm(world, w.kingdomId, 'gift', { note: w.name }); } catch (e) { /* no lord */ }
        }
        const text = hurt ? `You send ${w.name} home to ${w.realm}, what is left of him.` : `You send ${w.name} home to ${w.realm} unransomed. Its court thinks the better of you (+${_num(P.releaseRep, 6)}).`;
        Interrogation._log(Interrogation.state(player), _day(world), text);
        return { success: true, text };
    },

    /** To the scaffold (systems/executions.js, as one of another system's prisoners). */
    condemnPow(player, world, id) {
        const w = Interrogation._pow(player, id);
        if (!w) return { success: false, reason: 'You hold no such prisoner.' };
        const Ex = _executions();
        if (!Ex) return { success: false, reason: 'There is no scaffold to send them to.' };
        let entry = null;
        try {
            entry = Ex.condemn(player, world, { kind: 'other', name: w.name, gender: w.gender, rank: w.rank === 'captain' ? 'commoner' : 'noble', q: player.q, r: player.r, kingdomId: w.kingdomId, house: w.realm }, { crime: 'enmity', crimeLabel: `making war on you for ${w.realm}`, source: 'pow', ref: w.id, guilty: null });
        } catch (e) { entry = null; }
        if (!entry) return { success: false, reason: `${w.name} cannot be brought to the scaffold now.` };
        w.condemned = _day(world);
        return { success: true, text: `${w.name} waits on the scaffold's list for your word (⚖️ The Scaffold). ${w.realm} will hear of it.` };
    },

    /** Weekly: the realm wants its men back (a ransom offered, regard lost while you keep them); the scaffold's word. */
    _powWeek(world, player, day, out) {
        const P = Interrogation.config().pow;
        const st = Interrogation.state(player);
        for (const w of st.pows.slice()) {
            const k = typeof world.getKingdom === 'function' ? world.getKingdom(w.kingdomId) : null;
            if (!k || k.isAlive === false) {
                Interrogation._powGone(player, w);
                Interrogation._log(st, day, `${w.name} goes free: ${w.realm} is no more.`);
                continue;
            }
            if (w.condemned) {
                let f = null;
                try { f = Executions.fateOf(player, 'pow', w.id); } catch (e) { f = null; }
                if (f && !f.waiting) Interrogation._powGone(player, w);
                continue;
            }
            const held = day - _num(w.day);
            if (held >= _num(P.offerAfter, 21) && !w.offered) {
                const amount = Interrogation.powRansom(player, world, w);
                w.offered = day;
                if (amount > 0) out.notices.push({ icon: '💰', title: `A Ransom for ${w.name}`, text: `${w.realm} will pay ${Utils.formatGold(amount)} gold out of its treasury to have ${w.name} home (🔗 The Dungeon).`, type: 'info' });
            }
            // (every month you keep him, his realm thinks a little worse of you)
            if (held > 0 && held % 28 < 7 && _num(w.grumbled) < _num(P.grumbleCap, 12)) {
                if (!player.reputation) player.reputation = {};
                player.reputation[w.kingdomId] = _num(player.reputation[w.kingdomId]) - _num(P.monthlyRep, 2);
                w.grumbled = _num(w.grumbled) + _num(P.monthlyRep, 2);
            }
        }
    },

    // ── Your spies in their cells ──────────────────────────

    /** A spy of yours taken abroad (systems/espionage/missions.js takenSpies) may be put to the question by that crown. */
    _spiesWeek(world, player, day, out) {
        const list = player.espionage && Array.isArray(player.espionage.takenSpies) ? player.espionage.takenSpies : null;
        if (!list || !list.length) return;
        const S = Interrogation.config().spies;
        const st = Interrogation.state(player);
        for (const t of list.slice()) {
            if (!t || day - _num(t.day) < _num(S.afterDays, 3)) continue;
            list.splice(list.indexOf(t), 1);
            const k = t.kingdomId != null && typeof world.getKingdom === 'function' ? world.getKingdom(t.kingdomId) : null;
            if (!k || k.isAlive === false) continue;
            if (_roll(world, `spy|${t.id}|${t.day}`) >= _num(S.chance, 0.4)) continue;
            const realm = Names.realm(k.name);
            // What they give up: your other missions against that crown, and the place of another of your spies there
            const esp = player.espionage;
            const blown = (esp.activeMissions || []).filter(m => m && m.targetKingdom === t.kingdomId);
            for (const m of blown) {
                esp.activeMissions.splice(esp.activeMissions.indexOf(m), 1);
                const sp = (esp.spies || []).find(x => x.id === m.spyId);
                if (sp) { sp.status = 'idle'; sp.currentMission = null; }
            }
            let taken = null;
            if (_roll(world, `spy2|${t.id}|${t.day}`) < _num(S.secondChance, 0.5)) {
                taken = (esp.spies || []).find(sp => {
                    const loc = sp && sp.location;
                    const tile = loc && world.getTile ? world.getTile(loc.q, loc.r) : null;
                    return sp.status !== 'on_mission' && tile && tile.settlement && tile.settlement.kingdom === t.kingdomId;
                }) || null;
                if (taken) esp.spies = esp.spies.filter(x => x !== taken);
            }
            if (!player.reputation) player.reputation = {};
            player.reputation[t.kingdomId] = _num(player.reputation[t.kingdomId]) + _num(S.rep, -8);
            try { NPCLords.rememberRealm(world, t.kingdomId, 'spy_confessed', { note: t.name }); } catch (e) { /* no lord */ }
            try { House.accrueRivalFeud(player, world, t.kingdomId, _num(S.feud, 8), `${t.name} confessed`); } catch (e) { /* no House */ }
            const text = `${realm} put ${t.name}, your spy, to the question, and ${t.name} talked.${blown.length ? ` Your ${blown.length === 1 ? 'mission' : `${blown.length} missions`} against ${realm} ${blown.length === 1 ? 'is' : 'are'} blown; your agents come home.` : ''}${taken ? ` ${taken.name}, hidden in ${realm}, was taken too.` : ''} The crown knows your hand in it now (${_num(S.rep, -8)} regard).`;
            st.spiesDone.unshift({ day, name: t.name, realm });
            if (st.spiesDone.length > 10) st.spiesDone.length = 10;
            Interrogation._log(st, day, `${realm} tortured ${t.name}, your spy.`);
            out.notices.push({ icon: '🕵️', title: `${t.name} Talked`, text, type: 'error' });
        }
    },

    /** A rival House holding a child of yours, with a hot feud, may put the child to the question. */
    _aiWeek(world, player, day, out) {
        const A = Interrogation.config().ai;
        if (A.enabled === false || !player.house) return;
        const st = Interrogation.state(player);
        for (const child of player.children || []) {
            const held = child && child.isAlive !== false && child.upbringing && child.upbringing.heldBy;
            if (!held || !held.rival) continue;
            const rival = player.house.rivals && player.house.rivals[held.kingdomId];
            if (!rival || _num(rival.feud) < _num(A.feud, 70)) continue;
            const last = st.aiDays[child.id];
            if (last != null && day - _num(last) < _num(A.everyDays, 240)) continue;
            if (_roll(world, `ai|${child.id}|${day}`) >= _num(A.weekly, 0.02)) continue;
            st.aiDays[child.id] = day;
            const first = child.firstName || child.name || 'Your child';
            const g = _words(child.gender);
            // The body
            let marked = '';
            if (_roll(world, `aiMark|${child.id}|${day}`) < _num(A.markChance, 0.25)) {
                try {
                    if (!MaimMarks.whyNot(child, 'brand')) { MaimMarks.mark(child, 'brand', { day, by: rival.name, why: 'the question' }); marked = ` ${_cap(g.he)} will carry the brand of it on ${g.his} face.`; }
                } catch (e) { marked = ''; }
            }
            child.health = Math.max(1, _num(child.health, _num(child.maxHealth, 100)) - _num(A.hp, 30));
            // What they learned: a plot against you, from what a frightened child told them
            let plot = null;
            try {
                const types = Schemes.eligibleTypes(player, world, _num(rival.feud));
                if (types.length) {
                    const type = types[_hash(`aiPlot|${child.id}|${day}`) % types.length];
                    plot = Utils.withRng(Utils.seededRandom((_hash(`${_seed(world)}|aiPlot|${day}`) % 233280) + 1), () => Schemes.hatch(player, world, rival, type));
                }
            } catch (e) { plot = null; }
            const text = `${rival.name} has put ${first}, their hostage, to the question.${marked} What ${g.he} told them, they will use against you${plot ? ': a plot is laid' : ''}. Pay their price, or go and get ${g.him}.`;
            House._chronicle(player.house, world, `${first} was put to the question by ${rival.name}, who held ${g.him}.`, ['heirs', 'feud']);
            Interrogation._log(st, day, `${rival.name} put ${first} to the question.`);
            out.notices.push({ icon: '🔗', title: `${first} Tortured`, text, type: 'error' });
            try { Interrupts.raise(world, { reason: `${first} is tortured by ${rival.name}`, icon: '🔗', source: 'interrogation' }); } catch (e) { /* no interrupts */ }
        }
    },
};
