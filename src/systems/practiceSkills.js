// ============================================
// PRACTISED SKILLS — levels earned by doing, for the player and NPCs alike
// ============================================
//
// A skill rises in discrete levels (1..maxLevel, each with a name: Untried,
// Novice, … Grandmaster) as XP is earned doing it. Each level carries perks,
// one value per level, defined in data (diving's breath seconds, swimming's
// speed, …). Everything here is a pure function of a holder — the player, a
// townsfolk person, anyone — that keeps its total XP by skill on
// `holder.practiceSkills` ({ diving: 120, swimming: 40 }).
//
//   • level(holder, id) / progress(holder, id) / perk(holder, id, perkId)
//   • gain(holder, id, xp) → a level-up event { skill, name, from, to,
//     levelName, gains[], title, text } when a level is crossed, else null —
//     the UI announces it ("Diving rose to level 3: +8s of breath").
//   • nextGains(holder, id): what the next level would give.
//   • list(holder): every skill with its progress, for the character panel.
//   • migrate(player): an old save's player.swimPractice becomes XP.
//   • NPCs: seedNpc(holder, who) gives a person levels from who they are
//     (role, age, a coastal town; a hash for the spread — no RNG draws);
//     growNpc(holder, who, days) adds the XP of their work; notable(holder).
//   • Age (data/skillPacks/age.json → practiceSkills.age): the young learn
//     faster (learnMult, in gain); the body's skills fade from about 55 and
//     a seasoned mind's trades rise a level from 50 (ageShift). XP is never
//     taken: trainedLevel is what the XP makes, level() the effective level
//     that every perk reads. ageOf: holder.age, else holder.skillAge (seedNpc
//     / growNpc stamp it), else unknown — prime, no change.
//
// Numbers in data/practiceSkills.json. No randomness, no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

const DEFAULTS = {
    maxLevel: 10,
    xp: { base: 40, growth: 1.45 },
    levelNames: [],
    skills: {},
    migrate: { swimPractice: {} },
    npc: { base: {}, roles: {}, coastal: {}, coastalTrades: {}, craftTrades: {}, spread: 0, ageBonus: 0, ageMax: 0, adultAge: 14, dailyXp: {}, notableLevel: 4 },
};

const COAST_WATER = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'];

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

let _cfg = null;
let _src;

function _fmt(tpl, vals) {
    // Numbers round to 2 decimals, trailing zeros dropped (no "0.2999999999999998s")
    const show = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : v);
    return String(tpl || '').replace(/\{(\w)\}/g, (m, k) => (vals[k] != null ? show(vals[k]) : m));
}

