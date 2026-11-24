// ============================================
// GIBBETS — heads on spikes, the gibbet at the crossroads, war trophies
// ============================================
// The dead put on show, and what is taken off a slain great enemy.
//
//   THE BODIES  Those who die by your word or your hand lie in your hands a
//            while (player.gibbets.bodies, bodyDays): the executed (read off the
//            scaffold's record, systems/executions.js — not the burned, there is
//            nothing left), a rising's leader hanged on the spot
//            (systems/peasantRevolts.js), an enemy commander slain on the field
//            (player/fieldBattle.js: a captain, a knight, a lord — and now and
//            then from a great host the king himself, whose realm then passes to
//            his heir), a rival House's head killed in the lists
//            (player/ordeals.js). For each: DISPLAY it at a seat you rule — the
//            head on a spike over the gate, the body in a gibbet cage at the
//            crossroads, left on the gallows in the square — or RETURN it to the
//            kin (their thanks, the feud eased), BURY it, or take a TROPHY off a
//            great one.
//   THE DISPLAY lives on the town (settlement.displays, world/deadDisplays.js:
//            the street map lays it, it rots fresh → rotting → bones and falls).
//            While it stands, read elsewhere: thieves are cowed (npcTheft reads
//            deterrence()), the commons are afraid (peasantRevolts' pressure
//            reads revoltDread(): a 'fear' part, in the town and its
//            neighbours), and the town sours (its happiness, weekly). At the
//            raising: the town's memory, the dead man's kin (a blood memory the
//            Nemesis reads), his House (feud), his realm's lord (a vendetta deed
//            coalitions read as a casus belli), his faith (clergy standing),
//            your dread and renown, a court cowed by a traitor's head. Every
//            desecration is logged (grievances(): the hook a blood-feud system
//            reads). It comes down by your hand (here), the kin's at night, the
//            faith's (by its stance), or time.
//   THE REALMS put their own executed up at their capitals (cheaply, off
//            world.executions.public), so the towns you visit show them too.
//   TROPHIES a skull cup, a captured banner, a sword: heirlooms
//            (systems/heirlooms.js: their bonus and Prestige a year, their
//            history, theft, loss at a succession) carrying item.trophy. Read:
//            dread in that realm (trophyDread: Atrocities.termsShift, siege
//            terms), the heirs' vendetta (lordMemory trophy_held, renewed each
//            year), the faith's disapproval (a skull cup), and his realm wants
//            it back: envoys with a price out of its treasury, or a peace term
//            while at war; refuse and they remember; they may steal it back.
//
// State: player.gibbets (bodies, record; saved), world.gibbets (the towns with
// displays, the grievance log; saved), settlement.displays (with the tile).
// Explicit params, no globals; every roll a hash of the world seed. Content and
// tuning: data/gibbets.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { DeadDisplays } from '../world/deadDisplays.js';
import { NPCLords } from '../world/npcLords.js';
import { NpcMemory } from './npcMemory.js';
import { PeopleCrimes } from './peopleCrimes.js';
import { Devotion } from './devotion.js';
import { MaimFaith } from './maimFaith.js';
import { Traits } from './traits.js';
import { House } from './house.js';
import { Heirlooms } from './heirlooms.js';
import { Gossip } from './gossip.js';
import { Ledger } from './ledger.js';
// (run time only)
import { Executions } from './executions.js';
import { RivalHouses } from './rivalHouses.js';
import { Underworld } from './underworld.js';
import { Kingship } from './kingship.js';
import { RealmWars } from './realmWars.js';
import { Interrogation } from './interrogation.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _him = (g) => (g === 'female' ? 'her' : 'him');
const _r1 = (v) => Math.round(v * 10) / 10;

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
    return (_hash(`${_seed(world)}|gibbets|${key}`) % 100000) / 100000;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && q != null ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _kingdom(world, id) {
    return id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null;
}

/** Hexes apart, near enough on the offset grid (Chebyshev). */
function _near(a, b) {
    return Math.max(Math.abs(_num(a.q) - _num(b.q)), Math.abs(_num(a.r) - _num(b.r)));
}

function _dpy() {
    const rel = DataLoader.relationships || null;
    return _num(rel && rel.heirSettings && rel.heirSettings.daysPerYear) || 120;
}

let _cfg = null;
let _cfgSrc;

