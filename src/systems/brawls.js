// ============================================
// BRAWLS — the townsfolk come to blows with each other
// ============================================
// Fights between NPCs, for reasons the sim already holds:
//
//   CAUSES — drink and hot tempers in the tavern (more as the night gets
//   late), a grudge between two townsfolk (settlement.brawls.feuds: a debt,
//   an insult, a rival suitor, an affair found out, a field boundary, a
//   cutpurse caught by the mark — systems/npcTheft.js's noticed lifts — or
//   the last fight), a haggle gone wrong at the market, a drunk spoiling for
//   it at night, a thief resisting the watch, rival Houses' retainers in the
//   same town (systems/rivalHouses.js retinues). Tempers come from the
//   person's traits (data temper.traits) and drink.
//
//   A FIGHT (begin → escalate → exchange … → end) climbs from words to a
//   shove to fists, and to steel only when someone is armed and the cause is
//   serious; either side may back down at each step. It ends in a knock-out,
//   one side fleeing, being pulled apart (a peacemaker, the keeper, the
//   player), or the watch arriving. Rarely a knock-out bleeds
//   (systems/downed.js — on the street map the downed system runs it: the
//   wound bound in time, or a body, blood and looters).
//
//   AFTERMATH (settle) — injuries that heal (Townsfolk.injure), a hotter
//   grudge between them, each one's own memory (Townsfolk.note 'brawl'), the
//   town's annals ("Old Wat and the smith came to blows at the tavern"), the
//   town's record of NPC crimes (StreetCrime.recordNpcCrime 'brawl'), the
//   instigator fined and jailed when the watch takes them (fine to the town's
//   purse, p.jailedUntil as systems/npcTheft.js keeps it), and barred from
//   the tavern by its keeper (settlement.brawls.barred — townScenes keeps
//   them out).
//
//   OFF THE MAP (processDay) — every town with a roster: grudges are born and
//   cool, and now and then a fight is simulated whole (simulate) and settled,
//   at a rate by the town's size and its open feuds. The town the player is
//   walking plays its own out (ui/innerMapBrawls.js).
//
// The player can watch, cheer, bet (odds/settleBet), break it up
// (breakUpChance) or join a side — the UI half handles those.
//
// Pure: explicit params, no globals; every roll is a hash stream of the
// world seed, the town, the day and the fight (never the shared RNG), so a
// reload tells the same story and the goldens stand. Data: data/brawls.json.

import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from './townsfolk.js';
import { Duels } from './duels.js';
import { StreetCrime } from './streetCrime.js';
import { Laws } from './laws.js';
import { TownJobs } from './townJobs.js';
import { Romance } from './romance.js';

const DEFAULTS = {
    enabled: true,
    temper: { traits: {}, roles: { child: 0 }, drunk: 1.9, minAge: 16 },
    causes: {
        tavern: { base: 0.16, hours: [17, 3], late: 22, lateMult: 1.8, serious: false, offWeight: 4 },
        grudge: { base: 0.32, perHeat: 0.006, serious: true, offWeight: 5 },
        market: { base: 0.05, hours: [7, 18], serious: false, offWeight: 2 },
        cutpurse: { base: 0.65, serious: false, offWeight: 3 },
        drunk: { base: 0.1, hours: [20, 4], serious: false, offWeight: 2 },
        watch: { resist: 0.35, serious: true, offWeight: 0 },
        retainers: { perDay: 0.18, serious: true, offWeight: 0 },
    },
    grudges: {
        perDay: { village: 0.04, town: 0.07, city: 0.1, capital: 0.12 },
        decayPerDay: 0.35, forgetBelow: 4, max: 24,
        reasons: { insult: { weight: 1, heat: [15, 30], text: 'an insult' } },
        afterFight: { loser: 30, winner: 8, parted: 18, ally: 12 },
    },
    escalation: {
        stages: ['words', 'shove', 'fists', 'weapons'],
        seconds: { words: [3.5, 5.5], shove: [1.6, 2.4] },
        backDown: { words: 0.3, shove: 0.15 }, temperBackDown: 0.5,
        toSteel: 0.35, toSteelBelowHp: 0.6, armedTypes: ['guard', 'noble', 'traveler'],
    },
    fight: {
        swingEvery: [0.85, 1.35],
        hit: { base: 0.58, perPoint: 0.05, min: 0.25, max: 0.88, drunk: -0.12 },
        scale: { fists: 3, weapons: 2 },
        fleeBelow: 0.3, fleeChance: 0.45, maxSeconds: 45, knockback: 0.16,
    },
    bystanders: {
        ringRadius: 9, ringMax: 7, ringDistance: [2, 3], joinChance: { kin: 0.55, friend: 0.3, retainer: 0.6 }, maxPerSide: 3,
        joinAfter: [2, 5], peacemakerTraits: ['kind', 'cautious'], peacemakerRoles: ['priest'], peacemakerAfter: [6, 10],
        separate: 0.45, keeperSeparate: 0.6, tendChance: 0.6, tendAfter: [4, 8],
    },
    watch: {
        hearRadius: 20, hearDelay: [2, 5], indoorDelay: [10, 16], arrestSeconds: 6,
        fine: { words: 0, shove: 2, fists: 6, weapons: 25 }, jailDays: { fists: 3, weapons: 15, death: 60 },
        arrestChance: { village: 0.25, town: 0.4, city: 0.55, capital: 0.65 }, resistStance: 4,
    },
    death: { bleed: { fists: 0.025, weapons: 0.3 }, tended: 0.65 },
    aftermath: { barDays: [20, 45], barChance: 0.6, logMax: 12 },
    offscreen: {
        perDay: { village: 0.012, town: 0.03, city: 0.05, capital: 0.06 }, perFeud: 0.15, maxMult: 3,
        watchShare: { village: 0.15, town: 0.3, city: 0.45, capital: 0.55 }, partedShare: 0.35, fledShare: 0.2,
    },
    onMap: { scanEvery: [5, 9], playerRadius: 20, pairRadius: 3, grudgeRadius: 8, cooldown: [25, 50], maxActive: 1 },
    betting: { bookieRing: 4, bookieChance: 0.85, stake: 10, stakes: [5, 10, 25], margin: 0.1, minOdds: 1.15, maxOdds: 5 },
    player: {
        cheer: { side: 4, foe: -4, spirit: 0.06 },
        breakUp: { base: 0.4, perStrength: 0.04, perCharisma: 0.03, ruler: 0.35, guardBonus: 0.15, thanks: 5, shove: 6 },
        join: { side: 10, foe: -25 },
    },
    barks: {},
    rumours: {},
    places: { tavern: 'at the tavern', market: 'at the market', street: 'in the street', square: 'in the square' },
};

