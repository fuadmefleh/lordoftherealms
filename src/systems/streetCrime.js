// ============================================
// STREET CRIME — violence on a town's street map has witnesses, and they remember
// ============================================
// When the player beats (assault) or kills (murder) someone on the inner map:
//
//   1. WHO SAW IT — selectWitnesses: everyone within sight.radius of the
//      victim who is out on the street (or everyone in the same building
//      when it happens indoors), each with a role: kin (family of the
//      victim), friend (an NPC-NPC bond), guard, bystander. Guards out of
//      sight but within earshot come running (seen: false).
//   2. HOW THEY REACT — reactionFor: flee, cower, stand and shout, fight
//      (kin), or arrest (guards), and a bark over their head. Deterministic
//      (a hash of the scene), so it never draws on the shared RNG.
//   3. THE RECORD — record: one incident per deed on player.streetCrime,
//      Gossip.reportCrime with the real witnesses (karma, reputation with
//      the realm, a rumour that spreads), Underworld.recordCrime ('assault'
//      or 'murder': heat and Traits deeds), the town's annals, and each
//      witness's memory (mem.saw on the dialog memory, which for townsfolk
//      lives on the roster and outlasts the visit). Kin of a townsperson
//      who are not on the street that day still learn of it (the roster).
//   4. WHAT THEY SAY — dialogFor: the greeting of a witness (fear or anger,
//      naming the deed and the victim), whether they refuse to talk or
//      trade, and whether a guard moves to arrest. Townsfolk who did not see
//      it hear of it as the rumour spreads (hearsay), more vaguely.
//   5. THE WATCH — watchView / answerWatch: give yourself up, pay a fine (a
//      beating only), run for it, or resist.
//
// Tuned and worded in data/streetCrime.json. Explicit params; no globals;
// the one roll (running from the watch) uses Utils.random.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gossip } from './gossip.js';
import { Underworld } from './underworld.js';
import { NpcDisposition } from './npcDisposition.js';
import { NpcFamily } from './npcFamily.js';
import { Townsfolk } from './townsfolk.js';
import { Duels } from './duels.js';
import { Ledger } from './ledger.js';
import { Laws } from './laws.js';

const DEFAULTS = {
    sight: { radius: 7, guardHearRadius: 16, hiddenStates: ['inside_building', 'leaving_building', 'gone'] },
    disposition: {
        bystander: { assault: -15, murder: -35 },
        guard: { assault: -20, murder: -40 },
        kin: { assault: -10, murder: -15 },
        friend: { assault: -8, murder: -12 },
        victim: { assault: -10 },
        rosterKin: { assault: -20, murder: -55 },
        hearsay: { assault: -4, murder: -10 },
    },
    refuse: { talkBelow: 20, tradeBelow: { assault: 25, murder: 45 } },
    memory: { max: 6, freshDays: 12 },
    hearsay: { base: 0.3, perDay: 0.2, elsewhereShare: 0.45, mentionAgain: 0.3, maxAgeDays: 120 },
    reactions: {
        angerTraits: ['bold', 'stern', 'stubborn'],
        fearTraits: ['cautious', 'quiet', 'kind', 'curious'],
        kinFightTraits: ['bold', 'stern', 'stubborn'],
        cowerShare: 0.35, chaseSeconds: 30, runSpeed: 2.4, barkSeconds: 3.6,
    },
    heat: { unseenShare: { assault: 0, murder: 0.3 } },
    karmaUnseen: { assault: -3, murder: -10 },
    arrest: {
        windowDays: 30, days: { assault: 2, murder: 10 }, fine: { assault: 40 },
        fineTown: { village: 0.75, town: 1, city: 1.4, capital: 1.8 },
        escape: { base: 0.25, stealth: 0.04, agility: 0.02, max: 0.75 },
        escapeFailDays: 3, fleeHeat: 6, resistHeat: 12,
    },
    barks: {},
    lines: {},
    watch: { title: 'The Watch', text: {}, outcomes: {} },
    // Coming upon a body (InnerMapReactions._scanBodies): who sees it within radius,
    // how many of the bystanders go to look, and how close counts as standing over it
    found: { radius: 6, gatherShare: 0.5, overRadius: 1, holdSeconds: 12, mournSeconds: 30, barks: {} },
};

const CRIMES = ['assault', 'murder'];
const MAX_INCIDENTS = 40;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (_obj(v) && _obj(base[k])) ? _merge(base[k], v) : v;
    }
    return out;
}

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _pick(arr, seed) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[Math.floor(_frac(seed) * arr.length) % arr.length];
}