export const Gibbets = {

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.gibbets : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const T = _obj(d.trophies) || {};
            _cfg = {
                ...d,
                enabled: d.enabled !== false,
                kinds: _obj(d.kinds) || { spike: { label: 'Head on a spike', short: 'head on a spike', icon: '💀', crime: 0.7, revolt: 9, mood: 1, desecration: 1, fear: 1, needsHead: true } },
                rankWeight: _obj(d.rankWeight) || {},
                great: Array.isArray(d.great) ? d.great : ['noble', 'vassal', 'rival', 'lord', 'king'],
                desecration: _obj(d.desecration) || {},
                fear: _obj(d.fear) || {},
                kinTakeDown: _obj(d.kinTakeDown) || {},
                faithTakeDown: _obj(d.faithTakeDown) || {},
                takeDown: _obj(d.takeDown) || {},
                returnBody: _obj(d.returnBody) || {},
                ai: _obj(d.ai) || {},
                field: _obj(d.field) || {},
                trophies: { ...T, kinds: _obj(T.kinds) || {}, price: _obj(T.price) || {} },
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return Gibbets.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = Gibbets.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    kind(id) { return Gibbets.config().kinds[id] || null; },

    stageWeight(stageId) {
        const s = DeadDisplays.stages().find(x => x.id === stageId);
        return s ? _num(s.weight, 1) : 1;
    },

    rankWeight(rank) { return _num(Gibbets.config().rankWeight[rank], 1); },

    isGreat(rank) { return Gibbets.config().great.includes(rank); },

    // ── State ─────────────────────────────────────────────────

    _blank() { return { v: 1, nextId: 1, seen: 0, bodies: [], log: [], stats: { displayed: 0, returned: 0, buried: 0, takenDown: 0, trophies: 0, trophiesReturned: 0, refused: 0 } }; },

    state(player) {
        if (!player) return null;
        if (!_obj(player.gibbets)) player.gibbets = Gibbets._blank();
        const st = player.gibbets;
        const b = Gibbets._blank();
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!Number.isFinite(st.seen)) st.seen = 0;
        if (!Array.isArray(st.bodies)) st.bodies = [];
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    worldState(world) {
        if (!world) return null;
        if (!_obj(world.gibbets)) world.gibbets = { nextId: 1, towns: [], grievances: [], log: [] };
        const w = world.gibbets;
        if (!(w.nextId > 0)) w.nextId = 1;
        for (const k of ['towns', 'grievances', 'log']) if (!Array.isArray(w[k])) w[k] = [];
        return w;
    },

    serializeWorld(world) {
        return world && _obj(world.gibbets) ? JSON.parse(JSON.stringify(world.gibbets)) : null;
    },

    restoreWorld(saved, world) {
        if (!world) return;
        world.gibbets = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : undefined;
        if (world.gibbets) Gibbets.worldState(world);
    },

    // ── The bodies in your hands ──────────────────────────────

    /**
     * A body is yours to dispose of. o = { name, gender, rank, source ('executed'|'rebel'|
     * 'field'|'lists'), how (words: 'on the scaffold of X'), q, r (where it lies), kingdomId
     * (his realm), crime, rebel, traitor, kin { q, r, pid }, house { id, name }, headless,
     * key (once only) }. → the body, or null.
     */
    offerBody(player, world, o = {}) {
        if (!player || !world || !Gibbets.enabled() || !o.name) return null;
        const st = Gibbets.state(player);
        const day = _day(world);
        if (o.key && st.bodies.some(b => b.key === o.key)) return null;
        const C = Gibbets.config();
        const body = {
            id: st.nextId++, key: o.key || null, name: o.name, gender: o.gender === 'female' ? 'female' : 'male', rank: o.rank || 'commoner',
            source: o.source || 'executed', how: o.how || '', q: o.q != null ? o.q : player.q, r: o.r != null ? o.r : player.r,
            kingdomId: o.kingdomId != null ? o.kingdomId : null, crime: o.crime || null, rebel: !!o.rebel, traitor: !!o.traitor,
            kin: _obj(o.kin) ? { q: o.kin.q, r: o.kin.r, pid: o.kin.pid } : null, house: _obj(o.house) ? { id: o.house.id, name: o.house.name || null } : null,
            headless: !!o.headless, trophies: [], day, until: day + _num(C.bodyDays, 20),
        };
        body.great = Gibbets.isGreat(body.rank);
        st.bodies.push(body);
        return body;
    },

    /** The scaffold's dead since last asked become bodies in your hands (not the burned). → new bodies. */
    collect(player, world) {
        if (!player || !player.executions || !world) return [];
        const st = Gibbets.state(player);
        const hist = Array.isArray(player.executions.history) ? player.executions.history : [];
        const out = [];
        let seen = st.seen;
        for (const h of hist) {
            if (!h || !(_num(h.id) > st.seen)) continue;
            seen = Math.max(seen, _num(h.id));
            if (h.outcome !== 'executed' || h.method === 'burn') continue;
            if (_day(world) - _num(h.day) > _num(Gibbets.config().bodyDays, 20)) continue;
            const ref = _obj(h.ref) || {};
            const crime = Executions.crimeDef(h.crime);
            const house = h.kind === 'rival' && ref.rivalId != null ? { id: ref.rivalId, name: h.house || null } : null;
            const b = Gibbets.offerBody(player, world, {
                key: `exec:${h.id}`, name: h.name, gender: h.gender, rank: h.kind === 'vassal' ? 'vassal' : h.kind === 'rival' ? 'rival' : h.rank,
                source: h.source === 'revolt' ? 'rebel' : 'executed', how: `put to death in ${h.place || 'the square'}`, q: h.q, r: h.r,
                kingdomId: h.victimKingdomId != null ? h.victimKingdomId : h.kingdomId, crime: h.crimeLabel || null,
                rebel: h.source === 'revolt' || h.crime === 'rebellion', traitor: !!crime.treason, kin: h.folkRef || null, house,
            });
            if (b) out.push(b);
        }
        st.seen = seen;
        return out;
    },

    /** The bodies still to be disposed of (the rotten past their days are buried quietly). */
    bodies(player, world) {
        if (!player || !player.gibbets) return [];
        const st = Gibbets.state(player);
        const day = _day(world);
        st.bodies = st.bodies.filter(b => _num(b.until) >= day);
        return st.bodies;
    },

    body(player, id) {
        return player && player.gibbets ? Gibbets.state(player).bodies.find(b => String(b.id) === String(id)) || null : null;
    },

    /** Where you could set it up: a seat you rule (the right of the sword). The place of death first, then the nearest. */
    places(player, world, body) {
        let seats = [];
        try { seats = Executions.seats(player, world); } catch (e) { seats = []; }
        const at = body || player;
        return seats.map(s => ({ key: s.key, q: s.q, r: s.r, name: s.name, kingdomId: s.kingdomId, here: player.q === s.q && player.r === s.r, d: _near(s, at) }))
            .sort((a, b) => a.d - b.d);
    },

    /** The ways to show this body: [{ id, label, icon, desc, ok, why }]. */
    displayOptions(player, world, body) {
        const C = Gibbets.config();
        const places = Gibbets.places(player, world, body);
        return Object.entries(C.kinds).map(([id, k]) => {
            let why = '';
            if (!places.length) why = 'You hold no seat where it could be set up';
            else if (k.needsHead && body.headless) why = 'The head is gone';
            return { id, label: k.label, icon: k.icon, desc: k.desc || '', ok: !why, why };
        });
    },

    /** The trophies a great body could give: [{ id, label, icon, desc, ok, why }]. */
    trophyOptions(player, world, body) {
        const T = Gibbets.config().trophies;
        return Object.entries(T.kinds).map(([id, k]) => {
            let why = '';
            if (!body.great) why = 'Only a lord or a king is worth it';
            else if (!player.house) why = 'You have no House to keep it';
            else if (k.needsHead && body.headless) why = 'The head is gone';
            else if ((body.trophies || []).includes(id)) why = 'Already taken';
            return { id, label: k.label, icon: k.icon, desc: k.desc || '', ok: !why, why };
        });
    },

    /** Set the body up at a seat. → { success, text, display } */
    display(player, world, bodyId, kindId, placeKey = null) {
        const b = Gibbets.body(player, bodyId);
        if (!b) return { success: false, reason: 'There is no such body in your hands.' };
        const opt = Gibbets.displayOptions(player, world, b).find(o => o.id === kindId);
        if (!opt || !opt.ok) return { success: false, reason: (opt && opt.why) || 'Not that way.' };
        const places = Gibbets.places(player, world, b);
        const place = places.find(p => p.key === placeKey) || places[0];
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        if (!s) return { success: false, reason: 'You hold no seat where it could be set up.' };
        const d = Gibbets.raise(world, s, {
            kind: kindId, name: b.name, gender: b.gender, rank: b.rank, rebel: b.rebel || b.traitor, crime: b.crime,
            by: { kind: 'player', id: player.name || 'you', name: player.name || 'you' }, kin: b.kin, house: b.house, victimKingdomId: b.kingdomId,
        }, player);
        if (kindId === 'spike') b.headless = true;
        Gibbets._dropBody(player, b);
        const st = Gibbets.state(player);
        st.stats.displayed++;
        const k = Gibbets.kind(kindId);
        const text = Gibbets.line('raised', { name: b.name, what: k.short || kindId, where: k.where || '', town: s.name || 'the town' }, `${d.id}`);
        Gibbets._log(player, world, text);
        return { success: true, text, display: d };
    },

    /** Give the body back to the kin for burial: their thanks, the feud eased. */
    returnBody(player, world, bodyId) {
        const b = Gibbets.body(player, bodyId);
        if (!b) return { success: false, reason: 'There is no such body in your hands.' };
        const R = Gibbets.config().returnBody;
        if (b.kin) {
            const f = PeopleCrimes.personAt(world, b.kin.q, b.kin.r, b.kin.pid);
            if (f.folk && f.p) NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: R.kinThanks || 'body_returned', player });
        }
        if (b.house && b.house.id != null) House.accrueRivalFeud(player, world, b.house.id, _num(R.rivalFeud, -15), `${b.name} given back`);
        if (b.great && b.kingdomId != null && R.lordDeed) { try { NPCLords.rememberRealm(world, b.kingdomId, R.lordDeed, { note: b.name }); } catch (e) { /* no lord */ } }
        Gibbets._dropBody(player, b);
        Gibbets.state(player).stats.returned++;
        const text = `${b.name} is given back to ${b.gender === 'female' ? 'her' : 'his'} own for burial.`;
        Gibbets._log(player, world, text);
        return { success: true, text };
    },

    /** Bury it quietly. */
    bury(player, world, bodyId) {
        const b = Gibbets.body(player, bodyId);
        if (!b) return { success: false, reason: 'There is no such body in your hands.' };
        Gibbets._dropBody(player, b);
        Gibbets.state(player).stats.buried++;
        return { success: true, text: `${b.name} goes into the ground outside the churchyard wall, unmarked.` };
    },

    _dropBody(player, b) {
        const st = Gibbets.state(player);
        st.bodies = st.bodies.filter(x => x !== b);
    },

    _log(player, world, text) {
        const st = Gibbets.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > 30) st.log.length = 30;
    },

    // ── Slain on the field, in the lists, hanged on the spot ──

    /**
     * An enemy commander slain where you beat a realm's host (player/fieldBattle.js).
     * o = { kingdomId, foe, strength, q, r }. Who he was is a hash roll: a captain, a knight,
     * a lord from a great host — and now and then the king himself (who dies: his heir succeeds).
     * → the body, or null.
     */
    onFieldSlain(player, world, o = {}) {
        if (!player || !world || !Gibbets.enabled()) return null;
        const F = Gibbets.config().field;
        const k = _kingdom(world, o.kingdomId);
        if (!k || k.isAlive === false) return null;
        const strength = _num(o.strength);
        if (strength < _num(F.minStrength, 30)) return null;
        const day = _day(world);
        const key = `field|${k.id}|${day}|${o.foe || ''}`;
        let rank = strength >= _num(F.lordAt, 90) ? 'lord' : strength >= 40 ? 'knight' : 'captain';
        let name;
        if (strength >= _num(F.kingAt, 250) && _roll(world, `${key}|king`) < _num(F.kingChance, 0.12) && k.lord) {
            rank = 'king';
            name = k.ruler || k.lord.name || `the King of ${Names.realm(k.name)}`;
            // The king is dead: the realm passes to his heir (who inherits the memory: world/npcLords.js)
            try { NPCLords.lordDies(k, world); } catch (e) { /* no succession */ }
            try { NPCLords.rememberRealm(world, k.id, 'kin_slain', { note: name }); } catch (e) { /* no lord */ }
            if (Array.isArray(world.events)) world.events.push({ text: `👑 ${name} of ${Names.realm(k.name)} has fallen in battle against ${player.name || 'an enemy'}.`, type: 'political', category: 'political', kingdom: k.id });
            if (player.house) House._chronicle(player.house, world, `${name}, ruler of ${Names.realm(k.name)}, fell in battle against ${player.name || 'the House'}.`, ['war', 'death']);
        } else {
            let base = 'Holt';
            try { base = Interrogation._powName(world, k.id, key); } catch (e) { /* plain name */ }
            name = `${{ lord: 'Lord', knight: 'Ser', captain: 'Captain' }[rank]} ${base}`;
        }
        const body = Gibbets.offerBody(player, world, {
            key, name, gender: 'male', rank: rank === 'knight' || rank === 'captain' ? 'commander' : rank, source: 'field',
            how: `slain in the field against ${o.foe || 'his host'}`, q: o.q != null ? o.q : player.q, r: o.r != null ? o.r : player.r, kingdomId: k.id,
        });
        if (body) Interrupts.raise(world, { reason: `${name} lies dead on the field: his body is yours`, icon: '💀', source: 'gibbets' });
        return body;
    },

    // ── The display ───────────────────────────────────────────

    /**
     * Put a display up in the town `s`. rec = { kind, name, gender, rank, rebel, crime, by
     * { kind: 'player'|'realm', id, name }, kin, house, victimKingdomId }. With a player (the
     * one who did it): the town's, the kin's, the House's, the realm's and the faith's
     * reckoning, and your dread. → the display.
     */
    raise(world, s, rec, player = null) {
        const C = Gibbets.config();
        const w = Gibbets.worldState(world);
        const day = _day(world);
        if (!Array.isArray(s.displays)) s.displays = [];
        const d = {
            id: `d${w.nextId++}`, kind: C.kinds[rec.kind] ? rec.kind : 'spike', day, name: rec.name || 'the dead', gender: rec.gender === 'female' ? 'female' : 'male',
            rank: rec.rank || 'commoner', rebel: !!rec.rebel, crime: rec.crime || null, by: rec.by || { kind: 'realm', id: s.kingdom, name: 'the crown' },
            kin: _obj(rec.kin) || null, house: _obj(rec.house) || null, victimKingdomId: rec.victimKingdomId != null ? rec.victimKingdomId : s.kingdom,
        };
        s.displays.push(d);
        // (a town keeps only so many: the oldest falls when more go up)
        const max = _num(C.maxPerTown, 8);
        if (s.displays.length > max) s.displays.splice(0, s.displays.length - max);
        const key = _key(s.q, s.r);
        if (s.q != null && !w.towns.includes(key)) w.towns.push(key);
        // The town sours at the sight
        const k = C.kinds[d.kind];
        if (typeof s.happiness === 'number') s.happiness = Math.max(_num(C.moodFloor, 15), _r1(s.happiness - _num(C.raisingMood, 3) * _num(k.mood, 1)));
        if (player) Gibbets._reckon(player, world, s, d);
        return d;
    },

    /** What putting the dead on show costs and buys the one who did it. */
    _reckon(player, world, s, d) {
        const C = Gibbets.config();
        const D = C.desecration;
        const F = C.fear;
        const k = C.kinds[d.kind] || {};
        const day = _day(world);
        const rw = Gibbets.rankWeight(d.rank);
        const des = _num(k.desecration, 1);
        const kid = s.kingdom;
        // The town remembers who hung it there
        NpcMemory.rememberTown(world, s, { kind: D.townKind || 'dead_displayed', player, victim: d.name });
        const g = { day, kind: 'desecration', display: d.id, how: d.kind, victim: d.name, rank: d.rank, by: d.by.kind === 'player' ? 'player' : `realm:${d.by.id}`, town: s.name, q: s.q, r: s.r, kingdomId: d.victimKingdomId, folk: null, house: null, faith: null };
        // The kin: a blood memory (the Nemesis reads it)
        if (d.kin) {
            const f = PeopleCrimes.personAt(world, d.kin.q, d.kin.r, d.kin.pid);
            if (f.folk && f.p) {
                const told = NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: D.kinKind || 'desecrated_dead', player });
                g.folk = { q: d.kin.q, r: d.kin.r, pid: d.kin.pid, told: Array.isArray(told) ? told.length : 0 };
            }
        }
        // His House
        if (d.house && d.house.id != null) {
            House.accrueRivalFeud(player, world, d.house.id, Math.round(_num(D.rivalFeud, 30) * des), `${d.name} left for the crows`);
            const rival = player.house && player.house.rivals ? player.house.rivals[d.house.id] : null;
            if (rival && D.rivalMemory) { try { RivalHouses.remember(rival, world, D.rivalMemory, String(d.name).split(' ')[0]); } catch (e) { /* no memory */ } }
            g.house = d.house.id;
        }
        // His realm's lord (a great man's): a vendetta deed
        if ((Gibbets.isGreat(d.rank) || d.rank === 'commander') && d.rank !== 'vassal') {
            if (d.victimKingdomId != null && D.lordDeed) {
                try { NPCLords.rememberRealm(world, d.victimKingdomId, D.lordDeed, { note: d.name, weight: -Math.round(Math.abs(_num((NPCLords.deedDef(D.lordDeed) || {}).weight, 28)) * des * Math.min(2, rw) / 1.6) }); } catch (e) { /* no lord */ }
            }
        }
        // His faith: the clergy think less of you
        const fid = MaimFaith.realmFaith(world, d.victimKingdomId != null ? d.victimKingdomId : kid);
        if (fid) {
            const stance = MaimFaith.stanceOfFaith(fid);
            const n = _num((D.faithStanding || {})[stance], 3) * des;
            if (n > 0) { try { Devotion._addStanding(player, fid, -n); } catch (e) { /* no devotion */ } }
            g.faith = fid;
        }
        // Your name: dread, renown; a court cowed by a traitor's or a rebel's head
        try { Traits.recordAggression(player, kid, { dread: _num(F.dread, 1.5) * _num(k.fear, 1) * rw, cruelty: _num(F.cruelty, 0.5) * des }); } catch (e) { /* no traits */ }
        player.renown = _num(player.renown) + Math.round(_num(F.renown, 2) * rw);
        if (d.rebel || d.rank === 'vassal') {
            try {
                const court = Kingship.court(player);
                if (court && Array.isArray(court.vassals)) for (const o of court.vassals) o.cowedUntil = Math.max(_num(o.cowedUntil), day + _num(F.courtCowedDays, 120));
            } catch (e) { /* no court */ }
        }
        try { Gossip.spreadDeed(player, world, 'execution', { q: s.q, r: s.r, location: s.name, kingdom: kid, victim: d.name }); } catch (e) { /* no gossip */ }
        if (player.house) House._chronicle(player.house, world, `By ${player.name || 'the House'}'s order the ${k.short || 'body'} of ${d.name} was set up ${k.where || ''} in ${s.name || 'the town'}.`.replace(/\s+/g, ' '), ['justice', 'cruelty']);
        Gibbets._grieve(world, g);
    },

    _grieve(world, g) {
        const w = Gibbets.worldState(world);
        w.grievances.unshift(g);
        const keep = _num(Gibbets.config().desecration.keep, 40);
        if (w.grievances.length > keep) w.grievances.length = keep;
    },

    /**
     * The desecrations on record, newest first — the hook a blood-feud system reads.
     * filter { by: 'player'|'realm:<id>', house, kingdomId, since (day) }.
     */
    grievances(world, filter = {}) {
        const w = world && world.gibbets;
        const list = w && Array.isArray(w.grievances) ? w.grievances : [];
        return list.filter(g => (filter.by == null || g.by === filter.by)
            && (filter.house == null || String(g.house) === String(filter.house))
            && (filter.kingdomId == null || String(g.kingdomId) === String(filter.kingdomId))
            && (filter.since == null || _num(g.day) >= filter.since));
    },

    /** The displays standing in the town at (q, r) on `day`, with their stage. */
    standingAt(world, q, r, day = _day(world)) {
        const s = _settlementAt(world, q, r);
        return DeadDisplays.standing(s, day).map(d => ({ ...d, stage: DeadDisplays.stage(d, day) }));
    },

    /** Every display standing in the world: [{ s, d, stage }]. */
    all(world, day = _day(world)) {
        const w = world && world.gibbets;
        if (!w || !Array.isArray(w.towns)) return [];
        const out = [];
        for (const key of w.towns) {
            const [q, r] = key.split(',').map(Number);
            const s = _settlementAt(world, q, r);
            for (const d of DeadDisplays.standing(s, day)) out.push({ s, d, stage: DeadDisplays.stage(d, day) });
        }
        return out;
    },

    /** How the dead on show cow the town's thieves: a multiplier on their chance (1 = none). Read by systems/npcTheft.js. */
    deterrence(s, day) {
        const up = DeadDisplays.standing(s, day);
        if (!up.length) return 1;
        const C = Gibbets.config();
        let m = 1;
        for (const d of up) {
            const k = C.kinds[d.kind] || {};
            const st = DeadDisplays.stage(d, day);
            m *= 1 - (1 - _num(k.crime, 0.7)) * Gibbets.stageWeight(st && st.id);
        }
        return Math.max(_num(C.crimeFloor, 0.3), Math.round(m * 1000) / 1000);
    },

    /** How afraid the commons of town `s` are of rising: the 'fear' taken off their grievance. Read by systems/peasantRevolts.js. */
    revoltDread(world, s, day = _day(world)) {
        const w = world && world.gibbets;
        if (!s || !w || !Array.isArray(w.towns) || !w.towns.length) return 0;
        const C = Gibbets.config();
        let v = 0;
        for (const key of w.towns) {
            const [q, r] = key.split(',').map(Number);
            const dist = _near({ q, r }, s);
            if (dist > _num(C.reach, 2)) continue;
            const t = q === s.q && r === s.r ? s : _settlementAt(world, q, r);
            const share = dist === 0 ? 1 : _num(C.neighbourShare, 0.4);
            for (const d of DeadDisplays.standing(t, day)) {
                const k = C.kinds[d.kind] || {};
                const st = DeadDisplays.stage(d, day);
                v += _num(k.revolt, 8) * Gibbets.stageWeight(st && st.id) * (d.rebel ? _num(C.rebelMult, 1.5) : 1) * share;
            }
        }
        return _r1(Math.min(_num(C.revoltCap, 30), v));
    },

    /** Take a display down (you stand in its town). → { success, text } */
    takeDown(player, world, q, r, id) {
        const s = _settlementAt(world, q, r);
        const d = s && Array.isArray(s.displays) ? s.displays.find(x => x.id === id && !x.down) : null;
        if (!d) return { success: false, reason: 'Nothing hangs there now.' };
        if (player.q !== q || player.r !== r) return { success: false, reason: `You must be in ${s.name || 'the town'}.` };
        const T = Gibbets.config().takeDown;
        const k = Gibbets.kind(d.kind) || {};
        let text;
        if (d.by.kind === 'player') {
            // Your own: a softening (the kin get the body back)
            if (d.kin) {
                const f = PeopleCrimes.personAt(world, d.kin.q, d.kin.r, d.kin.pid);
                if (f.folk && f.p && T.ownMollify) NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: T.ownMollify, player });
            }
            if (d.house && d.house.id != null) House.accrueRivalFeud(player, world, d.house.id, _num(T.ownRivalFeud, -10), `${d.name} taken down`);
            text = `On your word ${d.name} is taken down from the ${k.short || 'gibbet'} and given to the earth.`;
        } else {
            // Another lord's dead: a crime against his justice, a kindness to the kin
            try { Underworld.addHeat(player, s.kingdom, _num(T.foreignHeat, 6), world); } catch (e) { /* no heat */ }
            if (!player.reputation) player.reputation = {};
            if (s.kingdom != null) player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + _num(T.foreignReputation, -4);
            if (d.kin) {
                const f = PeopleCrimes.personAt(world, d.kin.q, d.kin.r, d.kin.pid);
                if (f.folk && f.p && T.kinThanks) NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: T.kinThanks, player });
            }
            const fid = MaimFaith.realmFaith(world, s.kingdom);
            if (fid && MaimFaith.stanceOfFaith(fid) === 'sacred') { try { Devotion._addStanding(player, fid, _num(T.sacredStanding, 3)); } catch (e) { /* none */ } }
            text = `You cut ${d.name} down from the ${k.short || 'gibbet'} and see ${_him(d.gender)} buried. The crown's men will not thank you for it; the priests and the poor will.`;
        }
        Gibbets._remove(world, s, d, 'you');
        Gibbets.state(player).stats.takenDown++;
        Gibbets._log(player, world, text);
        return { success: true, text };
    },

    _remove(world, s, d, by) {
        d.down = { day: _day(world), by };
        s.displays = s.displays.filter(x => x !== d);
        const w = Gibbets.worldState(world);
        w.log.unshift({ day: _day(world), town: s.name, name: d.name, kind: d.kind, by, put: d.by.kind === 'player' ? 'player' : 'realm', from: d.day });
        if (w.log.length > 40) w.log.length = 40;
        if (!s.displays.length) {
            delete s.displays;
            w.towns = w.towns.filter(k => k !== _key(s.q, s.r));
        }
    },

    /** How many living kin the dead has in his town (they may come for him in the night). */
    _kinCount(world, d) {
        if (!d.kin) return 0;
        const f = PeopleCrimes.personAt(world, d.kin.q, d.kin.r, d.kin.pid);
        return f.folk && f.p ? PeopleCrimes.kinOf(f.folk, f.p).length : 0;
    },

    /** The week's turn for the dead on show: the fallen, the town's temper, the kin and the faith at night. */
    _week(world, player, day, out) {
        const C = Gibbets.config();
        const w = Gibbets.worldState(world);
        for (const key of w.towns.slice()) {
            const [q, r] = key.split(',').map(Number);
            const s = _settlementAt(world, q, r);
            if (!s || !Array.isArray(s.displays) || !s.displays.length) { w.towns = w.towns.filter(k => k !== key); if (s) delete s.displays; continue; }
            if (s.q == null) { s.q = q; s.r = r; }
            for (const d of s.displays.slice()) {
                const st = DeadDisplays.stage(d, day);
                const mine = d.by && d.by.kind === 'player';
                const vars = { name: d.name, what: (Gibbets.kind(d.kind) || {}).short || 'gibbet', town: s.name || 'the town', him: _him(d.gender), lord: mine ? (player && player.name) || 'you' : (d.by && d.by.name) || 'the crown' };
                if (!st) {
                    Gibbets._remove(world, s, d, 'time');
                    if (mine && player) out.notices.push({ icon: '🦴', title: 'Fallen to Pieces', text: Gibbets.line('fell', vars, d.id), type: 'info' });
                    continue;
                }
                // The town sours while it stands
                const k = C.kinds[d.kind] || {};
                if (typeof s.happiness === 'number' && s.happiness > _num(C.moodFloor, 15)) {
                    s.happiness = Math.max(_num(C.moodFloor, 15), _r1(s.happiness - _num(C.moodPerWeek, 0.8) * _num(k.mood, 1) * Gibbets.stageWeight(st.id)));
                }
                const age = day - _num(d.day);
                // The kin come in the night
                const K = C.kinTakeDown;
                if (age >= _num(K.afterDays, 3)) {
                    const n = Gibbets._kinCount(world, d);
                    const p = Math.min(_num(K.max, 0.3), _num(K.base, 0.03) + n * _num(K.perKin, 0.025) + (d.house ? _num(K.house, 0.08) : 0));
                    if (_roll(world, `kin|${d.id}|${day}`) < p) {
                        Gibbets._remove(world, s, d, 'kin');
                        if (mine && player) out.notices.push({ icon: '🌙', title: 'Cut Down in the Night', text: Gibbets.line('kinTook', vars, d.id), type: 'warning' });
                        continue;
                    }
                }
                // The faith takes its dead back
                const fid = MaimFaith.realmFaith(world, s.kingdom);
                const stance = fid ? MaimFaith.stanceOfFaith(fid) : 'mild';
                const FT = C.faithTakeDown;
                if (age >= _num(FT.afterDays, 21) && _roll(world, `faith|${d.id}|${day}`) < _num(FT[stance], 0)) {
                    Gibbets._remove(world, s, d, 'faith');
                    if (mine && player) out.notices.push({ icon: '⛪', title: 'The Priests Take Their Dead', text: Gibbets.line('faithTook', vars, d.id), type: 'warning' });
                }
            }
        }
    },

    /** The realms' executed go up at their capitals (read off the scaffold's public list). */
    _aiDisplays(world, day) {
        const ex = world && world.executions;
        if (!ex || !Array.isArray(ex.public)) return;
        const A = Gibbets.config().ai;
        for (const e of ex.public) {
            if (!e || !e.resolved || e._gb || e.outcome !== 'executed') continue;
            e._gb = true;
            if (e.method === 'burn') continue;
            const crime = Executions.crimeDef(e.crime);
            const p = e.highborn ? _num(A.highborn, 0.75) : crime.treason ? _num(A.treason, 0.6) : _num(A.common, 0.12);
            if (_roll(world, `ai|${e.id}|${e.name}`) >= p) continue;
            const s = _settlementAt(world, e.q, e.r);
            if (!s) continue;
            if (s.q == null) { s.q = e.q; s.r = e.r; }
            const k = _kingdom(world, e.kingdomId);
            const kind = e.method === 'behead' || e.method === 'quarter' ? 'spike' : _roll(world, `aiKind|${e.id}`) < 0.5 ? 'gibbet' : 'gallows';
            Gibbets.raise(world, s, {
                kind, name: e.name, gender: e.gender, rank: e.highborn ? 'noble' : 'commoner', rebel: !!crime.treason, crime: e.crimeLabel,
                by: { kind: 'realm', id: e.kingdomId, name: k ? (k.ruler || `the crown of ${Names.realm(k.name)}`) : 'the crown' },
                kin: e.pid != null ? { q: e.q, r: e.r, pid: e.pid } : null, victimKingdomId: e.kingdomId,
            }, null);
        }
        void day;
    },

    // ── Trophies ──────────────────────────────────────────────

    /** The House's war trophies (heirlooms carrying item.trophy). */
    trophies(player) {
        return Heirlooms.list(player).filter(h => h && _obj(h.trophy));
    },

    /** Take a trophy off a great body: a skull cup, his banner, his sword. → { success, text, item } */
    takeTrophy(player, world, bodyId, kindId) {
        const b = Gibbets.body(player, bodyId);
        if (!b) return { success: false, reason: 'There is no such body in your hands.' };
        const opt = Gibbets.trophyOptions(player, world, b).find(o => o.id === kindId);
        if (!opt || !opt.ok) return { success: false, reason: (opt && opt.why) || 'Not that.' };
        const T = Gibbets.config().trophies;
        const tk = T.kinds[kindId] || {};
        const day = _day(world);
        const k = _kingdom(world, b.kingdomId);
        const realm = k ? Names.realm(k.name) : null;
        const mult = b.rank === 'king' ? _num(T.kingMult, 1.6) : 1;
        const nm = { skull_cup: `the Skull of ${b.name}`, trophy_banner: `the Banner of ${b.name}`, trophy_sword: `the Sword of ${b.name}` }[kindId] || `the ${tk.label || 'Trophy'} of ${b.name}`;
        const item = Heirlooms.create(player, world, { kind: kindId, origin: 'trophy', name: nm.charAt(0).toUpperCase() + nm.slice(1), text: `Taken from ${b.name}${realm ? ` of ${realm}` : ''}, ${b.how || 'slain'}, by ${player.name || 'the House'}` });
        if (!item) return { success: false, reason: 'You have no House to keep it.' };
        item.trophy = { kind: kindId, of: b.name, rank: b.rank, kingdomId: b.kingdomId, realm, house: b.house ? b.house.id : null, day, nextDemand: day + _num(T.demandFirstDays, 90), demand: null, refused: 0 };
        b.trophies = [...(b.trophies || []), kindId];
        if (tk.needsHead) b.headless = true;
        // Prestige at court; the heirs' hatred; the House's; the faith's disapproval; dread
        if (player.house) House.award(player.house, Math.round(_num(tk.prestige, 12) * mult), `${item.name} taken`, day);
        if (b.kingdomId != null) { try { NPCLords.rememberRealm(world, b.kingdomId, T.lordDeed || 'trophy_held', { note: b.name, weight: Math.round(_num(tk.lordWeight, -25) * mult) }); } catch (e) { /* no lord */ } }
        if (b.house && b.house.id != null) {
            House.accrueRivalFeud(player, world, b.house.id, 25, `${item.name} taken`);
            const rival = player.house && player.house.rivals ? player.house.rivals[b.house.id] : null;
            if (rival) { try { RivalHouses.remember(rival, world, 'trophyTaken', String(b.name).split(' ')[0]); } catch (e) { /* none */ } }
        }
        Gibbets._faithFrowns(player, world, b.kingdomId, _num(tk.faithStanding));
        try { Traits.recordAggression(player, b.kingdomId, { dread: Gibbets.rankWeight(b.rank) * (tk.needsHead ? 1.5 : 0.8) }); } catch (e) { /* no traits */ }
        Gibbets.state(player).stats.trophies++;
        const text = `${item.name} is yours: ${tk.desc || 'a trophy of the war'}`;
        Gibbets._log(player, world, `${item.name} taken.`);
        return { success: true, text, item };
    },

    /** Your own faith's clergy (else the realm's) frown on what you did with the dead. */
    _faithFrowns(player, world, kingdomId, n) {
        if (!(n > 0)) return;
        let fid = null;
        try { const c = MaimFaith.creed(player); fid = c && c.id !== 'own' ? c.id : null; } catch (e) { fid = null; }
        fid = fid || MaimFaith.realmFaith(world, kingdomId);
        if (fid) { try { Devotion._addStanding(player, fid, -n); } catch (e) { /* no devotion */ } }
    },

    /** The dread your trophies of a realm's dead put in its people: added to its towns' siege terms (Atrocities.termsShift). */
    trophyDread(player, kingdomId) {
        if (!player || !player.house || kingdomId == null) return 0;
        const T = Gibbets.config().trophies;
        let v = 0;
        for (const h of Gibbets.trophies(player)) {
            if (h.status !== 'held' || String(h.trophy.kingdomId) !== String(kingdomId)) continue;
            v += _num((T.kinds[h.trophy.kind] || {}).dread, 0.03) * (h.trophy.rank === 'king' ? _num(T.kingMult, 1.6) : 1);
        }
        return Math.min(_num(T.dreadMax, 0.12), Math.round(v * 1000) / 1000);
    },

    /** What his realm would pay to have it back (out of its treasury). */
    trophyPrice(world, h) {
        const T = Gibbets.config().trophies;
        const k = _kingdom(world, h && h.trophy && h.trophy.kingdomId);
        if (!k || k.isAlive === false) return 0;
        const base = _num(T.price[h.trophy.kind], 400) * (h.trophy.rank === 'king' ? _num(T.kingMult, 1.6) : 1);
        return Math.max(0, Math.floor(Math.min(base, _num(k.treasury) * _num(T.treasuryShare, 0.35))));
    },

    /** Are you at war with the trophy's realm (a peace term)? */
    _atWar(player, kingdomId) {
        try { const w = RealmWars._state(player).wars[kingdomId]; return !!(w && !w.civilWar); } catch (e) { return false; }
    },

    /**
     * Give it back. how: 'price' (their treasury pays), 'peace' (the war ends: a term of the
     * peace), 'gift' (for nothing: amends). → { success, text, paid }
     */
    returnTrophy(player, world, id, how = 'price') {
        const h = Heirlooms.get(player, id);
        if (!h || !_obj(h.trophy) || h.status !== 'held') return { success: false, reason: 'You hold no such trophy.' };
        const T = Gibbets.config().trophies;
        const kid = h.trophy.kingdomId;
        const k = _kingdom(world, kid);
        if (!k || k.isAlive === false) return { success: false, reason: 'There is no one left to give it back to.' };
        let paid = 0;
        if (how === 'price') {
            paid = h.trophy.demand ? Math.min(_num(h.trophy.demand.price), Gibbets.trophyPrice(world, h)) : Gibbets.trophyPrice(world, h);
            if (!(paid > 0)) return { success: false, reason: `${Names.realm(k.name)} has nothing in its treasury to pay.` };
            k.treasury = _num(k.treasury) - paid;
            player.gold = Utils.cents(_num(player.gold) + paid);
            try { Ledger.record(player, 'ransoms', paid); } catch (e) { /* no ledger */ }
        } else if (how === 'peace') {
            if (!Gibbets._atWar(player, kid)) return { success: false, reason: `You are not at war with ${Names.realm(k.name)}.` };
            try { RealmWars.endWar(player, world, kid, 'bought'); } catch (e) { return { success: false, reason: 'They will not treat.' }; }
        }
        try { NPCLords.rememberRealm(world, kid, T.returnedDeed || 'amends_made', { note: h.trophy.of }); } catch (e) { /* no lord */ }
        if (h.trophy.house != null) House.accrueRivalFeud(player, world, h.trophy.house, -20, `${h.name} given back`);
        Heirlooms.addLine(h, world, `Given back to ${Names.realm(k.name)}${how === 'price' ? ` for ${Utils.formatGold(paid)} gold` : how === 'peace' ? ' as a term of the peace' : ''}`, 0);
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The House'} gave ${h.name} back to ${Names.realm(k.name)}${how === 'peace' ? ', and there was peace' : ''}.`, ['heirloom', 'peace']);
        const st = Heirlooms.ensure(player);
        st.items = st.items.filter(x => x !== h);
        Gibbets.state(player).stats.trophiesReturned++;
        const text = how === 'price' ? `${h.name} goes home to ${Names.realm(k.name)}; their treasury pays ${Utils.formatGold(paid)} gold.`
            : how === 'peace' ? `${h.name} goes home to ${Names.realm(k.name)}, and with it the war ends.`
                : `${h.name} goes home to ${Names.realm(k.name)} for nothing. Their court will remember that.`;
        Gibbets._log(player, world, text);
        return { success: true, text, paid };
    },

    /** Send their envoys away: they remember. */
    refuseDemand(player, world, id) {
        const h = Heirlooms.get(player, id);
        if (!h || !_obj(h.trophy) || !h.trophy.demand) return { success: false, reason: 'No one asks for it now.' };
        Gibbets._refuse(player, world, h);
        return { success: true, text: `The envoys of ${h.trophy.realm || 'his realm'} go home empty-handed. They will not forget.` };
    },

    _refuse(player, world, h) {
        const T = Gibbets.config().trophies;
        h.trophy.demand = null;
        h.trophy.refused = _num(h.trophy.refused) + 1;
        if (h.trophy.kingdomId != null) { try { NPCLords.rememberRealm(world, h.trophy.kingdomId, T.lordDeed || 'trophy_held', { note: h.trophy.of, weight: _num(T.refuseWeight, -10) }); } catch (e) { /* no lord */ } }
        Gibbets.state(player).stats.refused++;
    },

    /** The trophies' days: demands, refusals unanswered, the faith's yearly frown, a theft by his realm's men. */
    _trophyDay(world, player, day, out) {
        const T = Gibbets.config().trophies;
        const Y = _dpy();
        for (const h of Gibbets.trophies(player)) {
            if (h.status !== 'held') continue;
            const t = h.trophy;
            const k = _kingdom(world, t.kingdomId);
            const alive = !!(k && k.isAlive !== false);
            // A demand unanswered a month is a refusal
            if (t.demand && day - _num(t.demand.day) > 30) Gibbets._refuse(player, world, h);
            if (alive && !t.demand && day >= _num(t.nextDemand)) {
                const price = Gibbets.trophyPrice(world, h);
                t.nextDemand = day + _num(T.demandEveryDays, 360);
                if (price > 0 || Gibbets._atWar(player, t.kingdomId)) {
                    t.demand = { day, price };
                    out.notices.push({ icon: '📜', title: 'They Want It Back', text: _fill(Gibbets.line('demand', {}, h.id), { realm: t.realm || Names.realm(k.name), item: h.name, price: Utils.formatGold(price) }) + ' (Intrigue & the Law → The Dead & Trophies)', type: 'info' });
                }
            }
            if (day > 0 && day % Y === 0) {
                // The heirs' hatred is renewed each year it is kept
                if (alive) { try { NPCLords.rememberRealm(world, t.kingdomId, T.lordDeed || 'trophy_held', { note: t.of, weight: -5 }); } catch (e) { /* no lord */ } }
                Gibbets._faithFrowns(player, world, t.kingdomId, _num((T.kinds[t.kind] || {}).faithYearly));
                // His realm's men may steal it back
                if (alive && _roll(world, `steal|${h.id}|${day}`) < _num(T.stealChance, 0.06)) {
                    const cap = k.capital ? _settlementAt(world, k.capital.q, k.capital.r) : null;
                    h.status = 'stolen';
                    h.holderId = null;
                    h.trail = { q: k.capital ? k.capital.q : null, r: k.capital ? k.capital.r : null, place: cap ? cap.name : Names.realm(k.name), holder: `the crown of ${Names.realm(k.name)}`, price: Gibbets.trophyPrice(world, h) * 2, since: day, how: 'stolen' };
                    Heirlooms.addLine(h, world, `Stolen back by agents of ${Names.realm(k.name)}`, 0);
                    out.notices.push({ icon: '🕵️', title: 'A Trophy Stolen Back', text: `Men of ${Names.realm(k.name)} have taken ${h.name} out of your hall. It is said to be in ${h.trail.place}.`, type: 'warning' });
                }
            }
        }
    },

    // ── The day's turn ────────────────────────────────────────

    /** → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Gibbets.enabled()) return out;
        const day = _day(world);
        Gibbets._aiDisplays(world, day);
        if (day % 7 === 0 && world.gibbets) Gibbets._week(world, player, day, out);
        if (player) {
            const fresh = Gibbets.collect(player, world);
            if (fresh.length) {
                const b = fresh[0];
                out.notices.push({ icon: '💀', title: 'The Body Is Yours', text: `${b.name}${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''}: set the head over the gate, hang the body at the crossroads, or give it back to the kin (Intrigue & the Law → The Dead & Trophies).`, type: 'info' });
            }
            if (player.gibbets) Gibbets.bodies(player, world);
            if (player.house && player.house.heirlooms) Gibbets._trophyDay(world, player, day, out);
        }
        return out;
    },
};
