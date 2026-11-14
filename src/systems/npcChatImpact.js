// ============================================
// NPC CHAT IMPACT — what the player says in free talk reaches the world
// ============================================
// The free talk (systems/npcChat.js) lets the model act through functions.
// The ones here carry the talk beyond the one person, through systems that
// already exist — nothing parallel is kept:
//
//   spread_word   they repeat what the player told them. About a ruler or a
//                 rival adventurer: a court tale (systems/whispers.js) planted
//                 in their town, or an old one fanned (a lie can be traced
//                 back, as any planted tale). About someone of their town:
//                 slander (the one talked of hears who started it — their
//                 memory, their regard, a grudge with the teller,
//                 systems/brawls.js) or praise. About the player: tall talk
//                 that spreads town to town (systems/gossip.js 'boast').
//   grow_grudge   turned against a named neighbour: a feud (Brawls.addFeud
//                 'whispered') that can come to blows.
//   cool_grudge   talked down: the feud's heat falls (gone below forgetBelow).
//   promise       they hold the player to their word: kept (keep_promise, or
//                 coin promised and paid through accept_gold) warms them and
//                 is remembered; broken (the day passes) sours them, and
//                 they and their family remember it (systems/npcMemory.js).
//   report_to_watch  a crime owned to goes to the watch (Gossip.accuse:
//                 karma, the realm's regard, a rumour that can bring a bounty).
//   tell_family   their family hear of the player, well or ill (their
//                 regard; a family story, NpcMemory 'spoke_well'/'spoke_ill').
//   share_secret  they confide something true: the truth of a tale told in
//                 their realm (Whispers.reveal), else what they know of
//                 trouble nearby (systems/npcKnowledge.js rumour).
// And without being asked: every turn a share of how the player's words
// landed reaches their family and household (their disposition), and a
// sharp enough insult is remembered, by them and their kin.
//
// All of it is clamped by data/npcChat.json → impact (per NPC per day), and
// every name the model gives must resolve to a real person, realm or rival
// in the sim, or the action is ignored. What came of it is kept on the
// subject's store (chatLedger) and the promises on player.npcChat, and both
// are read back into the character sheet (personaLines), so the NPC
// remembers next time. No randomness of its own except what Whispers draws
// when a tale is planted (the player's own action, Utils.random).

import { DataLoader } from '../core/dataLoader.js';
import { Names } from '../core/names.js';
import { Townsfolk } from './townsfolk.js';
import { Brawls } from './brawls.js';
import { Whispers } from './whispers.js';
import { Gossip } from './gossip.js';
import { NpcMemory } from './npcMemory.js';
import { NpcKnowledge } from './npcKnowledge.js';
import { NpcDisposition } from './npcDisposition.js';
import { Relationships } from './relationships.js';
import { Vanishings } from './vanishings.js';
import { Overheard } from './overheard.js';

const DEFAULTS = {
    kinShare: 0.25, kinPerDay: 4, kinTold: 3, wordPerDay: 1, whisperHeat: 6,
    slanderSour: 4, slanderGrudge: 12, praiseWarm: 3, grudgesPerDay: 1, grudgeHeat: 15,
    coolsPerDay: 1, coolHeat: 20, reportsPerDay: 1, reportCredibility: 0.45,
    guardReportCredibility: 0.75, reportCrimes: ['theft', 'assault', 'murder', 'vandalism'],
    toldPerDay: 1, secretsPerDay: 1, secretRegard: 20, insultAt: 7, ledger: 8, folkNamed: 8,
    claimLength: 90,
    promise: { perDay: 2, maxOpen: 3, maxAll: 30, minDays: 1, maxDays: 60, defaultDays: 14, maxGold: 500, textLength: 100, keptWarm: 6, brokenSour: 14, kinBroken: 4 },
    whisperWords: {},
};

const FNS = ['spread_word', 'grow_grudge', 'cool_grudge', 'promise', 'keep_promise', 'report_to_watch', 'tell_family', 'share_secret'];

