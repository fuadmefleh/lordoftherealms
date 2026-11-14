// ============================================
// HOUSEHOLD — the player's own house, lived in
// ============================================
// A home the player owns (a house of player.houses, or any home they furnish:
// world/innerMap/furnishing.js furnishHomeKey is the key) can be lived in:
//
//   ROOMS     corners of the house marked as hall, bedchamber, kitchen,
//             larder, study, chapel or nursery while standing in them
//             (the inner map surveys the furniture within reach of the
//             mark: world/innerMap/household.js). Each room's furniture,
//             by type and by worth (data/furniture.json prices), sets its
//             quality 0..1, and the quality its effect: sleep, supper,
//             study, prayer, the larder's room, the nursery, the hall's
//             display pieces.
//   DISPLAYS  heirlooms of the House (systems/heirlooms.js) and trophies
//             earned (house.stats, hunts, tourneys) set out in the hall,
//             one to each display piece (rack, statue, banner) there.
//             Guests remark on them: Prestige, renown, a line in an
//             heirloom's legend.
//   SERVANTS  a cook, maids, a house steward, a nurse: real townsfolk of
//             the home town (settlement.folk) where it has a roster. Paid
//             a daily wage from the purse into their own pockets, which
//             they spend in the home town's market (Economy.payTown). Their
//             mood moves with pay, food, work and the master's word; low
//             for days, they quit. They walk the house (the inner map).
//   GUESTS    kin, courtiers and the envoys of rival Houses come to stay a
//             night or three while the player is home with a hall. Well
//             fed in a clean house they leave pleased (opinion, feud,
//             Prestige); from a bare larder, insulted.
//   LARDER    food goods (player/core/needs.js MEAL_HUNGER) stocked from
//             the packs or bought at the home town's market (its stock and
//             purse), eaten by every mouth in the house each day, spoiling
//             slowly. A steward restocks it within an allowance.
//
// State: player.household = { v, seq, homes: { key: home } } (saved:
// systems/saveLoad.js EXTRA_PLAYER_FIELDS). Daily: Household.processDay
// from ui/game/endDay.js. Tuning: data/household.json. Randomness: its own
// seeded streams (world seed × day × tag), never the shared one.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { MEAL_HUNGER } from './core/needs.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Ledger } from '../systems/ledger.js';
import { House } from '../systems/house.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Court } from '../systems/court.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Devotion } from '../systems/devotion.js';
import { Upbringing } from '../systems/upbringing.js';
import { OddJobs } from './oddJobs.js';
import { Trading } from './playerEconomy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = v => Math.round(v * 100) / 100;
const _day = world => _num(world && world.day);

const DEFAULTS = {
    roomRadius: 3, maxRooms: 8, rooms: {}, effects: {}, servants: {}, hire: {}, mood: {},
    cleanliness: {}, larder: {}, guests: { kinds: {} }, displayTypes: ['rack', 'statue', 'banner'],
    trophies: [], remarks: ['{guest} admires {thing}.'], bareLines: ['{guest} left hungry.'],
    names: { male: ['Wat'], female: ['Joan'], last: ['Wood'] },
};

// Foods that keep: they never spoil in the larder
const KEEPS = new Set(['grain', 'preserved_fish', 'honey', 'beans', 'olives', 'dates']);

function _rng(world, tag) {
    const seed = (world && world.generationParams && world.generationParams.seed) || (world && world.seed) || 1;
    let s = (Utils.hashStr(`${seed}|household|${_day(world)}|${tag}`) >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function _pick(arr, rnd) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(rnd() * arr.length) % arr.length] : null;
}

function _fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}

