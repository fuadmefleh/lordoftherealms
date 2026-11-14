// ============================================================
// TOWN MEMORY — the world remembers physically
// ============================================================
// A town in its sixtieth year is not the town of its first. Its history is a
// list of marks on the settlement (settlement.memory, saved with the tile;
// world/townMarks.js holds the record and lays it on the street map):
//
//   fires    — rolled monthly per town (timber cultures, summer and war burn
//              more; a town sees one or two a century). The dead and the burnt-out
//              leave the roll and the townsfolk, the stores burn, and for years the
//              rebuilding eats the market's timber and stone (prices) and hires
//              the town's craftsmen (wages: world/townLabour.js reads rebuildHands).
//              Rebuilt often in stone — nearly always after a great fire.
//   sacks    — Sieges._sack, an invasion host taking a town (systems/crises.js), and
//              anyone through mark(): ruins, slowly rebuilt,
//              some never.
//   statues  — raised to the player's House where it is bound up with the town
//              (a great work there, its lordship) or famous enough in a capital:
//              renown when raised, Prestige every year it stands, the town's pride.
//              Defaced, then toppled, if the town comes to hate the House, it
//              sacked the place, or the House falls (no longer the player's).
//   names    — the square renamed after a well-loved House; changed back after.
//   cairns   — battles fought by the town (world/kingdomAI.js, player/generalship.js
//              → TownMarks.noteBattle): grief that fades over a dozen years; a grave
//              mound where hundreds fell. Paying respects there (respects()).
//   mounds   — plague pits (mark(s, 'plague', { dead }): a great plague's town when
//              its course is run, systems/crises.js).
//   districts — a new quarter built in a decade of wealth and growth.
//
// Readers: Taxation.memoryMood (happiness), TownLabour (rebuild hands → wages),
// the market's stock (prices), player.renown and House Prestige (fame), the
// townsfolk's annals, the inscriptions and the town's history (describe).
//
// The prose — inscriptions, the history — is a template, or the LLM's
// (systems/llmProse.js, when there is one) under `town:<id>:mark:<markId>`.
//
// Draws no dice: every roll is a hash of the town, the day and the mark.

import { DataLoader } from '../core/dataLoader.js';
import { TownMarks, markHash } from '../world/townMarks.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { SettlementWealth } from '../world/settlementWealth.js';
import { Townsfolk } from './townsfolk.js';
import { House } from './house.js';
import { Fame } from './fame.js';
import { Patronage } from './patronage.js';
import { Taxation } from './marketDynamics.js';

// The LLM's prose, where the game has it (systems/llmProse.js); else the templates
let _prose = null;
try {
    const mods = import.meta.glob('./llmProse.js', { eager: true });
    for (const m of Object.values(mods)) if (m && m.LlmProse) _prose = m.LlmProse;
} catch (e) { _prose = null; }

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _h = markHash;
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _between = ([a, b], t) => a + (b - a) * t;

function _cfg() {
    const g = DataLoader._gamedata;
    const d = _obj(g && g.townMemory) || {};
    return {
        enabled: d.enabled !== false, daysPerYear: _num(d.daysPerYear, 120), tickDays: Math.max(1, _num(d.tickDays, 30)),
        fire: d.fire || {}, sack: d.sack || {}, rebuild: d.rebuild || {}, statue: d.statue || {}, name: d.name || {},
        battle: d.battle || {}, plague: d.plague || {}, griefYears: _num(d.griefYears, 12), district: d.district || {},
        respects: d.respects || {}, moodMax: _num(d.moodMax, 12), moodMin: _num(d.moodMin, -20),
    };
}

const _sid = s => (s && s.id != null ? String(s.id) : `${_num(s && s.q)}_${_num(s && s.r)}`);
// The calendar year of a day (as Calendar.date counts it: the world's baseYear + whole years)
const _year = (day, Y, world = null) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, day) - 1) / Y);
const _surname = (name) => String(name || 'the House').replace(/^house\s+/i, '');

