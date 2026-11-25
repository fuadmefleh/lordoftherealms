// ============================================
// EXECUTIONS — the scaffold as theatre: the condemned, the crowd, the last words
// ============================================
// A death sentence used to be a line of text. Here it is a day in a town.
//
//   THE CONDEMNED wait on a list for your word (player.executions.condemned):
//            Executions.condemn(player, world, person, { crime, source, guilty })
//            puts them there — a trial's 'scaffold' verdict (player/trials.js),
//            the leader of a crushed revolt (systems/kingship.js), and anyone
//            in your power you bring to the scaffold (targets: a captive in
//            your cellar, an outlaw taken for a bounty, a lord of your court,
//            a rival House's child you hold), or any other system's prisoner
//            (person.kind 'other'; the outcome is read back with fateOf).
//            Those with kin, a House or a band behind them may be broken out
//            while they wait.
//   THE DAY  you choose the PLACE (a seat you rule, or the town of the crime),
//            the METHOD — the axe for the highborn, the rope, the stake for
//            heresy where the realm's faith allows it (data/maiming.json
//            faiths: harsh or mild), drawing and quartering for treason — or a
//            MERCY: pardon, exile, the cloister, the knife instead
//            (systems/maiming.js). PROCLAIMED it happens proclaimDays on, before
//            a full crowd; else here and now, before whoever is about.
//   THE CROWD its size from the town, its mood from the crime, the condemned's
//            popularity (kin in town, rank, trade), the town's happiness, your
//            name in the realm, whether they sense innocence, the method's
//            horror and a martyr's shrine already in town. The last words
//            (LlmProse with a template fallback). DISRUPTION on hash rolls: a
//            rescue from the crowd, a riot, the rope breaking (a sign of God —
//            the condemned goes back on your list for you to hang again or
//            spare).
//   THE COST, every part read elsewhere: Petitions effects at the place
//            (happiness, prestige, stability, court severity/mercy — read by the
//            towns, the realm and the lords' court opinion), fear (Traits
//            cruelty/dread; the butcher's name, systems/atrocities.js, read at
//            siege terms; vassals cowed, read by Kingship factions; a public
//            death cows the town's thieves: deterrence(), read by
//            systems/npcTheft.js), the lords' memory (data/lordMemory.json),
//            the kin's and the town's memory (systems/npcMemory.js; the blood
//            the avengers count, a NEMESIS for the innocent and the loved), a
//            rival House's feud, the talk of the towns (systems/gossip.js), the
//            House chronicle. An innocent or a loved victim may become a
//            MARTYR: a shrine in town, pilgrims (their coin from the realm's
//            capital into the town's purse), unrest against the killer's rule
//            for years, a sullen crowd at the next scaffold there. Endow the
//            shrine to make peace, or pull it down. An innocent put to death
//            on another's word (a false confession, a lie) is found out later.
//   THE WORLD the realms' capitals hang (behead, burn) their own condemned now
//            and then (weekly hash rolls): sparse world notices for the
//            highborn and the burnings; anyone in town that day can join the
//            crowd (attend: watch, or cry out for mercy).
//
// State: player.executions (the list, the record; saved) and world.executions
// (martyrs' cults, the realms' scaffolds; saved). Explicit params, no globals;
// every roll a hash of the world seed (no shared stream). Content and tuning:
// data/executions.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { Townsfolk } from './townsfolk.js';
import { NpcMemory } from './npcMemory.js';
import { PeopleCrimes } from './peopleCrimes.js';
import { Petitions } from './petitions.js';
import { Traits } from './traits.js';
import { Atrocities } from './atrocities.js';
import { Gossip } from './gossip.js';
import { House } from './house.js';
import { LlmProse } from './llmProse.js';
import { MaimFaith } from './maimFaith.js';
import { Devotion } from './devotion.js';
import { Underworld } from './underworld.js';
import { Ledger } from './ledger.js';
// (a term at the mines or the oar instead of death: systems/penalLabour.js)
import { PenalLabour } from './penalLabour.js';
// (run time only: those in your power, and what becomes of them)
import { Maiming } from './maiming.js';
import { Kingship } from './kingship.js';
import { Throne } from './throne.js';
import { RivalCaptives } from './rivalCaptives.js';
import { RivalHouses } from './rivalHouses.js';
import { BountyHunting } from './bountyHunting.js';
import { Raising } from './raising.js';
import { Laws } from './laws.js';
// (a crown's hanging the kin deem unjust: their blood feud with the royal house, systems/bloodFeuds.js; run time only)
import { BloodFeuds } from './bloodFeuds.js';
// (flayed alive: the skin, the stewards' fear, the crown's corruption cut — systems/flaying.js; run time only)
import { Flaying } from './flaying.js';
import { Stewards } from './stewards.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const _key = (q, r) => `${q},${r}`;
const _he = (g) => (g === 'female' ? 'she' : 'he');
const _him = (g) => (g === 'female' ? 'her' : 'him');
const _his = (g) => (g === 'female' ? 'her' : 'his');

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** 0..1, fixed for a key in this world (no shared stream). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|executions|${key}`) % 100000) / 100000;
}

function _pickW(pool, u) {
    const e = Object.entries(pool || {}).filter(([, w]) => _num(w) > 0);
    const total = e.reduce((s, [, w]) => s + _num(w), 0);
    let x = u * total;
    for (const [id, w] of e) { x -= _num(w); if (x < 0) return id; }
    return e.length ? e[e.length - 1][0] : null;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && q != null ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _kingdom(world, id) {
    return id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null;
}

let _cfg = null;
let _cfgSrc;

export const Executions = {

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.executions : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...d,
                enabled: d.enabled !== false,
                crowd: { share: {}, min: 12, max: 6000, unproclaimed: 0.35, lordPresent: 1.25, popularity: 0.9, happiness: 0.4, reputation: 0.15, innocentSense: 18, highborn: 6, ...(_obj(d.crowd) || {}) },
                moods: Array.isArray(d.moods) && d.moods.length ? d.moods : [{ id: 'quiet', at: -1000, label: 'quiet', icon: '🤐' }],
                ranks: _obj(d.ranks) || { commoner: { label: 'commoner' } },
                crimes: _obj(d.crimes) || { default: { label: 'their crimes', crowd: 0, severity: 2 } },
                methods: _obj(d.methods) || {},
                mercies: _obj(d.mercies) || {},
                effects: _obj(d.effects) || {},
                disruption: _obj(d.disruption) || {},
                lordDeeds: _obj(d.lordDeeds) || {},
                martyr: _obj(d.martyr) || {},
                ai: _obj(d.ai) || {},
                attend: _obj(d.attend) || {},
                deterrence: _obj(d.deterrence) || {},
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return Executions.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = Executions.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── State ─────────────────────────────────────────────────

    _blank() { return { v: 1, nextId: 1, condemned: [], history: [], stats: { executed: 0, spared: 0, rescued: 0, innocents: 0, byMethod: {}, fear: 0, love: 0 } }; },

    state(player) {
        if (!player) return null;
        if (!_obj(player.executions)) player.executions = Executions._blank();
        const st = player.executions;
        const b = Executions._blank();
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!Array.isArray(st.condemned)) st.condemned = [];
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        if (!_obj(st.stats.byMethod)) st.stats.byMethod = {};
        return st;
    },

    serialize(player) {
        return player && _obj(player.executions) ? JSON.parse(JSON.stringify(player.executions)) : null;
    },

    loadState(player) {
        if (player && player.executions) Executions.state(player);
    },

    worldState(world) {
        if (!world) return null;
        if (!_obj(world.executions)) world.executions = { nextId: 1, cults: [], public: [], log: [] };
        const w = world.executions;
        if (!(w.nextId > 0)) w.nextId = 1;
        for (const k of ['cults', 'public', 'log']) if (!Array.isArray(w[k])) w[k] = [];
        return w;
    },

    serializeWorld(world) {
        return world && _obj(world.executions) ? JSON.parse(JSON.stringify(world.executions)) : null;
    },

    restoreWorld(saved, world) {
        if (!world) return;
        world.executions = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : undefined;
        if (world.executions) Executions.worldState(world);
    },

    // ── Lookups ───────────────────────────────────────────────

    crimeDef(id) {
        const C = Executions.config().crimes;
        return C[id] || C.default || { label: 'their crimes', crowd: 0, severity: 2 };
    },

    rankDef(id) {
        const R = Executions.config().ranks;
        return R[id] || R.commoner || { label: 'commoner' };
    },

    isHighborn(rank) { return !!Executions.rankDef(rank).highborn; },

    list(player) { return player && player.executions ? Executions.state(player).condemned : []; },

    get(player, id) { return Executions.list(player).find(e => String(e.id) === String(id)) || null; },

    /** What became of one condemned from another system: the record, or null while they wait. */
    fateOf(player, source, ref) {
        if (!player || !player.executions) return null;
        const st = Executions.state(player);
        const waiting = st.condemned.find(e => e.source === source && String(e.refId) === String(ref));
        if (waiting) return { waiting: true, entry: waiting };
        return st.history.find(h => h.source === source && String(h.refId) === String(ref)) || null;
    },

    /** Who has the right of the sword: a seat you rule (a holding, an office's capital, a realm). */
    seats(player, world) {
        const out = [];
        const seen = new Set();
        let ctxs = [];
        try { ctxs = Petitions.holdingContexts(player, world); } catch (e) { ctxs = []; }
        for (const c of ctxs) {
            if (!c.settlement || c.q == null) continue;
            const k = _key(c.q, c.r);
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ key: k, q: c.q, r: c.r, name: c.settlement.name || 'your seat', settlement: c.settlement, kingdomId: c.kingdomId != null ? c.kingdomId : c.settlement.kingdom, kind: c.kind });
        }
        return out;
    },

    canJudge(player, world) { return Executions.seats(player, world).length > 0; },

    // ── Condemned ─────────────────────────────────────────────

    /**
     * Put someone on the list awaiting your word. person: a townsperson ref
     * { kind:'folk', q, r, pid } (or a roster person with opts.q/r), a captive
     * { kind:'captive', id }, an outlaw { kind:'bounty', id }, a lord of your
     * court { kind:'vassal', id }, a rival House's child { kind:'rival', id:
     * captiveId }, or anyone else { kind:'other', name, gender, rank, q, r,
     * kingdomId, popularity, house }. opts { crime (data crimes id), crimeLabel,
     * source ('trial'|'revolt'|'interrogation'|…), ref (the source's id, read
     * back by fateOf), guilty (true/false; null when no one knows), quiet }.
     * → the entry, or null (no such person, already waiting).
     */
    condemn(player, world, person = {}, opts = {}) {
        if (!player || !world || !Executions.enabled() || !person) return null;
        const st = Executions.state(player);
        const day = _day(world);
        const kind = person.kind || (person.pid != null || (person.first && person.id != null) ? 'folk' : 'other');
        const ref = { id: person.id != null ? person.id : person.pid };
        let name = person.name || null;
        let gender = person.gender === 'female' ? 'female' : (person.gender === 'male' ? 'male' : null);
        let rank = person.rank || null;
        let town = null;
        let kingdomId = person.kingdomId != null ? person.kingdomId : null;
        let popularity = Number.isFinite(person.popularity) ? person.popularity : null;
        let backing = { kin: 0, house: !!person.house, band: !!person.band };
        let houseName = typeof person.house === 'string' ? person.house : null;
        const q = person.q != null ? person.q : opts.q;
        const r = person.r != null ? person.r : opts.r;
        if (kind === 'folk') {
            const pid = person.pid != null ? person.pid : person.id;
            const f = PeopleCrimes.personAt(world, q, r, pid);
            if (!f.p || f.p.died != null) return null;
            ref.q = q; ref.r = r; ref.pid = pid; ref.id = `${q},${r}#${pid}`;
            name = name || Townsfolk.name(f.p);
            gender = gender || (f.p.gender === 'female' ? 'female' : 'male');
            rank = rank || (f.p.role === 'noble' ? 'noble' : f.p.role === 'priest' ? 'cleric' : 'commoner');
            town = f.s ? { q, r, name: f.s.name || 'the town' } : null;
            if (kingdomId == null && f.s) kingdomId = f.s.kingdom;
            backing.kin = PeopleCrimes.kinOf(f.folk, f.p).length;
            if (popularity == null) popularity = Executions._folkPopularity(f.folk, f.p, rank);
            // (held for the day: no wandering off from the cells)
            f.p.jailedUntil = day + 100000;
        } else if (kind === 'captive') {
            const c = PeopleCrimes.captives(player).find(x => String(x.id) === String(person.id));
            if (!c) return null;
            const f = PeopleCrimes.personAt(world, c.q, c.r, c.pid);
            if (!f.p || f.p.died != null) return null;
            name = name || c.name;
            gender = gender || (f.p.gender === 'female' ? 'female' : 'male');
            rank = rank || (f.p.role === 'noble' ? 'noble' : 'commoner');
            town = { q: c.q, r: c.r, name: c.town || 'the town' };
            if (kingdomId == null) kingdomId = c.kingdom;
            backing.kin = PeopleCrimes.kinOf(f.folk, f.p).length;
            if (popularity == null) popularity = Executions._folkPopularity(f.folk, f.p, rank);
        } else if (kind === 'bounty') {
            const b = (player.activeBounties || []).find(x => String(x.id) === String(person.id));
            if (!b) return null;
            name = name || b.targetName || 'the outlaw';
            gender = gender || (b.gender === 'female' ? 'female' : 'male');
            rank = rank || 'outlaw';
            if (b.fromQ != null) { const s = _settlementAt(world, b.fromQ, b.fromR); if (s) town = { q: b.fromQ, r: b.fromR, name: s.name }; }
            if (kingdomId == null) kingdomId = b.kingdomId != null ? b.kingdomId : (town ? (_settlementAt(world, town.q, town.r) || {}).kingdom : null);
            backing.band = true;
            if (!opts.crime) opts = { ...opts, crime: 'banditry', crimeLabel: b.crime || null };
            if (opts.guilty === undefined) opts = { ...opts, guilty: true };
        } else if (kind === 'vassal') {
            const v = Kingship.vassal(player, person.id);
            if (!v) return null;
            name = name || Kingship.fullName(v);
            gender = gender || (v.gender === 'female' ? 'female' : 'male');
            rank = rank || 'vassal';
            if (v.seat) town = { q: v.seat.q, r: v.seat.r, name: v.seat.name };
            if (kingdomId == null) { const rk = Throne.ruledKingdom(player, world); kingdomId = rk ? rk.id : null; }
            backing.house = true;
            houseName = houseName || `the House of ${v.dynasty}`;
        } else if (kind === 'rival') {
            // A captive taken on the road ('c:<id>', or a bare captive id) or a ward at your court ('w:<id>')
            ref.id = Executions._rivalId(person.id);
            const t = RivalCaptives.target(player, world, ref.id);
            if (!t || !t.body) return null;
            name = name || t.name;
            gender = gender || (t.body.gender === 'female' ? 'female' : 'male');
            rank = rank || 'rival';
            backing.house = true;
            houseName = t.rival ? t.rival.name : houseName;
            ref.rivalId = t.rival ? t.rival.kingdomId : null;
            ref.ward = !!t.ward;
        }
        if (!name) name = 'the condemned';
        if (!gender) gender = 'male';
        if (!rank) rank = 'commoner';
        // Not twice on the list
        if (st.condemned.some(e => e.kind === kind && String(e.ref.id) === String(ref.id))) return null;
        if (!town && q != null) { const s = _settlementAt(world, q, r); if (s) town = { q, r, name: s.name }; }
        const crime = opts.crime && Executions.config().crimes[opts.crime] ? opts.crime : 'default';
        if (popularity == null) popularity = _num(Executions.rankDef(rank).popularity);
        const entry = {
            id: st.nextId++, kind, ref, name, gender, rank, crime, crimeLabel: opts.crimeLabel || Executions.crimeDef(crime).label,
            source: opts.source || 'court', refId: opts.ref != null ? opts.ref : null,
            guilty: opts.guilty === true ? true : opts.guilty === false ? false : null,
            town, kingdomId, popularity: Math.round(popularity), backing, house: houseName, day, proclaimed: null, ropeBroke: false,
        };
        st.condemned.push(entry);
        if (!opts.quiet) Interrupts.raise(world, { reason: `${name} awaits your word on the scaffold`, icon: '⚖️', source: 'executions' });
        return entry;
    },

    _folkPopularity(folk, p, rank) {
        let pop = _num(Executions.rankDef(rank).popularity) + PeopleCrimes.kinOf(folk, p).length * 6;
        const job = p.job && p.job.id;
        if (['priest', 'healer', 'midwife', 'physician', 'herbalist'].includes(job || p.role)) pop += 14;
        if (['miller', 'baker', 'innkeeper', 'brewer', 'smith', 'blacksmith'].includes(job || p.role)) pop += 6;
        if (job === 'beggar') pop -= 4;
        if (p.pcMark === 'branded') pop -= 10;
        if (Array.isArray(p.nm) && p.nm.some(m => m && (m.k === 'wrongly_condemned' || m.k === 'false_accused'))) pop += 8;
        return Utils.clamp(pop, -30, 70);
    },

    /** Is the person still to be had (alive, still in your hands)? → { ok, folk, p, s, v, cap, rival, body, b } */
    _resolve(player, world, e) {
        if (e.kind === 'folk') {
            const f = PeopleCrimes.personAt(world, e.ref.q, e.ref.r, e.ref.pid);
            return { ok: !!(f.p && f.p.died == null && !(f.p.away && f.p.away.to !== 'the cells')), ...f };
        }
        if (e.kind === 'captive') {
            const c = PeopleCrimes.captives(player).find(x => String(x.id) === String(e.ref.id));
            if (!c) return { ok: false };
            const f = PeopleCrimes.personAt(world, c.q, c.r, c.pid);
            return { ok: !!(f.p && f.p.died == null), c, ...f };
        }
        if (e.kind === 'bounty') {
            const b = (player.activeBounties || []).find(x => String(x.id) === String(e.ref.id));
            return { ok: !!(b && b.status === 'captured_pending_decision'), b };
        }
        if (e.kind === 'vassal') {
            const v = Kingship.vassal(player, e.ref.id);
            return { ok: !!v, v };
        }
        if (e.kind === 'rival') {
            const t = RivalCaptives.target(player, world, Executions._rivalId(e.ref.id));
            return { ok: !!(t && t.body), cap: t ? t.cap || null : null, ward: t ? t.ward || null : null, rival: t ? t.rival : null, body: t ? t.body : null };
        }
        return { ok: e.gone !== true };
    },

    // ── Those in your power (to bring to the scaffold) ─────────

    /** [{ kind, id, name, desc, icon, crime, guilty }] not yet on the list. */
    targets(player, world) {
        const out = [];
        if (!player || !Executions.enabled()) return out;
        const on = new Set(Executions.list(player).map(e => `${e.kind}|${e.ref.id}`));
        for (const c of PeopleCrimes.captives(player)) {
            if (c.dead || on.has(`captive|${c.id}`)) continue;
            out.push({ kind: 'captive', id: c.id, name: c.name, icon: '⛓️', desc: `In your cellar at ${c.town || 'a town'}: no court has tried them`, crime: 'your_word', guilty: false });
        }
        for (const b of player.activeBounties || []) {
            if (!b || b.type !== 'criminal_hunt' || b.status !== 'captured_pending_decision' || on.has(`bounty|${b.id}`)) continue;
            out.push({ kind: 'bounty', id: b.id, name: b.targetName || 'the outlaw', icon: '🗡️', desc: `Taken for ${b.crime || 'robbery on the roads'}, awaiting your word`, crime: 'banditry', guilty: true });
        }
        let court = null;
        try { court = Throne.ruledKingdom(player, world) ? Kingship.court(player) : null; } catch (e) { court = null; }
        for (const v of (court && court.vassals) || []) {
            if (on.has(`vassal|${v.id}`)) continue;
            const guilty = !!(v.rebel || v.factionId || _num(v.cowedUntil) > _day(world) || _num(v.powerMult, 1) < 1);
            out.push({ kind: 'vassal', id: v.id, name: Kingship.fullName(v), icon: '🏰', desc: `${v.seat ? `Lord of ${v.seat.name}` : 'A landless lord'}${v.rebel ? ' · in revolt' : guilty ? ' · broken for treason' : ' · loyal, so far as anyone knows'}`, crime: v.rebel ? 'rebellion' : 'treason', guilty });
        }
        // A rival House's child taken on the road, or a ward raised at your court (guest-right: systems/rivalCaptives.js targets)
        let rts = [];
        try { rts = RivalCaptives.targets(player, world); } catch (err) { rts = []; }
        for (const t of rts) {
            if (on.has(`rival|${t.id}`)) continue;
            out.push({ kind: 'rival', id: t.id, name: t.name, icon: t.ward ? '🏰' : '⛓️', desc: t.ward ? `${t.desc}: guest-right would be broken` : t.desc, crime: 'enmity', guilty: false, ward: !!t.ward });
        }
        return out;
    },

    /** Put one of those in your power on the list. → { success, text|reason, entry } */
    bring(player, world, kind, id) {
        const t = Executions.targets(player, world).find(x => x.kind === kind && String(x.id) === String(id));
        if (!t) return { success: false, reason: 'No one by that name is in your power.' };
        const entry = Executions.condemn(player, world, { kind, id }, { crime: t.crime, source: 'power', guilty: t.guilty, quiet: true });
        if (!entry) return { success: false, reason: 'They cannot be brought to the scaffold.' };
        return { success: true, entry, text: `${entry.name} is taken to the cells to await the scaffold.` };
    },

    // ── The choices ───────────────────────────────────────────

    /** The places it may be done: your seats, and the town of the crime when it is one of them. */
    places(player, world, e) {
        const seats = Executions.seats(player, world);
        const out = seats.map(s => ({ key: s.key, q: s.q, r: s.r, name: s.name, kingdomId: s.kingdomId, crimeTown: !!(e.town && _key(e.town.q, e.town.r) === s.key), here: player.q === s.q && player.r === s.r, ok: true }));
        if (e.town && !out.some(p => p.crimeTown)) {
            const s = _settlementAt(world, e.town.q, e.town.r);
            out.push({ key: _key(e.town.q, e.town.r), q: e.town.q, r: e.town.r, name: e.town.name, kingdomId: s ? s.kingdom : null, crimeTown: true, here: player.q === e.town.q && player.r === e.town.r, ok: false, why: 'Not a seat of yours: you have no right of the sword there.' });
        }
        return out.sort((a, b) => (b.crimeTown - a.crimeTown) || (b.here - a.here));
    },

    _place(player, world, e, key) {
        const ps = Executions.places(player, world, e).filter(p => p.ok);
        return ps.find(p => p.key === key) || ps[0] || null;
    },

    /** The faith's stance in a realm (sacred / mild / harsh). */
    _faithStance(world, kid) {
        const f = MaimFaith.realmFaith(world, kid);
        return f ? MaimFaith.stanceOfFaith(f) : 'mild';
    },

    /** The methods: [{ id, label, icon, desc, ok, why }]. */
    methods(player, world, e, place = null) {
        const C = Executions.config();
        const crime = Executions.crimeDef(e.crime);
        const high = Executions.isHighborn(e.rank);
        const kid = place ? place.kingdomId : e.kingdomId;
        const stance = Executions._faithStance(world, kid);
        return Object.entries(C.methods).map(([id, m]) => {
            let why = '';
            if (m.highbornOnly && !high) why = 'The axe is for the highborn.';
            else if (Array.isArray(m.crimes) && !m.crimes.some(f => crime[f])) why = m.crimesWhy ? `Not for ${e.crimeLabel}. ${m.crimesWhy}` : `Not for ${e.crimeLabel}: ${m.crimes.includes('heresy') ? 'only heresy' : 'only treason'}.`;
            else if (m.faith && !m.faith[stance]) why = `The faith of this realm forbids it (it holds the body ${stance === 'sacred' ? 'sacred' : 'its own'}).`;
            return { id, label: m.label, icon: m.icon, desc: m.desc, ok: !why, why, cruel: !!m.cruel };
        });
    },

    mercies(player, world, e) {
        const C = Executions.config();
        return Object.entries(C.mercies).map(([id, m]) => {
            let why = '';
            if (id === 'maim' && !(Maiming.enabled() && ['folk', 'captive', 'bounty', 'vassal', 'rival'].includes(e.kind))) why = 'Not to be had here.';
            if (id === 'exile' && e.kind === 'other') why = 'Nowhere to send them from here.';
            // (hard labour instead of death, where the realm's law sends convicts: systems/penalLabour.js)
            if (id === 'mines' || id === 'galleys') why = e.kind !== 'folk' ? 'Not to be had here.' : (PenalLabour.allowed(world, e.kingdomId, id).ok ? (PenalLabour.siteFor(player, world, id, e.kingdomId) ? '' : 'Nowhere to send them.') : PenalLabour.allowed(world, e.kingdomId, id).why);
            return { id, label: m.label, icon: m.icon, desc: m.desc, ok: !why, why };
        });
    },

    // ── The crowd ─────────────────────────────────────────────

    _moodOf(score) {
        const M = Executions.config().moods.slice().sort((a, b) => _num(b.at) - _num(a.at));
        return M.find(m => score >= _num(m.at)) || M[M.length - 1];
    },

    /** An active martyr's shrine in this town (to this killer). */
    cultAt(world, q, r, by = null) {
        const w = world && world.executions;
        if (!w || !Array.isArray(w.cults)) return null;
        return w.cults.find(c => c.q === q && c.r === r && _num(c.strength) > 0 && (!by || c.by.kind === by.kind && String(c.by.id) === String(by.id))) || null;
    },

    /**
     * The crowd for a death at a place. o { proclaimed, present, method,
     * guilty, highborn, crime, popularity, player } → { size, score, mood }.
     */
    crowd(world, place, o = {}) {
        const C = Executions.config().crowd;
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        const pop = _num(s && s.population, 300);
        let size = pop * _num(C.share[(s && s.type) || 'town'], 0.15);
        if (!o.proclaimed) size *= _num(C.unproclaimed, 0.35);
        if (o.present) size *= _num(C.lordPresent, 1.25);
        size = Math.round(Utils.clamp(size, _num(C.min, 12), _num(C.max, 6000)));
        const crime = Executions.crimeDef(o.crime);
        const m = Executions.config().methods[o.method] || {};
        let score = _num(crime.crowd) - _num(o.popularity) * _num(C.popularity, 0.9);
        score += (_num(s && s.happiness, 50) - 50) * _num(C.happiness, 0.4);
        const p = o.player;
        const kid = s ? s.kingdom : null;
        if (p && kid != null && p.reputation) score += Utils.clamp(_num(p.reputation[kid]), -100, 100) * _num(C.reputation, 0.15);
        if (o.guilty === false) score -= _num(C.innocentSense, 18);
        const suits = Array.isArray(m.crimes) && m.crimes.some(f => crime[f]);
        if (!suits) score += _num(m.horror);
        else score += _num(m.horror) * 0.3;
        if (o.highborn) score += _num(C.highborn, 6) + (o.method === 'hang' ? _num(m.highbornHorror) : 0);
        if (place && Executions.cultAt(world, place.q, place.r)) score -= 10;
        score = Math.round(Utils.clamp(score, -100, 100));
        return { size, score, mood: Executions._moodOf(score), town: s };
    },

    /** What a choice would bring, for the panel: { crowd, mood, risks[] }. */
    preview(player, world, id, method, placeKey, proclaimed = true) {
        const e = Executions.get(player, id);
        const place = e ? Executions._place(player, world, e, placeKey) : null;
        if (!e || !place) return null;
        const present = proclaimed ? true : place.here;
        const c = Executions.crowd(world, place, { proclaimed, present, method, guilty: e.guilty, highborn: Executions.isHighborn(e.rank), crime: e.crime, popularity: e.popularity, player });
        const risks = [];
        const rs = Executions._rescueChance(e, c, present);
        if (rs >= 0.05) risks.push(`a rescue from the crowd (${Math.round(rs * 100)}%)`);
        if (c.mood.id === 'angry' || c.mood.id === 'sullen') risks.push('a riot');
        if (method === 'hang') risks.push('the rope may break');
        return { size: c.size, score: c.score, mood: c.mood, risks, place };
    },

    _rescueChance(e, c, present) {
        const R = Executions.config().disruption.rescue || {};
        const b = e.backing || {};
        let p = _num(R.base) + _num(b.kin) * _num(R.perKin) + (b.house ? _num(R.house) : 0) + (b.band ? _num(R.band) : 0) + Math.max(0, _num(e.popularity)) * _num(R.perPopularity);
        if (c && c.mood && c.mood.id === 'angry') p += _num(R.angry);
        if (present) p *= _num(R.present, 0.55);
        return Utils.clamp(p, 0, _num(R.max, 0.35));
    },

    // ── The day ───────────────────────────────────────────────

    /** Proclaim the day: proclaimDays on, at the place, by the method. */
    proclaim(player, world, id, method, placeKey) {
        const e = Executions.get(player, id);
        if (!e) return { success: false, reason: 'No one by that name awaits your word.' };
        const place = Executions._place(player, world, e, placeKey);
        if (!place) return { success: false, reason: 'You hold no seat where it could be done.' };
        const m = Executions.methods(player, world, e, place).find(x => x.id === method);
        if (!m || !m.ok) return { success: false, reason: (m && m.why) || 'Not that way.' };
        const at = _day(world) + Math.max(1, _num(Executions.config().proclaimDays, 2));
        e.proclaimed = { day: at, method, place: { q: place.q, r: place.r, name: place.name, kingdomId: place.kingdomId } };
        Executions._raise(world, place, { id: 'p' + e.id, from: _day(world), day: at, method, name: e.name });
        return { success: true, text: `The criers go out: on day ${at}, in the square of ${place.name}, ${e.name} dies by ${m.label.toLowerCase()} for ${e.crimeLabel}.` };
    },

    /** Do it here and now (you stand at the place), or on the proclaimed day. → { success, text, outcome } */
    carryOut(player, world, id, method, placeKey, o = {}) {
        const e = Executions.get(player, id);
        if (!e) return { success: false, reason: 'No one by that name awaits your word.' };
        const place = Executions._place(player, world, e, placeKey);
        if (!place) return { success: false, reason: 'You hold no seat where it could be done.' };
        const m = Executions.methods(player, world, e, place).find(x => x.id === method);
        if (!m || !m.ok) return { success: false, reason: (m && m.why) || 'Not that way.' };
        const present = o.present != null ? !!o.present : (player.q === place.q && player.r === place.r);
        if (!o.proclaimed && !present) return { success: false, reason: `You must stand in ${place.name} to do it now; else proclaim the day.` };
        if (e.proclaimed) Executions._lower(world, e.proclaimed.place, 'p' + e.id);
        if (!o.proclaimed) Executions._raise(world, place, { id: 'p' + e.id, from: _day(world), day: _day(world), method, name: e.name });
        const r = Executions._stage(player, world, e, method, place, { proclaimed: !!o.proclaimed, present });
        return { success: true, ...r };
    },

    /** Run the day. → { text, outcome: 'executed'|'rescued'|'rope'|'riot', notices } */
    _stage(player, world, e, method, place, o) {
        const C = Executions.config();
        const D = C.disruption;
        const st = Executions.state(player);
        const day = _day(world);
        e.proclaimed = null;
        const res = Executions._resolve(player, world, e);
        if (!res.ok) {
            Executions._drop(player, e);
            return { text: `${e.name} is gone from your hands before the day.`, outcome: 'gone' };
        }
        const high = Executions.isHighborn(e.rank);
        const c = Executions.crowd(world, place, { proclaimed: o.proclaimed, present: o.present, method, guilty: e.guilty, highborn: high, crime: e.crime, popularity: e.popularity, player });
        const lord = player.name || 'the lord';
        const vars = { name: e.name, crime: e.crimeLabel, town: place.name, lord, his: _his(e.gender), him: _him(e.gender), he: _he(e.gender), crowd: c.size > 200 ? `${Math.round(c.size / 50) * 50} souls` : `${c.size} souls`, mood: c.mood.label, place: 'square' };
        let text = Executions.line('scene', vars);
        const words = Executions.lastWords(world, e, place, c, lord);
        if (words) text += ` Last words: “${words}”`;
        const ctx = { q: place.q, r: place.r, kingdomId: place.kingdomId, name: e.name };
        const k = `${e.id}|${day}|${e.name}`;
        // A rescue from the crowd
        const rs = Executions._rescueChance(e, c, o.present);
        if (_roll(world, `rescue|${k}`) < rs) {
            if (_roll(world, `rescued|${k}`) < _num((D.rescue || {}).success, 0.45)) {
                text += ` ${Executions.line('rescue', vars)}`;
                Executions._escape(player, world, e, res);
                Petitions.applyEffects(player, world, ctx, (C.effects || {}).rescued);
                st.stats.rescued++;
                Executions._record(player, world, e, { outcome: 'rescued', place, crowd: c, words, text });
                Interrupts.raise(world, { reason: `${e.name} was rescued from the scaffold`, icon: '🏃', source: 'executions' });
                return { text, outcome: 'rescued', crowd: c };
            }
            text += ` ${Executions.line('rescueFailed', vars)}`;
        }
        // A riot
        const RI = D.riot || {};
        const riotP = _num(RI[c.mood.id]);
        if (riotP > 0 && _roll(world, `riot|${k}`) < riotP) {
            text += ` ${Executions.line('riot', vars)}`;
            Petitions.applyEffects(player, world, ctx, (C.effects || {}).riot);
            Interrupts.raise(world, { reason: `A riot at the scaffold in ${place.name}`, icon: '💢', source: 'executions' });
            if (_roll(world, `riotEnd|${k}`) >= _num(RI.finishes, 0.6)) {
                text += ` The guards drag ${e.name} back to the cells: the sentence waits.`;
                Executions._record(player, world, e, { outcome: 'riot', place, crowd: c, words, text, keep: true });
                return { text, outcome: 'riot', crowd: c };
            }
            text += ' Even so, the sentence is carried out.';
        }
        // The rope breaks: a sign of God
        if (method === 'hang' && !e.ropeBroke && _roll(world, `rope|${k}`) < _num((D.rope || {}).chance, 0.035)) {
            e.ropeBroke = true;
            text += ` ${Executions.line('rope', vars)} ${_cap(_he(e.gender))} is taken down to await your word again.`;
            Executions._record(player, world, e, { outcome: 'rope', place, crowd: c, words, text, keep: true });
            Interrupts.raise(world, { reason: `The rope broke: ${e.name} awaits your word`, icon: '🙏', source: 'executions' });
            return { text, outcome: 'rope', crowd: c };
        }
        text += ` ${Executions._kill(player, world, e, res, method, place, c)}`;
        Executions._record(player, world, e, { outcome: 'executed', method, place, crowd: c, words, text });
        return { text, outcome: 'executed', crowd: c };
    },

    /** The condemned's last words: the template (LlmProse retells it when a model is on). */
    lastWords(world, e, place, c, lord) {
        const vars = { name: e.name, crime: e.crimeLabel, town: place.name, lord, his: _his(e.gender), him: _him(e.gender) };
        const salt = `${e.id}|${e.name}`;
        let key = e.guilty === false ? 'lastInnocent' : 'lastGuilty';
        if (Executions.isHighborn(e.rank)) key = 'lastHighborn';
        else if (e.popularity >= 20 && (c.mood.id === 'angry' || c.mood.id === 'sullen')) key = 'lastDefiant';
        if (_roll(world, `silent|${salt}`) < 0.12) key = 'lastSilent';
        const fallback = Executions.line(key, vars, salt);
        if (!fallback) return '';
        try {
            return LlmProse.write(world, {
                kind: 'lastWords', key: `exec:${e.id}:${e.name}`, fallback,
                style: 'The last words of one condemned, spoken aloud on the scaffold before the crowd: one or two short sentences, first person, plain and medieval. Only the words, no narration.',
                facts: { condemned: e.name, crime: e.crimeLabel, town: place.name, sentencedBy: lord, crowd: c.mood.label, claims: e.guilty === false ? 'innocent' : 'guilty or silent', rank: Executions.rankDef(e.rank).label },
            }) || fallback;
        } catch (err) { return fallback; }
    },

    /** Death itself, and all it costs. → the line told. */
    _kill(player, world, e, res, method, place, c) {
        const C = Executions.config();
        const E = C.effects || {};
        const m = C.methods[method] || {};
        const st = Executions.state(player);
        const day = _day(world);
        const high = Executions.isHighborn(e.rank);
        const crime = Executions.crimeDef(e.crime);
        const ctx = { q: place.q, r: place.r, kingdomId: place.kingdomId, name: e.name };
        const kid = place.kingdomId != null ? place.kingdomId : e.kingdomId;
        const s = _settlementAt(world, place.q, place.r);
        const innocent = e.guilty === false;
        const again = e.ropeBroke;
        // Into the town's effects: the death, the crowd's temper, the manner, the crime
        Petitions.applyEffects(player, world, ctx, E.kill);
        Petitions.applyEffects(player, world, ctx, (E.crowd || {})[c.mood.id]);
        Petitions.applyEffects(player, world, ctx, (E.method || {})[method]);
        if (crime.treason && e.guilty !== false) Petitions.applyEffects(player, world, ctx, E.treasonDone);
        if (innocent) Petitions.applyEffects(player, world, ctx, E.innocent);
        if (high && method === 'hang') Petitions.applyEffects(player, world, ctx, E.highbornHanged);
        if (again) Petitions.applyEffects(player, world, ctx, (E.signOfGod || {}).again);
        // Fear: the doer's name for cruelty and dread; the faith's clergy for a burning
        const cruelty = _num(m.cruelty, 1) * (innocent ? 2 : 1) * (again ? 1.5 : 1);
        try { Traits.recordAggression(player, kid, { cruelty, dread: _num(m.fear, 1) }); } catch (err) { /* no traits */ }
        if (m.cruel || innocent || again) {
            const at = Atrocities.state(player);
            if (at) at.butcher = Math.min(_num(Atrocities.config().infamy.max, 300), _num(at.butcher) + cruelty * 2);
        }
        const stance = Executions._faithStance(world, kid);
        if (m.clergy && m.clergy[stance]) {
            const f = MaimFaith.realmFaith(world, kid);
            if (f) { try { Devotion._addStanding(player, f, -_num(m.clergy[stance])); } catch (err) { /* no devotion */ } }
        }
        // The town's thieves are cowed for a while (systems/npcTheft.js reads deterrence)
        if (s) {
            const Dt = C.deterrence || {};
            const mult = m.cruel ? _num(Dt.cruel, 0.45) : c.size >= 60 ? _num(Dt.proclaimed, 0.55) : _num(Dt.unproclaimed, 0.75);
            s.gallowsFear = { until: day + _num(C.fearDays, 45), m: Math.min(mult, s.gallowsFear && s.gallowsFear.until > day ? _num(s.gallowsFear.m, 1) : 1) };
        }
        // The lords remember
        const L = C.lordDeeds || {};
        if (kid != null) {
            try {
                if (high && innocent && L.highbornUnjust) NPCLords.rememberRealm(world, kid, L.highbornUnjust, { note: e.name });
                else if (high && method === 'hang' && L.highbornHanged) NPCLords.rememberRealm(world, kid, L.highbornHanged, { note: e.name });
                else if (crime.treason && e.guilty && L.traitor) NPCLords.rememberRealm(world, kid, L.traitor, { note: e.name });
            } catch (err) { /* no lord */ }
        }
        if (m.cruel && L.cruelHeard) {
            for (const kk of (world && world.kingdoms) || []) {
                if (!kk || kk.isAlive === false || kk.id === kid) continue;
                try { NPCLords.rememberRealm(world, kk.id, L.cruelHeard, { note: e.name }); } catch (err) { /* no lord */ }
            }
        }
        // The talk of the towns
        try { Gossip.spreadDeed(player, world, method === 'burn' ? 'burning' : method === 'quarter' ? 'quartering' : method === 'flay' ? 'flaying' : 'execution', { q: place.q, r: place.r, location: place.name, kingdom: kid, victim: e.name }); } catch (err) { /* no gossip */ }
        // The body: what dies, and who will want blood for it
        let extra = Executions._deathOf(player, world, e, res, m, place, c);
        // Flayed: the officials take note, the faith recoils; the skin is yours to hang (systems/flaying.js)
        if (method === 'flay') {
            const fl = Flaying.onFlayed(player, world, e, place);
            if (fl) extra = `${extra ? `${extra} ` : ''}${fl}`;
        }
        // The record
        st.stats.executed++;
        st.stats.byMethod[method] = _num(st.stats.byMethod[method]) + 1;
        st.stats.fear = Math.round((_num(st.stats.fear) + _num(m.fear, 1) * (c.size >= 60 ? 2 : 1) + (innocent ? 2 : 0)) * 10) / 10;
        if (c.mood.id === 'baying' || c.mood.id === 'eager') st.stats.love = Math.round((_num(st.stats.love) + 1) * 10) / 10;
        if (c.mood.id === 'angry') st.stats.love = Math.round((_num(st.stats.love) - 2) * 10) / 10;
        if (innocent) st.stats.innocents++;
        const chron = `On ${player.name || 'your'} word, ${e.name} died by ${String(m.label || method).toLowerCase()} in ${place.name} for ${e.crimeLabel}.`;
        if (player.house) House._chronicle(player.house, world, chron, m.cruel || innocent ? ['justice', 'cruelty'] : ['justice']);
        if ((high || m.cruel) && world && Array.isArray(world.events)) world.events.push({ text: chron, type: 'political', category: 'political', kingdom: kid });
        // A martyr
        const cult = Executions._martyr(player, world, e, m, place, c);
        // A trial's record learns the end (player/trials.js reads judged.verdict when the truth comes out)
        Executions._syncTrial(player, e, 'hang');
        return `${e.name} is dead.${extra ? ` ${extra}` : ''}${cult ? ` ${Executions.line('cult', { name: e.name, town: place.name })}` : ''}`;
    },

    /** What dies, by kind; the kin's and the town's memory; vengeance. → extra words, or ''. */
    _deathOf(player, world, e, res, m, place, c) {
        const day = _day(world);
        const memKind = m.memory || 'hanged';
        const innocent = e.guilty === false;
        const R = Executions.rankDef(e.rank);
        const s = _settlementAt(world, place.q, place.r);
        if (e.kind === 'folk' || e.kind === 'captive') {
            const { folk, p } = res;
            NpcMemory.rememberKin(world, { folk, person: p }, { kind: memKind, player });
            if (s) NpcMemory.rememberTown(world, s, { kind: memKind, player, victim: e.name });
            Townsfolk.slay(folk, p, day, m.cause || 'the gallows', world);
            if (e.kind === 'captive') { const pst = PeopleCrimes.state(player); pst.captives = pst.captives.filter(x => x !== res.c); }
            if (innocent || _num(e.popularity) >= _num(Executions.config().martyr.popularAt, 25)) {
                const kin = PeopleCrimes._avenger(folk, p, day);
                if (kin) PeopleCrimes._nemesis(player, world, folk, kin, Math.round(_num(R.nemesis, 40) * (innocent ? 1.2 : 0.7)), { key: memKind, label: `the ${memKind === 'hanged' ? 'hanging' : 'death'} of ${e.name}`, note: place.name });
            }
            PeopleCrimes._annal(folk, world, `${e.name} was put to death on the scaffold in ${place.name} for ${e.crimeLabel}`);
            return '';
        }
        if (e.kind === 'bounty') {
            BountyHunting._removeBounty(player, res.b.id);
            if (player.bountyHunter) player.bountyHunter.capturesExecuted = _num(player.bountyHunter.capturesExecuted) + 1;
            player.renown = _num(player.renown) + 2;
            if (s) NpcMemory.rememberTown(world, s, { kind: memKind, player, victim: e.name });
            return 'The roads are the safer for it; no magistrate pays for a dead man.';
        }
        if (e.kind === 'vassal') {
            const court = Kingship.court(player);
            const v = res.v;
            if (court) {
                Kingship._leaveFaction(court, v);
                for (const o of Object.keys(court.council || {})) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
                court.vassals = court.vassals.filter(x => x !== v);
                // The rest of the court: cowed by a traitor's head, made to hate by an innocent's
                for (const o of court.vassals) {
                    if (e.guilty !== false) o.cowedUntil = Math.max(_num(o.cowedUntil), day + 180);
                    else o.grudge = _num(o.grudge) + 12;
                }
                Kingship._log(court, world, `⚖️ ${e.name} dies on the scaffold of ${place.name}.`);
                try { Kingship.refresh(player, world); } catch (err) { /* no refresh */ }
            }
            return e.guilty !== false ? 'The lords of your court are cowed.' : 'The lords of your court will not forget it.';
        }
        if (e.kind === 'rival') {
            const { rival } = res;
            Executions._rivalGone(player, world, res, 'executed');
            if (rival) {
                House.accrueRivalFeud(player, world, rival.kingdomId, 120, `${e.name} executed`);
                RivalHouses.remember(rival, world, 'executedKin', String(e.name).split(' ')[0]);
                RivalHouses._note(rival, world, `${e.name} was put to death by your enemy at ${place.name}.`, 'attacked');
            }
            const breach = res.ward ? Executions._guestRight(player, world, e, place, rival) : '';
            return `${rival ? `${rival.name} is your blood enemy now.` : ''}${breach ? ` ${breach}` : ''}`.trim();
        }
        e.gone = true;
        // A steward of yours condemned for corruption (systems/stewards.js): the person dies
        if (e.source === 'steward') { try { Stewards.onExecuted(player, world, e, m.cause || 'the scaffold'); } catch (err) { /* no steward */ } }
        return '';
    },

    /** The scaffold goes up in the town's square, for its street map (world/scaffolds.js reads settlement.scaffold). */
    _raise(world, place, sc) {
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        if (!s) return;
        const cur = s.scaffold;
        // (one scaffold to a square: the nearer day keeps it)
        if (cur && _num(cur.day) >= _day(world) && cur.id !== sc.id && _num(cur.day) <= _num(sc.day)) return;
        s.scaffold = sc;
    },

    /** Taken down before its day (a mercy, done elsewhere). */
    _lower(world, place, id) {
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        if (s && s.scaffold && s.scaffold.id === id) delete s.scaffold;
    },

    /** A rival target id: 'c:<captive>' / 'w:<ward>' (a bare number is a captive). */
    _rivalId(id) {
        const s = String(id);
        return /^[cw]:/.test(s) ? s : `c:${s}`;
    },

    /** A rival child leaves your hands: a captive off the list, a ward out of the household; dead: off the head's children. */
    _rivalGone(player, world, res, how, dead = true) {
        const { cap, ward, rival, body } = res;
        if (cap) RivalCaptives._free(player, world, cap);
        if (ward) { try { Raising._wardGone(player, world, ward, how, null); } catch (err) { /* no raising */ } }
        if (dead && rival && rival.head && Array.isArray(rival.head.children)) {
            const i = rival.head.children.indexOf(body);
            if (i >= 0) rival.head.children.splice(i, 1);
        }
    },

    /** Guest-right broken: a ward raised under your roof put to death. Every House and every lord hears of it. → words. */
    _guestRight(player, world, e, place, rival) {
        const G = Executions.config().guestRight || {};
        Petitions.applyEffects(player, world, { q: place.q, r: place.r, kingdomId: place.kingdomId, name: e.name }, G.effects);
        for (const o of Object.values((player.house && player.house.rivals) || {})) {
            if (!o || o === rival) continue;
            o.feud = Utils.clamp(_num(o.feud) + _num(G.otherHousesFeud, 15), 0, 100);
            try { RivalHouses.remember(o, world, 'guestRightBroken', String(e.name).split(' ')[0]); } catch (err) { /* none */ }
        }
        if (G.lordDeed) {
            for (const k of (world && world.kingdoms) || []) {
                if (!k || k.isAlive === false) continue;
                try { NPCLords.rememberRealm(world, k.id, G.lordDeed, { note: e.name }); } catch (err) { /* no lord */ }
            }
        }
        try { Traits.recordDeeds(player, { cruelty: _num(G.cruelty, 3), deceit: _num(G.deceit, 3) }); } catch (err) { /* no traits */ }
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} put ${e.name}, a ward raised under the House's own roof, to death: guest-right broken.`, ['betrayal', 'cruelty', 'rival']);
        return G.line || 'A ward raised under your own roof: guest-right is broken, and every House and every lord will hear of it.';
    },

    /** Out of your hands alive (a rescue). */
    _escape(player, world, e, res) {
        const day = _day(world);
        if (e.kind === 'folk' || e.kind === 'captive') {
            if (res.p) { res.p.jailedUntil = null; res.p.away = { d: day, to: 'the hills' }; Townsfolk.note(res.p, day, 'left', null, 'the hills'); }
            if (e.kind === 'captive') { const pst = PeopleCrimes.state(player); pst.captives = pst.captives.filter(x => x !== res.c); }
        } else if (e.kind === 'bounty') {
            res.b.status = 'active';
            res.b.escapes = _num(res.b.escapes) + 1;
        } else if (e.kind === 'vassal') {
            res.v.rebel = true;
            res.v.grudge = _num(res.v.grudge) + 40;
        } else if (e.kind === 'rival') {
            Executions._rivalGone(player, world, res, 'carried off', false);
            if (res.rival) House.accrueRivalFeud(player, world, res.rival.kingdomId, 20, `${e.name} freed by force`);
        }
    },

    _drop(player, e) {
        const st = Executions.state(player);
        st.condemned = st.condemned.filter(x => x !== e);
    },

    _record(player, world, e, o) {
        const st = Executions.state(player);
        const day = _day(world);
        if (!o.keep) Executions._drop(player, e);
        const C = Executions.config();
        let surface = null;
        // An innocent put to death on another's word, not by a trial (which surfaces its own)
        if (o.outcome === 'executed' && e.guilty === false && e.source !== 'trial' && _roll(world, `surface?|${e.id}|${e.name}`) < _num(C.surfaceChance, 0.6)) {
            const [lo, hi] = Array.isArray(C.surfaceDays) ? C.surfaceDays : [60, 420];
            surface = day + lo + Math.floor(_roll(world, `surface|${e.id}|${e.name}`) * Math.max(1, hi - lo));
        }
        st.history.unshift({
            id: e.id, day, name: e.name, gender: e.gender, rank: e.rank, kind: e.kind, crime: e.crime, crimeLabel: e.crimeLabel, source: e.source, refId: e.refId,
            guilty: e.guilty, outcome: o.outcome, method: o.method || null, mercy: o.mercy || null, place: o.place ? o.place.name : null, q: o.place ? o.place.q : null, r: o.place ? o.place.r : null,
            kingdomId: o.place ? o.place.kingdomId : e.kingdomId, crowd: o.crowd ? o.crowd.size : 0, mood: o.crowd ? o.crowd.mood.id : null, words: o.words || null, text: o.text || '',
            surface, surfaced: false, folkRef: e.kind === 'folk' ? e.ref : null,
            // (whose the body was, for systems/gibbets.js: the kin, the House, the realm that will want it back)
            ref: e.ref || null, house: e.house || null, victimKingdomId: e.kingdomId != null ? e.kingdomId : null,
        });
        if (st.history.length > 40) st.history.length = 40;
    },

    _syncTrial(player, e, verdict) {
        if (e.source !== 'trial' || e.refId == null || !player.trials || !Array.isArray(player.trials.judged)) return;
        const j = player.trials.judged.find(x => String(x.id) === String(e.refId));
        if (j) j.verdict = verdict;
    },

    // ── Mercy ─────────────────────────────────────────────────

    /** Spare them: pardon, exile, the cloister, or the knife instead. → { success, text } */
    spare(player, world, id, mercy, placeKey = null) {
        const pe = Executions.get(player, id);
        if (pe && pe.proclaimed) Executions._lower(world, pe.proclaimed.place, 'p' + pe.id);
        const C = Executions.config();
        const E = C.effects || {};
        const e = Executions.get(player, id);
        if (!e) return { success: false, reason: 'No one by that name awaits your word.' };
        const mo = Executions.mercies(player, world, e).find(x => x.id === mercy);
        if (!mo || !mo.ok) return { success: false, reason: (mo && mo.why) || 'Not that mercy.' };
        const res = Executions._resolve(player, world, e);
        if (!res.ok) { Executions._drop(player, e); return { success: false, reason: `${e.name} is gone from your hands.` }; }
        const place = Executions._place(player, world, e, placeKey) || (e.town ? { q: e.town.q, r: e.town.r, name: e.town.name, kingdomId: e.kingdomId } : null);
        const ctx = place ? { q: place.q, r: place.r, kingdomId: place.kingdomId, name: e.name } : { kingdomId: e.kingdomId, name: e.name };
        // How the crowd would have taken the death decides how it takes the mercy
        const c = place ? Executions.crowd(world, place, { proclaimed: true, present: true, method: 'hang', guilty: e.guilty, highborn: Executions.isHighborn(e.rank), crime: e.crime, popularity: e.popularity, player }) : null;
        let text = '';
        if (mercy === 'maim') {
            const r = Executions._maim(player, world, e, res);
            if (!r.ok) return { success: false, reason: r.reason || 'It cannot be done.' };
            text = r.text;
        } else if (mercy === 'mines' || mercy === 'galleys') {
            // Spared for a term at hard labour (systems/penalLabour.js): the longest term the crime has
            res.p.jailedUntil = null;
            if (res.p.away && res.p.away.to === 'the cells') res.p.away = null;
            const s = _settlementAt(world, e.ref.q, e.ref.r);
            const r = PenalLabour.sentenceFolk(player, world, { settlement: s, folk: res.folk, person: res.p, sentence: mercy, crimeId: e.crime, crimeLabel: e.crimeLabel, severity: 4, kingdomId: e.kingdomId, by: 'player', guilty: e.guilty !== false });
            if (!r.ok) return { success: false, reason: r.reason || 'It cannot be done.' };
            text = `Spared the scaffold: ${r.text}`;
            e.gone = true;
        } else {
            text = Executions._mercyOf(player, world, e, res, mercy, place);
        }
        Petitions.applyEffects(player, world, ctx, (E.mercy || {})[mercy]);
        if (c && mercy !== 'maim') Petitions.applyEffects(player, world, ctx, (E.mercyCrowd || {})[c.mood.id]);
        if (e.ropeBroke) { Petitions.applyEffects(player, world, ctx, (E.signOfGod || {}).spared); text += ' The crowd calls it the hand of God, and blesses your name.'; }
        try { Traits.recordDeed(player, 'mercy', mercy === 'pardon' ? 2 : 1); } catch (err) { /* no traits */ }
        if (mercy === 'pardon') { try { Gossip.spreadDeed(player, world, 'pardon', { q: ctx.q, r: ctx.r, location: place ? place.name : undefined, kingdom: ctx.kingdomId, victim: e.name }); } catch (err) { /* no gossip */ } }
        const st = Executions.state(player);
        st.stats.spared++;
        st.stats.love = Math.round((_num(st.stats.love) + (c && (c.mood.id === 'angry' || c.mood.id === 'sullen') ? 2 : 0.5)) * 10) / 10;
        Executions._syncTrial(player, e, mercy === 'pardon' ? 'acquit' : mercy === 'maim' ? 'maim' : 'exile');
        Executions._record(player, world, e, { outcome: 'spared', mercy, place, crowd: c, text });
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} spared ${e.name} the scaffold: ${String((C.mercies[mercy] || {}).label || mercy).toLowerCase()}.`, ['justice', 'mercy']);
        return { success: true, text };
    },

    _mercyOf(player, world, e, res, mercy, place) {
        const day = _day(world);
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        if (e.kind === 'folk' || e.kind === 'captive') {
            const { folk, p } = res;
            p.jailedUntil = null;
            if (mercy === 'pardon') {
                if (e.kind === 'captive') { PeopleCrimes.release(player, world, res.c.id); return `${e.name} walks free out of your cellar. ${_cap(_he(e.gender))} will tell what was done.`; }
                NpcMemory.remember(world, { folk, person: p }, { kind: 'spared_scaffold', player, kin: true });
                if (s) NpcMemory.rememberTown(world, s, { kind: 'ruled_merciful', player, victim: e.name });
                return `${e.name} is pardoned at the foot of the scaffold, and walks home through the crowd.`;
            }
            if (e.kind === 'captive') { const pst = PeopleCrimes.state(player); pst.captives = pst.captives.filter(x => x !== res.c); }
            NpcMemory.remember(world, { folk, person: p }, { kind: 'spared_scaffold', player, kin: true });
            Townsfolk.exile(folk, p, day, mercy === 'cloister' ? 'a cloister' : 'exile', world);
            return mercy === 'cloister' ? `${e.name} is shorn and sent to a cloister, to pray out ${_his(e.gender)} days.` : `${e.name} is put out of the realm, never to come back on pain of death.`;
        }
        if (e.kind === 'bounty') {
            BountyHunting._removeBounty(player, res.b.id);
            return mercy === 'cloister' ? `${e.name} takes the cowl: the brothers will keep ${_him(e.gender)}.` : mercy === 'exile' ? `${e.name} is driven over the border.` : `You cut ${e.name}'s bonds. ${_cap(_he(e.gender))} stares, and runs.`;
        }
        if (e.kind === 'vassal') {
            const court = Kingship.court(player);
            const v = res.v;
            if (mercy === 'pardon') {
                v.rebel = false;
                v.favour = _num(v.favour) + 20;
                v.grudge = Math.max(0, _num(v.grudge) - 20);
                return `${e.name} kneels and is pardoned before the court.`;
            }
            if (court) {
                Kingship._leaveFaction(court, v);
                for (const o of Object.keys(court.council || {})) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
                court.vassals = court.vassals.filter(x => x !== v);
                try { Kingship.refresh(player, world); } catch (err) { /* no refresh */ }
            }
            return mercy === 'cloister' ? `${e.name} is sent to a monastery for life; ${_his(e.gender)} seat is the crown's.` : `${e.name} is exiled; ${_his(e.gender)} seat is the crown's.`;
        }
        if (e.kind === 'rival') {
            const { rival } = res;
            if (mercy === 'cloister') {
                Executions._rivalGone(player, world, res, 'sent to a cloister');
                if (rival) House.accrueRivalFeud(player, world, rival.kingdomId, res.ward ? 60 : 40, `${e.name} sent to a cloister`);
                return `${e.name} is sent to a cloister: dead to ${rival ? rival.name : 'their House'}, and alive.`;
            }
            // A ward pardoned stays at your court; exiled, goes home
            if (res.ward) {
                if (mercy === 'pardon') return `${e.name} is led back from the scaffold to the household that raised ${_him(e.gender)}. ${rival ? rival.name : 'Their House'} will remember how near it came.`;
                const w = Raising.sendWardHome(player, world, res.ward.id);
                return w && w.text ? w.text : `${e.name} goes home.`;
            }
            const r = RivalCaptives.release(player, world, res.cap.id);
            return r && r.text ? r.text : `${e.name} goes home.`;
        }
        e.gone = true;
        return mercy === 'pardon' ? `${e.name} is pardoned.` : `${e.name} is spared the scaffold.`;
    },

    _maim(player, world, e, res) {
        let r;
        if (e.kind === 'folk') {
            const act = Maiming.judgeAct(world, e.kingdomId, e.crime) || 'hand';
            const s = _settlementAt(world, e.ref.q, e.ref.r);
            res.p.jailedUntil = null;
            const m = Maiming.maimFolk(player, world, { settlement: s, folk: res.folk, person: res.p, act, lawful: e.guilty !== false, why: e.crimeLabel });
            return m.ok ? { ok: true, text: `Spared the rope: ${m.text}` } : { ok: false, reason: m.reason };
        }
        const kind = e.kind;
        const id = kind === 'rival' ? Executions._rivalId(e.ref.id) : e.ref.id;
        r = Maiming.act(player, world, kind, id, 'hand');
        if (!r.success) r = Maiming.act(player, world, kind, id, 'eye');
        return r.success ? { ok: true, text: `Spared the axe: ${r.message}` } : { ok: false, reason: r.reason };
    },

    // ── Martyrs ───────────────────────────────────────────────

    _martyr(player, world, e, m, place, c) {
        const M = Executions.config().martyr || {};
        let p = 0;
        if (e.guilty === false) p = _num(M.innocent, 0.45);
        else if (_num(e.popularity) >= _num(M.popularAt, 25)) p = _num(M.popular, 0.2);
        if (!(p > 0) && !e.ropeBroke) return null;
        if (e.ropeBroke) p = Math.max(p, _num(M.signDefied, 0.8));
        if (m.cruel) p *= _num(M.cruel, 1.5);
        if (c.mood.id === 'angry') p *= _num(M.angry, 1.5);
        if (_roll(world, `martyr|${e.id}|${e.name}`) >= Math.min(0.95, p)) return null;
        return Executions.foundCult(world, { name: e.name, gender: e.gender, q: place.q, r: place.r, town: place.name, by: { kind: 'player', id: player.name || 'you', name: player.name || 'you' }, key: `${e.id}|${e.name}` }, player);
    },

    /** A martyr's cult in a town. o { name, gender, q, r, town, by: { kind: 'player'|'realm', id, name }, key }. */
    foundCult(world, o, player = null) {
        const M = Executions.config().martyr || {};
        const w = Executions.worldState(world);
        const s = _settlementAt(world, o.q, o.r);
        const old = w.cults.find(c => c.name === o.name && c.q === o.q && c.r === o.r);
        if (old) { old.strength = Math.min(100, _num(old.strength) + _num(M.truthBoost, 30)); return old; }
        const [lo, hi] = Array.isArray(M.strength) ? M.strength : [55, 85];
        const cult = {
            id: w.nextId++, name: o.name, gender: o.gender || 'male', q: o.q, r: o.r, town: o.town || (s && s.name) || 'the town',
            kingdomId: s ? s.kingdom : null, by: o.by, day: _day(world), strength: Math.round(lo + (hi - lo) * _roll(world, `cult|${o.key || o.name}`)), endowed: false, torn: false, pilgrims: 0,
        };
        w.cults.push(cult);
        if (w.cults.length > 40) w.cults = w.cults.filter(c => _num(c.strength) > 0).slice(-40);
        if (s && player && o.by.kind === 'player') NpcMemory.rememberTown(world, s, { kind: 'martyred', player, victim: o.name });
        if (player && o.by.kind === 'player') Interrupts.raise(world, { reason: `${o.name} is called a martyr in ${cult.town}`, icon: '🕯️', source: 'executions' });
        return cult;
    },

    cults(world) {
        const w = world && world.executions;
        return w && Array.isArray(w.cults) ? w.cults.filter(c => _num(c.strength) > 0) : [];
    },

    /** Endow the shrine: coin into the town's purse, the unrest at an end, the cult fades in peace. */
    endowShrine(player, world, cultId) {
        const M = Executions.config().martyr || {};
        const c = Executions.cults(world).find(x => String(x.id) === String(cultId));
        if (!c || c.endowed) return { success: false, reason: 'There is no such shrine to endow.' };
        const cost = Utils.cents(_num(M.endowCost, 120));
        if (_num(player.gold) < cost) return { success: false, reason: `It would take ${Utils.formatGold(cost)} gold.` };
        const s = _settlementAt(world, c.q, c.r);
        player.gold = Utils.cents(_num(player.gold) - cost);
        Ledger.record(player, 'charity', -cost);
        if (s) Economy.payTown(s, cost);
        c.endowed = true;
        if (s) Petitions.applyEffects(player, world, { q: c.q, r: c.r, kingdomId: s.kingdom }, { happiness: 4, karma: 2 });
        if (s) NpcMemory.rememberTown(world, s, { kind: 'ruled_generous', player, victim: c.name });
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The House'} endowed the shrine of ${c.name} at ${c.town}.`, ['faith', 'mercy']);
        return { success: true, text: `You pay ${Utils.formatGold(cost)} gold for candles, a stone and a priest at the shrine of ${c.name}. ${c.town} takes it for penance.` };
    },

    /** Pull the shrine down: fear, and the cult may only harden. */
    tearDownShrine(player, world, cultId) {
        const T = (Executions.config().martyr || {}).tearDown || {};
        const c = Executions.cults(world).find(x => String(x.id) === String(cultId));
        if (!c || c.torn) return { success: false, reason: 'There is no such shrine standing.' };
        const s = _settlementAt(world, c.q, c.r);
        c.torn = true;
        const harden = _roll(world, `torn|${c.id}`) < _num(T.hardenChance, 0.5);
        c.strength = harden ? Math.min(100, _num(c.strength) + _num(T.harden, 20)) : Math.max(0, Math.round(_num(c.strength) / 3));
        if (s) Petitions.applyEffects(player, world, { q: c.q, r: c.r, kingdomId: s.kingdom }, { happiness: _num(T.happiness, -6) });
        try { Traits.recordAggression(player, s ? s.kingdom : null, { dread: _num(T.dread, 2), cruelty: 1 }); } catch (err) { /* no traits */ }
        return { success: true, text: harden ? `Your men pull down the shrine of ${c.name}. By morning the flowers are back, more than before.` : `Your men pull down the shrine of ${c.name}. The candles go out; the town keeps its prayers to itself now.` };
    },

    /** Does a public death still cow this town's thieves? → a multiplier on their chance (1 = no). */
    deterrence(settlement, day) {
        const g = settlement && settlement.gallowsFear;
        return g && _num(g.until) > _num(day) ? Utils.clamp(_num(g.m, 1), 0.2, 1) : 1;
    },

    /** Is the town one you rule (its unrest is yours)? */
    _rulesTown(player, world, q, r) {
        if (!player) return false;
        if (Executions.seats(player, world).some(s => s.q === q && s.r === r)) return true;
        const s = _settlementAt(world, q, r);
        let k = null;
        try { k = Throne.ruledKingdom(player, world); } catch (err) { k = null; }
        return !!(k && s && s.kingdom === k.id);
    },

    _cultsWeek(world, player, out) {
        const M = Executions.config().martyr || {};
        const w = Executions.worldState(world);
        for (const c of w.cults) {
            if (!(_num(c.strength) > 0)) continue;
            c.strength = Math.max(0, Math.round((_num(c.strength) - _num(M.decayPerWeek, 0.35) * (c.endowed ? _num(M.endowFade, 4) : 1)) * 100) / 100);
            if (c.strength <= _num(M.endAt, 4)) { c.strength = 0; continue; }
            const s = _settlementAt(world, c.q, c.r);
            if (!s) continue;
            // Pilgrims: their coin comes from the realm's capital's purse into the shrine town's
            const k = _kingdom(world, s.kingdom);
            const capS = k && k.capital ? _settlementAt(world, k.capital.q, k.capital.r) : null;
            if (capS && capS !== s) {
                const got = Economy.drawTown(capS, Utils.cents(_num(M.pilgrimCoin, 3) * c.strength / 100));
                if (got > 0) { Economy.payTown(s, got); c.pilgrims = Utils.cents(_num(c.pilgrims) + got); }
            }
            if (c.endowed) continue;
            const f = c.strength / 100;
            // Unrest against the killer: the player's towns, or the crown that did it
            if (c.by.kind === 'player' && player && Executions._rulesTown(player, world, c.q, c.r)) {
                const h = _num(s.happiness, 50);
                if (h > _num(M.happinessFloor, 20)) s.happiness = Math.max(_num(M.happinessFloor, 20), Math.round((h - _num(M.unrestPerWeek, 0.6) * f) * 100) / 100);
                if (k && typeof k.stability === 'number') k.stability = Utils.clamp(k.stability - _num(M.stabilityPerWeek, 0.15) * f, 0, 100);
            } else if (c.by.kind === 'realm' && k && String(k.id) === String(c.by.id) && typeof k.stability === 'number') {
                k.stability = Utils.clamp(k.stability - _num(M.stabilityPerWeek, 0.15) * f, 0, 100);
            }
        }
        if (w.cults.length > 20) w.cults = w.cults.filter(c => _num(c.strength) > 0);
        void out;
    },

    // ── The realms' own scaffolds ─────────────────────────────

    _aiWeek(world, player, day, out) {
        const A = Executions.config().ai || {};
        const w = Executions.worldState(world);
        const week = Math.floor(day / Math.max(1, _num(A.everyDays, 7)));
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || !k.capital) continue;
            // (not the realm the player rules: its scaffold is the player's)
            try { const rk = player ? Throne.ruledKingdom(player, world) : null; if (rk && rk.id === k.id) continue; } catch (err) { /* none */ }
            const key = `ai|${k.id}|${week}`;
            if (_roll(world, key) >= _num(A.chance, 0.035)) continue;
            const s = _settlementAt(world, k.capital.q, k.capital.r);
            if (!s || !s.folk || !Array.isArray(s.folk.people)) continue;
            const Y = 360;
            const high = _roll(world, `${key}|high`) < _num(A.highbornShare, 0.08);
            const pool = Townsfolk.residents(s.folk).filter(p => (day - _num(p.born, day)) / Y >= 16 && !p.jailedUntil && (high ? p.role === 'noble' : p.role !== 'noble'));
            if (!pool.length) continue;
            const p = pool[_hash(`${key}|who`) % pool.length];
            let crime = _pickW(A.crimes, _roll(world, `${key}|crime`)) || 'theft';
            if (high) crime = 'treason';
            const cd = Executions.crimeDef(crime);
            const stance = Executions._faithStance(world, k.id);
            const method = high ? 'behead' : cd.heresy && stance === 'harsh' ? 'burn' : cd.treason && stance === 'harsh' ? 'quarter' : 'hang';
            const e = {
                id: w.nextId++, q: k.capital.q, r: k.capital.r, town: s.name, kingdomId: k.id, day: day + Math.max(1, _num(A.proclaimDays, 2)), pid: p.id, name: Townsfolk.name(p),
                gender: p.gender === 'female' ? 'female' : 'male', crime, crimeLabel: cd.label, method, highborn: high, guilty: _roll(world, `${key}|guilt`) < _num(A.guiltyShare, 0.8),
                popularity: Executions._folkPopularity(s.folk, p, high ? 'noble' : 'commoner'), resolved: false,
            };
            p.jailedUntil = e.day + 1;
            Executions._raise(world, { q: e.q, r: e.r }, { id: 'a' + e.id, from: day, day: e.day, method, name: e.name });
            w.public.push(e);
            if (w.public.length > _num(A.keep, 30)) w.public.splice(0, w.public.length - _num(A.keep, 30));
            if (player && player.q === e.q && player.r === e.r) out.notices.push({ icon: '📜', title: 'A Death Proclaimed', text: `The criers of ${s.name}: on day ${e.day}, ${e.name} dies by ${String((Executions.config().methods[method] || {}).label || method).toLowerCase()} for ${e.crimeLabel}. The whole town will be there.`, type: 'info' });
        }
    },

    /**
     * A court of another order hands one of the townsfolk over to the secular arm
     * (the inquisition's obstinate heretic, systems/inquisition.js): the death is
     * proclaimed `days` on and carried out as the realms' own are (_aiResolve: the
     * crowd, the kin's feud, a martyr's shrine for the innocent).
     * o { q, r, kingdomId, pid, crime, method, guilty, days, by } → the entry, or null.
     */
    handOver(world, o = {}) {
        const w = Executions.worldState(world);
        const s = _settlementAt(world, o.q, o.r);
        const p = s && s.folk ? Townsfolk.get(s.folk, o.pid) : null;
        if (!w || !s || !p || p.died != null) return null;
        const day = _day(world);
        const crime = o.crime || 'heresy';
        const cd = Executions.crimeDef(crime);
        const method = o.method || 'burn';
        const high = p.role === 'noble';
        const e = {
            id: w.nextId++, q: o.q, r: o.r, town: s.name, kingdomId: o.kingdomId != null ? o.kingdomId : s.kingdom, day: day + Math.max(1, _num(o.days, 2)), pid: p.id, name: Townsfolk.name(p),
            gender: p.gender === 'female' ? 'female' : 'male', crime, crimeLabel: cd.label, method, highborn: high, guilty: o.guilty !== false,
            popularity: Executions._folkPopularity(s.folk, p, high ? 'noble' : 'commoner'), resolved: false, by: o.by || null,
        };
        p.jailedUntil = e.day + 1;
        Executions._raise(world, { q: e.q, r: e.r }, { id: 'a' + e.id, from: day, day: e.day, method, name: e.name });
        w.public.push(e);
        const keep = _num((Executions.config().ai || {}).keep, 30);
        if (w.public.length > keep) w.public.splice(0, w.public.length - keep);
        return e;
    },

    /** The realms' deaths due today (unless the player watched one already). */
    _aiResolveDue(world, player, day, out) {
        const w = Executions.worldState(world);
        for (const e of w.public) {
            if (e.resolved || _num(e.day) > day) continue;
            const r = Executions._aiResolve(world, e, null, player);
            if (player && player.q === e.q && player.r === e.r && r) out.notices.push({ icon: '💀', title: `The Scaffold of ${e.town}`, text: r, type: 'info' });
        }
        // (the done fall off after a while)
        w.public = w.public.filter(e => !e.resolved || day - _num(e.day) < 10);
    },

    /** A realm's execution happens. how: null | 'mercy_won' (commuted). → the scene. */
    _aiResolve(world, e, how = null, player = null) {
        const A = Executions.config().ai || {};
        const w = Executions.worldState(world);
        e.resolved = true;
        const s = _settlementAt(world, e.q, e.r);
        const folk = s && s.folk;
        const p = folk ? Townsfolk.get(folk, e.pid) : null;
        const m = Executions.config().methods[e.method] || {};
        const c = Executions.crowd(world, { q: e.q, r: e.r }, { proclaimed: true, present: false, method: e.method, guilty: e.guilty, highborn: e.highborn, crime: e.crime, popularity: e.popularity });
        const vars = { name: e.name, crime: e.crimeLabel, town: e.town, lord: 'the crown', his: _his(e.gender), him: _him(e.gender), crowd: `${c.size} souls`, mood: c.mood.label, place: 'square' };
        let text = Executions.line('scene', vars);
        if (!p || p.died != null) { e.gone = true; return null; }
        p.jailedUntil = null;
        if (how === 'mercy_won') {
            Townsfolk.exile(folk, p, _day(world), 'exile', world);
            text += ` The crowd takes up your cry for mercy; the sheriff looks to the castle, and ${e.name} is put out of the realm instead.`;
            e.outcome = 'spared';
        } else {
            const words = Executions.line(e.highborn ? 'lastHighborn' : e.guilty ? 'lastGuilty' : 'lastInnocent', vars, `ai|${e.id}`);
            if (words) text += ` Last words: “${words}”`;
            Townsfolk.slay(folk, p, _day(world), m.cause || 'the gallows', world);
            text += ` ${e.name} is dead.`;
            // The kin may hold the crown to blame: an innocent always, a guilty one when they deem it unjust (systems/bloodFeuds.js)
            const crown = _kingdom(world, e.kingdomId);
            if (crown && p.last) {
                BloodFeuds.killing(world, {
                    player, victim: BloodFeuds.folkSide(s, p.last), killer: BloodFeuds.lordSide(crown), dead: { name: e.name, rank: BloodFeuds.folkRank(p, _day(world)), person: p },
                    killerName: 'the crown', how: e.guilty ? (m.cruel ? 'burned' : 'hanged') : 'wrongly_condemned', innocent: !e.guilty, where: { q: s.q, r: s.r, town: s.name },
                });
            }
            e.outcome = 'executed';
            s.gallowsFear = { until: _day(world) + _num(Executions.config().fearDays, 45), m: m.cruel ? 0.45 : 0.6 };
            // An innocent of the realm's own: a martyr against its crown
            if (!e.guilty && _roll(world, `aiMartyr|${e.id}`) < _num((Executions.config().martyr || {}).innocent, 0.45) * (m.cruel ? 1.5 : 1)) {
                const k = _kingdom(world, e.kingdomId);
                Executions.foundCult(world, { name: e.name, gender: e.gender, q: e.q, r: e.r, town: e.town, by: { kind: 'realm', id: e.kingdomId, name: k ? k.name : 'the crown' }, key: `ai|${e.id}` }, player);
                text += ` ${Executions.line('cult', { name: e.name, town: e.town })}`;
            }
            if ((e.highborn || m.cruel) && Array.isArray(world.events)) world.events.push({ text: `${e.name} died by ${String(m.label || 'the rope').toLowerCase()} in ${e.town} for ${e.crimeLabel}.`, type: 'political', category: 'political', kingdom: e.kingdomId });
        }
        w.log.unshift({ day: _day(world), town: e.town, kingdomId: e.kingdomId, name: e.name, crime: e.crimeLabel, method: e.method, outcome: e.outcome });
        if (w.log.length > _num(A.logKeep, 40)) w.log.length = _num(A.logKeep, 40);
        return text;
    },

    /** Today's realm executions in the town at (q, r) that a visitor may watch. */
    crowdsAt(world, q, r, day = _day(world)) {
        const w = world && world.executions;
        if (!w || !Array.isArray(w.public)) return [];
        return w.public.filter(e => !e.resolved && e.q === q && e.r === r && _num(e.day) === day);
    },

    /**
     * What a visitor at the scaffold in the town at (q, r) can learn
     * (the street map's scaffold and pillory menus, ui/innerMapScaffold.js):
     * → { town, kingdomId, realm, condemned: [{ id, kind: 'realm'|'yours', name, crimeLabel,
     *   method, methodLabel, icon, day, today, guilty }], methods: [{ id, label, icon, ok, why }],
     *   punishment, mutilation, fear (thieves' chance ×, from deterrence), cult }.
     * Every line read from state that other systems keep and read.
     */
    atTown(player, world, q, r) {
        const C = Executions.config();
        const s = _settlementAt(world, q, r);
        const day = _day(world);
        const kid = s ? s.kingdom : null;
        const k = _kingdom(world, kid);
        const condemned = [];
        const w = world && world.executions;
        for (const e of (w && Array.isArray(w.public) ? w.public : [])) {
            if (e.resolved || e.q !== q || e.r !== r || _num(e.day) < day) continue;
            const m = C.methods[e.method] || {};
            condemned.push({ id: e.id, kind: 'realm', name: e.name, crimeLabel: e.crimeLabel, method: e.method, methodLabel: m.label || e.method, icon: m.icon || '💀', day: _num(e.day), today: _num(e.day) === day, guilty: null });
        }
        for (const e of Executions.list(player)) {
            const pl = e.proclaimed && e.proclaimed.place;
            if (!pl || pl.q !== q || pl.r !== r) continue;
            const m = C.methods[e.proclaimed.method] || {};
            condemned.push({ id: e.id, kind: 'yours', name: e.name, crimeLabel: e.crimeLabel, method: e.proclaimed.method, methodLabel: m.label || e.proclaimed.method, icon: m.icon || '💀', day: _num(e.proclaimed.day), today: _num(e.proclaimed.day) === day, guilty: e.guilty });
        }
        condemned.sort((a, b) => a.day - b.day);
        // The deaths this realm's law and faith allow
        const stance = kid != null ? Executions._faithStance(world, kid) : 'mild';
        const methods = Object.entries(C.methods).map(([id, m]) => {
            let why = '';
            if (m.faith && !m.faith[stance]) why = `forbidden by the faith (it holds the body ${stance === 'sacred' ? 'sacred' : 'its own'})`;
            else if (m.highbornOnly) why = 'for the highborn only';
            else if (Array.isArray(m.crimes)) why = `only for ${m.crimes.join(' or ')}`;
            return { id, label: m.label, icon: m.icon, ok: !(m.faith && !m.faith[stance]), why };
        });
        let punishment = null, mutilation = null;
        if (kid != null) {
            try { punishment = Laws.option(world, kid, 'punishment'); } catch (err) { punishment = null; }
            try { mutilation = Laws.option(world, kid, 'mutilation'); } catch (err) { mutilation = null; }
        }
        return {
            town: s ? s.name : null, kingdomId: kid, realm: k ? k.name : null, condemned, methods, punishment, mutilation,
            fear: Executions.deterrence(s, day), cult: Executions.cultAt(world, q, r),
        };
    },

    /** Join a realm's crowd: watch, or cry out for mercy. → { success, text } */
    attend(player, world, pubId, how = 'watch') {
        const w = Executions.worldState(world);
        const e = w.public.find(x => String(x.id) === String(pubId));
        if (!e || e.resolved) return { success: false, reason: 'There is no execution here today.' };
        if (player.q !== e.q || player.r !== e.r) return { success: false, reason: `You must be in ${e.town}.` };
        if (how === 'mercy') {
            const M = (Executions.config().attend || {}).mercy || {};
            const c = Executions.crowd(world, { q: e.q, r: e.r }, { proclaimed: true, method: e.method, guilty: e.guilty, highborn: e.highborn, crime: e.crime, popularity: e.popularity });
            let p = _num(M.base, 0.12) + _num(player.charisma) * _num(M.perCharisma, 0.015) + _num(M[c.mood.id]) + (e.guilty ? 0 : _num(M.innocent, 0.1));
            p = Math.min(_num(M.max, 0.6), p);
            const won = _roll(world, `mercyCry|${e.id}|${player.name || ''}`) < p;
            if (!player.reputation) player.reputation = {};
            player.reputation[e.kingdomId] = _num(player.reputation[e.kingdomId]) + _num(M.reputation, -2);
            try { Underworld.addHeat(player, e.kingdomId, _num(M.heat, 4), world); } catch (err) { /* no heat */ }
            player.renown = _num(player.renown) + _num(M.renown, 1);
            const s = _settlementAt(world, e.q, e.r);
            if (s) NpcMemory.rememberTown(world, s, { kind: 'spoke_for_condemned', player, victim: e.name });
            const text = Executions._aiResolve(world, e, won ? 'mercy_won' : null, player);
            return { success: true, text: `You cry out for mercy for ${e.name}. ${won ? '' : 'Some take it up; the hangman does not hear it. '}${text || ''}`.trim() };
        }
        const text = Executions._aiResolve(world, e, null, player);
        return { success: true, text: text || `${e.name} is gone before the day.` };
    },

    // ── The day's turn ────────────────────────────────────────

    /** → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Executions.enabled()) return out;
        const day = _day(world);
        const A = Executions.config().ai || {};
        const weekly = day % Math.max(1, _num(A.everyDays, 7)) === 0;
        if (weekly) {
            Executions._aiWeek(world, player, day, out);
            if (world.executions) Executions._cultsWeek(world, player, out);
        }
        if (world.executions && world.executions.public.length) Executions._aiResolveDue(world, player, day, out);
        if (player && player.executions) Executions._playerDay(world, player, day, out);
        return out;
    },

    _playerDay(world, player, day, out) {
        const C = Executions.config();
        const st = Executions.state(player);
        for (const e of st.condemned.slice()) {
            if (e.proclaimed && _num(e.proclaimed.day) <= day) {
                const pl = e.proclaimed.place;
                const present = player.q === pl.q && player.r === pl.r;
                const r = Executions._stage(player, world, e, e.proclaimed.method, { ...pl, key: _key(pl.q, pl.r) }, { proclaimed: true, present });
                out.notices.push({ icon: r.outcome === 'executed' ? '💀' : r.outcome === 'rescued' ? '🏃' : r.outcome === 'rope' ? '🙏' : '💢', title: `The Scaffold of ${pl.name}`, text: present ? r.text : `Your officers carried out the sentence. ${r.text}`, type: r.outcome === 'executed' ? 'info' : 'warning' });
                continue;
            }
            // Waiting: kin, a House or a band may break them out
            const waited = day - _num(e.day);
            if (waited > 0 && waited % 30 === 0 && (e.backing.house || e.backing.band || _num(e.backing.kin) > 1)) {
                if (_roll(world, `break|${e.id}|${waited}`) < _num(C.waitRescuePerMonth, 0.04)) {
                    const res = Executions._resolve(player, world, e);
                    if (res.ok) Executions._escape(player, world, e, res);
                    Executions._record(player, world, e, { outcome: 'rescued', text: `${e.name} was broken out of the cells while awaiting your word.` });
                    st.stats.rescued++;
                    out.notices.push({ icon: '🏃', title: 'Broken Out', text: `${e.name} was broken out of the cells while ${_he(e.gender)} awaited your word.`, type: 'warning' });
                    continue;
                }
            }
            // Those gone from your hands meanwhile (a captive died, a lord fled)
            if (waited > 0 && waited % 7 === 0 && !Executions._resolve(player, world, e).ok) Executions._drop(player, e);
        }
        // The truth about the innocent put to death on another's word
        for (const h of st.history) {
            if (!h.surface || h.surfaced || day < h.surface) continue;
            h.surfaced = true;
            Executions._truth(world, player, h, out);
        }
    },

    _truth(world, player, h, out) {
        const C = Executions.config();
        const ctx = { q: h.q, r: h.r, kingdomId: h.kingdomId, name: h.name };
        Petitions.applyEffects(player, world, ctx, (C.effects || {}).truth);
        const s = h.q != null ? _settlementAt(world, h.q, h.r) : null;
        if (s) NpcMemory.rememberTown(world, s, { kind: 'ruled_unjust', player, victim: h.name });
        if (h.folkRef) {
            const f = PeopleCrimes.personAt(world, h.folkRef.q, h.folkRef.r, h.folkRef.pid);
            if (f.folk && f.p) NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: 'wrongly_condemned', player });
        }
        if (Executions.isHighborn(h.rank) && h.kingdomId != null && (C.lordDeeds || {}).highbornUnjust) {
            try { NPCLords.rememberRealm(world, h.kingdomId, C.lordDeeds.highbornUnjust, { note: h.name }); } catch (err) { /* no lord */ }
        }
        if (h.q != null) Executions.foundCult(world, { name: h.name, gender: h.gender, q: h.q, r: h.r, town: h.place, by: { kind: 'player', id: player.name || 'you', name: player.name || 'you' }, key: `truth|${h.id}` }, player);
        const text = Executions.line('truth', { name: h.name, crime: h.crimeLabel, town: h.place || 'the town', him: _him(h.gender) });
        if (player.house) House._chronicle(player.house, world, text, ['justice', 'cruelty']);
        out.notices.push({ icon: '⚖️', title: 'The Truth Comes Out', text, type: 'error' });
        Interrupts.raise(world, { reason: `The truth about ${h.name} comes out`, icon: '⚖️', source: 'executions' });
    },
};