function _get(obj, path) {
    return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export const Household = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.household);
        return {
            ...DEFAULTS, ...d,
            effects: { sleepBonus: 0.4, homeRestEnergy: 8, kitchenHunger: 12, kitchenComfort: 6, kitchenStretch: 0.25, studyXp: 0.6, chapelFaith: 0.01, chapelStanding: 0.3, chapelFaithCap: 3, nurseryHealth: 1, nurseryXp: 0.012, ..._obj(d.effects) },
            hire: { minAge: 16, maxAge: 58, candidates: 4, skillRange: [1, 5], wagePerSkill: 0.25, ..._obj(d.hire) },
            mood: { start: 70, paid: 0.6, unpaid: -12, fed: 0.3, hungry: -8, overworked: -1.2, goodRoom: 0.4, raise: 15, praise: 6, praiseEvery: 10, quitBelow: 20, quitDays: 3, warnBelow: 35, max: 100, ..._obj(d.mood) },
            cleanliness: { decayPerRoom: 1.2, decayBase: 2, maidRestores: 9, dirtyBelow: 40, comfortPerHour: 0.15, ..._obj(d.cleanliness) },
            larder: { baseCapacity: 30, perLarderQuality: 90, ration: 35, spoilPerDay: 0.02, larderSpoilCut: 0.75, stewardTarget: 20, stewardAllowance: 40, bareStrikes: 2, ..._obj(d.larder) },
            guests: { chancePerDay: 0.12, maxAtOnce: 3, stay: [1, 3], needHall: true, kinds: {}, welcomePrestige: 1, remarkPrestige: 2, remarkRenown: 1, remarkCapPerYear: 24, envoyFeudCut: 2, kinOpinion: 3, badStayPrestige: -2, badStayOpinion: -4, ..._obj(d.guests) },
            names: { ...DEFAULTS.names, ..._obj(d.names) },
        };
    },

    ROOM_KINDS: ['hall', 'bedchamber', 'kitchen', 'larder', 'study', 'chapel', 'nursery'],
    ROLES: ['cook', 'maid', 'steward', 'nurse'],

    roomDef(kind) { return _obj(Household.config().rooms)[kind] || null; },
    roleDef(role) { return _obj(Household.config().servants)[role] || null; },

    // ── State ─────────────────────────────────────────────

    ensure(player) {
        if (!player) return null;
        let st = player.household;
        if (!st || typeof st !== 'object' || !st.homes || typeof st.homes !== 'object') {
            st = player.household = { v: 1, seq: 0, homes: {} };
        }
        return st;
    },

    /** The key of a house of player.houses (as world/innerMap/furnishing.js keys it). */
    houseKey(h) { return h ? `house:${h.q},${h.r}` : null; },

    /** The world hex of a home key ("house:12,7", "lot:12,7:L3" …), or null. */
    keyAt(key) {
        const m = /^[a-z]+:(-?\d+),(-?\d+)/.exec(String(key || ''));
        return m ? { q: Number(m[1]), r: Number(m[2]) } : null;
    },

    _blankHome(key, info = {}) {
        const at = Household.keyAt(key) || {};
        return {
            key, name: info.name || 'Your House', town: info.town || null,
            q: info.q != null ? info.q : at.q, r: info.r != null ? info.r : at.r,
            rooms: [], servants: [], guests: [], larder: {}, displays: [],
            clean: 80, bareDays: 0, allowance: Household.config().larder.stewardAllowance,
            remarks: { year: -1, n: 0 }, log: [], seq: 0,
        };
    },

    /** A home's record (made when `create`, with info { name, town, q, r }). */
    home(player, key, create = false, info = {}) {
        if (!key) return null;
        const st = create ? Household.ensure(player) : (player && player.household);
        if (!st || !st.homes) return null;
        let h = st.homes[key];
        if (!h && create) h = st.homes[key] = Household._blankHome(key, info);
        if (h) {
            for (const k of ['rooms', 'servants', 'guests', 'displays', 'log']) if (!Array.isArray(h[k])) h[k] = [];
            if (!h.larder || typeof h.larder !== 'object') h.larder = {};
            if (!h.remarks) h.remarks = { year: -1, n: 0 };
        }
        return h || null;
    },

    /** The homes the player could keep house in: their houses, and every home already kept. */
    homes(player) {
        const out = [];
        const seen = new Set();
        for (const h of (player && player.houses) || []) {
            const key = Household.houseKey(h);
            seen.add(key);
            const type = DataLoader.housing && Array.isArray(DataLoader.housing.houseTypes)
                ? DataLoader.housing.houseTypes.find(t => t.id === h.typeId) : null;
            out.push({ key, name: (type && type.name) || 'House', town: h.settlementName || null, q: h.q, r: h.r, rec: Household.home(player, key) });
        }
        for (const [key, rec] of Object.entries(_obj(player && player.household && player.household.homes))) {
            if (seen.has(key)) continue;
            out.push({ key, name: rec.name, town: rec.town, q: rec.q, r: rec.r, rec });
        }
        return out;
    },

    /** Is the player at (the hex of) this home? */
    isHome(player, home) {
        return !!(player && home && home.q === player.q && home.r === player.r);
    },

    _settlement(world, home) {
        const t = world && typeof world.getTile === 'function' && home ? world.getTile(home.q, home.r) : null;
        return (t && t.settlement) || null;
    },

    _note(home, world, text) {
        home.log.unshift({ d: _day(world), text });
        if (home.log.length > 30) home.log.length = 30;
    },

    // ── Rooms ─────────────────────────────────────────────

    /**
     * A room's quality 0..1 from a survey of its furniture:
     *   tally = { types: { bed: 2, chest: 1 }, value: gold worth }
     * Nothing without one of the room's needed pieces.
     */
    roomQuality(kind, tally) {
        const def = Household.roomDef(kind);
        if (!def || !tally) return 0;
        const types = _obj(tally.types);
        const needs = Array.isArray(def.needs) ? def.needs : [];
        if (needs.length && !needs.some(t => _num(types[t]) > 0)) return 0;
        let fit = 0;
        for (const [t, w] of Object.entries(_obj(def.furniture))) fit += Math.min(3, _num(types[t])) * _num(w);
        const worth = _num(tally.value) / Math.max(1, _num(def.full, 200));
        return _r2(_clamp(0.15 + Math.min(1, fit / 4) * 0.45 + Math.min(1, worth) * 0.4, 0, 1));
    },

    /**
     * Mark a corner of the house as a room (made or moved: one of each kind).
     * spot = { kind, floor, q, r, tally, displays? } (the survey from the inner map).
     */
    designate(player, world, key, spot, info = {}) {
        const def = Household.roomDef(spot && spot.kind);
        if (!def) return { success: false, text: 'No such room.' };
        const home = Household.home(player, key, true, info);
        const C = Household.config();
        let room = home.rooms.find(r => r.kind === spot.kind);
        if (!room && home.rooms.length >= _num(C.maxRooms, 8)) return { success: false, text: `A house keeps ${C.maxRooms} rooms at most.` };
        if (!room) { room = { id: `r${++home.seq}`, kind: spot.kind }; home.rooms.push(room); }
        Object.assign(room, { floor: _num(spot.floor), q: spot.q, r: spot.r });
        Household.resurvey(home, room, spot.tally, world);
        const q = room.quality;
        const missing = q <= 0 ? ` It needs ${(def.needs || []).map(t => `a ${t}`).join(' or ')} to be any use.` : '';
        return { success: true, room, text: `This corner is now the ${def.name.toLowerCase()} (${Math.round(q * 100)}%).${missing}` };
    },

    /** Record a fresh survey of a room's furniture. */
    resurvey(home, room, tally, world) {
        if (!room) return;
        const t = tally || { types: {}, value: 0 };
        room.types = { ..._obj(t.types) };
        room.value = Math.round(_num(t.value));
        room.displaySlots = Math.max(0, Math.floor(_num(t.displaySlots)));
        room.quality = Household.roomQuality(room.kind, t);
        room.surveyed = _day(world);
    },

    unmark(player, key, roomId) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        const i = home.rooms.findIndex(r => r.id === roomId);
        if (i < 0) return { success: false, text: 'No such room.' };
        const [r] = home.rooms.splice(i, 1);
        if (r.kind === 'hall') home.displays = [];
        return { success: true, text: `The ${(Household.roomDef(r.kind) || {}).name || 'room'} is just a corner again.` };
    },

    room(home, kind) { return home ? home.rooms.find(r => r.kind === kind) || null : null; },

    /** A room's quality (0 when the house has none of the kind). */
    quality(home, kind) {
        const r = Household.room(home, kind);
        return r ? _num(r.quality) : 0;
    },

    /** Extra sleep a night in this home's bedchamber gives: +0.4 → 40% more. */
    sleepBonus(player, key) {
        const home = Household.home(player, key);
        const q = Household.quality(home, 'bedchamber');
        const clean = home ? _clamp(_num(home.clean, 80) / 100, 0.5, 1) : 1;
        return _r2(q * _num(Household.config().effects.sleepBonus) * clean);
    },

    // ── Displays: heirlooms and trophies in the hall ──────

    /** Trophies the House has earned (data/household.json trophies). */
    trophies(player) {
        return (Household.config().trophies || []).filter(t => _num(_get(player, t.from)) >= _num(t.min, 1));
    },

    /** Everything that could go on show: [{ ref, name, icon, kind, prestige, remark, onShow }]. */
    displayables(player, key) {
        const home = Household.home(player, key);
        const shown = new Set(((home && home.displays) || []).map(d => d.ref));
        const out = [];
        for (const h of Heirlooms.list(player)) {
            if (!h || h.status !== 'held') continue;
            const ref = `heirloom:${h.id}`;
            out.push({ ref, name: h.name, icon: (Heirlooms.kind(h.kind) || {}).icon || '🏺', kind: 'heirloom', prestige: 1 + Math.min(3, Math.floor(Heirlooms.legend(h) / 10)), remark: h.name, onShow: shown.has(ref) });
        }
        for (const t of Household.trophies(player)) {
            const ref = `trophy:${t.id}`;
            out.push({ ref, name: t.name, icon: t.icon, kind: 'trophy', prestige: _num(t.prestige, 1), remark: t.remark || t.name, onShow: shown.has(ref) });
        }
        return out;
    },

    /** How many things the hall can show: its display pieces. */
    displaySlots(home) {
        const hall = Household.room(home, 'hall');
        return hall ? _num(hall.displaySlots) : 0;
    },

    /** The displays still valid (an heirloom pawned or given leaves the hall). */
    shown(player, home) {
        if (!home) return [];
        const can = new Map(Household.displayables(player, home.key).map(d => [d.ref, d]));
        home.displays = home.displays.filter(d => can.has(d.ref)).slice(0, Household.displaySlots(home));
        return home.displays.map(d => can.get(d.ref));
    },

    setDisplay(player, key, ref, on = true) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        const thing = Household.displayables(player, key).find(d => d.ref === ref);
        if (!thing) return { success: false, text: 'That is not yours to show.' };
        if (!on) {
            home.displays = home.displays.filter(d => d.ref !== ref);
            return { success: true, text: `The ${thing.name} is put away.` };
        }
        if (home.displays.some(d => d.ref === ref)) return { success: true, text: `The ${thing.name} is already on show.` };
        const slots = Household.displaySlots(home);
        if (!Household.room(home, 'hall')) return { success: false, text: 'Mark a hall first: things are shown in the hall.' };
        if (home.displays.length >= slots) return { success: false, text: slots ? `Every display piece in the hall holds something (${slots}). Put something away, or set another rack, statue or banner there.` : 'The hall has no rack, statue or banner to show anything on.' };
        home.displays.push({ ref, since: null });
        return { success: true, text: `${thing.icon} The ${thing.name} goes on show in the hall.` };
    },

    // ── Servants ──────────────────────────────────────────

    servants(home, role = null) {
        return home ? home.servants.filter(s => !role || s.role === role) : [];
    },

    /** People of the home town who would take service: [{ id, name, gender, skill, wage, folkId }]. */
    candidates(player, world, key, role) {
        const C = Household.config();
        const home = Household.home(player, key);
        const def = Household.roleDef(role);
        if (!home || !def) return [];
        const s = Household._settlement(world, home);
        const rnd = _rng(world, `hire|${key}|${role}`);
        const H = C.hire;
        const taken = new Set();
        for (const h of Object.values(_obj(player.household && player.household.homes))) for (const x of h.servants || []) if (x.folkId) taken.add(x.folkId);
        const out = [];
        const folk = s && s.folk;
        if (folk && Array.isArray(folk.people)) {
            const day = _day(world);
            const pool = folk.people.filter(p => Townsfolk.isHere(p) && !taken.has(p.id)
                && Townsfolk.age(p, day) >= H.minAge && Townsfolk.age(p, day) <= H.maxAge
                && !['guard', 'noble', 'priest'].includes(p.role));
            for (let i = 0; i < pool.length && out.length < H.candidates; i++) {
                const p = pool[Math.floor(rnd() * pool.length)];
                if (out.some(o => o.folkId === p.id)) continue;
                out.push(Household._candidate(role, rnd, { name: Townsfolk.name(p), gender: p.gender, folkId: p.id, was: Townsfolk.roleTitle ? Townsfolk.roleTitle(p) : p.role }));
            }
        }
        while (out.length < H.candidates) {
            const gender = role === 'maid' || role === 'nurse' ? (rnd() < 0.85 ? 'female' : 'male') : (rnd() < 0.5 ? 'female' : 'male');
            const name = `${_pick(C.names[gender] || C.names.male, rnd)} ${_pick(C.names.last, rnd)}`;
            if (out.some(o => o.name === name)) { if (rnd() < 0.1) break; continue; }
            out.push(Household._candidate(role, rnd, { name, gender, folkId: null }));
        }
        return out.map((c, i) => ({ ...c, id: `c${i}` }));
    },

    _candidate(role, rnd, o) {
        const C = Household.config();
        const [lo, hi] = C.hire.skillRange || [1, 5];
        const skill = lo + Math.floor(rnd() * (hi - lo + 1));
        const base = _num((Household.roleDef(role) || {}).wage, 2);
        const wage = _r2(base * (1 + (skill - 3) * _num(C.hire.wagePerSkill, 0.25)));
        return { ...o, role, skill, wage: Math.max(1, wage) };
    },

    hire(player, world, key, role, candidateId) {
        const home = Household.home(player, key);
        const def = Household.roleDef(role);
        if (!home || !def) return { success: false, text: 'No such place in the household.' };
        if (!Household.isHome(player, home)) return { success: false, text: `You hire servants in ${home.town || 'the town'} itself.` };
        const c = Household.candidates(player, world, key, role).find(x => x.id === candidateId);
        if (!c) return { success: false, text: 'They have found other work.' };
        if (_num(player.gold) < c.wage) return { success: false, text: `You can't pay even a day's wage (${c.wage}g).` };
        const s = {
            id: `s${++home.seq}`, role, name: c.name, gender: c.gender, folkId: c.folkId || null,
            skill: c.skill, wage: c.wage, mood: Household.config().mood.start, hired: _day(world),
            lowDays: 0, unpaid: 0, praised: -999, purse: 0, warned: false,
        };
        home.servants.push(s);
        Household._note(home, world, `${s.name} entered service as ${def.name.toLowerCase()}.`);
        const need = def.needs && !Household.room(home, def.needs) ? ` (Mark a ${Household.roomDef(def.needs).name.toLowerCase()} for them to work in.)` : '';
        return { success: true, servant: s, text: `${s.name} enters your service as ${def.name.toLowerCase()} at ${s.wage}g a day.${need}` };
    },

    _servant(home, id) { return home ? home.servants.find(s => s.id === id) || null : null; },

    dismiss(player, world, key, id) {
        const home = Household.home(player, key);
        const s = Household._servant(home, id);
        if (!s) return { success: false, text: 'No such servant.' };
        home.servants = home.servants.filter(x => x !== s);
        Household._settleServant(world, home, s);
        Household._note(home, world, `${s.name} was let go.`);
        return { success: true, text: `You let ${s.name} go.` };
    },

    /** A word of thanks (now and then): mood. */
    praise(player, world, key, id) {
        const C = Household.config().mood;
        const home = Household.home(player, key);
        const s = Household._servant(home, id);
        if (!s) return { success: false, text: 'No such servant.' };
        if (_day(world) - _num(s.praised, -999) < C.praiseEvery) return { success: false, text: `You thanked ${s.name} lately; more would ring hollow.` };
        s.praised = _day(world);
        s.mood = _clamp(_num(s.mood) + C.praise, 0, C.max);
        return { success: true, text: `${s.name} flushes at the praise.` };
    },

    /** Raise the wage by a fifth: mood. */
    raiseWage(player, world, key, id) {
        const C = Household.config().mood;
        const home = Household.home(player, key);
        const s = Household._servant(home, id);
        if (!s) return { success: false, text: 'No such servant.' };
        s.wage = _r2(Math.max(s.wage + 0.5, s.wage * 1.2));
        s.mood = _clamp(_num(s.mood) + C.raise, 0, C.max);
        s.lowDays = 0;
        return { success: true, text: `${s.name} will have ${s.wage}g a day now, and thanks you for it.` };
    },

    /** What a leaving servant had saved goes into the home town's market. */
    _settleServant(world, home, s) {
        const town = Household._settlement(world, home);
        if (town && _num(s.purse) > 0) Economy.payTown(town, s.purse);
        s.purse = 0;
    },

    moodWord(m) {
        const v = _num(m);
        return v >= 80 ? 'devoted' : v >= 60 ? 'content' : v >= 40 ? 'grumbling' : v >= 20 ? 'resentful' : 'on the point of leaving';
    },

    /** Daily wages of the home's servants. */
    wages(home) {
        return _r2(Household.servants(home).reduce((a, s) => a + _num(s.wage), 0));
    },

    // ── The larder ────────────────────────────────────────

    capacity(home) {
        const L = Household.config().larder;
        return Math.round(_num(L.baseCapacity) + Household.quality(home, 'larder') * _num(L.perLarderQuality));
    },

    units(home) {
        return Object.values(_obj(home && home.larder)).reduce((a, n) => a + Math.max(0, _num(n)), 0);
    },

    /** How many days' rations (35 hunger each) the larder holds. */
    rations(home) {
        const L = Household.config().larder;
        let h = 0;
        for (const [g, n] of Object.entries(_obj(home && home.larder))) h += _num(MEAL_HUNGER[g]) * Math.max(0, _num(n));
        return Math.floor(h / Math.max(1, _num(L.ration, 35)));
    },

    /** Mouths at table today: servants, guests, and the player when home. */
    mouths(player, home) {
        return Household.servants(home).length + home.guests.length + (Household.isHome(player, home) ? 1 : 0);
    },

    isFood(id) { return Object.prototype.hasOwnProperty.call(MEAL_HUNGER, id); },

    /** Put food from the packs into the larder (all of it when qty is null). */
    stock(player, key, goodId, qty = null) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        if (!Household.isHome(player, home)) return { success: false, text: 'You must be at the house to put food by.' };
        if (!Household.isFood(goodId)) return { success: false, text: 'That is not food.' };
        const have = Math.floor(_num(player.inventory && player.inventory[goodId]));
        const room = Household.capacity(home) - Household.units(home);
        const n = Math.min(have, room, qty == null ? Infinity : Math.max(0, Math.floor(qty)));
        if (have <= 0) return { success: false, text: 'You have none of that.' };
        if (n <= 0) return { success: false, text: 'The larder is full.' };
        player.inventory[goodId] -= n;
        if (player.inventory[goodId] <= 0) delete player.inventory[goodId];
        home.larder[goodId] = _num(home.larder[goodId]) + n;
        return { success: true, n, text: `${n} ${goodId.replace(/_/g, ' ')} into the larder.` };
    },

    /** Take food back out of the larder into the packs. */
    take(player, key, goodId, qty = 1) {
        const home = Household.home(player, key);
        if (!home || !Household.isHome(player, home)) return { success: false, text: 'You must be at the house.' };
        const n = Math.min(Math.floor(_num(home.larder[goodId])), Math.max(1, Math.floor(qty)));
        if (n <= 0) return { success: false, text: 'There is none of that in the larder.' };
        home.larder[goodId] -= n;
        if (home.larder[goodId] <= 0) delete home.larder[goodId];
        player.inventory = player.inventory || {};
        player.inventory[goodId] = _num(player.inventory[goodId]) + n;
        return { success: true, n, text: `${n} ${goodId.replace(/_/g, ' ')} from the larder into your packs.` };
    },

    /** The home town's food on the stalls: [{ id, name, price, quantity, entry }] cheapest per hunger first. */
    marketFood(player, world, home) {
        const s = Household._settlement(world, home);
        if (!s) return [];
        const tile = world.getTile(home.q, home.r);
        let goods = [];
        try { goods = Trading.getAvailableGoods(s, tile, world) || []; } catch { return []; }
        return goods.filter(g => g && Household.isFood(g.id) && _num(g.quantity) > 0)
            .map(g => ({ id: g.id, name: g.name || g.id, price: _num(g.price), quantity: Math.floor(_num(g.quantity)), entry: g }))
            .sort((a, b) => a.price / Math.max(1, MEAL_HUNGER[a.id]) - b.price / Math.max(1, MEAL_HUNGER[b.id]));
    },

    /**
     * Buy food at the home town's market straight into the larder: the coin
     * to the town's purse, the goods off its stalls (no pack slot needed).
     * → { success, n, spent, text }
     */
    buy(player, world, key, goodId, qty, budget = Infinity) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        const s = Household._settlement(world, home);
        const g = Household.marketFood(player, world, home).find(x => x.id === goodId);
        if (!s || !g) return { success: false, text: 'None on the stalls.' };
        const room = Household.capacity(home) - Household.units(home);
        let n = Math.min(Math.floor(_num(qty)), g.quantity, room);
        if (n <= 0) return { success: false, text: room <= 0 ? 'The larder is full.' : 'None to buy.' };
        const cap = Math.min(_num(player.gold), budget);
        while (n > 0 && Trading.buyCost(player, g.entry, n, s) > cap) n--;
        if (n <= 0) return { success: false, text: 'Your purse is short.' };
        const cost = Trading.buyCost(player, g.entry, n, s);
        player.gold = _num(player.gold) - cost;
        Economy.payTown(s, cost);
        SettlementMarket.take(s, goodId, n);
        Ledger.record(player, 'larder', -cost);
        home.larder[goodId] = _num(home.larder[goodId]) + n;
        return { success: true, n, spent: cost, text: `${n} ${g.name.toLowerCase()} bought for the larder (${Math.round(cost)}g).` };
    },

    setAllowance(player, key, gold) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        home.allowance = Math.max(0, Math.round(_num(gold)));
        return { success: true, text: `The steward may spend ${home.allowance}g a day on the larder.` };
    },

    /** Eat `hunger` points from the larder (the poorest food first). → hunger points eaten */
    _eat(home, hunger) {
        let need = hunger;
        const goods = Object.keys(home.larder).filter(g => _num(home.larder[g]) > 0)
            .sort((a, b) => _num(MEAL_HUNGER[a]) - _num(MEAL_HUNGER[b]));
        for (const g of goods) {
            while (need > 0 && _num(home.larder[g]) > 0) {
                home.larder[g] -= 1;
                need -= _num(MEAL_HUNGER[g], 10);
            }
            if (home.larder[g] <= 0) delete home.larder[g];
            if (need <= 0) break;
        }
        return hunger - Math.max(0, need);
    },

    // ── Guests ────────────────────────────────────────────

    /** Who might come to stay: [{ kind, refId, name }]. */
    guestPool(player, world, home) {
        const out = [];
        const here = new Set(home.guests.map(g => g.refId));
        for (const c of (player && player.children) || []) {
            if (!c || c.isAlive === false || _num(c.age) < 16 || here.has(`child:${c.id}`)) continue;
            out.push({ kind: 'kin', refId: `child:${c.id}`, name: `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`.trim() });
        }
        for (const npc of Court.members(player)) {
            if (here.has(`npc:${npc.id}`)) continue;
            out.push({ kind: 'courtier', refId: `npc:${npc.id}`, name: npc.name || `${npc.firstName || ''} ${npc.lastName || ''}`.trim() });
        }
        for (const rv of RivalHouses.rivals(player)) {
            const ref = `rival:${rv.kingdomId != null ? rv.kingdomId : rv.name}`;
            if (here.has(ref)) continue;
            out.push({ kind: 'envoy', refId: ref, name: `an envoy of ${rv.name || 'a rival House'}` });
        }
        return out;
    },

    /** Send word that guests are welcome: someone comes tomorrow if anyone can. */
    invite(player, world, key) {
        const home = Household.home(player, key);
        if (!home) return { success: false, text: 'No such home.' };
        if (!Household.room(home, 'hall')) return { success: false, text: 'Mark a hall first: guests are received in the hall.' };
        home.invited = _day(world);
        return { success: true, text: 'You send word round that the House keeps open table.' };
    },

    _arrive(player, world, home, rnd, out) {
        const G = Household.config().guests;
        const pool = Household.guestPool(player, world, home);
        if (!pool.length) return null;
        const kinds = _obj(G.kinds);
        let total = 0;
        for (const p of pool) total += _num((kinds[p.kind] || {}).weight, 1);
        let roll = rnd() * total;
        let pick = pool[0];
        for (const p of pool) { roll -= _num((kinds[p.kind] || {}).weight, 1); if (roll <= 0) { pick = p; break; } }
        const [lo, hi] = G.stay || [1, 3];
        const nights = lo + Math.floor(rnd() * (hi - lo + 1));
        const k = kinds[pick.kind] || {};
        const g = { id: `g${++home.seq}`, kind: pick.kind, refId: pick.refId, name: pick.name, icon: k.icon || '👤', arrived: _day(world), leaves: _day(world) + nights, hungry: 0, remarked: false };
        home.guests.push(g);
        Household._note(home, world, `${g.name} came to stay.`);
        out.push({ icon: g.icon, title: 'A Guest', text: `${g.name[0].toUpperCase()}${g.name.slice(1)} has come to stay at your house in ${home.town || 'town'} (${nights} night${nights > 1 ? 's' : ''}). They sit in the hall.`, type: 'info' });
        return g;
    },

    /** A guest's word on what stands in the hall: Prestige, renown, an heirloom's legend. */
    _remark(player, world, home, g, rnd, out) {
        const G = Household.config().guests;
        const C = Household.config();
        const things = Household.shown(player, home);
        if (!things.length || g.remarked) return;
        g.remarked = true;
        const Y = 120;
        const year = Math.floor(_day(world) / Y);
        if (home.remarks.year !== year) home.remarks = { year, n: 0 };
        const thing = _pick(things, rnd);
        const guestName = g.name[0].toUpperCase() + g.name.slice(1);
        const text = _fill(_pick(C.remarks, rnd), { guest: guestName, thing: thing.kind === 'heirloom' ? thing.name : thing.remark });
        if (home.remarks.n >= _num(G.remarkCapPerYear, 24)) {
            out.push({ icon: '🏛️', title: 'In the Hall', text, type: 'info' });
            return;
        }
        home.remarks.n++;
        const pr = Math.round(_num(G.remarkPrestige) + _num(thing.prestige));
        if (player.house && pr > 0) House.award(player.house, pr, `${guestName} admired the ${thing.name}`, _day(world));
        player.renown = _num(player.renown) + _num(G.remarkRenown);
        if (thing.kind === 'heirloom') {
            const h = Heirlooms.get(player, thing.ref.slice('heirloom:'.length));
            if (h) Heirlooms.addLine(h, world, `Admired in the hall at ${home.town || 'home'} by ${g.name}`, 0.25);
        }
        out.push({ icon: thing.icon || '🏛️', title: 'In the Hall', text: `${text} (+${pr} Prestige)`, type: 'success' });
    },

    _depart(player, world, home, g, early, out) {
        const G = Household.config().guests;
        const C = Household.config();
        home.guests = home.guests.filter(x => x !== g);
        const hall = Household.quality(home, 'hall');
        const clean = _num(home.clean, 80) >= _num(C.cleanliness.dirtyBelow, 40);
        const good = !early && !g.hungry && clean && hall >= 0.3;
        const name = g.name[0].toUpperCase() + g.name.slice(1);
        const rel = g.refId.startsWith('npc:') ? player.relationships && player.relationships[g.refId.slice(4)] : null;
        const rival = g.refId.startsWith('rival:') ? RivalHouses.rivals(player).find(r => `rival:${r.kingdomId != null ? r.kingdomId : r.name}` === g.refId) : null;
        if (good) {
            if (rel) rel.score = _num(rel.score) + _num(G.kinOpinion);
            if (rival) rival.feud = Math.max(0, _num(rival.feud) - _num(G.envoyFeudCut));
            if (player.house) House.award(player.house, _num(G.welcomePrestige), `${name} was well received`, _day(world));
            Household._note(home, world, `${g.name} left well pleased.`);
            out.push({ icon: g.icon, title: 'A Guest Leaves', text: `${name} leaves your house well pleased${rival ? ', and the feud cools a little' : ''}.`, type: 'success' });
            return;
        }
        if (rel) rel.score = _num(rel.score) + _num(G.badStayOpinion);
        if (rival) rival.feud = _num(rival.feud) + 1;
        if (player.house && g.hungry) {
            // (a slight: Prestige lost, not spent — House.award takes gains only)
            const loss = Math.min(_num(player.house.prestige), Math.abs(_num(G.badStayPrestige)));
            if (loss > 0) {
                player.house.prestige -= loss;
                if (House._logPrestige) House._logPrestige(player.house, _day(world), -loss, `${name} went hungry under your roof`);
            }
        }
        const why = g.hungry ? _fill(_pick(C.bareLines, _rng(world, g.id)), { guest: name })
            : !clean ? `${name} found the house dirty and said so.`
                : hall < 0.3 ? `${name} found the hall a poor, bare place.` : `${name} leaves sooner than they meant to.`;
        Household._note(home, world, why);
        out.push({ icon: g.icon, title: 'A Guest Leaves', text: why, type: 'warning' });
    },

    // ── The day ───────────────────────────────────────────

    /** The household's day, for every home kept. → { notices } */
    processDay(player, world) {
        const out = [];
        const st = player && player.household;
        if (!st || !st.homes) return { notices: out };
        for (const home of Object.values(st.homes)) {
            Household.home(player, home.key);
            // A house sold: the household breaks up
            if (/^house:/.test(home.key) && !((player.houses || []).some(h => Household.houseKey(h) === home.key))) {
                for (const s of home.servants) Household._settleServant(world, home, s);
                if (home.servants.length) out.push({ icon: '🏚️', title: 'Household', text: `With the house in ${home.town || 'town'} gone, its servants are paid off.`, type: 'info' });
                delete st.homes[home.key];
                continue;
            }
            Household._homeDay(player, world, home, out);
        }
        return { notices: out };
    },

    _homeDay(player, world, home, out) {
        const C = Household.config();
        const M = C.mood;
        const L = C.larder;
        const E = C.effects;
        const day = _day(world);
        const atHome = Household.isHome(player, home);
        const town = Household._settlement(world, home);
        const rnd = _rng(world, home.key);
        const cookQ = Household.servants(home, 'cook').length ? Household.quality(home, 'kitchen') : 0;

        // Guests: they come while you are home with a hall; they go when you leave
        if (!atHome) {
            for (const g of home.guests.slice()) Household._depart(player, world, home, g, true, out);
        } else if (Household.room(home, 'hall') || !C.guests.needHall) {
            const invited = home.invited != null && day - home.invited <= 2;
            const chance = invited ? 0.9 : _num(C.guests.chancePerDay);
            if (home.guests.length < _num(C.guests.maxAtOnce, 3) && rnd() < chance) {
                if (Household._arrive(player, world, home, rnd, out)) home.invited = null;
            }
        }

        // The house's steward restocks the larder from the home town's market
        const steward = Household.servants(home, 'steward')[0];
        if (steward && town && _num(home.allowance) > 0 && Household.rations(home) < _num(L.stewardTarget)) {
            let budget = Math.min(_num(home.allowance), _num(player.gold));
            for (const g of Household.marketFood(player, world, home)) {
                if (budget <= 0 || Household.rations(home) >= _num(L.stewardTarget)) break;
                const res = Household.buy(player, world, home.key, g.id, Math.ceil(_num(L.stewardTarget) * _num(L.ration) / Math.max(1, MEAL_HUNGER[g.id])), budget);
                if (res.success) budget -= res.spent;
            }
        }

        // The table: every mouth in the house eats from the larder (a good cook stretches it)
        const mouths = Household.mouths(player, home);
        const stretch = 1 - _num(E.kitchenStretch) * cookQ;
        const want = mouths * _num(L.ration, 35) * stretch;
        const ate = want > 0 ? Household._eat(home, want) : 0;
        const fed = want <= 0 || ate >= want - 1e-6;
        if (want > 0 && !fed) home.bareDays = _num(home.bareDays) + 1; else home.bareDays = 0;
        if (!fed) for (const g of home.guests) g.hungry = _num(g.hungry) + 1;
        if (atHome && fed && want > 0) {
            // Supper at your own table: hot from the kitchen when there's a cook
            const kq = Household.quality(home, 'kitchen');
            const cooked = cookQ > 0;
            if (player.modifyNeed) {
                player.modifyNeed('hunger', Math.round(_num(E.kitchenHunger) * (cooked ? 1 + cookQ : kq > 0 ? 0.5 : 0.25)));
                if (cooked) player.modifyNeed('comfort', Math.round(_num(E.kitchenComfort) * (0.5 + cookQ)));
            }
        } else if (atHome && want > 0 && home.bareDays === 1) {
            out.push({ icon: '🧺', title: 'Household', text: `The larder in ${home.town || 'your house'} is bare: no supper tonight, and the servants go hungry.`, type: 'warning' });
        }

        // Spoilage (a larder room keeps food better)
        const spoilRate = _num(L.spoilPerDay) * (1 - _num(L.larderSpoilCut) * Household.quality(home, 'larder'));
        for (const g of Object.keys(home.larder)) {
            if (KEEPS.has(g)) continue;
            const n = _num(home.larder[g]);
            const exp = n * spoilRate;
            const lost = Math.floor(exp) + (rnd() < exp - Math.floor(exp) ? 1 : 0);
            if (lost > 0) home.larder[g] = n - lost;
            if (home.larder[g] <= 0) delete home.larder[g];
        }

        // Cleanliness: the house gets dirty, maids clean it
        const CL = C.cleanliness;
        const rooms = Math.max(1, home.rooms.length);
        let clean = _num(home.clean, 80) - (_num(CL.decayBase) + rooms * _num(CL.decayPerRoom)) * (mouths > 0 ? 1 : 0.4);
        for (const s of Household.servants(home, 'maid')) clean += _num(CL.maidRestores) * (0.6 + 0.1 * _num(s.skill, 3)) * (s.mood >= 40 ? 1 : 0.5);
        home.clean = Math.round(_clamp(clean, 0, 100));

        // Servants: wages, mood, quitting
        const maids = Household.servants(home, 'maid').length;
        for (const s of home.servants.slice()) {
            const def = Household.roleDef(s.role) || {};
            if (s.folkId && town && town.folk && Array.isArray(town.folk.people)) {
                const p = town.folk.people.find(x => x.id === s.folkId);
                if (p && p.died != null) {
                    home.servants = home.servants.filter(x => x !== s);
                    Household._settleServant(world, home, s);
                    Household._note(home, world, `${s.name} died in your service.`);
                    out.push({ icon: '🕯️', title: 'Household', text: `${s.name}, your ${(def.name || s.role).toLowerCase()}, has died.`, type: 'warning' });
                    continue;
                }
            }
            let dm = (_num(M.start) - _num(s.mood)) * 0.02;
            if (_num(player.gold) >= s.wage) {
                player.gold = _num(player.gold) - s.wage;
                s.purse = _r2(_num(s.purse) + s.wage);
                Ledger.record(player, 'servantWages', -s.wage);
                s.unpaid = 0;
                dm += _num(M.paid);
            } else {
                s.unpaid = _num(s.unpaid) + 1;
                dm += _num(M.unpaid);
            }
            dm += fed ? _num(M.fed) : _num(M.hungry);
            if (s.role === 'maid' && rooms > 3 * Math.max(1, maids)) dm += _num(M.overworked);
            if (def.needs && Household.quality(home, def.needs) >= 0.5) dm += _num(M.goodRoom);
            if (def.needs && !Household.room(home, def.needs)) dm += _num(M.overworked) * 0.5;
            s.mood = _r2(_clamp(_num(s.mood) + dm, 0, _num(M.max, 100)));
            // What they earn they spend in town: a share of their pocket each day
            if (town && _num(s.purse) > 0) {
                const spend = _r2(_num(s.purse) * 0.25);
                if (spend > 0) { Economy.payTown(town, spend); s.purse = _r2(s.purse - spend); }
            }
            if (s.mood < _num(M.warnBelow) && !s.warned) {
                s.warned = true;
                out.push({ icon: def.icon || '🧹', title: 'Household', text: `${s.name}, your ${(def.name || s.role).toLowerCase()}, is ${Household.moodWord(s.mood)}${s.unpaid ? ' (unpaid)' : !fed ? ' (the larder is bare)' : ''}.`, type: 'warning' });
            } else if (s.mood >= _num(M.warnBelow) + 10) s.warned = false;
            s.lowDays = s.mood < _num(M.quitBelow) ? _num(s.lowDays) + 1 : 0;
            if (s.lowDays >= _num(M.quitDays, 3)) {
                home.servants = home.servants.filter(x => x !== s);
                Household._settleServant(world, home, s);
                Household._note(home, world, `${s.name} gave notice and left.`);
                out.push({ icon: def.icon || '🧹', title: 'A Servant Quits', text: `${s.name} has had enough and leaves your service${s.unpaid ? ', owed wages' : ''}.`, type: 'warning' });
            }
        }

        // Guests: a word on the hall's displays; the stay ends
        for (const g of home.guests.slice()) {
            if (atHome) Household._remark(player, world, home, g, rnd, out);
            const tooHungry = _num(g.hungry) >= _num(L.bareStrikes, 2);
            if (day >= g.leaves || tooHungry) Household._depart(player, world, home, g, tooHungry, out);
        }

        // The rooms' daily good while you are home
        if (atHome) Household._roomsDay(player, world, home);
    },

    _roomsDay(player, world, home) {
        const C = Household.config();
        const E = C.effects;
        // A clean house and a good bed: rest
        if (player.modifyNeed) {
            const bed = Household.quality(home, 'bedchamber');
            if (bed > 0) player.modifyNeed('energy', Math.round(_num(E.homeRestEnergy) * bed));
            const clean = _num(home.clean, 80);
            player.modifyNeed('comfort', Math.round((clean - 50) / 10));
        }
        // The study: an hour at the books
        const sq = Household.quality(home, 'study');
        if (sq > 0) OddJobs.gainXp(player, { attrs: { intelligence: 1 }, skills: { diplomacy: 0.5 } }, _num(E.studyXp) * sq);
        // The chapel: prayers
        const cq = Household.quality(home, 'chapel');
        if (cq > 0) {
            Devotion.raiseStat(player, 'faith', _r2(_num(E.chapelFaith) * cq), 'chapel', { faith: _num(E.chapelFaithCap, 3) });
            const creed = Devotion.creed(player);
            if (creed && creed.id && Devotion._addStanding) Devotion._addStanding(player, creed.id, _r2(_num(E.chapelStanding) * cq));
        }
        // The nursery: the little ones of the House
        const nq = Household.quality(home, 'nursery');
        if (nq > 0) {
            const nurse = Household.servants(home, 'nurse').length ? 1.5 : 1;
            for (const c of player.children || []) {
                if (!c || c.isAlive === false || !Upbringing.inChildhood(c) || Upbringing.isAway(c)) continue;
                if (_num(c.health, 100) < 100) c.health = Math.min(100, _num(c.health, 100) + _num(E.nurseryHealth) * nq * nurse);
                Upbringing.ensure(c);
                Upbringing._addXp(c, 'stat', 'intelligence', _num(E.nurseryXp) * nq * nurse);
                Upbringing._addXp(c, 'stat', 'charisma', _num(E.nurseryXp) * nq * nurse * 0.5);
            }
        }
    },

    /** One home's state, for the panel. */
    view(player, world, key) {
        const home = Household.home(player, key);
        if (!home) return null;
        return {
            home,
            atHome: Household.isHome(player, home),
            wages: Household.wages(home),
            rations: Household.rations(home),
            units: Household.units(home),
            capacity: Household.capacity(home),
            mouths: Household.mouths(player, home),
            slots: Household.displaySlots(home),
            shown: Household.shown(player, home),
        };
    },
};