export const TownMemory = {
    config: _cfg,

    /** The prose module in use (tests swap one in). */
    setProse(p) { _prose = p || null; },

    // ── Writing the town's history ───────────────────────

    /**
     * Mark a town with an event of its history. The public door for every system
     * (sieges, the world's crises): kind 'fire' | 'sack' | 'plague' | 'statue' |
     * 'cairn' | 'mound' | 'name' | 'district'; info as the kind wants:
     *   fire  { share?, cause?, great? }   — what it burns is decided here when not given
     *   sack  { share?, by?, byPlayer? }   — the folk killed and fled; the siege does the plunder
     *   plague { dead }                    — a plague pit when enough died
     * A fire's consequences follow at once (opts.consequences false: the record only).
     * → the mark, or null.
     */
    mark(settlement, kind, info = {}, world = null, opts = {}) {
        const C = _cfg();
        if (!C.enabled || !settlement) return null;
        const day = _num(info.d, _num(world && world.day));
        const conseq = opts.consequences !== false;
        let m = null;
        if (kind === 'fire') {
            m = TownMarks.add(settlement, 'fire', TownMemory._fireInfo(settlement, info, day), day);
            if (conseq) TownMemory._afterFire(world, settlement, m, day);
        } else if (kind === 'sack') {
            const S = C.sack;
            const tier = SettlementWealth.tierOf(SettlementWealth.score(settlement));
            const share = Number.isFinite(info.share) ? info.share : _between(S.share || [0.2, 0.45], _h('sackShare', _sid(settlement), day));
            m = TownMarks.add(settlement, 'sack', {
                share: Math.round(share * 1000) / 1000, by: info.by || null, byPlayer: !!info.byPlayer,
                never: _num((S.never || {})[tier], 0.2), stoneShare: _num(S.stoneShare, 0.35),
                slow: _num(((C.fire.slow || {})[tier]), 1),
            }, day);
            if (conseq) TownMemory._folkStruck(world, settlement, m, share, day, 'the sack', 'fled the sack');
        } else if (kind === 'plague') {
            const dead = Math.max(0, Math.round(_num(info.dead)));
            if (dead < _num(C.plague.moundAt, 25)) return null;
            m = TownMarks.add(settlement, 'mound', { dead, cause: 'plague' }, day);
        } else {
            m = TownMarks.add(settlement, kind, { ...info }, day);
        }
        if (m) {
            TownMemory._remember(world, settlement, m, day);
            TownMemory._mood(settlement, day);
        }
        return m;
    },

    _fireInfo(settlement, info, day) {
        const F = _cfg().fire;
        const key = _sid(settlement);
        const great = info.great != null ? !!info.great : _h('great', key, day) < _num(F.great, 0.12);
        const share = Number.isFinite(info.share) ? _clamp(info.share, 0, 1)
            : _between(great ? (F.greatShare || [0.35, 0.7]) : (F.share || [0.05, 0.25]), _h('share', key, day));
        const tier = SettlementWealth.tierOf(SettlementWealth.score(settlement));
        const ordinance = share >= _num(F.stoneOrdinanceAt, 0.3);
        const stoneShare = ordinance ? _num(F.stoneOrdinance, 0.9) : _clamp(_num(F.stoneShare, 0.45) + (tier === 'rich' ? _num(F.richStone, 0.25) : 0), 0, 1);
        return { share: Math.round(share * 1000) / 1000, great: share >= 0.35, cause: info.cause || 'chance', stoneShare, ordinance, slow: _num((F.slow || {})[tier], 1) };
    },

    /** The fire's toll: the dead and the burnt-out, the stores, the mood, the roster. */
    _afterFire(world, s, m, day) {
        const F = _cfg().fire;
        const pop = Math.max(0, _num(s.population));
        const dead = Math.round(pop * m.share * _num(F.deadRate, 0.012));
        const left = Math.round(pop * m.share * _num(F.leaveRate, 0.12));
        s.population = Math.max(1, pop - dead - left);
        m.dead = dead;
        m.homeless = left;
        s.happiness = _clamp(_num(s.happiness, 50) + _num(F.happiness, -6) + _num(F.happinessPerShare, -20) * m.share, 0, 100);
        try { SettlementMarket.loot(s, m.share * _num(F.storesBurnt, 0.5)); } catch (e) { /* no market yet */ }
        TownMemory._folkStruck(world, s, m, m.share, day, m.great ? 'the great fire' : 'the fire', 'burnt out of house and home');
    },

    /** Townsfolk on the roster killed and driven out by a fire or a sack (hash-picked). */
    _folkStruck(world, s, m, share, day, cause, away) {
        const F = _cfg().fire;
        const folk = s && s.folk;
        if (!folk || !Array.isArray(folk.people)) return;
        const here = Townsfolk.residents(folk).sort((a, b) => _h(m.id, a.id, 'f') - _h(m.id, b.id, 'f'));
        const nDie = Math.round(here.length * share * _num(F.folkDie, 0.35) * 0.2);
        const nLeave = Math.round(here.length * share * _num(F.folkLeave, 0.5) * 0.3);
        here.slice(0, nDie).forEach(p => Townsfolk.slay(folk, p, day, cause));
        here.slice(nDie, nDie + nLeave).forEach(p => Townsfolk.exile(folk, p, day, away));
        m.folkDead = here.slice(0, nDie).map(p => Townsfolk.name(p));
    },

    /** Into the town's annals, and the LLM asked for its telling. */
    _remember(world, s, m, day) {
        if (s.folk && Array.isArray(s.folk.annals)) {
            try { Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: TownMemory.markText(s, m, world, '{when}') }); } catch (e) { /* no annals */ }
        }
        if (_prose && world && typeof _prose.write === 'function') {
            try {
                const p = _prose.write(world, { kind: 'townMark', key: TownMemory.proseKey(s, m), facts: TownMemory._facts(s, m, world), fallback: TownMemory.inscription(s, m, world, true) });
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (e) { /* the template stands */ }
        }
    },

    proseKey(s, m) { return `town:${_sid(s)}:mark:${m.id}`; },

    _facts(s, m, world) {
        const Y = _cfg().daysPerYear;
        return { town: s.name, kind: m.k, year: _year(m.d, Y, world), today: _year(_num(world && world.day, m.d), Y, world), ...m };
    },

    // ── The days ─────────────────────────────────────────

    /**
     * One day: each town takes its month on its own day (staggered by its place).
     * Player may be null (the world without one: player/afterlife.js).
     * → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = _cfg();
        if (!C.enabled || !world || typeof world.getSettlementViews !== 'function') return out;
        const day = _num(world.day);
        if (!(day > 0)) return out;
        const ctx = { player, held: null };
        for (const s of world.getSettlementViews()) {
            if (!s) continue;
            const off = Math.floor(_h('tm', s.q, s.r) * C.tickDays);
            if ((day + off) % C.tickDays !== 0) continue;
            TownMemory._month(world, s, ctx, day, out);
        }
        return out;
    },

    _month(world, s, ctx, day, out) {
        const C = _cfg();
        const mem = TownMarks.memory(s, true);
        if (mem.basePop == null) mem.basePop = Math.max(1, _num(s.population, 100));
        const known = TownMemory._knows(ctx.player, s);

        // Battles fought here since last month: the dead mourned
        for (const m of mem.marks) {
            if (m.k !== 'cairn' || !m.fresh) continue;
            const fd = _num(m.freshDead, m.dead);
            s.happiness = _clamp(_num(s.happiness, 50) - Math.min(15, 3 + fd / 100), 0, 100);
            delete m.fresh; delete m.freshDead;
            TownMemory._remember(world, s, m, day);
            if (known) out.notices.push({ icon: '⚰️', title: `A Cairn at ${s.name}`, text: `The folk of ${s.name} heap a cairn for the ${_num(m.dead)} who fell in the fighting there.`, type: 'info' });
        }

        // A fire?
        TownMemory._fireRoll(world, s, mem, ctx, day, out, known);
        // The rebuilding: hands hired, timber and stone used
        TownMemory._rebuild(s, day);
        // Statues and names, raised, defaced, toppled, changed back
        TownMemory._monuments(world, s, ctx, day, out);
        // A new quarter in a decade of wealth
        TownMemory._district(world, s, mem, day, out, known);
        TownMemory._mood(s, day);
    },

    /** Does the player know of this town's doings (been there, nearby, or it bears their name)? */
    _knows(player, s) {
        if (!player) return false;
        if (s.folk) return true;
        return Math.abs(_num(player.q) - s.q) + Math.abs(_num(player.r) - s.r) <= 6;
    },

    _fireRoll(world, s, mem, ctx, day, out, known) {
        const C = _cfg();
        const F = C.fire;
        const Y = C.daysPerYear;
        const last = mem.marks.filter(m => m.k === 'fire').pop();
        if (last && day - last.d < Y) return;
        let p = _num((F.chance || {})[s.type], 0.003);
        const tf = F.timber || {};
        if (s.culture && tf[s.culture] != null) p *= _num(tf[s.culture], 1);
        const q4 = Math.floor((((day - 1) % Y) + Y) % Y / (Y / 4));
        if (q4 === 1) p *= _num(F.summer, 1.6);
        if (q4 === 3) p *= _num(F.winter, 1.25);
        const k = s.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
        if (k && Array.isArray(k.wars) && k.wars.length) p *= _num(F.war, 1.5);
        if (_h('fire', s.q, s.r, day) >= p) return;
        const m = TownMemory.mark(s, 'fire', { cause: 'chance' }, world);
        if (!m) return;
        const pct = Math.round(m.share * 100);
        if (known || m.great) {
            out.notices.push({ icon: '🔥', title: m.great ? `The Great Fire of ${s.name}` : `Fire in ${s.name}`,
                text: `Fire runs through ${s.name}: about ${pct}% of the town burns${m.dead ? `, ${m.dead} dead` : ''}, ${m.homeless} burnt out of their homes. Timber and stone will be dear there for years.${m.ordinance ? ' The council orders it rebuilt in stone.' : ''}`, type: 'warning' });
        }
    },

    /** The rebuilding under way: buildings still to raise, their hands and their timber and stone. */
    rebuilding(s, day) {
        const C = _cfg();
        const Y = C.daysPerYear;
        const N = _num((C.rebuild.buildings || {})[s.type], 30);
        let n = 0, stone = 0;
        for (const m of TownMarks.marks(s)) {
            if (m.k !== 'fire' && m.k !== 'sack') continue;
            const span = (m.k === 'sack' ? (C.sack.rebuildYears || [2, 12]) : (C.fire.rebuildYears || [1, 6]))[1] * Math.max(0.3, _num(m.slow, 1)) * Y;
            const age = day - m.d;
            if (age < 0 || age >= span) continue;
            const left = (1 - age / span) * _num(m.share) * N * (m.k === 'sack' ? 1 - _num(m.never) : 1);
            n += left;
            stone += left * _num(m.stoneShare, 0.5);
        }
        return { buildings: Math.round(n * 10) / 10, stoneShare: n > 0 ? stone / n : 0 };
    },

    _rebuild(s, day) {
        const R = _cfg().rebuild;
        const mem = TownMarks.memory(s, true);
        const { buildings, stoneShare } = TownMemory.rebuilding(s, day);
        // (world/townLabour.js hires these into the crafts: the wages climb)
        mem.rebuildHands = Math.round(buildings * _num(R.hands, 3));
        if (!(buildings > 0)) { delete mem.rebuildHands; return; }
        try {
            mem.used = mem.used || {};
            const w = SettlementMarket.take(s, 'wood', buildings * _num(R.wood, 1.2));
            const st = SettlementMarket.take(s, 'stone', buildings * stoneShare * _num(R.stone, 1));
            mem.used.wood = Math.round((_num(mem.used.wood) + w) * 10) / 10;
            mem.used.stone = Math.round((_num(mem.used.stone) + st) * 10) / 10;
        } catch (e) { /* no market */ }
    },

    /** The town's mood from its memory: pride in its statues and names, grief for its dead (fading). */
    _mood(s, day) {
        const C = _cfg();
        const mem = TownMarks.memory(s);
        if (!mem) return 0;
        const Y = C.daysPerYear;
        const span = C.griefYears * Y;
        let mood = 0;
        let statues = 0;
        for (const m of mem.marks) {
            const age = day - m.d;
            if (age < 0) continue;
            const fade = Math.max(0, 1 - age / span);
            if (m.k === 'statue' && (m.state || 'standing') === 'standing' && statues < 2) { statues++; mood += _num(C.statue.pride, 3); }
            else if (m.k === 'statue' && m.state === 'defaced') mood += _num(C.statue.shame, -2);
            else if (m.k === 'name' && (m.state || 'kept') === 'kept') mood += 1;
            else if (m.k === 'cairn') mood += Math.max(_num(C.battle.griefMax, -18), _num(C.battle.grief, -10) + _num(C.battle.griefPerHundred, -1.5) * _num(m.dead) / 100) * fade * 0.5;
            else if (m.k === 'mound') mood += _num(C.plague.grief, -6) * fade;
            else if (m.k === 'fire') mood += -12 * _num(m.share) * fade;
            else if (m.k === 'sack') mood += -8 * fade;
            // A crime done to the town (systems/townCrimes.js): a poisoned well, a burnt granary, a plague lie
            else if (m.k === 'crime') mood += (m.crime === 'well' ? -6 : m.crime === 'granary' ? -4 : -1.5) * fade;
            // An atrocity (systems/atrocities.js): salt, hanged hostages, plague dead, a massacre — grief that lasts `long` times as long
            else if (m.k === 'atrocity') mood += _num(m.grief, -8) * Math.max(0, 1 - age / (span * Math.max(1, _num(m.long, 3))));
        }
        mem.mood = Math.round(_clamp(mood, C.moodMin, C.moodMax) * 10) / 10;
        return mem.mood;
    },

    /** Mood points the town's memory adds to its happiness (Taxation reads it). */
    moodOf(settlement) {
        const m = TownMarks.memory(settlement);
        return m ? _num(m.mood) : 0;
    },

    // ── Statues and names ───────────────────────────────

    /** How the player's House stands with this town: { score, net, tie, rules, work }. */
    standing(player, world, s, held = null) {
        const C = _cfg().statue;
        if (!player || !player.house) return { score: 0, net: 0, tie: 0 };
        let work = false;
        try { work = Patronage.builtAt(world, s.q, s.r).some(b => b.owner === 'player'); } catch (e) { work = false; }
        const rules = !!(held && held.has(`${s.q},${s.r}`));
        const f = Fame.scores(player, s.kingdom);
        const net = _num(f.good) - _num(f.ill);
        const tie = (work ? _num(C.greatWork, 50) : 0) + (rules ? _num(C.rules, 35) : 0);
        const score = tie > 0 ? tie + Math.max(0, net) * _num(C.fameWeight, 0.5)
            : (s.type === 'capital' && net >= _num(C.capitalFame, 140) ? net * _num(C.fameWeight, 0.5) : 0);
        return { score, net, tie, rules, work };
    },

    _held(world, ctx) {
        if (ctx.held) return ctx.held;
        ctx.held = new Set();
        try { for (const r of Taxation.getPlayerSettlements(ctx.player, world)) ctx.held.add(`${r.q},${r.r}`); } catch (e) { /* none */ }
        return ctx.held;
    },

    _monuments(world, s, ctx, day, out) {
        const C = _cfg();
        const S = C.statue;
        const Y = C.daysPerYear;
        const player = ctx.player;
        const house = player && player.house ? player.house : null;
        const mine = house ? house.name : null;
        const marks = TownMarks.marks(s);
        const st = house ? TownMemory.standing(player, world, s, TownMemory._held(world, ctx)) : null;
        const sacked = mine && marks.some(m => m.k === 'sack' && m.by === mine && day - m.d < _num(S.sackedYears, 30) * Y);
        const hated = !!st && (st.net <= -_num(S.hateAt, 25) || sacked);
        const loved = !!st && !hated && st.score >= _num(S.raiseAt, 70);

        for (const m of marks) {
            if (m.k !== 'statue') continue;
            const state = m.state || 'standing';
            if (state === 'toppled') continue;
            const ours = m.house === mine;
            if (ours) delete m.absent; else if (m.absent == null) m.absent = day;
            const fallen = !ours && day - _num(m.absent, day) >= _num(S.fallYears, 3) * Y;
            const turn = ours ? hated : fallen;
            if (state === 'standing' && turn) {
                m.state = 'defaced'; m.changed = day;
                TownMemory._remember(world, s, m, day);
                if (ours) out.notices.push({ icon: '🎨', title: `Your Statue Defaced`, text: `Someone has daubed your House's statue in ${s.name} and knocked its head off. The town has turned against you.`, type: 'warning' });
            } else if (state === 'defaced' && turn && day - _num(m.changed, m.d) >= _num(S.toppleYears, 2) * Y) {
                m.state = 'toppled'; m.changed = day;
                TownMemory._remember(world, s, m, day);
                if (ours && player) {
                    player.renown = Math.max(0, _num(player.renown) + _num(S.renownTopple, -4));
                    out.notices.push({ icon: '⛰️', title: `Your Statue Toppled`, text: `The folk of ${s.name} have pulled down the statue of your House (${_num(S.renownTopple, -4)} renown).`, type: 'error' });
                }
                for (const n of marks) if (n.k === 'name' && n.house === m.house && (n.state || 'kept') === 'kept') { n.state = 'reverted'; n.changed = day; }
            } else if (state === 'defaced' && ours && loved) {
                m.state = 'standing'; m.changed = day;
                out.notices.push({ icon: '🧽', title: 'Your Statue Restored', text: `${s.name} has scrubbed your House's statue clean and set a new head on it.`, type: 'success' });
            } else if (state === 'standing' && ours && house && (day - m.d) % Y < C.tickDays && day - m.d >= Y) {
                // A year standing: Prestige for the House
                House.award(house, _num(S.prestigeYearly, 3), `statue at ${s.name}`, day);
            }
        }
        // Names changed back once the House is gone a while
        for (const n of marks) {
            if (n.k !== 'name' || (n.state || 'kept') !== 'kept' || n.house === mine) continue;
            if (n.absent == null) n.absent = day;
            if (day - n.absent >= _num(C.name.revertYears, 6) * Y) { n.state = 'reverted'; n.changed = day; TownMemory._remember(world, s, n, day); }
        }
        for (const n of marks) if (n.k === 'name' && n.house === mine) delete n.absent;
        if (!house || !loved) return;

        // A statue, if the town has none of this House standing and none raised lately
        const ofHouse = marks.filter(m => m.k === 'statue' && m.house === mine);
        const upright = ofHouse.some(m => (m.state || 'standing') !== 'toppled');
        const lately = ofHouse.some(m => day - m.d < _num(S.cooldownYears, 12) * Y);
        if (!upright && !lately) {
            const reason = st.work ? 'great work' : st.rules ? 'lordship' : 'fame';
            const who = player.name || `the head of ${mine}`;
            const m = TownMemory.mark(s, 'statue', { house: mine, who, reason, state: 'standing' }, world);
            player.renown = _num(player.renown) + _num(S.renownRaise, 5);
            House.award(house, 10, `a statue raised at ${s.name}`, day);
            if (m) out.notices.push({ icon: '🗿', title: 'A Statue Raised', text: `${s.name} raises a statue to ${who} of ${mine} in its square, for ${reason === 'great work' ? 'the great work your House gave it' : reason === 'lordship' ? 'its good lordship' : 'the fame of your House'} (+${_num(S.renownRaise, 5)} renown).`, type: 'success' });
        }
        // The square renamed, for a House the town truly loves and is bound to
        if (st.tie > 0 && st.score >= _num(C.name.at, 110) && !marks.some(m => m.k === 'name' && m.house === mine && (m.state || 'kept') === 'kept')) {
            const nm = `${_surname(mine)} Square`;
            TownMemory.mark(s, 'name', { house: mine, what: 'square', name: nm, state: 'kept' }, world);
            out.notices.push({ icon: '📜', title: 'A Square Renamed', text: `The market square of ${s.name} is now ${nm}, after your House.`, type: 'success' });
        }
    },

    // ── Districts ───────────────────────────────────────

    _district(world, s, mem, day, out, known) {
        const C = _cfg();
        const D = C.district;
        const Y = C.daysPerYear;
        const have = mem.marks.filter(m => m.k === 'district');
        if (have.length >= _num(D.max, 4)) return;
        const last = have[have.length - 1];
        if (mem.since == null) mem.since = day;
        const since = last ? last.d : _num(mem.since, day);
        if (day - since < _num(D.everyYears, 12) * Y) return;
        const pop = _num(s.population);
        const base = last ? _num(last.pop, mem.basePop) : _num(mem.basePop, pop);
        const score = SettlementWealth.score(s);
        if (score < _num(D.wealthAt, 0.58) || pop < base * _num(D.growth, 1.2)) return;
        const m = TownMemory.mark(s, 'district', { pop, tier: SettlementWealth.tierOf(score) }, world);
        if (m && known) out.notices.push({ icon: '🏘️', title: `${s.name} Grows`, text: `A new quarter of houses goes up along the high street of ${s.name}: the town has prospered.`, type: 'info' });
    },

    // ── Paying respects ─────────────────────────────────

    /** A mark by id, in a town or on an open hex. */
    find(world, settlement, id, q = null, r = null) {
        if (settlement) return TownMarks.markById(settlement, id);
        return TownMarks.fieldMarks(world, q, r).find(m => m.id === id) || null;
    },

    /**
     * Stand at a cairn or a grave mound with your head bowed: karma once a year per
     * cairn, renown too where it was your own battle. → { ok, text }.
     */
    respects(player, world, settlement, id, q = null, r = null) {
        const R = _cfg().respects;
        const m = TownMemory.find(world, settlement, id, q, r);
        if (!player || !m || (m.k !== 'cairn' && m.k !== 'mound')) return { ok: false, text: 'There is nothing here to honour.' };
        const day = _num(world && world.day);
        m.respects = _obj(m.respects) || {};
        if (m.respects.d != null && day - m.respects.d < _num(R.everyDays, 120)) return { ok: false, text: 'You have stood here this year already. The stones remember.' };
        m.respects.d = day;
        m.respects.n = _num(m.respects.n) + 1;
        player.karma = _num(player.karma) + _num(R.karma, 1);
        if (m.player) player.renown = _num(player.renown) + _num(R.renownOwn, 1);
        const text = m.k === 'mound'
            ? `You stand bareheaded by the mound where ${_num(m.dead)} were laid in the earth.`
            : `You add a stone to the cairn of the ${_num(m.dead)} who fell here${m.player ? ', men who followed you' : ''}.`;
        return { ok: true, text };
    },

    // ── In words ────────────────────────────────────────

    /** One mark told as a line; `when` replaces the date ("in the year 12", or '{when}' for the annals). */
    markText(s, m, world, when = null) {
        const Y = _cfg().daysPerYear;
        const w = when || `in the year ${_year(m.d, Y, world)}`;
        const pct = Math.round(_num(m.share) * 100);
        switch (m.k) {
        case 'fire': return `${m.great ? 'The great fire' : 'A fire'} burned ${pct}% of ${s.name} ${w}${m.dead ? `; ${m.dead} died` : ''}${m.ordinance ? '. The council ordered it rebuilt in stone' : ''}.`;
        case 'sack': return `${s.name} was sacked ${w}${m.by ? ` by ${m.by}` : ''}; a ${pct >= 35 ? 'third' : 'part'} of it was left in ruins.`;
        case 'statue': return m.state === 'toppled' ? `The statue of ${m.who || m.house} was pulled down ${w}.`
            : m.state === 'defaced' ? `The statue of ${m.who || m.house} was defaced ${w}.`
            : `A statue of ${m.who || m.house} of ${m.house} was raised in the square ${w}.`;
        case 'name': return (m.state || 'kept') === 'kept' ? `The market square became ${m.name} ${w}.` : `${m.name} went back to its old name ${w}.`;
        case 'cairn': return `A cairn was raised ${w} for the ${_num(m.dead)} who fell fighting at ${s.name}${m.victor ? ` (${m.victor} held the field)` : ''}.`;
        case 'mound': return `${_num(m.dead)} dead of the ${m.cause || 'plague'} were buried in a pit outside ${s.name} ${w}.`;
        case 'district': return `A new quarter was built ${w}, when ${s.name} was ${m.tier === 'rich' ? 'rich' : 'prospering'}.`;
        case 'atrocity': return String(m.line || `${s.name} remembers a cruelty {when}.`).replace('{when}', w);
        case 'crime': return m.crime === 'well' ? `The well of ${s.name} was poisoned ${w}${m.by ? ` by ${m.by}` : ''}${m.struck ? `; ${m.struck} fell sick${m.dead ? ` and ${m.dead} died` : ''}` : ''}.`
            : m.crime === 'granary' ? `The granary of ${s.name} was burnt ${w}${m.by ? ` by ${m.by}` : ''}${m.lean ? ', in the lean weeks' : ''}.`
            : `A false plague was cried on ${s.name} ${w}${m.by ? `, a lie of ${m.by}'s` : ''}; the traders stayed away.`;
        default: return `${s.name} remembers something ${w}.`;
        }
    },

    /** What is carved or chalked on a mark's stone (the LLM's, where it has written it). */
    inscription(s, m, world, template = false) {
        const Y = _cfg().daysPerYear;
        const yr = _year(m.d, Y, world);
        let t;
        if (m.k === 'statue') {
            t = m.state === 'toppled' ? `Only the plinth stands. Its letters, chiselled off, once named ${m.who || m.house}.`
                : m.state === 'defaced' ? `"${m.who || m.house}" — scratched over, and under it in red paint: TYRANT.`
                : `${String(m.who || m.house).toUpperCase()} OF ${String(m.house).toUpperCase()}. Raised by the grateful folk of ${s.name}, year ${yr}.`;
        } else if (m.k === 'cairn') {
            t = `Here lie the ${_num(m.dead)} who fell in the year ${yr}${m.victor ? `. ${m.victor} held the field` : ''}. Add a stone as you pass.`;
        } else if (m.k === 'mound') {
            t = `${_num(m.dead)} souls taken by the ${m.cause || 'plague'}, year ${yr}. God keep them.`;
        } else if (m.k === 'name') {
            t = `${String(m.name).toUpperCase()}. So named in the year ${yr} in honour of ${m.house}.`;
        } else if (m.k === 'fire' || m.k === 'sack') {
            t = TownMemory.markText(s, m, world);
        } else t = TownMemory.markText(s, m, world);
        if (template || !_prose || typeof _prose.text !== 'function') return t;
        try { return _prose.text(world, TownMemory.proseKey(s, m), t) || t; } catch (e) { return t; }
    },

    /** The town's history, oldest first: [{ id, kind, year, text }]. */
    describe(settlement, world) {
        const Y = _cfg().daysPerYear;
        return TownMarks.marks(settlement).map(m => {
            const t = TownMemory.markText(settlement, m, world);
            let text = t;
            if (_prose && typeof _prose.text === 'function') { try { text = _prose.text(world, TownMemory.proseKey(settlement, m), t) || t; } catch (e) { text = t; } }
            return { id: m.id, kind: m.k, year: _year(m.d, Y, world), text };
        });
    },

    /** The town's history as one passage (the LLM's under `town:<id>:history`, else the lines joined). */
    history(settlement, world) {
        const lines = TownMemory.describe(settlement, world).map(l => l.text);
        const t = lines.length ? lines.join(' ') : `${settlement.name} has no history worth the telling yet.`;
        if (!_prose) return t;
        const key = `town:${_sid(settlement)}:history:${lines.length}`;
        try {
            if (typeof _prose.write === 'function' && lines.length) {
                const p = _prose.write(world, { kind: 'townHistory', key, facts: { town: settlement.name, events: lines }, fallback: t });
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
            return (typeof _prose.text === 'function' && _prose.text(world, key, t)) || t;
        } catch (e) { return t; }
    },
};
