// ============================================
// NPC MEMORY — what the townsfolk (and lords) remember of the player's House
// ============================================
// A small store of the deeds that mattered, kept on the person who lived
// them, for years: "You're the one who paid for my mother's burial." "Your
// grandfather hanged my father." Tuned in data/npcMemory.json.
//
//   person.nm = [episode]      (a townsperson: settlement.folk.people[i])
//   folk.nm   = [episode]      (the town's own memory: a raid, a famine dole,
//                               a hanging in the square — every resident knows it)
//   episode = { k: kind, w: weight when it happened (signed), d: day,
//               by: the actor's name, bh: the actor's House name, bg: the House's
//               generation then, bs: 'm'|'f',
//               vn?: the victim's name, vr?: who the victim is to the holder
//               ('father', 'wife', …; absent = the holder themself),
//               g?: generations it has been handed down, fr?: who told it,
//               n?: a short note }
//
// Weight fades by half every kind.halfLife days (on read: no daily tick);
// the strongest (|w| ≥ foreverAt) never fall below foreverFloor of their
// weight, so they are kept forever. Each person keeps the perPerson
// strongest; a town keeps perTown. When the holder dies their memories pass
// to their children (else siblings, else spouse) as family stories, weaker
// each generation, and are dropped from the dead — so the roster's pruning
// of the long dead keeps save size bounded. A living parent's memories are
// also read through ("my father says…") without being copied.
//
// Lords: NPCLords.rememberDeed / memoryOf (world/npcLords.js, lordMemory.json)
// already keep this for kingdom rulers; NpcMemory routes a lord ref there.
//
// Readers: NpcDisposition prices / refusals, TownJobs (work), StreetCrime
// (testimony), Holdings (unrest → rebellion), the dialog greeting and the
// LLM brain's memories (ui/npcDialog). No randomness; no globals.

import { DataLoader } from '../core/dataLoader.js';
import { NPCLords } from '../world/npcLords.js';

const DEFAULTS = {
    enabled: true, perPerson: 6, perTown: 8, forgetBelow: 0.5, foreverAt: 14, foreverFloor: 0.35,
    mergeDays: 5, stackCap: 3, passShare: 0.6, bloodPassShare: 0.85, passMin: 2, maxGenerations: 4,
    parentShare: 0.5, townShare: 0.5, cap: 40, actorShare: [1, 0.8, 0.6, 0.45], sweepDays: 30,
    priceDivisor: 200, priceMin: -0.15, priceMax: 0.2, refuseTradeBelow: -30, workPer: 0.01,
    refuseWorkBelow: -25, shieldAt: 25, unrestPer: 0.005, greetEveryDays: 30, greetMin: 4,
};

// Who a victim is to the one who hears the story: the holder's word → the recipient's word
const TO_CHILD = {
    father: 'grandfather', mother: 'grandmother', grandfather: 'great-grandfather', grandmother: 'great-grandmother',
    'great-grandfather': 'forefather', 'great-grandmother': 'foremother', forefather: 'forefather', foremother: 'foremother',
    husband: 'father', wife: 'mother', brother: 'uncle', sister: 'aunt', son: 'brother', daughter: 'sister',
    uncle: 'great-uncle', aunt: 'great-aunt',
};
const TO_SIBLING = {
    father: 'father', mother: 'mother', grandfather: 'grandfather', grandmother: 'grandmother',
    husband: 'brother-in-law', wife: 'sister-in-law', son: 'nephew', daughter: 'niece', brother: 'brother', sister: 'sister',
};
const TO_SPOUSE = { father: 'father-in-law', mother: 'mother-in-law', son: 'son', daughter: 'daughter' };

let _cfgCache = null;
let _cfgSrc;

function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }
function _r1(v) { return Math.round(v * 10) / 10; }
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function _day(world, d) { return Number.isFinite(d) ? d : _num(world && world.day, 1); }
function _fill(t, vars) { return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : '')).replace(/\s+/g, ' ').trim(); }
function _sexWord(sex, m, f) { return sex === 'f' ? f : m; }

