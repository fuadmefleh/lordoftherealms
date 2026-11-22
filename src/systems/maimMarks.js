// ============================================
// MAIM MARKS — what a body has lost, and what that loss does
// ============================================
// The body's half of maiming (the deed and its cost to the one who does it:
// systems/maiming.js). Anyone can carry it — a townsperson on a town's roster,
// a vassal of the royal court, a child of the House, a pretender, a captured
// outlaw, the player:
//
//   person.maimed = {
//       parts: { hand: 0..2, eye: 0..2, ear: 0..2, nose: 0|1, tongue: 0|1,
//                foot: 0..2, brand: 0|1, geld: 0|1 },
//       log:   [{ a: act, d: day, by: name, w: why }]   (the last few)
//       taken: { attrs: {}, skills: {} }  what was taken from the person's own
//              stats (only one who has them: the player, a child, a vassal)
//       aids:  { [aidId]: day }           eye patch, hook, wooden leg… (worn)
//   }
//
// Every reader asks here, so the effect of a loss is in one place: the stats
// (taken once, given back in part by an aid), movement and fighting power
// (systems/ailments.js), letters (systems/literacy.js: the blind can't read,
// the handless can't write), the work a townsperson can still do
// (systems/townJobs.js), office and rule (systems/kingship.js council,
// the heir lists, the crown's claimants: barsRule / barsOffice), speech
// (ui/npcDialog: the tongueless talk by signs), children (the gelded father
// none), how they look (tag / describe; the street map's eye patch).
//
// Pure: data from data/maiming.json; no randomness; no globals; no imports
// but the data loader, so any system may read it without a cycle.

import { DataLoader } from '../core/dataLoader.js';

const PARTS = ['hand', 'eye', 'ear', 'nose', 'tongue', 'foot', 'brand', 'geld'];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const FALLBACK = { enabled: true, loseTradeBelow: 0.25, acts: {}, aids: {} };
let _cfg = null;
let _cfgSrc;