function _fill(text, vars) {
    if (!text) return text;
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

let _cfg = null;
let _cfgSrc;

export const StreetCrime = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.streetCrime : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    /** The player's record of street incidents. */
    ensure(player) {
        if (!player.streetCrime || !Array.isArray(player.streetCrime.incidents)) {
            player.streetCrime = { incidents: [], nextId: 1 };
        }
        return player.streetCrime;
    },

    /** A stable key for an NPC: a townsperson's roster uid, else its id. */
    npcKey(npc) {
        if (!npc) return 'npc';
        return npc.uid != null ? String(npc.uid) : `npc${npc.id != null ? npc.id : npc.name}`;
    },

    // ──────────── WHO SAW IT ────────────

    /**
     * How a bystander is related to the victim, from the bystander's side:
     * { rel: 'kin', word: 'wife' } | { rel: 'friend' } | null.
     */
    relationTo(npc, victim) {
        if (!npc || !victim || npc === victim) return null;
        const g = victim.gender;
        const w = (f, m, n) => (g === 'female' ? f : g === 'male' ? m : n);
        if (npc.spouseId != null && npc.spouseId === victim.id) return { rel: 'kin', word: w('wife', 'husband', 'spouse') };
        if ((npc.parentIds || []).includes(victim.id)) return { rel: 'kin', word: w('mother', 'father', 'parent') };
        if ((npc.childIds || []).includes(victim.id)) return { rel: 'kin', word: w('daughter', 'son', 'child') };
        if ((npc.siblingIds || []).includes(victim.id)) return { rel: 'kin', word: w('sister', 'brother', 'sibling') };
        // The victim's side of the family links (one side may be missing)
        if (victim.spouseId != null && victim.spouseId === npc.id) return { rel: 'kin', word: w('wife', 'husband', 'spouse') };
        if ((victim.childIds || []).includes(npc.id)) return { rel: 'kin', word: w('mother', 'father', 'parent') };
        if ((victim.parentIds || []).includes(npc.id)) return { rel: 'kin', word: w('daughter', 'son', 'child') };
        if ((victim.siblingIds || []).includes(npc.id)) return { rel: 'kin', word: w('sister', 'brother', 'sibling') };
        let bond = null;
        try { bond = NpcFamily.getNpcRelationship(victim.id, npc.id); } catch (e) { bond = null; }
        if (bond && _num(bond.score) >= 30) return { rel: 'friend' };
        return null;
    },

    /**
     * Everyone who saw the deed, and the guards who heard it.
     * @param {Array} npcs the inner map's NPCs (the victim may be among them)
     * @param {object} scene { q, r, indoors } — the victim's inner-map tile
     * @param {object} victim the NPC harmed
     * @returns {Array<{ npc, distance, role, kinWord, seen }>}
     */
    selectWitnesses(npcs, scene, victim) {
        const C = StreetCrime.config();
        const out = [];
        if (!Array.isArray(npcs) || !scene) return out;
        const hidden = new Set(C.sight.hiddenStates || []);
        const radius = _num(C.sight.radius, 7);
        const hear = Math.max(radius, _num(C.sight.guardHearRadius, radius));
        for (const npc of npcs) {
            if (!npc || npc === victim || (victim && npc.id === victim.id)) continue;
            if (npc.state === 'gone' || npc.state === 'unconscious') continue;
            // Out on the street, someone indoors sees nothing; indoors, the whole room sees
            if (!scene.indoors && hidden.has(npc.state)) continue;
            const distance = Math.max(Math.abs(_num(npc.q) - _num(scene.q)), Math.abs(_num(npc.r) - _num(scene.r)));
            const seen = scene.indoors ? true : distance <= radius;
            const isGuard = npc.type === 'guard';
            if (!seen && !(isGuard && distance <= hear)) continue;
            const relation = StreetCrime.relationTo(npc, victim);
            const role = relation ? relation.rel : isGuard ? 'guard' : 'bystander';
            out.push({ npc, distance, role, kinWord: relation && relation.word ? relation.word : null, seen });
        }
        out.sort((a, b) => a.distance - b.distance);
        return out;
    },

    // ──────────── HOW THEY REACT ────────────

    /**
     * What a witness does on the spot.
     * @param {object} w a witness from selectWitnesses
     * @param {'assault'|'murder'} crime
     * @param {object} [ctx] { playerAttack, seed, victimName }
     * @returns {{ act:'flee'|'cower'|'stand'|'fight'|'arrest', mood:'fear'|'anger', bark:string|null }}
     */
    reactionFor(w, crime, ctx = {}) {
        const C = StreetCrime.config();
        const R = C.reactions;
        const npc = w.npc;
        const traits = npc.personalityTraits || [];
        const seed = `${ctx.seed || ''}|${StreetCrime.npcKey(npc)}|${crime}`;
        const angry = traits.some(t => (R.angerTraits || []).includes(t));
        const fearful = traits.some(t => (R.fearTraits || []).includes(t));
        let act;
        let mood;
        if (w.role === 'guard') {
            act = 'arrest';
            mood = 'anger';
        } else if (npc.type === 'child') {
            act = 'flee';
            mood = 'fear';
        } else if (w.role === 'kin') {
            let fights = traits.some(t => (R.kinFightTraits || []).includes(t));
            if (!fights) {
                try { fights = Duels.brawlStance(npc, { playerAttack: _num(ctx.playerAttack) }).stance === 'fight'; } catch (e) { fights = false; }
            }
            act = fights ? 'fight' : 'stand';
            mood = fights || !fearful ? 'anger' : 'fear';
        } else if (w.role === 'friend') {
            act = angry ? 'stand' : 'flee';
            mood = angry ? 'anger' : 'fear';
        } else {
            // A bystander: the bold shout, the rest run (or freeze where they stand)
            const anger = angry && !(crime === 'murder' && fearful);
            mood = anger ? 'anger' : 'fear';
            act = anger ? 'stand' : (_frac(`${seed}|cower`) < _num(R.cowerShare, 0.35) ? 'cower' : 'flee');
        }
        if (!w.seen && w.role === 'guard') return { act, mood, bark: StreetCrime.watchBark(seed) };
        return { act, mood, bark: StreetCrime.bark(w.role, crime, mood, { victim: ctx.victimName, kin: ctx.victimName }, seed) };
    },

    /** A line shouted over a witness's head (data: barks[role][crime][mood]). */
    bark(role, crime, mood, vars = {}, seed = '') {
        const B = StreetCrime.config().barks || {};
        const byRole = _obj(B[role]) || _obj(B.bystander) || {};
        const byCrime = _obj(byRole[crime]) || _obj(byRole.assault) || {};
        const pool = byCrime[mood] || byCrime.anger || byCrime.fear || [];
        const line = _pick(pool, `${seed}|bark`);
        return line ? _fill(line, vars) : null;
    },

    /**
     * Someone comes upon a dead body (or sees the player carrying one).
     * @param {object} npc who sees it
     * @param {object} body { name, _npc } (a corpse from InnerMapCombat)
     * @param {object} [ctx] { carried, playerOver (the player stands over it), seed }
     * @returns {{ act:'flee'|'cower'|'mourn'|'gather'|'stare'|'investigate'|'arrest', mood:'fear'|'anger'|'grief',
     *             role:'kin'|'friend'|'guard'|'bystander', kinWord, bark:string|null, implicates:boolean }}
     *   implicates: they saw the player with the body — they count as witnesses to the killing
     */
    foundReaction(npc, body, ctx = {}) {
        const C = StreetCrime.config();
        const F = C.found || {};
        const B = F.barks || {};
        const R = C.reactions || {};
        const traits = (npc && npc.personalityTraits) || [];
        const seed = `${ctx.seed || ''}|${StreetCrime.npcKey(npc)}|found`;
        const relation = body && body._npc ? StreetCrime.relationTo(npc, body._npc) : null;
        const isGuard = npc.type === 'guard';
        const role = relation ? relation.rel : isGuard ? 'guard' : 'bystander';
        const fearful = npc.type === 'child' || traits.some(t => (R.fearTraits || []).includes(t));
        const angry = traits.some(t => (R.angerTraits || []).includes(t));
        const implicates = !!(ctx.carried || ctx.playerOver);
        let act;
        let mood;
        let pool;
        if (implicates) {
            // Caught with the body: the watch arrests, kin rage or wail, the rest run
            mood = role === 'kin' || angry || isGuard ? 'anger' : 'fear';
            act = isGuard ? 'arrest' : role === 'kin' ? (angry ? 'stand' : 'mourn') : mood === 'anger' ? 'stand' : 'flee';
            pool = (_obj(B.caught) || {})[isGuard ? 'guard' : role === 'kin' ? 'kin' : mood];
            if (ctx.carried) pool = (_obj(B.carried) || {})[isGuard ? 'guard' : mood] || pool;
        } else if (role === 'kin' || role === 'friend') {
            act = 'mourn';
            mood = 'grief';
            pool = B[role];
        } else if (isGuard) {
            act = 'investigate';
            mood = 'anger';
            pool = B.guard;
        } else if (fearful) {
            act = _frac(`${seed}|cower`) < _num(R.cowerShare, 0.35) ? 'cower' : 'flee';
            mood = 'fear';
            pool = (_obj(B.bystander) || {}).fear;
        } else {
            act = _frac(`${seed}|gather`) < _num(F.gatherShare, 0.5) ? 'gather' : 'stare';
            mood = angry ? 'anger' : 'fear';
            pool = (_obj(B.bystander) || {})[mood];
        }
        const line = _pick(pool, `${seed}|bark`);
        const bark = line ? _fill(line, { victim: (body && body.name) || 'someone', kin: relation && relation.word ? `my ${relation.word}` : (body && body.name) || 'them' }) : null;
        return { act, mood, role, kinWord: relation && relation.word ? relation.word : null, bark, implicates };
    },

    /** A short visible reaction (a gasp, a sob) for someone who says no full line: found.emotes[mood]. */
    foundEmote(mood, seed = '') {
        const E = (StreetCrime.config().found || {}).emotes || {};
        return _pick(E[mood] || E.fear, `${seed}|emote`) || '!';
    },

    /** What a guard shouts as they come for the player. */
    watchBark(seed = '') {
        const pool = (StreetCrime.config().barks || {}).watch || [];
        return _pick(pool, `${seed}|watch`) || null;
    },

    // ──────────── THE RECORD ────────────

    /**
     * Record a deed of violence: the incident, the rumour (with its real
     * witnesses), heat, karma, the town's annals and every witness's memory.
     * @param {object} player
     * @param {object} world
     * @param {object} opts {
     *   crime: 'assault'|'murder', victim (npc), witnesses (selectWitnesses),
     *   q, r (world tile of the town), scene { q, r, indoors }, onMap (npcs) }
     * @returns {{ incident, witnessed:boolean, witnessCount:number, rumour, heat:number }}
     */
    record(player, world, opts = {}) {
        const C = StreetCrime.config();
        const crime = CRIMES.includes(opts.crime) ? opts.crime : 'assault';
        const victim = opts.victim || {};
        const witnesses = Array.isArray(opts.witnesses) ? opts.witnesses : [];
        const seenBy = witnesses.filter(w => w.seen);
        const day = _num(world && world.day, 0);
        const tile = world && typeof world.getTile === 'function' && opts.q != null ? world.getTile(opts.q, opts.r) : null;
        const settlement = tile && tile.settlement;
        const kingdom = settlement ? settlement.kingdom : null;
        const town = (settlement && settlement.name) || 'the town';
        const key = opts.q != null ? `${opts.q},${opts.r}` : null;
        const vuid = StreetCrime.npcKey(victim);

        // The rumour, told by those who saw it (a beaten victim who lived tells it too)
        let g = { witnessed: false, witnessCount: 0, rumor: null };
        if (player && world) {
            const sceneNpcs = seenBy.map(w => w.npc);
            if (crime === 'assault' && victim.name) sceneNpcs.push(victim);
            g = Gossip.reportCrime(player, world, {
                crimeType: crime,
                victim: { name: victim.name || 'someone', type: victim.type || 'villager', icon: victim.icon, uid: vuid },
                q: opts.q, r: opts.r,
                scene: { npcs: sceneNpcs, q: _num(opts.scene && opts.scene.q), r: _num(opts.scene && opts.scene.r), radius: 1e9, victimTestifies: crime === 'assault' },
            }) || g;
        }
        const witnessed = !!g.witnessed;

        // Heat with the crown (and the deed's mark on the player's character)
        const share = witnessed ? 1 : _num(C.heat.unseenShare && C.heat.unseenShare[crime], 0);
        const heat = player ? _num((Underworld.recordCrime(player, world, crime, { kingdom, scale: share }) || {}).heat) : 0;
        // Karma: the rumour takes it when seen; an unseen deed still weighs on the soul
        if (player && !witnessed) {
            const k = _num(C.karmaUnseen && C.karmaUnseen[crime], 0);
            if (k) player.karma = Math.max(-100, _num(player.karma) + k);
        }

        // The incident itself
        let incident = null;
        if (player) {
            const st = StreetCrime.ensure(player);
            incident = {
                id: st.nextId++, k: crime, victim: victim.name || 'someone', vuid, vtype: victim.type || 'villager',
                town, key, kingdom, d: day, witnessed, rumourId: g.rumor ? g.rumor.id : null,
                witnesses: seenBy.slice(0, 5).map(w => w.npc.name), answered: false,
            };
            st.incidents.push(incident);
            if (st.incidents.length > MAX_INCIDENTS) st.incidents.splice(0, st.incidents.length - MAX_INCIDENTS);
        }
        const inc = incident ? incident.id : null;

        // Every witness remembers (kin on the street remember even if they did not see it)
        const base = { k: crime, v: victim.name || 'someone', vu: vuid, d: day, inc, town };
        for (const w of witnesses) {
            if (!w.seen && w.role !== 'kin') continue;
            const react = w.mood ? { mood: w.mood } : StreetCrime.reactionFor(w, crime, { seed: `${inc}`, victimName: victim.name });
            const delta = _num((C.disposition[w.role] || {})[crime], 0);
            StreetCrime.remember(w.npc, { ...base, rel: w.role, kin: w.kinWord, mood: react.mood, seen: !!w.seen }, delta, player);
        }
        // Kin on the street who were out of sight
        for (const npc of (opts.onMap || [])) {
            if (!npc || npc === victim || witnesses.some(w => w.npc === npc)) continue;
            const rel = StreetCrime.relationTo(npc, victim);
            if (!rel || rel.rel !== 'kin') continue;
            StreetCrime.remember(npc, { ...base, rel: 'kin', kin: rel.word, mood: 'anger', seen: false }, _num(C.disposition.kin[crime]), player);
        }
        // The victim of a beating remembers it
        if (crime === 'assault' && victim && typeof victim === 'object' && victim.name) {
            StreetCrime.remember(victim, { ...base, rel: 'victim', mood: StreetCrime._moodOf(victim), seen: true }, _num(C.disposition.victim.assault), player);
        }

        // The town's roster: kin not on the street that day hear of it, and the annals keep it
        const folk = victim._folk;
        const person = victim._person;
        if (folk && person) {
            StreetCrime._rosterKin(folk, person, (opts.onMap || []).concat(witnesses.map(w => w.npc)), { ...base, seen: false }, crime, player);
            if (crime === 'assault') {
                Townsfolk.record(folk, world, day, { k: 'beaten', a: person.id, x: witnessed && player ? (player.name || 'a stranger') : '' });
            }
        }

        return { incident, witnessed, witnessCount: _num(g.witnessCount), rumour: g.rumor || null, heat };
    },

    /**
     * People who came on a fight already under way (a chase down the street):
     * they remember it as the first witnesses do, and join the incident.
     * @param {object} player
     * @param {object|null} incident from record()
     * @param {Array} witnesses from selectWitnesses (with .mood set)
     * @param {object} victim
     * @param {'assault'|'murder'} crime
     * @param {number} day
     * @returns {number} how many saw it
     */
    addWitnesses(player, incident, witnesses, victim, crime, day) {
        const C = StreetCrime.config();
        const seen = (witnesses || []).filter(w => w && w.seen);
        if (incident) {
            if (seen.length) incident.witnessed = true;
            for (const w of seen) {
                if (incident.witnesses.length >= 5) break;
                if (!incident.witnesses.includes(w.npc.name)) incident.witnesses.push(w.npc.name);
            }
        }
        const base = { k: crime, v: (victim && victim.name) || 'someone', vu: StreetCrime.npcKey(victim || {}), d: _num(day), inc: incident ? incident.id : null, town: incident ? incident.town : 'the town' };
        for (const w of seen) {
            const delta = _num((C.disposition[w.role] || {})[crime], 0);
            StreetCrime.remember(w.npc, { ...base, rel: w.role, kin: w.kinWord, mood: w.mood || 'fear', seen: true }, delta, player);
        }
        return seen.length;
    },

    /** Fear or anger, by temperament. */
    _moodOf(npc) {
        const R = StreetCrime.config().reactions;
        const traits = (npc && npc.personalityTraits) || [];
        return traits.some(t => (R.angerTraits || []).includes(t)) ? 'anger' : 'fear';
    },

    /**
     * Write one thing a person saw (or learned) into their dialog memory and
     * move their opinion of the player. Kin and friends keep a grudge.
     */
    remember(npc, entry, delta = 0, player = null) {
        if (!npc) return null;
        const C = StreetCrime.config();
        const mem = NpcDisposition.getMemory(npc);
        if (!Array.isArray(mem.saw)) mem.saw = [];
        // One entry per incident; a beating that became a killing is upgraded
        const prev = mem.saw.find(e => e.vu === entry.vu && e.d === entry.d && e.rel === entry.rel);
        if (prev && prev.k === 'murder') return prev;
        if (prev) mem.saw.splice(mem.saw.indexOf(prev), 1);
        mem.saw.push(entry);
        const max = Math.max(1, _num(C.memory.max, 6));
        if (mem.saw.length > max) mem.saw.splice(0, mem.saw.length - max);
        if (delta) NpcDisposition.adjustDisposition(npc, delta, player);
        if (entry.rel === 'kin' || entry.rel === 'friend') {
            if (!mem.grudge || entry.k === 'murder') mem.grudge = { victimName: entry.v, relation: entry.rel === 'friend' ? 'friend' : (entry.kin || 'kin'), severity: entry.k };
        }
        if (entry.mood === 'fear' && entry.k === 'murder') mem.fearful = true;
        return entry;
    },

    /** Family of a townsperson who are not on the street: they learn of it all the same. */
    _rosterKin(folk, person, onMap, base, crime, player) {
        const C = StreetCrime.config();
        const shown = new Set((onMap || []).map(n => n && n._person).filter(Boolean));
        const kin = [];
        const add = (id, rel) => {
            const p = Townsfolk.get(folk, id);
            if (p && p !== person && Townsfolk.isHere(p) && !shown.has(p)) kin.push({ p, rel });
        };
        if (person.spouse != null) add(person.spouse, 'spouse');
        for (const id of person.parents || []) add(id, 'child');   // the victim is their child
        for (const id of person.kids || []) add(id, 'parent');     // the victim is their parent
        for (const s of Townsfolk.siblings(folk, person)) add(s.id, 'sibling');
        for (const { p, rel } of kin) {
            const shim = {};
            Object.defineProperty(shim, '_dialogMemory', { get() { return p.mem; }, set(v) { p.mem = v; }, enumerable: false });
            shim.name = p.first;
            const word = Townsfolk.kinWord(person, rel);
            StreetCrime.remember(shim, { ...base, rel: 'kin', kin: word, mood: 'anger' }, _num(C.disposition.rosterKin[crime]), player);
        }
        return kin.length;
    },

    // ──────────── WHAT THEY SAY ────────────

    /** The gravest thing this person saw: murder before assault, then the latest. */
    memoryOf(npc) {
        const mem = npc && npc._dialogMemory;
        if (!mem || !Array.isArray(mem.saw) || !mem.saw.length) return null;
        return mem.saw.slice().sort((a, b) => ((b.k === 'murder') - (a.k === 'murder')) || (b.d - a.d))[0];
    },

    /**
     * A townsperson who did not see a crime may have heard of it: the gravest
     * live rumour of the player's violence told in this town, if word has
     * reached this person yet. { rumour, here } or null.
     */
    hearsay(player, world, npc, key, day) {
        if (!player || !player.gossip || !Array.isArray(player.gossip.rumors) || !npc || !key) return null;
        const H = StreetCrime.config().hearsay;
        const mem = npc._dialogMemory;
        const vu = StreetCrime.npcKey(npc);
        const own = new Set(((mem && mem.saw) || []).map(e => e.inc));
        const incidents = (player.streetCrime && player.streetCrime.incidents) || [];
        const best = [];
        for (const r of player.gossip.rumors) {
            if (!r || r.expired || Gossip.isTalk(r)) continue;
            const kind = StreetCrime.rumourKind(r);
            if (!kind) continue;
            if (!Array.isArray(r.spreadTo) || !r.spreadTo.includes(key)) continue;
            if (r.victim && r.victim.uid != null && r.victim.uid === vu) continue;
            const inc = incidents.find(i => i.rumourId === r.id);
            if (inc && own.has(inc.id)) continue;
            const age = _num(day) - _num(r.dayCreated);
            if (age < 0 || age > _num(H.maxAgeDays, 120)) continue;
            const here = key === `${r.locationQ},${r.locationR}`;
            const share = here ? Math.min(1, _num(H.base) + _num(H.perDay) * age) : _num(H.elsewhereShare);
            if (_frac(`${vu}|heard|${r.id}`) >= share) continue;
            best.push({ rumour: r, kind, here });
        }
        if (!best.length) return null;
        best.sort((a, b) => ((b.kind === 'murder') - (a.kind === 'murder')) || (b.rumour.dayCreated - a.rumour.dayCreated));
        return best[0];
    },

    /** 'murder' | 'assault' | null for a gossip rumour. */
    rumourKind(r) {
        const t = String((r && r.type) || '');
        if (t === 'assault') return 'assault';
        if (t === 'murder' || /_murder$/.test(t)) return 'murder';
        return null;
    },

    /**
     * What this person says first when the player speaks to them, given what
     * they saw or heard of the player's violence. Null when nothing.
     * Marks hearsay as told (and lets it sour them, once).
     * @param {object} ctx { key: 'q,r' of the town, day, town }
     * @returns {null|{ kind:'witness'|'hearsay', role, crime, mood, text, refuse:boolean, arrest:boolean, entry? }}
     */
    dialogFor(npc, player, world, ctx = {}) {
        if (!npc) return null;
        const C = StreetCrime.config();
        const L = C.lines || {};
        const day = _num(ctx.day, _num(world && world.day));
        const mem = NpcDisposition.getMemory(npc);
        const seed = `${StreetCrime.npcKey(npc)}|${day}|${_num(mem.timesSpoken)}`;
        let entry = StreetCrime.memoryOf(npc);
        // A guard speaks of the crime the watch still wants you for, not one already settled
        if (npc.type === 'guard') {
            const pending = StreetCrime.pendingAt(player, ctx.key, day);
            if (pending && (!entry || entry.inc !== pending.id)) {
                const mine = ((mem.saw || []).find(e => e.inc === pending.id));
                entry = mine || null;
                if (!entry) {
                    const pool = ((_obj(L.guard) || {})[pending.k] || {}).anger;
                    const text = _cap(_fill(_pick(pool, seed), { victim: pending.victim, kin: pending.victim, town: pending.town }));
                    if (text) return { kind: 'witness', role: 'guard', crime: pending.k, mood: 'anger', text, refuse: false, arrest: true };
                }
            }
        }
        if (entry) {
            const fresh = day - _num(entry.d) <= _num(C.memory.freshDays, 12);
            const group = entry.rel === 'bystander' ? 'witness' : entry.rel;
            const byGroup = _obj(L[group]) || _obj(L.witness) || {};
            const byCrime = _obj(byGroup[entry.k]) || _obj(byGroup.assault) || _obj((L.witness || {})[entry.k]) || {};
            const mood = entry.rel === 'guard' ? 'anger' : (entry.mood || 'fear');
            const arrest = entry.rel === 'guard' && StreetCrime.unansweredAt(player, ctx.key, day).length > 0;
            // A guard whose matter is settled only warns; anyone else, fresh or remembered
            const live = entry.rel === 'guard' ? arrest : fresh;
            const pool = live ? (byCrime[mood] || byCrime.anger || byCrime.fear) : (byCrime.old || byCrime[mood]);
            const kin = entry.kin ? `my ${entry.kin} ${entry.v}` : entry.v;
            const text = _cap(_fill(_pick(pool, seed), { victim: entry.v, kin, player: (player && player.name) || 'you', town: entry.town || 'town', deed: entry.k === 'murder' ? 'killed' : 'beat' }));
            const refuse = entry.rel !== 'guard' && _num(mem.disposition, 50) < _num(C.refuse.talkBelow, 20);
            return text ? { kind: 'witness', role: entry.rel, crime: entry.k, mood, text, refuse, arrest, entry } : null;
        }
        const h = StreetCrime.hearsay(player, world, npc, ctx.key, day);
        if (!h) return null;
        if (!Array.isArray(mem.heard)) mem.heard = [];
        const first = !mem.heard.includes(h.rumour.id);
        if (!first && _frac(`${seed}|again`) >= _num(C.hearsay.mentionAgain, 0.3)) return null;
        if (first) {
            mem.heard.push(h.rumour.id);
            if (mem.heard.length > 12) mem.heard.shift();
            NpcDisposition.adjustDisposition(npc, _num(C.disposition.hearsay[h.kind]), player);
        }
        const pool = (((_obj(L.hearsay) || {})[h.kind]) || {})[h.here ? 'here' : 'elsewhere'];
        const text = _cap(_fill(_pick(pool, seed), { victim: h.rumour.victim ? h.rumour.victim.name : 'someone', town: h.rumour.locationName || 'a town nearby', player: (player && player.name) || 'you' }));
        if (!text) return null;
        const arrest = npc.type === 'guard' && StreetCrime.unansweredAt(player, ctx.key, day).some(i => i.witnessed);
        return { kind: 'hearsay', role: 'stranger', crime: h.kind, mood: 'fear', text, refuse: false, arrest };
    },

    /** Will this person not talk at all (only amends or leave)? */
    refusesTalk(npc) {
        const e = StreetCrime.memoryOf(npc);
        if (!e || e.rel === 'guard') return false;
        const mem = NpcDisposition.getMemory(npc);
        return _num(mem.disposition, 50) < _num(StreetCrime.config().refuse.talkBelow, 20);
    },

    /**
     * Whether a trader who saw the player's violence refuses to deal:
     * { refuses, reason } (read by NpcDisposition.getPriceModifiers).
     */
    tradeRefusal(npc) {
        const e = StreetCrime.memoryOf(npc);
        if (!e) return { refuses: false, reason: null };
        const C = StreetCrime.config();
        const mem = NpcDisposition.getMemory(npc);
        const below = _num((C.refuse.tradeBelow || {})[e.k], 30);
        if (_num(mem.disposition, 50) >= below) return { refuses: false, reason: null };
        const t = ((C.lines || {}).refuseTrade || {})[e.k] || '{name} will not deal with you.';
        return { refuses: true, reason: _fill(t, { name: npc.name || 'They', victim: e.v }) };
    },

    // ──────────── THE WATCH ────────────

    /** Unanswered, witnessed incidents in a town within the watch's memory, oldest first. */
    unansweredAt(player, key, day) {
        if (!player || !player.streetCrime || !key) return [];
        const W = _num(StreetCrime.config().arrest.windowDays, 30);
        return player.streetCrime.incidents.filter(i => i.key === key && !i.answered && i.witnessed && _num(day) - _num(i.d) <= W);
    },

    /** The gravest unanswered incident here (murder first), or null. */
    pendingAt(player, key, day) {
        const open = StreetCrime.unansweredAt(player, key, day);
        if (!open.length) return null;
        return open.slice().sort((a, b) => ((b.k === 'murder') - (a.k === 'murder')) || (b.d - a.d))[0];
    },

    /** The fine for a beating in this town (never less than the bounty owed in the realm). */
    fineFor(player, world, incident) {
        const A = StreetCrime.config().arrest;
        if (!incident || incident.k !== 'assault') return null;
        const tile = world && typeof world.getTile === 'function' && incident.key ? world.getTile(...incident.key.split(',').map(Number)) : null;
        const type = (tile && tile.settlement && tile.settlement.type) || 'town';
        // The realm's law on punishment scales the fine (systems/laws.js)
        const base = Math.round(_num(A.fine.assault, 40) * _num((A.fineTown || {})[type], 1) * Laws.punishment(world, incident.kingdom).fine);
        const owed = incident.kingdom != null ? Gossip.bountyTotalForKingdom(player, incident.kingdom) : 0;
        return Math.max(base, owed);
    },

    /** Odds of outrunning the watch. */
    escapeChance(player) {
        const E = StreetCrime.config().arrest.escape;
        const stealth = _num(player && player.skills && player.skills.stealth);
        const agility = _num(player && (player.agility != null ? player.agility : player.dexterity), 5);
        return Math.max(0.05, Math.min(_num(E.max, 0.75), _num(E.base) + stealth * _num(E.stealth) + agility * _num(E.agility)));
    },

    /** The choice scene when a guard comes for the player. */
    watchView(player, world, incidentId, guardName = 'The guard') {
        const C = StreetCrime.config();
        const inc = StreetCrime._incident(player, incidentId);
        if (!inc || inc.answered) return null;
        const vars = { guard: guardName, victim: inc.victim, town: inc.town };
        const fine = StreetCrime.fineFor(player, world, inc);
        const gold = _num(player.gold);
        const options = [{ id: 'submit', icon: '⛓️', label: 'Give yourself up', hint: 'A night or more in the cells; the matter is closed with the watch here.', chance: null, odds: false, isDefault: true }];
        if (fine != null) {
            options.push({ id: 'fine', icon: '💰', label: 'Pay the fine', cost: `${fine} gold`, hint: 'The watch lets a beating go for coin.', chance: null, odds: false, can: gold >= fine, reason: `You need ${fine} gold.` });
        }
        options.push({ id: 'run', icon: '🏃', label: 'Run for it', hint: 'Caught, and it goes worse for you.', chance: StreetCrime.escapeChance(player) });
        options.push({ id: 'resist', icon: '⚔️', label: 'Resist', hint: 'Fight the guard here and now.', chance: null, odds: false });
        return {
            icon: '🛡️', title: (C.watch && C.watch.title) || 'The Watch',
            stats: [`${inc.k === 'murder' ? 'Murder' : 'Assault'} of ${inc.victim}`, inc.town],
            text: _fill(((C.watch && C.watch.text) || {})[inc.k] || '{guard} comes for you.', vars),
            options,
        };
    },

    /**
     * Answer the watch: 'submit' | 'fine' | 'run' | 'resist'.
     * @returns {{ invalid?:boolean, outcome:string, jailed?:number, fight?:boolean, notification }}
     */
    answerWatch(player, world, incidentId, choice, settlement = null) {
        const C = StreetCrime.config();
        const A = C.arrest;
        const O = (C.watch && C.watch.outcomes) || {};
        const inc = StreetCrime._incident(player, incidentId);
        if (!inc || inc.answered) return { invalid: true, outcome: 'none', notification: { title: 'No One There', body: 'The guard has gone.', type: 'info' } };
        const vars = { guard: 'the guard', victim: inc.victim, town: inc.town };
        const jail = (extra) => {
            const out = Underworld._arrest(player, world, settlement || { name: inc.town, kingdom: inc.kingdom }, inc.k === 'murder' ? 'murder' : 'assault');
            const base = _num((A.days || {})[inc.k]) + _num(extra);
            // The realm's law on punishment: the whole sentence, longer or shorter (systems/laws.js)
            const mult = Laws.punishment(world, inc.kingdom).jail;
            const add = Math.max(1 - _num(out.days), Math.round((_num(out.days) + base) * mult) - _num(out.days));
            if (player.jailState) {
                player.jailState.daysRemaining += add;
                player.jailState.totalDays += add;
            }
            StreetCrime._answer(player, inc);
            return out.days + add;
        };
        switch (choice) {
            case 'submit': {
                const days = jail(0);
                return { outcome: 'jailed', jailed: days, notification: { title: '⛓️ Arrested', body: _fill(O.submit || 'You are taken to the cells: {days} days.', { ...vars, days }), type: 'error' } };
            }
            case 'fine': {
                const fine = StreetCrime.fineFor(player, world, inc);
                if (fine == null) return { invalid: true, outcome: 'none', notification: { title: 'No Fine', body: 'There is no paying your way out of a killing.', type: 'error' } };
                if (_num(player.gold) < fine) return { invalid: true, outcome: 'none', notification: { title: 'Purse Too Light', body: `You need ${fine} gold.`, type: 'error' } };
                player.gold -= fine;
                Ledger.record(player, 'fines', -fine);
                StreetCrime._answer(player, inc);
                return { outcome: 'fined', fine, notification: { title: '💰 Fined', body: _fill(O.fine || 'You pay {fine} gold.', { ...vars, fine }), type: 'warning' } };
            }
            case 'run': {
                if (Utils.random() < StreetCrime.escapeChance(player)) {
                    if (inc.kingdom != null) Underworld.addHeat(player, inc.kingdom, _num(A.fleeHeat, 6), world);
                    return { outcome: 'escaped', notification: { title: '🏃 Away!', body: _fill(O.escaped || 'You get away.', vars), type: 'warning' } };
                }
                const days = jail(_num(A.escapeFailDays, 3));
                return { outcome: 'jailed', jailed: days, notification: { title: '⛓️ Caught', body: _fill(O.caught || 'They catch you: {days} days.', { ...vars, days }), type: 'error' } };
            }
            case 'resist': {
                if (inc.kingdom != null) Underworld.addHeat(player, inc.kingdom, _num(A.resistHeat, 12), world);
                return { outcome: 'resist', fight: true, notification: { title: '⚔️ Resisting the Watch', body: _fill(O.resist || 'You fight the guard.', vars), type: 'error' } };
            }
            default:
                return { invalid: true, outcome: 'none', notification: { title: 'Not Possible', body: 'That cannot be done now.', type: 'error' } };
        }
    },

    _incident(player, id) {
        return ((player && player.streetCrime && player.streetCrime.incidents) || []).find(i => i.id === id) || null;
    },

    /** The matter is closed with the watch: this town's incidents, and the realm's bounties. */
    _answer(player, inc) {
        for (const i of StreetCrime.ensure(player).incidents) {
            if (i.key === inc.key && !i.answered) i.answered = true;
        }
        if (inc.kingdom != null) Gossip.settleWithKingdom(player, inc.kingdom);
    },
};
