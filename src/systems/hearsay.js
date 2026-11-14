// ============================================
// HEARSAY — townsfolk remember what you told them, and talk spreads
// ============================================
// The free talk (systems/npcChat.js) hands every turn here (afterTurn):
//
//   Digests     each talk leaves a short record on the person, kept on
//               player.hearsay.npcs[key]: when and where, what the player
//               claimed (a name, a home, a trade, a rank, a purse), boasted,
//               confessed, promised or threatened, how the talk went and how
//               they felt (the reply's own feeling.why). Read back into their
//               character sheet next time ("You spoke with them 12 days ago in
//               Ashford: …"), and into the canned town dialog when the AI
//               brain is off (greetLine). Capped per person, pruned with time.
//               All of it is taken from the player's words by the patterns in
//               data/hearsay.json — no extra model call, the reply schema is
//               untouched.
//   Promises    "I promise / I swear …" said to them is held as a promise
//               (NpcChatImpact 'promise') even when the model forgot to call
//               it, so an unkept word sours them; a broken promise is talked of.
//   Rumours     claims, boasts, threats, confessions, contradictions and broken
//               promises become hearsay that starts with the one told, spreads
//               through their town (reach: the share of folk who have heard)
//               and on to neighbouring towns over days, growing in the telling
//               (level 0..3; a false claim may be seen through: 'exposed').
//               Townsfolk who have heard it bring it to the talk (personaLines)
//               and the canned greeting. A lie told in one town can reach the
//               next before you.
//   Contradictions  telling someone a different name, home, trade, rank or
//               purse than you told another — when they have heard the first
//               (or were the first) — sours them and spreads as its own tale.
//
// State: player.hearsay (saved, systems/saveLoad.js). Daily: processDay from
// ui/game/endDay.js. No randomness: every spread roll is a hash of the
// rumour, the town and the day. Panel: ui/actionMenu/hearsay.js.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { NpcChatImpact } from './npcChatImpact.js';
import { NpcDisposition } from './npcDisposition.js';
// (talk grows more in the telling where few can read: systems/literacy.js; run time only)
import { Literacy } from './literacy.js';