export const MaimMarks = {
    PARTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.maiming : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...FALLBACK, ...d, acts: _obj(d.acts) || {}, aids: _obj(d.aids) || {} };
        }
        return _cfg;
    },

    act(id) { return MaimMarks.config().acts[id] || null; },
    aid(id) { return MaimMarks.config().aids[id] || null; },

    // ── Reading the body ───────────────────────────────────────

    /** The body record, or null (nothing lost). */
    body(p) { return p && _obj(p.maimed) ? p.maimed : null; },

    parts(p) {
        const b = MaimMarks.body(p);
        return (b && _obj(b.parts)) || {};
    },

    count(p, part) { return Math.max(0, Math.floor(_num(MaimMarks.parts(p)[part]))); },
    has(p, part) { return MaimMarks.count(p, part) > 0; },
    any(p) { return PARTS.some(k => MaimMarks.count(p, k) > 0); },

    /** The aids the person wears: { aidId: day }. */
    aids(p) {
        const b = MaimMarks.body(p);
        return (b && _obj(b.aids)) || {};
    },

    wears(p, aidId) { return MaimMarks.aids(p)[aidId] != null; },

    /** The count records (data acts[part].counts) in force: [{ part, n, def }]. */
    _counts(p) {
        const out = [];
        for (const part of PARTS) {
            const n = MaimMarks.count(p, part);
            const def = MaimMarks.act(part);
            if (!n || !def) continue;
            const list = Array.isArray(def.counts) ? def.counts : [];
            for (let i = 0; i < n && i < list.length; i++) out.push({ part, n: i + 1, def: list[i] || {} });
        }
        return out;
    },

    _flag(p, flag) { return MaimMarks._counts(p).some(c => Array.isArray(c.def.flags) && c.def.flags.includes(flag)); },

    blind(p) { return MaimMarks._flag(p, 'blind'); },
    mute(p) { return MaimMarks._flag(p, 'mute'); },
    gelded(p) { return MaimMarks._flag(p, 'gelded'); },
    handless(p) { return MaimMarks.count(p, 'hand') >= 2; },
    canRead(p) { return !MaimMarks.blind(p); },
    canWrite(p) { return !MaimMarks._flag(p, 'noWrite') && !MaimMarks.blind(p); },

    /** Why this body may never sit a throne (the heir lists, the crown's claimants), or null. */
    barsRule(p) {
        const c = MaimMarks._counts(p).find(x => x.def.barsRule);
        if (!c) return null;
        return MaimMarks._shortOf(c.part, c.n);
    },

    /** Why this body may never sit a council or hold an office, or null. */
    barsOffice(p) {
        const c = MaimMarks._counts(p).find(x => x.def.barsOffice);
        return c ? MaimMarks._shortOf(c.part, c.n) : null;
    },

    _shortOf(part, n) {
        const def = MaimMarks.act(part) || {};
        return n >= 2 && def.both ? def.both : (def.short || part);
    },

    // ── What the loss does ─────────────────────────────────────

    /**
     * The net effects of the body's losses, less what its aids give back:
     * { attrs, skills, movement (hexes lost), battle (share lost) }.
     * An aid gives back only what its part took.
     */
    effects(p) {
        const attrs = {};
        const skills = {};
        let movement = 0;
        let battle = 0;
        const byPart = {};
        for (const c of MaimMarks._counts(p)) {
            const bp = byPart[c.part] || (byPart[c.part] = { attrs: {}, skills: {}, movement: 0, battle: 0 });
            for (const [k, v] of Object.entries(c.def.attrs || {})) if (v < 0) bp.attrs[k] = _num(bp.attrs[k]) - v;
            for (const [k, v] of Object.entries(c.def.skills || {})) if (v < 0) bp.skills[k] = _num(bp.skills[k]) - v;
            bp.movement += _num(c.def.movement);
            bp.battle += _num(c.def.battle);
        }
        // Each aid offsets its own part's loss, never more than it took
        for (const id of Object.keys(MaimMarks.aids(p))) {
            const a = MaimMarks.aid(id);
            const bp = a && byPart[a.fits];
            if (!bp) continue;
            const o = a.offsets || {};
            for (const [k, v] of Object.entries(o.attrs || {})) if (bp.attrs[k]) bp.attrs[k] = Math.max(0, bp.attrs[k] - _num(v));
            for (const [k, v] of Object.entries(o.skills || {})) if (bp.skills[k]) bp.skills[k] = Math.max(0, bp.skills[k] - _num(v));
            bp.movement = Math.max(0, bp.movement - _num(o.movement));
            bp.battle = Math.max(0, bp.battle - _num(o.battle));
        }
        for (const bp of Object.values(byPart)) {
            for (const [k, v] of Object.entries(bp.attrs)) if (v) attrs[k] = _num(attrs[k]) + v;
            for (const [k, v] of Object.entries(bp.skills)) if (v) skills[k] = _num(skills[k]) + v;
            movement += bp.movement;
            battle += bp.battle;
        }
        return { attrs, skills, movement, battle: Math.min(0.9, battle) };
    },

    /** Hexes a day the body loses on the road (systems/ailments.js movementPenalty). */
    movement(p) { return MaimMarks.effects(p).movement; },

    /** × fighting power (systems/ailments.js battleMultiplier; a recruited outlaw's strength). */
    fightShare(p) { return Math.max(0.1, 1 - MaimMarks.effects(p).battle); },

    /** × the work a townsperson puts in at an occupation (systems/townJobs.js weight). */
    workFactor(p, occId) {
        let f = 1;
        for (const part of PARTS) {
            const n = MaimMarks.count(p, part);
            const def = MaimMarks.act(part);
            if (!n || !def || !Array.isArray(def.work)) continue;
            const w = def.work[Math.min(n, def.work.length) - 1] || {};
            const v = occId != null && w[occId] != null ? w[occId] : w.default;
            if (v != null) f = Math.min(f, _num(v, 1));
        }
        return Math.max(0, f);
    },

    /** Can they keep this trade at all? (below loseTradeBelow they beg) */
    keepsTrade(p, occId) {
        return MaimMarks.workFactor(p, occId) >= _num(MaimMarks.config().loseTradeBelow, 0.25);
    },

    // ── How they look ──────────────────────────────────────────

    /** A few words for a name tag: "one-eyed · a hand gone" ('' when whole). */
    tag(p) {
        const out = [];
        for (const part of PARTS) {
            const n = MaimMarks.count(p, part);
            if (n) out.push(MaimMarks._shortOf(part, n));
        }
        return out.join(' · ');
    },

    /** What one sees of them: "the stump of a wrist, one eye a puckered scar" ('' when whole). */
    looks(p) {
        const out = [];
        for (const part of PARTS) {
            const n = MaimMarks.count(p, part);
            const def = MaimMarks.act(part);
            if (!n || !def) continue;
            if (part === 'geld') continue; // (not something seen)
            const looks = Array.isArray(def.look) ? def.look : [];
            out.push(looks[Math.min(n, looks.length) - 1] || MaimMarks._shortOf(part, n));
        }
        return out.join(', ');
    },

    /** The eye patch for the street map's sprite (one eye gone, a patch worn — an NPC wears one by a fixed share). */
    patched(p) {
        if (MaimMarks.count(p, 'eye') !== 1) return false;
        if (MaimMarks.wears(p, 'eye_patch')) return true;
        // (townsfolk: most who lost an eye cover it; a hash of who they are, the same all game)
        if (p && p.maimed && p.maimed.npcPatch != null) return !!p.maimed.npcPatch;
        return false;
    },

    /**
     * What shows of the body, for the sprite (ui/maimLook.js draws it): null when nothing
     * does, else { hands: { R, L } ('stump' | 'hook' | null), feet: { R, L } ('stump' |
     * 'peg' | null), crutch: 'L' | 'R' | null, eyes: 'patch' | 'scar' | 'blind' | null,
     * ears: 0..2, nose: 'slit' | 'copper' | null, brand }. The first hand taken is the
     * right (a thief's hand), the first foot the left, the first ear the right; the hook
     * and the wooden leg go on the first stump, the crutch under the arm of the lost foot.
     * (A tongue or a gelding doesn't show.)
     */
    visible(p) {
        if (!MaimMarks.any(p)) return null;
        const hand = MaimMarks.count(p, 'hand');
        const foot = MaimMarks.count(p, 'foot');
        const eye = MaimMarks.count(p, 'eye');
        const hook = hand > 0 && MaimMarks.wears(p, 'iron_hook');
        const peg = foot > 0 && MaimMarks.wears(p, 'wooden_leg');
        const v = {
            hands: { R: hand >= 1 ? (hook ? 'hook' : 'stump') : null, L: hand >= 2 ? 'stump' : null },
            feet: { L: foot >= 1 ? (peg ? 'peg' : 'stump') : null, R: foot >= 2 ? 'stump' : null },
            crutch: foot > 0 && MaimMarks.wears(p, 'crutch') ? 'L' : null,
            eyes: eye >= 2 ? 'blind' : eye === 1 ? (MaimMarks.patched(p) ? 'patch' : 'scar') : null,
            ears: Math.min(2, MaimMarks.count(p, 'ear')),
            nose: MaimMarks.has(p, 'nose') ? (MaimMarks.wears(p, 'false_nose') ? 'copper' : 'slit') : null,
            brand: MaimMarks.has(p, 'brand'),
        };
        const shows = v.hands.R || v.feet.L || v.eyes || v.ears || v.nose || v.brand;
        return shows ? v : null;
    },

    // ── Changing the body ──────────────────────────────────────

    /** Why this act can't be done to this body now (null when it can). */
    whyNot(p, part) {
        const def = MaimMarks.act(part);
        if (!def) return 'No such thing.';
        if (MaimMarks.count(p, part) >= _num(def.max, 1)) return part === 'eye' ? 'They are already blind.' : 'There is nothing left there to take.';
        if (def.males && p && p.gender === 'female') return 'Not a man.';
        return null;
    },

    /**
     * Take a part from a body: the count, the log, the stats (a person with
     * stats of their own: the player, a child, a vassal). opts { day, by, why,
     * patch (an NPC who covers a lost eye) }. → the act's def, or null.
     */
    mark(p, part, opts = {}) {
        if (!p || MaimMarks.whyNot(p, part)) return null;
        const def = MaimMarks.act(part);
        if (!_obj(p.maimed)) p.maimed = { parts: {}, log: [] };
        const b = p.maimed;
        if (!_obj(b.parts)) b.parts = {};
        if (!Array.isArray(b.log)) b.log = [];
        b.parts[part] = MaimMarks.count(p, part) + 1;
        b.log.push({ a: part, d: _num(opts.day), by: opts.by || null, w: opts.why || null });
        if (b.log.length > 8) b.log.shift();
        if (opts.patch != null && part === 'eye' && b.npcPatch == null) b.npcPatch = !!opts.patch;
        MaimMarks.reapply(p);
        return def;
    },

    /** Put on an aid (made for this body). */
    fitAid(p, aidId, day = 0) {
        const a = MaimMarks.aid(aidId);
        if (!p || !a || !MaimMarks.has(p, a.fits)) return false;
        if (!_obj(p.maimed.aids)) p.maimed.aids = {};
        // (one aid to a slot: a wooden leg replaces the crutch)
        for (const id of Object.keys(p.maimed.aids)) {
            const o = MaimMarks.aid(id);
            if (o && o.slot === a.slot) delete p.maimed.aids[id];
        }
        p.maimed.aids[aidId] = day;
        MaimMarks.reapply(p);
        return true;
    },

    /** Does this person keep stats of their own (attributes or skills) for a loss to take from? */
    _hasStats(p) {
        return !!p && (typeof p.strength === 'number' || _obj(p.skills) != null);
    },

    /**
     * Take the body's net effects from the person's own stats (giving back
     * what was taken before, then taking what is due now): the record of what
     * was taken is kept, so an aid fitted later, or a new heir, settles true.
     */
    reapply(p) {
        if (!p || !_obj(p.maimed) || !MaimMarks._hasStats(p)) return null;
        const b = p.maimed;
        const t = _obj(b.taken) || { attrs: {}, skills: {} };
        for (const [k, v] of Object.entries(t.attrs || {})) if (typeof p[k] === 'number') p[k] += _num(v);
        if (_obj(p.skills)) for (const [k, v] of Object.entries(t.skills || {})) if (typeof p.skills[k] === 'number') p.skills[k] += _num(v);
        const fx = MaimMarks.effects(p);
        const taken = { attrs: {}, skills: {} };
        for (const [k, v] of Object.entries(fx.attrs)) {
            if (typeof p[k] !== 'number') continue;
            const amt = Math.max(0, Math.min(v, p[k] - 1));
            if (amt > 0) { p[k] -= amt; taken.attrs[k] = amt; }
        }
        if (_obj(p.skills)) {
            for (const [k, v] of Object.entries(fx.skills)) {
                if (typeof p.skills[k] !== 'number') continue;
                const amt = Math.max(0, Math.min(v, p.skills[k]));
                if (amt > 0) { p.skills[k] -= amt; taken.skills[k] = amt; }
            }
        }
        b.taken = taken;
        return taken;
    },
};
