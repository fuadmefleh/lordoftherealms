// ============================================
// DECIMATION — a company that broke draws lots
// ============================================
// Every tenth man is beaten to death by his comrades. The rest stop running;
// they also never forget who gave the order.
//
//   THE BROKEN  when your army routs (player/fieldBattle.js: the field broke;
//            playerMilitary/combat.js: the one-shot fight's morale break) or your
//            commissioned host is beaten (player/generalship.js settleBattle),
//            the men who ran wait on your word for windowDays
//            (player.decimation.broken).
//   DECIMATE   a tenth of the companies that fought (your army's land units),
//            their kit stripped back into your stores; or a tenth of a host's
//            men, lost to its realm's army.
//   STEEL      for steel.days the army breaks less: PlayerMilitary's morale-break
//            chance x breakMult() (the one-shot combat and the field's rout
//            check read it); a host's morale for battle + hostMorale().
//   HATRED     hate (0..100) fades slowly; above desertAt, companies slip away in
//            the night (a weekly hash roll) and a host bleeds men; companions'
//            approval and a host's lieutenants' loyalty drop at the deed. The
//            name: Atrocities 'decimate', the gossip, Traits, the chronicle.
//   THE REALMS when a realm's lines break (world.routFeed, filled by
//            KingdomAI.simulateBattle), its lord may decimate them: its army
//            loses men, breaks less (kingdom.decimation.breakMult, read by
//            KingdomAI._checkMoraleBreak), its stability falls and, while the
//            hate lasts, its army bleeds deserters.
//
// State: player.decimation (saved), kingdom.decimation (saved with the realm),
// world.routFeed (the realms' broken lines, an inbox; not saved). Explicit params,
// no globals; every roll a hash of the world seed. Tuning: data/decimation.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Atrocities } from '../systems/atrocities.js';
import { Gossip } from '../systems/gossip.js';
import { Traits } from '../systems/traits.js';
import { House } from '../systems/house.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { Ships } from '../systems/ships.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
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
    return (_hash(`${_seed(world)}|decimation|${key}`) % 100000) / 100000;
}

function _traits(k) {
    const t = k && k.lord && Array.isArray(k.lord.traits) ? k.lord.traits : [];
    return t.map(x => (x && x.id) || x).filter(Boolean);
}

/** A land company (not a war galley). */
function _land(u) {
    return !!u && !Ships.isNavalUnit(u);
}