function _get(folk, id) {
    if (!folk || id == null || !Array.isArray(folk.people)) return null;
    if (folk._index && folk._index.size === folk.people.length) return folk._index.get(id) || null;
    return folk.people.find(p => p.id === id) || null;
}
function _kinWord(p, rel) {
    const f = p && p.gender === 'female';
    return { spouse: f ? 'wife' : 'husband', parent: f ? 'mother' : 'father', child: f ? 'daughter' : 'son', sibling: f ? 'sister' : 'brother' }[rel] || rel;
}
function _siblings(folk, p) {
    if (!folk || !p || !Array.isArray(p.parents) || !p.parents.length) return [];
    return folk.people.filter(o => o.id !== p.id && Array.isArray(o.parents) && o.parents.some(id => p.parents.includes(id)));
}
function _alive(p) { return !!p && p.died == null; }
function _pname(p) { return p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone'; }

export const NpcMemory = {
    // ── Tuning ───────────────────────────────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.npcMemory) || {};
    },

    config() {
        const d = NpcMemory.data();
        if (_cfgCache && _cfgSrc === d) return _cfgCache;
        _cfgSrc = d;
        _cfgCache = { ...DEFAULTS, ...((d && d.config) || {}) };
        return _cfgCache;
    },

    kind(k) { return (NpcMemory.data().kinds || {})[k] || null; },

    enabled() { return NpcMemory.config().enabled !== false; },

    // ── Who is meant ─────────────────────────────────

    /**
     * Resolve a person reference to { type: 'folk', p, folk } or { type: 'lord', lord }.
     * Accepts: an inner-map NPC dressed from the roster (npc._person/_folk), a uid string
     * 'q,r#id' (npc.uid) or 'lord:<kingdomId>', { folk, person } / { folk, id },
     * { q, r, id }, { lord } / a kingdom (k.lord), { kingdomId }, or a roster person itself.
     */
    resolve(world, ref) {
        if (!ref) return null;
        if (typeof ref === 'string') {
            if (ref.startsWith('lord:')) return NpcMemory._lordRef(world, ref.slice(5));
            const m = /^(-?\d+),(-?\d+)#(\d+)$/.exec(ref);
            if (!m) return null;
            return NpcMemory.resolve(world, { q: +m[1], r: +m[2], id: +m[3] });
        }
        if (typeof ref !== 'object') return null;
        if (ref._person) return { type: 'folk', p: ref._person, folk: ref._folk || null };
        if (ref.folk && ref.person) return { type: 'folk', p: ref.person, folk: ref.folk };
        if (ref.folk && ref.id != null) { const p = _get(ref.folk, ref.id); return p ? { type: 'folk', p, folk: ref.folk } : null; }
        if (ref.q != null && ref.r != null && ref.id != null) {
            const t = world && typeof world.getTile === 'function' ? world.getTile(ref.q, ref.r) : null;
            const folk = t && t.settlement && t.settlement.folk;
            const p = _get(folk, ref.id);
            return p ? { type: 'folk', p, folk } : null;
        }
        if (ref.lord && typeof ref.lord === 'object') return { type: 'lord', lord: ref.lord };
        if (ref.kingdomId != null && Object.keys(ref).length === 1) return NpcMemory._lordRef(world, ref.kingdomId);
        if (Array.isArray(ref.parents) && ref.born != null) return { type: 'folk', p: ref, folk: null };
        if (ref.isLord || (ref.kingdomId != null && Array.isArray(ref.memory))) return { type: 'lord', lord: ref };
        return null;
    },

    _lordRef(world, kid) {
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(isNaN(+kid) ? kid : +kid) || world.getKingdom(kid) : null;
        return k && k.lord ? { type: 'lord', lord: k.lord } : null;
    },

    /** A stable string for a person: 'q,r#id' for a townsperson, 'lord:<kingdomId>' for a lord (null if neither). */
    refOf(world, ref) {
        const r = NpcMemory.resolve(world, ref);
        if (!r) return null;
        if (r.type === 'lord') return r.lord.kingdomId != null ? `lord:${r.lord.kingdomId}` : null;
        return r.folk ? `${r.folk.q},${r.folk.r}#${r.p.id}` : null;
    },

    // ── Weight and fading ────────────────────────────

    /** An episode's weight as it stands on `day`. */
    weightAt(ep, day) {
        const C = NpcMemory.config();
        const def = NpcMemory.kind(ep.k);
        const half = def && def.halfLife > 0 ? def.halfLife : 360;
        let f = Math.pow(0.5, Math.max(0, day - _num(ep.d, day)) / half);
        if (Math.abs(_num(ep.w)) >= C.foreverAt) f = Math.max(f, C.foreverFloor);
        return _num(ep.w) * f;
    },

    /** Put an episode into a list, merging a repeat, forgetting the faded, keeping the `cap` strongest. */
    _store(list, ep, cap, day) {
        const C = NpcMemory.config();
        const def = NpcMemory.kind(ep.k) || {};
        let kept = list.filter(e => Math.abs(NpcMemory.weightAt(e, day)) >= C.forgetBelow);
        const last = kept.find(e => e.k === ep.k && !e.g && e.by === ep.by && (e.vn || null) === (ep.vn || null) && day - _num(e.d) <= C.mergeDays);
        let out = ep;
        if (last) {
            const lim = Math.abs(_num(def.weight, ep.w)) * C.stackCap;
            last.w = _r1(Math.max(-lim, Math.min(lim, NpcMemory.weightAt(last, day) + ep.w)));
            last.d = day;
            out = last;
        } else kept.push(ep);
        if (kept.length > cap) {
            kept.sort((a, b) => Math.abs(NpcMemory.weightAt(b, day)) - Math.abs(NpcMemory.weightAt(a, day)));
            if (kept.indexOf(out) >= cap) out = null;
            kept.length = cap;
        }
        list.length = 0;
        for (const e of kept) list.push(e);
        return out;
    },

    /** The actor fields of an episode, from the player (or explicit by/house/generation/sex). */
    _actor(episode) {
        const pl = episode.player || null;
        const house = pl && pl.house;
        return {
            by: String(episode.by || (pl && (pl.name || pl.firstName)) || 'a stranger').slice(0, 40),
            bh: episode.house || (house && house.name) || null,
            bg: _num(episode.generation, house ? _num(house.generation, 1) : 1),
            bs: episode.sex || (pl && pl.gender === 'female' ? 'f' : 'm'),
        };
    },

    _episode(world, episode, extra = {}) {
        const def = NpcMemory.kind(episode.kind);
        if (!def) return null;
        const w = Number.isFinite(episode.weight) ? episode.weight : _num(def.weight);
        if (!w) return null;
        const ep = { k: episode.kind, w: _r1(w), d: _day(world, episode.day), ...NpcMemory._actor(episode) };
        if (!ep.bh) delete ep.bh;
        const v = episode.victim;
        if (v) {
            const vn = typeof v === 'string' ? v : (v.first ? _pname(v) : v.name);
            if (vn) ep.vn = String(vn).slice(0, 40);
            if (v.rel) ep.vr = v.rel;
        }
        if (extra.vr) ep.vr = extra.vr;
        if (extra.vn) ep.vn = extra.vn;
        if (episode.note) ep.n = String(episode.note).slice(0, 60);
        return ep;
    },

    // ── Writing ──────────────────────────────────────

    /**
     * A person remembers an episode. episode = { kind (data/npcMemory.json kinds), weight?, day?,
     * player? (the actor: name, gender, House and its generation are read from it) or by/house/
     * generation/sex, victim? (a roster person, a name, or { name, rel } — omit when the holder
     * is the one it happened to), note?, kin? (true: the holder's family learn of it too, as
     * something done to their kin) }. A lord ref is routed to NPCLords.rememberDeed through the
     * kind's lordDeed. → the stored episode (or the lord's memory entry), or null.
     */
    remember(world, personRef, episode = {}) {
        if (!NpcMemory.enabled() || !episode || !episode.kind) return null;
        const r = NpcMemory.resolve(world, personRef);
        if (!r) return null;
        if (r.type === 'lord') {
            const def = NpcMemory.kind(episode.kind);
            if (!def || !def.lordDeed) return null;
            const opts = { note: episode.note || (episode.victim && (episode.victim.name || episode.victim)) || undefined };
            if (Number.isFinite(episode.day)) opts.day = episode.day;
            return NPCLords.rememberDeed(world, r.lord, def.lordDeed, opts);
        }
        const ep = NpcMemory._episode(world, episode);
        if (!ep) return null;
        const out = NpcMemory._put(r.p, r.folk, ep);
        if (episode.kin && r.folk) NpcMemory._tellKin(r.folk, r.p, ep);
        return out;
    },

    _put(p, folk, ep) {
        if (!Array.isArray(p.nm)) p.nm = [];
        const out = NpcMemory._store(p.nm, ep, NpcMemory.config().perPerson, ep.d);
        if (!p.nm.length) delete p.nm;
        else if (folk) folk.nmv = 1;
        return out;
    },

    /** The family of `victim` learn of something done to them (their own copy, the victim named). */
    _tellKin(folk, victim, ep) {
        const told = [];
        const add = (p, word) => {
            if (!_alive(p) || p === victim) return;
            const e = { ...ep, vn: _pname(victim), vr: word };
            NpcMemory._put(p, folk, e);
            told.push(p);
        };
        add(_get(folk, victim.spouse), _kinWord(victim, 'spouse'));
        for (const id of victim.parents || []) add(_get(folk, id), _kinWord(victim, 'child'));
        for (const id of victim.kids || []) add(_get(folk, id), _kinWord(victim, 'parent'));
        for (const s of _siblings(folk, victim)) add(s, _kinWord(victim, 'sibling'));
        return told;
    },

    /**
     * The family of a person (living or dead) remember a deed done to them — a burial, a
     * killing. Like remember(..., { kin: true }) but the person themself is not told.
     * → the kin told.
     */
    rememberKin(world, personRef, episode = {}) {
        if (!NpcMemory.enabled()) return [];
        const r = NpcMemory.resolve(world, personRef);
        if (!r || r.type !== 'folk' || !r.folk) return [];
        const ep = NpcMemory._episode(world, episode);
        return ep ? NpcMemory._tellKin(r.folk, r.p, ep) : [];
    },

    /** The town remembers (a raid, a hanging, a famine dole). settlement: a settlement with folk, or { q, r }. */
    rememberTown(world, settlement, episode = {}) {
        if (!NpcMemory.enabled() || !episode || !episode.kind) return null;
        const folk = NpcMemory._townFolk(world, settlement);
        if (!folk) return null;
        const ep = NpcMemory._episode(world, episode);
        if (!ep) return null;
        if (!Array.isArray(folk.nm)) folk.nm = [];
        return NpcMemory._store(folk.nm, ep, NpcMemory.config().perTown, ep.d);
    },

    _townFolk(world, s) {
        if (!s) return null;
        if (Array.isArray(s.people)) return s;
        if (s.folk && Array.isArray(s.folk.people)) return s.folk;
        if (s.q != null && world && typeof world.getTile === 'function') {
            const t = world.getTile(s.q, s.r);
            const f = t && t.settlement && t.settlement.folk;
            return f && Array.isArray(f.people) ? f : null;
        }
        return null;
    },

    // ── Reading ──────────────────────────────────────

    /**
     * Who the actor of an episode is to the player now: { word (speech: 'you', 'your
     * grandfather', 'Aldric of House Voss'), llm ('the player', "the player's grandfather"),
     * gen (0 = the player; 1+ forebears; null = not of the player's House) }.
     */
    actorOf(ep, player) {
        const A = NpcMemory.data().actors || {};
        const house = player && player.house;
        const sameHouse = player && (ep.bh ? !!house && house.name === ep.bh : !house || !house.name);
        if (!sameHouse) {
            const word = _fill(A.stranger || '{name} of {house}', { name: ep.by, house: ep.bh || 'another House' });
            return { word, llm: word, gen: null };
        }
        const diff = (house ? _num(house.generation, 1) : 1) - _num(ep.bg, 1);
        if (diff === 0 && ep.by === (player.name || player.firstName)) return { word: A.self || 'you', llm: 'the player', gen: 0 };
        if (diff <= 0) return { word: A.house || 'one of your House', llm: "one of the player's House", gen: 0 };
        const t = A[String(diff)];
        const word = t ? (typeof t === 'string' ? t : _sexWord(ep.bs, t.m, t.f)) : (A.older || 'one of your forebears');
        return { word, llm: word.replace(/^your /, "the player's ").replace(/^one of your /, "one of the player's "), gen: diff };
    },

    /** Episodes a person holds, plus what their living parents tell, plus the town's. */
    _gather(r, C, opts) {
        const out = [];
        const seen = new Set();
        const key = (e) => `${e.k}|${e.d}|${e.vn || ''}|${e.by}`;
        for (const e of r.p.nm || []) { seen.add(key(e)); out.push({ e, share: 1, src: 'own' }); }
        if (opts.includeKin !== false && r.folk) {
            for (const id of r.p.parents || []) {
                const par = _get(r.folk, id);
                if (!_alive(par) || !Array.isArray(par.nm)) continue;
                for (const e of par.nm) {
                    if ((e.g || 0) + 1 > C.maxGenerations) continue;
                    const moved = NpcMemory._handDown(e, par, 'child');
                    if (!moved || seen.has(key(moved))) continue;
                    // (told by a living parent: weakened by parentShare, not as a handed-down story)
                    moved.w = e.w;
                    seen.add(key(moved));
                    out.push({ e: moved, share: C.parentShare, src: 'parent' });
                }
            }
        }
        if (opts.includeTown !== false && r.folk && Array.isArray(r.folk.nm)) {
            for (const e of r.folk.nm) out.push({ e, share: C.townShare, src: 'town' });
        }
        return out;
    },

    /**
     * What a person remembers, strongest first. opts { about: the player (actor words relative
     * to them; default scope 'house'), scope: 'house' (deeds of the player's House — the player
     * and forebears) | 'self' (the player's own) | 'all', limit, includeKin (living parents'
     * stories, default true), includeTown (the town's memory, default true), day }.
     * → [{ kind, label, text, weight (as it stands, shared), raw, day, actor, actorName, actorGen,
     *      house, victimName, victimRel ('self' or a kin word), generations, from, source
     *      ('own'|'parent'|'town'|'lord'), inherited }]
     */
    recall(world, personRef, opts = {}) {
        const r = NpcMemory.resolve(world, personRef);
        if (!r) return [];
        const day = _day(world, opts.day);
        const player = opts.about || null;
        const scope = opts.scope || (player ? 'house' : 'all');
        if (r.type === 'lord') {
            return NPCLords.memoryOf(r.lord, day).map(m => ({
                kind: m.key, label: m.label, text: m.recall, weight: m.weight, raw: m.weight, day: m.day,
                actor: 'you', actorName: null, actorGen: m.inherited ? 1 : 0, house: null, victimName: m.note, victimRel: null,
                generations: m.inherited ? 1 : 0, from: m.from, source: 'lord', inherited: m.inherited,
            })).slice(0, opts.limit || 99);
        }
        const C = NpcMemory.config();
        const out = [];
        for (const { e, share, src } of NpcMemory._gather(r, C, opts)) {
            const raw = NpcMemory.weightAt(e, day);
            if (Math.abs(raw * share) < C.forgetBelow) continue;
            const a = player ? NpcMemory.actorOf(e, player) : { word: e.by, llm: e.by, gen: null };
            if (scope === 'house' && player && a.gen == null) continue;
            if (scope === 'self' && player && a.gen !== 0) continue;
            const actorShare = a.gen == null ? 1 : _num(C.actorShare[Math.min(a.gen, C.actorShare.length - 1)], 1);
            out.push({
                kind: e.k, label: NpcMemory._label(e, a.word, 'speech'), text: NpcMemory._say(e, a.word, src),
                weight: _r1(raw * share * actorShare), raw: _r1(raw), day: _num(e.d), actor: a.word, llmActor: a.llm,
                actorName: e.by, actorGen: a.gen, house: e.bh || null, victimName: e.vn || null, victimRel: e.vr || 'self',
                generations: _num(e.g), from: e.fr || null, source: src, inherited: _num(e.g) > 0 || src === 'parent', _e: e,
            });
        }
        out.sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight));
        return out.slice(0, opts.limit || 99);
    },

    /** The stories handed down in a person's family (and a lord's from his fathers): recall's inherited ones. */
    familyStories(world, personRef, opts = {}) {
        const list = NpcMemory.recall(world, personRef, { ...opts, includeTown: false, limit: 99 })
            .filter(m => m.inherited).slice(0, opts.limit || 99);
        // A story told for generations gets its durable telling from the prose writer, when one is set
        const P = NpcMemory._prose;
        if (P && list.length) {
            const ref = NpcMemory.refOf(world, personRef) || 'p';
            for (const m of list) {
                const key = `npcMemory:${ref}:${m.kind}:${m.day}:${m.victimName || ''}`;
                try {
                    const told = typeof P.text === 'function' ? P.text(world, key, null) : null;
                    if (told) { m.text = told; continue; }
                    if (typeof P.write === 'function') {
                        const facts = { kind: m.kind, deed: NpcMemory._label(m._e, m.llmActor || m.actor, 'llm'), actor: m.actorName, house: m.house, victim: m.victimName, victimRel: m.victimRel, generations: m.generations, toldBy: m.from, feeling: m.weight >= 0 ? 'gratitude' : 'bitterness' };
                        const p = P.write(world, { kind: 'familyStory', key, facts, fallback: m.text });
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                    }
                } catch (e) { /* the written line stands */ }
            }
        }
        return list;
    },

    /**
     * The durable prose writer (systems/llmProse.js: { write(world, {kind, key, facts, fallback}),
     * text(world, key, fallback) }), set by the composition root when it exists; null = templates only.
     */
    _prose: null,
    setProse(p) { NpcMemory._prose = p && typeof p === 'object' ? p : null; },

    /** What the person's memories of the player's House come to: a number in ±cap (0 with no player). */
    opinion(world, personRef, player, opts = {}) {
        if (!player || !NpcMemory.enabled()) return 0;
        const r = NpcMemory.resolve(world, personRef);
        if (!r) return 0;
        const C = NpcMemory.config();
        if (r.type === 'lord') return NPCLords.memoryOpinion(r.lord, _day(world, opts.day));
        if (!r.p.nm && !(r.folk && r.folk.nm) && !NpcMemory._parentsHold(r)) return 0;
        const sum = NpcMemory.recall(world, r.folk ? { folk: r.folk, person: r.p } : r.p, { about: player, day: opts.day, includeTown: opts.includeTown })
            .reduce((s, m) => s + m.weight, 0);
        return Math.round(Math.max(-C.cap, Math.min(C.cap, sum)));
    },

    _parentsHold(r) {
        if (!r.folk) return false;
        for (const id of r.p.parents || []) { const par = _get(r.folk, id); if (par && par.nm) return true; }
        return false;
    },

    /** The town's own memory of the player's House: ±cap. */
    townOpinion(world, settlement, player, day) {
        const folk = NpcMemory._townFolk(world, settlement);
        if (!player || !folk || !Array.isArray(folk.nm) || !folk.nm.length) return 0;
        const C = NpcMemory.config();
        const d = _day(world, day);
        let sum = 0;
        for (const e of folk.nm) {
            const a = NpcMemory.actorOf(e, player);
            if (a.gen == null) continue;
            sum += NpcMemory.weightAt(e, d) * _num(C.actorShare[Math.min(a.gen, C.actorShare.length - 1)], 1);
        }
        return Math.round(Math.max(-C.cap, Math.min(C.cap, sum)));
    },

    // ── Words ────────────────────────────────────────

    _whom(e, persp) {
        if (!e.vr || e.vr === 'self') return persp === 'llm' ? 'you' : 'me';
        const own = persp === 'llm' ? 'your' : 'my';
        return `${own} ${e.vr}${e.vn ? ` ${e.vn}` : ''}`;
    },

    _label(e, actorWord, persp = 'speech') {
        const def = NpcMemory.kind(e.k) || {};
        const whom = e.vr ? NpcMemory._whom(e, persp) : (e.vn && !e.vr && def.sayTown ? e.vn : NpcMemory._whom(e, persp));
        return _fill(def.label || e.k, { actor: actorWord, whom });
    },

    _say(e, actorWord, src) {
        const def = NpcMemory.kind(e.k) || {};
        const vars = { Actor: _cap(actorWord), actor: actorWord, vr: e.vr || '', vn: e.vn || '' };
        const t = src === 'town' || (!e.vr && def.sayTown && !def.say) ? def.sayTown : e.vr ? (def.sayKin || def.say) : (def.say || def.sayTown);
        let line = _fill(t || '', vars);
        if (_num(e.g) > 0 || src === 'parent') {
            const L = NpcMemory.data().storyLeads || {};
            const g = Math.max(1, _num(e.g));
            const lead = _fill(L[String(g)] || L.older || '', { from: e.fr || 'family' });
            if (lead) line = `${line} ${lead}`;
        }
        return line;
    },

    /**
     * What a townsperson says on meeting the player, from the strongest memory of their House —
     * once in greetEveryDays — or null. Marks it said.
     */
    greetLine(world, personRef, player) {
        if (!player || !NpcMemory.enabled()) return null;
        const r = NpcMemory.resolve(world, personRef);
        if (!r || r.type !== 'folk') return null;
        const C = NpcMemory.config();
        const day = _day(world);
        if (Number.isFinite(r.p.nmSaid) && day - r.p.nmSaid < C.greetEveryDays) return null;
        const top = NpcMemory.recall(world, r.folk ? { folk: r.folk, person: r.p } : r.p, { about: player, limit: 1 })[0];
        if (!top || Math.abs(top.weight) < C.greetMin || !top.text) return null;
        r.p.nmSaid = day;
        const M = NpcMemory.data().moods || {};
        const mood = top.weight > 0 ? M.warm : M.cold;
        return `${mood ? `${mood} ` : ''}${top.text}`;
    },

    /** The top memories, written for the language model's prompt (systems/npcBrain.js memories). */
    llmLines(world, personRef, player, n = 3) {
        if (!player) return [];
        const L = NpcMemory.data().llm || {};
        return NpcMemory.recall(world, personRef, { about: player, limit: n }).map((m) => {
            const text = NpcMemory._label(m._e, m.llmActor, 'llm');
            const line = _fill(m.weight >= 0 ? (L.positive || 'you remember with gratitude: {text}') : (L.negative || 'you remember with bitterness: {text}'), { text });
            return m.inherited ? line + (L.story || ' (a story told in your family)') : line;
        });
    },

    // ── What it does ─────────────────────────────────

    /** The shift on a trader's prices (positive = dearer) and a refusal, from memory. → { shift, label, refuses, reason } */
    priceShift(world, personRef, player) {
        const C = NpcMemory.config();
        const o = NpcMemory.opinion(world, personRef, player);
        if (!o) return { shift: 0, label: null, refuses: false, opinion: 0 };
        const shift = Math.max(C.priceMin, Math.min(C.priceMax, Math.round((-o / C.priceDivisor) * 100) / 100));
        let reason = null;
        const refuses = o <= C.refuseTradeBelow;
        if (refuses) {
            const top = NpcMemory.recall(world, personRef, { about: player, limit: 1 })[0];
            reason = _fill(NpcMemory.data().refuseTrade || "I'll not trade with your House. Not after {label}.", { label: top ? top.label : 'what was done' });
        }
        return { shift, label: o > 0 ? 'Remembers your House kindly' : 'Remembers your House', refuses, reason, opinion: o };
    },

    /** Willingness to take the player's work: { chanceShift, refuse (text) | null }. */
    workTerms(world, personRef, player) {
        const C = NpcMemory.config();
        const o = NpcMemory.opinion(world, personRef, player);
        if (!o) return { chanceShift: 0, refuse: null, opinion: 0 };
        let refuse = null;
        if (o <= C.refuseWorkBelow) {
            const top = NpcMemory.recall(world, personRef, { about: player, limit: 1 })[0];
            refuse = _fill(NpcMemory.data().refuseWork || 'Work for you? After {label}? Never.', { label: top ? top.label : 'what was done' });
        }
        return { chanceShift: o * C.workPer, refuse, opinion: o };
    },

    /** A witness who holds the player's House dear enough keeps quiet (testimony). */
    shields(world, personRef, player) {
        return NpcMemory.opinion(world, personRef, player) >= NpcMemory.config().shieldAt;
    },

    /**
     * The daily unrest a town's memory of the player's House adds to a holding (positive =
     * restless): the town's own memory and its residents', averaged.
     */
    unrestPressure(world, settlement, player) {
        if (!player || !NpcMemory.enabled()) return 0;
        const folk = NpcMemory._townFolk(world, settlement);
        if (!folk) return 0;
        const C = NpcMemory.config();
        const day = _day(world);
        const hit = folk._nmUnrest;
        if (hit && hit.d === day && hit.who === player) return hit.v;
        let o = NpcMemory.townOpinion(world, folk, player);
        if (folk.nmv) {
            let sum = 0;
            let n = 0;
            for (const p of folk.people) {
                if (!_alive(p) || p.away) continue;
                n++;
                if (p.nm) sum += NpcMemory.opinion(world, { folk, person: p }, player, { includeTown: false });
            }
            if (n) o += sum / n;
        }
        const v = Math.round(-o * C.unrestPer * 1000) / 1000;
        // (once a day per town: kept off the save)
        Object.defineProperty(folk, '_nmUnrest', { value: { d: day, who: player, v }, writable: true, configurable: true, enumerable: false });
        return v;
    },

    // ── Handing down ─────────────────────────────────

    /** The episode as `holder`'s `toRel` ('child'|'sibling'|'spouse') would tell it. */
    _handDown(e, holder, toRel) {
        const C = NpcMemory.config();
        const g = _num(e.g) + 1;
        if (g > C.maxGenerations) return null;
        const def = NpcMemory.kind(e.k) || {};
        const blood = !!def.blood && e.w < 0;
        const self = !e.vr;
        const holderWord = toRel === 'child' ? _kinWord(holder, 'parent') : toRel === 'sibling' ? _kinWord(holder, 'sibling') : _kinWord(holder, 'spouse');
        const table = toRel === 'child' ? TO_CHILD : toRel === 'sibling' ? TO_SIBLING : TO_SPOUSE;
        const out = { ...e, w: _r1(e.w * (blood ? C.bloodPassShare : C.passShare)), g };
        if (self) { out.vr = holderWord; out.vn = _pname(holder); } else out.vr = table[e.vr] || (toRel === 'child' ? 'forebear' : 'kin');
        out.fr = e.fr ? (table[e.fr] || e.fr) : holderWord;
        return out;
    },

    /** A dead holder's memories pass to their family; the dead keep none. → number passed. */
    _passOn(folk, p, day) {
        const C = NpcMemory.config();
        const list = (p.nm || []).filter(e => Math.abs(NpcMemory.weightAt(e, day)) >= C.passMin);
        delete p.nm;
        delete p.nmSaid;
        if (!list.length) return 0;
        let to = (p.kids || []).map(id => _get(folk, id)).filter(_alive);
        let rel = 'child';
        if (!to.length) { to = _siblings(folk, p).filter(_alive); rel = 'sibling'; }
        if (!to.length) { const sp = _get(folk, p.spouse); to = _alive(sp) ? [sp] : []; rel = 'spouse'; }
        let n = 0;
        for (const kid of to) {
            for (const e of list) {
                const moved = NpcMemory._handDown(e, p, rel);
                if (!moved) continue;
                if ((kid.nm || []).some(o => o.k === moved.k && o.d === moved.d && (o.vn || null) === (moved.vn || null))) continue;
                if (NpcMemory._put(kid, folk, moved)) n++;
            }
        }
        return n;
    },

    /**
     * The daily hook (every sweepDays): in each town whose people hold memories, the dead hand
     * theirs down and the faded are forgotten. Cheap: towns no one remembers anything in are skipped.
     * → { towns, holders, passed }
     */
    processDay(world, player = null) { // (player: unused — the dead hand down with or without one)
        const out = { towns: 0, holders: 0, passed: 0 };
        if (!world || !NpcMemory.enabled()) return out;
        const C = NpcMemory.config();
        const day = _num(world.day, 1);
        if (day % Math.max(1, C.sweepDays) !== 0) return out;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            const folk = s && s.folk;
            if (folk && Array.isArray(folk.nm)) {
                folk.nm = folk.nm.filter(e => Math.abs(NpcMemory.weightAt(e, day)) >= C.forgetBelow);
                if (!folk.nm.length) delete folk.nm;
            }
            if (!folk || !folk.nmv || !Array.isArray(folk.people)) continue;
            out.towns++;
            let holders = 0;
            // (the dead first, so a child dead the same season still hands on what they were told)
            for (const p of folk.people) if (p.nm && p.died != null) out.passed += NpcMemory._passOn(folk, p, day);
            for (const p of folk.people) {
                if (!p.nm) continue;
                p.nm = p.nm.filter(e => Math.abs(NpcMemory.weightAt(e, day)) >= C.forgetBelow);
                if (!p.nm.length) delete p.nm;
                else holders++;
            }
            out.holders += holders;
            if (!holders) delete folk.nmv;
        }
        return out;
    },

    /** How much is remembered across the world: { towns, holders, episodes, townEpisodes, bytes }. */
    stats(world) {
        const out = { towns: 0, holders: 0, episodes: 0, townEpisodes: 0, bytes: 0 };
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            let any = false;
            if (Array.isArray(folk.nm)) { any = true; out.townEpisodes += folk.nm.length; out.bytes += JSON.stringify(folk.nm).length; }
            for (const p of folk.people) {
                if (!p.nm) continue;
                any = true;
                out.holders++;
                out.episodes += p.nm.length;
                out.bytes += JSON.stringify(p.nm).length + 6;
            }
            if (any) out.towns++;
        }
        return out;
    },

    // ── Deed hooks (called from the systems where the deeds are done) ──

    /** The player beat or killed a townsperson (systems/streetCrime.js record). */
    onHarm(world, player, victim, crime, witnessed = true) {
        if (!player || !victim || !victim._person) return 0;
        const r = NpcMemory.resolve(world, victim);
        if (!r) return 0;
        if (crime === 'murder') {
            return witnessed ? NpcMemory.rememberKin(world, r.folk ? { folk: r.folk, person: r.p } : r.p, { kind: 'murdered', player }).length : 0;
        }
        // The beaten know who beat them; their family hear it from them
        NpcMemory.remember(world, r.folk ? { folk: r.folk, person: r.p } : r.p, { kind: 'assaulted', player, kin: true });
        return 1;
    },

    /** A gift or alms given to a townsperson (ui/npcDialog gifts, devotion alms). */
    onGift(world, player, npc, opts = {}) {
        if (!player || !npc || !npc._person) return null;
        if (opts.healed) return NpcMemory.remember(world, npc, { kind: 'healed', player });
        const poor = opts.alms || npc.type === 'beggar' || (npc._person.job && ['beggar', 'unemployed'].includes(npc._person.job.id));
        const def = NpcMemory.kind(poor ? 'alms' : 'gift');
        const big = _num(opts.gold) >= 50 ? 1.5 : 1;
        return NpcMemory.remember(world, npc, { kind: poor ? 'alms' : 'gift', player, weight: def ? _num(def.weight) * big : undefined });
    },

    /** The player laid a townsperson in the ground: their family remember it. */
    onBurial(world, player, npc) {
        if (!player || !npc || !npc._person) return [];
        // (no thanks are owed the hand that put them there: kin who hold the killing against the player)
        const folk = npc._folk;
        const vn = _pname(npc._person);
        if (folk && folk.people.some(p => Array.isArray(p.nm) && p.nm.some(e => e.k === 'murdered' && e.vn === vn))) return [];
        return NpcMemory.rememberKin(world, npc, { kind: 'burial', player });
    },

    /** The player's ruling at court on a petition (systems/petitions.js rule) → the town's memory. */
    onRuling(world, player, ctx, choice) {
        if (!player || !ctx || ctx.q == null || !choice) return null;
        const court = (choice.effects && choice.effects.court) || {};
        const label = String(choice.label || '');
        let kind = null;
        if (/\b(hang|hanged|behead|execute|gallows|burn him|burn her)\b/i.test(label)) kind = 'hanged';
        else if (_num(court.mercy) >= 2) kind = 'ruled_merciful';
        else if (_num(court.severity) >= 2) kind = 'ruled_harsh';
        else if (_num(court.generosity) >= 2) kind = 'ruled_generous';
        else if (_num(court.justice) <= -2) kind = 'ruled_unjust';
        if (!kind) return null;
        return NpcMemory.rememberTown(world, { q: ctx.q, r: ctx.r }, { kind, player, victim: ctx.name || null });
    },

    /** Caught stealing from a townsperson's house (systems/containers.js): the owner remembers. */
    onTheftCaught(world, player, ctx) {
        if (!player || !ctx || ctx.worldQ == null || !ctx.ownerName) return null;
        const folk = NpcMemory._townFolk(world, { q: ctx.worldQ, r: ctx.worldR });
        if (!folk) return null;
        const name = String(ctx.ownerName);
        const living = folk.people.filter(p => _alive(p) && !p.away);
        let p = living.find(o => _pname(o) === name);
        if (!p) { const same = living.filter(o => o.first === name); if (same.length === 1) p = same[0]; }
        return p ? NpcMemory.remember(world, { folk, person: p }, { kind: 'robbed', player }) : null;
    },

    /** A grave of a townsperson robbed by the player, and the player caught (systems/graveyards.js). */
    onGraveRobbed(world, player, settlement, grave) {
        if (!player || !grave || grave.pid == null) return [];
        const folk = NpcMemory._townFolk(world, settlement);
        const dead = folk && _get(folk, grave.pid);
        return dead ? NpcMemory.rememberKin(world, { folk, person: dead }, { kind: 'grave_robbed', player }) : [];
    },
};