export const PracticeSkills = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.practiceSkills) || null;
        if (_cfg && _src === d) return _cfg;
        const data = d || {};
        _src = d;
        _cfg = {
            ...DEFAULTS, ...data,
            xp: { ...DEFAULTS.xp, ...(data.xp || {}) },
            skills: data.skills || {},
            migrate: { ...DEFAULTS.migrate, ...(data.migrate || {}) },
            npc: { ...DEFAULTS.npc, ...(data.npc || {}) },
        };
        return _cfg;
    },

    /** The skill's definition, or null */
    def(id) {
        return PracticeSkills.config().skills[id] || null;
    },

    /** Every skill id, in order */
    ids() {
        const s = PracticeSkills.config().skills;
        return Object.keys(s).filter(k => !k.startsWith('_')).sort((a, b) => _num(s[a].order, 99) - _num(s[b].order, 99));
    },

    maxLevel() {
        return Math.max(1, PracticeSkills.config().maxLevel | 0);
    },

    /** XP to go from `level` to the next */
    stepXp(level) {
        const C = PracticeSkills.config();
        return Math.round(_num(C.xp.base, 40) * Math.pow(_num(C.xp.growth, 1.45), Math.max(0, level - 1)));
    },

    /** Total XP at which `level` is reached (level 1 at 0) */
    xpForLevel(level) {
        const L = Math.max(1, Math.min(PracticeSkills.maxLevel(), Math.floor(level)));
        let t = 0;
        for (let i = 1; i < L; i++) t += PracticeSkills.stepXp(i);
        return t;
    },

    /** The level `xp` total XP makes */
    levelForXp(xp) {
        const max = PracticeSkills.maxLevel();
        let L = 1, t = 0;
        while (L < max) {
            t += PracticeSkills.stepXp(L);
            if (_num(xp) < t) break;
            L++;
        }
        return L;
    },

    levelName(level) {
        const names = PracticeSkills.config().levelNames || [];
        return names[Math.max(0, Math.min(names.length - 1, level - 1))] || `Level ${level}`;
    },

    /** The holder's skill store (made on first need; an old swimPractice converted) */
    _store(holder, make = false) {
        if (!holder) return null;
        if (holder.swimPractice != null) PracticeSkills.migrate(holder);
        if (!holder.practiceSkills && make) holder.practiceSkills = {};
        return holder.practiceSkills || null;
    },

    xp(holder, id) {
        const s = PracticeSkills._store(holder);
        return s ? Math.max(0, _num(s[id])) : 0;
    },

    /** The level the XP makes, before age (for XP sums and the bar) */
    trainedLevel(holder, id) {
        return PracticeSkills.levelForXp(PracticeSkills.xp(holder, id));
    },

    /** The effective level — trained, shifted by age (ageShift), 1..max. Perks read this. */
    level(holder, id) {
        const L = PracticeSkills.trainedLevel(holder, id);
        let s = PracticeSkills.ageShift(holder, id);
        // Seasoning ripens practice: no bonus to a skill never taken up (seasoned.minLevel)
        if (s > 0) {
            const S = ((PracticeSkills.config().age || {}).seasoned || {})[PracticeSkills.ageGroup(id)] || {};
            if (L < _num(S.minLevel, 2)) s = 0;
        }
        return s ? Math.max(1, Math.min(PracticeSkills.maxLevel(), L + s)) : L;
    },

    // ── Age (data/skillPacks/age.json) ──

    /** The holder's age in years, or null when unknown (taken as prime) */
    ageOf(holder) {
        if (!holder) return null;
        if (typeof holder.age === 'number' && Number.isFinite(holder.age)) return holder.age;
        if (typeof holder.skillAge === 'number' && Number.isFinite(holder.skillAge)) return holder.skillAge;
        return null;
    },

    /** The skill's age group: body | hardy | mind | other */
    ageGroup(id) {
        const G = (PracticeSkills.config().age || {}).groups || {};
        for (const [g, ids] of Object.entries(G)) if (Array.isArray(ids) && ids.includes(id)) return g;
        return 'other';
    },

    /** The XP multiplier for a skill of `group` at `age` (1 when unknown) */
    learnAt(age, group) {
        const A = PracticeSkills.config().age;
        if (!A || age == null || !Array.isArray(A.learn)) return 1;
        const row = A.learn.find(r => age < _num(r.under, 999));
        if (!row) return 1;
        return Math.max(0, _num(row[group], _num(row.other, 1)));
    },

    /** Levels added (seasoned) or lost (decline) for a skill of `group` at `age` */
    shiftAt(age, group) {
        const A = PracticeSkills.config().age;
        if (!A || age == null) return 0;
        const D = (A.decline || {})[group];
        let s = 0;
        if (D && age >= _num(D.onset, 999)) {
            s -= Math.min(_num(D.cap, 99), 1 + Math.floor((age - _num(D.onset)) / Math.max(1, _num(D.every, 5))));
        }
        const S = (A.seasoned || {})[group];
        if (S && age >= _num(S.from, 999)) s += _num(S.bonus);
        return s;
    },

    /** How fast the holder learns the skill at their age (XP multiplier; 1 when age unknown) */
    learnMult(holder, id) {
        return PracticeSkills.learnAt(PracticeSkills.ageOf(holder), PracticeSkills.ageGroup(id));
    },

    /** Levels the holder's age adds to or takes from the skill (0 when age unknown) */
    ageShift(holder, id) {
        return PracticeSkills.shiftAt(PracticeSkills.ageOf(holder), PracticeSkills.ageGroup(id));
    },

    /**
     * The holder's years, told for a panel → { age, learn {group: ×}, shift
     * {group: levels}, lines ["learning ×1.25", "body skills −1 level"] } or null
     */
    ageSummary(holder) {
        const A = PracticeSkills.config().age;
        const age = PracticeSkills.ageOf(holder);
        if (!A || age == null) return null;
        const names = A.groupNames || {};
        const groups = ['body', 'hardy', 'mind', 'other'];
        const learn = {}, shift = {};
        for (const g of groups) { learn[g] = PracticeSkills.learnAt(age, g); shift[g] = PracticeSkills.shiftAt(age, g); }
        const x = (v) => `×${Math.round(v * 100) / 100}`;
        const lines = [groups.every(g => learn[g] === learn.body)
            ? `learning ${x(learn.body)}`
            : `learning ${groups.map(g => `${names[g] || g} ${x(learn[g])}`).join(', ')}`];
        for (const g of groups) {
            if (shift[g]) lines.push(`${names[g] || g} skills ${shift[g] > 0 ? '+' : '−'}${Math.abs(shift[g])} level${Math.abs(shift[g]) === 1 ? '' : 's'}`);
        }
        return { age, learn, shift, lines };
    },

    /** The age milestone reached at exactly `age` years ({ age, icon, title, text }) or null */
    ageMilestone(age) {
        const M = (PracticeSkills.config().age || {}).milestones;
        if (!Array.isArray(M) || age == null) return null;
        return M.find(m => m && _num(m.age, -1) === age) || null;
    },

    /**
     * A birthday: queue the milestone's notice for the player (told like a
     * level-up by ui/skillUps.js). Called once as each year begins, so each
     * is told once. → the event or null
     */
    birthday(player) {
        const m = player ? PracticeSkills.ageMilestone(PracticeSkills.ageOf(player)) : null;
        if (!m) return null;
        const icon = m.icon || '⏳';
        const ev = { skill: null, age: m.age, name: m.title, icon, heading: `${icon} ${m.title}`, title: `${icon} ${m.title}`, text: m.text, gains: [] };
        // Onto the player's queue of skill notices (unsaved), told by ui/skillUps.js
        if (!Object.prototype.hasOwnProperty.call(player, '_skillUps')) {
            Object.defineProperty(player, '_skillUps', { value: [], configurable: true, enumerable: false, writable: true });
        }
        player._skillUps.push(ev);
        return ev;
    },

    /** → { id, name, icon, level (trained), effective, ageShift, levelName, xp, into, need, share (0..1 toward the next), max } */
    progress(holder, id) {
        const d = PracticeSkills.def(id) || {};
        const xp = PracticeSkills.xp(holder, id);
        const level = PracticeSkills.levelForXp(xp);
        const effective = PracticeSkills.level(holder, id);
        const max = level >= PracticeSkills.maxLevel();
        const at = PracticeSkills.xpForLevel(level);
        const need = max ? 0 : PracticeSkills.stepXp(level);
        const into = xp - at;
        return {
            id, name: d.name || id, icon: d.icon || '⭐', desc: d.desc || '',
            level, levelName: PracticeSkills.levelName(level), xp, into, need,
            effective, ageShift: effective - level, effectiveName: PracticeSkills.levelName(effective),
            share: max ? 1 : Math.max(0, Math.min(1, into / Math.max(1, need))), max,
        };
    },

    /** A perk's value at a level */
    perkAt(id, perkId, level) {
        const d = PracticeSkills.def(id);
        const p = d && d.perks && d.perks[perkId];
        const lv = p && Array.isArray(p.levels) ? p.levels : null;
        if (!lv || !lv.length) return 0;
        return _num(lv[Math.max(0, Math.min(lv.length - 1, Math.floor(level) - 1))]);
    },

    /** A perk's value for the holder */
    perk(holder, id, perkId) {
        return PracticeSkills.perkAt(id, perkId, PracticeSkills.level(holder, id));
    },

    /** What going from level `from` to `to` gives: ["+8s of breath", …] */
    gainsBetween(id, from, to) {
        const d = PracticeSkills.def(id);
        if (!d || !d.perks) return [];
        const out = [];
        for (const [pid, p] of Object.entries(d.perks)) {
            if (pid.startsWith('_') || !p || !p.text) continue;
            const a = PracticeSkills.perkAt(id, pid, from), b = PracticeSkills.perkAt(id, pid, to);
            if (a === b) continue;
            out.push(_fmt(p.text, { d: b - a, a: Math.abs(b - a), v: b }));
        }
        return out;
    },

    /** What the holder's next level would give (empty at the top) */
    nextGains(holder, id) {
        if (PracticeSkills.trainedLevel(holder, id) >= PracticeSkills.maxLevel()) return [];
        const L = PracticeSkills.level(holder, id);
        return PracticeSkills.gainsBetween(id, L, Math.min(PracticeSkills.maxLevel(), L + 1));
    },

    /** Each perk's present value, described ("55s of breath") */
    describe(holder, id) {
        const d = PracticeSkills.def(id);
        if (!d || !d.perks) return [];
        const L = PracticeSkills.level(holder, id);
        const out = [];
        for (const [pid, p] of Object.entries(d.perks)) {
            if (pid.startsWith('_') || !p || !p.show) continue;
            const v = PracticeSkills.perkAt(id, pid, L);
            if (!v) continue;
            out.push(_fmt(p.show, { v }));
        }
        return out;
    },

    /**
     * Add XP. → a level-up event when a level is crossed, else null:
     * { skill, name, icon, from, to, levelName, gains, title, text }
     */
    gain(holder, id, amount) {
        if (!holder || !(amount > 0) || !PracticeSkills.def(id)) return null;
        const s = PracticeSkills._store(holder, true);
        const from = PracticeSkills.levelForXp(_num(s[id]));
        const cap = PracticeSkills.xpForLevel(PracticeSkills.maxLevel());
        // The young learn faster, the old body slower (learnMult; 1 when age unknown)
        const got = amount * PracticeSkills.learnMult(holder, id);
        s[id] = Math.min(cap, Math.round((_num(s[id]) + got) * 1000) / 1000);
        const to = PracticeSkills.levelForXp(s[id]);
        if (to <= from) return null;
        return PracticeSkills._event(id, from, to, PracticeSkills.ageShift(holder, id));
    },

    _event(id, from, to, shift = 0) {
        const d = PracticeSkills.def(id) || {};
        const name = d.name || id;
        // What the rise gives at the holder's age (the effective levels it moves between)
        const eff = (L) => Math.max(1, Math.min(PracticeSkills.maxLevel(), L + shift));
        const gains = PracticeSkills.gainsBetween(id, eff(from), eff(to));
        const levelName = PracticeSkills.levelName(to);
        return {
            skill: id, name, icon: d.icon || '⭐', from, to, levelName, gains,
            title: `${d.icon || '⭐'} ${name} ${to}`,
            text: `${name} rose to level ${to} (${levelName})${gains.length ? `: ${gains.join(', ')}` : ''}.`,
        };
    },

    /** Set a level outright (its XP at the level's start). */
    setLevel(holder, id, level) {
        const s = PracticeSkills._store(holder, true);
        s[id] = PracticeSkills.xpForLevel(level);
        return s[id];
    },

    /** Every skill with its progress, perks and next gains, for a panel */
    list(holder) {
        return PracticeSkills.ids().map(id => ({
            ...PracticeSkills.progress(holder, id),
            perks: PracticeSkills.describe(holder, id),
            next: PracticeSkills.nextGains(holder, id),
        }));
    },

    /**
     * An old save's continuous swimming practice (player.swimPractice, 0..400)
     * into XP; the old field goes so it isn't counted twice.
     */
    migrate(holder) {
        if (!holder || holder.swimPractice == null) return false;
        const old = Math.max(0, _num(holder.swimPractice));
        delete holder.swimPractice;
        if (!holder.practiceSkills) holder.practiceSkills = {};
        const rates = PracticeSkills.config().migrate.swimPractice || {};
        const cap = PracticeSkills.xpForLevel(PracticeSkills.maxLevel());
        for (const [id, rate] of Object.entries(rates)) {
            if (!PracticeSkills.def(id)) continue;
            holder.practiceSkills[id] = Math.min(cap, Math.max(_num(holder.practiceSkills[id]), Math.round(old * _num(rate))));
        }
        return true;
    },

    // ══════════════════════════════════════════════
    // NPCs
    // ══════════════════════════════════════════════

    /** Is the world hex (q, r) beside the sea or a lake? */
    coastalAt(world, q, r) {
        if (!world || typeof world.getTile !== 'function' || q == null || r == null) return false;
        const here = world.getTile(q, r);
        if (here && here.terrain && COAST_WATER.includes(here.terrain.id)) return true;
        return Hex.neighbors(q, r).some(n => {
            const t = world.getTile(n.q, n.r);
            return !!(t && t.terrain && COAST_WATER.includes(t.terrain.id));
        });
    },

    /**
     * The trade a person works for their skills: a sailor or fisher by role,
     * or (by a coastal town) a share of some roles out on the water.
     * who: { key, role, coastal }
     */
    tradeOf(who) {
        const N = PracticeSkills.config().npc;
        const role = (who && who.role) || 'villager';
        if (who && who.coastal) {
            const trades = (N.coastalTrades || {})[role];
            if (trades) {
                const roll = (Utils.hashStr(`${who.key || ''}|trade`) >>> 0) / 4294967296;
                let acc = 0;
                for (const [t, share] of Object.entries(trades)) {
                    acc += _num(share);
                    if (roll < acc) return t;
                }
            }
        }
        return role;
    },

    /**
     * A craft some people work on the side (npc.craftTrades: a share of
     * villagers weave, brew or heal…), picked by a hash of who they are → the
     * craft's role id, or null. Adds its roles levels and dailyXp.
     */
    craftOf(who) {
        const trades = ((PracticeSkills.config().npc.craftTrades) || {})[(who && who.role) || 'villager'];
        if (!trades) return null;
        const roll = (Utils.hashStr(`${(who && who.key) || ''}|craft`) >>> 0) / 4294967296;
        let acc = 0;
        for (const [t, share] of Object.entries(trades)) {
            acc += _num(share);
            if (roll < acc) return t;
        }
        return null;
    },

    /**
     * Body work some people do (data/skillPacks/body.json): a share of some
     * roles everywhere haul as labourers or porters (npc.labourTrades), and in
     * or by the mountains (who.mountain) climb as mountaineers or dig as miners
     * (npc.mountainTrades) → role ids for their levels and dailyXp.
     */
    bodyTradesOf(who) {
        const N = PracticeSkills.config().npc;
        const role = (who && who.role) || 'villager';
        const pick = (table, salt) => {
            const trades = (table || {})[role];
            if (!trades) return null;
            const roll = (Utils.hashStr(`${(who && who.key) || ''}|${salt}`) >>> 0) / 4294967296;
            let acc = 0;
            for (const [t, share] of Object.entries(trades)) {
                acc += _num(share);
                if (roll < acc) return t;
            }
            return null;
        };
        return [pick(N.labourTrades, 'labour'), who && who.mountain ? pick(N.mountainTrades, 'mountain') : null].filter(Boolean);
    },

    /** Is the world hex (q, r) in or beside the mountains (npc.mountainTerrains)? */
    mountainAt(world, q, r) {
        if (!world || typeof world.getTile !== 'function' || q == null || r == null) return false;
        const ids = PracticeSkills.config().npc.mountainTerrains || ['mountain', 'snow_peak', 'highlands'];
        const hit = (t) => !!(t && t.terrain && ids.includes(t.terrain.id));
        return hit(world.getTile(q, r)) || Hex.neighbors(q, r).some(n => hit(world.getTile(n.q, n.r)));
    },

    /**
     * Give an NPC levels from who they are, if they have none yet.
     * who: { key (stable id), role, age, coastal } → the store
     */
    seedNpc(holder, who = {}) {
        if (!holder) return null;
        if (typeof who.age === 'number') holder.skillAge = who.age;   // age shapes their skills (ageShift)
        if (holder.practiceSkills) return holder.practiceSkills;
        const N = PracticeSkills.config().npc;
        const trade = PracticeSkills.tradeOf(who);
        const byRole = (N.roles || {})[trade] || {};
        const craft = PracticeSkills.craftOf(who);
        const byCraft = (craft && (N.roles || {})[craft]) || {};
        const body = PracticeSkills.bodyTradesOf(who).map(t => (N.roles || {})[t] || {});
        const age = _num(who.age, 30);
        const s = {};
        for (const id of PracticeSkills.ids()) {
            let L = _num((N.base || {})[id], 1) + _num(byRole[id]) + _num(byCraft[id]);
            if (who.coastal) L += _num((N.coastal || {})[id]);
            if (who.mountain) L += _num((N.mountain || {})[id]);
            for (const b of body) L += _num(b[id]);
            const spread = Math.max(0, N.spread | 0);
            if (spread) L += (Utils.hashStr(`${who.key || ''}|${id}`) >>> 0) % (spread + 1);
            if (age > 20 && _num(N.ageBonus) > 0) L += Math.min(_num(N.ageMax), Math.floor((age - 20) / N.ageBonus));
            if (age < _num(N.adultAge, 14)) L = Math.ceil(L / 2);
            L = Math.max(1, Math.min(PracticeSkills.maxLevel(), Math.round(L)));
            if (L > 1) s[id] = PracticeSkills.xpForLevel(L);
        }
        holder.practiceSkills = s;
        return s;
    },

    /** `days` of an NPC's work: XP for what their trade does (no events) */
    growNpc(holder, who = {}, days = 1) {
        if (!holder || !(days > 0)) return;
        if (typeof who.age === 'number') holder.skillAge = who.age;
        const N = PracticeSkills.config().npc;
        if (_num(who.age, 30) < _num(N.adultAge, 14)) return;
        const trade = PracticeSkills.tradeOf(who);
        const rates = { ...((N.dailyXp || {})[trade] || {}) };
        if (who.coastal && trade === who.role) {
            for (const [id, v] of Object.entries((N.dailyXp || {}).coastal || {})) rates[id] = Math.max(_num(rates[id]), _num(v));
        }
        const craft = PracticeSkills.craftOf(who);
        for (const [id, v] of Object.entries((craft && (N.dailyXp || {})[craft]) || {})) rates[id] = Math.max(_num(rates[id]), _num(v));
        for (const t of [...PracticeSkills.bodyTradesOf(who), ...(who.mountain ? ['mountain'] : [])]) {
            for (const [id, v] of Object.entries((N.dailyXp || {})[t] || {})) rates[id] = Math.max(_num(rates[id]), _num(v));
        }
        for (const [id, rate] of Object.entries(rates)) if (rate > 0) PracticeSkills.gain(holder, id, rate * days);
    },

    /** An NPC's skills worth a mention: [{ id, name, icon, level, levelName }] best first */
    notable(holder, min = null) {
        const floor = min != null ? min : _num(PracticeSkills.config().npc.notableLevel, 4);
        // At their effective level: an old diver's breath is shorter than his XP
        return PracticeSkills.ids()
            .map(id => PracticeSkills.progress(holder, id))
            .map(p => ({ ...p, trained: p.level, level: p.effective, levelName: p.effectiveName }))
            .filter(p => p.level >= floor)
            .sort((a, b) => b.level - a.level);
    },
};
