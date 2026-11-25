// ============================================
// IMMUREMENT — walled up alive, and a castle haunted for generations
// ============================================
// No scaffold, no crowd: a door in the cellar, masons paid twice, a course of
// stones laid by lantern light.
//
//   WHO      one of the condemned awaiting your word (systems/executions.js)
//            whose crime is treason, heresy or the shame of the House, or your
//            own wife or husband (a 'disgraced' spouse: no court, no proof).
//   WHERE    a seat you rule (Executions.seats): its castle, keep or manor.
//   THE DEED is unseen: the victim vanishes (a townsperson dies 'vanished',
//            the kin are left with no word; a spouse is simply gone). Your own
//            name for cruelty and deceit, and karma, take it at once.
//   THE SECRET (player.immurement.secrets) keeps until the servants talk: a
//            weekly hash roll, likelier with your servants living in that house
//            and after a priest was asked to lay the ghost. Then the whole
//            weight falls: Atrocities 'immure' (the butcher's name, every
//            realm's regard, the lords' memory, the town's atrocity mark, the
//            chronicle, the news), the gossip, the kin's memory of a murder,
//            a spouse's House's grudge.
//   THE HAUNTING lives on the town (settlement.haunting; world.immurement.towns
//            lists them), fading by half every halfLifeYears: generations. While
//            it walks: your household's servants there lose heart and give
//            notice (player/household.js reads servantDread), guests come less
//            and leave unsettled (guestArrival, unsettles), the town sours a
//            little each month, and a night you spend there may bring an
//            apparition (your comfort and rest). A priest's rite quiets it; a
//            broken wall and a burial ends it, and tells the town.
//   THE REALMS a cruel or suspicious crown walls up a traitor at its capital
//            now and then: a haunting there, the servants' talk later (news).
//
// State: player.immurement (saved), world.immurement (saved), settlement.haunting
// (with the tile). Explicit params, no globals; every roll a hash of the world
// seed (no shared stream). Content and tuning: data/immurement.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { Townsfolk } from './townsfolk.js';
import { NpcMemory } from './npcMemory.js';
import { PeopleCrimes } from './peopleCrimes.js';
import { Traits } from './traits.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Relationships } from './relationships.js';
import { Atrocities } from './atrocities.js';
import { Gossip } from './gossip.js';
// (run time only: the condemned, and how they leave your hands)
import { Executions } from './executions.js';
import { Interrogation } from './interrogation.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _r2 = (v) => Math.round(v * 100) / 100;
const _he = (g) => (g === 'female' ? 'she' : 'he');

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
    return (_hash(`${_seed(world)}|immurement|${key}`) % 100000) / 100000;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && q != null ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _traits(k) {
    const t = k && k.lord && Array.isArray(k.lord.traits) ? k.lord.traits : [];
    return t.map(x => (x && x.id) || x).filter(Boolean);
}

