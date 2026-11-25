// ============================================
// FLAYING — a traitor's skin on the gate, a corrupt judge's over his chair
// ============================================
// The oldest lesson for those who keep a lord's books.
//
//   THE DEED  is a death on the scaffold (systems/executions.js, method 'flay':
//            for treason, or for an official's corruption — a steward caught
//            with a hand in the chest is sent there from the Stewards panel,
//            Stewards.punish 'scaffold'). The crowd, the clergy's frown, the
//            butcher's name, the lords' memory and the talk of the towns come
//            from the scaffold. Here, onFlayed: an official flayed for
//            corruption cuts the corruption of a crown you rule (CrownBooks
//            fisc.corruption: the revenue it leaked) and leaves a fresh terror
//            among your stewards; every steward's loyalty falls, the lords of
//            your court take a grudge unless the flayed was a proven traitor,
//            and the town remembers (a TownMemory atrocity mark).
//   THE SKIN is a body in your hands (systems/gibbets.js, body.flayed): hang it
//            on a frame by the gate (gibbets kind 'skin': the street map lays
//            it, raw, dried to leather, in tatters over years) or have it
//            tanned and stretched over the judge's chair (kind 'chair',
//            indoors, lasting decades). onSkinHung logs and chronicles it.
//   THE DREAD every steward and governor of yours keeps at least
//            stewardDread() of fear while a skin of yours stands
//            (Stewards._week: the skim falls by the fear) — the next steward
//            thinks twice before stealing.
//   THE REALMS a cruel crown flays now and then (weekly hash roll): a crooked
//            official when its books leak (its corruption cut), else a traitor;
//            the skin goes up by its capital's gate, its stability falls.
//
// State: player.flaying (the record; saved), world.flaying (the realms' log;
// saved). Explicit params, no globals; every roll a hash of the world seed.
// Content and tuning: data/flaying.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { CrownBooks } from '../world/crownBooks.js';
import { TownMemory } from './townMemory.js';
import { House } from './house.js';
// (run time only)
import { Gibbets } from './gibbets.js';
import { Stewards } from './stewards.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { Interrogation } from './interrogation.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _r2 = (v) => Math.round(v * 100) / 100;

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
    return (_hash(`${_seed(world)}|flaying|${key}`) % 100000) / 100000;
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
    chair: { dread: 0.6 }, gate: { dread: 0.3 }, fresh: { days: 480, dread: 0.3 }, max: 0.9,
    corruptionCut: 0.45, stewardLoyalty: -4, courtGrudge: 4, townGrief: -6, townLong: 4,
    ai: { everyDays: 7, chance: 0.01, traits: ['cruel'], corruptionAt: 0.12, cut: 0.45, stability: -2, keep: 30 },
    lines: {},
};

let _cfg = null;
let _cfgSrc;
// stewardDread is read once a week per office: one reckoning a day is enough
let _dreadMemo = null;

