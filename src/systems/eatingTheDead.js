// ============================================
// EATING THE DEAD — a starving garrison holds on
// ============================================
// When the last of the stores is gone and the gates are still shut, the dead
// are carried to the kitchens. The town holds out for weeks more, and no one
// who lives through it is ever the same — nor is the town's name.
//
//   WHEN     the garrison has starved for minStarvingDays and is not yet too
//            few; twice at most (the second time it gives less).
//   THE DEAD counted: the garrison lost since the siege began and the town's
//            dead of hunger and sickness. Stores: + base + dead x perDead days.
//   THE COST the garrison's morale (the horror), the flux from bad meat (the
//            town's sickness); the town: settlement.ateDead { day, by,
//            epithet } — what the realms call it after (nameOf) — a TownMemory
//            atrocity mark (a grief that lasts generations), its happiness, its
//            townsfolk marked (p.ateDead, their annals); its realm's faith and
//            stability.
//   WHO      the AI garrison you besiege (systems/sieges.js, siegeDay: a daily
//            hash roll once it may, likelier under a cruel lord or when your name
//            says no quarter); a town your commissioned host besieges
//            (player/generalship.js: generalDay); your own besieged holding
//            (systems/holdingSieges.js, holdingDay): you order it or forbid it
//            from the siege panel — left to him, the governor may do it himself.
//            Yours: Atrocities 'ateDead' (karma, the butcher's name, every realm's
//            regard, the chronicle, the news), the faith's standing, the town's
//            loyalty.
//
// State on the siege object (s.dead: starvedDays, times, forbid, popStart) and on
// the settlement (ateDead, saved with the tile). Explicit params, no globals;
// every roll a hash of the world seed. Content and tuning: data/eatingTheDead.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { TownMemory } from './townMemory.js';
import { Townsfolk } from './townsfolk.js';
import { Atrocities } from './atrocities.js';
import { Devotion } from './devotion.js';
import { MaimFaith } from './maimFaith.js';

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
    return (_hash(`${_seed(world)}|eatingTheDead|${key}`) % 100000) / 100000;
}

function _traits(k) {
    const t = k && k.lord && Array.isArray(k.lord.traits) ? k.lord.traits : [];
    return t.map(x => (x && x.id) || x).filter(Boolean);
}