const DEFAULTS = {
    digests: { perNpc: 4, npcs: 80, forgetDays: 360, promptTalks: 2, itemLength: 60, itemsPerTalk: 5 },
    claims: { kept: 60, perLine: 2, topics: ['name', 'origin', 'trade', 'rank', 'wealth'] },
    spread: {
        townDaily: 0.2, startReach: 0.15, neighbourAt: 0.45, neighbourChance: 0.4, maxDist: 4,
        distortChance: 0.45, maxLevel: 3, exposeChance: 0.25, rankExpose: 0.55,
        maxRumours: 40, maxTowns: 8, promptRumours: 2,
    },
    trust: { contradictionSour: 8, heardSour: 4 },
    kinds: {},
    patterns: [],
    phrases: {},
    phrasesYou: {},
    tellings: {},
    lines: {},
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const _day = (world) => _num(world && world.day);
const _clean = (s) => String(s == null ? '' : s).replace(/[<>{}[\]`"]/g, '').replace(/\s+/g, ' ').trim();
const _norm = (s) => _clean(s).toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
const _cut = (s, n) => { const t = _clean(s); return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t; };
const _fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
/** "a knight" / "an earl". */
const _article = (s) => String(s).replace(/\b(a) ([aeiou])/gi, (m, a, v) => `${a}n ${v}`);

function _hash01(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

let _reCache = null;
let _reSrc = null;

function _ago(n) {
    if (n <= 0) return 'earlier today';
    if (n === 1) return 'yesterday';
    if (n < 60) return `${n} days ago`;
    if (n < 400) return `${Math.round(n / 30)} months ago`;
    return 'years ago';
}

export const Hearsay = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.hearsay) || {};
        return {
            ...DEFAULTS, ...d,
            digests: { ...DEFAULTS.digests, ...(d.digests || {}) },
            claims: { ...DEFAULTS.claims, ...(d.claims || {}) },
            spread: { ...DEFAULTS.spread, ...(d.spread || {}) },
            trust: { ...DEFAULTS.trust, ...(d.trust || {}) },
        };
    },

    state(player) {
        if (!player) return null;
        if (!player.hearsay || typeof player.hearsay !== 'object') player.hearsay = { nextId: 1, npcs: {}, claims: [], rumours: [], stats: { claims: 0, caught: 0 } };
        const st = player.hearsay;
        if (!st.npcs || typeof st.npcs !== 'object') st.npcs = {};
        if (!Array.isArray(st.claims)) st.claims = [];
        if (!Array.isArray(st.rumours)) st.rumours = [];
        if (!st.stats) st.stats = { claims: 0, caught: 0 };
        if (!(st.nextId > 0)) st.nextId = st.rumours.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
        return st;
    },

    serialize(player) {
        return player && player.hearsay ? JSON.parse(JSON.stringify(player.hearsay)) : null;
    },

    /** The key a town-map person is remembered by (the same as NpcChat.townSubject's). */
    keyOf(npc) {
        return npc ? (npc.uid || npc.folkUid || npc.id || npc.name || null) : null;
    },

    // ── Reading the player's words ──

    _patterns() {
        const list = Hearsay.config().patterns || [];
        if (_reSrc !== list) {
            _reSrc = list;
            _reCache = list.map(p => { try { return { ...p, rx: new RegExp(p.re, 'i') }; } catch { return null; } }).filter(Boolean);
        }
        return _reCache;
    },

    /**
     * What a line of the player's claims, boasts, confesses or promises:
     * [{ topic, kind, value }] (value as said, lower case, trimmed).
     */
    extract(text) {
        const line = ` ${String(text || '').toLowerCase().replace(/[’`]/g, '\'').replace(/\s+/g, ' ')} `;
        const out = [];
        const seen = new Set();
        for (const p of Hearsay._patterns()) {
            const m = line.match(p.rx);
            if (!m) continue;
            let v = p.value || m[1] || '';
            v = _norm(v).replace(/\b(and|but|so|then|too|now)$/,'').trim();
            if (!v || v.length < 2) continue;
            if (p.prefix && !p.value) v = `${p.prefix}${v}`;
            const k = `${p.topic}|${p.kind}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ topic: p.topic, kind: p.kind, value: v });
        }
        return out;
    },

    /** Is the claim true of the player, where the game knows? → true | false | null */
    truthOf(player, topic, value) {
        if (!player) return null;
        const v = _norm(value);
        if (topic === 'name') {
            const words = _norm(player.name).split(' ').filter(Boolean);
            if (!words.length) return null;
            return words.includes(v.split(' ')[0]);
        }
        if (topic === 'rank') {
            const titles = _norm(`${player.kingdomTitle || ''} ${player.rulerTitle || ''} ${player.title && player.title !== 'Nobody' ? player.title : ''}`);
            if (!titles) return false;
            if (titles.includes(v)) return true;
            return ['lord', 'lady', 'noble', 'nobleman', 'noblewoman'].includes(v);
        }
        if (topic === 'wealth') {
            const g = _num(player.gold);
            if (v === 'rich') return g >= 500 ? true : g < 150 ? false : null;
            if (v === 'poor') return g < 60 ? true : g > 300 ? false : null;
        }
        return null;
    },

    /** The same claim? (a name by its first word) */
    _sameValue(topic, a, b) {
        const x = _norm(a); const y = _norm(b);
        if (topic === 'name') return x.split(' ')[0] === y.split(' ')[0];
        return x === y || x.includes(y) || y.includes(x);
    },

    _phrase(topic, value, teller = 'someone', you = false) {
        const C = Hearsay.config();
        const tpl = (you ? C.phrasesYou : C.phrases)[topic] || (you ? 'you said {v}' : 'they said {v}');
        // (a name or a place is said with its capitals)
        const v = topic === 'name' || topic === 'origin' ? String(value).replace(/\b[a-z]/g, c => c.toUpperCase()) : value;
        return _article(_fill(tpl, { v, teller }));
    },

    // ── Where the talk is ──

    _where(world, who) {
        const ctx = NpcChatImpact.context(world, who);
        return { key: ctx.q != null ? `${ctx.q},${ctx.r}` : null, name: ctx.name || (who && who.place) || 'town' };
    },

    _townName(world, key) {
        if (!world || !key || typeof world.getTile !== 'function') return null;
        const [q, r] = String(key).split(',').map(Number);
        const t = world.getTile(q, r);
        return (t && t.settlement && t.settlement.name) || null;
    },

    _towns(world) {
        if (world && typeof world.getSettlementViews === 'function') return world.getSettlementViews() || [];
        const out = [];
        for (const k of (world && world.kingdoms) || []) for (const s of k.settlements || []) out.push(s);
        return out;
    },

    // ── The person's memory of you ──

    _record(st, key, name, townKey, town, day) {
        let rec = st.npcs[key];
        if (!rec) rec = st.npcs[key] = { n: name || 'someone', tk: townKey, tn: town, last: day, talks: [], seen: [] };
        if (name) rec.n = name;
        if (townKey) { rec.tk = townKey; rec.tn = town || rec.tn; }
        if (!Array.isArray(rec.talks)) rec.talks = [];
        if (!Array.isArray(rec.seen)) rec.seen = [];
        rec.last = Math.max(_num(rec.last), day);
        return rec;
    },

    _talk(rec, sid, day, town) {
        const C = Hearsay.config().digests;
        let t = rec.talks.find(x => x.sid === sid);
        if (!t) {
            t = { sid, d: day, tn: town, items: [], net: 0 };
            rec.talks.push(t);
            if (rec.talks.length > C.perNpc) rec.talks.splice(0, rec.talks.length - C.perNpc);
        }
        return t;
    },

    _addItem(talk, item) {
        const C = Hearsay.config().digests;
        if (talk.items.some(i => i.k === item.k && i.t === item.t && Hearsay._sameValue(i.t, i.v, item.v))) return;
        talk.items.push(item);
        if (talk.items.length > C.itemsPerTalk) talk.items.splice(0, talk.items.length - C.itemsPerTalk);
    },

    // ── A rumour ──

    _rumour(st, o) {
        const C = Hearsay.config();
        const S = C.spread;
        const live = st.rumours.find(r => r.k === o.k && r.tp === o.tp && r.o === o.o && Hearsay._sameValue(o.tp, r.v, o.v) && o.d - r.d < 30);
        if (live) {
            live.d = o.d;
            const e = live.towns[o.o];
            if (e) e.r = Math.min(1, e.r + S.startReach / 2);
            return live;
        }
        const r = {
            id: st.nextId++, k: o.k, tp: o.tp, v: o.v, w: o.w, b: o.b || o.v, y: o.y || '',
            te: o.te, tk: o.tk, o: o.o, on: o.on, d: o.d,
            towns: { [o.o]: { d: o.d, r: S.startReach, l: 0 } },
        };
        if (o.lie) r.lie = true;
        st.rumours.push(r);
        while (st.rumours.length > S.maxRumours) st.rumours.shift();
        return r;
    },

    /** Has this person (key) in this town heard the rumour? */
    knows(r, townKey, npcKey) {
        const e = r && townKey && r.towns ? r.towns[townKey] : null;
        if (!e) return false;
        if (npcKey != null && r.tk === npcKey) return true;
        return _hash01(`${r.id}|${npcKey}`) < _num(e.r);
    },

    /** The rumour as told in a town. */
    telling(r, townKey, playerName = 'the stranger') {
        const C = Hearsay.config();
        const e = (r.towns && r.towns[townKey]) || { l: 0 };
        const list = (C.tellings || {})[e.x ? 'exposed' : r.k] || (C.tellings || {}).claim || ['{player}: {what}.'];
        const tpl = list[Math.min(list.length - 1, Math.max(0, _num(e.l)))];
        const s = _fill(tpl, { player: playerName, teller: r.te || 'someone', town: r.on || 'town', what: r.w || r.v, whatBare: r.b || r.v });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    /** Rumours known to this person where they are. */
    heardBy(player, townKey, npcKey) {
        if (!player || !player.hearsay || !townKey) return [];
        return Hearsay.state(player).rumours.filter(r => Hearsay.knows(r, townKey, npcKey));
    },

    // ── After a turn of free talk (systems/npcChat.js say) ──

    /**
     * Read the player's line: keep it on the person's digest, hold a sworn
     * word as a promise, check it against what they were told before, and let
     * what was claimed loose on the town.
     * opts: { tone (NpcChat.toneOf), reply ({ say, feeling, actions }), today (the store's day counters) }
     * → notes added (also pushed onto `notes`)
     */
    afterTurn(player, world, who, session, said, notes = [], opts = {}) {
        if (!player || !who || !session) return notes;
        const C = Hearsay.config();
        const st = Hearsay.state(player);
        const day = _day(world);
        const at = Hearsay._where(world, who);
        const key = who.key;
        const rec = Hearsay._record(st, key, who.name, at.key, at.name, day);
        const talk = Hearsay._talk(rec, session.sid, day, at.name);
        talk.net = Math.round(_num(session.net));
        const feel = opts.reply && opts.reply.feeling && typeof opts.reply.feeling.why === 'string' ? _cut(opts.reply.feeling.why, 60) : '';
        if (feel) talk.felt = feel;
        if (session.ended) talk.ended = true;

        const all = Hearsay.extract(said);
        const found = [...all.filter(f => f.kind !== 'promise').slice(0, Math.max(1, _num(C.claims.perLine, 2))), ...all.filter(f => f.kind === 'promise')];
        const tone = opts.tone || {};
        if (tone.kind === 'threat') found.push({ topic: 'threat', kind: 'threat', value: _norm(said).slice(0, 50) });
        const len = _num(C.digests.itemLength, 60);
        const topics = C.claims.topics || [];
        const acted = new Set(((opts.reply && opts.reply.actions) || []).map(a => a && a.fn));
        for (const f of found) {
            const v = _cut(f.value, len);
            if (f.kind === 'promise') {
                Hearsay._addItem(talk, { k: 'promise', t: 'promise', v });
                // (sworn aloud is sworn: held to it even if the model forgot to call it)
                if (!acted.has('promise')) NpcChatImpact.apply(player, world, who, session, { fn: 'promise', text: v }, opts.today || {}, notes);
                continue;
            }
            Hearsay._addItem(talk, { k: f.kind, t: f.topic, v });
            if (!at.key) continue;
            const lie = topics.includes(f.topic) ? Hearsay.truthOf(player, f.topic, v) === false : false;
            if (topics.includes(f.topic)) {
                Hearsay._contradiction(player, world, who, st, rec, talk, f.topic, v, at, notes);
                st.stats.claims = _num(st.stats.claims) + 1;
            }
            const r = Hearsay._rumour(st, {
                k: f.kind, tp: f.topic, v, d: day, o: at.key, on: at.name, te: who.name, tk: key, lie,
                w: f.kind === 'threat' ? Hearsay._phrase('threat', v, who.name) : Hearsay._phrase(f.topic, v, who.name),
                b: v, y: Hearsay._phrase(f.topic, v, who.name, true),
            });
            if (topics.includes(f.topic)) {
                st.claims.push({ d: day, key, n: who.name, tk: at.key, tn: at.name, tp: f.topic, v, lie, rid: r.id });
                if (st.claims.length > C.claims.kept) st.claims.splice(0, st.claims.length - C.claims.kept);
            }
        }
        if (found.some(f => f.kind !== 'promise') && at.key && !session._hsNoted) {
            session._hsNoted = true;
            notes.push({ text: `👂 ${who.firstName || who.name} will remember what you said, and may repeat it`, tone: 'info' });
        }
        return notes;
    },

    /** A claim on a topic the player told otherwise before, to them or to someone whose word they have heard. */
    _contradiction(player, world, who, st, rec, talk, topic, value, at, notes) {
        const C = Hearsay.config();
        const prev = [...st.claims].reverse().find(c => c.tp === topic && !Hearsay._sameValue(topic, c.v, value)
            && (c.key === who.key || (c.rid != null && Hearsay.knows(st.rumours.find(r => r.id === c.rid), at.key, who.key))));
        if (!prev) return null;
        const sour = _num(C.trust.contradictionSour, 8);
        const lost = who.sour ? who.sour(sour) : 0;
        st.stats.caught = _num(st.stats.caught) + 1;
        const other = prev.key === who.key ? 'you' : prev.n;
        rec.caught = { d: _day(world), tp: topic, mine: value, theirs: prev.v, other: prev.key === who.key ? null : prev.n };
        talk.caught = true;
        Hearsay._addItem(talk, { k: 'caught', t: topic, v: `${prev.v} / ${value}` });
        Hearsay._rumour(st, {
            k: 'contradiction', tp: topic, v: `${prev.v} / ${value}`, d: _day(world), o: at.key, on: at.name, te: who.name, tk: who.key,
            w: `first ${Hearsay._phrase(topic, prev.v)}, then ${Hearsay._phrase(topic, value)}`,
        });
        notes.push({ text: other === 'you'
            ? `🎭 ${who.firstName || who.name} remembers you told them otherwise before. They trust you less${lost > 0 ? ` (−${Math.round(lost)})` : ''}`
            : `🎭 ${who.firstName || who.name} has heard you told ${prev.n} otherwise. They trust you less${lost > 0 ? ` (−${Math.round(lost)})` : ''}`, tone: 'bad' });
        return prev;
    },

    /** The canned dialog's "Watch your tongue." (ui/npcDialog/choices.js): a threat is a threat, AI brain or not. */
    noteThreat(player, world, npc, townKey, town = null) {
        if (!player || !npc || !townKey) return null;
        const st = Hearsay.state(player);
        const day = _day(world);
        const key = Hearsay.keyOf(npc);
        const name = Hearsay._townName(world, townKey) || town || 'town';
        const rec = Hearsay._record(st, key, npc.name, townKey, name, day);
        const talk = Hearsay._talk(rec, `d${day}`, day, name);
        Hearsay._addItem(talk, { k: 'threat', t: 'threat', v: 'watch your tongue' });
        return Hearsay._rumour(st, { k: 'threat', tp: 'threat', v: 'threat', d: day, o: townKey, on: name, te: npc.name || 'someone', tk: key, w: Hearsay._phrase('threat', '', npc.name || 'someone') });
    },

    // ── The daily tick (ui/game/endDay.js) ──

    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world || !player.hearsay) return out;
        const C = Hearsay.config();
        const S = C.spread;
        const st = Hearsay.state(player);
        const day = _day(world);
        Hearsay._brokenPromises(world, player, st, day);
        if (st.rumours.length) {
            const towns = Hearsay._towns(world);
            const here = player.q != null ? `${player.q},${player.r}` : null;
            const kept = [];
            for (const r of st.rumours) {
                const life = _num(((C.kinds || {})[r.k] || {}).life, 120);
                const age = day - _num(r.d);
                if (age > life) continue;
                kept.push(r);
                const fade = Math.max(0, 1 - age / Math.max(1, life));
                for (const e of Object.values(r.towns)) if (_num(e.d) < day) e.r = Math.min(1, _num(e.r) + S.townDaily * fade);
                const keys = Object.keys(r.towns);
                if (keys.length >= S.maxTowns || !towns.length) continue;
                const sources = keys.filter(k => _num(r.towns[k].r) >= S.neighbourAt);
                if (!sources.length) continue;
                const src = sources[Math.floor(_hash01(`${r.id}|src|${day}`) * sources.length)];
                const [sq, sr] = src.split(',').map(Number);
                const near = [];
                for (const t of towns) {
                    if (!t || t.q == null) continue;
                    const k = `${t.q},${t.r}`;
                    if (r.towns[k]) continue;
                    const dist = Hex.wrappingDistance(sq, sr, t.q, t.r, world.width);
                    if (dist > 0 && dist <= S.maxDist) near.push({ k, dist, name: t.name });
                }
                near.sort((a, b) => a.dist - b.dist || (a.k < b.k ? -1 : 1));
                for (const n of near) {
                    const chance = S.neighbourChance * (1 - n.dist / (S.maxDist + 1)) * fade;
                    if (_hash01(`${r.id}|${n.k}|${day}`) >= chance) continue;
                    const from = r.towns[src];
                    const lv = Math.min(S.maxLevel, _num(from.l) + (_hash01(`${r.id}|lv|${n.k}`) < S.distortChance * Literacy.oralDistort(world, Literacy.at(world, n.k)) ? 1 : 0));
                    const e = { d: day, r: S.startReach, l: lv };
                    if (r.lie && _hash01(`${r.id}|x|${n.k}`) < (r.tp === 'rank' || r.tp === 'name' ? S.rankExpose : S.exposeChance)) e.x = 1;
                    r.towns[n.k] = e;
                    if (n.k === here && out.notices.length < 1) {
                        out.notices.push({ icon: '👂', title: 'Talk Has Gone Ahead of You', text: `Word has reached ${n.name || 'this town'}: "${Hearsay.telling(r, n.k, player.name || 'the stranger')}"`, type: 'info' });
                    }
                    break;
                }
            }
            st.rumours = kept;
        }
        if (day % 7 === 0) Hearsay._prune(player, st, day);
        return out;
    },

    /** A promise to someone broken (systems/npcChatImpact.js) is talked of in their town. */
    _brokenPromises(world, player, st, day) {
        const proms = (player.npcChat && player.npcChat.promises) || [];
        for (const p of proms) {
            if (p.state !== 'broken' || p.hs) continue;
            p.hs = 1;
            const fr = p.folkRef || (p.ref && p.ref.startsWith('folk:') ? p.ref.slice(5) : null);
            const townKey = fr ? fr.split('#')[0] : (st.npcs[p.key] && st.npcs[p.key].tk) || null;
            if (!townKey) continue;
            const town = Hearsay._townName(world, townKey) || (st.npcs[p.key] && st.npcs[p.key].tn) || 'town';
            const rec = Hearsay._record(st, p.key, p.name, townKey, town, day);
            rec.broken = { d: day, v: p.text };
            Hearsay._rumour(st, { k: 'broken_promise', tp: 'promise', v: p.text, d: day, o: townKey, on: town, te: p.name || 'someone', tk: p.key, w: Hearsay._phrase('broken_promise', p.text, p.name || 'someone') });
        }
    },

    _prune(player, st, day) {
        const C = Hearsay.config().digests;
        const owed = new Set(((player.npcChat && player.npcChat.promises) || []).filter(p => p.state === 'open').map(p => p.key));
        for (const [k, rec] of Object.entries(st.npcs)) {
            rec.talks = (rec.talks || []).filter(t => day - _num(t.d) <= C.forgetDays || owed.has(k));
            if (rec.seen && rec.seen.length > 12) rec.seen.splice(0, rec.seen.length - 12);
            if (!rec.talks.length && !owed.has(k) && day - _num(rec.last) > C.forgetDays) delete st.npcs[k];
        }
        const keys = Object.keys(st.npcs);
        if (keys.length > C.npcs) {
            keys.sort((a, b) => _num(st.npcs[a].last) - _num(st.npcs[b].last));
            for (const k of keys.slice(0, keys.length - C.npcs)) if (!owed.has(k)) delete st.npcs[k];
        }
    },

    // ── Read back: the character sheet ──

    _itemText(i, you = false) {
        if (i.k === 'promise') return you ? `you'd ${i.v}` : `promised you: ${i.v}`;
        if (i.k === 'threat') return you ? 'you threatened me' : 'threatened you';
        if (i.k === 'caught') return you ? `two tales: ${i.v}` : `told you two tales (${i.v})`;
        const ph = Hearsay._phrase(i.t, i.v, 'you', you);
        if (you) return ph;
        if (i.k === 'boast') return `boasted ${ph}`;
        if (i.k === 'confession') return `owned that ${ph}`;
        return `said ${ph}`;
    },

    /** Lines for the character sheet (systems/npcChat.js persona): past talks' digests, what they have heard. */
    personaLines(player, world, who, session = null) {
        const lines = [];
        if (!player || !player.hearsay || !who) return lines;
        const C = Hearsay.config();
        const L = C.lines || {};
        const st = Hearsay.state(player);
        const day = _day(world);
        const rec = st.npcs[who.key];
        if (rec) {
            const past = rec.talks.filter(t => (!session || t.sid !== session.sid) && t.items.length).slice(-_num(C.digests.promptTalks, 2));
            for (const t of past) {
                const items = t.items.map(i => Hearsay._itemText(i)).join('; ');
                const felt = t.felt ? ` (you felt: ${t.felt})` : '';
                lines.push(_fill(L.promptTalk || 'You spoke with them {ago} in {town}: {items}.', { ago: _ago(day - _num(t.d)), town: t.tn || 'town', items: items + felt }));
            }
            if (rec.caught && day - _num(rec.caught.d) <= 120) {
                lines.push(_fill(L.promptCaught || '', {
                    mine: Hearsay._phrase(rec.caught.tp, rec.caught.mine), theirs: Hearsay._phrase(rec.caught.tp, rec.caught.theirs),
                    other: rec.caught.other || 'you, before,',
                }));
            }
        }
        const at = Hearsay._where(world, who);
        const heard = Hearsay.heardBy(player, at.key, who.key)
            .filter(r => r.tk !== who.key)
            .sort((a, b) => _num(b.d) - _num(a.d))
            .slice(0, _num(C.spread.promptRumours, 2));
        if (heard.length) {
            lines.push(L.promptHeard || 'WHAT FOLK SAY OF THEM:');
            for (const r of heard) lines.push(`- ${Hearsay.telling(r, at.key, player.name || 'they')}`);
            if (heard.some(r => r.k === 'threat' || r.k === 'contradiction' || r.k === 'broken_promise' || (r.towns[at.key] && r.towns[at.key].x))) lines.push(L.promptWary || '');
        }
        return lines.filter(Boolean);
    },

    // ── Read back: the canned town dialog (no AI brain needed) ──

    /**
     * A line for the town dialog's greeting, from what this person remembers
     * of you or has heard: being caught out, a promise owed, a rumour heard
     * (an ill one costs a little of their regard, once), the last talk.
     * → string | null
     */
    greetLine(player, world, npc, townKey) {
        if (!player || !player.hearsay || !npc) return null;
        const C = Hearsay.config();
        const L = C.lines || {};
        const st = Hearsay.state(player);
        const day = _day(world);
        const key = Hearsay.keyOf(npc);
        const rec0 = st.npcs[key];
        if (rec0 && rec0.caught && !rec0.caught.g) {
            rec0.caught.g = 1;
            return _fill(L.greetCaught, {
                mine: Hearsay._phrase(rec0.caught.tp, rec0.caught.mine, '', true),
                theirs: Hearsay._phrase(rec0.caught.tp, rec0.caught.theirs, '', true),
                other: rec0.caught.other || 'me, before,',
            });
        }
        const owed = NpcChatImpact.promisesTo(player, key);
        if (owed.length) return _fill(L.greetPromise, { text: owed[0].text });
        // What they have heard (each tale once)
        const heard = Hearsay.heardBy(player, townKey, key).filter(r => r.tk !== key).sort((a, b) => _num(b.d) - _num(a.d));
        const fresh = heard.find(r => !(rec0 && rec0.seen.includes(r.id)));
        if (fresh) {
            const rec = Hearsay._record(st, key, npc.name, townKey, Hearsay._townName(world, townKey), day);
            rec.seen.push(fresh.id);
            const exposed = !!(fresh.towns[townKey] && fresh.towns[townKey].x);
            if (exposed || ['threat', 'contradiction', 'broken_promise'].includes(fresh.k)) {
                NpcDisposition.adjustDisposition(npc, -_num(C.trust.heardSour, 4), player);
            }
            const tpl = (L.greet || {})[exposed ? 'exposed' : fresh.k];
            if (tpl) return _fill(tpl, { you: fresh.y || fresh.v, youBare: fresh.b || fresh.v, town: fresh.on || 'town' });
        }
        // The last talk
        if (rec0) {
            const t = [...rec0.talks].reverse().find(x => x.items.some(i => i.k === 'claim' || i.k === 'boast'));
            if (t && day - _num(t.d) <= 90 && day > _num(t.d)) {
                const i = t.items.find(x => x.k === 'claim' || x.k === 'boast');
                return _fill(L.greetBack, { item: Hearsay._itemText(i, true) });
            }
        }
        return null;
    },

    /** "What news do you have?": once per tale, the talk about you. → string | null */
    newsLine(player, world, npc, townKey) {
        if (!player || !player.hearsay || !npc || !townKey) return null;
        const st = Hearsay.state(player);
        const key = Hearsay.keyOf(npc);
        const heard = Hearsay.heardBy(player, townKey, key).filter(r => r.tk !== key);
        const rec = st.npcs[key];
        const told = (rec && rec.told) || [];
        const r = heard.find(x => !told.includes(x.id));
        if (!r) return null;
        const rr = Hearsay._record(st, key, npc.name, townKey, Hearsay._townName(world, townKey), _day(world));
        rr.told = [...told, r.id].slice(-12);
        if (!rr.seen.includes(r.id)) rr.seen.push(r.id);
        return _fill((Hearsay.config().lines || {}).newsHeard || '{telling}', { telling: Hearsay.telling(r, townKey, 'you') });
    },

    // ── The "What people say of you" panel (ui/actionMenu/hearsay.js) ──

    /** → { town, here:[…], elsewhere, people:[…], claims:[…] } */
    view(player, world, townKey) {
        const C = Hearsay.config();
        const st = Hearsay.state(player);
        const day = _day(world);
        const town = Hearsay._townName(world, townKey) || 'here';
        const kinds = C.kinds || {};
        const here = [];
        let elsewhere = 0;
        for (const r of st.rumours) {
            const e = townKey ? r.towns[townKey] : null;
            if (!e) { elsewhere++; continue; }
            const kd = kinds[e.x ? 'contradiction' : r.k] || {};
            here.push({
                id: r.id, icon: e.x ? '🤥' : (kd.icon || '💬'), label: e.x ? 'Seen through' : (kd.label || r.k),
                text: Hearsay.telling(r, townKey, player.name || 'you'), reach: _num(e.r), level: _num(e.l), exposed: !!e.x,
                origin: r.on, teller: r.te, since: day - _num(e.d), towns: Object.keys(r.towns).length, ill: ['threat', 'contradiction', 'broken_promise', 'confession'].includes(r.k) || !!e.x,
            });
        }
        here.sort((a, b) => b.reach - a.reach);
        const people = Object.entries(st.npcs).filter(([, rec]) => rec.tk === townKey && rec.talks.length)
            .map(([k, rec]) => {
                const t = rec.talks[rec.talks.length - 1];
                return { key: k, name: rec.n, ago: _ago(day - _num(t.d)), net: _num(t.net), caught: !!rec.caught, items: t.items.map(i => Hearsay._itemText(i)) };
            });
        const claims = {};
        for (const c of st.claims) (claims[c.tp] = claims[c.tp] || []).push(c);
        const told = Object.entries(claims).map(([tp, list]) => {
            const vals = [];
            for (const c of list) if (!vals.some(v => Hearsay._sameValue(tp, v.v, c.v))) vals.push(c);
            return { topic: tp, values: vals.map(c => ({ v: c.v, to: c.n, town: c.tn, lie: !!c.lie })), mixed: vals.length > 1 };
        });
        return { town, here, elsewhere, people, claims: told };
    },
};