const _num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
/** Free text from the model: one line, no markup, bounded. */
const _text = (s, max) => String(typeof s === 'string' ? s : '').replace(/[<>{}[\]`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const _alive = (p) => !!p && p.died == null && !p.away;

/** A person's dialog memory (systems/npcDisposition.js), made if they have none yet. */
function _memOf(p) {
    const shim = {};
    Object.defineProperty(shim, '_dialogMemory', { get() { return p.mem; }, set(v) { p.mem = v; } });
    return NpcDisposition.getMemory(shim);
}

/** Move a person's disposition toward the player (0..100). → applied */
function _bump(p, n) {
    if (!p || !n) return 0;
    const m = _memOf(p);
    const b = _num(m.disposition, 50);
    m.disposition = _clamp(b + n, 0, 100);
    return m.disposition - b;
}

export const NpcChatImpact = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.npcChat && g.npcChat.impact) || {};
        return { ...DEFAULTS, ...d, promise: { ...DEFAULTS.promise, ...(d.promise || {}) } };
    },

    /** Is this one of the functions handled here? */
    handles(fn) { return FNS.includes(fn); },

    // ── Where they are, who they are on the roster ──

    /**
     * The subject in the world: { folk, p (their roster person), settlement,
     * q, r, name, kingdom } — any of them null when unknown.
     */
    context(world, who) {
        const out = { folk: null, p: null, settlement: null, q: null, r: null, name: who && who.place || null, kingdom: null };
        if (!who || !world) return out;
        const npc = who.npc || {};
        if (npc._person && npc._folk) { out.p = npc._person; out.folk = npc._folk; } else if (npc.folkUid && typeof Relationships.folkPerson === 'function') {
            const got = Relationships.folkPerson(world, npc.folkUid);
            if (got) { out.p = got.p; out.folk = got.folk; }
        }
        if (out.folk && out.folk.q != null) { out.q = out.folk.q; out.r = out.folk.r; }
        if (out.q == null && out.name && typeof world.getSettlementViews === 'function') {
            const v = world.getSettlementViews().find(x => x && x.name === out.name);
            if (v) { out.q = v.q; out.r = v.r; }
        }
        const tile = out.q != null && typeof world.getTile === 'function' ? world.getTile(out.q, out.r) : null;
        if (tile && tile.settlement) {
            out.settlement = tile.settlement;
            out.name = tile.settlement.name || out.name;
            out.kingdom = tile.settlement.kingdom != null ? tile.settlement.kingdom : null;
            if (!out.folk && tile.settlement.folk && Array.isArray(tile.settlement.folk.people)) out.folk = tile.settlement.folk;
        }
        return out;
    },

    /** A living resident of the roster by name (full, or a first name only one of them has). */
    personNamed(folk, name, exclude = null) {
        const want = _norm(name).replace(/^(the|old|young|master|mistress|goodman|goodwife) /, '');
        if (!folk || !Array.isArray(folk.people) || want.length < 2) return null;
        const live = folk.people.filter(p => _alive(p) && p !== exclude);
        const full = live.filter(p => _norm(Townsfolk.name(p)) === want);
        if (full.length === 1) return full[0];
        const first = live.filter(p => _norm(p.first) === want);
        if (first.length === 1) return first[0];
        const starts = live.filter(p => want.startsWith(`${_norm(p.first)} `) && _norm(Townsfolk.name(p)).startsWith(want.split(' ').slice(0, 2).join(' ')));
        return starts.length === 1 ? starts[0] : null;
    },

    /** Family and household of a person, living and here. */
    kinOf(folk, p) {
        if (!folk || !p) return [];
        const out = new Set();
        const add = (o) => { if (_alive(o) && o !== p) out.add(o); };
        add(Townsfolk.get(folk, p.spouse));
        for (const id of p.parents || []) add(Townsfolk.get(folk, id));
        for (const id of p.kids || []) add(Townsfolk.get(folk, id));
        for (const s of Townsfolk.siblings(folk, p)) add(s);
        if (p.hh != null) for (const o of folk.people) if (o.hh === p.hh) add(o);
        return [...out];
    },

    /** A ruler (by their name, their realm's, or "the king/queen/crown" for the speaker's own) or a rival the player has met. */
    subjectNamed(player, world, name, homeKingdom = null) {
        const want = _norm(name);
        if (want.length < 2 || !world) return null;
        const realms = (world.kingdoms || []).filter(k => k && k.isAlive !== false);
        const realmName = (k) => _norm(k.name);
        let k = realms.find(x => x.ruler && _norm(x.ruler) === want)
            || realms.find(x => realmName(x) === want || _norm(Names.realm ? Names.realm(x.name) : x.name) === want)
            || realms.find(x => (x.ruler && want.includes(_norm(x.ruler))) || (realmName(x).length > 3 && want.includes(realmName(x))));
        if (!k && homeKingdom != null && /\b(king|queen|crown|lord|lady|ruler|prince|princess|throne)\b/.test(want)) k = realms.find(x => x.id === homeKingdom) || null;
        if (k) return { type: 'ruler', kingdomId: k.id, name: k.ruler || `the ruler of ${Names.realm ? Names.realm(k.name) : k.name}` };
        const rivals = ((player && player.rivals && player.rivals.list) || []).filter(r => r && !r.dead && r.met && r.name);
        const rv = rivals.find(r => _norm(r.name) === want) || rivals.find(r => want.includes(_norm(r.name)) || _norm(r.name).startsWith(`${want} `));
        return rv ? { type: 'rival', rivalId: rv.id, name: rv.name } : null;
    },

    _isPlayer(player, name) {
        const want = _norm(name);
        if (['the player', 'player', 'me', 'myself', 'you', 'yourself', 'them', 'themselves', 'the traveller', 'the traveler'].includes(want)) return true;
        const pn = _norm(player && player.name);
        return !!pn && (want === pn || want === pn.split(' ')[0]);
    },

    // ── Their memory of what came of it ──

    _ledger(store, world, k, text) {
        const C = NpcChatImpact.config();
        store.chatLedger = Array.isArray(store.chatLedger) ? store.chatLedger : [];
        store.chatLedger.push({ d: _day(world), k, t: String(text).slice(0, 200) });
        const max = _num(C.ledger, 8);
        if (store.chatLedger.length > max) store.chatLedger.splice(0, store.chatLedger.length - max);
    },

    /** The ref NpcMemory and the daily tick resolve a subject by: { ref, folkRef }. */
    _refs(who, ctx) {
        const folkRef = ctx.folk && ctx.p && ctx.folk.q != null ? `${ctx.folk.q},${ctx.folk.r}#${ctx.p.id}` : null;
        if (who._subject === 'relationship' && who.npc && who.npc.id != null) return { ref: `rel:${who.npc.id}`, relId: who.npc.id, folkRef };
        return { ref: folkRef ? `folk:${folkRef}` : null, relId: null, folkRef };
    },

    // ── Promises (player.npcChat, saved) ──

    state(player) {
        if (!player.npcChat || typeof player.npcChat !== 'object') player.npcChat = { promises: [], nextId: 1 };
        const st = player.npcChat;
        if (!Array.isArray(st.promises)) st.promises = [];
        if (!(st.nextId > 0)) st.nextId = st.promises.length + 1;
        return st;
    },

    promisesTo(player, key, state = 'open') {
        if (!player || !player.npcChat) return [];
        return NpcChatImpact.state(player).promises.filter(p => p.key === key && (!state || p.state === state));
    },

    _keep(player, world, who, ctx, prom, notes) {
        const C = NpcChatImpact.config().promise;
        prom.state = 'kept';
        prom.settled = _day(world);
        const got = who.warm(_num(C.keptWarm, 6));
        if (ctx.folk && ctx.p) NpcMemory.remember(world, { folk: ctx.folk, person: ctx.p }, { kind: 'promise_kept', player, note: prom.text });
        NpcChatImpact._ledger(who.store(), world, 'kept', `They kept their promise to you: ${prom.text}.`);
        notes.push({ text: `🤝 Promise kept: ${prom.text}${got > 0 ? ` (+${got})` : ''}`, tone: 'good' });
    },

    /** A promise whose day has passed: broken. `who` when talking to them; else resolved from its ref. → a notice */
    _break(player, world, prom, who = null) {
        const C = NpcChatImpact.config().promise;
        prom.state = 'broken';
        prom.settled = _day(world);
        const sour = _num(C.brokenSour, 14);
        let store = null;
        let folkRef = prom.folkRef || null;
        if (who) {
            who.sour(sour);
            store = who.store();
        } else if (prom.relId != null) {
            const rel = Relationships.getRelationship(player, prom.relId);
            if (rel) { rel.score = _clamp(_num(rel.score) - sour, -100, 100); store = rel; }
        } else if (prom.ref && prom.ref.startsWith('folk:')) folkRef = prom.ref.slice(5);
        const r = folkRef ? NpcMemory.resolve(world, folkRef) : null;
        if (r && r.type === 'folk') {
            if (!who && !store) { _bump(r.p, -Math.ceil(sour / 2)); store = _memOf(r.p); }
            NpcMemory.remember(world, r.folk ? { folk: r.folk, person: r.p } : r.p, { kind: 'promise_broken', player, kin: true, note: prom.text });
            for (const k of NpcChatImpact.kinOf(r.folk, r.p)) _bump(k, -_num(C.kinBroken, 4));
        }
        if (store) NpcChatImpact._ledger(store, world, 'broken', `They broke their promise to you: ${prom.text}. You have not forgotten.`);
        return { icon: '💔', title: 'A Broken Promise', text: `You promised ${prom.name} ${prom.text}, and the day came and went. They${r ? ' and their family' : ''} will remember it.`, type: 'warning' };
    },

    /** Promises to this subject now overdue are broken (when talking to them). → notes */
    settleDue(player, world, who) {
        const notes = [];
        for (const prom of NpcChatImpact.promisesTo(player, who.key)) {
            if (_day(world) > _num(prom.due)) {
                const n = NpcChatImpact._break(player, world, prom, who);
                notes.push({ text: `💔 ${n.text}`, tone: 'bad' });
            }
        }
        return notes;
    },

    /** The daily tick (ui/game/endDay.js): promises past their day, to anyone the game can find, are broken. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !player.npcChat) return out;
        const st = NpcChatImpact.state(player);
        const day = _day(world);
        for (const prom of st.promises) {
            if (prom.state !== 'open' || day <= _num(prom.due) || !prom.ref) continue;
            out.notices.push(NpcChatImpact._break(player, world, prom));
        }
        NpcChatImpact._prune(st);
        return out;
    },

    _prune(st) {
        const max = _num(NpcChatImpact.config().promise.maxAll, 30);
        while (st.promises.length > max) {
            const i = st.promises.findIndex(p => p.state !== 'open');
            if (i < 0) break;
            st.promises.splice(i, 1);
        }
    },

    /** Coin handed over (accept_gold) counts toward coin promised them; paid in full, the promise is kept. */
    onPaid(player, world, who, n, notes) {
        if (!(n > 0)) return;
        const ctx = NpcChatImpact.context(world, who);
        for (const prom of NpcChatImpact.promisesTo(player, who.key)) {
            if (!(prom.gold > 0) || n <= 0) continue;
            const part = Math.min(n, prom.gold - _num(prom.paid));
            prom.paid = _num(prom.paid) + part;
            n -= part;
            if (prom.paid >= prom.gold) NpcChatImpact._keep(player, world, who, ctx, prom, notes);
        }
    },

    // ── The talk spreads by itself ──

    /**
     * After a turn: a share of the regard it moved reaches their family and
     * household, and a sharp insult is remembered by them and their kin.
     * net: the turn's regard change in the subject's own units.
     */
    afterTurn(player, world, who, t, net, notes) {
        const C = NpcChatImpact.config();
        const ctx = NpcChatImpact.context(world, who);
        if (!ctx.folk || !ctx.p) return;
        const disp = who._subject === 'relationship' ? net / 2 : net;
        if (-net >= _num(C.insultAt, 7) && !t.insulted) {
            t.insulted = 1;
            NpcMemory.remember(world, { folk: ctx.folk, person: ctx.p }, { kind: 'insulted', player, kin: true });
        }
        let share = Math.round(disp * _num(C.kinShare, 0.25));
        const room = Math.max(0, _num(C.kinPerDay, 4) - _num(t.kin));
        share = _clamp(share, -room, room);
        if (!share) return;
        const kin = NpcChatImpact.kinOf(ctx.folk, ctx.p);
        if (!kin.length) return;
        t.kin = _num(t.kin) + Math.abs(share);
        for (const k of kin) _bump(k, share);
        const flag = share > 0 ? 'kinUp' : 'kinDown';
        if (!t[flag]) {
            t[flag] = 1;
            notes.push({ text: share > 0 ? `👪 Word of it reaches ${who.firstName}'s family (+${share})` : `👪 ${who.firstName}'s family will hear of it (${share})`, tone: share > 0 ? 'good' : 'bad' });
        }
    },

    // ── The functions ──

    /** Is the function worth offering this subject (e.g. a grudge needs a town roster)? */
    offered(fn, player, world, who) {
        if (!NpcChatImpact.handles(fn)) return true;
        const ctx = NpcChatImpact.context(world, who);
        if (fn === 'grow_grudge' || fn === 'cool_grudge' || fn === 'tell_family') return !!(ctx.folk && ctx.p);
        if (fn === 'report_to_watch' || fn === 'spread_word') return ctx.q != null;
        if (fn === 'keep_promise') return NpcChatImpact.promisesTo(player, who.key).length > 0;
        return true;
    },

    /** Apply one of the functions here. → true when handled */
    apply(player, world, who, session, a, t, notes) {
        if (!a || !NpcChatImpact.handles(a.fn)) return false;
        const C = NpcChatImpact.config();
        const ctx = NpcChatImpact.context(world, who);
        const store = who.store();
        const day = _day(world);
        const first = who.firstName || 'They';
        const over = (k, cap) => _num(t[k]) >= _num(cap, 1);
        switch (a.fn) {
            case 'spread_word': {
                if (ctx.q == null || over('word', C.wordPerDay)) break;
                const claim = _text(a.claim || a.what || a.text, _num(C.claimLength, 90));
                const about = _text(a.about || a.who, 60);
                if (!about) break;
                const ill = String(a.tone || 'ill').toLowerCase() !== 'good';
                // About the player themself: tall talk, town to town
                if (NpcChatImpact._isPlayer(player, about)) {
                    if (!claim) break;
                    const rm = Gossip.spreadDeed(player, world, 'boast', { q: ctx.q, r: ctx.r, victim: claim.replace(/[.!]+$/, '') });
                    if (!rm) break;
                    t.word = _num(t.word) + 1;
                    NpcChatImpact._ledger(store, world, 'word', `You told folk what they said of themselves: "${claim}".`);
                    notes.push({ text: `🗣️ ${first} will tell it about ${ctx.name || 'town'}: your tale will travel`, tone: 'info' });
                    break;
                }
                // About someone of their town
                const target = NpcChatImpact.personNamed(ctx.folk, about, ctx.p);
                if (target) {
                    t.word = _num(t.word) + 1;
                    const tName = Townsfolk.name(target);
                    if (ill) {
                        // It gets back to them, and who started it
                        const got = -_bump(target, -_num(C.slanderSour, 4));
                        NpcMemory.remember(world, { folk: ctx.folk, person: target }, { kind: 'slandered', player, note: claim || null });
                        if (ctx.p && ctx.settlement) Brawls.addFeud(ctx.settlement, ctx.p.id, target.id, 'whispered', day, _num(C.slanderGrudge, 12));
                        NpcChatImpact._ledger(store, world, 'word', `At their urging you have been saying about town that ${tName} ${claim || 'is no good'}.`);
                        notes.push({ text: `🗣️ ${first} spreads it about ${tName}. It will get back to them${got > 0 ? ` (${tName} −${got})` : ''}`, tone: 'bad' });
                    } else {
                        const got = _bump(target, _num(C.praiseWarm, 3));
                        NpcMemory.remember(world, { folk: ctx.folk, person: target }, { kind: 'praised', player, note: claim || null });
                        NpcChatImpact._ledger(store, world, 'word', `At their urging you have been speaking well of ${tName} about town.`);
                        notes.push({ text: `🗣️ ${first} will speak up for ${tName}${got > 0 ? ` (${tName} +${got})` : ''}`, tone: 'good' });
                    }
                    break;
                }
                // About a ruler or a rival: a court tale (systems/whispers.js)
                const subj = NpcChatImpact.subjectNamed(player, world, about, ctx.kingdom);
                if (subj) {
                    if (!ill) { notes.push({ text: `🤷 Nobody fans a tale of ${subj.name}'s virtues`, tone: 'info' }); break; }
                    const r = NpcChatImpact._whisper(player, world, ctx, subj, claim);
                    if (!r) { notes.push({ text: `🤷 Nobody in ${ctx.name || 'town'} would believe that of ${subj.name}`, tone: 'info' }); break; }
                    t.word = _num(t.word) + 1;
                    NpcChatImpact._ledger(store, world, 'word', `At their urging you have been telling the tale about ${subj.name}: ${r.line}`);
                    notes.push({ text: r.fresh ? `🐍 ${first} starts a tale about ${subj.name} in ${ctx.name}: "${r.line}" (a lie can be traced to you)` : `🐍 ${first} fans the tale about ${subj.name} (heat ${r.heat})`, tone: 'info' });
                    break;
                }
                notes.push({ text: `🤷 ${first} doesn't know of any ${about}`, tone: 'info' });
                break;
            }
            case 'grow_grudge':
            case 'cool_grudge': {
                const cool = a.fn === 'cool_grudge';
                if (!ctx.folk || !ctx.p || !ctx.settlement) break;
                if (over(cool ? 'cool' : 'grudge', cool ? C.coolsPerDay : C.grudgesPerDay)) break;
                const target = NpcChatImpact.personNamed(ctx.folk, a.against || a.who || a.about, ctx.p);
                if (!target) { notes.push({ text: `🤷 ${first} knows no ${_text(a.against || a.who || 'such person', 40)} here`, tone: 'info' }); break; }
                const tName = Townsfolk.name(target);
                if (!cool) {
                    t.grudge = _num(t.grudge) + 1;
                    const f = Brawls.addFeud(ctx.settlement, ctx.p.id, target.id, 'whispered', day, _num(C.grudgeHeat, 15));
                    NpcChatImpact._ledger(store, world, 'grudge', `They turned you against ${tName}${a.why ? ` (${_text(a.why, 60)})` : ''}.`);
                    notes.push({ text: `🔥 ${first} now bears a grudge against ${tName}${f && f.heat >= 50 ? ', and it runs hot' : ''}`, tone: 'bad' });
                } else {
                    const f = Brawls.feud(ctx.settlement, ctx.p.id, target.id);
                    if (!f) { notes.push({ text: `🤷 ${first} holds no grudge against ${tName}`, tone: 'info' }); break; }
                    t.cool = _num(t.cool) + 1;
                    f.heat = Math.max(0, _num(f.heat) - _num(C.coolHeat, 20));
                    const forget = _num(((Brawls.config().grudges) || {}).forgetBelow, 4);
                    if (f.heat < forget) delete Brawls.state(ctx.settlement).feuds[Brawls.feudKey(ctx.p.id, target.id)];
                    NpcChatImpact._ledger(store, world, 'cooled', `They talked you down from your grudge against ${tName}.`);
                    notes.push({ text: f.heat < forget ? `🕊️ ${first} lets go of the grudge against ${tName}` : `🕊️ ${first}'s grudge against ${tName} cools`, tone: 'good' });
                }
                break;
            }
            case 'promise': {
                const P = C.promise;
                if (over('promise', P.perDay)) break;
                const text = _text(a.text || a.what, _num(P.textLength, 100));
                if (!text) break;
                const st = NpcChatImpact.state(player);
                const open = NpcChatImpact.promisesTo(player, who.key);
                if (open.some(p => _norm(p.text) === _norm(text))) break;
                if (open.length >= _num(P.maxOpen, 3)) { notes.push({ text: `🤞 ${first} is still waiting on your other promises`, tone: 'info' }); break; }
                if (st.promises.filter(p => p.state === 'open').length >= _num(P.maxAll, 30)) break;
                t.promise = _num(t.promise) + 1;
                const days = _clamp(Math.round(_num(a.days, P.defaultDays)), _num(P.minDays, 1), _num(P.maxDays, 60));
                const gold = _clamp(Math.round(_num(a.gold, 0)), 0, _num(P.maxGold, 500));
                const refs = NpcChatImpact._refs(who, ctx);
                const prom = { id: st.nextId++, key: who.key, ref: refs.ref, folkRef: refs.folkRef, name: who.name, text, made: day, due: day + days, state: 'open' };
                if (refs.relId != null) prom.relId = refs.relId;
                if (gold > 0) { prom.gold = gold; prom.paid = 0; }
                st.promises.push(prom);
                NpcChatImpact._prune(st);
                notes.push({ text: `🤞 ${first} will hold you to it: ${text} (by day ${prom.due})`, tone: 'info' });
                break;
            }
            case 'keep_promise': {
                const open = NpcChatImpact.promisesTo(player, who.key);
                const id = Math.round(_num(a.id, NaN));
                const prom = open.find(p => p.id === id) || (open.length === 1 ? open[0] : null);
                if (!prom) break;
                NpcChatImpact._keep(player, world, who, ctx, prom, notes);
                break;
            }
            case 'report_to_watch': {
                if (ctx.q == null || over('report', C.reportsPerDay)) break;
                const crime = String(a.crime || '').toLowerCase().trim();
                if (!(C.reportCrimes || []).includes(crime)) break;
                t.report = _num(t.report) + 1;
                const guard = /guard|watch|constable|sergeant/i.test(`${who.occupation || ''} ${who.npc && who.npc.type || ''}`);
                const victim = _text(a.victim, 40) || 'someone';
                const rm = Gossip.accuse(player, world, crime, { q: ctx.q, r: ctx.r, victim, credibility: guard ? C.guardReportCredibility : C.reportCredibility });
                if (!rm) break;
                // (the player's own words: testimony when the watch questions them, systems/watchQuestioning.js)
                rm.confessed = true;
                NpcChatImpact._ledger(store, world, 'report', `You went to the watch about the ${crime} they owned to.`);
                notes.push({ text: `🚨 ${first} ${guard ? 'takes it to the watch-house' : 'goes to the watch'} about the ${crime}`, tone: 'bad' });
                break;
            }
            case 'tell_family': {
                if (!ctx.folk || !ctx.p || over('told', C.toldPerDay)) break;
                const well = String(a.how || a.tone || 'well').toLowerCase() !== 'ill';
                const kin = NpcChatImpact.kinOf(ctx.folk, ctx.p);
                if (!kin.length) break;
                t.told = _num(t.told) + 1;
                const n = _num(C.kinTold, 3);
                for (const k of kin) _bump(k, well ? n : -n);
                NpcMemory.rememberKin(world, { folk: ctx.folk, person: ctx.p }, { kind: well ? 'spoke_well' : 'spoke_ill', player });
                NpcChatImpact._ledger(store, world, 'told', `You told your family ${well ? 'good things' : 'nothing good'} of them.`);
                notes.push({ text: `👪 ${first} will speak ${well ? 'well' : 'ill'} of you at home (${kin.length} ${kin.length === 1 ? 'hears' : 'hear'} it)`, tone: well ? 'good' : 'bad' });
                break;
            }
            case 'share_secret': {
                if (over('secret', C.secretsPerDay)) break;
                if (_num(who.regard ? who.regard() : 0) < _num(C.secretRegard, 20)) { notes.push({ text: `🤐 ${first} doesn't trust you with that yet`, tone: 'info' }); break; }
                const said = NpcChatImpact._secret(player, world, who, ctx);
                if (!said) { notes.push({ text: `🤷 ${first} has nothing worth confiding`, tone: 'info' }); break; }
                t.secret = _num(t.secret) + 1;
                NpcChatImpact._ledger(store, world, 'secret', `You confided to them: ${said}`);
                notes.push({ text: `🤫 ${said}`, tone: 'good' });
                break;
            }
            default: return false;
        }
        return true;
    },

    /** Plant a tale about a ruler/rival at the speaker's town, or fan a live one. → { fresh, line, heat } | null */
    _whisper(player, world, ctx, subj, claim) {
        if (ctx.q == null) return null;
        const C = NpcChatImpact.config();
        const live = Whispers.live(player).find(s => s.subject.type === subj.type && (subj.type === 'ruler' ? s.kingdomId === subj.kingdomId : s.subject.rivalId === subj.rivalId));
        const key = `${ctx.q},${ctx.r}`;
        if (live) {
            if (!live.spreadTo.includes(key)) live.spreadTo.push(key);
            live.extra = _num(live.extra) + _num(C.whisperHeat, 6);
            live.fannedByPlayer = true;
            live.known = true;
            live.heat = Whispers._heat(live, world);
            return { fresh: false, line: Whispers.text(live), heat: live.heat };
        }
        const kingdomId = subj.type === 'ruler' ? subj.kingdomId : ctx.kingdom;
        const kinds = Whispers.kindsFor(subj.type, world, Whispers._kingdom(world, subj.kingdomId != null ? subj.kingdomId : kingdomId));
        if (!kinds.length) return null;
        const words = C.whisperWords || {};
        const c = _norm(claim);
        const kind = kinds.find(k => (words[k] || []).some(w => c.includes(w))) || kinds[_hash(`${subj.name}|${c}`) % kinds.length];
        const subject = subj.type === 'ruler' ? { type: 'ruler', kingdomId: subj.kingdomId, name: subj.name } : { type: 'rival', rivalId: subj.rivalId, name: subj.name, kingdomId };
        const sc = Whispers._create(player, world, subject, kind, { q: ctx.q, r: ctx.r, name: ctx.name || 'town' }, { planted: true, known: true, extra: _num(C.whisperHeat, 6) });
        if (!sc) return null;
        Whispers.state(player).stats.planted++;
        return { fresh: true, line: Whispers.text(sc), heat: sc.heat };
    },

    /** Something true they confide. → the line, or null */
    _secret(player, world, who, ctx) {
        // The truth of a tale told in their realm
        if (ctx.kingdom != null) {
            const sc = Whispers.secretIn(player, ctx.kingdom);
            if (sc) {
                Whispers.reveal(player, sc.id);
                return `${who.firstName} lowers their voice: the tale about ${sc.subject.name} — "${Whispers.text(sc)}" — is ${sc.truth ? 'true. They know someone who saw it.' : 'a lie. They know who started it, and why.'}`;
            }
        }
        // What they know of trouble nearby (systems/npcKnowledge.js)
        if (ctx.q == null) return null;
        try {
            const npc = { type: (who.npc && who.npc.type) || who.occupation || 'villager', uid: who.key };
            const line = NpcKnowledge.rumour(world, player, npc, { settlement: { q: ctx.q, r: ctx.r, name: ctx.name, kingdom: ctx.kingdom }, seed: `${who.key}|secret|${_day(world)}` });
            return line ? `${who.firstName} tells you: ${line}` : null;
        } catch {
            return null;
        }
    },

    // ── Read back into the character sheet ──

    /** Lines for the persona: promises the player owes them, what came of past talks, and names they know. */
    personaLines(player, world, who) {
        const lines = [];
        const day = _day(world);
        const C = NpcChatImpact.config();
        const proms = NpcChatImpact.promisesTo(player, who.key);
        if (proms.length) {
            lines.push('YOUR PROMISES FROM THEM (hold them to these; call keep_promise with the number only when they have truly done it):');
            for (const p of proms) {
                const left = _num(p.due) - day;
                lines.push(`- #${p.id}: ${p.text}${p.gold > 0 ? ` (${p.gold} gold, ${_num(p.paid)} paid so far)` : ''} — ${left <= 0 ? 'due today' : `due in ${left} day${left === 1 ? '' : 's'}`}.`);
            }
        }
        const store = who.store();
        const done = (store.chatLedger || []).slice(-_num(C.ledger, 8));
        if (done.length) {
            lines.push('What came of your talks with them:');
            for (const e of done) lines.push(`- (day ${e.d}) ${e.t}`);
        }
        const ctx = NpcChatImpact.context(world, who);
        // The player overheard them talking about the player (systems/overheard.js)
        if (ctx.p) lines.push(...Overheard.personaLines(player, world, ctx.p));
        if (ctx.folk && ctx.p) {
            const kin = NpcChatImpact.kinOf(ctx.folk, ctx.p);
            const feuds = Brawls.feudsOf(ctx.settlement, ctx.p.id).map(x => Townsfolk.get(ctx.folk, x.other)).filter(_alive);
            const others = Townsfolk.residents(ctx.folk).filter(o => o !== ctx.p && Townsfolk.age(o, day) >= 16);
            const seen = new Set();
            const named = [];
            for (const o of [...kin, ...feuds, ...others]) {
                if (seen.has(o) || named.length >= _num(C.folkNamed, 8)) continue;
                seen.add(o);
                named.push(`${Townsfolk.name(o)} (${Townsfolk.roleTitle(o)}${kin.includes(o) ? ', family' : ''})`);
            }
            if (named.length) lines.push(`Some folk of your town: ${named.join(', ')}.`);
            // Kin who left with the player and never came home (systems/vanishings.js)
            lines.push(...Vanishings.personaLines(world, player, ctx.folk, ctx.p));
        }
        const k = ctx.kingdom != null && world && Array.isArray(world.kingdoms) ? world.kingdoms.find(x => x && x.id === ctx.kingdom) : null;
        if (k && k.ruler) lines.push(`Your realm is ${k.name}, ruled by ${k.ruler}.`);
        return lines;
    },
};