const DEFAULTS = {
    enabled: true,
    crimeFlags: ['treason', 'heresy', 'disgrace'],
    walls: { capital: 'the castle', city: 'the castle', town: 'the keep', village: 'the manor house', hamlet: 'the manor house' },
    deed: { cruelty: 4, deceit: 2, karma: -10, spouseKarma: -12 },
    reveal: { afterDays: 14, perWeek: 0.04, perServant: 0.35, rite: 2, wronged: 0.02, max: 0.4 },
    haunt: { start: 1, wronged: 1.4, halfLifeYears: 50, endAt: 0.1, servantMood: 0.9, arrivalCut: 0.6, unsettle: 0.5, happiness: 0.6, happinessFloor: 20, apparition: 0.05, comfort: -18, energy: -10 },
    lay: { cost: 240, keep: 0.55, cooldown: 120 },
    breakWall: { cost: 60, karma: 3 },
    ai: { everyDays: 7, chance: 0.004, traits: ['cruel', 'paranoid'], reveal: 0.03, stability: -2, keep: 30 },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const Immurement = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.immurement : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS, ...d };
            for (const k of ['walls', 'deed', 'reveal', 'haunt', 'lay', 'breakWall', 'ai']) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            out.crimeFlags = Array.isArray(d.crimeFlags) ? d.crimeFlags : DEFAULTS.crimeFlags;
            out.lines = _obj(d.lines) || {};
            _cfg = out;
        }
        return _cfg;
    },

    enabled() { return Immurement.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = Immurement.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    /** "the castle", "the keep", "the manor house" — by the town's size. */
    wallsOf(s) {
        const W = Immurement.config().walls;
        return W[(s && s.type) || 'town'] || 'the keep';
    },

    // ── State ─────────────────────────────────────────────────

    state(player) {
        if (!player) return null;
        if (!_obj(player.immurement)) player.immurement = { v: 1, secrets: [], log: [], stats: { walled: 0, revealed: 0, laid: 0, broken: 0 } };
        const st = player.immurement;
        if (!Array.isArray(st.secrets)) st.secrets = [];
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { walled: 0, revealed: 0, laid: 0, broken: 0, ...(_obj(st.stats) || {}) };
        return st;
    },

    worldState(world) {
        if (!world) return null;
        if (!_obj(world.immurement)) world.immurement = { nextId: 1, towns: [], log: [] };
        const w = world.immurement;
        if (!(w.nextId > 0)) w.nextId = 1;
        if (!Array.isArray(w.towns)) w.towns = [];
        if (!Array.isArray(w.log)) w.log = [];
        return w;
    },

    serialize(world) {
        return world && _obj(world.immurement) ? JSON.parse(JSON.stringify(world.immurement)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.immurement = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : undefined;
        if (world.immurement) Immurement.worldState(world);
    },

    _log(player, world, text) {
        const st = Immurement.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > 20) st.log.length = 20;
    },

    // ── Who, and where ────────────────────────────────────────

    /** Those you could wall up: [{ kind: 'condemned'|'spouse', id, name, desc, icon, guilty }]. */
    targets(player, world) {
        const out = [];
        if (!player || !Immurement.enabled()) return out;
        const C = Immurement.config();
        let list = [];
        try { list = Executions.list(player); } catch (e) { list = []; }
        for (const e of list) {
            const crime = Executions.crimeDef(e.crime);
            if (!C.crimeFlags.some(f => crime[f])) continue;
            out.push({ kind: 'condemned', id: e.id, name: e.name, icon: '⛓️', desc: `Condemned for ${e.crimeLabel}`, guilty: e.guilty, gender: e.gender });
        }
        const sp = Immurement._spouse(player);
        if (sp) out.push({ kind: 'spouse', id: sp.id, name: `${sp.firstName || sp.name || 'your spouse'}`, icon: '💍', desc: `Your ${sp.gender === 'female' ? 'wife' : 'husband'}: no court has judged ${sp.gender === 'female' ? 'her' : 'him'}`, guilty: null, gender: sp.gender === 'female' ? 'female' : 'male' });
        return out;
    },

    _spouse(player) {
        if (!player || player.spouse == null) return null;
        let npc = null;
        try { npc = Relationships.getNPC(player.spouse); } catch (e) { npc = null; }
        return npc && npc.isAlive !== false ? npc : null;
    },

    /** The seats with walls you rule: [{ key, q, r, name, walls, here }]. */
    seats(player, world) {
        let seats = [];
        try { seats = Executions.seats(player, world); } catch (e) { seats = []; }
        return seats.map(s => ({ key: s.key, q: s.q, r: s.r, name: s.name, kingdomId: s.kingdomId, walls: Immurement.wallsOf(s.settlement), here: player.q === s.q && player.r === s.r }))
            .sort((a, b) => b.here - a.here);
    },

    // ── The deed ──────────────────────────────────────────────

    /**
     * Wall someone up alive. kind 'condemned' (id: the scaffold's entry) or 'spouse'. seatKey:
     * one of seats(); you must be there. → { success, text, secret }
     */
    wallUp(player, world, kind, id, seatKey = null) {
        if (!player || !world || !Immurement.enabled()) return { success: false, reason: 'It cannot be done.' };
        const C = Immurement.config();
        const t = Immurement.targets(player, world).find(x => x.kind === kind && String(x.id) === String(id));
        if (!t) return { success: false, reason: 'No one by that name is in your power for it.' };
        const seats = Immurement.seats(player, world);
        const seat = seats.find(s => s.key === seatKey) || seats.find(s => s.here) || null;
        if (!seat) return { success: false, reason: seats.length ? 'You must be at one of your seats to see to it yourself.' : 'You hold no castle or manor of your own.' };
        if (!seat.here) return { success: false, reason: `You must be at ${seat.name} to see to it yourself.` };
        const s = _settlementAt(world, seat.q, seat.r);
        if (!s) return { success: false, reason: 'There is no house there.' };
        const day = _day(world);
        const st = Immurement.state(player);
        let name = t.name;
        let gender = t.gender || 'male';
        let kin = null, kingdomId = seat.kingdomId, house = null, crimeLabel = 'the shame of the House', guilty = t.guilty;
        if (kind === 'spouse') {
            const npc = Immurement._spouse(player);
            if (!npc) return { success: false, reason: 'They are not to be had.' };
            name = `${npc.firstName || npc.name}${npc.lastName ? ` ${npc.lastName}` : ''}`;
            gender = npc.gender === 'female' ? 'female' : 'male';
            npc.isAlive = false;
            npc.deathDay = day;
            npc.deathCause = 'vanished';
            try { if (Relationships.isInTravelParty(player, npc.id)) Relationships.removeFromTravelParty(player, npc.id); } catch (e) { /* no party */ }
            player.spouse = null;
            player.marriageDay = null;
            house = player.marriageAllianceKingdom != null ? { kingdomId: player.marriageAllianceKingdom } : null;
            player.karma = _num(player.karma) + _num(C.deed.spouseKarma);
        } else {
            const e = Executions.get(player, id);
            if (!e) return { success: false, reason: 'They are no longer in your hands.' };
            const res = Executions._resolve(player, world, e);
            if (!res.ok) { Executions._drop(player, e); return { success: false, reason: `${e.name} is gone from your hands.` }; }
            crimeLabel = e.crimeLabel;
            // (a day was proclaimed: the scaffold comes down unused)
            if (e.proclaimed) { try { Executions._lower(world, e.proclaimed.place, 'p' + e.id); } catch (err) { /* no scaffold */ } }
            kingdomId = e.kingdomId != null ? e.kingdomId : kingdomId;
            if (e.kind === 'folk' || e.kind === 'captive') {
                const { folk, p } = res;
                kin = { q: res.s ? res.s.q : (e.ref && e.ref.q), r: res.s ? res.s.r : (e.ref && e.ref.r), pid: p.id };
                try { NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'no_word', player }); } catch (err) { /* no memory */ }
                Townsfolk.slay(folk, p, day, 'vanished', world);
                if (e.kind === 'captive') { const pst = PeopleCrimes.state(player); pst.captives = pst.captives.filter(x => x !== res.c); }
            } else {
                // (a lord of your court, a rival's child, an outlaw, another's prisoner: gone the way the scaffold's dead go, without the crowd)
                try { Executions._deathOf(player, world, e, res, { memory: 'no_word', cause: 'vanished' }, { q: seat.q, r: seat.r, name: seat.name, kingdomId: seat.kingdomId }, { size: 0, mood: { id: 'quiet' } }); } catch (err) { /* gone */ }
                if (e.kind === 'rival' && res.rival) house = { rivalId: res.rival.kingdomId };
            }
            Executions._record(player, world, e, { outcome: 'immured', place: { q: seat.q, r: seat.r, name: seat.name, kingdomId: seat.kingdomId }, text: `${e.name} was walled up alive at ${seat.name}.` });
            player.karma = _num(player.karma) + _num(C.deed.karma);
        }
        try { Traits.recordDeeds(player, { cruelty: _num(C.deed.cruelty), deceit: _num(C.deed.deceit) }); } catch (e) { /* no traits */ }
        // The haunting begins
        const h = Immurement.haunt(world, s, { name, gender, crime: crimeLabel, wronged: guilty === false || kind === 'spouse', by: { kind: 'player', name: player.name || 'the lord' } });
        const secret = { id: h.id, name, gender, kind, town: s.name || seat.name, q: seat.q, r: seat.r, day, kingdomId, guilty, kin, house, revealed: false, rite: 0 };
        st.secrets.push(secret);
        st.stats.walled++;
        const vars = { name, town: s.name || seat.name, walls: Immurement.wallsOf(s), he: _he(gender) };
        const text = Immurement.line(kind === 'spouse' ? 'spouse' : 'deed', vars, `${h.id}`) || `${name} is walled up alive in ${vars.walls} at ${vars.town}.`;
        Immurement._log(player, world, `${name} walled up at ${vars.town}.`);
        return { success: true, text, secret, haunting: h };
    },

    /** Raise a haunting on a town (a soul in its walls). rec { name, gender, crime, wronged, by }. → the haunting. */
    haunt(world, s, rec = {}) {
        const C = Immurement.config();
        const w = Immurement.worldState(world);
        if (!Array.isArray(s.haunting)) s.haunting = [];
        const h = {
            id: `h${w.nextId++}`, name: rec.name || 'someone', gender: rec.gender === 'female' ? 'female' : 'male', crime: rec.crime || null,
            day: _day(world), by: rec.by || { kind: 'realm', name: 'the crown' }, wronged: !!rec.wronged,
            strength: _r2(_num(C.haunt.start, 1) * (rec.wronged ? _num(C.haunt.wronged, 1.4) : 1)), known: rec.by && rec.by.kind === 'player' ? false : !!rec.known,
        };
        if (rec.kingdomId != null) h.kingdomId = rec.kingdomId;
        s.haunting.push(h);
        const key = _key(s.q, s.r);
        if (s.q != null && !w.towns.includes(key)) w.towns.push(key);
        return h;
    },

    // ── Readers ───────────────────────────────────────────────

    /** The town's ghosts still walking. */
    ghosts(s) {
        return s && Array.isArray(s.haunting) ? s.haunting.filter(h => h && _num(h.strength) > 0) : [];
    },

    /** How haunted the town is (the sum of its ghosts' strength, capped at 2). */
    strengthOf(s) {
        return Math.min(2, Immurement.ghosts(s).reduce((a, h) => a + _num(h.strength), 0));
    },

    /** Mood a day lost by the servants of a house in this town (≤ 0). player/household.js. */
    servantDread(s) {
        const k = Immurement.strengthOf(s);
        return k > 0 ? -_r2(_num(Immurement.config().haunt.servantMood) * k) : 0;
    },

    /** Guests come this much less often (x, 0..1). player/household.js. */
    guestArrival(s) {
        const k = Immurement.strengthOf(s);
        return k > 0 ? Math.max(0.1, 1 - _num(Immurement.config().haunt.arrivalCut) * Math.min(1, k)) : 1;
    },

    /** Does a guest's stay end badly (a night they would not repeat)? key: the guest. player/household.js. */
    unsettles(world, s, key) {
        const k = Immurement.strengthOf(s);
        if (!(k > 0)) return false;
        return _roll(world, `guest|${key}|${_day(world)}`) < Math.min(0.9, _num(Immurement.config().haunt.unsettle) * k);
    },

    /** Every haunting in the world: [{ s, h }]. */
    all(world) {
        const w = world && world.immurement;
        if (!w || !Array.isArray(w.towns)) return [];
        const out = [];
        for (const key of w.towns) {
            const [q, r] = key.split(',').map(Number);
            const s = _settlementAt(world, q, r);
            for (const h of Immurement.ghosts(s)) out.push({ s, h });
        }
        return out;
    },

    /** Your secrets, and the ghosts in your seats. */
    mine(player, world) {
        const st = player && player.immurement ? Immurement.state(player) : null;
        const name = player ? player.name || 'the lord' : null;
        const ghosts = Immurement.all(world).filter(x => x.h.by && x.h.by.kind === 'player' && x.h.by.name === name);
        return { secrets: st ? st.secrets : [], ghosts };
    },

    // ── Laying the ghost ──────────────────────────────────────

    _find(world, id) {
        return Immurement.all(world).find(x => x.h.id === id) || null;
    },

    /** A priest's rite at the haunted house (you must be in the town): quieter, and the priest asks whose ghost. */
    layGhost(player, world, id) {
        const x = Immurement._find(world, id);
        if (!x) return { success: false, reason: 'Nothing walks there now.' };
        if (player.q !== x.s.q || player.r !== x.s.r) return { success: false, reason: `You must be at ${x.s.name} to have the rite said.` };
        const L = Immurement.config().lay;
        const day = _day(world);
        if (day - _num(x.h.laidDay, -9999) < _num(L.cooldown, 120)) return { success: false, reason: 'The priest said the rite not long ago.' };
        const cost = Math.round(_num(L.cost, 240));
        if (_num(player.gold) < cost) return { success: false, reason: `The priest's fee and the candles come to ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'charity', -cost);
        // (into the town's purse: the priest, the chandler, the poor-box)
        Economy.payTown(x.s, cost);
        x.h.strength = _r2(_num(x.h.strength) * _num(L.keep, 0.55));
        x.h.laidDay = day;
        const sec = Immurement.state(player).secrets.find(z => z.id === x.h.id && !z.revealed);
        if (sec) sec.rite = _num(sec.rite) + 1;
        Immurement.state(player).stats.laid++;
        const text = Immurement.line('laid', { town: x.s.name || 'the town' }, `${x.h.id}|${day}`);
        Immurement._log(player, world, text);
        return { success: true, text, cost };
    },

    /** Break open the wall and bury the bones: the haunting ends, and the deed is out. */
    breakWall(player, world, id) {
        const x = Immurement._find(world, id);
        if (!x) return { success: false, reason: 'Nothing walks there now.' };
        if (player.q !== x.s.q || player.r !== x.s.r) return { success: false, reason: `You must be at ${x.s.name} to have the wall opened.` };
        const B = Immurement.config().breakWall;
        const cost = Math.round(_num(B.cost, 60));
        if (_num(player.gold) < cost) return { success: false, reason: `The masons want ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'construction', -cost);
        Economy.payTown(x.s, cost);
        x.s.haunting = (x.s.haunting || []).filter(h => h !== x.h);
        player.karma = _num(player.karma) + _num(B.karma, 3);
        const st = Immurement.state(player);
        st.stats.broken++;
        const sec = st.secrets.find(z => z.id === x.h.id);
        const out = { notices: [] };
        if (sec && !sec.revealed) Immurement._reveal(player, world, sec, out, 'broken');
        const text = Immurement.line('broken', { town: x.s.name || 'the town' }, x.h.id);
        Immurement._log(player, world, text);
        return { success: true, text: `${text}${out.notices.length ? ` ${out.notices.map(n => n.text).join(' ')}` : ''}`, cost };
    },

    // ── The servants talk ─────────────────────────────────────

    _reveal(player, world, sec, out, how = 'talk') {
        sec.revealed = true;
        sec.revealedDay = _day(world);
        const s = _settlementAt(world, sec.q, sec.r);
        const st = Immurement.state(player);
        st.stats.revealed++;
        try { Atrocities._brand(player, world, 'immure', s, { kingdomId: sec.kingdomId }); } catch (e) { /* no brand */ }
        try { Gossip.spreadDeed(player, world, 'immured', { q: sec.q, r: sec.r, location: s ? s.name : sec.town, kingdom: sec.kingdomId, victim: sec.name }); } catch (e) { /* no gossip */ }
        // The kin learn it was murder
        if (sec.kin) {
            const f = PeopleCrimes.personAt(world, sec.kin.q, sec.kin.r, sec.kin.pid);
            if (f.folk && f.p) { try { NpcMemory.rememberKin(world, { folk: f.folk, person: f.p }, { kind: 'murdered', player }); } catch (e) { /* no memory */ } }
        }
        // A spouse's House, a rival's House
        if (sec.house && sec.house.kingdomId != null) { try { NPCLords.rememberRealm(world, sec.house.kingdomId, 'kin_slain', { note: sec.name }); } catch (e) { /* no lord */ } }
        if (sec.house && sec.house.rivalId != null) { try { House.accrueRivalFeud(player, world, sec.house.rivalId, 80, `${sec.name} walled up alive`); } catch (e) { /* no feud */ } }
        if (s) for (const h of Immurement.ghosts(s)) if (h.id === sec.id) h.known = true;
        if (how === 'talk') {
            const text = Immurement.line('reveal', { town: sec.town, name: sec.name }, sec.id) || `The servants of ${sec.town} talk.`;
            out.notices.push({ icon: '🧱', title: 'The Servants Talk', text, type: 'error' });
        }
    },

    _servantsAt(player, q, r) {
        const homes = player && player.household && _obj(player.household.homes);
        if (!homes) return 0;
        let n = 0;
        for (const h of Object.values(homes)) if (h && h.q === q && h.r === r && Array.isArray(h.servants)) n += h.servants.length;
        return n;
    },

    _secretsWeek(player, world, day, out) {
        const R = Immurement.config().reveal;
        for (const sec of Immurement.state(player).secrets) {
            if (sec.revealed || day - _num(sec.day) < _num(R.afterDays, 14)) continue;
            let p = _num(R.perWeek, 0.04) * (1 + Immurement._servantsAt(player, sec.q, sec.r) * _num(R.perServant, 0.35)) * (1 + _num(sec.rite) * _num(R.rite, 2));
            if (sec.guilty === false || sec.kind === 'spouse') p += _num(R.wronged, 0.02);
            if (_roll(world, `reveal|${sec.id}|${day}`) < Math.min(_num(R.max, 0.4), p)) Immurement._reveal(player, world, sec, out);
        }
    },

    // ── The haunting, week by week ────────────────────────────

    _hauntWeek(world, player, day, out) {
        const C = Immurement.config();
        const H = C.haunt;
        const w = Immurement.worldState(world);
        const Y = 120;
        const decay = Math.pow(0.5, 7 / (Math.max(1, _num(H.halfLifeYears, 50)) * Y));
        const keep = [];
        for (const key of w.towns) {
            const [q, r] = key.split(',').map(Number);
            const s = _settlementAt(world, q, r);
            if (!s || !Array.isArray(s.haunting)) continue;
            for (const h of s.haunting) h.strength = Math.round(Math.max(0, _num(h.strength) * decay) * 10000) / 10000;
            const faded = s.haunting.filter(h => _num(h.strength) < _num(H.endAt, 0.1));
            s.haunting = s.haunting.filter(h => _num(h.strength) >= _num(H.endAt, 0.1));
            if (faded.length && player && player.q === q && player.r === r) {
                const text = Immurement.line('faded', { town: s.name || 'the town', walls: Immurement.wallsOf(s) }, faded[0].id);
                if (text) out.notices.push({ icon: '🕯️', title: 'The House Is Quiet', text, type: 'info' });
            }
            if (!s.haunting.length) { delete s.haunting; continue; }
            keep.push(key);
            // The town sours a little, monthly (every fourth week)
            if (((day / 7) | 0) % 4 === 0 && typeof s.happiness === 'number') {
                s.happiness = Math.max(_num(H.happinessFloor, 20), _r2(s.happiness - _num(H.happiness) * Immurement.strengthOf(s)));
            }
        }
        w.towns = keep;
    },

    /** The night: a ghost seen where you sleep; a haunting first heard of. */
    _night(world, player, day, out) {
        const s = _settlementAt(world, player.q, player.r);
        const ghosts = Immurement.ghosts(s);
        if (!ghosts.length) return;
        const H = Immurement.config().haunt;
        const name = player.name || 'the lord';
        // First heard of: a ghost not of your making, its tale known in town
        for (const h of ghosts) {
            if (h.heard || !(h.known || (h.by && h.by.kind === 'player' && h.by.name === name))) continue;
            h.heard = true;
            if (h.by && h.by.kind === 'player' && h.by.name === name) continue;
            const text = Immurement.line('heard', { town: s.name || 'the town', walls: Immurement.wallsOf(s), by: (h.by && h.by.name) || 'a lord long dead' }, h.id);
            if (text) out.notices.push({ icon: '👻', title: 'A Haunted House', text, type: 'info' });
        }
        // A seat of yours, slept in: the apparition
        let seats = [];
        try { seats = Executions.seats(player, world); } catch (e) { seats = []; }
        if (!seats.some(x => x.q === player.q && x.r === player.r)) return;
        const k = Immurement.strengthOf(s);
        if (_roll(world, `night|${player.q},${player.r}|${day}`) >= _num(H.apparition, 0.05) * k) return;
        if (typeof player.modifyNeed === 'function') {
            player.modifyNeed('comfort', _num(H.comfort, -18));
            player.modifyNeed('energy', _num(H.energy, -10));
        }
        const text = Immurement.line('apparition', { town: s.name || 'the town' }, `${day}`);
        if (text) out.notices.push({ icon: '👻', title: 'In the Night', text, type: 'warning' });
    },

    /** A cruel or suspicious crown walls up a traitor at its capital now and then; the talk follows later. */
    _aiWeek(world, day, out) {
        const A = Immurement.config().ai;
        const w = Immurement.worldState(world);
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false || !k.capital) continue;
            const tr = _traits(k);
            if (!(A.traits || []).some(t => tr.includes(t))) continue;
            if (_roll(world, `ai|${k.id}|${day}`) >= _num(A.chance, 0.004)) continue;
            const s = _settlementAt(world, k.capital.q, k.capital.r);
            if (!s) continue;
            if (s.q == null) { s.q = k.capital.q; s.r = k.capital.r; }
            let name = 'a traitor';
            try { name = Interrogation._powName(world, k.id, `immure|${k.id}|${day}`); } catch (e) { /* plain */ }
            const ruler = k.ruler || (k.lord && k.lord.name) || 'the crown';
            const h = Immurement.haunt(world, s, { name, gender: 'male', crime: 'treason', by: { kind: 'realm', id: k.id, name: ruler }, kingdomId: k.id });
            h.known = false;
            w.log.unshift({ day, kingdomId: k.id, town: s.name || null, name, id: h.id, revealed: false });
            if (w.log.length > _num(A.keep, 30)) w.log.length = _num(A.keep, 30);
        }
        // The servants of the realms' castles talk
        for (const e of w.log) {
            if (e.revealed || day - _num(e.day) < 14) continue;
            if (_roll(world, `aiReveal|${e.id}|${day}`) >= _num(A.reveal, 0.03)) continue;
            e.revealed = true;
            const k = (world.kingdoms || []).find(x => x && x.id === e.kingdomId);
            const x = Immurement._find(world, e.id);
            if (x) x.h.known = true;
            if (k) k.stability = Math.max(0, _num(k.stability, 50) + _num(A.stability, -2));
            const text = Immurement.line('aiReveal', { town: e.town || 'the capital', walls: x ? Immurement.wallsOf(x.s) : 'the castle', ruler: k ? (k.ruler || 'the crown') : 'the crown', name: e.name, realm: k ? Names.realm(k.name) : '' }, e.id);
            if (text && Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: e.kingdomId });
        }
        void out;
    },

    /** Daily: the night; weekly: the secrets, the hauntings fade and sour, the realms' walls. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Immurement.enabled()) return out;
        const day = _day(world);
        if (player && typeof player.q === 'number') Immurement._night(world, player, day, out);
        if (day > 0 && day % 7 === 0) {
            if (player && player.immurement) Immurement._secretsWeek(player, world, day, out);
            Immurement._hauntWeek(world, player, day, out);
            Immurement._aiWeek(world, day, out);
        }
        return out;
    },
};
