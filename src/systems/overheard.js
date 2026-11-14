// ============================================
// OVERHEARD — townsfolk talking about the player, within earshot
// ============================================
// Two townsfolk stop to chat on the street map (world/innerMap/townLife.js);
// now and then, when the player is close by, one of them is talking about the
// player, from what the world really holds:
//
//   memory   — a deed the speaker remembers (systems/npcMemory.js: their own,
//              their living parents', the town's) or one another resident
//              remembers and has told them ("Wat the smith says…")
//   rumour   — a rumour told in this town (systems/gossip.js: crimes, deeds,
//              tall talk the player planted through free talk), as this town
//              tells it, and where it came from
//   bounty   — a price on the player's head in this realm
//   wanted   — an unanswered crime here the watch wants them for (streetCrime)
//   tale     — a court tale (systems/whispers.js) the player planted or fanned,
//              travelling; or traced back to them
//   fame     — the player's fame stage in this realm (systems/fame.js)
//   town     — the town's marks of the player's House (statue, square, sack:
//              world/townMarks.js via systems/townMemory.js)
//   brawl    — a street fight the player broke up or waded into here
//              (settlement.overheard.brawls, noted by ui/innerMapOverheard.js)
//
// The tone is the speaker's: their memory-opinion of the player's House
// (NpcMemory.opinion) plus their regard from the dialog (NpcDisposition,
// npc._dialogMemory) decides warm / cold / neutral, and with the fact's own
// good or ill picks the frame (data/overheard.json): praise, grudging,
// defend, slander, plain. A grudging or slandering line is "ill": the player
// learns who is spreading it, and the speaker is marked (p.ovh) so the free
// talk's persona knows the player overheard them (personaLines, read by
// systems/npcChatImpact.js).
//
// State: settlement.overheard = { said: { factKey: day }, day, n, brawls: [] }
// (saved with the tile) and p.ovh on the roster person. Picks are hashes of
// the salt the caller hands in (never the shared RNG). No globals. The model's
// retelling (voice) goes through the prose service the caller hands in
// (systems/llmProse.js), only when it is idle, rarely, and cached per fact.

import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from './townsfolk.js';
import { NpcMemory } from './npcMemory.js';
import { Gossip } from './gossip.js';
import { Whispers } from './whispers.js';
import { Fame } from './fame.js';
import { StreetCrime } from './streetCrime.js';
import { TownMarks } from '../world/townMarks.js';

const DEFAULTS = {
    enabled: true, radius: 6, chance: 0.35, cooldownSecs: [45, 90], perTownDay: 4, repeatDays: 12,
    warmAt: 6, coldAt: -6, dispositionShare: 0.5, relayScan: 60, relayMin: 4, relayShare: 0.7,
    brawlDays: 60, brawlKeep: 6, markDays: 90, chunk: 44, maxChunks: 3, lineSecs: 2.8, toastIll: true,
    llm: { perDay: 2, chance: 0.5, maxLen: 150 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const _first = n => String(n || '').split(' ')[0];

/** A hash of a string to [0, 1). */
export function overheardFrac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
const _frac = overheardFrac;
const _pick = (list, salt) => { const a = _arr(list); return a.length ? a[Math.floor(_frac(salt) * a.length) % a.length] : null; };

function _fill(t, vars) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : '')).replace(/\s+/g, ' ').replace(/\s+([.,?!])/g, '$1').trim();
}

function _alive(p) { return !!p && p.died == null; }