const DEFAULTS = {
    enabled: true, windowDays: 20, tenth: 10, minUnits: 3,
    steel: { days: 240, breakMult: 0.4, hostMorale: 12 },
    hate: { gain: 45, max: 100, decayPerDay: 0.25, desertAt: 20, desertPerWeek: 0.35, hostDesert: 0.02 },
    companionApproval: -6, lieutenantLoyalty: -12,
    ai: { chance: 0.12, cruel: 3, traits: ['cruel', 'ruthless', 'tyrant'], share: 0.3, tenth: 0.1, days: 240, breakMult: 0.45, stability: -4, hateDays: 180, desert: 0.004 },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const Decimation = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.decimation : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...d,
                steel: { ...DEFAULTS.steel, ...(_obj(d.steel) || {}) },
                hate: { ...DEFAULTS.hate, ...(_obj(d.hate) || {}) },
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return Decimation.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = Decimation.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── State ─────────────────────────────────────────────────

    state(player) {
        if (!player) return null;
        if (!_obj(player.decimation)) player.decimation = { v: 1, nextId: 1, broken: [], steelDays: 0, hate: 0, hostSteelDays: 0, log: [], stats: { decimated: 0, dead: 0, spared: 0, deserted: 0 } };
        const st = player.decimation;
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!Array.isArray(st.broken)) st.broken = [];
        if (!Array.isArray(st.log)) st.log = [];
        st.steelDays = _num(st.steelDays);
        st.hostSteelDays = _num(st.hostSteelDays);
        st.hate = _num(st.hate);
        st.stats = { decimated: 0, dead: 0, spared: 0, deserted: 0, ...(_obj(st.stats) || {}) };
        return st;
    },

    _log(player, world, text) {
        const st = Decimation.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > 20) st.log.length = 20;
    },

    // ── Readers ───────────────────────────────────────────────

    /** The morale-break chance of your army x this (steel after a decimation; 1 without). */
    breakMult(player) {
        const st = player && _obj(player.decimation);
        return st && _num(st.steelDays) > 0 ? _num(Decimation.config().steel.breakMult, 0.4) : 1;
    },

    /** Morale points a decimated host fights with on top of its own (player/generalship.js quality). */
    hostMorale(player) {
        const st = player && _obj(player.decimation);
        return st && _num(st.hostSteelDays) > 0 ? _num(Decimation.config().steel.hostMorale, 12) : 0;
    },

    /** The companies awaiting your word, still within their window. */
    pending(player, world) {
        if (!player || !player.decimation) return [];
        const st = Decimation.state(player);
        const day = _day(world);
        st.broken = st.broken.filter(b => day - _num(b.day) <= _num(Decimation.config().windowDays, 20));
        return st.broken;
    },

    hasBusiness(player, world) {
        return Decimation.pending(player, world).length > 0;
    },

    /** A realm's morale-break chance x this (world/kingdomAI.js reads kingdom.decimation directly; here for the panels). */
    realmBreakMult(kingdom, day) {
        const d = kingdom && _obj(kingdom.decimation);
        return d && _num(d.until) > _num(day) ? _num(d.breakMult, 1) : 1;
    },

    // ── The broken ────────────────────────────────────────────

    /**
     * Your men broke. info = { kind: 'army'|'host', foe, units?, men? }. One entry a day for each
     * kind (a rout and its pursuit are one shame). → the entry, or null.
     */
    noteBroken(player, world, info = {}) {
        if (!player || !world || !Decimation.enabled()) return null;
        const st = Decimation.state(player);
        const day = _day(world);
        const kind = info.kind === 'host' ? 'host' : 'army';
        if (st.broken.some(b => b.day === day && b.kind === kind)) return null;
        let men = 0;
        if (kind === 'army') men = (player.army || []).filter(_land).length;
        else men = _num(player.commission && player.commission.men);
        if (kind === 'army' && men < _num(Decimation.config().minUnits, 3)) return null;
        if (kind === 'host' && men < 10) return null;
        const b = { id: st.nextId++, kind, day, foe: info.foe || 'the enemy', men, q: player.q, r: player.r };
        st.broken.push(b);
        if (st.broken.length > 4) st.broken.shift();
        Interrupts.raise(world, { reason: kind === 'host' ? 'The host broke: decimate the companies that ran?' : 'Your men broke and ran: decimate them?', icon: '🎲', source: 'decimation' });
        return b;
    },

    /** How many would die by the lot. */
    toll(player, b) {
        const C = Decimation.config();
        if (!b) return 0;
        if (b.kind === 'host') return Math.max(1, Math.round(_num(player.commission && player.commission.men) / _num(C.tenth, 10)));
        const n = (player.army || []).filter(_land).length;
        if (n < _num(C.minUnits, 3)) return 0;
        return Math.max(1, Math.round(n / _num(C.tenth, 10)));
    },

    /** Decimate them. → { success, text, dead } */
    decimate(player, world, id) {
        const b = Decimation.pending(player, world).find(x => String(x.id) === String(id));
        if (!b) return { success: false, reason: 'No company waits on your word for that.' };
        const C = Decimation.config();
        const st = Decimation.state(player);
        const day = _day(world);
        let deadWords = '';
        let dead = 0;
        if (b.kind === 'host') {
            const c = player.commission;
            if (!c || !(_num(c.men) > 0)) return { success: false, reason: 'You command no host now.' };
            dead = Math.min(_num(c.men), Decimation.toll(player, b));
            c.men = _num(c.men) - dead;
            const k = c.kingdomId != null && typeof world.getKingdom === 'function' ? world.getKingdom(c.kingdomId) : null;
            if (k) k.military = Math.max(0, _num(k.military) - dead);
            for (const lt of c.lieutenants || []) lt.loyalty = Utils.clamp(_num(lt.loyalty) + _num(C.lieutenantLoyalty, -12), 0, 100);
            st.hostSteelDays = Math.max(st.hostSteelDays, _num(C.steel.days, 240));
            deadWords = `${dead} men of the host`;
        } else {
            const land = (player.army || []).filter(_land);
            const n = Decimation.toll(player, b);
            if (!(n > 0)) return { success: false, reason: 'Too few companies left to draw lots.' };
            // The lot: a hash of the day and the company (no shared stream)
            const ranked = land.map((u, i) => ({ u, r: _roll(world, `lot|${b.id}|${i}|${u.type}|${day}`) })).sort((a, z) => a.r - z.r).slice(0, n);
            const names = [];
            if (!player.inventory) player.inventory = {};
            for (const { u } of ranked) {
                const at = player.army.indexOf(u);
                if (at >= 0) player.army.splice(at, 1);
                // (their comrades strip the dead: the kit goes back into your stores)
                const kit = _obj(u.kit);
                if (kit) {
                    for (const slot of ['main', 'off', 'head', 'body', 'legs', 'feet', 'hands']) {
                        const item = kit[slot];
                        if (typeof item === 'string' && item) player.inventory[item] = _num(player.inventory[item]) + 1;
                    }
                }
                names.push(u.name || u.type || 'a company');
            }
            dead = ranked.length;
            st.steelDays = Math.max(st.steelDays, _num(C.steel.days, 240));
            deadWords = names.length === 1 ? `one company, the ${names[0]}` : `${names.length} companies (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})`;
        }
        st.hate = Math.min(_num(C.hate.max, 100), st.hate + _num(C.hate.gain, 45));
        st.broken = st.broken.filter(x => x !== b);
        st.stats.decimated++;
        st.stats.dead += dead;
        // The companions who saw it
        let party = [];
        try { party = Relationships.getTravelPartyMembers(player) || []; } catch (e) { party = []; }
        for (const npc of party) { try { Companions.adjust(npc, _num(C.companionApproval, -6), 'the decimation', day); } catch (e) { /* no companion */ } }
        // The name it makes
        try { Atrocities._brand(player, world, 'decimate', null, { kingdomId: null }); } catch (e) { /* no brand */ }
        try { Traits.recordDeeds(player, { cruelty: 2, dread: 2 }); } catch (e) { /* no traits */ }
        try { Gossip.spreadDeed(player, world, 'decimation', { q: b.q != null ? b.q : player.q, r: b.r != null ? b.r : player.r, victim: 'the men who broke' }); } catch (e) { /* no gossip */ }
        const text = Decimation.line('done', { dead: deadWords }, `${b.id}|${day}`) || `Every tenth man of the companies that broke is beaten to death: ${deadWords}.`;
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The lord'} decimated the companies that broke before ${b.foe}.`, ['war', 'cruelty']);
        Decimation._log(player, world, `Decimated the ${b.kind === 'host' ? 'host' : 'army'} after it broke before ${b.foe}: ${dead} dead.`);
        return { success: true, text, dead };
    },

    /** Let it go. */
    spare(player, world, id) {
        const st = Decimation.state(player);
        const b = st.broken.find(x => String(x.id) === String(id));
        if (!b) return { success: false, reason: 'No company waits on your word for that.' };
        st.broken = st.broken.filter(x => x !== b);
        st.stats.spared++;
        return { success: true, text: Decimation.line('spared', {}, `${b.id}`) || 'You let it go.' };
    },

    // ── The days ──────────────────────────────────────────────

    _playerDay(world, player, day, out) {
        const st = player.decimation;
        if (!_obj(st)) return;
        const C = Decimation.config();
        if (st.steelDays > 0) st.steelDays--;
        if (st.hostSteelDays > 0) st.hostSteelDays--;
        if (st.hate > 0) st.hate = Math.max(0, _r1(st.hate - _num(C.hate.decayPerDay, 0.25)));
        if (day % 7 !== 0 || st.hate < _num(C.hate.desertAt, 20)) return;
        const share = st.hate / 100;
        // A company slips away in the night
        const land = (player.army || []).filter(_land);
        if (land.length && _roll(world, `desert|${day}`) < _num(C.hate.desertPerWeek, 0.35) * share) {
            const u = land[Math.floor(_roll(world, `deserter|${day}`) * land.length) % land.length];
            const at = player.army.indexOf(u);
            if (at >= 0) player.army.splice(at, 1);
            st.stats.deserted++;
            const text = Decimation.line('desert', { unit: u.name || u.type || 'A company' }, `${day}`) || `${u.name || 'A company'} deserted.`;
            Decimation._log(player, world, text);
            out.notices.push({ icon: '🏃', title: 'Deserters', text, type: 'warning' });
        }
        // A host bleeds men
        const c = player.commission;
        if (c && _num(c.men) > 0 && st.hostSteelDays > 0) {
            const gone = Math.ceil(_num(c.men) * _num(C.hate.hostDesert, 0.02) * share);
            if (gone > 0) {
                c.men = Math.max(0, _num(c.men) - gone);
                const k = c.kingdomId != null && typeof world.getKingdom === 'function' ? world.getKingdom(c.kingdomId) : null;
                if (k) k.military = Math.max(0, _num(k.military) - gone);
            }
        }
    },

    /** The realms' broken lines (world.routFeed): a cruel lord decimates his own. */
    _aiDay(world, day, out) {
        const feed = Array.isArray(world.routFeed) ? world.routFeed : null;
        if (!feed) { world.routFeed = []; return; }
        const A = Decimation.config().ai;
        while (feed.length) {
            const e = feed.shift();
            const k = e && typeof world.getKingdom === 'function' ? world.getKingdom(e.kingdomId) : null;
            if (!k || k.isAlive === false) continue;
            const cruel = _traits(k).some(t => (A.traits || []).includes(t));
            const p = _num(A.chance, 0.12) * (cruel ? _num(A.cruel, 3) : 1);
            if (_roll(world, `ai|${k.id}|${e.day}|${e.foe}`) >= Math.min(0.9, p)) continue;
            const dead = Math.max(1, Math.round(_num(k.military) * _num(A.share, 0.3) * _num(A.tenth, 0.1)));
            k.military = Math.max(0, _num(k.military) - dead);
            k.decimation = { day, until: day + _num(A.days, 240), breakMult: _num(A.breakMult, 0.45), hateUntil: day + _num(A.hateDays, 180), dead };
            k.stability = Math.max(0, _num(k.stability, 50) + _num(A.stability, -4));
            const ruler = k.ruler || (k.lord && k.lord.name) || 'the crown';
            const text = Decimation.line('aiDone', { ruler, realm: Names.realm(k.name) }, `${k.id}|${day}`);
            if (text && Array.isArray(world.events)) world.events.push({ text, type: 'military', kingdom: k.id });
        }
        // The hate in their ranks: deserters while it lasts
        if (day % 7 === 0) {
            for (const k of world.kingdoms || []) {
                const d = k && _obj(k.decimation);
                if (!d) continue;
                if (_num(d.hateUntil) > day) k.military = Math.max(0, Math.floor(_num(k.military) * (1 - _num(A.desert, 0.004))));
                else if (_num(d.until) <= day) delete k.decimation;
            }
        }
        void out;
    },

    /** Daily. Player may be null (the world without one). → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Decimation.enabled()) return out;
        const day = _day(world);
        if (player) Decimation._playerDay(world, player, day, out);
        Decimation._aiDay(world, day, out);
        return out;
    },
};