const DEFAULTS = {
    enabled: true, minStarvingDays: 3, minGarrison: 8, townDeadShare: 0.5, base: 10, perDead: 0.12, max: 45, secondMult: 0.5,
    moraleKeep: 0.85, sick: 0.35, happiness: -12, grief: -10, griefLong: 10, faithStanding: 6, realmStability: -3, loyalty: -10,
    ai: { chance: 0.08, cruel: 2, noQuarter: 2.5, generalSlow: 0.5, generalDays: 25 },
    governor: { afterDays: 6, chance: 0.05, cruel: 2 },
    epithets: ['the Hungry'],
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const EatingTheDead = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.eatingTheDead : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...d,
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                governor: { ...DEFAULTS.governor, ...(_obj(d.governor) || {}) },
                epithets: Array.isArray(d.epithets) && d.epithets.length ? d.epithets : DEFAULTS.epithets,
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return EatingTheDead.config().enabled !== false; },

    line(key, vars = {}, salt = '') {
        const pool = EatingTheDead.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── Reading ───────────────────────────────────────────────

    /** The siege's record of it (on the siege object). */
    rec(siege) {
        if (!siege) return null;
        if (!_obj(siege.dead)) siege.dead = { starvedDays: 0, times: 0, forbid: false, popStart: null, lastDay: null, gained: 0 };
        return siege.dead;
    },

    /** The town's name as the realms say it after: "Ashford the Hungry"; the plain name when it never came to that. */
    nameOf(s) {
        if (!s) return '';
        const a = _obj(s.ateDead);
        return a && a.epithet ? `${s.name} ${a.epithet}` : s.name;
    },

    /** The dead the garrison could eat, counted. */
    deadOf(siege, settlement) {
        const C = EatingTheDead.config();
        const r = EatingTheDead.rec(siege);
        const garrisonLost = Math.max(0, _num(siege.garrisonStart) - _num(siege.garrison));
        const popLost = settlement && r.popStart != null ? Math.max(0, r.popStart - _num(settlement.population)) : 0;
        return Math.round(garrisonLost + popLost * _num(C.townDeadShare, 0.5));
    },

    /** May they eat the dead now? → { ok, why } */
    canEat(siege, settlement) {
        const C = EatingTheDead.config();
        const r = EatingTheDead.rec(siege);
        if (!EatingTheDead.enabled()) return { ok: false, why: 'Not done here.' };
        if (r.times >= 2) return { ok: false, why: 'There is nothing left to eat.' };
        if (_num(siege.stores) > 0) return { ok: false, why: 'There is still bread in the stores.' };
        if (r.starvedDays < _num(C.minStarvingDays, 3)) return { ok: false, why: `They have starved only ${r.starvedDays} day${r.starvedDays === 1 ? '' : 's'}.` };
        if (_num(siege.garrison) < _num(C.minGarrison, 8)) return { ok: false, why: 'Too few are left to hold the walls.' };
        if (EatingTheDead.deadOf(siege, settlement) < 3) return { ok: false, why: 'Few enough have died yet.' };
        return { ok: true, why: '' };
    },

    /** Days of stores the dead would make. */
    gainOf(siege, settlement) {
        const C = EatingTheDead.config();
        const r = EatingTheDead.rec(siege);
        const days = Math.min(_num(C.max, 45), _num(C.base, 10) + EatingTheDead.deadOf(siege, settlement) * _num(C.perDead, 0.12));
        return Math.round(days * (r.times >= 1 ? _num(C.secondMult, 0.5) : 1));
    },

    /** One starving day counted (call after the stores are eaten). */
    _count(siege, settlement) {
        const r = EatingTheDead.rec(siege);
        if (r.popStart == null && settlement) r.popStart = _num(settlement.population);
        r.starvedDays = _num(siege.stores) <= 0 ? r.starvedDays + 1 : 0;
        return r;
    },

    // ── The deed ──────────────────────────────────────────────

    /**
     * The garrison eats its dead. who = { kind: 'ai'|'player'|'governor', player, kingdomId, governor }.
     * → { days, text, epithet }
     */
    eat(world, siege, settlement, who = {}) {
        const C = EatingTheDead.config();
        const r = EatingTheDead.rec(siege);
        const day = _day(world);
        const days = EatingTheDead.gainOf(siege, settlement);
        siege.stores = _r1(_num(siege.stores) + days);
        r.times++;
        r.lastDay = day;
        r.gained = _num(r.gained) + days;
        r.starvedDays = 0;
        // The horror: the garrison's heart; the flux from bad meat
        if (typeof siege.morale === 'number') siege.morale = _r1(siege.morale * _num(C.moraleKeep, 0.85));
        if (!siege.townSick && _roll(world, `sick|${siege.q},${siege.r}|${day}`) < _num(C.sick, 0.35)) siege.townSick = true;
        let epithet = null;
        if (settlement) epithet = EatingTheDead._markTown(world, settlement, siege, who, day);
        const vars = { town: settlement ? settlement.name : siege.name, days, epithet: epithet || '', governor: who.governor || 'The governor' };
        const key = who.kind === 'ai' ? 'ai' : who.kind === 'governor' ? 'governor' : 'yours';
        let text = EatingTheDead.line(key, vars, `${siege.q},${siege.r}|${day}`) || `The garrison of ${vars.town} eats its dead.`;
        if (epithet && r.times === 1) text += ` ${EatingTheDead.line('name', vars, `${siege.q},${siege.r}`)}`;
        return { days, text, epithet };
    },

    /** The town is never the same: its name, its memory, its people, its faith. → the epithet. */
    _markTown(world, s, siege, who, day) {
        const C = EatingTheDead.config();
        const first = !_obj(s.ateDead);
        const epithet = first ? C.epithets[_hash(`${_seed(world)}|epithet|${s.name}`) % C.epithets.length] : s.ateDead.epithet;
        const by = who.kind === 'ai' ? (siege.kingdomName || 'its garrison') : (who.player && who.player.name) || 'its garrison';
        s.ateDead = { day: first ? day : _num(s.ateDead.day, day), by, kingdomId: who.kingdomId != null ? who.kingdomId : s.kingdom, epithet, times: first ? 1 : _num(s.ateDead.times, 1) + 1, player: who.kind !== 'ai' };
        if (typeof s.happiness === 'number') s.happiness = Math.max(0, _r1(s.happiness + _num(C.happiness, -12)));
        // The survivors: their annals carry it
        const people = s.folk && Array.isArray(s.folk.people) ? s.folk.people : [];
        for (const p of people) if (p && p.died == null && p.ateDead == null) p.ateDead = day;
        // For the player's own garrison the brand writes the mark (Atrocities 'ateDead'); else the town's memory here
        if (who.kind === 'ai' || !who.player) {
            if (first) {
                try {
                    TownMemory.mark(s, 'atrocity', {
                        what: 'ateDead', by, byPlayer: false, grief: _num(C.grief, -10), long: _num(C.griefLong, 10),
                        line: `{when} the starving garrison of ${s.name} ate its dead rather than open the gates. They call it ${s.name} ${epithet} still.`,
                    }, world);
                } catch (e) { /* no memory */ }
            }
            const k = who.kingdomId != null && typeof world.getKingdom === 'function' ? world.getKingdom(who.kingdomId) : null;
            if (k) k.stability = Math.max(0, _num(k.stability, 50) + _num(C.realmStability, -3));
            if (first && Array.isArray(world.events)) world.events.push({ text: `🦴 Besieged ${s.name} of ${k ? Names.realm(k.name) : 'its realm'}: the starving garrison eats its dead. Men will call it ${s.name} ${epithet}.`, type: 'military', kingdom: who.kingdomId });
        } else {
            const player = who.player;
            if (first) {
                try { Atrocities._brand(player, world, 'ateDead', s, { kingdomId: s.kingdom, vars: { epithet } }); } catch (e) { /* no brand */ }
            }
            const f = MaimFaith.realmFaith(world, s.kingdom);
            if (f) { try { Devotion._addStanding(player, f, -_num(C.faithStanding, 6)); } catch (e) { /* no devotion */ } }
            if (s.holding && typeof s.holding.loyalty === 'number') s.holding.loyalty = Math.max(0, s.holding.loyalty + _num(C.loyalty, -10));
            if (s.colony && typeof s.colony.loyalty === 'number') s.colony.loyalty = Math.max(0, s.colony.loyalty + _num(C.loyalty, -10));
        }
        if (s.folk && first) {
            try { Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: `The garrison ate its dead in the siege. The town has been called ${s.name} ${epithet} ever since.` }); } catch (e) { /* no annals */ }
        }
        return epithet;
    },

    // ── The hooks ─────────────────────────────────────────────

    /**
     * The AI garrison you besiege (Sieges._defendersDay, after the stores are eaten): counts the
     * starving days; once it may, a daily roll — likelier under a cruel lord, or when your name
     * promises no quarter (lastStand). io = { player, kingdomId, lastStand, log(text), notice(title, text, type) }.
     * → the result, or null.
     */
    siegeDay(world, siege, settlement, io = {}) {
        if (!EatingTheDead.enabled() || !siege) return null;
        EatingTheDead._count(siege, settlement);
        if (!EatingTheDead.canEat(siege, settlement).ok) return null;
        const A = EatingTheDead.config().ai;
        const k = io.kingdomId != null && typeof world.getKingdom === 'function' ? world.getKingdom(io.kingdomId) : null;
        let p = _num(A.chance, 0.08);
        const tr = _traits(k);
        if (tr.includes('cruel') || tr.includes('ruthless') || tr.includes('tyrant')) p *= _num(A.cruel, 2);
        if (_num(io.lastStand) > 0) p *= _num(A.noQuarter, 2.5);
        if (_roll(world, `ai|${siege.q},${siege.r}|${_day(world)}`) >= Math.min(0.9, p)) return null;
        const res = EatingTheDead.eat(world, siege, settlement, { kind: 'ai', kingdomId: io.kingdomId });
        if (io.log) io.log(res.text);
        if (io.notice) io.notice('🦴 They Eat Their Dead', res.text, 'warning');
        return res;
    },

    /**
     * Your own besieged holding (HoldingSieges._defendersDay): counts the starving days; if you have
     * neither ordered nor forbidden it, the governor may do it himself. → the result, or null.
     */
    holdingDay(world, player, siege, settlement, governor = null, out = null) {
        if (!EatingTheDead.enabled() || !siege) return null;
        const r = EatingTheDead._count(siege, settlement);
        if (r.forbid || !EatingTheDead.canEat(siege, settlement).ok) return null;
        const G = EatingTheDead.config().governor;
        if (r.starvedDays < _num(G.afterDays, 6)) return null;
        const gov = settlement && settlement.holding && settlement.holding.governor;
        const tr = gov && Array.isArray(gov.traits) ? gov.traits : (gov && gov.st && Array.isArray(gov.st.traits) ? gov.st.traits : []);
        let p = _num(G.chance, 0.05);
        if (tr.includes('cruel') || tr.includes('ruthless')) p *= _num(G.cruel, 2);
        if (_roll(world, `gov|${siege.q},${siege.r}|${_day(world)}`) >= p) return null;
        const res = EatingTheDead.eat(world, siege, settlement, { kind: 'governor', player, kingdomId: settlement ? settlement.kingdom : null, governor: governor || (gov && gov.name) || 'The governor' });
        if (out) out.notices.push({ title: '🦴 They Eat Their Dead', text: res.text, type: 'error' });
        return res;
    },

    /** Order your starving holding's garrison to eat its dead. → { success, text, days } */
    order(player, world, siege, settlement) {
        if (!siege) return { success: false, reason: 'No such siege.' };
        const can = EatingTheDead.canEat(siege, settlement);
        if (!can.ok) return { success: false, reason: can.why };
        const res = EatingTheDead.eat(world, siege, settlement, { kind: 'player', player, kingdomId: settlement ? settlement.kingdom : null });
        return { success: true, text: res.text, days: res.days };
    },

    /** Forbid it (or lift the ban). → { success, text } */
    forbid(player, world, siege, settlement, on = true) {
        if (!siege) return { success: false, reason: 'No such siege.' };
        const r = EatingTheDead.rec(siege);
        r.forbid = !!on;
        const text = on ? EatingTheDead.line('forbid', { town: settlement ? settlement.name : siege.name }, `${siege.q}`) : `You leave it to ${settlement ? settlement.name : siege.name}'s governor.`;
        return { success: true, text };
    },

    /**
     * A town your commissioned host besieges (player/generalship.js _siegeTick): starving, the
     * garrison may eat its dead; for generalDays its surrender comes slower. sg: the host's siege.
     * → true when they hold on this day by it.
     */
    generalDay(world, sg, settlement, starving) {
        if (!EatingTheDead.enabled() || !sg) return false;
        const A = EatingTheDead.config().ai;
        const r = EatingTheDead.rec(sg);
        const day = _day(world);
        if (r.lastDay != null && day - r.lastDay < _num(A.generalDays, 25)) return true;
        r.starvedDays = starving ? r.starvedDays + 1 : 0;
        if (r.times >= 1 || r.starvedDays < _num(EatingTheDead.config().minStarvingDays, 3)) return false;
        if (_roll(world, `gen|${sg.q},${sg.r}|${day}`) >= _num(A.chance, 0.08)) return false;
        r.times = 1;
        r.lastDay = day;
        if (settlement) EatingTheDead._markTown(world, settlement, sg, { kind: 'ai', kingdomId: sg.kingdomId }, day);
        return true;
    },
};