const STAGE_RANK = { words: 0, shove: 1, fists: 2, weapons: 3 };
const RIVAL_TYPE = 'rival_retinue';

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function _arr(v) { return Array.isArray(v) ? v : []; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _byType = (table, type) => _num((table || {})[type], _num((table || {}).town, 0));

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _span(range, u) {
    const [a, b] = Array.isArray(range) ? range : [range, range];
    return _num(a) + (_num(b, _num(a)) - _num(a)) * u;
}

function _fill(text, vars) {
    let s = String(text || '');
    for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(v == null ? '' : v);
    return s;
}

function _weighted(entries, u) {
    const list = entries.filter(e => e && _num(e.w) > 0);
    const total = list.reduce((t, e) => t + e.w, 0);
    if (!total) return null;
    let roll = u * total;
    for (const e of list) { roll -= e.w; if (roll <= 0) return e; }
    return list[list.length - 1];
}

/** Is `h` (an hour, 0–24) inside [from, to) — which may wrap past midnight? */
function _inHours(h, range) {
    if (!Array.isArray(range)) return true;
    const [a, b] = range;
    return a <= b ? h >= a && h < b : h >= a || h < b;
}

export const Brawls = {
    DEFAULTS,
    STAGE_RANK,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.brawls : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    /** A town's fight book (saved with the tile): feuds, who is barred, the latest fights. */
    state(s) {
        if (!s) return null;
        if (!_obj(s.brawls)) s.brawls = { feuds: {}, barred: {}, log: [], n: 0 };
        const st = s.brawls;
        if (!_obj(st.feuds)) st.feuds = {};
        if (!_obj(st.barred)) st.barred = {};
        if (!Array.isArray(st.log)) st.log = [];
        if (!Number.isFinite(st.n)) st.n = 0;
        return st;
    },

    /** A hash in [0, 1) for these parts (the module's one source of chance). */
    frac(...parts) { return _frac(parts.join('|')); },

    // ──────────── WHO FIGHTS ────────────

    /** How quick to fight: traits × role × drink (0 for a child or a priest who will not). */
    temper(traits, role, drunk = false) {
        const T = Brawls.config().temper;
        let t = 1;
        for (const tr of _arr(traits)) if (T.traits[tr] != null) t *= _num(T.traits[tr], 1);
        if (role && T.roles[role] != null) t *= _num(T.roles[role], 1);
        if (drunk) t *= _num(T.drunk, 1.9);
        return Math.round(t * 1000) / 1000;
    },

    /** A person's temper (roster person). */
    temperOf(p, drunk = false) {
        return p ? Brawls.temper(p.traits, p.role, drunk) : 0;
    },

    /** The duel-profile shim of a roster person or an inner-map NPC (for Duels.fromNpc). */
    _shim(who) {
        if (!who) return { type: 'villager', personalityTraits: [] };
        if (who.personalityTraits) return who;   // an inner-map NPC
        return { id: who.id, type: who.type || (who.role === 'child' ? 'child' : who.role) || 'villager', personalityTraits: _arr(who.traits) };
    },

    /**
     * A combatant for a fight: { key, pid, npcId, name, type, hp, max, attack, defense, power,
     * weaponDmg, temperament, armed, drunk, side, out, ally, spirit }.
     * `who`: a roster person or an inner-map NPC (its _person read for the pid); opts { hpNow, drunk, name, type, key }.
     */
    fighter(who, opts = {}) {
        const E = Brawls.config().escalation;
        const shim = Brawls._shim(opts.type ? { ...(who || {}), type: opts.type, role: opts.type } : who);
        let c;
        try { c = Duels.fromNpc(shim); } catch (e) { c = { attack: 1, defense: 1.5, power: 5, weaponDmg: 0, maxHp: 22, temperament: 'balanced' }; }
        const max = Math.max(10, Math.round(_num(c.maxHp, 22) * 3.5));
        const person = who && who.personalityTraits ? who._person || null : who;
        const pid = person && person.id != null && !who.personalityTraits ? person.id : (who && who._person ? who._person.id : null);
        const type = shim.type || 'villager';
        return {
            key: opts.key || (who && who.personalityTraits ? `n${who.id}` : `p${pid != null ? pid : 'x'}`),
            pid: pid != null ? pid : null,
            npcId: who && who.personalityTraits ? who.id : null,
            name: opts.name || (who && who.personalityTraits ? (who.name || 'Someone') : (person ? Townsfolk.name(person) : 'Someone')),
            type,
            traits: _arr(shim.personalityTraits).slice(),
            hp: Math.max(1, Math.min(max, Math.round(opts.hpNow != null ? _num(opts.hpNow, max) : max))),
            max,
            attack: _num(c.attack, 1), defense: _num(c.defense, 1.5), power: _num(c.power, 5), weaponDmg: _num(c.weaponDmg),
            temperament: c.temperament || 'balanced',
            armed: _arr(E.armedTypes).includes(type) || _num(c.weaponDmg) > 0,
            drunk: !!opts.drunk,
            side: 0, out: null, ally: false, spirit: 0, bleed: false, by: null,
        };
    },

    /**
     * The chance two people come to words at one look, for a cause.
     * ctx { hour, heat (grudge), drunkA, drunkB } — 0 when the hour is wrong or one won't fight.
     */
    startChance(cause, a, b, ctx = {}) {
        const C = Brawls.config();
        const K = C.causes[cause];
        if (!K || !a || !b) return 0;
        const h = _num(ctx.hour, 12);
        if (K.hours && !_inHours(h, K.hours)) return 0;
        const ta = a.personalityTraits ? Brawls.temper(a.personalityTraits, a.type, ctx.drunkA) : Brawls.temperOf(a, ctx.drunkA);
        const tb = b.personalityTraits ? Brawls.temper(b.personalityTraits, b.type, ctx.drunkB) : Brawls.temperOf(b, ctx.drunkB);
        if (ta <= 0 || tb <= 0) return 0;
        let p = _num(K.base, 0.1);
        if (cause === 'tavern' && K.late != null && (h >= K.late || h < 4)) p *= _num(K.lateMult, 1);
        if (cause === 'grudge') p += _num(ctx.heat) * _num(K.perHeat);
        // The hotter of the two counts most
        p *= Math.max(ta, tb) * 0.7 + Math.min(ta, tb) * 0.3;
        return _clamp(p, 0, 0.95);
    },

    // ──────────── GRUDGES ────────────

    feudKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; },

    feud(s, a, b) {
        const st = s && s.brawls;
        return st && st.feuds ? st.feuds[Brawls.feudKey(a, b)] || null : null;
    },

    /** Start or warm a grudge between two townsfolk: { a, b, why, d, heat }. */
    addFeud(s, a, b, why, day, heat) {
        if (a == null || b == null || a === b) return null;
        const st = Brawls.state(s);
        const k = Brawls.feudKey(a, b);
        const f = st.feuds[k] || (st.feuds[k] = { a, b, why, d: _num(day), heat: 0 });
        f.heat = _clamp(_num(f.heat) + _num(heat), 0, 100);
        if (why && (why !== 'fight' || !f.why)) f.why = why;
        f.d = _num(day);
        // Keep the hottest few
        const G = Brawls.config().grudges;
        const keys = Object.keys(st.feuds);
        if (keys.length > _num(G.max, 24)) {
            keys.sort((x, y) => st.feuds[x].heat - st.feuds[y].heat);
            for (const kk of keys.slice(0, keys.length - _num(G.max, 24))) delete st.feuds[kk];
        }
        return f;
    },

    /** The words for a grudge's cause ("a debt unpaid"). */
    whyText(f) {
        const R = (Brawls.config().grudges.reasons || {})[f && f.why];
        return R && R.text ? R.text.replace('{gender}', (f && f.suitor) || 'lass') : 'what happened';
    },

    /**
     * What a person knows of their own fights, for their voice (the AI chat's
     * prompt): the brawls they were in lately (whom with, over what, how it
     * went) and the grudges they hold. live: { foe, cause } of a fight on the
     * street map right now. → [sentence]
     */
    selfLines(world, s, p, day, live = null, withinDays = 30) {
        const out = [];
        const folk = s && s.folk;
        const C = Brawls.config();
        const label = (cause) => ((C.causes || {})[cause] || {}).label || null;
        const nameOf = (pid) => { const o = folk && pid != null ? Townsfolk.get(folk, pid) : null; return o ? o.name : null; };
        const d0 = _num(day);
        if (live && live.foe) {
            const why = label(live.cause);
            out.push(`You are in a fight right now (or just broke off from one) with ${live.foe}${why ? `, over ${why}` : ''}. You know exactly why, and you have feelings about it.`);
        }
        if (!p) return out;
        const st = s && s.brawls;
        const log = (st && Array.isArray(st.log) ? st.log : []).filter(e => (e.ap === p.id || e.bp === p.id) && d0 - _num(e.d) <= withinDays);
        const HOW = { ko: 'it ended with someone knocked senseless', fled: 'it ended with someone running off', death: 'someone died of it', watch: 'the watch broke it up', parted: 'you were pulled apart', backDown: 'it never came to blows', won: 'it was settled' };
        for (const e of log.slice(-3).reverse()) {
            const started = e.ap === p.id;
            const other = started ? e.b : e.a;
            const ago = d0 - _num(e.d);
            const when = ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
            const why = label(e.cause);
            let line = `${when[0].toUpperCase()}${when.slice(1)} you came to blows with ${other}${why ? ` over ${why}` : ''}${e.place ? ` (in the ${e.place})` : ''}; ${started ? 'you started it' : 'they started it'}; ${HOW[e.how] || 'it ended'}.`;
            if (started && e.arrested) line += ' The watch took you for it.';
            out.push(line);
        }
        for (const { feud, other } of Brawls.feudsOf(s, p.id).sort((x, y) => _num(y.feud.heat) - _num(x.feud.heat)).slice(0, 2)) {
            const n = nameOf(other);
            if (!n || _num(feud.heat) < 5) continue;
            out.push(`You hold a grudge against ${n} over ${Brawls.whyText(feud)}${_num(feud.heat) >= 50 ? ', and it runs hot' : ''}.`);
        }
        return out;
    },

    /** Feuds of one person: [{ feud, other }]. */
    feudsOf(s, pid) {
        const st = s && s.brawls;
        if (!st || !st.feuds) return [];
        return Object.values(st.feuds).filter(f => f.a === pid || f.b === pid).map(f => ({ feud: f, other: f.a === pid ? f.b : f.a }));
    },

    /** Barred from the tavern today? */
    isBarred(s, pid, day) {
        const st = s && s.brawls;
        const until = st && st.barred ? st.barred[pid] : null;
        return until != null && _num(day) < until;
    },

    /** Grudges born today in a town, from reasons that fit its people. → feud or null */
    seedGrudge(world, s, day) {
        const G = Brawls.config().grudges;
        if (!s || !s.folk) return null;
        const key = `${_seed(world)}|grudge|${s.q},${s.r}|${day}`;
        if (_frac(key) >= _byType(G.perDay, s.type)) return null;
        const adults = Townsfolk.residents(s.folk).filter(p => Townsfolk.age(p, day) >= _num(Brawls.config().temper.minAge, 16) && p.role !== 'child');
        if (adults.length < 2) return null;
        const pick = (list, salt) => list.length ? list[Math.floor(_frac(`${key}|${salt}`) * list.length) % list.length] : null;
        const options = [];
        for (const [id, R] of Object.entries(G.reasons || {})) {
            if (_num(R.weight) <= 0) continue;
            let pair = null;
            if (id === 'rivalSuitor' || id === 'affair') {
                // Only real bad blood from love (systems/romance.js), never a random pair
                const love = Brawls.loveGrudges(s, day, id).filter(g => adults.includes(g.a) && adults.includes(g.b));
                const g = pick(love, id === 'affair' ? 'af1' : 'rs1');
                if (g) pair = id === 'rivalSuitor' ? [g.a, g.b, g.a.gender === 'female' ? 'lad' : 'lass'] : [g.a, g.b];
            } else if (id === 'boundary') {
                const farmers = adults.filter(p => p.role === 'farmer');
                const a = pick(farmers, 'bd1');
                const b = a && pick(farmers.filter(p => p !== a), 'bd2');
                if (a && b) pair = [a, b];
            } else if (id === 'debt') {
                const a = pick(adults.filter(p => p.role === 'merchant' || p.role === 'blacksmith_npc' || p.role === 'farmer'), 'db1');
                const b = a && pick(adults.filter(p => p !== a), 'db2');
                if (a && b) pair = [a, b];
            } else {
                const a = pick(adults, `${id}1`);
                const b = a && pick(adults.filter(p => p !== a), `${id}2`);
                if (a && b) pair = [a, b];
            }
            if (pair) options.push({ w: _num(R.weight), id, pair, R });
        }
        const choice = _weighted(options, _frac(`${key}|why`));
        if (!choice) return null;
        const [a, b] = choice.pair;
        const heat = Math.round(_span(choice.R.heat || [15, 30], _frac(`${key}|heat`)));
        const f = Brawls.addFeud(s, a.id, b.id, choice.id, day, heat);
        if (f && choice.pair[2]) f.suitor = choice.pair[2];
        return f;
    },

    /**
     * Bad blood from love in a town, not yet a feud: rival suitors and the
     * wronged spouse against the lover (Romance.grudges, and each person's
     * 'rivalInLove' / 'betrayed' logs) within grudges.loveDays.
     * why: 'rivalSuitor' | 'affair'. → [{ a, b, why, d }] (people)
     */
    loveGrudges(s, day, why) {
        const folk = s && s.folk;
        if (!folk) return [];
        const since = _num(day) - _num(Brawls.config().grudges.loveDays, 90);
        const out = [];
        const seen = new Set();
        const add = (aid, bid, d) => {
            if (aid == null || bid == null || aid === bid) return;
            const k = aid < bid ? `${aid}|${bid}` : `${bid}|${aid}`;
            if (seen.has(k) || Brawls.feud(s, aid, bid)) return;
            const a = Townsfolk.get(folk, aid);
            const b = Townsfolk.get(folk, bid);
            if (!a || !b || a.died != null || b.died != null || !Townsfolk.isHere(a) || !Townsfolk.isHere(b)) return;
            seen.add(k);
            out.push({ a, b, why, d });
        };
        let list = [];
        try { list = Romance.grudges(folk, since); } catch (e) { list = []; }
        for (const g of list) if (g && g.why === why) add(g.a, g.b, g.d);
        // (their own logs keep it too: the betrayed spouse and the lover, the two suitors)
        const kind = why === 'affair' ? 'betrayed' : 'rivalInLove';
        for (const p of folk.people || []) {
            for (const e of p.log || []) {
                if (e.k !== kind || e.o == null || _num(e.d) < since) continue;
                if (why === 'affair') {
                    // (the lover, by name, of the one who strayed: their 'rivalInLove' log the same day)
                    const lover = (p.log || []).find(x => x.k === 'rivalInLove' && x.d === e.d && x.o != null && x.o !== e.o);
                    if (lover) add(p.id, lover.o, e.d);
                } else if (!(p.log || []).some(x => x.k === 'betrayed' && x.d === e.d)) add(p.id, e.o, e.d);
            }
        }
        return out.sort((x, y) => y.d - x.d || x.a.id - y.a.id);
    },

    /** A cutpurse noticed today by a townsperson (systems/npcTheft.js's case) leaves a grudge. */
    _cutpurseGrudges(s, day) {
        const out = [];
        const cases = s && s.npcTheft && Array.isArray(s.npcTheft.cases) ? s.npcTheft.cases : [];
        const R = (Brawls.config().grudges.reasons || {}).cutpurse || { heat: [35, 55] };
        for (const c of cases) {
            if (!c || c.k !== 'pickpocket' || c.d !== day || !c.named || !c.thief || c.thief.pid == null) continue;
            if (!c.victim || c.victim.kind !== 'npc' || c.victim.pid == null) continue;
            const f = Brawls.addFeud(s, c.victim.pid, c.thief.pid, 'cutpurse', day, Math.round(_span(R.heat, _frac(`cp|${c.id}|${day}`))));
            if (f) out.push(f);
        }
        return out;
    },

    // ──────────── THE FIGHT ────────────

    /**
     * Begin a fight: `a` the one who starts it (the instigator), `b` the other (fighters).
     * opts { key, cause, place, placeName, day, hour, town }
     */
    begin(a, b, opts = {}) {
        a.side = 0;
        b.side = 1;
        return {
            key: String(opts.key || `${a.key}|${b.key}|${_num(opts.day)}`),
            cause: opts.cause || 'tavern', place: opts.place || 'street', placeName: opts.placeName || null,
            day: _num(opts.day), hour: _num(opts.hour, 12), town: opts.town || null,
            stage: 'words', n: 0, secs: 0,
            sides: [[a], [b]],
            instigator: a.key, foe: b.key,
            ended: null, partedBy: null,
        };
    },

    /** The next roll of a fight's own stream. */
    roll(fight, salt = '') {
        fight.n = _num(fight.n) + 1;
        return _frac(`${fight.key}|${salt}|${fight.n}`);
    },

    fighters(fight) { return [...fight.sides[0], ...fight.sides[1]]; },
    standing(fight, side) { return fight.sides[side].filter(f => !f.out); },
    find(fight, key) { return Brawls.fighters(fight).find(f => f.key === key) || null; },
    instigatorOf(fight) { return Brawls.find(fight, fight.instigator) || fight.sides[0][0]; },
    foeOf(fight) { return Brawls.find(fight, fight.foe) || fight.sides[1][0]; },

    /** Is this cause serious enough for steel? */
    serious(fight) {
        const K = Brawls.config().causes[fight.cause];
        if (fight.cause === 'grudge' && _num(fight.heat) >= 60) return true;
        return !!(K && K.serious);
    },

    /**
     * The end of a stage: climb, or back down. Returns { stage, backDown }.
     * Words → shove → fists; the hot-tempered back down less.
     */
    escalate(fight) {
        const E = Brawls.config().escalation;
        if (fight.ended) return { stage: fight.stage, backDown: false };
        const st = fight.stage;
        if (st === 'words' || st === 'shove') {
            const tempers = Brawls.fighters(fight).map(f => Brawls.temper(f.traits, f.type, f.drunk));
            const hot = Math.max(0.3, ...tempers);
            const back = _num(E.backDown[st]) * (1 + (1 - Math.min(2, hot)) * _num(E.temperBackDown, 0.5));
            if (Brawls.roll(fight, `esc${st}`) < _clamp(back, 0, 0.9)) {
                Brawls.end(fight, 'backDown', null);
                return { stage: st, backDown: true };
            }
            fight.stage = st === 'words' ? 'shove' : 'fists';
            return { stage: fight.stage, backDown: false };
        }
        return { stage: st, backDown: false };
    },

    /** Mid-fight: someone armed, the cause serious, the blood up — steel comes out. → true when it does. */
    maybeSteel(fight) {
        const E = Brawls.config().escalation;
        if (fight.stage !== 'fists' || fight.ended || !Brawls.serious(fight)) return false;
        const armed = Brawls.fighters(fight).filter(f => !f.out && f.armed);
        if (!armed.length) return false;
        const hurt = Brawls.fighters(fight).some(f => !f.out && f.hp / f.max < _num(E.toSteelBelowHp, 0.6));
        if (!hurt) return false;
        if (Brawls.roll(fight, 'steel') >= _num(E.toSteel, 0.35)) return false;
        fight.stage = 'weapons';
        return true;
    },

    /** One blow's damage before the roll: bare fists (strength) or the weapon (Duels.swingBase). */
    _blowBase(att, stage) {
        const F = Brawls.config().fight;
        const B = (Duels.config().brawl) || {};
        if (stage === 'weapons' && att.armed) {
            let base;
            try { base = Duels.swingBase({ kind: 'npc', power: att.power, weaponDmg: att.weaponDmg }); } catch (e) { base = 4; }
            return base * _num(F.scale.weapons, 2);
        }
        const str = Math.max(1, (att.power - 4 - att.weaponDmg) / 0.6);
        return (_num(B.base, 2) + str * _num(B.perStrength, 1.2)) * _num(F.scale.fists, 3);
    },

    /**
     * One swing of `att` at `def` → { hit, dmg, ko, bleed, fled, shove }.
     * A shove hurts no one. A knock-out may bleed (death.bleed by stage).
     */
    exchange(fight, att, def) {
        const C = Brawls.config();
        const F = C.fight;
        if (!att || !def || att.out || def.out || fight.ended) return { hit: false, dmg: 0 };
        if (fight.stage === 'words') return { hit: false, dmg: 0 };
        if (fight.stage === 'shove') return { hit: true, dmg: 0, shove: true };
        const H = F.hit;
        let p = _num(H.base, 0.58) + (att.attack - def.defense) * _num(H.perPoint, 0.05) + _num(att.spirit);
        if (att.drunk) p += _num(H.drunk);
        p = _clamp(p, _num(H.min, 0.25), _num(H.max, 0.88));
        if (Brawls.roll(fight, `hit${att.key}`) >= p) return { hit: false, dmg: 0 };
        const dmg = Math.max(1, Math.round(Brawls._blowBase(att, fight.stage) * (0.75 + Brawls.roll(fight, 'dmg') * 0.5)));
        def.hp = Math.max(0, def.hp - dmg);
        const res = { hit: true, dmg, ko: false, bleed: false, fled: false };
        if (def.hp <= 0) {
            def.out = 'ko';
            def.by = att.key;
            res.ko = true;
            const bleedP = _num((C.death.bleed || {})[fight.stage], 0);
            if (Brawls.roll(fight, 'bleed') < bleedP) { def.bleed = true; res.bleed = true; }
        } else if (def.hp / def.max < _num(F.fleeBelow, 0.3) && def.temperament !== 'aggressive' && Brawls.roll(fight, 'flee') < _num(F.fleeChance, 0.45)) {
            def.out = 'fled';
            def.by = att.key;
            res.fled = true;
        }
        Brawls.checkEnd(fight);
        return res;
    },

    /** A side with no one standing has lost. → the ending or null */
    checkEnd(fight) {
        if (fight.ended) return fight.ended;
        for (const side of [0, 1]) {
            if (Brawls.standing(fight, side).length) continue;
            const main = side === 0 ? Brawls.instigatorOf(fight) : Brawls.foeOf(fight);
            const how = main && main.out === 'fled' ? 'fled' : 'ko';
            return Brawls.end(fight, how, 1 - side);
        }
        return null;
    },

    /** End it: how ('ko'|'fled'|'parted'|'watch'|'backDown'|'death'), the winning side (or null). */
    end(fight, how, winner = null, by = null) {
        if (fight.ended) return fight.ended;
        fight.ended = { how, winner, by };
        return fight.ended;
    },

    /** Kin or a friend wades in on a side (at most maxPerSide a side). → true when they do. */
    join(fight, f, side) {
        const B = Brawls.config().bystanders;
        if (fight.ended || Brawls.standing(fight, side).length >= _num(B.maxPerSide, 3)) return false;
        if (Brawls.find(fight, f.key)) return false;
        f.side = side;
        f.ally = true;
        fight.sides[side].push(f);
        return true;
    },

    /** Does a bystander related to a fighter wade in? rel: 'kin'|'friend'|'retainer'. */
    joinRoll(fight, rel, who) {
        const B = Brawls.config().bystanders;
        const p = _num((B.joinChance || {})[rel], 0);
        return p > 0 && Brawls.roll(fight, `join${who}`) < p;
    },

    /** Can this person make peace (kind, cautious, a priest)? */
    peacemaker(traits, role) {
        const B = Brawls.config().bystanders;
        return _arr(B.peacemakerRoles).includes(role) || _arr(traits).some(t => _arr(B.peacemakerTraits).includes(t));
    },

    /** Someone tries to pull them apart: by 'peace' (a bystander), 'keeper', 'player' (chance given). → true when it ends. */
    separate(fight, by = 'peace', chance = null) {
        const B = Brawls.config().bystanders;
        if (fight.ended) return false;
        const p = chance != null ? chance : by === 'keeper' ? _num(B.keeperSeparate, 0.6) : _num(B.separate, 0.45);
        // Steel is harder to stop (a chance given in, the player's breakUpChance, has its own steel already: not twice)
        const q = fight.stage === 'weapons' && chance == null ? p * 0.6 : p;
        if (Brawls.roll(fight, `sep${by}`) >= q) return false;
        Brawls.end(fight, 'parted', null, by);
        fight.partedBy = by;
        return true;
    },

    /** The watch arrives: it's over. */
    watchArrives(fight) {
        if (fight.ended) return fight.ended;
        return Brawls.end(fight, 'watch', null, 'watch');
    },

    /** Will a caught thief fight the watch rather than go quietly? (Duels.brawlStance-like: bold, strong, desperate.) */
    resists(world, thief, key) {
        const C = Brawls.config();
        const t = thief && thief.personalityTraits ? Brawls.temper(thief.personalityTraits, thief.type) : Brawls.temperOf(thief);
        return _frac(`${_seed(world)}|resist|${key}`) < _clamp(_num(C.causes.watch.resist, 0.35) * Math.max(0.2, t), 0, 0.9);
    },

    /**
     * A whole fight played out off the map (or a scuffle no one watched):
     * words, a shove, fists (maybe steel), allies, the watch, peacemakers. opts { town (type), allies: [[fighter, side]] }.
     */
    simulate(fight, opts = {}) {
        const O = Brawls.config().offscreen;
        const type = opts.town || 'town';
        if (Brawls.escalate(fight).backDown) return fight;
        if (Brawls.escalate(fight).backDown) return fight;
        for (const [f, side] of opts.allies || []) {
            if (Brawls.joinRoll(fight, f.rel || 'kin', f.key)) Brawls.join(fight, f, side);
        }
        const watchP = _byType(O.watchShare, type) * 0.12;
        const partP = _num(O.partedShare, 0.35) * 0.1;
        for (let round = 0; round < 60 && !fight.ended; round++) {
            for (const side of [0, 1]) {
                const att = Brawls.standing(fight, side);
                const def = Brawls.standing(fight, 1 - side);
                for (const a of att) {
                    const d = def.filter(x => !x.out)[0];
                    if (!d || fight.ended) break;
                    Brawls.exchange(fight, a, d);
                }
                if (fight.ended) break;
            }
            if (fight.ended) break;
            Brawls.maybeSteel(fight);
            if (round >= 1 && Brawls.roll(fight, 'offwatch') < watchP) { Brawls.watchArrives(fight); break; }
            if (round >= 2 && Brawls.roll(fight, 'offpart') < partP) { Brawls.end(fight, 'parted', null, 'peace'); fight.partedBy = 'peace'; break; }
        }
        if (!fight.ended) Brawls.end(fight, 'parted', null, 'peace');
        // The bleeding: bound in time, or not (systems/downed.js on the map; here, the odds of it)
        for (const f of Brawls.fighters(fight)) {
            if (f.out === 'ko' && f.bleed) {
                if (Brawls.roll(fight, `tend${f.key}`) >= _num(Brawls.config().death.tended, 0.65)) { f.out = 'dead'; fight.death = true; }
                else f.bleed = false;
            }
        }
        if (fight.death && fight.ended && fight.ended.how !== 'watch') fight.ended.how = 'death';
        return fight;
    },

    // ──────────── THE PLAYER ────────────

    /** A side's strength (who stands, how hurt, how they fight). */
    _strength(fight, side) {
        return Brawls.standing(fight, side).reduce((t, f) => t + (f.hp / f.max) * (2 + f.attack + f.defense + (fight.stage === 'weapons' && f.armed ? f.weaponDmg : 0)) * (1 + _num(f.spirit)), 0);
    },

    /** The chance a side wins, and the odds a bookie in the crowd gives on it. */
    odds(fight, side) {
        const Bt = Brawls.config().betting;
        const a = Brawls._strength(fight, side);
        const b = Brawls._strength(fight, 1 - side);
        const p = a + b > 0 ? _clamp(a / (a + b), 0.05, 0.95) : 0.5;
        const odds = _clamp((1 / p) * (1 - _num(Bt.margin, 0.1)), _num(Bt.minOdds, 1.15), _num(Bt.maxOdds, 5));
        return { p: Math.round(p * 100) / 100, odds: Math.round(odds * 100) / 100 };
    },

    /** May the player bet here? Gaming forbidden makes it a quiet wager (still taken). */
    betting(world, s) {
        let g = { legal: true, why: '' };
        try { g = Laws.gambling(world, s); } catch (e) { g = { legal: true, why: '' }; }
        return { legal: !!g.legal, why: g.why || '' };
    },

    /** A bet's result once the fight is over: { won, payout } (payout includes the stake back). Void when no winner. */
    settleBet(bet, fight) {
        if (!bet || !fight || !fight.ended) return { won: false, payout: 0, void: true };
        const w = fight.ended.winner;
        if (w == null) return { won: false, payout: bet.stake, void: true };
        if (w !== bet.side) return { won: false, payout: 0 };
        return { won: true, payout: Math.round(bet.stake * bet.odds) };
    },

    /** The chance the player pulls them apart: strength, charisma, the ruler's word. */
    breakUpChance(player, fight, opts = {}) {
        const P = Brawls.config().player.breakUp;
        let p = _num(P.base, 0.4) + _num(player && player.strength, 5) * _num(P.perStrength) + _num(player && player.charisma, 5) * _num(P.perCharisma);
        if (opts.ruler) p += _num(P.ruler);
        if (opts.guard) p += _num(P.guardBonus);
        if (fight && fight.stage === 'weapons') p *= 0.7;
        return _clamp(p, 0.05, 0.95);
    },

    // ──────────── AFTERMATH ────────────

    /** "{a} and {b} came to blows at the tavern {when}" — by how it ended. */
    rumour(fight, names = {}) {
        const C = Brawls.config();
        const how = fight.ended ? fight.ended.how : 'parted';
        const pool = _arr((C.rumours || {})[fight.cause === 'retainers' ? 'retainers' : how]);
        const line = pool.length ? pool[Math.floor(_frac(`${fight.key}|rumour`) * pool.length) % pool.length] : '{a} and {b} came to blows {place} {when}.';
        const a = Brawls.instigatorOf(fight);
        const b = Brawls.foeOf(fight);
        let na = names.a || (a && a.name) || 'someone';
        let nb = names.b || (b && b.name) || 'someone';
        // ("{a} knocked {b} senseless": {a} is the one left standing — when the one picked on won, it's them)
        if (['ko', 'fled', 'death'].includes(how) && fight.cause !== 'retainers' && fight.ended && fight.ended.winner === 1) [na, nb] = [nb, na];
        return _fill(line, { a: na, b: nb, place: fight.placeName || C.places[fight.place] || 'the street' });
    },

    /**
     * Write what the fight left behind. opts { day, seenBy: [names], witnesses: [npcs], onMap,
     * arrest: true|false|null (null: as the watch ending says), bar: true|false|null }.
     * → { how, line, arrested, barred, fine, deaths: [pid], notices }
     */
    settle(world, s, fight, opts = {}) {
        const C = Brawls.config();
        const st = Brawls.state(s);
        const folk = s && s.folk;
        const day = _num(opts.day, _num(world && world.day));
        const how = fight.ended ? fight.ended.how : 'parted';
        const winner = fight.ended ? fight.ended.winner : null;
        const a = Brawls.instigatorOf(fight);
        const b = Brawls.foeOf(fight);
        const P = id => (folk && id != null ? Townsfolk.get(folk, id) : null);
        const out = { how, line: '', arrested: false, barred: false, fine: 0, deaths: [] };
        const serious = STAGE_RANK[fight.stage] >= STAGE_RANK.fists;

        // Each fighter: hurt, and remembers it
        for (const f of Brawls.fighters(fight)) {
            const p = P(f.pid);
            if (!p || p.died != null) continue;
            if (f.out === 'dead') {
                const killer = Brawls.find(fight, f.by) || (f.side === 0 ? b : a);
                Brawls.recordDeath(world, s, f.pid, killer ? killer.name : 'a brawler', day);
                out.deaths.push(f.pid);
                continue;
            }
            if (f.hp < f.max) Townsfolk.injure(p, day, Math.max(1, f.hp), f.max);
            // (sore the next day, and short of sleep after a fight late at night: systems/townJobs.js weight)
            if (how !== 'backDown') p.brawled = { d: day, late: TownJobs.lateHour(fight.hour) };
            const other = f.side === 0 ? b : a;
            const res = winner == null ? (how === 'backDown' ? 'words' : 'parted') : (f.side === winner ? 'won' : 'lost');
            Townsfolk.note(p, day, 'brawl', other && other.pid != null ? other.pid : null, res);
        }

        // The grudge between them grows (or begins)
        const G = C.grudges.afterFight || {};
        if (a && b && a.pid != null && b.pid != null) {
            const heat = how === 'backDown' ? _num(G.parted) / 2 : winner == null ? _num(G.parted) : _num(G.loser);
            const f = Brawls.addFeud(s, a.pid, b.pid, Brawls.feud(s, a.pid, b.pid) ? null : 'fight', day, heat);
            if (f && !f.why) f.why = 'fight';
        }
        for (const f of Brawls.fighters(fight)) {
            if (!f.ally || f.pid == null) continue;
            const foe = f.side === 0 ? b : a;
            if (foe && foe.pid != null) Brawls.addFeud(s, f.pid, foe.pid, 'fight', day, _num(G.ally));
        }

        // The watch: the instigator taken, fined and kept a few days
        const arrest = opts.arrest != null ? !!opts.arrest : how === 'watch';
        if (arrest && a) {
            out.arrested = true;
            const W = C.watch;
            const stageKey = out.deaths.length ? 'death' : fight.stage;
            const ap = P(a.pid);
            if (ap && ap.died == null) {
                const want = _num((W.fine || {})[fight.stage]);
                const fine = Math.min(want, Townsfolk.purse(folk, ap, world));
                if (fine > 0) {
                    ap.purse = Townsfolk.purse(folk, ap, world) - fine;
                    if (s.economy && Number.isFinite(s.economy.gold)) s.economy.gold += fine;
                    out.fine = fine;
                }
                const days = _num((W.jailDays || {})[stageKey], 0);
                if (days > 0) {
                    ap.jailedUntil = Math.max(_num(ap.jailedUntil), day + days);
                    Townsfolk.note(ap, day, 'jailed', null, 'brawling');
                }
            }
        }

        // The keeper bars the one who started it
        const Af = C.aftermath;
        if (fight.place === 'tavern' && how !== 'backDown' && a && a.pid != null) {
            const bar = opts.bar != null ? !!opts.bar : _frac(`${fight.key}|bar`) < _num(Af.barChance, 0.6);
            if (bar) {
                st.barred[a.pid] = day + Math.round(_span(Af.barDays || [20, 45], _frac(`${fight.key}|bardays`)));
                out.barred = true;
            }
        }

        // What the town says (a near thing only now and then)
        const line = Brawls.rumour(fight, opts.names || {});
        out.line = _cap(line.replace(' {when}', '').replace('{when}', ''));
        const told = how !== 'backDown' || _frac(`${fight.key}|told`) < 0.3;
        if (told && folk && Array.isArray(folk.annals)) {
            Townsfolk.record(folk, world, day, { k: 'brawl', a: a ? a.pid : null, b: b ? b.pid : null, x: line });
        }
        // The town's record of what its people did, with who saw it
        if (serious && a) {
            StreetCrime.recordNpcCrime(world, s, {
                k: 'brawl', by: a.name, byKey: a.key, byPid: a.pid, victim: b ? b.name : 'someone',
                vuid: b && b.pid != null ? `pid${b.pid}` : null, d: day,
                seenBy: _arr(opts.seenBy).slice(0, 5), witnesses: _arr(opts.witnesses), caught: out.arrested,
            });
        }
        st.n = _num(st.n) + 1;
        st.log.push({ d: day, a: a ? a.name : '?', b: b ? b.name : '?', ap: a ? a.pid : null, bp: b ? b.pid : null, how, cause: fight.cause, place: fight.place, stage: fight.stage, arrested: out.arrested });
        const max = _num(Af.logMax, 12);
        if (st.log.length > max) st.log.splice(0, st.log.length - max);
        return out;
    },

    /** Someone died of a fight (bled out on the street map, or off it): the roster and the annals keep it. */
    recordDeath(world, s, pid, killerName, day) {
        const folk = s && s.folk;
        const p = folk && pid != null ? Townsfolk.get(folk, pid) : null;
        if (!p || p.died != null) return false;
        const cause = `killed in a brawl${killerName ? ` with ${killerName}` : ''}`;
        Townsfolk.slay(folk, p, _num(day), cause);
        Townsfolk.record(folk, world, _num(day), { k: 'died', a: p.id, x: cause });
        return true;
    },

    // ──────────── OFF THE MAP ────────────

    /** Two people of the town to come to blows today, and why: { a, b, cause, heat } or null. */
    _offPair(world, s, day, key) {
        const C = Brawls.config();
        const minAge = _num(C.temper.minAge, 16);
        const free = p => p && Townsfolk.isHere(p) && p.died == null && !(p.jailedUntil != null && day < p.jailedUntil) && Townsfolk.age(p, day) >= minAge;
        const st = Brawls.state(s);
        // A grudge, hottest likeliest
        const feuds = Object.values(st.feuds).filter(f => free(Townsfolk.get(s.folk, f.a)) && free(Townsfolk.get(s.folk, f.b)));
        const opts = [];
        if (feuds.length) opts.push({ w: _num(C.causes.grudge.offWeight, 5), cause: 'grudge' });
        for (const c of ['tavern', 'market', 'drunk']) opts.push({ w: _num((C.causes[c] || {}).offWeight), cause: c });
        const pick = _weighted(opts, _frac(`${key}|cause`));
        if (!pick) return null;
        if (pick.cause === 'grudge') {
            const f = _weighted(feuds.map(x => ({ w: 1 + x.heat, f: x })), _frac(`${key}|feud`)).f;
            const pa = Townsfolk.get(s.folk, f.a);
            const pb = Townsfolk.get(s.folk, f.b);
            // The hotter of the two starts it
            const [a, b] = Brawls.temperOf(pa) >= Brawls.temperOf(pb) ? [pa, pb] : [pb, pa];
            return { a, b, cause: 'grudge', heat: f.heat };
        }
        const adults = Townsfolk.residents(s.folk).filter(p => free(p) && Brawls.temperOf(p) > 0);
        if (adults.length < 2) return null;
        const aE = _weighted(adults.map(p => ({ w: Brawls.temperOf(p, pick.cause !== 'market'), p })), _frac(`${key}|a`));
        const rest = adults.filter(p => p !== aE.p);
        const bE = _weighted(rest.map(p => ({ w: 0.3 + Brawls.temperOf(p), p })), _frac(`${key}|b`));
        return bE ? { a: aE.p, b: bE.p, cause: pick.cause, heat: 0 } : null;
    },

    /** Kin of a roster person who might wade in (not the other fighter). */
    _offAllies(s, p, exclude, day) {
        const ids = [p.spouse, ...(p.kids || []), ...(p.parents || [])].filter(id => id != null && !exclude.has(id));
        return ids.map(id => Townsfolk.get(s.folk, id)).filter(q => q && Townsfolk.isHere(q) && q.died == null && Townsfolk.age(q, day) >= 16);
    },

    /** One town's fight today, played out whole and settled. → result or null */
    resolveOffscreen(world, s, day, opts = {}) {
        const C = Brawls.config();
        const O = C.offscreen;
        if (!s || !s.folk) return null;
        const st = Brawls.state(s);
        const key = `${_seed(world)}|brawl|${s.q},${s.r}|${day}`;
        const feudN = Object.keys(st.feuds).length;
        const p = _byType(O.perDay, s.type) * Math.min(_num(O.maxMult, 3), 1 + feudN * _num(O.perFeud, 0.15));
        if (!opts.force && _frac(key) >= p) return null;
        const pair = Brawls._offPair(world, s, day, key);
        if (!pair) return null;
        const place = pair.cause === 'market' ? 'market' : pair.cause === 'tavern' ? 'tavern' : 'street';
        const drunk = pair.cause === 'tavern' || pair.cause === 'drunk';
        const fa = Brawls.fighter(pair.a, { drunk });
        const fb = Brawls.fighter(pair.b, { drunk: pair.cause === 'tavern' });
        const fight = Brawls.begin(fa, fb, { key, cause: pair.cause, place, day, hour: drunk ? 22 : 12, town: s.type });
        fight.heat = pair.heat;
        const ex = new Set([pair.a.id, pair.b.id]);
        const allies = [];
        for (const [who, side] of [[pair.a, 0], [pair.b, 1]]) {
            for (const k of Brawls._offAllies(s, who, ex, day).slice(0, 2)) { ex.add(k.id); const f = Brawls.fighter(k); f.rel = 'kin'; allies.push([f, side]); }
        }
        Brawls.simulate(fight, { town: s.type, allies });
        const res = Brawls.settle(world, s, fight, { day });
        return { fight, ...res };
    },

    /** Rival Houses' retinues in the same town (systems/rivalHouses.js): their men come to blows. → result or null */
    resolveRetainers(world, s, day) {
        const C = Brawls.config();
        const units = Array.isArray(world && world.units) ? world.units.filter(u => u && u.type === RIVAL_TYPE && !u.destroyed && u.q === s.q && u.r === s.r) : [];
        if (!units.length) return null;
        const key = `${_seed(world)}|retain|${s.q},${s.r}|${day}`;
        if (_frac(key) >= _num(C.causes.retainers.perDay, 0.18)) return null;
        const u = units[0];
        const fa = Brawls.fighter(null, { type: 'guard', name: `${u.houseName || 'a great House'}'s men`, key: `r${u.id}` });
        let fb;
        let bName;
        if (units[1]) {
            fb = Brawls.fighter(null, { type: 'guard', name: `${units[1].houseName || 'a great House'}'s men`, key: `r${units[1].id}` });
            bName = units[1].houseName || 'another House';
        } else {
            const young = Townsfolk.residents(s.folk || { people: [] }).filter(p => Townsfolk.age(p, day) >= 17 && Townsfolk.age(p, day) <= 40 && Brawls.temperOf(p) > 0);
            const p = young.length ? young[Math.floor(_frac(`${key}|local`) * young.length) % young.length] : null;
            fb = p ? Brawls.fighter(p) : Brawls.fighter(null, { type: 'villager', name: 'the townsmen', key: 'townsmen' });
            bName = fb.name;
        }
        const fight = Brawls.begin(fa, fb, { key, cause: 'retainers', place: 'street', placeName: s.name ? `in ${s.name}` : null, day, town: s.type });
        Brawls.simulate(fight, { town: s.type });
        // (the town tells it by the Houses' names)
        const res = Brawls.settle(world, s, fight, { day, arrest: false, names: { a: u.houseName || 'a great House', b: bName } });
        return { fight, ...res };
    },

    /**
     * The day's end, every town with a roster: grudges born and cooling, the barred let back,
     * a fight now and then (not in the town the player is walking: opts.onMap). → { notices, events }
     */
    processDay(world, player = null, opts = {}) {
        const C = Brawls.config();
        const notices = [];
        const events = [];
        if (!world || !C.enabled) return { notices, events };
        const day = _num(world.day);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const here = player && player.q != null ? `${player.q},${player.r}` : null;
        const G = C.grudges;
        for (const s of views) {
            if (!s || s.q == null || !s.folk) continue;
            const st = Brawls.state(s);
            // Grudges cool; the forgotten go
            for (const [k, f] of Object.entries(st.feuds)) {
                f.heat = _num(f.heat) - _num(G.decayPerDay, 0.35);
                const pa = Townsfolk.get(s.folk, f.a);
                const pb = Townsfolk.get(s.folk, f.b);
                if (f.heat < _num(G.forgetBelow, 4) || !pa || !pb || pa.died != null || pb.died != null) delete st.feuds[k];
            }
            for (const [pid, until] of Object.entries(st.barred)) if (day >= until) delete st.barred[pid];
            Brawls._cutpurseGrudges(s, day);
            const born = Brawls.seedGrudge(world, s, day);
            if (born) events.push({ kind: 'grudge', hex: `${s.q},${s.r}`, town: s.name, feud: born });
            const hex = `${s.q},${s.r}`;
            if (opts.onMap && hex === here) continue;
            const r = Brawls.resolveOffscreen(world, s, day) || Brawls.resolveRetainers(world, s, day);
            if (!r) continue;
            events.push({ kind: 'brawl', hex, town: s.name, how: r.how, line: r.line, arrested: r.arrested });
            // Word to the player of people they know
            if (player && r.how !== 'backDown') {
                const known = Brawls.fighters(r.fight).map(f => f.pid != null ? Townsfolk.get(s.folk, f.pid) : null).find(p => p && p.rnpc != null);
                if (known) notices.push({ icon: '💢', title: `Word from ${s.name || 'town'}`, text: r.line, type: r.deaths.length ? 'warning' : 'info' });
            }
        }
        return { notices, events };
    },
};