export const Flaying = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.flaying : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...d,
                chair: { ...DEFAULTS.chair, ...(_obj(d.chair) || {}) },
                gate: { ...DEFAULTS.gate, ...(_obj(d.gate) || {}) },
                fresh: { ...DEFAULTS.fresh, ...(_obj(d.fresh) || {}) },
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return Flaying.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = Flaying.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── State ─────────────────────────────────────────────────

    state(player) {
        if (!player) return null;
        if (!_obj(player.flaying)) player.flaying = { v: 1, lastCorruptDay: null, log: [], stats: { flayed: 0, corrupt: 0, traitors: 0, chairs: 0, gates: 0 } };
        const st = player.flaying;
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { flayed: 0, corrupt: 0, traitors: 0, chairs: 0, gates: 0, ...(_obj(st.stats) || {}) };
        return st;
    },

    worldState(world) {
        if (!world) return null;
        if (!_obj(world.flaying)) world.flaying = { log: [] };
        if (!Array.isArray(world.flaying.log)) world.flaying.log = [];
        return world.flaying;
    },

    serialize(world) {
        return world && _obj(world.flaying) ? JSON.parse(JSON.stringify(world.flaying)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.flaying = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : undefined;
        if (world.flaying) Flaying.worldState(world);
    },

    _log(player, world, text) {
        const st = Flaying.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > 20) st.log.length = 20;
    },

    // ── The deed (from the scaffold) ─────────────────────────

    /**
     * Someone you condemned has been flayed alive on the scaffold (Executions._kill, method
     * 'flay'). e: the scaffold's entry; place: { q, r, name, kingdomId }. → extra words.
     */
    onFlayed(player, world, e, place) {
        if (!player || !world || !e) return '';
        const C = Flaying.config();
        const st = Flaying.state(player);
        const day = _day(world);
        const crime = (DataLoader._gamedata && DataLoader._gamedata.executions && DataLoader._gamedata.executions.crimes && DataLoader._gamedata.executions.crimes[e.crime]) || {};
        const corrupt = !!crime.corruption;
        st.stats.flayed++;
        if (corrupt) st.stats.corrupt++; else st.stats.traitors++;
        const words = [];
        // An official flayed for the purse: the crown's books leak less, and every clerk is afraid
        if (corrupt) {
            st.lastCorruptDay = day;
            const k = Throne.ruledKingdom(player, world);
            if (k) {
                const f = CrownBooks.state(k);
                if (f && _num(f.corruption) > 0) {
                    const before = _num(f.corruption);
                    f.corruption = Math.round(before * (1 - _num(C.corruptionCut)) * 10000) / 10000;
                    words.push(`The crown's books leak less: corruption ${Math.round(before * 100)}% → ${Math.round(f.corruption * 100)}%.`);
                }
            }
        }
        _dreadMemo = null;
        // Every steward of yours hears of it: afraid, and the less fond of you
        let offices = [];
        try { offices = Stewards.offices(player, world); } catch (err) { offices = []; }
        for (const { office } of offices) office.loyaltyMod = _num(office.loyaltyMod) + _num(C.stewardLoyalty);
        // The lords of your court: a grudge, unless he was a proven traitor of their own number
        let court = null;
        try { court = Kingship.court(player); } catch (err) { court = null; }
        if (court && Array.isArray(court.vassals) && !(crime.treason && e.guilty === true && e.kind === 'vassal')) {
            for (const v of court.vassals) v.grudge = _num(v.grudge) + _num(C.courtGrudge);
        }
        // The town remembers the day
        const s = place ? _settlementAt(world, place.q, place.r) : null;
        if (s) {
            try {
                TownMemory.mark(s, 'atrocity', {
                    what: 'flay', by: player.name || 'the lord', byPlayer: true, grief: _num(C.townGrief, -6), long: _num(C.townLong, 4),
                    line: `${e.name} was flayed alive in the square of ${s.name || 'the town'} {when} by order of ${player.name || 'the lord'}.`,
                }, world);
            } catch (err) { /* no memory */ }
        }
        Flaying._log(player, world, `${e.name} flayed alive at ${place ? place.name : 'the scaffold'} for ${e.crimeLabel}.`);
        words.push(Flaying.line(corrupt ? 'flayedCorrupt' : 'flayedTraitor', { name: e.name }, `${e.id}`));
        return words.filter(Boolean).join(' ');
    },

    /** A flayed skin hung on the gate or over the judge's chair (Gibbets.display). */
    onSkinHung(player, world, s, d, body) {
        if (!player || !s || !d) return;
        const st = Flaying.state(player);
        _dreadMemo = null;
        if (d.kind === 'chair') st.stats.chairs++; else st.stats.gates++;
        const text = Flaying.line(d.kind === 'chair' ? 'chair' : 'gate', { name: d.name, town: s.name || 'the town' }, d.id);
        Flaying._log(player, world, text);
        if (player.house && text) House._chronicle(player.house, world, text, ['justice', 'cruelty']);
        void body;
    },

    /** Your skins still up: [{ s, d, stage, weight }]. */
    skins(player, world, day = _day(world)) {
        if (!player || !world) return [];
        let all = [];
        try { all = Gibbets.all(world, day); } catch (err) { all = []; }
        const name = player.name || 'you';
        return all.filter(x => x.d && (x.d.kind === 'chair' || x.d.kind === 'skin') && x.d.by && x.d.by.kind === 'player' && (x.d.by.name === name || x.d.by.id === name))
            .map(x => ({ ...x, weight: Gibbets.stageWeight(x.stage.id) }));
    },

    /**
     * The fear every steward of yours keeps at the least (0..max): the skins over the judges'
     * chairs and on the gates, and a fresh flaying of an official for the purse.
     */
    stewardDread(player, world) {
        if (!player || !world || !Flaying.enabled()) return 0;
        const day = _day(world);
        // (a display raised or taken down today changes the reckoning: the gibbets' counter is part of the key)
        const gw = world.gibbets;
        const stamp = `${gw ? gw.nextId : 0}|${gw && gw.towns ? gw.towns.length : 0}|${player.flaying ? player.flaying.lastCorruptDay : ''}`;
        if (_dreadMemo && _dreadMemo.player === player && _dreadMemo.world === world && _dreadMemo.day === day && _dreadMemo.stamp === stamp) return _dreadMemo.v;
        const C = Flaying.config();
        let keep = 1;
        for (const x of Flaying.skins(player, world, day)) {
            const base = x.d.kind === 'chair' ? _num(C.chair.dread) : _num(C.gate.dread);
            keep *= 1 - Math.min(0.99, base * x.weight);
        }
        const st = player.flaying;
        if (st && st.lastCorruptDay != null) {
            const age = day - _num(st.lastCorruptDay);
            const span = Math.max(1, _num(C.fresh.days, 480));
            if (age >= 0 && age < span) keep *= 1 - _num(C.fresh.dread) * (1 - age / span);
        }
        const v = _r2(Math.min(_num(C.max, 0.9), 1 - keep));
        _dreadMemo = { player, world, day, stamp, v };
        return v;
    },

    // ── The realms ────────────────────────────────────────────

    /** A cruel crown flays a crooked official or a traitor at its capital now and then. */
    _aiWeek(world, day, out) {
        const A = Flaying.config().ai;
        const w = Flaying.worldState(world);
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false || !k.capital) continue;
            const tr = _traits(k);
            if (!(A.traits || []).some(t => tr.includes(t))) continue;
            if (_roll(world, `ai|${k.id}|${day}`) >= _num(A.chance, 0.01)) continue;
            const s = _settlementAt(world, k.capital.q, k.capital.r);
            if (!s) continue;
            if (s.q == null) { s.q = k.capital.q; s.r = k.capital.r; }
            const f = CrownBooks.state(k);
            const corrupt = f && _num(f.corruption) >= _num(A.corruptionAt, 0.12);
            let name = 'a traitor';
            try { name = Interrogation._powName(world, k.id, `flay|${k.id}|${day}`); } catch (err) { /* plain */ }
            if (corrupt) f.corruption = Math.round(_num(f.corruption) * (1 - _num(A.cut, 0.45)) * 10000) / 10000;
            k.stability = Math.max(0, _num(k.stability, 50) + _num(A.stability, -2));
            const ruler = k.ruler || (k.lord && k.lord.name) || 'the crown';
            try {
                Gibbets.raise(world, s, {
                    kind: 'skin', name, gender: 'male', rank: corrupt ? 'commoner' : 'noble', rebel: !corrupt, crime: corrupt ? 'robbing the treasury' : 'treason',
                    by: { kind: 'realm', id: k.id, name: ruler }, victimKingdomId: k.id, flayed: true,
                }, null);
            } catch (err) { /* no display */ }
            const text = Flaying.line(corrupt ? 'aiCorrupt' : 'aiTraitor', { ruler, realm: Names.realm(k.name), town: s.name || 'the capital', name }, `${k.id}|${day}`);
            w.log.unshift({ day, kingdomId: k.id, town: s.name || null, name, corrupt: !!corrupt });
            if (w.log.length > _num(A.keep, 30)) w.log.length = _num(A.keep, 30);
            if (text && Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: k.id });
            if (out && text) out.notices.push({ icon: '🩸', title: 'A Flaying', text, type: 'info', quiet: true });
        }
    },

    /** Daily: the realms' flayings, weekly. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Flaying.enabled()) return out;
        const day = _day(world);
        const A = Flaying.config().ai;
        if (day > 0 && day % Math.max(1, _num(A.everyDays, 7)) === 0) Flaying._aiWeek(world, day, out);
        void player;
        // (the realms' flayings are news, not alarms: world.events carries them)
        out.notices = out.notices.filter(n => !n.quiet);
        return out;
    },
};