export const Overheard = {
    data() {
        const g = DataLoader._gamedata;
        return _obj(g && g.overheard) || {};
    },

    config() {
        const d = _obj(Overheard.data().config) || {};
        return { ...DEFAULTS, ...d, llm: { ...DEFAULTS.llm, ...(_obj(d.llm) || {}) } };
    },

    enabled() { return Overheard.config().enabled !== false; },

    /** The town's record: { said, day, n, brawls }. */
    state(settlement) {
        if (!settlement) return null;
        const st = _obj(settlement.overheard) || {};
        if (!_obj(st.said)) st.said = {};
        if (!Array.isArray(st.brawls)) st.brawls = [];
        settlement.overheard = st;
        return st;
    },

    // ── How the speaker feels ────────────────────────

    /**
     * The speaker's feeling for the player: memory opinion (±40) plus their dialog
     * regard (npc._dialogMemory.disposition − 50, times dispositionShare). → number
     */
    attitude(world, player, folk, p, npc = null, day = null) {
        if (!player || !p) return 0;
        const C = Overheard.config();
        let a = 0;
        try { a += NpcMemory.opinion(world, folk ? { folk, person: p } : p, player, { day: day != null ? day : undefined }); } catch { /* none */ }
        const mem = npc && npc._dialogMemory;
        if (mem && Number.isFinite(mem.disposition)) a += (mem.disposition - 50) * _num(C.dispositionShare, 0.5);
        return Math.round(a);
    },

    mood(att) {
        const C = Overheard.config();
        return att >= _num(C.warmAt, 6) ? 'warm' : att <= _num(C.coldAt, -6) ? 'cold' : 'neutral';
    },

    // ── What there is to say ─────────────────────────

    _who(player) {
        return _first(player && (player.firstName || player.name)) || 'that stranger';
    },

    _pron(player) {
        const f = player && player.gender === 'female';
        return { them: f ? 'her' : 'him', their: f ? 'her' : 'his' };
    },

    _roleWord(p) {
        const R = _obj(Overheard.data().roles) || {};
        const w = R[p && p.role];
        return p ? (w ? `${p.first} ${w}` : p.first) : 'someone';
    },

    /** The words for whoever did a remembered deed: the player, or a forebear ("Brom, Aldric's grandfather"). */
    _actorWords(ep, player) {
        const a = NpcMemory.actorOf(ep, player);
        if (a.gen == null) return null;
        if (a.gen === 0) return ep.by && _first(ep.by) !== Overheard._who(player) ? `${_first(ep.by)} of ${Overheard._who(player)}'s House` : Overheard._who(player);
        const rel = String(a.word || '').replace(/^your /, '').replace(/^one of your /, '');
        return `${_first(ep.by) || 'one'}, ${Overheard._who(player)}'s ${rel}`;
    },

    _memoryFact(world, player, ep, day, whom, opts = {}) {
        const G = (_obj(Overheard.data().gists) || {}).memory || {};
        const t = G[ep.k];
        if (!t) return null;
        const who = Overheard._actorWords(ep, player);
        if (!who) return null;
        const raw = NpcMemory.weightAt(ep, day);
        const C = NpcMemory.config();
        const a = NpcMemory.actorOf(ep, player);
        const w = raw * _num(C.actorShare[Math.min(a.gen, C.actorShare.length - 1)], 1) * _num(opts.share, 1);
        if (Math.abs(w) < _num(opts.min, 1)) return null;
        return {
            key: `m:${ep.k}:${ep.d}:${ep.vn || ''}:${opts.tag || 'own'}`, src: 'memory', kind: ep.k,
            v: w > 0 ? 1 : -1, w: Math.abs(w), who, gist: _fill(t, { whom }), from: opts.from || null,
            fromPid: opts.fromPid != null ? opts.fromPid : null,
        };
    },

    _whomOwn(ep) {
        if (!ep.vr || ep.vr === 'self') return 'me';
        return `my ${ep.vr}`;
    },

    _whomOf(teller, ep) {
        if (!ep.vr || ep.vr === 'self') return teller.first;
        return `${teller.first}'s ${ep.vr}`;
    },

    /** Deeds remembered: the speaker's own (and their parents'), another resident's told on, the town's. */
    memoryFacts(world, player, settlement, p, day, salt = '') {
        const C = Overheard.config();
        const folk = settlement && settlement.folk;
        const out = [];
        if (!p || !player || !NpcMemory.enabled()) return out;
        // Their own (and what their living parents tell)
        for (const m of NpcMemory.recall(world, folk ? { folk, person: p } : p, { about: player, includeTown: false, limit: 3, day })) {
            const from = m.source === 'parent' || m.inherited ? _fill(((Overheard.data().from || {}).parent) || 'my {rel}', { rel: m.from || 'family' }) : null;
            const f = Overheard._memoryFact(world, player, m._e, day, Overheard._whomOwn(m._e), { tag: 'own', from: m.source === 'parent' ? from : null });
            if (f) out.push(f);
        }
        if (!folk || !Array.isArray(folk.people)) return out;
        // The town's own memory (a raid, a famine dole): everyone knows it
        for (const ep of _arr(folk.nm)) {
            const f = Overheard._memoryFact(world, player, ep, day, ep.vn ? _first(ep.vn) : 'folk here', { tag: 'town', share: NpcMemory.config().townShare });
            if (f) out.push(f);
        }
        // Another resident's, told on: a bounded scan from a hashed start
        const people = folk.people;
        const n = Math.min(people.length, _num(C.relayScan, 60));
        const start = Math.floor(_frac(`${salt}|relay`) * Math.max(1, people.length));
        let found = 0;
        for (let i = 0; i < n && found < 2; i++) {
            const t = people[(start + i) % people.length];
            if (!t || t === p || !Townsfolk.isHere(t) || !Array.isArray(t.nm) || !t.nm.length) continue;
            for (const ep of t.nm) {
                const f = Overheard._memoryFact(world, player, ep, day, Overheard._whomOf(t, ep), {
                    tag: `r${t.id}`, share: _num(C.relayShare, 0.7), min: _num(C.relayMin, 4), from: Overheard._roleWord(t), fromPid: t.id,
                });
                if (f) { out.push(f); found++; break; }
            }
        }
        return out;
    },

    /** Rumours told in this town (as this town tells them), a bounty in the realm, a crime the watch wants them for. */
    rumourFacts(world, player, settlement, p, day) {
        const out = [];
        if (!player || !settlement || settlement.q == null) return out;
        const D = Overheard.data();
        const G = _obj(D.gists) || {};
        const W = _obj(D.weights) || {};
        const key = `${settlement.q},${settlement.r}`;
        const pn = Overheard._pron(player);
        const g = player.gossip;
        const pname = player.name;
        for (const rm of _arr(g && g.rumors)) {
            if (!rm || rm.expired || !_arr(rm.spreadTo).includes(key)) continue;
            if (rm.perpetrator && pname && rm.perpetrator !== pname) continue;
            const t = Gossip.tellingAt(rm, key);
            if (t && ((t.clears && t.id !== 'refuted') || t.stolen)) continue;
            const tpl = (G.rumour || {})[rm.type];
            if (tpl == null) continue;
            const deed = Gossip.isDeed(rm);
            const v = deed ? 1 : rm.type === 'boast' ? 0 : -1;
            let gist = _fill(tpl, { victim: rm.victim ? rm.victim.name : 'someone', location: rm.locationName || 'these parts', ...pn });
            if (rm.type === 'boast') gist = gist.replace(/^(I|he|she|they)\s+/i, '');
            if (t && t.id) gist += ((G.tellings || {})[t.id] || '');
            const here = rm.locationName === settlement.name;
            const saw = here && p && _arr(rm.witnessNames).some(n => n === Townsfolk.name(p) || _first(n) === p.first);
            const witness = here ? _arr(rm.witnessNames).find(n => !(p && (n === Townsfolk.name(p) || _first(n) === p.first))) : null;
            const from = here ? (witness ? _first(witness) : null) : _fill(_pick((D.from || {}).travelled, `${rm.id}|${key}`) || 'folk from {place}', { place: rm.locationName });
            const sev = Gossip.localSeverity(rm, key);
            out.push({
                key: `g:${rm.id}`, src: 'rumour', kind: rm.type, v, w: Math.min(_num(W.rumourMax, 10), sev * _num(W.rumourPer, 0.12)) * (t && t.id === 'refuted' ? 0.4 : 1),
                who: Overheard._who(player), gist, from, saw, long: Gossip.describeAt(rm, key),
            });
        }
        for (const b of _arr(g && g.bounties)) {
            if (!b || settlement.kingdom == null || b.kingdom !== settlement.kingdom || !(b.gold > 0)) continue;
            out.push({ key: `b:${b.rumorId}`, src: 'bounty', kind: 'bounty', v: -1, w: _num(W.bounty, 8), who: Overheard._who(player), gist: _fill(G.bounty || 'has a price on {their} head', { gold: Math.round(b.gold), ...pn }), from: null });
            break;
        }
        try {
            const inc = StreetCrime.pendingAt(player, key, day);
            if (inc) {
                const crime = ((G.crimes || {})[inc.k]) || inc.k;
                out.push({ key: `w:${inc.id}`, src: 'wanted', kind: inc.k, v: -1, w: _num(W.wanted, 9), who: Overheard._who(player), gist: _fill(G.wanted || 'is wanted by the watch for {crime}', { crime }), from: null, saw: _arr(inc.witnesses).some(n => p && _first(n) === p.first) });
            }
        } catch { /* no record */ }
        return out;
    },

    /** Court tales here the player planted or fanned (travelling), or one traced back to them. */
    taleFacts(world, player, settlement) {
        const out = [];
        if (!player || !settlement || settlement.q == null) return out;
        const D = Overheard.data();
        const W = _obj(D.weights) || {};
        let tales = [];
        try { tales = Whispers.talkAt(player, settlement.q, settlement.r); } catch { tales = []; }
        for (const sc of tales) {
            if (!sc) continue;
            if (sc.traced) {
                out.push({ key: `tt:${sc.id}`, src: 'tale', kind: 'traced', v: -1, w: _num(W.tracedTale, 6), who: Overheard._who(player), gist: _fill(((D.gists || {}).tracedTale) || 'started that tale about {subject}', { subject: sc.subject && sc.subject.name }), from: null });
                continue;
            }
            if (!sc.planted && !sc.fannedByPlayer) continue;
            const from = sc.place && sc.place !== settlement.name ? _fill(_pick((D.from || {}).travelled, `${sc.id}|tale`) || 'folk from {place}', { place: sc.place }) : null;
            out.push({ key: `t:${sc.id}`, src: 'tale', kind: sc.kind, v: 0, w: _num(W.tale, 3) + _num(sc.heat) / 20, tale: Whispers.text(sc), subject: sc.subject && sc.subject.name, from, mine: true });
        }
        return out;
    },

    /** The player's fame in the realm, the town's marks of their House, and fights they were in here. */
    townFacts(world, player, settlement, day) {
        const out = [];
        if (!player || !settlement) return out;
        const D = Overheard.data();
        const G = _obj(D.gists) || {};
        const W = _obj(D.weights) || {};
        const pn = Overheard._pron(player);
        const who = Overheard._who(player);
        try {
            const st = Fame.stageIn(player, settlement.kingdom != null ? settlement.kingdom : null);
            const gist = st && (G.fame || {})[st.id];
            if (gist) out.push({ key: `f:${st.id}`, src: 'fame', kind: st.id, v: st.kind === 'ill' ? -1 : 1, w: _num((W.fame || {})[st.id], 3), who, gist: _fill(gist, pn), from: null });
        } catch { /* no fame */ }
        const house = player.house && player.house.name;
        if (house) {
            let marks = [];
            try { marks = TownMarks.marks(settlement); } catch { marks = []; }
            for (const m of marks) {
                let id = null; let v = 0;
                if (m.k === 'statue' && m.house === house && (m.state || 'standing') === 'standing') { id = 'statue'; v = 1; }
                else if (m.k === 'statue' && m.house === house && m.state === 'defaced') { id = 'statueDefaced'; v = -1; }
                else if (m.k === 'name' && m.house === house && (m.state || 'kept') === 'kept') { id = 'name'; v = 1; }
                else if (m.k === 'sack' && (m.by === house || m.byPlayer)) { id = 'sack'; v = -1; }
                const gist = id && (G.townMark || {})[id];
                if (gist) out.push({ key: `tm:${id}:${_num(m.d)}`, src: 'town', kind: id, v, w: _num(W.townMark, 5), who, gist: _fill(gist, pn), from: null });
            }
        }
        const C = Overheard.config();
        const st = _obj(settlement.overheard);
        for (const b of _arr(st && st.brawls)) {
            if (!b || day - _num(b.d) > _num(C.brawlDays, 60)) continue;
            const gist = (G.brawl || {})[b.k];
            if (!gist) continue;
            out.push({ key: `br:${b.d}:${b.a}:${b.b}`, src: 'brawl', kind: b.k, v: b.k === 'parted' ? 1 : 0, w: _num(W.brawl, 5), who, gist: _fill(gist, { a: _first(b.a), b: _first(b.b), place: b.place || 'street' }), from: null, pids: [b.ap, b.bp] });
        }
        return out;
    },

    /** Everything the speaker could say of the player here. */
    facts(world, player, settlement, p, day, salt = '') {
        if (!player || !settlement) return [];
        return [
            ...Overheard.memoryFacts(world, player, settlement, p, day, salt),
            ...Overheard.rumourFacts(world, player, settlement, p, day),
            ...Overheard.taleFacts(world, player, settlement),
            ...Overheard.townFacts(world, player, settlement, day),
        ];
    },

    // ── The line ─────────────────────────────────────

    /** The frame for a fact's good or ill and the speaker's mood. */
    frameFor(v, mood) {
        if (v > 0) return mood === 'cold' ? 'grudging' : 'praise';
        if (v < 0) return mood === 'warm' ? 'defend' : 'slander';
        return mood === 'warm' ? 'praise' : mood === 'cold' ? 'slander' : 'plain';
    },

    /** Is a frame talk against the player? */
    isIll(frame) { return frame === 'grudging' || frame === 'slander'; },

    /** One fact, said: { said (the speaker's line), reply (the other's), frame, ill }. */
    say(player, fact, mood, partnerMood, salt = '') {
        const D = Overheard.data();
        const pn = Overheard._pron(player);
        const vars = { who: fact.who, Who: _cap(fact.who), gist: fact.gist, from: fact.from, From: _cap(fact.from), tale: fact.tale, ...pn };
        let frame; let said;
        if (fact.tale) {
            frame = 'plain';
            const T = _obj(D.tale) || {};
            said = _fill(_pick(fact.from ? T.sourced : T.plain, `${salt}|t`) || '{tale}', vars);
        } else {
            frame = Overheard.frameFor(fact.v, mood);
            const pool = fact.from ? (_obj(D.sourced) || {})[frame] : (_obj(D.frames) || {})[frame];
            said = _fill(_pick(pool, `${salt}|f`) || '{Who} {gist}.', vars);
            if (fact.saw && D.witnessed) said += D.witnessed;
        }
        const R = _obj(D.replies) || {};
        const ill = Overheard.isIll(frame);
        let rk;
        if (ill && partnerMood === 'warm') rk = 'doubtIll';
        else if (frame === 'praise' && partnerMood === 'cold') rk = 'doubtGood';
        else if (ill || frame === 'defend') rk = partnerMood === 'warm' ? 'warm' : 'cold';
        else if (frame === 'praise' || frame === 'grudging') rk = partnerMood === 'cold' ? 'cold' : 'warm';
        else rk = partnerMood === 'neutral' ? 'plain' : partnerMood;
        if (fact.tale) rk = 'plain';
        const reply = _fill(_pick(R[rk] || R.plain, `${salt}|r`) || '', vars) || null;
        return { said, reply, frame, ill };
    },

    /**
     * What one of two folk chatting says of the player, or null.
     * ctx { world, player, settlement, a: { p, npc }, b: { p, npc }, day, salt }.
     * Picks the one with more to say (and feeling about it) as the speaker, a fact
     * the town has not heard said in repeatDays (weighted by its strength), and a frame
     * by the speaker's mood. → { speaker, listener, fact, said, reply, frame, ill, key, log, mood }
     */
    compose(ctx) {
        if (!Overheard.enabled() || !ctx || !ctx.player || !ctx.settlement) return null;
        const { world, player, settlement } = ctx;
        const C = Overheard.config();
        const day = _num(ctx.day, _num(world && world.day, 1));
        const salt = String(ctx.salt || '');
        const st = Overheard.state(settlement);
        const folk = settlement.folk || null;
        const fresh = f => !(st.said[f.key] != null && day - st.said[f.key] < _num(C.repeatDays, 12));
        const sides = [ctx.a, ctx.b].filter(s => s && s.p).map((s, i, all) => ({ ...s, other: all[1 - i] || null }));
        let best = null;
        for (const s of sides) {
            const att = Overheard.attitude(world, player, folk, s.p, s.npc, day);
            const list = Overheard.facts(world, player, settlement, s.p, day, `${salt}|${s.p.id}`)
                // (a fight they were in themselves is their own to tell; the one they told of is not)
                .filter(f => fresh(f) && f.fromPid !== (s.other && s.other.p && s.other.p.id));
            if (!list.length) continue;
            const score = list.reduce((x, f) => x + f.w, 0) + Math.abs(att) * 0.1;
            if (!best || score > best.score) best = { side: s, att, list, score };
        }
        if (!best) return null;
        // A weighted pick by strength (hash, never the shared RNG)
        const total = best.list.reduce((x, f) => x + f.w, 0);
        let roll = _frac(`${salt}|pick`) * total;
        let fact = best.list[best.list.length - 1];
        for (const f of best.list) { roll -= f.w; if (roll <= 0) { fact = f; break; } }
        const speaker = best.side;
        const listener = sides.find(s => s !== speaker) || null;
        const mood = Overheard.mood(best.att);
        const lMood = listener ? Overheard.mood(Overheard.attitude(world, player, folk, listener.p, listener.npc, day)) : 'neutral';
        const out = Overheard.say(player, fact, mood, lMood, salt);
        st.said[fact.key] = day;
        // (the said list stays small: what the town has not said in repeatDays is dropped)
        for (const [k, d] of Object.entries(st.said)) if (day - d >= _num(C.repeatDays, 12)) delete st.said[k];
        return {
            ...out, speaker, listener, fact, mood, key: fact.key,
            log: Overheard.logLine(player, settlement, speaker.p, listener && listener.p, fact, out),
        };
    },

    /** The message-log line: who said it, to whom, and (for ill talk) who is spreading it and from whom they had it. */
    logLine(player, settlement, sp, lp, fact, out) {
        const L = _obj(Overheard.data().log) || {};
        const parts = [_fill(L.line || '{speaker} ({role}) to {to}: "{said}"', {
            speaker: Townsfolk.name(sp), role: Townsfolk.roleTitle(sp), to: lp ? Townsfolk.name(lp) : 'a neighbour', said: out.said,
        })];
        if (fact.long && fact.long !== out.said) parts.push(`(${_cap(String(fact.long).replace(/[.\s]+$/, ''))}.)`);
        if (out.ill) {
            parts.push(_fill(L.spreading || '{first} is spreading it about you.', { first: sp.first }));
            if (fact.from) parts.push(_fill(L.heardFrom || '{first} had it from {from}.', { first: sp.first, from: fact.from }));
        } else if (fact.tale) {
            parts.push(`Your tale about ${fact.subject || 'them'} has reached ${settlement.name || 'here'}.`);
        } else if (out.frame === 'praise') {
            parts.push(_fill(L.good || 'Word of you is getting about {town}.', { town: settlement.name || 'town' }));
        }
        return parts.join(' ');
    },

    // ── The mark on the speaker ──────────────────────

    /** The speaker knows nothing yet; the free talk will: the player overheard them. */
    mark(p, said, toName, ill, day) {
        if (!p) return;
        p.ovh = { d: _num(day), t: String(said || '').slice(0, 200), to: toName || 'a neighbour', ill: !!ill };
    },

    /** Lines for the free talk's persona (systems/npcChatImpact.js personaLines). */
    personaLines(player, world, p) {
        const o = p && _obj(p.ovh);
        if (!o) return [];
        const day = _num(world && world.day, o.d);
        if (day - _num(o.d) > _num(Overheard.config().markDays, 90)) return [];
        const P = _obj(Overheard.data().persona) || {};
        const said = /[.!?]$/.test(o.t) ? o.t : `${o.t}.`;
        const line = _fill(o.ill ? P.ill : P.good, { day: o.d, to: _first(o.to), said });
        return line ? [P.header || 'SOMETHING THE PLAYER OVERHEARD YOU SAY:', line] : [];
    },

    // ── Fights the player was in ─────────────────────

    /** A street fight the player broke up ('parted') or waded into ('joined'), for the town to talk of. */
    noteBrawl(settlement, entry) {
        const st = Overheard.state(settlement);
        if (!st || !entry || !entry.k) return null;
        const e = { k: entry.k, d: _num(entry.d), a: String(entry.a || 'someone'), b: String(entry.b || 'someone'), place: entry.place || null, ap: entry.ap != null ? entry.ap : null, bp: entry.bp != null ? entry.bp : null };
        if (st.brawls.some(x => x.d === e.d && x.a === e.a && x.b === e.b)) return null;
        st.brawls.push(e);
        const keep = _num(Overheard.config().brawlKeep, 6);
        if (st.brawls.length > keep) st.brawls.splice(0, st.brawls.length - keep);
        return e;
    },

    // ── Throttles ────────────────────────────────────

    /** Room for another overheard line in this town today? (counts it when `take`). */
    roomToday(settlement, day, take = false) {
        const st = Overheard.state(settlement);
        if (!st) return false;
        if (st.day !== day) { st.day = day; st.n = 0; }
        if (_num(st.n) >= _num(Overheard.config().perTownDay, 4)) return false;
        if (take) st.n = _num(st.n) + 1;
        return true;
    },

    /** The line split into bubbles of at most `chunk` characters (maxChunks; the last ends in "…" if cut). */
    chunks(text, size = null, max = null) {
        const C = Overheard.config();
        const n = _num(size, _num(C.chunk, 44));
        const m = _num(max, _num(C.maxChunks, 3));
        const words = String(text || '').split(/\s+/).filter(Boolean);
        const out = [];
        let cur = '';
        for (const w of words) {
            if (cur && (cur.length + 1 + w.length) > n) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
        }
        if (cur) out.push(cur);
        if (out.length > m) { const kept = out.slice(0, m); kept[m - 1] = `${kept[m - 1].replace(/[.,;:!?]*$/, '')}…`; return kept; }
        return out;
    },

    // ── The model's retelling ────────────────────────

    _llm: { day: null, n: 0 },

    /**
     * The line as spoken: the model's retelling when one is cached for this fact and
     * frame, else the template. When the prose service is on and idle (nothing pending),
     * under the day's budget (llm.perDay) and the hash roll (llm.chance), it asks for one
     * in the background for next time — never waiting on it. prose: systems/llmProse.js.
     */
    voice(world, prose, settlement, res) {
        if (!prose || !res || !res.said) return res ? res.said : null;
        const C = Overheard.config();
        const L = C.llm || {};
        const key = `overheard:${settlement && settlement.q},${settlement && settlement.r}:${res.key}:${res.frame}`;
        try {
            const got = typeof prose.written === 'function' ? prose.written(world, key) : null;
            if (got && got.length <= _num(L.maxLen, 150)) return got;
            if (got) return res.said;
            if (typeof prose.canWrite !== 'function' || !prose.canWrite('overheard')) return res.said;
            if (typeof prose.status === 'function' && prose.status(world, key)) return res.said;
            if (typeof prose.pending === 'function' && prose.pending(world) > 0) return res.said;
            const day = _num(world && world.day);
            if (Overheard._llm.day !== day) { Overheard._llm.day = day; Overheard._llm.n = 0; }
            if (Overheard._llm.n >= _num(L.perDay, 2)) return res.said;
            if (_frac(`${key}|llm|${day}`) >= _num(L.chance, 0.5)) return res.said;
            Overheard._llm.n++;
            const f = res.fact || {};
            prose.write(world, {
                kind: 'overheard', key, fallback: res.said, style: Overheard.data().llmStyle || null,
                facts: {
                    about: f.who || null, deed: f.tale || f.gist || null, heardFrom: f.from || null,
                    feeling: res.frame === 'praise' ? 'approving' : res.frame === 'defend' ? 'doubting the ill talk, fond of them'
                        : res.frame === 'grudging' ? 'grudging, sour' : res.frame === 'slander' ? 'disapproving, spreading ill word' : 'curious',
                    town: settlement && settlement.name,
                },
            });
        } catch { /* the template stands */ }
        return res.said;
    },
};
